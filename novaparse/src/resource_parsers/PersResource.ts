import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readCString } from "./mac_roman";

// Reads a përs (AI-person) resource: 400 bytes in stock data.
// Note: the weapon type/count/ammo arrays hold 4 entries, not the 8 the Nova
// Bible documents; 8 entries would run into the Credits field at 0x24 (the
// pairing of counts with types checks out against all 516 stock përs).
// GrantClass/GrantProb/GrantCount/Color/Flags2 are not parsed: they are zero
// in all stock data and their offsets are not independently pinned down.

class PersResource extends BaseResource {
    linkSyst: number;
    govt: number;
    aiType: number;
    aggress: number;
    coward: number;
    shipType: number;
    weapTypes: Array<number>;
    weapCounts: Array<number>;
    ammoLoads: Array<number>;
    credits: number;
    shieldMod: number;
    hailPict: number;
    commQuote: number;
    hailQuote: number;
    linkMission: number;
    flags: number;
    activeOn: string;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.linkSyst = d.getInt16(0x00);
        this.govt = d.getInt16(0x02);
        this.aiType = d.getInt16(0x04);
        this.aggress = d.getInt16(0x06);
        this.coward = d.getInt16(0x08);
        this.shipType = d.getInt16(0x0A);

        this.weapTypes = [];
        this.weapCounts = [];
        this.ammoLoads = [];
        for (var i = 0; i < 4; i += 1) {
            this.weapTypes.push(d.getInt16(0x0C + i * 2));
            this.weapCounts.push(d.getInt16(0x14 + i * 2));
            this.ammoLoads.push(d.getInt16(0x1C + i * 2));
        }

        this.credits = d.getInt32(0x24);
        this.shieldMod = d.getInt16(0x28);
        this.hailPict = d.getInt16(0x2A);
        this.commQuote = d.getInt16(0x2C);
        this.hailQuote = d.getInt16(0x2E);
        this.linkMission = d.getInt16(0x30);
        this.flags = d.getInt16(0x32);
        this.activeOn = readCString(d, 0x34);
    }
}

export { PersResource }
