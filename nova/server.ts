import * as Comlink from 'comlink';
//import nodeEndpoint from "comlink/dist/esm/node-adapter";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import express from "express";
import { isLeft } from "fp-ts/Either";
import fs from "fs";
import http from "http";
import * as t from 'io-ts';
import path from "path";
import { Worker } from "worker_threads";
import { makeShip } from "./src/nova_plugin/make_ship";
import { NovaRepl } from "./src/server/nova_repl";
import { FilesystemData } from "./src/server/parsing/FilesystemData";
import { GameDataAggregator } from "./src/server/parsing/GameDataAggregator";
import { NovaParseWorkerApi } from "./src/server/parsing/nova_parse_worker";
import { setupRoutes } from "./src/server/setupRoutes";
//import { NovaRepl } from "./src/server/NovaRepl";


const Settings = t.partial({
    port: t.number,
    relativeDataPath: t.string,
    https: t.boolean,
});
type Settings = t.TypeOf<typeof Settings>;

const runfiles = process.env.BAZEL_NODE_RUNFILES_HELPER === undefined
    ? undefined
    : require(process.env.BAZEL_NODE_RUNFILES_HELPER) as { resolve: (path: string) => string };

// Resolves bazel runfiles paths. Outside bazel (plain node), falls back to
// paths relative to this file's directory (nova/), so the server can boot
// from a checkout with the bundles built in place.
function resolvePath(p: string): string {
    if (runfiles === undefined) {
        return path.join(__dirname, p.replace(/^novajs\/nova\//, ""));
    }
    return runfiles.resolve(p);
}

const serverSettingsPath = resolvePath("novajs/nova/settings/server.json");
const maybeSettings = Settings.decode(
    JSON.parse(fs.readFileSync(serverSettingsPath, "utf8")) as unknown);

if (isLeft(maybeSettings)) {
    throw new Error('Failed to parse settings');
}

const settings = maybeSettings.right;
const port = settings.port ?? 8000;
const novaDataPath = path.join(__dirname, settings.relativeDataPath ?? "Nova_Data");

const app = express();
const httpServer = http.createServer(app);

const filesystemDataPath = path.join(__dirname, "objects");
const filesystemData = new FilesystemData(filesystemDataPath);

const htmlPath = resolvePath("novajs/nova/src/index.html");
const bundlePath = resolvePath("novajs/nova/src/browser_bundle.js");
const bundleMapPath = resolvePath("novajs/nova/src/browser_bundle.js.map");
const clientSettingsPath = resolvePath("novajs/nova/settings/controls.json");


const novaParseWorkerPath = resolvePath(
    "novajs/nova/src/server/parsing/nova_parse_worker_bundle.js");

const repl = new NovaRepl();

async function startGame() {
    // Set up the novaparse webworker
    const novaParseWorker = new Worker(novaParseWorkerPath);
    const novaParseWorkerApi = Comlink.wrap<NovaParseWorkerApi>(
        nodeEndpoint(novaParseWorker));

    await novaParseWorkerApi.init(novaDataPath);
    const novaFileData = await novaParseWorkerApi.novaParse;
    //const novaFileData = new NovaParse(novaDataPath, false);
    if (!novaFileData) {
        throw new Error("Expected novaparse worker to be defined");
    }
    const gameData = new GameDataAggregator([filesystemData, novaFileData]);
    repl.repl.context.gameData = gameData;
    repl.repl.context.makeShip = makeShip;

    setupRoutes(gameData, app, htmlPath, bundlePath, bundleMapPath, clientSettingsPath);

    httpServer.listen(port, function() {
        console.log("listening at port " + port);
    });

}

startGame();

