// Phase B: validate the ambient trace against the REAL nova:128 data (the
// start system), recovered from the binary's stock .rez via Ghidra + the
// audit. Two guarantees:
//
//   (1) The port matches the reference model for the real shape — i.e. it
//       consumes the same engine-LCG draws, lands the same ships, and
//       assigns the same dûde governments that the binary's weighted dûde
//       table does.
//   (2) The real system's numbers reproduce the binary's documented
//       per-landing spawn statistics: ~4 ships/landing (2.94 dûde + ~0.77
//       sÿst peripherals + ~0.27 flët) and a dûde-government distribution
//       matching the real weight table.
//
// Run:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/ambient_real_test.ts \
//       --outfile=/tmp/ambient_real_test.js && node_modules/.bin/jasmine /tmp/ambient_real_test.js

import "jasmine";
import {
    ambientEventTrace,
    BranchShape,
} from "./ambient_model";
import { compareAmbientTrace, EVENTS } from "./ambient_harness";

// Real nova:128 (Moonrise? — Kania's start system) recovered from the
// stock data:
//   rollCount 4
//   sÿst peripheral përs (active only): 510@50%, 128@10%, 296@15%,
//     157@1%, 158@1%  (155/156/227 are inactive here)
//   dûde table weights→govt: 128+130→Fed(40), 134→Trader(12),
//     136→Polaris(5), 211→Sigma(12), 210→Pyro(10), 233+260→Marauder(21)
//   eligible flëts: 41 (linkSyst match), avg ~3.6 ships/fleet
const REAL_NOVA128_SHAPE: BranchShape = {
    fleetEligible: 41,
    persEligible: 5,    // the përs-table scan's eligible pers = the peripheral
    // përs below (they are real pers resources, so the table branch can
    // pick them too); the contribution is tiny (5/1024 per roll).
    dudePairWeight: 100,
    dudeShipWeight: 100,
    // Representative of the 41 eligible fleets' average (lead + ~2.5
    // escorts ≈ 3.5 ships): the model uses one uniform escort config, so
    // the flët contribution is approximate; the dûde + peripheral parts are
    // exact.
    fleetEscorts: [{ min: 0, max: 5 }],
    peripherals: [
        { id: "nova:510", percent: 50 },
        { id: "nova:128", percent: 10 },
        { id: "nova:296", percent: 15 },
        { id: "nova:157", percent: 1 },
        { id: "nova:158", percent: 1 },
    ],
    dudeGovts: [
        { govt: "nova:128", weight: 40 },  // Federation (dude 128+130)
        { govt: "nova:157", weight: 12 },  // Trader (dude 134)
        { govt: "nova:147", weight: 5 },   // Polaris (dude 136)
        { govt: "nova:172", weight: 12 },  // Sigma (dude 211)
        { govt: "nova:173", weight: 10 },  // Pyro (dude 210)
        { govt: "nova:178", weight: 21 },  // Marauder (dude 233+260)
    ],
    persIds: ["nova:510", "nova:128", "nova:296", "nova:157", "nova:158"],
};

// Model-only statistics over many landings (the model reproduces the
// binary's exact draw behavior; the port-match is asserted separately).
function stats(seeds: number, events: number) {
    let landings = 0;
    let dude = 0;
    let peripheral = 0;
    let total = 0;
    const govtCount: Record<string, number> = {};
    for (let seed = 1; seed <= seeds; seed++) {
        const trace = ambientEventTrace(seed, REAL_NOVA128_SHAPE, 4, events);
        landings += events;
        for (const entry of trace.trace) {
            if (!entry.spawned) {
                continue;
            }
            total++;
            if (entry.branch === "dude") {
                dude++;
                if (entry.govt) {
                    govtCount[entry.govt] = (govtCount[entry.govt] ?? 0) + 1;
                }
            }
            else if (entry.branch === "peripheral") {
                peripheral++;
            }
        }
    }
    return {
        landings,
        dudePerLanding: dude / landings,
        peripheralPerLanding: peripheral / landings,
        totalPerLanding: total / landings,
        govtFraction: Object.fromEntries(
            Object.entries(govtCount)
                .map(([govt, count]) => [govt, count / Math.max(1, dude)])),
    };
}

describe("ambient trace vs real nova:128 data", () => {
    it("the port matches the model for the real shape (draws, keys, dûde"
        + " governments)", async () => {
        // A handful of seeds over the default event count: proves the port
        // reproduces the binary's real-data draw sequence, spawn keys and
        // weighted dûde government assignment (spawns stay under the 55
        // slot cap across 4 events).
        for (let seed = 1; seed <= 6; seed++) {
            const result = await compareAmbientTrace(seed, EVENTS, true,
                REAL_NOVA128_SHAPE);
            expect(`seed ${seed}: ${result.firstDivergence ?? "match"}`)
                .toEqual(`seed ${seed}: match`);
            expect(result.ok).toBeTrue();
        }
    });

    it("reproduces the audit's per-landing spawn counts", () => {
        const s = stats(60, 50);   // 3000 landings
        // dûde: each of the 4 rolls is dûde when gate-pers != 0 and
        // gate-fleet != 0, i.e. (6/7)^2 = 36/49.
        expect(s.dudePerLanding).toBeCloseTo(4 * 36 / 49, 1);
        // peripherals: sum of active percents / 100.
        const peripheralExpected = REAL_NOVA128_SHAPE.peripherals
            .reduce((sum, p) => sum + p.percent, 0) / 100;
        expect(s.peripheralPerLanding).toBeCloseTo(peripheralExpected, 1);
        // Total ≈ 2.94 dûde + 0.77 peripherals + ~0.27 flët ≈ 4 ships.
        expect(s.totalPerLanding).toBeGreaterThan(3.0);
        expect(s.totalPerLanding).toBeLessThan(5.0);
    });

    it("assigns dûde governments in the real table's proportions", () => {
        const s = stats(60, 50);
        for (const { govt, weight } of REAL_NOVA128_SHAPE.dudeGovts) {
            const expected = weight / 100;
            const got = s.govtFraction[govt] ?? 0;
            // Statistical tolerance over ~3000 landings (≈8800 dûde spawns).
            expect(Math.abs(got - expected))
                .withContext(`govt ${govt}: expected ${expected}, got ${got}`)
                .toBeLessThan(0.03);
        }
    });
});
