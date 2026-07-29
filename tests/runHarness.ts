/**
 * Headless full-run harness.
 *
 * `tests/aiHarness.ts` measures decisions in an empty room: straight-line movement, no
 * navmesh, no collision, no terrain, no world. It says so itself, and every number it
 * produces is about target selection and morale rather than about a run. This file is the
 * other half — a driver that walks a whole campaign in a real generated world so run-level
 * questions can be *counted* rather than argued about: how long an objective takes, what
 * actually kills a player, and how much of the chronicle a player is ever in a position to
 * witness.
 *
 * ---
 *
 * **WHAT IT IS.** Real shipped code wherever the code is headless-capable:
 *
 * - `generateWorld` — the same world the browser gets, including the 500-seed gate's
 *   campaign graphs.
 * - `TerrainSystem` — real heights, slopes and biomes.
 * - `CollisionWorld` — real bounds, walkable-slope tests and swept movement resolution.
 * - `NavigationSystem` — the real navmesh grid and the real `findPath`, including the grid
 *   build the roadmap's 0.3 is about.
 * - `Chronicle.tickChronicle` and `Materialization.findPendingMaterializations` — the real
 *   off-screen world.
 * - `WorldEnvironment` — the real day/night and weather mix, advanced in the engine's own
 *   per-frame order (chronicle reads the mix *before* the player moves; the weather target
 *   is resolved *after*). That ordering is the whole point of the schedule arms.
 * - `CampaignDirector` — the real objectives, event pacing and chronicle commitments.
 * - `CombatResolver` — the real damage tables, action contract, poise and stagger.
 * - `ActorAi` — the real threat selection, morale and player-pursuit gating.
 * - `Fauna`, `ActorBudget` — the real beast profiles and the real actor cap.
 *
 * ---
 *
 * **WHAT IT IS NOT, AND WHAT THAT COSTS.** The named risk for this harness is false
 * confidence from something that models less than it appears to, so the gaps are listed
 * with what each one biases:
 *
 * 1. **No props, buildings or trees as colliders.** Only the world bounds and the terrain
 *    slope stop a body. Paths are therefore optimistic: a route the harness walks in a
 *    straight line may be a route the game makes you go round. **Bias: travel times are
 *    lower bounds.**
 * 2. **No region streaming cost.** Regions activate instantly. The 20–29 ms median grid
 *    build that roadmap 0.3 is about is *performed* here (so the code is exercised) but
 *    costs no simulated time. **Bias: says nothing about frame pacing.**
 * 3. **No player aim.** The scripted policies swing at whatever is inside reach rather than
 *    at what the player is looking at, and there is no bow, cleave, shield or ability.
 *    **Bias: player damage output is a floor, and blocking never happens, so incoming
 *    damage is a ceiling.**
 * 4. **Events are counted, not fought.** Materialization is real and its *exposure* is what
 *    this harness is for, but a materialized event spawns no actors here. **Bias: fights
 *    are encounter-driven only; event difficulty is not measured at all.**
 * 5. **No rendering, audio, camera, hit-stop or particles.** Nothing here can tell you
 *    whether a fight feels good.
 * 6. **Flanking is still unmeasurable**, for the same reason `aiHarness.ts` gives: an
 *    approach path needs steering and separation, and this file's actors steer only around
 *    terrain.
 *
 * So: a number from this harness describes **the shape of a run** — pacing, exposure,
 * attrition — not the experience of playing one.
 *
 * ---
 *
 * **THE MOVEMENT WARNING FROM `aiHarness.ts` APPLIES HERE TOO.** Twice a behaviour whose
 * whole point was *disengaging* degenerated into standing in a fight not fighting, and both
 * times it silently inverted a measurement. This file's `idle` policy exists as the control
 * for exactly that class of error: it is a run where the player provably does not move, so
 * any metric that fails to separate it from `beeline` is a metric that is not measuring
 * what it claims to.
 */

import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { getSiteWorldPosition2D } from '../src/game/content/registry.ts'
import {
  areAllegiancesHostile,
  isBeastRole,
  type ActorRole,
  type Allegiance,
  type Faction,
  type Objective,
  type ZoneId,
} from '../src/game/types.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { NavigationSystem } from '../src/game/systems/NavigationSystem.ts'
import { TerrainSystem } from '../src/game/world/TerrainSystem.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  getContestedRegionIds,
  isRegionRazed,
  tickChronicle,
  type ChronicleEvent,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import { findPendingMaterializations } from '../src/game/world/Materialization.ts'
import {
  advanceWeatherMix,
  computeNightFactor,
  computeStormFactor,
  createChronicleEnvironment,
  createWeatherMix,
  weatherKindForBiome,
  type WeatherKind,
  type WeatherMix,
} from '../src/game/world/WorldEnvironment.ts'
import {
  campaignObjectivesComplete,
  commitChronicleTicks,
  completeObjectiveEntry,
  createChronicleCommitmentState,
  createGeneratedObjectives,
  enemyHealthMultiplier,
  getActiveObjectiveNode,
  getPinnedRumour,
  getRumourEscort,
  getRumourReservedRegionIds,
  isWithinObjectiveArrival,
  advanceRumourProgress,
  markRumourActioned,
  offerRumours,
  pinRumour,
  playerObjectiveRatio,
  selectChronicleAnnouncements,
  settleDueRumours,
  type ChronicleCommitmentState,
  type ChronicleRumour,
  type RumourWorldContext,
} from '../src/game/world/CampaignDirector.ts'
import {
  actionCooldown,
  actionRecovery,
  actionWindup,
  actorMaxPoise,
  advancePlayerMelee,
  advanceReaction,
  applyDamageReaction,
  bufferPlayerMelee,
  cancelPlayerMelee,
  createPlayerMeleeState,
  isPlayerMeleeCommitted,
  isWithinContact,
  nextPlayerMeleeBeat,
  PLAYER_MELEE_BEATS,
  playerArmor,
  playerBeatSpec,
  resolveActorDamage,
  resolvePlayerDamage,
  rollMeleeDamage,
  selectMeleeTarget,
  type CombatActor,
  type MeleeArcCandidate,
  type PlayerMeleeState,
} from '../src/game/world/CombatResolver.ts'
import {
  aiDistance,
  beastPackShare,
  evaluateMorale,
  evaluatePlayerPursuit,
  localGroupShare,
  selectThreat,
  THREAT_PLAYER,
  type AiActor,
  type AiPoint,
} from '../src/game/world/ActorAi.ts'
import type { Territory } from '../src/game/world/worldTypes.ts'
import {
  BEAST_PROFILES,
  BEAST_LEASH_RANGE,
  BEAST_SENSE_RANGE,
  WOLF_PACK_RADIUS,
} from '../src/game/world/Fauna.ts'

// ---------------------------------------------------------------------------
// Constants, matched to the engine
// ---------------------------------------------------------------------------

/** Matches `GameEngine`'s player collider. */
export const HARNESS_PLAYER_RADIUS = 0.64
/** Matches `GameEngine`'s ordinary actor collider. */
export const HARNESS_ACTOR_RADIUS = 0.56
/** Matches the engine's actor-vs-player stop distance. */
export const HARNESS_PLAYER_CONTACT = 2.2
/** Matches `MORALE_GROUP_RADIUS`. */
export const HARNESS_MORALE_RADIUS = 14
/** Matches `MORALE_ROUT_SECONDS`. */
export const HARNESS_ROUT_SECONDS = 7
/** Matches `CORPSE_LIFETIME`: how long a body still counts for morale. */
export const HARNESS_CORPSE_LIFETIME = 12
/** Matches `MAX_ACTORS`, the shipped actor cap. */
export const HARNESS_MAX_ACTORS = 25
/** Matches the engine's player walk speed. */
export const HARNESS_PLAYER_SPEED = 6.4
/** Seconds between the player's swings. Matches the engine's melee cooldown. */
export const HARNESS_PLAYER_ATTACK_COOLDOWN = 0.42
/** The player's reach. */
export const HARNESS_PLAYER_REACH = 2.6
/** How far the player can see an event resolve. Governs the exposure metric. */
export const HARNESS_WITNESS_RADIUS = 60
/** How far the streaming window reaches, in regions. Matches the engine's 3x3. */
export const HARNESS_STREAM_RADIUS = 1
/** Encounter actors spawn when the player comes this close. */
export const HARNESS_ENCOUNTER_TRIGGER = 34
/** A run is abandoned after this many simulated seconds. */
export const HARNESS_TIME_LIMIT = 900
/** Matches the engine's `MATERIALIZE_INTERVAL`: at most one situation per six seconds. */
export const HARNESS_MATERIALIZE_INTERVAL = 6
/** How often the harness looks for encounters to trigger. */
export const HARNESS_ENCOUNTER_SCAN_INTERVAL = 1

// --- roadmap 1.1: the aimed-melee arm --------------------------------------

