import { normalizeAchievementRunState } from '../achievements.ts'
import { countRewardedObjectives } from '../world/CampaignDirector.ts'
import {
  normalizeChronicleState,
  normalizeRegionChronicleState,
} from '../world/Chronicle.ts'
import { REGION_DELTA_VERSION } from '../world/RegionRuntime.ts'
import {
  MAX_EPILOGUE_BEATS,
  MAX_EPILOGUE_COMPANIONS,
  MAX_EPILOGUE_DOCTRINES,
  MAX_EPILOGUE_ROUTE,
  MAX_EPILOGUE_WOUNDS,
  buildRunEpilogue,
} from './epilogue.ts'
import {
  DEFAULT_STARTING_BOON_IDS,
  MAX_SEEN_HINTS,
  computeRunCompletionReward,
  isBoonId,
} from './profile.ts'
import {
  ACTIVE_RUN_SAVE_KEY,
  ACTIVE_RUN_SAVE_VERSION,
  PROFILE_SAVE_KEY,
  PROFILE_SAVE_VERSION,
} from './runTypes.ts'
import type {
  ActiveRunSaveV3,
  JsonValue,
  ProfileSaveV1,
  RegionDelta,
  RunCompanionState,
  RunConfig,
  RunEndCause,
  RunEpilogue,
  RunEpilogueBeat,
  RunEpilogueCompanion,
  RunEpilogueControl,
  RunEpilogueWound,
  RunHistorySummary,
  RunLocationState,
  RunPlayerState,
  RunStatus,
  SerializablePosition,
  SerializableState,
} from './runTypes'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type StorageWarning = (message: string, error?: unknown) => void

export const MAX_PROFILE_RUN_HISTORY = 50
export const MAX_RUN_HISTORY = MAX_PROFILE_RUN_HISTORY
export const MAX_FINALIZED_RUN_IDS = 500

const MAX_ID_LENGTH = 256
const MAX_STRING_ARRAY_LENGTH = 2_048
const MAX_REGION_DELTAS = 2_048
const MAX_STATE_ENTRIES = 512
const MAX_STATE_DEPTH = 12
const MAX_COUNTER = Number.MAX_SAFE_INTEGER
const MAX_SCALAR = 1_000_000_000
const MAX_POSITION = 10_000_000
const MAX_UPGRADE_LEVEL = 100
const UINT32_MAX = 0xffff_ffff
const INVALID_JSON = Symbol('invalid-json')

function warn(
  onWarning: StorageWarning | undefined,
  message: string,
  error?: unknown,
): void {
  onWarning?.(message, error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
    ? value
    : null
}

function normalizeTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function normalizeNonNegative(
  value: unknown,
  maximum = MAX_SCALAR,
  integer = false,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.min(maximum, Math.max(0, value))
  return integer ? Math.floor(normalized) : normalized
}

function normalizeSigned(value: unknown, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(maximum, Math.max(-maximum, value))
}

function normalizeUint32(value: unknown): number | null {
  return normalizeNonNegative(value, UINT32_MAX, true)
}

function normalizeFaction(value: unknown): ActiveRunSaveV3['config']['faction'] | null {
  return value === 'elf' || value === 'guard' || value === 'villain' ? value : null
}

function normalizeRunStatus(value: unknown): RunStatus | null {
  return value === 'active' ||
    value === 'victory' ||
    value === 'defeat' ||
    value === 'abandoned'
    ? value
    : null
}

function normalizeStringArray(
  value: unknown,
  maximum = MAX_STRING_ARRAY_LENGTH,
): string[] | null {
  if (!Array.isArray(value)) return null
  const result: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const id = normalizeId(entry)
    if (!id) return null
    if (!seen.has(id)) {
      seen.add(id)
      if (result.length < maximum) result.push(id)
    }
  }
  return result
}

function normalizePosition(value: unknown): SerializablePosition | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const x = normalizeSigned(value[0], MAX_POSITION)
  const y = normalizeSigned(value[1], MAX_POSITION)
  const z = normalizeSigned(value[2], MAX_POSITION)
  return x === null || y === null || z === null ? null : [x, y, z]
}

function normalizeJsonValue(
  value: unknown,
  depth: number,
): JsonValue | typeof INVALID_JSON {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return value.length <= 100_000 ? value : INVALID_JSON
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return INVALID_JSON
    return Math.min(MAX_COUNTER, Math.max(-MAX_COUNTER, value))
  }
  if (depth >= MAX_STATE_DEPTH) return INVALID_JSON
  if (Array.isArray(value)) {
    const result: JsonValue[] = []
    for (const entry of value) {
      const normalized = normalizeJsonValue(entry, depth + 1)
      if (normalized === INVALID_JSON) return INVALID_JSON
      if (result.length < MAX_STATE_ENTRIES) result.push(normalized)
    }
    return result
  }
  if (!isRecord(value)) return INVALID_JSON

  const entries: [string, JsonValue][] = []
  for (const [key, entry] of Object.entries(value)) {
    if (
      key.length === 0 ||
      key.length > MAX_ID_LENGTH ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      return INVALID_JSON
    }
    const normalized = normalizeJsonValue(entry, depth + 1)
    if (normalized === INVALID_JSON) return INVALID_JSON
    if (entries.length < MAX_STATE_ENTRIES) entries.push([key, normalized])
  }
  return Object.fromEntries(entries)
}

function normalizeSerializableState(value: unknown): SerializableState | null {
  if (!isRecord(value)) return null
  const normalized = normalizeJsonValue(value, 0)
  return normalized === INVALID_JSON || !isRecord(normalized)
    ? null
    : (normalized as SerializableState)
}

