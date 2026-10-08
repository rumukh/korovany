import type { GeneratedEncounterPlan } from '../content/registry.ts'
import { RandomStream } from '../random/RandomStream.ts'
import { deriveSeed } from '../random/seed.ts'
import {
  type ActorRole,
  type Faction,
} from '../types.ts'

export const ENEMY_HP_MULTIPLIER_CAP = 1.65
export const ENCOUNTER_DIFFICULTY_HEALTH_STEP = 0.12
export const ENCOUNTER_COMPOSITIONS_VERSION = 1 as const
export const MAX_ENCOUNTER_COMPOSITIONS = 64
export const MAX_COMPOSITION_MEMBERS = 8

const MAX_ID_LENGTH = 256
const MAX_SIGNATURE_LENGTH = 4096

const ACTOR_ROLES: readonly ActorRole[] = [
  'soldier',
  'scout',
  'commander',
  'minion',
  'archer',
  'brute',
  'champion',
  'captive',
  'peasant',
  'wolf',
  'boar',
  'bear',
  'troll',
]
const ACTOR_ROLE_SET = new Set<string>(ACTOR_ROLES)

type CompositionTier = 1 | 2 | 3 | 4 | 5
type EscalatingCompositionTier = Exclude<CompositionTier, 1>

export const ENCOUNTER_ROLE_REQUIREMENTS = {
  elf: {
    2: ['archer', 'scout'],
    3: ['archer', 'scout', 'scout'],
    4: ['archer', 'scout', 'archer'],
    5: ['archer', 'scout', 'archer', 'scout'],
  },
  guard: {
    2: ['archer', 'soldier'],
    3: ['archer', 'soldier', 'soldier'],
    4: ['brute', 'archer', 'soldier'],
    5: ['commander', 'archer', 'soldier', 'soldier'],
  },
  villain: {
    2: ['archer', 'minion'],
    3: ['archer', 'minion', 'minion'],
    4: ['brute', 'archer', 'minion'],
    5: ['brute', 'archer', 'brute', 'minion'],
  },
} as const satisfies Record<
  Faction,
  Record<EscalatingCompositionTier, readonly ActorRole[]>
>

export interface EncounterCompositionEntry {
  encounterId: string
  planSignature: string
  stagedTier: CompositionTier
  ordinal: number
  roles: Map<string, ActorRole>
}

export interface EncounterCompositions {
  entries: Map<string, EncounterCompositionEntry>
  nextOrdinal: number
}

export type EncounterCompositionSaveEntry = {
  encounterId: string
  planSignature: string
  stagedTier: CompositionTier
  ordinal: number
  roles: Array<{ spawnId: string; role: ActorRole }>
}

export type EncounterCompositionsSave = {
  version: typeof ENCOUNTER_COMPOSITIONS_VERSION
  nextOrdinal: number
  encounters: EncounterCompositionSaveEntry[]
}

export interface StageEncounterCompositionResult {
  plan: GeneratedEncounterPlan
  entry: EncounterCompositionEntry | null
  evictedEncounterId: string | null
  overflow: boolean
}

export function encounterDifficultyHealthMultiplier(difficulty: number): number {
  const tier = Number.isFinite(difficulty)
    ? Math.max(1, Math.min(5, Math.floor(difficulty)))
    : 1
  return 1 + (tier - 1) * ENCOUNTER_DIFFICULTY_HEALTH_STEP
}

export function cappedEncounterHealthScale(
  clockMultiplier: number,
  difficulty: number,
  hostileToPlayer: boolean,
): number {
  if (!Number.isFinite(clockMultiplier) || clockMultiplier <= 0) {
    throw new RangeError('Enemy clock health multiplier must be finite and positive')
  }
  const difficultyMultiplier = encounterDifficultyHealthMultiplier(difficulty)
  if (!hostileToPlayer) return difficultyMultiplier
  return Math.min(
    difficultyMultiplier,
    ENEMY_HP_MULTIPLIER_CAP / clockMultiplier,
  )
}

export function combinedEnemyHealthMultiplier(
  clockMultiplier: number,
  difficulty: number,
  hostileToPlayer: boolean,
): number {
  if (!Number.isFinite(clockMultiplier) || clockMultiplier <= 0) {
    throw new RangeError('Enemy clock health multiplier must be finite and positive')
  }
  const difficultyMultiplier = encounterDifficultyHealthMultiplier(difficulty)
  return hostileToPlayer
    ? Math.min(
        ENEMY_HP_MULTIPLIER_CAP,
        clockMultiplier * difficultyMultiplier,
      )
    : difficultyMultiplier
}

