import "jasmine";
import * as zlib from "zlib";
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

    /** Replaces global fetch with a stub over a url -> response map. The
     * map keys are plain paths; any "?v=" cache-bust suffix is stripped
     * before lookup. */
    function stubFetch(responses: { [path: string]: Uint8Array | number }): Array<string> {
        const urls: Array<string> = [];
        (globalThis as { fetch: unknown }).fetch = async (url: string) => {
            urls.push(url);
            const entry = responses[url.split("?")[0]];
            if (typeof entry === "number") {
                return new Response("", { status: entry });
            }
            return new Response(entry);
        };
        return urls;
    }

    const realFetch = globalThis.fetch;

    afterEach(function() {
        (globalThis as { fetch: unknown }).fetch = realFetch;
        delete (globalThis as { NOVA_VERSION?: string }).NOVA_VERSION;
    });

    it("fetches the gzipped bundle first and decompresses it before decoding", async function() {
        const file = sampleBundleFile();
        const gz = zlib.gzipSync(Buffer.from(file));
        (globalThis as { NOVA_VERSION?: string }).NOVA_VERSION = "deadbeef";
        const urls = stubFetch({ "gameData/bundle.bin.gz": gz });

        expect(await loadGameBundle("gameData/bundle.bin")).toBe(true);
        // The version suffix rides along, and the plain file is never
        // touched when the .gz loads.
        expect(urls).toEqual(["gameData/bundle.bin.gz?v=deadbeef"]);
    });

    it("falls back to the plain bundle when the .gz is missing", async function() {
        const file = sampleBundleFile();
        const urls = stubFetch({ "gameData/bundle.bin.gz": 404, "gameData/bundle.bin": file });

        expect(await loadGameBundle("gameData/bundle.bin")).toBe(true);
        expect(urls).toEqual(["gameData/bundle.bin.gz", "gameData/bundle.bin"]);
    });

    it("falls back to the plain bundle when the .gz is not gzip", async function() {
        const file = sampleBundleFile();
        stubFetch({
            "gameData/bundle.bin.gz": new TextEncoder().encode("not gzip"),
            "gameData/bundle.bin": file,
        });

        expect(await loadGameBundle("gameData/bundle.bin")).toBe(true);
    });

    it("resolves false when neither the .gz nor the plain bundle exists", async function() {
        stubFetch({ "gameData/bundle.bin.gz": 404, "gameData/bundle.bin": 404 });

        expect(await loadGameBundle("gameData/bundle.bin")).toBe(false);
    });

    it("round-trips node's gzip output through DecompressionStream", async function() {
        // The exact production pair: zlib.gzipSync (the generator) ->
        // gunzip via DecompressionStream (the loader).
        const payload = new Uint8Array(1 << 16);
        for (let i = 0; i < payload.length; i++) {
            payload[i] = (i * 31 + 7) % 251;
        }
        const gz = zlib.gzipSync(payload);
        const source = new Response(new Uint8Array(gz));
        if (!source.body) {
            throw new Error("Empty response body");
        }
        const output = new Response(source.body.pipeThrough(new DecompressionStream("gzip")));
        expect(Array.from(new Uint8Array(await output.arrayBuffer())))
            .toEqual(Array.from(payload));
    });
});
