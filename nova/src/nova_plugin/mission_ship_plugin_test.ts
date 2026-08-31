// Headless World specs for mission ship spawning and goal tracking (P6):
// tagged spawns from an active mission's düde, ShipStart positioning, STR#
// names, the pinned-type flag, and destroy/disable/escort goal completion
// driven through a real nova_ecs World (DeathEvent and all).

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultDudeData } from "novadatainterface/DudeData";
import { getDefaultMissionData, MissionData } from "novadatainterface/MissionData";
import { getDefaultOutfitData } from "novadatainterface/OutiftData";
import { getDefaultStringSetData } from "novadatainterface/StringSetData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { GameDataResource } from "./game_data_resource";
import { SystemIdResource } from "./system_id_resource";
import { DeathEvent } from "./death_plugin";
import { ArmorComponent } from "./health_plugin";
import { Stat } from "./stat";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import {
    BoardedEvent,
} from "./interaction_events";
import {
    MissionShipComponent,
    MissionShipPlugin,
} from "./mission_ship_plugin";
import { EscortComponent } from "./escort_plugin";
import { AIConfigComponent, AIStateComponent } from "./npc_ai_plugin";
import { ChooseRandomTargetComponent } from "./npc_plugin";
import { OutfitsStateComponent } from "./outfit_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ShipComponent, ShipDataComponent } from "./ship_plugin";
import { MissionEnvResource } from "../missions/mission_plugin";
import {
    isBitSet,
    makePlayerState,
    makeTestEnv,
    MISSIONS,
    PLANETS,
    START,
} from "../missions/test_fixtures";
import {
    ActiveMission,
    PlayerState,
    SpecialShipProgress,
} from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";

const SHIP_ID = "nova:600";
const DUDE_ID = "nova:800";
const NAME_STR = "nova:5000";

const SHIP = { ...getDefaultShipData(), id: SHIP_ID, name: "Test Ship" };
const DUDE = {
    ...getDefaultDudeData(),
    shipTypes: [{ ship: SHIP_ID, probability: 100 }],
};

const DESTROY_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:700",
    name: "Destroy the Talons",
    shipCount: 2,
    shipSyst: 300,
    shipDude: DUDE_ID,
    shipGoal: 0,
    shipNameID: 5000,
    shipStart: -1, // first nav point: system 300's planet
};
const DISABLE_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:701",
    name: "Disable the Smuggler",
    shipCount: 1,
    shipSyst: 300,
    shipDude: DUDE_ID,
    shipGoal: 1,
};
const ESCORT_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:702",
    name: "Escort the Convoy",
    shipCount: 2,
    shipSyst: 300,
    shipDude: DUDE_ID,
    shipGoal: 3,
    returnStel: 128,
};
const PINNED_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:703",
    name: "Pinned Types",
    shipCount: 3,
    shipSyst: 300,
    shipDude: DUDE_ID,
    shipGoal: 0,
    flags: 0x0800,
};
const AUX_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:704",
    name: "Bring the Aux Ships",
    auxShipCount: 2,
    auxShipSyst: 300,
    auxShipDude: DUDE_ID,
};

// ShipSyst points at system 301, not this world's 300: must not spawn.
const ELSEWHERE_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:705",
    name: "Elsewhere",
    shipCount: 2,
    shipSyst: 301,
    shipDude: DUDE_ID,
    shipGoal: 0,
};

// --- P5: boarding goals ---

// A priced ship class + a money-booty düde for the plunder assertions.
const PRICED_SHIP = {
    ...getDefaultShipData(),
    id: "nova:601",
    name: "Disabled Hulk",
    price: 10000,
};
const LOOT_DUDE = {
    ...getDefaultDudeData(),
    id: "nova:801",
    shipTypes: [{ ship: PRICED_SHIP.id, probability: 100 }],
    booty: 0x0040,
};

const BOARD_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:706",
    name: "Board the Smuggler",
    shipCount: 1,
    shipSyst: 300,
    shipDude: LOOT_DUDE.id,
    shipGoal: 2,
};

// --- P4: capture ---

