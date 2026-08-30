// Headless specs for the pure purchase logic. Run with:
//   npx esbuild --bundle --platform=node nova/src/spaceport/purchase_test.ts \
//       --outfile=/tmp/pp.js && node_modules/.bin/jasmine /tmp/pp.js
//
// Money rules under test (verified against the EV Nova Bible, see
// purchase.ts module comment): priceMod multiplies buying prices, outfits
// sell back at full Cost, ship trade-in is 25% of the current ship's cost
// plus its outfits', and nothing ever drives credits below zero.

import { getDefaultOutfitData, OutfitData } from "novadatainterface/OutiftData";
import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import {
    buyOutfit, buyShip, canBuyOutfit, canBuyShip, freeMassOf, Mutation,
    netShipPrice, OUTFIT_SELL_RATIO, outfitPrice, sellOutfit, shipPrice,
    tradeInValue, TRADE_IN_RATIO, Wallet,
} from "./purchase";


function makeOutfit(price: number, mass: number, id = "nova:test"): OutfitData {
    return {
        ...getDefaultOutfitData(),
        id,
        name: id,
        price,
        physics: { freeMass: mass },
    };
}

function makeShip(price: number, id = "nova:ship"): ShipData {
    return {
        ...getDefaultShipData(),
        id,
        name: id,
        price,
    };
}

const wallet = (credits: number): Wallet => ({ credits });
const outfitsOf = (entries: Array<[string, number]>) =>
    new Map(entries.map(([id, count]) => [id, { count }]));


describe("outfitPrice", () => {
    it("multiplies by the price modifier and rounds", () => {
        const outfit = makeOutfit(5000, 3);
        expect(outfitPrice(outfit, 1)).toBe(5000);
        expect(outfitPrice(outfit, 0.9)).toBe(4500);
        expect(outfitPrice(outfit, 1.1)).toBe(5500);
        // 3333 * 0.5 = 1666.5 -> rounds to 1667
        expect(outfitPrice(makeOutfit(3333, 0), 0.5)).toBe(1667);
    });
});

describe("canBuyOutfit", () => {
    const outfit = makeOutfit(5000, 3);

    it("passes with enough credits and mass", () => {
        expect(canBuyOutfit(wallet(5000), outfit, 3, 1)).toBeTrue();
        // Boundary equality on both credits and mass.
        expect(canBuyOutfit(wallet(4500), outfit, 3, 0.9)).toBeTrue();
    });

    it("fails on insufficient credits", () => {
        expect(canBuyOutfit(wallet(4999), outfit, 10, 1)).toBeFalse();
    });

    it("fails on insufficient free mass", () => {
        expect(canBuyOutfit(wallet(99999), outfit, 2.99, 1)).toBeFalse();
    });
});

describe("buyOutfit", () => {
    const outfit = makeOutfit(5000, 3, "nova:blaster");

    it("deducts the modified price, adds one and consumes mass", () => {
        const result = buyOutfit(wallet(10000), outfitsOf([]), outfit, 11, 0.9);
        expect(result).not.toBeNull();
        expect(result!.credits).toBe(5500);
        expect(result!.freeMass).toBe(8);
        expect(result!.outfits.get("nova:blaster")).toEqual({ count: 1 });
        expect(result!.mutation).toEqual({
            kind: "buyOutfit", outfitId: "nova:blaster", count: 1,
            credits: 5500, freeMass: 8,
        } as Mutation);
    });

    it("accumulates onto existing holdings", () => {
        const result = buyOutfit(wallet(99999),
            outfitsOf([["nova:blaster", 2]]), outfit, 10, 1);
        expect(result!.outfits.get("nova:blaster")).toEqual({ count: 3 });
        expect(result!.freeMass).toBe(7);
    });

    it("never drives credits negative", () => {
        expect(buyOutfit(wallet(4999), outfitsOf([]), outfit, 10, 1)).toBeNull();
        expect(buyOutfit(wallet(0), outfitsOf([]), outfit, 10, 1)).toBeNull();
    });

    it("refuses to exceed the free mass", () => {
        expect(buyOutfit(wallet(99999), outfitsOf([]), outfit, 2, 1)).toBeNull();
    });

    it("does not mutate the input holdings", () => {
        const holdings = outfitsOf([["nova:blaster", 1]]);
        buyOutfit(wallet(99999), holdings, outfit, 10, 1);
        expect(holdings.get("nova:blaster")).toEqual({ count: 1 });
    });
});

