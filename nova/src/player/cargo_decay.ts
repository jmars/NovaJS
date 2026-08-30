// One-jump-day commodity decay over the player's cargo hold
// (PlayerState.cargo; see player/cargo.ts). Pure TypeScript — no PIXI/ECS,
// no game data — so the arithmetic stays headless testable; the caller
// (MissionJumpStateSystem, the only date-advance site) supplies the jünk
// flags lookup and the ship's free tonnage, and logs the effects.
//
// Landing never advances the day, so this never runs at a spaceport.

import {
    cargoUsedTons,
    CargoEntry,
    isStandardCommodity,
} from "./cargo";

// jünk flags (JunkData.flags): 0x0001 tribbles grow, 0x0002 perishable
// decays. Both flags on one jünk are applied tribbles-first.
export const TRIBBLE_FLAG = 0x0001;
export const PERISHABLE_FLAG = 0x0002;

// REVERSE-ENGINEERED from the binary (EV Nova 1.0.10 Windows, the landing
// tick FUN_0044aa70 @ 0x451e6f): both effects fire only on jump-days where
// the engine's jump counter (FUN_00417600 @ 0x417c20 increments it once per
// day from game start) satisfies dayCount % 250 == 0 — roughly every 250th
// jump. On such a day a tribble-flagged jünk with cargo on hand grows by
// exactly 1 ton (FOLKLORE NOTE: it does NOT double), and a
// perishable-flagged jünk loses exactly 1 ton — no percentage anywhere.
// Both loops are skipped while the hold has no free space, and stock data
// flags no jünk with either bit (all 23 flags = 0), so these paths only
// run for plugin data.
export const DECAY_PERIOD_DAYS = 250;
export const TRIBBLE_GROWTH_TONS = 1;
export const PERISHABLE_DECAY_TONS = 1;

// One hold change: signed tonnage for jünk `type` — positive = tribble
// growth, negative = perishable decay. Only changed entries appear.
export interface DecayEffect {
    type: number;
    qty: number;
}

export interface CargoDecayResult {
    // The updated hold (the same array when nothing changed — entries are
    // replaced, never mutated; emptied entries are removed).
    cargo: CargoEntry[];
    effects: DecayEffect[];
}

/**
 * Applies one jump-day of commodity decay to `cargo`. Runs the engine's
 * real schedule (cargo_decay.ts constants): nothing happens unless
 * `dayCount % DECAY_PERIOD_DAYS === 0` — the caller passes the jump
 * counter it advances each landing — and then tribble entries grow by
 * TRIBBLE_GROWTH_TONS (capped by the hold's free tonnage) and perishable
 * entries lose PERISHABLE_DECAY_TONS. Standard commodities (types 0-5)
 * are never touched; a jünk with unknown/undefined flags is left
 * unchanged. `freeTons` is the free space at call time
 * (ship_plugin.shipFreeCargoTons): decay frees space for later growth and
 * growth consumes it, and `null` (unknown capacity) grows
 * unconditionally, matching the cargo-pickup convention in
 * applyCargoEffects. Deterministic arithmetic — no rng.
 */
export function applyCargoDecay(cargo: CargoEntry[],
    flagsOf: (type: number) => number | undefined,
    freeTons: number | null, dayCount: number): CargoDecayResult {
    // The engine runs these effects only on the 250th-jump days; the caller
    // supplies the same jump counter it advances per landing.
    if (dayCount <= 0 || dayCount % DECAY_PERIOD_DAYS !== 0) {
        return { cargo, effects: [] };
    }
    let used = cargoUsedTons(cargo);
    // Track the free-space budget as a total capacity so decay widens it
    // (and earlier growth narrows it) as the pass runs.
    const capacity = freeTons === null ? null : freeTons + used;
    const next: CargoEntry[] = [];
    const effects: DecayEffect[] = [];

    for (const entry of cargo) {
        let qty = entry.qty;
        if (!isStandardCommodity(entry.type) && qty > 0) {
            const flags = flagsOf(entry.type);
            if (flags !== undefined) {
                if (flags & TRIBBLE_FLAG) {
                    const growth = Math.min(TRIBBLE_GROWTH_TONS,
                        capacity === null ? Infinity : capacity - used);
                    if (growth > 0) {
                        qty += growth;
                        used += growth;
                        effects.push({ type: entry.type, qty: growth });
                    }
                }
                if (flags & PERISHABLE_FLAG) {
                    // Faithfulness quirk: the engine gates the perishable
                    // loop on the same free-space check as tribble growth,
                    // so a completely full hold never spoils either.
                    const loss = Math.min(qty, PERISHABLE_DECAY_TONS);
                    if (loss > 0) {
                        qty -= loss;
                        used -= loss;
                        effects.push({ type: entry.type, qty: -loss });
                    }
                }
            }
        }
        if (qty > 0) {
            next.push({ type: entry.type, qty });
        }
    }
    return { cargo: next, effects };
}
