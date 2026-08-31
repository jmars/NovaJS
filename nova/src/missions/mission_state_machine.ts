// The mission lifecycle state machine:
//
//   Available --offer passes isAvailable()--> Offered --accept--> Active
//      ^                                         |
//      +--- refuse (flag 0x0004 blocks) ---------+
//                                                |
//   Active --> travel leg: land on travelStel => travelComplete (+cargo)
//          --> special-ship goal met          => shipGoalComplete
//          --> Completed: land on returnStel with travelComplete (and
//              shipGoalComplete when the mission has a ship goal): pay,
//              CompGovt record += CompReward, onSuccess, datePostInc,
//              cargo dropoff (dropoffMode 1), remove
//          --> Failed: deadline expired on landing; flag 0x0020 scanned;
//              0x8000 boarded; flags2 0x0004 disabled/destroyed:
//              onFailure, CompGovt record -= CompReward/2, remove
//          --> Aborted: player abort (canAbort) or flag 0x0001 auto-abort:
//              onAbort; flag 0x0040 => -5x CompReward (any abort); flag
//              0x0008 consumes 100 fuel on auto-abort; flags2 0x0002
//              applies the pay on auto-abort
//
// Pure transition functions over (PlayerState, MissionData, world event) =>
// mutated PlayerState + an effects list. No PIXI/ECS imports: the module is
// unit-testable headless, and mission_plugin.ts is the ECS glue.
//
// Determinism: every random draw (destination picks, cargo rolls, R() in set
// expressions) comes from a mulberry32 stream seeded by the pilot's rngSeed
// and the mission's raw id, so accepting the same mission from the same
// state replays identically — including across reloads and multiplayer
// peers (mission state is client-authoritative). Draw order at accept:
// travel destination, return destination, onAccept expression, cargo roll.

import { GovernmentData } from "novadatainterface/GovernmentData";
import { CronData } from "novadatainterface/CronData";
import { JunkData } from "novadatainterface/JunkData";
import { MissionData } from "novadatainterface/MissionData";
import { PlanetData } from "novadatainterface/PlanetData";
import { RankData } from "novadatainterface/RankData";
import { SystemData } from "novadatainterface/SystemData";
import { SetContext, executeSet } from "novadatainterface/expressions";
import {
    ActiveMission,
    ActiveMissionCargo,
    MAX_ACTIVE_MISSIONS,
    PlayerState,
    SpecialShipProgress,
} from "../player/player_state";
import { cargoUsedTons } from "../player/cargo";
import { advanceDate, isDeadlinePassed } from "../player/date";
import { changeRecord, cleanRecord } from "../player/legal_status";
import { makeRng } from "../player/pilot_files";
import {
    decodeStellarFilter,
    globalId,
    govtsAreAllies,
    govtsAreClassmates,
    jumpDistances,
    planetMatchesStellarFilter,
    rawIdOf,
    StellarMatchContext,
} from "./stellar_filter";


// --- environment ---

// The world data the FSM needs, injected so the pure module never touches
// the engine. mission_plugin.ts builds one from GameDataInterface; tests
// build one from synthetic fixtures.
export interface MissionEnv {
    // Prefix for constructing global ids from raw ids (stock data: "nova").
    readonly prefix: string;
    missionByRawId(rawId: number): MissionData | null;
    planet(planetId: string): PlanetData | null;
    planetByRawId(rawId: number): PlanetData | null;
    system(systemId: string): SystemData | null;
    systemByRawId(rawId: number): SystemData | null;
    systemOfPlanet(planetId: string): string | null;
    government(govtId: string | null): GovernmentData | null;
    govtByRawId(rawId: number): GovernmentData | null;
    // Rank data (P7): powers the set-expression K/L ops and the rank
    // interplay in legal_status. Optional so synthetic test envs without
    // rank data still work (those paths then no-op).
    rank?(id: string): RankData | null;
    allPlanetIds(): string[];
    allMissionIds(): string[];
    allGovernments(): GovernmentData[];
    // The engine-backed (or test-recording) SetContext used to run a
    // mission's set expressions; takeEffects() returns any effects the
    // expression produced through FSM operations (S/F/A missions started,
    // etc.).
    makeSetContext(state: PlayerState): { ctx: SetContext; takeEffects(): MissionEffect[] };
    warn(message: string): void;
    // Crön data (cron_scheduler.ts). Optional so synthetic test envs
    // without crön data still work (cron processing then no-ops).
    cronById?(id: string): CronData | null;
    allCronIds?(): string[];
    // Jünk data (player/cargo.ts hold identities, scan masks). Optional so
    // synthetic test envs without jünk data still work; unknown raw ids
    // yield undefined.
    junk?(rawId: number): JunkData | undefined;
}

