// Headless specs for the combat-rating tier names (STR# 138): boundary
// thresholds, clamping to the available strings, and the empty-set
// fallback. The reference strings are the real ones parsed from STR# 138.

import "jasmine";
import {
    combatTierName,
    combatTierNameFrom,
    COMBAT_TIER_THRESHOLDS,
    DEFAULT_COMBAT_TIER_NAME,
} from "./combat_tier";

// STR# 138 ("Combat Ratings") as parsed from the real game data.
const TIERS = [
    "No Ability",
    "Little Ability",
    "Fair Ability",
    "Average Ability",
    "Good Ability",
    "Competent",
    "Very Competent",
    "Worthy of Note",
    "Dangerous",
    "Deadly",
    "Frightening",
];

describe("combat tier", function() {
    it("has one threshold per real STR# 138 entry", function() {
        expect(COMBAT_TIER_THRESHOLDS.length).toEqual(TIERS.length);
    });

    it("names the tier for the exact threshold ratings", function() {
        expect(combatTierName(0, TIERS)).toEqual("No Ability");
        expect(combatTierName(1, TIERS)).toEqual("Little Ability");
        expect(combatTierName(100, TIERS)).toEqual("Fair Ability");
        expect(combatTierName(200, TIERS)).toEqual("Average Ability");
        expect(combatTierName(400, TIERS)).toEqual("Good Ability");
        expect(combatTierName(800, TIERS)).toEqual("Competent");
        expect(combatTierName(1600, TIERS)).toEqual("Very Competent");
        expect(combatTierName(3200, TIERS)).toEqual("Worthy of Note");
        expect(combatTierName(6400, TIERS)).toEqual("Dangerous");
        expect(combatTierName(12800, TIERS)).toEqual("Deadly");
        expect(combatTierName(25600, TIERS)).toEqual("Frightening");
    });

    it("keeps the tier below a boundary just under each threshold", function() {
        expect(combatTierName(99, TIERS)).toEqual("Little Ability");
        expect(combatTierName(199, TIERS)).toEqual("Fair Ability");
        expect(combatTierName(25599, TIERS)).toEqual("Deadly");
    });

    it("clamps ratings above the last threshold to the last tier", function() {
        expect(combatTierName(25601, TIERS)).toEqual("Frightening");
        expect(combatTierName(1000000, TIERS)).toEqual("Frightening");
    });

    it("clamps to the available strings when STR# 138 is shorter", function() {
        expect(combatTierName(0, TIERS.slice(0, 1))).toEqual("No Ability");
        expect(combatTierName(1, TIERS.slice(0, 1))).toEqual("No Ability");
        expect(combatTierName(6400, TIERS.slice(0, 3))).toEqual("Fair Ability");
        expect(combatTierName(25600, TIERS.slice(0, 3))).toEqual("Fair Ability");
    });

    it("ignores thresholds beyond a shorter string set", function() {
        const partial = TIERS.slice(0, 5);
        expect(combatTierName(400, partial)).toEqual("Good Ability");
        expect(combatTierName(800, partial)).toEqual("Good Ability");
    });

    it("falls back to the lowest tier name for an empty set", function() {
        expect(combatTierName(0, [])).toEqual(DEFAULT_COMBAT_TIER_NAME);
        expect(combatTierName(25600, [])).toEqual(DEFAULT_COMBAT_TIER_NAME);
    });

    it("resolves through StringSetData, tolerating missing data", function() {
        expect(combatTierNameFrom(99, { strings: TIERS } as any))
            .toEqual("Little Ability");
        expect(combatTierNameFrom(99, null)).toEqual(DEFAULT_COMBAT_TIER_NAME);
        expect(combatTierNameFrom(99, undefined))
            .toEqual(DEFAULT_COMBAT_TIER_NAME);
    });
});
