// Pure reference model of the binary's ambient population event (no ECS),
// for the seeded side-by-side trace harness: given a pilot seed, one event
// = the sÿst peripheral-përs warps, then ambientRollCount three-way rolls,
// recorded as the LCG draws they make and the ships they land, as a
// JSON-serializable trace.
// ambient_trace_test.ts and scripts/run_ambient_trace.ts replay the port's
// real PopulateSystem beside these traces and assert identical draw
// sequences + spawn keys.
//
// FUN_0041af90 composes the event as:
//
//   [a] the Peripherals përs loop (FUN_0041af90's head, before the rolls):
//       for each sÿst peripheral pair (id, percent), one rand(100) draw;
//       the përs warps in when rand(100)+1 <= percent (percent 100 always,
//       0 never). Runs before the roll loop.
//
//   [b] the three-way roll loop (ambientRollCount times), each roll:
//     rand(7) == 0 takes the përs branch (FUN_004235c0): rand(0x3fe) must
//     land under the eligible count and rand(eligible) picks the përs.
//
//     otherwise rand(7) == 0 takes the flët branch (FUN_00425280):
//     rand(0x100) / rand(eligible) the same way, then FUN_004259b0 spawns
//     the LEAD plus ALL escort groups — one rand(span) per escort group
//     (count = min + rand(max-min+1)) before the ships, then every flët
//     ship (lead + escorts) rolls rand(3)^2 aggress at build.
//
//     otherwise the dûde branch (FUN_0041ba80): rand(pairWeightTotal) picks
//     the dûde entry, rand(shipWeightTotal) its ship class, then two
//     rand(1500) draws scatter the ship ±750 around the system origin
//     (0,0), and the ship rolls rand(3)^2 aggress.
//
//   Every spawned DÛDE and FLËT ship additionally rolls aggress = rand(3)^2
//   (FUN_004254b0/FUN_0041ba80). The përs path rolls nothing
//   (FUN_004235c0 writes the clamped përs value directly).
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
        | "dude-pair" | "dude-ship" | "scatter" | "fleet-count"
        | "periph-percent";
    bound: number;
    value: number;
}

// Which branch a roll took ("peripheral" for the sÿst peripheral loop).
export type AmbientBranch = "pers" | "fleet" | "dude" | "peripheral";

// One trace entry: either a sÿst peripheral (branch "peripheral", roll 0)
// or one roll of the three-way loop (roll 1..rollCount). `key` is the
// primary spawned ship; `keys` is every spawned ship (a flët lands its
// lead + escorts, so one entry can land several). `govt` is the spawned
// ship's government, set for the dûde branch when the shape carries a dûde
// government table (the përs/flët paths leave it null).
export interface TraceEntry {
    event: number;  // 1-indexed population event
    roll: number;   // 1-indexed within the event, 0 for a peripheral
    index: number;  // peripheral index, or roll index
    branch: AmbientBranch;
    draws: DrawRecord[];
    spawned: boolean;
    key: string | null;
    keys: string[];
    govt: string | null;
}

// The harness fixtures' branch eligibility and content: how many flëts/përs
// pass their activation tests, the dûde table's weight totals, the fixture
// flëts' escort groups (min/max per group, same for every fixture flët), and
// the sÿst's peripheral përs pairs.
export interface BranchShape {
    fleetEligible: number;
    persEligible: number;
    dudePairWeight: number;
    dudeShipWeight: number;
    // The fixture flëts' escort groups: one rand(span) count draw per group,
    // then that many escort ships (FUN_004259b0). Empty ⇒ lead-only fleets.
    fleetEscorts: Array<{ min: number, max: number }>;
    // The sÿst Peripherals përs: each draws rand(100) once per event, and
    // warps in when rand(100)+1 <= percent.
    peripherals: Array<{ id: string, percent: number }>;
    // The dûde table's government distribution: (govt, weight) pairs whose
    // weights sum to dudePairWeight. The dude-pair draw is bucketed over
    // these cumulative weights to assign the spawned ship's government.
    // Empty ⇒ no government tracking (all dûde spawns govt null).
    dudeGovts: Array<{ govt: string, weight: number }>;
    // The përs-table branch's eligible pers ids, in scan order (the pick
    // draws rand(persEligible) and selects persIds[picked]). Empty ⇒ the
    // synthetic nova:960+picked keys are used (the default fixtures).
    persIds: string[];
}

// The harness fixture keys, per branch pick (fleet nova:950+i lead ships +
// escorts at indices 1.., përs nova:960+i, the dûde's ships keyed by the
// monotonic counter, peripheral përs by id).
export const FLEET_PICK_KEY = (pick: number) => `fleet-ship nova:${950 + pick} 0`;
export const FLEET_ESCORT_KEY = (pick: number, index: number) =>
    `fleet-ship nova:${950 + pick} ${index}`;
export const PERS_PICK_KEY = (pick: number) => `pers-ship nova:${960 + pick}`;
export const PERIPH_KEY = (id: string) => `pers-ship ${id}`;

function draw(draws: DrawRecord[], kind: DrawRecord["kind"], bound: number):
    number {
    const value = randInt(bound);
    draws.push({ kind, bound, value });
    return value;
}

// Buckets a rand(dudePairWeight) draw over the dûde table's cumulative
// (govt, weight) pairs — the draw picks the dûde entry, whose government is
// the spawned ship's (FUN_0046b600). Returns null govt with an empty table.
function govtFromRoll(govts: Array<{ govt: string, weight: number }>,
    roll: number): { govt: string | null, index: number } {
    let acc = 0;
    for (let i = 0; i < govts.length; i++) {
        acc += govts[i].weight;
        if (roll < acc) {
            return { govt: govts[i].govt, index: i };
        }
    }
    return govts.length > 0
        ? { govt: govts[govts.length - 1].govt, index: govts.length - 1 }
        : { govt: null, index: -1 };
}

