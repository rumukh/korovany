import type { ActorRole, Faction } from '../types.ts'
import type { RunCompanionState, SerializableState } from '../run/runTypes.ts'
import {
  STARTING_SQUAD_VERSION,
  SQUAD_REGROUP_DISTANCE,
  startingSquadIdentity,
} from '../squadMovement.ts'
import { CARAVAN_BEAT_SQUAD_CAP } from './CaravanBeats.ts'

export const SQUAD_RESOURCE_VERSION = 1
export const SQUAD_RESOURCE_CAP = CARAVAN_BEAT_SQUAD_CAP
export const RECOVERY_TREATMENTS_PER_SITE = 2
export const RATION_COMPANION_HEAL = 35
export const MEDICINE_COMPANION_HEAL = 55
export const RECOVERY_COMPANION_HEAL = 40
export const COMPANION_TREATMENT_RANGE = SQUAD_REGROUP_DISTANCE
export const SQUAD_CREDIT_REPORT_DISTANCE = 40
export const SQUAD_ONLY_GOLD_FACTOR = 0.5
export const VILLAIN_MUSTER_LIMIT = 1

const MAX_RESOURCE_COUNTER = 32
const MAX_FIGHT_KEYS = 32
const MAX_ID_LENGTH = 160

export type SquadReinforcementSource =
  | 'elfRescue'
  | 'elfDefense'
  | 'guardOrder'
  | 'villainMuster'
  | 'villainPress'

export type PendingSquadReinforcementSource =
  | 'elfDefense'
  | 'guardOrder'
  | 'villainMuster'

export const SQUAD_REINFORCEMENT_SOURCES: readonly SquadReinforcementSource[] = [
  'elfRescue',
  'elfDefense',
  'guardOrder',
  'villainMuster',
  'villainPress',
]

export interface SquadResourcePoint {
  x: number
  z: number
}

export interface PendingSquadReinforcement {
  id: string
  source: PendingSquadReinforcementSource
  role: ActorRole
  position: SquadResourcePoint
}

export interface SquadResourceState {
  version: 1
  recoveryTreatments: Record<string, number>
  casualties: number
  villainMustersUsed: number
  reinforcements: Record<SquadReinforcementSource, number>
  pending: PendingSquadReinforcement[]
  contributedFightKeys: string[]
}

export interface SquadResourceView {
  cap: number
  rations: number
  playerHealth: number
  playerMaxHealth: number
  treatmentRange: number
  casualties: number
  pending: number
  reinforcements: Record<SquadReinforcementSource, number>
  villainMuster: {
    siteId: string
    regionLabel: string
    remaining: number
    available: boolean
  } | null
}

