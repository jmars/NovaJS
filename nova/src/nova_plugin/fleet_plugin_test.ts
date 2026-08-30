// Headless World specs for the flët ambient spawn draw and hyperspace-entry
// quote (ported from the binary's FUN_0041af90 ambient loop +
// FUN_00425280/FUN_004259b0): a flët only spawns in a system with at least
// one inhabited planet, ONE index is drawn into the 256-slot flët table per
// ambient pass behind FUN_0041af90's rand(7)/rand(7) gates, the passes
// re-roll while the world steps (not only on arrival), the population is
// bounded by the binary's 64 ship slots, and the Quote STR# (with '#'
// replaced by random digits) lands on FleetQuotesResource for a future
// message surface. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/fleet_plugin_test.ts \
//       --outfile=/tmp/fleet_plugin_test.js && node_modules/.bin/jasmine /tmp/fleet_plugin_test.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { FleetData, getDefaultFleetData } from "novadatainterface/FleetData";
import { getDefaultStringSetData } from "novadatainterface/StringSetData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { randInt, seedRng } from "../player/pilot_files";
import { GameDataResource } from "./game_data_resource";
import { SystemIdResource } from "./system_id_resource";
import {
    AMBIENT_GATE,
    FleetPlugin,
    FleetQuotesResource,
    MAX_AMBIENT_SHIPS,
} from "./fleet_plugin";
import { MissionEnvResource } from "../missions/mission_plugin";
import {
    makePlayerState,
    makeTestEnv,
    PLANETS,
    SYSTEMS,
} from "../missions/test_fixtures";
import { PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";

const SHIP_ID = "nova:600";
const FLEET_ID = "nova:900";
const QUOTE_STR = "nova:5000";

// nova:140 "Barren Rock" is the fixtures' only uninhabited planet.
const BARREN_SYSTEM = "nova:304";
const INHABITED_SYSTEM = "nova:305";

const SHIP = { ...getDefaultShipData(), id: SHIP_ID, name: "Test Ship" };
const FLEET = {
    ...getDefaultFleetData(),
    id: FLEET_ID,
    name: "Test Fleet",
    leadShipType: SHIP_ID,
    quote: 5000,
};

// Both gate fixtures share the fixtures map with the other specs, so use
// fresh system ids that nothing else references.
SYSTEMS.set(BARREN_SYSTEM, {
    ...SYSTEMS.get("nova:300")!,
    id: BARREN_SYSTEM,
    links: [],
    planets: ["nova:140"],
});
SYSTEMS.set(INHABITED_SYSTEM, {
    ...SYSTEMS.get("nova:300")!,
    id: INHABITED_SYSTEM,
    links: [],
    planets: ["nova:130"], // START, inhabited.
});

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

// Simulates the plugin's per-pass draws (FUN_0041af90's gates: rand(7)
// missing the përs branch then rand(7) hitting the flët branch, then the
// FUN_00425280 table draw and the uniform pick on a hit) so the specs can
// pick state seeds with known multi-pass outcomes. Returns the picked
// matching index for every hitting pass.
function fleetPasses(seed: number, eligible: number, passes: number):
    number[] {
    seedRng(seed);
    const picks: number[] = [];
    for (let pass = 0; pass < passes; pass++) {
        if (randInt(AMBIENT_GATE) === 0) {
            continue; // përs branch (owned by SpawnPersSystem)
        }
        if (randInt(AMBIENT_GATE) !== 0) {
            continue; // dude branch (not ported)
        }
        if (randInt(0x100) < eligible) {
            picks.push(randInt(eligible));
        }
    }
    return picks;
}

function spawnHit(seed: number, eligible: number): boolean {
    return fleetPasses(seed, eligible, 1).length > 0;
}

function findSeed(eligible: number, wantHit: boolean): number {
    for (let seed = 1; seed < 50_000; seed++) {
        if (spawnHit(seed, eligible) === wantHit) {
            return seed;
        }
    }
    throw new Error("no pilot seed found for the requested draw side");
}

// A seed whose first four ambient passes (frames 0, 30, 60, 90) hit at
// least twice on distinct flëts, for the re-roll spec.
function findMultiHitSeed(eligible: number, passes: number, minUnique: number):
    number {
    for (let seed = 1; seed < 200_000; seed++) {
        const picks = fleetPasses(seed, eligible, passes);
        if (new Set(picks).size >= minUnique) {
            return seed;
        }
    }
    throw new Error("no pilot seed found for the requested multi-pass draw");
}

// Builds a system world for the given system id and runs one spawn pass.
// `fleets` replaces the default single-fleet fixture (each spawns its lead
// ship only, so one fleet-ship entity per spawned flët). `preSpawns` adds
// that many dummy fleet-ship entities before the first step (for the
// 64-slot bound spec).
async function makeTestWorld(systemId: string,
    fleets?: Array<[string, FleetData]>, playerState?: PlayerState,
    preSpawns = 0) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);
    for (const [id, fleet] of fleets ?? [[FLEET_ID, FLEET]]) {
        gameData.data.Fleet.map.set(id, fleet);
    }
    gameData.data.StringSet.map.set(QUOTE_STR, {
        ...getDefaultStringSetData(),
        id: QUOTE_STR,
        name: "Fleet Quotes",
        strings: ["Contact: #-#"],
    });

    const { env } = makeTestEnv();
    const state: PlayerState = playerState ?? makePlayerState();

    const world = new World();
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource, systemId);
    world.resources.set(PlayerStateResource, state);
    world.resources.set(MissionEnvResource, env);
    world.addPlugin(FleetPlugin);
    for (let i = 0; i < preSpawns; i++) {
        world.entities.set(`fleet-ship dummy ${i}`, new Entity("dummy"));
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
        // Steps the world n more frames, flushing between each (the game
        // loop's ticker calls world.step() once per frame).
        stepFrames: async (n: number) => {
            for (let i = 0; i < n; i++) {
                world.step();
                await flush();
            }
        },
        fleetShips: () => [...world.entities.keys()].filter(key =>
            key.startsWith("fleet-ship")),
        quotes: () => world.resources.get(FleetQuotesResource) ?? [],
    };
}

