// Pure capture-odds specs (P4 of cargo+capture): the recovered engine
// formula (crew pool over 10× own crew), the marine-outfit aggregation, and
// the jittered, clamped seeded roll. Run with:
//   npx esbuild --bundle --platform=node nova/src/missions/capture_test.ts \
//       --outfile=/tmp/capture_test.js && node_modules/.bin/jasmine /tmp/capture_test.js

import "jasmine";
import { getDefaultOutfitData } from "novadatainterface/OutiftData";
import { makeRng } from "../player/pilot_files";
import {
    CAPTURE_ODDS_BASE_PERCENT,
    CAPTURE_ODDS_MAX,
    CAPTURE_ODDS_MIN,
    captureOdds,
    outfitMarines,
    rollCapture,
} from "./capture";

// An outfit whose marine contribution is (crew, oddsPercent).
function marinesOutfit(crew: number, oddsPercent: number) {
    return { ...getDefaultOutfitData(), marines: { crew, oddsPercent } };
}

describe("capture odds", () => {
    it("weights the boarder's crew pool, not the defender's", () => {
        // pool / (ownCrew * 10) * 100: 10% flat without marines, whatever
        // the defender fields — the engine never reads the defender's crew.
        expect(CAPTURE_ODDS_BASE_PERCENT).toEqual(10);
        expect(captureOdds(10, 0, 0)).toEqual(10);
        expect(captureOdds(20, 0, 0)).toEqual(10);
        expect(captureOdds(20, 10, 0)).toEqual(15);  // 30/(20*10)*100
        expect(captureOdds(10, 30, 0)).toEqual(40);  // 40/(10*10)*100
    });

    it("adds the marines percent bonus on top of the pool", () => {
        expect(captureOdds(20, 10, 25)).toEqual(40);
    });

    it("keeps a crewless boarder out of the formula (glue auto-captures)", () => {
        expect(captureOdds(0, 10000, 0)).toEqual(100);
    });
});

describe("outfit marines", () => {
    it("aggregates crew and odds percent over owned outfits", () => {
        const marines = outfitMarines([
            [marinesOutfit(5, 0), 2],  // 10 crew
            [marinesOutfit(1, 10), 3], // 3 crew, 30%
            [marinesOutfit(0, 5), 1],  // 5% (a negative ModVal adds percent)
        ]);
        expect(marines.crew).toEqual(13);
        expect(marines.oddsPercent).toEqual(35);
    });

    it("is empty without outfits", () => {
        expect(outfitMarines([])).toEqual({ crew: 0, oddsPercent: 0 });
    });
});

describe("capture roll", () => {
    it("is deterministic under a fixed seed", () => {
        const first = rollCapture(makeRng(1234), 50);
        const second = rollCapture(makeRng(1234), 50);
        expect(second).toEqual(first);
    });

    it("jitters, clamps to 1..75, then rolls rand(100) <= odds", () => {
        expect(CAPTURE_ODDS_MIN).toEqual(1);
        expect(CAPTURE_ODDS_MAX).toEqual(75);
        // odds 100: even the worst jitter (100-5=95) clamps at 75 and
        // rand(100) <= 75 always holds.
        for (const seed of [1, 42, 999999]) {
            expect(rollCapture(makeRng(seed), 100)).toBeTrue();
        }
        // odds 0: the best jitter (0+5=5) survives the clamp at 1, but
        // capture needs rand(100) <= 1 — 1% per attempt, not certainty.
        let hits = 0;
        for (let seed = 1; seed <= 2000; seed++) {
            if (rollCapture(makeRng(seed), 0)) hits++;
        }
        expect(hits).toBeGreaterThan(0);
        expect(hits).toBeLessThan(200);
    });
});
