// The hail/board event + guard resources, in their own leaf module:
// interaction_plugin.ts emits them from the control systems, while
// mission_ship_plugin.ts listens for BoardedEvent — a shared module keeps
// that dependency one-way (both sides need the bindings at module-eval
// time, so importing them from each other would be a load-order cycle).
import { EcsEvent } from "nova_ecs/events";
import { Resource } from "nova_ecs/resource";

// A ship was hailed (the target uuid; the player cannot hail themselves).
export const HailEvent = new EcsEvent<{ target: string }>('HailEvent');

// The player boarded a disabled ship in range.
export const BoardedEvent = new EcsEvent<{ target: string }>('BoardedEvent');

// True while a comm/briefing dialog is open: hail and board are ignored so
// dialog keys cannot leak into flight systems (and flight keys into the
// dialog). The dialog flow sets/clears it around its show() calls.
export const CommOpenResource = new Resource<{ open: boolean }>('CommOpenResource');
