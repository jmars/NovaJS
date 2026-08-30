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
| Ambient ship manager | `nova/src/nova_plugin/fleet_plugin.ts`, `pers_plugin.ts` | FUN_0041af90 | APPROXIMATED | rand(7)/rand(7) gates per roll. AUDIT 2024: binary rolls only at POPULATION EVENTS (jump-in FUN_0044aa70@0044d84f/@0044fa91, FUN_00457580@004583d7/@00458a2d; landing/liftoff/boarding FUN_00486880@00486c5c, FUN_00486ed0@004870b1, FUN_00489d70@0048a75a), NOT per frame; each event runs sÿst+0x8e rolls (raw sÿst+0x64; stock 0-10, median 3). Port's every-30-frames pass over-spawns during a stay (continuous roll vs event-only) |
| Fleet spawn | `fleet_plugin.ts` | FUN_00425280 / FUN_004259b0 | VERIFIED | rand(256); ship-class govt (param_3=-1); only 6/49 of rolls reach this branch |
| Pers spawn | `pers_plugin.ts` | FUN_004235c0 | VERIFIED | rand(1022); pers.govt; only 1/7 of rolls reach this branch |
| Dude branch | — | FUN_0041ba80 | NOT PORTED | 36/49 of ambient rolls (dominant). Weighted-picks a dûde entry from the sÿst's 8-pair list (FUN_0046b600), then a (ship class,count) pair from the dûde's 16 pairs (FUN_0046b4b0), spawns ONE ship with dûde govt (+2) + AI (+0, fallback shïp inherent AI). Searches slots 1..55 only |
| System arrival | — | FUN_00456480 | UNKNOWN | — |
| Despawn (ambient) | — | FUN_004687b0 | NOT PORTED | ships silently removed when far (per-frame per-ship in ~41 AI fns; speed-scaled threshold, bytes 0x575800=100.0 / 0x575808=-0.241 / 0x5757f8=0.0), govt flag bit 0x800 → immediate remove, mission overrides; repopulation prunes all slots |

### Combat

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| Projectile damage | `projectile_plugin.ts` | FUN_0042f270 → FUN_004192d0 | APPROXIMATED | owner-skip rules match (shooter itself, shooter's owner, targets owned by shooter; −1/0xffff sentinels ⇒ ownerless still hits); shield→armor order, passThroughShield = flags bit 0x20. Missing in port: friendly no-disable clamp (armor=1.0), shield overshoot floor −maxShield×0.1 |
| Beam damage | `beam_plugin.ts` | FUN_00437780 / FUN_00437e20 / FUN_00435830 | APPROXIMATED | binary: per-frame hits, damage decays max(0, base − steps), steps +1 per wd[+0x1a] frames per firing; port scales delta_ms*30/1000 (≈1/frame) and never decays ⇒ over-damages sustained beams |
| Blast/splash | `blast_plugin.ts` | FUN_00435830 (+FUN_00437780) | APPROXIMATED | binary: SQUARE blast range (|dx|,|dy| ≤ radius); only the player (slot 0) takes own blast (NPCs immune unless flag 0x100); projectile blasts double-dip (direct + splash), beam blasts don't. Port: circular hull, uniform self-blast rule, never double-dips |
| AI targeting (AggroRange) | `npc_ai_plugin.ts` | — | UNKNOWN | playerIsHostile gating verified |
| Retaliation | `npc_ai_plugin.ts` | — | APPROXIMATED | now gated on govt hostility |
| NPC random target | `npc_plugin.ts` | — | UNKNOWN | — |
| Health/shields | `health_plugin.ts` | FUN_004192d0, FUN_00463550/4637a0 | VERIFIED | ship slot: +0x54 shield, +0x58 armor, +0x5c ionization (stride 0xc948 off DAT_005912a0); maxes = shipdata(+0x5c/+0x60) + outfit mod types 4/6 (FUN_00463550/4637a0); both restored to max on landing (FUN_004cb260) |
| Ionization | `ionization_plugin.ts` | FUN_0046f3f0 | APPROXIMATED | slot+0x5c += weapon ionization (full on direct hit); color flags OR'd at slot+0xb0; splash ionization has circular falloff (port applies full — minor) |
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
| Fleet/pers ambient govt gate | `fleet_plugin.ts`, `pers_plugin.ts` | — | APPROXIMATED | system govt + ally/civilian bias. Root cause of melee is upstream: port draws global fleets/përs; binary draws the system's own dûdes (system-govt-owned), so the gate approximates what dûdes give for free |
| System government | — | sÿst+8 | VERIFIED | runtime +8 ← raw sÿst+0x66 (0x80-based, -0x80 decoded at parse; stock: raw +0x66 = 128/147/...; 91 systems have -1) |

### UI / spaceport

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| Spaceport buttons | `spaceport/spaceport.ts` | FUN_004903c0 | APPROXIMATED | spöb outfitter 0x4, shipyard 0x8 gating added |
| Mission briefing | `spaceport/briefing.ts` | — | UNKNOWN | — |
| Mission BBS | `spaceport/mission_bbs.ts` | — | UNKNOWN | — |

## Audit backlog (prioritized)

Ordered by risk of divergence × player-facing impact. Flip status to VERIFIED
when audited.

1. ~~**sÿst ambient ship table**~~ — RECOVERED (audit 2024, see memory node
   handoff-spawn-audit-ctx): raw sÿst = 428 bytes; **8 dûde ids at +0x44, counts
   at +0x54 (normalized ×100/total at load)**; ambient roll count at **+0x64**
   (→ runtime +0x8e, stock 0-10, median 3); govt at +0x66; **8 përs ids at
   +0x6e, percents at +0x7e** (the "Peripherals"; consumed by FUN_0041af90 at
   runtime +0x98/+0xa8 with rand(100)<percent). Dûde resource = 88 bytes: AI +0,
   govt +2, flags/STR# +6, 16 ship classes +8, 16 counts +0x28 (74-byte runtime
   entry in DAT_005912cc, 512 entries). Fix = parse dûdes + sÿst pairs and
   replace global fleet/pers draw as the dominant ambient source.
2. ~~**Dude branch FUN_0041ba80**~~ — fully decoded (see row above); still not
   ported. Requires dûde + sÿst parsing (backlog item 1).
3. ~~**Combat damage path** (projectile/beam/blast)~~ — AUDITED (see combat table): projectile friendly-fire + shield/armor order VERIFIED; beam decay, blast shape/self-blast/double-dip diverge (APPROXIMATED); prox-safety window has no verified binary counterpart.
4. **AI targeting / retaliation radii** — AGGRESS_RADII inferred from Bible, not
   binary; retaliation now gated but the radius table is unverified.
5. **Mission availability / stellar filters** — govt-band +127 shift verified
   against stock mïsn, but edge cases (30000/31000 bands) are inferred.
6. **Scanning / smuggling** — crimeTol gate shared with player hostility; not
   independently audited.
7. **Combat rating / ranks interplay** — deactivateRanksOnShipLoss only wires the
   DESTROY half (DISABLE half unwired).
