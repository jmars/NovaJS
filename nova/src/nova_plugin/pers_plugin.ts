// Përs (AI people) spawn support + persistence. The warp-in roll itself
// moved to ambient_plugin's PopulateSystem (the binary routes one rand(7)
// per ambient roll to FUN_004235c0's përs draw, and the sÿst Peripherals
// pairs at rand(100)+1 <= percent); this module keeps what that draw
// spawns: the eligibility test, the ship builder and the death/grudge
// bookkeeping. Dying marks the përs dead in PlayerState (never respawns);
// being damaged by the player latches a persistent grudge (flag 0x0001)
// that makes it hunt the player regardless of the Aggress radius.

import { PersData } from "novadatainterface/PersData";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { OutfitData } from "novadatainterface/OutiftData";
import { ShipData } from "novadatainterface/ShipData";
import { SystemData } from "novadatainterface/SystemData";
import { evaluateTest, parseTest, TestContext } from "novadatainterface/expressions";
import { GetWorld, UUID, RunQuery } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Position } from "nova_ecs/datatypes/position";
import { EntityMap } from "nova_ecs/entity_map";
import { Plugin } from "nova_ecs/plugin";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { MissionEnv } from "../missions/mission_state_machine";
import { queuePlayerStateSave } from "../missions/mission_plugin";
import {
    decodeSystemFilter,
    globalId,
    rawIdOf,
    SystemMatchContext,
    systemMatchesSystemFilter,
} from "../missions/stellar_filter";
import { ControlBits, PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { warpInAt } from "./fleet_plugin";
import { makeDudeShip, setNoCollision } from "./dude";
import { DamagedEvent, DeathEvent } from "./death_plugin";
import { ShieldComponent } from "./health_plugin";
import { AIConfigComponent, AggroRangeSystem } from "./npc_ai_plugin";
import { DeathAISystem } from "./npc_plugin";
import { OutfitsStateComponent } from "./outfit_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ShipDataComponent } from "./ship_plugin";
import { Stat } from "./stat";
import { TargetComponent } from "./target_component";

// Përs flag 0x0001: the përs holds a grudge — once the player damages it,
// it hunts the player from then on. Persisted in PlayerState.pers, so it
// survives warp and reload.
const GRUDGE_FLAG = 0x0001;

// The përs table in the binary has 1024 slots and the spawn roll draws one
// index with rand(0x3fe) = rand(1022) (FUN_004235c0); the drawn përs warps
// in iff its slot is eligible. The port's data layer does not expose engine
// table slots, so the draw is composed as the same probability:
// rand(1022) < eligibleCount, then a uniform pick among the eligible përs.
export const PERS_TABLE_ROLL = 0x3fe;

export const PersComponent = new Component<{
    persId: string,
    grudge: boolean,
    quoteShown: boolean,
    data: PersData,
}>('Pers');

// The player-ship test for the grudge systems: DamagedEvent's damager is
// an entity uuid, so "damaged by the player" is "damager carries
// PlayerShipSelector".
const PlayerQuery = new Query([UUID, PlayerShipSelector] as const);

// LinkSyst -1 matches any system; otherwise it uses the mïsn system filter
// codes (specific ids, the near bands and the govt relation bands).
export function persActive(pers: PersData, state: PlayerState, systemId: string,
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
    state: PlayerState, weaponOutfits: Map<string, string>,
    origin: Position): void {
    // FUN_004235c0: govt = përs+2, AI = përs+4, aggress = përs+6 clamped
    // (<1 → 1, >2 → 4) — the përs path carries the clamped value with NO
    // aggress roll, so makeDudeShip must not draw one (it would desync the
    // shared engine LCG stream).
    const aggress = pers.aggress < 1 ? 1 : pers.aggress > 2 ? 4 : pers.aggress;
    const ship = makeDudeShip(null, shipData, pers.govt, aggress);
    // The përs's own AI overrides what makeDudeShip guessed from the ship
    // class; aiType 0 means "use the ship's inherent AI" (dude.ts rule),
    // and coward 0 means the përs never flees.
    ship.components.set(AIConfigComponent, {
        aiType: pers.aiType || shipData.inherentAI,
        aggress,
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

    // Keep the përs off the player: scatter like the fleet spawn does.
    warpInAt(ship, origin);
    entities.set(`pers-ship ${pers.id}`, ship);
}

// Fetches the përs's ship class and warps it in — the spawn tail of
// FUN_004235c0, shared by ambient_plugin's peripheral loop and its global
// përs roll. The ship is keyed by the përs id: while it is alive in the
// system, a re-draw of the same përs is a no-op (the engine keeps one slot
// per living ship). Returns whether a ship was spawned.
export async function spawnPersShip(gameData: GameDataInterface,
    entities: EntityMap, pers: PersData, state: PlayerState,
    weaponOutfits: Map<string, string>, origin: Position): Promise<boolean> {
    if (!pers.shipType || entities.has(`pers-ship ${pers.id}`)) {
        return false;
    }
    let shipData: ShipData;
    try {
        shipData = await gameData.data.Ship.get(pers.shipType);
    }
    catch {
        console.warn(`[pers] unknown shïp ${pers.shipType} (përs ${pers.id})`);
        return false;
    }
    spawnPers(entities, shipData, pers, state, weaponOutfits, origin);
    return true;
}

// Weapon -> granting-outfit map, derived by scanning the outfit table once
// per world build (outfits are the only way to put a weapon on a ship in
// this engine).
export async function weaponOutfitMap(gameData: GameDataInterface):
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
        world.addSystem(PersDeathSystem);
        world.addSystem(PersGrudgeSystem);
        world.addSystem(PersGrudgeTargetSystem);
    },
};
