// Headless specs for the crön scheduler: date-window activation (including
// wildcard fields), PreHoldoff/Duration/PostHoldoff staging, the seeded
// Random roll, Require/Contribute gating, continuous-iterative termination,
// the stock crön 221 "generic misn delay" clearing b6666, and the
// cronStates round-trip through the pilot-file codec.

import "jasmine";
import { CronData, getDefaultCronData } from "novadatainterface/CronData";
import { advanceDate } from "../player/date";
import {
    deserializePlayerState,
    makeRng,
    serializePlayerState,
} from "../player/pilot_files";
import { ControlBits, PlayerState } from "../player/player_state";
import { CronEnv, CronRunResult, cronSeed, MAX_ITERATIONS, processCrons } from "./cron_scheduler";
import { isBitSet, makePlayerState, setBit } from "./test_fixtures";


function makeCron(id: string, overrides: Partial<CronData> = {}): CronData {
    return { ...getDefaultCronData(), id, name: id, ...overrides };
}

// A CronEnv over the given cröns; real bit operations against the state,
// every set-expression letter op recorded in `setOps` (test_fixtures style).
function makeCronEnv(crons: CronData[]):
    { env: CronEnv, setOps: string[], warnings: string[] } {
    const setOps: string[] = [];
    const warnings: string[] = [];
    const byId = new Map(crons.map(c => [c.id, c] as const));
    const env: CronEnv = {
        prefix: "nova",
        cronById: id => byId.get(id) ?? null,
        allCronIds: () => crons.map(c => c.id),
        makeSetContext: state => ({
            ctx: {
                bits: new ControlBits(state.bits),
                abortMission: rawId => setOps.push(`A${rawId}`),
                failMission: rawId => setOps.push(`F${rawId}`),
                startMission: rawId => setOps.push(`S${rawId}`),
                grantOutfit: (rawId, delta) => setOps.push(`${delta > 0 ? "G" : "D"}${rawId}`),
                movePlayer: () => setOps.push("M"),
                changeShip: () => setOps.push("C"),
                activateRank: rawId => setOps.push(`K${rawId}`),
                deactivateRank: rawId => setOps.push(`L${rawId}`),
                playSound: rawId => setOps.push(`P${rawId}`),
                destroyStellar: rawId => setOps.push(`Y${rawId}`),
                regenerateStellar: rawId => setOps.push(`U${rawId}`),
                leaveStellar: rawId => setOps.push(`Q${rawId}`),
            },
            takeEffects: () => [],
        }),
        warn: message => warnings.push(message),
    };
    return { env, setOps, warnings };
}

function pass(state: PlayerState, env: CronEnv, seed = 7): CronRunResult {
    return processCrons(state, env, makeRng(seed));
}

// The jump-flow order: one Nova day passes, then the cröns are evaluated.
function dayThenPass(state: PlayerState, env: CronEnv, seed = 7): CronRunResult {
    state.date = advanceDate(state.date, 1);
    return pass(state, env, seed);
}


