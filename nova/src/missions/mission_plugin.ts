// ECS glue for the mission system. The mission state machine
// (mission_state_machine.ts), availability evaluator and stellar filters are
// pure and headless-testable; this module adapts them to the engine.
//
// Architecture note — client-authoritative mission state: the PlayerState
// (including activeMissions) is a plain object owned by the client, shared
// between worlds as a Resource and persisted through the pilot-file routes
// (see player_state_component.ts). Mission transitions mutate it directly
// and deterministically (seeded rng streams — see mission_state_machine.ts),
// matching how the rest of the engine already treats the player's ship and
// outfit state; the server relays entity deltas but does not arbitrate
// missions. MissionPlugin itself only makes sure the MissionEnv data is
// loaded; the per-world systems live with the events they serve
// (jump_plugin.ts handles FinishJumpEvent, the LandSystem in
// display/spaceport_plugin.ts runs arrival processing before the spaceport
// UI opens).
//
// This module deliberately imports nothing from nova_plugin/: the
// dependency arrow points the other way (nova_plugin -> missions), which
// keeps the bazel graph acyclic. Callers that need engine hooks (game data,
// sound) put them on the world or pass them as EnvHooks.

import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";
import { World } from "nova_ecs/world";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { GovernmentData } from "novadatainterface/GovernmentData";
import { CronData } from "novadatainterface/CronData";
import { JunkData } from "novadatainterface/JunkData";
import { MissionData } from "novadatainterface/MissionData";
import { PlanetData } from "novadatainterface/PlanetData";
import { RankData } from "novadatainterface/RankData";
import { SystemData } from "novadatainterface/SystemData";
import { SetContext } from "novadatainterface/expressions";
import { ControlBits, PlayerState } from "../player/player_state";
import { PlayerStatePlugin } from "../player/player_state_plugin";
import { activateRank, deactivateRank } from "../player/ranks";
import {
    acceptMission,
    abortMission,
    failMission,
    MissionEffect,
    MissionEnv,
} from "./mission_state_machine";
import { globalId, rawIdOf } from "./stellar_filter";


// The game data interface, set by whichever bootstraps the world (browser.ts
// for the outer world, makeSystem for system worlds) so this module does not
// depend on nova_plugin's GameDataResource.
export const MissionGameDataResource = new Resource<GameDataInterface>('MissionGameDataResource');

// The mission environment for the world this plugin was built on.
export const MissionEnvResource = new Resource<MissionEnv>('MissionEnvResource');

// Component mirror of the PlayerState on the player's ship entity lives in
// player_state_component.ts; missions only ever touch the shared Resource.


// --- env data (shared, module-cached per game data) ---

interface MissionEnvData {
    prefix: string;
    planets: Map<string, PlanetData>;
    systems: Map<string, SystemData>;
    governments: Map<string, GovernmentData>;
    missions: Map<string, MissionData>;
    crons: Map<string, CronData>;
    ranks: Map<string, RankData>;
    junks: Map<string, JunkData>;
    planetIds: string[];
    missionIds: string[];
    cronIds: string[];
    governmentList: GovernmentData[];
    planetToSystem: Map<string, string>;
}

const envDataCache = new Map<GameDataInterface, Promise<MissionEnvData>>();

