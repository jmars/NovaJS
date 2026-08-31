// Headless World specs for the düde AIType behaviors: trader travel and
// fleeing, the FUN_0040e020 acquisition scan (police-assist, the aggress
// square for the player, the strength odds filter, the nearest-attacker
// fallback), FUN_004192d0 retaliation (govt-difference gated, with the
// suppression cascade), the target-loss jump-out for AI 1-2, and
// retaliation on DamagedEvent. Runs a real nova_ecs World with only
// NpcAIPlugin (no NpcPlugin) so the generic random-target AI does not
// interfere — except the last describe, which adds NpcPlugin to exercise
// the shared neutral-player gate in ChooseRandomTarget for aiType-0 ships.
// makeDudeShip supplies the AI components under test.

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { DudeData, getDefaultDudeData } from "novadatainterface/DudeData";
import { getDefaultPlanetData, PlanetData } from "novadatainterface/PlanetData";
import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { EcsEvent } from "nova_ecs/events";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { MissionEnv } from "../missions/mission_state_machine";
import { MissionEnvResource } from "../missions/mission_plugin";
import { makePlayerState, makeTestEnv } from "../missions/test_fixtures";
import { randInt, seedRng } from "../player/pilot_files";
import { BoardingProfileComponent, makeDudeShip } from "./dude";
import { DamagedEvent } from "./death_plugin";
import { OwnerComponent } from "./fire_weapon_plugin";
import { AIConfigComponent, AIStateComponent, NpcAIPlugin,
    NpcHailEvent } from "./npc_ai_plugin";
import { ChooseRandomTargetComponent, GovernmentComponent, NpcPlugin,
    playerIsHostile, ShootAllWeaponsComponent } from "./npc_plugin";
import { PlayerStateResource } from "../player/player_state_component";
import { PlayerShipSelector } from "./player_ship_plugin";
import { PlanetComponent, PlanetDataComponent } from "./planet_plugin";
import { makeShip } from "./make_ship";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import { ShipComponent, ShipDataComponent } from "./ship_plugin";
import { GameDataResource } from "./game_data_resource";
import { Stat } from "./stat";
import { SystemIdResource } from "./system_id_resource";
import { TargetComponent } from "./target_component";
import { TargetRemovedEvent } from "./target_plugin";
import { WeaponsStateComponent } from "./weapons_state";

const SHIP_ID = "nova:600";
const SHIP: ShipData = {
    ...getDefaultShipData(),
    id: SHIP_ID,
    name: "Test Ship",
};
// A twice-as-strong ship class, for the odds-filter discriminator.
const STRONG_SHIP: ShipData = {
    ...getDefaultShipData(),
    id: "nova:601",
    name: "Strong Ship",
    strength: 1000,
};

// Polaris (nova:130) and the Federation (nova:128) are mutual enemies in
// the test fixtures (classes/enemies [16] vs [1]); the Rebels (nova:141)
// are unrelated to everyone — no declared war either way.
const TRADER_DUDE: DudeData = {
    ...getDefaultDudeData(),
    id: "nova:800",
    aiType: 1,
    govt: "nova:130",
    booty: 0x0040,
    shipTypes: [{ ship: SHIP_ID, probability: 100 }],
};
const NO_AI_DUDE: DudeData = { ...TRADER_DUDE, aiType: 0 };

// The fixtures' system nova:300, given Polaris as its government for the
// per-system clean-player amnesty.
const SYSTEM_ID = "nova:300";

const TIME = { time: 1_000_000, delta_s: 0, delta_ms: 0, frame: 0 };

function makeWorld(envOverrides: Partial<MissionEnv> = {}): World {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);
    gameData.data.Ship.map.set("nova:601", STRONG_SHIP);
    const world = new World();
    world.resources.set(TimeResource, { ...TIME });
    world.resources.set(GameDataResource, gameData);
    world.resources.set(MissionEnvResource,
        { ...makeTestEnv().env, ...envOverrides });
    // The player-targeting specs exercise the per-system legal record, so
    // the default world sits in the Polaris-owned system (nova:304).
    world.resources.set(SystemIdResource, "nova:304");
    world.addPlugin(NpcAIPlugin);
    return world;
}

// Entities get their uuid from the key they are added under (see
// fleet_plugin's spawn), so tests add them under fixed keys.
function addEntity(world: World, key: string, entity: Entity): Entity {
    world.entities.set(key, entity);
    return entity;
}

