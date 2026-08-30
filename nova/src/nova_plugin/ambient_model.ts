// Pure reference model of the binary's ambient spawn draws (no ECS), for
// the seeded side-by-side trace harness: given a pilot seed and the number
// of eligible flëts/përs, each function returns the LCG draws every
// ambient pass makes and whether that pass spawns, as a JSON-serializable
// trace. ambient_trace_test.ts and scripts/run_ambient_trace.ts replay the
// port's real SpawnFleetsSystem/SpawnPersSystem beside these traces and
// assert identical draw sequences + spawn decisions.
//
// Draw order per pass (the engine's shared Park-Miller stream — see
// pilot_files — advances once per draw):
//
//   flët branch, as SpawnFleetsSystem composes FUN_0041af90's flët slot +
//   FUN_00425280: rand(7) == 0 defers to the përs branch; rand(7) == 0
//   takes the flët branch (anything else is the unported dude branch,
//   FUN_0041ba80); then rand(0x100) must land under the eligible count and
//   rand(eligible) picks the flët that warps in.
//
//   përs branch, as SpawnPersSystem composes FUN_004235c0: rand(7) == 0
//   takes the përs roll; then rand(0x3fe) must land under the eligible
//   count and rand(eligible) picks the përs that warps in.
//
// KNOWN binary divergence (flagged, not fixed here): FUN_0041af90 draws
// ONE rand(7) per ambient slot and routes to a single branch; the port
// splits the two ported branches across two systems that each draw their
// own gates, so per pass the port consumes more draws than the binary even
// though the per-branch spawn probabilities match (përs 1/7, flët 6/49).
// binaryAmbientTrace models the binary's exact single-gate routing; the
// per-branch traces model what the port must replay to stay comparable.

import { randInt, seedRng } from "../player/pilot_files";

// FUN_0041af90's ambient branch gate (rand(7)): 0 takes the përs branch,
// then a second 0 takes the flët branch. Mirrors fleet_plugin.AMBIENT_GATE.
export const AMBIENT_GATE = 7;

// FUN_00425280 draws one index into the 256-slot flët table; FUN_004235c0
// draws rand(0x3fe) into the 1024-slot përs table. The port composes both
// as rand(bound) < eligibleCount + a uniform pick (see
// fleet_plugin.FLEET_TABLE_SLOTS / pers_plugin.PERS_TABLE_ROLL).
export const FLEET_TABLE_SLOTS = 0x100;
export const PERS_TABLE_ROLL = 0x3fe;

// One recorded LCG draw: which roll site, from what bound, what came out.
export interface DrawRecord {
    kind: "gate-pers" | "gate-fleet" | "gate" | "table" | "pick";
    bound: number;
    value: number;
}

// Which branch a pass took. "none" = gated away (another branch owns the
// slot); "dude" = FUN_0041ba80, which is not ported and whose draws are
// not recovered, so none are modeled.
export type AmbientBranch = "fleet" | "pers" | "dude" | "none";

// One ambient pass: the draws it made, the branch it took, whether a spawn
// occurred and which eligible entry was picked.
export interface PassTrace {
    pass: number; // 1-indexed
    branch: AmbientBranch;
    draws: DrawRecord[];
    spawned: boolean;
    picked: number | null; // index into the eligible list on a spawn
}

export interface AmbientTrace {
    seed: number;
    eligible: number;
    passes: number;
    trace: PassTrace[];
    spawnCount: number;
}

function draw(draws: DrawRecord[], kind: DrawRecord["kind"], bound: number):
    number {
    const value = randInt(bound);
    draws.push({ kind, bound, value });
    return value;
}

