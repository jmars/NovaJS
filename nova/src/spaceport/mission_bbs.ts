// Mission BBS: the list of missions offered at the mission computer
// (AvailLoc 0), sorted by display weight like the stock game. Also hosts
// the shared offer plumbing used by the bar and the spaceport landing flow:
// computing the current offers (availability.ts over a real OfferContext),
// expanding their texts (mission_text.ts over previewActiveMission — the
// seeded draws preview exactly what accepting will roll), and applying
// accept/refuse through the P4 state machine.

import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { GameData } from '../client/gamedata/GameData';
import { MissionData } from "novadatainterface/MissionData";
import { PlanetData } from "novadatainterface/PlanetData";
import { ShipData } from "novadatainterface/ShipData";
import { StringSetData } from "novadatainterface/StringSetData";
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import {
    acceptMission,
    MissionEffect,
    MissionEnv,
    previewActiveMission,
    refuseMission,
} from '../missions/mission_state_machine';
import { OfferContext, OfferLocation, isAvailable } from '../missions/availability';
import { makeRng } from '../player/pilot_files';
import { ActiveMission, MAX_ACTIVE_MISSIONS, PlayerState } from '../player/player_state';
import { applyCargoEffects } from '../player/cargo';
import { activeRankContributes } from '../player/ranks';
import { queuePlayerStateSave } from '../missions/mission_plugin';
import { rawIdOf } from '../missions/stellar_filter';
import { Button } from './button';
import {
    BriefingDialog, BriefingInput, ButtonLabels, BBS_DONE_POS, BBS_LIST_POS,
    BBS_PICT_POS, BBS_BUTTON_X, BBS_ACCEPT_Y, BBS_REFUSE_Y,
    BBS_LONE_BUTTON_Y, GameMissionTextEnv, TextDialog,
} from './briefing';
import { Menu } from './menu';
import {
    expandMissionText,
    MissionTextContext,
    pickSpecialShipName,
} from './mission_text';

// Everything the offer UIs need to compute offers, expand their texts and
// apply accept/refuse. Assembled once per landing by the spaceport (and per
// hail by the comm dialog).
export interface MissionUiEnv {
    playerState: PlayerState;
    env: MissionEnv;
    textEnv: GameMissionTextEnv;
    gameData: GameDataInterface;
    landedStellarId: string;
    shipName: string;
    shipTypeName: string;
    // The player's ship data and its inherent AI, for the AvailShipType and
    // AI-flag availability rules (null when the ship type is unknown).
    shipData: ShipData | null;
    shipInherentAI: number | null;
    // Free tons left in the player's hold (ship capacity minus
    // PlayerState.cargo; see ship_plugin.shipFreeCargoTons). Feeds the
    // flags2-0x0001 availability rule and caps what accepting loads.
    // Undefined/null means unknown: those rules pass and pickups load
    // unconditionally.
    freeCargoTons?: number | null;
}

// One offered mission, with its texts already expanded for display.
export interface MissionOffer {
    mission: MissionData;
    // What accepting would create (seeded preview of the accept draws).
    active: ActiveMission;
    listText: string;    // quickBrief, for the BBS/bar list
    briefText: string;   // briefing dësc (falls back to the quickBrief)
    graphic: number;     // PICT id of the briefing dësc
    textCtx: MissionTextContext;
}

async function descData(gameData: GameDataInterface, descId: string | null) {
    if (descId === null) {
        return null;
    }
    try {
        return await gameData.data.Desc.get(descId);
    }
    catch {
        return null;
    }
}

function makeTextContext(ui: MissionUiEnv, mission: MissionData,
    active: ActiveMission): MissionTextContext {
    return {
        state: ui.playerState,
        mission,
        active,
        env: ui.textEnv,
        shipName: ui.shipName,
        shipTypeName: ui.shipTypeName,
        // Offers come from BBS/bar/spaceport; offering ships await P6 dudes,
        // so <OSN> shows the player's own ship for now.
        offeringShipName: ui.shipName,
        specialShipName: pickSpecialShipName(mission, ui.textEnv,
            makeRng((ui.playerState.rngSeed ^ (rawIdOf(mission.id) * 0x9E37)) >>> 0)),
    };
}

// Text-expansion context for a mission against the current state; shared
// with mission_info.ts, which renders active missions (real destinations).
export function makeOfferTextContext(ui: MissionUiEnv, mission: MissionData,
    active: ActiveMission): MissionTextContext {
    return makeTextContext(ui, mission, active);
}

