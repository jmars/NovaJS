// Combat-rating tier names (STR# 138): which of the "Combat Ratings"
// strings a pilot's kill count earns. Pure TypeScript — no PIXI/ECS — so
// the mapping stays headless testable; no UI calls it yet.
//
// STR# 138 ("Combat Ratings") lists the tier names in ascending order; the
// rating threshold for entry i is COMBAT_TIER_THRESHOLDS[i]. Those
// thresholds come from the Nova Bible Appendix I illustration (which notes
// the list "can be changed by editing STR# 138" — the strings are the
// editable part; the thresholds are fixed here). Verified against the real
// data: STR# 138 has exactly these 11 entries in this order.

import { StringSetData } from "novadatainterface/StringSetData";


// Rating (kill count) needed to hold each STR# 138 tier, in string order.
export const COMBAT_TIER_THRESHOLDS = [
    0, 1, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600,
];

// Fallback when STR# 138 is missing or empty (Bible: the lowest tier).
export const DEFAULT_COMBAT_TIER_NAME = "No Ability";

/**
 * The name of the highest tier whose threshold is <= `rating`. Tiers beyond
 * the available strings are clamped to the last string; an empty set falls
 * back to DEFAULT_COMBAT_TIER_NAME.
 */
export function combatTierName(rating: number, tierStrings: string[]): string {
    if (tierStrings.length === 0) {
        return DEFAULT_COMBAT_TIER_NAME;
    }
    // The last entry whose threshold the rating has reached. Thresholds
    // beyond the string count are simply unused; the string count clamps
    // the index.
    let tier = 0;
    const maxTier = Math.min(tierStrings.length, COMBAT_TIER_THRESHOLDS.length);
    while (tier + 1 < maxTier && rating >= COMBAT_TIER_THRESHOLDS[tier + 1]) {
        tier += 1;
    }
    return tierStrings[tier];
}

/**
 * Resolver over the parsed data: combatTierName against the STR# 138
 * strings (missing StringSetData degrades to the empty set).
 */
export function combatTierNameFrom(rating: number,
    stringSet: StringSetData | null | undefined): string {
    return combatTierName(rating, stringSet?.strings ?? []);
}
