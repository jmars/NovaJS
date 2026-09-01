import { OutfitData } from "novadatainterface/OutiftData";
import { DefaultMap } from "nova_ecs/utils";
import * as PIXI from 'pixi.js';
import { Observable, Subscription } from "rxjs";
import { GameData } from "../client/gamedata/GameData";
import { ControlEvent } from "../nova_plugin/controls_plugin";
import { OutfitsState } from "../nova_plugin/outfit_plugin";
import { Button } from "./button";
import { ItemGrid, ItemTile, makeTextScrollable } from "./item_grid";
import { MarketContext, orderOutfits, outfitListed } from "./market_filter";
import { Menu } from "./menu";
import { expandDescription } from "./mission_text";
import * as purchase from "./purchase";


const descWidth = 190;

/**
 * The money context the spaceport sets before each show(): the player
 * wallet (read + write-through persist), the planet's price modifier and
 * the free mass the ship has left. Undefined in worlds without the mission
 * system, where buying stays free (legacy behavior).
 */
export interface OutfitterPurchases {
    credits(): number;
    setCredits(credits: number): void;
    priceMod: number;
    freeMass: number;
    // Real context for expanding the outfit description's dësc blocks
    // ({bXXX/{P registration gates, <PNN>/<PST> name tags).
    descriptionCtx: Parameters<typeof expandDescription>[1];
}

export const FONT = {
    normal: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'left', wordWrap: true, wordWrapWidth: descWidth
    } as const,
    grey: {
        fontFamily: "Geneva", fontSize: 10, fill: 0x262626,
        align: 'left', wordWrap: true, wordWrapWidth: descWidth
    } as const,
    count: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'right', wordWrap: false, wordWrapWidth: descWidth
    } as const,
};

export class Outfitter extends Menu<OutfitsState> {
    private itemGrid?: ItemGrid<OutfitData>;
    private gridSubscription?: Subscription;
    private pictContainer = new PIXI.Container();
    private descScroll?: (delta: number, reset?: boolean) => void;
    private outfits: DefaultMap<string, number>;
    private purchases?: OutfitterPurchases;
    private freeMass = 0;
    private buyButton?: Button;
    private sellButton?: Button;
    // The market context (planet tech, masks, control bits, daily rolls),
    // set by the spaceport before each show(); drives the list filter.
    private market?: MarketContext;

    private text = {
        description: new PIXI.Text("", FONT.normal),
        itemPrice: new PIXI.Text("Item Price:", FONT.normal),
        price: new PIXI.Text("5,000 cr", FONT.normal),
        youHave: new PIXI.Text("You Have:", FONT.normal),
        count: new PIXI.Text("∞ cr", FONT.normal),
        itemMass: new PIXI.Text("Item Mass:", FONT.normal),
        mass: new PIXI.Text("3", FONT.normal),
        availableMass: new PIXI.Text("Available:", FONT.normal),
        freeMass: new PIXI.Text("", FONT.normal),
        creditsLabel: new PIXI.Text("Credits:", FONT.normal),
        credits: new PIXI.Text("", FONT.normal),
    }

