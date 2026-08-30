// Decoders for the packed stellar/system filter codes stored in mïsn fields
// (AvailStel, TravelStel, ReturnStel, ShipSyst, AuxShipSyst) and the govt
// relation graph needed to resolve them. Pure TypeScript — no PIXI/ECS
// imports — so the mission FSM and availability evaluator stay headless
// testable.
//
// Code bands (EV Nova Bible, "mïsn" fields):
//   -4          origin stellar (ReturnStel only)
//   -3          random uninhabited planet
//   -2          random inhabited planet
//   -1          any inhabited planet (AvailStel) / no destination (Travel) /
//               no return requirement (Return; 237 stock missions rely on it)
//   128-2175    the specific stellar/system with that raw id
//   5000-7047   in or adjacent to system (code - 4000)
//   9999/15000/20000/25000/30000/31000 bands: planets (or systems) owned by
//               a government / its allies / not it / its enemies / it or its
//               classmates / neither.
//
// The govt bands encode the govt's raw id with a +127 shift, NOT directly:
// stock data says 10000 = Federation (gövt 128), 10007 = Heraan (135),
// 10013 = Rebels (141), 10019 = Nil'kemorya (147), i.e. govt = code - base +
// 127. (Verified against all 791 stock mïsn; the 30000/31000 bands have no
// stock usage, so their shift is inferred from the other four.) This is
// different from the negative PayVal bands, which DO use raw govt ids
// (|pay| - 10000 = 128 means Federation) — see mission_state_machine.ts.

import { GovernmentData } from "novadatainterface/GovernmentData";
import { PlanetData } from "novadatainterface/PlanetData";
import { SystemData } from "novadatainterface/SystemData";


export const SPECIFIC_ID_BASE = 128;
export const SPECIFIC_ID_MAX = 2175;
export const NEAR_SYSTEM_BASE = 5000;
// First codes of each govt relation band (see file comment for the +127).
export const GOVT_BAND_BASES = {
    owned: 9999,
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
import { govtsAreAllies, govtsAreClassmates, govtsAreEnemies } from "../player/legal_status";
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
    | { kind: "nearSystem"; systemRawId: number } // 5000-7047
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

export function decodeSystemFilter(code: number): SystemFilter {
    switch (code) {
        case -1: return { kind: "originSystem" };
        case -2: return { kind: "anyRandom" };
        case -3: return { kind: "travelStellarSystem" };
        case -4: return { kind: "returnStellarSystem" };
        case -5: return { kind: "adjacentToOrigin" };
        case -6: return { kind: "playerSystem" };
    }
    return decodeIdBand(code);
}

export type SystemFilter =
    | { kind: "originSystem" }
    | { kind: "anyRandom" }
    | { kind: "travelStellarSystem" }
    | { kind: "returnStellarSystem" }
    | { kind: "adjacentToOrigin" }
    | { kind: "playerSystem" }
    | { kind: "specific"; rawId: number }
    | { kind: "nearSystem"; systemRawId: number }
    | GovtBandCode
    | { kind: "unknown"; code: number };

// The bands shared by stellar and system codes: specific id, in/near system,
// and the six govt relation bands.
function decodeIdBand(code: number):
    | { kind: "specific"; rawId: number }
    | { kind: "nearSystem"; systemRawId: number }
    | GovtBandCode
    | { kind: "unknown"; code: number } {
    if (code >= SPECIFIC_ID_BASE && code <= SPECIFIC_ID_MAX) {
        return { kind: "specific", rawId: code };
    }
    if (code >= NEAR_SYSTEM_BASE && code <= NEAR_SYSTEM_BASE + 2047) {
        return { kind: "nearSystem", systemRawId: code - NEAR_SYSTEM_BASE + SPECIFIC_ID_BASE };
    }
    // The 31000 band is checked before 30000: their code ranges overlap
    // (govt raw ids go up to 2175), and no stock mission uses either. The
    // +127 shift is what the stock data shows (10000 = govt 128).
    for (const base of [GOVT_BAND_BASES.notClassmates, GOVT_BAND_BASES.orClassmates,
        GOVT_BAND_BASES.enemies, GOVT_BAND_BASES.notOwned,
        GOVT_BAND_BASES.allies, GOVT_BAND_BASES.owned] as const) {
        const govtRawId = code - base + SPECIFIC_ID_BASE - 1;
        if (govtRawId >= SPECIFIC_ID_BASE && govtRawId <= SPECIFIC_ID_MAX) {
            return {
                kind: "govt",
                relation: (Object.keys(GOVT_BAND_BASES) as GovtRelation[])
                    .find(relation => GOVT_BAND_BASES[relation] === base)!,
                govtRawId,
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
            const system = ctx.system(ctx.systemId);
            if (!system) {
                return false;
            }
            if (rawIdOf(system.id) === filter.systemRawId) {
                return true;
            }
            return system.links.some(id => rawIdOf(id) === filter.systemRawId);
        }
        case "govt":
            return planetMatchesGovtBand(planet, filter, ctx);
        case "none":
        case "origin":
        case "unknown":
            // none/origin are resolved at accept time, never matched against
            // a landing; unknown codes match nothing.
            return false;
    }
}

export interface SystemMatchContext {
    originSystemId: string;
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
        case "originSystem":
            return system.id === ctx.originSystemId;
        case "anyRandom":
            return true;
        case "travelStellarSystem":
            return ctx.travelStellarId !== null
                && ctx.systemOfPlanet(ctx.travelStellarId) === system.id;
        case "returnStellarSystem":
            return ctx.returnStellarId !== null
                && ctx.systemOfPlanet(ctx.returnStellarId) === system.id;
        case "adjacentToOrigin": {
            const origin = ctx.system(ctx.originSystemId);
            return origin !== null && origin.links.includes(system.id);
        }
        case "playerSystem":
            return system.id === ctx.playerSystemId;
        case "specific":
            return rawIdOf(system.id) === filter.rawId;
        case "nearSystem": {
            if (rawIdOf(system.id) === filter.systemRawId) {
                return true;
            }
            return system.links.some(id => rawIdOf(id) === filter.systemRawId);
        }
        case "govt": {
            const target = ctx.govtByRawId(filter.govtRawId);
            if (!target) {
                return false;
            }
            // A system belongs to a govt band when any of its planets does.
            return system.planets.some(planetId => {
                const planet = ctx.planet(planetId);
                return planet !== null && planetMatchesGovtBand(planet, filter, {
                    systemId: system.id,
                    system: ctx.system,
                    government: ctx.government,
                    govtByRawId: ctx.govtByRawId,
                });
            });
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
