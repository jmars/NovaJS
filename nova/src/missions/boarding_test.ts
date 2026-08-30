// Headless specs for the boarding resolver (P5): booty money within the
// flagged 10-25%-of-price band, commodity plunder in the mission cargo id
// space, the repelled path, the govt boarding penalty (with propagation and
// the own-mission exemption), the përs credits band, and the seeded
// determinism of the loot rolls. Run with:
//   npx esbuild --bundle --platform=node nova/src/missions/boarding_test.ts \
//       --outfile=/tmp/boarding_test.js && node_modules/.bin/jasmine /tmp/boarding_test.js

import "jasmine";
import { getDefaultDudeData } from "novadatainterface/DudeData";
import { getDefaultMissionData, MissionData } from "novadatainterface/MissionData";
import { getDefaultPersData } from "novadatainterface/PersData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import {
    boardRng,
    boardSeed,
    BOOTY_MONEY,
    MAX_BOOTY_TONS,
    resolveBoard,
} from "./boarding";
import {
    GOVERNMENTS,
    makeGovt,
    makePlayerState,
    makeTestEnv,
} from "./test_fixtures";
import { PlayerState } from "../player/player_state";
import { getDefaultGovernmentData } from "novadatainterface/GovernmentData";

const SHIP = { ...getDefaultShipData(), id: "nova:600", name: "Loot Barge",
    price: 10000 };

// A govt that fines boarding, with an ally class and an enemy class so the
// record propagation has someone to propagate to (fixtures: FEDERATION
// classes [1] allies [5] enemies [16]).
const BOARDABLE = {
    ...makeGovt("nova:142", "Boardable Govt", [1]),
    penalties: {
        ...getDefaultGovernmentData().penalties,
        board: 5,
    },
};

const NO_MISSION: MissionData | null = null;

function dude(booty: number, govt: string | null = BOARDABLE.id) {
    return { ...getDefaultDudeData(), booty, govt };
}

function pers(overrides: Partial<ReturnType<typeof getDefaultPersData>>) {
    return { ...getDefaultPersData(), ...overrides };
}

// Fresh state + env per call: resolveBoard mutates what it applies.
function board(state: PlayerState, bootyDude: ReturnType<typeof dude> | null,
    targetPers: ReturnType<typeof pers> | null,
    mission: MissionData | null = NO_MISSION, seed = 7) {
    const { env } = makeTestEnv();
    return resolveBoard(state, mission, SHIP, bootyDude, targetPers, env,
        makeRngFor(seed));
}

// A plain counter rng for bound checks that must hold for EVERY draw.
function makeRngFor(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}


describe("boarding resolution", () => {
    beforeAll(() => {
        GOVERNMENTS.set(BOARDABLE.id, BOARDABLE);
    });

    it("plunders money booty within 10-25% of the ship's price", () => {
        for (let seed = 1; seed <= 25; seed++) {
            const state = makePlayerState();
            const result = board(state, dude(BOOTY_MONEY), null,
                NO_MISSION, seed);
            expect(result.outcome).toEqual("plundered");
            expect(result.bootyType).toEqual(BOOTY_MONEY);
            const paid = result.effects.find(e => e.kind === "pay");
            expect(paid).withContext(`seed ${seed}`).toEqual(
                { kind: "pay", amount: result.creditsDelta! });
            // The flagged approximation band: 10-25% of 10000 credits.
            expect(result.creditsDelta!).toBeGreaterThanOrEqual(1000);
            expect(result.creditsDelta!).toBeLessThanOrEqual(2500);
            expect(state.credits).toEqual(25000 + result.creditsDelta!);
        }
    });

    it("plunders one commodity per booty bit, in the mission cargo id space",
        () => {
            const state = makePlayerState();
            // 0x0002 industrial (type 1) + 0x0020 equipment (type 5).
            const result = board(state, dude(0x0002 | 0x0020), null);
            expect(result.cargo).toEqual([
                { type: 1, qty: jasmine.any(Number) },
                { type: 5, qty: jasmine.any(Number) },
            ]);
            for (const entry of result.cargo!) {
                expect(entry.qty).toBeGreaterThanOrEqual(1);
                expect(entry.qty).toBeLessThanOrEqual(MAX_BOOTY_TONS);
            }
            // Reported as informational cargo effects; no hold exists yet.
            const cargoEffects = result.effects.filter(e => e.kind === "cargo");
            expect(cargoEffects.length).toEqual(2);
            // No money bit: no credits.
            expect(result.creditsDelta).toBeUndefined();
            expect(state.credits).toEqual(25000);
        });

    it("tells the player they were repelled when the booty mask is 0",
        () => {
            const state = makePlayerState();
            const result = board(state, dude(0), null);
            expect(result.outcome).toEqual("repelled");
            expect(result.bootyType).toEqual(0);
            expect(result.effects).toEqual([]);
            expect(result.creditsDelta).toBeUndefined();
            expect(result.cargo).toBeUndefined();
            expect(state.credits).toEqual(25000);
        });

    it("applies the govt boarding penalty as a propagated record crime",
        () => {
            const state = makePlayerState();
            const result = board(state, dude(BOOTY_MONEY), null);
            expect(state.legalRecord[BOARDABLE.id]).toEqual(-5);
            // Allies of the boarded govt hear the same crime, its enemies
            // the opposite (FEDERATION is BOARDABLE's class enemy here, and
            // POLARIS is FEDERATION's enemy — propagation stops there).
            expect(result.effects).toContain(
                { kind: "record", govt: BOARDABLE.id, delta: -5 });
        });

    it("skips the boarding penalty for one's own mission's goal ship",
        () => {
            const state = makePlayerState();
            const result = board(state, dude(BOOTY_MONEY), null,
                getDefaultMissionData());
            expect(state.legalRecord[BOARDABLE.id]).toBeUndefined();
            expect(result.effects.filter(e => e.kind === "record")).toEqual([]);
            // The plunder itself still happens.
            expect(result.creditsDelta).toBeGreaterThan(0);
        });

    it("yields a përs's credits within +/-25%, even without düde booty",
        () => {
            for (let seed = 1; seed <= 25; seed++) {
                const state = makePlayerState();
                const result = board(state, dude(0), pers({ credits: 10000 }),
                    NO_MISSION, seed);
                expect(result.outcome).toEqual("plundered");
                expect(result.creditsDelta!).toBeGreaterThanOrEqual(7500);
                expect(result.creditsDelta!).toBeLessThanOrEqual(12500);
                expect(state.credits).toEqual(25000 + result.creditsDelta!);
            }
        });

    it("repels a creditless përs with no booty", () => {
        const state = makePlayerState();
        const result = board(state, null, pers({ credits: 0 }));
        expect(result.outcome).toEqual("repelled");
        expect(result.effects).toEqual([]);
    });

    it("is deterministic for a given pilot, ship and date", () => {
        const run = () => {
            const state = makePlayerState();
            const { env } = makeTestEnv();
            const result = resolveBoard(state, null, SHIP,
                dude(0x0040 | 0x0004), pers({ credits: 8000 }), env,
                boardRng(state, 600));
            return { result, credits: state.credits };
        };
        expect(boardSeed(makePlayerState(), 600))
            .toEqual(boardSeed(makePlayerState(), 600));
        expect(run()).toEqual(run());
    });
});
