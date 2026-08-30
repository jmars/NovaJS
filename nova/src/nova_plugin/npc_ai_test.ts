// Headless World specs for the düde AIType behaviors (P2): trader travel
// and Coward fleeing, warship/interceptor Aggress-range targeting, and
// retaliation on DamagedEvent. Runs a real nova_ecs World with only
// NpcAIPlugin (no NpcPlugin) so the generic random-target AI does not
// interfere; makeDudeShip supplies the AI components under test.

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { DudeData, getDefaultDudeData } from "novadatainterface/DudeData";
import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { MissionEnv } from "../missions/mission_state_machine";
import { MissionEnvResource } from "../missions/mission_plugin";
import { makePlayerState, makeTestEnv } from "../missions/test_fixtures";
import { BoardingProfileComponent, makeDudeShip } from "./dude";
import { DamagedEvent } from "./death_plugin";
import { AIConfigComponent, AIStateComponent, NpcAIPlugin } from "./npc_ai_plugin";
import { GovernmentComponent } from "./npc_plugin";
import { PlayerStateResource } from "../player/player_state_component";
import { PlayerShipSelector } from "./player_ship_plugin";
import { PlanetComponent } from "./planet_plugin";
import { makeShip } from "./make_ship";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import { ShipComponent } from "./ship_plugin";
import { Stat } from "./stat";
import { TargetComponent } from "./target_component";
import { WeaponsStateComponent } from "./weapons_state";

const SHIP_ID = "nova:600";
const SHIP: ShipData = {
    ...getDefaultShipData(),
    id: SHIP_ID,
    name: "Test Ship",
};

// Polaris (nova:130) and the Federation (nova:128) are mutual enemies in
// the test fixtures (classes/enemies [16] vs [1]).
const TRADER_DUDE: DudeData = {
    ...getDefaultDudeData(),
    id: "nova:800",
    aiType: 1,
    govt: "nova:130",
    booty: 0x0040,
    shipTypes: [{ ship: SHIP_ID, probability: 100 }],
};

const TIME = { time: 1_000_000, delta_s: 0, delta_ms: 0, frame: 0 };

function makeWorld(envOverrides: Partial<MissionEnv> = {}): World {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);
    const world = new World();
    world.resources.set(TimeResource, { ...TIME });
    world.resources.set(MissionEnvResource,
        { ...makeTestEnv().env, ...envOverrides });
    world.addPlugin(NpcAIPlugin);
    return world;
}

// Entities get their uuid from the key they are added under (see
// fleet_plugin's spawn), so tests add them under fixed keys.
function addEntity(world: World, key: string, entity: Entity): Entity {
    world.entities.set(key, entity);
    return entity;
}

function makePlanetEntity(id: string, x: number, y: number): Entity {
    const planet = new Entity(id);
    planet.components.set(PlanetComponent, { id });
    planet.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(x, y),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });
    return planet;
}

function makeAiShip(dude: DudeData, position: [number, number],
    govtId: string | null = dude.govt): Entity {
    const ship = makeDudeShip(dude, SHIP, govtId);
    ship.components.set(TargetComponent, { target: undefined });
    ship.components.get(MovementStateComponent)!.position =
        new Position(position[0], position[1]);
    return ship;
}

function makePlayerShip(position: [number, number]): Entity {
    const ship = makeShip(SHIP);
    ship.components.set(TargetComponent, { target: undefined });
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.get(MovementStateComponent)!.position =
        new Position(position[0], position[1]);
    return ship;
}