export function createEncounterCompositions(): EncounterCompositions {
  return {
    entries: new Map(),
    nextOrdinal: 1,
  }
}

export function encounterCompositionPlanSignature(
  plan: GeneratedEncounterPlan,
): string {
  return JSON.stringify({
    encounterId: plan.encounterId,
    faction: plan.hostileFaction,
    kind: plan.kind,
    hostile: plan.hostileToPlayer,
    spawns: plan.spawns.map((spawn) => [
      spawn.id,
      spawn.role,
      spawn.objective,
      spawn.objectiveEligible,
      spawn.unique,
    ]),
  })
}

function normalizeCompositionTier(value: number): CompositionTier {
  return Math.max(1, Math.min(5, Math.floor(value))) as CompositionTier
}

function compositionSeedKey(
  plan: GeneratedEncounterPlan,
  playerFaction: Faction,
  tier: CompositionTier,
): string {
  return [
    'gameplay:encounter-composition',
    plan.encounterId,
    playerFaction,
    plan.hostileFaction,
    String(tier),
  ].join(':')
}

function lockedSpawnIds(plan: GeneratedEncounterPlan): Set<string> {
  const locked = new Set(
    plan.spawns
      .filter((spawn) =>
        spawn.unique ||
        spawn.objective ||
        spawn.objectiveEligible,
      )
      .map((spawn) => spawn.id),
  )
  if (plan.kind === 'elite' && plan.spawns[0]) {
    locked.add(plan.spawns[0].id)
  }
  return locked
}

function composedRoles(
  plan: GeneratedEncounterPlan,
  worldSeed: number,
  playerFaction: Faction,
  tier: CompositionTier,
): Map<string, ActorRole> {
  const roles = new Map(
    plan.spawns.map((spawn) => [spawn.id, spawn.role]),
  )
  if (
    tier === 1 ||
    !plan.hostileToPlayer ||
    plan.kind === 'boss'
  ) {
    return roles
  }

  const locked = lockedSpawnIds(plan)
  const stream = new RandomStream(
    deriveSeed(worldSeed, compositionSeedKey(plan, playerFaction, tier)),
  )
  const available = stream.shuffle(
    plan.spawns
      .filter((spawn) => !locked.has(spawn.id))
      .map((spawn) => spawn.id),
  )
  const required = [
    ...ENCOUNTER_ROLE_REQUIREMENTS[plan.hostileFaction][tier],
  ].slice(0, available.length)

  for (const role of required) {
    const matchingIndex = available.findIndex(
      (spawnId) => roles.get(spawnId) === role,
    )
    const index = matchingIndex >= 0 ? matchingIndex : 0
    const spawnId = available[index]
    if (!spawnId) break
    roles.set(spawnId, role)
    available.splice(index, 1)
  }
  return roles
}

function planWithRoles(
  plan: GeneratedEncounterPlan,
  roles: ReadonlyMap<string, ActorRole>,
): GeneratedEncounterPlan {
  return {
    ...plan,
    spawns: plan.spawns.map((spawn) => ({
      ...spawn,
      role: roles.get(spawn.id) ?? spawn.role,
    })),
  }
}

function sameRoles(
  plan: GeneratedEncounterPlan,
  roles: ReadonlyMap<string, ActorRole>,
): boolean {
  return (
    roles.size === plan.spawns.length &&
    plan.spawns.every((spawn) => roles.get(spawn.id) !== undefined)
  )
}

function sameRoleDecision(
  first: ReadonlyMap<string, ActorRole>,
  second: ReadonlyMap<string, ActorRole>,
): boolean {
  return (
    first.size === second.size &&
    [...first].every(([spawnId, role]) => second.get(spawnId) === role)
  )
}

function nextOrdinal(state: EncounterCompositions): number {
  if (
    Number.isSafeInteger(state.nextOrdinal) &&
    state.nextOrdinal > 0 &&
    state.nextOrdinal < Number.MAX_SAFE_INTEGER
  ) {
    return state.nextOrdinal
  }
  const ordered = [...state.entries.values()].sort(
    (left, right) =>
      left.ordinal - right.ordinal ||
      left.encounterId.localeCompare(right.encounterId),
  )
  ordered.forEach((entry, index) => {
    entry.ordinal = index + 1
  })
  state.nextOrdinal = ordered.length + 1
  return state.nextOrdinal
}

