// Mission availability evaluator: the eleven checks (EV Nova Bible
// "Avail* fields" plus the simultaneous-mission cap) that decide whether a
// mission is offered at a given landing/location. Pure TypeScript — no
// PIXI/ECS — so it is headless testable; the caller (spaceport UI, mission
// plugin) assembles the OfferContext from engine state.
//
// All eleven rules are evaluated and every failure is reported in `reasons`
// (rather than short-circuiting) so the offer list is debuggable.

import { GovernmentData } from "novadatainterface/GovernmentData";
import { MissionData } from "novadatainterface/MissionData";
import { PlanetData } from "novadatainterface/PlanetData";
import { ShipData } from "novadatainterface/ShipData";
import { SystemData } from "novadatainterface/SystemData";
import { evaluateTest, parseTest, TestContext } from "novadatainterface/expressions";
import { ControlBits, MAX_ACTIVE_MISSIONS, PlayerState } from "../player/player_state";
import { rawIdOf } from "./stellar_filter";
import {
    decodeStellarFilter,
    planetMatchesStellarFilter,
    StellarMatchContext,
} from "./stellar_filter";

// mïsn AvailLoc codes.
export type OfferLocation =
    | "bbs" | "bar" | "ship" | "spaceport" | "trade" | "shipyard" | "outfit";

const LOCATION_CODES: Record<OfferLocation, number> = {
    bbs: 0,
    bar: 1,
    ship: 2,
    spaceport: 3,
    trade: 4,
    shipyard: 5,
    outfit: 6,
};

export interface OfferContext {
    // Where the offer would be made.
    landedStellar: PlanetData | null;
    landedStellarId: string | null;
    systemId: string;
    location: OfferLocation;
    playerState: PlayerState;

    // Ship-derived facts. The shïp fields for inherent AI and Contribute are
    // not parsed yet (P1 predates the mission system), so null/[0,0] means
    // "unknown" and rules 8-9 pass — the plugin supplies real values once
    // ShipParse grows the fields.
    shipData: ShipData | null;
    shipContribute: [number, number];
    shipInherentAI: number | null;
    fuel: number | null;          // unknown (null) passes rule 11
    freeCargoTons: number | null; // unknown (null) passes flags2 0x0001
    ownedOutfits: Record<number, number>;      // outfit raw id -> count
    outfitContributes: Array<[number, number]>; // Contribute masks of owned outfits
    // The active ranks' Contribute masks OR'd together (ranks.ts); unknown
    // (undefined) contributes nothing to rule 8.
    rankContributes?: [number, number];

    // Data lookups.
    government(govtId: string | null): GovernmentData | null;
    govtByRawId(rawId: number): GovernmentData | null;
    system(systemId: string): SystemData | null;
}

export interface AvailabilityResult {
    available: boolean;
    reasons: string[];
}

export function isAvailable(mission: MissionData, ctx: OfferContext): boolean {
    return checkAvailability(mission, ctx).available;
}

