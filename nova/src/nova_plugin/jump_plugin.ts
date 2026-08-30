import { Emit, Entities, GetEntity, UUID, GetWorld } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { EcsEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { Provide } from "nova_ecs/provide";
import { System } from "nova_ecs/system";
import { deImmerify } from "../util/deimmerify";
import { advanceDate } from "../player/date";
import { applyCargoDecay, DecayEffect } from "../player/cargo_decay";
import { applyDailySalaries } from "../player/ranks";
import { makeRng } from "../player/pilot_files";
import { PlayerStateResource } from "../player/player_state_component";
import {
    jumpRerollSeed,
    rerollAvailRandomRolls,
    MissionEnv,
} from "../missions/mission_state_machine";
import { MessageLogResource } from "../display/message_log";
import { shipFreeCargoTons } from "./ship_plugin";
import { cronSeed, CronRunResult, makeCronEnv, processCrons } from "../missions/cron_scheduler";
import {
    ensureMissionEnv,
    MissionEnvResource,
    queuePlayerStateSave,
} from "../missions/mission_plugin";
import { ControlStateEvent } from "./control_state_event";
import { World } from "nova_ecs/world";
import { PlayerShipSelector } from "./player_ship_plugin";
import { snapshotPlayerShip } from "./ship_snapshot";
import { SystemIdResource } from "./system_id_resource";

export interface InitiateJump {
    to: string /* system uuid */,
}
export const InitiateJumpEvent = new EcsEvent<InitiateJump>('InitiateJumpEvent');

export type JumpRoute = {
    route: string[],
};
export const JumpRouteComponent = new Component<JumpRoute>('JumpRouteComponent');
const JumpRouteProvider = Provide({
    name: 'JumpRouteProvider',
    args: [PlayerShipSelector] as const,
    provided: JumpRouteComponent,
    factory() {
        return { route: [] };
    }
});

export interface FinishJump {
    entity: Entity,
    uuid: string,
    to: string,
}
export const FinishJumpEvent = new EcsEvent<FinishJump>('FinishJumpEvent');

const JumpFromSystem = new System({
    name: 'JumpFromSystem',
    events: [InitiateJumpEvent],
    args: [GetEntity, UUID, Entities, InitiateJumpEvent, Emit] as const,
    step(entity, uuid, entities, { to }, emit) {
        entities.delete(uuid);
        // TODO: Animation etc.
        deImmerify(entity);
        emit(FinishJumpEvent, { entity, uuid, to });
    }
});

const PlayerJumpControl = new System({
    name: 'PlayerJumpControl',
    events: [ControlStateEvent],
    args: [ControlStateEvent, Emit, UUID, SystemIdResource, JumpRouteComponent,
        PlayerShipSelector] as const,
    step(controlState, emit, uuid, systemId, jumpRoute) {
        if (controlState.get('hyperjump') === 'start') {
            // TODO: Prevent this from being called twice before a jump.
            const nextSystem = jumpRoute.route.shift();
            if (nextSystem) {
                emit(InitiateJumpEvent, { to: nextSystem }, [uuid]);
            }
        }
    }
});

// One Nova day passes per hyperspace jump: on arriving in `to`, advance the
// pilot's date, mark the system explored, and re-roll every mission's
// AvailRandom roll (seeded by pilot seed + date, so reloads and multiplayer
// peers compute the same rolls and see the same mission board).
// Exported for cross-plugin ordering (scan_plugin runs after it), like
// mission_ship_plugin's MissionShipDeathSystem.
export const MissionJumpStateSystem = new System({
    name: 'MissionJumpStateSystem',
    events: [FinishJumpEvent],
    args: [FinishJumpEvent, GetWorld] as const,
    step({ entity, to }, world) {
        const playerState = world.resources.get(PlayerStateResource);
        if (!playerState) {
            return;
        }
        playerState.date = advanceDate(playerState.date, 1);
        if (!playerState.exploredSystems.includes(to)) {
            playerState.exploredSystems.push(to);
        }
        playerState.currentSystem = to;
        const env = world.resources.get(MissionEnvResource);
        if (env) {
            rerollAvailRandomRolls(playerState, env.allMissionIds(),
                makeRng(jumpRerollSeed(playerState)));
            // One jump = one game day = one salary day (ranks.ts).
            const paid = applyDailySalaries(playerState,
                env.rank ? { rank: env.rank } : null);
            if (paid > 0) {
                console.info('[missions]', `salary paid: ${paid}`);
            }
            // One jump = one game day of hold decay too (cargo_decay.ts):
            // tribbles multiply, perishables spoil. Covered by the save
            // below; headless worlds simply have no log resource.
            const decay = applyCargoDecay(playerState.cargo,
                type => env.junk?.(type)?.flags,
                shipFreeCargoTons(entity, playerState));
            if (decay.effects.length > 0) {
                playerState.cargo = decay.cargo;
                logDecay(world, decay.effects, env);
            }
            // Cröns fire after the date advance, on their own seeded stream
            // (cron_scheduler.ts). The save below covers their state too.
            const cronEnv = makeCronEnv(env);
            if (cronEnv) {
                const run = processCrons(playerState, cronEnv,
                    makeRng(cronSeed(playerState)));
                logCrons(run);
            }
        }
        // Snapshot the ship (it rides this event) so outfit/ship changes
        // survive a reload; covered by the save below.
        snapshotPlayerShip(entity, playerState);
        queuePlayerStateSave();
    }
});

// The decay lines land on the message log when the display layer loaded it
// (the boardMessage pattern in mission_ship_plugin.ts).
function logDecay(world: World, effects: DecayEffect[], env: MissionEnv): void {
    for (const effect of effects) {
        const name = env.junk?.(effect.type)?.lcName ?? `cargo ${effect.type}`;
        const text = effect.qty > 0
            ? `Your ${name} multiplied by ${effect.qty} tons.`
            : `${-effect.qty} tons of your ${name} spoiled.`;
        console.info('[missions]', text);
        world.resources.get(MessageLogResource)?.addMessage(text);
    }
}

function logCrons(run: CronRunResult): void {
    if (!run.fired) {
        return;
    }
    console.info('[missions]', `crons fired: started [${run.started.join(", ")}] `
        + `ended [${run.ended.join(", ")}]`);
}

// For a single system to emit jump events.
export const JumpPlugin: Plugin = {
    name: 'JumpPlugin',
    async build(world) {
        world.addSystem(JumpFromSystem);
        world.addSystem(PlayerJumpControl);
        world.addSystem(JumpRouteProvider);
        // Loads the mission env into MissionEnvResource (no-op when another
        // plugin already did) so the warp-in roll re-uses cached data.
        await ensureMissionEnv(world);
        world.addSystem(MissionJumpStateSystem);
    }
};

// // Pass jump events between systems.
// // TODO: Support changing set of systems.
// export const WorldJumpPlugin: Plugin = {
//     name: 'WorldJumpPlugin',
//     build(world) {
//         const systems = world.resources.get(SystemsResource);
//         if (!systems) {
//             throw new Error('World must have systems resource');
//         }

//         for (const [, system] of systems) {
//             system.events.get(FinishJumpEvent).subscribe(
//                 ({ entity, to, uuid }) => {
//                     const destination = systems.get(to) ?? system;
//                     destination.entities.set(uuid, entity);
//                 });
//         }
//     }
// }
