// Standalone seeded side-by-side trace run: drives the port's real
// SpawnFleetsSystem/SpawnPersSystem (headless Worlds) and the pure binary
// reference model (nova/src/nova_plugin/ambient_model.ts) with identical
// pilot seeds and prints a per-seed PASS/FAIL table with the first
// diverging draw. Test harness — changes nothing at runtime. Run:
//   npx esbuild --bundle --platform=node scripts/run_ambient_trace.ts \
//       --outfile=/tmp/run_ambient_trace.js && node /tmp/run_ambient_trace.js \
//       [seedCount] [passes]
//
// Known finding (see ambient_model.ts): the port splits FUN_0041af90's
// single rand(7) branch gate across the two spawn systems, so its stream
// consumption differs from the binary's from the first pass even though
// the per-branch spawn probabilities match. This runner therefore compares
// the port against the model of its own composed draw order (the
// regression net), not against binaryAmbientTrace.

import {
    AmbientKind,
    compareAmbientTrace,
} from "../nova/src/nova_plugin/ambient_harness";

const FLEET_ELIGIBLE = 10;
const PERS_ELIGIBLE = 100;

async function main(): Promise<void> {
    const seedCount = Number(process.argv[2] ?? 1000);
    const passes = Number(process.argv[3] ?? 4);
    console.log(`ambient trace: ${seedCount} seeds × ${passes} passes `
        + `(flët eligible ${FLEET_ELIGIBLE}, përs eligible ${PERS_ELIGIBLE})`);

    const passed: Record<AmbientKind, number> = { fleet: 0, pers: 0 };
    let failed = false;
    for (let seed = 1; seed <= seedCount; seed++) {
        const cells: string[] = [];
        for (const kind of ["fleet", "pers"] as const) {
            const result = await compareAmbientTrace(kind, seed,
                kind === "fleet" ? FLEET_ELIGIBLE : PERS_ELIGIBLE, passes);
            if (result.ok) {
                passed[kind]++;
                cells.push(`${kind} PASS (${result.spawnCount} spawns)`);
            }
            else {
                failed = true;
                cells.push(`${kind} FAIL`);
                console.log(`  seed ${seed} ${result.firstDivergence}`);
            }
        }
        if (seed <= 20 || seed % 50 === 0 || !passed.fleet || !passed.pers) {
            // Keep the table short for large runs: early seeds in full,
            // then only failures and periodic heartbeats.
            console.log(`seed ${String(seed).padStart(4)}  ${cells.join("  ")}`);
        }
        else if (seed % 10 === 0) {
            console.log(`seed ${String(seed).padStart(4)}  ...`);
        }
    }

    console.log(`ambient trace: fleet ${passed.fleet}/${seedCount} matched, `
        + `përs ${passed.pers}/${seedCount} matched`);
    process.exitCode = failed ? 1 : 0;
}

void main();
