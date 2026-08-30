// Game-data bundle container: a small JSON index plus uncompressed shard
// files, so the client makes ONE small request up front (the index) and then
// HTTP-Range fetches each resource's bytes on demand — instead of one huge
// whole-bundle download (or ~9000 individual requests, the GitHub Pages
// black-screen cause).
//
// Layout:
//   gameData/bundle.index.json  UTF-8 JSON BundleIndexHeader: format tag,
//                               version, entryCount, the shard file names,
//                               and one manifest entry per resource.
//   gameData/bundle.<i>.bin     pure payload: every resource's raw bytes,
//                               concatenated in manifest order. Entries
//                               never straddle shards; an entry's offset is
//                               relative to ITS shard's start, so a resource
//                               lives at shard[offset, offset + length).
//
// Shards are capped at SHARD_BYTES to stay under the GitHub Pages ~100MiB
// per-file soft limit (which is also why the payload is uncompressed: a
// gzip stream cannot be Range-seeked, and PNGs/MP3s — ~86% of the bytes —
// are incompressible anyway).
//
// Pure helpers only — no node or browser globals beyond URL — so the same
// module serves the generator (scripts/generate_static.ts) and the browser
// loader, and round-trips in headless jasmine tests.

export const BUNDLE_FORMAT = "novajs-gamedata-bundle";
export const BUNDLE_VERSION = 2;

/** Maximum shard payload size: GitHub Pages soft-limits files at ~100MiB,
 * and the generator fails the build on any shard at or above 100MB. */
export const SHARD_BYTES = 64 * 1024 * 1024;

export interface BundleEntry {
    /** Client-relative resource key, e.g. "gameData/data/Ship/nova:128.json". */
    url: string;
    /** Index into the index header's shards array. */
    shard: number;
    /** Offset of the resource bytes, relative to its shard's start. */
    offset: number;
    /** Length of the resource bytes in bytes. */
    length: number;
}

export interface BundleIndexHeader {
    format: typeof BUNDLE_FORMAT;
    version: number;
    entryCount: number;
    /** Client-relative shard file names, e.g. "gameData/bundle.0.bin";
     * entries reference them by index. */
    shards: Array<string>;
    entries: Array<BundleEntry>;
}

/** Validates an index header (shared by the generator's self-check and the
 * browser loader). Throws on a wrong format/version, a manifest
 * inconsistent with entryCount, or a missing/empty shards array, or an
 * entry referencing a nonexistent shard. */
export function validateHeader(header: BundleIndexHeader): void {
    if (header.format !== BUNDLE_FORMAT) {
        throw new Error("Not a " + BUNDLE_FORMAT + " (got format " + header.format + ")");
    }
    if (header.version !== BUNDLE_VERSION) {
        throw new Error("Unsupported bundle version " + header.version);
    }
    if (!Array.isArray(header.entries) || header.entries.length !== header.entryCount) {
        throw new Error("Bundle header entryCount " + header.entryCount
            + " does not match " + (Array.isArray(header.entries)
                ? header.entries.length + " manifest entries"
                : "missing entries array"));
    }
    if (!Array.isArray(header.shards) || header.shards.length === 0) {
        throw new Error("Bundle header lists no shards");
    }
    for (var entry of header.entries) {
        if (!(entry.shard >= 0) || entry.shard >= header.shards.length) {
            throw new Error("Entry " + entry.url + " references shard "
                + entry.shard + ", outside the 0.." + (header.shards.length - 1)
                + " range the header declares");
        }
    }
}

/** Resolves url against base to the canonical absolute form. The generator
 * keys its manifest by client-relative paths (e.g.
 * "gameData/data/Ship/nova:128.json"); the client canonicalizes fetch URLs
 * against document.baseURI the same way, so both sides agree on one key
 * space. */
export function canonicalUrl(url: string, base: string): string {
    return new URL(url, base).href;
}
