import { PersData } from "novadatainterface/PersData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { PersResource } from "../resource_parsers/PersResource";


export async function PersParse(pers: PersResource, notFoundFunction: (m: string) => void): Promise<PersData> {
    var base: BaseData = await BaseParse(pers, notFoundFunction);

    var govt: string | null = null;
    if (pers.govt > 0) {
        var govtResource = pers.idSpace.gövt[pers.govt];
        if (govtResource) {
            govt = govtResource.globalID;
        }
        else {
            notFoundFunction("No corresponding gövt of id " + pers.govt + " for përs " + base.id);
        }
    }

    var shipType: string | null = null;
    if (pers.shipType > 0) {
        var ship = pers.idSpace.shïp[pers.shipType];
        if (ship) {
            shipType = ship.globalID;
        }
        else {
            notFoundFunction("No corresponding shïp of id " + pers.shipType + " for përs " + base.id);
        }
    }

    // Weapons stay wëap global ids here; turning them into the outfits that
    // grant them (as ShipParse does) is left to the consumer.
    var weapTypes: Array<string | null> = [];
    for (var i = 0; i < pers.weapTypes.length; i += 1) {
        var rawWeap = pers.weapTypes[i];
        if (rawWeap <= 0) {
            weapTypes.push(null);
            continue;
        }
        var weapon = pers.idSpace.wëap[rawWeap];
        if (weapon) {
            weapTypes.push(weapon.globalID);
        }
        else {
            weapTypes.push(null);
            notFoundFunction("No corresponding wëap of id " + rawWeap + " for përs " + base.id);
        }
    }

    var linkMission: string | null = null;
    if (pers.linkMission > 0) {
        var mission = pers.idSpace.mïsn[pers.linkMission];
        if (mission) {
            linkMission = mission.globalID;
        }
        else {
            notFoundFunction("No corresponding mïsn of id " + pers.linkMission + " for përs " + base.id);
        }
    }

    return {
        ...base,
        linkSyst: pers.linkSyst,
        govt,
        aiType: pers.aiType,
        aggress: pers.aggress,
        coward: pers.coward,
        shipType,
        weapTypes,
        weapCounts: pers.weapCounts,
        ammoLoads: pers.ammoLoads,
        credits: pers.credits,
        shieldMod: pers.shieldMod,
        hailPict: pers.hailPict,
        commQuote: pers.commQuote,
        hailQuote: pers.hailQuote,
        linkMission,
        flags: pers.flags,
        activeOn: pers.activeOn,
    };
}
