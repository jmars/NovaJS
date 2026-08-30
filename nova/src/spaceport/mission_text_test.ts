// Headless specs for the pure mission text pipeline. Run with:
//   npx esbuild --bundle --platform=node nova/src/spaceport/mission_text_test.ts \
//       --outfile=/tmp/mission_text_test.js && node_modules/.bin/jasmine /tmp/mission_text_test.js
// The final spec is a stock-data corpus run, gated on NOVAJS_DATA_PATH like
// novadatainterface/expressions_test.ts.

import { getDefaultMissionData, MissionData } from "novadatainterface/MissionData";
import { getDefaultRankData, RankData } from "novadatainterface/RankData";
import { getDefaultStringSetData, StringSetData } from "novadatainterface/StringSetData";
import { ActiveMission, PlayerState } from "../player/player_state";
import { expandMissionText, MissionTextContext, MissionTextEnv,
    pickSpecialShipName, CARGO_NAME_STR } from "./mission_text";


const PLANETS = new Map([
    ["nova:128", { id: "nova:128", name: "Earth" }],
    ["nova:408", { id: "nova:408", name: "Vell-os Prime" }],
].map(([id, p]) => [id, p as { id: string, name: string }]));

const SYSTEMS = new Map([
    ["nova:300", { id: "nova:300", name: "Sol" }],
    ["nova:302", { id: "nova:302", name: "K/Tau" }],
].map(([id, s]) => [id, s as { id: string, name: string }]));

const PLANET_TO_SYSTEM = new Map([
    ["nova:128", "nova:300"],
    ["nova:408", "nova:302"],
]);

function makeRank(id: string, govt: string | null, weight: number,
    convName: string, shortName = convName): RankData {
    return { ...getDefaultRankData(), id, govt, weight, convName, shortName };
}

const RANKS = new Map<string, RankData>([
    ["nova:131", makeRank("nova:131", "nova:136", 5, "T5", "T5")],
    ["nova:132", makeRank("nova:132", "nova:128", 10, "Lieutenant", "Lt.")],
    ["nova:133", makeRank("nova:133", "nova:130", 20, "Nil'kemorya", "Nil")],
    // Empty conversational name falls back to "captain".
    ["nova:134", makeRank("nova:134", "nova:141", 30, "")],
]);

const STRING_SETS = new Map<number, StringSetData>([
    [CARGO_NAME_STR, {
        ...getDefaultStringSetData(),
        strings: ["Food", "Metals", "Equipment", "Luxury", "Medicine", "Narcotics",
            "*Passengers"],
    }],
    [250, { ...getDefaultStringSetData(), strings: ["Vell-os Seedship", "Alien Craft"] }],
]);

const TEST_ENV: MissionTextEnv = {
    planet: id => (PLANETS.get(id) as never) ?? null,
    system: id => (SYSTEMS.get(id) as never) ?? null,
    systemOfPlanet: id => PLANET_TO_SYSTEM.get(id) ?? null,
    rank: id => RANKS.get(id) ?? null,
    stringSetByRawId: rawId => STRING_SETS.get(rawId) ?? null,
};

export function makeTestState(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        version: 1,
        playerName: "Ory-Hara",
        nickName: "Sparky",
        gender: "male",
        credits: 100,
        date: { day: 23, month: 6, year: 1177 },
        dayCount: 0,
        bits: new Uint8Array(10_000),
        exploredSystems: [],
        landedSystems: [],
        legalRecord: {},
        dominatedStellars: [],
        destroyedStellars: [],
        combatRating: 0,
        activeRanks: [],
        lastActivatedRank: null,
        activeMissions: [],
        completedMissions: [],
        failedMissions: [],
        availRandomRolls: {},
        rngSeed: 1,
        currentSystem: "nova:300",
        lastStellar: "nova:128",
        shipSnapshot: null,
        cronStates: {},
        pers: {},
        cargo: [],
        fleet: { escorts: [], nextId: 0 },
        ...overrides,
    };
}

export function makeTestActive(overrides: Partial<ActiveMission> = {}): ActiveMission {
    return {
        missionId: "nova:128",
        originStellar: "nova:128",
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
        ...overrides,
    };
}

