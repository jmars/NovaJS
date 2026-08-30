import { BaseData, getDefaultBaseData } from "./BaseData";


export interface RankData extends BaseData {
    weight: number;                       // higher wins for <PRK>/<SRK>
    govt: string | null;
    priceMod: number;                     // 100 = unchanged
    salary: number;                       // credits/day
    salaryCap: number;                    // 0/-1 unused
    contributes: [number, number];        // 64-bit Contribute while active
    flags: number;                        // 0x0001 .. 0x0800
    convName: string;                     // conversational name (<PRK>); "" -> "captain"
    shortName: string;                    // <SRK>
}

export function getDefaultRankData(): RankData {
    return {
        ...getDefaultBaseData(),
        weight: 0,
        govt: null,
        priceMod: 100,
        salary: 0,
        salaryCap: 0,
        contributes: [0, 0],
        flags: 0,
        convName: "",
        shortName: "",
    };
}
