/**
 * The part of combat that is arithmetic rather than presentation.
 *
 * `GameEngine`'s combat path mixes three things: deciding *how much a hit is worth*,
 * deciding *what the hit does to the target's composure*, and showing it — blood, sparks,
 * decals, sound, camera trauma, damage numbers. Only the first two are a function of world
 * state, and they are the ones every balance question turns on. That part lives here, in
 * the same shape as `ActorAi`, `Chronicle`, `Materialization` and `Fauna`: no THREE, no
 * scene, no audio, no RNG of its own.
 *
 * The functions are generic over a minimal `CombatActor` so `GameEngine` passes its own
 * `Actor` straight through with no per-frame allocation, while a headless harness passes
 * plain objects — the same trick `ActorAi` uses, and for the same reason: the harness has
 * to exercise the code the game runs rather than a re-implementation of it, or its
 * measurements mean nothing.
 *
 * **The one table.** Role melee damage used to be written twice, once in
 * `actorAttackPlayer` and once in `actorAttackActor`, kept in sync by hand. They were not
 * in sync and were not meant to be — a commander hits a player for 10 and another actor
 * for 18 — so the duplication was load-bearing rather than accidental, which is exactly
 * what makes it dangerous: nothing said which differences were deliberate. `MELEE_DAMAGE`
 * is now one table with both columns, so a difference has to be written down to exist.
 *
 * **What is deliberately not here.** Blood, sparks, decals, health bars, telegraphs,
 * limbs, loot, achievements, notices and camera trauma stay in `GameEngine`; so does
 * knockback *movement*, which needs the collision world. This module says what a hit is
 * worth and what it does to poise, not what it looks like — so a number measured through
 * it describes the combat model, not the felt experience of fighting.
 */

import {
  isBeastRole,
  type ActorRole,
} from '../types.ts'
import { BEAST_PROFILES } from './Fauna.ts'

export type CombatAttackKind = 'melee' | 'cleave' | 'arrow' | 'allyMelee' | 'actorArrow'
export type CombatHitWeight = 'normal' | 'heavy' | 'lethal' | 'blocked'
export type CombatActionKind = 'meleePlayer' | 'meleeActor' | 'eventProp' | 'arrow'
export type CombatActionPhase = 'windup' | 'recovery'
export type CombatReactionKind = 'none' | 'flinch' | 'stagger'
export type CombatDeathStyle = 'sideFall' | 'backFall' | 'spinFall' | 'launchFall'

// ---------------------------------------------------------------------------
// Tuning. Every one of these was a literal inside `GameEngine`; the values are
// unchanged and `tests/combatResolver.test.ts` pins them against the code they came from.
// ---------------------------------------------------------------------------

/** How much of a hit a raised shield eats when it is facing the right way. */
export const SHIELD_DAMAGE_MULTIPLIER = 0.15
/** How far off dead-ahead an incoming hit may be and still count as blocked. */
export const SHIELD_FRONT_DOT = 0.2
/** A guard's armour, applied to every hit the player takes. */
export const GUARD_ARMOR = 0.72
/** A brute's frontal plate. Halves what comes at its face and nothing else. */
export const BRUTE_FRONTAL_DAMAGE_MULTIPLIER = 0.5
export const BRUTE_FRONT_DOT = 0.2
/** How long a non-staggering hit interrupts what an actor was doing. */
export const FLINCH_TIME = 0.12
/** Quiet seconds an actor needs before poise starts coming back. */
export const POISE_REGEN_DELAY = 0.75
export const POISE_RECOVERY_PER_SECOND = 22
/** After a stagger, how long the actor cannot be staggered again. */
export const STAGGER_IMMUNITY = 0.45
export const KNOCKBACK_MAX_SPEED = 11
/** Big roles are pushed around less by the same hit. */
export const LARGE_ROLE_KNOCKBACK_SCALE = 0.55
/** Above this, a killing hit throws the body rather than dropping it. */
export const HIGH_KNOCKBACK_THRESHOLD = 2.5
/** Slack on the contact check, so a target that stepped back mid-swing still gets hit. */
export const CONTACT_RANGE_FORGIVENESS = 0.35
export const ARCHER_FIRE_COOLDOWN = 1.8
/** Poise damage multiplier by attack kind: a cleave rocks composure, a jab does not. */
export const CLEAVE_POISE_MULTIPLIER = 1.45
export const STANDARD_POISE_MULTIPLIER = 0.75
/** Where poise sits after a stagger, and the floor it cannot be pushed below while immune. */
export const POISE_AFTER_STAGGER_RATIO = 0.7
/** A hit at or above this share of the target's max health reads as heavy. */
export const HEAVY_HIT_HEALTH_RATIO = 0.22
/** A hit on the player at or above this many points reads as heavy. */
export const HEAVY_PLAYER_HIT = 22
/** Chance a hit that can injure actually takes a limb, and the health it needs to. */
export const PLAYER_INJURY_CHANCE = 0.11
export const PLAYER_INJURY_HEALTH_CEILING = 82
/** Gold for a kill. A commander is worth the trouble; nothing else is worth much. */
export const COMMANDER_KILL_REWARD = 55
export const STANDARD_KILL_REWARD = 12
/** How lateral a killing blow has to be before the body spins instead of falling flat. */
export const SPIN_FALL_LATERAL = 0.68
/** How frontal the source has to be before the body falls backwards. */
export const BACK_FALL_FRONT_DOT = 0.2