// One roll's decision, drawn from the CURRENT stream state (the trace
// builders seed first; the side-by-side harness re-runs this on the live,
// probe-advanced stream — the LCG advances once per draw regardless of the
// bound, so draw COUNTS replay exactly and the recomputed branch/pick
// values are what the port must match).
export function ambientRoll(shape: BranchShape, event: number, roll: number,
    dudeCounter: number): TraceEntry {
    const draws: DrawRecord[] = [];
    const base = { event, roll, index: roll, draws, keys: [] as string[],
        key: null as string | null, govt: null as string | null };

    if (draw(draws, "gate-pers", AMBIENT_GATE) === 0) {
        if (shape.persEligible === 0) {
            return { ...base, branch: "pers", spawned: false };
        }
        if (draw(draws, "table", PERS_TABLE_ROLL) >= shape.persEligible) {
            return { ...base, branch: "pers", spawned: false };
        }
        const picked = draw(draws, "pick", shape.persEligible);
        const persId = shape.persIds.length > 0
            ? shape.persIds[picked] : `nova:${960 + picked}`;
        const key = `pers-ship ${persId}`;
        // FUN_004235c0 writes the clamped përs aggress directly — no roll.
        return {
            ...base, branch: "pers", spawned: true, key, keys: [key],
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
        // FUN_004259b0: one rand(span) count draw per escort group, all
        // before the ships are built.
        const counts: number[] = [];
        for (const esc of shape.fleetEscorts) {
            const span = esc.max - esc.min + 1;
            if (span <= 0) {
                continue;
            }
            counts.push(esc.min + draw(draws, "fleet-count", span));
        }
        const keys = [FLEET_PICK_KEY(picked)];
        let index = 1;
        for (const count of counts) {
            for (let i = 0; i < count; i++) {
                keys.push(FLEET_ESCORT_KEY(picked, index++));
            }
        }
        // Every flët ship (lead + escorts) rolls rand(3)^2 aggress at build
        // (makeDudeShip in spawnFleet), in spawn order: lead first.
        const totalShips = keys.length;
        for (let i = 0; i < totalShips; i++) {
            draw(draws, "aggress", 3);
        }
        return {
            ...base, branch: "fleet", spawned: true, key: keys[0], keys,
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
    // The pick's dûde entry determines both the government and the ship's
    // id (the harness registers one dûde per (govt, weight) pair as
    // nova:910+index); the default single dûde is nova:900.
    const { govt, index } = govtFromRoll(shape.dudeGovts,
        draws.find(d => d.kind === "dude-pair")!.value);
    const dudeId = shape.dudeGovts.length > 0 ? `nova:${910 + index}` : "nova:900";
    const key = `dude-ship ${dudeId} ${dudeCounter}`;
    return {
        ...base, branch: "dude", spawned: true, key, keys: [key], govt,
    };
}

// The sÿst Peripherals përs (FUN_0041af90's head, before the roll loop):
// each alive+active peripheral draws one rand(100); it warps in when
// rand(100)+1 <= percent (percent 100 always, 0 never). The harness
// fixtures are always alive+active.
export function ambientPeripherals(shape: BranchShape, event: number):
    TraceEntry[] {
    return shape.peripherals.map((p, index) => {
        const draws: DrawRecord[] = [];
        const value = draw(draws, "periph-percent", 100);
        const spawned = value + 1 <= p.percent;
        const key = spawned ? PERIPH_KEY(p.id) : null;
        return {
            event, roll: 0, index, branch: "peripheral", draws,
            spawned, key, keys: key === null ? [] : [key], govt: null,
        };
    });
}

export interface AmbientTrace {
    seed: number;
    events: number;
    rollCount: number;
    shape: BranchShape;
    trace: TraceEntry[];
    // The ambient entity keys after the final event's spawns land.
    keys: string[];
    spawnCount: number;
    // The spawned dûde ship → government, for validating that the port
    // assigns the same governments the binary's weighted dûde table does.
    govtByKey: Record<string, string>;
}

// The full per-seed replay (unprobed mode): the port consumes exactly this
// trace's draws, so its spawn keys must match pass for pass.
export function ambientEventTrace(seed: number, shape: BranchShape,
    rollCount: number, events: number): AmbientTrace {
    const trace: TraceEntry[] = [];
    const keys = new Set<string>();
    const govtByKey: Record<string, string> = {};
    let dudeCounter = 0;
    seedRng(seed);
    for (let event = 1; event <= events; event++) {
        for (const peripheral of ambientPeripherals(shape, event)) {
            trace.push(peripheral);
            for (const key of peripheral.keys) {
                keys.add(key);
            }
        }
        for (let roll = 1; roll <= rollCount; roll++) {
            const rollTrace = ambientRoll(shape, event, roll, dudeCounter);
            trace.push(rollTrace);
            for (const key of rollTrace.keys) {
                keys.add(key);
            }
            if (rollTrace.branch === "dude" && rollTrace.spawned) {
                if (rollTrace.govt !== null && rollTrace.key !== null) {
                    govtByKey[rollTrace.key] = rollTrace.govt;
                }
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
        spawnCount: trace.filter(entry => entry.spawned).length,
        govtByKey,
    };
}
