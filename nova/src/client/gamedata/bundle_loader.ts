// Client loader for the game-data bundle (format: common/bundle_format.ts).
//
// Lazy-loading design: the client fetches only the small JSON index
// (gameData/bundle.index.json) up front, then HTTP-Range fetches each
// resource's bytes out of the uncompressed shard files on demand. This is
// what removes both the whole-bundle download AND the ~9000 per-file HTTP
// requests behind the GitHub Pages black screen.
//
// Serving pixi's Assets loader from that index is what makes the Range
// fetches transparent: Assets.load does NOT consult the Cache before
// fetching, so pre-populating PIXI.Assets.cache cannot bypass the network.
// Instead we register a LoadParser that outranks the stock png/json/sound
// parsers and materializes bundle entries straight from Range responses.
//
// When the index is missing (express dev server, old per-file deployments)
// loadGameBundle returns false, every parser test() fails, and stock
// network loading proceeds unchanged — zero server changes needed.

import * as PIXI from 'pixi.js';
// Type-only import: @pixi/sound probes audio codecs via
// document.createElement at module scope, so a static import would break
// headless (node) imports of this module. Loaded lazily in loadSound.
import type * as sound from '@pixi/sound';
import {
    BundleIndexHeader,
    canonicalUrl,
    validateHeader,
} from '../../common/bundle_format';

/** Read-ahead unit for small entries: JSONs cluster by type in the
 * generator's manifest order, so one aligned chunk usually covers many.
 * 64KiB keeps a single straddling entry to two chunks. */
export const CHUNK_BYTES = 64 * 1024;
/** Chunk-cache bound: 512 chunks x 64KiB ~= 32MiB. */
const MAX_CACHED_CHUNKS = 512;

/** Where one resource lives: a shard file plus a shard-relative byte
 * range, plus the raw manifest key. pixi's synchronous Texture.from(rawUrl)
 * looks assets up in the legacy TextureCache by that exact string, while
 * Assets caches by the resolved absolute URL — so both forms are needed. */
export interface BundleIndexEntry {
    shardFile: string;
    offset: number;
    length: number;
    rawUrl: string;
}

const DEFAULT_INDEX_PATH = 'gameData/bundle.index.json';

/** "?v=<deploy version>" for index + shard fetches, so a redeploy busts
 * stale cached bytes. The version is embedded by generate_static as
 * window.NOVA_VERSION (window === globalThis in the browser); empty
 * outside the generated site (dev server, tests). */
function versionSuffix(): string {
    const version = (globalThis as { NOVA_VERSION?: string }).NOVA_VERSION || '';
    return version !== '' ? '?v=' + version : '';
}

/** The base both bundle keys and parser URLs are resolved against. In the
 * browser this is document.baseURI — the same base pixi's
 * utils.path.toAbsolute uses — so both sides agree on one key space
 * (including spritesheet "../" image paths). */
export function pageBase(): string {
    return typeof document === 'undefined' ? 'http://novajs.invalid/' : document.baseURI;
}

/** Canonical absolute form shared by manifest keys and loader URLs. */
export function canonicalEntryUrl(url: string, base: string): string {
    return canonicalUrl(url, base);
}

/** Maps every manifest entry to its canonical URL. */
export function buildBundleIndex(header: BundleIndexHeader, base: string): Map<string, BundleIndexEntry> {
    const index = new Map<string, BundleIndexEntry>();
    for (const entry of header.entries) {
        index.set(canonicalEntryUrl(entry.url, base), {
            shardFile: header.shards[entry.shard],
            offset: entry.offset,
            length: entry.length,
            rawUrl: entry.url,
        });
    }
    return index;
}

/** Fetches and installs the bundle index. Returns false — network-fallback
 * mode — when the index is missing or malformed, leaving the stock pixi
 * parsers in charge of every URL. */
export async function loadGameBundle(indexPath: string = DEFAULT_INDEX_PATH): Promise<boolean> {
    try {
        const response = await fetch(indexPath + versionSuffix());
        if (!response.ok) {
            return false;
        }
        const header = JSON.parse(await response.text()) as BundleIndexHeader;
        validateHeader(header);
        bundleIndex = buildBundleIndex(header, pageBase());
        return true;
    } catch {
        return false;
    }
}

let bundleIndex: Map<string, BundleIndexEntry> | null = null;