export interface SquadResourceRestoreOptions {
  recoverySiteIds: readonly string[]
  companions?: readonly RunCompanionState[]
  faction: Faction
  startingSquadVersion?: unknown
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export interface SquadRewardCredit {
  gold: number
  fullGold: number
  reduced: boolean
}

function reinforcementCounts(): Record<SquadReinforcementSource, number> {
  return {
    elfRescue: 0,
    elfDefense: 0,
    guardOrder: 0,
    villainMuster: 0,
    villainPress: 0,
  }
}

function normalizedSiteIds(siteIds: readonly string[]): string[] {
  return [...new Set(siteIds.filter(validId))].sort((left, right) => left.localeCompare(right))
}

export function deriveSquadCasualties(
  faction: Faction,
  companions: readonly RunCompanionState[] = [],
  startingSquadVersion: unknown,
): number {
  if (startingSquadVersion !== STARTING_SQUAD_VERSION) return 0
  const living = new Set(companions.filter((entry) => entry.health > 0).map((entry) => entry.id))
  let missing = 0
  for (let index = 0; index < 3; index += 1) {
    if (!living.has(startingSquadIdentity(faction, index))) missing += 1
  }
  return missing
}

export function createSquadResourceState(
  recoverySiteIds: readonly string[],
  casualties = 0,
): SquadResourceState {
  return {
    version: SQUAD_RESOURCE_VERSION,
    recoveryTreatments: Object.fromEntries(
      normalizedSiteIds(recoverySiteIds).map((siteId) => [siteId, RECOVERY_TREATMENTS_PER_SITE]),
    ),
    casualties: boundedCounter(casualties),
    villainMustersUsed: 0,
    reinforcements: reinforcementCounts(),
    pending: [],
    contributedFightKeys: [],
  }
}

function createRejectedSquadResourceState(
  recoverySiteIds: readonly string[],
  casualties: number,
): SquadResourceState {
  const state = createSquadResourceState(recoverySiteIds, casualties)
  for (const siteId of Object.keys(state.recoveryTreatments)) {
    state.recoveryTreatments[siteId] = 0
  }
  state.villainMustersUsed = VILLAIN_MUSTER_LIMIT
  return state
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value.trim() === value &&
    [...value].every((character) => character.charCodeAt(0) >= 32)
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : null
}

function boundedCounter(value: number): number {
  return Number.isFinite(value)
    ? Math.min(MAX_RESOURCE_COUNTER, Math.max(0, Math.trunc(value)))
    : 0
}

function isPendingReinforcementSource(
  value: unknown,
): value is PendingSquadReinforcementSource {
  return value === 'elfDefense' || value === 'guardOrder' || value === 'villainMuster'
}

function isReinforcementRole(value: unknown): value is ActorRole {
  return value === 'soldier' || value === 'scout' || value === 'minion' ||
    value === 'captive'
}

function normalizeTreatments(
  value: unknown,
  recoverySiteIds: readonly string[],
): Record<string, number> | null {
  const source = record(value)
  if (!source) return null
  const siteIds = normalizedSiteIds(recoverySiteIds)
  if (Object.keys(source).length !== siteIds.length) return null
  const treatments: Record<string, number> = {}
  for (const siteId of siteIds) {
    const remaining = integer(source[siteId], 0, RECOVERY_TREATMENTS_PER_SITE)
    if (remaining === null) return null
    treatments[siteId] = remaining
  }
  return treatments
}

function normalizeReinforcementCounts(
  value: unknown,
): Record<SquadReinforcementSource, number> | null {
  const source = record(value)
  if (!source || Object.keys(source).length !== SQUAD_REINFORCEMENT_SOURCES.length) return null
  const counts = reinforcementCounts()
  for (const key of SQUAD_REINFORCEMENT_SOURCES) {
    const count = integer(source[key], 0, MAX_RESOURCE_COUNTER)
    if (count === null) return null
    counts[key] = count
  }
  return counts
}

function normalizePending(
  value: unknown,
  bounds: SquadResourceRestoreOptions['bounds'],
): PendingSquadReinforcement[] | null {
  if (!Array.isArray(value) || value.length > SQUAD_RESOURCE_CAP) return null
  const pending: PendingSquadReinforcement[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    const source = record(entry)
    const position = record(source?.position)
    const id = source?.id
    const kind = source?.source
    const role = source?.role
    const x = finite(position?.x, bounds.minX, bounds.maxX)
    const z = finite(position?.z, bounds.minZ, bounds.maxZ)
    if (
      !validId(id) ||
      ids.has(id) ||
      !isPendingReinforcementSource(kind) ||
      !isReinforcementRole(role) ||
      x === null ||
      z === null
    ) return null
    ids.add(id)
    pending.push({ id, source: kind, role, position: { x, z } })
  }
  return pending
}

function normalizeFightKeys(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_FIGHT_KEYS) return null
  const keys: string[] = []
  const seen = new Set<string>()
  for (const key of value) {
    if (!validId(key) || seen.has(key)) return null
    seen.add(key)
    keys.push(key)
  }
  return keys
}

