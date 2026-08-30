import * as fs from "fs";
import * as path from "path";
import { NovaDataType } from "novadatainterface/NovaDataInterface";
import { NovaIDs } from "novadatainterface/NovaIDs";
import { MissionData } from "novadatainterface/MissionData";
import { DudeData } from "novadatainterface/DudeData";
import { PersData } from "novadatainterface/PersData";
import { PlanetData } from "novadatainterface/PlanetData";
import { StringSetData } from "novadatainterface/StringSetData";
import { NovaParse } from "novaparse/NovaParse";

// Golden spot values, derived from the real "Nova Data" resources and the
// ConText export. Shared by the jasmine spec and the standalone harness.
export type ContextGoldens = {
    counts: { [key in NovaDataType]?: number },
    missions: { [id: string]: any },
    governments: { [id: string]: any },
    dudes: { [id: string]: any },
    perses: { [id: string]: any },
    fleets: { [id: string]: any },
    ranks: { [id: string]: any },
    junks: { [id: string]: any },
    // Raw jünk resource ids (e.g. "128"); stock data has exactly 128-150.
    junkIDs?: Array<string> | null,
    planets: { [id: string]: any },
    // Spöbs carrying the commodity-exchange flag (0x0002).
    tradeSpobCount?: number | null,
    chars: { [id: string]: any },
    stringSets: { [id: string]: any },
    descs: { [id: string]: any },
    // Escort/fleet tail fields (shïp UpgradeTo/EscUpgrdCost/EscSellValue/
    // EscortType). Optional so older golden files still load.
    ships?: { [id: string]: any },
};

