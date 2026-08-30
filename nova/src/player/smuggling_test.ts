// Headless specs for the planetary scan rules (player/smuggling.ts):
// system-government resolution (fail-open), the junk/mission illegality
// masks, the ScanFine flat/warning/percentage bands, and the CrimeTol
// record gate. Run with:
//   npx esbuild --bundle --platform=node nova/src/player/smuggling_test.ts \
//       --outfile=/tmp/sc.js && node_modules/.bin/jasmine /tmp/sc.js

import "jasmine";
import { getDefaultMissionData, MissionData } from "novadatainterface/MissionData";
import { getDefaultGovernmentData, GovernmentData } from "novadatainterface/GovernmentData";
import { getDefaultJunkData, JunkData } from "novadatainterface/JunkData";
import { getDefaultPlanetData, PlanetData } from "novadatainterface/PlanetData";
import { getDefaultSystemData, SystemData } from "novadatainterface/SystemData";
import { makePlayerState } from "../missions/test_fixtures";
import { CargoEntry } from "./cargo";
import { ActiveMission } from "./player_state";
import {
    scanCheck,
    scanFine,
    smuggledMissions,
    SmugglingEnv,
    systemGovernment,
} from "./smuggling";


// Synthetic universe: one scanning govt (Federation-like, scanMask 0x8000),
// two jünk types (900 scans as 0x8000 = caught, 901 as 0x0400 = missed), and
// one 0x0020 mission whose cargo scans as 0x8000.
function makeGovt(overrides: Partial<GovernmentData> = {}): GovernmentData {
    return {
        ...getDefaultGovernmentData(),
        id: "nova:128",
        name: "Scan Govt",
        classes: [1],
        crimeTol: 25,
        scanFine: 500,
        penalties: {
            smuggling: 20,
            disable: 0,
            board: 0,
            kill: 0,
        },
        scanMask: 0x8000,
        ...overrides,
    };
}
const GOVT = makeGovt();
const INDEPENDENT = makeGovt({ id: "nova:129", name: "Indy", scanMask: 0 });

function makeJunk(rawId: number, scanMask: number): [number, JunkData] {
    return [rawId, { ...getDefaultJunkData(), id: `nova:${rawId}`, scanMask }];
}
const JUNKS = new Map<number, JunkData>([
    makeJunk(900, 0x8000),
    makeJunk(901, 0x0400),
]);

function makePlanet(id: string, govt: string | null, inhabited = true): PlanetData {
    return { ...getDefaultPlanetData(), id, govt, inhabited };
}

function makeSystem(id: string, planets: string[]): SystemData {
    return { ...getDefaultSystemData(), id, planets };
}

function makeSmugglerMission(rawId: number, scanMask: number,
    flags = 0x0020): MissionData {
    return { ...getDefaultMissionData(), id: `nova:${rawId}`, scanMask, flags };
}
const SMUGGLER_MISSION = makeSmugglerMission(507, 0x8000);
const QUIET_MISSION = makeSmugglerMission(508, 0x0400);

// env over the fixtures (SmugglingEnv shape; junk masks from JUNKS).
function makeEnv(overrides: Partial<SmugglingEnv> = {}): SmugglingEnv {
    return {
        system: id => SYSTEMS.get(id) ?? null,
        planet: id => PLANETS.get(id) ?? null,
        government: id => (id === null ? null : id === GOVT.id ? GOVT
            : id === INDEPENDENT.id ? INDEPENDENT : null),
        missionByRawId: rawId => MISSIONS.get(rawId) ?? null,
        junk: rawId => JUNKS.get(rawId),
        ...overrides,
    };
}

// nova:300 empty; nova:301 only the uninhabited rock; nova:302 the scanning
// govt's world; nova:303 inhabited but independent (fail-open); nova:304
// unknown (no system data).
const PLANETS = new Map<string, ReturnType<typeof makePlanet>>([
    ["nova:130", makePlanet("nova:130", "nova:128")],
    ["nova:140", makePlanet("nova:140", "nova:128", false)],
    ["nova:141", makePlanet("nova:141", null)],
]);
const SYSTEMS = new Map<string, SystemData>([
    ["nova:300", makeSystem("nova:300", [])],
    ["nova:301", makeSystem("nova:301", ["nova:140"])],
    ["nova:302", makeSystem("nova:302", ["nova:130"])],
    ["nova:303", makeSystem("nova:303", ["nova:141"])],
]);
const MISSIONS = new Map<number, MissionData>([
    [507, SMUGGLER_MISSION],
    [508, QUIET_MISSION],
]);

// An active mission hauling 10 tons of type 42 (a jünk raw id).
function makeActiveMission(missionId: string, cargoLoaded = true):
    ActiveMission {
    return {
        missionId,
        originStellar: "nova:130",
        travelStellar: null,
        returnStellar: null,
        travelComplete: false,
        shipGoalComplete: false,
        failed: false,
        cargoLoaded,
        cargo: { type: 42, qty: 10 },
        deadline: null,
        specialShips: null,
        auxShips: null,
    };
}

const NO_SCAN = { illegal: false, fine: 0, reason: "none" as const };