// Builds the display form of one offered mission. `textEnv` must have been
// preloaded for `mission` (computeOffers does this for its callers).
export async function makeOffer(ui: MissionUiEnv, mission: MissionData): Promise<MissionOffer> {
    const active = previewActiveMission(ui.playerState, mission, ui.env,
        ui.landedStellarId);
    const textCtx = makeTextContext(ui, mission, active);

    const brief = await descData(ui.gameData, mission.briefText);
    const quickBrief = await descData(ui.gameData, mission.quickBrief);
    const briefText = brief?.text ?? quickBrief?.text ?? "";
    const listText = quickBrief?.text ?? brief?.text ?? "";

    return {
        mission,
        active,
        listText: expandMissionText(listText, textCtx),
        briefText: expandMissionText(briefText, textCtx),
        graphic: brief?.graphic ?? quickBrief?.graphic ?? 0,
        textCtx,
    };
}

// The missions currently offered at one landing location, sorted
// displayWeight first. Ship-location (AvailLoc 2) offers come from hailed
// përs (computeShipOffers); the trade/shipyard/outfit dialogs do not exist
// yet.
export async function computeOffers(location: OfferLocation,
    ui: MissionUiEnv): Promise<MissionOffer[]> {
    const ctx = await offerContext(location, ui);
    if (!ctx) {
        return [];
    }
    return assembleOffers(location, ui, ctx);
}

// Ship-location (AvailLoc 2) offers: the përs-hailed missions. In space
// there is no landed planet; the origin for the AvailStel check and for
// accepting is the stellar the player last landed on (flagged approximation
// of stock's in-space offering). Never landed — nothing can offer.
export async function computeShipOffers(ui: MissionUiEnv):
    Promise<MissionOffer[]> {
    const landedStellarId = ui.playerState.lastStellar;
    if (landedStellarId === null) {
        return [];
    }
    const landedStellar = ui.env.planet(landedStellarId);
    if (!landedStellar) {
        return [];
    }
    const systemId = ui.env.systemOfPlanet(landedStellarId);
    if (!systemId) {
        return [];
    }
    const ctx = buildOfferContext("ship", ui, landedStellarId, landedStellar,
        systemId);
    return assembleOffers("ship", ui, ctx);
}

// The OfferContext for one location at the ui's landed stellar; null when
// the landing is not resolvable. Shared by computeOffers and the post-accept
// board re-filter (FUN_0043f100 re-runs availability after every accept).
export async function offerContext(location: OfferLocation,
    ui: MissionUiEnv): Promise<OfferContext | null> {
    const landedStellar = ui.env.planet(ui.landedStellarId);
    if (!landedStellar) {
        return null;
    }
    const systemId = ui.env.systemOfPlanet(ui.landedStellarId);
    if (!systemId) {
        return null;
    }
    return buildOfferContext(location, ui, ui.landedStellarId, landedStellar,
        systemId);
}

// Assembles the context from pre-resolved facts (the ship-location path
// resolves its last-landed stellar instead of ui.landedStellarId).
function buildOfferContext(location: OfferLocation, ui: MissionUiEnv,
    landedStellarId: string, landedStellar: PlanetData,
    systemId: string): OfferContext {
    return {
        landedStellar,
        landedStellarId,
        systemId,
        location,
        playerState: ui.playerState,
        shipData: ui.shipData,
        shipContribute: [0, 0],
        shipInherentAI: ui.shipInherentAI,
        fuel: null,
        freeCargoTons: ui.freeCargoTons ?? null,
        ownedOutfits: {},
        outfitContributes: [],
        rankContributes: activeRankContributes(ui.playerState,
            { rank: id => ui.textEnv.rank(id) }),
        government: id => ui.env.government(id),
        govtByRawId: rawId => ui.env.govtByRawId(rawId),
        system: id => ui.env.system(id),
    };
}

// The shared offer pipeline: keep the available missions for a prebuilt
// context and expand their texts.
async function assembleOffers(location: OfferLocation, ui: MissionUiEnv,
    ctx: OfferContext): Promise<MissionOffer[]> {
    const missions: MissionData[] = [];
    for (const id of ui.env.allMissionIds()) {
        const mission = ui.env.missionByRawId(rawIdOf(id));
        if (mission) {
            missions.push(mission);
        }
    }
    await ui.textEnv.preload(ui.playerState, missions);

    const offered = missions.filter(mission => isAvailable(mission, ctx));
    offered.sort((a, b) => b.dispWeight - a.dispWeight);
    const offers: MissionOffer[] = [];
    for (const mission of offered) {
        offers.push(await makeOffer(ui, mission));
    }
    return offers;
}

