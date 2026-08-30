// Përs hail quotes and "offered from ship" missions (P4 of the
// ship-interaction layer): the pure rules that decide whether hailing a
// përs shows its radio quote (HailQuote, STR# 7101) and whether its
// LinkMission (mïsn AvailLoc 2) may be offered to the player's ship, plus
// the PlayerState effects of accepting such an offer.
//
// Pure TypeScript — no PIXI/ECS — so the flag matrix stays headless
// testable; nova_plugin/interaction_plugin.ts is the ECS wiring (hail/board
// keys), display/message_log.ts surfaces the quote, spaceport/comm_dialog.ts
// runs the offer briefing through the shared accept/refuse machinery, and
// availability.ts evaluates the mïsn itself.
//
// Përs flag semantics (EV Nova Bible përs Flags; the grudge bit is already
// wired in nova_plugin/pers_plugin.ts):
//   0x0001 grudge — hunts the player after being damaged (pers_plugin)
//   0x0004 hail only while the përs holds that grudge
//   0x0008 hail only while the player's legal record with the përs
//          government is positive (they like you)
//   0x0010 hail only while the përs is attacking the player
//   0x0020 hail only while the përs is disabled
//   0x0040 on accept: the mission's special ship replaces this përs (the
//          spawn type is pinned to the përs's own shïp)
//   0x0080 the hail quote shows only once (persisted per pilot)
//   0x0100 on accept: the përs is deactivated (never spawns again)
//   0x0200 the offer is made on boarding, not on hail (P5)
//   0x0800 on accept: the përs's ship departs the system
//   0x1000 not offered to a player flying an inherent-AI-1 (wimpy trader)
//          ship — 0x2000 AI 2, 0x4000 AI 3-4 (warship band, mirroring the
//          mïsn-flag rule 9 in availability.ts)

import { PersData } from "novadatainterface/PersData";
import { PersProgress, PlayerState } from "../player/player_state";


// --- hail quotes ---

export const PERS_FLAG_GRUDGE = 0x0001;
export const PERS_FLAG_HAIL_GRUDGE_ONLY = 0x0004;
export const PERS_FLAG_HAIL_LIKES_PLAYER = 0x0008;
export const PERS_FLAG_HAIL_ATTACKING = 0x0010;
export const PERS_FLAG_HAIL_DISABLED = 0x0020;
export const PERS_FLAG_REPLACE_SHIP = 0x0040;
export const PERS_FLAG_QUOTE_ONCE = 0x0080;
export const PERS_FLAG_DEACTIVATE = 0x0100;
export const PERS_FLAG_BOARD_OFFER = 0x0200;
export const PERS_FLAG_LEAVES = 0x0800;
export const PERS_FLAG_NO_AI_1 = 0x1000;
export const PERS_FLAG_NO_AI_2 = 0x2000;
export const PERS_FLAG_NO_WARSHIP = 0x4000;

// The live facts the hail gate needs, gathered by the caller from the
// përs's ship entity and the pilot state (all optional facts default to
// their "no" value).
export interface HailQuoteFacts {
    grudge: boolean;      // 0x0004: the përs was damaged by the player
    disabled: boolean;    // 0x0020: the përs's ship is disabled
    attacking: boolean;   // 0x0010: the përs's ship is targeting the player
    likesPlayer: boolean; // 0x0008: legalRecord[përs govt] > 0
    quoteShown: boolean;  // 0x0080: already shown for this pilot
}

// Assembles the facts from the pieces the ECS has at hail time: the
// grudge/disabled/attacking bits come from the ship entity, while
// likes-player (legal record with the përs's government) and quote-once
// (pilot persistence) read the PlayerState here, where the rule lives.
export function hailQuoteFacts(pers: PersData, state: PlayerState,
    live: { grudge?: boolean, disabled?: boolean, attacking?: boolean }):
    HailQuoteFacts {
    const progress = state.pers[pers.id];
    return {
        grudge: live.grudge ?? progress?.grudge ?? false,
        disabled: live.disabled ?? false,
        attacking: live.attacking ?? false,
        // "Likes the player" is a positive legal record with the përs's
        // own government; a government-less përs cannot like anyone.
        likesPlayer: pers.govt !== null
            && (state.legalRecord[pers.govt] ?? 0) > 0,
        quoteShown: progress?.quoteShown ?? false,
    };
}

