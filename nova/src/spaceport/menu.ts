import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { Button } from './button';
import { MenuControls } from './menu_controls';

type Buttons = {
    [index: string]: Button,
};

export abstract class Menu<T> {
    container = new PIXI.Container();
    readonly buildPromise: Promise<void>;
    built = false;
    protected controls: MenuControls;
    private results = new Subject<T>();
    protected input!: T;

    constructor(protected gameData: GameData,
        private background: string,
        controlEvents: Observable<ControlEvent>) {
        this.controls = new MenuControls(controlEvents);
        this.container.visible = false;
        this.buildPromise = this.doBuild();
    }

    private async doBuild() {
        // The background texture loads lazily (Range fetch), so the whole
        // build is async; it still lands behind everything build() adds.
        const backgroundSprite = await this.gameData.spriteFromPictAsync(this.background);
        // So you can't press things behind this menu:
        backgroundSprite.interactive = true;
        backgroundSprite.anchor.x = 0.5;
        backgroundSprite.anchor.y = 0.5;
        this.container.addChildAt(backgroundSprite, 0);
        await this.build();
        this.built = true;
    }

    addButtons(buttons: Buttons) {
        for (const button of Object.values(buttons)) {
            this.container.addChild(button.container);
        }
    }

    protected async build() { }

    protected setInput(input: T) {
        this.input = input;
    }

    async show(input: T): Promise<T> {
        // Menus may be shown before their async build finished; wait it out
        // so the background and buttons are in place before first paint.
        await this.buildPromise;
        this.container.visible = true;
        this.controls.bind();
        this.setInput(input);
        const result = await firstValueFrom(this.results);
        this.container.visible = false;
        this.controls.unbind();
        return result;
    }

    protected done() {
        this.results.next(this.input);
    }
}
