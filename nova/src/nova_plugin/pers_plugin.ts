// Përs (AI people) spawn + persistence (P3 of the ship-interaction layer):
// when a system world is built, every përs whose LinkSyst matches the
// system, whose ActiveOn test passes and who is neither dead nor
// deactivated rolls 5% and warps in as a dude-style NPC carrying the
// përs's own name (target display), shields (ShieldMod) and AI config.
// Dying marks the përs dead in PlayerState (never respawns); being
// damaged by the player latches a persistent grudge (flag 0x0001) that
// makes it hunt the player regardless of the Aggress radius.
//
// Flagged approximation: stock ties the 5% roll to each düde-ship
// creation, so a përs can tag along on any spawned dude ship. This engine
// spawns NPCs once per system-world build (see fleet_plugin.ts), so the
// roll is tied to warp-in instead — one seeded roll per përs per system
// entry.

import { PersData } from "novadatainterface/PersData";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { OutfitData } from "novadatainterface/OutiftData";
import { ShipData } from "novadatainterface/ShipData";
import { SystemData } from "novadatainterface/SystemData";
import { evaluateTest, parseTest, TestContext } from "novadatainterface/expressions";
import { Entities, GetWorld, RunQuery, UUID } from "nova_ecs/arg_types";
import { AsyncSystem } from "nova_ecs/async_system";
import { Component } from "nova_ecs/component";
import { EntityMap } from "nova_ecs/entity_map";
import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { MissionEnv } from "../missions/mission_state_machine";
import { MissionEnvResource, queuePlayerStateSave } from "../missions/mission_plugin";
import {
    decodeSystemFilter,
    globalId,
    rawIdOf,
    SystemMatchContext,
    systemMatchesSystemFilter,
} from "../missions/stellar_filter";
import { ControlBits, PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { makeRng } from "../player/pilot_files";
import { makeDudeShip, setNoCollision } from "./dude";
import { DamagedEvent, DeathEvent } from "./death_plugin";
import { GameDataResource } from "./game_data_resource";
import { ShieldComponent } from "./health_plugin";
import { AIConfigComponent, AggroRangeSystem } from "./npc_ai_plugin";
import { DeathAISystem } from "./npc_plugin";
import { OutfitsStateComponent } from "./outfit_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ShipDataComponent } from "./ship_plugin";
import { Stat } from "./stat";
import { SystemIdResource } from "./system_id_resource";
import { TargetComponent } from "./target_component";

// Përs flag 0x0001: the përs holds a grudge — once the player damages it,
// it hunts the player from then on. Persisted in PlayerState.pers, so it
// survives warp and reload.
const GRUDGE_FLAG = 0x0001;

// Bible: a 5% chance that each eligible përs is also created.
const SPAWN_CHANCE = 0.05;

export const PersComponent = new Component<{
    persId: string,
    grudge: boolean,
    quoteShown: boolean,
    data: PersData,
}>('Pers');

const PersSpawnedResource = new Resource<{ val: boolean }>('PersSpawnedResource');

// The player-ship test for the grudge systems: DamagedEvent's damager is
// an entity uuid, so "damaged by the player" is "damager carries
// PlayerShipSelector".
const PlayerQuery = new Query([UUID, PlayerShipSelector] as const);

const SpawnPersSystem = new AsyncSystem({
    name: 'SpawnPersSystem',
    args: [GameDataResource, SystemIdResource, Entities, GetWorld,
        PersSpawnedResource, SingletonComponent] as const,
    exclusive: true,
    async step(gameData, systemId, entities, world, spawned) {
        if (spawned.val) {
            world.removeSystem(SpawnPersSystem);
            return;
        }
        spawned.val = true;
        const state = world.resources.get(PlayerStateResource);
        const env = world.resources.get(MissionEnvResource);
        if (!state || !env) {
            return;
        }
        const ids = await gameData.ids;
        if (ids.Pers.length === 0) {
            return;
        }
        const systemData = env.system(systemId);
        if (!systemData) {
            return;
        }
        const systemRawId = rawIdOf(systemId);
        const weaponOutfits = await weaponOutfitMap(gameData);

        for (const persId of ids.Pers) {
            let pers: PersData;
            try {
                pers = await gameData.data.Pers.get(persId);
            }
            catch {
                continue;
            }
            // Dead and deactivated përs never respawn.
            if ((state.pers[persId]?.status ?? "alive") !== "alive") {
                continue;
            }
            if (!persActive(pers, state, systemId, systemData, env)) {
                continue;
            }
            if (!pers.shipType) {
                continue;
            }
            const rng = makeRng(persSpawnSeed(state, rawIdOf(persId), systemRawId));
            // See the file comment: the roll is tied to warp-in, one draw
            // per përs per system entry.
            if (rng() >= SPAWN_CHANCE) {
                continue;
            }
            let shipData: ShipData;
            try {
                shipData = await gameData.data.Ship.get(pers.shipType);
            }
            catch {
                console.warn(`[pers] unknown shïp ${pers.shipType} (përs ${persId})`);
                continue;
            }
            spawnPers(entities, shipData, pers, state, weaponOutfits);
        }
    },
});

// LinkSyst -1 matches any system; otherwise it uses the mïsn system filter
// codes (specific ids, the near bands and the govt relation bands).
function persActive(pers: PersData, state: PlayerState, systemId: string,
    systemData: SystemData, env: MissionEnv): boolean {
    if (pers.linkSyst !== -1) {
        const originSystemId = (state.lastStellar !== null
            ? env.systemOfPlanet(state.lastStellar) : null) ?? systemId;
        const ctx: SystemMatchContext = {
            originSystemId,
            playerSystemId: systemId,
            travelStellarId: null,
            returnStellarId: null,
            systemOfPlanet: id => env.systemOfPlanet(id),
            system: id => env.system(id),
            planet: id => env.planet(id),
            government: id => env.government(id),
            govtByRawId: rawId => env.govtByRawId(rawId),
        };
        if (!systemMatchesSystemFilter(systemData,
            decodeSystemFilter(pers.linkSyst), ctx)) {
            return false;
        }
    }
    if (pers.activeOn !== "") {
        const ctx: TestContext = {
            bits: new ControlBits(state.bits),
            gender: state.gender === "female" ? 0 : 1,
            // Outfit ownership lives on the player's ship entities, which
            // are not reachable from here; stock përs ActiveOn
            // expressions do not use Oxxx.
            hasOutfit: () => false,
            exploredSystem: rawId =>
                state.exploredSystems.includes(globalId(env.prefix, rawId)),
        };
        if (!evaluateTest(parseTest(pers.activeOn,
            message => console.warn(`[pers] ${message}`)), ctx)) {
            return false;
        }
    }
    return true;
}

function spawnPers(entities: EntityMap, shipData: ShipData, pers: PersData,
    state: PlayerState,
    weaponOutfits: Map<string, string>): void {
    const ship = makeDudeShip(null, shipData, pers.govt);
    // The përs's own AI overrides what makeDudeShip guessed from the ship
    // class; aiType 0 means "use the ship's inherent AI" (dude.ts rule),
    // and coward 0 means the përs never flees.
    ship.components.set(AIConfigComponent, {
        aiType: pers.aiType || shipData.inherentAI,
        aggress: pers.aggress,
        coward: pers.coward > 0 ? pers.coward : null,
    });
    const progress = state.pers[pers.id];
    ship.components.set(PersComponent, {
        persId: pers.id,
        grudge: progress?.grudge ?? false,
        quoteShown: progress?.quoteShown ?? false,
        data: pers,
    });
    ship.components.set(TargetComponent, { target: undefined });

    // ShieldMod scales the ship-class shield maximum (100 = stock).
    // Negative values make the përs unhittable, like dude flag 0x0100.
    const physics = shipData.physics;
    if (pers.shieldMod < 0) {
        setNoCollision(ship);
    } else if (pers.shieldMod !== 100) {
        const max = physics.shield * pers.shieldMod / 100;
        // Pre-set so ShipShieldProvider (whose update key is
        // ShipPhysicsComponent) keeps the scaled max.
        ship.components.set(ShieldComponent, new Stat({
            current: max,
            max,
            min: -max * 0.05,
            recharge: physics.shieldRecharge,
        }));
    }

    // The përs's name replaces the ship-class name on the target display
    // (the status bar reads ShipDataComponent.name). ShipDataProvider's
    // update key is ShipComponent, so this pre-set clone sticks.
    ship.components.set(ShipDataComponent, { ...shipData, name: pers.name });

    // Pers weapons ride on top of the ship's stock outfits: each listed
    // weapon is added through the outfit that grants it; a negative
    // WeapCount removes that many stock outfits. Pre-set so
    // ShipOutfitsProvider (which rebuilds from ShipDataComponent)
    // keeps the merged set.
    if (pers.weapTypes.length > 0) {
        const outfits = new Map<string, { count: number }>();
        for (const [outfitId, count] of Object.entries(shipData.outfits)) {
            outfits.set(outfitId, { count });
        }
        for (const [index, weaponId] of pers.weapTypes.entries()) {
            if (!weaponId) {
                continue;
            }
            const outfitId = weaponOutfits.get(weaponId);
            if (!outfitId) {
                console.warn(`[pers] no outfit grants wëap ${weaponId} (përs ${pers.id})`);
                continue;
            }
            const stock = shipData.outfits[outfitId] ?? 0;
            outfits.set(outfitId, { count: stock + (pers.weapCounts[index] ?? 0) });
        }
        ship.components.set(OutfitsStateComponent, outfits);
    }

    entities.set(`pers-ship ${pers.id}`, ship);
}

// Weapon -> granting-outfit map, derived by scanning the outfit table once
// per world build (outfits are the only way to put a weapon on a ship in
// this engine).
async function weaponOutfitMap(gameData: GameDataInterface):
    Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const ids = await gameData.ids;
    for (const outfitId of ids.Outfit) {
        let outfit: OutfitData;
        try {
            outfit = await gameData.data.Outfit.get(outfitId);
        }
        catch {
            continue;
        }
        for (const weaponId of Object.keys(outfit.weapons)) {
            map.set(weaponId, outfitId);
        }
    }
    return map;
}

