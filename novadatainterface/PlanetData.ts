import { SpaceObjectData, getDefaultSpaceObjectData } from "./SpaceObjectData";
import { DamageType } from "./WeaponData";

export interface PlanetData extends SpaceObjectData {
    landingPict: string;
    landingDesc: string;
    position: [number, number];
    govt: string | null;   // resolved gövt global id; null = independent
    radius: number;        // spöb sprite half-size (FUN_00462410); the trader
                           // arrival test is radius/4; engine default 150
    inhabited: boolean;    // spöb flag 0x00000020 cleared
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
        hasBar: false,
        tech: 0,
        hasTradeCenter: false,
        hasOutfitter: false,
        hasShipyard: false,
        priceBands: [0, 0, 0, 0, 0, 0]
    };
}