function insertComposition(
  state: EncounterCompositions,
  entry: EncounterCompositionEntry,
  protectedEncounterIds: ReadonlySet<string>,
): { evictedEncounterId: string | null; overflow: boolean } {
  let evictedEncounterId: string | null = null
  if (
    !state.entries.has(entry.encounterId) &&
    state.entries.size >= MAX_ENCOUNTER_COMPOSITIONS
  ) {
    const candidate = [...state.entries.values()]
      .filter((value) => !protectedEncounterIds.has(value.encounterId))
      .sort(
        (left, right) =>
          left.ordinal - right.ordinal ||
          left.encounterId.localeCompare(right.encounterId),
      )[0]
    if (!candidate) {
      return {
        evictedEncounterId: null,
        overflow: true,
      }
    }
    state.entries.delete(candidate.encounterId)
    evictedEncounterId = candidate.encounterId
  }
  state.entries.set(entry.encounterId, entry)
  state.nextOrdinal = Math.max(state.nextOrdinal, entry.ordinal + 1)
  return {
    evictedEncounterId,
    overflow: false,
  }
}

function validStoredEntry(
  entry: EncounterCompositionEntry,
  plan: GeneratedEncounterPlan,
  worldSeed: number,
  playerFaction: Faction,
): boolean {
  if (
    entry.planSignature !== encounterCompositionPlanSignature(plan) ||
    !sameRoles(plan, entry.roles)
  ) {
    return false
  }
  const expected = composedRoles(
    plan,
    worldSeed,
    playerFaction,
    entry.stagedTier,
  )
  return sameRoleDecision(entry.roles, expected)
}

export function applyStoredEncounterComposition(
  state: EncounterCompositions,
  plan: GeneratedEncounterPlan,
  worldSeed: number,
  playerFaction: Faction,
): GeneratedEncounterPlan | null {
  const existing = state.entries.get(plan.encounterId)
  if (!existing) return null
  if (
    !validStoredEntry(
      existing,
      plan,
      worldSeed,
      playerFaction,
    )
  ) {
    state.entries.delete(plan.encounterId)
    return null
  }
  return planWithRoles(plan, existing.roles)
}

export function stageEncounterComposition(
  state: EncounterCompositions,
  plan: GeneratedEncounterPlan,
  worldSeed: number,
  playerFaction: Faction,
  threatTier: number,
  protectedEncounterIds: ReadonlySet<string> = new Set(),
): StageEncounterCompositionResult {
  if (!plan.hostileToPlayer || plan.kind === 'boss') {
    return {
      plan,
      entry: null,
      evictedEncounterId: null,
      overflow: false,
    }
  }

  const restored = applyStoredEncounterComposition(
    state,
    plan,
    worldSeed,
    playerFaction,
  )
  if (restored) {
    const existing = state.entries.get(plan.encounterId)
    return {
      plan: restored,
      entry: existing ?? null,
      evictedEncounterId: null,
      overflow: false,
    }
  }

  const stagedTier = normalizeCompositionTier(threatTier)
  const roles = composedRoles(
    plan,
    worldSeed,
    playerFaction,
    stagedTier,
  )
  const ordinal = nextOrdinal(state)
  const entry: EncounterCompositionEntry = {
    encounterId: plan.encounterId,
    planSignature: encounterCompositionPlanSignature(plan),
    stagedTier,
    ordinal,
    roles,
  }
  const inserted = insertComposition(
    state,
    entry,
    protectedEncounterIds,
  )
  if (inserted.overflow) {
    return {
      plan,
      entry: null,
      evictedEncounterId: null,
      overflow: true,
    }
  }
  return {
    plan: planWithRoles(plan, roles),
    entry,
    ...inserted,
  }
}

export function recoverEncounterCompositionFromRemnant(
  state: EncounterCompositions,
  plan: GeneratedEncounterPlan,
  remnantSignature: string,
  worldSeed: number,
  playerFaction: Faction,
  protectedEncounterIds: ReadonlySet<string>,
): StageEncounterCompositionResult | null {
  const separator = remnantSignature.indexOf('/')
  if (separator <= 0) return null
  const faction = remnantSignature.slice(0, separator)
  const values = remnantSignature.slice(separator + 1).split(',')
  if (
    faction !== plan.hostileFaction ||
    values.length !== plan.spawns.length ||
    values.some((value) => !ACTOR_ROLE_SET.has(value))
  ) {
    return null
  }
  const recovered = new Map<string, ActorRole>()
  plan.spawns.forEach((spawn, index) => {
    recovered.set(spawn.id, values[index] as ActorRole)
  })

  let stagedTier: CompositionTier | null = null
  for (let tier = 1; tier <= 5; tier += 1) {
    const candidate = composedRoles(
      plan,
      worldSeed,
      playerFaction,
      tier as CompositionTier,
    )
    if (sameRoleDecision(recovered, candidate)) {
      stagedTier = tier as CompositionTier
      break
    }
  }
  if (stagedTier === null) return null

  const entry: EncounterCompositionEntry = {
    encounterId: plan.encounterId,
    planSignature: encounterCompositionPlanSignature(plan),
    stagedTier,
    ordinal: nextOrdinal(state),
    roles: recovered,
  }
  const inserted = insertComposition(
    state,
    entry,
    protectedEncounterIds,
  )
  if (inserted.overflow) {
    return {
      plan,
      entry: null,
      evictedEncounterId: null,
      overflow: true,
    }
  }
  return {
    plan: planWithRoles(plan, recovered),
    entry,
    ...inserted,
  }
}

