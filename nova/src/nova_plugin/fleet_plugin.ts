// Random flët spawning, ported from the binary's ambient ship manager
// FUN_0041af90 and its fleet spawn FUN_00425280/FUN_004259b0: every flët
// whose LinkSyst matches the system and whose ActivateOn test passes is
// eligible, ONE index is drawn into the 256-slot flët table per pass, and
// if the drawn slot is eligible that flët (lead ship + escort groups) warps
// in as plain NPCs. The binary reaches this roll from the per-frame game
// tick, so the draw re-runs while the player stays in the system — ships
// keep appearing over time, not only on arrival.
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
import { Entities, GetWorld, RunQuery, RunQueryFunction } from "nova_ecs/arg_types";
import { AsyncSystem } from "nova_ecs/async_system";
import { Entity } from "nova_ecs/entity";
import { EntityMap } from "nova_ecs/entity_map";
import { Position } from "nova_ecs/datatypes/position";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Plugin } from "nova_ecs/plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
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
import { PlayerShipSelector } from "./player_ship_plugin";
import { SystemIdResource } from "./system_id_resource";

// The flët table in the binary has 256 slots and the spawn roll draws one
// index into it (FUN_00425280: idx = rand(0x100); spawn iff slot idx is
// eligible). The port's data layer does not expose engine table slots, so
// the draw is composed as the same probability: a hit needs
// rand(256) < eligibleCount, then a uniform pick among the eligible flëts.
const FLEET_TABLE_SLOTS = 0x100;

// FUN_0041af90 gates each ambient slot roll with rand(7) draws: rand(7)==0
// takes the përs branch (FUN_004235c0, SpawnPersSystem), otherwise
// rand(7)==0 takes the flët branch (this system), otherwise the dude-table
// branch (FUN_0041ba80, not ported). The port splits the branches across
// the two spawn systems, each drawing the gates of its own branch.
export const AMBIENT_GATE = 7;

// The binary rolls the ambient gates every frame for each sÿst ambient
// slot (the Count field at sÿst+0x8e — data this port does not model).
// The port runs ONE virtual slot pass every AMBIENT_ROLL_INTERVAL_FRAMES
// frames so the sparse draw stays sparse.
export const AMBIENT_ROLL_INTERVAL_FRAMES = 30;

// The binary keeps every ship of a system in 64 fixed ship slots
// (FUN_0041af90's slot loop, count 0x40): an ambient spawn gives up when
// no slot is free. The port bounds its ambient population the same way.
export const MAX_AMBIENT_SHIPS = 0x40;

// Shared flag: the engine LCG stream is seeded once per system entry from
// the pilot's rngSeed and then runs on continuously across ambient passes
// (the engine's stream is global and continuous; see pilot_files).
export const AmbientSeedResource =
    new Resource<{ val: boolean }>('AmbientSeedResource');

// Frames until this system's next ambient slot pass. 0 rolls immediately,
// so a freshly built system world still spawns on entry.
const FleetRollResource =
    new Resource<{ framesUntilRoll: number }>('FleetRollResource');

// Hyperspace-entry quotes of the fleets spawned on this entry, for a future
// message surface to display (there is none yet). A quote is appended per
// spawning pass.
export const FleetQuotesResource = new Resource<string[]>('FleetQuotesResource');

// The binary counts a spawn against the system's 64 ship slots. The port
// counts the ships its two ambient systems created (the fleet-ship /
// pers-ship entity keys), which is the population they own.
export function ambientShipCount(entities: EntityMap): number {
    let count = 0;
    for (const key of entities.keys()) {
        if (key.startsWith("fleet-ship ") || key.startsWith("pers-ship ")) {
            count++;
        }
    }
    return count;
}

const PlayerPositionQuery = new Query([MovementStateComponent,
    PlayerShipSelector] as const);

// The player's current position, or the system origin when no player ship
// is in the world (headless/test worlds).
export function playerPosition(runQuery: RunQueryFunction): Position {
    const movement = runQuery(PlayerPositionQuery)[0]?.[0];
    return movement?.position ?? new Position(0, 0);
}

// Ambient ships must not stack on the player: each ship scatters within
// makeShip's ±300-unit box around the given origin. Math.random, like
// makeShip's own scatter — this does not touch the engine LCG stream.
export function warpInAt(ship: Entity, origin: Position): void {
    const movement = ship.components.get(MovementStateComponent)!;
    movement.position = new Position(origin.x + 600 * (Math.random() - 0.5),
        origin.y + 600 * (Math.random() - 0.5));
    ship.components.set(MovementStateComponent, movement);
}

const SpawnFleetsSystem = new AsyncSystem({
    name: 'SpawnFleetsSystem',
    args: [GameDataResource, SystemIdResource, Entities, GetWorld,
        FleetRollResource, AmbientSeedResource, RunQuery,
        SingletonComponent] as const,
    exclusive: true,
    async step(gameData, systemId, entities, world, roll, seeded, runQuery) {
        // Cooldown (the resource's immer patches land on the next run, so
        // the count is off by at most one frame).
        if (roll.framesUntilRoll > 0) {
            roll.framesUntilRoll--;
            return;
        }
        roll.framesUntilRoll = AMBIENT_ROLL_INTERVAL_FRAMES - 1;

        const state = world.resources.get(PlayerStateResource);
        const env = world.resources.get(MissionEnvResource);
        if (!state || !env) {
            return;
        }
        // One seed per system entry; every later pass advances the same
        // stream, so consecutive rolls differ (the engine's stream is
        // global and continuous; see pilot_files).
        if (!seeded.val) {
            seedRng(state.rngSeed);
            seeded.val = true;
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

        // FUN_0041af90's ambient branch, flët slot: reach the table draw
        // only when the first rand(7) misses the përs branch and the second
        // hits the flët branch.
        if (randInt(AMBIENT_GATE) === 0) {
            return;
        }
        if (randInt(AMBIENT_GATE) !== 0) {
            return;
        }
        // 64-slot bound: with no free slot, the binary's spawn gives up.
        if (ambientShipCount(entities) >= MAX_AMBIENT_SHIPS) {
            return;
        }
        const quotes: string[] = [];

        // FUN_00425280: scan every flët for eligibility (exists, LinkSyst
        // matches, ActivateOn passes), then draw ONE index into the 256-slot
        // flët table; if the drawn slot is eligible, that whole flët (lead
        // ship + escort groups) warps in. One draw per pass.
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

        // One shared LCG stream, seeded once per system entry above; this
        // pass's draws advance it (see pilot_files).
        if (randInt(FLEET_TABLE_SLOTS) < matching.length) {
            const { fleet } = matching[randInt(matching.length)];
            quotes.push(...await spawnFleet(gameData, env, entities, fleet,
                playerPosition(runQuery)));
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
    entities: EntityMap, fleet: FleetData, origin: Position):
    Promise<string[]> {
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
        warpInAt(ship, origin);
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
        world.resources.set(FleetRollResource, { framesUntilRoll: 0 });
        world.resources.set(AmbientSeedResource, { val: false });
        world.resources.set(FleetQuotesResource, []);
        world.addSystem(SpawnFleetsSystem);
    },
};
