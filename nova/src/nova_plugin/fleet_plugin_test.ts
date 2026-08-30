// Headless World specs for the flët spawn draw and hyperspace-entry quote
// (ported from FUN_00425280/FUN_004259b0): a flët only spawns in a system
// with at least one inhabited planet, ONE index is drawn into the 256-slot
// flët table per entry (hit iff the drawn slot is eligible), and the Quote
// STR# (with '#' replaced by random digits) lands on FleetQuotesResource
// for a future message surface. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/fleet_plugin_test.ts \
//       --outfile=/tmp/fleet_plugin_test.js && node_modules/.bin/jasmine /tmp/fleet_plugin_test.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { FleetData, getDefaultFleetData } from "novadatainterface/FleetData";
import { getDefaultStringSetData } from "novadatainterface/StringSetData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { World } from "nova_ecs/world";
import { randInt, seedRng } from "../player/pilot_files";
import { GameDataResource } from "./game_data_resource";
import { SystemIdResource } from "./system_id_resource";
import { FleetPlugin, FleetQuotesResource } from "./fleet_plugin";
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

// Mirrors the plugin's warp-in draw (FUN_00425280: one rand(256) draw per
// system entry) so the specs can pick state seeds that deterministically
// land on either side of the draw.
function spawnHit(seed: number, eligible: number): boolean {
    seedRng(seed);
    return randInt(0x100) < eligible;
}

function findSeed(eligible: number, wantHit: boolean): number {
    for (let seed = 1; seed < 50_000; seed++) {
        if (spawnHit(seed, eligible) === wantHit) {
            return seed;
        }
    }
    throw new Error("no pilot seed found for the requested draw side");
}

// Builds a system world for the given system id and runs one spawn pass.
// `fleets` replaces the default single-fleet fixture (each spawns its lead
// ship only, so one fleet-ship entity per spawned flët).
async function makeTestWorld(systemId: string,
    fleets?: Array<[string, FleetData]>, playerState?: PlayerState) {
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
    // AsyncSystem applies its immer patches on the run after the async step
    // finishes, so a second world.step() (the game loop's next frame) is
    // what actually lands the spawned entities in the world.
    world.step();
    await flush();
    world.step();
    await flush();
    return {
        world,
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

    it("spawns at most one flët per system entry (one table draw)", async () => {
        // FUN_00425280 draws ONE slot per call: a hit warps in exactly one
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
