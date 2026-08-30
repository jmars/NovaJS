// Mission special/aux ship spawning and goal tracking in the ECS (P6/P5).
//
// Per-system worlds (built on every warp-in — in this engine a warp-in IS a
// system-world build) run one spawn pass: every active mission whose
// ShipSyst/AuxShipSyst filter matches the system spawns its remaining ships
// from its düde, with seeded rolls (mission_ship_goals.shipSpawnSeed), flag
// 0x0800 pinned types, ShipStart positioning and STR# names. The spawned
// ships carry MissionShipComponent; the goal systems below turn DeathEvent,
// the disable threshold and BoardedEvent into PlayerState bookkeeping via
// the pure rules in missions/mission_ship_goals.ts and
// missions/boarding.ts.
//
// Flagged approximations (details in mission_ship_goals.ts / boarding.ts /
// capture.ts): capture odds are a weighted crew ratio (the Bible documents
// the inputs but not the formula), 0-crew ships are trivially capturable,
// NPCs cannot jump out (chase-off = destroy-all), cloaking and
// hyperspace-in delays are not modeled (ShipStart 1/2 fall back to random
// positions).

import { DudeData } from "novadatainterface/DudeData";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { MissionData } from "novadatainterface/MissionData";
import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import { SystemData } from "novadatainterface/SystemData";
import { Entities, GetWorld, RunQuery, RunQueryFunction, UUID } from "nova_ecs/arg_types";
import { Query } from "nova_ecs/query";
import { AsyncSystem } from "nova_ecs/async_system";
import { Component } from "nova_ecs/component";
import { Position } from "nova_ecs/datatypes/position";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { EntityMap } from "nova_ecs/entity_map";
import { SingletonComponent, World } from "nova_ecs/world";
import { MissionEnvResource, queuePlayerStateSave } from "../missions/mission_plugin";
import {
    checkEscortGoal,
    isShipDisabled,
    MissionShipSpawnPlan,
    nextSpecialShipType,
    planMissionShipSpawn,
    reportAuxShipDestroyed,
    reportSpecialShipLoss,
    reportSpecialShipsPresent,
    shipSpawnSeed,
} from "../missions/mission_ship_goals";
import { boardRng, resolveBoard } from "../missions/boarding";
import {
    captureOdds,
    effectivePlayerCrew,
    outfitMarines,
    rollCapture,
} from "../missions/capture";
import {
    abortMission,
    boardPickupCargo,
    MissionEnv,
    MissionEffect,
    runShipSetExpr,
} from "../missions/mission_state_machine";
import { OutfitData } from "novadatainterface/OutiftData";
import { DEFAULT_ESCORT_ORDER } from "../player/escort_ops";
import { ActiveMission, PlayerState } from "../player/player_state";
import { applyCargoEffects } from "../player/cargo";
import { globalId, rawIdOf } from "../missions/stellar_filter";
import { PlayerStateResource } from "../player/player_state_component";
import { makeRng } from "../player/pilot_files";
import { MessageLogResource } from "../display/message_log";
import { DeathEvent } from "./death_plugin";
import { BoardingProfileComponent, makeDudeShip, rollDudeType,
    setNoCollision } from "./dude";
import { EscortComponent } from "./escort_plugin";
import { GameDataResource } from "./game_data_resource";
import { ArmorComponent, ShieldComponent } from "./health_plugin";
import { BoardedEvent } from "./interaction_events";
import { AIConfigComponent, AIStateComponent } from "./npc_ai_plugin";
import { OutfitsStateComponent } from "./outfit_plugin";
import { ChooseRandomTargetComponent, DeathAISystem } from "./npc_plugin";
import { PersComponent } from "./pers_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ShipComponent, ShipDataComponent,
    shipFreeCargoTons } from "./ship_plugin";
import { Stat } from "./stat";
import { SystemIdResource } from "./system_id_resource";
import { TargetComponent } from "./target_component";

