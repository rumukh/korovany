import type { AchievementRunState } from '../achievements'
import type {
  ActorRole,
  BodyState,
  Faction,
  Objective,
  UpgradeLevels,
} from '../types'
import type { RegionDelta } from '../world/RegionRuntime.ts'

export type { RegionDelta }

export const ACTIVE_RUN_SAVE_VERSION = 2 as const
export const ACTIVE_RUN_SAVE_KEY = 'korovany-generated-run-v2'
export const ACTIVE_RUN_STORAGE_KEY = ACTIVE_RUN_SAVE_KEY
export const ACTIVE_GENERATED_RUN_SAVE_KEY = ACTIVE_RUN_SAVE_KEY
export const ACTIVE_RUN_VERSION = ACTIVE_RUN_SAVE_VERSION

export const PROFILE_SAVE_VERSION = 1 as const
export const PROFILE_SAVE_KEY = 'korovany-profile-v1'
export const PROFILE_STORAGE_KEY = PROFILE_SAVE_KEY
export const PROFILE_VERSION = PROFILE_SAVE_VERSION

export type RunStatus = 'active' | 'victory' | 'defeat' | 'abandoned'
export type ArchivedRunStatus = Exclude<RunStatus, 'active'>

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type SerializableState = Record<string, JsonValue>

export interface RunConfig {
  seed: number
  generatorVersion: number
  faction: Faction
  selectedBoonId: string
  modifiers?: string[]
}

export type SerializablePosition = [number, number, number]

export interface RunLocationState {
  regionId: string
  localPosition: SerializablePosition
  worldPosition: SerializablePosition
  heading?: number
}

export interface RunPlayerState {
  health: number
  maxHealth?: number
  stamina: number
  maxStamina?: number
  gold: number
  kills: number
  damage: number
  body: BodyState
  objectives: Objective[]
  upgrades: UpgradeLevels
}

export type SerializablePlayerState = RunPlayerState

export interface RunCompanionState {
  id: string
  role: ActorRole
  health: number
  maxHealth: number
  worldPosition: SerializablePosition
}

export type RegionDeltaMap = Record<string, RegionDelta>
export type RuntimeRngStateMap = Record<string, number>

export interface ActiveRunSaveV2 {
  version: 2
  runId: string
  config: RunConfig
  status: RunStatus
  startedAt: string
  updatedAt: string
  blueprintFingerprint: string
  currentLocation: RunLocationState
  player: RunPlayerState
  companions?: RunCompanionState[]
  discoveredRegionIds: string[]
  regionDeltas: RegionDeltaMap
  directorState: SerializableState
  eventState: SerializableState
  rngStates: RuntimeRngStateMap
  achievementRunState: AchievementRunState
}

export interface RunHistorySummary {
  runId: string
  status: ArchivedRunStatus
  seed: number
  generatorVersion: number
  faction: Faction
  selectedBoonId: string
  startedAt: string
  endedAt: string
  kills: number
  objectivesCompleted: number
  endingGold: number
  profileCurrencyEarned: number
  blueprintFingerprint: string
}

export interface ProfileSaveV1 {
  version: 1
  profileCurrency: number
  unlockedBoonIds: string[]
  unlockedContentIds: string[]
  unlockedCosmeticIds: string[]
  selectedBoonId: string | null
  selectedFaction: Faction | null
  runHistory: RunHistorySummary[]
  finalizedRunIds: string[]
}
