// Side-by-side trace specs: the port's real AmbientPlugin (PopulateSystem,
// headless World, harness fixtures) must consume the same engine-LCG draws
// in the same order as the pure binary reference model (ambient_model) for
// the same pilot seed, and land the spawns the model predicts — catches
// ordering/probability drift automatically. The stream is fingerprinted
// with a probe draw after every frame; Math.random scatter is outside the
// comparison. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/ambient_trace_test.ts \
//       --outfile=/tmp/ambient_trace_test.js && node_modules/.bin/jasmine /tmp/ambient_trace_test.js

import "jasmine";
import {
    ambientEventTrace,
    AmbientTrace,
    ambientRoll,
    BranchShape,
    DrawRecord,
} from "./ambient_model";
import {
    compareAmbientTrace,
    ROLLS,
    runPort,
    SHAPE,
} from "./ambient_harness";
import { randInt, seedRng } from "../player/pilot_files";

const EVENTS = 4;

// A system with no dûde table and no eligible flëts/përs: every roll
// draws nothing and spawns nothing.
const EMPTY_SHAPE: BranchShape = {
    fleetEligible: 0,
    persEligible: 0,
    dudePairWeight: 0,
    dudeShipWeight: 0,
    fleetEscorts: [],
    dudeGovts: [],
    persIds: [],
    peripherals: [],
};

function findSeed(shape: BranchShape,
    predicate: (trace: AmbientTrace) => boolean): number {
    for (let seed = 1; seed < 200_000; seed++) {
        if (predicate(ambientEventTrace(seed, shape, ROLLS, EVENTS))) {
            return seed;
        }
    }
    throw new Error("no seed found for the requested trace shape");
}

const SEEDS = {
    hit: findSeed(SHAPE, trace => trace.spawnCount > 0),
    none: findSeed(EMPTY_SHAPE, trace => true),
    multi: findSeed(SHAPE, trace => trace.keys.length >= 3
        && new Set(trace.trace.filter(roll => roll.branch === "dude"
            && roll.spawned).map(roll => roll.key)).size >= 2),
};

describe("ambient trace vs PopulateSystem", () => {
    it("matches draws + spawn keys for hit, miss and re-roll seeds",
        async () => {
            for (const [name, seed] of Object.entries(SEEDS)) {
                const result = await compareAmbientTrace(seed, EVENTS);
                expect(`seed ${name}: ${result.firstDivergence ?? "match"}`)
                    .toEqual(`seed ${name}: match`);
                expect(result.ok).toBeTrue();
            }
        });

    it("spawns exactly as the recorded trace decides, when unprobed",
        async () => {
            // Without probes the port consumes exactly the pure trace's
            // stream, so the trace's keys must land verbatim.
            const hit = await compareAmbientTrace(SEEDS.hit, EVENTS, false);
            expect(hit.firstDivergence).toBeNull();
            expect(hit.spawnCount).toBeGreaterThanOrEqual(1);
            const none = await compareAmbientTrace(SEEDS.none, EVENTS,
                false, EMPTY_SHAPE);
            expect(none.firstDivergence).toBeNull();
            expect(none.spawnCount).toEqual(0);
        });
});

describe("ambient trace determinism", () => {
    it("runs the port identically for the same seed", async () => {
        const first = await runPort(SEEDS.multi, EVENTS);
        const second = await runPort(SEEDS.multi, EVENTS);
        expect(first.probes).toEqual(second.probes);
        expect(first.keysByFrame).toEqual(second.keysByFrame);
    });
});

describe("ambient trace sweep", () => {
    it("matches the model for every seed in a small range", async () => {
        for (let seed = 1; seed <= 12; seed++) {
            const result = await compareAmbientTrace(seed, EVENTS);
            expect(`seed ${seed}: ${result.firstDivergence ?? "match"}`)
                .toEqual(`seed ${seed}: match`);
        }
    });
});

