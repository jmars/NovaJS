// Pure outfit/shipyard market filters, reverse-engineered from the binary:
// the outfitter list builder FUN_0046a220 and the shipyard list builder
// FUN_00469e90. No PIXI/ECS imports — headless testable (market_filter_test);
// the UI glue (outfitter.ts, shipyard.ts via spaceport.ts) builds the
// MarketContext at each dialog open and calls these.

import { OutfitData } from "novadatainterface/OutiftData";
import { ShipData } from "novadatainterface/ShipData";
import { evaluateTest, parseTest, TestContext } from "novadatainterface/expressions";
import { jumpRerollSeed } from "../missions/mission_state_machine";
import { rawIdOf } from "../missions/stellar_filter";
import { makeRng } from "../player/pilot_files";
import { PlayerState } from "../player/player_state";

// Everything the filters need about the planet, the player and the day.
// The binary rebuilds its lists at every dialog open with the current
// state; the spaceport does the same.
export interface MarketContext {
    // The landed spöb's tech level and special techs (PlanetData).
    planetTech: number;
    planetSpecialTech: number[];
    // The player's govt-attribute mask pool: the flagship's own mask
    // (shïp raw 100/104) OR'd with earned rank masks and owned outfits'
    // masks (oütf raw 30/34) — FUN_0046cca0. Active-mission masks are not
    // modeled (mïsn contribute masks are not parsed).
    maskContributes: [number, number];
    // Control-bit context for AvailBits expressions (same shape as
    // availability.ts rule 6).
    testCtx: TestContext;
    // The per-day market roll for one item raw id: 1..100 (the day tick
    // FUN_00466cb0 rolls rand(100)+1 per ship and outfit).
    rollFor(rawId: number): number;
}

// The deterministic stand-in for the binary's per-day rand(100)+1: seeded
// by the pilot, the day, and the item, so every peer and reload computes
// the same market for the same day.
export function dailyMarketRoll(state: PlayerState, rawId: number): number {
    const rng = makeRng((jumpRerollSeed(state) ^ (rawId * 0x9E37)) >>> 0);
    return 1 + Math.floor(rng() * 100);
}

// Tech gate shared by both filters: rawTech <= spob tech, or an exact
// special-tech match (FUN_0046a220 / FUN_00469e90 step 2/1).
function techPasses(rawTech: number, ctx: MarketContext): boolean {
    return rawTech <= ctx.planetTech
        || ctx.planetSpecialTech.includes(rawTech);
}

// (playerMasks & require) == require for both words (FUN_0046cd80).
function masksPass(require: [number, number], ctx: MarketContext): boolean {
    return (ctx.maskContributes[0] & require[0]) === require[0]
        && (ctx.maskContributes[1] & require[1]) === require[1];
}

// Whether one outfit is listed in this planet's outfitter (FUN_0046a220
// steps 2-3). `owned` outfits skip the expression/mask/stock checks — you
// can always see what you carry (the binary's owned pre-pass also shows
// sellable outfits through the tech gate when spöb flags2 0x400 is set;
// irrelevant on stock data and not modeled).
export function outfitListed(outfit: OutfitData, owned: boolean,
    ctx: MarketContext): boolean {
    if (!techPasses(outfit.rawTech, ctx)) {
        return false;
    }
    if (owned) {
        return true;
    }
    if ((outfit.flags & 0x4000) !== 0
        && !evaluateTest(parseTest(outfit.availBits), ctx.testCtx)) {
        return false;
    }
    if ((outfit.flags & 0x100) !== 0 && !masksPass(outfit.require, ctx)) {
        return false;
    }
    // In stock: percent >= 1 and >= today's roll.
    const roll = ctx.rollFor(rawIdOf(outfit.id));
    return outfit.stockPercent >= 1 && outfit.stockPercent >= roll;
}

// Whether one ship is listed in this planet's shipyard market (FUN_00469e90,
// purchase mode; the hire-mode raw+906 roll is not modeled).
export function shipListed(ship: ShipData, ctx: MarketContext): boolean {
    if (!techPasses(ship.rawTech, ctx)) {
        return false;
    }
    if ((ship.flags3 & 0x100) !== 0
        && !evaluateTest(parseTest(ship.availBits), ctx.testCtx)) {
        return false;
    }
    if ((ship.flags3 & 0x200) !== 0 && !masksPass(ship.require, ctx)) {
        return false;
    }
    const roll = ctx.rollFor(rawIdOf(ship.id));
    return ship.stockPercent >= 1 && ship.stockPercent >= roll;
}

// Funnel order: descending displayWeight, ties ascending raw id; an item
// flagged 0x1000 removes LATER (higher raw id) candidates with the same
// displayWeight. Both builders iterate ids ascending for the dedup, then
// sort for display.
function marketOrder<T extends { id: string }>(items: T[],
    weight: (item: T) => number,
    hideDuplicates: (item: T) => boolean): T[] {
    const byId = [...items].sort((a, b) => rawIdOf(a.id) - rawIdOf(b.id));
    const killedWeights = new Set<number>();
    const kept: T[] = [];
    for (const item of byId) {
        if (hideDuplicates(item)) {
            killedWeights.add(weight(item));
        }
        else if (killedWeights.has(weight(item))) {
            continue;
        }
        kept.push(item);
    }
    return kept.sort((a, b) => weight(b) - weight(a)
        || rawIdOf(a.id) - rawIdOf(b.id));
}

// The outfitter grid order for one planet/day.
export function orderOutfits(outfits: OutfitData[]): OutfitData[] {
    return marketOrder(outfits, outfit => outfit.displayWeight,
        outfit => (outfit.flags & 0x1000) !== 0);
}

// The shipyard grid order for one planet/day.
export function orderShips(ships: ShipData[]): ShipData[] {
    return marketOrder(ships, ship => ship.displayOrder,
        ship => (ship.flags3 & 0x4000) !== 0);
}