// Chunk cache: key "<shardFile>#<chunkIndex>" -> in-flight or fulfilled
// chunk promise. Storing the promise deduplicates concurrent requests for
// the same chunk; insertion order doubles as the LRU order.
const chunkCache = new Map<string, Promise<Uint8Array>>();

function chunkKey(shardFile: string, chunkIndex: number): string {
    return shardFile + '#' + chunkIndex;
}

/** One HTTP Range fetch. Requires 206; a server that ignores Range (200)
 * is tolerated only when it returned the whole file, which is then sliced —
 * never a silent wrong answer. The slice clips at EOF, since a range past
 * the file's end (the shard's tail chunk) is legal. A 206 body shorter
 * than requested is legal only when clipped at the file's end (the last
 * chunk of a shard): the Content-Range must confirm it, and requireFull
 * callers (exact entry fetches) reject shorts outright. */
async function fetchRange(url: string, start: number, end: number,
    requireFull: boolean): Promise<Uint8Array> {
    const response = await fetch(url + versionSuffix(), {
        headers: { Range: 'bytes=' + start + '-' + end },
    });
    if (response.status === 200) {
        const full = new Uint8Array(await response.arrayBuffer());
        const last = Math.min(end, full.byteLength - 1);
        // A whole-file body ends at EOF, so a range past it (the shard's
        // tail chunk) slices short instead of throwing; requireFull
        // (exact entry fetches) still rejects any short body.
        if (last < start || (requireFull && full.byteLength <= end)) {
            throw new Error('[bundle] Range ' + start + '-' + end
                + ' ignored and body is only ' + full.byteLength + ' bytes: ' + url);
        }
        return full.subarray(start, last + 1);
    }
    if (response.status !== 206) {
        throw new Error('[bundle] unexpected status ' + response.status
            + ' for a Range fetch of ' + url);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const wanted = end - start + 1;
    if (bytes.byteLength === wanted) {
        return bytes;
    }
    const declared = /bytes (\d+)-(\d+)\/(\d+)/.exec(
        response.headers.get('Content-Range') ?? '');
    const clippedAtEof = declared !== null
        && Number(declared[1]) === start
        && Number(declared[2]) - start + 1 === bytes.byteLength
        && Number(declared[3]) === Number(declared[2]) + 1;
    if (requireFull || !clippedAtEof) {
        throw new Error('[bundle] truncated 206: wanted ' + wanted
            + ' bytes of ' + url + ', got ' + bytes.byteLength);
    }
    return bytes;
}

async function fetchChunk(shardFile: string, chunkIndex: number): Promise<Uint8Array> {
    const key = chunkKey(shardFile, chunkIndex);
    const cached = chunkCache.get(key);
    if (cached) {
        // Refresh insertion order: Map iterates oldest first, so a re-insert
        // makes this chunk the newest survivor on eviction.
        chunkCache.delete(key);
        chunkCache.set(key, cached);
        return cached;
    }
    const promise = fetchRange(shardFile, chunkIndex * CHUNK_BYTES,
        (chunkIndex + 1) * CHUNK_BYTES - 1, false);
    chunkCache.set(key, promise);
    while (chunkCache.size > MAX_CACHED_CHUNKS) {
        const oldest = chunkCache.keys().next();
        if (oldest.done) {
            break;
        }
        chunkCache.delete(oldest.value);
    }
    // Rejects must not poison the cache for later retries.
    promise.catch(() => chunkCache.delete(key));
    return promise;
}

/** Reads one entry's bytes: an exact Range fetch for large entries, or
 * 64KiB-aligned chunk reads (cached, coalesced, deduplicated) for small
 * ones. The returned bytes are slices of cached chunks — copy before
 * mutating. */
export async function fetchEntryBytes(entry: BundleIndexEntry): Promise<Uint8Array> {
    // A zero-length entry (the generator's empty-default-sound path) must
    // not reach the chunk math below: at a 64KiB boundary it computes
    // endChunk = startChunk - 1 and fetches the preceding chunk.
    if (entry.length === 0) {
        return new Uint8Array(0);
    }
    if (entry.length > CHUNK_BYTES) {
        // Big entry: exact Range fetch, so a short body is always an error.
        return await fetchRange(entry.shardFile, entry.offset,
            entry.offset + entry.length - 1, true);
    }
    const startChunk = Math.floor(entry.offset / CHUNK_BYTES);
    const endChunk = Math.floor((entry.offset + entry.length - 1) / CHUNK_BYTES);
    const startInChunk = entry.offset - startChunk * CHUNK_BYTES;
    if (startChunk === endChunk) {
        const chunk = await fetchChunk(entry.shardFile, startChunk);
        return chunk.subarray(startInChunk, startInChunk + entry.length);
    }
    // Straddles a chunk boundary: both chunks, stitched.
    const chunks = await Promise.all([
        fetchChunk(entry.shardFile, startChunk),
        fetchChunk(entry.shardFile, endChunk),
    ]);
    const bytes = new Uint8Array(entry.length);
    const head = chunks[0].length - startInChunk;
    bytes.set(chunks[0].subarray(startInChunk), 0);
    bytes.set(chunks[1].subarray(0, entry.length - head), head);
    return bytes;
}

/** Parses JSON resource bytes. */
export function decodeJsonBytes(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(bytes));
}

