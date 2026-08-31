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
| Ambient ship manager | `nova/src/nova_plugin/ambient_plugin.ts` | FUN_0041af90 | VERIFIED | Population-event driven: one burst per jump-in (fresh world per jump) + one per land cycle at the LANDING transition (LandEvent queues it; liftoff/boarding never repopulate — FUN_0041af90's only in-flight caller is FUN_00457580, called once from the player tick on the first frame the land key holds; the other 6 callers are death/reset, jump-arrival, main screen, load pilot, new game). Each burst runs the sÿst+0x64 ambient rolls (stock 0-10, median 3) with the binary's single rand(7) routing: rand(7)==0 → përs (FUN_004235c0), else rand(7)==0 → flët (FUN_00425280), else dûde (FUN_0041ba80). sÿst Peripherals pairs run first at rand(100)+1 <= percent. Spawn positions are system-relative: dûde ships scatter rand(1500)-750 around the system origin (0,0) (FUN_0041ba80; FUN_004254b0 tail likewise; AI==3 ships anchor to spob-0 x/y), flët leads at spob x/y else origin (FUN_004259b0). No per-frame pass (the old every-30-frames port pass is removed) |
| Fleet spawn | `fleet_plugin.ts` | FUN_00425280 / FUN_004259b0 | PORTED | rand(256) into the 256-slot flët table; a hit warps in the whole flët (lead + escort groups, group count = min + rand(max−min+1)). Every ship carries the FLËT's own govt (FUN_004259b0: slot+0x98 = flët record +2 — never the ship class's inherent govt) and rolls aggress rand(3)² (FUN_004254b0); only 6/49 of ambient rolls reach this branch |
| Pers spawn | `pers_plugin.ts` | FUN_004235c0 | VERIFIED | rand(1022); pers.govt; only 1/7 of rolls reach this branch |
| Dude branch | `nova/src/nova_plugin/ambient_plugin.ts` (+`dude.ts` weightedPick, `SystemData.dudePairs`) | FUN_0041ba80 | PORTED | 36/49 of ambient rolls (dominant). Weighted-picks a dûde entry from the sÿst's 8-pair list (FUN_0046b600, raw counts as weights), then a (ship class,count) pair from the dûde's 16 pairs (FUN_0046b4b0), spawns ONE ship with dûde govt + AI (makeDudeShip). Slot search 1..55 → port counts ship entity keys (DUDE_SLOT_LIMIT=55). Draw counts inside the two weighted picks + the ±750 scatter are port-defined (binary internals not recovered) |
| System arrival | — | FUN_00456480 | UNKNOWN | — |
| Despawn (ambient) | `nova/src/nova_plugin/ambient_plugin.ts` (AmbientDespawnSystem) | FUN_004687b0 | APPROXIMATED | ambient-keyed ships (fleet-ship/pers-ship/dude-ship) silently deleted beyond max(2400, top-speed×8) from the player each frame; binary's exact speed-scaled threshold has unrecoverable operand units (100.0/-0.241/0.0). Govt flag 0x800 immediate-remove case DEFERRED (flags/flags2 word mapping unresolved); mission overrides not modeled — mission-ship/escort keys are never despawned |

### Combat