export function restoreSquadResourceState(
  value: unknown,
  options: SquadResourceRestoreOptions,
): { state: SquadResourceState; rejected: boolean } {
  const casualties = deriveSquadCasualties(
    options.faction,
    options.companions,
    options.startingSquadVersion,
  )
  if (value === undefined) {
    return {
      state: createSquadResourceState(options.recoverySiteIds, casualties),
      rejected: false,
    }
  }
  const source = record(value)
  const treatments = normalizeTreatments(source?.recoveryTreatments, options.recoverySiteIds)
  const savedCasualties = integer(source?.casualties, 0, MAX_RESOURCE_COUNTER)
  const villainMustersUsed = integer(source?.villainMustersUsed, 0, VILLAIN_MUSTER_LIMIT)
  const reinforcements = normalizeReinforcementCounts(source?.reinforcements)
  const pending = normalizePending(source?.pending, options.bounds)
  const contributedFightKeys = normalizeFightKeys(source?.contributedFightKeys)
  if (
    source?.version !== SQUAD_RESOURCE_VERSION ||
    !treatments ||
    savedCasualties === null ||
    villainMustersUsed === null ||
    !reinforcements ||
    !pending ||
    !contributedFightKeys ||
    pending.length > Math.max(0, SQUAD_RESOURCE_CAP - (options.companions?.length ?? 0))
  ) {
    return {
      state: createRejectedSquadResourceState(options.recoverySiteIds, casualties),
      rejected: true,
    }
  }
  return {
    state: {
      version: SQUAD_RESOURCE_VERSION,
      recoveryTreatments: treatments,
      casualties: Math.max(casualties, savedCasualties),
      villainMustersUsed,
      reinforcements,
      pending,
      contributedFightKeys,
    },
    rejected: false,
  }
}

export function serializeSquadResourceState(state: SquadResourceState): SerializableState {
  return {
    version: SQUAD_RESOURCE_VERSION,
    recoveryTreatments: { ...state.recoveryTreatments },
    casualties: state.casualties,
    villainMustersUsed: state.villainMustersUsed,
    reinforcements: { ...state.reinforcements },
    pending: state.pending.map((entry) => ({
      id: entry.id,
      source: entry.source,
      role: entry.role,
      position: { ...entry.position },
    })) as SerializableState[string],
    contributedFightKeys: [...state.contributedFightKeys],
  }
}

export function recoveryTreatmentsRemaining(
  state: SquadResourceState,
  siteId: string,
): number {
  return state.recoveryTreatments[siteId] ?? 0
}

export function consumeRecoveryTreatment(
  state: SquadResourceState,
  siteId: string,
): boolean {
  const remaining = recoveryTreatmentsRemaining(state, siteId)
  if (remaining <= 0) return false
  state.recoveryTreatments[siteId] = remaining - 1
  return true
}

export function canTreatCompanion(input: {
  health: number
  maxHealth: number
  distance: number
}): boolean {
  return input.health > 0 &&
    input.health < input.maxHealth &&
    input.distance <= COMPANION_TREATMENT_RANGE
}

export function healCompanionHealth(
  health: number,
  maxHealth: number,
  amount: number,
): { health: number; restored: number } {
  const boundedHealth = Math.min(maxHealth, Math.max(0, health))
  const restored = Math.min(
    Math.max(0, maxHealth - boundedHealth),
    Math.max(0, Number.isFinite(amount) ? amount : 0),
  )
  return { health: boundedHealth + restored, restored }
}

export function recordSquadCasualty(state: SquadResourceState): void {
  state.casualties = boundedCounter(state.casualties + 1)
}

export function availableSquadCapacity(
  state: SquadResourceState,
  livingSquad: number,
): number {
  return Math.max(0, SQUAD_RESOURCE_CAP - Math.max(0, livingSquad) - state.pending.length)
}

