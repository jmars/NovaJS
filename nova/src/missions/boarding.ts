// Boarding resolution (P5 of the ship-interaction layer): what the player
// gets when they board a disabled ship — the düde's Booty (money and
// commodities), a përs's carried Credits, and the boarding government's
// legal penalty — as pure state transitions over the PlayerState.
//
// Pure TypeScript — no PIXI/ECS — so the resolver stays headless testable;
// mission_ship_plugin.ts is the ECS glue (its MissionShipBoardedSystem
// listens for BoardedEvent, runs this resolver, and does the mïsn goal
// bookkeeping for board/rescue ships).
//
// What is deliberately NOT here: capture. The capture odds and marine
// crews (Bible ModType 25) live in missions/capture.ts — it consumes the
// tail of this file's seeded stream, drawn last so loot rolls never shift —
// and the ECS conversion of a captured ship into an escort lives in the
// MissionShipBoardedSystem glue (an escort model exists as of Phase 3).
//
// Booty semantics (EV Nova Bible, düde Booty flags):
//   0x0001 food  0x0002 industrial  0x0004 medical  0x0008 luxury
//   0x0010 metal 0x0020 equipment   0x0040 money ("amount depends on the
//                                   ship's purchase price")
//   all clear    → the player is "repelled while attempting to board".
// Flagged approximations (stock formulas undocumented):
//   - money: a seeded 10-25% band of the ship class's purchase price;
//   - commodity quantity: a seeded 1..MAX_BOOTY_TONS band per set bit.
// Commodity plunder is reported as MissionEffect 'cargo' entries (the same
// signed effect the mission FSM emits); the boarding system applies them
// into the player's real hold (PlayerState.cargo, player/cargo.ts),
// take-what-fits against the ship's free tons.

import { DudeData } from "novadatainterface/DudeData";
import { MissionData } from "novadatainterface/MissionData";
import { PersData } from "novadatainterface/PersData";
import { ShipData } from "novadatainterface/ShipData";
import { ActiveMissionCargo, PlayerState } from "../player/player_state";
import { changeRecord, LegalEnv } from "../player/legal_status";
import { makeRng } from "../player/pilot_files";
import { MissionEffect } from "./mission_state_machine";


// The düde-derived facts the resolver needs. DudeData satisfies this
// structurally, and so does the plugin-side BoardingProfileComponent
// (nova_plugin/dude.ts) that the ECS glue reads off the boarded ship.
export type BoardingDude = Pick<DudeData, "booty" | "govt">;

// Booty 0x0040: money, drawn as this band of the ship's purchase price.
export const BOOTY_MONEY = 0x0040;
export const BOOTY_MONEY_MIN_FRACTION = 0.10;
export const BOOTY_MONEY_MAX_FRACTION = 0.25;

// Booty 0x0001-0x0020: one commodity per bit, indexed in the mission cargo
// id space (0-5, the same ids rollCargo and the MissionEffect 'cargo'
// entries use). Each set bit plunders this many tons at most.
export const BOOTY_COMMODITY_BITS = [0x0001, 0x0002, 0x0004, 0x0008, 0x0010,
    0x0020] as const;
export const MAX_BOOTY_TONS = 10;

// Përs Credits ride this far around their face value (Bible: "+/- 25%").
export const PERS_CREDITS_VARIANCE = 0.25;


// One boarding's loot rolls, seeded by the pilot, the boarded ship class and
// the game date — the same determinism rule as the mission spawn rolls: the
// same board under the same state replays identically across reloads and
// peers. Never Math.random.
export function boardSeed(state: PlayerState, targetShipRawId: number): number {
    const { day, month, year } = state.date;
    const dayCount = year * 365 + month * 40 + day;
    return (state.rngSeed + targetShipRawId * 0x9E37
        + dayCount * 0x85EB) >>> 0;
}

export function boardRng(state: PlayerState, targetShipRawId: number):
    () => number {
    return makeRng(boardSeed(state, targetShipRawId));
}