export function forgetEncounterComposition(
  state: EncounterCompositions,
  encounterId: string,
): void {
  state.entries.delete(encounterId)
}

export function serializeEncounterCompositions(
  state: EncounterCompositions,
): EncounterCompositionsSave {
  return {
    version: ENCOUNTER_COMPOSITIONS_VERSION,
    nextOrdinal: state.nextOrdinal,
    encounters: [...state.entries.values()]
      .sort(
        (left, right) =>
          left.ordinal - right.ordinal ||
          left.encounterId.localeCompare(right.encounterId),
      )
      .map((entry) => ({
        encounterId: entry.encounterId,
        planSignature: entry.planSignature,
        stagedTier: entry.stagedTier,
        ordinal: entry.ordinal,
        roles: [...entry.roles]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([spawnId, role]) => ({ spawnId, role })),
      })),
  }
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function readId(value: unknown, maximumLength = MAX_ID_LENGTH): string | null {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength
  )
    ? value
    : null
}

function readPositiveInteger(value: unknown): number | null {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  )
    ? value
    : null
}

function readCompositionEntry(
  value: unknown,
): EncounterCompositionEntry | null {
  const record = asRecord(value)
  const encounterId = readId(record?.encounterId)
  const planSignature = readId(
    record?.planSignature,
    MAX_SIGNATURE_LENGTH,
  )
  const stagedTier = readPositiveInteger(record?.stagedTier)
  const ordinal = readPositiveInteger(record?.ordinal)
  const savedRoles = record?.roles
  if (
    !record ||
    !encounterId ||
    !planSignature ||
    !stagedTier ||
    stagedTier > 5 ||
    !ordinal ||
    !Array.isArray(savedRoles) ||
    savedRoles.length === 0 ||
    savedRoles.length > MAX_COMPOSITION_MEMBERS
  ) {
    return null
  }

  const roles = new Map<string, ActorRole>()
  for (const value of savedRoles) {
    const savedRole = asRecord(value)
    const spawnId = readId(savedRole?.spawnId)
    const role = savedRole?.role
    if (
      !spawnId ||
      typeof role !== 'string' ||
      !ACTOR_ROLE_SET.has(role) ||
      roles.has(spawnId)
    ) {
      return null
    }
    roles.set(spawnId, role as ActorRole)
  }
  return {
    encounterId,
    planSignature,
    stagedTier: stagedTier as CompositionTier,
    ordinal,
    roles,
  }
}

export function normalizeEncounterCompositions(value: unknown): {
  compositions: EncounterCompositions
  rejected: boolean
} {
  const compositions = createEncounterCompositions()
  if (value === undefined || value === null) {
    return {
      compositions,
      rejected: false,
    }
  }
  const record = asRecord(value)
  const next = readPositiveInteger(record?.nextOrdinal)
  const encounters = record?.encounters
  if (
    !record ||
    record.version !== ENCOUNTER_COMPOSITIONS_VERSION ||
    !next ||
    !Array.isArray(encounters) ||
    encounters.length > MAX_ENCOUNTER_COMPOSITIONS
  ) {
    return {
      compositions,
      rejected: true,
    }
  }

  const ordinals = new Set<number>()
  let largestOrdinal = 0
  for (const value of encounters) {
    const entry = readCompositionEntry(value)
    if (
      !entry ||
      compositions.entries.has(entry.encounterId) ||
      ordinals.has(entry.ordinal)
    ) {
      return {
        compositions: createEncounterCompositions(),
        rejected: true,
      }
    }
    compositions.entries.set(entry.encounterId, entry)
    ordinals.add(entry.ordinal)
    largestOrdinal = Math.max(largestOrdinal, entry.ordinal)
  }
  if (next <= largestOrdinal) {
    return {
      compositions: createEncounterCompositions(),
      rejected: true,
    }
  }
  compositions.nextOrdinal = next
  return {
    compositions,
    rejected: false,
  }
}
