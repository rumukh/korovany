import {
  createGeneratedEncounterPlan,
  getSiteWorldPosition2D,
} from '../content/registry.ts'
import type { SerializableState } from '../run/runTypes.ts'
import type { Collider } from '../systems/CollisionWorld.ts'
import type { Faction, FinaleProfileId, FinaleStage } from '../types.ts'
import type { WorldBlueprint } from './worldTypes.ts'

export const FINALE_VERSION = 2
export const FINALE_ARENA_RADIUS = 22
export const FINALE_ENGAGE_RADIUS = 32
export const FINALE_INTRO_SECONDS = 1.4
export const FINALE_TRANSITION_SECONDS = 1.15
export const FINALE_RESUME_SECONDS = 0.65
export const FINALE_MAX_ESCORTS = 2
export const FINALE_PROJECTILE_RADIUS = 0.12

export interface FinalePoint {
  x: number
  z: number
}

export type FinaleAttackId =
  | 'fan' | 'lane'
  | 'cleave' | 'charge' | 'heavyCleave' | 'heavySlam'
  | 'commandSweep' | 'advance' | 'press'

export interface FinaleAttack {
  shape: 'fan' | 'lane' | 'cone' | 'charge'
  tell: number
  contact: number
  recovery: number
  range: number
  /** Half width of a lane or the moving body's contact footprint. */
  width: number
  halfAngle: number
  damage: number
  speed: number
  angles: readonly number[]
}

export const FINALE_ATTACKS: Readonly<Record<FinaleAttackId, FinaleAttack>> = {
  fan: {
    shape: 'fan', tell: 0.75, contact: 0.16, recovery: 1.05,
    range: 24, width: FINALE_PROJECTILE_RADIUS, halfAngle: 0,
    damage: 9, speed: 20, angles: [-0.28, 0, 0.28],
  },
  lane: {
    shape: 'lane', tell: 0.8, contact: 0.16, recovery: 0.85,
    range: 27, width: FINALE_PROJECTILE_RADIUS, halfAngle: 0,
    damage: 17, speed: 25, angles: [0],
  },
  cleave: {
    shape: 'cone', tell: 0.8, contact: 0.18, recovery: 0.9,
    range: 4.6, width: 0, halfAngle: 1.05,
    damage: 22, speed: 0, angles: [],
  },
  charge: {
    shape: 'charge', tell: 0.9, contact: 0.75, recovery: 1.1,
    range: 7.5, width: 0.95, halfAngle: 0,
    damage: 24, speed: 10, angles: [],
  },
  heavyCleave: {
    shape: 'cone', tell: 0.7, contact: 0.18, recovery: 0.4,
    range: 4.8, width: 0, halfAngle: 1.25,
    damage: 20, speed: 0, angles: [],
  },
  heavySlam: {
    shape: 'lane', tell: 0.65, contact: 0.18, recovery: 1.1,
    range: 5.2, width: 1, halfAngle: 0,
    damage: 26, speed: 0, angles: [],
  },
  commandSweep: {
    shape: 'cone', tell: 0.85, contact: 0.18, recovery: 0.8,
    range: 4.2, width: 0, halfAngle: 1.2,
    damage: 18, speed: 0, angles: [],
  },
  advance: {
    shape: 'charge', tell: 0.75, contact: 0.8, recovery: 0.65,
    range: 5.6, width: 0.85, halfAngle: 0,
    damage: 19, speed: 7, angles: [],
  },
  press: {
    shape: 'cone', tell: 0.75, contact: 0.18, recovery: 1.05,
    range: 4.8, width: 0, halfAngle: 1.4,
    damage: 23, speed: 0, angles: [],
  },
}

export interface FinaleProfile {
  id: FinaleProfileId
  enemyFaction: Faction
  health: number
  speed: readonly [number, number]
  sequence: readonly [readonly FinaleAttackId[], readonly FinaleAttackId[]]
}