export function makeTestMission(overrides: Partial<MissionData> = {}): MissionData {
    return { ...getDefaultMissionData(), id: "nova:128", name: "Test Mission", ...overrides };
}

export function makeTextContext(overrides: {
    state?: PlayerState, mission?: MissionData, active?: ActiveMission,
} = {}): MissionTextContext {
    const state = overrides.state ?? makeTestState();
    const mission = overrides.mission ?? makeTestMission();
    const active = overrides.active ?? makeTestActive();
    return {
        state,
        mission,
        active,
        env: TEST_ENV,
        shipName: "Kestrel",
        shipTypeName: "Freighter",
        offeringShipName: "Offering Ship",
        specialShipName: "Special Ship",
    };
}


describe("mission_text wildcards", function() {
    it("resolves destination and return system/stellar names", function() {
        const ctx = makeTextContext({
            active: makeTestActive({
                travelStellar: "nova:408",
                returnStellar: "nova:128",
            }),
        });
        expect(expandMissionText("go to <DSY> / <DST>, back to <RSY> / <RST>", ctx))
            .toBe("go to K/Tau / Vell-os Prime, back to Sol / Earth");
    });

    it("expands destination tags to empty strings without a destination", function() {
        const ctx = makeTextContext();
        expect(expandMissionText("[<DSY>|<DST>|<RSY>|<RST>]", ctx)).toBe("[|||]");
    });

    it("resolves cargo type and quantity", function() {
        const ctx = makeTextContext({
            active: makeTestActive({ cargo: { type: 1, qty: 5 } }),
        });
        expect(expandMissionText("<CQ> tons of <CT>", ctx)).toBe("5 tons of Metals");
    });

    it("strips the '*' prefix of quantityless cargo names", function() {
        const ctx = makeTextContext({
            active: makeTestActive({ cargo: { type: 6, qty: 1 } }),
        });
        expect(expandMissionText("<CT>", ctx)).toBe("Passengers");
    });

    it("expands cargo tags to empty strings without cargo", function() {
        expect(expandMissionText("[<CT>|<CQ>]", makeTextContext())).toBe("[|]");
    });

    it("formats the deadline and expands to empty without one", function() {
        const ctx = makeTextContext({
            active: makeTestActive({ deadline: { day: 30, month: 6, year: 1177 } }),
        });
        expect(expandMissionText("due <DL>", ctx)).toBe("due 30-Jun-1177");
        expect(expandMissionText("due <DL>", makeTextContext())).toBe("due ");
    });

    it("shows the payment for positive pay and up-front prices", function() {
        const positive = makeTextContext({ mission: makeTestMission({ payVal: 15000 }) });
        expect(expandMissionText("pays <PAY>", positive)).toBe("pays 15000");

        // PayVal <= -50000 is an up-front price of 50000 + payVal.
        const price = makeTextContext({ mission: makeTestMission({ payVal: -52000 }) });
        expect(expandMissionText("costs <PAY>", price)).toBe("costs 2000");

        // Record-cleaning bands have no credit amount.
        const record = makeTextContext({ mission: makeTestMission({ payVal: -10128 }) });
        expect(expandMissionText("pays <PAY>", record)).toBe("pays 0");
    });

    it("expands player, ship and special-ship names", function() {
        expect(expandMissionText("<PN>/<PNN>/<PSN>/<PST>/<OSN>/<SN>", makeTextContext()))
            .toBe("Ory-Hara/Sparky/Kestrel/Freighter/Offering Ship/Special Ship");
    });

    it("picks the highest-weight active rank, conversational vs short", function() {
        const ctx = makeTextContext({
            state: makeTestState({
                activeRanks: ["nova:131", "nova:132", "nova:133"],
                lastActivatedRank: "nova:132",
            }),
        });
        // nova:133 (weight 20) outranks the others.
        expect(expandMissionText("<PRK> <SRK>", ctx)).toBe("Nil'kemorya Nil");
        // <RRK> is the most recently activated rank.
        expect(expandMissionText("<RRK>", ctx)).toBe("Lieutenant");
    });

    it("falls back to 'captain' without ranks", function() {
        expect(expandMissionText("<PRK>/<SRK>/<RRK>", makeTextContext()))
            .toBe("captain/captain/captain");
    });

    it("falls back to 'captain' when the rank name is blank", function() {
        const ctx = makeTextContext({
            state: makeTestState({ activeRanks: ["nova:134"] }),
        });
        expect(expandMissionText("<PRK>", ctx)).toBe("captain");
    });

    it("resolves per-government rank tags", function() {
        const ctx = makeTextContext({
            state: makeTestState({
                activeRanks: ["nova:132", "nova:133"],
            }),
        });
        expect(expandMissionText("<PRK128> <SRK128>", ctx)).toBe("Lieutenant Lt.");
        // No Federation rank... nova:133 belongs to govt 130.
        expect(expandMissionText("<PRK130>", ctx)).toBe("Nil'kemorya");
        // Unknown govt: default.
        expect(expandMissionText("<PRK136> <SRK999>", ctx)).toBe("captain captain");
    });

    it("leaves unknown tags in place", function() {
        const text = "a <good> deal <REG> <pty ltd> <dsy> <DSYX> <PRKx>";
        expect(expandMissionText(text, makeTextContext())).toBe(text);
    });
});

