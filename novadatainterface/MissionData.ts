import { BaseData, getDefaultBaseData } from "./BaseData";


export interface MissionData extends BaseData {
    availStel: number;        // raw code; decode at runtime
    availLoc: number;         // 0 BBS, 1 bar, 2 ship, 3 spaceport, 4 trade, 5 shipyard, 6 outfit
    availRecord: number;      // 0 ignore; +n at-least; -n at-most; -32000 dominated here; -32001 dominated any
    availRating: number;      // -1/0 ignore; n minimum combat rating
    availRandom: number;      // 100 always; 1-99 percent
    availShipType: number;    // 0/-1 ignore; 128-255 must fly; 1128-1255 must not; 2128+ govt variants
    travelStel: number;       // raw code
    returnStel: number;       // raw code (-4 = origin stellar)
    cargoType: number;        // -1 none; 0-255 specific; 1000 random of types 0-5
    cargoQty: number;         // -1 ignore; >=0 tons; <=-2 abs() tons ±50%
    pickupMode: number;       // -1 ignore; 0 at start; 1 at TravelStel; 2 boarding special ship
    dropoffMode: number;      // -1 ignore; 0 at TravelStel; 1 at mission end
    scanMask: number;
    payVal: number;           // i32: credits; negative values have special meanings
    shipCount: number;        // -1 none; 0-31
    shipSyst: number;         // raw system filter code
    shipDude: string | null;  // resolved düde global id
    shipGoal: number;         // -1 none; 0 destroy .. 6 chase off
    shipBehav: number;        // -1 standard AI; 0 attack player; 1 protect player; 2 attack stellars
    shipNameID: number;       // STR# id or -1
    shipStart: number;        // -4..-1 nav points; 0 random; 1 hyperspace-in; 2 cloaked
    compGovt: string | null;  // resolved gövt global id
    compReward: number;
    shipSubtitle: number;
    briefText: string | null;      // resolved dësc global ids (null = -1)
    quickBrief: string | null;
    loadCargText: string | null;
    dropCargText: string | null;
    compText: string | null;
    failText: string | null;
    shipDoneText: string | null;
    refuseText: string | null;
    timeLimit: number;        // days; -1/0 none
    canAbort: boolean;
    auxShipCount: number;     // -1 none; 1-31
    auxShipDude: string | null;
    auxShipSyst: number;      // raw system filter
    flags: number;            // 0x0001 auto-abort .. 0x8000 fail if boarded by pirates
    flags2: number;           // 0x0001 cargo-space bar .. 0x0004 fail if disabled/destroyed
    availBits: string;        // raw test-expression text ("" = always true)
    onAccept: string;         // raw set-expression text
    onRefuse: string;
    onSuccess: string;
    onFailure: string;
    onAbort: string;
    onShipDone: string;
    require: [number, number]; // 64-bit Require mask (two i32)
    datePostInc: number;      // days added to game date on success/auto-abort
    acceptButton: string;     // "" = STR# 150 defaults
    refuseButton: string;
    dispWeight: number;       // higher = presented first in BBS/bar
}

export function getDefaultMissionData(): MissionData {
    return {
        ...getDefaultBaseData(),
        availStel: -1,
        availLoc: 0,
        availRecord: 0,
        availRating: -1,
        availRandom: 100,
        availShipType: 0,
        travelStel: -1,
        returnStel: -1,
        cargoType: -1,
        cargoQty: -1,
        pickupMode: -1,
        dropoffMode: -1,
        scanMask: 0,
        payVal: 0,
        shipCount: -1,
        shipSyst: -1,
        shipDude: null,
        shipGoal: -1,
        shipBehav: -1,
        shipNameID: -1,
        shipStart: 0,
        compGovt: null,
        compReward: 0,
        shipSubtitle: -1,
        briefText: null,
        quickBrief: null,
        loadCargText: null,
        dropCargText: null,
        compText: null,
        failText: null,
        shipDoneText: null,
        refuseText: null,
        timeLimit: -1,
        canAbort: false,
        auxShipCount: -1,
        auxShipDude: null,
        auxShipSyst: -1,
        flags: 0,
        flags2: 0,
        availBits: "",
        onAccept: "",
        onRefuse: "",
        onSuccess: "",
        onFailure: "",
        onAbort: "",
        onShipDone: "",
        require: [0, 0],
        datePostInc: 0,
        acceptButton: "",
        refuseButton: "",
        dispWeight: 0,
    };
}