/** Keyed by the player's campaign, NOT by the boss's allegiance. */
export const FINALE_PROFILES: Readonly<Record<Faction, FinaleProfile>> = {
  elf: {
    id: 'huntsmaster', enemyFaction: 'guard', health: 340,
    speed: [3.2, 3.8], sequence: [['fan', 'lane'], ['lane', 'fan', 'lane']],
  },
  guard: {
    id: 'warlord', enemyFaction: 'villain', health: 440,
    speed: [2.8, 3.4],
    sequence: [['cleave', 'charge'], ['heavyCleave', 'heavySlam', 'charge']],
  },
  villain: {
    id: 'marshal', enemyFaction: 'guard', health: 380,
    speed: [2.3, 4], sequence: [['commandSweep', 'advance'], ['advance', 'press', 'advance']],
  },
}

export interface FinaleIdentity {
  campaign: Faction
  profile: FinaleProfileId
  enemyFaction: Faction
  encounterId: string
  bossId: string
  escortIds: string[]
  objectiveId: string
  regionId: string
  siteId: string
  arena: FinalePoint
}

export function createFinaleIdentity(blueprint: WorldBlueprint, campaign: Faction): FinaleIdentity {
  const profile = FINALE_PROFILES[campaign]
  const siteId = blueprint.finales[campaign]
  const encounter = blueprint.encounters.find((slot) => slot.kind === 'boss' && slot.siteId === siteId)
  const arena = getSiteWorldPosition2D(blueprint, siteId)
  if (!encounter || !arena) throw new Error(`Missing ${campaign} finale encounter`)
  const plan = createGeneratedEncounterPlan(blueprint, encounter, campaign)
  const boss = plan.spawns.find((spawn) => spawn.unique && spawn.objective)
  if (!boss || boss.faction !== profile.enemyFaction || !plan.hostileToPlayer) {
    throw new Error(`Invalid ${campaign} finale ownership`)
  }
  return {
    campaign, profile: profile.id, enemyFaction: boss.faction,
    encounterId: encounter.id, bossId: boss.id,
    escortIds: plan.spawns.filter((spawn) => !spawn.unique).slice(0, FINALE_MAX_ESCORTS).map((spawn) => spawn.id),
    objectiveId: blueprint.objectives[campaign].finalNodeId,
    regionId: String(encounter.regionId), siteId,
    arena: { x: arena.x, z: arena.z },
  }
}

export interface FinaleCombatant extends FinalePoint {
  health: number
  maxHealth: number
  heading: number
  cooldown: number
}

export interface FinaleEscort {
  id: string
  defeated: boolean
  body: FinaleCombatant | null
}

export interface FinaleAction {
  id: FinaleAttackId
  stage: 'tell' | 'contact' | 'recovery'
  remaining: number
  origin: FinalePoint
  originY: number
  direction: FinalePoint
  pitch: number
  travelLimit: number
  hitIds: string[]
}

export interface FinaleState {
  version: typeof FINALE_VERSION
  identity: FinaleIdentity
  boss: FinaleCombatant | null
  escorts: FinaleEscort[]
  phase: 1 | 2
  introduced: boolean
  suspended: boolean
  defeated: boolean
  introRemaining: number
  transitionRemaining: number
  resumeRemaining: number
  positioningRemaining: number
  sequenceIndex: number
  action: FinaleAction | null
}

export function createFinaleState(identity: FinaleIdentity): FinaleState {
  return {
    version: FINALE_VERSION, identity,
    boss: null,
    escorts: identity.escortIds.map((id) => ({ id, defeated: false, body: null })),
    phase: 1, introduced: false, suspended: true, defeated: false,
    introRemaining: 0, transitionRemaining: 0, resumeRemaining: 0,
    positioningRemaining: 0, sequenceIndex: 0, action: null,
  }
}

export interface FinaleAuthority {
  defeatedActorIds: readonly string[]
  clearedEncounterIds: readonly string[]
  objectiveDone: boolean
}

export function isFinaleDefeated(identity: FinaleIdentity, authority: FinaleAuthority): boolean {
  return authority.objectiveDone ||
    authority.defeatedActorIds.includes(identity.bossId) ||
    authority.clearedEncounterIds.includes(identity.encounterId)
}

export function reconcileFinale(state: FinaleState, authority: FinaleAuthority): void {
  if (isFinaleDefeated(state.identity, authority)) {
    state.defeated = true
    state.action = null
    state.suspended = true
    if (state.boss) state.boss.health = 0
  }
  for (const escort of state.escorts) {
    if (authority.defeatedActorIds.includes(escort.id)) escort.defeated = true
  }
}

