import { PlanetData } from 'novadatainterface/PlanetData';
import { ShipData } from 'novadatainterface/ShipData';
import { AsyncSystemResource } from 'nova_ecs/async_system';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { ArmorComponent, IonizationComponent, ShieldComponent } from '../nova_plugin/health_plugin';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin';
import { ShipComponent, ShipPhysicsComponent, shipFreeCargoTons } from '../nova_plugin/ship_plugin';
import { SystemIdResource } from '../nova_plugin/system_id_resource';
import { SystemPlugin } from '../nova_plugin/system_plugin';
import { WeaponsStateComponent } from '../nova_plugin/weapons_state';
import { Button } from './button';
import { Bar } from './bar';
import { BriefingDialog, GameMissionTextEnv } from './briefing';
import { CARGO_NAME_STR } from './mission_text';
import { briefingInput, acceptOffer, computeOffers, logEffects, MissionBBS, MissionUiEnv, refuseOffer } from './mission_bbs';
import { MissionInfo, renderMissionInfo } from './mission_info';
import { Menu } from './menu';
import { MenuControls } from './menu_controls';
import { MarketContext, dailyMarketRoll } from './market_filter';
import { Outfitter } from './outfitter';
import * as purchase from './purchase';
import { Shipyard } from './shipyard';
import { FleetDialog, FleetPurchases } from './fleet_dialog';
import { TradeCenter, TradePurchases } from './trade_center';
import { globalId, rawIdOf } from '../missions/stellar_filter';
import { tradablesAt, TradeGood } from '../player/trade';
import { ControlBits } from '../player/player_state';
import { JunkData } from 'novadatainterface/JunkData';
import { TestContext } from 'novadatainterface/expressions';
import { MissionEnv } from '../missions/mission_state_machine';
import { queuePlayerStateSave } from '../missions/mission_plugin';
import { activeRankContributes, priceMod, RankEnv } from '../player/ranks';
import { PlayerState } from '../player/player_state';

// The mission state the spaceport UI reads and writes. Optional so the
// spaceport still works in worlds without the mission system.
export interface SpaceportMissions {
    playerState: PlayerState;
    env: MissionEnv;
}

export class Spaceport extends Menu<Entity> {
    private outfitter: Outfitter;
    private shipyard: Shipyard;
    private tradeCenter: TradeCenter;
    private fleetDialog: FleetDialog;
    private data?: PlanetData;

    // Jünk data (raw id -> parsed) and the STR# 4000 commodity names, each
    // fetched once per spaceport (the planet is fixed per spaceport).
    private junksPromise?: Promise<Map<number, JunkData>>;
    private namesPromise?: Promise<readonly string[]>;

    // Mission UI (undefined without SpaceportMissions).
    private missions?: SpaceportMissions;
    private textEnv?: GameMissionTextEnv;
    private briefing?: BriefingDialog;
    private missionBBS?: MissionBBS;
    private bar?: Bar;
    private barButton?: Button;
    private missionInfo?: MissionInfo;

    private showBBS = async () => {
        // Uninhabited planets have no mission BBS (spöb flag 0x00020 set);
        // this also gates the keyboard shortcut on them.
        if (this.data && !this.data.inhabited) {
            return;
        }
        this.controls.unbind();
        const offers = await computeOffers('bbs', await this.missionUi());
        await this.missionBBS!.showOffers(offers);
        this.controls.bind();
    };

    private showBar = async () => {
        this.controls.unbind();
        const ui = await this.missionUi();
        const offers = await computeOffers('bar', ui);
        await this.bar!.showOffers(offers, undefined, ui);
        this.controls.bind();
    };

