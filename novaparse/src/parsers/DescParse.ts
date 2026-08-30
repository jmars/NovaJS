import { DescData } from "novadatainterface/DescData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { DescResource } from "../resource_parsers/DescResource";


export async function DescParse(desc: DescResource, notFoundFunction: (m: string) => void): Promise<DescData> {
    var base: BaseData = await BaseParse(desc, notFoundFunction);

    return {
        ...base,
        text: desc.text,
        graphic: desc.graphic,
        movieFile: desc.movieFile,
        flags: desc.flags,
    };
}
