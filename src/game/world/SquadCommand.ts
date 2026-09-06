import {
  areAllegiancesHostile,
  type ActorRole,
  type Allegiance,
  type Faction,
} from '../types.ts'
import type { RunCompanionState, SerializableState } from '../run/runTypes.ts'
import { shouldSquadRegroup } from '../squadMovement.ts'
import { MAX_ACTORS, type ActorBudgetCategory } from './ActorBudget.ts'
import { selectThreat, type AiActor, type AiPositionOf } from './ActorAi.ts'

export const SQUAD_COMMAND_VERSION = 1
export const SQUAD_HOLD_RADIUS = 6
export const SQUAD_HOLD_LEASH = 8
export const SQUAD_FOCUS_RANGE = 30
export const SQUAD_ARRIVAL_DISTANCE = 1.4
export const SQUAD_DISTANT_DISTANCE = 18
export const SQUAD_BLOCKED_SECONDS = 1.5

export type SquadCommandMode = 'follow' | 'hold' | 'focus' | 'regroup'
export type SquadBaseStance = 'follow' | 'hold'
export type SquadMemberStatus =
  | 'following'
  | 'holding'
  | 'positioning'
  | 'regrouping'
  | 'engaged'
  | 'distant'
  | 'blocked'
  | 'routing'
  | 'recovering'

export interface SquadPoint {
  x: number
  z: number
}

export interface SquadAnchor extends SquadPoint {
  heading: number
}

export interface SquadCommandState {
  version: 1
  mode: SquadCommandMode
  baseStance: SquadBaseStance
  anchor: SquadAnchor
  focusTargetId: string | null
}

export interface SquadMembership {
  allegiance: Allegiance
  role: ActorRole
  alive: boolean
  hp: number
  squadEligible: boolean
  budgetCategory: ActorBudgetCategory
  eventOwnerId: string | null
  aiMode: string
  hostileToPlayer: boolean
}

export interface SquadFocusActor {
  id: string
  allegiance: Allegiance
  role: ActorRole
  alive: boolean
  hp: number
  hostileToPlayer: boolean
}

export interface SquadCommandActor extends AiActor, SquadMembership {
  squadSlot: number | null
}

export interface SquadRosterMember {
  id: string
  role: ActorRole
  slot: number
  health: number
  maxHealth: number
  distance: number
  status: SquadMemberStatus
}

export interface SquadFocusView {
  id: string
  role: ActorRole
  health: number
  maxHealth: number
  distance: number
}

export interface SquadCommandView {
  mode: SquadCommandMode
  baseStance: SquadBaseStance
  anchor: SquadAnchor | null
  focusTargetId: string | null
  roster: SquadRosterMember[]
  targets: SquadFocusView[]
  focus: SquadFocusView | null
}

export interface SquadIntent<T> {
  target: T | null
  destination: SquadPoint
  catchUp: boolean
  status: 'following' | 'holding' | 'positioning' | 'regrouping' | 'engaged'
}

export function isSquadRole(role: unknown): role is ActorRole {
  return (
    role === 'soldier' || role === 'scout' || role === 'minion' ||
    role === 'archer' || role === 'brute' || role === 'champion' || role === 'captive'
  )
}

export function isSquadMember(actor: SquadMembership, faction: Faction): boolean {
  return (
    actor.alive && actor.hp > 0 && actor.allegiance === faction &&
    !actor.hostileToPlayer && actor.squadEligible &&
    actor.budgetCategory === 'squad' && actor.eventOwnerId === null &&
    actor.aiMode === 'normal' && isSquadRole(actor.role)
  )
}

export function squadDistance(left: SquadPoint, right: SquadPoint): number {
  return Math.hypot(left.x - right.x, left.z - right.z)
}

export function createSquadCommandState(
  anchor: SquadAnchor,
  following = true,
): SquadCommandState {
  return {
    version: SQUAD_COMMAND_VERSION,
    mode: following ? 'follow' : 'hold',
    baseStance: following ? 'follow' : 'hold',
    anchor: { ...anchor },
    focusTargetId: null,
  }
}

export function isSquadCommandMode(value: unknown): value is SquadCommandMode {
  return value === 'follow' || value === 'hold' || value === 'focus' || value === 'regroup'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000
}

function isFocusId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    value.trim() === value && [...value].every((character) => character.charCodeAt(0) >= 32)
}

export function restoreSquadCommandState(
  value: unknown,
  fallback: SquadCommandState,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): { state: SquadCommandState; rejected: boolean } {
  const reject = () => ({ state: fallback, rejected: true })
  if (value === undefined) return { state: fallback, rejected: false }
  if (!isRecord(value) || value.version !== SQUAD_COMMAND_VERSION) return reject()
  const { mode, baseStance, anchor, focusTargetId } = value
  if (
    !isSquadCommandMode(mode) || (baseStance !== 'follow' && baseStance !== 'hold') ||
    !isRecord(anchor) || !isFiniteCoordinate(anchor.x) || !isFiniteCoordinate(anchor.z) ||
    !isFiniteCoordinate(anchor.heading) || Math.abs(anchor.heading) > Math.PI ||
    anchor.x < bounds.minX || anchor.x > bounds.maxX ||
    anchor.z < bounds.minZ || anchor.z > bounds.maxZ ||
    (mode === 'focus' ? !isFocusId(focusTargetId) : focusTargetId !== null) ||
    (mode === 'hold' && baseStance !== 'hold') ||
    ((mode === 'follow' || mode === 'regroup') && baseStance !== 'follow')
  ) return reject()
  return {
    state: {
      version: SQUAD_COMMAND_VERSION,
      mode,
      baseStance,
      anchor: { x: anchor.x, z: anchor.z, heading: anchor.heading },
      focusTargetId: mode === 'focus' && isFocusId(focusTargetId) ? focusTargetId : null,
    },
    rejected: false,
  }
}

