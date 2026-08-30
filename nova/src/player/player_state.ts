// The player's persistent state (the saved-pilot file contents). Created from
// a chär by `createNewPilot` (pilot_files.ts) and threaded through the ECS as
// the PlayerStateResource so it survives per-system world swaps.

import { EncodedEntity } from "nova_ecs/plugins/serializer_plugin";
import { NovaDate } from "./date";
import { CargoEntry } from "./cargo";
import { EscortOrder } from "./escort_ops";


export interface PlayerState {
    version: 1;
    playerName: string;
    nickName: string;
    gender: 'male' | 'female';
    credits: number;
    date: NovaDate;
    bits: Uint8Array;                              // 10,000 ncb's (base64 in JSON)
    exploredSystems: string[];                     // global system ids
    landedSystems: string[];
    legalRecord: Record<string, number>;           // gövt global id -> record
    dominatedStellars: string[];
    destroyedStellars: string[];
    combatRating: number;                          // kill count
    activeRanks: string[];                         // ränk global ids
    lastActivatedRank: string | null;              // <RRK> tag
    activeMissions: ActiveMission[];               // max 16 (Bible: Max Simultaneous Missions)
    completedMissions: string[];
    failedMissions: string[];
    dayCount: number;                              // jumps since game start (engine: decay runs every 250th)
    availRandomRolls: Record<string, number>;      // missionId -> 0..99 roll, re-rolled on warp-in
    rngSeed: number;                               // master seed for R()/dude rolls/random dests
    currentSystem: string;
    lastStellar: string | null;
    shipSnapshot: EncodedEntity | null;            // ship + outfits (OutfitsStateComponent) + cargo
    cronStates: Record<string, CronState>;         // crön global id -> lifecycle progress
    pers: Record<string, PersProgress>;            // përs global id -> persistence
    // The player's cargo hold. type 0-5 is a standard commodity (the
    // STR#4000 order), anything else a jünk raw id; qty is tons.
    cargo: CargoEntry[];
    // The player's escort fleet. This is the persistent model; the ship
    // entities are rebuilt per system world by nova_plugin/escort_plugin.ts.
    fleet: FleetState;
}

// One ship under the player's command (captured in phase 4 of
// cargo+capture; purchased escorts are future work). `id` is a fleet-local
// identifier minted from FleetState.nextId. `orders` is the persisted
// escort order (player/escort_ops.ts); a missing entry means `follow`
// (files written before orders existed).
export interface EscortState {
    id: string;
    shipType: string;
    orders?: EscortOrder;
}

export interface FleetState {
    escorts: EscortState[];
    nextId: number;
}

// Per-përs persistence (nova_plugin/pers_plugin.ts). A përs with no entry
// here has never been seen (alive). Dead and deactivated përs never
// respawn; grudge and quoteShown survive warp and reload.
export interface PersProgress {
    status: "alive" | "dead" | "deactivated";
    grudge: boolean;       // the përs was damaged by the player
    quoteShown: boolean;   // përs flag 0x0080: hail quote shown once
}

// Progress of one activated crön (nova/src/missions/cron_scheduler.ts). A
// crön with no entry here is inactive (eligible to activate again).
export interface CronState {
    stage: "preHoldoff" | "active" | "postHoldoff";
    // The date on which the stage ends and the next transition fires.
    endDate: NovaDate;
}

export interface ActiveMission {
    missionId: string;                             // global id, e.g. "nova:128"
    originStellar: string;                         // where accepted (ReturnStel -4 resolves here)
    travelStellar: string | null;                  // resolved at accept time
    returnStellar: string | null;                  // resolved at accept time
    travelComplete: boolean;
    shipGoalComplete: boolean;
    failed: boolean;
    cargoLoaded: boolean;
    // Cargo rolled at accept time (random type/qty resolved once, here, so
    // pickup and dropoff agree); null for missions without cargo.
    cargo: ActiveMissionCargo | null;
    deadline: NovaDate | null;
    specialShips: SpecialShipProgress | null;
    auxShips: AuxShipProgress | null;
}

export interface ActiveMissionCargo {
    type: number;                                  // commodity (jünk) raw id
    qty: number;                                   // tons
}

// Progress of a mission's special (goal) ships, tracked per ActiveMission.
export interface SpecialShipProgress {
    remaining: number;
    killed: number;
    boarded: number;
    disabled: number;
    jumpedIn: number;
    jumpedOut: number;
    initial: number;
    pinnedTypes?: Array<string | null>;            // flag 0x0800: roll once, keep
}

// Progress of a mission's auxiliary (non-goal) ships.
export interface AuxShipProgress {
    remaining: number;
    jumpedIn: number;
}


// EV Nova Bible: at most 16 missions may be active at once.
export const MAX_ACTIVE_MISSIONS = 16;

export const NUM_CONTROL_BITS = 10_000;

/**
 * Combat rating is the pilot's kill count (the pilot file's "kills"). One
 * ship destroyed by the player is one point; missions compare it against
 * their AvailRating (availability.ts rule 4) and STR# 138 names the tiers.
 * nova_plugin/combat_rating_plugin.ts calls this from the DeathEvent hook.
 */
export function recordKill(state: PlayerState): void {
    state.combatRating += 1;
}

/**
 * The player's Nova control bits (ncb's b0-b9999), one byte per bit.
 * Structurally satisfies the `ControlBits` interface from
 * novadatainterface/expressions, so it can back TestContext/SetContext.
 * The bytes are shared with `PlayerState.bits`: this class is a view, so
 * writing through it mutates the state (and vice versa).
 */
export class ControlBits {
    readonly bytes: Uint8Array;

    // Wraps (does not copy) the given bytes.
    constructor(bytes: Uint8Array = new Uint8Array(NUM_CONTROL_BITS)) {
        if (bytes.length !== NUM_CONTROL_BITS) {
            throw new Error(`Expected ${NUM_CONTROL_BITS} control-bit bytes, got ${bytes.length}`);
        }
        this.bytes = bytes;
    }

    get(bit: number): boolean {
        // Out-of-range reads (undefined) degrade to false.
        return this.bytes[bit] !== 0;
    }

    set(bit: number, value: boolean): void {
        if (bit < 0 || bit >= NUM_CONTROL_BITS) {
            console.warn(`Control bit b${bit} is out of range (b0-b${NUM_CONTROL_BITS - 1}); ignored`);
            return;
        }
        this.bytes[bit] = value ? 1 : 0;
    }

    // Toggles the bit and returns its new value.
    toggle(bit: number): boolean {
        this.set(bit, !this.get(bit));
        return this.get(bit);
    }

    copy(): ControlBits {
        return new ControlBits(this.bytes.slice());
    }

    toBase64(): string {
        if (typeof Buffer === "function") {
            return Buffer.from(this.bytes.buffer, this.bytes.byteOffset, this.bytes.length)
                .toString("base64");
        }
        // Browser: btoa needs a binary string; build it in chunks.
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < this.bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...this.bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    static fromBase64(base64: string): ControlBits {
        let bytes: Uint8Array;
        if (typeof Buffer === "function") {
            const buffer = Buffer.from(base64, "base64");
            bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);
        }
        else {
            const binary = atob(base64);
            bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
        }
        return new ControlBits(bytes);
    }
}
