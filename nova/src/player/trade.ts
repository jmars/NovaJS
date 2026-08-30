// Pure trade-center (commodity exchange) logic: which goods a planet
// trades, at what price, and the buy/sell transitions over the player's
// credits and cargo hold. No PIXI/ECS imports — headless testable
// (trade_test.ts); the UI glue (spaceport.ts, trade_center.ts) fetches the
// game data, builds the TestContext and calls into this right before
// mutating PlayerState.
//
// Money rules and their provenance:
//   - Standard commodities (hold types 0-5, the STR# 4000 order) have NO
//     price data in the stock resource fork (no STR# 9000/9300/9400) —
//     their base prices are hardcoded engine constants in EV Nova.
//     STANDARD_BASE_PRICES approximates them and is flagged APPROX: flip
//     the constants if real values ever surface. Names, by contrast, are
//     real data (STR# 4000) and are resolved by the caller.
//   - The per-planet price band (PlanetData.priceBands, decoded from the
//     spöb price-band flag nibbles) multiplies the base price:
//     1 = low, 2 = medium (unchanged), 3 = high.
//   - Jünk commodities carry their own basePrice in the jünk resource;
//     no band applies.
//   - PriceMod (ränk field, see player/ranks.ts) is a *buying* discount —
//     the purchase.ts precedent (Bible: "special deals on ships and items
//     at 'friendly' planets"). Selling returns the plain local price.

import { TestContext, evaluateTest, parseTest } from "novadatainterface/expressions";
import { JunkData } from "novadatainterface/JunkData";
import { PlanetData } from "novadatainterface/PlanetData";
import {
    CargoEntry,
    tryLoadCargo,
    tryUnloadCargo,
} from "./cargo";

// Base price in credits/ton for the six standard commodities (STR# 4000
// order: 0 Food, 1 Industrial, 2 Medical Supplies, 3 Luxury Goods, 4 Metal,
// 5 Equipment). FLAGGED APPROXIMATION — see the module comment.
export const STANDARD_BASE_PRICES: readonly number[] = [5, 10, 20, 40, 15, 100];

// Fallback commodity names, also STR# 4000 order. The UI overrides these
// with the real string set when it is present.
export const STANDARD_COMMODITY_NAMES: readonly string[] = [
    "Food", "Industrial", "Medical Supplies", "Luxury Goods", "Metal",
    "Equipment",
];

// Price multiplier per band (PlanetData.priceBands entries). Band 0 means
// the planet won't trade the commodity at all. FLAGGED APPROXIMATION —
// the engine's real low/high factors are unknown offline.
export const BAND_MULTIPLIERS: readonly number[] = [0, 0.75, 1, 1.25];

// The local price of one ton of a standard commodity at a planet with the
// given band, under the given buying price modifier. Band 0 (won't trade)
// prices 0; callers must treat a 0 price as "not tradable". Never below 1
// credit/ton where trading happens.
export function commodityPrice(base: number, band: number, priceMod: number = 1): number {
    const multiplier = BAND_MULTIPLIERS[band] ?? 0;
    if (multiplier <= 0) {
        return 0;
    }
    return Math.max(1, Math.round(base * multiplier * priceMod));
}

// One tradable good in a planet's exchange. Doubles as the item shape the
// ItemGrid tiles need (name/id/desc/pict) so the menu can render it
// directly. `type` is the cargo-hold identity: 0-5 standard commodity,
// otherwise the jünk raw id.
export interface TradeGood {
    // Stable per-good id for the grid ("standard:0" or the jünk global id).
    id: string;
    name: string;
    desc: string;
    // No commodity has an icon in stock data; "" suppresses the tile pict.
    pict: string;
    type: number;
    // Local credits/ton here (band-adjusted for standards), before priceMod.
    price: number;
    // Standards: band > 0 at a trade-center planet. Jünk: this planet is in
    // the jünk's soldAt/boughtAt and the BuyOn/SellOn test passes.
    canBuy: boolean;
    canSell: boolean;
}

