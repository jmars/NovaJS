// Standalone seeded side-by-side trace run: drives the port's real
// AmbientPlugin (headless Worlds) and the pure binary reference model
// (nova/src/nova_plugin/ambient_model.ts) with identical pilot seeds and
// prints a per-seed PASS/FAIL table with the first diverging draw.
// Test harness — changes nothing at runtime. Run:
//   npx esbuild --bundle --platform=node scripts/run_ambient_trace.ts \
//       --outfile=/tmp/run_ambient_trace.js && node /tmp/run_ambient_trace.js \
//       [seedCount] [events]
//
// The port now composes FUN_0041af90's single rand(7) routing exactly (the
// split-gate divergence the harness used to report is resolved): one
// comparison per seed covers all three branches (përs 1/7, flët 6/49,
// dûde 36/49).

import {
    compareAmbientTrace,
    EVENTS,
} from "../nova/src/nova_plugin/ambient_harness";

async function main(): Promise<void> {
    const seedCount = Number(process.argv[2] ?? 1000);
    const events = Number(process.argv[3] ?? EVENTS);
    console.log(`ambient trace: ${seedCount} seeds × ${events} population `
        + `events (3-way routing)`);

    let passed = 0;
    let failed = false;
    for (let seed = 1; seed <= seedCount; seed++) {
        const result = await compareAmbientTrace(seed, events);
        if (result.ok) {
            passed++;
        }
        else {
            failed = true;
            console.log(`  seed ${seed} ${result.firstDivergence}`);
        }
        if (seed <= 20 || seed % 50 === 0) {
            // Keep the table short for large runs: early seeds in full,
            // then only failures and periodic heartbeats.
            console.log(`seed ${String(seed).padStart(4)}  `
                + `${result.ok ? "PASS" : "FAIL"} `
                + `(${result.spawnCount} spawns)`);
        }
        else if (seed % 10 === 0) {
            console.log(`seed ${String(seed).padStart(4)}  ...`);
        }
    }

    console.log(`ambient trace: ${passed}/${seedCount} seeds matched`);
    process.exitCode = failed ? 1 : 0;
}

void main();
