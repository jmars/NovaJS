// The flët branch of the ambient population event, ported from the
// binary's FUN_00425280/FUN_004259b0: every flët whose LinkSyst matches
// the system and whose ActivateOn test passes is eligible, ONE index is
// drawn into the 256-slot flët table per flët roll, and if the drawn slot
// is eligible that flët (lead ship + escort groups) warps in as plain
// NPCs. The roll is reached from ambient_plugin's PopulateSystem at each
// population event (jump-in, landing, liftoff, boarding) — the binary runs
// FUN_0041af90 only at those, never per frame. 6/49 of ambient rolls take
// this branch (rand(7) misses the përs branch, then rand(7) == 0).
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
import { Entities, RunQuery, RunQueryFunction } from "nova_ecs/arg_types";
import { Entity } from "nova_ecs/entity";
import { EntityMap } from "nova_ecs/entity_map";
import { Position } from "nova_ecs/datatypes/position";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Plugin } from "nova_ecs/plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { MissionEnv } from "../missions/mission_state_machine";
import { fleetQuoteFromSet } from "../spaceport/fleet_quote";
import {
    decodeSystemFilter,
    globalId,
    rawIdOf,
    SystemMatchContext,
    systemMatchesSystemFilter,
} from "../missions/stellar_filter";
import { ControlBits, PlayerState } from "../player/player_state";
import { randInt } from "../player/pilot_files";
import { makeDudeShip } from "./dude";
import { PlayerShipSelector } from "./player_ship_plugin";

// The flët table in the binary has 256 slots and the spawn roll draws one
// index into it (FUN_00425280: idx = rand(0x100); spawn iff slot idx is
// eligible). The port's data layer does not expose engine table slots, so
// the draw is composed as the same probability: a hit needs
// rand(256) < eligibleCount, then a uniform pick among the eligible flëts.
export const FLEET_TABLE_SLOTS = 0x100;

// FUN_0041af90 gates each ambient roll with rand(7) draws: rand(7)==0
// takes the përs branch (FUN_004235c0), otherwise rand(7)==0 takes the
// flët branch (this module's spawnFleetRoll in ambient_plugin), otherwise
// the dûde branch (FUN_0041ba80, also ambient_plugin).
export const AMBIENT_GATE = 7;

// The binary keeps every ship of a system in 64 fixed ship slots
// (FUN_0041af90's slot loop, count 0x40): an ambient spawn gives up when
// no slot is free. The port bounds its fleet/përs population the same way.
export const MAX_AMBIENT_SHIPS = 0x40;

// Shared flag: the engine LCG stream is seeded once per system entry from
// the pilot's rngSeed and then runs on continuously across population
// events (the engine's stream is global and continuous; see pilot_files).
// Owned by AmbientPlugin.
export const AmbientSeedResource =
    new Resource<{ val: boolean }>('AmbientSeedResource');

// Hyperspace-entry quotes of the fleets spawned on this entry, for a future
// message surface to display (there is none yet). A quote is appended per
// spawning roll.
export const FleetQuotesResource = new Resource<string[]>('FleetQuotesResource');

// The binary counts a spawn against the system's 64 ship slots. The port
// counts the ships the ambient systems created (the fleet-ship / pers-ship
// / dude-ship entity keys), which is the population they own.
export function ambientShipCount(entities: EntityMap): number {
    let count = 0;
    for (const key of entities.keys()) {
        if (key.startsWith("fleet-ship ") || key.startsWith("pers-ship ")
            || key.startsWith("dude-ship ")) {
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

// LinkSyst -1 matches any system; otherwise it uses the mïsn system filter
// codes (specific ids, the near bands and the govt relation bands) through
// the shared decoder. The binary's përs/flët matchers are unaudited inline
// copies of FUN_00447a30; stock data only ever uses -1/specific/owned
// codes, and the mission-relative specials (-2/-3) have nothing to resolve
// against here, so they match nothing.
export function fleetActive(fleet: FleetData, state: PlayerState, systemId: string,
    systemData: SystemData, env: MissionEnv): boolean {
    if (fleet.linkSyst !== -1) {
        const ctx: SystemMatchContext = {
            // Ambient spawns happen in the player's system, which is also
            // what -1/-6 resolve to.
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
    // Flëts are atmosphere-only (flagged approximation): at least one of
    // the system's planets must be inhabited (spöb flag 0x20 cleared).
    return systemData.planets.some(id => env.planet(id)?.inhabited ?? false);
}

// Spawns the flët's ships and returns its hyperspace-entry quote text
// (empty when the flët has no Quote STR# or the set is missing). All rolls
// use the shared engine LCG (randInt), like FUN_004259b0.
export async function spawnFleet(gameData: GameDataInterface, env: MissionEnv,
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
        // FUN_004259b0: every ship of the flët (lead + escort groups) is
        // tagged with the FLËT's own government (the flët record's govt
        // field) — never the ship class's inherent govt. A null flët govt
        // leaves the ship independent.
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
        world.resources.set(FleetQuotesResource, []);
    },
};
