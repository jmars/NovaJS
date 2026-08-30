import "jasmine";
import { NovaParse } from "novaparse/NovaParse";
import { NovaDataType } from "./NovaDataInterface";
import { MissionData } from "./MissionData";
import {
    ControlBits,
    executeSet,
    evaluateTest,
    parseTest,
    SetContext,
    SetResult,
    SetToken,
    TestContext,
    tokenizeSet,
    Warn,
} from "./expressions";


class MockBits implements ControlBits {
    values: { [bit: number]: boolean } = {};

    get(bit: number): boolean {
        return this.values[bit] === true;
    }

    set(bit: number, value: boolean): void {
        this.values[bit] = value;
    }
}

function makeTestContext(overrides: Partial<TestContext> = {}): TestContext {
    return {
        bits: new MockBits(),
        gender: 1,
        hasOutfit: function(_rawId: number) { return false; },
        exploredSystem: function(_rawId: number) { return false; },
        ...overrides,
    };
}

function makeSetContext(bits: ControlBits = new MockBits()): SetContext {
    return {
        bits,
        abortMission: jasmine.createSpy("abortMission"),
        failMission: jasmine.createSpy("failMission"),
        startMission: jasmine.createSpy("startMission"),
        grantOutfit: jasmine.createSpy("grantOutfit"),
        movePlayer: jasmine.createSpy("movePlayer"),
        changeShip: jasmine.createSpy("changeShip"),
        activateRank: jasmine.createSpy("activateRank"),
        deactivateRank: jasmine.createSpy("deactivateRank"),
        playSound: jasmine.createSpy("playSound"),
        destroyStellar: jasmine.createSpy("destroyStellar"),
        regenerateStellar: jasmine.createSpy("regenerateStellar"),
        leaveStellar: jasmine.createSpy("leaveStellar"),
    };
}

// Parses with a warning collector, then evaluates.
function evalTest(expr: string, ctx: TestContext,
    warnings?: string[]): boolean {
    return evaluateTest(parseTest(expr, collect(warnings)), ctx);
}

// An injected warn callback that records what it is given.
function collect(warnings?: string[]): Warn {
    var sink = warnings === undefined ? [] : warnings;
    return function(message: string) { sink.push(message); };
}

// An rng that walks a fixed script of values.
function scriptedRng(values: number[]): () => number {
    var i = 0;
    return function() { return values[i++ % values.length]; };
}

