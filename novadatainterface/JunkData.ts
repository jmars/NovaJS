import { BaseData, getDefaultBaseData } from "./BaseData";


export interface JunkData extends BaseData {
    soldAt: string[];               // spöbs that sell this commodity
    boughtAt: string[];             // spöbs that buy this commodity
    basePrice: number;              // credits/ton
    flags: number;                  // 0x0001 tribbles, 0x0002 perishable
    scanMask: number;               // legal status revealed by planetary scans
    lcName: string;                 // long (lowercase) name
    abbrev: string;                 // cargo-hold abbreviation
    buyOn: string;                  // "" (or unparseable) = available everywhere
    sellOn: string;                 // "" (or unparseable) = available everywhere
}

export function getDefaultJunkData(): JunkData {
    return {
        ...getDefaultBaseData(),
        soldAt: [],
        boughtAt: [],
        basePrice: 0,
        flags: 0,
        scanMask: 0,
        lcName: "",
        abbrev: "",
        buyOn: "",
        sellOn: "",
    };
}
