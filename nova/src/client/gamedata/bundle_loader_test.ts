import "jasmine";
import {
    BUNDLE_FORMAT,
    BUNDLE_VERSION,
    BundleHeader,
    decodeHeader,
    encodeHeader,
} from "../../common/bundle_format";
import {
    BundleIndexEntry,
    buildBundleIndex,
    canonicalEntryUrl,
    decodeJsonBytes,
    entryView,
    loadGameBundle,
} from "./bundle_loader";

describe("bundle_loader", function() {
    const BASE = "http://example.com/game/index.html";

    function sampleHeader(): BundleHeader {
        return {
            format: BUNDLE_FORMAT,
            version: BUNDLE_VERSION,
            entryCount: 3,
            entries: [
                { url: "gameData/data/Ship/nova:128.json", offset: 0, length: 9 },
                { url: "gameData/data/PictImage/nova:5000.png", offset: 9, length: 4 },
                { url: "gameData/data/SpriteSheetImage/nova:1000 0.png", offset: 13, length: 2 },
            ],
        };
    }

    /** A real bundle file layout: header prefix + payload bytes, with the
     * json entry holding an actual JSON document. */
    function sampleBundleFile(): Uint8Array {
        const header = sampleHeader();
        const payload = new Uint8Array(15);
        payload.set(new TextEncoder().encode('{"a": 42}'), 0);
        payload.set([1, 2, 3, 4], 9);
        payload.set([9, 9], 13);
        const prefix = encodeHeader(header);
        const file = new Uint8Array(prefix.length + payload.length);
        file.set(prefix, 0);
        file.set(payload, prefix.length);
        return file;
    }

    it("canonicalizes manifest keys and parser URLs into one key space", function() {
        // What Assets/Loader hand the parser: path.toAbsolute normalizes
        // "../", so the spritesheet image URL arrives in this form.
        const parserUrl = "http://example.com/game/gameData/data/SpriteSheet/../SpriteSheetImage/nova:1000 0.png";
        // The manifest key the generator wrote: plain relative path.
        const manifestKey = "gameData/data/SpriteSheetImage/nova:1000 0.png";

        expect(canonicalEntryUrl(parserUrl, BASE)).toBe(canonicalEntryUrl(manifestKey, BASE));
        expect(canonicalEntryUrl(manifestKey, BASE)).toBe(
            "http://example.com/game/gameData/data/SpriteSheetImage/nova:1000%200.png");

        // Already-canonical URLs are unchanged, so the parser can
        // canonicalize its input without breaking absolute keys.
        const absolute = canonicalEntryUrl(manifestKey, BASE);
        expect(canonicalEntryUrl(absolute, BASE)).toBe(absolute);
    });

    it("indexes the decoded header by canonical URL and slices entries out", function() {
        const file = sampleBundleFile();
        // The same decode loadGameBundle performs on the fetched bytes.
        const decoded = decodeHeader(file);

        const index = buildBundleIndex(decoded.header, BASE);
        expect(index.size).toBe(3);

        const jsonEntry = index.get(canonicalEntryUrl("gameData/data/Ship/nova:128.json", BASE));
        expect(jsonEntry).toBeDefined();

        const view = entryView(file.buffer, decoded.payloadStart, jsonEntry as BundleIndexEntry);
        expect(decodeJsonBytes(view)).toEqual({ a: 42 });

        // Entries are views into the one buffer, not copies: the bytes are
        // shared with the bundle ArrayBuffer.
        const pngEntry = index.get(canonicalEntryUrl("gameData/data/PictImage/nova:5000.png", BASE));
        const pngView = entryView(file.buffer, decoded.payloadStart, pngEntry as BundleIndexEntry);
        expect(Array.from(pngView)).toEqual([1, 2, 3, 4]);
    });

    it("resolves false in network-fallback mode when the bundle is missing", async function() {
        // Connection-refused: no bundle served -> fallback mode.
        expect(await loadGameBundle("http://127.0.0.1:1/gameData/bundle.bin")).toBe(false);
        // Unfetchable scheme (no node HTTP server involved either way).
        expect(await loadGameBundle("file:///nonexistent/novajs/bundle.bin")).toBe(false);
    });
});
