// Headless specs for the in-flight scan rules (player/smuggling.ts):
// the junk/mission illegality masks and the ScanFine flat/warning/
// percentage bands (quantized to 100s, 1-credit floor). The binary's
// FUN_00401800 has no record gate and no planetary trigger — the scanning
// government comes straight from the hailing ship, so there is nothing to
// resolve here. Run with:
//   npx esbuild --bundle --platform=node nova/src/player/smuggling_test.ts \
//       --outfile=/tmp/sc.js && node_modules/.bin/jasmine /tmp/sc.js

import "jasmine";
import { getDefaultMissionData, MissionData } from "novadatainterface/MissionData";
import { getDefaultGovernmentData, GovernmentData } from "novadatainterface/GovernmentData";
import { getDefaultJunkData, JunkData } from "novadatainterface/JunkData";
import { CargoEntry } from "./cargo";
import { ActiveMission } from "./player_state";
import {
    scanCheck,
    scanFine,
    smuggledMissions,
    SmugglingEnv,
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

function makeJunk(rawId: number, scanMask: number): [number, JunkData] {
    return [rawId, { ...getDefaultJunkData(), id: `nova:${rawId}`, scanMask }];
}
const JUNKS = new Map<number, JunkData>([
    makeJunk(900, 0x8000),
    makeJunk(901, 0x0400),
]);

function makeSmugglerMission(rawId: number, scanMask: number,
    flags = 0x0020): MissionData {
    return { ...getDefaultMissionData(), id: `nova:${rawId}`, scanMask, flags };
}
const SMUGGLER_MISSION = makeSmugglerMission(507, 0x8000);
const QUIET_MISSION = makeSmugglerMission(508, 0x0400);
const MISSIONS = new Map<number, MissionData>([
    [507, SMUGGLER_MISSION],
    [508, QUIET_MISSION],
]);

// env over the fixtures (SmugglingEnv shape; junk masks from JUNKS).
function makeEnv(overrides: Partial<SmugglingEnv> = {}): SmugglingEnv {
    return {
        government: id => id === null ? null
            : id === GOVT.id ? GOVT : null,
        missionByRawId: rawId => MISSIONS.get(rawId) ?? null,
        junk: rawId => JUNKS.get(rawId),
        ...overrides,
    };
}

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
const CREDITS = 25000;


describe("scanCheck", () => {
    const env = makeEnv();

    it("passes a clean hold with no missions", () => {
        expect(scanCheck(env, GOVT, [], [], CREDITS)).toEqual(NO_SCAN);
    });

    it("flags jünk whose scan mask overlaps the government's", () => {
        const cargo: CargoEntry[] = [{ type: 900, qty: 5 }];
        expect(scanCheck(env, GOVT, cargo, [], CREDITS))
            .toEqual({ illegal: true, fine: 500, reason: "junk" });
    });

    it("misses jünk whose scan mask does not overlap", () => {
        const cargo: CargoEntry[] = [{ type: 901, qty: 5 }];
        expect(scanCheck(env, GOVT, cargo, [], CREDITS)).toEqual(NO_SCAN);
    });

    it("never flags standard commodities", () => {
        const cargo: CargoEntry[] = [{ type: 0, qty: 30 }, { type: 5, qty: 2 }];
        expect(scanCheck(env, GOVT, cargo, [], CREDITS)).toEqual(NO_SCAN);
    });

    it("flags loaded mission cargo whose mïsn mask overlaps", () => {
        const missions = [makeActiveMission("nova:507")];
        expect(scanCheck(env, GOVT, [], missions, CREDITS))
            .toEqual({ illegal: true, fine: 500, reason: "mission" });
    });

    it("ignores mission cargo not yet loaded into the hold", () => {
        const missions = [makeActiveMission("nova:507", false)];
        expect(scanCheck(env, GOVT, [], missions, CREDITS)).toEqual(NO_SCAN);
    });

    it("ignores missions whose scan mask does not overlap", () => {
        const missions = [makeActiveMission("nova:508")];
        expect(scanCheck(env, GOVT, [], missions, CREDITS)).toEqual(NO_SCAN);
    });

    it("reports mission reason when junk and mission cargo are both illegal",
        () => {
            const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
            const missions = [makeActiveMission("nova:507")];
            const result = scanCheck(env, GOVT, cargo, missions, CREDITS);
            expect(result.reason).toEqual("mission");
        });

    it("fines nothing for a ScanFine-0 (warning-only) government", () => {
        const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
        expect(scanCheck(env, makeGovt({ scanFine: 0 }), cargo, [], CREDITS))
            .toEqual({ illegal: true, fine: 0, reason: "junk" });
    });

    it("scans a pilot the government already considers criminal (no record "
        + "gate in FUN_00401800)", () => {
            // The port's old -CrimeTol gate was invented: the binary's scan
            // never reads CrimeTol, so legality is not consulted at all —
            // there is no record in the pure rules' inputs.
            const cargo: CargoEntry[] = [{ type: 900, qty: 1 }];
            expect(scanCheck(env, GOVT, cargo, [], CREDITS).illegal)
                .toBeTrue();
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
        expect(scanFine(GOVT, CREDITS)).toEqual(500);
    });

    it("is zero for ScanFine 0 (warning only)", () => {
        expect(scanFine(makeGovt({ scanFine: 0 }), CREDITS)).toEqual(0);
    });

    it("rounds the percentage to whole hundreds", () => {
        // FUN_00401800: round_half_away(credits × -scanFine × 0.0001) × 100.
        expect(scanFine(makeGovt({ scanFine: -10 }), CREDITS))
            .toEqual(2500); // round(25.0) * 100
        expect(scanFine(makeGovt({ scanFine: -7 }), 25050))
            .toEqual(1800); // round(17.535) * 100, not floor(1753)
        expect(scanFine(makeGovt({ scanFine: -10 }), 25050))
            .toEqual(2500); // round(25.05) * 100
    });

    it("floors the percentage at 1 credit", () => {
        expect(scanFine(makeGovt({ scanFine: -10 }), 5)).toEqual(1);
        expect(scanFine(makeGovt({ scanFine: -10 }), 0)).toEqual(1);
    });
});
