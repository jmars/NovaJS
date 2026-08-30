// Pure flët hyperspace-entry quote resolution (Nova Bible flët ~888-930):
// the Quote field is a STR# resource id; when the fleet enters from
// hyperspace a random string from the set is picked and every '#' in it is
// replaced with a random digit (0-9). There is no generic message surface
// yet, so this stays a headless resolver — the caller decides what to do
// with the text.

import { StringSetData } from "novadatainterface/StringSetData";

export function fleetQuote(quoteStrId: number,
    strings: string[] | null | undefined, rng: () => number): string | null {
    if (quoteStrId < 0 || !strings || strings.length === 0) {
        return null;
    }
    const text = strings[Math.floor(rng() * strings.length)];
    return text.replace(/#/g, () => String(Math.floor(rng() * 10)));
}

// Same resolution over a (possibly missing) STR# set, e.g. the result of
// gameData.data.StringSet.get(...).
export function fleetQuoteFromSet(quoteStrId: number,
    set: StringSetData | null | undefined, rng: () => number): string | null {
    return fleetQuote(quoteStrId, set?.strings, rng);
}
