// Headless specs for the mission lifecycle FSM (P4): the scripted m128
// Vellos flow, deadline failure, auto-abort, refuse, the 16-mission cap,
// duplicate-stellar returns, PayVal decode, destination resolution, travel
// legs, bounty completion and the ShipSyst filter table. Fixtures live in
// test_fixtures.ts.

import "jasmine";
import { advanceDate } from "../player/date";
import { makeRng } from "../player/pilot_files";
import {
    acceptMission,
    abortMission,
    applyPay,
    jumpRerollSeed,
    landingMatchesStellar,
    markShipGoalComplete,
    processArrival,
    refuseMission,
    rerollAvailRandomRolls,
    resolveDestination,
} from "./mission_state_machine";
import { cronSeed, makeCronEnv, processCrons } from "./cron_scheduler";
import { systemMatchesSystemFilter } from "./stellar_filter";
import {
    ActiveMission,
    PlayerState,
} from "../player/player_state";
import { checkAvailability } from "./availability";
import {
    AUTO_ABORT_MISSION,
    BARREN,
    BOUNTY_MISSION,
    DEADLINE_MISSION,
    EARTH,
    EARTH_DUP,
    FED_CRIME_RANK,
    FERRY_MISSION,
    isBitSet,
    M128,
    M129,
    makeMission,
    makePlayerState,
    makeTestEnv,
    MISSIONS,
    offerCtx as offerCtxFor,
    PENALTY_ABORT_MISSION,
    setBit,
    START,
    SYSTEMS,
    UNABORTABLE_MISSION,
    UNREFUSABLE_MISSION,
    VELLOS_WORLD,
} from "./test_fixtures";


