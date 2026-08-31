// Decoder specs for the packed stellar/system filter codes (AvailStel,
// TravelStel, ShipSyst, përs/flët linkSyst). Byte-verified against the
// binary's decoders FUN_00447a30 / FUN_00441b40 / FUN_0043d510 — see the
// band table in stellar_filter.ts. Shares the mission-test fixtures.

import "jasmine";
import { decodeStellarFilter, decodeSystemFilter, planetMatchesStellarFilter,
    systemMatchesSystemFilter } from "./stellar_filter";
import { MissionEnv } from "./mission_state_machine";
import {
    BARREN,
    EARTH,
    makeTestEnv,
    START,
    SYSTEMS,
    VELLOS_WORLD,
} from "./test_fixtures";

describe("stellar filter decode", function() {
    it("decodes the specific-id band 128-2175 and nothing around it", function() {
        expect(decodeStellarFilter(128, "availability"))
            .toEqual({ kind: "specific", rawId: 128 });
        expect(decodeStellarFilter(2175, "availability"))
            .toEqual({ kind: "specific", rawId: 2175 });
        expect(decodeStellarFilter(127, "availability").kind).toEqual("unknown");
        expect(decodeStellarFilter(2176, "availability").kind).toEqual("unknown");
    });

    it("decodes the near band 5000-9998 with the +128 resource-id shift", function() {
        // 5000 + (301 - 128) = 5173: adjacent to the system with raw id 301.
        expect(decodeStellarFilter(5173, "availability"))
            .toEqual({ kind: "nearSystem", systemRawId: 301 });
        expect(decodeStellarFilter(5000, "availability"))
            .toEqual({ kind: "nearSystem", systemRawId: 128 });
        // The band runs to 9998 (NOT base+2047): 9999 is the govtless code.
        expect(decodeStellarFilter(9998, "availability"))
            .toEqual({ kind: "nearSystem", systemRawId: 5126 });
        expect(decodeStellarFilter(4999, "availability").kind).toEqual("unknown");
    });

    it("decodes the govt bands: widths 5000/5000/5000/5000/1000/1000, raw id code-base+128", function() {
        // 10000 = Federation (gövt raw 128), 10007 = raw 135; owned runs to
        // 14999, not base+2048.
        expect(decodeStellarFilter(10000, "availability")).toEqual(
            { kind: "govt", relation: "owned", govtRawId: 128 });
        expect(decodeStellarFilter(10007, "availability")).toEqual(
            { kind: "govt", relation: "owned", govtRawId: 135 });
        expect(decodeStellarFilter(14999, "availability")).toEqual(
            { kind: "govt", relation: "owned", govtRawId: 5127 });
        // 15000 (not 15001) is the first allies code and targets raw 128.
        expect(decodeStellarFilter(15000, "availability")).toEqual(
            { kind: "govt", relation: "allies", govtRawId: 128 });
        expect(decodeStellarFilter(19999, "availability")).toEqual(
            { kind: "govt", relation: "allies", govtRawId: 5127 });
        expect(decodeStellarFilter(20000, "availability")).toEqual(
            { kind: "govt", relation: "notOwned", govtRawId: 128 });
        expect(decodeStellarFilter(25000, "availability")).toEqual(
            { kind: "govt", relation: "enemies", govtRawId: 128 });
        // The 30000/31000 bands are 1000 wide and no longer overlap.
        expect(decodeStellarFilter(30000, "availability")).toEqual(
            { kind: "govt", relation: "orClassmates", govtRawId: 128 });
        expect(decodeStellarFilter(30999, "availability")).toEqual(
            { kind: "govt", relation: "orClassmates", govtRawId: 1127 });
        expect(decodeStellarFilter(31000, "availability")).toEqual(
            { kind: "govt", relation: "notClassmates", govtRawId: 128 });
        expect(decodeStellarFilter(31999, "availability")).toEqual(
            { kind: "govt", relation: "notClassmates", govtRawId: 1127 });
        expect(decodeStellarFilter(32000, "availability").kind).toEqual("unknown");
    });

    it("decodes 9999 as govtless, not as govt raw 127", function() {
        expect(decodeStellarFilter(9999, "availability")).toEqual({ kind: "govtless" });
        expect(decodeSystemFilter(9999)).toEqual({ kind: "govtless" });
    });

    it("decodes the system-filter special codes (FUN_00447a30)", function() {
        // -1 AND -6 are the player's current system; -2/-3 the travel/return
        // destination's system; -4/-5 match nothing.
        expect(decodeSystemFilter(-1)).toEqual({ kind: "playerSystem" });
        expect(decodeSystemFilter(-6)).toEqual({ kind: "playerSystem" });
        expect(decodeSystemFilter(-2)).toEqual({ kind: "travelStellarSystem" });
        expect(decodeSystemFilter(-3)).toEqual({ kind: "returnStellarSystem" });
        expect(decodeSystemFilter(-4)).toEqual({ kind: "unknown", code: -4 });
        expect(decodeSystemFilter(-5)).toEqual({ kind: "unknown", code: -5 });
        // The stellar specials keep their field-dependent meanings.
        expect(decodeStellarFilter(-1, "availability")).toEqual({ kind: "anyInhabited" });
        expect(decodeStellarFilter(-1, "travel")).toEqual({ kind: "none" });
        expect(decodeStellarFilter(-4, "return")).toEqual({ kind: "origin" });
    });
});

