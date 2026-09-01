// Side-by-side trace specs for combat damage: the port's real damage
// systems (DeathPlugin.DamageSystem + BeamCollisionSystem, headless worlds)
// must reproduce the pure binary reference model (combat_damage_model) for
// the same weapon/target inputs. EV Nova combat has no damage-variance LCG
// roll, so the comparison is purely numeric (shield/armor deltas), not an
// LCG-stream fingerprint like the ambient trace.
//
// Two surfaces are swept:
//   [a] DamageSystem — damage routing to shield then armor, point-defense
//       scaling for shieldless projectile targets, pass-through weapons.
//   [b] Beam decay — the decaying per-frame beam damage over firing time.
//
// Run:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/combat_damage_trace_test.ts \
//       --outfile=/tmp/combat_damage_trace_test.js \
//       && node_modules/.bin/jasmine /tmp/combat_damage_trace_test.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import {
    getDefaultBeamWeaponData,
    WeaponDamage,
} from "novadatainterface/WeaponData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { BeamDataComponent, BeamPlugin } from "./beam_plugin";
import { CollisionEvent, CollisionHitterComponent } from "./collision_interaction";
import { CreateTime } from "./create_time";
import { DamagedEvent, DeathPlugin } from "./death_plugin";
import { FireSubs, OwnerComponent, WeaponConstructors } from "./fire_weapon_plugin";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import { ProjectileComponent } from "./projectile_data";
import { ProjectilePlugin } from "./projectile_plugin";
import { Stat } from "./stat";
import { GameDataResource } from "./game_data_resource";
import {
    applyDamage,
    beamSteps,
    decayedBeamDamage,
    DamageTarget,
} from "./combat_damage_model";

function makeWorld(extra: (w: World) => void = () => {}): World {
    const world = new World();
    world.resources.set(GameDataResource, new MockGameData());
    world.resources.set(WeaponConstructors, new Map());
    world.resources.set(FireSubs, () => []);
    world.resources.set(TimeResource,
        { time: 1000, delta_ms: 16, delta_s: 0.016, frame: 1 });
    world.addPlugin(ProjectilePlugin);
    world.addPlugin(BeamPlugin);
    world.addPlugin(DeathPlugin);
    extra(world);
    return world;
}

function addFighter(world: World, name: string, shieldCurrent: number,
    shieldMax: number, armorCurrent: number, isProjectile = false): Entity {
    const ship = new Entity(name);
    ship.components.set(MovementStateComponent, {
        position: new Position(0, 0), rotation: new Angle(0),
        velocity: new Vector(0, 0), accelerating: 0, turning: 0,
        turnBack: false,
    });
    ship.components.set(ShieldComponent,
        new Stat({ current: shieldCurrent, max: shieldMax, min: -10,
            recharge: 0 }));
    ship.components.set(ArmorComponent,
        new Stat({ current: armorCurrent, max: 100, min: 0, recharge: 0 }));
    if (isProjectile) {
        ship.components.set(ProjectileComponent, { id: "nova:1500" });
    }
    world.entities.set(name, ship);
    return ship;
}

function shieldOf(ship: Entity): Stat {
    return ship.components.get(ShieldComponent)!;
}
function armorOf(ship: Entity): Stat {
    return ship.components.get(ArmorComponent)!;
}
function portTarget(ship: Entity): DamageTarget {
    return {
        shield: { current: shieldOf(ship).current, max: shieldOf(ship).max },
        armor: { current: armorOf(ship).current },
    };
}

// [a] Drive the port's DamageSystem with a direct DamagedEvent and return
// the resulting shield/armor.
function runPortDamage(damage: WeaponDamage, isProjectile: boolean,
    target: { shield: number, max: number, armor: number }): DamageTarget {
    const world = makeWorld();
    const ship = addFighter(world, "target", target.shield, target.max,
        target.armor, isProjectile);
    world.emit(DamagedEvent, { damage, damager: "x" }, [ship.uuid]);
    world.step();
    return portTarget(ship);
}

