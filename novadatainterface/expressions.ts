// Nova control bit (ncb) expression engine: parses and evaluates the test and
// set expressions stored in mïsn resources (AvailBits, onAccept, ...).
// Pure TypeScript — no ECS, PIXI, or node imports — so client and server code
// can both use it. Syntax reference: Nova Bible, "Test expressions" (bN, PN,
// G, Oxxx, Exxx, |, &, !, parens) and "Set expressions" (bN, !bN, ^bN, R(..),
// A/F/S/G/D/M/N/C/E/H/K/L/P/Y/U/Qxxx).
//
// Robustness contract: stock data is known-good, but malformed input must
// never throw at runtime. Test-expression parse errors degrade to an AST that
// evaluates true; set-expression errors degrade to skipped tokens. Both
// surface the problem through an injected warning callback.

export type Warn = (message: string) => void;


// --- Control bits ---

export interface ReadOnlyBits {
    get(bit: number): boolean;
}

export interface ControlBits extends ReadOnlyBits {
    set(bit: number, value: boolean): void;
}


// --- Test expressions ---

// Plain-JSON AST so parse results can be cached on MissionData (parse once at
// accept/offer time, not per frame).
export type TestNode =
    | { kind: "and"; children: TestNode[] }
    | { kind: "or"; children: TestNode[] }
    | { kind: "not"; child: TestNode }
    | { kind: "bit"; bit: number }
    | { kind: "paid"; days: number }
    | { kind: "gender" }
    | { kind: "outfit"; rawId: number }
    | { kind: "explored"; rawId: number };

export interface TestContext {
    // Test expressions only read bits, but a full ControlBits works too.
    bits: ReadOnlyBits;
    // 1 male, 0 female (the G operator).
    gender: 0 | 1;
    // Whether the player owns at least one of outfit raw id xxx, including
    // outfits granted by deployed fighters' ammo. Oxxx/Exxx operate on raw
    // ids; an unknown raw id should warn (via this object's own warn callback)
    // and return false.
    hasOutfit(rawId: number): boolean;
    exploredSystem(rawId: number): boolean;
    // Pxxx is true if the game is registered, or if it is unregistered and
    // fewer than xxx days have elapsed. Undefined means registered (or
    // registration state unknown), so every Pxxx evaluates true.
    registeredDays?: number;
}

// A blank test expression evaluates true (Nova Bible). An empty conjunction is
// vacuously true, so it doubles as the "true" AST returned on parse errors.
export function parseTest(expr: string, warn: Warn = console.warn): TestNode {
    var { tokens, error, notices } = tokenizeTest(expr);
    if (error !== null) {
        warn(error);
        return { kind: "and", children: [] };
    }
    // Non-fatal data quirks (bare numbers) are reported but still parsed.
    for (var notice of notices) {
        warn(notice);
    }
    if (tokens.length === 0) {
        // Blank: true, with no warning.
        return { kind: "and", children: [] };
    }
    try {
        var parser = new TestParser(tokens, expr);
        var node = parser.parseOr();
        var leftover = parser.finish();
        if (leftover !== null) {
            warn(leftover);
            return { kind: "and", children: [] };
        }
        return node;
    }
    catch (e) {
        if (e instanceof TestParseError) {
            warn(e.message);
            return { kind: "and", children: [] };
        }
        throw e;
    }
}

export function evaluateTest(node: TestNode, ctx: TestContext): boolean {
    switch (node.kind) {
        case "and":
            return node.children.every(function(child) { return evaluateTest(child, ctx); });
        case "or":
            return node.children.some(function(child) { return evaluateTest(child, ctx); });
        case "not":
            return !evaluateTest(node.child, ctx);
        case "bit":
            return ctx.bits.get(node.bit);
        case "paid":
            return ctx.registeredDays === undefined || ctx.registeredDays < node.days;
        case "gender":
            return ctx.gender === 1;
        case "outfit":
            return ctx.hasOutfit(node.rawId);
        case "explored":
            return ctx.exploredSystem(node.rawId);
    }
}


type TestTokenType = "lparen" | "rparen" | "and" | "or" | "not"
    | "bit" | "paid" | "gender" | "outfit" | "explored";

