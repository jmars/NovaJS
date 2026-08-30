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
//   - Outfit sell-back: the Bible names no sell discount (its only
//     sell-related oütf flag is 0x0008 "can't be sold"), and EV Nova is
//     known to refund the full cost — so outfits sell back at Cost
//     (OUTFIT_SELL_RATIO). Flip the constant if a plugin-style discount is
//     ever wanted.
//   - Ship trade-in: "The cost of buying a ship is always the cost of the
//     new ship minus 25% of the original cost of your current ship and
//     upgrades" (shïp Cost field) — i.e. 25% of (old ship Cost + Cost of
//     its installed outfits).
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
 * Fraction of an outfit's Cost refunded when selling it back. EV Nova
 * refunds the full price (see module comment).
 */
export const OUTFIT_SELL_RATIO = 1;

/**
 * Fraction of the current ship's original cost (plus its outfits') credited
 * when trading up. Nova Bible: 25% of "your current ship and upgrades".
 */
export const TRADE_IN_RATIO = 0.25;

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
 * Returns null when the player has none to sell.
 */
export function sellOutfit(wallet: Wallet, outfits: Outfits, outfit: OutfitData,
    freeMass: number): OutfitPurchaseResult | null {
    const owned = outfits.get(outfit.id)?.count ?? 0;
    if (owned <= 0) {
        return null;
    }
    const refund = Math.round(outfit.price * OUTFIT_SELL_RATIO);
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
 * Trade-in credit for the current ship: TRADE_IN_RATIO of its original
 * price plus the original price of every outfit it carries (Nova Bible:
 * "25% of the original cost of your current ship and upgrades", rounded).
 * Outfit ids with missing data contribute 0.
 */
export function tradeInValue(currentShipPrice: number, currentOutfits: Outfits,
    outfitPrice: (id: string) => number | null): number {
    let total = currentShipPrice;
    for (const [id, { count }] of currentOutfits) {
        const price = outfitPrice(id);
        if (price !== null) {
            total += price * count;
        }
    }
    return Math.round(total * TRADE_IN_RATIO);
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