export function canVillainMuster(input: {
  state: SquadResourceState
  faction: Faction
  livingSquad: number
  atOldFort: boolean
}): boolean {
  return input.faction === 'villain' &&
    input.atOldFort &&
    input.state.casualties > 0 &&
    input.state.villainMustersUsed < VILLAIN_MUSTER_LIMIT &&
    availableSquadCapacity(input.state, input.livingSquad) > 0
}

export function queueSquadReinforcement(
  state: SquadResourceState,
  livingSquad: number,
  reinforcement: PendingSquadReinforcement,
): boolean {
  if (
    availableSquadCapacity(state, livingSquad) <= 0 ||
    state.pending.some((entry) => entry.id === reinforcement.id)
  ) return false
  state.pending.push({
    ...reinforcement,
    position: { ...reinforcement.position },
  })
  state.reinforcements[reinforcement.source] = boundedCounter(
    state.reinforcements[reinforcement.source] + 1,
  )
  if (reinforcement.source === 'villainMuster') {
    state.villainMustersUsed = Math.min(
      VILLAIN_MUSTER_LIMIT,
      state.villainMustersUsed + 1,
    )
  }
  return true
}

export function recordImmediateSquadReinforcement(
  state: SquadResourceState,
  source: SquadReinforcementSource,
): void {
  state.reinforcements[source] = boundedCounter(state.reinforcements[source] + 1)
}

export function removePendingSquadReinforcement(
  state: SquadResourceState,
  id: string,
): void {
  const index = state.pending.findIndex((entry) => entry.id === id)
  if (index >= 0) state.pending.splice(index, 1)
}

export function markFightContribution(state: SquadResourceState, key: string): void {
  if (!validId(key) || state.contributedFightKeys.includes(key)) return
  if (state.contributedFightKeys.length >= MAX_FIGHT_KEYS) {
    state.contributedFightKeys.shift()
  }
  state.contributedFightKeys.push(key)
}

export function hasFightContribution(state: SquadResourceState, key: string | null): boolean {
  return key !== null && state.contributedFightKeys.includes(key)
}

export function clearFightContribution(state: SquadResourceState, key: string | null): void {
  if (key === null) return
  const index = state.contributedFightKeys.indexOf(key)
  if (index >= 0) state.contributedFightKeys.splice(index, 1)
}

export function squadRewardCredit(
  fullGold: number,
  contributed: boolean,
): SquadRewardCredit {
  const boundedGold = Math.max(0, Math.trunc(Number.isFinite(fullGold) ? fullGold : 0))
  const reduced = !contributed
  return {
    fullGold: boundedGold,
    gold: reduced ? Math.floor(boundedGold * SQUAD_ONLY_GOLD_FACTOR) : boundedGold,
    reduced,
  }
}

export function buildSquadResourceView(input: {
  state: SquadResourceState
  rations: number
  playerHealth: number
  playerMaxHealth: number
  faction: Faction
  livingSquad: number
  musterSiteId: string
  musterRegionLabel: string
}): SquadResourceView {
  const remaining = Math.max(0, VILLAIN_MUSTER_LIMIT - input.state.villainMustersUsed)
  return {
    cap: SQUAD_RESOURCE_CAP,
    rations: Math.max(0, Math.trunc(input.rations)),
    playerHealth: Math.max(0, input.playerHealth),
    playerMaxHealth: Math.max(1, input.playerMaxHealth),
    treatmentRange: COMPANION_TREATMENT_RANGE,
    casualties: input.state.casualties,
    pending: input.state.pending.length,
    reinforcements: { ...input.state.reinforcements },
    villainMuster: input.faction === 'villain'
      ? {
          siteId: input.musterSiteId,
          regionLabel: input.musterRegionLabel,
          remaining,
          available:
            input.state.casualties > 0 &&
            remaining > 0 &&
            availableSquadCapacity(input.state, input.livingSquad) > 0,
        }
      : null,
  }
}
