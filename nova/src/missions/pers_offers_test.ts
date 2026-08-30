// Headless specs for përs hail quotes and AvailLoc-2 ("offered from ship")
// missions (P4): the hail-quote flag matrix, the player-ship gating flags,
// the ship-location availability and offer flow (computeShipOffers →
// accept/refuse → the përs's on-accept flag effects). Run with:
//   npx esbuild --bundle --platform=node nova/src/missions/pers_offers_test.ts \
//       --outfile=/tmp/pers_offers_test.js && node_modules/.bin/jasmine /tmp/pers_offers_test.js

import "jasmine";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { MockGameData } from "novadatainterface/MockGameData";
import { MissionData } from "novadatainterface/MissionData";
import { getDefaultPersData, PersData } from "novadatainterface/PersData";
import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import { GameMissionTextEnv } from "../spaceport/briefing";
import {
    acceptOffer,
    computeShipOffers,
    MissionUiEnv,
    refuseOffer,
} from "../spaceport/mission_bbs";
import { PlayerState } from "../player/player_state";
import { checkAvailability } from "./availability";
import { nextSpecialShipType } from "./mission_ship_goals";
import {
    PERS_FLAG_DEACTIVATE,
    PERS_FLAG_HAIL_ATTACKING,
    PERS_FLAG_HAIL_DISABLED,
    PERS_FLAG_HAIL_GRUDGE_ONLY,
    PERS_FLAG_HAIL_LIKES_PLAYER,
    PERS_FLAG_LEAVES,
    PERS_FLAG_NO_AI_1,
    PERS_FLAG_NO_AI_2,
    PERS_FLAG_NO_WARSHIP,
    PERS_FLAG_QUOTE_ONCE,
    PERS_FLAG_REPLACE_SHIP,
    PERS_FLAG_BOARD_OFFER,
    applyPersOfferAccept,
    hailQuoteFacts,
    persBoardOfferMissionId,
    persOfferMissionId,
    recordQuoteShown,
    shipOfferEligible,
    shouldShowHailQuote,
} from "./pers_offers";
import {
    makeMission,
    makePlayerState,
    makeTestEnv,
    MISSIONS,
    START,
} from "./test_fixtures";

const PERS_ID = "nova:131";
const GOVT_ID = "nova:128"; // Federation, the fixtures' START government.

const SHIP: ShipData = {
    ...getDefaultShipData(),
    id: "nova:600",
    name: "Falcon",
    inherentAI: 1,
};

// A stock-shaped "offered from ship" mission: AvailLoc 2, always offered.
// onAccept/refuseText give accept/refuse observable effects through the
// shared machinery.
const SHIP_MISSION: MissionData = makeMission("nova:706", {
    name: "Ferry the Përs's Cargo",
    availStel: -1,
    availLoc: 2,
    availRandom: 100,
    onAccept: "b511",
    refuseText: "nova:20351",
    shipCount: 1,
    shipGoal: 2,
});

const QUIET_PERS: PersData = {
    ...getDefaultPersData(),
    id: PERS_ID,
    name: "Jack Folstam",
    govt: GOVT_ID,
    hailQuote: 3,
    commQuote: 2,
    shipType: SHIP.id,
    linkMission: SHIP_MISSION.id,
};

function makeUi(state: PlayerState, gameData: GameDataInterface,
    overrides: Partial<MissionUiEnv> = {}): MissionUiEnv {
    const { env } = makeTestEnv();
    return {
        playerState: state,
        env,
        textEnv: new GameMissionTextEnv(env, gameData),
        gameData,
        landedStellarId: START.id,
        shipName: SHIP.name,
        shipTypeName: SHIP.name,
        shipData: SHIP,
        shipInherentAI: SHIP.inherentAI,
        ...overrides,
    };
}

function facts(overrides: Partial<ReturnType<typeof hailQuoteFacts>> = {}):
    ReturnType<typeof hailQuoteFacts> {
    return {
        grudge: false,
        disabled: false,
        attacking: false,
        likesPlayer: false,
        quoteShown: false,
        ...overrides,
    };
}