function normalizeConfig(value: unknown): RunConfig | null {
  if (!isRecord(value)) return null
  const seed = normalizeUint32(value.seed)
  const generatorVersion = normalizeNonNegative(value.generatorVersion, 1_000_000, true)
  const faction = normalizeFaction(value.faction)
  const selectedBoonId = normalizeId(value.selectedBoonId)
  const modifiers =
    value.modifiers === undefined ? undefined : normalizeStringArray(value.modifiers, 128)
  if (
    seed === null ||
    generatorVersion === null ||
    !faction ||
    !selectedBoonId ||
    modifiers === null
  ) {
    return null
  }
  return {
    seed,
    generatorVersion,
    faction,
    selectedBoonId,
    ...(modifiers === undefined ? {} : { modifiers }),
  }
}

const PART_STATUSES = ['healthy', 'wounded', 'missing', 'prosthetic'] as const

function normalizeBody(value: unknown): RunPlayerState['body'] | null {
  if (!isRecord(value)) return null
  const leftArm = value.leftArm
  const rightArm = value.rightArm
  const leftLeg = value.leftLeg
  const rightLeg = value.rightLeg
  const leftEye = value.leftEye
  const rightEye = value.rightEye
  const bleeding = normalizeNonNegative(value.bleeding, MAX_SCALAR)
  if (
    !PART_STATUSES.includes(leftArm as (typeof PART_STATUSES)[number]) ||
    !PART_STATUSES.includes(rightArm as (typeof PART_STATUSES)[number]) ||
    !PART_STATUSES.includes(leftLeg as (typeof PART_STATUSES)[number]) ||
    !PART_STATUSES.includes(rightLeg as (typeof PART_STATUSES)[number]) ||
    !PART_STATUSES.includes(leftEye as (typeof PART_STATUSES)[number]) ||
    !PART_STATUSES.includes(rightEye as (typeof PART_STATUSES)[number]) ||
    bleeding === null
  ) {
    return null
  }
  return {
    leftArm: leftArm as RunPlayerState['body']['leftArm'],
    rightArm: rightArm as RunPlayerState['body']['rightArm'],
    leftLeg: leftLeg as RunPlayerState['body']['leftLeg'],
    rightLeg: rightLeg as RunPlayerState['body']['rightLeg'],
    leftEye: leftEye as RunPlayerState['body']['leftEye'],
    rightEye: rightEye as RunPlayerState['body']['rightEye'],
    bleeding,
  }
}

function normalizeObjectives(value: unknown): RunPlayerState['objectives'] | null {
  if (!Array.isArray(value)) return null
  const objectives: RunPlayerState['objectives'] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const id = normalizeId(entry.id)
    if (
      !id ||
      typeof entry.text !== 'string' ||
      entry.text.length > 10_000 ||
      typeof entry.done !== 'boolean'
    ) {
      return null
    }
    // Roadmap 2.1 — the two fields subset completion added. Absent means "required, and
    // this run has not decided against it", which is exactly what every pre-2.1 objective
    // meant; anything that is present but not a boolean is a malformed save and the
    // project's policy for those is discard-and-report, not repair.
    if (
      (entry.optional !== undefined && typeof entry.optional !== 'boolean') ||
      (entry.skipped !== undefined && typeof entry.skipped !== 'boolean')
    ) {
      return null
    }
    // A node cannot be both closed and passed over. A save claiming it is describes a
    // campaign state the engine cannot produce, so it is refused rather than picked from.
    if (entry.done === true && entry.skipped === true) return null
    if (seen.has(id)) continue
    seen.add(id)
    if (objectives.length >= 512) continue

    const target =
      entry.target === undefined
        ? undefined
        : normalizeNonNegative(entry.target, MAX_COUNTER)
    const progress =
      entry.progress === undefined
        ? undefined
        : normalizeNonNegative(entry.progress, MAX_COUNTER)
    if (target === null || progress === null) return null
    objectives.push({
      id,
      text: entry.text,
      done: entry.done,
      ...(entry.optional === true ? { optional: true } : {}),
      ...(entry.skipped === true ? { skipped: true } : {}),
      ...(target === undefined ? {} : { target }),
      ...(progress === undefined
        ? {}
        : { progress: target === undefined ? progress : Math.min(target, progress) }),
    })
  }
  return objectives
}

function normalizeUpgrades(value: unknown): RunPlayerState['upgrades'] | null {
  if (!isRecord(value)) return null
  const blade = normalizeNonNegative(value.blade, MAX_UPGRADE_LEVEL, true)
  const vitality = normalizeNonNegative(value.vitality, MAX_UPGRADE_LEVEL, true)
  const endurance = normalizeNonNegative(value.endurance, MAX_UPGRADE_LEVEL, true)
  return blade === null || vitality === null || endurance === null
    ? null
    : { blade, vitality, endurance }
}

function normalizePlayer(value: unknown): RunPlayerState | null {
  if (!isRecord(value)) return null
  const health = normalizeNonNegative(value.health)
  const maxHealth =
    value.maxHealth === undefined ? undefined : normalizeNonNegative(value.maxHealth)
  const stamina = normalizeNonNegative(value.stamina)
  const maxStamina =
    value.maxStamina === undefined ? undefined : normalizeNonNegative(value.maxStamina)
  const gold = normalizeNonNegative(value.gold, MAX_COUNTER, true)
  const kills = normalizeNonNegative(value.kills, MAX_COUNTER, true)
  const damage = normalizeNonNegative(value.damage)
  const body = normalizeBody(value.body)
  const objectives = normalizeObjectives(value.objectives)
  const upgrades = normalizeUpgrades(value.upgrades)
  if (
    health === null ||
    maxHealth === null ||
    stamina === null ||
    maxStamina === null ||
    gold === null ||
    kills === null ||
    damage === null ||
    !body ||
    !objectives ||
    !upgrades
  ) {
    return null
  }
  return {
    health: maxHealth === undefined ? health : Math.min(maxHealth, health),
    ...(maxHealth === undefined ? {} : { maxHealth }),
    stamina: maxStamina === undefined ? stamina : Math.min(maxStamina, stamina),
    ...(maxStamina === undefined ? {} : { maxStamina }),
    gold,
    kills,
    damage,
    body,
    objectives,
    upgrades,
  }
}

