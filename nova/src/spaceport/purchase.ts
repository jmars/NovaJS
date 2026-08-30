// Pure purchase logic for the outfitter and shipyard menus. No PIXI/ECS
// imports — headless testable (purchase_test.ts); the UI glue
// (outfitter.ts, shipyard.ts, spaceport.ts) calls into this right before
// mutating PlayerState/OutfitsStateComponent.
//
// Money rules verified against the EV Nova Bible (Nova Bible.txt, shïp/oütf
// field docs):
//   - PriceMod (ränk field) modifies the price of items and ships you BUY
//     ("special deals on ships and items at 'friendly' planets"); selling
//     uses the plain Cost.
//   - Outfit sell-back and ship trade-in are REVERSE-ENGINEERED from the
//     binary (EV Nova 1.0.10 Windows; the outfitter FUN_0048ea70 and the
//     shïp loader/trade-in FUN_004bd3c0): outfits sell back at HALF cost
//     (full cost only for outfits bought at this shop this visit — a
//     per-shop-session fact this module cannot see, so callers pass it via
//     boughtHere), and the trade-in is 25% of the ship's cost plus HALF of
//     each installed outfit's cost — not the Bible's flat "25% of ship and
//     upgrades".
// The Bible does not cover a trade-in exceeding the new ship's price, so
// netShipPrice clamps at 0: buying a ship never credits the player.

import { OutfitData } from "novadatainterface/OutiftData";
import { ShipData } from "novadatainterface/ShipData";

/** The player's money; structurally PlayerState (which also carries it). */
export interface Wallet {
    credits: number;
}

/** Outfit holdings: outfit global id -> count. The OutfitsStateComponent
 * shape (nova_plugin/outfit_plugin), declared structurally so this module
 * stays headless. */
export type Outfits = ReadonlyMap<string, { count: number }>;

/**
 * Fraction of an outfit's Cost refunded when selling it back.
 * REVERSE-ENGINEERED from the binary (outfitter FUN_0048ea70 @ 0x49003c:
 * `refund *= (double)0.5` at rdata 0x575940 = 0x3FE0000000000000, applied
 * when the outfit was NOT bought at this shop this visit; the engine
 * refunds the plain Cost for outfits bought here).
 */
export const OUTFIT_SELL_RATIO = 0.5;

/**
 * Fraction of the current ship's cost credited when trading up.
 * REVERSE-ENGINEERED from the binary (shïp loader FUN_004bd3c0 @ 0x4c1e88:
 * `FILD [shïp+0x58 Cost]; FMUL qword [0x575e80]` where 0x575e80 holds the
 * double 0.25). Outfits trade at their own ratio — see TRADE_IN_OUTFIT_RATIO.
 */
export const TRADE_IN_SHIP_RATIO = 0.25;

/**
 * Fraction of each installed outfit's cost added to the trade-in.
 * REVERSE-ENGINEERED from the binary (FUN_004bd3c0 @ 0x4c21c5:
 * `FMUL qword [0x575e88]` = double 0.5, once per outfit line, rounded per
 * step). The Nova Bible's "25% of your current ship and upgrades" is
 * imprecise: outfits credit at HALF their cost, which is why the engine
 * warns a trade-in can exceed a cheap ship's price ("has a trade-in value
 * of ... but costs only ...", FUN_004bd3c0 @ 0x4c28cc).
 */
export const TRADE_IN_OUTFIT_RATIO = 0.5;

/** What a purchase changed, for UI refresh + logging. */
export type Mutation = {
    kind: "buyOutfit";
    outfitId: string;
    count: number;
    credits: number;   // wallet after the purchase
    freeMass: number;  // free mass after the purchase
} | {
    kind: "sellOutfit";
    outfitId: string;
    count: number;
    credits: number;
    freeMass: number;
} | {
    kind: "buyShip";
    shipId: string;
    netPrice: number;  // what was charged after trade-in
    tradeIn: number;
};

export interface OutfitPurchaseResult {
    credits: number;
    outfits: Map<string, { count: number }>;
    freeMass: number;
    mutation: Mutation;
}

export interface ShipPurchaseResult {
    credits: number;
    outfits: Map<string, { count: number }>;
    mutation: Mutation;
}

/** The price one outfit sells for at a planet with the given modifier. */
export function outfitPrice(outfit: OutfitData, priceMod: number): number {
    return Math.round(outfit.price * priceMod);
}

/** Whether the player can buy one more of `outfit`: enough credits and
 * enough free mass for its space. */
export function canBuyOutfit(wallet: Wallet, outfit: OutfitData,
    freeMass: number, priceMod: number): boolean {
    return wallet.credits >= outfitPrice(outfit, priceMod)
        && freeMass >= outfit.physics.freeMass;
}

/**
 * Buys one of `outfit`: deducts the (modified) price, adds it to the
 * holdings and consumes its space. Returns null when unaffordable or out
 * of space — callers decide how to signal that; this never goes negative.
 */
