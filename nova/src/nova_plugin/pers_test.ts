// Headless World specs for përs spawn + persistence, ported from the
// binary's FUN_0041af90 ambient loop + FUN_004235c0: the one-draw
// rand(1022) warp-in roll behind FUN_0041af90's rand(7) gate and its
// determinism, the re-roll over later frames, the 64-slot population bound,
// the LinkSyst and ActiveOn gates, the dead/deactivated persistence rule,
// death/grudge bookkeeping, and what the spawned ship carries (name, AI
// config, weapons, ShieldMod). Run with:
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
import { randInt, seedRng } from "../player/pilot_files";
import { AMBIENT_GATE, MAX_AMBIENT_SHIPS } from "./fleet_plugin";
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

// Simulates the plugin's per-pass draws (FUN_0041af90's gate: rand(7)
// hitting the përs branch, then the FUN_004235c0 table draw and the uniform
// pick on a hit) so the specs can pick state seeds with known multi-pass
// outcomes. Returns the picked matching index for every hitting pass.
function persPasses(seed: number, eligible: number, passes: number):
    number[] {
    seedRng(seed);
    const picks: number[] = [];
    for (let pass = 0; pass < passes; pass++) {
        if (randInt(AMBIENT_GATE) !== 0) {
            continue; // flët/dude branches (owned by SpawnFleetsSystem)
        }
        if (randInt(0x3fe) < eligible) {
            picks.push(randInt(eligible));
        }
    }
    return picks;
}

function spawnHit(state: PlayerState, eligible: number): boolean {
    return persPasses(state.rngSeed, eligible, 1).length > 0;
}

function findSeed(eligible: number, wantHit: boolean): number {
    for (let seed = 1; seed < 200_000; seed++) {
        if (spawnHit(makePlayerState(seed), eligible) === wantHit) {
            return seed;
        }
    }
    throw new Error("no pilot seed found for the requested draw side");
}

// A seed whose first four ambient passes (frames 0, 30, 60, 90) hit at
// least twice on distinct përs, for the re-roll spec.
function findMultiHitSeed(eligible: number, passes: number, minUnique: number):
    number {
    for (let seed = 1; seed < 200_000; seed++) {
        const picks = persPasses(seed, eligible, passes);
        if (new Set(picks).size >= minUnique) {
            return seed;
        }
    }
    throw new Error("no pilot seed found for the requested multi-pass draw");
}

// State seeds whose përs draw hits / misses with one eligible përs.
const SPAWN_SEED = findSeed(1, true);
const NO_SPAWN_SEED = findSeed(1, false);

// Extra përs registered for the one-draw spec (with PERS_ID: 60 total),
// all LinkSyst -1 so all of them are eligible.
const MANY_EXTRA = 59;
const MANY_FIRST_RAW_ID = 401;

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

