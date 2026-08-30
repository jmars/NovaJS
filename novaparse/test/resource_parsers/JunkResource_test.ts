import "jasmine";
import { Resource } from "resource_fork";
import { JunkResource } from "../../src/resource_parsers/JunkResource";
import { defaultIDSpace } from "./DefaultIDSpace";

// Builds a synthetic 676-byte jünk resource, mirroring the stock layout:
// soldAt1-8 i16x8 at 0x00, boughtAt1-8 i16x8 at 0x10, basePrice/flags/
// scanMask i16 at 0x20/0x22/0x24, lcName[64] at 0x26, abbrev[64] at 0x66,
// buyOn[256] at 0xa6, sellOn[rest] at 0x1a6.
function makeJunkResource(id: number, name: string, write: (d: DataView) => void): JunkResource {
    var data = new DataView(new ArrayBuffer(676));
    write(data);
    return new JunkResource(new Resource("jünk", id, name, data), defaultIDSpace);
}

describe("JunkResource", function() {
    const idSpace = defaultIDSpace;

    it("should parse the scalar fields and string tables", function() {
        var junk = makeJunkResource(149, "durknen girns", function(d) {
            d.setInt16(0x10, 311);   // boughtAt1
            d.setInt16(0x12, -1);    // boughtAt2
            d.setInt16(0x20, 3000);  // basePrice
            d.setInt16(0x22, 0);     // flags
            d.setInt16(0x24, 0);     // scanMask
            writeCString(d, 0x26, "durknen girns");
            writeCString(d, 0x66, "dk grns");
            writeCString(d, 0xa6, "b43");
        });

        expect(junk.id).toEqual(149);
        expect(junk.name).toEqual("durknen girns");
        expect(junk.soldAt).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(junk.boughtAt).toEqual([311, -1, 0, 0, 0, 0, 0, 0]);
        expect(junk.basePrice).toEqual(3000);
        expect(junk.flags).toEqual(0);
        expect(junk.scanMask).toEqual(0);
        expect(junk.lcName).toEqual("durknen girns");
        expect(junk.abbrev).toEqual("dk grns");
        expect(junk.buyOn).toEqual("b43");
        expect(junk.sellOn).toEqual("");
    });

    it("should parse all 8 soldAt/boughtAt slots", function() {
        var junk = makeJunkResource(134, "water", function(d) {
            for (var i = 0; i < 8; i += 1) {
                d.setInt16(i * 2, 160 + i);
                d.setInt16(0x10 + i * 2, 439 - i);
            }
        });

        expect(junk.soldAt).toEqual([160, 161, 162, 163, 164, 165, 166, 167]);
        expect(junk.boughtAt).toEqual([439, 438, 437, 436, 435, 434, 433, 432]);
    });

    // Stock jünk 128 carries easter-egg strings sitting off-by-one
    // ('ad00d' starts at 0xa7, one past the buyOn field), so buyOn reads as
    // "" and sellOn picks up 'h33r'. Reading must never throw: a failed or
    // garbled string degrades to "available everywhere".
    it("should not throw on jünk 128's off-by-one easter-egg strings", function() {
        var junk = makeJunkResource(128, "ice-lizard pelts", function(d) {
            d.setInt16(0x00, 219);
            d.setInt16(0x02, 449);
            d.setInt16(0x20, 750);
            d.setInt16(0x24, 0x800);
            writeCString(d, 0x26, "ice-lizard pelts");
            writeCString(d, 0x66, "Pelts");
            writeCString(d, 0xa7, "ad00d");
            writeCString(d, 0x1a6, "h33r");
        });

        expect(junk.lcName).toEqual("ice-lizard pelts");
        expect(junk.abbrev).toEqual("Pelts");
        expect(junk.soldAt).toEqual([219, 449, 0, 0, 0, 0, 0, 0]);
        expect(junk.basePrice).toEqual(750);
        expect(junk.scanMask).toEqual(0x800);
        expect(junk.buyOn).toEqual("");
        expect(junk.sellOn).toEqual("h33r");
    });

    it("should clamp sellOn to a truncated resource instead of throwing", function() {
        // A resource cut off mid-sellOn: only "too" of "toolong" fits.
        var data = new DataView(new ArrayBuffer(0x1a6 + 3));
        data.setInt16(0x20, 50);
        var str = "toolong";
        for (var i = 0; i < str.length && 0x1a6 + i < data.byteLength; i += 1) {
            data.setUint8(0x1a6 + i, str.charCodeAt(i));
        }
        var junk = new JunkResource(new Resource("jünk", 150, "chrotite gas", data), idSpace);

        expect(junk.basePrice).toEqual(50);
        expect(junk.sellOn).toEqual("too");
    });
});

// Writes a NUL-terminated string at offset (bytes after the NUL are left 0).
function writeCString(d: DataView, offset: number, str: string): void {
    for (var i = 0; i < str.length; i += 1) {
        d.setUint8(offset + i, str.charCodeAt(i));
    }
    d.setUint8(offset + str.length, 0);
}
