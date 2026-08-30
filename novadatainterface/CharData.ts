import { BaseData, getDefaultBaseData } from "./BaseData";


export interface CharData extends BaseData {
    startCash: number;
    startShipType: string | null;
    startSystems: Array<string | null>;   // 4; player randomly placed in one
    startGovts: Array<string | null>;     // 4, paired with startStatus
    startStatus: number[];                // 4
    startKills: number;                   // starting combat rating
    introTextId: string | null;           // dësc global id
    introPicts: number[];                 // 4 PICT ids (-1 unused)
    introPictDelays: number[];            // 4 seconds
    onStart: string;                      // set-expression evaluated at pilot creation
    flags: number;                        // 0x0001 default chär
    startDate: { day: number; month: number; year: number };
    datePrefix: string;
    dateSuffix: string;
}

export function getDefaultCharData(): CharData {
    return {
        ...getDefaultBaseData(),
        startCash: 0,
        startShipType: null,
        startSystems: [null, null, null, null],
        startGovts: [null, null, null, null],
        startStatus: [-1, -1, -1, -1],
        startKills: 0,
        introTextId: null,
        introPicts: [-1, -1, -1, -1],
        introPictDelays: [-1, -1, -1, -1],
        onStart: "",
        flags: 0,
        startDate: { day: 1, month: 1, year: 1177 },
        datePrefix: "",
        dateSuffix: "",
    };
}
