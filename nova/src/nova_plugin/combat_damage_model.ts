// Pure reference model of the binary's combat damage application, for a
// side-by-side trace harness (combat_damage_trace_test.ts): a deterministic
// numeric model (EV Nova combat has no damage-variance LCG roll — a weapon's
// damage is applied as-is) that the port's damage systems must reproduce
// exactly.
//
// Two surfaces are modelled:
//
//   [a] the damage application (the port's DeathPlugin.DamageSystem): route
//       weapon damage to shield first, then armor. EV Nova shield points
//       absorb shield damage; once the shield is depleted the remaining
//       armor damage hits armor (armor never goes below 0; shield CAN — the
//       floor is enforced separately by recharge, not at apply time). A
//       point-defense projectile striking a shieldless target scales its
//       armor damage by +shield/2 (FUN_0042f270's point-defense path).
//       passThroughShield weapons skip the shield entirely.
//
//   [b] beam damage decay (the port's BeamCollisionSystem): a beam hits for
//       its full (decaying) damage every overlapping frame; each decay
//       interval (FUN_00435830's wd[+0x1a] counter, effective decay+1
//       frames) subtracts one from both shield and armor damage, floored at
//       0 (FUN_00437780 applies max(0, base - steps)).
//
// No randomness, so the comparison is purely numeric (not an LCG-stream
// fingerprint like the ambient trace).

import { WeaponDamage } from "novadatainterface/WeaponData";

// The target's hull state the damage application reads.
export interface DamageTarget {
    shield: { current: number, max: number };
    armor: { current: number };
}

export interface DamageResult {
    shield: number;
    armor: number;
    zeroArmor: boolean;
}

// [a] DamageSystem: apply weapon damage to shield then armor. `isProjectile`
// is true when the DAMAGED ship is a point-defense-vulnerable projectile
// (the port's Optional(ProjectileComponent) arg).
export function applyDamage(damage: WeaponDamage, target: DamageTarget,
    isProjectile: boolean, scale = 1): DamageResult {
    let shield = target.shield.current;
    let armor = target.armor.current;
    const hasShield = target.shield.max > 0;
    // Point-defense scaling: a shieldless projectile takes +shield/2 armor
    // damage (the target's shield component is absent or maxed at 0).
    let armorDamage = damage.armor;
    if (isProjectile && !hasShield) {
        armorDamage += damage.shield / 2;
    }
    // Shield absorbs shield damage unless the weapon passes through.
    if (!damage.passThroughShield) {
        shield -= damage.shield * scale;
        if (shield > 0) {
            return { shield, armor, zeroArmor: false };
        }
    }
    armor = Math.max(0, armor - armorDamage * scale);
    return { shield, armor, zeroArmor: armor === 0 };
}

// EV Nova's fixed 30fps tick (the beam decay interval base).
export const FRAME_MS = 1000 / 30;

// [b] Beam decay step count: the weapon tick increments a decay step every
// decay+1 frames (the counter only overflows strictly past the interval,
// then resets to zero), while the beam is firing. Returns 0 for decay <= 0.
export function beamSteps(timeSinceFireMs: number, decayMs: number): number {
    if (decayMs <= 0) {
        return 0;
    }
    return Math.max(0, Math.floor(timeSinceFireMs / (decayMs + FRAME_MS)));
}

// [b] The beam's decayed damage for a given step count: both shield and
// armor damage drop by `steps`, floored at 0 (FUN_00437780).
export function decayedBeamDamage(base: WeaponDamage, steps: number):
    WeaponDamage {
    return {
        ...base,
        shield: Math.max(0, base.shield - steps),
        armor: Math.max(0, base.armor - steps),
    };
}
