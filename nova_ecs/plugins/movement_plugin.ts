import * as t from 'io-ts';
import { Entities } from '../arg_types';
import { EntityMap } from '../entity_map';
import { Component } from '../component';
import { Angle, AngleType } from '../datatypes/angle';
import { Position, PositionType } from '../datatypes/position';
import { Vector, VectorLike, VectorType } from '../datatypes/vector';
import { Plugin } from '../plugin';
import { System } from '../system';
import { applyObjectDelta } from './delta';
import { DeltaPlugin, DeltaResource } from './delta_plugin';
import { Time, TimeResource, TimeSystem } from './time_plugin';


export enum MovementType {
    INERTIAL = 0,
    INERTIALESS = 1,
    STATIONARY = 2,
}

export const MovementPhysics = t.type({
    maxVelocity: t.number,
    turnRate: t.number,
    acceleration: t.number,
    movementType: t.union([
        t.literal(MovementType.INERTIAL),
        t.literal(MovementType.INERTIALESS),
        t.literal(MovementType.STATIONARY)]),
});
export type MovementPhysics = t.TypeOf<typeof MovementPhysics>;

export const MovementPhysicsComponent = new Component<MovementPhysics>('MovementPhysics');

export const MovementState = t.intersection([t.type({
    position: PositionType,
    velocity: VectorType,
    rotation: AngleType,
    turning: t.number,
    turnBack: t.boolean,
    accelerating: t.number,
}), t.partial({
    turnTo: t.union([AngleType, t.string /* target UUID */, t.null]),
    targetSpeed: t.number,
})]);
export type MovementState = t.TypeOf<typeof MovementState>;

// Don't split this into separate position and velocity components
// because we don't want to send predictable deltas, such as when
// an entity is moving in a straight line. When an unpredictable event happens,
// such as when a player accelerates, we send the full state.
export const MovementStateComponent = new Component<MovementState>('MovementState');

export const MovementSystem = new System({
    name: 'movement',
    args: [MovementStateComponent, MovementPhysicsComponent,
        TimeResource, Entities] as const,
    step(state, physics, time, entities) {
        if (physics.movementType === MovementType.INERTIAL) {
            inertialControls(state, physics, time, entities);
        } else if (physics.movementType === MovementType.INERTIALESS) {
            inertialessControls(state, physics, time, entities);
        }
    },
    after: [TimeSystem],
});

// The binary's global drag on living ships: velocity *= 0.995 every
// ~21ms frame (FUN_00433050, DAT_00575448; smoothed dt DAT_00735448), so
// unthrusted ships bleed speed instead of coasting forever. Expressed
// against delta_s so the port's frame rate doesn't change the decay.
export const DRAG = 0.995;
export const DRAG_FRAME_S = 0.021;

export function dragFactor(time: Time): number {
    return Math.pow(DRAG, time.delta_s / DRAG_FRAME_S);
}

// One axis of the binary's per-component thrust clamp (FUN_0043b4e0): the
// thrust delta advances the velocity component toward the clamp (the
// facing-projected max speed) and never past it. A component already
// beyond the clamp gets no thrust; drag wears it back down.
function advanceComponent(v: number, thrust: number, clamp: number): number {
    if (thrust > 0) {
        return v >= clamp ? v : Math.min(v + thrust, clamp);
    }
    if (thrust < 0) {
        return v <= clamp ? v : Math.max(v + thrust, clamp);
    }
    return v;
}

function inertialControls(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    handleTurning(state, physics, time, entities);

    state.velocity = state.velocity.scale(dragFactor(time));

    // Acceleration, clamped per velocity component toward facing * the
    // cruise cap so the ship cannot exceed its rated speed. The optional
    // targetSpeed is the binary's +0x34 cruise cap (0 when unset = free
    // thrust capped at maxVelocity); drag bleeds a faster ship back down
    // to it, which is how the binary decelerates a cruise approach.
    if (state.accelerating > 0) {
        const cap = state.targetSpeed !== undefined && state.targetSpeed > 0
            ? Math.min(state.targetSpeed, physics.maxVelocity)
            : physics.maxVelocity;
        const facing = state.rotation.getUnitVector();
        const thrust = state.accelerating * physics.acceleration * time.delta_s;
        const clamp = facing.scale(cap);
        state.velocity = new Vector(
            advanceComponent(state.velocity.x, facing.x * thrust, clamp.x),
            advanceComponent(state.velocity.y, facing.y * thrust, clamp.y));
    }
    state.velocity = state.velocity.shortenToLength(physics.maxVelocity);

    // Velocity
    // TODO: Make it so you don't have to cast
    state.position = state.position
        .add(state.velocity.scale(time.delta_s)) as Position;
}

