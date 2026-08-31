import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";

class SystResource extends BaseResource {
    position: number[];
    links: Set<number>;
    spobs: number[];
    // Raw sÿst ambient fields (FUN_0041af90's data; values stay raw here —
    // SystemParse resolves them to global ids):
    // +0x44 8 dûde ids, +0x54 their counts (weights; the binary normalizes
    // ×100/total at load), +0x64 ambient roll count, +0x66 government
    // (-1 = none), +0x6e 8 peripheral përs ids, +0x7e their percents.
    dudeIds: number[];
    dudeCounts: number[];
    ambientRollCount: number;
    government: number;
    persIds: number[];
    persPercents: number[];
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.position = [d.getInt16(0), d.getInt16(2)];

        this.links = new Set();
        for (let i = 0; i < 16; i++) {
            var link = d.getInt16(4 + i * 2);
            if (link >= 128) {
                this.links.add(link);
            }
        }

        this.spobs = [];
        for (let i = 0; i < 16; i++) {
            var spob = d.getInt16(36 + i * 2);
            if (spob >= 128) {
                this.spobs.push(spob);
            }
        }

        this.dudeIds = [];
        this.dudeCounts = [];
        for (let i = 0; i < 8; i++) {
            var dude = d.getInt16(0x44 + i * 2);
            // 0x80-based ids, like links/spobs; the runtime dûde table has
            // 512 entries (raw 0x80..0x27f).
            if (dude >= 128 && dude < 0x280) {
                this.dudeIds.push(dude);
                this.dudeCounts.push(d.getInt16(0x54 + i * 2));
            }
        }

        this.ambientRollCount = d.getInt16(0x64);
        this.government = d.getInt16(0x66);

        this.persIds = [];
        this.persPercents = [];
        for (let i = 0; i < 8; i++) {
            var pers = d.getInt16(0x6e + i * 2);
            if (pers >= 128 && pers < 0x47f) {
                this.persIds.push(pers);
                this.persPercents.push(d.getInt16(0x7e + i * 2));
            }
        }
    }
}

export { SystResource }