export interface BoardingResult {
    // "repelled": the düde's Booty was 0 and the përs carries no credits —
    // the player is told they were repelled and gains nothing.
    outcome: "plundered" | "repelled";
    // The raw düde Booty mask that was resolved (0 when repelled).
    bootyType: number;
    // Every applied change as MissionEffects: 'pay' for credits, 'cargo'
    // for commodity plunder (the caller loads what fits into the player's
    // hold), 'record' for the govt boarding penalty and its propagation.
    // The caller logs these and queues the player-state save.
    effects: MissionEffect[];
    // Total credits applied (booty money + përs credits), when any.
    creditsDelta?: number;
    // The plundered commodities, when any — a mirror of the 'cargo' effects
    // for callers that want the rolls themselves (the hold update happens
    // through the effects; see the file header).
    cargo?: ActiveMissionCargo[];
}

/**
 * Resolves one boarding: applies the plunder to the PlayerState (credits,
 * legal record) and reports it as effects. Draw order is fixed — booty
 * money, commodity bits ascending, përs credits — so a given rng stream
 * resolves identically every time.
 *
 * `mission` is non-null when the boarded ship is the goal ship of one of the
 * player's active board/rescue missions: boarding it is the mission, not
 * piracy, so the government's BoardPenalty does not apply (interpretation —
 * the Bible defines the penalty only as "evilness from pirating"; a mission
 * that orders the boarding must not brand the player a pirate for it).
 */
export function resolveBoard(state: PlayerState, mission: MissionData | null,
    shipData: ShipData, dude: BoardingDude | null, pers: PersData | null,
    env: LegalEnv, rng: () => number): BoardingResult {
    const booty = dude?.booty ?? 0;
    const effects: MissionEffect[] = [];
    const cargo: ActiveMissionCargo[] = [];
    let creditsDelta = 0;

    // Booty 0x0040: money, 10-25% of the ship's purchase price (flagged
    // approximation — see the file header).
    if ((booty & BOOTY_MONEY) !== 0) {
        const amount = Math.floor(shipData.price
            * (BOOTY_MONEY_MIN_FRACTION
                + (BOOTY_MONEY_MAX_FRACTION - BOOTY_MONEY_MIN_FRACTION)
                * rng()));
        if (amount > 0) {
            state.credits += amount;
            creditsDelta += amount;
            effects.push({ kind: "pay", amount });
        }
    }

    // Booty 0x0001-0x0020: one commodity per set bit (quantity band also
    // flagged). Reported as 'cargo' effects; the boarding system loads
    // what fits into the player's hold.
    for (let type = 0; type < BOOTY_COMMODITY_BITS.length; type++) {
        if ((booty & BOOTY_COMMODITY_BITS[type]) === 0) {
            continue;
        }
        const qty = 1 + Math.floor(rng() * MAX_BOOTY_TONS);
        cargo.push({ type, qty });
        effects.push({ kind: "cargo", type, qty });
    }

    // Përs Credits: the person's own money, +/- 25% (Bible). A përs yields
    // this even though its ship spawned düde-less (Booty 0).
    if (pers !== null && pers.credits > 0) {
        const amount = Math.round(pers.credits
            * (1 - PERS_CREDITS_VARIANCE
                + 2 * PERS_CREDITS_VARIANCE * rng()));
        if (amount > 0) {
            state.credits += amount;
            creditsDelta += amount;
            effects.push({ kind: "pay", amount });
        }
    }

    const repelled = booty === 0 && (pers === null || pers.credits <= 0);

    // BoardPenalty: evilness from pirating one of the govt's ships — a
    // crime, so it lands as a negative record change with the usual
    // propagation (legal_status.changeRecord). A përs's own government
    // counts when the ship itself spawned independent. The penalty tracks
    // the piracy, not the attempt: a repelled board took nothing and is not
    // penalized (so a repelled board applies no effects at all).
    const govtId = dude?.govt ?? pers?.govt ?? null;
    const penalty = govtId === null ? 0
        : env.government(govtId)?.penalties.board ?? 0;
    if (!repelled && govtId !== null && penalty > 0 && mission === null) {
        for (const change of changeRecord(state, govtId, -penalty, env)) {
            effects.push({ kind: "record", govt: change.govt, delta: change.delta });
        }
    }

    const result: BoardingResult = {
        outcome: repelled ? "repelled" : "plundered",
        bootyType: booty,
        effects,
    };
    if (creditsDelta > 0) {
        result.creditsDelta = creditsDelta;
    }
    if (cargo.length > 0) {
        result.cargo = cargo;
    }
    return result;
}
