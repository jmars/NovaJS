// Pilot save files: PlayerState <-> versioned JSON (v1), and new-pilot
// creation from a chär resource. The JSON form is what is served by the
// /playerState/:uuid routes, mirrored to localStorage, and written to disk.

import * as t from "io-ts";
import { isLeft } from "fp-ts/Either";
import { PathReporter } from "io-ts/lib/PathReporter";
import { CharData } from "novadatainterface/CharData";
import { SetContext, executeSet } from "novadatainterface/expressions";
import { EncodedEntity } from "nova_ecs/plugins/serializer_plugin";
import { NovaDate } from "./date";
import {
    ActiveMission,
    AuxShipProgress,
    ControlBits,
    CronState,
    FleetState,
    NUM_CONTROL_BITS,
    PersProgress,
    PlayerState,
    SpecialShipProgress,
} from "./player_state";
import { CargoEntry } from "./cargo";
import { normalizeEscortOrder } from "./escort_ops";


const NovaDateCodec = t.type({
    day: t.number,
    month: t.number,
    year: t.number,
});

// Control bits as a base64 string in JSON; a Uint8Array in memory.
const Base64BitsCodec = new t.Type<Uint8Array, string, unknown>(
    "Base64Bits",
    (u): u is Uint8Array => u instanceof Uint8Array,
    (input, context) => {
        if (typeof input !== "string") {
            return t.failure(input, context, "expected a base64 string of control bits");
        }
        try {
            return t.success(ControlBits.fromBase64(input).bytes);
        }
        catch (e) {
            return t.failure(input, context, String(e));
        }
    },
    (bytes) => new ControlBits(bytes).toBase64(),
);

const SpecialShipsCodec = t.intersection([
    t.type({
        remaining: t.number,
        killed: t.number,
        boarded: t.number,
        disabled: t.number,
        jumpedIn: t.number,
        jumpedOut: t.number,
        initial: t.number,
    }),
    t.partial({
        pinnedTypes: t.array(t.union([t.string, t.null])),
    }),
]);

const AuxShipsCodec = t.type({
    remaining: t.number,
    jumpedIn: t.number,
});

// Per-crön lifecycle progress (cron_scheduler.ts); {} for pilots that
// predate cröns.
const CronStateCodec = t.type({
    stage: t.union([
        t.literal("preHoldoff"),
        t.literal("active"),
        t.literal("postHoldoff"),
    ]),
    endDate: NovaDateCodec,
});

// Per-përs persistence (pers_plugin.ts).
const PersStateCodec = t.type({
    status: t.union([
        t.literal("alive"),
        t.literal("dead"),
        t.literal("deactivated"),
    ]),
    grudge: t.boolean,
    quoteShown: t.boolean,
});

// One hold entry (player/cargo.ts).
const CargoEntryCodec = t.type({
    type: t.number,
    qty: t.number,
});

// One escort-fleet ship (nova_plugin/escort_plugin.ts). `orders` is
// optional so files written before escort orders existed still load;
// playerStateFromFile normalizes it to 'follow' (player/escort_ops.ts).
const EscortStateCodec = t.intersection([
    t.type({
        id: t.string,
        shipType: t.string,
    }),
    t.partial({
        orders: t.union([
            t.literal("follow"),
            t.literal("hold"),
        ]),
    }),
]);

const FleetStateCodec = t.type({
    escorts: t.array(EscortStateCodec),
    nextId: t.number,
});

const ActiveMissionCodec = t.type({
    missionId: t.string,
    originStellar: t.string,
    travelStellar: t.union([t.string, t.null]),
    returnStellar: t.union([t.string, t.null]),
    travelComplete: t.boolean,
    shipGoalComplete: t.boolean,
    failed: t.boolean,
    cargoLoaded: t.boolean,
    cargo: t.union([t.type({ type: t.number, qty: t.number }), t.null]),
    deadline: t.union([NovaDateCodec, t.null]),
    specialShips: t.union([SpecialShipsCodec, t.null]),
    auxShips: t.union([AuxShipsCodec, t.null]),
});

// v1 pilot file schema. Decodes to a PlayerState; encode() produces the
// JSON-ready object (bits as base64). Unknown versions are rejected so
// future migrations can be added explicitly.
export const PlayerStateFile = t.type({
    version: t.literal(1),
    playerName: t.string,
    nickName: t.string,
    gender: t.union([t.literal("male"), t.literal("female")]),
    credits: t.number,
    date: NovaDateCodec,
    bits: Base64BitsCodec,
    exploredSystems: t.array(t.string),
    landedSystems: t.array(t.string),
    legalRecord: t.record(t.string, t.number),
    dominatedStellars: t.array(t.string),
    destroyedStellars: t.array(t.string),
    combatRating: t.number,
    activeRanks: t.array(t.string),
    lastActivatedRank: t.union([t.string, t.null]),
    activeMissions: t.array(ActiveMissionCodec),
    completedMissions: t.array(t.string),
    failedMissions: t.array(t.string),
    availRandomRolls: t.record(t.string, t.number),
    rngSeed: t.number,
    currentSystem: t.string,
    lastStellar: t.union([t.string, t.null]),
    shipSnapshot: t.union([EncodedEntity, t.null]),
    // Optional on input so v1 files written before cröns existed still load;
    // deserializePlayerState normalizes a missing entry to {}.
    cronStates: t.union([t.record(t.string, CronStateCodec), t.undefined, t.null]),
    // Same deal for përs persistence.
    pers: t.union([t.record(t.string, PersStateCodec), t.undefined, t.null]),
    // Same deal for the cargo hold (player/cargo.ts).
    cargo: t.union([t.array(CargoEntryCodec), t.undefined, t.null]),
    // Same deal for the escort fleet (nova_plugin/escort_plugin.ts).
    fleet: t.union([FleetStateCodec, t.undefined, t.null]),
});

