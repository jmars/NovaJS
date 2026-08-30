// Headless World specs for the player escort fleet (Phase 3 of
// cargo+capture): escorts spawn from PlayerState.fleet on system-world
// build (deterministic formation, owned by the player, no autonomous AI),
// form up on the player, defend them, leave the fleet on death, and the
// fleet survives the pilot_files codec. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/escort_test.ts \
//       --outfile=/tmp/escort_test.js && node_modules/.bin/jasmine /tmp/escort_test.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { World } from "nova_ecs/world";
import { MissionEnvResource } from "../missions/mission_plugin";
import { makePlayerState, makeTestEnv } from "../missions/test_fixtures";
import { deserializePlayerState, serializePlayerState } from "../player/pilot_files";
import { EscortOrder } from "../player/escort_ops";
import { FleetState, PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { ControlState, ControlStateEvent } from "./control_state_event";
import { ControlAction } from "./controls";
import { DamagedEvent, DeathEvent } from "./death_plugin";
import { EscortComponent, EscortPlugin } from "./escort_plugin";
import { GameDataResource } from "./game_data_resource";
import { AIConfigComponent, AIStateComponent } from "./npc_ai_plugin";
import { ChooseRandomTargetComponent } from "./npc_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { SystemIdResource } from "./system_id_resource";
import { TargetComponent } from "./target_component";

const SHIP_ID = "nova:600";
const SHIP = { ...getDefaultShipData(), id: SHIP_ID, name: "Escort Ship" };
const PLAYER_UUID = "player-ship";
const ATTACKER_UUID = "attacker-ship";

// Fresh fleet per world: EscortDeathSystem mutates state.fleet, so sharing
// one constant across specs would corrupt later worlds.
function makeFleet(): FleetState {
    return {
        escorts: [
            { id: "1", shipType: SHIP_ID },
            { id: "2", shipType: SHIP_ID },
        ],
        nextId: 3,
    };
}

const DAMAGE = {
    shield: 1,
    armor: 1,
    ionization: 0,
    ionizationColor: 0,
    passThroughShield: 0,
    knockback: 0,
};

function makePlayerShip(position: [number, number] = [5000, 5000]): Entity {
    const ship = makeNpcShip(position);
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(TargetComponent, { target: undefined });
    return ship;
}

// The control-state snapshot one key press produces ('start' edge).
function controls(action: ControlAction,
    state: 'start' | false = 'start'): ControlState {
    return new Map([[action, state]]);
}

// Captures queuePlayerStateSave (the mission_plugin global hook) for the
// duration of `run`.
async function countSaves(run: () => Promise<void> | void): Promise<number> {
    let saves = 0;
    const global = globalThis as { queueSavePlayerState?: () => void };
    const previous = global.queueSavePlayerState;
    global.queueSavePlayerState = () => {
        saves += 1;
    };
    try {
        await run();
    }
    finally {
        global.queueSavePlayerState = previous;
    }
    return saves;
}

// A plain ship (an attacker or bystander): no PlayerShipSelector, so the
// defend system only sees the player ship as the player.
function makeNpcShip(position: [number, number] = [0, 0]): Entity {
    const ship = new Entity("Ship");
    ship.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(position[0], position[1]),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });
    return ship;
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

// Builds a system world for nova:300 with the given fleet and runs one
// spawn pass.
async function makeTestWorld(fleet: FleetState = makeFleet()) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);

    const { env } = makeTestEnv();
    const state: PlayerState = makePlayerState();
    state.fleet = fleet;

    const world = new World();
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource, "nova:300");
    world.resources.set(PlayerStateResource, state);
    world.resources.set(MissionEnvResource, env);
    world.addPlugin(EscortPlugin);
    // AsyncSystem applies its immer patches on the run after the async step
    // finishes, so a second world.step() (the game loop's next frame) is
    // what actually lands the spawned entities in the world.
    world.step();
    await flush();
    world.step();
    await flush();
    return {
        world,
        state,
        escorts: () => [...world.entities.values()].filter(entity =>
            entity.components.has(EscortComponent)),
    };
}

