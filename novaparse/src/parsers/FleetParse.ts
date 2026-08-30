import { FleetData, FleetEscort } from "novadatainterface/FleetData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { FleetResource } from "../resource_parsers/FleetResource";


export async function FleetParse(fleet: FleetResource, notFoundFunction: (m: string) => void): Promise<FleetData> {
    var base: BaseData = await BaseParse(fleet, notFoundFunction);

    var leadShipType: string | null = null;
    if (fleet.leadShipType > 0) {
        var leadShip = fleet.idSpace.shïp[fleet.leadShipType];
        if (leadShip) {
            leadShipType = leadShip.globalID;
        }
        else {
            notFoundFunction("No corresponding shïp of id " + fleet.leadShipType + " for flët " + base.id);
        }
    }

    var escorts: FleetEscort[] = [];
    for (var i = 0; i < 4; i += 1) {
        var rawShip = fleet.escortShipTypes[i];
        var escort: FleetEscort = {
            ship: null,
            min: fleet.escortMins[i],
            max: fleet.escortMaxs[i],
        };
        if (rawShip > 0) {
            var ship = fleet.idSpace.shïp[rawShip];
            if (ship) {
                escort.ship = ship.globalID;
            }
            else {
                notFoundFunction("No corresponding shïp of id " + rawShip + " for flët " + base.id);
            }
        }
        escorts.push(escort);
    }

    var govt: string | null = null;
    if (fleet.govt > 0) {
        var govtResource = fleet.idSpace.gövt[fleet.govt];
        if (govtResource) {
            govt = govtResource.globalID;
        }
        else {
            notFoundFunction("No corresponding gövt of id " + fleet.govt + " for flët " + base.id);
        }
    }

    return {
        ...base,
        leadShipType,
        escorts,
        govt,
        linkSyst: fleet.linkSyst,
        activateOn: fleet.activateOn,
        quote: fleet.quote,
        flags: fleet.flags,
    };
}