describe("systemGovernment", () => {
    const env = makeEnv();

    it("returns null for a system with no planets", () => {
        expect(systemGovernment(env, "nova:300")).toBeNull();
    });

    it("returns null when the only planet is uninhabited", () => {
        expect(systemGovernment(env, "nova:301")).toBeNull();
    });

    it("returns the first inhabited planet's government", () => {
        expect(systemGovernment(env, "nova:302")).toEqual("nova:128");
    });

    it("fails open for an inhabited independent planet", () => {
        expect(systemGovernment(env, "nova:303")).toBeNull();
    });

    it("returns null for an unknown system", () => {
        expect(systemGovernment(env, "nova:304")).toBeNull();
    });
});

describe("scanCheck", () => {
    const env = makeEnv();
    const state = () => makePlayerState(); // credits 25000, empty record

    it("passes a clean hold with no missions", () => {
        expect(scanCheck(state(), env, "nova:302", [], [])).toEqual(NO_SCAN);
    });

    it("flags jünk whose scan mask overlaps the government's", () => {
        const cargo: CargoEntry[] = [{ type: 900, qty: 5 }];
        expect(scanCheck(state(), env, "nova:302", cargo, []))
            .toEqual({ illegal: true, fine: 500, reason: "junk" });
    });

    it("misses jünk whose scan mask does not overlap", () => {
        const cargo: CargoEntry[] = [{ type: 901, qty: 5 }];
        expect(scanCheck(state(), env, "nova:302", cargo, [])).toEqual(NO_SCAN);
    });

    it("never flags standard commodities", () => {
        const cargo: CargoEntry[] = [{ type: 0, qty: 30 }, { type: 5, qty: 2 }];
        expect(scanCheck(state(), env, "nova:302", cargo, [])).toEqual(NO_SCAN);
    });

    it("flags loaded mission cargo whose mïsn mask overlaps", () => {
        const missions = [makeActiveMission("nova:507")];
        expect(scanCheck(state(), env, "nova:302", [], missions))
            .toEqual({ illegal: true, fine: 500, reason: "mission" });
    });

    it("ignores mission cargo not yet loaded into the hold", () => {
        const missions = [makeActiveMission("nova:507", false)];
        expect(scanCheck(state(), env, "nova:302", [], missions))
            .toEqual(NO_SCAN);
    });

    it("ignores missions whose scan mask does not overlap", () => {
        const missions = [makeActiveMission("nova:508")];
        expect(scanCheck(state(), env, "nova:302", [], missions))
            .toEqual(NO_SCAN);
    });

    it("reports mission reason when junk and mission cargo are both illegal",
        () => {
            const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
            const missions = [makeActiveMission("nova:507")];
            const result = scanCheck(state(), env, "nova:302", cargo, missions);
            expect(result.reason).toEqual("mission");
        });

    it("fines nothing for a ScanFine-0 (warning-only) government", () => {
        const env0 = makeEnv({
            government: id => id === "nova:128" ? makeGovt({ scanFine: 0 }) : null,
        });
        const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
        expect(scanCheck(state(), env0, "nova:302", cargo, []))
            .toEqual({ illegal: true, fine: 0, reason: "junk" });
    });

    it("fines a percentage of cash for a negative ScanFine", () => {
        const envNeg = makeEnv({
            government: id => id === "nova:128" ? makeGovt({ scanFine: -10 }) : null,
        });
        const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
        const result = scanCheck(state(), envNeg, "nova:302", cargo, []);
        expect(result.fine).toEqual(2500); // floor(25000 * 10 / 100)
    });

    it("does not scan a pilot whose record is below -CrimeTol", () => {
        const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
        const pilot = state();
        pilot.legalRecord["nova:128"] = -30; // crimeTol 25
        expect(scanCheck(pilot, env, "nova:302", cargo, [])).toEqual(NO_SCAN);
    });

    it("still scans at exactly -CrimeTol", () => {
        const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
        const pilot = state();
        pilot.legalRecord["nova:128"] = -25;
        expect(scanCheck(pilot, env, "nova:302", cargo, []).illegal).toBeTrue();
    });

    it("does not scan where no government resolves", () => {
        const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
        const missions = [makeActiveMission("nova:507")];
        expect(scanCheck(state(), env, "nova:303", cargo, missions))
            .toEqual(NO_SCAN);
        expect(scanCheck(state(), env, "nova:304", cargo, missions))
            .toEqual(NO_SCAN);
    });
});

describe("smuggledMissions", () => {
    const env = makeEnv();

    it("lists only loaded, mask-overlapping missions", () => {
        const active = [
            makeActiveMission("nova:507"),
            makeActiveMission("nova:507", false),
            makeActiveMission("nova:508"),
        ];
        expect(smuggledMissions(env, GOVT, active).map(v => v.mission.id))
            .toEqual(["nova:507"]);
    });
});

describe("scanFine", () => {
    it("is flat for positive ScanFine", () => {
        expect(scanFine(GOVT, 25000)).toEqual(500);
    });

    it("is zero for ScanFine 0 (warning only)", () => {
        expect(scanFine(makeGovt({ scanFine: 0 }), 25000)).toEqual(0);
    });

    it("floors the percentage and never goes negative", () => {
        expect(scanFine(makeGovt({ scanFine: -10 }), 25000)).toEqual(2500);
        expect(scanFine(makeGovt({ scanFine: -10 }), 5)).toEqual(0);
        expect(scanFine(makeGovt({ scanFine: -10 }), -100)).toEqual(0);
    });
});
