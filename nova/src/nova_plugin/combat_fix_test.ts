// Headless specs for the audited combat-damage divergences (binary
// evidence in docs/FIDELITY.md + the combat audit): the -10% max shield
// floor (FUN_004192d0, DAT_00575208), beam damage decay (FUN_00435830 /
// FUN_00437780), the square blast range (FUN_00435830 splash loop), the
// player-only self-blast rule, projectile blast double-dip, and the
// moving-toward projectile hit gate (FUN_0042f270) that replaced the
// unverified proxSafety launch window. Like neutral_player_gate_test.ts,
// the worlds emit CollisionEvents directly (the collision pipeline is not
// under test — the damage emission is). Run with:
//   npx esbuild --bundle --platform=node \
//       nova/src/nova_plugin/combat_fix_test.ts \
//       --outfile=/tmp/combat_fix_test.js \
//       && node_modules/.bin/jasmine /tmp/combat_fix_test.js

import "jasmine";
import * as SAT from "sat";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import {
    getDefaultBeamWeaponData,
    getDefaultProjectileWeaponData,
    ProjectileWeaponData,
} from "novadatainterface/WeaponData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { DeltaPlugin } from "nova_ecs/plugins/delta_plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { BlastDamageComponent, BlastPlugin } from "./blast_plugin";
import { BeamDataComponent, BeamPlugin } from "./beam_plugin";
import { CollisionEvent, CollisionHitterComponent } from "./collision_interaction";
import { CompositeHull, HurtboxHullComponent } from "./collisions_plugin";
import { CreateTime } from "./create_time";
import { DamagedEvent, DeathPlugin } from "./death_plugin";
import { FireSubs, OwnerComponent, WeaponConstructors } from "./fire_weapon_plugin";
import { ArmorComponent, HealthPlugin, ShieldComponent } from "./health_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ProjectileBlastHull, ProjectileDataComponent } from "./projectile_data";
import { ProjectileExplodeEvent, ProjectilePlugin, squareBlastHull } from "./projectile_plugin";
import {
    ShipComponent,
    ShipDataComponent,
    ShipPhysicsComponent,
    ShipPlugin,
} from "./ship_plugin";
import { Stat } from "./stat";
import { GameDataResource } from "./game_data_resource";

const FLOOR_DAMAGE = {
    shield: 150, armor: 0, ionization: 0, ionizationColor: 0,
    passThroughShield: 0, knockback: 0,
};

const DAMAGE = {
    shield: 10, armor: 5, ionization: 0, ionizationColor: 0,
    passThroughShield: 0, knockback: 0,
};

const PROJECTILE: ProjectileWeaponData = {
    ...getDefaultProjectileWeaponData(),
    id: "nova:1500",
    name: "Test Projectile",
    damage: DAMAGE,
};

const BEAM = {
    ...getDefaultBeamWeaponData(),
    id: "nova:1501",
    name: "Test Beam",
    damage: DAMAGE,
    shotDuration: 100000,
};

function makeWorld(): World {
    const world = new World();
    world.resources.set(GameDataResource, new MockGameData());
    world.resources.set(WeaponConstructors, new Map());
    // FireSubs is a resource dependency of the projectile systems; without
    // it ProjectilePlugin.build aborts with a swallowed async rejection.
    world.resources.set(FireSubs, () => []);
    world.resources.set(TimeResource,
        { time: 1000, delta_ms: 16, delta_s: 0.016, frame: 1 });
    world.addPlugin(ProjectilePlugin);
    world.addPlugin(BeamPlugin);
    world.addPlugin(BlastPlugin);
    world.addPlugin(DeathPlugin);
    return world;
}

