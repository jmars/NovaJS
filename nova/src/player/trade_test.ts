// Headless specs for the trade center (player/trade.ts): band price math,
// which goods a planet trades (band gate + jünk soldAt/boughtAt + BuyOn/
// SellOn expressions), and the capacity-capped, never-negative-credits
// buy/sell transitions. Run with:
//   npx esbuild --bundle --platform=node nova/src/player/trade_test.ts \
//       --outfile=/tmp/tr.js && node_modules/.bin/jasmine /tmp/tr.js

import "jasmine";
import { getDefaultJunkData, JunkData } from "novadatainterface/JunkData";
import { getDefaultPlanetData } from "novadatainterface/PlanetData";
import { TestContext } from "novadatainterface/expressions";
import {
    BAND_MULTIPLIERS,
    buyGood,
    buyPrice,
    commodityPrice,
    sellGood,
    sellPrice,
    tradablesAt,
    TradeGood,
    TradeState,
} from "./trade";


function planet(overrides: Partial<ReturnType<typeof getDefaultPlanetData>> = {}) {
    return { ...getDefaultPlanetData(), ...overrides };
}

function junk(rawId: number, overrides: Partial<JunkData> = {}): [number, JunkData] {
    return [rawId, { ...getDefaultJunkData(), id: "nova:" + rawId, ...overrides }];
}

function ctx(bits: Set<number> = new Set()): TestContext {
    return {
        bits: { get: bit => bits.has(bit) },
        gender: 1,
        hasOutfit: () => false,
        exploredSystem: () => false,
    };
}

function state(credits: number, cargo: TradeState["cargo"] = [], freeTons = 20): TradeState {
    return { credits, cargo, freeTons };
}

// The standard Food good of a planet, for direct buy/sell specs (base 5).
function foodGood(priceBands: number[]): TradeGood {
    return tradablesAt(planet({ hasTradeCenter: true, priceBands }), new Map(), ctx())[0];
}


describe("commodity price math", () => {

    it("applies the band multipliers", () => {
        // Bands: 0 won't trade, 1 low (0.75), 2 medium (1), 3 high (1.25).
        expect(BAND_MULTIPLIERS).toEqual([0, 0.75, 1, 1.25]);
        expect(commodityPrice(100, 0)).toBe(0);
        expect(commodityPrice(100, 1)).toBe(75);
        expect(commodityPrice(100, 2)).toBe(100);
        expect(commodityPrice(100, 3)).toBe(125);
    });

    it("rounds and never prices a tradable commodity below 1 credit", () => {
        expect(commodityPrice(7, 1)).toBe(5);  // 5.25 rounds down
        expect(commodityPrice(1, 1)).toBe(1);  // 0.75 clamps up
        expect(commodityPrice(0, 2)).toBe(1);
    });

    it("folds the buying price modifier into the band price", () => {
        expect(commodityPrice(100, 2, 0.9)).toBe(90);
        expect(commodityPrice(100, 3, 0.5)).toBe(63);  // 62.5 rounds up
        // A modifier never rescues a won't-trade band.
        expect(commodityPrice(100, 0, 0.5)).toBe(0);
    });

    it("keeps the buying discount off the sell price", () => {
        const good = foodGood([2, 0, 0, 0, 0, 0]);
        expect(buyPrice(good, 0.8)).toBe(4);
        expect(sellPrice(good)).toBe(5);
    });
});