async function makeTestWorld(systemId: string, state: PlayerState,
    persOverrides: Partial<PersData> = {}, extraPers = 0, preSpawns = 0) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);
    gameData.data.Pers.map.set(PERS_ID, { ...PERS, ...persOverrides });
    for (let i = 0; i < extraPers; i++) {
        const rawId = MANY_FIRST_RAW_ID + i;
        gameData.data.Pers.map.set(`nova:${rawId}`, {
            ...PERS, ...persOverrides, id: `nova:${rawId}`,
            name: `Përs ${rawId}`,
        });
    }
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
    for (let i = 0; i < preSpawns; i++) {
        world.entities.set(`pers-ship dummy ${i}`, new Entity("dummy"));
    }
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
        // Steps the world n more frames, flushing between each (the game
        // loop's ticker calls world.step() once per frame).
        stepFrames: async (n: number) => {
            for (let i = 0; i < n; i++) {
                world.step();
                await flush();
            }
        },
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
    it("draws one rand(1022) table slot per warp-in, deterministically from the pilot seed", async () => {
        // Same seed -> same spawn, on both sides of the draw.
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

describe("përs ambient govt gate", () => {
    // nova:300's planet nova:130 (START) is Federation govt nova:128: the
    // fixture graph makes Polaris (nova:130) its mutual enemy, Ally Govt
    // (nova:129) its ally, Vell-os (nova:136) its classmate and Rebels
    // (nova:141) unrelated. A system's ambient population is mostly its
    // own government + civilians, so only those spawn here.
    it("spawns përs of the system's own, allied, classmate or no government",
        async () => {
            for (const govt of [null, "nova:128", "nova:129", "nova:136"]) {
                const { persShips } = await makeTestWorld(SYSTEM_ID,
                    makePlayerState(SPAWN_SEED), { govt });
                expect(persShips()).toEqual([`pers-ship ${PERS_ID}`]);
            }
        });

    it("does not spawn enemy or unrelated-government përs", async () => {
        for (const govt of ["nova:130" /* Polaris: mutual enemy */,
            "nova:141" /* Rebels: unrelated */]) {
            const { persShips } = await makeTestWorld(SYSTEM_ID,
                makePlayerState(SPAWN_SEED), { govt });
            expect(persShips()).toEqual([]);
        }
    });
});

describe("përs one-draw spawn model", () => {
    it("spawns at most one përs per pass (one table draw)", async () => {
        // FUN_004235c0 draws ONE slot per pass: a hit warps in exactly one
        // përs no matter how many are eligible (here 60).
        const hit = findSeed(MANY_EXTRA + 1, true);
        const many = await makeTestWorld(SYSTEM_ID,
            makePlayerState(hit), {}, MANY_EXTRA);
        expect(many.persShips().length).toEqual(1);

        const miss = findSeed(MANY_EXTRA + 1, false);
        const none = await makeTestWorld(SYSTEM_ID,
            makePlayerState(miss), {}, MANY_EXTRA);
        expect(none.persShips()).toEqual([]);
    });

    it("picks the same përs on every pass with the same state", async () => {
        const state = makePlayerState(findSeed(MANY_EXTRA + 1, true));
        const first = await makeTestWorld(SYSTEM_ID, state, {}, MANY_EXTRA);
        const second = await makeTestWorld(SYSTEM_ID, state, {}, MANY_EXTRA);
        expect(second.persShips()).toEqual(first.persShips());
    });
});

describe("përs ambient re-roll over time", () => {
    it("re-rolls the draw on later frames and lands the mirrored picks",
        async () => {
            // Four passes at frames 0, 30, 60, 90 (makeTestWorld already
            // ran frames 0 and 1; step 89 more to reach frame 90). All 60
            // përs are eligible; matching order is insertion order (PERS_ID
            // first, then nova:401..), so pick index 0 is PERS_ID and index
            // i >= 1 is nova:(400 + i).
            const PASSES = 4;
            const seed = findMultiHitSeed(MANY_EXTRA + 1, PASSES, 2);
            const { persShips, stepFrames } = await makeTestWorld(SYSTEM_ID,
                makePlayerState(seed), {}, MANY_EXTRA);
            expect(persShips().length).toEqual(1);

            await stepFrames(89);

            // The engine LCG advances across passes (seeded once per system
            // entry), so later passes spawn more përs — exactly the ones
            // the mirrored draw sequence picks.
            const picks = persPasses(seed, MANY_EXTRA + 1, PASSES);
            expect(new Set(picks).size).toBeGreaterThanOrEqual(2);
            const persIdOf = (pick: number) => pick === 0
                ? PERS_ID : `nova:${MANY_FIRST_RAW_ID + pick - 1}`;
            const expected = [...new Set(picks)]
                .map(pick => `pers-ship ${persIdOf(pick)}`).sort();
            expect(persShips().sort()).toEqual(expected);
        });
});

describe("përs 64-slot bound", () => {
    it("does not spawn once 64 ambient ships are in the system", async () => {
        // A seed whose first pass hits: the cap, not the draw, must block
        // the spawn.
        const { persShips } = await makeTestWorld(SYSTEM_ID,
            makePlayerState(SPAWN_SEED), {}, 0, MAX_AMBIENT_SHIPS);
        expect(persShips().length).toEqual(MAX_AMBIENT_SHIPS);
        expect(persShips().every(key => key.startsWith("pers-ship dummy")))
            .toBeTrue();
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
