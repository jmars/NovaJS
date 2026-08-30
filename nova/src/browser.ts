import { Entity } from "nova_ecs/entity";
import { AddEvent } from "nova_ecs/events";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import Stats from 'stats.js';
import { v4 } from "uuid";
import { GameData } from "./client/gamedata/GameData";
import { CharData } from "novadatainterface/CharData";
import { DebugSettings } from "./debug_settings";
import { Display } from "./display/display_plugin";
import { PixiAppResource } from "./display/pixi_app_resource";
import { ResizeEvent } from "./display/screen_size_plugin";
import { Stage } from "./display/stage_resource";
import { GameDataResource } from "./nova_plugin/game_data_resource";
import { FinishJumpEvent } from "./nova_plugin/jump_plugin";
import { makeShip } from "./nova_plugin/make_ship";
import { makeSystem } from "./nova_plugin/make_system";
import { NovaPlugin, SystemComponent } from "./nova_plugin/nova_plugin";
import { PlayerShipSelector } from "./nova_plugin/player_ship_plugin";
import { decodeShipSnapshot, snapshotPlayerShip } from "./nova_plugin/ship_snapshot";
import { SystemIdResource } from "./nova_plugin/system_id_resource";
import { PlayerState } from "./player/player_state";
import { PlayerStateComponent, PlayerStateResource } from "./player/player_state_component";
import {
    DEFAULT_CHAR_ID,
    createNewPilot,
    deserializePlayerState,
    serializePlayerState,
} from "./player/pilot_files";
import { getOrCreatePilotUuid } from "./player/pilot_uuid";


const gameData = new GameData();
(window as any).gameData = gameData;
(window as any).PIXI = PIXI;

const pixelRatio = window.devicePixelRatio || 1;
PIXI.settings.RESOLUTION = pixelRatio;
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;

// TODO: Using WebGL 1 (instead of 2) seems to make the game smoother, but
// this will likely change in the future.
//PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL2;
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    autoDensity: true
});

(window as any).app = app;
document.body.appendChild(app.view as any);

let world: World;
let system: World | undefined;

// --- Pilot persistence ---

const PLAYER_STATE_SAVE_DEBOUNCE_MS = 2000;

function pilotMirrorKey(uuid: string): string {
    return "novajs-pilot-" + uuid;
}

// Reads the pilot for this browser's pilot uuid from the localStorage
// mirror, falling back to a new pilot created from the default chär
// (the full new-pilot intro UI arrives with P5).
async function loadPlayerState():
    Promise<{ state: PlayerState, charData: CharData, isNew: boolean }> {
    const uuid = getOrCreatePilotUuid();
    const ids = await gameData.ids;
    const charData = await gameData.data.Char.get(ids.Char[0] ?? DEFAULT_CHAR_ID);

    let state: PlayerState | null = null;
    try {
        const mirrored = window.localStorage.getItem(pilotMirrorKey(uuid));
        if (mirrored !== null) {
            state = deserializePlayerState(JSON.parse(mirrored));
        }
    }
    catch (e) {
        console.warn("Failed to load mirrored pilot", e);
    }

    if (!state) {
        return {
            state: createNewPilot(charData, Math.floor(Math.random() * 0x7fffffff)),
            charData,
            isNew: true,
        };
    }
    return { state, charData, isNew: false };
}

// Saves immediately to the localStorage mirror.
function savePlayerStateNow(uuid: string, state: PlayerState): void {
    const file = JSON.stringify(serializePlayerState(state));
    try {
        window.localStorage.setItem(pilotMirrorKey(uuid), file);
    }
    catch (e) {
        console.warn("Failed to mirror pilot to localStorage", e);
    }
}

let saveTimeout: number | undefined;

// Debounced save: call after every PlayerState mutation (P4+ wires the
// mutation points); calls within the window coalesce into one save.
function savePlayerState(uuid: string, state: PlayerState): void {
    window.clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(
        () => savePlayerStateNow(uuid, state), PLAYER_STATE_SAVE_DEBOUNCE_MS);
}

async function jumpTo({ entity, to, uuid }: { entity: Entity, to: string, uuid: string }) {
    if (system) {
        system.entities.delete(uuid);
        const stage = system.resources.get(Stage);
        if (stage) {
            app.stage.removeChild(stage);
        }
        const currentSystemUuid = system.resources.get(SystemIdResource);
        if (currentSystemUuid) {
            world.entities.delete(currentSystemUuid);
        }
        await system.removeAllPlugins();
    }

    // The player state survives system swaps by being shared between worlds.
    const newSystem = makeSystem(to, gameData, world.resources.get(PlayerStateResource));
    (window as any).novaDebug = new DebugSettings(newSystem, (window as any).novaDebug);

    (window as any).system = newSystem;
    newSystem.resources.set(PixiAppResource, app);
    await newSystem.addPlugin(Display);

    const newStage = newSystem.resources.get(Stage);
    if (!newStage) {
        throw new Error('World did not have Pixi Stage');
    }
    app.stage.addChild(newStage);
    newStage.visible = true;

    newSystem.events.get(FinishJumpEvent).subscribe(jumpTo);

    world.entities.set(to, new Entity()
        .addComponent(SystemComponent, newSystem));

    newSystem.entities.set(uuid, entity);
    system = newSystem;
}