export const MissionShipComponent = new Component<{
    missionId: string;
    // mïsn ShïpGoal; -1 for aux ships (which carry no goals).
    goal: number;
    index: number;
    aux: boolean;
    // mïsn ShïpBehav (-1 standard AI, 0 attack player, 1 protect player,
    // 2 attack enemy stellars).
    behav: number;
    // Rolled from the ShipName/ShipSubtitle STR# sets (null when unset).
    name: string | null;
    subtitle: string | null;
    // Sticky disable latch: once armor+shield/2 drops under the threshold
    // the ship stays disabled even if its stats regenerate.
    disabled: boolean;
}>('MissionShipComponent');

const SpawnedResource = new Resource<{ val: boolean }>('MissionShipsSpawnedResource');
const SpawnCounterResource = new Resource<{ n: number }>('MissionShipSpawnCounterResource');

// The player's ship, for ShïpBehav targeting.
const PlayerShipQuery = new Query([UUID, PlayerShipSelector,
    MovementStateComponent, TargetComponent] as const);

// The player's ship, for the free-cargo budget of pickups and plunder.
const PlayerCargoQuery = new Query([UUID, PlayerShipSelector] as const);

// Free hold space on the player's ship (null = no ship known here, load
// unconditionally).
function playerFreeCargoTons(world: World, runQuery: RunQueryFunction,
    state: PlayerState): number | null {
    const player = runQuery(PlayerCargoQuery)[0];
    const entity = player ? world.entities.get(player[0]) : undefined;
    return entity ? shipFreeCargoTons(entity, state) : null;
}

function missionContext(world: World): { state: PlayerState; env: MissionEnv } | null {
    const state = world.resources.get(PlayerStateResource);
    const env = world.resources.get(MissionEnvResource);
    return state && env ? { state, env } : null;
}

function findActive(state: PlayerState, missionId: string): ActiveMission | undefined {
    return state.activeMissions.find(active => active.missionId === missionId);
}

// The player's boarding context: their ship's crew plus owned marine
// outfits (oütf ModType 25). Outfit data is read from the sync cache — the
// player's own outfits resolve when their ship's physics do, so an
// uncached id here can only be a cold world; it contributes nothing.
function playerBoardingCrew(gameData: GameDataInterface, world: World,
    runQuery: RunQueryFunction): { crew: number; marinePercent: number } {
    const player = runQuery(PlayerCargoQuery)[0];
    const entity = player ? world.entities.get(player[0]) : undefined;
    const shipCrew = entity?.components.get(ShipDataComponent)?.crew ?? 0;
    const owned: Array<readonly [OutfitData, number]> = [];
    const outfits = entity?.components.get(OutfitsStateComponent);
    if (outfits) {
        for (const [id, { count }] of outfits) {
            const outfit = gameData.data.Outfit.getCached(id);
            if (outfit) {
                owned.push([outfit, count]);
            }
        }
    }
    const marines = outfitMarines(owned);
    return {
        crew: effectivePlayerCrew(shipCrew, marines.crew),
        marinePercent: marines.oddsPercent,
    };
}

// Captures the boarded ship into the pilot's fleet: strips the mission tag
// and the generic NPC AI (no AIConfig/AIState/ChooseRandomTarget — escorts
// never pick their own fights; the EscortPlugin contract), tags it as an
// escort, and records it on PlayerState.fleet, the persistent model that
// SpawnEscortsSystem rebuilds on every warp-in.
function captureIntoFleet(state: PlayerState, world: World, uuid: string,
    shipType: string): void {
    const entity = world.entities.get(uuid);
    if (!entity) {
        return;
    }
    entity.components.delete(MissionShipComponent);
    entity.components.delete(AIConfigComponent);
    entity.components.delete(AIStateComponent);
    entity.components.delete(ChooseRandomTargetComponent);
    entity.components.set(TargetComponent, { target: undefined });
    const escortId = String(state.fleet.nextId++);
    entity.components.set(EscortComponent, {
        escortId,
        shipType,
        // Fresh captures start in formation (player/escort_ops.ts).
        orders: DEFAULT_ESCORT_ORDER,
    });
    state.fleet.escorts.push({ id: escortId, shipType });
    queuePlayerStateSave();
}