    private showOutfitter = async () => {
        // Only planets with an outfitter (spöb flag 0x00004) offer one;
        // this also gates the keyboard shortcut on them.
        if (this.data && !this.data.hasOutfitter) {
            return;
        }
        this.controls.unbind();
        const outfits = this.input.components.get(OutfitsStateComponent) ?? new Map();
        const missions = this.missions;
        if (missions) {
            this.outfitter.setPurchases({
                credits: () => missions.playerState.credits,
                setCredits: credits => {
                    missions.playerState.credits = credits;
                    queuePlayerStateSave();
                },
                priceMod: this.getPriceMod(),
                freeMass: await this.currentFreeMass(outfits),
            });
            this.outfitter.setMarketContext(await this.marketContext(outfits));
        }
        const newOutfits = await this.outfitter.show(outfits);
        this.input.components.set(OutfitsStateComponent, newOutfits);
        // Delete these so they are re-created with the new outfits.
        // TODO: Find a better way to do this.
        this.input.components.delete(WeaponsStateComponent);
        this.input.components.delete(ShipPhysicsComponent);
        this.controls.bind();
    };

    private showShipyard = async () => {
        // Only planets with a shipyard (spöb flag 0x00008) offer one; this
        // also gates the keyboard shortcut on them.
        if (this.data && !this.data.hasShipyard) {
            return;
        }
        this.controls.unbind();
        const missions = this.missions;
        if (missions) {
            this.shipyard.setPurchases({
                credits: () => missions.playerState.credits,
                setCredits: credits => {
                    missions.playerState.credits = credits;
                    queuePlayerStateSave();
                },
                priceMod: this.getPriceMod(),
            });
            this.shipyard.setMarketContext(await this.marketContext(
                this.input.components.get(OutfitsStateComponent) ?? new Map()));
        }
        const newInput = await this.shipyard.show(this.input);
        if (newInput !== this.input) {
            // Construct a fake system and run providers so that outfits of the new
            // ship are provided.
            const shipBuildWorld = new World('outfit builder');
            shipBuildWorld.resources.set(GameDataResource, this.gameData);
            shipBuildWorld.resources.set(SystemIdResource, 'nova:128');
            await shipBuildWorld.addPlugin(SystemPlugin);
            shipBuildWorld.entities.set('ship', newInput);
            shipBuildWorld.step();
            await shipBuildWorld.resources.get(AsyncSystemResource)?.done;
            shipBuildWorld.step();
            shipBuildWorld.entities.delete('ship');
        }
        this.input = newInput;

        this.controls.bind();
    };

    private showInfo = async () => {
        this.controls.unbind();
        await this.missionInfo!.showText(await renderMissionInfo(await this.missionUi()));
        this.controls.bind();
    };

    // Opens the trade center (commodity exchange): resolves this planet's
    // tradable goods, hands the menu the live wallet/hold context, and
    // writes the resulting hold back into PlayerState.
    private showTradeCenter = async () => {
        const missions = this.missions;
        if (!missions) {
            return;
        }
        this.controls.unbind();
        try {
            const goods = await this.tradeGoods();
            this.tradeCenter.setGoods(goods);
            this.tradeCenter.setPurchases(this.tradePurchases(missions));
            const cargo = missions.playerState.cargo;
            const newCargo = await this.tradeCenter.show(cargo);
            if (newCargo !== cargo) {
                // Reference inequality means at least one trade happened
                // (the pure ops return new arrays; no-op ops return null).
                missions.playerState.cargo = newCargo;
                queuePlayerStateSave();
            }
        }
        finally {
            this.controls.bind();
        }
    };

    // The wallet context one fleet-dialog session runs against: escort
    // sells/upgrades mutate the live PlayerState.fleet through the pure
    // ops and pay through the write-through wallet.
    private fleetPurchases(missions: SpaceportMissions): FleetPurchases {
        return {
            credits: () => missions.playerState.credits,
            setCredits: credits => {
                missions.playerState.credits = credits;
                queuePlayerStateSave();
            },
            priceMod: this.getPriceMod(),
        };
    }

    // Opens the fleet dialog: the dialog re-resolves each escort's ship
    // data from the live fleet, so sells and upgrades taken inside the
    // dialog show up immediately.
    private showFleet = async () => {
        const missions = this.missions;
        if (!missions) {
            return;
        }
        this.controls.unbind();
        try {
            this.fleetDialog.setPurchases(this.fleetPurchases(missions));
            await this.fleetDialog.updateFleet(missions.playerState.fleet);
            await this.fleetDialog.show(missions.playerState.fleet);
        }
        finally {
            this.controls.bind();
        }
    };

