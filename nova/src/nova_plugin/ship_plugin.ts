import * as t from 'io-ts';
import { ShipData, ShipPhysics } from "novadatainterface/ShipData";
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementPhysics, MovementPhysicsComponent, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { Provide } from 'nova_ecs/provide';
import { ProvideAsync } from "nova_ecs/provide_async";
import { cargoUsedTons } from '../player/cargo';
import { PlayerState } from '../player/player_state';
import { AnimationComponent } from './animation_plugin';
import { CollisionVulnerabilityComponent } from './collision_interaction';
import { GameDataResource } from './game_data_resource';
import { ArmorComponent, IonizationColorComponent, IonizationComponent, ShieldComponent } from './health_plugin';
import { applyOutfitPhysics, OutfitsStateComponent } from './outfit_plugin';
import { Stat } from './stat';
import { TargetComponent } from './target_component';

export const ShipType = t.type({
    id: t.string // Not a UUID. A nova id.
});
export type ShipType = t.TypeOf<typeof ShipType>;

export const ShipComponent = new Component<ShipType>('Ship');

export const ShipDataComponent = new Component<ShipData>('ShipData');

export const ShipDataProvider = ProvideAsync({
    name: "ShipDataProvider",
    provided: ShipDataComponent,
    args: [GameDataResource, ShipComponent] as const,
    update: [ShipComponent],
    factory: async (gameData, ship) => {
        return await gameData.data.Ship.get(ship.id);
    }
});

export const ShipOutfitsProvider = Provide({
    name: "ShipOutfitsProvider",
    provided: OutfitsStateComponent,
    args: [ShipDataComponent] as const,
    // Not ShipDataComponent because then this would always be provided
    // since ShipDataComponent is always provided since it's not multiplayer.
    update: [ShipComponent],
    factory(shipData) {
        return new Map(Object.entries(shipData.outfits)
            .map(([id, count]) => [id, { count }]));
    }
});

export const ShipPhysicsComponent = new Component<ShipPhysics>('ShipPhysicsComponent');

export const ShipPhysicsProvider = ProvideAsync({
    name: "ShipPhysicsProvider",
    provided: ShipPhysicsComponent,
    args: [ShipDataComponent, GameDataResource, OutfitsStateComponent] as const,
    update: [ShipDataComponent, OutfitsStateComponent],
    async factory(shipData, gameData, outfitsState) {
        const outfits = await Promise.all(
            [...outfitsState].map(async ([id, { count }]) =>
                [await gameData.data.Outfit.get(id), count] as const
            ));
        return applyOutfitPhysics(shipData.physics, outfits);
    }
});

export function getShipMovementPhysics(physics: ShipPhysics): MovementPhysics {
    return {
        acceleration: physics.acceleration,
        maxVelocity: physics.speed,
        movementType: physics.inertialess
            ? MovementType.INERTIALESS : MovementType.INERTIAL,
        turnRate: physics.turnRate,
    };
}

// The ship's total cargo capacity: ShipPhysicsComponent.freeCargo — the
// provider's base space plus outfit bonus (never recompute it here; outfits
// already added their share). Falls back to the ShipData's base capacity
// when the physics provider has not resolved on this entity yet, and null
// when nothing is known.
export function shipCargoCapacity(entity: Entity): number | null {
    const physics = entity.components.get(ShipPhysicsComponent);
    if (physics) {
        return physics.freeCargo;
    }
    const shipData = entity.components.get(ShipDataComponent);
    return shipData ? shipData.physics.freeCargo : null;
}

// The player's free cargo tons on this ship: the capacity minus what the
// pilot's hold (PlayerState.cargo) already carries. Null means unknown
// capacity: availability rule flags2 0x0001 passes and cargo pickups load
// unconditionally.
export function shipFreeCargoTons(entity: Entity, state: PlayerState): number | null {
    const capacity = shipCargoCapacity(entity);
    return capacity === null ? null : capacity - cargoUsedTons(state.cargo);
}

