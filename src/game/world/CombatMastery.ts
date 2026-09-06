import { ABILITY_INFO, type BodyState, type Faction } from '../types.ts'
import {
  PLAYER_MELEE_RESET_COOLDOWN,
  SHIELD_FRONT_DOT,
  cancelPlayerMelee,
  createPlayerMeleeState,
  isPlayerMeleeCommitted,
  playerBeatSpec,
  resolvePlayerDamage,
  type CombatActor,
  type CombatAttackKind,
  type CombatOutcome,
  type PlayerDamageInput,
  type PlayerMeleeState,
} from './CombatResolver.ts'

export const EVADE_STAMINA_COST = 25
export const EVADE_DURATION = 0.30
export const EVADE_DISTANCE = 4.2
export const EVADE_WINDOW_START = 0.06
export const EVADE_WINDOW_END = 0.18
export const EVADE_COOLDOWN = 0.85
export const PERFECT_GUARD_WINDOW = 0.12
export const PERFECT_GUARD_COST = 12
export const PERFECT_GUARD_REARM = 0.65
export const PERFECT_GUARD_OPENING = 0.24
export const DEFENSE_OUTCOME_DURATION = 0.75
const TIMER_EPSILON = 1e-9

export type DefensiveOutcome = 'none' | 'evaded' | 'perfectGuard'
export type CameraControlMode = 'capture' | 'locked' | 'drag'
export type EvadeReadiness =
  | 'ready' | 'active' | 'cooldown' | 'stamina' | 'legs' | 'committed' | 'paused' | 'ended' | 'input'

export interface CombatMasteryState {
  evadeRemaining: number
  evadeCooldown: number
  evadeVelocityX: number
  evadeVelocityZ: number
  evadeProtection: boolean
  guardWindow: number
  guardRearm: number
  outcome: DefensiveOutcome
  outcomeRemaining: number
}

export function createCombatMasteryState(): CombatMasteryState {
  return {
    evadeRemaining: 0,
    evadeCooldown: 0,
    evadeVelocityX: 0,
    evadeVelocityZ: 0,
    evadeProtection: false,
    guardWindow: 0,
    guardRearm: 0,
    outcome: 'none',
    outcomeRemaining: 0,
  }
}

export function missingPlayerLegs(body: BodyState): number {
  return Number(body.leftLeg === 'missing') + Number(body.rightLeg === 'missing')
}

export function playerLegMobility(body: BodyState): number {
  const missing = missingPlayerLegs(body)
  const mobility = missing === 2 ? 0.24 : missing === 1 ? 0.53 : 1
  return mobility * (body.leftLeg === 'prosthetic' || body.rightLeg === 'prosthetic' ? 0.9 : 1)
}

export interface EvadeContext {
  stamina: number
  body: BodyState
  melee: PlayerMeleeState
  paused: boolean
  ended: boolean
  inputBlocked?: boolean
}

export function evadeReadiness(state: CombatMasteryState, input: EvadeContext): EvadeReadiness {
  if (input.ended) return 'ended'
  if (input.paused) return 'paused'
  if (input.inputBlocked) return 'input'
  if (state.evadeRemaining > 0) return 'active'
  if (isPlayerMeleeCommitted(input.melee)) return 'committed'
  if (missingPlayerLegs(input.body) === 2) return 'legs'
  if (state.evadeCooldown > 0) return 'cooldown'
  if (!Number.isFinite(input.stamina) || input.stamina < EVADE_STAMINA_COST) return 'stamina'
  return 'ready'
}

