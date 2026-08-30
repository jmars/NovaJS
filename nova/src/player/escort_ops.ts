// Pure escort-fleet operations for the fleet dialog (nova/spaceport/
// fleet_dialog.ts). No PIXI/ECS imports — headless testable
// (escort_ops_test.ts), the purchase.ts pattern. Unlike purchase.ts these
// mutate the passed state in place (the caller's PlayerState.fleet is the
// persistent model that EscortDeathSystem etc. also mutate) and return a
// summary of what changed for the UI + logging.
//
// Money rules verified against the EV Nova Bible (Nova Bible.txt, shïp
// fields, "EscSellValue"/"EscUpgrdCost"):
//   - Escort sell price: the shïp EscSellValue field; 0 means "default",
//     which the Bible gives as 10% of the ship's Cost. (This is the
//     fleet-screen sale price, NOT the shipyard trade-in of purchase.ts.)
//   - Escort upgrade price: the shïp EscUpgrdCost of the CURRENT ship buys
//     the upgrade to its UpgradeTo ship. PriceMod (ränk field) is applied
//     on this buy, matching purchase.ts's buy-only convention.
//   - Upgrading replaces the fleet entry's shipType; sell value and orders
//     are re-derived from the new ship afterwards.

import { ShipData } from "novadatainterface/ShipData";
import { EscortState, FleetState } from "./player_state";

/** The player's money + fleet; structurally PlayerState (which carries both). */
export interface FleetWallet {
    credits: number;
    fleet: FleetState;
}

/** What an escort has been ordered to do. `hold` parks it until reordered. */
export type EscortOrder = 'follow' | 'hold';

export const DEFAULT_ESCORT_ORDER: EscortOrder = 'follow';

/** escort-plugin save files written before orders existed load as `follow`. */
export function normalizeEscortOrder(order: unknown): EscortOrder {
    return order === 'hold' ? 'hold' : DEFAULT_ESCORT_ORDER;
}

/** The price one escort of `shipData` sells for: EscSellValue, or the
 * Bible default of 10% of the ship's cost when the field is 0. */
export function escortSellValue(shipData: ShipData): number {
    return shipData.escortSellValue > 0
        ? shipData.escortSellValue
        : Math.round(shipData.price * 0.10);
}

/** What upgrading an escort of `shipData` costs here (buy-only priceMod). */
export function escortUpgradePrice(shipData: ShipData, priceMod: number): number {
    return Math.round(shipData.escortUpgradeCost * priceMod);
}

export interface EscortSellResult {
    credits: number;   // wallet after the sale
    fleet: FleetState; // fleet after the sale (escort removed)
    value: number;     // what the escort sold for
}

/**
 * Sells the escort at `fleetIndex`: credits the player its sell value and
 * removes it from the fleet (the EscortReconcileSystem then deletes the
 * entity, and a sold escort never respawns on the next warp-in). Returns
 * null when the index is out of range — callers decide how to signal that.
 */
export function sellEscort(wallet: FleetWallet, fleetIndex: number,
    shipData: ShipData): EscortSellResult | null {
    const escort = wallet.fleet.escorts[fleetIndex];
    if (!escort) {
        return null;
    }
    const value = escortSellValue(shipData);
    wallet.credits += value;
    wallet.fleet.escorts.splice(fleetIndex, 1);
    return { credits: wallet.credits, fleet: wallet.fleet, value };
}

/**
 * Whether the escort at `escort` (whose data is `shipData`) can upgrade to
 * its UpgradeTo ship here: it must have one, and the player must afford
 * the (price-modified) EscUpgrdCost.
 */
export function canUpgradeEscort(wallet: FleetWallet, escort: EscortState,
    shipData: ShipData, priceMod: number): boolean {
    if (shipData.upgradeTo === null) {
        return false;
    }
    return wallet.credits >= escortUpgradePrice(shipData, priceMod);
}

export interface EscortUpgradeResult {
    credits: number;     // wallet after the purchase
    fleet: FleetState;   // fleet after the swap (same entry, new shipType)
    newShipType: string; // the ship it became (upgradeTo global id)
}

/**
 * Upgrades the escort at `fleetIndex` to `shipData.upgradeTo`: charges the
 * (price-modified) EscUpgrdCost of the current ship and replaces the fleet
 * entry's shipType (orders and id carry over). Returns null when the ship
 * has no upgrade or the player can't afford it — never goes negative.
 */
export function upgradeEscort(wallet: FleetWallet, fleetIndex: number,
    shipData: ShipData, priceMod: number): EscortUpgradeResult | null {
    const escort = wallet.fleet.escorts[fleetIndex];
    if (!escort || !canUpgradeEscort(wallet, escort, shipData, priceMod)) {
        return null;
    }
    const cost = escortUpgradePrice(shipData, priceMod);
    wallet.credits -= cost;
    const upgraded: EscortState = { ...escort, shipType: shipData.upgradeTo! };
    wallet.fleet.escorts[fleetIndex] = upgraded;
    return {
        credits: wallet.credits,
        fleet: wallet.fleet,
        newShipType: shipData.upgradeTo!,
    };
}