export function finaleOwnsActor(
  identity: FinaleIdentity,
  actor: { generatedRegionId: string | null; generatedEncounterId: string | null; generatedSpawnId: string | null },
): boolean {
  return actor.generatedRegionId === identity.regionId &&
    actor.generatedEncounterId === identity.encounterId &&
    (actor.generatedSpawnId === identity.bossId ||
      identity.escortIds.some((id) => id === actor.generatedSpawnId))
}

export function finaleCanSpawn(state: FinaleState, spawnId: string): boolean {
  if (state.defeated) return false
  if (spawnId === state.identity.bossId) return true
  return state.escorts.some((escort) => escort.id === spawnId && !escort.defeated)
}

export function finaleSavedBody(state: FinaleState, spawnId: string): FinaleCombatant | null {
  return spawnId === state.identity.bossId
    ? state.boss
    : state.escorts.find((escort) => escort.id === spawnId)?.body ?? null
}

export function captureFinaleBody(state: FinaleState, spawnId: string, body: FinaleCombatant): void {
  if (spawnId === state.identity.bossId) state.boss = { ...body, health: state.defeated ? 0 : body.health }
  else {
    const escort = state.escorts.find((entry) => entry.id === spawnId)
    if (escort) escort.body = { ...body }
  }
}

/** Called only after the engine has applied a real lethal hit. */
export function recordFinaleDeath(
  state: FinaleState,
  actor: {
    generatedRegionId: string | null
    generatedEncounterId: string | null
    generatedSpawnId: string | null
    generatedObjectiveId: string | null
    generatedUnique: boolean
    alive: boolean
    hp: number
  },
  prerequisitesDone: boolean,
): boolean {
  if (!finaleOwnsActor(state.identity, actor) || actor.alive || actor.hp > 0) return false
  if (actor.generatedSpawnId !== state.identity.bossId) {
    const escort = state.escorts.find((entry) => entry.id === actor.generatedSpawnId)
    if (escort) {
      escort.defeated = true
      if (escort.body) escort.body.health = 0
    }
    return false
  }
  if (state.defeated || !prerequisitesDone || !actor.generatedUnique ||
    actor.generatedObjectiveId !== state.identity.objectiveId) return false
  state.defeated = true
  state.suspended = true
  state.action = null
  if (state.boss) state.boss.health = 0
  return true
}

export function interruptFinale(state: FinaleState): boolean {
  const action = state.action
  if (!action || action.stage === 'recovery') return false
  action.stage = 'recovery'
  action.remaining = FINALE_ATTACKS[action.id].recovery
  return true
}

/** Unspent contact is forfeited, not replayed after a return from outside the arena. */
export function suspendFinale(state: FinaleState): void {
  if (state.suspended || state.defeated) return
  interruptFinale(state)
  state.suspended = true
  state.resumeRemaining = FINALE_RESUME_SECONDS
}

export function prepareFinaleResume(state: FinaleState): void {
  if (!state.introduced || state.defeated) return
  // Projectiles are not saved, and a consumed melee contact must never fire twice.
  if (state.action?.stage === 'contact') interruptFinale(state)
  state.suspended = true
  if (state.resumeRemaining <= 0) state.resumeRemaining = FINALE_RESUME_SECONDS
}

export type FinaleIntent =
  | { kind: 'introduction' | 'transition' | 'tell' }
  | { kind: 'move'; destination: FinalePoint; distance: number }
  | { kind: 'contact'; action: FinaleAction }
  | { kind: 'charge'; action: FinaleAction; distance: number }

export interface FinaleInput {
  body: FinaleCombatant
  active: boolean
  target: FinalePoint | null
  sourceHeight: number
  targetHeight: number
  canSeeTarget: boolean
  interrupted: boolean
}

function directionTo(from: FinalePoint, to: FinalePoint): FinalePoint {
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  return distance < 0.00001
    ? { x: 0, z: 1 }
    : { x: (to.x - from.x) / distance, z: (to.z - from.z) / distance }
}

export function boundFinaleDestination(identity: FinaleIdentity, target: FinalePoint): FinalePoint {
  const distance = Math.hypot(target.x - identity.arena.x, target.z - identity.arena.z)
  if (distance <= FINALE_ARENA_RADIUS) return { ...target }
  const direction = directionTo(identity.arena, target)
  return {
    x: identity.arena.x + direction.x * FINALE_ARENA_RADIUS,
    z: identity.arena.z + direction.z * FINALE_ARENA_RADIUS,
  }
}