function extensionOf(url: string): string {
    return PIXI.utils.path.extname(url).toLowerCase();
}

function lookupEntry(url: string): BundleIndexEntry | undefined {
    if (!bundleIndex) {
        return undefined;
    }
    return bundleIndex.get(canonicalEntryUrl(url, pageBase()));
}

async function loadTexture(url: string, bytes: Uint8Array, rawUrl?: string): Promise<PIXI.Texture> {
    // Mirrors the stock loadTextures parser, minus the fetch: decode the
    // bytes into an ImageBitmap-backed BaseTexture + Texture.
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const base = new PIXI.BaseTexture(bitmap, {
        resolution: PIXI.utils.getResolutionOfUrl(url),
    });
    base.resource.src = url;
    const texture = new PIXI.Texture(base);
    // The synchronous Texture.from(rawUrl) paths (spritesheet frames, the
    // starfield) consult only the legacy TextureCache — register there too,
    // or those calls silently fetch the same PNG from the network.
    if (rawUrl) {
        PIXI.Texture.addToCache(texture, rawUrl);
    }
    texture.baseTexture.on('dispose', () => {
        delete PIXI.Assets.loader.promiseCache[url];
    });
    return texture;
}

async function loadSound(url: string, bytes: Uint8Array): Promise<sound.Sound> {
    // slice() so the AudioContext decode owns its own copy of the bytes.
    const soundLib = await import('@pixi/sound');
    return new Promise<sound.Sound>((resolve, reject) => {
        soundLib.Sound.from({
            source: bytes.slice().buffer as ArrayBuffer,
            preload: true,
            loaded: (err, loaded) => {
                if (err || !loaded) {
                    reject(err);
                    return;
                }
                resolve(loaded);
            },
        });
    });
}

/** Materializes one bundle URL into the asset its extension implies.
 * Exported for tests; BundleLoadParser.load delegates here. */
export async function loadBundleAsset(url: string): Promise<any> {
    const entry = lookupEntry(url);
    if (!entry) {
        throw new Error('[bundle] not found: ' + url);
    }
    const bytes = await fetchEntryBytes(entry);
    switch (extensionOf(url)) {
        case '.json':
            return decodeJsonBytes(bytes);
        case '.png':
            return loadTexture(url, bytes, entry.rawUrl);
        case '.mp3':
            return loadSound(url, bytes);
        default:
            throw new Error('[bundle] no materializer for ' + url);
    }
}

export const BundleLoadParser = {
    extension: {
        type: PIXI.ExtensionType.LoadParser,
        // Above LoaderParserPriority.High: @pixi/extensions handleByList
        // sorts descending, so our test() runs before the stock
        // png/json/sound parsers ever see a bundle URL.
        priority: PIXI.LoaderParserPriority.High + 1,
    },
    test(url: string): boolean {
        // Outside the bundle (including network-fallback mode) this is
        // false and the stock parsers handle the URL as before.
        return lookupEntry(url) !== undefined;
    },
    load(url: string): Promise<any> {
        return loadBundleAsset(url);
    },
};

PIXI.extensions.add(BundleLoadParser);

/** Resolves true once the bundle index is loaded (resources then load
 * lazily, per Range request), false in network-fallback mode. */
export const bundleReady: Promise<boolean> = loadGameBundle();

/** Kept for boot ordering (browser.ts + GameData await it): the index is
 * all that must be ready before plugins run, since every texture now loads
 * through awaited async call sites. Resolves right after bundleReady. */
export const texturesReady: Promise<void> = bundleReady.then(() => { });
