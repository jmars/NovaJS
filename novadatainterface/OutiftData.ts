import { BaseData, getDefaultBaseData } from "./BaseData";
import { ShipPhysics } from "./ShipData";


export type OutfitPhysics = Partial<ShipPhysics> & { freeMass: number };

export interface OutfitData extends BaseData {
    weapons: { [index: string]: number }, // globalID : count

    // how it changes the physics of the ship it's attached to. Idea: What if these were allowed to be functions?
    physics: OutfitPhysics,
    pict: string, // id of picture
    price: number,
    desc: string,
    displayWeight: number,
    // Raw oütf tech level (s16 @ raw 4): the outfitter tech gate is
    // rawTech <= spob tech OR one of the spob's special techs (FUN_0046a220).
    rawTech: number,
    // Raw oütf +1008 (s16, clamped 0..100 at load): PERCENT CHANCE PER DAY
    // the outfit is in stock (100 = always; 0 = never sold).
    stockPercent: number,
    // Raw oütf flags (u16 @ raw 12). Bits the outfitter filter keys off:
    // 0x8 not-sellable, 0x100 govt-mask check, 0x400 bulk-buy qty dialog,
    // 0x1000 hide same-displayWeight duplicates, 0x4000 AvailBits check.
    flags: number,
    // AvailBits Stochastic expression (raw 46+): evaluated only when the
    // 0x4000 flag is set. Empty = pass.
    availBits: string,
    // Govt masks checked when the 0x100 flag is set: (playerMasks & require)
    // == require for both words (FUN_0046cd80, raw 38/42).
    require: [number, number],
    max: number,
    // 64-bit Contribute while owned (raw 30/34). These are also the masks
    // owned outfits add to the player's pool (FUN_0046cca0).
    contribute: [number, number],
    // oütf ModType 25 "marines": ModVal >= 1 adds that many crew to the
    // ship it's on; -1..-100 adds |ModVal| percent to capture odds.
    marines: { crew: number, oddsPercent: number }
}

export function getDefaultOutfitData(): OutfitData {
    return {
        ...getDefaultBaseData(),
        weapons: {},
        physics: {
            freeMass: 0
        },
        pict: "default",
        price: 0,
        desc: "default outfit",
        displayWeight: 0,
        rawTech: 0,
        stockPercent: 0,
        flags: 0,
        availBits: "",
        require: [0, 0],
        max: 0,
        contribute: [0, 0],
        marines: { crew: 0, oddsPercent: 0 }
    }
}
