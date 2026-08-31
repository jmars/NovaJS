// The player-targeting gates, as a leaf module: it imports only nova_ecs
// plus the mission/player resources, so both npc_plugin and the npc AI
// systems can use it without an import cycle.
//
// The player carries no GovernmentComponent. Whether an NPC may target
// them is decided (FUN_0040e020 pass 2) by the PER-SYSTEM legal record —
// the record of the current system's government, not of the NPC's own —
// through the five-case table in playerIsLegalTarget, plus the rank-derived
// refuse-to-attack bytes (FUN_0046e860) and the stellar no-attack byte
// (+0x83) in refusesToAttackPlayer. playerIsHostile (record < -crimeTol of
// one government) survives only in the port-only layers: the legacy
// ChooseRandomTarget roll and the retaliation clean-player amnesty's
// system-govt record read.

import { Component } from "nova_ecs/component";
import { World } from "nova_ecs/world";
import { GovernmentData } from "novadatainterface/GovernmentData";
import { MissionEnvResource } from "../missions/mission_plugin";
import { govtsAreAllies, govtsAreEnemies,
    systemLegalRecord } from "../player/legal_status";
import { PlayerStateResource } from "../player/player_state_component";
import { SystemIdResource } from "./system_id_resource";

// Which government a dude/fleet ship belongs to (P7 builds record
// propagation on top; today it only tags the ship). Moved here from
// npc_plugin so the dude/mission systems can read it without an
// import cycle through that module; npc_plugin re-exports it (dude.ts
// re-exports it from there).
export const GovernmentComponent = new Component<{ id: string | null }>('Government');

// FUN_0046bc90: same government counts as allied, otherwise either side
// must list one of the other's classes as an ally.
export function govtsAllied(mine: GovernmentData | null,
    theirs: GovernmentData | null, mineId: string | null | undefined,
    theirsId: string | null | undefined): boolean {
    if (mineId != null && mineId === theirsId) {
        return true;
    }
    if (!mine || !theirs) {
        return false;
    }
    return govtsAreAllies(mine, theirs) || govtsAreAllies(theirs, mine);
}

// FUN_0046bdf0: mutual enemies (either direction), skipped when either
// government is derelict (flag 0x800), or xenophobia (flag 0x1) from
// either side against a non-allied government. Both governments must be
// resolved — independent ships are nobody's enemy.
export function govtsHostile(mine: GovernmentData | null,
    theirs: GovernmentData | null, mineId: string | null | undefined,
    theirsId: string | null | undefined): boolean {
    if (!mine || !theirs) {
        return false;
    }
    if (((mine.flags & 0x800) | (theirs.flags & 0x800)) !== 0) {
        return false;
    }
    if (govtsAreEnemies(mine, theirs) || govtsAreEnemies(theirs, mine)) {
        return true;
    }
    const xenophobic = ((mine.flags & 0x1) | (theirs.flags & 0x1)) !== 0;
    return xenophobic && !govtsAllied(mine, theirs, mineId, theirsId);
}

// True when the government `govtId` considers the player a criminal:
// the player's legal record with it is below -crimeTol (the same
// hostility test the smuggling scan gate uses). False when the government
// is unknown, the MissionEnv or player state is missing, or the record is
// neutral — an NPC that cannot know the player is its enemy never
// auto-targets them (ChooseRandomTarget gates on this; the binary
// acquisition path uses playerIsLegalTarget below).
export function playerIsHostile(govtId: string | null | undefined,
    world: World): boolean {
    if (!govtId) {
        return false;
    }
    const govt = world.resources.get(MissionEnvResource)?.government(govtId);
    const playerState = world.resources.get(PlayerStateResource);
    if (!govt || !playerState) {
        return false;
    }
    return (playerState.legalRecord[govt.id] ?? 0) < -govt.crimeTol;
}

// FUN_0046e860(g, idx) = govt-table byte +0x84+idx (FUN_0046d4b0's rank
// pass): set for every government allied (FUN_0046bc90) with a rank the
// player holds that carries ränk flag 0x0100 (idx 0) / 0x0200 (idx 1) —
// governments allied with the granter of such a rank refuse to attack the
// player. Stock data uses both bits (e.g. the Federation's rank nova:128,
// flags 0xb08). True (= refuse) when any active rank matches.
export function refusesToAttackPlayer(govtId: string | null | undefined,
    world: World, idx: 0 | 1 = 0): boolean {
    const env = world.resources.get(MissionEnvResource);
    const state = world.resources.get(PlayerStateResource);
    if (!env?.rank || !state || !govtId) {
        return false;
    }
    const flag = idx === 0 ? 0x0100 : 0x0200;
    for (const rankId of state.activeRanks) {
        const rank = env.rank(rankId);
        if (!rank || rank.govt === null || (rank.flags & flag) === 0) {
            continue;
        }
        const rankGovt = env.government(rank.govt);
        const mine = env.government(govtId);
        if (rankGovt && mine
            && govtsAllied(mine, rankGovt, mine.id, rankGovt.id)) {
            return true;
        }
    }
    return false;
}

// FUN_0040e020 pass 2's legal gate (the case table), evaluated after the
// aggress-square test the caller performs. Compares the PER-SYSTEM record
// — the record of the current system's government — against MY
// government's crimeTol:
//   my govt is the system's:     rec < -crimeTol
//   the system has no govt:      (flags & 0x2) && rec < crimeTol × -2
//   my govt is at war with it:   crimeTol < rec   (positive records target)
//   my govt is allied with it:   rec < -(crimeTol × 1.5)
//   neither:                     (flags & 0x2) && rec < crimeTol × -2
export function playerIsLegalTarget(govtId: string | null | undefined,
    world: World): boolean {
    const env = world.resources.get(MissionEnvResource);
    const state = world.resources.get(PlayerStateResource);
    const mine = env?.government(govtId ?? null) ?? null;
    if (!env || !state || !mine) {
        return false;
    }
    const systemId = world.resources.get(SystemIdResource) ?? "";
    const sysGovtId = env.system(systemId)?.government ?? null;
    const rec = systemLegalRecord(state, sysGovtId);
    const tol = mine.crimeTol;
    const strikesIndependents = (mine.flags & 0x2) !== 0;

    if (sysGovtId === null) {
        return strikesIndependents && rec < tol * -2;
    }
    if (sysGovtId === mine.id) {
        return rec < -tol;
    }
    const sysGovt = env.government(sysGovtId);
    if (!sysGovt) {
        return strikesIndependents && rec < tol * -2;
    }
    if (govtsHostile(mine, sysGovt, mine.id, sysGovt.id)) {
        return tol < rec;
    }
    if (govtsAllied(mine, sysGovt, mine.id, sysGovt.id)) {
        return rec < -(tol * 1.5);
    }
    return strikesIndependents && rec < tol * -2;
}

// The shared-tail veto (FUN_0040e020 clears the player candidate after the
// branch selection): government-table byte +0x83, or the rank-derived
// FUN_0046e860 byte. Byte +0x83 is set by FUN_0046d4b0 from stellar/spöb
// action fields (0x2c/0x30) the port does not parse, so it rides on
// GovernmentData.noAttackPlayer (0 for every stock-parsed government).
export function playerTargetVetoed(govtId: string | null | undefined,
    world: World): boolean {
    if (!govtId) {
        return false;
    }
    const mine = world.resources.get(MissionEnvResource)?.government(govtId);
    if (mine && mine.noAttackPlayer !== 0) {
        return true;
    }
    return refusesToAttackPlayer(govtId, world, 0);
}
