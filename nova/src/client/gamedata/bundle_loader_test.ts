import "jasmine";
import {
    BUNDLE_FORMAT,
    BUNDLE_VERSION,
    BundleIndexHeader,
} from "../../common/bundle_format";
import {
    BundleIndexEntry,
    CHUNK_BYTES,
    buildBundleIndex,
    canonicalEntryUrl,
    fetchEntryBytes,
    loadBundleAsset,
    loadGameBundle,
} from "./bundle_loader";

describe("bundle_loader", function() {
    const BASE = "http://example.com/game/index.html";

    function sampleHeader(): BundleIndexHeader {
        return {
            format: BUNDLE_FORMAT,
            version: BUNDLE_VERSION,
            entryCount: 3,
            shards: ["gameData/bundle.0.bin", "gameData/bundle.1.bin"],
            entries: [
                { url: "gameData/data/Ship/nova:128.json", shard: 0, offset: 0, length: 9 },
                { url: "gameData/data/PictImage/nova:5000.png", shard: 0, offset: 9, length: 4 },
                { url: "gameData/data/SpriteSheetImage/nova:1000 0.png", shard: 1, offset: 0, length: 2 },
            ],
        };
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

    it("indexes entries by canonical URL with their shard file", function() {
        const index = buildBundleIndex(sampleHeader(), BASE);
        expect(index.size).toBe(3);

        const jsonEntry = index.get(
            canonicalEntryUrl("gameData/data/Ship/nova:128.json", BASE)) as BundleIndexEntry;
        expect(jsonEntry).toEqual({
            shardFile: "gameData/bundle.0.bin",
            offset: 0,
            length: 9,
            rawUrl: "gameData/data/Ship/nova:128.json",
        });

        // The spritesheet image lives in the second shard, offsets restart
        // there, and the raw manifest key is preserved (Texture.from looks
        // it up in the legacy TextureCache by this exact string).
        const pngEntry = index.get(
            canonicalEntryUrl("gameData/data/SpriteSheetImage/nova:1000 0.png", BASE)) as BundleIndexEntry;
        expect(pngEntry).toEqual({
            shardFile: "gameData/bundle.1.bin",
            offset: 0,
            length: 2,
            rawUrl: "gameData/data/SpriteSheetImage/nova:1000 0.png",
        });
    });

    it("resolves false in network-fallback mode when the index is missing", async function() {
        // Connection-refused: no index served -> fallback mode.
        expect(await loadGameBundle("http://127.0.0.1:1/gameData/bundle.index.json")).toBe(false);
        // Unfetchable scheme (no node HTTP server involved either way).
        expect(await loadGameBundle("file:///nonexistent/novajs/bundle.index.json")).toBe(false);
    });

    interface RangeRequest {
        url: string;
        range?: string;
    }

    type Mode = "206" | "200" | "206-truncated";

    /** Replaces global fetch with a Range-aware stub over a path -> body
     * map (any "?v=" cache-bust suffix is stripped before lookup). Range
     * requests are answered 206 with the requested byte slice; mode
     * '200' ignores Range and serves the whole body, '206-truncated'
     * shortchanges it. Every request is recorded with its Range header. */
    function stubFetch(responses: { [path: string]: Uint8Array | number },
        mode: Mode = "206"): Array<RangeRequest> {
        const requests: Array<RangeRequest> = [];
        (globalThis as { fetch: unknown }).fetch = async (
            url: string, init?: { headers?: Record<string, string> }) => {
            const path = url.split("?")[0];
            const range = init?.headers?.Range;
            requests.push({ url: url, range: range });
            const body = responses[path];
            if (typeof body === "number") {
                return new Response("", { status: body });
            }
            if (range === undefined) {
                return new Response(body, { status: 200 });
            }
            const match = /bytes=(\d+)-(\d+)/.exec(range);
            if (!match) {
                throw new Error("Bad Range header: " + range);
            }
            const start = Number(match[1]);
            const end = Math.min(Number(match[2]), body.length - 1);
            if (mode === "200") {
                return new Response(body, { status: 200 });
            }
            const slice = body.subarray(start, end + 1);
            if (mode === "206-truncated") {
                return new Response(slice.subarray(0, slice.length - 1), {
                    status: 206,
                    headers: { "Content-Range": "bytes " + start + "-" + end + "/" + body.length },
                });
            }
            return new Response(slice, {
                status: 206,
                headers: { "Content-Range": "bytes " + start + "-" + end + "/" + body.length },
            });
        };
        return requests;
    }

    const realFetch = globalThis.fetch;

    afterEach(function() {
        (globalThis as { fetch: unknown }).fetch = realFetch;
        delete (globalThis as { NOVA_VERSION?: string }).NOVA_VERSION;
    });

    /** A shard holding a big JSON (exact-Range path) plus two small
     * entries that share a 64KiB chunk (read-ahead path). The small
     * entries live past the big JSON's end, inside the second chunk. */
    const BIG_JSON = JSON.stringify({ a: 42, pad: "x".repeat(CHUNK_BYTES + 20) });
    const SMALL_A_OFFSET = 66000;
    const SMALL_B_OFFSET = 66100;

    function makeShard(): Uint8Array {
        const shard = new Uint8Array(2 * CHUNK_BYTES);
        shard.set(new TextEncoder().encode(BIG_JSON), 0);
        shard.set(new TextEncoder().encode('{"b": 7}'), SMALL_A_OFFSET);
        shard.set(new TextEncoder().encode('{"c": 9, "d": 11}'), SMALL_B_OFFSET);
        return shard;
    }

    function indexFor(shardFile: string): BundleIndexHeader {
        return {
            format: BUNDLE_FORMAT,
            version: BUNDLE_VERSION,
            entryCount: 3,
            shards: [shardFile],
            entries: [
                // Bigger than CHUNK_BYTES: served by an exact Range fetch.
                { url: "gameData/data/Ship/nova:128.json", shard: 0, offset: 0, length: BIG_JSON.length },
                // Two small entries inside the same 64KiB chunk.
                { url: "gameData/data/Outfit/nova:5.json", shard: 0, offset: SMALL_A_OFFSET, length: 8 },
                { url: "gameData/data/Ship/nova:129.json", shard: 0, offset: SMALL_B_OFFSET, length: 17 },
            ],
        };
    }

    it("fetches the index with the version suffix and materializes a big JSON via an exact Range fetch", async function() {
        const shard = makeShard();
        (globalThis as { NOVA_VERSION?: string }).NOVA_VERSION = "deadbeef";
        const requests = stubFetch({
            "gameData/bundle.index.json": new TextEncoder().encode(
                JSON.stringify(indexFor("gameData/bundle.0.bin"))),
            "gameData/bundle.0.bin": shard,
        });

        expect(await loadGameBundle()).toBe(true);
        expect(requests[0].url).toBe("gameData/bundle.index.json?v=deadbeef");

        const value = await loadBundleAsset("gameData/data/Ship/nova:128.json") as { a: number };
        expect(value.a).toBe(42);
        // The whole entry in ONE exact Range request, cache-busted like the
        // index.
        expect(requests[1].url).toBe("gameData/bundle.0.bin?v=deadbeef");
        expect(requests[1].range).toBe("bytes=0-" + (BIG_JSON.length - 1));
    });

    it("resolves false when the index is a wrong bundle version", async function() {
        const bad = indexFor("gameData/bundle.0.bin");
        bad.version = BUNDLE_VERSION + 1;
        stubFetch({
            "gameData/bundle.index.json": new TextEncoder().encode(JSON.stringify(bad)),
        });

        expect(await loadGameBundle()).toBe(false);
    });

    it("resolves false when the index 404s", async function() {
        stubFetch({ "gameData/bundle.index.json": 404 });

        expect(await loadGameBundle()).toBe(false);
    });

    it("coalesces two adjacent small entries into one 64KiB chunk fetch", async function() {
        // A shard name unused elsewhere in this file: the chunk cache is
        // module-global, so each test exercises its own chunks.
        const shardFile = "gameData/bundle.10.bin";
        const requests = stubFetch({
            "gameData/bundle.index.json": new TextEncoder().encode(
                JSON.stringify(indexFor(shardFile))),
            [shardFile]: makeShard(),
        });
        expect(await loadGameBundle()).toBe(true);

        const first = await loadBundleAsset("gameData/data/Outfit/nova:5.json") as { b: number };
        const second = await loadBundleAsset("gameData/data/Ship/nova:129.json") as { c: number };
        expect(first.b).toBe(7);
        expect(second.c).toBe(9);

        // Both entries came out of ONE aligned 64KiB chunk fetch
        // (requests: the index fetch, then the single chunk fetch). The
        // entries live in the second chunk, so the fetch is chunk-aligned.
        expect(requests.length).toBe(2);
        expect(requests[1].url).toBe(shardFile);
        expect(requests[1].range).toBe("bytes=" + CHUNK_BYTES + "-" + (2 * CHUNK_BYTES - 1));
    });

    it("serves a small entry from the cached chunk without refetching", async function() {
        const shardFile = "gameData/bundle.11.bin";
        const requests = stubFetch({
            "gameData/bundle.index.json": new TextEncoder().encode(
                JSON.stringify(indexFor(shardFile))),
            [shardFile]: makeShard(),
        });
        expect(await loadGameBundle()).toBe(true);

        await loadBundleAsset("gameData/data/Outfit/nova:5.json");
        await loadBundleAsset("gameData/data/Ship/nova:129.json");

        // Exactly one shard request: the second small entry hit the cache.
        const shardRequests = requests.filter((r) => r.url === shardFile);
        expect(shardRequests.length).toBe(1);
        expect(shardRequests[0].range).toBe("bytes=" + CHUNK_BYTES + "-" + (2 * CHUNK_BYTES - 1));
    });

    it("slices the entry out of a whole-shard 200 when Range is ignored", async function() {
        const shardFile = "gameData/bundle.12.bin";
        const requests = stubFetch({
            "gameData/bundle.index.json": new TextEncoder().encode(
                JSON.stringify(indexFor(shardFile))),
            [shardFile]: makeShard(),
        }, "200");
        expect(await loadGameBundle()).toBe(true);

        const value = await loadBundleAsset("gameData/data/Ship/nova:128.json") as { a: number };
        expect(value.a).toBe(42);
        // The Range header was sent; the server just ignored it.
        expect(requests[1].range).toContain("bytes=0-");
    });

    it("rejects when a 206 response is truncated", async function() {
        const shardFile = "gameData/bundle.13.bin";
        stubFetch({
            "gameData/bundle.index.json": new TextEncoder().encode(
                JSON.stringify(indexFor(shardFile))),
            [shardFile]: makeShard(),
        }, "206-truncated");
        expect(await loadGameBundle()).toBe(true);

        await expectAsync(fetchEntryBytes({
            shardFile: shardFile,
            offset: 0,
            length: CHUNK_BYTES + 20,
            rawUrl: "gameData/data/Ship/nova:128.json",
        })).toBeRejectedWithError(Error, /truncated 206/);
    });

    it("reads an entry out of the short tail chunk at end-of-shard", async function() {
        // Shards are rarely multiples of 64KiB, so the last chunk request
        // comes back clipped at EOF (a legal 206): it must be accepted.
        const shardFile = "gameData/bundle.14.bin";
        const shard = new Uint8Array(70000); // one full chunk + 4464-byte tail
        shard.set(new TextEncoder().encode('{"tail": true}'), 66000);
        stubFetch({
            "gameData/bundle.index.json": new TextEncoder().encode(JSON.stringify({
                format: BUNDLE_FORMAT,
                version: BUNDLE_VERSION,
                entryCount: 1,
                shards: [shardFile],
                entries: [{
                    url: "gameData/data/Ship/nova:200.json",
                    shard: 0,
                    offset: 66000,
                    length: 14,
                }],
            })),
            [shardFile]: shard,
        });
        expect(await loadGameBundle()).toBe(true);

        const value = await loadBundleAsset("gameData/data/Ship/nova:200.json") as { tail: boolean };
        expect(value.tail).toBe(true);
    });

    it("materializes a tail entry from a whole-file 200 that ignores Range", async function() {
        // Same EOF-clipped tail chunk as above, but the server ignores
        // Range: the 200 body is the whole shard, ending before the
        // requested chunk's last byte — all the entry's bytes are still
        // present, so the slice must clip at EOF instead of throwing.
        const shardFile = "gameData/bundle.15.bin";
        const shard = new Uint8Array(70000);
        shard.set(new TextEncoder().encode('{"tail": true}'), 66000);
        stubFetch({
            "gameData/bundle.index.json": new TextEncoder().encode(JSON.stringify({
                format: BUNDLE_FORMAT,
                version: BUNDLE_VERSION,
                entryCount: 1,
                shards: [shardFile],
                entries: [{
                    url: "gameData/data/Ship/nova:201.json",
                    shard: 0,
                    offset: 66000,
                    length: 14,
                }],
            })),
            [shardFile]: shard,
        }, "200");
        expect(await loadGameBundle()).toBe(true);

        const value = await loadBundleAsset("gameData/data/Ship/nova:201.json") as { tail: boolean };
        expect(value.tail).toBe(true);
    });

    it("returns empty bytes for a zero-length entry at a 64KiB boundary", async function() {
        // The generator's empty-default-sound path emits length-0 entries.
        // At a chunk boundary the chunk math would compute endChunk =
        // startChunk - 1, fetching the WRONG (preceding) chunk and then
        // throwing on bytes.set into the zero-length result.
        const requests = stubFetch({
            "gameData/bundle.16.bin": new Uint8Array(2 * CHUNK_BYTES),
        });

        const bytes = await fetchEntryBytes({
            shardFile: "gameData/bundle.16.bin",
            offset: CHUNK_BYTES,
            length: 0,
            rawUrl: "gameData/data/Sound/nova:0.mp3",
        });

        expect(bytes.byteLength).toBe(0);
        // Early return: no network traffic at all.
        expect(requests.length).toBe(0);
    });
});
