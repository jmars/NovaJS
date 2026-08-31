// Player combat bookkeeping (P7): combat rating increments and the ränk
// 0x0004 interplay when the player destroys ships.
//
// The engine has no kill attribution on DeathEvent (it carries no killer),
// so the stand-in is the player's current target: when the dying ship is
// the ship the player is targeting, the kill is the player's. A per-shot
// damager history (DamagedEvent carries `damager`) would refine this.
//
// Only dude/fleet/mission ships carry GovernmentComponent (dude.ts), so the
// 0x0004 rank stripping only fires for ships whose government is known;
// the combat rating counts regardless. Both halves of 0x0004 are wired:
// DeathEvent (destroy) and DisabledEvent (disable — zero armor, the window
// before the death explosion).

import { GetWorld, RunQuery, UUID } from "nova_ecs/arg_types";
import { Optional } from "nova_ecs/optional";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { Plugin } from "nova_ecs/plugin";
import { World } from "nova_ecs/world";
import { MissionEnvResource, queuePlayerStateSave } from "../missions/mission_plugin";
import { deactivateRanksOnShipLoss } from "../player/legal_status";
import { PlayerStateResource } from "../player/player_state_component";
import { recordKill } from "../player/player_state";
import { GovernmentComponent } from "./dude";
import { DeathEvent, DisabledEvent } from "./death_plugin";
import { MissionShipDeathSystem } from "./mission_ship_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { TargetComponent } from "./target_component";

const PlayerKillQuery = new Query([UUID, PlayerShipSelector, TargetComponent] as const);

const PlayerKillSystem = new System({
    name: 'PlayerKillSystem',
    events: [DeathEvent],
    args: [DeathEvent, UUID, Optional(GovernmentComponent), GetWorld, RunQuery] as const,
    // Read the dead ship's govt tag before MissionShipDeathSystem removes
    // the entity.
    before: [MissionShipDeathSystem],
    step(_event, uuid, govt, world: World, runQuery) {
        const state = world.resources.get(PlayerStateResource);
        if (!state) {
            return;
        }
        const player = runQuery(PlayerKillQuery)[0];
        if (!player || player[0] === uuid || player[2].target !== uuid) {
            return;
        }
        recordKill(state);
        const env = world.resources.get(MissionEnvResource);
        if (env && govt?.id) {
            deactivateRanksOnShipLoss(state, govt.id, env);
        }
        queuePlayerStateSave();
    },
});

// The DISABLE half of ränk 0x0004: the target became a disabled hulk
// (armor 0, death explosion pending). No kill is recorded — the ship is
// still alive here — so only the rank stripping applies.
const PlayerDisableSystem = new System({
    name: 'PlayerDisableSystem',
    events: [DisabledEvent],
    args: [DisabledEvent, UUID, Optional(GovernmentComponent), GetWorld, RunQuery] as const,
    // The ship is not removed on a disable (only MissionShipDeathSystem's
    // DeathEvent pass removes it), so no ordering constraint is needed.
    step(_event, uuid, govt, world: World, runQuery) {
        const state = world.resources.get(PlayerStateResource);
        if (!state) {
            return;
        }
        const player = runQuery(PlayerKillQuery)[0];
        if (!player || player[0] === uuid || player[2].target !== uuid) {
            return;
        }
        const env = world.resources.get(MissionEnvResource);
        if (env && govt?.id) {
            deactivateRanksOnShipLoss(state, govt.id, env);
        }
        queuePlayerStateSave();
    },
});

export const CombatRatingPlugin: Plugin = {
    name: 'CombatRatingPlugin',
    build(world) {
        world.addSystem(PlayerKillSystem);
        world.addSystem(PlayerDisableSystem);
    },
};