    // The wallet/hold context one trade-center session runs against.
    private tradePurchases(missions: SpaceportMissions): TradePurchases {
        return {
            credits: () => missions.playerState.credits,
            setCredits: credits => {
                missions.playerState.credits = credits;
                queuePlayerStateSave();
            },
            priceMod: this.getPriceMod(),
            freeTons: shipFreeCargoTons(this.input, missions.playerState)
                ?? Number.POSITIVE_INFINITY,
        };
    }

    // The goods this planet's exchange trades: the standards its bands
    // allow (pure tradablesAt) plus the jünk listed in its soldAt/boughtAt.
    private async tradeGoods(): Promise<TradeGood[]> {
        const missions = this.missions;
        if (!this.data || !missions) {
            return [];
        }
        return tradablesAt(this.data, await this.junks(),
            this.testContext(missions), await this.standardNames());
    }

    private junks(): Promise<Map<number, JunkData>> {
        if (!this.junksPromise) {
            this.junksPromise = (async () => {
                const ids = await this.gameData.ids;
                const junks = new Map<number, JunkData>();
                for (const id of ids.Junk) {
                    try {
                        junks.set(rawIdOf(id), await this.gameData.data.Junk.get(id));
                    }
                    catch {
                        // Unknown jünk data: no trade entry for it.
                    }
                }
                return junks;
            })();
        }
        return this.junksPromise;
    }

    private standardNames(): Promise<readonly string[]> {
        if (!this.namesPromise) {
            this.namesPromise = (async () => {
                if (!this.data) {
                    return [];
                }
                try {
                    const set = await this.gameData.data.StringSet.get(
                        globalId(this.data.prefix, CARGO_NAME_STR));
                    return set.strings;
                }
                catch {
                    // Missing string set: trade.ts falls back to its
                    // built-in commodity names.
                    return [];
                }
            })();
        }
        return this.namesPromise;
    }

    // The control-bit context the jünk BuyOn/SellOn tests evaluate against
    // (same construction as missions/availability.ts). Outfit ownership
    // reads the landed ship's outfit state.
    private testContext(missions: SpaceportMissions): TestContext {
        const state = missions.playerState;
        const outfits = this.input.components.get(OutfitsStateComponent)
            ?? new Map<string, { count: number }>();
        const ownedRawIds = new Set([...outfits.keys()].map(id => rawIdOf(id)));
        return {
            bits: new ControlBits(state.bits),
            gender: state.gender === "male" ? 1 : 0,
            hasOutfit: rawId => ownedRawIds.has(rawId),
            exploredSystem: rawId =>
                state.exploredSystems.some(id => rawIdOf(id) === rawId),
        };
    }

    private font = {
        title: {
            fontFamily: "Geneva", fontSize: 18, fill: 0xffffff,
            align: 'center'
        } as const,
        desc: {
            fontFamily: "Geneva", fontSize: 9, fill: 0xffffff,
            align: 'left', wordWrap: true, wordWrapWidth: 301
        } as const,
    };