/**
 * No damage or movement is applied here. Action time is consumed once; the adapter
 * executes contact with current bodies and collision-resolved displacement.
 */
export function advanceFinale(state: FinaleState, input: FinaleInput, delta: number): FinaleIntent[] {
  if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Invalid finale delta')
  if (!Number.isFinite(input.sourceHeight) || !Number.isFinite(input.targetHeight)) {
    throw new RangeError('Invalid finale aim height')
  }
  if (state.defeated) return []
  captureFinaleBody(state, state.identity.bossId, input.body)
  if (input.body.health <= 0 || delta === 0) return []
  const step = Math.min(delta, 0.05)
  const profile = FINALE_PROFILES[state.identity.campaign]
  if (!input.active) {
    suspendFinale(state)
    return [{
      kind: 'move', destination: { ...state.identity.arena },
      distance: profile.speed[state.phase - 1] * step,
    }]
  }
  if (!state.introduced) {
    state.introduced = true
    state.suspended = false
    state.introRemaining = FINALE_INTRO_SECONDS
    return [{ kind: 'introduction' }]
  }
  if (state.suspended) {
    state.suspended = false
    if (state.resumeRemaining <= 0) state.resumeRemaining = FINALE_RESUME_SECONDS
  }
  if (state.phase === 1 && input.body.health <= input.body.maxHealth * 0.5) {
    state.phase = 2
    state.sequenceIndex = 0
    state.action = null
    state.transitionRemaining = FINALE_TRANSITION_SECONDS
    return [{ kind: 'transition' }]
  }
  for (const timer of ['introRemaining', 'transitionRemaining', 'resumeRemaining'] as const) {
    if (state[timer] > 0) {
      state[timer] = Math.max(0, state[timer] - step)
      return []
    }
  }
  if (input.interrupted) {
    interruptFinale(state)
    return []
  }
  let remaining = step
  const intents: FinaleIntent[] = []
  const action = state.action
  if (action) {
    const spec = FINALE_ATTACKS[action.id]
    // At most tell -> contact -> recovery in one frame. A newly advertised tell
    // always returns below, so even a long frame cannot damage on its first tell.
    while (remaining > 0 && state.action) {
      const consumed = Math.min(remaining, action.remaining)
      if (action.stage === 'contact' && spec.shape === 'charge' && consumed > 0) {
        intents.push({ kind: 'charge', action, distance: spec.speed * consumed })
      }
      action.remaining = Math.max(0, action.remaining - consumed)
      remaining -= consumed
      if (action.remaining > 0.0000001) break
      if (action.stage === 'tell') {
        action.stage = 'contact'
        action.remaining = spec.contact
        if (spec.shape !== 'charge') intents.push({ kind: 'contact', action })
      } else if (action.stage === 'contact') {
        action.stage = 'recovery'
        action.remaining = spec.recovery
      } else {
        state.action = null
        state.sequenceIndex = (state.sequenceIndex + 1) % profile.sequence[state.phase - 1].length
        state.positioningRemaining = profile.id === 'huntsmaster' ? 0.65 : 0
      }
    }
    return intents
  }
  const target = input.target
  if (!target) return []
  const sequence = profile.sequence[state.phase - 1]
  const next = sequence[state.sequenceIndex % sequence.length]
  const spec = FINALE_ATTACKS[next]
  const distance = Math.hypot(target.x - input.body.x, target.z - input.body.z)
  const needsApproach = !input.canSeeTarget || distance > spec.range * (spec.shape === 'cone' ? 0.85 : 0.95)
  if (state.positioningRemaining > 0 || needsApproach) {
    state.positioningRemaining = Math.max(0, state.positioningRemaining - step)
    const direction = directionTo(input.body, target)
    const side = state.sequenceIndex % 2 === 0 ? 1 : -1
    const destination = needsApproach
      ? target
      : {
          x: input.body.x + direction.z * side * 4 - direction.x * (distance < 7 ? 3 : 0),
          z: input.body.z - direction.x * side * 4 - direction.z * (distance < 7 ? 3 : 0),
        }
    return [{
      kind: 'move', destination: boundFinaleDestination(state.identity, destination),
      distance: profile.speed[state.phase - 1] * step,
    }]
  }
  state.action = {
    id: next, stage: 'tell', remaining: spec.tell,
    origin: { x: input.body.x, z: input.body.z },
    originY: input.sourceHeight,
    direction: directionTo(input.body, target),
    pitch: Math.atan2(input.targetHeight - input.sourceHeight, distance),
    travelLimit: spec.shape === 'charge' ? spec.range : 0,
    hitIds: [],
  }
  return [{ kind: 'tell' }]
}

