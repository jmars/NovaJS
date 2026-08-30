import { RankData } from "novadatainterface/RankData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { RankResource } from "../resource_parsers/RankResource";


export async function RankParse(rank: RankResource, notFoundFunction: (m: string) => void): Promise<RankData> {
    var base: BaseData = await BaseParse(rank, notFoundFunction);

    var govt: string | null = null;
    if (rank.govt > 0) {
        var govtResource = rank.idSpace.gövt[rank.govt];
        if (govtResource) {
            govt = govtResource.globalID;
        }
        else {
            notFoundFunction("No corresponding gövt of id " + rank.govt + " for ränk " + base.id);
        }
    }

    return {
        ...base,
        weight: rank.weight,
        govt,
        priceMod: rank.priceMod,
        salary: rank.salary,
        salaryCap: rank.salaryCap,
        contributes: rank.contributes,
        flags: rank.flags,
        convName: rank.convName,
        shortName: rank.shortName,
    };
}
