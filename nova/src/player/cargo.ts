// The player's cargo hold: pure transitions over the `PlayerState.cargo`
// list (see player_state.ts). Pure TypeScript — no PIXI/ECS, no game data —
// so the hold arithmetic stays headless testable; the callers (mission BBS,
// LandSystem, MissionShipBoardedSystem) read the ship's capacity from its
// ShipPhysicsComponent and apply mission/boarding 'cargo' effects through
// applyCargoEffects.
//
// Cargo identities: `type` 0-5 is a standard commodity (the STR#4000 order
// the mïsn CargoType/Booty bits and rollCargo use); any other value is a
// jünk resource's raw id. Quantities are tons.

// One hold entry: `qty` tons of commodity/jünk `type`. Entries never split
// per origin — everything of one type merges into one entry.
export interface CargoEntry {
    type: number;
    qty: number;
}

// Standard commodities are types 0-5; anything above is a jünk raw id.
export const STANDARD_COMMODITY_COUNT = 6;

export function isStandardCommodity(type: number): boolean {
    return type >= 0 && type < STANDARD_COMMODITY_COUNT;
}

// Total tons in the hold.
export function cargoUsedTons(cargo: readonly CargoEntry[]): number {
    return cargo.reduce((total, entry) => total + entry.qty, 0);
}

// Tons of one type currently in the hold.
export function cargoOf(cargo: readonly CargoEntry[], type: number): number {
    return cargo.reduce((total, entry) => entry.type === type ? total + entry.qty : total, 0);
}

export interface CargoMoveResult {
    // The updated hold (the same array when nothing moved — entries are
    // replaced, never mutated).
    cargo: CargoEntry[];
    // Tons actually moved (<= the requested qty).
    moved: number;
}

/**
 * Loads up to `qty` tons of `type`, capped by `freeTons` and merged into any
 * existing entry of the same type. The hold is returned as a new array (the
 * input is untouched) with `moved` <= min(qty, freeTons).
 */
export function tryLoadCargo(cargo: CargoEntry[], type: number,
    qty: number, freeTons: number): CargoMoveResult {
    if (qty <= 0) {
        return { cargo, moved: 0 };
    }
    const moved = Math.min(qty, Math.max(0, freeTons));
    if (moved <= 0) {
        return { cargo, moved: 0 };
    }
    const index = cargo.findIndex(entry => entry.type === type);
    const next = cargo.slice();
    if (index >= 0) {
        const entry = cargo[index];
        next[index] = { type: entry.type, qty: entry.qty + moved };
    }
    else {
        next.push({ type, qty: moved });
    }
    return { cargo: next, moved };
}

/**
 * Unloads up to `qty` tons of `type` — never more than the hold carries, so
 * the hold never goes negative. Emptied entries are removed.
 */
export function tryUnloadCargo(cargo: CargoEntry[], type: number,
    qty: number): CargoMoveResult {
    if (qty <= 0) {
        return { cargo, moved: 0 };
    }
    const index = cargo.findIndex(entry => entry.type === type);
    if (index < 0) {
        return { cargo, moved: 0 };
    }
    const entry = cargo[index];
    const moved = Math.min(qty, entry.qty);
    const next = cargo.slice();
    if (moved < entry.qty) {
        next[index] = { type: entry.type, qty: entry.qty - moved };
    }
    else {
        next.splice(index, 1);
    }
    return { cargo: next, moved };
}

// A mission/boarding cargo effect (the MissionEffect 'cargo' variant): a
// signed tonnage, positive = load, negative = unload. Structural so this
// module does not import the mission FSM (the arrow points missions ->
// player).
export interface CargoEffect {
    kind: "cargo";
    type: number;
    qty: number;
}

export function isCargoEffect(effect: unknown): effect is CargoEffect {
    return typeof effect === "object" && effect !== null
        && (effect as { kind?: unknown }).kind === "cargo";
}

export interface CargoEffectsResult {
    // Tons loaded and unloaded across every applied effect.
    loaded: number;
    unloaded: number;
}

/**
 * Applies every {kind: 'cargo'} effect into `state.cargo`, in order:
 * positive qty loads (capped by the `freeTons` budget — take what fits),
 * negative qty unloads (never below zero). `freeTons` is the free space at
 * call time; an unload in the same batch frees space for a later load, and
 * `null` means the capacity is unknown, so loads are unconditional.
 * Non-cargo effects (text, pay, …) are ignored.
 */
export function applyCargoEffects(state: { cargo: CargoEntry[] },
    effects: ReadonlyArray<unknown>, freeTons: number | null): CargoEffectsResult {
    // Convert the free-space budget into total capacity so unloads widen it
    // (and earlier loads narrow it) as the batch runs.
    let used = cargoUsedTons(state.cargo);
    const capacity = freeTons === null ? null : freeTons + used;
    let loaded = 0;
    let unloaded = 0;

    for (const effect of effects) {
        if (!isCargoEffect(effect) || effect.qty === 0) {
            continue;
        }
        if (effect.qty > 0) {
            const free = capacity === null ? effect.qty : capacity - used;
            const result = tryLoadCargo(state.cargo, effect.type, effect.qty, free);
            if (result.moved > 0) {
                state.cargo = result.cargo;
                used += result.moved;
                loaded += result.moved;
            }
        }
        else {
            const result = tryUnloadCargo(state.cargo, effect.type, -effect.qty);
            if (result.moved > 0) {
                state.cargo = result.cargo;
                used -= result.moved;
                unloaded += result.moved;
            }
        }
    }
    return { loaded, unloaded };
}

/**
 * OR of the jünk scan masks of everything illegal in the hold — what a
 * planetary scan would flag (helper for scan enforcement; no scan system
 * exists yet). Standard commodities (types 0-5) are excluded: stock legality
 * for them keys on carried quantity, not a per-good mask.
 */
export function cargoIllegalMask(cargo: readonly CargoEntry[],
    junkScanMasks: Map<number, number>): number {
    return cargo.reduce((mask, entry) => {
        if (isStandardCommodity(entry.type)) {
            return mask;
        }
        return mask | (junkScanMasks.get(entry.type) ?? 0);
    }, 0);
}