async function buildMissionEnvData(gameData: GameDataInterface): Promise<MissionEnvData> {
    const ids = await gameData.ids;
    const data: MissionEnvData = {
        prefix: (ids.Mission[0] ?? "nova:0").split(":")[0],
        planets: new Map(),
        systems: new Map(),
        governments: new Map(),
        missions: new Map(),
        crons: new Map(),
        ranks: new Map(),
        junks: new Map(),
        planetIds: ids.Planet,
        missionIds: ids.Mission,
        cronIds: ids.Cron,
        governmentList: [],
        planetToSystem: new Map(),
    };

    async function load<T>(map: Map<string, T>,
        table: "Planet" | "System" | "Government" | "Mission" | "Cron" | "Rank"
        | "Junk",
        id: string): Promise<void> {
        try {
            // The tables are typed loosely here; each get returns the right
            // data class for its table at runtime.
            map.set(id, await (gameData.data[table] as any).get(id));
        }
        catch (e) {
            console.warn(`MissionEnv: failed to load ${table} ${id}`, e);
        }
    }

    for (const id of ids.Planet) {
        await load(data.planets, "Planet", id);
    }
    for (const id of ids.System) {
        await load(data.systems, "System", id);
    }
    for (const id of ids.Government) {
        await load(data.governments, "Government", id);
    }
    for (const id of ids.Mission) {
        await load(data.missions, "Mission", id);
    }
    for (const id of ids.Cron) {
        await load(data.crons, "Cron", id);
    }
    for (const id of ids.Rank) {
        await load(data.ranks, "Rank", id);
    }
    for (const id of ids.Junk) {
        await load(data.junks, "Junk", id);
    }
    data.governmentList = [...data.governments.values()];

    for (const [systemId, system] of data.systems) {
        for (const planetId of system.planets) {
            if (!data.planetToSystem.has(planetId)) {
                data.planetToSystem.set(planetId, systemId);
            }
        }
    }
    return data;
}

function rawIndex<T>(values: Map<string, T>): Map<number, T> {
    const index = new Map<number, T>();
    for (const [id, value] of values) {
        index.set(rawIdOf(id), value);
    }
    return index;
}


// --- set expressions ---

export interface EnvHooks {
    // P (play sound) forwards to the engine sound event; headless envs omit it.
    emitSound?(rawId: number): void;
    warn?(message: string): void;
}

// SetContext implementation over the PlayerState. Bit, rank, stellar and
// mission operations are real; the ones that need UI/ship models that do
// not exist yet (outfit grants and ship changes need the P6 ship-outfit
// model, player moves need spawned systems, Q needs the P5 dialog UI) warn
// and no-op, like the pilot-creation context in pilot_files.ts.
function makeMissionSetContext(state: PlayerState, env: MissionEnv,
    hooks: EnvHooks): { ctx: SetContext; takeEffects(): MissionEffect[] } {
    const collected: MissionEffect[] = [];
    const global = (rawId: number) => globalId(env.prefix, rawId);
    const findActive = (rawId: number) =>
        state.activeMissions.find(m => rawIdOf(m.missionId) === rawId);
    const withMission = (rawId: number, fn: (mission: MissionData) => void): void => {
        const mission = env.missionByRawId(rawId);
        if (mission) {
            fn(mission);
        }
        else {
            env.warn(`set expression targets missing mission ${global(rawId)}`);
        }
    };

    const ctx: SetContext = {
        bits: new ControlBits(state.bits),
        abortMission: rawId => withMission(rawId, mission => {
            const active = findActive(rawId);
            if (active) {
                collected.push(...abortMission(state, mission, active, env, { forced: true }).effects);
            }
        }),
        failMission: rawId => withMission(rawId, mission => {
            const active = findActive(rawId);
            if (active) {
                failMission(state, mission, active, env, collected);
            }
        }),
        startMission: rawId => withMission(rawId, mission => {
            // Sxxx starts the mission as if accepted where the player last
            // landed; acceptMission declines duplicates itself.
            if (state.lastStellar === null) {
                env.warn("S op with nowhere to start from (never landed); skipped");
                return;
            }
            collected.push(...acceptMission(state, mission, env, state.lastStellar).effects);
        }),
        grantOutfit: () => env.warn("grantOutfit: waits on the ship outfit model; ignored"),
        movePlayer: () => env.warn("movePlayer: waits on player relocation; ignored"),
        changeShip: () => env.warn("changeShip: waits on the ship model; ignored"),
        // K/L run the full ränk rules (cascade flags, permanent ranks) from
        // player/ranks.ts; the deactivated ids are returned for logging.
        activateRank: rawId => {
            const activated = activateRank(state, global(rawId), rankEnv(env));
            if (activated.length > 0) {
                console.info('[missions]', `K${rawId} deactivated ranks`,
                    JSON.stringify(activated));
            }
        },
        deactivateRank: rawId => {
            const deactivated = deactivateRank(state, global(rawId), rankEnv(env));
            if (deactivated.length > 0) {
                console.info('[missions]', `L${rawId} deactivated ranks`,
                    JSON.stringify(deactivated));
            }
        },
        playSound: rawId => hooks.emitSound?.(rawId),
        destroyStellar: rawId => {
            const id = global(rawId);
            if (!state.destroyedStellars.includes(id)) {
                state.destroyedStellars.push(id);
            }
        },
        regenerateStellar: rawId => {
            const id = global(rawId);
            state.destroyedStellars = state.destroyedStellars.filter(other => other !== id);
        },
        leaveStellar: () => env.warn("leaveStellar: waits on the dialog UI; ignored"),
    };
    return { ctx, takeEffects: () => collected.splice(0, collected.length) };
}