/**
 * How fast the scripted player turns, in radians per second.
 *
 * This is the whole reason the honest arm can whiff at all, and it is the harness's most
 * consequential invention: the shipped game aims with a mouse and there is no mouse here,
 * so a policy that snapped its aim to the target every frame would report a whiff rate of
 * zero and prove nothing. 6.5 rad/s is ~372°/s — brisk, not instant, and slower than a
 * scout can circle at close range, which is where the misses come from.
 */
export const HARNESS_AIM_TURN_RATE = 6.5
/** How close a hostile has to be before the duelist stops walking and fights. */
export const HARNESS_DUEL_RANGE = 13
/** How long before contact the duelist notices a telegraph and answers it. */
export const HARNESS_REACTION_WINDOW = 0.32
/** Wind-up at or above this reads as a heavy: commander 0.38, champion 0.48, brute 0.56. */
export const HARNESS_HEAVY_WINDUP = 0.32
/** Player stamina regeneration while not sprinting. Matches the engine's `+16/s`. */
export const HARNESS_STAMINA_REGEN = 16
/** Stamina a retreat-sprint burns per second. Matches the engine's `24/s`. */
export const HARNESS_SPRINT_DRAIN = 24
/** How much faster the retreat is than a walk. Matches the engine's sprint multiplier. */
export const HARNESS_SPRINT_MULTIPLIER = 1.65

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputPolicy = 'beeline' | 'cautious' | 'idle' | 'duelist'

/**
 * Which melee model the scripted player runs.
 *
 * `legacy` is the pre-1.1 swing this file has always driven: a cooldown and a
 * nearest-hostile-in-reach hit that cannot miss and cannot be aimed. `honest` is roadmap
 * 1.1 — `CombatResolver`'s buffered three-beat sequence, the camera-facing arc, the
 * in-arc-only assist and the committing finisher.
 *
 * **The default stays `legacy` on purpose.** Every pinned number in
 * `runHarnessTest`/`runHarnessSchedules`/`runHarnessSweep` describes one fixed simulation,
 * and silently re-pointing them at a different combat model would destroy the baseline the
 * 1.1 arms are compared against. The roadmap asks for melee to be exercised by *a policy*,
 * and that is what this is.
 */
export type MeleeModel = 'legacy' | 'honest'

/**
 * How much of a telegraph the scripted player answers.
 *
 * Three arms because the two signals ask different questions. `none` is the control: the
 * player swings through every wind-up, so "the cancel raised the avoided share" is a
 * comparison rather than a claim. `heavy` is the realistic arm — trade with a scout's
 * 0.18 s jab, get out of a brute's 0.56 s swing — and it is where the whiff rate and the
 * avoided share come from. `all` answers *every* wind-up, which is the only way to
 * exercise the whole 0.18–0.56 s band the roadmap's third signal names.
 */
export type MeleeDefence = 'none' | 'heavy' | 'all'

/**
 * Roadmap 1.3 — how the scripted player treats the chronicle's rumours.
 *
 * Four arms, and the fourth is the one that makes the measurement mean anything:
 *
 * - `off` is **the default and stays the default**, for the same reason `legacy` is the
 *   default melee model: every pinned number in `runHarnessTest`, `runHarnessSchedules` and
 *   `runHarnessSweep` describes one fixed simulation, and an ignored rumour resolving
 *   against the player is a real world change, so switching it on by default would rewrite
 *   those baselines rather than add an arm beside them.
 * - `ignore` is **the no-input baseline the roadmap's signal is measured against**: rumours
 *   are offered and resolve on their clocks, and the player never pins one or walks to one.
 * - `walk` is the **placebo**. The player detours to exactly the same squares the committed
 *   arm detours to, and pins nothing. Presence alone already freezes a region and moves
 *   encounters, so without this arm "committing changed region control" would be indist-
 *   inguishable from "walking somewhere else changed region control".
 * - `commit` is the treatment: pin one, honour it, burn the depot if that is what it asks.
 */
export type RumourPolicy = 'off' | 'ignore' | 'walk' | 'commit'

/** How close the scripted player has to get to a depot before it torches it. */
export const HARNESS_SABOTAGE_RANGE = 6
/**
 * How far the scripted player will go out of its way for a rumour, in metres.
 *
 * Without a cap the arm degenerates: a policy that abandons the campaign for every rumour
 * on the board measures a player who never finishes a run, and "region control at victory"
 * stops having victories in it. ~260 m is roughly two squares, which is a detour rather
 * than a change of career. Both `commit` and `walk` use it, so the placebo stays matched.
 */
export const HARNESS_RUMOUR_DETOUR = 110

/** Why a run ended. `timeout` is the honest answer, not a failure of the harness. */
export type RunOutcome = 'victory' | 'defeat' | 'timeout'

/** What killed the player, attributed to the source that landed the last hit. */
export type DeathCause = 'beast' | 'faction' | 'bleeding' | 'none'

export interface ObjectiveReport {
  id: string
  /** Simulated seconds from run start, or null if never completed. */
  completedAt: number | null
  /** Metres the player actually walked while this objective was the active one. */
  distanceWalked: number
  /** Straight-line metres from where the player stood when it became active. */
  straightLineDistance: number
}

export interface DamageBySource {
  /** Keyed by actor role. */
  byRole: Record<string, number>
  /** Keyed by allegiance, so beast pressure and faction war can be told apart. */
  byAllegiance: Record<string, number>
  bleeding: number
  total: number
}

export interface EventExposure {
  /** Chronicle events the world produced, in total. */
  chronicleEvents: number
  /** How many of those the player was near enough and had discovered to witness. */
  witnessed: number
  /** How many resolved out of sight — the fog-of-war number. */
  offScreen: number
  /** Situations Layer 2 was ready to materialize. */
  materializable: number
  /** How many of those the player was in the region for. */
  materializedNearPlayer: number
}

/**
 * Roadmap 1.1's four signals, plus the number open disagreement (a) asked for.
 *
 * Every field is a count or a ratio of counts, so a claim about melee can be checked
 * rather than asserted. The two that matter most are `whiffRate` — above zero proves the
 * swing can miss at all — and `avoidableHitRate`, which is the share of *telegraphed
 * heavies* the player got out of the way of.
 */
export interface MeleeMetrics {
  /** Contact frames resolved, whiffs included. Zero in the `legacy` arm. */
  beatsResolved: number
  beatsWhiffed: number
  /** `beatsWhiffed / beatsResolved`, or 0 when nothing swung. */
  whiffRate: number
  /** Contact frames resolved per beat index, so a chain that never reaches three shows. */
  beatsByIndex: number[]
  finishersLanded: number
  /** Stances the finisher broke. The third beat's reason to exist. */
  poiseBreaks: number
  staminaSpent: number
  /** Sequences abandoned by sprint, jump or the faction ability. */
  cancels: number
  /** Melee wind-ups a heavy role started against the player. */
  telegraphedHeavies: number
  /** How many of those failed to connect. */
  telegraphedHeaviesAvoided: number
  /** `telegraphedHeaviesAvoided / telegraphedHeavies`, or 0 when none were thrown. */
  avoidableHitRate: number
  /** Wind-ups the player tried to walk out of, by role. */
  windupClearAttempts: Record<string, number>
  /** How many of those it cleared before contact, by role. */
  windupClears: Record<string, number>
  /** Hits taken while the finisher had the player rooted. The price of committing. */
  hitsWhileCommitted: number
  /** Simulated seconds spent committed to a finisher. */
  committedSeconds: number
  /** Median seconds from an actor's first wound to its death, keyed by role. */
  timeToKillByRole: Record<string, number>
  /** How many deaths each median is made of, so a one-sample median is visible. */
  killsByRole: Record<string, number>
}

/**
 * Roadmap 1.3 — what the commitment loop did, per run.
 *
 * `brokenWhileCommitted` is the honest one: a rumour the player pinned and then failed is
 * not the same event as one they never touched, and a feature that could only ever be
 * kept would not be a stake.
 */
export interface RumourMetrics {
  offered: number
  offeredByKind: Record<string, number>
  pinned: number
  resolved: number
  kept: number
  broken: number
  brokenWhileCommitted: number
  /** Chronicle events the settlements themselves wrote. */
  events: number
  /** Simulated seconds the player spent inside a pinned rumour's square. */
  embodiedSeconds: number
}