interface TestToken {
    type: TestTokenType;
    // Bit number / days / raw id, for the value-carrying types.
    value?: number;
    pos: number;
}

// Case-insensitive; prefixes may run together with digits ("B42") or not
// (whitespace is skipped between tokens). Notices are non-fatal data quirks
// that are parsed with an assumed meaning (see the bare-number case).
function tokenizeTest(expr: string):
    { tokens: TestToken[], error: string | null, notices: Array<string> } {
    const tokens: TestToken[] = [];
    const notices: Array<string> = [];
    var i = 0;
    while (i < expr.length) {
        var c = expr[i];
        if (/\s/.test(c)) {
            i += 1;
            continue;
        }
        var pos = i;
        var lower = c.toLowerCase();
        if (c === "(") {
            tokens.push({ type: "lparen", pos });
            i += 1;
        }
        else if (c === ")") {
            tokens.push({ type: "rparen", pos });
            i += 1;
        }
        else if (c === "&") {
            tokens.push({ type: "and", pos });
            i += 1;
        }
        else if (c === "|") {
            tokens.push({ type: "or", pos });
            i += 1;
        }
        else if (c === "!") {
            tokens.push({ type: "not", pos });
            i += 1;
        }
        else if (lower === "b" || lower === "p" || lower === "o" || lower === "e") {
            var type: TestTokenType =
                lower === "b" ? "bit" :
                lower === "p" ? "paid" :
                lower === "o" ? "outfit" : "explored";
            var num = readDigits(expr, i + 1);
            if (num === null) {
                return {
                    tokens,
                    error: "Expected digits after '" + c + "' at position " + i
                        + " in test expression \"" + expr + "\"",
                    notices,
                };
            }
            tokens.push({ type, value: num.value, pos });
            i = num.end;
        }
        else if (lower === "g") {
            // G takes no operand, but tolerate stray digits after it.
            tokens.push({ type: "gender", pos });
            var trailing = readDigits(expr, i + 1);
            i = trailing === null ? i + 1 : trailing.end;
        }
        else if (c >= "0" && c <= "9") {
            // Bare number: stock data has one ("b50 | 467" — missing 'b'
            // prefix). Read it as a bit reference rather than degrading the
            // whole expression to true.
            var bare = readDigits(expr, i);
            notices.push("Bare number " + bare!.value + " at position " + i
                + " in test expression \"" + expr + "\"; interpreted as b"
                + bare!.value);
            tokens.push({ type: "bit", value: bare!.value, pos });
            i = bare!.end;
        }
        else {
            return {
                tokens,
                error: "Unexpected character '" + c + "' at position " + i
                    + " in test expression \"" + expr + "\"",
                notices,
            };
        }
    }
    return { tokens, error: null, notices };
}

// Recursive descent with precedence ! > & > |. The original evaluator was
// primitive about unparenthesized mixes and stock data always parenthesizes,
// so any consistent grouping is fine; this one is left-associative and folds
// runs of the same operator into one n-ary node.
class TestParser {
    private index = 0;

    constructor(private tokens: TestToken[], private expr: string) { }

    parseOr(): TestNode {
        var children = [this.parseAnd()];
        while (this.peek()?.type === "or") {
            this.index += 1;
            children.push(this.parseAnd());
        }
        return children.length === 1 ? children[0] : { kind: "or", children };
    }

    parseAnd(): TestNode {
        var children = [this.parseNot()];
        while (this.peek()?.type === "and") {
            this.index += 1;
            children.push(this.parseNot());
        }
        return children.length === 1 ? children[0] : { kind: "and", children };
    }

    parseNot(): TestNode {
        if (this.peek()?.type === "not") {
            this.index += 1;
            return { kind: "not", child: this.parseNot() };
        }
        return this.parseAtom();
    }

