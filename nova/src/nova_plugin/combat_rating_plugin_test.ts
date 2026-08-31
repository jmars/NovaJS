// Headless World specs for the combat rating plugin (P7): the ränk 0x0004
// interplay when the player's target ship is disabled (DisabledEvent —
// armor 0, the window before the death explosion) or destroyed
// (DeathEvent). Drives the real damage path (DamageSystem → ZeroArmorEvent
// → the exploding latch → DisabledEvent), with a hand-set clock (no
// TimePlugin) so the deathDelay window is deterministic.

import "jasmine";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { Entity } from "nova_ecs/entity";
import { Time, TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { MissionEnvResource } from "../missions/mission_plugin";
import { makePlayerState, makeRank, makeTestEnv } from "../missions/test_fixtures";
import { PlayerState } from "../player/player_state";
import { PlayerStateResource } from "../player/player_state_component";
import { CombatRatingPlugin } from "./combat_rating_plugin";
import { DamagedEvent, DeathPlugin } from "./death_plugin";
import { GovernmentComponent } from "./dude";
import { ArmorComponent } from "./health_plugin";
import { PlayerShipSelector } from "./player_ship_plugin";
import { ShipDataComponent } from "./ship_plugin";
import { Stat } from "./stat";
import { TargetComponent } from "./target_component";

const FEDERATION = "nova:128";
const ALLY = "nova:129";
const DEATH_DELAY = 10; // ShipData deathDelay, seconds.

// A Federation 0x0004 rank and its ally's: a Federation ship loss strips
// both (the alliance counts in both directions — legal_status.ts).
const FED_RANK = makeRank("nova:442", FEDERATION, 1, 0x0004);
const ALLY_RANK = makeRank("nova:443", ALLY, 1, 0x0004);

function makeNpcShip(name: string, govtId: string): Entity {
    const ship = new Entity(name);
    ship.components.set(ShipDataComponent,
        { ...getDefaultShipData(), deathDelay: DEATH_DELAY });
    ship.components.set(ArmorComponent,
        new Stat({ current: 100, max: 100, min: 0, recharge: 0 }));
    ship.components.set(GovernmentComponent, { id: govtId });
    return ship;
}

function makePlayerShip(target: string | undefined): Entity {
    const ship = new Entity("Player Ship");
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(TargetComponent, { target });
    return ship;
}

async function makeTestWorld(): Promise<{
    world: World;
    state: PlayerState;
    time: Time;
    player: Entity;
    npc: Entity;
}> {
    const { env } = makeTestEnv();
    const myRanks = new Map([[FED_RANK.id, FED_RANK], [ALLY_RANK.id, ALLY_RANK]]);
    env.rank = id => myRanks.get(id) ?? null;
    const state = makePlayerState();

    const world = new World();
    world.resources.set(PlayerStateResource, state);
    world.resources.set(MissionEnvResource, env);
    const time: Time = { time: 1000, delta_ms: 0, delta_s: 0, frame: 0 };
    world.resources.set(TimeResource, time);

    const npc = makeNpcShip("Federation Ship", FEDERATION);
    world.entities.set("federation ship", npc);
    const player = makePlayerShip(npc.uuid);
    world.entities.set("player ship", player);

    world.addPlugin(DeathPlugin);
    world.addPlugin(CombatRatingPlugin);
    return { world, state, time, player, npc };
}

// One 100-armor hit: the real disable path (DamageSystem → ZeroArmorEvent
// → ExplodingComponent latch → DisabledEvent → PlayerDisableSystem).
function hit(world: World, npc: Entity): void {
    world.emit(DamagedEvent, {
        damage: {
            shield: 0,
            armor: 100,
            ionization: 0,
            ionizationColor: 0,
            passThroughShield: 0,
            knockback: 0,
        },
        damager: "player ship",
    }, [npc.uuid]);
    world.step();
}

describe("combat rating plugin", () => {
    it("strips 0x0004 ranks when the player disables a govt ship", async () => {
        const { world, state, npc } = await makeTestWorld();
        state.activeRanks.push(FED_RANK.id, ALLY_RANK.id);

        hit(world, npc);

        expect(npc.components.get(ArmorComponent)!.current).toEqual(0);
        expect(state.activeRanks).toEqual([]);
        // A disable is not a kill: the ship is still a live hulk here.
        expect(state.combatRating).toEqual(0);
    });

    it("ignores disables of ships the player is not targeting", async () => {
        const { world, state, player, npc } = await makeTestWorld();
        state.activeRanks.push(FED_RANK.id);
        player.components.set(TargetComponent, { target: undefined });

        hit(world, npc);

        expect(npc.components.get(ArmorComponent)!.current).toEqual(0);
        expect(state.activeRanks).toEqual([FED_RANK.id]);
    });

    it("still counts the kill when the disabled ship is destroyed", async () => {
        const { world, state, time, npc } = await makeTestWorld();
        state.activeRanks.push(FED_RANK.id);
        hit(world, npc);
        expect(state.activeRanks).toEqual([]);

        // Let the death explosion finish (deathDelay past the disable).
        time.time += DEATH_DELAY * 1000 + 1;
        world.step();

        expect(state.combatRating).toEqual(1);
        expect(state.activeRanks).toEqual([]);
    });

    it("does not double-fire the disable before the ship is destroyed",
        async () => {
            const { world, state, time, npc } = await makeTestWorld();
            state.activeRanks.push(FED_RANK.id);
            hit(world, npc);
            expect(state.activeRanks).toEqual([]);

            // Re-activate the rank and hit the still-exploding hulk again:
            // the exploding latch must suppress a second disable.
            state.activeRanks.push(FED_RANK.id);
            hit(world, npc);
            expect(state.activeRanks).toEqual([FED_RANK.id]);

            // The eventual death strips it once more (destroy half) and
            // counts exactly one kill.
            time.time += DEATH_DELAY * 1000 + 1;
            world.step();
            expect(state.combatRating).toEqual(1);
            expect(state.activeRanks).toEqual([]);
        });
});
