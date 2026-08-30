import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { MissionGameDataResource, MissionPlugin } from "../missions/mission_plugin";
import { GameDataResource } from "./game_data_resource";


export const SystemComponent = new Component<World>('SystemComponent');

const StepSystemSystem = new System({
    name: "StepSystemSystem",
    args: [SystemComponent] as const,
    step(system) {
        system.step();
    }
});

export const NovaPlugin: Plugin = {
    name: 'NovaPlugin',
    async build(world) {
        world.addSystem(StepSystemSystem);

        // Register the player-state and mission plugins on the outer world;
        // makeSystem does the same for each per-system world, sharing the
        // PlayerState and mission env across worlds. The game data bridge
        // lets MissionPlugin load its env without importing GameDataResource
        // here (missions/ deliberately has no nova_plugin/ dependency).
        const gameData = world.resources.get(GameDataResource);
        if (gameData) {
            world.resources.set(MissionGameDataResource, gameData);
        }
        await world.addPlugin(MissionPlugin);
    }
}

