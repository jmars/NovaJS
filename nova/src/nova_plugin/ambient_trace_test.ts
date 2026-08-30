// Side-by-side trace specs: the port's real SpawnFleetsSystem /
// SpawnPersSystem (headless Worlds, fleet_plugin_test/pers_test fixtures)
// must consume the same engine-LCG draws in the same order as the pure
// binary reference model (ambient_model) for the same pilot seed, and land
// the spawns the model predicts — catches ordering/probability drift
// automatically. The stream is fingerprinted with a probe draw after every
// frame; Math.random scatter is outside the comparison. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/ambient_trace_test.ts \
//       --outfile=/tmp/ambient_trace_test.js && node_modules/.bin/jasmine /tmp/ambient_trace_test.js

import "jasmine";
import {
    AmbientTrace,
    binaryAmbientTrace,
    fleetSpawnTrace,
    persSpawnTrace,
} from "./ambient_model";
import {
    AmbientKind,
    compareAmbientTrace,
    runPort,
} from "./ambient_harness";
import { randInt, seedRng } from "../player/pilot_files";

const PASSES = 4;
const FLEET_ELIGIBLE = 10;
const PERS_ELIGIBLE = 100;

function findSeed(kind: AmbientKind, eligible: number,
    predicate: (trace: AmbientTrace) => boolean): number {
    const traceOf = kind === "fleet" ? fleetSpawnTrace : persSpawnTrace;
    for (let seed = 1; seed < 200_000; seed++) {
        if (predicate(traceOf(seed, eligible, PASSES))) {
            return seed;
        }
    }
    throw new Error(`no ${kind} seed found for the requested trace shape`);
}

const FLEET_SEEDS = {
    hit: findSeed("fleet", FLEET_ELIGIBLE,
        trace => trace.trace[0].spawned),
    none: findSeed("fleet", FLEET_ELIGIBLE,
        trace => trace.spawnCount === 0),
    multi: findSeed("fleet", FLEET_ELIGIBLE,
        trace => new Set(
            trace.trace.filter(pass => pass.picked !== null)
                .map(pass => pass.picked)).size >= 2),
};

const PERS_SEEDS = {
    hit: findSeed("pers", PERS_ELIGIBLE,
        trace => trace.trace[0].spawned),
    none: findSeed("pers", PERS_ELIGIBLE,
        trace => trace.spawnCount === 0),
    multi: findSeed("pers", PERS_ELIGIBLE,
        trace => new Set(
            trace.trace.filter(pass => pass.picked !== null)
                .map(pass => pass.picked)).size >= 2),
};

describe("ambient trace vs SpawnFleetsSystem", () => {
    it("matches draws + spawn decisions for hit, miss and re-roll seeds",
        async () => {
            for (const [name, seed] of Object.entries(FLEET_SEEDS)) {
                const result = await compareAmbientTrace("fleet", seed,
                    FLEET_ELIGIBLE, PASSES);
                expect(`fleet ${name}: ${result.firstDivergence ?? "match"}`)
                    .toEqual(`fleet ${name}: match`);
                expect(result.ok).toBeTrue();
            }
        });

    it("spawns exactly as the recorded trace decides, when unprobed",
        async () => {
            // Without probes the port consumes exactly the pure trace's
            // stream, so the trace's decisions must land verbatim.
            const hit = await compareAmbientTrace("fleet", FLEET_SEEDS.hit,
                FLEET_ELIGIBLE, PASSES, false);
            expect(hit.firstDivergence).toBeNull();
            expect(hit.spawnCount).toBeGreaterThanOrEqual(1);
            const none = await compareAmbientTrace("fleet", FLEET_SEEDS.none,
                FLEET_ELIGIBLE, PASSES, false);
            expect(none.firstDivergence).toBeNull();
            expect(none.spawnCount).toEqual(0);
        });
});

describe("ambient trace vs SpawnPersSystem", () => {
    it("matches draws + spawn decisions for hit, miss and re-roll seeds",
        async () => {
            for (const [name, seed] of Object.entries(PERS_SEEDS)) {
                const result = await compareAmbientTrace("pers", seed,
                    PERS_ELIGIBLE, PASSES);
                expect(`përs ${name}: ${result.firstDivergence ?? "match"}`)
                    .toEqual(`përs ${name}: match`);
                expect(result.ok).toBeTrue();
            }
        });

    it("spawns exactly as the recorded trace decides, when unprobed",
        async () => {
            const hit = await compareAmbientTrace("pers", PERS_SEEDS.hit,
                PERS_ELIGIBLE, PASSES, false);
            expect(hit.firstDivergence).toBeNull();
            expect(hit.spawnCount).toBeGreaterThanOrEqual(1);
        });
});

