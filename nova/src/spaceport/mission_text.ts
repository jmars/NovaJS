// Pure mission text pipeline: expands the wildcards ("<DSY>", "<CT>", …)
// and mutable blocks ({bXXX "a" "b"} / {G "m" "f"} / {P…}) found in stock
// dësc texts against the current (PlayerState, ActiveMission) before a
// dialog displays them. No PIXI/ECS imports — headless testable; the UI
// menus (briefing.ts, mission_bbs.ts, bar.ts, mission_info.ts) call this
// right before showing text.
//
// Semantics follow the stock data (verified against all 3032 dësc texts):
//   <DSY> <DST>  destination system / stellar name
//   <RSY> <RST>  return system / stellar name
//   <CT> <CQ>    cargo type name / quantity (tons)
//   <DL>         deadline date ("23-Jun-1177")
//   <PAY>        the payment in credits
//   <PN> <PNN>   player name / nickname
//   <PSN> <PST>  player's ship name / ship type name
//   <PRK> <SRK>  highest-weight active rank: conversational / short name
//   <PRKnnn> <SRKnnn>  same, restricted to ranks of government nnn
//   <RRK>        most recently activated rank (conversational name)
//   <OSN>        offering ship name
//   <SN>         special (goal) ship name
//   {bXXX "a" "b"}   "a" if control bit XXX is set, else "b"
//   {!bXXX "a" "b"}  negated bit test
//   {G "m" "f"}      by player gender (lowercase {g…} also occurs)
//   {P "a" "b"} / {Pn "a" "b"}  registration check: novajs is the full
//                    game, so this always picks the first string (stock
//                    data uses {P30…} to gate unregistered copies)
// Strings inside blocks use \" escapes; a missing second string expands
// to the empty string. Anything unparseable is left in place unchanged.

import { MissionData } from "novadatainterface/MissionData";
import { PlanetData } from "novadatainterface/PlanetData";
import { RankData } from "novadatainterface/RankData";
import { StringSetData } from "novadatainterface/StringSetData";
import { SystemData } from "novadatainterface/SystemData";
import { ActiveMission, PlayerState } from "../player/player_state";
import { formatDate } from "../player/date";
import {
    DEFAULT_RANK_NAME,
    highestWeightActiveRank,
    mostRecentRankName,
    rankConvName,
    rankShortName,
    RankEnv,
} from "../player/ranks";

export { DEFAULT_RANK_NAME };

// STR# resource holding the cargo/junk display names, '*' prefix meaning
// "show without a quantity". NOTE: the implementation plan calls this the
// "STR# 7000-range", but stock data keeps these names in STR# 4000 (7000
// holds government greeting strings), so 4000 is what we read.
export const CARGO_NAME_STR = 4000;

// <PRK>/<SRK>/<RRK> resolution lives in player/ranks.ts (with the rest of
// the ränk rules); DEFAULT_RANK_NAME is re-exported above for callers.

// The data lookups the expander needs. All synchronous; the UI glue
// (briefing.ts GameMissionTextEnv) preloads ranks/string sets from the
// async game data before expanding, and tests build one from fixtures.
export interface MissionTextEnv {
    planet(id: string): PlanetData | null;
    system(id: string): SystemData | null;
    systemOfPlanet(id: string): string | null;
    rank(id: string): RankData | null;
    stringSetByRawId(rawId: number): StringSetData | null;
}

export interface MissionTextContext {
    state: PlayerState;
    mission: MissionData;
    // The mission whose destinations/cargo/deadline the tags describe. For
    // offers not yet accepted this is the preview built by
    // previewActiveMission() (mission_state_machine.ts).
    active: ActiveMission;
    env: MissionTextEnv;
    shipName: string;
    shipTypeName: string;
    offeringShipName: string;
    specialShipName: string;
    warn?(message: string): void;
}

