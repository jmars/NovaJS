// Headless specs for the special/aux ship goal rules and spawn planning
// (P6): the ShipSyst/AuxShipSyst match table, spawn plans, pinned dude
// rolls, loss bookkeeping and the destroy/disable/escort goal completion.
// The ECS wiring (DeathEvent, disable latches, proximity) is covered in
// nova_plugin/mission_ship_plugin_test.ts.

import "jasmine";
import { MissionData } from "novadatainterface/MissionData";
import { makeRng } from "../player/pilot_files";
import { ActiveMission, SpecialShipProgress } from "../player/player_state";
import {
    checkEscortGoal,
    isShipDisabled,
    missionShipsMatchSystem,
    nextSpecialShipType,
    planMissionShipSpawn,
    reportAuxShipDestroyed,
    reportSpecialShipLoss,
    reportSpecialShipsPresent,
    shipGoalMet,
    shipSpawnSeed,
} from "./mission_ship_goals";
import {
    acceptMission,
    markShipGoalComplete,
} from "./mission_state_machine";
import {
    BOUNTY_MISSION,
    EARTH,
    isBitSet,
    makeMission,
    makePlayerState,
    makeTestEnv,
    MISSIONS,
    START,
} from "./test_fixtures";


function activeMission(overrides: Partial<ActiveMission> = {}): ActiveMission {
    return {
        missionId: "nova:700",
        originStellar: START.id,
        travelStellar: null,
        returnStellar: null,
        travelComplete: true,
        shipGoalComplete: false,
        failed: false,
        cargoLoaded: false,
        cargo: null,
        deadline: null,
        specialShips: null,
        auxShips: null,
        ...overrides,
    };
}

function progress(initial: number): SpecialShipProgress {
    return {
        remaining: initial,
        killed: 0,
        boarded: 0,
        disabled: 0,
        jumpedIn: 0,
        jumpedOut: 0,
        initial,
    };
}

function shipMission(id: string, overrides: Partial<MissionData> = {}):
    MissionData {
    return makeMission(id, {
        shipCount: 2,
        shipSyst: 300,
        shipDude: "nova:800",
        shipGoal: 0,
        ...overrides,
    });
}


describe("mission ship system matching", function() {
    const env = makeTestEnv().env;

    function matches(mission: MissionData, systemId: string, which:
        "ship" | "aux" = "ship"): boolean {
        const state = makePlayerState();
        const active = activeMission({ missionId: mission.id });
        return missionShipsMatchSystem(state, mission, active, systemId, env,
            which);
    }

    it("decodes specific system ids", function() {
        // SïsSyst code 300 = the system with raw id 300.
        expect(matches(shipMission("nova:700", { shipSyst: 300 }), "nova:300"))
            .toBeTrue();
        expect(matches(shipMission("nova:700", { shipSyst: 300 }), "nova:301"))
            .toBeFalse();
    });

    it("decodes the near-system band", function() {
        // 5000 + (301 - 128): in or adjacent to system 301. System 300
        // links to 301, so it matches from next door.
        expect(matches(shipMission("nova:700", { shipSyst: 5173 }), "nova:301"))
            .toBeTrue();
        expect(matches(shipMission("nova:700", { shipSyst: 5173 }), "nova:300"))
            .toBeTrue();
        expect(matches(shipMission("nova:700", { shipSyst: 5173 }), "nova:303"))
            .toBeFalse();
    });

    it("decodes the govt-owned band against the system's own govt", function() {
        // 10002 = govt raw 130 (Polaris): the band keys on the SYSTEM's own
        // government (FUN_00447a30, syst+8), not on its planets'. System
        // 300 contains Federation Start One but is itself govtless, so the
        // Federation band 10000 does not match it.
        expect(matches(shipMission("nova:700", { shipSyst: 10002 }), "nova:304"))
            .toBeTrue();
        expect(matches(shipMission("nova:700", { shipSyst: 10000 }), "nova:300"))
            .toBeFalse();
        expect(matches(shipMission("nova:700", { shipSyst: 10000 }), "nova:302"))
            .toBeFalse();
        // 9999 = govtless (system govt -1): every fixture system but 304.
        expect(matches(shipMission("nova:700", { shipSyst: 9999 }), "nova:300"))
            .toBeTrue();
        expect(matches(shipMission("nova:700", { shipSyst: 9999 }), "nova:304"))
            .toBeFalse();
    });

    it("decodes -1/-6 as the player's system and -2 as the travel system", function() {
        // Ships only ever spawn in the player's world, so -1/-6 match exactly
        // when the tested system is the player's current system.
        expect(matches(shipMission("nova:700", { shipSyst: -6 }), "nova:300"))
            .toBeTrue();
        expect(matches(shipMission("nova:700", { shipSyst: -6 }), "nova:301"))
            .toBeFalse();
        expect(matches(shipMission("nova:700", { shipSyst: -1 }), "nova:300"))
            .toBeTrue();
        const elsewhere = { ...makePlayerState(), currentSystem: "nova:301" };
        expect(missionShipsMatchSystem(elsewhere,
            shipMission("nova:700", { shipSyst: -6 }),
            activeMission({ missionId: "nova:700" }), "nova:301", env, "ship"))
            .toBeTrue();
        // -2 = the travel destination's system (Earth is in 302); without a
        // resolved destination it matches nothing.
        const traveling = activeMission({ missionId: "nova:700", travelStellar: EARTH.id });
        expect(missionShipsMatchSystem(makePlayerState(),
            shipMission("nova:700", { shipSyst: -2 }), traveling, "nova:302",
            env, "ship")).toBeTrue();
        expect(missionShipsMatchSystem(makePlayerState(),
            shipMission("nova:700", { shipSyst: -2 }), traveling, "nova:300",
            env, "ship")).toBeFalse();
        expect(matches(shipMission("nova:700", { shipSyst: -2 }), "nova:303"))
            .toBeFalse();
        // -4/-5 fall through every band in the binary: no match, ever.
        expect(matches(shipMission("nova:700", { shipSyst: -4 }), "nova:300"))
            .toBeFalse();
        expect(matches(shipMission("nova:700", { shipSyst: -5 }), "nova:300"))
            .toBeFalse();
    });

    it("matches AuxShipSyst independently of ShipSyst", function() {
        const mission = shipMission("nova:700", { shipSyst: 301, auxShipSyst: 302 });
        expect(matches(mission, "nova:301")).toBeTrue();
        expect(matches(mission, "nova:301", "aux")).toBeFalse();
        expect(matches(mission, "nova:302", "aux")).toBeTrue();
    });
});