describe("escort spawning", () => {
    it("spawns one ship per fleet escort, owned by the player", async () => {
        const { escorts } = await makeTestWorld();
        expect(escorts().length).toEqual(2);

        const tags = escorts().map(ship =>
            ship.components.get(EscortComponent)!);
        expect(tags.map(tag => tag.escortId).sort()).toEqual(["1", "2"]);
        for (const tag of tags) {
            expect(tag.shipType).toEqual(SHIP_ID);
        }
        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toBeUndefined();
        }
    });

    it("strips the autonomous NPC AI components", async () => {
        const { escorts } = await makeTestWorld();
        for (const ship of escorts()) {
            expect(ship.components.has(AIConfigComponent)).toBeFalse();
            expect(ship.components.has(AIStateComponent)).toBeFalse();
            expect(ship.components.has(ChooseRandomTargetComponent))
                .toBeFalse();
        }
    });

    it("spawns at deterministic fixed formation offsets", async () => {
        const { escorts } = await makeTestWorld();
        const positions = escorts().map(ship =>
            ship.components.get(MovementStateComponent)!.position);
        expect(positions.map(position => [position.x, position.y]))
            .toEqual([[120, 0], [240, 0]]);

        // A second, independent spawn produces the identical formation.
        const second = await makeTestWorld();
        const repeat = second.escorts().map(ship =>
            ship.components.get(MovementStateComponent)!.position);
        expect(repeat.map(position => [position.x, position.y]))
            .toEqual(positions.map(position => [position.x, position.y]));
    });

    it("spawns nothing for an empty fleet", async () => {
        const { escorts } = await makeTestWorld({ escorts: [], nextId: 0 });
        expect(escorts().length).toEqual(0);
    });
});

describe("escort follow", () => {
    it("turns toward the player and accelerates when far away", async () => {
        const { world, escorts } = await makeTestWorld();
        const player = makePlayerShip([5000, 5000]);
        world.entities.set(PLAYER_UUID, player);
        const escort = escorts()[0];
        escort.components.get(MovementStateComponent)!.position =
            new Position(0, 0);

        world.step();

        const movement = escort.components.get(MovementStateComponent)!;
        expect(movement.turnTo).toEqual(PLAYER_UUID);
        expect(movement.accelerating).toEqual(1);
    });

    it("holds formation without accelerating once close", async () => {
        const { world, escorts } = await makeTestWorld();
        const player = makePlayerShip([5000, 5000]);
        world.entities.set(PLAYER_UUID, player);
        const escort = escorts()[0];
        escort.components.get(MovementStateComponent)!.position =
            new Position(5100, 5000);

        world.step();

        const movement = escort.components.get(MovementStateComponent)!;
        expect(movement.turnTo).toEqual(PLAYER_UUID);
        expect(movement.accelerating).toEqual(0);
    });

    it("never targets anything on its own", async () => {
        const { world, escorts } = await makeTestWorld();
        const player = makePlayerShip();
        world.entities.set(PLAYER_UUID, player);
        // An idle world with other ships around: the escort must stay
        // passive (the random-target AI would have picked a fight).
        world.entities.set(ATTACKER_UUID, makeNpcShip([0, 0]));

        world.step();
        world.step();

        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toBeUndefined();
        }
    });
});

describe("escort defend", () => {
    it("targets the attacker when the player is damaged", async () => {
        const { world, escorts } = await makeTestWorld();
        world.entities.set(PLAYER_UUID, makePlayerShip());
        world.entities.set(ATTACKER_UUID, makeNpcShip([0, 0]));

        world.emit(DamagedEvent,
            { damage: DAMAGE, damager: ATTACKER_UUID }, [PLAYER_UUID]);
        world.step();

        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toEqual(ATTACKER_UUID);
        }
    });

    it("ignores damage the player inflicted on themselves", async () => {
        const { world, escorts } = await makeTestWorld();
        world.entities.set(PLAYER_UUID, makePlayerShip());

        world.emit(DamagedEvent,
            { damage: DAMAGE, damager: PLAYER_UUID }, [PLAYER_UUID]);
        world.step();

        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toBeUndefined();
        }
    });

    it("ignores crossfire between the player's own escorts", async () => {
        const { world, escorts } = await makeTestWorld();
        world.entities.set(PLAYER_UUID, makePlayerShip());
        const shooter = escorts()[0];

        world.emit(DamagedEvent,
            { damage: DAMAGE, damager: shooter.uuid }, [PLAYER_UUID]);
        world.step();

        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toBeUndefined();
        }
    });

    it("does not react to damage on ships other than the player", async () => {
        const { world, escorts } = await makeTestWorld();
        world.entities.set(PLAYER_UUID, makePlayerShip());
        world.entities.set(ATTACKER_UUID, makeNpcShip([0, 0]));

        world.emit(DamagedEvent,
            { damage: DAMAGE, damager: PLAYER_UUID }, [ATTACKER_UUID]);
        world.step();

        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toBeUndefined();
        }
    });
});