describe("stellar filter matching", function() {
    let env: MissionEnv;

    beforeEach(function() {
        env = makeTestEnv().env;
    });

    function matchPlanet(planetId: string, systemId: string, code: number): boolean {
        const planet = env.planet(planetId)!;
        return planetMatchesStellarFilter(planet, decodeStellarFilter(code,
            "availability"), {
            systemId,
            system: id => env.system(id),
            government: id => env.government(id),
            govtByRawId: rawId => env.govtByRawId(rawId),
        });
    }

    it("matches the AvailStel near band on links of the landed system ONLY", function() {
        // 5173 = adjacent to system 301 (S1): the landed system must LINK to
        // S1. S0 and S2 do; landing in S1 itself or unlinked S3 does not.
        expect(matchPlanet(BARREN.id, "nova:301", 5173)).toBeFalse();
        expect(matchPlanet(START.id, "nova:300", 5173)).toBeTrue();
        expect(matchPlanet(EARTH.id, "nova:302", 5173)).toBeTrue();
        expect(matchPlanet("nova:160", "nova:303", 5173)).toBeFalse();
    });

    it("matches AvailStel 9999 on govtless planets, inhabited or not", function() {
        expect(matchPlanet(BARREN.id, "nova:301", 9999)).toBeTrue();
        expect(matchPlanet(START.id, "nova:300", 9999)).toBeFalse();
    });

    function matchSystem(systemId: string, code: number, travelStellarId: string | null = null,
        returnStellarId: string | null = null): boolean {
        return systemMatchesSystemFilter(env.system(systemId)!,
            decodeSystemFilter(code), {
            playerSystemId: "nova:300",
            travelStellarId,
            returnStellarId,
            systemOfPlanet: id => env.systemOfPlanet(id),
            system: id => env.system(id),
            planet: id => env.planet(id),
            government: id => env.government(id),
            govtByRawId: rawId => env.govtByRawId(rawId),
        });
    }

    it("matches system govt bands on the system's OWN government", function() {
        // 10002 = govt raw 130 (Polaris): only Polaris system 304 has one.
        // System 300 contains Federation Start One but is itself govtless.
        expect(matchSystem("nova:304", 10002)).toBeTrue();
        expect(matchSystem("nova:300", 10002)).toBeFalse();
        expect(matchSystem("nova:302", 10002)).toBeFalse();
        // 9999 = govtless: S0 has no government; 304 does.
        expect(matchSystem("nova:300", 9999)).toBeTrue();
        expect(matchSystem("nova:304", 9999)).toBeFalse();
        // Not-owned has no govt gate: a govtless system passes. 20002 =
        // not-owned by govt 130 (Polaris).
        expect(matchSystem("nova:300", 20002)).toBeTrue();
        expect(matchSystem("nova:304", 20002)).toBeFalse();
    });

    it("resolves -2/-3 through the mission's travel/return stellars", function() {
        // Earth (raw 128) sits in system 302; Vell-os Prime (408) too.
        expect(matchSystem("nova:302", -2, EARTH.id, VELLOS_WORLD.id)).toBeTrue();
        expect(matchSystem("nova:300", -2, EARTH.id, VELLOS_WORLD.id)).toBeFalse();
        expect(matchSystem("nova:302", -3, EARTH.id, VELLOS_WORLD.id)).toBeTrue();
        expect(matchSystem("nova:300", -3, EARTH.id, VELLOS_WORLD.id)).toBeFalse();
        // No destination resolved: no match.
        expect(matchSystem("nova:302", -2, null, null)).toBeFalse();
        // -1/-6: the player's current system.
        expect(matchSystem("nova:300", -1)).toBeTrue();
        expect(matchSystem("nova:301", -1)).toBeFalse();
        expect(matchSystem("nova:300", -6)).toBeTrue();
        // -4/-5 match nothing.
        expect(matchSystem("nova:300", -4)).toBeFalse();
        expect(matchSystem("nova:300", -5)).toBeFalse();
    });

    it("keeps the intended (stricter) 31000-band semantics", function() {
        // The binary's AvailStel 31000 band is degenerate (bug at 0x441e26:
        // every governed spob passes). The port keeps "neither the govt nor
        // its classmates": 31000 = not Federation and not classmate.
        expect(matchPlanet(EARTH.id, "nova:302", 31000)).toBeFalse();
        expect(matchPlanet(VELLOS_WORLD.id, "nova:302", 31000)).toBeFalse();
        expect(matchPlanet("nova:170", "nova:301", 31000)).toBeTrue();
        expect(matchPlanet("nova:160", "nova:303", 31000)).toBeTrue();
    });
});

// Fixture sanity: the systems map really has a Polaris-owned 304 and
// govtless 300-303, and the raw ids line up with the code math above.
describe("stellar filter fixture assumptions", function() {
    it("holds", function() {
        expect(SYSTEMS.get("nova:304")!.government).toEqual("nova:130");
        expect(SYSTEMS.get("nova:300")!.government).toBeNull();
    });
});
