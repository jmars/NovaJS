import "jasmine";
import {
    BUNDLE_FORMAT,
    BUNDLE_VERSION,
    BundleIndexHeader,
    canonicalUrl,
    validateHeader,
} from "./bundle_format";

describe("bundle_format", function() {
    function sampleHeader(): BundleIndexHeader {
        return {
            format: BUNDLE_FORMAT,
            version: BUNDLE_VERSION,
            entryCount: 4,
            shards: ["gameData/bundle.0.bin", "gameData/bundle.1.bin"],
            entries: [
                // Shard 0: two entries packed back to back from offset 0.
                { url: "gameData/data/Ship/nova:128.json", shard: 0, offset: 0, length: 5 },
                { url: "gameData/data/PictImage/nova:5000.png", shard: 0, offset: 5, length: 8 },
                // Shard 1: offsets restart at zero (shard-relative).
                { url: "gameData/ids.json", shard: 1, offset: 0, length: 4 },
                { url: "gameData/preloadData.json", shard: 1, offset: 4, length: 3 },
            ],
        };
    }

    function roundTrip(header: BundleIndexHeader): BundleIndexHeader {
        // The index travels as JSON on the wire; validate what arrives.
        const decoded = JSON.parse(JSON.stringify(header)) as BundleIndexHeader;
        validateHeader(decoded);
        return decoded;
    }

    it("validates a well-formed index header and keeps shard-relative offsets", function() {
        const header = roundTrip(sampleHeader());
        expect(header.entryCount).toEqual(4);
        // Shard 0 holds the first two entries contiguously...
        expect(header.entries[1].offset).toEqual(header.entries[0].offset
            + header.entries[0].length);
        // ...and shard 1's offsets are relative to the shard, not global.
        expect(header.entries[2].shard).toEqual(1);
        expect(header.entries[2].offset).toEqual(0);
        expect(header.entries[3].offset)
            .toEqual(header.entries[2].offset + header.entries[2].length);
    });

    it("round-trips every field through JSON", function() {
        const header = roundTrip(sampleHeader());
        expect(header).toEqual(sampleHeader());
    });

    it("rejects a wrong format", function() {
        const bad = sampleHeader() as { format: string };
        bad.format = "not-a-bundle";
        expect(function() { validateHeader(bad as unknown as BundleIndexHeader); })
            .toThrowError(/Not a/);
    });

    it("rejects an unsupported version", function() {
        const bad = sampleHeader();
        bad.version = BUNDLE_VERSION + 1;
        expect(function() { validateHeader(bad); }).toThrowError(/version/);
    });

    it("rejects a manifest inconsistent with entryCount", function() {
        const bad = sampleHeader();
        bad.entryCount = 99;
        expect(function() { validateHeader(bad); }).toThrowError(/entryCount/);
    });

    it("rejects a header with no shards", function() {
        const bad = sampleHeader();
        bad.shards = [];
        expect(function() { validateHeader(bad); }).toThrowError(/no shards/);
    });

    it("rejects an entry referencing a nonexistent shard", function() {
        const bad = sampleHeader();
        bad.entries[3].shard = 2;
        expect(function() { validateHeader(bad); }).toThrowError(/shard/);
    });

    it("canonicalizes urls against a base", function() {
        const base = "https://example.com/site/";
        expect(canonicalUrl("gameData/ids.json", base))
            .toEqual("https://example.com/site/gameData/ids.json");
        expect(canonicalUrl("/gameData/bundle.0.bin", base))
            .toEqual("https://example.com/gameData/bundle.0.bin");
        expect(canonicalUrl("https://other.example/x.png", base))
            .toEqual("https://other.example/x.png");
        expect(canonicalUrl("../gameData/bundle.0.bin", "https://example.com/site/index.html"))
            .toEqual("https://example.com/gameData/bundle.0.bin");
        // Colons in nova resource IDs are path characters, not a scheme,
        // because the reference contains a slash before any colon.
        expect(canonicalUrl("gameData/data/Ship/nova:128.json", base))
            .toEqual("https://example.com/site/gameData/data/Ship/nova:128.json");
    });
});