describe("përs hail quotes", () => {
    it("shows the quote when no gating flag is set", () => {
        expect(shouldShowHailQuote(QUIET_PERS, facts())).toBeTrue();
    });

    it("never shows a quote the përs does not have", () => {
        expect(shouldShowHailQuote(
            { ...QUIET_PERS, hailQuote: 0 }, facts())).toBeFalse();
    });

    it("honors the grudge-only flag (0x0004)", () => {
        const pers = { ...QUIET_PERS, flags: PERS_FLAG_HAIL_GRUDGE_ONLY };
        expect(shouldShowHailQuote(pers, facts())).toBeFalse();
        expect(shouldShowHailQuote(pers, facts({ grudge: true }))).toBeTrue();
    });

    it("honors the likes-player flag (0x0008) via the legal record", () => {
        const pers = { ...QUIET_PERS, flags: PERS_FLAG_HAIL_LIKES_PLAYER };
        expect(shouldShowHailQuote(pers, facts())).toBeFalse();
        expect(shouldShowHailQuote(pers,
            facts({ likesPlayer: true }))).toBeTrue();
    });

    it("derives likes-player from the legal record of the përs's govt", () => {
        const state = makePlayerState();
        expect(hailQuoteFacts(QUIET_PERS, state, {}).likesPlayer).toBeFalse();

        state.legalRecord[GOVT_ID] = 1;
        expect(hailQuoteFacts(QUIET_PERS, state, {}).likesPlayer).toBeTrue();

        // A negative record is not affection, and a govt-less përs cannot
        // like anyone.
        state.legalRecord[GOVT_ID] = -5;
        expect(hailQuoteFacts(QUIET_PERS, state, {}).likesPlayer).toBeFalse();
        expect(hailQuoteFacts({ ...QUIET_PERS, govt: null }, state, {})
            .likesPlayer).toBeFalse();
    });

    it("honors the attacking flag (0x0010)", () => {
        const pers = { ...QUIET_PERS, flags: PERS_FLAG_HAIL_ATTACKING };
        expect(shouldShowHailQuote(pers, facts())).toBeFalse();
        expect(shouldShowHailQuote(pers, facts({ attacking: true }))).toBeTrue();
    });

    it("honors the disabled flag (0x0020)", () => {
        const pers = { ...QUIET_PERS, flags: PERS_FLAG_HAIL_DISABLED };
        expect(shouldShowHailQuote(pers, facts())).toBeFalse();
        expect(shouldShowHailQuote(pers, facts({ disabled: true }))).toBeTrue();
    });

    it("honors the quote-once flag (0x0080) through the persisted state", () => {
        const pers = { ...QUIET_PERS, flags: PERS_FLAG_QUOTE_ONCE };
        const state = makePlayerState();

        const first = hailQuoteFacts(pers, state, {});
        expect(shouldShowHailQuote(pers, first)).toBeTrue();

        // Showing the quote latches it for this pilot; the next hail is
        // silent.
        expect(recordQuoteShown(state, PERS_ID)).toBeTrue();
        expect(shouldShowHailQuote(pers, hailQuoteFacts(pers, state, {})))
            .toBeFalse();

        // The latch is idempotent and keeps the rest of the record.
        expect(recordQuoteShown(state, PERS_ID)).toBeFalse();
        state.pers[PERS_ID].grudge = true;
        recordQuoteShown(state, PERS_ID);
        expect(state.pers[PERS_ID].grudge).toBeTrue();

        // Without the flag, showing once does not silence the përs.
        expect(shouldShowHailQuote(QUIET_PERS,
            hailQuoteFacts(QUIET_PERS, state, {}))).toBeTrue();
    });

    it("requires every set gating flag to hold at once", () => {
        const pers = {
            ...QUIET_PERS,
            flags: PERS_FLAG_HAIL_GRUDGE_ONLY | PERS_FLAG_HAIL_DISABLED,
        };
        expect(shouldShowHailQuote(pers,
            facts({ grudge: true }))).toBeFalse();
        expect(shouldShowHailQuote(pers,
            facts({ disabled: true }))).toBeFalse();
        expect(shouldShowHailQuote(pers,
            facts({ grudge: true, disabled: true }))).toBeTrue();
    });
});