describe("ambient reference model", () => {
    it("replays the port's draw order inline", () => {
        // The established per-event draw sequence: sÿst Peripherals first
        // (one rand(100) per pair), then the three-way rolls — gates, branch
        // table draw + pick, or the dûde branch's four draws.
        function inlineReplay(seed: number): string[] {
            seedRng(seed);
            const keys = new Set<string>();
            let dudeCounter = 0;
            for (let event = 1; event <= EVENTS; event++) {
                // The sÿst Peripherals loop (FUN_0041af90's head). A
                // peripheral's ship is keyed by its id and deduped: the
                // port refuses to spawn a second copy of an already-present
                // përs (spawnPersShip), matching the trace's key set.
                for (const p of SHAPE.peripherals) {
                    if (randInt(100) + 1 <= p.percent) {
                        keys.add(`pers-ship ${p.id}`);
                    }
                }
                for (let roll = 0; roll < ROLLS; roll++) {
                    if (randInt(7) === 0) {
                        // përs branch: 100 eligible përs, no draw when
                        // the table draw misses; FUN_004235c0 rolls no
                        // aggress for the përs ship.
                        if (randInt(0x3fe) < 100) {
                            keys.add(`pers-ship nova:${960 + randInt(100)}`);
                        }
                        continue;
                    }
                    if (randInt(7) === 0) {
                        // flët branch: 10 eligible flëts, each with one
                        // escort group of 0..1 ships (FUN_004259b0).
                        if (randInt(0x100) < 10) {
                            const picked = randInt(10);
                            keys.add(`fleet-ship nova:${950 + picked} 0`);
                            // One rand(span) count draw, then that many
                            // escorts at indices 1..
                            const count = randInt(2);
                            for (let i = 0; i < count; i++) {
                                keys.add(`fleet-ship nova:${950 + picked} ${i + 1}`);
                            }
                            // Lead + escorts each roll aggress at build.
                            for (let i = 0; i < 1 + count; i++) {
                                randInt(3);
                            }
                        }
                        continue;
                    }
                    // dûde branch: one pair of weight 100, one ship class
                    // of weight 100, the ship's aggress roll, ±750 scatter.
                    randInt(100);
                    randInt(100);
                    randInt(3);
                    randInt(1500);
                    randInt(1500);
                    keys.add(`dude-ship nova:900 ${dudeCounter++}`);
                }
            }
            return [...keys].sort();
        }
        for (let seed = 1; seed < 400; seed += 7) {
            const trace = ambientEventTrace(seed, SHAPE, ROLLS, EVENTS);
            expect(trace.keys).toEqual(inlineReplay(seed));
        }
    });

    it("records every draw in bounds and keeps spawned ⟺ key", () => {
        const trace = ambientEventTrace(SEEDS.multi, SHAPE, ROLLS, EVENTS);
        for (const roll of trace.trace) {
            for (const record of roll.draws) {
                expect(record.value).toBeGreaterThanOrEqual(0);
                expect(record.value).toBeLessThan(record.bound);
            }
            if (roll.spawned) {
                expect(roll.key).not.toBeNull();
                expect(roll.draws[roll.draws.length - 1].kind).toMatch(
                    /pick|scatter|aggress|periph-percent/);
            }
            else {
                expect(roll.key).toBeNull();
            }
        }
    });

    it("is JSON-serializable", () => {
        const trace = ambientEventTrace(SEEDS.hit, SHAPE, ROLLS, EVENTS);
        expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
    });

    it("routes the binary's single gate to one branch per roll", () => {
        // FUN_0041af90: rand(7)==0 → përs, else rand(7)==0 → flët, else
        // dûde. With the harness shape, a dûde roll always spawns.
        let pers = false;
        let fleet = false;
        let dude = false;
        for (let seed = 1; seed < 500 && !(pers && fleet && dude); seed++) {
            seedRng(seed);
            const roll = ambientRoll(SHAPE, 1, 1, 0);
            const kinds = roll.draws.map(record => record.kind);
            const want: DrawRecord["kind"][] = [];
            if (roll.branch === "pers") {
                pers = true;
                want.push("gate-pers", "table");
            }
            else if (roll.branch === "fleet") {
                fleet = true;
                want.push("gate-pers", "gate-fleet", "table");
            }
            else {
                dude = true;
                want.push("gate-pers", "gate-fleet", "dude-pair",
                    "dude-ship", "aggress", "scatter", "scatter");
            }
            // The pick draw only follows a table hit; dûde and flët ships
            // roll aggress after it, përs ships do not. A spawned flët
            // draws one fleet-count per escort group, then one aggress per
            // ship (lead + the rolled escort count).
            if (roll.spawned && roll.branch === "pers") {
                want.push("pick");
            }
            else if (roll.spawned && roll.branch === "fleet") {
                want.push("pick", "fleet-count");
                const count = roll.draws
                    .find(record => record.kind === "fleet-count")!.value;
                for (let i = 0; i < 1 + count; i++) {
                    want.push("aggress");
                }
            }
            expect(kinds).toEqual(want);
        }
        expect(pers).toBeTrue();
        expect(fleet).toBeTrue();
        expect(dude).toBeTrue();
    });

    it("leaves empty branches draw-free", () => {
        // An empty branch consumes only its gate draws — the port's
        // documented draw-count convention.
        const empty: BranchShape = {
            fleetEligible: 0,
            persEligible: 0,
            dudePairWeight: 0,
            dudeShipWeight: 0,
            fleetEscorts: [],
    dudeGovts: [],
    persIds: [],
            peripherals: [],
        };
        seedRng(7);
        for (let roll = 0; roll < 200; roll++) {
            const trace = ambientRoll(empty, 1, 1, 0);
            expect(trace.draws.length).toBeLessThanOrEqual(2);
            expect(trace.spawned).toBeFalse();
            expect(trace.key).toBeNull();
        }
    });
});