    constructor(gameData: GameData, private id: string,
        controlEvents: Observable<ControlEvent>, missions?: SpaceportMissions) {
        super(gameData, "nova:8500", controlEvents);
        this.container.name = 'Spaceport';

        // The Leave button exists on every planet; the Shipyard, Outfitter
        // and Mission BBS buttons are added in build() once the planet data
        // is known, matching the Bar/Trade Center/Fleet pattern there.
        const leave = new Button(gameData, "Leave", 120, { x: 160, y: 200 });
        leave.click.subscribe(this.done.bind(this));
        this.addButtons({ leave });

        this.outfitter = new Outfitter(gameData, controlEvents);
        this.shipyard = new Shipyard(gameData, controlEvents);
        this.tradeCenter = new TradeCenter(gameData, controlEvents);
        this.fleetDialog = new FleetDialog(gameData, controlEvents);

        // Mission UI: the BBS list, the bar (button added in build() only on
        // planets with a bar), the landing-offer briefing, and the active
        // missions info screen.
        if (missions) {
            this.missions = missions;
            this.textEnv = new GameMissionTextEnv(missions.env, gameData);

            // Menus hold a ui factory: ship name/type are re-resolved per
            // interaction (the player may have changed ships in the shipyard).
            const makeUi = () => this.missionUi();
            this.briefing = new BriefingDialog(gameData, controlEvents);
            this.missionBBS = new MissionBBS(makeUi, controlEvents, gameData);
            this.bar = new Bar(makeUi, controlEvents, gameData);
            this.missionInfo = new MissionInfo(controlEvents, gameData);

            this.controls = new MenuControls(controlEvents, {
                outfitter: this.showOutfitter,
                shipyard: this.showShipyard,
                tradeCenter: this.showTradeCenter,
                fleet: this.showFleet,
                missionBBS: this.showBBS,
                bar: this.showBar,
                missions: this.showInfo,
                depart: this.done.bind(this),
            });
            return;
        }

        this.controls = new MenuControls(controlEvents, {
            outfitter: this.showOutfitter,
            shipyard: this.showShipyard,
            tradeCenter: this.showTradeCenter,
            fleet: this.showFleet,
            depart: this.done.bind(this),
        });
    }

    override async build() {
        await super.build();
        const data = await this.gameData.data.Planet.get(this.id);
        this.data = data;
        const title = new PIXI.Text(data.name, this.font.title);
        title.position.x = -24;
        title.position.y = 39;
        this.container.addChild(title);

        const desc = new PIXI.Text(data.landingDesc, this.font.desc);
        desc.position.x = -149;
        desc.position.y = 70;
        this.container.addChild(desc);

        // 286 stock planets carry the "default" placeholder landingPict,
        // whose png does not exist. The synchronous Sprite.from of the
        // pre-lazy-load code rendered that as a blank pict; a rejection
        // here would kill the whole buildPromise and strand the spaceport
        // closed (Menu.show awaits it), so tolerate a missing pict.
        let spaceportPict;
        try {
            spaceportPict = await this.gameData.spriteFromPictAsync(data.landingPict);
        }
        catch {
            spaceportPict = undefined;
        }
        if (spaceportPict) {
            spaceportPict.position.x = -306;
            spaceportPict.position.y = -256;
            this.container.addChild(spaceportPict);
        }
        // Stock buttons keep their stock slots; a planet without the
        // matching facility simply has no button there. The buttons are
        // added BEFORE the sub-dialog containers: the binary's sub-screens
        // are modal dialogs stacked above the (now inert) spaceport
        // buttons, and PIXI renders later children on top — adding the
        // dialogs first made buttons draw over open panels.
        if (this.missions) {
            if (data.hasShipyard) {
                // The shipyard button only exists on planets with a shipyard
                // (spöb flag 0x00008).
                const shipyardButton = new Button(this.gameData, "Shipyard", 120,
                    { x: 160, y: 32 });
                shipyardButton.click.subscribe(this.showShipyard);
                this.addButtons({ shipyard: shipyardButton });
            }
            if (data.hasOutfitter) {
                // The outfitter button only exists on planets with an
                // outfitter (spöb flag 0x00004).
                const outfitterButton = new Button(this.gameData, "Outfitter", 120,
                    { x: 160, y: 74 });
                outfitterButton.click.subscribe(this.showOutfitter);
                this.addButtons({ outfitter: outfitterButton });
            }
            if (data.inhabited) {
                // The mission BBS button only exists on inhabited planets
                // (spöb flag 0x00020 clear); offers there are AvailLoc 0.
                const missionBBSButton = new Button(this.gameData, "Mission BBS", 120,
                    { x: 160, y: 158 });
                missionBBSButton.click.subscribe(this.showBBS);
                this.addButtons({ missionBBS: missionBBSButton });
            }
            if (data.hasBar) {
                // The bar button only exists on planets with a bar
                // (spöb flag 0x00040); offers there are AvailLoc 1.
                this.barButton = new Button(this.gameData, "Bar", 120, { x: 160, y: 242 });
                this.barButton.click.subscribe(this.showBar);
                this.addButtons({ bar: this.barButton });
            }
            if (data.hasTradeCenter) {
                // The trade button only exists on planets with a commodity
                // exchange (spöb flag 0x00002) — same pattern as the bar.
                const tradeButton = new Button(this.gameData, "Trade Center", 120,
                    { x: 160, y: 116 });
                tradeButton.click.subscribe(this.showTradeCenter);
                this.addButtons({ tradeCenter: tradeButton });
            }
            if (this.missions.playerState.fleet.escorts.length > 0) {
                // The fleet button only exists when the pilot has escorts.
                // It takes the free slot under the outfitter and otherwise
                // falls back below the bar (the right column is full at
                // 32/74/116/158/200/242; stock buttons keep stock slots).
                const fleetY = data.hasTradeCenter
                    ? (data.hasBar ? 284 : 242)
                    : 116;
                const fleetButton = new Button(this.gameData, "Fleet", 120,
                    { x: 160, y: fleetY });
                fleetButton.click.subscribe(this.showFleet);
                this.addButtons({ fleet: fleetButton });
            }
        }
        // Sub-dialog containers go in AFTER the buttons so they render
        // above them when open.
        this.container.addChild(this.outfitter.container);
        this.container.addChild(this.shipyard.container);
        this.container.addChild(this.tradeCenter.container);
        if (this.missions) {
            this.container.addChild(this.briefing!.container);
            this.container.addChild(this.missionBBS!.container);
            this.container.addChild(this.bar!.container);
            this.container.addChild(this.missionInfo!.container);
        }
    }

