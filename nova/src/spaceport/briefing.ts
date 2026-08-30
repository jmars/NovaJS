// Mission briefing dialog: shows a mission's dësc text (expanded by
// mission_text.ts) with its optional PICT graphic and Accept/Refuse buttons,
// reusing the Menu/Button/MenuControls machinery exactly like the outfitter
// and shipyard menus. The dialog only reports which button was pressed —
// applying acceptMission/refuseMission is the caller's job (mission_bbs.ts,
// bar.ts, the spaceport landing flow).

import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { MissionData } from "novadatainterface/MissionData";
import { RankData } from "novadatainterface/RankData";
import { StringSetData } from "novadatainterface/StringSetData";
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { MissionEnv } from '../missions/mission_state_machine';
import { PlayerState } from '../player/player_state';
import { CARGO_NAME_STR, MissionTextEnv } from './mission_text';
import { Button } from './button';
import { Menu } from './menu';

// STR# 150 holds the stock interface button labels: #49 "Yes" and #50 "No"
// are the default mission Accept/Refuse buttons, #26 "Okay" dismisses
// text-only dialogs. Missions override these with their Accept/Refuse
// Button fields.
const DEFAULT_BUTTONS_STR = "nova:150";
const BUTTON_ACCEPT = 49;
const BUTTON_REFUSE = 50;
const BUTTON_OKAY = 26;

export interface ButtonLabels {
    accept: string;
    refuse: string;
    okay: string;
}

const FALLBACK_LABELS: ButtonLabels = { accept: "Accept", refuse: "Decline", okay: "Okay" };

// Geometry of the nova:8502 backdrop, measured from its png: a 765×321
// panel drawn centered (x -382.5..382.5, y -160.5..160.5) with three carved
// boxes — text on the left (x -374.5..-42.5, y -154.5..115.5), pict
// top-right (x 171.5..373.5, y -156.5..47.5) and buttons bottom-right
// (x 171.5..373.5, y 49.5..153.5). Every element below is positioned inside
// its box; a width-100 button is 126 wide including its end caps.
const TEXT_POS = { x: -360, y: -140 };
const PICT_POS = { x: 174, y: -152.5 };
const BUTTON_X = 210;
const ACCEPT_Y = 64;
const REFUSE_Y = 103;
const LONE_BUTTON_Y = 89; // a single button, centered in the button box

// The Mission BBS shares the same backdrop: its list draws in the text box
// and its Done button sits in the button box.
export const BBS_LIST_POS = TEXT_POS;
export const BBS_DONE_POS = { x: BUTTON_X, y: LONE_BUTTON_Y };

export interface BriefingInput {
    text: string;          // already mission_text-expanded
    graphic: number;       // PICT id; below 128 shows no graphic
    acceptLabel: string;
    refuseLabel: string;
    // Missions with flag 0x0004 cannot be refused: no Refuse button.
    canRefuse: boolean;
}

export interface MissionDialogResult extends BriefingInput {
    accepted: boolean;
}

const FONT = {
    desc: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'left', wordWrap: true, wordWrapWidth: 301
    } as const,
};

export class BriefingDialog extends Menu<MissionDialogResult> {
    private labels: ButtonLabels = FALLBACK_LABELS;
    private acceptButton?: Button;
    private refuseButton?: Button;
    private choices = new Subject<boolean>();

    private text = new PIXI.Text("", FONT.desc);
    private pictContainer = new PIXI.Container();

    constructor(gameData: GameData, controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8502", controlEvents);
        this.container.name = 'BriefingDialog';

        this.text.position.x = TEXT_POS.x;
        this.text.position.y = TEXT_POS.y;
        this.container.addChild(this.text);

        this.pictContainer.position.x = PICT_POS.x;
        this.pictContainer.position.y = PICT_POS.y;
        this.container.addChild(this.pictContainer);

        this.controls.controls = {
            // Departing the dialog is declining it (a no-op for missions
            // that cannot be refused).
            depart: this.refuse.bind(this),
        };
    }

    protected override async build() {
        await super.build();
        try {
            const strings = (await this.gameData.data.StringSet.get(DEFAULT_BUTTONS_STR)).strings;
            this.labels = {
                accept: strings[BUTTON_ACCEPT] ?? FALLBACK_LABELS.accept,
                refuse: strings[BUTTON_REFUSE] ?? FALLBACK_LABELS.refuse,
                okay: strings[BUTTON_OKAY] ?? FALLBACK_LABELS.okay,
            };
        }
        catch {
            // Keep the fallback labels when STR# 150 is missing.
        }
    }

    // Button labels for one mission: the mission's own Accept/Refuse Button
    // fields when set, otherwise the STR# 150 defaults.
    async labelsFor(mission: MissionData): Promise<ButtonLabels> {
        await this.buildPromise;
        return {
            accept: mission.acceptButton || this.labels.accept,
            refuse: mission.refuseButton || this.labels.refuse,
            okay: this.labels.okay,
        };
    }

    override async show(input: BriefingInput): Promise<MissionDialogResult> {
        await this.buildPromise;
        // Buttons and pict load their textures lazily; wait for them so the
        // dialog never shows half-drawn.
        await this.setButtons(input);
        this.text.text = input.text;
        await this.setPict(input.graphic);

        this.container.visible = true;
        this.controls.bind();
        const accepted = await firstValueFrom(this.choices);
        this.container.visible = false;
        this.controls.unbind();
        return { ...input, accepted };
    }