describe("sellOutfit", () => {
    const outfit = makeOutfit(5000, 3, "nova:blaster");

    it("refunds the full price and frees the mass", () => {
        expect(OUTFIT_SELL_RATIO).toBe(1); // EV Nova sell-back: full Cost
        const result = sellOutfit(wallet(100),
            outfitsOf([["nova:blaster", 1]]), outfit, 4);
        expect(result).not.toBeNull();
        expect(result!.credits).toBe(5100);
        expect(result!.freeMass).toBe(7);
        expect(result!.outfits.has("nova:blaster")).toBeFalse();
        expect(result!.mutation).toEqual({
            kind: "sellOutfit", outfitId: "nova:blaster", count: 0,
            credits: 5100, freeMass: 7,
        } as Mutation);
    });

    it("decrements counts above one", () => {
        const result = sellOutfit(wallet(0),
            outfitsOf([["nova:blaster", 3]]), outfit, 9);
        expect(result!.outfits.get("nova:blaster")).toEqual({ count: 2 });
        expect(result!.freeMass).toBe(12);
    });

    it("refuses to sell an outfit the player does not have", () => {
        expect(sellOutfit(wallet(0), outfitsOf([]), outfit, 4)).toBeNull();
    });
});

describe("freeMassOf", () => {
    it("subtracts carried outfit space from the ship's freeMass", () => {
        const free = freeMassOf(11, outfitsOf([["a", 2], ["b", 1]]),
            id => ({ a: 3, b: 5 }[id] ?? null));
        expect(free).toBe(0);
    });

    it("ignores ids with missing data", () => {
        const free = freeMassOf(11, outfitsOf([["a", 2], ["gone", 4]]),
            id => ({ a: 3 }[id] ?? null));
        expect(free).toBe(5);
    });
});

describe("ship prices", () => {
    it("price-modifies the ship price", () => {
        const ship = makeShip(200000);
        expect(shipPrice(ship, 1)).toBe(200000);
        expect(shipPrice(ship, 0.9)).toBe(180000);
    });

    it("trades in 25% of the current ship and its outfits", () => {
        expect(TRADE_IN_RATIO).toBe(0.25); // Nova Bible shïp Cost field
        const tradeIn = tradeInValue(200000, outfitsOf([["a", 2], ["b", 1]]),
            id => ({ a: 5000, b: 10000 }[id] ?? null));
        // 25% of (200000 + 2*5000 + 10000) = 55000
        expect(tradeIn).toBe(55000);
    });

    it("treats missing outfit prices as 0 for trade-in", () => {
        const tradeIn = tradeInValue(200000, outfitsOf([["gone", 3]]),
            () => null);
        expect(tradeIn).toBe(50000);
    });

    it("nets the new price minus the trade-in, never below 0", () => {
        const ship = makeShip(100000);
        expect(netShipPrice(ship, 1, 30000)).toBe(70000);
        expect(netShipPrice(ship, 1, 999999)).toBe(0);
    });

    it("gates buying on the net price", () => {
        const ship = makeShip(100000);
        expect(canBuyShip(wallet(70000), ship, 1, 30000)).toBeTrue();
        expect(canBuyShip(wallet(69999), ship, 1, 30000)).toBeFalse();
    });
});

describe("buyShip", () => {
    const ship = makeShip(100000, "nova:leopard");

    it("charges the net price and transfers all outfits", () => {
        const holdings = outfitsOf([["a", 2], ["b", 1]]);
        const result = buyShip(wallet(80000), ship, 1, 30000, holdings);
        expect(result).not.toBeNull();
        expect(result!.credits).toBe(10000);
        expect(result!.outfits).toEqual(holdings);
        expect(result!.outfits).not.toBe(holdings); // a copy, not the same map
        expect(result!.mutation).toEqual({
            kind: "buyShip", shipId: "nova:leopard",
            netPrice: 70000, tradeIn: 30000,
        } as Mutation);
    });

    it("refuses when the net price is unaffordable", () => {
        expect(buyShip(wallet(39999), ship, 1, 0, outfitsOf([]))).toBeNull();
        // Trade-in can cover the whole price.
        expect(buyShip(wallet(0), ship, 1, 100000, outfitsOf([]))!.credits)
            .toBe(0);
    });
});
