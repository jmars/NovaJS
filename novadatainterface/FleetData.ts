import { BaseData, getDefaultBaseData } from "./BaseData";


export interface FleetEscort {
    ship: string | null;
    min: number;
    max: number;
}

export interface FleetData extends BaseData {
    leadShipType: string | null;
    escorts: FleetEscort[];               // 4 entries
    govt: string | null;
    linkSyst: number;                     // raw system filter (-1 any / 128+ / 10000+ govt codes)
    activateOn: string;                   // test expression; "" = always
    quote: number;                        // STR# id shown on hyperspace entry ('#' -> random digit)
    flags: number;                        // 0x0001 freighters carry random cargo
}

export function getDefaultFleetData(): FleetData {
    return {
        ...getDefaultBaseData(),
        leadShipType: null,
        escorts: [],
        govt: null,
        linkSyst: -1,
        activateOn: "",
        quote: -1,
        flags: 0,
    };
}
