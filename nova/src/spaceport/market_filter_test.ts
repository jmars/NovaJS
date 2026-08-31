// Headless specs for the market filters (FUN_0046a220 outfitter list /
// FUN_00469e90 shipyard list). Run like purchase_test.ts.

import "jasmine";
import { getDefaultOutfitData, OutfitData } from "novadatainterface/OutiftData";
import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import { TestContext } from "novadatainterface/expressions";
import { makePlayerState } from "../missions/test_fixtures";
import {
    dailyMarketRoll, MarketContext, orderOutfits, orderShips, outfitListed,
    shipListed,
} from "./market_filter";

function makeTestCtx(bits: Set<number> = new Set()): TestContext {
    return {
        bits: { get: (bit: number) => bits.has(bit) },
        gender: 1,
        hasOutfit: () => false,
        exploredSystem: () => false,
    };
}

function makeCtx(overrides: Partial<MarketContext> = {}): MarketContext {
    return {
        planetTech: 10,
        planetSpecialTech: [55],
        maskContributes: [0, 0],
        testCtx: makeTestCtx(),
        rollFor: () => 50,
        ...overrides,
    };
}

function makeOutfit(id: string, overrides: Partial<OutfitData> = {}): OutfitData {
    // Stocked by default (100 = always in stock), like most real outfits.
    return { ...getDefaultOutfitData(), id, name: id, stockPercent: 100,
        ...overrides };
}

function makeShip(id: string, overrides: Partial<ShipData> = {}): ShipData {
    return { ...getDefaultShipData(), id, name: id, ...overrides };
}

describe("outfit market filter (FUN_0046a220)", function() {
    it("tech gate: rawTech <= planet tech, or a special-tech match", function() {
        const ctx = makeCtx();
        expect(outfitListed(makeOutfit("nova:128", { rawTech: 10 }), false, ctx))
            .toBeTrue();
        expect(outfitListed(makeOutfit("nova:128", { rawTech: 11 }), false, ctx))
            .toBeFalse();
        // Special techs sell above the planet's tech...
        expect(outfitListed(makeOutfit("nova:128", { rawTech: 55 }), false, ctx))
            .toBeTrue();
        // ...but only on an exact match.
        expect(outfitListed(makeOutfit("nova:128", { rawTech: 56 }), false, ctx))
            .toBeFalse();
    });

    it("AvailBits expression only evaluated with the 0x4000 flag", function() {
        const gated = {
            flags: 0x4000, availBits: "b78",
        };
        const bits = new Set([78]);
        expect(outfitListed(makeOutfit("nova:128", gated), false,
            makeCtx({ testCtx: makeTestCtx(bits) }))).toBeTrue();
        expect(outfitListed(makeOutfit("nova:128", gated), false, makeCtx()))
            .toBeFalse();
        // Same expression without the flag is ignored.
        expect(outfitListed(makeOutfit("nova:128", { flags: 0, availBits: "b78" }),
            false, makeCtx())).toBeTrue();
    });

    it("govt-mask check (0x100) needs (masks & require) == require", function() {
        const outfit = makeOutfit("nova:128", {
            flags: 0x100, require: [1 << 3, 1 << 5],
        });
        expect(outfitListed(outfit, false, makeCtx())).toBeFalse();
        expect(outfitListed(outfit, false,
            makeCtx({ maskContributes: [1 << 3, 0] }))).toBeFalse();
        expect(outfitListed(outfit, false,
            makeCtx({ maskContributes: [1 << 3, 1 << 5] }))).toBeTrue();
        // Without the flag the masks mean nothing.
        expect(outfitListed(makeOutfit("nova:128", {
            flags: 0, require: [1 << 3, 1 << 5],
        }), false, makeCtx())).toBeTrue();
    });

    it("stock roll: percent >= 1 and >= the daily roll", function() {
        // rollFor = 50 today.
        expect(outfitListed(makeOutfit("nova:128", { stockPercent: 0 }), false,
            makeCtx())).toBeFalse();
        expect(outfitListed(makeOutfit("nova:128", { stockPercent: 49 }), false,
            makeCtx())).toBeFalse();
        expect(outfitListed(makeOutfit("nova:128", { stockPercent: 50 }), false,
            makeCtx())).toBeTrue();
        expect(outfitListed(makeOutfit("nova:128", { stockPercent: 100 }), false,
            makeCtx())).toBeTrue();
    });

    it("owned outfits skip the expression/mask/stock checks but not the tech gate",
        function() {
            const hopeless = makeOutfit("nova:128", {
                rawTech: 99, stockPercent: 0, flags: 0x4000, availBits: "b78",
            });
            expect(outfitListed(hopeless, true, makeCtx())).toBeFalse();
            const stocked = makeOutfit("nova:128", {
                rawTech: 10, stockPercent: 0, flags: 0x4000, availBits: "b78",
            });
            expect(outfitListed(stocked, true, makeCtx())).toBeTrue();
            expect(outfitListed(stocked, false, makeCtx())).toBeFalse();
        });
});