    parseAtom(): TestNode {
        var token = this.peek();
        if (token === undefined) {
            return this.fail(this.expr.length, "expected an operand");
        }
        this.index += 1;
        switch (token.type) {
            case "lparen": {
                var inner = this.parseOr();
                if (this.peek()?.type !== "rparen") {
                    return this.fail(token.pos, "unclosed '('");
                }
                this.index += 1;
                return inner;
            }
            case "rparen":
                return this.fail(token.pos, "unexpected ')'");
            case "and":
            case "or":
            case "not":
                return this.fail(token.pos, "operator where an operand was expected");
            case "bit":
                return { kind: "bit", bit: token.value! };
            case "paid":
                return { kind: "paid", days: token.value! };
            case "gender":
                return { kind: "gender" };
            case "outfit":
                return { kind: "outfit", rawId: token.value! };
            case "explored":
                return { kind: "explored", rawId: token.value! };
        }
    }

    // Returns an error message if tokens remain unconsumed (e.g. "b1 b2"),
    // null on success.
    finish(): string | null {
        var token = this.peek();
        if (token !== undefined) {
            return "Unexpected token at position " + token.pos
                + " in test expression \"" + this.expr + "\"";
        }
        return null;
    }

    private peek(): TestToken | undefined {
        return this.tokens[this.index];
    }

    // parseTest catches this and applies the warn-and-true contract.
    private fail(pos: number, problem: string): TestNode {
        throw new TestParseError("Unexpected " + problem + " at position " + pos
            + " in test expression \"" + this.expr + "\"");
    }
}

class TestParseError extends Error { }


// --- Set expressions ---

export type SetToken =
    | { type: "setBit"; bit: number }
    | { type: "clearBit"; bit: number }
    | { type: "toggleBit"; bit: number }
    // R(op1 op2): execute exactly one branch, chosen by the injected rng.
    | { type: "random"; branches: [SetToken, SetToken] }
    // Any letter + number; documented letters are executed by executeSet,
    // unknown ones (e.g. stock data's lowercase k) are lenient no-ops.
    | { type: "letterOp"; letter: string; num: number };

// Letter ops are case-sensitive: stock data uses lowercase k as a distinct,
// undocumented op, so folding case would misexecute it. b/B for bits is
// accepted in either case.
export function tokenizeSet(expr: string, warn: Warn = console.warn): SetToken[] {
    const tokens: SetToken[] = [];
    var i = 0;
    while (i < expr.length) {
        var c = expr[i];
        if (/\s/.test(c)) {
            i += 1;
            continue;
        }
        var lower = c.toLowerCase();
        if (c === "!" || c === "^") {
            var bit = readBitsPrefix(expr, i + 1);
            if (bit === null) {
                warn("Expected 'b' and digits after '" + c + "' at position " + i
                    + " in set expression \"" + expr + "\"");
                i += 1;
                continue;
            }
            tokens.push({
                type: c === "!" ? "clearBit" : "toggleBit",
                bit: bit.value,
            });
            i = bit.end;
        }
        else if (lower === "b") {
            var num = readDigits(expr, i + 1);
            if (num === null) {
                warn("Expected digits after '" + c + "' at position " + i
                    + " in set expression \"" + expr + "\"");
                i += 1;
                continue;
            }
            tokens.push({ type: "setBit", bit: num.value });
            i = num.end;
        }
        else if (c === "R") {
            var random = readRandom(expr, i, warn);
            // On failure readRandom still reports where to resume.
            i = random.end;
            if (random.token !== null) {
                tokens.push(random.token);
            }
        }
        else if (c === "(" || c === ")") {
            warn("Unexpected '" + c + "' at position " + i
                + " in set expression \"" + expr + "\" (parentheses are only valid after R)");
            i += 1;
        }
        else if (/[a-z]/i.test(c)) {
            var operand = readDigits(expr, i + 1);
            if (operand === null) {
                warn("Expected digits after '" + c + "' at position " + i
                    + " in set expression \"" + expr + "\"");
                i += 1;
                continue;
            }
            tokens.push({ type: "letterOp", letter: c, num: operand.value });
            i = operand.end;
        }
        else {
            warn("Unexpected character '" + c + "' at position " + i
                + " in set expression \"" + expr + "\"");
            i += 1;
        }
    }
    return tokens;
}

