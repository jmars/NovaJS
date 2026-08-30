// Custom game-data bundle container: ONE file the client fetches instead of
// ~9000 individual HTTP requests (the GitHub Pages black-screen cause).
//
// File layout (all integers little-endian):
//   [0, 4)                   u32 headerLength
//   [4, 4 + headerLength)    UTF-8 JSON header (BundleHeader)
//   [4 + headerLength, end)  payload: every resource's raw bytes,
//                            concatenated in manifest order. Entry offsets
//                            are relative to the payload start, so a
//                            resource lives at
//                            payloadStart + offset .. + length.
//
// Entries are not compressed: PNGs and MP3s (~86% of the bytes) are
// incompressible, and the JSONs are small enough that the simple format
// wins. The client keeps one ArrayBuffer and decodes on demand.
//
// Pure helpers only — no node or browser globals beyond TextEncoder /
// TextDecoder / URL — so the same module serves the generator
// (scripts/generate_static.ts) and the browser loader, and round-trips in
// headless jasmine tests.

export const BUNDLE_FORMAT = "novajs-gamedata-bundle";
export const BUNDLE_VERSION = 1;

export interface BundleEntry {
    /** Client-relative resource key, e.g. "gameData/data/Ship/nova:128.json". */
    url: string;
    /** Offset of the resource bytes, relative to the payload start. */
    offset: number;
    /** Length of the resource bytes in bytes. */
    length: number;
}

export interface BundleHeader {
    format: typeof BUNDLE_FORMAT;
    version: number;
    entryCount: number;
    entries: Array<BundleEntry>;
}

export interface DecodedBundleHeader {
    header: BundleHeader;
    /** Byte offset of the payload region within the bundle file. */
    payloadStart: number;
}

/** Serializes the header as the bundle file prefix:
 * u32LE headerLength + header JSON bytes. */
export function encodeHeader(header: BundleHeader): Uint8Array {
    var jsonBytes = new TextEncoder().encode(JSON.stringify(header));
    var out = new Uint8Array(4 + jsonBytes.byteLength);
    new DataView(out.buffer).setUint32(0, jsonBytes.byteLength, true);
    out.set(jsonBytes, 4);
    return out;
}

/** Parses and validates the bundle file prefix. Throws on a truncated
 * prefix, wrong format/version, or a manifest inconsistent with
 * entryCount. Does not require the payload to be present. */
export function decodeHeader(data: ArrayBuffer | Uint8Array): DecodedBundleHeader {
    var bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.byteLength < 4) {
        throw new Error("Bundle too short for header length prefix: "
            + bytes.byteLength + " bytes");
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var headerLength = view.getUint32(0, true);
    if (4 + headerLength > bytes.byteLength) {
        throw new Error("Bundle header length " + headerLength
            + " exceeds file size " + bytes.byteLength);
    }
    var header = JSON.parse(
        new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))) as BundleHeader;
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
    return { header: header, payloadStart: 4 + headerLength };
}

/** Resolves url against base to the canonical absolute form. The generator
 * keys its manifest by client-relative paths (e.g.
 * "gameData/data/Ship/nova:128.json"); the client canonicalizes fetch URLs
 * against document.baseURI the same way, so both sides agree on one key
 * space. */
export function canonicalUrl(url: string, base: string): string {
    return new URL(url, base).href;
}
