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
    // Raw shïp displayOrder (s16 @ raw 60): the shipyard sorts DESCENDING by
    // this (ties ascending id), not by id (FUN_00469e90).
    displayOrder: number;
    // Raw shïp tech level (s16 @ raw 46): the shipyard tech gate is
    // rawTech <= spob tech OR one of the spob's special techs.
    rawTech: number;
    // Raw shïp +904 (u16, clamped 0..100): PERCENT CHANCE PER DAY the ship
    // appears in a planet's shipyard market (100 = always; 0 = never sold).
    // (Raw +906 is the hire-mode equivalent, not parsed.)
    stockPercent: number;
    // AvailBits Stochastic expression (raw 108+): evaluated when the
    // flags3 0x100 bit is set. Empty = pass.
    availBits: string;
    // Govt masks checked when flags3 0x200 is set: (playerMasks & require)
    // == require for both words (raw 896/900).
    require: [number, number];
    // The ship's own govt-attribute mask (raw 100/104): added to the
    // player's mask pool while this is the flagship (FUN_0046cca0).
    contribute: [number, number];
    inherentAI: number;                   // raw shïp AI field: 0 none, 1 wimpy trader .. 4 interceptor
    strength: number;                     // raw shïp Strength (offset 70): the AI odds-filter weight
    inherentGovt: string | null;          // inherent COMBAT govt (global gövt id), decoded from the
                                          // band-encoded shïp govt field (see ShipParse); null when
                                          // the ship has no combat govt and so is nobody's inherent enemy
    crew: number;                         // raw shïp crew: the boarding/capture defense
    onCapture: string;                    // shïp OnCapture set-expr, run when the ship is captured
    upgradeTo: string | null;             // global shïp id this ship upgrades to at a planet, null = none
    escortUpgradeCost: number;            // EscUpgrdCost: what paying for the upgrade costs
    escortSellValue: number;              // EscSellValue: escort sale price; 0 = default 10% of price
    escortType: number;                   // 0 fighter, 1 light warship, 2 warship, 3 freighter
    flags3: number;                       // raw shïp +0x726 (1830) u16, a THIRD flags word (runtime
                                          // ship-type +0x9ec — not flags2N@98). Bit 0x2 = short trader
                                          // park wait: rand(75)+100 instead of rand(200)+300 frames
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
        displayOrder: 0,
        rawTech: 0,
        stockPercent: 0,
        availBits: "",
        require: [0, 0],
        contribute: [0, 0],
        inherentAI: 0,
        strength: 100,
        inherentGovt: null,
        crew: 0,
        onCapture: "",
        upgradeTo: null,
        escortUpgradeCost: 0,
        escortSellValue: 0,
        escortType: 0,
        flags3: 0
    }
}
