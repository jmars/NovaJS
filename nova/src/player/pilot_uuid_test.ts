import "jasmine";
import { v4 } from "uuid";
import {
    EnumerableStorage,
    findLegacyPilotKeys,
    getOrCreatePilotUuid,
    PILOT_UUID_KEY,
} from "./pilot_uuid";


// Map-backed storage stub with the same surface as DOM Storage.
class MapStorage implements EnumerableStorage {
    private readonly map = new Map<string, string>();

    getItem(key: string): string | null {
        return this.map.has(key) ? this.map.get(key)! : null;
    }

    setItem(key: string, value: string): void {
        this.map.set(key, String(value));
    }

    get length(): number {
        return this.map.size;
    }

    key(index: number): string | null {
        const keys = [...this.map.keys()];
        return keys[index] ?? null;
    }
}

// A v4 uuid with a version-4 nibble and a valid variant.
const V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEGACY_UUID = "01234567-89ab-4cde-8f01-23456789abcd";
const OTHER_UUID = "fedcba98-7654-4321-8abc-def012345678";

function legacyKey(uuid: string): string {
    return "novajs-pilot-" + uuid;
}

describe("getOrCreatePilotUuid", function() {
    let storage: MapStorage;

    beforeEach(function() {
        storage = new MapStorage();
    });

    it("generates a fresh v4 and stores it on first call", function() {
        const uuid = getOrCreatePilotUuid(storage);
        expect(V4_PATTERN.test(uuid)).toBeTrue();
        expect(storage.getItem(PILOT_UUID_KEY)).toEqual(uuid);
        expect(storage.length).toEqual(1);
    });

    it("returns the same uuid on repeat calls", function() {
        const first = getOrCreatePilotUuid(storage);
        const second = getOrCreatePilotUuid(storage);
        expect(second).toEqual(first);
        expect(storage.length).toEqual(1);
    });

    it("returns an already-stored uuid untouched", function() {
        storage.setItem(PILOT_UUID_KEY, LEGACY_UUID);
        expect(getOrCreatePilotUuid(storage)).toEqual(LEGACY_UUID);
        expect(storage.length).toEqual(1);
    });

    it("adopts a single legacy mirror key's uuid", function() {
        // The mirror value is the pilot file JSON; the uuid lives in the key.
        storage.setItem(legacyKey(LEGACY_UUID), "{\"version\":1}");
        expect(getOrCreatePilotUuid(storage)).toEqual(LEGACY_UUID);
        expect(storage.getItem(PILOT_UUID_KEY)).toEqual(LEGACY_UUID);
    });

    it("does not treat the pilot-uuid key as a legacy mirror", function() {
        storage.setItem(PILOT_UUID_KEY, LEGACY_UUID);
        storage.setItem("unrelated", "x");
        expect(findLegacyPilotKeys(storage)).toEqual([]);
    });

    it("starts fresh when several legacy keys are ambiguous", function() {
        const other = OTHER_UUID;
        storage.setItem(legacyKey(LEGACY_UUID), "{\"version\":1}");
        storage.setItem(legacyKey(other), "{\"version\":1}");
        const uuid = getOrCreatePilotUuid(storage);
        expect(uuid).not.toEqual(LEGACY_UUID);
        expect(uuid).not.toEqual(other);
        expect(V4_PATTERN.test(uuid)).toBeTrue();
        expect(storage.getItem(PILOT_UUID_KEY)).toEqual(uuid);
    });

    it("starts fresh when the lone legacy key's suffix is not a uuid", function() {
        storage.setItem("novajs-pilot-garbage", "{\"version\":1}");
        const uuid = getOrCreatePilotUuid(storage);
        expect(V4_PATTERN.test(uuid)).toBeTrue();
        expect(storage.getItem(PILOT_UUID_KEY)).toEqual(uuid);
    });

    it("finds only legacy mirror keys", function() {
        storage.setItem(legacyKey(LEGACY_UUID), "x");
        storage.setItem(PILOT_UUID_KEY, "y");
        storage.setItem("novajs-pilot", "not a mirror (no suffix)");
        expect(findLegacyPilotKeys(storage)).toEqual([legacyKey(LEGACY_UUID)]);
    });

    it("returns an ephemeral v4 without storage", function() {
        const first = getOrCreatePilotUuid();
        const second = getOrCreatePilotUuid(undefined);
        expect(V4_PATTERN.test(first)).toBeTrue();
        expect(V4_PATTERN.test(second)).toBeTrue();
        // Ephemeral: not persisted anywhere, so each call is independent.
        expect(second).not.toEqual(first);
    });

    it("falls back to window.localStorage by default", function() {
        const globalAny = globalThis as any;
        globalAny.localStorage = storage;
        try {
            expect(getOrCreatePilotUuid()).toEqual(getOrCreatePilotUuid(storage));
        }
        finally {
            delete globalAny.localStorage;
        }
    });
});
