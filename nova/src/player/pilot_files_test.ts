import "jasmine";
import { CharData, getDefaultCharData } from "novadatainterface/CharData";
import {
    ControlBits,
    NUM_CONTROL_BITS,
    PlayerState,
} from "./player_state";
import {
    createNewPilot,
    deserializePlayerState,
    makeRng,
    serializePlayerState,
} from "./pilot_files";


function makeCharData(overrides: Partial<CharData> = {}): CharData {
    return {
        ...getDefaultCharData(),
        id: "nova:128",
        name: ".Trader",
        startCash: 25000,
        startShipType: "nova:128",
        startSystems: ["nova:128", "nova:136", "nova:170", "nova:184"],
        startGovts: [null, null, null, null],
        startStatus: [-1, -1, -1, -1],
        startKills: 0,
        onStart: "",
        startDate: { day: 23, month: 6, year: 1177 },
        ...overrides,
    };
}

// A full state exercising every field of the file schema.
function makePilotState(): PlayerState {
    const state = createNewPilot(makeCharData({ startGovts: ["nova:128"] }), 42);
    state.playerName = "Kestrel";
    state.nickName = "Kes";
    state.gender = "female";
    state.credits = 12345;
    state.date = { day: 1, month: 2, year: 1178 };
    const bits = new ControlBits(state.bits);
    bits.set(0, true);
    bits.set(9999, true);
    bits.set(500, true);
    bits.set(501, false);
    state.exploredSystems = ["nova:128", "nova:136"];
    state.landedSystems = ["nova:128"];
    state.legalRecord["nova:128"] = -30;
    state.dominatedStellars = ["nova:130:2"];
    state.destroyedStellars = ["nova:429:1"];
    state.combatRating = 12;
    state.activeRanks = ["nova:128"];
    state.lastActivatedRank = "nova:128";
    state.activeMissions = [{
        missionId: "nova:128",
        originStellar: "nova:130:1",
        travelStellar: "nova:128:1",
        returnStellar: "nova:130:1",
        travelComplete: true,
        shipGoalComplete: false,
        failed: false,
        cargoLoaded: true,
        cargo: { type: 3, qty: 4 },
        deadline: { day: 30, month: 6, year: 1177 },
        specialShips: {
            remaining: 2,
            killed: 1,
            boarded: 0,
            disabled: 1,
            jumpedIn: 3,
            jumpedOut: 1,
            initial: 3,
            pinnedTypes: ["nova:196"],
        },
        auxShips: { remaining: 4, jumpedIn: 2 },
    }, {
        missionId: "nova:129",
        originStellar: "nova:130:1",
        travelStellar: null,
        returnStellar: null,
        travelComplete: false,
        shipGoalComplete: false,
        failed: false,
        cargoLoaded: false,
        cargo: null,
        deadline: null,
        specialShips: null,
        auxShips: null,
    }];
    state.completedMissions = ["nova:128"];
    state.failedMissions = [];
    state.availRandomRolls = { "nova:130": 7, "nova:428": 99 };
    state.rngSeed = 1234;
    state.currentSystem = "nova:136";
    state.lastStellar = "nova:130:1";
    state.shipSnapshot = {
        components: [["Ship", { id: "nova:128" }]],
        name: "Kestrel's Ship",
    };
    state.cargo = [{ type: 0, qty: 12 }, { type: 137, qty: 1 }];
    return state;
}


