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
| Ambient ship manager | `nova/src/nova_plugin/ambient_plugin.ts` | FUN_0041af90 | VERIFIED | Population-event driven: one burst per jump-in / landing / liftoff / boarding (PopulateResource pending counter; LandEvent/LiftoffEvent/BoardedEvent each queue one), running the sÿst+0x64 ambient rolls (stock 0-10, median 3) with the binary's single rand(7) routing: rand(7)==0 → përs (FUN_004235c0), else rand(7)==0 → flët (FUN_00425280), else dûde (FUN_0041ba80). sÿst Peripherals pairs run first at rand(100)+1 <= percent. No per-frame pass (the old every-30-frames port pass is removed) |
| Fleet spawn | `fleet_plugin.ts` | FUN_00425280 / FUN_004259b0 | VERIFIED | rand(256); ship-class govt (param_3=-1); only 6/49 of rolls reach this branch |
| Pers spawn | `pers_plugin.ts` | FUN_004235c0 | VERIFIED | rand(1022); pers.govt; only 1/7 of rolls reach this branch |
| Dude branch | `nova/src/nova_plugin/ambient_plugin.ts` (+`dude.ts` weightedPick, `SystemData.dudePairs`) | FUN_0041ba80 | PORTED | 36/49 of ambient rolls (dominant). Weighted-picks a dûde entry from the sÿst's 8-pair list (FUN_0046b600, raw counts as weights), then a (ship class,count) pair from the dûde's 16 pairs (FUN_0046b4b0), spawns ONE ship with dûde govt + AI (makeDudeShip). Slot search 1..55 → port counts ship entity keys (DUDE_SLOT_LIMIT=55). Draw counts inside the two weighted picks + the ±750 scatter are port-defined (binary internals not recovered) |
| System arrival | — | FUN_00456480 | UNKNOWN | — |
| Despawn (ambient) | `nova/src/nova_plugin/ambient_plugin.ts` (AmbientDespawnSystem) | FUN_004687b0 | APPROXIMATED | ambient-keyed ships (fleet-ship/pers-ship/dude-ship) silently deleted beyond max(2400, top-speed×8) from the player each frame; binary's exact speed-scaled threshold has unrecoverable operand units (100.0/-0.241/0.0). Govt flag 0x800 immediate-remove case DEFERRED (flags/flags2 word mapping unresolved); mission overrides not modeled — mission-ship/escort keys are never despawned |

