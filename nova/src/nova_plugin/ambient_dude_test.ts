// Headless World specs for the dûde branch (FUN_0041ba80) and the
// population-event wiring of AmbientPlugin: the total-weight picks and
// their determinism, dûde-government tagging on spawned ships (the
// no-melee invariant — never the ship class's inherent government), the
// 36/49 dominant routing share, the DUDE_SLOT_LIMIT=55 slot bound, the
// exact-shares burst (each roll of the always-spawning fixtures lands one
// ship), zero spawns on plain frames, the sÿst Peripherals përs, and one
// burst per LandEvent/LiftoffEvent/BoardedEvent. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/ambient_dude_test.ts \
//       --outfile=/tmp/ambient_dude_test.js && node_modules/.bin/jasmine /tmp/ambient_dude_test.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultDudeData } from "novadatainterface/DudeData";
import { getDefaultFleetData } from "novadatainterface/FleetData";
import { getDefaultPersData } from "novadatainterface/PersData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { Entity } from "nova_ecs/entity";
import { EcsEvent } from "nova_ecs/events";
import { World } from "nova_ecs/world";
import { randInt, seedRng } from "../player/pilot_files";
import { weightedPick } from "./dude";
import { AmbientPlugin, DUDE_SLOT_LIMIT } from "./ambient_plugin";
import { GameDataResource } from "./game_data_resource";
import { SystemIdResource } from "./system_id_resource";
import { MissionEnvResource } from "../missions/mission_plugin";
import {
    makePlayerState,
    makeTestEnv,
    SYSTEMS,
} from "../missions/test_fixtures";
import { PlayerStateResource } from "../player/player_state_component";
import { BoardedEvent } from "./interaction_events";
import { LandEvent, LiftoffEvent } from "./planet_plugin";
import { GovernmentComponent } from "./npc_plugin";
import { AIConfigComponent } from "./npc_ai_plugin";

const SHIP_ID = "nova:600";
const DUDE_ID = "nova:128"; // the stock Federation dûde's id band
const PERS_ID = "nova:131";

// The dûde's govt (Federation) differs from the ship class's inherent
// govt (Polaris, the fixtures' mutual enemy): a spawned ship must carry
// the DÛDE's government.
const SHIP = {
    ...getDefaultShipData(),
    id: SHIP_ID,
    name: "Test Ship",
    inherentGovt: "nova:130",
    inherentAI: 2,
};

const DUDE = {
    ...getDefaultDudeData(),
    id: DUDE_ID,
    name: "Federation Patroller",
    govt: "nova:128",
    aiType: 4,
    shipTypes: [{ ship: SHIP_ID, probability: 100 }],
};

// Fresh system id so the shared fixture map stays untouched otherwise.
// ambientRollCount/dudePairs/persPeripherals are adjusted per spec.
const DUDE_SYSTEM = "nova:308";

function setSystem(overrides: Partial<{ rollCount: number,
    peripheralPercent: number | null }> = {}): void {
    SYSTEMS.set(DUDE_SYSTEM, {
        ...SYSTEMS.get("nova:300")!,
        id: DUDE_SYSTEM,
        links: [],
        planets: ["nova:130"],
        ambientRollCount: overrides.rollCount ?? 3,
        dudePairs: [{ dude: DUDE_ID, count: 100 }],
        persPeripherals: overrides.peripheralPercent === null ? [] :
            [{ pers: PERS_ID, percent: overrides.peripheralPercent ?? 100 }],
    });
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

interface WorldHandles {
    world: World;
    stepFrames: (n: number) => Promise<void>;
    emit: (event: EcsEvent<any, any>) => Promise<void>;
    ambientKeys: (prefix?: string) => string[];
}

// Builds a world around the dûde fixtures and runs the build burst.
// `fleets` registers that many always-eligible flëts (lead ship only)
// BEFORE the build burst.
async function makeTestWorld(state = makePlayerState(7),
    extraPers = 0, fleets = 0, preShipKeys: string[] = []):
    Promise<WorldHandles> {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);
    gameData.data.Dude.map.set(DUDE_ID, DUDE);
    gameData.data.Pers.map.set(PERS_ID, {
        ...getDefaultPersData(),
        id: PERS_ID,
        name: "Peripheral Përs",
        linkSyst: -1,
        shipType: SHIP_ID,
    });
    for (let i = 0; i < extraPers; i++) {
        const id = `nova:${400 + i}`;
        gameData.data.Pers.map.set(id, {
            ...getDefaultPersData(),
            id,
            name: `Përs ${i}`,
            linkSyst: -1,
            shipType: SHIP_ID,
        });
    }
    for (let i = 0; i < fleets; i++) {
        const id = `nova:${700 + i}`;
        gameData.data.Fleet.map.set(id, {
            ...getDefaultFleetData(),
            id,
            name: `Fleet ${i}`,
            leadShipType: SHIP_ID,
        });
    }

    const { env } = makeTestEnv();
    const world = new World();
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource, DUDE_SYSTEM);
    world.resources.set(PlayerStateResource, state);
    world.resources.set(MissionEnvResource, env);
    world.addPlugin(AmbientPlugin);
    world.entities.set("player", new Entity("player"));
    for (const key of preShipKeys) {
        world.entities.set(key, new Entity("dummy"));
    }
    world.step();
    await flush();
    world.step();
    await flush();
    const ambientKeys = (prefix = "-ship ") => [...world.entities.keys()]
        .filter(key => key.includes(prefix));
    return {
        world,
        stepFrames: async (n: number) => {
            for (let i = 0; i < n; i++) {
                world.step();
                await flush();
            }
        },
        emit: async (event: EcsEvent<any, any>) => {
            world.emit(event, { id: "nova:130", uuid: "player" }, ["player"]);
            await flush();
        },
        ambientKeys,
    };
}

