// Headless World specs for përs spawn + persistence (P3): the seeded 5%
// warp-in roll and its determinism, the LinkSyst and ActiveOn gates, the
// dead/deactivated persistence rule, death/grudge bookkeeping, and what
// the spawned ship carries (name, AI config, weapons, ShieldMod). Run
// with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/pers_test.ts \
//       --outfile=/tmp/pers_test.js && node_modules/.bin/jasmine /tmp/pers_test.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultOutfitData } from "novadatainterface/OutiftData";
import { PersData, getDefaultPersData } from "novadatainterface/PersData";
import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { MissionEnvResource } from "../missions/mission_plugin";
import {
    makePlayerState,
    makeTestEnv,
    setBit,
} from "../missions/test_fixtures";
import { PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { makeRng } from "../player/pilot_files";
import { CollisionVulnerabilityComponent } from "./collision_interaction";
import { DamagedEvent, DeathEvent } from "./death_plugin";
import { AIConfigComponent } from "./npc_ai_plugin";
import { DeathAISystem } from "./npc_plugin";
import { OutfitsStateComponent } from "./outfit_plugin";
import { PersComponent, PersPlugin } from "./pers_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ShipDataComponent } from "./ship_plugin";
import { ShieldComponent } from "./health_plugin";
import { GameDataResource } from "./game_data_resource";
import { SystemIdResource } from "./system_id_resource";
import { TargetComponent } from "./target_component";

const SHIP_ID = "nova:600";
// Raw id 131 lands in Jack Folstam's stock band (131-133).
const PERS_ID = "nova:131";
const PERS_RAW_ID = 131;
const SYSTEM_ID = "nova:300";
const SYSTEM_RAW_ID = 300;
const WEAPON_ID = "nova:1500";
const OUTFIT_ID = "nova:1400";

const SHIP: ShipData = {
    ...getDefaultShipData(),
    id: SHIP_ID,
    name: "Test Ship",
    outfits: { [OUTFIT_ID]: 1 },
};

const PERS: PersData = {
    ...getDefaultPersData(),
    id: PERS_ID,
    name: "Jack Folstam",
    linkSyst: -1,
    govt: null,
    aiType: 4,
    aggress: 3,
    coward: 25,
    shipType: SHIP_ID,
    weapTypes: [WEAPON_ID],
    weapCounts: [2],
    shieldMod: 250,
    flags: 0x0001,
};

const DAMAGE = {
    shield: 1, armor: 1, ionization: 0, ionizationColor: 0,
    passThroughShield: 0, knockback: 0,
};

// Mirrors persSpawnSeed in pers_plugin.ts so the specs can pick state
// seeds that deterministically land on either side of the 5% roll.
function spawnRoll(state: PlayerState): number {
    const { day, month, year } = state.date;
    const dayCount = year * 365 + month * 40 + day;
    const seed = (state.rngSeed ^ (PERS_RAW_ID * 0x9E37)
        ^ (SYSTEM_RAW_ID * 0x85EB) ^ (dayCount * 0xC2B2AE35)) >>> 0;
    return makeRng(seed)();
}

function findSeed(predicate: (roll: number) => boolean): number {
    for (let seed = 1; seed < 10_000; seed++) {
        if (predicate(spawnRoll(makePlayerState(seed)))) {
            return seed;
        }
    }
    throw new Error("no pilot seed found for the requested roll side");
}

// State seeds whose përs roll lands below / above the 5% chance.
const SPAWN_SEED = findSeed(roll => roll < 0.05);
const NO_SPAWN_SEED = findSeed(roll => roll >= 0.05);

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

async function makeTestWorld(systemId: string, state: PlayerState,
    persOverrides: Partial<PersData> = {}) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);
    gameData.data.Pers.map.set(PERS_ID, { ...PERS, ...persOverrides });
    gameData.data.Outfit.map.set(OUTFIT_ID, {
        ...getDefaultOutfitData(),
        id: OUTFIT_ID,
        name: "Test Weapon Outfit",
        weapons: { [WEAPON_ID]: 1 },
    });

    const { env } = makeTestEnv();
    const world = new World();
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource, systemId);
    world.resources.set(PlayerStateResource, state);
    world.resources.set(MissionEnvResource, env);
    world.addPlugin(PersPlugin);
    // DeathAISystem is what PersDeathSystem must be able to read the dying
    // ship ahead of (it deletes the entity).
    world.addSystem(DeathAISystem);
    // AsyncSystem applies its immer patches on the run after the async step
    // finishes, so a second world.step() (the game loop's next frame) is
    // what actually lands the spawned entities in the world.
    world.step();
    await flush();
    world.step();
    await flush();
    return {
        world,
        state,
        persShips: () => [...world.entities.keys()].filter(key =>
            key.startsWith("pers-ship")),
        persShip: () => world.entities.get(`pers-ship ${PERS_ID}`)!,
    };
}