// The boarding outcome lines land on the message log when the display
// layer loaded it (headless worlds simply have no log resource).
function boardMessage(world: World, text: string): void {
    world.resources.get(MessageLogResource)?.addMessage(text);
}

function logEffects(effects: MissionEffect[]): void {
    for (const effect of effects) {
        console.info('[missions]', JSON.stringify(effect));
    }
    if (effects.length > 0) {
        queuePlayerStateSave();
    }
}


// --- spawning ---

const SpawnMissionShipsSystem = new AsyncSystem({
    name: 'SpawnMissionShipsSystem',
    args: [GameDataResource, SystemIdResource, Entities, GetWorld,
        SpawnedResource, SpawnCounterResource, SingletonComponent] as const,
    exclusive: true,
    async step(gameData, systemId, entities, world, spawned, counter) {
        if (spawned.val) {
            world.removeSystem(SpawnMissionShipsSystem);
            return;
        }
        spawned.val = true;
        const ctx = missionContext(world);
        if (!ctx) {
            return;
        }
        const { state, env } = ctx;
        const systemData = env.system(systemId);
        if (!systemData) {
            return;
        }
        for (const active of [...state.activeMissions]) {
            const mission = env.missionByRawId(rawIdOf(active.missionId));
            if (!mission) {
                continue;
            }
            const plan = planMissionShipSpawn(state, mission, active, systemId, env);
            const rng = makeRng(shipSpawnSeed(state, rawIdOf(mission.id),
                rawIdOf(systemId)));

            if (plan.specialCount > 0 && mission.shipDude) {
                await spawnGoalShips(gameData, env, entities, counter, mission,
                    active, plan, systemData, rng);
                // Observe (goal 4) is met by the ships being present in the
                // player's system — see mission_ship_goals.ts.
                logEffects(reportSpecialShipsPresent(state, mission, active, env));
            }
            if (plan.auxCount > 0 && mission.auxShipDude) {
                await spawnAuxShips(gameData, env, entities, counter, mission,
                    plan, systemData, rng);
            }
        }
    },
});

async function spawnGoalShips(gameData: GameDataInterface, env: MissionEnv,
    entities: EntityMap, counter: { n: number }, mission: MissionData,
    active: ActiveMission, plan: MissionShipSpawnPlan,
    systemData: SystemData, rng: () => number): Promise<void> {
    const dude = await loadDude(gameData, env, mission.shipDude!);
    if (!dude || !active.specialShips) {
        return;
    }
    for (let index = 0; index < plan.specialCount; index++) {
        const shipId = nextSpecialShipType(mission, active.specialShips,
            rollRng => rollDudeType(dude, rollRng), rng, index);
        if (!shipId) {
            continue;
        }
        await spawnMissionShip(gameData, env, entities, counter, mission,
            systemData, rng, {
                shipId, dude, index, aux: false, goal: mission.shipGoal,
                behav: mission.shipBehav,
            });
    }
}

async function spawnAuxShips(gameData: GameDataInterface, env: MissionEnv,
    entities: EntityMap, counter: { n: number }, mission: MissionData,
    plan: MissionShipSpawnPlan, systemData: SystemData,
    rng: () => number): Promise<void> {
    const dude = await loadDude(gameData, env, mission.auxShipDude!);
    if (!dude) {
        return;
    }
    for (let index = 0; index < plan.auxCount; index++) {
        const shipId = rollDudeType(dude, rng);
        if (!shipId) {
            continue;
        }
        await spawnMissionShip(gameData, env, entities, counter, mission,
            systemData, rng, {
                shipId, dude, index, aux: true, goal: -1, behav: -1,
            });
    }
}

interface SpawnRequest {
    shipId: string;
    dude: DudeData;
    index: number;
    aux: boolean;
    goal: number;
    behav: number;
}

