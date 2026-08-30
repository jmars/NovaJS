// Pure capture-odds specs (P4 of cargo+capture): the weighted-crew formula
// and its clamp, the marine-outfit aggregation, and the seeded roll. Run
// with:
//   npx esbuild --bundle --platform=node nova/src/missions/capture_test.ts \
//       --outfile=/tmp/capture_test.js && node_modules/.bin/jasmine /tmp/capture_test.js

import "jasmine";
import { getDefaultOutfitData } from "novadatainterface/OutiftData";
import { makeRng } from "../player/pilot_files";
import {
    CAPTURE_ODDS_MAX,
    CAPTURE_ODDS_MIN,
    CAPTURE_ODDS_WEIGHT,
    captureOdds,
    effectivePlayerCrew,
    outfitMarines,
    rollCapture,
} from "./capture";

// An outfit whose marine contribution is (crew, oddsPercent).
function marinesOutfit(crew: number, oddsPercent: number) {
    return { ...getDefaultOutfitData(), marines: { crew, oddsPercent } };
}

describe("capture odds", () => {
    it("weights the crew ratio: equal crews sit at 37.5%", () => {
        expect(CAPTURE_ODDS_WEIGHT).toEqual(75);
        expect(captureOdds(10, 10, 0)).toBeCloseTo(37.5);
        expect(captureOdds(30, 70, 0)).toBeCloseTo(22.5);
        expect(captureOdds(70, 30, 0)).toBeCloseTo(52.5);
    });

    it("adds the marines percent bonus on top of the ratio", () => {
        expect(captureOdds(30, 70, 25)).toBeCloseTo(47.5);
    });

    it("clamps to 5..95 so no board is certain or hopeless", () => {
        expect(CAPTURE_ODDS_MIN).toEqual(5);
        expect(CAPTURE_ODDS_MAX).toEqual(95);
        expect(captureOdds(0, 10000, 0)).toEqual(5);
        expect(captureOdds(10000, 1, 25)).toEqual(95);
        expect(captureOdds(30, 70, 500)).toEqual(95);
        expect(captureOdds(30, 70, -500)).toEqual(5);
    });

    it("treats an all-around crewless board as equal crews", () => {
        expect(captureOdds(0, 0, 0)).toBeCloseTo(37.5);
    });
});

describe("effective player crew", () => {
    it("adds the owned marine crew to the ship's crew", () => {
        expect(effectivePlayerCrew(6, 4)).toEqual(10);
        expect(effectivePlayerCrew(6, 0)).toEqual(6);
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

    it("always captures at 100 and never at 0", () => {
        for (const seed of [1, 42, 999999]) {
            expect(rollCapture(makeRng(seed), 100)).toBeTrue();
            expect(rollCapture(makeRng(seed), 0)).toBeFalse();
        }
    });
});
