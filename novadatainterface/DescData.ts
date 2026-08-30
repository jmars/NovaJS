import { BaseData, getDefaultBaseData } from "./BaseData";


export interface DescData extends BaseData {
    text: string;                         // may contain {bXXX "a" "b"} / {G…} / {P…} blocks
    graphic: number;                      // PICT id shown with mission dialogs; <128 unused
    movieFile: string;                    // QuickTime movie name (ignored by novajs)
    flags: number;
}

export function getDefaultDescData(): DescData {
    return {
        ...getDefaultBaseData(),
        text: "",
        graphic: 0,
        movieFile: "",
        flags: 0,
    };
}