export function expandMissionText(text: string, ctx: MissionTextContext): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "<") {
            const close = text.indexOf(">", i + 1);
            // Longest stock tag is "<PRKnnn>" (6 chars between the brackets).
            if (close >= 0 && close - i - 1 <= 6) {
                const replacement = expandTag(text.slice(i + 1, close), ctx);
                if (replacement !== null) {
                    out += replacement;
                    i = close + 1;
                    continue;
                }
            }
        }
        else if (ch === "{") {
            const block = parseMutableBlock(text, i);
            if (block) {
                out += blockValue(block, ctx);
                i = block.end;
                continue;
            }
        }
        // Everything else — including MacRoman high-byte characters and
        // unrecognized <…>/{…} spans — passes through untouched.
        out += ch;
        i += 1;
    }
    return out;
}

function expandTag(tag: string, ctx: MissionTextContext): string | null {
    const match = /^([A-Z]+)([0-9]*)$/.exec(tag);
    if (!match) {
        return null;
    }
    const [, name, digits] = match;
    switch (name) {
        case "DSY": return stellarNames(ctx.active.travelStellar, ctx)[0];
        case "DST": return stellarNames(ctx.active.travelStellar, ctx)[1];
        case "RSY": return stellarNames(ctx.active.returnStellar, ctx)[0];
        case "RST": return stellarNames(ctx.active.returnStellar, ctx)[1];
        case "CT": return cargoName(ctx);
        case "CQ": return ctx.active.cargo === null ? "" : String(ctx.active.cargo.qty);
        case "DL": return ctx.active.deadline === null ? "" : formatDate(ctx.active.deadline);
        case "PAY": return payDisplay(ctx.mission);
        case "PN": return ctx.state.playerName;
        case "PNN": return ctx.state.nickName;
        case "PSN": return ctx.shipName;
        case "PST": return ctx.shipTypeName;
        case "OSN": return ctx.offeringShipName;
        case "SN": return ctx.specialShipName;
        case "RRK": return recentRankName(ctx);
        case "PRK": case "SRK": {
            const field: "convName" | "shortName" = name === "PRK" ? "convName" : "shortName";
            // <PRKnnn>/<SRKnnn> restrict to ranks of government nnn.
            const govtRawId = digits === "" ? undefined : parseInt(digits, 10);
            return rankName(ctx, govtRawId, field);
        }
        default:
            return null; // unknown tag: leave the literal text in place
    }
}

// [system name, stellar name] for a resolved destination stellar id;
// ["", ""] when the mission has no destination there (or data is missing).
function stellarNames(stellarId: string | null, ctx: MissionTextContext): [string, string] {
    if (stellarId === null) {
        return ["", ""];
    }
    const planet = ctx.env.planet(stellarId);
    if (!planet) {
        return ["", ""];
    }
    const systemId = ctx.env.systemOfPlanet(stellarId);
    const system = systemId === null ? null : ctx.env.system(systemId);
    return [system?.name ?? "", planet.name];
}

function cargoName(ctx: MissionTextContext): string {
    const cargo = ctx.active.cargo;
    if (cargo === null) {
        return "";
    }
    const strings = ctx.env.stringSetByRawId(CARGO_NAME_STR)?.strings ?? [];
    // '*' prefix: a quantityless passenger/person cargo — the name itself
    // is what <CT> shows either way.
    return (strings[cargo.type] ?? "").replace(/^\*/, "");
}

// Payments display as their credit value; the up-front price band
// (PayVal <= -50000, see applyPay in mission_state_machine.ts) shows the
// price, and the record/percentage bands have no sensible credit amount.
function payDisplay(mission: MissionData): string {
    if (mission.payVal > 0) {
        return String(mission.payVal);
    }
    if (mission.payVal <= -50000) {
        return String(-(mission.payVal + 50000));
    }
    return "0";
}

// Highest-weight active rank (optionally of one government), conversational
// or short name; defaults to "captain" with no ranks. The resolution itself
// lives in player/ranks.ts.
function rankName(ctx: MissionTextContext, govtRawId: number | undefined,
    field: "convName" | "shortName"): string {
    const rankEnv: RankEnv = { rank: id => ctx.env.rank(id) };
    const rank = highestWeightActiveRank(ctx.state, rankEnv, govtRawId);
    return field === "convName" ? rankConvName(rank) : rankShortName(rank);
}

