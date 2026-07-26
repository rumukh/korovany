/**
 * Layer 3 — what a beast *is*, as data.
 *
 * The chronicle already simulates beast pressure and beast raids without a single mesh
 * (`Chronicle.advanceBeasts`). This module is the other pure half: it says how many of
 * what comes out of the forest, how tough each one is, and when a pack decides the meal
 * is not worth it. `GameEngine` turns that into quadrupeds; nothing here knows about
 * THREE, the scene graph, or the actor list.
 *
 * Determinism: every roll takes a seeded `RandomStream`, exactly like the chronicle's.
 */

import type { RandomStream } from '../random/RandomStream.ts'
import { BEAST_ROLES, type BeastRole } from '../types.ts'
import { BEAST_RAID_THRESHOLD } from './Chronicle.ts'
import type { WorldRegion } from './worldTypes.ts'

export interface BeastProfile {
  role: BeastRole
  /** Base hit points before the threat-tier multiplier. */
  hp: number
  speed: number
  /** Poise budget: how much staggering it shrugs off. */
  poise: number
  meleeDamage: number
  colliderRadius: number
  /** Uniform mesh scale, so a bear reads as a bear from across the square. */
  scale: number
  /** How much of the pack has to fall before this one thinks about leaving. */
  routThreshold: number
}

/**
 * A wolf is cheap, fast and brave only in numbers; a boar is a one-note charger; a bear
 * is the brute profile with fur; a troll ignores people entirely and goes for the
 * buildings, which is what makes a beast raid a raid rather than a brawl.
 */
export const BEAST_PROFILES: Record<BeastRole, BeastProfile> = {
  wolf: {
    role: 'wolf',
    hp: 42,
    speed: 5.4,
    poise: 26,
    meleeDamage: 9,
    colliderRadius: 0.62,
    scale: 0.86,
    routThreshold: 0.5,
  },
  boar: {
    role: 'boar',
    hp: 70,
    speed: 4.6,
    poise: 46,
    meleeDamage: 14,
    colliderRadius: 0.74,
    scale: 0.95,
    routThreshold: 0,
  },
  bear: {
    role: 'bear',
    hp: 135,
    speed: 3.4,
    poise: 74,
    meleeDamage: 21,
    colliderRadius: 0.96,
    scale: 1.2,
    routThreshold: 0,
  },
  troll: {
    role: 'troll',
    hp: 165,
    speed: 2.9,
    poise: 88,
    meleeDamage: 24,
    colliderRadius: 1.05,
    scale: 1.34,
    routThreshold: 0,
  },
}

/** Wolves only keep their nerve while their own kind are around them. */
export const WOLF_PACK_RADIUS = 16
/** Share of raids that arrive as a pure wolf pack, with no wrecker leading. */
export const WOLF_PACK_CHANCE = 0.3
/** How long a routed wolf keeps running before it is willing to look back. */
export const BEAST_ROUT_SECONDS = 9
/** A boar winds up, then commits: it cannot steer once the charge starts. */
export const BOAR_CHARGE_RANGE = 14
export const BOAR_CHARGE_WINDUP = 0.55
export const BOAR_CHARGE_SPEED = 11.5
export const BOAR_CHARGE_DURATION = 1.05
export const BOAR_CHARGE_COOLDOWN = 4.5
export const BOAR_CHARGE_DAMAGE = 22
/** Beasts sniff further than a soldier looks. */
export const BEAST_SENSE_RANGE = 21
/** How far a beast will chase before it loses interest and goes back to the treeline. */
export const BEAST_LEASH_RANGE = 52

/** Pressure at which a region is worth a wandering beast, well under a full raid. */
export const AMBIENT_BEAST_PRESSURE = 0.45
/** Never more than this many prowlers at once, however loud the forest gets. */
export const AMBIENT_BEAST_LIMIT = 2

export interface BeastPackPlan {
  roles: BeastRole[]
  /** True when the pack had to be trimmed to fit the actor budget. */
  trimmed: boolean
}

export interface BeastPackContext {
  /** 0..1 chronicle beast pressure in the region the raid is happening in. */
  beastPressure: number
  biome: WorldRegion['biome']
  rng: RandomStream
  /** Actor slots the budget granted; the plan is trimmed to fit rather than refused. */
  maxCount: number
}

/**
 * What comes out of the forest, given how loud the forest has got.
 *
 * Most raids lead with a wrecker (troll in the mountains, bear in the woods), because a
 * beast raid that cannot hurt the settlement is just wildlife. Everything after that is
 * escort, and the pack grows with pressure.
 *
 * Some raids are **all teeth and no siege engine**: a pure wolf pack reads completely
 * differently, it is the only composition where the pack can break and run, and without
 * it the rout rule was measured firing in 0 of 120 shipped fights (§9). The roll is on
 * the seeded stream, so a given raid always arrives the same way.
 */
export function planBeastPack(context: BeastPackContext): BeastPackPlan {
  const pressure = clamp01(context.beastPressure)
  const limit = Math.max(0, Math.trunc(context.maxCount))
  const roles: BeastRole[] = []
  const escorts = pressure >= BEAST_RAID_THRESHOLD ? 3 : 2
  const wanted = limit <= 0 ? 0 : 1 + escorts

  if (context.rng.chance(WOLF_PACK_CHANCE)) {
    for (let index = 0; index < wanted && roles.length < limit; index += 1) {
      roles.push('wolf')
    }
    return { roles, trimmed: roles.length < wanted }
  }

  const wrecker: BeastRole = context.biome === 'fort' ? 'troll' : 'bear'
  if (limit > 0) roles.push(wrecker)
  for (let index = 0; index < escorts; index += 1) {
    if (roles.length >= limit) break
    // Boars come out when the forest is really up; otherwise it is wolves.
    roles.push(index > 0 && context.rng.chance(pressure * 0.45) ? 'boar' : 'wolf')
  }
  return { roles, trimmed: roles.length < wanted }
}

/** A prowler is one beast doing nothing in particular, sized to the local pressure. */
export function planAmbientBeast(
  beastPressure: number,
  rng: RandomStream,
): BeastRole {
  return rng.chance(clamp01(beastPressure) * 0.35) ? 'boar' : 'wolf'
}

/**
 * The wolf rule: a pack hunter that has lost most of its kind stops being a hunter.
 * `packShare` is the share of the beast's *own kind* in the pack still standing.
 *
 * The comparison is `<=`, not `<`, and that is load-bearing rather than a rounding
 * preference. A shipped mixed pack carries exactly two wolves, so losing one leaves a
 * share of exactly `0.5`; under strict inequality the rule could never fire for the
 * compositions the game actually builds, which is what measured out at 0 routs in 120
 * fights (§9). "Half or fewer of my kind left" is also the more natural reading of a
 * pack breaking.
 */
export function shouldBeastRout(role: BeastRole, packShare: number): boolean {
  const threshold = BEAST_PROFILES[role].routThreshold
  if (threshold <= 0) return false
  return clamp01(packShare) <= threshold
}

export function isBeastProfileRole(value: string): value is BeastRole {
  return (BEAST_ROLES as readonly string[]).includes(value)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
