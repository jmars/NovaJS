# NovaJS fidelity manifest

A living inventory of EV Nova engine subsystems in the port, mapped to the
function(s) in the original binary (`EV_Nova.dat`, EV Nova 1.0.10 Windows PE,
Ghidra project `/tmp/ghproj/EVNova`) that own them, and each subsystem's audit
status. The goal is to catch fidelity bugs **proactively** (by comparative
audit) instead of after a user reports them.

## Status legend

- **VERIFIED** — constants/logic confirmed against the binary and matching.
- **APPROXIMATED** — ported but with a known, documented deviation.
- **UNKNOWN** — never compared against the binary; highest audit priority.
- **NOT PORTED** — present in the binary, absent in the port.

## How to audit one subsystem

1. Decompile the binary function(s) with Ghidra headless:
   `tools/ghidra_12.1.3_PUBLIC/support/analyzeHeadless /tmp/ghproj EVNova \
     -process EV_Nova.dat -noanalysis -scriptPath /tmp -postScript ghidra_ambient.java <hexaddr>`
2. Read the port's TS file for the same subsystem.
3. Record divergences (constants, ordering, probability, gating) back to the
   owning memory node; fix confirmed divergences; flip status.

## Subsystems

### Core engine

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| RNG (Park-Miller LCG) | `nova/src/player/pilot_files.ts` | FUN_004683b0 | VERIFIED | mult 0x41a7, mod 0x7fffffff, carry 0x80000001, state DAT_007ccdd8 |
| Per-frame tick | — | FUN_0044aa70 | APPROXIMATED | port uses ECS `world.step()` |
| Ambient ship manager | `nova/src/nova_plugin/fleet_plugin.ts`, `pers_plugin.ts` | FUN_0041af90 | APPROXIMATED | rand(7)/rand(7) gates; per-frame in binary vs 30-frame pass in port |
| Fleet spawn | `fleet_plugin.ts` | FUN_00425280 / FUN_004259b0 | VERIFIED | rand(256); ship-class govt (param_3=-1) |
| Pers spawn | `pers_plugin.ts` | FUN_004235c0 | VERIFIED | rand(1022); pers.govt |
| Dude branch | — | FUN_0041ba80 | NOT PORTED | — |
| System arrival | — | FUN_00456480 | UNKNOWN | — |

### Combat

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| Projectile damage | `projectile_plugin.ts` | (collision) | UNKNOWN | friendly-fire + ownerless guard verified |
| Beam damage | `beam_plugin.ts` | — | UNKNOWN | — |
| Blast/splash | `blast_plugin.ts` | — | UNKNOWN | — |
| AI targeting (AggroRange) | `npc_ai_plugin.ts` | — | UNKNOWN | playerIsHostile gating verified |
| Retaliation | `npc_ai_plugin.ts` | — | APPROXIMATED | now gated on govt hostility |
| NPC random target | `npc_plugin.ts` | — | UNKNOWN | — |
| Health/shields | `health_plugin.ts` | — | UNKNOWN | — |
| Ionization | `ionization_plugin.ts` | — | UNKNOWN | — |
| Guidance | `guidance.ts` | — | UNKNOWN | — |
| Combat rating | `combat_rating_plugin.ts` | — | UNKNOWN | — |

### Economy & capture

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| Trade base prices | `spaceport/purchase.ts` | STR# 9300 | VERIFIED | data-driven, absent in stock |
| Trade bands | `purchase.ts` | — | VERIFIED | [0,0.8,1,1.25], floor 5 |
| Cargo decay | `missions/cargo_decay.ts` | — | VERIFIED | +1/−1 ton every dayCount%250==0 |
| Capture odds | `missions/capture.ts` | — | VERIFIED | base 10% crew-pool + marine% ±5 clamp [1,75] |
| Booty | `missions/capture.ts` | — | VERIFIED | 2.5% banded floored 1000 + one commodity |
| Outfitter purchase/sell | `spaceport/purchase.ts` | FUN_0048ea70 | APPROXIMATED | boughtHere 0.5 + trade-in 0.25×ship+0.5×outfits |
| Shipyard | `spaceport/shipyard.ts` | FUN_004903c0 | APPROXIMATED | spöb shipyard bit 0x8 |

### Faction & spawn

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| Ship class inherent govt | `novaparse/.../ShipParse.ts` | ship+0x12 band | VERIFIED | 128-383 combat, 1128+ attr-only, 2128+ combat-2000 |
| Fleet/pers ambient govt gate | `fleet_plugin.ts`, `pers_plugin.ts` | — | APPROXIMATED | system govt + ally/civilian bias |
| System government | — | sÿst+8 | UNKNOWN | port derives from inhabited planet govt |

### UI / spaceport

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| Spaceport buttons | `spaceport/spaceport.ts` | FUN_004903c0 | APPROXIMATED | spöb outfitter 0x4, shipyard 0x8 gating added |
| Mission briefing | `spaceport/briefing.ts` | — | UNKNOWN | — |
| Mission BBS | `spaceport/mission_bbs.ts` | — | UNKNOWN | — |

## Audit backlog (prioritized)

Ordered by risk of divergence × player-facing impact. Flip status to VERIFIED
when audited.

1. **sÿst ambient ship table** — the real per-system ambient population source
   (fleet_plugin comment mentions sÿst Count field; `0x8e` was not it). The port
   approximates ambient population via global fleet/pers + govt gate. Highest
   fidelity gap; needs the real sÿst layout recovered.
2. **Dude branch FUN_0041ba80** — not ported; owns dude probability-table spawns.
3. **Combat damage path** (projectile/beam/blast) — never compared; the recent
   neutral-player + ownerless changes touched it without a binary reference.
4. **AI targeting / retaliation radii** — AGGRESS_RADII inferred from Bible, not
   binary; retaliation now gated but the radius table is unverified.
5. **Mission availability / stellar filters** — govt-band +127 shift verified
   against stock mïsn, but edge cases (30000/31000 bands) are inferred.
6. **Scanning / smuggling** — crimeTol gate shared with player hostility; not
   independently audited.
7. **Combat rating / ranks interplay** — deactivateRanksOnShipLoss only wires the
   DESTROY half (DISABLE half unwired).
