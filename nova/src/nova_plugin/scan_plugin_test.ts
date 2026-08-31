// Headless World specs for the scan outcome glue (scan_plugin.ts's
// smugglingScan): a caught flag-0x0020 mission quick-fails through the FSM
// with no fine, any other catch is fined with no record change, and the
// pilot save is queued. The trigger/gates live in the InterceptorScan
// hail (npc_ai_plugin_test territory); this file pins the applied outcome.
// Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/scan_plugin_test.ts \
//       --outfile=/tmp/scan_plugin_test.js && node_modules/.bin/jasmine /tmp/scan_plugin_test.js

import "jasmine";
import { getDefaultMissionData } from "novadatainterface/MissionData";
import { World } from "nova_ecs/world";
import { MissionEnv } from "../missions/mission_state_machine";
import { makePlayerState, makeTestEnv } from "../missions/test_fixtures";
import { MissionEnvResource } from "../missions/mission_plugin";
import { ActiveMission, PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { smugglingScan } from "./scan_plugin";

const SMUGGLER_MISSION_RAW_ID = 507;

// The fixtures' Federation govt becomes a scanner: mask 0x8000, flat 500
// fine, SmugPenalty 20 (a gate only — never applied to the record). The
// test mission's mïsn ScanMask overlaps it.
function makeScanEnv(base: ReturnType<typeof makeTestEnv>,
    missionFlags = 0x0020): MissionEnv {
    const federation = base.env.government("nova:128")!;
    const scanGovt = {
        ...federation,
        scanFine: 500,
        penalties: { ...federation.penalties, smuggling: 20 },
        scanMask: 0x8000,
    };
    const smugglerMission = {
        ...getDefaultMissionData(),
        id: `nova:${SMUGGLER_MISSION_RAW_ID}`,
        scanMask: 0x8000,
        flags: missionFlags,
    };
    return {
        ...base.env,
        government: id => id === "nova:128" ? scanGovt : base.env.government(id),
        missionByRawId: rawId => rawId === SMUGGLER_MISSION_RAW_ID
            ? smugglerMission
            : base.env.missionByRawId(rawId),
    };
}

function makeSmugglerState(): PlayerState {
    const state = makePlayerState(); // credits 25000, empty record
    const active: ActiveMission = {
        missionId: `nova:${SMUGGLER_MISSION_RAW_ID}`,
        originStellar: "nova:130",
        travelStellar: null,
        returnStellar: null,
        travelComplete: false,
        shipGoalComplete: false,
        failed: false,
        cargoLoaded: true,
        cargo: { type: 42, qty: 10 },
        deadline: null,
        specialShips: null,
        auxShips: null,
    };
    state.activeMissions = [active];
    return state;
}

function makeTestWorld(state: PlayerState,
    env: MissionEnv): { world: World, saves: number[] } {
    const world = new World();
    world.resources.set(PlayerStateResource, state);
    world.resources.set(MissionEnvResource, env);
    const saves: number[] = [];
    (globalThis as { queueSavePlayerState?: () => void })
        .queueSavePlayerState = () => saves.push(1);
    return { world, saves };
}

describe("smugglingScan", () => {
    it("quick-fails a caught 0x0020 mission without a fine", () => {
        const base = makeTestEnv();
        const { world, saves } = makeTestWorld(makeSmugglerState(),
            makeScanEnv(base));
        const state = world.resources.get(PlayerStateResource)!;
        try {
            expect(smugglingScan(world, "nova:128")).toBeTrue();
        }
        finally {
            delete (globalThis as { queueSavePlayerState?: () => void })
                .queueSavePlayerState;
        }

        expect(state.credits).toEqual(25000); // no fine on the quick-fail
        expect(state.legalRecord).toEqual({}); // no record change, ever
        expect(state.failedMissions)
            .toEqual([`nova:${SMUGGLER_MISSION_RAW_ID}`]);
        expect(state.activeMissions).toEqual([]);
        expect(saves.length).toBeGreaterThan(0);
    });

    it("fines a non-0x0020 catch and leaves the record alone", () => {
        const base = makeTestEnv();
        const { world, saves } = makeTestWorld(makeSmugglerState(),
            makeScanEnv(base, 0));
        const state = world.resources.get(PlayerStateResource)!;
        try {
            expect(smugglingScan(world, "nova:128")).toBeTrue();
        }
        finally {
            delete (globalThis as { queueSavePlayerState?: () => void })
                .queueSavePlayerState;
        }

        expect(state.credits).toEqual(24500); // 25000 - flat 500
        expect(state.legalRecord).toEqual({}); // no SmugPenalty on a catch
        expect(state.failedMissions).toEqual([]);
        expect(state.activeMissions.length).toEqual(1);
        expect(saves.length).toBeGreaterThan(0);
    });

    it("returns false untouched on a clean hold (no save)", () => {
        const base = makeTestEnv();
        const { world, saves } = makeTestWorld(makePlayerState(),
            makeScanEnv(base));
        const state = world.resources.get(PlayerStateResource)!;
        try {
            expect(smugglingScan(world, "nova:128")).toBeFalse();
        }
        finally {
            delete (globalThis as { queueSavePlayerState?: () => void })
                .queueSavePlayerState;
        }

        expect(state.credits).toEqual(25000);
        expect(state.failedMissions).toEqual([]);
        expect(saves).toEqual([]);
    });
});