export const ShipMovementPhysicsProvider = Provide({
    name: "ShipMovementPhysicsProvider",
    provided: MovementPhysicsComponent,
    update: [ShipPhysicsComponent],
    args: [ShipPhysicsComponent] as const,
    factory: getShipMovementPhysics,
});

const ShipAnimationProvider = Provide({
    name: "ShipAnimationProvider",
    provided: AnimationComponent,
    update: [ShipDataComponent],
    args: [ShipDataComponent],
    factory: shipData => shipData.animation,
});

const ShipCollisionInteractionProvider = Provide({
    name: "ShipCollisionInteractionProvider",
    provided: CollisionVulnerabilityComponent,
    args: [ShipComponent] as const,
    factory: () => ({
        vulnerableTo: new Set(['normal']),
    }),
});

const ShipShieldProvider = Provide({
    name: "ShipShieldProvider",
    provided: ShieldComponent,
    update: [ShipPhysicsComponent],
    args: [ShipPhysicsComponent, Optional(ShieldComponent)] as const,
    factory(physics, shield) {
        return new Stat({
            current: shield?.current ?? physics.shield,
            max: physics.shield,
            // EV Nova floors the shield at -10% of max (FUN_004192d0,
            // DAT_00575208): bounded overshoot, no armor spill.
            min: -physics.shield * 0.1,
            recharge: physics.shieldRecharge,
        });
    }
});

const ShipArmorProvider = Provide({
    name: "ShipArmorProvider",
    provided: ArmorComponent,
    update: [ShipPhysicsComponent],
    args: [ShipPhysicsComponent, Optional(ArmorComponent)] as const,
    factory(physics, armor) {
        return new Stat({
            current: armor?.current ?? physics.armor,
            max: physics.armor,
            min: 0,
            recharge: physics.armorRecharge,
        });
    }
});

const ShipIonizationProvider = Provide({
    name: "ShipIonizationProvider",
    provided: IonizationComponent,
    update: [ShipPhysicsComponent],
    args: [ShipPhysicsComponent, Optional(IonizationComponent)] as const,
    factory(physics, ionization) {
        return new Stat({
            current: ionization?.current ?? 0,
            max: physics.ionization,
            min: 0,
            recharge: -physics.deionize,
        });
    }
});

const ShipIonizationColorProvider = Provide({
    name: "ShipIonizationColorProvider",
    provided: IonizationColorComponent,
    args: [] as const,
    factory() {
        return { color: 0x888888 };
    }
});

const ShipMovementStateProvider = Provide({
    name: "ShipMovementStateProvider",
    provided: MovementStateComponent,
    args: [ShipComponent],
    factory() {
        return {
            accelerating: 0,
            position: new Position(600 * (Math.random() - 0.5),
                (600 * (Math.random() - 0.5))),
            rotation: new Angle(Math.random() * 2 * Math.PI),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        }
    }
});

const ShipTargetComponentProvider = Provide({
    name: "ShipTaretComponentProvider",
    provided: TargetComponent,
    args: [ShipComponent],
    factory() {
        return { target: undefined };
    }
});

export const ShipPlugin: Plugin = {
    name: "ShipPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        world.addComponent(ShipComponent);
        world.addComponent(ShipDataComponent);

        world.addSystem(ShipCollisionInteractionProvider);
        world.addSystem(ShipDataProvider);
        world.addSystem(ShipAnimationProvider);
        world.addSystem(ShipOutfitsProvider);
        world.addSystem(ShipPhysicsProvider);
        world.addSystem(ShipMovementPhysicsProvider);
        world.addSystem(ShipShieldProvider);
        world.addSystem(ShipArmorProvider);
        world.addSystem(ShipIonizationProvider);
        world.addSystem(ShipIonizationColorProvider);
        world.addSystem(ShipMovementStateProvider);
        world.addSystem(ShipTargetComponentProvider);

        deltaMaker.addComponent(ShipComponent, {
            componentType: ShipType,
        });
    }
}