    // The planet's price modifier (1 = unchanged): the PriceMod of the
    // player's highest-weight active rank affiliated with the planet's
    // government (player/ranks.ts).
    private getPriceMod(): number {
        if (!this.missions) {
            return 1;
        }
        const env = this.missions.env;
        const rankEnv: RankEnv | null = env.rank
            ? { rank: id => env.rank!(id) }
            : null;
        return priceMod(this.missions.playerState, rankEnv,
            this.data?.govt ?? null);
    }

    // The outfitter/shipyard market context (the FUN_0046a220 /
    // FUN_00469e90 inputs): the planet's tech + special techs, the player's
    // govt-mask pool (FUN_0046cca0: flagship | earned ranks | owned
    // outfits), the control-bit context for AvailBits expressions, and the
    // per-day stock rolls. `outfits` is what the player carries.
    private async marketContext(outfits: purchase.Outfits): Promise<MarketContext> {
        if (!this.missions || !this.data) {
            throw new Error('Spaceport has no mission state');
        }
        const missions = this.missions;
        const mask: [number, number] = [0, 0];
        const shipId = this.input.components.get(ShipComponent)?.id;
        if (shipId) {
            try {
                const ship = await this.gameData.data.Ship.get(shipId);
                mask[0] |= ship.contribute[0];
                mask[1] |= ship.contribute[1];
            }
            catch {
                // Unknown ship type: it contributes nothing.
            }
        }
        const rankEnv: RankEnv | null = missions.env.rank
            ? { rank: id => missions.env.rank!(id) }
            : null;
        const rankMask = activeRankContributes(missions.playerState, rankEnv);
        mask[0] |= rankMask[0];
        mask[1] |= rankMask[1];
        for (const id of outfits.keys()) {
            try {
                const outfit = await this.gameData.data.Outfit.get(id);
                mask[0] |= outfit.contribute[0];
                mask[1] |= outfit.contribute[1];
            }
            catch {
                // Unknown outfit data: it contributes nothing.
            }
        }
        return {
            planetTech: this.data.tech,
            planetSpecialTech: this.data.specialTech,
            maskContributes: mask,
            testCtx: this.testContext(missions),
            rollFor: rawId => dailyMarketRoll(missions.playerState, rawId),
        };
    }

