// Client loader for the game-data bundle (format: common/bundle_format.ts).
//
// Serving pixi's Assets loader from an in-memory index is what removes the
// ~9000 per-file HTTP requests behind the GitHub Pages black screen:
// Assets.load does NOT consult the Cache before fetching, so pre-populating
// PIXI.Assets.cache cannot bypass the network. Instead we register a
// LoadParser that outranks the stock png/json/sound parsers and materializes
// bundle entries straight from the one retained ArrayBuffer.
//
// When the bundle is missing (express dev server, old per-file deployments)
// loadGameBundle returns false, every parser test() fails, and stock
// network loading proceeds unchanged — zero server changes needed.

import * as PIXI from 'pixi.js';
import PQueue from 'p-queue';
// Type-only import: @pixi/sound probes audio codecs via
// document.createElement at module scope, so a static import would break
// headless (node) imports of this module. Loaded lazily in loadSound.
import type * as sound from '@pixi/sound';
import {
    BundleHeader,
    canonicalUrl,
    decodeHeader,
} from '../../common/bundle_format';

/** Byte range of one resource inside the retained bundle ArrayBuffer, plus
 * the raw manifest key. pixi's synchronous Texture.from(rawUrl) looks assets
 * up in the legacy TextureCache by that exact string, while Assets caches by
 * the resolved absolute URL — so both forms are needed. */
export interface BundleIndexEntry {
    offset: number;
    length: number;
    rawUrl: string;
}

const DEFAULT_BUNDLE_PATH = 'gameData/bundle.bin';

/** "?v=<deploy version>" for bundle fetches, so a redeploy busts stale
 * cached bundles. The version is embedded by generate_static as
 * window.NOVA_VERSION (window === globalThis in the browser); empty
 * outside the generated site (dev server, tests). */
function versionSuffix(): string {
    const version = (globalThis as { NOVA_VERSION?: string }).NOVA_VERSION || '';
    return version !== '' ? '?v=' + version : '';
}

/** Fetches url as bytes, or null on any failure (404, offline,
 * non-browser fetch). */
async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        return await response.arrayBuffer();
    } catch {
        return null;
    }
}

/** Gunzips via the browser's DecompressionStream. Throws when the bytes
 * are not valid gzip, so the caller can fall back to the plain bundle. */
async function gunzip(data: ArrayBuffer): Promise<ArrayBuffer> {
    const source = new Response(data);
    if (!source.body) {
        throw new Error('Empty response body');
    }
    const output = source.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(output).arrayBuffer();
}

/** Installs the decoded bundle as the module-level index. Throws on a
 * malformed header. */
function indexBundle(data: ArrayBuffer): boolean {
    const decoded = decodeHeader(data);
    bundleData = data;
    payloadStart = decoded.payloadStart;
    bundleIndex = buildBundleIndex(decoded.header, pageBase());
    return true;
}

/** Fetches and indexes the bundle. Returns false — network-fallback mode —
 * when the bundle is missing or malformed, leaving the stock pixi parsers
 * in charge of every URL.
 *
 * Tries the gzipped bundle the generator deploys first (decompressed here
 * by DecompressionStream), then the plain bundle (older deployments), then
 * gives up into network-fallback mode. */
export async function loadGameBundle(bundlePath: string = DEFAULT_BUNDLE_PATH): Promise<boolean> {
    const suffix = versionSuffix();
    const gzData = await fetchBytes(bundlePath + '.gz' + suffix);
    if (gzData !== null) {
        try {
            return indexBundle(await gunzip(gzData));
        } catch {
            // Corrupt or not gzip: fall through to the plain bundle.
        }
    }
    const plainData = await fetchBytes(bundlePath + suffix);
    if (plainData !== null) {
        return indexBundle(plainData);
    }
    return false;
}

let bundleData: ArrayBuffer | null = null;
let payloadStart = 0;
let bundleIndex: Map<string, BundleIndexEntry> | null = null;

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
export function buildBundleIndex(header: BundleHeader, base: string): Map<string, BundleIndexEntry> {
    const index = new Map<string, BundleIndexEntry>();
    for (const entry of header.entries) {
        index.set(canonicalEntryUrl(entry.url, base), {
            offset: entry.offset,
            length: entry.length,
            rawUrl: entry.url,
        });
    }
    return index;
}

/** A view of one resource inside the retained bundle buffer. No copy: the
 * bytes are shared with the bundle ArrayBuffer. */
export function entryView(data: ArrayBuffer, payloadStart: number, entry: BundleIndexEntry): Uint8Array {
    return new Uint8Array(data, payloadStart + entry.offset, entry.length);
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
    // The synchronous Texture.from(rawUrl) paths (spaceport's spriteFromPict)
    // consult only the legacy TextureCache — register there too, or those
    // calls silently fetch the same PNG from the network.
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

const BundleLoadParser = {
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
    // Promise<any>: the stock parsers likewise return whatever the asset
    // type implies; Loader's generic load signature erases to this.
    async load(url: string): Promise<any> {
        const entry = lookupEntry(url);
        if (!entry || !bundleData) {
            throw new Error('[bundle] not found: ' + url);
        }
        const bytes = entryView(bundleData, payloadStart, entry);
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
    },
};

PIXI.extensions.add(BundleLoadParser);

/** Materializes every bundled texture through the normal Assets pipeline so
 * the synchronous PIXI.Texture.from/Sprite.from paths (spaceport's
 * spriteFromPict) never miss and never hit the network. Covers the
 * PictImage + CicnImage (+ SpriteSheetImage) keys: all .png entries. */
async function prewarmTextures(): Promise<void> {
    if (!bundleIndex) {
        return;
    }
    const textureUrls = Array.from(bundleIndex.keys()).filter((url) => extensionOf(url) === '.png');
    const queue = new PQueue({ concurrency: 16 });
    await Promise.all(textureUrls.map((url) => queue.add(() => PIXI.Assets.load(url)).catch((e) => {
        // One bad asset falls back to per-URL network loading (or fails
        // exactly like today); it must not sink the whole pre-warm.
        console.warn('[bundle] prewarm failed for ' + url + ': ' + e);
    })));
}

/** Resolves true once the bundle is loaded and indexed, false in
 * network-fallback mode. */
export const bundleReady: Promise<boolean> = loadGameBundle();

/** Resolves after the bundled textures are in the Assets cache (no-op in
 * network-fallback mode). */
export const texturesReady: Promise<void> = bundleReady.then((loaded) => {
    if (loaded) {
        return prewarmTextures();
    }
    return undefined;
});