export interface RunReport {
  seed: number
  faction: Faction
  policy: InputPolicy
  meleeModel: MeleeModel
  /** How much of a telegraph the scripted player answered. */
  meleeDefence: MeleeDefence
  /** Roadmap 1.3 — which rumour arm this run was. */
  rumourPolicy: RumourPolicy
  /** Frames per simulated second the run was driven at. */
  hz: number
  outcome: RunOutcome
  elapsed: number
  frames: number
  objectives: ObjectiveReport[]
  objectivesCompleted: number
  objectivesTotal: number
  distanceWalked: number
  damageTaken: DamageBySource
  damageDealt: DamageBySource
  kills: number
  deathCause: DeathCause
  /** Simulated seconds spent in each region, keyed by region id. */
  regionDwell: Record<string, number>
  regionsVisited: number
  eventExposure: EventExposure
  /** Chronicle log ids in order, the "chronicle history" the schedule arms compare. */
  chronicleHistory: string[]
  chronicleTicks: number
  /**
   * Roadmap 1.3's signal, in its raw form: who held each square when the run stopped.
   *
   * The map, not only the tally. 1.2's epilogues found the *tally* coming out identical
   * across two seeds and two factions, so a metric that only counted squares per faction
   * could report "no change" while every square had swapped owners.
   */
  regionControl: Record<string, Territory>
  /** The same thing counted by holder, which is what the epilogue prints. */
  regionControlTally: Record<Territory, number>
  /**
   * Squares burned to the ground by the time the run stopped.
   *
   * Reported because it is the campaign-safety condition made checkable: an objective site
   * in a razed square is a run that cannot be finished, since `handleGeneratedInteraction`
   * refuses a burned shop or healer before it looks at whether an objective wanted it.
   */
  razedRegionIds: string[]
  rumours: RumourMetrics
  /** Weather target changes, and where the player was standing for each. */
  weatherTargetChanges: number
  finalWeather: WeatherKind
  finalStormFactor: number
  health: number
  melee: MeleeMetrics
}

export interface RunOptions {
  seed: number
  faction: Faction
  policy?: InputPolicy
  /** Simulation rate. The scripted schedules are 30, 60 and 144. */
  hz?: number
  timeLimit?: number
  /** Defaults to `legacy`, which is the pre-1.1 model every pinned number describes. */
  meleeModel?: MeleeModel
  /**
   * Whether the player answers a telegraph by cancelling and getting out.
   *
   * The negative control for signal 2: an arm with this set to `none` swings through every
   * heavy wind-up, so "the cancel raised the avoided share" is a comparison rather than a
   * claim.
   */
  meleeDefence?: MeleeDefence
  /** Defaults to `off`, which is the pre-1.3 world every pinned number describes. */
  rumourPolicy?: RumourPolicy
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

interface HarnessActor extends AiActor, CombatActor {
  x: number
  z: number
  allegiance: Allegiance
  speed: number
  attackCooldown: number
  actionPhase: 'idle' | 'windup' | 'recovery'
  actionRemaining: number
  actionTargetIsPlayer: boolean
  actionTargetId: string | null
  hostileToPlayer: boolean
  aggroMemory: number
  routTimer: number
  deathAt: number | null
  regionId: string
  encounterId: string
  /** When the player first wounded it. The left-hand end of the time-to-kill measurement. */
  firstHitAt: number | null
  /** Set when a wind-up against the player starts, so the resolution can be attributed. */
  telegraphHeavy: boolean
  /** True once the player has answered *this* wind-up, so a clear is counted once. */
  clearAttempted: boolean
}

/** The beat indexes, so a metric array cannot disagree with the beat table's length. */
const PLAYER_MELEE_BEAT_INDEXES: readonly number[] = PLAYER_MELEE_BEATS.map(
  (spec) => spec.beat,
)

function actorPoint(actor: HarnessActor): AiPoint {
  return { x: actor.x, y: 0, z: actor.z }
}

function emptyDamage(): DamageBySource {
  return { byRole: {}, byAllegiance: {}, bleeding: 0, total: 0 }
}

function record(
  into: DamageBySource,
  role: string,
  allegiance: string,
  amount: number,
): void {
  into.byRole[role] = (into.byRole[role] ?? 0) + amount
  into.byAllegiance[allegiance] = (into.byAllegiance[allegiance] ?? 0) + amount
  into.total += amount
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Drives one run to victory, defeat or the time limit, and reports what happened.
 *
 * Deterministic: every roll comes from a stream derived from the seed, exactly as
 * `GameEngine` derives its five. Nothing here calls `Math.random`, `Date.now` or
 * `performance.now`, so the same arguments always produce the same report.
 */
export function runHarness(options: RunOptions): RunReport {
  const policy = options.policy ?? 'beeline'
  const hz = options.hz ?? 60
  const delta = 1 / hz
  const timeLimit = options.timeLimit ?? HARNESS_TIME_LIMIT
  const meleeModel = options.meleeModel ?? 'legacy'
  const meleeDefence = options.meleeDefence ?? 'heavy'
  const rumourPolicy = options.rumourPolicy ?? 'off'

  const blueprint = generateWorld(options.seed)
  const terrain = new TerrainSystem(blueprint)
  const collision = new CollisionWorld(terrain)
  collision.setWorldBounds(terrain.bounds)
  const navigation = new NavigationSystem(blueprint, terrain, collision)

  const combatRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:combat'))
  const eventRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:event'))
  const chronicleRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))
  // Roadmap 1.3 — the engine's own dedicated stream, derived the same way, so a rumour
  // offer never moves a draw the chronicle tick was going to take.
  const rumourRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:rumour'))

  const chronicleState: ChronicleState = createChronicleState()
  const chronicleRegions: Map<string, RegionChronicleState> =
    createChronicleRegions(blueprint)
  const protectedRegionIds = getChronicleProtectedRegionIds(blueprint)

  const objectives: Objective[] = createGeneratedObjectives(blueprint, options.faction)
  const objectiveReports = new Map<string, ObjectiveReport>()

  // --- roadmap 1.3: the commitment loop ---------------------------------------
  const commitments: ChronicleCommitmentState = createChronicleCommitmentState()
  const rumourReservedRegionIds = getRumourReservedRegionIds(blueprint, options.faction)
  const rumours: RumourMetrics = {
    offered: 0,
    offeredByKind: {},
    pinned: 0,
    resolved: 0,
    kept: 0,
    broken: 0,
    brokenWhileCommitted: 0,
    events: 0,
    embodiedSeconds: 0,
  }
  const rumourContext = (): RumourWorldContext => ({
    blueprint,
    state: chronicleState,
    regions: chronicleRegions,
    playerFaction: options.faction,
    reservedRegionIds: rumourReservedRegionIds,
  })

  const startSite = blueprint.sites.find(
    (site) => site.id === blueprint.starts[options.faction],
  )
  if (!startSite) throw new Error('Generated start site is missing')
  const start = getSiteWorldPosition2D(blueprint, startSite)
  if (!start) throw new Error('Generated start position is missing')

  const player = {
    x: start.x,
    z: start.z,
    health: 100,
    maxHealth: 100,
    damage: 28,
    bleeding: 0,
    attackCooldown: 0,
    // --- roadmap 1.1 ---------------------------------------------------------
    stamina: 100,
    maxStamina: 100,
    /** Where the camera points. `(sin, cos)` of it is the aim vector the arc tests. */
    aimYaw: 0,
    melee: createPlayerMeleeState() as PlayerMeleeState,
  }

  const melee: MeleeMetrics = {
    beatsResolved: 0,
    beatsWhiffed: 0,
    whiffRate: 0,
    beatsByIndex: PLAYER_MELEE_BEAT_INDEXES.map(() => 0),
    finishersLanded: 0,
    poiseBreaks: 0,
    staminaSpent: 0,
    cancels: 0,
    telegraphedHeavies: 0,
    telegraphedHeaviesAvoided: 0,
    avoidableHitRate: 0,
    windupClearAttempts: {},
    windupClears: {},
    hitsWhileCommitted: 0,
    committedSeconds: 0,
    timeToKillByRole: {},
    killsByRole: {},
  }
  const killTimes = new Map<string, number[]>()
  const recordKill = (role: string, seconds: number): void => {
    const bucket = killTimes.get(role)
    if (bucket) bucket.push(seconds)
    else killTimes.set(role, [seconds])
  }

  let elapsed = 0
  let frames = 0
  let chronicleAccumulator = 0
  let chronicleTicks = 0
  let distanceWalked = 0
  let kills = 0
  let deathCause: DeathCause = 'none'
  let outcome: RunOutcome = 'timeout'
  const damageTaken = emptyDamage()
  const damageDealt = emptyDamage()
  const regionDwell: Record<string, number> = {}
  const discoveredRegionIds = new Set<string>()
  const triggeredEncounterIds = new Set<string>()
  const materializedSituationIds = new Set<string>()
  const seenAftermathRegionIds = new Set<string>()
  const exposure: EventExposure = {
    chronicleEvents: 0,
    witnessed: 0,
    offScreen: 0,
    materializable: 0,
    materializedNearPlayer: 0,
  }
  let weatherTargetChanges = 0
  let announcedChronicleLines = 0
  let materializeCooldown = 0
  let encounterScanCooldown = 0
  let lastAttackerCause: DeathCause = 'none'

  const actors: HarnessActor[] = []
  let actorSequence = 0

