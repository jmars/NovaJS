import { BaseData, getDefaultBaseData } from "./BaseData";


export interface PersData extends BaseData {
    linkSyst: number;                     // raw system-filter code, same space as decodeSystemFilter
    govt: string | null;                  // resolved gövt global id; null = independent
    aiType: number;                       // 0 use ship inherent AI; 1 wimpy trader .. 4 interceptor
    aggress: number;                      // 0-4, how far away the përs looks for targets
    coward: number;                       // % of shields below which the përs flees
    shipType: string | null;              // resolved shïp global id; null for 0/-1 entries
    weapTypes: Array<string | null>;      // resolved wëap global ids, index-aligned with weapCounts; null = none
    weapCounts: Array<number>;            // negative counts remove stock outfits from the ship
    ammoLoads: Array<number>;             // ammo loaded for the corresponding weapon
    credits: number;                      // money boarding this përs yields
    shieldMod: number;                    // % of the ship's max shields; < 0 = invincible
    hailPict: number;                     // raw PICT id shown in the comm dialog
    commQuote: number;                    // 1-based index into STR# 7100; <= 0 = none
    hailQuote: number;                    // 1-based index into STR# 7101; <= 0 = none
    linkMission: string | null;           // resolved mïsn global id offered from the ship; null = none
    flags: number;
    activeOn: string;                     // test expression, same syntax as mïsn availBits
}

export function getDefaultPersData(): PersData {
    return {
        ...getDefaultBaseData(),
        linkSyst: -1,
        govt: null,
        aiType: 0,
        aggress: 0,
        coward: 0,
        shipType: null,
        weapTypes: [],
        weapCounts: [],
        ammoLoads: [],
        credits: 0,
        shieldMod: 100,
        hailPict: 0,
        commQuote: 0,
        hailQuote: 0,
        linkMission: null,
        flags: 0,
        activeOn: "",
    };
}
