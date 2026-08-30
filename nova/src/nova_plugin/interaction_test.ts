// Headless World specs for the hail/board key wiring (P4): the 'start'-edge
// emission on the player's target, the disabled+proximity gate for boarding
// (live threshold and mission-ship latch), and the CommOpenResource guard
// that swallows the keys while a dialog owns them. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/interaction_test.ts \
//       --outfile=/tmp/interaction_test.js && node_modules/.bin/jasmine /tmp/interaction_test.js

import "jasmine";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { EcsEvent } from "nova_ecs/events";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { World } from "nova_ecs/world";
import { GameDataResource } from "./game_data_resource";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import { MissionEnvResource } from "../missions/mission_plugin";
import { makePlayerState, makeTestEnv } from "../missions/test_fixtures";
import { PlayerStateResource } from "../player/player_state_component";
import { ControlState, ControlStateEvent } from "./control_state_event";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import {
    BoardedEvent,
    CommOpenResource,
    HailEvent,
    InteractionPlugin,
} from "./interaction_plugin";
import { MissionShipComponent } from "./mission_ship_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { makeShip } from "./make_ship";
import { Stat } from "./stat";
import { SystemIdResource } from "./system_id_resource";
import { TargetComponent } from "./target_component";

const SHIP: ShipData = {
    ...getDefaultShipData(),
    id: "nova:600",
    name: "Test Ship",
};

function setHealth(ship: Entity, armorCurrent: number, shieldCurrent: number):
    void {
    ship.components.set(ArmorComponent,
        new Stat({ current: armorCurrent, max: 100, recharge: 0 }));
    ship.components.set(ShieldComponent,
        new Stat({ current: shieldCurrent, max: 100, recharge: 0 }));
}

function makeWorld(): World {
    const world = new World();
    world.resources.set(GameDataResource, new MockGameData());
    world.resources.set(SystemIdResource, "nova:300");
    world.resources.set(PlayerStateResource, makePlayerState());
    world.resources.set(MissionEnvResource, makeTestEnv().env);
    world.addPlugin(InteractionPlugin);
    return world;
}

function addShip(world: World, key: string, position: [number, number]): Entity {
    const ship = makeShip(SHIP);
    ship.components.set(TargetComponent, { target: undefined });
    ship.components.get(MovementStateComponent)!.position =
        new Position(position[0], position[1]);
    world.entities.set(key, ship);
    return ship;
}

function makePlayer(position: [number, number]): Entity {
    const ship = makeShip(SHIP);
    ship.components.set(TargetComponent, { target: undefined });
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.get(MovementStateComponent)!.position =
        new Position(position[0], position[1]);
    return ship;
}

function controls(action: 'hail' | 'board',
    state: false | 'start' | 'repeat' | true): ControlState {
    return new Map([[action, state]]);
}

function capture<T>(world: World, event: EcsEvent<T>): { events: T[] } {
    const events: T[] = [];
    world.events.get(event).subscribe(data => events.push(data));
    return { events };
}

