// Pure reference model of the binary's ambient population event (no ECS),
// for the seeded side-by-side trace harness: given a pilot seed, one event
// = ambientRollCount three-way rolls, recorded as the LCG draws they make
// and the ships they land, as a JSON-serializable trace.
// ambient_trace_test.ts and scripts/run_ambient_trace.ts replay the port's
// real PopulateSystem beside these traces and assert identical draw
// sequences + spawn keys.
//
// Draw order per roll (the engine's shared Park-Miller stream — see
// pilot_files — advances once per draw), exactly as ambient_plugin
// composes FUN_0041af90:
//
//   rand(7) == 0 takes the përs branch (FUN_004235c0): rand(0x3fe) must
//   land under the eligible count and rand(eligible) picks the përs.
//
//   otherwise rand(7) == 0 takes the flët branch (FUN_00425280):
//   rand(0x100) / rand(eligible) the same way.
//
//   otherwise the dûde branch (FUN_0041ba80): rand(pairWeightTotal) picks
//   the dûde entry, rand(shipWeightTotal) its ship class, then two
//   rand(1500) draws scatter the ship ±750 around the player.
//
//   Every spawned DÛDE and FLËT ship additionally rolls aggress =
//   rand(3) ^ 2 (FUN_004254b0/FUN_0041ba80): one rand(3) draw at ship
//   build — after the flët pick, and between the dûde ship-class pick and
//   its scatters. The përs path rolls nothing (FUN_004235c0 writes the
//   clamped përs value directly).
//
// An empty branch draws nothing (the port's documented draw-count
// convention, mirrored here): with no eligible përs/flët or an empty dûde
// table the gate draws still happen but the branch draw does not.

import { randInt, seedRng } from "../player/pilot_files";

// FUN_0041af90's routing gate (rand(7)): 0 takes the përs branch, then a
// second 0 takes the flët branch. Mirrors fleet_plugin.AMBIENT_GATE.
export const AMBIENT_GATE = 7;

// FUN_00425280 draws one index into the 256-slot flët table; FUN_004235c0
// draws rand(0x3fe) into the 1024-slot përs table. The port composes both
// as rand(bound) < eligibleCount + a uniform pick (see
// fleet_plugin.FLEET_TABLE_SLOTS / pers_plugin.PERS_TABLE_ROLL).
export const FLEET_TABLE_SLOTS = 0x100;
export const PERS_TABLE_ROLL = 0x3fe;

// One recorded LCG draw: which roll site, from what bound, what came out.
export interface DrawRecord {
    kind: "gate-pers" | "gate-fleet" | "table" | "pick" | "aggress"
        | "dude-pair" | "dude-ship" | "scatter";
    bound: number;
    value: number;
}

// Which branch a roll took.
export type AmbientBranch = "pers" | "fleet" | "dude";

// One ambient roll: the draws it made, the branch it took, whether a ship
// spawned and the entity key it landed (null when the branch drew nothing
// or re-picked an already-present ship — the key set does not grow).
export interface RollTrace {
    event: number; // 1-indexed population event
    roll: number;  // 1-indexed within the event
    branch: AmbientBranch;
    draws: DrawRecord[];
    spawned: boolean;
    key: string | null;
}

// The harness fixtures' branch eligibility: how many flëts/përs pass their
// activation tests and the dûde table's weight totals (the fixtures give
// the system one dûde pair of weight 100 with one ship class of weight
// 100, so dûde rolls always spawn).
export interface BranchShape {
    fleetEligible: number;
    persEligible: number;
    dudePairWeight: number;
    dudeShipWeight: number;
}

// The harness fixture keys, per branch pick (fleet nova:950+i lead ships,
// përs nova:960+i, the dûde's ships keyed by the monotonic counter).
export const FLEET_PICK_KEY = (pick: number) => `fleet-ship nova:${950 + pick} 0`;
export const PERS_PICK_KEY = (pick: number) => `pers-ship nova:${960 + pick}`;
export const DUDE_KEY = (counter: number) => `dude-ship nova:900 ${counter}`;

