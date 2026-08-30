// Planetary scan enforcement on system entry (P3): when the player warps
// in, the system's government (first inhabited planet's, per smuggling.ts)
// may scan the hold. Thin ECS glue over the pure rules in
// player/smuggling.ts — it applies the outcome the FSM-free module computes:
// the fine, the SmugPenalty record hit (mission cargo only), and the flag
// 0x0020 mission failures, then logs and saves.
//
// Runs after MissionJumpStateSystem so a scan-caught failure lands on the
// post-jump state (date already advanced, missions re-rolled) — the same
// state the player then sees.

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
import { changeRecord } from "../player/legal_status";
import { PlayerStateResource } from "../player/player_state_component";
import { scanCheck, smuggledMissions, systemGovernment } from "../player/smuggling";
import { FinishJumpEvent, MissionJumpStateSystem } from "./jump_plugin";

const ScanSystem = new System({
    name: 'ScanSystem',
    events: [FinishJumpEvent],
    after: [MissionJumpStateSystem],
    args: [FinishJumpEvent, GetWorld] as const,
    step({ to }, world: World) {
        const state = world.resources.get(PlayerStateResource);
        if (!state) {
            return;
        }
        const env = world.resources.get(MissionEnvResource);
        if (!env) {
            return;
        }

        const result = scanCheck(state, env, to, state.cargo, state.activeMissions);
        if (!result.illegal) {
            return;
        }
        const govtId = systemGovernment(env, to);
        const govt = govtId === null ? null : env.government(govtId);
        if (!govt) {
            return;
        }

        if (result.fine > 0) {
            state.credits = Math.max(0, state.credits - result.fine);
        }
        // The SmugPenalty record hit is tied to mission-defined cargo
        // (Bible 1387); a jünk-only catch is fined but not recorded.
        if (result.reason === 'mission' && govt.penalties.smuggling !== 0) {
            changeRecord(state, govt.id, -govt.penalties.smuggling, env);
        }
        // Flag 0x0020 missions fail on being scanned carrying their cargo
        // (Bible 1577); reportFailureEvent runs onFailure and the -CompReward
        // record hit through the FSM. smuggledMissions returns a fresh array,
        // so failMission's removals under us are safe.
        const effects: MissionEffect[] = [];
        for (const { mission, active }
            of smuggledMissions(env, govt, state.activeMissions)) {
            effects.push(...reportFailureEvent(state, mission, active, env, "scanned"));
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
    }
});

export const ScanPlugin: Plugin = {
    name: 'ScanPlugin',
    build(world) {
        world.addSystem(ScanSystem);
    },
};
