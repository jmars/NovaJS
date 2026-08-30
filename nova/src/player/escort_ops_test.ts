// Headless specs for the pure escort-fleet ops. Run with:
//   npx esbuild --bundle --platform=node nova/src/player/escort_ops_test.ts \
//       --outfile=/tmp/eo.js && node_modules/.bin/jasmine /tmp/eo.js
//
// Money rules under test (verified against the EV Nova Bible, see
// escort_ops.ts module comment): escorts sell at EscSellValue or the 10%
// default when that field is 0, upgrading charges EscUpgrdCost * priceMod
// (buy-only) and swaps the fleet entry's shipType, and nothing ever drives
// credits below zero.

import { getDefaultShipData, ShipData } from "novadatainterface/ShipData";
import {
    canUpgradeEscort, escortSellValue, escortUpgradePrice,
    normalizeEscortOrder, sellEscort, upgradeEscort,
} from "./escort_ops";
import { EscortState, FleetState } from "./player_state";


function makeShip(fields: Partial<ShipData> = {}): ShipData {
    return {
        ...getDefaultShipData(),
        id: "nova:shuttle",
        name: "Shuttle",
        price: 10000,
        ...fields,
    };
}

function makeFleet(escorts: Array<Partial<EscortState>> = [{ id: "1" }, { id: "2" }]): FleetState {
    return {
        escorts: escorts.map(escort => ({
            shipType: "nova:shuttle",
            ...escort,
        } as EscortState)),
        nextId: escorts.length + 1,
    };
}

const SHUTTLE = makeShip();

describe("escortSellValue", () => {
    it("uses the raw EscSellValue when it is set", () => {
        expect(escortSellValue(makeShip({ escortSellValue: 4321 }))).toBe(4321);
        // Only a positive field counts as "set".
        expect(escortSellValue(makeShip({ escortSellValue: 1 }))).toBe(1);
    });

    it("falls back to 10% of the ship cost when the field is 0", () => {
        // Stock data has EscSellValue 0 everywhere (Bible 2720 default).
        expect(escortSellValue(makeShip({ price: 10000 }))).toBe(1000);
        expect(escortSellValue(makeShip({ price: 555 }))).toBe(56); // rounds
        expect(escortSellValue(makeShip({ price: 0 }))).toBe(0);
    });
});

describe("sellEscort", () => {
    it("credits the sell value and removes the escort from the fleet", () => {
        const fleet = makeFleet();
        const wallet = { credits: 100, fleet };
        const result = sellEscort(wallet, 0, SHUTTLE);
        expect(result).not.toBeNull();
        expect(result!.value).toBe(1000); // 10% of the shuttle's 10000
        expect(result!.credits).toBe(1100);
        expect(wallet.credits).toBe(1100);
        expect(wallet.fleet.escorts.map(escort => escort.id)).toEqual(["2"]);
        expect(result!.fleet).toBe(fleet);
    });

    it("sells at the raw EscSellValue when set", () => {
        const wallet = { credits: 0, fleet: makeFleet() };
        const result = sellEscort(wallet, 1, makeShip({ escortSellValue: 777 }));
        expect(result!.value).toBe(777);
        expect(wallet.credits).toBe(777);
        expect(wallet.fleet.escorts.map(escort => escort.id)).toEqual(["1"]);
    });

    it("returns null for an out-of-range index and changes nothing", () => {
        const wallet = { credits: 100, fleet: makeFleet() };
        expect(sellEscort(wallet, 2, SHUTTLE)).toBeNull();
        expect(sellEscort(wallet, -1, SHUTTLE)).toBeNull();
        expect(wallet.credits).toBe(100);
        expect(wallet.fleet.escorts.length).toBe(2);
    });
});

