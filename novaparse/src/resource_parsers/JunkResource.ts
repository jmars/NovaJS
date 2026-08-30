import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readCString } from "./mac_roman";

// Reads a jünk (commodity) resource: 676 bytes in stock data.
// 0x00 soldAt1-8 (spöb ids, <= 0 unset), 0x10 boughtAt1-8,
// 0x20 basePrice, 0x22 flags (0x0001 tribbles, 0x0002 perishable),
// 0x24 scanMask, 0x26 lcName[64], 0x66 abbrev[64],
// 0xa6 buyOn[256], 0x1a6 sellOn[rest of resource].

class JunkResource extends BaseResource {
    soldAt: number[];
    boughtAt: number[];
    basePrice: number;
    flags: number;
    scanMask: number;
    lcName: string;
    abbrev: string;
    buyOn: string;
    sellOn: string;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.soldAt = [];
        this.boughtAt = [];
        for (var i = 0; i < 8; i += 1) {
            this.soldAt.push(d.getInt16(i * 2));
            this.boughtAt.push(d.getInt16(0x10 + i * 2));
        }

        this.basePrice = d.getInt16(0x20);
        this.flags = d.getInt16(0x22);
        this.scanMask = d.getInt16(0x24);

        this.lcName = readCString(d, 0x26, 64);
        this.abbrev = readCString(d, 0x66, 64);
        // These strings gate availability; an empty or garbled one must never
        // throw (stock jünk 128 has easter-egg strings sitting off-by-one),
        // so readCString's clamp-only behavior is exactly what we want:
        // read failure degrades to "" = available on every world.
        this.buyOn = readCString(d, 0xa6, 256);
        // sellOn has no fixed length; clamp to whatever remains. Short or
        // truncated resources just get "".
        this.sellOn = readCString(d, 0x1a6, d.byteLength - 0x1a6);
    }
}

export { JunkResource }