export function briefingInput(offer: MissionOffer, labels: ButtonLabels): BriefingInput {
    return {
        text: offer.briefText,
        graphic: offer.graphic,
        acceptLabel: labels.accept,
        refuseLabel: labels.refuse,
        // Flag 0x0004: the mission cannot be refused.
        canRefuse: (offer.mission.flags & 0x0004) === 0,
    };
}

// Applies a decision through the P4 state machine and returns the effects
// (texts, pay, cargo, set expressions) for the caller to present/log. The
// PickupMode-0 shipment, if any, is loaded into the player's hold here
// (capped by the ui's free tons); blocked pickups report 'cargoBlocked'.
export function acceptOffer(ui: MissionUiEnv, offer: MissionOffer): MissionEffect[] {
    const freeCargoTons = ui.freeCargoTons ?? null;
    const result = acceptMission(ui.playerState, offer.mission, ui.env,
        ui.landedStellarId, freeCargoTons);
    if (!result.accepted) {
        return [];
    }
    applyCargoEffects(ui.playerState, result.effects, freeCargoTons);
    queuePlayerStateSave();
    return result.effects;
}

export function refuseOffer(ui: MissionUiEnv, offer: MissionOffer): MissionEffect[] {
    const result = refuseMission(ui.playerState, offer.mission, ui.env);
    if (!result.refused) {
        return [];
    }
    queuePlayerStateSave();
    return result.effects;
}

export function logEffects(effects: MissionEffect[]) {
    for (const effect of effects) {
        console.info('[missions]', JSON.stringify(effect));
    }
}


const FONT = {
    entry: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'left', wordWrap: true, wordWrapWidth: 300
    } as const,
};

// STR# 2002 holds the BBS/bar status messages (0-based items): 350+name+351
// is the all-16-slots-busy notice, 352 the empty board (FUN_0043c470 shows
// these instead of the list).
const MISSION_STRINGS = "nova:2002";
const BUSY_NAME_ITEM = 350;
const BUSY_TAIL_ITEM = 351;
const NO_OFFERS_ITEM = 352;
const NO_OFFERS_FALLBACK = "There are no missions available here.";

// The mission-computer list. Selecting an entry opens its briefing dialog;
// accepted missions leave the list, refused ones stay until the player
// leaves the BBS. Runs its own loop inside showOffers — the base Menu's
// one-shot show() does not fit a list-dialog cycle.
export class MissionBBS extends Menu<void> {
    protected listContainer = new PIXI.Container();
    private briefing: BriefingDialog;
    private messageDialog: TextDialog;
    private doneButton: Button;
    private strings2002: Promise<StringSetData | null>;
    // The selected mission's in-panel preview (the binary's mission computer
    // shows the chosen mission's picture + Accept/Refuse in the panel, not a
    // separate dialog): a pict in the top-right box, its brief text, and the
    // Accept/Refuse buttons in the bottom-right box.
    private previewPict = new PIXI.Container();
    private previewText = new PIXI.Text("", FONT.entry);
    private previewMask = new PIXI.Graphics();
    private previewScroll = 0;
    private previewKeyHandler?: (e: KeyboardEvent) => void;
    private acceptButton?: Button;
    private refuseButton?: Button;
    private selected?: MissionOffer;
    // Resolves a decision: null = Done/leave, { offer, accepted } = that
    // mission was accepted or refused.
    private decided = new Subject<{ offer: MissionOffer, accepted: boolean }
        | null>();

    // The queue this UI pops from: the BBS lists AvailLoc 0; the bar
    // overrides to "bar" (the shared not-BBS queue, re-filtered to 1).
    protected get location(): OfferLocation {
        return "bbs";
    }

