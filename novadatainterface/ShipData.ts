import { getDefaultSpaceObjectData, getDefaultSpaceObjectPhysics, SpaceObjectData, SpaceObjectPhysics } from "./SpaceObjectData";


export interface ShipPhysics extends SpaceObjectPhysics {
    freeMass: number;
    freeCargo: number;
}

export function getDefaultShipPhysics(): ShipPhysics {
    return {
        ...getDefaultSpaceObjectPhysics(),
        freeMass: 0,
        freeCargo: 0
    }
}

export interface ShipData extends SpaceObjectData {
    physics: ShipPhysics;
    pict: string;
    desc: string;
    price: number;
    outfits: { [index: string]: number }
    initialExplosion: string | null;
    finalExplosion: string | null;
    largeExplosion: boolean;
    deathDelay: number;
    displayWeight: number;
    inherentAI: number;                   // raw shïp AI field: 0 none, 1 wimpy trader .. 4 interceptor
    crew: number;                         // raw shïp crew: the boarding/capture defense
    onCapture: string;                    // shïp OnCapture set-expr, run when the ship is captured
    upgradeTo: string | null;             // global shïp id this ship upgrades to at a planet, null = none
    escortUpgradeCost: number;            // EscUpgrdCost: what paying for the upgrade costs
    escortSellValue: number;              // EscSellValue: escort sale price; 0 = default 10% of price
    escortType: number;                   // 0 fighter, 1 light warship, 2 warship, 3 freighter
};

export function getDefaultShipData(): ShipData {
    return {
        ...getDefaultSpaceObjectData(),
        physics: getDefaultShipPhysics(),
        pict: "default",
        desc: "default",
        price: 0,
        outfits: {},
        initialExplosion: null,
        finalExplosion: null,
        largeExplosion: false,
        deathDelay: 1,
        displayWeight: 1,
        inherentAI: 0,
        crew: 0,
        onCapture: "",
        upgradeTo: null,
        escortUpgradeCost: 0,
        escortSellValue: 0,
        escortType: 0
    }
}