describe("përs offer gating by player ship", () => {
    it("offers freely when no AI flag is set", () => {
        for (const ai of [null, 0, 1, 2, 3, 4]) {
            expect(shipOfferEligible(QUIET_PERS, ai)).toBeTrue();
        }
    });

    it("excludes wimpy-trader players under 0x1000", () => {
        const pers = { ...QUIET_PERS, flags: PERS_FLAG_NO_AI_1 };
        expect(shipOfferEligible(pers, 1)).toBeFalse();
        expect(shipOfferEligible(pers, 2)).toBeTrue();
        expect(shipOfferEligible(pers, null)).toBeTrue();
    });

    it("excludes trader players under 0x2000", () => {
        const pers = { ...QUIET_PERS, flags: PERS_FLAG_NO_AI_2 };
        expect(shipOfferEligible(pers, 2)).toBeFalse();
        expect(shipOfferEligible(pers, 1)).toBeTrue();
    });

    it("excludes warship players under 0x4000", () => {
        const pers = { ...QUIET_PERS, flags: PERS_FLAG_NO_WARSHIP };
        expect(shipOfferEligible(pers, 3)).toBeFalse();
        expect(shipOfferEligible(pers, 4)).toBeFalse();
        expect(shipOfferEligible(pers, 1)).toBeTrue();
        expect(shipOfferEligible(pers, null)).toBeTrue();
    });

    it("does not offer boarding-time missions on hail (0x0200, P5)", () => {
        expect(persOfferMissionId(QUIET_PERS)).toEqual(SHIP_MISSION.id);
        expect(persOfferMissionId(
            { ...QUIET_PERS, linkMission: null })).toBeNull();
        expect(persOfferMissionId(
            { ...QUIET_PERS, flags: PERS_FLAG_BOARD_OFFER })).toBeNull();
    });

    it("offers boarding-time missions on the board route only (0x0200)",
        () => {
            expect(persBoardOfferMissionId(QUIET_PERS)).toBeNull();
            expect(persBoardOfferMissionId(
                { ...QUIET_PERS, flags: PERS_FLAG_BOARD_OFFER }))
                .toEqual(SHIP_MISSION.id);
            expect(persBoardOfferMissionId(
                { ...QUIET_PERS, flags: PERS_FLAG_BOARD_OFFER,
                    linkMission: null })).toBeNull();
        });
});


describe("ship-location (AvailLoc 2) offers", () => {
    beforeAll(() => {
        MISSIONS.set(SHIP_MISSION.id, SHIP_MISSION);
    });

    it("offers AvailLoc-2 missions at the ship location now", () => {
        const { env } = makeTestEnv();
        const state = makePlayerState();
        const result = checkAvailability(SHIP_MISSION, {
            landedStellar: env.planet(state.lastStellar!),
            landedStellarId: state.lastStellar!,
            systemId: env.systemOfPlanet(state.lastStellar!)!,
            location: "ship",
            playerState: state,
            shipData: SHIP,
            shipContribute: [0, 0],
            shipInherentAI: SHIP.inherentAI,
            fuel: null,
            freeCargoTons: null,
            ownedOutfits: {},
            outfitContributes: [],
            government: id => env.government(id),
            govtByRawId: rawId => env.govtByRawId(rawId),
            system: id => env.system(id),
        });
        expect(result.available).toBeTrue();
    });

    it("computes ship offers from the last landed stellar", async () => {
        const state = makePlayerState();
        const ui = makeUi(state, new MockGameData());

        const offers = await computeShipOffers(ui);
        expect(offers.map(offer => offer.mission.id))
            .toEqual([SHIP_MISSION.id]);
        // Accepting would record the last landed stellar as the origin.
        expect(offers[0].active.originStellar).toEqual(START.id);
    });

    it("keeps BBS missions off the ship offer list", async () => {
        const ui = makeUi(makePlayerState(), new MockGameData());
        const offers = await computeShipOffers(ui);
        expect(offers.some(offer => offer.mission.availLoc !== 2)).toBeFalse();
    });

    it("offers nothing to a pilot who never landed", async () => {
        const state = makePlayerState();
        state.lastStellar = null;
        const offers = await computeShipOffers(makeUi(state, new MockGameData()));
        expect(offers).toEqual([]);
    });

    it("applies the mission's AI flags to the player's ship (rule 9)", async () => {
        const state = makePlayerState();
        // The fixtures ship is an inherent-AI-1 (wimpy trader).
        const ui = makeUi(state, new MockGameData(), { shipInherentAI: 1 });

        MISSIONS.set(SHIP_MISSION.id, { ...SHIP_MISSION, flags: 0x2000 });
        expect((await computeShipOffers(ui)).length).toEqual(0);
        MISSIONS.set(SHIP_MISSION.id, { ...SHIP_MISSION, flags: 0x4000 });
        expect((await computeShipOffers(ui)).length).toEqual(1);
        MISSIONS.set(SHIP_MISSION.id, SHIP_MISSION);
    });
});


