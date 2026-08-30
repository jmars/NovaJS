// Static site data generator: pre-renders everything the express server
// serves on the fly (setupRoutes.ts) into a plain directory tree that can be
// hosted on GitHub Pages with no node server:
//   gameData/data/{type}/{id}.{json|png|mp3}
//   gameData/ids.json
//   preloadData.json
//   settings/controls.json
//
// Bundle and run it headless from the novajs root (the bundle must live
// inside the repo tree so that lamejs' lazy require() resolves):
//   npm run generate:static
// which is:
//   npx esbuild --bundle --platform=node --tsconfig=tsconfig.json \
//       scripts/generate_static.ts --outfile=scripts/generate_static_bundle.js
//   node scripts/generate_static_bundle.js [--out <dir>] [--data-path <dir>]
//
// The pipeline mirrors nova/server.ts: GameDataAggregator over FilesystemData
// (the git-tracked nova/objects overrides) and NovaParse (the real game
// data), minus the comlink/worker indirection.

import * as fs from "fs";
import * as path from "path";
import { FilesystemData, Paths, PathInfo } from "nova/src/server/parsing/FilesystemData";
import { GameDataAggregator } from "nova/src/server/parsing/GameDataAggregator";
import { NovaParse } from "novaparse/NovaParse";

// The bundle runs from scripts/, so these land inside the repo checkout.
const defaultDataPath = path.join(__dirname, "..", "nova", "Nova_Data");
const defaultObjectsPath = path.join(__dirname, "..", "nova", "objects");
const defaultOutDir = path.join(__dirname, "..", "dist-site");
const settingsPath = path.join(__dirname, "..", "nova", "settings");

function extensionForType(type: string): string {
    var pathInfo = (Paths as { [type: string]: PathInfo })[type];
    return pathInfo ? pathInfo.extension : "json";
}

// Serializes a resource the same way express' res.send() would transmit it:
// binary buffers byte-for-byte, everything else as JSON.
function serializeValue(value: unknown): Buffer | Uint8Array | string {
    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return value;
    }
    return JSON.stringify(value);
}

function listFilesRecursive(root: string): Array<string> {
    var results: Array<string> = [];
    for (var entry of fs.readdirSync(root, { withFileTypes: true })) {
        var fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(listFilesRecursive(fullPath));
        }
        else {
            results.push(fullPath);
        }
    }
    return results;
}

async function main() {
    var args = process.argv.slice(2);
    var dataPath = defaultDataPath;
    var objectsPath = defaultObjectsPath;
    var outDir = defaultOutDir;
    for (var i = 0; i < args.length; i += 1) {
        if (args[i] === "--data-path" && i + 1 < args.length) {
            dataPath = args[i + 1];
            i += 1;
        }
        else if (args[i] === "--out" && i + 1 < args.length) {
            outDir = args[i + 1];
            i += 1;
        }
    }
    outDir = path.resolve(outDir);

    console.log("Generating static data from " + path.resolve(dataPath)
        + " into " + outDir + " ...");

    // Start clean so stale files from earlier runs can't hide behind the
    // file-count self-check below.
    fs.rmSync(outDir, { recursive: true, force: true });

    // Same as nova/server.ts, minus the comlink/worker indirection.
    // Note: the plug-ins subdirectory must match the on-disk name under
    // dataPath (NovaParse's default, "Plug-ins"); the game data directory
    // itself is called "Nova Plug-ins" but is never referenced directly.
    var gameData = new GameDataAggregator([
        new FilesystemData(objectsPath),
        new NovaParse(dataPath, false, { novaFiles: "Nova Files", novaPlugins: "Plug-ins" }),
    ]);

    var ids = await gameData.ids;
    var dataRoot = path.join(outDir, "gameData", "data");
    var totalIDs = 0;
    var failures: Array<string> = [];

    for (var entry of Object.entries(ids)) {
        var type = entry[0];
        var typeIDs = entry[1];

        // Aggregator IDs are a concatenation across data sources; dedupe so
        // each file is written exactly once (the later write would win,
        // exactly like the express route).
        var uniqueIDs = Array.from(new Set(typeIDs));
        totalIDs += uniqueIDs.length;

        var typeDir = path.join(dataRoot, type);
        fs.mkdirSync(typeDir, { recursive: true });
        var extension = extensionForType(type);

        var gettable = (gameData.data as { [type: string]: { get(id: string): Promise<unknown> } })[type];
        if (!gettable) {
            failures.push("Unknown data type " + type);
            continue;
        }

        for (var id of uniqueIDs) {
            // .get() falls back to Defaults, same as the server's
            // requestFulfiller, so every ID produces a servable file.
            var value = await gettable.get(id);
            fs.writeFileSync(path.join(typeDir, id + "." + extension), serializeValue(value));
        }
        console.log("  " + type + ": " + uniqueIDs.length);
    }

    // Auxiliary files, served by setupRoutes from the aggregator directly.
    fs.writeFileSync(path.join(outDir, "gameData", "ids.json"), JSON.stringify(ids));
    fs.writeFileSync(path.join(outDir, "preloadData.json"), JSON.stringify(await gameData.preloadData));
    fs.mkdirSync(path.join(outDir, "settings"), { recursive: true });
    fs.copyFileSync(path.join(settingsPath, "controls.json"), path.join(outDir, "settings", "controls.json"));

    // Self-verification: exactly one file per ID plus the 3 auxiliary files,
    // PNGs carry the PNG magic bytes, MP3s carry a frame header (or are the
    // empty default sound), JSON files parse.
    var writtenFiles = listFilesRecursive(outDir);
    if (writtenFiles.length !== totalIDs + 3) {
        failures.push("Expected " + (totalIDs + 3) + " files, found " + writtenFiles.length);
    }

    for (var file of writtenFiles) {
        if (file.endsWith(".png")) {
            var png = fs.readFileSync(file);
            if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4E || png[3] !== 0x47) {
                failures.push("Bad PNG magic: " + file);
            }
        }
        else if (file.endsWith(".mp3")) {
            var mp3 = fs.readFileSync(file);
            // MPEG frame sync: 11 set bits. An empty file is the default
            // sound (Defaults.SoundFile is an empty buffer) and is allowed.
            if (mp3.length > 0 && (mp3[0] !== 0xFF || (mp3[1] & 0xE0) !== 0xE0)) {
                failures.push("Bad MP3 frame header: " + file);
            }
        }
        else if (file.endsWith(".json")) {
            try {
                JSON.parse(fs.readFileSync(file, "utf8"));
            }
            catch (e) {
                failures.push("Unparseable JSON: " + file);
            }
        }
    }

    if (failures.length === 0) {
        console.log("PASS: " + totalIDs + " resources + 3 auxiliary files ("
            + writtenFiles.length + " files)");
        return 0;
    }
    else {
        console.log("FAIL: " + failures.length + " of " + (totalIDs + 3) + " checks failed:");
        for (var failure of failures.slice(0, 20)) {
            console.log("  - " + failure);
        }
        return 1;
    }
}

main().then(function(code) {
    process.exit(code);
}, function(err) {
    console.error(err);
    process.exit(1);
});