export function beginEvade(
  state: CombatMasteryState,
  input: EvadeContext & { moveX: number; moveZ: number; aimX: number; aimZ: number },
): { accepted: boolean; reason: EvadeReadiness; staminaSpent: number } {
  const reason = evadeReadiness(state, input)
  if (reason !== 'ready') return { accepted: false, reason, staminaSpent: 0 }
  const moving = Math.hypot(input.moveX, input.moveZ) > TIMER_EPSILON
  const x = moving ? input.moveX : -input.aimX
  const z = moving ? input.moveZ : -input.aimZ
  const length = Math.hypot(x, z)
  if (!Number.isFinite(length) || length <= TIMER_EPSILON) {
    throw new RangeError('An evasive step needs a finite aim direction')
  }
  cancelPlayerMelee(input.melee)
  const speed = EVADE_DISTANCE / EVADE_DURATION * playerLegMobility(input.body)
  state.evadeVelocityX = x / length * speed
  state.evadeVelocityZ = z / length * speed
  state.evadeRemaining = EVADE_DURATION
  state.evadeCooldown = EVADE_COOLDOWN
  state.evadeProtection = true
  state.guardWindow = 0
  return { accepted: true, reason: 'ready', staminaSpent: EVADE_STAMINA_COST }
}

function remaining(timer: number, delta: number): number {
  const next = Math.max(0, timer - delta)
  return next < TIMER_EPSILON ? 0 : next
}

export function advanceCombatMastery(
  state: CombatMasteryState,
  delta: number,
): { x: number; z: number; activeSeconds: number } {
  if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Invalid combat delta')
  const activeSeconds = Math.min(delta, state.evadeRemaining)
  const motion = {
    x: state.evadeVelocityX * activeSeconds,
    z: state.evadeVelocityZ * activeSeconds,
    activeSeconds,
  }
  state.evadeRemaining = remaining(state.evadeRemaining, delta)
  state.evadeCooldown = remaining(state.evadeCooldown, delta)
  state.guardWindow = remaining(state.guardWindow, delta)
  state.guardRearm = remaining(state.guardRearm, delta)
  state.outcomeRemaining = remaining(state.outcomeRemaining, delta)
  if (state.evadeRemaining === 0) {
    state.evadeVelocityX = 0
    state.evadeVelocityZ = 0
    state.evadeProtection = false
  }
  if (state.outcomeRemaining === 0) state.outcome = 'none'
  return motion
}

export function isEvadeWindow(state: CombatMasteryState): boolean {
  const elapsed = EVADE_DURATION - state.evadeRemaining
  return state.evadeProtection && state.evadeRemaining > 0 &&
    elapsed >= EVADE_WINDOW_START - TIMER_EPSILON &&
    elapsed <= EVADE_WINDOW_END + TIMER_EPSILON
}

export function raisePerfectGuard(state: CombatMasteryState): void {
  state.guardWindow = state.guardRearm === 0 ? PERFECT_GUARD_WINDOW : 0
  if (state.guardWindow > 0) state.guardRearm = PERFECT_GUARD_REARM
}

/** Release gestures, not paid recovery. Neither a menu nor a reload is a defensive action. */
export function settleCombatMastery(state: CombatMasteryState, melee: PlayerMeleeState): void {
  state.evadeVelocityX = 0
  state.evadeVelocityZ = 0
  state.evadeProtection = false
  state.guardWindow = 0
  melee.bufferRemaining = 0
  cancelPlayerMelee(melee)
}

export interface MasteryContactInput extends Omit<PlayerDamageInput, 'baseDamage'> {
  state: CombatMasteryState
  baseDamage: number | (() => number)
  stamina: number
  attackKind: CombatAttackKind
  /** Environmental/bleeding damage must never enter combat protection. */
  eligible?: boolean
}

export interface MasteryContactOutcome extends CombatOutcome {
  defense: DefensiveOutcome
  staminaSpent: number
  interruptMelee: boolean
}

