import { DudeData, DudeShipType } from "novadatainterface/DudeData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { DudeResource } from "../resource_parsers/DudeResource";


export async function DudeParse(dude: DudeResource, notFoundFunction: (m: string) => void): Promise<DudeData> {
    var base: BaseData = await BaseParse(dude, notFoundFunction);

    var govt: string | null = null;
    if (dude.govt > 0) {
        var govtResource = dude.idSpace.gövt[dude.govt];
        if (govtResource) {
            govt = govtResource.globalID;
        }
        else {
            notFoundFunction("No corresponding gövt of id " + dude.govt + " for düde " + base.id);
        }
    }

    var shipTypes: DudeShipType[] = [];
    for (var i = 0; i < dude.shipTypes.length; i += 1) {
        var rawShip = dude.shipTypes[i];
        var probability = dude.probabilities[i];
        if (rawShip <= 0) {
            shipTypes.push({ ship: null, probability: 0 });
            continue;
        }
        var ship = dude.idSpace.shïp[rawShip];
        if (ship) {
            shipTypes.push({ ship: ship.globalID, probability });
        }
        else {
            shipTypes.push({ ship: null, probability });
            notFoundFunction("No corresponding shïp of id " + rawShip + " for düde " + base.id);
        }
    }

    return {
        ...base,
        aiType: dude.aiType,
        govt,
        booty: dude.booty,
        infoTypes: dude.infoTypes,
        flags: dude.flags,
        shipTypes,
    };
}
