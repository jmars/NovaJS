import { ShipData } from 'novadatainterface/ShipData';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { makeShip } from '../nova_plugin/make_ship';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { ShipComponent } from '../nova_plugin/ship_plugin';
import { Button } from './button';
import { ItemGrid, ItemTile } from './item_grid';
import { Menu } from './menu';
import { FONT, formatPrice } from './outfitter';
import * as purchase from './purchase';


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
}

export class Shipyard extends Menu<Entity> {
    private pictContainer = new PIXI.Container();
    itemGrid?: ItemGrid<ShipData>;
    private purchases?: ShipyardPurchases;
    private buyButton?: Button;
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

    protected override async build() {
        await super.build();
        const itemGrid = await this.makeShipsGrid();
        this.itemGrid = itemGrid;
        this.container.addChild(itemGrid.container);

        this.itemGrid.drawGrid();
        this.itemGrid.container.position.x = -373;
        this.itemGrid.container.position.y = -153;
        this.itemGrid.activeTile.subscribe(this.setShipSelected.bind(this));

        this.controls.controls = {
            left: () => itemGrid.left(),
            right: () => itemGrid.right(),
            up: () => itemGrid.up(),
            down: () => itemGrid.down(),
            buy: this.buyShip.bind(this),
            depart: this.done.bind(this),
        };
    }

    private async makeShipsGrid() {
        const ids = (await this.gameData.ids).Ship;
        const ships = await Promise.all(ids.map(id =>
            this.gameData.data.Ship.get(id, 100)));
        ships.sort((a, b) => b.displayWeight - a.displayWeight);
        const itemGrid = new ItemGrid(this.gameData, ships);
        return itemGrid;
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

        // Set Description
        this.text.description.text = shipTile.item.desc;

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
