import { BaseData, getDefaultBaseData } from "./BaseData";


// An STR# resource: a named list of strings.
export interface StringSetData extends BaseData {
    strings: string[];
}

export function getDefaultStringSetData(): StringSetData {
    return {
        ...getDefaultBaseData(),
        strings: [],
    };
}
