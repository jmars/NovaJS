import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readPascalString } from "./mac_roman";

// Reads an STR# (string list) resource:
// a 16-bit count followed by that many Pascal strings.

class StrResource extends BaseResource {
    strings: Array<string>;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        var count = d.getUint16(0);
        this.strings = [];
        var offset = 2;
        for (var i = 0; i < count && offset < d.byteLength; i += 1) {
            var pstring = readPascalString(d, offset);
            this.strings.push(pstring.str);
            offset += pstring.bytesRead;
        }
    }
}

export { StrResource }