describe("mission ship spawn planning", function() {
    const env = makeTestEnv().env;

    it("spawns the remaining goal ships where the filter matches", function() {
        const state = makePlayerState();
        const mission = shipMission("nova:700");
        const active = activeMission({
            specialShips: progress(2),
        });
        expect(planMissionShipSpawn(state, mission, active, "nova:300", env))
            .toEqual({ specialCount: 2, auxCount: 0 });
        expect(planMissionShipSpawn(state, mission, active, "nova:301", env))
            .toEqual({ specialCount: 0, auxCount: 0 });

        // Dead ships stay dead: only the remainder respawns.
        active.specialShips!.remaining = 1;
        expect(planMissionShipSpawn(state, mission, active, "nova:300", env)
            .specialCount).toEqual(1);
    });

    it("stops respawning goal ships once the goal is met", function() {
        const state = makePlayerState();
        const mission = shipMission("nova:700");
        const active = activeMission({
            specialShips: progress(2),
            shipGoalComplete: true,
        });
        expect(planMissionShipSpawn(state, mission, active, "nova:300", env))
            .toEqual({ specialCount: 0, auxCount: 0 });
    });

    it("respawns infinite aux ships but drains finite ones", function() {
        const state = makePlayerState();
        const mission = shipMission("nova:700", {
            shipCount: -1,
            auxShipCount: 3,
            auxShipDude: "nova:800",
            auxShipSyst: 300,
        });
        const finite = activeMission({ auxShips: { remaining: 2, jumpedIn: 0 } });
        expect(planMissionShipSpawn(state, mission, finite, "nova:300", env))
            .toEqual({ specialCount: 0, auxCount: 2 });

        mission.flags = 0x0010; // infinite aux ships
        expect(planMissionShipSpawn(state, mission, finite, "nova:300", env)
            .auxCount).toEqual(3);
    });
});


