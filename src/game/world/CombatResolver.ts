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

export type CombatAttackKind =
  | 'melee'
  | 'cleave'
  | 'arrow'
  | 'allyMelee'
  | 'actorArrow'
  /** The third beat of the player's melee sequence. The only stance-breaking swing. */
  | 'finisher'
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
/**
 * The finisher's multiplier — and, on its own, not the reason a finisher breaks a stance.
 *
 * Multipliers alone make "the third beat breaks poise" conditional on the player's damage
 * number: a champion's 72 poise survives an armless player's finisher and nothing says so.
 * `applyDamageReaction` therefore floors a finisher's poise damage at the target's
 * *current* poise, so the break is a rule rather than an arithmetic accident. The
 * multiplier still matters for what it does to a target that is already reeling, and it
 * keeps the finisher above a cleave where a reader would expect it to be.
 */
export const FINISHER_POISE_MULTIPLIER = 2.6
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
 * How much health a role spawns with, before the allegiance and threat multipliers.
 *
 * Lives here rather than inside `createActor` because time-to-kill is health divided by
 * damage, and roadmap 1.1's fourth signal — "time-to-kill separates by role" — cannot be
 * measured at all if half of that division is a ternary chain inside a mesh builder. The
 * numbers are the engine's own, unchanged.
 */
