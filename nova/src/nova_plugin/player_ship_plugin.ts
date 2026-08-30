import { Plugin } from 'nova_ecs/plugin';
import { Component } from "nova_ecs/component";

// Used to mark the single ship that's under control. Set directly by the
// browser on boot and by the shipyard's buyShip; it survives jumps on the
// same entity instance.
export const PlayerShipSelector = new Component<undefined>('ShipControl');

export const PlayerShipPlugin: Plugin = {
    name: 'PlayerShipPlugin',
    build(world) {
        // Selection is now managed directly (browser boot / shipyard), so
        // there is nothing to register here. The plugin stays so existing
        // addPlugin call sites keep working.
    }
};
