import { StringSetData } from "novadatainterface/StringSetData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { StrResource } from "../resource_parsers/StrResource";


export async function StringSetParse(str: StrResource, notFoundFunction: (m: string) => void): Promise<StringSetData> {
    var base: BaseData = await BaseParse(str, notFoundFunction);

    return {
        ...base,
        strings: str.strings,
    };
}