function makePlanetEntity(id: string, x: number, y: number,
    data?: Partial<PlanetData>): Entity {
    const planet = new Entity(id);
    planet.components.set(PlanetComponent, { id });
    if (data) {
        planet.components.set(PlanetDataComponent,
            { ...getDefaultPlanetData(), ...data });
    }
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
    govtId: string | null = dude.govt, shipData: ShipData = SHIP): Entity {
    const ship = makeDudeShip(dude, shipData, govtId);
    ship.components.set(TargetComponent, { target: undefined });
    // The ShipDataProvider resolves ShipDataComponent for every ship in a
    // full world; set it here so strengthOf reads it deterministically.
    ship.components.set(ShipDataComponent, shipData);
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

function addGovtShip(world: World, key: string,
    govtId: string | null, position: [number, number],
    shipData: ShipData = SHIP): Entity {
    const ship = makeShip(shipData);
    ship.components.set(TargetComponent, { target: undefined });
    // See makeAiShip: the effective ship data, for strengthOf.
    ship.components.set(ShipDataComponent, shipData);
    if (govtId !== null) {
        ship.components.set(GovernmentComponent, { id: govtId });
    }
    ship.components.get(MovementStateComponent)!.position =
        new Position(position[0], position[1]);
    return addEntity(world, key, ship);
}

// Pins the aggress roll so range/threshold specs are deterministic.
function pinAggress(npc: Entity, aggress: number): void {
    const config = npc.components.get(AIConfigComponent)!;
    npc.components.set(AIConfigComponent, { ...config, aggress });
}

const DAMAGE = {
    shield: 1, armor: 1, ionization: 0, ionizationColor: 0,
    passThroughShield: 0, knockback: 0,
};

describe("düde AIType behaviors", () => {
    it("tags dude ships with an AI config and boarding profile", () => {
        // FUN_0041ba80 rolls aggress = rand(3) ^ 2 per spawn.
        seedRng(7);
        const npc = makeDudeShip(TRADER_DUDE, SHIP);
        seedRng(7);
        const aggress = randInt(3) ^ 2;
        expect([0, 2, 3]).toContain(aggress);
        expect(npc.components.get(AIConfigComponent)).toEqual(
            { aiType: 1, aggress, coward: null });
        expect(npc.components.get(AIStateComponent)).toEqual(
            { anger: 0, attackedBy: null, fleeing: false });
        expect(npc.components.get(BoardingProfileComponent)).toEqual({
            dudeId: TRADER_DUDE.id,
            booty: 0x0040,
            govtId: "nova:130",
            plundered: false,
        });

        // AI ships acquire through the FUN_0040e020 scan only: the legacy
        // random-target layer is stripped.
        expect(npc.components.has(ChooseRandomTargetComponent)).toBeFalse();

        // aiType 0 keeps the legacy random-target layer.
        expect(makeDudeShip(NO_AI_DUDE, SHIP)
            .components.has(ChooseRandomTargetComponent)).toBeTrue();

        // Plain fleet leads fall back to the ship's inherent AI.
        const fleetShip = makeDudeShip(null, { ...SHIP, inherentAI: 4 });
        expect(fleetShip.components.get(AIConfigComponent)!.aiType)
            .toEqual(4);
        expect(fleetShip.components.get(BoardingProfileComponent)!.dudeId)
            .toBeNull();
    });

    it("sends an idle trader toward a planet", () => {
        const world = makeWorld();
        // Trader destination candidates sit on the map: |x|,|y| < 1000.
        const near = makePlanetEntity("nova:130", 900, 0);
        const far = makePlanetEntity("nova:140", -900, -400);
        addEntity(world, "near-planet", near);
        addEntity(world, "far-planet", far);
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();

        const movement = npc.components.get(MovementStateComponent)!;
        expect(movement.turnTo === near.uuid || movement.turnTo === far.uuid)
            .toBeTrue();
        expect(movement.accelerating).toEqual(1);
    });

    it("lands (despawns) when the re-decide draws the spöb it is parked at",
        () => {
            const world = makeWorld();
            // One candidate spöb: every successful draw picks it.
            const planet = addEntity(world, "planet",
                makePlanetEntity("nova:150", 900, 0));
            const npc = addEntity(world, "npc",
                makeAiShip(TRADER_DUDE, [0, 0]));
            world.step();
            expect(npc.components.get(MovementStateComponent)!.turnTo)
                .toEqual(planet.uuid);

            // Arrive (radius/4 = 37.5 for the default sprite radius 150):
            // park and wait rand(200)+300 frames.
            const movement = npc.components.get(MovementStateComponent)!;
            movement.position = new Position(890, 0);
            world.step();
            expect(movement.accelerating).toEqual(0);
            expect(npc.components.get(AIStateComponent)!.destination)
                .toBeUndefined();
            const waitUntil = npc.components.get(AIStateComponent)!.waitUntil;
            expect(waitUntil).toBeGreaterThan(TIME.time);

            // After the wait, the re-decide draws the same spöb → LAND
            // (binary state 0x14): the trader despawns into the planet.
            world.resources.get(TimeResource)!.time =
                waitUntil! + 1;
            world.step();
            expect(world.entities.get("npc")).toBeUndefined();
        });

    it("jumps out (despawns) when no destination is eligible", () => {
        // FUN_0040c790's 0xffff → FUN_00415b80/FUN_00410670 jump out: no
        // planet inside the |x|,|y| < 1000 map bounds to draw.
        const world = makeWorld();
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();
        expect(world.entities.get("npc")).toBeUndefined();
    });

    it("flees below the aggress-1 shield threshold while the target lives",
        () => {
            const base = makeTestEnv();
            const world = makeWorld({
                government: id => id === "nova:130"
                    ? { ...base.env.government("nova:130")!, flags: 0x10 }
                    : base.env.government(id),
            });
            const npc = addEntity(world, "npc",
                makeAiShip(TRADER_DUDE, [0, 0]));
            pinAggress(npc, 1); // 30% threshold
            const enemy = addGovtShip(world, "enemy", "nova:128", [500, 0]);
            npc.components.set(TargetComponent, { target: enemy.uuid });
            npc.components.set(ShieldComponent,
                new Stat({ current: 25, max: 100, recharge: 0 }));
            npc.components.set(WeaponsStateComponent, new Map([
                ["nova:200", { count: 4, firing: true }],
            ]));
            world.step();

            const movement = npc.components.get(MovementStateComponent)!;
            expect(movement.turnBack).toBeTrue();
            expect(movement.turnTo).toBeFalsy();
            expect(movement.accelerating).toEqual(1);
            // The target is kept (binary state 3 holds +0x70); only the
            // weapons fall silent.
            expect(npc.components.get(TargetComponent)!.target)
                .toEqual(enemy.uuid);
            expect(npc.components.get(WeaponsStateComponent)!
                .get("nova:200")!.firing).toBeFalse();
            expect(npc.components.get(AIStateComponent)!.fleeing).toBeTrue();

            // Not sticky on shields: recharging does not re-engage while
            // the target lives.
            npc.components.set(ShieldComponent,
                new Stat({ current: 100, max: 100, recharge: 0 }));
            world.step();
            expect(npc.components.get(AIStateComponent)!.fleeing).toBeTrue();
            expect(npc.components.get(MovementStateComponent)!.turnBack)
                .toBeTrue();

            // The latch ends with the target: un-flee, clear the anger,
            // re-decide.
            world.entities.delete("enemy");
            world.step();
            expect(npc.components.get(AIStateComponent)!.fleeing).toBeFalse();
            expect(npc.components.get(TargetComponent)!.target)
                .toBeUndefined();
        });

    it("ships with aggress 3 never flee at low shields", () => {
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags: 0x10 }
                : base.env.government(id),
        });
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        pinAggress(npc, 3);
        const enemy = addGovtShip(world, "enemy", "nova:128", [500, 0]);
        npc.components.set(TargetComponent, { target: enemy.uuid });
        npc.components.set(ShieldComponent,
            new Stat({ current: 5, max: 100, recharge: 0 }));
        world.step();

        expect(npc.components.get(AIStateComponent)!.fleeing).toBeFalse();
        expect(npc.components.get(MovementStateComponent)!.turnBack)
            .toBeFalse();
    });

    it("ships of governments without the retreat flag never flee", () => {
        // Default Polaris flags: no 0x10.
        const world = makeWorld();
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        pinAggress(npc, 1);
        const enemy = addGovtShip(world, "enemy", "nova:128", [500, 0]);
        npc.components.set(TargetComponent, { target: enemy.uuid });
        npc.components.set(ShieldComponent,
            new Stat({ current: 5, max: 100, recharge: 0 }));
        world.step();

        expect(npc.components.get(AIStateComponent)!.fleeing).toBeFalse();
    });

    it("a përs coward threshold flees below coward% of shields", () => {
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags: 0x10 }
                : base.env.government(id),
        });
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        // aggress 3 alone would never flee; the përs coward drives it.
        npc.components.set(AIConfigComponent,
            { aiType: 1, aggress: 3, coward: 25 });
        const enemy = addGovtShip(world, "enemy", "nova:128", [500, 0]);
        npc.components.set(TargetComponent, { target: enemy.uuid });
        npc.components.set(ShieldComponent,
            new Stat({ current: 20, max: 100, recharge: 0 }));
        world.step();

        expect(npc.components.get(AIStateComponent)!.fleeing).toBeTrue();
    });

    it("owned ships (escorts, fighters) never flee", () => {
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags: 0x10 }
                : base.env.government(id),
        });
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        pinAggress(npc, 1);
        npc.components.set(OwnerComponent, { owner: "carrier" });
        const enemy = addGovtShip(world, "enemy", "nova:128", [500, 0]);
        npc.components.set(TargetComponent, { target: enemy.uuid });
        npc.components.set(ShieldComponent,
            new Stat({ current: 5, max: 100, recharge: 0 }));
        world.step();

        expect(npc.components.get(AIStateComponent)!.fleeing).toBeFalse();
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

        expect(npc.components.get(AIStateComponent)!.fleeing).toBeFalse();
        const movement = npc.components.get(MovementStateComponent)!;
        expect(movement.turnBack).toBeFalse();
        expect(movement.turnTo).not.toEqual(planet.uuid);
        expect(movement.accelerating).toEqual(0);
    });

    it("targets a hostile player inside the aggress square", () => {
        const world = makeWorld();
        const state = makePlayerState();
        state.legalRecord["nova:130"] = -1; // Polaris, crimeTol 0
        world.resources.set(PlayerStateResource, state);
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
        pinAggress(npc, 2); // |dx|,|dy| ≤ 1200
        // Euclidean distance 1273 — outside the old circular radius model's
        // 1200, but the binary tests each axis separately.
        const player = addEntity(world, "player",
            makePlayerShip([900, 900]));
        world.step();

        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(player.uuid);
    });

    it("ignores a hostile player outside the aggress square", () => {
        const world = makeWorld();
        const state = makePlayerState();
        state.legalRecord["nova:130"] = -1;
        world.resources.set(PlayerStateResource, state);
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
        pinAggress(npc, 2);
        // |dx| = 1300 > 1200 (a circular radius 3000 would still include
        // this point — the square test is what excludes it).
        addEntity(world, "player", makePlayerShip([1300, 0]));
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("interceptors leave a neutral player alone", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
        pinAggress(npc, 2);
        addEntity(world, "player", makePlayerShip([200, 0]));
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("a xenophobic government does not acquire the player outside the "
        + "aggress square", () => {
        // FUN_004101d0 skips the player slot: the general scan must not
        // reach the player through xenophobia (no GovernmentComponent to
        // test) — pass 2's aggress square is the only player path.
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags: 0x1 }
                : base.env.government(id),
        });
        const state = makePlayerState();
        state.legalRecord["nova:130"] = -1; // hostile: below -crimeTol 0
        world.resources.set(PlayerStateResource, state);
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        pinAggress(npc, 2); // square 1200
        addEntity(world, "player", makePlayerShip([50_000, 0]));
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("derelict-govt ships are not acquired even at war", () => {
        // FUN_0046bdf0 skips when EITHER govt carries flag 0x800.
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:128"
                ? { ...base.env.government("nova:128")!, flags: 0x800 }
                : base.env.government(id),
        });
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        pinAggress(npc, 2);
        // The Federation is Polaris's mutual enemy — but derelict now.
        addGovtShip(world, "enemy", "nova:128", [500, 0]);
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
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
            pinAggress(npc, 2);
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

    it("prefers the nearest hostile ship over a neutral player", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        pinAggress(npc, 2);
        addGovtShip(world, "enemy", "nova:128", [500, 0]);
        addEntity(world, "player", makePlayerShip([100, 0]));
        world.step();

        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(world.entities.get("enemy")!.uuid);
    });

    it("acquires enemies at any distance — the odds filter is the range",
        () => {
            const world = makeWorld();
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
            pinAggress(npc, 1);
            const enemy = addGovtShip(world, "enemy", "nova:128",
                [50_000, 0]);
            world.step();

            // No radius on NPC-vs-NPC acquisition: equal strength passes
            // the odds filter (maxOdds 1000 = 1:1 per-mille) at any
            // distance.
            expect(npc.components.get(TargetComponent)!.target)
                .toEqual(enemy.uuid);
        });

    it("the odds filter drops enemies too strong for the odds", () => {
        const base = makeTestEnv();
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        pinAggress(npc, 1);
        // Strength 1000 vs my 100: 1000 > 100 × maxOdds 1000/1000 →
        // dropped.
        addGovtShip(world, "strong", "nova:128", [500, 0], STRONG_SHIP);
        world.step();
        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();

        // Raising the government's MaxOdds to 10000 admits the same enemy:
        // 1000 ≤ 100 × 10000/1000 (10:1 odds).
        const brave = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, maxOdds: 10000 }
                : base.env.government(id),
        });
        const braverNpc = addEntity(brave, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        pinAggress(braverNpc, 1);
        addGovtShip(brave, "strong", "nova:128", [500, 0], STRONG_SHIP);
        brave.step();
        expect(braverNpc.components.get(TargetComponent)!.target)
            .toEqual(brave.entities.get("strong")!.uuid);
    });

    it("police-assist takes the victim an allied ship is fighting", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        pinAggress(npc, 2);
        // The Rebels are NOT mutual enemies of Polaris — the victim is
        // only reachable through the allied ship's live target.
        const victim = addGovtShip(world, "victim", "nova:141", [2000, 0]);
        const ally = addGovtShip(world, "ally", "nova:130", [100, 0]);
        ally.components.set(TargetComponent, { target: victim.uuid });
        world.step();

        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(victim.uuid);
    });

    it("police-assist respects the odds filter", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        pinAggress(npc, 2);
        const victim = addGovtShip(world, "victim", "nova:141", [2000, 0],
            STRONG_SHIP);
        const ally = addGovtShip(world, "ally", "nova:130", [100, 0]);
        ally.components.set(TargetComponent, { target: victim.uuid });
        world.step();

        // Strength 1000 > 100 × 1000/1000: the assist is refused.
        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("falls back to the nearest ship attacking me or my escorts", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        pinAggress(npc, 2);
        // The Rebels attacker is not a mutual enemy: only the FUN_0040faa0
        // fallback (whoever attacks me or mine, any government) applies.
        const attacker = addGovtShip(world, "attacker", "nova:141",
            [400, 0]);
        attacker.components.set(TargetComponent, { target: npc.uuid });
        world.step();

        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(attacker.uuid);
    });

    it("AI 1-2 jump out when they lose their target", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();

        world.emit(TargetRemovedEvent, "gone-target", [npc.uuid]);
        world.step();
        expect(world.entities.get("npc")).toBeUndefined();
    });

    it("AI 3-4 just clear the grudge and re-decide", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        npc.components.set(AIStateComponent,
            { anger: 5, attackedBy: "someone", fleeing: true });
        world.step();

        world.emit(TargetRemovedEvent, "gone-target", [npc.uuid]);
        world.step();
        expect(world.entities.get("npc")).toBeDefined();
        expect(npc.components.get(AIStateComponent)!.anger).toEqual(0);
        expect(npc.components.get(AIStateComponent)!.attackedBy).toBeNull();
        expect(npc.components.get(AIStateComponent)!.fleeing).toBeFalse();
        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("AI 6 (mission ships) never jump out on target loss", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 6 }, [0, 0]));
        world.step();

        world.emit(TargetRemovedEvent, "gone-target", [npc.uuid]);
        world.step();
        expect(world.entities.get("npc")).toBeDefined();
        expect(npc.components.get(AIStateComponent)!.anger).toEqual(0);
    });

    it("retaliates against a criminal player and latches attackedBy", () => {
        const world = makeWorld();
        const state = makePlayerState();
        state.legalRecord["nova:130"] = -1; // Polaris, crimeTol 0
        world.resources.set(PlayerStateResource, state);
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        const player = addEntity(world, "player",
            makePlayerShip([50_000, 0])); // far outside aggro
        world.step();
        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();

        world.emit(DamagedEvent, { damage: DAMAGE, damager: player.uuid },
            [npc.uuid]);
        world.step();

        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(player.uuid);
        expect(npc.components.get(AIStateComponent)!.attackedBy)
            .toEqual(player.uuid);
        // Anger accumulates the shield + armor damage.
        expect(npc.components.get(AIStateComponent)!.anger).toEqual(2);
    });

    it("does not retaliate against a neutral player's stray hit", () => {
        // FUN_004192d0's per-system amnesty: a player whose record with the
        // system's government is clean (2 × crimeTol ≤ record, crimeTol 0
        // here) and who is not targeting this ship is amnestied.
        const base = makeTestEnv();
        const world = makeWorld({
            system: id => id === SYSTEM_ID
                ? { ...base.env.system(SYSTEM_ID)!, government: "nova:130" }
                : base.env.system(id),
        });
        world.resources.set(SystemIdResource, SYSTEM_ID);
        // Empty legal record: the player is clean everywhere.
        world.resources.set(PlayerStateResource, makePlayerState());
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        const player = addEntity(world, "player",
            makePlayerShip([50_000, 0]));
        world.step();

        world.emit(DamagedEvent, { damage: DAMAGE, damager: player.uuid },
            [npc.uuid]);
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
        expect(npc.components.get(AIStateComponent)!.attackedBy).toBeNull();
        expect(npc.components.get(AIStateComponent)!.anger).toEqual(0);
    });

    it("retaliates against a different-government shooter with no declared "
        + "war", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        // The Rebels are unrelated to Polaris — no class/enemy lists connect
        // them — but any different-govt attacker is retaliated against.
        const rebel = addGovtShip(world, "rebel", "nova:141", [50_000, 0]);
        world.step();
        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();

        world.emit(DamagedEvent, { damage: DAMAGE, damager: rebel.uuid },
            [npc.uuid]);
        world.step();

        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(rebel.uuid);
        expect(npc.components.get(AIStateComponent)!.attackedBy)
            .toEqual(rebel.uuid);
    });

    it("does not retaliate against a same-government ship's stray hit",
        () => {
            const world = makeWorld();
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
            const ally = addEntity(world, "ally",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [100, 0]));
            world.step();

            world.emit(DamagedEvent, { damage: DAMAGE, damager: ally.uuid },
                [npc.uuid]);
            world.step();

            expect(npc.components.get(TargetComponent)!.target)
                .toBeUndefined();
            expect(npc.components.get(AIStateComponent)!.attackedBy)
                .toBeNull();
        });

    it("anger accumulates across hits on the same shooter", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        const rebel = addGovtShip(world, "rebel", "nova:141", [50_000, 0]);
        world.step();

        world.emit(DamagedEvent, { damage: DAMAGE, damager: rebel.uuid },
            [npc.uuid]);
        world.emit(DamagedEvent, { damage: DAMAGE, damager: rebel.uuid },
            [npc.uuid]);
        world.step();

        expect(npc.components.get(AIStateComponent)!.anger).toEqual(4);
        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(rebel.uuid);
    });

    it("does not retaliate against a same-owner shooter", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        npc.components.set(OwnerComponent, { owner: "carrier" });
        const sibling = addGovtShip(world, "sibling", "nova:141", [100, 0]);
        sibling.components.set(OwnerComponent, { owner: "carrier" });
        world.step();

        // Different governments — but the owner chain suppresses.
        world.emit(DamagedEvent, { damage: DAMAGE, damager: sibling.uuid },
            [npc.uuid]);
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
        expect(npc.components.get(AIStateComponent)!.anger).toEqual(0);
    });

    it("does not retaliate against attacks on a derelict-govt ship", () => {
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags: 0x800 }
                : base.env.government(id),
        });
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        const rebel = addGovtShip(world, "rebel", "nova:141", [50_000, 0]);
        world.step();

        world.emit(DamagedEvent, { damage: DAMAGE, damager: rebel.uuid },
            [npc.uuid]);
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("retaliates against the ship behind a projectile hit, not the projectile",
        () => {
            const world = makeWorld();
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
            const shooter = addGovtShip(world, "shooter", "nova:128",
                [0, 0]);
            // Projectiles carry their shooter as OwnerComponent and pass
            // their own uuid as the DamagedEvent damager.
            const projectile = new Entity("projectile");
            projectile.components.set(OwnerComponent,
                { owner: shooter.uuid });
            addEntity(world, "projectile", projectile);
            world.step();

            world.emit(DamagedEvent,
                { damage: DAMAGE, damager: projectile.uuid }, [npc.uuid]);
            world.step();

            expect(npc.components.get(TargetComponent)!.target)
                .toEqual(shooter.uuid);
        });

    it("does not retaliate when the shooter is gone before the event lands",
        () => {
            const world = makeWorld();
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
            world.step();

            world.emit(DamagedEvent,
                { damage: DAMAGE, damager: "gone-ship" }, [npc.uuid]);
            world.step();

            expect(npc.components.get(TargetComponent)!.target)
                .toBeUndefined();
        });

    it("playerIsHostile gates on govt id, env resolution and player state",
        () => {
            const world = makeWorld();
            // No player state resource yet.
            expect(playerIsHostile("nova:130", world)).toBeFalse();

            const state = makePlayerState();
            world.resources.set(PlayerStateResource, state);
            expect(playerIsHostile(null, world)).toBeFalse();
            expect(playerIsHostile("nova:130", world)).toBeFalse(); // 0
            expect(playerIsHostile("nova:999", world)).toBeFalse();

            state.legalRecord["nova:130"] = -1; // Polaris, crimeTol 0
            expect(playerIsHostile("nova:130", world)).toBeTrue();
        });
});