describe("the përs offer flow", () => {
    beforeAll(() => {
        MISSIONS.set(SHIP_MISSION.id, SHIP_MISSION);
    });

    function offerState(): { state: PlayerState, ui: MissionUiEnv } {
        const state = makePlayerState();
        return { state, ui: makeUi(state, new MockGameData()) };
    }

    async function findOffer(ui: MissionUiEnv) {
        const offers = await computeShipOffers(ui);
        return offers.find(offer => offer.mission.id === SHIP_MISSION.id)!;
    }

    it("accepts through the shared machinery and records the përs effects",
        async () => {
            const { state, ui } = offerState();
            const pers: PersData = {
                ...QUIET_PERS,
                flags: PERS_FLAG_DEACTIVATE | PERS_FLAG_LEAVES
                    | PERS_FLAG_REPLACE_SHIP,
            };
            const offer = await findOffer(ui);

            const effects = acceptOffer(ui, offer);
            expect(effects.length).toBeGreaterThan(0);
            const active = state.activeMissions
                .find(m => m.missionId === SHIP_MISSION.id)!;
            expect(active.originStellar).toEqual(START.id);

            const persEffects = applyPersOfferAccept(state, pers);
            expect(persEffects).toEqual({
                deactivated: true,
                leaves: true,
                replacedByMission: true,
            });
            expect(state.pers[PERS_ID].status).toEqual("deactivated");
            // The replacement pins the mission spawn type to the përs's ship.
            expect(active.specialShips!.pinnedTypes).toEqual([SHIP.id]);

            // The pin replays on every later spawn entry even without the
            // mïsn 0x0800 flag.
            expect(nextSpecialShipType(SHIP_MISSION, active.specialShips!,
                () => "nova:999", () => 0, 0)).toEqual(SHIP.id);
        });

    it("leaves the përs alone on refusal", async () => {
        const { state, ui } = offerState();
        const offer = await findOffer(ui);

        const effects = refuseOffer(ui, offer);
        expect(effects.some(effect => effect.kind === "text")).toBeTrue();
        expect(state.activeMissions.length).toEqual(0);
        expect(state.pers[PERS_ID]).toBeUndefined();
        expect(applyPersOfferAccept(state, QUIET_PERS)).toEqual({
            deactivated: false,
            leaves: false,
            replacedByMission: false,
        });
    });

    it("applies only the flags the përs carries", () => {
        const { state, ui } = offerState();
        void ui;
        expect(applyPersOfferAccept(state,
            { ...QUIET_PERS, flags: PERS_FLAG_LEAVES })).toEqual({
                deactivated: false,
                leaves: true,
                replacedByMission: false,
            });
        expect(state.pers[PERS_ID]).toBeUndefined();

        // Deactivation without a replacement still sticks, and a përs
        // without a ship cannot pin a spawn type.
        const leaver = applyPersOfferAccept(state,
            { ...QUIET_PERS, flags: PERS_FLAG_DEACTIVATE, shipType: null });
        expect(leaver).toEqual({
            deactivated: true,
            leaves: false,
            replacedByMission: false,
        });
        expect(state.pers[PERS_ID].status).toEqual("deactivated");
    });
});
