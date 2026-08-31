import "jasmine";
import { readResourceFork, Resource, ResourceMap } from "resource_fork";
import { SystResource } from "novaparse/src/resource_parsers/SystResource";
import { defaultIDSpace } from "./DefaultIDSpace";

// Bazel no longer patches require.
const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;

describe("SystResource", function() {
    // Systs don't depend on other resources.
    const idSpace = defaultIDSpace;

    let rf: ResourceMap;
    let s1: SystResource;
    let s2: SystResource;

    beforeEach(async function() {
        const dataPath = runfiles.resolve("novajs/novaparse/test/resource_parsers/files/syst.ndat");
        rf = await readResourceFork(dataPath, false);
        const systs = rf.sÿst;
        s1 = new SystResource(systs[128], idSpace);
        s2 = new SystResource(systs[129], idSpace);
    });

    it("should parse position", function() {
        expect(s1.position).toEqual([42, 84]);
        expect(s2.position).toEqual([-28, -96]);
    });

    it("should parse links", function() {
        expect(s1.links).toEqual(new Set([129, 163]));
        expect(s2.links).toEqual(new Set([128, 163]));
    });

    it("should parse spobs", function() {
        expect(s1.spobs).toEqual([128, 189, 194]);
    });

    // The raw sÿst ambient fields (FUN_0041af90's data), synthesized in-test
    // with the real Kania sÿst 128 values read from Nova Data 1-6.rez in the
    // spawn audit: 8 dûde ids @0x44, counts @0x54, roll count @0x64,
    // government @0x66, 8 peripheral përs ids @0x6e, percents @0x7e.
    function makeSyst(id: number, write: (d: DataView) => void): SystResource {
        var data = new DataView(new ArrayBuffer(428));
        write(data);
        return new SystResource(new Resource("sÿst", id, "Kania", data), idSpace);
    }

    it("should parse the ambient dûde pairs, roll count and government", function() {
        var kania = makeSyst(128, function(d) {
            [128, 130, 134, 136, 211, 210, 233, 260].forEach(
                (v, i) => d.setInt16(0x44 + i * 2, v));
            [30, 10, 12, 5, 12, 10, 1, 20].forEach(
                (v, i) => d.setInt16(0x54 + i * 2, v));
            d.setInt16(0x64, 4);
            d.setInt16(0x66, 128);
        });

        expect(kania.dudeIds).toEqual([128, 130, 134, 136, 211, 210, 233, 260]);
        expect(kania.dudeCounts).toEqual([30, 10, 12, 5, 12, 10, 1, 20]);
        expect(kania.ambientRollCount).toEqual(4);
        expect(kania.government).toEqual(128);
    });

    it("should parse the peripheral përs pairs", function() {
        var kania = makeSyst(128, function(d) {
            [510, 155, 156, 128, 227, 158, 157, 296].forEach(
                (v, i) => d.setInt16(0x6e + i * 2, v));
            [50, 1, 1, 10, 1, 1, 1, 15].forEach(
                (v, i) => d.setInt16(0x7e + i * 2, v));
        });

        expect(kania.persIds).toEqual([510, 155, 156, 128, 227, 158, 157, 296]);
        expect(kania.persPercents).toEqual([50, 1, 1, 10, 1, 1, 1, 15]);
    });

    it("should skip out-of-range dûde and përs id slots (with their counts)",
        function() {
            var syst = makeSyst(129, function(d) {
                d.setInt16(0x44, 128);      // valid dûde slot 0
                d.setInt16(0x54, 30);
                d.setInt16(0x46, 100);      // slot 1: below the 0x80 band
                d.setInt16(0x56, 10);
                d.setInt16(0x48, 0x280);    // slot 2: past the 512-entry table
                d.setInt16(0x58, 10);
                d.setInt16(0x6e, 510);      // valid përs slot 0
                d.setInt16(0x7e, 50);
                d.setInt16(0x70, 0x47f);    // përs slot 1: past the table
                d.setInt16(0x80, 1);
            });

            expect(syst.dudeIds).toEqual([128]);
            expect(syst.dudeCounts).toEqual([30]);
            expect(syst.persIds).toEqual([510]);
            expect(syst.persPercents).toEqual([50]);
        });
});
