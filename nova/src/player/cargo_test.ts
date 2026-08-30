// Headless specs for the player cargo hold (player/cargo.ts): used-ton
// sums, capacity-capped loads, never-negative unloads, the signed
// take-what-fits application of mission/boarding 'cargo' effects, and the
// jünk illegal-scan mask. Run with:
//   npx esbuild --bundle --platform=node nova/src/player/cargo_test.ts \
//       --outfile=/tmp/cargo_test.js && node_modules/.bin/jasmine /tmp/cargo_test.js

import "jasmine";
import {
    applyCargoEffects,
    cargoIllegalMask,
    cargoOf,
    cargoUsedTons,
    CargoEntry,
    isStandardCommodity,
    tryLoadCargo,
    tryUnloadCargo,
} from "./cargo";


function hold(...entries: CargoEntry[]): CargoEntry[] {
    return entries;
}


describe("cargo hold", () => {

    it("sums used tons across entries", () => {
        expect(cargoUsedTons([])).toBe(0);
        expect(cargoUsedTons(hold({ type: 0, qty: 10 }, { type: 128, qty: 3 })))
            .toBe(13);
    });

    it("counts the tons of one type", () => {
        const cargo = hold({ type: 0, qty: 10 }, { type: 128, qty: 3 },
            { type: 0, qty: 2 });
        expect(cargoOf(cargo, 0)).toBe(12);
        expect(cargoOf(cargo, 128)).toBe(3);
        expect(cargoOf(cargo, 137)).toBe(0);
    });

    it("tells commodities (0-5) from jünk raw ids", () => {
        expect(isStandardCommodity(0)).toBeTrue();
        expect(isStandardCommodity(5)).toBeTrue();
        expect(isStandardCommodity(6)).toBeFalse();
        expect(isStandardCommodity(128)).toBeFalse();
        expect(isStandardCommodity(-1)).toBeFalse();
    });

    it("loads within capacity and merges into the existing entry", () => {
        const cargo = hold({ type: 0, qty: 10 });
        const result = tryLoadCargo(cargo, 0, 5, 20);
        expect(result.moved).toBe(5);
        expect(result.cargo).toEqual([{ type: 0, qty: 15 }]);
        // A distinct type gets its own entry.
        const mixed = tryLoadCargo(result.cargo, 128, 4, 20);
        expect(mixed.cargo).toEqual([{ type: 0, qty: 15 }, { type: 128, qty: 4 }]);
    });

    it("caps loads at the free tons (take what fits)", () => {
        const result = tryLoadCargo(hold(), 3, 10, 4);
        expect(result.moved).toBe(4);
        expect(result.cargo).toEqual([{ type: 3, qty: 4 }]);
        // No free tons, no load.
        expect(tryLoadCargo(hold(), 3, 10, 0)).toEqual({ cargo: hold(), moved: 0 });
        // Negative and zero requests are no-ops.
        expect(tryLoadCargo(hold(), 3, 0, 10).moved).toBe(0);
        expect(tryLoadCargo(hold(), 3, -5, 10).moved).toBe(0);
    });

    it("does not mutate the hold it is given", () => {
        const cargo = hold({ type: 0, qty: 10 });
        tryLoadCargo(cargo, 0, 5, 20);
        tryUnloadCargo(cargo, 0, 5);
        expect(cargo).toEqual([{ type: 0, qty: 10 }]);
    });

    it("unloads at most what the hold carries and drops empty entries", () => {
        const partial = tryUnloadCargo(hold({ type: 0, qty: 10 }), 0, 4);
        expect(partial.moved).toBe(4);
        expect(partial.cargo).toEqual([{ type: 0, qty: 6 }]);
        // Unloading the last ton removes the entry.
        const emptied = tryUnloadCargo(partial.cargo, 0, 6);
        expect(emptied.moved).toBe(6);
        expect(emptied.cargo).toEqual([]);
        // Never below zero: more than carried, or nothing of the type.
        expect(tryUnloadCargo(hold({ type: 0, qty: 2 }), 0, 10).moved).toBe(2);
        expect(tryUnloadCargo(hold(), 128, 5)).toEqual({ cargo: hold(), moved: 0 });
    });

    it("applies signed cargo effects: loads, unloads, ignores the rest", () => {
        const state = { cargo: hold({ type: 0, qty: 5 }) };
        const result = applyCargoEffects(state, [
            { kind: "cargo", type: 0, qty: 7 },     // load more food
            { kind: "cargo", type: 0, qty: -3 },    // ...then drop some
            { kind: "cargo", type: 128, qty: 4 },   // jünk aboard
            { kind: "pay", amount: 100 },           // not cargo: ignored
            { kind: "cargo", type: 2, qty: 0 },     // nothing: ignored
        ], null);
        expect(result).toEqual({ loaded: 11, unloaded: 3 });
        expect(state.cargo).toEqual([{ type: 0, qty: 9 }, { type: 128, qty: 4 }]);
    });

    it("caps applied loads at the free tons, sharing one budget", () => {
        const state = { cargo: hold() };
        // Ten free tons; two seven-ton loads take what fits.
        const result = applyCargoEffects(state, [
            { kind: "cargo", type: 0, qty: 7 },
            { kind: "cargo", type: 1, qty: 7 },
        ], 10);
        expect(result).toEqual({ loaded: 10, unloaded: 0 });
        expect(state.cargo).toEqual([{ type: 0, qty: 7 }, { type: 1, qty: 3 }]);
    });

    it("lets an unload in the same batch free space for a later load", () => {
        const state = { cargo: hold({ type: 0, qty: 10 }) };
        // Two free tons at call time; dropping six frees six more.
        const result = applyCargoEffects(state, [
            { kind: "cargo", type: 0, qty: -6 },
            { kind: "cargo", type: 1, qty: 8 },
        ], 2);
        expect(result).toEqual({ loaded: 8, unloaded: 6 });
        expect(state.cargo).toEqual([{ type: 0, qty: 4 }, { type: 1, qty: 8 }]);
    });

    it("never unloads below zero when dropping more than carried", () => {
        const state = { cargo: hold({ type: 0, qty: 3 }) };
        const result = applyCargoEffects(state, [{ kind: "cargo", type: 0, qty: -10 }],
            null);
        expect(result).toEqual({ loaded: 0, unloaded: 3 });
        expect(state.cargo).toEqual([]);
    });

    it("ORs the scan masks of carried jünk only", () => {
        const masks = new Map<number, number>([
            [128, 0x0800],
            [137, 0xf597],
            [149, 0x0010],
        ]);
        const cargo = hold(
            { type: 0, qty: 10 },      // commodity: never in the mask
            { type: 128, qty: 2 },
            { type: 137, qty: 1 },
            { type: 149, qty: 3 },
        );
        expect(cargoIllegalMask(cargo, masks)).toBe(0x0800 | 0xf597 | 0x0010);
        // Commodities alone are legal.
        expect(cargoIllegalMask(hold({ type: 5, qty: 4 }), masks)).toBe(0);
        // Unknown jünk types (no data) contribute nothing.
        expect(cargoIllegalMask(hold({ type: 999, qty: 1 }), masks)).toBe(0);
        expect(cargoIllegalMask([], masks)).toBe(0);
    });
});
