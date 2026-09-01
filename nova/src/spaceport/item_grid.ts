import * as PIXI from 'pixi.js';
import { BehaviorSubject } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';


const TILE_SIZE = [83, 54];

export class ItemTile<I extends Item> {
    private font = {
        normal: {
            fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
            align: 'center', wordWrap: true, wordWrapWidth: TILE_SIZE[0]
        } as const,
        grey: {
            fontFamily: "Geneva", fontSize: 10, fill: 0x262626,
            align: 'center', wordWrap: true, wordWrapWidth: TILE_SIZE[0]
        } as const,
        count: {
            fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
            align: 'right', wordWrap: false, wordWrapWidth: TILE_SIZE[0]
        } as const,
    };

    // TODO: Use the colr resource
    private colors = {
        dim: 0x404040,
        bright: 0xFF0000,
    };
    private lineWidth = 1;
    private dimStyle = [this.lineWidth, this.colors.dim] as const;
    private brightStyle = [this.lineWidth, this.colors.bright] as const;
    private graphics = new PIXI.Graphics();
    private wrappedQuantity = 0;
    private quantityText: PIXI.Text;
    readonly container = new PIXI.Container();
    private wrappedActive = false;
    public built = false;
    private buildPromise?: Promise<void>;
    public largePict = new PIXI.Container();

    constructor(private gameData: GameData, readonly item: I) {
        const nameText = new PIXI.Text(item.name, this.font.normal);
        nameText.anchor.x = 0.5;
        nameText.position.x = TILE_SIZE[0] / 2;
        nameText.position.y = TILE_SIZE[1] / 2;

        this.quantityText = new PIXI.Text("", this.font.normal);
        this.quantityText.anchor.x = 1;
        this.quantityText.position.x = TILE_SIZE[0] - 2;
        this.quantityText.position.y = 2;

        this.container.interactive = true;
        this.active = false;

        this.container.addChild(this.graphics);
        this.container.addChild(nameText);
        this.container.addChild(this.quantityText);
    }

    // Idempotent, fire-and-forget: the grid stays synchronous (keyboard and
    // pointer handlers call it), the tile's pict pops in when it arrives.
    build() {
        if (this.built) {
            return;
        }
        this.buildPromise ??= this.buildAsync();
    }

    private async buildAsync() {
        // Fire-and-forget: a missing pict (many outfits carry the "default"
        // placeholder) leaves the tile blank instead of rejecting an
        // unawaited promise.
        try {
            await this.buildPict();
        }
        catch { }
        this.built = true;
    }

    private async buildPict() {
        if (this.item.pict) {
            const [smallPict, largePict] = await Promise.all([
                this.gameData.spriteFromPictAsync(this.item.pict),
                this.gameData.spriteFromPictAsync(this.item.pict),
            ]);
            this.largePict.addChild(largePict);
            smallPict.anchor.x = 0.5;
            smallPict.position.x = TILE_SIZE[0] / 2;
            smallPict.position.y = 1;

            const scale = 0.15;
            smallPict.scale.x = scale;
            smallPict.scale.y = scale;

            this.container.addChildAt(smallPict, 1);
        }
    }

    draw() {
        this.graphics.clear();
        if (this.active) {
            this.graphics.lineStyle(...this.brightStyle);
        }
        else {
            this.graphics.lineStyle(...this.dimStyle);
        }

        this.graphics.beginFill(0x000000);
        this.graphics.drawRect(0, 0, TILE_SIZE[0], TILE_SIZE[1]);
    }

    hide() {
        this.container.visible = false;
    }

    show() {
        this.container.visible = true;
        this.build(); // Builds if not already built
    }

    moveTo(x: number, y: number) {
        this.container.position.x = x;
        this.container.position.y = y;
    }

    get quantity() {
        return this.wrappedQuantity;
    }

    set quantity(count: number) {
        this.wrappedQuantity = count;
        if (this.wrappedQuantity == 0) {
            this.quantityText.text = "";
        }
        else {
            this.quantityText.text = String(this.quantity);
        }
    }

    get active() {
        return this.wrappedActive;
    }

    set active(val: boolean) {
        this.wrappedActive = val;
        this.draw();
    }
}


interface Item {
    name: string,
    id: string,
    desc: string,
    pict: string,
}

const BOX_COUNT = [4, 5];

// Clips a PIXI.Text to a box and makes it mouse-wheel scrollable (the BBS
// preview, and the outfitter/shipyard item descriptions). `scroll` repositions
// the text by `delta` pixels (positive = down), clamped to the box height;
// pass `reset` to jump back to the top. Returns the scroll handle.
export function makeTextScrollable(text: PIXI.Text, x: number, y: number,
    width: number, height: number): { scroll: (delta: number, reset?: boolean) => void } {
    text.position.x = x;
    text.position.y = y;
    text.style.wordWrap = true;
    text.style.wordWrapWidth = width;
    text.interactive = true;
    text.hitArea = new PIXI.Rectangle(0, 0, width, height);
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    mask.drawRect(x, y, width, height);
    mask.endFill();
    text.mask = mask;
    let scroll = 0;
    const maxScroll = () => Math.max(0, text.height - height);
    const doScroll = (delta: number, reset = false): void => {
        scroll = reset ? 0 : Math.max(0, Math.min(maxScroll(), scroll + delta));
        text.position.y = y - scroll;
    };
    text.on('wheel', (e: PIXI.FederatedWheelEvent) => doScroll(e.deltaY));
    return { scroll: doScroll };
}