// Whether hailing this përs shows its radio quote (HailQuote, STR# 7101).
// Every set gating flag must hold; a përs without a quote has nothing to
// show regardless of flags.
export function shouldShowHailQuote(pers: PersData, facts: HailQuoteFacts):
    boolean {
    if (pers.hailQuote <= 0) {
        return false;
    }
    const flags = pers.flags;
    if ((flags & PERS_FLAG_HAIL_GRUDGE_ONLY) !== 0 && !facts.grudge) {
        return false;
    }
    if ((flags & PERS_FLAG_HAIL_LIKES_PLAYER) !== 0 && !facts.likesPlayer) {
        return false;
    }
    if ((flags & PERS_FLAG_HAIL_ATTACKING) !== 0 && !facts.attacking) {
        return false;
    }
    if ((flags & PERS_FLAG_HAIL_DISABLED) !== 0 && !facts.disabled) {
        return false;
    }
    if ((flags & PERS_FLAG_QUOTE_ONCE) !== 0 && facts.quoteShown) {
        return false;
    }
    return true;
}

// Quotes showing once stick per pilot: marks the quote shown (and returns
// whether anything changed) so a later hail is silent.
export function recordQuoteShown(state: PlayerState, persId: string): boolean {
    const progress: PersProgress = state.pers[persId] ?? {
        status: "alive",
        grudge: false,
        quoteShown: false,
    };
    if (progress.quoteShown) {
        return false;
    }
    progress.quoteShown = true;
    state.pers[persId] = progress;
    return true;
}


// --- mission offers from a ship ---

// Whether the përs's LinkMission may be offered to a player flying a ship
// of this inherent AI (the shïp AI field). Unknown AI (null — the player's
// ship type is unreadable) passes, like availability rule 9.
export function shipOfferEligible(pers: PersData,
    playerShipInherentAI: number | null): boolean {
    if (playerShipInherentAI === null) {
        return true;
    }
    const flags = pers.flags;
    if ((flags & PERS_FLAG_NO_AI_1) !== 0 && playerShipInherentAI === 1) {
        return false;
    }
    if ((flags & PERS_FLAG_NO_AI_2) !== 0 && playerShipInherentAI === 2) {
        return false;
    }
    if ((flags & PERS_FLAG_NO_WARSHIP) !== 0
        && (playerShipInherentAI === 3 || playerShipInherentAI === 4)) {
        return false;
    }
    return true;
}

// The mïsn a përs offers on hail, if any: flag 0x0200 offers are made on
// boarding instead (see persBoardOfferMissionId), and the mission itself
// must be an AvailLoc-2 one.
export function persOfferMissionId(pers: PersData): string | null {
    if (pers.linkMission === null || (pers.flags & PERS_FLAG_BOARD_OFFER) !== 0) {
        return null;
    }
    return pers.linkMission;
}

// The board-route twin: a 0x0200 përs makes its offer when boarded, not
// when hailed (P5 — the board key emits BoardedEvent, and the comm bridge
// routes that here instead of the hail quote).
export function persBoardOfferMissionId(pers: PersData): string | null {
    if (pers.linkMission === null || (pers.flags & PERS_FLAG_BOARD_OFFER) === 0) {
        return null;
    }
    return pers.linkMission;
}

// What accepting a përs's mission does to the përs (stock applies these
// flags at accept time). Returns which effects fired so the caller can
// despawn the ship etc.; the PlayerState changes (deactivation, spawn-type
// pinning) are applied here because they are persistence, not UI.
export interface PersOfferAcceptEffects {
    // 0x0100: the përs never spawns again.
    deactivated: boolean;
    // 0x0800: the përs's ship departs the system (caller deletes it).
    leaves: boolean;
    // 0x0040: the mission's special ship replaces this përs — its spawn
    // type is pinned to the përs's own shïp in the accepted mission's
    // SpecialShipProgress.pinnedTypes (persisted with the pilot, and
    // replayed by nextSpecialShipType on every later spawn entry).
    replacedByMission: boolean;
}

export function applyPersOfferAccept(state: PlayerState,
    pers: PersData): PersOfferAcceptEffects {
    const flags = pers.flags;
    const effects: PersOfferAcceptEffects = {
        deactivated: false,
        leaves: (flags & PERS_FLAG_LEAVES) !== 0,
        replacedByMission: false,
    };

    if ((flags & PERS_FLAG_REPLACE_SHIP) !== 0 && pers.shipType !== null) {
        const active = state.activeMissions.find(
            m => m.missionId === pers.linkMission);
        if (active?.specialShips) {
            active.specialShips.pinnedTypes = [pers.shipType];
            effects.replacedByMission = true;
        }
    }

    if ((flags & PERS_FLAG_DEACTIVATE) !== 0) {
        const progress: PersProgress = state.pers[pers.id] ?? {
            status: "alive",
            grudge: false,
            quoteShown: false,
        };
        progress.status = "deactivated";
        state.pers[pers.id] = progress;
        effects.deactivated = true;
    }

    return effects;
}
