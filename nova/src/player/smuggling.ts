// In-flight customs scan rules (binary FUN_00401800): an AI 3/4 police
// ship completing its hail approach (state 7, the 100px square) scans the
// player's hold. Pure TypeScript — no PIXI/ECS — so the scan rules stay
// headless testable; the caller (nova_plugin/scan_plugin.ts's
// smugglingScan, wired into npc_ai_plugin.ts's InterceptorScanSystem hail)
// resolves the scanning ship's government, applies the outcome and logs.
//
// Gates are the caller's business (FUN_00401800's own): AI 3/4, assigned
// government != -1, that government's SmugPenalty != 0 (a gate only — the
// scan never applies it to the record), the 100px square, visibility,
// rand(100) ≤ 75 and FUN_00408150's movement grace.
//
// Fine semantics (gövt ScanFine, runtime +0x54 / file +0x06): >= 1 is a
// flat fine, 0 is a warning-only scan (stock data: all 68 govts carry 0),
// and < 0 is a percentage of the pilot's cash, rounded to whole hundreds
// with a 1-credit floor. There is NO record gate: the binary's scan never
// reads CrimeTol.
//
// Illegal cargo (FUN_00401800's detection loop): the first active, loaded
// mission whose mïsn ScanMask overlaps the govt's ScanMask decides the
// branch — flag 0x0020 quick-fails that mission (no fine), anything else
// is fined. Jünk whose ScanMask overlaps is also caught. Neither catch
// changes the legal record (the binary records only jünk/wëap catches,
// which the port does not model).

import { GovernmentData } from "novadatainterface/GovernmentData";
import { JunkData } from "novadatainterface/JunkData";
import { MissionData } from "novadatainterface/MissionData";
import { rawIdOf } from "../missions/stellar_filter";
import { cargoIllegalMask, CargoEntry, isStandardCommodity } from "./cargo";
import { ActiveMission } from "./player_state";


// The lookups the scan rules need. MissionEnv satisfies this structurally
// (see legal_status.LegalEnv for the same pattern); tests build one from
// synthetic fixtures.
export interface SmugglingEnv {
    government(govtId: string | null): GovernmentData | null;
    missionByRawId(rawId: number): MissionData | null;
    // Jünk data (cargo.ts hold identities, scan masks). Optional so test
    // envs without jünk data still work; unknown raw ids yield undefined.
    junk?(rawId: number): JunkData | undefined;
}

// One scan outcome. `fine` is never negative; 0 with `illegal: true` is a
// warning-only scan (gövt ScanFine 0). `reason` says what was caught:
// a mission-cargo catch outranks a jünk-only one (it alone can carry the
// 0x0020 quick-fail branch).
export interface ScanResult {
    illegal: boolean;
    fine: number;
    reason: "none" | "junk" | "mission";
}

const NO_SCAN: ScanResult = { illegal: false, fine: 0, reason: "none" };

// Active missions currently carrying cargo whose mïsn ScanMask overlaps the
// govt's — the binary's detection loop (DAT_005914b4 +0x1a masks, cargo
// loaded +0x33, cargo type +0x12). Cargo not yet loaded (pickup pending) is
// not in the hold, so it never scans.
export function smuggledMissions(env: SmugglingEnv, govt: GovernmentData,
    activeMissions: readonly ActiveMission[]):
    Array<{ mission: MissionData, active: ActiveMission }> {
    const violations: Array<{ mission: MissionData, active: ActiveMission }> = [];
    for (const active of activeMissions) {
        if (!active.cargoLoaded || active.cargo === null) {
            continue;
        }
        const mission = env.missionByRawId(rawIdOf(active.missionId));
        if (!mission) {
            continue;
        }
        if ((mission.scanMask & govt.scanMask) !== 0) {
            violations.push({ mission, active });
        }
    }
    return violations;
}

// The fine for a caught smuggler, from the govt's ScanFine (see header).
// Never negative; the FUN_00401800 percentage band rounds half-away to
// whole hundreds with a 1-credit floor.
export function scanFine(govt: GovernmentData, credits: number): number {
    if (govt.scanFine > 0) {
        return govt.scanFine;
    }
    if (govt.scanFine < 0) {
        return Math.max(1, Math.round(credits * (-govt.scanFine) * 0.0001)
            * 100);
    }
    return 0;
}

// Runs one FUN_00401800 hold scan against `govt` (the scanning ship's
// assigned government). Returns NO_SCAN when the hold is clean. The
// quick-fail vs fine branch is the caller's (it needs the caught mission
// itself); `reason` reports which catch fired.
export function scanCheck(env: SmugglingEnv, govt: GovernmentData,
    cargo: readonly CargoEntry[], activeMissions: readonly ActiveMission[],
    credits: number): ScanResult {
    const junkMask = cargoIllegalMask(cargo, junkScanMasks(env, cargo));
    const junkIllegal = (junkMask & govt.scanMask) !== 0;
    const missions = smuggledMissions(env, govt, activeMissions);
    if (!junkIllegal && missions.length === 0) {
        return NO_SCAN;
    }
    return {
        illegal: true,
        fine: scanFine(govt, credits),
        reason: missions.length > 0 ? "mission" : "junk",
    };
}

// The jünk scan masks (JunkData.scanMask) of everything in the hold, keyed
// by raw id — the shape cargoIllegalMask consumes. Unknown jünk scans as
// legal (mask 0), matching cargoIllegalMask's `?? 0` convention.
function junkScanMasks(env: SmugglingEnv, cargo: readonly CargoEntry[]):
    Map<number, number> {
    const masks = new Map<number, number>();
    for (const entry of cargo) {
        if (!isStandardCommodity(entry.type) && !masks.has(entry.type)) {
            masks.set(entry.type, env.junk?.(entry.type)?.scanMask ?? 0);
        }
    }
    return masks;
}
