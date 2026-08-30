// Ship-snapshot save/restore (P5): the player's ship type and installed
// outfits ride in PlayerState.shipSnapshot (an EncodedEntity) so an
// outfitted or shipyard-swapped ship survives a reload. encodeShipSnapshot
// is called at every persistence point (game start, landing, jump);
// decodeShipSnapshot rebuilds the ship entity on boot and never throws -
// a corrupt, stale or unknown snapshot degrades to the chär's starting
// ship instead of bricking the pilot.

import { isLeft } from 'fp-ts/Either';
import { GameDataInterface } from 'novadatainterface/GameDataInterface';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { EncodedEntity, Serializer } from 'nova_ecs/plugins/serializer_plugin';
import { OutfitsState, OutfitsStateComponent } from './outfit_plugin';
import { ShipComponent, ShipType } from './ship_plugin';

// The components worth persisting. PlayerStateComponent must stay out: the
// state carries the snapshot itself, so encoding it would recurse.
// Everything else on a ship entity (MovementState, ShipData, health stats,
// selectors) is re-derived from ShipComponent by the providers when the
// restored entity enters a world.
// Component<any> (not UnknownComponent) because Component is invariant in
// its data type: the whitelist must accept both component kinds.
export const SNAPSHOT_COMPONENTS: readonly Component<any>[] = [
    ShipComponent,
    OutfitsStateComponent,
];

// Codecs for exactly the whitelist, registered the same way
// DeltaMaker.addComponent does. Snapshots are encoded/decoded with this
// serializer instead of the world's SerializerResource because the
// browser's outer world never loads ShipPlugin/OutfitPlugin - a snapshot
// taken there would silently encode no components. Decoding skips any
// component name this serializer does not know, so snapshots written by
// newer versions stay loadable here (and vice versa).
const snapshotSerializer = new Serializer();
snapshotSerializer.addComponent(ShipComponent, ShipType);
snapshotSerializer.addComponent(OutfitsStateComponent, OutfitsState);

/**
 * Encodes the whitelisted ship components of `entity` as a ship snapshot.
 * Returns null (and warns) when the entity has no ShipComponent or its
 * components fail to encode; callers keep the previous snapshot in that
 * case.
 */
export function encodeShipSnapshot(entity: Entity): EncodedEntity | null {
    if (!entity.components.has(ShipComponent)) {
        console.warn('encodeShipSnapshot: entity has no Ship; not snapshotting');
        return null;
    }

    const snapshot = new Entity(entity.name);
    for (const component of SNAPSHOT_COMPONENTS) {
        const data = entity.components.get(component);
        if (data !== undefined) {
            snapshot.components.set(component, data);
        }
    }

    try {
        return snapshotSerializer.encode(snapshot);
    }
    catch (e) {
        console.warn('encodeShipSnapshot: failed to encode ship snapshot', e);
        return null;
    }
}

/**
 * Rebuilds a ship entity from a snapshot. Unknown component names are
 * skipped (forward compatibility); a corrupt snapshot, one without a ship,
 * or one whose ship id no longer exists in the game data returns null with
 * a warning instead of throwing.
 */
export async function decodeShipSnapshot(encoded: unknown,
    gameData: GameDataInterface): Promise<Entity | null> {
    try {
        const decoded = snapshotSerializer.decode(encoded);
        if (isLeft(decoded)) {
            console.warn('decodeShipSnapshot: corrupt ship snapshot',
                decoded.left);
            return null;
        }
        const entity = decoded.right;

        const ship = entity.components.get(ShipComponent);
        if (!ship) {
            console.warn('decodeShipSnapshot: snapshot has no Ship');
            return null;
        }

        // A snapshot can outlive the data that produced it (changed plugin
        // set, downgraded data). Trusting an unknown ship id would leave the
        // pilot on a ship the game cannot build.
        const ids = await gameData.ids;
        if (!ids.Ship.includes(ship.id)) {
            console.warn(`decodeShipSnapshot: unknown ship id ${ship.id}; `
                + 'ignoring stale snapshot');
            return null;
        }

        return entity;
    }
    catch (e) {
        console.warn('decodeShipSnapshot: failed to decode ship snapshot', e);
        return null;
    }
}

/**
 * Convenience for write points: snapshots `entity` into
 * `playerState.shipSnapshot`, keeping the previous snapshot when the
 * entity has no ship to encode. Returns whether a new snapshot was stored.
 */
export function snapshotPlayerShip(entity: Entity,
    playerState: { shipSnapshot: EncodedEntity | null }): boolean {
    const snapshot = encodeShipSnapshot(entity);
    if (!snapshot) {
        return false;
    }
    playerState.shipSnapshot = snapshot;
    return true;
}