  const zoneAt = (x: number, z: number): ZoneId => {
    const biome = terrain.getBiomeAt(x, z)
    return biome === 'neutral' || biome === 'palace' || biome === 'forest' || biome === 'fort'
      ? biome
      : 'neutral'
  }
  const regionIdAt = (x: number, z: number): string => {
    const id = terrain.getRegionIdAt(x, z)
    return id === undefined ? '' : String(id)
  }

  let weatherZone = zoneAt(player.x, player.z)
  let weatherTarget: WeatherKind = weatherKindForBiome(weatherZone)
  const weatherMix: WeatherMix = createWeatherMix(weatherTarget)

  const activeRegionIds = (): string[] => {
    const current = terrain.getRegionAt(player.x, player.z)
    if (!current) return []
    const ids: string[] = []
    for (const region of terrain.layout.regions) {
      if (
        Math.abs(region.coordinate.x - current.coordinate.x) <= HARNESS_STREAM_RADIUS &&
        Math.abs(region.coordinate.z - current.coordinate.z) <= HARNESS_STREAM_RADIUS
      ) {
        ids.push(String(region.id))
      }
    }
    return ids
  }

  let simulatedRegionIds = new Set(activeRegionIds())
  navigation.setActiveRegions(simulatedRegionIds)
  discoveredRegionIds.add(regionIdAt(player.x, player.z))

  // --- roadmap 1.3: where a rumour sends the player ---------------------------

  /**
   * The spot a rumour asks the scripted player to stand on.
   *
   * A sabotage points at the depot itself, because the torch needs the player within
   * `HARNESS_SABOTAGE_RANGE` of it. The other two point at the square's centre, which is
   * the same rule the engine's map pin follows.
   */
  const rumourTarget = (
    rumour: ChronicleRumour,
  ): { x: number; z: number } | null => {
    if (rumour.kind === 'sabotage' && rumour.siteId) {
      const site = getSiteWorldPosition2D(blueprint, rumour.siteId)
      if (site) return { x: site.x, z: site.z }
    }
    const region = terrain.getRegion(rumour.regionId)
    if (!region) return null
    return {
      x: (region.bounds.minX + region.bounds.maxX) / 2,
      z: (region.bounds.minZ + region.bounds.maxZ) / 2,
    }
  }

  /**
   * The rumour the policy is currently walking toward.
   *
   * `commit` follows the pin. `walk` — the placebo — follows the *first offered* rumour
   * without ever pinning it, so the two arms take the same detours and differ only in
   * whether a commitment exists. Both are capped by `HARNESS_RUMOUR_DETOUR`.
   */
  const steeringRumour = (): ChronicleRumour | null => {
    const candidate =
      rumourPolicy === 'commit'
        ? getPinnedRumour(commitments)
        : rumourPolicy === 'walk'
          ? (commitments.rumours.find((rumour) => withinDetour(rumour)) ?? null)
          : null
    if (!candidate) return null
    return withinDetour(candidate) ? candidate : null
  }

  /** True when the rumour is close enough to be worth leaving the road for. */
  const withinDetour = (rumour: ChronicleRumour): boolean => {
    const target = rumourTarget(rumour)
    if (!target) return false
    return Math.hypot(target.x - player.x, target.z - player.z) <= HARNESS_RUMOUR_DETOUR
  }

  /**
   * One tick of the commitment loop, in the engine's order: progress, settle, offer.
   * The functions are the shipped ones, not a re-implementation.
   */
  const advanceCommitments = (playerRegionId: string): ChronicleEvent[] => {
    if (rumourPolicy === 'off') return []
    const context = rumourContext()
    advanceRumourProgress(commitments, context, playerRegionId || null)
    const settlement = settleDueRumours(commitments, context, rumourRng)
    rumours.events += settlement.events.length
    for (const verdict of settlement.verdicts) {
      rumours.resolved += 1
      if (verdict.outcome === 'kept') rumours.kept += 1
      else {
        rumours.broken += 1
        if (verdict.committed) rumours.brokenWhileCommitted += 1
      }
    }
    const offered = offerRumours(commitments, context, rumourRng)
    if (offered) {
      rumours.offered += 1
      rumours.offeredByKind[offered.kind] =
        (rumours.offeredByKind[offered.kind] ?? 0) + 1
    }
    if (rumourPolicy === 'commit' && getPinnedRumour(commitments) === null) {
      // Only pin what the policy is actually willing to walk to. A commitment the arm
      // never honours because it is half a map away would measure indifference, not a
      // decision.
      const next = commitments.rumours.find((rumour) => withinDetour(rumour))
      if (next && pinRumour(commitments, next.id)) rumours.pinned += 1
    }
    return settlement.events
  }

  // --- objective bookkeeping -------------------------------------------------

  let trackedObjectiveId: string | null = null
  let trackedFrom: { x: number; z: number } | null = null

  const trackObjective = (id: string | null): void => {
    if (id === trackedObjectiveId) return
    trackedObjectiveId = id
    trackedFrom = id === null ? null : { x: player.x, z: player.z }
    if (id !== null && !objectiveReports.has(id)) {
      objectiveReports.set(id, {
        id,
        completedAt: null,
        distanceWalked: 0,
        straightLineDistance: 0,
      })
    }
  }

  // --- pathing ---------------------------------------------------------------

  let waypoints: Array<readonly [number, number]> = []
  let repathAt = -1

  const pathTo = (targetX: number, targetZ: number): void => {
    const path = navigation.findPath(
      { x: player.x, z: player.z },
      { x: targetX, z: targetZ },
    )
    waypoints = path ? path.map((point) => [point.x, point.z] as const) : []
  }

  // --- spawning --------------------------------------------------------------

  const spawnEncounter = (regionId: string): void => {
    for (const slot of blueprint.encounters) {
      if (String(slot.regionId) !== regionId) continue
      if (triggeredEncounterIds.has(slot.id)) continue
      const site = slot.siteId ? getSiteWorldPosition2D(blueprint, slot.siteId) : undefined
      const anchorX = site?.x ?? player.x
      const anchorZ = site?.z ?? player.z
      if (Math.hypot(anchorX - player.x, anchorZ - player.z) > HARNESS_ENCOUNTER_TRIGGER) {
        continue
      }
      triggeredEncounterIds.add(slot.id)
      const chronicle = chronicleRegions.get(regionId)
      const beastLed = (chronicle?.beastPressure ?? 0) > 0.55
      const count = Math.min(4, 2 + Math.floor(eventRng.next() * 3))
      for (let index = 0; index < count; index += 1) {
        if (actors.filter((actor) => actor.alive).length >= HARNESS_MAX_ACTORS) break
        const role: ActorRole = beastLed
          ? (['wolf', 'wolf', 'boar', 'bear'] as ActorRole[])[eventRng.integer(0, 4)]
          : (['soldier', 'soldier', 'scout', 'brute'] as ActorRole[])[
              eventRng.integer(0, 4)
            ]
        const allegiance: Allegiance = beastLed
          ? 'beast'
          : ((['elf', 'guard', 'villain'] as Faction[]).filter(
              (candidate) => candidate !== options.faction,
            )[eventRng.integer(0, 2)] as Allegiance)
        const beast = isBeastRole(role) ? BEAST_PROFILES[role] : null
        const maxHp = Math.round(
          (beast?.hp ?? 90) * enemyHealthMultiplier(1, areAllegiancesHostile(options.faction, allegiance)),
        )
        const angle = eventRng.next() * Math.PI * 2
        const radius = 8 + eventRng.next() * 10
        actorSequence += 1
        actors.push({
          id: `actor-${actorSequence}`,
          allegiance,
          role,
          alive: true,
          ignoredTargetId: null,
          targetId: null,
          packId: beastLed ? `pack-${slot.id}` : null,
          packKinSize: beastLed ? count : 1,
          hp: maxHp,
          maxHp,
          playerAggro: false,
          x: anchorX + Math.cos(angle) * radius,
          z: anchorZ + Math.sin(angle) * radius,
          speed: beast?.speed ?? 3.7,
          attackCooldown: 0,
          actionPhase: 'idle',
          actionRemaining: 0,
          actionTargetIsPlayer: false,
          actionTargetId: null,
          hostileToPlayer: areAllegiancesHostile(options.faction, allegiance),
          aggroMemory: 0,
          routTimer: 0,
          deathAt: null,
          reaction: 'none',
          reactionRemaining: 0,
          poise: actorMaxPoise(role),
          maxPoise: actorMaxPoise(role),
          poiseRecoveryDelay: 0,
          staggerImmunity: 0,
          regionId,
          encounterId: slot.id,
          firstHitAt: null,
          telegraphHeavy: false,
          clearAttempted: false,
        })
      }
    }
  }

  // --- the loop --------------------------------------------------------------