export function serializeSquadCommandState(state: SquadCommandState): SerializableState {
  return {
    version: SQUAD_COMMAND_VERSION,
    mode: state.mode,
    baseStance: state.baseStance,
    anchor: { ...state.anchor },
    focusTargetId: state.focusTargetId,
  }
}

export function issueSquadCommand(
  previous: SquadCommandState,
  mode: SquadCommandMode,
  anchor: SquadAnchor,
  focusTargetId: string | null = null,
): SquadCommandState {
  if (mode === 'focus' && !isFocusId(focusTargetId)) {
    throw new Error('A focus order requires a valid actor identity')
  }
  return {
    version: SQUAD_COMMAND_VERSION,
    mode,
    baseStance: mode === 'focus' ? previous.baseStance : mode === 'hold' ? 'hold' : 'follow',
    anchor: mode === 'hold' ? { ...anchor } : { ...previous.anchor },
    focusTargetId: mode === 'focus' ? focusTargetId : null,
  }
}

export function finishSquadFocus(state: SquadCommandState): SquadCommandState {
  return { ...state, mode: state.baseStance, focusTargetId: null }
}

export function isSquadFocusTarget<T extends SquadFocusActor>(
  target: T,
  faction: Faction,
  player: SquadPoint,
  position: SquadPoint,
  visible: boolean,
): boolean {
  return (
    visible && target.alive && target.hp > 0 && target.hostileToPlayer &&
    target.role !== 'captive' && target.role !== 'peasant' &&
    target.allegiance !== 'civilian' &&
    areAllegiancesHostile(faction, target.allegiance) &&
    squadDistance(player, position) <= SQUAD_FOCUS_RANGE
  )
}

export function isSquadSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_ACTORS
}

export function allocateSquadSlot(id: string, occupied: ReadonlySet<number>): number {
  let hash = 0
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
  for (let offset = 0; offset < MAX_ACTORS; offset += 1) {
    const slot = (hash + offset) % MAX_ACTORS
    if (!occupied.has(slot)) return slot
  }
  throw new Error('Squad formation exceeds the actor cap')
}

export function squadFormationPosition(
  slot: number,
  role: ActorRole,
  origin: SquadPoint,
  heading: number,
): SquadPoint {
  const side = (slot % 5 - 2) * 1.6
  const row = Math.floor(slot / 5)
  const forward = role === 'archer' ? -2.8 - row * 0.4 : 2.2 + row * 0.5
  return {
    x: origin.x + Math.cos(heading) * side + Math.sin(heading) * forward,
    z: origin.z + Math.sin(heading) * side - Math.cos(heading) * forward,
  }
}

/** Called before the engine's normal attack/movement adapter, never instead of morale. */
export function selectSquadIntent<T extends SquadCommandActor>(
  actor: T,
  actors: readonly T[],
  faction: Faction,
  state: SquadCommandState,
  player: SquadPoint,
  heading: number,
  positionOf: AiPositionOf<T>,
): SquadIntent<T> | null {
  if (!isSquadMember(actor, faction) || actor.squadSlot === null) return null
  const position = positionOf(actor)
  const holding = state.mode === 'hold'
  const destination = squadFormationPosition(
    actor.squadSlot, actor.role, holding ? state.anchor : player,
    holding ? state.anchor.heading : heading,
  )
  const playerDistance = squadDistance(position, player)
  const regrouping = state.mode === 'regroup' ||
    (state.mode === 'follow' && shouldSquadRegroup(playerDistance)) ||
    (state.mode === 'focus' && playerDistance > SQUAD_FOCUS_RANGE + SQUAD_HOLD_LEASH)
  const travel: SquadIntent<T> = {
    target: null,
    destination,
    catchUp: !holding,
    status: regrouping ? 'regrouping' : holding
      ? squadDistance(position, destination) <= SQUAD_ARRIVAL_DISTANCE ? 'holding' : 'positioning'
      : 'following',
  }
  if (regrouping) return travel
  if (state.mode === 'focus') {
    const focused = actors.find((candidate) => candidate.id === state.focusTargetId)
    return focused && focused.id !== actor.ignoredTargetId &&
      isSquadFocusTarget(focused, faction, player, positionOf(focused), true)
      ? { ...travel, target: focused, status: 'engaged', catchUp: false }
      : travel
  }
  if (holding && squadDistance(position, state.anchor) >= SQUAD_HOLD_LEASH - 0.25) {
    return travel
  }
  const eligible = actors.filter((candidate) =>
    candidate.hostileToPlayer && candidate.role !== 'captive' &&
    (!holding || squadDistance(positionOf(candidate), state.anchor) <=
      (candidate.id === actor.targetId ? SQUAD_HOLD_LEASH : SQUAD_HOLD_RADIUS)),
  )
  const choice = selectThreat(actor, eligible, actor.role === 'archer' ? 15 : 9, positionOf, null)
  return choice && choice !== 'player'
    ? { ...travel, target: choice, status: 'engaged', catchUp: false }
    : travel
}

