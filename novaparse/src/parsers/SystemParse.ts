import { SystResource } from "../resource_parsers/SystResource";
import { SystemData } from "novadatainterface/SystemData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";


// TODO: Refactor redundant code
export async function SystemParse(syst: SystResource, notFoundFunction: (m: string) => void): Promise<SystemData> {
    var base: BaseData = await BaseParse(syst, notFoundFunction);

    var links: Array<string> = [];
    for (let i in [...syst.links]) {
        let linkLocal = [...syst.links][i];

        let systLinkedTo = syst.idSpace.sÿst[linkLocal];
        if (systLinkedTo) {
            links.push(systLinkedTo.globalID);
        }
        else {
            notFoundFunction("No corresponding system " + linkLocal + " for link from " + base.id);
        }
    }

    var planets: Array<string> = [];

    for (let i in syst.spobs) {
        let planetLocal = syst.spobs[i];

        let planetGlobal = syst.idSpace.spöb[planetLocal];
        if (planetGlobal) {
            planets.push(planetGlobal.globalID);
        }
        else {
            notFoundFunction("Missing spöb id " + planetLocal + " for sÿst " + base.id);
        }
    }


    var dudePairs: Array<{ dude: string, count: number }> = [];
    for (let i = 0; i < syst.dudeIds.length; i += 1) {
        let dudeLocal = syst.dudeIds[i];

        let dude = syst.idSpace.düde[dudeLocal];
        if (dude) {
            dudePairs.push({ dude: dude.globalID, count: syst.dudeCounts[i] });
        }
        else {
            notFoundFunction("Missing düde id " + dudeLocal + " for sÿst " + base.id);
        }
    }

    var government: string | null = null;
    if (syst.government > 0) {
        var govtResource = syst.idSpace.gövt[syst.government];
        if (govtResource) {
            government = govtResource.globalID;
        }
        else {
            notFoundFunction("No corresponding gövt of id " + syst.government + " for sÿst " + base.id);
        }
    }

    var persPeripherals: Array<{ pers: string, percent: number }> = [];
    for (let i = 0; i < syst.persIds.length; i += 1) {
        let persLocal = syst.persIds[i];

        let pers = syst.idSpace.përs[persLocal];
        if (pers) {
            persPeripherals.push({ pers: pers.globalID, percent: syst.persPercents[i] });
        }
        else {
            notFoundFunction("Missing përs id " + persLocal + " for sÿst " + base.id);
        }
    }


    return {
        ...base,
        links,
        position: [syst.position[0], syst.position[1]],
        planets,
        dudePairs,
        ambientRollCount: syst.ambientRollCount,
        government,
        persPeripherals,
    }

}