| Subsystem | Port file | Binary fn(s) | Status | Notes |
|---|---|---|---|---|
| Projectile damage | `projectile_plugin.ts` | FUN_0042f270 → FUN_004192d0 | APPROXIMATED | owner-skip rules match (shooter itself, shooter's owner, targets owned by shooter; −1/0xffff sentinels ⇒ ownerless still hits); shield→armor order, passThroughShield = flags bit 0x20. PORTED: moving-toward angular gate |ΔangleDeg| ≤ round(spriteWidth×0.66)×10/32 (port proxies sprite width with the hull bbox, normalizes the 360° wrap the binary lacks), shield overshoot floor −maxShield×0.1 (DAT_00575208), proxSafety launch window removed (no binary counterpart). Missing in port: friendly no-disable clamp (armor=1.0) |
| Beam damage | `beam_plugin.ts` | FUN_00437780 / FUN_00437e20 / FUN_00435830 | PORTED | per-frame hits at full (decaying) damage; steps = floor(elapsedFrames / (decayFrames + 1)) — FUN_00435830's counter overflows strictly past wd[+0x1a] (weap 0x22, parsed as `decay` ms) and resets to zero, so the effective period is decay + 1 frames; damage clamps at 0; decay 0 = never decays. Not ported: beam charge window (charge < duration − proxSafety) and spob direct-damage path FUN_00437e20 |
| Blast/splash | `blast_plugin.ts` + `projectile_plugin.ts` | FUN_00435830 (+FUN_00437780) | PORTED | SQUARE blast hull (|dx|,|dy| ≤ radius); only the player (slot 0) takes own blast (NPCs immune unless flag 0x100); projectile blasts double-dip (direct + splash both apply — no direct-victim ignore). Not ported: beam splash loop (FUN_00437780) — beams create no blast entity; blast splash falloff is uniform in both |
| AI targeting (AggroRange) | `npc_ai_plugin.ts` | FUN_0040e020 (+FUN_00405590 state machine, FUN_00402e50 decisions) | PORTED | pass 1 police-assist (AI < 5): take the FIRST assistable victim an allied (FUN_0046bc90) ship holds, odds-checked, and RETURN immediately (FUN_0040e020 sets target + state 4 and returns — no min-dist competition with passes 2/3); pass 2 the player inside the aggress SQUARE (|·dx|·,·|·dy|· ≤ aggress × 600) — EXACT legal gate RE’d (read-only pass) (FUN_0040e020 @0x40e4xx–0x40e9xx; replaces playerIsHostile): gates = govt[me].byte@0x84==0 (FUN_0046e860(me,0)), flag 0x40 clear, canTarget, then per-SYSTEM record rec=(short)DAT_00733bc8[sysIdx] (array indexed by SYSTEM, not govt): myGovt==sysGovt → rec < −crimeTol; sysGovt<0 → (flags&2) && rec < −2×crimeTol; at-war (FUN_0046bdf0) → crimeTol < rec; allied (FUN_0046bc90) → rec < −1.5×crimeTol (dbl 1.5 @DAT_00575130); neutral → (flags&2) && rec < −2×crimeTol (crimeTol = gövt +0x46 short; flags = gövt +0x20). Independent 1/50 path: me.+0x9a!=0, no mïsn slot (+0xc8d2==−1), +0x8a==−1, at war with runtime govt of player’s system (DAT_005912a4+0x9f4+playerSys×0xabc != −1; playerSys = player slot +0x76) && rand(50)==0 → target regardless of square. Post-vetoes both branches: gövt +0x83 byte nonzero or FUN_0046e860(me,0)!=0 ⇒ cancel player candidate. Records are per-system: mission deltas propagate by govt (same govt += d; allied += 0.5×d dbl@DAT_00575500; at-war −= 0.5×d) and ripple to adjacent systems (FUN_00467970); pass 3 general scan over FUN_004101d0 enemies (FUN_0046bdf0: mutual-enemy classes, xenophobia 0x1 either side vs non-allied, derelict 0x800 skip, player excluded) with the ODDS FILTER — a candidate is dropped when its group strength (FUN_00411800: Σ shïp Strength × shield fraction over self/escorts/allies, ×2 for allies attacking me) exceeds mine × govt.maxOdds/1000 (the raw gövt +0x60 value is PER-MILLE, loader-confirmed: stock 125–350 ⇒ ×0.125–0.35, NOT /100); there is NO NPC-vs-NPC distance cap, the odds filter IS the range; winner = min dist²; pass 4 fallback (FUN_0040faa0) = nearest ship attacking me/mine, any govt. Remaining approximations: legal-record paths simplified to playerIsHostile (record < −crimeTol; stands in for the FUN_0046e860(govt,0) attack-player gate at the confirmed pass-2 call site — the binary's per-system ×1.5/×2 bands and the independent 1/50 path are not modeled); no pursue-attention memory after target loss |
| Retaliation | `npc_ai_plugin.ts` | FUN_004192d0 (damage) + FUN_00402e50 anger | PORTED | retaliation is govt-DIFFERENCE-gated — ANY different-govt attacker, declared war NOT required. Suppression cascade (any hit ⇒ no target, no anger): same govt id; independent (govt null) victim hit by anyone but the player/player-owned; player-attacker stray-fire amnesty (system govt exists, player not targeting me, 2 × crimeTol ≤ record keyed by the system's govt id); same owner; my govt derelict 0x800. On retaliation anger (+0x96) += armor+shield damage and the shooter becomes the target while it lives. Approximations: DamagedEvent carries nominal (not applied) damage; escort (FUN_00412530) and bribe-path suppressions not modeled (escorts strip AIConfig) |
| Flee (coward) | `npc_ai_plugin.ts` FleeSystem | FUN_00402e50 | PORTED | threshold = përs coward% × 0.01 × maxShield (0.01 @DAT_00575020), else aggress (slot+0xc8cc) 1 → 30% (0.3 @DAT_00575048), 2 → 15% (0.15 @DAT_00575050), else never. Gates: live target, ownerless (no OwnerComponent — escorts never flee), govt flag 0x0010 "retreats". NOT sticky: AI state 3 lasts while the target lives (the target itself is kept, +0x70), then un-flee + anger cleared and re-decide. Approximation: the class-flag shïp+0x9ea & 0x80 + weaponless (FUN_004138a0) second trigger is not modeled (no raw shïp flags2 in ShipData) |
| Trader travel | `npc_ai_plugin.ts` TraderTravelSystem | FUN_0040c790 (planet pick) + FUN_00405590 state 1/0x14 | PORTED | destination = rejection draw rand(16) (bounded 1000, then FUN_00415b80 jump-out = despawn for AI 1-2; AI 3/4/6 park and retry at the re-decide cadence) over the system's planets with |x|,|y| < 1000 and a non-hostile govt; arrival = square |·dx|·,·|·dy|· ≤ PlanetData.radius/4 (radius = FULL spöb sprite base-frame width, rlëD size[0] — FUN_00462410→FUN_00462390 returns frame-rect right−left; port's /2 is 2× small — engine default 150 @FUN_00462410, 32 @FUN_00462390); on arrival park rand(200)+300 frames (× 1000/30 ms) then re-decide — drawing the spöb just visited means LAND (state 0x14, the trader despawns into the planet). RE-RESOLVED, port pending: govt-flags2 (raw govt+4 → rt+0x22) prefs are FORCED picks in FUN_0040c790 — 0x80 restricts to spöb flags2 0x2000, 0x40 to 0x1000 (0x80 wins, only if a valid candidate exists; raw spöb flags2 = u16 @0x20 → rt+0x34), 0x20 vetoes 0x1000 in the general path; wait variant: shïp raw 1830 (→rt+0x9ec) bit 0x2 ⇒ park rand(75)+100 else rand(200)+300 (FUN_00405590) |
| AI types (dûde 0-4, mïsn 6) | `dude.ts` makeDudeShip | FUN_0041ba80 (dude spawn), FUN_004235c0 (përs), FUN_004254b0/4259b0 (fleet/mïsn) | PORTED | slot+0x88 = AI type; dûde AI 0 → shïp+0x12 inherent AI (falsy-‖, dude.ts); AI 1-2 jump out on target loss (ported as silent despawn), 3-4 just re-decide, 6 = mission special (mission_ship_plugin pins aiType 6 — acquires/retaliates like a warship, never jumps out); aggress is rolled per spawn rand(3)² ∈ {0,2,3} for dûde ships and every flët/mïsn ship (FUN_004254b0), while përs carry the clamped përs+6 value (<1→1, >2→4) with NO roll (FUN_004235c0 writes it directly); AIConfig coward comes only from the përs. The legacy random-target layer (ChooseRandomTarget) is kept for aiType-0 ships only — see row 52 |
| Interceptor comm-scan (AI 4) | `npc_ai_plugin.ts` | FUN_00403de0 (AI-4 brain, dispatch FUN_00401000 @0x401666-81), FUN_00464a90, FUN_00401800 | APPROXIMATED | AI 4 uses EXCLUSIVELY brain FUN_00403de0 (AI 3 → FUN_00402e50); movement executors FUN_00405590/FUN_00408150 are shared — no AI-4 orbit/buzz in attack movement. Unique: idle (states 0/1/0x14, +0x4c expired, no target) → scan a random VISIBLE alive same-system non-interceptor ship (rand(64) rejection, ≠ last-marked +0x90) → state 7, fly at it (substate 9) to within 100px square (DAT_0057501c); player → FUN_00401800 hail (76% rand(100)≤75, govt+0x48 greeting, anti-refire) then idle; NPC → silent drop. Scan targets get NO pursuit memory (invisible → drop); FUN_0040e020 runs every tick during state 7 but failed acquisition RESTORES the scan target. Rare scan-duty mode +0xc8d0=0x3ff (spawner FUN_0046ac50 forces AI 4): gate sÿst[curSys]+0xab8 (0/1 'player clear here') × DAT_0059799e (difficulty const) > 30 → attack on sight (state 4, anger 1), else scan: comm 30000#(rand(3)+2) 360 frames then jump out. State-7+substate-0xc 48px orbit block (FUN_00408150 @0x40b7d1) reachable only in escort edge — skip. Stale lead corrected: state 7 never sets +0xc91c (sensor-lock flag from FUN_00428340, only widens cloaked visibility to 200px via FUN_00464a90). Also: AI-4 flee-under-fire govt flag is 0x100 (warship 0x10) |
| Pursuit memory (AI 3/4 target lost) | `npc_ai_plugin.ts` | FUN_00405590 @0x4057f0-0x405913 | APPROXIMATED | In attack states 4/0xd with target alive but invisible (FUN_00464a90): AI > 2 KEEPS the target ref, substate 1 = brake to a full stop (anti-velocity burn / retro ×0.5, damp < 0.35 speed) and loiters rand(100)+100 ticks (float timer +0xc90c, sentinel −1.0f, decremented by frame delta); visibility regained → resume attack + re-arm timer; expiry → drop target, state 0, re-acquire via idle path. AI ≤ 2: no memory — jump out if hyperdrive (FUN_00415b80→FUN_00410670) else state 6. Dead (+0xb8=0) or disabled (FUN_004688e0) targets dropped immediately, no memory |

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
| Spaceport screen/dispatch | `spaceport/spaceport.ts` | FUN_00491f30 (modal dialog 1000; buttons: 7 trade flags&2 FUN_0048c730, 8 outfitter flags&4 FUN_0048ea70, 9 shipyard flags&8 FUN_00492f30, 10 BBS (inhabited, flags&0x20==0) FUN_0043c470, 0xb bar flags&0x40 FUN_0047c8e0, 0xf AvailLoc-3 auto-offer FUN_00448670(3) on timer DAT_00776af4=rand(30)+ticks+30) | APPROXIMATED | spöb flag gating matches; sub-screen layering does not (see z-order) |
| Spaceport z-order | `spaceport/spaceport.ts` | FUN_00492c40 (redraw): dialog bg → landing pict → item-3 spöb spin sprite (FUN_004622f0, spob+0x48) → item-5 govt banner (FUN_004bc2a0(spob+0x28)) → item-6 landing dësc text → buttons → sub-screens are SEPARATE MODAL DIALOGS on top | BUG (port) | port build() adds sub-dialog containers (spaceport.ts:400-407) BEFORE facility buttons (:410-461) ⇒ PIXI renders buttons over open panels; binary sub-screens cover everything. Fix: add sub-dialogs after all addButtons |
| Mission briefing | `spaceport/briefing.ts` | FUN_00442510 (briefing runner; sets pict global DAT_007353f0), FUN_0043f100 (accept: STR# 2002[355]/[356] cargo recheck, upfront pay when field<-50000, on-accept dësc +0x35, pickup dësc +0x39, then re-filters both offer lists) | APPROXIMATED | accept-side effects ported via state machine; list re-filter after accept not ported |
| Mission BBS | `spaceport/mission_bbs.ts` | FUN_0043cf00 (queue builder, 2 passes over mïsn 0..999: DAT_00774308=0 → BBS list DAT_00598414 availLoc==0 only; =1 → bar/other list DAT_00598BE4 availLoc!=0; sorted dispWeight (+0x128) DESC stable; run per landing from FUN_00457580 @0x458822), FUN_0043c470 (BBS screen: dialog 1006 + PICT **8505**; empty ⇒ STR# 2002[351]+name+[352] / [353]), FUN_00441b40 (availability), FUN_00448670(loc) (pop one from queue for loc 1-6, tried-flags DAT_00773eed) | APPROXIMATED | port: panel pict 8502 vs binary 8505; empty state shows nothing vs binary STR# dialogs; no list re-filter after accept; port rule 10 blocks completed/failed (binary only blocks already-active of 16) |
| Mission availability | `missions/availability.ts` | FUN_00441b40 (misn runtime DAT_0077f62c stride 300: +00 availStel +02 availLoc +04 availRecord +06 availRating +08 availRandom +0A freeCargo +18/+1A flags +1E availShipType +124 cargoReq +128 dispWeight; 10 checks ANDed; top guard availRandom<1 ⇒ never) | APPROXIMATED | engine matches (headless probe over 791 stock missions). Divergences: (1) negative AvailRecord: binary passes iff record<=availRecord, port availability.ts:135 passes record<=-availRecord (too lenient); (2) AvailShipType bands: binary fly 128-896, NOT-fly 1128-1896, escort-slot bands 2128-2384/3128-3400 (shïp +0x9f4/+0x9f6), else pass — port 1128/2128 boundaries differ; (3) no completed/failed gate in binary |
| AvailRandom rolls | `player/player_state.ts`, `nova_plugin/jump_plugin.ts` | FUN_00457580 @0x458800 (per-LANDING re-roll: DAT_00734C20[i]=FUN_004683b0(100)+1 → 1..100 over 1000 mïsn, then rebuild queues); FUN_0044aa70 @0x44f871 (new-game/load path); FUN_00441b40 passes iff roll<=availRandom | **BUG (port)** | port seeds rolls ONLY on jump (jump_plugin.ts:110) and starts empty (createNewPilot `availRandomRolls: {}`) ⇒ before the first jump EVERY availRandom<100 mission fails rule 5 ⇒ NO BBS/bar offers at game start (stock: only 4 always-on AvailLoc-0 missions). Fix: re-roll on landing + seed at new game/load. Probability equivalent (port 0..99 + `<` = binary 1..100 + `<=`) |
| Bar | `spaceport/bar.ts` | FUN_0047c8e0 (dialog 1013 + PICT 8503, or 1021 + custom pict when DAT_007353f0>=0x80; welcome text = dësc 10000+spobGovt; buttons: 2 gamble FUN_0047dc50 (dialog 1023 + PICT 8529+, bet min(credits,1000), win rand(4)==pick ⇒ 4×), 3 news/rumors, 5 shipyard contact, 6 offer ONE mission via FUN_00448670(1), 10 mission info) | **BUG (port)** | port bar = BBS clone (pict 8502) and MissionBBS.showOffers early-returns on empty ⇒ NO bar UI ever. Binary always opens the bar screen (drinks/rumors/missions); offers pulled one-per-press from the availLoc!=0 queue; port restricts to availLoc==1 exactly |
| Stellar filters (decode + match) | `missions/stellar_filter.ts` | FUN_00447a30 (system matcher), FUN_00441b40 (availability, AvailStel block), FUN_0043d510/FUN_0043e6f0 (destination pickers), FUN_0046bc90/bdf0/bff0 (relations) | VERIFIED w/ noted quirks | +127 shift PROVEN (binary debug prints govt as code−9872…=index+128; runtime govt ids are 0-based gövt table indices). Bases 9999/15000/20000/25000/30000/31000 all CONFIRMED; band widths 5000×4 then 1000×2 (not +2048); code 9999 = govtless. System matcher −1/−6 = player's CURRENT system, −2 = travel-dest system, −3 = return-dest system, −4/−5 never match. Near band 5000..9998; AvailStel near checks LINKS ONLY (not self). Binary bug @0x441e26: AvailStel 31000 band passes code−30000 to FUN_0046bff0 (bounds always fail) ⇒ degenerates to "any landed spöb with a govt" — port is stricter (intended semantics). Classmates (FUN_0046bff0) is POSITIONAL class-slot equality, not set intersection. APPLIED 2024 (handoff-stellar-fix): band widths/caps, govtless 9999, positional classmates, system bands keyed on the system's OWN govt, AvailStel near = links-only, −1/−6 = current system. Remaining gaps: planet-band allies/enemies still use the plain relation helpers (binary band code adds equality + PerBinary 0x800/reverse/xenophile terms); AvailStel specific band lacks the FUN_0046b920 chain-resolve; AvailStel −1 requires inhabited (binary passes unconditionally); binary's degenerate 31000 AvailStel band deliberately not replicated |

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
   RE-VERIFIED (landing-repop audit, byte-level): the later reading that the
   +0x44..0x63 table is "16 per-spob flët ids" is WRONG. Proof: FUN_0046b600
   loops slots **0..7 only**, reading ids at runtime sÿst+0x4a (= file +0x44,
   valid 0..0x1ff after the loader's 0x80 rebase = the 512-entry dûde table) and
   using the words at runtime +0x5a (= file **+0x54**) as weighted-pick
   weights; FUN_0041ba80 indexes the picked id into DAT_005912cc (stride 0x4a =
   the dûde runtime table), not the flët table (DAT_005914a4, 256 × 0x124,
   FUN_00425280; përs = DAT_005912d4, 1024 × 0x794, FUN_004235c0). Stock bytes
   agree: sÿst 128's +0x54 words are 30,10,12,5,12,10,1,20 (weights summing to
   100), not 0x80-based ids. FUN_0041ba80 spawns ONE dûde-branch ship per roll
   (first free slot 1..55), govt = dûde+2, AI = dûde+0 else shíd+0x12.
2. ~~**Dude branch FUN_0041ba80**~~ — PORTED (ambient_plugin.ts; see table row). Sÿst dûde pairs / roll count / government / përs peripherals parse via SystResource + SystemParse.
   ported. Requires dûde + sÿst parsing (backlog item 1).
3. ~~**Combat damage path** (projectile/beam/blast)~~ — AUDITED + FIXED (see combat table): beam decay, blast square range / player-only self-blast / projectile double-dip, shield −10% floor, and the FUN_0042f270 moving-toward angular gate (replacing the unverified prox-safety window) are ported; remaining approximations noted inline (friendly no-disable clamp, beam charge window, beam splash).
4. ~~**AI targeting / retaliation radii**~~ — DONE (audit + port): no radius table exists in the binary; acquisition is FUN_0040e020 (odds filter on FUN_00411800 group strength + aggress×600 player square + legal record), flee thresholds are aggress-driven (0.3/0.15), retaliation is govt-difference-gated. Combat-table AI rows (47-51) are PORTED with the remaining approximations noted inline.
5. ~~**Mission availability / stellar filters**~~ — AUDITED + FIXED (see UI
   table row "Stellar filters"). All six govt-band bases + the encoding
   (govt raw id = code − base + 128; bases 10000/15000/20000/25000/30000/31000,
   9999 = govtless) are byte-proven and now ported, with the system-matcher
   −1..−6 semantics, govt-band keying on the system's own govt, positional
   classmates, near-band 9998 cap + links-only AvailStel matching. Remaining
   (low-impact, documented in the table row): planet-band PerBinary relation
   terms, the FUN_0046b920 chain-resolve on AvailStel specific codes, and
   AvailStel −1's unconditional pass.
6. **Scanning / smuggling** — crimeTol gate shared with player hostility; not
   independently audited.
7. **Combat rating / ranks interplay** — deactivateRanksOnShipLoss only wires the
   DESTROY half (DISABLE half unwired).
