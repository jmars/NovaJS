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

// jünk flags (JunkData.flags): 0x0001 tribbles multiply, 0x0002 perishable
// decays. Both flags on one jünk are applied tribbles-first.
export const TRIBBLE_FLAG = 0x0001;
export const PERISHABLE_FLAG = 0x0002;

// APPROX: the Bible documents the flags but no rates, and stock data flags
// no jünk (all 23 flags=0), so these are tunable guesses, single-sourced
// here. Tribbles double each jump-day; perishables lose ceil(10%) of their
// tons each jump-day (min 1, down to 0).
export const TRIBBLE_GROWTH_PER_DAY = 2;
export const PERISHABLE_DECAY_FRACTION = 0.10;

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
 * Applies one jump-day of commodity decay to `cargo`. Standard commodities
 * (types 0-5) are never touched; a jünk with unknown/undefined flags is left
 * unchanged. Tribble entries grow by (TRIBBLE_GROWTH_PER_DAY - 1) × qty,
 * capped by the hold's free tonnage — the unbounded-growth answer. `freeTons`
 * is the free space at call time (ship_plugin.shipFreeCargoTons): decay
 * frees space for later growth and growth consumes it, and `null` (unknown
 * capacity) grows unconditionally, matching the cargo-pickup convention in
 * applyCargoEffects. Deterministic arithmetic — no rng.
 */
export function applyCargoDecay(cargo: CargoEntry[],
    flagsOf: (type: number) => number | undefined,
    freeTons: number | null): CargoDecayResult {
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
                    const growth = Math.min(qty * (TRIBBLE_GROWTH_PER_DAY - 1),
                        capacity === null ? Infinity : capacity - used);
                    if (growth > 0) {
                        qty += growth;
                        used += growth;
                        effects.push({ type: entry.type, qty: growth });
                    }
                }
                if (flags & PERISHABLE_FLAG) {
                    const loss = Math.min(qty,
                        Math.ceil(qty * PERISHABLE_DECAY_FRACTION));
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