function normalizeCompanionRole(value: unknown): RunCompanionState['role'] | null {
  switch (value) {
    case 'soldier':
    case 'scout':
    case 'minion':
    case 'archer':
    case 'brute':
    case 'champion':
    case 'captive':
      return value
    default:
      return null
  }
}

function normalizeCompanions(
  value: unknown,
): ActiveRunSaveV3['companions'] | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null
  const companions: NonNullable<ActiveRunSaveV3['companions']> = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const id = normalizeId(entry.id)
    const role = normalizeCompanionRole(entry.role)
    const maxHealth = normalizeNonNegative(entry.maxHealth)
    const health = normalizeNonNegative(entry.health)
    const worldPosition = normalizePosition(entry.worldPosition)
    if (
      !id ||
      !role ||
      maxHealth === null ||
      maxHealth <= 0 ||
      health === null ||
      !worldPosition
    ) {
      return null
    }
    if (seen.has(id)) continue
    seen.add(id)
    if (companions.length >= 32) continue
    companions.push({
      id,
      role,
      health: Math.min(maxHealth, health),
      maxHealth,
      worldPosition,
    })
  }
  return companions
}

const ACTOR_ROLES = [
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
] as const

/**
 * Any role at all, unlike `normalizeCompanionRole`.
 *
 * A commander, a peasant or a wolf can never be a saved companion, but any of them can be
 * the last thing a run met — so the killer's role is validated against the whole vocabulary
 * while the squad keeps its narrower one.
 */
function normalizeActorRole(value: unknown): (typeof ACTOR_ROLES)[number] | null {
  return ACTOR_ROLES.includes(value as (typeof ACTOR_ROLES)[number])
    ? (value as (typeof ACTOR_ROLES)[number])
    : null
}

function normalizeEndCause(value: unknown): RunEndCause | null {
  switch (value) {
    case 'objectives':
    case 'faction':
    case 'beast':
    case 'bleeding':
    case 'abandoned':
    case 'unknown':
      return value
    default:
      return null
  }
}

function normalizeEnding(value: unknown): ActiveRunSaveV3['ending'] | null {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  const cause = normalizeEndCause(value.cause)
  const role = value.role === undefined ? undefined : normalizeActorRole(value.role)
  if (!cause || role === null) return null
  return { cause, ...(role === undefined ? {} : { role }) }
}

function normalizeLocation(value: unknown): RunLocationState | null {
  if (!isRecord(value)) return null
  const regionId = normalizeId(value.regionId)
  const localPosition = normalizePosition(value.localPosition)
  const worldPosition = normalizePosition(value.worldPosition)
  const heading =
    value.heading === undefined ? undefined : normalizeSigned(value.heading, MAX_SCALAR)
  if (!regionId || !localPosition || !worldPosition || heading === null) return null
  return {
    regionId,
    localPosition,
    worldPosition,
    ...(heading === undefined ? {} : { heading }),
  }
}

function normalizeStoredRegionDelta(
  value: unknown,
  expectedRegionId: string,
): RegionDelta | null {
  if (!isRecord(value)) return null
  const regionId = normalizeId(value.regionId)
  const revision = normalizeNonNegative(value.revision, MAX_COUNTER, true)
  const clearedEncounterIds = normalizeStringArray(value.clearedEncounterIds)
  const defeatedActorIds = normalizeStringArray(value.defeatedActorIds)
  const removedPropIds = normalizeStringArray(value.removedPropIds)
  const collectedLootIds = normalizeStringArray(value.collectedLootIds)
  const completedInteractionIds = normalizeStringArray(value.completedInteractionIds)
  const completedEventIds = normalizeStringArray(value.completedEventIds)
  const chronicle = normalizeRegionChronicleState(value.chronicle)
  const state = normalizeSerializableState(value.state)
  return value.version !== REGION_DELTA_VERSION ||
    !regionId ||
    regionId !== expectedRegionId ||
    revision === null ||
    !clearedEncounterIds ||
    !defeatedActorIds ||
    !removedPropIds ||
    !collectedLootIds ||
    !completedInteractionIds ||
    !completedEventIds ||
    !chronicle ||
    !state
    ? null
    : {
        version: REGION_DELTA_VERSION,
        regionId,
        revision,
        clearedEncounterIds,
        defeatedActorIds,
        removedPropIds,
        collectedLootIds,
        completedInteractionIds,
        completedEventIds,
        chronicle,
        state,
      }
}

function normalizeRegionDeltas(
  value: unknown,
): ActiveRunSaveV3['regionDeltas'] | null {
  if (!isRecord(value)) return null
  const entries: [string, RegionDelta][] = []
  for (const [regionKey, deltaValue] of Object.entries(value)) {
    const regionId = normalizeId(regionKey)
    const delta = regionId
      ? normalizeStoredRegionDelta(deltaValue, regionId)
      : null
    if (!regionId || !delta) return null
    if (entries.length < MAX_REGION_DELTAS) entries.push([regionId, delta])
  }
  return Object.fromEntries(entries)
}

function normalizeRngStates(value: unknown): ActiveRunSaveV3['rngStates'] | null {
  if (!isRecord(value)) return null
  const entries: [string, number][] = []
  for (const [streamKey, stateValue] of Object.entries(value)) {
    const streamId = normalizeId(streamKey)
    const state = normalizeUint32(stateValue)
    if (!streamId || state === null) return null
    if (entries.length < 512) entries.push([streamId, state])
  }
  return Object.fromEntries(entries)
}

