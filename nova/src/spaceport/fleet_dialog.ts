import { ShipData } from "novadatainterface/ShipData";
import * as PIXI from 'pixi.js';
import { Observable } from "rxjs";
import { GameData } from "../client/gamedata/GameData";
import { ControlEvent } from "../nova_plugin/controls_plugin";
import * as ops from "../player/escort_ops";
import { EscortState, FleetState } from "../player/player_state";
import { Button } from "./button";
import { FONT, formatPrice } from "./outfitter";
import { ItemGrid, ItemTile } from "./item_grid";
import { Menu } from "./menu";

/**
 * The money context the spaceport sets before each show(): the player
 * wallet (read + write-through persist) and the planet's price modifier
 * (applied to the upgrade purchase only — purchase.ts precedent; selling
 * uses the plain EscSellValue/10% default).
 */
export interface FleetPurchases {
    credits(): number;
    setCredits(credits: number): void;
    priceMod: number;
}

// One grid tile: an escort plus the fleet index and ship data the pure
// sell/upgrade ops need. `id` (the fleet-local escort id) is the ItemGrid
// identity and survives selection rebuilds.
interface FleetItem {
    id: string;
    name: string;
    desc: string;
    pict: string;
    index: number;      // index into FleetState.escorts right now
    escort: EscortState;
    shipData: ShipData;
}

/**
 * The fleet dialog: the player's escorts on an ItemGrid (Outfitter/Trade
 * Center pattern) with Sell (Bible EscSellValue, default 10% of cost) and
 * Upgrade (EscUpgrdCost * priceMod buys the shïp's UpgradeTo target)
 * alongside Done. The pure transitions live in player/escort_ops.ts and
 * mutate the live PlayerState.fleet in place; credits go through the
 * write-through wallet. Sold escorts' entities disappear via the
 * EscortReconcileSystem once their fleet entry is gone.
 */
export class FleetDialog extends Menu<FleetState> {
    private itemGrid?: ItemGrid<FleetItem>;
    private fleet: FleetState = { escorts: [], nextId: 0 };
    private purchases?: FleetPurchases;
    private sellButton?: Button;
    private upgradeButton?: Button;
    // Ship global id -> name, for labeling upgrade targets (populated as
    // ships are resolved).
    private shipNames = new Map<string, string>();

    private text = {
        description: new PIXI.Text("", FONT.normal),
        sellLabel: new PIXI.Text("Sell Value:", FONT.normal),
        sellValue: new PIXI.Text("", FONT.normal),
        upgradeLabel: new PIXI.Text("Upgrade To:", FONT.normal),
        upgradeTarget: new PIXI.Text("", FONT.normal),
        upgradeLabel2: new PIXI.Text("Upgrade Cost:", FONT.normal),
        upgradeCost: new PIXI.Text("", FONT.normal),
        ordersLabel: new PIXI.Text("Orders:", FONT.normal),
        orders: new PIXI.Text("", FONT.normal),
        creditsLabel: new PIXI.Text("Credits:", FONT.normal),
        credits: new PIXI.Text("", FONT.normal),
    }