describe("düde AIType behaviors", () => {
    it("tags dude ships with an AI config and boarding profile", () => {
        const npc = makeDudeShip(TRADER_DUDE, SHIP);
        expect(npc.components.get(AIConfigComponent)).toEqual(
            { aiType: 1, aggress: 2, coward: 50 });
        expect(npc.components.get(AIStateComponent)).toEqual(
            { fled: false, attackedBy: null });
        expect(npc.components.get(BoardingProfileComponent)).toEqual({
            dudeId: TRADER_DUDE.id,
            booty: 0x0040,
            govtId: "nova:130",
            plundered: false,
        });

        // Brave traders have no coward threshold.
        expect(makeDudeShip({ ...TRADER_DUDE, aiType: 2 }, SHIP)
            .components.get(AIConfigComponent)!.coward).toBeNull();

        // Plain fleet leads fall back to the ship's inherent AI.
        const fleetShip = makeDudeShip(null, { ...SHIP, inherentAI: 4 });
        expect(fleetShip.components.get(AIConfigComponent)!.aiType)
            .toEqual(4);
        expect(fleetShip.components.get(BoardingProfileComponent)!.dudeId)
            .toBeNull();
    });

    it("sends an idle trader toward a planet", () => {
        const world = makeWorld();
        const near = makePlanetEntity("nova:130", 1000, 0);
        const far = makePlanetEntity("nova:140", -2000, 0);
        addEntity(world, "near-planet", near);
        addEntity(world, "far-planet", far);
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();

        const movement = npc.components.get(MovementStateComponent)!;
        expect(movement.turnTo === near.uuid || movement.turnTo === far.uuid)
            .toBeTrue();
        expect(movement.accelerating).toEqual(1);
    });

    it("flees when shields drop under the coward threshold, and stays fled",
        () => {
            const world = makeWorld();
            const npc = makeAiShip(TRADER_DUDE, [0, 0]);
            npc.components.set(TargetComponent, { target: "nova:999" });
            npc.components.set(ShieldComponent,
                new Stat({ current: 40, max: 100, recharge: 0 }));
            npc.components.set(WeaponsStateComponent, new Map([
                ["nova:200", { count: 4, firing: true }],
            ]));
            addEntity(world, "npc", npc);
            world.step();

            const movement = npc.components.get(MovementStateComponent)!;
            expect(movement.turnBack).toBeTrue();
            expect(movement.turnTo).toBeFalsy();
            expect(movement.accelerating).toEqual(1);
            expect(npc.components.get(TargetComponent)!.target)
                .toBeUndefined();
            expect(npc.components.get(WeaponsStateComponent)!
                .get("nova:200")!.firing).toBeFalse();
            expect(npc.components.get(AIStateComponent)!.fled).toBeTrue();

            // The latch is sticky: shields back up does not re-engage.
            npc.components.set(ShieldComponent,
                new Stat({ current: 100, max: 100, recharge: 0 }));
            world.step();
            expect(npc.components.get(AIStateComponent)!.fled).toBeTrue();
            expect(npc.components.get(MovementStateComponent)!.turnBack)
                .toBeTrue();
        });

    it("brave traders (coward null) do not flee at low shields", () => {
        const world = makeWorld();
        const npc = makeAiShip({ ...TRADER_DUDE, aiType: 2 }, [0, 0]);
        npc.components.set(ShieldComponent,
            new Stat({ current: 10, max: 100, recharge: 0 }));
        addEntity(world, "npc", npc);
        world.step();

        expect(npc.components.get(AIStateComponent)!.fled).toBeFalse();
        expect(npc.components.get(MovementStateComponent)!.turnBack)
            .toBeFalse();
    });

    it("dead-in-space ships neither flee nor travel", () => {
        const world = makeWorld();
        const planet = addEntity(world, "planet",
            makePlanetEntity("nova:150", 100, 0));
        // A goal-5 rescue target: disabled, no shields, no armor.
        const npc = makeAiShip(TRADER_DUDE, [0, 0]);
        npc.components.set(ShieldComponent,
            new Stat({ current: 0, max: 100, recharge: 0 }));
        npc.components.set(ArmorComponent,
            new Stat({ current: 0, max: 100, recharge: 0 }));
        addEntity(world, "npc", npc);
        world.step();

        expect(npc.components.get(AIStateComponent)!.fled).toBeFalse();
        const movement = npc.components.get(MovementStateComponent)!;
        expect(movement.turnBack).toBeFalse();
        expect(movement.turnTo).not.toEqual(planet.uuid);
        expect(movement.accelerating).toEqual(0);
    });

    it("interceptor inside the aggress range targets a hostile player",
        () => {
            const world = makeWorld();
            const state = makePlayerState();
            state.legalRecord["nova:130"] = -1; // Polaris, crimeTol 0
            world.resources.set(PlayerStateResource, state);
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
            const player = addEntity(world, "player",
                makePlayerShip([2000, 0])); // aggress 2 -> radius 3000
            world.step();

            expect(npc.components.get(TargetComponent)!.target)
                .toEqual(player.uuid);
        });

    it("interceptors leave a neutral player alone", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
        const player = addEntity(world, "player",
            makePlayerShip([2000, 0])); // inside radius 3000
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("warship inside the aggress radius does not target a neutral player",
        () => {
            const world = makeWorld();
            const state = makePlayerState(); // empty legal record
            world.resources.set(PlayerStateResource, state);
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
            const player = addEntity(world, "player",
                makePlayerShip([100, 0])); // well inside radius 3000
            world.step();

            expect(npc.components.get(TargetComponent)!.target)
                .toBeUndefined();
            expect(player.components.get(TargetComponent)!.target)
                .toBeUndefined();
        });

    it("warship targets the player once the record drops below -crimeTol",
        () => {
            // Give the NPC's government a real tolerance so the test
            // exercises the < -crimeTol comparison, not just < 0.
            const base = makeTestEnv();
            const polaris = { ...base.env.government("nova:130")!,
                crimeTol: 25 };
            const world = makeWorld({
                government: id => id === "nova:130"
                    ? polaris : base.env.government(id),
            });
            const state = makePlayerState();
            state.legalRecord["nova:130"] = -20; // not yet hostile
            world.resources.set(PlayerStateResource, state);
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
            const player = addEntity(world, "player",
                makePlayerShip([100, 0]));
            world.step();
            expect(npc.components.get(TargetComponent)!.target)
                .toBeUndefined();

            state.legalRecord["nova:130"] = -30; // below -crimeTol 25
            world.step();
            expect(npc.components.get(TargetComponent)!.target)
                .toEqual(player.uuid);
        });

    it("a governmentless ship never auto-targets the player", () => {
        const world = makeWorld();
        const state = makePlayerState();
        // Hostile toward every government — irrelevant: with no govt id of
        // its own the NPC cannot be hostile to anyone.
        state.legalRecord["nova:130"] = -100;
        world.resources.set(PlayerStateResource, state);
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0], null));
        addEntity(world, "player", makePlayerShip([100, 0]));
        world.step();

        expect(npc.components.get(GovernmentComponent)).toBeUndefined();
        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("warship prefers an enemy-govt ship over the player", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        const enemy = makeShip(SHIP);
        enemy.components.set(TargetComponent, { target: undefined });
        enemy.components.set(GovernmentComponent, { id: "nova:128" });
        enemy.components.get(MovementStateComponent)!.position =
            new Position(500, 0);
        addEntity(world, "enemy", enemy);
        const player = addEntity(world, "player", makePlayerShip([100, 0]));
        world.step();

        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(enemy.uuid);
    });

    it("ignores ships outside the aggress range and wanders instead", () => {
        const world = makeWorld();
        const planet = addEntity(world, "planet",
            makePlanetEntity("nova:150", 100, 0));
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        const player = addEntity(world, "player",
            makePlayerShip([5000, 0])); // beyond radius 3000
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
        expect(npc.components.get(MovementStateComponent)!.turnTo)
            .toEqual(planet.uuid);
    });

    it("retaliates against the damager and latches attackedBy", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        const player = addEntity(world, "player",
            makePlayerShip([50_000, 0])); // far outside aggro
        world.step();
        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();

        world.emit(DamagedEvent, {
            damage: {
                shield: 1, armor: 1, ionization: 0, ionizationColor: 0,
                passThroughShield: 0, knockback: 0,
            },
            damager: player.uuid,
        }, [npc.uuid]);
        world.step();

        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(player.uuid);
        expect(npc.components.get(AIStateComponent)!.attackedBy)
            .toEqual(player.uuid);
    });
});
