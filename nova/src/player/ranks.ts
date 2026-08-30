// The pilot's ranks (ränk): activation/deactivation with their cascade
// flags, salaries, the price modifier and the rank Contribute masks (P7).
// Pure TypeScript — no PIXI/ECS — so the rules stay headless testable; the
// set-expression glue (mission_plugin.ts), the jump hook (jump_plugin.ts)
// and the outfitter/shipyard call into this module.
//
// Flag semantics (EV Nova Bible, ränk Flags):
//   0x0001  on activate: deactivate all other active ranks of the same govt.
//   0x0002  on deactivate: deactivate all other active ranks of the same govt.
//   0x0004  deactivate when the player destroys/disables a ship of the
//           affiliated govt or its allies (legal_status.ts wires this).
//   0x0008  permanent: immune to everything except an explicit L set-op.
//   0x0010/0x0020  like 0x0001/0x0002 but only lower-weighted ranks.
//   0x0040  deactivate on any crime against the affiliated govt
//           (legal_status.ts wires this).
// Cascade removals are flat: deactivating a rank never re-triggers that
// rank's own 0x0002/0x0020 cascade, so mutually-cascading data terminates.

import { RankData } from "novadatainterface/RankData";
import { PlayerState } from "./player_state";


// <PRK>/<SRK>/<RRK> fall back to this when the player holds no matching
// rank (EV Nova behavior); mission_text re-exports it.
export const DEFAULT_RANK_NAME = "captain";

export interface RankEnv {
    rank(id: string): RankData | null;
}


// --- activation / deactivation ---

/**
 * The K set-op: activates `rankId` (most recently activated rank, <RRK>) and
 * applies the activate cascades — 0x0001 strips all other active same-govt
 * ranks, 0x0010 only lower-weighted ones, 0x0008 ranks are spared. Returns
 * the ids deactivated by the cascade. Missing rank data still activates the
 * id (state bookkeeping), it just cannot cascade.
 */
export function activateRank(state: PlayerState, rankId: string,
    env: RankEnv | null): string[] {
    const rank = env?.rank(rankId) ?? null;
    const deactivated: string[] = [];
    if (rank) {
        for (const otherId of state.activeRanks) {
            if (otherId === rankId) {
                continue;
            }
            const other = env!.rank(otherId);
            if (!other || (other.flags & 0x0008) !== 0 || !ranksShareGovt(other, rank)) {
                continue;
            }
            if ((rank.flags & 0x0001) !== 0
                || ((rank.flags & 0x0010) !== 0 && other.weight < rank.weight)) {
                deactivated.push(otherId);
            }
        }
    }
    for (const id of deactivated) {
        removeRank(state, id);
    }
    if (!state.activeRanks.includes(rankId)) {
        state.activeRanks.push(rankId);
    }
    state.lastActivatedRank = rankId;
    return deactivated;
}

/**
 * The L set-op (and the shared removal path for the involuntary
 * deactivations in legal_status.ts): deactivates `rankId` and applies the
 * deactivate cascades — 0x0002 strips all other active same-govt ranks,
 * 0x0020 only lower-weighted ones, 0x0008 ranks are spared. Unlike the
 * involuntary paths this MAY remove a permanent rank: the Bible exempts
 * ranks deactivated "explicitly by a control bit eval string". Returns the
 * ids deactivated by the cascade; [] when the rank was not active.
 */
export function deactivateRank(state: PlayerState, rankId: string,
    env: RankEnv | null): string[] {
    const rank = env?.rank(rankId) ?? null;
    if (!removeRank(state, rankId)) {
        return [];
    }
    const deactivated: string[] = [];
    if (rank) {
        for (const otherId of state.activeRanks) {
            const other = env!.rank(otherId);
            if (!other || (other.flags & 0x0008) !== 0 || !ranksShareGovt(other, rank)) {
                continue;
            }
            if ((rank.flags & 0x0002) !== 0
                || ((rank.flags & 0x0020) !== 0 && other.weight < rank.weight)) {
                deactivated.push(otherId);
            }
        }
        for (const id of deactivated) {
            removeRank(state, id);
        }
    }
    return deactivated;
}

function removeRank(state: PlayerState, rankId: string): boolean {
    const index = state.activeRanks.indexOf(rankId);
    if (index < 0) {
        return false;
    }
    state.activeRanks.splice(index, 1);
    return true;
}