describe("test expressions", function() {
    it("blank evaluates true", function() {
        var ctx = makeTestContext();
        expect(evalTest("", ctx)).toBeTrue();
        expect(evalTest("   \t ", ctx)).toBeTrue();
    });

    it("parses the Bible examples", function() {
        var bits = new MockBits();
        bits.set(13, true);
        bits.set(15, true);
        var ctx = makeTestContext({ bits });
        expect(evalTest("b13 & (b15 | !b72)", ctx)).toBeTrue();
        bits.set(15, false);
        bits.set(72, true);
        expect(evalTest("b13 & (b15 | !b72)", ctx)).toBeFalse();

        bits.set(103, true);
        // Case-insensitive prefixes and operators.
        expect(evalTest("!(B42 | B53) & b103", ctx)).toBeTrue();
        bits.set(53, true);
        expect(evalTest("!(B42 | B53) & b103", ctx)).toBeFalse();
    });

    it("gives & precedence over |", function() {
        var bits = new MockBits();
        bits.set(1, true);
        bits.set(3, true);
        // and(b1, b2) | b3, not b1 & (b2 | b3): true either way for the left
        // grouping, false for the right one (b2 is off).
        expect(evalTest("b1 & b2 | b3", makeTestContext({ bits }))).toBeTrue();

        var node = parseTest("b1 & b2 | b3");
        expect(node.kind).toBe("or");
        expect((node as any).children[0].kind).toBe("and");
    });

    it("folds runs of the same operator into one node", function() {
        var node = parseTest("b1 & b2 & b3") as any;
        expect(node.kind).toBe("and");
        expect(node.children.length).toBe(3);

        var orNode = parseTest("b1 | b2 | b3 | b4") as any;
        expect(orNode.kind).toBe("or");
        expect(orNode.children.length).toBe(4);
    });

    it("handles nested nots", function() {
        var ctx = makeTestContext();
        expect(evalTest("!b1", ctx)).toBeTrue();
        expect(evalTest("!!b1", ctx)).toBeFalse();
    });

    it("checks payment with the registered-days grace", function() {
        var ctx = makeTestContext();
        // Registered (no day count): always true.
        expect(evalTest("P30", ctx)).toBeTrue();
        // Unregistered, within the grace period.
        expect(evalTest("P30", makeTestContext({ registeredDays: 10 }))).toBeTrue();
        expect(evalTest("P30", makeTestContext({ registeredDays: 30 }))).toBeFalse();
        expect(evalTest("P30", makeTestContext({ registeredDays: 100 }))).toBeFalse();
    });

    it("checks gender", function() {
        expect(evalTest("G", makeTestContext({ gender: 1 }))).toBeTrue();
        expect(evalTest("G", makeTestContext({ gender: 0 }))).toBeFalse();
        expect(evalTest("!G", makeTestContext({ gender: 0 }))).toBeTrue();
    });

    it("passes raw ids to the outfit and explored-system lookups", function() {
        var outfits: Array<number> = [];
        var systems: Array<number> = [];
        var ctx = makeTestContext({
            hasOutfit: function(rawId) { outfits.push(rawId); return rawId === 131; },
            exploredSystem: function(rawId) { systems.push(rawId); return false; },
        });
        expect(evalTest("O131", ctx)).toBeTrue();
        expect(evalTest("O132", ctx)).toBeFalse();
        expect(evalTest("E200", ctx)).toBeFalse();
        expect(outfits).toEqual([131, 132]);
        expect(systems).toEqual([200]);
    });

    it("reads a bare number as a bit reference (nova:428's AvailBits has one)", function() {
        var warnings: Array<string> = [];
        // nova:428 availBits = "!(b511 | b515) & !((b50 | 467) | b6666)" —
        // the stock data is missing the 'b' on 467.
        var node = parseTest("b50 | 467", collect(warnings)) as any;
        expect(node.kind).toBe("or");
        expect(node.children).toEqual([
            { kind: "bit", bit: 50 },
            { kind: "bit", bit: 467 },
        ]);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain("Bare number 467");
    });

    it("produces a plain-JSON AST", function() {
        var node = parseTest("!(b1 | O45) & P30");
        expect(JSON.parse(JSON.stringify(node))).toEqual(node);
    });

    it("treats parse errors as warnings plus true", function() {
        var badExpressions = [
            "b1 &",       // trailing operator
            "((b1)",      // unclosed paren
            "b1 $ b2",    // unknown character
            ") b1",       // unmatched close paren
            "b",          // missing digits
            "b1 b2",      // no operator between operands
            "& b1",       // leading operator
        ];
        for (var expr of badExpressions) {
            var warnings: Array<string> = [];
            var ctx = makeTestContext();
            expect(evalTest(expr, ctx, warnings)).withContext(expr).toBeTrue();
            expect(warnings.length).withContext(expr).toBeGreaterThan(0);
        }
    });

    it("does not warn on well-formed expressions", function() {
        var warnings: Array<string> = [];
        evalTest("b1 & (b2 | !B3) | G & P10 | O4 & E5", makeTestContext(), warnings);
        expect(warnings).toEqual([]);
    });

    it("leaves unknown-id warnings to the context", function() {
        // The TestContext is built (in P3) from raw->global maps; it owns the
        // warn-and-false behavior for ids that are not in the maps.
        var warnings: Array<string> = [];
        var knownOutfits = new Set([131]);
        var ctx = makeTestContext({
            hasOutfit: function(rawId) {
                if (!knownOutfits.has(rawId)) {
                    warnings.push("unknown outfit raw id " + rawId);
                    return false;
                }
                return true;
            },
        });
        // O999 is evaluated first here; a true O131 first would short-circuit
        // the or and never reach it.
        expect(evalTest("O999 | O131", ctx)).toBeTrue();
        expect(warnings).toEqual(["unknown outfit raw id 999"]);
    });
});


