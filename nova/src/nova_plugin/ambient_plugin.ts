// The ambient population event, ported from the binary's ship-population
// manager FUN_0041af90: at every POPULATION EVENT — jump-in (fresh world
// per jumpTo), landing, liftoff and boarding (FUN_00486880@00486c5c,
// FUN_00486ed0@004870b1, FUN_00489d70@0048a75a) — the system makes its
// sÿst+0x64 ambient rolls (raw sÿst+0x64; stock 0-10, median 3) and never
// rolls again while the player just flies around. Each roll routes with
// rand(7): 0 takes the përs branch (FUN_004235c0, pers_plugin), otherwise
// rand(7)==0 takes the flët branch (FUN_00425280, fleet_plugin), otherwise
// the DÛDE branch (FUN_0041ba80) — 36/49 of rolls, the dominant spawner.
// Before the rolls, the sÿst "Peripherals" përs pairs each warp in on
// rand(100)+1 <= percent.
//
// The dûde branch is why stock systems don't melee: a dûde's ships all
// carry the DÛDE's government, and a system's dûde table is its own
// population. The govt-eligibility gate the port once layered on global
// fleet/përs draws is gone — fleet/përs keep their true 6/49 + 1/7 share
// with pure linkSyst/activateOn/dead eligibility.
//
// A per-frame despawn (FUN_004687b0, approximated) silently removes
// ambient ships that get too far from the player, so population decays
// between events like the binary's.