function ranksShareGovt(a: RankData, b: RankData): boolean {
    return a.govt !== null && a.govt === b.govt;
}


// --- salary ---

/**
 * Pays every active rank's `salary` (credits/day) for `days` game days,
 * skipping ranks whose salaryCap the pilot's cash has reached (0 or -1 is
 * uncapped). Called once per date advance; one hyperspace jump is one day.
 * Returns the total paid.
 */
export function applyDailySalaries(state: PlayerState, env: RankEnv | null,
    days = 1): number {
    if (!env || days <= 0) {
        return 0;
    }
    let paid = 0;
    for (const id of [...state.activeRanks]) {
        const rank = env.rank(id);
        if (!rank || rank.salary === 0) {
            continue;
        }
        if (rank.salaryCap > 0 && state.credits >= rank.salaryCap) {
            continue;
        }
        const amount = rank.salary * days;
        state.credits += amount;
        paid += amount;
    }
    return paid;
}


// --- prices ---

/**
 * The price multiplier (1 = unchanged) for items and ships bought at
 * planets owned by `govtId`: the PriceMod of the highest-weight active rank
 * affiliated with that govt, over 100. Hook-only for now: the outfitter and
 * shipyard have no purchase flow yet, so no consumer wires this until they
 * price items.
 */
export function priceMod(state: PlayerState, env: RankEnv | null,
    govtId: string | null): number {
    if (!env || govtId === null) {
        return 1;
    }
    let best: RankData | null = null;
    for (const id of state.activeRanks) {
        const rank = env.rank(id);
        if (!rank || rank.govt !== govtId) {
            continue;
        }
        if (best === null || rank.weight > best.weight) {
            best = rank;
        }
    }
    return best === null ? 1 : best.priceMod / 100;
}


// --- contribute pool ---

/**
 * The 64-bit Contribute masks of every active rank, OR'd together. Merged
 * into the availability Contribute pool next to the ship's and outfits'.
 */
export function activeRankContributes(state: PlayerState, env: RankEnv | null):
    [number, number] {
    const out: [number, number] = [0, 0];
    if (!env) {
        return out;
    }
    for (const id of state.activeRanks) {
        const rank = env.rank(id);
        if (!rank) {
            continue;
        }
        out[0] |= rank.contributes[0];
        out[1] |= rank.contributes[1];
    }
    return out;
}


// --- <PRK>/<SRK>/<RRK> resolution ---

/**
 * The highest-weight active rank — the rank <PRK>/<SRK> name — optionally
 * restricted to one government's ranks (the <PRKnnn>/<SRKnnn> tags). Null
 * when the player holds no matching rank.
 */
export function highestWeightActiveRank(state: PlayerState, env: RankEnv | null,
    govtRawId?: number): RankData | null {
    if (!env) {
        return null;
    }
    let best: RankData | null = null;
    for (const id of state.activeRanks) {
        const rank = env.rank(id);
        if (!rank) {
            continue;
        }
        if (govtRawId !== undefined && rawGovtId(rank.govt) !== govtRawId) {
            continue;
        }
        if (best === null || rank.weight > best.weight) {
            best = rank;
        }
    }
    return best;
}

// <PRK>: the conversational name of the highest-weight active rank.
export function rankConvName(rank: RankData | null): string {
    return rank?.convName || DEFAULT_RANK_NAME;
}

// <SRK>: the short name of the highest-weight active rank.
export function rankShortName(rank: RankData | null): string {
    return rank?.shortName || DEFAULT_RANK_NAME;
}

// <RRK>: the conversational name of the most recently activated rank.
export function mostRecentRankName(state: PlayerState, env: RankEnv | null): string {
    if (state.lastActivatedRank === null) {
        return DEFAULT_RANK_NAME;
    }
    return rankConvName(env?.rank(state.lastActivatedRank) ?? null);
}

// Global govt id -> raw id ("nova:136" -> 136). Kept local because player/
// cannot import missions/ (stellar_filter has the shared copy).
function rawGovtId(globalId: string | null): number {
    if (globalId === null) {
        return NaN;
    }
    const colon = globalId.lastIndexOf(":");
    return colon < 0 ? NaN : parseInt(globalId.slice(colon + 1), 10);
}
