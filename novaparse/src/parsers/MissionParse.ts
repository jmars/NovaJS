import { MissionData } from "novadatainterface/MissionData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { MisnResource } from "../resource_parsers/MisnResource";

// Resolves raw resource references in a mïsn to global ids.
// A raw id of 0 or -1 means "none" and resolves to null.


function resolveDesc(misn: MisnResource, rawID: number, base: BaseData, notFoundFunction: (m: string) => void): string | null {
    if (rawID <= 0) {
        return null;
    }
    var desc = misn.idSpace.dësc[rawID];
    if (desc) {
        return desc.globalID;
    }
    notFoundFunction("No corresponding dësc of id " + rawID + " for mïsn " + base.id);
    return null;
}

export async function MissionParse(misn: MisnResource, notFoundFunction: (m: string) => void): Promise<MissionData> {
    var base: BaseData = await BaseParse(misn, notFoundFunction);

    var shipDude: string | null = null;
    if (misn.shipDude > 0) {
        var dude = misn.idSpace.düde[misn.shipDude];
        if (dude) {
            shipDude = dude.globalID;
        }
        else {
            notFoundFunction("No corresponding düde of id " + misn.shipDude + " for mïsn " + base.id);
        }
    }

    var auxShipDude: string | null = null;
    if (misn.auxShipDude > 0) {
        var auxDude = misn.idSpace.düde[misn.auxShipDude];
        if (auxDude) {
            auxShipDude = auxDude.globalID;
        }
        else {
            notFoundFunction("No corresponding düde of id " + misn.auxShipDude + " for mïsn " + base.id);
        }
    }

    var compGovt: string | null = null;
    if (misn.compGovt > 0) {
        var govt = misn.idSpace.gövt[misn.compGovt];
        if (govt) {
            compGovt = govt.globalID;
        }
        else {
            notFoundFunction("No corresponding gövt of id " + misn.compGovt + " for mïsn " + base.id);
        }
    }

    return {
        ...base,
        availStel: misn.availStel,
        availLoc: misn.availLoc,
        availRecord: misn.availRecord,
        availRating: misn.availRating,
        availRandom: misn.availRandom,
        availShipType: misn.availShipType,
        travelStel: misn.travelStel,
        returnStel: misn.returnStel,
        cargoType: misn.cargoType,
        cargoQty: misn.cargoQty,
        pickupMode: misn.pickupMode,
        dropoffMode: misn.dropoffMode,
        scanMask: misn.scanMask,
        payVal: misn.payVal,
        shipCount: misn.shipCount,
        shipSyst: misn.shipSyst,
        shipDude,
        shipGoal: misn.shipGoal,
        shipBehav: misn.shipBehav,
        shipNameID: misn.shipNameID,
        shipStart: misn.shipStart,
        compGovt,
        compReward: misn.compReward,
        shipSubtitle: misn.shipSubtitle,
        briefText: resolveDesc(misn, misn.briefText, base, notFoundFunction),
        quickBrief: resolveDesc(misn, misn.quickBrief, base, notFoundFunction),
        loadCargText: resolveDesc(misn, misn.loadCargText, base, notFoundFunction),
        dropCargText: resolveDesc(misn, misn.dropCargText, base, notFoundFunction),
        compText: resolveDesc(misn, misn.compText, base, notFoundFunction),
        failText: resolveDesc(misn, misn.failText, base, notFoundFunction),
        shipDoneText: resolveDesc(misn, misn.shipDoneText, base, notFoundFunction),
        refuseText: resolveDesc(misn, misn.refuseText, base, notFoundFunction),
        timeLimit: misn.timeLimit,
        canAbort: misn.canAbort,
        auxShipCount: misn.auxShipCount,
        auxShipDude,
        auxShipSyst: misn.auxShipSyst,
        flags: misn.flags,
        flags2: misn.flags2,
        availBits: misn.availBits,
        onAccept: misn.onAccept,
        onRefuse: misn.onRefuse,
        onSuccess: misn.onSuccess,
        onFailure: misn.onFailure,
        onAbort: misn.onAbort,
        onShipDone: misn.onShipDone,
        require: misn.require,
        datePostInc: misn.datePostInc,
        acceptButton: misn.acceptButton,
        refuseButton: misn.refuseButton,
        dispWeight: misn.dispWeight,
    };
}
