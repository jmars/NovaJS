// Side-by-side trace driver for the ambient spawn model: runs the port's
// real SpawnFleetsSystem or SpawnPersSystem in a minimal headless World
// (the fleet_plugin_test/pers_test fixtures) over K ambient passes while
// fingerprinting the engine LCG stream after every frame, then compares
// the port's observed fingerprints, spawn decisions and entity keys
// against the reference model (ambient_model). Test-support only — no
// runtime code imports this file.
//
// Frame protocol (mirrored by the expected-side replay below): every frame
// runs one world.step() + a microtask flush; pass k rolls at frame
// 1 + AMBIENT_ROLL_INTERVAL_FRAMES * (k - 1) and no draws happen on the
// cooldown frames between passes. AsyncSystem lands a pass's spawn patches
// on the NEXT frame, so expected keys appear one frame after their pass.
// Math.random scatter (warpInAt/makeShip) never touches the LCG stream and
// is outside the comparison.
//
// Two comparison modes:
// - probed (default): after every frame the harness draws one probe
//   rand(0x8000) from the same stream. The LCG advances once per draw
//   regardless of the bound, so the probes pin the exact NUMBER of draws
//   the systems make on every frame, and the model's decision logic is
//   re-run on the probe-advanced stream so branch + pick VALUES are
//   compared against the port's observable outcomes (which entities
//   appear). The probes perturb the stream, so decisions differ from the
//   pure per-seed trace — by design.
// - unprobed: no probes; the port consumes exactly the pure per-seed
//   trace's draws, so spawn decisions + picks must equal the recorded
//   trace pass for pass (the trace is then verified end to end).

import { MockGameData } from "novadatainterface/MockGameData";
import { FleetData, getDefaultFleetData } from "novadatainterface/FleetData";
import { getDefaultPersData, PersData } from "novadatainterface/PersData";
import { getDefaultShipData } from "novadatainterface/ShipData";
import { World } from "nova_ecs/world";
import { randInt, seedRng } from "../player/pilot_files";
import { MissionEnvResource } from "../missions/mission_plugin";
import {
    makePlayerState,
    makeTestEnv,
    SYSTEMS,
} from "../missions/test_fixtures";
import { PlayerStateResource } from "../player/player_state_component";
import {
    fleetPass,
    fleetSpawnTrace,
    PassTrace,
    persPass,
    persSpawnTrace,
} from "./ambient_model";
import { AMBIENT_ROLL_INTERVAL_FRAMES, FleetPlugin } from "./fleet_plugin";
import { GameDataResource } from "./game_data_resource";
import { DeathAISystem } from "./npc_plugin";
import { PersPlugin } from "./pers_plugin";
import { SystemIdResource } from "./system_id_resource";

export type AmbientKind = "fleet" | "pers";

// The fixtures' inhabited system (planet nova:130 START): flëts only
// spawn with an inhabited planet; përs have no such gate. Fresh system id
// so the shared fixture map stays untouched otherwise.
const INHABITED_SYSTEM = "nova:306";
SYSTEMS.set(INHABITED_SYSTEM, {
    ...SYSTEMS.get("nova:300")!,
    id: INHABITED_SYSTEM,
    links: [],
    planets: ["nova:130"],
});

const SHIP_ID = "nova:600";

// One flët/përs per eligible entry: linkSyst -1, no Active/ActivateOn, no
// govt gate, lead shïp only (no escort-count draws) — so a pass makes
// exactly the model's draws.
function eligibleId(kind: AmbientKind, index: number): string {
    return kind === "fleet" ? `nova:${950 + index}` : `nova:${960 + index}`;
}

function spawnKey(kind: AmbientKind, id: string): string {
    return kind === "fleet" ? `fleet-ship ${id} 0` : `pers-ship ${id}`;
}

// The frame a pass rolls on (makeTestWorld-style: frame 1 rolls at once).
export function passFrame(pass: number): number {
    return 1 + AMBIENT_ROLL_INTERVAL_FRAMES * (pass - 1);
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

export interface PortRun {
    seed: number;
    kind: AmbientKind;
    eligible: number;
    passes: number;
    probed: boolean;
    // Probe draw after each frame (index frame-1), when probed. Same
    // stream the systems draw from, so the sequence pins how many draws
    // they consumed per frame.
    probes: number[];
    // Ambient entity keys after each frame (index frame-1).
    keysByFrame: string[][];
}

// Runs the port's spawn system for one seed over `passes` ambient passes,
// probing the LCG stream after every frame unless `probed` is false (see
// the module comment for the two comparison modes).
export async function runPort(kind: AmbientKind, seed: number,
    eligible: number, passes: number, probed = true): Promise<PortRun> {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, {
        ...getDefaultShipData(),
        id: SHIP_ID,
        name: "Trace Ship",
    });
    for (let i = 0; i < eligible; i++) {
        const id = eligibleId(kind, i);
        if (kind === "fleet") {
            const fleet: FleetData = {
                ...getDefaultFleetData(),
                id,
                name: `Trace Fleet ${i}`,
                leadShipType: SHIP_ID,
            };
            gameData.data.Fleet.map.set(id, fleet);
        }
        else {
            const pers: PersData = {
                ...getDefaultPersData(),
                id,
                name: `Trace Përs ${i}`,
                linkSyst: -1,
                govt: null,
                shipType: SHIP_ID,
            };
            gameData.data.Pers.map.set(id, pers);
        }
    }

    const { env } = makeTestEnv();
    const world = new World();
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource, INHABITED_SYSTEM);
    world.resources.set(PlayerStateResource, makePlayerState(seed));
    world.resources.set(MissionEnvResource, env);
    world.addPlugin(kind === "fleet" ? FleetPlugin : PersPlugin);
    if (kind === "pers") {
        // PersDeathSystem must find DeathAISystem (see pers_test).
        world.addSystem(DeathAISystem);
    }

    const ambientKeys = () => [...world.entities.keys()].filter(key =>
        key.startsWith("fleet-ship ") || key.startsWith("pers-ship "));

    // +1: the last pass's spawn patches land on the frame after its roll.
    const frames = passFrame(passes) + 1;
    const probes: number[] = [];
    const keysByFrame: string[][] = [];
    // Align the fingerprint stream with the expected-side replay; the
    // system itself reseeds from the same rngSeed at frame 1 (one seed per
    // system entry, see AmbientSeedResource).
    seedRng(seed);
    for (let frame = 1; frame <= frames; frame++) {
        world.step();
        await flush();
        keysByFrame.push(ambientKeys());
        if (probed) {
            probes.push(randInt(0x8000));
        }
    }
    return { seed, kind, eligible, passes, probed, probes, keysByFrame };
}