// --- env construction ---

// The rank lookups the set-expression K/L ops (and, via the env below, the
// record/rank interplay) use; null when no rank data was loaded.
function rankEnv(env: MissionEnv): { rank(id: string): RankData | null } | null {
    return env.rank ? { rank: env.rank } : null;
}

function makeMissionEnv(data: MissionEnvData, hooks: EnvHooks = {}): MissionEnv {
    const warn = hooks.warn ?? ((message: string) => console.warn(`[missions] ${message}`));
    const rawPlanets = rawIndex(data.planets);
    const rawSystems = rawIndex(data.systems);
    const rawMissions = rawIndex(data.missions);
    const rawGovts = rawIndex(data.governments);
    const rawJunks = rawIndex(data.junks);
    const env: MissionEnv = {
        prefix: data.prefix,
        missionByRawId: rawId => rawMissions.get(rawId) ?? null,
        cronById: id => data.crons.get(id) ?? null,
        allCronIds: () => data.cronIds,
        planet: id => data.planets.get(id) ?? null,
        planetByRawId: rawId => rawPlanets.get(rawId) ?? null,
        system: id => data.systems.get(id) ?? null,
        systemByRawId: rawId => rawSystems.get(rawId) ?? null,
        systemOfPlanet: id => data.planetToSystem.get(id) ?? null,
        government: id => (id === null ? null : data.governments.get(id) ?? null),
        govtByRawId: rawId => rawGovts.get(rawId) ?? null,
        rank: id => data.ranks.get(id) ?? null,
        junk: rawId => rawJunks.get(rawId),
        allPlanetIds: () => data.planetIds,
        allMissionIds: () => data.missionIds,
        allGovernments: () => data.governmentList,
        makeSetContext: state => makeMissionSetContext(state, env, hooks),
        warn,
    };
    return env;
}

// Builds (or reuses) the mission env for the world, reading the game data
// from MissionGameDataResource, and stores it in MissionEnvResource. Returns
// null when the world has no game data (the caller should skip mission
// processing; systems also guard on the resource at step time).
export async function ensureMissionEnv(world: World,
    hooks: EnvHooks = {}): Promise<MissionEnv | null> {
    const existing = world.resources.get(MissionEnvResource);
    if (existing) {
        return existing;
    }
    const gameData = world.resources.get(MissionGameDataResource);
    if (!gameData) {
        return null;
    }
    let dataPromise = envDataCache.get(gameData);
    if (!dataPromise) {
        dataPromise = buildMissionEnvData(gameData);
        envDataCache.set(gameData, dataPromise);
    }
    const env = makeMissionEnv(await dataPromise, hooks);
    world.resources.set(MissionEnvResource, env);
    return env;
}


// --- persistence hook ---

// The browser exposes a debounced save for the current pilot; mission
// transitions call this after mutating state. Headless/test environments
// simply have no global queued save.
export function queuePlayerStateSave(): void {
    const save = (globalThis as { queueSavePlayerState?: () => void }).queueSavePlayerState;
    if (typeof save === "function") {
        save();
    }
}


// --- the plugin ---

// Registers the mission env (and the PlayerState fallback) on a world. On
// the outer world browser.ts/NovaPlugin set MissionGameDataResource first;
// makeSystem does the same for per-system worlds, where the jump and
// landing systems consume the env.
export const MissionPlugin: Plugin = {
    name: 'MissionPlugin',
    async build(world) {
        world.addPlugin(PlayerStatePlugin);
        const env = await ensureMissionEnv(world);
        if (!env) {
            console.warn('MissionPlugin: no MissionGameDataResource on world; missions disabled');
        }
    }
};
