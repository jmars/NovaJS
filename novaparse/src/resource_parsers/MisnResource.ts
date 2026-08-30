import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readCString } from "./mac_roman";

// Reads a mïsn (mission) resource.
// Every stock mïsn is 1970 bytes; all ints are big-endian and expression strings
// are null-terminated C-strings in fixed slots (the 0x7F bytes at slot heads are
// template residue, not pstring lengths).

class MisnResource extends BaseResource {
    availStel: number;
    availLoc: number;
    availRecord: number;
    availRating: number;
    availRandom: number;
    availShipType: number;
    travelStel: number;
    returnStel: number;
    cargoType: number;
    cargoQty: number;
    pickupMode: number;
    dropoffMode: number;
    scanMask: number;
    payVal: number;
    shipCount: number;
    shipSyst: number;
    shipDude: number;
    shipGoal: number;
    shipBehav: number;
    shipNameID: number;
    shipStart: number;
    compGovt: number;
    compReward: number;
    shipSubtitle: number;
    briefText: number;
    quickBrief: number;
    loadCargText: number;
    dropCargText: number;
    compText: number;
    failText: number;
    timeLimit: number;
    canAbortRaw: number;
    shipDoneText: number;
    auxShipCount: number;
    auxShipDude: number;
    auxShipSyst: number;
    flags: number;
    flags2: number;
    refuseText: number;
    availBits: string;
    onAccept: string;
    onRefuse: string;
    onSuccess: string;
    onFailure: string;
    onAbort: string;
    onShipDone: string;
    require: [number, number];
    datePostInc: number;
    acceptButton: string;
    refuseButton: string;
    dispWeight: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.availStel = d.getInt16(0x00);
        this.availLoc = d.getInt16(0x04);
        this.availRecord = d.getInt16(0x06);
        this.availRating = d.getInt16(0x08);
        this.availRandom = d.getInt16(0x0A);
        this.availShipType = d.getInt16(0x5A);
        this.travelStel = d.getInt16(0x0C);
        this.returnStel = d.getInt16(0x0E);
        this.cargoType = d.getInt16(0x10);
        this.cargoQty = d.getInt16(0x12);
        this.pickupMode = d.getInt16(0x14);
        this.dropoffMode = d.getInt16(0x16);
        this.scanMask = d.getInt16(0x18);

        this.payVal = d.getInt32(0x1C);

        this.shipCount = d.getInt16(0x20);
        this.shipSyst = d.getInt16(0x22);
        this.shipDude = d.getInt16(0x24);
        this.shipGoal = d.getInt16(0x26);
        this.shipBehav = d.getInt16(0x28);
        this.shipNameID = d.getInt16(0x2A);
        this.shipStart = d.getInt16(0x2C);
        this.compGovt = d.getInt16(0x2E);
        this.compReward = d.getInt16(0x30);
        this.shipSubtitle = d.getInt16(0x32);

        this.briefText = d.getInt16(0x34);
        this.quickBrief = d.getInt16(0x36);
        this.loadCargText = d.getInt16(0x38);
        this.dropCargText = d.getInt16(0x3A);
        this.compText = d.getInt16(0x3C);
        this.failText = d.getInt16(0x3E);

        this.timeLimit = d.getInt16(0x40);
        this.canAbortRaw = d.getInt16(0x42);
        this.shipDoneText = d.getInt16(0x44);

        this.auxShipCount = d.getInt16(0x48);
        this.auxShipDude = d.getInt16(0x4A);
        this.auxShipSyst = d.getInt16(0x4C);

        // 0x4E is the high word of the 32-bit Flags field ConText shows.
        this.flags = d.getInt16(0x50);
        this.flags2 = d.getInt16(0x52);

        this.refuseText = d.getInt16(0x58);

        this.availBits = readCString(d, 0x5C);
        this.onAccept = readCString(d, 0x15B);
        this.onRefuse = readCString(d, 0x25A);
        this.onSuccess = readCString(d, 0x359);
        this.onFailure = readCString(d, 0x458);
        this.onAbort = readCString(d, 0x557);

        // 64-bit Require mask, stored as two big-endian 32-bit words.
        this.require = [d.getInt32(0x656), d.getInt32(0x65A)];
        this.datePostInc = d.getInt16(0x65E);

        this.onShipDone = readCString(d, 0x660);
        this.acceptButton = readCString(d, 0x75F, 32);
        this.refuseButton = readCString(d, 0x77F, 32);
        this.dispWeight = d.getInt16(0x7A0);
    }

    get canAbort(): boolean {
        return this.canAbortRaw !== 0;
    }
}

export { MisnResource }