export interface SetContext {
    bits: ControlBits;
    abortMission(rawId: number): void;
    failMission(rawId: number): void;
    startMission(rawId: number): void;
    grantOutfit(rawId: number, delta: 1 | -1): void;
    movePlayer(rawSystemId: number, mode: "onStellar" | "sameXY"): void;
    changeShip(rawShipId: number, mode: "keepNoDefaults" | "keepAll" | "defaultsOnly"): void;
    activateRank(rawId: number): void;
    deactivateRank(rawId: number): void;
    playSound(rawId: number): void;
    destroyStellar(rawId: number): void;
    regenerateStellar(rawId: number): void;
    // Q: leave the current stellar and show a random message from STR# xxx.
    leaveStellar(strSetRawId: number): void;
}

export interface SetResult {
    warnings: string[];
    // Raw ids of missions started via the S operator (R branches included).
    startedMissions: number[];
}

// A blank set expression is a no-op. R(a b) uses the injected rng, which must
// return numbers in [0, 1); pass a seeded rng for deterministic replays.
export function executeSet(expr: string, ctx: SetContext, rng: () => number,
    warn: Warn = console.warn): SetResult {
    var result: SetResult = { warnings: [], startedMissions: [] };
    // Warnings both land in the result (structured) and reach the callback
    // (immediate logging), mirroring how parseTest reports problems.
    var addWarning = function(message: string) {
        result.warnings.push(message);
        warn(message);
    };

    function execute(token: SetToken) {
        switch (token.type) {
            case "setBit":
                ctx.bits.set(token.bit, true);
                break;
            case "clearBit":
                ctx.bits.set(token.bit, false);
                break;
            case "toggleBit":
                ctx.bits.set(token.bit, !ctx.bits.get(token.bit));
                break;
            case "random": {
                var branch = rng() < 0.5 ? token.branches[0] : token.branches[1];
                execute(branch);
                break;
            }
            case "letterOp":
                executeLetterOp(token, addWarning, result, ctx);
                break;
        }
    }

    for (var token of tokenizeSet(expr, addWarning)) {
        execute(token);
    }
    return result;
}

// Documented ops (Nova Bible "Set expressions"). T (ship title from STR#) and
// X (make system explored) are documented too but have no SetContext method
// yet, so they fall through to the unsupported case for now. Anything
// unrecognized (e.g. stock data's lowercase k) is a warned no-op, never a
// crash — the tokenizer accepts any letter + digits.
const LETTER_OPS: { [letter: string]: (ctx: SetContext, num: number) => void } = {
    A: function(ctx, num) { ctx.abortMission(num); },
    F: function(ctx, num) { ctx.failMission(num); },
    S: function(ctx, num) { ctx.startMission(num); },
    G: function(ctx, num) { ctx.grantOutfit(num, 1); },
    D: function(ctx, num) { ctx.grantOutfit(num, -1); },
    M: function(ctx, num) { ctx.movePlayer(num, "onStellar"); },
    N: function(ctx, num) { ctx.movePlayer(num, "sameXY"); },
    C: function(ctx, num) { ctx.changeShip(num, "keepNoDefaults"); },
    E: function(ctx, num) { ctx.changeShip(num, "keepAll"); },
    H: function(ctx, num) { ctx.changeShip(num, "defaultsOnly"); },
    K: function(ctx, num) { ctx.activateRank(num); },
    L: function(ctx, num) { ctx.deactivateRank(num); },
    P: function(ctx, num) { ctx.playSound(num); },
    Y: function(ctx, num) { ctx.destroyStellar(num); },
    U: function(ctx, num) { ctx.regenerateStellar(num); },
    Q: function(ctx, num) { ctx.leaveStellar(num); },
};

function executeLetterOp(token: { type: "letterOp"; letter: string; num: number },
    addWarning: (message: string) => void, result: SetResult, ctx: SetContext) {
    var op = LETTER_OPS[token.letter];
    if (op !== undefined) {
        op(ctx, token.num);
        if (token.letter === "S") {
            result.startedMissions.push(token.num);
        }
    }
    else {
        addWarning("Unsupported set expression operator '" + token.letter + token.num
            + "'; ignored");
    }
}