function addFighter(world: World, name: string, position?: Position,
    shieldCurrent = 100): Entity {
    const ship = new Entity(name);
    ship.components.set(MovementStateComponent, {
        position: position ?? new Position(0, 0),
        rotation: new Angle(0),
        velocity: new Vector(0, 0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    });
    ship.components.set(ShieldComponent,
        new Stat({ current: shieldCurrent, max: 100, min: -10, recharge: 0 }));
    ship.components.set(ArmorComponent,
        new Stat({ current: 100, max: 100, min: 0, recharge: 0 }));
    world.entities.set(name, ship);
    return ship;
}

function shieldOf(ship: Entity): Stat {
    return ship.components.get(ShieldComponent)!;
}

function armorOf(ship: Entity): Stat {
    return ship.components.get(ArmorComponent)!;
}

function collide(world: World, weapon: Entity, victim: Entity): void {
    world.emit(CollisionEvent, { other: victim.uuid, initiator: true },
        [weapon.uuid]);
    world.step();
}

describe("shield floor", () => {
    // Uses the real ShipShieldProvider (min = -0.1 * maxShield) and the
    // HealthPlugin recharge step that enforces the floor.
    function makeShipWorld(): World {
        const world = new World();
        world.resources.set(GameDataResource, new MockGameData());
        world.resources.set(TimeResource,
            { time: 1000, delta_ms: 16, delta_s: 0.016, frame: 1 });
        world.addPlugin(DeltaPlugin);
        world.addPlugin(ShipPlugin);
        world.addPlugin(HealthPlugin);
        world.addPlugin(DeathPlugin);
        return world;
    }

    function addPhysicsShip(world: World, name: string): Entity {
        const ship = new Entity(name);
        ship.components.set(ShipComponent, { id: "nova:128" });
        ship.components.set(ShipDataComponent, getDefaultShipData());
        ship.components.set(ShipPhysicsComponent, {
            ...getDefaultShipData().physics,
            shield: 100,
            armor: 100,
            shieldRecharge: 0,
            armorRecharge: 0,
        });
        world.entities.set(name, ship);
        return ship;
    }

    it("floors shield overshoot at -10% of max shield", () => {
        const world = makeShipWorld();
        const ship = addPhysicsShip(world, "ship");
        world.step();  // ShipShieldProvider provides the shield stat.

        world.emit(DamagedEvent, { damage: FLOOR_DAMAGE, damager: "x" },
            [ship.uuid]);
        world.step();
        // 100 - 150 overshoots to -50, floored to -10 (DAT_00575208).
        expect(shieldOf(ship).current).toEqual(-10);
        expect(shieldOf(ship).min).toEqual(-10);
        expect(armorOf(ship).current).toEqual(100);
    });

    it("does not spill shield overflow into armor", () => {
        const world = makeShipWorld();
        const ship = addPhysicsShip(world, "ship");
        world.step();

        world.emit(DamagedEvent, {
            damage: { ...FLOOR_DAMAGE, shield: 30, armor: 40 }, damager: "x",
        }, [ship.uuid]);
        world.step();
        expect(shieldOf(ship).current).toEqual(70);
        expect(armorOf(ship).current).toEqual(100);

        // Once the shield reaches 0, armor takes only its own damage.
        world.emit(DamagedEvent, {
            damage: { ...FLOOR_DAMAGE, shield: 100, armor: 40 }, damager: "x",
        }, [ship.uuid]);
        world.step();
        expect(shieldOf(ship).current).toEqual(-10);
        expect(armorOf(ship).current).toEqual(60);
    });
});

describe("beam damage decay", () => {
    const DECAY_MS = 1000 / 30;  // one EV Nova frame per decay step

    function addBeam(world: World, decay: number): Entity {
        const beam = new Entity(`beam ${world.entities.size}`);
        beam.components.set(BeamDataComponent, { ...BEAM, decay });
        beam.components.set(CreateTime, 0);
        world.entities.set(beam.name!, beam);
        return beam;
    }

    function collideAt(world: World, beam: Entity, victim: Entity,
        elapsedMs: number): void {
        world.resources.set(TimeResource,
            { time: elapsedMs, delta_ms: 16, delta_s: 0.016, frame: 1 });
        collide(world, beam, victim);
    }

    it("does full damage every overlapping frame", () => {
        // Beams hit per frame for their full (decaying) damage — the old
        // delta_ms * 30 / 1000 scale would have dealt a partial first hit.
        const world = makeWorld();
        const victim = addFighter(world, "victim");
        const beam = addBeam(world, 0);
        collideAt(world, beam, victim, 0);
        expect(shieldOf(victim).current).toEqual(90);
        expect(armorOf(victim).current).toEqual(100);
    });

    it("decays shield and armor damage by one per decay interval", () => {
        const world = makeWorld();
        const beam = addBeam(world, DECAY_MS);

        // steps = floor(elapsedFrames / (decayFrames + 1)): FUN_00435830's
        // counter only overflows strictly past the interval and resets to
        // zero, so the effective period is decay + 1 frames. The victims
        // have spent shields so the armor damage (which only applies once
        // the shield reaches 0) is visible too.
        const victim1 = addFighter(world, "victim1", undefined, 0);
        collideAt(world, beam, victim1, DECAY_MS);
        expect(shieldOf(victim1).current).toEqual(-10);  // steps 0: 0 - 10
        expect(armorOf(victim1).current).toEqual(95);    // 100 - 5

        const victim2 = addFighter(world, "victim2", undefined, 0);
        collideAt(world, beam, victim2, 2 * DECAY_MS);
        expect(shieldOf(victim2).current).toEqual(-9);   // steps 1: 0 - 9
        expect(armorOf(victim2).current).toEqual(96);    // 100 - 4

        const victim3 = addFighter(world, "victim3", undefined, 0);
        collideAt(world, beam, victim3, 4 * DECAY_MS);
        expect(shieldOf(victim3).current).toEqual(-8);   // steps 2: 0 - 8
        expect(armorOf(victim3).current).toEqual(97);    // 100 - 3
    });

    it("never decays below zero damage", () => {
        const world = makeWorld();
        const victim = addFighter(world, "victim");
        const beam = addBeam(world, DECAY_MS);
        // After ~60 decay intervals both damages clamp to 0: no change.
        collideAt(world, beam, victim, 60 * DECAY_MS);
        expect(shieldOf(victim).current).toEqual(100);
        expect(armorOf(victim).current).toEqual(100);
    });

    it("never decays when decay is 0", () => {
        const world = makeWorld();
        const victim = addFighter(world, "victim");
        const beam = addBeam(world, 0);
        collideAt(world, beam, victim, 100 * 1000);
        expect(shieldOf(victim).current).toEqual(90);
        expect(armorOf(victim).current).toEqual(100);
    });
});

describe("square blast range", () => {
    it("builds a square polygon hull of the blast radius", () => {
        const hull = squareBlastHull(50);
        expect(hull.shapes.length).toEqual(1);
        const shape = hull.shapes[0];
        expect(shape).toBeInstanceOf(SAT.Polygon);
        const points = (shape as SAT.Polygon).calcPoints
            .map(p => [p.x, p.y].join(",")).sort();
        expect(points).toEqual(["-50,-50", "-50,50", "50,-50", "50,50"]);
    });

    it("no longer uses a circle hull", () => {
        const hull = squareBlastHull(10);
        expect(hull.shapes[0]).toBeInstanceOf(SAT.Polygon);
        expect(hull.shapes[0]).not.toBeInstanceOf(SAT.Circle);
    });
});

describe("self-blast splash", () => {
    function addBlastingProjectile(world: World, owner: Entity,
        blastHurtsFiringShip: boolean): Entity {
        const projectile = new Entity(`projectile ${world.entities.size}`);
        projectile.components.set(ProjectileDataComponent, {
            ...PROJECTILE,
            blastRadius: 50,
            blastHurtsFiringShip,
        });
        projectile.components.set(ProjectileBlastHull, squareBlastHull(50));
        projectile.components.set(CollisionHitterComponent,
            { hitTypes: new Set(["normal"]) });
        projectile.components.set(MovementStateComponent, {
            position: new Position(0, 0),
            rotation: new Angle(0),
            velocity: new Vector(0, 0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        projectile.components.set(OwnerComponent, { owner: owner.uuid });
        world.entities.set(projectile.name!, projectile);
        return projectile;
    }

    function explode(world: World, projectile: Entity,
        directVictim?: Entity): Entity {
        world.emit(ProjectileExplodeEvent, directVictim, [projectile.uuid]);
        world.step();
        const blast = [...world.entities.values()]
            .find(entity => entity.components.has(BlastDamageComponent));
        expect(blast).toBeDefined();
        return blast!;
    }

    it("an NPC never takes its own blast splash", () => {
        const world = makeWorld();
        const npc = addFighter(world, "npc");
        const bystander = addFighter(world, "bystander");
        const projectile = addBlastingProjectile(world, npc, true);

        const blast = explode(world, projectile);
        // A blast lives for exactly one collision pass, so both victims
        // must be hit in the same pass (like the real splash frame).
        world.emit(CollisionEvent, { other: npc.uuid, initiator: true },
            [blast.uuid]);
        world.emit(CollisionEvent, { other: bystander.uuid, initiator: true },
            [blast.uuid]);
        world.step();
        expect(shieldOf(npc).current).toEqual(100);  // immune
        expect(shieldOf(bystander).current).toEqual(90);  // others burn
    });

    it("the player takes their own blast splash", () => {
        const world = makeWorld();
        const player = addFighter(world, "player");
        player.components.set(PlayerShipSelector, undefined);
        const projectile = addBlastingProjectile(world, player, true);

        const blast = explode(world, projectile);
        collide(world, blast, player);
        expect(shieldOf(player).current).toEqual(90);
    });

    it("weapon flag 0x100 (blastHurtsFiringShip false) spares even the player",
        () => {
            const world = makeWorld();
            const player = addFighter(world, "player");
            player.components.set(PlayerShipSelector, undefined);
            const projectile = addBlastingProjectile(world, player, false);

            const blast = explode(world, projectile);
            collide(world, blast, player);
            expect(shieldOf(player).current).toEqual(100);
        });

    it("projectile blasts double-dip: the directly-hit entity is not ignored",
        () => {
            const world = makeWorld();
            const npc = addFighter(world, "npc");
            const victim = addFighter(world, "victim");
            const projectile = addBlastingProjectile(world, npc, true);

            // In the real flow the direct hit has already damaged `victim`
            // via ProjectileCollisionSystem before the explosion; the blast
            // must NOT ignore it (the binary's projectile splash loop has
            // no direct-victim skip, unlike the beam splash loop).
            const blast = explode(world, projectile, victim);
            collide(world, blast, victim);
            expect(shieldOf(victim).current).toEqual(90);
        });
});

describe("projectile moving-toward gate", () => {
    // A 32x32 target: gate = round(32 * 0.66) * 10 / 32 = 6.5625 degrees.
    function addTarget(world: World, name: string, position: Position): Entity {
        const ship = addFighter(world, name, position);
        const size = 32;
        ship.components.set(HurtboxHullComponent, new CompositeHull([
            new SAT.Polygon(new SAT.Vector(0, 0), [
                new SAT.Vector(-size / 2, -size / 2),
                new SAT.Vector(size / 2, -size / 2),
                new SAT.Vector(size / 2, size / 2),
                new SAT.Vector(-size / 2, size / 2),
            ]),
        ]));
        return ship;
    }

    function addAimedProjectile(world: World): Entity {
        const projectile = new Entity(`projectile ${world.entities.size}`);
        projectile.components.set(ProjectileDataComponent, PROJECTILE);
        projectile.components.set(MovementStateComponent, {
            position: new Position(0, 0),
            rotation: new Angle(0),  // pointing "up" (-y, the clock-angle 0)
            velocity: new Vector(0, 0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        world.entities.set(projectile.name!, projectile);
        return projectile;
    }

    it("damages a target the projectile is moving toward", () => {
        const world = makeWorld();
        const target = addTarget(world, "target", new Position(0, -100));
        collide(world, addAimedProjectile(world), target);
        expect(shieldOf(target).current).toEqual(90);
    });

    it("damages a target just inside the cone", () => {
        const world = makeWorld();
        // 5 degrees off-axis, inside the 6.5625 degree cone.
        const angle = 5 * Math.PI / 180;
        const target = addTarget(world, "target", new Position(
            100 * Math.sin(angle), -100 * Math.cos(angle)));
        collide(world, addAimedProjectile(world), target);
        expect(shieldOf(target).current).toEqual(90);
    });

    it("does not damage a target the projectile is moving away from", () => {
        const world = makeWorld();
        // 90 degrees off-axis: far outside the cone.
        const target = addTarget(world, "target", new Position(100, 0));
        const projectile = addAimedProjectile(world);
        collide(world, projectile, target);
        expect(shieldOf(target).current).toEqual(100);
        // Blocked hits do not detonate the projectile.
        expect(world.entities.has(projectile.uuid)).toBeTrue();
    });

    it("still damages targets without a hull (gate skipped)", () => {
        const world = makeWorld();
        // addFighter has no HurtboxHullComponent: the gate cannot evaluate,
        // so the hit lands (the collision itself already happened).
        const target = addFighter(world, "target", new Position(100, 0));
        collide(world, addAimedProjectile(world), target);
        expect(shieldOf(target).current).toEqual(90);
    });
});