// ---------------------------------------------------------------------------
// The one role-damage table
// ---------------------------------------------------------------------------

/** Who is on the receiving end. The two columns of the single melee table. */
export type MeleeDamageTarget = 'player' | 'actor'

export interface MeleeDamageSpec {
  /** Flat part of the hit. */
  base: number
  /** Width of the uniform roll added on top. Zero for a flat hit. */
  spread: number
}

/**
 * What an ordinary body hits for. A soldier, scout, minion, archer, captive or peasant all
 * share it — the roles that are told apart by reach, speed and wind-up rather than by the
 * size of the number.
 *
 * The asymmetry is deliberate and now visible: against another actor the hit is flat 13,
 * against the player it is a smaller 6–9 roll, because the player takes hits from a crowd
 * and an NPC takes them from one opponent at a time.
 */
const ORDINARY_MELEE: Record<MeleeDamageTarget, MeleeDamageSpec> = {
  player: { base: 6, spread: 3 },
  actor: { base: 13, spread: 0 },
}

/**
 * The single source for humanoid melee damage. Beast roles are not here: they take
 * `BEAST_PROFILES[role].meleeDamage` for both columns, which is the same one-source rule
 * expressed by not writing the number down twice.
 */
export const MELEE_DAMAGE: Record<
  Exclude<ActorRole, 'wolf' | 'boar' | 'bear' | 'troll'>,
  Record<MeleeDamageTarget, MeleeDamageSpec>
> = {
  soldier: ORDINARY_MELEE,
  scout: ORDINARY_MELEE,
  minion: ORDINARY_MELEE,
  archer: ORDINARY_MELEE,
  captive: ORDINARY_MELEE,
  peasant: ORDINARY_MELEE,
  // A commander is a threat to a line of soldiers and an annoyance to the player: it is
  // meant to be killed for its aura, not feared for its swing.
  commander: {
    player: { base: 10, spread: 0 },
    actor: { base: 18, spread: 0 },
  },
  champion: {
    player: { base: 17, spread: 0 },
    actor: { base: 17, spread: 0 },
  },
  brute: {
    player: { base: 14, spread: 0 },
    actor: { base: 14, spread: 0 },
  },
}

export function meleeDamageSpec(
  role: ActorRole,
  target: MeleeDamageTarget,
): MeleeDamageSpec {
  if (isBeastRole(role)) {
    return { base: BEAST_PROFILES[role].meleeDamage, spread: 0 }
  }
  return MELEE_DAMAGE[role][target]
}

/**
 * Base melee damage before aura, threat tier, armour or a shield.
 *
 * `roll` is a **thunk**, not a number, and that is a determinism requirement rather than a
 * style choice. The pre-extraction code read `6 + combatRng() * 3` inside the last arm of a
 * ternary chain, so a commander, champion, brute or beast drew nothing at all. Taking a
 * plain number would force every caller to draw on every swing and silently shift the
 * combat stream for every other consumer of it. The thunk is called only when the role has
 * a spread, which is exactly the old short-circuit.
 */