export function makeStellarMatchContext(env: MissionEnv, systemId: string): StellarMatchContext {
    return {
        systemId,
        system: id => env.system(id),
        government: id => env.government(id),
        govtByRawId: rawId => env.govtByRawId(rawId),
    };
}


// --- effects ---

export type MissionTextPurpose =
    | "complete" | "fail" | "abort" | "refuse" | "loadCargo" | "dropCargo" | "shipDone";

export type MissionSetExprWhen =
    | "accept" | "refuse" | "success" | "failure" | "abort" | "shipDone"
    | "capture";

// What happened, for the UI/persistence layers. Credit, record and date
// changes are applied to the PlayerState by the FSM itself; the effects let
// callers show text, move cargo onto the ship, and log.
export type MissionEffect =
    | { kind: "pay"; amount: number }
    | { kind: "record"; govt: string; delta: number }
    | { kind: "cleanRecord"; govts: string[] }
    | { kind: "cargo"; type: number; qty: number }  // signed tons vs the ship
    // A pickup that did not fit in the hold: the cargo was NOT loaded
    // (cargoLoaded stays false). type/qty describe what was left behind.
    | { kind: "cargoBlocked"; type: number; qty: number }
    | { kind: "fuel"; delta: number }
    | { kind: "text"; purpose: MissionTextPurpose; text: string }
    | { kind: "setExpr"; when: MissionSetExprWhen; expr: string };


// --- rng streams ---

const SET_EXPR_SALTS: Record<MissionSetExprWhen, number> = {
    accept: 0, refuse: 1, success: 2, failure: 3, abort: 4, shipDone: 5,
    capture: 6,
};

// Per-(pilot, mission, purpose) stream. The accept stream also feeds the
// destination and cargo rolls (in that order, before the expression).
function expressionRng(state: PlayerState, missionRawId: number,
    when: MissionSetExprWhen): () => number {
    return makeRng((state.rngSeed + missionRawId * 0x9E37 + SET_EXPR_SALTS[when]) >>> 0);
}

// Seed for the availRandomRolls re-roll on warp-in: derived from the pilot
// seed and the (post-jump) date, so every peer and reload computes the same
// rolls, and no two jumps share a stream.
export function jumpRerollSeed(state: PlayerState): number {
    const { day, month, year } = state.date;
    return (state.rngSeed ^ (year * 4096 + month * 64 + day)) >>> 0;
}

// Re-rolls every mission's AvailRandom roll. missionIds is every mission in
// the game data; rolls persist in PlayerState so an offer seen before a save
// is the offer seen after loading it.
export function rerollAvailRandomRolls(state: PlayerState, missionIds: string[],
    rng: () => number): void {
    for (const id of missionIds) {
        state.availRandomRolls[id] = Math.floor(rng() * 100);
    }
}

// Seed for the availRandomRolls re-roll at every LANDING: the binary
// re-rolls the 1000 rolls on each landing transition too (FUN_00457580),
// not just on jumps, so the board can change while hopping between planets
// of one system. Mixed with the landed stellar's raw id so the landing
// board differs from the warp-in roll of the same day.
export function landingRerollSeed(state: PlayerState,
    landedStellarId: string): number {
    return (jumpRerollSeed(state) ^ (rawIdOf(landedStellarId) * 0x9E37)) >>> 0;
}


// --- stellar matching ---

// Landing on the target stellar — or on a duplicate of it (identical name
// and coordinates; stock data reuses e.g. Earth this way) — counts.
export function landingMatchesStellar(landed: PlanetData, targetStellarId: string,
    env: MissionEnv): boolean {
    if (landed.id === targetStellarId) {
        return true;
    }
    const target = env.planet(targetStellarId);
    if (!target) {
        return false;
    }
    return landed.name === target.name
        && landed.position[0] === target.position[0]
        && landed.position[1] === target.position[1];
}