export function normalizeActiveRunSaveV3(value: unknown): ActiveRunSaveV3 | null {
  if (!isRecord(value) || value.version !== ACTIVE_RUN_SAVE_VERSION) return null
  const runId = normalizeId(value.runId)
  const config = normalizeConfig(value.config)
  const status = normalizeRunStatus(value.status)
  const startedAt = normalizeTimestamp(value.startedAt)
  const updatedAt = normalizeTimestamp(value.updatedAt)
  const blueprintFingerprint = normalizeId(value.blueprintFingerprint)
  // Roadmap 1.6 — absent on every run written before the ruleset fingerprint existed.
  // Read exactly like `ending`: missing is fine, malformed still fails the whole save.
  const rulesetFingerprint =
    value.rulesetFingerprint === undefined
      ? undefined
      : normalizeId(value.rulesetFingerprint)
  const currentLocation = normalizeLocation(value.currentLocation)
  const player = normalizePlayer(value.player)
  const companions = normalizeCompanions(value.companions)
  const discoveredRegionIds = normalizeStringArray(value.discoveredRegionIds)
  const regionDeltas = normalizeRegionDeltas(value.regionDeltas)
  const directorState = normalizeSerializableState(value.directorState)
  const eventState = normalizeSerializableState(value.eventState)
  const chronicleState = normalizeChronicleState(value.chronicleState)
  const rngStates = normalizeRngStates(value.rngStates)
  const achievementRunState = normalizeAchievementRunState(value.achievementRunState)
  const ending = normalizeEnding(value.ending)
  if (
    !runId ||
    !config ||
    !status ||
    !startedAt ||
    !updatedAt ||
    Date.parse(updatedAt) < Date.parse(startedAt) ||
    !blueprintFingerprint ||
    (value.rulesetFingerprint !== undefined && !rulesetFingerprint) ||
    !currentLocation ||
    !player ||
    companions === null ||
    !discoveredRegionIds ||
    !regionDeltas ||
    !directorState ||
    !eventState ||
    !chronicleState ||
    !rngStates ||
    !achievementRunState ||
    ending === null ||
    achievementRunState.runId !== runId ||
    achievementRunState.faction !== config.faction ||
    (status === 'active' && achievementRunState.result !== null) ||
    (status === 'victory' && achievementRunState.result !== 'victory') ||
    (status === 'defeat' && achievementRunState.result !== 'defeat') ||
    (status === 'abandoned' && achievementRunState.result !== null)
  ) {
    return null
  }

  return {
    version: ACTIVE_RUN_SAVE_VERSION,
    runId,
    config,
    status,
    startedAt,
    updatedAt,
    blueprintFingerprint,
    ...(rulesetFingerprint ? { rulesetFingerprint } : {}),
    currentLocation,
    player,
    ...(companions === undefined ? {} : { companions }),
    discoveredRegionIds,
    regionDeltas,
    directorState,
    eventState,
    chronicleState,
    rngStates,
    achievementRunState,
    ...(ending === undefined ? {} : { ending }),
  }
}

const CHRONICLE_EVENT_KINDS = [
  'regionCaptured',
  'raidRepelled',
  'beastRaid',
  'beastsRepelled',
  'settlementBurned',
  'caravanLost',
  'caravanArrived',
] as const

const BODY_PART_NAMES = [
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
  'leftEye',
  'rightEye',
] as const

const WOUND_STATUSES = ['wounded', 'missing', 'prosthetic'] as const

const TERRITORIES = ['neutral', 'elf', 'guard', 'villain'] as const

/** Map-square labels are `C3`-shaped, or the engine's own `??` for a square it cannot place. */
const MAX_REGION_LABEL_LENGTH = 8

function normalizeRegionLabel(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REGION_LABEL_LENGTH
    ? value
    : null
}

function normalizeEpilogueBeats(value: unknown): RunEpilogueBeat[] | null {
  if (!Array.isArray(value) || value.length > MAX_EPILOGUE_BEATS) return null
  const beats: RunEpilogueBeat[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const region = normalizeRegionLabel(entry.region)
    const tick = normalizeNonNegative(entry.tick, MAX_COUNTER, true)
    const faction = entry.faction === null ? null : normalizeFaction(entry.faction)
    if (
      !CHRONICLE_EVENT_KINDS.includes(entry.kind as (typeof CHRONICLE_EVENT_KINDS)[number]) ||
      !region ||
      tick === null ||
      (entry.faction !== null && !faction)
    ) {
      return null
    }
    beats.push({
      kind: entry.kind as (typeof CHRONICLE_EVENT_KINDS)[number],
      region,
      faction,
      tick,
    })
  }
  return beats
}

function normalizeEpilogueWounds(value: unknown): RunEpilogueWound[] | null {
  if (!Array.isArray(value) || value.length > MAX_EPILOGUE_WOUNDS) return null
  const wounds: RunEpilogueWound[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry)) return null
    if (
      !BODY_PART_NAMES.includes(entry.part as (typeof BODY_PART_NAMES)[number]) ||
      !WOUND_STATUSES.includes(entry.status as (typeof WOUND_STATUSES)[number])
    ) {
      return null
    }
    const part = entry.part as (typeof BODY_PART_NAMES)[number]
    if (seen.has(part)) continue
    seen.add(part)
    wounds.push({ part, status: entry.status as (typeof WOUND_STATUSES)[number] })
  }
  return wounds
}

function normalizeEpilogueCompanions(value: unknown): RunEpilogueCompanion[] | null {
  if (!Array.isArray(value) || value.length > MAX_EPILOGUE_COMPANIONS) return null
  const companions: RunEpilogueCompanion[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry)) return null
    // The squad's narrower vocabulary, deliberately: a сводка that could name a wolf as a
    // surviving companion is the same smuggling route the companion list already closes.
    const role = normalizeCompanionRole(entry.role)
    const count = normalizeNonNegative(entry.count, MAX_COUNTER, true)
    if (!role || count === null || count <= 0) return null
    if (seen.has(role)) continue
    seen.add(role)
    companions.push({ role, count })
  }
  return companions
}

