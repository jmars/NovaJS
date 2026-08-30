// The pilot's legal record (gövt reputation) and its interplay with ranks
// (P7). Pure TypeScript — no PIXI/ECS — so the propagation rules stay
// headless testable; the mission FSM and the combat systems call into this
// module.
//
// Record semantics (EV Nova Bible, gövt fields): one record per government,
// 0 neutral, positive good, negative bad. An act for or against govt G is
// heard about beyond G: G's allies hear the same change (×1), and G's
// enemies hear the opposite (your standing with them moves the other way).
// Classmates are NOT notified — sharing a class is not an alliance.
//
// Rank interplay (ränk flags, Bible):
//   0x0040  deactivate the rank on any crime against its affiliated govt.
//   0x0004  deactivate the rank when the player destroys/disables a ship of
//           the affiliated govt or of one of its allies.
// Both are involuntary deactivations, so permanent ranks (0x0008) survive
// them; only an explicit L set-op may remove a permanent rank.

import { GovernmentData } from "novadatainterface/GovernmentData";
import { RankData } from "novadatainterface/RankData";
import { PlayerState } from "./player_state";
import { deactivateRank } from "./ranks";


// --- govt relation graph ---
//
// Lives here (not in missions/, which imports this package) so both the
// record propagation and the rank rules can use it. missions/stellar_filter
// re-exports these under the same names.

function classIntersection(classes: number[], others: number[]): boolean {
    for (const c of classes) {
        if (c >= 0 && others.includes(c)) {
            return true;
        }
    }
    return false;
}

// Whether `a` lists any of `b`'s classes as an ally.
export function govtsAreAllies(a: GovernmentData, b: GovernmentData): boolean {
    return classIntersection(a.classes, b.allies);
}

export function govtsAreEnemies(a: GovernmentData, b: GovernmentData): boolean {
    return classIntersection(a.classes, b.enemies);
}

// Classmates share at least one class number.
export function govtsAreClassmates(a: GovernmentData, b: GovernmentData): boolean {
    return classIntersection(a.classes, b.classes);
}


// --- record changes ---

export interface GovtGraph {
    government(id: string | null): GovernmentData | null;
    allGovernments(): GovernmentData[];
}

// The govt lookups plus the optional rank data and warning sink the
// interplay uses. MissionEnv satisfies this structurally.
export interface LegalEnv extends GovtGraph {
    rank?(id: string): RankData | null;
    warn?(message: string): void;
}

export interface RecordChange {
    govt: string;
    delta: number;
    // True when the govt only heard about an act against someone else.
    propagated: boolean;
}

/**
 * Applies one act for (+) or against (-) `govtId` to the pilot's legal
 * record, with propagation: the govt's allies hear the same delta and its
 * enemies hear the opposite. Enemies take precedence over allies when a
 * govt is both. Returns every change applied, primary first; a zero delta
 * or an unknown government (warned, fail-closed) applies nothing. A
 * negative delta is a crime, so affiliated 0x0040 ranks are stripped.
 */
export function changeRecord(state: PlayerState, govtId: string, delta: number,
    env: LegalEnv): RecordChange[] {
    if (delta === 0) {
        return [];
    }
    const target = env.government(govtId);
    if (!target) {
        env.warn?.(`changeRecord: unknown government ${govtId}; record unchanged`);
        return [];
    }

    const changes: RecordChange[] = [{ govt: target.id, delta, propagated: false }];
    for (const govt of env.allGovernments()) {
        if (govt.id === target.id) {
            continue;
        }
        if (govtsAreEnemies(govt, target) || govtsAreEnemies(target, govt)) {
            changes.push({ govt: govt.id, delta: -delta, propagated: true });
        }
        else if (govtsAreAllies(govt, target) || govtsAreAllies(target, govt)) {
            changes.push({ govt: govt.id, delta, propagated: true });
        }
    }
    for (const change of changes) {
        state.legalRecord[change.govt] = (state.legalRecord[change.govt] ?? 0) + change.delta;
    }

    if (delta < 0) {
        deactivateRanksOnCrime(state, target.id, env);
    }
    return changes;
}

// PayVal's record-cleaning bands (-1/-2/-3xxxx): a clean slate is not an
// act anyone hears about, so no propagation — the records just reset.
export function cleanRecord(state: PlayerState, govtId: string): void {
    state.legalRecord[govtId] = 0;
}


// --- rank interplay ---

// ränk flag 0x0040: any crime against G strips the active ranks of G that
// carry the flag. Returns the deactivated rank ids.
export function deactivateRanksOnCrime(state: PlayerState, govtId: string,
    env: LegalEnv): string[] {
    return deactivateMatchingRanks(state, rank => rank.govt === govtId, env, 0x0040);
}

// ränk flag 0x0004: the player destroyed/disabled a ship of `shipGovtId` —
// ranks affiliated with that govt (or with one of its allies) go away.
// NOTE: only the DESTROY half is wired today (combat_rating_plugin's
// DeathEvent listener); the DISABLE half awaits a general disable event
// outside the mission-ship worlds — wire it there when one lands.
export function deactivateRanksOnShipLoss(state: PlayerState, shipGovtId: string,
    env: LegalEnv): string[] {
    const shipGovt = env.government(shipGovtId);
    if (!shipGovt) {
        return [];
    }
    return deactivateMatchingRanks(state, rank => {
        if (rank.govt === null) {
            return false;
        }
        if (rank.govt === shipGovt.id) {
            return true;
        }
        const affiliated = env.government(rank.govt);
        return affiliated !== null
            && (govtsAreAllies(affiliated, shipGovt) || govtsAreAllies(shipGovt, affiliated));
    }, env, 0x0004);
}

// Removes every active rank matching `predicate` (which has already been
// narrowed by `flag`). Permanent ranks are immune, and the removals are
// flat: a cascade flag on a removed rank does not re-trigger here.
function deactivateMatchingRanks(state: PlayerState,
    predicate: (rank: RankData) => boolean, env: LegalEnv, flag: number): string[] {
    const rankOf = env.rank;
    if (!rankOf) {
        return [];
    }
    const deactivated: string[] = [];
    for (const id of [...state.activeRanks]) {
        const rank = rankOf(id);
        if (!rank || (rank.flags & flag) === 0 || (rank.flags & 0x0008) !== 0) {
            continue;
        }
        if (predicate(rank)) {
            deactivated.push(id);
            deactivateRank(state, id, { rank: rankOf });
        }
    }
    return deactivated;
}