// --- destination resolution ---

// Resolves a TravelStel/ReturnStel code to a concrete stellar global id at
// accept time. Pool-based picks prefer destinations at least two hyperjumps
// from the origin whose system has more than one static occupant (best
// effort, per the implementation plan), then any two-jump destination, then
// anywhere in the pool.
export function resolveDestination(state: PlayerState, env: MissionEnv, code: number,
    context: "travel" | "return", originStellarId: string, rng: () => number): string | null {

    const filter = decodeStellarFilter(code, context);
    switch (filter.kind) {
        case "none":
            return null;
        case "origin":
            return originStellarId;
        case "specific": {
            const id = globalId(env.prefix, filter.rawId);
            if (env.planet(id) === null) {
                env.warn(`Mission destination code ${code}: no stellar ${id}`);
                return null;
            }
            return id;
        }
        case "unknown":
            env.warn(`Unknown mission destination code ${code}`);
            return null;
    }

    // Pool-based: every stellar matching the filter.
    const originSystemId = env.systemOfPlanet(originStellarId) ?? state.currentSystem;
    const candidates: Array<{ id: string, systemId: string, distance: number }> = [];
    const distances = jumpDistances(systemMapOf(env), originSystemId);
    for (const id of env.allPlanetIds()) {
        const planet = env.planet(id);
        const systemId = env.systemOfPlanet(id);
        if (!planet || !systemId) {
            continue;
        }
        if (!planetMatchesStellarFilter(planet, filter, makeStellarMatchContext(env, systemId))) {
            continue;
        }
        candidates.push({ id, systemId, distance: distances.get(systemId) ?? Infinity });
    }
    if (candidates.length === 0) {
        env.warn(`Mission destination code ${code}: no stellar matches`);
        return null;
    }

    const staticOccupants = (systemId: string): number =>
        env.system(systemId)?.planets.length ?? 0;
    const far = candidates.filter(c => c.distance >= 2);
    const farBusy = far.filter(c => staticOccupants(c.systemId) > 1);
    const pool = farBusy.length > 0 ? farBusy : far.length > 0 ? far : candidates;
    return pool[Math.floor(rng() * pool.length)].id;
}

// Index of systems by id for jumpDistances; built per call (the call count
// is one or two per accept, and game data is already in memory).
function systemMapOf(env: MissionEnv): Map<string, SystemData> {
    const map = new Map<string, SystemData>();
    for (const id of env.allPlanetIds()) {
        const systemId = env.systemOfPlanet(id);
        if (systemId !== null && !map.has(systemId)) {
            const system = env.system(systemId);
            if (system) {
                map.set(systemId, system);
            }
        }
    }
    return map;
}


// --- pay decode ---

/**
 * Decodes and applies a mïsn PayVal:
 *   >= 1            credits paid
 *   -10128..-10383  clean record with govt (raw id |pay| - 10000)
 *   -20128..-20383  also the govt's allies
 *   -30128..-30383  also the govt's classmates
 *   -40001..-40099  the government takes N% of the player's cash
 *   <= -50000       price debited at accept (pass atAccept there only)
 * Note the record bands use the govt's RAW id, unlike the stellar govt
 * bands, which encode govt id + 9872 etc. (see stellar_filter.ts).
 */
