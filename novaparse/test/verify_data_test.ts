import "jasmine";
import * as path from "path";
import { loadContextGoldens, verifyParsedData } from "./verify_data_core";

// Path to the real game data. Bazel runfiles can't contain it, so this spec
// only runs when NOVAJS_DATA_PATH points at a directory that contains a
// "Nova Files" folder with the Nova Data .rez files.
const dataPath = process.env['NOVAJS_DATA_PATH'];

describe("verify parsed Nova data against ConText goldens", function() {
    it("parses the real game data and matches the goldens", async function() {
        if (!dataPath) {
            pending("NOVAJS_DATA_PATH is not set; point it at the directory containing 'Nova Files'");
            return;
        }
        var goldens = loadContextGoldens(path.join(__dirname, "fixtures", "context_goldens.json"));
        var result = await verifyParsedData(dataPath, goldens, function(_w) { });
        expect(result.failures).toEqual([]);
        expect(result.passed).toBe(true);
    });
});