describe("outfit order (FUN_0046a220 sort)", function() {
    it("descending displayWeight, ties ascending id, 0x1000 hides later same-weight",
        function() {
            const items = [
                makeOutfit("nova:130", { displayWeight: 100 }),
                makeOutfit("nova:128", { displayWeight: 200 }),
                // 0x1000 on 129 (weight 100) kills the LATER 100-weight
                // entries (130 and 131); 129 itself stays and 128 outranks
                // both.
                makeOutfit("nova:129", { displayWeight: 100, flags: 0x1000 }),
                makeOutfit("nova:131", { displayWeight: 100 }),
            ];
            expect(orderOutfits(items).map(o => o.id)).toEqual([
                "nova:128", "nova:129",
            ]);
        });
});

describe("ship market filter (FUN_00469e90)", function() {
    it("tech gate + stock roll; flags3 0x100 expression", function() {
        const ctx = makeCtx();
        expect(shipListed(makeShip("nova:128", { rawTech: 10, stockPercent: 100 }),
            ctx)).toBeTrue();
        expect(shipListed(makeShip("nova:128", { rawTech: 11, stockPercent: 100 }),
            ctx)).toBeFalse();
        expect(shipListed(makeShip("nova:128", {
            rawTech: 55, stockPercent: 100,
        }), ctx)).toBeTrue();
        expect(shipListed(makeShip("nova:128", {
            rawTech: 10, stockPercent: 100, flags3: 0x100, availBits: "b78",
        }), ctx)).toBeFalse();
        // 0x1000-flagged ships stay; equal-displayOrder later ships die.
        expect(shipListed(makeShip("nova:128", {
            rawTech: 10, stockPercent: 100, displayOrder: 5, flags3: 0x4000,
        }), ctx)).toBeTrue();
    });
});

describe("ship order (FUN_00469e90 sort)", function() {
    it("descending displayOrder, ties ascending id, 0x4000 hides later equal",
        function() {
            const items = [
                makeShip("nova:130", { displayOrder: 10 }),
                makeShip("nova:128", { displayOrder: 20, flags3: 0x4000 }),
                makeShip("nova:129", { displayOrder: 20 }),
                makeShip("nova:131", { displayOrder: 5 }),
            ];
            // 128 (order 20, flagged) kills later 129 (order 20); the rest
            // sort descending by displayOrder.
            expect(orderShips(items).map(s => s.id)).toEqual([
                "nova:128", "nova:130", "nova:131",
            ]);
        });
});

describe("dailyMarketRoll", function() {
    it("is deterministic per (pilot, day, item) and lands in 1..100", function() {
        const state = makePlayerState();
        const first = dailyMarketRoll(state, 128);
        expect(first).toBeGreaterThanOrEqual(1);
        expect(first).toBeLessThanOrEqual(100);
        expect(dailyMarketRoll(state, 128)).toEqual(first);
    });
});