// A crewed defender for the repelled-capture paths. The recovered engine
// odds never read the defender: a bare boarder sits at 10% (jittered +-5,
// clamped 1..75), and the board seed for raw id 602 under the fixture state
// draws jitter 0 / roll 48, so 48 > 10 repels deterministically — while a
// marine outfit (+1000 crew, +20%) clamps the odds at 75 and 48 <= 75
// captures, flipping the outcome.
const FAIL_SHIP = {
    ...getDefaultShipData(),
    id: "nova:602",
    name: "Stubborn Hulk",
    price: 10000,
    crew: 1000,
};
const LOOT_DUDE2 = {
    ...getDefaultDudeData(),
    id: "nova:802",
    shipTypes: [{ ship: FAIL_SHIP.id, probability: 100 }],
    booty: 0x0040,
};
const FAIL_BOARD_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:710",
    name: "Board the Warship",
    shipCount: 1,
    shipSyst: 300,
    shipDude: LOOT_DUDE2.id,
    shipGoal: 2,
};
// The same auto-abort shape as AUTO_ABORT_BOARD_MISSION, against the crewed
// defender: the abort must fire even when the capture is repelled.
const FAIL_AUTO_ABORT_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:711",
    name: "Rescue the Crewed Ship",
    shipCount: 1,
    shipSyst: 300,
    shipDude: LOOT_DUDE2.id,
    shipGoal: 5,
    flags: 0x0001,
    flags2: 0x0002,
    payVal: 5000,
};
// oütf ModType 25: marines. +1000 crew and +20% odds.
const MARINE_OUTFIT = {
    ...getDefaultOutfitData(),
    id: "nova:3000",
    name: "Marines",
    marines: { crew: 1000, oddsPercent: 20 },
};
const RESCUE_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:707",
    name: "Rescue the Miners",
    shipCount: 1,
    shipSyst: 300,
    shipDude: LOOT_DUDE.id,
    shipGoal: 5,
};
const PICKUP_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:708",
    name: "Salvage the Cargo",
    shipCount: 1,
    shipSyst: 300,
    shipDude: LOOT_DUDE.id,
    shipGoal: 2,
    pickupMode: 2,
    dropoffMode: 1,
    cargoType: 0,
    cargoQty: 5,
};
// Bible mïsn flags 0x0001: auto-abort after the special ship is boarded;
// flags2 0x0002 applies the pay on auto-abort.
const AUTO_ABORT_BOARD_MISSION: MissionData = {
    ...getDefaultMissionData(),
    id: "nova:709",
    name: "Rescue and Report",
    shipCount: 1,
    shipSyst: 300,
    shipDude: LOOT_DUDE.id,
    shipGoal: 5,
    flags: 0x0001,
    flags2: 0x0002,
    payVal: 5000,
};

const ALL_P6_MISSIONS = [DESTROY_MISSION, DISABLE_MISSION, ESCORT_MISSION,
    PINNED_MISSION, AUX_MISSION, ELSEWHERE_MISSION, BOARD_MISSION,
    RESCUE_MISSION, PICKUP_MISSION, AUTO_ABORT_BOARD_MISSION,
    FAIL_BOARD_MISSION, FAIL_AUTO_ABORT_MISSION];


function progress(initial: number): SpecialShipProgress {
    return {
        remaining: initial, killed: 0, boarded: 0, disabled: 0,
        jumpedIn: 0, jumpedOut: 0, initial,
    };
}

function active(mission: MissionData, overrides: Partial<ActiveMission> = {}):
    ActiveMission {
    return {
        missionId: mission.id,
        originStellar: START.id,
        travelStellar: null,
        returnStellar: null,
        travelComplete: true,
        shipGoalComplete: false,
        failed: false,
        cargoLoaded: false,
        cargo: null,
        deadline: null,
        specialShips: mission.shipCount >= 0
            ? progress(mission.shipCount) : null,
        auxShips: mission.auxShipCount >= 0
            ? { remaining: mission.auxShipCount, jumpedIn: 0 } : null,
        ...overrides,
    };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

interface TestWorld {
    world: World;
    state: PlayerState;
    gameData: MockGameData;
    missionShips(): Entity[];
}

// The boarding player: ship crew plus (optionally) owned marine outfits —
// the crew context the capture roll reads off PlayerCargoQuery.
function makePlayerShip(crew: number,
    outfits: Map<string, { count: number }> = new Map()): Entity {
    const ship = new Entity("Player Ship");
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(ShipDataComponent, { ...getDefaultShipData(), crew });
    ship.components.set(OutfitsStateComponent, outfits);
    return ship;
}

// Builds a system world for nova:300 with the given active missions and
// runs one spawn pass.
async function makeTestWorld(actives: ActiveMission[]): Promise<TestWorld> {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, SHIP);
    gameData.data.Ship.map.set(PRICED_SHIP.id, PRICED_SHIP);
    gameData.data.Ship.map.set(FAIL_SHIP.id, FAIL_SHIP);
    gameData.data.Dude.map.set(DUDE_ID, DUDE);
    gameData.data.Dude.map.set(LOOT_DUDE.id, LOOT_DUDE);
    gameData.data.Dude.map.set(LOOT_DUDE2.id, LOOT_DUDE2);
    gameData.data.StringSet.map.set(NAME_STR, {
        ...getDefaultStringSetData(),
        id: NAME_STR,
        name: "Ship Names",
        strings: ["Talon", "Manta"],
    });

    const { env } = makeTestEnv();
    const state = makePlayerState();
    state.activeMissions = actives;

    const world = new World();
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource, "nova:300");
    world.resources.set(PlayerStateResource, state);
    world.resources.set(MissionEnvResource, env);
    world.addPlugin(MissionShipPlugin);
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
        gameData,
        missionShips: () => [...world.entities.values()].filter(entity =>
            entity.components.has(MissionShipComponent)),
    };
}