    constructor(gameData: GameData,
        controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8502", controlEvents);

        const buttons = {
            sell: new Button(gameData, "Sell", 60, { x: -100, y: 126 }),
            upgrade: new Button(gameData, "Upgrade", 60, { x: 0, y: 126 }),
            done: new Button(gameData, "Done", 60, { x: 100, y: 126 })
        };

        buttons.sell.click.subscribe(this.sell.bind(this));
        buttons.upgrade.click.subscribe(this.upgrade.bind(this));
        buttons.done.click.subscribe(this.done.bind(this));
        this.addButtons(buttons);
        this.sellButton = buttons.sell;
        this.upgradeButton = buttons.upgrade;

        this.text.description.position.x = -27;
        this.text.description.position.y = -150;

        this.text.sellLabel.position.x = 234;
        this.text.sellLabel.position.y = 58;
        this.text.sellValue.position.x = 300;
        this.text.sellValue.position.y = 58;

        this.text.upgradeLabel.position.x = 234;
        this.text.upgradeLabel.position.y = 70;
        this.text.upgradeTarget.position.x = 300;
        this.text.upgradeTarget.position.y = 70;

        this.text.upgradeLabel2.position.x = 234;
        this.text.upgradeLabel2.position.y = 82;
        this.text.upgradeCost.position.x = 300;
        this.text.upgradeCost.position.y = 82;

        this.text.ordersLabel.position.x = 234;
        this.text.ordersLabel.position.y = 94;
        this.text.orders.position.x = 300;
        this.text.orders.position.y = 94;

        this.text.creditsLabel.position.x = 234;
        this.text.creditsLabel.position.y = 118;
        this.text.credits.position.x = 300;
        this.text.credits.position.y = 118;

        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }
    }

    /** Called by the spaceport before each show() with the live wallet and
     * price modifier. */
    setPurchases(purchases: FleetPurchases) {
        this.purchases = purchases;
    }

    /** Rebuilds the escort grid from the (live) fleet, resolving every
     * escort's ship data fresh — an upgrade just changed a shipType.
     * Keeps the selection on the same escort when it survived. */
    async updateFleet(fleet: FleetState) {
        this.fleet = fleet;
        const items: FleetItem[] = [];
        for (const [index, escort] of fleet.escorts.entries()) {
            let shipData: ShipData;
            try {
                shipData = await this.gameData.data.Ship.get(escort.shipType);
            }
            catch {
                // Unknown ship data: a bare entry with nothing to sell.
                shipData = {
                    ...{}, name: escort.shipType, desc: "", pict: "",
                } as unknown as ShipData;
            }
            this.shipNames.set(escort.shipType, shipData.name);
            items.push({
                id: escort.id,
                name: shipData.name,
                desc: shipData.desc,
                pict: shipData.pict,
                index,
                escort,
                shipData,
            });
        }

        const selectedId = this.itemGrid?.selection?.id;
        if (this.itemGrid) {
            this.container.removeChild(this.itemGrid.container);
        }
        const itemGrid = new ItemGrid(this.gameData, items);
        this.itemGrid = itemGrid;
        itemGrid.drawGrid();
        itemGrid.container.position.x = -373;
        itemGrid.container.position.y = -153;
        this.container.addChild(itemGrid.container);
        const stillThere = items.find(item => item.id === selectedId);
        if (stillThere) {
            itemGrid.selection = stillThere;
        }
        itemGrid.activeTile.subscribe(this.setEscortSelected.bind(this));

        this.controls.controls = {
            left: () => itemGrid.left(),
            right: () => itemGrid.right(),
            up: () => itemGrid.up(),
            down: () => itemGrid.down(),
            sell: this.sell.bind(this),
            buy: this.upgrade.bind(this),
            depart: this.done.bind(this),
        };
    }

    // The wallet the ops mutate: the fleet object is the caller's live
    // PlayerState.fleet (mutations persist) and credits flow through the
    // write-through wallet.
    private wallet(): ops.FleetWallet {
        return { credits: this.purchases?.credits() ?? 0, fleet: this.fleet };
    }

    private sell() {
        const item = this.itemGrid?.selection;
        if (!item || !this.purchases) {
            return;
        }
        const result = ops.sellEscort(this.wallet(), item.index, item.shipData);
        if (!result) {
            return;
        }
        this.purchases.setCredits(result.credits);
        // Rebuild without the sold escort (the indexes shifted).
        void this.updateFleet(this.fleet);
    }

    private upgrade() {
        const item = this.itemGrid?.selection;
        if (!item || !this.purchases) {
            return;
        }
        const result = ops.upgradeEscort(this.wallet(), item.index,
            item.shipData, this.purchases.priceMod);
        if (!result) {
            // No upgrade chain or unaffordable: no-op, the button is grey.
            return;
        }
        this.purchases.setCredits(result.credits);
        // Rebuild: the escort's shipType (and so name/sell value) changed.
        void this.updateFleet(this.fleet);
    }

    private setEscortSelected(itemTile: ItemTile<FleetItem> | undefined) {
        this.text.description.text = "";
        this.text.sellValue.text = "";
        this.text.upgradeTarget.text = "";
        this.text.upgradeCost.text = "";
        this.text.orders.text = "";
        if (!itemTile) {
            this.setCreditsText();
            this.updateButtons();
            return;
        }
        const { shipData, escort } = itemTile.item;

        this.text.description.text = shipData.desc;
        this.text.sellValue.text = formatPrice(ops.escortSellValue(shipData));

        // The shïp the Upgrade button would turn this escort into.
        if (shipData.upgradeTo === null) {
            this.text.upgradeTarget.text = "—";
            this.text.upgradeCost.text = "—";
        }
        else {
            this.setUpgradeTargetText(shipData.upgradeTo);
            this.text.upgradeCost.text = formatPrice(
                ops.escortUpgradePrice(shipData,
                    this.purchases?.priceMod ?? 1));
        }

        this.text.orders.text = escort.orders === 'hold' ? "Hold" : "Follow";

        this.setCreditsText();
        this.updateButtons();
    }

    // Label for the upgrade-target ship id: a name when one has been
    // resolved (the grid resolves each escort's ship on every fleet
    // change), otherwise the raw id, upgraded to the name once its data
    // arrives — if the same escort is still selected.
    private setUpgradeTargetText(targetId: string) {
        const show = (text: string) => {
            const selected = this.itemGrid?.selection;
            if (selected?.shipData.upgradeTo === targetId) {
                this.text.upgradeTarget.text = text;
            }
        };
        show(this.shipNames.get(targetId) ?? targetId);
        this.gameData.data.Ship.get(targetId).then(data => {
            this.shipNames.set(targetId, data.name);
            show(data.name);
        }).catch(() => {
            // Missing target data: keep whatever label we have.
        });
    }

    private setCreditsText() {
        this.text.credits.text = this.purchases
            ? formatPrice(this.purchases.credits())
            : "∞ cr";
    }

    // Greys the Upgrade button while the selected escort can't be upgraded
    // here; Sell is always possible for a selected escort. The click
    // handlers no-op regardless.
    private updateButtons() {
        const item = this.itemGrid?.selection;
        if (!item || !this.purchases) {
            return;
        }
        this.sellButton!.state = 'normal';
        this.upgradeButton!.state =
            ops.canUpgradeEscort(this.wallet(), item.escort, item.shipData,
                this.purchases.priceMod) ? 'normal' : 'grey';
    }
}
