// Ship-snapshot specs (Phase 5): the pilot's ship type + outfits round-trip
// through PlayerState.shipSnapshot, foreign/corrupt/stale snapshots degrade
// to null + warn instead of throwing, and PlayerStateComponent never enters
// the snapshot (the state carries the snapshot, so encoding it would
// recurse). Run with:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/ship_snapshot_test.ts \
//       --outfile=/tmp/sn.js && node_modules/.bin/jasmine /tmp/sn.js

import "jasmine";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { makePlayerState } from "../missions/test_fixtures";
import { PlayerStateComponent } from "../player/player_state_component";
import { OutfitsStateComponent } from "./outfit_plugin";
import {
    decodeShipSnapshot,
    encodeShipSnapshot,
    SNAPSHOT_COMPONENTS,
} from "./ship_snapshot";
import { ShipComponent } from "./ship_plugin";

const SHIP_ID = "nova:600";
const OUTFITS = new Map([
    ["nova:200", { count: 2 }],
    ["nova:201", { count: 1 }],
]);

function makeGameData(): MockGameData {
    const gameData = new MockGameData();
    // MockGameData.ids reads the mock maps, so an unknown ship id is one
    // that was never put into the map (the stale-snapshot case).
    gameData.data.Ship.map.set(SHIP_ID, {
        ...getDefaultShipData(),
        id: SHIP_ID,
        name: "Player Ship",
    });
    return gameData;
}

// A fully-loaded player ship: the snapshottable components plus the
// transient ones that must stay out of the snapshot.
function makePlayerShip(): Entity {
    const ship = new Entity("Player Ship");
    ship.components.set(ShipComponent, { id: SHIP_ID });
    ship.components.set(OutfitsStateComponent, new Map(OUTFITS));
    ship.components.set(PlayerStateComponent, makePlayerState());
    ship.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(100, 200),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });
    return ship;
}

describe("ship snapshot", () => {
    it("whitelists exactly the ship and outfits components", () => {
        expect(SNAPSHOT_COMPONENTS).toEqual([ShipComponent,
            OutfitsStateComponent]);
    });

    it("round-trips the ship type and outfits", async () => {
        const entity = makePlayerShip();
        const snapshot = encodeShipSnapshot(entity);
        expect(snapshot).not.toBeNull();

        const decoded = await decodeShipSnapshot(snapshot, makeGameData());
        expect(decoded).not.toBeNull();
        expect(decoded!.name).toEqual("Player Ship");
        expect(decoded!.components.get(ShipComponent)).toEqual({ id: SHIP_ID });
        expect(decoded!.components.get(OutfitsStateComponent))
            .toEqual(OUTFITS);
    });

    it("survives the pilot file's JSON round-trip", async () => {
        const snapshot = encodeShipSnapshot(makePlayerShip())!;
        const fromFile = JSON.parse(JSON.stringify(snapshot));

        const decoded = await decodeShipSnapshot(fromFile, makeGameData());
        expect(decoded!.components.get(ShipComponent)).toEqual({ id: SHIP_ID });
        expect(decoded!.components.get(OutfitsStateComponent))
            .toEqual(OUTFITS);
    });

    it("excludes PlayerStateComponent and other transient components", () => {
        const snapshot = encodeShipSnapshot(makePlayerShip())!;
        const names = snapshot.components.map(([name]) => name);
        expect(names).toEqual(["Ship", "OutfitsStateComponent"]);
    });

    it("restores an entity without transient components", async () => {
        const decoded = (await decodeShipSnapshot(
            encodeShipSnapshot(makePlayerShip()), makeGameData()))!;
        expect(decoded.components.has(PlayerStateComponent)).toBeFalse();
        expect(decoded.components.has(MovementStateComponent)).toBeFalse();
    });

    it("skips unknown components on decode (forward compatibility)", async () => {
        const snapshot = {
            name: "Future Ship",
            components: [
                ["Ship", { id: SHIP_ID }],
                ["BrandNewFutureComponent", { anyAsset: true }],
                ["AnotherUnknownComponent", null],
            ],
        };

        const decoded = await decodeShipSnapshot(snapshot, makeGameData());
        expect(decoded).not.toBeNull();
        expect(decoded!.components.get(ShipComponent)).toEqual({ id: SHIP_ID });
        expect(decoded!.components.size).toEqual(1);
    });

    it("returns null (not a throw) for corrupt snapshots", async () => {
        spyOn(console, "warn");
        const gameData = makeGameData();

        for (const corrupt of [
            null,
            "garbage",
            {},
            { components: "nope" },
            { components: [["Ship", { id: 42 }]] }, // ship id is not a string
            { components: [["OutfitsStateComponent", "junk"]] },
            { components: [] }, // decodes but has no ship
        ]) {
            expect(await decodeShipSnapshot(corrupt, gameData))
                .withContext(JSON.stringify(corrupt)).toBeNull();
        }
        expect(console.warn).toHaveBeenCalled();
    });

    it("returns null for a snapshot of an unknown ship id", async () => {
        spyOn(console, "warn");
        const stale = {
            components: [["Ship", { id: "nova:99999" }]],
            name: "Gone",
        };
        expect(await decodeShipSnapshot(stale, makeGameData())).toBeNull();
        expect(console.warn).toHaveBeenCalled();
    });

    it("encodes to null for an entity without a ship", () => {
        spyOn(console, "warn");
        const notAShip = new Entity("Planet");
        expect(encodeShipSnapshot(notAShip)).toBeNull();
        expect(console.warn).toHaveBeenCalled();
    });
});