  while (elapsed < timeLimit) {
    frames += 1
    elapsed += delta

    // 1. Chronicle, against the weather mix as it stood before the player moved. This is
    //    the engine's order, and it is what the 30/60/144 Hz arms are testing.
    const environment = createChronicleEnvironment(elapsed, weatherMix)
    const commitment = commitChronicleTicks(chronicleAccumulator, delta)
    chronicleAccumulator = commitment.accumulator
    if (commitment.ticks > 0) {
      const ratio = playerObjectiveRatio(objectives)
      const produced: ChronicleEvent[] = []
      for (let tick = 0; tick < commitment.ticks; tick += 1) {
        const playerRegionId = regionIdAt(player.x, player.z)
        produced.push(
          ...tickChronicle({
            blueprint,
            state: chronicleState,
            regions: chronicleRegions,
            rng: chronicleRng,
            environment,
            playerFaction: options.faction,
            playerObjectiveRatio: ratio,
            protectedRegionIds,
            frozenRegionIds: simulatedRegionIds,
            escort:
              rumourPolicy === 'off'
                ? null
                : getRumourEscort(commitments, rumourContext(), playerRegionId || null),
          }),
        )
        produced.push(...advanceCommitments(playerRegionId))
        chronicleTicks += 1
      }
      getContestedRegionIds(blueprint, chronicleRegions)
      exposure.chronicleEvents += produced.length
      // The three gates that decide whether the player is ever told: salience, the
      // two-line batch cap, and fog of war. `announced` is the subset that would have
      // reached the notice channel; `witnessed` is the wider "was in a position to see it".
      const announced = selectChronicleAnnouncements(produced, discoveredRegionIds)
      announcedChronicleLines += announced.length
      for (const event of produced) {
        const regionId = String(event.regionId)
        const region = terrain.getRegion(regionId)
        // Distance to the region's *rectangle*, not to its centre. A region is roughly
        // 140 m across, so a centre test would call the square the player is standing in
        // "off-screen" whenever they were near its edge, and the exposure number would be
        // a measurement of region size rather than of what a player can see.
        const distance = region
          ? distanceToBounds(player.x, player.z, region.bounds)
          : Number.POSITIVE_INFINITY
        if (distance <= HARNESS_WITNESS_RADIUS && discoveredRegionIds.has(regionId)) {
          exposure.witnessed += 1
        } else {
          exposure.offScreen += 1
        }
      }
    }

    // 2. Materialization, which is the other half of exposure. Gated on the engine's own
    //    interval rather than run every frame: the engine materializes at most one
    //    situation every `MATERIALIZE_INTERVAL` seconds, and scanning per frame would both
    //    cost more than the engine does and count situations the engine would never see.
    materializeCooldown -= delta
    if (materializeCooldown <= 0) {
      materializeCooldown = HARNESS_MATERIALIZE_INTERVAL
      const pending = findPendingMaterializations({
        blueprint,
        regions: chronicleRegions,
        chronicle: chronicleState,
        simulatedRegionIds,
        protectedRegionIds,
        playerFaction: options.faction,
        seenAftermathRegionIds,
      })
      for (const situation of pending) {
        if (materializedSituationIds.has(situation.id)) continue
        materializedSituationIds.add(situation.id)
        exposure.materializable += 1
        if (simulatedRegionIds.has(situation.regionId)) exposure.materializedNearPlayer += 1
        if (situation.kind === 'aftermath') seenAftermathRegionIds.add(situation.regionId)
      }
    }

    // 3. The player.
    const activeNode = getActiveObjectiveNode(blueprint, options.faction, objectives)
    trackObjective(activeNode?.id ?? null)
    const objectiveSite = activeNode
      ? getSiteWorldPosition2D(blueprint, activeNode.siteId)
      : undefined

    // Roadmap 1.1 — the inbound telegraph the duelist answers, found before anything
    // moves so the answer is a reaction to this frame rather than to the last one.
    const inbound =
      policy === 'duelist' && meleeDefence !== 'none'
        ? inboundWindup(actors, player, meleeDefence === 'heavy')
        : null
    if (inbound) {
      // The defensive verb, exactly as the engine spends it: sprint/jump/ability drop the
      // buffer and the beat in flight, and are refused outright while the finisher is
      // committed. `cancelPlayerMelee` is the shipped function, not a re-implementation.
      if (meleeModel === 'honest' && cancelPlayerMelee(player.melee)) melee.cancels += 1
      if (!inbound.actor.clearAttempted) {
        inbound.actor.clearAttempted = true
        const role = inbound.actor.role
        melee.windupClearAttempts[role] = (melee.windupClearAttempts[role] ?? 0) + 1
      }
    }
    const duelTarget =
      policy === 'duelist' ? nearestHostileWithin(actors, player, HARNESS_DUEL_RANGE) : null

    // Roadmap 1.3 — the detour. `commit` follows its pin and `walk` follows the same square
    // without one, which is the placebo that keeps "the commitment did it" from meaning
    // "walking somewhere else did it". `travelSite` replaces the objective as a destination
    // only; objective completion below still reads `objectiveSite`.
    const steering = steeringRumour()
    const rumourSite = steering ? rumourTarget(steering) : null
    const travelSite = rumourSite ?? objectiveSite

    if (policy !== 'idle' && (travelSite || duelTarget)) {
      const retreating =
        policy === 'cautious' && player.health < player.maxHealth * 0.35
      if (travelSite && (elapsed >= repathAt || waypoints.length === 0)) {
        repathAt = elapsed + 2
        pathTo(travelSite.x, travelSite.z)
      }
      let targetX = travelSite?.x ?? player.x
      let targetZ = travelSite?.z ?? player.z
      if (travelSite && waypoints.length > 0) {
        const [wx, wz] = waypoints[0]
        if (Math.hypot(wx - player.x, wz - player.z) < 1.5) waypoints.shift()
        else {
          targetX = wx
          targetZ = wz
        }
      }
      if (retreating) {
        // Away from the nearest threat rather than toward the objective. The `idle`
        // control exists because a "retreat" that does not move is the degenerate case
        // `aiHarness.ts` warns about twice.
        const threat = nearestHostile(actors, player)
        if (threat) {
          targetX = player.x + (player.x - threat.x)
          targetZ = player.z + (player.z - threat.z)
        }
      }
      // A duelist stops for a fight, and gets out of the way of a telegraph. Both are the
      // whole point of the arm: a player who walks past every enemy measures travel, not
      // combat, and a player who never reacts measures nothing about the defensive verb.
      let sprinting = false
      let holding = false
      if (inbound) {
        targetX = player.x + (player.x - inbound.actor.x)
        targetZ = player.z + (player.z - inbound.actor.z)
        sprinting = player.stamina > 2
      } else if (duelTarget) {
        const spec = playerBeatSpec(nextPlayerMeleeBeat(player.melee))
        const engageRange =
          meleeModel === 'honest' ? spec.reach - 0.5 : HARNESS_PLAYER_REACH - 0.4
        const distance = Math.hypot(duelTarget.x - player.x, duelTarget.z - player.z)
        if (distance <= engageRange) holding = true
        else {
          targetX = duelTarget.x
          targetZ = duelTarget.z
        }
      }

      // The finisher's root. `isPlayerMeleeCommitted` is the same predicate the engine
      // gates movement on, so the price of the third beat is paid identically in both.
      const committed = meleeModel === 'honest' && isPlayerMeleeCommitted(player.melee)
      if (committed) melee.committedSeconds += delta
      if (sprinting) player.stamina = Math.max(0, player.stamina - delta * HARNESS_SPRINT_DRAIN)
      else {
        player.stamina = Math.min(
          player.maxStamina,
          player.stamina + delta * HARNESS_STAMINA_REGEN,
        )
      }

      const dx = targetX - player.x
      const dz = targetZ - player.z
      const length = Math.hypot(dx, dz)
      if (length > 0.001 && !holding && !committed) {
        const speed = HARNESS_PLAYER_SPEED * (sprinting ? HARNESS_SPRINT_MULTIPLIER : 1)
        const step = Math.min(speed * delta, length)
        const moved = collision.resolveMovement(
          { x: player.x, z: player.z },
          { x: player.x + (dx / length) * step, z: player.z + (dz / length) * step },
          HARNESS_PLAYER_RADIUS,
        )
        const travelled = Math.hypot(moved.x - player.x, moved.z - player.z)
        player.x = moved.x
        player.z = moved.z
        distanceWalked += travelled
        const tracked = trackedObjectiveId
          ? objectiveReports.get(trackedObjectiveId)
          : undefined
        if (tracked) tracked.distanceWalked += travelled
      }
    }

    // 4. Streaming, dwell and discovery.
    const currentRegionId = regionIdAt(player.x, player.z)
    if (currentRegionId) {
      regionDwell[currentRegionId] = (regionDwell[currentRegionId] ?? 0) + delta
      discoveredRegionIds.add(currentRegionId)
    }

    // Roadmap 1.3 — the embodied half, checked after the player has moved. The torch is the
    // only one of the three interventions that is an act rather than a stay, and it is
    // gated on distance to the depot for exactly the reason the design is: a sabotage that
    // could be done from the HUD would be the rejected purchase.
    if (rumourPolicy === 'commit') {
      const pinned = getPinnedRumour(commitments)
      if (pinned && pinned.regionId === currentRegionId) {
        rumours.embodiedSeconds += delta
      }
      if (pinned && pinned.kind === 'sabotage' && !pinned.actioned && pinned.siteId) {
        const depot = getSiteWorldPosition2D(blueprint, pinned.siteId)
        if (
          depot &&
          Math.hypot(depot.x - player.x, depot.z - player.z) <= HARNESS_SABOTAGE_RANGE
        ) {
          markRumourActioned(commitments, rumourContext(), pinned.id)
        }
      }
    }
    const nextActive = new Set(activeRegionIds())
    if (!sameSet(nextActive, simulatedRegionIds)) {
      simulatedRegionIds = nextActive
      navigation.setActiveRegions(simulatedRegionIds)
      encounterScanCooldown = 0
    }
    // Streamed-in regions count as discovered, exactly as they do in the engine: the fog
    // lifts on the 3x3 window, not only on the square the player is standing in. That is
    // what makes the exposure number a measure of the *player's* view rather than of the
    // one square under their feet.
    for (const regionId of simulatedRegionIds) discoveredRegionIds.add(regionId)
    encounterScanCooldown -= delta
    if (encounterScanCooldown <= 0) {
      encounterScanCooldown = HARNESS_ENCOUNTER_SCAN_INTERVAL
      for (const regionId of simulatedRegionIds) spawnEncounter(regionId)
    }

    // 5. Actors: real decisions, real damage.
    stepActors({
      actors,
      player,
      delta,
      elapsed,
      faction: options.faction,
      combatRng,
      collision,
      damageTaken,
      melee,
      playerCommitted: meleeModel === 'honest' && isPlayerMeleeCommitted(player.melee),
      onKill: () => {
        kills += 1
      },
      onPlayerHit: (actor, amount) => {
        record(damageTaken, actor.role, actor.allegiance, amount)
        lastAttackerCause = actor.allegiance === 'beast' ? 'beast' : 'faction'
      },
    })

    // 6. The player's swing.
    //
    //    `legacy` is the pre-1.1 model: a cooldown and a nearest-hostile-in-reach hit that
    //    cannot miss and cannot be aimed — the stated limit this file has always carried.
    //    `honest` is roadmap 1.1 driven through `CombatResolver`'s own functions, with a
    //    finite turn rate standing in for a mouse, so a swing can land behind its target.
    if (meleeModel === 'legacy') {
      player.attackCooldown = Math.max(0, player.attackCooldown - delta)
      if (policy !== 'idle' && player.attackCooldown <= 0) {
        const victim = nearestHostileInReach(actors, player)
        if (victim) {
          player.attackCooldown = HARNESS_PLAYER_ATTACK_COOLDOWN
          const outcomeHit = resolveActorDamage({
            target: victim,
            baseDamage: player.damage + combatRng.next() * 7,
            attackKind: 'melee',
            facingDotToSource: null,
          })
          if (victim.firstHitAt === null) victim.firstHitAt = elapsed
          victim.hp = Math.max(0, victim.hp - outcomeHit.dealt)
          record(damageDealt, victim.role, victim.allegiance, outcomeHit.dealt)
          applyDamageReaction(victim, outcomeHit, 'melee')
          if (outcomeHit.killed) {
            victim.alive = false
            victim.deathAt = elapsed
            recordKill(victim.role, elapsed - (victim.firstHitAt ?? elapsed))
            kills += 1
          }
        }
      }
    } else if (policy !== 'idle') {
      const aimTarget = nearestHostileWithin(actors, player, HARNESS_DUEL_RANGE)
      if (aimTarget) {
        player.aimYaw = turnToward(
          player.aimYaw,
          Math.atan2(aimTarget.x - player.x, aimTarget.z - player.z),
          HARNESS_AIM_TURN_RATE * delta,
        )
      }
      // Press whenever the *next* beat could reach something. The buffer decides when it
      // becomes a swing; nothing here resolves a hit, which is the point.
      const pending = playerBeatSpec(nextPlayerMeleeBeat(player.melee))
      const reachable = nearestHostileWithin(actors, player, pending.reach)
      if (reachable && !inbound) bufferPlayerMelee(player.melee)

      const step = advancePlayerMelee(player.melee, { delta, stamina: player.stamina })
      if (step.startedBeat > 0) {
        player.stamina = Math.max(0, player.stamina - step.staminaSpent)
        melee.staminaSpent += step.staminaSpent
      }
      if (step.contactBeat > 0) {
        const spec = playerBeatSpec(step.contactBeat)
        melee.beatsResolved += 1
        melee.beatsByIndex[step.contactBeat - 1] += 1
        const aimX = Math.sin(player.aimYaw)
        const aimZ = Math.cos(player.aimYaw)
        const candidates: MeleeArcCandidate[] = []
        for (const actor of actors) {
          if (!actor.alive || !actor.hostileToPlayer) continue
          const offsetX = actor.x - player.x
          const offsetZ = actor.z - player.z
          const distance = Math.hypot(offsetX, offsetZ)
          if (distance > spec.reach) continue
          candidates.push({
            id: actor.id,
            distance,
            aimDot:
              distance > 0.001 ? (offsetX * aimX + offsetZ * aimZ) / distance : 1,
            hostile: true,
          })
        }
        const chosen = selectMeleeTarget(candidates, spec)
        const victim = chosen
          ? actors.find((actor) => actor.id === chosen.id) ?? null
          : null
        if (!victim?.alive) {
          melee.beatsWhiffed += 1
        } else {
          const outcomeHit = resolveActorDamage({
            target: victim,
            baseDamage:
              (player.damage + combatRng.next() * 7) * spec.damageMultiplier,
            attackKind: spec.attackKind,
            facingDotToSource: null,
          })
          if (victim.firstHitAt === null) victim.firstHitAt = elapsed
          victim.hp = Math.max(0, victim.hp - outcomeHit.dealt)
          record(damageDealt, victim.role, victim.allegiance, outcomeHit.dealt)
          const broke = applyDamageReaction(victim, outcomeHit, spec.attackKind)
          if (broke) melee.poiseBreaks += 1
          if (spec.commits) melee.finishersLanded += 1
          if (outcomeHit.killed) {
            victim.alive = false
            victim.deathAt = elapsed
            recordKill(victim.role, elapsed - (victim.firstHitAt ?? elapsed))
            kills += 1
          }
        }
      }
    }

    // 7. Objective arrival.
    if (activeNode?.kind === 'arrive' && objectiveSite) {
      if (
        isWithinObjectiveArrival(player.x, player.z, objectiveSite.x, objectiveSite.z)
      ) {
        completeObjectiveEntry(objectives, activeNode.id)
        finishObjective(activeNode.id)
      }
    }
    // Anything that is not an arrival completes when the player is standing on it and
    // nothing hostile is left within reach — a stand-in for the interaction the engine
    // gates on a keypress, and a stated simplification.
    if (activeNode && activeNode.kind !== 'arrive' && objectiveSite) {
      const onSite = Math.hypot(
        objectiveSite.x - player.x,
        objectiveSite.z - player.z,
      ) <= 6
      const clear = !actors.some(
        (actor) =>
          actor.alive &&
          actor.hostileToPlayer &&
          Math.hypot(actor.x - player.x, actor.z - player.z) < 12,
      )
      if (onSite && clear && policy !== 'idle') {
        completeObjectiveEntry(objectives, activeNode.id)
        finishObjective(activeNode.id)
      }
    }

    // 8. Bleeding, then the run-ending checks, in the engine's order.
    if (player.bleeding > 0) {
      const amount = player.bleeding * delta
      player.health -= amount
      damageTaken.bleeding += amount
      damageTaken.total += amount
    }
    if (player.health <= 0) {
      outcome = 'defeat'
      deathCause = lastAttackerCause
      break
    }
    if (campaignObjectivesComplete(objectives)) {
      outcome = 'victory'
      break
    }

    // 9. Weather, last, against the player's *new* position. The hazard the roadmap names:
    //    `advanceWeatherMix` composes exactly for a fixed target, so the mix is not the
    //    problem — *when* the target changes, and where the player was standing when it
    //    did, is.
    const nextZone = zoneAt(player.x, player.z)
    if (nextZone !== weatherZone) {
      weatherZone = nextZone
      weatherTarget = weatherKindForBiome(nextZone)
      weatherTargetChanges += 1
    }
    advanceWeatherMix(weatherMix, weatherTarget, delta)

    // Corpses drop off the morale roster on the same schedule as the engine's.
    for (let index = actors.length - 1; index >= 0; index -= 1) {
      const actor = actors[index]
      if (!actor.alive && actor.deathAt !== null && elapsed - actor.deathAt > HARNESS_CORPSE_LIFETIME) {
        actors.splice(index, 1)
      }
    }
  }

