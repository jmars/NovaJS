import { ShipData } from 'novadatainterface/ShipData';
import { StringSetData } from 'novadatainterface/StringSetData';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Observable, Subscription } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { makeShip } from '../nova_plugin/make_ship';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { ShipComponent } from '../nova_plugin/ship_plugin';
import { Button } from './button';
import { TextDialog } from './briefing';
import { ItemGrid, ItemTile } from './item_grid';
import { MarketContext, orderShips, shipListed } from './market_filter';
import { Menu } from './menu';
import { expandDescription } from './mission_text';
import { FONT, formatPrice } from './outfitter';
import * as purchase from './purchase';

// STR# 2002 item 222: the binary shows this message instead of the shipyard
// when nothing is for sale (FUN_00469e90's empty list).
const EMPTY_SHIPYARD_STR = "nova:2002";
const EMPTY_SHIPYARD_ITEM = 222;


/**
 * The money context the spaceport sets before each show(): the player
 * wallet (read + write-through persist) and the planet's price modifier.
 * Undefined in worlds without the mission system, where buying stays free
 * (legacy behavior).
 */
export interface ShipyardPurchases {
    credits(): number;
    setCredits(credits: number): void;
    priceMod: number;
    // Real context for expanding the ship description's dësc blocks
    // ({bXXX/{P registration gates, <PNN>/<PST> name tags).
    descriptionCtx: Parameters<typeof expandDescription>[1];
}

export class Shipyard extends Menu<Entity> {
    private pictContainer = new PIXI.Container();
    itemGrid?: ItemGrid<ShipData>;
    private gridSubscription?: Subscription;
    private purchases?: ShipyardPurchases;
    private buyButton?: Button;
    private emptyDialog: TextDialog;
    private emptyStrings: Promise<StringSetData | null>;
    // The market context (planet tech, masks, control bits, daily rolls),
    // set by the spaceport before each show(); drives the list filter.
    private market?: MarketContext;
    private text = {
        description: new PIXI.Text("", FONT.normal),
        priceLabel: new PIXI.Text("Price:", FONT.normal),
        price: new PIXI.Text("", FONT.normal),
        creditsLabel: new PIXI.Text("Credits:", FONT.normal),
        credits: new PIXI.Text("", FONT.normal),
    }

    constructor(gameData: GameData,
        controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8502", controlEvents);
        const buttons = {
            buy: new Button(gameData, "Buy", 60, { x: -20, y: 126 }),
            done: new Button(gameData, "Done", 60, { x: 100, y: 126 }),
        };
        this.addButtons(buttons);
        this.buyButton = buttons.buy;
        this.emptyDialog = new TextDialog(gameData, controlEvents);
        this.container.addChild(this.emptyDialog.container);
        this.emptyStrings = gameData.data.StringSet.get(EMPTY_SHIPYARD_STR)
            .catch(() => null);

        buttons.buy.click.subscribe(this.buyShip.bind(this));
        buttons.done.click.subscribe(this.done.bind(this));

        this.text.description.position.x = -27;
        this.text.description.position.y = -150;

        this.text.priceLabel.position.x = 234;
        this.text.priceLabel.position.y = 58;

        this.text.price.position.x = 300;
        this.text.price.position.y = 58;

        this.text.creditsLabel.position.x = 234;
        this.text.creditsLabel.position.y = 70;

        this.text.credits.position.x = 300;
        this.text.credits.position.y = 70;

        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }

        this.pictContainer.position.x = 174;
        this.pictContainer.position.y = -152.5;
        this.container.addChild(this.pictContainer);
        this.build();
    }

    /** Called by the spaceport before each show() with the live wallet and
     * price modifier. */
    setPurchases(purchases: ShipyardPurchases) {
        this.purchases = purchases;
    }

    /** The market context (planet tech, masks, control bits, daily rolls)
     * — set by the spaceport before each show(). */
    setMarketContext(market: MarketContext) {
        this.market = market;
    }

    protected override async build() {
        await super.build();
        // The grid itself is built per show(): the binary re-runs its list
        // builder (FUN_00469e90) at every dialog open.
    }

    // Re-lists the shipyard market per open (FUN_00469e90): tech gate,
    // AvailBits/govt-mask/stock checks, then the displayOrder order.
    // Returns false when nothing is for sale.
    private async rebuildGrid(): Promise<boolean> {
        const market = this.market;
        const ids = (await this.gameData.ids).Ship;
        const ships: ShipData[] = [];
        for (const id of ids) {
            const ship = await this.gameData.data.Ship.get(id, 100);
            if (market && !shipListed(ship, market)) {
                continue;
            }
            ships.push(ship);
        }
        const ordered = orderShips(ships);
        if (ordered.length === 0) {
            return false;
        }
        this.setItemGrid(new ItemGrid(this.gameData, ordered));
        return true;
    }

    private setItemGrid(itemGrid: ItemGrid<ShipData>) {
        if (this.itemGrid) {
            this.container.removeChild(this.itemGrid.container);
            this.gridSubscription?.unsubscribe();
        }
        this.itemGrid = itemGrid;
        this.gridSubscription = itemGrid.activeTile
            .subscribe(this.setShipSelected.bind(this));

        itemGrid.drawGrid();
        itemGrid.container.position.x = -373;
        itemGrid.container.position.y = -153;
        this.container.addChild(itemGrid.container);

        this.controls.controls = {
            left: () => itemGrid.left(),
            right: () => itemGrid.right(),
            up: () => itemGrid.up(),
            down: () => itemGrid.down(),
            buy: this.buyShip.bind(this),
            depart: this.done.bind(this),
        };
    }

    // The binary rebuilds its list at every dialog open, so show() re-lists
    // first. An empty market shows the STR# 2002 message instead of the
    // shipyard.
    override async show(input: Entity): Promise<Entity> {
        await this.buildPromise;
        const listed = await this.rebuildGrid();
        if (!listed) {
            this.container.visible = true;
            await this.emptyDialog.showText(await this.emptyMessage());
            this.container.visible = false;
            return input;
        }
        return super.show(input);
    }

    private async emptyMessage(): Promise<string> {
        const strings = (await this.emptyStrings)?.strings;
        return strings?.[EMPTY_SHIPYARD_ITEM]
            ?? "There are no ships available for purchase here.";
    }

    private setShipSelected(shipTile: ItemTile<ShipData> | undefined) {
        this.pictContainer.children.length = 0;
        this.text.description.text = "";
        this.text.price.text = "";
        this.text.priceLabel.visible = false;
        this.text.credits.text = "";
        this.text.creditsLabel.visible = false;
        if (!shipTile) {
            return;
        }

        if (shipTile.largePict) {
            this.pictContainer.addChild(shipTile.largePict);
        }

        // Set Description — expand the dësc blocks ({bXXX/{P registration
        // gates, <PNN>/<PST> name tags) against the real player context.
        this.text.description.text = this.purchases
            ? expandDescription(shipTile.item.desc, this.purchases.descriptionCtx)
            : shipTile.item.desc;

        // Price (price-modified when the purchases context is live) and the
        // current credits, once a ship is selected.
        this.text.price.text = formatPrice(this.purchases
            ? purchase.shipPrice(shipTile.item, this.purchases.priceMod)
            : shipTile.item.price);
        this.text.priceLabel.visible = true;
        this.setCreditsText();
        this.text.creditsLabel.visible = true;
        this.text.credits.visible = true;

        this.updateBuyButton(shipTile.item);
    }

    private setCreditsText() {
        this.text.credits.text = this.purchases
            ? formatPrice(this.purchases.credits())
            : "∞ cr";
    }

    private async buyShip() {
        const shipData = this.itemGrid?.selection;
        if (!shipData) {
            return;
        }

        // Outfits riding along to the new ship; under the purchases context
        // the pure module copies them (all outfits transfer — the ship
        // providers recompute the new ship's physics from them).
        const currentOutfits = this.input.components.get(OutfitsStateComponent)
            ?? new Map();
        let outfits: typeof currentOutfits;
        if (this.purchases) {
            const wallet = { credits: this.purchases.credits() };
            const tradeIn = await this.tradeInValue(currentOutfits);
            const result = purchase.buyShip(wallet, shipData,
                this.purchases.priceMod, tradeIn, currentOutfits);
            if (!result) {
                // Not enough credits: no-op, the Buy button is grey.
                return;
            }
            this.purchases.setCredits(result.credits);
            outfits = result.outfits;
        }
        else {
            outfits = currentOutfits;
        }

        this.input = makeShip(shipData);
        // Set before the spaceport's provider world steps, so
        // ShipOutfitsProvider keeps these instead of the stock loadout.
        this.input.components.set(OutfitsStateComponent, outfits);
        this.input.components.set(PlayerShipSelector, undefined);
        // For convenience
        (window as any).myShip = this.input;

        this.setCreditsText();
        this.updateBuyButton(shipData);
    }

    // Trade-in for the current ship: 25% of its price plus its outfits'
    // (Nova Bible: "the original cost of your current ship and upgrades").
    private async tradeInValue(currentOutfits: Map<string, { count: number }>) {
        const shipId = this.input.components.get(ShipComponent)?.id;
        if (!shipId) {
            return 0;
        }
        try {
            const ship = await this.gameData.data.Ship.get(shipId);
            const prices = new Map<string, number | null>();
            for (const id of currentOutfits.keys()) {
                try {
                    prices.set(id, (await this.gameData.data.Outfit.get(id)).price);
                }
                catch {
                    prices.set(id, null);
                }
            }
            return purchase.tradeInValue(ship.price, currentOutfits,
                id => prices.get(id) ?? null);
        }
        catch {
            // Unknown current ship type: no trade-in value.
            return 0;
        }
    }

    // Greys Buy while the selected ship is unaffordable (net of trade-in);
    // the click handler no-ops regardless.
    private async updateBuyButton(shipData: ShipData) {
        if (!this.purchases) {
            return;
        }
        const tradeIn = await this.tradeInValue(
            this.input.components.get(OutfitsStateComponent) ?? new Map());
        this.buyButton!.state = purchase.canBuyShip(
            { credits: this.purchases.credits() }, shipData,
            this.purchases.priceMod, tradeIn) ? 'normal' : 'grey';
    }
}
