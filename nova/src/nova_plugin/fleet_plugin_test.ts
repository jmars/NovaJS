// Headless World specs for the flët branch of the ambient population event
// (ported from the binary's FUN_00425280/FUN_004259b0): a flët only spawns
// in a system with at least one inhabited planet, ONE index is drawn into
// the 256-slot flët table per flët roll behind FUN_0041af90's rand(7)
// gates, the rolls run once per population event (the build burst covers
// jump-in; plain frames never re-roll), the population is bounded by the
// binary's 64 ship slots, and the Quote STR# (with '#' replaced by random
// digits) lands on FleetQuotesResource for a future message surface. Run
// with:
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
import { AMBIENT_GATE, FleetPlugin, FleetQuotesResource, MAX_AMBIENT_SHIPS } from "./fleet_plugin";
import { AmbientPlugin } from "./ambient_plugin";
import { LandEvent } from "./planet_plugin";
import { GameDataResource } from "./game_data_resource";
import { SystemIdResource } from "./system_id_resource";
import { MissionEnvResource } from "../missions/mission_plugin";
import {
    makePlayerState,
    makeTestEnv,
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
// fresh system ids that nothing else references. The fixture systems make
// one ambient roll per population event (test_fixtures makeSystem).
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

// Simulates the population event's draws for a fleet-only world
// (FUN_0041af90's routing: rand(7) missing the përs branch — empty here,
// no draws — then rand(7) hitting the flët branch, then the FUN_00425280
// table draw and the uniform pick on a hit; the dûde branch has no dûde
// table and draws nothing) so the specs can pick state seeds with known
// burst outcomes. Returns the picked matching index for every hitting
// roll.
function fleetRolls(seed: number, eligible: number, rolls: number):
    number[] {
    seedRng(seed);
    const picks: number[] = [];
    for (let roll = 0; roll < rolls; roll++) {
        if (randInt(AMBIENT_GATE) === 0) {
            continue; // përs branch (no përs registered: no draws)
        }
        if (randInt(AMBIENT_GATE) !== 0) {
            continue; // dûde branch (no dûde table: no draws)
        }
        if (randInt(0x100) < eligible) {
            picks.push(randInt(eligible));
        }
    }
    return picks;
}

function spawnHit(seed: number, eligible: number): boolean {
    return fleetRolls(seed, eligible, 1).length > 0;
}

function findSeed(eligible: number, wantHit: boolean): number {
    for (let seed = 1; seed < 50_000; seed++) {
        if (spawnHit(seed, eligible) === wantHit) {
            return seed;
        }
    }
    throw new Error("no pilot seed found for the requested draw side");
}

// A seed whose first `rolls` flët rolls hit at least `minUnique` distinct
// flëts, for the multi-event spec.
function findMultiHitSeed(eligible: number, rolls: number, minUnique: number):
    number {
    for (let seed = 1; seed < 200_000; seed++) {
        const picks = fleetRolls(seed, eligible, rolls);
        if (new Set(picks).size >= minUnique) {
            return seed;
        }
    }
    throw new Error("no pilot seed found for the requested multi-roll draw");
}

// Builds a system world for the given system id and runs the build burst.
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
    // FleetPlugin carries the quotes resource; AmbientPlugin owns the
    // population event (the build burst covers the jump-in).
    world.addPlugin(FleetPlugin);
    world.addPlugin(AmbientPlugin);
    // The populate-event systems run per emitted entity; tests that emit
    // LandEvent target this one.
    world.entities.set("player", new Entity("player"));
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
        // Queues one more population event, as a landing does.
        land: () => {
            world.emit(LandEvent, { id: "nova:130", uuid: "player" },
                ["player"]);
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

    it("spawns at most one flët per flët roll (one table draw)", async () => {
        // FUN_00425280 draws ONE slot per roll: a hit warps in exactly one
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

describe("fleet arrival-burst cadence", () => {
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

    it("never re-rolls on plain frames; the next event rolls once more",
        async () => {
            // The build burst (jump-in) rolls once; 90 plain frames add
            // nothing. One LandEvent (a landing) queues exactly one more
            // roll, landing the flët the mirrored draw picks.
            const seed = makePlayerState(
                findMultiHitSeed(MANY, 2, 2)).rngSeed;
            const { land, fleetShips, stepFrames } = await makeTestWorld(
                INHABITED_SYSTEM, manyFleets, makePlayerState(seed));
            expect(fleetShips().length).toEqual(1);

            await stepFrames(90);
            expect(fleetShips().length).toEqual(1);

            land();
            await stepFrames(2);

            // The two events' rolls are consecutive draws on the same
            // stream: exactly the two distinct flëts the mirrored
            // sequence picks.
            const picks = fleetRolls(seed, MANY, 2);
            expect(new Set(picks).size).toBeGreaterThanOrEqual(2);
            const expected = [...new Set(picks)]
                .map(pick => `fleet-ship nova:${910 + pick} 0`).sort();
            expect(fleetShips().sort()).toEqual(expected);
        });
});

describe("fleet 64-slot bound", () => {
    it("does not spawn once 64 ambient ships are in the system", async () => {
        // A seed whose first roll hits: the cap, not the draw, must block
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