### Combat

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| Projectile damage | `projectile_plugin.ts` | FUN_0042f270 → FUN_004192d0 | APPROXIMATED | owner-skip rules match (shooter itself, shooter's owner, targets owned by shooter; −1/0xffff sentinels ⇒ ownerless still hits); shield→armor order, passThroughShield = flags bit 0x20. Missing in port: friendly no-disable clamp (armor=1.0), shield overshoot floor −maxShield×0.1 |
| Beam damage | `beam_plugin.ts` | FUN_00437780 / FUN_00437e20 / FUN_00435830 | APPROXIMATED | binary: per-frame hits, damage decays max(0, base − steps), steps +1 per wd[+0x1a] frames per firing; port scales delta_ms*30/1000 (≈1/frame) and never decays ⇒ over-damages sustained beams |
| Blast/splash | `blast_plugin.ts` | FUN_00435830 (+FUN_00437780) | APPROXIMATED | binary: SQUARE blast range (|dx|,|dy| ≤ radius); only the player (slot 0) takes own blast (NPCs immune unless flag 0x100); projectile blasts double-dip (direct + splash), beam blasts don't. Port: circular hull, uniform self-blast rule, never double-dips |
| AI targeting (AggroRange) | `npc_ai_plugin.ts` | FUN_0040e020 (+FUN_00405590 state machine, FUN_00402e50 decisions) | APPROXIMATED | binary acquisition (FUN_0040e020): candidates = ships with FUN_004101d0 enemy test (govt mutual-enemy classes govt+0x26 vs +0x36, or xenophobic flag 0x1 vs non-allied), plus related-govt "police assist" (target whoever attacks a same/allied-govt ship) plus nearest ship attacking me/mine as fallback (FUN_0040faa0); range = dist² ≤ FUN_00411800(me) × govt.MaxOdds(float govt+0x60) — strength-scaled, NO fixed radius table; winner = min dist², ties lowest slot index, no player preference for interceptors. Player additionally needs |dx|,|dy| ≤ slot+0xc8cc × 600 (aggress square) + per-system legal-record checks (record < −crimeTol; ×−2 / ×−1.5 (double, DAT_00575130) variants; war-with-system-govt always). Port: AGGRESS_RADII=[1000,1000,3000,8000,8000] circular radius + interceptor-prefers-player — wrong model and values |
| Retaliation | `npc_ai_plugin.ts` | FUN_004192d0 (damage) + FUN_00402e50 anger | APPROXIMATED | binary: anger slot+0x96 += damage; retaliates when attacker govt ≠ mine (regardless of declared war!), suppresses: same govt, same owner/fleet, player-attacker clean in this system (crimeTol×2 ≤ record) and not targeting me, derelict govt 0x800, independent (govt −1) retaliate vs player-owned only; also FUN_0040faa0 fallback targets whoever attacks me/mine regardless of govt. Port gates on govtsAreEnemies/playerIsHostile — MORE restrictive than binary (deliberate anti-melee deviation) |
| Flee (coward) | `npc_ai_plugin.ts` FleeSystem | FUN_00402e50 | APPROXIMATED | binary: threshold from slot+0xc8cc (aggress): 1 → 30% (double 0.3 @DAT_00575048), 2 → 15% (0.15 @DAT_00575050) of maxShield, else never; përs: coward% × 0.01 × maxShield (0.01 @DAT_00575020). Gates: has target, ownerless (+0x9a == −1), govt flag 0x0010 "retreats", state ∉ {2,3,0xb}; OR class flag shïp+0x9ea & 0x80 + weaponless (FUN_004138a0). Flee = AI state 3, lasts until target gone (then re-decides, anger cleared) — not sticky. Port: coward=50 only for aiType 1, sticky forever |
| Trader travel | `npc_ai_plugin.ts` TraderTravelSystem | FUN_0040c790 (planet pick) + FUN_00405590 state 1/0x14 | APPROXIMATED | binary: rand(16) rejection over the system's spöb list — requires |x|,|y| < 1000 reachable, spob not hostile-govt (FUN_0046bdf0), govt flags2 0x20/0x40/0x80 preference overrides; arrival when |dx|,|dy| ≤ spob radius/4 (FUN_00462410), then lands (despawns into planet) after rand(200)+300 frames (or rand(75)+100 if shïp+0x9ec & 2) wait; re-decides from state 0 each time. No 10s re-roll timer; traders LAND, port shuttles forever with fixed ARRIVAL_DISTANCE=400 |
| AI types (dûde 0-4) | `dude.ts` makeDudeShip | FUN_0041ba80 (dude spawn), FUN_004235c0 (përs), FUN_004254b0/4259b0 (fleet/mïsn) | APPROXIMATED | binary slot+0x88 = AI type; dûde AI 0 → shïp+0x12 inherent AI (exact falsy-‖ match with port dude.ts:99-101); AI gates: retaliation needs AI > 0, police-assist needs AI < 5, on target-out-of-range AI > 2 pursues else jumps out (FUN_00415b80/410670), escorts inherit flagship AI clamped ≤ 3, 5 = escort, 6 = mission special. Interceptor (4) has NO player preference at acquisition — differences are movement/orbit/buzz (state 7) + no-jump-away. Aggress (slot+0xc8cc) is INDEPENDENT of AI type: dûdes roll rand(3)^2 ∈ {0,2,3} (FUN_004683b0(3), rng low16×3>>16), përs = përs.Aggress clamped 1-2, 3→4. Port hardcodes aggress 2 and coward-by-AIType — diverges |
| NPC random target | `npc_plugin.ts` | — | UNKNOWN | port-only fallback layer (ChooseRandomTargetAI interval 10000ms); binary has no equivalent — acquisition is FUN_0040e020 |
| Guidance | `guidance.ts` | — | UNKNOWN | binary fire control not yet located (FUN_00413610 = bribe/flee-from-player check, not aiming) |
| Ionization | `ionization_plugin.ts` | FUN_0046f3f0 | APPROXIMATED | slot+0x5c += weapon ionization (full on direct hit); color flags OR'd at slot+0xb0; splash ionization has circular falloff (port applies full — minor) |
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
| Fleet/pers ambient govt gate | — | — | REMOVED | the binary has no such gate; fleet/përs eligibility is pure linkSyst + activateOn + alive. Root cause of the old melee is fixed upstream: the dominant dûde branch now spawns the system's own dûdes with dûde govt, so fleet/përs stay at their true 6/49 + 1/7 share |
| System government | `novadatainterface/SystemData.ts` (`government`), `novaparse/.../SystemParse.ts` | sÿst+8 | VERIFIED | runtime +8 ← raw sÿst+0x66, parsed to SystemData.government (0x80-based band, -1 = none; stock: raw +0x66 = 128/147/...; 91 systems have -1) |

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
2. ~~**Dude branch FUN_0041ba80**~~ — PORTED (ambient_plugin.ts; see table row). Sÿst dûde pairs / roll count / government / përs peripherals parse via SystResource + SystemParse.
   ported. Requires dûde + sÿst parsing (backlog item 1).
3. ~~**Combat damage path** (projectile/beam/blast)~~ — AUDITED (see combat table): projectile friendly-fire + shield/armor order VERIFIED; beam decay, blast shape/self-blast/double-dip diverge (APPROXIMATED); prox-safety window has no verified binary counterpart.
4. ~~**AI targeting / retaliation radii**~~ — AUDITED (see combat table): no radius table exists in the binary; acquisition is FUN_0040e020 (strength×MaxOdds dist² + aggress×600 player square + legal record), flee thresholds are aggress-driven (0.3/0.15), retaliation is govt-difference-driven. Port rows marked APPROXIMATED with the real model recorded.
5. **Mission availability / stellar filters** — govt-band +127 shift verified
   against stock mïsn, but edge cases (30000/31000 bands) are inferred.
6. **Scanning / smuggling** — crimeTol gate shared with player hostility; not
   independently audited.
7. **Combat rating / ranks interplay** — deactivateRanksOnShipLoss only wires the
   DESTROY half (DISABLE half unwired).
