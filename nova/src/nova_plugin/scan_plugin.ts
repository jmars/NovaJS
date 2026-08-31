// In-flight smuggling enforcement (FUN_00401800): the trigger and gates
// live in npc_ai_plugin.ts's InterceptorScanSystem (the AI-4 hail at the
// 100px square), which emits NpcHailEvent once the hail fires. The
// ScanSystem below consumes that event and applies the outcome the pure
// rules in player/smuggling.ts compute: the flag 0x0020 mission
// quick-fail (no fine) or the fine (no record change either way), then
// the log and the pilot save; on a catch it makes the hailing ship ATTACK
// the player (FUN_00401800's tail: target 0, state 4).
//
// (This module must stay out of npc_ai_plugin's import graph: message_log
// pulls in pers_plugin, which needs npc_ai_plugin's AggroRangeSystem at
// load.)

import { GetWorld } from "nova_ecs/arg_types";
import { Plugin } from "nova_ecs/plugin";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { MessageLogResource } from "../display/message_log";
import {
    MissionEffect,
    reportFailureEvent,
} from "../missions/mission_state_machine";
import { MissionEnvResource, queuePlayerStateSave } from "../missions/mission_plugin";
import { PlayerStateResource } from "../player/player_state_component";
import { scanCheck, smuggledMissions } from "../player/smuggling";
import { NpcHailEvent } from "./npc_ai_plugin";
import { Optional } from "nova_ecs/optional";
import { GovernmentComponent } from "./npc_plugin";
import { TargetComponent } from "./target_component";

// Runs one FUN_00401800 hold scan by `govt` (the hailing ship's assigned
// government) over the pilot's hold, and applies the catch: the first
// caught mission carrying flag 0x0020 ("fails if scanned") quick-fails
// through the FSM with NO fine (binary FUN_00440bf0); any other catch is
// fined with NO record change (the binary never records a mission-cargo
// catch). Logs the outcome and queues the pilot save. Returns true when
// something was caught.
export function smugglingScan(world: World, govtId: string): boolean {
    const state = world.resources.get(PlayerStateResource);
    const env = world.resources.get(MissionEnvResource);
    const govt = env?.government(govtId) ?? null;
    if (!state || !env || !govt) {
        return false;
    }

    const result = scanCheck(env, govt, state.cargo, state.activeMissions,
        state.credits);
    if (!result.illegal) {
        return false;
    }

    // The first caught mission decides the branch (one catch per scan):
    // flag 0x0020 and not already failed -> quick-fail, else the fine.
    const caught = smuggledMissions(env, govt, state.activeMissions);
    const first = caught[0];
    const effects: MissionEffect[] = [];
    if (first && (first.mission.flags & 0x0020) !== 0
        && !first.active.failed) {
        effects.push(...reportFailureEvent(state, first.mission, first.active,
            env, "scanned"));
    }
    else if (result.fine > 0) {
        state.credits = Math.max(0, state.credits - result.fine);
    }

    const lines = [result.fine > 0
        ? `The ${govt.name} authorities fined you ${result.fine} credits for smuggling.`
        : `The ${govt.name} authorities scanned your hold and found illegal cargo.`];
    for (const effect of effects) {
        console.info('[smuggling]', JSON.stringify(effect));
        if (effect.kind === 'text') {
            lines.push(effect.text);
        }
    }
    for (const line of lines) {
        console.info('[smuggling]', line);
        world.resources.get(MessageLogResource)?.addMessage(line);
    }
    queuePlayerStateSave();
    return true;
}

const ScanSystem = new System({
    name: 'ScanSystem',
    events: [NpcHailEvent],
    // The hail names its hailing ship as the event's entity, so the
    // components resolve off the interceptor.
    args: [NpcHailEvent, GetWorld, Optional(TargetComponent),
        Optional(GovernmentComponent)] as const,
    step({ target }, world: World, shipTarget, govt) {
        if (target === undefined || shipTarget === undefined
            || govt === undefined || govt.id === null) {
            // Not a smuggling hail, or the ship has no assigned government
            // (the binary's govt == -1 gate).
            return;
        }
        if (smugglingScan(world, govt.id)) {
            // FUN_00401800's catch tail: attack the player (target 0,
            // state 4). AggroRange keeps a live target, so this sticks.
            shipTarget.target = target;
        }
    },
});

export const ScanPlugin: Plugin = {
    name: 'ScanPlugin',
    build(world) {
        world.addSystem(ScanSystem);
    },
};