export function finaleStage(state: FinaleState): FinaleStage {
  if (state.defeated) return 'defeated'
  if (state.suspended) return 'suspended'
  if (state.introRemaining > 0) return 'introduction'
  if (state.transitionRemaining > 0) return 'transition'
  if (state.resumeRemaining > 0) return 'resuming'
  if (!state.action) return 'positioning'
  return state.action.stage === 'tell' ? 'telegraph' : state.action.stage
}

export function finaleProgress(state: FinaleState): number {
  const action = state.action
  if (!action) return 0
  const spec = FINALE_ATTACKS[action.id]
  return Math.max(0, Math.min(1, 1 - action.remaining / spec[action.stage]))
}

export function finaleEscortPost(state: FinaleState, index: number): FinalePoint {
  const body = state.boss
  if (!body) return { ...state.identity.arena }
  const direction = state.action?.direction ?? { x: Math.sin(body.heading), z: Math.cos(body.heading) }
  const side = index === 0 ? -1 : 1
  return boundFinaleDestination(state.identity, {
    x: body.x + direction.z * side * 3.1 + direction.x * 1.7,
    z: body.z - direction.x * side * 3.1 + direction.z * 1.7,
  })
}

/** Real footprint, with the target's body radius, not a distance-only melee check. */
export function finaleContains(
  action: FinaleAction,
  target: FinalePoint,
  targetRadius: number,
): boolean {
  const spec = FINALE_ATTACKS[action.id]
  const dx = target.x - action.origin.x
  const dz = target.z - action.origin.z
  const forward = dx * action.direction.x + dz * action.direction.z
  const lateral = dx * action.direction.z - dz * action.direction.x
  const distance = Math.hypot(dx, dz)
  if (spec.shape === 'cone') {
    if (distance > spec.range + targetRadius) return false
    if (distance <= targetRadius) return true
    const angle = Math.abs(Math.atan2(lateral, forward))
    return angle <= spec.halfAngle + Math.asin(Math.min(1, targetRadius / distance))
  }
  return forward >= -targetRadius && forward <= spec.range + targetRadius &&
    Math.abs(lateral) <= spec.width + targetRadius
}

export function finaleSweepContains(
  start: FinalePoint, end: FinalePoint, target: FinalePoint, radius: number,
): boolean {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq > 0
    ? Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.z - start.z) * dz) / lengthSq))
    : 0
  return Math.hypot(target.x - start.x - dx * t, target.z - start.z - dz * t) <= radius
}

export interface FinaleContactTarget extends FinalePoint {
  id: string
  radius: number
  alive: boolean
  hostile: boolean
}

/** Shared admission seam: actual footprint + cover + one contact per body per action. */
export function resolveFinaleContactTargets(
  action: FinaleAction,
  targets: readonly FinaleContactTarget[],
  clear: (from: FinalePoint, to: FinalePoint) => boolean,
  sweep?: { start: FinalePoint; end: FinalePoint },
): string[] {
  const hits: string[] = []
  const spec = FINALE_ATTACKS[action.id]
  for (const target of targets) {
    if (!target.alive || !target.hostile || action.hitIds.includes(target.id)) continue
    const within = sweep
      ? finaleSweepContains(sweep.start, sweep.end, target, spec.width + target.radius)
      : finaleContains(action, target, target.radius)
    if (!within || !clear(sweep?.start ?? action.origin, target)) continue
    if (action.hitIds.length >= 25) break
    action.hitIds.push(target.id)
    hits.push(target.id)
  }
  return hits
}