function inertialessControls(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    handleTurning(state, physics, time, entities);

    const drag = dragFactor(time);
    state.velocity = state.velocity.scale(drag);

    if (state.targetSpeed === undefined) {
        state.targetSpeed = state.velocity.length;
    }

    // The cruise speed decays under the same drag (the binary's cruise
    // scalar +0x48 *= 0.995 per frame), so an unthrusted inertialess ship
    // slows down instead of coasting at its old speed.
    state.targetSpeed = state.targetSpeed * drag
        + state.accelerating * physics.acceleration * time.delta_s;
    state.targetSpeed = Math.min(state.targetSpeed, physics.maxVelocity);
    state.targetSpeed = Math.max(state.targetSpeed, 0);

    const targetVelocity = state.rotation.getUnitVector().scale(state.targetSpeed);
    state.velocity = approachVec(targetVelocity, state.velocity,
        physics.acceleration * time.delta_s * 2);
    updatePosition(state, time);
}

function updatePosition(state: MovementState, time: Time) {
    state.position = state.position
        .add(state.velocity.scale(time.delta_s)) as Position;
}
function handleTurning(state: MovementState, physics: MovementPhysics,
    time: Time, entities: EntityMap) {
    // Turning
    if (state.turnTo) {
        let angle: Angle | undefined;
        if (state.turnTo instanceof Angle) {
            angle = state.turnTo;
        } else {
            const otherPosition = entities.get(state.turnTo)
                ?.components.get(MovementStateComponent)?.position;
            if (otherPosition) {
                angle = otherPosition.subtract(state.position).angle;
            }
        }
        if (angle) {
            turnToAngle(state, physics, time, angle);
        }
    } else if (state.turnBack) {
        if (state.velocity.length > 0) {
            let reverseAngle = state.velocity.angle.add(Math.PI);
            turnToAngle(state, physics, time, reverseAngle);
        }
    }

    state.rotation = state.rotation
        .add(state.turning * physics.turnRate * time.delta_s);
}

export function approachVec<T extends Vector>(target: T, current: T, maxDelta: number): T {
    if (current.x === target.x && current.y === target.y) {
        return target;
    }
    const difference = target.subtract(current);
    if (difference.lengthSquared < maxDelta ** 1.2) {
        return target;
    }

    return current.add(difference.normalize().scale(maxDelta)) as T;
}

function turnToAngle(state: MovementState, physics: MovementPhysics,
    time: Time, target: Angle) {
    // Used for turning retrograde and pointing at a target
    let difference = state.rotation.distanceTo(target);

    // If we would turn past the target direction, just go to the target direction.
    if (physics.turnRate * time.delta_s > Math.abs(difference.angle)) {
        state.turning = 0;
        state.rotation = target;
    }
    else if (difference.angle > 0) {
        state.turning = 1;
    }
    else {
        state.turning = -1;
    }
}

export const MovementPlugin: Plugin = {
    name: 'MovementPlugin',
    build(world) {
        world.addPlugin(DeltaPlugin);
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        deltaMaker.addComponent(MovementStateComponent, {
            componentType: MovementState,
            deltaType: MovementState,
            getDelta(a, b) {
                // Omit position.
                // Send everything if a delta is detected.
                const same = a.turning === b.turning &&
                    a.accelerating === b.accelerating &&
                    a.turnTo === b.turnTo;

                if (same) {
                    return;
                }
                return b;
            },
            applyDelta: applyObjectDelta
        });

        deltaMaker.addComponent(MovementPhysicsComponent, {
            componentType: MovementPhysics
        });

        world.addComponent(MovementPhysicsComponent);
        world.addComponent(MovementStateComponent);
        world.addSystem(MovementSystem);
    }
};