// Items resolved in the FUN_00405590 / FUN_0040c790 / FUN_00403de0 pass:
// pursuit memory, the AI-4 comm-scan, the spöb-category destination
// picker, the full-width-radius arrival and the flags3 park wait.
describe("AI pursuit memory, comm-scan and travel fidelity", () => {
    function capture<T>(world: World, event: EcsEvent<T>): { events: T[] } {
        const events: T[] = [];
        world.events.get(event).subscribe(data => events.push(data));
        return { events };
    }

    // First seed whose rand(100) lands ≤ 75 (the hail roll) / > 75.
    function hailSeeds(): [number, number] {
        let hail = 0;
        let wave = 0;
        for (let seed = 1; hail === 0 || wave === 0; seed++) {
            seedRng(seed);
            const roll = randInt(100);
            if (roll <= 75 && hail === 0) {
                hail = seed;
            }
            if (roll > 75 && wave === 0) {
                wave = seed;
            }
        }
        return [hail, wave];
    }

    it("AI 3 keeps a lost target and brakes while the attention window runs",
        () => {
            const world = makeWorld();
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
            npc.components.set(AIStateComponent,
                { anger: 5, attackedBy: "enemy", fleeing: false });
            const movement = npc.components.get(MovementStateComponent)!;
            movement.velocity = new Vector(300, 0);
            npc.components.set(TargetComponent, { target: "enemy" });

            // TargetRemovedEvent fires when the target is removed (the
            // TargetRemovedSystem translates a DeleteEvent into it).
            world.emit(TargetRemovedEvent, "enemy", [npc.uuid]);
            world.step();

            const state = npc.components.get(AIStateComponent)!;
            expect(state.lostTarget).toEqual("enemy");
            // The grudge survives the loss until the window expires.
            expect(state.anger).toEqual(5);
            expect(state.attackedBy).toEqual("enemy");
            expect(state.attentionUntil!).toBeGreaterThan(TIME.time);
            expect(npc.components.get(TargetComponent)!.target)
                .toBeUndefined();
            // Substate 1: brake to a full stop.
            expect(movement.turnBack).toBeTrue();
            expect(movement.accelerating).toEqual(1);
            expect(movement.turnTo).toBeNull();

            // A target back under the kept uuid resumes the attack.
            world.entities.set("enemy", makeShip(SHIP));
            world.step();
            expect(npc.components.get(TargetComponent)!.target)
                .toEqual("enemy");
            expect(npc.components.get(AIStateComponent)!.lostTarget)
                .toBeUndefined();
        });

    it("the pursuit-memory window expiry drops the target and re-acquires",
        () => {
            const world = makeWorld();
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
            npc.components.set(AIStateComponent,
                { anger: 5, attackedBy: "enemy", fleeing: false });
            npc.components.set(TargetComponent, { target: "enemy" });
            world.emit(TargetRemovedEvent, "enemy", [npc.uuid]);
            world.step();
            const until = npc.components.get(AIStateComponent)!
                .attentionUntil!;

            // A new enemy appears while the window runs; the loiter holds.
            const other = addGovtShip(world, "other", "nova:128",
                [-500, 0]);
            world.resources.get(TimeResource)!.time = until - 1;
            world.step();
            expect(npc.components.get(TargetComponent)!.target)
                .toBeUndefined();

            world.resources.get(TimeResource)!.time = until + 1;
            world.step();
            const state = npc.components.get(AIStateComponent)!;
            expect(state.lostTarget).toBeUndefined();
            expect(state.anger).toEqual(0);
            expect(state.attackedBy).toBeNull();
            // State 0: AggroRange re-acquires on the next tick.
            world.step();
            expect(npc.components.get(TargetComponent)!.target)
                .toEqual(other.uuid);
        });

    it("AI 1-2 and fleeing ships still end with the target (no memory)", () => {
        // Fleeing is binary state 3, not the attack states 4/0xd.
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        npc.components.set(AIStateComponent,
            { anger: 5, attackedBy: "someone", fleeing: true });
        world.emit(TargetRemovedEvent, "gone-target", [npc.uuid]);
        world.step();
        expect(npc.components.get(AIStateComponent)!.lostTarget)
            .toBeUndefined();
        expect(npc.components.get(AIStateComponent)!.anger).toEqual(0);
    });

    it("an idle interceptor scans a nearby ship and flies at it", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
        const neutral = addGovtShip(world, "neutral", "nova:141", [400, 0]);
        world.step();

        const state = npc.components.get(AIStateComponent)!;
        expect(state.scanTarget).toEqual(neutral.uuid);
        expect(state.lastScanMark).toEqual(neutral.uuid);
        // Substate 9: straight fly-at (asserted on the second tick).
        world.step();
        const movement = npc.components.get(MovementStateComponent)!;
        expect(movement.turnTo).toEqual(neutral.uuid);
        expect(movement.accelerating).toEqual(1);
    });

    it("a completed NPC scan drops silently", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
        const neutral = addGovtShip(world, "neutral", "nova:141", [400, 0]);
        const hails = capture(world, NpcHailEvent);
        world.step();
        expect(npc.components.get(AIStateComponent)!.scanTarget)
            .toEqual(neutral.uuid);

        // Inside the 100px square the scan resolves on the next step.
        npc.components.get(MovementStateComponent)!.position =
            new Position(400, 0);
        world.step();
        const state = npc.components.get(AIStateComponent)!;
        expect(state.scanTarget).toBeUndefined();
        expect(state.lastScanMark).toEqual(neutral.uuid);
        expect(hails.events).toEqual([]);
        // No pursuit memory for scan targets.
        expect(state.lostTarget).toBeUndefined();
    });

    it("a completed player scan hails on the 76% roll", () => {
        const [hailSeed, waveSeed] = hailSeeds();
        for (const [seed, expectHail] of [[hailSeed, true],
            [waveSeed, false]] as const) {
            const world = makeWorld();
            const npc = addEntity(world, "npc",
                makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
            const player = addEntity(world, "player",
                makePlayerShip([80, 0]));
            npc.components.set(AIStateComponent,
                { anger: 0, attackedBy: null, fleeing: false,
                    scanTarget: player.uuid, lastScanMark: player.uuid });
            const hails = capture(world, NpcHailEvent);
            // The hail roll is the step's first draw.
            seedRng(seed);
            world.step();

            const state = npc.components.get(AIStateComponent)!;
            expect(state.scanTarget).toBeUndefined();
            expect(hails.events).toEqual(expectHail
                ? [{ from: npc.uuid }] : []);
        }
    });

    it("a gone scan target just drops (no pursuit memory)", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
        addGovtShip(world, "neutral", "nova:141", [400, 0]);
        world.step();
        expect(npc.components.get(AIStateComponent)!.scanTarget)
            .toBeDefined();

        world.entities.delete("neutral");
        world.step();
        const state = npc.components.get(AIStateComponent)!;
        expect(state.scanTarget).toBeUndefined();
        expect(state.lostTarget).toBeUndefined();
    });

    it("warships never run the comm-scan", () => {
        const world = makeWorld();
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 3 }, [0, 0]));
        addGovtShip(world, "neutral", "nova:141", [400, 0]);
        world.step();
        expect(npc.components.get(AIStateComponent)!.scanTarget)
            .toBeUndefined();
    });

    it("govt flags2 0x80 forces 0x2000-category destinations", () => {
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags2: 0x80 }
                : base.env.government(id),
        });
        const normal = makePlanetEntity("nova:150", 900, 0);
        const category = makePlanetEntity("nova:151", -900, 0,
            { flags2: 0x2000 });
        addEntity(world, "normal", normal);
        addEntity(world, "category", category);
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();

        expect(npc.components.get(MovementStateComponent)!.turnTo)
            .toEqual(category.uuid);
    });

    it("0x80 wins over 0x40 when both category pools exist", () => {
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags2: 0xc0 }
                : base.env.government(id),
        });
        const cat1000 = makePlanetEntity("nova:150", 900, 0,
            { flags2: 0x1000 });
        const cat2000 = makePlanetEntity("nova:151", -900, 0,
            { flags2: 0x2000 });
        addEntity(world, "cat1000", cat1000);
        addEntity(world, "cat2000", cat2000);
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();

        expect(npc.components.get(MovementStateComponent)!.turnTo)
            .toEqual(cat2000.uuid);
    });

    it("govt flags2 0x40 alone picks 0x1000-category destinations", () => {
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags2: 0x40 }
                : base.env.government(id),
        });
        const normal = makePlanetEntity("nova:150", 900, 0);
        const category = makePlanetEntity("nova:151", -900, 0,
            { flags2: 0x1000 });
        addEntity(world, "normal", normal);
        addEntity(world, "category", category);
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();

        expect(npc.components.get(MovementStateComponent)!.turnTo)
            .toEqual(category.uuid);
    });

    it("flags2 0x20 vetoes 0x1000 in the general path (0xffff → jump out)",
        () => {
            const base = makeTestEnv();
            const world = makeWorld({
                government: id => id === "nova:130"
                    ? { ...base.env.government("nova:130")!, flags2: 0x20 }
                    : base.env.government(id),
            });
            addEntity(world, "category", makePlanetEntity("nova:150", 900, 0,
                { flags2: 0x1000 }));
            const npc = addEntity(world, "npc",
                makeAiShip(TRADER_DUDE, [0, 0]));
            world.step();

            // No drawable destination: the trader jumps out (despawns).
            expect(world.entities.get("npc")).toBeUndefined();
        });

    it("the general path picks inhabited spöbs over uninhabited ones", () => {
        const world = makeWorld();
        const uninhabited = makePlanetEntity("nova:150", 900, 0,
            { inhabited: false });
        const inhabited = makePlanetEntity("nova:151", -900, 0);
        addEntity(world, "uninhabited", uninhabited);
        addEntity(world, "inhabited", inhabited);
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();

        expect(npc.components.get(MovementStateComponent)!.turnTo)
            .toEqual(inhabited.uuid);
    });

    it("west-of-origin spöbs are drawable (signed x < 1000)", () => {
        const world = makeWorld();
        const west = addEntity(world, "west",
            makePlanetEntity("nova:150", -2000, 0));
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();

        expect(npc.components.get(MovementStateComponent)!.turnTo)
            .toEqual(west.uuid);
    });

    it("a 0x3000-category destination lands the trader on arrival", () => {
        const base = makeTestEnv();
        const world = makeWorld({
            government: id => id === "nova:130"
                ? { ...base.env.government("nova:130")!, flags2: 0x80 }
                : base.env.government(id),
        });
        addEntity(world, "category", makePlanetEntity("nova:150", 900, 0,
            { flags2: 0x2000 }));
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();
        expect(npc.components.get(AIStateComponent)!.destination)
            .toEqual("category");

        // Arrived: land (despawn) instead of parking.
        npc.components.get(MovementStateComponent)!.position =
            new Position(890, 0);
        world.step();
        expect(world.entities.get("npc")).toBeUndefined();
    });

    it("AI 4 draws any non-category spöb, uninhabited included", () => {
        const world = makeWorld();
        const category = makePlanetEntity("nova:150", 900, 0,
            { flags2: 0x2000 });
        const open = makePlanetEntity("nova:151", -900, 0);
        const uninhabited = makePlanetEntity("nova:152", 0, 500,
            { inhabited: false });
        addEntity(world, "category", category);
        addEntity(world, "open", open);
        addEntity(world, "uninhabited", uninhabited);
        const npc = addEntity(world, "npc",
            makeAiShip({ ...TRADER_DUDE, aiType: 4 }, [0, 0]));
        world.step();

        // The gate needs an inhabited non-category spöb (nova:151); the
        // draw may land on it or the uninhabited nova:152 — never the
        // category nova:150.
        const destination = npc.components.get(AIStateComponent)!.destination;
        expect(destination === "open" || destination === "uninhabited")
            .toBeTrue();
    });

    it("flags3 bit 0x2 shortens the arrival park wait", () => {
        const shortWaitShip: ShipData = { ...SHIP, flags3: 0x2 };
        const arrive = (shipData: ShipData): number => {
            const world = makeWorld();
            addEntity(world, "planet", makePlanetEntity("nova:150", 900, 0));
            const npc = addEntity(world, "npc",
                makeAiShip(TRADER_DUDE, [0, 0], TRADER_DUDE.govt, shipData));
            world.step();
            npc.components.get(MovementStateComponent)!.position =
                new Position(890, 0);
            world.step();
            const wait = npc.components.get(AIStateComponent)!.waitUntil;
            expect(wait).toBeDefined();
            return wait! - TIME.time;
        };

        // rand(75)+100 frames vs rand(200)+300 — the bands do not overlap.
        const shortFrames = arrive(shortWaitShip) * 30 / 1000;
        expect(shortFrames).toBeGreaterThanOrEqual(100);
        expect(shortFrames).toBeLessThan(200);
        const longFrames = arrive(SHIP) * 30 / 1000;
        expect(longFrames).toBeGreaterThanOrEqual(300);
    });

    it("arrival reach is radius/4 of the FULL sprite width", () => {
        const world = makeWorld();
        // radius 400 → reach 100: |dx| = 90 arrives (the old half-radius
        // model would give reach 50 and keep traveling).
        addEntity(world, "planet", makePlanetEntity("nova:150", 900, 0,
            { radius: 400 }));
        const npc = addEntity(world, "npc", makeAiShip(TRADER_DUDE, [0, 0]));
        world.step();
        npc.components.get(MovementStateComponent)!.position =
            new Position(810, 0);
        world.step();

        const state = npc.components.get(AIStateComponent)!;
        expect(state.destination).toBeUndefined();
        expect(state.waitUntil).toBeGreaterThan(TIME.time);
    });
});

