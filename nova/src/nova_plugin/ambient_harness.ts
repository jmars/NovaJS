// Side-by-side trace driver for the ambient population model: runs the
// port's real AmbientPlugin (PopulateSystem) in a minimal headless World
// over K population events while fingerprinting the engine LCG stream
// after every frame, then compares the port's observed fingerprints, spawn
// decisions and entity keys against the reference model (ambient_model).
// Test-support only — no runtime code imports this file.
//
// Frame protocol (mirrored by the expected-side replay below): frame 1 is
// the build burst (PopulateResource starts at pending 1, covering the
// jump-in); after each odd frame the harness emits one LandEvent. The
// world's event queue is FIFO, so the queued LandEvent is processed by the
// NEXT frame's flush BEFORE that frame's step systems — the pending
// increment lands in front of PopulateSystem and its burst runs the same
// frame: bursts at frames 1, 2, 4, 6, ... AsyncSystem lands a burst's
// spawn patches one frame later, so a burst at frame f shows up in the
// entity keys at frame f+1. Math.random scatter (warpInAt/makeShip) never
// touches the LCG stream and is outside the comparison; the dûde branch's
// randInt(1500) scatter does — the model replays it.
//
// Two comparison modes:
// - probed (default): after every frame the harness draws one probe
//   rand(0x8000) from the same stream. The LCG advances once per draw
//   regardless of the bound, so the probes pin the exact NUMBER of draws
//   PopulateSystem makes on every frame, and the model's decision logic is
//   re-run on the probe-advanced stream so branch + pick VALUES are
//   compared against the port's observable outcomes (which entities
//   appear). The probes perturb the stream, so decisions differ from the
//   pure per-seed trace — by design.
// - unprobed: no probes; the port consumes exactly the pure per-seed
//   trace's draws, so spawn keys must equal the recorded trace roll for
//   roll (the trace is then verified end to end).

import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultDudeData } from "novadatainterface/DudeData";
import { getDefaultFleetData } from "novadatainterface/FleetData";
import { getDefaultPersData } from "novadatainterface/PersData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { Entity } from "nova_ecs/entity";
import { World } from "nova_ecs/world";
import { randInt, seedRng } from "../player/pilot_files";
import { LandEvent } from "./planet_plugin";
import { MissionEnvResource } from "../missions/mission_plugin";
import { makePlayerState, makeTestEnv, SYSTEMS } from "../missions/test_fixtures";
import { PlayerStateResource } from "../player/player_state_component";
import {
    ambientEventTrace,
    ambientRoll,
    AmbientTrace,
    BranchShape,
    RollTrace,
} from "./ambient_model";
import { AmbientPlugin } from "./ambient_plugin";
import { GameDataResource } from "./game_data_resource";
import { SystemIdResource } from "./system_id_resource";

export const ROLLS = 4; // Kania sÿst 128's roll count

// The harness's default population-event count per run.
export const EVENTS = 4;
const FLEET_ELIGIBLE = 10;
const PERS_ELIGIBLE = 100;

export const SHAPE: BranchShape = {
    fleetEligible: FLEET_ELIGIBLE,
    persEligible: PERS_ELIGIBLE,
    dudePairWeight: 100,
    dudeShipWeight: 100,
};

const SHIP_ID = "nova:600";
const DUDE_ID = "nova:900";

// Fresh system ids so the shared fixture map stays untouched otherwise:
// both make ROLLS rolls per event; the harness system owns one dûde pair,
// the plain system none (the dûde branch then draws nothing).
const TRACE_SYSTEM = "nova:306";
const PLAIN_SYSTEM = "nova:307";
SYSTEMS.set(TRACE_SYSTEM, {
    ...SYSTEMS.get("nova:300")!,
    id: TRACE_SYSTEM,
    links: [],
    planets: ["nova:130"],
    ambientRollCount: ROLLS,
    dudePairs: [{ dude: DUDE_ID, count: 100 }],
});
SYSTEMS.set(PLAIN_SYSTEM, {
    ...SYSTEMS.get("nova:300")!,
    id: PLAIN_SYSTEM,
    links: [],
    planets: ["nova:130"],
    ambientRollCount: ROLLS,
});

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

