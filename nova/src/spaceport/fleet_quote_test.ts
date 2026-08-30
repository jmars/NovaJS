// Headless specs for the pure flët hyperspace-entry quote resolver
// (FUN_004259b0's '#' rule on the shared engine LCG). Run with:
//   npx esbuild --bundle --platform=node nova/src/spaceport/fleet_quote_test.ts \
//       --outfile=/tmp/fleet_quote_test.js && node_modules/.bin/jasmine /tmp/fleet_quote_test.js

import { getDefaultStringSetData } from "novadatainterface/StringSetData";
import { seedRng } from "../player/pilot_files";
import { fleetQuote, fleetQuoteFromSet } from "./fleet_quote";


describe("fleet quote resolver", () => {
    it("replaces the first '#' of a run with 1-9 and later '#' with 0-9", () => {
        // "##-##": each run starts with a 1-9 digit, its second '#' is 0-9.
        seedRng(12345);
        expect(fleetQuote(128, ["A ##-## B"])).toMatch(/^A [1-9][0-9]-[1-9][0-9] B$/);
    });

    it("restarts the nonzero digit after a separator", () => {
        // "#-#-#" is three separate runs, so every digit is 1-9.
        seedRng(777);
        expect(fleetQuote(128, ["Bogeys #-#-#"])).toMatch(/^Bogeys [1-9]-[1-9]-[1-9]$/);
    });

    it("picks deterministically under a seeded stream", () => {
        const strings = ["Alpha", "Bravo", "Charlie"];
        seedRng(12345);
        const first = fleetQuote(500, strings);
        seedRng(12345);
        const second = fleetQuote(500, strings);
        expect(first).toEqual(second!);
        expect(strings).toContain(first!);
    });

    it("yields the same digits for the same seed", () => {
        seedRng(777);
        const first = fleetQuote(500, ["Fuel: # weeks"]);
        seedRng(777);
        const second = fleetQuote(500, ["Fuel: # weeks"]);
        expect(first).toEqual(second);
        expect(first!).toMatch(/^Fuel: [1-9] weeks$/);
    });

    it("returns null when the quote id is negative", () => {
        seedRng(1);
        expect(fleetQuote(-1, ["Anything"])).toBeNull();
    });

    it("returns null when the string set is missing or empty", () => {
        seedRng(1);
        expect(fleetQuote(128, null)).toBeNull();
        expect(fleetQuote(128, undefined)).toBeNull();
        expect(fleetQuote(128, [])).toBeNull();
    });

    it("resolves from a StringSetData, or null when it is missing", () => {
        seedRng(999);
        const set = { ...getDefaultStringSetData(), strings: ["Pay: # cr"] };
        expect(fleetQuoteFromSet(300, set)).toMatch(/^Pay: [1-9] cr$/);
        expect(fleetQuoteFromSet(300, null)).toBeNull();
        expect(fleetQuoteFromSet(-1, set)).toBeNull();
    });
});
