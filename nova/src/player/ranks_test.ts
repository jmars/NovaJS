// Headless specs for the ränk rules (P7): activation/deactivation cascade
// flags, permanent ranks, salaries and the salary cap, the price-modifier
// hook, the Contribute pool, and the <PRK>/<SRK>/<RRK> resolution. Reuses
// the P4 fixtures' state factory and rank maker.

import "jasmine";
import { RankData } from "novadatainterface/RankData";
import {
    activateRank,
    activeRankContributes,
    applyDailySalaries,
    DEFAULT_RANK_NAME,
    deactivateRank,
    highestWeightActiveRank,
    mostRecentRankName,
    priceMod,
    rankConvName,
    rankShortName,
} from "./ranks";
import { PlayerState } from "./player_state";
import { makePlayerState, makeRank } from "../missions/test_fixtures";

const FED = "nova:128";
const POL = "nova:130";

function envOf(ranks: Map<string, RankData>) {
    return { rank: (id: string) => ranks.get(id) ?? null };
}

describe("ranks", function() {
    let state: PlayerState;
    let ranks: Map<string, RankData>;
    let env: ReturnType<typeof envOf>;

    beforeEach(function() {
        state = makePlayerState();
        ranks = new Map();
        env = envOf(ranks);
    });

    function put(...all: RankData[]): void {
        for (const rank of all) {
            ranks.set(rank.id, rank);
        }
    }

    it("activates a plain rank and records it as the most recent", function() {
        const plain = makeRank("nova:400", FED, 1);
        const foreign = makeRank("nova:401", POL, 1);
        put(plain, foreign);
        state.activeRanks.push(foreign.id);
        expect(activateRank(state, plain.id, env)).toEqual([]);
        expect(state.activeRanks).toContain(plain.id);
        expect(state.lastActivatedRank).toEqual(plain.id);
        // Reactivating does not duplicate.
        activateRank(state, plain.id, env);
        expect(state.activeRanks.filter(id => id === plain.id).length).toEqual(1);
    });

    it("activates unknown rank ids without data (no cascade)", function() {
        expect(activateRank(state, "nova:999", env)).toEqual([]);
        expect(state.activeRanks).toEqual(["nova:999"]);
        expect(state.lastActivatedRank).toEqual("nova:999");
    });

    it("0x0001 cascade: deactivates all other same-govt ranks on activate",
        function() {
            const other = makeRank("nova:402", FED, 9);
            const foreign = makeRank("nova:403", POL, 9);
            const permanent = makeRank("nova:404", FED, 9, 0x0008);
            const promoted = makeRank("nova:405", FED, 1, 0x0001);
            put(other, foreign, permanent, promoted);
            state.activeRanks.push(other.id, foreign.id, permanent.id);

            expect(activateRank(state, promoted.id, env)).toEqual([other.id]);
            expect(state.activeRanks).toEqual([foreign.id, permanent.id, promoted.id]);
        });

    it("0x0010 cascade: deactivates only lower-weighted same-govt ranks",
        function() {
            const higher = makeRank("nova:406", FED, 10);
            const lower = makeRank("nova:407", FED, 2);
            const promoted = makeRank("nova:408", FED, 5, 0x0010);
            put(higher, lower, promoted);
            state.activeRanks.push(higher.id, lower.id);

            expect(activateRank(state, promoted.id, env)).toEqual([lower.id]);
            expect(state.activeRanks).toEqual([higher.id, promoted.id]);
        });

    it("0x0002 cascade: deactivates other same-govt ranks when deactivated",
        function() {
            const other = makeRank("nova:409", FED, 9);
            const foreign = makeRank("nova:410", POL, 9);
            const leaving = makeRank("nova:411", FED, 1, 0x0002);
            put(other, foreign, leaving);
            state.activeRanks.push(other.id, foreign.id, leaving.id);

            expect(deactivateRank(state, leaving.id, env)).toEqual([other.id]);
            expect(state.activeRanks).toEqual([foreign.id]);
        });

    it("0x0020 cascade: deactivates only lower-weighted same-govt ranks when deactivated",
        function() {
            const higher = makeRank("nova:412", FED, 10);
            const lower = makeRank("nova:413", FED, 2);
            const leaving = makeRank("nova:414", FED, 5, 0x0020);
            put(higher, lower, leaving);
            state.activeRanks.push(higher.id, lower.id, leaving.id);

            expect(deactivateRank(state, leaving.id, env)).toEqual([lower.id]);
            expect(state.activeRanks).toEqual([higher.id]);
        });

    it("cascade removals are flat: a removed rank's own cascade never re-fires",
        function() {
            // A (0x0020, weight 10) strips only lower-weighted ranks: B
            // (0x0002, weight 5) and the plain rank. If B's own 0x0002
            // re-fired when the cascade removed it, it would also strip
            // the HEAVIER rank that A's cascade spared — and mutual 0x0002
            // pairs would loop forever.
            const a = makeRank("nova:430", FED, 10, 0x0020);
            const b = makeRank("nova:431", FED, 5, 0x0002);
            const heavy = makeRank("nova:432", FED, 20);
            const lower = makeRank("nova:433", FED, 1);
            put(a, b, heavy, lower);
            state.activeRanks.push(heavy.id, lower.id, b.id, a.id);

            // The cascade runs in activeRanks order.
            expect(deactivateRank(state, a.id, env)).toEqual([lower.id, b.id]);
            expect(state.activeRanks).toEqual([heavy.id]);

            // Mutual 0x0002 pair: deactivating either terminates (the L op
            // removes C itself, the cascade removes D, and D's own 0x0002
            // does not re-fire).
            const c = makeRank("nova:434", FED, 1, 0x0002);
            const d = makeRank("nova:435", FED, 1, 0x0002);
            put(c, d);
            state = makePlayerState();
            state.activeRanks.push(c.id, d.id);
            expect(deactivateRank(state, c.id, env)).toEqual([d.id]);
            expect(state.activeRanks).toEqual([]);
        });

    it("lets an explicit deactivation remove a permanent rank", function() {
        const permanent = makeRank("nova:415", FED, 1, 0x0008);
        put(permanent);
        state.activeRanks.push(permanent.id);
        expect(deactivateRank(state, permanent.id, env)).toEqual([]);
        expect(state.activeRanks).toEqual([]);
        // Deactivating a rank that is not active is a no-op.
        expect(deactivateRank(state, permanent.id, env)).toEqual([]);
    });

    it("pays salaries per day while credits are under the salary cap", function() {
        const capped = makeRank("nova:416", FED, 1, 0, { salary: 100, salaryCap: 50000 });
        const uncapped = makeRank("nova:417", FED, 1, 0, { salary: 50, salaryCap: 0 });
        const nogood = makeRank("nova:418", FED, 1, 0, { salary: 0, salaryCap: 50000 });
        const negativeCap = makeRank("nova:419", FED, 1, 0,
            { salary: 10, salaryCap: -1 });
        put(capped, uncapped, nogood, negativeCap);
        state.activeRanks.push(capped.id, uncapped.id, nogood.id, negativeCap.id);

        state.credits = 49999;
        expect(applyDailySalaries(state, env)).toEqual(160);
        expect(state.credits).toEqual(50159); // pre-payout check: 49999 < 50000

        // The cap has been reached: the capped rank stops paying.
        expect(applyDailySalaries(state, env)).toEqual(60);
        // Multiple days at once pay multiple times.
        expect(applyDailySalaries(state, env, 3)).toEqual(180);
        // Deactivating a rank stops its salary.
        deactivateRank(state, uncapped.id, env);
        expect(applyDailySalaries(state, env)).toEqual(10);
    });

    it("pays nothing without rank data or active ranks", function() {
        state.credits = 100;
        expect(applyDailySalaries(state, null)).toEqual(0);
        expect(applyDailySalaries(state, env)).toEqual(0);
        expect(state.credits).toEqual(100);
    });

    it("applies the highest-weight matching rank's priceMod", function() {
        const cheap = makeRank("nova:420", FED, 1, 0, { priceMod: 80 });
        const cheaper = makeRank("nova:421", FED, 5, 0, { priceMod: 90 });
        const foreign = makeRank("nova:422", POL, 9, 0, { priceMod: 10 });
        put(cheap, cheaper, foreign);
        state.activeRanks.push(cheap.id, foreign.id);
        expect(priceMod(state, env, FED)).toEqual(0.8);
        expect(priceMod(state, env, POL)).toEqual(0.1);
        // The higher-weight Federation rank wins once active.
        state.activeRanks.push(cheaper.id);
        expect(priceMod(state, env, FED)).toEqual(0.9);
        // No govt (or no match): unchanged prices.
        expect(priceMod(state, env, null)).toEqual(1);
        expect(priceMod(state, env, "nova:141")).toEqual(1);
        expect(priceMod(state, null, FED)).toEqual(1);
    });

    it("merges active ranks' Contribute masks into one pool", function() {
        const a = makeRank("nova:423", FED, 1, 0, { contributes: [1 << 3, 0] });
        const b = makeRank("nova:424", FED, 1, 0, { contributes: [0, 1 << 5] });
        put(a, b);
        expect(activeRankContributes(state, env)).toEqual([0, 0]);
        state.activeRanks.push(a.id, b.id);
        expect(activeRankContributes(state, env)).toEqual([1 << 3, 1 << 5]);
        deactivateRank(state, a.id, env);
        expect(activeRankContributes(state, env)).toEqual([0, 1 << 5]);
        expect(activeRankContributes(state, null)).toEqual([0, 0]);
    });

    it("resolves <PRK>/<SRK> as the highest-weight active rank, defaulting to captain",
        function() {
            const low = makeRank("nova:425", FED, 1, 0,
                { convName: "Lieutenant", shortName: "Lt." });
            const high = makeRank("nova:426", FED, 5, 0,
                { convName: "Captain", shortName: "Capt." });
            // Lighter than the Federation ranks so the unfiltered lookups
            // below pick "Captain".
            const polRank = makeRank("nova:427", POL, 2, 0,
                { convName: "Nil'kemorya", shortName: "Nil" });
            put(low, high, polRank);
            state.activeRanks.push(low.id, high.id, polRank.id);

            expect(rankConvName(highestWeightActiveRank(state, env))).toEqual("Captain");
            expect(rankShortName(highestWeightActiveRank(state, env))).toEqual("Capt.");
            // <PRKnnn>: restricted to one government's ranks (by raw id).
            expect(rankConvName(highestWeightActiveRank(state, env, 130)))
                .toEqual("Nil'kemorya");
            expect(rankConvName(highestWeightActiveRank(state, env, 141)))
                .toEqual(DEFAULT_RANK_NAME);
            // Empty names fall back to "captain"; so does no rank at all.
            const unnamed = makeRank("nova:428", FED, 99, 0, { convName: "", shortName: "" });
            put(unnamed);
            state.activeRanks.push(unnamed.id);
            expect(rankConvName(highestWeightActiveRank(state, env)))
                .toEqual(DEFAULT_RANK_NAME);
            expect(rankConvName(highestWeightActiveRank(makePlayerState(), env)))
                .toEqual(DEFAULT_RANK_NAME);
            expect(rankConvName(highestWeightActiveRank(state, null)))
                .toEqual(DEFAULT_RANK_NAME);
        });

    it("resolves <RRK> as the most recently activated rank", function() {
        const rank = makeRank("nova:429", FED, 1, 0, { convName: "Lieutenant" });
        put(rank);
        expect(mostRecentRankName(state, env)).toEqual(DEFAULT_RANK_NAME);
        activateRank(state, rank.id, env);
        expect(mostRecentRankName(state, env)).toEqual("Lieutenant");
        // An unknown last rank falls back too.
        state.lastActivatedRank = "nova:999";
        expect(mostRecentRankName(state, env)).toEqual(DEFAULT_RANK_NAME);
    });
});
