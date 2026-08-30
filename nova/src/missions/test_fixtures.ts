// Synthetic MissionData/PlanetData/GovernmentData/PlayerState fixtures for
// the headless mission specs, modeled on the stock Vellos missions
// (m128/m129). Shared by mission_state_machine_test.ts and
// availability_test.ts.
//
// Universe: S0 (nova:300) - S1 (nova:301) - S2 (nova:302), plus the
// unlinked S3 (nova:303).

import { CronData, getDefaultCronData } from "novadatainterface/CronData";
import { GovernmentData, getDefaultGovernmentData } from "novadatainterface/GovernmentData";
import { getDefaultMissionData, MissionData } from "novadatainterface/MissionData";
import { getDefaultPlanetData, PlanetData } from "novadatainterface/PlanetData";
import { getDefaultRankData, RankData } from "novadatainterface/RankData";
import { getDefaultSystemData, SystemData } from "novadatainterface/SystemData";
import { SetContext } from "novadatainterface/expressions";
import { ControlBits, PlayerState } from "../player/player_state";
import { OfferContext, OfferLocation } from "./availability";
import { MissionEnv } from "./mission_state_machine";
import { globalId } from "./stellar_filter";


export function makeGovt(id: string, name: string, classes: number[],
    allies: number[] = [], enemies: number[] = []): GovernmentData {
    return {
        ...getDefaultGovernmentData(),
        id,
        name,
        classes,
        allies,
        enemies,
    };
}

export const FEDERATION = makeGovt("nova:128", "Federation", [1], [5], [16]);
export const ALLY_GOVT = makeGovt("nova:129", "Ally Govt", [5]);
export const POLARIS = makeGovt("nova:130", "Polaris", [16], [], [1]);
export const VELLOS = makeGovt("nova:136", "Vell-os", [1]);
export const REBELS = makeGovt("nova:141", "Rebels", [7]);

export function makePlanet(id: string, name: string, position: [number, number],
    overrides: Partial<PlanetData> = {}): PlanetData {
    return {
        ...getDefaultPlanetData(),
        id,
        name,
        position,
        govt: null,
        inhabited: true,
        ...overrides,
    };
}

export const START = makePlanet("nova:130", "Start One", [1, 1],
    { govt: "nova:128", hasBar: true });
export const BARREN = makePlanet("nova:140", "Barren Rock", [2, 2],
    { govt: null, inhabited: false });
// Deliberately duplicates Earth's name+position in a different system.
export const EARTH_DUP = makePlanet("nova:150", "Earth", [0, 0], { govt: null });
export const EARTH = makePlanet("nova:128", "Earth", [0, 0],
    { govt: "nova:128", hasBar: true });
export const VELLOS_WORLD = makePlanet("nova:408", "Vell-os Prime", [9, 9],
    { govt: "nova:136" });
export const ALLY_STATION = makePlanet("nova:170", "Ally Station", [3, 3],
    { govt: "nova:129" });
export const FAR_STATION = makePlanet("nova:160", "Far Station", [4, 4],
    { govt: "nova:130" });

export const PLANETS = new Map<string, PlanetData>(
    [START, BARREN, EARTH_DUP, EARTH, VELLOS_WORLD, ALLY_STATION, FAR_STATION]
        .map(planet => [planet.id, planet]));

function makeSystem(id: string, links: string[], planets: string[]): SystemData {
    return { ...getDefaultSystemData(), id, links, planets };
}

export const SYSTEMS = new Map<string, SystemData>([
    ["nova:300", makeSystem("nova:300", ["nova:301"], ["nova:130"])],
    ["nova:301", makeSystem("nova:301", ["nova:300", "nova:302"],
        ["nova:140", "nova:150", "nova:170"])],
    ["nova:302", makeSystem("nova:302", ["nova:301"], ["nova:128", "nova:408"])],
    ["nova:303", makeSystem("nova:303", [], ["nova:160"])],
]);

export const GOVERNMENTS = new Map<string, GovernmentData>([
    ["nova:128", FEDERATION],
    ["nova:129", ALLY_GOVT],
    ["nova:130", POLARIS],
    ["nova:136", VELLOS],
    ["nova:141", REBELS],
]);

export function makeMission(id: string, overrides: Partial<MissionData> = {}): MissionData {
    return { ...getDefaultMissionData(), id, name: id, ...overrides };
}

export function makeCron(id: string, overrides: Partial<CronData> = {}): CronData {
    return { ...getDefaultCronData(), id, name: id, ...overrides };
}

