// Special-ship (goal) and auxiliary-ship tracking for active missions (P6).
//
// Pure TypeScript — no PIXI/ECS imports — so the goal rules stay headless
// testable; mission_ship_plugin.ts is the ECS glue (DeathEvent wiring,
// disable latches, proximity checks, spawning).
//
// Goal semantics (mïsn ShïpGoal), and how far this engine gets today:
//   0 destroy   — a goal ship died (DeathEvent)                   [exact]
//   1 disable   — armor + shield/2 fell under 25% of the total    [exact]
//   2 board     — the player boards the disabled ship (the board key
//                 emits BoardedEvent; missions/boarding.ts resolves the
//                 plunder) and the ship is taken                    [exact,
//                 capture semantics deferred — see boarding.ts]
//   3 escort    — at least one ship alive while the travel leg is
//                 complete; if the last escort dies first, the
//                 mission fails (stock behavior)                   [exact]
//   4 observe   — the ships spawned while the player is in the
//                 system (ships only ever spawn in the player's
//                 system), so presence is immediate; a
//                 cloaking-aware/timed variant can refine this.
//   5 rescue    — ships spawn disabled; goal = board (BoardedEvent, see
//                 goal 2)                                          [exact,
//                 capture semantics deferred — see boarding.ts]
//   6 chase off — killed + jumpedOut >= initial. NPCs cannot jump
//                 out in this engine yet, so the jumpedOut counter
//                 never advances; chase-off effectively means
//                 destroy-all. Flagged approximation.
//
// Determinism: dude rolls and per-entry spawn draws come from a
// mulberry32 stream seeded by the pilot seed, the mission and the system
// (shipSpawnSeed) plus the game date, so every peer and reload computes
// the same spawns — the same rule the mission FSM uses for its draws.

import { MissionData } from "novadatainterface/MissionData";
import {
    ActiveMission,
    PlayerState,
    SpecialShipProgress,
} from "../player/player_state";
import {
    decodeSystemFilter,
    SystemMatchContext,
    systemMatchesSystemFilter,
} from "./stellar_filter";
import {
    failMission,
    markShipGoalComplete,
    MissionEffect,
    MissionEnv,
    reportFailureEvent,
} from "./mission_state_machine";


// A ship is disabled when armor + shield/2 has fallen to 25% of its total
// (HealthPlugin stats; EV Nova's "disable" threshold).
export const DISABLE_FRACTION = 0.25;

// How close the player must get to a disabled ship before the board key
// will fire (interaction_plugin.ts BoardControlSystem), in position units.
export const BOARD_PROXIMITY = 150;

export type StatLevel = { current: number; max: number };

export function isShipDisabled(armor: StatLevel | null,
    shield: StatLevel | null): boolean {
    if (!armor) {
        return false;
    }
    const halfShield = shield ? shield.max / 2 : 0;
    const totalMax = armor.max + halfShield;
    return armor.current + (shield ? shield.current / 2 : 0)
        <= DISABLE_FRACTION * totalMax;
}


// --- spawn planning ---

export interface MissionShipSpawnPlan {
    // Goal ships to spawn this entry (specialShips.remaining, capped by
    // nothing else — dead ships stay dead, survivors respawn per entry).
    specialCount: number;
    // Auxiliary ships to spawn this entry (flag 0x0010 respawns the full
    // AuxShipCount every entry; otherwise AuxShipProgress.remaining).
    auxCount: number;
}

export function systemMatchContext(state: PlayerState, active: ActiveMission,
    systemId: string, env: MissionEnv): SystemMatchContext {
    return {
        originSystemId: env.systemOfPlanet(active.originStellar)
            ?? state.currentSystem,
        // The player's system, not the system under test: they coincide in
        // every real call (ships spawn in the player's world), but keeping
        // them distinct keeps the filter honest for other callers.
        playerSystemId: state.currentSystem,
        travelStellarId: active.travelStellar,
        returnStellarId: active.returnStellar,
        systemOfPlanet: id => env.systemOfPlanet(id),
        system: id => env.system(id),
        planet: id => env.planet(id),
        government: id => env.government(id),
        govtByRawId: rawId => env.govtByRawId(rawId),
    };
}

// Whether the mission's ShipSyst/AuxShipSyst filter matches `systemId`.
export function missionShipsMatchSystem(state: PlayerState,
    mission: MissionData, active: ActiveMission, systemId: string,
    env: MissionEnv, which: "ship" | "aux"): boolean {
    const system = env.system(systemId);
    if (!system) {
        return false;
    }
    const code = which === "ship" ? mission.shipSyst : mission.auxShipSyst;
    return systemMatchesSystemFilter(system, decodeSystemFilter(code),
        systemMatchContext(state, active, systemId, env));
}

export function planMissionShipSpawn(state: PlayerState, mission: MissionData,
    active: ActiveMission, systemId: string, env: MissionEnv): MissionShipSpawnPlan {
    const plan: MissionShipSpawnPlan = { specialCount: 0, auxCount: 0 };
    const match = (which: "ship" | "aux") =>
        missionShipsMatchSystem(state, mission, active, systemId, env, which);

    // Goal ships stop respawning once the goal is met (or nothing is left
    // to resolve — dead ships stay dead).
    if (mission.shipCount >= 0 && active.specialShips !== null
        && !active.shipGoalComplete && active.specialShips.remaining > 0
        && match("ship")) {
        plan.specialCount = active.specialShips.remaining;
    }
    if (mission.auxShipCount >= 0 && active.auxShips !== null && match("aux")) {
        plan.auxCount = (mission.flags & 0x0010) !== 0
            ? mission.auxShipCount
            : active.auxShips.remaining;
    }
    return plan;
}


