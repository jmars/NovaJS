import { Emit, Entities, GetEntity, GetWorld, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { Provide } from 'nova_ecs/provide';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { GameData } from '../client/gamedata/GameData';
import { ControlsSubject } from '../nova_plugin/controls_plugin';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { LandEvent, LiftoffEvent, PlanetComponent } from '../nova_plugin/planet_plugin';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { snapshotPlayerShip } from '../nova_plugin/ship_snapshot';
import { shipFreeCargoTons } from '../nova_plugin/ship_plugin';
import { applyCargoEffects } from '../player/cargo';
import { PlayerStateResource } from '../player/player_state_component';
import { processArrival } from '../missions/mission_state_machine';
import {
    ensureMissionEnv,
    MissionEnvResource,
    MissionGameDataResource,
    queuePlayerStateSave,
} from '../missions/mission_plugin';
import { Spaceport } from '../spaceport/spaceport';
import { deImmerify } from '../util/deimmerify';
import { ResizeEvent, ScreenSize } from './screen_size_plugin';
import { Stage } from './stage_resource';


const SpaceportComponent = new Component<Spaceport>("Spaceport");

const SpaceportProvider = Provide({
    name: "SpaceportProvider",
    provided: SpaceportComponent,
    args: [GameDataResource, ControlsSubject, Stage, PlanetComponent, GetWorld] as const,
    factory(gameData, controls, stage, { id }, world) {
        // The mission state rides on the world (PlayerStatePlugin and
        // MissionPlugin set these resources); without them the spaceport
        // works but has no BBS/bar/mission UI.
        const playerState = world?.resources.get(PlayerStateResource);
        const env = world?.resources.get(MissionEnvResource);
        const spaceport = new Spaceport(gameData as GameData, id, controls,
            playerState && env ? { playerState, env } : undefined);
        stage.addChild(spaceport.container);
        return spaceport;
    }
});

const SpaceportQuery = new Query([SpaceportComponent] as const);

const LandSystem = new System({
    name: 'LandSystem',
    events: [LandEvent],
    args: [LandEvent, UUID, Entities, RunQuery, ScreenSize, GetEntity, GetWorld, PlayerShipSelector] as const,
    step({ id, uuid }, shipUuid, entities, runQuery, { x, y }, playerShip, world) {
        const spaceport = runQuery(SpaceportQuery, uuid)[0]?.[0];
        if (!spaceport) {
            return;
        }

        // Arrival processing runs before the spaceport UI opens: mission
        // travel/return matching (duplicate stellars included), deadline
        // expiry and cargo pickup/dropoff. Landing does not advance the day
        // (that happens per jump). Effects carry the texts/effects the
        // dialog UI (P5) will present; they are logged for now. The cargo
        // effects are real: they move tons into (or out of) the pilot's
        // hold, capped by the free space on the landing ship.
        const stateResource = world?.resources.get(PlayerStateResource);
        const missionEnv = world?.resources.get(MissionEnvResource);
        if (stateResource && missionEnv) {
            stateResource.lastStellar = id;
            if (!stateResource.landedSystems.includes(id)) {
                stateResource.landedSystems.push(id);
            }
            // Before entities.delete below — the ship entity still carries
            // the physics while we need its capacity.
            const freeCargoTons = shipFreeCargoTons(playerShip, stateResource);
            const arrival = processArrival(stateResource, missionEnv, id,
                freeCargoTons);
            const moved = applyCargoEffects(stateResource, arrival.effects,
                freeCargoTons);
            for (const effect of arrival.effects) {
                console.info('[missions]', JSON.stringify(effect));
            }
            if (arrival.completed.length > 0 || arrival.failed.length > 0
                || moved.loaded > 0 || moved.unloaded > 0) {
                queuePlayerStateSave();
            }
        }

        entities.delete(shipUuid);
        deImmerify(playerShip);

        spaceport.container.position.x = x / 2;
        spaceport.container.position.y = y / 2;
        // AvailLoc-3 (main spaceport) offers auto-popup before the spaceport
        // menu becomes interactive; then the menu runs to departure.
        spaceport.showLandingOffers(playerShip)
            .then(() => spaceport.show(playerShip))
            .then(newShip => {
                // Capture outfitter/shipyard/trade changes into the pilot's
                // ship snapshot before the ship returns to the world. The
                // previous snapshot is kept when the new ship has no Ship
                // component to encode.
                const playerState = world?.resources.get(PlayerStateResource);
                if (playerState && snapshotPlayerShip(newShip, playerState)) {
                    queuePlayerStateSave();
                }
                entities.set(shipUuid, newShip);
                // The ship is back in the world. Liftoff itself never
                // repopulates (FUN_0041af90's only in-flight caller is the
                // landing transition, FUN_00457580); the event is emitted
                // for display/logic consumers.
                world?.emit(LiftoffEvent, { id, uuid: shipUuid }, [newShip]);
            });
    }
});

const SpaceportResizeSystem = new System({
    name: 'SpaceportResize',
    events: [ResizeEvent],
    args: [ResizeEvent, SpaceportComponent] as const,
    step({ x, y }, spaceport) {
        spaceport.container.position.x = x / 2;
        spaceport.container.position.y = y / 2;
    }
});

export const SpaceportPlugin: Plugin = {
    name: 'SpaceportPlugin',
    async build(world) {
        // Bridge the game data for the mission env and load the env so the
        // LandSystem can run arrival processing at step time.
        const gameData = world.resources.get(GameDataResource);
        if (gameData) {
            world.resources.set(MissionGameDataResource, gameData);
        }
        await ensureMissionEnv(world);
        world.addSystem(SpaceportProvider);
        world.addSystem(LandSystem);
        world.addSystem(SpaceportResizeSystem);
    },
    remove(world) {
        world.removeSystem(SpaceportProvider);
        world.removeSystem(LandSystem);
        world.removeSystem(SpaceportResizeSystem);
    }
}