async function startGame() {
    world = new World();
    world.resources.set(GameDataResource, gameData);
    // Bundle textures must be in the Assets cache before any plugin runs:
    // spaceport's synchronous spriteFromPict would otherwise miss and hit
    // the network. No-op (resolves immediately) in fallback mode.
    await gameData.texturesReady;
    await world.addPlugin(NovaPlugin);

    // Load (or create) the pilot for this browser, and register it on the
    // outer world so it is shared into every system world on jump.
    const { state: playerState, charData, isNew } = await loadPlayerState();
    world.resources.set(PlayerStateResource, playerState);

    const uuid = getOrCreatePilotUuid();
    (window as any).playerState = playerState;
    (window as any).savePlayerState = () => savePlayerStateNow(uuid, playerState);
    (window as any).queueSavePlayerState = () => savePlayerState(uuid, playerState);

    // Make the player's ship: restore the snapshotted ship (type + outfits)
    // when present; on a corrupt/stale snapshot fall back to the chär's
    // starting ship and clear the snapshot so it doesn't fail forever.
    let shipEntity = playerState.shipSnapshot
        ? await decodeShipSnapshot(playerState.shipSnapshot, gameData)
        : null;
    if (!shipEntity && playerState.shipSnapshot) {
        playerState.shipSnapshot = null;
        savePlayerState(uuid, playerState);
    }
    if (!shipEntity) {
        const ids = await gameData.ids;
        const shipId = charData.startShipType ??
            ids.Ship[Math.floor(Math.random() * ids.Ship.length)];
        const shipData = await gameData.data.Ship.get(shipId);
        shipEntity = makeShip(shipData);
    }
    shipEntity.components.set(PlayerStateComponent, playerState);
    shipEntity.components.set(PlayerShipSelector, undefined);

    // Persist the ship (type + outfits) so outfit/shipyard changes survive a
    // reload. For a new pilot this is the first snapshot; the initial save
    // below carries it.
    snapshotPlayerShip(shipEntity, playerState);
    if (isNew) {
        savePlayerStateNow(uuid, playerState);
    }

    const systemId = playerState.currentSystem;

    await jumpTo({
        entity: shipEntity,
        to: systemId,
        uuid: v4(),
    });

    // if (activeSystem) {
    //     await activeSystem.addPlugin(Display);

    //     const systemStage = activeSystem.resources.get(Stage);
    //     if (!systemStage) {
    //         throw new Error('World did not have Pixi Container');
    //     }
    //     app.stage.addChild(systemStage);
    //     systemStage.visible = true;
    // }

    // system.events.get(FinishJumpEvent).subscribe(
    // ({ entity, to, uuid }) => {

    //     const destination = systems.get(to) ?? system;
    //     destination.entities.set(uuid, entity);
    // });



    // Set active system when the player ship is added    
    // for (const [systemId, system] of systems) {
    //     system.events.get(AddEvent).subscribe(([, entity]) => {
    //         //console.log('hi');
    //         if (entity.components.has(PlayerShipSelector) &&
    //             system !== activeSystem) {
    //             console.log(`Player ship is in ${systemId}`);
    //             const systemStage = activeSystem?.resources.get(Stage);
    //             if (systemStage) {
    //                 app.stage.removeChild(systemStage);
    //             }

    //             activeSystem?.removePlugin(Display);
    //             activeSystem = system;
    //             activeSystem.addPlugin(Display);

    //             const newSystemStage = activeSystem?.resources.get(Stage);

    //             if (!newSystemStage) {
    //                 throw new Error('World did not have Pixi Container');
    //             }
    //             app.stage.addChild(newSystemStage);
    //         }
    //     });
    // }
    // console.log('Got past for loop');

    (window as any).world = world;

    function resize() {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        system?.emit(ResizeEvent, { x: window.innerWidth, y: window.innerHeight });
    }
    window.onresize = resize;

    const stats = new Stats();
    document.body.appendChild(stats.dom);

    //(window as any).novaDebug = new DebugSettings(activeSystem);

    app.ticker.add(() => {
        stats.begin();
        world.step();
        //activeSystem?.step();
        stats.end();
    });
}

startGame()