    // makeUi rebuilds the MissionUiEnv per accept/refuse so ship name/type
    // reflect the ship the player currently owns.
    constructor(private makeUi: () => Promise<MissionUiEnv>,
        controlEvents: Observable<ControlEvent>, gameData: GameData,
        backdrop = "nova:8502") {
        super(gameData, backdrop, controlEvents);
        this.container.name = 'MissionBBS';

        // Done sits in the button box of the panel (see briefing.ts
        // for the backdrop geometry).
        this.doneButton = new Button(gameData, "Done", 100,
            { x: BBS_DONE_POS.x, y: BBS_DONE_POS.y });
        this.doneButton.click.subscribe(() => this.decided.next(null));
        this.addButtons({ done: this.doneButton });

        this.container.addChild(this.listContainer);
        this.previewPict.position.x = BBS_PICT_POS.x;
        this.previewPict.position.y = BBS_PICT_POS.y;
        this.container.addChild(this.previewPict);
        // The selected mission's brief text fills the panel's middle box
        // (between the list and the pict), clipped to it and scrollable with
        // the mouse wheel / arrow keys (the binary's mission computer
        // scrolls long briefs).
        const previewX = BBS_LIST_POS.x + 320;
        const previewY = BBS_LIST_POS.y;
        this.previewText.position.x = previewX;
        this.previewText.position.y = previewY;
        this.previewText.style.wordWrapWidth = 210;
        this.previewText.interactive = true;
        this.previewText.hitArea = new PIXI.Rectangle(0, 0, 210, 260);
        this.previewMask.beginFill(0xffffff);
        this.previewMask.drawRect(previewX, previewY, 210, 260);
        this.previewMask.endFill();
        this.previewText.mask = this.previewMask;
        // Mouse-wheel scroll over the brief text.
        this.previewText.on('wheel', (e: PIXI.FederatedWheelEvent) => {
            this.scrollPreview(e.deltaY);
        });
        // Arrow-key scroll, active only while the BBS is shown.
        this.previewKeyHandler = (e: KeyboardEvent) => {
            if (!this.container.visible || !this.previewText.text) {
                return;
            }
            if (e.key === 'ArrowUp') {
                this.scrollPreview(-20);
                e.preventDefault();
            }
            else if (e.key === 'ArrowDown') {
                this.scrollPreview(20);
                e.preventDefault();
            }
        };
        window.addEventListener('keydown', this.previewKeyHandler);
        this.container.addChild(this.previewText);

        this.briefing = new BriefingDialog(gameData, controlEvents);
        this.container.addChild(this.briefing.container);
        this.messageDialog = new TextDialog(gameData, controlEvents);
        this.container.addChild(this.messageDialog.container);
        this.strings2002 = gameData.data.StringSet.get(MISSION_STRINGS)
            .catch(() => null);
    }

    // Shows the offers until the player accepts them all or presses Done.
    // Unlike the binary's BBS loop this never early-returns: an empty board
    // shows the STR# 2002 message instead of the list (the bar relies on
    // that — its screen must open even with no patrons to offer missions).
    // onRefused lets a subclass surface refusal consequences (the bar shows
    // RefuseText) after the state machine ran.
    async showOffers(offers: MissionOffer[],
        onRefused?: (offer: MissionOffer, effects: MissionEffect[]) => Promise<void>):
        Promise<void> {
        let remaining = offers;
        this.container.visible = true;
        this.controls.bind();

        // FUN_0043c470's status messages: all 16 slots busy, else an empty
        // board. Shown instead of (not on top of) the list.
        if (await this.showStatusMessage(remaining.length > 0)) {
            this.controls.unbind();
            this.container.visible = false;
            return;
        }

        // The mission computer shows the chosen mission's picture + brief in
        // the panel, with Accept/Refuse at the bottom — no separate dialog.
        this.drawList(remaining);
        if (remaining.length > 0) {
            await this.select(remaining[0]);
        }

        let redraw = false;
        while (remaining.length > 0) {
            const decision = await firstValueFrom(this.decided);
            if (!decision) {
                break;   // Done / leave
            }
            const { offer, accepted } = decision;
            if (accepted) {
                const ui = await this.makeUi();
                logEffects(acceptOffer(ui, offer));
                remaining = remaining.filter(o => o !== offer);
                // FUN_0043f100 re-filters the board after every accept:
                // missions that no longer pass availability (an acceptance
                // can flip set-bits or consume the last slot) are dropped.
                remaining = await this.refilter(ui, remaining);
                redraw = true;
            }
            else {
                const effects = refuseOffer(await this.makeUi(), offer);
                logEffects(effects);
                if (onRefused) {
                    await onRefused(offer, effects);
                }
            }
            if (redraw) {
                this.drawList(remaining);
                redraw = false;
            }
            if (remaining.length > 0 && this.selected !== remaining[0]) {
                await this.select(remaining[0]);
            }
        }
        this.controls.unbind();
        this.container.visible = false;
    }

    // Selects `offer` as the highlighted mission and repaints its in-panel
    // preview: picture (top-right box), brief text, and Accept/Refuse
    // buttons. The buttons reuse the briefing's per-mission labels.
    protected async select(offer: MissionOffer): Promise<void> {
        this.selected = offer;
        this.scrollPreview(0, true);   // reset the scroll for a new mission
        this.previewText.text = offer.briefText;
        this.previewPict.children.length = 0;
        // Desc graphic ids below 128 mean "no graphic" (stock convention).
        if (offer.graphic >= 128) {
            try {
                this.previewPict.addChild(await this.gameData
                    .spriteFromPictAsync(`nova:${offer.graphic}`));
            }
            catch {
                // A missing pict renders blank rather than rejecting.
            }
        }
        await this.setAcceptRefuse(offer);
    }

