// Distinct düde AIType 1-4 behavior, ported from the binary's AI state
// machine (FUN_0040e020 acquisition, FUN_004192d0 retaliation, FUN_00402e50
// decisions, FUN_0040c790 travel): traders (1/2) travel between planets and
// jump out when they lose a target, warships (3) and interceptors (4)
// acquire targets through a strength-scaled odds filter (no radius), an AI
// ship retaliates against ANY different-government attacker subject to the
// suppression cascade, and ships flee on low shields while their target
// lives. FUN_00405590's pursuit memory (AI > 2) loiters where the target
// was lost instead of dropping it, and FUN_00403de0's AI-4 comm-scan flies
// idle interceptors at a random ship to hail (or wave through) the player.
//
// The combat building blocks stay in npc_plugin: these systems only set
// TargetComponent and movement/weapon state, and run after FollowAI /
// ShootAllWeaponsAI so they can override the generic chase-and-shoot AI
// each step.

import { Entities, Emit, GetWorld, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { EntityMap } from "nova_ecs/entity_map";
import { EcsEvent } from "nova_ecs/events";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementState, MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { GovernmentData } from "novadatainterface/GovernmentData";
import { PlanetData } from "novadatainterface/PlanetData";
import { MissionEnvResource } from "../missions/mission_plugin";
import { govtsAreAllies, govtsAreEnemies } from "../player/legal_status";
import { PlayerStateResource } from "../player/player_state_component";
import { randInt } from "../player/pilot_files";
import { DamagedEvent } from "./death_plugin";
import { OwnerComponent } from "./fire_weapon_plugin";
import { GameDataResource } from "./game_data_resource";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import { govtsAllied, govtsHostile, playerIsLegalTarget,
    playerTargetVetoed } from "./player_hostility";
import { FollowAI, GovernmentComponent,
    ShootAllWeaponsAI } from "./npc_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { PlanetComponent, PlanetDataComponent } from "./planet_plugin";
import { ShipComponent, ShipDataComponent } from "./ship_plugin";
import { Stat } from "./stat";
import { SystemIdResource } from "./system_id_resource";
import { TargetComponent } from "./target_component";
import { TargetRemovedEvent } from "./target_plugin";
import { WeaponsStateComponent } from "./weapons_state";

// AIType 0 means "no special AI" (the legacy random-target behavior).
export const AIConfigComponent = new Component<{
    aiType: number,
    aggress: number,
    coward: number | null,  // set from the përs only; % of shields below which the ship flees
}>('AIConfig');

// Per-ship AI state, mirroring the binary's ship-slot AI fields: anger
// (+0x96, accumulated damage from the current target), the last attacker,
// the flee latch (AI state 3), the trader's focus spöb (+0x92) and its
// post-arrival wait (+0x4c). The optional fields model the binary's
// longer-lived AI states: the pursuit-memory loiter (the target reference
// kept while it is invisible, with the +0xc90c attention window) and the
// AI-4 comm-scan (state 7's scan target +0x70 and the last scan-mark
// +0x90, which is never re-picked).
export const AIStateComponent = new Component<{
    anger: number,
    attackedBy: string | null,
    fleeing: boolean,
    destination?: string,
    waitUntil?: number,
    lostTarget?: string,
    attentionUntil?: number,
    scanTarget?: string,
    lastScanMark?: string,
}>('AIState');

// FUN_00401800: an interceptor completing its comm-scan approach hails the
// player (rand(100) ≤ 75) instead of dropping silently. The AI only fires
// the event — the govt greeting text and the comm surface are the display
// layer's business (the port does not yet parse the gövt greeting STR#).
export const NpcHailEvent = new EcsEvent<{ from: string }>('NpcHailEvent');

// AI types with the special-AI behavior set: 1 wimpy trader, 2 brave
// trader, 3 warship, 4 interceptor (slot+0x88) and 6 mission special
// (FUN_004259b0's mïsn path — acquires and retaliates like a warship but
// never jumps out on target loss).
function hasAI(config: { aiType: number }): boolean {
    return (config.aiType >= 1 && config.aiType <= 4) || config.aiType === 6;
}

// A ship with neither armor nor shields left is dead in space (the goal-5
// rescue target spawns exactly this way) — it can neither flee nor travel.
// Ships with no health data at all are assumed alive.
function isDeadInSpace(armor: Stat | undefined,
    shield: Stat | undefined): boolean {
    if (!armor && !shield) {
        return false;
    }
    return (armor?.current ?? 0) <= 0 && (shield?.current ?? 0) <= 0;
}

// FUN_00411800: the group strength the acquisition odds filter weighs
// candidates against — Σ shïp Strength × shield fraction over the ship
// itself, its escorts (same OwnerComponent owner) and its allies
// (FUN_0046bc90: same govt or govtsAreAllies either direction), with
// allies whose current target is this ship counted ×2 (they are busy
// attacking it). The shield fraction (current/max) clamps to
// [0.25, 1.0]; ships with no shields count 1.0.
export function strengthOf(subject: string, entities: EntityMap,
    world: World): number {
    const gameData = world.resources.get(GameDataResource);
    const env = world.resources.get(MissionEnvResource);
    const subjectEntity = entities.get(subject);
    if (!subjectEntity
        || subjectEntity.components.get(ShipComponent) === undefined) {
        return 0;
    }
    const subjectGovtId = subjectEntity.components
        .get(GovernmentComponent)?.id ?? null;
    const subjectGovt = env?.government(subjectGovtId) ?? null;

    let total = 0;
    for (const key of entities.keys()) {
        const entity = entities.get(key);
        if (!entity || key === subject
            || entity.components.get(ShipComponent) === undefined) {
            continue;
        }
        const isEscort = entity.components.get(OwnerComponent)?.owner === subject;
        const govtId = entity.components.get(GovernmentComponent)?.id ?? null;
        const allied = govtsAllied(subjectGovt,
            env?.government(govtId) ?? null, subjectGovtId, govtId);
        if (!isEscort && !allied) {
            continue;
        }

        // Strength comes from the ship's effective data (përs carry a
        // cloned ShipDataComponent) with the raw table as fallback.
        const data = entity.components.get(ShipDataComponent)
            ?? gameData?.data.Ship.getCached(
                entity.components.get(ShipComponent)!.id);
        let fraction = 1.0;
        const shield = entity.components.get(ShieldComponent);
        if (shield && shield.max > 0) {
            fraction = shield.current / shield.max;
            fraction = Math.min(1.0, Math.max(0.25, fraction));
        }
        // Allies currently attacking the subject fight it, not for it.
        const multiplier = allied
            && entity.components.get(TargetComponent)?.target === subject
            ? 2 : 1;
        total += (data?.strength ?? 0) * fraction * multiplier;
    }
    // The subject itself always counts (its own shields too).
    const subjectShield = subjectEntity.components.get(ShieldComponent);
    let subjectFraction = 1.0;
    if (subjectShield && subjectShield.max > 0) {
        subjectFraction = Math.min(1.0,
            Math.max(0.25, subjectShield.current / subjectShield.max));
    }
    const subjectData = subjectEntity.components.get(ShipDataComponent)
        ?? gameData?.data.Ship.getCached(
            subjectEntity.components.get(ShipComponent)!.id);
    return (subjectData?.strength ?? 0) * subjectFraction + total;
}

const PlanetsQuery = new Query([UUID, MovementStateComponent, PlanetComponent,
    Optional(PlanetDataComponent)] as const);
const PlayerQuery = new Query([UUID, MovementStateComponent, PlayerShipSelector] as const);

function isArrived(movement: MovementState, planetUuid: string,
    entities: EntityMap): boolean {
    // FUN_00462410: the spöb's radius is the FULL WIDTH of its sprite base
    // frame (rlëD size[0]; engine default 0x96 = 150); the arrival test is
    // |dx|,|dy| ≤ radius/4.
    const planet = entities.get(planetUuid);
    const planetMovement = planet?.components.get(MovementStateComponent);
    if (!planet || !planetMovement) {
        return false;
    }
    const reach = (planet.components.get(PlanetDataComponent)?.radius
        ?? 150) / 4;
    return Math.abs(planetMovement.position.x - movement.position.x) <= reach
        && Math.abs(planetMovement.position.y - movement.position.y) <= reach;
}

// FUN_0040c790: the trader destination pick — a rejection draw of
// rand(16) over the current system's 16 spöb slots (the port's planet
// entities), retried until the drawn slot satisfies the selected branch's
// predicate. Slot validity is FUN_0046e3f0 plus the SIGNED x < 1000 and
// y < 1000 test (runtime spöb +4/+6). Ordinary = UNINHABITED (raw flags
// 0x20 set — the inhabitable bit is cleared) with no 0x3000 category
// bits; the counters are taken over valid non-hostile slots. The govt's
// flags2 (raw gövt +0x04 → runtime +0x22) selects the branch:
//   0x80 force-picks a 0x2000-category spöb when one is reachable,
//   0x40 force-picks a 0x1000-category spöb (0x80 wins),
//   otherwise the general path draws an inhabited (non-ordinary) spöb,
//   vetoing 0x2000 unless 0x80 is set and 0x1000 when 0x20 is set — and
//   picks NOTHING (0xffff → the jump-out) when the vetoes cannot be met.
// FUN_00403de0's interceptor call passes param_3 = 1: any non-category
// non-hostile slot (uninhabited included), gated on at least one
// inhabited non-category spöb. The binary's param_2 is 0 at every ported
// call site, which pins the general path to branch 3. The binary loops
// unbounded; the port bounds the draws (a null return sends the trader to
// the FUN_00415b80 jump-out).
const TRAVEL_DRAW = 16;
const TRAVEL_DRAW_LIMIT = 1000;

// FUN_0040c790's param_2: no ported caller passes it set.
const TRAVEL_PARAM_2 = false;

type PlanetEntry = readonly [string, MovementState, { id: string },
    PlanetData | undefined];

function drawDestination(govtId: string | null | undefined, world: World,
    planets: Array<PlanetEntry>, interceptorMode: boolean): string | null {
    const env = world.resources.get(MissionEnvResource);
    const mine = env?.government(govtId ?? null) ?? null;
    const mineFlags2 = mine?.flags2 ?? 0;

    const facts = planets.map(([, planetMovement, , data]) => {
        const theirGovt = data ? env?.government(data.govt) ?? null : null;
        const category = (data?.flags2 ?? 0) & 0x3000;
        return {
            valid: planetMovement.position.x < 1000
                && planetMovement.position.y < 1000,
            hostile: govtsHostile(mine, theirGovt, mine?.id, theirGovt?.id),
            ordinary: data?.inhabited === false && category === 0,
            cat1000: (category & 0x1000) !== 0,
            cat2000: (category & 0x2000) !== 0,
        };
    });
    const counted = facts.filter(fact => fact.valid && !fact.hostile);
    const nA = counted.filter(fact => fact.cat2000).length;
    const nB = counted.filter(fact => fact.cat1000).length;
    const nSpecial = counted.filter(fact => !fact.ordinary).length;
    const nPlain = counted.filter(fact => !fact.ordinary && !fact.cat1000
        && !fact.cat2000).length;

    let predicate: (fact: typeof facts[number]) => boolean;
    if (interceptorMode) {
        if (nPlain < 1) {
            return null;
        }
        predicate = fact => fact.valid && !fact.hostile && !fact.cat2000
            && !fact.cat1000;
    }
    else if ((mineFlags2 & 0x80) !== 0 && nA > 0) {
        predicate = fact => fact.valid && !fact.hostile && fact.cat2000;
    }
    else if ((mineFlags2 & 0x40) !== 0 && nB > 0) {
        predicate = fact => fact.valid && !fact.hostile && fact.cat1000;
    }
    else if (nSpecial < 1 || !TRAVEL_PARAM_2
        || (mineFlags2 & 0x20) !== 0 || (nPlain < 1 && nB < 1)) {
        // The general path draws only when its vetoes can be satisfied —
        // otherwise the binary returns 0xffff without drawing.
        if (!(nSpecial > 0 && (nPlain > 0
            || (nB > 0 && (mineFlags2 & 0x20) === 0)))) {
            return null;
        }
        predicate = fact => fact.valid && !fact.hostile && !fact.ordinary
            && !(fact.cat2000 && (mineFlags2 & 0x80) === 0)
            && !(fact.cat1000 && (mineFlags2 & 0x20) !== 0);
    }
    else {
        predicate = fact => fact.valid && !fact.hostile && !fact.ordinary
            && !fact.cat2000;
    }

    for (let draw = 0; draw < TRAVEL_DRAW_LIMIT; draw++) {
        const idx = randInt(TRAVEL_DRAW);
        if (idx < facts.length && predicate(facts[idx])) {
            return planets[idx][0];
        }
    }
    return null;
}

// FUN_0040e020 — the acquisition scan, run for every idle AI ship (types
// 1-4 and 6, not just warships): pass 1 police-assist (AI < 5) takes the
// first assistable victim an allied ship is fighting and returns; pass 2
// considers the player inside the aggress square (|dx|,|dy| ≤ aggress ×
// 600) when hostile; pass 3 scans every non-player ship for mutual enemies
// (FUN_0046bdf0: derelict-skipped, xenophobia either side) that the odds
// filter allows — there is NO distance cap on NPC-vs-NPC acquisition, the
// odds filter IS the range; the winner is the minimum dist². Pass 4 falls
// back to the nearest ship attacking me or my escorts, any government
// (FUN_0040faa0). (Exported because pers_plugin's grudge targeting must
// run after it.)
export const AggroRangeSystem = new System({
    name: 'AggroRange',
    args: [AIConfigComponent, TargetComponent, MovementStateComponent, UUID,
        Optional(GovernmentComponent), Entities, GetWorld,
        PlayerQuery, Optional(AIStateComponent)] as const,
    step(config, target, movement, uuid, govt, entities, world: World,
        players, state) {
        if (!hasAI(config)) {
            return;
        }
        if (state?.lostTarget !== undefined) {
            // Pursuit memory (FUN_00405590): the binary still holds +0x70
            // while the attention window runs, so acquisition is skipped.
            return;
        }
        if (target.target !== undefined && entities.has(target.target)) {
            // Keep chasing the current target — the binary holds +0x70
            // while the target lives (anger state 4). TargetRemovedSystem
            // clears the reference (and the anger) when it dies or leaves.
            return;
        }
        target.target = undefined;

        const env = world.resources.get(MissionEnvResource);
        const mine = env?.government(govt?.id ?? null) ?? null;
        // govt MaxOdds is the raw per-mille gövt value (+0x60): a candidate
        // is dropped when its strength exceeds mine × maxOdds/1000
        // (stock 250 → ×0.25).
        const oddsScale = (mine?.maxOdds ?? 1000) / 1000;
        const myStrength = strengthOf(uuid, entities, world);

        let best: string | undefined;
        let bestDistance = Infinity;
        const consider = (candidate: string, distanceSquared: number) => {
            if (distanceSquared < bestDistance) {
                best = candidate;
                bestDistance = distanceSquared;
            }
        };
        const distanceSquaredTo = (otherUuid: string): number => {
            const other = entities.get(otherUuid)
                ?.components.get(MovementStateComponent);
            if (!other) {
                return Infinity;
            }
            const dx = other.position.x - movement.position.x;
            const dy = other.position.y - movement.position.y;
            return dx * dx + dy * dy;
        };

        // Pass 1: police-assist (AI < 5) — an allied ship holds a live
        // target; take its victim when the odds allow and (for the player)
        // hostility permits. FUN_0040e020 takes the first assistable victim
        // and skips the remaining passes.
        if (config.aiType < 5) {
            for (const key of entities.keys()) {
                const other = entities.get(key);
                if (!other || key === uuid
                    || other.components.get(ShipComponent) === undefined) {
                    continue;
                }
                const theirTarget = other.components.get(TargetComponent)?.target;
                if (theirTarget === undefined || !entities.has(theirTarget)) {
                    continue;
                }
                const theirGovtId = other.components.get(GovernmentComponent)?.id
                    ?? null;
                if (!govtsAllied(mine, env?.government(theirGovtId) ?? null,
                    govt?.id, theirGovtId)) {
                    continue;
                }
                if (strengthOf(theirTarget, entities, world)
                    > myStrength * oddsScale) {
                    continue;
                }
                const victim = entities.get(theirTarget);
                if (victim?.components.has(PlayerShipSelector)
                    && !playerIsLegalTarget(govt?.id, world)) {
                    continue;
                }
                target.target = theirTarget;
                return;
            }
        }

        // Pass 2: the player as a candidate — inside the aggress square
        // (aggress × 600 per axis), my govt lacks the never-attacks-player
        // flag 0x40 and the attack-player veto bytes, and the player is a
        // legal target of my government (per-system record case table).
        const [playerUuid, playerMovement] = players[0] ?? [];
        if (playerUuid !== undefined && playerUuid !== uuid
            && ((mine?.flags ?? 0) & 0x40) === 0
            && !playerTargetVetoed(govt?.id, world)
            && playerIsLegalTarget(govt?.id, world)) {
            const dx = Math.abs(playerMovement.position.x - movement.position.x);
            const dy = Math.abs(playerMovement.position.y - movement.position.y);
            const reach = config.aggress * 600;
            if (dx <= reach && dy <= reach) {
                consider(playerUuid, dx * dx + dy * dy);
            }
        }

        // Pass 3: the general enemy scan (FUN_004101d0) — mutual enemies
        // and xenophobic targets anywhere on the map, subject to the odds
        // filter. The player is excluded here (the binary skips the player
        // slot): pass 2's aggress square is the only player path.
        for (const key of entities.keys()) {
            const other = entities.get(key);
            if (!other || key === uuid
                || other.components.get(ShipComponent) === undefined
                || other.components.has(PlayerShipSelector)) {
                continue;
            }
            const theirGovtId = other.components.get(GovernmentComponent)?.id
                ?? null;
            if (theirGovtId !== null && theirGovtId === govt?.id) {
                // FUN_004101d0: never one's own government.
                continue;
            }
            if (!govtsHostile(mine, env?.government(theirGovtId) ?? null,
                govt?.id, theirGovtId)) {
                continue;
            }
            if (strengthOf(key, entities, world) > myStrength * oddsScale) {
                continue;
            }
            consider(key, distanceSquaredTo(key));
        }

        // Pass 4: nothing hostile — the FUN_0040faa0 fallback: the nearest
        // ship attacking me or one of my escorts, any government.
        if (best === undefined) {
            let nearest: string | undefined;
            let nearestDistance = Infinity;
            for (const key of entities.keys()) {
                const other = entities.get(key);
                if (!other || key === uuid
                    || other.components.get(ShipComponent) === undefined) {
                    continue;
                }
                const theirTarget = other.components.get(TargetComponent)?.target;
                if (theirTarget !== uuid && !isMyEscort(theirTarget, uuid,
                    entities)) {
                    continue;
                }
                const distance = distanceSquaredTo(key);
                if (distance < nearestDistance) {
                    nearest = key;
                    nearestDistance = distance;
                }
            }
            best = nearest;
        }

        target.target = best;
    },
});

// The fallback's "my escort" test: a ship owned by me (bay fighters ride
// the OwnerComponent owner chain).
function isMyEscort(targetUuid: string | undefined, myUuid: string,
    entities: EntityMap): boolean {
    if (targetUuid === undefined) {
        return false;
    }
    return entities.get(targetUuid)?.components.get(OwnerComponent)?.owner
        === myUuid;
}

const ScanCandidatesQuery = new Query([UUID, ShipComponent,
    Optional(AIConfigComponent), Optional(ArmorComponent),
    Optional(ShieldComponent)] as const);

// FUN_00403de0's voluntary comm-scan (AI state 7), run after AggroRange:
// an idle AI-4 interceptor that acquired nothing picks a random visible
// alive same-system ship that is NOT another interceptor (rejection
// rand(0x40), never the last scan-mark +0x90) and flies straight at it
// (substate 9) to within a 100px square (DAT_0057501c). At the square the
// FUN_00401800 hail gate applies: the player (and only the player) is
// hailed on rand(100) ≤ 75 — the port emits NpcHailEvent for the display
// layer; the govt-greeting text, the mïsn-hostility hail variant and the
// player-side anti-refire timer have no port model yet — and everything
// else (NPC targets, failed rolls) drops silently to state 0. Scan
// targets get NO pursuit memory: a gone target just drops. FUN_0040e020
// keeps running every tick during state 7, so a fresh acquisition
// (AggroRange setting a target) cancels the scan — attack wins. The rare
// scan-duty mode (+0xc8d0 = 0x3ff, spawner FUN_0046ac50) is unported.
const SCAN_REACH = 100;         // DAT_0057501c
const SCAN_DRAW = 0x40;         // FUN_004683b0(0x40) rejection draw
const SCAN_DRAW_LIMIT = 1000;   // the binary loops unbounded

const InterceptorScanSystem = new System({
    name: 'InterceptorScan',
    args: [AIConfigComponent, AIStateComponent, TargetComponent,
        MovementStateComponent, TimeResource, UUID, Entities, GetWorld,
        Emit, ScanCandidatesQuery, PlayerQuery] as const,
    after: [AggroRangeSystem],
    step(config, state, target, movement, _time, uuid, entities,
        _world: World, emit, candidates, players) {
        if (config.aiType !== 4) {
            // FUN_00403de0 is the AI-4 brain exclusively.
            return;
        }
        if (target.target !== undefined) {
            // Attack wins over the scan (state 7's per-tick acquisition).
            state.scanTarget = undefined;
            return;
        }
        if (state.scanTarget !== undefined) {
            const scanUuid = state.scanTarget;
            if (!entities.has(scanUuid)) {
                state.scanTarget = undefined;
                return;
            }
            const scanMovement = entities.get(scanUuid)!.components
                .get(MovementStateComponent)!;
            const dx = Math.abs(scanMovement.position.x
                - movement.position.x);
            const dy = Math.abs(scanMovement.position.y
                - movement.position.y);
            if (dx <= SCAN_REACH && dy <= SCAN_REACH) {
                if (players.some(([playerUuid]) => playerUuid === scanUuid)
                    && randInt(100) <= 75) {
                    emit(NpcHailEvent, { from: uuid });
                }
                state.lastScanMark = scanUuid;
                state.scanTarget = undefined;
                return;
            }
            // Substate 9: straight fly-at — turn and full thrust.
            movement.turnTo = scanUuid;
            movement.accelerating = 1;
            return;
        }

        // Scan initiation: idle states 0/1/0x14 with the wait expired —
        // no target, no destination, no wait, not fleeing or loitering.
        if (state.destination !== undefined
            || state.waitUntil !== undefined || state.fleeing
            || state.lostTarget !== undefined) {
            return;
        }
        const eligible = candidates.filter(([candidateUuid, , aiConfig,
            armor, shield]) =>
            candidateUuid !== uuid
            && aiConfig?.aiType !== 4
            && !isDeadInSpace(armor, shield)
            && candidateUuid !== state.lastScanMark);
        if (eligible.length === 0) {
            return;
        }
        for (let draw = 0; draw < SCAN_DRAW_LIMIT; draw++) {
            const idx = randInt(SCAN_DRAW);
            if (idx < eligible.length) {
                state.scanTarget = eligible[idx][0];
                state.lastScanMark = state.scanTarget;
                return;
            }
        }
    },
});

// The pursuit-memory tick (FUN_00405590 @0x4057f0: attack states 4/0xd
// with an AI type > 2, target alive but invisible). The port's only
// invisibility is the removed target entity, so TargetLostSystem stashes
// the reference here; the ship brakes to a full stop (substate 1: retro
// burn above the 0.35 px/frame threshold — DAT_00575080, ×30 for the
// port's px/s velocities — then sits) and loiters for the attention
// window (rand(100)+100 frames). The target becoming visible again (an
// entity back under the kept uuid) resumes the attack and re-arms the
// sentinel; expiry drops it (state 0) and AggroRange re-acquires next
// tick. AI ≤ 2 has no memory (TargetLostSystem keeps its jump-out).
const BRAKE_SPEED = 0.35 * 30;

const PursuitMemorySystem = new System({
    name: 'PursuitMemory',
    args: [AIStateComponent, TargetComponent, MovementStateComponent,
        TimeResource, Entities] as const,
    after: [AggroRangeSystem],
    step(state, target, movement, time, entities) {
        if (state.lostTarget === undefined) {
            return;
        }
        if (target.target !== undefined && entities.has(target.target)) {
            // A live target appeared outside the memory (e.g. retaliation
            // picked a new shooter): the stale reference is dropped.
            state.lostTarget = undefined;
            state.attentionUntil = undefined;
            return;
        }
        if (entities.has(state.lostTarget)) {
            // Visible again: back to the attack (state 4), window re-armed.
            target.target = state.lostTarget;
            state.lostTarget = undefined;
            state.attentionUntil = undefined;
            return;
        }
        if (time.time >= state.attentionUntil!) {
            // Expired: drop (target -1, state 0) and re-acquire.
            state.lostTarget = undefined;
            state.attentionUntil = undefined;
            state.anger = 0;
            state.attackedBy = null;
            state.fleeing = false;
            state.destination = undefined;
            state.waitUntil = undefined;
            target.target = undefined;
            return;
        }
        if (Math.abs(movement.velocity.x) >= BRAKE_SPEED
            || Math.abs(movement.velocity.y) >= BRAKE_SPEED) {
            movement.turnTo = null;
            movement.turnBack = true;
            movement.accelerating = 1;
        }
        else {
            movement.turnBack = false;
            movement.accelerating = 0;
        }
    },
});

// Idle AI ships cruise between the system's planets (FUN_00405590 state 1):
// a rejection-drawn destination, a square radius/4 arrival test, the
// ship-type flags3 park wait on arrival, and a re-decide that LANDS
// (despawns) the trader when the drawn destination is the spöb it is
// parked at (binary state 0x14). A 0x3000-category destination also lands
// on arrival: state 1 hands a category focus straight to state 0x14.
const TraderTravelSystem = new System({
    name: 'TraderTravel',
    args: [AIConfigComponent, AIStateComponent, TargetComponent,
        MovementStateComponent, TimeResource, UUID, Entities,
        Optional(ArmorComponent), Optional(ShieldComponent),
        Optional(GovernmentComponent), Optional(ShipDataComponent),
        GetWorld, PlanetsQuery] as const,
    after: [AggroRangeSystem, InterceptorScanSystem, FollowAI],
    step(config, state, target, movement, time, uuid, entities, armor,
        shield, govt, shipData, world: World, planets) {
        if (!hasAI(config) || state.fleeing || isDeadInSpace(armor, shield)) {
            return;
        }
        if (target.target !== undefined && entities.has(target.target)) {
            // Busy with a live target (fighting back or hunting):
            // FollowAI handles the movement.
            return;
        }
        target.target = undefined;

        // The comm-scan (state 7) and the pursuit-memory loiter are not
        // travel states — InterceptorScanSystem / PursuitMemorySystem own
        // the ship until they end.
        if (state.scanTarget !== undefined
            || state.lostTarget !== undefined) {
            return;
        }

        // Parked at a spöb, waiting out the arrival wait (+0x4c, the
        // flags3-gated rand(75)+100 / rand(200)+300) before the next
        // decision.
        if (state.waitUntil !== undefined && state.waitUntil > time.time) {
            movement.accelerating = 0;
            return;
        }
        state.waitUntil = undefined;

        // Traveling toward the drawn destination (+0x92 focus spöb). The
        // turnTo is re-asserted each step: FollowAI clobbers it.
        if (state.destination !== undefined
            && entities.has(state.destination)) {
            if (!isArrived(movement, state.destination, entities)) {
                movement.turnTo = state.destination;
                movement.accelerating = 1;
                return;
            }
            // Arrived: a 0x2000/0x1000-category destination goes to state
            // 0x14 — the ship lands (despawns into the spöb) instead of
            // parking.
            if (((entities.get(state.destination)?.components
                .get(PlanetDataComponent)?.flags2 ?? 0) & 0x3000) !== 0) {
                entities.delete(uuid);
                return;
            }
            // Arrived: park and wait, then re-decide (state 0). The wait
            // is the ship-type flags3 (+0x9ec) bit 0x2 variant:
            // rand(75)+100 instead of rand(200)+300 (FUN_00405590
            // @0x405c35).
            movement.accelerating = 0;
            state.destination = undefined;
            const shortWait = ((shipData?.flags3 ?? 0) & 0x2) !== 0;
            state.waitUntil = time.time + (shortWait
                ? randInt(75) + 100 : randInt(200) + 300) * 1000 / 30;
            return;
        }

        // Re-decide (FUN_0040c790 + FUN_00402e50 state 0): draw a
        // destination; drawing the spöb we are parked at means LAND
        // (state 0x14 — the trader despawns into the planet). AI 4 calls
        // the picker with param_3 = 1 (FUN_00403de0).
        const destination = drawDestination(govt?.id, world, planets,
            config.aiType === 4);
        if (destination === null) {
            // FUN_0040c790's 0xffff → FUN_00415b80 jump out
            // (FUN_00410670): the port models that as the silent despawn
            // for the jumping AI types 1-2. Types 3/4/6 have no
            // jump-capability model — they park and retry at the binary's
            // rand(200)+300-frame re-decide cadence (never per frame).
            if (config.aiType <= 2) {
                entities.delete(uuid);
                return;
            }
            movement.turnTo = null;
            state.waitUntil = time.time + (randInt(200) + 300) * 1000 / 30;
            return;
        }
        if (isArrived(movement, destination, entities)) {
            entities.delete(uuid);
            return;
        }
        state.destination = destination;
        movement.turnTo = destination;
        movement.accelerating = 1;
    },
});

// Low-shield flight (FUN_00402e50 flee block): the threshold is the përs
// coward % of max shields, else aggress 1 → 30%, aggress 2 → 15%, else
// never. Only ownerless ships of a retreat-flagged (0x10) government with
// a live target flee (escorts never do); fleeing lasts while the target
// lives — the ship keeps the target, turns back, burns and holds fire,
// then un-flees and forgets the grudge when the target is gone.
const FleeSystem = new System({
    name: 'Flee',
    args: [AIConfigComponent, AIStateComponent, TargetComponent,
        MovementStateComponent, Optional(ShieldComponent),
        Optional(ArmorComponent), Optional(WeaponsStateComponent),
        Optional(GovernmentComponent), Optional(OwnerComponent),
        Entities, GetWorld] as const,
    after: [FollowAI, ShootAllWeaponsAI, TraderTravelSystem],
    step(config, state, target, movement, shield, armor, weapons, govt,
        owner, entities, world: World) {
        if (isDeadInSpace(armor, shield)) {
            return;
        }
        const targetLive = target.target !== undefined
            && entities.has(target.target);
        if (!targetLive) {
            if (state.fleeing) {
                // State 3 ends with the target: un-flee, clear the anger
                // and re-decide.
                state.fleeing = false;
                state.anger = 0;
                state.attackedBy = null;
                target.target = undefined;
            }
            return;
        }
        if (owner !== undefined) {
            return;
        }
        const env = world.resources.get(MissionEnvResource);
        const mine = env?.government(govt?.id ?? null) ?? null;
        if (!mine || (mine.flags & 0x10) === 0) {
            return;
        }
        const maxShield = shield && shield.max > 0 ? shield.max : 0;
        const threshold = config.coward !== null
            ? config.coward * 0.01 * maxShield
            : config.aggress === 1 ? 0.30 * maxShield
            : config.aggress === 2 ? 0.15 * maxShield
            : NaN;
        if (Number.isNaN(threshold)) {
            return;
        }
        if (!state.fleeing) {
            if ((shield?.current ?? 0) >= threshold) {
                return;
            }
            state.fleeing = true;
        }
        movement.turnTo = null;
        movement.turnBack = true;
        movement.accelerating = 1;
        if (weapons) {
            for (const [, weapon] of weapons) {
                weapon.firing = false;
            }
        }
    },
});

// FUN_004192d0's retaliation: an AI ship turns on ANY different-government
// attacker — declared war is NOT required — unless the suppression cascade
// fires: a same-government shooter, an independent victim hit by anyone
// but the player (or player-owned ships), a player whose legal record with
// the current system's government is still clean (2 × crimeTol ≤ record)
// and who is not targeting me (stray-fire amnesty), a same-owner shooter,
// or a derelict-govt (0x800) victim. On retaliation the damage accumulates
// in anger (+0x96) and the shooter becomes the target. Projectiles/beams/
// blasts pass their own uuid as the damager, so the shooter is resolved
// through the projectile's OwnerComponent.
const RetaliateSystem = new System({
    name: 'Retaliate',
    events: [DamagedEvent],
    args: [DamagedEvent, AIConfigComponent, AIStateComponent,
        TargetComponent, Optional(GovernmentComponent), UUID, Entities,
        GetWorld] as const,
    step({ damage, damager, scale = 1 }, config, state, target, govt, uuid,
        entities, world: World) {
        if (!hasAI(config)) {
            return;
        }

        // The shooting ship: the damager itself, or its owner when the
        // damager is a projectile/beam/blast.
        const damagerEntity = entities.get(damager);
        const owner = damagerEntity?.components.get(OwnerComponent);
        const shooter = owner !== undefined
            ? entities.get(owner.owner) : damagerEntity;
        if (!shooter) {
            return;
        }

        const env = world.resources.get(MissionEnvResource);
        const shooterGovtId = shooter.components
            .get(GovernmentComponent)?.id ?? null;
        const shooterIsPlayer = shooter.components.has(PlayerShipSelector);
        const shooterIsPlayerOwned = shooterIsPlayer
            || entities.get(shooter.components.get(OwnerComponent)?.owner ?? "")
                ?.components.has(PlayerShipSelector) === true;
        const myOwner = entities.get(uuid)?.components
            .get(OwnerComponent)?.owner;
        const shooterOwner = shooter.components.get(OwnerComponent)?.owner;

        // Suppression cascade: any hit means the damage is ignored (no
        // target, no anger — the binary writes +0x96/+0x70 only when it
        // retaliates).
        const sameGovt = govt?.id != null && govt.id === shooterGovtId;
        const independentAmnesty = govt?.id == null && !shooterIsPlayerOwned;
        let playerStrayAmnesty = false;
        if (shooterIsPlayer) {
            const systemGovtId = env
                ?.system(world.resources.get(SystemIdResource) ?? "")
                ?.government ?? null;
            const crimeTol = env?.government(systemGovtId)?.crimeTol;
            const playerTarget = shooter.components.get(TargetComponent)?.target;
            // A pilot with no record entry for this government is clean
            // (record 0), so a crimeTol-0 system amnesties every stray hit.
            const record = systemGovtId === null ? 0
                : world.resources.get(PlayerStateResource)
                    ?.legalRecord[systemGovtId] ?? 0;
            playerStrayAmnesty = systemGovtId !== null
                && playerTarget !== uuid
                && crimeTol !== undefined
                && 2 * crimeTol <= record;
        }
        const sameOwner = (myOwner !== undefined && myOwner === shooterOwner)
            || (shooterIsPlayerOwned
                && entities.get(uuid)?.components.has(PlayerShipSelector) === true);
        const derelict = ((env?.government(govt?.id ?? null)?.flags ?? 0)
            & 0x800) !== 0;

        if (sameGovt || independentAmnesty || playerStrayAmnesty || sameOwner
            || derelict) {
            return;
        }

        // Different government: retaliate. The anger accumulates the
        // applied armor+shield damage (the port's DamagedEvent carries the
        // nominal WeaponDamage — closest available to the binary's sums).
        state.anger += damage.armor * scale + damage.shield * scale;
        state.attackedBy = shooter.uuid;
        target.target = shooter.uuid;
    },
});

// Target loss (TargetRemovedSystem fires when the target entity is
// deleted): the anger and the flee latch end with the target, and AI types
// 1-2 jump out instead of pursuing (FUN_00415b80/FUN_00410670, ported as a
// silent despawn — no NPC jump animation in this engine). Attack-state AI
// > 2 enters the pursuit-memory loiter instead (FUN_00405590 @0x4057f0:
// keep +0x70 for the rand(100)+100-frame attention window, PursuitMemory
// owns the rest) — fleeing ships (state 3) end with the target as before.
const TargetLostSystem = new System({
    name: 'TargetLost',
    events: [TargetRemovedEvent],
    args: [TargetRemovedEvent, AIConfigComponent, AIStateComponent,
        TargetComponent, TimeResource, UUID, Entities] as const,
    step(removed, config, state, target, time, uuid, entities) {
        if (!hasAI(config)) {
            return;
        }
        if (config.aiType > 2 && !state.fleeing) {
            state.lostTarget = removed;
            state.attentionUntil = time.time
                + (randInt(100) + 100) * 1000 / 30;
            return;
        }
        state.anger = 0;
        state.attackedBy = null;
        state.fleeing = false;
        state.destination = undefined;
        state.waitUntil = undefined;
        target.target = undefined;
        if (config.aiType <= 2) {
            entities.delete(uuid);
        }
    },
});

export const NpcAIPlugin: Plugin = {
    name: 'NpcAIPlugin',
    build(world) {
        world.addSystem(AggroRangeSystem);
        world.addSystem(InterceptorScanSystem);
        world.addSystem(TraderTravelSystem);
        world.addSystem(PursuitMemorySystem);
        world.addSystem(FleeSystem);
        world.addSystem(RetaliateSystem);
        world.addSystem(TargetLostSystem);
    },
    remove(world) {
        world.removeSystem(AggroRangeSystem);
        world.removeSystem(InterceptorScanSystem);
        world.removeSystem(TraderTravelSystem);
        world.removeSystem(PursuitMemorySystem);
        world.removeSystem(FleeSystem);
        world.removeSystem(RetaliateSystem);
        world.removeSystem(TargetLostSystem);
    }
};
