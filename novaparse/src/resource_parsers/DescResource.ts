import { BaseResource } from "./NovaResourceBase";
import { NovaResources } from "./ResourceHolderBase";
import { Resource } from "resource_fork";
import { decodeMacRoman, readPascalString } from "./mac_roman";

// A dësc resource is mostly a null-terminated MacRoman description text.
// It can also carry a tail consisting of a PICT id, a QuickTime movie file
// name (Pascal string) and a flags word; stock data leaves all of these empty.

const DESC_TAIL_SIZE = 2 + 129 + 2;

class DescResource extends BaseResource {
    graphic: number;
    movieFile: string;
    flags: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = this.data;

        // The tail fields sit at fixed offsets from the end of the resource.
        if (d.byteLength >= DESC_TAIL_SIZE) {
            var textEnd = d.byteLength - DESC_TAIL_SIZE;
            this.graphic = d.getUint16(textEnd);
            var movie = readPascalString(d, textEnd + 2);
            this.movieFile = movie.str;
            this.flags = d.getInt16(textEnd + 2 + 129);
        }
        else {
            this.graphic = 0;
            this.movieFile = "";
            this.flags = 0;
        }
    }

    get text() {
        var textEnd = Math.max(0, this.data.byteLength - DESC_TAIL_SIZE);
        var bytes: Array<number> = [];
        for (var i = 0; i < textEnd; i += 1) {
            var num = this.data.getUint8(i);
            if (num === 0) {
                // Got a null, so no more string
                break;
            }
            bytes.push(num);
        }
        return decodeMacRoman(bytes);
    }

}


export { DescResource };