export function applyPay(state: PlayerState, payVal: number, env: MissionEnv,
    effects: MissionEffect[], atAccept: boolean): void {
    if (payVal === 0) {
        return;
    }
    if (payVal > 0) {
        state.credits += payVal;
        effects.push({ kind: "pay", amount: payVal });
        return;
    }

    const magnitude = -payVal;
    if (magnitude >= 50000) {
        if (!atAccept) {
            env.warn(`PayVal ${payVal} is an up-front price and only applies at accept; ignored`);
            return;
        }
        const amount = payVal + 50000; // negative: payVal = -(50000 + price)
        state.credits += amount;
        effects.push({ kind: "pay", amount });
        return;
    }
    if (magnitude >= 40001 && magnitude <= 40099) {
        const percent = magnitude - 40000;
        const amount = -Math.floor(state.credits * percent / 100);
        state.credits += amount;
        effects.push({ kind: "pay", amount });
        return;
    }

    // |pay| - 10000 (resp. -20000, -30000) is the government's RAW id,
    // unlike the stellar govt bands, which encode raw id + 9872 etc. (see
    // stellar_filter.ts).
    const band = Math.floor(magnitude / 10000);
    const govtRawId = magnitude - band * 10000;
    const target = (band >= 1 && band <= 3 && govtRawId >= 128 && govtRawId <= 383)
        ? env.govtByRawId(govtRawId)
        : null;
    if (!target) {
        env.warn(`Unsupported PayVal ${payVal}; ignored`);
        return;
    }

    // Clean the record with the govt; the -2xxxx band adds allies (checked
    // in both directions, matching changeRecord's propagation) and -3xxxx
    // adds classmates (both bands also include the govt itself).
    const targets = new Set<string>([target.id]);
    if (band >= 2) {
        for (const govt of env.allGovernments()) {
            if (govtsAreAllies(govt, target) || govtsAreAllies(target, govt)) {
                targets.add(govt.id);
            }
        }
    }
    if (band >= 3) {
        for (const govt of env.allGovernments()) {
            if (govtsAreClassmates(govt, target)) {
                targets.add(govt.id);
            }
        }
    }
    for (const govtId of targets) {
        cleanRecord(state, govtId);
    }
    effects.push({ kind: "cleanRecord", govts: [...targets].sort() });
}


// --- cargo ---

// Rolls the mission's cargo once (at accept), whatever the pickup mode, so
// pickup and dropoff agree on type and quantity. cargoType 1000 is a random
// commodity 0-5; a negative cargoQty is |qty| tons with +/-50% variance.
function rollCargo(mission: MissionData, rng: () => number): ActiveMissionCargo | null {
    if (mission.cargoType < 0 || mission.cargoQty === -1 || mission.cargoQty === 0) {
        return null;
    }
    const type = mission.cargoType === 1000
        ? Math.floor(rng() * 6)
        : mission.cargoType;
    const base = Math.abs(mission.cargoQty);
    const qty = mission.cargoQty < 0
        ? Math.max(1, Math.floor(base * (0.5 + rng())))
        : base;
    return { type, qty };
}

// Loads the mission's shipment onto the ship — well, reports it as a
// 'cargo' effect; the caller moves it into PlayerState.cargo via
// player/cargo.ts. `freeCargoTons` is the player's free hold space at the
// transition (null = unknown, load unconditionally): when the shipment does
// not fit it is skipped entirely — cargoLoaded stays false, so neither a
// later pickup nor the dropoff fires — and a 'cargoBlocked' effect names
// what was left behind. Returns the tons loaded (0 when blocked), so
// callers can track the running free space across several missions.
function pickupCargo(mission: MissionData, active: ActiveMission,
    effects: MissionEffect[], freeCargoTons: number | null): number {
    if (active.cargoLoaded || active.cargo === null) {
        return 0;
    }
    if (freeCargoTons !== null && active.cargo.qty > freeCargoTons) {
        effects.push({ kind: "cargoBlocked", type: active.cargo.type,
            qty: active.cargo.qty });
        return 0;
    }
    active.cargoLoaded = true;
    effects.push({ kind: "cargo", type: active.cargo.type, qty: active.cargo.qty });
    pushText(mission.loadCargText, "loadCargo", effects);
    return active.cargo.qty;
}

// PickupMode 2: the cargo is loaded by boarding the mission's special ship
// (Bible: "Pick up when boarding special ship"). The boarding system calls
// this when the player boards a goal ship, before the goal report — a
// DropoffMode-1 mission drops it again at mission end.
export function boardPickupCargo(mission: MissionData,
    active: ActiveMission, freeCargoTons: number | null = null): MissionEffect[] {
    const effects: MissionEffect[] = [];
    pickupCargo(mission, active, effects, freeCargoTons);
    return effects;
}

// The mirror transition: reports unloading the shipment (negative 'cargo'
// effect — the actual hold subtraction clamps at zero in player/cargo.ts).
// Takes `freeCargoTons` only for call-site symmetry with pickupCargo;
// unloading never needs free space. Returns the tons dropped.
function dropCargo(mission: MissionData, active: ActiveMission,
    effects: MissionEffect[], _freeCargoTons: number | null = null): number {
    if (!active.cargoLoaded || active.cargo === null) {
        return 0;
    }
    active.cargoLoaded = false;
    effects.push({ kind: "cargo", type: active.cargo.type, qty: -active.cargo.qty });
    pushText(mission.dropCargText, "dropCargo", effects);
    return active.cargo.qty;
}