  function finishObjective(id: string): void {
    const report = objectiveReports.get(id)
    if (!report || report.completedAt !== null) return
    report.completedAt = elapsed
    if (trackedFrom) {
      report.straightLineDistance = Math.hypot(
        player.x - trackedFrom.x,
        player.z - trackedFrom.z,
      )
    }
  }

  const reports: ObjectiveReport[] = objectives.map(
    (objective) =>
      objectiveReports.get(objective.id) ?? {
        id: objective.id,
        completedAt: null,
        distanceWalked: 0,
        straightLineDistance: 0,
      },
  )

  melee.whiffRate =
    melee.beatsResolved > 0 ? melee.beatsWhiffed / melee.beatsResolved : 0
  melee.avoidableHitRate =
    melee.telegraphedHeavies > 0
      ? melee.telegraphedHeaviesAvoided / melee.telegraphedHeavies
      : 0
  for (const [role, times] of killTimes) {
    melee.timeToKillByRole[role] = median(times)
    melee.killsByRole[role] = times.length
  }

  const regionControl: Record<string, Territory> = {}
  const regionControlTally: Record<Territory, number> = {
    neutral: 0,
    elf: 0,
    guard: 0,
    villain: 0,
  }
  const razedRegionIds: string[] = []
  for (const region of blueprint.regions) {
    const key = String(region.id)
    const chronicle = chronicleRegions.get(key)
    const control = chronicle?.control ?? region.territory
    regionControl[key] = control
    regionControlTally[control] += 1
    if (isRegionRazed(chronicle)) razedRegionIds.push(key)
  }