// Stock crön 221 "Generic misn delay cron", fields as read from the real
// resource: eligible while b6666 (a mission just finished), held one day,
// then its continuous-iterative OnEnd clears b6666. It is the gate between
// the Vellos missions m128 and m129.
export const CRON_221 = makeCron("nova:221", {
    name: "Generic misn delay cron",
    random: 100,
    duration: 0,
    preHoldoff: 1,
    postHoldoff: 0,
    flags: 0x0002,
    enableOn: "b6666",
    onStart: "",
    onEnd: "!b6666",
    newsGovt: [-1, -1, -1, -1],
    govtNewsStr: [-1, -1, -1, -1],
    indNewsStr: -1,
});

export const CRONS = new Map<string, CronData>([
    [CRON_221.id, CRON_221],
]);

export function makeRank(id: string, govt: string | null, weight: number, flags = 0,
    overrides: Partial<RankData> = {}): RankData {
    return { ...getDefaultRankData(), id, govt, weight, flags, ...overrides };
}

// A Federation rank with the deactivate-on-crime flag, active in none of
// the specs unless they activate it; exercises the legal/rank interplay
// through the env (legal_status strips it on any Federation crime).
export const FED_CRIME_RANK = makeRank("nova:440", "nova:128", 5, 0x0040);

export const RANKS = new Map<string, RankData>([
    [FED_CRIME_RANK.id, FED_CRIME_RANK],
]);

// Modeled on stock m128 "Delivery to Earth; Vellos1".
export const M128 = makeMission("nova:128", {
    name: "Delivery to Earth; Vellos1",
    availStel: -1,
    availLoc: 0,
    availRandom: 8,
    travelStel: -1,
    returnStel: 128,
    cargoType: 1000,
    cargoQty: -5,
    pickupMode: 0,
    dropoffMode: 1,
    payVal: 15000,
    shipCount: 1,
    shipSyst: 130,
    compGovt: "nova:136",
    canAbort: true,
    flags: 0x0100,
    flags2: 0x0001,
    availBits: "!(b511 | b515) & !b350",
    onSuccess: "b350 b6666",
    compText: "nova:9350",
});

// Modeled on stock m129 "Visit Vell-os Homeworld; Vellos2" (the S781 in
// onRefuse is recorded by the test context, not started).
export const M129 = makeMission("nova:129", {
    name: "Visit Vell-os Homeworld; Vellos2",
    availStel: 128,
    availLoc: 3,
    availRandom: 40,
    travelStel: 408,
    returnStel: 128,
    pickupMode: 1,
    dropoffMode: 1,
    payVal: 15000,
    compGovt: "nova:136",
    compReward: 5,
    availBits: "!(b511 | b515) & ((b350 & !b6666) & !(b351 | b4444))",
    onAccept: "b511",
    onRefuse: "b4444 S781",
    refuseText: "nova:20351",
});

export const DEADLINE_MISSION = makeMission("nova:500", {
    timeLimit: 5,
    returnStel: 128,
    compGovt: "nova:128",
    compReward: 10,
    onFailure: "!b900",
    failText: "nova:9900",
});

export const AUTO_ABORT_MISSION = makeMission("nova:501", {
    flags: 0x0001,
    flags2: 0x0002,
    payVal: 5000,
    datePostInc: 3,
    canAbort: true,
    onAbort: "^b900",
});

export const PENALTY_ABORT_MISSION = makeMission("nova:502", {
    flags: 0x0040 | 0x0008,
    compGovt: "nova:128",
    compReward: 100,
    canAbort: true,
});

export const UNABORTABLE_MISSION = makeMission("nova:503", { canAbort: false });
export const UNREFUSABLE_MISSION = makeMission("nova:504",
    { flags: 0x0004, onRefuse: "b4444" });

// m133-style bounty: no travel, no return, destroy-the-ships goal.
export const BOUNTY_MISSION = makeMission("nova:505", {
    shipCount: 2,
    shipGoal: 0,
    onShipDone: "b700",
});

// m135-style rush delivery: random Federation destination, cargo dropped on
// arrival there (which is also mission end, ReturnStel -1).
export const FERRY_MISSION = makeMission("nova:506", {
    travelStel: 10000,
    returnStel: -1,
    cargoType: 1000,
    cargoQty: -10,
    pickupMode: 0,
    dropoffMode: 0,
});

export const MISSIONS = new Map<string, MissionData>([
    [M128.id, M128],
    [M129.id, M129],
    [DEADLINE_MISSION.id, DEADLINE_MISSION],
    [AUTO_ABORT_MISSION.id, AUTO_ABORT_MISSION],
    [PENALTY_ABORT_MISSION.id, PENALTY_ABORT_MISSION],
    [UNABORTABLE_MISSION.id, UNABORTABLE_MISSION],
    [UNREFUSABLE_MISSION.id, UNREFUSABLE_MISSION],
    [BOUNTY_MISSION.id, BOUNTY_MISSION],
    [FERRY_MISSION.id, FERRY_MISSION],
]);

