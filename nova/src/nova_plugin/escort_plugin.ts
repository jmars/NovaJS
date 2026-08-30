// The player's escort fleet in the ECS (Phase 3 of cargo+capture): the
// persistent model lives on PlayerState.fleet; the ship entities are
// rebuilt on every system-world build by SpawnEscortsSystem (the
// SpawnMissionShipsSystem pattern — a warp-in IS a world build), so escorts
// survive warps the same way mission ships do.
//
// Escorts have NO autonomous AI: the generic NPC AI components are stripped
// at spawn (no random targets — escorts must never fire on friendlies) and
// the escort systems below turn them toward the player, defend the player,
// and remove dead escorts from the fleet. EscortDefendSystem is the only
// thing that ever sets an escort target on its own, and only to the
// player's attacker; EscortOrdersSystem copies the player's explicit
// attack/defend commands onto them. The dumb generic NPC plumbing stays
// (FollowAI chases that defend target, ShootAllWeaponsAI fires on it,
// DeathAI deletes the corpse); everything that needs a brain
// (AIConfig/AIState/ChooseRandomTarget) is gone.
//
// Flagged deferral (Bible: only ships with inherentAI 1 or 2 can carry
// cargo when escorts): escorts carry no cargo in v1; hold space is the
// player ship's alone. Escort orders ('holdPosition'/'formation'/'attack'/
// 'defend' ControlActions) are handled by EscortOrdersSystem and persist
// on PlayerState.fleet via player/escort_ops.ts.

import { ShipData } from "novadatainterface/ShipData";
import { Entities, GetWorld, UUID } from "nova_ecs/arg_types";
import { AsyncSystem } from "nova_ecs/async_system";
import { Component } from "nova_ecs/component";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { EntityMap } from "nova_ecs/entity_map";
import { SingletonComponent, World } from "nova_ecs/world";
import { queuePlayerStateSave } from "../missions/mission_plugin";
import { EscortOrder, normalizeEscortOrder } from "../player/escort_ops";
import { PlayerStateResource } from "../player/player_state_component";
import { DamagedEvent, DeathEvent } from "./death_plugin";
import { makeDudeShip } from "./dude";
import { GameDataResource } from "./game_data_resource";
import { AIConfigComponent, AIStateComponent } from "./npc_ai_plugin";
import { ChooseRandomTargetComponent, DeathAISystem, FollowAI } from "./npc_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ControlStateEvent } from "./control_state_event";
import { TargetComponent } from "./target_component";

// Tags a ship entity as the persistent escort with this fleet id. shipType
// is redundant with ShipComponent.id but keeps the death path from needing
// a second component read; orders mirrors the fleet entry's persisted
// order (EscortOrdersSystem updates both together).
export const EscortComponent = new Component<{
    escortId: string;
    shipType: string;
    orders: EscortOrder;
}>('EscortComponent');

// How far an idle escort cruises behind the player before it accelerates
// (mirrors the trader arrival distance in npc_ai_plugin).
const FOLLOW_DISTANCE = 400;

const EscortsSpawnedResource = new Resource<{ val: boolean }>('EscortsSpawnedResource');

const PlayerQuery = new Query([UUID, MovementStateComponent,
    PlayerShipSelector] as const);
const EscortTargetQuery = new Query([UUID, TargetComponent] as const);
// Escorts with their target and fleet tag, for the order commands (the
// fleet tag maps an entity back to its persisted fleet entry).
const EscortsQuery = new Query([UUID, TargetComponent, EscortComponent] as const);

// One escort per fleet entry, at a fixed formation offset (deterministic —
// no rng: the same pilot fleet spawns identically on every warp-in).
const SpawnEscortsSystem = new AsyncSystem({
    name: 'SpawnEscortsSystem',
    args: [GameDataResource, Entities, GetWorld, EscortsSpawnedResource,
        SingletonComponent] as const,
    exclusive: true,
    async step(gameData, entities, world: World, spawned) {
        if (spawned.val) {
            world.removeSystem(SpawnEscortsSystem);
            return;
        }
        spawned.val = true;
        const state = world.resources.get(PlayerStateResource);
        if (!state) {
            return;
        }
        for (const [index, escort] of state.fleet.escorts.entries()) {
            let shipData: ShipData;
            try {
                shipData = await gameData.data.Ship.get(escort.shipType);
            }
            catch {
                console.warn(`[escorts] unknown shïp ${escort.shipType}`
                    + ` (escort ${escort.id})`);
                continue;
            }
            // No düde and no government: the escort answers to the player.
            const ship = makeDudeShip(null, shipData, null);

            // Strip the generic NPC AI: without AIConfig/AIState the
            // npc_ai systems skip the ship entirely, and without
            // ChooseRandomTarget it never picks its own fights.
            ship.components.delete(AIConfigComponent);
            ship.components.delete(AIStateComponent);
            ship.components.delete(ChooseRandomTargetComponent);

            ship.components.set(EscortComponent, {
                escortId: escort.id,
                shipType: escort.shipType,
                orders: normalizeEscortOrder(escort.orders),
            });
            ship.components.set(TargetComponent, { target: undefined });

            // makeShip seeds position/rotation from Math.random; overwrite
            // both so spawn is fully deterministic.
            const movement = ship.components.get(MovementStateComponent)!;
            movement.position = new Position(120 * (index + 1), 0);
            movement.rotation = new Angle(0);

            entities.set(`escort ${escort.id}`, ship);
        }
    },
});