describe("pilot files", function() {
    it("round-trips a state through JSON unchanged", function() {
        const state = makePilotState();
        const file = JSON.parse(JSON.stringify(serializePlayerState(state)));
        const revived = deserializePlayerState(file);

        // Bits survive as the same 10,000 bytes.
        expect(revived.bits).toEqual(state.bits);
        expect(revived.bits.length).toEqual(NUM_CONTROL_BITS);
        // ...and the re-serialized canonical forms are byte-identical.
        expect(JSON.stringify(serializePlayerState(revived)))
            .toEqual(JSON.stringify(serializePlayerState(state)));
        // Check the non-bit fields via toEqual on a bits-stripped copy.
        const { bits: _stripped, ...rest } = revived;
        const { bits: _original, ...restOriginal } = state;
        expect(rest).toEqual(restOriginal);
    });

    it("serializes bits as base64", function() {
        const state = makePilotState();
        const file = serializePlayerState(state) as { bits: unknown };
        expect(typeof file.bits).toEqual("string");
        // A state with only bits 0, 500, 9999 set has 3 set bytes.
        const decoded = ControlBits.fromBase64(file.bits as string);
        expect(decoded.get(0)).toBeTrue();
        expect(decoded.get(500)).toBeTrue();
        expect(decoded.get(9999)).toBeTrue();
        expect(decoded.get(501)).toBeFalse();
    });

    it("rejects invalid pilot files", function() {
        expect(function() { deserializePlayerState({ version: 2 }); }).toThrowError();
        expect(function() {
            deserializePlayerState({ ...serializePlayerState(makePilotState()), credits: "many" });
        }).toThrowError(/credits/);
        expect(function() {
            deserializePlayerState({
                ...serializePlayerState(makePilotState()),
                bits: "not base64!!!",
            });
        }).toThrowError();
    });

    it("normalizes a pre-cargo pilot file to an empty hold", function() {
        // Pilot files written before PlayerState.cargo existed carry no
        // cargo key; they load as an empty hold.
        const file = serializePlayerState(makePilotState()) as { cargo?: unknown };
        delete file.cargo;
        const revived = deserializePlayerState(JSON.parse(JSON.stringify(file)));
        expect(revived.cargo).toEqual([]);
        // A null hold (hand-edited file) normalizes the same way.
        const nulled = deserializePlayerState({
            ...JSON.parse(JSON.stringify(serializePlayerState(makePilotState()))),
            cargo: null,
        });
        expect(nulled.cargo).toEqual([]);
    });
});

describe("createNewPilot", function() {
    it("starts the pilot with an empty cargo hold", function() {
        expect(createNewPilot(makeCharData(), 6).cargo).toEqual([]);
    });

    it("applies the chär's start cash, kills, date, and ship", function() {
        const state = createNewPilot(makeCharData({
            startCash: 25000,
            startKills: 7,
        }), 1);
        expect(state.version).toEqual(1);
        expect(state.credits).toEqual(25000);
        expect(state.combatRating).toEqual(7);
        expect(state.date).toEqual({ day: 23, month: 6, year: 1177 });
        // A seeded pick from the chär's start systems...
        const options = ["nova:128", "nova:136", "nova:170", "nova:184"];
        const startSystem = options[Math.floor(makeRng(1)() * options.length)];
        expect(state.currentSystem).toEqual(startSystem);
        // ...which counts as explored.
        expect(state.exploredSystems).toEqual([startSystem]);
    });

    it("picks a seeded random start system", function() {
        const charData = makeCharData();
        // The pick must follow the seeded rng and be reproducible.
        const options = charData.startSystems.filter((s): s is string => s !== null);
        const expected = options[Math.floor(makeRng(42)() * options.length)];
        expect(createNewPilot(charData, 42).currentSystem).toEqual(expected);
        // Two pilots with the same seed start in the same system.
        expect(createNewPilot(charData, 42).currentSystem)
            .toEqual(createNewPilot(charData, 42).currentSystem);
    });

    it("falls back to system nova:128 with no start systems", function() {
        const state = createNewPilot(makeCharData({
            startSystems: [null, null, null, null],
        }), 3);
        expect(state.currentSystem).toEqual("nova:128");
    });

    it("records initial legal status for the chär's governments", function() {
        const state = createNewPilot(makeCharData({
            startGovts: ["nova:128", null, "nova:132", null],
            startStatus: [-30, -1, 0, 5],
        }), 4);
        expect(state.legalRecord).toEqual({ "nova:128": -30, "nova:132": 0 });
    });

    it("evaluates the chär's OnStart set expression", function() {
        const state = createNewPilot(makeCharData({
            onStart: "b0 b350 !b5 ^b6 R(b10 b11)",
        }), 5);
        const bits = new ControlBits(state.bits);
        expect(bits.get(0)).toBeTrue();
        expect(bits.get(350)).toBeTrue();
        expect(bits.get(5)).toBeFalse();
        expect(bits.get(6)).toBeTrue(); // toggled from clear to set
        // R() picked deterministically from the seed's second stream.
        const expectedBranch = makeRng(5 ^ 0x9E3779B9)() < 0.5 ? 10 : 11;
        expect(bits.get(expectedBranch)).toBeTrue();
        expect(bits.get(expectedBranch === 10 ? 11 : 10)).toBeFalse();
    });

    it("is reproducible given the same chär and seed", function() {
        const charData = makeCharData({ onStart: "b0 ^b1 R(b2 b3)" });
        const a = JSON.stringify(serializePlayerState(createNewPilot(charData, 99)));
        const b = JSON.stringify(serializePlayerState(createNewPilot(charData, 99)));
        expect(a).toEqual(b);
    });
});
