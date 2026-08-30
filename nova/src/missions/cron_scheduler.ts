// The crön scheduler: evaluates every crön once per game day and moves it
// through its lifecycle
//
//   inactive --date window + EnableOn + Require + Random--> preHoldoff
//      --PreHoldoff days--> active: OnStart, Duration days
//      --Duration--> OnEnd --> postHoldoff --PostHoldoff days--> inactive
//
// (Nova Bible "The crön resource"). Duration 0 means OnStart and OnEnd run
// on the same day; PreHoldoff/PostHoldoff 0 means no hold.
//
// Pure TypeScript — no PIXI/ECS imports — so it is headless-testable; the
// caller (jump_plugin, after the daily date advance) assembles the CronEnv.
//
// Determinism: cröns are processed in sorted-id order and every random draw
// (the Random percent roll, R() inside set expressions) comes from one
// injected seeded rng stream, so the same state + date replays identically
// across reloads and multiplayer peers — the same contract as the mission
// FSM's seeded streams.
//
// Termination: the continuous-iterative flags (0x0001/0x0002) re-run
// OnStart/OnEnd until EnableOn goes false or Require is unmet; the Bible
// warns these can loop forever, so every loop is capped (MAX_ITERATIONS)
// and the cap is reported through env.warn.

import { CronData } from "novadatainterface/CronData";
import {
    evaluateTest,
    executeSet,
    parseTest,
    SetContext,
    TestContext,
} from "novadatainterface/expressions";
import { advanceDate, compareDates, NovaDate } from "../player/date";
import { ControlBits, CronState, PlayerState } from "../player/player_state";
import { MissionEffect, MissionEnv } from "./mission_state_machine";
import { rawIdOf } from "./stellar_filter";


// --- flags ---

// Continuous, iterative cron entry/exit: keep evaluating OnStart/OnEnd until
// EnableOn is false or the Require constraints are unmet.
export const CRON_FLAG_ITERATED_START = 0x0001;
export const CRON_FLAG_ITERATED_END = 0x0002;

// Hard cap on continuous-iterative loops. High enough for legitimate
// "keep removing outfit X until it runs out" cröns, low enough that a
// genuinely circular crön cannot hang the engine.
export const MAX_ITERATIONS = 1000;


// --- environment ---

// The world data the scheduler needs, injected so the pure module never
// touches the engine. makeCronEnv adapts a crön-aware MissionEnv; tests
// build one directly.
export interface CronEnv {
    // Prefix for constructing global ids from raw ids (stock data: "nova").
    readonly prefix: string;
    cronById(id: string): CronData | null;
    allCronIds(): string[];
    // The engine-backed (or test-recording) SetContext used to run a crön's
    // set expressions; takeEffects() returns any effects produced through
    // FSM operations (S/F/A missions started, etc.).
    makeSetContext(state: PlayerState): { ctx: SetContext; takeEffects(): MissionEffect[] };
    // Ship/outfit/rank contributions to the Require pool (mirrors
    // OfferContext's vocabulary). Unknown/absent contributes nothing; the
    // player's currently active cröns always contribute too.
    shipContribute?: [number, number];
    outfitContributes?: Array<[number, number]>;
    rankContributes?: Array<[number, number]>;
    // Outfit counts for EnableOn's Oxxx tests; absent means none detected
    // (the shïp/outfit contribute model is not wired yet, so this only
    // affects stock cröns like the reactor knock-offs).
    ownedOutfits?: Record<number, number>;
    warn(message: string): void;
}

// Adapts a MissionEnv that carries crön data; null when the env has none
// (callers skip cron processing).
export function makeCronEnv(env: MissionEnv): CronEnv | null {
    if (!env.cronById || !env.allCronIds) {
        return null;
    }
    return {
        prefix: env.prefix,
        cronById: env.cronById,
        allCronIds: env.allCronIds,
        makeSetContext: env.makeSetContext,
        warn: env.warn,
    };
}


// --- result ---

export interface CronRunResult {
    // Global ids of cröns whose OnStart / OnEnd ran this pass.
    started: string[];
    ended: string[];
    // Effects the set expressions produced (missions started via S, etc.).
    effects: MissionEffect[];
    // True when anything fired (callers queue a pilot save).
    fired: boolean;
}

