import * as PIXI from 'pixi.js';
import { Observable } from "rxjs";
import { GameData } from "../client/gamedata/GameData";
import { ControlEvent } from "../nova_plugin/controls_plugin";
import { cargoOf, CargoEntry } from "../player/cargo";
import * as trade from "../player/trade";
import { FONT, formatMass, formatPrice } from "./outfitter";
import { ItemGrid, ItemTile } from "./item_grid";
import { Menu } from "./menu";
import { Button } from "./button";


/**
 * The money/cargo context the spaceport sets before each show(): the
 * player wallet (read + write-through persist), the planet's price
 * modifier (applied to buying only — purchase.ts precedent) and the free
 * hold space the ship has left.
 */
export interface TradePurchases {
    credits(): number;
    setCredits(credits: number): void;
    priceMod: number;
    freeTons: number;
}

/**
 * The trade center (commodity exchange): an ItemGrid of the goods this
 * planet trades plus Buy/Sell/Done, on the Outfitter pattern. One ton per
 * Buy/Sell click. The goods list and purchases context are pushed in by
 * the spaceport before each show() (the planet is fixed per spaceport, but
 * the wallet, hold and price modifier are read live); show() takes the
 * pilot's hold and resolves with the updated one.
 */
export class TradeCenter extends Menu<CargoEntry[]> {
    private itemGrid?: ItemGrid<trade.TradeGood>;
    private goods: trade.TradeGood[] = [];
    private cargo: CargoEntry[] = [];
    private purchases?: TradePurchases;
    private freeTons = 0;
    private buyButton?: Button;
    private sellButton?: Button;

    private text = {
        description: new PIXI.Text("", FONT.normal),
        itemPrice: new PIXI.Text("Price:", FONT.normal),
        price: new PIXI.Text("", FONT.normal),
        youHave: new PIXI.Text("You Have:", FONT.normal),
        count: new PIXI.Text("", FONT.normal),
        holdSpace: new PIXI.Text("Hold Space:", FONT.normal),
        freeTons: new PIXI.Text("", FONT.normal),
        creditsLabel: new PIXI.Text("Credits:", FONT.normal),
        credits: new PIXI.Text("", FONT.normal),
    }

