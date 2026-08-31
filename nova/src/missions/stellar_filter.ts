// Decoders for the packed stellar/system filter codes stored in mïsn fields
// (AvailStel, TravelStel, ReturnStel, ShipSyst, AuxShipSyst) and the govt
// relation graph needed to resolve them. Pure TypeScript — no PIXI/ECS
// imports — so the mission FSM and availability evaluator stay headless
// testable.
//
// Code bands (EV Nova Bible, "mïsn" fields; byte-verified against the
// binary's decoders FUN_00447a30 / FUN_00441b40 / FUN_0043d510):
//   -4          origin stellar (ReturnStel only; resolved at accept)
//   -3          random uninhabited planet
//   -2          random inhabited planet
//   -1          any inhabited planet (AvailStel) / no destination (Travel) /
//               no return requirement (Return; 237 stock missions rely on it)
//   128-2175    the specific stellar/system with that raw id (idx == code-128)
//   5000-9998   in or adjacent to the system whose raw id is code - 4872
//               (the binary compares runtime index code-5000; resource ids
//               run 128 ahead of runtime indices)
//   9999        govtless (spob with no government / system with govt -1)
//   10000-14999 owned by govt            (raw id = code -  9872)
//   15000-19999 allied with govt         (raw id = code - 14872)
//   20000-24999 anything but govt        (raw id = code - 19872)
//   25000-29999 at war with govt         (raw id = code - 24872)
//   30000-30999 govt or classmate govt   (raw id = code - 29872)
//   31000-31999 neither govt nor classmate (raw id = code - 30872)
//
// The govt bands encode the govt's raw id as code - base + 128 (the binary
// compares the runtime govt index code - base; gövt resource ids are 128
// more than runtime indices — the band's warning strings print index+128).
// Band widths are 5000/5000/5000/5000/1000/1000, NOT base+2048. Stock
// check: 10000 = Federation (gövt 128), 10007 = Heraan (135), 10013 =
// Rebels (141), 10019 = Nil'kemorya (147); exactly one stock AvailStel
// uses the 9999 govtless code. This is different from the negative PayVal
// bands, which DO use raw govt ids (|pay| - 10000 = 128 means Federation)
// — see mission_state_machine.ts.
//
// System-filter special codes (mïsn ShipSyst/AuxShipSyst, FUN_00447a30):
// -1 AND -6 are the player's CURRENT system (not the mission origin), -2
// the system of the mission's travel destination, -3 the return
// destination's system; -4/-5 fall through every band and match NOTHING
// (stock ShipSyst -4/-5 missions never spawn their ships). Përs/flët
// linkSyst share this decoder (their binary matchers are unaudited inline
// copies); stock linkSyst only ever uses -1/specific/owned codes, and a
// linkSyst -2/-3 has no mission to resolve against, so it matches nothing.
//
// Known deliberate divergence: the binary's AvailStel 31000 band is
// degenerate (byte-verified bug at 0x441e26 — it calls the classmates
// helper with code-30000, always >= 1000 and thus out of its bounds, so
// every governed spob passes). The port keeps the intended "neither the
// govt nor its classmates" semantics: stricter than the binary, and the
// same formula the binary's other two decoders really implement.

import { GovernmentData } from "novadatainterface/GovernmentData";
import { PlanetData } from "novadatainterface/PlanetData";
import { SystemData } from "novadatainterface/SystemData";
import { govtsAlliedPerBinary, govtsAreAllies, govtsAreClassmates, govtsAreEnemies,
    govtsAtWarPerBinary } from "../player/legal_status";


export const SPECIFIC_ID_BASE = 128;
export const SPECIFIC_ID_MAX = 2175;
export const NEAR_SYSTEM_BASE = 5000;
// Last code of the near band: the binary's signed compares run to 9998 and
// 9999 starts the govt bands.
export const NEAR_SYSTEM_MAX = 9998;
// Exactly this code matches governments-less stellars: the binary's owned
// band compares govt == code-10000, so 9999 asks for govt -1.
export const GOVTLESS_CODE = 9999;
// First codes of each govt relation band; the encoded govt raw id is
// code - base + SPECIFIC_ID_BASE (see the file comment for the +128).
export const GOVT_BAND_BASES = {
    owned: 10000,
    allies: 15000,
    notOwned: 20000,
    enemies: 25000,
    orClassmates: 30000,
    notClassmates: 31000,
} as const;

// "nova:128" -> 128. Global ids are always "<prefix>:<raw id>".
export function rawIdOf(globalId: string): number {
    const colon = globalId.lastIndexOf(":");
    if (colon < 0) {
        return NaN;
    }
    return parseInt(globalId.slice(colon + 1), 10);
}

export function globalId(prefix: string, rawId: number): string {
    return `${prefix}:${rawId}`;
}


// --- govt relation graph ---

