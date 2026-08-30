import { CharData } from "novadatainterface/CharData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { CharResource } from "../resource_parsers/CharResource";

// Resolves a chär resource. All four-element raw id fields use 0/-1 for "none".


function resolveShip(char: CharResource, rawID: number, base: BaseData, notFoundFunction: (m: string) => void): string | null {
    if (rawID <= 0) {
        return null;
    }
    var ship = char.idSpace.shïp[rawID];
    if (ship) {
        return ship.globalID;
    }
    notFoundFunction("No corresponding shïp of id " + rawID + " for chär " + base.id);
    return null;
}

function resolveSyst(char: CharResource, rawID: number, base: BaseData, notFoundFunction: (m: string) => void): string | null {
    if (rawID <= 0) {
        return null;
    }
    var syst = char.idSpace.sÿst[rawID];
    if (syst) {
        return syst.globalID;
    }
    notFoundFunction("No corresponding sÿst of id " + rawID + " for chär " + base.id);
    return null;
}

function resolveGovt(char: CharResource, rawID: number, base: BaseData, notFoundFunction: (m: string) => void): string | null {
    if (rawID <= 0) {
        return null;
    }
    var govt = char.idSpace.gövt[rawID];
    if (govt) {
        return govt.globalID;
    }
    notFoundFunction("No corresponding gövt of id " + rawID + " for chär " + base.id);
    return null;
}

export async function CharParse(char: CharResource, notFoundFunction: (m: string) => void): Promise<CharData> {
    var base: BaseData = await BaseParse(char, notFoundFunction);

    var introTextId: string | null = null;
    if (char.introTextID > 0) {
        var desc = char.idSpace.dësc[char.introTextID];
        if (desc) {
            introTextId = desc.globalID;
        }
        else {
            notFoundFunction("No corresponding dësc of id " + char.introTextID + " for chär " + base.id);
        }
    }

    return {
        ...base,
        startCash: char.startCash,
        startShipType: resolveShip(char, char.startShipType, base, notFoundFunction),
        startSystems: char.startSystems.map((raw) => resolveSyst(char, raw, base, notFoundFunction)),
        startGovts: char.startGovts.map((raw) => resolveGovt(char, raw, base, notFoundFunction)),
        startStatus: char.startStatus,
        startKills: char.startKills,
        introTextId,
        introPicts: char.introPicts,
        introPictDelays: char.introPictDelays,
        onStart: char.onStart,
        flags: char.flags,
        startDate: {
            day: char.startDay,
            month: char.startMonth,
            year: char.startYear,
        },
        datePrefix: char.datePrefix,
        dateSuffix: char.dateSuffix,
    };
}