function draw(draws: DrawRecord[], kind: DrawRecord["kind"], bound: number):
    number {
    const value = randInt(bound);
    draws.push({ kind, bound, value });
    return value;
}

// One roll's decision, drawn from the CURRENT stream state (the trace
// builders seed first; the side-by-side harness re-runs this on the live,
// probe-advanced stream — the LCG advances once per draw regardless of the
// bound, so draw COUNTS replay exactly and the recomputed branch/pick
// values are what the port must match).
export function ambientRoll(shape: BranchShape, event: number, roll: number,
    dudeCounter: number): RollTrace {
    const draws: DrawRecord[] = [];
    const base = { event, roll, draws, key: null };

    if (draw(draws, "gate-pers", AMBIENT_GATE) === 0) {
        if (shape.persEligible === 0) {
            return { ...base, branch: "pers", spawned: false };
        }
        if (draw(draws, "table", PERS_TABLE_ROLL) >= shape.persEligible) {
            return { ...base, branch: "pers", spawned: false };
        }
        const picked = draw(draws, "pick", shape.persEligible);
        // FUN_004235c0 writes the clamped përs aggress directly — no roll.
        return {
            ...base, branch: "pers", spawned: true,
            key: PERS_PICK_KEY(picked),
        };
    }

    if (draw(draws, "gate-fleet", AMBIENT_GATE) === 0) {
        if (shape.fleetEligible === 0) {
            return { ...base, branch: "fleet", spawned: false };
        }
        if (draw(draws, "table", FLEET_TABLE_SLOTS) >= shape.fleetEligible) {
            return { ...base, branch: "fleet", spawned: false };
        }
        const picked = draw(draws, "pick", shape.fleetEligible);
        // The fixture fleets carry a lead ship only.
        draw(draws, "aggress", 3);
        return {
            ...base, branch: "fleet", spawned: true,
            key: FLEET_PICK_KEY(picked),
        };
    }

    // The dûde branch (FUN_0041ba80). An empty dûde table draws nothing.
    if (shape.dudePairWeight === 0 || shape.dudeShipWeight === 0) {
        return { ...base, branch: "dude", spawned: false };
    }
    draw(draws, "dude-pair", shape.dudePairWeight);
    draw(draws, "dude-ship", shape.dudeShipWeight);
    draw(draws, "aggress", 3);
    draw(draws, "scatter", 1500);
    draw(draws, "scatter", 1500);
    return {
        ...base, branch: "dude", spawned: true,
        key: DUDE_KEY(dudeCounter),
    };
}

export interface AmbientTrace {
    seed: number;
    events: number;
    rollCount: number;
    shape: BranchShape;
    trace: RollTrace[];
    // The ambient entity keys after the final event's spawns land.
    keys: string[];
    spawnCount: number;
}

// The full per-seed replay (unprobed mode): the port consumes exactly this
// trace's draws, so its spawn keys must match pass for pass.
export function ambientEventTrace(seed: number, shape: BranchShape,
    rollCount: number, events: number): AmbientTrace {
    const trace: RollTrace[] = [];
    const keys = new Set<string>();
    let dudeCounter = 0;
    seedRng(seed);
    for (let event = 1; event <= events; event++) {
        for (let roll = 1; roll <= rollCount; roll++) {
            const rollTrace = ambientRoll(shape, event, roll, dudeCounter);
            trace.push(rollTrace);
            if (rollTrace.key !== null && !keys.has(rollTrace.key)) {
                keys.add(rollTrace.key);
            }
            if (rollTrace.branch === "dude" && rollTrace.spawned) {
                dudeCounter++;
            }
        }
    }
    return {
        seed,
        events,
        rollCount,
        shape,
        trace,
        keys: [...keys].sort(),
        spawnCount: trace.filter(roll => roll.key !== null).length,
    };
}
