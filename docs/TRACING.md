# Tracing coverage — port-vs-binary reference-model comparison

The port guarantees fidelity by transcribing binary functions into a TypeScript
**reference model** (derived via Ghidra decompile of `EV_Nova.dat`), then driving
the port's real ECS systems beside that model and asserting identical outputs.
Because the engine draws randomness from one global Park-Miller LCG
(`FUN_004683b0`), the comparison fingerprints the **LCG draw sequence** — the
number/order/bound of every `rand()` — plus the resulting numeric outputs and
spawn keys. If the port consumes a different draw sequence or produces a
different output, it has diverged from the binary.

This is the only way to prove "no approximations": a plain unit test asserts a
specific value, but the trace asserts the *whole decision surface* of a function
matches the binary byte-for-byte across many seeds.

## Current coverage

| Function | Subsystem | Status |
|---|---|---|
| `FUN_0041af90` | ambient population (`PopulateSystem`) | **TRACED** — 3-way branch routing (përs 1/7, flët 6/49, dûde 36/49), per-roll draws, spawn keys. `ambient_harness.ts` / `ambient_model.ts` / `ambient_trace_test.ts` / `scripts/run_ambient_trace.ts` |

Everything else the port touches is covered only by **plain unit tests** (assert
specific values), not by a replay of a binary reference model.

## Goal

Extend the reference-model-vs-port trace to every subsystem that has a
deterministic, traceable surface, so a divergence is caught the moment it is
introduced — not after a user reports it.

## Phases

### Phase A — complete the `FUN_0041af90` model (done)

The population manager does more than the roll loop the trace originally
modeled. Now complete:

- **Sÿst peripheral-përs loop** (`spawnPeripherals`): the `rand(100)+1 <= percent`
  warp-ins that run *before* the roll loop.
- **Whole-fleet escort groups**: the flët branch spawns a lead ship **and** its
  escort groups (one `rand(span)` count draw per group, then an aggress roll
  per ship), up to 8 ships total.

Both are in the reference model (`ambient_model.ts`) and the driver
(`ambient_harness.ts`) in their exact draw order.

### Phase B — real-system expected-count validation (done)

`ambient_real_test.ts` encodes the audit's **real nova:128 numbers** (`rollCount=4`,
real dûde weights→govt table, `fleetEligible=41`, active peripheral përs) as a
fixture and asserts:

- the port matches the model for the real shape — same LCG draws, spawn keys,
  and **dûde government assignment**;
- ~4 ships/landing (2.94 dûde + 0.77 peripherals + ~0.27 flët);
- dûde governments in the real table's proportions (Fed 40%, Marauder 21%,
  Trader/Sigma 12%, Pyro 10%, Polaris 5%).

The flët contribution uses a single representative escort config (the model
can't encode per-fleet escort tables), so it is approximate; the dûde +
peripheral + pers parts are exact.

### Phase C — extend the pattern to more functions

Combat damage is done first (highest value × tractability):

1. **Combat damage** (done) — `combat_damage_model.ts` + `combat_damage_trace_test.ts`
   reference-model the damage application (shield→armor routing, point-defense
   scaling, pass-through) and beam decay, and sweep the port's real systems
   against them. EV Nova combat has **no damage-variance LCG roll**, so this is
   a numeric-output comparison (shield/armor deltas), not a draw-sequence
   fingerprint.

2. **Flight physics** — `movement_plugin`: global drag, per-component thrust
   clamp, arrival brake. Deterministic — compare numeric trajectories.

3. **Combat rating / ranks** — `combat_rating_plugin`: deterministic thresholds.

4. **NPC AI decisions** — aggress / target / retaliate / flee. Most faithful but
   also most stateful and complex; deferred.

## How to add a traced subsystem

1. **Reference model** — transcribe the binary function from a Ghidra
   decompile into a pure function (no ECS), recording every `rand()` draw and
   its output, as `ambient_model.ts` does.
2. **Driver** — build the subsystem's real systems in a headless `World`
   seeded identically, advancing the same LCG stream.
3. **Compare** — assert identical draw sequences and outputs across many seeds
   (probed mode fingerprints the draw count per frame; unprobed mode replays the
   recorded trace pass-for-pass).
4. **Gate** — the trace + a seed sweep (e.g. `scripts/run_ambient_trace.ts`,
   1000 seeds) must stay green before commit.

## Status

- Phase A: done
- Phase B: done
- Phase C: combat damage done; flight physics → rating → NPC AI not started