describe("escort orders", () => {
    function makeHoldFleet(holdIds: string[]): FleetState {
        const fleet = makeFleet();
        for (const escort of fleet.escorts) {
            if (holdIds.includes(escort.id)) {
                escort.orders = 'hold' as EscortOrder;
            }
        }
        return fleet;
    }

    it("spawns held escorts parked and others forming up", async () => {
        const { world, escorts } = await makeTestWorld(makeHoldFleet(["1"]));
        const player = makePlayerShip([5000, 5000]);
        world.entities.set(PLAYER_UUID, player);
        escorts()[0].components.get(MovementStateComponent)!.position =
            new Position(0, 0);
        escorts()[1].components.get(MovementStateComponent)!.position =
            new Position(0, 0);

        world.step();

        const held = escorts()[0].components.get(EscortComponent)!.orders;
        expect(held).toEqual('hold');
        // Held: parked, no turn target, no acceleration.
        const heldMovement = escorts()[0].components.get(MovementStateComponent)!;
        expect(heldMovement.accelerating).toEqual(0);
        expect(heldMovement.turnTo).toBeUndefined();
        // The other escort still forms up (far away -> accelerates).
        const following = escorts()[1].components.get(MovementStateComponent)!;
        expect(following.accelerating).toEqual(1);
        expect(following.turnTo).toEqual(PLAYER_UUID);
    });

    it("honors a follow order again once reordered", async () => {
        const { world, escorts } = await makeTestWorld(makeHoldFleet(["1"]));
        const player = makePlayerShip([5000, 5000]);
        world.entities.set(PLAYER_UUID, player);
        escorts()[0].components.get(MovementStateComponent)!.position =
            new Position(0, 0);

        world.step();
        expect(escorts()[0].components.get(MovementStateComponent)!.accelerating)
            .toEqual(0);

        escorts()[0].components.get(EscortComponent)!.orders = 'follow';
        world.step();
        expect(escorts()[0].components.get(MovementStateComponent)!.accelerating)
            .toEqual(1);
    });

    it("holds position even with a live defend target", async () => {
        const { world, escorts } = await makeTestWorld(makeHoldFleet(["1"]));
        world.entities.set(PLAYER_UUID, makePlayerShip());
        world.entities.set(ATTACKER_UUID, makeNpcShip([0, 0]));

        world.emit(DamagedEvent,
            { damage: DAMAGE, damager: ATTACKER_UUID }, [PLAYER_UUID]);
        world.step();

        // The target is set (defend knowledge), but the held escort does
        // not chase it.
        const escort = escorts()[0];
        expect(escort.components.get(TargetComponent)!.target)
            .toEqual(ATTACKER_UUID);
        const movement = escort.components.get(MovementStateComponent)!;
        expect(movement.accelerating).toEqual(0);
        expect(movement.turnTo).toBeUndefined();
    });

    it("persists holdPosition/formation orders to the fleet and saves",
        async () => {
            const { world, state, escorts } = await makeTestWorld();
            world.entities.set(PLAYER_UUID, makePlayerShip());
            world.entities.set(ATTACKER_UUID, makeNpcShip([0, 0]));

            const saves = await countSaves(() => {
                world.emit(ControlStateEvent, controls('holdPosition'));
                world.step();
            });

            expect(saves).toEqual(1);
            for (const ship of escorts()) {
                expect(ship.components.get(EscortComponent)!.orders)
                    .toEqual('hold');
            }
            expect(state.fleet.escorts.map(escort => escort.orders))
                .toEqual(['hold', 'hold']);

            // Reordering back to formation un-parks them and saves again.
            const savesBack = await countSaves(() => {
                world.emit(ControlStateEvent, controls('formation'));
                world.step();
            });
            expect(savesBack).toEqual(1);
            expect(state.fleet.escorts.map(escort => escort.orders))
                .toEqual(['follow', 'follow']);
        });

    it("does not save when the order doesn't change anything", async () => {
        const { world } = await makeTestWorld();
        world.entities.set(PLAYER_UUID, makePlayerShip());

        // Escorts already follow: 'formation' is a no-op.
        const saves = await countSaves(() => {
            world.emit(ControlStateEvent, controls('formation'));
            world.step();
        });
        expect(saves).toEqual(0);
    });

    it("attack points every escort at the player's current target",
        async () => {
            const { world, escorts } = await makeTestWorld();
            const player = makePlayerShip();
            world.entities.set(PLAYER_UUID, player);
            world.entities.set(ATTACKER_UUID, makeNpcShip([0, 0]));
            player.components.get(TargetComponent)!.target = ATTACKER_UUID;

            world.emit(ControlStateEvent, controls('attack'));
            world.step();

            for (const ship of escorts()) {
                expect(ship.components.get(TargetComponent)!.target)
                    .toEqual(ATTACKER_UUID);
            }
        });

    it("attack with no player target clears escort targets", async () => {
        const { world, escorts } = await makeTestWorld();
        const player = makePlayerShip();
        world.entities.set(PLAYER_UUID, player);
        world.entities.set(ATTACKER_UUID, makeNpcShip([0, 0]));
        // The player has no target; one escort aims at something anyway.
        escorts()[0].components.get(TargetComponent)!.target = ATTACKER_UUID;

        world.emit(ControlStateEvent, controls('attack'));
        world.step();

        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toBeUndefined();
        }
    });

    it("defend clears escort targets", async () => {
        const { world, escorts } = await makeTestWorld();
        const player = makePlayerShip();
        world.entities.set(PLAYER_UUID, player);
        world.entities.set(ATTACKER_UUID, makeNpcShip([0, 0]));
        player.components.get(TargetComponent)!.target = ATTACKER_UUID;
        world.emit(ControlStateEvent, controls('attack'));
        world.step();
        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toEqual(ATTACKER_UUID);
        }

        world.emit(ControlStateEvent, controls('defend'));
        world.step();
        for (const ship of escorts()) {
            expect(ship.components.get(TargetComponent)!.target)
                .toBeUndefined();
        }
    });
});

