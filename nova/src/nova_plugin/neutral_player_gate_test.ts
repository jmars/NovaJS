// Headless World specs for neutral-player stray-fire damage: projectiles,
// blasts and beams from NPC fights hurt a neutral player exactly like any
// other ship (real EV Nova: NPCs never deliberately target a neutral
// player — that is gated separately on playerIsHostile in AggroRange /
// ChooseRandomTarget, pinned by npc_ai_test.ts — but their stray and
// splash fire still damages them). The worlds here emit CollisionEvents
// directly (the collision pipeline is not under test — the DamagedEvent
// emission is). Run with:
//   npx esbuild --bundle --platform=node \
//       nova/src/nova_plugin/neutral_player_gate_test.ts \
//       --outfile=/tmp/neutral_gate_test.js \
//       && node_modules/.bin/jasmine /tmp/neutral_gate_test.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import {
    BeamWeaponData,
    getDefaultBeamWeaponData,
    getDefaultProjectileWeaponData,
    ProjectileWeaponData,
} from "novadatainterface/WeaponData";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { MissionEnvResource } from "../missions/mission_plugin";
import { makePlayerState, makeTestEnv } from "../missions/test_fixtures";
import { PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { BlastDamageComponent, BlastPlugin } from "./blast_plugin";
import { BeamDataComponent, BeamPlugin } from "./beam_plugin";
import { CollisionEvent } from "./collision_interaction";
import { CreateTime } from "./create_time";
import { DeathPlugin } from "./death_plugin";
import { FireSubs, OwnerComponent, WeaponConstructors } from "./fire_weapon_plugin";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import { GovernmentComponent } from "./npc_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ProjectileDataComponent } from "./projectile_data";
import { ProjectilePlugin } from "./projectile_plugin";
import { Stat } from "./stat";
import { GameDataResource } from "./game_data_resource";

// The Federation and Polaris governments from the shared fixtures.
// Polaris (nova:130) has the default crimeTol 0, so a legal record of -1
// makes the player its enemy.
const FEDERATION_ID = "nova:128";
const POLARIS_ID = "nova:130";

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

// shotDuration well above the fired-ago time so the beam's damage scale
// stays positive.
const BEAM: BeamWeaponData = {
    ...getDefaultBeamWeaponData(),
    id: "nova:1501",
    name: "Test Beam",
    damage: DAMAGE,
    shotDuration: 2000,
};

function makeGateWorld(state: PlayerState): World {
    const { env } = makeTestEnv();
    const world = new World();
    // ProjectileHurtboxProvider's resource check needs game data at
    // addSystem time, even though no spec exercise it.
    world.resources.set(GameDataResource, new MockGameData());
    world.resources.set(WeaponConstructors, new Map());
    world.resources.set(FireSubs, () => []);
    world.resources.set(TimeResource,
        { time: 1000, delta_ms: 16, delta_s: 0.016, frame: 1 });
    world.resources.set(MissionEnvResource, env);
    world.resources.set(PlayerStateResource, state);
    world.addPlugin(ProjectilePlugin);
    world.addPlugin(BeamPlugin);
    world.addPlugin(BlastPlugin);
    world.addPlugin(DeathPlugin);
    return world;
}

function addFighter(world: World, name: string,
    isPlayer: boolean): Entity {
    const ship = new Entity(name);
    if (isPlayer) {
        ship.components.set(PlayerShipSelector, undefined);
    }
    ship.components.set(ShieldComponent,
        new Stat({ current: 100, max: 100, min: -5, recharge: 0 }));
    ship.components.set(ArmorComponent,
        new Stat({ current: 100, max: 100, min: 0, recharge: 0 }));
    world.entities.set(name, ship);
    return ship;
}

// A weapon platform whose shots are attributed to `govtId` (null = a
// government-less ship).
function addShooter(world: World, govtId: string | null): Entity {
    const ship = new Entity(`shooter ${world.entities.size}`);
    ship.components.set(GovernmentComponent, { id: govtId });
    world.entities.set(ship.name!, ship);
    return ship;
}

function addProjectile(world: World, owner?: Entity): Entity {
    const proj = new Entity(`projectile ${world.entities.size}`);
    proj.components.set(ProjectileDataComponent, PROJECTILE);
    proj.components.set(CreateTime, 0);
    if (owner) {
        proj.components.set(OwnerComponent, { owner: owner.uuid });
    }
    world.entities.set(proj.name!, proj);
    return proj;
}

function addBlast(world: World, owner?: Entity): Entity {
    const blast = new Entity(`blast ${world.entities.size}`);
    blast.components.set(BlastDamageComponent, DAMAGE);
    if (owner) {
        blast.components.set(OwnerComponent, { owner: owner.uuid });
    }
    world.entities.set(blast.name!, blast);
    return blast;
}

function addBeam(world: World, owner?: Entity): Entity {
    const beam = new Entity(`beam ${world.entities.size}`);
    beam.components.set(BeamDataComponent, BEAM);
    beam.components.set(CreateTime, 0);
    if (owner) {
        beam.components.set(OwnerComponent, { owner: owner.uuid });
    }
    world.entities.set(beam.name!, beam);
    return beam;
}

function collide(world: World, weapon: Entity, victim: Entity): void {
    world.emit(CollisionEvent, { other: victim.uuid, initiator: true },
        [weapon.uuid]);
    world.step();
}

function shieldOf(ship: Entity): Stat {
    return ship.components.get(ShieldComponent)!;
}

function armorOf(ship: Entity): Stat {
    return ship.components.get(ArmorComponent)!;
}

// A neutral player: fresh legalRecord, so no government is at war with
// them (mirrors a new pilot file).
function makeNeutralState(): PlayerState {
    return makePlayerState();
}

// A player Polaris considers a criminal (record -1 < -crimeTol 0).
function makeHostileState(): PlayerState {
    const state = makePlayerState();
    state.legalRecord[POLARIS_ID] = -1;
    return state;
}

describe("neutral player stray-fire damage", () => {
    it("stray projectiles hurt a neutral player", () => {
        const world = makeGateWorld(makeNeutralState());
        const player = addFighter(world, "player", true);

        // Owner whose government is not hostile to the player.
        const friendly = addShooter(world, FEDERATION_ID);
        collide(world, addProjectile(world, friendly), player);
        expect(shieldOf(player).current).toEqual(90);
        expect(armorOf(player).current).toEqual(100);

        // Owner without any government: the shot still lands.
        const govtLess = addShooter(world, null);
        collide(world, addProjectile(world, govtLess), player);
        expect(shieldOf(player).current).toEqual(80);
    });

    it("blast splash hurts a neutral player, with or without owner", () => {
        const world = makeGateWorld(makeNeutralState());
        const player = addFighter(world, "player", true);

        collide(world, addBlast(world), player);
        expect(shieldOf(player).current).toEqual(90);

        const friendly = addShooter(world, FEDERATION_ID);
        collide(world, addBlast(world, friendly), player);
        expect(shieldOf(player).current).toEqual(80);
    });

    it("stray beams hurt a neutral player", () => {
        const world = makeGateWorld(makeNeutralState());
        const player = addFighter(world, "player", true);
        const friendly = addShooter(world, FEDERATION_ID);

        collide(world, addBeam(world, friendly), player);
        const afterFirst = shieldOf(player).current;
        expect(afterFirst).toBeLessThan(100);

        const govtLess = addShooter(world, null);
        collide(world, addBeam(world, govtLess), player);
        expect(shieldOf(player).current).toBeLessThan(afterFirst);
    });

    it("a criminal-record player's fire damage still lands", () => {
        // A player a government considers hostile is targeted AND damaged;
        // here only the damage half is under test (targeting is pinned in
        // npc_ai_test.ts).
        const projectileWorld = makeGateWorld(makeHostileState());
        const player = addFighter(projectileWorld, "player", true);
        const hostile = addShooter(projectileWorld, POLARIS_ID);
        collide(projectileWorld, addProjectile(projectileWorld, hostile),
            player);
        expect(shieldOf(player).current).toEqual(90);

        // Blast from the same shooter: splash gets through too.
        collide(projectileWorld, addBlast(projectileWorld, hostile), player);
        expect(shieldOf(player).current).toEqual(80);
    });

    it("NPCs take the same stray fire", () => {
        const world = makeGateWorld(makeNeutralState());
        const npc = addFighter(world, "npc", false);

        const friendly = addShooter(world, FEDERATION_ID);
        collide(world, addProjectile(world, friendly), npc);
        expect(shieldOf(npc).current).toEqual(90);

        collide(world, addBlast(world, friendly), npc);
        expect(shieldOf(npc).current).toEqual(80);
    });

    it("ownerless fire hits an ownerless target", () => {
        // A projectile/beam with no owner (e.g. from a ship destroyed mid-
        // flight) must still damage an ownerless target. Before the fix,
        // the friendly-fire check compared two undefined owners, which
        // equal each other, and silently skipped the damage.
        const world = makeGateWorld(makeNeutralState());
        const npc = addFighter(world, "npc", false);

        collide(world, addProjectile(world), npc);
        expect(shieldOf(npc).current).toEqual(90);

        collide(world, addBeam(world), npc);
        expect(shieldOf(npc).current).toBeLessThan(90);
    });
});