function normalizeEpilogueControl(value: unknown): RunEpilogueControl | null {
  if (!isRecord(value)) return null
  const control = { neutral: 0, elf: 0, guard: 0, villain: 0 } as RunEpilogueControl
  for (const territory of TERRITORIES) {
    const count = normalizeNonNegative(value[territory], MAX_COUNTER, true)
    if (count === null) return null
    control[territory] = count
  }
  return control
}

/**
 * A сводка is optional and bounded.
 *
 * Absent means the entry has decayed to a thin summary, or was written before this existed —
 * exactly the `seenHints` case, and not a save that cannot be *read*. Malformed still fails
 * the whole profile, because a сводка that half-parses is a story that quietly lies.
 */
function normalizeEpilogue(value: unknown): RunEpilogue | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  if (!Array.isArray(value.route) || value.route.length > MAX_EPILOGUE_ROUTE) return null
  const route: string[] = []
  for (const entry of value.route) {
    const label = normalizeRegionLabel(entry)
    if (!label) return null
    route.push(label)
  }
  const routeTotal = normalizeNonNegative(value.routeTotal, MAX_COUNTER, true)
  const regionsTotal = normalizeNonNegative(value.regionsTotal, MAX_COUNTER, true)
  const finalRegion = normalizeRegionLabel(value.finalRegion)
  const control = normalizeEpilogueControl(value.control)
  const beats = normalizeEpilogueBeats(value.beats)
  const wounds = normalizeEpilogueWounds(value.wounds)
  const companions = normalizeEpilogueCompanions(value.companions)
  const doctrines = normalizeStringArray(value.doctrines, MAX_EPILOGUE_DOCTRINES)
  const cause = normalizeEndCause(value.cause)
  const causeRole = value.causeRole === null ? null : normalizeActorRole(value.causeRole)
  const limbsLost = normalizeNonNegative(value.limbsLost, MAX_COUNTER, true)
  const injuries = normalizeNonNegative(value.injuries, MAX_COUNTER, true)
  const elapsed = normalizeNonNegative(value.elapsed, MAX_COUNTER, true)
  const caravansRobbed = normalizeNonNegative(value.caravansRobbed, MAX_COUNTER, true)
  const eventsCompleted = normalizeNonNegative(value.eventsCompleted, MAX_COUNTER, true)
  const bestKillStreak = normalizeNonNegative(value.bestKillStreak, MAX_COUNTER, true)
  if (
    routeTotal === null ||
    regionsTotal === null ||
    !finalRegion ||
    !control ||
    !beats ||
    !wounds ||
    !companions ||
    !doctrines ||
    !cause ||
    (value.causeRole !== null && !causeRole) ||
    typeof value.bleeding !== 'boolean' ||
    limbsLost === null ||
    injuries === null ||
    elapsed === null ||
    caravansRobbed === null ||
    eventsCompleted === null ||
    bestKillStreak === null
  ) {
    return null
  }
  return {
    route,
    routeTotal,
    regionsTotal,
    finalRegion,
    control,
    beats,
    wounds,
    bleeding: value.bleeding,
    limbsLost,
    injuries,
    companions,
    doctrines,
    cause,
    causeRole,
    elapsed,
    caravansRobbed,
    eventsCompleted,
    bestKillStreak,
  }
}

function normalizeHistorySummary(value: unknown): RunHistorySummary | null {
  if (!isRecord(value)) return null
  const runId = normalizeId(value.runId)
  const status = normalizeRunStatus(value.status)
  const seed = normalizeUint32(value.seed)
  const generatorVersion = normalizeNonNegative(value.generatorVersion, 1_000_000, true)
  const faction = normalizeFaction(value.faction)
  const selectedBoonId = normalizeId(value.selectedBoonId)
  const startedAt = normalizeTimestamp(value.startedAt)
  const endedAt = normalizeTimestamp(value.endedAt)
  const kills = normalizeNonNegative(value.kills, MAX_COUNTER, true)
  const objectivesCompleted = normalizeNonNegative(
    value.objectivesCompleted,
    MAX_COUNTER,
    true,
  )
  const endingGold = normalizeNonNegative(value.endingGold, MAX_COUNTER, true)
  const profileCurrencyEarned = normalizeNonNegative(
    value.profileCurrencyEarned,
    MAX_COUNTER,
    true,
  )
  const blueprintFingerprint = normalizeId(value.blueprintFingerprint)
  const epilogue = normalizeEpilogue(value.epilogue)
  if (
    !runId ||
    !status ||
    status === 'active' ||
    seed === null ||
    generatorVersion === null ||
    !faction ||
    !selectedBoonId ||
    !startedAt ||
    !endedAt ||
    Date.parse(endedAt) < Date.parse(startedAt) ||
    kills === null ||
    objectivesCompleted === null ||
    endingGold === null ||
    profileCurrencyEarned === null ||
    !blueprintFingerprint ||
    epilogue === null
  ) {
    return null
  }
  return {
    runId,
    status,
    seed,
    generatorVersion,
    faction,
    selectedBoonId,
    startedAt,
    endedAt,
    kills,
    objectivesCompleted,
    endingGold,
    profileCurrencyEarned,
    blueprintFingerprint,
    ...(epilogue === undefined ? {} : { epilogue }),
  }
}

/**
 * Runs whose сводка survives. Older entries decay to the thin summary.
 *
 * The number is not a taste call. `MAX_PROFILE_RUN_HISTORY` is fifty and the profile is a
 * single localStorage blob rewritten on every save, so fifty rich epilogues would be
 * serialized on every write for the sake of forty-five nobody is reading.
 */