async function spawnMissionShip(gameData: GameDataInterface, env: MissionEnv,
    entities: EntityMap, counter: { n: number }, mission: MissionData,
    systemData: SystemData, rng: () => number,
    request: SpawnRequest): Promise<void> {
    let shipData: ShipData;
    try {
        shipData = await gameData.data.Ship.get(request.shipId);
    }
    catch {
        env.warn(`Mission ship: unknown shïp ${request.shipId} (mïsn ${mission.id})`);
        return;
    }

    const ship = makeDudeShip(request.dude, shipData);
    ship.components.get(MovementStateComponent)!.position =
        shipStartPosition(mission.shipStart, systemData, env, rng);

    let name: string | null = null;
    let subtitle: string | null = null;
    if (!request.aux) {
        name = await pickString(gameData, env, mission.shipNameID, rng);
        subtitle = await pickString(gameData, env, mission.shipSubtitle, rng);
        if (name !== null) {
            ship.name = name;
        }
    }

    // Behav 0 pins the target onto the player every step; the random-target
    // AI would fight the pin, so it does not get the component.
    if (request.behav === 0) {
        ship.components.delete(ChooseRandomTargetComponent);
    }
    ship.components.set(TargetComponent, { target: undefined });

    if (request.aux && (mission.flags & 0x0100) !== 0) {
        setNoCollision(ship);
    }

    // Rescue ships (goal 5) arrive disabled. The ShipArmor/Shield providers
    // preserve an existing current value when they resolve, so this holds in
    // full game worlds too.
    if (request.goal === 5) {
        const physics = shipData.physics;
        ship.components.set(ArmorComponent, new Stat({
            current: 0,
            max: physics.armor,
            min: 0,
            recharge: physics.armorRecharge,
        }));
        ship.components.set(ShieldComponent, new Stat({
            current: 0,
            max: physics.shield,
            min: -physics.shield * 0.05,
            recharge: physics.shieldRecharge,
        }));
    }

    ship.components.set(MissionShipComponent, {
        missionId: mission.id,
        goal: request.goal,
        index: request.index,
        aux: request.aux,
        behav: request.behav,
        name,
        subtitle,
        disabled: false,
    });

    entities.set(`mission-ship ${mission.id} ${request.aux ? "aux" : "goal"}`
        + ` ${request.index} #${counter.n++}`, ship);
}

// ShipStart -4..-1 are the system's nav points (its planets, in order);
// 0 is random. 1 (hyperspace-in delay) and 2 (cloaked) have no engine
// support yet and fall back to random.
function shipStartPosition(start: number, systemData: SystemData,
    env: MissionEnv, rng: () => number): Position {
    if (start <= -1 && start >= -4) {
        const planetId = systemData.planets[-start - 1];
        const planet = planetId ? env.planet(planetId) : null;
        if (planet) {
            return new Position(planet.position[0], planet.position[1]);
        }
    }
    return new Position(6000 * (rng() - 0.5), 6000 * (rng() - 0.5));
}

async function loadDude(gameData: GameDataInterface, env: MissionEnv,
    dudeId: string): Promise<DudeData | null> {
    try {
        return await gameData.data.Dude.get(dudeId);
    }
    catch {
        env.warn(`Mission ship: unknown düde ${dudeId}`);
        return null;
    }
}

async function pickString(gameData: GameDataInterface, env: MissionEnv,
    strId: number, rng: () => number): Promise<string | null> {
    if (strId < 0) {
        return null;
    }
    try {
        const set = await gameData.data.StringSet.get(globalId(env.prefix, strId));
        if (set.strings.length === 0) {
            return null;
        }
        return set.strings[Math.floor(rng() * set.strings.length)];
    }
    catch {
        env.warn(`Mission ship: unknown STR# ${globalId(env.prefix, strId)}`);
        return null;
    }
}


// --- goal tracking ---

// Destroy (0): a goal ship died. Runs before the NPC death AI so the
// bookkeeping sees the entity before it is removed (both delete it).
export const MissionShipDeathSystem = new System({
    name: 'MissionShipDeathSystem',
    events: [DeathEvent],
    args: [DeathEvent, UUID, Entities, MissionShipComponent, GetWorld] as const,
    before: [DeathAISystem],
    step(_event, uuid, entities, ship, world) {
        const ctx = missionContext(world);
        entities.delete(uuid);
        if (!ctx) {
            return;
        }
        const mission = ctx.env.missionByRawId(rawIdOf(ship.missionId));
        const active = findActive(ctx.state, ship.missionId);
        if (!mission || !active) {
            return;
        }
        if (ship.aux) {
            logEffects(reportAuxShipDestroyed(ctx.state, mission, active, ctx.env));
        }
        else {
            logEffects(reportSpecialShipLoss(ctx.state, mission, active, ctx.env,
                "killed"));
        }
    },
});