/** Exact segment/circle and slab/rotated-box contacts against existing prop colliders. */
export function firstFinaleCoverHit(
  start: FinalePoint, end: FinalePoint, colliders: readonly Collider[], radius = 0,
): number | null {
  let first: number | null = null
  for (const collider of colliders) {
    if (collider.enabled === false || collider.blocksMovement === false || collider.tags?.includes('water')) continue
    let hit: number | null = null
    const dx = end.x - start.x
    const dz = end.z - start.z
    if (collider.shape === 'circle') {
      const ox = start.x - collider.x
      const oz = start.z - collider.z
      const r = collider.radius + radius
      const a = dx * dx + dz * dz
      const c = ox * ox + oz * oz - r * r
      const b = ox * dx + oz * dz
      const discriminant = b * b - a * c
      if (c <= 0) hit = 0
      else if (a > 0 && discriminant >= 0) {
        const t = (-b - Math.sqrt(discriminant)) / a
        if (t >= 0 && t <= 1) hit = t
      }
    } else {
      const cos = Math.cos(collider.rotation ?? 0)
      const sin = Math.sin(collider.rotation ?? 0)
      const ox = start.x - collider.x
      const oz = start.z - collider.z
      const axes = [
        [ox * cos + oz * sin, dx * cos + dz * sin, collider.halfWidth + radius],
        [-ox * sin + oz * cos, -dx * sin + dz * cos, collider.halfDepth + radius],
      ]
      let near = 0
      let far = 1
      for (const [origin, direction, half] of axes) {
        if (Math.abs(direction) < 1e-9) {
          if (Math.abs(origin) > half) { far = -1; break }
        } else {
          const left = (-half - origin) / direction
          const right = (half - origin) / direction
          near = Math.max(near, Math.min(left, right))
          far = Math.min(far, Math.max(left, right))
        }
      }
      if (near <= far) hit = near
    }
    if (hit !== null && (first === null || hit < first)) first = hit
  }
  return first
}

