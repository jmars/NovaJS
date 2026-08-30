import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readCString } from "./mac_roman";

// Reads a flët (fleet) resource: 306 bytes.
// Layout: lead ship + 4 escort types with min/max counts, govt, system filter,
// then a null-terminated ActivateOn expression in a fixed 272 byte slot,
// followed by the Quote STR# id and misc flags.

class FleetResource extends BaseResource {
    leadShipType: number;
    escortShipTypes: Array<number>;
    escortMins: Array<number>;
    escortMaxs: Array<number>;
    govt: number;
    linkSyst: number;
    activateOn: string;
    quote: number;
    flags: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.leadShipType = d.getInt16(0x00);
        this.escortShipTypes = [
            d.getInt16(0x02), d.getInt16(0x04), d.getInt16(0x06), d.getInt16(0x08)
        ];
        this.escortMins = [
            d.getInt16(0x0A), d.getInt16(0x0C), d.getInt16(0x0E), d.getInt16(0x10)
        ];
        this.escortMaxs = [
            d.getInt16(0x12), d.getInt16(0x14), d.getInt16(0x16), d.getInt16(0x18)
        ];
        this.govt = d.getInt16(0x1A);
        this.linkSyst = d.getInt16(0x1C);
        this.activateOn = readCString(d, 0x1E, 272);
        this.quote = d.getInt16(0x12E);
        this.flags = d.getInt16(0x130);
    }
}

export { FleetResource }