function describeDraws(draws: PassTrace["draws"]): string {
    if (draws.length === 0) {
        return "(no draws — another branch owns the slot)";
    }
    return draws.map(record =>
        `${record.kind}=rand(${record.bound})=${record.value}`).join(", ");
}

export interface AmbientComparison {
    kind: AmbientKind;
    seed: number;
    eligible: number;
    passes: number;
    probed: boolean;
    ok: boolean;
    // Model spawn decisions over the K passes (the re-run decisions in
    // probed mode, the recorded trace in unprobed mode).
    spawnCount: number;
    // Human-readable first divergence (frame, the model's draws there,
    // expected vs observed); null on a match.
    firstDivergence: string | null;
}

// Runs the port's system beside the reference model for one seed and
// compares, frame by frame: the LCG stream fingerprints (probed mode),
// which entities the model's decisions predict, and — unprobed — the
// decisions themselves against the recorded pure trace.
export async function compareAmbientTrace(kind: AmbientKind, seed: number,
    eligible: number, passes: number, probed = true):
    Promise<AmbientComparison> {
    const pure = kind === "fleet"
        ? fleetSpawnTrace(seed, eligible, passes)
        : persSpawnTrace(seed, eligible, passes);
    const port = await runPort(kind, seed, eligible, passes, probed);
    const frames = port.keysByFrame.length;

    // Re-run the model's decision logic on the same stream the port draws
    // from, with the same per-frame probe cadence.
    const decisions: PassTrace[] = [];
    const replayProbes: number[] = [];
    const wantKeysByFrame: string[][] = [];
    let keys: string[] = [];
    let pendingLanding: string | null = null;
    let decisionIndex = 0;
    seedRng(seed);
    for (let frame = 1; frame <= frames; frame++) {
        if (pendingLanding !== null) {
            keys = [...keys, pendingLanding];
            pendingLanding = null;
        }
        if (frame === passFrame(decisionIndex + 1) &&
            decisionIndex < passes) {
            decisionIndex++;
            const decision = kind === "fleet"
                ? fleetPass(eligible, decisionIndex)
                : persPass(eligible, decisionIndex);
            decisions.push(decision);
            if (decision.spawned && decision.picked !== null) {
                pendingLanding =
                    spawnKey(kind, eligibleId(kind, decision.picked));
            }
        }
        wantKeysByFrame.push(keys);
        if (probed) {
            replayProbes.push(randInt(0x8000));
        }
    }

    const fail = (frame: number, detail: string): AmbientComparison => {
        const decision = decisions.find(entry => entry.pass ===
            Math.ceil(frame / AMBIENT_ROLL_INTERVAL_FRAMES));
        return {
            kind,
            seed,
            eligible,
            passes,
            probed,
            ok: false,
            spawnCount: decisions.filter(entry => entry.spawned).length,
            firstDivergence: `frame ${frame} (pass ${
                decision?.pass ?? "?"} draws: ${
                describeDraws(decision?.draws ?? [])}): ${detail}`,
        };
    };

    // Unprobed mode: the port consumed exactly the pure trace's stream, so
    // the re-run decisions must equal the recorded ones.
    if (!probed) {
        for (let i = 0; i < decisions.length; i++) {
            const replay = decisions[i];
            const recorded = pure.trace[i];
            if (replay.spawned !== recorded.spawned
                || replay.picked !== recorded.picked) {
                return fail(passFrame(i + 1),
                    `model re-run disagrees with the recorded trace — `
                    + `re-run spawned ${replay.spawned} (pick ${replay.picked}), `
                    + `trace spawned ${recorded.spawned} (pick ${recorded.picked})`);
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
        kind,
        seed,
        eligible,
        passes,
        probed,
        ok: true,
        spawnCount: decisions.filter(entry => entry.spawned).length,
        firstDivergence: null,
    };
}