  return {
    seed: blueprint.seed,
    faction: options.faction,
    policy,
    meleeModel,
    meleeDefence,
    rumourPolicy,
    hz,
    outcome,
    elapsed,
    frames,
    objectives: reports,
    objectivesCompleted: objectives.filter((objective) => objective.done).length,
    objectivesTotal: objectives.length,
    distanceWalked,
    damageTaken,
    damageDealt,
    kills,
    deathCause,
    regionDwell,
    regionsVisited: Object.keys(regionDwell).length,
    eventExposure: exposure,
    chronicleHistory: chronicleState.log.map((event) => event.id),
    chronicleTicks,
    regionControl,
    regionControlTally,
    razedRegionIds,
    rumours,
    weatherTargetChanges,
    finalWeather: weatherTarget,
    finalStormFactor: computeStormFactor(weatherMix),
    health: Math.max(0, player.health),
    melee,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sameSet(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  if (first.size !== second.size) return false
  for (const value of first) if (!second.has(value)) return false
  return true
}

/** Zero inside the rectangle, otherwise the shortest distance to its edge. */
function distanceToBounds(
  x: number,
  z: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): number {
  const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX)
  const dz = Math.max(bounds.minZ - z, 0, z - bounds.maxZ)
  return Math.hypot(dx, dz)
}

function nearestHostile(
  actors: readonly HarnessActor[],
  player: { x: number; z: number },
): HarnessActor | null {
  let best: HarnessActor | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const actor of actors) {
    if (!actor.alive || !actor.hostileToPlayer) continue
    const distance = Math.hypot(actor.x - player.x, actor.z - player.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = actor
    }
  }
  return best
}

function nearestHostileInReach(
  actors: readonly HarnessActor[],
  player: { x: number; z: number },
): HarnessActor | null {
  const nearest = nearestHostile(actors, player)
  if (!nearest) return null
  return Math.hypot(nearest.x - player.x, nearest.z - player.z) <= HARNESS_PLAYER_REACH
    ? nearest
    : null
}

function nearestHostileWithin(
  actors: readonly HarnessActor[],
  player: { x: number; z: number },
  range: number,
): HarnessActor | null {
  const nearest = nearestHostile(actors, player)
  if (!nearest) return null
  return Math.hypot(nearest.x - player.x, nearest.z - player.z) <= range ? nearest : null
}

/**
 * A wind-up aimed at the player that is about to land.
 *
 * The duelist reacts to it and nothing else: reacting to a hostile merely being *near*
 * would make the arm a measurement of proximity, and reacting after contact would measure
 * nothing at all. `HARNESS_REACTION_WINDOW` is the notice a player gets from a telegraph
 * decal and the `attackTell` cue, which is what the enemy half already spends on being
 * readable.
 */
function inboundWindup(
  actors: readonly HarnessActor[],
  player: { x: number; z: number },
  heavyOnly: boolean,
): { actor: HarnessActor; remaining: number } | null {
  let best: { actor: HarnessActor; remaining: number } | null = null
  for (const actor of actors) {
    if (!actor.alive || !actor.hostileToPlayer) continue
    if (actor.actionPhase !== 'windup' || !actor.actionTargetIsPlayer) continue
    if (heavyOnly && actionWindup(actor.role) < HARNESS_HEAVY_WINDUP) continue
    if (actor.actionRemaining > HARNESS_REACTION_WINDOW) continue
    if (
      Math.hypot(actor.x - player.x, actor.z - player.z) >
      HARNESS_PLAYER_CONTACT + 2.5
    ) {
      continue
    }
    if (best === null || actor.actionRemaining < best.remaining) {
      best = { actor, remaining: actor.actionRemaining }
    }
  }
  return best
}

/** Turn `from` toward `to` by at most `maxStep` radians, the short way round. */
function turnToward(from: number, to: number, maxStep: number): number {
  let difference = to - from
  while (difference > Math.PI) difference -= Math.PI * 2
  while (difference < -Math.PI) difference += Math.PI * 2
  if (Math.abs(difference) <= maxStep) return to
  return from + Math.sign(difference) * maxStep
}

interface StepContext {
  actors: HarnessActor[]
  player: { x: number; z: number; health: number; maxHealth: number; bleeding: number }
  delta: number
  elapsed: number
  faction: Faction
  combatRng: RandomStream
  collision: CollisionWorld
  damageTaken: DamageBySource
  melee: MeleeMetrics
  /** True while the finisher has the player rooted, so a hit taken then is attributable. */
  playerCommitted: boolean
  onKill: () => void
  onPlayerHit: (actor: HarnessActor, amount: number) => void
}

/**
 * One actor step: the real threat scoring, the real morale rule, the real player-pursuit
 * gate, the real action contract and the real damage.
 *
 * Movement is a collision-resolved step toward the chosen target — real terrain and world
 * bounds, but no props, which is limit 1 in this file's header.
 */
