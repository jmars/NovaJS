// Headless specs for the jump-day commodity decay (player/cargo_decay.ts):
// the engine's real schedule — effects only on dayCount % 250 == 0 days,
// +1 ton for tribbles, -1 ton for perishables, untouched standard
// commodities, identity for unflagged/unknown jünk, and determinism. Run
// with:
//   npx esbuild --bundle --platform=node nova/src/player/cargo_decay_test.ts \
//       --outfile=/tmp/dc.js && node_modules/.bin/jasmine /tmp/dc.js

import "jasmine";
import {
    applyCargoDecay,
    DECAY_PERIOD_DAYS,
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

// A 250th-jump day: the only day decay runs.
const TICK = DECAY_PERIOD_DAYS;

function decay(cargo: CargoEntry[], freeTons: number | null,
    dayCount: number = TICK): { cargo: CargoEntry[]; effects: DecayEffect[] } {
    return applyCargoDecay(cargo, flagsOf, freeTons, dayCount);
}


describe("cargo decay", () => {

    it("only runs on 250th-jump days", () => {
        for (const day of [0, 1, 249, 251, 499, -250]) {
            expect(decay([{ type: 128, qty: 10 }], 100, day))
                .toEqual({ cargo: [{ type: 128, qty: 10 }], effects: [] });
        }
        expect(decay([{ type: 128, qty: 10 }], 100, 250)
            .cargo).toEqual([{ type: 128, qty: 11 }]);
        expect(decay([{ type: 128, qty: 10 }], 100, 500)
            .cargo).toEqual([{ type: 128, qty: 11 }]);
    });

    it("grows tribble entries by one ton", () => {
        const result = decay([{ type: 128, qty: 10 }], 100);
        expect(result.cargo).toEqual([{ type: 128, qty: 11 }]);
        expect(result.effects).toEqual([{ type: 128, qty: 1 }]);
    });

    it("caps tribble growth at the free tonnage", () => {
        const result = decay([{ type: 128, qty: 10 }], 0);
        expect(result.cargo).toEqual([{ type: 128, qty: 10 }]);
        expect(result.effects).toEqual([]);
    });

    it("grows tribbles unconditionally when capacity is unknown", () => {
        const result = decay([{ type: 128, qty: 10 }], null);
        expect(result.cargo).toEqual([{ type: 128, qty: 11 }]);
    });

    it("decays perishables by one ton per tick, down to zero", () => {
        const result = decay([{ type: 129, qty: 5 }], 50);
        expect(result.cargo).toEqual([{ type: 129, qty: 4 }]);
        expect(result.effects).toEqual([{ type: 129, qty: -1 }]);
        // The last ton spoils, so the entry empties and is removed.
        expect(decay([{ type: 129, qty: 1 }], 50))
            .toEqual({ cargo: [], effects: [{ type: 129, qty: -1 }] });
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
        // Growing 1 then losing 1 nets out: the entry is unchanged but both
        // effects are reported.
        const result = decay([{ type: 130, qty: 10 }], 100);
        expect(result.cargo).toEqual([{ type: 130, qty: 10 }]);
        expect(result.effects).toEqual([{ type: 130, qty: 1 },
            { type: 130, qty: -1 }]);
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
            { type: 128, qty: 4 }, { type: 129, qty: 6 },
            { type: 131, qty: 40 }]);
        expect(first.effects).toEqual([{ type: 128, qty: 1 },
            { type: 129, qty: -1 }]);
    });

    it("does not mutate the input hold", () => {
        const cargo: CargoEntry[] = [{ type: 128, qty: 10 }];
        decay(cargo, 100);
        expect(cargo).toEqual([{ type: 128, qty: 10 }]);
    });

});