describe("tradablesAt", () => {

    it("lists only the standard commodities the planet's bands allow", () => {
        const goods = tradablesAt(
            planet({ hasTradeCenter: true, priceBands: [2, 0, 1, 3, 2, 0] }),
            new Map(), ctx());
        expect(goods.map(good => good.type)).toEqual([0, 2, 3, 4]);
        expect(goods.map(good => good.price)).toEqual([5, 15, 50, 15]);
        for (const good of goods) {
            expect(good.canBuy).toBeTrue();
            expect(good.canSell).toBeTrue();
        }
    });

    it("trades nothing on planets without a trade center", () => {
        expect(tradablesAt(
            planet({ hasTradeCenter: false, priceBands: [2, 2, 2, 2, 2, 2] }),
            new Map(), ctx())).toEqual([]);
    });

    it("uses the STR# 4000 names when given, '*' stripped", () => {
        const goods = tradablesAt(
            planet({ hasTradeCenter: true, priceBands: [2, 0, 0, 0, 0, 0] }),
            new Map(), ctx(), ["*Food", "Industrial", "", "", "", ""]);
        expect(goods[0].name).toBe("Food");
    });

    it("offers jünk the planet sells or buys, gated by BuyOn/SellOn", () => {
        const junks = new Map([
            junk(128, { soldAt: ["nova:1"], boughtAt: [], basePrice: 750 }),
            junk(129, { soldAt: [], boughtAt: ["nova:1"], basePrice: 200 }),
            // Listed as bought here, but the SellOn bit test fails.
            junk(130, { boughtAt: ["nova:1"], sellOn: "b100" }),
            // Not listed at this planet at all.
            junk(131, { soldAt: ["nova:2"], boughtAt: ["nova:2"] }),
        ]);
        const goods = tradablesAt(planet({ id: "nova:1" }), junks, ctx());
        expect(goods.map(good => good.type)).toEqual([128, 129]);
        expect(goods[0].canBuy).toBeTrue();
        expect(goods[0].canSell).toBeFalse();
        expect(goods[0].price).toBe(750);
        expect(goods[1].canBuy).toBeFalse();
        expect(goods[1].canSell).toBeTrue();
    });

    it("passes a jünk whose BuyOn/SellOn bit test holds", () => {
        const junks = new Map([
            junk(128, { soldAt: ["nova:1"], buyOn: "b100" }),
            junk(129, { boughtAt: ["nova:1"], sellOn: "b100" }),
        ]);
        const setBits = new Set([100]);
        const goods = tradablesAt(planet({ id: "nova:1" }), junks, ctx(setBits));
        expect(goods.map(good => good.type)).toEqual([128, 129]);
        // Without the bit set, neither side is offered.
        expect(tradablesAt(planet({ id: "nova:1" }), junks, ctx())).toEqual([]);
    });
});


describe("buyGood", () => {

    it("buys at the modified price and charges only what moved", () => {
        const good = foodGood([2, 0, 0, 0, 0, 0]);  // 5 cr/ton
        const result = buyGood(state(100), good, 3, 1)!;
        expect(result.moved).toBe(3);
        expect(result.credits).toBe(85);
        expect(result.cargo).toEqual([{ type: 0, qty: 3 }]);
        expect(result.freeTons).toBe(17);
    });

    it("caps at the free hold space", () => {
        const good = foodGood([2, 0, 0, 0, 0, 0]);
        const result = buyGood(state(100), good, 10, 1)!;
        expect(result.moved).toBe(10);
        expect(result.credits).toBe(50);
        expect(result.freeTons).toBe(10);
    });

    it("caps at the affordable tonnage — credits never go negative", () => {
        const good = foodGood([2, 0, 0, 0, 0, 0]);
        const result = buyGood(state(24), good, 10, 1)!;
        expect(result.moved).toBe(4);
        expect(result.credits).toBe(4);
        // Buying with less than one ton of credit buys nothing.
        expect(buyGood(state(4), good, 1, 1)).toBeNull();
    });

    it("merges into an existing hold entry of the same type", () => {
        const good = foodGood([2, 0, 0, 0, 0, 0]);
        const result = buyGood(state(100, [{ type: 0, qty: 4 }]), good, 2, 1)!;
        expect(result.cargo).toEqual([{ type: 0, qty: 6 }]);
    });

    it("refuses goods the planet doesn't sell", () => {
        const junks = new Map([junk(128, { soldAt: [], boughtAt: ["nova:1"] })]);
        const good = tradablesAt(planet({ id: "nova:1" }), junks, ctx())[0];
        expect(good.canBuy).toBeFalse();
        expect(buyGood(state(1000), good, 1, 1)).toBeNull();
    });
});


describe("sellGood", () => {

    it("sells held tons at the plain local price", () => {
        const good = foodGood([2, 0, 0, 0, 0, 0]);
        const result = sellGood(state(0, [{ type: 0, qty: 5 }]), good, 3)!;
        expect(result.moved).toBe(3);
        expect(result.credits).toBe(15);
        expect(result.cargo).toEqual([{ type: 0, qty: 2 }]);
        expect(result.freeTons).toBe(23);
    });

    it("never sells more than the hold carries", () => {
        const good = foodGood([2, 0, 0, 0, 0, 0]);
        const result = sellGood(state(0, [{ type: 0, qty: 1 }]), good, 10)!;
        expect(result.moved).toBe(1);
        expect(result.cargo).toEqual([]);
    });

    it("refuses goods the planet doesn't buy and holds it lacks", () => {
        const junks = new Map([junk(128, { soldAt: ["nova:1"], boughtAt: [] })]);
        const good = tradablesAt(planet({ id: "nova:1" }), junks, ctx())[0];
        expect(good.canSell).toBeFalse();
        expect(sellGood(state(0, [{ type: 128, qty: 5 }]), good, 1)).toBeNull();
        expect(sellGood(state(0), good, 1)).toBeNull();
    });
});
