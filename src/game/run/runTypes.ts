import type { AchievementRunState } from '../achievements'
import type {
  ActorRole,
  BodyPart,
  BodyState,
  Faction,
  Objective,
  UpgradeLevels,
} from '../types'
import type { ChronicleEventKind, ChronicleState } from '../world/Chronicle.ts'
import type { RegionDelta } from '../world/RegionRuntime.ts'
import type { Territory } from '../world/worldTypes.ts'

export type { ChronicleState, RegionDelta }

export const ACTIVE_RUN_SAVE_VERSION = 3 as const
// The key deliberately does not track the format version: keeping one slot means a
// stale save is read, rejected by normalization, and reported — not silently orphaned.
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

/**
 * What ended the run, in the vocabulary `tests/runHarness.ts` already counts deaths with
 * (`DeathCause`), plus the two terminal states a harness run has no word for.
 *
 * `unknown` is a real answer rather than a bug: a save written before the engine started
 * recording this, or a defeat with no attributable last blow, must say so instead of
 * inventing a killer.
 */
export type RunEndCause =
  | 'objectives'
  | 'faction'
  | 'beast'
  | 'bleeding'
  | 'abandoned'
  | 'unknown'

export interface RunEndingState {
  cause: RunEndCause
  /** The role that landed the last blow, when a blow ended it. */
  role?: ActorRole
}

export interface RunEpilogueBeat {
  kind: ChronicleEventKind
  /** Map square label, e.g. `C3`. */
  region: string
  faction: Faction | null
  tick: number
}

export type RunEpilogueWoundStatus = Exclude<
  BodyState[BodyPart],
  'healthy'
>

export interface RunEpilogueWound {
  part: BodyPart
  status: RunEpilogueWoundStatus
}

export interface RunEpilogueCompanion {
  role: ActorRole
  count: number
}

/** Regions held at the end, counted by holder. */
export type RunEpilogueControl = Record<Territory, number>

/**
 * The «походная сводка»: a terminal snapshot of a run, small enough to keep several of.
 *
 * Every collection here is bounded by a constant in `run/epilogue.ts` and every entry is an
 * id or a highlight — a kind, a role, a map square — never a whole object. That is the whole
 * mitigation for the named risk: the profile is a single localStorage blob rewritten on every
 * save, so an epilogue that could grow with the run would be paid for on every write.
 */
export interface RunEpilogue {
  /** Map squares in discovery order, oldest first; truncated, hence `routeTotal`. */
  route: string[]
  /** Squares discovered over the whole run, whether or not they fit in `route`. */
  routeTotal: number
  /** Squares the world had. */
  regionsTotal: number
  /** Where it ended. */
  finalRegion: string
  control: RunEpilogueControl
  beats: RunEpilogueBeat[]
  wounds: RunEpilogueWound[]
  bleeding: boolean
  limbsLost: number
  injuries: number
  companions: RunEpilogueCompanion[]
  /**
   * Equipped doctrine ids. Roadmap 1.6 builds doctrines; this field exists so that when it
   * does, the сводка already has somewhere to put them. Until then it is always empty and
   * every reader must render nothing rather than a heading with no rows under it.
   */
  doctrines: string[]
  cause: RunEndCause
  causeRole: ActorRole | null
  /** Seconds of run time at the end. */
  elapsed: number
  caravansRobbed: number
  eventsCompleted: number
  bestKillStreak: number
}

export interface ActiveRunSaveV3 {
  version: 3
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
  chronicleState: ChronicleState
  rngStates: RuntimeRngStateMap
  achievementRunState: AchievementRunState
  /**
   * How the run ended. Absent while it is still running, and absent on every save written
   * before the engine recorded a cause — read as an optional for the same reason
   * `seenHints` is, because a returning player predating a field is not a save that cannot
   * be read.
   */
  ending?: RunEndingState
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
  /**
   * The rich сводка, kept for the newest few runs only. Older entries decay back to the
   * thirteen thin fields above — see `MAX_RICH_RUN_EPILOGUES` in `run/storage.ts` — so the
   * profile blob does not carry fifty of these through every write.
   */
  epilogue?: RunEpilogue
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
  /**
   * Diegetic first-time lines the player has already been shown, so a hint fires once per
   * player and never again. Ids are stored raw rather than validated against the current
   * `HintId` union: a build that no longer knows an id must forget the hint, not re-teach
   * it, and normalization already bounds the list. Absent on every profile written before
   * this field existed, which is why it is read as an optional and defaulted to empty —
   * the discard-and-report policy is for saves that cannot be *read*, not for a field a
   * returning player simply predates.
   */
  seenHints: string[]
}