// --- spawn rolls ---

// Seed for one mission's spawn rolls in one system on one game date. The
// date changes per jump, so every warp-in re-rolls; peers and reloads
// compute the same stream.
export function shipSpawnSeed(state: PlayerState, missionRawId: number,
    systemRawId: number): number {
    const { day, month, year } = state.date;
    const dayCount = year * 365 + month * 40 + day;
    return (state.rngSeed + missionRawId * 0x9E37 + systemRawId * 0x85EB
        + dayCount * 0xC2B2AE35) >>> 0;
}

// The ship type for goal ship `index` of this entry. A pinned type replays
// no matter where the pin came from: flag 0x0800 rolls once and stores the
// results in SpecialShipProgress.pinnedTypes (later entries replay them),
// and a përs whose mission replaces it with its own ship pre-pins the type
// at accept time (pers_offers.ts).
//
// `rollDude` is the injected düde roll (rollDudeType from
// nova_plugin/dude.ts — this pure module cannot import nova_plugin).
export function nextSpecialShipType(mission: MissionData,
    progress: SpecialShipProgress, rollDude: (rng: () => number) => string | null,
    rng: () => number, index: number): string | null {
    const pinned = progress.pinnedTypes;
    if (pinned && index < pinned.length) {
        return pinned[index] ?? null;
    }
    if ((mission.flags & 0x0800) !== 0) {
        const type = rollDude(rng);
        if (progress.pinnedTypes === undefined) {
            progress.pinnedTypes = [];
        }
        progress.pinnedTypes[index] = type;
        return type;
    }
    return rollDude(rng);
}


// --- goal bookkeeping ---

// Whether the event-driven goals are met from the progress counters alone
// (escort/observe are checked elsewhere: checkEscortGoal at travel
// completion, reportSpecialShipsPresent at spawn).
export function shipGoalMet(goal: number, progress: SpecialShipProgress): boolean {
    switch (goal) {
        case 0: return progress.killed >= progress.initial;
        case 1: return progress.disabled >= progress.initial;
        // Board (2) and rescue (5) both complete on boarding: rescue ships
        // spawn disabled and are rescued by being boarded.
        case 2:
        case 5: return progress.boarded >= progress.initial;
        case 6: return progress.killed + progress.jumpedOut >= progress.initial;
        default: return false;
    }
}

export type SpecialShipLossKind = "killed" | "disabled" | "boarded";

// Records one goal ship resolving (destroyed / disabled / boarded) and
// completes (or fails) the mission when that was the last one:
//   - flags2 0x0004 (fail if a special ship is disabled/destroyed) fails
//     the mission instead — except for destroy/chase-off goals, where
//     destroying the ships IS the goal (no stock mission combines them).
//   - escort (goal 3) fails when the last escort resolves before the goal
//     was met (stock behavior; otherwise the mission would hang forever).
export function reportSpecialShipLoss(state: PlayerState, mission: MissionData,
    active: ActiveMission, env: MissionEnv, kind: SpecialShipLossKind):
    MissionEffect[] {
    const progress = active.specialShips;
    if (!progress || progress.remaining <= 0) {
        return [];
    }
    if (kind === "killed") {
        progress.killed++;
    }
    else if (kind === "disabled") {
        progress.disabled++;
    }
    else {
        progress.boarded++;
    }
    progress.remaining--;

    const goal = mission.shipGoal;
    if ((mission.flags2 & 0x0004) !== 0 && goal !== 0 && goal !== 6) {
        return reportFailureEvent(state, mission, active, env,
            "disabledOrDestroyed");
    }
    if (goal === 3 && progress.remaining === 0 && !active.shipGoalComplete) {
        const effects: MissionEffect[] = [];
        failMission(state, mission, active, env, effects);
        return effects;
    }
    if (shipGoalMet(goal, progress)) {
        return markShipGoalComplete(state, mission, active, env);
    }
    return [];
}

// An auxiliary ship was destroyed: non-infinite aux pools (no flag 0x0010)
// drain, so fewer spawn on later entries. Aux ships carry no goals.
export function reportAuxShipDestroyed(state: PlayerState, mission: MissionData,
    active: ActiveMission, env: MissionEnv): MissionEffect[] {
    const aux = active.auxShips;
    if (!aux || aux.remaining <= 0 || (mission.flags & 0x0010) !== 0) {
        return [];
    }
    aux.remaining--;
    return [];
}

// Goal 4 (observe): the goal ships are present in the player's system.
// Called by the spawn system right after the ships come in — they can only
// spawn where the player is, so presence is immediate.
export function reportSpecialShipsPresent(state: PlayerState,
    mission: MissionData, active: ActiveMission, env: MissionEnv):
    MissionEffect[] {
    if (mission.shipGoal !== 4 || active.shipGoalComplete) {
        return [];
    }
    return markShipGoalComplete(state, mission, active, env);
}

// Goal 3 (escort): met once the travel leg is complete and at least one
// escort is still alive. Polled by the goal systems (travelComplete flips
// on a landing, which the plugin does not otherwise observe).
export function checkEscortGoal(state: PlayerState, mission: MissionData,
    active: ActiveMission, env: MissionEnv): MissionEffect[] {
    if (mission.shipGoal !== 3 || active.shipGoalComplete) {
        return [];
    }
    const progress = active.specialShips;
    if (!progress || !active.travelComplete || progress.remaining <= 0) {
        return [];
    }
    return markShipGoalComplete(state, mission, active, env);
}
