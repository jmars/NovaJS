// Headless specs for the düde probability table (P6).

import "jasmine";
import { getDefaultDudeData } from "novadatainterface/DudeData";
import { makeRng } from "../player/pilot_files";
import { rollDudeType } from "./dude";

describe('rollDudeType', () => {
    const dude = {
        ...getDefaultDudeData(),
        shipTypes: [
            { ship: 'test:128', probability: 40 },
            { ship: 'test:129', probability: 20 },
            { ship: null, probability: 0 },  // empty slot: never drawn
            { ship: 'test:130', probability: 40 },
        ],
    };

    it('is deterministic under a fixed seed', () => {
        const draw = () => [...Array(20)].map((_, i) => rollDudeType(dude, makeRng(1234 + i)));
        expect(draw()).toEqual(draw());
    });

    it('follows the probability table', () => {
        const counts = new Map<string, number>();
        const rolls = 20000;
        const rng = makeRng(42);
        for (let i = 0; i < rolls; i++) {
            const ship = rollDudeType(dude, rng)!;
            counts.set(ship, (counts.get(ship) ?? 0) + 1);
        }
        // Spot checks well inside any rng noise band.
        expect(counts.get('test:128')! / rolls).toBeCloseTo(0.4, 2);
        expect(counts.get('test:129')! / rolls).toBeCloseTo(0.2, 2);
        expect(counts.get('test:130')! / rolls).toBeCloseTo(0.4, 2);
    });

    it('returns null when the roll falls past the table', () => {
        const sparse = {
            ...getDefaultDudeData(),
            shipTypes: [{ ship: 'test:128', probability: 30 }],
        };
        const rng = makeRng(7);
        let misses = 0;
        for (let i = 0; i < 1000; i++) {
            if (rollDudeType(sparse, rng) === null) {
                misses++;
            }
        }
        // ~70% of rolls land past the 30% entry: no ship spawns.
        expect(misses).toBeGreaterThan(600);
    });
});