// Disable (1): latch the sticky disabled flag at the HealthPlugin threshold
// and count the loss. Board/rescue ships (2/5) only latch here; the board
// key (interaction_plugin.ts) works off the latch.
const MissionShipDisableSystem = new System({
    name: 'MissionShipDisableSystem',
    args: [MissionShipComponent, Optional(ArmorComponent),
        Optional(ShieldComponent), GetWorld] as const,
    step(ship, armor, shield, world) {
        if (ship.aux || ship.disabled
            || !isShipDisabled(armor ?? null, shield ?? null)) {
            return;
        }
        ship.disabled = true;
        if (ship.goal !== 1) {
            return;
        }
        const ctx = missionContext(world);
        if (!ctx) {
            return;
        }
        const mission = ctx.env.missionByRawId(rawIdOf(ship.missionId));
        const active = findActive(ctx.state, ship.missionId);
        if (!mission || !active) {
            return;
        }
        logEffects(reportSpecialShipLoss(ctx.state, mission, active, ctx.env,
            "disabled"));
    },
});

// Board (2) / rescue (5): the player pressed the board key on a disabled
// target in range (interaction_plugin.ts emits BoardedEvent). The pure
// resolver (missions/boarding.ts) applies the plunder — its cargo effects
// are real now: what fits goes into the pilot's hold (PlayerState.cargo) —
// and the govt boarding penalty; for a board/rescue goal ship the ship is
// then taken (removed), PickupMode 2 loads the mission cargo first, the
// loss is reported, and a flag-0x0001 mission auto-aborts afterwards
// (Bible mïsn flags 0x0001).
export const MissionShipBoardedSystem = new System({
    name: 'MissionShipBoardedSystem',
    events: [BoardedEvent] as const,
    args: [BoardedEvent, UUID, Entities, GetWorld, RunQuery, ShipComponent,
        Optional(BoardingProfileComponent), Optional(ShipDataComponent),
        Optional(PersComponent), Optional(MissionShipComponent),
        GameDataResource] as const,
    step(_event, uuid, entities, world, runQuery, shipType, profile, shipData,
        pers, ship, gameData) {
        const ctx = missionContext(world);
        if (!ctx) {
            return;
        }
        const { state, env } = ctx;

        // Fail closed without a boarding profile (unknown booty), and a
        // ship plunders only once.
        if (!profile || profile.plundered) {
            return;
        }
        profile.plundered = true;

        // The free-cargo budget for this board's pickups and plunder (null
        // when the player's ship is unknown here: load unconditionally).
        const freeCargoTons = playerFreeCargoTons(world, runQuery, state);

        // ShipDataComponent rides on every ship in full worlds (përs ships
        // even carry a name-cloned copy); without it the price — and with
        // it the money booty — degrades to zero.
        const data = shipData ?? { ...getDefaultShipData(), id: shipType.id };
        const dude = { booty: profile.booty, govt: profile.govtId };

        // The goal ship of a running board/rescue mission? (It gets the
        // boarding-penalty exemption and the goal bookkeeping below.)
        let mission: MissionData | null = null;
        if (ship !== undefined && !ship.aux
            && (ship.goal === 2 || ship.goal === 5)
            && findActive(state, ship.missionId) !== undefined) {
            mission = env.missionByRawId(rawIdOf(ship.missionId));
        }

        // One seeded stream for the whole board: the plunder draws come
        // first, the capture roll LAST (missions/capture.ts) — adding a
        // draw earlier would shift every loot roll.
        const rng = boardRng(state, rawIdOf(data.id));
        const boarded = resolveBoard(state, mission, data, dude,
            pers?.data ?? null, env, rng);
        applyCargoEffects(state, boarded.effects, freeCargoTons);
        logEffects(boarded.effects);

        if (ship === undefined || mission === null) {
            return;
        }
        const active = findActive(state, ship.missionId)!;

        // PickupMode 2: boarding the special ship loads the cargo (before
        // the goal report, so a DropoffMode-1 mission can drop it again at
        // mission end).
        if (mission.pickupMode === 2) {
            logEffects(boardPickupCargo(mission, active, freeCargoTons));
        }

        // The goal report and the flag-0x0001 auto-abort fire whether or
        // not the capture below succeeds: the boarding happened either way
        // — only the ship's fate differs.
        logEffects(reportSpecialShipLoss(state, mission, active, env,
            "boarded"));

        // Flag 0x0001 auto-aborts a board/rescue mission once its special
        // ship is boarded — but a mission the report just completed or
        // failed is already gone and cannot abort.
        if ((mission.flags & 0x0001) !== 0
            && findActive(state, ship.missionId) !== undefined) {
            logEffects(abortMission(state, mission, active, env,
                { auto: true }).effects);
        }

        // Capture: the last draw on this board's stream. A 0-crew defender
        // auto-captures (flagged approximation — the Bible says such ships
        // cannot be boarded at all; here a defenseless hulk is trivially
        // taken, no roll). On success the ship joins the fleet as an
        // escort instead of being deleted; on a repulse it stays disabled
        // where it is — the plundered latch above allows one capture
        // attempt per disable.
        const boarding = playerBoardingCrew(gameData, world, runQuery);
        const odds = captureOdds(boarding.crew, data.crew,
            boarding.marinePercent);
        const captured = data.crew <= 0 || rollCapture(rng, odds);
        const shipName = entities.get(uuid)?.name ?? data.name;
        if (!captured) {
            boardMessage(world, `${shipName} repels your boarding party`);
            return;
        }
        captureIntoFleet(state, world, uuid, data.id);
        const captureEffects: MissionEffect[] = [];
        runShipSetExpr(state, rawIdOf(data.id), env, data.onCapture,
            captureEffects);
        logEffects(captureEffects);
        boardMessage(world, `${shipName} joins your fleet`);
    },
});

