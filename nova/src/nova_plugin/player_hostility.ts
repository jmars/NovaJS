// The neutral-player hostility gate, as a leaf module: it imports only
// nova_ecs plus the mission/player resources, so both npc_plugin and the
// npc AI systems can use it without an import cycle.
//
// The player carries no GovernmentComponent and starts with a fresh
// legalRecord, so no government considers them hostile. NPCs therefore do
// not deliberately target a neutral player: AggroRange and
// ChooseRandomTarget both gate their player targeting on playerIsHostile.
// Their stray and splash fire still damages the player, though — in real
// EV Nova a neutral player is never targeted but is not invulnerable
// (projectile/beam/blast damage is emitted for whoever it hits).

import { Component } from "nova_ecs/component";
import { World } from "nova_ecs/world";
import { MissionEnvResource } from "../missions/mission_plugin";
import { PlayerStateResource } from "../player/player_state_component";

// Which government a dude/fleet ship belongs to (P7 builds record
// propagation on top; today it only tags the ship). Moved here from
// npc_plugin so the dude/mission systems can read it without an
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