// One pass's flët decision, drawn from the CURRENT stream state (the trace
// builders seed first; the side-by-side harness re-runs this on the live,
// probe-advanced stream — the LCG advances once per draw regardless of the
// bound, so draw COUNTS replay exactly and the recomputed branch/pick
// values are what the port must match).
export function fleetPass(eligible: number, pass = 0): PassTrace {
    const draws: DrawRecord[] = [];
    if (draw(draws, "gate-pers", AMBIENT_GATE) === 0) {
        return { pass, branch: "none", draws, spawned: false, picked: null };
    }
    if (draw(draws, "gate-fleet", AMBIENT_GATE) !== 0) {
        return { pass, branch: "none", draws, spawned: false, picked: null };
    }
    return tablePass(pass, "fleet", draws, eligible, FLEET_TABLE_SLOTS);
}

// One pass's përs decision, drawn from the current stream state.
export function persPass(eligible: number, pass = 0): PassTrace {
    const draws: DrawRecord[] = [];
    if (draw(draws, "gate", AMBIENT_GATE) !== 0) {
        return { pass, branch: "none", draws, spawned: false, picked: null };
    }
    return tablePass(pass, "pers", draws, eligible, PERS_TABLE_ROLL);
}

function tablePass(pass: number, branch: AmbientBranch, draws: DrawRecord[],
    eligible: number, bound: number): PassTrace {
    if (draw(draws, "table", bound) >= eligible) {
        return { pass, branch, draws, spawned: false, picked: null };
    }
    return {
        pass,
        branch,
        draws,
        spawned: true,
        picked: draw(draws, "pick", eligible),
    };
}

function finish(seed: number, eligible: number, passes: number,
    trace: PassTrace[]): AmbientTrace {
    return {
        seed,
        eligible,
        passes,
        trace,
        spawnCount: trace.filter(pass => pass.spawned).length,
    };
}

// The flët spawn decision per pass (FUN_0041af90's flët slot +
// FUN_00425280, composed exactly as SpawnFleetsSystem draws it).
export function fleetSpawnTrace(seed: number, eligible: number,
    passes: number): AmbientTrace {
    const trace: PassTrace[] = [];
    seedRng(seed);
    for (let pass = 1; pass <= passes; pass++) {
        trace.push(fleetPass(eligible, pass));
    }
    return finish(seed, eligible, passes, trace);
}

// The përs spawn decision per pass (FUN_004235c0, composed exactly as
// SpawnPersSystem draws it).
export function persSpawnTrace(seed: number, eligible: number,
    passes: number): AmbientTrace {
    const trace: PassTrace[] = [];
    seedRng(seed);
    for (let pass = 1; pass <= passes; pass++) {
        trace.push(persPass(eligible, pass));
    }
    return finish(seed, eligible, passes, trace);
}

export interface BinaryTrace {
    seed: number;
    fleetEligible: number;
    persEligible: number;
    passes: number;
    trace: PassTrace[];
    spawnCount: number;
}

// The binary's exact FUN_0041af90 routing: ONE rand(7) per ambient slot —
// 0 takes the përs branch (FUN_004235c0), otherwise a second rand(7) == 0
// takes the flët branch (FUN_00425280), otherwise the dude branch
// (FUN_0041ba80). Reference for the binary's stream consumption; the
// port's split-gate composition diverges from it from the first pass (see
// the module comment), which the harness reports as a known finding.
export function binaryAmbientTrace(seed: number, fleetEligible: number,
    persEligible: number, passes: number): BinaryTrace {
    const trace: PassTrace[] = [];
    seedRng(seed);
    for (let pass = 1; pass <= passes; pass++) {
        const draws: DrawRecord[] = [];
        if (draw(draws, "gate-pers", AMBIENT_GATE) === 0) {
            trace.push(tablePass(pass, "pers", draws, persEligible,
                PERS_TABLE_ROLL));
            continue;
        }
        if (draw(draws, "gate-fleet", AMBIENT_GATE) === 0) {
            trace.push(tablePass(pass, "fleet", draws, fleetEligible,
                FLEET_TABLE_SLOTS));
            continue;
        }
        trace.push({ pass, branch: "dude", draws, spawned: false, picked: null });
    }
    return {
        seed,
        fleetEligible,
        persEligible,
        passes,
        trace,
        spawnCount: trace.filter(pass => pass.spawned).length,
    };
}