import { DudeData } from "novadatainterface/DudeData";
import { FleetData } from "novadatainterface/FleetData";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { PersData } from "novadatainterface/PersData";
import { ShipData } from "novadatainterface/ShipData";
import { SystemData } from "novadatainterface/SystemData";
import { AsyncSystem } from "nova_ecs/async_system";
import { Entities, GetWorld, RunQuery, UUID } from "nova_ecs/arg_types";
import { Position } from "nova_ecs/datatypes/position";
import { EntityMap } from "nova_ecs/entity_map";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Plugin } from "nova_ecs/plugin";
import { Optional } from "nova_ecs/optional";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent, World } from "nova_ecs/world";
import { MissionEnv } from "../missions/mission_state_machine";
import { MissionEnvResource } from "../missions/mission_plugin";
import { PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { randInt, seedRng } from "../player/pilot_files";
import { BoardedEvent } from "./interaction_events";
import {
    AMBIENT_GATE,
    AmbientSeedResource,
    ambientShipCount,
    FLEET_TABLE_SLOTS,
    fleetActive,
    FleetQuotesResource,
    MAX_AMBIENT_SHIPS,
    playerPosition,
    spawnFleet,
} from "./fleet_plugin";
import { makeDudeShip, weightedPick } from "./dude";
import { GameDataResource } from "./game_data_resource";
import { PERS_TABLE_ROLL, persActive, spawnPersShip, weaponOutfitMap } from "./pers_plugin";
import { LandEvent, LiftoffEvent } from "./planet_plugin";
import { ShipDataComponent } from "./ship_plugin";
import { SystemIdResource } from "./system_id_resource";

// How many population bursts are queued. 1 at world build covers the
// jump-in (a fresh world is built per jump); landing, liftoff and boarding
// each queue one more.
export const PopulateResource =
    new Resource<{ pending: number }>('PopulateResource');

// Monotonic counter for dude-ship entity keys (the binary reuses its freed
// ship slots; the port needs unique keys).
const DudeCounterResource = new Resource<{ next: number }>('DudeCounterResource');

// FUN_0041ba80 searches ship slots 1..55 only (0x40 - its slot parameter;
// the player owns slot 0 and slots 56-63 are engine-reserved), counting
// every ship of the system. The port's equivalent of an occupied slot is a
// ship entity key (mission ships, escorts and ambient ships all share the
// slots; planets and the player use other keys).
export const DUDE_SLOT_LIMIT = 55;

const SHIP_SLOT_PREFIXES = [
    "mission-ship ", "escort ", "fleet-ship ", "pers-ship ", "dude-ship ",
];

export function shipSlotCount(entities: EntityMap): number {
    let count = 0;
    for (const key of entities.keys()) {
        if (SHIP_SLOT_PREFIXES.some(prefix => key.startsWith(prefix))) {
            count++;
        }
    }
    return count;
}

// FUN_0041ba80 — the dominant dûde branch: weighted-pick a dûde entry from
// the sÿst's 8 (dûde, count) pairs (FUN_0046b600), then a (ship class,
// count) pair from the dûde's 16 pairs (FUN_0046b4b0), and spawn ONE ship
// of that class. The ship carries the DÛDE's government and AI
// (makeDudeShip) — never the ship class's inherent government; flët ships
// likewise carry the FLËT's govt (FUN_004259b0). Ambient ships are
// single-faction — that is the melee fix.
async function spawnDudeAmbient(gameData: GameDataInterface,
    entities: EntityMap, world: World, systemData: SystemData,
    origin: Position): Promise<boolean> {
    // Give up when every ship slot the dûde branch searches is taken.
    if (shipSlotCount(entities) >= DUDE_SLOT_LIMIT) {
        return false;
    }

    const dudeId = weightedPick(
        systemData.dudePairs.map(pair => ({ value: pair.dude, weight: pair.count })));
    if (dudeId === null) {
        return false;
    }

    let dude: DudeData;
    try {
        dude = await gameData.data.Dude.get(dudeId);
    }
    catch {
        console.warn(`[ambient] unknown düde ${dudeId} (sÿst ${systemData.id})`);
        return false;
    }

    const shipId = weightedPick(
        dude.shipTypes.map(entry => ({ value: entry.ship, weight: entry.probability })));
    if (shipId === null) {
        return false;
    }

    let shipData: ShipData;
    try {
        shipData = await gameData.data.Ship.get(shipId);
    }
    catch {
        console.warn(`[ambient] unknown shïp ${shipId} (düde ${dude.id})`);
        return false;
    }

    const ship = makeDudeShip(dude, shipData);
    // FUN_0041ba80's rand(1500)-750 x/y scatter around the player, on the
    // shared engine LCG like the binary's.
    const movement = ship.components.get(MovementStateComponent)!;
    movement.position = new Position(origin.x + randInt(1500) - 750,
        origin.y + randInt(1500) - 750);
    ship.components.set(MovementStateComponent, movement);

    const counter = world.resources.get(DudeCounterResource)!;
    entities.set(`dude-ship ${dude.id} ${counter.next++}`, ship);
    return true;
}

// The sÿst Peripherals përs (FUN_0041af90's peripheral loop): each listed
// përs that is alive and active here warps in when rand(100)+1 lands
// within its percent (64/545 stock systems have any).
async function spawnPeripherals(gameData: GameDataInterface, env: MissionEnv,
    state: PlayerState, systemId: string, systemData: SystemData,
    entities: EntityMap, origin: Position,
    outfits: () => Promise<Map<string, string>>): Promise<void> {
    for (const { pers: persId, percent } of systemData.persPeripherals) {
        let pers: PersData;
        try {
            pers = await gameData.data.Pers.get(persId);
        }
        catch {
            console.warn(`[ambient] unknown përs ${persId} (sÿst ${systemData.id})`);
            continue;
        }
        // Dead and deactivated përs never respawn.
        if ((state.pers[persId]?.status ?? "alive") !== "alive") {
            continue;
        }
        if (!persActive(pers, state, systemId, systemData, env)) {
            continue;
        }
        // FUN_0041af90: rand(100)+1 <= percent (percent 100 always spawns).
        if (randInt(100) + 1 > percent) {
            continue;
        }
        // 64-slot bound: with no free slot, the spawn gives up.
        if (ambientShipCount(entities) >= MAX_AMBIENT_SHIPS) {
            continue;
        }
        await spawnPersShip(gameData, entities, pers, state,
            await outfits(), origin);
    }
}

// The përs branch (FUN_004235c0): scan every përs for eligibility (alive,
// LinkSyst matches, ActiveOn passes), then draw ONE index with rand(1022)
// into the 1024-slot përs table; if the drawn slot is eligible, exactly
// that përs warps in. An empty eligible table draws nothing (the port's
// documented draw-count convention).
async function spawnPersRoll(gameData: GameDataInterface, env: MissionEnv,
    state: PlayerState, systemId: string, systemData: SystemData,
    entities: EntityMap, origin: Position, ids: string[],
    outfits: () => Promise<Map<string, string>>): Promise<void> {
    const matching: PersData[] = [];
    for (const persId of ids) {
        let pers: PersData;
        try {
            pers = await gameData.data.Pers.get(persId);
        }
        catch {
            continue;
        }
        if ((state.pers[persId]?.status ?? "alive") !== "alive") {
            continue;
        }
        if (!persActive(pers, state, systemId, systemData, env)) {
            continue;
        }
        if (!pers.shipType) {
            continue;
        }
        matching.push(pers);
    }
    if (matching.length === 0
        || ambientShipCount(entities) >= MAX_AMBIENT_SHIPS) {
        return;
    }
    if (randInt(PERS_TABLE_ROLL) < matching.length) {
        await spawnPersShip(gameData, entities,
            matching[randInt(matching.length)], state,
            await outfits(), origin);
    }
}

// The flët branch (FUN_00425280): scan every flët for eligibility (exists,
// LinkSyst matches, ActivateOn passes, atmosphere approximation), then
// draw ONE index into the 256-slot flët table; if the drawn slot is
// eligible, that whole flët (lead ship + escort groups) warps in. An empty
// eligible table draws nothing.
async function spawnFleetRoll(gameData: GameDataInterface, env: MissionEnv,
    state: PlayerState, systemId: string, systemData: SystemData,
    entities: EntityMap, origin: Position, ids: string[],
    world: World): Promise<void> {
    const matching: FleetData[] = [];
    for (const fleetId of ids) {
        let fleet: FleetData;
        try {
            fleet = await gameData.data.Fleet.get(fleetId);
        }
        catch {
            continue;
        }
        if (fleetActive(fleet, state, systemId, systemData, env)) {
            matching.push(fleet);
        }
    }
    if (matching.length === 0
        || ambientShipCount(entities) >= MAX_AMBIENT_SHIPS) {
        return;
    }
    if (randInt(FLEET_TABLE_SLOTS) < matching.length) {
        const quotes = await spawnFleet(gameData, env, entities,
            matching[randInt(matching.length)], origin);
        const fleetQuotes = world.resources.get(FleetQuotesResource);
        if (fleetQuotes) {
            fleetQuotes.push(...quotes);
        }
    }
}

const PopulateSystem = new AsyncSystem({
    name: 'PopulateSystem',
    args: [GameDataResource, SystemIdResource, Entities, GetWorld, RunQuery,
        SingletonComponent] as const,
    exclusive: true,
    async step(gameData, systemId, entities, world, runQuery) {
        // One burst per population event. The pending counter is read and
        // decremented on the LIVE resource (not the immer draft): the
        // land/liftoff/boarding systems increment it between runs, and a
        // draft patch would clobber their increments.
        const pending = world.resources.get(PopulateResource);
        if (!pending || pending.pending <= 0) {
            return;
        }
        pending.pending--;

        const state = world.resources.get(PlayerStateResource);
        const env = world.resources.get(MissionEnvResource);
        if (!state || !env) {
            return;
        }
        // One seed per system entry; every burst's draws advance the same
        // stream (the engine's stream is global and continuous; see
        // pilot_files).
        const seeded = world.resources.get(AmbientSeedResource);
        if (seeded && !seeded.val) {
            seedRng(state.rngSeed);
            seeded.val = true;
        }
        const systemData = env.system(systemId);
        if (!systemData) {
            return;
        }
        const origin = playerPosition(runQuery);

        // Weapon->outfit map for përs spawns, computed at most once per
        // burst.
        let outfitsPromise: Promise<Map<string, string>> | null = null;
        const outfits = () => outfitsPromise ??= weaponOutfitMap(gameData);

        // FUN_0041af90: first the peripheral loop, then the sÿst+0x64
        // three-way rolls.
        await spawnPeripherals(gameData, env, state, systemId, systemData,
            entities, origin, outfits);

        const ids = await gameData.ids;
        for (let i = 0; i < systemData.ambientRollCount; i++) {
            if (randInt(AMBIENT_GATE) === 0) {
                await spawnPersRoll(gameData, env, state, systemId,
                    systemData, entities, origin, ids.Pers, outfits);
                continue;
            }
            if (randInt(AMBIENT_GATE) === 0) {
                await spawnFleetRoll(gameData, env, state, systemId,
                    systemData, entities, origin, ids.Fleet, world);
                continue;
            }
            await spawnDudeAmbient(gameData, entities, world, systemData,
                origin);
        }
    },
});

// Distance despawn, approximating FUN_004687b0's far test (per-frame
// per-ship in ~41 AI functions): ambient ships too far from the player are
// silently removed — no death event, no përs death, so a despawned përs
// can respawn at a later population event. The binary scales the threshold
// with the ship's top speed (FUN_004637a0 vs consts 100.0/-0.241/0.0),
// with unrecoverable operand units; the port leashes at the larger of a
// fixed floor and top-speed × scale. Fresh spawns (±750 scatter) sit well
// inside the floor.
export const AMBIENT_DESPAWN_MIN_DIST = 2400;
export const AMBIENT_DESPAWN_SPEED_SCALE = 8;

// Ships the ambient systems own (fleet/pës/dûde spawns); mission ships and
// escorts are mission-managed and never despawn here.
function isAmbientKey(key: string): boolean {
    return key.startsWith("fleet-ship ") || key.startsWith("pers-ship ")
        || key.startsWith("dude-ship ");
}

const AmbientShipQuery = new Query([UUID, MovementStateComponent,
    Optional(ShipDataComponent)] as const);

const AmbientDespawnSystem = new System({
    name: 'AmbientDespawnSystem',
    args: [SingletonComponent, RunQuery, Entities] as const,
    step(_singleton, runQuery, entities) {
        const origin = playerPosition(runQuery);
        for (const [uuid, movement, shipData] of runQuery(AmbientShipQuery)) {
            if (!isAmbientKey(uuid)) {
                continue;
            }
            const leash = Math.max(AMBIENT_DESPAWN_MIN_DIST,
                (shipData?.physics.speed ?? 0) * AMBIENT_DESPAWN_SPEED_SCALE);
            if (movement.position.subtract(origin).lengthSquared
                > leash * leash) {
                entities.delete(uuid);
            }
        }
    },
});

// Landing, liftoff and boarding each queue one population burst. Three
// systems because an event data arg only resolves while that event is the
// one being run.
function queuePopulate(world: World): void {
    const pending = world.resources.get(PopulateResource);
    if (pending) {
        pending.pending++;
    }
}

const PopulateOnLandSystem = new System({
    name: 'PopulateOnLandSystem',
    events: [LandEvent],
    args: [LandEvent, GetWorld] as const,
    step(_event, world) {
        queuePopulate(world);
    },
});

const PopulateOnLiftoffSystem = new System({
    name: 'PopulateOnLiftoffSystem',
    events: [LiftoffEvent],
    args: [LiftoffEvent, GetWorld] as const,
    step(_event, world) {
        queuePopulate(world);
    },
});

const PopulateOnBoardedSystem = new System({
    name: 'PopulateOnBoardedSystem',
    events: [BoardedEvent],
    args: [BoardedEvent, GetWorld] as const,
    step(_event, world) {
        queuePopulate(world);
    },
});

// Owns the population event: FUN_0041af90's burst, the event
// subscriptions and the distance despawn.
export const AmbientPlugin: Plugin = {
    name: 'AmbientPlugin',
    build(world) {
        world.resources.set(PopulateResource, { pending: 1 });
        world.resources.set(AmbientSeedResource, { val: false });
        world.resources.set(DudeCounterResource, { next: 0 });
        world.addSystem(PopulateSystem);
        world.addSystem(PopulateOnLandSystem);
        world.addSystem(PopulateOnLiftoffSystem);
        world.addSystem(PopulateOnBoardedSystem);
        world.addSystem(AmbientDespawnSystem);
    },
};