describe("set expressions", function() {
    it("blank is a no-op", function() {
        var ctx = makeSetContext();
        var result = executeSet("", ctx, scriptedRng([0]));
        expect(result.warnings).toEqual([]);
        expect(result.startedMissions).toEqual([]);
        expect((ctx.bits as MockBits).values).toEqual({});
        expect(executeSet("  ", ctx, scriptedRng([0])).warnings).toEqual([]);
    });

    it("sets, clears, and toggles bits", function() {
        var bits = new MockBits();
        bits.set(3, true);
        bits.set(4, true);
        executeSet("b1 b2 !b3 ^b4 ^b5", makeSetContext(bits), scriptedRng([0]));
        expect(bits.get(1)).toBeTrue();
        expect(bits.get(2)).toBeTrue();
        expect(bits.get(3)).toBeFalse();
        expect(bits.get(4)).toBeFalse(); // toggled off
        expect(bits.get(5)).toBeTrue();  // toggled on
    });

    it("accepts uppercase B for bits", function() {
        var bits = new MockBits();
        executeSet("B1 !B2 ^B3", makeSetContext(bits), scriptedRng([0]));
        expect(bits.get(1)).toBeTrue();
        expect(bits.get(2)).toBeFalse();
        expect(bits.get(3)).toBeTrue();
    });

    it("dispatches every documented letter op", function() {
        var ctx = makeSetContext();
        executeSet(
            "A1 F2 S3 G4 D5 M6 N7 C8 E9 H10 K11 L12 P13 Y14 U15 Q16",
            ctx, scriptedRng([0]));
        expect(ctx.abortMission).toHaveBeenCalledWith(1);
        expect(ctx.failMission).toHaveBeenCalledWith(2);
        expect(ctx.startMission).toHaveBeenCalledWith(3);
        expect(ctx.grantOutfit).toHaveBeenCalledWith(4, 1);
        expect(ctx.grantOutfit).toHaveBeenCalledWith(5, -1);
        expect(ctx.movePlayer).toHaveBeenCalledWith(6, "onStellar");
        expect(ctx.movePlayer).toHaveBeenCalledWith(7, "sameXY");
        expect(ctx.changeShip).toHaveBeenCalledWith(8, "keepNoDefaults");
        expect(ctx.changeShip).toHaveBeenCalledWith(9, "keepAll");
        expect(ctx.changeShip).toHaveBeenCalledWith(10, "defaultsOnly");
        expect(ctx.activateRank).toHaveBeenCalledWith(11);
        expect(ctx.deactivateRank).toHaveBeenCalledWith(12);
        expect(ctx.playSound).toHaveBeenCalledWith(13);
        expect(ctx.destroyStellar).toHaveBeenCalledWith(14);
        expect(ctx.regenerateStellar).toHaveBeenCalledWith(15);
        expect(ctx.leaveStellar).toHaveBeenCalledWith(16);
        expect(ctx.startMission).toHaveBeenCalledTimes(1);
    });

    it("runs exactly one R() branch, chosen by the rng", function() {
        var first = makeSetContext();
        var second = makeSetContext();
        // rng() < 0.5 takes the first branch: b1 set, b2 untouched.
        executeSet("R(b1 !b2)", first, scriptedRng([0.1]));
        expect((first.bits as MockBits).values).toEqual({ 1: true });
        // rng() >= 0.5 takes the second: b2 cleared, b1 untouched.
        executeSet("R(b1 !b2)", second, scriptedRng([0.9]));
        expect((second.bits as MockBits).values).toEqual({ 2: false });
    });

    it("picks the same branch deterministically under a fixed rng", function() {
        var expr = "b1 R(b2 b3) R(!b4 ^b5)";
        var runs: Array<string> = [];
        for (var run = 0; run < 2; run += 1) {
            var bits = new MockBits();
            executeSet(expr, makeSetContext(bits), scriptedRng([0.7, 0.2]));
            runs.push(JSON.stringify(bits.values));
        }
        expect(runs[0]).toEqual(runs[1]);
        // 0.7 takes b3 over b2; 0.2 takes !b4 over ^b5.
        expect(runs[0]).toEqual(JSON.stringify({ 1: true, 3: true, 4: false }));
    });

    it("records missions started with S, including inside R()", function() {
        var ctx = makeSetContext();
        var result = executeSet("S10 R(S20 S30)", ctx, scriptedRng([0.1]));
        expect(result.startedMissions).toEqual([10, 20]);
    });

    it("executes the stock data's undocumented ops as warned no-ops", function() {
        // m131 onAccept = "k148 A818", m251 onSuccess = "b8339 X130",
        // m320 onAccept = "T25041". Lowercase k must NOT activate a rank.
        var ctx = makeSetContext();
        var result = executeSet("k148 A818", ctx, scriptedRng([0]));
        expect(ctx.activateRank).not.toHaveBeenCalled();
        expect(ctx.abortMission).toHaveBeenCalledWith(818);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain("k148");

        result = executeSet("b8339 X130", ctx, scriptedRng([0]));
        expect((ctx.bits as MockBits).values).toEqual({ 8339: true });
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain("X130");

        result = executeSet("T25041", ctx, scriptedRng([0]));
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain("T25041");
        expect(ctx.leaveStellar).not.toHaveBeenCalled();
    });

    it("degrades on malformed input to warnings, never throws", function() {
        var malformed = [
            "R(b1",        // unclosed R(
            "R()",         // empty R()
            "R(b1 b2 b3)", // three branches
            "Rb1 b2)",     // missing paren
            "!",           // stray prefix
            "b",           // digits missing
            "12",          // bare number
            "(",           // stray paren
            "R b1 b2",     // missing paren after R
        ];
        for (var expr of malformed) {
            var ctx = makeSetContext();
            var warnings: Array<string> = [];
            var result: SetResult;
            expect(function() { result = executeSet(expr, ctx, scriptedRng([0]), collect(warnings)); })
                .withContext(expr).not.toThrow();
            expect(result!.warnings.length).withContext(expr).toBeGreaterThan(0);
        }
    });

    it("tokenizes set expressions for inspection", function() {
        var warnings: Array<string> = [];
        var tokens: Array<SetToken> = tokenizeSet("b1 !b2 ^b3 R(S4 A5)", collect(warnings));
        expect(warnings).toEqual([]);
        expect(tokens).toEqual([
            { type: "setBit", bit: 1 },
            { type: "clearBit", bit: 2 },
            { type: "toggleBit", bit: 3 },
            {
                type: "random",
                branches: [
                    { type: "letterOp", letter: "S", num: 4 },
                    { type: "letterOp", letter: "A", num: 5 },
                ],
            },
        ]);
    });

    it("runs the Bible example", function() {
        var bits = new MockBits();
        executeSet("b1 R(b2 !b3)", makeSetContext(bits), scriptedRng([0.9]));
        // b1 set; the second branch ran, so b3 was cleared, b2 untouched.
        expect(bits.get(1)).toBeTrue();
        expect(bits.get(2)).toBeFalse();
        expect(bits.get(3)).toBeFalse();
    });
});