// Escort (3): met while at least one escort survives and the travel leg is
// done. Polled every step because travelComplete flips on a landing, which
// this world does not otherwise observe.
const MissionShipEscortSystem = new System({
    name: 'MissionShipEscortSystem',
    args: [GetWorld, SingletonComponent] as const,
    step(world) {
        const ctx = missionContext(world);
        if (!ctx) {
            return;
        }
        for (const active of [...ctx.state.activeMissions]) {
            const mission = ctx.env.missionByRawId(rawIdOf(active.missionId));
            if (!mission) {
                continue;
            }
            logEffects(checkEscortGoal(ctx.state, mission, active, ctx.env));
        }
    },
});

// ShïpBehav mapping onto the existing AI: 0 attacks the player, 1 protects
// the player the only way the current AI can — by attacking the player's
// target — and 2 (attack enemy stellars) plus -1 keep the default
// random-target AI (no ship-vs-stellar combat exists yet).
const MissionShipBehavSystem = new System({
    name: 'MissionShipBehavSystem',
    args: [MissionShipComponent, TargetComponent, RunQuery] as const,
    step(ship, target, runQuery) {
        if (ship.aux || (ship.behav !== 0 && ship.behav !== 1)) {
            return;
        }
        const player = runQuery(PlayerShipQuery)[0];
        if (!player) {
            return;
        }
        if (ship.behav === 0) {
            target.target = player[0];
        }
        else if (player[3].target) {
            target.target = player[3].target;
        }
    },
});


export const MissionShipPlugin: Plugin = {
    name: 'MissionShipPlugin',
    build(world) {
        world.resources.set(SpawnedResource, { val: false });
        world.resources.set(SpawnCounterResource, { n: 0 });
        world.addSystem(SpawnMissionShipsSystem);
        world.addSystem(MissionShipDeathSystem);
        world.addSystem(MissionShipDisableSystem);
        world.addSystem(MissionShipBoardedSystem);
        world.addSystem(MissionShipEscortSystem);
        world.addSystem(MissionShipBehavSystem);
    },
};
