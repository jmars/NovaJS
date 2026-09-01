// Side-by-side trace specs for flight physics: the port's real MovementSystem
// (headless World, no TimePlugin — the TimeResource is controlled directly so
// the tick is deterministic) must reproduce the pure binary reference model
// (flight_model) over the same controlled time base. EV Nova flight has no
// LCG roll, so this is a trajectory comparison (position/velocity/rotation).
//
// Surfaces swept:
//   * inertial thrust to the cruise cap (per-component clamp, FUN_0043b4e0),
//   * inertial drag bleed (FUN_00433050),
//   * the +0x34 cruise cap (targetSpeed),
//   * inertialess cruise approach (targetSpeed evolution + approachVec),
//   * turning to an absolute angle and reverse (turnBack).
//
// Run:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/flight_trace_test.ts \
//       --outfile=/tmp/flight_trace_test.js \
//       && node_modules/.bin/jasmine /tmp/flight_trace_test.js

import "jasmine";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import {
    MovementPhysicsComponent,
    MovementStateComponent,
    MovementPlugin,
    MovementPhysics,
    MovementType,
} from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { flightStep, FlightState } from "./flight_model";

const DELTA_S = 1 / 60;   // one 60fps tick

function makeWorld(): World {
    const world = new World();
    world.resources.set(TimeResource,
        { time: 0, delta_s: DELTA_S, delta_ms: DELTA_S * 1000, frame: 0 });
    world.addPlugin(MovementPlugin);
    return world;
}

function makePhysics(overrides: Partial<MovementPhysics> = {}): MovementPhysics {
    return {
        maxVelocity: 100,
        turnRate: 2,
        acceleration: 50,
        movementType: MovementType.INERTIAL,
        ...overrides,
    };
}

function addShip(world: World, state: FlightState, physics: MovementPhysics):
    Entity {
    const ship = new Entity("ship");
    ship.components.set(MovementStateComponent, { ...state });
    ship.components.set(MovementPhysicsComponent, physics);
    world.entities.set(ship.name!, ship);
    return ship;
}

function portState(world: World): FlightState {
    const state = world.entities.get("ship")!
        .components.get(MovementStateComponent)!;
    return {
        position: state.position, velocity: state.velocity,
        rotation: state.rotation, turning: state.turning,
        turnBack: state.turnBack, accelerating: state.accelerating,
        turnTo: state.turnTo, targetSpeed: state.targetSpeed,
    };
}

// Runs the port's MovementSystem for `frames` controlled ticks, threading the
// model alongside, and asserts both leave the ship in the same state.
async function runTrajectory(state: FlightState, physics: MovementPhysics,
    frames: number, label: string): Promise<void> {
    const world = makeWorld();
    addShip(world, state, physics);
    let model: FlightState = {
        position: new Position(state.position.x, state.position.y),
        velocity: new Vector(state.velocity.x, state.velocity.y),
        rotation: new Angle(state.rotation.angle),
        turning: state.turning, turnBack: state.turnBack,
        accelerating: state.accelerating, turnTo: state.turnTo,
        targetSpeed: state.targetSpeed,
    };
    for (let i = 0; i < frames; i++) {
        world.step();
        const port = portState(world);
        model = flightStep(model, physics, { delta_s: DELTA_S });
        expect(round(port.position.x)).withContext(
            `${label} frame ${i + 1} pos.x`)
            .toEqual(round(model.position.x));
        expect(round(port.position.y)).withContext(
            `${label} frame ${i + 1} pos.y`)
            .toEqual(round(model.position.y));
        expect(round(port.velocity.x)).withContext(
            `${label} frame ${i + 1} vel.x`)
            .toEqual(round(model.velocity.x));
        expect(round(port.velocity.y)).withContext(
            `${label} frame ${i + 1} vel.y`)
            .toEqual(round(model.velocity.y));
        expect(round(port.rotation.angle)).withContext(
            `${label} frame ${i + 1} rot`)
            .toEqual(round(model.rotation.angle));
        expect(round(port.targetSpeed ?? 0)).withContext(
            `${label} frame ${i + 1} targetSpeed`)
            .toEqual(round(model.targetSpeed ?? 0));
    }
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

describe("flight trace vs reference model", () => {
    it("inertial thrust clamps velocity to the cruise cap", async () => {
        await runTrajectory({
            position: new Position(0, 0),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),   // facing +x
            turning: 0, turnBack: false, accelerating: 1,
        }, makePhysics(), 120, "thrust");
    });

    it("inertial drag bleeds an unthrusted ship toward rest", async () => {
        await runTrajectory({
            position: new Position(0, 0),
            velocity: new Vector(90, 30),
            rotation: new Angle(Math.PI / 4),
            turning: 0, turnBack: false, accelerating: 0,
        }, makePhysics(), 180, "drag");
    });

    it("respects the +0x34 cruise cap (targetSpeed) under thrust", async () => {
        await runTrajectory({
            position: new Position(0, 0),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            turning: 0, turnBack: false, accelerating: 1,
            targetSpeed: 40,   // below maxVelocity 100
        }, makePhysics(), 180, "cruise-cap");
    });

    it("inertialess cruise approaches the target velocity", async () => {
        await runTrajectory({
            position: new Position(0, 0),
            velocity: new Vector(10, 0),
            rotation: new Angle(0),
            turning: 0, turnBack: false, accelerating: 1,
        }, makePhysics({ movementType: MovementType.INERTIALESS }), 150,
        "inertialess");
    });

    it("turns to an absolute angle and snaps at the target", async () => {
        const target = new Angle(Math.PI / 2);   // 90° left of +x
        await runTrajectory({
            position: new Position(0, 0),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            turning: 0, turnBack: false, accelerating: 0,
            turnTo: target,
        }, makePhysics(), 60, "turn-to");
    });

    it("reverse (turnBack) turns toward the velocity tail", async () => {
        await runTrajectory({
            position: new Position(0, 0),
            velocity: new Vector(50, 0),
            rotation: new Angle(0),
            turning: 0, turnBack: true, accelerating: 0,
        }, makePhysics(), 60, "turn-back");
    });
});