export function checkAvailability(mission: MissionData, ctx: OfferContext): AvailabilityResult {
    const reasons: string[] = [];
    const state = ctx.playerState;

    // 1. AvailStel matches the landed stellar (-1 requires inhabited).
    if (ctx.landedStellar === null || ctx.landedStellarId === null) {
        reasons.push("not landed");
    }
    else {
        const filter = decodeStellarFilter(mission.availStel, "availability");
        const matchCtx: StellarMatchContext = {
            systemId: ctx.systemId,
            system: ctx.system,
            government: ctx.government,
            govtByRawId: ctx.govtByRawId,
        };
        if (!planetMatchesStellarFilter(ctx.landedStellar, filter, matchCtx)) {
            reasons.push(`AvailStel ${mission.availStel} does not match ${ctx.landedStellarId}`);
        }
    }

    // 2. AvailLoc equals the offer location. Ship-location (2) offers come
    // from përs hailed in space (mission_bbs.computeShipOffers); the
    // trade/shipyard/outfit dialogs do not exist yet, so those locations
    // never offer for now.
    if (LOCATION_CODES[ctx.location] !== mission.availLoc) {
        reasons.push(`AvailLoc ${mission.availLoc} != offered at ${ctx.location}`);
    }
    if (mission.availLoc >= 4) {
        reasons.push(`AvailLoc ${mission.availLoc} not offered until its UI exists`);
    }

    // Bar offers additionally need a bar on the planet.
    if (ctx.location === "bar" && ctx.landedStellar !== null && !ctx.landedStellar.hasBar) {
        reasons.push("planet has no bar");
    }

    // 3. AvailRecord: 0 ignored; +n at least; -n at most; -32000 this stellar
    // dominated; -32001 any stellar dominated. The record is the landed
    // stellar's government's entry in legalRecord.
    if (mission.availRecord !== 0) {
        const govtId = ctx.landedStellar?.govt ?? null;
        const record = govtId === null ? 0 : (state.legalRecord[govtId] ?? 0);
        if (mission.availRecord === -32000) {
            if (ctx.landedStellarId === null
                || !state.dominatedStellars.includes(ctx.landedStellarId)) {
                reasons.push("AvailRecord -32000: stellar not dominated");
            }
        }
        else if (mission.availRecord === -32001) {
            if (state.dominatedStellars.length === 0) {
                reasons.push("AvailRecord -32001: no dominated stellars");
            }
        }
        else if (mission.availRecord > 0) {
            if (record < mission.availRecord) {
                reasons.push(`AvailRecord ${mission.availRecord}: record ${record}`);
            }
        }
        else if (record > -mission.availRecord) {
            reasons.push(`AvailRecord ${mission.availRecord}: record ${record}`);
        }
    }

    // 4. AvailRating <= combatRating (-1/0 ignored).
    if (mission.availRating > 0 && state.combatRating < mission.availRating) {
        reasons.push(`AvailRating ${mission.availRating} > kills ${state.combatRating}`);
    }

    // 5. AvailRandom: 100 always offers; otherwise the per-mission roll
    // (re-rolled seeded on every warp-in and kept in PlayerState so reloads
    // and multiplayer peers agree) must be under the percentage.
    if (mission.availRandom < 100) {
        const roll = state.availRandomRolls[mission.id];
        if (roll === undefined) {
            reasons.push("AvailRandom: no roll for this warp-in");
        }
        else if (roll >= mission.availRandom) {
            reasons.push(`AvailRandom ${mission.availRandom}: rolled ${roll}`);
        }
    }

    // 6. AvailBits test expression must hold.
    const testCtx: TestContext = {
        bits: new ControlBits(state.bits),
        gender: state.gender === "male" ? 1 : 0,
        hasOutfit: rawId => (ctx.ownedOutfits[rawId] ?? 0) > 0,
        exploredSystem: rawId => state.exploredSystems.some(id => rawIdOf(id) === rawId),
    };
    if (!evaluateTest(parseTest(mission.availBits), testCtx)) {
        reasons.push(`AvailBits false (${mission.availBits})`);
    }

    // 7. AvailShipType: 0/-1 (or anything under 128) passes; 128+ must be
    // the ship flown; 1128+ must not; 2128+ is the government-variant band.
    // Variant groups are not modeled yet (shïp inherent govt unparsed), so
    // that band requires exactly the named type for now.
    const shipRaw = ctx.shipData === null ? NaN : rawIdOf(ctx.shipData.id);
    const shipType = mission.availShipType;
    if (shipType >= 128 && shipType < 1128 && shipRaw !== shipType) {
        reasons.push(`AvailShipType: must be flying ${shipType}`);
    }
    else if (shipType >= 1128 && shipType < 2128 && shipRaw === shipType - 1000) {
        reasons.push(`AvailShipType: must not be flying ${shipType - 1000}`);
    }
    else if (shipType >= 2128 && shipType < 3256 && shipRaw !== shipType - 2000) {
        reasons.push(`AvailShipType: must be flying ${shipType - 2000} (or a govt variant)`);
    }

    // 8. Every set Require bit must be contributed by the ship, an outfit,
    // or an active rank.
    const contributeWords = [ctx.shipContribute, ...ctx.outfitContributes];
    if (ctx.rankContributes) {
        contributeWords.push(ctx.rankContributes);
    }
    for (let word = 0; word < 2; word++) {
        const required = mission.require[word];
        for (let bit = 0; bit < 32; bit++) {
            if ((required & (1 << bit)) === 0) {
                continue;
            }
            const covered = contributeWords.some(
                mask => (mask[word] & (1 << bit)) !== 0);
            if (!covered) {
                reasons.push(`Require bit ${word * 32 + bit} not contributed`);
                bit = 32; // one reason per word is enough
            }
        }
    }

    // 9. Flags 0x2000/0x4000 exclude cargo ships (inherent AI 1-2) and
    // warships (3-4). Unknown AI passes until shïp parsing catches up.
    if (ctx.shipInherentAI !== null) {
        if ((mission.flags & 0x2000) !== 0
            && (ctx.shipInherentAI === 1 || ctx.shipInherentAI === 2)) {
            reasons.push("flag 0x2000: no cargo ships");
        }
        if ((mission.flags & 0x4000) !== 0
            && (ctx.shipInherentAI === 3 || ctx.shipInherentAI === 4)) {
            reasons.push("flag 0x4000: no warships");
        }
    }

    // 10. Not already active, not done before, and under the cap of 16.
    if (state.activeMissions.some(m => m.missionId === mission.id)) {
        reasons.push("already active");
    }
    if (state.completedMissions.includes(mission.id)) {
        reasons.push("already completed");
    }
    if (state.failedMissions.includes(mission.id)) {
        reasons.push("previously failed");
    }
    if (state.activeMissions.length >= MAX_ACTIVE_MISSIONS) {
        reasons.push(`${MAX_ACTIVE_MISSIONS}-mission cap reached`);
    }

    // 11. Flag 0x0008 needs 100 fuel at offer time.
    if ((mission.flags & 0x0008) !== 0 && ctx.fuel !== null && ctx.fuel < 100) {
        reasons.push(`flag 0x0008: needs 100 fuel (has ${ctx.fuel})`);
    }

    // flags2 0x0001 blocks offering without free cargo space (unknown passes).
    if ((mission.flags2 & 0x0001) !== 0 && ctx.freeCargoTons !== null
        && ctx.freeCargoTons <= 0) {
        reasons.push("flags2 0x0001: no free cargo space");
    }

    return { available: reasons.length === 0, reasons };
}