    // Scrolls the clipped preview brief by `delta` pixels (positive = down,
    // reveal lower text), clamped so the box never shows past the text ends.
    // `reset` repositions from the top.
    private scrollPreview(delta: number, reset = false): void {
        const max = Math.max(0, this.previewText.height - 260);
        this.previewScroll = reset ? 0
            : Math.max(0, Math.min(max, this.previewScroll + delta));
        this.previewText.position.y = BBS_LIST_POS.y - this.previewScroll;
    }

    // The Accept/Refuse buttons for `offer`, rebuilt per mission (labels can
    // be mission-specific; 0x0004 missions cannot be refused).
    private async setAcceptRefuse(offer: MissionOffer): Promise<void> {
        const labels = await this.briefing.labelsFor(offer.mission);
        if (this.acceptButton) {
            this.container.removeChild(this.acceptButton.container);
        }
        if (this.refuseButton) {
            this.container.removeChild(this.refuseButton.container);
        }
        const canRefuse = (offer.mission.flags & 0x0004) === 0;
        this.acceptButton = new Button(this.gameData, labels.accept, 100,
            { x: BBS_BUTTON_X,
                y: canRefuse ? BBS_ACCEPT_Y : BBS_LONE_BUTTON_Y });
        this.refuseButton = canRefuse
            ? new Button(this.gameData, labels.refuse, 100,
                { x: BBS_BUTTON_X, y: BBS_REFUSE_Y })
            : undefined;
        this.acceptButton.click.subscribe(() =>
            this.decided.next({ offer, accepted: true }));
        if (this.refuseButton) {
            this.refuseButton.click.subscribe(() =>
                this.decided.next({ offer, accepted: false }));
        }
        this.addButtons({
            accept: this.acceptButton,
            ...(this.refuseButton ? { refuse: this.refuseButton } : {}),
        });
        await Promise.all([this.acceptButton.buildPromise,
            this.refuseButton?.buildPromise]);
    }

    // Shows the STR# 2002 busy/empty message instead of the list when
    // needed; returns whether the dialog was shown.
    private async showStatusMessage(hasOffers: boolean): Promise<boolean> {
        const state = (await this.makeUi()).playerState;
        if (state.activeMissions.length >= MAX_ACTIVE_MISSIONS) {
            const strings = (await this.strings2002)?.strings;
            const text = (strings?.[BUSY_NAME_ITEM] ?? "You're already on ")
                + state.playerName
                + (strings?.[BUSY_TAIL_ITEM]
                    ?? " missions - you'll have to abort or finish one before you can accept another.");
            await this.showMessage(text);
            return true;
        }
        if (!hasOffers) {
            await this.showMessage(await this.strMessage(NO_OFFERS_ITEM,
                NO_OFFERS_FALLBACK));
            return true;
        }
        return false;
    }

    private async strMessage(item: number, fallback: string): Promise<string> {
        const strings = (await this.strings2002)?.strings;
        return strings?.[item] ?? fallback;
    }

    // One STR#-style message box over the board; the controls unbind while
    // it is up so the Okay button is the only input.
    protected async showMessage(text: string): Promise<void> {
        this.controls.unbind();
        await this.messageDialog.showText(text);
        this.controls.bind();
    }

    // Re-runs availability over the remaining board against the state as it
    // stands now (post-accept).
    private async refilter(ui: MissionUiEnv,
        remaining: MissionOffer[]): Promise<MissionOffer[]> {
        if (remaining.length === 0) {
            return remaining;
        }
        const ctx = await offerContext(this.location, ui);
        if (!ctx) {
            return remaining;
        }
        return remaining.filter(offer => isAvailable(offer.mission, ctx));
    }

    protected drawList(offers: MissionOffer[]) {
        this.listContainer.removeChildren();
        this.drawEntries(offers, BBS_LIST_POS.y);
    }

    // The offer entries, from startY down. Split from drawList so subclasses
    // can decorate the box (the bar's welcome text) and reuse the layout.
    // Clicking an entry selects it, repainting the in-panel preview.
    protected drawEntries(offers: MissionOffer[], startY: number) {
        let y = startY;
        for (const offer of offers) {
            const entry = new PIXI.Text(offer.listText, FONT.entry);
            entry.position.x = BBS_LIST_POS.x;
            entry.position.y = y;
            entry.interactive = true;
            entry.cursor = 'pointer';
            entry.on('pointertap', () => { this.select(offer); });
            this.listContainer.addChild(entry);
            y += entry.height + 8;
        }
    }
}
