import * as THREE from 'three'
import { AudioDirector, type SoundCue, type SoundRequest } from './AudioDirector'
import { musicIntensityRank, type MusicIntensity } from './MusicScore.ts'
import { BloomPostProcessor } from './BloomPostProcessor'
import {
  AchievementTracker,
  type AchievementSummary,
  type AchievementView,
} from './achievements'
import {
  GeometryCache,
  StylizedArtLibrary,
  bakeOutlineNormals,
  extrudeProfile,
  hashUnit,
  latheProfile,
  loftProfile,
  mergeAll,
  rectProfile,
  taperedBox,
  transformed,
  tubeAlongPoints,
  type OutlineBinding,
  type OutlineKind,
  type StylizedSurface,
} from './art/index.ts'
import {
  CAMERA_BASE_FOV,
  CAMERA_FOLLOW_DAMPING,
  CAMERA_FOV_DAMPING,
  KILL_ACCENT_RANGE,
  SPRINT_BLEND_DAMPING,
  advanceAirborneState,
  advanceCameraAccents,
  advanceJumpAccentLatch,
  composeCameraFov,
  dampValue,
  dampingAlpha,
  queueCameraAccent as enqueueCameraAccent,
  type CameraAccent,
  type CameraAccentKind,
} from './cameraAccents'
import {
  ABILITY_INFO,
  MAX_HEALTH_PER_LEVEL,
  MAX_STAMINA_PER_LEVEL,
  MAX_THREAT_TIER,
  type ActorRole,
  type Allegiance,
  type BeastRole,
  type BodyPart,
  type BodyState,
  type ChronicleEntryView,
  type Faction,
  type GameCallbacks,
  type GameView,
  type LootRarity,
  type LootReward,
  type LootRewardKind,
  type LootToastView,
  type HatchMotif,
  type MapMarker,
  type NoticeTone,
  type Objective,
  type ShopItem,
  type UpgradeLevels,
  type ChronicleWorldEventKind,
  type RandomWorldEventKind,
  type WorldEventKind,
  type ZoneId,
  RANDOM_WORLD_EVENT_KINDS,
  allegianceRelation,
  areAllegiancesHostile,
  createAbilityView,
  createHealthyBody,
  getMaxHealth,
  getMaxStamina,
  getShopItemPrice,
  getThreatTier,
  isBeastRole,
  isFactionAllegiance,
  isRandomWorldEventKind,
  normalizeUpgradeLevels,
} from './types'
import {
  createGeneratedEncounterPlans,
  createGeneratedEncounterPlan,
  type GeneratedEncounterPlan,
} from './content/registry'
import {
  chronicleEventTone,
  createGeneratedObjectiveText,
  describeBeastProwler,
  describeCaravanPlundered,
  describeChronicleEvent,
  describeCivilianDeath,
  describeEventHandback,
  describeLocatedEvent,
  describeLocatedEventOutcome,
  describeLocatedEventStart,
  describeRout,
  describeVillageLife,
  formatRegionGridLabel,
  formatRussianCount,
  generatedSiteLabel,
  RALLY_NOTICE,
  WORLD_EVENT_FAILURE_MESSAGES,
  type LocatedEventCopyContext,
} from './content/gameCopy'
import { RandomStream } from './random/RandomStream'
import { deriveSeed } from './random/seed'
import { getStartingBoonEffects } from './run/profile'
import {
  STARTING_SQUAD_VERSION,
  getSquadFollowSpeed,
  getStartingSquad,
  shouldInitializeStartingSquad,
  shouldSquadRegroup,
} from './squadMovement'
import {
  ACTIVE_RUN_SAVE_VERSION,
  type ActiveRunSaveV3,
  type RunCompanionState,
  type RunConfig,
  type RunStatus,
  type SerializableState,
} from './run/runTypes'
import { normalizeActiveRunSaveV3 } from './run/storage'
import {
  GeneratedWorldRuntime,
  type GeneratedWorldRuntimeDebugSnapshot,
} from './world/GeneratedWorldRuntime'
import { generateWorld } from './world/WorldGenerator'
import {
  ACTOR_BUDGET_PRIORITY,
  ActorBudget,
  MAX_ACTORS,
  createActorBudgetUsage,
  type ActorBudgetCategory,
  type ActorBudgetUsage,
} from './world/ActorBudget'
import {
  CHRONICLE_TICK_SECONDS,
  cloneChronicleState,
  cloneRegionChronicleState,
  createChronicleRegions,
  createChronicleState,
  createRegionChronicleState,
  getChronicleProtectedRegionIds,
  getContestedRegionIds,
  getSupplyPriceMultiplier,
  isProtectedSite,
  isRegionRazed,
  isSettlementSite,
  resolveMaterializedBeastRaid,
  resolveMaterializedCaravan,
  resolveMaterializedRaid,
  resolveMaterializedWarband,
  tickChronicle,
  type ChronicleEvent,
  type ChronicleState,
  type RegionChronicleState,
} from './world/Chronicle'
import {
  findPendingMaterializations,
  type PendingMaterialization,
} from './world/Materialization'
import {
  AMBIENT_BEAST_LIMIT,  AMBIENT_BEAST_PRESSURE,
  BEAST_LEASH_RANGE,
  BEAST_PROFILES,
  BEAST_ROUT_SECONDS,
  BEAST_SENSE_RANGE,
  BOAR_CHARGE_COOLDOWN,
  BOAR_CHARGE_DAMAGE,
  BOAR_CHARGE_DURATION,
  BOAR_CHARGE_RANGE,
  BOAR_CHARGE_SPEED,
  BOAR_CHARGE_WINDUP,
  WOLF_PACK_RADIUS,
  planAmbientBeast,
  planBeastPack,
} from './world/Fauna'
import {
  THREAT_PLAYER,
  acceptsAlert,
  beastPackShare,
  engagementRank,
  evaluateMorale,
  evaluatePlayerPursuit,
  findCivilianAlarm,
  flankApproachAngle,
  flankBlend,
  isPacifistRole,
  localGroupShare,
  playerEngagementRank,
  selectThreat,
  type AiAlert,
  type AiPoint,
  type CivilianAlarm,
  type MoraleBreak,
  type PlayerThreat,
} from './world/ActorAi'
import {
  AMBIENT_CIVILIAN_LIMIT,
  BIRD_CLIMB_SPEED,
  BIRD_CRUISE_SPEED,
  BIRD_FLIGHT_SECONDS,
  BIRD_SPRINT_STARTLE_BONUS,
  BIRD_STARTLE_RADIUS,
  CAMPFIRE_GATHER_RADIUS,
  CAMPFIRE_LIMIT,
  CAMPFIRE_NIGHT_THRESHOLD,
  CAMPFIRE_SEARCH_INTERVAL,
  CAMPFIRE_SMOKE_INTERVAL,
  CIVILIAN_ALARM_RADIUS,
  CIVILIAN_HOME_RADIUS,
  CIVILIAN_INTERVAL,
  CIVILIAN_MENACE_SECONDS,
  CIVILIAN_PANIC_RECOVERY,
  CIVILIAN_PANIC_SECONDS,
  CIVILIAN_PANIC_SPEED_MULTIPLIER,
  CIVILIAN_SPAWN_RADIUS,
  CROW_CORPSE_DELAY,
  CROW_CORPSE_RADIUS,
  DEER_BOLT_SECONDS,
  DEER_BOLT_SPEED,
  DEER_GRAZE_SPEED,
  DEER_SPRINT_STARTLE_BONUS,
  DEER_STARTLE_RADIUS,
  WILDLIFE_BIRD_LIMIT,
  WILDLIFE_DEER_LIMIT,
  WILDLIFE_DESPAWN_RADIUS,
  WILDLIFE_INTERVAL,
  WILDLIFE_SPAWN_MAX_RADIUS,
  WILDLIFE_SPAWN_MIN_RADIUS,
  civilianRoutine,
  fleeDirection,
  planCivilianCount,
  planWildlife,
  shouldStartle,
  weatherHunch,
  weatherPaceMultiplier,
  type WildlifeKind,
} from './world/AmbientLife'
import {
  REGION_DELTA_VERSION,
  type RegionDelta,
} from './world/RegionRuntime'
import {
  WORLD_GENERATOR_VERSION,
  type FactionObjectiveNode,
  type Territory,
  type WorldBlueprint,
} from './world/worldTypes'
import {
  WEATHER_BY_ZONE,
  WEATHER_KINDS,
  advanceWeatherMix,
  computeNightFactor,
  computeStormFactor,
  computeSunAngle,
  createChronicleEnvironment,
  createWeatherMix,
  smoothstep,
  snapWeatherMix,
  type WeatherKind,
  type WeatherMix,
} from './world/WorldEnvironment'
import {
  ZONE_ART_IDS,
  type ZoneVisualWeights,
} from './zoneArt'

export type FoliageQuality = 'off' | 'low' | 'high'

export interface GeneratedRunLaunch {
  runId: string
  config: RunConfig
  startedAt: string
  restored?: ActiveRunSaveV3
}

export interface GameEngineSettings {
  musicMuted: boolean
  sfxVolume: number
  dynamicDayNight: boolean
  weatherEnabled: boolean
  bloomEnabled: boolean
  inkOutlinesEnabled: boolean
  screenShakeEnabled: boolean
  foliageQuality: FoliageQuality
  achievementRunId: string
  generatedRun: GeneratedRunLaunch
}

export type GameEngineOptions = Partial<Omit<GameEngineSettings, 'generatedRun'>> &
  Pick<GameEngineSettings, 'generatedRun'>


type ActorAiMode = 'normal' | 'captive' | 'attackEventProp'
type ActorActionKind = 'meleePlayer' | 'meleeActor' | 'eventProp' | 'arrow'
type ActorActionPhase = 'windup' | 'recovery'
type HitReactionKind = 'none' | 'flinch' | 'stagger'
type DeathStyle = 'sideFall' | 'backFall' | 'spinFall' | 'launchFall'
type TelegraphKind = 'tick' | 'aim' | 'commander' | 'wedge'

/**
 * Layer 4 — what a commander tells the people around him to do. `hold` keeps a garrison
 * on its site instead of drifting off after wander targets, `assault` walks a raid onto
 * the thing it came for, and `escort` sticks to a moving caravan.
 */
type SquadOrderKind = 'hold' | 'assault' | 'escort'

interface SquadOrder {
  kind: SquadOrderKind
  /** Where the order points. A live object for `escort`, a fixed point otherwise. */
  position: THREE.Vector3
  /** Seconds left before an unrefreshed order lapses. */
  timer: number
}

interface EventPropTarget {
  id: string
  ownerId: string
  object: THREE.Object3D
  hp: number
  maxHp: number
  position: THREE.Vector3
  attackRange: number
}

interface ActorAction {
  kind: ActorActionKind
  phase: ActorActionPhase
  elapsed: number
  duration: number
  target:
    | { kind: 'player' }
    | { kind: 'actor'; id: string }
    | { kind: 'eventProp'; id: string }
  targetPosition: THREE.Vector3
  contactRange: number
}

interface CharacterPose {
  stride: number
  attack: number
  anticipation: number
  recovery: number
  flinch: number
  stagger: number
}

interface TelegraphEntry {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  ownerId: string | null
  priority: number
  kind: TelegraphKind
}

interface Actor {
  id: string
  /**
   * §5.3 — the side this actor is on, which is not always a faction. Every hostility
   * decision reads this, never a faction comparison.
   */
  allegiance: Allegiance
  role: ActorRole
  mesh: THREE.Group
  hp: number
  maxHp: number
  speed: number
  alive: boolean
  attackCooldown: number
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  wanderTimer: number
  targetId: string | null
  stride: number
  phase: number
  velocity: THREE.Vector3
  gaitPhase: number
  visualSpeed: number
  motionBlend: number
  turnLean: number
  idleTimer: number
  wanderPace: number
  retreatTimer: number
  reinforcementTimer: number
  reinforcementsCalled: number
  objectiveEligible: boolean
  squadEligible: boolean
  aiMode: ActorAiMode
  eventOwnerId: string | null
  eventPropTargetId: string | null
  ignoredTargetId: string | null
  playerAggro: boolean
  aggroMemory: number
  lastKnownTargetPos: THREE.Vector3 | null
  rageTimer: number
  alertCooldown: number
  retaliationTimer: number
  healthBar: THREE.Sprite
  healthBarCanvas: HTMLCanvasElement
  healthBarTexture: THREE.CanvasTexture
  healthBarVisibleUntil: number
  outlineBinding: OutlineBinding
  outlineUntil: number
  action: ActorAction | null
  reaction: HitReactionKind
  reactionRemaining: number
  poise: number
  maxPoise: number
  poiseRecoveryDelay: number
  staggerImmunity: number
  knockbackVelocity: THREE.Vector3
  lastHitDirection: THREE.Vector3
  deathStyle: DeathStyle | null
  deathAge: number
  deathStartPosition: THREE.Vector3
  deathStartRotation: THREE.Euler
  deathTravelled: number
  deathAt: number | null
  generatedRegionId: string | null
  generatedEncounterId: string | null
  generatedSpawnId: string | null
  generatedObjectiveId: string | null
  generatedUnique: boolean
  hostileToPlayer: boolean
  budgetCategory: ActorBudgetCategory
  /** Layer 3 — set on beasts that belong to one pack, so they can break together. */
  packId: string | null
  /** Original pack size, so `shouldBeastRout` measures against what set out. */
  packKinSize: number
  /** Seconds of running left before a routed beast is willing to look back. */
  routTimer: number
  /** Layer 4 — why it broke, so a rout reads differently from a rally. */
  routReason: MoraleBreak
  /** Layer 4 — morale immunity after a commander steadies it, or after it recovers. */
  rallyTimer: number
  /** Layer 4 — seconds left of the shock of watching its commander fall. */
  commanderLostTimer: number
  /** Layer 4 — staggered so morale is not recomputed for 25 actors every frame. */
  moraleTimer: number
  /** Layer 4 — the standing order from a nearby commander, if any. */
  order: SquadOrder | null
  /**
   * Layer 4 — where an ally said it saw something, and how long that is worth walking to.
   *
   * Deliberately **not** `lastKnownTargetPos`. That field is the player's breadcrumb and
   * is wiped every frame an actor is not pursuing the player, which is exactly the state
   * an alerted bystander is in — writing an alert there made the whole mechanism inert,
   * and in the one case it survived it corrupted a pursuer's memory of the player.
   */
  alertPos: THREE.Vector3 | null
  alertTimer: number
  /**
   * Layer 5 — where the thing a bystander is running from was standing.
   *
   * Separate from `alertPos` for the same reason `alertPos` is separate from
   * `lastKnownTargetPos`: an alert is a place worth *walking to*, and this is a place
   * worth putting your back to. Sharing one field would have the villager investigate
   * the wolf.
   */
  alarmPos: THREE.Vector3 | null
  /** Boar charge state machine: wind-up, then a committed straight line. */
  chargeWindup: number
  chargeTimer: number
  chargeCooldown: number
  chargeDirection: THREE.Vector3
}

/**
 * Layer 5 — a deer or a bird. **Deliberately not an `Actor`.**
 *
 * The design list called this "non-combat wildlife", and a thing that cannot be fought
 * does not need hit points, an allegiance, a health bar, a morale check, a threat score
 * or — the expensive one — a slot out of `MAX_ACTORS`. It needs a mesh and a reason to
 * run away. Keeping it off the actor list is what lets Layer 5 add visible life to every
 * square without ever taking a slot a raid might have wanted.
 */
interface WildlifeProp {
  kind: WildlifeKind
  mesh: THREE.Group
  velocity: THREE.Vector3
  /** Seconds of bolting or flying left. Zero means grazing or perched. */
  panicTimer: number
  wanderTimer: number
  /** Deterministic per-prop offset for gait and flap, seeded at spawn. */
  phase: number
  regionId: string | null
  /** A crow that came for this body, so it leaves when the body does. */
  perchActorId: string | null
  /** Set when the prop has taken itself out of play — a bird that flew off. */
  strayed: boolean
  home: THREE.Vector3
}

/** Layer 5 — a lit fire and the light it throws. A prop: no actor, no budget. */
interface Campfire {
  group: THREE.Group
  light: THREE.PointLight
  flame: THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>
  position: THREE.Vector3
  siteId: string
  smokeTimer: number
}

interface ActorSpawnOptions {
  /** §5.1 — which reserved slice of `MAX_ACTORS` this actor is charged against. */
  budget: ActorBudgetCategory
  objectiveEligible?: boolean
  squadEligible?: boolean
  aiMode?: ActorAiMode
  eventOwnerId?: string | null
  eventPropTargetId?: string | null
  ignoredTargetId?: string | null
  generatedRegionId?: string | null
  generatedEncounterId?: string | null
  generatedSpawnId?: string | null
  generatedObjectiveId?: string | null
  generatedUnique?: boolean
  hostileToPlayer?: boolean
  healthScale?: number
  packId?: string | null
  packKinSize?: number
}

interface GeneratedNavigationCacheEntry {
  expiresAt: number
  waypoints: ReadonlyArray<readonly [number, number]> | null
}

interface ActorKillContext {
  killerAllegiance: Allegiance
  directPlayerKill: boolean
}

interface InteractableOutlineBinding {
  binding: OutlineBinding
  positionRoot: THREE.Object3D
}

interface WorldEvent {
  id: string
  kind: WorldEventKind
  /**
   * §5.2 — `player` events sit in a ring around the player, `located` ones belong to a
   * site or region and are handed back to the chronicle when that region streams out.
   */
  anchor: 'player' | 'located'
  regionId: string | null
  /** Pending-materialization id, so one chronicle situation runs one event. */
  situationId: string | null
  /** Chronicle actor slots this event holds. */
  slots: number
  state: 'active' | 'succeeded' | 'failed'
  title: string
  description: string
  tone: NoticeTone
  timer: number | null
  progress: number
  target: number
  markerId: string
  markerPos: THREE.Vector3
  ownedActorIds: string[]
  ownedProps: THREE.Object3D[]
  update?(delta: number): void
  onKill?(actor: Actor, context: ActorKillContext): void
  onInteract?(): boolean
  getPrompt?(): string | null
  /** Folds the live fight back into chronicle state instead of cancelling it. */
  handBack?(): ChronicleEvent[]
  cleanup(): void
}

type WorldEventConfig = Omit<
  WorldEvent,
  'cleanup' | 'anchor' | 'regionId' | 'situationId' | 'slots'
> &
  Partial<Pick<WorldEvent, 'anchor' | 'regionId' | 'situationId' | 'slots'>>

interface Palette {
  bg: THREE.Color
  elevated: THREE.Color
  surface: THREE.Color
  soft: THREE.Color
  border: THREE.Color
  borderStrong: THREE.Color
  text: THREE.Color
  muted: THREE.Color
  accent: THREE.Color
  success: THREE.Color
  danger: THREE.Color
  warning: THREE.Color
  link: THREE.Color
  accentFg: THREE.Color
  worldSky: THREE.Color
  worldHorizon: THREE.Color
  worldFog: THREE.Color
  worldAmbientGround: THREE.Color
  worldSun: THREE.Color
  worldNeutralGround: THREE.Color
  worldPalaceGround: THREE.Color
  worldForestGround: THREE.Color
  worldFortGround: THREE.Color
}

interface DayNightKeyframe {
  sun: THREE.Color
  sky: THREE.Color
  fog: THREE.Color
  hemisphereSky: THREE.Color
  hemisphereGround: THREE.Color
  skyTint: THREE.Color
  sunIntensity: number
  hemisphereIntensity: number
}

interface DayNightKeyframes {
  night: DayNightKeyframe
  twilight: DayNightKeyframe
  day: DayNightKeyframe
}

interface WeatherProfile {
  fogNear: number
  fogFar: number
  sunScale: number
  hemisphereScale: number
  cloudOpacity: number
  skyBrightness: number
  desaturation: number
  windStrength: number
  celestialScale: number
}

interface GroundSurface {
  material: THREE.MeshStandardMaterial
  baseColor: THREE.Color
  baseRoughness: number
}

interface SurfaceTextureOptions {
  pattern: 'grass' | 'dirt' | 'stone' | 'scree' | 'wood' | 'roof'
  repeatX: number
  repeatY: number
  hatch?: {
    motif: HatchMotif
    density: number
    angle: number
    opacity: number
    color: THREE.Color
  }
}

interface ZoneArtProfile {
  id: ZoneId
  primary: THREE.Color
  secondary: THREE.Color
  accent: THREE.Color
  ink: THREE.Color
  hatch: {
    motif: HatchMotif
    density: number
    angle: number
    opacity: number
  }
  fogTint: THREE.Color
  fogWeight: number
}

interface ZoneDecorationSet {
  mesh: THREE.InstancedMesh
  zone: ZoneId
  collidable: false
}

interface BuildingWindowGlow {
  material: THREE.MeshStandardMaterial
  legacyIntensity: number
}

interface FoliageOccluder {
  root: THREE.LOD
  material: THREE.MeshStandardMaterial
  radius: number
  centerY: number
}

interface Particle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  initialLife?: number
  baseScale?: THREE.Vector3
  splatScale?: number
  pooled?: boolean
  eventId?: string
  mode?: 'smoke' | 'spark' | 'blood' | 'gib'
}

type LootPickupState = 'burst' | 'idle' | 'magnet'
type LootCollectionReason = 'magnet' | 'save' | 'victory' | 'pool'

interface LootRarityMaterials {
  token: THREE.MeshBasicMaterial
  beam: THREE.MeshBasicMaterial
  ring: THREE.MeshBasicMaterial
  star: THREE.SpriteMaterial
}

interface LootPickup {
  root: THREE.Group
  display: THREE.Group
  tokenRoot: THREE.Group
  tokens: Record<LootRewardKind, THREE.Group>
  beams: [THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>]
  smoothRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  segmentedRing: THREE.Group
  outerRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  starburst: THREE.Sprite
  reward: LootReward
  state: LootPickupState
  velocity: THREE.Vector3
  age: number
  idleAge: number
  active: boolean
  serial: number
}

interface LootCollectionBurst {
  root: THREE.Group
  shards: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>[]
  directions: THREE.Vector3[]
  active: boolean
  age: number
  serial: number
}

type DecalKind = 'blood' | 'scorch'

interface Decal {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  age: number
  lifetime: number
  serial: number
  active: boolean
}

interface Projectile {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  owner: 'player' | 'actor'
  allegiance: Allegiance
  damage: number
  sourceActorId: string | null
  travelled: number
  detachChance: number
}

interface ProjectileHit {
  fraction: number
  actor: Actor | null
  player: boolean
}

type AttackKind = 'melee' | 'cleave' | 'arrow' | 'allyMelee' | 'actorArrow'
type HitWeight = 'normal' | 'heavy' | 'lethal' | 'blocked'
type ComicCallout = 'БАЦ!' | 'ХРЯСЬ!' | 'БУМ!' | 'БЛОК!'

interface DamageResult {
  applied: boolean
  dealt: number
  killed: boolean
  weight: HitWeight
  position: THREE.Vector3
  direction: THREE.Vector3
}

interface CombatFeedbackEvent extends DamageResult {
  attackKind: AttackKind
  targetId: string | 'player'
  directPlayerAction: boolean
}

interface DamageActorOptions {
  attackKind: AttackKind
  detachChance?: number
  knockback?: number
  sourceActorId?: string
  deferFeedback?: boolean
}

interface DamagePlayerOptions {
  attackKind: AttackKind
}

interface DamageNumberFx {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  material: THREE.SpriteMaterial
  targetId: string | 'player' | null
  attackKind: AttackKind | null
  value: number
  weight: HitWeight
  age: number
  mergeAge: number
  lifetime: number
  velocity: THREE.Vector3
  active: boolean
  priority: number
}

interface ComicCalloutFx {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  word: ComicCallout | null
  age: number
  lifetime: number
  velocity: THREE.Vector3
  active: boolean
  priority: number
}

interface ImpactRayFx {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  age: number
  lifetime: number
  active: boolean
  priority: number
  weight: HitWeight
}

interface CombatFeedbackChannels {
  number?: boolean
  callout?: boolean
  ray?: boolean
  hitStop?: boolean
  camera?: boolean
  sound?: boolean
}

interface WindState {
  direction: THREE.Vector2
  strength: number
}

const PLAYER_COLLIDER_RADIUS = 0.64
const ACTOR_COLLIDER_RADIUS = 0.56
const LARGE_ACTOR_COLLIDER_RADIUS = 0.72
const COLLISION_MAX_STEP = 0.32
const NPC_STEERING_ANGLES = [0, 0.55, -0.55, 1.05, -1.05, 1.55, -1.55] as const
const NPC_ACCELERATION_DAMPING = 6.5
const NPC_BRAKING_DAMPING = 11
const NPC_BLOCKED_SPEED_RATIO = 0.22
const GENERATED_NAVIGATION_CELL_SIZE = 2
const GENERATED_NAVIGATION_CACHE_TTL = 0.45
const GENERATED_NAVIGATION_CACHE_LIMIT = 96
const GENERATED_CARAVAN_COLLIDER_RADIUS = 1.4
const GENERATED_CARAVAN_PATROL_NEAR = 6
const GENERATED_CARAVAN_PATROL_FAR = 28
const CHRONICLE_MAX_CATCHUP_TICKS = 8
const CHRONICLE_FEED_LIMIT = 8
const LOOT_DROP_CHANCE = 0.3
const LOOT_MAX_ACTIVE = 20
const LOOT_BURST_TIME = 0.45
const LOOT_FORCE_MAGNET_AGE = 15
const LOOT_MAGNET_RADIUS = 5.5
const LOOT_COLLECT_RADIUS = 0.8
const LOOT_MAGNET_ACCEL = 34
const LOOT_MAGNET_MAX_SPEED = 22
const LOOT_TOAST_TIME = 2.4
const LOOT_Y = 0.34
const LOOT_DAMAGE_CAP = 60
const LOOT_COLLECTION_BURST_COUNT = 8
const LOOT_COLLECTION_BURST_TIME = 0.42
const LOOT_RARITY_RANK: Record<LootRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  legendary: 3,
}
const LOOT_BEAM_HEIGHT: Record<LootRarity, number> = {
  common: 1.6,
  uncommon: 2.6,
  rare: 4.2,
  legendary: 6.5,
}
const OUTLINE_ACTOR_DISTANCE_SQ = 38 * 38
const OUTLINE_INTERACTABLE_DISTANCE_SQ = 46 * 46
/** §08 — shadow and rim budget. See `docs/08-graphics-foundation-spec.md`. */
const SHADOW_MAP_SIZE = 2048
const SHADOW_FRUSTUM_HALF_EXTENT = 52
const RIM_LIGHT_BASE = 0.92
const OUTLINE_CORPSE_SECONDS = 8
const OUTLINE_PLAYER_HIDE_DISTANCE_SQ = 2.4 * 2.4
const FIRST_EVENT_AT = 30
const EVENT_COOLDOWN_MIN = 50
const EVENT_COOLDOWN_MAX = 70
const EVENT_RETRY = 10
const THREAT_WAVE_FIRST_AT = 240
const THREAT_WAVE_MIN_INTERVAL = 70
const CORPSE_LIFETIME = 12
const CHAMPION_DAMAGE_CAP = 18
const DEFEND_HOME_MAX_DISTANCE = 95
const BOW_DAMAGE = 18
const BOW_MIN_DAMAGE = 10
const BOW_RANGE = 30
const BOW_SPEED = 24
const ACTOR_ARROW_DAMAGE = 7
const ACTOR_ARROW_SPEED = 16
const ARCHER_MIN_RANGE = 8
const ARCHER_MAX_RANGE = 12
const ARCHER_FIRE_COOLDOWN = 1.8
const PROJECTILE_HIT_RADIUS = 0.9
const PROJECTILE_GRAVITY = 1.6
const SHIELD_DAMAGE_MULTIPLIER = 0.15
const SHIELD_STAMINA_DRAIN = 18
const SHIELD_SPEED_MULTIPLIER = 0.5
const SHIELD_FRONT_DOT = 0.2
const CLEAVE_DAMAGE_MULTIPLIER = 1.1
const CLEAVE_RADIUS = 4.5
const CLEAVE_ARC_DOT = 0.5
const CLEAVE_DASH_DISTANCE = 3
const CLEAVE_KNOCKBACK_DISTANCE = 3
const SCOUT_RETREAT_DURATION = 0.62
const AGGRO_MEMORY_DURATION = 6
const RAGE_DURATION = 5
const RAGE_SPEED_MULTIPLIER = 1.35
const RAGE_DAMAGE_BONUS = 3
const RAGE_COOLDOWN_MULTIPLIER = 0.7
const RAGE_RANGE_BONUS = 6
const ALERT_RADIUS = 14
const ALERT_COOLDOWN = 1.5
/** Yaw axis, shared so flanking does not allocate a vector per actor per frame. */
const WORLD_UP = new THREE.Vector3(0, 1, 0)
/**
 * Layer 4 — how far a sighting of *any* hostile carries. Wider than `ALERT_RADIUS`,
 * which only ever covered "the player just hit me": a fight starting on the far side of
 * a settlement should reach the garrison, and 20 m is about one square's courtyard.
 */
const ALERT_SIGHTING_RADIUS = 20
/** How long an actor will keep walking toward a place an ally shouted about. */
const ALERT_INVESTIGATE_SECONDS = 12
/** Close enough to see for itself; the alert has done its job and is dropped. */
const ALERT_ARRIVAL_DISTANCE = 3
const NPC_RETALIATION_DURATION = 4
const MUSIC_STATE_SAMPLE_INTERVAL = 0.2
const MUSIC_INTENSITY_HOLD: Readonly<Record<MusicIntensity, number>> = {
  explore: 0,
  alert: 3,
  combat: 5,
  boss: 8,
}
const COMMANDER_AURA_RANGE = 10
const COMMANDER_SPEED_MULTIPLIER = 1.15
const COMMANDER_DAMAGE_BONUS = 4
const COMMANDER_REINFORCEMENT_INTERVAL = 25
const COMMANDER_REINFORCEMENT_LIMIT = 4
/** Layer 4 — how far a commander's standing order and his rally reach. */
const COMMANDER_ORDER_RANGE = 18
/** How long an order survives without being renewed, so a dead commander stops giving them. */
const COMMANDER_ORDER_DURATION = 6
/** Close enough to the order post; beyond this the ally walks back to it. */
const COMMANDER_ORDER_TOLERANCE = 3.5
/** Seconds an ally is steadied for after being rallied or after recovering on its own. */
const MORALE_RALLY_SECONDS = 12
/** How long the shock of a commander going down lasts. */
const MORALE_COMMANDER_SHOCK_SECONDS = 10
/** Seconds a broken faction actor runs before it turns round and fights again. */
const MORALE_ROUT_SECONDS = 7
/** How far an actor looks for the friends and bodies that decide its morale. */
const MORALE_GROUP_RADIUS = 14
/** Morale is a decision, not an animation: 25 actors do not need it every frame. */
const MORALE_CHECK_INTERVAL = 0.35
/** How close a broken faction actor has to get to its rally point to feel safe again. */
const MORALE_RALLY_POINT_TOLERANCE = 3
/** With the rally point already overrun there is nowhere to fall back to: turn quickly. */
const MORALE_LAST_STAND_SECONDS = 2
/** Morale notices are for what the player can see; past this it is just bookkeeping. */
const MORALE_NOTICE_RANGE = 45
const MORALE_NOTICE_COOLDOWN = 9
/**
 * §5C.6 — the caravan belongs to the palace guard, which is why the guard faction cannot
 * rob it and everyone else can. Naming it once keeps the hostility question a matrix
 * lookup instead of three separate faction comparisons.
 */
const CARAVAN_ALLEGIANCE: Allegiance = 'guard'
/** Guards that walk with the cart. Two: enough to lose, few enough to be lost. */
const CARAVAN_ESCORT_COUNT = 2
/** How long a dead guard stays dead before the road office sends another. */
const CARAVAN_ESCORT_RESPAWN_DELAY = 25
/** Beyond this the escort is despawned — nobody is there to see it. */
const CARAVAN_ESCORT_RANGE = 90
/** How close something hostile has to get before the driver whips the horses. */
const CARAVAN_PANIC_RANGE = 16
const CARAVAN_PANIC_SECONDS = 4
const CARAVAN_PANIC_SPEED_MULTIPLIER = 1.7
/** A guard this close to the cart is still guarding it. */
const CARAVAN_GUARDED_RANGE = 7
/** A raider this close to an unguarded cart takes it. */
const CARAVAN_PLUNDER_RANGE = 3.4
/** How long a plundered cart stays empty. Longer than a player robbery: it was taken. */
const CARAVAN_PLUNDER_COOLDOWN = 55
const BRUTE_FRONTAL_DAMAGE_MULTIPLIER = 0.5
const BRUTE_FRONT_DOT = 0.2
const FLINCH_TIME = 0.12
const POISE_REGEN_DELAY = 0.75
const POISE_RECOVERY_PER_SECOND = 22
const STAGGER_IMMUNITY = 0.45
const KNOCKBACK_DAMPING = 11
const KNOCKBACK_MAX_SPEED = 11
const KNOCKBACK_STEER_THRESHOLD = 0.8
const LARGE_ROLE_KNOCKBACK_SCALE = 0.55
const TELEGRAPH_MAX = 8
const TELEGRAPH_Y = 0.055
const CONTACT_RANGE_FORGIVENESS = 0.35
const DEATH_POSE_TIME = 0.24
const REDUCED_MOTION_COMBAT_SCALE = 0.6
const HIGH_KNOCKBACK_THRESHOLD = 2.5
const SHAKE_POSITION = 0.22
const SHAKE_ROLL = 0.012
const SHAKE_DECAY = 2.1
const SHAKE_FREQUENCY = 24
const TRAUMA_CLEAVE = 0.42
const TRAUMA_BLOCK = 0.08
const TRAUMA_DEATH_MAX = 0.16
const TRAUMA_DEATH_RANGE = 12
const FLASH_MIN = 0.25
const FLASH_MAX = 0.85
const FLASH_BLOCK_MAX = 0.12
const FLASH_DECAY = 2.4
const SPARK_COUNT_BLOCK = 7
const SPARK_COUNT_CLEAVE = 5
const SPARK_LIFE = 0.24
const SPARK_MAX_ACTIVE = 48
const DAMAGE_NUMBER_MAX = 24
const DAMAGE_NUMBER_LIFE = 0.72
const DAMAGE_NUMBER_DISTANCE_SQ = 30 * 30
const NUMBER_MERGE_WINDOW = 0.09
const CALLOUT_MAX = 10
const CALLOUT_LIFE = 0.46
const CALLOUT_COOLDOWN = 0.12
const IMPACT_RAY_MAX = 16
const IMPACT_RAY_LIFE = 0.18
const HIT_STOP_NORMAL = 0.028
const HIT_STOP_HEAVY = 0.048
const HIT_STOP_LETHAL = 0.064
const HIT_STOP_CLEAVE = 0.058
const HIT_STOP_BLOCK = 0.024
const HIT_STOP_REDUCED_MAX = 0.02
const HIT_WEIGHT_PRIORITY: Record<HitWeight, number> = {
  normal: 0,
  heavy: 1,
  blocked: 2,
  lethal: 3,
}
const COMIC_CALLOUTS: Record<
  ComicCallout,
  { points: number; innerRadius: number; rotation: number }
> = {
  'БАЦ!': { points: 11, innerRadius: 0.55, rotation: 0 },
  'ХРЯСЬ!': { points: 15, innerRadius: 0.43, rotation: 0.08 },
  'БУМ!': { points: 9, innerRadius: 0.62, rotation: -0.1 },
  'БЛОК!': { points: 12, innerRadius: 0.7, rotation: Math.PI / 12 },
}
const GORE_HIT_MIN = 14
const GORE_HIT_MAX = 30
const GORE_PLAYER_HIT_MIN = 18
const GORE_PLAYER_HIT_MAX = 36
const GORE_DEATH_COUNT = 52
const GORE_LARGE_DEATH_COUNT = 72
const GORE_MAX_ACTIVE = 180
const GORE_GROUND_Y = 0.08
const GORE_COLORS = [0xff1744, 0xb00020, 0xff5f7a, 0x760014] as const
const DECAL_MAX = 72
const DECAL_Y = 0.025
const DECAL_FADE = 6
const BLOOD_DECAL_LIFE = 34
const SCORCH_DECAL_LIFE = 28
const BLEED_FX_INTERVAL = 1.25
const ZONE_TINT_DAMPING = 3.5
const SUN_ARC_RADIUS = 90
const SUN_ARC_HEIGHT = 70
const SUN_ARC_DEPTH = 40
const CELESTIAL_DISC_DISTANCE = 150
const MIN_SHADOW_LIGHT_HEIGHT = 8
const STAR_COUNT = 180
const TWO_PI = Math.PI * 2
const DEFAULT_WIND_STRENGTH = 0.25
const MAX_WIND_STRENGTH = 1.5
const WEATHER_PROFILES: Record<WeatherKind, WeatherProfile> = {
  clear: {
    fogNear: 48,
    fogFar: 132,
    sunScale: 1,
    hemisphereScale: 1,
    cloudOpacity: 0.3,
    skyBrightness: 1,
    desaturation: 0,
    windStrength: DEFAULT_WIND_STRENGTH,
    celestialScale: 1,
  },
  overcast: {
    fogNear: 32,
    fogFar: 96,
    sunScale: 0.48,
    hemisphereScale: 0.78,
    cloudOpacity: 0.76,
    skyBrightness: 0.82,
    desaturation: 0.42,
    windStrength: 0.58,
    celestialScale: 0.4,
  },
  rain: {
    fogNear: 18,
    fogFar: 72,
    sunScale: 0.22,
    hemisphereScale: 0.62,
    cloudOpacity: 0.94,
    skyBrightness: 0.7,
    desaturation: 0.62,
    windStrength: 1.15,
    celestialScale: 0.12,
  },
  snow: {
    fogNear: 24,
    fogFar: 82,
    sunScale: 0.42,
    hemisphereScale: 0.76,
    cloudOpacity: 0.86,
    skyBrightness: 0.88,
    desaturation: 0.5,
    windStrength: 0.78,
    celestialScale: 0.26,
  },
}
const BASE_CLOUD_OPACITY = 0.58
const RAIN_DROP_COUNT = 420
const SNOW_FLAKE_COUNT = 300
const PRECIPITATION_HALF_WIDTH = 24
const PRECIPITATION_HALF_DEPTH = 20
const PRECIPITATION_TOP = 25
const PRECIPITATION_GROUND = 0.08
const RAIN_FALL_SPEED = 34
const RAIN_STREAK_LENGTH = 2.2
const RAIN_WIND_SPEED = 2.4
const SNOW_FALL_SPEED = 5.4
const SNOW_WIND_SPEED = 1.2
const SNOW_DRIFT_SPEED = 0.65
const LIGHTNING_MIN_INTERVAL = 8
const LIGHTNING_MAX_INTERVAL = 22
const LIGHTNING_FLASH_DURATION = 0.18
const LIGHTNING_INTENSITY = 5.5
const THUNDER_MIN_DELAY = 0.35
const THUNDER_MAX_DELAY = 1.1
const GROUND_WET_DARKEN = 0.78
const GROUND_WET_ROUGHNESS = 0.48
const GROUND_FROST_BLEND = 0.24

const EVENT_WEIGHTS: Record<Faction, Record<RandomWorldEventKind, number>> = {
  elf: {
    richCaravan: 5,
    defendHome: 1,
    champion: 2,
    rescue: 3,
    bounty: 2,
  },
  guard: {
    richCaravan: 1,
    defendHome: 5,
    champion: 2,
    rescue: 3,
    bounty: 3,
  },
  villain: {
    richCaravan: 2,
    defendHome: 1,
    champion: 5,
    rescue: 2,
    bounty: 3,
  },
}

const EVENT_REQUIRED_SLOTS: Record<WorldEventKind, number> = {
  richCaravan: 3,
  defendHome: 4,
  champion: 1,
  rescue: 3,
  bounty: 1,
  factionRaid: 5,
  caravanAmbush: 4,
  warband: 3,
  aftermath: 2,
  beastRaid: 5,
}

/** How many located chronicle events may run alongside the player-anchored one. */
const MAX_LOCATED_EVENTS = 2
/** A located event stays put once placed; this is how far from the player it may start. */
const LOCATED_EVENT_MAX_DISTANCE = 150
const LOCATED_EVENT_MIN_DISTANCE = 26
const LOCATED_EVENT_SCATTER = 9
/** A stalled located fight is handed back to the chronicle rather than left standing. */
const LOCATED_EVENT_TIMEOUT = 150
const MATERIALIZE_INTERVAL = 6
/** A located fight this close to the player counts as "the player's problem". */
const THREAT_WAVE_EVENT_RADIUS = 45

const LOCATED_EVENT_REWARDS: Record<ChronicleWorldEventKind, number> = {
  factionRaid: 110,
  caravanAmbush: 140,
  warband: 80,
  aftermath: 45,
  beastRaid: 95,
}

/** Layer 3 — how many of a beast raid's slots go to the settlement's own garrison. */
const BEAST_RAID_DEFENDERS = 2
/** Ambient prowlers are only worth spawning within this radius of the player. */
const AMBIENT_BEAST_RADIUS = 62
/** Seconds between ambient-prowler considerations. Cheap, but not per frame. */
const AMBIENT_BEAST_INTERVAL = 11

function dampAngle(current: number, target: number, smoothing: number, delta: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + difference * (1 - Math.exp(-smoothing * delta))
}

function readCssColor(token: string): THREE.Color {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(token).trim())
}

function createPalette(): Palette {
  return {
    bg: readCssColor('--cp-bg'),
    elevated: readCssColor('--cp-bg-elevated'),
    surface: readCssColor('--cp-surface'),
    soft: readCssColor('--cp-surface-soft'),
    border: readCssColor('--cp-border'),
    borderStrong: readCssColor('--cp-border-strong'),
    text: readCssColor('--cp-text'),
    muted: readCssColor('--cp-text-muted'),
    accent: readCssColor('--cp-accent'),
    success: readCssColor('--cp-success'),
    danger: readCssColor('--cp-danger'),
    warning: readCssColor('--cp-warning'),
    link: readCssColor('--cp-link'),
    accentFg: readCssColor('--cp-accent-fg'),
    worldSky: readCssColor('--game-sky'),
    worldHorizon: readCssColor('--game-horizon'),
    worldFog: readCssColor('--game-fog'),
    worldAmbientGround: readCssColor('--game-ambient-ground'),
    worldSun: readCssColor('--game-sun'),
    worldNeutralGround: readCssColor('--game-neutral-ground'),
    worldPalaceGround: readCssColor('--game-palace-ground'),
    worldForestGround: readCssColor('--game-forest-ground'),
    worldFortGround: readCssColor('--game-fort-ground'),
  }
}

function mix(a: THREE.Color, b: THREE.Color, amount: number): THREE.Color {
  return a.clone().lerp(b, amount)
}

function createZoneArtProfiles(palette: Palette): Record<ZoneId, ZoneArtProfile> {
  const ink = mix(palette.text, palette.bg, 0.2)
  return {
    neutral: {
      id: 'neutral',
      primary: palette.worldNeutralGround.clone(),
      secondary: mix(palette.warning, palette.success, 0.42),
      accent: mix(palette.warning, palette.surface, 0.18),
      ink: ink.clone(),
      hatch: { motif: 'scrape', density: 7, angle: -0.08, opacity: 0.13 },
      fogTint: mix(palette.worldFog, palette.warning, 0.35),
      fogWeight: 0.055,
    },
    palace: {
      id: 'palace',
      primary: palette.worldPalaceGround.clone(),
      secondary: mix(palette.link, palette.bg, 0.28),
      accent: mix(palette.warning, palette.surface, 0.12),
      ink: ink.clone(),
      hatch: { motif: 'chevron', density: 8, angle: 0, opacity: 0.12 },
      fogTint: mix(palette.worldFog, palette.link, 0.26),
      fogWeight: 0.045,
    },
    forest: {
      id: 'forest',
      primary: palette.worldForestGround.clone(),
      secondary: mix(palette.success, palette.warning, 0.18),
      accent: mix(palette.warning, palette.danger, 0.12),
      ink: ink.clone(),
      hatch: { motif: 'organic', density: 9, angle: 0.18, opacity: 0.14 },
      fogTint: mix(palette.worldFog, palette.success, 0.34),
      fogWeight: 0.075,
    },
    fort: {
      id: 'fort',
      primary: palette.worldFortGround.clone(),
      secondary: mix(palette.danger, palette.warning, 0.28),
      accent: mix(palette.accent, palette.danger, 0.44),
      ink: ink.clone(),
      hatch: { motif: 'slash', density: 10, angle: -0.62, opacity: 0.16 },
      fogTint: mix(palette.worldFog, palette.accent, 0.35),
      fogWeight: 0.09,
    },
  }
}

function createDayNightKeyframes(palette: Palette): DayNightKeyframes {
  const white = new THREE.Color(1, 1, 1)
  return {
    night: {
      sun: mix(palette.worldSun, palette.worldFog, 0.7),
      sky: mix(palette.worldSky, palette.worldFog, 0.45).multiplyScalar(0.22),
      fog: palette.worldFog.clone().multiplyScalar(0.35),
      hemisphereSky: mix(palette.worldSky, palette.worldFog, 0.65).multiplyScalar(0.68),
      hemisphereGround: palette.worldAmbientGround.clone().multiplyScalar(0.52),
      skyTint: mix(palette.worldSky, palette.worldFog, 0.45).multiplyScalar(0.28),
      sunIntensity: 0.15,
      hemisphereIntensity: 0.9,
    },
    twilight: {
      sun: mix(palette.worldSun, palette.danger, 0.35),
      sky: mix(palette.worldSky, palette.warning, 0.4),
      fog: mix(palette.worldFog, palette.warning, 0.3),
      hemisphereSky: mix(palette.worldSky, palette.warning, 0.2),
      hemisphereGround: mix(palette.worldAmbientGround, palette.warning, 0.22),
      skyTint: mix(white, palette.warning, 0.22),
      sunIntensity: 1.4,
      hemisphereIntensity: 1,
    },
    day: {
      sun: palette.worldSun.clone(),
      sky: palette.worldSky.clone(),
      fog: palette.worldFog.clone(),
      hemisphereSky: palette.worldSky.clone(),
      hemisphereGround: palette.worldAmbientGround.clone(),
      skyTint: white,
      sunIntensity: 2.65,
      hemisphereIntensity: 1.65,
    },
  }
}

function interpolateKeyframes(
  night: number,
  twilight: number,
  day: number,
  nightToTwilight: number,
  twilightToDay: number,
): number {
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(night, twilight, nightToTwilight),
    day,
    twilightToDay,
  )
}

/**
 * Character shapes.
 *
 * Each of these is built once and shared by every actor that needs it. Gloves and
 * boots are lofted into the arm and leg rather than parented as extra meshes, so a
 * person still costs the same number of draw calls it did when it was seven boxes.
 * Every part gets welded outline normals, because the ink shells extrude along them
 * and a merged hard-edged prop cracks open without them.
 */
function buildCharacterTorso(player: boolean): THREE.BufferGeometry {
  const width = player ? 1.05 : 0.9
  const geometry = loftProfile({
    profile: rectProfile(width, 0.58, 0.11),
    sections: [
      { y: -0.65, scaleX: 0.82, scaleZ: 0.86 },
      { y: -0.42, scaleX: 0.88, scaleZ: 0.9 },
      // A slight bulge at the waist reads as a belt once the bands land on it.
      { y: -0.3, scaleX: 0.96, scaleZ: 0.98 },
      { y: -0.19, scaleX: 0.9, scaleZ: 0.92 },
      { y: 0.22, scaleX: 1, scaleZ: 1 },
      { y: 0.5, scaleX: 1.03, scaleZ: 0.94 },
      { y: 0.65, scaleX: 0.7, scaleZ: 0.68 },
    ],
    name: 'character-torso',
  })
  return bakeOutlineNormals(geometry)
}

function buildCharacterHead(): THREE.BufferGeometry {
  const geometry = loftProfile({
    profile: rectProfile(0.72, 0.68, 0.17),
    sections: [
      { y: -0.43, scaleX: 0.4, scaleZ: 0.46 },
      { y: -0.3, scaleX: 0.74, scaleZ: 0.82 },
      { y: -0.04, scaleX: 1, scaleZ: 1 },
      { y: 0.24, scaleX: 0.97, scaleZ: 0.95 },
      { y: 0.43, scaleX: 0.56, scaleZ: 0.58 },
    ],
    name: 'character-head',
  })
  return bakeOutlineNormals(geometry)
}

function buildHoodedHead(): THREE.BufferGeometry {
  const geometry = latheProfile(
    [
      { x: 0.001, y: -0.46 },
      { x: 0.34, y: -0.46 },
      { x: 0.44, y: -0.34 },
      { x: 0.45, y: -0.05 },
      { x: 0.38, y: 0.18 },
      { x: 0.22, y: 0.36 },
      { x: 0.06, y: 0.5 },
      { x: 0.001, y: 0.54 },
    ],
    { segments: 9, name: 'character-hood' },
  )
  return bakeOutlineNormals(geometry)
}

function buildCharacterArm(): THREE.BufferGeometry {
  const geometry = loftProfile({
    profile: rectProfile(0.28, 0.3, 0.055),
    sections: [
      { y: -0.59, scaleX: 0.95, scaleZ: 1.02 },
      { y: -0.45, scaleX: 1.02, scaleZ: 1.16 },
      { y: -0.34, scaleX: 0.6, scaleZ: 0.62 },
      { y: -0.1, scaleX: 0.8, scaleZ: 0.82 },
      { y: 0.16, scaleX: 0.88, scaleZ: 0.9 },
      { y: 0.45, scaleX: 1.02, scaleZ: 1.02 },
      { y: 0.59, scaleX: 0.9, scaleZ: 0.9 },
    ],
    name: 'character-arm',
  })
  return bakeOutlineNormals(geometry)
}

function buildCharacterLeg(): THREE.BufferGeometry {
  const geometry = loftProfile({
    profile: rectProfile(0.36, 0.42, 0.06),
    sections: [
      { y: -0.56, scaleX: 0.9, scaleZ: 1, offsetZ: 0.06 },
      { y: -0.46, scaleX: 1, scaleZ: 1.14, offsetZ: 0.05 },
      { y: -0.33, scaleX: 0.86, scaleZ: 0.8 },
      { y: -0.05, scaleX: 0.78, scaleZ: 0.76 },
      { y: 0.2, scaleX: 0.88, scaleZ: 0.86 },
      { y: 0.56, scaleX: 1, scaleZ: 0.98 },
    ],
    name: 'character-leg',
  })
  return bakeOutlineNormals(geometry)
}

function buildCharacterBlade(): THREE.BufferGeometry {
  const blade = extrudeProfile(
    [
      { x: 0, y: 0.82 },
      { x: -0.075, y: 0.58 },
      { x: -0.07, y: -0.18 },
      { x: -0.05, y: -0.3 },
      { x: 0.05, y: -0.3 },
      { x: 0.07, y: -0.18 },
      { x: 0.075, y: 0.58 },
    ],
    { depth: 0.1, bevelSize: 0.015, name: 'blade' },
  )
  const guard = transformed(
    taperedBox({
      width: 0.36,
      height: 0.09,
      depth: 0.15,
      topScale: 0.82,
      bevel: 0.025,
    }),
    { position: { x: 0, y: -0.32, z: 0 } },
  )
  const grip = transformed(
    taperedBox({ width: 0.08, height: 0.32, depth: 0.095, bevel: 0.02 }),
    { position: { x: 0, y: -0.52, z: 0 } },
  )
  const pommel = transformed(
    taperedBox({
      width: 0.14,
      height: 0.12,
      depth: 0.13,
      topScale: 0.6,
      bottomScale: 0.6,
      bevel: 0.03,
    }),
    { position: { x: 0, y: -0.72, z: 0 } },
  )
  return bakeOutlineNormals(
    mergeAll([blade, guard, grip, pommel], { name: 'character-blade' }),
  )
}

function buildCharacterHelmet(): THREE.BufferGeometry {
  const dome = latheProfile(
    [
      { x: 0.001, y: -0.26 },
      { x: 0.4, y: -0.26 },
      { x: 0.56, y: -0.22 },
      { x: 0.5, y: -0.16 },
      { x: 0.42, y: -0.03 },
      { x: 0.3, y: 0.11 },
      { x: 0.14, y: 0.2 },
      { x: 0.001, y: 0.25 },
    ],
    { segments: 8, name: 'helmet-dome' },
  )
  const nasal = transformed(
    taperedBox({
      width: 0.09,
      height: 0.3,
      depth: 0.1,
      topScale: 1.4,
      bevel: 0.02,
    }),
    { position: { x: 0, y: -0.2, z: 0.42 } },
  )
  return bakeOutlineNormals(mergeAll([dome, nasal], { name: 'character-helmet' }))
}

function buildCharacterHorn(): THREE.BufferGeometry {
  const geometry = tubeAlongPoints(
    [
      { x: 0, y: -0.32, z: 0 },
      { x: 0.05, y: -0.08, z: 0.02 },
      { x: 0.15, y: 0.14, z: 0.02 },
      { x: 0.3, y: 0.3, z: -0.03 },
    ],
    {
      radius: (t) => 0.115 * (1 - t) + 0.012,
      radialSegments: 6,
      tubularSegments: 9,
      capStart: true,
      name: 'character-horn',
    },
  )
  return bakeOutlineNormals(geometry)
}

function buildCharacterShield(): THREE.BufferGeometry {
  const board = extrudeProfile(
    [
      { x: -0.39, y: 0.575 },
      { x: -0.39, y: 0.1 },
      { x: -0.3, y: -0.2 },
      { x: 0, y: -0.575 },
      { x: 0.3, y: -0.2 },
      { x: 0.39, y: 0.1 },
      { x: 0.39, y: 0.575 },
    ],
    { depth: 0.12, bevelSize: 0.028, name: 'shield-board' },
  )
  const boss = transformed(
    latheProfile(
      [
        { x: 0.001, y: 0 },
        { x: 0.16, y: 0.01 },
        { x: 0.13, y: 0.07 },
        { x: 0.001, y: 0.1 },
      ],
      { segments: 8, name: 'shield-boss' },
    ),
    { rotation: { x: -Math.PI / 2, y: 0, z: 0 }, position: { x: 0, y: 0.06, z: 0.08 } },
  )
  return bakeOutlineNormals(mergeAll([board, boss], { name: 'character-shield' }))
}

function seededRandom(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

/**
 * §5.3 — the one hostility question in the engine. `hostile(a, b) => a !== b` could not
 * express wildlife, civilians, or truces; the matrix can.
 */
function hostile(a: Allegiance, b: Allegiance): boolean {
  return areAllegiancesHostile(a, b)
}

/** §5D — how far the shared torch light reaches, and where on the bearer it sits. */
const TORCH_LIGHT_RANGE = 26
const TORCH_LIGHT_OFFSET = new THREE.Vector3(0, 1.7, 0)

/**
 * §5D — who is out at night with a light in their hand.
 *
 * The rank and file of the three sides, and nobody else: a commander has both hands on
 * his authority, a brute or a champion would look absurd holding a candle, a beast has
 * no hands, and a villager is standing at the fire rather than walking away from it.
 */
function carriesTorch(role: ActorRole, allegiance: Allegiance): boolean {
  if (!isFactionAllegiance(allegiance)) return false
  return role === 'soldier' || role === 'scout' || role === 'minion'
}

/** Where `world/ActorAi.ts` reads an actor's position from. `Vector3` is an `AiPoint`. */
function actorPosition(actor: Actor): AiPoint {
  return actor.mesh.position
}

function formatPart(part: BodyPart): string {
  const names: Record<BodyPart, string> = {
    leftArm: 'левая рука',
    rightArm: 'правая рука',
    leftLeg: 'левая нога',
    rightLeg: 'правая нога',
    leftEye: 'левый глаз',
    rightEye: 'правый глаз',
  }
  return names[part]
}

function foliageQualityDensity(quality: FoliageQuality): number {
  return quality === 'off' ? 0 : quality === 'low' ? 0.55 : 1
}

function generatedMaximumBonus(
  savedMaximum: number | undefined,
  baseMaximum: number,
  configuredBonus: number,
): number {
  const maximum = savedMaximum ?? baseMaximum + configuredBonus
  return Math.max(0, maximum - baseMaximum)
}

export class GameEngine {
  private readonly container: HTMLElement
  private readonly callbacks: GameCallbacks
  private readonly faction: Faction
  private readonly generatedRun: GeneratedRunLaunch
  private readonly generatedWorld: GeneratedWorldRuntime
  private readonly generatedBlueprint: WorldBlueprint
  private readonly generatedEncounterPlans = new Map<string, GeneratedEncounterPlan[]>()
  private readonly generatedActivationSpawns = new Map<string, Set<string>>()
  private readonly simulatedGeneratedRegions = new Set<string>()
  /** §5.1 — the single gate every actor spawn passes through. */
  private readonly actorBudget = new ActorBudget((category, count) =>
    this.yieldActorSlots(category, count),
  )
  private readonly generatedCaravanTravelDirection = new THREE.Vector2(1, 0)
  private readonly generatedCaravanPatrolStart = new THREE.Vector3()
  private readonly generatedCaravanPatrolEnd = new THREE.Vector3()
  private readonly generatedNavigationCache = new Map<
    string,
    GeneratedNavigationCacheEntry
  >()
  private readonly chronicleRegions: Map<string, RegionChronicleState>
  private readonly chronicleProtectedRegionIds: ReadonlySet<string>
  private readonly chronicleEncounterPlanControl = new Map<string, Territory>()
  private readonly chronicleRazedSiteIds = new Set<string>()
  private chronicleContestedRegionIds: ReadonlySet<string> = new Set<string>()
  private readonly scorchedMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2320,
    roughness: 0.95,
    metalness: 0,
  })
  private scorchedMaterialAdopted = false
  private chronicleState: ChronicleState
  private chronicleAccumulator = 0
  private chronicleFeedSignature = ''
  private chronicleFeed: ChronicleEntryView[] = []
  private activeShopPriceMultiplier = 1
  private generatedCameraRegionSignature = ''
  private generatedNavigationRegionSignature = ''
  private generatedCaravanPatrolReady = false
  private generatedRunStatus: RunStatus = 'active'
  private generatedSupplyCount = 0
  private generatedHealthBonus = 0
  private generatedStaminaBonus = 0
  private readonly achievements: AchievementTracker
  private readonly palette: Palette
  private readonly zoneArtProfiles: Record<ZoneId, ZoneArtProfile>
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_BASE_FOV, 1, 0.1, 240)
  private readonly renderer: THREE.WebGLRenderer
  private readonly postProcessor: BloomPostProcessor
  private readonly artLibrary: StylizedArtLibrary
  /** Shape cache shared by every actor: one buffer per shape, not one per actor. */
  private readonly artGeometry = new GeometryCache()
  private readonly clock = new THREE.Clock()
  private readonly keys = new Set<string>()
  private readonly actors: Actor[] = []
  private readonly particles: Particle[] = []
  private readonly decals: Decal[] = []
  private readonly projectiles: Projectile[] = []
  private readonly eventPropTargets = new Map<string, EventPropTarget>()
  private readonly telegraphPool: TelegraphEntry[] = []
  private readonly telegraphGeometries = new Map<TelegraphKind, THREE.BufferGeometry>()
  private readonly damageNumberFx: DamageNumberFx[] = []
  private readonly comicCalloutFx: ComicCalloutFx[] = []
  private readonly impactRayFx: ImpactRayFx[] = []
  private readonly projectileSourcesToClear = new Set<string>()
  private readonly generatedTextures = new Map<string, THREE.CanvasTexture>()
  private readonly outlineBindings: OutlineBinding[] = []
  private readonly interactableOutlineBindings: InteractableOutlineBinding[] = []
  private readonly clouds: Array<{ group: THREE.Group; speed: number }> = []
  private readonly flames: THREE.Mesh[] = []
  private readonly torchLights: THREE.PointLight[] = []
  private readonly buildingWindowGlows: BuildingWindowGlow[] = []
  private readonly backgroundColor = new THREE.Color()
  private readonly zoneVisualWeights: ZoneVisualWeights = {
    neutral: 1,
    palace: 0,
    forest: 0,
    fort: 0,
  }
  private readonly zoneTintTarget = new THREE.Color()
  private readonly zoneTintColor = new THREE.Color()
  private zoneTintWeight = 0
  private readonly zoneDecorationSets: ZoneDecorationSet[] = []
  private readonly zoneArtMaterials = new Map<ZoneId, THREE.MeshStandardMaterial>()
  private readonly fog: THREE.Fog
  private readonly dayNightKeyframes: DayNightKeyframes
  private sun!: THREE.DirectionalLight
  /** Non-shadowing back-rim. Follows the sun's opposite; see `setupLights`. */
  private rimLight!: THREE.DirectionalLight
  private hemisphere!: THREE.HemisphereLight
  private atmosphereRoot!: THREE.Group
  private skyMaterial!: THREE.MeshBasicMaterial
  private sunDisc!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private moonDisc!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private stars!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private cloudMaterial!: THREE.MeshBasicMaterial
  private readonly cloudBaseColor = new THREE.Color()
  private readonly groundSurfaces = new Map<ZoneId, GroundSurface>()
  private readonly weatherGray = new THREE.Color()
  private readonly weatherFrostColor = new THREE.Color()
  private rain!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private snow!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private lightningLight!: THREE.HemisphereLight
  private readonly rainPositions = new Float32Array(RAIN_DROP_COUNT * 6)
  private readonly snowPositions = new Float32Array(SNOW_FLAKE_COUNT * 3)
  private readonly snowDriftPhases = new Float32Array(SNOW_FLAKE_COUNT)
  private readonly cameraRaycaster = new THREE.Raycaster()
  private readonly cameraFollowPosition = new THREE.Vector3()
  private readonly cameraObstacles: THREE.Object3D[] = []
  private readonly foliageOccluders: FoliageOccluder[] = []
  private readonly wind: WindState = {
    direction: new THREE.Vector2(1, 0.2).normalize(),
    strength: DEFAULT_WIND_STRENGTH,
  }
  private readonly collisionProbe = new THREE.Vector3()
  private readonly navigationWaypoint = new THREE.Vector3()
  private readonly generatedRngStreams: Record<
    'combat' | 'director' | 'event' | 'loot' | 'chronicle',
    RandomStream
  >
  private readonly eventRng: () => number
  private readonly directorRng: () => number
  private readonly combatRng: () => number
  private readonly weatherRng = seededRandom(((Date.now() + 7919) % 2147483646) + 1)
  private readonly lootRng: () => number
  private readonly lootMaterials: Record<LootRarity, LootRarityMaterials>
  private readonly lootPickups: LootPickup[] = []
  private readonly lootCollectionBursts: LootCollectionBurst[] = []
  private readonly lootTarget = new THREE.Vector3()
  private readonly lootDirection = new THREE.Vector3()
  private readonly player: THREE.Group
  private readonly playerOutline: OutlineBinding
  private readonly weaponTrail: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private readonly caravan: THREE.Group
  private objectives: Objective[]
  private body: BodyState
  private health = 100
  private maxHealth = 100
  private stamina = 100
  private maxStamina = 100
  private gold = 55
  private kills = 0
  private damage = 26
  private upgrades: UpgradeLevels
  private elapsed = 0
  private campaignCompleted = false
  private threatTier = 1
  private nextThreatWaveAt = THREAT_WAVE_FIRST_AT
  private paused = false
  private ended = false
  private verticalVelocity = 0
  private onGround = true
  private airborneTime = 0
  private jumpAccentArmed = true
  private isSprinting = false
  private cameraYaw = 0
  private cameraPitch = 0.38
  private readonly cameraAccents: CameraAccent[] = []
  private sprintFovBlend = 0
  private cameraAccentOffset = 0
  private currentFov = CAMERA_BASE_FOV
  private trauma = 0
  private shakeClock = 0
  private damageFlash = 0
  private bleedFxCooldown = 0
  private activeSparks = 0
  private activeGore = 0
  private decalSequence = 0
  private attackCooldown = 0
  private attackAnimation = 0
  private activePlayerAttackKind: AttackKind = 'melee'
  private abilityCooldown = 0
  private shieldActive = false
  private lastViewAt = 0
  private lastZone: ZoneId
  private weatherZone: ZoneId
  private weatherTarget: WeatherKind = 'clear'
  // Simulation state, not a render buffer: it keeps tracking the biome under the player
  // even while weather rendering is switched off, so the chronicle sees the same world
  // either way. Only the visuals are gated on `weatherEnabled`.
  private readonly weatherWeights: WeatherMix = createWeatherMix('clear')
  private lightningCooldown = LIGHTNING_MIN_INTERVAL
  private lightningFlash = 0
  private thunderDelay = -1
  private prompt = ''
  private squadFollowing = false
  private caravanDirection = 1
  private caravanCooldown = 0
  private caravanRobbedFlash = 0
  /** §5C.6 — the guards walking with the cart, on the `ambient` reserve. */
  private caravanEscortIds: string[] = []
  /** Seconds of bolting left after something hostile came near the road. */
  private caravanPanicTimer = 0
  /** Elapsed time before which a killed escort is not replaced. */
  private caravanEscortRespawnAt = 0
  /** Rate limit for rout and rally notices, so a squad breaking is one line, not five. */
  private moraleNoticeCooldown = 0
  private readonly activeEvents: WorldEvent[] = []
  /** Copy context per located event, so its outcome line matches the one that opened it. */
  private readonly locatedEventCopy = new Map<string, LocatedEventCopyContext>()
  /** Chronicle situations already standing in 3D, so one never starts twice. */
  private readonly materializedSituationIds = new Set<string>()
  private readonly seenAftermathRegionIds = new Set<string>()
  private materializeCooldown = MATERIALIZE_INTERVAL
  /** Layer 3 — throttles the ambient prowler check and remembers where one was seen. */
  private ambientBeastCooldown = AMBIENT_BEAST_INTERVAL
  private readonly announcedProwlerRegionIds = new Set<string>()
  /** Layer 5 — throttles the civilian headcount and remembers where one was announced. */
  private ambientCivilianCooldown = CIVILIAN_INTERVAL
  private readonly announcedVillageRegionIds = new Set<string>()
  /** Layer 5 — throttles the wildlife headcount. Props, not actors: no budget involved. */
  private ambientWildlifeCooldown = WILDLIFE_INTERVAL
  private readonly wildlife: WildlifeProp[] = []
  private readonly campfires: Campfire[] = []
  /** Layer 5 — throttles the campfire site search. See `updateCampfires`. */
  private campfireCooldown = 0
  /**
   * Layer 5 — how long the player stays frightening after swinging at something. This is
   * the only channel through which the *player* alarms a village, so walking through one
   * is safe and drawing steel in the square is not.
   */
  private civilianMenaceUntil = 0
  /**
   * Layer 5 — this frame's storm response, read once per frame from the simulation's
   * weather mix and never from `weatherEnabled`. Cached because the actor loop would
   * otherwise recompute it twenty-five times a frame for one number.
   */
  private ambientStormPace = 1
  private ambientStormHunch = 0
  /** Layer 5 — the simulation's night, which is not the renderer's. See `updateDayNight`. */
  private ambientNightFactor = 0
  /** Layer 5 — the single shared torch light. See `updateTorches`. */
  private torchLight: THREE.PointLight | null = null
  /** Routed beasts that left the field this frame; removed after the actor loop. */
  private readonly fledBeastIds: string[] = []
  private eventCooldown = FIRST_EVENT_AT
  private championDamageBonus = 0
  private eventSequence = 0
  private actorSequence = 0
  private readonly audio: AudioDirector
  private readonly audioListenerRight = new THREE.Vector3()
  private musicIntensity: MusicIntensity = 'explore'
  private musicIntensityReleaseAt = 0
  private nextMusicStateSampleAt = 0
  private lootSequence = 0
  private lootBurstSequence = 0
  private lootToastSequence = 0
  private lootToast: LootToastView | null = null
  private lootToastExpiresAt = 0
  private dynamicDayNight: boolean
  private weatherEnabled: boolean
  private inkOutlinesEnabled: boolean
  private screenShakeEnabled: boolean
  private readonly reducedMotion: boolean
  private groundFoliageQuality: FoliageQuality
  private nightFactor = 0
  private readonly inactiveGoreParticles: Particle[] = []
  private hitStopRemaining = 0
  private pendingCleaveHitStop = 0
  private calloutCooldown = 0
  private damageNumberSequence = 0
  private readonly pageHideAudioOwner = (event: PageTransitionEvent) => {
    if (!event.persisted) this.audio.destroy()
  }
  private resizeObserver: ResizeObserver
  private boundKeyDown: (event: KeyboardEvent) => void
  private boundKeyUp: (event: KeyboardEvent) => void
  private boundMouseMove: (event: MouseEvent) => void
  private boundMouseDown: (event: MouseEvent) => void
  private boundMouseUp: (event: MouseEvent) => void
  private boundContextMenu: (event: MouseEvent) => void
  private boundWindowBlur: () => void
  private boundPointerLock: () => void
  private boundVisibilityChange: () => void
  private frameHandle = 0

  constructor(
    container: HTMLElement,
    faction: Faction,
    callbacks: GameCallbacks,
    settings: GameEngineOptions,
  ) {
    this.container = container
    this.callbacks = callbacks
    this.faction = faction
    const launch = settings.generatedRun
    let restoredRun: ActiveRunSaveV3 | null = null
    if (
      launch.runId.trim().length === 0 ||
      !Number.isFinite(Date.parse(launch.startedAt)) ||
      !Number.isInteger(launch.config.seed) ||
      launch.config.seed < 0 ||
      launch.config.seed > 0xffffffff ||
      launch.config.selectedBoonId.trim().length === 0
    ) {
      throw new Error('Generated run launch metadata is malformed')
    }
    if (launch.config.generatorVersion !== WORLD_GENERATOR_VERSION) {
      throw new Error(
        `Unsupported generated world version: ${launch.config.generatorVersion}`,
      )
    }
    if (launch.config.faction !== faction) {
      throw new Error('Generated run faction does not match the GameEngine faction')
    }
    const blueprint = generateWorld(launch.config.seed)
    if (launch.restored) {
      restoredRun = normalizeActiveRunSaveV3(launch.restored)
      if (!restoredRun) throw new Error('Generated run save is malformed')
      if (restoredRun.status !== 'active') {
        throw new Error('Only an active generated run can be restored')
      }
      const launchModifiers = launch.config.modifiers ?? []
      const restoredModifiers = restoredRun.config.modifiers ?? []
      const sameConfig =
        restoredRun.runId === launch.runId &&
        restoredRun.config.seed === launch.config.seed &&
        restoredRun.config.generatorVersion === launch.config.generatorVersion &&
        restoredRun.config.faction === launch.config.faction &&
        restoredRun.config.selectedBoonId === launch.config.selectedBoonId &&
        launchModifiers.length === restoredModifiers.length &&
        launchModifiers.every(
          (modifier, index) => modifier === restoredModifiers[index],
        )
      if (!sameConfig) throw new Error('Generated run save does not match its launch config')
      if (restoredRun.blueprintFingerprint !== blueprint.fingerprint) {
        throw new Error('Generated run save has an incompatible world fingerprint')
      }
    }
    this.generatedRun = {
      runId: launch.runId,
      config: {
        ...launch.config,
        ...(launch.config.modifiers
          ? { modifiers: [...launch.config.modifiers] }
          : {}),
      },
      startedAt: restoredRun?.startedAt ?? launch.startedAt,
      ...(restoredRun ? { restored: restoredRun } : {}),
    }
    this.generatedBlueprint = blueprint
    this.audio = new AudioDirector({
      musicMuted: settings.musicMuted ?? false,
      sfxVolume: settings.sfxVolume,
      musicSeed: deriveSeed(launch.config.seed, `music:${faction}`),
    })
    this.achievements = new AchievementTracker((achievement) => {
      this.callbacks.onAchievementUnlocked(achievement)
      this.playSound('achievement')
    })
    if (
      restoredRun &&
      !this.achievements.restoreRun(restoredRun.achievementRunState)
    ) {
      throw new Error('Generated run achievement state is incompatible')
    }
    this.dynamicDayNight = settings.dynamicDayNight ?? true
    this.weatherEnabled = settings.weatherEnabled ?? true
    this.inkOutlinesEnabled = settings.inkOutlinesEnabled ?? true
    this.screenShakeEnabled = settings.screenShakeEnabled ?? true
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.groundFoliageQuality = settings.foliageQuality ?? 'high'
    this.palette = createPalette()
    // The art library has to exist before the world does: the generated world draws
    // its surfaces from the same material family as everything else, and handing it
    // this instance is what keeps one screenshot looking like one drawing.
    this.artLibrary = new StylizedArtLibrary({
      ink: {
        player: mix(this.palette.bg, this.palette.accent, 0.16),
        enemy: mix(this.palette.bg, this.palette.danger, 0.16),
        interactable: mix(this.palette.bg, this.palette.warning, 0.18),
        landmark: mix(this.palette.bg, this.palette.worldFog, 0.14),
      },
      rimColor: this.palette.worldSky,
      shadowTint: mix(this.palette.worldAmbientGround, this.palette.worldSky, 0.55),
      keyIntensity: 2.65,
    })
    this.generatedWorld = new GeneratedWorldRuntime(this.scene, blueprint, {
      decorationDensity: foliageQualityDensity(this.groundFoliageQuality),
      art: this.artLibrary,
      outlineDressing: this.inkOutlinesEnabled,
      palette: {
        terrain: {
          neutral: this.palette.worldNeutralGround,
          palace: this.palette.worldPalaceGround,
          forest: this.palette.worldForestGround,
          fort: this.palette.worldFortGround,
        },
        secondary: {
          neutral: mix(this.palette.warning, this.palette.success, 0.42),
          palace: mix(this.palette.accent, this.palette.warning, 0.3),
          forest: mix(this.palette.success, this.palette.link, 0.25),
          fort: mix(this.palette.danger, this.palette.muted, 0.42),
        },
        accent: {
          neutral: this.palette.warning,
          palace: this.palette.accent,
          forest: this.palette.success,
          fort: this.palette.danger,
        },
        road: mix(this.palette.worldNeutralGround, this.palette.text, 0.24),
        water: this.palette.link,
        bridge: mix(this.palette.warning, this.palette.text, 0.18),
        structure: this.palette.surface,
        roof: this.palette.elevated,
      },
    })
    if (restoredRun) {
      try {
        const applied = this.generatedWorld.regions.applyState({
          version: 1,
          discoveredRegionIds: restoredRun.discoveredRegionIds,
          deltas: restoredRun.regionDeltas,
        })
        if (!applied) throw new Error('Generated region state is incompatible')
      } catch (error) {
        try {
          this.generatedWorld.dispose()
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Generated run preflight and cleanup failed',
          )
        }
        throw error
      }
    }
    const streams = {
      combat: new RandomStream(deriveSeed(blueprint.seed, 'gameplay:combat')),
      director: new RandomStream(deriveSeed(blueprint.seed, 'gameplay:director')),
      event: new RandomStream(deriveSeed(blueprint.seed, 'gameplay:event')),
      loot: new RandomStream(deriveSeed(blueprint.seed, 'gameplay:loot')),
      chronicle: new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle')),
    }
    if (restoredRun) {
      for (const key of Object.keys(streams) as Array<keyof typeof streams>) {
        const state = restoredRun.rngStates[key]
        if (Number.isInteger(state) && state >= 0 && state <= 0xffffffff) {
          streams[key].setState(state)
        }
      }
    }
    this.generatedRngStreams = streams
    this.chronicleProtectedRegionIds = getChronicleProtectedRegionIds(blueprint)
    this.chronicleState = restoredRun
      ? cloneChronicleState(restoredRun.chronicleState)
      : createChronicleState()
    this.chronicleRegions = createChronicleRegions(blueprint)
    for (const region of blueprint.regions) {
      const regionId = String(region.id)
      const restoredChronicle =
        this.generatedWorld.regions.getRegionChronicle(regionId)
      if (restoredChronicle) this.chronicleRegions.set(regionId, restoredChronicle)
    }
    this.refreshChronicleRazedSites()
    this.chronicleContestedRegionIds = getContestedRegionIds(
      blueprint,
      this.chronicleRegions,
    )
    this.eventRng = () => streams.event.next()
    this.directorRng = () => streams.director.next()
    this.combatRng = () => streams.combat.next()
    this.lootRng = () => streams.loot.next()
    for (const plan of Object.values(createGeneratedEncounterPlans(blueprint, faction))) {
      const regionKey = String(plan.regionId)
      const plans = this.generatedEncounterPlans.get(regionKey) ?? []
      plans.push(plan)
      this.generatedEncounterPlans.set(regionKey, plans)
    }
    for (const region of blueprint.regions) {
      this.chronicleEncounterPlanControl.set(String(region.id), region.territory)
      this.refreshChronicleEncounterPlans(String(region.id))
    }
    this.lootMaterials = this.createLootMaterials()
    this.zoneArtProfiles = createZoneArtProfiles(this.palette)
    this.dayNightKeyframes = createDayNightKeyframes(this.palette)
    this.weatherFrostColor
      .copy(this.palette.worldFog)
      .lerp(this.palette.worldSun, 0.58)
    const generatedPlayer = restoredRun?.player
    const configuredBoon = getStartingBoonEffects(launch.config.selectedBoonId)
    const boon = restoredRun ? null : configuredBoon
    this.objectives =
      generatedPlayer?.objectives.map((objective) => ({ ...objective })) ??
      this.createGeneratedObjectives(blueprint.objectives[faction].nodes)
    this.body = generatedPlayer ? { ...generatedPlayer.body } : createHealthyBody()
    this.upgrades = normalizeUpgradeLevels(generatedPlayer?.upgrades)
    const baseMaxHealth = getMaxHealth(this.upgrades)
    const baseMaxStamina = getMaxStamina(this.upgrades)
    this.generatedHealthBonus = generatedMaximumBonus(
      generatedPlayer?.maxHealth,
      baseMaxHealth,
      configuredBoon?.startingHealthBonus ?? 0,
    )
    this.generatedStaminaBonus = generatedMaximumBonus(
      generatedPlayer?.maxStamina,
      baseMaxStamina,
      configuredBoon?.startingStaminaBonus ?? 0,
    )
    this.maxHealth = baseMaxHealth + this.generatedHealthBonus
    this.maxStamina = baseMaxStamina + this.generatedStaminaBonus
    this.health = Math.min(
      this.maxHealth,
      generatedPlayer?.health ?? this.maxHealth,
    )
    this.stamina = Math.min(
      this.maxStamina,
      generatedPlayer?.stamina ?? this.maxStamina,
    )
    this.gold = generatedPlayer?.gold ?? 55 + (boon?.startingGoldBonus ?? 0)
    this.kills = generatedPlayer?.kills ?? 0
    this.damage =
      generatedPlayer?.damage ??
      (faction === 'villain' ? 31 : faction === 'guard' ? 28 : 26) +
        (boon?.startingDamageBonus ?? 0)
    const restoredDirector = restoredRun?.directorState
    const restoredEvent = restoredRun?.eventState
    const initializeGeneratedStartingSquad = shouldInitializeStartingSquad(
      restoredDirector?.startingSquadVersion,
    )
    this.squadFollowing = restoredDirector?.squadFollowing === true
    this.elapsed = this.readSerializableNumber(restoredDirector, 'elapsed', 0)
    this.generatedSupplyCount = Math.max(
      0,
      Math.floor(
        this.readSerializableNumber(
          restoredDirector,
          'supplyCount',
          boon?.startingSupplyCount ?? 0,
        ),
      ),
    )
    this.generatedRunStatus = restoredRun?.status ?? 'active'
    this.campaignCompleted = this.objectives.every((objective) => objective.done)
    this.threatTier = THREE.MathUtils.clamp(
      Math.floor(
        this.readSerializableNumber(
          restoredDirector,
          'threatTier',
          getThreatTier(this.elapsed),
        ),
      ),
      1,
      MAX_THREAT_TIER,
    )
    this.eventCooldown =
      Math.min(
        this.eventCooldownRange().max,
        this.readSerializableNumber(
          restoredEvent,
          'eventCooldown',
          Math.max(0, FIRST_EVENT_AT - this.elapsed),
        ),
      )
    this.eventSequence = Math.max(
      0,
      Math.floor(this.readSerializableNumber(restoredEvent, 'eventSequence', 0)),
    )
    const defaultNextWave =
      this.elapsed < THREAT_WAVE_FIRST_AT
        ? THREAT_WAVE_FIRST_AT
        : this.elapsed + Math.min(45, this.threatWaveInterval())
    this.nextThreatWaveAt = Math.max(
      this.elapsed,
      Math.min(
        this.readSerializableNumber(
          restoredDirector,
          'nextThreatWaveAt',
          defaultNextWave,
        ),
        this.elapsed + this.threatWaveInterval(),
      ),
    )
    this.championDamageBonus = Math.min(
      CHAMPION_DAMAGE_CAP,
      Math.max(
        0,
        this.readSerializableNumber(
          restoredDirector,
          'championDamageBonus',
          0,
        ),
      ),
    )
    this.caravanCooldown = Math.max(
      0,
      this.readSerializableNumber(restoredDirector, 'caravanCooldown', 0),
    )
    this.caravanDirection =
      this.readSerializableNumber(restoredDirector, 'caravanDirection', 1) < 0
        ? -1
        : 1

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    // ACES rolls saturated faction colour towards white and lifts blacks — exactly
    // wrong for ink. Neutral keeps hue and keeps outlines black.
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.domElement.className = 'game-canvas'
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерный игровой мир')
    this.container.appendChild(this.renderer.domElement)
    this.postProcessor = new BloomPostProcessor(
      this.renderer,
      this.scene,
      this.camera,
      settings.bloomEnabled ?? true,
    )

    this.backgroundColor.copy(this.palette.worldSky)
    this.scene.background = this.backgroundColor
    this.fog = new THREE.Fog(this.palette.worldFog, 48, 132)
    this.scene.fog = this.fog
    this.player = this.createCharacter(faction, true)
    this.weaponTrail = this.createWeaponTrail()
    const weaponParent = this.player.getObjectByName('weapon') ?? this.player
    weaponParent.add(this.weaponTrail)
    const generatedStart = this.generatedWorld.getStartPosition(faction)
    const spawn = restoredRun?.currentLocation.worldPosition ?? [
      generatedStart.x,
      generatedStart.y,
      generatedStart.z,
    ]
    this.player.position.set(spawn[0], spawn[1], spawn[2])
    const restoredHeading = restoredRun?.currentLocation.heading
    if (typeof restoredHeading === 'number' && Number.isFinite(restoredHeading)) {
      this.player.rotation.y = restoredHeading
    }
    this.clampWorldPosition(this.player.position, PLAYER_COLLIDER_RADIUS)
    const initialGround = this.groundHeightAt(
      this.player.position.x,
      this.player.position.z,
    )
    if (this.player.position.y < initialGround) {
      this.player.position.y = initialGround
    }
    this.scene.add(this.player)
    this.applySavedBodyAppearance()
    this.playerOutline = this.registerOutline(this.player, 'player')
    this.lastZone = this.zoneAtPosition(this.player.position.x, this.player.position.z)
    this.audio.setMusicContext({
      faction: this.faction,
      zone: this.lastZone,
      intensity: this.musicIntensity,
      threatTier: this.threatTier,
    })
    if (!restoredRun) {
      this.achievements.beginRun(faction, this.lastZone, launch.runId)
    }
    this.weatherZone = this.lastZone
    this.setWeatherTarget(WEATHER_BY_ZONE[this.weatherZone], true)

    this.setupLights()
    this.createAtmosphere()
    const worldRootIndex = this.scene.children.length
    if (!restoredRun && boon?.revealAdjacentRegions) {
      const startRegionId = this.generatedWorld.getRegionIdAt(
        this.player.position.x,
        this.player.position.z,
      )
      const startRegion = blueprint.regions.find(
        (region) => region.id === startRegionId,
      )
      if (startRegion) {
        for (const region of blueprint.regions) {
          if (
            Math.abs(region.coordinate.x - startRegion.coordinate.x) <= 1 &&
            Math.abs(region.coordinate.y - startRegion.coordinate.y) <= 1
          ) {
            this.generatedWorld.regions.markDiscovered(region.id)
          }
        }
      }
    }
    this.generatedWorld.update({
      focus: {
        x: this.player.position.x,
        z: this.player.position.z,
      },
      deltaSeconds: 0,
    })
    this.setupWeather()
    this.applyGroundWeather()
    this.updateDayNight()
    this.updateWeather(0)
    this.updateAtmosphere(0)
    this.resolveCharacterOverlaps(this.player.position, PLAYER_COLLIDER_RADIUS)
    this.collectCameraObstacles(this.scene.children.slice(worldRootIndex))
    this.initializeLootPool()
    this.restoreGeneratedLoot(restoredDirector)
    this.caravan = this.createCaravan()
    this.placeGeneratedCaravan()
    this.caravan.position.x = this.readSerializableNumber(
      restoredDirector,
      'caravanX',
      this.caravan.position.x,
    )
    this.caravan.position.z = this.readSerializableNumber(
      restoredDirector,
      'caravanZ',
      this.caravan.position.z,
    )
    this.projectGeneratedCaravanOntoPatrol()
    this.clampWorldPosition(this.caravan.position, 3)
    this.caravan.position.y = this.groundHeightAt(
      this.caravan.position.x,
      this.caravan.position.z,
    )
    this.scene.add(this.caravan)
    this.registerNamedInteractableOutline(this.caravan, 'cargo')
    this.restoreGeneratedCompanions(restoredRun?.companions ?? [])
    if (initializeGeneratedStartingSquad) this.spawnGeneratedStartingSquad()
    this.syncGeneratedRegions()
    const generatedNextRegionId =
      this.generatedBlueprint.criticalPaths[faction].regionIds[1]
    const generatedNextRegion = generatedNextRegionId
      ? this.generatedWorld.getRegionCenter(generatedNextRegionId)
      : undefined
    const generatedCameraYaw = generatedNextRegion
      ? Math.atan2(
          generatedNextRegion.x - this.player.position.x,
          this.player.position.z - generatedNextRegion.z,
        )
      : undefined
    this.cameraYaw =
      restoredHeading ??
      generatedCameraYaw ??
      (faction === 'elf' ? -0.8 : faction === 'guard' ? 2.4 : 0.8)
    this.updateCamera(0, true)

    this.boundKeyDown = this.onKeyDown.bind(this)
    this.boundKeyUp = this.onKeyUp.bind(this)
    this.boundMouseMove = this.onMouseMove.bind(this)
    this.boundMouseDown = this.onMouseDown.bind(this)
    this.boundMouseUp = this.onMouseUp.bind(this)
    this.boundContextMenu = this.onContextMenu.bind(this)
    this.boundWindowBlur = this.onWindowBlur.bind(this)
    this.boundPointerLock = this.onPointerLockChange.bind(this)
    this.boundVisibilityChange = this.onVisibilityChange.bind(this)
    window.addEventListener('keydown', this.boundKeyDown)
    window.addEventListener('keyup', this.boundKeyUp)
    document.addEventListener('mousemove', this.boundMouseMove)
    document.addEventListener('mousedown', this.boundMouseDown)
    document.addEventListener('mouseup', this.boundMouseUp)
    document.addEventListener('contextmenu', this.boundContextMenu)
    document.addEventListener('pointerlockchange', this.boundPointerLock)
    document.addEventListener('visibilitychange', this.boundVisibilityChange)
    window.addEventListener('blur', this.boundWindowBlur)
    window.addEventListener('pagehide', this.pageHideAudioOwner)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
    this.emitView(true)
  }

  start(): void {
    this.clock.start()
    this.frameHandle = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    const errors: unknown[] = []
    const attempt = (action: () => void): void => {
      try {
        action()
      } catch (error) {
        errors.push(error)
      }
    }
    cancelAnimationFrame(this.frameHandle)
    attempt(() => this.cancelActiveEvents())
    attempt(() => this.clearAmbientLife())
    attempt(() => this.clearLootRuntime())
    attempt(() => this.resizeObserver.disconnect())
    window.removeEventListener('keydown', this.boundKeyDown)
    window.removeEventListener('keyup', this.boundKeyUp)
    document.removeEventListener('mousemove', this.boundMouseMove)
    document.removeEventListener('mousedown', this.boundMouseDown)
    document.removeEventListener('mouseup', this.boundMouseUp)
    document.removeEventListener('contextmenu', this.boundContextMenu)
    document.removeEventListener('pointerlockchange', this.boundPointerLock)
    document.removeEventListener('visibilitychange', this.boundVisibilityChange)
    window.removeEventListener('blur', this.boundWindowBlur)
    window.removeEventListener('pagehide', this.pageHideAudioOwner)
    if (document.pointerLockElement === this.renderer.domElement) {
      attempt(() => document.exitPointerLock())
    }
    attempt(() => this.generatedWorld.dispose())
    // Before the sweep, not during it. A shell borrows its source's geometry,
    // material and instance matrix, so the traversal below would either skip it or
    // free buffers the source still owns; `releaseOutline` is the only path that
    // returns a shell's own renderer state and nothing else. docs/08 section 8
    // makes this mandatory for callers, so the engine had better do it too.
    // The traversal is guarded independently as well: today every outline here is
    // tracked in one of these lists, but the moment an instanced batch is outlined
    // through some path that forgets to register, an unguarded `dispose()` on the
    // shell would free the source's shared `instanceMatrix`. Belt and braces,
    // because that failure renders garbage rather than throwing.
    this.outlineBindings.forEach((binding) =>
      attempt(() => this.artLibrary.releaseOutline(binding)),
    )
    this.interactableOutlineBindings.forEach((entry) =>
      attempt(() => this.artLibrary.releaseOutline(entry.binding)),
    )
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.scene.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) &&
        !(object instanceof THREE.Sprite) &&
        !(object instanceof THREE.Points) &&
        !(object instanceof THREE.Line)
      ) {
        return
      }
      if (object instanceof THREE.InstancedMesh && !StylizedArtLibrary.isOutlineShell(object)) {
        object.dispose()
      }
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.Line
      ) {
        geometries.add(object.geometry)
      }
      const material = object.material
      if (Array.isArray(material)) material.forEach((entry) => materials.add(entry))
      else materials.add(material)
    })
    this.telegraphGeometries.forEach((geometry) => geometries.add(geometry))
    geometries.forEach((geometry) => {
      if (!StylizedArtLibrary.isLibraryOwned(geometry)) {
        attempt(() => geometry.dispose())
      }
    })
    materials.forEach((material) => {
      if (!StylizedArtLibrary.isLibraryOwned(material)) {
        attempt(() => material.dispose())
      }
    })
    attempt(() => this.postProcessor.dispose())
    attempt(() => this.artGeometry.dispose())
    attempt(() => this.artLibrary.dispose())
    attempt(() => this.renderer.dispose())
    attempt(() => this.renderer.domElement.remove())
    this.actors.forEach((actor) =>
      attempt(() => actor.healthBarTexture.dispose()),
    )
    this.damageNumberFx.forEach((entry) =>
      attempt(() => entry.texture.dispose()),
    )
    this.generatedTextures.forEach((texture) =>
      attempt(() => texture.dispose()),
    )
    this.generatedTextures.clear()
    this.zoneArtMaterials.clear()
    this.zoneDecorationSets.length = 0
    this.outlineBindings.length = 0
    this.interactableOutlineBindings.length = 0
    this.projectiles.length = 0
    this.projectileSourcesToClear.clear()
    this.eventPropTargets.clear()
    this.generatedNavigationCache.clear()
    this.generatedNavigationRegionSignature = ''
    this.generatedCaravanPatrolReady = false
    this.telegraphPool.length = 0
    this.telegraphGeometries.clear()
    attempt(() => this.audio.destroy())
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Game engine cleanup was incomplete')
    }
  }

  setPaused(paused: boolean): void {
    if (paused) {
      this.dropShield()
      this.clearTransientCombatFeedback()
    }
    this.paused = paused
    this.keys.clear()
    if (paused && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    this.audio.setPaused(paused)
    this.emitView(true)
  }

  requestPointerLock(): void {
    if (!this.paused && !this.ended) {
      this.resumeAudio()
      this.renderer.domElement.requestPointerLock().catch(() => undefined)
    }
  }

  setInput(code: string, active: boolean): void {
    if (active) {
      this.resumeAudio()
      this.keys.add(code)
    } else {
      this.keys.delete(code)
    }
  }

  setMusicMuted(muted: boolean): void {
    if (!muted) this.resumeAudio()
    this.audio.setMusicMuted(muted)
  }

  setSfxVolume(volume: number): void {
    this.audio.setSfxVolume(volume)
  }

  setDynamicDayNight(enabled: boolean): void {
    if (this.dynamicDayNight === enabled) return
    this.dynamicDayNight = enabled
    this.updateDayNight()
    this.updateWeather(0)
    this.updateAtmosphere(0)
  }

  setWeatherEnabled(enabled: boolean): void {
    if (this.weatherEnabled === enabled) return
    this.weatherEnabled = enabled
    this.weatherZone = this.zoneAtPosition(this.player.position.x, this.player.position.z)
    // The target always follows the biome; `enabled` only decides whether it is drawn.
    this.setWeatherTarget(WEATHER_BY_ZONE[this.weatherZone], true)
    this.applyGroundWeather()
    if (!enabled) {
      this.lightningFlash = 0
      this.thunderDelay = -1
    }
    this.updateDayNight()
    this.updateWeather(0)
    this.updateAtmosphere(0)
  }

  setBloomEnabled(enabled: boolean): void {
    this.postProcessor.setEnabled(enabled)
  }

  setInkOutlinesEnabled(enabled: boolean): void {
    if (this.inkOutlinesEnabled === enabled) return
    this.inkOutlinesEnabled = enabled
    this.updatePlayerOutlineVisibility()
    for (const actor of this.actors) this.updateActorOutlineVisibility(actor)
    this.updateInteractableOutlines()
    this.generatedWorld.setOutlineDressing(enabled)
  }

  setFoliageQuality(quality: FoliageQuality): void {
    if (this.groundFoliageQuality === quality) return
    this.groundFoliageQuality = quality
    this.generatedWorld.setDecorationDensity(foliageQualityDensity(quality))
  }

  setScreenShakeEnabled(enabled: boolean): void {
    this.screenShakeEnabled = enabled
    if (!enabled) {
      this.resetCameraMotion()
      this.hitStopRemaining = Math.min(this.hitStopRemaining, HIT_STOP_REDUCED_MAX)
    }
  }

  stopAudio(): void {
    this.audio.destroy()
  }

  getAchievements(): AchievementView[] {
    return this.achievements.getCatalogue()
  }

  getAchievementSummary(): AchievementSummary {
    return this.achievements.getSummary()
  }

  getCurrentRunAchievements(): AchievementView[] {
    return this.achievements.getCurrentRunUnlocks()
  }

  getGeneratedBlueprint(): WorldBlueprint {
    return this.generatedBlueprint
  }

  getGeneratedWorldBlueprint(): WorldBlueprint {
    return this.getGeneratedBlueprint()
  }

  getGeneratedWorldDebug(): GeneratedWorldRuntimeDebugSnapshot {
    return this.generatedWorld.getDebugSnapshot()
  }

  getGeneratedWorldDebugSnapshot(): GeneratedWorldRuntimeDebugSnapshot {
    return this.getGeneratedWorldDebug()
  }

  getGeneratedRegionId(): string | null {
    return this.generatedRegionIdAt(
      this.player.position.x,
      this.player.position.z,
    )
  }

  useAbility(): void {
    if (this.faction === 'guard') {
      this.setShield(true)
      return
    }
    if (this.paused || this.ended || this.abilityCooldown > 0) return

    const ability = ABILITY_INFO[this.faction]
    if (
      ability.id === 'bow' &&
      this.body.leftArm === 'missing' &&
      this.body.rightArm === 'missing'
    ) {
      this.callbacks.onNotice(
        'Без рук лук не натянуть. Можно достать или купить протез.',
        'warning',
      )
      return
    }
    if (this.stamina < ability.staminaCost) {
      this.callbacks.onNotice('Выносливость кончилась. Можно ползать и т. п., но приём не выйдет.', 'warning')
      return
    }

    this.resumeAudio()
    this.stamina -= ability.staminaCost
    this.abilityCooldown = ability.cooldownMax
    this.menacePlayer()
    if (ability.id === 'bow') this.fireArrow()
    else this.cleave()
    this.achievements.recordAbilityUse(ability.id)
    this.emitView(true)
  }

  /**
   * §5D — the player has just drawn steel, and stays frightening for a few seconds.
   *
   * This is the only channel through which the *player* alarms a village, and it is
   * deliberately an action rather than proximity: villagers who scattered from anybody
   * walking past would make a village unapproachable, and walking in and *then* swinging
   * is the whole joke.
   */
  private menacePlayer(): void {
    this.civilianMenaceUntil = this.elapsed + CIVILIAN_MENACE_SECONDS
  }

  setShield(active: boolean): void {
    if (this.faction !== 'guard') return
    if (!active) {
      if (!this.shieldActive) return
      this.dropShield()
      this.emitView(true)
      return
    }
    if (
      this.paused ||
      this.ended ||
      this.shieldActive ||
      this.abilityCooldown > 0 ||
      this.stamina <= 0
    ) {
      return
    }
    this.resumeAudio()
    this.shieldActive = true
    this.achievements.recordAbilityUse('shield')
    this.updateShieldPose()
    this.emitView(true)
  }

  attack(): void {
    if (this.paused || this.ended || this.attackCooldown > 0) return
    this.resumeAudio()
    this.attackCooldown = 0.52
    this.attackAnimation = 1
    this.activePlayerAttackKind = 'melee'
    this.menacePlayer()

    // §5D — hostiles first, always. A villager is only a legal target when there is
    // nothing to fight, so walking into a village mid-raid cannot make the swing meant
    // for the wolf land on the man running away from it. Being *able* to whack a peasant
    // is the joke; having the auto-target do it for you is a bug.
    let target: Actor | null = null
    let bestDistance = 3.6
    let bystander: Actor | null = null
    let bestBystanderDistance = 3.6
    for (const actor of this.actors) {
      if (!actor.alive) continue
      const distance = actor.mesh.position.distanceTo(this.player.position)
      if (actor.hostileToPlayer) {
        if (distance >= bestDistance) continue
        target = actor
        bestDistance = distance
      } else if (actor.allegiance === 'civilian') {
        if (distance >= bestBystanderDistance) continue
        bystander = actor
        bestBystanderDistance = distance
      }
    }
    target = target ?? bystander

    if (!target) {
      this.playSound('swing')
      return
    }

    const targetDirection = target.mesh.position.clone().sub(this.player.position)
    this.player.rotation.y = Math.atan2(targetDirection.x, targetDirection.z)
    const armPenalty =
      (this.body.leftArm === 'missing' ? 5 : 0) + (this.body.rightArm === 'missing' ? 9 : 0)
    const dealt = Math.max(
      8,
      this.damage - armPenalty + Math.floor(this.combatRng() * 7),
    )
    this.damageActor(target, dealt, this.player.position, this.faction, true, {
      attackKind: 'melee',
      detachChance: 0.45,
    })
  }

  interact(): void {
    if (this.paused || this.ended) return
    this.resumeAudio()
    if (this.activeEvents.some((event) => event.onInteract?.() === true)) {
      this.emitView(true)
      return
    }
    if (this.handleGeneratedInteraction()) {
      this.emitView(true)
      return
    }
    const playerPosition = this.player.position
    if (playerPosition.distanceTo(this.caravan.position) < 7) {
      if (this.faction === 'guard') {
        this.callbacks.onNotice(
          'Ты играешь охраной дворца: этот корован надо защищать.',
          'info',
        )
        this.health = Math.min(this.maxHealth, this.health + 8)
        return
      }
      if (this.caravanCooldown > 0) {
        this.callbacks.onNotice('Этот корован уже ограбили. Ждём следующий.', 'warning')
        return
      }
      this.gold += 95
      this.achievements.recordGoldEarned(95)
      this.achievements.recordCaravanRobbed(false)
      this.caravanCooldown = 40
      this.caravanRobbedFlash = 1
      this.callbacks.onNotice(
        'Корован ограблен! +95 золота. Охрана уже набигает.',
        'success',
      )
      this.playSound('coin')
      this.spawnAmbush()
      this.emitView(true)
    }
  }

  commandSquad(): void {
    if (this.paused || this.ended) return
    this.resumeAudio()
    this.squadFollowing = !this.squadFollowing
    this.achievements.recordSquadCommand()
    const squadName =
      this.faction === 'guard'
        ? 'Солдаты охраны'
        : this.faction === 'elf'
          ? 'Партизаны эльфов'
          : 'Войска злодея'
    const message = this.squadFollowing
      ? `${squadName} идут за тобой. Пользователь сам себе командир.`
      : `${squadName} остаются на месте.`
    this.callbacks.onNotice(message, this.squadFollowing ? 'success' : 'info')
    this.playSound('command')
    this.emitView(true)
  }

  purchase(item: ShopItem): { ok: boolean; message: string } {
    const currentLevel = item.upgrade ? this.upgrades[item.upgrade] : 0
    if (item.upgrade && currentLevel >= (item.maxLevel ?? Number.POSITIVE_INFINITY)) {
      return { ok: false, message: `${item.name}: достигнут максимальный уровень.` }
    }
    const price = getShopItemPrice(item, this.upgrades, this.activeShopPriceMultiplier)
    if (this.gold < price) return { ok: false, message: 'Золота не хватает.' }

    if (item.id === 'arm') {
      const part = this.firstPartWithStatus(['leftArm', 'rightArm'], 'missing')
      if (!part) return { ok: false, message: 'Обе руки на месте. Протез пока лишний.' }
      this.body[part] = 'prosthetic'
      this.restorePlayerLimb(part)
    } else if (item.id === 'leg') {
      const part = this.firstPartWithStatus(['leftLeg', 'rightLeg'], 'missing')
      if (!part) return { ok: false, message: 'Обе ноги на месте. Протез пока лишний.' }
      this.body[part] = 'prosthetic'
      this.restorePlayerLimb(part)
    } else if (item.id === 'eye') {
      const part = this.firstPartWithStatus(['leftEye', 'rightEye'], 'missing')
      if (!part) return { ok: false, message: 'Оба глаза на месте. Протез пока лишний.' }
      this.body[part] = 'prosthetic'
    } else if (item.id === 'medicine') {
      if (this.health >= this.maxHealth && this.body.bleeding === 0 && !this.hasWounds()) {
        return { ok: false, message: 'Пользователь здоров. Лечить нечего.' }
      }
      this.health = Math.min(this.maxHealth, this.health + 55)
      this.body.bleeding = 0
      this.healWounds()
    } else if (item.id === 'blade') {
      this.damage += 8
      this.upgrades.blade += 1
    } else if (item.id === 'vitality') {
      this.upgrades.vitality += 1
      this.maxHealth = getMaxHealth(this.upgrades) + this.generatedHealthBonus
      this.health = Math.min(this.maxHealth, this.health + MAX_HEALTH_PER_LEVEL)
    } else {
      this.upgrades.endurance += 1
      this.maxStamina = getMaxStamina(this.upgrades) + this.generatedStaminaBonus
      this.stamina = Math.min(this.maxStamina, this.stamina + MAX_STAMINA_PER_LEVEL)
    }

    this.gold -= price
    this.achievements.recordPurchase(item.id)
    this.playSound('coin')
    this.emitView(true)
    const levelSuffix = item.upgrade ? ` Уровень ${this.upgrades[item.upgrade]}.` : ''
    return { ok: true, message: `${item.name}: покупка завершена.${levelSuffix}` }
  }

  saveGeneratedRun(): ActiveRunSaveV3 {
    const savedEventCooldown = this.playerAnchoredEvent
      ? Math.max(this.eventCooldown, this.eventCooldownRange().min)
      : this.eventCooldown
    this.syncChronicleToRegionDeltas()
    const regionState = this.generatedWorld.regions.saveState()
    const startSiteId = this.generatedBlueprint.starts[this.faction]
    const regionId =
      this.generatedWorld.getRegionIdAt(
        this.player.position.x,
        this.player.position.z,
      ) ??
      this.generatedBlueprint.sites.find(
        (site) => site.id === startSiteId,
      )?.regionId
    if (!regionId) throw new Error('Generated start site is missing')
    const regionBounds = this.generatedWorld.getRegionBounds(regionId)
    if (!regionBounds) throw new Error('Player is outside the generated world')
    const achievementRunState = this.achievements.getRunState()
    if (!achievementRunState) throw new Error('Generated achievement run state is missing')
    const timestamp = new Date(
      Math.max(Date.now(), Date.parse(this.generatedRun.startedAt)),
    ).toISOString()
    const save: ActiveRunSaveV3 = {
      version: ACTIVE_RUN_SAVE_VERSION,
      runId: this.generatedRun.runId,
      config: {
        ...this.generatedRun.config,
        ...(this.generatedRun.config.modifiers
          ? { modifiers: [...this.generatedRun.config.modifiers] }
          : {}),
      },
      status: this.generatedRunStatus,
      startedAt: this.generatedRun.startedAt,
      updatedAt: timestamp,
      blueprintFingerprint: this.generatedBlueprint.fingerprint,
      currentLocation: {
        regionId: String(regionId),
        localPosition: [
          this.player.position.x - regionBounds.minX,
          this.player.position.y,
          this.player.position.z - regionBounds.minZ,
        ],
        worldPosition: [
          this.player.position.x,
          this.player.position.y,
          this.player.position.z,
        ],
        heading: this.cameraYaw,
      },
      player: {
        health: this.health,
        maxHealth: this.maxHealth,
        stamina: this.stamina,
        maxStamina: this.maxStamina,
        gold: this.gold,
        kills: this.kills,
        damage: this.damage,
        body: { ...this.body },
        objectives: this.objectives.map((objective) => ({ ...objective })),
        upgrades: { ...this.upgrades },
      },
      companions: this.actors
        .filter(
          (actor) =>
            actor.alive &&
            actor.allegiance === this.faction &&
            actor.squadEligible &&
            actor.role !== 'commander' &&
            actor.eventOwnerId === null,
        )
        .map((actor) => ({
          id: actor.id,
          role: actor.role,
          health: actor.hp,
          maxHealth: actor.maxHp,
          worldPosition: [
            actor.mesh.position.x,
            actor.mesh.position.y,
            actor.mesh.position.z,
          ],
        })),
      discoveredRegionIds: regionState.discoveredRegionIds.map(String),
      regionDeltas: regionState.deltas,
      directorState: {
        elapsed: this.elapsed,
        squadFollowing: this.squadFollowing,
        startingSquadVersion: STARTING_SQUAD_VERSION,
        threatTier: this.threatTier,
        nextThreatWaveAt: this.nextThreatWaveAt,
        championDamageBonus: this.championDamageBonus,
        supplyCount: this.generatedSupplyCount,
        caravanCooldown: this.caravanCooldown,
        caravanDirection: this.caravanDirection,
        caravanX: this.caravan.position.x,
        caravanZ: this.caravan.position.z,
        pendingLoot: this.lootPickups
          .filter((pickup) => pickup.active)
          .sort((left, right) => left.serial - right.serial)
          .map((pickup) => ({
            reward: { ...pickup.reward },
            position: [
              pickup.root.position.x,
              pickup.root.position.y,
              pickup.root.position.z,
            ],
          })),
      },
      eventState: {
        eventCooldown: savedEventCooldown,
        eventSequence: this.eventSequence,
        active: false,
      },
      chronicleState: cloneChronicleState(this.chronicleState),
      rngStates: {
        combat: this.generatedRngStreams.combat.getState(),
        director: this.generatedRngStreams.director.getState(),
        event: this.generatedRngStreams.event.getState(),
        loot: this.generatedRngStreams.loot.getState(),
        chronicle: this.generatedRngStreams.chronicle.getState(),
      },
      achievementRunState,
    }
    const normalized = normalizeActiveRunSaveV3(save)
    if (!normalized) throw new Error('Generated run save failed validation')
    return normalized
  }

  private readonly loop = (): void => {
    const elapsedDelta = this.clock.getDelta()
    const visualDelta = Math.min(elapsedDelta, 0.05)
    let stopped = 0
    if (!this.paused && !this.ended && this.hitStopRemaining > 0) {
      stopped = Math.min(this.hitStopRemaining, elapsedDelta)
      this.hitStopRemaining = Math.max(0, this.hitStopRemaining - stopped)
    }
    const gameplayDelta = Math.min(Math.max(0, elapsedDelta - stopped), 0.05)
    if (!this.paused && !this.ended && gameplayDelta > 0) this.update(gameplayDelta)
    if (!this.paused && !this.ended) this.updateCameraEffects(visualDelta)
    this.updateCamera(visualDelta, false)
    this.audioListenerRight.setFromMatrixColumn(this.camera.matrixWorld, 0)
    this.audio.setListener(this.camera.position, this.audioListenerRight)
    this.updateMusicContext()
    this.postProcessor.render()
    this.frameHandle = requestAnimationFrame(this.loop)
  }

  private update(delta: number): void {
    this.elapsed += delta
    // Layer 5 — the world's night and the world's weather, read once per frame from
    // `WorldEnvironment` rather than from the renderer. `this.nightFactor` is pinned to
    // zero whenever the day/night cycle is switched off for performance and
    // `this.weatherEnabled` gates the precipitation, so neither may be read by anything
    // that decides what the world *does*.
    this.ambientNightFactor = computeNightFactor(this.elapsed)
    const storm = computeStormFactor(this.weatherWeights)
    this.ambientStormPace = weatherPaceMultiplier(storm)
    this.ambientStormHunch = weatherHunch(storm)
    this.updateLoot(delta)
    this.updateThreat()
    this.updateChronicle(delta)
    this.updateAmbientBeasts(delta)
    this.updateAmbientCivilians(delta)
    this.cleanupDeadActors()
    this.shakeClock += delta
    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * delta)
    this.damageFlash = Math.max(0, this.damageFlash - FLASH_DECAY * delta)
    this.attackCooldown = Math.max(0, this.attackCooldown - delta)
    this.attackAnimation = Math.max(0, this.attackAnimation - delta * 4.2)
    this.abilityCooldown = Math.max(0, this.abilityCooldown - delta)
    this.caravanCooldown = Math.max(0, this.caravanCooldown - delta)
    this.caravanRobbedFlash = Math.max(0, this.caravanRobbedFlash - delta * 2)
    this.moraleNoticeCooldown = Math.max(0, this.moraleNoticeCooldown - delta)
    this.updatePlayer(delta)
    this.generatedWorld.update({
      focus: {
        x: this.player.position.x,
        z: this.player.position.z,
      },
      deltaSeconds: delta,
    })
    this.syncGeneratedRegions()
    this.refreshGeneratedCameraObstacles()
    this.updateCaravan(delta)
    this.updateProjectiles(delta)
    this.updateActors(delta)
    this.updateTorches()
    this.updateCampfires(delta)
    this.updateWildlife(delta)
    this.updateInteractableOutlines()
    this.updateParticles(delta)
    this.updateComicHitFx(delta)
    this.updateDecals(delta)
    this.updateDayNight()
    this.updateWeather(delta)
    this.updateAtmosphere(delta)

    if (this.body.bleeding > 0) {
      this.health -= this.body.bleeding * delta
      this.bleedFxCooldown -= delta
      if (this.bleedFxCooldown <= 0) {
        this.bleedFxCooldown = BLEED_FX_INTERVAL
        this.createBleedParticle()
        this.spawnDecal(this.player.position, 'blood', 0.55)
      }
    } else {
      this.bleedFxCooldown = 0
    }
    if (this.health <= 0) {
      this.endGame('defeat')
      return
    }
    this.updateMission()
    this.updateEvents(delta)
    this.updatePrompt()
    this.emitView(false)
  }

  private readSerializableNumber(
    state: SerializableState | undefined,
    key: string,
    fallback: number,
  ): number {
    const value = state?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  private createGeneratedObjectives(
    nodes: readonly FactionObjectiveNode[],
  ): Objective[] {
    return nodes.map((node) => {
      const site = this.generatedBlueprint.sites.find(
        (candidate) => candidate.id === node.siteId,
      )
      return {
        id: node.id,
        text: createGeneratedObjectiveText(node.kind, site?.kind),
        done: false,
      }
    })
  }

  private zoneAtPosition(x: number, z: number): ZoneId {
    const biome = this.generatedWorld.getBiomeAt(x, z)
    return biome === 'neutral' ||
      biome === 'palace' ||
      biome === 'forest' ||
      biome === 'fort'
      ? biome
      : 'neutral'
  }

  private groundHeightAt(x: number, z: number): number {
    return this.generatedWorld.sampleHeight(x, z)
  }

  private generatedRegionIdAt(x: number, z: number): string | null {
    const regionId = this.generatedWorld.getRegionIdAt(x, z)
    return regionId === undefined ? null : String(regionId)
  }

  private clampWorldPosition(position: THREE.Vector3, radius = 0): void {
    const bounds = this.generatedWorld.bounds
    position.x = THREE.MathUtils.clamp(
      position.x,
      bounds.minX + radius,
      bounds.maxX - radius,
    )
    position.z = THREE.MathUtils.clamp(
      position.z,
      bounds.minZ + radius,
      bounds.maxZ - radius,
    )
  }

  private isWithinWorldBounds(x: number, z: number, margin = 0): boolean {
    const bounds = this.generatedWorld.bounds
    return (
      x >= bounds.minX - margin &&
      x <= bounds.maxX + margin &&
      z >= bounds.minZ - margin &&
      z <= bounds.maxZ + margin
    )
  }

  private createRegionDelta(regionId: string): RegionDelta {
    return {
      version: REGION_DELTA_VERSION,
      regionId,
      revision: 0,
      clearedEncounterIds: [],
      defeatedActorIds: [],
      removedPropIds: [],
      collectedLootIds: [],
      completedInteractionIds: [],
      completedEventIds: [],
      chronicle:
        this.chronicleRegions.get(regionId) ??
        createRegionChronicleState(
          this.generatedBlueprint.regions.find(
            (region) => String(region.id) === regionId,
          )?.territory ?? 'neutral',
        ),
      state: {},
    }
  }

  private mutateGeneratedRegionDelta(
    regionId: string,
    mutation: (delta: RegionDelta) => void,
  ): void {
    const source =
      this.generatedWorld.regions.getSavedDelta(regionId) ??
      this.createRegionDelta(regionId)
    const delta: RegionDelta = {
      ...source,
      clearedEncounterIds: [...source.clearedEncounterIds],
      defeatedActorIds: [...source.defeatedActorIds],
      removedPropIds: [...source.removedPropIds],
      collectedLootIds: [...source.collectedLootIds],
      completedInteractionIds: [...source.completedInteractionIds],
      completedEventIds: [...source.completedEventIds],
      chronicle: cloneRegionChronicleState(source.chronicle),
      state: { ...source.state },
    }
    mutation(delta)
    delta.revision += 1
    delta.clearedEncounterIds.sort()
    delta.defeatedActorIds.sort()
    delta.collectedLootIds.sort()
    delta.completedInteractionIds.sort()
    if (!this.generatedWorld.regions.applyRegionDelta(regionId, delta)) {
      throw new Error(`Could not update generated region delta: ${regionId}`)
    }
  }

  private recordGeneratedActorDeath(actor: Actor): void {
    const regionId = actor.generatedRegionId
    const encounterId = actor.generatedEncounterId
    if (!regionId || !encounterId) return
    const spawnId = actor.generatedSpawnId
    if (actor.generatedUnique && spawnId) {
      this.mutateGeneratedRegionDelta(regionId, (delta) => {
        if (!delta.defeatedActorIds.includes(spawnId)) {
          delta.defeatedActorIds.push(spawnId)
        }
      })
    }
    if (actor.generatedObjectiveId) {
      const node = this.generatedBlueprint.objectives[this.faction].nodes.find(
        (candidate) => candidate.id === actor.generatedObjectiveId,
      )
      if (node) this.completeGeneratedObjective(node)
    }
    const hasLivingActor = this.actors.some(
      (candidate) =>
        candidate !== actor &&
        candidate.alive &&
        candidate.generatedRegionId === regionId &&
        candidate.generatedEncounterId === encounterId,
    )
    if (hasLivingActor) return
    const plan = (this.generatedEncounterPlans.get(regionId) ?? []).find(
      (candidate) => candidate.encounterId === encounterId,
    )
    const activationSpawns = this.generatedActivationSpawns.get(regionId)
    if (
      plan &&
      activationSpawns &&
      !plan.spawns.every((spawn) => activationSpawns.has(spawn.id))
    ) {
      return
    }
    this.mutateGeneratedRegionDelta(regionId, (delta) => {
      if (!delta.clearedEncounterIds.includes(encounterId)) {
        delta.clearedEncounterIds.push(encounterId)
      }
    })
  }

  private syncGeneratedRegions(): void {
    const nextRegions = new Set(
      this.generatedWorld.regions.getSimulatedRegionIds().map(String),
    )
    const navigationSignature = `${this.generatedWorld.regions
      .getVisibleRegionIds()
      .map(String)
      .sort()
      .join('|')}::${[...nextRegions].sort().join('|')}`
    if (navigationSignature !== this.generatedNavigationRegionSignature) {
      this.generatedNavigationRegionSignature = navigationSignature
      this.generatedNavigationCache.clear()
    }
    for (const regionId of this.simulatedGeneratedRegions) {
      if (nextRegions.has(regionId)) continue
      for (const actor of [...this.actors]) {
        if (
          actor.generatedRegionId === regionId &&
          (actor.generatedEncounterId !== null || actor.eventOwnerId === null)
        ) {
          this.removeActorById(actor.id)
        }
      }
      this.generatedActivationSpawns.delete(regionId)
    }
    this.simulatedGeneratedRegions.clear()
    for (const regionId of nextRegions) {
      this.simulatedGeneratedRegions.add(regionId)
      if (!this.generatedActivationSpawns.has(regionId)) {
        this.generatedActivationSpawns.set(regionId, new Set())
      }
      this.spawnGeneratedRegionEncounters(regionId)
    }
  }

  private restoreGeneratedCompanions(
    companions: readonly RunCompanionState[],
  ): void {
    for (const companion of companions) {
      if (!this.reserveActorSlots('squad', 1)) break
      if (this.actors.some((actor) => actor.id === companion.id)) continue
      const actor = this.spawnActor(
        this.faction,
        companion.role,
        companion.worldPosition[0],
        companion.worldPosition[2],
        this.actorSequence,
        {
          budget: 'squad',
          objectiveEligible: false,
          squadEligible: true,
          generatedRegionId: null,
          hostileToPlayer: false,
        },
      )
      actor.id = companion.id
      actor.maxHp = companion.maxHealth
      actor.hp = Math.min(companion.maxHealth, companion.health)
      actor.home.copy(actor.mesh.position)
      actor.wanderTarget.copy(actor.mesh.position)
      if (actor.role === 'captive') {
        const weapon = actor.mesh.getObjectByName('weapon')
        if (weapon) weapon.visible = true
      }
    }
  }

  private spawnGeneratedStartingSquad(): void {
    for (const member of getStartingSquad(this.faction)) {
      if (!this.reserveActorSlots('squad', 1)) break
      const actor = this.spawnActor(
        this.faction,
        member.role,
        this.player.position.x + member.offsetX,
        this.player.position.z + member.offsetZ,
        this.actorSequence,
        {
          budget: 'squad',
          objectiveEligible: false,
          squadEligible: true,
          generatedRegionId: null,
          hostileToPlayer: false,
        },
      )
      actor.home.copy(actor.mesh.position)
      actor.wanderTarget.copy(actor.mesh.position)
    }
  }

  private restoreGeneratedLoot(state: SerializableState | undefined): void {
    const pendingLoot = state?.pendingLoot
    if (!Array.isArray(pendingLoot)) return
    const labels: Record<LootRewardKind, string> = {
      coins: 'Звонкая мелочь',
      medicine: 'Пузырёк знахаря',
      whetstone: 'Точильный камень',
    }
    for (const value of pendingLoot.slice(0, LOOT_MAX_ACTIVE)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const rewardValue = value.reward
      const position = value.position
      if (
        !rewardValue ||
        typeof rewardValue !== 'object' ||
        Array.isArray(rewardValue) ||
        !Array.isArray(position) ||
        position.length !== 3
      ) {
        continue
      }
      const kind =
        rewardValue.kind === 'coins' ||
        rewardValue.kind === 'medicine' ||
        rewardValue.kind === 'whetstone'
          ? rewardValue.kind
          : null
      const rarity =
        rewardValue.rarity === 'common' ||
        rewardValue.rarity === 'uncommon' ||
        rewardValue.rarity === 'rare' ||
        rewardValue.rarity === 'legendary'
          ? rewardValue.rarity
          : null
      const amount = rewardValue.amount
      const [x, y, z] = position
      if (
        !kind ||
        !rarity ||
        typeof amount !== 'number' ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        typeof x !== 'number' ||
        !Number.isFinite(x) ||
        typeof y !== 'number' ||
        !Number.isFinite(y) ||
        typeof z !== 'number' ||
        !Number.isFinite(z)
      ) {
        continue
      }
      const pickup = this.lootPickups.find((candidate) => !candidate.active)
      if (!pickup) break
      pickup.reward = { kind, rarity, amount, label: labels[kind] }
      pickup.state = 'idle'
      pickup.velocity.set(0, 0, 0)
      pickup.age = 0
      pickup.idleAge = 0
      pickup.active = true
      pickup.serial = ++this.lootSequence
      pickup.root.position.set(x, y, z)
      pickup.root.visible = true
      this.configureLootVisual(pickup)
      pickup.tokenRoot.scale.setScalar(1)
    }
  }

  private spawnGeneratedRegionEncounters(regionId: string): void {
    const delta =
      this.generatedWorld.regions.getSavedDelta(regionId) ??
      this.createRegionDelta(regionId)
    const activationSpawns = this.generatedActivationSpawns.get(regionId)
    if (!activationSpawns) return
    const graph = this.generatedBlueprint.objectives[this.faction]
    const finalNode = graph.nodes.find((node) => node.id === graph.finalNodeId)
    const finalReady = finalNode ? this.generatedPrerequisitesDone(finalNode) : true
    const finaleSiteId = this.generatedBlueprint.finales[this.faction]
    const startSiteId = this.generatedBlueprint.starts[this.faction]
    const startRegionId = this.generatedBlueprint.sites.find(
      (site) => site.id === startSiteId,
    )?.regionId
    const finalEncounterId = this.generatedBlueprint.encounters.find(
      (encounter) =>
        encounter.kind === 'boss' &&
        encounter.siteId === finaleSiteId,
    )?.id
    for (const plan of this.generatedEncounterPlans.get(regionId) ?? []) {
      if (delta.clearedEncounterIds.includes(plan.encounterId)) continue
      if (regionId === startRegionId && plan.kind !== 'boss') continue
      const isFinalEncounter = plan.encounterId === finalEncounterId
      if (isFinalEncounter && !finalReady) continue
      for (const spawn of plan.spawns) {
        if (activationSpawns.has(spawn.id)) continue
        if (spawn.unique && delta.defeatedActorIds.includes(spawn.id)) {
          activationSpawns.add(spawn.id)
          continue
        }
        // Reserve only once this spawn is actually going to happen: reserving can make
        // lower-priority categories give up actors, and nothing should die for a slot
        // that is then skipped.
        if (!this.reserveActorSlots('campaign', 1)) return
        const actor = this.spawnActor(
          spawn.faction,
          spawn.role,
          spawn.worldX,
          spawn.worldZ,
          this.actorSequence++,
          {
            budget: 'campaign',
            objectiveEligible: spawn.objectiveEligible,
            squadEligible: false,
            generatedRegionId: regionId,
            generatedEncounterId: plan.encounterId,
            generatedSpawnId: spawn.id,
            generatedObjectiveId:
              spawn.objective && isFinalEncounter ? graph.finalNodeId : null,
            generatedUnique: spawn.unique,
            hostileToPlayer: plan.hostileToPlayer,
            healthScale: 1 + Math.max(0, plan.difficulty - 1) * 0.12,
          },
        )
        actor.playerAggro = plan.hostileToPlayer
        activationSpawns.add(spawn.id)
      }
    }
  }

  private refreshGeneratedCameraObstacles(): void {
    const signature = this.generatedWorld.regions
      .getVisibleRegionIds()
      .map(String)
      .sort()
      .join('|')
    if (signature === this.generatedCameraRegionSignature) return
    this.generatedCameraRegionSignature = signature
    this.cameraObstacles.length = 0
    this.collectCameraObstacles(
      this.scene.children.filter(
        (child) => child.userData.generatedWorldRegionId !== undefined,
      ),
    )
    this.applyChronicleRazedVisuals()
  }

  private placeGeneratedCaravan(): void {
    const path = this.generatedBlueprint.criticalPaths[this.faction]
    const startRegion = this.generatedWorld.getRegionCenter(path.regionIds[0])
    const destinationRegion = this.generatedWorld.getRegionCenter(
      path.regionIds[1] ?? path.regionIds[0],
    )
    const fallback = this.generatedWorld.getStartPosition(this.faction)
    const start = startRegion ?? fallback
    const destination = destinationRegion ?? fallback
    this.generatedCaravanTravelDirection
      .set(destination.x - start.x, destination.z - start.z)
      .normalize()
    if (this.generatedCaravanTravelDirection.lengthSq() === 0) {
      this.generatedCaravanTravelDirection.set(1, 0)
    }
    this.generatedCaravanPatrolStart.set(
      start.x +
        this.generatedCaravanTravelDirection.x * GENERATED_CARAVAN_PATROL_NEAR,
      0,
      start.z +
        this.generatedCaravanTravelDirection.y * GENERATED_CARAVAN_PATROL_NEAR,
    )
    this.generatedCaravanPatrolEnd.set(
      start.x +
        this.generatedCaravanTravelDirection.x * GENERATED_CARAVAN_PATROL_FAR,
      0,
      start.z +
        this.generatedCaravanTravelDirection.y * GENERATED_CARAVAN_PATROL_FAR,
    )
    this.clampWorldPosition(
      this.generatedCaravanPatrolStart,
      GENERATED_CARAVAN_COLLIDER_RADIUS,
    )
    this.clampWorldPosition(
      this.generatedCaravanPatrolEnd,
      GENERATED_CARAVAN_COLLIDER_RADIUS,
    )
    this.generatedCaravanPatrolStart.y = this.groundHeightAt(
      this.generatedCaravanPatrolStart.x,
      this.generatedCaravanPatrolStart.z,
    )
    this.generatedCaravanPatrolEnd.y = this.groundHeightAt(
      this.generatedCaravanPatrolEnd.x,
      this.generatedCaravanPatrolEnd.z,
    )
    this.generatedCaravanPatrolReady =
      this.generatedCaravanPatrolStart.distanceToSquared(
        this.generatedCaravanPatrolEnd,
      ) > 1
    this.caravan.position.copy(this.generatedCaravanPatrolStart)
  }

  private projectGeneratedCaravanOntoPatrol(): void {
    if (!this.generatedCaravanPatrolReady) return
    const segmentX =
      this.generatedCaravanPatrolEnd.x - this.generatedCaravanPatrolStart.x
    const segmentZ =
      this.generatedCaravanPatrolEnd.z - this.generatedCaravanPatrolStart.z
    const lengthSquared = segmentX * segmentX + segmentZ * segmentZ
    if (lengthSquared <= 0.0001) return
    const progress = THREE.MathUtils.clamp(
      ((this.caravan.position.x - this.generatedCaravanPatrolStart.x) *
        segmentX +
        (this.caravan.position.z - this.generatedCaravanPatrolStart.z) *
          segmentZ) /
        lengthSquared,
      0,
      1,
    )
    this.caravan.position.x =
      this.generatedCaravanPatrolStart.x + segmentX * progress
    this.caravan.position.z =
      this.generatedCaravanPatrolStart.z + segmentZ * progress
  }

  private generatedPrerequisitesDone(node: FactionObjectiveNode): boolean {
    return node.prerequisiteIds.every((id) => this.isObjectiveDone(id))
  }

  private getActiveGeneratedObjective(): FactionObjectiveNode | null {
    const graph = this.generatedBlueprint.objectives[this.faction]
    return (
      graph.nodes.find(
        (node) =>
          !this.isObjectiveDone(node.id) && this.generatedPrerequisitesDone(node),
      ) ?? null
    )
  }

  private completeGeneratedObjective(node: FactionObjectiveNode): boolean {
    if (!this.generatedPrerequisitesDone(node)) return false
    return this.completeObjective(node.id)
  }

  private handleGeneratedInteraction(): boolean {
    const site = this.generatedWorld.findNearbySite(
      { x: this.player.position.x, z: this.player.position.z },
      6,
    )
    if (!site) {
      if (
        this.generatedSupplyCount > 0 &&
        this.health < this.maxHealth &&
        this.player.position.distanceTo(this.caravan.position) >= 7
      ) {
        this.generatedSupplyCount -= 1
        this.health = Math.min(this.maxHealth, this.health + 35)
        this.body.bleeding = Math.max(0, this.body.bleeding - 0.35)
        this.callbacks.onNotice('Дорожный паёк вернул 35 здоровья. Не спрашивай, из чего он.', 'success')
        this.playSound('objective')
        return true
      }
      return false
    }
    const node = this.getActiveGeneratedObjective()
    const targetsNode =
      node?.siteId === site.id &&
      (node.kind === 'interact' || node.kind === 'claim')
    if (
      !targetsNode &&
      site.kind !== 'shop' &&
      site.kind !== 'recovery' &&
      site.kind !== 'treasure'
    ) {
      return false
    }

    const delta =
      this.generatedWorld.regions.getSavedDelta(site.regionId) ??
      this.createRegionDelta(String(site.regionId))
    const interacted = delta.completedInteractionIds.includes(site.id)
    const collected = delta.collectedLootIds.includes(site.id)
    if (
      (site.kind === 'shop' || site.kind === 'recovery') &&
      this.isChronicleSiteRazed(site.id)
    ) {
      this.callbacks.onNotice(
        site.kind === 'shop'
          ? 'Лавка сгорела вместе с домиками деревяными. Торговать не с кем.'
          : 'Лечить некому: знахаря вынесли вперёд ногами, а избу — по брёвнышку.',
        'warning',
      )
      return true
    }
    if (site.kind === 'shop') {
      this.activeShopPriceMultiplier = getSupplyPriceMultiplier(
        this.chronicleRegions.get(String(site.regionId)),
      )
      this.callbacks.onShop()
    } else if (site.kind === 'recovery') {
      this.health = Math.min(this.maxHealth, this.health + 40)
      this.stamina = this.maxStamina
      this.body.bleeding = 0
      this.healWounds()
      this.callbacks.onNotice(
        'Пользователя вылечили. До протезов дело пока не дошло.',
        'success',
      )
      this.playSound('objective')
    } else if (site.kind === 'treasure' || node?.kind === 'claim') {
      if (collected) {
        this.callbacks.onNotice('Этот тайник уже пуст.', 'info')
      } else {
        const reward = 28 + Math.floor(this.lootRng() * 43)
        this.gold += reward
        this.achievements.recordGoldEarned(reward)
        this.mutateGeneratedRegionDelta(String(site.regionId), (next) => {
          if (!next.collectedLootIds.includes(site.id)) {
            next.collectedLootIds.push(site.id)
          }
          if (!next.completedInteractionIds.includes(site.id)) {
            next.completedInteractionIds.push(site.id)
          }
        })
        this.callbacks.onNotice(`В тайнике нашлись припасы и ${reward} золота.`, 'success')
        this.playSound('coin')
      }
    } else if (!interacted) {
      this.mutateGeneratedRegionDelta(String(site.regionId), (next) => {
        if (!next.completedInteractionIds.includes(site.id)) {
          next.completedInteractionIds.push(site.id)
        }
      })
      this.callbacks.onNotice(
        `Осмотрено: «${generatedSiteLabel(site.kind)}».`,
        'success',
      )
    }

    if (targetsNode) {
      if (!interacted) {
        this.mutateGeneratedRegionDelta(String(site.regionId), (next) => {
          if (!next.completedInteractionIds.includes(site.id)) {
            next.completedInteractionIds.push(site.id)
          }
        })
      }
      this.completeGeneratedObjective(node)
    }
    return true
  }

  private getGeneratedPrompt(): string {
    const node = this.getActiveGeneratedObjective()
    const nearbySite = this.generatedWorld.findNearbySite(
      { x: this.player.position.x, z: this.player.position.z },
      6,
    )
    if (nearbySite) {
      if (
        node?.siteId === nearbySite.id &&
        (node.kind === 'interact' || node.kind === 'claim')
      ) {
        return node.kind === 'claim'
          ? `[E] Забрать награду: ${generatedSiteLabel(nearbySite.kind)}`
          : `[E] Осмотреть: ${generatedSiteLabel(nearbySite.kind)}`
      }
      if (nearbySite.kind === 'shop') {
        return `[E] Купить что-нибудь: ${generatedSiteLabel(nearbySite.kind)}`
      }
      if (nearbySite.kind === 'recovery') {
        return `[E] Вылечиться: ${generatedSiteLabel(nearbySite.kind)}`
      }
      if (nearbySite.kind === 'treasure') {
        const claimed = this.generatedWorld.regions
          .getSavedDelta(nearbySite.regionId)
          ?.collectedLootIds.includes(nearbySite.id)
        return claimed
          ? `${generatedSiteLabel(nearbySite.kind)}: уже пусто`
          : `[E] Осмотреть: ${generatedSiteLabel(nearbySite.kind)}`
      }
    }
    if (this.player.position.distanceTo(this.caravan.position) < 7) {
      return this.faction === 'guard'
        ? '[E] Досмотреть корован'
        : this.caravanCooldown > 0
          ? 'Корован уже ограбили'
          : '[E] ГРАБИТЬ КОРОВАН'
    }
    if (this.generatedSupplyCount > 0 && this.health < this.maxHealth) {
      return `[E] Съесть паёк • ${this.generatedSupplyCount}`
    }
    if (node) {
      const objective = this.objectives.find((entry) => entry.id === node.id)
      const site = this.generatedWorld.getSitePosition(node.siteId)
      const distance = site
        ? Math.round(
            Math.hypot(
              site.x - this.player.position.x,
              site.z - this.player.position.z,
            ),
          )
        : 0
      return `Цель: ${objective?.text ?? 'продолжить путь'} • ${distance} м`
    }
    return document.pointerLockElement === this.renderer.domElement
      ? ''
      : 'Нажми на мир, чтобы управлять камерой'
  }

  private isWalkablePosition(x: number, z: number, radius: number): boolean {
    return this.generatedWorld.collision.isWalkablePosition(x, z, radius)
  }

  private resolveCharacterOverlaps(position: THREE.Vector3, radius: number): boolean {
    const resolved = this.generatedWorld.collision.resolveMovement(
      { x: position.x, z: position.z },
      { x: position.x, z: position.z },
      radius,
      { preventSteepTerrain: true },
    )
    position.x = resolved.x
    position.z = resolved.z
    this.clampWorldPosition(position, radius)
    return resolved.blocked
  }

  private moveCharacter(
    position: THREE.Vector3,
    movementX: number,
    movementZ: number,
    radius: number,
    allowInactiveBounds = false,
  ): boolean {
    const resolved = this.generatedWorld.collision.resolveMovement(
      { x: position.x, z: position.z },
      { x: position.x + movementX, z: position.z + movementZ },
      radius,
      {
        preventSteepTerrain: true,
        requireActiveBounds: !allowInactiveBounds,
      },
    )
    position.x = resolved.x
    position.z = resolved.z
    return resolved.blocked
  }

  private isMovementPathClear(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    radius: number,
  ): boolean {
    const dx = endX - startX
    const dz = endZ - startZ
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / COLLISION_MAX_STEP))
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps
      if (
        !this.isWalkablePosition(
          startX + dx * progress,
          startZ + dz * progress,
          radius,
        )
      ) {
        return false
      }
    }
    return true
  }

  private getGeneratedNavigationWaypoint(
    position: THREE.Vector3,
    destination: THREE.Vector3,
    radius: number,
  ): THREE.Vector3 | null {
    const bounds = this.generatedWorld.bounds
    const cell = (value: number, minimum: number): number =>
      Math.floor((value - minimum) / GENERATED_NAVIGATION_CELL_SIZE)
    const key = [
      cell(position.x, bounds.minX),
      cell(position.z, bounds.minZ),
      cell(destination.x, bounds.minX),
      cell(destination.z, bounds.minZ),
      Math.round(radius * 10),
    ].join(':')
    let entry = this.generatedNavigationCache.get(key)
    if (entry && entry.expiresAt <= this.elapsed) {
      this.generatedNavigationCache.delete(key)
      entry = undefined
    }
    if (!entry) {
      for (const [cachedKey, cached] of this.generatedNavigationCache) {
        if (cached.expiresAt <= this.elapsed) {
          this.generatedNavigationCache.delete(cachedKey)
        }
      }
      if (this.generatedNavigationCache.size >= GENERATED_NAVIGATION_CACHE_LIMIT) {
        const oldestKey = this.generatedNavigationCache.keys().next().value
        if (oldestKey !== undefined) this.generatedNavigationCache.delete(oldestKey)
      }
      const path = this.generatedWorld.findPath(
        { x: position.x, z: position.z },
        { x: destination.x, z: destination.z },
      )
      entry = {
        expiresAt: this.elapsed + GENERATED_NAVIGATION_CACHE_TTL,
        waypoints:
          path && path.length > 0
            ? path.map((waypoint) => [waypoint.x, waypoint.z] as const)
            : null,
      }
      this.generatedNavigationCache.set(key, entry)
    }

    const minimumDistance = Math.max(0.65, radius * 1.25)
    const waypoint = entry.waypoints?.find(
      ([x, z]) =>
        Math.hypot(x - position.x, z - position.z) > minimumDistance,
    )
    if (!waypoint) return null
    this.navigationWaypoint.set(
      waypoint[0],
      this.groundHeightAt(waypoint[0], waypoint[1]),
      waypoint[1],
    )
    return this.navigationWaypoint
  }

  private getNavigationWaypoint(
    position: THREE.Vector3,
    destination: THREE.Vector3,
    radius: number,
  ): THREE.Vector3 | null {
    if (
      this.isMovementPathClear(
        position.x,
        position.z,
        destination.x,
        destination.z,
        radius,
      )
    ) {
      return null
    }
    return this.getGeneratedNavigationWaypoint(position, destination, radius)
  }

  private actorColliderRadiusForRole(role: ActorRole): number {
    if (isBeastRole(role)) return BEAST_PROFILES[role].colliderRadius
    return role === 'brute' || role === 'champion'
      ? LARGE_ACTOR_COLLIDER_RADIUS
      : ACTOR_COLLIDER_RADIUS
  }

  private moveActorWithSteering(
    actor: Actor,
    desiredDirection: THREE.Vector3,
    distance: number,
    allowInactiveBounds = false,
  ): number {
    const radius = this.actorColliderRadiusForRole(actor.role)
    const startX = actor.mesh.position.x
    const startZ = actor.mesh.position.z
    const steeringSign = Math.sin(actor.phase * 3.17 + 0.4) >= 0 ? 1 : -1
    let bestX = startX
    let bestZ = startZ
    let bestScore = Number.NEGATIVE_INFINITY

    for (const baseAngle of NPC_STEERING_ANGLES) {
      const angle = baseAngle * steeringSign
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const directionX = desiredDirection.x * cos - desiredDirection.z * sin
      const directionZ = desiredDirection.x * sin + desiredDirection.z * cos
      this.collisionProbe.copy(actor.mesh.position)
      this.moveCharacter(
        this.collisionProbe,
        directionX * distance,
        directionZ * distance,
        radius,
        allowInactiveBounds,
      )
      const movedX = this.collisionProbe.x - startX
      const movedZ = this.collisionProbe.z - startZ
      const travelled = Math.hypot(movedX, movedZ)
      const forwardProgress = movedX * desiredDirection.x + movedZ * desiredDirection.z
      const score = forwardProgress + travelled * 0.18 - Math.abs(angle) * distance * 0.015
      if (score <= bestScore) continue
      bestScore = score
      bestX = this.collisionProbe.x
      bestZ = this.collisionProbe.z
    }

    actor.mesh.position.x = bestX
    actor.mesh.position.z = bestZ
    actor.mesh.position.y = this.groundHeightAt(bestX, bestZ)
    return Math.hypot(bestX - startX, bestZ - startZ)
  }

  private updatePlayer(delta: number): void {
    const wasOnGround = this.onGround
    const forward = this.getAimDirection()
    const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, Math.sin(this.cameraYaw))
    const move = new THREE.Vector3()
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(forward)
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(forward)
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right)
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(right)

    const missingLegs =
      Number(this.body.leftLeg === 'missing') + Number(this.body.rightLeg === 'missing')
    const prostheticLegs =
      Number(this.body.leftLeg === 'prosthetic') + Number(this.body.rightLeg === 'prosthetic')
    let mobility = missingLegs === 2 ? 0.24 : missingLegs === 1 ? 0.53 : 1
    if (prostheticLegs > 0) mobility *= 0.9
    if (
      this.faction === 'elf' &&
      this.zoneAtPosition(this.player.position.x, this.player.position.z) === 'forest'
    ) {
      mobility *= 1.14
    }

    const sprinting =
      !this.shieldActive &&
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) &&
      this.stamina > 2 &&
      move.lengthSq() > 0 &&
      missingLegs === 0
    this.isSprinting = sprinting
    const speed =
      8.2 *
      mobility *
      (sprinting ? 1.65 : 1) *
      (this.shieldActive ? SHIELD_SPEED_MULTIPLIER : 1)
    if (this.shieldActive) {
      this.stamina = Math.max(0, this.stamina - delta * SHIELD_STAMINA_DRAIN)
      if (this.stamina === 0) {
        this.dropShield()
        this.callbacks.onNotice('Выносливость кончилась — щит опущен.', 'warning')
      }
    } else if (sprinting) {
      this.stamina = Math.max(0, this.stamina - delta * 24)
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + delta * 16)
    }

    if (move.lengthSq() > 0) {
      move.normalize()
      this.moveCharacter(
        this.player.position,
        move.x * speed * delta,
        move.z * speed * delta,
        PLAYER_COLLIDER_RADIUS,
      )
      this.player.rotation.y = this.shieldActive
        ? Math.atan2(forward.x, forward.z)
        : Math.atan2(move.x, move.z)
      const stride = Math.sin(this.elapsed * (sprinting ? 15 : 10)) * 0.62
      this.animateCharacter(this.player, {
        stride,
        attack: this.attackAnimation,
        anticipation: 0,
        recovery: 0,
        flinch: 0,
        stagger: 0,
      })
    } else {
      if (this.shieldActive) this.player.rotation.y = Math.atan2(forward.x, forward.z)
      this.animateCharacter(this.player, {
        stride: 0,
        attack: this.attackAnimation,
        anticipation: 0,
        recovery: 0,
        flinch: 0,
        stagger: 0,
      })
    }

    const jumpHeld = this.keys.has('Space')
    let tookOff = false
    if (jumpHeld && this.onGround && missingLegs < 2) {
      this.verticalVelocity = missingLegs === 1 ? 6.2 : 8.5
      this.onGround = false
      tookOff = true
      this.playSound('jump')
    }
    const jumpLatch = advanceJumpAccentLatch(this.jumpAccentArmed, jumpHeld, tookOff)
    this.jumpAccentArmed = jumpLatch.armed
    if (jumpLatch.triggered) this.queueCameraAccent('jump', 1, 0.18)
    const groundHeight = this.groundHeightAt(
      this.player.position.x,
      this.player.position.z,
    )
    if (this.onGround) this.player.position.y = groundHeight
    this.verticalVelocity -= 23 * delta
    this.player.position.y += this.verticalVelocity * delta
    if (this.player.position.y <= groundHeight) {
      const landed = !this.onGround && this.verticalVelocity < -2
      this.player.position.y = groundHeight
      this.verticalVelocity = 0
      this.onGround = true
      if (landed) this.playSound('land')
    }
    const airborneUpdate = advanceAirborneState(
      this.airborneTime,
      wasOnGround,
      this.onGround,
      delta,
    )
    this.airborneTime = airborneUpdate.airborneTime
    if (airborneUpdate.landed) this.queueCameraAccent('land', -1.4, 0.16)

  }

  private updateActors(delta: number): void {
    for (const actor of this.actors) {      this.updateActorIndicators(actor)
      if (!actor.alive) {
        this.updateActorDeathMotion(actor, delta)
        continue
      }
      actor.attackCooldown = Math.max(0, actor.attackCooldown - delta)
      actor.wanderTimer = Math.max(0, actor.wanderTimer - delta)
      actor.idleTimer = Math.max(0, actor.idleTimer - delta)
      actor.retreatTimer = Math.max(0, actor.retreatTimer - delta)
      actor.aggroMemory = Math.max(0, actor.aggroMemory - delta)
      actor.rageTimer = Math.max(0, actor.rageTimer - delta)
      actor.alertCooldown = Math.max(0, actor.alertCooldown - delta)
      actor.retaliationTimer = Math.max(0, actor.retaliationTimer - delta)
      actor.routTimer = Math.max(0, actor.routTimer - delta)
      actor.rallyTimer = Math.max(0, actor.rallyTimer - delta)
      actor.commanderLostTimer = Math.max(0, actor.commanderLostTimer - delta)
      actor.alertTimer = Math.max(0, actor.alertTimer - delta)
      if (actor.alertTimer <= 0) actor.alertPos = null
      actor.chargeCooldown = Math.max(0, actor.chargeCooldown - delta)
      if (actor.order) {
        actor.order.timer -= delta
        if (actor.order.timer <= 0) actor.order = null
      }
      this.updateActorReaction(actor, delta)
      const knockbackSpeed = this.updateActorKnockback(actor, delta)
      if (actor.role === 'commander' && actor.reaction !== 'stagger') {
        this.updateCommander(actor, delta)
      }
      this.updateActorMorale(actor, delta)
      // §5D — where a villager is heading next: another spot in the village by day, the
      // fire by night. Run before the movement block so the routine is what `home` says.
      if (actor.allegiance === 'civilian') this.updateCivilianRoutine(actor)
      if (isBeastRole(actor.role) && this.updateBeastCharge(actor, delta)) continue
      if (actor.action) {
        this.updateActorAction(actor, delta)
        actor.velocity.set(0, 0, 0)
        actor.stride = THREE.MathUtils.damp(actor.stride, 0, 13, delta)
        actor.motionBlend = THREE.MathUtils.damp(actor.motionBlend, 0, 9, delta)
        this.animateActorCharacter(actor, delta, 0)
        this.updateChampionAura(actor)
        continue
      }
      if (actor.reaction === 'stagger' || knockbackSpeed > KNOCKBACK_STEER_THRESHOLD) {
        actor.velocity.set(0, 0, 0)
        actor.stride = THREE.MathUtils.damp(actor.stride, 0, 13, delta)
        actor.motionBlend = THREE.MathUtils.damp(actor.motionBlend, 0, 9, delta)
        this.animateActorCharacter(actor, delta, 0)
        this.updateChampionAura(actor)
        continue
      }
      if (actor.aiMode === 'captive') {
        actor.stride = THREE.MathUtils.damp(actor.stride, 0, 13, delta)
        actor.motionBlend = THREE.MathUtils.damp(actor.motionBlend, 0, 9, delta)
        this.animateActorCharacter(actor, delta, 0)
        continue
      }
      // Broken: it runs, and it does not stop to fight. A pack clears the square; a
      // soldier falls back on his rally point and can be talked round.
      if (actor.routTimer > 0) {
        this.updateRoutingActor(actor, delta)
        continue
      }

      const toPlayer = this.player.position.clone().sub(actor.mesh.position)
      toPlayer.y = 0
      const playerDistance = toPlayer.length()
      const direction = new THREE.Vector3()
      const facingDirection = new THREE.Vector3()
      let moving = false
      let movementDistanceLimit = Number.POSITIVE_INFINITY
      let targetActor: Actor | null = null
      let targetEventProp: EventPropTarget | null = null
      let targetsPlayer = false
      let pursuesPlayer = false
      /** Walking to a remembered or reported position rather than at something visible. */
      let investigating = false
      let targetPosition: THREE.Vector3 | null = null
      let wandering = false
      let followingFormation = false
      const baseAggroRange = isBeastRole(actor.role)
        ? BEAST_SENSE_RANGE
        : actor.role === 'archer'
          ? 18
          : 15
      const enraged = actor.rageTimer > 0
      const senseRange = baseAggroRange + (enraged ? RAGE_RANGE_BONUS : 0)
      const leashRange = isBeastRole(actor.role)
        ? BEAST_LEASH_RANGE
        : senseRange * 2.25
      const colliderRadius = this.actorColliderRadiusForRole(actor.role)
      const hostileToPlayer = actor.hostileToPlayer
      const commandedSquadMember =
        actor.allegiance === this.faction &&
        actor.squadEligible &&
        this.squadFollowing &&
        actor.role !== 'commander'
      const regroupingWithSquad =
        commandedSquadMember && shouldSquadRegroup(playerDistance)
      const canSensePlayer = hostileToPlayer && playerDistance < senseRange
      const canTrackPlayer =
        hostileToPlayer && actor.playerAggro && playerDistance < leashRange
      // Captured before the sense block writes it, so "spotted the player just now" can
      // be told apart from "has been chasing them for a while" and only the first shouts.
      const wasPursuingPlayer = actor.playerAggro
      if (canSensePlayer || canTrackPlayer) {
        actor.playerAggro = true
        actor.aggroMemory = AGGRO_MEMORY_DURATION
        if (actor.lastKnownTargetPos) actor.lastKnownTargetPos.copy(this.player.position)
        else actor.lastKnownTargetPos = this.player.position.clone()
      }
      const pursuit = evaluatePlayerPursuit({
        hostileToPlayer,
        playerAggro: actor.playerAggro,
        aggroMemory: actor.aggroMemory,
        playerDistance,
        senseRange,
        leashRange,
      })
      const shouldPursuePlayer = pursuit.shouldPursue
      if (!shouldPursuePlayer) {
        actor.playerAggro = false
        actor.aggroMemory = 0
        actor.lastKnownTargetPos = null
      }
      let retaliationTarget: Actor | null = null
      if (regroupingWithSquad) {
        actor.retaliationTimer = 0
        actor.targetId = null
      } else if (actor.retaliationTimer > 0 && actor.targetId) {
        const candidate = this.actors.find((other) => other.id === actor.targetId)
        if (
          candidate?.alive &&
          candidate.id !== actor.ignoredTargetId &&
          hostile(actor.allegiance, candidate.allegiance)
        ) {
          retaliationTarget = candidate
        } else {
          actor.retaliationTimer = 0
          actor.targetId = null
        }
      }
      const assignedEventProp = actor.eventPropTargetId
        ? this.eventPropTargets.get(actor.eventPropTargetId)
        : undefined

      if (retaliationTarget) {
        targetActor = retaliationTarget
        targetPosition = retaliationTarget.mesh.position
      } else if (
        actor.aiMode === 'attackEventProp' &&
        assignedEventProp &&
        assignedEventProp.hp > 0 &&
        actor.rageTimer <= 0
      ) {
        actor.targetId = null
        actor.playerAggro = false
        targetEventProp = assignedEventProp
        targetPosition = targetEventProp.position
      } else {
        // §5C.1 — one scored pass over every hostile *and* the player, rather than the
        // Layer 3 order of "can I see the player? then nothing else exists". That
        // ordering measured out as a step function at 21 m (§9 Q2); scoring them
        // together is what removes it.
        //
        // The ranges are unchanged: a soldier still only picks NPC fights within 6.5 m
        // and only while the player is close enough to see it happen, because NPCs
        // converging across a whole square was never the problem.
        const huntRadius = commandedSquadMember
          ? actor.role === 'archer'
            ? 15
            : 9
          : isBeastRole(actor.role)
            ? BEAST_SENSE_RANGE
            : actor.role === 'archer'
              ? 15
              : 6.5
        const canHunt =
          actor.role !== 'commander' &&
          !regroupingWithSquad &&
          (commandedSquadMember || playerDistance < 32 || isBeastRole(actor.role))
        const playerThreat: PlayerThreat | null =
          shouldPursuePlayer && (pursuit.canSense || pursuit.canTrack)
            ? {
                position: this.player.position,
                hpFraction: this.maxHealth > 0 ? this.health / this.maxHealth : 1,
                provoked: actor.playerAggro,
              }
            : null
        const previousTargetId = actor.targetId
        const choice =
          canHunt || playerThreat
            ? selectThreat(
                actor,
                this.actors,
                canHunt ? huntRadius : 0,
                actorPosition,
                playerThreat,
              )
            : null

        if (choice === THREAT_PLAYER) {
          actor.targetId = null
          pursuesPlayer = true
          targetsPlayer = true
          targetPosition = this.player.position
          // Something to fight outranks a report of something to fight.
          actor.alertTimer = 0
          actor.alertPos = null
          // §5C.3 — a beast that has just caught the player's scent tells the pack.
          if (!wasPursuingPlayer) {
            this.announceSighting(actor, null, this.player.position)
          }
        } else if (choice) {
          targetActor = choice
          actor.targetId = choice.id
          targetPosition = choice.mesh.position
          actor.alertTimer = 0
          actor.alertPos = null
          // §5C.3 — first sight of something new is worth shouting about. Re-shouting at
          // the same target every 1.5 s would just be noise.
          if (choice.id !== previousTargetId) {
            this.announceSighting(actor, choice.id, choice.mesh.position)
          }
        } else {
          actor.targetId = null
          if (shouldPursuePlayer && actor.lastKnownTargetPos) {
            pursuesPlayer = true
            investigating = true
            targetPosition = actor.lastKnownTargetPos
          } else if (actor.alertTimer > 0 && actor.alertPos) {
            // §5C.3 — an ally shouted. Go and look, then decide for yourself: the alert
            // carries a place, not an order, so the scoring above runs again on arrival.
            if (
              actor.mesh.position.distanceToSquared(actor.alertPos) <=
              ALERT_ARRIVAL_DISTANCE * ALERT_ARRIVAL_DISTANCE
            ) {
              actor.alertTimer = 0
              actor.alertPos = null
            } else {
              investigating = true
              targetPosition = actor.alertPos
            }
          } else if (commandedSquadMember) {
            followingFormation = true
            const formationAngle = actor.phase * 3.7
            const formationTarget = this.player.position
              .clone()
              .add(new THREE.Vector3(Math.sin(formationAngle) * 3.2, 0, Math.cos(formationAngle) * 3.2))
            const navigationTarget = this.getNavigationWaypoint(
              actor.mesh.position,
              formationTarget,
              colliderRadius,
            )
            const toFormation = (navigationTarget ?? formationTarget)
              .clone()
              .sub(actor.mesh.position)
            toFormation.y = 0
            const formationDistance = toFormation.length()
            if (formationDistance > (navigationTarget ? 0.005 : 1.1)) {
              direction.copy(toFormation).normalize()
              moving = true
              if (navigationTarget) movementDistanceLimit = formationDistance
            }
          } else if (actor.role !== 'commander') {
            const postDistance = this.moveToOrderPost(actor, direction, colliderRadius)
            if (postDistance > 0) {
              // §5C.4 — a standing order beats wandering: a garrison holds its site
              // instead of drifting, and a raid walks onto what it came for.
              moving = true
              movementDistanceLimit = postDistance
            } else {
              wandering = true
              let navigationTarget = this.getNavigationWaypoint(
                actor.mesh.position,
                actor.wanderTarget,
                colliderRadius,
              )
              const toWaypoint = (navigationTarget ?? actor.wanderTarget)
                .clone()
                .sub(actor.mesh.position)
              toWaypoint.y = 0
              if (
                actor.wanderTimer <= 0 ||
                toWaypoint.length() < 0.65 ||
                actor.mesh.position.distanceTo(actor.home) > 10
              ) {
                this.chooseWanderTarget(actor)
                navigationTarget = this.getNavigationWaypoint(
                  actor.mesh.position,
                  actor.wanderTarget,
                  colliderRadius,
                )
                toWaypoint
                  .copy(navigationTarget ?? actor.wanderTarget)
                  .sub(actor.mesh.position)
                toWaypoint.y = 0
              }
              const waypointDistance = toWaypoint.length()
              if (
                actor.idleTimer <= 0 &&
                waypointDistance > (navigationTarget ? 0.005 : 0.3)
              ) {
                direction.copy(toWaypoint).normalize()
                moving = true
                if (navigationTarget) movementDistanceLimit = waypointDistance
              }
            }
          }
        }
      }

      if (targetPosition) {
        const offset = targetPosition.clone().sub(actor.mesh.position)
        offset.y = 0
        const distance = offset.length()
        if (distance > 0.001) facingDirection.copy(offset).normalize()
        const navigationTarget = this.getNavigationWaypoint(
          actor.mesh.position,
          targetPosition,
          colliderRadius,
        )

        if (navigationTarget) {
          const navigationOffset = navigationTarget.clone().sub(actor.mesh.position)
          navigationOffset.y = 0
          const navigationDistance = navigationOffset.length()
          if (navigationDistance > 0.005) {
            direction.copy(navigationOffset).normalize()
            facingDirection.copy(direction)
            moving = true
            movementDistanceLimit = navigationDistance
          }
        } else if (investigating) {
          if (distance > 0.75) {
            direction.copy(facingDirection)
            moving = true
          }
        } else if (actor.role === 'archer' && !targetEventProp) {
          if (distance < ARCHER_MIN_RANGE) {
            direction.copy(facingDirection).negate()
            moving = true
          } else if (distance > ARCHER_MAX_RANGE) {
            direction.copy(facingDirection)
            moving = true
          }
          if (distance <= ARCHER_MAX_RANGE + 0.75 && actor.attackCooldown <= 0) {
            this.startActorAction(
              actor,
              'arrow',
              targetActor
                ? { kind: 'actor', id: targetActor.id }
                : { kind: 'player' },
              targetPosition,
              ARCHER_MAX_RANGE,
            )
          }
        } else if (actor.retreatTimer > 0) {
          direction.copy(facingDirection).negate()
          moving = true
        } else if (
          actor.role === 'boar' &&
          !targetEventProp &&
          actor.chargeCooldown <= 0 &&
          distance > 3.4 &&
          distance < BOAR_CHARGE_RANGE
        ) {
          // A boar does not close the distance, it commits to it. The wind-up is the
          // tell; after that it cannot steer, so it can be side-stepped.
          actor.chargeWindup = BOAR_CHARGE_WINDUP
          actor.chargeDirection.copy(facingDirection)
          actor.velocity.set(0, 0, 0)
        } else {
          const stopDistance = targetEventProp
            ? targetEventProp.attackRange
            : targetsPlayer
              ? 2.55
              : 2.45
          if (distance > stopDistance) {
            direction.copy(facingDirection)
            // §5C.5 — secondary attackers come in off the line instead of queueing on
            // the primary's approach. The offset fades to nothing over the last few
            // metres, or the offset point would rotate as fast as the attacker moves
            // and it would orbit the target forever.
            const flank = this.flankApproachOffset(
              actor,
              targetActor,
              targetsPlayer,
              distance,
              stopDistance,
            )
            if (flank !== 0) direction.applyAxisAngle(WORLD_UP, flank)
            moving = true
          } else if (actor.attackCooldown <= 0) {
            if (targetsPlayer) {
              this.startActorAction(
                actor,
                'meleePlayer',
                { kind: 'player' },
                targetPosition,
                stopDistance,
              )
            } else if (targetActor) {
              this.startActorAction(
                actor,
                'meleeActor',
                { kind: 'actor', id: targetActor.id },
                targetPosition,
                stopDistance,
              )
            } else if (targetEventProp) {
              this.startActorAction(
                actor,
                'eventProp',
                { kind: 'eventProp', id: targetEventProp.id },
                targetPosition,
                stopDistance,
              )
            }
          }
        }
      }

      if (actor.action) {
        actor.velocity.set(0, 0, 0)
        actor.stride = THREE.MathUtils.damp(actor.stride, 0, 13, delta)
        actor.motionBlend = THREE.MathUtils.damp(actor.motionBlend, 0, 9, delta)
        this.animateActorCharacter(actor, delta, 0)
        this.updateChampionAura(actor)
        continue
      }

      if (actor.role !== 'commander') {
        const separation = this.getActorSeparation(actor)
        if (separation.lengthSq() > 0.0001) {
          direction.addScaledVector(separation, moving ? 0.72 : 1)
          moving = true
        }
      }

      let desiredSpeed = 0
      if (moving && direction.lengthSq() > 0) {
        const movementSpeed = followingFormation
          ? getSquadFollowSpeed(actor.speed, playerDistance)
          : actor.speed
        // §5D — a storm slows the *walking*, never the fighting. Trudging through sleet
        // is what weather looks like; a 22% combat penalty in the rain would be a balance
        // change nobody asked for, and it comes from `WorldEnvironment`'s mix rather than
        // from `weatherEnabled`, so switching precipitation off cannot change it.
        const inCombat =
          targetsPlayer ||
          targetActor !== null ||
          targetEventProp !== null ||
          retaliationTarget !== null
        desiredSpeed =
          movementSpeed *
          (pursuesPlayer || retaliationTarget ? 1.25 : 1) *
          (enraged ? RAGE_SPEED_MULTIPLIER : 1) *
          (this.hasCommanderAura(actor) ? COMMANDER_SPEED_MULTIPLIER : 1) *
          (wandering ? actor.wanderPace : 1) *
          (inCombat || isBeastRole(actor.role) ? 1 : this.ambientStormPace)
        direction.normalize()
      }

      const velocityDamping = moving ? NPC_ACCELERATION_DAMPING : NPC_BRAKING_DAMPING
      const desiredVelocityX = direction.x * desiredSpeed
      const desiredVelocityZ = direction.z * desiredSpeed
      actor.velocity.x = THREE.MathUtils.damp(
        actor.velocity.x,
        desiredVelocityX,
        velocityDamping,
        delta,
      )
      actor.velocity.z = THREE.MathUtils.damp(
        actor.velocity.z,
        desiredVelocityZ,
        velocityDamping,
        delta,
      )

      const requestedSpeed = Math.hypot(actor.velocity.x, actor.velocity.z)
      let travelled = 0
      if (requestedSpeed > 0.02) {
        direction.set(actor.velocity.x / requestedSpeed, 0, actor.velocity.z / requestedSpeed)
        const requestedDistance = Math.min(requestedSpeed * delta, movementDistanceLimit)
        travelled = this.moveActorWithSteering(
          actor,
          direction,
          requestedDistance,
          followingFormation,
        )
        if (
          requestedDistance > 0.001 &&
          travelled / requestedDistance < NPC_BLOCKED_SPEED_RATIO
        ) {
          actor.velocity.multiplyScalar(0.35)
        }
      } else {
        actor.velocity.set(0, 0, 0)
      }

      const actualSpeed = delta > 0 ? travelled / delta : 0
      actor.visualSpeed = THREE.MathUtils.damp(actor.visualSpeed, actualSpeed, 14, delta)
      const roleSpeed = Math.max(actor.speed, 0.1)
      const desiredMotionBlend = THREE.MathUtils.clamp(actor.visualSpeed / roleSpeed, 0, 1.18)
      actor.motionBlend = THREE.MathUtils.damp(actor.motionBlend, desiredMotionBlend, 9, delta)
      actor.gaitPhase += travelled * this.actorGaitCadence(actor.role)
      const desiredStride = Math.sin(actor.gaitPhase) * 0.62 * actor.motionBlend
      actor.stride = THREE.MathUtils.damp(actor.stride, desiredStride, 15, delta)

      const turnDirection =
        actualSpeed > 0.08
          ? direction
          : facingDirection.lengthSq() > 0
            ? facingDirection
            : null
      let lookYaw = Math.sin(this.elapsed * 0.62 + actor.phase * 2.3) * 0.3
      if (turnDirection) {
        const targetYaw = Math.atan2(turnDirection.x, turnDirection.z)
        const yawDelta = Math.atan2(
          Math.sin(targetYaw - actor.mesh.rotation.y),
          Math.cos(targetYaw - actor.mesh.rotation.y),
        )
        actor.turnLean = THREE.MathUtils.damp(
          actor.turnLean,
          THREE.MathUtils.clamp(yawDelta, -0.5, 0.5),
          8,
          delta,
        )
        actor.mesh.rotation.y = dampAngle(actor.mesh.rotation.y, targetYaw, 9, delta)
        if (facingDirection.lengthSq() > 0) {
          const facingYaw = Math.atan2(facingDirection.x, facingDirection.z)
          lookYaw = THREE.MathUtils.clamp(
            Math.atan2(
              Math.sin(facingYaw - actor.mesh.rotation.y),
              Math.cos(facingYaw - actor.mesh.rotation.y),
            ),
            -0.65,
            0.65,
          )
        }
      } else {
        actor.turnLean = THREE.MathUtils.damp(actor.turnLean, 0, 8, delta)
      }
      this.animateActorCharacter(actor, delta, lookYaw)
      this.updateChampionAura(actor)
    }
    // A beast that ran clear of the field is gone, not standing at the map edge running
    // on the spot: this is what makes breaking a pack a way to actually end a raid.
    for (const actorId of this.fledBeastIds) this.removeActorById(actorId)
    this.fledBeastIds.length = 0
  }

  /**
   * §5C.2 — morale, for everything on the field. One entry point, two reasons.
   *
   * `ActorAi.evaluateMorale` owns the rule; this counts the inputs and starts the clock.
   * The two halves are deliberately not two systems: cohesion breaks a pack that has
   * lost its own kind, individual morale breaks anything that is hurt, alone, or has
   * just watched its commander go down. A wolf whose kin size is one falls through the
   * first and is caught by the second, which is exactly the `bear+wolf+boar` case §9
   * measured at 0 routs and correctly refused to call a bug.
   *
   * Roles whose `actorResolve` is `null` never get here at all. That is where campaign
   * safety lives: a commander cannot rout, so an objective that requires killing him can
   * never be stranded by one.
   */
  private updateActorMorale(actor: Actor, delta: number): void {
    actor.moraleTimer -= delta
    if (actor.moraleTimer > 0) return
    actor.moraleTimer += MORALE_CHECK_INTERVAL
    if (actor.aiMode === 'captive' || actor.rallyTimer > 0) return

    // A commander in earshot is both a morale bonus and, for someone already running,
    // the thing that turns them round.
    const commander = this.nearbyCommander(actor)
    if (actor.routTimer > 0) {
      // §5D — panic tracks. A villager already running re-measures what frightened it on
      // every check, which does two things the frozen version got wrong: it keeps running
      // while the wolf is still there instead of stopping every four seconds to be
      // caught, and it runs from where the wolf *is* rather than from where it was when
      // the panic started — a stale `alarmPos` curves the villager back into it.
      if (actor.routReason === 'panic') {
        const chasing = this.findCivilianAlarmFor(actor)
        if (chasing) {
          actor.routTimer = CIVILIAN_PANIC_SECONDS
          if (actor.alarmPos) {
            actor.alarmPos.set(chasing.source.x, chasing.source.y, chasing.source.z)
          } else {
            actor.alarmPos = new THREE.Vector3(
              chasing.source.x,
              chasing.source.y,
              chasing.source.z,
            )
          }
        }
        return
      }
      if (commander) this.rallyActor(actor)
      return
    }
    // The rout timer ran out. Recovery has to happen *here* rather than in
    // `updateRoutingActor`, because the frame the timer reaches zero skips the routing
    // branch entirely — putting it there left it unreachable, and an actor that had run
    // its clock out simply re-broke on the same frame and ran forever.
    if (actor.routReason !== 'none') {
      const panicked = actor.routReason === 'panic'
      actor.routReason = 'none'
      actor.alarmPos = null
      actor.rallyTimer = panicked ? CIVILIAN_PANIC_RECOVERY : MORALE_RALLY_SECONDS
      return
    }

    const alarm = this.findCivilianAlarmFor(actor)
    const broke = evaluateMorale(actor.role, {
      hpFraction: actor.maxHp > 0 ? actor.hp / actor.maxHp : 1,
      groupShare: localGroupShare(actor, this.actors, MORALE_GROUP_RADIUS, actorPosition),
      packShare: this.beastPackShare(actor),
      commanderNearby: commander !== null,
      commanderLost: actor.commanderLostTimer > 0,
      alarmDistance: alarm ? alarm.distance : Number.POSITIVE_INFINITY,
    })
    if (broke === 'none') return

    // §5D — panic is shorter and shallower than a rout on purpose. A villager keeps its
    // back to whatever frightened it rather than falling back on a rally point it does
    // not have, and its nerve returns in a second and a half so that a wolf still
    // standing over it starts the reflex again instead of leaving it standing there for
    // the full twelve seconds of rally immunity.
    if (broke === 'panic') {
      actor.routTimer = CIVILIAN_PANIC_SECONDS
      if (alarm) {
        if (actor.alarmPos) {
          actor.alarmPos.set(alarm.source.x, alarm.source.y, alarm.source.z)
        } else {
          actor.alarmPos = new THREE.Vector3(
            alarm.source.x,
            alarm.source.y,
            alarm.source.z,
          )
        }
      }
    } else {
      actor.routTimer = isBeastRole(actor.role) ? BEAST_ROUT_SECONDS : MORALE_ROUT_SECONDS
    }
    actor.routReason = broke
    actor.action = null
    actor.targetId = null
    actor.playerAggro = false
    actor.aggroMemory = 0
    actor.lastKnownTargetPos = null
    this.announceMoraleEvent(actor, describeRout(broke))
  }

  /**
   * §5D — what this actor would run from, or `null`. Non-bystanders never have one, and
   * the player only counts for a few seconds after they swing at something.
   */
  private findCivilianAlarmFor(actor: Actor): CivilianAlarm | null {
    if (!isPacifistRole(actor.role)) return null
    return findCivilianAlarm(
      actor,
      this.actors,
      CIVILIAN_ALARM_RADIUS,
      actorPosition,
      this.elapsed < this.civilianMenaceUntil
        ? { position: this.player.position, menacing: true }
        : null,
    )
  }

  /**
   * A rout the player cannot see is a number; one they can see is a moment. Rate-limited
   * because a squad breaking together would otherwise fill the feed with the same line.
   */
  private announceMoraleEvent(actor: Actor, message: string): void {    if (this.moraleNoticeCooldown > 0) return
    if (actor.mesh.position.distanceTo(this.player.position) > MORALE_NOTICE_RANGE) return
    this.moraleNoticeCooldown = MORALE_NOTICE_COOLDOWN
    this.callbacks.onNotice(message, 'info')
  }

  /** A living commander of this actor's own side, close enough to be heard. */
  private nearbyCommander(actor: Actor): Actor | null {
    if (actor.role === 'commander') return null
    for (const other of this.actors) {
      if (
        other.alive &&
        other.role === 'commander' &&
        other.reaction !== 'stagger' &&
        allegianceRelation(other.allegiance, actor.allegiance) === 'friendly' &&
        other.mesh.position.distanceToSquared(actor.mesh.position) <=
          COMMANDER_ORDER_RANGE * COMMANDER_ORDER_RANGE
      ) {
        return other
      }
    }
    return null
  }

  /** Back in the line, and steadied long enough that it does not break again instantly. */
  private rallyActor(actor: Actor): void {
    if (actor.routTimer <= 0) return
    actor.routTimer = 0
    actor.routReason = 'none'
    actor.rallyTimer = MORALE_RALLY_SECONDS
    actor.commanderLostTimer = 0
    this.announceMoraleEvent(actor, RALLY_NOTICE)
  }

  /**
   * Share of this beast's original pack still standing *and still nearby*. Distance
   * matters: a wolf that has been drawn away from the pack is as alone as one whose
   * pack is dead, which is why chasing a single wolf off is a viable tactic.
   */
  private beastPackShare(actor: Actor): number {
    return beastPackShare(actor, this.actors, WOLF_PACK_RADIUS, actorPosition)
  }

  /**
   * A broken actor runs, and animates while it does. Where it runs is the difference
   * between the two halves of §5C.2:
   *
   * - **A beast runs from whatever broke it** and, past the leash, is gone. That is what
   *   makes breaking a pack a way to end a raid.
   * - **A soldier falls back on his rally point** — `home`, which for a garrison is the
   *   site it spawned on — and stays in the world the whole time. He can be chased down,
   *   he can be rallied, and he comes back when he has got his nerve back. Nothing that
   *   an objective might need ever leaves the map because it lost a morale check.
   */
  private updateRoutingActor(actor: Actor, delta: number): void {
    const away = new THREE.Vector3()
    if (actor.routReason === 'panic') {
      // §5D — a villager has no rally point to fall back on, so it simply puts the thing
      // that frightened it behind itself. `alarmPos` rather than `nearestThreatPosition`
      // because the frightening thing is very often not hostile to the villager at all:
      // two soldiers fighting each other are `neutral` to it by the matrix and would not
      // be found by a hostility search.
      away
        .copy(actor.mesh.position)
        .sub(actor.alarmPos ?? this.nearestThreatPosition(actor))
    } else if (isBeastRole(actor.role)) {
      away.copy(actor.mesh.position).sub(this.nearestThreatPosition(actor))
    } else {
      away.copy(actor.home).sub(actor.mesh.position)
      away.y = 0
      // The rally point is already underfoot: falling back on it is not an option, so
      // give ground to whatever is doing the killing instead. Without this a soldier who
      // breaks while standing on his post just stands there being hit — the "rout as
      // skip your turn" failure that inverted the first measurement this harness took.
      if (away.lengthSq() <= MORALE_RALLY_POINT_TOLERANCE * MORALE_RALLY_POINT_TOLERANCE) {
        away.copy(actor.mesh.position).sub(this.nearestThreatPosition(actor))
        actor.routTimer = Math.min(actor.routTimer, MORALE_LAST_STAND_SECONDS)
      }
    }
    away.y = 0
    if (away.lengthSq() < 0.0001) away.set(Math.sin(actor.phase), 0, Math.cos(actor.phase))
    away.normalize()
    // §5D — a villager runs harder than a soldier giving ground. Measured, not chosen:
    // at the ordinary 1.15× a villager cannot outpace a wolf and scattering saved zero
    // lives in 60 fights, which is dead content. See `CIVILIAN_PANIC_SPEED_MULTIPLIER`.
    const flightSpeed =
      actor.speed *
      (actor.routReason === 'panic' ? CIVILIAN_PANIC_SPEED_MULTIPLIER : 1.15)
    const travelled = this.moveActorWithSteering(actor, away, flightSpeed * delta)
    actor.velocity.set(away.x * actor.speed, 0, away.z * actor.speed)
    const yaw = Math.atan2(away.x, away.z)
    actor.mesh.rotation.y = dampAngle(actor.mesh.rotation.y, yaw, 9, delta)
    actor.motionBlend = THREE.MathUtils.damp(actor.motionBlend, 1, 9, delta)
    actor.gaitPhase += travelled * this.actorGaitCadence(actor.role)
    actor.stride = THREE.MathUtils.damp(
      actor.stride,
      Math.sin(actor.gaitPhase) * 0.62 * actor.motionBlend,
      15,
      delta,
    )
    this.animateActorCharacter(actor, delta, 0)
    if (
      isBeastRole(actor.role) &&
      actor.mesh.position.distanceTo(this.player.position) > BEAST_LEASH_RANGE
    ) {
      this.fledBeastIds.push(actor.id)
    }
  }

  /** Nearest thing this actor is at war with — the player counts as one of them. */
  private nearestThreatPosition(actor: Actor): THREE.Vector3 {
    let nearest = this.player.position
    let bestDistance = actor.hostileToPlayer
      ? actor.mesh.position.distanceToSquared(this.player.position)
      : Number.POSITIVE_INFINITY
    for (const other of this.actors) {
      if (!other.alive || other === actor) continue
      if (!hostile(actor.allegiance, other.allegiance)) continue
      const distance = actor.mesh.position.distanceToSquared(other.mesh.position)
      if (distance >= bestDistance) continue
      bestDistance = distance
      nearest = other.mesh.position
    }
    return nearest
  }

  /**
   * The boar's committed charge. Returns true while the charge owns the actor, so the
   * normal steering, targeting and separation code is skipped for its duration.
   */
  private updateBeastCharge(actor: Actor, delta: number): boolean {
    if (actor.role !== 'boar') return false
    if (actor.chargeWindup > 0) {
      actor.chargeWindup = Math.max(0, actor.chargeWindup - delta)
      actor.velocity.set(0, 0, 0)
      actor.stride = THREE.MathUtils.damp(actor.stride, 0, 13, delta)
      actor.motionBlend = THREE.MathUtils.damp(actor.motionBlend, 0, 9, delta)
      this.animateActorCharacter(actor, delta, 0)
      if (actor.chargeWindup <= 0) actor.chargeTimer = BOAR_CHARGE_DURATION
      return true
    }
    if (actor.chargeTimer <= 0) return false

    actor.chargeTimer = Math.max(0, actor.chargeTimer - delta)
    const step = BOAR_CHARGE_SPEED * delta
    const travelled = this.moveActorWithSteering(actor, actor.chargeDirection, step)
    actor.mesh.rotation.y = Math.atan2(actor.chargeDirection.x, actor.chargeDirection.z)
    actor.motionBlend = 1.18
    actor.gaitPhase += travelled * this.actorGaitCadence(actor.role)
    actor.stride = Math.sin(actor.gaitPhase) * 0.62
    this.animateActorCharacter(actor, delta, 0)
    this.resolveBoarChargeContact(actor)
    // A charge that hits a wall ends there rather than grinding along it.
    if (actor.chargeTimer <= 0 || travelled < step * 0.25) {
      actor.chargeTimer = 0
      actor.chargeCooldown = BOAR_CHARGE_COOLDOWN
    }
    return true
  }

  private resolveBoarChargeContact(actor: Actor): void {
    const reach = this.actorColliderRadiusForRole(actor.role) + 1.5
    if (
      actor.hostileToPlayer &&
      this.health > 0 &&
      actor.mesh.position.distanceTo(this.player.position) <= reach
    ) {
      const incoming = actor.mesh.position.clone().sub(this.player.position)
      incoming.y = 0
      this.damagePlayer(BOAR_CHARGE_DAMAGE * this.enemyDamageMultiplier(actor), incoming, true, {
        attackKind: 'allyMelee',
      })
      actor.chargeTimer = 0
      actor.chargeCooldown = BOAR_CHARGE_COOLDOWN
      return
    }
    for (const other of this.actors) {
      if (
        !other.alive ||
        other === actor ||
        !hostile(actor.allegiance, other.allegiance) ||
        actor.mesh.position.distanceTo(other.mesh.position) > reach
      ) {
        continue
      }
      this.damageActor(
        other,
        BOAR_CHARGE_DAMAGE,
        actor.mesh.position,
        actor.allegiance,
        false,
        { attackKind: 'allyMelee', sourceActorId: actor.id, knockback: 5 },
      )
      actor.chargeTimer = 0
      actor.chargeCooldown = BOAR_CHARGE_COOLDOWN
      return
    }
  }

  /**
   * Where a health bar floats. A quadruped's back is barely a metre off the ground, so
   * the humanoid offset would leave the bar hanging in the air above it. `spawnActor`
   * and the per-frame reposition must agree, or the spawn-time value is overwritten on
   * the very first frame.
   */
  private actorHealthBarHeight(role: ActorRole): number {
    return isBeastRole(role) ? 2.1 : 3.65
  }

  private updateActorIndicators(actor: Actor): void {    const playerDistance = actor.mesh.position.distanceTo(this.player.position)
    const ring = actor.mesh.getObjectByName('faction-ring')
    if (ring) {
      ring.visible = actor.alive && playerDistance < 42
      if (ring instanceof THREE.Mesh && ring.material instanceof THREE.MeshBasicMaterial) {
        const ragePulse = (Math.sin(this.elapsed * 14 + actor.phase) + 1) * 0.5
        ring.material.color.copy(this.allegianceColor(actor.allegiance))
        if (actor.rageTimer > 0) {
          ring.material.color.lerp(this.palette.danger, 0.55 + ragePulse * 0.35)
          ring.material.opacity = 0.66 + ragePulse * 0.22
          ring.scale.setScalar(1.04 + ragePulse * 0.14)
        } else {
          ring.material.opacity = 0.48
          ring.scale.setScalar(1)
        }
      }
    }

    actor.healthBar.position.set(
      actor.mesh.position.x,
      actor.mesh.position.y + this.actorHealthBarHeight(actor.role) * actor.mesh.scale.y,
      actor.mesh.position.z,
    )
    actor.healthBar.visible =
      actor.alive &&
      actor.hostileToPlayer &&
      playerDistance < 34 &&
      (this.elapsed < actor.healthBarVisibleUntil || actor.rageTimer > 0)
    this.updateActorOutlineVisibility(actor, playerDistance * playerDistance)
  }

  private updateActorOutlineVisibility(actor: Actor, playerDistanceSq?: number): void {
    let distanceSq = playerDistanceSq
    if (distanceSq === undefined) {
      const dx = actor.mesh.position.x - this.player.position.x
      const dy = actor.mesh.position.y - this.player.position.y
      const dz = actor.mesh.position.z - this.player.position.z
      distanceSq = dx * dx + dy * dy + dz * dz
    }
    this.setOutlineVisible(
      actor.outlineBinding,
      this.inkOutlinesEnabled &&
        distanceSq <= OUTLINE_ACTOR_DISTANCE_SQ &&
        (actor.alive || this.elapsed < actor.outlineUntil),
    )
  }

  private registerOutline(root: THREE.Object3D, kind: OutlineKind): OutlineBinding {
    const binding = this.artLibrary.applyOutline(root, kind)
    this.outlineBindings.push(binding)
    this.setOutlineVisible(binding, false)
    return binding
  }

  private registerInteractableOutline(
    root: THREE.Object3D,
    positionRoot: THREE.Object3D = root,
  ): OutlineBinding {
    const binding = this.registerOutline(root, 'interactable')
    this.interactableOutlineBindings.push({ binding, positionRoot })
    this.updateInteractableOutline(binding, positionRoot)
    return binding
  }

  private registerNamedInteractableOutline(root: THREE.Object3D, name: string): OutlineBinding | null {
    const target = root.getObjectByName(name)
    return target ? this.registerInteractableOutline(target, root) : null
  }

  private updateInteractableOutlines(): void {
    for (const entry of this.interactableOutlineBindings) {
      this.updateInteractableOutline(entry.binding, entry.positionRoot)
    }
  }

  private updateInteractableOutline(binding: OutlineBinding, positionRoot: THREE.Object3D): void {
    const dx = positionRoot.position.x - this.player.position.x
    const dy = positionRoot.position.y - this.player.position.y
    const dz = positionRoot.position.z - this.player.position.z
    this.setOutlineVisible(
      binding,
      this.inkOutlinesEnabled &&
        dx * dx + dy * dy + dz * dz <= OUTLINE_INTERACTABLE_DISTANCE_SQ,
    )
  }

  private updatePlayerOutlineVisibility(): void {
    const distanceSq = this.camera.position.distanceToSquared(this.player.position)
    this.setOutlineVisible(
      this.playerOutline,
      this.inkOutlinesEnabled && distanceSq >= OUTLINE_PLAYER_HIDE_DISTANCE_SQ,
    )
  }

  private setOutlineVisible(binding: OutlineBinding, visible: boolean): void {
    for (const shell of binding.shells) shell.visible = visible
  }

  private unregisterOutlineRoot(root: THREE.Object3D): void {
    for (let index = this.interactableOutlineBindings.length - 1; index >= 0; index -= 1) {
      const entry = this.interactableOutlineBindings[index]
      if (
        this.objectBelongsToRoot(root, entry.binding.root) ||
        this.objectBelongsToRoot(root, entry.positionRoot)
      ) {
        // Release, don't just forget. Dropping the reference detaches nothing and
        // frees nothing: an instanced shell owns a vertex array object that only
        // its own dispose event returns, and this runs every time an actor dies.
        this.artLibrary.releaseOutline(entry.binding)
        this.interactableOutlineBindings.splice(index, 1)
      }
    }
    for (let index = this.outlineBindings.length - 1; index >= 0; index -= 1) {
      const binding = this.outlineBindings[index]
      if (this.objectBelongsToRoot(root, binding.root)) {
        this.artLibrary.releaseOutline(binding)
        this.outlineBindings.splice(index, 1)
      }
    }
  }

  private objectBelongsToRoot(root: THREE.Object3D, candidate: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = candidate
    while (current) {
      if (current === root) return true
      current = current.parent
    }
    return false
  }

  private getAimDirection(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw))
  }

  private actorWindup(role: ActorRole): number {
    if (role === 'scout' || role === 'minion') return 0.18
    if (role === 'archer') return 0.32
    if (role === 'commander') return 0.38
    if (role === 'brute') return 0.56
    if (role === 'champion') return 0.48
    return 0.26
  }

  private actorRecovery(role: ActorRole): number {
    if (role === 'scout' || role === 'minion') return 0.18
    if (role === 'archer') return 0.2
    if (role === 'commander') return 0.28
    if (role === 'brute') return 0.42
    if (role === 'champion') return 0.36
    return 0.24
  }

  private actorMaxPoise(role: ActorRole): number {
    if (isBeastRole(role)) return BEAST_PROFILES[role].poise
    if (role === 'scout' || role === 'minion' || role === 'archer') return 18
    if (role === 'commander') return 46
    if (role === 'brute') return 58
    if (role === 'champion') return 72
    return 28
  }

  private actorStaggerDuration(role: ActorRole): number {
    if (role === 'scout' || role === 'minion' || role === 'archer') return 0.34
    if (role === 'commander') return 0.24
    if (role === 'brute') return 0.2
    if (role === 'champion') return 0.18
    return 0.3
  }

  private startActorAction(
    actor: Actor,
    kind: ActorActionKind,
    target: ActorAction['target'],
    targetPosition: THREE.Vector3,
    contactRange: number,
  ): void {
    if (!actor.alive || actor.action || actor.reaction === 'stagger') return
    const cooldown =
      kind === 'arrow'
        ? ARCHER_FIRE_COOLDOWN
        : kind === 'meleePlayer'
          ? actor.role === 'commander'
            ? 0.8
            : 1.15
          : kind === 'meleeActor'
            ? 1.3
            : 1.35
    actor.attackCooldown = this.actorAttackInterval(actor, cooldown)
    actor.velocity.set(0, 0, 0)
    const action: ActorAction = {
      kind,
      phase: 'windup',
      elapsed: 0,
      duration: this.actorWindup(actor.role),
      target,
      targetPosition: targetPosition.clone(),
      contactRange,
    }
    actor.action = action
    this.faceActorToward(actor, targetPosition, 1)
    this.acquireActorTelegraph(actor)
    this.playActorActionSound(actor, action, 'attackTell')
  }

  private updateActorAction(actor: Actor, delta: number): void {
    const action = actor.action
    if (!action) return
    const livePosition = this.resolveActorActionTarget(actor, action)
    if (livePosition) action.targetPosition.copy(livePosition)
    this.faceActorToward(actor, action.targetPosition, delta)

    action.elapsed += delta
    if (action.phase === 'windup') {
      this.acquireActorTelegraph(actor)
      this.updateActorTelegraph(actor, action)
      if (action.elapsed < action.duration) return
      this.releaseActorTelegraph(actor.id)
      this.resolveActorActionContact(actor, action)
      if (!actor.alive || actor.reaction === 'stagger' || actor.action !== action) return
      if (actor.role === 'scout') actor.retreatTimer = SCOUT_RETREAT_DURATION
      action.phase = 'recovery'
      action.elapsed = 0
      action.duration = this.actorRecovery(actor.role)
      return
    }

    if (action.elapsed >= action.duration) actor.action = null
  }

  private resolveActorActionTarget(
    actor: Actor,
    action: ActorAction,
  ): THREE.Vector3 | null {
    if (action.target.kind === 'player') {
      return this.health > 0 && actor.hostileToPlayer
        ? this.player.position
        : null
    }
    if (action.target.kind === 'actor') {
      const targetId = action.target.id
      const target = this.actors.find((candidate) => candidate.id === targetId)
      return target?.alive && hostile(actor.allegiance, target.allegiance)
        ? target.mesh.position
        : null
    }
    const target = this.eventPropTargets.get(action.target.id)
    return target && target.hp > 0 ? target.position : null
  }

  private resolveActorActionContact(actor: Actor, action: ActorAction): void {
    if (action.kind === 'arrow') {
      const livePosition = this.resolveActorActionTarget(actor, action)
      if (!livePosition) this.playActorActionSound(actor, action, 'whiff')
      this.fireActorArrow(actor, livePosition ?? action.targetPosition)
      return
    }

    const livePosition = this.resolveActorActionTarget(actor, action)
    if (
      !livePosition ||
      actor.mesh.position.distanceTo(livePosition) >
        action.contactRange + CONTACT_RANGE_FORGIVENESS
    ) {
      this.playActorActionSound(actor, action, 'whiff')
      return
    }
    if (action.kind === 'meleePlayer') {
      this.actorAttackPlayer(actor)
      return
    }
    if (action.kind === 'meleeActor' && action.target.kind === 'actor') {
      const targetId = action.target.id
      const target = this.actors.find((candidate) => candidate.id === targetId)
      if (target?.alive && hostile(actor.allegiance, target.allegiance)) {
        this.actorAttackActor(actor, target)
      }
      return
    }
    if (action.kind === 'eventProp' && action.target.kind === 'eventProp') {
      const target = this.eventPropTargets.get(action.target.id)
      if (target && target.hp > 0) this.actorAttackEventProp(actor, target)
    }
  }

  private playActorActionSound(
    actor: Actor,
    action: ActorAction,
    cue: Extract<SoundCue, 'attackTell' | 'whiff'>,
  ): void {
    if (action.target.kind !== 'player') return
    const intensity =
      actor.role === 'champion' || actor.role === 'commander'
        ? 1
        : actor.role === 'brute'
          ? 0.82
          : 0.58
    this.playSound(cue, {
      position: actor.mesh.position,
      intensity,
      variantSeed: this.stableSeed(`${actor.id}:${action.kind}:${cue}`),
    })
  }

  private faceActorToward(actor: Actor, position: THREE.Vector3, delta: number): void {
    const offset = position.clone().sub(actor.mesh.position)
    offset.y = 0
    if (offset.lengthSq() <= 0.0001) return
    const yaw = Math.atan2(offset.x, offset.z)
    actor.mesh.rotation.y =
      delta >= 1 ? yaw : dampAngle(actor.mesh.rotation.y, yaw, 13, delta)
  }

  private updateActorReaction(actor: Actor, delta: number): void {
    actor.staggerImmunity = Math.max(0, actor.staggerImmunity - delta)
    actor.poiseRecoveryDelay = Math.max(0, actor.poiseRecoveryDelay - delta)
    if (actor.reaction !== 'none') {
      const wasStaggered = actor.reaction === 'stagger'
      actor.reactionRemaining = Math.max(0, actor.reactionRemaining - delta)
      if (actor.reactionRemaining <= 0) {
        actor.reaction = 'none'
        if (wasStaggered) actor.poise = Math.max(actor.poise, actor.maxPoise * 0.7)
      }
    }
    if (actor.reaction !== 'stagger' && actor.poiseRecoveryDelay <= 0) {
      actor.poise = Math.min(
        actor.maxPoise,
        actor.poise + POISE_RECOVERY_PER_SECOND * delta,
      )
    }
  }

  private applyActorDamageReaction(
    actor: Actor,
    result: DamageResult,
    attackKind: AttackKind,
    requestedKnockback: number,
  ): void {
    if (!result.applied) return
    actor.lastHitDirection.copy(result.direction)
    actor.lastHitDirection.y = 0
    if (actor.lastHitDirection.lengthSq() > 0.0001) actor.lastHitDirection.normalize()
    if (requestedKnockback > 0 && !result.killed) {
      const largeRole =
        actor.role === 'brute' || actor.role === 'commander' || actor.role === 'champion'
      const resistance = largeRole ? LARGE_ROLE_KNOCKBACK_SCALE : 1
      const motionScale =
        !this.screenShakeEnabled || this.reducedMotion ? REDUCED_MOTION_COMBAT_SCALE : 1
      actor.knockbackVelocity.addScaledVector(
        actor.lastHitDirection,
        requestedKnockback * resistance * motionScale,
      )
      if (actor.knockbackVelocity.length() > KNOCKBACK_MAX_SPEED) {
        actor.knockbackVelocity.setLength(KNOCKBACK_MAX_SPEED)
      }
    }
    if (result.killed) return

    if (actor.reaction !== 'stagger') {
      actor.reaction = 'flinch'
      actor.reactionRemaining = Math.max(actor.reactionRemaining, FLINCH_TIME)
    }
    actor.poiseRecoveryDelay = POISE_REGEN_DELAY
    const poiseDamage = result.dealt * (attackKind === 'cleave' ? 1.45 : 0.75)
    if (actor.staggerImmunity > 0) {
      actor.poise = Math.max(actor.maxPoise * 0.7, actor.poise - poiseDamage)
      return
    }
    actor.poise -= poiseDamage
    if (actor.poise > 0) return

    actor.reaction = 'stagger'
    actor.reactionRemaining = this.actorStaggerDuration(actor.role)
    actor.staggerImmunity = STAGGER_IMMUNITY
    actor.poise = actor.maxPoise * 0.7
    actor.retreatTimer = 0
    actor.velocity.set(0, 0, 0)
    actor.action = null
    this.releaseActorTelegraph(actor.id)
  }

  private updateActorKnockback(actor: Actor, delta: number): number {
    const speed = actor.knockbackVelocity.length()
    if (speed <= 0.001) {
      actor.knockbackVelocity.set(0, 0, 0)
      return 0
    }
    const startX = actor.mesh.position.x
    const startZ = actor.mesh.position.z
    const requestedX = actor.knockbackVelocity.x * delta
    const requestedZ = actor.knockbackVelocity.z * delta
    this.moveCharacter(
      actor.mesh.position,
      requestedX,
      requestedZ,
      this.actorColliderRadiusForRole(actor.role),
    )
    actor.mesh.position.y = this.groundHeightAt(
      actor.mesh.position.x,
      actor.mesh.position.z,
    )
    const actualX = actor.mesh.position.x - startX
    const actualZ = actor.mesh.position.z - startZ
    if (Math.abs(actualX - requestedX) > 0.001) actor.knockbackVelocity.x = 0
    if (Math.abs(actualZ - requestedZ) > 0.001) actor.knockbackVelocity.z = 0
    actor.knockbackVelocity.multiplyScalar(Math.exp(-KNOCKBACK_DAMPING * delta))
    if (actor.knockbackVelocity.lengthSq() < 0.0001) {
      actor.knockbackVelocity.set(0, 0, 0)
    }
    return actor.knockbackVelocity.length()
  }

  private telegraphKindForRole(role: ActorRole): TelegraphKind | null {
    if (role === 'archer') return 'aim'
    if (role === 'commander') return 'commander'
    if (role === 'brute' || role === 'champion') return 'wedge'
    if (role === 'soldier' || role === 'captive') return 'tick'
    return null
  }

  private telegraphPriorityForRole(role: ActorRole): number {
    if (role === 'brute' || role === 'champion' || role === 'commander') return 3
    if (role === 'archer') return 2
    return 1
  }

  private acquireActorTelegraph(actor: Actor): void {
    if (
      actor.action?.phase !== 'windup' ||
      this.paused ||
      this.ended ||
      document.hidden ||
      !document.hasFocus()
    ) {
      return
    }
    const kind = this.telegraphKindForRole(actor.role)
    if (!kind || this.telegraphPool.some((entry) => entry.ownerId === actor.id)) return
    const priority = this.telegraphPriorityForRole(actor.role)
    let entry = this.telegraphPool.find((candidate) => candidate.ownerId === null)
    if (!entry && this.telegraphPool.length < TELEGRAPH_MAX) {
      const material = new THREE.MeshBasicMaterial({
        color: this.palette.warning,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.telegraphGeometry(kind), material)
      mesh.visible = false
      mesh.renderOrder = 2
      this.scene.add(mesh)
      entry = { mesh, ownerId: null, priority: 0, kind }
      this.telegraphPool.push(entry)
    }
    if (!entry) {
      const lowest = this.telegraphPool.reduce((best, candidate) =>
        candidate.priority < best.priority ? candidate : best,
      )
      if (lowest.priority >= priority) return
      entry = lowest
    }
    entry.ownerId = actor.id
    entry.priority = priority
    entry.kind = kind
    entry.mesh.geometry = this.telegraphGeometry(kind)
    entry.mesh.material.color.copy(
      actor.role === 'archer' ? this.palette.warning : this.palette.danger,
    )
    entry.mesh.visible = true
  }

  private updateActorTelegraph(actor: Actor, action: ActorAction): void {
    const entry = this.telegraphPool.find((candidate) => candidate.ownerId === actor.id)
    if (!entry) return
    const progress = THREE.MathUtils.clamp(action.elapsed / action.duration, 0, 1)
    const eased = 1 - (1 - progress) * (1 - progress)
    const offset = action.targetPosition.clone().sub(actor.mesh.position)
    offset.y = 0
    const yaw = offset.lengthSq() > 0.0001 ? Math.atan2(offset.x, offset.z) : actor.mesh.rotation.y
    const width =
      entry.kind === 'aim'
        ? 0.16
        : entry.kind === 'tick'
          ? 0.34
          : entry.kind === 'commander'
            ? 2.1
            : actor.role === 'champion'
              ? 2.8
              : 2.5
    entry.mesh.position.set(
      actor.mesh.position.x,
      this.groundHeightAt(actor.mesh.position.x, actor.mesh.position.z) +
        TELEGRAPH_Y,
      actor.mesh.position.z,
    )
    entry.mesh.rotation.set(0, yaw, 0)
    entry.mesh.scale.set(
      width,
      1,
      Math.max(0.08, action.contactRange * (entry.kind === 'aim' ? 1 : eased)),
    )
    entry.mesh.material.opacity = 0.34 + eased * 0.48
  }

  private releaseActorTelegraph(actorId: string): void {
    const entry = this.telegraphPool.find((candidate) => candidate.ownerId === actorId)
    if (!entry) return
    entry.ownerId = null
    entry.priority = 0
    entry.mesh.visible = false
    entry.mesh.material.opacity = 0
  }

  private releaseAllTelegraphs(): void {
    for (const entry of this.telegraphPool) {
      entry.ownerId = null
      entry.priority = 0
      entry.mesh.visible = false
      entry.mesh.material.opacity = 0
    }
  }

  private telegraphGeometry(kind: TelegraphKind): THREE.BufferGeometry {
    const existing = this.telegraphGeometries.get(kind)
    if (existing) return existing
    const geometry = new THREE.BufferGeometry()
    const positions =
      kind === 'wedge'
        ? [-0.5, 0, 0, 0.5, 0, 0, 0, 0, 1]
        : kind === 'commander'
          ? [
              -0.5, 0, 0.08, 0.5, 0, 0.08, 0, 0, 0.42,
              -0.5, 0, 0.54, 0.5, 0, 0.54, 0, 0, 0.9,
            ]
          : [
              -0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1,
              -0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1,
            ]
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeBoundingSphere()
    this.telegraphGeometries.set(kind, geometry)
    return geometry
  }

  private fireArrow(): void {
    const direction = this.getAimDirection()
    this.activePlayerAttackKind = 'arrow'
    this.player.rotation.y = Math.atan2(direction.x, direction.z)
    const origin = this.player.position
      .clone()
      .add(new THREE.Vector3(0, 1.75, 0))
      .addScaledVector(direction, 1)
    this.spawnProjectile(
      'player',
      this.faction,
      origin,
      direction.clone().multiplyScalar(BOW_SPEED).add(new THREE.Vector3(0, 0.55, 0)),
      BOW_RANGE / BOW_SPEED,
      BOW_DAMAGE,
      null,
      0.25,
    )
    this.playSound('bow')
  }

  private cleave(): void {
    const direction = this.getAimDirection()
    this.activePlayerAttackKind = 'cleave'
    this.player.rotation.y = Math.atan2(direction.x, direction.z)
    this.moveCharacter(
      this.player.position,
      direction.x * CLEAVE_DASH_DISTANCE,
      direction.z * CLEAVE_DASH_DISTANCE,
      PLAYER_COLLIDER_RADIUS,
    )
    this.attackAnimation = 1

    const armPenalty =
      (this.body.leftArm === 'missing' ? 5 : 0) +
      (this.body.rightArm === 'missing' ? 9 : 0)
    const dealt = Math.max(8, this.damage - armPenalty) * CLEAVE_DAMAGE_MULTIPLIER
    const feedbackEvents: CombatFeedbackEvent[] = []
    for (const actor of this.actors) {
      // §5D — the arc takes whoever is standing in it, villagers included. Unlike the
      // melee auto-target this is aimed by hand, so there is nothing to protect the
      // player from.
      if (!actor.alive) continue
      if (!actor.hostileToPlayer && actor.allegiance !== 'civilian') continue
      const offset = actor.mesh.position.clone().sub(this.player.position)
      offset.y = 0
      const distance = offset.length()
      if (
        distance > CLEAVE_RADIUS ||
        (distance > 0.001 && offset.normalize().dot(direction) < CLEAVE_ARC_DOT)
      ) {
        continue
      }
      const impactPosition = actor.mesh.position.clone().add(new THREE.Vector3(0, 1.25, 0))
      const incomingDirection = this.player.position.clone().sub(actor.mesh.position)
      incomingDirection.y = 0
      this.createSparks(impactPosition, incomingDirection, SPARK_COUNT_CLEAVE)
      const result = this.damageActor(actor, dealt, this.player.position, this.faction, true, {
        attackKind: 'cleave',
        detachChance: 0.75,
        knockback: CLEAVE_KNOCKBACK_DISTANCE,
        deferFeedback: true,
      })
      if (!result.applied) continue
      const event: CombatFeedbackEvent = {
        ...result,
        attackKind: 'cleave',
        targetId: actor.id,
        directPlayerAction: true,
      }
      feedbackEvents.push(event)
      this.presentCombatFeedback(event, { callout: false, hitStop: false, sound: false })
    }
    if (feedbackEvents.length > 0) {
      this.addTrauma(TRAUMA_CLEAVE)
      this.presentCleaveFeedback(feedbackEvents)
    }
    this.queueCameraAccent(
      'cleave',
      feedbackEvents.length > 0 ? 5.5 : 2,
      feedbackEvents.length > 0 ? 0.24 : 0.16,
    )
    this.playSound('cleave')
  }

  private fireActorArrow(actor: Actor, targetPosition: THREE.Vector3): void {
    const origin = actor.mesh.position.clone().add(new THREE.Vector3(0, 1.65, 0))
    const target = targetPosition.clone().add(new THREE.Vector3(0, 1.45, 0))
    const direction = target.sub(origin).normalize()
    origin.addScaledVector(direction, 0.85)
    this.spawnProjectile(
      'actor',
      actor.allegiance,
      origin,
      direction.multiplyScalar(ACTOR_ARROW_SPEED),
      1.25,
      this.actorDamageWithAura(actor, ACTOR_ARROW_DAMAGE) *
        this.enemyDamageMultiplier(actor),
      actor.id,
      0,
    )
    if (actor.mesh.position.distanceTo(this.player.position) < 20) {
      this.playSound('arrow', {
        position: actor.mesh.position,
        variantSeed: this.actorSequence + actor.id.length,
      })
    }
  }

  private spawnProjectile(
    owner: Projectile['owner'],
    allegiance: Allegiance,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    life: number,
    damage: number,
    sourceActorId: string | null,
    detachChance: number,
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.9),
      new THREE.MeshStandardMaterial({
        color: this.allegianceColor(allegiance),
        emissive: this.allegianceColor(allegiance),
        emissiveIntensity: 0.35,
        roughness: 0.55,
      }),
    )
    mesh.position.copy(position)
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      velocity.clone().normalize(),
    )
    mesh.castShadow = true
    this.scene.add(mesh)
    this.projectiles.push({
      mesh,
      velocity,
      life,
      owner,
      allegiance,
      damage,
      sourceActorId,
      travelled: 0,
      detachChance,
    })
  }

  private updateCommander(actor: Actor, delta: number): void {
    this.broadcastCommanderOrder(actor)
    actor.reinforcementTimer -= delta
    if (actor.reinforcementTimer > 0) return
    actor.reinforcementTimer += COMMANDER_REINFORCEMENT_INTERVAL
    if (
      actor.reinforcementsCalled >= COMMANDER_REINFORCEMENT_LIMIT ||
      !this.reserveActorSlots(actor.budgetCategory, 1)
    ) {
      return
    }

    const angle = actor.phase + actor.reinforcementsCalled * 1.9
    const position = actor.mesh.position.clone().add(
      new THREE.Vector3(Math.sin(angle) * 3.2, 0, Math.cos(angle) * 3.2),
    )
    this.spawnActor(
      actor.allegiance,
      'soldier',
      position.x,
      position.z,
      this.actors.length,
      {
        budget: actor.budgetCategory,
        objectiveEligible: false,
        squadEligible: false,
        generatedRegionId: actor.generatedRegionId,
        hostileToPlayer: actor.hostileToPlayer,
      },
    )
    actor.reinforcementsCalled += 1
    if (actor.mesh.position.distanceTo(this.player.position) < 35) {
      this.callbacks.onNotice('Командир приказал подкреплению вступить в бой!', 'warning')
    }
  }

  /**
   * §5C.4 — a commander stops being furniture with an aura attached.
   *
   * Before Layer 4 a commander was a stationary damage buff that occasionally called
   * reinforcements; the actors around him made every decision alone. Now he hands out a
   * standing order, and the order is what an ally does when it has nothing to fight —
   * instead of wandering in a circle around wherever it happened to spawn.
   *
   * He picks the order from what is in front of him, not from a script: a prop his side
   * is taking apart means `assault`, otherwise he holds the ground he is on. The order
   * carries a timer rather than being cleared on his death, so a squad keeps its last
   * orders for a few seconds after the commander falls — which is both true to life and
   * how it avoids a frame where everyone forgets what they were doing at once.
   *
   * He himself keeps `speed: 0`. That is deliberate and stays: he is the fixed point the
   * rally is measured from, and a commander who chases has to be able to lose an
   * objective site, which is the one thing §7 says must not happen.
   */
  private broadcastCommanderOrder(commander: Actor): void {
    const assaultTarget = this.commanderAssaultTarget(commander)
    const kind: SquadOrderKind = assaultTarget ? 'assault' : 'hold'
    const position = assaultTarget ?? commander.mesh.position
    const rangeSq = COMMANDER_ORDER_RANGE * COMMANDER_ORDER_RANGE
    for (const actor of this.actors) {
      if (
        actor === commander ||
        !actor.alive ||
        actor.aiMode === 'captive' ||
        // A commander has his own post and cannot be sent to somebody else's.
        actor.role === 'commander' ||
        allegianceRelation(actor.allegiance, commander.allegiance) !== 'friendly' ||
        actor.mesh.position.distanceToSquared(commander.mesh.position) > rangeSq
      ) {
        continue
      }
      // An escort order comes from the caravan and outranks a commander standing near
      // the road: whoever is guarding the cart keeps guarding the cart.
      if (actor.order?.kind === 'escort') continue
      if (actor.order) {
        actor.order.kind = kind
        actor.order.position.copy(position)
        actor.order.timer = COMMANDER_ORDER_DURATION
      } else {
        actor.order = {
          kind,
          position: position.clone(),
          timer: COMMANDER_ORDER_DURATION,
        }
      }
    }
  }

  /** Whatever this commander's side has come to knock down, if anything. */
  private commanderAssaultTarget(commander: Actor): THREE.Vector3 | null {
    for (const actor of this.actors) {
      if (
        !actor.alive ||
        actor.aiMode !== 'attackEventProp' ||
        allegianceRelation(actor.allegiance, commander.allegiance) !== 'friendly' ||
        !actor.eventPropTargetId
      ) {
        continue
      }
      const prop = this.eventPropTargets.get(actor.eventPropTargetId)
      if (prop && prop.hp > 0) return prop.position
    }
    return null
  }

  /**
   * §5C.2 — the shock of watching the commander fall, applied to everyone who could see
   * it. On its own it is worth less than a light wound; on top of a bad fight it is what
   * turns a losing squad into a broken one.
   */
  private applyCommanderLossShock(commander: Actor): void {
    const rangeSq = COMMANDER_ORDER_RANGE * COMMANDER_ORDER_RANGE
    for (const actor of this.actors) {
      if (
        actor === commander ||
        !actor.alive ||
        allegianceRelation(actor.allegiance, commander.allegiance) !== 'friendly' ||
        actor.mesh.position.distanceToSquared(commander.mesh.position) > rangeSq
      ) {
        continue
      }
      actor.commanderLostTimer = MORALE_COMMANDER_SHOCK_SECONDS
      // The shock outranks a rally he handed out a moment ago: he is not there any more.
      actor.rallyTimer = 0
      actor.moraleTimer = 0
    }
  }

  private hasCommanderAura(actor: Actor): boolean {
    return this.actors.some(
      (other) =>
        other !== actor &&
        other.alive &&
        other.role === 'commander' &&
        other.reaction !== 'stagger' &&
        other.allegiance === actor.allegiance &&
        other.mesh.position.distanceToSquared(actor.mesh.position) <=
          COMMANDER_AURA_RANGE * COMMANDER_AURA_RANGE,
    )
  }

  private actorDamageWithAura(actor: Actor, damage: number): number {
    return (
      damage +
      (this.hasCommanderAura(actor) ? COMMANDER_DAMAGE_BONUS : 0) +
      (actor.rageTimer > 0 ? RAGE_DAMAGE_BONUS : 0)
    )
  }

  private actorAttackInterval(actor: Actor, interval: number): number {
    return interval * (actor.rageTimer > 0 ? RAGE_COOLDOWN_MULTIPLIER : 1)
  }

  private chooseWanderTarget(actor: Actor): void {
    actor.targetId = null
    const cycle = this.elapsed * 0.31 + actor.phase * 4.7
    const angle = cycle + Math.sin(cycle * 0.63) * 1.4
    const wanderRadius = 2.8 + (Math.sin(cycle * 1.17) + 1) * 2.6
    const colliderRadius = this.actorColliderRadiusForRole(actor.role)
    let foundTarget = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidateAngle = angle + attempt * 2.399963229728653
      const candidateRadius = Math.max(1.8, wanderRadius - attempt * 0.32)
      const x = actor.home.x + Math.sin(candidateAngle) * candidateRadius
      const z = actor.home.z + Math.cos(candidateAngle) * candidateRadius
      if (!this.isWalkablePosition(x, z, colliderRadius)) continue
      actor.wanderTarget.set(x, this.groundHeightAt(x, z), z)
      foundTarget = true
      break
    }
    if (!foundTarget) {
      if (this.isWalkablePosition(actor.home.x, actor.home.z, colliderRadius)) {
        actor.wanderTarget.copy(actor.home)
      } else {
        actor.wanderTarget.copy(actor.mesh.position)
      }
    }
    actor.wanderTimer = 3.8 + (Math.sin(cycle * 0.81) + 1) * 2.2
    actor.idleTimer = 0.35 + (Math.sin(cycle * 1.43 + 0.7) + 1) * 0.48
    actor.wanderPace = 0.72 + (Math.sin(cycle * 1.09 + 1.3) + 1) * 0.13
  }

  private getActorSeparation(actor: Actor): THREE.Vector3 {
    const separation = new THREE.Vector3()
    for (const other of this.actors) {
      if (!other.alive || other === actor) continue
      const offset = actor.mesh.position.clone().sub(other.mesh.position)
      offset.y = 0
      const distanceSquared = offset.lengthSq()
      const minimumDistance = actor.allegiance === other.allegiance ? 1.45 : 1.15
      if (distanceSquared >= minimumDistance * minimumDistance) continue
      if (distanceSquared < 0.0001) {
        offset.set(Math.sin(actor.phase * 9.1), 0, Math.cos(actor.phase * 9.1))
      } else {
        offset.normalize()
      }
      const distance = Math.sqrt(Math.max(distanceSquared, 0.0001))
      separation.addScaledVector(offset, (minimumDistance - distance) / minimumDistance)
    }
    return separation
  }

  private updateCaravan(delta: number): void {
    let wheelTravel = 0
    const regionId = this.generatedRegionIdAt(
      this.caravan.position.x,
      this.caravan.position.z,
    )
    const streaming =
      this.generatedCaravanPatrolReady &&
      regionId !== null &&
      this.simulatedGeneratedRegions.has(regionId)
    const panic = this.updateCaravanEscort(delta, regionId, streaming)
    if (streaming) {
      let destination =
        this.caravanDirection > 0
          ? this.generatedCaravanPatrolEnd
          : this.generatedCaravanPatrolStart
      if (this.caravan.position.distanceTo(destination) <= 1.1) {
        this.caravanDirection *= -1
        destination =
          this.caravanDirection > 0
            ? this.generatedCaravanPatrolEnd
            : this.generatedCaravanPatrolStart
      }
      const waypoint =
        this.getNavigationWaypoint(
          this.caravan.position,
          destination,
          GENERATED_CARAVAN_COLLIDER_RADIUS,
        ) ?? destination
      const direction = waypoint.clone().sub(this.caravan.position)
      direction.y = 0
      const distance = direction.length()
      if (distance > 0.001) {
        direction.multiplyScalar(1 / distance)
        const previousX = this.caravan.position.x
        const previousZ = this.caravan.position.z
        // §5C.6 — a spooked driver whips the horses. It still has to stay on the road,
        // so panic is speed, not a new path: the cart cannot leave the road network.
        const speed = 3.4 * (panic ? CARAVAN_PANIC_SPEED_MULTIPLIER : 1)
        const requestedTravel = Math.min(delta * speed, distance)
        const blocked = this.moveCharacter(
          this.caravan.position,
          direction.x * requestedTravel,
          direction.z * requestedTravel,
          GENERATED_CARAVAN_COLLIDER_RADIUS,
        )
        const movedX = this.caravan.position.x - previousX
        const movedZ = this.caravan.position.z - previousZ
        wheelTravel = Math.hypot(movedX, movedZ)
        if (
          wheelTravel < 0.0001 ||
          (blocked && wheelTravel < requestedTravel * 0.2)
        ) {
          this.caravanDirection *= -1
        } else {
          this.caravan.rotation.y = Math.atan2(-movedZ, movedX)
        }
      }
      this.caravan.position.y = this.groundHeightAt(
        this.caravan.position.x,
        this.caravan.position.z,
      )
    }
    const wheels = this.caravan.getObjectsByProperty('name', 'wheel')
    for (const wheel of wheels) wheel.rotation.z -= wheelTravel / 0.9
    const cargo = this.caravan.getObjectByName('cargo')
    if (cargo instanceof THREE.Mesh) {
      const scale = this.caravanCooldown > 0 ? 0.35 : 1
      cargo.scale.y = THREE.MathUtils.lerp(cargo.scale.y, scale, delta * 5)
      const material = cargo.material
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.copy(this.caravanRobbedFlash > 0 ? this.palette.warning : this.palette.bg)
        material.emissiveIntensity = this.caravanRobbedFlash
      }
    }
  }

  /**
   * §5C.6 — the caravan stops being a moving prop and becomes something with an interest
   * in its own survival: two guards who walk with it, a driver who bolts when something
   * comes out of the treeline, and a cart that is genuinely lost if the guards lose.
   *
   * **Escorts are charged to `ambient`, deliberately.** They are the lowest-priority
   * reserve, so the moment a materialized raid or a threat wave needs the slots the
   * guards are the first thing given up (§5.1) — and a cart losing its escort because a
   * settlement three hundred metres away is burning is a better failure than a raid
   * arriving two beasts short. It also means the escort costs nothing when the player is
   * nowhere near the road.
   *
   * Returns whether the cart is currently panicking, so the caller can move it faster.
   */
  private updateCaravanEscort(
    delta: number,
    regionId: string | null,
    streaming: boolean,
  ): boolean {
    this.caravanPanicTimer = Math.max(0, this.caravanPanicTimer - delta)
    const before = this.caravanEscortIds.length
    this.caravanEscortIds = this.caravanEscortIds.filter((id) =>
      this.actors.some((actor) => actor.id === id && actor.alive),
    )
    // A guard that has just died leaves a real gap. Without the delay the replacement
    // spawned in the same frame, 2.6 m from the cart and therefore already "guarding" —
    // which made the escort-down plunder path unreachable through combat, and popped a
    // fresh soldier out of thin air next to the player who had just killed one.
    if (this.caravanEscortIds.length < before) {
      this.caravanEscortRespawnAt = this.elapsed + CARAVAN_ESCORT_RESPAWN_DELAY
    }

    // Off-screen or in an unsimulated square: no guards, no panic, no cost.
    if (!streaming || this.player.position.distanceTo(this.caravan.position) > CARAVAN_ESCORT_RANGE) {
      for (const id of this.caravanEscortIds) this.removeActorById(id)
      this.caravanEscortIds = []
      return false
    }

    if (
      this.caravanEscortIds.length < CARAVAN_ESCORT_COUNT &&
      this.elapsed >= this.caravanEscortRespawnAt
    ) {
      this.spawnCaravanEscort(regionId)
    }

    // Guards walk with the cart rather than holding a post, which is what `escort` is.
    for (const guard of this.livingCaravanEscorts()) {
      guard.home.copy(this.caravan.position)
      if (guard.order) {
        guard.order.kind = 'escort'
        guard.order.position.copy(this.caravan.position)
        guard.order.timer = COMMANDER_ORDER_DURATION
      } else {
        guard.order = {
          kind: 'escort',
          position: this.caravan.position.clone(),
          timer: COMMANDER_ORDER_DURATION,
        }
      }
    }

    const raider = this.nearestCaravanThreat()
    if (raider) {
      this.caravanPanicTimer = CARAVAN_PANIC_SECONDS
      const guarding = this.livingCaravanEscorts()
      // The shout has to come from a *guard*, not from the raider: `acceptsAlert` sends
      // it to allies of whoever shouted, so raising it on the raider would have told the
      // wolves where the cart was.
      if (guarding.length > 0) {
        this.announceSighting(guarding[0], raider.id, raider.mesh.position)
      }
      const escortGuarding = guarding.some(
        (guard) =>
          guard.routTimer <= 0 &&
          guard.mesh.position.distanceToSquared(this.caravan.position) <=
            CARAVAN_GUARDED_RANGE * CARAVAN_GUARDED_RANGE,
      )
      if (
        !escortGuarding &&
        this.caravanCooldown <= 0 &&
        raider.mesh.position.distanceToSquared(this.caravan.position) <=
          CARAVAN_PLUNDER_RANGE * CARAVAN_PLUNDER_RANGE
      ) {
        this.plunderCaravan(raider)
      }
    }
    return this.caravanPanicTimer > 0
  }

  private livingCaravanEscorts(): Actor[] {
    const escorts: Actor[] = []
    for (const actor of this.actors) {
      if (actor.alive && this.caravanEscortIds.includes(actor.id)) escorts.push(actor)
    }
    return escorts
  }

  /** The nearest thing that would happily take the cart, beast or raider alike. */
  private nearestCaravanThreat(): Actor | null {
    let nearest: Actor | null = null
    let bestDistance = CARAVAN_PANIC_RANGE * CARAVAN_PANIC_RANGE
    for (const actor of this.actors) {
      if (!actor.alive || actor.routTimer > 0) continue
      if (this.caravanEscortIds.includes(actor.id)) continue
      if (!hostile(actor.allegiance, CARAVAN_ALLEGIANCE)) continue
      const distance = actor.mesh.position.distanceToSquared(this.caravan.position)
      if (distance >= bestDistance) continue
      bestDistance = distance
      nearest = actor
    }
    return nearest
  }

  private spawnCaravanEscort(regionId: string | null): void {
    if (this.reserveActorSlotsUpTo('ambient', 1) < 1) return
    const angle = this.caravan.rotation.y + (this.caravanEscortIds.length ? 2.1 : -2.1)
    const spawn = new THREE.Vector3(
      this.caravan.position.x + Math.sin(angle) * 2.6,
      0,
      this.caravan.position.z + Math.cos(angle) * 2.6,
    )
    this.clampWorldPosition(spawn, 3)
    if (!this.isWalkablePosition(spawn.x, spawn.z, 1)) return
    const guard = this.spawnActor(
      CARAVAN_ALLEGIANCE,
      'soldier',
      spawn.x,
      spawn.z,
      this.actorSequence++,
      {
        budget: 'ambient',
        objectiveEligible: false,
        squadEligible: false,
        generatedRegionId: regionId,
      },
    )
    guard.home.copy(this.caravan.position)
    guard.wanderTarget.copy(guard.mesh.position)
    this.caravanEscortIds.push(guard.id)
  }

  /** Escort down, raider at the tailgate: the cart is gone whoever the player is. */
  private plunderCaravan(raider: Actor): void {
    this.caravanCooldown = CARAVAN_PLUNDER_COOLDOWN
    this.caravanRobbedFlash = 1
    this.playSound('event')
    if (this.player.position.distanceTo(this.caravan.position) < 60) {
      this.callbacks.onNotice(
        describeCaravanPlundered(isBeastRole(raider.role)),
        'warning',
      )
    }
  }

  private updateProjectiles(delta: number): void {
    this.clearQueuedProjectiles()
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index]
      if (
        projectile.sourceActorId &&
        this.projectileSourcesToClear.has(projectile.sourceActorId)
      ) {
        this.removeProjectile(index)
        continue
      }
      const step = Math.min(delta, Math.max(0, projectile.life))
      if (step <= 0) {
        this.removeProjectile(index)
        continue
      }
      const start = projectile.mesh.position.clone()
      projectile.velocity.y -= PROJECTILE_GRAVITY * step
      const end = start.clone().addScaledVector(projectile.velocity, step)
      let segmentDistance = start.distanceTo(end)
      if (projectile.owner === 'player') {
        const remainingRange = Math.max(0, BOW_RANGE - projectile.travelled)
        if (segmentDistance > remainingRange && segmentDistance > 0) {
          end.copy(start).addScaledVector(
            projectile.velocity.clone().normalize(),
            remainingRange,
          )
          segmentDistance = remainingRange
        }
      }
      projectile.life -= step
      const hit = this.findProjectileHit(projectile, start, end)

      if (hit) {
        projectile.mesh.position.lerpVectors(start, end, hit.fraction)
        if (hit.player) {
          const incomingDirection = projectile.velocity.clone().negate()
          incomingDirection.y = 0
          this.damagePlayer(projectile.damage, incomingDirection, false, {
            attackKind: 'actorArrow',
          })
        } else if (hit.actor) {
          const damage =
            projectile.owner === 'player'
              ? Math.max(
                  BOW_MIN_DAMAGE,
                  projectile.damage -
                    ((projectile.travelled + segmentDistance * hit.fraction) /
                      BOW_RANGE) *
                      (BOW_DAMAGE - BOW_MIN_DAMAGE),
                )
              : projectile.damage
          const sourcePosition = hit.actor.mesh.position
            .clone()
            .sub(projectile.velocity)
          sourcePosition.y = hit.actor.mesh.position.y
          this.damageActor(
            hit.actor,
            damage,
            sourcePosition,
            projectile.allegiance,
            projectile.owner === 'player',
            {
              attackKind: projectile.owner === 'player' ? 'arrow' : 'actorArrow',
              detachChance: projectile.detachChance,
              sourceActorId: projectile.sourceActorId ?? undefined,
            },
          )
        }
        this.removeProjectile(index)
        continue
      }

      projectile.mesh.position.copy(end)
      projectile.travelled += segmentDistance
      if (projectile.velocity.lengthSq() > 0.001) {
        projectile.mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          projectile.velocity.clone().normalize(),
        )
      }
      if (
        projectile.life <= 0 ||
        (projectile.owner === 'player' && projectile.travelled >= BOW_RANGE) ||
        !this.isWithinWorldBounds(end.x, end.z, 4) ||
        end.y < this.groundHeightAt(end.x, end.z) - 1
      ) {
        this.removeProjectile(index)
      }
    }
    this.clearQueuedProjectiles()
  }

  private clearQueuedProjectiles(): void {
    if (this.projectileSourcesToClear.size === 0) return
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const sourceActorId = this.projectiles[index].sourceActorId
      if (
        sourceActorId &&
        this.projectileSourcesToClear.has(sourceActorId)
      ) {
        this.removeProjectile(index)
      }
    }
    this.projectileSourcesToClear.clear()
  }

  private findProjectileHit(
    projectile: Projectile,
    start: THREE.Vector3,
    end: THREE.Vector3,
  ): ProjectileHit | null {
    let nearest: ProjectileHit | null = null
    const sourceActor = projectile.sourceActorId
      ? this.actors.find((actor) => actor.id === projectile.sourceActorId)
      : undefined
    if (
      projectile.owner === 'actor' &&
      (sourceActor?.hostileToPlayer ??
        hostile(projectile.allegiance, this.faction))
    ) {
      const playerCenter = this.player.position.clone().add(new THREE.Vector3(0, 1.45, 0))
      const fraction = this.segmentSphereHit(start, end, playerCenter, PROJECTILE_HIT_RADIUS)
      if (fraction !== null) nearest = { fraction, actor: null, player: true }
    }

    for (const actor of this.actors) {
      const canHit =
        projectile.owner === 'player'
          ? // §5D — a player arrow can hit a villager. Nothing auto-aims it, so this is
            // a decision the player made with the mouse rather than one the game made
            // for them, which is the same line the melee auto-target draws.
            actor.hostileToPlayer || actor.allegiance === 'civilian'
          : hostile(projectile.allegiance, actor.allegiance)
      if (!actor.alive || !canHit) continue
      const center = actor.mesh.position.clone().add(new THREE.Vector3(0, 1.45, 0))
      const radius = actor.role === 'brute' ? 1.1 : PROJECTILE_HIT_RADIUS
      const fraction = this.segmentSphereHit(start, end, center, radius)
      if (fraction === null || (nearest && fraction >= nearest.fraction)) continue
      nearest = { fraction, actor, player: false }
    }
    return nearest
  }

  private segmentSphereHit(
    start: THREE.Vector3,
    end: THREE.Vector3,
    center: THREE.Vector3,
    radius: number,
  ): number | null {
    const segment = end.clone().sub(start)
    const offset = start.clone().sub(center)
    const a = segment.lengthSq()
    if (a < 0.000001) return null
    const b = 2 * offset.dot(segment)
    const c = offset.lengthSq() - radius * radius
    if (c <= 0) return 0
    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) return null
    const root = Math.sqrt(discriminant)
    const entry = (-b - root) / (2 * a)
    const exit = (-b + root) / (2 * a)
    if (entry >= 0 && entry <= 1) return entry
    if (exit >= 0 && exit <= 1) return exit
    return null
  }

  private removeProjectile(index: number): void {
    const projectile = this.projectiles[index]
    this.scene.remove(projectile.mesh)
    projectile.mesh.geometry.dispose()
    const material = projectile.mesh.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material.dispose()
    this.projectiles.splice(index, 1)
  }

  private updateParticles(delta: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]
      particle.life -= delta
      if (particle.mode === 'smoke') {
        particle.velocity.y += delta * 0.22
      } else if (particle.mode === 'spark') {
        particle.velocity.y -= delta * 18
      } else if (particle.mode === 'blood') {
        particle.velocity.y -= delta * 15
      } else if (particle.mode === 'gib') {
        particle.velocity.y -= delta * 12
      } else {
        particle.velocity.y -= delta * 9
      }
      particle.mesh.position.addScaledVector(particle.velocity, delta)
      if (
        (particle.mode === 'blood' || particle.mode === 'gib') &&
        particle.mesh.position.y <=
          this.groundHeightAt(
            particle.mesh.position.x,
            particle.mesh.position.z,
          ) +
            GORE_GROUND_Y &&
        particle.velocity.y < 0
      ) {
        if (particle.splatScale) {
          this.spawnDecal(particle.mesh.position, 'blood', particle.splatScale)
        }
        this.removeParticle(index)
        continue
      }
      particle.mesh.rotation.x +=
        delta *
        (particle.mode === 'smoke'
          ? 0.5
          : particle.mode === 'spark'
            ? 14
            : particle.mode === 'blood'
              ? 9
              : particle.mode === 'gib'
                ? 12
                : 4)
      particle.mesh.rotation.z +=
        delta *
        (particle.mode === 'smoke'
          ? 0.7
          : particle.mode === 'spark'
            ? 11
            : particle.mode === 'blood' || particle.mode === 'gib'
              ? 10
              : 3)
      if (particle.mode === 'smoke') {
        particle.mesh.scale.multiplyScalar(1 + delta * 0.42)
        const material = particle.mesh.material
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = Math.min(0.42, Math.max(0, particle.life * 0.22))
        }
      } else if (particle.mode === 'spark') {
        particle.mesh.scale.setScalar(
          THREE.MathUtils.clamp(particle.life / SPARK_LIFE, 0.01, 1),
        )
      } else if (particle.mode === 'blood' || particle.mode === 'gib') {
        const ratio = THREE.MathUtils.clamp(
          particle.life / Math.max(0.001, particle.initialLife ?? particle.life),
          0.2,
          1,
        )
        if (particle.baseScale) {
          particle.mesh.scale.copy(particle.baseScale).multiplyScalar(0.55 + ratio * 0.45)
        }
      } else {
        particle.mesh.scale.setScalar(Math.max(0.01, particle.life))
      }
      if (particle.life <= 0) {
        this.removeParticle(index)
      }
    }
  }

  private removeParticle(index: number): void {
    const particle = this.particles[index]
    if (particle.mode === 'spark') this.activeSparks = Math.max(0, this.activeSparks - 1)
    if (particle.mode === 'blood' || particle.mode === 'gib') {
      this.activeGore = Math.max(0, this.activeGore - 1)
      particle.mesh.visible = false
      particle.splatScale = undefined
      this.particles.splice(index, 1)
      this.inactiveGoreParticles.push(particle)
      return
    }
    this.scene.remove(particle.mesh)
    particle.mesh.geometry.dispose()
    const material = particle.mesh.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material.dispose()
    this.particles.splice(index, 1)
  }

  private updatePrompt(): void {
    let eventPrompt: string | null = null
    for (const event of this.activeEvents) {
      eventPrompt = event.getPrompt?.() ?? null
      if (eventPrompt) break
    }
    this.prompt = eventPrompt ?? this.getGeneratedPrompt()
  }

  private updateMission(): void {
    const currentZone = this.zoneAtPosition(
      this.player.position.x,
      this.player.position.z,
    )
    if (currentZone !== this.lastZone) {
      this.lastZone = currentZone
      this.achievements.recordZone(currentZone)
      this.callbacks.onNotice(`Открыта область: «${this.zoneName(currentZone)}».`, 'info')
    }

    const node = this.getActiveGeneratedObjective()
    if (node?.kind === 'arrive') {
      const site = this.generatedWorld.getSitePosition(node.siteId)
      if (
        site &&
        Math.hypot(
          site.x - this.player.position.x,
          site.z - this.player.position.z,
        ) <= 8
      ) {
        this.completeGeneratedObjective(node)
      }
    }
    if (this.objectives.every((objective) => objective.done)) {
      this.campaignCompleted = true
      this.endGame('victory')
    }
  }

  private updateThreat(): void {
    const nextTier = getThreatTier(this.elapsed)
    if (nextTier > this.threatTier) {
      this.threatTier = nextTier
      this.callbacks.onNotice(
        `Угроза растёт: уровень ${this.threatTier}/${MAX_THREAT_TIER}. Враги сильнее, событий и набегов больше.`,
        'warning',
      )
      this.playSound('event')
      this.emitView(true)
    }

    if (
      this.threatTier < 2 ||
      this.elapsed < this.nextThreatWaveAt ||
      this.hasNearbyEvent(THREAT_WAVE_EVENT_RADIUS)
    ) {
      return
    }

    const scheduledAt = this.nextThreatWaveAt
    this.nextThreatWaveAt = this.elapsed + this.threatWaveInterval()
    const spawned = this.spawnThreatWave(scheduledAt)
    if (spawned > 0) {
      this.callbacks.onNotice(
        `На пользователя набигают: ${formatRussianCount(spawned, [
          'враг',
          'врага',
          'врагов',
        ])}. Угроза: ${this.threatTier}.`,
        'warning',
      )
      this.playSound('event')
    }
  }

  /**
   * Layer 3 — one prowler at a time in a square the chronicle says is loud. This is the
   * cheap, always-on half of the fauna: `ambient` budget, so it yields its slot the
   * moment a real fight needs the room, and it despawns when its region streams out.
   */
  private updateAmbientBeasts(delta: number): void {
    if (this.ended) return
    this.ambientBeastCooldown -= delta
    if (this.ambientBeastCooldown > 0) return
    this.ambientBeastCooldown = AMBIENT_BEAST_INTERVAL

    for (let index = this.actors.length - 1; index >= 0; index -= 1) {
      const actor = this.actors[index]
      if (actor.budgetCategory !== 'ambient' || !isBeastRole(actor.role)) continue
      if (!this.isRegionSimulated(actor.generatedRegionId)) {
        this.removeActorById(actor.id)
      }
    }

    const prowlers = this.actors.filter(
      (actor) => actor.budgetCategory === 'ambient' && isBeastRole(actor.role),
    ).length
    if (prowlers >= AMBIENT_BEAST_LIMIT) return

    const regionId = this.generatedRegionIdAt(
      this.player.position.x,
      this.player.position.z,
    )
    if (!regionId) return
    const chronicle = this.chronicleRegions.get(regionId)
    if (!chronicle || chronicle.beastPressure < AMBIENT_BEAST_PRESSURE) return
    // A materialized raid already put beasts on the board; two sources at once reads as
    // an infestation rather than a world.
    if (this.activeEvents.some((event) => event.kind === 'beastRaid')) return

    const spawn = this.pickAmbientBeastPosition()
    if (!spawn) return
    if (this.reserveActorSlotsUpTo('ambient', 1) < 1) return
    const role = planAmbientBeast(chronicle.beastPressure, this.generatedRngStreams.event)
    const beast = this.spawnActor(
      'beast',
      role,
      spawn.x,
      spawn.z,
      this.actorSequence++,
      {
        budget: 'ambient',
        objectiveEligible: false,
        squadEligible: false,
        generatedRegionId: regionId,
      },
    )
    beast.home.copy(beast.mesh.position)
    beast.wanderTarget.copy(beast.mesh.position)
    if (!this.announcedProwlerRegionIds.has(regionId)) {
      this.announcedProwlerRegionIds.add(regionId)
      this.callbacks.onNotice(describeBeastProwler(this.regionGridLabel(regionId)), 'info')
    }
  }

  /** Out of sight but within earshot: a prowler should be met, not spawned on top of. */
  private pickAmbientBeastPosition(): THREE.Vector3 | null {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = this.eventRng() * TWO_PI
      const radius = 30 + this.eventRng() * (AMBIENT_BEAST_RADIUS - 30)
      const position = new THREE.Vector3(
        this.player.position.x + Math.sin(angle) * radius,
        0,
        this.player.position.z + Math.cos(angle) * radius,
      )
      this.clampWorldPosition(position, 3)
      if (!this.isWalkablePosition(position.x, position.z, 1)) continue
      position.y = this.groundHeightAt(position.x, position.z)
      return position
    }
    return null
  }

  // -------------------------------------------------------------------------
  // Layer 5 — ambient life
  // -------------------------------------------------------------------------

  /**
   * §5D — the villagers.
   *
   * They are the only part of Layer 5 that costs an actor slot, and they are charged to
   * `ambient` like the prowlers, so a materialized raid takes their slots before it
   * arrives short. That is the intended trade: a village that empties because something
   * is burning three hundred metres away is a better failure than a raid two beasts down.
   *
   * How many there are comes from the chronicle's `settlementIntegrity`, which is the
   * cheapest way to make a number the player has never seen legible on the ground — a
   * square that got raided last night is visibly quieter than one that did not.
   */
  private updateAmbientCivilians(delta: number): void {
    if (this.ended) return
    this.ambientCivilianCooldown -= delta
    if (this.ambientCivilianCooldown > 0) return
    this.ambientCivilianCooldown = CIVILIAN_INTERVAL

    const settlement = this.generatedWorld.findNearbySite(
      this.player.position.x,
      this.player.position.z,
      CIVILIAN_SPAWN_RADIUS,
      ['settlement', 'shop', 'recovery'],
    )
    const regionId = settlement ? String(settlement.regionId) : null
    const chronicle = regionId ? this.chronicleRegions.get(regionId) : undefined
    const wanted =
      settlement && regionId && chronicle && this.isRegionSimulated(regionId)
        ? planCivilianCount(chronicle.settlementIntegrity)
        : 0

    const civilians = this.actors.filter(
      (actor) => actor.allegiance === 'civilian' && actor.alive,
    )
    // Anyone whose village is behind them — a different square, or too far to be theirs.
    for (const civilian of civilians) {
      if (
        wanted > 0 &&
        settlement &&
        civilian.generatedRegionId === regionId &&
        civilian.mesh.position.distanceTo(this.player.position) <=
          CIVILIAN_SPAWN_RADIUS + CIVILIAN_HOME_RADIUS
      ) {
        continue
      }
      this.removeActorById(civilian.id)
    }

    const living = this.actors.filter(
      (actor) => actor.allegiance === 'civilian' && actor.alive,
    )
    if (!settlement || !regionId || living.length >= wanted) return

    const missing = Math.min(AMBIENT_CIVILIAN_LIMIT, wanted) - living.length
    if (missing <= 0) return
    // The reservation is a question, not a lease: `reserveActorSlotsUpTo` re-derives the
    // ledger from the live actor list, and so does the `claimActorSlot` inside every
    // `spawnActor` below, so a spot the ground refuses costs nothing.
    const granted = this.reserveActorSlotsUpTo('ambient', missing)
    if (granted <= 0) return

    const anchor = new THREE.Vector3(
      settlement.position.x,
      settlement.position.y,
      settlement.position.z,
    )
    let spawned = 0
    for (let index = 0; index < granted; index += 1) {
      const spot = this.pickVillagePosition(anchor)
      if (!spot) continue
      const civilian = this.spawnActor(
        'civilian',
        'peasant',
        spot.x,
        spot.z,
        this.actorSequence++,
        {
          budget: 'ambient',
          objectiveEligible: false,
          squadEligible: false,
          hostileToPlayer: false,
          generatedRegionId: regionId,
        },
      )
      civilian.home.copy(civilian.mesh.position)
      civilian.wanderTarget.copy(civilian.mesh.position)
      spawned += 1
    }
    if (spawned > 0 && !this.announcedVillageRegionIds.has(regionId)) {
      this.announcedVillageRegionIds.add(regionId)
      this.callbacks.onNotice(
        describeVillageLife(this.regionGridLabel(regionId), living.length + spawned),
        'info',
      )
    }
  }

  /** Somewhere in the village that is not on top of a house or another villager. */
  private pickVillagePosition(anchor: THREE.Vector3): THREE.Vector3 | null {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const angle = this.eventRng() * TWO_PI
      const radius = 4 + this.eventRng() * (CIVILIAN_HOME_RADIUS - 4)
      const position = new THREE.Vector3(
        anchor.x + Math.sin(angle) * radius,
        0,
        anchor.z + Math.cos(angle) * radius,
      )
      this.clampWorldPosition(position, 3)
      if (!this.isWalkablePosition(position.x, position.z, 0.6)) continue
      position.y = this.groundHeightAt(position.x, position.z)
      return position
    }
    return null
  }

  /**
   * §5D — where a villager is heading next.
   *
   * By day it is another spot in the village, which is what makes them read as walking
   * *between the houses* rather than pacing in a circle around one: `chooseWanderTarget`
   * already scatters an actor within a few metres of its `home`, so moving `home` is all
   * that is needed. At night it is the fire.
   *
   * The routine is decided by `computeNightFactor(this.elapsed)` — the simulation's
   * night — and never by the renderer's `this.nightFactor`, which is pinned to zero
   * whenever the day/night cycle is switched off for performance. Turning the cycle off
   * must not empty the campfires.
   */
  private updateCivilianRoutine(actor: Actor): void {
    if (actor.routTimer > 0) return
    const routine = civilianRoutine(this.ambientNightFactor)
    const fire = routine === 'gather' ? this.nearestCampfire(actor.mesh.position) : null
    if (fire) {
      const angle = actor.phase * 5.3
      const post = new THREE.Vector3(
        fire.position.x + Math.sin(angle) * CAMPFIRE_GATHER_RADIUS,
        0,
        fire.position.z + Math.cos(angle) * CAMPFIRE_GATHER_RADIUS,
      )
      if (this.isWalkablePosition(post.x, post.z, 0.6)) {
        post.y = this.groundHeightAt(post.x, post.z)
        actor.home.copy(post)
        return
      }
    }
    if (actor.mesh.position.distanceToSquared(actor.home) > 9) return
    // Same determinism requirement as `updateCampfires`: `pickVillagePosition` draws from
    // the shared seeded `event` stream, so it must not be reachable once per frame. A
    // villager standing on its `home` would otherwise re-roll a destination every frame
    // and make the stream's position depend on frame rate. `wanderTimer` is the natural
    // gate — it is exactly the clock that already says "time to go somewhere else", and
    // this runs before the movement block, so `chooseWanderTarget` picks its target
    // around the new `home` on the same frame.
    if (actor.wanderTimer > 0) return
    const anchor = this.generatedWorld.findNearbySite(
      actor.mesh.position.x,
      actor.mesh.position.z,
      CIVILIAN_HOME_RADIUS * 2,
      ['settlement', 'shop', 'recovery'],
    )
    if (!anchor) return
    const next = this.pickVillagePosition(
      new THREE.Vector3(anchor.position.x, anchor.position.y, anchor.position.z),
    )
    if (next) actor.home.copy(next)
  }

  private nearestCampfire(position: THREE.Vector3): Campfire | null {
    let best: Campfire | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const fire of this.campfires) {
      const distance = fire.position.distanceToSquared(position)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = fire
    }
    return best
  }

  /**
   * §5D — campfires. Props with a light, not actors, so they cost nothing but a draw.
   *
   * Lit from `computeNightFactor(this.elapsed)`, which is the world's night rather than
   * the one being drawn; the *brightness* below follows the rendered `this.nightFactor`,
   * because that one genuinely is a display value. That split is the whole point of
   * `WorldEnvironment` and it is what keeps the villagers gathering at the fire whether
   * or not anybody switched the day/night cycle on.
   */
  private updateCampfires(delta: number): void {
    const lit = civilianRoutine(this.ambientNightFactor) === 'gather'
    if (!lit || this.ended) {
      for (const fire of this.campfires) this.removeAndDisposeObject(fire.group)
      this.campfires.length = 0
      return
    }

    for (let index = this.campfires.length - 1; index >= 0; index -= 1) {
      const fire = this.campfires[index]
      if (fire.position.distanceTo(this.player.position) <= CIVILIAN_SPAWN_RADIUS + 24) {
        continue
      }
      this.removeAndDisposeObject(fire.group)
      this.campfires.splice(index, 1)
    }

    // **The search is throttled, and that is a determinism requirement rather than a
    // performance one.** `pickVillagePosition` draws from the shared seeded `event`
    // stream — the same stream that picks world events — and returns `null` when the
    // ground refuses every attempt. Retrying that every frame would make the number of
    // draws a function of *frame rate*, so two players on one seed doing the same things
    // at 30 and 144 fps would desynchronise and get different world events. Every other
    // ambient spawner is throttled for the same reason; this one was not, and it is the
    // only consumer of that stream in the engine whose rate is not already bounded by a
    // timer or an event.
    this.campfireCooldown -= delta
    if (this.campfireCooldown <= 0) {
      this.campfireCooldown = CAMPFIRE_SEARCH_INTERVAL
      if (this.campfires.length < CAMPFIRE_LIMIT) {
        const site = this.generatedWorld.findNearbySite(
          this.player.position.x,
          this.player.position.z,
          CIVILIAN_SPAWN_RADIUS,
          // Anywhere people gather, which includes a faction camp — the villagers are
          // only at the settlements, but a camp with nobody's fire lit at midnight reads
          // as abandoned rather than as a camp.
          ['settlement', 'shop', 'recovery', 'landmark', 'faction-start'],
        )
        if (
          site &&
          this.isRegionSimulated(String(site.regionId)) &&
          !this.isChronicleSiteRazed(site.id) &&
          !this.campfires.some((fire) => fire.siteId === site.id)
        ) {
          const spot = this.pickVillagePosition(
            new THREE.Vector3(site.position.x, site.position.y, site.position.z),
          )
          if (spot) this.campfires.push(this.createCampfire(site.id, spot))
        }
      }
    }

    for (const fire of this.campfires) {
      // Flicker is unseeded per-frame jitter and is deliberately the only such thing in
      // Layer 5: nothing in the simulation reads a flame's brightness.
      const flicker = 0.82 + Math.sin(this.elapsed * 9.3 + fire.position.x) * 0.12
      fire.light.intensity = 2.2 * flicker * (0.35 + this.nightFactor * 0.65)
      fire.flame.scale.setScalar(0.9 + flicker * 0.16)
      fire.flame.rotation.y += delta * 2.4
      fire.smokeTimer -= delta
      if (fire.smokeTimer <= 0) {
        fire.smokeTimer = CAMPFIRE_SMOKE_INTERVAL
        this.spawnCampfireSmoke(fire.position)
      }
    }
  }

  private createCampfire(siteId: string, position: THREE.Vector3): Campfire {
    const group = new THREE.Group()
    const stoneMaterial = this.artLibrary.createMaterial({
      color: mix(this.palette.borderStrong, this.palette.bg, 0.3),
      surface: 'dark',
    })
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * TWO_PI
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.3), stoneMaterial)
      stone.position.set(Math.sin(angle) * 0.72, 0.11, Math.cos(angle) * 0.72)
      stone.rotation.y = angle
      stone.castShadow = true
      group.add(stone)
    }
    const logMaterial = this.artLibrary.createMaterial({
      color: mix(this.palette.warning, this.palette.bg, 0.62),
      surface: 'cloth',
    })
    for (const tilt of [0.6, -0.6]) {
      const log = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.25), logMaterial)
      log.position.y = 0.22
      log.rotation.set(0.28, tilt, 0)
      log.castShadow = true
      group.add(log)
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 1.05, 6),
      new THREE.MeshStandardMaterial({
        color: this.palette.warning,
        emissive: this.palette.warning,
        emissiveIntensity: 2.1,
        transparent: true,
        opacity: 0.9,
      }),
    )
    flame.position.y = 0.72
    group.add(flame)
    const light = new THREE.PointLight(this.palette.warning, 2.2, 14, 2)
    light.position.y = 1.1
    group.add(light)
    group.position.copy(position)
    this.scene.add(group)
    return {
      group,
      light,
      flame,
      position: position.clone(),
      siteId,
      smokeTimer: CAMPFIRE_SMOKE_INTERVAL,
    }
  }

  private spawnCampfireSmoke(position: THREE.Vector3): void {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.2 + this.eventRng() * 0.12, 0),
      new THREE.MeshBasicMaterial({
        color: mix(this.palette.borderStrong, this.palette.bg, 0.5),
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    )
    mesh.position.copy(position).add(new THREE.Vector3(0, 1.3, 0))
    this.scene.add(mesh)
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3(
        (this.eventRng() - 0.5) * 0.25,
        0.85 + this.eventRng() * 0.35,
        (this.eventRng() - 0.5) * 0.25,
      ),
      life: 1.6 + this.eventRng() * 0.6,
      eventId: 'campfire',
      mode: 'smoke',
    })
  }

  /**
   * §5D — deer and birds. **Props, not actors.**
   *
   * This is the part of Layer 5 that pays for itself twice: it costs no slot out of
   * `MAX_ACTORS`, so it can never crowd out a raid, and it needs none of the actor
   * pipeline — no health bar, no morale, no threat score, no navmesh. What it needs is a
   * mesh and a reason to run, and "non-combat wildlife" is exactly the brief that makes
   * that legal.
   */
  private updateWildlife(delta: number): void {
    for (let index = this.wildlife.length - 1; index >= 0; index -= 1) {
      const prop = this.wildlife[index]
      const perch = prop.perchActorId
        ? this.actors.find((actor) => actor.id === prop.perchActorId)
        : undefined
      const strayed =
        prop.strayed ||
        prop.mesh.position.distanceTo(this.player.position) > WILDLIFE_DESPAWN_RADIUS ||
        !this.isRegionSimulated(prop.regionId) ||
        (prop.perchActorId !== null && (!perch || perch.alive))
      if (strayed || this.ended) {
        this.removeAndDisposeObject(prop.mesh)
        this.wildlife.splice(index, 1)
        continue
      }
      this.updateWildlifeProp(prop, delta)
    }
    if (this.ended) return

    this.ambientWildlifeCooldown -= delta
    if (this.ambientWildlifeCooldown > 0) return
    this.ambientWildlifeCooldown = WILDLIFE_INTERVAL

    // A body draws crows before anything else does. It reads as the aftermath of a fight
    // rather than as wildlife, which is why it gets first refusal on the bird budget.
    const corpse = this.actors.find(
      (actor) =>
        !actor.alive &&
        actor.deathAt !== null &&
        this.elapsed - actor.deathAt >= CROW_CORPSE_DELAY &&
        !this.wildlife.some((prop) => prop.perchActorId === actor.id) &&
        actor.mesh.position.distanceTo(this.player.position) < WILDLIFE_SPAWN_MAX_RADIUS,
    )
    if (corpse && this.countWildlife('bird') < WILDLIFE_BIRD_LIMIT) {
      const spot = corpse.mesh.position
        .clone()
        .add(
          new THREE.Vector3(
            (this.eventRng() - 0.5) * CROW_CORPSE_RADIUS * 2,
            0,
            (this.eventRng() - 0.5) * CROW_CORPSE_RADIUS * 2,
          ),
        )
      if (this.isWalkablePosition(spot.x, spot.z, 0.4)) {
        spot.y = this.groundHeightAt(spot.x, spot.z)
        // The crow's region comes from where the crow *is*, not from the body it came
        // for. `Actor.generatedRegionId` is `null` for whole classes of actor — the
        // starting squad, companions, `defendHome` attackers — and the per-frame despawn
        // tests `isRegionSimulated(prop.regionId)`, which is false for `null`. Inheriting
        // it built and destroyed a bird every four seconds over any such corpse while
        // suppressing the ordinary wildlife spawn.
        this.spawnWildlife('bird', spot, this.generatedRegionIdAt(spot.x, spot.z), corpse.id)
        return
      }
    }

    const biome = this.zoneAtPosition(this.player.position.x, this.player.position.z)
    const kind = planWildlife(
      this.generatedRngStreams.event,
      biome === 'forest' || biome === 'neutral',
    )
    const limit = kind === 'deer' ? WILDLIFE_DEER_LIMIT : WILDLIFE_BIRD_LIMIT
    if (this.countWildlife(kind) >= limit) return
    const spot = this.pickWildlifePosition()
    if (!spot) return
    this.spawnWildlife(kind, spot, this.generatedRegionIdAt(spot.x, spot.z), null)
  }

  private countWildlife(kind: WildlifeKind): number {
    let count = 0
    for (const prop of this.wildlife) if (prop.kind === kind) count += 1
    return count
  }

  private pickWildlifePosition(): THREE.Vector3 | null {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = this.eventRng() * TWO_PI
      const radius =
        WILDLIFE_SPAWN_MIN_RADIUS +
        this.eventRng() * (WILDLIFE_SPAWN_MAX_RADIUS - WILDLIFE_SPAWN_MIN_RADIUS)
      const position = new THREE.Vector3(
        this.player.position.x + Math.sin(angle) * radius,
        0,
        this.player.position.z + Math.cos(angle) * radius,
      )
      this.clampWorldPosition(position, 3)
      if (!this.isWalkablePosition(position.x, position.z, 0.8)) continue
      const regionId = this.generatedRegionIdAt(position.x, position.z)
      if (!this.isRegionSimulated(regionId)) continue
      position.y = this.groundHeightAt(position.x, position.z)
      return position
    }
    return null
  }

  private spawnWildlife(
    kind: WildlifeKind,
    position: THREE.Vector3,
    regionId: string | null,
    perchActorId: string | null,
  ): void {
    const mesh = kind === 'deer' ? this.createDeer() : this.createBird()
    mesh.position.copy(position)
    mesh.rotation.y = this.eventRng() * TWO_PI
    this.scene.add(mesh)
    this.wildlife.push({
      kind,
      mesh,
      velocity: new THREE.Vector3(),
      panicTimer: 0,
      wanderTimer: 1 + this.eventRng() * 3,
      phase: this.eventRng() * TWO_PI,
      regionId,
      perchActorId,
      strayed: false,
      home: position.clone(),
    })
  }

  /**
   * One prop's frame. Grazing or perched until something comes too close, then a bolt in
   * a straight line away from it — the same `fleeDirection` a panicking villager uses, so
   * "run away" has one implementation in this layer rather than three.
   */
  private updateWildlifeProp(prop: WildlifeProp, delta: number): void {
    const startle = this.nearestWildlifeThreat(prop)
    const radius = prop.kind === 'deer' ? DEER_STARTLE_RADIUS : BIRD_STARTLE_RADIUS
    const bonus =
      prop.kind === 'deer' ? DEER_SPRINT_STARTLE_BONUS : BIRD_SPRINT_STARTLE_BONUS
    if (
      startle &&
      prop.panicTimer <= 0 &&
      shouldStartle(startle.distance, radius, bonus, this.isSprinting)
    ) {
      prop.panicTimer = prop.kind === 'deer' ? DEER_BOLT_SECONDS : BIRD_FLIGHT_SECONDS
      const away = fleeDirection(
        prop.mesh.position.x,
        prop.mesh.position.z,
        startle.position.x,
        startle.position.z,
        prop.phase,
      )
      prop.velocity.set(
        away.x * (prop.kind === 'deer' ? DEER_BOLT_SPEED : BIRD_CRUISE_SPEED),
        prop.kind === 'deer' ? 0 : BIRD_CLIMB_SPEED,
        away.z * (prop.kind === 'deer' ? DEER_BOLT_SPEED : BIRD_CRUISE_SPEED),
      )
      // A bird that took off has nothing to come back to; it flies out and is collected.
      if (prop.kind === 'bird') prop.perchActorId = null
    }

    if (prop.panicTimer > 0) {
      prop.panicTimer = Math.max(0, prop.panicTimer - delta)
      prop.mesh.position.addScaledVector(prop.velocity, delta)
      if (prop.kind === 'deer') {
        this.clampWorldPosition(prop.mesh.position, 2)
        prop.mesh.position.y = this.groundHeightAt(
          prop.mesh.position.x,
          prop.mesh.position.z,
        )
      }
      if (prop.velocity.lengthSq() > 0.001) {
        prop.mesh.rotation.y = Math.atan2(prop.velocity.x, prop.velocity.z)
      }
      this.animateWildlife(prop, true)
      // A bird that has finished climbing is ~19 m up and 27 m out, which is nowhere near
      // `WILDLIFE_DESPAWN_RADIUS`. Letting it fall through to the landed branch below
      // would hard-assign its `y` to ground height and teleport it straight down in one
      // frame, in plain sight. It is gone instead — which is what "flies off" means.
      if (prop.kind === 'bird' && prop.panicTimer <= 0) prop.strayed = true
      return
    }

    if (prop.kind === 'bird') {
      // Landed: hop about, and do it on the spot rather than wandering off a body.
      prop.mesh.position.y =
        this.groundHeightAt(prop.mesh.position.x, prop.mesh.position.z) +
        Math.max(0, Math.sin(this.elapsed * 6 + prop.phase)) * 0.16
      this.animateWildlife(prop, false)
      return
    }

    prop.wanderTimer -= delta
    if (prop.wanderTimer <= 0) {
      prop.wanderTimer = 2.5 + this.eventRng() * 4
      const angle = this.eventRng() * TWO_PI
      prop.velocity.set(
        Math.sin(angle) * DEER_GRAZE_SPEED,
        0,
        Math.cos(angle) * DEER_GRAZE_SPEED,
      )
    }
    const next = prop.mesh.position.clone().addScaledVector(prop.velocity, delta)
    if (
      next.distanceToSquared(prop.home) < 18 * 18 &&
      this.isWalkablePosition(next.x, next.z, 0.8)
    ) {
      prop.mesh.position.copy(next)
      prop.mesh.position.y = this.groundHeightAt(next.x, next.z)
      if (prop.velocity.lengthSq() > 0.001) {
        prop.mesh.rotation.y = Math.atan2(prop.velocity.x, prop.velocity.z)
      }
    } else {
      prop.wanderTimer = 0
    }
    this.animateWildlife(prop, false)
  }

  /** Closest thing worth running from: the player, or anything on the actor list. */
  private nearestWildlifeThreat(prop: WildlifeProp): {
    position: THREE.Vector3
    distance: number
  } {
    let position = this.player.position
    let best = prop.mesh.position.distanceTo(this.player.position)
    for (const actor of this.actors) {
      if (!actor.alive) continue
      const distance = prop.mesh.position.distanceTo(actor.mesh.position)
      if (distance >= best) continue
      best = distance
      position = actor.mesh.position
    }
    return { position, distance: best }
  }

  private animateWildlife(prop: WildlifeProp, panicking: boolean): void {
    if (prop.kind === 'bird') {
      const wings = prop.mesh.getObjectByName('wings')
      if (wings) {
        // Wing flap is per-frame visual jitter with no simulation reader, so the run
        // clock is fine here — nothing replays a wingbeat.
        wings.rotation.z = panicking
          ? Math.sin(this.elapsed * 26 + prop.phase) * 0.95
          : Math.sin(this.elapsed * 3 + prop.phase) * 0.12
      }
      return
    }
    const legs = prop.mesh.getObjectByName('legs')
    if (legs) {
      const cadence = panicking ? 12 : 2.4
      legs.rotation.x =
        Math.sin(this.elapsed * cadence + prop.phase) * (panicking ? 0.6 : 0.16)
    }
    const body = prop.mesh.getObjectByName('deer-body')
    if (body) {
      const cadence = panicking ? 12 : 2.4
      body.position.y =
        0.9 +
        Math.abs(Math.sin(this.elapsed * cadence + prop.phase)) * (panicking ? 0.1 : 0.02)
    }
  }

  /** A deer: the beast primitives, longer in the leg and with antlers instead of tusks. */
  private createDeer(): THREE.Group {
    const group = new THREE.Group()
    const coat = mix(this.palette.warning, this.palette.text, 0.42)
    const hide = this.artLibrary.createMaterial({ color: coat, surface: 'cloth' })
    const dark = this.artLibrary.createMaterial({
      color: mix(coat, this.palette.bg, 0.5),
      surface: 'dark',
    })
    const body = new THREE.Group()
    body.name = 'deer-body'
    body.position.y = 0.9
    group.add(body)

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 1.5), hide)
    body.add(torso)
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.32), hide)
    neck.position.set(0, 0.44, 0.66)
    neck.rotation.x = -0.32
    body.add(neck)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.52), hide)
    head.position.set(0, 0.82, 0.95)
    body.add(head)
    const muzzle = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 5), dark)
    muzzle.position.set(0, 0.76, 1.24)
    muzzle.rotation.x = Math.PI / 2
    body.add(muzzle)
    for (const side of [-1, 1]) {
      const antler = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.62, 4), dark)
      antler.position.set(side * 0.13, 1.16, 0.86)
      antler.rotation.set(-0.35, 0, side * 0.5)
      body.add(antler)
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 4), dark)
      ear.position.set(side * 0.19, 0.94, 0.86)
      ear.rotation.z = side * 0.6
      body.add(ear)
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 4), dark)
    tail.position.set(0, 0.3, -0.78)
    tail.rotation.x = -2.2
    body.add(tail)

    const legs = new THREE.Group()
    legs.name = 'legs'
    legs.position.y = 0.9
    group.add(legs)
    for (const [x, z] of [
      [-0.2, 0.54],
      [0.2, 0.54],
      [-0.2, -0.54],
      [0.2, -0.54],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.16), dark)
      leg.position.set(x, -0.45, z)
      legs.add(leg)
    }

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    return group
  }

  /** A bird: a body, a beak and one wing bar that flaps. Cheap on purpose. */
  private createBird(): THREE.Group {
    const group = new THREE.Group()
    const feather = this.artLibrary.createMaterial({
      color: mix(this.palette.text, this.palette.bg, 0.24),
      surface: 'dark',
    })
    const beakMaterial = this.artLibrary.createMaterial({
      color: this.palette.warning,
      surface: 'skin',
    })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.34), feather)
    body.position.y = 0.18
    group.add(body)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.16), feather)
    head.position.set(0, 0.32, 0.16)
    group.add(head)
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), beakMaterial)
    beak.position.set(0, 0.3, 0.29)
    beak.rotation.x = Math.PI / 2
    group.add(beak)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.26), feather)
    tail.position.set(0, 0.19, -0.28)
    group.add(tail)
    const wings = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.2), feather)
    wings.name = 'wings'
    wings.position.y = 0.24
    group.add(wings)
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true
    })
    return group
  }

  private clearAmbientLife(): void {
    for (const prop of this.wildlife) this.removeAndDisposeObject(prop.mesh)
    this.wildlife.length = 0
    for (const fire of this.campfires) this.removeAndDisposeObject(fire.group)
    this.campfires.length = 0
    if (this.torchLight) {
      this.torchLight.visible = false
      this.torchLight.intensity = 0
    }
  }

  /**
   * §5D — torches after dark.
   *
   * A patrol that walks past at night carrying a light is the cheapest ambient beat in
   * the layer: it is a child mesh on an actor that already exists, so it costs no slot,
   * no draw call worth counting and no update. The **light** is the expensive part, so
   * there is exactly one of them and it follows the nearest torch-bearer; a point light
   * per soldier would put twenty of them in the scene and is the one thing this layer is
   * not allowed to do.
   *
   * Lit from `computeNightFactor(this.elapsed)` — the world's night, not the renderer's —
   * for the same reason the campfires are, so switching the day/night cycle off does not
   * put out every torch in the world.
   */
  private updateTorches(): void {
    const lit = this.ambientNightFactor >= CAMPFIRE_NIGHT_THRESHOLD && !this.ended
    let nearest: Actor | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const actor of this.actors) {
      const wants = lit && actor.alive && carriesTorch(actor.role, actor.allegiance)
      const torch = actor.mesh.getObjectByName('torch')
      if (wants && !torch) this.attachTorch(actor)
      else if (!wants && torch) this.removeAndDisposeObject(torch)
      if (!wants) continue
      const distance = actor.mesh.position.distanceToSquared(this.player.position)
      if (distance >= bestDistance) continue
      bestDistance = distance
      nearest = actor
    }

    if (!this.torchLight) return
    if (!nearest || bestDistance > TORCH_LIGHT_RANGE * TORCH_LIGHT_RANGE) {
      this.torchLight.visible = false
      return
    }
    this.torchLight.visible = true
    this.torchLight.position.copy(nearest.mesh.position).add(TORCH_LIGHT_OFFSET)
    // Unseeded per-frame flicker, like the campfire's: nothing reads a torch's brightness.
    this.torchLight.intensity =
      2.4 * (0.85 + Math.sin(this.elapsed * 11.7 + nearest.phase) * 0.15)
  }

  private attachTorch(actor: Actor): void {
    const hand = actor.mesh.getObjectByName('weapon') ?? actor.mesh
    const torch = new THREE.Group()
    torch.name = 'torch'
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.62, 0.07),
      this.artLibrary.createMaterial({
        color: mix(this.palette.warning, this.palette.bg, 0.68),
        surface: 'cloth',
      }),
    )
    shaft.position.y = 0.31
    torch.add(shaft)
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.34, 5),
      new THREE.MeshStandardMaterial({
        color: this.palette.warning,
        emissive: this.palette.warning,
        emissiveIntensity: 2.4,
        transparent: true,
        opacity: 0.92,
      }),
    )
    flame.position.y = 0.78
    torch.add(flame)
    torch.position.set(0.12, 0.1, 0.1)
    hand.add(torch)
  }

  private updateChronicle(delta: number): void {    if (this.ended) return
    this.chronicleAccumulator += delta
    if (this.chronicleAccumulator < CHRONICLE_TICK_SECONDS) return

    const frozenRegionIds = new Set(
      this.generatedWorld.regions.getSimulatedRegionIds().map(String),
    )
    const playerObjectiveRatio =
      this.objectives.length === 0
        ? 0
        : this.objectives.filter((objective) => objective.done).length /
          this.objectives.length
    const environment = createChronicleEnvironment(
      this.elapsed,
      this.weatherWeights,
    )
    const events: ChronicleEvent[] = []
    let ticks = 0
    while (
      this.chronicleAccumulator >= CHRONICLE_TICK_SECONDS &&
      ticks < CHRONICLE_MAX_CATCHUP_TICKS
    ) {
      this.chronicleAccumulator -= CHRONICLE_TICK_SECONDS
      ticks += 1
      events.push(
        ...tickChronicle({
          blueprint: this.generatedBlueprint,
          state: this.chronicleState,
          regions: this.chronicleRegions,
          rng: this.generatedRngStreams.chronicle,
          environment,
          playerFaction: this.faction,
          playerObjectiveRatio,
          protectedRegionIds: this.chronicleProtectedRegionIds,
          frozenRegionIds,
        }),
      )
    }
    if (this.chronicleAccumulator >= CHRONICLE_TICK_SECONDS) {
      this.chronicleAccumulator = 0
    }
    this.chronicleContestedRegionIds = getContestedRegionIds(
      this.generatedBlueprint,
      this.chronicleRegions,
    )
    if (events.length > 0) this.handleChronicleEvents(events)
  }

  private handleChronicleEvents(events: readonly ChronicleEvent[]): void {
    const discovered = new Set(
      this.generatedWorld.discoveredRegionIds.map(String),
    )
    let announced = 0
    for (const event of events) {
      const regionId = String(event.regionId)
      if (event.kind === 'regionCaptured') {
        this.refreshChronicleEncounterPlans(regionId)
      }
      if (event.kind === 'settlementBurned') {
        this.refreshChronicleRazedSites()
      }
      const salient =
        event.kind === 'settlementBurned' ||
        event.kind === 'regionCaptured' ||
        event.kind === 'caravanLost'
      if (!salient || announced >= 2 || !discovered.has(regionId)) continue
      announced += 1
      this.callbacks.onNotice(
        this.describeChronicleEntry(event),
        chronicleEventTone(event.kind),
      )
    }
    this.emitView(true)
  }

  private describeChronicleEntry(event: ChronicleEvent): string {
    const region = this.generatedBlueprint.regions.find(
      (candidate) => String(candidate.id) === String(event.regionId),
    )
    const site = event.siteId
      ? this.generatedBlueprint.sites.find(
          (candidate) => candidate.id === event.siteId,
        )
      : undefined
    return describeChronicleEvent(
      {
        kind: event.kind,
        regionLabel: region
          ? formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
          : '??',
        faction: event.faction,
        siteLabel: site ? generatedSiteLabel(site.kind) : null,
      },
      event.id,
    )
  }

  private buildChronicleFeed(): ChronicleEntryView[] {
    const discovered = new Set(
      this.generatedWorld.discoveredRegionIds.map(String),
    )
    const log = this.chronicleState.log
    const signature = `${this.chronicleState.tick}:${discovered.size}:${log.length}:${log[log.length - 1]?.id ?? ''}`
    if (signature === this.chronicleFeedSignature) return this.chronicleFeed
    this.chronicleFeedSignature = signature
    this.chronicleFeed = log
      .filter((event) => discovered.has(String(event.regionId)))
      .slice(-CHRONICLE_FEED_LIMIT)
      .reverse()
      .map((event) => {
        const region = this.generatedBlueprint.regions.find(
          (candidate) => String(candidate.id) === String(event.regionId),
        )
        return {
          id: event.id,
          tick: event.tick,
          regionLabel: region
            ? formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
            : '??',
          text: this.describeChronicleEntry(event),
          tone: chronicleEventTone(event.kind),
        }
      })
    return this.chronicleFeed
  }

  private refreshChronicleEncounterPlans(regionId: string): void {
    const control = this.chronicleRegions.get(regionId)?.control ?? 'neutral'
    if (this.chronicleEncounterPlanControl.get(regionId) === control) return
    this.chronicleEncounterPlanControl.set(regionId, control)
    const slots = this.generatedBlueprint.encounters.filter(
      (slot) => String(slot.regionId) === regionId,
    )
    if (slots.length === 0) return
    const overlay = this.createChronicleBlueprintOverlay(regionId, control)
    this.generatedEncounterPlans.set(
      regionId,
      slots.map((slot) =>
        createGeneratedEncounterPlan(overlay, slot, this.faction),
      ),
    )
  }

  private createChronicleBlueprintOverlay(
    regionId: string,
    control: Territory,
  ): WorldBlueprint {
    return {
      ...this.generatedBlueprint,
      regions: this.generatedBlueprint.regions.map((region) =>
        String(region.id) === regionId ? { ...region, territory: control } : region,
      ),
      sites: this.generatedBlueprint.sites.map((site) =>
        String(site.regionId) === regionId && !isProtectedSite(site)
          ? { ...site, owner: control }
          : site,
      ),
    }
  }

  private refreshChronicleRazedSites(): void {
    this.chronicleRazedSiteIds.clear()
    for (const site of this.generatedBlueprint.sites) {
      if (!isSettlementSite(site)) continue
      if (isRegionRazed(this.chronicleRegions.get(String(site.regionId)))) {
        this.chronicleRazedSiteIds.add(site.id)
      }
    }
    this.applyChronicleRazedVisuals()
  }

  private isChronicleSiteRazed(siteId: string): boolean {
    return this.chronicleRazedSiteIds.has(siteId)
  }

  private applyChronicleRazedVisuals(): void {
    if (!this.scorchedMaterialAdopted) {
      // Lazily adopted: the field initialiser runs before `artLibrary` exists, and a
      // razed site that still shades like plain PBR reads as a different game.
      this.artLibrary.adoptMaterial(this.scorchedMaterial, { surface: 'dark' })
      this.scorchedMaterialAdopted = true
    }
    for (const siteId of this.chronicleRazedSiteIds) {
      const group = this.scene.getObjectByName(`site:${siteId}`)
      if (!group || group.userData.chronicleRazed === true) continue
      group.userData.chronicleRazed = true
      group.scale.set(1, 0.68, 1)
      group.traverse((child) => {
        // A shell shares its source's geometry and transform, so overwriting its
        // outline material leaves an invisible duplicate draw and the site loses the
        // silhouette that makes a razed village read through fog. Nothing ever
        // reassigns a shell's material, so that loss would survive every ink toggle.
        if (!(child instanceof THREE.Mesh) || StylizedArtLibrary.isOutlineShell(child)) return
        child.material = this.scorchedMaterial
      })
    }
  }

  private syncChronicleToRegionDeltas(): void {
    for (const [regionId, chronicle] of this.chronicleRegions) {
      this.generatedWorld.regions.setRegionChronicle(regionId, chronicle)
    }
  }

  private eventCooldownRange(): { min: number; max: number } {    const tierOffset = this.threatTier - 1
    return {
      min: Math.max(30, EVENT_COOLDOWN_MIN - tierOffset * 5),
      max: Math.max(42, EVENT_COOLDOWN_MAX - tierOffset * 7),
    }
  }

  private threatWaveInterval(): number {
    return Math.max(THREAT_WAVE_MIN_INTERVAL, 130 - this.threatTier * 12)
  }

  private enemyHealthMultiplier(allegiance: Allegiance): number {
    return hostile(this.faction, allegiance) ? 1 + (this.threatTier - 1) * 0.12 : 1
  }

  private enemyDamageMultiplier(actor: Actor): number {
    return actor.hostileToPlayer ? 1 + (this.threatTier - 1) * 0.09 : 1
  }

  private spawnThreatWave(scheduledAt: number): number {
    const requested = Math.min(4, this.threatTier)
    const count = this.reserveActorSlotsUpTo('campaign', requested)
    if (count === 0) return 0

    const enemyFaction: Faction = this.faction === 'guard' ? 'villain' : 'guard'
    let spawned = 0
    const baseAngle = this.generatedWorld
      ? this.directorRng() * TWO_PI
      : scheduledAt * 0.037 + this.threatTier * 1.7
    const generatedRegionId = this.generatedRegionIdAt(
      this.player.position.x,
      this.player.position.z,
    )
    for (let index = 0; index < count; index += 1) {
      const role: ActorRole =
        this.threatTier >= 4 && index === count - 1
          ? 'brute'
          : index % 3 === 2
            ? 'archer'
            : enemyFaction === 'villain'
              ? 'minion'
              : 'soldier'
      const radius = 13 + index * 1.2
      let spawnPosition: THREE.Vector3 | null = null
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const angle = baseAngle + index * 1.8 + attempt * 0.73
        const candidate = new THREE.Vector3(
          this.player.position.x + Math.sin(angle) * radius,
          0,
          this.player.position.z + Math.cos(angle) * radius,
        )
        this.clampWorldPosition(
          candidate,
          this.actorColliderRadiusForRole(role) + 1,
        )
        const { x, z } = candidate
        if (!this.isWalkablePosition(x, z, this.actorColliderRadiusForRole(role))) continue
        spawnPosition = new THREE.Vector3(x, 0, z)
        break
      }
      if (!spawnPosition) continue

      const actor = this.spawnActor(
        enemyFaction,
        role,
        spawnPosition.x,
        spawnPosition.z,
        this.actors.length + index,
        {
          budget: 'campaign',
          objectiveEligible: false,
          squadEligible: false,
          generatedRegionId,
        },
      )
      actor.playerAggro = true
      actor.aggroMemory = AGGRO_MEMORY_DURATION
      actor.lastKnownTargetPos = this.player.position.clone()
      spawned += 1
    }
    return spawned
  }

  private actorUsageByCategory(): ActorBudgetUsage {
    const usage = createActorBudgetUsage()
    for (const actor of this.actors) usage[actor.budgetCategory] += 1
    return usage
  }

  /**
   * §5.1 — the one reservation seam. The ledger is re-derived from the live actors on
   * every call, so it can never drift away from the scene the way the old scattered
   * `actors.length + n <= MAX_ACTORS` checks did.
   */
  private reserveActorSlots(category: ActorBudgetCategory, count: number): boolean {
    this.actorBudget.sync(this.actorUsageByCategory())
    return this.actorBudget.reserve(category, count)
  }

  private reserveActorSlotsUpTo(
    category: ActorBudgetCategory,
    count: number,
  ): number {
    this.actorBudget.sync(this.actorUsageByCategory())
    return this.actorBudget.reserveUpTo(category, count)
  }

  /** Frees room for a higher-priority category. Ambient is asked first, by design. */
  private yieldActorSlots(category: ActorBudgetCategory, count: number): number {
    let freed = 0
    if (category === 'chronicle') {
      // Half a raid is worse than no raid: hand whole located events back to the
      // chronicle before plucking individual fighters out of one.
      for (const event of this.locatedEventsByDistance()) {
        if (freed >= count) break
        const owned = event.ownedActorIds.filter((actorId) =>
          this.actors.some((actor) => actor.id === actorId),
        ).length
        if (owned === 0) continue
        this.dematerializeEvent(event)
        freed += owned
      }
    }
    for (const actor of this.yieldOrderedActors(category)) {
      if (freed >= count) break
      this.removeActorById(actor.id)
      freed += 1
    }
    return freed
  }

  private yieldOrderedActors(category: ActorBudgetCategory): Actor[] {
    return this.actors
      .filter((actor) => actor.budgetCategory === category)
      .sort((left, right) => this.actorYieldRank(left) - this.actorYieldRank(right))
  }

  /** Lower ranks are given up first: corpses, then bystanders, then the far away. */
  private actorYieldRank(actor: Actor): number {
    if (!actor.alive) return -1_000_000
    return (
      (actor.objectiveEligible ? 400 : 0) +
      (actor.generatedUnique ? 400 : 0) +
      (actor.generatedObjectiveId ? 800 : 0) -
      actor.mesh.position.distanceTo(this.player.position)
    )
  }

  /**
   * Charges one slot to `category`. Callers reserve up front, but this is the hard
   * gate: nothing reaches the scene without a slot, so `this.actors.length` can never
   * pass `MAX_ACTORS` no matter which spawn path is taken.
   */
  private claimActorSlot(category: ActorBudgetCategory): void {
    if (this.reserveActorSlots(category, 1)) return
    while (this.actors.length >= MAX_ACTORS) {
      const victim = this.pickEvictableActor(category)
      if (!victim) break
      this.removeActorById(victim.id)
    }
  }

  private pickEvictableActor(category: ActorBudgetCategory): Actor | null {
    const claimant = ACTOR_BUDGET_PRIORITY.indexOf(category)
    let victim: Actor | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const actor of this.actors) {
      const priority = ACTOR_BUDGET_PRIORITY.indexOf(actor.budgetCategory)
      if (priority < claimant) continue
      const score = -priority * 10_000_000 + this.actorYieldRank(actor)
      if (score >= bestScore) continue
      bestScore = score
      victim = actor
    }
    return victim
  }

  private cleanupDeadActors(): void {
    for (let index = this.actors.length - 1; index >= 0; index -= 1) {
      const actor = this.actors[index]
      if (this.isEventOwnedActor(actor.id)) continue
      if (actor.deathAt !== null && this.elapsed - actor.deathAt >= CORPSE_LIFETIME) {
        this.removeActorById(actor.id)
      }
    }
  }

  private isEventOwnedActor(actorId: string): boolean {
    return this.activeEvents.some((event) => event.ownedActorIds.includes(actorId))
  }

  /** The event the HUD banner shows: the player's own, else the nearest located one. */
  private get primaryEvent(): WorldEvent | null {
    const anchored = this.playerAnchoredEvent
    if (anchored) return anchored
    let best: WorldEvent | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const event of this.activeEvents) {
      const distance = event.markerPos.distanceToSquared(this.player.position)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = event
    }
    return best
  }

  private get playerAnchoredEvent(): WorldEvent | null {
    return this.activeEvents.find((event) => event.anchor === 'player') ?? null
  }

  private get locatedEvents(): WorldEvent[] {
    return this.activeEvents.filter((event) => event.anchor === 'located')
  }

  /** Farthest first: the event the player cares least about gives up its slots first. */
  private locatedEventsByDistance(): WorldEvent[] {
    return this.locatedEvents.sort(
      (left, right) =>
        right.markerPos.distanceToSquared(this.player.position) -
        left.markerPos.distanceToSquared(this.player.position),
    )
  }

  private isRegionSimulated(regionId: string | null): boolean {
    return regionId !== null && this.simulatedGeneratedRegions.has(regionId)
  }

  private updateEvents(delta: number): void {
    if (this.ended) {
      this.cancelActiveEvents()
      return
    }

    for (const event of [...this.activeEvents]) {
      if (event.state === 'active') {
        // Layer 2: a located event whose region streamed out is not cancelled — it is
        // handed back to the chronicle, which resolves it and records who won.
        if (event.anchor === 'located' && !this.isRegionSimulated(event.regionId)) {
          this.dematerializeEvent(event)
          continue
        }
        event.update?.(delta)
        if (event.state === 'active' && event.timer !== null) {
          event.timer = Math.max(0, event.timer - delta)
          if (event.timer <= 0) {
            if (event.anchor === 'located') {
              this.dematerializeEvent(event)
              continue
            }
            event.state = 'failed'
          }
        }
      }
      if (event.state !== 'active') this.finishEvent(event, event.state === 'succeeded')
    }

    this.updateMaterialization(delta)

    if (this.playerAnchoredEvent) return
    this.eventCooldown = Math.max(0, this.eventCooldown - delta)
    if (this.eventCooldown > 0) return
    if (!this.startRandomEvent()) this.eventCooldown = EVENT_RETRY
  }

  /**
   * §5.2 — turns what the chronicle is holding back in simulated regions into a real
   * fight. One per interval, so the world stays legible instead of erupting at once.
   */
  private updateMaterialization(delta: number): void {
    this.materializeCooldown -= delta
    if (this.materializeCooldown > 0) return
    this.materializeCooldown = MATERIALIZE_INTERVAL
    if (this.locatedEvents.length >= MAX_LOCATED_EVENTS) return

    const pending = findPendingMaterializations({
      blueprint: this.generatedBlueprint,
      regions: this.chronicleRegions,
      chronicle: this.chronicleState,
      simulatedRegionIds: this.simulatedGeneratedRegions,
      protectedRegionIds: this.chronicleProtectedRegionIds,
      playerFaction: this.faction,
      seenAftermathRegionIds: this.seenAftermathRegionIds,
    })
    for (const situation of pending) {
      if (this.materializedSituationIds.has(situation.id)) continue
      if (this.activeEvents.some((event) => event.regionId === situation.regionId)) {
        continue
      }
      const event = this.materializeSituation(situation)
      if (!event) continue
      this.activeEvents.push(event)
      this.materializedSituationIds.add(situation.id)
      if (situation.kind === 'aftermath') {
        this.seenAftermathRegionIds.add(situation.regionId)
      }
      this.callbacks.onNotice(
        describeLocatedEventStart(situation.kind, this.locatedCopyContext(situation)),
        'warning',
      )
      this.playSound('event')
      this.emitView(true)
      return
    }
  }

  private materializeSituation(
    situation: PendingMaterialization,
  ): WorldEvent | null {
    switch (situation.kind) {
      case 'factionRaid':
        return this.startFactionRaidEvent(situation)
      case 'caravanAmbush':
        return this.startCaravanAmbushEvent(situation)
      case 'warband':
        return this.startWarbandEvent(situation)
      case 'aftermath':
        return this.startAftermathEvent(situation)
      case 'beastRaid':
        return this.startBeastRaidEvent(situation)
    }
  }

  private locatedCopyContext(
    situation: PendingMaterialization,
  ): LocatedEventCopyContext {
    const region = this.generatedBlueprint.regions.find(
      (candidate) => String(candidate.id) === situation.regionId,
    )
    const site = situation.siteId
      ? this.generatedBlueprint.sites.find(
          (candidate) => candidate.id === situation.siteId,
        )
      : undefined
    return {
      regionLabel: region
        ? formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
        : '??',
      siteLabel: site ? generatedSiteLabel(site.kind) : null,
      faction: situation.faction,
      defender:
        situation.defender === null || situation.defender === 'neutral'
          ? null
          : situation.defender,
    }
  }

  private regionGridLabel(regionId: string | null): string {
    const region = this.generatedBlueprint.regions.find(
      (candidate) => String(candidate.id) === regionId,
    )
    return region
      ? formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
      : '??'
  }

  /** Hands a live fight back to the chronicle rather than deleting it. */
  private dematerializeEvent(event: WorldEvent): void {
    if (!this.activeEvents.includes(event)) return
    const chronicleEvents = event.handBack?.() ?? []
    this.releaseEvent(event)
    this.callbacks.onNotice(
      describeEventHandback(this.regionGridLabel(event.regionId)),
      'info',
    )
    if (chronicleEvents.length > 0) this.handleChronicleEvents(chronicleEvents)
    else this.emitView(true)
  }

  private releaseEvent(event: WorldEvent): void {
    event.cleanup()
    const index = this.activeEvents.indexOf(event)
    if (index >= 0) this.activeEvents.splice(index, 1)
    if (event.situationId) this.materializedSituationIds.delete(event.situationId)
    this.locatedEventCopy.delete(event.id)
  }

  /** True while a fight the player can actually see is running. */
  private hasNearbyEvent(radius: number): boolean {
    return this.activeEvents.some(
      (event) =>
        event.anchor === 'player' ||
        event.markerPos.distanceTo(this.player.position) <= radius,
    )
  }

  private countAliveActors(actorIds: readonly string[]): number {
    return actorIds.reduce((count, actorId) => {
      const actor = this.actors.find((candidate) => candidate.id === actorId)
      return count + (actor && actor.alive ? 1 : 0)
    }, 0)
  }


  private startRandomEvent(): boolean {
    const eligibleKinds = this.getEligibleEventKinds()
    if (eligibleKinds.length === 0) return false

    const totalWeight = eligibleKinds.reduce(
      (total, kind) => total + EVENT_WEIGHTS[this.faction][kind],
      0,
    )
    let roll = this.eventRng() * totalWeight
    let selected = eligibleKinds[eligibleKinds.length - 1]
    for (const kind of eligibleKinds) {
      roll -= EVENT_WEIGHTS[this.faction][kind]
      if (roll <= 0) {
        selected = kind
        break
      }
    }

    const event =
      selected === 'richCaravan'
        ? this.startRichCaravanEvent()
        : selected === 'defendHome'
          ? this.startDefendHomeEvent()
          : selected === 'champion'
            ? this.startChampionEvent()
            : selected === 'rescue'
              ? this.startRescueEvent()
              : this.startBountyEvent()
    if (!event) return false

    this.activeEvents.push(event)
    this.callbacks.onNotice(`Событие: ${event.title}. ${event.description}`, event.tone)
    this.playSound('event')
    this.emitView(true)
    return true
  }

  private getEligibleEventKinds(): RandomWorldEventKind[] {
    return RANDOM_WORLD_EVENT_KINDS.filter((kind) => {
      if (!this.canAffordEvent(kind)) return false
      if (kind === 'defendHome') return this.pickDefendHomePosition() !== null
      return true
    })
  }

  private canAffordEvent(kind: WorldEventKind): boolean {
    this.actorBudget.sync(this.actorUsageByCategory())
    return this.actorBudget.availableFor('chronicle') >= EVENT_REQUIRED_SLOTS[kind]
  }

  private finishEvent(event: WorldEvent, succeeded: boolean): void {
    if (!this.activeEvents.includes(event)) return
    this.achievements.recordWorldEvent(event.kind, succeeded)
    const message = isRandomWorldEventKind(event.kind)
      ? this.resolveRandomEventOutcome(event.kind, succeeded)
      : this.resolveLocatedEventOutcome(event, succeeded)
    if (succeeded) {
      this.spawnEventLoot(event)
      this.callbacks.onNotice(message, 'success')
      this.playSound('eventWin')
    } else {
      this.callbacks.onNotice(message, 'danger')
      this.playSound('eventFail')
    }

    this.releaseEvent(event)
    if (event.anchor === 'player') {
      const cooldown = this.eventCooldownRange()
      this.eventCooldown = cooldown.min + this.eventRng() * (cooldown.max - cooldown.min)
    }
    this.emitView(true)
  }

  private resolveRandomEventOutcome(
    kind: RandomWorldEventKind,
    succeeded: boolean,
  ): string {
    if (!succeeded) return WORLD_EVENT_FAILURE_MESSAGES[kind]
    if (kind === 'richCaravan') {
      this.gold += 180
      this.achievements.recordGoldEarned(180)
      this.achievements.recordCaravanRobbed(true)
      return 'Богатый корован ограблен, погоня позади. +180 золота.'
    }
    if (kind === 'defendHome') {
      this.gold += 90
      this.achievements.recordGoldEarned(90)
      this.health = Math.min(this.maxHealth, this.health + 8)
      return 'Дом отбили! +90 золота и +8 здоровья.'
    }
    if (kind === 'champion') {
      this.gold += 120
      this.achievements.recordGoldEarned(120)
      const damageBonus = Math.min(
        6,
        Math.max(0, CHAMPION_DAMAGE_CAP - this.championDamageBonus),
      )
      this.championDamageBonus += damageBonus
      this.damage += damageBonus
      return damageBonus > 0
        ? `Чемпион побеждён! +120 золота и +${damageBonus} к урону.`
        : 'Чемпион побеждён! +120 золота. Урон уже достиг предела.'
    }
    if (kind === 'rescue') return 'Пленник спасён и теперь идёт в твоём отряде.'
    this.gold += 70
    this.achievements.recordGoldEarned(70)
    return 'Заказ выполнен, награда в кармане. +70 золота.'
  }

  /**
   * A materialized event that ends with the player present still folds its result into
   * the chronicle — the difference is only that they were there to see it.
   */
  private resolveLocatedEventOutcome(
    event: WorldEvent,
    succeeded: boolean,
  ): string {
    const chronicleEvents = event.handBack?.() ?? []
    if (succeeded) {
      const reward = LOCATED_EVENT_REWARDS[event.kind as ChronicleWorldEventKind]
      this.gold += reward
      this.achievements.recordGoldEarned(reward)
    }
    const context = this.locatedEventCopy.get(event.id) ?? {
      regionLabel: this.regionGridLabel(event.regionId),
      siteLabel: null,
      faction: null,
      defender: null,
    }
    if (chronicleEvents.length > 0) this.handleChronicleEvents(chronicleEvents)
    return describeLocatedEventOutcome(
      event.kind as ChronicleWorldEventKind,
      succeeded,
      context,
    )
  }


  private cancelActiveEvents(): void {
    for (const event of [...this.activeEvents]) {
      event.cleanup()
      if (event.situationId) this.materializedSituationIds.delete(event.situationId)
      this.locatedEventCopy.delete(event.id)
    }
    this.activeEvents.length = 0
  }

  private createWorldEvent(config: WorldEventConfig): WorldEvent {
    let cleaned = false
    const event: WorldEvent = {
      anchor: 'player',
      regionId: null,
      situationId: null,
      slots: EVENT_REQUIRED_SLOTS[config.kind],
      ...config,
      cleanup: () => {
        if (cleaned) return
        cleaned = true
        for (const [targetId, target] of this.eventPropTargets) {
          if (target.ownerId === event.id) this.eventPropTargets.delete(targetId)
        }
        this.removeEventParticles(event.id)
        for (const actorId of [...event.ownedActorIds]) this.removeActorById(actorId)
        event.ownedActorIds.length = 0
        for (const prop of event.ownedProps) this.removeAndDisposeObject(prop)
        event.ownedProps.length = 0
      },
    }
    return event
  }

  private startRichCaravanEvent(): WorldEvent | null {
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.richCaravan)) {
      return null
    }

    const id = this.nextEventId('richCaravan')
    const caravan = this.createCaravan(true)
    const position = this.pickEventPosition()
    caravan.position.copy(position)
    caravan.position.y = this.groundHeightAt(caravan.position.x, caravan.position.z)
    this.scene.add(caravan)
    this.registerNamedInteractableOutline(caravan, 'cargo')

    const enemyFaction = this.pickEventEnemyFaction()
    const ownedActorIds: string[] = []
    const generatedRegionId = this.generatedRegionIdAt(
      caravan.position.x,
      caravan.position.z,
    )
    const escortOffsets: Array<[number, number]> = [
      [-4.5, -4],
      [0, 4.5],
      [4.5, -4],
    ]
    escortOffsets.forEach(([x, z], index) => {
      const escortPosition = new THREE.Vector3(
        caravan.position.x + x,
        0,
        caravan.position.z + z,
      )
      this.clampWorldPosition(escortPosition, 3)
      const escort = this.spawnActor(
        enemyFaction,
        index === 1 ? 'brute' : 'soldier',
        escortPosition.x,
        escortPosition.z,
        this.actors.length + index,
        {
          objectiveEligible: false,
          squadEligible: false,
          budget: 'chronicle',
          eventOwnerId: id,
          generatedRegionId,
        },
      )
      ownedActorIds.push(escort.id)
    })

    let robbed = false
    let robberyPoint: THREE.Vector3 | null = null
    let direction = caravan.position.x > 0 ? -1 : 1
    const travelDirection = this.generatedCaravanTravelDirection
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'richCaravan',
      state: 'active',
      title: 'Богатый корован',
      description: 'Ограбь обоз и отойди от места налёта на 18 метров.',
      tone: 'warning',
      timer: 25,
      progress: 0,
      target: 18,
      markerId: `${id}-marker`,
      markerPos: caravan.position.clone(),
      ownedActorIds,
      ownedProps: [caravan],
      update: (delta) => {
        if (!robbed) {
          const previousX = caravan.position.x
          const previousZ = caravan.position.z
          caravan.position.x += travelDirection.x * direction * delta * 2.8
          caravan.position.z += travelDirection.y * direction * delta * 2.8
          this.clampWorldPosition(caravan.position, 3)
          if (
            Math.abs(caravan.position.x - previousX) < 0.0001 &&
            Math.abs(caravan.position.z - previousZ) < 0.0001
          ) {
            direction *= -1
          }
          caravan.position.y = this.groundHeightAt(
            caravan.position.x,
            caravan.position.z,
          )
          caravan.rotation.y = Math.atan2(
            -travelDirection.y * direction,
            travelDirection.x * direction,
          )
          for (const wheel of caravan.getObjectsByProperty('name', 'wheel')) {
            wheel.rotation.z -= delta * (2.8 / 0.9)
          }
          event.markerPos.copy(caravan.position)
        }
        escortOffsets.forEach(([x, z], index) => {
          const escort = this.actors.find(
            (actor) => actor.id === ownedActorIds[index] && actor.alive,
          )
          if (!escort) return
          escort.home.set(
            caravan.position.x + x,
            this.groundHeightAt(caravan.position.x + x, caravan.position.z + z),
            caravan.position.z + z,
          )
          if (
            !escort.targetId &&
            escort.mesh.position.distanceTo(this.player.position) >= 15
          ) {
            escort.wanderTarget.copy(escort.home)
          }
        })
        if (!robbed) return
        if (!robberyPoint) return
        event.progress = Math.min(event.target, this.player.position.distanceTo(robberyPoint))
        event.markerPos.copy(robberyPoint)
        if (event.progress >= event.target) event.state = 'succeeded'
      },
      onInteract: () => {
        if (this.player.position.distanceTo(caravan.position) >= 7) return false
        if (!robbed) {
          robbed = true
          robberyPoint = this.player.position.clone()
          event.description = 'Отойди от места налёта на 18 метров, пока идёт отсчёт.'
          event.markerPos.copy(robberyPoint)
          const cargo = caravan.getObjectByName('cargo')
          if (cargo instanceof THREE.Mesh) cargo.scale.y = 0.38
          this.callbacks.onNotice('Добыча у тебя. Теперь уходи от погони!', 'warning')
          this.playSound('coin')
        }
        return true
      },
      getPrompt: () =>
        !robbed && this.player.position.distanceTo(caravan.position) < 7
          ? '[E] Ограбить богатый корован'
          : null,
    })
    return event
  }

  private pickDefendHomePosition(): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const site of this.generatedBlueprint.sites) {
      if (site.kind !== 'settlement') continue
      const position = this.generatedWorld.getSitePosition(site.id)
      if (!position) continue
      const distance = Math.hypot(
        position.x - this.player.position.x,
        position.z - this.player.position.z,
      )
      if (distance > DEFEND_HOME_MAX_DISTANCE || distance >= bestDistance) continue
      bestDistance = distance
      best = new THREE.Vector3(position.x, position.y, position.z)
    }
    return best
  }

  private startDefendHomeEvent(): WorldEvent | null {
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.defendHome)) {
      return null
    }
    const homePosition = this.pickDefendHomePosition()
    if (!homePosition) return null

    const id = this.nextEventId('defendHome')
    const fire = this.createHouseFireEffect(homePosition)
    this.scene.add(fire)
    const target: EventPropTarget = {
      id: `${id}-home`,
      ownerId: id,
      object: fire,
      hp: 100,
      maxHp: 100,
      position: homePosition.clone(),
      attackRange: 5.2,
    }
    this.eventPropTargets.set(target.id, target)
    this.spawnDecal(target.position, 'scorch', 4.8)

    const enemyFaction = this.pickEventEnemyFaction()
    const ownedActorIds: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2 + this.eventRng() * 0.45
      const radius = 17 + this.eventRng() * 4
      const spawnPosition = new THREE.Vector3(
        target.position.x + Math.sin(angle) * radius,
        0,
        target.position.z + Math.cos(angle) * radius,
      )
      this.clampWorldPosition(spawnPosition, 3)
      const attacker = this.spawnActor(
        enemyFaction,
        index === 3 ? 'brute' : 'soldier',
        spawnPosition.x,
        spawnPosition.z,
        this.actors.length + index,
        {
          objectiveEligible: false,
          squadEligible: false,
          aiMode: 'attackEventProp',
          budget: 'chronicle',
          eventOwnerId: id,
          eventPropTargetId: target.id,
        },
      )
      ownedActorIds.push(attacker.id)
    }

    let smokeCooldown = 0
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'defendHome',
      state: 'active',
      title: 'Дом в огне',
      description: 'Победи четверых налётчиков, пока дом не сгорел дотла.',
      tone: 'danger',
      timer: 45,
      progress: 0,
      target: 4,
      markerId: `${id}-marker`,
      markerPos: target.position.clone(),
      ownedActorIds,
      ownedProps: [fire],
      update: (delta) => {
        event.markerPos.copy(target.position)
        event.description = `Останови налётчиков. Прочность дома: ${Math.ceil(target.hp)}/${target.maxHp}.`
        smokeCooldown -= delta
        if (smokeCooldown <= 0) {
          smokeCooldown = 0.22 + this.eventRng() * 0.18
          this.spawnSmokeParticle(target.position, id)
        }
        fire.children.forEach((child, index) => {
          if (!(child instanceof THREE.Mesh)) return
          const pulse = 1 + Math.sin(this.elapsed * 9 + index * 1.8) * 0.18
          child.scale.setScalar(pulse)
        })
        if (target.hp <= 0) event.state = 'failed'
      },
      onKill: (actor) => {
        if (!ownedActorIds.includes(actor.id)) return
        event.progress = ownedActorIds.reduce((count, actorId) => {
          const ownedActor = this.actors.find((candidate) => candidate.id === actorId)
          return count + (ownedActor && !ownedActor.alive ? 1 : 0)
        }, 0)
        if (event.progress >= event.target && target.hp > 0) event.state = 'succeeded'
      },
    })
    return event
  }

  private startChampionEvent(): WorldEvent | null {
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.champion)) {
      return null
    }

    const id = this.nextEventId('champion')
    const position = this.pickEventPosition()
    const champion = this.spawnActor(
      this.pickEventEnemyFaction(),
      'champion',
      position.x,
      position.z,
      this.actors.length,
      {
        objectiveEligible: false,
        squadEligible: false,
        budget: 'chronicle',
        eventOwnerId: id,
        generatedRegionId: this.generatedRegionIdAt(position.x, position.z),
      },
    )
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'champion',
      state: 'active',
      title: 'Заезжий чемпион',
      description: 'Найди странствующего чемпиона и победи его.',
      tone: 'warning',
      timer: null,
      progress: 0,
      target: 1,
      markerId: `${id}-marker`,
      markerPos: champion.mesh.position.clone(),
      ownedActorIds: [champion.id],
      ownedProps: [],
      update: () => {
        event.markerPos.copy(champion.mesh.position)
        event.progress = champion.alive ? 0 : 1
      },
      onKill: (actor) => {
        if (actor.id !== champion.id) return
        event.progress = 1
        event.state = 'succeeded'
      },
    })
    return event
  }

  private startRescueEvent(): WorldEvent | null {
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.rescue)) return null

    const id = this.nextEventId('rescue')
    const position = this.pickEventPosition()
    const captive = this.spawnActor(
      this.faction,
      'captive',
      position.x,
      position.z,
      this.actors.length,
      {
        objectiveEligible: false,
        squadEligible: false,
        aiMode: 'captive',
        budget: 'chronicle',
        eventOwnerId: id,
        generatedRegionId: this.generatedRegionIdAt(position.x, position.z),
      },
    )
    const enemyFaction = this.pickEventEnemyFaction()
    const guards = [
      this.spawnActor(
        enemyFaction,
        'soldier',
        position.x - 3.6,
        position.z - 2.5,
        this.actors.length,
        {
          objectiveEligible: false,
          squadEligible: false,
          budget: 'chronicle',
          eventOwnerId: id,
          ignoredTargetId: captive.id,
          generatedRegionId: this.generatedRegionIdAt(position.x, position.z),
        },
      ),
      this.spawnActor(
        enemyFaction,
        'soldier',
        position.x + 3.6,
        position.z + 2.5,
        this.actors.length + 1,
        {
          objectiveEligible: false,
          squadEligible: false,
          budget: 'chronicle',
          eventOwnerId: id,
          ignoredTargetId: captive.id,
          generatedRegionId: this.generatedRegionIdAt(position.x, position.z),
        },
      ),
    ]
    const guardIds = guards.map((guard) => guard.id)
    const ownedActorIds = [captive.id, ...guardIds]
    let event: WorldEvent
    const rescueCaptive = (): void => {
      if (!captive.alive || event.state !== 'active') return
      const ownedIndex = ownedActorIds.indexOf(captive.id)
      if (ownedIndex >= 0) ownedActorIds.splice(ownedIndex, 1)
      captive.eventOwnerId = null
      captive.generatedRegionId = null
      captive.aiMode = 'normal'
      captive.squadEligible = true
      // They belong to the player now, not to the event that produced them: without
      // this the freed captive would keep eating a chronicle slot for the whole run.
      captive.budgetCategory = 'squad'
      captive.home.copy(captive.mesh.position)
      captive.wanderTarget.copy(captive.mesh.position)
      const weapon = captive.mesh.getObjectByName('weapon')
      if (weapon) weapon.visible = true
      event.state = 'succeeded'
    }
    event = this.createWorldEvent({
      id,
      kind: 'rescue',
      state: 'active',
      title: 'Пленник у дороги',
      description: 'Победи охрану или лично освободи пленника.',
      tone: 'warning',
      timer: null,
      progress: 0,
      target: 2,
      markerId: `${id}-marker`,
      markerPos: captive.mesh.position.clone(),
      ownedActorIds,
      ownedProps: [],
      update: () => {
        event.markerPos.copy(captive.mesh.position)
      },
      onKill: (actor) => {
        if (event.state !== 'active') return
        if (actor.id === captive.id) {
          event.state = 'failed'
          return
        }
        if (!guardIds.includes(actor.id)) return
        event.progress = guardIds.reduce((count, guardId) => {
          const guard = this.actors.find((candidate) => candidate.id === guardId)
          return count + (guard && !guard.alive ? 1 : 0)
        }, 0)
        if (event.progress >= event.target) rescueCaptive()
      },
      onInteract: () => {
        if (this.player.position.distanceTo(captive.mesh.position) >= 5.5) return false
        rescueCaptive()
        return true
      },
      getPrompt: () =>
        captive.alive && this.player.position.distanceTo(captive.mesh.position) < 5.5
          ? '[E] Освободить пленника'
          : null,
    })
    return event
  }

  private startBountyEvent(): WorldEvent | null {
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.bounty)) return null

    const id = this.nextEventId('bounty')
    const position = this.pickEventPosition()
    const bountyTarget = this.spawnActor(
      this.pickEventEnemyFaction(),
      'soldier',
      position.x,
      position.z,
      this.actors.length,
      {
        objectiveEligible: false,
        squadEligible: false,
        budget: 'chronicle',
        eventOwnerId: id,
        generatedRegionId: this.generatedRegionIdAt(position.x, position.z),
      },
    )

    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'bounty',
      state: 'active',
      title: 'Награда за голову',
      description: 'Победи отмеченную цель за 40 секунд.',
      tone: 'info',
      timer: 40,
      progress: 0,
      target: 1,
      markerId: `${id}-marker`,
      markerPos: bountyTarget.mesh.position.clone(),
      ownedActorIds: [bountyTarget.id],
      ownedProps: [],
      update: () => {
        event.markerPos.copy(bountyTarget.mesh.position)
        event.progress = bountyTarget.alive ? 0 : 1
      },
      onKill: (actor) => {
        if (actor.id !== bountyTarget.id) return
        event.progress = 1
        event.state = 'succeeded'
      },
    })
    return event
  }

  private nextEventId(kind: WorldEventKind): string {
    this.eventSequence += 1
    return `event-${kind}-${this.eventSequence}`
  }

  private pickEventEnemyFaction(): Faction {
    const enemies = (['elf', 'guard', 'villain'] as Faction[]).filter(
      (faction) => faction !== this.faction,
    )
    return enemies[Math.floor(this.eventRng() * enemies.length)]
  }

  private pickEventPosition(): THREE.Vector3 {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const angle = this.eventRng() * TWO_PI
      const radius = 22 + this.eventRng() * 16
      const position = new THREE.Vector3(
        this.player.position.x + Math.sin(angle) * radius,
        0,
        this.player.position.z + Math.cos(angle) * radius,
      )
      this.clampWorldPosition(position, 3)
      if (!this.isWalkablePosition(position.x, position.z, 1)) continue
      position.y = this.groundHeightAt(position.x, position.z)
      return position
    }
    const fallback = this.player.position
      .clone()
      .add(new THREE.Vector3(12, 0, 12))
    this.clampWorldPosition(fallback, 3)
    fallback.y = this.groundHeightAt(fallback.x, fallback.z)
    return fallback
  }

  /**
   * §5.2 — the located variant of `pickEventPosition`. The player-ring version above
   * stays: `champion`, `rescue`, `bounty`, and `richCaravan` are still meant to happen
   * wherever the player is standing. This one puts an event where the world says it
   * belongs — at a site, or failing that, in the middle of its region.
   */
  private pickLocatedEventPosition(
    siteId: string | null,
    regionId: string,
  ): THREE.Vector3 | null {
    const anchor = this.locatedEventAnchor(siteId, regionId)
    if (!anchor) return null
    if (anchor.distanceTo(this.player.position) > LOCATED_EVENT_MAX_DISTANCE) return null
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const angle = this.eventRng() * TWO_PI
      const radius = this.eventRng() * LOCATED_EVENT_SCATTER
      const position = new THREE.Vector3(
        anchor.x + Math.sin(angle) * radius,
        0,
        anchor.z + Math.cos(angle) * radius,
      )
      this.clampWorldPosition(position, 3)
      if (!this.isWalkablePosition(position.x, position.z, 1)) continue
      // Keep the first attempts away from the player so the world visibly acts on its
      // own; if the site really is underfoot, the fight simply comes to them.
      if (
        attempt < 12 &&
        position.distanceTo(this.player.position) < LOCATED_EVENT_MIN_DISTANCE
      ) {
        continue
      }
      position.y = this.groundHeightAt(position.x, position.z)
      return position
    }
    return null
  }

  private locatedEventAnchor(
    siteId: string | null,
    regionId: string,
  ): THREE.Vector3 | null {
    const site = siteId ? this.generatedWorld.getSitePosition(siteId) : undefined
    const anchor = site ?? this.generatedWorld.getRegionCenter(regionId)
    return anchor ? new THREE.Vector3(anchor.x, anchor.y, anchor.z) : null
  }

  private spawnLocatedActor(
    situation: PendingMaterialization,
    eventId: string,
    allegiance: Allegiance,
    role: ActorRole,
    position: THREE.Vector3,
    offsetX: number,
    offsetZ: number,
    extra: Pick<
      ActorSpawnOptions,
      'packId' | 'packKinSize' | 'aiMode' | 'eventPropTargetId'
    > = {},
  ): Actor {
    const spawn = new THREE.Vector3(position.x + offsetX, 0, position.z + offsetZ)
    this.clampWorldPosition(spawn, 3)
    const actor = this.spawnActor(allegiance, role, spawn.x, spawn.z, this.actorSequence++, {
      budget: 'chronicle',
      objectiveEligible: false,
      squadEligible: false,
      eventOwnerId: eventId,
      generatedRegionId: situation.regionId,
      ...extra,
    })
    actor.home.copy(actor.mesh.position)
    actor.wanderTarget.copy(actor.mesh.position)
    return actor
  }

  /** The side holding the ground. A neutral square is defended by the player's own. */
  private locatedDefenderFaction(attacker: Faction, defender: Territory | null): Faction {
    if (defender && defender !== 'neutral' && defender !== attacker) return defender
    if (this.faction !== attacker) return this.faction
    const options = (['elf', 'guard', 'villain'] as Faction[]).filter(
      (faction) => faction !== attacker,
    )
    return options[Math.floor(this.eventRng() * options.length)]
  }

  /**
   * Who turns out to defend a settlement when there is no attacking faction to react to.
   * A beast raid has no attacker, so `locatedDefenderFaction` has nothing to work with.
   */
  private settlementGarrisonFaction(defender: Territory | null): Faction {
    return defender && defender !== 'neutral' ? defender : this.faction
  }

  private startFactionRaidEvent(
    situation: PendingMaterialization,
  ): WorldEvent | null {
    const attacker = situation.faction
    if (!attacker) return null
    const position = this.pickLocatedEventPosition(situation.siteId, situation.regionId)
    if (!position) return null
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.factionRaid)) {
      return null
    }

    const id = this.nextEventId('factionRaid')
    const defenderFaction = this.locatedDefenderFaction(attacker, situation.defender)
    const attackerIds: string[] = []
    const defenderIds: string[] = []
    const attackerOffsets: Array<[number, number, ActorRole]> = [
      [-8.5, -7, 'soldier'],
      [8.5, -6, 'soldier'],
      [0, 9.5, 'brute'],
    ]
    for (const [offsetX, offsetZ, role] of attackerOffsets) {
      const raider = this.spawnLocatedActor(
        situation,
        id,
        attacker,
        role,
        position,
        offsetX,
        offsetZ,
      )
      raider.playerAggro = raider.hostileToPlayer
      attackerIds.push(raider.id)
    }
    for (const [offsetX, offsetZ] of [
      [-2.6, 1.8],
      [2.6, -1.8],
    ] as const) {
      defenderIds.push(
        this.spawnLocatedActor(
          situation,
          id,
          defenderFaction,
          'soldier',
          position,
          offsetX,
          offsetZ,
        ).id,
      )
    }

    const copyContext = this.locatedCopyContext(situation)
    this.locatedEventCopy.set(id, copyContext)
    const copy = describeLocatedEvent('factionRaid', copyContext)
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'factionRaid',
      anchor: 'located',
      regionId: situation.regionId,
      situationId: situation.id,
      state: 'active',
      title: copy.title,
      description: copy.description,
      tone: 'danger',
      timer: LOCATED_EVENT_TIMEOUT,
      progress: 0,
      target: attackerIds.length,
      markerId: `${id}-marker`,
      markerPos: position.clone(),
      ownedActorIds: [...attackerIds, ...defenderIds],
      ownedProps: [],
      update: () => {
        const attackersAlive = this.countAliveActors(attackerIds)
        event.progress = attackerIds.length - attackersAlive
        if (attackersAlive === 0) {
          event.state = 'succeeded'
          return
        }
        if (this.countAliveActors(defenderIds) === 0) event.state = 'failed'
      },
      handBack: () =>
        this.handBackRaid(
          situation,
          attacker,
          this.countAliveActors(attackerIds) / Math.max(1, attackerIds.length),
          this.countAliveActors(defenderIds) / Math.max(1, defenderIds.length),
        ),
    })
    return event
  }

  private handBackRaid(
    situation: PendingMaterialization,
    attacker: Faction,
    attackerStrength: number,
    defenderStrength: number,
  ): ChronicleEvent[] {
    const resolution = resolveMaterializedRaid({
      state: this.chronicleState,
      regions: this.chronicleRegions,
      rng: this.generatedRngStreams.event,
      protectedRegionIds: this.chronicleProtectedRegionIds,
      idPrefix: `handback-${situation.id}-${this.chronicleState.tick}-${this.eventSequence}`,
      outcome: {
        regionId: situation.regionId,
        sourceRegionId: situation.sourceRegionId,
        siteId: situation.siteId,
        attacker,
        attackerStrength,
        defenderStrength,
      },
    })
    return resolution.events
  }

  private startCaravanAmbushEvent(
    situation: PendingMaterialization,
  ): WorldEvent | null {
    const owner = situation.faction
    if (!owner || !situation.caravanId) return null
    const position = this.pickLocatedEventPosition(null, situation.regionId)
    if (!position) return null
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.caravanAmbush)) {
      return null
    }

    const id = this.nextEventId('caravanAmbush')
    const raiderFaction = this.locatedDefenderFaction(owner, situation.defender)
    const cart = this.createCaravan(false)
    cart.position.copy(position)
    cart.position.y = this.groundHeightAt(cart.position.x, cart.position.z)
    this.scene.add(cart)
    this.registerNamedInteractableOutline(cart, 'cargo')

    const escortIds: string[] = []
    const raiderIds: string[] = []
    for (const [offsetX, offsetZ] of [
      [-3.4, 2.2],
      [3.4, -2.2],
    ] as const) {
      escortIds.push(
        this.spawnLocatedActor(situation, id, owner, 'soldier', position, offsetX, offsetZ)
          .id,
      )
    }
    for (const [offsetX, offsetZ] of [
      [-7.5, -6.5],
      [7.5, 6.5],
    ] as const) {
      const raider = this.spawnLocatedActor(
        situation,
        id,
        raiderFaction,
        'soldier',
        position,
        offsetX,
        offsetZ,
      )
      raider.playerAggro = raider.hostileToPlayer
      raiderIds.push(raider.id)
    }

    const copyContext = this.locatedCopyContext(situation)
    this.locatedEventCopy.set(id, copyContext)
    const copy = describeLocatedEvent('caravanAmbush', copyContext)
    let robbed = false
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'caravanAmbush',
      anchor: 'located',
      regionId: situation.regionId,
      situationId: situation.id,
      state: 'active',
      title: copy.title,
      description: copy.description,
      tone: 'warning',
      timer: LOCATED_EVENT_TIMEOUT,
      progress: 0,
      target: 1,
      markerId: `${id}-marker`,
      markerPos: cart.position.clone(),
      ownedActorIds: [...escortIds, ...raiderIds],
      ownedProps: [cart],
      update: () => {
        event.markerPos.copy(cart.position)
        // A caravan whose escort is gone is a caravan somebody else is taking.
        if (
          !robbed &&
          this.countAliveActors(escortIds) === 0 &&
          this.countAliveActors(raiderIds) > 0
        ) {
          event.state = 'failed'
        }
      },
      onInteract: () => {
        if (robbed) return false
        if (this.player.position.distanceTo(cart.position) >= 7) return false
        robbed = true
        event.progress = 1
        const cargo = cart.getObjectByName('cargo')
        if (cargo instanceof THREE.Mesh) cargo.scale.y = 0.38
        this.playSound('coin')
        event.state = 'succeeded'
        return true
      },
      getPrompt: () =>
        !robbed && this.player.position.distanceTo(cart.position) < 7
          ? '[E] Забрать груз корована'
          : null,
      handBack: () =>
        resolveMaterializedCaravan({
          state: this.chronicleState,
          regions: this.chronicleRegions,
          idPrefix: `handback-${situation.id}-${this.chronicleState.tick}-${this.eventSequence}`,
          outcome: {
            caravanId: situation.caravanId ?? '',
            regionId: situation.regionId,
            intact: !robbed && this.countAliveActors(escortIds) > 0,
          },
        }),
    })
    return event
  }

  private startWarbandEvent(situation: PendingMaterialization): WorldEvent | null {
    const faction = situation.faction
    if (!faction) return null
    const position = this.pickLocatedEventPosition(situation.siteId, situation.regionId)
    if (!position) return null
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.warband)) return null

    const id = this.nextEventId('warband')
    const memberIds: string[] = []
    const offsets: Array<[number, number, ActorRole]> = [
      [-3.2, -2.4, 'soldier'],
      [3.2, -1.6, 'archer'],
      [0, 3.4, 'brute'],
    ]
    for (const [offsetX, offsetZ, role] of offsets) {
      const member = this.spawnLocatedActor(
        situation,
        id,
        faction,
        role,
        position,
        offsetX,
        offsetZ,
      )
      member.playerAggro = member.hostileToPlayer
      memberIds.push(member.id)
    }

    const copyContext = this.locatedCopyContext(situation)
    this.locatedEventCopy.set(id, copyContext)
    const copy = describeLocatedEvent('warband', copyContext)
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'warband',
      anchor: 'located',
      regionId: situation.regionId,
      situationId: situation.id,
      state: 'active',
      title: copy.title,
      description: copy.description,
      tone: 'warning',
      timer: LOCATED_EVENT_TIMEOUT,
      progress: 0,
      target: memberIds.length,
      markerId: `${id}-marker`,
      markerPos: position.clone(),
      ownedActorIds: memberIds,
      ownedProps: [],
      update: () => {
        const alive = this.countAliveActors(memberIds)
        event.progress = memberIds.length - alive
        if (alive === 0) event.state = 'succeeded'
      },
      handBack: () => {
        resolveMaterializedWarband({
          regions: this.chronicleRegions,
          outcome: {
            regionId: situation.regionId,
            faction,
            survivorShare:
              this.countAliveActors(memberIds) / Math.max(1, memberIds.length),
          },
        })
        return []
      },
    })
    return event
  }

  /**
   * Layer 3 — `beastRaid`, the situation Layer 2 deliberately refused to fake. The pack
   * comes for the settlement itself: the wrecker is pointed at a prop, the escorts at
   * whoever is standing in front of it. Nobody's territory changes hands, because beasts
   * do not hold ground.
   */
  private startBeastRaidEvent(
    situation: PendingMaterialization,
  ): WorldEvent | null {
    const position = this.pickLocatedEventPosition(situation.siteId, situation.regionId)
    if (!position) return null
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.beastRaid)) return null

    const region = this.generatedBlueprint.regions.find(
      (candidate) => String(candidate.id) === situation.regionId,
    )
    const pack = planBeastPack({
      beastPressure: situation.beastPressure,
      biome: region?.biome ?? 'forest',
      rng: this.generatedRngStreams.event,
      maxCount: EVENT_REQUIRED_SLOTS.beastRaid - BEAST_RAID_DEFENDERS,
    })
    if (pack.roles.length === 0) return null

    const id = this.nextEventId('beastRaid')
    const lair = this.createBeastLairEffect(position)
    this.scene.add(lair)
    const prop: EventPropTarget = {
      id: `${id}-homestead`,
      ownerId: id,
      object: lair,
      hp: 100,
      maxHp: 100,
      position: position.clone(),
      attackRange: 5,
    }
    this.eventPropTargets.set(prop.id, prop)

    const packId = `${id}-pack`
    const beastIds: string[] = []
    // Morale is measured against a beast's own kind, so each one needs to know how many
    // of its kind set out — not how big the pack was. A lone wolf escorting a bear has
    // nobody to lose its nerve over.
    const kinSize = new Map<BeastRole, number>()
    for (const role of pack.roles) kinSize.set(role, (kinSize.get(role) ?? 0) + 1)
    pack.roles.forEach((role, index) => {
      const angle = (index / pack.roles.length) * TWO_PI + 0.4
      const radius = 11 + index * 1.6
      const beast = this.spawnLocatedActor(
        situation,
        id,
        'beast',
        role,
        position,
        Math.sin(angle) * radius,
        Math.cos(angle) * radius,
        {
          packId,
          packKinSize: kinSize.get(role) ?? 1,
          // Only the wrecker is here for the buildings; the rest hunt whatever moves.
          // A pure wolf pack has no wrecker, so every one of them hunts.
          aiMode: index === 0 && role !== 'wolf' ? 'attackEventProp' : 'normal',
          eventPropTargetId: index === 0 && role !== 'wolf' ? prop.id : null,
        },
      )
      beast.playerAggro = beast.hostileToPlayer && !(index === 0 && role !== 'wolf')
      beastIds.push(beast.id)
    })

    // The garrison: whoever holds the square, or the player's own side on neutral ground.
    const defenderFaction = this.settlementGarrisonFaction(situation.defender)
    const defenderIds: string[] = []
    for (const [offsetX, offsetZ] of [
      [-2.8, 1.9],
      [2.8, -1.9],
    ] as const) {
      defenderIds.push(
        this.spawnLocatedActor(
          situation,
          id,
          defenderFaction,
          'soldier',
          position,
          offsetX,
          offsetZ,
        ).id,
      )
    }

    const copyContext = this.locatedCopyContext(situation)
    this.locatedEventCopy.set(id, copyContext)
    const copy = describeLocatedEvent('beastRaid', copyContext)
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'beastRaid',
      anchor: 'located',
      regionId: situation.regionId,
      situationId: situation.id,
      state: 'active',
      title: copy.title,
      description: copy.description,
      tone: 'danger',
      timer: LOCATED_EVENT_TIMEOUT,
      progress: 0,
      target: beastIds.length,
      markerId: `${id}-marker`,
      markerPos: position.clone(),
      ownedActorIds: [...beastIds, ...defenderIds],
      ownedProps: [lair],
      update: () => {
        const beastsAlive = this.countAliveActors(beastIds)
        event.progress = beastIds.length - beastsAlive
        event.description = `${copy.description} Прочность домиков: ${Math.ceil(prop.hp)}/${prop.maxHp}.`
        if (beastsAlive === 0) {
          event.state = 'succeeded'
          return
        }
        if (prop.hp <= 0) event.state = 'failed'
      },
      handBack: () => {
        // The stake of a beast raid is the settlement, not the garrison's lives. Once
        // the homestead is down the defenders have lost however many of them are still
        // upright, so the hand-back must not re-roll a fight the player just watched
        // end — unlike `factionRaid`, whose failure condition already implies a wiped
        // defence, this one can fail with soldiers standing.
        const settlementLost = prop.hp <= 0
        return this.handBackBeastRaid(
          situation,
          this.countAliveActors(beastIds) / Math.max(1, beastIds.length),
          settlementLost
            ? 0
            : this.countAliveActors(defenderIds) / Math.max(1, defenderIds.length),
        )
      },
    })
    return event
  }

  private handBackBeastRaid(
    situation: PendingMaterialization,
    beastStrength: number,
    defenderStrength: number,
  ): ChronicleEvent[] {
    return resolveMaterializedBeastRaid({
      state: this.chronicleState,
      regions: this.chronicleRegions,
      rng: this.generatedRngStreams.event,
      idPrefix: `handback-${situation.id}-${this.chronicleState.tick}-${this.eventSequence}`,
      outcome: {
        regionId: situation.regionId,
        siteId: situation.siteId,
        beastStrength,
        defenderStrength,
      },
    }).events
  }

  /** Torn fencing and a churned-up yard: what a pack leaves before it gets inside. */
  private createBeastLairEffect(position: THREE.Vector3): THREE.Group {
    const group = new THREE.Group()
    const timber = this.artLibrary.createMaterial({
      color: mix(this.palette.warning, this.palette.bg, 0.55),
      surface: 'cloth',
    })
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * TWO_PI
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.9, 0.24), timber)
      plank.position.set(Math.sin(angle) * 3.1, 0.95, Math.cos(angle) * 3.1)
      plank.rotation.z = Math.sin(angle * 2.3) * 0.42
      plank.castShadow = true
      group.add(plank)
    }
    const trough = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 1.5), timber)
    trough.position.y = 0.35
    trough.castShadow = true
    group.add(trough)
    group.position.copy(position)
    return group
  }

  private startAftermathEvent(    situation: PendingMaterialization,
  ): WorldEvent | null {
    const position = this.pickLocatedEventPosition(situation.siteId, situation.regionId)
    if (!position) return null
    if (!this.reserveActorSlots('chronicle', EVENT_REQUIRED_SLOTS.aftermath)) return null

    const id = this.nextEventId('aftermath')
    const looterFaction =
      situation.faction ?? this.locatedDefenderFaction(this.faction, null)
    this.spawnDecal(position, 'scorch', 5.4)
    const looterIds: string[] = []
    for (const [offsetX, offsetZ] of [
      [-2.2, 1.4],
      [2.2, -1.4],
    ] as const) {
      const looter = this.spawnLocatedActor(
        situation,
        id,
        looterFaction,
        'minion',
        position,
        offsetX,
        offsetZ,
      )
      looter.playerAggro = looter.hostileToPlayer
      looterIds.push(looter.id)
    }

    const copyContext = this.locatedCopyContext(situation)
    this.locatedEventCopy.set(id, copyContext)
    const copy = describeLocatedEvent('aftermath', copyContext)
    let smokeCooldown = 0
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'aftermath',
      anchor: 'located',
      regionId: situation.regionId,
      situationId: situation.id,
      state: 'active',
      title: copy.title,
      description: copy.description,
      tone: 'info',
      timer: LOCATED_EVENT_TIMEOUT,
      progress: 0,
      target: looterIds.length,
      markerId: `${id}-marker`,
      markerPos: position.clone(),
      ownedActorIds: looterIds,
      ownedProps: [],
      update: (delta) => {
        smokeCooldown -= delta
        if (smokeCooldown <= 0) {
          smokeCooldown = 0.7 + this.eventRng() * 0.6
          this.spawnSmokeParticle(position, id)
        }
        const alive = this.countAliveActors(looterIds)
        event.progress = looterIds.length - alive
        if (alive === 0) event.state = 'succeeded'
      },
    })
    return event
  }

  private createHouseFireEffect(position: THREE.Vector3): THREE.Group {
    const group = new THREE.Group()
    const offsets: Array<[number, number, number]> = [
      [-1.8, 4.8, -0.8],
      [0.3, 5.7, 0.9],
      [1.7, 4.5, -0.2],
    ]
    offsets.forEach(([x, y, z], index) => {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.45 + index * 0.08, 1.7 + index * 0.25, 7),
        new THREE.MeshStandardMaterial({
          color: index === 1 ? this.palette.danger : this.palette.warning,
          emissive: this.palette.warning,
          emissiveIntensity: 1.5,
          transparent: true,
          opacity: 0.88,
        }),
      )
      flame.position.set(x, y, z)
      group.add(flame)
    })
    const light = new THREE.PointLight(this.palette.warning, 3.2, 16, 2)
    light.position.y = 5
    group.add(light)
    group.position.copy(position)
    return group
  }

  private spawnSmokeParticle(position: THREE.Vector3, eventId: string): void {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.48 + this.eventRng() * 0.28, 0),
      new THREE.MeshBasicMaterial({
        color: mix(this.palette.borderStrong, this.palette.bg, 0.42),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    )
    mesh.position
      .copy(position)
      .add(
        new THREE.Vector3(
          (this.eventRng() - 0.5) * 3.8,
          5 + this.eventRng() * 1.5,
          (this.eventRng() - 0.5) * 2.8,
        ),
      )
    mesh.scale.setScalar(0.55)
    this.scene.add(mesh)
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3(
        (this.eventRng() - 0.5) * 0.5,
        0.75 + this.eventRng() * 0.45,
        (this.eventRng() - 0.5) * 0.5,
      ),
      life: 1.8 + this.eventRng() * 0.8,
      eventId,
      mode: 'smoke',
    })
  }

  private removeEventParticles(eventId: string): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      if (this.particles[index].eventId === eventId) this.removeParticle(index)
    }
  }

  private removeActorById(actorId: string): void {
    const index = this.actors.findIndex((actor) => actor.id === actorId)
    if (index < 0) return
    this.releaseActorTelegraph(actorId)
    for (let projectileIndex = this.projectiles.length - 1; projectileIndex >= 0; projectileIndex -= 1) {
      if (this.projectiles[projectileIndex].sourceActorId === actorId) {
        this.removeProjectile(projectileIndex)
      }
    }
    this.projectileSourcesToClear.delete(actorId)
    for (const other of this.actors) {
      if (other.targetId === actorId) other.targetId = null
    }
    const [actor] = this.actors.splice(index, 1)
    this.removeAndDisposeObject(actor.healthBar)
    actor.healthBarTexture.dispose()
    this.removeAndDisposeObject(actor.mesh)
  }

  private removeAndDisposeObject(object: THREE.Object3D): void {
    this.unregisterOutlineRoot(object)
    object.removeFromParent()
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Sprite)) return
      // Shells are already detached by the release above, so anything instanced
      // still here owns its matrix buffer and its vertex array object outright.
      // `dispose()` is the only call that returns either, and it leaves the shared
      // geometry and material alone for the two sweeps below to judge.
      if (child instanceof THREE.InstancedMesh) child.dispose()
      if (child instanceof THREE.Mesh) geometries.add(child.geometry)
      const material = child.material
      if (Array.isArray(material)) material.forEach((entry) => materials.add(entry))
      else materials.add(material)
    })
    geometries.forEach((geometry) => {
      if (!StylizedArtLibrary.isLibraryOwned(geometry)) geometry.dispose()
    })
    materials.forEach((material) => {
      if (!StylizedArtLibrary.isLibraryOwned(material)) material.dispose()
    })
  }

  private actorAttackPlayer(actor: Actor): void {
    const baseDamage = isBeastRole(actor.role)
      ? BEAST_PROFILES[actor.role].meleeDamage
      : actor.role === 'commander'
        ? 10
        : actor.role === 'champion'
          ? 17
          : actor.role === 'brute'
            ? 14
            : 6 + this.combatRng() * 3
    const incomingDirection = actor.mesh.position.clone().sub(this.player.position)
    incomingDirection.y = 0
    this.damagePlayer(
      this.actorDamageWithAura(actor, baseDamage) * this.enemyDamageMultiplier(actor),
      incomingDirection,
      true,
      { attackKind: 'allyMelee' },
    )
  }

  private actorAttackActor(attacker: Actor, target: Actor): void {
    const baseDamage = isBeastRole(attacker.role)
      ? BEAST_PROFILES[attacker.role].meleeDamage
      : attacker.role === 'commander'
        ? 18
        : attacker.role === 'champion'
          ? 17
          : attacker.role === 'brute'
            ? 14
            : 13
    this.damageActor(
      target,
      this.actorDamageWithAura(attacker, baseDamage),
      attacker.mesh.position,
      attacker.allegiance,
      false,
      { attackKind: 'allyMelee', sourceActorId: attacker.id },
    )
  }

  private actorAttackEventProp(actor: Actor, target: EventPropTarget): void {
    // A troll is a prop-wrecker: it is on the settlement to take it apart, and it does
    // that roughly twice as fast as a raider with a torch.
    const bite = actor.role === 'troll' ? 9 + this.eventRng() * 4 : 4 + this.eventRng() * 2
    target.hp = Math.max(0, target.hp - bite)
    this.createHitParticles(target.position, actor.allegiance)
    if (target.position.distanceTo(this.player.position) < 25) {
      this.playSound('hitLight', {
        position: target.position,
        intensity: 0.35,
        variantSeed: this.eventSequence,
      })
    }
  }

  private damagePlayer(
    baseDamage: number,
    incomingDirection: THREE.Vector3,
    canInjure: boolean,
    options: DamagePlayerOptions,
  ): DamageResult {
    const fallbackDirection = new THREE.Vector3(0, 0, 1)
    if (this.health <= 0) {
      return {
        applied: false,
        dealt: 0,
        killed: false,
        weight: 'normal',
        position: this.player.position.clone().add(new THREE.Vector3(0, 1.3, 0)),
        direction: fallbackDirection,
      }
    }
    const armor = this.faction === 'guard' ? 0.72 : 1
    const normalizedIncoming = incomingDirection.clone()
    normalizedIncoming.y = 0
    const hasIncomingDirection = normalizedIncoming.lengthSq() > 0.0001
    if (hasIncomingDirection) normalizedIncoming.normalize()
    const frontalBlock =
      this.shieldActive &&
      hasIncomingDirection &&
      normalizedIncoming.dot(this.getAimDirection()) > SHIELD_FRONT_DOT
    const dealt =
      baseDamage * armor * (frontalBlock ? SHIELD_DAMAGE_MULTIPLIER : 1)
    const impact = THREE.MathUtils.clamp(dealt / 20, 0, 1)
    this.health = Math.max(0, this.health - dealt)
    this.achievements.recordPlayerDamage(dealt, frontalBlock)
    const contact = this.player.position.clone().add(new THREE.Vector3(0, 1.3, 0))
    if (frontalBlock) {
      this.addTrauma(TRAUMA_BLOCK)
      this.damageFlash = Math.max(
        this.damageFlash,
        Math.min(FLASH_BLOCK_MAX, dealt / 20),
      )
      contact.y += 0.05
      contact.addScaledVector(normalizedIncoming, 0.72)
      this.createSparks(contact, normalizedIncoming, SPARK_COUNT_BLOCK)
    } else {
      this.addTrauma(THREE.MathUtils.lerp(0.12, 0.35, impact))
      this.damageFlash = Math.max(
        this.damageFlash,
        THREE.MathUtils.lerp(FLASH_MIN, FLASH_MAX, impact),
      )
      const sprayDirection = hasIncomingDirection
        ? normalizedIncoming.clone().multiplyScalar(-1)
        : new THREE.Vector3(0, 0, 1)
      this.createBloodBurst(
        this.player.position.clone().add(new THREE.Vector3(0, 1.3, 0)),
        sprayDirection,
        Math.round(THREE.MathUtils.lerp(GORE_PLAYER_HIT_MIN, GORE_PLAYER_HIT_MAX, impact)),
        THREE.MathUtils.lerp(0.9, 2.25, impact),
      )
    }
    this.createHitParticles(this.player.position, this.faction)
    if (
      canInjure &&
      !frontalBlock &&
      this.combatRng() < 0.11 &&
      this.health < 82
    ) {
      this.injurePlayer()
    }
    const killed = this.health <= 0
    const weight: HitWeight = frontalBlock
      ? 'blocked'
      : killed
        ? 'lethal'
        : dealt >= 22
          ? 'heavy'
          : 'normal'
    const result: DamageResult = {
      applied: true,
      dealt,
      killed,
      weight,
      position: contact,
      direction: hasIncomingDirection
        ? normalizedIncoming.clone().multiplyScalar(-1)
        : fallbackDirection,
    }
    this.presentCombatFeedback({
      ...result,
      attackKind: options.attackKind,
      targetId: 'player',
      directPlayerAction: false,
    })
    this.emitView(true)
    return result
  }

  private damageActor(
    target: Actor,
    baseDamage: number,
    sourcePosition: THREE.Vector3,
    killerAllegiance: Allegiance,
    directPlayerKill: boolean,
    options: DamageActorOptions,
  ): DamageResult {
    const position = target.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0))
    const direction = target.mesh.position.clone().sub(sourcePosition)
    direction.y = 0
    if (direction.lengthSq() > 0.0001) direction.normalize()
    else direction.set(0, 0, 1)
    if (!target.alive) {
      return {
        applied: false,
        dealt: 0,
        killed: false,
        weight: 'normal',
        position,
        direction,
      }
    }
    if (
      directPlayerKill &&
      target.aiMode !== 'captive' &&
      target.hostileToPlayer
    ) {
      target.playerAggro = true
      target.aggroMemory = AGGRO_MEMORY_DURATION
      target.rageTimer = RAGE_DURATION
      if (target.lastKnownTargetPos) target.lastKnownTargetPos.copy(this.player.position)
      else target.lastKnownTargetPos = this.player.position.clone()
      this.alertNearbyAllies(target, this.player.position)
    } else if (options.sourceActorId && target.aiMode !== 'captive') {
      const sourceActor = this.actors.find((actor) => actor.id === options.sourceActorId)
      if (
        sourceActor?.alive &&
        sourceActor !== target &&
        // §5D — a bystander does not swing back. `isPacifistRole` is the same gate
        // `selectThreat` uses, so "who starts a fight" has one answer rather than two
        // that can drift: without it a villager bitten by a wolf turns round and
        // charges it, which is the opposite of the behaviour this layer is for.
        !isPacifistRole(target.role) &&
        hostile(target.allegiance, sourceActor.allegiance)
      ) {
        target.targetId = sourceActor.id
        target.retaliationTimer = NPC_RETALIATION_DURATION
      }
    }
    let dealt = Math.max(0, baseDamage)
    if (target.role === 'brute') {
      const facing = new THREE.Vector3(
        Math.sin(target.mesh.rotation.y),
        0,
        Math.cos(target.mesh.rotation.y),
      )
      const toSource = sourcePosition.clone().sub(target.mesh.position)
      toSource.y = 0
      if (
        toSource.lengthSq() > 0.0001 &&
        facing.dot(toSource.normalize()) > BRUTE_FRONT_DOT
      ) {
        dealt *= BRUTE_FRONTAL_DAMAGE_MULTIPLIER
      }
    }

    const impact = THREE.MathUtils.clamp(dealt / 36, 0, 1)
    this.createBloodBurst(
      position,
      direction,
      Math.round(THREE.MathUtils.lerp(GORE_HIT_MIN, GORE_HIT_MAX, impact)),
      THREE.MathUtils.lerp(0.85, 2.35, impact),
    )
    target.hp = Math.max(0, target.hp - dealt)
    target.healthBarVisibleUntil = this.elapsed + 3.4
    this.drawActorHealthBar(target)
    this.createHitParticles(target.mesh.position, target.allegiance)
    if (
      target.role !== 'brute' &&
      options.detachChance &&
      Math.random() < options.detachChance
    ) {
      this.detachActorLimb(target)
    }
    const killed = target.hp <= 0
    const weight: HitWeight = killed
      ? 'lethal'
      : options.attackKind === 'cleave' || dealt >= target.maxHp * 0.22
        ? 'heavy'
        : 'normal'
    const result: DamageResult = {
      applied: true,
      dealt,
      killed,
      weight,
      position,
      direction,
    }
    this.applyActorDamageReaction(
      target,
      result,
      options.attackKind,
      options.knockback ?? 0,
    )
    if (killed) {
      this.killActor(
        target,
        killerAllegiance,
        directPlayerKill,
        result,
        options.attackKind,
        options.knockback ?? 0,
      )
    }
    if (directPlayerKill && !options.deferFeedback) {
      this.presentCombatFeedback({
        ...result,
        attackKind: options.attackKind,
        targetId: target.id,
        directPlayerAction: true,
      })
    }
    return result
  }

  private alertNearbyAllies(source: Actor, targetPosition: THREE.Vector3): void {
    if (source.alertCooldown > 0) return
    source.alertCooldown = ALERT_COOLDOWN
    const alertRadiusSq = ALERT_RADIUS * ALERT_RADIUS

    for (const actor of this.actors) {
      if (
        actor === source ||
        !actor.alive ||
        actor.aiMode !== 'normal' ||
        allegianceRelation(actor.allegiance, source.allegiance) !== 'friendly' ||
        !actor.hostileToPlayer ||
        actor.mesh.position.distanceToSquared(source.mesh.position) > alertRadiusSq
      ) {
        continue
      }

      actor.playerAggro = true
      actor.aggroMemory = Math.max(actor.aggroMemory, AGGRO_MEMORY_DURATION)
      if (actor.lastKnownTargetPos) actor.lastKnownTargetPos.copy(targetPosition)
      else actor.lastKnownTargetPos = targetPosition.clone()
    }
  }

  /**
   * §5C.3 — alert propagation for a sighting of *anything*, not just the player.
   *
   * `alertCooldown` and `alertNearbyAllies` above have been on `Actor` since long before
   * this layer, and only ever carried "the player just hit me" — which is why a wolf
   * walking into a garrison woke exactly the soldier it walked into. This shares any
   * first sighting with the allies in earshot, and `ActorAi.acceptsAlert` decides who
   * takes it: notably **not** an ally already holding a target of its own, or one shout
   * re-aims a whole square onto one wolf.
   *
   * The alert hands over the sighted position rather than the target id, because the
   * recipient re-runs its own threat scoring when it gets there; being told where to look
   * is realistic, being told what to attack is not.
   */
  private announceSighting(
    source: Actor,
    hostileId: string | null,
    position: THREE.Vector3,
  ): void {
    if (source.alertCooldown > 0 || source.aiMode !== 'normal') return
    source.alertCooldown = ALERT_COOLDOWN
    const alert: AiAlert = {
      sourceId: source.id,
      allegiance: source.allegiance,
      origin: source.mesh.position,
      target: position,
      hostileId,
    }
    for (const actor of this.actors) {
      if (actor.aiMode !== 'normal' || actor.routTimer > 0) continue
      if (!acceptsAlert(actor, alert, ALERT_SIGHTING_RADIUS, actorPosition)) continue
      // Its own field, on purpose: `lastKnownTargetPos` belongs to player pursuit and is
      // cleared every frame an actor is not chasing the player, which is precisely the
      // state a bystander being shouted at is in.
      if (actor.alertPos) actor.alertPos.copy(position)
      else actor.alertPos = position.clone()
      actor.alertTimer = ALERT_INVESTIGATE_SECONDS
      if (hostileId === null && actor.hostileToPlayer) {
        actor.playerAggro = true
        actor.aggroMemory = Math.max(actor.aggroMemory, AGGRO_MEMORY_DURATION)
        if (actor.lastKnownTargetPos) actor.lastKnownTargetPos.copy(position)
        else actor.lastKnownTargetPos = position.clone()
      }
      // An idling ally stops idling: being told there is something out there is the
      // whole point of the shout.
      actor.idleTimer = 0
      actor.wanderTimer = 0
    }
  }

  /**
   * §5C.5 — how far off the direct line this attacker comes in, in radians.
   *
   * The rank and the angle are decisions and live in `ActorAi`; the blend is geometry
   * and lives here. **This is the one Layer 4 mechanic the headless harness cannot
   * measure** — it has no steering, no collision and no separation, so it can tell you
   * which slot an attacker claimed but nothing about whether the approach reads well.
   */
  private flankApproachOffset(
    actor: Actor,
    target: Actor | null,
    targetsPlayer: boolean,
    distance: number,
    stopDistance: number,
  ): number {
    if (actor.role === 'archer' || actor.retreatTimer > 0) return 0
    // An event prop is neither: nothing queues on a barricade, and falling through to
    // the player's queue ranked a raider against allies fighting something else entirely.
    const rank = target
      ? engagementRank(actor, target.id, this.actors)
      : targetsPlayer
        ? playerEngagementRank(actor, this.actors)
        : 0
    if (rank <= 0) return 0
    return flankApproachAngle(rank) * flankBlend(distance, stopDistance)
  }

  /**
   * §5C.4 — walk back to the post the commander put this actor on. Returns the distance
   * still to cover, or `0` when it has nowhere to be, so the caller can both cap the
   * step and fall through to wandering.
   */
  private moveToOrderPost(
    actor: Actor,
    direction: THREE.Vector3,
    colliderRadius: number,
  ): number {
    const order = actor.order
    if (!order) return 0
    const toPost = order.position.clone().sub(actor.mesh.position)
    toPost.y = 0
    if (toPost.length() <= COMMANDER_ORDER_TOLERANCE) return 0
    const navigationTarget = this.getNavigationWaypoint(
      actor.mesh.position,
      order.position,
      colliderRadius,
    )
    if (navigationTarget) {
      toPost.copy(navigationTarget).sub(actor.mesh.position)
      toPost.y = 0
    }
    const distance = toPost.length()
    if (distance < 0.005) return 0
    direction.copy(toPost).multiplyScalar(1 / distance)
    return distance
  }

  private dropShield(): void {
    if (!this.shieldActive) return
    this.shieldActive = false
    this.abilityCooldown = Math.max(
      this.abilityCooldown,
      ABILITY_INFO.guard.cooldownMax,
    )
    this.updateShieldPose()
  }

  private updateShieldPose(): void {
    const shield = this.player.getObjectByName('shield')
    if (!shield) return
    shield.position.set(
      this.shieldActive ? 0 : -0.82,
      this.shieldActive ? 1.78 : 1.85,
      this.shieldActive ? 0.58 : 0.08,
    )
    shield.rotation.set(this.shieldActive ? -0.08 : 0, 0, this.shieldActive ? 0 : 0.12)
  }

  private killActor(
    actor: Actor,
    killerAllegiance: Allegiance,
    directPlayerKill: boolean,
    result: DamageResult,
    attackKind: AttackKind,
    requestedKnockback: number,
  ): void {
    if (!actor.alive) return
    const deathPosition = actor.mesh.position.clone()
    const largeBody =
      actor.role === 'brute' || actor.role === 'champion' || actor.role === 'commander'
    const deathDirection = result.direction.clone()
    this.createBloodBurst(
      deathPosition.clone().add(new THREE.Vector3(0, 1.25, 0)),
      deathDirection,
      largeBody ? GORE_LARGE_DEATH_COUNT : GORE_DEATH_COUNT,
      largeBody ? 3.15 : 2.65,
      largeBody ? 10 : 6,
    )
    this.spawnDecal(deathPosition, 'blood', largeBody ? 2.8 : 2.1)
    const satelliteSplats = largeBody ? 8 : 5
    for (let index = 0; index < satelliteSplats; index += 1) {
      const angle = Math.random() * TWO_PI
      const distance = 0.7 + Math.random() * (largeBody ? 3.6 : 2.8)
      this.spawnDecal(
        deathPosition
          .clone()
          .add(new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance)),
        'blood',
        0.38 + Math.random() * (largeBody ? 0.95 : 0.72),
      )
    }
    for (let index = 0; index < (largeBody ? 3 : 2); index += 1) {
      this.detachActorLimb(actor)
    }
    if (directPlayerKill) {
      const distance = deathPosition.distanceTo(this.player.position)
      if (distance < TRAUMA_DEATH_RANGE) {
        this.addTrauma(TRAUMA_DEATH_MAX * (1 - distance / TRAUMA_DEATH_RANGE))
      }
    }
    actor.alive = false
    actor.action = null
    actor.reaction = 'none'
    actor.reactionRemaining = 0
    actor.poiseRecoveryDelay = 0
    actor.staggerImmunity = 0
    actor.attackCooldown = 0
    actor.retreatTimer = 0
    actor.velocity.set(0, 0, 0)
    actor.knockbackVelocity.set(0, 0, 0)
    this.releaseActorTelegraph(actor.id)
    const forward = new THREE.Vector3(
      Math.sin(actor.mesh.rotation.y),
      0,
      Math.cos(actor.mesh.rotation.y),
    )
    const right = new THREE.Vector3(forward.z, 0, -forward.x)
    const lateralStrength = Math.abs(right.dot(actor.lastHitDirection))
    const sourceInFront = forward.dot(actor.lastHitDirection.clone().negate()) > 0.2
    actor.deathStyle =
      attackKind === 'cleave' || requestedKnockback >= HIGH_KNOCKBACK_THRESHOLD
        ? 'launchFall'
        : lateralStrength > 0.68
          ? 'spinFall'
          : sourceInFront
            ? 'backFall'
            : 'sideFall'
    actor.deathAge = 0
    actor.deathStartPosition.copy(actor.mesh.position)
    actor.deathStartRotation.copy(actor.mesh.rotation)
    actor.deathTravelled = 0
    actor.outlineUntil = this.elapsed + OUTLINE_CORPSE_SECONDS
    actor.deathAt = this.elapsed
    actor.healthBar.visible = false
    const ring = actor.mesh.getObjectByName('faction-ring')
    if (ring) ring.visible = false
    this.projectileSourcesToClear.add(actor.id)
    this.recordGeneratedActorDeath(actor)
    // §5C.2 — losing the commander is a morale event for everyone who watched it, and
    // it must land before any of them takes their next check.
    if (actor.role === 'commander') this.applyCommanderLossShock(actor)
    if (!directPlayerKill) {
      this.playSound('down', {
        position: deathPosition,
        intensity: largeBody ? 1 : 0.65,
        variantSeed: this.stableSeed(`${actor.id}:down`),
      })
    }

    for (const event of this.activeEvents) {
      event.onKill?.(actor, { killerAllegiance, directPlayerKill })
    }
    // §5D — a villager going down is worth a line whoever did it, and worth nothing
    // else: no gold, no loot, no kill on the counter, and `recordKill` is never reached
    // so it cannot be tallied against one of the three sides. The line is the reward.
    if (actor.allegiance === 'civilian') {
      if (directPlayerKill) {
        this.callbacks.onNotice(describeCivilianDeath(true), 'warning')
        this.emitView(true)
      } else {
        this.announceMoraleEvent(actor, describeCivilianDeath(false))
      }
      return
    }
    if (!directPlayerKill) return

    this.kills += 1
    this.achievements.recordKill(
      actor.role,
      isFactionAllegiance(actor.allegiance) ? actor.allegiance : null,
    )
    if (actor.eventOwnerId) {
      this.emitView(true)
      return
    }
    const reward = actor.role === 'commander' ? 55 : 12
    this.gold += reward
    this.achievements.recordGoldEarned(reward)
    this.trySpawnKillLoot(actor, deathPosition)
    this.callbacks.onNotice(
      actor.allegiance === 'beast'
        ? `Зверьё стало на одну штуку тише. Шкура, конечно, тоже 3Д. +${reward} золота.`
        : actor.role === 'commander'
          ? 'Командир дворца больше не командир.'
          : `Враг побеждён. Труп тоже 3Д. +${reward} золота.`,
      'success',
    )
    this.emitView(true)
  }

  private updateActorDeathMotion(actor: Actor, delta: number): void {
    if (!actor.deathStyle || actor.deathAge >= DEATH_POSE_TIME) return
    actor.deathAge = Math.min(DEATH_POSE_TIME, actor.deathAge + delta)
    const progress = actor.deathAge / DEATH_POSE_TIME
    const eased = 1 - Math.pow(1 - progress, 3)
    const motionScale =
      !this.screenShakeEnabled || this.reducedMotion ? REDUCED_MOTION_COMBAT_SCALE : 1
    const side =
      new THREE.Vector3(
        Math.cos(actor.deathStartRotation.y),
        0,
        -Math.sin(actor.deathStartRotation.y),
      ).dot(actor.lastHitDirection) >= 0
        ? 1
        : -1
    const travel =
      actor.deathStyle === 'launchFall'
        ? 1.15 * motionScale
        : actor.deathStyle === 'spinFall'
          ? 0.35 * motionScale
          : 0.2 * motionScale
    const desiredTravel = travel * eased
    const travelStep = desiredTravel - actor.deathTravelled
    if (travelStep > 0.0001) {
      this.moveCharacter(
        actor.mesh.position,
        actor.lastHitDirection.x * travelStep,
        actor.lastHitDirection.z * travelStep,
        this.actorColliderRadiusForRole(actor.role),
      )
      actor.deathTravelled = desiredTravel
    }
    actor.mesh.position.y = THREE.MathUtils.lerp(
      actor.deathStartPosition.y,
      this.groundHeightAt(actor.mesh.position.x, actor.mesh.position.z) + 0.62,
      eased,
    )
    actor.mesh.rotation.x = actor.deathStartRotation.x
    actor.mesh.rotation.y = actor.deathStartRotation.y
    actor.mesh.rotation.z = actor.deathStartRotation.z
    if (actor.deathStyle === 'backFall') {
      actor.mesh.rotation.x -= (Math.PI / 2) * eased
    } else if (actor.deathStyle === 'sideFall') {
      actor.mesh.rotation.z -= side * (Math.PI / 2) * eased
    } else if (actor.deathStyle === 'spinFall') {
      actor.mesh.rotation.y += side * Math.PI * motionScale * eased
      actor.mesh.rotation.z -= side * 1.08 * eased
    } else {
      actor.mesh.rotation.x -= 1.18 * eased
      actor.mesh.rotation.z -= side * 0.44 * motionScale * eased
    }
    const weapon = actor.mesh.getObjectByName('weapon')
    const leftArm = actor.mesh.getObjectByName('leftArm')
    const rightArm = actor.mesh.getObjectByName('rightArm')
    const head = actor.mesh.getObjectByName('head-pivot')
    if (weapon) weapon.rotation.x = THREE.MathUtils.lerp(weapon.rotation.x, 1.4, eased)
    if (leftArm) leftArm.rotation.z = -0.72 * eased
    if (rightArm) rightArm.rotation.z = 0.72 * eased
    if (head) head.rotation.z = side * 0.28 * eased
  }

  private injurePlayer(): void {
    const candidates: BodyPart[] = [
      'leftArm',
      'rightArm',
      'leftLeg',
      'rightLeg',
      'leftEye',
      'rightEye',
    ]
    const available = candidates.filter((part) => this.body[part] === 'healthy' || this.body[part] === 'wounded')
    if (available.length === 0) return
    const part = available[Math.floor(this.combatRng() * available.length)]
    const wasWounded = this.body[part] === 'wounded'
    const severe = wasWounded || this.combatRng() < 0.4
    if (severe) {
      this.body[part] = 'missing'
      this.achievements.recordInjury(part, true)
      if (!part.includes('Eye')) {
        this.body.bleeding = Math.min(2.1, this.body.bleeding + (part.includes('Leg') ? 0.48 : 0.34))
        this.hidePlayerLimb(part)
      }
      this.callbacks.onNotice(
        part.includes('Eye')
          ? `Потерян ${formatPart(part)}. Теперь пол-экрана не видно; ищи протез.`
          : `Потеряна ${formatPart(part)}. Без лечения истечёшь кровью; самое хорошее — протез.`,
        'danger',
      )
    } else {
      this.body[part] = 'wounded'
      this.achievements.recordInjury(part, false)
      this.body.bleeding = Math.min(1.2, this.body.bleeding + 0.12)
      this.callbacks.onNotice(
        `Ранение: ${formatPart(part)}. Если не вылечить, станет хуже.`,
        'warning',
      )
    }
    this.emitView(true)
  }

  private hidePlayerLimb(part: BodyPart): void {
    const limb = this.player.getObjectByName(part)
    if (!limb) return
    limb.visible = false
    this.createBloodBurst(
      this.player.position.clone().add(new THREE.Vector3(part.startsWith('left') ? -0.4 : 0.4, 1.2, 0)),
      new THREE.Vector3(part.startsWith('left') ? -1 : 1, 0, 0.25),
      32,
      2.4,
      4,
    )
    const detached = new THREE.Mesh(
      new THREE.BoxGeometry(part.includes('Leg') ? 0.32 : 0.25, part.includes('Leg') ? 0.95 : 0.78, 0.3),
      this.artLibrary.createMaterial({
        color: this.factionColor(this.faction),
        surface: 'cloth',
      }),
    )
    detached.position.copy(this.player.position).add(new THREE.Vector3(part.startsWith('left') ? -0.6 : 0.6, 1.2, 0))
    detached.rotation.z = Math.PI / 2
    detached.castShadow = true
    this.scene.add(detached)
    this.particles.push({
      mesh: detached,
      velocity: new THREE.Vector3(part.startsWith('left') ? -2 : 2, 3.5, 0.8),
      life: 1.4,
    })
  }

  private restorePlayerLimb(part: BodyPart): void {
    const limb = this.player.getObjectByName(part)
    if (!limb) return
    limb.visible = true
    limb.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || StylizedArtLibrary.isOutlineShell(object)) return
      object.material = this.artLibrary.createMaterial({
        color: this.palette.borderStrong,
        surface: 'metal',
        emissive: this.palette.borderStrong,
        emissiveIntensity: 0.08,
      })
    })
  }

  private applySavedBodyAppearance(): void {
    const limbs: BodyPart[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']
    for (const part of limbs) {
      const limb = this.player.getObjectByName(part)
      if (!limb) continue
      if (this.body[part] === 'missing') limb.visible = false
      if (this.body[part] === 'prosthetic') this.restorePlayerLimb(part)
    }
  }

  private detachActorLimb(actor: Actor): void {
    const names: BodyPart[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']
    const visible = names
      .map((name) => actor.mesh.getObjectByName(name))
      .filter((part): part is THREE.Object3D => Boolean(part?.visible))
    if (visible.length === 0) return
    const limb = visible[Math.floor(Math.random() * visible.length)]
    limb.visible = false
    this.createBloodBurst(
      actor.mesh.position.clone().add(new THREE.Vector3(0, 1.35, 0)),
      new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2),
      20,
      2,
      3,
    )
    const detached = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, limb.name.includes('Leg') ? 0.92 : 0.72, 0.28),
      this.artLibrary.createMaterial({
        color: this.allegianceColor(actor.allegiance),
        surface: 'cloth',
      }),
    )
    detached.position.copy(actor.mesh.position).add(new THREE.Vector3(0, 1.4, 0))
    detached.castShadow = true
    this.scene.add(detached)
    this.particles.push({
      mesh: detached,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 4.5, (Math.random() - 0.5) * 4),
      life: 1.3,
    })
  }

  private firstPartWithStatus<T extends BodyPart>(parts: T[], status: BodyState[T]): T | null {
    return parts.find((part) => this.body[part] === status) ?? null
  }

  private hasWounds(): boolean {
    const parts: BodyPart[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftEye', 'rightEye']
    return parts.some((part) => this.body[part] === 'wounded')
  }

  private healWounds(): void {
    const parts: BodyPart[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftEye', 'rightEye']
    for (const part of parts) {
      if (this.body[part] === 'wounded') this.body[part] = 'healthy'
    }
  }

  private completeObjective(id: string): boolean {
    const objective = this.objectives.find((entry) => entry.id === id)
    if (!objective || objective.done) return false
    objective.done = true
    if (objective.target) objective.progress = objective.target
    this.callbacks.onNotice(`Задача выполнена: ${objective.text}.`, 'success')
    this.achievements.recordObjectiveCompleted()
    this.playSound('objective')
    this.emitView(true)
    return true
  }

  private isObjectiveDone(id: string): boolean {
    return this.objectives.some((objective) => objective.id === id && objective.done)
  }

  private endGame(result: 'victory' | 'defeat'): void {
    if (this.ended) return
    this.dropShield()
    this.cancelActiveEvents()
    this.clearTransientCombatFeedback()
    if (result === 'victory') this.settleActiveLoot('victory')
    else this.clearLootRuntime()
    this.generatedRunStatus = result
    this.campaignCompleted = result === 'victory'
    this.ended = true
    this.achievements.recordCampaignEnd(result, this.elapsed, Math.max(0, this.health))
    this.keys.clear()
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    this.callbacks.onEnd(result)
    this.playSound(result === 'victory' ? 'victory' : 'defeat', {
      category: 'ui',
      intensity: 1,
    })
    this.audio.setEnded(true)
    this.emitView(true)
  }

  private emitView(force: boolean): void {
    const now = performance.now()
    if (!force && now - this.lastViewAt < 90) return
    this.lastViewAt = now
    const markers: MapMarker[] = [
      {
        id: 'player',
        x: this.player.position.x,
        z: this.player.position.z,
        kind: 'player',
        heading: this.cameraYaw,
      },
      {
        id: 'caravan',
        x: this.caravan.position.x,
        z: this.caravan.position.z,
        kind: 'caravan',
      },
    ]
    const activeNode = this.getActiveGeneratedObjective()
    const activeSite = activeNode
      ? this.generatedWorld.getSitePosition(activeNode.siteId)
      : undefined
    for (const marker of this.generatedWorld.getMarkers()) {
      const active = marker.id === `site:${activeNode?.siteId}`
      const site = marker.id.startsWith('site:')
        ? this.generatedBlueprint.sites.find(
            (candidate) => `site:${candidate.id}` === marker.id,
          )
        : undefined
      const label = site ? generatedSiteLabel(site.kind) : marker.label
      markers.push({
        id: marker.id,
        x: marker.x,
        z: marker.z,
        kind: active ? 'objective' : 'landmark',
        ...(label ? { label } : {}),
      })
    }
    if (
      activeNode &&
      activeSite &&
      !markers.some((marker) => marker.id === `site:${activeNode.siteId}`)
    ) {
      const objective = this.objectives.find(
        (entry) => entry.id === activeNode.id,
      )
      markers.push({
        id: `site:${activeNode.siteId}`,
        x: activeSite.x,
        z: activeSite.z,
        kind: 'objective',
        label: objective?.text,
      })
    }
    for (const event of this.activeEvents) {
      markers.push({
        id: event.markerId,
        x: event.markerPos.x,
        z: event.markerPos.z,
        kind: 'event',
        label: event.title,
      })
    }
    for (const actor of this.actors) {
      if (!actor.alive) continue
      markers.push({
        id: actor.id,
        x: actor.mesh.position.x,
        z: actor.mesh.position.z,
        // §5.3 — the matrix decides the colour. Beasts get their own so a pack never
        // reads as somebody's soldiers, and anything we have no quarrel with is neutral.
        kind:
          actor.allegiance === 'beast'
            ? 'beast'
            : this.playerRelationTo(actor) === 'hostile'
              ? 'enemy'
              : this.playerRelationTo(actor) === 'friendly'
                ? 'ally'
                : 'neutral',
      })
    }
    const generatedCurrentRegionId = this.generatedWorld.getRegionIdAt(
      this.player.position.x,
      this.player.position.z,
    )
    const discoveredRegions = new Set(
      this.generatedWorld.discoveredRegionIds.map(String),
    )
    const worldMap: GameView['worldMap'] = {
      bounds: { ...this.generatedWorld.bounds },
      ...(generatedCurrentRegionId === undefined
        ? {}
        : { currentRegionId: String(generatedCurrentRegionId) }),
      seed: this.generatedBlueprint.seed,
      generatorVersion: this.generatedBlueprint.generatorVersion,
      regions: this.generatedBlueprint.regions.map((region) => {
        const chronicle = this.chronicleRegions.get(String(region.id))
        return {
          id: String(region.id),
          gridX: region.coordinate.x,
          gridZ: region.coordinate.y,
          biome: region.biome,
          territory: chronicle?.control ?? region.territory,
          discovered: discoveredRegions.has(String(region.id)),
          current: String(region.id) === String(generatedCurrentRegionId),
          contested: this.chronicleContestedRegionIds.has(String(region.id)),
          razed: isRegionRazed(chronicle),
        }
      }),
    }
    const ability = createAbilityView(this.faction, this.stamina, this.body)
    ability.active = this.shieldActive
    ability.cooldown = this.abilityCooldown
    ability.ready =
      ability.ready &&
      !this.paused &&
      !this.ended &&
      !this.shieldActive &&
      this.abilityCooldown <= 0
    const view: GameView = {
      faction: this.faction,
      health: Math.max(0, this.health),
      maxHealth: this.maxHealth,
      damageFlash: this.damageFlash,
      stamina: this.stamina,
      maxStamina: this.maxStamina,
      gold: this.gold,
      kills: this.kills,
      damage: this.damage,
      zone: this.zoneAtPosition(this.player.position.x, this.player.position.z),
      body: { ...this.body },
      objectives: this.objectives.map((objective) => ({ ...objective })),
      prompt: this.prompt,
      markers,
      worldMap,
      chronicle: this.buildChronicleFeed(),
      shopPriceMultiplier: this.activeShopPriceMultiplier,
      squad: this.actors.filter(
        (actor) =>
          actor.alive &&
          actor.allegiance === this.faction &&
          actor.squadEligible &&
          actor.role !== 'commander',
      ).length,
      elapsed: this.elapsed,
      pointerLocked: document.pointerLockElement === this.renderer.domElement,
      paused: this.paused,
      caravanCooldown: this.caravanCooldown,
      ability,
      campaignCompleted: this.campaignCompleted,
      threatTier: this.threatTier,
      upgrades: { ...this.upgrades },
      lootToast: this.lootToast ? { ...this.lootToast } : null,
      activeEvent: this.primaryEvent
        ? {
            id: this.primaryEvent.id,
            kind: this.primaryEvent.kind,
            title: this.primaryEvent.title,
            description: this.primaryEvent.description,
            tone: this.primaryEvent.tone,
            progress: this.primaryEvent.progress,
            target: this.primaryEvent.target,
            ...(this.primaryEvent.timer === null
              ? {}
              : { timeRemaining: Math.max(0, this.primaryEvent.timer) }),
          }
        : null,
    }
    this.callbacks.onView(view)
  }

  private stableSeed(value: string): number {
    let seed = 104729
    for (const character of value) {
      seed = (seed * 31 + character.charCodeAt(0)) % 2147483647
    }
    return Math.max(1, seed)
  }

  private createLootMaterials(): Record<LootRarity, LootRarityMaterials> {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (context) {
      context.translate(32, 32)
      context.fillStyle = '#ffffff'
      context.beginPath()
      for (let point = 0; point < 16; point += 1) {
        const angle = -Math.PI / 2 + (point * Math.PI) / 8
        const radius = point % 2 === 0 ? 29 : 11
        const x = Math.cos(angle) * radius
        const y = Math.sin(angle) * radius
        if (point === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.closePath()
      context.fill()
    }
    const starTexture = new THREE.CanvasTexture(canvas)
    starTexture.colorSpace = THREE.SRGBColorSpace
    this.generatedTextures.set('loot-starburst', starTexture)

    const colors: Record<LootRarity, THREE.Color> = {
      common: this.palette.text.clone(),
      uncommon: this.palette.success.clone(),
      rare: this.palette.link.clone(),
      legendary: this.palette.warning.clone(),
    }
    const create = (rarity: LootRarity): LootRarityMaterials => ({
      token: new THREE.MeshBasicMaterial({
        color: colors[rarity],
        toneMapped: false,
      }),
      beam: new THREE.MeshBasicMaterial({
        color: colors[rarity],
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      ring: new THREE.MeshBasicMaterial({
        color: colors[rarity],
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      star: new THREE.SpriteMaterial({
        color: colors[rarity],
        map: starTexture,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        toneMapped: false,
      }),
    })
    return {
      common: create('common'),
      uncommon: create('uncommon'),
      rare: create('rare'),
      legendary: create('legendary'),
    }
  }

  private initializeLootPool(): void {
    const coinGeometry = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 8)
    const medicineGeometry = new THREE.OctahedronGeometry(0.34, 0)
    const medicineCrossGeometry = new THREE.BoxGeometry(0.12, 0.5, 0.08)
    const whetstoneGeometry = new THREE.DodecahedronGeometry(0.3, 0)
    const beamGeometry = new THREE.PlaneGeometry(0.34, 1)
    const ringGeometry = new THREE.RingGeometry(0.62, 0.78, 32)
    const outerRingGeometry = new THREE.RingGeometry(0.94, 1.05, 32)
    const ringSegmentGeometry = new THREE.BoxGeometry(0.46, 0.035, 0.11)
    const burstGeometry = new THREE.OctahedronGeometry(0.09, 0)
    const placeholderReward: LootReward = {
      kind: 'coins',
      rarity: 'common',
      amount: 0,
      label: 'Звонкая мелочь',
    }

    for (let index = 0; index < LOOT_MAX_ACTIVE; index += 1) {
      const root = new THREE.Group()
      root.name = `loot-pickup-${index}`
      root.visible = false
      const display = new THREE.Group()
      const tokenRoot = new THREE.Group()
      tokenRoot.position.y = 0.24
      display.add(tokenRoot)
      root.add(display)

      const coins = new THREE.Group()
      const coin = new THREE.Mesh(coinGeometry, this.lootMaterials.common.token)
      coin.rotation.z = Math.PI / 2
      coins.add(coin)

      const medicine = new THREE.Group()
      const vial = new THREE.Mesh(medicineGeometry, this.lootMaterials.common.token)
      const crossVertical = new THREE.Mesh(
        medicineCrossGeometry,
        this.lootMaterials.common.token,
      )
      const crossHorizontal = new THREE.Mesh(
        medicineCrossGeometry,
        this.lootMaterials.common.token,
      )
      crossVertical.position.z = 0.25
      crossHorizontal.position.z = 0.25
      crossHorizontal.rotation.z = Math.PI / 2
      medicine.add(vial, crossVertical, crossHorizontal)

      const whetstone = new THREE.Group()
      const stone = new THREE.Mesh(whetstoneGeometry, this.lootMaterials.common.token)
      stone.scale.set(1.65, 0.72, 0.72)
      stone.rotation.z = -0.2
      whetstone.add(stone)

      const tokens: Record<LootRewardKind, THREE.Group> = {
        coins,
        medicine,
        whetstone,
      }
      tokenRoot.add(coins, medicine, whetstone)

      const beamA = new THREE.Mesh(beamGeometry, this.lootMaterials.common.beam)
      const beamB = new THREE.Mesh(beamGeometry, this.lootMaterials.common.beam)
      beamB.rotation.y = Math.PI / 2
      this.bindLootOpacity(beamA)
      this.bindLootOpacity(beamB)
      display.add(beamA, beamB)

      const smoothRing = new THREE.Mesh(
        ringGeometry,
        this.lootMaterials.common.ring,
      )
      smoothRing.rotation.x = -Math.PI / 2
      smoothRing.position.y = -LOOT_Y + 0.04
      this.bindLootOpacity(smoothRing)
      display.add(smoothRing)

      const segmentedRing = new THREE.Group()
      segmentedRing.position.y = -LOOT_Y + 0.04
      for (let segment = 0; segment < 8; segment += 1) {
        const angle = (segment / 8) * TWO_PI
        const mesh = new THREE.Mesh(
          ringSegmentGeometry,
          this.lootMaterials.common.ring,
        )
        mesh.position.set(Math.cos(angle) * 0.72, 0, Math.sin(angle) * 0.72)
        mesh.rotation.y = -angle
        this.bindLootOpacity(mesh)
        segmentedRing.add(mesh)
      }
      display.add(segmentedRing)

      const outerRing = new THREE.Mesh(
        outerRingGeometry,
        this.lootMaterials.common.ring,
      )
      outerRing.rotation.x = -Math.PI / 2
      outerRing.position.y = -LOOT_Y + 0.045
      this.bindLootOpacity(outerRing)
      display.add(outerRing)

      const starburst = new THREE.Sprite(this.lootMaterials.common.star)
      this.bindLootOpacity(starburst)
      display.add(starburst)

      this.scene.add(root)
      this.lootPickups.push({
        root,
        display,
        tokenRoot,
        tokens,
        beams: [beamA, beamB],
        smoothRing,
        segmentedRing,
        outerRing,
        starburst,
        reward: placeholderReward,
        state: 'burst',
        velocity: new THREE.Vector3(),
        age: 0,
        idleAge: 0,
        active: false,
        serial: 0,
      })
    }

    for (let index = 0; index < LOOT_COLLECTION_BURST_COUNT; index += 1) {
      const root = new THREE.Group()
      root.name = `loot-collection-burst-${index}`
      root.visible = false
      const shards: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>[] = []
      const directions: THREE.Vector3[] = []
      for (let shardIndex = 0; shardIndex < 7; shardIndex += 1) {
        const angle = (shardIndex / 7) * TWO_PI
        const shard = new THREE.Mesh(
          burstGeometry,
          this.lootMaterials.common.ring,
        )
        this.bindLootOpacity(shard)
        shards.push(shard)
        directions.push(
          new THREE.Vector3(
            Math.cos(angle),
            0.45 + (shardIndex % 2) * 0.28,
            Math.sin(angle),
          ).normalize(),
        )
        root.add(shard)
      }
      this.scene.add(root)
      this.lootCollectionBursts.push({
        root,
        shards,
        directions,
        active: false,
        age: 0,
        serial: 0,
      })
    }
  }

  private bindLootOpacity(object: THREE.Object3D): void {
    object.userData.lootOpacity = 1
    object.onBeforeRender = (
      _renderer,
      _scene,
      _camera,
      _geometry,
      material,
    ) => {
      if (
        material instanceof THREE.MeshBasicMaterial ||
        material instanceof THREE.SpriteMaterial
      ) {
        material.opacity = object.userData.lootOpacity as number
      }
    }
  }

  private trySpawnKillLoot(actor: Actor, deathPosition: THREE.Vector3): void {
    if (actor.role !== 'commander' && this.lootRng() >= LOOT_DROP_CHANCE) return
    const minimumRarity: LootRarity =
      actor.role === 'commander' ? 'rare' : 'common'
    this.spawnLoot(this.rollLootReward(minimumRarity), deathPosition)
  }

  private spawnEventLoot(event: WorldEvent): void {
    const legendary = event.kind === 'champion'
    // A located event was won where it stood, so its spoils stay there.
    const position =
      legendary || event.anchor === 'located' ? event.markerPos : this.player.position
    this.spawnLoot(
      this.rollLootReward(legendary ? 'legendary' : 'uncommon'),
      position,
    )
  }

  private rollLootReward(minimumRarity: LootRarity): LootReward {
    const rarity = this.rollLootRarity(minimumRarity)
    let kinds: LootRewardKind[]
    if (rarity === 'common') {
      kinds = ['coins']
    } else if (rarity === 'uncommon') {
      kinds = ['coins', 'medicine']
    } else {
      kinds =
        this.damage >= LOOT_DAMAGE_CAP
          ? ['coins', 'medicine']
          : ['coins', 'medicine', 'whetstone']
    }
    const kind = kinds[Math.floor(this.lootRng() * kinds.length)]
    let amount: number
    if (rarity === 'legendary') {
      amount = kind === 'coins' ? 70 : kind === 'medicine' ? 45 : 2
    } else if (rarity === 'rare') {
      amount =
        kind === 'coins'
          ? this.rollLootInteger(28, 42)
          : kind === 'medicine'
            ? this.rollLootInteger(24, 32)
            : 1
    } else if (rarity === 'uncommon') {
      amount =
        kind === 'coins'
          ? this.rollLootInteger(12, 20)
          : this.rollLootInteger(12, 18)
    } else {
      amount = this.rollLootInteger(5, 10)
    }
    const labels: Record<LootRewardKind, string> = {
      coins: 'Звонкая мелочь',
      medicine: 'Пузырёк знахаря',
      whetstone: 'Точильный камень',
    }
    return { kind, rarity, amount, label: labels[kind] }
  }

  private rollLootRarity(minimumRarity: LootRarity): LootRarity {
    const roll = this.lootRng()
    const rolled: LootRarity =
      roll < 0.62
        ? 'common'
        : roll < 0.89
          ? 'uncommon'
          : roll < 0.98
            ? 'rare'
            : 'legendary'
    return LOOT_RARITY_RANK[rolled] < LOOT_RARITY_RANK[minimumRarity]
      ? minimumRarity
      : rolled
  }

  private rollLootInteger(min: number, max: number): number {
    return min + Math.floor(this.lootRng() * (max - min + 1))
  }

  private spawnLoot(reward: LootReward, position: THREE.Vector3): void {
    const pickup = this.acquireLootPickup()
    pickup.reward = reward
    pickup.state = 'burst'
    pickup.age = 0
    pickup.idleAge = 0
    pickup.active = true
    pickup.serial = ++this.lootSequence
    pickup.root.position.set(
      position.x,
      Math.max(
        this.groundHeightAt(position.x, position.z) + LOOT_Y,
        position.y + 0.4,
      ),
      position.z,
    )
    const angle = this.lootRng() * TWO_PI
    const radialSpeed = 0.8 + this.lootRng() * 1.25
    pickup.velocity.set(
      Math.cos(angle) * radialSpeed,
      2.4 + this.lootRng() * 1.2,
      Math.sin(angle) * radialSpeed,
    )
    pickup.root.visible = true
    this.configureLootVisual(pickup)
    this.playSound('lootReveal', {
      position: pickup.root.position,
      intensity: (LOOT_RARITY_RANK[reward.rarity] + 1) / 4,
      variantSeed: pickup.serial,
    })
  }

  private acquireLootPickup(): LootPickup {
    const inactive = this.lootPickups.find((pickup) => !pickup.active)
    if (inactive) return inactive

    let candidate: LootPickup | null = null
    for (const pickup of this.lootPickups) {
      if (
        pickup.reward.rarity === 'common' &&
        (!candidate ||
          candidate.reward.rarity !== 'common' ||
          pickup.serial < candidate.serial)
      ) {
        candidate = pickup
      }
    }
    if (!candidate) {
      for (const pickup of this.lootPickups) {
        if (
          !candidate ||
          LOOT_RARITY_RANK[pickup.reward.rarity] <
            LOOT_RARITY_RANK[candidate.reward.rarity] ||
          (pickup.reward.rarity === candidate.reward.rarity &&
            pickup.serial < candidate.serial)
        ) {
          candidate = pickup
        }
      }
    }
    if (!candidate) throw new Error('Korovany: loot pool is unexpectedly empty.')
    this.collectLoot(candidate, 'pool')
    return candidate
  }

  private configureLootVisual(pickup: LootPickup): void {
    const { rarity, kind } = pickup.reward
    const materials = this.lootMaterials[rarity]
    const beamHeight = LOOT_BEAM_HEIGHT[rarity]
    pickup.root.scale.setScalar(1)
    pickup.display.scale.setScalar(1)
    pickup.tokenRoot.position.y = 0.24
    pickup.tokenRoot.rotation.set(0, 0, 0)
    pickup.tokenRoot.scale.setScalar(0.2)
    for (const [tokenKind, token] of Object.entries(pickup.tokens)) {
      token.visible = tokenKind === kind
      token.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || StylizedArtLibrary.isOutlineShell(object)) return
        object.material = materials.token
      })
    }
    for (const beam of pickup.beams) {
      beam.material = materials.beam
      beam.position.y = beamHeight * 0.5
      beam.scale.set(1, beamHeight, 1)
      beam.userData.lootOpacity = 0
      beam.visible = true
    }
    pickup.smoothRing.material = materials.ring
    pickup.outerRing.material = materials.ring
    pickup.segmentedRing.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || StylizedArtLibrary.isOutlineShell(object)) return
      object.material = materials.ring
    })
    pickup.smoothRing.visible = rarity !== 'uncommon'
    pickup.segmentedRing.visible = rarity === 'uncommon'
    pickup.outerRing.visible = rarity === 'rare' || rarity === 'legendary'
    pickup.smoothRing.scale.setScalar(1)
    pickup.segmentedRing.scale.setScalar(1)
    pickup.outerRing.scale.setScalar(1)
    this.setLootRingOpacity(pickup, 0)
    pickup.starburst.material = materials.star
    pickup.starburst.position.set(0, beamHeight + 0.45, 0)
    pickup.starburst.scale.setScalar(rarity === 'legendary' ? 0.95 : 0)
    pickup.starburst.visible = rarity === 'legendary'
    pickup.starburst.userData.lootOpacity = 0
  }

  private updateLoot(delta: number): void {
    if (this.lootToast && this.elapsed >= this.lootToastExpiresAt) {
      this.lootToast = null
      this.lootToastExpiresAt = 0
      this.emitView(true)
    }
    this.updateLootCollectionBursts(delta)

    for (const pickup of this.lootPickups) {
      if (!pickup.active) continue
      pickup.age += delta
      const phase = pickup.serial * 2.399963229728653
      const motion = this.reducedMotion ? 0 : Math.sin(this.elapsed * 2.7 + phase)
      pickup.tokenRoot.position.y = 0.24 + motion * 0.07
      if (!this.reducedMotion) pickup.tokenRoot.rotation.y += delta * 1.7

      if (pickup.state === 'burst') {
        pickup.velocity.y -= 9.5 * delta
        pickup.root.position.addScaledVector(pickup.velocity, delta)
        const burstProgress = THREE.MathUtils.clamp(
          pickup.age / LOOT_BURST_TIME,
          0,
          1,
        )
        pickup.tokenRoot.scale.setScalar(
          THREE.MathUtils.lerp(0.2, 1, smoothstep(0, 1, burstProgress)),
        )
        const lootGround =
          this.groundHeightAt(
            pickup.root.position.x,
            pickup.root.position.z,
          ) + LOOT_Y
        if (pickup.root.position.y <= lootGround || pickup.age >= LOOT_BURST_TIME) {
          pickup.root.position.y = lootGround
          pickup.velocity.set(0, 0, 0)
          pickup.state = 'idle'
          pickup.idleAge = 0
          pickup.tokenRoot.scale.setScalar(1)
        }
      } else {
        pickup.tokenRoot.scale.setScalar(1)
        pickup.idleAge += delta
      }

      const reveal =
        pickup.state === 'burst'
          ? 0
          : THREE.MathUtils.clamp(pickup.idleAge / 0.12, 0, 1)
      for (const beam of pickup.beams) beam.userData.lootOpacity = reveal * 0.32
      this.setLootRingOpacity(pickup, reveal * 0.82)
      pickup.starburst.userData.lootOpacity = reveal * 0.95
      this.updateLootPulse(pickup, phase)

      if (pickup.state === 'idle') {
        const dx = pickup.root.position.x - this.player.position.x
        const dz = pickup.root.position.z - this.player.position.z
        if (
          dx * dx + dz * dz <= LOOT_MAGNET_RADIUS * LOOT_MAGNET_RADIUS ||
          pickup.age >= LOOT_FORCE_MAGNET_AGE
        ) {
          pickup.state = 'magnet'
        }
      }
      if (pickup.state !== 'magnet' || this.health <= 0) continue

      this.lootTarget.copy(this.player.position)
      this.lootTarget.y += 1.25
      this.lootDirection.copy(this.lootTarget).sub(pickup.root.position)
      let distance = this.lootDirection.length()
      if (distance <= LOOT_COLLECT_RADIUS) {
        this.collectLoot(pickup, 'magnet')
        continue
      }
      this.lootDirection.multiplyScalar(1 / Math.max(distance, 0.0001))
      pickup.velocity.addScaledVector(
        this.lootDirection,
        LOOT_MAGNET_ACCEL * delta,
      )
      pickup.velocity.multiplyScalar(Math.exp(-3.2 * delta))
      pickup.velocity.clampLength(0, LOOT_MAGNET_MAX_SPEED)
      pickup.root.position.addScaledVector(pickup.velocity, delta)
      this.lootDirection.copy(this.lootTarget).sub(pickup.root.position)
      distance = this.lootDirection.length()
      if (distance <= LOOT_COLLECT_RADIUS) this.collectLoot(pickup, 'magnet')
    }
  }

  private updateLootPulse(pickup: LootPickup, phase: number): void {
    pickup.display.scale.setScalar(1)
    pickup.smoothRing.scale.setScalar(1)
    pickup.segmentedRing.scale.setScalar(1)
    pickup.outerRing.scale.setScalar(1)
    for (const beam of pickup.beams) beam.scale.x = 1
    if (this.reducedMotion || pickup.reward.rarity === 'common') return

    const pulse = Math.sin(this.elapsed * 2.3 + phase)
    if (pickup.reward.rarity === 'uncommon') {
      pickup.segmentedRing.scale.setScalar(1 + pulse * 0.055)
    } else if (pickup.reward.rarity === 'rare') {
      pickup.smoothRing.scale.setScalar(1 + pulse * 0.07)
      pickup.outerRing.scale.setScalar(1 - pulse * 0.07)
    } else {
      const strongPulse = 1 + Math.max(0, pulse) * 0.12
      pickup.smoothRing.scale.setScalar(strongPulse)
      pickup.outerRing.scale.setScalar(2 - strongPulse)
      for (const beam of pickup.beams) beam.scale.x = strongPulse
    }
  }

  private setLootRingOpacity(pickup: LootPickup, opacity: number): void {
    pickup.smoothRing.userData.lootOpacity = opacity
    pickup.outerRing.userData.lootOpacity = opacity
    pickup.segmentedRing.traverse((object) => {
      if (object instanceof THREE.Mesh) object.userData.lootOpacity = opacity
    })
  }

  private collectLoot(
    pickup: LootPickup,
    reason: LootCollectionReason,
  ): void {
    if (!pickup.active) return
    void reason
    const reward = pickup.reward
    pickup.active = false
    this.spawnLootCollectionBurst(pickup.root.position, reward.rarity)
    pickup.root.visible = false
    pickup.velocity.set(0, 0, 0)
    pickup.age = 0
    pickup.idleAge = 0
    const detail = this.applyLootReward(reward)
    this.playSound('lootCollect', {
      position: pickup.root.position,
      intensity: (LOOT_RARITY_RANK[reward.rarity] + 1) / 4,
      variantSeed: pickup.serial,
    })
    this.lootToast = {
      id: ++this.lootToastSequence,
      rarity: reward.rarity,
      title: reward.label,
      detail,
    }
    this.lootToastExpiresAt = this.elapsed + LOOT_TOAST_TIME
    this.emitView(true)
  }

  private applyLootReward(reward: LootReward): string {
    if (reward.kind === 'coins') {
      this.gold += reward.amount
      this.achievements.recordGoldEarned(reward.amount)
      return `+${reward.amount} золота`
    }
    if (reward.kind === 'medicine') {
      if (this.health >= this.maxHealth) {
        const convertedGold = Math.ceil(reward.amount / 2)
        this.gold += convertedGold
        this.achievements.recordGoldEarned(convertedGold)
        return `Полное здоровье: +${convertedGold} золота`
      }
      const before = Math.ceil(this.health)
      this.health = Math.min(this.maxHealth, this.health + reward.amount)
      return `Здоровье ${before} -> ${Math.ceil(this.health)}`
    }

    const before = this.damage
    const usable = Math.min(
      reward.amount,
      Math.max(0, LOOT_DAMAGE_CAP - this.damage),
    )
    const unused = reward.amount - usable
    this.damage += usable
    const convertedGold = unused * 25
    if (convertedGold > 0) {
      this.gold += convertedGold
      this.achievements.recordGoldEarned(convertedGold)
    }
    if (usable > 0 && convertedGold > 0) {
      return `Урон ${before} -> ${this.damage}; излишек +${convertedGold} золота`
    }
    if (usable > 0) return `Урон ${before} -> ${this.damage}`
    return `Предел урона ${this.damage}: +${convertedGold} золота`
  }

  private spawnLootCollectionBurst(
    position: THREE.Vector3,
    rarity: LootRarity,
  ): void {
    let burst = this.lootCollectionBursts.find((entry) => !entry.active)
    if (!burst) {
      burst = this.lootCollectionBursts.reduce((oldest, entry) =>
        entry.serial < oldest.serial ? entry : oldest,
      )
    }
    burst.active = true
    burst.age = 0
    burst.serial = ++this.lootBurstSequence
    burst.root.position.copy(position)
    burst.root.visible = true
    const material = this.lootMaterials[rarity].ring
    for (const shard of burst.shards) {
      shard.material = material
      shard.position.set(0, 0, 0)
      shard.scale.setScalar(1)
      shard.userData.lootOpacity = 1
    }
  }

  private updateLootCollectionBursts(delta: number): void {
    for (const burst of this.lootCollectionBursts) {
      if (!burst.active) continue
      burst.age += delta
      if (burst.age >= LOOT_COLLECTION_BURST_TIME) {
        burst.active = false
        burst.root.visible = false
        continue
      }
      const progress = burst.age / LOOT_COLLECTION_BURST_TIME
      const distance = progress * 1.65
      const scale = 1 - progress * 0.65
      for (let index = 0; index < burst.shards.length; index += 1) {
        const shard = burst.shards[index]
        shard.position.copy(burst.directions[index]).multiplyScalar(distance)
        shard.position.y -= progress * progress * 0.7
        shard.rotation.x += delta * 5
        shard.rotation.y += delta * 7
        shard.scale.setScalar(scale)
        shard.userData.lootOpacity = 1 - progress
      }
    }
  }

  private settleActiveLoot(reason: Extract<LootCollectionReason, 'save' | 'victory'>): void {
    while (true) {
      let oldest: LootPickup | null = null
      for (const pickup of this.lootPickups) {
        if (pickup.active && (!oldest || pickup.serial < oldest.serial)) {
          oldest = pickup
        }
      }
      if (!oldest) return
      this.collectLoot(oldest, reason)
    }
  }

  private clearLootRuntime(): void {
    for (const pickup of this.lootPickups) {
      pickup.active = false
      pickup.root.visible = false
      pickup.velocity.set(0, 0, 0)
      pickup.age = 0
      pickup.idleAge = 0
    }
    for (const burst of this.lootCollectionBursts) {
      burst.active = false
      burst.root.visible = false
      burst.age = 0
    }
    this.lootToast = null
    this.lootToastExpiresAt = 0
  }

  private setupLights(): void {
    this.hemisphere = new THREE.HemisphereLight(
      this.palette.worldSky,
      this.palette.worldAmbientGround,
      1.65,
    )
    this.scene.add(this.hemisphere)
    this.sun = new THREE.DirectionalLight(this.palette.worldSun, 2.65)
    this.sun.position.set(
      this.player.position.x - 35,
      58,
      this.player.position.z + 24,
    )
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
    // The old frustum was +/-85 at the same map size. Nothing outside the streamed
    // neighbourhood ever needed a shadow, and halving the extent roughly triples the
    // texel density on the things that do.
    this.sun.shadow.camera.left = -SHADOW_FRUSTUM_HALF_EXTENT
    this.sun.shadow.camera.right = SHADOW_FRUSTUM_HALF_EXTENT
    this.sun.shadow.camera.top = SHADOW_FRUSTUM_HALF_EXTENT
    this.sun.shadow.camera.bottom = -SHADOW_FRUSTUM_HALF_EXTENT
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 160
    // Tighter texels expose acne; a normal-space bias fixes it without the peter
    // panning a large constant depth bias would cause.
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.028
    this.sun.target.position.set(
      this.player.position.x,
      0,
      this.player.position.z,
    )
    this.scene.add(this.sun, this.sun.target)

    // A back-rim light is what separates a silhouette from the sky it stands
    // against. It never casts shadows and it never moves independently: it is the
    // sun's opposite, cooled towards the sky, so the day/night keyframes stay the
    // single authority over what time it is.
    this.rimLight = new THREE.DirectionalLight(this.palette.worldSky, RIM_LIGHT_BASE)
    this.rimLight.castShadow = false
    this.rimLight.position.set(
      this.player.position.x + 30,
      34,
      this.player.position.z - 26,
    )
    this.rimLight.target.position.set(
      this.player.position.x,
      0,
      this.player.position.z,
    )
    this.scene.add(this.rimLight, this.rimLight.target)

    // §5D — one light for every torch in the world, which is the whole reason torches
    // are affordable. It follows the nearest bearer; see `updateTorches`.
    this.torchLight = new THREE.PointLight(this.palette.warning, 0, TORCH_LIGHT_RANGE, 2)
    this.torchLight.visible = false
    this.scene.add(this.torchLight)
  }

  private createDecalTexture(kind: DecalKind): THREE.CanvasTexture {
    const key = `decal-${kind}`
    const cached = this.generatedTextures.get(key)
    if (cached) return cached

    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) throw new Error(`Could not create procedural decal texture: ${kind}`)
    const random = seededRandom(kind === 'blood' ? 2701 : 4903)

    if (kind === 'blood') {
      context.fillStyle = '#820018'
      context.globalAlpha = 0.92
      context.beginPath()
      context.ellipse(32, 32, 19, 16, 0.3, 0, TWO_PI)
      context.fill()
      for (let index = 0; index < 30; index += 1) {
        const angle = random() * TWO_PI
        const distance = random() * 23
        context.fillStyle = index % 4 === 0 ? '#ff3158' : index % 3 === 0 ? '#b00020' : '#780016'
        context.globalAlpha = 0.42 + random() * 0.5
        context.beginPath()
        context.ellipse(
          32 + Math.cos(angle) * distance,
          32 + Math.sin(angle) * distance,
          3 + random() * 11,
          2 + random() * 8,
          angle,
          0,
          TWO_PI,
        )
        context.fill()
      }
      for (let index = 0; index < 18; index += 1) {
        context.fillStyle = index % 3 === 0 ? '#ff5f7a' : '#8f001b'
        context.globalAlpha = 0.5 + random() * 0.42
        context.beginPath()
        context.arc(
          3 + random() * 58,
          3 + random() * 58,
          0.9 + random() * 2.8,
          0,
          TWO_PI,
        )
        context.fill()
      }
    } else {
      const gradient = context.createRadialGradient(32, 32, 5, 32, 32, 30)
      gradient.addColorStop(0, 'rgba(12, 10, 8, 0.16)')
      gradient.addColorStop(0.48, 'rgba(18, 14, 10, 0.54)')
      gradient.addColorStop(0.72, 'rgba(6, 5, 4, 0.72)')
      gradient.addColorStop(1, 'rgba(6, 5, 4, 0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 64, 64)
      context.fillStyle = '#080706'
      for (let index = 0; index < 28; index += 1) {
        const angle = random() * TWO_PI
        const distance = 12 + random() * 18
        context.globalAlpha = 0.08 + random() * 0.18
        context.beginPath()
        context.arc(
          32 + Math.cos(angle) * distance,
          32 + Math.sin(angle) * distance,
          1 + random() * 3.5,
          0,
          TWO_PI,
        )
        context.fill()
      }
    }
    context.globalAlpha = 1

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    this.generatedTextures.set(key, texture)
    return texture
  }

  private createSurfaceTexture(
    key: string,
    base: THREE.Color,
    detail: THREE.Color,
    options: SurfaceTextureOptions,
  ): THREE.CanvasTexture {
    const hatchKey = options.hatch
      ? [
          options.hatch.motif,
          options.hatch.density,
          options.hatch.angle.toFixed(3),
          options.hatch.opacity.toFixed(3),
          options.hatch.color.getHexString(),
        ].join('-')
      : 'none'
    const cacheKey = `${key}|${options.pattern}|${options.repeatX}x${options.repeatY}|${hatchKey}`
    const cached = this.generatedTextures.get(cacheKey)
    if (cached) return cached

    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) throw new Error(`Could not create procedural texture: ${key}`)
    context.imageSmoothingEnabled = false
    context.fillStyle = base.getStyle()
    context.fillRect(0, 0, canvas.width, canvas.height)

    let seed = 17
    for (const character of cacheKey) {
      seed = (seed * 31 + character.charCodeAt(0)) % 2147483647
    }
    const random = seededRandom(Math.max(1, seed))
    const light = mix(detail, this.palette.surface, 0.34)
    const dark = mix(detail, this.palette.text, 0.3)

    if (options.pattern === 'grass') {
      for (let index = 0; index < 210; index += 1) {
        context.fillStyle = (index % 5 === 0 ? light : index % 3 === 0 ? dark : detail).getStyle()
        const x = Math.floor(random() * 64)
        const y = Math.floor(random() * 64)
        context.fillRect(x, y, index % 7 === 0 ? 2 : 1, 1 + Math.floor(random() * 3))
      }
    } else if (options.pattern === 'dirt' || options.pattern === 'scree') {
      const count = options.pattern === 'scree' ? 175 : 130
      for (let index = 0; index < count; index += 1) {
        context.fillStyle = (index % 4 === 0 ? light : index % 2 === 0 ? dark : detail).getStyle()
        const size =
          options.pattern === 'scree'
            ? 1 + Math.floor(random() * 4)
            : 1 + Math.floor(random() * 2)
        context.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), size, size)
      }
    } else if (options.pattern === 'stone') {
      context.strokeStyle = detail.getStyle()
      context.lineWidth = 2
      for (let y = 0; y <= 64; y += 16) {
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(64, y)
        context.stroke()
        const offset = (y / 16) % 2 === 0 ? 0 : 12
        for (let x = offset; x <= 64; x += 24) {
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x, Math.min(64, y + 16))
          context.stroke()
        }
      }
      context.globalAlpha = 0.35
      for (let index = 0; index < 48; index += 1) {
        context.fillStyle = (index % 2 === 0 ? light : dark).getStyle()
        context.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), 2, 1)
      }
      context.globalAlpha = 1
    } else if (options.pattern === 'wood') {
      context.fillStyle = detail.getStyle()
      for (let y = 0; y < 64; y += 8) context.fillRect(0, y, 64, 1)
      context.globalAlpha = 0.6
      for (let index = 0; index < 36; index += 1) {
        context.fillStyle = (index % 3 === 0 ? light : dark).getStyle()
        const y = Math.floor(random() * 8) * 8 + 3
        context.fillRect(Math.floor(random() * 60), y, 2 + Math.floor(random() * 5), 1)
      }
      context.globalAlpha = 1
    } else {
      context.fillStyle = detail.getStyle()
      for (let y = 0; y < 64; y += 10) {
        context.fillRect(0, y, 64, 2)
        const offset = (y / 10) % 2 === 0 ? 0 : 8
        for (let x = offset; x < 64; x += 16) context.fillRect(x, y, 2, 10)
      }
      context.globalAlpha = 0.35
      context.fillStyle = light.getStyle()
      for (let index = 0; index < 42; index += 1) {
        context.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), 2, 1)
      }
      context.globalAlpha = 1
    }

    if (options.hatch) {
      this.drawSurfaceHatch(context, options.hatch, random)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(options.repeatX, options.repeatY)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.generatedTextures.set(cacheKey, texture)
    return texture
  }

  private drawSurfaceHatch(
    context: CanvasRenderingContext2D,
    hatch: NonNullable<SurfaceTextureOptions['hatch']>,
    random: () => number,
  ): void {
    context.save()
    context.translate(32, 32)
    context.rotate(hatch.angle)
    context.translate(-32, -32)
    context.globalAlpha = hatch.opacity
    context.strokeStyle = hatch.color.getStyle()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = 1.4

    for (let index = 0; index < hatch.density; index += 1) {
      const x = 5 + random() * 54
      const y = 5 + random() * 54
      context.beginPath()
      if (hatch.motif === 'scrape') {
        const length = 12 + random() * 18
        const gap = 2 + random() * 4
        context.moveTo(x - length * 0.5, y)
        context.lineTo(x - gap, y + random() * 1.5)
        context.moveTo(x + gap, y + random() * 1.5)
        context.lineTo(x + length * 0.5, y)
      } else if (hatch.motif === 'chevron') {
        const width = 4 + random() * 3
        const height = 3 + random() * 3
        context.moveTo(x - width, y - height)
        context.lineTo(x, y)
        context.lineTo(x + width, y - height)
        if (index % 2 === 0) {
          context.moveTo(x, y)
          context.lineTo(x, y + height + 3)
        }
      } else if (hatch.motif === 'organic') {
        const width = 7 + random() * 6
        const bend = 3 + random() * 4
        context.moveTo(x - width * 0.5, y)
        context.bezierCurveTo(
          x - width * 0.2,
          y - bend,
          x + width * 0.2,
          y + bend,
          x + width * 0.5,
          y,
        )
        if (index % 3 === 0) {
          context.moveTo(x - width * 0.35, y + 3)
          context.quadraticCurveTo(x, y + bend + 3, x + width * 0.35, y + 3)
        }
      } else {
        const length = 8 + random() * 10
        context.moveTo(x - length * 0.45, y + length * 0.5)
        context.lineTo(x + length * 0.45, y - length * 0.5)
        if (index % 2 === 0) {
          context.moveTo(x + 4, y + length * 0.3)
          context.lineTo(x + 4 + length * 0.55, y - length * 0.3)
        }
      }
      context.stroke()
    }

    context.restore()
  }

  private createAtmosphere(): void {
    this.atmosphereRoot = new THREE.Group()
    this.atmosphereRoot.name = 'atmosphere'
    this.atmosphereRoot.position.set(
      this.player.position.x,
      0,
      this.player.position.z,
    )
    this.scene.add(this.atmosphereRoot)

    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create sky texture')
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    // Four stops instead of three: zenith, upper sky, a horizon glow that carries the
    // sun colour, and the fog band the world dissolves into. The glow stop is what
    // makes the sky read as painted rather than as a flat vertical wash.
    const zenith = mix(this.palette.worldSky, this.palette.bg, 0.24)
    const horizonGlow = mix(this.palette.worldHorizon, this.palette.worldSun, 0.34)
    gradient.addColorStop(0, zenith.getStyle())
    gradient.addColorStop(0.42, this.palette.worldSky.getStyle())
    gradient.addColorStop(0.7, this.palette.worldHorizon.getStyle())
    gradient.addColorStop(0.86, horizonGlow.getStyle())
    gradient.addColorStop(1, this.palette.worldFog.getStyle())
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    // A one-value dither across the 256-pixel ramp. Without it a smooth sky bands
    // into visible stripes on a wide display, which no amount of tone mapping hides.
    const skyDither = seededRandom(4177)
    context.globalAlpha = 0.05
    for (let row = 0; row < canvas.height; row += 1) {
      context.fillStyle = skyDither() > 0.5 ? '#ffffff' : '#000000'
      context.fillRect(0, row, canvas.width, 1)
    }
    context.globalAlpha = 1
    const skyTexture = new THREE.CanvasTexture(canvas)
    skyTexture.colorSpace = THREE.SRGBColorSpace
    skyTexture.minFilter = THREE.LinearFilter
    skyTexture.magFilter = THREE.LinearFilter
    this.generatedTextures.set('sky-gradient', skyTexture)

    this.skyMaterial = new THREE.MeshBasicMaterial({
      map: skyTexture,
      color: this.dayNightKeyframes.day.skyTint,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(178, 32, 18),
      this.skyMaterial,
    )
    this.atmosphereRoot.add(sky)

    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 12),
      new THREE.MeshBasicMaterial({
        color: this.palette.worldSun,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    )
    this.sunDisc.position.set(-88, 74, -112)
    this.atmosphereRoot.add(this.sunDisc)

    this.moonDisc = new THREE.Mesh(
      new THREE.SphereGeometry(4.2, 16, 12),
      new THREE.MeshBasicMaterial({
        color: mix(this.palette.worldSun, this.palette.worldSky, 0.58),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    )
    this.atmosphereRoot.add(this.moonDisc)

    const starPositions = new Float32Array(STAR_COUNT * 3)
    const starRandom = seededRandom(1947)
    for (let index = 0; index < STAR_COUNT; index += 1) {
      const azimuth = starRandom() * TWO_PI
      const altitude = 0.12 + starRandom() * 1.25
      const radius = 158 + starRandom() * 10
      const horizontalRadius = Math.cos(altitude) * radius
      const offset = index * 3
      starPositions[offset] = Math.cos(azimuth) * horizontalRadius
      starPositions[offset + 1] = Math.sin(altitude) * radius
      starPositions[offset + 2] = Math.sin(azimuth) * horizontalRadius
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: mix(this.palette.worldSun, this.palette.worldSky, 0.35),
        size: 0.85,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    )
    this.stars.frustumCulled = false
    this.atmosphereRoot.add(this.stars)

    const random = seededRandom(731)
    const cloudGeometry = new THREE.DodecahedronGeometry(3.4, 1)
    this.cloudMaterial = new THREE.MeshBasicMaterial({
      color: mix(this.palette.worldSun, this.palette.worldHorizon, 0.6),
      transparent: true,
      opacity: BASE_CLOUD_OPACITY,
      depthWrite: false,
      fog: true,
    })
    this.cloudBaseColor.copy(this.cloudMaterial.color)
    for (let index = 0; index < 10; index += 1) {
      const group = new THREE.Group()
      for (let puff = 0; puff < 4; puff += 1) {
        const cloud = new THREE.Mesh(cloudGeometry, this.cloudMaterial)
        cloud.position.set((puff - 1.5) * 3.6, Math.sin(puff) * 1.1, (random() - 0.5) * 2.4)
        cloud.scale.set(1 + random() * 0.8, 0.45 + random() * 0.35, 0.7 + random() * 0.5)
        group.add(cloud)
      }
      group.position.set(-105 + random() * 210, 30 + random() * 18, -90 + random() * 180)
      group.userData.baseY = group.position.y
      this.clouds.push({ group, speed: 0.7 + random() * 0.75 })
      this.atmosphereRoot.add(group)
    }
  }

  private setupWeather(): void {
    const rainRandom = seededRandom(7879)
    for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
      const offset = index * 6
      const x =
        this.player.position.x +
        (rainRandom() * 2 - 1) * PRECIPITATION_HALF_WIDTH
      const y =
        PRECIPITATION_GROUND +
        rainRandom() * (PRECIPITATION_TOP - PRECIPITATION_GROUND)
      const z =
        this.player.position.z +
        (rainRandom() * 2 - 1) * PRECIPITATION_HALF_DEPTH
      this.rainPositions[offset] = x
      this.rainPositions[offset + 1] = y
      this.rainPositions[offset + 2] = z
      this.rainPositions[offset + 3] = x
      this.rainPositions[offset + 4] = y + RAIN_STREAK_LENGTH
      this.rainPositions[offset + 5] = z
    }
    const rainAttribute = new THREE.BufferAttribute(this.rainPositions, 3)
    rainAttribute.setUsage(THREE.DynamicDrawUsage)
    const rainGeometry = new THREE.BufferGeometry()
    rainGeometry.setAttribute('position', rainAttribute)
    this.rain = new THREE.LineSegments(
      rainGeometry,
      new THREE.LineBasicMaterial({
        color: mix(this.palette.worldFog, this.palette.worldSky, 0.35),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: true,
      }),
    )
    this.rain.frustumCulled = false
    this.rain.visible = false
    this.scene.add(this.rain)

    const snowRandom = seededRandom(7919)
    for (let index = 0; index < SNOW_FLAKE_COUNT; index += 1) {
      const offset = index * 3
      this.snowPositions[offset] =
        this.player.position.x +
        (snowRandom() * 2 - 1) * PRECIPITATION_HALF_WIDTH
      this.snowPositions[offset + 1] =
        PRECIPITATION_GROUND +
        snowRandom() * (PRECIPITATION_TOP - PRECIPITATION_GROUND)
      this.snowPositions[offset + 2] =
        this.player.position.z +
        (snowRandom() * 2 - 1) * PRECIPITATION_HALF_DEPTH
      this.snowDriftPhases[index] = snowRandom() * TWO_PI
    }
    const snowAttribute = new THREE.BufferAttribute(this.snowPositions, 3)
    snowAttribute.setUsage(THREE.DynamicDrawUsage)
    const snowGeometry = new THREE.BufferGeometry()
    snowGeometry.setAttribute('position', snowAttribute)
    this.snow = new THREE.Points(
      snowGeometry,
      new THREE.PointsMaterial({
        map: this.createSnowTexture(),
        color: mix(this.palette.worldSun, this.palette.worldFog, 0.42),
        size: 0.46,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        alphaTest: 0.025,
        depthWrite: false,
        fog: true,
      }),
    )
    this.snow.frustumCulled = false
    this.snow.visible = false
    this.scene.add(this.snow)

    this.lightningLight = new THREE.HemisphereLight(
      mix(this.palette.worldSun, this.palette.worldSky, 0.25),
      this.palette.worldAmbientGround,
      0,
    )
    this.scene.add(this.lightningLight)
    this.lightningCooldown = this.randomWeatherRange(
      LIGHTNING_MIN_INTERVAL,
      LIGHTNING_MAX_INTERVAL,
    )
  }

  private createSnowTexture(): THREE.CanvasTexture {
    const cached = this.generatedTextures.get('weather-snowflake')
    if (cached) return cached

    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create procedural snow texture')
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 15)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.88)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    this.generatedTextures.set('weather-snowflake', texture)
    return texture
  }

  private setWeatherTarget(kind: WeatherKind, immediate = false): void {
    this.weatherTarget = kind
    this.renderer.domElement.dataset.weather = this.weatherEnabled ? kind : 'disabled'
    if (!immediate) return
    snapWeatherMix(this.weatherWeights, kind)
  }

  private updateWeather(delta: number): void {
    // The weather the world *has* is simulation state: it tracks the biome under the
    // player whether or not it is being drawn, so switching weather off for performance
    // cannot change chronicle outcomes.
    const nextZone = this.resolveWeatherZone()
    if (nextZone !== this.weatherZone) {
      this.weatherZone = nextZone
      this.setWeatherTarget(WEATHER_BY_ZONE[nextZone])
    }
    this.updateWeatherWeights(delta)

    if (!this.weatherEnabled) {
      this.restoreWeatherVisuals()
      this.updateStylizedLighting()
      return
    }

    this.applyWeatherEnvironment()
    this.updateStylizedLighting()
    this.updatePrecipitation(delta)
    this.updateLightning(delta)
  }

  private resolveWeatherZone(): ZoneId {
    return this.zoneAtPosition(this.player.position.x, this.player.position.z)
  }

  private updateWeatherWeights(delta: number): void {
    advanceWeatherMix(this.weatherWeights, this.weatherTarget, delta)
  }

  private weightedWeatherValue(key: keyof WeatherProfile): number {
    let value = 0
    for (const kind of WEATHER_KINDS) {
      value += WEATHER_PROFILES[kind][key] * this.weatherWeights[kind]
    }
    return value
  }

  private applyWeatherEnvironment(): void {
    const skyBrightness = this.weightedWeatherValue('skyBrightness')
    const desaturation = this.weightedWeatherValue('desaturation')
    const celestialScale = this.weightedWeatherValue('celestialScale')

    this.fog.near = this.weightedWeatherValue('fogNear')
    this.fog.far = this.weightedWeatherValue('fogFar')
    this.sun.intensity *= this.weightedWeatherValue('sunScale')
    this.hemisphere.intensity *= this.weightedWeatherValue('hemisphereScale')
    this.sunDisc.material.opacity *= celestialScale
    this.moonDisc.material.opacity *= celestialScale
    this.stars.material.opacity *= celestialScale
    this.applyWeatherColor(this.backgroundColor, desaturation, skyBrightness)
    this.applyWeatherColor(this.fog.color, desaturation * 0.72, skyBrightness)
    this.applyWeatherColor(this.skyMaterial.color, desaturation * 0.5, skyBrightness)

    this.cloudMaterial.opacity = this.weightedWeatherValue('cloudOpacity')
    this.cloudMaterial.color.copy(this.cloudBaseColor)
    this.applyWeatherColor(
      this.cloudMaterial.color,
      desaturation * 0.5,
      Math.min(1, skyBrightness + 0.08),
    )
    this.wind.strength = Math.min(
      MAX_WIND_STRENGTH,
      this.weightedWeatherValue('windStrength'),
    )
  }

  /**
   * Reused across frames: this runs once per frame from the weather pass, and the
   * library only ever reads and copies out of it.
   */
  private readonly stylizedLightingRef: {
    keyIntensity: number
    rimColor: THREE.Color | undefined
    shadowTint: THREE.Color | undefined
  } = { keyIntensity: 0, rimColor: undefined, shadowTint: undefined }

  /**
   * Anchors the lighting ramp to the light rig as it actually ends up.
   *
   * This has to run *after* weather, which multiplies the sun down to 22% in rain,
   * and it has to run on the weather-disabled path too. Reading the pre-weather
   * intensity puts every surface in the lowest band the moment it starts raining;
   * skipping the call entirely leaves the ramp anchored to whatever the last storm
   * left behind. Either way the world goes black, which is exactly what happened
   * the first time round.
   */
  private updateStylizedLighting(): void {
    const reference = this.stylizedLightingRef
    reference.keyIntensity = this.sun.intensity + this.rimLight.intensity * 0.4
    reference.rimColor = this.rimLight.color
    reference.shadowTint = this.hemisphere.groundColor
    this.artLibrary.setLightingReference(reference)
    // Shadows drift towards the fog, highlights towards the sun. Only the hue is
    // taken; the post processor keeps the grade's own strength.
    this.postProcessor.setGradeTints(this.fog.color, this.sun.color)
  }

  private applyWeatherColor(
    color: THREE.Color,
    desaturation: number,
    brightness: number,
  ): void {
    const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
    this.weatherGray.setRGB(luminance, luminance, luminance)
    color.lerp(this.weatherGray, desaturation).multiplyScalar(brightness)
  }

  private restoreWeatherVisuals(): void {
    this.fog.near = WEATHER_PROFILES.clear.fogNear
    this.fog.far = WEATHER_PROFILES.clear.fogFar
    this.cloudMaterial.opacity = BASE_CLOUD_OPACITY
    this.cloudMaterial.color.copy(this.cloudBaseColor)
    this.wind.strength = DEFAULT_WIND_STRENGTH
    this.rain.visible = false
    this.rain.material.opacity = 0
    this.snow.visible = false
    this.snow.material.opacity = 0
    this.lightningLight.intensity = 0
  }

  private applyGroundWeather(): void {
    for (const [zone, surface] of this.groundSurfaces) {
      surface.material.color.copy(surface.baseColor)
      surface.material.roughness = surface.baseRoughness
      if (!this.weatherEnabled) continue

      if (zone === 'forest') {
        surface.material.color.multiplyScalar(GROUND_WET_DARKEN)
        surface.material.roughness = GROUND_WET_ROUGHNESS
      } else if (zone === 'fort') {
        surface.material.color.lerp(this.weatherFrostColor, GROUND_FROST_BLEND)
      }
    }
  }

  private updatePrecipitation(delta: number): void {
    const rainWeight = this.weatherWeights.rain
    const snowWeight = this.weatherWeights.snow
    this.rain.material.opacity = rainWeight * 0.72
    this.snow.material.opacity = snowWeight * 0.92
    this.rain.visible = rainWeight > 0.015
    this.snow.visible = snowWeight > 0.015

    if (this.rain.visible) this.updateRain(delta)
    if (this.snow.visible) this.updateSnow(delta)
  }

  private updateRain(delta: number): void {
    const wind = this.wind.direction
    const windStrength = this.wind.strength
    const centerX = this.camera.position.x
    const centerZ = this.camera.position.z
    for (let index = 0; index < RAIN_DROP_COUNT; index += 1) {
      const offset = index * 6
      let x =
        this.rainPositions[offset] +
        wind.x * RAIN_WIND_SPEED * windStrength * delta
      let y = this.rainPositions[offset + 1] - RAIN_FALL_SPEED * delta
      let z =
        this.rainPositions[offset + 2] +
        wind.y * RAIN_WIND_SPEED * windStrength * delta
      if (y < PRECIPITATION_GROUND) {
        y += PRECIPITATION_TOP - PRECIPITATION_GROUND
      }
      x = this.wrapWeatherCoordinate(
        x,
        centerX,
        PRECIPITATION_HALF_WIDTH,
      )
      z = this.wrapWeatherCoordinate(
        z,
        centerZ,
        PRECIPITATION_HALF_DEPTH,
      )
      this.rainPositions[offset] = x
      this.rainPositions[offset + 1] = y
      this.rainPositions[offset + 2] = z
      this.rainPositions[offset + 3] =
        x - wind.x * RAIN_STREAK_LENGTH * windStrength * 0.32
      this.rainPositions[offset + 4] = y + RAIN_STREAK_LENGTH
      this.rainPositions[offset + 5] =
        z - wind.y * RAIN_STREAK_LENGTH * windStrength * 0.32
    }
    const attribute = this.rain.geometry.getAttribute('position')
    attribute.needsUpdate = true
  }

  private updateSnow(delta: number): void {
    const wind = this.wind.direction
    const windStrength = this.wind.strength
    const centerX = this.camera.position.x
    const centerZ = this.camera.position.z
    for (let index = 0; index < SNOW_FLAKE_COUNT; index += 1) {
      const offset = index * 3
      const phase = this.elapsed * 1.3 + this.snowDriftPhases[index]
      let x =
        this.snowPositions[offset] +
        (wind.x * SNOW_WIND_SPEED * windStrength +
          Math.sin(phase) * SNOW_DRIFT_SPEED) *
          delta
      let y = this.snowPositions[offset + 1] - SNOW_FALL_SPEED * delta
      let z =
        this.snowPositions[offset + 2] +
        (wind.y * SNOW_WIND_SPEED * windStrength +
          Math.cos(phase * 0.83) * SNOW_DRIFT_SPEED) *
          delta
      if (y < PRECIPITATION_GROUND) {
        y += PRECIPITATION_TOP - PRECIPITATION_GROUND
      }
      x = this.wrapWeatherCoordinate(
        x,
        centerX,
        PRECIPITATION_HALF_WIDTH,
      )
      z = this.wrapWeatherCoordinate(
        z,
        centerZ,
        PRECIPITATION_HALF_DEPTH,
      )
      this.snowPositions[offset] = x
      this.snowPositions[offset + 1] = y
      this.snowPositions[offset + 2] = z
    }
    const attribute = this.snow.geometry.getAttribute('position')
    attribute.needsUpdate = true
  }

  private wrapWeatherCoordinate(
    value: number,
    center: number,
    halfExtent: number,
  ): number {
    const min = center - halfExtent
    const max = center + halfExtent
    if (value >= min && value <= max) return value
    const span = halfExtent * 2
    return min + ((((value - min) % span) + span) % span)
  }

  private updateLightning(delta: number): void {
    if (this.thunderDelay >= 0) {
      this.thunderDelay -= delta
      if (this.thunderDelay <= 0) {
        this.thunderDelay = -1
        this.playSound('thunder')
      }
    }

    const rainWeight = this.weatherWeights.rain
    if (rainWeight >= 0.72 && delta > 0) {
      this.lightningCooldown -= delta
      if (this.lightningCooldown <= 0) {
        this.lightningFlash = LIGHTNING_FLASH_DURATION
        this.thunderDelay = this.randomWeatherRange(
          THUNDER_MIN_DELAY,
          THUNDER_MAX_DELAY,
        )
        this.lightningCooldown = this.randomWeatherRange(
          LIGHTNING_MIN_INTERVAL,
          LIGHTNING_MAX_INTERVAL,
        )
      }
    }

    if (this.lightningFlash <= 0) {
      this.lightningLight.intensity = 0
      return
    }
    const progress = 1 - this.lightningFlash / LIGHTNING_FLASH_DURATION
    const pulse =
      (1 - progress) * (0.72 + Math.sin(progress * Math.PI * 6) ** 2 * 0.28)
    this.lightningLight.intensity =
      LIGHTNING_INTENSITY * pulse * Math.max(0.35, rainWeight)
    this.lightningFlash = Math.max(0, this.lightningFlash - delta)
  }

  private randomWeatherRange(min: number, max: number): number {
    return min + (max - min) * this.weatherRng()
  }

  private updateAtmosphere(delta: number): void {
    this.atmosphereRoot.position.set(
      this.player.position.x,
      0,
      this.player.position.z,
    )
    this.updateZoneTint(delta)
    for (let index = 0; index < this.clouds.length; index += 1) {
      const { group, speed } = this.clouds[index]
      group.position.x += speed * delta
      if (group.position.x > 112) group.position.x = -112
      group.position.y = Number(group.userData.baseY) + Math.sin(this.elapsed * 0.22 + index) * 0.65
    }
    for (let index = 0; index < this.flames.length; index += 1) {
      const flame = this.flames[index]
      const pulse = 1 + Math.sin(this.elapsed * 9 + index * 1.7) * 0.16
      const baseScale = Number(flame.userData.baseScale)
      flame.scale.setScalar(baseScale * pulse)
      const material = flame.material
      if (material instanceof THREE.MeshStandardMaterial) {
        const baseIntensity = this.dynamicDayNight
          ? THREE.MathUtils.lerp(0.9, 2.15, this.nightFactor)
          : 1.3
        const pulseIntensity = this.dynamicDayNight
          ? THREE.MathUtils.lerp(0.16, 0.34, this.nightFactor)
          : 0.25
        material.emissiveIntensity =
          baseIntensity + Math.sin(this.elapsed * 11 + index) * pulseIntensity
      }
    }
  }

  private updateZoneTint(delta: number): void {
    const currentZone = this.zoneAtPosition(
      this.player.position.x,
      this.player.position.z,
    )
    for (const zoneId of ZONE_ART_IDS) {
      this.zoneVisualWeights[zoneId] = zoneId === currentZone ? 1 : 0
    }
    this.zoneTintTarget.setRGB(0, 0, 0)
    let targetWeight = 0
    for (let index = 0; index < ZONE_ART_IDS.length; index += 1) {
      const zone = ZONE_ART_IDS[index]
      const weight = this.zoneVisualWeights[zone]
      const profile = this.zoneArtProfiles[zone]
      this.zoneTintTarget.r += profile.fogTint.r * weight
      this.zoneTintTarget.g += profile.fogTint.g * weight
      this.zoneTintTarget.b += profile.fogTint.b * weight
      targetWeight += profile.fogWeight * weight
    }

    if (delta <= 0) {
      this.zoneTintColor.copy(this.zoneTintTarget)
      this.zoneTintWeight = targetWeight
    } else {
      const response = 1 - Math.exp(-ZONE_TINT_DAMPING * delta)
      this.zoneTintColor.lerp(this.zoneTintTarget, response)
      this.zoneTintWeight += (targetWeight - this.zoneTintWeight) * response
    }

    this.backgroundColor.lerp(this.zoneTintColor, this.zoneTintWeight * 0.62)
    this.fog.color.lerp(this.zoneTintColor, this.zoneTintWeight)
    this.skyMaterial.color.lerp(this.zoneTintColor, this.zoneTintWeight * 0.28)
  }

  private updateDayNight(): void {
    if (!this.dynamicDayNight) {
      // Static lighting is a rendering choice only — `computeNightFactor(elapsed)` still
      // drives the chronicle, so the world keeps its nights either way.
      this.nightFactor = 0
      this.sun.position.set(
        this.player.position.x - 35,
        58,
        this.player.position.z + 24,
      )
      this.sun.target.position.set(
        this.player.position.x,
        0,
        this.player.position.z,
      )
      this.sun.color.copy(this.palette.worldSun)
      this.sun.intensity = 2.65
      this.hemisphere.color.copy(this.palette.worldSky)
      this.hemisphere.groundColor.copy(this.palette.worldAmbientGround)
      this.hemisphere.intensity = 1.65
      this.updateRimLight(this.palette.worldSky, RIM_LIGHT_BASE)
      this.backgroundColor.copy(this.palette.worldSky)
      this.fog.color.copy(this.palette.worldFog)
      this.skyMaterial.color.copy(this.dayNightKeyframes.day.skyTint)
      this.sunDisc.position.set(-88, 74, -112)
      this.sunDisc.material.color.copy(this.palette.worldSun)
      this.sunDisc.material.opacity = 1
      this.moonDisc.material.opacity = 0
      this.stars.material.opacity = 0
      for (let index = 0; index < this.torchLights.length; index += 1) {
        this.torchLights[index].intensity = 1.4
      }
      for (let index = 0; index < this.buildingWindowGlows.length; index += 1) {
        const glow = this.buildingWindowGlows[index]
        glow.material.emissiveIntensity = glow.legacyIntensity
      }
      return
    }

    const sunAngle = computeSunAngle(this.elapsed)
    const elevation = Math.sin(sunAngle)
    const orbitalX = Math.cos(sunAngle) * SUN_ARC_RADIUS
    const orbitalY = elevation * SUN_ARC_HEIGHT
    const orbitalZ = Math.sin(sunAngle) * SUN_ARC_DEPTH
    const nightToTwilight = smoothstep(-0.18, 0.08, elevation)
    const twilightToDay = smoothstep(0.08, 0.6, elevation)
    this.nightFactor = computeNightFactor(this.elapsed)

    this.sun.position.set(
      this.player.position.x + orbitalX,
      Math.max(MIN_SHADOW_LIGHT_HEIGHT, orbitalY),
      this.player.position.z + orbitalZ,
    )
    this.sun.target.position.set(
      this.player.position.x,
      0,
      this.player.position.z,
    )
    this.sunDisc.position
      .set(orbitalX, orbitalY, orbitalZ)
      .normalize()
      .multiplyScalar(CELESTIAL_DISC_DISTANCE)
    this.moonDisc.position.copy(this.sunDisc.position).multiplyScalar(-1)

    const { night, twilight, day } = this.dayNightKeyframes
    this.sun.color
      .copy(night.sun)
      .lerp(twilight.sun, nightToTwilight)
      .lerp(day.sun, twilightToDay)
    this.sun.intensity = interpolateKeyframes(
      night.sunIntensity,
      twilight.sunIntensity,
      day.sunIntensity,
      nightToTwilight,
      twilightToDay,
    )
    this.hemisphere.color
      .copy(night.hemisphereSky)
      .lerp(twilight.hemisphereSky, nightToTwilight)
      .lerp(day.hemisphereSky, twilightToDay)
    this.hemisphere.groundColor
      .copy(night.hemisphereGround)
      .lerp(twilight.hemisphereGround, nightToTwilight)
      .lerp(day.hemisphereGround, twilightToDay)
    this.hemisphere.intensity = interpolateKeyframes(
      night.hemisphereIntensity,
      twilight.hemisphereIntensity,
      day.hemisphereIntensity,
      nightToTwilight,
      twilightToDay,
    )
    this.backgroundColor
      .copy(night.sky)
      .lerp(twilight.sky, nightToTwilight)
      .lerp(day.sky, twilightToDay)
    this.updateRimLight(
      this.hemisphere.color,
      RIM_LIGHT_BASE *
        interpolateKeyframes(0.55, 1.15, 1, nightToTwilight, twilightToDay),
    )
    this.fog.color
      .copy(night.fog)
      .lerp(twilight.fog, nightToTwilight)
      .lerp(day.fog, twilightToDay)
    this.skyMaterial.color
      .copy(night.skyTint)
      .lerp(twilight.skyTint, nightToTwilight)
      .lerp(day.skyTint, twilightToDay)
    this.sunDisc.material.color.copy(this.sun.color)
    this.sunDisc.material.opacity = smoothstep(-0.18, 0.04, elevation)
    this.moonDisc.material.opacity = smoothstep(-0.18, 0.08, -elevation)
    this.stars.material.opacity = this.nightFactor * this.nightFactor * 0.88

    for (let index = 0; index < this.torchLights.length; index += 1) {
      this.torchLights[index].intensity = THREE.MathUtils.lerp(1.4, 2.6, this.nightFactor)
    }
    for (let index = 0; index < this.buildingWindowGlows.length; index += 1) {
      const glow = this.buildingWindowGlows[index]
      glow.material.emissiveIntensity = THREE.MathUtils.lerp(
        glow.legacyIntensity * 0.22,
        glow.legacyIntensity * 2.25,
        this.nightFactor,
      )
    }
  }

  /**
   * Points the back-rim at the player from the sun's opposite side.
   *
   * The ramp anchor is not set here: weather scales the sun after the day/night
   * pass, so `updateStylizedLighting()` runs later and reads the final rig.
   */
  private updateRimLight(color: THREE.Color, intensity: number): void {
    this.rimLight.color.copy(color)
    this.rimLight.intensity = intensity
    const toSunX = this.sun.position.x - this.player.position.x
    const toSunZ = this.sun.position.z - this.player.position.z
    this.rimLight.position.set(
      this.player.position.x - toSunX * 0.85,
      Math.max(14, this.sun.position.y * 0.55),
      this.player.position.z - toSunZ * 0.85,
    )
    this.rimLight.target.position.set(
      this.player.position.x,
      0,
      this.player.position.z,
    )
  }

  /**
   * Builds one person.
   *
   * The rig — every pivot and mesh name below — is load-bearing. Animation,
   * dismemberment, prosthetics, gore and the weapon trail all address it by name,
   * so the names and pivot offsets are frozen; only the shapes underneath them
   * changed. Gloves, boots and a proper blade are folded into their parent's
   * geometry rather than added as children, which keeps the draw-call count per
   * actor exactly where it was.
   *
   * Geometry is cached per shape and shared by every actor of a faction: 25 actors
   * used to mean 200 unique buffers, and now means about ten.
   */
  private createCharacter(faction: Faction, player: boolean): THREE.Group {
    const group = new THREE.Group()
    const bodyPivot = new THREE.Group()
    bodyPivot.name = 'body-pivot'
    group.add(bodyPivot)
    const torsoPivot = new THREE.Group()
    torsoPivot.name = 'torso-pivot'
    bodyPivot.add(torsoPivot)
    const headPivot = new THREE.Group()
    headPivot.name = 'head-pivot'
    bodyPivot.add(headPivot)
    const pelvisPivot = new THREE.Group()
    pelvisPivot.name = 'pelvis-pivot'
    bodyPivot.add(pelvisPivot)
    const factionMaterial = this.artLibrary.createMaterial({
      color: this.factionColor(faction),
      surface: faction === 'guard' ? 'metal' : 'cloth',
      emissive: faction === 'guard' ? this.factionColor(faction) : undefined,
      emissiveIntensity: faction === 'guard' ? 0.07 : undefined,
    })
    const skinMaterial = this.artLibrary.createMaterial({
      color: mix(this.palette.warning, this.palette.surface, 0.7),
      surface: 'skin',
    })
    const darkMaterial = this.artLibrary.createMaterial({
      color: mix(this.palette.text, this.palette.bg, 0.28),
      surface: 'dark',
    })

    const build = (key: string, factory: () => THREE.BufferGeometry) =>
      this.acquireArtGeometry(key, factory)

    const torso = new THREE.Mesh(
      build(`character-torso:${player ? 'player' : 'actor'}`, () =>
        buildCharacterTorso(player),
      ),
      factionMaterial,
    )
    torso.name = 'torso'
    torso.position.y = 1.72
    torso.castShadow = true
    torsoPivot.add(torso)

    const head = new THREE.Mesh(
      build(`character-head:${faction === 'elf' ? 'hood' : 'bare'}`, () =>
        faction === 'elf' ? buildHoodedHead() : buildCharacterHead(),
      ),
      skinMaterial,
    )
    head.name = 'head'
    head.position.y = 2.72
    head.castShadow = true
    headPivot.add(head)

    for (const [name, x] of [
      ['leftArm', -0.68],
      ['rightArm', 0.68],
    ] as const) {
      const pivot = new THREE.Group()
      pivot.name = name
      pivot.position.set(x, 2.2, 0)
      const arm = new THREE.Mesh(
        build('character-arm', () => buildCharacterArm()),
        factionMaterial,
      )
      arm.position.y = -0.52
      arm.castShadow = true
      pivot.add(arm)
      torsoPivot.add(pivot)
    }
    for (const [name, x] of [
      ['leftLeg', -0.28],
      ['rightLeg', 0.28],
    ] as const) {
      const pivot = new THREE.Group()
      pivot.name = name
      pivot.position.set(x, 1.08, 0)
      const leg = new THREE.Mesh(
        build('character-leg', () => buildCharacterLeg()),
        darkMaterial,
      )
      leg.position.y = -0.5
      leg.castShadow = true
      pivot.add(leg)
      pelvisPivot.add(pivot)
    }

    const weaponPivot = new THREE.Group()
    weaponPivot.name = 'weapon'
    weaponPivot.position.set(0.88, 1.75, 0.1)
    const blade = new THREE.Mesh(
      build('character-blade', () => buildCharacterBlade()),
      darkMaterial,
    )
    blade.position.y = -0.15
    blade.rotation.z = -0.2
    blade.castShadow = true
    weaponPivot.add(blade)
    torsoPivot.add(weaponPivot)

    if (faction === 'guard') {
      const helmet = new THREE.Mesh(
        build('character-helmet', () => buildCharacterHelmet()),
        darkMaterial,
      )
      helmet.position.y = 3.02
      helmet.castShadow = true
      headPivot.add(helmet)
      if (player) {
        const shield = new THREE.Mesh(
          build('character-shield', () => buildCharacterShield()),
          darkMaterial,
        )
        shield.name = 'shield'
        shield.position.set(-0.82, 1.85, 0.08)
        shield.rotation.z = 0.12
        shield.castShadow = true
        torsoPivot.add(shield)
      }
    } else if (faction === 'villain') {
      for (const x of [-0.28, 0.28]) {
        const horn = new THREE.Mesh(
          build('character-horn', () => buildCharacterHorn()),
          darkMaterial,
        )
        horn.position.set(x, 3.25, 0)
        horn.rotation.z = x > 0 ? -0.3 : 0.3
        horn.scale.x = x > 0 ? 1 : -1
        horn.castShadow = true
        headPivot.add(horn)
      }
    }

    if (!player) {
      const ring = new THREE.Mesh(
        build('faction-ring', () => new THREE.RingGeometry(0.72, 0.9, 24)),
        new THREE.MeshBasicMaterial({
          color: this.factionColor(faction),
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      )
      ring.name = 'faction-ring'
      ring.position.y = 0.05
      ring.rotation.x = -Math.PI / 2
      ring.renderOrder = 2
      group.add(ring)
    }

    // Real shadow maps are tight and can be switched off; a soft ink pool costs one
    // shared geometry and one shared material for the whole game and is the
    // difference between standing on the ground and hovering above it.
    const contactShadow = this.artLibrary.createContactShadow({
      radius: player ? 0.66 : 0.58,
    })
    group.add(contactShadow)

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object.name === 'faction-ring') return
        if (object.userData.noComicOutline === true) return
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    return group
  }

  /**
   * Shared, engine-owned geometry.
   *
   * Marked library-owned so neither `destroy()` nor `removeAndDisposeObject()`
   * frees a buffer that twenty other actors are still drawing from; the cache
   * releases everything exactly once at teardown.
   */
  private acquireArtGeometry(
    key: string,
    factory: () => THREE.BufferGeometry,
  ): THREE.BufferGeometry {
    return this.artGeometry.acquire(key, () => {
      const geometry = factory()
      StylizedArtLibrary.markLibraryOwned(geometry)
      return geometry
    })
  }

  private applyActorVisualVariation(
    mesh: THREE.Group,
    allegiance: Allegiance,
    role: ActorRole,
    index: number,
  ): void {
    // Deterministic by construction: a hash of the actor's index and side, never a
    // gameplay stream and never `Math.random()`.
    const variation = hashUnit(index + 1, allegiance.length * 7919 + 31) * 2 - 1
    const bodyPivot = mesh.getObjectByName('body-pivot')
    if (bodyPivot) {
      const roleWidth = role === 'brute' || role === 'champion' ? 1.05 : 1
      bodyPivot.scale.set(
        roleWidth * (1 + variation * 0.055),
        1 - variation * 0.042,
        roleWidth * (1 + variation * 0.035),
      )
    }
    const torso = mesh.getObjectByName('torso')
    if (torso instanceof THREE.Mesh && torso.material instanceof THREE.MeshStandardMaterial) {
      torso.material.color.offsetHSL(variation * 0.018, variation * 0.04, variation * 0.03)
    }
    const head = mesh.getObjectByName('head')
    if (head instanceof THREE.Mesh) {
      head.rotation.y = variation * 0.16
      head.scale.setScalar(1 + variation * 0.05)
    }
  }

  private createActorHealthBar(allegiance: Allegiance): {
    sprite: THREE.Sprite
    canvas: HTMLCanvasElement
    texture: THREE.CanvasTexture
  } {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 18
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    sprite.scale.set(1.85, 0.26, 1)
    sprite.visible = false
    sprite.renderOrder = 12

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create actor health bar')
    context.fillStyle = 'rgba(24, 24, 24, 0.82)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = this.allegianceColor(allegiance).getStyle()
    context.fillRect(3, 3, canvas.width - 6, canvas.height - 6)
    texture.needsUpdate = true
    return { sprite, canvas, texture }
  }

  private drawActorHealthBar(actor: Actor): void {
    const context = actor.healthBarCanvas.getContext('2d')
    if (!context) return
    const ratio = THREE.MathUtils.clamp(actor.hp / actor.maxHp, 0, 1)
    const innerWidth = actor.healthBarCanvas.width - 6
    context.clearRect(0, 0, actor.healthBarCanvas.width, actor.healthBarCanvas.height)
    context.fillStyle = 'rgba(24, 24, 24, 0.82)'
    context.fillRect(0, 0, actor.healthBarCanvas.width, actor.healthBarCanvas.height)
    context.fillStyle = 'rgba(255, 255, 255, 0.22)'
    context.fillRect(3, 3, innerWidth, actor.healthBarCanvas.height - 6)
    context.fillStyle = this.allegianceColor(actor.allegiance).getStyle()
    context.fillRect(3, 3, innerWidth * ratio, actor.healthBarCanvas.height - 6)
    actor.healthBarTexture.needsUpdate = true
  }

  private createCaravan(gilded = false): THREE.Group {
    const group = new THREE.Group()
    const adopt = (
      material: THREE.MeshStandardMaterial,
      surface: StylizedSurface,
    ): THREE.MeshStandardMaterial => this.artLibrary.adoptMaterial(material, { surface })
    const wood = adopt(
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          gilded ? 'rich-caravan-wood' : 'caravan-wood',
          gilded
            ? mix(this.palette.warning, this.palette.surface, 0.22)
            : mix(this.palette.warning, this.palette.bg, 0.48),
          gilded
            ? mix(this.palette.warning, this.palette.text, 0.34)
            : mix(this.palette.warning, this.palette.text, 0.55),
          { pattern: 'wood', repeatX: 4, repeatY: 3 },
        ),
        roughness: 0.92,
      }),
      'bark',
    )
    const metal = adopt(
      new THREE.MeshStandardMaterial({
        color: gilded ? this.palette.warning : this.palette.borderStrong,
        roughness: 0.55,
        metalness: gilded ? 0.76 : 0.45,
      }),
      'metal',
    )
    const build = (key: string, factory: () => THREE.BufferGeometry) =>
      this.acquireArtGeometry(key, () => bakeOutlineNormals(factory()))
    const base = new THREE.Mesh(
      build('caravan-base', () => new THREE.BoxGeometry(5, 0.65, 3.1)),
      wood,
    )
    base.position.y = 1.6
    base.castShadow = true
    group.add(base)
    const cargo = new THREE.Mesh(
      build('caravan-cargo', () => new THREE.BoxGeometry(3.6, 2.5, 2.5)),
      adopt(
        new THREE.MeshStandardMaterial({
          map: this.createSurfaceTexture(
            gilded ? 'rich-caravan-crate' : 'caravan-crate',
            gilded ? mix(this.palette.warning, this.palette.surface, 0.15) : this.palette.warning,
            mix(this.palette.warning, this.palette.text, 0.42),
            { pattern: 'wood', repeatX: 3, repeatY: 3 },
          ),
          roughness: 0.8,
          emissive: gilded ? this.palette.warning : this.palette.bg,
          emissiveIntensity: gilded ? 0.32 : 0,
        }),
        'bark',
      ),
    )
    cargo.name = 'cargo'
    cargo.position.y = 3
    cargo.castShadow = true
    group.add(cargo)
    const wheelGeometry = build('caravan-wheel', () => {
      const geometry = new THREE.CylinderGeometry(0.9, 0.9, 0.32, 12)
      geometry.rotateX(Math.PI / 2)
      return geometry
    })
    const spokeGeometry = build('caravan-spoke', () =>
      new THREE.BoxGeometry(1.45, 0.12, 0.38),
    )
    const spokeMaterial = adopt(
      new THREE.MeshStandardMaterial({
        color: mix(this.palette.warning, this.palette.borderStrong, 0.55),
        metalness: 0.22,
        roughness: 0.62,
      }),
      'metal',
    )
    for (const x of [-1.7, 1.7]) {
      for (const z of [-1.72, 1.72]) {
        const wheel = new THREE.Group()
        wheel.name = 'wheel'
        wheel.position.set(x, 1.05, z)
        const tire = new THREE.Mesh(wheelGeometry, metal)
        tire.castShadow = true
        wheel.add(tire)
        const horizontalSpoke = new THREE.Mesh(spokeGeometry, spokeMaterial)
        const verticalSpoke = new THREE.Mesh(spokeGeometry, spokeMaterial)
        verticalSpoke.rotation.z = Math.PI / 2
        wheel.add(horizontalSpoke, verticalSpoke)
        group.add(wheel)
      }
    }
    const horse = new THREE.Mesh(
      build('caravan-horse-body', () => new THREE.BoxGeometry(2.2, 1.6, 1)),
      wood,
    )
    horse.position.set(4.2, 1.9, 0)
    horse.castShadow = true
    group.add(horse)
    const horseHead = new THREE.Mesh(
      build('caravan-horse-head', () => new THREE.BoxGeometry(0.9, 1.1, 0.8)),
      wood,
    )
    horseHead.position.set(5.15, 2.7, 0)
    horseHead.castShadow = true
    group.add(horseHead)
    if (gilded) {
      const beacon = new THREE.Mesh(
        new THREE.TorusGeometry(2.4, 0.12, 8, 28),
        new THREE.MeshBasicMaterial({
          color: this.palette.warning,
          transparent: true,
          opacity: 0.62,
        }),
      )
      beacon.position.y = 0.18
      beacon.rotation.x = Math.PI / 2
      group.add(beacon)
    }
    group.position.set(-54, 0, -23)
    return group
  }

  /**
   * Layer 3 — a quadruped built from the same boxes and cones the humanoids use, with
   * the *same pivot names*. That is deliberate: `animateCharacter`, the death motion,
   * the outline pass, and the health bar all keep working with no beast branch, and the
   * stride that swings a soldier's arms swings a wolf's legs in diagonal pairs instead.
   */
  private createBeast(role: BeastRole): THREE.Group {
    const group = new THREE.Group()
    const bodyPivot = new THREE.Group()
    bodyPivot.name = 'body-pivot'
    group.add(bodyPivot)
    const torsoPivot = new THREE.Group()
    torsoPivot.name = 'torso-pivot'
    bodyPivot.add(torsoPivot)
    const headPivot = new THREE.Group()
    headPivot.name = 'head-pivot'
    bodyPivot.add(headPivot)
    const pelvisPivot = new THREE.Group()
    pelvisPivot.name = 'pelvis-pivot'
    bodyPivot.add(pelvisPivot)

    const pelt = this.beastPeltColor(role)
    const hideMaterial = this.artLibrary.createMaterial({
      color: pelt,
      surface: 'cloth',
    })
    const darkMaterial = this.artLibrary.createMaterial({
      color: mix(pelt, this.palette.bg, 0.55),
      surface: 'dark',
    })
    const boneMaterial = this.artLibrary.createMaterial({
      color: mix(this.palette.text, this.palette.surface, 0.35),
      surface: 'skin',
    })

    const bulk = role === 'wolf' ? 0.86 : role === 'boar' ? 1 : 1.2
    const backHeight = role === 'troll' ? 1.85 : role === 'bear' ? 1.5 : 1.2
    // Beast parts are shared exactly like character parts: keyed by the dimensions
    // that actually vary, so the four roles collapse onto a handful of buffers
    // instead of allocating a fresh set per spawn. Every part is outline-baked, or
    // hard-edged boxes and cones push their inverted hull apart at the seams.
    const bulkKey = bulk.toFixed(2)
    const build = (key: string, factory: () => THREE.BufferGeometry) =>
      this.acquireArtGeometry(key, () => bakeOutlineNormals(factory()))

    const torso = new THREE.Mesh(
      build(`beast-torso:${bulkKey}`, () =>
        new THREE.BoxGeometry(0.86 * bulk, 0.82 * bulk, 1.95 * bulk),
      ),
      hideMaterial,
    )
    torso.name = 'torso'
    torso.position.y = backHeight
    torsoPivot.add(torso)

    // Shoulder hump: a boar's is its silhouette, a troll's is most of its mass.
    const humpHeight = role === 'boar' ? 0.42 : role === 'troll' ? 0.62 : 0.26
    const hump = new THREE.Mesh(
      build(`beast-hump:${bulkKey}:${humpHeight.toFixed(2)}`, () =>
        new THREE.BoxGeometry(0.78 * bulk, humpHeight, 0.86 * bulk),
      ),
      hideMaterial,
    )
    hump.position.set(0, backHeight + 0.5 * bulk, 0.52 * bulk)
    torsoPivot.add(hump)

    const head = new THREE.Mesh(
      build(`beast-head:${bulkKey}`, () =>
        new THREE.BoxGeometry(0.62 * bulk, 0.58 * bulk, 0.7 * bulk),
      ),
      hideMaterial,
    )
    head.name = 'head'
    head.position.set(0, backHeight + (role === 'troll' ? 0.5 : 0.18), 1.28 * bulk)
    headPivot.add(head)

    const snoutLength = role === 'wolf' ? 0.72 : role === 'boar' ? 0.6 : 0.44
    const snout = new THREE.Mesh(
      build(`beast-snout:${bulkKey}:${snoutLength.toFixed(2)}`, () =>
        new THREE.ConeGeometry(0.24 * bulk, snoutLength, 6),
      ),
      darkMaterial,
    )
    snout.position.set(0, head.position.y - 0.08, head.position.z + 0.42 * bulk)
    snout.rotation.x = Math.PI / 2
    headPivot.add(snout)

    if (role === 'wolf') {
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(
          build('beast-ear-pointed', () => new THREE.ConeGeometry(0.13, 0.4, 5)),
          darkMaterial,
        )
        ear.position.set(side * 0.22 * bulk, head.position.y + 0.42, head.position.z - 0.1)
        ear.rotation.z = side * 0.18
        headPivot.add(ear)
      }
    } else if (role === 'bear' || role === 'troll') {
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(
          build('beast-ear-round', () => new THREE.BoxGeometry(0.2, 0.22, 0.12)),
          darkMaterial,
        )
        ear.position.set(side * 0.28 * bulk, head.position.y + 0.36, head.position.z - 0.16)
        headPivot.add(ear)
      }
    }
    if (role === 'boar' || role === 'troll') {
      for (const side of [-1, 1]) {
        const tusk = new THREE.Mesh(
          build('beast-tusk', () => new THREE.ConeGeometry(0.07, 0.42, 5)),
          boneMaterial,
        )
        tusk.position.set(
          side * 0.2 * bulk,
          head.position.y - 0.12,
          head.position.z + 0.34 * bulk,
        )
        tusk.rotation.set(-0.9, 0, side * 0.22)
        headPivot.add(tusk)
      }
    }

    // Front legs answer to `leftArm` / `rightArm`, hind legs to `leftLeg` / `rightLeg`,
    // so the shared stride pose already produces a diagonal quadruped gait.
    const legLength = backHeight - 0.32 * bulk
    const legGeometry = build(`beast-leg:${bulkKey}:${legLength.toFixed(3)}`, () =>
      new THREE.BoxGeometry(0.26 * bulk, legLength, 0.3 * bulk),
    )
    for (const [name, x, z, parent] of [
      ['leftArm', -0.32, 0.72, torsoPivot],
      ['rightArm', 0.32, 0.72, torsoPivot],
      ['leftLeg', -0.32, -0.72, pelvisPivot],
      ['rightLeg', 0.32, -0.72, pelvisPivot],
    ] as const) {
      const pivot = new THREE.Group()
      pivot.name = name
      pivot.position.set(x * bulk, backHeight - 0.3 * bulk, z * bulk)
      const leg = new THREE.Mesh(legGeometry, darkMaterial)
      leg.position.y = -legLength / 2
      pivot.add(leg)
      parent.add(pivot)
    }

    const tailLength = role === 'wolf' ? 1.05 : 0.5
    const tail = new THREE.Mesh(
      build(`beast-tail:${bulkKey}:${tailLength.toFixed(2)}`, () =>
        new THREE.ConeGeometry(0.14 * bulk, tailLength, 6),
      ),
      darkMaterial,
    )
    tail.position.set(0, backHeight + 0.18, -1.1 * bulk)
    tail.rotation.x = -1.15
    pelvisPivot.add(tail)

    const ring = new THREE.Mesh(
      this.acquireArtGeometry('faction-ring', () => new THREE.RingGeometry(0.72, 0.9, 24)),
      new THREE.MeshBasicMaterial({
        color: this.allegianceColor('beast'),
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    )
    ring.name = 'faction-ring'
    ring.position.y = 0.05
    ring.rotation.x = -Math.PI / 2
    ring.renderOrder = 2
    group.add(ring)

    // Same grounding pool the humanoids get, widened for a quadruped's footprint.
    group.add(this.artLibrary.createContactShadow({ radius: 0.78 * bulk }))

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object.name === 'faction-ring') return
        if (object.userData.noComicOutline === true) return
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    return group
  }

  private beastPeltColor(role: BeastRole): THREE.Color {
    const base = this.allegianceColor('beast')
    if (role === 'wolf') return mix(base, this.palette.borderStrong, 0.42)
    if (role === 'boar') return mix(base, this.palette.text, 0.3)
    if (role === 'bear') return mix(base, this.palette.bg, 0.22)
    return mix(base, this.palette.success, 0.32)
  }

  private spawnActor(
    allegiance: Allegiance,
    role: ActorRole,
    x: number,
    z: number,
    index: number,
    options: ActorSpawnOptions,
  ): Actor {
    this.claimActorSlot(options.budget)
    const beast = isBeastRole(role) ? BEAST_PROFILES[role] : null
    const mesh = beast
      ? this.createBeast(role as BeastRole)
      : this.createCharacter(
          isFactionAllegiance(allegiance) ? allegiance : 'guard',
          false,
        )
    if (beast) mesh.scale.setScalar(beast.scale)
    if (role === 'brute') mesh.scale.set(1.28, 1.12, 1.28)
    if (role === 'champion') {
      mesh.scale.set(1.3, 1.18, 1.3)
      const aura = new THREE.Mesh(
        new THREE.TorusGeometry(1.05, 0.12, 8, 24),
        new THREE.MeshBasicMaterial({
          color: this.palette.warning,
          transparent: true,
          opacity: 0.68,
        }),
      )
      aura.name = 'champion-aura'
      aura.position.y = 0.12
      aura.rotation.x = Math.PI / 2
      mesh.add(aura)
      const auraLight = new THREE.PointLight(this.palette.warning, 1.8, 9, 2)
      auraLight.position.y = 1.4
      mesh.add(auraLight)
    }
    if (role === 'archer') {
      mesh.scale.setScalar(0.94)
      const weapon = mesh.getObjectByName('weapon')
      if (weapon) {
        weapon.children.forEach((child) => {
          child.visible = false
        })
        const bow = new THREE.Mesh(
          new THREE.TorusGeometry(0.48, 0.045, 6, 14, Math.PI),
          this.artLibrary.createMaterial({
            color: this.palette.warning,
            surface: 'dark',
          }),
        )
        bow.rotation.x = Math.PI / 2
        bow.castShadow = true
        weapon.add(bow)
      }
    }
    if (role === 'captive') {
      mesh.scale.setScalar(0.94)
      const weapon = mesh.getObjectByName('weapon')
      if (weapon) weapon.visible = false
    }
    // §5D — a villager is smaller, unarmed and wears nobody's colours. Reusing
    // `createCharacter` with a recoloured torso is the whole art budget for the role: the
    // silhouette that matters is "not carrying a sword", and the muted `civilian` ring
    // under it already says whose side it is on.
    if (role === 'peasant') {
      mesh.scale.setScalar(0.9)
      const weapon = mesh.getObjectByName('weapon')
      if (weapon) weapon.visible = false
      const torso = mesh.getObjectByName('torso')
      if (torso instanceof THREE.Mesh && torso.material instanceof THREE.MeshStandardMaterial) {
        torso.material = this.artLibrary.createMaterial({
          color: mix(this.palette.muted, this.palette.bg, 0.28),
          surface: 'cloth',
        })
      }
    }
    this.applyActorVisualVariation(mesh, allegiance, role, index)
    const outlineBinding = this.registerOutline(mesh, 'enemy')
    mesh.position.set(x, this.groundHeightAt(x, z), z)
    this.resolveCharacterOverlaps(mesh.position, this.actorColliderRadiusForRole(role))
    mesh.position.y = this.groundHeightAt(mesh.position.x, mesh.position.z)
    this.scene.add(mesh)
    const healthBar = this.createActorHealthBar(allegiance)
    healthBar.sprite.position.set(
      mesh.position.x,
      mesh.position.y + this.actorHealthBarHeight(role) * mesh.scale.y,
      mesh.position.z,
    )
    this.scene.add(healthBar.sprite)
    const phase = index * 0.73
    const home = mesh.position.clone()
    const initialAngle = phase * 4.7
    const baseHp =
      beast?.hp ??
      (role === 'commander'
        ? 150
        : role === 'champion'
          ? 260
          : role === 'brute'
            ? 130
            : role === 'archer'
              ? 45
              : role === 'scout'
                ? 55
                : // §5D — a villager dies to two hits and is meant to. It is not a
                  // difficulty knob: a peasant with a soldier's health bar would turn
                  // every raid into a chore and make hitting one feel like a fight.
                  role === 'peasant'
                  ? 26
                  : 70)
    const hp = Math.round(
      baseHp *
        this.enemyHealthMultiplier(allegiance) *
        Math.max(0.1, options.healthScale ?? 1),
    )
    const speed =
      beast?.speed ??
      (role === 'scout'
        ? 4.8
        : role === 'champion'
          ? 4.15
          : role === 'archer'
            ? 3.2
            : role === 'brute'
              ? 2.6
              : role === 'commander'
                ? 0
                : // Slower than a soldier at a walk, faster than one in a panic — the
                  // 1.15× every routing actor gets makes a bolting villager outrun a
                  // strolling one, which is the read.
                  role === 'peasant'
                  ? 3.1
                  : 3.7)
    const actor: Actor = {
      id: options.generatedSpawnId
        ? `generated:${options.generatedSpawnId}`
        : `${allegiance}-${role}-${this.actorSequence++}`,
      allegiance,
      role,
      mesh,
      hp,
      maxHp: hp,
      speed,
      alive: true,
      attackCooldown: 0,
      home,
      wanderTarget: home
        .clone()
        .add(new THREE.Vector3(Math.sin(initialAngle) * 4.5, 0, Math.cos(initialAngle) * 4.5)),
      wanderTimer: 3.5 + (index % 4),
      targetId: null,
      stride: 0,
      phase,
      velocity: new THREE.Vector3(),
      gaitPhase: phase,
      visualSpeed: 0,
      motionBlend: 0,
      turnLean: 0,
      idleTimer: 0.2 + (index % 3) * 0.25,
      wanderPace: 0.82 + (Math.sin(phase * 2.7) + 1) * 0.08,
      retreatTimer: 0,
      reinforcementTimer: COMMANDER_REINFORCEMENT_INTERVAL,
      reinforcementsCalled: 0,
      objectiveEligible: options.objectiveEligible ?? true,
      squadEligible: options.squadEligible ?? true,
      aiMode: options.aiMode ?? 'normal',
      eventOwnerId: options.eventOwnerId ?? null,
      eventPropTargetId: options.eventPropTargetId ?? null,
      ignoredTargetId: options.ignoredTargetId ?? null,
      playerAggro: false,
      aggroMemory: 0,
      lastKnownTargetPos: null,
      rageTimer: 0,
      alertCooldown: 0,
      retaliationTimer: 0,
      healthBar: healthBar.sprite,
      healthBarCanvas: healthBar.canvas,
      healthBarTexture: healthBar.texture,
      healthBarVisibleUntil: 0,
      outlineBinding,
      outlineUntil: Number.POSITIVE_INFINITY,
      action: null,
      reaction: 'none',
      reactionRemaining: 0,
      poise: this.actorMaxPoise(role),
      maxPoise: this.actorMaxPoise(role),
      poiseRecoveryDelay: 0,
      staggerImmunity: 0,
      knockbackVelocity: new THREE.Vector3(),
      lastHitDirection: new THREE.Vector3(0, 0, 1),
      deathStyle: null,
      deathAge: 0,
      deathStartPosition: new THREE.Vector3(),
      deathStartRotation: new THREE.Euler(),
      deathTravelled: 0,
      deathAt: null,
      generatedRegionId: options.generatedRegionId ?? null,
      generatedEncounterId: options.generatedEncounterId ?? null,
      generatedSpawnId: options.generatedSpawnId ?? null,
      generatedObjectiveId: options.generatedObjectiveId ?? null,
      generatedUnique: options.generatedUnique ?? false,
      hostileToPlayer: options.hostileToPlayer ?? hostile(allegiance, this.faction),
      budgetCategory: options.budget,
      packId: options.packId ?? null,
      packKinSize: Math.max(1, options.packKinSize ?? 1),
      routTimer: 0,
      routReason: 'none',
      rallyTimer: 0,
      commanderLostTimer: 0,
      // Staggered by spawn index so a whole squad does not check morale on one frame.
      moraleTimer: (index % 7) * (MORALE_CHECK_INTERVAL / 7),
      order: null,
      alertPos: null,
      alertTimer: 0,
      alarmPos: null,
      chargeWindup: 0,
      chargeTimer: 0,
      chargeCooldown: 0,
      chargeDirection: new THREE.Vector3(0, 0, 1),
    }
    if (
      !this.isWalkablePosition(
        actor.wanderTarget.x,
        actor.wanderTarget.z,
        this.actorColliderRadiusForRole(role),
      )
    ) {
      this.chooseWanderTarget(actor)
    }
    this.actors.push(actor)
    this.updateActorOutlineVisibility(actor)
    return actor
  }

  private spawnAmbush(): void {
    const x = this.caravan.position.x
    const z = this.caravan.position.z
    const availableSlots = this.reserveActorSlotsUpTo('campaign', 2)
    const generatedOptions: ActorSpawnOptions = {
      budget: 'campaign',
      objectiveEligible: false,
      squadEligible: false,
      generatedRegionId: this.generatedRegionIdAt(x, z),
    }
    if (availableSlots >= 1) {
      this.spawnActor(
        'guard',
        'soldier',
        x - 5,
        z - 4,
        this.actors.length + 1,
        generatedOptions,
      )
    }
    if (availableSlots >= 2) {
      this.spawnActor(
        'guard',
        'soldier',
        x + 5,
        z + 4,
        this.actors.length + 2,
        generatedOptions,
      )
    }
    if (availableSlots > 0) {
      this.callbacks.onNotice('Засада! Охрана корована набигает.', 'warning')
    }
  }

  private addTrauma(amount: number): void {
    if (!this.screenShakeEnabled || this.paused || this.ended || amount <= 0) return
    this.trauma = Math.min(1, this.trauma + amount)
  }

  private queueCameraAccent(
    kind: CameraAccentKind,
    magnitude: number,
    duration: number,
  ): void {
    if (!this.screenShakeEnabled || this.reducedMotion || this.paused || this.ended) return
    enqueueCameraAccent(this.cameraAccents, kind, magnitude, duration)
  }

  private presentCameraFeedback(event: CombatFeedbackEvent): void {
    if (event.targetId === 'player' && event.weight === 'blocked') {
      this.queueCameraAccent('block', -0.8, 0.12)
      return
    }
    if (!event.directPlayerAction || !event.killed || event.targetId === 'player') return

    const distance = Math.hypot(
      event.position.x - this.player.position.x,
      event.position.z - this.player.position.z,
    )
    const strength = 1 - Math.min(1, distance / KILL_ACCENT_RANGE)
    if (strength > 0) this.queueCameraAccent('kill', -2.4 * strength, 0.2)
  }

  private updateCameraEffects(delta: number): void {
    if (!this.screenShakeEnabled || this.reducedMotion) {
      this.resetCameraMotion()
      return
    }
    this.sprintFovBlend = dampValue(
      this.sprintFovBlend,
      this.isSprinting ? 1 : 0,
      SPRINT_BLEND_DAMPING,
      delta,
    )
    this.cameraAccentOffset = advanceCameraAccents(this.cameraAccents, delta)
  }

  private resetCameraMotion(): void {
    this.trauma = 0
    this.cameraAccents.length = 0
    this.sprintFovBlend = 0
    this.cameraAccentOffset = 0
    this.isSprinting = false
    this.currentFov = CAMERA_BASE_FOV
    if (this.camera.fov === CAMERA_BASE_FOV) return
    this.camera.fov = CAMERA_BASE_FOV
    this.camera.updateProjectionMatrix()
  }

  private updateCameraFov(delta: number, immediate: boolean): void {
    if (
      immediate ||
      !this.screenShakeEnabled ||
      this.reducedMotion ||
      this.paused ||
      this.ended
    ) {
      this.resetCameraMotion()
      return
    }

    const targetFov = composeCameraFov(this.sprintFovBlend, this.cameraAccentOffset)
    this.currentFov = dampValue(this.currentFov, targetFov, CAMERA_FOV_DAMPING, delta)
    if (Math.abs(this.camera.fov - this.currentFov) < 0.01) return
    this.camera.fov = this.currentFov
    this.camera.updateProjectionMatrix()
  }

  private clearTransientCombatFeedback(): void {
    this.resetCameraMotion()
    this.damageFlash = 0
    this.hitStopRemaining = 0
    this.pendingCleaveHitStop = 0
    this.calloutCooldown = 0
    this.attackAnimation = 0
    this.activePlayerAttackKind = 'melee'
    this.damageNumberFx.forEach((entry) => this.releaseDamageNumberFx(entry))
    this.comicCalloutFx.forEach((entry) => this.releaseComicCalloutFx(entry))
    this.impactRayFx.forEach((entry) => this.releaseImpactRayFx(entry))
    this.weaponTrail.visible = false
    this.weaponTrail.material.opacity = 0
    this.releaseAllTelegraphs()
  }

  private presentCombatFeedback(
    event: CombatFeedbackEvent,
    channels: CombatFeedbackChannels = {},
  ): void {
    if (!event.applied) return
    if (channels.number ?? true) this.spawnDamageNumber(event)
    if (channels.ray ?? true) this.spawnImpactRay(event)
    if (channels.callout ?? true) this.spawnComicCallout(event)
    if (channels.hitStop ?? true) this.requestHitStop(this.hitStopForEvent(event))
    if (channels.camera ?? true) this.presentCameraFeedback(event)
    if (channels.sound ?? true) this.presentCombatAudio(event)
  }

  private presentCombatAudio(event: CombatFeedbackEvent): void {
    const intensity = THREE.MathUtils.clamp(
      event.dealt / (event.targetId === 'player' ? 24 : 36),
      0,
      1,
    )
    const variantSeed = this.stableSeed(
      `${event.targetId}:${event.attackKind}:${event.weight}`,
    )
    const impactCue: Extract<SoundCue, 'hitLight' | 'hitHeavy' | 'block'> =
      event.weight === 'blocked'
        ? 'block'
        : event.weight === 'heavy' || event.weight === 'lethal'
          ? 'hitHeavy'
          : 'hitLight'
    this.playSound(impactCue, {
      position: event.position,
      intensity,
      variantSeed,
    })
    if (!event.killed) return
    this.playSound('gore', {
      position: event.position,
      intensity,
      variantSeed: variantSeed + 1,
    })
    this.playSound('down', {
      position: event.position,
      intensity,
      variantSeed: variantSeed + 2,
    })
  }

  private presentCleaveFeedback(events: CombatFeedbackEvent[]): void {
    if (events.length === 0) return
    const heaviest = events.reduce((best, event) =>
      HIT_WEIGHT_PRIORITY[event.weight] > HIT_WEIGHT_PRIORITY[best.weight] ? event : best,
    )
    const position = events
      .reduce((centroid, event) => centroid.add(event.position), new THREE.Vector3())
      .multiplyScalar(1 / events.length)
    const direction = events.reduce(
      (average, event) => average.add(event.direction),
      new THREE.Vector3(),
    )
    if (direction.lengthSq() > 0.0001) direction.normalize()
    else direction.copy(heaviest.direction)
    const summary: CombatFeedbackEvent = {
      ...heaviest,
      dealt: events.reduce((total, event) => total + event.dealt, 0),
      killed: events.some((event) => event.killed),
      position,
      direction,
    }
    this.presentCombatFeedback(summary, {
      number: false,
      ray: false,
      hitStop: false,
      camera: false,
    })
    this.pendingCleaveHitStop = events.reduce(
      (duration, event) =>
        Math.max(duration, event.weight === 'lethal' ? HIT_STOP_LETHAL : HIT_STOP_CLEAVE),
      0,
    )
    this.requestHitStop(this.pendingCleaveHitStop)
    this.pendingCleaveHitStop = 0
  }

  private hitStopForEvent(event: CombatFeedbackEvent): number {
    if (event.targetId === 'player' && event.weight === 'blocked') return HIT_STOP_BLOCK
    if (!event.directPlayerAction) return 0
    if (event.attackKind === 'cleave') {
      return event.weight === 'lethal' ? HIT_STOP_LETHAL : HIT_STOP_CLEAVE
    }
    if (event.weight === 'lethal') return HIT_STOP_LETHAL
    if (event.weight === 'heavy') return HIT_STOP_HEAVY
    return HIT_STOP_NORMAL
  }

  private requestHitStop(seconds: number): void {
    if (seconds <= 0 || this.paused || this.ended) return
    const requested =
      !this.screenShakeEnabled || this.reducedMotion
        ? Math.min(seconds, HIT_STOP_REDUCED_MAX)
        : seconds
    this.hitStopRemaining = Math.max(this.hitStopRemaining, requested)
  }

  private updateComicHitFx(delta: number): void {
    this.calloutCooldown = Math.max(0, this.calloutCooldown - delta)
    this.updateDamageNumberFx(delta)
    this.updateComicCalloutFx(delta)
    this.updateImpactRayFx(delta)
    this.updateWeaponTrail()
  }

  private spawnDamageNumber(event: CombatFeedbackEvent): void {
    if (
      (!event.directPlayerAction && event.targetId !== 'player') ||
      (event.targetId !== 'player' &&
        event.position.distanceToSquared(this.player.position) > DAMAGE_NUMBER_DISTANCE_SQ)
    ) {
      return
    }
    const value = event.dealt > 0 ? Math.max(1, Math.round(event.dealt)) : 0
    if (value === 0) return
    const priority = HIT_WEIGHT_PRIORITY[event.weight]
    const merged = this.damageNumberFx.find(
      (entry) =>
        entry.active &&
        entry.targetId === event.targetId &&
        entry.attackKind === event.attackKind &&
        entry.mergeAge <= NUMBER_MERGE_WINDOW,
    )
    if (merged) {
      merged.value += value
      merged.mergeAge = 0
      merged.age = Math.min(merged.age, merged.lifetime * 0.3)
      if (priority > merged.priority) {
        merged.priority = priority
        merged.weight = event.weight
      }
      this.drawDamageNumber(merged, event.targetId === 'player')
      return
    }

    const entry = this.acquireDamageNumberFx(priority)
    entry.targetId = event.targetId
    entry.attackKind = event.attackKind
    entry.value = value
    entry.weight = event.weight
    entry.age = 0
    entry.mergeAge = 0
    entry.lifetime = DAMAGE_NUMBER_LIFE
    entry.active = true
    entry.priority = priority
    entry.sprite.visible = true
    entry.material.opacity = 1
    entry.sprite.position.copy(this.damageNumberSpawnPosition(event))

    const lateral = new THREE.Vector3(-event.direction.z, 0, event.direction.x)
    if (lateral.lengthSq() <= 0.0001) {
      lateral.set(Math.cos(this.cameraYaw), 0, Math.sin(this.cameraYaw))
    } else {
      lateral.normalize()
    }
    const side = this.damageNumberSequence % 2 === 0 ? -1 : 1
    const offset = 0.22 + (Math.floor(this.damageNumberSequence / 2) % 3) * 0.08
    this.damageNumberSequence += 1
    entry.sprite.position.addScaledVector(lateral, side * offset)
    entry.velocity.set(0, 0, 0)
    if (!this.reducedMotion) {
      entry.velocity.copy(event.direction).multiplyScalar(0.26)
      entry.velocity.y = 0.82
    }
    this.drawDamageNumber(entry, event.targetId === 'player')
    const [width, height] = this.damageNumberScale(entry.weight)
    entry.sprite.scale.set(width * 0.56, height * 0.56, 1)
  }

  private damageNumberSpawnPosition(event: CombatFeedbackEvent): THREE.Vector3 {
    if (event.targetId === 'player') {
      return this.player.position.clone().add(new THREE.Vector3(0, 3.18, 0))
    }
    const target = this.actors.find((actor) => actor.id === event.targetId)
    if (target) {
      return target.mesh.position
        .clone()
        .add(new THREE.Vector3(0, 3.2 * target.mesh.scale.y, 0))
    }
    return event.position.clone().add(new THREE.Vector3(0, 1.6, 0))
  }

  private acquireDamageNumberFx(priority: number): DamageNumberFx {
    const inactive = this.damageNumberFx.find((entry) => !entry.active)
    if (inactive) return inactive
    if (this.damageNumberFx.length < DAMAGE_NUMBER_MAX) {
      const entry = this.createDamageNumberFx()
      this.damageNumberFx.push(entry)
      return entry
    }
    const recycled = this.damageNumberFx.reduce((candidate, entry) => {
      if (entry.priority !== candidate.priority) {
        return entry.priority < candidate.priority ? entry : candidate
      }
      return entry.age > candidate.age ? entry : candidate
    })
    this.releaseDamageNumberFx(recycled)
    recycled.priority = priority
    return recycled
  }

  private createDamageNumberFx(): DamageNumberFx {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.visible = false
    sprite.renderOrder = 10
    this.scene.add(sprite)
    return {
      sprite,
      canvas,
      texture,
      material,
      targetId: null,
      attackKind: null,
      value: 0,
      weight: 'normal',
      age: 0,
      mergeAge: 0,
      lifetime: DAMAGE_NUMBER_LIFE,
      velocity: new THREE.Vector3(),
      active: false,
      priority: 0,
    }
  }

  private drawDamageNumber(entry: DamageNumberFx, incomingPlayerDamage: boolean): void {
    const context = entry.canvas.getContext('2d')
    if (!context) throw new Error('Comic damage-number canvas context is unavailable.')
    context.clearRect(0, 0, entry.canvas.width, entry.canvas.height)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.font = '900 82px "Segoe UI", Aptos, Calibri, sans-serif'
    context.lineWidth = 18
    context.strokeStyle = this.palette.bg.getStyle()
    context.fillStyle = this.damageNumberColor(entry.weight, incomingPlayerDamage).getStyle()
    const text = String(entry.value)
    context.strokeText(text, 128, 70)
    context.fillText(text, 128, 70)
    entry.texture.needsUpdate = true
  }

  private damageNumberColor(weight: HitWeight, incomingPlayerDamage: boolean): THREE.Color {
    if (weight === 'blocked') return this.palette.link
    if (weight === 'lethal') return this.palette.danger
    if (weight === 'heavy') return this.palette.warning
    return incomingPlayerDamage ? this.palette.danger : this.palette.text
  }

  private damageNumberScale(weight: HitWeight): readonly [number, number] {
    if (weight === 'lethal') return [2.35, 1.18]
    if (weight === 'blocked') return [2.05, 1.03]
    if (weight === 'heavy') return [2.15, 1.08]
    return [1.85, 0.93]
  }

  private updateDamageNumberFx(delta: number): void {
    for (const entry of this.damageNumberFx) {
      if (!entry.active) continue
      entry.age += delta
      entry.mergeAge += delta
      if (entry.age >= entry.lifetime) {
        this.releaseDamageNumberFx(entry)
        continue
      }
      if (!this.reducedMotion) entry.sprite.position.addScaledVector(entry.velocity, delta)
      const pop = THREE.MathUtils.clamp(entry.age / 0.08, 0, 1)
      const fade = THREE.MathUtils.clamp((entry.lifetime - entry.age) / 0.18, 0, 1)
      const settle = entry.age < 0.08 ? THREE.MathUtils.lerp(0.56, 1.08, pop) : 1
      const [width, height] = this.damageNumberScale(entry.weight)
      entry.sprite.scale.set(width * settle, height * settle, 1)
      entry.material.opacity = fade
    }
  }

  private releaseDamageNumberFx(entry: DamageNumberFx): void {
    entry.active = false
    entry.sprite.visible = false
    entry.material.opacity = 0
    entry.targetId = null
    entry.attackKind = null
    entry.value = 0
    entry.weight = 'normal'
    entry.age = 0
    entry.mergeAge = 0
    entry.priority = 0
    entry.velocity.set(0, 0, 0)
    const context = entry.canvas.getContext('2d')
    if (context) {
      context.clearRect(0, 0, entry.canvas.width, entry.canvas.height)
      entry.texture.needsUpdate = true
    }
  }

  private spawnComicCallout(event: CombatFeedbackEvent): void {
    if (
      this.calloutCooldown > 0 ||
      (!event.directPlayerAction && !(event.targetId === 'player' && event.weight === 'blocked'))
    ) {
      return
    }
    const chance =
      event.weight === 'lethal'
        ? 1
        : event.weight === 'heavy'
          ? 0.7
          : event.weight === 'blocked'
            ? 0.45
            : event.attackKind === 'melee'
              ? 0.22
              : 0
    if (Math.random() > chance) return
    const word = this.chooseComicCallout(event)
    const priority = HIT_WEIGHT_PRIORITY[event.weight]
    const entry = this.acquireComicCalloutFx(priority)
    entry.word = word
    entry.age = 0
    entry.lifetime = CALLOUT_LIFE
    entry.active = true
    entry.priority = priority
    entry.material.map = this.getComicCalloutTexture(word)
    entry.material.opacity = 1
    entry.material.needsUpdate = true
    entry.sprite.visible = true
    entry.sprite.position.copy(event.position)
    entry.sprite.position.y += 0.34
    entry.material.rotation = (Math.random() - 0.5) * 0.22
    entry.velocity.set(0, 0, 0)
    if (!this.reducedMotion) entry.velocity.set(0, 0.48, 0)
    const scale = 1.72 + priority * 0.18
    entry.sprite.scale.set(scale * 0.62, scale * 0.47, 1)
    this.calloutCooldown = CALLOUT_COOLDOWN
  }

  private chooseComicCallout(event: CombatFeedbackEvent): ComicCallout {
    if (event.weight === 'blocked') return 'БЛОК!'
    const candidates: readonly ComicCallout[] =
      event.attackKind === 'cleave'
        ? ['ХРЯСЬ!', 'БУМ!']
        : event.attackKind === 'arrow' || event.attackKind === 'actorArrow'
          ? ['БАЦ!', 'БУМ!']
          : event.weight === 'lethal'
            ? ['ХРЯСЬ!', 'БУМ!']
            : ['БАЦ!', 'ХРЯСЬ!']
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  private acquireComicCalloutFx(priority: number): ComicCalloutFx {
    const inactive = this.comicCalloutFx.find((entry) => !entry.active)
    if (inactive) return inactive
    if (this.comicCalloutFx.length < CALLOUT_MAX) {
      const entry = this.createComicCalloutFx()
      this.comicCalloutFx.push(entry)
      return entry
    }
    const recycled = this.comicCalloutFx.reduce((candidate, entry) => {
      if (entry.priority !== candidate.priority) {
        return entry.priority < candidate.priority ? entry : candidate
      }
      return entry.age > candidate.age ? entry : candidate
    })
    this.releaseComicCalloutFx(recycled)
    recycled.priority = priority
    return recycled
  }

  private createComicCalloutFx(): ComicCalloutFx {
    const material = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.visible = false
    sprite.renderOrder = 11
    this.scene.add(sprite)
    return {
      sprite,
      material,
      word: null,
      age: 0,
      lifetime: CALLOUT_LIFE,
      velocity: new THREE.Vector3(),
      active: false,
      priority: 0,
    }
  }

  private getComicCalloutTexture(word: ComicCallout): THREE.CanvasTexture {
    const key = `comic-callout-${word}`
    const cached = this.generatedTextures.get(key)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 192
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Comic callout canvas context is unavailable.')
    const style = COMIC_CALLOUTS[word]
    const fill =
      word === 'БЛОК!'
        ? this.palette.link
        : word === 'ХРЯСЬ!'
          ? this.palette.danger
          : word === 'БУМ!'
            ? this.palette.accent
            : this.palette.warning
    context.save()
    context.translate(128, 96)
    context.beginPath()
    for (let index = 0; index < style.points * 2; index += 1) {
      const angle = style.rotation + (index * Math.PI) / style.points
      const radius = index % 2 === 0 ? 86 : 86 * style.innerRadius
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius * (word === 'БЛОК!' ? 0.72 : 0.88)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.closePath()
    context.lineJoin = 'round'
    context.lineWidth = 12
    context.strokeStyle = this.palette.bg.getStyle()
    context.fillStyle = fill.getStyle()
    context.stroke()
    context.fill()
    context.restore()
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.font = `900 ${word === 'ХРЯСЬ!' ? 44 : 52}px "Segoe UI", Aptos, Calibri, sans-serif`
    context.lineWidth = 11
    context.strokeStyle = this.palette.bg.getStyle()
    context.fillStyle = this.palette.accentFg.getStyle()
    context.strokeText(word, 128, 98)
    context.fillText(word, 128, 98)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    this.generatedTextures.set(key, texture)
    return texture
  }

  private updateComicCalloutFx(delta: number): void {
    for (const entry of this.comicCalloutFx) {
      if (!entry.active) continue
      entry.age += delta
      if (entry.age >= entry.lifetime) {
        this.releaseComicCalloutFx(entry)
        continue
      }
      if (!this.reducedMotion) entry.sprite.position.addScaledVector(entry.velocity, delta)
      const progress = entry.age / entry.lifetime
      const pop = THREE.MathUtils.clamp(entry.age / 0.07, 0, 1)
      const fade = THREE.MathUtils.clamp((1 - progress) / 0.32, 0, 1)
      const scale = (1.72 + entry.priority * 0.18) * THREE.MathUtils.lerp(0.62, 1, pop)
      entry.sprite.scale.set(scale, scale * 0.75, 1)
      entry.material.opacity = fade
    }
  }

  private releaseComicCalloutFx(entry: ComicCalloutFx): void {
    entry.active = false
    entry.sprite.visible = false
    entry.material.opacity = 0
    entry.word = null
    entry.age = 0
    entry.priority = 0
    entry.velocity.set(0, 0, 0)
  }

  private spawnImpactRay(event: CombatFeedbackEvent): void {
    if (!event.directPlayerAction && event.targetId !== 'player') return
    const priority = HIT_WEIGHT_PRIORITY[event.weight]
    const entry = this.acquireImpactRayFx(priority)
    if (!entry) return
    entry.age = 0
    entry.lifetime = IMPACT_RAY_LIFE
    entry.active = true
    entry.priority = priority
    entry.weight = event.weight
    entry.sprite.visible = true
    entry.sprite.position.copy(event.position)
    entry.sprite.scale.setScalar(0.4)
    entry.material.opacity = 1
    entry.material.rotation = Math.random() * Math.PI
    entry.material.color.copy(this.impactRayColor(event.weight))
  }

  private acquireImpactRayFx(priority: number): ImpactRayFx | null {
    const inactive = this.impactRayFx.find((entry) => !entry.active)
    if (inactive) return inactive
    if (this.impactRayFx.length < IMPACT_RAY_MAX) {
      const entry = this.createImpactRayFx()
      this.impactRayFx.push(entry)
      return entry
    }
    if (priority < HIT_WEIGHT_PRIORITY.heavy) return null
    const recycled = this.impactRayFx
      .filter((entry) => entry.priority === HIT_WEIGHT_PRIORITY.normal)
      .sort((left, right) => right.age - left.age)[0]
    if (!recycled) return null
    this.releaseImpactRayFx(recycled)
    return recycled
  }

  private createImpactRayFx(): ImpactRayFx {
    const material = new THREE.SpriteMaterial({
      map: this.getImpactRayTexture(),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.visible = false
    sprite.renderOrder = 9
    this.scene.add(sprite)
    return {
      sprite,
      material,
      age: 0,
      lifetime: IMPACT_RAY_LIFE,
      active: false,
      priority: 0,
      weight: 'normal',
    }
  }

  private getImpactRayTexture(): THREE.CanvasTexture {
    const key = 'comic-impact-rays'
    const cached = this.generatedTextures.get(key)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Comic impact-ray canvas context is unavailable.')
    context.translate(64, 64)
    context.lineCap = 'round'
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2
      const inner = index % 2 === 0 ? 17 : 24
      const outer = index % 3 === 0 ? 57 : 48
      context.beginPath()
      context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
      context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
      context.lineWidth = index % 2 === 0 ? 5 : 3
      context.strokeStyle = '#ffffff'
      context.stroke()
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    this.generatedTextures.set(key, texture)
    return texture
  }

  private impactRayColor(weight: HitWeight): THREE.Color {
    if (weight === 'blocked') return this.palette.link
    if (weight === 'lethal') return this.palette.danger
    if (weight === 'heavy') return this.palette.warning
    return this.palette.text
  }

  private updateImpactRayFx(delta: number): void {
    for (const entry of this.impactRayFx) {
      if (!entry.active) continue
      entry.age += delta
      if (entry.age >= entry.lifetime) {
        this.releaseImpactRayFx(entry)
        continue
      }
      const progress = entry.age / entry.lifetime
      entry.sprite.scale.setScalar(THREE.MathUtils.lerp(0.4, 1.8, progress))
      entry.material.opacity = 1 - progress
    }
  }

  private releaseImpactRayFx(entry: ImpactRayFx): void {
    entry.active = false
    entry.sprite.visible = false
    entry.material.opacity = 0
    entry.age = 0
    entry.priority = 0
    entry.weight = 'normal'
  }

  private createWeaponTrail(): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
    const innerRadius = 0.42
    const outerRadius = 1.08
    const geometry = new THREE.RingGeometry(
      innerRadius,
      outerRadius,
      28,
      1,
      -Math.PI * 0.42,
      Math.PI * 0.94,
    )
    const positions = geometry.getAttribute('position')
    const colors: number[] = []
    const pale = this.palette.text.clone().lerp(this.palette.accentFg, 0.35)
    const edge = this.factionColor(this.faction).clone().lerp(this.palette.text, 0.18)
    for (let index = 0; index < positions.count; index += 1) {
      const radius = Math.hypot(positions.getX(index), positions.getY(index))
      const blend = THREE.MathUtils.clamp(
        (radius - innerRadius) / (outerRadius - innerRadius),
        0,
        1,
      )
      const color = pale.clone().lerp(edge, blend)
      colors.push(color.r, color.g, color.b)
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    })
    const trail = new THREE.Mesh(geometry, material)
    trail.name = 'weapon-trail'
    trail.position.set(0, -0.18, 0.04)
    trail.rotation.z = -0.72
    trail.visible = false
    trail.castShadow = false
    trail.receiveShadow = false
    trail.renderOrder = 7
    trail.userData.noComicOutline = true
    return trail
  }

  private updateWeaponTrail(): void {
    if (
      this.activePlayerAttackKind === 'arrow' ||
      this.attackAnimation <= 0.1 ||
      this.attackAnimation >= 0.96
    ) {
      this.weaponTrail.visible = false
      this.weaponTrail.material.opacity = 0
      return
    }
    const progress = THREE.MathUtils.clamp((0.96 - this.attackAnimation) / 0.86, 0, 1)
    const envelope = Math.sin(progress * Math.PI)
    const cleaveScale = this.activePlayerAttackKind === 'cleave' ? 1.36 : 1
    this.weaponTrail.visible = envelope > 0.02
    this.weaponTrail.material.opacity = envelope * 0.72
    this.weaponTrail.scale.set(
      cleaveScale * (0.82 + progress * 0.3),
      cleaveScale * (0.76 + progress * 0.22),
      1,
    )
    this.weaponTrail.rotation.z = -0.82 + progress * 0.42
  }

  private createSparks(
    position: THREE.Vector3,
    incomingDirection: THREE.Vector3,
    count: number,
  ): void {
    const available = Math.min(count, SPARK_MAX_ACTIVE - this.activeSparks)
    if (available <= 0) return

    const outward = incomingDirection.clone()
    outward.y = 0
    if (outward.lengthSq() <= 0.0001) outward.set(0, 0, 1)
    else outward.normalize()
    const tangent = new THREE.Vector3(-outward.z, 0, outward.x)

    for (let index = 0; index < available; index += 1) {
      const color =
        index % 3 === 0 ? new THREE.Color(0xffffff) : this.palette.warning.clone()
      color.multiplyScalar(1.35)
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.055, 0),
        new THREE.MeshBasicMaterial({ color }),
      )
      mesh.position
        .copy(position)
        .addScaledVector(tangent, (Math.random() - 0.5) * 0.3)
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        velocity: outward
          .clone()
          .multiplyScalar(1.5 + Math.random() * 3)
          .addScaledVector(tangent, (Math.random() - 0.5) * 8)
          .setY(4 + Math.random() * 5),
        life: SPARK_LIFE,
        mode: 'spark',
      })
      this.activeSparks += 1
    }
  }

  private acquireGoreParticle(): Particle | null {
    const pooled = this.inactiveGoreParticles.pop()
    if (pooled) return pooled
    if (this.activeGore >= GORE_MAX_ACTIVE) return null

    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: GORE_COLORS[0], toneMapped: false }),
    )
    mesh.visible = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    this.scene.add(mesh)
    return {
      mesh,
      velocity: new THREE.Vector3(),
      life: 0,
      initialLife: 0,
      baseScale: new THREE.Vector3(1, 1, 1),
      pooled: true,
      mode: 'blood',
    }
  }

  private createBloodBurst(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    count: number,
    force: number,
    chunkCount = 0,
  ): void {
    const available = Math.min(count, GORE_MAX_ACTIVE - this.activeGore)
    if (available <= 0) return

    const outward = direction.clone()
    outward.y = 0
    if (outward.lengthSq() <= 0.0001) {
      outward.set(Math.random() - 0.5, 0, Math.random() - 0.5)
    }
    outward.normalize()
    const tangent = new THREE.Vector3(-outward.z, 0, outward.x)

    for (let index = 0; index < available; index += 1) {
      const particle = this.acquireGoreParticle()
      if (!particle) break
      const isChunk = index < chunkCount
      const radius = isChunk ? 0.14 + Math.random() * 0.15 : 0.045 + Math.random() * 0.07
      const verticalScale = isChunk ? radius : radius * (1.65 + Math.random() * 1.4)
      particle.mode = isChunk ? 'gib' : 'blood'
      particle.mesh.visible = true
      particle.mesh.position
        .copy(position)
        .addScaledVector(tangent, (Math.random() - 0.5) * 0.52)
        .add(new THREE.Vector3(0, (Math.random() - 0.5) * 0.28, 0))
      particle.mesh.rotation.set(
        Math.random() * TWO_PI,
        Math.random() * TWO_PI,
        Math.random() * TWO_PI,
      )
      particle.baseScale ??= new THREE.Vector3()
      particle.baseScale.set(radius, verticalScale, radius)
      particle.mesh.scale.copy(particle.baseScale)
      const material = particle.mesh.material
      if (material instanceof THREE.MeshBasicMaterial) {
        material.color.setHex(GORE_COLORS[index % GORE_COLORS.length])
      }
      particle.velocity
        .copy(outward)
        .multiplyScalar(force * (0.85 + Math.random() * 1.45))
        .addScaledVector(tangent, (Math.random() - 0.5) * force * 2.4)
      particle.velocity.x += (Math.random() - 0.5) * force * 0.7
      particle.velocity.y = force * (1.15 + Math.random() * (isChunk ? 1.8 : 2.8))
      particle.velocity.z += (Math.random() - 0.5) * force * 0.7
      const life = (isChunk ? 1.35 : 0.95) + Math.random() * (isChunk ? 0.75 : 0.85)
      particle.life = life
      particle.initialLife = life
      particle.splatScale =
        isChunk || index % 3 === 0
          ? (isChunk ? 0.42 : 0.16) + Math.random() * (isChunk ? 0.38 : 0.2)
          : undefined
      this.particles.push(particle)
      this.activeGore += 1
    }
  }

  private createDecal(): Decal {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 1,
      depthWrite: false,
      alphaTest: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    mesh.visible = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    this.scene.add(mesh)
    const decal: Decal = {
      mesh,
      age: 0,
      lifetime: 0,
      serial: 0,
      active: false,
    }
    this.decals.push(decal)
    return decal
  }

  private spawnDecal(position: THREE.Vector3, kind: DecalKind, scale = 1): void {
    let decal = this.decals.find((candidate) => !candidate.active)
    if (!decal) {
      decal =
        this.decals.length < DECAL_MAX
          ? this.createDecal()
          : this.decals.reduce((oldest, candidate) =>
              candidate.serial < oldest.serial ? candidate : oldest,
            )
    }

    const texture = this.createDecalTexture(kind)
    if (decal.mesh.material.map !== texture) {
      decal.mesh.material.map = texture
      decal.mesh.material.needsUpdate = true
    }
    decal.mesh.material.opacity = 1
    decal.mesh.position.set(
      position.x,
      this.groundHeightAt(position.x, position.z) + DECAL_Y,
      position.z,
    )
    decal.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * TWO_PI)
    decal.mesh.scale.set(
      scale * (0.82 + Math.random() * 0.36),
      scale * (0.82 + Math.random() * 0.36),
      1,
    )
    decal.mesh.visible = true
    decal.age = 0
    decal.lifetime = kind === 'blood' ? BLOOD_DECAL_LIFE : SCORCH_DECAL_LIFE
    decal.serial = ++this.decalSequence
    decal.active = true
  }

  private updateDecals(delta: number): void {
    for (const decal of this.decals) {
      if (!decal.active) continue
      decal.age += delta
      const remaining = decal.lifetime - decal.age
      if (remaining <= 0) {
        decal.active = false
        decal.mesh.visible = false
        continue
      }
      decal.mesh.material.opacity =
        remaining < DECAL_FADE ? THREE.MathUtils.clamp(remaining / DECAL_FADE, 0, 1) : 1
    }
  }

  private createHitParticles(position: THREE.Vector3, allegiance: Allegiance): void {
    for (let index = 0; index < 7; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12, 0),
        new THREE.MeshBasicMaterial({ color: this.allegianceColor(allegiance) }),
      )
      mesh.position.copy(position).add(new THREE.Vector3(0, 1.6, 0))
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4),
        life: 0.55 + Math.random() * 0.35,
      })
    }
  }

  private createBleedParticle(): void {
    this.createBloodBurst(
      this.player.position.clone().add(new THREE.Vector3(0, 0.95, 0)),
      new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5),
      3,
      0.55,
    )
  }

  private animateCharacter(group: THREE.Group, pose: CharacterPose): void {
    const leftArm = group.getObjectByName('leftArm')
    const rightArm = group.getObjectByName('rightArm')
    const leftLeg = group.getObjectByName('leftLeg')
    const rightLeg = group.getObjectByName('rightLeg')
    const weapon = group.getObjectByName('weapon')
    if (leftArm) {
      leftArm.rotation.set(
        -pose.stride * 0.7 + pose.flinch * 0.3 + pose.stagger * 0.62,
        0,
        -pose.flinch * 0.18 - pose.stagger * 0.42,
      )
    }
    if (rightArm) {
      rightArm.rotation.set(
        pose.stride * 0.7 -
          pose.attack * 1.15 +
          pose.anticipation * 0.86 -
          pose.recovery * 0.2 -
          pose.flinch * 0.3 +
          pose.stagger * 0.62,
        0,
        pose.flinch * 0.18 + pose.stagger * 0.42,
      )
    }
    if (leftLeg) leftLeg.rotation.set(pose.stride, 0, 0)
    if (rightLeg) rightLeg.rotation.set(-pose.stride, 0, 0)
    if (weapon) {
      weapon.rotation.set(
        pose.anticipation * 0.82 - pose.attack * 1.3 + pose.recovery * 0.25,
        0,
        0,
      )
    }
  }

  private actorGaitCadence(role: ActorRole): number {
    if (isBeastRole(role)) return role === 'wolf' ? 9.6 : role === 'boar' ? 8.8 : 5.2
    if (role === 'scout') return 8.4
    if (role === 'brute' || role === 'champion') return 5.8
    if (role === 'archer') return 7.2
    return 6.8
  }

  private animateActorCharacter(actor: Actor, delta: number, lookYaw: number): void {
    const pose = this.sampleActorPose(actor)
    this.animateCharacter(actor.mesh, pose)
    const bodyPivot = actor.mesh.getObjectByName('body-pivot')
    const torsoPivot = actor.mesh.getObjectByName('torso-pivot')
    const pelvisPivot = actor.mesh.getObjectByName('pelvis-pivot')
    const headPivot = actor.mesh.getObjectByName('head-pivot')
    const leftArm = actor.mesh.getObjectByName('leftArm')
    const rightArm = actor.mesh.getObjectByName('rightArm')
    const weapon = actor.mesh.getObjectByName('weapon')
    const breathing = Math.sin(this.elapsed * 1.75 + actor.phase) * 0.018
    const idleWeightShift =
      Math.sin(this.elapsed * 0.7 + actor.phase * 1.9) * 0.035 * (1 - actor.motionBlend)
    const stepBob =
      Math.abs(Math.sin(actor.gaitPhase)) *
      0.065 *
      THREE.MathUtils.clamp(actor.motionBlend, 0, 1)
    const heavy = actor.role === 'brute' || actor.role === 'champion'
    const hitRight = new THREE.Vector3(
      Math.cos(actor.mesh.rotation.y),
      0,
      -Math.sin(actor.mesh.rotation.y),
    ).dot(actor.lastHitDirection)
    const forwardLean =
      actor.role === 'scout'
        ? 0.075
        : heavy
          ? 0.055
          : actor.role === 'archer'
            ? 0.025
            : 0.04

    if (bodyPivot) bodyPivot.position.y = breathing + stepBob
    if (torsoPivot) {
      torsoPivot.position.x = idleWeightShift
      torsoPivot.rotation.x =
        forwardLean * actor.motionBlend -
        pose.anticipation * (heavy ? 0.11 : 0.16) +
        pose.attack * 0.12 +
        pose.stagger * 0.2 +
        // §5D — shoulders up against the weather. Cosmetic only, but it is driven by the
        // simulation's storm factor so it reads the same whether or not precipitation is
        // being drawn. Beasts are excluded: the pivot bends a biped's spine, and bending
        // a quadruped's back at the shoulders makes it look broken rather than cold.
        (isBeastRole(actor.role) ? 0 : this.ambientStormHunch)
      torsoPivot.rotation.y =
        -actor.stride * (heavy ? 0.08 : 0.12) +
        pose.attack * 0.16 -
        pose.flinch * hitRight * 0.22
      torsoPivot.rotation.z =
        -actor.turnLean * 0.16 +
        idleWeightShift * 0.55 -
        pose.flinch * hitRight * 0.18
      torsoPivot.scale.y = 1 + breathing * 0.55
    }
    if (pelvisPivot) {
      pelvisPivot.rotation.y = actor.stride * (heavy ? 0.06 : 0.1)
      pelvisPivot.rotation.z = actor.turnLean * 0.08 - idleWeightShift * 0.3
    }
    if (headPivot) {
      headPivot.rotation.y = dampAngle(headPivot.rotation.y, lookYaw, 7, delta)
      headPivot.rotation.x =
        -forwardLean * actor.motionBlend * 0.35 + pose.stagger * 0.18
      headPivot.rotation.z =
        actor.turnLean * 0.06 -
        idleWeightShift * 0.2 -
        pose.flinch * hitRight * 0.3
    }

    if (actor.role === 'archer') {
      const draw = Math.max(pose.anticipation, pose.attack * 0.8)
      if (leftArm) leftArm.rotation.x = -0.45 - draw * 0.62 - actor.stride * 0.15
      if (rightArm) {
        rightArm.rotation.x = -0.72 - draw * 0.85 + actor.stride * 0.1
        rightArm.rotation.z = -draw * 0.18
      }
      if (weapon) {
        weapon.rotation.x = -0.2 - draw * 0.72
        weapon.rotation.z = 0.18 + draw * 0.16
      }
    } else if (rightArm) {
      rightArm.rotation.z -= pose.attack * 0.16
    }
  }

  private sampleActorPose(actor: Actor): CharacterPose {
    let attack = 0
    let anticipation = 0
    let recovery = 0
    if (actor.action) {
      const progress = THREE.MathUtils.clamp(
        actor.action.elapsed / actor.action.duration,
        0,
        1,
      )
      if (actor.action.phase === 'windup') {
        anticipation = 1 - (1 - progress) * (1 - progress)
      } else {
        attack = 1 - progress
        recovery = Math.sin(progress * Math.PI)
      }
    }
    return {
      stride: actor.reaction === 'stagger' ? 0 : actor.stride,
      attack,
      anticipation,
      recovery,
      flinch:
        actor.reaction === 'flinch'
          ? THREE.MathUtils.clamp(actor.reactionRemaining / FLINCH_TIME, 0, 1)
          : 0,
      stagger:
        actor.reaction === 'stagger'
          ? THREE.MathUtils.clamp(
              actor.reactionRemaining / this.actorStaggerDuration(actor.role),
              0,
              1,
            )
          : 0,
    }
  }

  private updateChampionAura(actor: Actor): void {
    if (actor.role !== 'champion') return
    const aura = actor.mesh.getObjectByName('champion-aura')
    if (!aura) return
    const windupPulse =
      actor.action?.phase === 'windup'
        ? 0.22 * THREE.MathUtils.clamp(actor.action.elapsed / actor.action.duration, 0, 1)
        : 0
    const pulse = 1 + Math.sin(this.elapsed * 5 + actor.phase) * 0.12 + windupPulse
    aura.scale.setScalar(pulse)
  }

  private updateCamera(delta: number, immediate: boolean): void {
    const forward = new THREE.Vector3(Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw))
    const target = this.player.position.clone().add(new THREE.Vector3(0, 1.65, 0))
    const desired = target
      .clone()
      .addScaledVector(forward, -10)
      .add(new THREE.Vector3(0, 5.2 + this.cameraPitch * 3.5, 0))
    const resolved = this.resolveCameraPosition(target, desired)
    if (immediate) this.cameraFollowPosition.copy(resolved)
    else this.cameraFollowPosition.lerp(resolved, dampingAlpha(CAMERA_FOLLOW_DAMPING, delta))

    let cameraPosition = this.cameraFollowPosition
    let roll = 0
    if (
      this.screenShakeEnabled &&
      this.trauma > 0 &&
      !this.paused &&
      !this.ended
    ) {
      const phase = this.shakeClock * SHAKE_FREQUENCY
      const magnitude = this.trauma * this.trauma
      const noiseX = Math.sin(phase) * Math.sin(phase * 0.47 + 1.8)
      const noiseY = Math.sin(phase * 1.31 + 0.7) * Math.sin(phase * 0.61 + 2.4)
      const noiseRoll = Math.sin(phase * 0.83 + 2.1) * Math.sin(phase * 0.37 + 0.4)
      const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, Math.sin(this.cameraYaw))
      const shakenCandidate = this.cameraFollowPosition
        .clone()
        .addScaledVector(right, noiseX * SHAKE_POSITION * magnitude)
      shakenCandidate.y += noiseY * SHAKE_POSITION * 0.65 * magnitude
      cameraPosition = this.resolveCameraPosition(target, shakenCandidate)
      roll = noiseRoll * SHAKE_ROLL * magnitude
    }

    this.camera.position.copy(cameraPosition)
    this.camera.lookAt(target)
    if (roll !== 0) this.camera.rotateZ(roll)
    this.updateCameraFov(delta, immediate)
    this.updatePlayerOutlineVisibility()
    this.updateFoliageOcclusion(target, this.camera.position, immediate)
  }

  private resolveCameraPosition(target: THREE.Vector3, desired: THREE.Vector3): THREE.Vector3 {
    const offset = desired.clone().sub(target)
    const distance = offset.length()
    if (distance <= 0.001) return desired

    const direction = offset.multiplyScalar(1 / distance)
    this.cameraRaycaster.set(target, direction)
    this.cameraRaycaster.camera = this.camera
    this.cameraRaycaster.near = 0.45
    this.cameraRaycaster.far = distance
    const collision = this.cameraRaycaster
      .intersectObjects(this.cameraObstacles, false)
      .find(({ object }) => this.blocksCamera(object))
    if (!collision) return desired

    return target
      .clone()
      .addScaledVector(direction, Math.max(2.2, collision.distance - 1.15))
  }

  private collectCameraObstacles(roots: THREE.Object3D[]): void {
    for (const root of roots) {
      root.traverse((object) => {
        if (this.blocksCamera(object)) this.cameraObstacles.push(object)
      })
    }
  }

  private blocksCamera(object: THREE.Object3D): boolean {
    if (
      !(object instanceof THREE.Mesh) ||
      object instanceof THREE.InstancedMesh ||
      StylizedArtLibrary.isOutlineShell(object) ||
      object.userData.cameraPassThrough === true ||
      object.geometry instanceof THREE.PlaneGeometry
    ) {
      return false
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    return materials.some((material) => !material.transparent || material.opacity >= 0.65)
  }

  private updateFoliageOcclusion(
    target: THREE.Vector3,
    cameraPosition: THREE.Vector3,
    immediate: boolean,
  ): void {
    const segment = cameraPosition.clone().sub(target)
    const segmentLengthSquared = segment.lengthSq()
    if (segmentLengthSquared <= 0.001) return

    for (const occluder of this.foliageOccluders) {
      const center = occluder.root.position.clone()
      center.y += occluder.centerY
      const alongSegment = THREE.MathUtils.clamp(
        center.clone().sub(target).dot(segment) / segmentLengthSquared,
        0,
        1,
      )
      const closestPoint = target.clone().addScaledVector(segment, alongSegment)
      const blocksView =
        alongSegment > 0.06 && center.distanceTo(closestPoint) < occluder.radius
      const targetOpacity = blocksView ? 0 : 1
      if (!blocksView) occluder.material.visible = true
      occluder.material.opacity = immediate
        ? targetOpacity
        : THREE.MathUtils.lerp(occluder.material.opacity, targetOpacity, 0.18)
      occluder.material.depthWrite = occluder.material.opacity > 0.96
      if (blocksView && occluder.material.opacity < 0.02) occluder.material.visible = false
    }
  }

  private factionColor(faction: Faction): THREE.Color {
    if (faction === 'elf') return this.palette.success
    if (faction === 'guard') return this.palette.link
    return this.palette.accent
  }

  /**
   * §5.3 — brand colour by allegiance, so a wolf never wears a faction's livery on the
   * minimap, in its ring, or in the sparks it throws off when hit.
   */
  private allegianceColor(allegiance: Allegiance): THREE.Color {
    if (allegiance === 'beast') return mix(this.palette.warning, this.palette.bg, 0.42)
    if (allegiance === 'civilian') return this.palette.muted
    return this.factionColor(allegiance)
  }

  /** How the player's own side regards this actor, straight out of the matrix. */
  private playerRelationTo(actor: Actor): ReturnType<typeof allegianceRelation> {
    return allegianceRelation(this.faction, actor.allegiance)
  }

  private zoneName(zone: ZoneId): string {
    const names: Record<ZoneId, string> = {
      neutral: 'Вольные земли',
      palace: 'Имперский удел',
      forest: 'Чаща Эленвуда',
      fort: 'Чёрный кряж',
    }
    return names[zone]
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
    this.postProcessor.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.paused && !this.ended) this.resumeAudio()
    if (
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
        event.code,
      )
    ) {
      event.preventDefault()
    }
    if (event.repeat && ['KeyE', 'KeyQ', 'KeyP', 'KeyF', 'KeyR'].includes(event.code)) return
    this.keys.add(event.code)
    if (event.code === 'KeyE') this.interact()
    if (event.code === 'KeyQ') this.commandSquad()
    if (event.code === 'KeyP' || event.code === 'Escape') this.callbacks.onPauseRequest()
    if (event.code === 'KeyF' && !this.ended) this.callbacks.onSaveRequest()
    if (
      event.code === 'KeyR' &&
      document.pointerLockElement === this.renderer.domElement
    ) {
      if (this.faction === 'guard') this.setShield(true)
      else this.useAbility()
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.code)
    if (event.code === 'KeyR') this.setShield(false)
  }

  private onMouseMove(event: MouseEvent): void {
    if (document.pointerLockElement !== this.renderer.domElement || this.paused) return
    this.cameraYaw += event.movementX * 0.0028
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + event.movementY * 0.0018, -0.15, 0.72)
  }

  private onMouseDown(event: MouseEvent): void {
    if (!this.container.contains(event.target as Node) || this.paused || this.ended) return
    if (document.pointerLockElement !== this.renderer.domElement) {
      this.requestPointerLock()
      return
    }
    if (event.button === 0) this.attack()
    if (event.button === 2) {
      if (this.faction === 'guard') this.setShield(true)
      else this.useAbility()
    }
  }

  private onMouseUp(event: MouseEvent): void {
    if (event.button === 2) this.setShield(false)
  }

  private onContextMenu(event: MouseEvent): void {
    if (
      document.pointerLockElement === this.renderer.domElement ||
      (event.target instanceof Node && this.container.contains(event.target))
    ) {
      event.preventDefault()
    }
  }

  private onWindowBlur(): void {
    this.keys.clear()
    this.clearTransientCombatFeedback()
    if (this.shieldActive) {
      this.dropShield()
      this.emitView(true)
    }
  }

  private onPointerLockChange(): void {
    if (
      document.pointerLockElement !== this.renderer.domElement &&
      this.shieldActive
    ) {
      this.dropShield()
    }
    this.emitView(true)
  }

  private onVisibilityChange(): void {
    if (document.hidden) {
      this.keys.clear()
      this.clearTransientCombatFeedback()
      if (this.shieldActive) {
        this.dropShield()
        this.emitView(true)
      }
    }
    this.audio.setHidden(document.hidden)
  }

  private updateMusicContext(): void {
    if (this.elapsed >= this.nextMusicStateSampleAt) {
      this.nextMusicStateSampleAt = this.elapsed + MUSIC_STATE_SAMPLE_INTERVAL
      const desired = this.desiredMusicIntensity()
      const desiredRank = musicIntensityRank(desired)
      const currentRank = musicIntensityRank(this.musicIntensity)

      if (desiredRank > currentRank || this.elapsed >= this.musicIntensityReleaseAt) {
        this.musicIntensity = desired
      }
      if (desiredRank >= musicIntensityRank(this.musicIntensity)) {
        this.musicIntensityReleaseAt =
          this.elapsed + MUSIC_INTENSITY_HOLD[this.musicIntensity]
      }
    }

    this.audio.setMusicContext({
      faction: this.faction,
      zone: this.zoneAtPosition(this.player.position.x, this.player.position.z),
      intensity: this.musicIntensity,
      threatTier: this.threatTier,
    })
  }

  private desiredMusicIntensity(): MusicIntensity {
    let nearbyAggro = 0
    let immediateThreat = false
    let championEngaged = false
    const alertRangeSq = 38 * 38
    const combatRangeSq = 14 * 14

    for (const actor of this.actors) {
      if (!actor.alive || !actor.hostileToPlayer) continue
      const distanceSq = actor.mesh.position.distanceToSquared(this.player.position)
      if (distanceSq > alertRangeSq) continue
      const targetsPlayer = actor.action?.target.kind === 'player'
      const engaged = actor.playerAggro || targetsPlayer
      if (!engaged) continue

      nearbyAggro += 1
      immediateThreat ||= targetsPlayer || actor.rageTimer > 0 || distanceSq <= combatRangeSq
      championEngaged ||= actor.role === 'champion'
    }

    if (championEngaged) return 'boss'
    if (immediateThreat || nearbyAggro >= 2) return 'combat'
    if (nearbyAggro > 0 || this.hasNearbyEvent(THREAT_WAVE_EVENT_RADIUS)) return 'alert'
    return 'explore'
  }

  private resumeAudio(): void {
    this.audio.resume()
  }

  private playSound(
    cue: SoundCue,
    options: Omit<SoundRequest, 'cue'> = {},
  ): void {
    this.audio.play({ cue, ...options })
  }
}