// --- transitions ---

export interface AcceptResult {
    accepted: boolean;
    active: ActiveMission | null;
    effects: MissionEffect[];
}

const NOT_ACCEPTED: AcceptResult = { accepted: false, active: null, effects: [] };

// The accept-time draws (travel destination, return destination, cargo), in
// the exact order and from the same seeded stream acceptMission uses. The
// streams are stateless functions of the pilot seed (see expressionRng), so
// previewing these before accepting costs nothing and always agrees with
// the real accept — briefing/BBS UIs use this to expand <DSY>/<CT>/<CQ>/…
// in offer text without mutating the player state.
export interface AcceptPreview {
    travelStellar: string | null;
    returnStellar: string | null;
    cargo: ActiveMissionCargo | null;
}

function drawAccept(state: PlayerState, mission: MissionData, env: MissionEnv,
    originStellarId: string): AcceptPreview & { rng: () => number } {
    const rng = expressionRng(state, rawIdOf(mission.id), "accept");
    return {
        travelStellar: resolveDestination(state, env, mission.travelStel, "travel",
            originStellarId, rng),
        returnStellar: resolveDestination(state, env, mission.returnStel, "return",
            originStellarId, rng),
        cargo: rollCargo(mission, rng),
        rng,
    };
}

export function previewAccept(state: PlayerState, mission: MissionData, env: MissionEnv,
    originStellarId: string): AcceptPreview {
    const { travelStellar, returnStellar, cargo } = drawAccept(state, mission, env,
        originStellarId);
    return { travelStellar, returnStellar, cargo };
}

// A full ActiveMission-shaped preview of the mission as accepting it here
// would create it — the input expandMissionText needs for offer dialogs.
export function previewActiveMission(state: PlayerState, mission: MissionData,
    env: MissionEnv, originStellarId: string): ActiveMission {
    const preview = previewAccept(state, mission, env, originStellarId);
    return {
        missionId: mission.id,
        originStellar: originStellarId,
        travelStellar: preview.travelStellar,
        returnStellar: preview.returnStellar,
        travelComplete: preview.travelStellar === null,
        shipGoalComplete: false,
        failed: false,
        cargoLoaded: false,
        cargo: preview.cargo,
        deadline: mission.timeLimit > 0 ? advanceDate(state.date, mission.timeLimit) : null,
        specialShips: null,
        auxShips: null,
    };
}

/**
 * Accepts an offered mission while landed on `originStellarId`: resolves
 * TravelStel/ReturnStel, computes the deadline, fires onAccept, loads
 * PickupMode-0 cargo, and debits up-front prices (PayVal <= -50000).
 * `freeCargoTons` is the player's free hold space (null = unconditional);
 * a PickupMode-0 shipment that does not fit stays behind (a 'cargoBlocked'
 * effect) rather than declining the mission.
 */
