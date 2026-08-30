// The neutral-player hostility gate, as a leaf module: it imports only
// nova_ecs plus the mission/player resources, so both npc_plugin and the
// weapon collision systems (projectile/beam/blast) can use it without an
// import cycle.
//
// The player carries no GovernmentComponent and starts with a fresh
// legalRecord, so no government considers them hostile. NPC targeting is
// already gated on that (playerIsHostile), but stray and splash fire from
// the NPC free-for-all is not: projectiles, beams and blasts damage
// whatever they collide with. The weapon collision systems therefore gate
// their DamagedEvent emission through damagerMayDamagePlayer, so a
// neutral player is only ever hurt by a ship whose government actually
// considers them an enemy.

import { Entities } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { EntityMap } from "nova_ecs/entity_map";
import { World } from "nova_ecs/world";
import { MissionEnvResource } from "../missions/mission_plugin";
import { PlayerStateResource } from "../player/player_state_component";

// Which government a dude/fleet ship belongs to (P7 builds record
// propagation on top; today it only tags the ship). Moved here from
// npc_plugin so the weapon collision systems can read it without an
// import cycle through that module; npc_plugin re-exports it (dude.ts
// re-exports it from there).
export const GovernmentComponent = new Component<{ id: string | null }>('Government');

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

// True when a weapon fired by the ship `ownerUuid` may damage the player:
// only a damager whose government considers the player hostile gets
// through. No owner, an owner that no longer exists, or an owner without
// a government is suppressed too — an unattributable damager is never
// trusted to be at war with the player.
export function damagerMayDamagePlayer(world: World, entities: EntityMap,
    ownerUuid: string | undefined): boolean {
    if (!ownerUuid) {
        return false;
    }
    const govtId = entities.get(ownerUuid)?.components
        .get(GovernmentComponent)?.id;
    if (!govtId) {
        return false;
    }
    return playerIsHostile(govtId, world);
}