// A compact sweep grid over damage + hull states, deterministic.
function* damageConfigs(): Generator<{
    damage: WeaponDamage, isProjectile: boolean,
    target: { shield: number, max: number, armor: number }, scale: number,
}> {
    const damages: WeaponDamage[] = [];
    for (const shield of [0, 5, 10, 30, 100]) {
        for (const armor of [0, 3, 8, 50]) {
            for (const passThrough of [0, 1]) {
                damages.push({
                    shield, armor, ionization: 0, ionizationColor: 0,
                    passThroughShield: passThrough, knockback: 0,
                });
            }
        }
    }
    const targets = [
        { shield: 100, max: 100, armor: 100 },
        { shield: 30, max: 100, armor: 100 },
        { shield: 0, max: 100, armor: 100 },
        { shield: 0, max: 0, armor: 100 },   // shieldless (no shield component max)
        { shield: 5, max: 50, armor: 20 },
    ];
    for (const damage of damages) {
        for (const target of targets) {
            for (const isProjectile of [false, true]) {
                yield { damage, isProjectile, target, scale: 1 };
            }
        }
    }
}

describe("combat damage trace vs reference model", () => {
    it("[a] DamageSystem matches the model across the sweep grid", () => {
        let cases = 0;
        for (const cfg of damageConfigs()) {
            const result = runPortDamage(cfg.damage, cfg.isProjectile,
                cfg.target);
            const want = applyDamage(cfg.damage, {
                shield: { current: cfg.target.shield, max: cfg.target.max },
                armor: { current: cfg.target.armor },
            }, cfg.isProjectile, cfg.scale);
            expect({
                shield: result.shield.current,
                armor: result.armor.current,
            }).withContext(
                `damage ${JSON.stringify(cfg.damage)} isProj=${cfg.isProjectile} `
                + `target ${JSON.stringify(cfg.target)}`)
                .toEqual({ shield: want.shield, armor: want.armor });
            cases++;
        }
        // Sanity: the grid actually exercised both shield branches and the
        // point-defense path.
        expect(cases).toBeGreaterThan(100);
    });

    it("[b] beam decay matches the model across firing-time sweeps", () => {
        const FRAME = 1000 / 30;
        const bases: WeaponDamage[] = [
            { shield: 10, armor: 5, ionization: 0, ionizationColor: 0,
                passThroughShield: 0, knockback: 0 },
            { shield: 1, armor: 1, ionization: 0, ionizationColor: 0,
                passThroughShield: 0, knockback: 0 },
            { shield: 0, armor: 20, ionization: 0, ionizationColor: 0,
                passThroughShield: 1, knockback: 0 },
        ];
        const decays = [0, FRAME, 2 * FRAME, 10 * FRAME];
        const times = [0, FRAME, 3 * FRAME, 7 * FRAME, 30 * FRAME];
        let cases = 0;
        for (const base of bases) {
            for (const decay of decays) {
                for (const elapsed of times) {
                    for (const [shield, armor] of [[100, 100], [0, 100]]) {
                        const world = makeWorld();
                        const victim = addFighter(world, "v", shield, 100,
                            armor);
                        const beam = new Entity("beam");
                        beam.components.set(BeamDataComponent,
                            { ...getDefaultBeamWeaponData(), damage: base,
                                decay });
                        beam.components.set(CreateTime, 0);
                        world.entities.set(beam.name!, beam);
                        world.resources.set(TimeResource,
                            { time: elapsed, delta_ms: 16, delta_s: 0.016,
                                frame: 1 });
                        world.emit(CollisionEvent,
                            { other: victim.uuid, initiator: true },
                            [beam.uuid]);
                        world.step();
                        const steps = beamSteps(elapsed, decay);
                        const want = applyDamage(
                            decayedBeamDamage(base, steps),
                            { shield: { current: shield, max: 100 },
                                armor: { current: armor } }, false, 1);
                        expect({
                            shield: shieldOf(victim).current,
                            armor: armorOf(victim).current,
                        }).withContext(
                            `base ${JSON.stringify(base)} decay=${decay} `
                            + `elapsed=${elapsed} shield=${shield} `
                            + `armor=${armor} steps=${steps}`)
                            .toEqual({ shield: want.shield, armor: want.armor });
                        cases++;
                    }
                }
            }
        }
        expect(cases).toBeGreaterThan(100);
    });
});