// Seed for the daily cron pass: derived from the pilot seed and the date so
// every peer and reload computes the same rolls and no two days share a
// stream (mirrors mission_state_machine's jumpRerollSeed).
export function cronSeed(state: PlayerState): number {
    const { day, month, year } = state.date;
    return (state.rngSeed ^ (year * 4096 + month * 64 + day) ^ 0xC12C4A71) >>> 0;
}


// --- the pass ---

// Runs one day's cron evaluation over the (already advanced) state date.
// Mutates state.cronStates and whatever the set expressions touch (bits,
// missions); returns what fired.
export function processCrons(state: PlayerState, env: CronEnv,
    rng: () => number): CronRunResult {
    const result: CronRunResult = { started: [], ended: [], effects: [], fired: false };
    // Sorted so the shared rng stream is consumed in a stable order.
    const ids = env.allCronIds().slice().sort();

    for (const id of ids) {
        const cron = env.cronById(id);
        if (!cron) {
            continue;
        }
        const existing = state.cronStates[id];
        if (existing) {
            advanceCron(cron, id, state, env, rng, result);
        }
        else {
            tryActivate(cron, id, state, env, rng, result);
        }
    }

    result.fired = result.started.length > 0 || result.ended.length > 0;
    return result;
}


// --- activation ---

// Date-window check. Any date field <= 0 (0 or -1 in the resource) is a
// wildcard; each component is checked independently against its bounds, the
// same per-field reading the Bible's wildcard note describes.
function cronInWindow(now: NovaDate, cron: CronData): boolean {
    if (cron.firstYear > 0 && now.year < cron.firstYear) return false;
    if (cron.lastYear > 0 && now.year > cron.lastYear) return false;
    if (cron.firstMonth > 0 && now.month < cron.firstMonth) return false;
    if (cron.lastMonth > 0 && now.month > cron.lastMonth) return false;
    if (cron.firstDay > 0 && now.day < cron.firstDay) return false;
    if (cron.lastDay > 0 && now.day > cron.lastDay) return false;
    return true;
}

// The TestContext EnableOn evaluates against (same shape as the availability
// evaluator's AvailBits context).
function enableOnContext(state: PlayerState, env: CronEnv): TestContext {
    return {
        bits: new ControlBits(state.bits),
        gender: state.gender === "male" ? 1 : 0,
        hasOutfit: rawId => (env.ownedOutfits?.[rawId] ?? 0) > 0,
        exploredSystem: rawId =>
            state.exploredSystems.some(id => rawIdOf(id) === rawId),
    };
}

// Every set bit of `mask` must be covered by some contribution word.
function maskCovered(mask: [number, number], words: Array<[number, number]>): boolean {
    for (let word = 0; word < 2; word++) {
        for (let bit = 0; bit < 32; bit++) {
            const flag = 1 << bit;
            if ((mask[word] & flag) === 0) {
                continue;
            }
            if (!words.some(pool => (pool[word] & flag) !== 0)) {
                return false;
            }
        }
    }
    return true;
}

// The Require pool: ship/outfit/rank contributions plus the Contribute of
// every currently active crön. A crön counts as active from its OnStart
// until its OnEnd (stage "active"), per the Bible's "when the cron event is
// active".
export function contributePool(state: PlayerState, env: CronEnv): Array<[number, number]> {
    const words: Array<[number, number]> = [];
    if (env.shipContribute) {
        words.push(env.shipContribute);
    }
    words.push(...(env.outfitContributes ?? []));
    words.push(...(env.rankContributes ?? []));
    for (const [id, cronState] of Object.entries(state.cronStates)) {
        if (cronState.stage !== "active") {
            continue;
        }
        const cron = env.cronById(id);
        if (cron) {
            words.push(cron.contribute);
        }
    }
    return words;
}

function cronEligible(cron: CronData, state: PlayerState, env: CronEnv): boolean {
    if (!evaluateTest(parseTest(cron.enableOn, env.warn), enableOnContext(state, env))) {
        return false;
    }
    return maskCovered(cron.require, contributePool(state, env));
}