// The class/alliance relation helpers live in player/legal_status.ts (next
// to the record propagation that also needs them); re-exported here so the
// stellar filter's public surface is unchanged.
export { govtsAreAllies, govtsAreClassmates, govtsAreEnemies };


export type GovtRelation = keyof typeof GOVT_BAND_BASES;

export interface GovtBandCode {
    kind: "govt";
    relation: GovtRelation;
    govtRawId: number;
}

export type StellarFilter =
    | { kind: "anyInhabited" }                  // -1 availability
    | { kind: "none" }                          // -1 travel / return
    | { kind: "origin" }                        // -4 return
    | { kind: "randomInhabited" }               // -2
    | { kind: "randomUninhabited" }             // -3
    | { kind: "specific"; rawId: number }       // 128-2175
    | { kind: "nearSystem"; systemRawId: number } // 5000-9998
    | { kind: "govtless" }                      // 9999
    | GovtBandCode
    | { kind: "unknown"; code: number };

// `context` disambiguates -1, whose meaning depends on the field: any
// inhabited planet for AvailStel, no destination for TravelStel, and no
// return requirement for ReturnStel.
export function decodeStellarFilter(code: number,
    context: "availability" | "travel" | "return"): StellarFilter {
    if (code === -1) {
        if (context === "availability") {
            return { kind: "anyInhabited" };
        }
        return { kind: "none" };
    }
    if (code === -2) {
        return { kind: "randomInhabited" };
    }
    if (code === -3) {
        return { kind: "randomUninhabited" };
    }
    if (code === -4) {
        return { kind: "origin" };
    }
    return decodeIdBand(code);
}

// System-filter special codes (FUN_00447a30): -1 AND -6 are the player's
// CURRENT system (not the mission origin), -2 the system of the mission's
// travel destination, -3 the return destination's system; -4/-5 match
// nothing at all.
export function decodeSystemFilter(code: number): SystemFilter {
    switch (code) {
        case -1:
        case -6: return { kind: "playerSystem" };
        case -2: return { kind: "travelStellarSystem" };
        case -3: return { kind: "returnStellarSystem" };
        // -4/-5 fall through every band in the binary: stock ShipSyst
        // -4/-5 missions never spawn their ships.
    }
    return decodeIdBand(code);
}

export type SystemFilter =
    | { kind: "playerSystem" }
    | { kind: "travelStellarSystem" }
    | { kind: "returnStellarSystem" }
    | { kind: "specific"; rawId: number }
    | { kind: "nearSystem"; systemRawId: number }
    | { kind: "govtless" }
    | GovtBandCode
    | { kind: "unknown"; code: number };

// The bands shared by stellar and system codes: specific id, in/near system,
// and the six govt relation bands.
function decodeIdBand(code: number):
    | { kind: "specific"; rawId: number }
    | { kind: "nearSystem"; systemRawId: number }
    | { kind: "govtless" }
    | GovtBandCode
    | { kind: "unknown"; code: number } {
    if (code >= SPECIFIC_ID_BASE && code <= SPECIFIC_ID_MAX) {
        return { kind: "specific", rawId: code };
    }
    if (code >= NEAR_SYSTEM_BASE && code <= NEAR_SYSTEM_MAX) {
        return { kind: "nearSystem", systemRawId: code - NEAR_SYSTEM_BASE + SPECIFIC_ID_BASE };
    }
    if (code === GOVTLESS_CODE) {
        return { kind: "govtless" };
    }
    // Inclusive ends of the govt bands: 5000/5000/5000/5000 wide, then
    // 1000/1000 — NOT base+2048 (byte-verified in FUN_00447a30). The
    // ranges are disjoint, so the scan order does not matter.
    const bands: Array<[GovtRelation, number]> = [
        ["owned", 14999],
        ["allies", 19999],
        ["notOwned", 24999],
        ["enemies", 29999],
        ["orClassmates", 30999],
        ["notClassmates", 31999],
    ];
    for (const [relation, end] of bands) {
        const base = GOVT_BAND_BASES[relation];
        if (code >= base && code <= end) {
            return {
                kind: "govt",
                relation,
                govtRawId: code - base + SPECIFIC_ID_BASE,
            };
        }
    }
    return { kind: "unknown", code };
}


// --- matching ---

export interface StellarMatchContext {
    // The system containing the planet being tested (for nearSystem bands).
    systemId: string;
    system(systemId: string): SystemData | null;
    government(govtId: string | null): GovernmentData | null;
    govtByRawId(rawId: number): GovernmentData | null;
}