export function serializeFinaleState(state: FinaleState): SerializableState {
  return {
    version: state.version,
    identity: { ...state.identity, arena: { ...state.identity.arena }, escortIds: [...state.identity.escortIds] },
    boss: state.boss ? { ...state.boss } : null,
    escorts: state.escorts.map((escort) => ({
      id: escort.id, defeated: escort.defeated, body: escort.body ? { ...escort.body } : null,
    })),
    phase: state.phase, introduced: state.introduced, suspended: state.suspended, defeated: state.defeated,
    introRemaining: state.introRemaining, transitionRemaining: state.transitionRemaining,
    resumeRemaining: state.resumeRemaining, positioningRemaining: state.positioningRemaining,
    sequenceIndex: state.sequenceIndex,
    action: state.action ? {
      ...state.action, origin: { ...state.action.origin }, direction: { ...state.action.direction },
      hitIds: [...state.action.hitIds],
    } : null,
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function point(value: unknown): value is FinalePoint {
  return record(value) && finite(value.x, -100_000, 100_000) && finite(value.z, -100_000, 100_000)
}

function body(value: unknown): value is FinaleCombatant {
  return point(value) && record(value) && finite(value.maxHealth, 1, 100_000) &&
    finite(value.health, 0, value.maxHealth) && finite(value.heading, -Math.PI * 2, Math.PI * 2) &&
    finite(value.cooldown, 0, 120)
}

function isAttackId(value: unknown): value is FinaleAttackId {
  return typeof value === 'string' && Object.hasOwn(FINALE_ATTACKS, value)
}

export interface FinaleRestore {
  state: FinaleState
  rejected: boolean
}

/** Missing is legacy; malformed present data is reported by the caller, never silently accepted. */
export function normalizeFinaleState(
  value: unknown, identity: FinaleIdentity, authority: FinaleAuthority,
): FinaleRestore {
  const fresh = createFinaleState(identity)
  const reject = (): FinaleRestore => {
    const clean = createFinaleState(identity)
    reconcileFinale(clean, authority)
    return { state: clean, rejected: true }
  }
  if (value === undefined) {
    reconcileFinale(fresh, authority)
    return { state: fresh, rejected: false }
  }
  if (!record(value) || (value.version !== FINALE_VERSION && value.version !== 1) || !record(value.identity)) return reject()
  for (const key of ['campaign', 'profile', 'enemyFaction', 'encounterId', 'bossId', 'objectiveId', 'regionId', 'siteId'] as const) {
    if (value.identity[key] !== identity[key]) return reject()
  }
  if (!Array.isArray(value.identity.escortIds) ||
    value.identity.escortIds.join('|') !== identity.escortIds.join('|') ||
    !point(value.identity.arena) || value.identity.arena.x !== identity.arena.x ||
    value.identity.arena.z !== identity.arena.z) return reject()
  if (value.boss !== null && !body(value.boss)) return reject()
  const withinArena = (position: FinalePoint): boolean =>
    Math.hypot(position.x - identity.arena.x, position.z - identity.arena.z) <= FINALE_ENGAGE_RADIUS + 2
  if (value.boss !== null && !withinArena(value.boss)) return reject()
  if (value.phase !== 1 && value.phase !== 2) return reject()
  for (const key of ['introduced', 'suspended', 'defeated'] as const) {
    if (typeof value[key] !== 'boolean') return reject()
    fresh[key] = value[key]
  }
  for (const key of ['introRemaining', 'transitionRemaining', 'resumeRemaining', 'positioningRemaining'] as const) {
    if (!finite(value[key], 0, 2)) return reject()
    fresh[key] = value[key]
  }
  const sequence = FINALE_PROFILES[identity.campaign].sequence[value.phase - 1]
  if (!finite(value.sequenceIndex, 0, sequence.length - 1) || !Number.isInteger(value.sequenceIndex)) return reject()
  if (!Array.isArray(value.escorts) || value.escorts.length !== identity.escortIds.length) return reject()
  for (let index = 0; index < fresh.escorts.length; index += 1) {
    const escort = value.escorts[index]
    if (!record(escort) || escort.id !== identity.escortIds[index] ||
      typeof escort.defeated !== 'boolean' || (escort.body !== null && !body(escort.body))) return reject()
    if (escort.body !== null && (!withinArena(escort.body) || (!escort.defeated && escort.body.health === 0))) return reject()
    fresh.escorts[index] = { id: identity.escortIds[index], defeated: escort.defeated, body: escort.body === null ? null : { ...escort.body } }
  }
  fresh.boss = value.boss === null ? null : { ...value.boss }
  if (fresh.introduced && fresh.boss === null && !isFinaleDefeated(identity, authority)) return reject()
  fresh.phase = value.phase
  fresh.sequenceIndex = value.sequenceIndex
  if (value.action !== null) {
    const action = value.action
    if (!record(action) || !isAttackId(action.id) || !sequence.includes(action.id) ||
      action.id !== sequence[value.sequenceIndex] ||
      (action.stage !== 'tell' && action.stage !== 'contact' && action.stage !== 'recovery') ||
      !finite(action.remaining, 0, FINALE_ATTACKS[action.id][action.stage]) ||
      !point(action.origin) || !withinArena(action.origin) || !point(action.direction) ||
      Math.abs(Math.hypot(action.direction.x, action.direction.z) - 1) > 0.001 ||
      !Array.isArray(action.hitIds) || action.hitIds.length > 25 ||
      !action.hitIds.every((id): id is string => typeof id === 'string' && id.length <= 200)) return reject()
    const spec = FINALE_ATTACKS[action.id]
    if (value.version === 1) {
      // Version 1 had no locked elevation or collision-planned charge reach.
      // Preserve its wounds and phase, but never replay an unmodelled contact.
      fresh.action = {
        id: action.id, stage: 'recovery',
        remaining: action.stage === 'recovery' ? action.remaining : spec.recovery,
        origin: { ...action.origin }, originY: 0, direction: { ...action.direction },
        pitch: 0, travelLimit: 0, hitIds: [...new Set(action.hitIds)],
      }
    } else {
      if (!finite(action.originY, -100_000, 100_000) ||
        !finite(action.pitch, -Math.PI / 2, Math.PI / 2) ||
        !finite(action.travelLimit, 0, spec.shape === 'charge' ? spec.range : 0)) return reject()
      fresh.action = {
        id: action.id, stage: action.stage, remaining: action.remaining,
        origin: { ...action.origin }, originY: action.originY,
        direction: { ...action.direction }, pitch: action.pitch,
        travelLimit: action.travelLimit, hitIds: [...new Set(action.hitIds)],
      }
    }
  }
  if (fresh.defeated && !isFinaleDefeated(identity, authority)) return reject()
  if (fresh.boss?.health === 0 && !isFinaleDefeated(identity, authority)) return reject()
  reconcileFinale(fresh, authority)
  return { state: fresh, rejected: false }
}
