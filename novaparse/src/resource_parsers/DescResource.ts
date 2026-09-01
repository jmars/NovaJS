import { BaseResource } from "./NovaResourceBase";
import { NovaResources } from "./ResourceHolderBase";
import { Resource } from "resource_fork";
import { decodeMacRoman, readPascalString } from "./mac_roman";

// A dësc resource is a null-terminated MacRoman description text followed
// by a short tail: a 2-byte PICT id (the item's portrait / mission brief
// graphic) and zero padding. The tail is NOT a fixed 133 bytes — stock dësc
// carry just the 2-byte graphic id then zeros (verified: ship 128's dësc =
// 374 text bytes, a uint16 graphic 20128, then 34 zero bytes; the test
// fixture desc 129 = "This one has a graphic." then uint16 4214). The text
// must be read up to its null terminator, never to byteLength - a fixed
// tail, and the graphic is the uint16 immediately after the null (when two
// bytes follow it).

class DescResource extends BaseResource {
    graphic: number;
    movieFile: string;
    flags: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = this.data;

        // The text is a null-terminated C string from the start of the
        // resource. After its terminator sit the tail fields: a 2-byte
        // PICT id, an optional Pascal movie-file name and a flags word,
        // then padding. Read the graphic whenever two bytes follow the
        // null; read the movie/flags tail only when the resource is long
        // enough for it.
        var textEnd = 0;
        for (var i = 0; i < d.byteLength; i += 1) {
            if (d.getUint8(i) === 0) {
                textEnd = i;
                break;
            }
        }
        this.graphic = textEnd + 2 <= d.byteLength
            ? d.getUint16(textEnd + 1) : 0;
        if (textEnd + 2 + 129 + 2 <= d.byteLength) {
            var movie = readPascalString(d, textEnd + 1 + 2);
            this.movieFile = movie.str;
            this.flags = d.getInt16(textEnd + 1 + 2 + 129);
        }
        else {
            this.movieFile = "";
            this.flags = 0;
        }
    }

    get text() {
        var bytes: Array<number> = [];
        for (var i = 0; i < this.data.byteLength; i += 1) {
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
