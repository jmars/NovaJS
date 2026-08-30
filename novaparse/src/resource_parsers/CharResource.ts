import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readCString } from "./mac_roman";

// Reads a chär (pilot character template) resource: 362 bytes.

class CharResource extends BaseResource {
    startCash: number;
    startShipType: number;
    startSystems: Array<number>;
    startGovts: Array<number>;
    startStatus: Array<number>;
    startKills: number;
    introPicts: Array<number>;
    introPictDelays: Array<number>;
    introTextID: number;
    onStart: string;
    flags: number;
    startDay: number;
    startMonth: number;
    startYear: number;
    datePrefix: string;
    dateSuffix: string;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.startCash = d.getInt32(0x00);
        this.startShipType = d.getInt16(0x04);
        this.startSystems = [
            d.getInt16(0x06), d.getInt16(0x08), d.getInt16(0x0A), d.getInt16(0x0C)
        ];
        this.startGovts = [
            d.getInt16(0x0E), d.getInt16(0x10), d.getInt16(0x12), d.getInt16(0x14)
        ];
        this.startStatus = [
            d.getInt16(0x16), d.getInt16(0x18), d.getInt16(0x1A), d.getInt16(0x1C)
        ];
        this.startKills = d.getInt16(0x1E);
        this.introPicts = [
            d.getInt16(0x20), d.getInt16(0x22), d.getInt16(0x24), d.getInt16(0x26)
        ];
        this.introPictDelays = [
            d.getInt16(0x28), d.getInt16(0x2A), d.getInt16(0x2C), d.getInt16(0x2E)
        ];
        this.introTextID = d.getInt16(0x30);
        this.onStart = readCString(d, 0x32, 256);
        this.flags = d.getInt16(0x132);
        this.startDay = d.getInt16(0x134);
        this.startMonth = d.getInt16(0x136);
        this.startYear = d.getInt16(0x138);
        this.datePrefix = readCString(d, 0x13A, 16);
        this.dateSuffix = readCString(d, 0x14A, 32);
    }
}

export { CharResource }