export const MAX_RICH_RUN_EPILOGUES = 5

function normalizeRunHistory(value: unknown): RunHistorySummary[] | null {
  if (!Array.isArray(value)) return null
  const history: RunHistorySummary[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const summary = normalizeHistorySummary(entry)
    if (!summary) return null
    if (!seen.has(summary.runId)) {
      seen.add(summary.runId)
      if (history.length < MAX_PROFILE_RUN_HISTORY) {
        // The decay, at the one choke point every read and every write already passes
        // through — `parseProfileSaveV1` on the way in, `saveProfile` and
        // `finalizeRunSnapshot` on the way out. History is newest-first, so an entry that
        // has been pushed past the fifth position by newer runs loses its сводка here and
        // is written back thin.
        if (history.length >= MAX_RICH_RUN_EPILOGUES && summary.epilogue !== undefined) {
          const { epilogue: _decayed, ...thin } = summary
          history.push(thin)
        } else {
          history.push(summary)
        }
      }
    }
  }
  return history
}

export function normalizeProfileSaveV1(value: unknown): ProfileSaveV1 | null {
  if (!isRecord(value) || value.version !== PROFILE_SAVE_VERSION) return null
  const profileCurrency = normalizeNonNegative(value.profileCurrency, MAX_COUNTER, true)
  const unlockedBoonIds = normalizeStringArray(value.unlockedBoonIds, 512)
  const unlockedContentIds = normalizeStringArray(value.unlockedContentIds, 2_048)
  const unlockedCosmeticIds = normalizeStringArray(value.unlockedCosmeticIds, 2_048)
  const selectedBoonId =
    value.selectedBoonId === null ? null : normalizeId(value.selectedBoonId)
  const selectedFaction =
    value.selectedFaction === null ? null : normalizeFaction(value.selectedFaction)
  const runHistory = normalizeRunHistory(value.runHistory)
  const providedFinalizedRunIds =
    value.finalizedRunIds === undefined
      ? []
      : normalizeStringArray(value.finalizedRunIds, MAX_FINALIZED_RUN_IDS)
  // Absent on every profile written before the hint ledger existed. Treated exactly like
  // `finalizedRunIds`: missing means empty, malformed still fails the whole profile.
  const seenHints =
    value.seenHints === undefined
      ? []
      : normalizeStringArray(value.seenHints, MAX_SEEN_HINTS)
  if (
    profileCurrency === null ||
    !unlockedBoonIds ||
    !unlockedContentIds ||
    !unlockedCosmeticIds ||
    (value.selectedBoonId !== null && !selectedBoonId) ||
    (value.selectedFaction !== null && !selectedFaction) ||
    !runHistory ||
    !providedFinalizedRunIds ||
    !seenHints
  ) {
    return null
  }

  const allBoonIds = [
    ...new Set<string>([...DEFAULT_STARTING_BOON_IDS, ...unlockedBoonIds]),
  ].slice(0, 512)
  const validSelectedBoonId =
    selectedBoonId && isBoonId(selectedBoonId) && allBoonIds.includes(selectedBoonId)
      ? selectedBoonId
      : null
  const finalizedRunIds = [
    ...new Set([...runHistory.map((summary) => summary.runId), ...providedFinalizedRunIds]),
  ].slice(0, MAX_FINALIZED_RUN_IDS)

  return {
    version: PROFILE_SAVE_VERSION,
    profileCurrency,
    unlockedBoonIds: allBoonIds,
    unlockedContentIds,
    unlockedCosmeticIds,
    selectedBoonId: validSelectedBoonId,
    selectedFaction,
    runHistory,
    finalizedRunIds,
    seenHints,
  }
}

export function createDefaultProfile(): ProfileSaveV1 {
  return {
    version: PROFILE_SAVE_VERSION,
    profileCurrency: 0,
    unlockedBoonIds: [...DEFAULT_STARTING_BOON_IDS],
    unlockedContentIds: [],
    unlockedCosmeticIds: [],
    selectedBoonId: DEFAULT_STARTING_BOON_IDS[0],
    selectedFaction: null,
    runHistory: [],
    finalizedRunIds: [],
    seenHints: [],
  }
}

export const createDefaultProfileSave = createDefaultProfile

export function parseActiveRunSaveV3(
  raw: string,
  onWarning?: StorageWarning,
): ActiveRunSaveV3 | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    warn(onWarning, 'Korovany: generated run data could not be parsed.', error)
    return null
  }
  const normalized = normalizeActiveRunSaveV3(value)
  if (!normalized) warn(onWarning, 'Korovany: generated run data is incompatible or malformed.')
  return normalized
}

export function parseProfileSaveV1(
  raw: string,
  onWarning?: StorageWarning,
): ProfileSaveV1 | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    warn(onWarning, 'Korovany: profile data could not be parsed.', error)
    return null
  }
  const normalized = normalizeProfileSaveV1(value)
  if (!normalized) warn(onWarning, 'Korovany: profile data is incompatible or malformed.')
  return normalized
}

export const normalizeActiveRunSave = normalizeActiveRunSaveV3
export const normalizeProfileSave = normalizeProfileSaveV1
export const parseActiveRunSave = parseActiveRunSaveV3
export const parseProfileSave = parseProfileSaveV1

function readProfileFromStorage(
  storage: StorageLike,
  onWarning?: StorageWarning,
): ProfileSaveV1 | null {
  let raw: string | null
  try {
    raw = storage.getItem(PROFILE_SAVE_KEY)
  } catch (error) {
    warn(onWarning, 'Korovany: profile data could not be read.', error)
    return null
  }
  return raw === null ? createDefaultProfile() : parseProfileSaveV1(raw, onWarning)
}