describe("mission state machine", function() {

    it("runs the scripted m128 Vellos flow end to end", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        // Force the 8% AvailRandom roll; m129's 40% roll passes at 39.
        state.availRandomRolls["nova:128"] = 3;
        state.availRandomRolls["nova:129"] = 39;

        // m129 needs the b350 that m128's success sets: not offered yet.
        expect(checkAvailability(M129,
            offerCtxFor(state, env, EARTH, "nova:302", "spaceport")).available).toBeFalse();

        // Offered on any inhabited BBS, with free cargo space for
        // flags2 0x0001.
        expect(checkAvailability(M128,
            offerCtxFor(state, env, START, "nova:300", "bbs", { freeCargoTons: 20 })).available)
            .toBeTrue();
        expect(checkAvailability(M128,
            offerCtxFor(state, env, START, "nova:300", "bbs", { freeCargoTons: 0 })).available)
            .toBeFalse();

        // Accept while landed on Start One.
        const accept = acceptMission(state, M128, env, START.id);
        expect(accept.accepted).toBeTrue();
        const active = accept.active!;
        expect(active.returnStellar).toEqual("nova:128");
        expect(active.travelStellar).toBeNull();
        expect(active.travelComplete).toBeTrue(); // no travel leg
        expect(active.cargoLoaded).toBeTrue(); // PickupMode 0
        expect(active.cargo).not.toBeNull();
        expect(active.cargo!.type).toBeGreaterThanOrEqual(0);
        expect(active.cargo!.type).toBeLessThanOrEqual(5);
        expect(active.cargo!.qty).toBeGreaterThanOrEqual(2); // 5 tons +/-50%
        expect(active.cargo!.qty).toBeLessThanOrEqual(7);
        expect(active.deadline).toBeNull();
        expect(state.credits).toEqual(25000); // pay arrives at delivery

        // Jump to Sol: +1 day, system explored, rolls re-rolled seeded.
        state.date = advanceDate(state.date, 1);
        state.currentSystem = "nova:302";
        state.exploredSystems.push("nova:302");
        rerollAvailRandomRolls(state, env.allMissionIds(), makeRng(jumpRerollSeed(state)));
        const rolls = state.availRandomRolls;
        expect(Object.keys(rolls).length).toEqual(MISSIONS.size);
        // The re-roll is reproducible from the seed and the new date.
        const replay = makeRng(jumpRerollSeed(state));
        for (const id of env.allMissionIds()) {
            expect(rolls[id]).toEqual(Math.floor(replay() * 100));
        }
        // A fresh warp-in roll under m129's 40%.
        state.availRandomRolls["nova:129"] = 39;

        // Landing on a planet that is neither Earth nor a duplicate does
        // nothing; landing does not advance the day.
        const barren = processArrival(state, env, BARREN.id);
        expect(barren.completed).toEqual([]);
        expect(barren.failed).toEqual([]);
        expect(state.date).toEqual(advanceDate({ day: 23, month: 6, year: 1177 }, 1));

        // Landing on the duplicate Earth (nova:150: same name+position as
        // nova:128, different system) completes the delivery.
        const arrival = processArrival(state, env, EARTH_DUP.id);
        expect(arrival.completed).toEqual(["nova:128"]);
        expect(arrival.failed).toEqual([]);
        expect(state.activeMissions).toEqual([]);
        expect(state.completedMissions).toEqual(["nova:128"]);
        expect(state.credits).toEqual(25000 + 15000);
        expect(isBitSet(state, 350)).toBeTrue();  // onSuccess
        expect(isBitSet(state, 6666)).toBeTrue();
        expect(active.cargoLoaded).toBeFalse();   // dropoffMode 1 dropped it
        const effects = arrival.effects;
        expect(effects).toContain(jasmine.objectContaining(
            { kind: "pay", amount: 15000 }));
        expect(effects).toContain(jasmine.objectContaining(
            { kind: "cargo", type: active.cargo!.type, qty: -active.cargo!.qty }));
        expect(effects).toContain(jasmine.objectContaining(
            { kind: "setExpr", when: "success", expr: "b350 b6666" }));
        expect(effects).toContain(jasmine.objectContaining(
            { kind: "text", purpose: "complete", text: "nova:9350" }));
        // compReward 0 -> no record effect for Vell-os.
        expect(effects.filter(effect => effect.kind === "record")).toEqual([]);

        // Now Vellos2 (m129) becomes available on Earth, at the spaceport.
        // Stock gates it behind !b6666 (the "a mission just finished" flag
        // that crön 221 "Generic misn delay cron" clears): activate on the
        // day of completion, then its continuous-iterative OnEnd clears the
        // flag the next day.
        expect(checkAvailability(M129,
            offerCtxFor(state, env, EARTH, "nova:302", "spaceport")).available).toBeFalse();
        const cronEnv = makeCronEnv(env)!;
        processCrons(state, cronEnv, makeRng(cronSeed(state)));
        state.date = advanceDate(state.date, 1);
        processCrons(state, cronEnv, makeRng(cronSeed(state)));
        expect(isBitSet(state, 6666)).toBeFalse();
        expect(checkAvailability(M129,
            offerCtxFor(state, env, EARTH, "nova:302", "spaceport")).available).toBeTrue();
        // ...but not at the BBS (AvailLoc 3), nor on a planet that is not
        // Earth (AvailStel 128).
        expect(checkAvailability(M129,
            offerCtxFor(state, env, EARTH, "nova:302", "bbs")).available).toBeFalse();
        expect(checkAvailability(M129,
            offerCtxFor(state, env, START, "nova:300", "spaceport")).available).toBeFalse();
    });

    it("accepts deterministically for a given seed", function() {
        const a = makePlayerState(7);
        const b = makePlayerState(7);
        const { env } = makeTestEnv();
        const acceptA = acceptMission(a, M128, env, START.id);
        const acceptB = acceptMission(b, M128, env, START.id);
        expect(acceptA.active!.cargo).toEqual(acceptB.active!.cargo);
    });

    it("fails missions whose deadline has expired, but not on deadline day", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        setBit(state, 900);
        const accept = acceptMission(state, DEADLINE_MISSION, env, START.id);
        expect(accept.active!.deadline).toEqual(advanceDate(state.date, 5));

        // Landing on Earth on the deadline day is on time: completes.
        const onTime = processArrival(state, env, EARTH.id);
        expect(onTime.completed).toEqual(["nova:500"]);
        expect(state.legalRecord["nova:128"]).toEqual(10); // CompReward

        // Again, but a day late: failure, record penalty, onFailure.
        const late = makePlayerState();
        acceptMission(late, DEADLINE_MISSION, env, START.id);
        late.date = advanceDate(late.date, 6);
        const arrival = processArrival(late, env, EARTH.id);
        expect(arrival.failed).toEqual(["nova:500"]);
        expect(late.activeMissions).toEqual([]);
        expect(late.completedMissions).toEqual([]);
        expect(late.failedMissions).toEqual(["nova:500"]);
        expect(late.legalRecord["nova:128"]).toEqual(-5); // -CompReward/2
        expect(isBitSet(late, 900)).toBeFalse(); // onFailure "!b900"
        expect(arrival.effects).toContain(jasmine.objectContaining(
            { kind: "text", purpose: "fail", text: "nova:9900" }));
    });

    it("propagates record changes to allies and enemies", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        setBit(state, 900);
        acceptMission(state, DEADLINE_MISSION, env, START.id);
        // Completing for the Federation (+10) is heard about beyond it:
        // ally Ally Govt gets the same half-delta (+5), enemy Polaris the
        // opposite half-delta (-5); classmate Vell-os (shares class 1) and
        // unrelated Rebels hear nothing — FUN_00440410.
        const arrival = processArrival(state, env, EARTH.id);
        expect(arrival.completed).toEqual(["nova:500"]);
        expect(state.legalRecord["nova:128"]).toEqual(10);
        expect(state.legalRecord["nova:129"]).toEqual(5);
        expect(state.legalRecord["nova:130"]).toEqual(-5);
        expect(state.legalRecord["nova:136"] ?? 0).toEqual(0);
        expect(state.legalRecord["nova:141"] ?? 0).toEqual(0);
        expect(arrival.effects).toContain(jasmine.objectContaining(
            { kind: "record", govt: "nova:128", delta: 10 }));
        expect(arrival.effects).toContain(jasmine.objectContaining(
            { kind: "record", govt: "nova:130", delta: -5 }));

        // Failing costs half the reward, propagated the same way (the
        // opposite half-delta rounds .5 away from zero).
        const late = makePlayerState();
        acceptMission(late, DEADLINE_MISSION, env, START.id);
        late.date = advanceDate(late.date, 6);
        const failure = processArrival(late, env, EARTH.id);
        expect(failure.failed).toEqual(["nova:500"]);
        expect(late.legalRecord["nova:128"]).toEqual(-5);
        expect(late.legalRecord["nova:129"]).toEqual(-3);
        expect(late.legalRecord["nova:130"]).toEqual(3);
    });

    it("auto-aborts flag 0x0001 missions with pay and datePostInc", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        setBit(state, 900);
        const accept = acceptMission(state, AUTO_ABORT_MISSION, env, START.id);
        const abort = abortMission(state, AUTO_ABORT_MISSION, accept.active!, env,
            { auto: true });
        expect(abort.aborted).toBeTrue();
        expect(state.activeMissions).toEqual([]);
        expect(state.completedMissions).toEqual([]); // aborted is neither
        expect(state.failedMissions).toEqual([]);
        expect(state.credits).toEqual(25000 + 5000); // flags2 0x0002 pay
        expect(state.date).toEqual(advanceDate({ day: 23, month: 6, year: 1177 }, 3));
        expect(isBitSet(state, 900)).toBeFalse(); // "^b900" toggled
        expect(abort.effects).toContain(jasmine.objectContaining(
            { kind: "pay", amount: 5000 }));
    });

    it("reverses 5x CompReward (record) on any abort; 0x0008 fuel is auto-abort only",
        function() {
            const state = makePlayerState();
            const { env } = makeTestEnv();
            const penalty = acceptMission(state, PENALTY_ABORT_MISSION, env, START.id);
            const abort = abortMission(state, PENALTY_ABORT_MISSION, penalty.active!, env, {});
            expect(abort.aborted).toBeTrue();
            // Flag 0x0040: -5x CompReward with the completion govt,
            // propagated at half-delta (Ally Govt -250, Polaris +250).
            expect(state.credits).toEqual(25000);
            expect(state.legalRecord["nova:128"]).toEqual(-500);
            expect(state.legalRecord["nova:129"]).toEqual(-250);
            expect(state.legalRecord["nova:130"]).toEqual(250);
            expect(abort.effects).toContain(jasmine.objectContaining(
                { kind: "record", govt: "nova:128", delta: -500 }));
            // Flag 0x0008's 100 fuel is "upon auto-abort" (Bible): a
            // player abort pays none.
            expect(abort.effects.filter(effect => effect.kind === "fuel")).toEqual([]);

            // The same mission auto-aborting: record reversal AND fuel
            // (both apply; flags2 0x0002 is unset, so no pay).
            const again = makePlayerState();
            again.activeRanks.push(FED_CRIME_RANK.id);
            const second = acceptMission(again, PENALTY_ABORT_MISSION, env, START.id);
            const auto = abortMission(again, PENALTY_ABORT_MISSION, second.active!, env,
                { auto: true });
            expect(auto.aborted).toBeTrue();
            expect(again.legalRecord["nova:128"]).toEqual(-500);
            expect(auto.effects).toContain(jasmine.objectContaining(
                { kind: "fuel", delta: -100 }));
            // The auto-abort is still a crime: the 0x0040 rank goes too.
            expect(again.activeRanks).not.toContain(FED_CRIME_RANK.id);

            const other = makePlayerState();
            const stuck = acceptMission(other, UNABORTABLE_MISSION, env, START.id);
            const refused = abortMission(other, UNABORTABLE_MISSION, stuck.active!, env, {});
            expect(refused.aborted).toBeFalse();
            expect(other.activeMissions.length).toEqual(1);
            // A set-expression A op (forced) bypasses canAbort.
            const forced = abortMission(other, UNABORTABLE_MISSION, stuck.active!, env,
                { forced: true });
            expect(forced.aborted).toBeTrue();
            expect(other.activeMissions).toEqual([]);
        });

    it("fires onRefuse and RefuseText unless flag 0x0004 blocks refusing", function() {
        const state = makePlayerState();
        const { env, setOps } = makeTestEnv();
        const refuse = refuseMission(state, M129, env);
        expect(refuse.refused).toBeTrue();
        expect(isBitSet(state, 4444)).toBeTrue();
        expect(setOps).toContain("S781");
        expect(refuse.effects).toContain(jasmine.objectContaining(
            { kind: "text", purpose: "refuse", text: "nova:20351" }));
        expect(refuse.effects).toContain(jasmine.objectContaining(
            { kind: "setExpr", when: "refuse", expr: "b4444 S781" }));

        const blocked = refuseMission(state, UNREFUSABLE_MISSION, env);
        expect(blocked.refused).toBeFalse();
        expect(blocked.effects).toEqual([]);
    });

    it("caps active missions at 16", function() {
        const state: PlayerState = makePlayerState();
        const { env } = makeTestEnv();
        for (let i = 0; i < 16; i++) {
            const filler: ActiveMission = {
                missionId: `nova:${1000 + i}`,
                originStellar: START.id,
                travelStellar: null,
                returnStellar: null,
                travelComplete: true,
                shipGoalComplete: false,
                failed: false,
                cargoLoaded: false,
                cargo: null,
                deadline: null,
                specialShips: null,
                auxShips: null,
            };
            state.activeMissions.push(filler);
        }
        const result = checkAvailability(M128, offerCtxFor(state, env, START, "nova:300"));
        expect(result.available).toBeFalse();
        expect(result.reasons.some(reason => reason.includes("16-mission cap"))).toBeTrue();
        expect(acceptMission(state, M128, env, START.id).accepted).toBeFalse();
    });

    it("matches duplicate stellars (same name and position) for returns", function() {
        const { env } = makeTestEnv();
        expect(landingMatchesStellar(EARTH_DUP, "nova:128", env)).toBeTrue();
        expect(landingMatchesStellar(EARTH, "nova:128", env)).toBeTrue();
        expect(landingMatchesStellar(BARREN, "nova:128", env)).toBeFalse();
        expect(landingMatchesStellar(START, "nova:128", env)).toBeFalse();
    });

    it("decodes PayVal credit, fine, and clean-record bands", function() {
        const state = makePlayerState();
        const { env, warnings } = makeTestEnv();

        // Plain credits.
        applyPay(state, 15000, env, [], false);
        expect(state.credits).toEqual(40000);

        // -10128: clean record with the Federation only.
        state.legalRecord["nova:128"] = -50;
        state.legalRecord["nova:136"] = -10;
        applyPay(state, -10128, env, [], false);
        expect(state.legalRecord["nova:128"]).toEqual(0);
        expect(state.legalRecord["nova:136"]).toEqual(-10);

        // -20128: also allies (Ally Govt, class 5 = a Federation ally).
        state.legalRecord["nova:128"] = -50;
        state.legalRecord["nova:129"] = -20;
        state.legalRecord["nova:136"] = -10;
        applyPay(state, -20128, env, [], false);
        expect(state.legalRecord["nova:128"]).toEqual(0);
        expect(state.legalRecord["nova:129"]).toEqual(0);
        expect(state.legalRecord["nova:136"]).toEqual(-10); // classmates not in band 2

        // -20129 (cleaning the ALLY's record) also cleans the FEDERATION:
        // the alliance reads in both directions, like changeRecord.
        state.legalRecord["nova:128"] = -50;
        state.legalRecord["nova:129"] = -20;
        applyPay(state, -20129, env, [], false);
        expect(state.legalRecord["nova:129"]).toEqual(0);
        expect(state.legalRecord["nova:128"]).toEqual(0);

        // -30128: also classmates (Vell-os shares class 1).
        state.legalRecord["nova:136"] = -10;
        applyPay(state, -30128, env, [], false);
        expect(state.legalRecord["nova:136"]).toEqual(0);

        // -40025: the government takes 25% of cash.
        state.credits = 10000;
        applyPay(state, -40025, env, [], false);
        expect(state.credits).toEqual(7500);

        // -50123: a 123-credit price, debited at accept only.
        const acceptEffects: unknown[] = [];
        applyPay(state, -50123, env, acceptEffects as never, true);
        expect(state.credits).toEqual(7500 - 123);
        applyPay(state, -50123, env, [], false);
        expect(state.credits).toEqual(7500 - 123); // unchanged, warned
        expect(warnings.some(w => w.includes("-50123"))).toBeTrue();

        // Out-of-band negative values warn and do nothing.
        applyPay(state, -5000, env, [], false);
        expect(warnings.some(w => w.includes("-5000"))).toBeTrue();
    });

    it("resolves random destinations preferring 2+ jumps and busy systems", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const rng = () => makeRng(123)();

        // -1 travel: no destination; -4 return: the origin.
        expect(resolveDestination(state, env, -1, "travel", START.id, rng)).toBeNull();
        expect(resolveDestination(state, env, -4, "return", START.id, rng)).toEqual(START.id);
        // Specific code.
        expect(resolveDestination(state, env, 408, "travel", START.id, rng))
            .toEqual(VELLOS_WORLD.id);

        // -2 random inhabited: the >=2-jump, multiple-static-occupant pool
        // is {Earth, Vell-os Prime} (Sol has two planets); Barren Rock is
        // uninhabited and Far Station unreachable.
        const pick = resolveDestination(state, env, -2, "travel", START.id, rng);
        expect([EARTH.id, VELLOS_WORLD.id]).toContain(pick!);
        expect(resolveDestination(state, env, -2, "travel", START.id, rng)).toEqual(pick);

        // -3 random uninhabited: only Barren Rock matches.
        expect(resolveDestination(state, env, -3, "travel", START.id, rng))
            .toEqual(BARREN.id);

        // 10000: Federation-owned; from Start One the only far candidate is
        // Earth.
        expect(resolveDestination(state, env, 10000, "travel", START.id, rng))
            .toEqual(EARTH.id);
    });

    it("runs travel legs with pickup mode 1 and dropoff mode 0", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();

        // m129: specific travel stellar, no cargo.
        const m129 = acceptMission(state, M129, env, START.id);
        expect(m129.active!.travelStellar).toEqual(VELLOS_WORLD.id);
        expect(m129.active!.travelComplete).toBeFalse();
        const visit = processArrival(state, env, VELLOS_WORLD.id);
        expect(visit.completed).toEqual([]); // the return is still Earth
        expect(m129.active!.travelComplete).toBeTrue();
        expect(visit.effects.filter(effect => effect.kind === "cargo")).toEqual([]);
        // Returning to Earth completes with the CompReward record.
        const home = processArrival(state, env, EARTH.id);
        expect(home.completed).toEqual(["nova:129"]);
        expect(state.credits).toEqual(25000 + 15000);
        expect(state.legalRecord["nova:136"]).toEqual(5);
        expect(m129.active!.returnStellar).toEqual(EARTH.id);

        // Ferry: pickup at accept, dropoff + completion on the travel landing.
        const ferryState = makePlayerState();
        const ferry = acceptMission(ferryState, FERRY_MISSION, env, START.id);
        expect(ferry.active!.cargoLoaded).toBeTrue();
        expect(ferry.effects).toContain(jasmine.objectContaining(
            { kind: "cargo", qty: ferry.active!.cargo!.qty }));
        expect(ferry.active!.travelStellar).toEqual(EARTH.id);
        const enRoute = processArrival(ferryState, env, BARREN.id);
        expect(enRoute.completed).toEqual([]);
        expect(ferry.active!.travelComplete).toBeFalse();
        const delivered = processArrival(ferryState, env, EARTH.id);
        expect(delivered.completed).toEqual(["nova:506"]);
        expect(ferryState.activeMissions).toEqual([]);
        expect(delivered.effects).toContain(jasmine.objectContaining(
            { kind: "cargo", type: ferry.active!.cargo!.type,
              qty: -ferry.active!.cargo!.qty }));
    });

    it("blocks a cargo pickup that does not fit in the hold", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        // M128 loads PickupMode-0 cargo at accept; with zero free tons the
        // shipment stays behind instead.
        const accept = acceptMission(state, M128, env, START.id, 0);
        expect(accept.accepted).toBeTrue();
        expect(accept.active!.cargo).not.toBeNull();
        expect(accept.active!.cargoLoaded).toBeFalse();
        expect(accept.effects).toContain(jasmine.objectContaining(
            { kind: "cargoBlocked", type: accept.active!.cargo!.type,
              qty: accept.active!.cargo!.qty }));
        expect(accept.effects).not.toContain(jasmine.objectContaining(
            { kind: "cargo" }));
        // A blocked pickup never fires its load text.
        expect(accept.effects).not.toContain(jasmine.objectContaining(
            { purpose: "loadCargo" }));
        // The mission still runs: delivering completes it, with nothing to
        // drop (cargoLoaded stayed false).
        const arrival = processArrival(state, env, EARTH.id, 0);
        expect(arrival.completed).toEqual([M128.id]);
        expect(arrival.effects).not.toContain(jasmine.objectContaining(
            { kind: "cargo" }));
        expect(state.activeMissions).toEqual([]);
    });

    it("shares the landing's free tons across several cargo pickups", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        // A pickup-on-arrival mission, never offered (availRandom 0); two
        // active instances land on the same travel stellar with 15 free
        // tons for 20 tons of cargo. The return stellar is elsewhere, so
        // this landing only completes the travel legs.
        const pickup = makeMission("nova:601", {
            travelStel: 128,
            returnStel: 408,
            pickupMode: 1,
            dropoffMode: 1,
            cargoType: 3,
            cargoQty: 10,
            availRandom: 0,
            availLoc: -1,
        });
        MISSIONS.set(pickup.id, pickup);
        for (let i = 0; i < 2; i++) {
            state.activeMissions.push({
                missionId: pickup.id,
                originStellar: START.id,
                travelStellar: EARTH.id,
                returnStellar: VELLOS_WORLD.id,
                travelComplete: false,
                shipGoalComplete: false,
                failed: false,
                cargoLoaded: false,
                cargo: { type: 3, qty: 10 },
                deadline: null,
                specialShips: null,
                auxShips: null,
            });
        }
        const arrival = processArrival(state, env, EARTH.id, 15);
        expect(arrival.effects).toEqual(jasmine.arrayContaining([
            jasmine.objectContaining({ kind: "cargo", type: 3, qty: 10 }),
            jasmine.objectContaining({ kind: "cargoBlocked", type: 3, qty: 10 }),
        ]));
        expect(state.activeMissions[0].cargoLoaded).toBeTrue();
        expect(state.activeMissions[1].cargoLoaded).toBeFalse();
    });

    it("completes bounty missions (ReturnStel -1) when the ship goal is met", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        const accept = acceptMission(state, BOUNTY_MISSION, env, START.id);
        expect(accept.active!.specialShips).toEqual(jasmine.objectContaining(
            { remaining: 2, initial: 2 }));
        // Landing alone does not complete it: the goal is unmet.
        const visit = processArrival(state, env, EARTH.id);
        expect(visit.completed).toEqual([]);
        expect(state.activeMissions.length).toEqual(1);
        // Meeting the goal completes it on the spot.
        const effects = markShipGoalComplete(state, BOUNTY_MISSION, accept.active!, env);
        expect(state.activeMissions).toEqual([]);
        expect(state.completedMissions).toEqual(["nova:505"]);
        expect(isBitSet(state, 700)).toBeTrue();
        expect(effects).toContain(jasmine.objectContaining(
            { kind: "setExpr", when: "shipDone", expr: "b700" }));
    });

    it("matches system filter codes for ship spawning", function() {
        const { env } = makeTestEnv();
        const baseCtx = {
            originSystemId: "nova:300",
            playerSystemId: "nova:301",
            travelStellarId: VELLOS_WORLD.id,
            returnStellarId: EARTH.id,
            systemOfPlanet: (id: string): string | null => {
                for (const [systemId, system] of SYSTEMS) {
                    if (system.planets.includes(id)) {
                        return systemId;
                    }
                }
                return null;
            },
            system: (id: string) => env.system(id),
            planet: (id: string) => env.planet(id),
            government: (id: string | null) => env.government(id),
            govtByRawId: (rawId: number) => env.govtByRawId(rawId),
        };
        const s0 = SYSTEMS.get("nova:300")!;
        const s1 = SYSTEMS.get("nova:301")!;
        const s2 = SYSTEMS.get("nova:302")!;
        const s3 = SYSTEMS.get("nova:303")!;

        expect(systemMatchesSystemFilter(s0, { kind: "originSystem" }, baseCtx)).toBeTrue();
        expect(systemMatchesSystemFilter(s1, { kind: "originSystem" }, baseCtx)).toBeFalse();
        expect(systemMatchesSystemFilter(s0, { kind: "anyRandom" }, baseCtx)).toBeTrue();
        // The travel stellar is in Sol (nova:302).
        expect(systemMatchesSystemFilter(s2,
            { kind: "travelStellarSystem" }, baseCtx)).toBeTrue();
        expect(systemMatchesSystemFilter(s0,
            { kind: "travelStellarSystem" }, baseCtx)).toBeFalse();
        expect(systemMatchesSystemFilter(s2,
            { kind: "returnStellarSystem" }, baseCtx)).toBeTrue();
        // Adjacent to the origin (S0): S1 is linked, S3 is not.
        expect(systemMatchesSystemFilter(s1, { kind: "adjacentToOrigin" }, baseCtx)).toBeTrue();
        expect(systemMatchesSystemFilter(s3, { kind: "adjacentToOrigin" }, baseCtx)).toBeFalse();
        expect(systemMatchesSystemFilter(s1, { kind: "playerSystem" }, baseCtx)).toBeTrue();
        expect(systemMatchesSystemFilter(s0,
            { kind: "specific", rawId: 300 }, baseCtx)).toBeTrue();
        // In or adjacent to system 301: S1 itself and both neighbors.
        expect(systemMatchesSystemFilter(s1,
            { kind: "nearSystem", systemRawId: 301 }, baseCtx)).toBeTrue();
        expect(systemMatchesSystemFilter(s0,
            { kind: "nearSystem", systemRawId: 301 }, baseCtx)).toBeTrue();
        expect(systemMatchesSystemFilter(s3,
            { kind: "nearSystem", systemRawId: 301 }, baseCtx)).toBeFalse();
        // 10000 = systems containing a Federation planet: S0 (Start One) and
        // S2 (Earth), not S1 (its planets are independent or the ally).
        const fedBand = { kind: "govt" as const, relation: "owned" as const, govtRawId: 128 };
        expect(systemMatchesSystemFilter(s0, fedBand, baseCtx)).toBeTrue();
        expect(systemMatchesSystemFilter(s2, fedBand, baseCtx)).toBeTrue();
        expect(systemMatchesSystemFilter(s1, fedBand, baseCtx)).toBeFalse();
    });

    // P7 acceptance: the whole scripted Vell-os opening, headless.
    it("runs the Vellos opening end to end: Vellos1, delivery, Vellos2, jump", function() {
        const state = makePlayerState();
        const { env } = makeTestEnv();
        // Force the rolls: m128's 8% passes at 3, m129's 40% at 39.
        state.availRandomRolls["nova:128"] = 3;
        state.availRandomRolls["nova:129"] = 39;

        // Vellos1 (m128) is offered on the start BBS and accepted.
        expect(checkAvailability(M128, offerCtxFor(state, env, START, "nova:300", "bbs",
            { freeCargoTons: 20 })).available).toBeTrue();
        const first = acceptMission(state, M128, env, START.id);
        expect(first.accepted).toBeTrue();
        expect(first.active!.cargoLoaded).toBeTrue();

        // Jump to Sol: one day passes and the warp-in rolls re-roll.
        state.date = advanceDate(state.date, 1);
        state.currentSystem = "nova:302";
        state.exploredSystems.push("nova:302");
        rerollAvailRandomRolls(state, env.allMissionIds(), makeRng(jumpRerollSeed(state)));
        state.availRandomRolls["nova:129"] = 39;

        // Deliver on Earth: +15000 credits, b350/b6666 set by onSuccess.
        const arrival = processArrival(state, env, EARTH.id);
        expect(arrival.completed).toEqual(["nova:128"]);
        expect(state.credits).toEqual(25000 + 15000);
        expect(isBitSet(state, 350)).toBeTrue();
        expect(isBitSet(state, 6666)).toBeTrue();
        expect(state.completedMissions).toEqual(["nova:128"]);

        // Vellos2 (m129) is now offered at the Earth spaceport: crön 221
        // clears the "mission just finished" flag b6666 through the real
        // scheduler (activate on completion day, OnEnd fires the next day).
        const cronEnv = makeCronEnv(env)!;
        processCrons(state, cronEnv, makeRng(cronSeed(state)));
        state.date = advanceDate(state.date, 1);
        processCrons(state, cronEnv, makeRng(cronSeed(state)));
        expect(isBitSet(state, 6666)).toBeFalse();
        expect(checkAvailability(M129, offerCtxFor(state, env, EARTH, "nova:302",
            "spaceport")).available).toBeTrue();
        const second = acceptMission(state, M129, env, EARTH.id);
        expect(second.accepted).toBeTrue();
        expect(isBitSet(state, 511)).toBeTrue(); // onAccept
        const active = second.active!;
        expect(active.travelStellar).toEqual(VELLOS_WORLD.id);
        expect(active.returnStellar).toEqual(EARTH.id);
        expect(active.travelComplete).toBeFalse();
        expect(active.deadline).toBeNull(); // no time limit
        expect(state.credits).toEqual(40000); // pay on delivery, not accept

        // Jump: the mission stays active, un-failed, waiting on its leg.
        state.date = advanceDate(state.date, 1);
        rerollAvailRandomRolls(state, env.allMissionIds(), makeRng(jumpRerollSeed(state)));
        expect(state.activeMissions).toEqual([active]);
        expect(active.travelComplete).toBeFalse();
        expect(active.failed).toBeFalse();
        expect(isBitSet(state, 511)).toBeTrue();
        expect(isBitSet(state, 4444)).toBeFalse(); // never refused
    });
});

