// The pilot's stable identifier. The multiplayer communicator used to supply
// a per-connection uuid that keyed the server pilot file and the localStorage
// mirror; with the relay gone, the pilot uuid is generated once, stored in
// localStorage, and adopted from a lone legacy mirror key so existing pilots
// survive the refactor. Headless environments without storage get an
// ephemeral uuid.

import { v4 } from "uuid";

// localStorage key holding the pilot uuid.
export const PILOT_UUID_KEY = "novajs-pilot-uuid";

// Minimal storage surface this module needs; satisfied by DOM Storage and by
// test stubs.
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

// KeyValueStorage plus the enumeration surface of DOM Storage, needed to
// discover legacy mirror keys.
export interface EnumerableStorage extends KeyValueStorage {
    readonly length: number;
    key(index: number): string | null;
}

// Legacy mirror keys are "novajs-pilot-<uuid>" (pilotMirrorKey in
// browser.ts); the mirrored value is the pilot file JSON, which does not
// embed the uuid, so adoption reads it from the key name. The new
// PILOT_UUID_KEY shares the prefix, hence the lookahead.
const LEGACY_PILOT_KEY_PATTERN = /^novajs-pilot-(?!uuid)/;
const LEGACY_PILOT_KEY_PREFIX = "novajs-pilot-";

// Communicator-assigned pilot uuids were v4s.
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The keys still holding mirrored pilot state, i.e. every
// "novajs-pilot-*" key except PILOT_UUID_KEY itself.
export function findLegacyPilotKeys(storage: EnumerableStorage): string[] {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null && LEGACY_PILOT_KEY_PATTERN.test(key)) {
            keys.push(key);
        }
    }
    return keys;
}

// Returns the stored pilot uuid, adopting the single legacy mirror key's
// uuid when migrating, else generating and storing a fresh v4. With no
// storage available (headless), returns an ephemeral v4 that is not
// persisted.
export function getOrCreatePilotUuid(storage?: KeyValueStorage): string {
    const store = storage ?? browserStorage();
    if (!store) {
        return v4();
    }

    const stored = store.getItem(PILOT_UUID_KEY);
    if (stored !== null) {
        return stored;
    }

    // First run after the refactor: a lone legacy mirror key names the one
    // pilot this browser had; adopting its uuid keeps that pilot loadable
    // from its mirror. Zero or several legacy keys is ambiguous, and a
    // non-uuid suffix is unusable, so start a fresh pilot instead.
    const enumerable = asEnumerable(store);
    const legacy = enumerable ? findLegacyPilotKeys(enumerable) : [];
    if (legacy.length === 1) {
        const uuid = legacy[0].slice(LEGACY_PILOT_KEY_PREFIX.length);
        if (UUID_PATTERN.test(uuid)) {
            store.setItem(PILOT_UUID_KEY, uuid);
            return uuid;
        }
    }

    const uuid = v4();
    store.setItem(PILOT_UUID_KEY, uuid);
    return uuid;
}

// localStorage, when it exists. Merely touching localStorage can throw
// (storage-denying browser settings), and it is undefined in node.
function browserStorage(): EnumerableStorage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    }
    catch {
        return undefined;
    }
}

// DOM Storage and good test stubs are enumerable; a bare {getItem,setItem}
// pair is not and skips legacy adoption.
function asEnumerable(storage: KeyValueStorage): EnumerableStorage | undefined {
    const maybe = storage as Partial<EnumerableStorage>;
    if (typeof maybe.length === "number" && typeof maybe.key === "function") {
        return storage as EnumerableStorage;
    }
    return undefined;
}
