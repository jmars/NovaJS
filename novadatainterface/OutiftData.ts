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
    max: number,
    contribute: [number, number], // 64-bit Contribute while owned
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
        max: 0,
        contribute: [0, 0],
        marines: { crew: 0, oddsPercent: 0 }
    }
}