// The seven raw expression string fields on MissionData.
type ExpressionField = "availBits" | "onAccept" | "onRefuse" | "onSuccess"
    | "onFailure" | "onAbort" | "onShipDone";

const EXPRESSION_FIELDS: Array<ExpressionField> = [
    "availBits", "onAccept", "onRefuse", "onSuccess", "onFailure", "onAbort", "onShipDone",
];

describe("stock mission expression corpus", function() {
    // Path to the real game data. Bazel runfiles can't contain it, so this
    // spec only runs when NOVAJS_DATA_PATH points at a directory that
    // contains a "Nova Files" folder with the Nova Data .rez files.
    var dataPath = process.env['NOVAJS_DATA_PATH'];

    it("tokenizes and parses every mission expression", async function() {
        if (!dataPath) {
            pending("NOVAJS_DATA_PATH is not set; point it at the directory containing 'Nova Files'");
            return;
        }
        var novaParse = new NovaParse(dataPath, false, {
            novaFiles: "Nova Files",
            novaPlugins: "Nova Plug-ins",
        });
        var ids = await novaParse.ids;

        var testWarnings: Array<string> = [];
        var setWarnings: Array<string> = [];
        var expressions = 0;
        for (var missionID of ids.Mission) {
            var mission: MissionData =
                await novaParse.data[NovaDataType.Mission].get(missionID);
            for (var field of EXPRESSION_FIELDS) {
                var expr: string = mission[field];
                expressions += 1;
                if (field === "availBits") {
                    parseTest(expr, collect(testWarnings));
                }
                else {
                    tokenizeSet(expr, collect(setWarnings));
                }
            }
        }

        // Stock test expressions are known-good: nothing may throw (a throw
        // fails this spec), and the only tolerated warning is the bare-number
        // quirk ("b50 | 467" in one mission's AvailBits), which the lexer
        // parses as a bit reference.
        var unexpectedTestWarnings = testWarnings.filter(function(message) {
            return !message.startsWith("Bare number");
        });
        expect(unexpectedTestWarnings).toEqual([]);
        // Set expressions warn by design for the unsupported T/X/k ops, but
        // nothing else may go wrong.
        var unexpectedSetWarnings = setWarnings.filter(function(message) {
            return !message.startsWith("Unsupported set expression operator");
        });
        expect(unexpectedSetWarnings).toEqual([]);

        console.log("Parsed " + expressions + " expressions across "
            + ids.Mission.length + " missions ("
            + testWarnings.length + " test-expression warnings, "
            + setWarnings.length + " set-expression warnings)");
    });
});
