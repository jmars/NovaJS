// Pure reference model of the binary's trader/interceptor destination pick
// (FUN_0040c790), for a side-by-side trace harness (npc_ai_trace_test.ts):
// a rejection draw of rand(16) over the current system's 16 spöb slots,
// retried until the drawn slot satisfies the branch's predicate.
//
// The modelled surface is the decision (predicate selection by the trader
// government's flags2 + the planet counts, then the bounded rejection draw);
// the per-planet facts (slot validity, hostility, ordinary/category bits)
// are computed from the planet data and government relation by the caller,
// so the trace can drive both the port and the model from identical inputs.
//
// Branch selection (TRAVEL_PARAM_2 is always false at every ported call):
//   0x80 force-picks a 0x2000-category spöb when one is reachable;
//   0x40 force-picks a 0x1000-category spöb (0x80 wins);
//   otherwise the general path draws an inhabited (non-ordinary) spöb,
//   vetoing 0x2000 unless 0x80 is set and 0x1000 when 0x20 is set — and
//   picks NOTHING (the jump-out) when the vetoes cannot be met.
// The interceptor call (param_3 = 1) draws any non-category non-hostile
// slot, gated on at least one inhabited non-category spöb.

export interface DestinationPlanet {
    id: string;
    valid: boolean;
    hostile: boolean;
    ordinary: boolean;
    cat1000: boolean;
    cat2000: boolean;
}

export const TRAVEL_DRAW = 16;
export const TRAVEL_DRAW_LIMIT = 1000;

export function pickDestination(planets: DestinationPlanet[],
    govtFlags2: number, interceptorMode: boolean,
    rng: () => number, drawLimit = TRAVEL_DRAW_LIMIT): string | null {
    const counted = planets.filter(p => p.valid && !p.hostile);
    const nA = counted.filter(p => p.cat2000).length;
    const nB = counted.filter(p => p.cat1000).length;
    const nSpecial = counted.filter(p => !p.ordinary).length;
    const nPlain = counted.filter(p => !p.ordinary && !p.cat1000
        && !p.cat2000).length;

    let predicate: (p: DestinationPlanet) => boolean;
    if (interceptorMode) {
        if (nPlain < 1) {
            return null;
        }
        predicate = p => p.valid && !p.hostile && !p.cat2000 && !p.cat1000;
    }
    else if ((govtFlags2 & 0x80) !== 0 && nA > 0) {
        predicate = p => p.valid && !p.hostile && p.cat2000;
    }
    else if ((govtFlags2 & 0x40) !== 0 && nB > 0) {
        predicate = p => p.valid && !p.hostile && p.cat1000;
    }
    else {
        // The general path draws only when its vetoes can be satisfied —
        // otherwise the binary returns 0xffff without drawing.
        if (!(nSpecial > 0 && (nPlain > 0
            || (nB > 0 && (govtFlags2 & 0x20) === 0)))) {
            return null;
        }
        predicate = p => p.valid && !p.hostile && !p.ordinary
            && !(p.cat2000 && (govtFlags2 & 0x80) === 0)
            && !(p.cat1000 && (govtFlags2 & 0x20) !== 0);
    }

    for (let draw = 0; draw < drawLimit; draw++) {
        const idx = rng();
        if (idx < planets.length && predicate(planets[idx])) {
            return planets[idx].id;
        }
    }
    return null;
}