describe("fleet spawn atmosphere gate", () => {
    it("does not spawn in a system with no inhabited planet", async () => {
        const { fleetShips, quotes } = await makeTestWorld(BARREN_SYSTEM,
            undefined, makePlayerState(findSeed(1, true)));
        expect(fleetShips()).toEqual([]);
        expect(quotes()).toEqual([]);
    });

    it("spawns the drawn flët in a system with an inhabited planet", async () => {
        // One eligible flët: the draw hits iff rand(256) lands on its slot.
        const hit = makePlayerState(findSeed(1, true));
        const { fleetShips } = await makeTestWorld(INHABITED_SYSTEM,
            undefined, hit);
        expect(fleetShips()).toEqual([`fleet-ship ${FLEET_ID} 0`]);

        const miss = makePlayerState(findSeed(1, false));
        expect((await makeTestWorld(INHABITED_SYSTEM,
            undefined, miss)).fleetShips()).toEqual([]);
    });
});

describe("fleet one-draw spawn model", () => {
    // Ten matching flëts (linkSyst -1, no ActivateOn).
    const MANY = 10;
    const manyFleets: Array<[string, FleetData]> = [];
    for (let i = 0; i < MANY; i++) {
        const id = `nova:${910 + i}`;
        manyFleets.push([id, {
            ...getDefaultFleetData(),
            id,
            name: `Fleet ${i}`,
            leadShipType: SHIP_ID,
        }]);
    }

    it("spawns at most one flët per pass (one table draw)", async () => {
        // FUN_00425280 draws ONE slot per pass: a hit warps in exactly one
        // whole flët no matter how many are eligible.
        const hit = makePlayerState(findSeed(MANY, true));
        const { fleetShips } = await makeTestWorld(INHABITED_SYSTEM,
            manyFleets, hit);
        expect(fleetShips().length).toEqual(1);

        const miss = makePlayerState(findSeed(MANY, false));
        const none = await makeTestWorld(INHABITED_SYSTEM, manyFleets, miss);
        expect(none.fleetShips()).toEqual([]);
    });

    it("picks the same flët for the same pilot state", async () => {
        const state = makePlayerState(findSeed(MANY, true));
        const first = await makeTestWorld(INHABITED_SYSTEM, manyFleets, state);
        const second = await makeTestWorld(INHABITED_SYSTEM, manyFleets, state);
        expect(first.fleetShips()).toEqual(second.fleetShips());
    });
});

