import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Entities, GetWorld } from "nova_ecs/arg_types";
import { AsyncSystem } from "nova_ecs/async_system";
import { Resource } from "nova_ecs/resource";
import { SingletonComponent, World } from "nova_ecs/world";
import { PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { MissionGameDataResource, MissionPlugin } from "../missions/mission_plugin";
import { GameDataResource } from "./game_data_resource";
import { makePlanet } from "./make_planet";
import { SystemIdResource } from "./system_id_resource";
import { SystemPlugin } from "./system_plugin";


const AddedPlanetsResource = new Resource<{ val: boolean }>('AddedPlanetsResource');

const MakePlanetsSystem = new AsyncSystem({
    name: 'MakePlanetsSystem',
    args: [GameDataResource, SystemIdResource, Entities, GetWorld,
        AddedPlanetsResource, SingletonComponent] as const,
    exclusive: true,
    async step(gameData, systemId, entities, world, addedPlanets) {
        if (addedPlanets.val) {
            world.removeSystem(MakePlanetsSystem);
            return;
        }
        const systemData = await gameData.data.System.get(systemId);
        for (const planetId of systemData.planets) {
            const planetData = await gameData.data.Planet.get(planetId);
            const planet = makePlanet(planetData);
            entities.set(`planet ${planetId}`, planet);
        }
        addedPlanets.val = true;
    }
});

export function makeSystem(systemId: string, gameData: GameDataInterface,
    playerState?: PlayerState) {
    //const system = await gameData.data.System.get(systemId);
    const world = new World(systemId);

    world.resources.set(AddedPlanetsResource, { val: false });
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource, systemId);
    // The player state is shared across system worlds, like the game data.
    if (playerState !== undefined) {
        world.resources.set(PlayerStateResource, playerState);
    }
    // Mission state rides along with it: bridge the game data for the
    // mission env and register MissionPlugin on this world (it loads the
    // env asynchronously; mission systems guard on the resource).
    world.resources.set(MissionGameDataResource, gameData);
    void world.addPlugin(MissionPlugin);
    world.addSystem(MakePlanetsSystem);
    world.addPlugin(SystemPlugin);

    return world;
}