/** The live damage path calls this before evaluating even the base-damage RNG thunk. */
export function resolveCombatMasteryContact(input: MasteryContactInput): MasteryContactOutcome {
  const { state } = input
  let defense: DefensiveOutcome = 'none'
  if (input.health > 0 && input.eligible !== false) {
    if (isEvadeWindow(state)) defense = 'evaded'
    else if (
      input.shieldActive && input.hasIncomingDirection &&
      input.incomingDotAim > SHIELD_FRONT_DOT &&
      state.guardWindow > 0 && input.stamina >= PERFECT_GUARD_COST
    ) {
      defense = 'perfectGuard'
      state.guardWindow = 0
    }
  }
  if (defense !== 'none') {
    state.outcome = defense
    state.outcomeRemaining = DEFENSE_OUTCOME_DURATION
    return {
      applied: false, dealt: 0, killed: false, impact: 0,
      blocked: defense === 'perfectGuard',
      weight: defense === 'perfectGuard' ? 'blocked' : 'normal',
      defense,
      staminaSpent: defense === 'perfectGuard' ? PERFECT_GUARD_COST : 0,
      interruptMelee: defense === 'perfectGuard' &&
        input.attackKind !== 'arrow' && input.attackKind !== 'actorArrow',
    }
  }
  const baseDamage = input.health > 0
    ? typeof input.baseDamage === 'function' ? input.baseDamage() : input.baseDamage
    : 0
  return {
    ...resolvePlayerDamage({ ...input, baseDamage }),
    defense: 'none', staminaSpent: 0, interruptMelee: false,
  }
}

export function applyPerfectGuardOpening(
  actor: Pick<CombatActor, 'alive' | 'reaction' | 'reactionRemaining'> & { attackCooldown: number },
): boolean {
  if (!actor.alive) return false
  actor.reaction = 'stagger'
  actor.reactionRemaining = Math.max(actor.reactionRemaining, PERFECT_GUARD_OPENING)
  actor.attackCooldown = Math.max(actor.attackCooldown, PERFECT_GUARD_OPENING)
  return true
}

export interface CombatMasteryView {
  evadeReady: boolean
  evadeReason: EvadeReadiness
  evadeCooldown: number
  evadeActive: boolean
  evadeSettled: boolean
  evadeProgress: number
  evadeProtected: boolean
  evadeCost: number
  perfectGuard: null | { ready: boolean; active: boolean; window: boolean; cooldown: number; cost: number }
  outcome: DefensiveOutcome
  outcomeRemaining: number
  cameraMode: CameraControlMode
}

export function buildCombatMasteryView(input: EvadeContext & {
  state: CombatMasteryState
  faction: Faction
  shieldActive: boolean
  abilityCooldown: number
  cameraMode: CameraControlMode
}): CombatMasteryView {
  const { state } = input
  const reason = evadeReadiness(state, input)
  const guardAvailable = !input.paused && !input.ended && !input.inputBlocked &&
    state.evadeRemaining === 0 && !isPlayerMeleeCommitted(input.melee) &&
    input.stamina >= PERFECT_GUARD_COST
  return {
    evadeReady: reason === 'ready',
    evadeReason: reason,
    evadeCooldown: state.evadeCooldown,
    evadeActive: state.evadeRemaining > 0,
    evadeSettled: state.evadeRemaining > 0 && !state.evadeProtection,
    evadeProgress: state.evadeRemaining > 0 ? 1 - state.evadeRemaining / EVADE_DURATION : 0,
    evadeProtected: isEvadeWindow(state),
    evadeCost: EVADE_STAMINA_COST,
    perfectGuard: input.faction === 'guard' ? {
      active: input.shieldActive,
      ready: guardAvailable && !input.shieldActive && state.guardRearm === 0 &&
        input.abilityCooldown === 0,
      window: guardAvailable && input.shieldActive && state.guardWindow > 0,
      cooldown: state.guardRearm,
      cost: PERFECT_GUARD_COST,
    } : null,
    outcome: state.outcome,
    outcomeRemaining: state.outcomeRemaining,
    cameraMode: input.cameraMode,
  }
}

export function serializeCombatMastery(
  state: CombatMasteryState,
  melee: PlayerMeleeState,
  abilityCooldown: number,
  attackCooldown: number,
  shieldActive: boolean,
) {
  const settledMelee = { ...melee }
  settleCombatMastery({ ...state }, settledMelee)
  return {
    version: 1,
    evadeRemaining: state.evadeRemaining,
    evadeCooldown: state.evadeCooldown,
    guardRearm: state.guardRearm,
    abilityCooldown: Math.max(abilityCooldown, shieldActive ? ABILITY_INFO.guard.cooldownMax : 0),
    attackCooldown,
    melee: { ...settledMelee },
  }
}