// What a trade center sells: the six standards the planet's bands allow,
// plus every jünk commodity this planet sells or buys. `junks` maps jünk
// raw id -> parsed data; `testCtx` evaluates the jünk BuyOn/SellOn test
// expressions (same machinery as mïsn AvailBits). `standardNames`, when
// given, supplies the STR# 4000 commodity names (a leading '*' — the
// mission-only marker — is stripped); missing entries fall back to the
// built-in names.
export function tradablesAt(planet: PlanetData,
    junks: ReadonlyMap<number, JunkData>, testCtx: TestContext,
    standardNames?: readonly string[]): TradeGood[] {
    const goods: TradeGood[] = [];

    if (planet.hasTradeCenter) {
        for (var type = 0; type < STANDARD_BASE_PRICES.length; type++) {
            var band = planet.priceBands[type] ?? 0;
            if (band <= 0) {
                continue;
            }
            var name = (standardNames?.[type] ?? STANDARD_COMMODITY_NAMES[type])
                .replace(/^\*/, "");
            goods.push({
                id: "standard:" + type,
                name,
                desc: "Standard commodity.",
                pict: "",
                type,
                price: commodityPrice(STANDARD_BASE_PRICES[type], band),
                canBuy: true,
                canSell: true,
            });
        }
    }

    // Warn-and-true, like every other TestExpression consumer: an
    // unparseable BuyOn/SellOn means "no extra restriction".
    const warn = (message: string) => console.warn(`[trade] ${message}`);
    for (const [rawId, junk] of junks) {
        const canBuy = junk.soldAt.includes(planet.id)
            && evaluateTest(parseTest(junk.buyOn, warn), testCtx);
        const canSell = junk.boughtAt.includes(planet.id)
            && evaluateTest(parseTest(junk.sellOn, warn), testCtx);
        if (!canBuy && !canSell) {
            continue;
        }
        goods.push({
            id: junk.id,
            name: junk.lcName || junk.name,
            desc: junk.lcName,
            pict: "",
            type: rawId,
            price: junk.basePrice,
            canBuy,
            canSell,
        });
    }

    return goods;
}

// The money + hold state one trade center session operates on.
// Structurally the fields the spaceport reads off PlayerState and the
// player's ship; declared inline so this module stays headless.
export interface TradeState {
    credits: number;
    cargo: CargoEntry[];
    // Free hold space in tons; Infinity when the ship's capacity is unknown.
    freeTons: number;
}

export interface TradeResult {
    credits: number;
    cargo: CargoEntry[];
    freeTons: number;
    // Tons actually bought/sold (<= the requested qty).
    moved: number;
}

/** The price buying one ton of `good` costs here (priceMod applies on BUY
 * only — see the module comment). Never below 1 credit/ton. */
export function buyPrice(good: TradeGood, priceMod: number): number {
    return Math.max(1, Math.round(good.price * priceMod));
}

/** The price selling one ton of `good` earns here: the plain local price,
 * unmodified by priceMod (that is a buying discount). */
export function sellPrice(good: TradeGood): number {
    return good.price;
}

/**
 * Buys up to `qty` tons of `good` at the (modified) buy price: capped by
 * the affordable tonnage and the free hold space — take what fits. Returns
 * null when the good isn't sold here or nothing fits/buys; credits never
 * go negative.
 */
export function buyGood(state: TradeState, good: TradeGood, qty: number,
    priceMod: number): TradeResult | null {
    if (!good.canBuy || qty <= 0) {
        return null;
    }
    const price = buyPrice(good, priceMod);
    const affordable = Math.floor(state.credits / price);
    const requested = Math.min(qty, affordable);
    const load = tryLoadCargo(state.cargo, good.type, requested, state.freeTons);
    if (load.moved <= 0) {
        return null;
    }
    return {
        credits: state.credits - load.moved * price,
        cargo: load.cargo,
        freeTons: state.freeTons - load.moved,
        moved: load.moved,
    };
}

/**
 * Sells up to `qty` tons of `good` from the hold at the plain local price.
 * Returns null when the good isn't bought here or the hold has none;
 * selling never creates tons.
 */
export function sellGood(state: TradeState, good: TradeGood,
    qty: number): TradeResult | null {
    if (!good.canSell || qty <= 0) {
        return null;
    }
    const unload = tryUnloadCargo(state.cargo, good.type, qty);
    if (unload.moved <= 0) {
        return null;
    }
    return {
        credits: state.credits + unload.moved * sellPrice(good),
        cargo: unload.cargo,
        freeTons: state.freeTons + unload.moved,
        moved: unload.moved,
    };
}
