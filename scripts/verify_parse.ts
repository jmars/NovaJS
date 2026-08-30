// Standalone data-verification harness for the P1 data layer.
//
// Bundle and run it headless from the novajs root:
//   npx esbuild --bundle --platform=node scripts/verify_parse.ts --outfile=/tmp/v.js
//   node /tmp/v.js [--data-path <path to dir containing "Nova Files">]
//
// It parses the real game data with NovaParse (non-strict) and checks the
// result against the ConText goldens in novaparse/test/fixtures/context_goldens.json.

import * as path from "path";
import { loadContextGoldens, verifyParsedData } from "novaparse/test/verify_data_core";

const defaultDataPath = path.join("..", "datadata", "EV Nova");

async function main() {
    var args = process.argv.slice(2);
    var dataPath = defaultDataPath;
    var goldensPath: string | undefined = undefined;
    for (var i = 0; i < args.length; i += 1) {
        if (args[i] === "--data-path" && i + 1 < args.length) {
            dataPath = args[i + 1];
            i += 1;
        }
        else if (args[i] === "--goldens" && i + 1 < args.length) {
            goldensPath = args[i + 1];
            i += 1;
        }
    }

    var goldens = loadContextGoldens(goldensPath);
    console.log("Verifying parsed Nova data in " + path.resolve(dataPath) + " ...");

    var result = await verifyParsedData(dataPath, goldens);

    // Warnings were already printed by the parsers as they ran.

    if (result.passed) {
        console.log("PASS: " + result.checks + " checks");
        return 0;
    }
    else {
        console.log("FAIL: " + result.failures.length + " of " + result.checks + " checks failed:");
        for (var failure of result.failures) {
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
