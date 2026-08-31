// Distinct düde AIType 1-4 behavior, ported from the binary's AI state
// machine (FUN_0040e020 acquisition, FUN_004192d0 retaliation, FUN_00402e50
// decisions, FUN_0040c790 travel): traders (1/2) travel between planets and
// jump out when they lose a target, warships (3) and interceptors (4)
// acquire targets through a strength-scaled odds filter (no radius), an AI
// ship retaliates against ANY different-government attacker subject to the
// suppression cascade, and ships flee on low shields while their target
// lives.
//
// The combat building blocks stay in npc_plugin: these systems only set
// TargetComponent and movement/weapon state, and run after FollowAI /
// ShootAllWeaponsAI so they can override the generic chase-and-shoot AI
// each step.

import { Entities, GetWorld, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { EntityMap } from "nova_ecs/entity_map";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementState, MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { GovernmentData } from "novadatainterface/GovernmentData";
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
// post-arrival wait (+0x4c).
export const AIStateComponent = new Component<{
    anger: number,
    attackedBy: string | null,
    fleeing: boolean,
    destination?: string,
    waitUntil?: number,
}>('AIState');

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
    // FUN_00462410: the spöb's radius is its sprite half-size (engine
    // default 0x96 = 150); the arrival test is |dx|,|dy| ≤ radius/4.
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
// rand(16) over the current system's 16 spöb slots, retried until the
// drawn spöb is a candidate. Candidates sit on the map (|x|,|y| < 1000,
// the spöb table +4/+6 test) and are not hostile to my government. The
// binary loops unbounded; the port bounds the draws (a null return sends
// the trader to the FUN_00415b80 jump-out). The govt-flags2
// (0x80/0x40/0x20) spöb-category preferences are omitted — PlanetData
// carries no raw spöb flags2.
const TRAVEL_DRAW = 16;
const TRAVEL_DRAW_LIMIT = 1000;

type PlanetEntry = readonly [string, MovementState, { id: string },
    { govt: string | null } | undefined];

function drawDestination(movement: MovementState,
    govtId: string | null | undefined, world: World,
    planets: Array<PlanetEntry>): string | null {
    const env = world.resources.get(MissionEnvResource);
    const mine = env?.government(govtId ?? null) ?? null;
    const candidates = planets
        .filter(([, planetMovement]) =>
            Math.abs(planetMovement.position.x) < 1000
            && Math.abs(planetMovement.position.y) < 1000)
        .filter(([, , , planetData]) => {
            const theirs = planetData
                ? env?.government(planetData.govt) ?? null : null;
            return !govtsHostile(mine, theirs, mine?.id, theirs?.id);
        })
        .map(([planetUuid]) => planetUuid);
    for (let draw = 0; draw < TRAVEL_DRAW_LIMIT; draw++) {
        const idx = randInt(TRAVEL_DRAW);
        if (idx < candidates.length) {
            return candidates[idx];
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
        PlayerQuery] as const,
    step(config, target, movement, uuid, govt, entities, world: World,
        players) {
        if (!hasAI(config)) {
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

// Idle AI ships cruise between the system's planets (FUN_00405590 state 1):
// a rejection-drawn destination, a square radius/4 arrival test, a
// rand(200)+300-frame wait on arrival, and a re-decide that LANDS
// (despawns) the trader when the drawn destination is the spöb it is
// parked at (binary state 0x14).
const TraderTravelSystem = new System({
    name: 'TraderTravel',
    args: [AIConfigComponent, AIStateComponent, TargetComponent,
        MovementStateComponent, TimeResource, UUID, Entities,
        Optional(ArmorComponent), Optional(ShieldComponent),
        Optional(GovernmentComponent), GetWorld, PlanetsQuery] as const,
    after: [AggroRangeSystem, FollowAI],
    step(config, state, target, movement, time, uuid, entities, armor,
        shield, govt, world: World, planets) {
        if (!hasAI(config) || state.fleeing || isDeadInSpace(armor, shield)) {
            return;
        }
        if (target.target !== undefined && entities.has(target.target)) {
            // Busy with a live target (fighting back or hunting):
            // FollowAI handles the movement.
            return;
        }
        target.target = undefined;

        // Parked at a spöb, waiting out the arrival wait (+0x4c =
        // rand(200)+300 frames) before the next decision.
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
            // Arrived: park and wait, then re-decide (state 0).
            movement.accelerating = 0;
            state.destination = undefined;
            state.waitUntil = time.time + (randInt(200) + 300) * 1000 / 30;
            return;
        }

        // Re-decide (FUN_0040c790 + FUN_00402e50 state 0): draw a
        // destination; drawing the spöb we are parked at means LAND
        // (state 0x14 — the trader despawns into the planet).
        const destination = drawDestination(movement, govt?.id, world,
            planets);
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
// silent despawn — no NPC jump animation in this engine). Types 3-4 just
// re-decide through AggroRange.
const TargetLostSystem = new System({
    name: 'TargetLost',
    events: [TargetRemovedEvent],
    args: [TargetRemovedEvent, AIConfigComponent, AIStateComponent,
        TargetComponent, UUID, Entities] as const,
    step(_removed, config, state, target, uuid, entities) {
        if (!hasAI(config)) {
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
        world.addSystem(TraderTravelSystem);
        world.addSystem(FleeSystem);
        world.addSystem(RetaliateSystem);
        world.addSystem(TargetLostSystem);
    },
    remove(world) {
        world.removeSystem(AggroRangeSystem);
        world.removeSystem(TraderTravelSystem);
        world.removeSystem(FleeSystem);
        world.removeSystem(RetaliateSystem);
        world.removeSystem(TargetLostSystem);
    }
};
