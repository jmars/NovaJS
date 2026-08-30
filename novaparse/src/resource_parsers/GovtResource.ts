import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { readCString } from "./mac_roman";

// Reads a gövt (government) resource: 192 bytes.
// The name strings are null-terminated C-strings in fixed slots, like in mïsn.

class GovtResource extends BaseResource {
    voiceType: number;
    flags: number;
    flags2: number;
    scanFine: number;
    crimeTol: number;
    smugPenalty: number;
    disabPenalty: number;
    boardPenalty: number;
    killPenalty: number;
    shootPenalty: number;
    initialRec: number;
    maxOdds: number;
    classes: Array<number>;
    allies: Array<number>;
    enemies: Array<number>;
    skillMult: number;
    scanMask: number;
    commName: string;
    targetCode: string;
    inhJam: Array<number>;
    mediumName: string;
    color: number;
    shipColor: number;
    intf: number;
    newsPic: number;
    require: [number, number];

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.voiceType = d.getInt16(0x00);
        this.flags = d.getInt16(0x02);
        this.flags2 = d.getInt16(0x04);
        this.scanFine = d.getInt16(0x06);
        this.crimeTol = d.getInt16(0x08);
        this.smugPenalty = d.getInt16(0x0A);
        this.disabPenalty = d.getInt16(0x0C);
        this.boardPenalty = d.getInt16(0x0E);
        this.killPenalty = d.getInt16(0x10);
        this.shootPenalty = d.getInt16(0x12);
        this.initialRec = d.getInt16(0x14);
        this.maxOdds = d.getInt16(0x16);

        this.classes = [
            d.getInt16(0x18), d.getInt16(0x1A), d.getInt16(0x1C), d.getInt16(0x1E)
        ];
        this.allies = [
            d.getInt16(0x20), d.getInt16(0x22), d.getInt16(0x24), d.getInt16(0x26)
        ];
        this.enemies = [
            d.getInt16(0x28), d.getInt16(0x2A), d.getInt16(0x2C), d.getInt16(0x2E)
        ];

        this.skillMult = d.getInt16(0x30);
        this.scanMask = d.getInt16(0x32);

        this.commName = readCString(d, 0x34, 16);
        this.targetCode = readCString(d, 0x44, 24);

        this.inhJam = [
            d.getInt16(0x5C), d.getInt16(0x5E), d.getInt16(0x60), d.getInt16(0x62)
        ];

        this.mediumName = readCString(d, 0x64, 64);

        this.color = d.getUint32(0xA4);
        this.shipColor = d.getUint32(0xA8);
        this.intf = d.getInt16(0xAC);
        this.newsPic = d.getInt16(0xAE);

        // 64-bit landing-permission mask, stored as two big-endian 32-bit words.
        this.require = [d.getInt32(0xB0), d.getInt32(0xB4)];
    }
}

export { GovtResource }