describe("weightedPick (FUN_0046b600/4b0)", () => {
    const entries = [
        { value: "a", weight: 30 },
        { value: "b", weight: 70 },
    ];

    it("is deterministic under a fixed seed", () => {
        const draw = () => [...Array(20)].map(() => weightedPick(entries));
        seedRng(1234);
        const first = draw();
        seedRng(1234);
        expect(draw()).toEqual(first);
    });

    it("follows the weight proportions", () => {
        seedRng(42);
        const counts = new Map<string, number>();
        const rolls = 20000;
        for (let i = 0; i < rolls; i++) {
            const picked = weightedPick(entries)!;
            counts.set(picked, (counts.get(picked) ?? 0) + 1);
        }
        expect(counts.get("a")! / rolls).toBeCloseTo(0.3, 2);
        expect(counts.get("b")! / rolls).toBeCloseTo(0.7, 2);
    });

    it("draws nothing when the total weight is under 1", () => {
        // The stream did not advance: the draw after the null pick is the
        // same draw a fresh stream gives.
        seedRng(5);
        const baseline = randInt(1000);
        seedRng(5);
        expect(weightedPick([
            { value: "a", weight: 0 },
            { value: "b", weight: -3 },
        ])).toBeNull();
        expect(randInt(1000)).toEqual(baseline);
    });

    it("skips empty slots and non-positive weights", () => {
        seedRng(6);
        for (let i = 0; i < 100; i++) {
            expect(weightedPick([
                { value: null, weight: 50 },
                { value: "real", weight: 50 },
                { value: "dead", weight: 0 },
            ])).toEqual("real");
        }
    });
});

describe("dûde spawn (FUN_0041ba80)", () => {
    it("tags spawned ships with the DÛDE's government, never the ship's"
        + " inherent government", async () => {
        // The no-melee invariant: the fixtures' dûde is Federation, its
        // ship class inherently Polaris. Federation and Polaris are mutual
        // enemies, so an inherent-govt tag would melee every Fed system.
        setSystem();
        let dudeShips = 0;
        for (let seed = 1; seed <= 25; seed++) {
            const { world, ambientKeys } =
                await makeTestWorld(makePlayerState(seed));
            for (const key of ambientKeys("dude-ship ")) {
                dudeShips++;
                const ship = world.entities.get(key)!;
                expect(ship.components.get(GovernmentComponent)!.id)
                    .toEqual("nova:128");
            }
        }
        expect(dudeShips).toBeGreaterThan(0);
    });

    it("spawns with the dûde's AI, falling back to the ship's inherent AI"
        + " only for aiType 0", async () => {
        setSystem();
        const { world, ambientKeys } = await makeTestWorld();
        const key = ambientKeys("dude-ship ")[0];
        expect(key).toBeDefined();
        expect(world.entities.get(key)!.components.get(AIConfigComponent))
            .toEqual({ aiType: 4, aggress: 2, coward: null });
    });

    it("respects DUDE_SLOT_LIMIT=55 across all ship keys", async () => {
        setSystem({ peripheralPercent: null });
        // Every occupied ship slot (mission ships, escorts, other ambient
        // ships) counts against the dûde branch's 1..55 search — escorts
        // included, so the count is over all non-player entity keys.
        const preShipKeys = [...Array(DUDE_SLOT_LIMIT)]
            .map((_, i) => `escort ${i}`);
        const { world, ambientKeys } = await makeTestWorld(
            makePlayerState(11), 0, 0, preShipKeys);
        expect(ambientKeys("dude-ship ")).toEqual([]);
        const otherKeys = [...world.entities.keys()]
            .filter(key => key !== "player" && key !== "singleton");
        expect(otherKeys.length).toEqual(DUDE_SLOT_LIMIT);
    });

    it("lands one ship per roll (caps never throttle a stock burst)",
        async () => {
            // 1022 eligible përs and 256 eligible flëts make the përs and
            // flët table draws always hit, and the dûde table always
            // spawns: every roll lands exactly one ship. rollCount 49
            // keeps the whole burst under the 55/64 slot caps (stock
            // sÿst roll counts are 0-10, median 3 — a burst must never
            // throttle at those).
            setSystem({ rollCount: 49, peripheralPercent: null });
            let total = 0;
            const seeds = 6;
            for (let seed = 1; seed <= seeds; seed++) {
                const handles = await makeTestWorld(makePlayerState(seed),
                    1022, 256);
                const keys = handles.ambientKeys().length;
                // Fleet re-picks overwrite a duplicate key, so the key
                // count can only fall short of the roll count by the few
                // flët collisions (never by a cap).
                expect(keys).toBeGreaterThanOrEqual(49 - 4);
                total += keys;
            }
            expect(total).toBeGreaterThanOrEqual(seeds * 49 - 4);
        });
});

