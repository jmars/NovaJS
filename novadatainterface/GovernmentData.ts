import { BaseData, getDefaultBaseData } from "./BaseData";


export interface GovernmentData extends BaseData {
    flags: number;
    flags2: number;
    crimeTol: number;
    scanFine: number;                     // >=0 flat; <0 percent of cash
    penalties: {
        smuggling: number;
        disable: number;
        board: number;
        kill: number;
    };
    initialRec: number;
    maxOdds: number;                      // 100 = 1:1
    classes: number[];                    // 4 entries, -1 unused
    allies: number[];                     // class numbers, -1 unused
    enemies: number[];                    // class numbers, -1 unused
    skillMult: number;                    // 100 = normal
    scanMask: number;                     // overlaps mïsn ScanMask => cargo illegal
    inhJam: number[];                     // 4 entries, 0-100
    mediumName: string;
    commName: string;
    targetCode: string;
    color: number;                        // 0x00RRGGBB
    shipColor: number;
    intf: number;                         // ïntf id
    newsPic: number;                      // PICT id
    require: [number, number];            // landing-permission mask
}

export function getDefaultGovernmentData(): GovernmentData {
    return {
        ...getDefaultBaseData(),
        flags: 0,
        flags2: 0,
        crimeTol: 0,
        scanFine: 0,
        penalties: {
            smuggling: 0,
            disable: 0,
            board: 0,
            kill: 0,
        },
        initialRec: 0,
        maxOdds: 100,
        classes: [-1, -1, -1, -1],
        allies: [-1, -1, -1, -1],
        enemies: [-1, -1, -1, -1],
        skillMult: 100,
        scanMask: 0,
        inhJam: [0, 0, 0, 0],
        mediumName: "",
        commName: "",
        targetCode: "",
        color: 0,
        shipColor: 0,
        intf: 0,
        newsPic: 0,
        require: [0, 0],
    };
}
