import { ShipData } from "novadatainterface/ShipData";
import { Entities, GetWorld, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Optional } from "nova_ecs/optional";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { MissionEnvResource } from "../missions/mission_plugin";
import { PlayerStateResource } from "../player/player_state_component";
import { DeathEvent } from "./death_plugin";
import { makeShip } from "./make_ship";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ShipComponent } from "./ship_plugin";
import { TargetComponent } from "./target_component";
import { WeaponsStateComponent } from "./weapons_state";
import { GameDataResource } from "./game_data_resource";

// Which government a dude/fleet ship belongs to (P7 builds record
// propagation on top; today it only tags the ship). Lives here — next to
// the AI systems that read it — so npc_ai_plugin can use it without an
// import cycle through dude.ts; dude.ts re-exports it.
export const GovernmentComponent = new Component<{ id: string | null }>('Government');

const TargetsQuery = new Query([UUID, ShipComponent] as const);
const PlayerQuery = new Query([UUID, PlayerShipSelector] as const);
function getValidTargets(targets: Array<readonly [string, any]>,
    selfUuid: string, player: string | undefined,
    playerTargetable: boolean): string[] {
    return targets.filter(([targetId]) =>
            targetId !== selfUuid
            // The player is only random-targetable once hostile to the
            // chooser's government (see playerIsHostile).
            && (targetId !== player || playerTargetable))
        .map(([uuid]) => uuid);
}

export const ChooseRandomTargetComponent = new Component<{
    interval: number,
    nextTime?: number,
}>('ChooseRandomTargetComponent');

const ChooseRandomTargetAI = new System({
    name: 'ChooseRandomTarget',
    args: [TargetComponent, TargetsQuery, ChooseRandomTargetComponent,
        TimeResource, UUID, Entities, GetWorld,
        Optional(GovernmentComponent), PlayerQuery] as const,
    step(target, targets, randomTargetData, time, uuid, entities, world: World,
        govt, players) {
        if ((randomTargetData.nextTime ?? 0) > time.time &&
            target.target && entities.has(target.target)) {
            return;
        }
        randomTargetData.nextTime = time.time + randomTargetData.interval;

        const player = players[0]?.[0];
        const validTargets = getValidTargets(targets, uuid, player,
            playerIsHostile(govt?.id, world));

        if (validTargets.length === 0) {
            target.target = undefined;
            return;
        }

        const index = Math.floor(Math.random() * validTargets.length);
        target.target = validTargets[index];
    }
});

// True when the government `govtId` considers the player a criminal:
// the player's legal record with it is below -crimeTol (the same
// hostility test the smuggling scan gate uses). False when the government
// is unknown, the MissionEnv or player state is missing, or the record is
// neutral — an NPC that cannot know the player is its enemy never
// auto-targets them (AggroRange and ChooseRandomTarget both gate on this).
export function playerIsHostile(govtId: string | null | undefined,
    world: World): boolean {
    if (!govtId) {
        return false;
    }
    const govt = world.resources.get(MissionEnvResource)?.government(govtId);
    const playerState = world.resources.get(PlayerStateResource);
    if (!govt || !playerState) {
        return false;
    }
    return (playerState.legalRecord[govt.id] ?? 0) < -govt.crimeTol;
}

export const FollowComponent = new Component<undefined>('FollowComponent');
export const FollowAI = new System({
    name: 'FollowAndShootAI',
    args: [MovementStateComponent, TargetComponent, FollowComponent] as const,
    step(movementState, target) {
        movementState.turnTo = target.target;
        movementState.accelerating = 1;
    }
});

export const ShootAllWeaponsComponent = new Component<undefined>('ShootAllWeaponsComponent');
export const ShootAllWeaponsAI = new System({
    name: 'ShootAllWeaponsAI',
    args: [WeaponsStateComponent, GameDataResource, TargetComponent, ShootAllWeaponsComponent] as const,
    step(weapons, gameData, { target }) {
        for (const [id, weapon] of weapons) {
            const weaponType = gameData.data.Weapon.getCached(id)?.type;
            if (weaponType == null || weaponType === 'BayWeaponData') {
                // do not use bay weapons yet since there is no ammo limit.
                continue;
            };
            weapon.target = target;
            weapon.firing = true;
        }
    }
});


export const DeathAIComponent = new Component<undefined>('DeathAIComponent');
export const DeathAISystem = new System({
    name: 'DeathAISystem',
    events: [DeathEvent],
    args: [Entities, UUID, DeathAIComponent] as const,
    step(entities, uuid) {
        entities.delete(uuid);
    }
})

export function makeNpc(shipData: ShipData) {
    const ship = makeShip(shipData);
    ship.components.set(ChooseRandomTargetComponent, {
        interval: 10_000,
    });
    ship.components.set(FollowComponent, undefined);
    ship.components.set(ShootAllWeaponsComponent, undefined);
    ship.components.set(DeathAIComponent, undefined);
    return ship;
}

export const NpcPlugin: Plugin = {
    name: 'NpcPlugin',
    build(world) {
        world.addSystem(ChooseRandomTargetAI);
        world.addSystem(FollowAI);
        world.addSystem(ShootAllWeaponsAI);
        world.addSystem(DeathAISystem);
    },
    remove(world) {
        world.removeSystem(ChooseRandomTargetAI);
        world.removeSystem(FollowAI);
        world.removeSystem(ShootAllWeaponsAI);
    }
}

