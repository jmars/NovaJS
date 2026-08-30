// Comm dialog (P4 of the ship-interaction layer): what opens when a hailed
// përs has a mission for the player (mïsn AvailLoc 2). Reuses the
// Menu/Button machinery exactly like the briefing dialog — the përs's
// HailPict on the briefing's pict spot and its CommQuote (1-based STR#
// 7100) as the text, with an Accept Mission button only when the përs's
// LinkMission is actually available (computeShipOffers). Accepting/refusing
// goes through the shared acceptOffer/refuseOffer plumbing; the përs's own
// on-accept flag effects (pers_offers.ts) ride along.

import { PersData } from "novadatainterface/PersData";
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { MissionEffect } from '../missions/mission_state_machine';
import { globalId } from '../missions/stellar_filter';
import { queuePlayerStateSave } from '../missions/mission_plugin';
import {
    applyPersOfferAccept,
    PersOfferAcceptEffects,
    persBoardOfferMissionId,
    persOfferMissionId,
    shipOfferEligible,
} from '../missions/pers_offers';
import { acceptOffer, computeShipOffers, logEffects, MissionOffer,
    MissionUiEnv, refuseOffer } from './mission_bbs';
import { BriefingDialog, GameMissionTextEnv } from './briefing';
import { Button } from './button';
import { Menu } from './menu';

// STR# 7100 CommQuote / STR# 7101 HailQuote: the përs fields are 1-based
// indices into these sets.
const COMM_QUOTE_STR = 7100;

const FALLBACK_ACCEPT_LABEL = "Accept Mission";
const DONE_LABEL = "Done";

const FONT = {
    comm: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'left', wordWrap: true, wordWrapWidth: 301
    } as const,
};

export interface CommInput {
    name: string;
    // HailPict raw id; below 128 shows no graphic (stock convention, same
    // as the briefing dësc PICT).
    pict: number;
    quote: string;         // CommQuote text, already resolved
    canOffer: boolean;     // Accept Mission button only when one is offered
    acceptLabel: string;
}

export class CommDialog extends Menu<boolean> {
    private acceptButton?: Button;
    private doneButton?: Button;
    private choices = new Subject<boolean>();

    private text = new PIXI.Text("", FONT.comm);
    private pictContainer = new PIXI.Container();

    constructor(gameData: GameData,
        controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8502", controlEvents);
        this.container.name = 'CommDialog';

        this.text.position.x = -140;
        this.text.position.y = -180;
        this.container.addChild(this.text);

        this.pictContainer.position.x = 174;
        this.pictContainer.position.y = -152.5;
        this.container.addChild(this.pictContainer);

        this.controls.controls = {
            // Departing the dialog is declining it.
            depart: this.dismiss.bind(this),
        };
    }

    // Shows the comm exchange; resolves true only when the player pressed
    // Accept Mission.
    async showComm(input: CommInput): Promise<boolean> {
        await this.buildPromise;
        this.setButtons(input);
        this.text.text = input.quote === ""
            ? input.name : `${input.name}: ${input.quote}`;
        this.setPict(input.pict);

        this.container.visible = true;
        this.controls.bind();
        const accepted = await firstValueFrom(this.choices);
        this.container.visible = false;
        this.controls.unbind();
        return accepted;
    }

    private accept() {
        this.choices.next(true);
    }

    private dismiss() {
        this.choices.next(false);
    }

    // The Accept button exists only while something is offered.
    private setButtons(input: CommInput) {
        if (this.acceptButton) {
            this.container.removeChild(this.acceptButton.container);
            this.acceptButton = undefined;
        }
        if (this.doneButton) {
            this.container.removeChild(this.doneButton.container);
        }
        if (input.canOffer) {
            this.acceptButton = new Button(this.gameData, input.acceptLabel,
                100, { x: -110, y: 170 });
            this.acceptButton.click.subscribe(this.accept.bind(this));
            this.doneButton = new Button(this.gameData, DONE_LABEL, 100,
                { x: 10, y: 170 });
        }
        else {
            this.doneButton = new Button(this.gameData, DONE_LABEL, 100,
                { x: -50, y: 170 });
        }
        this.doneButton.click.subscribe(this.dismiss.bind(this));
        this.addButtons({
            ...(this.acceptButton ? { accept: this.acceptButton } : {}),
            done: this.doneButton,
        });
    }

