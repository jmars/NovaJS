import "jasmine";
import {
    BUNDLE_FORMAT,
    BUNDLE_VERSION,
    BundleHeader,
    canonicalUrl,
    decodeHeader,
    encodeHeader,
} from "./bundle_format";

describe("bundle_format", function() {
    function sampleHeader(): BundleHeader {
        return {
            format: BUNDLE_FORMAT,
            version: BUNDLE_VERSION,
            entryCount: 3,
            entries: [
                { url: "gameData/data/Ship/nova:128.json", offset: 0, length: 5 },
                { url: "gameData/data/PictImage/nova:5000.png", offset: 5, length: 8 },
                { url: "gameData/ids.json", offset: 13, length: 4 },
            ],
        };
    }

    function samplePayload(): Uint8Array {
        // 17 bytes of distinct filler, covering all three sample entries.
        const payload = new Uint8Array(17);
        for (let i = 0; i < payload.length; i++) {
            payload[i] = (i * 31 + 7) % 251;
        }
        return payload;
    }

    it("round-trips a header and slices entries back out of the payload", function() {
        const header = sampleHeader();
        const payload = samplePayload();

        const prefix = encodeHeader(header);
        const bundle = new Uint8Array(prefix.length + payload.length);
        bundle.set(prefix, 0);
        bundle.set(payload, prefix.length);

        const decoded = decodeHeader(bundle);
        expect(decoded.payloadStart).toEqual(prefix.length);
        expect(decoded.header).toEqual(header);

        for (const entry of decoded.header.entries) {
            const start = decoded.payloadStart + entry.offset;
            expect(Array.from(bundle.subarray(start, start + entry.length)))
                .toEqual(Array.from(payload.subarray(entry.offset, entry.offset + entry.length)));
        }
    });

    it("decodes from an ArrayBuffer", function() {
        const prefix = encodeHeader(sampleHeader());
        const bundle = new Uint8Array(prefix.length + 3);
        bundle.set(prefix, 0);

        const decoded = decodeHeader(bundle.buffer);
        expect(decoded.header.entryCount).toEqual(3);
        expect(decoded.payloadStart).toEqual(prefix.length);
    });

    it("rejects a truncated prefix", function() {
        const prefix = encodeHeader(sampleHeader());
        expect(function() { decodeHeader(prefix.subarray(0, 3)); }).toThrowError(/too short/);
    });

    it("rejects a header length that overruns the file", function() {
        const prefix = encodeHeader(sampleHeader());
        new DataView(prefix.buffer).setUint32(0, prefix.length * 2, true);
        expect(function() { decodeHeader(prefix); }).toThrowError(/exceeds file size/);
    });

    it("rejects a wrong format", function() {
        const bad = sampleHeader() as { format: string };
        bad.format = "not-a-bundle";
        expect(function() {
            decodeHeader(encodeHeader(bad as unknown as BundleHeader));
        }).toThrowError(/Not a/);
    });

    it("rejects an unsupported version", function() {
        const bad = sampleHeader();
        bad.version = BUNDLE_VERSION + 1;
        expect(function() { decodeHeader(encodeHeader(bad)); }).toThrowError(/version/);
    });

    it("rejects a manifest inconsistent with entryCount", function() {
        const bad = sampleHeader();
        bad.entryCount = 99;
        expect(function() { decodeHeader(encodeHeader(bad)); }).toThrowError(/entryCount/);
    });

    it("canonicalizes urls against a base", function() {
        const base = "https://example.com/site/";
        expect(canonicalUrl("gameData/ids.json", base))
            .toEqual("https://example.com/site/gameData/ids.json");
        expect(canonicalUrl("/gameData/bundle.bin", base))
            .toEqual("https://example.com/gameData/bundle.bin");
        expect(canonicalUrl("https://other.example/x.png", base))
            .toEqual("https://other.example/x.png");
        expect(canonicalUrl("../gameData/bundle.bin", "https://example.com/site/index.html"))
            .toEqual("https://example.com/gameData/bundle.bin");
        // Colons in nova resource IDs are path characters, not a scheme,
        // because the reference contains a slash before any colon.
        expect(canonicalUrl("gameData/data/Ship/nova:128.json", base))
            .toEqual("https://example.com/site/gameData/data/Ship/nova:128.json");
    });
});
