// Distinct düde AIType 1-4 behavior (Phase 2 of the ship-interaction
// layer): traders (1/2) travel between planets, ships with a Coward
// threshold flee once hurt, warships (3) and interceptors (4) acquire
// targets inside their Aggress range, and any AI ship retaliates against
// its last attacker (latched for the brave-trader fight-back and the përs
// grudge system in phase 3).
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
import { MissionEnvResource } from "../missions/mission_plugin";
import { govtsAreEnemies } from "../player/legal_status";
import { DamagedEvent } from "./death_plugin";
import { FollowAI, GovernmentComponent, playerIsHostile, ShootAllWeaponsAI } from "./npc_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { PlanetComponent } from "./planet_plugin";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import { ShipComponent } from "./ship_plugin";
import { Stat } from "./stat";
import { TargetComponent } from "./target_component";
import { WeaponsStateComponent } from "./weapons_state";

// AIType 0 means "no special AI" (the legacy random-target behavior).
export const AIConfigComponent = new Component<{
    aiType: number,
    aggress: number,
    coward: number | null,  // % of shields below which the ship flees
}>('AIConfig');

// Per-ship AI latch state. `fled` is sticky: once a cowardly ship turns
// tail it never re-engages. (Brave traders are supposed to un-flee once
// the attacker is out of range — approximated here as flee-once-and-stay;
// refine when a threat-radius check lands.) `attackedBy` records the last
// attacker for the fight-back/grudge systems.
export const AIStateComponent = new Component<{
    fled: boolean,
    attackedBy: string | null,
    nextTravelTime?: number,
}>('AIState');

// Destination re-roll timer, mirroring ChooseRandomTargetComponent, plus
// the close-approach distance that counts as "arrived".
const TRAVEL_INTERVAL = 10_000;
const ARRIVAL_DISTANCE = 400;

// Aggress 0-4: how far away the ship looks for targets (position units).
// The Bible documents aggress 1-3 as [1000, 3000, 8000]; 0 clamps low
// and 4 clamps high.
const AGGRESS_RADII = [1000, 1000, 3000, 8000, 8000];