// One përs's spawn roll per entry: seeded by pilot, përs, system and game
// date, like the flët and mission spawn rolls — so reloads and peers agree
// on whether the përs appeared. Never Math.random.
function persSpawnSeed(state: PlayerState, persRawId: number,
    systemRawId: number): number {
    const { day, month, year } = state.date;
    const dayCount = year * 365 + month * 40 + day;
    return (state.rngSeed ^ (persRawId * 0x9E37) ^ (systemRawId * 0x85EB)
        ^ (dayCount * 0xC2B2AE35)) >>> 0;
}

// Marks a destroyed përs dead so it never spawns again. Runs before
// DeathAISystem deletes the entity (combat_rating_plugin pattern).
const PersDeathSystem = new System({
    name: 'PersDeathSystem',
    events: [DeathEvent],
    args: [DeathEvent, UUID, PersComponent, GetWorld] as const,
    before: [DeathAISystem],
    step(_event, _uuid, pers, world) {
        const state = world.resources.get(PlayerStateResource);
        if (!state) {
            return;
        }
        state.pers[pers.persId] = {
            status: "dead",
            grudge: pers.grudge,
            quoteShown: pers.quoteShown,
        };
        queuePlayerStateSave();
    },
});

// Latches the grudge when the player damages a grudge-holding përs, and
// persists it (it outlives the ship and the system).
const PersGrudgeSystem = new System({
    name: 'PersGrudgeSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, PersComponent, GetWorld, RunQuery] as const,
    step({ damager }, pers, world, runQuery) {
        if ((pers.data.flags & GRUDGE_FLAG) === 0 || pers.grudge) {
            return;
        }
        const player = runQuery(PlayerQuery)[0];
        if (!player || player[0] !== damager) {
            return;
        }
        pers.grudge = true;
        const state = world.resources.get(PlayerStateResource);
        if (!state) {
            return;
        }
        const progress = state.pers[pers.persId] ?? {
            status: "alive" as const,
            grudge: false,
            quoteShown: false,
        };
        progress.grudge = true;
        state.pers[pers.persId] = progress;
        queuePlayerStateSave();
    },
});

// The grudge's targeting half: a grudged përs hunts the player from any
// distance, overriding the Aggress radius and enemy-ship preference of
// AggroRange (which keeps whatever live target is set). Lives here (not in
// AggroRange) because npc_ai cannot import PersComponent without an import
// cycle through this module; PersPlugin registers after NpcAIPlugin in
// system_plugin.ts, so this runs after AggroRange each step.
const PersGrudgeTargetSystem = new System({
    name: 'PersGrudgeTargetSystem',
    args: [PersComponent, TargetComponent, RunQuery] as const,
    after: [AggroRangeSystem],
    step(pers, target, runQuery) {
        if (!pers.grudge) {
            return;
        }
        const player = runQuery(PlayerQuery)[0]?.[0];
        if (player !== undefined) {
            target.target = player;
        }
    },
});

export const PersPlugin: Plugin = {
    name: 'PersPlugin',
    build(world) {
        world.resources.set(PersSpawnedResource, { val: false });
        world.addSystem(SpawnPersSystem);
        world.addSystem(PersDeathSystem);
        world.addSystem(PersGrudgeSystem);
        world.addSystem(PersGrudgeTargetSystem);
    },
};