describe("fleet ambient re-roll over time", () => {
    // Ten matching flëts; ids are nova:910..919 in matching order, so pick
    // index i is fleet nova:(910 + i) (MockGameData exposes ids in map
    // insertion order).
    const MANY = 10;
    const manyFleets: Array<[string, FleetData]> = [];
    for (let i = 0; i < MANY; i++) {
        const id = `nova:${910 + i}`;
        manyFleets.push([id, {
            ...getDefaultFleetData(),
            id,
            name: `Fleet ${i}`,
            leadShipType: SHIP_ID,
        }]);
    }

    it("re-rolls the draw on later frames and lands the mirrored picks",
        async () => {
            // Four passes at frames 0, 30, 60, 90 (makeTestWorld already
            // ran frames 0 and 1; step 89 more to reach frame 90).
            const PASSES = 4;
            const seed = makePlayerState(
                findMultiHitSeed(MANY, PASSES, 2)).rngSeed;
            const { fleetShips, stepFrames } = await makeTestWorld(
                INHABITED_SYSTEM, manyFleets, makePlayerState(seed));
            expect(fleetShips().length).toEqual(1);

            await stepFrames(89);

            // The engine LCG advances across passes (seeded once per system
            // entry), so later passes spawn more flëts — exactly the ones
            // the mirrored draw sequence picks.
            const picks = fleetPasses(seed, MANY, PASSES);
            expect(new Set(picks).size).toBeGreaterThanOrEqual(2);
            const expected = [...new Set(picks)]
                .map(pick => `fleet-ship nova:${910 + pick} 0`).sort();
            expect(fleetShips().sort()).toEqual(expected);
        });
});

describe("fleet 64-slot bound", () => {
    it("does not spawn once 64 ambient ships are in the system", async () => {
        // A seed whose first pass hits: the cap, not the draw, must block
        // the spawn.
        const hit = makePlayerState(findSeed(1, true));
        const { fleetShips, quotes } = await makeTestWorld(INHABITED_SYSTEM,
            undefined, hit, MAX_AMBIENT_SHIPS);
        expect(fleetShips().length).toEqual(MAX_AMBIENT_SHIPS);
        expect(fleetShips().every(key => key.startsWith("fleet-ship dummy")))
            .toBeTrue();
        expect(quotes()).toEqual([]);
    });
});

describe("fleet hyperspace-entry quote", () => {
    it("resolves the Quote STR# with digits for '#'", async () => {
        const { quotes } = await makeTestWorld(INHABITED_SYSTEM,
            undefined, makePlayerState(findSeed(1, true)));
        expect(quotes().length).toEqual(1);
        // FUN_004259b0: the first '#' of each run becomes 1-9 ("#-#" is two
        // runs, so both digits are 1-9); only a directly following '#' in
        // the same run rolls 0-9.
        expect(quotes()[0]).toMatch(/^Contact: [1-9]-[1-9]$/);
    });

    it("is deterministic for the same pilot state", async () => {
        const state = makePlayerState(findSeed(1, true));
        const first = await makeTestWorld(INHABITED_SYSTEM, undefined, state);
        const second = await makeTestWorld(INHABITED_SYSTEM, undefined, state);
        expect(first.quotes()).toEqual(second.quotes());
    });
});
