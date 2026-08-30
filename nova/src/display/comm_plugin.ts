// The bridge from a hail to the comm dialog (P4 of the ship-interaction
// layer): when the hailed ship carries a përs with a LinkMission, opens the
// CommDialog through offerPersMission (comm_dialog.ts) and despawns the
// përs's ship when the accepted mission's flags say it departs or is
// replaced. Hails without an offer are the message log's business
// (message_log.ts HailQuoteSystem); this plugin only handles the offer.
//
// While the dialog (or its briefing) is on screen, CommOpenResource swallows
// the hail/board keys so they cannot leak into flight.

import { Entities, GetWorld, RunQuery, UUID } from "nova_ecs/arg_types";
import { Plugin } from "nova_ecs/plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { World } from "nova_ecs/world";
import { GameData } from "../client/gamedata/GameData";
import * as PIXI from "pixi.js";
import { MissionEnv } from "../missions/mission_state_machine";
import { MissionEnvResource } from "../missions/mission_plugin";
import { persBoardOfferMissionId, persOfferMissionId } from "../missions/pers_offers";
import { ControlsSubject } from "../nova_plugin/controls_plugin";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { BoardedEvent, CommOpenResource, HailEvent } from "../nova_plugin/interaction_plugin";
import { PersComponent } from "../nova_plugin/pers_plugin";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin";
import { ShipComponent, shipFreeCargoTons } from "../nova_plugin/ship_plugin";
import { PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { ShipData } from "novadatainterface/ShipData";
import { BriefingDialog, GameMissionTextEnv } from "../spaceport/briefing";
import { CommDialog, offerPersMission } from "../spaceport/comm_dialog";
import { MissionUiEnv } from "../spaceport/mission_bbs";
import { Stage } from "./stage_resource";

// Assembles the offer/briefing environment for one hail, mirroring the
// spaceport's missionUi(): the player's ship feeds the offer text tags and
// the AvailShipType / AI-flag availability rules.
async function makeCommUi(gameData: GameData, state: PlayerState,
    env: MissionEnv, world: World, playerShipId: string | null):
    Promise<MissionUiEnv> {
    let shipData: ShipData | null = null;
    const shipId = playerShipId === null ? undefined
        : world.entities.get(playerShipId)?.components.get(ShipComponent)?.id;
    if (shipId) {
        try {
            shipData = await gameData.data.Ship.get(shipId);
        }
        catch {
            // Unknown ship type: rules treat it as unknown and pass.
        }
    }
    const name = shipData?.name ?? "";
    // The player's ship entity feeds the free-hold figure; without it the
    // capacity is unknown and the cargo rules pass.
    const playerShip = playerShipId === null ? undefined
        : world.entities.get(playerShipId);
    return {
        playerState: state,
        env,
        textEnv: new GameMissionTextEnv(env, gameData),
        gameData,
        // In flight there is no landed planet; offers resolve against the
        // last landed stellar (mission_bbs.computeShipOffers).
        landedStellarId: state.lastStellar ?? "",
        shipName: name,
        shipTypeName: name,
        shipData,
        shipInherentAI: shipData?.inherentAI ?? null,
        freeCargoTons: playerShip ? shipFreeCargoTons(playerShip, state) : null,
    };
}

interface CommBridge {
    commOpen: { open: boolean };
    containers: PIXI.Container[];
    open(target: string, playerShipId: string | null): Promise<void>;
}

// Set when the bridge is live (browser worlds with the UI resources); the
// hail system below is a no-op without it.
const CommBridgeResource = new Resource<CommBridge>('CommBridgeResource');

const PlayerQuery = new Query([UUID, PlayerShipSelector] as const);

const HailCommSystem = new System({
    name: 'HailCommSystem',
    events: [HailEvent] as const,
    // SingletonComponent: run once per event, not once per entity.
    args: [HailEvent, Entities, GetWorld, RunQuery,
        SingletonComponent] as const,
    step({ target }, entities, world, runQuery) {
        const bridge = world.resources.get(CommBridgeResource);
        if (!bridge || bridge.commOpen.open) {
            return;
        }
        const pers = entities.get(target)?.components.get(PersComponent);
        if (!pers || persOfferMissionId(pers.data) === null) {
            return;
        }
        const playerShipId = runQuery(PlayerQuery)[0]?.[0] ?? null;
        void bridge.open(target, playerShipId);
    },
});

// The board-route twin (përs flag 0x0200): the offer opens when the player
// boards the përs's ship instead of when they hail it.
const BoardCommSystem = new System({
    name: 'BoardCommSystem',
    events: [BoardedEvent] as const,
    // SingletonComponent: run once per event, not once per entity.
    args: [BoardedEvent, Entities, GetWorld, RunQuery,
        SingletonComponent] as const,
    step({ target }, entities, world, runQuery) {
        const bridge = world.resources.get(CommBridgeResource);
        if (!bridge || bridge.commOpen.open) {
            return;
        }
        const pers = entities.get(target)?.components.get(PersComponent);
        if (!pers || persBoardOfferMissionId(pers.data) === null) {
            return;
        }
        const playerShipId = runQuery(PlayerQuery)[0]?.[0] ?? null;
        void bridge.open(target, playerShipId);
    },
});

export const CommPlugin: Plugin = {
    name: 'CommPlugin',
    build(world) {
        // The client game data adds spriteFromPictAsync to the interface;
        // the structural guard below keeps headless worlds (plain
        // interfaces) out of the UI setup.
        const gameData = world.resources.get(GameDataResource) as
            GameData | undefined;
        const controls = world.resources.get(ControlsSubject);
        const stage = world.resources.get(Stage);
        const commOpen = world.resources.get(CommOpenResource);
        // Browser worlds only: the client game data (spriteFromPictAsync),
        // the control-event stream, the stage and the interaction plugin's
        // guard resource must all exist; headless worlds skip the UI
        // entirely.
        if (!gameData || !controls || !stage || !commOpen
            || typeof gameData.spriteFromPictAsync !== "function") {
            return;
        }

        const comm = new CommDialog(gameData, controls);
        stage.addChild(comm.container);
        const briefing = new BriefingDialog(gameData, controls);
        stage.addChild(briefing.container);

        const open = async (target: string, playerShipId: string | null) => {
            const state = world.resources.get(PlayerStateResource);
            const env = world.resources.get(MissionEnvResource);
            // Re-resolve: the ship may have died between the hail and now.
            const pers = world.entities.get(target)
                ?.components.get(PersComponent);
            if (!state || !env || !pers) {
                return;
            }
            commOpen.open = true;
            try {
                const ui = await makeCommUi(gameData, state, env, world,
                    playerShipId);
                // Flag 0x0200 përs offer on boarding; everyone else on hail.
                const outcome = await offerPersMission(ui, comm, briefing,
                    pers.data,
                    persBoardOfferMissionId(pers.data) !== null
                        ? "board" : "hail");
                // 0x0800 (departs) / 0x0040 (replaced by the mission's
                // special ship): the përs's ship leaves the system.
                if (outcome.persEffects?.leaves
                    || outcome.persEffects?.replacedByMission) {
                    world.entities.delete(target);
                }
            }
            finally {
                commOpen.open = false;
            }
        };

        world.resources.set(CommBridgeResource, {
            commOpen,
            containers: [comm.container, briefing.container],
            open,
        });
        world.addSystem(HailCommSystem);
        world.addSystem(BoardCommSystem);
    },
    remove(world) {
        world.removeSystem(HailCommSystem);
        world.removeSystem(BoardCommSystem);
        const bridge = world.resources.get(CommBridgeResource);
        world.resources.delete(CommBridgeResource);
        if (!bridge) {
            return;
        }
        const stage = world.resources.get(Stage);
        for (const container of bridge.containers) {
            stage?.removeChild(container);
        }
    },
};
