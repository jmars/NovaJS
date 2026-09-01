// Side-by-side trace specs for combat rating's ränk 0x0004 stripping: the
// port's real deactivateRanksOnShipLoss (legal_status.ts, wired from the
// CombatRatingPlugin's DeathEvent/DisabledEvent hooks) must return the same
// deactivated rank set as the pure binary reference model
// (combat_rating_model) across a sweep of rank flags, governments and
// alliance graphs. Deterministic — a set comparison, not an LCG fingerprint.
//
// Run:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/combat_rating_trace_test.ts \
//       --outfile=/tmp/combat_rating_trace_test.js \
//       && node_modules/.bin/jasmine /tmp/combat_rating_trace_test.js

import "jasmine";
import {
    deactivateRanksOnShipLoss as portDeactivate,
} from "../player/legal_status";
import {
    makeGovt,
    makePlayerState,
    makeRank,
    makeTestEnv,
} from "../missions/test_fixtures";
import { GovernmentData } from "novadatainterface/GovernmentData";
import { RankData } from "novadatainterface/RankData";
import { PlayerState } from "../player/player_state";
import { MissionEnv } from "../missions/mission_state_machine";
import {
    deactivateRanksOnShipLoss as modelDeactivate,
    RankLike,
} from "./combat_rating_model";

// A small alliance graph: Fed allies with Ally (both directions), and an
// Enemy / Neutral unrelated.
const GOVTS: GovernmentData[] = [
    makeGovt("nova:128", "Federation", [1], [5]),
    makeGovt("nova:129", "Ally", [5], [1]),
    makeGovt("nova:130", "Enemy", [16]),
    makeGovt("nova:131", "Neutral", [7]),
];
const govtOf = (id: string | null): GovernmentData | null =>
    id === null ? null : GOVTS.find(g => g.id === id) ?? null;

// Ranks exercising each flag/govt axis:
const RANKS: RankData[] = [
    makeRank("nova:440", "nova:128", 1, 0x0004),               // Fed, strip
    makeRank("nova:441", "nova:129", 1, 0x0004),               // Ally, strip
    makeRank("nova:442", "nova:130", 1, 0x0004),               // Enemy, no strip for Fed
    makeRank("nova:443", "nova:128", 1, 0x0004 | 0x0008),      // Fed permanent
    makeRank("nova:444", "nova:129", 1, 0x0000),               // no 0x0004
    makeRank("nova:445", null, 1, 0x0004),                     // govt-less
];
const rankOf = (id: string): RankData | null =>
    RANKS.find(r => r.id === id) ?? null;

// The model's input shapes (govt/rank narrowed to the used fields).
const govtLike = (g: GovernmentData): { id: string, classes: number[],
    allies: number[] } => ({ id: g.id, classes: g.classes, allies: g.allies });
const rankLike = (r: RankData): RankLike => ({ id: r.id, govt: r.govt,
    flags: r.flags });

function runPort(state: PlayerState, shipGovtId: string): string[] {
    const env = makeTestEnv().env;
    env.government = id => govtOf(id);
    env.rank = id => rankOf(id);
    // deactivateMatchingRanks mutates activeRanks; keep the caller's list.
    return portDeactivate(state, shipGovtId, env);
}

function runModel(active: string[], shipGovtId: string): string[] {
    return modelDeactivate(
        active,
        id => { const r = rankOf(id); return r === null ? null : rankLike(r); },
        shipGovtId,
        id => { const g = govtOf(id); return g === null ? null : govtLike(g); },
    );
}

const shipGovts = ["nova:128", "nova:129", "nova:130", "nova:131", "nova:999"];

describe("combat rating trace vs reference model", () => {
    it("strips the same ranks as the model across the full sweep", () => {
        let cases = 0;
        for (let mask = 0; mask < (1 << RANKS.length); mask++) {
            const active = RANKS.filter((_, i) => (mask >> i) & 1)
                .map(r => r.id);
            for (const shipGovt of shipGovts) {
                const state = makePlayerState();
                state.activeRanks = [...active];
                const port = runPort(state, shipGovt);
                const model = runModel(active, shipGovt);
                expect([...port].sort())
                    .withContext(`mask=${mask} shipGovt=${shipGovt}`)
                    .toEqual([...model].sort());
                cases++;
            }
        }
        expect(cases).toEqual(64 * shipGovts.length);
    });

    it("still honours a fresh state and a known allied pair", () => {
        // Fed loss strips the Fed rank AND the allied Ally rank (alliance
        // holds in both directions), never the permanent or govt-less ones.
        const state = makePlayerState();
        state.activeRanks = RANKS.map(r => r.id);
        const port = runPort(state, "nova:128");
        expect([...port].sort()).toEqual(["nova:440", "nova:441"]);
        // An Ally loss strips the same two (allied both ways).
        const state2 = makePlayerState();
        state2.activeRanks = RANKS.map(r => r.id);
        expect([...runPort(state2, "nova:129")].sort())
            .toEqual(["nova:440", "nova:441"]);
    });
});