function hasAI(config: { aiType: number }): boolean {
    return config.aiType >= 1 && config.aiType <= 4;
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

const PlanetsQuery = new Query([UUID, MovementStateComponent, PlanetComponent] as const);
const ShipsQuery = new Query([UUID, MovementStateComponent, ShipComponent,
    Optional(GovernmentComponent)] as const);
const PlayerQuery = new Query([UUID, MovementStateComponent, PlayerShipSelector] as const);

function isArrived(movement: MovementState, entities: EntityMap): boolean {
    if (typeof movement.turnTo !== 'string') {
        return false;
    }
    const destination = entities.get(movement.turnTo)
        ?.components.get(MovementStateComponent);
    if (!destination) {
        return false;
    }
    return destination.position.subtract(movement.position).length
        < ARRIVAL_DISTANCE;
}

// Warships (3) acquire enemy-govt ships inside the Aggress radius;
// interceptors (4) prefer the player. Neither attacks a neutral player on
// sight: the player only counts as a target once the NPC's government
// considers them a criminal (legalRecord below -crimeTol, the same
// hostility test smuggling's scan gate uses). Outside the radius they
// wander like traders. The MissionEnv (govt graph) is the same resource
// legal_status uses, so it may be absent. (Exported because pers_plugin's
// grudge targeting must run after it.)
export const AggroRangeSystem = new System({
    name: 'AggroRange',
    args: [AIConfigComponent, TargetComponent, MovementStateComponent, UUID,
        Optional(GovernmentComponent), Entities, GetWorld,
        ShipsQuery, PlayerQuery] as const,
    step(config, target, movement, uuid, govt, entities, world: World,
        ships, players) {
        if (config.aiType !== 3 && config.aiType !== 4) {
            return;
        }
        if (target.target !== undefined && entities.has(target.target)) {
            // Keep chasing the current target; TargetRemovedSystem clears
            // the reference when it dies or leaves.
            return;
        }
        target.target = undefined;

        const radius = AGGRESS_RADII[config.aggress] ?? AGGRESS_RADII[2];
        const radiusSquared = radius * radius;
        let enemy: string | undefined;
        let enemyDistance = Infinity;
        for (const [candidate, candidateMovement, , candidateGovt] of ships) {
            if (candidate === uuid) {
                continue;
            }
            const distance = candidateMovement.position
                .subtract(movement.position).lengthSquared;
            if (distance > radiusSquared) {
                continue;
            }
            if (govt?.id && candidateGovt?.id) {
                const env = world.resources.get(MissionEnvResource);
                const mine = env?.government(govt.id);
                const theirs = env?.government(candidateGovt.id);
                if (mine && theirs && govtsAreEnemies(mine, theirs)
                    && distance < enemyDistance) {
                    enemy = candidate;
                    enemyDistance = distance;
                }
            }
        }
        const player = players[0]?.[0];
        const playerInRange = players.some(([candidate, candidateMovement]) =>
            candidate !== uuid
            && candidateMovement.position.subtract(movement.position)
                .lengthSquared <= radiusSquared);

        // The player is only a fallback target when genuinely hostile to
        // the NPC's government; an NPC with no government (or one the env
        // can't resolve) never auto-targets the player.
        let hostilePlayer: string | undefined;
        if (player !== undefined && playerInRange
            && playerIsHostile(govt?.id, world)) {
            hostilePlayer = player;
        }

        // Interceptors go for the player first; warships prefer enemy ships.
        if (config.aiType === 4) {
            target.target = hostilePlayer ?? enemy;
        } else {
            target.target = enemy ?? hostilePlayer;
        }
    },
});

// Idle ships (traders, and warships with nothing in range) cruise between
// the system's planets.
const TraderTravelSystem = new System({
    name: 'TraderTravel',
    args: [AIConfigComponent, AIStateComponent, TargetComponent,
        MovementStateComponent, TimeResource, UUID, Entities,
        Optional(ArmorComponent), Optional(ShieldComponent),
        PlanetsQuery] as const,
    after: [AggroRangeSystem, FollowAI],
    step(config, state, target, movement, time, uuid, entities, armor,
        shield, planets) {
        if (!hasAI(config) || state.fled || isDeadInSpace(armor, shield)) {
            return;
        }
        if (target.target !== undefined && entities.has(target.target)) {
            // Busy with a live target (fighting back or hunting):
            // FollowAI handles the movement.
            return;
        }
        target.target = undefined;

        if ((state.nextTravelTime ?? 0) > time.time && movement.turnTo != null
            && !isArrived(movement, entities)) {
            movement.accelerating = 1;
            return;
        }

        const destinations = planets.map(([planetUuid]) => planetUuid)
            .filter(planetUuid => planetUuid !== uuid);
        if (destinations.length === 0) {
            movement.turnTo = null;
            return;
        }
        movement.turnTo = destinations[
            Math.floor(Math.random() * destinations.length)];
        movement.accelerating = 1;
        state.nextTravelTime = time.time + TRAVEL_INTERVAL;
    },
});

// Ships with a Coward threshold run once their shields drop below it, and
// stay fled (sticky latch). Overriding after FollowAI / ShootAllWeaponsAI
// undoes their chase-and-shoot every step.
const FleeSystem = new System({
    name: 'Flee',
    args: [AIConfigComponent, AIStateComponent, TargetComponent,
        MovementStateComponent, Optional(ShieldComponent),
        Optional(ArmorComponent), Optional(WeaponsStateComponent)] as const,
    after: [FollowAI, ShootAllWeaponsAI, TraderTravelSystem],
    step(config, state, target, movement, shield, armor, weapons) {
        if (config.coward === null || isDeadInSpace(armor, shield)) {
            return;
        }
        if (!state.fled) {
            const shieldPercent = shield && shield.max > 0
                ? shield.current / shield.max * 100 : 100;
            if (shieldPercent >= config.coward) {
                return;
            }
            state.fled = true;
        }
        movement.turnTo = null;
        movement.turnBack = true;
        movement.accelerating = 1;
        target.target = undefined;
        if (weapons) {
            for (const [, weapon] of weapons) {
                weapon.firing = false;
            }
        }
    },
});

// Damaged ships turn on their attacker. Cowardly ships override this in
// FleeSystem; everyone else keeps the grudge in `attackedBy` (phase 3
// reads it for the përs grudge).
const RetaliateSystem = new System({
    name: 'Retaliate',
    events: [DamagedEvent],
    args: [DamagedEvent, AIConfigComponent, AIStateComponent,
        TargetComponent] as const,
    step({ damager }, config, state, target) {
        if (!hasAI(config)) {
            return;
        }
        state.attackedBy = damager;
        target.target = damager;
    },
});

export const NpcAIPlugin: Plugin = {
    name: 'NpcAIPlugin',
    build(world) {
        world.addSystem(AggroRangeSystem);
        world.addSystem(TraderTravelSystem);
        world.addSystem(FleeSystem);
        world.addSystem(RetaliateSystem);
    },
    remove(world) {
        world.removeSystem(AggroRangeSystem);
        world.removeSystem(TraderTravelSystem);
        world.removeSystem(FleeSystem);
        world.removeSystem(RetaliateSystem);
    }
};
