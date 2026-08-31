// The bar: missions offered by patrons (AvailLoc 1). Like the mission BBS
// but refusing an offer here may show the mission's RefuseText (dësc text,
// expanded like a briefing). The spaceport only adds a Bar button on
// planets with a bar (spöb flag 0x00040 → PlanetData.hasBar).
//
// Fidelity (bar FUN_0047c8e0): the bar opens its own screen — PICT 8503
// backdrop with a welcome text from dësc(10000 + spob govt) — even when no
// patron has a mission. Its offers pop from the shared not-BBS queue
// (FUN_0043cf00 pass 1) re-filtered to AvailLoc 1 (FUN_00448670(1)), so
// computeOffers('bar') passes the whole queue and the bar lists only the
// AvailLoc-1 entries.

import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { MissionEffect } from '../missions/mission_state_machine';
import { rawIdOf } from '../missions/stellar_filter';
import { BBS_LIST_POS, TextDialog } from './briefing';
import {
    MissionBBS,
    MissionOffer,
    MissionUiEnv,
} from './mission_bbs';
import { expandMissionText } from './mission_text';

// The bar backdrop (binary PICT 8503) and the welcome-text dësc band.
const BAR_BACKDROP = "nova:8503";
const BAR_WELCOME_DESC_BASE = 10000;

const FONT = {
    welcome: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'left', wordWrap: true, wordWrapWidth: 301
    } as const,
};

export class Bar extends MissionBBS {
    private refuseTextDialog: TextDialog;
    // The welcome text (dësc 10000 + govt raw id), fetched per show().
    private welcomeText = "";

    constructor(makeUi: () => Promise<MissionUiEnv>,
        controlEvents: Observable<ControlEvent>, gameData: GameData) {
        super(makeUi, controlEvents, gameData, BAR_BACKDROP);
        this.container.name = 'Bar';
        this.refuseTextDialog = new TextDialog(gameData, controlEvents);
        this.container.addChild(this.refuseTextDialog.container);
    }

    protected override get location() {
        return "bar" as const;
    }

    // The bar pops only AvailLoc-1 offers from the shared queue
    // (FUN_00448670(1)); `ui` drives the welcome text.
    override async showOffers(offers: MissionOffer[],
        onRefused?: (offer: MissionOffer, effects: MissionEffect[]) => Promise<void>,
        ui?: MissionUiEnv):
        Promise<void> {
        if (ui) {
            await this.loadWelcomeText(ui);
        }
        await super.showOffers(
            offers.filter(offer => offer.mission.availLoc === 1),
            async (offer, effects) => {
                await this.showRefuseText(offer, effects);
                if (onRefused) {
                    await onRefused(offer, effects);
                }
            });
    }

    // dësc(10000 + spob govt raw id): the patron small-talk the binary
    // opens the bar with (FUN_004c6d50). A missing dësc shows no text.
    private async loadWelcomeText(ui: MissionUiEnv) {
        this.welcomeText = "";
        const planet = ui.env.planet(ui.landedStellarId);
        if (!planet) {
            return;
        }
        const govtRawId = planet.govt === null ? 0 : rawIdOf(planet.govt);
        try {
            const dësc = await this.gameData.data.Desc.get(
                `nova:${BAR_WELCOME_DESC_BASE + govtRawId}`);
            this.welcomeText = dësc?.text ?? "";
        }
        catch {
            this.welcomeText = "";
        }
    }

    // The welcome text fills the top of the text box; the patron offers
    // list below it.
    protected override drawList(offers: MissionOffer[]) {
        this.listContainer.removeChildren();
        if (this.welcomeText === "") {
            this.drawEntries(offers, BBS_LIST_POS.y);
            return;
        }
        const welcome = new PIXI.Text(this.welcomeText, FONT.welcome);
        welcome.position.x = BBS_LIST_POS.x;
        welcome.position.y = BBS_LIST_POS.y;
        this.listContainer.addChild(welcome);
        this.drawEntries(offers, BBS_LIST_POS.y + welcome.height + 12);
    }

    // Bar refusals show the mission's RefuseText, expanded against the
    // current state like a briefing (the state machine ships the raw dësc
    // text in the effect; mutable blocks may have flipped on refusal).
    private async showRefuseText(offer: MissionOffer, effects: MissionEffect[]) {
        const refused = effects.find(effect => effect.kind === "text"
            && effect.purpose === "refuse");
        if (!refused || refused.kind !== "text") {
            return;
        }
        await this.refuseTextDialog.showText(
            expandMissionText(refused.text, offer.textCtx));
    }
}