export function acceptMission(state: PlayerState, mission: MissionData, env: MissionEnv,
    originStellarId: string, freeCargoTons: number | null = null): AcceptResult {
    const rawId = rawIdOf(mission.id);
    if (!Number.isFinite(rawId)) {
        env.warn(`acceptMission: unparsable mission id ${mission.id}`);
        return NOT_ACCEPTED;
    }
    if (state.activeMissions.length >= MAX_ACTIVE_MISSIONS) {
        env.warn(`acceptMission: ${mission.id} declined, ${MAX_ACTIVE_MISSIONS}-mission cap`);
        return NOT_ACCEPTED;
    }
    if (state.activeMissions.some(m => m.missionId === mission.id)) {
        env.warn(`acceptMission: ${mission.id} is already active`);
        return NOT_ACCEPTED;
    }

    const { travelStellar, returnStellar, cargo, rng } = drawAccept(state, mission, env,
        originStellarId);

    const specialShips: SpecialShipProgress | null = mission.shipCount >= 0 ? {
        remaining: mission.shipCount,
        killed: 0,
        boarded: 0,
        disabled: 0,
        jumpedIn: 0,
        jumpedOut: 0,
        initial: mission.shipCount,
    } : null;

    const active: ActiveMission = {
        missionId: mission.id,
        originStellar: originStellarId,
        travelStellar,
        returnStellar,
        // No travel leg means the leg is vacuously complete.
        travelComplete: travelStellar === null,
        shipGoalComplete: false,
        failed: false,
        cargoLoaded: false,
        cargo,
        deadline: mission.timeLimit > 0 ? advanceDate(state.date, mission.timeLimit) : null,
        specialShips,
        auxShips: mission.auxShipCount >= 0
            ? { remaining: mission.auxShipCount, jumpedIn: 0 }
            : null,
    };
    state.activeMissions.push(active);

    const effects: MissionEffect[] = [];
    runSetExpr(state, mission, env, "accept", mission.onAccept, rng, effects);
    if (mission.pickupMode === 0) {
        pickupCargo(mission, active, effects, freeCargoTons);
    }
    // Positive pay arrives at delivery; only the up-front price band
    // (PayVal <= -50000) debits at accept.
    if (mission.payVal <= -50000) {
        applyPay(state, mission.payVal, env, effects, true);
    }

    return { accepted: true, active, effects };
}

export interface RefuseResult {
    refused: boolean;
    effects: MissionEffect[];
}

// Refusing fires onRefuse and shows RefuseText — unless flag 0x0004 marks
// the mission as impossible to refuse.
export function refuseMission(state: PlayerState, mission: MissionData,
    env: MissionEnv): RefuseResult {
    if ((mission.flags & 0x0004) !== 0) {
        return { refused: false, effects: [] };
    }
    const effects: MissionEffect[] = [];
    runSetExpr(state, mission, env, "refuse", mission.onRefuse,
        expressionRng(state, rawIdOf(mission.id), "refuse"), effects);
    pushText(mission.refuseText, "refuse", effects);
    return { refused: true, effects };
}

export interface ArrivalResult {
    effects: MissionEffect[];
    completed: string[];
    failed: string[];
}

/**
 * Arrival processing for one landing (runs before the spaceport UI opens).
 * Per active mission: deadline expiry fails it; otherwise landing on the
 * return stellar (with the travel leg done and the ship goal, if any, met)
 * completes it; otherwise landing on the travel stellar marks the leg done
 * and runs PickupMode 1 / DropoffMode 0. The day does NOT advance on
 * landing (it advances per jump).
 *
 * `freeCargoTons` is the player's free hold space on landing (null =
 * unconditional pickups). It is a budget across the whole landing: every
 * loaded shipment narrows it and every dropoff widens it, so several cargo
 * missions on one landing share the hold fairly (first-come, first-served).
 */
export function processArrival(state: PlayerState, env: MissionEnv,
    landedStellarId: string, freeCargoTons: number | null = null): ArrivalResult {
    const result: ArrivalResult = { effects: [], completed: [], failed: [] };
    const landed = env.planet(landedStellarId);
    if (!landed) {
        env.warn(`processArrival: unknown stellar ${landedStellarId}`);
        return result;
    }

    // Free-space budget for the whole landing; the hold itself is only
    // mutated later, when the caller applies the returned cargo effects.
    let freeTons = freeCargoTons;

    for (const active of [...state.activeMissions]) {
        const mission = env.missionByRawId(rawIdOf(active.missionId));
        if (!mission) {
            env.warn(`processArrival: no mission data for ${active.missionId}; skipped`);
            continue;
        }

        // Deadline first: a day late fails, delivering on deadline day is
        // on time (isDeadlinePassed is strict).
        if (active.deadline !== null && isDeadlinePassed(state.date, active.deadline)) {
            failMission(state, mission, active, env, result.effects);
            result.failed.push(active.missionId);
            continue;
        }

        const travelNow = active.travelStellar !== null && !active.travelComplete
            && landingMatchesStellar(landed, active.travelStellar, env);
        // Missions without a ship goal (shipGoal -1) complete regardless of
        // their special ships; ones with a goal wait for it (P6 events).
        const goalMet = mission.shipGoal === -1 || active.shipGoalComplete;
        const travelDone = active.travelComplete || travelNow;
        const returnReached = active.returnStellar === null
            || landingMatchesStellar(landed, active.returnStellar, env);

        if (goalMet && travelDone && returnReached) {
            completeMission(state, mission, active, env, result.effects);
            result.completed.push(active.missionId);
            continue;
        }

        if (travelNow) {
            active.travelComplete = true;
            if (mission.pickupMode === 1) {
                const loaded = pickupCargo(mission, active, result.effects, freeTons);
                if (freeTons !== null) {
                    freeTons -= loaded;
                }
            }
            if (mission.dropoffMode === 0) {
                const dropped = dropCargo(mission, active, result.effects, freeTons);
                if (freeTons !== null) {
                    freeTons += dropped;
                }
            }
        }
    }
    return result;
}