// --- shared lexing helpers ---

// Reads \d+ starting at `start`; returns null if there are no digits there.
function readDigits(expr: string, start: number): { value: number, end: number } | null {
    var end = start;
    while (end < expr.length && expr[end] >= "0" && expr[end] <= "9") {
        end += 1;
    }
    if (end === start) {
        return null;
    }
    return { value: parseInt(expr.slice(start, end), 10), end };
}

function readBitsPrefix(expr: string, start: number): { value: number, end: number } | null {
    if (expr[start]?.toLowerCase() !== "b") {
        return null;
    }
    return readDigits(expr, start + 1);
}

// Parses "R(op1 op2)" starting at the R. Always reports where to resume
// scanning; token is null (after warning) if the group is malformed.
function readRandom(expr: string, start: number,
    warn: Warn): { token: SetToken | null, end: number } {
    var i = start + 1;
    if (expr[i] !== "(") {
        warn("Expected '(' after 'R' at position " + start
            + " in set expression \"" + expr + "\"");
        return { token: null, end: i };
    }
    i = skipSpaces(expr, i + 1);
    var branches: SetToken[] = [];
    while (true) {
        if (i >= expr.length) {
            warn("Unclosed R( group in set expression \"" + expr + "\"");
            return { token: null, end: i };
        }
        if (expr[i] === ")") {
            i += 1;
            break;
        }
        var op = readRandomOperand(expr, i, warn);
        if (op.token === null) {
            // Skip to the end of the malformed group so scanning can resume.
            return { token: null, end: skipGroup(expr, i) };
        }
        branches.push(op.token);
        i = skipSpaces(expr, op.end);
    }
    if (branches.length !== 2) {
        // The Bible only defines R(op1 op2); anything else is skipped whole.
        warn("R() group in set expression \"" + expr
            + "\" must contain exactly two operations; found " + branches.length);
        return { token: null, end: i };
    }
    return { token: { type: "random", branches: [branches[0], branches[1]] }, end: i };
}

function readRandomOperand(expr: string, start: number,
    warn: Warn): { token: SetToken | null, end: number } {
    var c = expr[start];
    var lower = c.toLowerCase();
    if (c === "!" || c === "^") {
        var bit = readBitsPrefix(expr, start + 1);
        if (bit === null) {
            warn("Expected 'b' and digits after '" + c + "' inside R() in set expression \""
                + expr + "\"");
            return { token: null, end: start + 1 };
        }
        return {
            token: { type: c === "!" ? "clearBit" : "toggleBit", bit: bit.value },
            end: bit.end,
        };
    }
    if (lower === "b") {
        var num = readDigits(expr, start + 1);
        if (num === null) {
            warn("Expected digits after '" + c + "' inside R() in set expression \""
                + expr + "\"");
            return { token: null, end: start + 1 };
        }
        return { token: { type: "setBit", bit: num.value }, end: num.end };
    }
    if (c === "R") {
        return readRandom(expr, start, warn);
    }
    if (/[a-z]/i.test(c)) {
        var operand = readDigits(expr, start + 1);
        if (operand === null) {
            warn("Expected digits after '" + c + "' inside R() in set expression \""
                + expr + "\"");
            return { token: null, end: start + 1 };
        }
        return { token: { type: "letterOp", letter: c, num: operand.value }, end: operand.end };
    }
    warn("Unexpected character '" + c + "' inside R() in set expression \"" + expr + "\"");
    return { token: null, end: start + 1 };
}

// Index just past the ')' closing the group whose body starts at `start`, or
// the end of the string if it never closes.
function skipGroup(expr: string, start: number): number {
    var depth = 1;
    var i = start;
    while (i < expr.length) {
        if (expr[i] === "(") {
            depth += 1;
        }
        else if (expr[i] === ")") {
            depth -= 1;
            if (depth === 0) {
                return i + 1;
            }
        }
        i += 1;
    }
    return i;
}

function skipSpaces(expr: string, start: number): number {
    var i = start;
    while (i < expr.length && /\s/.test(expr[i])) {
        i += 1;
    }
    return i;
}
