import "jasmine";
import { Resource } from "resource_fork";
import { JunkResource } from "../../src/resource_parsers/JunkResource";
import { BaseResource } from "../../src/resource_parsers/NovaResourceBase";
import { getEmptyNovaResources, NovaResources } from "../../src/resource_parsers/ResourceHolderBase";
import { JunkParse } from "../../src/parsers/JunkParse";
import { SpobResource } from "../../src/resource_parsers/SpobResource";

// An idSpace containing a single spöb, "nova:250". BaseResource's globalID is
// assigned here the same way IDSpaceHandler does it.
function makeIDSpace(): NovaResources {
    var idSpace = getEmptyNovaResources();
    var spob = new BaseResource(new Resource("spöb", 250, "Earth", new DataView(new ArrayBuffer(16))), idSpace);
    spob.globalID = "nova:250";
    spob.prefix = "nova";
    idSpace.spöb["250"] = spob as unknown as SpobResource;
    return idSpace;
}

// Builds a 676-byte jünk resource in the given idSpace. globalID/prefix are
// assigned here the same way IDSpaceHandler does before parsing.
function makeJunkResource(idSpace: NovaResources, write: (d: DataView) => void): JunkResource {
    var data = new DataView(new ArrayBuffer(676));
    write(data);
    var junk = new JunkResource(new Resource("jünk", 128, "ice-lizard pelts", data), idSpace);
    junk.globalID = "nova:128";
    junk.prefix = "nova";
    return junk;
}

// Strict on purpose: JunkParse must resolve its references through the
// idSpace and warn-and-drop on its own, never delegating to this.
var strictNotFound = function(m: string) {
    throw new Error(m);
};

describe("JunkParse", function() {
    it("should resolve soldAt/boughtAt raw ids to global ids, in order", async function() {
        var idSpace = makeIDSpace();
        var junk = makeJunkResource(idSpace, function(d) {
            d.setInt16(0x02, 250);   // soldAt2 -> nova:250
            d.setInt16(0x12, 250);   // boughtAt1 -> nova:250
            d.setInt16(0x20, 750);
        });

        var data = await JunkParse(junk, strictNotFound);

        // 0 and -1 slots mean "unset" and are dropped silently.
        expect(data.soldAt).toEqual(["nova:250"]);
        expect(data.boughtAt).toEqual(["nova:250"]);
        expect(data.basePrice).toEqual(750);
        expect(data.id).toEqual("nova:128");
    });

    it("should warn and drop references to missing spöbs instead of failing", async function() {
        var idSpace = makeIDSpace();
        var junk = makeJunkResource(idSpace, function(d) {
            d.setInt16(0x00, 250);   // exists
            d.setInt16(0x02, 999);   // missing
            d.setInt16(0x04, -1);    // unset
        });

        var warnSpy = spyOn(console, "warn");
        var data = await JunkParse(junk, strictNotFound);

        expect(data.soldAt).toEqual(["nova:250"]);
        expect(warnSpy).toHaveBeenCalled();
    });

    // Stock jünk 128 carries easter-egg strings sitting off-by-one, so buyOn
    // reads as "" and sellOn picks up 'h33r'. The parse must pass them
    // through untouched ("available everywhere") and never throw.
    it("should pass buyOn/sellOn through without throwing on the jünk 128 noise", async function() {
        var idSpace = makeIDSpace();
        var junk = makeJunkResource(idSpace, function(d) {
            writeCString(d, 0x26, "ice-lizard pelts");
            writeCString(d, 0xa7, "ad00d");
            writeCString(d, 0x1a6, "h33r");
        });

        var data = await JunkParse(junk, strictNotFound);

        expect(data.lcName).toEqual("ice-lizard pelts");
        expect(data.buyOn).toEqual("");
        expect(data.sellOn).toEqual("h33r");
    });
});

// Writes a NUL-terminated string at offset (bytes after the NUL are left 0).
function writeCString(d: DataView, offset: number, str: string): void {
    for (var i = 0; i < str.length; i += 1) {
        d.setUint8(offset + i, str.charCodeAt(i));
    }
    d.setUint8(offset + str.length, 0);
}