// Marks a mission's special-ship goal as met (P6 calls this when the last
// goal ship is destroyed/boarded/chased off): fires onShipDone and, for
// missions with no landing requirement (ReturnStel -1), completes on the
// spot — bounty-style missions end in space, not at a port.
export function markShipGoalComplete(state: PlayerState, mission: MissionData,
    active: ActiveMission, env: MissionEnv): MissionEffect[] {
    if (active.shipGoalComplete) {
        return [];
    }
    active.shipGoalComplete = true;
    const effects: MissionEffect[] = [];
    runSetExpr(state, mission, env, "shipDone", mission.onShipDone,
        expressionRng(state, rawIdOf(mission.id), "shipDone"), effects);
    pushText(mission.shipDoneText, "shipDone", effects);
    if (active.returnStellar === null && active.travelComplete) {
        completeMission(state, mission, active, env, effects);
    }
    return effects;
}

// Combat/scan events that can fail a mission: flag 0x0020 (scanned with
// illegal cargo), 0x8000 (boarded), flags2 0x0004 (disabled or destroyed).
export type MissionFailureEvent = "scanned" | "boarded" | "disabledOrDestroyed";

export function reportFailureEvent(state: PlayerState, mission: MissionData,
    active: ActiveMission, env: MissionEnv, event: MissionFailureEvent): MissionEffect[] {
    const hit = event === "scanned" ? (mission.flags & 0x0020) !== 0
        : event === "boarded" ? (mission.flags & 0x8000) !== 0
        : (mission.flags2 & 0x0004) !== 0;
    if (!hit) {
        return [];
    }
    const effects: MissionEffect[] = [];
    failMission(state, mission, active, env, effects);
    return effects;
}

export interface AbortOptions {
    // Flag 0x0001 auto-abort (also applies the pay and datePostInc).
    auto?: boolean;
    // Set-expression Axxx aborts bypass canAbort without auto-abort bonuses.
    forced?: boolean;
}

export interface AbortResult {
    aborted: boolean;
    effects: MissionEffect[];
}

// Player abort (needs canAbort), forced abort (Axxx), or auto-abort
// (flag 0x0001 missions abort themselves; P6 triggers after boarding
// rescue/board-goal ships). Flag 0x0040 reverses 5x CompReward with the
// completion govt on ANY abort (a propagated record change, per the
// Bible's "apply -5x CompReward reversal on abort"), flag 0x0008 consumes
// 100 fuel on AUTO-abort only ("upon auto-abort"), flags2 0x0002 applies
// the pay on auto-abort, and datePostInc advances the date on success and
// auto-abort.
export function abortMission(state: PlayerState, mission: MissionData,
    active: ActiveMission, env: MissionEnv, options: AbortOptions = {}): AbortResult {
    const auto = options.auto === true;
    if (!auto && options.forced !== true && !mission.canAbort) {
        return { aborted: false, effects: [] };
    }
    const effects: MissionEffect[] = [];
    runSetExpr(state, mission, env, "abort", mission.onAbort,
        expressionRng(state, rawIdOf(mission.id), "abort"), effects);

    // Bible, mïsn Flags: 0x0040 "Apply -5x CompReward reversal on abort"
    // (plain "abort" — unlike 0x0008, which says "upon AUTO-abort"), so the
    // record reversal applies to player, forced and auto aborts alike.
    // 0x0008's 100 fuel, by contrast, is auto-abort only.
    if ((mission.flags & 0x0040) !== 0 && mission.compGovt !== null
        && mission.compReward > 0) {
        applyRecordChange(state, mission.compGovt, -5 * mission.compReward, env, effects);
    }
    if ((mission.flags & 0x0008) !== 0 && auto) {
        effects.push({ kind: "fuel", delta: -100 });
    }
    if (auto) {
        if ((mission.flags2 & 0x0002) !== 0) {
            applyPay(state, mission.payVal, env, effects, false);
        }
        if (mission.datePostInc > 0) {
            state.date = advanceDate(state.date, mission.datePostInc);
        }
    }
    removeActiveMission(state, active);
    return { aborted: true, effects };
}


