import { BaseData, getDefaultBaseData } from "./BaseData";


export interface DudeShipType {
    ship: string | null;                  // resolved shïp global id; null for 0/-1 entries
    probability: number;
}

export interface DudeData extends BaseData {
    aiType: number;                       // 0 use ship inherent AI; 1 wimpy trader .. 4 interceptor
    govt: string | null;                  // resolved gövt global id; null = independent
    booty: number;                        // 0x0001 food .. 0x0040 money; 0 = repelled when boarded
    infoTypes: number;                    // hail info flags
    flags: number;                        // 0x0100 cannot be hit by player
    shipTypes: DudeShipType[];            // up to 16
}

export function getDefaultDudeData(): DudeData {
    return {
        ...getDefaultBaseData(),
        aiType: 0,
        govt: null,
        booty: 0,
        infoTypes: 0,
        flags: 0,
        shipTypes: [],
    };
}
