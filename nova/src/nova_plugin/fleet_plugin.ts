// Random flët spawning on system entry, ported from the binary's
// FUN_00425280/FUN_004259b0: when a system world is built, every flët whose
// LinkSyst matches the system and whose ActivateOn test passes is eligible,
// ONE index is drawn into the 256-slot flët table, and if the drawn slot is
// eligible that flët (lead ship + escort groups) warps in as plain NPCs.
//
// Flagged approximation: flëts are atmosphere-only in EV Nova, approximated
// by requiring at least one inhabited planet (spöb 0x20 cleared) in the
// system before spawning. The hyperspace-entry quote STR# is resolved (with
// '#' replaced by random digits) and collected on FleetQuotesResource, but
// nothing displays it yet — there is no generic message surface.

import { FleetData } from "novadatainterface/FleetData";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { SystemData } from "novadatainterface/SystemData";
import { evaluateTest, parseTest, TestContext } from "novadatainterface/expressions";
import { Entities, GetWorld } from "nova_ecs/arg_types";
import { AsyncSystem } from "nova_ecs/async_system";
import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";
import { EntityMap } from "nova_ecs/entity_map";
import { SingletonComponent } from "nova_ecs/world";
import { MissionEnv } from "../missions/mission_state_machine";
import { fleetQuoteFromSet } from "../spaceport/fleet_quote";
import { MissionEnvResource } from "../missions/mission_plugin";
import {
    decodeSystemFilter,
    globalId,
    rawIdOf,
    SystemMatchContext,
    systemMatchesSystemFilter,
} from "../missions/stellar_filter";
import { ControlBits, PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { randInt, seedRng } from "../player/pilot_files";
import { makeDudeShip } from "./dude";
import { GameDataResource } from "./game_data_resource";
import { SystemIdResource } from "./system_id_resource";

// The flët table in the binary has 256 slots and the spawn roll draws one
// index into it (FUN_00425280: idx = rand(0x100); spawn iff slot idx is
// eligible). The port's data layer does not expose engine table slots, so
// the draw is composed as the same probability: a hit needs
// rand(256) < eligibleCount, then a uniform pick among the eligible flëts.
const FLEET_TABLE_SLOTS = 0x100;

const FleetsSpawnedResource = new Resource<{ val: boolean }>('FleetsSpawnedResource');

// Hyperspace-entry quotes of the fleets spawned on this entry, for a future
// message surface to display (there is none yet).
export const FleetQuotesResource = new Resource<string[]>('FleetQuotesResource');

const SpawnFleetsSystem = new AsyncSystem({
    name: 'SpawnFleetsSystem',
    args: [GameDataResource, SystemIdResource, Entities, GetWorld,
        FleetsSpawnedResource, SingletonComponent] as const,
    exclusive: true,
    async step(gameData, systemId, entities, world, spawned) {
        if (spawned.val) {
            world.removeSystem(SpawnFleetsSystem);
            return;
        }
        spawned.val = true;
        const state = world.resources.get(PlayerStateResource);
        const env = world.resources.get(MissionEnvResource);
        if (!state || !env) {
            return;
        }
        const ids = await gameData.ids;
        if (ids.Fleet.length === 0) {
            return;
        }
        const systemData = env.system(systemId);
        if (!systemData) {
            return;
        }
        // Flëts are atmosphere-only: no inhabited planet, no fleet.
        if (!systemHasInhabitedPlanet(systemData, env)) {
            return;
        }
        const quotes: string[] = [];

        // FUN_00425280: scan every flët for eligibility (exists, LinkSyst
        // matches, ActivateOn passes), then draw ONE index into the 256-slot
        // flët table; if the drawn slot is eligible, that whole flët (lead
        // ship + escort groups) warps in. One draw per call — the engine
        // reaches this roll via the ambient-slot branch of FUN_0041af90
        // (per ambient ship slot, gated rand(7) != 0 then rand(7) == 0), and
        // how many ambient slots a system gets is sÿst data (the Count
        // field at sÿst+0x8e), which this port does not model; the world
        // build makes one call per system entry.
        const matching: Array<{ fleetId: string; fleet: FleetData }> = [];
        for (const fleetId of ids.Fleet) {
            let fleet: FleetData;
            try {
                fleet = await gameData.data.Fleet.get(fleetId);
            }
            catch {
                continue;
            }
            if (fleetActive(fleet, state, systemId, systemData, env)) {
                matching.push({ fleetId, fleet });
            }
        }

        // One shared LCG stream per entry, seeded from the pilot's rngSeed
        // (the engine's stream is global and continuous; see pilot_files).
        seedRng(state.rngSeed);
        if (randInt(FLEET_TABLE_SLOTS) < matching.length) {
            const { fleet } = matching[randInt(matching.length)];
            quotes.push(...await spawnFleet(gameData, env, entities, fleet));
        }

        const fleetQuotes = world.resources.get(FleetQuotesResource);
        if (fleetQuotes) {
            fleetQuotes.push(...quotes);
        }
    },
});

// At least one of the system's planets must be inhabited (spöb flag 0x20
// cleared) for a flët to spawn.
function systemHasInhabitedPlanet(systemData: SystemData,
    env: MissionEnv): boolean {
    return systemData.planets.some(id => env.planet(id)?.inhabited ?? false);
}

// LinkSyst -1 matches any system; otherwise it uses the mïsn system filter
// codes (specific ids, the near bands and the govt relation bands).
function fleetActive(fleet: FleetData, state: PlayerState, systemId: string,
    systemData: SystemData, env: MissionEnv): boolean {
    if (fleet.linkSyst !== -1) {
        const originSystemId = (state.lastStellar !== null
            ? env.systemOfPlanet(state.lastStellar) : null) ?? systemId;
        const ctx: SystemMatchContext = {
            originSystemId,
            playerSystemId: systemId,
            travelStellarId: null,
            returnStellarId: null,
            systemOfPlanet: id => env.systemOfPlanet(id),
            system: id => env.system(id),
            planet: id => env.planet(id),
            government: id => env.government(id),
            govtByRawId: rawId => env.govtByRawId(rawId),
        };
        if (!systemMatchesSystemFilter(systemData,
            decodeSystemFilter(fleet.linkSyst), ctx)) {
            return false;
        }
    }
    if (fleet.activateOn !== "") {
        const ctx: TestContext = {
            bits: new ControlBits(state.bits),
            gender: state.gender === "female" ? 0 : 1,
            // Outfit ownership lives on the player's ship entities, which
            // are not reachable from here; stock flët ActivateOn
            // expressions do not use Oxxx.
            hasOutfit: () => false,
            exploredSystem: rawId =>
                state.exploredSystems.includes(globalId(env.prefix, rawId)),
        };
        if (!evaluateTest(parseTest(fleet.activateOn,
            message => console.warn(`[fleets] ${message}`)), ctx)) {
            return false;
        }
    }
    return true;
}

// Spawns the flët's ships and returns its hyperspace-entry quote text
// (empty when the flët has no Quote STR# or the set is missing). All rolls
// use the shared engine LCG (randInt), like FUN_004259b0.
async function spawnFleet(gameData: GameDataInterface, env: MissionEnv,
    entities: EntityMap, fleet: FleetData): Promise<string[]> {
    const ships: string[] = [];
    if (fleet.leadShipType) {
        ships.push(fleet.leadShipType);
    }
    // Escort group count = Min + rand(Max - Min + 1), four groups, exactly
    // FUN_004259b0's roll (flët+0xc/0x14 min/max per group).
    for (const escort of fleet.escorts) {
        const span = escort.max - escort.min + 1;
        if (span <= 0) {
            continue;
        }
        const count = escort.min + randInt(span);
        for (let i = 0; i < count; i++) {
            ships.push(escort.ship!);
        }
    }

    for (const [index, shipId] of ships.entries()) {
        if (!shipId) {
            continue;
        }
        let shipData;
        try {
            shipData = await gameData.data.Ship.get(shipId);
        }
        catch {
            console.warn(`[fleets] unknown shïp ${shipId} (flët ${fleet.id})`);
            continue;
        }
        const ship = makeDudeShip(null, shipData, fleet.govt);
        entities.set(`fleet-ship ${fleet.id} ${index}`, ship);
    }

    // The quote is resolved after the ships, as in FUN_004259b0's tail.
    const quotes: string[] = [];
    if (fleet.quote >= 0) {
        const strId = globalId(env.prefix, fleet.quote);
        try {
            const quote = fleetQuoteFromSet(fleet.quote,
                await gameData.data.StringSet.get(strId));
            if (quote !== null) {
                quotes.push(quote);
            }
        }
        catch {
            console.warn(`[fleets] unknown STR# ${strId} (flët ${fleet.id})`);
        }
    }
    return quotes;
}

export const FleetPlugin: Plugin = {
    name: 'FleetPlugin',
    build(world) {
        world.resources.set(FleetsSpawnedResource, { val: false });
        world.resources.set(FleetQuotesResource, []);
        world.addSystem(SpawnFleetsSystem);
    },
};