function readActiveRunFromStorage(
  storage: StorageLike,
  onWarning?: StorageWarning,
): ActiveRunSaveV3 | null {
  let raw: string | null
  try {
    raw = storage.getItem(ACTIVE_RUN_SAVE_KEY)
  } catch (error) {
    warn(onWarning, 'Korovany: generated run data could not be read.', error)
    return null
  }
  return raw === null ? null : parseActiveRunSaveV3(raw, onWarning)
}

function profileHasFinalizedRun(profile: ProfileSaveV1, runId: string): boolean {
  return (
    profile.finalizedRunIds.includes(runId) ||
    profile.runHistory.some((summary) => summary.runId === runId)
  )
}

function removeStoredRunIfMatching(
  storage: StorageLike,
  runId: string,
  onWarning?: StorageWarning,
): void {
  const storedRun = readActiveRunFromStorage(storage, onWarning)
  if (storedRun?.runId === runId) removeActiveRun(storage, onWarning)
}

export function loadActiveRun(
  storage: StorageLike,
  onWarning?: StorageWarning,
): ActiveRunSaveV3 | null {
  const activeRun = readActiveRunFromStorage(storage, onWarning)
  if (!activeRun) return null
  if (activeRun.status !== 'active') {
    removeActiveRun(storage, onWarning)
    return null
  }
  const profile = readProfileFromStorage(storage, onWarning)
  if (profile && profileHasFinalizedRun(profile, activeRun.runId)) {
    removeActiveRun(storage, onWarning)
    return null
  }
  return activeRun
}

export function saveActiveRun(
  storage: StorageLike,
  value: ActiveRunSaveV3,
  onWarning?: StorageWarning,
): boolean {
  const normalized = normalizeActiveRunSaveV3(value)
  if (!normalized || normalized.status !== 'active') {
    warn(onWarning, 'Korovany: refused to save malformed or closed generated run data.')
    return false
  }
  const profile = readProfileFromStorage(storage, onWarning)
  if (!profile) return false
  if (profileHasFinalizedRun(profile, normalized.runId)) {
    removeStoredRunIfMatching(storage, normalized.runId, onWarning)
    warn(onWarning, 'Korovany: refused to revive a finalized generated run.')
    return false
  }
  try {
    storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(normalized))
    return true
  } catch (error) {
    warn(onWarning, 'Korovany: generated run data could not be saved.', error)
    return false
  }
}

export function removeActiveRun(
  storage: StorageLike,
  onWarning?: StorageWarning,
): boolean {
  try {
    storage.removeItem(ACTIVE_RUN_SAVE_KEY)
    return true
  } catch (error) {
    warn(onWarning, 'Korovany: generated run data could not be removed.', error)
    return false
  }
}

export function loadProfile(
  storage: StorageLike,
  onWarning?: StorageWarning,
): ProfileSaveV1 {
  return readProfileFromStorage(storage, onWarning) ?? createDefaultProfile()
}

export function saveProfile(
  storage: StorageLike,
  value: ProfileSaveV1,
  onWarning?: StorageWarning,
): boolean {
  const normalized = normalizeProfileSaveV1(value)
  if (!normalized) {
    warn(onWarning, 'Korovany: refused to save malformed profile data.')
    return false
  }
  try {
    storage.setItem(PROFILE_SAVE_KEY, JSON.stringify(normalized))
    return true
  } catch (error) {
    warn(onWarning, 'Korovany: profile data could not be saved.', error)
    return false
  }
}

export function removeProfile(
  storage: StorageLike,
  onWarning?: StorageWarning,
): boolean {
  try {
    storage.removeItem(PROFILE_SAVE_KEY)
    return true
  } catch (error) {
    warn(onWarning, 'Korovany: profile data could not be removed.', error)
    return false
  }
}

export const loadActiveRunSave = loadActiveRun
export const saveActiveRunSave = saveActiveRun
export const removeActiveRunSave = removeActiveRun
export const loadActiveRunSaveV3 = loadActiveRun
export const saveActiveRunSaveV3 = saveActiveRun
export const removeActiveRunSaveV3 = removeActiveRun
export const loadProfileSave = loadProfile
export const saveProfileSave = saveProfile
export const removeProfileSave = removeProfile
export const loadProfileSaveV1 = loadProfile
export const saveProfileSaveV1 = saveProfile
export const removeProfileSaveV1 = removeProfile

export interface FinalizeActiveRunOptions {
  now?: () => Date
  onWarning?: StorageWarning
}

export type FinalizeRunSnapshotOptions = FinalizeActiveRunOptions

export type FinalizeActiveRunOutcome =
  | 'finalized'
  | 'already-finalized'
  | 'not-found'
  | 'run-id-mismatch'
  | 'not-active'
  | 'invalid-input'
  | 'storage-error'

export interface FinalizeActiveRunResult {
  outcome: FinalizeActiveRunOutcome
  finalized: boolean
  rewardGranted: number
  summary: RunHistorySummary | null
  profile: ProfileSaveV1
}

export type FinalizeRunSnapshotOutcome = FinalizeActiveRunOutcome
export type FinalizeRunSnapshotResult = FinalizeActiveRunResult

function finalizationResult(
  outcome: FinalizeActiveRunOutcome,
  profile: ProfileSaveV1,
  summary: RunHistorySummary | null = null,
  rewardGranted = 0,
): FinalizeActiveRunResult {
  return {
    outcome,
    finalized: outcome === 'finalized',
    rewardGranted,
    summary,
    profile,
  }
}

