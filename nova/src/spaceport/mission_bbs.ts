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
import { ActiveMission, PlayerState } from '../player/player_state';
import { applyCargoEffects } from '../player/cargo';
import { activeRankContributes } from '../player/ranks';
import { queuePlayerStateSave } from '../missions/mission_plugin';
import { rawIdOf } from '../missions/stellar_filter';
import { Button } from './button';
import { BriefingDialog, BriefingInput, ButtonLabels, GameMissionTextEnv } from './briefing';
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
    const landedStellar = ui.env.planet(ui.landedStellarId);
    if (!landedStellar) {
        return [];
    }
    const systemId = ui.env.systemOfPlanet(ui.landedStellarId);
    if (!systemId) {
        return [];
    }
    return assembleOffers(location, ui, ui.landedStellarId, landedStellar,
        systemId);
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
    return assembleOffers("ship", ui, landedStellarId, landedStellar, systemId);
}

// The shared offer pipeline: build the OfferContext for one location and
// stellar, keep the available missions, expand their texts.
async function assembleOffers(location: OfferLocation, ui: MissionUiEnv,
    landedStellarId: string, landedStellar: PlanetData,
    systemId: string): Promise<MissionOffer[]> {
    const missions: MissionData[] = [];
    for (const id of ui.env.allMissionIds()) {
        const mission = ui.env.missionByRawId(rawIdOf(id));
        if (mission) {
            missions.push(mission);
        }
    }
    await ui.textEnv.preload(ui.playerState, missions);

    const ctx: OfferContext = {
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

// The mission-computer list. Selecting an entry opens its briefing dialog;
// accepted missions leave the list, refused ones stay until the player
// leaves the BBS. Runs its own loop inside showOffers — the base Menu's
// one-shot show() does not fit a list-dialog cycle.
export class MissionBBS extends Menu<void> {
    private listContainer = new PIXI.Container();
    private briefing: BriefingDialog;
    private picked = new Subject<MissionOffer | null>();
    private doneButton: Button;

    // makeUi rebuilds the MissionUiEnv per accept/refuse so ship name/type
    // reflect the ship the player currently owns.
    constructor(private makeUi: () => Promise<MissionUiEnv>,
        controlEvents: Observable<ControlEvent>, gameData: GameData) {
        super(gameData, "nova:8502", controlEvents);
        this.container.name = 'MissionBBS';

        this.doneButton = new Button(gameData, "Done", 100, { x: -50, y: 200 });
        this.doneButton.click.subscribe(() => this.picked.next(null));
        this.addButtons({ done: this.doneButton });

        this.container.addChild(this.listContainer);
        this.briefing = new BriefingDialog(gameData, controlEvents);
        this.container.addChild(this.briefing.container);
    }

    // Shows the offers until the player accepts them all or presses Done.
    // onRefused lets a subclass surface refusal consequences (the bar shows
    // RefuseText) after the state machine ran.
    async showOffers(offers: MissionOffer[],
        onRefused?: (offer: MissionOffer, effects: MissionEffect[]) => Promise<void>):
        Promise<void> {
        if (offers.length === 0) {
            return;
        }
        let remaining = offers;
        let redraw = true;
        this.container.visible = true;
        this.controls.bind();
        while (remaining.length > 0) {
            if (redraw) {
                this.drawList(remaining);
                redraw = false;
            }
            const picked = await firstValueFrom(this.picked);
            if (!picked) {
                break;
            }
            const labels = await this.briefing.labelsFor(picked.mission);
            this.controls.unbind();
            const result = await this.briefing.show(briefingInput(picked, labels));
            this.controls.bind();
            if (result.accepted) {
                logEffects(acceptOffer(await this.makeUi(), picked));
                remaining = remaining.filter(offer => offer !== picked);
                redraw = true;
            }
            else {
                const effects = refuseOffer(await this.makeUi(), picked);
                logEffects(effects);
                if (onRefused) {
                    await onRefused(picked, effects);
                }
            }
        }
        this.controls.unbind();
        this.container.visible = false;
    }

    private drawList(offers: MissionOffer[]) {
        this.listContainer.removeChildren();
        let y = -180;
        for (const offer of offers) {
            const entry = new PIXI.Text(offer.listText, FONT.entry);
            entry.position.x = -140;
            entry.position.y = y;
            entry.interactive = true;
            entry.cursor = 'pointer';
            entry.on('pointertap', () => this.picked.next(offer));
            this.listContainer.addChild(entry);
            y += entry.height + 8;
        }
    }
}