describe("pinned dude rolls", function() {
    it("roll once under flag 0x0800 and replay afterwards", function() {
        const mission = shipMission("nova:700", { flags: 0x0800 });
        const prog = progress(3);
        const rolls = ["nova:128", "nova:129", "nova:130", "nova:131"];
        let next = 0;
        const rollDude = () => rolls[next++ % rolls.length];

        expect(nextSpecialShipType(mission, prog, rollDude, makeRng(1), 0))
            .toEqual("nova:128");
        expect(nextSpecialShipType(mission, prog, rollDude, makeRng(1), 1))
            .toEqual("nova:129");
        expect(prog.pinnedTypes).toEqual(["nova:128", "nova:129"]);

        // A later entry replays the pinned types instead of rolling.
        expect(nextSpecialShipType(mission, prog, () => "other", makeRng(2), 0))
            .toEqual("nova:128");
        expect(nextSpecialShipType(mission, prog, () => "other", makeRng(2), 1))
            .toEqual("nova:129");
        // A brand-new pinned index still rolls.
        expect(nextSpecialShipType(mission, prog, () => "other", makeRng(2), 2))
            .toEqual("other");
    });

    it("re-rolls every entry without flag 0x0800", function() {
        const mission = shipMission("nova:700", { flags: 0 });
        const prog = progress(1);
        const rolls = ["nova:128", "nova:129"];
        let next = 0;
        const rollDude = () => rolls[next++ % rolls.length];
        expect(nextSpecialShipType(mission, prog, rollDude, makeRng(1), 0))
            .toEqual("nova:128");
        expect(nextSpecialShipType(mission, prog, rollDude, makeRng(1), 0))
            .toEqual("nova:129");
        expect(prog.pinnedTypes).toBeUndefined();
    });

    it("seeds spawn streams per pilot, mission, system and date", function() {
        const state = makePlayerState();
        const other = makePlayerState(43);
        expect(shipSpawnSeed(state, 700, 300)).toEqual(shipSpawnSeed(state, 700, 300));
        expect(shipSpawnSeed(state, 700, 300)).not.toEqual(shipSpawnSeed(state, 701, 300));
        expect(shipSpawnSeed(state, 700, 300)).not.toEqual(shipSpawnSeed(state, 700, 301));
        expect(shipSpawnSeed(state, 700, 300)).not.toEqual(shipSpawnSeed(other, 700, 300));
    });
});