describe("mission_text mutable blocks", function() {
    it("substitutes on control bits", function() {
        const set = makeTextContext({ state: makeTestState() });
        set.state.bits[800] = 1;
        expect(expandMissionText("{b800 \"yes\" \"no\"}", set)).toBe("yes");

        const cleared = makeTextContext();
        expect(expandMissionText("{b800 \"yes\" \"no\"}", cleared)).toBe("no");
    });

    it("supports negated bit tests", function() {
        expect(expandMissionText("{!b800 \"a\" \"b\"}", makeTextContext())).toBe("a");
        const set = makeTextContext();
        set.state.bits[800] = 1;
        expect(expandMissionText("{!b800 \"a\" \"b\"}", set)).toBe("b");
    });

    it("substitutes on gender, case-insensitively", function() {
        expect(expandMissionText("{G \"man\" \"woman\"}", makeTextContext())).toBe("man");
        const female = makeTextContext({ state: makeTestState({ gender: "female" }) });
        expect(expandMissionText("{G \"man\" \"woman\"}", female)).toBe("woman");
        expect(expandMissionText("{g\"fella\" \"lass\"}", female)).toBe("lass");
    });

    it("always picks the first string of registration blocks", function() {
        expect(expandMissionText("{P30\"full\" \"REQUIRES YOU TO REGISTER\"}", makeTextContext()))
            .toBe("full");
        expect(expandMissionText("{P \"only\"}", makeTextContext())).toBe("only");
    });

    it("defaults the second string to empty when omitted", function() {
        expect(expandMissionText("x{b800 \" extra\"}", makeTextContext())).toBe("x");
        const set = makeTextContext();
        set.state.bits[800] = 1;
        expect(expandMissionText("x{b800 \" extra\"}", set)).toBe("x extra");
    });

    it("honors \\\" escapes inside block strings", function() {
        const text = "{b800 \"\\\"quoted\\\"\" \"plain\"}";
        expect(expandMissionText(text, makeTextContext())).toBe("plain");
        const set = makeTextContext();
        set.state.bits[800] = 1;
        expect(expandMissionText(text, set)).toBe("\"quoted\"");
    });

    it("tolerates missing whitespace after the block key", function() {
        const set = makeTextContext();
        set.state.bits[800] = 1;
        expect(expandMissionText("{b800\"a\" \"b\"}", set)).toBe("a");
    });

    it("leaves malformed blocks in place", function() {
        const ctx = makeTextContext();
        for (const text of [
            "{b \"a\" \"b\"}",           // bit test without a number
            "{b800 \"unterminated}",     // unterminated string
            "{b800 \"a\" \"b\"",         // missing closing brace
            "{x800 \"a\" \"b\"}",        // unknown block kind
            "{b800a \"a\" \"b\"}",       // junk after the bit number
        ]) {
            expect(expandMissionText("[" + text + "]", ctx)).toBe("[" + text + "]");
        }
    });
});