describe("ambient trace determinism", () => {
    it("runs the port identically for the same seed", async () => {
        const first = await runPort("fleet", FLEET_SEEDS.multi,
            FLEET_ELIGIBLE, PASSES);
        const second = await runPort("fleet", FLEET_SEEDS.multi,
            FLEET_ELIGIBLE, PASSES);
        expect(first.probes).toEqual(second.probes);
        expect(first.keysByFrame).toEqual(second.keysByFrame);
    });
});

describe("ambient trace sweep", () => {
    it("matches the model for every seed in a small range, both branches",
        async () => {
            for (let seed = 1; seed <= 12; seed++) {
                for (const kind of ["fleet", "pers"] as const) {
                    const result = await compareAmbientTrace(kind, seed,
                        kind === "fleet" ? FLEET_ELIGIBLE : PERS_ELIGIBLE,
                        PASSES);
                    expect(`${kind} seed ${seed}: ${
                        result.firstDivergence ?? "match"}`)
                        .toEqual(`${kind} seed ${seed}: match`);
                }
            }
        });
});

describe("ambient reference model", () => {
    // fleet_plugin_test's fleetPasses replay, inline: the established
    // per-pass draw sequence the specs already trust.
    function fleetPassesReplay(seed: number, eligible: number,
        passes: number): number[] {
        seedRng(seed);
        const picks: number[] = [];
        for (let pass = 0; pass < passes; pass++) {
            if (randInt(7) === 0) {
                continue;
            }
            if (randInt(7) !== 0) {
                continue;
            }
            if (randInt(0x100) < eligible) {
                picks.push(randInt(eligible));
            }
        }
        return picks;
    }

    it("replays the established fleet draw sequence", () => {
        for (let seed = 1; seed < 400; seed += 7) {
            const trace = fleetSpawnTrace(seed, FLEET_ELIGIBLE, PASSES);
            expect(trace.trace.filter(pass => pass.picked !== null)
                .map(pass => pass.picked))
                .toEqual(fleetPassesReplay(seed, FLEET_ELIGIBLE, PASSES));
        }
    });

    it("records every draw in bounds and keeps spawned ⟺ picked", () => {
        for (const trace of [
            fleetSpawnTrace(FLEET_SEEDS.multi, FLEET_ELIGIBLE, PASSES),
            persSpawnTrace(PERS_SEEDS.multi, PERS_ELIGIBLE, PASSES),
        ]) {
            for (const pass of trace.trace) {
                for (const record of pass.draws) {
                    expect(record.value).toBeGreaterThanOrEqual(0);
                    expect(record.value).toBeLessThan(record.bound);
                }
                if (pass.spawned) {
                    expect(pass.picked).not.toBeNull();
                    expect(pass.draws[pass.draws.length - 1].kind)
                        .toEqual("pick");
                }
                else {
                    expect(pass.picked).toBeNull();
                }
            }
        }
    });

    it("is JSON-serializable", () => {
        const trace = fleetSpawnTrace(FLEET_SEEDS.hit, FLEET_ELIGIBLE,
            PASSES);
        expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
    });

    it("routes the binary's single gate to one branch per pass", () => {
        // FUN_0041af90: rand(7)==0 → përs, else rand(7)==0 → flët, else
        // dude (not ported, no draws modeled).
        let pers = false;
        let fleet = false;
        let dude = false;
        for (let seed = 1; seed < 500 && !(pers && fleet && dude); seed++) {
            const trace = binaryAmbientTrace(seed, FLEET_ELIGIBLE,
                PERS_ELIGIBLE, 1);
            const pass = trace.trace[0];
            if (pass.branch === "pers") {
                pers = true;
                expect(pass.draws.map(record => record.kind))
                    .toEqual(["gate-pers", "table"]);
            }
            if (pass.branch === "fleet") {
                fleet = true;
                expect(pass.draws.map(record => record.kind))
                    .toEqual(["gate-pers", "gate-fleet", "table"]);
            }
            if (pass.branch === "dude") {
                dude = true;
                expect(pass.draws.map(record => record.kind))
                    .toEqual(["gate-pers", "gate-fleet"]);
            }
        }
        expect(pers).toBeTrue();
        expect(fleet).toBeTrue();
        expect(dude).toBeTrue();
    });
});