export function makePlayerState(seed = 42): PlayerState {
    return {
        version: 1,
        playerName: "Tester",
        nickName: "T",
        gender: "male",
        credits: 25000,
        date: { day: 23, month: 6, year: 1177 },
        bits: new Uint8Array(10000),
        exploredSystems: ["nova:300"],
        landedSystems: [],
        legalRecord: {},
        dominatedStellars: [],
        destroyedStellars: [],
        combatRating: 0,
        activeRanks: [],
        lastActivatedRank: null,
        activeMissions: [],
        completedMissions: [],
        failedMissions: [],
        availRandomRolls: {},
        rngSeed: seed,
        currentSystem: "nova:300",
        lastStellar: "nova:130",
        shipSnapshot: null,
        cronStates: {},
        pers: {},
        cargo: [],
        fleet: { escorts: [], nextId: 0 },
    };
}

// Env over the fixtures; the returned setOps records set-expression calls
// and warnings collects env warnings.
export function makeTestEnv(): { env: MissionEnv, setOps: string[], warnings: string[] } {
    const setOps: string[] = [];
    const warnings: string[] = [];
    const env: MissionEnv = {
        prefix: "nova",
        missionByRawId: rawId => MISSIONS.get(globalId("nova", rawId)) ?? null,
        planet: id => PLANETS.get(id) ?? null,
        planetByRawId: rawId => PLANETS.get(globalId("nova", rawId)) ?? null,
        system: id => SYSTEMS.get(id) ?? null,
        systemByRawId: rawId => SYSTEMS.get(globalId("nova", rawId)) ?? null,
        systemOfPlanet: id => {
            for (const [systemId, system] of SYSTEMS) {
                if (system.planets.includes(id)) {
                    return systemId;
                }
            }
            return null;
        },
        government: id => (id === null ? null : GOVERNMENTS.get(id) ?? null),
        govtByRawId: rawId => GOVERNMENTS.get(globalId("nova", rawId)) ?? null,
        rank: id => RANKS.get(id) ?? null,
        allPlanetIds: () => [...PLANETS.keys()],
        allMissionIds: () => [...MISSIONS.keys()],
        allGovernments: () => [...GOVERNMENTS.values()],
        cronById: id => CRONS.get(id) ?? null,
        allCronIds: () => [...CRONS.keys()],
        makeSetContext: state => {
            const ctx: SetContext = {
                bits: new ControlBits(state.bits),
                abortMission: rawId => setOps.push(`A${rawId}`),
                failMission: rawId => setOps.push(`F${rawId}`),
                startMission: rawId => setOps.push(`S${rawId}`),
                grantOutfit: (rawId, delta) => setOps.push(`${delta > 0 ? "G" : "D"}${rawId}`),
                movePlayer: () => setOps.push("M"),
                changeShip: () => setOps.push("C"),
                activateRank: rawId => setOps.push(`K${rawId}`),
                deactivateRank: rawId => setOps.push(`L${rawId}`),
                playSound: rawId => setOps.push(`P${rawId}`),
                destroyStellar: rawId => setOps.push(`Y${rawId}`),
                regenerateStellar: rawId => setOps.push(`U${rawId}`),
                leaveStellar: rawId => setOps.push(`Q${rawId}`),
            };
            return { ctx, takeEffects: () => [] };
        },
        warn: message => warnings.push(message),
    };
    return { env, setOps, warnings };
}

export function setBit(state: PlayerState, bit: number, value = true): void {
    new ControlBits(state.bits).set(bit, value);
}

export function isBitSet(state: PlayerState, bit: number): boolean {
    return new ControlBits(state.bits).get(bit);
}

export function offerCtx(state: PlayerState, env: MissionEnv, planet: PlanetData,
    systemId: string, location: OfferLocation = "bbs",
    overrides: Partial<OfferContext> = {}): OfferContext {
    return {
        landedStellar: planet,
        landedStellarId: planet.id,
        systemId,
        location,
        playerState: state,
        shipData: null,
        shipContribute: [0, 0],
        shipInherentAI: null,
        fuel: null,
        freeCargoTons: null,
        ownedOutfits: {},
        outfitContributes: [],
        government: id => env.government(id),
        govtByRawId: rawId => env.govtByRawId(rawId),
        system: id => env.system(id),
        ...overrides,
    };
}