describe("ship goal completion", function() {
    it("completes destroy missions when the last goal ship dies", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const accept = acceptMission(state, BOUNTY_MISSION, env, START.id);
        const active = accept.active!;

        // First kill: bookkeeping only.
        let effects = reportSpecialShipLoss(state, BOUNTY_MISSION, active, env,
            "killed");
        expect(effects).toEqual([]);
        expect(active.specialShips).toEqual(
            { remaining: 1, killed: 1, boarded: 0, disabled: 0, jumpedIn: 0,
                jumpedOut: 0, initial: 2 });
        expect(active.shipGoalComplete).toBeFalse();

        // Second kill: the goal fires onShipDone (b700) and, with no return
        // stellar, completes the bounty on the spot.
        effects = reportSpecialShipLoss(state, BOUNTY_MISSION, active, env,
            "killed");
        expect(active.shipGoalComplete).toBeTrue();
        expect(isBitSet(state, 700)).toBeTrue();
        expect(effects.some(effect => effect.kind === "setExpr")).toBeTrue();
        expect(state.activeMissions).toEqual([]);
        expect(state.completedMissions).toEqual([BOUNTY_MISSION.id]);
    });

    it("does not count jumped-out ships for destroy goals", function() {
        const prog = progress(2);
        prog.killed = 1;
        prog.jumpedOut = 1;
        expect(shipGoalMet(0, prog)).toBeFalse();
        prog.jumpedOut = 0;
        prog.killed = 2;
        expect(shipGoalMet(0, prog)).toBeTrue();
    });

    it("completes disable missions on the disable threshold", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const mission = makeMission("nova:701", {
            shipCount: 1,
            shipGoal: 1,
            returnStel: 128,
        });
        MISSIONS.set(mission.id, mission);
        const active = acceptMission(state, mission, env, START.id).active!;

        reportSpecialShipLoss(state, mission, active, env, "disabled");
        expect(active.specialShips!.disabled).toEqual(1);
        expect(active.shipGoalComplete).toBeTrue();
        // With a return stellar the mission stays active until delivery.
        expect(state.activeMissions).toEqual([active]);
    });

    it("completes escort missions once the travel leg is done", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const mission = makeMission("nova:702", {
            shipCount: 2,
            shipGoal: 3,
            travelStel: 140,
            returnStel: 128,
        });
        MISSIONS.set(mission.id, mission);
        const active = acceptMission(state, mission, env, START.id).active!;

        // Still outbound: no completion yet.
        expect(checkEscortGoal(state, mission, active, env)).toEqual([]);
        expect(active.shipGoalComplete).toBeFalse();

        active.travelComplete = true;
        checkEscortGoal(state, mission, active, env);
        expect(active.shipGoalComplete).toBeTrue();
        expect(state.activeMissions).toEqual([active]);

        // Observing (goal 4) completes on spawn presence.
        const observer = makeMission("nova:703", { shipCount: 1, shipGoal: 4 });
        const observerActive = activeMission({
            missionId: observer.id,
            specialShips: progress(1),
        });
        reportSpecialShipsPresent(state, observer, observerActive, env);
        expect(observerActive.shipGoalComplete).toBeTrue();
    });

    it("fails escort missions when the last escort resolves", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const mission = makeMission("nova:704", {
            shipCount: 1,
            shipGoal: 3,
            compGovt: "nova:128",
            compReward: 10,
        });
        MISSIONS.set(mission.id, mission);
        const active = acceptMission(state, mission, env, START.id).active!;

        reportSpecialShipLoss(state, mission, active, env, "killed");
        expect(state.activeMissions).toEqual([]);
        expect(state.failedMissions).toEqual([mission.id]);
        // Failing costs half the completion reward.
        expect(state.legalRecord["nova:128"]).toEqual(-5);
    });

    it("fails flags2 0x0004 missions when a goal ship is disabled",
        function() {
            const state = makePlayerState();
            const { env } = makeTestEnv();
            const mission = makeMission("nova:705", {
                shipCount: 2,
                shipGoal: 3,
                flags2: 0x0004,
                failText: "nova:9001",
            });
            MISSIONS.set(mission.id, mission);
            const active = acceptMission(state, mission, env, START.id).active!;

            const effects = reportSpecialShipLoss(state, mission, active, env,
                "disabled");
            expect(state.failedMissions).toEqual([mission.id]);
            expect(effects.some(effect => effect.kind === "text")).toBeTrue();
        });

    it("never fails destroy goals via flags2 0x0004", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const mission = makeMission("nova:706", {
            shipCount: 1,
            shipGoal: 0,
            flags2: 0x0004,
        });
        MISSIONS.set(mission.id, mission);
        const active = acceptMission(state, mission, env, START.id).active!;

        reportSpecialShipLoss(state, mission, active, env, "killed");
        expect(state.failedMissions).toEqual([]);
        expect(state.completedMissions).toEqual([mission.id]);
    });

    it("drains finite aux pools and leaves infinite ones alone", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const mission = shipMission("nova:707", {
            shipCount: -1,
            auxShipCount: 2,
            auxShipDude: "nova:800",
            auxShipSyst: 300,
        });
        const aux = { remaining: 2, jumpedIn: 0 };
        const active = activeMission({ auxShips: aux });

        reportAuxShipDestroyed(state, mission, active, env);
        expect(aux).toEqual({ remaining: 1, jumpedIn: 0 });

        mission.flags = 0x0010;
        reportAuxShipDestroyed(state, mission, active, env);
        expect(aux.remaining).toEqual(1);
    });
});


describe("the disable threshold", function() {
    const FULL_ARMOR = { current: 100, max: 100 };
    const FULL_SHIELD = { current: 50, max: 50 };

    it("trips at 25% of armor + shield/2", function() {
        // 25 + 25 = 50 = 25% of 150? No: 25% of (100 + 25) = 31.25 — still up.
        expect(isShipDisabled({ current: 25, max: 100 },
            { current: 25, max: 50 })).toBeFalse();
        expect(isShipDisabled({ current: 6, max: 100 },
            { current: 25, max: 50 })).toBeTrue();
        expect(isShipDisabled(FULL_ARMOR, FULL_SHIELD)).toBeFalse();
    });

    it("handles shieldless and broken ships", function() {
        expect(isShipDisabled({ current: 30, max: 100 }, null)).toBeFalse();
        expect(isShipDisabled({ current: 20, max: 100 }, null)).toBeTrue();
        expect(isShipDisabled({ current: 0, max: 100 },
            { current: 0, max: 0 })).toBeTrue();
        expect(isShipDisabled(null, FULL_SHIELD)).toBeFalse();
    });
});


describe("markShipGoalComplete", function() {
    it("is idempotent", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const mission = makeMission("nova:708", {
            shipCount: 1,
            shipGoal: 0,
            onShipDone: "b700",
        });
        MISSIONS.set(mission.id, mission);
        const active = acceptMission(state, mission, env, START.id).active!;

        expect(markShipGoalComplete(state, mission, active, env).length)
            .toBeGreaterThan(0);
        expect(markShipGoalComplete(state, mission, active, env)).toEqual([]);
        // The first call already completed the no-return mission.
        expect(state.activeMissions).toEqual([]);
    });
});
