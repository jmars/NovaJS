// Headless specs for applyOutfitPhysics. Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/outfit_plugin_test.ts \
//       --outfile=/tmp/op.js && node_modules/.bin/jasmine /tmp/op.js
//
// Sign rules under test: an outfit's physics.freeMass is the mass/space it
// CONSUMES (purchase.ts freeMassOf is the documented reference), and
// ShipParse pre-adds the mass of a ship's preinstalled outfits into
// ShipPhysics.freeMass, so applyOutfitPhysics must SUBTRACT the carried
// outfits' freeMass from the base (otherwise preinstalled outfits would be
// double-counted with the wrong sign). Every other physics field is a
// genuine bonus and keeps its add semantics (freeCargo included — ShipParse
// leaves freeCargo raw).

import { getDefaultOutfitData, OutfitData } from "novadatainterface/OutiftData";
import { getDefaultShipPhysics, ShipPhysics } from "novadatainterface/ShipData";
import { freeMassOf } from "../spaceport/purchase";
import { applyOutfitPhysics } from "./outfit_plugin";


// Light Blaster: freeMass 3 — the space it consumes.
function lightBlaster(id = "nova:blaster"): OutfitData {
    return {
        ...getDefaultOutfitData(),
        id,
        name: id,
        physics: { freeMass: 3 },
    };
}

// Consumes mass but also carries genuine stat bonuses and a cargo bay.
function afterburner(id = "nova:burner"): OutfitData {
    return {
        ...getDefaultOutfitData(),
        id,
        name: id,
        physics: { freeMass: 5, shield: 20, speed: 50, freeCargo: 10 },
    };
}

const carrying = (...outfits: OutfitData[]) =>
    outfits.map(outfit => [outfit, 1] as const);

// Shuttle-like base: freeSpace 11 plus one preinstalled Light Blaster (3),
// exactly how ShipParse.ts builds ShipData.physics.freeMass.
function shuttleBase(): ShipPhysics {
    return {
        ...getDefaultShipPhysics(),
        freeMass: 11 + 3,
        shield: 100,
        speed: 250,
        freeCargo: 20,
    };
}


describe("applyOutfitPhysics", () => {
    it("subtracts carried outfit mass so preinstalled ships get true free space", () => {
        const base = shuttleBase();
        const result = applyOutfitPhysics(base, carrying(lightBlaster()));

        // 14 base (11 free + 3 preinstalled) - 3 for the same blaster = 11.
        expect(result.freeMass).toBe(11);
        // Agrees with the documented reference, purchase.freeMassOf.
        expect(result.freeMass).toBe(freeMassOf(base.freeMass,
            new Map([["nova:blaster", { count: 1 }]]),
            id => id === "nova:blaster" ? 3 : null));
    });

    it("subtracts once per copy when several are carried", () => {
        const base = shuttleBase();
        const result = applyOutfitPhysics(base, [[lightBlaster(), 2] as const]);
        expect(result.freeMass).toBe(14 - 3 * 2);
    });

    it("still adds genuine bonus fields like shield and speed", () => {
        const result = applyOutfitPhysics(shuttleBase(), carrying(afterburner()));
        expect(result.shield).toBe(100 + 20);
        expect(result.speed).toBe(250 + 50);
        // The bonus outfit's mass is still consumed.
        expect(result.freeMass).toBe(14 - 5);
    });

    it("keeps add semantics for freeCargo modifications", () => {
        const result = applyOutfitPhysics(shuttleBase(), carrying(afterburner()));
        expect(result.freeCargo).toBe(20 + 10);
    });

    it("ignores outfit physics keys the base doesn't have", () => {
        const sparse = { freeMass: 14 } as ShipPhysics;
        const result = applyOutfitPhysics(sparse, carrying(afterburner()));
        expect(result.freeMass).toBe(14 - 5);
        expect("shield" in result).toBeFalse();
    });

    it("does not mutate the base physics", () => {
        const base = shuttleBase();
        applyOutfitPhysics(base, carrying(afterburner()));
        expect(base.freeMass).toBe(14);
        expect(base.shield).toBe(100);
    });
});
