import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readCString } from "./mac_roman";

// Reads a crön (cron) resource.
// Every stock crön is 822 bytes; all ints are big-endian and the expression
// strings are null-terminated C-strings in 255-byte slots. Layout verified
// against the stock data (all 125 cröns in Nova Data 3.rez): crön 221 has
// enableOn "b6666" @0x18 and onEnd "!b6666" @0x216, and crön 222's Duration
// of 365 sits @0x0E (before PreHoldoff @0x10), matching the Bible's field
// order.

class CronResource extends BaseResource {
    firstDay: number;
    firstMonth: number;
    firstYear: number;
    lastDay: number;
    lastMonth: number;
    lastYear: number;
    random: number;
    duration: number;
    preHoldoff: number;
    postHoldoff: number;
    indNewsStr: number;
    flags: number;
    enableOn: string;
    onStart: string;
    onEnd: string;
    contribute: [number, number];
    require: [number, number];
    newsGovt: [number, number, number, number];
    govtNewsStr: [number, number, number, number];

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.firstDay = d.getInt16(0x00);
        this.firstMonth = d.getInt16(0x02);
        this.firstYear = d.getInt16(0x04);
        this.lastDay = d.getInt16(0x06);
        this.lastMonth = d.getInt16(0x08);
        this.lastYear = d.getInt16(0x0A);

        this.random = d.getInt16(0x0C);
        this.duration = d.getInt16(0x0E);
        this.preHoldoff = d.getInt16(0x10);
        this.postHoldoff = d.getInt16(0x12);
        this.indNewsStr = d.getInt16(0x14);
        this.flags = d.getInt16(0x16);

        this.enableOn = readCString(d, 0x18, 255);
        this.onStart = readCString(d, 0x117, 255);
        this.onEnd = readCString(d, 0x216, 255);

        // 64-bit masks, stored as two big-endian 32-bit words each.
        this.contribute = [d.getInt32(0x316), d.getInt32(0x31A)];
        this.require = [d.getInt32(0x31E), d.getInt32(0x322)];

        this.newsGovt = [
            d.getInt16(0x326), d.getInt16(0x328), d.getInt16(0x32A), d.getInt16(0x32C),
        ];
        this.govtNewsStr = [
            d.getInt16(0x32E), d.getInt16(0x330), d.getInt16(0x332), d.getInt16(0x334),
        ];
    }
}

export { CronResource }
