// Ship capture (P4 of cargo+capture): whether a boarding attempt ends with
// the disabled ship joining the player's fleet. The odds formula is
// REVERSE-ENGINEERED from the binary (see the constants below) — it weights
// the BOARDER's crew pool, never the defender's.
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

// The crew pool is the engine's capture measure: the boarding setup
// FUN_00484230 (percent in DAT_007d17da) weights YOUR crew, never the
// defender's. REVERSE-ENGINEERED from the binary (EV Nova 1.0.10 Windows):
//
//   pool = ownCrew + marine outfits' crew (oütf ModType 25, ModVal > 0)
//          + 10% of each escort warship's crew (shïp aiType > 2)
//   odds = round(pool / (ownCrew * 10) * 100)        → 10% with no help
//   odds += marine outfits' oddsPercent (ModVal -1..-100, |val| per unit)
//   odds += 10 if ownStrength + Σ(10% × escort Strength) > 5 × ownStrength
//
// Per attempt the engine jitters odds by 5 - rand(11) (±5), clamps to
// [CAPTURE_ODDS_MIN, CAPTURE_ODDS_MAX] = [1, 75], and captures when
// rand(100) <= odds. odds drop to 0 (no capture possible) when the target's
// government forbids it (govt flag 0x800, shïp +0xab8 == 0) — this port's
// glue models the reachable surface and auto-resolves 0-crew defenders
// before rolling, so no defender term appears here. The escort terms need
// fleet-wide shïp Strength/crew data the glue does not thread into this
// pure module; captureOdds covers the no-escort surface exactly.
export const CAPTURE_ODDS_BASE_PERCENT = 10;
export const CAPTURE_CREW_DENOMINATOR = 10;
export const CAPTURE_ODDS_MIN = 1;
export const CAPTURE_ODDS_MAX = 75;
export const CAPTURE_ODDS_JITTER = 5;

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

// Capture odds in percent (pre-jitter): your crew pool — own crew plus
// marine outfits' extra crew — as a percentage of 10× your own crew, plus
// the marines' percent bonus. With no marines this is always
// CAPTURE_ODDS_BASE_PERCENT. The engine's clamping and ±5 jitter happen per
// roll (see rollCapture); a 0-crew boarder can never roll (the glue
// auto-captures 0-crew defenders first).
export function captureOdds(playerCrew: number, marineCrew: number,
    marinePercent: number): number {
    if (playerCrew <= 0) {
        return 100;
    }
    const pool = playerCrew + Math.max(0, marineCrew);
    const raw = (pool / (playerCrew * CAPTURE_CREW_DENOMINATOR))
        * 100 + marinePercent;
    return Math.round(raw);
}

// One capture draw. `rng` is the boarding stream — the glue passes the same
// boardRng instance resolveBoard consumed, so this is the stream's LAST
// draw and the loot rolls are identical whether or not a capture happens.
// Two draws, like the engine: the ±CAPTURE_ODDS_JITTER jitter
// (5 - rand(11)), then the capture roll itself (rand(100) <= odds).
export function rollCapture(rng: () => number, oddsPercent: number): boolean {
    const jittered = oddsPercent + CAPTURE_ODDS_JITTER
        - Math.floor(rng() * (2 * CAPTURE_ODDS_JITTER + 1));
    const odds = Math.min(CAPTURE_ODDS_MAX,
        Math.max(CAPTURE_ODDS_MIN, jittered));
    return Math.floor(rng() * 100) <= odds;
}