describe("mission_text passthrough and stock forms", function() {
    it("passes MacRoman high-byte characters through untouched", function() {
        const text = "Mu’Randa haït the Aurörän fëltch — ç’est bon, naïve Køréjé";
        expect(expandMissionText(text, makeTextContext())).toBe(text);
    });

    it("expands a stock-style briefing end to end", function() {
        const ctx = makeTextContext({
            active: makeTestActive({
                travelStellar: "nova:408",
                returnStellar: "nova:128",
                cargo: { type: 0, qty: 20 },
                deadline: { day: 1, month: 7, year: 1177 },
            }),
            mission: makeTestMission({ payVal: 15000 }),
        });
        const brief = "Deliver <CQ> tons of <CT> to <DST> in the <DSY> system by <DL>. "
            + "Payment: <PAY> credits, {G \"sir\" \"madam\"}. "
            + "You will fly your {b800 \"trusted\" \"current\"} <PST>.";
        expect(expandMissionText(brief, ctx)).toBe(
            "Deliver 20 tons of Food to Vell-os Prime in the K/Tau system by 1-Jul-1177. "
            + "Payment: 15000 credits, sir. You will fly your current Freighter.");
    });
});

describe("pickSpecialShipName", function() {
    it("rolls a name from the mission's Ship Name ID STR#", function() {
        const mission = makeTestMission({ shipNameID: 250 });
        expect(pickSpecialShipName(mission, TEST_ENV, () => 0)).toBe("Vell-os Seedship");
        expect(pickSpecialShipName(mission, TEST_ENV, () => 0.999)).toBe("Alien Craft");
    });

    it("is empty for missions without a ship name resource", function() {
        expect(pickSpecialShipName(makeTestMission({ shipNameID: -1 }), TEST_ENV, () => 0))
            .toBe("");
    });
});


// Stock-data corpus: expand every dësc text and require that nothing
// throws and that the mutable blocks are actually consumed. Gated on
// NOVAJS_DATA_PATH (bazel runfiles cannot contain the game data).
describe("stock dësc corpus", function() {
    var dataPath = process.env['NOVAJS_DATA_PATH'];

    it("expands every stock dësc text without throwing", async function() {
        if (!dataPath) {
            pending("NOVAJS_DATA_PATH is not set; point it at the directory containing 'Nova Files'");
            return;
        }
        var NovaParseModule = await import("novaparse/NovaParse");
        var novaParse = new NovaParseModule.NovaParse(dataPath, false, {
            novaFiles: "Nova Files",
            novaPlugins: "Nova Plug-ins",
        });
        var ids = await novaParse.ids;

        var ctx = makeTextContext();
        var expanded = 0;
        var blocksSeen = 0;
        for (var descID of ids.Desc) {
            var desc = await novaParse.data.Desc.get(descID);
            var before = (desc.text.match(/\{/g) ?? []).length;
            var result = expandMissionText(desc.text, ctx);
            expanded += 1;
            // Well-formed blocks are consumed; only malformed leftovers may
            // keep braces, and stock data has none of those.
            var after = (result.match(/\{/g) ?? []).length;
            expect(after).toBeLessThanOrEqual(before);
            blocksSeen += before;
        }
        // Sanity: the corpus actually exercises the block parser.
        expect(blocksSeen).toBeGreaterThan(100);
        console.log("Expanded " + expanded + " stock dësc texts ("
            + blocksSeen + " brace spans)");
    });

    it("expands the stock gender block of dësc 20351", async function() {
        if (!dataPath) {
            pending("NOVAJS_DATA_PATH is not set; point it at the directory containing 'Nova Files'");
            return;
        }
        var NovaParseModule = await import("novaparse/NovaParse");
        var novaParse = new NovaParseModule.NovaParse(dataPath, false, {
            novaFiles: "Nova Files",
            novaPlugins: "Nova Plug-ins",
        });
        var desc = await novaParse.data.Desc.get("nova:20351");
        var result = expandMissionText(desc.text, makeTextContext());
        expect(result).not.toContain("{G");
        expect(result).toContain("resourceful man");
    });
});
