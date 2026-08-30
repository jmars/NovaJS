// Pure flët hyperspace-entry quote resolution (Nova Bible flët ~888-930):
// the Quote field is a STR# resource id; when the fleet enters from
// hyperspace a string from the set is picked and every '#' in it is
// replaced with random digits. Ported from FUN_004259b0's tail: the FIRST
// '#' of a run becomes rand(9) + '1' (a nonzero digit 1-9) and any
// following '#' in the same run becomes rand(10) + '0' (0-9) — so "# of #
// ships" reads naturally. There is no generic message surface yet, so this
// stays a headless resolver — the caller decides what to do with the text.

import { randInt } from "../player/pilot_files";
import { StringSetData } from "novadatainterface/StringSetData";

export function fleetQuote(quoteStrId: number,
    strings: string[] | null | undefined): string | null {
    if (quoteStrId < 0 || !strings || strings.length === 0) {
        return null;
    }
    const text = strings[randInt(strings.length)];
    let afterDigit = false;
    let out = "";
    for (const ch of text) {
        if (ch === "#") {
            out += afterDigit ? String(randInt(10))
                : String(randInt(9) + 1);
            afterDigit = true;
        } else {
            out += ch;
            afterDigit = false;
        }
    }
    return out;
}

// Same resolution over a (possibly missing) STR# set, e.g. the result of
// gameData.data.StringSet.get(...).
export function fleetQuoteFromSet(quoteStrId: number,
    set: StringSetData | null | undefined): string | null {
    return fleetQuote(quoteStrId, set?.strings);
}