export class ItemGrid<I extends Item> {
    public activeTile = new BehaviorSubject<ItemTile<I> | undefined>(undefined);
    public container = new PIXI.Container();
    private selectionIndex = -1;
    private scroll = 0;
    private tilesDict = new Map<string, ItemTile<I>>();
    private tiles: ItemTile<I>[];

    constructor(gameData: GameData, private items: I[]) {
        this.tiles = items.map(item => {
            const tile = new ItemTile(gameData, item);
            this.container.addChild(tile.container);
            tile.container.on('pointerdown', () => this.tileClicked(tile));
            this.tilesDict.set(item.id, tile);
            return tile;
        });
        // Mouse-wheel scrolls the visible window down/up by one row.
        this.container.interactive = true;
        this.container.on('wheel', (e: PIXI.FederatedWheelEvent) => {
            this.wheelScroll(e.deltaY > 0 ? 1 : -1);
        });
    }

    // Moves the selection down/up by one row per wheel step, keeping it in
    // view (the binary scrolls the outfitter/shipyard grid with the wheel).
    wheelScroll(dir: number) {
        if (this.items.length === 0) {
            return;
        }
        const step = dir > 0 ? BOX_COUNT[0] : -BOX_COUNT[0];
        const idx = this.selectionIndex === -1
            ? 0 : Math.max(0, Math.min(this.items.length - 1,
                this.selectionIndex + step));
        this.selectionIndex = idx;
        if (this.scroll * BOX_COUNT[0] > this.selectionIndex) {
            this.scroll = Math.max(0,
                Math.floor(this.selectionIndex / BOX_COUNT[0]));
        }
        else if (this.scroll * BOX_COUNT[0] + BOX_COUNT[0] * BOX_COUNT[1]
            <= this.selectionIndex) {
            this.scroll = Math.max(0, Math.floor(
                (this.selectionIndex - BOX_COUNT[0] * BOX_COUNT[1]
                    + BOX_COUNT[0] - 1) / BOX_COUNT[0]));
        }
        this.drawGrid();
    }

    get count() {
        return this.tiles.length;
    }

    get selection() {
        return this.items[this.selectionIndex];
    }

    set selection(item) {
        this.selectionIndex = this.items.indexOf(item);
        this.drawGrid();
    }

    tileClicked(tile: ItemTile<I>) {
        this.selectionIndex = this.tiles.indexOf(tile);
        console.log(tile);
        console.log(this.selectionIndex);

        this.drawGrid();
    }

    drawGrid() {
        // Hide everything first. Reveal them later
        this.tiles.forEach(function(t) {
            t.hide();
        });

        const start = BOX_COUNT[0] * this.scroll;

        for (let i = 0; i < Math.min(this.items.length - start, BOX_COUNT[0] * BOX_COUNT[1]); i++) {
            var itemIndex = i + start;
            var tile = this.tiles[itemIndex];
            let xcount = i % BOX_COUNT[0];
            let ycount = Math.floor(i / BOX_COUNT[0]);

            tile.show();
            if (itemIndex === this.selectionIndex) {
                tile.active = true;
                // send which one is selected
                this.activeTile.next(tile);

                // Make sure it is above the others
                this.container.addChildAt(tile.container, this.tiles.length - 1);
            }

            else {
                tile.active = false;
            }

            tile.moveTo(xcount * TILE_SIZE[0], ycount * TILE_SIZE[1])
            tile.draw();
        }
    }

    setCounts(items: Map<string, number>) {
        for (const tile of this.tiles) {
            tile.quantity = 0;
        }

        for (const [id, count] of items) {
            const tile = this.tilesDict.get(id);
            if (tile) {
                tile.quantity = count;
            }
        }
    }

    left() {
        if (this.selectionIndex === -1) {
            this.selectionIndex = Math.min(BOX_COUNT[0] * BOX_COUNT[1],
                this.items.length);
        }
        else {
            this.selectionIndex -= 1;
            if (this.selectionIndex < 0) {
                this.selectionIndex = 0;
            }
        }

        if (this.scroll * BOX_COUNT[0] > this.selectionIndex) {
            this.scroll -= 1;
        }
        this.drawGrid();
    }

    right() {
        if (this.selectionIndex === -1) {
            this.selectionIndex = 0;
        }
        else {
            this.selectionIndex += 1;
            if (this.selectionIndex > this.items.length - 1) {
                this.selectionIndex = this.items.length - 1;
            }

        }
        if (this.scroll * BOX_COUNT[0] +
            BOX_COUNT[0] * BOX_COUNT[1] <= this.selectionIndex) {
            this.scroll += 1;
        }
        this.drawGrid();
    }

    up() {
        if (this.selectionIndex === -1) {
            this.selectionIndex = Math.min(BOX_COUNT[0] * BOX_COUNT[1],
                this.items.length);
        }
        else if (this.selectionIndex - BOX_COUNT[0] >= 0) {
            this.selectionIndex -= BOX_COUNT[0];
        }

        if (this.scroll * BOX_COUNT[0] > this.selectionIndex) {
            this.scroll -= 1;
        }
        this.drawGrid();
    }

    down() {
        if (this.selectionIndex === -1) {
            this.selectionIndex = 0;
        }
        else if (this.selectionIndex + BOX_COUNT[0] < this.items.length) {
            this.selectionIndex += BOX_COUNT[0];
        }
        else {
            this.selectionIndex = this.items.length - 1;
        }

        if (this.scroll * BOX_COUNT[0] +
            BOX_COUNT[0] * BOX_COUNT[1] <= this.selectionIndex) {
            this.scroll += 1;
        }

        this.drawGrid();
    }

}