export function buyOutfit(wallet: Wallet, outfits: Outfits, outfit: OutfitData,
    freeMass: number, priceMod: number): OutfitPurchaseResult | null {
    if (!canBuyOutfit(wallet, outfit, freeMass, priceMod)) {
        return null;
    }
    const price = outfitPrice(outfit, priceMod);
    const nextOutfits = new Map(outfits);
    const count = (outfits.get(outfit.id)?.count ?? 0) + 1;
    nextOutfits.set(outfit.id, { count });
    return {
        credits: wallet.credits - price,
        outfits: nextOutfits,
        freeMass: freeMass - outfit.physics.freeMass,
        mutation: {
            kind: "buyOutfit", outfitId: outfit.id, count,
            credits: wallet.credits - price,
            freeMass: freeMass - outfit.physics.freeMass,
        },
    };
}

/**
 * Sells one of `outfit` back: refunds OUTFIT_SELL_RATIO of its Cost
 * (unmodified by priceMod — that is a buying discount) and frees its space.
 * `boughtHere` marks an outfit bought at this shop this visit — the engine
 * refunds those at full Cost. Returns null when the player has none to
 * sell.
 */
export function sellOutfit(wallet: Wallet, outfits: Outfits, outfit: OutfitData,
    freeMass: number, boughtHere = false): OutfitPurchaseResult | null {
    const owned = outfits.get(outfit.id)?.count ?? 0;
    if (owned <= 0) {
        return null;
    }
    const refund = Math.round(outfit.price
        * (boughtHere ? 1 : OUTFIT_SELL_RATIO));
    const nextOutfits = new Map(outfits);
    if (owned === 1) {
        nextOutfits.delete(outfit.id);
    }
    else {
        nextOutfits.set(outfit.id, { count: owned - 1 });
    }
    return {
        credits: wallet.credits + refund,
        outfits: nextOutfits,
        freeMass: freeMass + outfit.physics.freeMass,
        mutation: {
            kind: "sellOutfit", outfitId: outfit.id, count: owned - 1,
            credits: wallet.credits + refund,
            freeMass: freeMass + outfit.physics.freeMass,
        },
    };
}

/**
 * The mass actually free on a ship: ShipParse pre-adds the mass of a ship's
 * preinstalled outfits to its freeMass, so subtract everything the ship
 * currently carries (outfit mass = the space it consumes). Ids whose data
 * is missing count as mass 0. The engine's applyOutfitPhysics adds outfit
 * mass instead (a pre-existing sign quirk); nothing but this menu reads
 * freeMass, and the menu recomputes with this function every time it opens.
 */
export function freeMassOf(shipFreeMass: number, outfits: Outfits,
    outfitMass: (id: string) => number | null): number {
    let free = shipFreeMass;
    for (const [id, { count }] of outfits) {
        const mass = outfitMass(id);
        if (mass !== null) {
            free -= mass * count;
        }
    }
    return free;
}

/** The price of `ship` at a planet with the given modifier. */
export function shipPrice(ship: ShipData, priceMod: number): number {
    return Math.round(ship.price * priceMod);
}

/**
 * Trade-in credit for the current ship: TRADE_IN_SHIP_RATIO of its price
 * plus TRADE_IN_OUTFIT_RATIO of every outfit's price, rounded per step like
 * the engine (FUN_004bd3c0; see the ratio docs). Outfit ids with missing
 * data contribute 0.
 */
export function tradeInValue(currentShipPrice: number, currentOutfits: Outfits,
    outfitPrice: (id: string) => number | null): number {
    let total = Math.round(currentShipPrice * TRADE_IN_SHIP_RATIO);
    for (const [id, { count }] of currentOutfits) {
        const price = outfitPrice(id);
        if (price !== null) {
            total = Math.round(total + price * count * TRADE_IN_OUTFIT_RATIO);
        }
    }
    return total;
}

/** The full price of the new ship minus its trade-in, never below 0. */
export function netShipPrice(ship: ShipData, priceMod: number,
    tradeIn: number): number {
    return Math.max(0, shipPrice(ship, priceMod) - tradeIn);
}

/** Whether the player can afford the (net) ship price. */
export function canBuyShip(wallet: Wallet, ship: ShipData, priceMod: number,
    tradeIn: number): boolean {
    return wallet.credits >= netShipPrice(ship, priceMod, tradeIn);
}

/**
 * Buys `ship`: deducts its net price and transfers the current outfits
 * whole. (The Bible only requires oütf-flag-0x0004 persistent outfits to
 * survive a trade; oütf flags aren't parsed yet, so everything transfers —
 * the ship providers recompute the new ship's physics from them.) Returns
 * null when unaffordable.
 */
export function buyShip(wallet: Wallet, ship: ShipData, priceMod: number,
    tradeIn: number, currentOutfits: Outfits): ShipPurchaseResult | null {
    const netPrice = netShipPrice(ship, priceMod, tradeIn);
    if (!canBuyShip(wallet, ship, priceMod, tradeIn)) {
        return null;
    }
    return {
        credits: wallet.credits - netPrice,
        outfits: new Map(currentOutfits),
        mutation: { kind: "buyShip", shipId: ship.id, netPrice, tradeIn },
    };
}
