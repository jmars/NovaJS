// Headless specs for the jump-day commodity decay (player/cargo_decay.ts):
// tribble doubling with the hold-capacity cap, perishable ceil-10% decay to
// zero, untouched standard commodities, identity for unflagged/unknown jünk,
// and determinism. Run with:
//   npx esbuild --bundle --platform=node nova/src/player/cargo_decay_test.ts \
//       --outfile=/tmp/dc.js && node_modules/.bin/jasmine /tmp/dc.js

import "jasmine";
import {
    applyCargoDecay,
    DecayEffect,
    PERISHABLE_FLAG,
    TRIBBLE_FLAG,
} from "./cargo_decay";
import { CargoEntry } from "./cargo";


// flagsOf over a synthetic jünk table: 128 tribbles, 129 perishable, 130
// both, 131 unflagged (stock data has no flagged jünk — all flags=0).
const FLAGS: Record<number, number> = {
    128: TRIBBLE_FLAG,
    129: PERISHABLE_FLAG,
    130: TRIBBLE_FLAG | PERISHABLE_FLAG,
    131: 0,
};

function flagsOf(type: number): number | undefined {
    return FLAGS[type];
}

function decay(cargo: CargoEntry[], freeTons: number | null):
    { cargo: CargoEntry[]; effects: DecayEffect[] } {
    return applyCargoDecay(cargo, flagsOf, freeTons);
}


describe("cargo decay", () => {

    it("doubles tribble entries", () => {
        const result = decay([{ type: 128, qty: 10 }], 100);
        expect(result.cargo).toEqual([{ type: 128, qty: 20 }]);
        expect(result.effects).toEqual([{ type: 128, qty: 10 }]);
    });

    it("caps tribble growth at the free tonnage", () => {
        const result = decay([{ type: 128, qty: 10 }], 4);
        expect(result.cargo).toEqual([{ type: 128, qty: 14 }]);
        expect(result.effects).toEqual([{ type: 128, qty: 4 }]);
    });

    it("grows tribbles unconditionally when capacity is unknown", () => {
        const result = decay([{ type: 128, qty: 10 }], null);
        expect(result.cargo).toEqual([{ type: 128, qty: 20 }]);
    });

    it("spends the free budget across entries and lets decay refund it", () => {
        // 6 free tons: the first entry eats them all, the second grows not
        // at all — but the perishable below frees 2, which a later tribble
        // entry can then use.
        const result = decay([
            { type: 128, qty: 10 },
            { type: 129, qty: 20 },
            { type: 128, qty: 1 },
        ], 6);
        expect(result.cargo).toEqual([
            { type: 128, qty: 16 },   // +6 (all the free space)
            { type: 129, qty: 18 },   // lost ceil(20 * .10) = 2
            { type: 128, qty: 2 },    // +1 (doubles, within the freed space)
        ]);
        expect(result.effects).toEqual([
            { type: 128, qty: 6 },
            { type: 129, qty: -2 },
            { type: 128, qty: 1 },
        ]);
    });

    it("decays perishables by ceil(10%) per day, down to zero", () => {
        const result = decay([{ type: 129, qty: 100 }], 50);
        expect(result.cargo).toEqual([{ type: 129, qty: 90 }]);
        expect(result.effects).toEqual([{ type: 129, qty: -10 }]);
        // Rounding rounds up: 5 tons loses 1.
        expect(decay([{ type: 129, qty: 5 }], 50).cargo)
            .toEqual([{ type: 129, qty: 4 }]);
        // The last ton always spoils, so the entry empties and is removed.
        expect(decay([{ type: 129, qty: 1 }], 50))
            .toEqual({ cargo: [], effects: [{ type: 129, qty: -1 }] });
        // 2 tons loses ceil(0.2) = 1, halving instead of emptying.
        expect(decay([{ type: 129, qty: 2 }], 50).cargo)
            .toEqual([{ type: 129, qty: 1 }]);
    });

    it("never touches standard commodities (types 0-5)", () => {
        const cargo: CargoEntry[] = [
            { type: 0, qty: 30 },
            { type: 5, qty: 7 },
        ];
        const result = decay(cargo, 10);
        expect(result.cargo).toEqual(cargo);
        expect(result.effects).toEqual([]);
    });

    it("leaves unflagged and unknown jünk unchanged", () => {
        const result = decay([
            { type: 131, qty: 10 },   // known jünk, flags 0
            { type: 999, qty: 10 },   // unknown raw id (flagsOf -> undefined)
        ], 100);
        expect(result.cargo).toEqual([{ type: 131, qty: 10 },
            { type: 999, qty: 10 }]);
        expect(result.effects).toEqual([]);
    });

    it("is a no-op on an empty hold", () => {
        expect(decay([], 100)).toEqual({ cargo: [], effects: [] });
    });

    it("applies both flags on one jünk tribbles-first", () => {
        // Doubling then losing ceil(10%): 10 -> 20 -> 18.
        const result = decay([{ type: 130, qty: 10 }], 100);
        expect(result.cargo).toEqual([{ type: 130, qty: 18 }]);
        expect(result.effects).toEqual([{ type: 130, qty: 10 },
            { type: 130, qty: -2 }]);
    });

    it("is deterministic — same input, same output", () => {
        const cargo: CargoEntry[] = [
            { type: 0, qty: 12 },
            { type: 128, qty: 3 },
            { type: 129, qty: 7 },
            { type: 131, qty: 40 },
        ];
        const first = decay(cargo, 25);
        for (let i = 0; i < 5; i++) {
            expect(decay(cargo, 25)).toEqual(first);
        }
        expect(first.cargo).toEqual([{ type: 0, qty: 12 },
            { type: 128, qty: 6 }, { type: 129, qty: 6 },
            { type: 131, qty: 40 }]);
        expect(first.effects).toEqual([{ type: 128, qty: 3 },
            { type: 129, qty: -1 }]);
    });

    it("does not mutate the input hold", () => {
        const cargo: CargoEntry[] = [{ type: 128, qty: 10 }];
        decay(cargo, 100);
        expect(cargo).toEqual([{ type: 128, qty: 10 }]);
    });

});
