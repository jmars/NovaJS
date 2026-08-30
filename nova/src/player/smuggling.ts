// Planetary scan / smuggling enforcement (EV Nova Bible 986-995, 1387-90,
// 1577): on entering a system, its government may scan the hold. Pure
// TypeScript — no PIXI/ECS — so the scan rules stay headless testable; the
// caller (nova_plugin/scan_plugin.ts, on FinishJumpEvent) resolves the
// system's government, applies the fine/record/mission failures and logs.
//
// Fine semantics (gövt ScanFine): >= 1 is a flat fine, 0 is a warning-only
// scan (stock data: all 68 govts carry 0, so enforcement is visible through
// the SmugPenalty record hit and 0x0020 mission failures), and < 0 is a
// percentage of the pilot's cash. The scan itself only happens when the
// pilot's record with the scanning govt is not already below -CrimeTol.
//
// Illegal cargo (Bible 1387): jünk whose ScanMask overlaps the govt's
// ScanMask, and mïsn cargo whose ScanMask overlaps it. Being caught with
// mission cargo applies the govt's SmugPenalty to the record (the Bible ties
// the penalty to mission-defined cargo); jünk-only catches are fined but not
// recorded. Missions with flag 0x0020 ("mission fails if scanned with
// illegal cargo") fail via the FSM's reportFailureEvent.

import { GovernmentData } from "novadatainterface/GovernmentData";
import { JunkData } from "novadatainterface/JunkData";
import { MissionData } from "novadatainterface/MissionData";
import { PlanetData } from "novadatainterface/PlanetData";
import { SystemData } from "novadatainterface/SystemData";
import { rawIdOf } from "../missions/stellar_filter";
import { cargoIllegalMask, CargoEntry, isStandardCommodity } from "./cargo";
import { ActiveMission, PlayerState } from "./player_state";


// The lookups the scan rules need. MissionEnv satisfies this structurally
// (see legal_status.LegalEnv for the same pattern); tests build one from
// synthetic fixtures.
export interface SmugglingEnv {
    system(systemId: string): SystemData | null;
    planet(planetId: string): PlanetData | null;
    government(govtId: string | null): GovernmentData | null;
    missionByRawId(rawId: number): MissionData | null;
    // Jünk data (cargo.ts hold identities, scan masks). Optional so test
    // envs without jünk data still work; unknown raw ids yield undefined.
    junk?(rawId: number): JunkData | undefined;
}

// One planetary scan outcome. `fine` is never negative; 0 with
// `illegal: true` is a warning-only scan (gövt ScanFine 0). `reason` says
// what was caught: mission-cargo smuggling outranks a jünk-only catch
// (it alone triggers the record hit).
export interface ScanResult {
    illegal: boolean;
    fine: number;
    reason: "none" | "junk" | "mission";
}

const NO_SCAN: ScanResult = { illegal: false, fine: 0, reason: "none" };

// The government that would scan in `systemId`. SystemData carries no govt
// field, so this is the first inhabited planet's govt; null (no system, no
// inhabited planet, or an independent planet) means nobody scans here —
// fail-open, the safe reading of the Bible's "independent = gövt 128" hint.
export function systemGovernment(env: SmugglingEnv, systemId: string): string | null {
    const system = env.system(systemId);
    if (!system) {
        return null;
    }
    for (const planetId of system.planets) {
        const planet = env.planet(planetId);
        if (planet?.inhabited) {
            return planet.govt;
        }
    }
    return null;
}

// Active missions currently carrying cargo whose mïsn ScanMask overlaps the
// govt's — the Bible's definition of smuggled mission cargo (1387). Cargo
// not yet loaded (pickup pending) is not in the hold, so it never scans.
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
// Never negative: a percentage fine over a negative balance floors to 0.
export function scanFine(govt: GovernmentData, credits: number): number {
    if (govt.scanFine > 0) {
        return govt.scanFine;
    }
    if (govt.scanFine < 0) {
        return Math.max(0, Math.floor(credits * (-govt.scanFine) / 100));
    }
    return 0;
}

/**
 * Runs one planetary scan over the pilot's hold and active missions in
 * `systemId`. Returns NO_SCAN when nobody scans here (no resolvable
 * government) or when the record gate exempts the pilot
 * (legalRecord < -CrimeTol — govts do not bother scanning pilots they
 * already consider criminals, Bible 986-995).
 */
export function scanCheck(state: PlayerState, env: SmugglingEnv, systemId: string,
    cargo: readonly CargoEntry[], activeMissions: readonly ActiveMission[]):
    ScanResult {
    const govtId = systemGovernment(env, systemId);
    const govt = govtId === null ? null : env.government(govtId);
    if (!govt) {
        return NO_SCAN;
    }
    if ((state.legalRecord[govt.id] ?? 0) < -govt.crimeTol) {
        return NO_SCAN;
    }

    const junkMask = cargoIllegalMask(cargo, junkScanMasks(env, cargo));
    const junkIllegal = (junkMask & govt.scanMask) !== 0;
    const missions = smuggledMissions(env, govt, activeMissions);
    if (!junkIllegal && missions.length === 0) {
        return NO_SCAN;
    }
    return {
        illegal: true,
        fine: scanFine(govt, state.credits),
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
