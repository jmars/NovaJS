import { JunkData } from "novadatainterface/JunkData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { JunkResource } from "../resource_parsers/JunkResource";


// Resolves raw spöb ids (<= 0 means unset) to global ids. A reference to a
// nonexistent spöb is warned about and dropped instead of failing the parse,
// so one bad commodity can never brick the whole jünk layer.
function resolveSpobs(junk: JunkResource, rawIDs: number[], field: string, junkID: string): string[] {
    var resolved: Array<string> = [];
    for (var rawID of rawIDs) {
        if (rawID <= 0) {
            continue;
        }

        var spob = junk.idSpace.spöb[rawID];
        if (spob) {
            resolved.push(spob.globalID);
        }
        else {
            console.warn("No corresponding spöb of id " + rawID + " for jünk " + junkID + " " + field);
        }
    }
    return resolved;
}

export async function JunkParse(junk: JunkResource, notFoundFunction: (m: string) => void): Promise<JunkData> {
    var base: BaseData = await BaseParse(junk, notFoundFunction);

    return {
        ...base,
        soldAt: resolveSpobs(junk, junk.soldAt, "soldAt", base.id),
        boughtAt: resolveSpobs(junk, junk.boughtAt, "boughtAt", base.id),
        basePrice: junk.basePrice,
        flags: junk.flags,
        scanMask: junk.scanMask,
        lcName: junk.lcName,
        abbrev: junk.abbrev,
        buyOn: junk.buyOn,
        sellOn: junk.sellOn,
    };
}