// Idle escorts form up on the player: turn toward the player's ship and
// accelerate while beyond FOLLOW_DISTANCE. Runs after FollowAI so it
// overrides the generic chase (which accelerates unconditionally); a live
// defend target keeps FollowAI's pursuit instead, unless the escort is
// holding position — an explicit order always beats chasing. Escorts never
// acquire targets of their own — this, EscortDefendSystem and
// EscortOrdersSystem are their only target writers.
const EscortFollowSystem = new System({
    name: 'EscortFollowSystem',
    args: [EscortComponent, TargetComponent, MovementStateComponent,
        PlayerQuery, Entities] as const,
    after: [FollowAI],
    step(escort, target, movement, players, entities: EntityMap) {
        if (escort.orders === 'hold') {
            // Holding position: park (stop accelerating, stop turning
            // toward anything) and ignore even a live defend target.
            movement.accelerating = 0;
            movement.turnTo = undefined;
            return;
        }
        if (target.target !== undefined) {
            if (entities.has(target.target)) {
                return;  // Defending: FollowAI chases the attacker.
            }
            target.target = undefined;
        }
        const player = players[0];
        if (!player) {
            return;
        }
        movement.turnTo = player[0];
        movement.accelerating =
            player[1].position.subtract(movement.position).length
                > FOLLOW_DISTANCE ? 1 : 0;
    },
});

// The player's escort order keys (the stock ControlActions). On the
// key-down edge: 'holdPosition' orders every escort to hold and
// 'formation' back to follow (both persist on PlayerState.fleet so they
// survive warp and reload); 'attack' points every escort at the ship the
// player is targeting; 'defend' clears escort targets (EscortDefendSystem
// re-arms them when the player takes damage). Runs for the player ship
// (the PlayerShipSelector + TargetComponent args), same pattern as
// EscortDefendSystem.
const EscortOrdersSystem = new System({
    name: 'EscortOrdersSystem',
    events: [ControlStateEvent],
    args: [ControlStateEvent, UUID, PlayerShipSelector, TargetComponent,
        EscortsQuery, GetWorld] as const,
    step(controlState, _uuid, _selector, playerTarget, escorts, world: World) {
        const hold = controlState.get('holdPosition') === 'start';
        const formation = controlState.get('formation') === 'start';
        const attack = controlState.get('attack') === 'start';
        const defend = controlState.get('defend') === 'start';
        if (!hold && !formation && !attack && !defend) {
            return;
        }
        const state = world.resources.get(PlayerStateResource);
        let dirty = false;
        for (const [, target, escort] of escorts) {
            if (hold || formation) {
                const order: EscortOrder = hold ? 'hold' : 'follow';
                escort.orders = order;
                const entry = state?.fleet.escorts.find(candidate =>
                    candidate.id === escort.escortId);
                if (entry) {
                    // Entries written before orders existed already mean
                    // 'follow' — don't save just to make that explicit.
                    dirty = dirty
                        || normalizeEscortOrder(entry.orders) !== order;
                    entry.orders = order;
                }
            }
            if (attack) {
                target.target = playerTarget.target;
            }
            else if (defend) {
                target.target = undefined;
            }
        }
        if (dirty) {
            queuePlayerStateSave();
        }
    },
});

// An escort entity whose fleet entry is gone is a leftover (sold in the
// fleet dialog, or desynced) — remove it so a sold escort can't linger in
// the system it warped into. Runs every step; the fleet check is the same
// id match EscortDeathSystem uses.
const EscortReconcileSystem = new System({
    name: 'EscortReconcileSystem',
    args: [UUID, EscortComponent, Entities, GetWorld] as const,
    step(uuid, escort, entities: EntityMap, world: World) {
        const state = world.resources.get(PlayerStateResource);
        if (!state) {
            return;
        }
        if (!state.fleet.escorts.some(entry => entry.id === escort.escortId)) {
            entities.delete(uuid);
        }
    },
});

// The player took a hit: every escort turns on the attacker (the stock
// escort-defend behavior; RetaliateSystem is the per-ship equivalent but
// needs AIConfig, which escorts lack). The attacker never becomes a target
// when it is the player itself (self-damage) or one of this player's own
// escorts (crossfire) — no friendly fire.
const EscortDefendSystem = new System({
    name: 'EscortDefendSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, UUID, PlayerShipSelector, EscortTargetQuery] as const,
    step({ damager }, uuid, _selector, escorts) {
        if (damager === uuid
            || escorts.some(([escortUuid]) => escortUuid === damager)) {
            return;
        }
        for (const [, target] of escorts) {
            target.target = damager;
        }
    },
});

// A dead escort leaves the fleet (before DeathAISystem removes the entity,
// so the tag is still readable — the combat_rating_plugin death-ordering
// pattern; both systems delete the entity).
export const EscortDeathSystem = new System({
    name: 'EscortDeathSystem',
    events: [DeathEvent],
    args: [DeathEvent, UUID, Entities, EscortComponent, GetWorld] as const,
    before: [DeathAISystem],
    step(_event, uuid, entities, escort, world: World) {
        entities.delete(uuid);
        const state = world.resources.get(PlayerStateResource);
        if (!state) {
            return;
        }
        const index = state.fleet.escorts.findIndex(entry =>
            entry.id === escort.escortId);
        if (index === -1) {
            return;
        }
        state.fleet.escorts.splice(index, 1);
        queuePlayerStateSave();
    },
});

export const EscortPlugin: Plugin = {
    name: 'EscortPlugin',
    build(world) {
        world.resources.set(EscortsSpawnedResource, { val: false });
        world.addSystem(SpawnEscortsSystem);
        world.addSystem(EscortFollowSystem);
        world.addSystem(EscortOrdersSystem);
        world.addSystem(EscortDefendSystem);
        world.addSystem(EscortDeathSystem);
        world.addSystem(EscortReconcileSystem);
    },
};