export interface PortRun {
    seed: number;
    events: number;
    probed: boolean;
    // Probe draw after each frame (index frame-1), when probed. Same
    // stream PopulateSystem draws from, so the sequence pins how many
    // draws it consumed per frame.
    probes: number[];
    // Ambient entity keys after each frame (index frame-1).
    keysByFrame: string[][];
}

// Runs the port's PopulateSystem for one seed over `events` population
// events, probing the LCG stream after every frame unless `probed` is
// false (see the module comment for the two comparison modes). `shape`
// selects the fixture system and how many flëts/përs/dûde entries are
// registered; it must be the shape the model replays.
export async function runPort(seed: number, events: number,
    probed = true, shape: BranchShape = SHAPE): Promise<PortRun> {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, {
        ...getDefaultShipData(),
        id: SHIP_ID,
        name: "Trace Ship",
    });
    if (shape.dudePairWeight > 0) {
        gameData.data.Dude.map.set(DUDE_ID, {
            ...getDefaultDudeData(),
            id: DUDE_ID,
            name: "Trace Dûde",
            // One ship class of weight 100: a dûde pick always spawns
            // SHIP_ID.
            shipTypes: [{ ship: SHIP_ID, probability: shape.dudeShipWeight }],
        });
    }
    for (let i = 0; i < shape.fleetEligible; i++) {
        const id = `nova:${950 + i}`;
        gameData.data.Fleet.map.set(id, {
            ...getDefaultFleetData(),
            id,
            name: `Trace Fleet ${i}`,
            leadShipType: SHIP_ID,
        });
    }
    for (let i = 0; i < shape.persEligible; i++) {
        const id = `nova:${960 + i}`;
        gameData.data.Pers.map.set(id, {
            ...getDefaultPersData(),
            id,
            name: `Trace Përs ${i}`,
            linkSyst: -1,
            govt: null,
            shipType: SHIP_ID,
        });
    }

    const { env } = makeTestEnv();
    const world = new World();
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource,
        shape.dudePairWeight > 0 ? TRACE_SYSTEM : PLAIN_SYSTEM);
    world.resources.set(PlayerStateResource, makePlayerState(seed));
    world.resources.set(MissionEnvResource, env);
    world.addPlugin(AmbientPlugin);
    // The LandEvent emissions need an entity to run against (the populate
    // event systems take the event data + world, which resolve per emitted
    // entity).
    const player = new Entity("player");
    world.entities.set("player", player);

    const ambientKeys = () => [...world.entities.keys()].filter(key =>
        key.startsWith("fleet-ship ") || key.startsWith("pers-ship ")
        || key.startsWith("dude-ship "));

    // Bursts at odd frames 1..2*events-1, the last burst's spawns land one
    // frame later.
    const frames = 2 * events;
    const probes: number[] = [];
    const keysByFrame: string[][] = [];
    // Align the fingerprint stream with the expected-side replay; the
    // system itself reseeds from the same rngSeed at its first burst (one
    // seed per system entry, see AmbientSeedResource).
    seedRng(seed);
    for (let frame = 1; frame <= frames; frame++) {
        world.step();
        await flush();
        keysByFrame.push(ambientKeys());
        if (probed) {
            probes.push(randInt(0x8000));
        }
        // events-1 emissions after the odd frames 1..2*events-3 (see the
        // frame protocol above).
        if (frame % 2 === 1 && frame < frames - 2) {
            world.emit(LandEvent, { id: "nova:130", uuid: "player" },
                ["player"]);
        }
    }
    return { seed, events, probed, probes, keysByFrame };
}

function describeDraws(draws: RollTrace["draws"]): string {
    if (draws.length === 0) {
        return "(no draws — empty branch)";
    }
    return draws.map(record =>
        `${record.kind}=rand(${record.bound})=${record.value}`).join(", ");
}

