// Where the PlayerState lives in the ECS. The Resource is the canonical
// singleton: it is set on the outer world and threaded into every per-system
// world by makeSystem (like GameDataResource) so the state survives world
// swaps. The Component mirrors the same object on the player's ship entity
// for entity-scoped systems.

import { Component } from "nova_ecs/component";
import { Resource } from "nova_ecs/resource";
import { PlayerState } from "./player_state";

export const PlayerStateComponent = new Component<PlayerState>('PlayerState');

export const PlayerStateResource = new Resource<PlayerState>('PlayerStateResource');