export function rollMeleeDamage(
  role: ActorRole,
  target: MeleeDamageTarget,
  roll: () => number,
): number {
  const spec = meleeDamageSpec(role, target)
  return spec.spread === 0 ? spec.base : spec.base + spec.spread * roll()
}

/**
 * What an actor takes off a destructible event prop — a burning house, a barricade.
 *
 * A troll is a prop-wrecker: it is on the settlement to take it apart, and it does that
 * roughly twice as fast as a raider with a torch. Both arms always roll, so this one takes
 * a plain sample.
 */
export const PROP_BITE: { troll: MeleeDamageSpec; other: MeleeDamageSpec } = {
  troll: { base: 9, spread: 4 },
  other: { base: 4, spread: 2 },
}

export function rollPropBite(role: ActorRole, roll: number): number {
  const spec = role === 'troll' ? PROP_BITE.troll : PROP_BITE.other
  return spec.base + spec.spread * roll
}

// ---------------------------------------------------------------------------
// The action contract
// ---------------------------------------------------------------------------

/** Seconds of telegraph before a swing lands. The player's whole read of a fight. */
export function actionWindup(role: ActorRole): number {
  if (role === 'scout' || role === 'minion') return 0.18
  if (role === 'archer') return 0.32
  if (role === 'commander') return 0.38
  if (role === 'brute') return 0.56
  if (role === 'champion') return 0.48
  return 0.26
}

/** Seconds an actor is committed after the swing, and therefore punishable. */
export function actionRecovery(role: ActorRole): number {
  if (role === 'scout' || role === 'minion') return 0.18
  if (role === 'archer') return 0.2
  if (role === 'commander') return 0.28
  if (role === 'brute') return 0.42
  if (role === 'champion') return 0.36
  return 0.24
}

/** Composure budget: how much damage it takes to break the role's stance. */
export function actorMaxPoise(role: ActorRole): number {
  if (isBeastRole(role)) return BEAST_PROFILES[role].poise
  if (role === 'scout' || role === 'minion' || role === 'archer') return 18
  if (role === 'commander') return 46
  if (role === 'brute') return 58
  if (role === 'champion') return 72
  return 28
}

/**
 * How long a broken stance lasts. Inverted against `actorMaxPoise` on purpose: the roles
 * that are hardest to stagger stay staggered for the shortest time, so breaking a champion
 * is an achievement with a narrow window rather than a free kill.
 */
export function actorStaggerDuration(role: ActorRole): number {
  if (role === 'scout' || role === 'minion' || role === 'archer') return 0.34
  if (role === 'commander') return 0.24
  if (role === 'brute') return 0.2
  if (role === 'champion') return 0.18
  return 0.3
}

/** Seconds before the same actor may act again, before the rage/aura interval scaling. */
export function actionCooldown(kind: CombatActionKind, role: ActorRole): number {
  if (kind === 'arrow') return ARCHER_FIRE_COOLDOWN
  if (kind === 'meleePlayer') return role === 'commander' ? 0.8 : 1.15
  if (kind === 'meleeActor') return 1.3
  return 1.35
}

/** The minimum an actor must expose for the combat model to reason about it. */
export interface CombatActor {
  role: ActorRole
  alive: boolean
  hp: number
  maxHp: number
  reaction: CombatReactionKind
  reactionRemaining: number
  poise: number
  maxPoise: number
  poiseRecoveryDelay: number
  staggerImmunity: number
}

/** An actor may start an action only when it is up, idle and not reeling. */
export function canStartAction(actor: {
  alive: boolean
  action: unknown
  reaction: CombatReactionKind
}): boolean {
  return actor.alive && !actor.action && actor.reaction !== 'stagger'
}

/**
 * A swing connects if the target is inside reach plus the forgiveness slack. Written down
 * because the slack is what makes melee feel fair, and it was previously only visible as a
 * `+ CONTACT_RANGE_FORGIVENESS` in the middle of a longer expression.
 */
export function isWithinContact(distance: number, contactRange: number): boolean {
  return distance <= contactRange + CONTACT_RANGE_FORGIVENESS
}

