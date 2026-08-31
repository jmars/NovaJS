import 'jasmine';
import { v4 } from 'uuid';
import { Angle } from '../datatypes/angle';
import { Position } from '../datatypes/position';
import { Vector, VectorLike } from '../datatypes/vector';
import { Entity } from '../entity';
import { System } from '../system';
import { World } from '../world';
import { approachVec, dragFactor, DRAG, MovementPhysicsComponent, MovementPlugin, MovementStateComponent, MovementSystem, MovementType } from './movement_plugin';
import { TimePlugin } from './time_plugin';

describe('Movement Plugin', () => {
    let world: World;
    let clock: jasmine.Clock;
    beforeEach(() => {
        clock = jasmine.clock();
        clock.install();
        clock.mockDate(new Date(100));

        world = new World();
        world.addPlugin(TimePlugin);
        world.addPlugin(MovementPlugin);
    });

    afterEach(() => {
        clock.uninstall();
    });

    it('updates position', () => {
        const velocity = new Vector(10, -7);

        world.entities.set(v4(), new Entity()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 0,
                rotation: new Angle(0),
                turnBack: false,
                turning: 0,
                velocity,
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));


        const positions: Position[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                // Copy the position since it's a draft
                // TODO: Why doe TypeScript think it's a vector and not a position?
                positions.push(state.position.scale(1) as Position);
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        clock.tick(1000);
        world.step();

        // The binary's global drag bleeds the coasting velocity each step.
        const drag = dragFactor({ time: 1100, delta_s: 1, delta_ms: 1000, frame: 1 });
        expect(positions).toEqual([
            Position.fromVectorLike(velocity.scale(0)),
            Position.fromVectorLike(velocity.scale(drag)),
        ]);
    });

    it('updates velocity', () => {
        const rotation = new Angle(Math.PI / 4);
        world.entities.set(v4(), new Entity()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 1,
                rotation: rotation,
                turnBack: false,
                turning: 0,
                velocity: new Vector(0, 0),
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));


        const velocities: Vector[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                // Copy the position since it's a draft
                velocities.push(state.velocity.scale(1));
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        clock.tick(1000);
        world.step();

        // Inverted clock angles. See ../dataTypes/angle.ts.
        expect(velocities).toEqual([
            new Vector(0, 0),
            new Vector(100 * Math.sin(rotation.angle), -100 * Math.cos(rotation.angle))
        ]);
    });

    it('drags unthrusted ships toward a stop', () => {
        world.entities.set(v4(), new Entity()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 0,
                rotation: new Angle(0),
                turnBack: false,
                turning: 0,
                velocity: new Vector(100, 0),
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));

        const velocities: Vector[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                velocities.push(state.velocity.scale(1));
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        // One ~21ms frame of the binary's 0.995 per-frame drag.
        clock.tick(21);
        world.step();

        expect(velocities[1].x).toBeCloseTo(100 * DRAG);
        expect(velocities[1].y).toEqual(0);
    });

    it('clamps thrust per velocity component toward the facing-projected max speed', () => {
        // Coasting at max speed "north" (clock angle 0 = -y) while
        // thrusting at 45°: the -y component is already past the
        // facing-projected max speed, so it gets no thrust (only drag),
        // while +x builds toward facing.x * maxVelocity.
        const drag = dragFactor({ time: 0, delta_s: 0.5, delta_ms: 500, frame: 1 });
        world.entities.set(v4(), new Entity()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 1,
                rotation: new Angle(Math.PI / 4),
                turnBack: false,
                turning: 0,
                velocity: new Vector(0, -500),
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));

        const velocities: Vector[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                velocities.push(state.velocity.scale(1));
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        clock.tick(500);
        world.step();

        expect(velocities[1].x).toBeCloseTo(100 * 0.5 * Math.sin(Math.PI / 4));
        expect(velocities[1].y).toBeCloseTo(-500 * drag);
    });

    it('caps thrust at the cruise targetSpeed when one is set', () => {
        // The binary's +0x34 cruise cap: thrust advances the component
        // toward facing * targetSpeed, not facing * maxVelocity.
        world.entities.set(v4(), new Entity()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 1,
                rotation: new Angle(Math.PI / 2),
                turnBack: false,
                turning: 0,
                targetSpeed: 60,
                velocity: new Vector(0, 0),
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));

        const velocities: Vector[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                velocities.push(state.velocity.scale(1));
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        clock.tick(1000);
        world.step();

        // Facing +x (clock angle pi/2); 100 px/s of thrust caps at 60.
        expect(velocities[1].x).toBeCloseTo(60);
        expect(velocities[1].y).toBeCloseTo(0);
    });

    it('updates rotation', () => {
        world.entities.set(v4(), new Entity()
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                accelerating: 1,
                rotation: new Angle(0),
                turnBack: false,
                turning: 1,
                velocity: new Vector(0, 0),
            })
            .addComponent(MovementPhysicsComponent, {
                acceleration: 100,
                maxVelocity: 500,
                turnRate: 50,
                movementType: MovementType.INERTIAL,
            }));


        const rotations: number[] = [];
        const reportSystem = new System({
            name: 'ReportSystem',
            args: [MovementStateComponent],
            step: (state) => {
                // Copy the position since it's a draft
                rotations.push(state.rotation.angle);
            },
            after: [MovementSystem],
        });
        world.addSystem(reportSystem);

        world.step();
        clock.tick(1000);
        world.step();

        expect(rotations).toEqual([
            0,
            new Angle(50).angle,
        ]);
    });

    it('approachVec approaches a target vector', () => {
        // 3,4,5 triangle for nice numbers
        const current = new Vector(1, 1);
        const target = current.add(new Vector(3, 4).scale(4));

        const res = approachVec(target, current, 5 * 2);
        const expected = current.add(new Vector(3, 4).scale(2));
        expect(res.x).toBeCloseTo(expected.x);
        expect(res.y).toBeCloseTo(expected.y);
    });
});
