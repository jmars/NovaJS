// Headless World specs for the flët spawn atmosphere gate and
// hyperspace-entry quote (P6): a flët only spawns in a system with at
// least one inhabited planet, and its Quote STR# (with '#' replaced by
// random digits) lands on FleetQuotesResource for a future message surface.
// Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/fleet_plugin_test.ts \
//       --outfile=/tmp/fleet_plugin_test.js && node_modules/.bin/jasmine /tmp/fleet_plugin_test.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultFleetData } from "novadatainterface/FleetData";
import { getDefaultStringSetData } from "novadatainterface/StringSetData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { World } from "nova_ecs/world";
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

// Builds a system world for the given system id and runs one spawn pass.
async function makeTestWorld(systemId: string) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);
    gameData.data.Fleet.map.set(FLEET_ID, FLEET);
    gameData.data.StringSet.map.set(QUOTE_STR, {
        ...getDefaultStringSetData(),
        id: QUOTE_STR,
        name: "Fleet Quotes",
        strings: ["Contact: #-#"],
    });

    const { env } = makeTestEnv();
    const state: PlayerState = makePlayerState();

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
        const { fleetShips, quotes } = await makeTestWorld(BARREN_SYSTEM);
        expect(fleetShips()).toEqual([]);
        expect(quotes()).toEqual([]);
    });

    it("spawns in a system with an inhabited planet", async () => {
        const { fleetShips } = await makeTestWorld(INHABITED_SYSTEM);
        expect(fleetShips()).toEqual([`fleet-ship ${FLEET_ID} 0`]);
    });
});

describe("fleet hyperspace-entry quote", () => {
    it("resolves the Quote STR# with digits for '#'", async () => {
        const { quotes } = await makeTestWorld(INHABITED_SYSTEM);
        expect(quotes().length).toEqual(1);
        expect(quotes()[0]).toMatch(/^Contact: \d-\d$/);
    });

    it("is deterministic for the same pilot state", async () => {
        const first = await makeTestWorld(INHABITED_SYSTEM);
        const second = await makeTestWorld(INHABITED_SYSTEM);
        expect(first.quotes()).toEqual(second.quotes());
    });
});
