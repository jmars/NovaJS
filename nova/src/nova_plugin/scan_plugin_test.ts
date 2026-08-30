// Headless World specs for the scan enforcement glue (scan_plugin.ts): a
// FinishJumpEvent into a scanning system applies the fine, records the
// SmugPenalty, fails flag-0x0020 missions through the FSM, and queues the
// pilot save; a fail-open system leaves everything untouched. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/scan_plugin_test.ts \
//       --outfile=/tmp/scan_plugin_test.js && node_modules/.bin/jasmine /tmp/scan_plugin_test.js

import "jasmine";
import { getDefaultMissionData } from "novadatainterface/MissionData";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { MissionEnv } from "../missions/mission_state_machine";
import { makePlayerState, makeTestEnv } from "../missions/test_fixtures";
import { ActiveMission, PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { FinishJumpEvent } from "./jump_plugin";
import { MissionEnvResource } from "../missions/mission_plugin";
import { ScanPlugin } from "./scan_plugin";

const SMUGGLER_MISSION_RAW_ID = 507;

// The fixtures' Federation govt becomes a scanner: mask 0x8000, flat 500
// fine, CrimeTol 25, SmugPenalty 20. The test mission's mïsn ScanMask
// overlaps it, and flag 0x0020 makes it fail when scanned.
function makeScanEnv(base: ReturnType<typeof makeTestEnv>): { env: MissionEnv } {
    const federation = base.env.government("nova:128")!;
    const scanGovt = {
        ...federation,
        crimeTol: 25,
        scanFine: 500,
        penalties: { ...federation.penalties, smuggling: 20 },
        scanMask: 0x8000,
    };
    const smugglerMission = {
        ...getDefaultMissionData(),
        id: `nova:${SMUGGLER_MISSION_RAW_ID}`,
        scanMask: 0x8000,
        flags: 0x0020,
    };
    return {
        env: {
            ...base.env,
            government: id => id === "nova:128" ? scanGovt : base.env.government(id),
            missionByRawId: rawId => rawId === SMUGGLER_MISSION_RAW_ID
                ? smugglerMission
                : base.env.missionByRawId(rawId),
        },
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

function makeTestWorld(state: PlayerState) {
    const base = makeTestEnv();
    const { env } = makeScanEnv(base);
    const world = new World();
    world.resources.set(PlayerStateResource, state);
    world.resources.set(MissionEnvResource, env);
    world.addPlugin(ScanPlugin);
    return { world, warnings: base.warnings };
}

function jumpTo(world: World, to: string): void {
    // No entity filter: JumpFromSystem emits FinishJumpEvent unfiltered and
    // ScanSystem reads nothing off the entity.
    world.emit(FinishJumpEvent, { entity: new Entity("Ship"), uuid: "x", to });
    world.step(); // emit queues the event; a step drains it
}

describe("ScanSystem", () => {
    it("fines, records the SmugPenalty, fails the 0x0020 mission and saves",
        () => {
            const { world } = makeTestWorld(makeSmugglerState());
            const state = world.resources.get(PlayerStateResource)!;
            const saves: number[] = [];
            (globalThis as { queueSavePlayerState?: () => void })
                .queueSavePlayerState = () => saves.push(1);

            try {
                jumpTo(world, "nova:300"); // START, govt nova:128
            } finally {
                delete (globalThis as { queueSavePlayerState?: () => void })
                    .queueSavePlayerState;
            }

            expect(state.credits).toEqual(24500); // 25000 - flat 500
            expect(state.legalRecord["nova:128"]).toEqual(-20); // -SmugPenalty
            expect(state.failedMissions).toEqual([`nova:${SMUGGLER_MISSION_RAW_ID}`]);
            expect(state.activeMissions).toEqual([]);
            expect(saves.length).toBeGreaterThan(0);
        });

    it("leaves the pilot alone where no government resolves (fail-open)",
        () => {
            const { world } = makeTestWorld(makeSmugglerState());
            const state = world.resources.get(PlayerStateResource)!;
            const before = { credits: state.credits,
                record: { ...state.legalRecord } };

            jumpTo(world, "nova:301"); // only the uninhabited rock

            expect(state.credits).toEqual(before.credits);
            expect(state.legalRecord).toEqual(before.record);
            expect(state.failedMissions).toEqual([]);
            expect(state.activeMissions.length).toEqual(1);
        });

    it("does not scan a pilot whose record is below -CrimeTol", () => {
        const state = makeSmugglerState();
        state.legalRecord["nova:128"] = -30; // crimeTol 25
        const { world } = makeTestWorld(state);

        jumpTo(world, "nova:300");

        expect(state.credits).toEqual(25000);
        expect(state.failedMissions).toEqual([]);
        expect(state.activeMissions.length).toEqual(1);
    });
});