function addPlayer(world: World): Entity {
    const player = new Entity("player");
    player.components.set(PlayerShipSelector, undefined);
    world.entities.set("player", player);
    return player;
}

describe("përs spawn", () => {
    it("rolls 5% per warp-in, deterministically from the pilot seed", async () => {
        // Same seed -> same spawn, on both sides of the 5% boundary.
        const first = await makeTestWorld(SYSTEM_ID, makePlayerState(SPAWN_SEED));
        expect(first.persShips()).toEqual([`pers-ship ${PERS_ID}`]);
        const second = await makeTestWorld(SYSTEM_ID, makePlayerState(SPAWN_SEED));
        expect(second.persShips()).toEqual(first.persShips());
        const other = await makeTestWorld(SYSTEM_ID, makePlayerState(NO_SPAWN_SEED));
        expect(other.persShips()).toEqual([]);
    });

    it("only spawns in systems matching LinkSyst", async () => {
        // LinkSyst 300 is the specific system nova:300.
        const matching = await makeTestWorld(SYSTEM_ID,
            makePlayerState(SPAWN_SEED), { linkSyst: SYSTEM_RAW_ID });
        expect(matching.persShips()).toEqual([`pers-ship ${PERS_ID}`]);

        const elsewhere = await makeTestWorld("nova:303",
            makePlayerState(SPAWN_SEED), { linkSyst: SYSTEM_RAW_ID });
        expect(elsewhere.persShips()).toEqual([]);
    });

    it("spawns only when the ActiveOn test passes", async () => {
        const state = makePlayerState(SPAWN_SEED);
        const blocked = await makeTestWorld(SYSTEM_ID, state, { activeOn: "b350" });
        expect(blocked.persShips()).toEqual([]);

        setBit(state, 350);
        const allowed = await makeTestWorld(SYSTEM_ID, state, { activeOn: "b350" });
        expect(allowed.persShips()).toEqual([`pers-ship ${PERS_ID}`]);
    });

    it("never respawns a dead or deactivated përs", async () => {
        const dead = makePlayerState(SPAWN_SEED);
        dead.pers[PERS_ID] = { status: "dead", grudge: false, quoteShown: false };
        expect((await makeTestWorld(SYSTEM_ID, dead)).persShips()).toEqual([]);

        const deactivated = makePlayerState(SPAWN_SEED);
        deactivated.pers[PERS_ID] = {
            status: "deactivated", grudge: false, quoteShown: false,
        };
        expect((await makeTestWorld(SYSTEM_ID, deactivated)).persShips())
            .toEqual([]);
    });

    it("builds the ship with the përs's name, AI and weapons", async () => {
        const { persShip } = await makeTestWorld(SYSTEM_ID, makePlayerState(SPAWN_SEED));

        // The përs's name replaces the ship-class name on the target display.
        expect(persShip().components.get(ShipDataComponent)!.name)
            .toEqual("Jack Folstam");
        expect(persShip().components.get(AIConfigComponent)).toEqual(
            { aiType: 4, aggress: 3, coward: 25 });
        expect(persShip().components.get(PersComponent)!.persId).toEqual(PERS_ID);

        // WeapCount 2 on top of the ship's stock 1 of the granting outfit.
        const outfits = persShip().components.get(OutfitsStateComponent)!;
        expect(outfits.get(OUTFIT_ID)).toEqual({ count: 3 });
    });

    it("applies ShieldMod to the ship's shields", async () => {
        const { persShip } = await makeTestWorld(SYSTEM_ID, makePlayerState(SPAWN_SEED));
        // The ship class's shield 100 scaled to 250%.
        const shield = persShip().components.get(ShieldComponent)!;
        expect(shield.max).toEqual(250);
        expect(shield.current).toEqual(250);
        expect(persShip()
            .components.get(CollisionVulnerabilityComponent)).toBeUndefined();

        // A negative ShieldMod makes the përs invincible instead.
        const invincible = await makeTestWorld(SYSTEM_ID,
            makePlayerState(SPAWN_SEED), { shieldMod: -1 });
        const vulnerability = invincible.persShip()
            .components.get(CollisionVulnerabilityComponent)!;
        expect(vulnerability.vulnerableTo.size).toEqual(0);
        expect(invincible.persShip().components.get(ShieldComponent))
            .toBeUndefined();
    });
});