// The JSON-file form of a PlayerState (bits as a base64 string).
export type PlayerStateFileJSON = t.OutputOf<typeof PlayerStateFile>;


// A decoded (or hand-built) file as a PlayerState; normalizes the optional
// crön and përs records, the cargo hold and the escort fleet so
// pre-crön/pre-përs/pre-cargo/pre-fleet pilot files load as empty
// {} / [] / {escorts: [], nextId: 0}. Escort orders default to 'follow'.
export function playerStateFromFile(file: t.TypeOf<typeof PlayerStateFile>): PlayerState {
    const cronStates: Record<string, CronState> = file.cronStates ?? {};
    const pers: Record<string, PersProgress> = file.pers ?? {};
    const cargo: CargoEntry[] = file.cargo ?? [];
    const fleet: FleetState = file.fleet
        ? {
            escorts: file.fleet.escorts.map(escort => ({
                ...escort,
                orders: normalizeEscortOrder(escort.orders),
            })),
            nextId: file.fleet.nextId,
        }
        : { escorts: [], nextId: 0 };
    return { ...file, cronStates, pers, cargo, fleet };
}

// Validates a parsed pilot file and returns the state. Throws an Error
// describing the first problems when the file does not match the schema.
export function deserializePlayerState(file: unknown): PlayerState {
    const decoded = PlayerStateFile.decode(file);
    if (isLeft(decoded)) {
        throw new Error("Invalid pilot file: "
            + PathReporter.report(decoded).join("; "));
    }
    return playerStateFromFile(decoded.right);
}

// Converts a state into its versioned JSON-file form (not yet stringified).
export function serializePlayerState(state: PlayerState): PlayerStateFileJSON {
    return PlayerStateFile.encode(state);
}

// Stock data has exactly one chär (the ".Trader" starting character).
export const DEFAULT_CHAR_ID = "nova:128";

// Nova Bible: when a chär has no usable start systems, the player starts in
// system 128.
const FALLBACK_START_SYSTEM = "nova:128";

// Small deterministic PRNG (mulberry32) so pilot creation - and later the
// random destination / availRandomRolls re-rolls - can be replayed from a
// PlayerState's rngSeed. Returns numbers in [0, 1).
export function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return function() {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pickStartSystem(charData: CharData, rng: () => number): string {
    const options = charData.startSystems.filter((id): id is string => id !== null);
    if (options.length === 0) {
        return FALLBACK_START_SYSTEM;
    }
    return options[Math.floor(rng() * options.length)];
}

// Set-expression side effects that need the mission FSM or the id space
// (ranks, ships, missions) are not available at pilot creation; they warn
// and do nothing until P4+ wires them up.
function unsupported(op: string): (rawId: number) => void {
    return function(rawId: number) {
        console.warn(`createNewPilot: set-expression ${op}(${rawId}) is not supported yet; ignored`);
    };
}

/**
 * Creates a new pilot from a chär: start cash, starting kills, the game's
 * start date, a random start system (seeded), initial legal records from the
 * Govt1-4/Status1-4 pairs, and the chär's OnStart set-expression. The
 * starting ship is `charData.startShipType`; pass `shipSnapshot` once the
 * ship entity has been built to store it with the pilot.
 */
export function createNewPilot(charData: CharData, rngSeed: number,
    shipSnapshot: EncodedEntity | null = null): PlayerState {

    const state: PlayerState = {
        version: 1,
        playerName: "",
        nickName: "",
        gender: "male",
        credits: charData.startCash,
        date: { ...charData.startDate },
        bits: new Uint8Array(NUM_CONTROL_BITS),
        exploredSystems: [],
        landedSystems: [],
        legalRecord: {},
        dominatedStellars: [],
        destroyedStellars: [],
        combatRating: charData.startKills,
        activeRanks: [],
        lastActivatedRank: null,
        activeMissions: [],
        completedMissions: [],
        failedMissions: [],
        availRandomRolls: {},
        rngSeed,
        currentSystem: pickStartSystem(charData, makeRng(rngSeed)),
        lastStellar: null,
        shipSnapshot,
        cronStates: {},
        pers: {},
        cargo: [],
        fleet: { escorts: [], nextId: 0 },
    };
    state.exploredSystems.push(state.currentSystem);

    // Govt1-4/Status1-4: the raw status is stored per government; enemies of
    // those governments get the negated status at lookup time (P4, which has
    // the govt graph).
    for (let i = 0; i < charData.startGovts.length; i++) {
        const govt = charData.startGovts[i];
        const status = charData.startStatus[i];
        if (govt !== null && status !== undefined) {
            state.legalRecord[govt] = status;
        }
    }

    // The chär's OnStart sets up storyline bits (e.g. "b0 b1").
    const setContext: SetContext = {
        bits: new ControlBits(state.bits),
        abortMission: unsupported("abortMission"),
        failMission: unsupported("failMission"),
        startMission: unsupported("startMission"),
        grantOutfit: unsupported("grantOutfit"),
        movePlayer: unsupported("movePlayer"),
        changeShip: unsupported("changeShip"),
        activateRank: unsupported("activateRank"),
        deactivateRank: unsupported("deactivateRank"),
        playSound: unsupported("playSound"),
        destroyStellar: unsupported("destroyStellar"),
        regenerateStellar: unsupported("regenerateStellar"),
        leaveStellar: unsupported("leaveStellar"),
    };
    // A separate stream from the start-system pick so OnStart's R() draws
    // don't shift where the pilot starts.
    executeSet(charData.onStart, setContext, makeRng(rngSeed ^ 0x9E3779B9));

    return state;
}