/**
 * Poise, flinch and stagger timers. Pure over the actor's own fields — the engine calls it
 * once per actor per frame and the harness calls it on plain objects.
 */
export function advanceReaction(actor: CombatActor, delta: number): void {
  actor.staggerImmunity = Math.max(0, actor.staggerImmunity - delta)
  actor.poiseRecoveryDelay = Math.max(0, actor.poiseRecoveryDelay - delta)
  if (actor.reaction !== 'none') {
    const wasStaggered = actor.reaction === 'stagger'
    actor.reactionRemaining = Math.max(0, actor.reactionRemaining - delta)
    if (actor.reactionRemaining <= 0) {
      actor.reaction = 'none'
      if (wasStaggered) {
        actor.poise = Math.max(actor.poise, actor.maxPoise * POISE_AFTER_STAGGER_RATIO)
      }
    }
  }
  if (actor.reaction !== 'stagger' && actor.poiseRecoveryDelay <= 0) {
    actor.poise = Math.min(actor.maxPoise, actor.poise + POISE_RECOVERY_PER_SECOND * delta)
  }
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/** What a resolved hit is worth, with no THREE vectors in it. */
export interface CombatOutcome {
  applied: boolean
  dealt: number
  killed: boolean
  weight: CombatHitWeight
  /** True only for a hit the player's raised shield ate from the front. */
  blocked: boolean
  /** `dealt` normalised against the reference hit for this target, clamped to [0, 1]. */
  impact: number
}

const NO_HIT: CombatOutcome = {
  applied: false,
  dealt: 0,
  killed: false,
  weight: 'normal',
  blocked: false,
  impact: 0,
}

export interface PlayerDamageInput {
  baseDamage: number
  /** Current player health. A hit on a corpse is not a hit. */
  health: number
  /** True while the player's shield is up. */
  shieldActive: boolean
  /** True when the hit has a usable direction — a hit from nowhere cannot be blocked. */
  hasIncomingDirection: boolean
  /**
   * Dot of the normalised incoming direction with the player's aim. Only read when the
   * shield is up and the direction is usable.
   */
  incomingDotAim: number
  /** `guard` wears armour; the other two factions do not. */
  armor: number
}

/**
 * What a hit on the player is worth.
 *
 * The block test is a dot product rather than a cone test on purpose: it is the same
 * check the player is making by eye, and it costs nothing per frame.
 */
export function resolvePlayerDamage(input: PlayerDamageInput): CombatOutcome {
  if (input.health <= 0) return { ...NO_HIT }
  const frontalBlock =
    input.shieldActive &&
    input.hasIncomingDirection &&
    input.incomingDotAim > SHIELD_FRONT_DOT
  const dealt = input.baseDamage * input.armor * (frontalBlock ? SHIELD_DAMAGE_MULTIPLIER : 1)
  const impact = clamp01(dealt / 20)
  const killed = input.health - dealt <= 0
  const weight: CombatHitWeight = frontalBlock
    ? 'blocked'
    : killed
      ? 'lethal'
      : dealt >= HEAVY_PLAYER_HIT
        ? 'heavy'
        : 'normal'
  return { applied: true, dealt, killed, weight, blocked: frontalBlock, impact }
}

/**
 * Whether a hit that got through should also cost the player a limb.
 *
 * Deliberately does **not** take `canInjure` or `blocked`: those two gate the roll itself
 * in the caller, and folding them in here would draw from the combat stream on every
 * blocked hit. Same short-circuit rule as `rollMeleeDamage`, expressed the other way round
 * because there is only one roll to protect.
 */
export function shouldInjurePlayer(roll: number, healthAfterHit: number): boolean {
  return roll < PLAYER_INJURY_CHANCE && healthAfterHit < PLAYER_INJURY_HEALTH_CEILING
}

/** A guard wears armour; the other two factions take the hit as it comes. */
export function playerArmor(faction: string): number {
  return faction === 'guard' ? GUARD_ARMOR : 1
}

export interface ActorDamageInput {
  target: CombatActor
  baseDamage: number
  attackKind: CombatAttackKind
  /**
   * Dot of the target's facing with the normalised direction to the source, or null when
   * the source is on top of the target and there is no direction to test. Only a brute
   * reads it.
   */
  facingDotToSource: number | null
}

/** What a hit on an actor is worth. */
export function resolveActorDamage(input: ActorDamageInput): CombatOutcome {
  const { target } = input
  if (!target.alive) return { ...NO_HIT }
  let dealt = Math.max(0, input.baseDamage)
  if (
    target.role === 'brute' &&
    input.facingDotToSource !== null &&
    input.facingDotToSource > BRUTE_FRONT_DOT
  ) {
    dealt *= BRUTE_FRONTAL_DAMAGE_MULTIPLIER
  }
  const impact = clamp01(dealt / 36)
  const killed = target.hp - dealt <= 0
  const weight: CombatHitWeight = killed
    ? 'lethal'
    : input.attackKind === 'cleave' || dealt >= target.maxHp * HEAVY_HIT_HEALTH_RATIO
      ? 'heavy'
      : 'normal'
  return { applied: true, dealt, killed, weight, blocked: false, impact }
}

/**
 * What a hit does to composure.
 *
 * Mutates the actor's poise fields and reports whether the stance broke, so the caller can
 * cancel the action and drop the telegraph — which stays in `GameEngine`, because a
 * telegraph is a mesh.
 */
export function applyDamageReaction(
  actor: CombatActor,
  outcome: CombatOutcome,
  attackKind: CombatAttackKind,
): boolean {
  if (!outcome.applied || outcome.killed) return false
  if (actor.reaction !== 'stagger') {
    actor.reaction = 'flinch'
    actor.reactionRemaining = Math.max(actor.reactionRemaining, FLINCH_TIME)
  }
  actor.poiseRecoveryDelay = POISE_REGEN_DELAY
  const poiseDamage =
    outcome.dealt *
    (attackKind === 'cleave' ? CLEAVE_POISE_MULTIPLIER : STANDARD_POISE_MULTIPLIER)
  if (actor.staggerImmunity > 0) {
    actor.poise = Math.max(
      actor.maxPoise * POISE_AFTER_STAGGER_RATIO,
      actor.poise - poiseDamage,
    )
    return false
  }
  actor.poise -= poiseDamage
  if (actor.poise > 0) return false

  actor.reaction = 'stagger'
  actor.reactionRemaining = actorStaggerDuration(actor.role)
  actor.staggerImmunity = STAGGER_IMMUNITY
  actor.poise = actor.maxPoise * POISE_AFTER_STAGGER_RATIO
  return true
}

/** How hard a hit shoves, before it is applied to a velocity the collision world owns. */
export function knockbackMagnitude(
  role: ActorRole,
  requestedKnockback: number,
  motionScale: number,
): number {
  const largeRole = isLargeBody(role)
  return requestedKnockback * (largeRole ? LARGE_ROLE_KNOCKBACK_SCALE : 1) * motionScale
}

/** Brutes, commanders and champions. Bigger bodies, bigger deaths, less shove. */
export function isLargeBody(role: ActorRole): boolean {
  return role === 'brute' || role === 'commander' || role === 'champion'
}

// ---------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------

export interface DeathStyleInput {
  attackKind: CombatAttackKind
  requestedKnockback: number
  /** |right · lastHitDirection| — how side-on the killing blow was. */
  lateralStrength: number
  /** forward · (−lastHitDirection) > BACK_FALL_FRONT_DOT — was the source in front. */
  sourceInFront: boolean
}

/** Which way a body goes down. Read entirely off the killing blow. */
export function selectDeathStyle(input: DeathStyleInput): CombatDeathStyle {
  if (
    input.attackKind === 'cleave' ||
    input.requestedKnockback >= HIGH_KNOCKBACK_THRESHOLD
  ) {
    return 'launchFall'
  }
  if (input.lateralStrength > SPIN_FALL_LATERAL) return 'spinFall'
  return input.sourceInFront ? 'backFall' : 'sideFall'
}

/** Gold a direct player kill pays out. */
export function killReward(role: ActorRole): number {
  return role === 'commander' ? COMMANDER_KILL_REWARD : STANDARD_KILL_REWARD
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