describe("escort reconcile", () => {
    it("deletes escort entities whose fleet entry is gone", async () => {
        const { world, state, escorts } = await makeTestWorld();
        expect(escorts().length).toEqual(2);

        // Selling an escort removes its fleet entry (player/escort_ops.ts
        // sellEscort); the entity must not linger.
        const soldId = state.fleet.escorts[0].id;
        state.fleet.escorts.splice(0, 1);
        world.step();

        const remaining = escorts();
        expect(remaining.length).toEqual(1);
        expect(remaining[0].components.get(EscortComponent)!.escortId)
            .not.toEqual(soldId);
    });

    it("keeps escorts that are still in the fleet", async () => {
        const { world, escorts } = await makeTestWorld();
        world.step();
        world.step();
        expect(escorts().length).toEqual(2);
    });
});

describe("escort death", () => {
    it("removes a dead escort from the fleet, saves, and deletes it",
        async () => {
            const { world, state, escorts } = await makeTestWorld();
            expect(state.fleet.escorts.length).toEqual(2);

            let saves = 0;
            const global = globalThis as { queueSavePlayerState?: () => void };
            const previous = global.queueSavePlayerState;
            global.queueSavePlayerState = () => {
                saves += 1;
            };
            try {
                const dead = escorts()[0];
                world.emit(DeathEvent,
                    { time: 1, delta_ms: 0, delta_s: 0, frame: 0 },
                    [dead.uuid]);
                world.step();
            }
            finally {
                global.queueSavePlayerState = previous;
            }

            expect(saves).toEqual(1);
            expect(state.fleet.escorts.map(escort => escort.id))
                .toEqual(["2"]);
            expect(escorts().length).toEqual(1);
        });
});

describe("fleet persistence", () => {
    it("round-trips the fleet (with orders) through the pilot file JSON",
        () => {
            const fleet = makeFleet();
            fleet.escorts[0].orders = 'hold';
            fleet.escorts[1].orders = 'follow';
            const state = makePlayerState();
            state.fleet = fleet;
            const file = JSON.parse(JSON.stringify(serializePlayerState(state)));
            const revived = deserializePlayerState(file);
            expect(revived.fleet).toEqual(fleet);
        });

    it("normalizes escorts written before orders existed to follow", () => {
        const state = makePlayerState();
        state.fleet = makeFleet(); // entries without an orders field
        const file = JSON.parse(JSON.stringify(serializePlayerState(state)));
        const revived = deserializePlayerState(file);
        expect(revived.fleet.escorts.map(escort => escort.orders))
            .toEqual(['follow', 'follow']);
        expect(revived.fleet.escorts.map(escort => escort.id))
            .toEqual(["1", "2"]);
    });

    it("normalizes a pre-fleet pilot file to an empty fleet", () => {
        const file = serializePlayerState(makePlayerState()) as
            { fleet?: unknown };
        delete file.fleet;
        const revived = deserializePlayerState(JSON.parse(JSON.stringify(file)));
        expect(revived.fleet).toEqual({ escorts: [], nextId: 0 });
        // A null fleet (hand-edited file) normalizes the same way.
        const nulled = deserializePlayerState({
            ...JSON.parse(JSON.stringify(serializePlayerState(makePlayerState()))),
            fleet: null,
        });
        expect(nulled.fleet).toEqual({ escorts: [], nextId: 0 });
    });

    it("starts new pilots with an empty fleet", () => {
        const state = makePlayerState();
        expect(state.fleet).toEqual({ escorts: [], nextId: 0 });
    });
});
