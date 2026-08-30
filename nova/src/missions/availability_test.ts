// Availability truth table: one spec per Avail* filter band plus the
// player-state rules (already-active, completed/failed, 16-mission cap,
// fuel, cargo space). Shares its fixtures with mission_state_machine_test.

import "jasmine";
import { getDefaultMissionData, MissionData } from "novadatainterface/MissionData";
import { PlayerState } from "../player/player_state";
import { recordKill } from "../player/player_state";
import { checkAvailability, OfferContext, OfferLocation } from "./availability";
import { MissionEnv } from "./mission_state_machine";
import {
    ALLY_STATION,
    BARREN,
    EARTH,
    FAR_STATION,
    makePlayerState,
    makeTestEnv,
    START,
    SYSTEMS,
    VELLOS_WORLD,
} from "./test_fixtures";

function makeMission(id: string, overrides: Partial<MissionData> = {}): MissionData {
    return { ...getDefaultMissionData(), id, name: id, ...overrides };
}

// A maximally-permissive mission; each spec narrows one field.
function baseMission(id: string, overrides: Partial<MissionData> = {}): MissionData {
    return makeMission(id, { availStel: -1, availLoc: 0, availRandom: 100, ...overrides });
}

function ctxFor(state: PlayerState, env: MissionEnv, planet = START,
    systemId = "nova:300", location: OfferLocation = "bbs",
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

describe("mission availability", function() {
    let state: PlayerState;
    let env: MissionEnv;

    beforeEach(function() {
        state = makePlayerState();
        env = makeTestEnv().env;
    });

    it("rule 1: AvailStel -1 requires an inhabited planet", function() {
        const mission = baseMission("nova:600");
        expect(checkAvailability(mission, ctxFor(state, env, START)).available).toBeTrue();
        expect(checkAvailability(mission, ctxFor(state, env, BARREN, "nova:301")).available)
            .toBeFalse();
    });

    it("rule 1: AvailStel specific code matches by raw id", function() {
        const mission = makeMission("nova:601", { availStel: 128 }); // Earth
        expect(checkAvailability(mission, ctxFor(state, env, EARTH, "nova:302")).available)
            .toBeTrue();
        expect(checkAvailability(mission, ctxFor(state, env, START)).available).toBeFalse();
    });

    it("rule 1: AvailStel 5000-band matches in or adjacent to the system", function() {
        // 5173 = in/adjacent to system raw 301 (S1).
        const mission = makeMission("nova:602", { availStel: 5173 });
        // Landed on Barren Rock (in S1) and on Start One (S0 links S1): both
        // match. Far Station's system is unlinked: no.
        expect(checkAvailability(mission, ctxFor(state, env, BARREN, "nova:301")).available)
            .toBeTrue();
        expect(checkAvailability(mission, ctxFor(state, env, START, "nova:300")).available)
            .toBeTrue();
        expect(checkAvailability(mission,
            ctxFor(state, env, FAR_STATION, "nova:303")).available).toBeFalse();
    });

    it("rule 1: AvailStel govt bands", function() {
        // 10000 = Federation-owned planets.
        const owned = makeMission("nova:603", { availStel: 10000 });
        expect(checkAvailability(owned, ctxFor(state, env, EARTH, "nova:302")).available)
            .toBeTrue();
        expect(checkAvailability(owned, ctxFor(state, env, VELLOS_WORLD, "nova:302")).available)
            .toBeFalse();
        expect(checkAvailability(owned, ctxFor(state, env, BARREN, "nova:301")).available)
            .toBeFalse(); // null govt is not the Federation

        // 15001 = allies of the Federation (class 5 = the ally govt).
        const allies = makeMission("nova:604", { availStel: 15001 });
        expect(checkAvailability(allies, ctxFor(state, env, ALLY_STATION, "nova:301")).available)
            .toBeTrue();
        expect(checkAvailability(allies, ctxFor(state, env, EARTH, "nova:302")).available)
            .toBeFalse();

        // 20001 = anyone but the Federation.
        const others = makeMission("nova:605", { availStel: 20001 });
        expect(checkAvailability(others, ctxFor(state, env, EARTH, "nova:302")).available)
            .toBeFalse();
        expect(checkAvailability(others, ctxFor(state, env, VELLOS_WORLD, "nova:302")).available)
            .toBeTrue();
        expect(checkAvailability(others, ctxFor(state, env, BARREN, "nova:301")).available)
            .toBeTrue(); // independent counts as "not Federation"

        // 25001 = enemies of the Federation (Polaris, class 16).
        const enemies = makeMission("nova:606", { availStel: 25001 });
        expect(checkAvailability(enemies, ctxFor(state, env, FAR_STATION, "nova:303")).available)
            .toBeTrue();
        expect(checkAvailability(enemies, ctxFor(state, env, EARTH, "nova:302")).available)
            .toBeFalse();

        // 30001 = the Federation or its classmates (Vell-os shares class 1).
        const classmates = makeMission("nova:607", { availStel: 30001 });
        expect(checkAvailability(classmates, ctxFor(state, env, EARTH, "nova:302")).available)
            .toBeTrue();
        expect(checkAvailability(classmates, ctxFor(state, env, VELLOS_WORLD, "nova:302"))
            .available).toBeTrue();
        expect(checkAvailability(classmates,
            ctxFor(state, env, ALLY_STATION, "nova:301")).available).toBeFalse();

        // 31001 = neither the Federation nor its classmates.
        const strangers = makeMission("nova:608", { availStel: 31001 });
        expect(checkAvailability(strangers, ctxFor(state, env, VELLOS_WORLD, "nova:302"))
            .available).toBeFalse();
        expect(checkAvailability(strangers, ctxFor(state, env, ALLY_STATION, "nova:301"))
            .available).toBeTrue();
        expect(checkAvailability(strangers, ctxFor(state, env, FAR_STATION, "nova:303"))
            .available).toBeTrue();
    });

    it("rule 4: AvailRating boundaries against the combat rating (kill count)",
        function() {
            const mission = baseMission("nova:620", { availRating: 5 });
            // -1/0 ignore the rule entirely.
            expect(checkAvailability(
                baseMission("nova:621", { availRating: -1 }), ctxFor(state, env)).available)
                .toBeTrue();
            expect(checkAvailability(
                baseMission("nova:622", { availRating: 0 }), ctxFor(state, env)).available)
                .toBeTrue();
            // combatRating is the kill count: AvailRating n needs n kills,
            // one short fails, exactly n passes.
            expect(checkAvailability(mission, ctxFor(state, env)).available).toBeFalse();
            for (let i = 0; i < 5; i++) {
                recordKill(state);
            }
            expect(state.combatRating).toEqual(5);
            expect(checkAvailability(mission, ctxFor(state, env)).available).toBeTrue();
            recordKill(state);
            expect(checkAvailability(mission, ctxFor(state, env)).available).toBeTrue();
        });

    it("rule 8: rankContributes joins the ship's and outfits' contribute pool",
        function() {
            const mission = baseMission("nova:630", { require: [1 << 3, 1 << 5] });
            // No contributes at all: both bits missing.
            expect(checkAvailability(mission, ctxFor(state, env)).available).toBeFalse();
            expect(checkAvailability(mission, ctxFor(state, env)).reasons)
                .toContain("Require bit 3 not contributed");
            // The rank pool alone covers bits in both words.
            expect(checkAvailability(mission, ctxFor(state, env, START, "nova:300",
                "bbs", { rankContributes: [1 << 3, 1 << 5] })).available).toBeTrue();
            // Rank and outfit bits combine.
            expect(checkAvailability(mission, ctxFor(state, env, START, "nova:300",
                "bbs", {
                    rankContributes: [1 << 3, 0],
                    outfitContributes: [[0, 1 << 5]],
                })).available).toBeTrue();
            // A rank bit nobody required does not help.
            expect(checkAvailability(mission, ctxFor(state, env, START, "nova:300",
                "bbs", { rankContributes: [1 << 4, 0] })).available).toBeFalse();
        });

    it("rule 2: AvailLoc must equal the offer location", function() {
        const bbs = baseMission("nova:610");
        const bar = makeMission("nova:611", { availLoc: 1 });
        const spaceport = makeMission("nova:612", { availLoc: 3 });
        const shipPers = makeMission("nova:613", { availLoc: 2 });
        const trade = makeMission("nova:614", { availLoc: 4 });

        expect(checkAvailability(bbs, ctxFor(state, env, START, "nova:300", "bbs")).available)
            .toBeTrue();
        expect(checkAvailability(bbs, ctxFor(state, env, START, "nova:300", "bar")).available)
            .toBeFalse();

        // Bar offers need a bar on the planet.
        expect(checkAvailability(bar,
            ctxFor(state, env, START, "nova:300", "bar")).available).toBeTrue();
        expect(checkAvailability(bar,
            ctxFor(state, env, VELLOS_WORLD, "nova:302", "bar")).available).toBeFalse();

        expect(checkAvailability(spaceport,
            ctxFor(state, env, START, "nova:300", "spaceport")).available).toBeTrue();

        // Ship-location (pers) offers exist since the përs comm dialog (P4);
        // trade/shipyard/outfit dialogs still don't and are never offered.
        expect(checkAvailability(shipPers,
            ctxFor(state, env, START, "nova:300", "ship")).available).toBeTrue();
        expect(checkAvailability(shipPers,
            ctxFor(state, env, START, "nova:300", "bbs")).available).toBeFalse();
        expect(checkAvailability(trade,
            ctxFor(state, env, START, "nova:300", "trade")).available).toBeFalse();
    });

    it("rule 3: AvailRecord gates on the landed government's record", function() {
        const atLeast = makeMission("nova:620", { availRecord: 10 });
        const atMost = makeMission("nova:621", { availRecord: -5 });

        state.legalRecord["nova:128"] = 5;
        expect(checkAvailability(atLeast, ctxFor(state, env, START)).available).toBeFalse();
        state.legalRecord["nova:128"] = 10;
        expect(checkAvailability(atLeast, ctxFor(state, env, START)).available).toBeTrue();

        state.legalRecord["nova:128"] = -5;
        expect(checkAvailability(atMost, ctxFor(state, env, START)).available).toBeTrue();
        // Record 7 is over the -5 ceiling (|availRecord| = 5).
        state.legalRecord["nova:128"] = 7;
        expect(checkAvailability(atMost, ctxFor(state, env, START)).available).toBeFalse();

        // -32000: this stellar dominated; -32001: any dominated.
        const thisOne = makeMission("nova:622", { availRecord: -32000 });
        const anyOne = makeMission("nova:623", { availRecord: -32001 });
        expect(checkAvailability(thisOne, ctxFor(state, env, EARTH, "nova:302")).available)
            .toBeFalse();
        state.dominatedStellars.push("nova:302:0");
        expect(checkAvailability(thisOne,
            ctxFor(state, env, EARTH, "nova:302")).available).toBeFalse();
        state.dominatedStellars.push(EARTH.id);
        expect(checkAvailability(thisOne, ctxFor(state, env, EARTH, "nova:302")).available)
            .toBeTrue();
        expect(checkAvailability(anyOne, ctxFor(state, env, START)).available).toBeTrue();
    });

    it("rule 4: AvailRating caps by combat rating, ignoring -1/0", function() {
        expect(checkAvailability(baseMission("nova:630", { availRating: -1 }),
            ctxFor(state, env, START)).available).toBeTrue();
        const veteran = makeMission("nova:631", { availRating: 10 });
        expect(checkAvailability(veteran, ctxFor(state, env, START)).available).toBeFalse();
        state.combatRating = 10;
        expect(checkAvailability(veteran, ctxFor(state, env, START)).available).toBeTrue();
    });

    it("rule 5: AvailRandom uses the stored warp-in roll, 100 always", function() {
        const rare = makeMission("nova:640", { availRandom: 40 });
        expect(checkAvailability(rare, ctxFor(state, env, START)).available).toBeFalse();
        state.availRandomRolls["nova:640"] = 40; // roll must be UNDER
        expect(checkAvailability(rare, ctxFor(state, env, START)).available).toBeFalse();
        state.availRandomRolls["nova:640"] = 39;
        expect(checkAvailability(rare, ctxFor(state, env, START)).available).toBeTrue();

        const always = makeMission("nova:641", { availRandom: 100 });
        expect(checkAvailability(always, ctxFor(state, env, START)).available).toBeTrue();
    });

    it("rule 6: AvailBits test expressions gate the offer", function() {
        const gated = makeMission("nova:650", { availBits: "b350 & !b6666" });
        expect(checkAvailability(gated, ctxFor(state, env, START)).available).toBeFalse();
        state.bits[350] = 1;
        expect(checkAvailability(gated, ctxFor(state, env, START)).available).toBeTrue();
        state.bits[6666] = 1;
        expect(checkAvailability(gated, ctxFor(state, env, START)).available).toBeFalse();
    });

    it("rule 7: AvailShipType compares the flown ship", function() {
        const flying = { id: "nova:130", name: "Shuttle" } as any;
        const mustFly = makeMission("nova:660", { availShipType: 130 });
        expect(checkAvailability(mustFly,
            ctxFor(state, env, START, "nova:300", "bbs", { shipData: flying })).available)
            .toBeTrue();
        expect(checkAvailability(mustFly, ctxFor(state, env, START)).available).toBeFalse();

        const mustNot = makeMission("nova:661", { availShipType: 1130 });
        expect(checkAvailability(mustNot,
            ctxFor(state, env, START, "nova:300", "bbs", { shipData: flying })).available)
            .toBeFalse();
        expect(checkAvailability(mustNot, ctxFor(state, env, START)).available).toBeTrue();

        // 0/-1/127 pass for any ship; the govt-variant band falls back to an
        // exact match until shïp variants are modeled.
        const anyShip = makeMission("nova:662", { availShipType: 127 });
        expect(checkAvailability(anyShip, ctxFor(state, env, START)).available).toBeTrue();
        const govtVariant = makeMission("nova:663", { availShipType: 2130 });
        expect(checkAvailability(govtVariant,
            ctxFor(state, env, START, "nova:300", "bbs", { shipData: flying })).available)
            .toBeTrue();
    });

    it("rule 8: every Require bit needs ship or outfit Contribute", function() {
        const mission = makeMission("nova:670", { require: [0b1010, 0] });
        expect(checkAvailability(mission, ctxFor(state, env, START)).available).toBeFalse();
        const covered = ctxFor(state, env, START, "nova:300", "bbs", {
            shipContribute: [0b0010, 0],
            outfitContributes: [[0b1000, 0]],
        });
        expect(checkAvailability(mission, covered).available).toBeTrue();
        const partial = ctxFor(state, env, START, "nova:300", "bbs", {
            shipContribute: [0b0010, 0],
        });
        expect(checkAvailability(mission, partial).available).toBeFalse();
    });

    it("rule 9: flags 0x2000/0x4000 exclude cargo ships and warships", function() {
        const noCargo = makeMission("nova:680", { flags: 0x2000 });
        const noWar = makeMission("nova:681", { flags: 0x4000 });
        const trader = { shipInherentAI: 2 };
        const fighter = { shipInherentAI: 3 };
        const civilian = { shipInherentAI: 0 };

        expect(checkAvailability(noCargo,
            ctxFor(state, env, START, "nova:300", "bbs", trader)).available).toBeFalse();
        expect(checkAvailability(noCargo,
            ctxFor(state, env, START, "nova:300", "bbs", civilian)).available).toBeTrue();
        expect(checkAvailability(noWar,
            ctxFor(state, env, START, "nova:300", "bbs", fighter)).available).toBeFalse();
        expect(checkAvailability(noWar,
            ctxFor(state, env, START, "nova:300", "bbs", trader)).available).toBeTrue();
        // Unknown AI (not parsed yet) passes both.
        expect(checkAvailability(noCargo, ctxFor(state, env, START)).available).toBeTrue();
    });

    it("rule 10: no re-offers while active or done, and 16 active max", function() {
        const mission = baseMission("nova:690");
        state.completedMissions.push(mission.id);
        expect(checkAvailability(mission, ctxFor(state, env, START)).available).toBeFalse();

        const other = baseMission("nova:691");
        state.completedMissions.length = 0;
        state.failedMissions.push(other.id);
        expect(checkAvailability(other, ctxFor(state, env, START)).available).toBeFalse();

        for (let i = 0; i < 16; i++) {
            state.activeMissions.push({
                missionId: `nova:${2000 + i}`,
                originStellar: START.id,
                travelStellar: null,
                returnStellar: null,
                travelComplete: true,
                shipGoalComplete: false,
                failed: false,
                cargoLoaded: false,
                cargo: null,
                deadline: null,
                specialShips: null,
                auxShips: null,
            });
        }
        const result = checkAvailability(mission, ctxFor(state, env, START));
        expect(result.available).toBeFalse();
        expect(result.reasons.some(reason => reason.includes("cap"))).toBeTrue();
    });

    it("rule 11: flag 0x0008 wants 100 fuel; flags2 0x0001 wants cargo space", function() {
        const fueled = makeMission("nova:700", { flags: 0x0008 });
        expect(checkAvailability(fueled,
            ctxFor(state, env, START, "nova:300", "bbs", { fuel: 99 })).available).toBeFalse();
        expect(checkAvailability(fueled,
            ctxFor(state, env, START, "nova:300", "bbs", { fuel: 100 })).available).toBeTrue();

        const cargo = makeMission("nova:701", { flags2: 0x0001 });
        expect(checkAvailability(cargo,
            ctxFor(state, env, START, "nova:300", "bbs", { freeCargoTons: 0 })).available)
            .toBeFalse();
        expect(checkAvailability(cargo,
            ctxFor(state, env, START, "nova:300", "bbs", { freeCargoTons: 5 })).available)
            .toBeTrue();
    });

    it("reports every failing rule, not just the first", function() {
        const mission = makeMission("nova:710", {
            availStel: 128,   // not Start One
            availRating: 50,  // no kills
        });
        const result = checkAvailability(mission, ctxFor(state, env, START));
        expect(result.available).toBeFalse();
        expect(result.reasons.length).toBeGreaterThanOrEqual(2);
        expect(result.reasons.some(r => r.includes("AvailStel"))).toBeTrue();
        expect(result.reasons.some(r => r.includes("AvailRating"))).toBeTrue();
    });

    it("S1 fixture sanity: systems are wired as the specs expect", function() {
        expect(SYSTEMS.get("nova:301")!.planets).toContain("nova:140");
    });
});