export function loadContextGoldens(goldensPath?: string): ContextGoldens {
    var p = goldensPath;
    if (!p) {
        p = path.join("novaparse", "test", "fixtures", "context_goldens.json");
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

export type VerificationResult = {
    passed: boolean,
    checks: number,
    failures: Array<string>,
    warnings: Array<string>,
};

// Parses the real game data (all six Nova Data .rez files) and checks the
// parsed result against the ConText goldens, plus referential integrity.
export async function verifyParsedData(
    dataPath: string,
    goldens: ContextGoldens,
    warningSink: (w: string) => void = console.warn
): Promise<VerificationResult> {
    var failures: Array<string> = [];
    var checks = 0;

    function assertEqual(description: string, actual: unknown, expected: unknown) {
        checks += 1;
        var actualText = JSON.stringify(actual);
        var expectedText = JSON.stringify(expected);
        if (actualText !== expectedText) {
            failures.push(description + ": expected " + expectedText + ", got " + actualText);
        }
    }

    // Collect warnings emitted by the parsers while we get data below.
    var warnings: Array<string> = [];
    var originalWarn = console.warn;
    console.warn = function(message?: unknown) {
        warnings.push(String(message));
        warningSink(String(message));
    };

    try {
        var novaParse = new NovaParse(dataPath, false, {
            novaFiles: "Nova Files",
            novaPlugins: "Nova Plug-ins"
        });
        var ids: NovaIDs = await novaParse.ids;

        for (var key in goldens.counts) {
            var dataType = key as NovaDataType;
            assertEqual("Count of " + dataType, ids[dataType].length, goldens.counts[dataType]);
        }

        for (var id in goldens.missions) {
            var expected = goldens.missions[id];
            var mission: MissionData = await novaParse.data[NovaDataType.Mission].get(id);
            for (var field in expected) {
                assertEqual("mïsn " + id + " " + field, (mission as any)[field], expected[field]);
            }
        }

        for (var id in goldens.governments) {
            var expected = goldens.governments[id];
            var govt = await novaParse.data[NovaDataType.Government].get(id);
            for (var field in expected) {
                assertEqual("gövt " + id + " " + field, (govt as any)[field], expected[field]);
            }
        }

        for (var id in goldens.dudes) {
            var expected = goldens.dudes[id];
            var dude: DudeData = await novaParse.data[NovaDataType.Dude].get(id);
            for (var field in expected) {
                if (field === "firstShip") {
                    assertEqual("düde " + id + " firstShip", dude.shipTypes[0].ship, expected[field]);
                }
                else if (field === "shipProbabilitySum") {
                    var sum = dude.shipTypes.reduce(function(a, s) { return a + s.probability; }, 0);
                    assertEqual("düde " + id + " shipProbabilitySum", sum, expected[field]);
                }
                else {
                    assertEqual("düde " + id + " " + field, (dude as any)[field], expected[field]);
                }
            }
        }

        for (var id in goldens.perses) {
            var expected = goldens.perses[id];
            var pers: PersData = await novaParse.data[NovaDataType.Pers].get(id);
            for (var field in expected) {
                assertEqual("përs " + id + " " + field, (pers as any)[field], expected[field]);
            }
        }

        for (var id in goldens.fleets) {
            var expected = goldens.fleets[id];
            var fleet = await novaParse.data[NovaDataType.Fleet].get(id);
            for (var field in expected) {
                if (field === "leadShip") {
                    assertEqual("flët " + id + " leadShip", fleet.leadShipType, expected[field]);
                }
                else {
                    assertEqual("flët " + id + " " + field, (fleet as any)[field], expected[field]);
                }
            }
        }

        for (var id in goldens.ranks) {
            var expected = goldens.ranks[id];
            var rank = await novaParse.data[NovaDataType.Rank].get(id);
            for (var field in expected) {
                assertEqual("ränk " + id + " " + field, (rank as any)[field], expected[field]);
            }
        }

        for (var id in goldens.junks) {
            var expected = goldens.junks[id];
            var junk = await novaParse.data[NovaDataType.Junk].get(id);
            for (var field in expected) {
                assertEqual("jünk " + id + " " + field, (junk as any)[field], expected[field]);
            }
        }

        for (var id in goldens.planets) {
            var expected = goldens.planets[id];
            var planet: PlanetData = await novaParse.data[NovaDataType.Planet].get(id);
            for (var field in expected) {
                assertEqual("spöb " + id + " " + field, (planet as any)[field], expected[field]);
            }
        }

        // Facility spöbs: the exchange/shipyard/outfitter counts (the
        // buttons the spaceport shows must match the planet flags), plus a
        // priceBands sanity sweep over every planet (the nibble bit-decode
        // can only produce 0-3 and always 6 entries — anything else means
        // the flags offset or decode regressed).
        if (goldens.tradeSpobCount !== null && goldens.tradeSpobCount !== undefined) {
            checks += 1;
            var tradeSpobs = 0;
            var shipyardSpobs = 0;
            var outfitterSpobs = 0;
            for (var planetID of ids.Planet) {
                var planetData: PlanetData = await novaParse.data[NovaDataType.Planet].get(planetID);
                if (planetData.hasTradeCenter) {
                    tradeSpobs += 1;
                }
                if (planetData.hasShipyard) {
                    shipyardSpobs += 1;
                }
                if (planetData.hasOutfitter) {
                    outfitterSpobs += 1;
                }
                var bands = planetData.priceBands;
                if (bands.length !== 6 || bands.some(function(band) {
                    return band < 0 || band > 3;
                })) {
                    failures.push("spöb " + planetID + " priceBands out of range: " + JSON.stringify(bands));
                }
            }
            if (tradeSpobs !== goldens.tradeSpobCount) {
                failures.push("trade spöb count: expected " + goldens.tradeSpobCount + ", got " + tradeSpobs);
            }
            if (goldens.shipyardSpobCount !== undefined
                && shipyardSpobs !== goldens.shipyardSpobCount) {
                failures.push("shipyard spöb count: expected " + goldens.shipyardSpobCount
                    + ", got " + shipyardSpobs);
            }
            if (goldens.outfitterSpobCount !== undefined
                && outfitterSpobs !== goldens.outfitterSpobCount) {
                failures.push("outfitter spöb count: expected " + goldens.outfitterSpobCount
                    + ", got " + outfitterSpobs);
            }
        }

        for (var id in goldens.chars) {
            var expected = goldens.chars[id];
            var char = await novaParse.data[NovaDataType.Char].get(id);
            for (var field in expected) {
                assertEqual("chär " + id + " " + field, (char as any)[field], expected[field]);
            }
        }

        for (var id in goldens.ships) {
            var expected = goldens.ships[id];
            var ship = await novaParse.data[NovaDataType.Ship].get(id);
            for (var field in expected) {
                assertEqual("shïp " + id + " " + field, (ship as any)[field], expected[field]);
            }
        }

        // Escort-tail sanity sweep over every shïp: the EscortType decode
        // can only produce -1..3 and the money fields are non-negative;
        // anything else means the tail offsets regressed. A set UpgradeTo
        // must point at a real shïp.
        if (goldens.ships) {
            for (var shipID of ids.Ship) {
                var shipData = await novaParse.data[NovaDataType.Ship].get(shipID);
                checks += 1;
                if (shipData.escortType < -1 || shipData.escortType > 3) {
                    failures.push("shïp " + shipID + " escortType out of range: " + shipData.escortType);
                }
                checks += 1;
                if (shipData.escortUpgradeCost < 0 || shipData.escortSellValue < 0) {
                    failures.push("shïp " + shipID + " negative escort money: cost "
                        + shipData.escortUpgradeCost + ", sell " + shipData.escortSellValue);
                }
                checks += 1;
                if (shipData.upgradeTo !== null && !ids.Ship.includes(shipData.upgradeTo)) {
                    failures.push("shïp " + shipID + " upgradeTo points at missing shïp " + shipData.upgradeTo);
                }
            }
        }

        for (var id in goldens.stringSets) {
            var expected = goldens.stringSets[id];
            var stringSet = await novaParse.data[NovaDataType.StringSet].get(id);
            assertEqual("STR# " + id + " name", stringSet.name, expected.name);
            assertEqual("STR# " + id + " count", stringSet.strings.length, expected.count);
            assertEqual("STR# " + id + " firstString", stringSet.strings[0], expected.firstString);
        }

        for (var id in goldens.descs) {
            var expected = goldens.descs[id];
            var desc = await novaParse.data[NovaDataType.Desc].get(id);
            assertEqual("dësc " + id + " name", desc.name, expected.name);
            assertEqual(
                "dësc " + id + " textPrefix",
                desc.text.slice(0, expected.textPrefix.length),
                expected.textPrefix
            );
        }

        // Referential integrity: every mission and düde must parse, and every
        // resolved reference must point at an id that actually exists.
        for (var missionID of ids.Mission) {
            var mission = await novaParse.data[NovaDataType.Mission].get(missionID);
            var refs: Array<[string, string | null, NovaDataType]> = [
                ["shipDude", mission.shipDude, NovaDataType.Dude],
                ["auxShipDude", mission.auxShipDude, NovaDataType.Dude],
                ["compGovt", mission.compGovt, NovaDataType.Government],
                ["briefText", mission.briefText, NovaDataType.Desc],
                ["quickBrief", mission.quickBrief, NovaDataType.Desc],
                ["loadCargText", mission.loadCargText, NovaDataType.Desc],
                ["dropCargText", mission.dropCargText, NovaDataType.Desc],
                ["compText", mission.compText, NovaDataType.Desc],
                ["failText", mission.failText, NovaDataType.Desc],
                ["shipDoneText", mission.shipDoneText, NovaDataType.Desc],
                ["refuseText", mission.refuseText, NovaDataType.Desc],
            ];
            for (var [field, ref, type] of refs) {
                if (ref !== null && !ids[type].includes(ref)) {
                    checks += 1;
                    failures.push("mïsn " + missionID + " " + field + " points at missing " + type + " " + ref);
                }
            }
        }

        for (var dudeID of ids.Dude) {
            var dude = await novaParse.data[NovaDataType.Dude].get(dudeID);
            for (var shipType of dude.shipTypes) {
                if (shipType.ship !== null && !ids.Ship.includes(shipType.ship)) {
                    checks += 1;
                    failures.push("düde " + dudeID + " points at missing shïp " + shipType.ship);
                }
            }
        }

        // jünk: stock ids must be exactly the golden set (128-150), and every
        // resolved soldAt/boughtAt entry must point at a real spöb. Entries
        // pointing at missing spöbs were already dropped with a warning by
        // JunkParse, so a silent drop shows up as a golden mismatch on
        // boughtAt/soldAt in the goldens below.
        if (goldens.junkIDs) {
            checks += 1;
            var rawJunkIDs = ids.Junk.map(function(junkID) {
                return junkID.slice(junkID.lastIndexOf(":") + 1);
            }).sort();
            var expectedJunkIDs = goldens.junkIDs.slice().sort();
            if (JSON.stringify(rawJunkIDs) !== JSON.stringify(expectedJunkIDs)) {
                failures.push("jünk ids: expected " + JSON.stringify(expectedJunkIDs)
                    + ", got " + JSON.stringify(rawJunkIDs));
            }
        }

        for (var junkID of ids.Junk) {
            var junkData = await novaParse.data[NovaDataType.Junk].get(junkID);
            for (var soldRef of junkData.soldAt) {
                if (!ids.Planet.includes(soldRef)) {
                    checks += 1;
                    failures.push("jünk " + junkID + " soldAt points at missing spöb " + soldRef);
                }
            }
            for (var boughtRef of junkData.boughtAt) {
                if (!ids.Planet.includes(boughtRef)) {
                    checks += 1;
                    failures.push("jünk " + junkID + " boughtAt points at missing spöb " + boughtRef);
                }
            }
        }

        // përs: every AI-person must resolve its references, and its comm/hail
        // quotes must fit inside the STR# 7100/7101 tables (both are 1-based;
        // <= 0 means "no quote").
        var persQuoteSets: { [suffix: string]: StringSetData | undefined } = {};
        for (var stringSetID of ids.StringSet) {
            if (stringSetID.endsWith(":7100")) {
                persQuoteSets["7100"] = await novaParse.data[NovaDataType.StringSet].get(stringSetID);
            }
            else if (stringSetID.endsWith(":7101")) {
                persQuoteSets["7101"] = await novaParse.data[NovaDataType.StringSet].get(stringSetID);
            }
        }

        for (var persID of ids.Pers) {
            var pers = await novaParse.data[NovaDataType.Pers].get(persID);
            var persRefs: Array<[string, string | null, NovaDataType]> = [
                ["govt", pers.govt, NovaDataType.Government],
                ["shipType", pers.shipType, NovaDataType.Ship],
                ["linkMission", pers.linkMission, NovaDataType.Mission],
            ];
            for (var [persRefField, persRef, persRefType] of persRefs) {
                if (persRef !== null && !ids[persRefType].includes(persRef)) {
                    checks += 1;
                    failures.push("përs " + persID + " " + persRefField + " points at missing " + persRefType + " " + persRef);
                }
            }

            for (var weapType of pers.weapTypes) {
                if (weapType !== null && !ids.Weapon.includes(weapType)) {
                    checks += 1;
                    failures.push("përs " + persID + " points at missing wëap " + weapType);
                }
            }

            var persQuotes: Array<[string, number, string]> = [
                ["commQuote", pers.commQuote, "7100"],
                ["hailQuote", pers.hailQuote, "7101"],
            ];
            for (var [quoteField, quote, quoteSuffix] of persQuotes) {
                if (quote <= 0) {
                    continue;
                }
                checks += 1;
                var quoteSet = persQuoteSets[quoteSuffix];
                if (!quoteSet) {
                    failures.push("përs " + persID + " " + quoteField + " is set but STR# " + quoteSuffix + " is missing");
                }
                else if (quote > quoteSet.strings.length) {
                    failures.push("përs " + persID + " " + quoteField + " " + quote + " is out of range for STR# " + quoteSuffix + " (" + quoteSet.strings.length + " strings)");
                }
            }
        }
    }
    finally {
        console.warn = originalWarn;
    }

    return {
        passed: failures.length === 0,
        checks,
        failures,
        warnings,
    };
}