export function actorBaseHealth(role: ActorRole): number {
  if (isBeastRole(role)) return BEAST_PROFILES[role].hp
  if (role === 'commander') return 150
  if (role === 'champion') return 260
  if (role === 'brute') return 130
  if (role === 'archer') return 45
  if (role === 'scout') return 55
  // §5D — a villager dies to two hits and is meant to. It is not a difficulty knob: a
  // peasant with a soldier's health bar would turn every raid into a chore and make
  // hitting one feel like a fight.
  if (role === 'peasant') return 26
  return 70
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
// The player's half of the same contract
// ---------------------------------------------------------------------------

/**
 * The player's melee sequence, as a contract rather than a cooldown.
 *
 * The asymmetry this answers is written down in `docs/STRATEGY.md`: NPCs got five per-role
 * wind-ups, telegraphs, contact resolved at the end of the wind-up, recovery, flinch,
 * poise and stagger; the player got `attackCooldown = 0.52`, a 3.6 m nearest-hostile scan
 * and a facing snap, so a swing with anything in that radius **could not miss and could
 * not be aimed**. Everything below exists to give the player the same four ideas the
 * enemies already have — wind-up, contact, whiff, recovery — without a second button.
 *
 * Three rules shape the table and are the reason it is a table:
 *
 * 1. **Chaining must dominate mashing.** Beat one is the shortest beat, so if the sequence
 *    reset for free a player would spam it. It does not: after a beat's recovery the
 *    sequence stays open for `PLAYER_MELEE_CHAIN_WINDOW`, and a press inside that window
 *    *continues*. Opening beat one again therefore costs the whole chain window of
 *    waiting, which makes 1→2→3 strictly faster per point of damage than 1→1→1.
 * 2. **Only the third beat commits.** Beats one and two leave movement live and can be
 *    cancelled by sprint, jump or the faction ability — that is the defensive verb elf and
 *    villain never had, delivered through inputs that already exist. The finisher cannot
 *    be cancelled, and `PLAYER_MELEE_FINISHER_COMMITMENT` is the number open disagreement
 *    (a) asked to be measured against the 0.18 s scout/minion wind-up floor.
 * 3. **The finisher has to be worth its cost.** It is the only swing that spends stamina
 *    and the only one that breaks a stance, so the third beat has a reason to exist beyond
 *    a bigger damage number.
 *
 * Pure and allocation-free per frame: `advancePlayerMelee` mutates one small state object
 * and returns a plain report, so `GameEngine` and the headless harness run the same model
 * rather than two that can drift.
 */
export type PlayerMeleePhase = 'idle' | 'windup' | 'recovery'

export interface PlayerBeatSpec {
  /** 1, 2 or 3. Stored so a report can name the beat without an index dance. */
  readonly beat: number
  /** Seconds before contact resolves. The player's own telegraph. */
  readonly windup: number
  /** Seconds after contact before the sequence is free again. */
  readonly recovery: number
  /** Metres the arc reaches. */
  readonly reach: number
  /** Minimum dot of the direction to a target with the aim vector for a legal hit. */
  readonly arcDot: number
  /** A narrower dot, **inside the arc**, that the soft assist prefers. Never widens it. */
  readonly assistDot: number
  readonly damageMultiplier: number
  readonly knockback: number
  readonly staminaCost: number
  readonly attackKind: CombatAttackKind
  /** True when the beat refuses cancels and locks movement until its recovery ends. */
  readonly commits: boolean
}

export const PLAYER_MELEE_BEATS: readonly PlayerBeatSpec[] = [
  {
    beat: 1,
    windup: 0.12,
    recovery: 0.22,
    reach: 3.1,
    arcDot: 0.35,
    assistDot: 0.72,
    damageMultiplier: 0.8,
    knockback: 0,
    staminaCost: 0,
    attackKind: 'melee',
    commits: false,
  },
  {
    beat: 2,
    windup: 0.14,
    recovery: 0.24,
    reach: 3.1,
    arcDot: 0.35,
    assistDot: 0.72,
    damageMultiplier: 1,
    knockback: 0.9,
    staminaCost: 0,
    attackKind: 'melee',
    commits: false,
  },
  {
    // Wider and longer than the two jabs before it, because it is a sweep rather than a
    // poke — and because a swing the player has committed to should not be beaten by a
    // target sidestepping two degrees.
    beat: 3,
    windup: 0.15,
    recovery: 0.26,
    reach: 3.5,
    arcDot: 0.2,
    assistDot: 0.6,
    damageMultiplier: 1.7,
    knockback: 2.6,
    staminaCost: 22,
    attackKind: 'finisher',
    commits: true,
  },
]

/**
 * How long a press is remembered while a beat is still running.
 *
 * Sized deliberately longer than the longest beat (0.41 s): a press on a beat's *first*
 * frame has to survive until that beat's recovery ends, or the sequence would silently
 * refuse to chain for anybody who presses early — which is the exact input the buffer
 * exists to forgive.
 */
export const PLAYER_MELEE_BUFFER = 0.45
/** How long the sequence stays open after a beat's recovery before it resets to beat one. */
export const PLAYER_MELEE_CHAIN_WINDOW = 0.4
/** Dead time after the finisher's recovery, before a new sequence may open. */
export const PLAYER_MELEE_RESET_COOLDOWN = 0.18
/** Below this the direction to a target is meaningless, so the arc test is range-only. */
export const PLAYER_MELEE_POINT_BLANK = 0.001

/**
 * Seconds the player is committed once the finisher starts: no cancel, no movement.
 *
 * Reported against the 0.18 s scout/minion floor from open disagreement (a), which is the
 * written condition for whether a true dodge is the missing half of the mechanic. It is
 * derived rather than typed so it cannot drift away from the table above.
 */
export const PLAYER_MELEE_FINISHER_COMMITMENT =
  PLAYER_MELEE_BEATS[2].windup + PLAYER_MELEE_BEATS[2].recovery

/** Weights of the soft assist. Aim dominates; range breaks the tie. */
export const MELEE_ASSIST_AIM_WEIGHT = 1
export const MELEE_ASSIST_RANGE_WEIGHT = 0.55
export const MELEE_ASSIST_CONE_BONUS = 0.45

export function playerBeatSpec(beat: number): PlayerBeatSpec {
  const index = Math.min(PLAYER_MELEE_BEATS.length, Math.max(1, Math.floor(beat))) - 1
  return PLAYER_MELEE_BEATS[index]
}

export interface PlayerMeleeState {
  /** The beat last started, or 0 when the sequence is closed. */
  beat: number
  phase: PlayerMeleePhase
  phaseRemaining: number
  bufferRemaining: number
  chainRemaining: number
  /** Only the finisher sets it. Keeps a cancel from skipping the finisher's dead time. */
  lockout: number
}

export function createPlayerMeleeState(): PlayerMeleeState {
  return {
    beat: 0,
    phase: 'idle',
    phaseRemaining: 0,
    bufferRemaining: 0,
    chainRemaining: 0,
    lockout: 0,
  }
}

/**
 * Hard reset for a pause, an end screen or a restart — the one place the commitment does
 * not apply, because there is no fight left to be committed to.
 */
export function resetPlayerMelee(state: PlayerMeleeState): void {
  state.beat = 0
  state.phase = 'idle'
  state.phaseRemaining = 0
  state.bufferRemaining = 0
  state.chainRemaining = 0
  state.lockout = 0
}

/** True while the finisher is running, which is the only state that refuses a cancel. */
export function isPlayerMeleeCommitted(state: PlayerMeleeState): boolean {
  return state.phase !== 'idle' && playerBeatSpec(state.beat).commits
}

/** Which beat the next press would start. 3 means the finisher is the next swing. */
export function nextPlayerMeleeBeat(state: PlayerMeleeState): number {
  if (state.phase === 'idle' && state.chainRemaining <= 0) return 1
  const next = state.beat + 1
  return next > PLAYER_MELEE_BEATS.length ? 1 : next
}

/** One press of the attack button. Remembered for `PLAYER_MELEE_BUFFER` seconds. */
export function bufferPlayerMelee(state: PlayerMeleeState): void {
  state.bufferRemaining = PLAYER_MELEE_BUFFER
}

/**
 * Sprint, jump, the faction ability or the guard's shield. Drops the buffer and the beat
 * in flight, and reports whether there was anything to drop — which is what lets the
 * caller tell "I cancelled a swing" from "I just started running".
 *
 * The finisher's lockout deliberately survives: cancelling is not a way to pay less for a
 * finisher already thrown.
 */
export function cancelPlayerMelee(state: PlayerMeleeState): boolean {
  if (isPlayerMeleeCommitted(state)) return false
  const cancelled =
    state.phase !== 'idle' || state.bufferRemaining > 0 || state.chainRemaining > 0
  state.beat = 0
  state.phase = 'idle'
  state.phaseRemaining = 0
  state.bufferRemaining = 0
  state.chainRemaining = 0
  return cancelled
}

export interface PlayerMeleeInput {
  delta: number
  /** Stamina available now. The finisher will not start without its cost. */
  stamina: number
}

export interface PlayerMeleeStep {
  /** The beat that started this step, or 0. */
  startedBeat: number
  /** Stamina the started beat cost. */
  staminaSpent: number
  /** The beat whose contact frame resolved this step, or 0. */
  contactBeat: number
  /** True when the sequence wanted the finisher and could not pay for it. */
  finisherStalled: boolean
  /** True when the chain window closed without a press. */
  sequenceReset: boolean
}

const NO_STEP: PlayerMeleeStep = {
  startedBeat: 0,
  staminaSpent: 0,
  contactBeat: 0,
  finisherStalled: false,
  sequenceReset: false,
}

/**
 * One frame of the sequence.
 *
 * Order matters and is the buffering: a recovery that ends inside this frame leaves the
 * state idle, and the start block below runs in the *same* frame, so a press held through
 * a recovery chains on the first frame it legally can rather than on the next one.
 */
export function advancePlayerMelee(
  state: PlayerMeleeState,
  input: PlayerMeleeInput,
): PlayerMeleeStep {
  const step = { ...NO_STEP }
  const delta = Math.max(0, input.delta)
  state.lockout = Math.max(0, state.lockout - delta)
  state.bufferRemaining = Math.max(0, state.bufferRemaining - delta)

  if (state.phase === 'idle') {
    state.chainRemaining = Math.max(0, state.chainRemaining - delta)
    if (state.chainRemaining <= 0 && state.beat !== 0) {
      state.beat = 0
      step.sequenceReset = true
    }
  } else {
    state.phaseRemaining -= delta
    if (state.phaseRemaining <= 0) {
      const spec = playerBeatSpec(state.beat)
      if (state.phase === 'windup') {
        step.contactBeat = state.beat
        state.phase = 'recovery'
        state.phaseRemaining = spec.recovery
      } else {
        state.phase = 'idle'
        state.phaseRemaining = 0
        state.lockout = spec.commits ? PLAYER_MELEE_RESET_COOLDOWN : 0
        state.chainRemaining = spec.commits ? 0 : PLAYER_MELEE_CHAIN_WINDOW
        if (state.chainRemaining <= 0) {
          state.beat = 0
          step.sequenceReset = true
        }
      }
    }
  }

  if (state.phase !== 'idle' || state.bufferRemaining <= 0 || state.lockout > 0) {
    return step
  }

  const wanted = nextPlayerMeleeBeat(state)
  const wantedSpec = playerBeatSpec(wanted)
  // A refused finisher opens beat one instead of swallowing the press. The one-button
  // promise is that the button always does something; an empty stamina bar is a reason to
  // hit lighter, not a reason for nothing to happen.
  const stalled = wantedSpec.staminaCost > input.stamina
  const spec = stalled ? playerBeatSpec(1) : wantedSpec
  state.beat = spec.beat
  state.phase = 'windup'
  state.phaseRemaining = spec.windup
  state.bufferRemaining = 0
  state.chainRemaining = 0
  step.startedBeat = spec.beat
  step.staminaSpent = spec.staminaCost
  step.finisherStalled = stalled
  return step
}

/** One thing the swing might land on, measured against the aim vector. */
export interface MeleeArcCandidate {
  readonly id: string
  /** Planar metres from the player. */
  readonly distance: number
  /** Dot of the normalised planar direction to the target with the player's aim. */
  readonly aimDot: number
  /** Hostiles are struck before bystanders, whatever the assist would prefer. */
  readonly hostile: boolean
}

/**
 * The arc test, in the shape `cleave()` already uses: inside the reach, and no wider off
 * the aim vector than the beat's dot allows.
 *
 * This is the whole of what makes a hit legal. Nothing else in this file may return a
 * target that fails it, which is the property `tests/honestMelee.test.ts` pins with a
 * candidate placed outside the arc and given an overwhelming assist score.
 */
export function isWithinMeleeArc(
  candidate: MeleeArcCandidate,
  spec: PlayerBeatSpec,
): boolean {
  if (candidate.distance > spec.reach) return false
  // Standing inside the player: there is no direction to test, exactly as `cleave()`
  // treats it.
  if (candidate.distance <= PLAYER_MELEE_POINT_BLANK) return true
  return candidate.aimDot >= spec.arcDot
}

/**
 * How much the assist wants a candidate. Only ever compares things already inside the arc.
 *
 * Aim leads, range breaks ties, and a bonus applies inside the narrower assist cone so the
 * swing prefers what the player is looking *at* over what merely stands in the arc.
 */
export function meleeAssistScore(
  candidate: MeleeArcCandidate,
  spec: PlayerBeatSpec,
): number {
  const aimSpan = Math.max(1e-6, 1 - spec.arcDot)
  const aim = clamp01((candidate.aimDot - spec.arcDot) / aimSpan)
  const range = clamp01(1 - candidate.distance / Math.max(1e-6, spec.reach))
  const cone = candidate.aimDot >= spec.assistDot ? MELEE_ASSIST_CONE_BONUS : 0
  return aim * MELEE_ASSIST_AIM_WEIGHT + range * MELEE_ASSIST_RANGE_WEIGHT + cone
}

/**
 * Who the beat hits, or `null` for a whiff.
 *
 * Two rules, in this order. **Hostiles first, always** — the §5D rule the old auto-target
 * had, kept: a villager is only a legal target when there is nothing to fight, so walking
 * into a village mid-raid cannot make the swing meant for the wolf land on the man running
 * from it. Then the assist, *among candidates the arc already accepted*. The filter runs
 * before the score for a reason: an assist that could reach outside the arc would be the
 * old unaimed swing wearing a cone.
 */
export function selectMeleeTarget(
  candidates: readonly MeleeArcCandidate[],
  spec: PlayerBeatSpec,
): MeleeArcCandidate | null {
  return (
    bestInArc(candidates, spec, true) ?? bestInArc(candidates, spec, false)
  )
}

function bestInArc(
  candidates: readonly MeleeArcCandidate[],
  spec: PlayerBeatSpec,
  hostile: boolean,
): MeleeArcCandidate | null {
  let best: MeleeArcCandidate | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate.hostile !== hostile) continue
    if (!isWithinMeleeArc(candidate, spec)) continue
    const score = meleeAssistScore(candidate, spec)
    if (best !== null && score <= bestScore) continue
    best = candidate
    bestScore = score
  }
  return best
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
    : input.attackKind === 'cleave' ||
        input.attackKind === 'finisher' ||
        dealt >= target.maxHp * HEAVY_HIT_HEALTH_RATIO
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
 *
 * A `finisher` is the one kind whose break is guaranteed rather than computed: its poise
 * damage is floored at whatever poise the target has left. The stagger-immunity window
 * still applies above it, so the third beat breaks a stance — it does not stun-lock one.
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
  const scaled = outcome.dealt * poiseMultiplier(attackKind)
  const poiseDamage =
    attackKind === 'finisher' ? Math.max(scaled, actor.poise) : scaled
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

function poiseMultiplier(attackKind: CombatAttackKind): number {
  if (attackKind === 'cleave') return CLEAVE_POISE_MULTIPLIER
  if (attackKind === 'finisher') return FINISHER_POISE_MULTIPLIER
  return STANDARD_POISE_MULTIPLIER
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
