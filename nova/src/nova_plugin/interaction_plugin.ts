// Hail/board key wiring (P4/P5 of the ship-interaction layer): the 'hail'
// (KeyY) and 'board' (KeyB) control actions turn into HailEvent /
// BoardedEvent on the player's current target. This module is deliberately
// dumb plumbing — what answers a hail (a përs quote, the comm dialog,
// silence) and what boarding yields is decided by the event listeners
// (display/message_log.ts, display/comm_plugin.ts, and the boarding
// resolver + mission bookkeeping in mission_ship_plugin.ts's
// MissionShipBoardedSystem over missions/boarding.ts).
//
// Both systems follow the AttemptLandingSystem edge-detect pattern
// (planet_plugin.ts): only the 'start' edge fires, so holding the key does
// not re-trigger every repeat. While a modal dialog owns the keyboard its
// keys are swallowed via CommOpenResource — the Menu machinery unbinds its
// own reactions but the keyboard still feeds ControlStateEvent.

import { Emit, RunQuery, UUID } from "nova_ecs/arg_types";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { BOARD_PROXIMITY, isShipDisabled } from "../missions/mission_ship_goals";
import { ControlStateEvent } from "./control_state_event";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import { BoardedEvent, CommOpenResource, HailEvent } from "./interaction_events";
import { MissionShipComponent } from "./mission_ship_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ShipComponent } from "./ship_plugin";
import { TargetComponent } from "./target_component";

// The events and the dialog guard live in interaction_events.ts (a leaf
// module — mission_ship_plugin.ts listens for BoardedEvent and must not
// import this one); re-exported here for the hail/board consumers.
export { BoardedEvent, CommOpenResource, HailEvent };

const PlayerQuery = new Query([UUID, PlayerShipSelector,
    MovementStateComponent, TargetComponent] as const);
const ShipsQuery = new Query([UUID, ShipComponent, MovementStateComponent,
    Optional(ArmorComponent), Optional(ShieldComponent),
    Optional(MissionShipComponent)] as const);

const HailControlSystem = new System({
    name: 'HailControlSystem',
    events: [ControlStateEvent] as const,
    // SingletonComponent: run once per event, not once per entity.
    args: [ControlStateEvent, CommOpenResource, RunQuery, Emit,
        SingletonComponent] as const,
    step(controls, comm, runQuery, emit) {
        if (comm.open || controls.get('hail') !== 'start') {
            return;
        }
        // Any targeted ship can be hailed; what answers is up to the
        // listeners.
        const target = runQuery(PlayerQuery)[0]?.[3].target;
        if (target === undefined) {
            return;
        }
        const ship = runQuery(ShipsQuery).find(([uuid]) => uuid === target);
        if (ship) {
            emit(HailEvent, { target });
        }
    },
});

const BoardControlSystem = new System({
    name: 'BoardControlSystem',
    events: [ControlStateEvent] as const,
    // SingletonComponent: run once per event, not once per entity.
    args: [ControlStateEvent, CommOpenResource, RunQuery, Emit,
        SingletonComponent] as const,
    step(controls, comm, runQuery, emit) {
        if (comm.open || controls.get('board') !== 'start') {
            return;
        }
        const player = runQuery(PlayerQuery)[0];
        const target = player?.[3].target;
        if (!player || target === undefined) {
            return;
        }
        const ship = runQuery(ShipsQuery).find(([uuid]) => uuid === target);
        if (!ship) {
            return;
        }
        const [, , shipMovement, armor, shield, missionShip] = ship;

        // Boarding needs a dead-in-the-water target: the sticky mission-ship
        // disable latch (which survives stat regeneration) or the live
        // disable threshold.
        const disabled = missionShip?.disabled === true
            || isShipDisabled(armor ?? null, shield ?? null);
        if (!disabled) {
            return;
        }
        const distance = shipMovement.position
            .getClosestRelativeTo(player[2].position).length;
        if (distance > BOARD_PROXIMITY) {
            return;
        }
        emit(BoardedEvent, { target });
    },
});

export const InteractionPlugin: Plugin = {
    name: 'InteractionPlugin',
    build(world) {
        world.resources.set(CommOpenResource, { open: false });
        world.addSystem(HailControlSystem);
        world.addSystem(BoardControlSystem);
    },
};
