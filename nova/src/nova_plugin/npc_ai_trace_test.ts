// Side-by-side trace specs for the NPC AI's trader/interceptor destination
// pick (FUN_0040c790): the port's real drawDestination (npc_ai_plugin.ts)
// must consume the same LCG rejection-draw stream and pick the same
// destination as the pure binary reference model (npc_ai_model) for the same
// system (planets + trader government) and seed. RNG-driven, so the
// comparison fingerprints both the draw sequence (probe) and the decision.
//
// Run:
//   npx esbuild --bundle --platform=node nova/src/nova_plugin/npc_ai_trace_test.ts \
//       --outfile=/tmp/npc_ai_trace_test.js \
//       && node_modules/.bin/jasmine /tmp/npc_ai_trace_test.js

import "jasmine";
import { getDefaultPlanetData, PlanetData } from "novadatainterface/PlanetData";
import { getDefaultGovernmentData, GovernmentData } from "novadatainterface/GovernmentData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { MovementState } from "nova_ecs/plugins/movement_plugin";
import { World } from "nova_ecs/world";
import { MissionEnvResource } from "../missions/mission_plugin";
import { randInt, seedRng } from "../player/pilot_files";
import { drawDestination } from "./npc_ai_plugin";
import { govtsHostile } from "./player_hostility";
import { DestinationPlanet, pickDestination } from "./npc_ai_model";

// A small government graph: a trader govt (flags2 selectable), a hostile
// govt (enemy class), a friendly govt, and a null-govt slot.
const mkGovt = (id: string, flags2: number, classes: number[],
    allies: number[] = [], enemies: number[] = []): GovernmentData =>
    ({ ...getDefaultGovernmentData(), id, flags2, classes, allies, enemies });

const GOVTS = new Map<string, GovernmentData>([
    ["nova:200", mkGovt("nova:200", 0, [1], [2])],
    ["nova:201", mkGovt("nova:201", 0x40, [1])],
    ["nova:202", mkGovt("nova:202", 0x80, [1])],
    ["nova:203", mkGovt("nova:203", 0x20, [1])],
    ["nova:210", mkGovt("nova:210", 0, [16], [], [1])],  // enemy of class 1
    ["nova:211", mkGovt("nova:211", 0, [2])],            // ally of nova:200
]);

type PlanetEntry = readonly [string, MovementState, { id: string },
    PlanetData | undefined];

function mkPlanet(id: string, x: number, y: number, govt: string | null,
    inhabited: boolean, flags2: number): PlanetEntry {
    return [id, {
        position: new Position(x, y), rotation: new Angle(0),
        velocity: new Vector(0, 0), accelerating: 0, turning: 0,
        turnBack: false,
    }, { id }, {
        ...getDefaultPlanetData(), id, govt, inhabited, flags2,
    }];
}

// Planet catalogs that exercise each branch:
const INHABITED_PLAIN = [
    mkPlanet("p1", 100, 100, "nova:211", true, 0),
    mkPlanet("p2", -200, 50, "nova:211", true, 0),
];
const WITH_1000 = [
    ...INHABITED_PLAIN,
    mkPlanet("pA", 300, 300, "nova:211", true, 0x1000),
];
const WITH_2000 = [
    ...INHABITED_PLAIN,
    mkPlanet("pB", -300, -300, "nova:211", true, 0x2000),
];
const UNINHABITED = [
    mkPlanet("p3", 100, 200, "nova:211", false, 0),
    mkPlanet("p4", 50, -50, "nova:211", false, 0),
];
const WITH_HOSTILE = [
    ...INHABITED_PLAIN,
    mkPlanet("pE", 400, 0, "nova:210", true, 0),   // hostile govt
];
const MIXED = [...INHABITED_PLAIN, ...WITH_1000.slice(2), ...UNINHABITED];

const CATALOGS: Record<string, PlanetEntry[]> = {
    plain: INHABITED_PLAIN,
    with1000: WITH_1000,
    with2000: WITH_2000,
    uninhabited: UNINHABITED,
    withHostile: WITH_HOSTILE,
    mixed: MIXED,
};

function factsFor(govtId: string | null, planets: PlanetEntry[]):
    DestinationPlanet[] {
    const mine = govtId === null ? null : GOVTS.get(govtId) ?? null;
    return planets.map(p => {
        const theirGovt = p[3] ? GOVTS.get(p[3].govt!) ?? null : null;
        const category = (p[3]?.flags2 ?? 0) & 0x3000;
        return {
            id: p[0],
            valid: p[1].position.x < 1000 && p[1].position.y < 1000,
            hostile: govtsHostile(mine, theirGovt, mine?.id, theirGovt?.id),
            ordinary: p[3]?.inhabited === false && category === 0,
            cat1000: (category & 0x1000) !== 0,
            cat2000: (category & 0x2000) !== 0,
        };
    });
}

function runPort(govtId: string | null, planets: PlanetEntry[],
    interceptorMode: boolean): { picked: string | null, probe: number } {
    const world = new World();
    world.resources.set(MissionEnvResource, {
        government: (id: string | null) =>
            (id === null ? null : GOVTS.get(id) ?? null),
    } as any);
    const picked = drawDestination(govtId, world, planets, interceptorMode);
    return { picked, probe: randInt(0x8000) };
}

function runModel(govtId: string | null, planets: PlanetEntry[],
    interceptorMode: boolean): { picked: string | null, probe: number } {
    const flags2 = govtId === null ? 0 : (GOVTS.get(govtId)?.flags2 ?? 0);
    const picked = pickDestination(factsFor(govtId, planets), flags2,
        interceptorMode, () => randInt(16));
    return { picked, probe: randInt(0x8000) };
}

const traderGovts = ["nova:200", "nova:201", "nova:202", "nova:203", null];

describe("NPC AI destination pick trace vs reference model", () => {
    it("matches draws + destination across systems, govts and seeds", () => {
        let cases = 0;
        for (const [catalogName, planets] of Object.entries(CATALOGS)) {
            for (const govtId of traderGovts) {
                for (const interceptor of [false, true]) {
                    for (let seed = 1; seed <= 8; seed++) {
                        seedRng(seed);
                        const port = runPort(govtId, planets, interceptor);
                        seedRng(seed);
                        const model = runModel(govtId, planets, interceptor);
                        expect(port.picked)
                            .withContext(`${catalogName} govt=${govtId} `
                                + `interceptor=${interceptor} seed=${seed}`)
                            .toEqual(model.picked);
                        expect(port.probe)
                            .withContext(`${catalogName} govt=${govtId} `
                                + `interceptor=${interceptor} seed=${seed} `
                                + `draws`)
                            .toEqual(model.probe);
                        cases++;
                    }
                }
            }
        }
        // 6 catalogs × 5 govts × 2 modes × 8 seeds.
        expect(cases).toEqual(6 * 5 * 2 * 8);
    });
});