describe("hail/board controls", () => {
    it("emits HailEvent on the 'start' edge only", () => {
        const world = makeWorld();
        const target = addShip(world, "target", [1000, 0]);
        const player = makePlayer([0, 0]);
        world.entities.set("player", player);
        player.components.set(TargetComponent, { target: target.uuid });
        const hails = capture<{ target: string }>(world, HailEvent);

        world.emit(ControlStateEvent, controls('hail', 'start'));
        world.step();
        expect(hails.events).toEqual([{ target: target.uuid }]);

        // Held key ('repeat' and the held 'true'): no re-trigger.
        world.emit(ControlStateEvent, controls('hail', 'repeat'));
        world.step();
        world.emit(ControlStateEvent, controls('hail', true));
        world.step();
        expect(hails.events.length).toEqual(1);

        // A fresh press hails again.
        world.emit(ControlStateEvent, controls('hail', 'start'));
        world.step();
        expect(hails.events.length).toEqual(2);
    });

    it("does not hail without a targeted ship", () => {
        const world = makeWorld();
        const ship = addShip(world, "target", [1000, 0]);
        const player = makePlayer([0, 0]);
        world.entities.set("player", player);
        const hails = capture<{ target: string }>(world, HailEvent);

        // No target at all.
        world.emit(ControlStateEvent, controls('hail', 'start'));
        world.step();
        expect(hails.events).toEqual([]);

        // A target that is not a ship (no ShipComponent) cannot be hailed.
        const notAShip = new Entity("debris");
        notAShip.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(100, 0),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        world.entities.set("debris", notAShip);
        player.components.set(TargetComponent, { target: notAShip.uuid });
        world.emit(ControlStateEvent, controls('hail', 'start'));
        world.step();
        expect(hails.events).toEqual([]);

        // Targeting a real ship works.
        player.components.set(TargetComponent, { target: ship.uuid });
        world.emit(ControlStateEvent, controls('hail', 'start'));
        world.step();
        expect(hails.events).toEqual([{ target: ship.uuid }]);
    });

    it("boards a disabled target in range", () => {
        const world = makeWorld();
        const target = addShip(world, "target", [100, 0]);
        const player = makePlayer([0, 0]);
        world.entities.set("player", player);
        player.components.set(TargetComponent, { target: target.uuid });
        const boards = capture<{ target: string }>(world, BoardedEvent);

        // Fully healthy: no boarding.
        setHealth(target, 100, 100);
        world.emit(ControlStateEvent, controls('board', 'start'));
        world.step();
        expect(boards.events).toEqual([]);

        // Hurt but above the 25% disable threshold: still no boarding.
        setHealth(target, 50, 40);
        world.emit(ControlStateEvent, controls('board', 'start'));
        world.step();
        expect(boards.events).toEqual([]);

        // Disabled (armor+shield/2 under 25% of total) and 100 units away
        // (under BOARD_PROXIMITY): boards.
        setHealth(target, 10, 0);
        world.emit(ControlStateEvent, controls('board', 'start'));
        world.step();
        expect(boards.events).toEqual([{ target: target.uuid }]);
    });

    it("refuses to board a disabled target out of range", () => {
        const world = makeWorld();
        const target = addShip(world, "target", [500, 0]);
        const player = makePlayer([0, 0]);
        world.entities.set("player", player);
        player.components.set(TargetComponent, { target: target.uuid });
        setHealth(target, 0, 0);
        const boards = capture<{ target: string }>(world, BoardedEvent);

        world.emit(ControlStateEvent, controls('board', 'start'));
        world.step();
        expect(boards.events).toEqual([]);
    });

    it("boards mission ships through the sticky disable latch alone", () => {
        const world = makeWorld();
        const target = addShip(world, "target", [100, 0]);
        // A mission ship latched as disabled whose stats have since
        // regenerated past the threshold: the latch still boards it.
        target.components.set(MissionShipComponent, {
            missionId: "nova:700",
            goal: 2,
            index: 0,
            aux: false,
            behav: -1,
            name: null,
            subtitle: null,
            disabled: true,
        });
        setHealth(target, 100, 100);
        const player = makePlayer([0, 0]);
        world.entities.set("player", player);
        player.components.set(TargetComponent, { target: target.uuid });
        const boards = capture<{ target: string }>(world, BoardedEvent);

        world.emit(ControlStateEvent, controls('board', 'start'));
        world.step();
        expect(boards.events).toEqual([{ target: target.uuid }]);
    });

    it("swallows hail and board while a comm dialog is open", () => {
        const world = makeWorld();
        const target = addShip(world, "target", [100, 0]);
        setHealth(target, 0, 0);
        const player = makePlayer([0, 0]);
        world.entities.set("player", player);
        player.components.set(TargetComponent, { target: target.uuid });
        const hails = capture<{ target: string }>(world, HailEvent);
        const boards = capture<{ target: string }>(world, BoardedEvent);

        const commOpen = world.resources.get(CommOpenResource)!;
        commOpen.open = true;
        world.emit(ControlStateEvent, controls('hail', 'start'));
        world.emit(ControlStateEvent, controls('board', 'start'));
        world.step();
        expect(hails.events).toEqual([]);
        expect(boards.events).toEqual([]);

        commOpen.open = false;
        world.emit(ControlStateEvent, controls('hail', 'start'));
        world.step();
        expect(hails.events).toEqual([{ target: target.uuid }]);
    });

    it("does not hail or board without the player", () => {
        const world = makeWorld();
        addShip(world, "target", [100, 0]);
        const hails = capture<{ target: string }>(world, HailEvent);
        const boards = capture<{ target: string }>(world, BoardedEvent);

        world.emit(ControlStateEvent, controls('hail', 'start'));
        world.emit(ControlStateEvent, controls('board', 'start'));
        world.step();
        expect(hails.events).toEqual([]);
        expect(boards.events).toEqual([]);
    });
});
