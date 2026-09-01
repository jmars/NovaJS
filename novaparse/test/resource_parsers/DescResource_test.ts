import "jasmine";
import { readResourceFork, ResourceMap } from "resource_fork";
import { DescResource } from "../../src/resource_parsers/DescResource";
import { defaultIDSpace } from "./DefaultIDSpace";

// Bazel no longer patches require.
const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;

describe("DescResource", function() {
    let d1: DescResource;
    let d2: DescResource;
    let rf: ResourceMap;

    // Descs don't depend on other resources.
    const idSpace = defaultIDSpace;

    beforeEach(async function() {
        const dataPath = runfiles.resolve("novajs/novaparse/test/resource_parsers/files/desc.ndat");
        rf = await readResourceFork(dataPath, false);

        const descs = rf.dësc;
        d1 = new DescResource(descs[128], idSpace);
        d2 = new DescResource(descs[129], idSpace);

    });

    it("Should parse the string in the desc", function() {
        expect(d1.text).toEqual("The first description has one line of text that you can read.");
        expect(d2.text).toEqual("This one has a graphic.");
    });
    it("Should parse the graphic after the null terminator", function() {
        // d2's text ends at byte 23; the uint16 immediately after is the
        // PICT id 4214 (a text-only desc reads 0).
        expect(d2.graphic).toEqual(4214);
        expect(d1.graphic).toEqual(0);
    });
});