export interface RestoredCombatMastery {
  state: CombatMasteryState
  melee: PlayerMeleeState
  abilityCooldown: number
  attackCooldown: number
  rejected: boolean
}

export function normalizeCombatMastery(value: unknown, faction: Faction): RestoredCombatMastery {
  const restored: RestoredCombatMastery = {
    state: createCombatMasteryState(),
    melee: createPlayerMeleeState(),
    abilityCooldown: 0,
    attackCooldown: 0,
    rejected: false,
  }
  if (value === undefined) return restored
  const object = (candidate: unknown): Record<string, unknown> | null =>
    typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
      ? candidate as Record<string, unknown> : null
  const block = object(value)
  const timer = (candidate: unknown, maximum: number): number => {
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) ||
        candidate < 0 || candidate > maximum) {
      restored.rejected = true
      return maximum
    }
    return candidate
  }
  if (!block || block.version !== 1) {
    restored.rejected = true
    restored.state.evadeRemaining = EVADE_DURATION
    restored.state.evadeCooldown = EVADE_COOLDOWN
    restored.state.guardRearm = PERFECT_GUARD_REARM
    restored.abilityCooldown = ABILITY_INFO[faction].cooldownMax
    restored.attackCooldown = 0.52
    restored.melee.lockout = PLAYER_MELEE_RESET_COOLDOWN
    return restored
  }
  restored.state.evadeRemaining = timer(block.evadeRemaining, EVADE_DURATION)
  restored.state.evadeCooldown = timer(block.evadeCooldown, EVADE_COOLDOWN)
  if (restored.state.evadeRemaining > 0 &&
      restored.state.evadeCooldown + TIMER_EPSILON <
        restored.state.evadeRemaining + EVADE_COOLDOWN - EVADE_DURATION) restored.rejected = true
  restored.state.guardRearm = timer(block.guardRearm, PERFECT_GUARD_REARM)
  restored.abilityCooldown = timer(block.abilityCooldown, ABILITY_INFO[faction].cooldownMax)
  restored.attackCooldown = timer(block.attackCooldown, 0.52)
  const melee = object(block.melee)
  if (!melee || (melee.phase !== 'idle' && melee.phase !== 'windup' && melee.phase !== 'recovery') ||
      typeof melee.beat !== 'number' || !Number.isInteger(melee.beat) ||
      (melee.phase === 'idle' ? melee.beat !== 0 : melee.beat !== 3)) {
    restored.rejected = true
    restored.melee.lockout = PLAYER_MELEE_RESET_COOLDOWN
  } else {
    restored.melee.lockout = timer(melee.lockout, PLAYER_MELEE_RESET_COOLDOWN)
    timer(melee.bufferRemaining, 0)
    timer(melee.chainRemaining, 0)
    if (melee.phase === 'windup' || melee.phase === 'recovery') {
      restored.melee.beat = 3
      restored.melee.phase = melee.phase
      restored.melee.phaseRemaining = timer(melee.phaseRemaining, playerBeatSpec(3)[melee.phase])
    } else timer(melee.phaseRemaining, 0)
  }
  if (restored.state.evadeRemaining > 0 && isPlayerMeleeCommitted(restored.melee)) restored.rejected = true
  if (restored.rejected) {
    restored.state.evadeCooldown = EVADE_COOLDOWN
    restored.state.guardRearm = PERFECT_GUARD_REARM
    restored.abilityCooldown = ABILITY_INFO[faction].cooldownMax
    restored.attackCooldown = 0.52
    restored.melee.lockout = PLAYER_MELEE_RESET_COOLDOWN
    if (restored.melee.phase === 'windup') {
      restored.melee.phase = 'recovery'
      restored.melee.phaseRemaining = playerBeatSpec(3).recovery
    }
  }
  return restored
}
