import { GovernmentData } from "novadatainterface/GovernmentData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { GovtResource } from "../resource_parsers/GovtResource";


export async function GovtParse(govt: GovtResource, notFoundFunction: (m: string) => void): Promise<GovernmentData> {
    var base: BaseData = await BaseParse(govt, notFoundFunction);

    return {
        ...base,
        flags: govt.flags,
        flags2: govt.flags2,
        crimeTol: govt.crimeTol,
        scanFine: govt.scanFine,
        penalties: {
            smuggling: govt.smugPenalty,
            disable: govt.disabPenalty,
            board: govt.boardPenalty,
            kill: govt.killPenalty,
        },
        initialRec: govt.initialRec,
        maxOdds: govt.maxOdds,
        classes: govt.classes,
        allies: govt.allies,
        enemies: govt.enemies,
        skillMult: govt.skillMult,
        scanMask: govt.scanMask,
        inhJam: govt.inhJam,
        mediumName: govt.mediumName,
        commName: govt.commName,
        targetCode: govt.targetCode,
        color: govt.color,
        shipColor: govt.shipColor,
        intf: govt.intf,
        newsPic: govt.newsPic,
        require: govt.require,
    };
}