export interface AmbientComparison {
    seed: number;
    events: number;
    probed: boolean;
    ok: boolean;
    // Model spawns over the K events (the re-run decisions in probed
    // mode, the recorded trace in unprobed mode).
    spawnCount: number;
    // Human-readable first divergence (frame, the model's draws there,
    // expected vs observed); null on a match.
    firstDivergence: string | null;
}

// Runs the port's PopulateSystem beside the reference model for one seed
// and compares, frame by frame: the LCG stream fingerprints (probed mode),
// which entities the model's decisions predict, and — unprobed — the
// decisions themselves against the recorded pure trace.
export async function compareAmbientTrace(seed: number, events: number,
    probed = true, shape: BranchShape = SHAPE): Promise<AmbientComparison> {
    const pure: AmbientTrace = ambientEventTrace(seed, shape, ROLLS, events);
    const port = await runPort(seed, events, probed, shape);
    const frames = port.keysByFrame.length;

    // Re-run the model's decision logic on the same stream the port draws
    // from, with the same per-frame probe cadence.
    const decisions: RollTrace[] = [];
    const replayProbes: number[] = [];
    const wantKeysByFrame: string[][] = [];
    let keys = new Set<string>();
    let pendingKeys: string[] = [];
    let dudeCounter = 0;
    let bursts = 0;
    seedRng(seed);
    for (let frame = 1; frame <= frames; frame++) {
        // A burst's spawn patches land at the next frame's run. Burst
        // frames: 1, then 2, 4, ... (see the frame protocol above).
        keys = new Set([...keys, ...pendingKeys]);
        pendingKeys = [];
        const isBurstFrame = frame === 1
            || (frame % 2 === 0 && frame < 2 * events);
        if (isBurstFrame && bursts < events) {
            bursts++;
            for (let roll = 1; roll <= ROLLS; roll++) {
                const decision = ambientRoll(shape, bursts, roll, dudeCounter);
                decisions.push(decision);
                if (decision.branch === "dude" && decision.spawned) {
                    dudeCounter++;
                }
                if (decision.key !== null) {
                    pendingKeys.push(decision.key);
                }
            }
        }
        wantKeysByFrame.push([...keys].sort());
        if (probed) {
            replayProbes.push(randInt(0x8000));
        }
    }

    const fail = (frame: number, detail: string): AmbientComparison => {
        const burstIndex = frame === 1 ? 0 : Math.max(0, frame / 2 - 1);
        const roll = decisions[Math.min(decisions.length - 1,
            burstIndex * ROLLS)];
        return {
            seed,
            events,
            probed,
            ok: false,
            spawnCount: decisions.filter(entry => entry.key !== null).length,
            firstDivergence: `frame ${frame} (roll ${
                roll?.roll ?? "?"} draws: ${
                describeDraws(roll?.draws ?? [])}): ${detail}`,
        };
    };

    // Unprobed mode: the port consumed exactly the pure trace's stream, so
    // the re-run decisions must equal the recorded ones.
    if (!probed) {
        for (let i = 0; i < decisions.length; i++) {
            const replay = decisions[i];
            const recorded = pure.trace[i];
            if (replay.spawned !== recorded.spawned
                || replay.key !== recorded.key) {
                return fail(i === 0 ? 2 : 2 * i,
                    `model re-run disagrees with the recorded trace — `
                    + `re-run spawned ${replay.spawned} (${replay.key}), `
                    + `trace spawned ${recorded.spawned} (${recorded.key})`);
            }
        }
    }

    for (let frame = 1; frame <= frames; frame++) {
        const index = frame - 1;
        if (probed && port.probes[index] !== replayProbes[index]) {
            return fail(frame, `LCG stream diverged — expected probe `
                + `${replayProbes[index]}, port probed ${port.probes[index]}`);
        }
        const want = [...wantKeysByFrame[index]].sort();
        const got = [...port.keysByFrame[index]].sort();
        if (want.join("|") !== got.join("|")) {
            return fail(frame, `spawned keys diverged — expected `
                + `[${want.join(", ")}], port has [${got.join(", ")}]`);
        }
    }
    return {
        seed,
        events,
        probed,
        ok: true,
        spawnCount: decisions.filter(entry => entry.key !== null).length,
        firstDivergence: null,
    };
}
