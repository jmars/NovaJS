// Pure reference model of the binary's flight physics, for a side-by-side
// trace harness (flight_trace_test.ts): a deterministic numeric model of one
// movement tick (the port's nova_ecs/plugins/movement_plugin.ts MovementSystem)
// that the port must reproduce exactly over a controlled time base. EV Nova
// flight has no LCG roll, so this is a trajectory comparison, not an
// LCG-stream fingerprint.
//
// The modelled surface (all from the binary via Ghidra):
//   * global drag on living ships: velocity *= 0.995 every ~21ms frame
//     (FUN_00433050, DAT_00575448; smoothed dt DAT_00735448), expressed
//     against delta_s so frame rate does not change the decay.
//   * per-component thrust clamp (FUN_0043b4e0): the thrust delta advances a
//     velocity component toward the facing-projected cruise cap and never
//     past it; a component already beyond the cap gets no thrust and drag
//     bleeds it back.
//   * the optional +0x34 cruise cap (targetSpeed): thrust caps at it; drag
//     bleeds a faster ship down to it. Inertialess ships evolve targetSpeed
//     under the same drag and approach the target velocity (cruise scalar
//     +0x48 *= 0.995 per frame).
//
// The model is pure (no ECS, no mutation): flightStep returns the state the
// port's MovementSystem should leave behind.

import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import {
    MovementPhysics,
    MovementType,
} from "nova_ecs/plugins/movement_plugin";

export interface FlightTime {
    delta_s: number;
}

export interface FlightState {
    position: Position;
    velocity: Vector;
    rotation: Angle;
    turning: number;
    turnBack: boolean;
    accelerating: number;
    turnTo?: Angle | string | null;
    targetSpeed?: number;
}

// FUN_00433050's global drag: velocity *= DRAG every DRAG_FRAME_S seconds.
export const DRAG = 0.995;
export const DRAG_FRAME_S = 0.021;

export function dragFactor(delta_s: number): number {
    return Math.pow(DRAG, delta_s / DRAG_FRAME_S);
}

// FUN_0043b4e0's per-component thrust clamp.
export function advanceComponent(v: number, thrust: number, clamp: number):
    number {
    if (thrust > 0) {
        return v >= clamp ? v : Math.min(v + thrust, clamp);
    }
    if (thrust < 0) {
        return v <= clamp ? v : Math.max(v + thrust, clamp);
    }
    return v;
}

// The bounded approach toward a target velocity (cruise control).
export function approachVec(target: Vector, current: Vector, maxDelta: number):
    Vector {
    if (current.x === target.x && current.y === target.y) {
        return target;
    }
    const difference = target.subtract(current);
    if (difference.lengthSquared < maxDelta ** 1.2) {
        return target;
    }
    return current.add(difference.normalize().scale(maxDelta)) as Vector;
}

// Turning toward an absolute angle (the port's turnToAngle), reading and
// setting the turning sign and snapping when the target is within reach.
export interface TurnResult {
    turning: number;
    rotation: Angle;
}
export function turnToAngle(rotation: Angle, turnRate: number, delta_s: number,
    target: Angle): TurnResult {
    const difference = rotation.distanceTo(target);
    if (turnRate * delta_s > Math.abs(difference.angle)) {
        return { turning: 0, rotation: target };
    }
    return {
        turning: difference.angle > 0 ? 1 : -1,
        rotation,
    };
}

// One movement tick, reproducing the port's MovementSystem for a ship whose
// turnTo is an absolute Angle (the trace never resolves an entity target) or
// a turnBack reverse. Returns the new state without mutating the input.
export function flightStep(state: FlightState, physics: MovementPhysics,
    time: FlightTime): FlightState {
    let { turning, rotation } = state;
    let turnTo = state.turnTo;
    if (turnTo) {
        if (turnTo instanceof Angle) {
            const result = turnToAngle(rotation, physics.turnRate,
                time.delta_s, turnTo);
            turning = result.turning;
            rotation = result.rotation;
        }
    }
    else if (state.turnBack) {
        if (state.velocity.length > 0) {
            const reverseAngle = state.velocity.angle.add(Math.PI);
            const result = turnToAngle(rotation, physics.turnRate,
                time.delta_s, reverseAngle);
            turning = result.turning;
            rotation = result.rotation;
        }
    }
    rotation = rotation.add(turning * physics.turnRate * time.delta_s);

    const drag = dragFactor(time.delta_s);
    let velocity = state.velocity.scale(drag);

    if (physics.movementType === MovementType.INERTIAL) {
        if (state.accelerating > 0) {
            const cap = state.targetSpeed !== undefined && state.targetSpeed > 0
                ? Math.min(state.targetSpeed, physics.maxVelocity)
                : physics.maxVelocity;
            const facing = rotation.getUnitVector();
            const thrust = state.accelerating * physics.acceleration
                * time.delta_s;
            const clamp = facing.scale(cap);
            velocity = new Vector(
                advanceComponent(velocity.x, facing.x * thrust, clamp.x),
                advanceComponent(velocity.y, facing.y * thrust, clamp.y));
        }
        velocity = velocity.shortenToLength(physics.maxVelocity);
    }
    else if (physics.movementType === MovementType.INERTIALESS) {
        // The port seeds targetSpeed from the DRAGGED velocity length when
        // unset (state.velocity = velocity.scale(drag) runs first).
        let targetSpeed = state.targetSpeed ?? velocity.length;
        targetSpeed = targetSpeed * drag
            + state.accelerating * physics.acceleration * time.delta_s;
        targetSpeed = Math.min(targetSpeed, physics.maxVelocity);
        targetSpeed = Math.max(targetSpeed, 0);
        const targetVelocity = rotation.getUnitVector().scale(targetSpeed);
        velocity = approachVec(targetVelocity, velocity,
            physics.acceleration * time.delta_s * 2);
        return {
            position: state.position
                .add(velocity.scale(time.delta_s)) as Position,
            velocity, rotation, turning, turnBack: state.turnBack,
            accelerating: state.accelerating, turnTo: state.turnTo,
            targetSpeed,
        };
    }

    return {
        position: state.position.add(velocity.scale(time.delta_s)) as Position,
        velocity, rotation, turning, turnBack: state.turnBack,
        accelerating: state.accelerating, turnTo: state.turnTo,
        targetSpeed: state.targetSpeed,
    };
}
