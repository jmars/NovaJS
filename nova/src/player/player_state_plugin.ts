// Registers the PlayerState resource on a world. The client sets the loaded
// (or newly created) pilot on the world BEFORE adding this plugin; the
// fallback here keeps standalone worlds (REPL, tests) working without one.

import { getDefaultCharData } from "novadatainterface/CharData";
import { Plugin } from "nova_ecs/plugin";
import { World } from "nova_ecs/world";
import { createNewPilot } from "./pilot_files";
import { PlayerStateResource } from "./player_state_component";

export const PlayerStatePlugin: Plugin = {
    name: 'PlayerStatePlugin',
    build(world: World) {
        if (!world.resources.has(PlayerStateResource)) {
            world.resources.set(PlayerStateResource,
                createNewPilot(getDefaultCharData(),
                    Math.floor(Math.random() * 0x7fffffff)));
        }
    }
};
