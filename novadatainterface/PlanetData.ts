import { SpaceObjectData, getDefaultSpaceObjectData } from "./SpaceObjectData";
import { DamageType } from "./WeaponData";

export interface PlanetData extends SpaceObjectData {
    landingPict: string;
    landingDesc: string;
    position: [number, number];
    govt: string | null;   // resolved gövt global id; null = independent
    radius: number;        // FULL width of the sprite base frame (rlëD
                           // size[0] — FUN_00462410→FUN_00462390 returns the
                           // frame-rect width); the trader arrival test is
                           // radius/4; engine default 150
    inhabited: boolean;    // spöb flag 0x00000020 cleared
    // Raw spöb flags2 (u16 @ raw 0x20 → runtime +0x34). Category bits drive
    // the FUN_0040c790 destination picker: 0x2000 / 0x1000 pickers, plus
    // 0x20 (a display flag, unused there). 0x3000 destinations also turn the
    // state-1 arrival into a landing (the ship despawns into the spöb).
    flags2: number;
    hasBar: boolean;       // spöb flag 0x00000040
    tech: number;          // tech level, controls outfit/ship availability
    hasTradeCenter: boolean; // spöb flag 0x00000002 (commodity exchange)
    hasOutfitter: boolean; // spöb flag 0x00000004
    hasShipyard: boolean;  // spöb flag 0x00000008
    // Price band per standard commodity (STR# 4000 order: 0 Food,
    // 1 Industrial, 2 Medical Supplies, 3 Luxury Goods, 4 Metal,
    // 5 Equipment). Decoded from the spöb price-band flag nibbles:
    // 0 won't trade here, 1 low price, 2 medium, 3 high.
    priceBands: number[];
}

export function getDefaultPlanetData(): PlanetData {
    return {
        ...getDefaultSpaceObjectData(),
        vulnerableTo: <Array<DamageType>>["planetBuster"],
        landingPict: "default",
        landingDesc: "default",
        position: [0, 0],
        govt: null,
        radius: 150,
        inhabited: true,
        flags2: 0,
        hasBar: false,
        tech: 0,
        hasTradeCenter: false,
        hasOutfitter: false,
        hasShipyard: false,
        priceBands: [0, 0, 0, 0, 0, 0]
    };
}
