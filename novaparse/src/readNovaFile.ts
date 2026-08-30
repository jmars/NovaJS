import { readResourceFork } from "resource_fork";
import { NovaResources, NovaResourceType } from "./resource_parsers/ResourceHolderBase";
import { BoomResource } from "./resource_parsers/BoomResource";
import { CharResource } from "./resource_parsers/CharResource";
import { CronResource } from "./resource_parsers/CronResource";
import { DescResource } from "./resource_parsers/DescResource";
import { DudeResource } from "./resource_parsers/DudeResource";
import { FleetResource } from "./resource_parsers/FleetResource";
import { GovtResource } from "./resource_parsers/GovtResource";
import { JunkResource } from "./resource_parsers/JunkResource";
import { MisnResource } from "./resource_parsers/MisnResource";
import { BaseResource } from "./resource_parsers/NovaResourceBase";
import { OutfResource } from "./resource_parsers/OutfResource";
import { PersResource } from "./resource_parsers/PersResource";
import { PictResource } from "./resource_parsers/PictResource";
import { RankResource } from "./resource_parsers/RankResource";
import { RledResource } from "./resource_parsers/RledResource";
import { ShanResource } from "./resource_parsers/ShanResource";
import { ShipResource } from "./resource_parsers/ShipResource";
import { SpinResource } from "./resource_parsers/SpinResource";
import { SpobResource } from "./resource_parsers/SpobResource";
import { StrResource } from "./resource_parsers/StrResource";
import { SystResource } from "./resource_parsers/SystResource";
import { WeapResource } from "./resource_parsers/WeapResource";
import { SndResource } from "./resource_parsers/SndResource";
import { $enum } from "ts-enum-util";


// Reads a single plugin or nova file
// Puts results in localIDSpace.
async function readNovaFile(filePath: string, localIDSpace: NovaResources) {
    const rf = await read(filePath);

    for (const resourceType of $enum(NovaResourceType).values()) {
        const parser = getParser(<NovaResourceType>resourceType);

        for (const id in rf[resourceType]) {
            localIDSpace[resourceType][id] = new parser(rf[resourceType][id], localIDSpace);
        }
    }
}

function read(path: string) {
    // Whether or not to use resource fork
    var useRF = path.slice(-5) !== ".ndat" && path.slice(-5) !== ".npif"
        && path.slice(-4) !== ".rez";
    return readResourceFork(path, useRF);
}


// Since we're storing subclasses, not instances of subclasses.
// TODO: Fill this out as more are implemented
var parserMap: { [index: string]: typeof BaseResource } = {};
parserMap[NovaResourceType.bööm] = BoomResource;
parserMap[NovaResourceType.chär] = CharResource;
//parserMap[NovaResourceType.cicn] = ;
//parserMap[NovaResourceType.cölr] = ;
parserMap[NovaResourceType.crön] = CronResource;
parserMap[NovaResourceType.dësc] = DescResource;
//parserMap[NovaResourceType.DITL] = ;
//parserMap[NovaResourceType.DLOG] = ;
parserMap[NovaResourceType.düde] = DudeResource;
parserMap[NovaResourceType.flët] = FleetResource;
parserMap[NovaResourceType.gövt] = GovtResource;
//parserMap[NovaResourceType.ïntf] = ;
parserMap[NovaResourceType.jünk] = JunkResource;
parserMap[NovaResourceType.mïsn] = MisnResource;
//parserMap[NovaResourceType.nëbu] = ;
//parserMap[NovaResourceType.öops] = ;
parserMap[NovaResourceType.oütf] = OutfResource;
parserMap[NovaResourceType.përs] = PersResource;
parserMap[NovaResourceType.PICT] = PictResource;
parserMap[NovaResourceType.ränk] = RankResource;
//parserMap[NovaResourceType.rlë8] = ;
parserMap[NovaResourceType.rlëD] = RledResource;
//parserMap[NovaResourceType.röid] = ;
parserMap[NovaResourceType.shän] = ShanResource;
parserMap[NovaResourceType.shïp] = ShipResource;
parserMap[NovaResourceType.snd] = SndResource;
parserMap[NovaResourceType.spïn] = SpinResource;
parserMap[NovaResourceType.spöb] = SpobResource;
//parserMap[NovaResourceType.STR] = ;
parserMap[NovaResourceType.STRH] = StrResource;
parserMap[NovaResourceType.sÿst] = SystResource;
//parserMap[NovaResourceType.vers] = ;
parserMap[NovaResourceType.wëap] = WeapResource;


function getParser(resourceType: NovaResourceType): typeof BaseResource {
    if (parserMap[resourceType]) {
        return parserMap[resourceType];
    }
    else {
        return BaseResource;
        //throw new Error("Unknown data type " + resourceType);
    }
}

export { readNovaFile };