// --- helpers ---

function removeActiveMission(state: PlayerState, active: ActiveMission): void {
    const index = state.activeMissions.indexOf(active);
    if (index >= 0) {
        state.activeMissions.splice(index, 1);
    }
}

function pushText(text: string | null, purpose: MissionTextPurpose,
    effects: MissionEffect[]): void {
    if (text !== null) {
        effects.push({ kind: "text", purpose, text });
    }
}

function runSetExpr(state: PlayerState, mission: MissionData, env: MissionEnv,
    when: MissionSetExprWhen, expr: string, rng: () => number,
    effects: MissionEffect[]): void {
    if (expr === "") {
        return; // blank set expressions are no-ops
    }
    const { ctx, takeEffects } = env.makeSetContext(state);
    executeSet(expr, ctx, rng, env.warn);
    effects.push({ kind: "setExpr", when, expr });
    effects.push(...takeEffects());
}

// Runs a ship-level set expression — shïp OnCapture, fired when one of the
// player's boarding attempts captures the ship. Same executor and effect
// plumbing as a mission's expressions, keyed by the ship's raw id instead
// of a mission id.
export function runShipSetExpr(state: PlayerState, shipRawId: number,
    env: MissionEnv, expr: string, effects: MissionEffect[]): void {
    if (expr === "") {
        return; // blank set expressions are no-ops
    }
    const { ctx, takeEffects } = env.makeSetContext(state);
    executeSet(expr, ctx, expressionRng(state, shipRawId, "capture"), env.warn);
    effects.push({ kind: "setExpr", when: "capture", expr });
    effects.push(...takeEffects());
}

export function failMission(state: PlayerState, mission: MissionData, active: ActiveMission,
    env: MissionEnv, effects: MissionEffect[]): void {
    runSetExpr(state, mission, env, "failure", mission.onFailure,
        expressionRng(state, rawIdOf(mission.id), "failure"), effects);
    pushText(mission.failText, "fail", effects);
    // Failing costs half the completion reward with the completion govt
    // (propagated like any other act — see legal_status.changeRecord).
    if (mission.compGovt !== null && mission.compReward > 0) {
        applyRecordChange(state, mission.compGovt, -Math.floor(mission.compReward / 2),
            env, effects);
    }
    removeActiveMission(state, active);
    state.failedMissions.push(active.missionId);
}

// Runs one record change through the legal_status propagation and reports
// every govt it touched (the completion govt first, then those that merely
// heard about it).
function applyRecordChange(state: PlayerState, govtId: string, delta: number,
    env: MissionEnv, effects: MissionEffect[]): void {
    for (const change of changeRecord(state, govtId, delta, env)) {
        effects.push({ kind: "record", govt: change.govt, delta: change.delta });
    }
}

function completeMission(state: PlayerState, mission: MissionData, active: ActiveMission,
    env: MissionEnv, effects: MissionEffect[]): void {
    applyPay(state, mission.payVal, env, effects, false);
    if (mission.compGovt !== null) {
        applyRecordChange(state, mission.compGovt, mission.compReward, env, effects);
    }
    // DropoffMode 1 drops at mission end; mode 0 (drop at the travel
    // stellar) also lands here when the mission completes on that landing.
    dropCargo(mission, active, effects);
    runSetExpr(state, mission, env, "success", mission.onSuccess,
        expressionRng(state, rawIdOf(mission.id), "success"), effects);
    pushText(mission.compText, "complete", effects);
    if (mission.datePostInc > 0) {
        state.date = advanceDate(state.date, mission.datePostInc);
    }
    removeActiveMission(state, active);
    state.completedMissions.push(active.missionId);
}
