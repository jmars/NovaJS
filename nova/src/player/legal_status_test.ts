// Headless specs for the legal-record propagation and its rank interplay
// (P7). Shares the P4 fixture govt graph (test_fixtures.ts): Federation
// (class 1, ally class 5, enemy class 16), Ally Govt (class 5), Polaris
// (class 16, enemy 1), Vell-os (class 1), Rebels (class 7).

import "jasmine";
import { RankData } from "novadatainterface/RankData";
import { changeRecord, cleanRecord, deactivateRanksOnShipLoss, govtsAreClassmates,
    govtsAreEnemies } from "./legal_status";
import { PlayerState } from "./player_state";
import {
    FED_CRIME_RANK,
    makeGovt,
    makePlayerState,
    makeRank,
    makeTestEnv,
} from "../missions/test_fixtures";

describe("legal status", function() {
    let state: PlayerState;
    let env: ReturnType<typeof makeTestEnv>["env"];
    let warnings: string[];
    // The env's rank table is fixture-level; point it at a per-spec map so
    // specs can register their own ranks.
    let myRanks: Map<string, RankData>;

    beforeEach(function() {
        state = makePlayerState();
        const testEnv = makeTestEnv();
        env = testEnv.env;
        warnings = testEnv.warnings;
        myRanks = new Map([[FED_CRIME_RANK.id, FED_CRIME_RANK]]);
        env.rank = id => myRanks.get(id) ?? null;
    });

    it("applies the delta to the target govt and propagates to allies and enemies",
        function() {
            // A crime against the Federation (delta -10): the target hears
            // it in full; Ally Govt hears the same half-delta (-5) and
            // Polaris (at war) the opposite half-delta (+5) — FUN_00440410.
            const changes = changeRecord(state, "nova:128", -10, env);
            expect(changes).toEqual([
                { govt: "nova:128", delta: -10, propagated: false },
                { govt: "nova:129", delta: -5, propagated: true },
                { govt: "nova:130", delta: 5, propagated: true },
            ]);
            expect(state.legalRecord["nova:128"]).toEqual(-10);
            expect(state.legalRecord["nova:129"]).toEqual(-5);
            expect(state.legalRecord["nova:130"]).toEqual(5);
        });

    it("hears enemies in both directions; classmates hear nothing", function() {
        // Polaris has the Vell-os class (1) in its enemies list, so a good
        // deed for Vell-os worsens the Polaris record by half the delta
        // (-round(5/2) = -3). The Federation only shares Vell-os's class: a
        // classmate is not an ally, and hears nothing.
        const changes = changeRecord(state, "nova:136", 5, env);
        expect(changes).toEqual([
            { govt: "nova:136", delta: 5, propagated: false },
            { govt: "nova:130", delta: -3, propagated: true },
        ]);
        expect(state.legalRecord["nova:136"]).toEqual(5);
        expect(state.legalRecord["nova:130"]).toEqual(-3);
        expect(state.legalRecord["nova:128"] ?? 0).toEqual(0);
    });

    it("accumulates over the pilot's existing records", function() {
        state.legalRecord["nova:128"] = -3;
        changeRecord(state, "nova:128", -10, env);
        expect(state.legalRecord["nova:128"]).toEqual(-13);
    });

    it("does nothing for zero deltas or unknown govts (warned)", function() {
        expect(changeRecord(state, "nova:128", 0, env)).toEqual([]);
        expect(changeRecord(state, "nova:999", -10, env)).toEqual([]);
        expect(state.legalRecord["nova:128"]).toBeUndefined();
        expect(warnings.some(w => w.includes("nova:999"))).toBeTrue();
    });

    it("cleans records without propagation", function() {
        state.legalRecord["nova:128"] = -50;
        state.legalRecord["nova:129"] = -20;
        cleanRecord(state, "nova:128");
        expect(state.legalRecord["nova:128"]).toEqual(0);
        expect(state.legalRecord["nova:129"]).toEqual(-20);
    });

    it("classmates are positional (FUN_0046bff0), not a set intersection",
        function() {
            // [1,2] vs [2,1] share no SLOT: not classmates, even though the
            // class sets intersect. Slot 1 (2 == 2) does match.
            const ab = makeGovt("nova:150", "Ab", [1, 2]);
            const ba = makeGovt("nova:151", "Ba", [2, 1]);
            const b9 = makeGovt("nova:152", "B9", [9, 2]);
            expect(govtsAreClassmates(ab, ba)).toBeFalse();
            expect(govtsAreClassmates(ab, b9)).toBeTrue();
            // Enemies stay an any-vs-any list check: Ba's slot-0 class 2 is
            // in ab's enemy list.
            expect(govtsAreEnemies(ab, makeGovt("nova:153", "E", [], [], [2])))
                .toBeTrue();
            // A government is always classmates with itself, even with no
            // class slots at all.
            const empty = makeGovt("nova:154", "Empty", []);
            expect(govtsAreClassmates(empty, makeGovt("nova:154", "Empty", [])))
                .toBeTrue();
            expect(govtsAreClassmates(empty, makeGovt("nova:155", "Other", [])))
                .toBeFalse();
        });

    it("strips 0x0040 ranks on any crime against the affiliated govt", function() {
        state.activeRanks.push(FED_CRIME_RANK.id);
        // A crime against Polaris is not against the Federation: rank stays.
        changeRecord(state, "nova:130", -10, env);
        expect(state.activeRanks).toContain(FED_CRIME_RANK.id);
        // A crime against the Federation strips it.
        changeRecord(state, "nova:128", -10, env);
        expect(state.activeRanks).not.toContain(FED_CRIME_RANK.id);
    });

    it("never strips permanent ranks involuntarily", function() {
        const permanent = makeRank("nova:441", "nova:128", 5, 0x0040 | 0x0008);
        myRanks.set(permanent.id, permanent);
        state.activeRanks.push(permanent.id);
        changeRecord(state, "nova:128", -10, env);
        expect(state.activeRanks).toContain(permanent.id);
    });

    it("strips 0x0004 ranks on destroying/disabling affiliated or allied ships",
        function() {
            const fedRank = makeRank("nova:442", "nova:128", 1, 0x0004);
            const allyRank = makeRank("nova:443", "nova:129", 1, 0x0004);
            const plainRank = makeRank("nova:444", "nova:128", 1, 0x0000);
            myRanks.set(fedRank.id, fedRank);
            myRanks.set(allyRank.id, allyRank);
            myRanks.set(plainRank.id, plainRank);
            state.activeRanks.push(fedRank.id, allyRank.id, plainRank.id);

            // A Polaris ship: not the affiliated govt, not an ally.
            expect(deactivateRanksOnShipLoss(state, "nova:130", env)).toEqual([]);
            expect(state.activeRanks).toEqual(
                [fedRank.id, allyRank.id, plainRank.id]);

            // A Federation ship strips both the Federation rank and the
            // rank of its ally (the alliance counts in both directions);
            // the flagless rank stays.
            expect(deactivateRanksOnShipLoss(state, "nova:128", env))
                .toEqual([fedRank.id, allyRank.id]);
            expect(state.activeRanks).toEqual([plainRank.id]);
            // ...and an Ally Govt ship would do the same to its own rank.
            const otherAlly = makeRank("nova:445", "nova:129", 1, 0x0004);
            myRanks.set(otherAlly.id, otherAlly);
            state.activeRanks.push(otherAlly.id);
            expect(deactivateRanksOnShipLoss(state, "nova:129", env))
                .toEqual([otherAlly.id]);
        });

    it("ignores ship losses of unknown govts and rank data-less envs", function() {
        expect(deactivateRanksOnShipLoss(state, "nova:999", env)).toEqual([]);
        const noRanks = makeTestEnv().env;
        delete noRanks.rank;
        state.activeRanks.push(FED_CRIME_RANK.id);
        expect(deactivateRanksOnShipLoss(state, "nova:128", noRanks)).toEqual([]);
        expect(state.activeRanks).toContain(FED_CRIME_RANK.id);
        // A bare govt fixture without rank lookups still propagates.
        const lone = makeGovt("nova:150", "Lone", [9]);
        const changes = changeRecord(state, lone.id, 4, {
            government: id => (id === lone.id ? lone : null),
            allGovernments: () => [lone],
        });
        expect(changes).toEqual([{ govt: lone.id, delta: 4, propagated: false }]);
    });
});