describe("cron scheduler", function() {

    it("activates in the window and stages PreHoldoff, Duration and OnEnd", function() {
        const state = makePlayerState();
        const cron = makeCron("nova:10", {
            firstDay: 1, firstMonth: 1, firstYear: 1178,
            preHoldoff: 1, duration: 2,
            enableOn: "!b21",
            onStart: "b10", onEnd: "b20 b21",
        });
        const { env, warnings } = makeCronEnv([cron]);

        // Before the window: never activates.
        state.date = { day: 31, month: 12, year: 1177 };
        expect(pass(state, env).fired).toBeFalse();
        expect(state.cronStates["nova:10"]).toBeUndefined();

        // First day of the window: activates into preHoldoff (OnStart waits).
        state.date = { day: 1, month: 1, year: 1178 };
        expect(pass(state, env).started).toEqual([]);
        expect(state.cronStates["nova:10"]).toEqual({
            stage: "preHoldoff",
            endDate: { day: 2, month: 1, year: 1178 },
        });
        expect(isBitSet(state, 10)).toBeFalse();

        // Second day: PreHoldoff over, OnStart runs, active for 2 days.
        state.date = { day: 2, month: 1, year: 1178 };
        const start = pass(state, env);
        expect(start.started).toEqual(["nova:10"]);
        expect(isBitSet(state, 10)).toBeTrue();
        expect(state.cronStates["nova:10"]).toEqual({
            stage: "active",
            endDate: { day: 4, month: 1, year: 1178 },
        });

        // Still inside the Duration: nothing more happens.
        state.date = { day: 3, month: 1, year: 1178 };
        expect(pass(state, env).fired).toBeFalse();
        expect(isBitSet(state, 20)).toBeFalse();

        // Duration up: OnEnd runs, PostHoldoff 0 deactivates immediately.
        state.date = { day: 4, month: 1, year: 1178 };
        const end = pass(state, env);
        expect(end.ended).toEqual(["nova:10"]);
        expect(end.fired).toBeTrue();
        expect(isBitSet(state, 20)).toBeTrue();
        expect(state.cronStates["nova:10"]).toBeUndefined();

        // OnEnd blocked re-activation (EnableOn "!b21" now false).
        state.date = { day: 5, month: 1, year: 1178 };
        expect(pass(state, env).fired).toBeFalse();
        expect(state.cronStates["nova:10"]).toBeUndefined();
        expect(warnings).toEqual([]);
    });

    it("runs OnStart and OnEnd the same day when Duration is 0", function() {
        const state = makePlayerState();
        const cron = makeCron("nova:11", { preHoldoff: 0, duration: 0, onStart: "b10", onEnd: "b20" });
        const { env } = makeCronEnv([cron]);

        const run = pass(state, env);
        expect(run.started).toEqual(["nova:11"]);
        expect(run.ended).toEqual(["nova:11"]);
        expect(isBitSet(state, 10)).toBeTrue();
        expect(isBitSet(state, 20)).toBeTrue();
        expect(state.cronStates["nova:11"]).toBeUndefined();
    });

    it("holds a finished crön in PostHoldoff before deactivating", function() {
        const state = makePlayerState();
        const cron = makeCron("nova:12", {
            preHoldoff: 0, duration: 0, postHoldoff: 2,
            onEnd: "b20 b21", enableOn: "!b21",
        });
        const { env } = makeCronEnv([cron]);

        pass(state, env);
        expect(state.cronStates["nova:12"]).toEqual({
            stage: "postHoldoff",
            endDate: { day: 25, month: 6, year: 1177 },
        });

        // Held, then deactivated, and EnableOn keeps it from re-firing.
        dayThenPass(state, env);
        expect(state.cronStates["nova:12"]?.stage).toBe("postHoldoff");
        dayThenPass(state, env);
        expect(state.cronStates["nova:12"]).toBeUndefined();
        const later = dayThenPass(state, env);
        expect(later.fired).toBeFalse();
    });

    it("honors wildcard date fields component-wise", function() {
        const state = makePlayerState();
        const cron = makeCron("nova:13", {
            firstMonth: 12, firstYear: 1178,
            lastDay: 15, lastMonth: 12, lastYear: 1178,
            preHoldoff: 0, duration: 0, onEnd: "b20",
        });
        const { env } = makeCronEnv([cron]);

        // Days outside December 1178: no activation.
        state.date = { day: 30, month: 11, year: 1178 };
        expect(pass(state, env).fired).toBeFalse();
        state.date = { day: 1, month: 12, year: 1177 };
        expect(pass(state, env).fired).toBeFalse();
        state.date = { day: 20, month: 12, year: 1178 };
        expect(pass(state, env).fired).toBeFalse();

        // Inside the range (day and year wildcards on the first bound).
        state.date = { day: 5, month: 12, year: 1178 };
        expect(pass(state, env).fired).toBeTrue();
        expect(isBitSet(state, 20)).toBeTrue();
    });

    it("gates the Random roll on the seeded stream", function() {
        // 0 percent never fires; 100 percent fires as soon as eligible.
        const never = makePlayerState();
        const hundred = makePlayerState();
        const { env: neverEnv } = makeCronEnv(
            [makeCron("nova:14", { random: 0, preHoldoff: 0, duration: 0 })]);
        const { env: hundredEnv } = makeCronEnv(
            [makeCron("nova:15", { random: 100, preHoldoff: 0, duration: 0 })]);
        for (let i = 0; i < 10; i++) {
            expect(dayThenPass(never, neverEnv).fired).toBeFalse();
        }
        expect(pass(hundred, hundredEnv).started).toEqual(["nova:15"]);

        // A mid-range crön activates exactly when its stream draw is under
        // the percentage — deterministic for a given seed and date.
        const state = makePlayerState();
        const { env } = makeCronEnv(
            [makeCron("nova:16", { random: 50, preHoldoff: 0, duration: 0 })]);
        const expected = makeRng(cronSeed(state))() < 0.5;
        expect(pass(state, env).fired).toBe(expected);

        // Same seed again: the same decision.
        const replay = makePlayerState();
        expect(pass(replay, env).fired).toBe(expected);
    });

    it("requires every Require bit to be covered by an active contribution", function() {
        const state = makePlayerState();
        const contributor = makeCron("nova:20", {
            preHoldoff: 1, duration: 5, contribute: [1 << 5, 0],
        });
        const dependent = makeCron("nova:21", {
            preHoldoff: 0, duration: 0, require: [1 << 5, 0], onEnd: "b20",
        });
        const { env } = makeCronEnv([contributor, dependent]);

        // nova:20 activates into PreHoldoff; not yet active, so nova:21's
        // Require stays uncovered.
        expect(pass(state, env).started).toEqual([]);
        expect(state.cronStates["nova:20"]?.stage).toBe("preHoldoff");
        expect(isBitSet(state, 20)).toBeFalse();

        // Once nova:20 starts, its Contribute covers nova:21's bit 5.
        const second = dayThenPass(state, env);
        expect(second.started).toEqual(["nova:20", "nova:21"]);
        expect(state.cronStates["nova:20"]?.stage).toBe("active");
        expect(isBitSet(state, 20)).toBeTrue();
    });

    it("never activates when no contribution covers a Require bit", function() {
        const state = makePlayerState();
        const cron = makeCron("nova:22", {
            preHoldoff: 0, duration: 0, require: [1 << 9, 0],
        });
        const { env } = makeCronEnv([cron]);
        for (let i = 0; i < 3; i++) {
            expect(dayThenPass(state, env).fired).toBeFalse();
        }
    });

    it("lets the env supply ship/outfit/rank contributions", function() {
        const state = makePlayerState();
        const cron = makeCron("nova:23", {
            preHoldoff: 0, duration: 0, require: [1 << 2, 0],
        });
        const { env } = makeCronEnv([cron]);
        env.outfitContributes = [[1 << 2, 0]];
        expect(pass(state, env).fired).toBeTrue();
    });

    it("stops continuous-iterative OnEnd when EnableOn goes false", function() {
        const state = makePlayerState();
        // Stock crön 221: eligible while b6666, OnEnd clears b6666.
        const cron = makeCron("nova:221", {
            random: 100, duration: 0, preHoldoff: 1, postHoldoff: 0,
            flags: 0x0002, enableOn: "b6666", onEnd: "!b6666",
        });
        const { env } = makeCronEnv([cron]);
        setBit(state, 6666);

        // Day of completion: activates, holds one day.
        expect(pass(state, env).fired).toBeFalse();
        expect(state.cronStates["nova:221"]?.stage).toBe("preHoldoff");

        // Next day: OnEnd runs exactly once (the clear makes EnableOn false).
        const run = dayThenPass(state, env);
        expect(run.ended).toEqual(["nova:221"]);
        expect(isBitSet(state, 6666)).toBeFalse();
        expect(state.cronStates["nova:221"]).toBeUndefined();

        // And it never fires again.
        expect(dayThenPass(state, env).fired).toBeFalse();
    });

    it("caps continuous-iterative loops instead of hanging", function() {
        const state = makePlayerState();
        // EnableOn stays true (the expression never clears b1), so the loop
        // would run forever; the cap must stop it and warn.
        const cron = makeCron("nova:30", {
            flags: 0x0001, enableOn: "b1", onStart: "P2", duration: 3,
        });
        const { env, setOps, warnings } = makeCronEnv([cron]);
        setBit(state, 1);

        const run = pass(state, env);
        expect(run.started).toEqual(["nova:30"]);
        // Every iteration ran, then the cap reported through env.warn.
        expect(setOps.filter(op => op === "P2").length).toBe(MAX_ITERATIONS);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain("nova:30");
        expect(state.cronStates["nova:30"]?.stage).toBe("active");
    });

    it("collects effects produced by OnStart/OnEnd expressions", function() {
        const state = makePlayerState();
        const cron = makeCron("nova:31", { preHoldoff: 0, duration: 0, onStart: "S128" });
        const effects: import("./mission_state_machine").MissionEffect[] = [];
        const byId = new Map([[cron.id, cron] as const]);
        const env: CronEnv = {
            prefix: "nova",
            cronById: id => byId.get(id) ?? null,
            allCronIds: () => [cron.id],
            makeSetContext: () => ({
                ctx: {
                    bits: new ControlBits(state.bits),
                    abortMission: () => { },
                    failMission: () => { },
                    startMission: rawId => effects.push({ kind: "setExpr", when: "accept", expr: `S${rawId}` }),
                    grantOutfit: () => { },
                    movePlayer: () => { },
                    changeShip: () => { },
                    activateRank: () => { },
                    deactivateRank: () => { },
                    playSound: () => { },
                    destroyStellar: () => { },
                    regenerateStellar: () => { },
                    leaveStellar: () => { },
                },
                takeEffects: () => effects.splice(0, effects.length),
            }),
            warn: () => { },
        };

        const run = pass(state, env);
        expect(run.effects).toEqual([{ kind: "setExpr", when: "accept", expr: "S128" }]);
    });

    it("round-trips cronStates through the pilot file codec", function() {
        const state = makePlayerState();
        state.cronStates["nova:221"] = {
            stage: "preHoldoff",
            endDate: { day: 25, month: 6, year: 1177 },
        };

        const json = JSON.parse(JSON.stringify(serializePlayerState(state)));
        const restored = deserializePlayerState(json);
        expect(restored.cronStates["nova:221"]).toEqual({
            stage: "preHoldoff",
            endDate: { day: 25, month: 6, year: 1177 },
        });

        // Files written before cröns existed load with an empty record.
        delete json.cronStates;
        const preCron = deserializePlayerState(json);
        expect(preCron.cronStates).toEqual({});
    });

    it("schedules deterministically for the same seed and date", function() {
        const cron = makeCron("nova:32", {
            random: 50, preHoldoff: 0, duration: 0, onStart: "b10 R(b11 !b12)",
        });
        const { env } = makeCronEnv([cron]);
        const first = makePlayerState();
        const second = makePlayerState();
        const firstRun = pass(first, env, 99);
        const secondRun = pass(second, env, 99);
        expect(secondRun).toEqual(firstRun);
        expect(isBitSet(second, 10)).toBe(isBitSet(first, 10));
        expect(isBitSet(second, 11)).toBe(isBitSet(first, 11));
        expect(isBitSet(second, 12)).toBe(isBitSet(first, 12));
    });
});