describe("dûde routing share", () => {
    it("gives the dûde branch its dominant 36/49 share of rolls", async () => {
        // One uncapped burst per seed: 49 rolls < the slot caps, fleets
        // registered before the burst so the flët branch is live.
        setSystem({ rollCount: 49, peripheralPercent: null });
        let dude = 0;
        let pers = 0;
        let fleet = 0;
        const seeds = 6;
        for (let seed = 1; seed <= seeds; seed++) {
            const handles = await makeTestWorld(makePlayerState(seed),
                1022, 256);
            dude += handles.ambientKeys("dude-ship ").length;
            pers += handles.ambientKeys("pers-ship ").length;
            fleet += handles.ambientKeys("fleet-ship ").length;
        }
        const rolls = seeds * 49;
        // One fleet-ship key per spawned flët (lead ship only; a re-pick
        // overwrites the duplicate key, a couple over 294 rolls).
        expect(dude / rolls).toBeCloseTo(36 / 49, 1);
        expect(pers / rolls).toBeCloseTo(1 / 7, 1);
        expect(fleet / rolls).toBeCloseTo(6 / 49, 1);
    });
});

describe("population-event wiring", () => {
    it("spawns nothing on plain frames after the build burst", async () => {
        setSystem({ peripheralPercent: null });
        const { ambientKeys, stepFrames } = await makeTestWorld();
        const afterBurst = ambientKeys().length;
        expect(afterBurst).toBeGreaterThan(0);
        await stepFrames(60);
        expect(ambientKeys().length).toEqual(afterBurst);
    });

    for (const [name, event] of [
        ["LandEvent", LandEvent],
        ["LiftoffEvent", LiftoffEvent],
        ["BoardedEvent", BoardedEvent],
    ] as const) {
        it(`queues exactly one burst per ${name}`, async () => {
            setSystem({ rollCount: 3, peripheralPercent: null });
            // 1022 përs + 256 flëts make every branch's table draw hit, so
            // each of the burst's 3 rolls lands exactly one ship whatever
            // the routing.
            const { emit, ambientKeys, stepFrames } = await makeTestWorld(
                makePlayerState(7), 1022, 256);
            const afterBurst = ambientKeys().length;
            await emit(event);
            // Step 1 runs the queued event's burst; step 2 lands its
            // spawn patches (AsyncSystem applies them one run later).
            await stepFrames(2);
            const afterEvent = ambientKeys().length;
            // The burst's 3 rolls all hit the always-spawning dûde table.
            expect(afterEvent - afterBurst).toEqual(3);
            // No further spawns without another event.
            await stepFrames(5);
            expect(ambientKeys().length).toEqual(afterEvent);
        });
    }

    it("queues one burst per event across land, liftoff and boarding",
        async () => {
            setSystem({ rollCount: 1, peripheralPercent: null });
            // Every roll spawns exactly one ship whatever the routing
            // (always-hit tables).
            const { emit, ambientKeys, stepFrames } = await makeTestWorld(
                makePlayerState(7), 1022, 256);
            let expected = ambientKeys().length;
            for (const event of [LandEvent, LiftoffEvent, BoardedEvent]) {
                await emit(event);
                await stepFrames(2);
                expected += 1;
                expect(ambientKeys().length).toEqual(expected);
            }
        });
});

describe("sÿst Peripherals përs", () => {
    it("warps the listed përs in at percent 100, once (deduped)", async () => {
        setSystem({ peripheralPercent: 100 });
        const { ambientKeys, stepFrames } = await makeTestWorld();
        expect(ambientKeys("pers-ship ")).toEqual([`pers-ship ${PERS_ID}`]);
        // Later events re-run the loop but the living përs is a no-op.
        await stepFrames(1);
        expect(ambientKeys("pers-ship ")).toEqual([`pers-ship ${PERS_ID}`]);
    });

    it("never warps the listed përs in at percent 0", async () => {
        // randInt(100)+1 >= 1 > 0 for every draw: percent 0 never spawns,
        // whatever the seed sweep.
        setSystem({ peripheralPercent: 0, rollCount: 0 });
        for (let seed = 1; seed <= 8; seed++) {
            const { ambientKeys } = await makeTestWorld(makePlayerState(seed));
            expect(ambientKeys("pers-ship ")).toEqual([]);
        }
    });

    it("never respawns a dead peripheral përs", async () => {
        setSystem({ peripheralPercent: 100 });
        const state = makePlayerState(7);
        state.pers[PERS_ID] = { status: "dead", grudge: false, quoteShown: false };
        const { ambientKeys } = await makeTestWorld(state);
        expect(ambientKeys("pers-ship ")).toEqual([]);
    });
});
