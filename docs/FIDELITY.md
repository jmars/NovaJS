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
| Fleet spawn | `fleet_plugin.ts` | FUN_00425280 / FUN_004259b0 | PORTED | rand(256) into the 256-slot flët table; a hit warps in the whole flët (lead + escort groups, group count = min + rand(max−min+1)). Every ship carries the FLËT's own govt (FUN_004259b0: slot+0x98 = flët record +2 — never the ship class's inherent govt) and rolls aggress rand(3)² (FUN_004254b0); only 6/49 of ambient rolls reach this branch |
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
| AI targeting (AggroRange) | `npc_ai_plugin.ts` | FUN_0040e020 (+FUN_00405590 state machine, FUN_00402e50 decisions) | PORTED | pass 1 police-assist (AI < 5): take the first assistable victim an allied (FUN_0046bc90) ship holds, odds-checked, early-return; pass 2 the player inside the aggress SQUARE (|·dx|·,·|·dy|· ≤ aggress × 600) when hostile (govt flag 0x40 clear + legal record); pass 3 general scan over FUN_004101d0 enemies (FUN_0046bdf0: mutual-enemy classes, xenophobia 0x1 either side vs non-allied, derelict 0x800 skip, player excluded) with the ODDS FILTER — a candidate is dropped when its group strength (FUN_00411800: Σ shïp Strength × shield fraction over self/escorts/allies, ×2 for allies attacking me) exceeds mine × govt.maxOdds/100; there is NO NPC-vs-NPC distance cap, the odds filter IS the range; winner = min dist²; pass 4 fallback (FUN_0040faa0) = nearest ship attacking me/mine, any govt. Remaining approximations: legal-record paths simplified to playerIsHostile (record < −crimeTol; the binary's per-system ×1.5/×2 bands and the independent 1/50 path are not modeled); no pursue-attention memory after target loss |
| Retaliation | `npc_ai_plugin.ts` | FUN_004192d0 (damage) + FUN_00402e50 anger | PORTED | retaliation is govt-DIFFERENCE-gated — ANY different-govt attacker, declared war NOT required. Suppression cascade (any hit ⇒ no target, no anger): same govt id; independent (govt null) victim hit by anyone but the player/player-owned; player-attacker stray-fire amnesty (system govt exists, player not targeting me, 2 × crimeTol ≤ record keyed by the system's govt id); same owner; my govt derelict 0x800. On retaliation anger (+0x96) += armor+shield damage and the shooter becomes the target while it lives. Approximations: DamagedEvent carries nominal (not applied) damage; escort (FUN_00412530) and bribe-path suppressions not modeled (escorts strip AIConfig) |
| Flee (coward) | `npc_ai_plugin.ts` FleeSystem | FUN_00402e50 | PORTED | threshold = përs coward% × 0.01 × maxShield (0.01 @DAT_00575020), else aggress (slot+0xc8cc) 1 → 30% (0.3 @DAT_00575048), 2 → 15% (0.15 @DAT_00575050), else never. Gates: live target, ownerless (no OwnerComponent — escorts never flee), govt flag 0x0010 "retreats". NOT sticky: AI state 3 lasts while the target lives (the target itself is kept, +0x70), then un-flee + anger cleared and re-decide. Approximation: the class-flag shïp+0x9ea & 0x80 + weaponless (FUN_004138a0) second trigger is not modeled (no raw shïp flags2 in ShipData) |
| Trader travel | `npc_ai_plugin.ts` TraderTravelSystem | FUN_0040c790 (planet pick) + FUN_00405590 state 1/0x14 | PORTED | destination = rejection draw rand(16) (bounded 1000, then FUN_00415b80 jump-out = despawn for AI 1-2; AI 3/4/6 park and retry at the re-decide cadence) over the system's planets with |x|,|y| < 1000 and a non-hostile govt; arrival = square |·dx|·,·|·dy|· ≤ PlanetData.radius/4 (radius = spöb sprite half-size, engine default 150); on arrival park rand(200)+300 frames (× 1000/30 ms) then re-decide — drawing the spöb just visited means LAND (state 0x14, the trader despawns into the planet). Approximations: govt-flags2 spöb-category prefs (0x80/0x40/0x20) omitted (no raw spöb flags2 in PlanetData); shïp+0x9ec & 2 rand(75)+100 wait variant not modeled |
| AI types (dûde 0-4, mïsn 6) | `dude.ts` makeDudeShip | FUN_0041ba80 (dude spawn), FUN_004235c0 (përs), FUN_004254b0/4259b0 (fleet/mïsn) | PORTED | slot+0x88 = AI type; dûde AI 0 → shïp+0x12 inherent AI (falsy-‖, dude.ts); AI 1-2 jump out on target loss (ported as silent despawn), 3-4 just re-decide, 6 = mission special (mission_ship_plugin pins aiType 6 — acquires/retaliates like a warship, never jumps out); aggress is rolled per spawn rand(3)² ∈ {0,2,3} for dûde ships and every flët/mïsn ship (FUN_004254b0), while përs carry the clamped përs+6 value (<1→1, >2→4) with NO roll (FUN_004235c0 writes it directly); AIConfig coward comes only from the përs. The legacy random-target layer (ChooseRandomTarget) is kept for aiType-0 ships only — see row 52 |
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
4. ~~**AI targeting / retaliation radii**~~ — DONE (audit + port): no radius table exists in the binary; acquisition is FUN_0040e020 (odds filter on FUN_00411800 group strength + aggress×600 player square + legal record), flee thresholds are aggress-driven (0.3/0.15), retaliation is govt-difference-gated. Combat-table AI rows (47-51) are PORTED with the remaining approximations noted inline.
5. **Mission availability / stellar filters** — govt-band +127 shift verified
   against stock mïsn, but edge cases (30000/31000 bands) are inferred.
6. **Scanning / smuggling** — crimeTol gate shared with player hostility; not
   independently audited.
7. **Combat rating / ranks interplay** — deactivateRanksOnShipLoss only wires the
   DESTROY half (DISABLE half unwired).