    private accept() {
        this.choices.next(true);
    }

    private refuse() {
        // Flag 0x0004 missions offer no way out but acceptance.
        if (this.refuseButton !== undefined) {
            this.choices.next(false);
        }
    }

    // Button labels are per-mission, so the buttons are rebuilt per show.
    private async setButtons(input: BriefingInput) {
        if (this.acceptButton) {
            this.container.removeChild(this.acceptButton.container);
        }
        if (this.refuseButton) {
            this.container.removeChild(this.refuseButton.container);
        }
        this.acceptButton = new Button(this.gameData, input.acceptLabel, 100,
            { x: BUTTON_X, y: input.canRefuse ? ACCEPT_Y : LONE_BUTTON_Y });
        this.refuseButton = input.canRefuse
            ? new Button(this.gameData, input.refuseLabel, 100,
                { x: BUTTON_X, y: REFUSE_Y })
            : undefined;
        this.acceptButton.click.subscribe(this.accept.bind(this));
        if (this.refuseButton) {
            this.refuseButton.click.subscribe(this.refuse.bind(this));
        }
        this.addButtons({
            accept: this.acceptButton,
            ...(this.refuseButton ? { refuse: this.refuseButton } : {}),
        });
        await Promise.all([this.acceptButton.buildPromise,
            this.refuseButton?.buildPromise]);
    }

    private async setPict(graphic: number) {
        this.pictContainer.children.length = 0;
        // Desc graphic ids below 128 mean "no graphic" (stock convention).
        if (graphic < 128) {
            return;
        }
        // A missing pict renders blank (pre-lazy-load behavior) instead of
        // rejecting show() and freezing the dialog.
        try {
            this.pictContainer.addChild(
                await this.gameData.spriteFromPictAsync(`nova:${graphic}`));
        }
        catch { }
    }
}


// A text-only dialog with one dismiss button: bar refusal messages,
// the active-missions info screen, etc.
export class TextDialog extends Menu<void> {
    private okayButton?: Button;
    private closed = new Subject<undefined>();

    private text = new PIXI.Text("", FONT.desc);

    constructor(gameData: GameData, controlEvents: Observable<ControlEvent>,
        private buttonLabel = FALLBACK_LABELS.okay) {
        super(gameData, "nova:8502", controlEvents);

        this.text.position.x = TEXT_POS.x;
        this.text.position.y = TEXT_POS.y;
        this.container.addChild(this.text);

        this.controls.controls = {
            depart: this.close.bind(this),
        };
    }

    // Named showText rather than show: the base Menu<void> show() takes no
    // argument, and a string-taking override is not type-compatible.
    async showText(text: string): Promise<void> {
        await this.buildPromise;
        this.text.text = text;
        if (!this.okayButton) {
            this.okayButton = new Button(this.gameData, this.buttonLabel, 100,
                { x: BBS_DONE_POS.x, y: BBS_DONE_POS.y });
            this.okayButton.click.subscribe(this.close.bind(this));
            this.addButtons({ okay: this.okayButton });
        }

        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.container.visible = false;
        this.controls.unbind();
    }

    private close() {
        this.closed.next(undefined);
    }
}


// MissionTextEnv backed by the engine's MissionEnv plus game-data lookups
// preloaded ahead of each dialog display (Gettable lookups are async; the
// expander is sync). Only what the displayed missions can reference is
// loaded: the player's active ranks, the cargo name strings, and the
// special-ship name strings.
export class GameMissionTextEnv implements MissionTextEnv {
    private ranks = new Map<string, RankData>();
    private stringSets = new Map<number, StringSetData>();

    constructor(private env: MissionEnv, private gameData: GameDataInterface) { }

    planet(id: string) {
        return this.env.planet(id);
    }

    system(id: string) {
        return this.env.system(id);
    }

    systemOfPlanet(id: string) {
        return this.env.systemOfPlanet(id);
    }

    rank(id: string) {
        return this.ranks.get(id) ?? null;
    }

    stringSetByRawId(rawId: number) {
        return this.stringSets.get(rawId) ?? null;
    }

    async preload(state: PlayerState, missions: MissionData[]): Promise<void> {
        const rankIds = new Set(state.activeRanks);
        if (state.lastActivatedRank !== null) {
            rankIds.add(state.lastActivatedRank);
        }
        for (const id of rankIds) {
            if (this.ranks.has(id)) {
                continue;
            }
            try {
                this.ranks.set(id, await this.gameData.data.Rank.get(id));
            }
            catch {
                // Unknown rank: <PRK> falls back through rank() === null.
            }
        }

        const stringIds = new Set<number>([CARGO_NAME_STR]);
        for (const mission of missions) {
            if (mission.shipNameID > 0) {
                stringIds.add(mission.shipNameID);
            }
        }
        for (const rawId of stringIds) {
            if (this.stringSets.has(rawId)) {
                continue;
            }
            try {
                this.stringSets.set(rawId,
                    await this.gameData.data.StringSet.get(`nova:${rawId}`));
            }
            catch {
                // Missing strings expand to "".
            }
        }
    }
}