// The generic NpcPlugin random-target AI (ChooseRandomTarget) is the
// aiType-0 legacy layer — AI ships (types 1-4) strip it at spawn. These
// specs run both plugins against aiType-0 ships.
describe("legacy random-target AI vs the player", () => {
    function makeRandomTargetWorld(
        envOverrides: Partial<MissionEnv> = {}): World {
        const world = makeWorld(envOverrides);
        world.addPlugin(NpcPlugin);
        return world;
    }

    it("does not roll a neutral player as a random target", () => {
        const world = makeRandomTargetWorld();
        const npc = addEntity(world, "npc", makeAiShip(NO_AI_DUDE, [0, 0]));
        addEntity(world, "player", makePlayerShip([100, 0]));
        world.step();

        expect(npc.components.get(TargetComponent)!.target).toBeUndefined();
    });

    it("rolls a hostile player as a random target", () => {
        const world = makeRandomTargetWorld();
        const state = makePlayerState();
        state.legalRecord["nova:130"] = -1; // Polaris, crimeTol 0
        world.resources.set(PlayerStateResource, state);
        const npc = addEntity(world, "npc", makeAiShip(NO_AI_DUDE, [0, 0]));
        const player = addEntity(world, "player", makePlayerShip([100, 0]));
        world.step();

        // The player is the only valid target left, so the roll is forced.
        expect(npc.components.get(TargetComponent)!.target)
            .toEqual(player.uuid);
    });

    it("does not fire at nothing when it has no target", () => {
        // Regression: ShootAllWeaponsAI used to set firing=true even with
        // no target, so an idling NPC sprayed its weapons into the void
        // forever (looked like it was circling and firing at a battle).
        const world = makeRandomTargetWorld();
        const npc = addEntity(world, "npc", makeAiShip(NO_AI_DUDE, [0, 0]));
        npc.components.set(WeaponsStateComponent, new Map([
            ["nova:200", { count: 4, firing: false }],
        ]));
        npc.components.set(ShootAllWeaponsComponent, undefined);
        world.step();

        const firing = npc.components.get(WeaponsStateComponent)!
            .get("nova:200")!.firing;
        expect(firing).toBeFalse();
    });
});