describe("canUpgradeEscort", () => {
    const upgradable = makeShip({
        upgradeTo: "nova:heavy-shuttle",
        escortUpgradeCost: 5000,
    });

    it("passes with a chain and enough credits", () => {
        const wallet = { credits: 5000, fleet: makeFleet() };
        expect(canUpgradeEscort(wallet, wallet.fleet.escorts[0], upgradable, 1))
            .toBeTrue();
    });

    it("fails without an upgrade chain", () => {
        const wallet = { credits: 100000, fleet: makeFleet() };
        expect(canUpgradeEscort(wallet, wallet.fleet.escorts[0],
            makeShip({ upgradeTo: null }), 1)).toBeFalse();
    });

    it("fails when unaffordable, including the price modifier", () => {
        const wallet = { credits: 5000, fleet: makeFleet() };
        // 5000 * 1.1 = 5500 > 5000 credits.
        expect(canUpgradeEscort(wallet, wallet.fleet.escorts[0], upgradable, 1.1))
            .toBeFalse();
        // 5000 * 0.9 = 4500 <= 5000 credits.
        expect(canUpgradeEscort(wallet, wallet.fleet.escorts[0], upgradable, 0.9))
            .toBeTrue();
    });
});

describe("escortUpgradePrice", () => {
    it("multiplies EscUpgrdCost by the price modifier and rounds", () => {
        const ship = makeShip({ escortUpgradeCost: 5000 });
        expect(escortUpgradePrice(ship, 1)).toBe(5000);
        expect(escortUpgradePrice(ship, 0.9)).toBe(4500);
        expect(escortUpgradePrice(makeShip({ escortUpgradeCost: 3333 }), 0.5))
            .toBe(1667);
    });
});

describe("upgradeEscort", () => {
    const upgradable = makeShip({
        upgradeTo: "nova:heavy-shuttle",
        escortUpgradeCost: 5000,
    });

    it("charges the cost and swaps the fleet entry's shipType", () => {
        const fleet = makeFleet([{ id: "1", orders: "hold" }, { id: "2" }]);
        const wallet = { credits: 6000, fleet };
        const result = upgradeEscort(wallet, 0, upgradable, 1);
        expect(result).not.toBeNull();
        expect(result!.credits).toBe(1000);
        expect(result!.newShipType).toBe("nova:heavy-shuttle");
        expect(wallet.credits).toBe(1000);
        // Same fleet object, same entry id and orders, new shipType.
        expect(result!.fleet).toBe(fleet);
        expect(fleet.escorts[0]).toEqual({
            id: "1", shipType: "nova:heavy-shuttle", orders: "hold",
        });
        expect(fleet.escorts[1].shipType).toBe("nova:shuttle");
    });

    it("applies the price modifier on the buy", () => {
        const wallet = { credits: 100000, fleet: makeFleet() };
        const result = upgradeEscort(wallet, 0, upgradable, 1.1);
        expect(result!.credits).toBe(100000 - 5500);
    });

    it("returns null without a chain and changes nothing", () => {
        const fleet = makeFleet();
        const wallet = { credits: 100000, fleet };
        expect(upgradeEscort(wallet, 0, makeShip({ upgradeTo: null }), 1))
            .toBeNull();
        expect(wallet.credits).toBe(100000);
        expect(fleet.escorts[0].shipType).toBe("nova:shuttle");
    });

    it("returns null when unaffordable and never goes negative", () => {
        const wallet = { credits: 4999, fleet: makeFleet() };
        expect(upgradeEscort(wallet, 0, upgradable, 1)).toBeNull();
        expect(wallet.credits).toBe(4999);
        // Boundary: exactly enough credits.
        const exact = { credits: 5000, fleet: makeFleet() };
        expect(upgradeEscort(exact, 0, upgradable, 1)).not.toBeNull();
        expect(exact.credits).toBe(0);
    });

    it("returns null for an out-of-range index", () => {
        const wallet = { credits: 100000, fleet: makeFleet() };
        expect(upgradeEscort(wallet, 9, upgradable, 1)).toBeNull();
    });
});

describe("normalizeEscortOrder", () => {
    it("keeps hold and defaults everything else to follow", () => {
        expect(normalizeEscortOrder('hold')).toBe('hold');
        expect(normalizeEscortOrder('follow')).toBe('follow');
        expect(normalizeEscortOrder(undefined)).toBe('follow');
        expect(normalizeEscortOrder('garbage')).toBe('follow');
    });
});
