import { BaseData, getDefaultBaseData } from "./BaseData";


export interface SystemData extends BaseData {
    position: [number, number],
    links: Array<string>,
    planets: Array<string>,
    // The sÿst ambient ship table (FUN_0041af90): 8 (dûde, count) pairs —
    // the system's own population, drawn by the dominant dûde branch of
    // each ambient roll. count is the raw weight (the binary normalizes
    // ×100/total at load; the port draws with raw weights, same
    // probabilities).
    dudePairs: Array<{ dude: string, count: number }>,
    // sÿst+0x64: how many three-way ambient rolls (përs/flët/dûde) one
    // population event (jump-in, landing, liftoff, boarding) makes. Stock
    // 0-10, median 3.
    ambientRollCount: number,
    // sÿst+0x66: the system's government (global gövt id), null for an
    // independent system.
    government: string | null,
    // The sÿst "Peripherals" përs: each entry warps in at a population
    // event when its activation test passes and rand(100)+1 <= percent.
    persPeripherals: Array<{ pers: string, percent: number }>,
}

export function getDefaultSystemData(): SystemData {
    return {
        ...getDefaultBaseData(),
        position: [0, 0],
        links: [],
        planets: [],
        dudePairs: [],
        ambientRollCount: 0,
        government: null,
        persPeripherals: [],
    };
}
