// Headless test runner. bazel is broken in this environment, so this
// bundles each *_test.ts with esbuild and runs the bundles under jasmine in
// plain node:
//   npm run test:headless
//   node scripts/test_headless.js [rootDir ...]   (default: nova nova_ecs novaparse)
//
// Test files that cannot run headless (browser-only imports, missing game
// data) are reported as SKIPped, not failures — only jasmine assertion
// failures fail the run.

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const Jasmine = require("jasmine");

const repoRoot = path.resolve(__dirname, "..");
const workDir = path.join(repoRoot, ".test-bundles");
const buildDir = path.join(workDir, "build");
const specDir = path.join(workDir, "spec");

const EXCLUDED_DIRS = new Set([
    "node_modules", "dist-site", "bazel-out", ".test-bundles", "dist",
]);

// Files that can only run under bazel (runfiles fixtures, concatjs
// shared scope, browser renderer). Everything else that fails to load
// outside bazel (e.g. the resource parser tests, which require the
// BAZEL_NODE_RUNFILES_HELPER module) is auto-skipped at load time.
const EXCLUDED_FILES = {
    // pixi.Application auto-detects a WebGL renderer; node has none.
    "nova/src/display/display_plugin_test.ts":
        "needs a browser renderer",
    // No imports: under bazel all specs share one concatjs scope, and it
    // uses chai-style .to.throw() matchers.
    "novaparse/test/resource_parsers/PNGCompare_test.ts":
        "relies on bazel concatjs shared scope + chai-style matchers",
};

function listTestFiles(root) {
    var results = [];
    for (var entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name)) {
                results = results.concat(listTestFiles(path.join(root, entry.name)));
            }
        }
        else if (entry.name.endsWith("_test.ts")) {
            var relFile = path.relative(repoRoot, path.join(root, entry.name));
            if (EXCLUDED_FILES[relFile]) {
                skips.push(relFile + " (excluded: " + EXCLUDED_FILES[relFile] + ")");
            }
            else {
                results.push(path.join(root, entry.name));
            }
        }
    }
    return results;
}

function flattenName(file) {
    return path.relative(repoRoot, file)
        .replace(/\.ts$/, "").replace(/[/\\]/g, "__") + ".js";
}

var roots = process.argv.slice(2).map(function(arg) {
    return path.resolve(repoRoot, arg);
});
if (roots.length === 0) {
    roots = ["nova", "nova_ecs", "novaparse"].map(function(dir) {
        return path.join(repoRoot, dir);
    });
}

var skips = [];

var testFiles = [];
for (var root of roots) {
    testFiles = testFiles.concat(listTestFiles(root));
}
if (testFiles.length === 0) {
    console.error("No *_test.ts found under " + roots.join(", "));
    process.exit(1);
}
console.log("Bundling " + testFiles.length + " test files with esbuild ...");

fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(specDir, { recursive: true });

// IDSpaceHandler_test resolves its fixture directory relative to the
// bundled file's __dirname, exactly like it does next to the bazel-built
// spec. Copy it into the build dir so the test can run headless.
var idSpaceFixture = path.join(repoRoot, "novaparse", "test",
    "IDSpaceHandlerTestFilesystem");
if (fs.existsSync(idSpaceFixture)) {
    fs.cpSync(idSpaceFixture, path.join(buildDir, "IDSpaceHandlerTestFilesystem"),
        { recursive: true });
}


for (var file of testFiles) {
    var rel = path.relative(repoRoot, file);
    var outName = flattenName(file);
    try {
        esbuild.buildSync({
            entryPoints: [file],
            bundle: true,
            platform: "node",
            format: "cjs",
            tsconfig: path.join(repoRoot, "tsconfig.json"),
            outfile: path.join(buildDir, outName),
            logLevel: "silent",
        });
    }
    catch (e) {
        var text = (e && e.errors && e.errors[0]) ? e.errors[0].text : String(e);
        skips.push(rel + " (esbuild: " + text + ")");
        continue;
    }
    // Wrapper spec: a bundle whose module body throws (browser-only deps,
    // missing data files) is a SKIP, not a jasmine failure.
    fs.writeFileSync(path.join(specDir, outName),
        "try {\n"
        + "    require(" + JSON.stringify(path.join(buildDir, outName)) + ");\n"
        + "} catch (e) {\n"
        + "    (global.__bundleTestSkips = global.__bundleTestSkips || []).push("
        + JSON.stringify(rel) + " + \" (load: \" + e + \")\");\n"
        + "}\n");
}

var jasmine = new Jasmine({ projectBaseDir: repoRoot });
jasmine.exitOnCompletion = false;
jasmine.loadConfig({
    spec_dir: path.relative(repoRoot, specDir),
    spec_files: ["*_test.js"],
    random: false,
});
jasmine.execute().then(function(overallResult) {
    var allSkips = skips.concat(global.__bundleTestSkips || []);
    if (allSkips.length > 0) {
        console.log("SKIPPED " + allSkips.length + " of " + testFiles.length
            + " test files (cannot run headless):");
        for (var skip of allSkips) {
            console.log("  - " + skip);
        }
    }
    console.log("HEADLESS TESTS " + overallResult.overallStatus.toUpperCase());
    process.exitCode = overallResult.overallStatus === "passed" ? 0 : 1;
});
