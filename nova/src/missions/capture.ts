// Ship capture (P4 of cargo+capture): whether a boarding attempt ends with
// the disabled ship joining the player's fleet. The odds formula is a
// flagged approximation — the Nova Bible documents the inputs (crew counts
// and marine outfits) but not the formula — so it is centralized here with
// exported constants, the same way boarding.ts flags its Booty bands.
//
// Pure TypeScript — no PIXI/ECS — so the odds stay headless testable;
// mission_ship_plugin.ts is the ECS glue. It rolls capture on the SAME
// seeded stream the plunder used (boardRng), drawn LAST so the loot rolls
// never shift whether or not a capture is attempted, and on success
// converts the boarded entity into an escort (nova_plugin/escort_plugin.ts
// fleet model from Phase 3).
//
// Bible facts:
//   - shïp Crew: the defender's crew. "Ships with 0 crew can't be boarded,
//     nor can they capture" — this engine disables and boards such ships
//     anyway, so the glue treats a 0-crew defender as trivially capturable
//     (auto-capture, no roll; flagged approximation).
//   - oütf ModType 25 "marines": ModVal >= 1 adds that many crew to the
//     boarder's effective crew; ModVal -1..-100 adds |ModVal| percent to
//     the capture odds. OutfitParse aggregates both into
//     OutfitData.marines.

import { OutfitData } from "novadatainterface/OutiftData";

// The crew ratio is weighted by this before the marines bonus: equal crews
// sit at 75 * 0.5 = 37.5%.
export const CAPTURE_ODDS_WEIGHT = 75;
// The clamp: no crew configuration is ever certain or hopeless.
export const CAPTURE_ODDS_MIN = 5;
export const CAPTURE_ODDS_MAX = 95;

// The marine contribution of an outfit set: extra boarding crew plus a
// bonus-percent term (OutfitData.marines satisfies this structurally).
export interface Marines {
    crew: number;
    oddsPercent: number;
}

// Sums the marine contributions of the player's owned outfits — one
// [OutfitData, count] pair per owned outfit.
export function outfitMarines(owned: Iterable<readonly [OutfitData, number]>):
    Marines {
    let crew = 0;
    let oddsPercent = 0;
    for (const [outfit, count] of owned) {
        crew += outfit.marines.crew * count;
        oddsPercent += outfit.marines.oddsPercent * count;
    }
    return { crew, oddsPercent };
}

// The boarder's effective crew: their ship's crew plus marine outfits.
export function effectivePlayerCrew(shipCrew: number, marineCrew: number):
    number {
    return shipCrew + marineCrew;
}

// Capture odds in percent: the player's share of the total crew, weighted,
// plus the marines percent bonus, clamped to [MIN, MAX]. With no crew on
// either side the ratio term defaults to the equal-crew midpoint (the glue
// auto-captures 0-crew defenders before rolling; this is the pure-formula
// guard).
export function captureOdds(playerCrew: number, defenderCrew: number,
    marinePercent: number): number {
    const total = playerCrew + defenderCrew;
    const ratio = total > 0 ? playerCrew / total : 0.5;
    const raw = CAPTURE_ODDS_WEIGHT * ratio + marinePercent;
    return Math.min(CAPTURE_ODDS_MAX, Math.max(CAPTURE_ODDS_MIN, raw));
}

// One capture draw. `rng` is the boarding stream — the glue passes the same
// boardRng instance resolveBoard consumed, so this is the stream's LAST
// draw and the loot rolls are identical whether or not a capture happens.
export function rollCapture(rng: () => number, oddsPercent: number): boolean {
    return rng() * 100 < oddsPercent;
}