function buildRunHistorySummary(
  terminalSnapshot: ActiveRunSaveV3,
  options: FinalizeRunSnapshotOptions,
): { summary: RunHistorySummary; reward: number } {
  const endedDate = options.now?.()
  const requestedEndedAt =
    endedDate && Number.isFinite(endedDate.getTime())
      ? endedDate.toISOString()
      : terminalSnapshot.updatedAt
  const endedAt =
    Date.parse(requestedEndedAt) < Date.parse(terminalSnapshot.startedAt)
      ? terminalSnapshot.updatedAt
      : requestedEndedAt
  const baseSummary: RunHistorySummary = {
    runId: terminalSnapshot.runId,
    status: terminalSnapshot.status as RunHistorySummary['status'],
    seed: terminalSnapshot.config.seed,
    generatorVersion: terminalSnapshot.config.generatorVersion,
    faction: terminalSnapshot.config.faction,
    selectedBoonId: terminalSnapshot.config.selectedBoonId,
    startedAt: terminalSnapshot.startedAt,
    endedAt,
    kills: terminalSnapshot.player.kills,
    // **Roadmap 2.1 — re-decided, and not a count of ticked boxes.** `countRewardedObjectives`
    // reports how much of *its own* campaign the run closed, so a route with more nodes in it
    // cannot pay more than a route with fewer. See its own comment for why the raw count
    // stopped being honest the moment a node could be skipped.
    objectivesCompleted: countRewardedObjectives(terminalSnapshot.player.objectives),
    endingGold: terminalSnapshot.player.gold,
    profileCurrencyEarned: 0,
    blueprintFingerprint: terminalSnapshot.blueprintFingerprint,
    epilogue: buildRunEpilogue(terminalSnapshot),
  }
  const reward = computeRunCompletionReward(baseSummary)
  return {
    summary: {
      ...baseSummary,
      profileCurrencyEarned: reward,
    },
    reward,
  }
}

export function finalizeRunSnapshot(
  storage: StorageLike,
  terminalSnapshot: ActiveRunSaveV3,
  options: FinalizeRunSnapshotOptions = {},
): FinalizeRunSnapshotResult {
  const profile = readProfileFromStorage(storage, options.onWarning)
  if (!profile) {
    return finalizationResult('storage-error', createDefaultProfile())
  }

  const normalized = normalizeActiveRunSaveV3(terminalSnapshot)
  if (!normalized) {
    warn(options.onWarning, 'Korovany: refused malformed generated run finalization data.')
    return finalizationResult('invalid-input', profile)
  }
  if (
    normalized.status !== 'victory' &&
    normalized.status !== 'defeat' &&
    normalized.status !== 'abandoned'
  ) {
    warn(options.onWarning, 'Korovany: generated run finalization requires a terminal snapshot.')
    return finalizationResult('not-active', profile)
  }
  const achievementResult = normalized.achievementRunState.result
  if (
    (normalized.status === 'abandoned' && achievementResult !== null) ||
    (normalized.status !== 'abandoned' && achievementResult !== normalized.status)
  ) {
    warn(
      options.onWarning,
      'Korovany: generated run and achievement results do not match.',
    )
    return finalizationResult('invalid-input', profile)
  }

  const existingSummary =
    profile.runHistory.find((summary) => summary.runId === normalized.runId) ?? null
  if (profileHasFinalizedRun(profile, normalized.runId)) {
    removeStoredRunIfMatching(storage, normalized.runId, options.onWarning)
    return finalizationResult('already-finalized', profile, existingSummary)
  }

  const storedRun = readActiveRunFromStorage(storage, options.onWarning)
  if (storedRun && storedRun.runId !== normalized.runId) {
    return finalizationResult('run-id-mismatch', profile)
  }

  const { summary, reward } = buildRunHistorySummary(normalized, options)
  const updatedProfile = normalizeProfileSaveV1({
    ...profile,
    profileCurrency: profile.profileCurrency + reward,
    runHistory: [summary, ...profile.runHistory],
    finalizedRunIds: [normalized.runId, ...profile.finalizedRunIds],
  })
  if (
    !updatedProfile ||
    !saveProfile(storage, updatedProfile, options.onWarning)
  ) {
    return finalizationResult('storage-error', profile)
  }

  removeStoredRunIfMatching(storage, normalized.runId, options.onWarning)
  return finalizationResult('finalized', updatedProfile, summary, reward)
}

export function finalizeActiveRun(
  storage: StorageLike,
  runId: string,
  status: 'victory' | 'defeat',
  options: FinalizeActiveRunOptions = {},
): FinalizeActiveRunResult {
  const profile = readProfileFromStorage(storage, options.onWarning)
  if (!profile) {
    return finalizationResult('storage-error', createDefaultProfile())
  }
  if (!normalizeId(runId) || (status !== 'victory' && status !== 'defeat')) {
    warn(options.onWarning, 'Korovany: refused invalid generated run finalization input.')
    return finalizationResult('invalid-input', profile)
  }
  const existingSummary =
    profile.runHistory.find((summary) => summary.runId === runId) ?? null
  if (profileHasFinalizedRun(profile, runId)) {
    removeStoredRunIfMatching(storage, runId, options.onWarning)
    return finalizationResult('already-finalized', profile, existingSummary)
  }

  const activeRun = readActiveRunFromStorage(storage, options.onWarning)
  if (!activeRun) return finalizationResult('not-found', profile)
  if (activeRun.runId !== runId) {
    return finalizationResult('run-id-mismatch', profile)
  }
  if (activeRun.status !== 'active') {
    removeStoredRunIfMatching(storage, runId, options.onWarning)
    return finalizationResult('not-active', profile)
  }

  const finalizationOptions =
    options.now === undefined
      ? {
          ...options,
          now: () => new Date(),
        }
      : options
  return finalizeRunSnapshot(
    storage,
    {
      ...activeRun,
      status,
      achievementRunState: {
        ...activeRun.achievementRunState,
        result: status,
      },
    },
    finalizationOptions,
  )
}

export const finalizeRun = finalizeActiveRun
