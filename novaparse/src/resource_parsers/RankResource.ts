import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readCString } from "./mac_roman";

// Reads a ränk (military rank) resource: 152 bytes.

class RankResource extends BaseResource {
    weight: number;
    govt: number;
    priceMod: number;
    salary: number;
    salaryCap: number;
    contributes: [number, number];
    flags: number;
    convName: string;
    shortName: string;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.weight = d.getInt16(0x00);
        this.govt = d.getInt16(0x02);
        this.priceMod = d.getInt16(0x04);
        this.salary = d.getInt32(0x06);
        this.salaryCap = d.getInt32(0x0A);

        // 64-bit Contribute mask, stored as two big-endian 32-bit words.
        this.contributes = [d.getInt32(0x0E), d.getInt32(0x12)];
        this.flags = d.getInt16(0x16);

        this.convName = readCString(d, 0x18, 64);
        this.shortName = readCString(d, 0x58, 64);
    }
}

export { RankResource }