// A new day, an inactive cron: window + eligibility + the Random percent
// roll decide whether it activates into preHoldoff.
function tryActivate(cron: CronData, id: string, state: PlayerState, env: CronEnv,
    rng: () => number, result: CronRunResult): void {
    if (!cronInWindow(state.date, cron)) {
        return;
    }
    if (!cronEligible(cron, state, env)) {
        return;
    }
    if (rng() >= cron.random / 100) {
        return;
    }
    state.cronStates[id] = {
        stage: "preHoldoff",
        endDate: advanceDate(state.date, Math.max(cron.preHoldoff, 0)),
    };
    // Chain straight into stage processing so PreHoldoff 0 cröns start (and
    // Duration 0 cröns even end) on the day they activate.
    advanceCron(cron, id, state, env, rng, result);
}


// --- stage transitions ---

// Fires the stage transitions whose endDate has arrived, running OnStart /
// OnEnd as stages complete. Stages can chain within one call (activation
// with PreHoldoff 0 and Duration 0 runs OnStart and OnEnd the same day), so
// this loops; a bounded hop count keeps any pathological data from looping.
function advanceCron(cron: CronData, id: string, state: PlayerState, env: CronEnv,
    rng: () => number, result: CronRunResult): void {
    for (let hops = 0; hops < 4; hops++) {
        const cronState = state.cronStates[id];
        if (!cronState) {
            return;
        }
        if (compareDates(state.date, cronState.endDate) < 0) {
            return; // Stage not over yet.
        }

        if (cronState.stage === "preHoldoff") {
            runCronExpression(cron, "onStart", state, env, rng, result);
            result.started.push(id);
            if (cron.duration > 0) {
                state.cronStates[id] = {
                    stage: "active",
                    endDate: advanceDate(state.date, cron.duration),
                };
            }
            else {
                // Duration 0: start and end on the same day.
                runCronExpression(cron, "onEnd", state, env, rng, result);
                result.ended.push(id);
                enterPostHoldoff(cron, id, state);
            }
        }
        else if (cronState.stage === "active") {
            runCronExpression(cron, "onEnd", state, env, rng, result);
            result.ended.push(id);
            enterPostHoldoff(cron, id, state);
        }
        else { // postHoldoff: held long enough; deactivate.
            delete state.cronStates[id];
            return;
        }
    }
    env.warn(`crön ${id} exceeded the maximum stage transitions in one pass; stopped`);
}

function enterPostHoldoff(cron: CronData, id: string, state: PlayerState): void {
    const hold = Math.max(cron.postHoldoff, 0);
    if (hold > 0) {
        state.cronStates[id] = {
            stage: "postHoldoff",
            endDate: advanceDate(state.date, hold),
        };
    }
    else {
        delete state.cronStates[id];
    }
}


// --- expression execution ---

// Runs OnStart or OnEnd through the env's SetContext. With a
// continuous-iterative flag, the expression is re-run until EnableOn goes
// false or Require is unmet — capped by MAX_ITERATIONS (Bible: "This can
// create infinite loops, so be careful!").
function runCronExpression(cron: CronData, which: "onStart" | "onEnd",
    state: PlayerState, env: CronEnv, rng: () => number, result: CronRunResult): void {
    const expr = cron[which];
    if (expr === "") {
        return;
    }
    const iterated = which === "onStart"
        ? (cron.flags & CRON_FLAG_ITERATED_START) !== 0
        : (cron.flags & CRON_FLAG_ITERATED_END) !== 0;

    const { ctx, takeEffects } = env.makeSetContext(state);
    if (!iterated) {
        executeSet(expr, ctx, rng, env.warn);
        result.effects.push(...takeEffects());
        return;
    }

    let iterations = 0;
    while (cronEligible(cron, state, env)) {
        executeSet(expr, ctx, rng, env.warn);
        result.effects.push(...takeEffects());
        iterations += 1;
        if (iterations >= MAX_ITERATIONS) {
            env.warn(`crön ${cron.id} hit the continuous-iterative cap of `
                + `${MAX_ITERATIONS} iterations; stopping ${which}`);
            break;
        }
    }
}
