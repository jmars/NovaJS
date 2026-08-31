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

// Classmates are POSITIONAL (FUN_0046bff0): some class slot i < 4 holds the
// same number on both sides, or the governments are one and the same. NOT
// an any-vs-any set intersection — [1,2] and [2,1] share no slot.
export function govtsAreClassmates(a: GovernmentData, b: GovernmentData): boolean {
    if (a.id === b.id) {
        return true;
    }
    const slots = Math.min(4, a.classes.length, b.classes.length);
    for (let i = 0; i < slots; i++) {
        const c = a.classes[i];
        if (c >= 0 && b.classes[i] === c) {
            return true;
        }
    }
    return false;
}


// --- reading the record ---

/**
 * The record the acquisition/scan gates compare: the binary stores the
 * legal record PER SYSTEM (DAT_00733bc8[sysIdx], indexed by the current
 * system, FUN_0040e020 pass 2) and the mission appliers update every
 * system by its government, so the port's per-government record IS the
 * record of a system: DAT_00733bc8[sys] ≡ legalRecord[govt of sys].
 * Reads must therefore key on the system's government (never the reader's
 * own government). Systems without a government have no record (0).
 */
export function systemLegalRecord(state: PlayerState,
    systemGovtId: string | null | undefined): number {
    return systemGovtId ? state.legalRecord[systemGovtId] ?? 0 : 0;
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

// FUN_0046bc90: the ALLIED test the record applier uses. The same
// government counts as allied; either side carrying the derelict bit
// (0x800) breaks the alliance; otherwise either side must list one of the
// other's classes as an ally.
export function govtsAlliedPerBinary(a: GovernmentData,
    b: GovernmentData): boolean {
    if ((a.flags & 0x800) !== 0 || (b.flags & 0x800) !== 0) {
        return false;
    }
    return govtsAreAllies(a, b) || govtsAreAllies(b, a);
}

// FUN_0046bdf0: the AT-WAR test the record applier uses. Derelict
// governments (0x800) are at war with nobody; declared enemies either
// direction are at war; so are xenophobic governments (flag 0x1 on either
// side) with everyone they are not allied with.
export function govtsAtWarPerBinary(a: GovernmentData,
    b: GovernmentData): boolean {
    if ((a.flags & 0x800) !== 0 || (b.flags & 0x800) !== 0) {
        return false;
    }
    if (govtsAreEnemies(a, b) || govtsAreEnemies(b, a)) {
        return true;
    }
    const xenophobic = ((a.flags & 0x1) | (b.flags & 0x1)) !== 0;
    return xenophobic && !govtsAlliedPerBinary(a, b);
}

// The mission applier (FUN_00440410) moves allied and at-war records by
// half the delta, rounded half away from zero (the 0.5 constant at
// DAT_00575500; ROUND(x)+carry for the .5 fraction).
function halfDelta(delta: number): number {
    return delta < 0 ? -Math.round(-delta / 2) : Math.round(delta / 2);
}

/**
 * Applies one act for (+) or against (-) `govtId` to the pilot's legal
 * record, with propagation (FUN_00440410 semantics, per-govt): govts at
 * war with the target hear the opposite half-delta, allied govts the same
 * half-delta; derelict govts (0x800) hear nothing, and xenophobia (0x1)
 * counts as war against non-allies. War takes precedence over alliance.
 * Returns every change applied, primary first; a zero delta or an unknown
 * government (warned, fail-closed) applies nothing. A negative delta is a
 * crime, so affiliated 0x0040 ranks are stripped.
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
        if (((govt.flags & 0x800) | (target.flags & 0x800)) !== 0) {
            continue;
        }
        if (govtsAtWarPerBinary(govt, target)) {
            changes.push({ govt: govt.id, delta: -halfDelta(delta), propagated: true });
        }
        else if (govtsAlliedPerBinary(govt, target)) {
            changes.push({ govt: govt.id, delta: halfDelta(delta), propagated: true });
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