function planetMatchesGovtBand(planet: PlanetData, filter: GovtBandCode,
    ctx: StellarMatchContext): boolean {
    const target = ctx.govtByRawId(filter.govtRawId);
    if (!target) {
        return false;
    }
    const mine = ctx.government(planet.govt);
    const isOwned = planet.govt === target.id;
    switch (filter.relation) {
        case "owned": return isOwned;
        case "notOwned": return !isOwned;
        case "allies": return mine !== null && govtsAreAllies(mine, target);
        case "enemies": return mine !== null && govtsAreEnemies(mine, target);
        case "orClassmates":
            return isOwned || (mine !== null && govtsAreClassmates(mine, target));
        case "notClassmates":
            return !isOwned && (mine === null || !govtsAreClassmates(mine, target));
    }
}

export function planetMatchesStellarFilter(planet: PlanetData, filter: StellarFilter,
    ctx: StellarMatchContext): boolean {
    switch (filter.kind) {
        case "anyInhabited":
        case "randomInhabited":
            return planet.inhabited;
        case "randomUninhabited":
            return !planet.inhabited;
        case "specific":
            return rawIdOf(planet.id) === filter.rawId;
        case "nearSystem": {
            // AvailStel's near band checks ONLY the links of the landed
            // system (FUN_00441b40): the target system itself does not
            // match.
            const system = ctx.system(ctx.systemId);
            if (!system) {
                return false;
            }
            return system.links.some(id => rawIdOf(id) === filter.systemRawId);
        }
        case "govt":
            return planetMatchesGovtBand(planet, filter, ctx);
        case "govtless":
            // Code 9999: the binary compares govt == code-10000, so -1 (no
            // government) passes — with no inhabited requirement.
            return planet.govt === null;
        case "none":
        case "origin":
        case "unknown":
            // none/origin are resolved at accept time, never matched against
            // a landing; unknown codes match nothing.
            return false;
    }
}

export interface SystemMatchContext {
    playerSystemId: string;
    travelStellarId: string | null;
    returnStellarId: string | null;
    // Which system contains a given planet (for the govt bands).
    systemOfPlanet(planetId: string): string | null;
    system(systemId: string): SystemData | null;
    planet(planetId: string): PlanetData | null;
    government(govtId: string | null): GovernmentData | null;
    govtByRawId(rawId: number): GovernmentData | null;
}

export function systemMatchesSystemFilter(system: SystemData, filter: SystemFilter,
    ctx: SystemMatchContext): boolean {
    switch (filter.kind) {
        case "playerSystem":
            return system.id === ctx.playerSystemId;
        case "travelStellarSystem":
            return ctx.travelStellarId !== null
                && ctx.systemOfPlanet(ctx.travelStellarId) === system.id;
        case "returnStellarSystem":
            return ctx.returnStellarId !== null
                && ctx.systemOfPlanet(ctx.returnStellarId) === system.id;
        case "specific":
            return rawIdOf(system.id) === filter.rawId;
        case "nearSystem": {
            if (rawIdOf(system.id) === filter.systemRawId) {
                return true;
            }
            return system.links.some(id => rawIdOf(id) === filter.systemRawId);
        }
        case "govtless":
            // Code 9999: the binary compares govt == code-10000, so a
            // system with govt -1 passes.
            return system.government === null;
        case "govt": {
            // FUN_00447a30 matches the band against the SYSTEM'S OWN govt
            // (syst+8), never any of its planets'.
            const target = ctx.govtByRawId(filter.govtRawId);
            if (!target) {
                return false;
            }
            const mine = ctx.government(system.government);
            const isOwned = mine !== null && mine.id === target.id;
            switch (filter.relation) {
                case "owned": return isOwned;
                // No govt gate on not-owned: a govtless system (-1) is not
                // the target govt, so it passes (byte-verified).
                case "notOwned": return !isOwned;
                case "allies":
                    // g == target || FUN_0046bc90(g, target): owning counts
                    // as allied.
                    return mine !== null
                        && (isOwned || govtsAlliedPerBinary(mine, target));
                case "enemies":
                    // FUN_0046bdf0 answers 0 for equal governments.
                    return mine !== null && !isOwned
                        && govtsAtWarPerBinary(mine, target);
                case "orClassmates":
                    return mine !== null && govtsAreClassmates(mine, target);
                case "notClassmates":
                    return mine !== null && !govtsAreClassmates(mine, target);
            }
        }
        case "unknown":
            return false;
    }
}


// --- universe graph ---

// Breadth-first hyperjump distances from `fromSystemId` over SystemData
// links. Systems that cannot reach the origin are absent from the result.
export function jumpDistances(systems: Map<string, SystemData>,
    fromSystemId: string): Map<string, number> {
    const distances = new Map<string, number>([[fromSystemId, 0]]);
    let frontier = [fromSystemId];
    while (frontier.length > 0) {
        const next: string[] = [];
        for (const id of frontier) {
            const system = systems.get(id);
            if (!system) {
                continue;
            }
            const distance = distances.get(id)! + 1;
            for (const link of system.links) {
                if (!distances.has(link)) {
                    distances.set(link, distance);
                    next.push(link);
                }
            }
        }
        frontier = next;
    }
    return distances;
}