    constructor(gameData: GameData,
        controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8502", controlEvents);

        const buttons = {
            buy: new Button(gameData, "Buy", 60, { x: -100, y: 126 }),
            sell: new Button(gameData, "Sell", 60, { x: 0, y: 126 }),
            done: new Button(gameData, "Done", 60, { x: 100, y: 126 })
        };

        buttons.buy.click.subscribe(this.buy.bind(this));
        buttons.sell.click.subscribe(this.sell.bind(this));
        buttons.done.click.subscribe(this.done.bind(this));
        this.addButtons(buttons);
        this.buyButton = buttons.buy;
        this.sellButton = buttons.sell;

        this.text.description.position.x = -27;
        this.text.description.position.y = -150;

        this.text.itemPrice.position.x = 234;
        this.text.itemPrice.position.y = 58;
        this.text.price.position.x = 300;
        this.text.price.position.y = 58;

        this.text.youHave.position.x = 234;
        this.text.youHave.position.y = 70;
        this.text.count.position.x = 300;
        this.text.count.position.y = 70;

        this.text.holdSpace.position.x = 234;
        this.text.holdSpace.position.y = 94;
        this.text.freeTons.position.x = 300;
        this.text.freeTons.position.y = 94;

        this.text.creditsLabel.position.x = 234;
        this.text.creditsLabel.position.y = 118;
        this.text.credits.position.x = 300;
        this.text.credits.position.y = 118;

        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }
    }

    /** Replaces the tradable-goods grid (called before each show; the
     * spaceport recomputes the list from the planet data and the live
     * control-bit context). */
    setGoods(goods: trade.TradeGood[]) {
        if (this.itemGrid) {
            this.container.removeChild(this.itemGrid.container);
        }
        this.goods = goods;
        const itemGrid = new ItemGrid(this.gameData, goods);
        this.itemGrid = itemGrid;
        itemGrid.drawGrid();
        itemGrid.container.position.x = -373;
        itemGrid.container.position.y = -153;
        this.container.addChild(itemGrid.container);
        itemGrid.activeTile.subscribe(this.setGoodSelected.bind(this));

        this.controls.controls = {
            left: () => itemGrid.left(),
            right: () => itemGrid.right(),
            up: () => itemGrid.up(),
            down: () => itemGrid.down(),
            buy: this.buy.bind(this),
            sell: this.sell.bind(this),
            depart: this.done.bind(this),
        };
    }

    /** Called by the spaceport before each show() with the live wallet,
     * price modifier and free hold space. */
    setPurchases(purchases: TradePurchases) {
        this.purchases = purchases;
    }

    private buy() {
        const good = this.itemGrid?.selection;
        if (!good || !this.purchases) {
            return;
        }
        const result = trade.buyGood(
            { credits: this.purchases.credits(), cargo: this.cargo, freeTons: this.freeTons },
            good, 1, this.purchases.priceMod);
        if (!result) {
            // Not sold here, unaffordable or hold full: no-op, the Buy
            // button is grey.
            return;
        }
        this.purchases.setCredits(result.credits);
        this.cargo = result.cargo;
        this.freeTons = result.freeTons;
        this.refresh(good);
    }

    private sell() {
        const good = this.itemGrid?.selection;
        if (!good || !this.purchases) {
            return;
        }
        const result = trade.sellGood(
            { credits: this.purchases.credits(), cargo: this.cargo, freeTons: this.freeTons },
            good, 1);
        if (!result) {
            // Not bought here or nothing in the hold: no-op, the Sell
            // button is grey.
            return;
        }
        this.purchases.setCredits(result.credits);
        this.cargo = result.cargo;
        this.freeTons = result.freeTons;
        this.refresh(good);
    }

    // Re-renders the tile counts and side panel after a trade (or a
    // selection change, or a fresh hold).
    private refresh(selected?: trade.TradeGood) {
        const good = selected ?? this.itemGrid?.selection;
        // Held tons show on every tile, Outfitter-style.
        const counts = new Map<string, number>();
        for (const tradable of this.goods) {
            counts.set(tradable.id, cargoOf(this.cargo, tradable.type));
        }
        this.itemGrid?.setCounts(counts);
        this.text.count.text = good
            ? String(cargoOf(this.cargo, good.type)) : "";
        this.text.freeTons.text = formatMass(this.freeTons);
        this.setCreditsText();
        this.updateButtons();
    }

    private setGoodSelected(goodTile: ItemTile<trade.TradeGood> | undefined) {
        this.text.description.text = "";
        this.text.price.text = "";
        if (!goodTile) {
            this.refresh();
            return;
        }
        this.text.description.text = goodTile.item.desc;

        // Price text: what buying one ton costs here (price-modified when
        // the purchases context is live).
        const price = this.purchases
            ? trade.buyPrice(goodTile.item, this.purchases.priceMod)
            : goodTile.item.price;
        this.text.price.text = formatPrice(price);

        this.refresh(goodTile.item);
    }

    private setCreditsText() {
        // The ∞ placeholder keeps the legacy no-wallet mode readable.
        this.text.credits.text = this.purchases
            ? formatPrice(this.purchases.credits())
            : "∞ cr";
    }

    // Greys the Buy/Sell buttons while the selected good is unbuyable or
    // unsellable; the click handlers no-op regardless.
    private updateButtons() {
        const good = this.itemGrid?.selection;
        if (!good || !this.purchases) {
            return;
        }
        const affordable =
            this.purchases.credits() >= trade.buyPrice(good, this.purchases.priceMod);
        this.buyButton!.state =
            good.canBuy && affordable && this.freeTons >= 1 ? 'normal' : 'grey';
        this.sellButton!.state =
            good.canSell && cargoOf(this.cargo, good.type) > 0 ? 'normal' : 'grey';
    }

    protected override setInput(input: CargoEntry[]) {
        this.cargo = input;
        if (this.purchases) {
            this.freeTons = this.purchases.freeTons;
        }
        super.setInput(input);
        this.refresh();
    }

    protected override done() {
        this.input = this.cargo;
        super.done();
    }
}