export function isSquadHoldStepAllowed(
  start: SquadPoint,
  next: SquadPoint,
  anchor: SquadPoint,
): boolean {
  const nextDistance = squadDistance(next, anchor)
  return nextDistance <= SQUAD_HOLD_LEASH ||
    nextDistance < squadDistance(start, anchor) - 0.001
}

/** A failed local search is a blocked destination, not an unchecked success. */
export function findSquadWalkablePosition(
  desired: SquadPoint,
  valid: (point: SquadPoint) => boolean,
  maxRadius = 3.2,
): SquadPoint | null {
  if (valid(desired)) return { ...desired }
  const rings = Math.min(10, Math.ceil(maxRadius / 0.8))
  for (let ring = 1; ring <= rings; ring += 1) {
    const distance = Math.min(maxRadius, ring * 0.8)
    for (let step = 0; step < 12; step += 1) {
      const angle = step * Math.PI / 6
      const candidate = {
        x: desired.x + Math.cos(angle) * distance,
        z: desired.z + Math.sin(angle) * distance,
      }
      if (valid(candidate)) return candidate
    }
  }
  return null
}

export function advanceSquadBlockedTime(
  previous: number,
  delta: number,
  requested: number,
  forwardProgress: number,
  unavailable: boolean,
): number {
  return unavailable || (requested > 0.001 && forwardProgress < requested * 0.18)
    ? Math.min(SQUAD_BLOCKED_SECONDS * 2, previous + Math.max(0, delta))
    : Math.max(0, previous - Math.max(0, delta) * 2)
}

export function squadMemberStatus(input: {
  intent: SquadIntent<unknown> | null
  distance: number
  blockedSeconds: number
  routing: boolean
  reacting: boolean
  attacking: boolean
}): SquadMemberStatus {
  if (input.routing) return 'routing'
  if (input.reacting) return 'recovering'
  if (input.blockedSeconds >= SQUAD_BLOCKED_SECONDS) return 'blocked'
  if (input.distance > SQUAD_DISTANT_DISTANCE) return 'distant'
  if (input.attacking) return 'engaged'
  return input.intent?.status ?? 'regrouping'
}

export function buildSquadCommandView(
  state: SquadCommandState,
  roster: readonly SquadRosterMember[],
  targets: readonly SquadFocusView[] = [],
  focus: SquadFocusView | null = null,
): SquadCommandView {
  return {
    mode: state.mode,
    baseStance: state.baseStance,
    anchor: state.mode === 'hold' || (state.mode === 'focus' && state.baseStance === 'hold')
      ? { ...state.anchor } : null,
    focusTargetId: state.focusTargetId,
    roster: roster.slice(0, MAX_ACTORS).map((member) => ({ ...member })),
    targets: targets.slice(0, MAX_ACTORS).map((target) => ({ ...target })),
    focus: focus ? { ...focus } : null,
  }
}

export function buildSavedSquadRoster(
  companions: readonly RunCompanionState[],
  state: SquadCommandState,
  faction: Faction,
  player: SquadPoint,
): SquadRosterMember[] {
  const occupied = new Set<number>()
  const roster: SquadRosterMember[] = []
  for (const companion of [...companions].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!isSquadMember({
      allegiance: faction, role: companion.role, alive: companion.health > 0,
      hp: companion.health, squadEligible: true, budgetCategory: 'squad',
      eventOwnerId: null, aiMode: 'normal', hostileToPlayer: false,
    }, faction)) continue
    if (roster.length >= MAX_ACTORS) break
    const slot = isSquadSlot(companion.formationSlot) && !occupied.has(companion.formationSlot)
      ? companion.formationSlot : allocateSquadSlot(companion.id, occupied)
    occupied.add(slot)
    const position = { x: companion.worldPosition[0], z: companion.worldPosition[2] }
    const distance = squadDistance(position, player)
    const atPost = state.mode === 'hold' && squadDistance(position,
      squadFormationPosition(slot, companion.role, state.anchor, state.anchor.heading)) <= SQUAD_ARRIVAL_DISTANCE
    roster.push({
      id: companion.id, role: companion.role, slot,
      health: companion.health, maxHealth: companion.maxHealth, distance,
      status: distance > SQUAD_DISTANT_DISTANCE ? 'distant' :
        state.mode === 'hold' ? atPost ? 'holding' : 'positioning' :
          state.mode === 'follow' ? 'following' : 'regrouping',
    })
  }
  return roster.sort((left, right) => left.slot - right.slot)
}