    private setPict(graphic: number) {
        this.pictContainer.children.length = 0;
        if (graphic < 128) {
            return;
        }
        this.pictContainer.addChild(this.gameData.spriteFromPict(`nova:${graphic}`));
    }
}

// What hailing this përs did, for the caller (despawn the ship on
// 'leaves', log the effects).
export interface PersCommOutcome {
    // An offer was available and shown in the dialog.
    offered: boolean;
    accepted: boolean;
    // acceptOffer/refuseOffer results (texts, pay, set expressions).
    missionEffects: MissionEffect[];
    // The përs flag effects applied on accept (pers_offers.ts); null when
    // nothing was accepted.
    persEffects: PersOfferAcceptEffects | null;
}

// The përs offer flow: availability through computeShipOffers (AvailLoc 2
// against the last landed stellar), the comm dialog, then the shared
// briefing accept/refuse machinery. `route` picks which përs flag gates the
// offer: "hail" (default) offers on hail, "board" offers 0x0200 përs's
// mission on boarding. The caller owns CommOpenResource and the radio hail
// quote; this only handles the offer.
export async function offerPersMission(ui: MissionUiEnv,
    comm: CommDialog, briefing: BriefingDialog, pers: PersData,
    route: "hail" | "board" = "hail"): Promise<PersCommOutcome> {
    const outcome: PersCommOutcome = {
        offered: false,
        accepted: false,
        missionEffects: [],
        persEffects: null,
    };

    const missionId = route === "board"
        ? persBoardOfferMissionId(pers)
        : persOfferMissionId(pers);
    let offer: MissionOffer | undefined;
    if (missionId !== null && shipOfferEligible(pers, ui.shipInherentAI)) {
        const offers = await computeShipOffers(ui);
        offer = offers.find(candidate => candidate.mission.id === missionId);
    }

    // CommQuote text: 1-based index into STR# 7100 (missing/empty → the
    // përs's name alone fills the dialog).
    let quote = "";
    if (pers.commQuote > 0) {
        try {
            const set = await ui.gameData.data.StringSet.get(
                globalId(ui.env.prefix, COMM_QUOTE_STR));
            quote = set.strings[pers.commQuote - 1] ?? "";
        }
        catch {
            // Missing strings expand to "".
        }
    }

    const accepted = await comm.showComm({
        name: pers.name,
        pict: pers.hailPict,
        quote,
        canOffer: offer !== undefined,
        // The mission's own Accept button label when one is offered
        // (briefing's STR# 150 machinery), else the stock default.
        acceptLabel: offer ? (await briefing.labelsFor(offer.mission)).accept
            : FALLBACK_ACCEPT_LABEL,
    });

    if (offer === undefined || !accepted) {
        if (offer !== undefined) {
            outcome.missionEffects = refuseOffer(ui, offer);
            logEffects(outcome.missionEffects);
        }
        return outcome;
    }

    outcome.offered = true;
    outcome.accepted = true;
    outcome.missionEffects = acceptOffer(ui, offer);
    logEffects(outcome.missionEffects);

    // The përs's own on-accept flags (deactivate / leaves /
    // replace-with-special-ship). acceptOffer already queued a save for the
    // mission state; these changes need one of their own.
    outcome.persEffects = applyPersOfferAccept(ui.playerState, pers);
    if (outcome.persEffects.deactivated
        || outcome.persEffects.replacedByMission) {
        queuePlayerStateSave();
    }
    return outcome;
}
