// Headless specs for the pure flët hyperspace-entry quote resolver. Run with:
//   npx esbuild --bundle --platform=node nova/src/spaceport/fleet_quote_test.ts \
//       --outfile=/tmp/fleet_quote_test.js && node_modules/.bin/jasmine /tmp/fleet_quote_test.js

import { getDefaultStringSetData } from "novadatainterface/StringSetData";
import { makeRng } from "../player/pilot_files";
import { fleetQuote, fleetQuoteFromSet } from "./fleet_quote";


// An rng replaying a fixed sequence, so exact expectations can be written.
function seqRng(values: number[]): () => number {
    let i = 0;
    return () => values[i++ % values.length];
}

describe("fleet quote resolver", () => {
    it("replaces every '#' with a random digit", () => {
        // Pick index 1 (0.75 * 2), then digits 4, 0, 9.
        const rng = seqRng([0.75, 0.4, 0.0, 0.9]);
        expect(fleetQuote(128, ["No '##' here", "Bogeys #-#-#"], rng))
            .toEqual("Bogeys 4-0-9");
    });

    it("picks deterministically under a seeded rng", () => {
        const strings = ["Alpha", "Bravo", "Charlie"];
        const first = fleetQuote(500, strings, makeRng(12345));
        const second = fleetQuote(500, strings, makeRng(12345));
        expect(first).toEqual(second!);
        expect(strings).toContain(first!);
    });

    it("yields the same digits for the same seed", () => {
        const first = fleetQuote(500, ["Fuel: # weeks"], makeRng(777));
        const second = fleetQuote(500, ["Fuel: # weeks"], makeRng(777));
        expect(first).toEqual(second);
        expect(first!).toMatch(/^Fuel: \d weeks$/);
    });

    it("returns null when the quote id is negative", () => {
        let called = false;
        const rng = () => { called = true; return 0; };
        expect(fleetQuote(-1, ["Anything"], rng)).toBeNull();
        // No rng consumption for a missing quote.
        expect(called).toBeFalse();
    });

    it("returns null when the string set is missing or empty", () => {
        expect(fleetQuote(128, null, seqRng([0.5]))).toBeNull();
        expect(fleetQuote(128, undefined, seqRng([0.5]))).toBeNull();
        expect(fleetQuote(128, [], seqRng([0.5]))).toBeNull();
    });

    it("resolves from a StringSetData, or null when it is missing", () => {
        const set = { ...getDefaultStringSetData(), strings: ["Pay: # cr"] };
        expect(fleetQuoteFromSet(300, set, seqRng([0.25, 0.35])))
            .toEqual("Pay: 3 cr");
        expect(fleetQuoteFromSet(300, null, seqRng([0.25]))).toBeNull();
        expect(fleetQuoteFromSet(-1, set, seqRng([0.25]))).toBeNull();
    });
});
