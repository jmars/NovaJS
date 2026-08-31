// Dudes (düdé ship-class groups): the probability table over ship types and
// the ship factory for dude-spawned NPCs — mission special/aux ships (P6)
// and flëts share it.
//
// Dude AIType 1-4 (wimpy trader .. interceptor) map onto the distinct AI
// behaviors in npc_ai_plugin (trader travel, Coward fleeing, Aggress-range
// targeting); the generic chase-and-shoot NPC AI from npc_plugin stays as
// the combat building block underneath.

import { Component } from "nova_ecs/component";
import { DudeData } from "novadatainterface/DudeData";
import { ShipData } from "novadatainterface/ShipData";
import { Entity } from "nova_ecs/entity";
import { CollisionVulnerabilityComponent } from "./collision_interaction";
import { AIConfigComponent, AIStateComponent } from "./npc_ai_plugin";
import { ChooseRandomTargetComponent, GovernmentComponent, makeNpc } from "./npc_plugin";
import { randInt } from "../player/pilot_files";

export { GovernmentComponent };

// What boarding this ship yields (consumed by the boarding resolver,
// missions/boarding.ts): the dude it spawned from, the booty bitmask
// (0x0040 money, 0x0001-0x0020 commodities, 0 = repelled) and the
// government to apply boarding penalties against. `plundered` latches the
// first board so a disabled hulk cannot be farmed.
export const BoardingProfileComponent = new Component<{
    dudeId: string | null,
    booty: number,
    govtId: string | null,
    plundered: boolean,
}>('BoardingProfile');

// Rolls one ship global id from the dude's probability table (entries are
// percentages; EV Nova walks them cumulatively). Returns null when the roll
// lands past the table — that spawn produces no ship.
export function rollDudeType(dude: DudeData, rng: () => number): string | null {
    let roll = rng() * 100;
    for (const entry of dude.shipTypes) {
        roll -= entry.probability;
        if (roll < 0) {
            return entry.ship;
        }
    }
    return null;
}

// FUN_0046b600/FUN_0046b4b0's total-weight pick: one rand(totalWeight)
// draw walked cumulatively over the entries. Unlike rollDudeType (mïsn
// percentage tables), the sÿst dûde-pair and dûde ship-class tables hold
// raw counts, so the draw scales by the weight total. Entries with a null
// value or a non-positive weight are excluded from the total (the binary
// validates dûde ship classes against the shïp table before drawing).
// Returns null — without drawing — when the total weight is under 1, which
// makes that spawn produce no ship.
export function weightedPick<T>(entries: Array<{ value: T; weight: number }>): T | null {
    let total = 0;
    for (const entry of entries) {
        if (entry.value !== null && entry.weight > 0) {
            total += entry.weight;
        }
    }
    if (total < 1) {
        return null;
    }
    let roll = randInt(total);
    for (const entry of entries) {
        if (entry.value === null || entry.weight <= 0) {
            continue;
        }
        roll -= entry.weight;
        if (roll < 0) {
            return entry.value;
        }
    }
    return null;
}

// Dude flag 0x0100 (and mïsn aux-ship flag 0x0100): the ship cannot be hit
// — nothing is vulnerable to any collision class.
export function setNoCollision(ship: Entity): void {
    ship.components.set(CollisionVulnerabilityComponent, {
        vulnerableTo: new Set<unknown>(),
    });
}

// Builds an NPC ship for a dude (`dude` null = a plain fleet lead ship):
// makeShip + the NPC AI components + a govt tag + the AIType config and
// boarding profile. `aggress` pins the AIConfig aggress WITHOUT drawing
// (the përs path: FUN_004235c0 reads the clamped përs value, no roll —
// only dûdes FUN_0041ba80 and fleets/mïsn FUN_004254b0 roll rand(3)^2).
export function makeDudeShip(dude: DudeData | null, shipData: ShipData,
    govtId: string | null = dude?.govt ?? null,
    aggress?: number): Entity {
    const ship = makeNpc(shipData);
    if (govtId) {
        ship.components.set(GovernmentComponent, { id: govtId });
    }
    if (dude && (dude.flags & 0x0100) !== 0) {
        setNoCollision(ship);
    }

    const aiType = dude
        ? (dude.aiType || shipData.inherentAI)
        : (shipData.inherentAI || 0);
    // FUN_004254b0/FUN_0041ba80 roll aggress per spawn: rand(3) ^ 2 is
    // {2, 3, 0} uniform. The flee threshold derives from it (FleeSystem);
    // the përs pass their own in pers_plugin.
    ship.components.set(AIConfigComponent, {
        aiType,
        aggress: aggress ?? randInt(3) ^ 2,
        coward: null,
    });
    ship.components.set(AIStateComponent, {
        anger: 0,
        attackedBy: null,
        fleeing: false,
    });
    // AI ships acquire through the FUN_0040e020 scan only; the legacy
    // random-target layer stays for aiType 0 (FIDELITY row 52).
    if (aiType >= 1) {
        ship.components.delete(ChooseRandomTargetComponent);
    }
    ship.components.set(BoardingProfileComponent, {
        dudeId: dude?.id ?? null,
        booty: dude?.booty ?? 0,
        govtId,
        plundered: false,
    });
    return ship;
}