    constructor(gameData: GameData,
        controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8502", controlEvents);

        this.outfits = new DefaultMap(() => 0);
        const buttons = {
            buy: new Button(gameData, "Buy", 60, { x: -100, y: 126 }),
            sell: new Button(gameData, "Sell", 60, { x: 0, y: 126 }),
            done: new Button(gameData, "Done", 60, { x: 100, y: 126 })
        };

        buttons.buy.click.subscribe(this.buyOutfit.bind(this));
        buttons.sell.click.subscribe(this.sellOutfit.bind(this));
        buttons.done.click.subscribe(this.done.bind(this));
        this.addButtons(buttons);
        this.buyButton = buttons.buy;
        this.sellButton = buttons.sell;

        this.pictContainer.position.x = 174;
        this.pictContainer.position.y = -152.5;
        this.pictContainer.scale.x = 1;
        this.pictContainer.scale.y = 1;
        this.container.addChild(this.pictContainer);

        this.text.description.position.x = -27;
        this.text.description.position.y = -150;
        this.descScroll = makeTextScrollable(this.text.description, -27, -150,
            descWidth, 260).scroll;

        this.text.itemPrice.position.x = 234;
        this.text.itemPrice.position.y = 58;

        this.text.price.position.x = 300;
        this.text.price.position.y = 58;

        this.text.youHave.position.x = 234;
        this.text.youHave.position.y = 70;

        this.text.count.position.x = 300;
        this.text.count.position.y = 70;

        this.text.itemMass.position.x = 234;
        this.text.itemMass.position.y = 94;

        this.text.mass.position.x = 300;
        this.text.mass.position.y = 94;

        this.text.availableMass.position.x = 234;
        this.text.availableMass.position.y = 106;

        this.text.freeMass.position.x = 300;
        this.text.freeMass.position.y = 106;

        this.text.creditsLabel.position.x = 234;
        this.text.creditsLabel.position.y = 118;

        this.text.credits.position.x = 300;
        this.text.credits.position.y = 118;

        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }
    }

    /** Called by the spaceport before each show() with the live wallet,
     * price modifier and free mass. */
    setPurchases(purchases: OutfitterPurchases) {
        this.purchases = purchases;
    }

    /** The market context (planet tech, masks, control bits, daily rolls)
     * — set by the spaceport before each show(). */
    setMarketContext(market: MarketContext) {
        this.market = market;
    }

    protected override async build() {
        // The grid itself is built per show(): the binary re-runs its list
        // builder (FUN_0046a220) at every dialog open, and the filter reads
        // the outfit state that arrives with show().
    }

    // Re-lists the outfitter per open (FUN_0046a220): tech gate + (when not
    // owned) AvailBits/govt-mask/stock checks, then the displayWeight order.
    private async rebuildGrid() {
        const market = this.market;
        const ids = (await this.gameData.ids).Outfit;
        const outfits: OutfitData[] = [];
        for (const id of ids) {
            const outfit = await this.gameData.data.Outfit.get(id, 100);
            const owned = (this.outfits.get(id) ?? 0) > 0;
            if (market && !outfitListed(outfit, owned, market)) {
                continue;
            }
            outfits.push(outfit);
        }
        const itemGrid = new ItemGrid(this.gameData, orderOutfits(outfits));
        itemGrid.setCounts(this.outfits);
        this.setItemGrid(itemGrid);
    }

    private setItemGrid(itemGrid: ItemGrid<OutfitData>) {
        if (this.itemGrid) {
            this.container.removeChild(this.itemGrid.container);
            this.gridSubscription?.unsubscribe();
        }
        this.itemGrid = itemGrid;
        this.gridSubscription = itemGrid.activeTile
            .subscribe(this.setOutfitSelected.bind(this));

        itemGrid.drawGrid();
        itemGrid.container.position.x = -373;
        itemGrid.container.position.y = -153;
        this.container.addChild(itemGrid.container);

        this.controls.controls = {
            left: () => itemGrid.left(),
            right: () => itemGrid.right(),
            up: () => itemGrid.up(),
            down: () => itemGrid.down(),
            buy: this.buyOutfit.bind(this),
            sell: this.sellOutfit.bind(this),
            depart: this.done.bind(this),
        };
    }

    // The binary rebuilds its list at every dialog open, so show() re-lists
    // before the menu becomes visible. setInput runs first so the owned
    // outfits (which skip the stock/expression checks) are current.
    override async show(input: OutfitsState): Promise<OutfitsState> {
        await this.buildPromise;
        this.setInput(input);
        await this.rebuildGrid();
        return super.show(input);
    }

    private buyOutfit() {
        const outfit = this.itemGrid?.selection;
        if (!outfit) {
            return;
        }

        if (this.purchases) {
            const wallet = { credits: this.purchases.credits() };
            const result = purchase.buyOutfit(wallet, asOutfits(this.outfits),
                outfit, this.freeMass, this.purchases.priceMod);
            if (!result) {
                // Not enough credits or mass: no-op, the Buy button is grey.
                return;
            }
            this.purchases.setCredits(result.credits);
            this.freeMass = result.freeMass;
            this.outfits = countsMap(result.outfits);
        }
        else {
            // No mission system: buying is free (legacy behavior).
            this.outfits.set(outfit.id, this.outfits.get(outfit.id) + 1);
        }

        this.itemGrid?.setCounts(this.outfits);
        this.setCountText(outfit);
        this.setFreeMassText();
        this.setCreditsText();
        this.updateButtons();
    }

    private sellOutfit() {
        const outfit = this.itemGrid?.selection;
        if (!outfit) {
            return;
        }

        if (this.purchases) {
            const wallet = { credits: this.purchases.credits() };
            const result = purchase.sellOutfit(wallet, asOutfits(this.outfits),
                outfit, this.freeMass);
            if (!result) {
                // Nothing to sell: no-op, the Sell button is grey.
                return;
            }
            this.purchases.setCredits(result.credits);
            this.freeMass = result.freeMass;
            this.outfits = countsMap(result.outfits);
        }
        else {
            this.outfits.set(outfit.id, Math.max(0, this.outfits.get(outfit.id) - 1));
            if (this.outfits.get(outfit.id) === 0) {
                this.outfits.delete(outfit.id);
            }
        }

        this.itemGrid?.setCounts(this.outfits);
        this.setCountText(outfit);
        this.setFreeMassText();
        this.setCreditsText();
        this.updateButtons();
    }

    private setOutfitSelected(outfitTile: ItemTile<OutfitData> | undefined) {
        // Set Picture
        this.pictContainer.children.length = 0;
        this.text.description.text = "";
        this.text.price.text = "";
        this.text.count.text = "";
        this.text.mass.visible = false;
        this.text.itemMass.visible = false;
        this.text.availableMass.visible = false;
        this.text.freeMass.visible = false;
        this.text.creditsLabel.visible = false;
        this.text.credits.visible = false;

        if (!outfitTile) {
            return;
        }

        if (outfitTile.largePict) {
            this.pictContainer.addChild(outfitTile.largePict);
        }

        // Set Description — expand the dësc blocks ({bXXX/{P registration
        // gates, <PNN>/<PST> name tags) against the real player context.
        this.descScroll?.(0, true);
        this.text.description.text = this.purchases
            ? expandDescription(outfitTile.item.desc, this.purchases.descriptionCtx)
            : outfitTile.item.desc;

        // Set price text: what buying one costs here (price-modified when
        // the purchases context is live).
        const price = this.purchases
            ? purchase.outfitPrice(outfitTile.item, this.purchases.priceMod)
            : outfitTile.item.price;
        this.text.price.text = formatPrice(price);

        // Set owned-count text
        this.setCountText(outfitTile.item);

        // Credits are always visible once an item is selected.
        this.setCreditsText();
        this.text.creditsLabel.visible = true;
        this.text.credits.visible = true;

        if (outfitTile.item.physics.freeMass > 0) {
            // Set mass text
            this.text.mass.text = outfitTile.item.physics.freeMass + " tons";
            this.setFreeMassText();
            this.text.mass.visible = true;
            this.text.itemMass.visible = true;
            this.text.availableMass.visible = true;
            this.text.freeMass.visible = true;
        }

        this.updateButtons();
    }

    private setFreeMassText() {
        this.text.freeMass.text = formatMass(this.freeMass);
    }

    private setCountText(outfit: OutfitData) {
        this.text.count.text = String(this.outfits.get(outfit.id) ?? 0);
    }

    private setCreditsText() {
        // The ∞ placeholder keeps the legacy free-buying mode readable.
        this.text.credits.text = this.purchases
            ? formatPrice(this.purchases.credits())
            : "∞ cr";
    }

    // Greys the Buy/Sell buttons while the selected outfit is unaffordable
    // or there is nothing to sell; the click handlers no-op regardless.
    private updateButtons() {
        const outfit = this.itemGrid?.selection;
        if (!outfit || !this.purchases) {
            return;
        }
        const wallet = { credits: this.purchases.credits() };
        this.buyButton!.state = purchase.canBuyOutfit(wallet, outfit,
            this.freeMass, this.purchases.priceMod) ? 'normal' : 'grey';
        this.sellButton!.state =
            (this.outfits.get(outfit.id) ?? 0) > 0 ? 'normal' : 'grey';
    }

    protected override setInput(input: OutfitsState) {
        this.outfits = new DefaultMap(() => 0, [...input].map(
            ([k, v]) => [k, v.count]));
        if (this.purchases) {
            this.freeMass = this.purchases.freeMass;
            this.setCreditsText();
        }
        super.setInput(input);
        this.itemGrid?.setCounts(this.outfits);
    }

    protected override done() {
        this.input = new Map([...this.outfits]
            .map(([id, count]) => [id, { count }]));
        super.done();
    }
}

/** OutfitsState (id -> {count}) view of a counts map, for the pure module. */
function asOutfits(counts: Map<string, number>): purchase.Outfits {
    return new Map([...counts].map(([id, count]) => [id, { count }]));
}

/** Counts map (id -> count) out of a pure-module result, DefaultMap so the
 * outfitter's `+1` writes keep working. */
function countsMap(outfits: purchase.Outfits): DefaultMap<string, number> {
    return new DefaultMap(() => 0, [...outfits].map(([id, { count }]) =>
        [id, count] as [string, number]));
}

function addCommas(p: number) {
    return p.toLocaleString();
}

export function formatPrice(p: number) {
    var mil = 1000000;
    if (p >= mil) {
        var modmil = String(p % mil).substring(0, 3);
        modmil += "0".repeat(3 - modmil.length);
        return addCommas(Math.floor(p / mil)) + "." + modmil + "M cr";
    }
    else {
        return addCommas(p) + " cr";
    }
};

export function formatMass(m: number) {
    return m.toLocaleString() + " tons";
};