describe("përs persistence", () => {
    it("marks the përs dead when its ship dies", async () => {
        const state = makePlayerState(SPAWN_SEED);
        const { world, persShips } = await makeTestWorld(SYSTEM_ID, state);
        const uuid = persShips()[0];
        expect(uuid).toBeDefined();

        world.emit(DeathEvent, { time: 1, delta_ms: 0, delta_s: 0, frame: 0 },
            [uuid]);
        world.step();
        expect(state.pers[PERS_ID]).toEqual(
            { status: "dead", grudge: false, quoteShown: false });
        // DeathAISystem removed the ship from the world.
        expect(world.entities.has(uuid)).toBeFalse();
    });

    it("latches a persistent grudge when the player damages the përs", async () => {
        const state = makePlayerState(SPAWN_SEED);
        const { world, persShip } = await makeTestWorld(SYSTEM_ID, state);
        const player = addPlayer(world);

        // Damage from someone else does nothing.
        world.emit(DamagedEvent, { damage: DAMAGE, damager: "other-ship" },
            [persShip().uuid]);
        world.step();
        expect(persShip().components.get(PersComponent)!.grudge).toBeFalse();
        expect(state.pers[PERS_ID]).toBeUndefined();

        // The player's damage sets the grudge on the ship and in PlayerState.
        world.emit(DamagedEvent, { damage: DAMAGE, damager: player.uuid },
            [persShip().uuid]);
        world.step();
        expect(persShip().components.get(PersComponent)!.grudge).toBeTrue();
        expect(state.pers[PERS_ID]).toEqual(
            { status: "alive", grudge: true, quoteShown: false });
    });

    it("ignores damage when the përs holds no grudge flag", async () => {
        const state = makePlayerState(SPAWN_SEED);
        const { world, persShip } = await makeTestWorld(SYSTEM_ID, state,
            { flags: 0 });
        const player = addPlayer(world);
        world.emit(DamagedEvent, { damage: DAMAGE, damager: player.uuid },
            [persShip().uuid]);
        world.step();
        expect(persShip().components.get(PersComponent)!.grudge).toBeFalse();
        expect(state.pers[PERS_ID]).toBeUndefined();
    });

    it("a grudged përs hunts the player", async () => {
        const state = makePlayerState(SPAWN_SEED);
        state.pers[PERS_ID] = { status: "alive", grudge: true, quoteShown: false };
        const { world, persShip } = await makeTestWorld(SYSTEM_ID, state);
        const player = addPlayer(world);
        world.step();

        expect(persShip().components.get(TargetComponent)!.target)
            .toEqual(player.uuid);
    });
});