// <RRK>: the rank most recently activated (e.g. by an onAccept promotion).
function recentRankName(ctx: MissionTextContext): string {
    const rankEnv: RankEnv = { rank: id => ctx.env.rank(id) };
    return mostRecentRankName(ctx.state, rankEnv);
}


// --- mutable blocks ---

interface MutableBlock {
    end: number;          // index just past the closing '}'
    kind: "bit" | "gender" | "registered";
    bit: number;
    negated: boolean;
    strings: string[];
}

// Parses one {…} block starting at text[start] === '{'. Returns null when
// the span is not a well-formed block (the caller then emits the '{'
// literally and scanning continues after it).
function parseMutableBlock(text: string, start: number): MutableBlock | null {
    let i = start + 1;
    let negated = false;
    if (text[i] === "!") {
        negated = true;
        i += 1;
    }
    const kindChar = text[i];
    let kind: MutableBlock["kind"];
    if (kindChar === "b" || kindChar === "B") {
        kind = "bit";
    }
    else if (kindChar === "g" || kindChar === "G") {
        kind = "gender";
    }
    else if (kindChar === "p" || kindChar === "P") {
        kind = "registered";
    }
    else {
        return null;
    }
    i += 1;

    let digits = "";
    while (i < text.length && text[i] >= "0" && text[i] <= "9") {
        digits += text[i];
        i += 1;
    }
    if (kind === "bit" && digits === "") {
        return null;
    }

    const strings: string[] = [];
    while (strings.length < 2) {
        const quote = skipWhitespace(text, i);
        if (text[quote] !== '"') {
            break;
        }
        const parsed = parseQuotedString(text, quote);
        if (!parsed) {
            return null;
        }
        strings.push(parsed.value);
        i = parsed.end;
    }
    // At least the first string must be present; the second defaults to "".
    if (strings.length === 0) {
        return null;
    }

    const close = skipWhitespace(text, i);
    if (text[close] !== "}") {
        return null;
    }
    return { end: close + 1, kind, bit: parseInt(digits || "0", 10), negated, strings };
}

function skipWhitespace(text: string, i: number): number {
    while (i < text.length && /\s/.test(text[i])) {
        i += 1;
    }
    return i;
}

// Reads a `"…"` string starting at text[start], honoring \" and \\ escapes.
function parseQuotedString(text: string, start: number):
    { value: string, end: number } | null {
    let value = "";
    let i = start + 1;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "\\") {
            const next = text[i + 1];
            if (next === '"' || next === "\\") {
                value += next;
                i += 2;
                continue;
            }
            // Unknown escape: keep the backslash literally.
            value += ch;
            i += 1;
            continue;
        }
        if (ch === '"') {
            return { value, end: i + 1 };
        }
        value += ch;
        i += 1;
    }
    return null; // unterminated
}

function blockValue(block: MutableBlock, ctx: MissionTextContext): string {
    let flag: boolean;
    switch (block.kind) {
        case "bit":
            // Out-of-range bits read as unset, like ControlBits.get().
            flag = ctx.state.bits[block.bit] !== 0;
            break;
        case "gender":
            flag = ctx.state.gender === "male";
            break;
        case "registered":
            // novajs has no demo copy, so registration checks pass.
            flag = true;
            break;
    }
    if (block.negated) {
        flag = !flag;
    }
    return flag ? block.strings[0] : (block.strings[1] ?? "");
}


// --- special ship names ---

// Picks the name of the mission's special (goal) ship from its Ship Name
// ID STR# resource, the way EV Nova does when the ships spawn. Ships'
// names aren't tracked per ActiveMission yet (P6), so dialogs roll a
// display name from the pilot's seed: deterministic per (pilot, mission).
export function pickSpecialShipName(mission: MissionData, env: MissionTextEnv,
    rng: () => number): string {
    if (mission.shipNameID <= 0) {
        return "";
    }
    const strings = env.stringSetByRawId(mission.shipNameID)?.strings ?? [];
    if (strings.length === 0) {
        return "";
    }
    return strings[Math.floor(rng() * strings.length)];
}