function stepActors(context: StepContext): void {
  const { actors, player, delta, elapsed, combatRng, collision } = context
  const living = actors.filter((actor) => actor.alive)
  const playerPoint: AiPoint = { x: player.x, y: 0, z: player.z }

  for (const actor of living) {
    advanceReaction(actor, delta)
    actor.attackCooldown = Math.max(0, actor.attackCooldown - delta)
    actor.aggroMemory = Math.max(0, actor.aggroMemory - delta)

    const distanceToPlayer = aiDistance(actorPoint(actor), playerPoint)
    const pursuit = evaluatePlayerPursuit({
      hostileToPlayer: actor.hostileToPlayer,
      playerAggro: actor.playerAggro,
      aggroMemory: actor.aggroMemory,
      playerDistance: distanceToPlayer,
      senseRange: isBeastRole(actor.role) ? BEAST_SENSE_RANGE : 22,
      leashRange: isBeastRole(actor.role) ? BEAST_LEASH_RANGE : 60,
    }).shouldPursue

    const groupShare = localGroupShare(actor, actors, HARNESS_MORALE_RADIUS, actorPoint)
    const morale = evaluateMorale(actor.role, {
      hpFraction: actor.hp / Math.max(1, actor.maxHp),
      groupShare,
      packShare: beastPackShare(actor, actors, WOLF_PACK_RADIUS, actorPoint),
      commanderNearby: false,
      commanderLost: false,
      alarmDistance: Number.POSITIVE_INFINITY,
    })
    if (morale !== 'none' && actor.routTimer <= 0) actor.routTimer = HARNESS_ROUT_SECONDS
    if (actor.routTimer > 0) {
      actor.routTimer = Math.max(0, actor.routTimer - delta)
      // A routed actor *leaves*. The `aiHarness.ts` warning in this file's header is
      // exactly about this branch degenerating into standing still.
      moveActor(actor, actor.x - (player.x - actor.x), actor.z - (player.z - actor.z), delta, collision)
      continue
    }

    const threat = selectThreat(
      actor,
      actors,
      24,
      actorPoint,
      pursuit
        ? {
            position: playerPoint,
            hpFraction: player.health / Math.max(1, player.maxHealth),
            provoked: actor.playerAggro,
          }
        : null,
    )

    let targetX = actor.x
    let targetZ = actor.z
    let targetIsPlayer = false
    let target: HarnessActor | null = null
    if (threat === THREAT_PLAYER) {
      targetX = player.x
      targetZ = player.z
      targetIsPlayer = true
    } else if (threat) {
      target = threat as HarnessActor
      targetX = target.x
      targetZ = target.z
      actor.targetId = target.id
    } else {
      continue
    }

    const distance = Math.hypot(targetX - actor.x, targetZ - actor.z)
    const contactRange = targetIsPlayer ? HARNESS_PLAYER_CONTACT : 2.45

    if (actor.actionPhase !== 'idle') {
      actor.actionRemaining -= delta
      if (actor.actionRemaining <= 0) {
        if (actor.actionPhase === 'windup') {
          const connected =
            isWithinContact(distance, contactRange) && actor.reaction !== 'stagger'
          // Roadmap 1.1's signal 2 and signal 3, both counted at the one moment that can
          // answer them: a telegraph either reached the player or it did not.
          if (actor.actionTargetIsPlayer) {
            if (actor.telegraphHeavy && !connected) {
              context.melee.telegraphedHeaviesAvoided += 1
            }
            if (actor.clearAttempted && !connected) {
              context.melee.windupClears[actor.role] =
                (context.melee.windupClears[actor.role] ?? 0) + 1
            }
            if (connected && context.playerCommitted) {
              context.melee.hitsWhileCommitted += 1
            }
          }
          if (connected) {
            if (targetIsPlayer) {
              const base = rollMeleeDamage(actor.role, 'player', () => combatRng.next())
              const hit = resolvePlayerDamage({
                baseDamage: base,
                health: player.health,
                shieldActive: false,
                hasIncomingDirection: true,
                incomingDotAim: 0,
                armor: playerArmor(context.faction),
              })
              if (hit.applied) {
                player.health = Math.max(0, player.health - hit.dealt)
                context.onPlayerHit(actor, hit.dealt)
              }
            } else if (target) {
              const base = rollMeleeDamage(actor.role, 'actor', () => combatRng.next())
              const hit = resolveActorDamage({
                target,
                baseDamage: base,
                attackKind: 'allyMelee',
                facingDotToSource: null,
              })
              target.hp = Math.max(0, target.hp - hit.dealt)
              applyDamageReaction(target, hit, 'allyMelee')
              if (hit.killed) {
                target.alive = false
                target.deathAt = elapsed
              }
            }
          }
          actor.actionPhase = 'recovery'
          actor.actionRemaining = actionRecovery(actor.role)
        } else {
          actor.actionPhase = 'idle'
          actor.actionRemaining = 0
        }
      }
      continue
    }

    if (isWithinContact(distance, contactRange) && actor.attackCooldown <= 0) {
      actor.actionPhase = 'windup'
      actor.actionRemaining = actionWindup(actor.role)
      // `actionTargetIsPlayer` was declared and never written before 1.1. It is what makes
      // "a telegraph aimed at the player" a thing the harness can count, so it is written
      // here, at the one place a wind-up begins.
      actor.actionTargetIsPlayer = targetIsPlayer
      actor.actionTargetId = target?.id ?? null
      actor.clearAttempted = false
      actor.telegraphHeavy =
        targetIsPlayer && actionWindup(actor.role) >= HARNESS_HEAVY_WINDUP
      if (actor.telegraphHeavy) context.melee.telegraphedHeavies += 1
      actor.attackCooldown = actionCooldown(
        targetIsPlayer ? 'meleePlayer' : 'meleeActor',
        actor.role,
      )
      continue
    }
    if (distance > contactRange) moveActor(actor, targetX, targetZ, delta, collision)
  }
}

function moveActor(
  actor: HarnessActor,
  targetX: number,
  targetZ: number,
  delta: number,
  collision: CollisionWorld,
): void {
  const dx = targetX - actor.x
  const dz = targetZ - actor.z
  const length = Math.hypot(dx, dz)
  if (length < 0.001) return
  const step = Math.min(actor.speed * delta, length)
  const moved = collision.resolveMovement(
    { x: actor.x, z: actor.z },
    { x: actor.x + (dx / length) * step, z: actor.z + (dz / length) * step },
    HARNESS_ACTOR_RADIUS,
  )
  actor.x = moved.x
  actor.z = moved.z
}

/** The night factor the chronicle read at a given moment, for reporting. */
export function harnessNightFactor(elapsed: number): number {
  return computeNightFactor(elapsed)
}

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

export interface SweepOptions {
  /** How many seeds to run. The roadmap's figure is 500. */
  seeds: number
  /** First seed; each subsequent one is `seed + index * stride`. */
  firstSeed?: number
  stride?: number
  /** Rotate through the three factions, or pin one. */
  faction?: Faction
  policy?: InputPolicy
  hz?: number
  timeLimit?: number
}

export interface SweepReport {
  seeds: number
  policy: InputPolicy
  hz: number
  outcomes: Record<RunOutcome, number>
  /** Share of runs that finished the campaign. */
  completionRate: number
  deathCauses: Record<DeathCause, number>
  medianElapsed: number
  medianDistanceWalked: number
  medianRegionsVisited: number
  /** Median simulated seconds to the first objective, over runs that reached it. */
  medianFirstObjectiveTime: number
  /** Median metres walked to the first objective. */
  medianFirstObjectiveDistance: number
  meanDamageTaken: number
  meanDamageDealt: number
  meanKills: number
  /** Damage taken per allegiance, summed over the sweep. */
  damageTakenByAllegiance: Record<string, number>
  totalChronicleEvents: number
  totalWitnessed: number
  totalOffScreen: number
  /** Share of chronicle history a player was in a position to see. */
  witnessShare: number
}

const FACTION_ROTATION: readonly Faction[] = ['elf', 'guard', 'villain']

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Runs a scripted policy over many seeds and aggregates the reports.
 *
 * Deterministic in the same way one run is: the seed sequence is arithmetic, every run
 * derives its own streams, and nothing consults the clock. Two calls with the same options
 * produce identical reports.
 */
export function sweepRuns(options: SweepOptions): SweepReport {
  const policy = options.policy ?? 'beeline'
  const hz = options.hz ?? 20
  const firstSeed = options.firstSeed ?? 1
  const stride = options.stride ?? 7919
  const outcomes: Record<RunOutcome, number> = { victory: 0, defeat: 0, timeout: 0 }
  const deathCauses: Record<DeathCause, number> = {
    beast: 0,
    faction: 0,
    bleeding: 0,
    none: 0,
  }
  const damageTakenByAllegiance: Record<string, number> = {}
  const elapsedValues: number[] = []
  const distanceValues: number[] = []
  const regionValues: number[] = []
  const firstObjectiveTimes: number[] = []
  const firstObjectiveDistances: number[] = []
  let damageTaken = 0
  let damageDealt = 0
  let kills = 0
  let chronicleEvents = 0
  let witnessed = 0
  let offScreen = 0

  for (let index = 0; index < options.seeds; index += 1) {
    const report = runHarness({
      seed: firstSeed + index * stride,
      faction: options.faction ?? FACTION_ROTATION[index % FACTION_ROTATION.length],
      policy,
      hz,
      ...(options.timeLimit === undefined ? {} : { timeLimit: options.timeLimit }),
    })
    outcomes[report.outcome] += 1
    deathCauses[report.deathCause] += 1
    elapsedValues.push(report.elapsed)
    distanceValues.push(report.distanceWalked)
    regionValues.push(report.regionsVisited)
    const first = report.objectives[0]
    if (first?.completedAt !== null && first !== undefined) {
      firstObjectiveTimes.push(first.completedAt)
      firstObjectiveDistances.push(first.distanceWalked)
    }
    damageTaken += report.damageTaken.total
    damageDealt += report.damageDealt.total
    kills += report.kills
    chronicleEvents += report.eventExposure.chronicleEvents
    witnessed += report.eventExposure.witnessed
    offScreen += report.eventExposure.offScreen
    for (const [allegiance, amount] of Object.entries(report.damageTaken.byAllegiance)) {
      damageTakenByAllegiance[allegiance] =
        (damageTakenByAllegiance[allegiance] ?? 0) + amount
    }
  }

  return {
    seeds: options.seeds,
    policy,
    hz,
    outcomes,
    completionRate: options.seeds === 0 ? 0 : outcomes.victory / options.seeds,
    deathCauses,
    medianElapsed: median(elapsedValues),
    medianDistanceWalked: median(distanceValues),
    medianRegionsVisited: median(regionValues),
    medianFirstObjectiveTime: median(firstObjectiveTimes),
    medianFirstObjectiveDistance: median(firstObjectiveDistances),
    meanDamageTaken: options.seeds === 0 ? 0 : damageTaken / options.seeds,
    meanDamageDealt: options.seeds === 0 ? 0 : damageDealt / options.seeds,
    meanKills: options.seeds === 0 ? 0 : kills / options.seeds,
    damageTakenByAllegiance,
    totalChronicleEvents: chronicleEvents,
    totalWitnessed: witnessed,
    totalOffScreen: offScreen,
    witnessShare: chronicleEvents === 0 ? 0 : witnessed / chronicleEvents,
  }
}
