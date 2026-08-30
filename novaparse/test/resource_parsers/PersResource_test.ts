import "jasmine";
import { Resource } from "resource_fork";
import { PersResource } from "../../src/resource_parsers/PersResource";
import { defaultIDSpace } from "./DefaultIDSpace";

// Builds a synthetic 400-byte përs resource, mirroring the stock layout:
// i16 fields at 0x00-0x32, Credits i32 at 0x24, and a NUL-terminated
// mac_roman cstring at 0x34.
function makePersResource(id: number, name: string, write: (d: DataView) => void): PersResource {
    var data = new DataView(new ArrayBuffer(400));
    write(data);
    return new PersResource(new Resource("përs", id, name, data), defaultIDSpace);
}

describe("PersResource", function() {
    const idSpace = defaultIDSpace;

    it("should parse the scalar fields", function() {
        var pers = makePersResource(128, "Terrapin", function(d) {
            d.setInt16(0x00, 20007); // linkSyst
            d.setInt16(0x02, 157);   // govt
            d.setInt16(0x04, 2);     // aiType
            d.setInt16(0x06, 2);     // aggress
            d.setInt16(0x08, 25);    // coward
            d.setInt16(0x0A, 136);   // shipType
        });

        expect(pers.id).toEqual(128);
        expect(pers.name).toEqual("Terrapin");
        expect(pers.linkSyst).toEqual(20007);
        expect(pers.govt).toEqual(157);
        expect(pers.aiType).toEqual(2);
        expect(pers.aggress).toEqual(2);
        expect(pers.coward).toEqual(25);
        expect(pers.shipType).toEqual(136);
    });

    it("should parse the 4-entry weapon arrays", function() {
        var pers = makePersResource(129, "Armed", function(d) {
            d.setInt16(0x0C, 150);   // weapTypes[0]
            d.setInt16(0x14, 2);     // weapCounts[0]
            d.setInt16(0x1C, 30);    // ammoLoads[0]
            d.setInt16(0x0E, -1);    // weapTypes[1]
            d.setInt16(0x16, -1);    // weapCounts[1]
            d.setInt16(0x1E, -1);    // ammoLoads[1]
            d.setInt16(0x10, 151);   // weapTypes[2]
            d.setInt16(0x18, -5);    // weapCounts[2]
            d.setInt16(0x20, -1);    // ammoLoads[2]
            d.setInt16(0x12, -1);    // weapTypes[3]
            d.setInt16(0x1A, -1);    // weapCounts[3]
            d.setInt16(0x22, -1);    // ammoLoads[3]
        });

        expect(pers.weapTypes).toEqual([150, -1, 151, -1]);
        expect(pers.weapCounts).toEqual([2, -1, -5, -1]);
        expect(pers.ammoLoads).toEqual([30, -1, -1, -1]);
    });

    it("should parse credits and hail/quote fields", function() {
        var pers = makePersResource(131, "Jack Folstam", function(d) {
            d.setInt32(0x24, 250000); // credits
            d.setInt16(0x28, 250);    // shieldMod
            d.setInt16(0x2A, 4096);   // hailPict
            d.setInt16(0x2C, 44);     // commQuote
            d.setInt16(0x2E, 42);     // hailQuote
            d.setInt16(0x30, 140);    // linkMission
            d.setInt16(0x32, 0x080B); // flags
        });

        expect(pers.credits).toEqual(250000);
        expect(pers.shieldMod).toEqual(250);
        expect(pers.hailPict).toEqual(4096);
        expect(pers.commQuote).toEqual(44);
        expect(pers.hailQuote).toEqual(42);
        expect(pers.linkMission).toEqual(140);
        expect(pers.flags).toEqual(0x080B);
    });

    it("should parse activeOn as a NUL-terminated mac_roman cstring", function() {
        var pers = makePersResource(132, "Conditional", function(d) {
            // "!b222" followed by the terminator
            var bytes = [0x21, 0x62, 0x32, 0x32, 0x32, 0x00];
            for (var i = 0; i < bytes.length; i += 1) {
                d.setUint8(0x34 + i, bytes[i]);
            }
        });
        expect(pers.activeOn).toEqual("!b222");

        // High mac_roman bytes decode through the mac_roman table.
        var latin = makePersResource(133, "Accented", function(d) {
            var bytes = [0x41, 0x80, 0x00]; // "A" + mac_roman 0x80 ("Ä")
            for (var i = 0; i < bytes.length; i += 1) {
                d.setUint8(0x34 + i, bytes[i]);
            }
        });
        expect(latin.activeOn).toEqual("AÄ");
    });

    it("should default activeOn to the empty string", function() {
        var pers = makePersResource(134, "Plain", function(d) {
            d.setUint8(0x34, 0x00);
        });
        expect(pers.activeOn).toEqual("");
    });
});