describe("mission ship spawning and goals", () => {
    beforeAll(() => {
        for (const mission of ALL_P6_MISSIONS) {
            MISSIONS.set(mission.id, mission);
        }
    });

    it("spawns the mission's remaining ships, tagged and positioned",
        async () => {
            const activeMission = active(DESTROY_MISSION);
            const { missionShips } = await makeTestWorld([activeMission]);

            expect(missionShips().length).toEqual(2);
            // ShipStart -1: the system's first nav point (Start One).
            const start = PLANETS.get(START.id)!;
            for (const ship of missionShips()) {
                const tag = ship.components.get(MissionShipComponent)!;
                expect(tag.missionId).toEqual(DESTROY_MISSION.id);
                expect(tag.goal).toEqual(0);
                expect(tag.aux).toBeFalse();
                expect(ship.components.get(ShipComponent)!.id).toEqual(SHIP_ID as string);
                const position = ship.components.get(MovementStateComponent)!
                    .position;
                expect([position.x, position.y]).toEqual(start.position);
            }
            const indexes = missionShips().map(ship =>
                ship.components.get(MissionShipComponent)!.index).sort();
            expect(indexes).toEqual([0, 1]);
        });

    it("spawns mission ships at AI type 6 (never jump out on target loss)",
        async () => {
            // FUN_004259b0's mïsn path sets slot+0x88 = 6 regardless of the
            // düde's AI or the ship class's inherent AI (stock traders are
            // inherentAI 1-2 — as such they must not despawn mid-mission).
            const activeMission = active(DESTROY_MISSION);
            const { missionShips } = await makeTestWorld([activeMission]);
            expect(missionShips().length).toBeGreaterThan(0);
            for (const ship of missionShips()) {
                expect(ship.components.get(AIConfigComponent)!.aiType)
                    .toEqual(6);
            }
        });

    it("does not spawn where the ShipSyst filter does not match",
        async () => {
            const { missionShips } = await makeTestWorld([
                active(ELSEWHERE_MISSION),
            ]);
            expect(missionShips().length).toEqual(0);
        });

    it("names ships from the ShipName STR# set", async () => {
        const { missionShips } = await makeTestWorld([
            active(DESTROY_MISSION),
        ]);
        const names = missionShips().map(ship => ship.name!);
        expect(names.length).toEqual(2);
        for (const name of names) {
            expect(["Talon", "Manta"]).toContain(name);
        }
    });

    it("pins dude rolls under flag 0x0800 across entries", async () => {
        const activeMission = active(PINNED_MISSION);
        const first = await makeTestWorld([activeMission]);
        expect(first.missionShips().length).toEqual(3);
        // The first entry rolls and stores the pinned types.
        expect(activeMission.specialShips!.pinnedTypes).toBeDefined();
        expect(activeMission.specialShips!.pinnedTypes!.length).toEqual(3);

        // A second entry spawns the same pinned roster.
        const second = await makeTestWorld([activeMission]);
        expect(second.missionShips().length).toEqual(3);
    });

    it("spawns aux ships without goals", async () => {
        const activeMission = active(AUX_MISSION);
        const { missionShips } = await makeTestWorld([activeMission]);

        expect(missionShips().length).toEqual(2);
        for (const ship of missionShips()) {
            const tag = ship.components.get(MissionShipComponent)!;
            expect(tag.aux).toBeTrue();
            expect(tag.goal).toEqual(-1);
        }
        // Aux deaths drain the pool instead of touching goal progress.
        expect(activeMission.specialShips).toBeNull();
    });

    it("completes destroy goals from DeathEvents", async () => {
        const activeMission = active(DESTROY_MISSION);
        const { world, state, missionShips } = await makeTestWorld([
            activeMission,
        ]);

        for (const ship of [...missionShips()]) {
            world.emit(DeathEvent,
                { time: 1, delta_ms: 0, delta_s: 0, frame: 0 }, [ship.uuid]);
        }
        world.step();
        expect(activeMission.specialShips!.killed).toEqual(2);
        expect(activeMission.specialShips!.remaining).toEqual(0);
        expect(activeMission.shipGoalComplete).toBeTrue();
        // No return stellar: the bounty completes in space.
        expect(state.activeMissions).toEqual([]);
        expect(state.completedMissions).toEqual([DESTROY_MISSION.id]);
        expect(missionShips().length).toEqual(0);
    });

    it("completes disable goals at the HealthPlugin threshold", async () => {
        const activeMission = active(DISABLE_MISSION);
        const { world, missionShips } = await makeTestWorld([activeMission]);
        expect(missionShips().length).toEqual(1);

        const ship = missionShips()[0];
        ship.components.set(ArmorComponent, new Stat({
            current: 1,
            max: 100,
            min: 0,
            recharge: 0,
        }));
        world.step();

        expect(ship.components.get(MissionShipComponent)!.disabled).toBeTrue();
        expect(activeMission.specialShips!.disabled).toEqual(1);
        expect(activeMission.shipGoalComplete).toBeTrue();
    });

    // Mirrors the real flow: the disable latch gates the board key, and
    // BoardControlSystem emits BoardedEvent on the disabled, in-range
    // target. ShipDataComponent rides on every ship in full worlds; the
    // default (crew 0) hull auto-captures.
    function boardGoalShip(world: World, ship: Entity,
        shipData = PRICED_SHIP): void {
        const tag = ship.components.get(MissionShipComponent)!;
        ship.components.set(MissionShipComponent, { ...tag, disabled: true });
        ship.components.set(ShipDataComponent, shipData);
        world.emit(BoardedEvent, { target: ship.uuid }, [ship.uuid]);
        world.step();
    }

    it("completes board goals from BoardedEvents and pays the booty",
        async () => {
            const activeMission = active(BOARD_MISSION);
            const { world, state, missionShips } = await makeTestWorld([
                activeMission,
            ]);
            boardGoalShip(world, missionShips()[0]);

            expect(activeMission.specialShips!.boarded).toEqual(1);
            expect(activeMission.shipGoalComplete).toBeTrue();
            // The boarded ship is taken.
            expect(missionShips().length).toEqual(0);
            // No return stellar: the bounty completes in space.
            expect(state.activeMissions).toEqual([]);
            expect(state.completedMissions).toEqual([BOARD_MISSION.id]);
            // Booty money: 2.5% of 10000 = 250 credits, floored at 1000.
            expect(state.credits).toEqual(26000);
        });

    it("completes rescue goals from BoardedEvents", async () => {
        const activeMission = active(RESCUE_MISSION);
        const { world, state, missionShips } = await makeTestWorld([
            activeMission,
        ]);
        const ship = missionShips()[0];
        // Rescue ships spawn disabled.
        expect(ship.components.get(ArmorComponent)!.current).toEqual(0);

        boardGoalShip(world, ship);

        expect(activeMission.specialShips!.boarded).toEqual(1);
        expect(activeMission.shipGoalComplete).toBeTrue();
        expect(state.completedMissions).toEqual([RESCUE_MISSION.id]);
        expect(missionShips().length).toEqual(0);
    });

    it("loads PickupMode 2 cargo when the special ship is boarded",
        async () => {
            const activeMission = active(PICKUP_MISSION, {
                cargo: { type: 0, qty: 5 },
                returnStellar: "nova:128",
            });
            const { world, state, missionShips } = await makeTestWorld([
                activeMission,
            ]);
            boardGoalShip(world, missionShips()[0]);

            expect(activeMission.cargoLoaded).toBeTrue();
            // Goal met, but the mission waits for the return-stellar landing
            // (DropoffMode 1 drops the cargo there).
            expect(activeMission.shipGoalComplete).toBeTrue();
            expect(state.activeMissions).toEqual([activeMission]);
        });

    it("auto-aborts a flag-0x0001 mission after its ship is boarded",
        async () => {
            const activeMission = active(AUTO_ABORT_BOARD_MISSION, {
                returnStellar: "nova:128",
            });
            const { world, state, missionShips } = await makeTestWorld([
                activeMission,
            ]);
            boardGoalShip(world, missionShips()[0]);

            expect(activeMission.specialShips!.boarded).toEqual(1);
            expect(activeMission.shipGoalComplete).toBeTrue();
            // Aborted, not completed or failed.
            expect(state.activeMissions).toEqual([]);
            expect(state.completedMissions).toEqual([]);
            expect(state.failedMissions).toEqual([]);
            // flags2 0x0002 applies the pay on auto-abort (5000), on top of
            // the booty money band (1000-2500).
            expect(state.credits).toBeGreaterThanOrEqual(31000);
            expect(state.credits).toBeLessThanOrEqual(32500);
        });

    // --- P4: capture ---

    it("auto-captures a crew-0 hulk into the fleet and fires OnCapture",
        async () => {
            const activeMission = active(BOARD_MISSION);
            const { world, state, missionShips } = await makeTestWorld([
                activeMission,
            ]);
            // A 0-crew defender is trivially capturable (flagged
            // approximation); this hull's OnCapture sets bit 350.
            const captureShip = { ...PRICED_SHIP, onCapture: "b350" };
            world.entities.set("player ship", makePlayerShip(10));
            boardGoalShip(world, missionShips()[0], captureShip);

            // The ship is no longer a mission ship — it is the escort.
            expect(missionShips().length).toEqual(0);
            const escorts = [...world.entities.values()].filter(entity =>
                entity.components.has(EscortComponent));
            expect(escorts.length).toEqual(1);
            const escort = escorts[0];
            expect(escort.components.get(EscortComponent)!).toEqual({
                escortId: "0",
                shipType: PRICED_SHIP.id,
                orders: "follow",
            });
            // Escort contract: no autonomous AI to friendly-fire with.
            expect(escort.components.has(MissionShipComponent)).toBeFalse();
            expect(escort.components.has(AIConfigComponent)).toBeFalse();
            expect(escort.components.has(AIStateComponent)).toBeFalse();
            expect(escort.components.has(ChooseRandomTargetComponent))
                .toBeFalse();
            // The fleet model is the truth across warps and reloads.
            expect(state.fleet).toEqual({
                escorts: [{ id: "0", shipType: PRICED_SHIP.id }],
                nextId: 1,
            });
            // shïp OnCapture ran against the pilot's set context.
            expect(isBitSet(state, 350)).toBeTrue();
        });

    it("repels a capture attempt against a crewed defender, once",
        async () => {
            const activeMission = active(FAIL_BOARD_MISSION);
            const { world, state, missionShips } = await makeTestWorld([
                activeMission,
            ]);
            world.entities.set("player ship", makePlayerShip(10));
            const ship = missionShips()[0];
            boardGoalShip(world, ship, FAIL_SHIP);

            // Repelled: the hulk stays where it is, still disabled.
            expect(missionShips().length).toEqual(1);
            expect(ship.components.get(MissionShipComponent)!.disabled)
                .toBeTrue();
            expect(state.fleet.escorts).toEqual([]);
            const creditsAfterFirstBoard = state.credits;

            // The plundered latch: a second board neither re-plunders nor
            // re-rolls the capture — one attempt per disable.
            world.emit(BoardedEvent, { target: ship.uuid }, [ship.uuid]);
            world.step();
            expect(state.credits).toEqual(creditsAfterFirstBoard);
            expect(missionShips().length).toEqual(1);
            expect(state.fleet.escorts).toEqual([]);
        });

    it("still reports the goal loss when the capture is repelled",
        async () => {
            const activeMission = active(FAIL_BOARD_MISSION);
            const { world, state, missionShips } = await makeTestWorld([
                activeMission,
            ]);
            world.entities.set("player ship", makePlayerShip(10));
            boardGoalShip(world, missionShips()[0], FAIL_SHIP);

            // The boarding happened either way — the goal bookkeeping ran.
            expect(activeMission.specialShips!.boarded).toEqual(1);
            expect(activeMission.shipGoalComplete).toBeTrue();
            expect(state.completedMissions).toEqual([FAIL_BOARD_MISSION.id]);
            // ...while the repelled ship remains.
            expect(missionShips().length).toEqual(1);
        });

    it("auto-aborts a flag-0x0001 mission even when the capture is repelled",
        async () => {
            // ReturnStel 128 (the AUTO_ABORT_BOARD shape): the goal is met
            // but the mission stays open, and the flag-0x0001 auto-abort
            // fires — repelled capture or not.
            const activeMission = active(FAIL_AUTO_ABORT_MISSION, {
                returnStellar: "nova:128",
            });
            const { world, state, missionShips } = await makeTestWorld([
                activeMission,
            ]);
            world.entities.set("player ship", makePlayerShip(10));
            boardGoalShip(world, missionShips()[0], FAIL_SHIP);

            expect(activeMission.specialShips!.boarded).toEqual(1);
            expect(state.activeMissions).toEqual([]);
            expect(state.completedMissions).toEqual([]);
            expect(state.failedMissions).toEqual([]);
            // Booty money plus the flags2-0x0002 abort pay, as usual.
            expect(state.credits).toBeGreaterThanOrEqual(31000);
            expect(state.credits).toBeLessThanOrEqual(32500);
            expect(missionShips().length).toEqual(1);
        });

    it("draws the capture roll last, so plunder never shifts", async () => {
        // World A: the crew-0 hull is auto-captured — no capture draw at all.
        const a = await makeTestWorld([active(BOARD_MISSION)]);
        a.world.entities.set("player ship", makePlayerShip(10));
        boardGoalShip(a.world, a.missionShips()[0]);
        expect(a.state.fleet.escorts.length).toEqual(1);

        // World B: a crewed hull (raw id 602, same price so the loot is
        // identical). One capture draw follows the loot — the fixture seed
        // draws jitter 0 / roll 48 over the bare boarder's 10% odds:
        // repelled.
        const b = await makeTestWorld([active(BOARD_MISSION)]);
        b.world.entities.set("player ship", makePlayerShip(10));
        boardGoalShip(b.world, b.missionShips()[0], FAIL_SHIP);
        expect(b.state.fleet.escorts).toEqual([]);

        // Identical loot whether or not a capture draw followed it.
        expect(b.state.credits).toEqual(a.state.credits);
        expect(b.state.credits).toBeGreaterThanOrEqual(26000);

        // Same state, same rolls: replaying B replays the repulse exactly.
        const b2 = await makeTestWorld([active(BOARD_MISSION)]);
        b2.world.entities.set("player ship", makePlayerShip(10));
        boardGoalShip(b2.world, b2.missionShips()[0], FAIL_SHIP);
        expect(b2.state.credits).toEqual(b.state.credits);
        expect(b2.state.fleet.escorts).toEqual([]);
    });

    it("swings the capture with marine outfits through the glue", async () => {
        // Bare player (crew 10): 10% odds, and the fixture's roll (48)
        // repels.
        const bare = await makeTestWorld([active(FAIL_BOARD_MISSION)]);
        bare.world.entities.set("player ship", makePlayerShip(10));
        boardGoalShip(bare.world, bare.missionShips()[0], FAIL_SHIP);
        expect(bare.state.fleet.escorts).toEqual([]);

        // With marines (+1000 crew, +20%): (10+1000)/(10*10)*100 + 20
        // clamps at 75, and the same roll (48) now captures.
        const marines = await makeTestWorld([active(FAIL_BOARD_MISSION)]);
        marines.gameData.data.Outfit.map.set(MARINE_OUTFIT.id, MARINE_OUTFIT);
        await marines.gameData.data.Outfit.get(MARINE_OUTFIT.id);
        marines.world.entities.set("player ship", makePlayerShip(0,
            new Map([[MARINE_OUTFIT.id, { count: 1 }]])));
        boardGoalShip(marines.world, marines.missionShips()[0], FAIL_SHIP);
        expect(marines.state.fleet.escorts.length).toEqual(1);
        expect(marines.state.fleet.escorts[0].shipType).toEqual(FAIL_SHIP.id);
    });

    it("completes escort goals once the travel leg is done", async () => {
        const activeMission = active(ESCORT_MISSION, {
            travelComplete: true,
            returnStellar: "nova:128", // ReturnStel 128 resolved at accept
        });
        const { state, missionShips } = await makeTestWorld([activeMission]);

        expect(missionShips().length).toEqual(2);
        expect(activeMission.shipGoalComplete).toBeTrue();
        // With a return stellar the mission waits for the landing.
        expect(state.activeMissions).toEqual([activeMission]);
    });
});