    // The mass actually free on the ship for the outfitter: the ship data's
    // freeMass minus the space of everything it carries (pure freeMassOf —
    // see purchase.ts for why this differs from ShipPhysicsComponent).
    // Infinity when the ship type is unknown, disabling the mass limit.
    private async currentFreeMass(outfits: purchase.Outfits): Promise<number> {
        const shipId = this.input.components.get(ShipComponent)?.id;
        if (!shipId) {
            return Number.POSITIVE_INFINITY;
        }
        try {
            const shipData = await this.gameData.data.Ship.get(shipId);
            const masses = new Map<string, number | null>();
            for (const id of outfits.keys()) {
                try {
                    masses.set(id,
                        (await this.gameData.data.Outfit.get(id)).physics.freeMass);
                }
                catch {
                    masses.set(id, null);
                }
            }
            return purchase.freeMassOf(shipData.physics.freeMass, outfits,
                id => masses.get(id) ?? null);
        }
        catch {
            return Number.POSITIVE_INFINITY;
        }
    }

    // Assembles the offer/briefing environment for one interaction,
    // re-resolving the ship's name/type (the ship may have changed).
    // `ship` is the player's ship entity; landing offers pass it explicitly
    // because this.input is only set once Menu.show runs.
    private async missionUi(ship?: Entity): Promise<MissionUiEnv> {
        if (!this.missions || !this.textEnv) {
            throw new Error('Spaceport has no mission state');
        }
        const shipEntity = ship ?? this.input;
        let shipName = "";
        let shipTypeName = "";
        let shipData: ShipData | null = null;
        const shipId = shipEntity?.components.get(ShipComponent)?.id;
        if (shipId) {
            try {
                shipData = await this.gameData.data.Ship.get(shipId);
                // Ships aren't player-named yet; both tags show the type.
                shipName = shipData.name;
                shipTypeName = shipData.name;
            }
            catch {
                // Unknown ship type: tags expand to "".
            }
        }
        return {
            playerState: this.missions.playerState,
            env: this.missions.env,
            textEnv: this.textEnv,
            gameData: this.gameData,
            landedStellarId: this.id,
            shipName,
            shipTypeName,
            shipData,
            // Feeds the AvailShipType / AI-flag availability rules.
            shipInherentAI: shipData?.inherentAI ?? null,
            // Free hold space: flags2 0x0001 rule and accept-time pickups.
            freeCargoTons: shipEntity
                ? shipFreeCargoTons(shipEntity, this.missions.playerState)
                : null,
        };
    }

    // AvailLoc-3 (main spaceport) offers play as auto-popup briefings when
    // the player lands, before the spaceport menu becomes interactive.
    async showLandingOffers(playerShip: Entity): Promise<void> {
        if (!this.missions) {
            return;
        }
        const ui = await this.missionUi(playerShip);
        const offers = await computeOffers('spaceport', ui);
        if (offers.length === 0) {
            return;
        }
        // Visible so the briefing shows; the spaceport's own controls stay
        // unbound until Menu.show runs. The build must be in place first:
        // a half-built spaceport has no background and buttons whose click
        // handlers read this.input (unset until Menu.show).
        await this.buildPromise;
        this.container.visible = true;
        for (const offer of offers) {
            const labels = await this.briefing!.labelsFor(offer.mission);
            const result = await this.briefing!.show(briefingInput(offer, labels));
            if (result.accepted) {
                logEffects(acceptOffer(ui, offer));
            }
            else {
                logEffects(refuseOffer(ui, offer));
            }
        }
    }

    protected override done() {
        if (this.data) {
            const movement = this.input.components.get(MovementStateComponent);
            if (movement) {
                movement.position = new Position(...this.data.position);
                movement.velocity = new Vector(0, 0);
            }
            const shield = this.input.components.get(ShieldComponent);
            if (shield) {
                shield.current = shield.max;
            }
            const armor = this.input.components.get(ArmorComponent);
            if (armor) {
                armor.current = armor.max;
            }
            const ionization = this.input.components.get(IonizationComponent);
            if (ionization) {
                ionization.current = 0;
            }
        }
        super.done();
    }
}
