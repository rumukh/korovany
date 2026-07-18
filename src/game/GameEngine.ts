import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { AudioDirector, type SoundCue, type SoundRequest } from './AudioDirector'
import { BloomPostProcessor } from './BloomPostProcessor'
import {
  AchievementTracker,
  type AchievementSummary,
  type AchievementView,
} from './achievements'
import {
  ComicMaterialLibrary,
  type OutlineBinding,
  type OutlineKind,
} from './ComicMaterialLibrary'
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
  FACTION_INFO,
  MAX_HEALTH_PER_LEVEL,
  MAX_STAMINA_PER_LEVEL,
  MAX_THREAT_TIER,
  SAVE_KEY,
  type ActorRole,
  type BodyPart,
  type BodyState,
  type Faction,
  type GameCallbacks,
  type GameView,
  type MapMarker,
  type NoticeTone,
  type Objective,
  type SavedGame,
  type ShopItem,
  type UpgradeLevels,
  type WorldEventKind,
  type ZoneId,
  createAbilityView,
  createHealthyBody,
  getMaxHealth,
  getMaxStamina,
  getShopItemPrice,
  getThreatTier,
  normalizeUpgradeLevels,
  restoreObjectives,
} from './types'

export type FoliageQuality = 'off' | 'low' | 'high'

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
}

type ActorAiMode = 'normal' | 'captive' | 'attackEventProp'
type ActorActionKind = 'meleePlayer' | 'meleeActor' | 'eventProp' | 'arrow'
type ActorActionPhase = 'windup' | 'recovery'
type HitReactionKind = 'none' | 'flinch' | 'stagger'
type DeathStyle = 'sideFall' | 'backFall' | 'spinFall' | 'launchFall'
type TelegraphKind = 'tick' | 'aim' | 'commander' | 'wedge'

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
  faction: Faction
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
}

interface ActorSpawnOptions {
  objectiveEligible?: boolean
  squadEligible?: boolean
  aiMode?: ActorAiMode
  eventOwnerId?: string | null
  eventPropTargetId?: string | null
  ignoredTargetId?: string | null
}

interface ActorKillContext {
  killerFaction: Faction
  directPlayerKill: boolean
}

interface InteractableOutlineBinding {
  binding: OutlineBinding
  positionRoot: THREE.Object3D
}

interface WorldEvent {
  id: string
  kind: WorldEventKind
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
  cleanup(): void
}

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

type WeatherKind = 'clear' | 'overcast' | 'rain' | 'snow'

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
  faction: Faction
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
}

interface BoxObstacle {
  kind: 'box'
  x: number
  z: number
  halfWidth: number
  halfDepth: number
  cos: number
  sin: number
}

interface CircleObstacle {
  kind: 'circle'
  x: number
  z: number
  radius: number
}

type StaticObstacle = BoxObstacle | CircleObstacle

interface NavigationEnclosure {
  insideMinX: number
  insideMaxX: number
  insideMinZ: number
  insideMaxZ: number
  outerMinX: number
  outerMaxX: number
  outerMinZ: number
  outerMaxZ: number
  gateInside: readonly [number, number]
  gateOutside: readonly [number, number]
  gateHalfWidth: number
  detours: ReadonlyArray<readonly [number, number]>
}

type GroundFoliageBucket = 'grass' | 'fern' | 'flower'

interface GroundFoliageDensity {
  low: number
  high: number
}

interface GroundFoliagePlacement {
  zone: ZoneId
  x: number
  z: number
  yaw: number
  width: number
  height: number
  tone: number
}

interface GroundFoliageUniforms {
  uTime: { value: number }
  uWindDirection: { value: THREE.Vector2 }
  uWindStrength: { value: number }
}

interface GroundFoliageScaleRange {
  width: readonly [number, number]
  height: readonly [number, number]
}

const WORLD_HALF = 78
const PLAYER_HEIGHT = 0
const PLAYER_COLLIDER_RADIUS = 0.64
const ACTOR_COLLIDER_RADIUS = 0.56
const LARGE_ACTOR_COLLIDER_RADIUS = 0.72
const COLLISION_SKIN = 0.025
const COLLISION_MAX_STEP = 0.32
const COLLISION_RESOLUTION_PASSES = 6
const NPC_STEERING_ANGLES = [0, 0.55, -0.55, 1.05, -1.05, 1.55, -1.55] as const
const NPC_ACCELERATION_DAMPING = 6.5
const NPC_BRAKING_DAMPING = 11
const NPC_BLOCKED_SPEED_RATIO = 0.22
const MAX_ACTORS = 25
const OUTLINE_ACTOR_DISTANCE_SQ = 38 * 38
const OUTLINE_INTERACTABLE_DISTANCE_SQ = 46 * 46
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
const NPC_RETALIATION_DURATION = 4
const COMMANDER_AURA_RANGE = 10
const COMMANDER_SPEED_MULTIPLIER = 1.15
const COMMANDER_DAMAGE_BONUS = 4
const COMMANDER_REINFORCEMENT_INTERVAL = 25
const COMMANDER_REINFORCEMENT_LIMIT = 4
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
const DAY_LENGTH = 240
const DAY_START_OFFSET = 0.18
const SUN_ARC_RADIUS = 90
const SUN_ARC_HEIGHT = 70
const SUN_ARC_DEPTH = 40
const CELESTIAL_DISC_DISTANCE = 150
const MIN_SHADOW_LIGHT_HEIGHT = 8
const STAR_COUNT = 180
const TWO_PI = Math.PI * 2
const GROUND_FOLIAGE_CLEARANCE = 0.35
const GROUND_FOLIAGE_ROAD_CLEARANCE = 0.6
const GROUND_FOLIAGE_EDGE_MARGIN = 0.8
const GROUND_FOLIAGE_MAX_ATTEMPTS = 40
const GROUND_FOLIAGE_WIND_SPEED = 1.6
const GROUND_FOLIAGE_DEFAULT_WIND_STRENGTH = 0.25
const GROUND_FOLIAGE_MAX_WIND_STRENGTH = 1.5
const GROUND_FOLIAGE_WAVE_MAX = 1.35
const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'overcast', 'rain', 'snow']
const WEATHER_BY_ZONE: Record<ZoneId, WeatherKind> = {
  neutral: 'overcast',
  palace: 'clear',
  forest: 'rain',
  fort: 'snow',
}
const WEATHER_PROFILES: Record<WeatherKind, WeatherProfile> = {
  clear: {
    fogNear: 48,
    fogFar: 132,
    sunScale: 1,
    hemisphereScale: 1,
    cloudOpacity: 0.3,
    skyBrightness: 1,
    desaturation: 0,
    windStrength: GROUND_FOLIAGE_DEFAULT_WIND_STRENGTH,
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
const WEATHER_RESPONSE_RATE = -Math.log(0.05) / 6
const WEATHER_ZONE_HYSTERESIS = 1.5
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
const GRASS_FOLIAGE_HEIGHT = 0.7
const FERN_FOLIAGE_HEIGHT = 0.6
const FLOWER_FOLIAGE_HEIGHT = 0.75
const GRASS_FOLIAGE_SWAY = 0.12
const FERN_FOLIAGE_SWAY = 0.09
const FLOWER_FOLIAGE_SWAY = 0.1

const GROUND_FOLIAGE_ZONES: readonly ZoneId[] = ['neutral', 'forest', 'fort', 'palace']

const GROUND_FOLIAGE_COUNTS: Record<
  GroundFoliageBucket,
  Record<ZoneId, GroundFoliageDensity>
> = {
  grass: {
    neutral: { low: 230, high: 700 },
    forest: { low: 370, high: 1100 },
    fort: { low: 150, high: 450 },
    palace: { low: 60, high: 180 },
  },
  fern: {
    neutral: { low: 0, high: 0 },
    forest: { low: 90, high: 260 },
    fort: { low: 0, high: 0 },
    palace: { low: 0, high: 0 },
  },
  flower: {
    neutral: { low: 55, high: 160 },
    forest: { low: 45, high: 140 },
    fort: { low: 0, high: 0 },
    palace: { low: 0, high: 0 },
  },
}

const GROUND_FOLIAGE_SEEDS: Record<GroundFoliageBucket, Record<ZoneId, number>> = {
  grass: { neutral: 1249, forest: 1373, fort: 1481, palace: 1597 },
  fern: { neutral: 2213, forest: 2333, fort: 2441, palace: 2557 },
  flower: { neutral: 3251, forest: 3371, fort: 3469, palace: 3583 },
}

const GRASS_FOLIAGE_SCALES: Record<ZoneId, GroundFoliageScaleRange> = {
  neutral: { width: [0.75, 1.25], height: [0.8, 1.45] },
  forest: { width: [0.8, 1.4], height: [0.9, 1.6] },
  fort: { width: [0.7, 1.2], height: [0.45, 0.9] },
  palace: { width: [0.75, 1], height: [0.45, 0.72] },
}

const GROUND_FOLIAGE_CLEARINGS: ReadonlyArray<readonly [number, number, number]> = [
  [FACTION_INFO.elf.spawn[0], FACTION_INFO.elf.spawn[1], 5],
  [FACTION_INFO.guard.spawn[0], FACTION_INFO.guard.spawn[1], 5],
  [FACTION_INFO.villain.spawn[0], FACTION_INFO.villain.spawn[1], 5],
  [-46, -39, 5],
  [40, -36, 5],
]

const EVENT_WEIGHTS: Record<Faction, Record<WorldEventKind, number>> = {
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

const EVENT_REQUIRED_SLOTS: Record<Exclude<WorldEventKind, 'bounty'>, number> = {
  richCaravan: 3,
  defendHome: 4,
  champion: 1,
  rescue: 3,
}

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

function smoothstep(min: number, max: number, value: number): number {
  const amount = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1)
  return amount * amount * (3 - 2 * amount)
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

function seededRandom(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function zoneAt(x: number, z: number): ZoneId {
  if (x < 0 && z < 0) return 'neutral'
  if (x >= 0 && z < 0) return 'palace'
  if (x < 0 && z >= 0) return 'forest'
  return 'fort'
}

function hostile(a: Faction, b: Faction): boolean {
  return a !== b
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

export class GameEngine {
  private readonly container: HTMLElement
  private readonly callbacks: GameCallbacks
  private readonly faction: Faction
  private readonly achievements: AchievementTracker
  private readonly palette: Palette
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_BASE_FOV, 1, 0.1, 240)
  private readonly renderer: THREE.WebGLRenderer
  private readonly postProcessor: BloomPostProcessor
  private readonly comicMaterials: ComicMaterialLibrary
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
  private readonly villageHouses: THREE.Group[] = []
  private readonly backgroundColor = new THREE.Color()
  private readonly fog: THREE.Fog
  private readonly dayNightKeyframes: DayNightKeyframes
  private sun!: THREE.DirectionalLight
  private hemisphere!: THREE.HemisphereLight
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
  private readonly groundFoliageMeshes: THREE.InstancedMesh[] = []
  private readonly groundFoliageUniforms: GroundFoliageUniforms = {
    uTime: { value: 0 },
    uWindDirection: { value: new THREE.Vector2(1, 0.2).normalize() },
    uWindStrength: { value: GROUND_FOLIAGE_DEFAULT_WIND_STRENGTH },
  }
  private readonly staticObstacles: StaticObstacle[] = []
  private readonly navigationEnclosures: NavigationEnclosure[] = []
  private readonly collisionProbe = new THREE.Vector3()
  private readonly navigationWaypoint = new THREE.Vector3()
  private readonly eventRng = seededRandom((Date.now() % 2147483646) + 1)
  private readonly weatherRng = seededRandom(((Date.now() + 7919) % 2147483646) + 1)
  private readonly player: THREE.Group
  private readonly playerOutline: OutlineBinding
  private readonly weaponTrail: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private readonly caravan: THREE.Group
  private readonly vendorPosition = new THREE.Vector3(-46, 0, -39)
  private readonly commanderPosition = new THREE.Vector3(40, 0, -36)
  private readonly elfHomePosition = new THREE.Vector3(-48, 0, 43)
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
  private campaignCompletedAt: number | undefined
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
  private readonly weatherWeights: Record<WeatherKind, number> = {
    clear: 1,
    overcast: 0,
    rain: 0,
    snow: 0,
  }
  private lightningCooldown = LIGHTNING_MIN_INTERVAL
  private lightningFlash = 0
  private thunderDelay = -1
  private prompt = ''
  private squadFollowing = false
  private caravanDirection = 1
  private caravanCooldown = 0
  private caravanRobbedFlash = 0
  private activeEvent: WorldEvent | null = null
  private eventCooldown = FIRST_EVENT_AT
  private championDamageBonus = 0
  private eventSequence = 0
  private actorSequence = 0
  private readonly audio: AudioDirector
  private readonly audioListenerRight = new THREE.Vector3()
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
    savedGame?: SavedGame,
    settings: Partial<GameEngineSettings> = {},
  ) {
    this.container = container
    this.callbacks = callbacks
    this.faction = faction
    this.audio = new AudioDirector({
      musicMuted: settings.musicMuted ?? false,
      sfxVolume: settings.sfxVolume,
    })
    this.achievements = new AchievementTracker((achievement) => {
      this.callbacks.onAchievementUnlocked(achievement)
      this.playSound('achievement')
    })
    this.dynamicDayNight = settings.dynamicDayNight ?? true
    this.weatherEnabled = settings.weatherEnabled ?? true
    this.inkOutlinesEnabled = settings.inkOutlinesEnabled ?? true
    this.screenShakeEnabled = settings.screenShakeEnabled ?? true
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.groundFoliageQuality = settings.foliageQuality ?? 'high'
    this.palette = createPalette()
    this.comicMaterials = new ComicMaterialLibrary({
      player: mix(this.palette.bg, this.palette.accent, 0.16),
      enemy: mix(this.palette.bg, this.palette.danger, 0.16),
      interactable: mix(this.palette.bg, this.palette.warning, 0.18),
    })
    this.dayNightKeyframes = createDayNightKeyframes(this.palette)
    this.weatherFrostColor
      .copy(this.palette.worldFog)
      .lerp(this.palette.worldSun, 0.58)
    this.objectives = restoreObjectives(faction, savedGame?.objectives)
    this.body = savedGame ? { ...savedGame.body } : createHealthyBody()
    this.upgrades = normalizeUpgradeLevels(savedGame?.upgradeLevels)
    this.maxHealth = getMaxHealth(this.upgrades)
    this.maxStamina = getMaxStamina(this.upgrades)
    this.health = Math.min(this.maxHealth, savedGame?.health ?? this.maxHealth)
    this.stamina = Math.min(this.maxStamina, savedGame?.stamina ?? this.maxStamina)
    this.gold = savedGame?.gold ?? 55
    this.kills = savedGame?.kills ?? 0
    this.damage = savedGame?.damage ?? (faction === 'villain' ? 31 : faction === 'guard' ? 28 : 26)
    this.elapsed = savedGame?.elapsed ?? 0
    this.campaignCompleted =
      savedGame?.campaignCompleted === true ||
      this.objectives.every((objective) => objective.done)
    this.campaignCompletedAt = savedGame?.campaignCompletedAt
    this.threatTier = getThreatTier(this.elapsed)
    this.eventCooldown =
      Math.min(
        this.eventCooldownRange().max,
        savedGame?.eventCooldown ?? Math.max(0, FIRST_EVENT_AT - this.elapsed),
      )
    const defaultNextWave =
      this.elapsed < THREAT_WAVE_FIRST_AT
        ? THREAT_WAVE_FIRST_AT
        : this.elapsed + Math.min(45, this.threatWaveInterval())
    this.nextThreatWaveAt = Math.max(
      this.elapsed,
      Math.min(
        savedGame?.nextThreatWaveAt ?? defaultNextWave,
        this.elapsed + this.threatWaveInterval(),
      ),
    )
    this.championDamageBonus = Math.min(
      CHAMPION_DAMAGE_CAP,
      Math.max(0, savedGame?.championDamageBonus ?? 0),
    )

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.92
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
    const spawn = savedGame?.position ?? [FACTION_INFO[faction].spawn[0], PLAYER_HEIGHT, FACTION_INFO[faction].spawn[1]]
    this.player.position.set(spawn[0], spawn[1], spawn[2])
    this.scene.add(this.player)
    this.applySavedBodyAppearance()
    this.playerOutline = this.registerOutline(this.player, 'player')
    this.lastZone = zoneAt(this.player.position.x, this.player.position.z)
    this.audio.setMusicContext(this.faction, this.lastZone)
    // Loading a save starts a fresh achievement run; cumulative progress remains global.
    this.achievements.beginRun(faction, this.lastZone, settings.achievementRunId)
    this.weatherZone = this.lastZone
    this.setWeatherTarget(
      this.weatherEnabled ? WEATHER_BY_ZONE[this.weatherZone] : 'clear',
      true,
    )

    this.setupLights()
    const worldRootIndex = this.scene.children.length
    this.buildWorld()
    this.setupWeather()
    this.applyGroundWeather()
    this.updateDayNight()
    this.updateWeather(0)
    this.updateAtmosphere(0)
    this.resolveCharacterOverlaps(this.player.position, PLAYER_COLLIDER_RADIUS)
    this.collectCameraObstacles(this.scene.children.slice(worldRootIndex))
    this.caravan = this.createCaravan()
    this.scene.add(this.caravan)
    this.registerNamedInteractableOutline(this.caravan, 'cargo')
    this.spawnPopulation()
    this.cameraYaw = faction === 'elf' ? -0.8 : faction === 'guard' ? 2.4 : 0.8
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
    cancelAnimationFrame(this.frameHandle)
    this.cancelActiveEvent()
    this.resizeObserver.disconnect()
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
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
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
      if (object instanceof THREE.InstancedMesh) object.dispose()
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
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => {
      if (!ComicMaterialLibrary.isLibraryOwned(material)) material.dispose()
    })
    this.postProcessor.dispose()
    this.comicMaterials.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.actors.forEach((actor) => actor.healthBarTexture.dispose())
    this.damageNumberFx.forEach((entry) => entry.texture.dispose())
    this.generatedTextures.forEach((texture) => texture.dispose())
    this.generatedTextures.clear()
    this.outlineBindings.length = 0
    this.interactableOutlineBindings.length = 0
    this.projectiles.length = 0
    this.projectileSourcesToClear.clear()
    this.eventPropTargets.clear()
    this.telegraphPool.length = 0
    this.telegraphGeometries.clear()
    this.audio.destroy()
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
    this.weatherZone = zoneAt(this.player.position.x, this.player.position.z)
    this.setWeatherTarget(
      enabled ? WEATHER_BY_ZONE[this.weatherZone] : 'clear',
      true,
    )
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
  }

  setFoliageQuality(quality: FoliageQuality): void {
    if (this.groundFoliageQuality === quality) return
    this.groundFoliageQuality = quality
    this.rebuildGroundFoliage()
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
      this.callbacks.onNotice('Без рук натянуть лук невозможно.', 'warning')
      return
    }
    if (this.stamina < ability.staminaCost) {
      this.callbacks.onNotice('Не хватает выносливости для способности.', 'warning')
      return
    }

    this.resumeAudio()
    this.stamina -= ability.staminaCost
    this.abilityCooldown = ability.cooldownMax
    if (ability.id === 'bow') this.fireArrow()
    else this.cleave()
    this.achievements.recordAbilityUse(ability.id)
    this.emitView(true)
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

    let target: Actor | null = null
    let bestDistance = 3.6
    for (const actor of this.actors) {
      if (!actor.alive || !hostile(this.faction, actor.faction)) continue
      const offset = actor.mesh.position.clone().sub(this.player.position)
      const distance = offset.length()
      if (distance >= bestDistance) continue
      target = actor
      bestDistance = distance
    }

    if (!target) {
      this.playSound('swing')
      return
    }

    const targetDirection = target.mesh.position.clone().sub(this.player.position)
    this.player.rotation.y = Math.atan2(targetDirection.x, targetDirection.z)
    const armPenalty =
      (this.body.leftArm === 'missing' ? 5 : 0) + (this.body.rightArm === 'missing' ? 9 : 0)
    const dealt = Math.max(8, this.damage - armPenalty + Math.floor(Math.random() * 7))
    this.damageActor(target, dealt, this.player.position, this.faction, true, {
      attackKind: 'melee',
      detachChance: 0.45,
    })
  }

  interact(): void {
    if (this.paused || this.ended) return
    this.resumeAudio()
    if (this.activeEvent?.onInteract?.()) {
      this.emitView(true)
      return
    }
    const playerPosition = this.player.position
    if (
      this.hasElfLoot() &&
      playerPosition.distanceTo(this.elfHomePosition) < 6
    ) {
      if (!this.isObjectiveDone('guards')) {
        const guards = this.objectives.find((objective) => objective.id === 'guards')
        const remaining = Math.max(0, (guards?.target ?? 4) - (guards?.progress ?? 0))
        this.callbacks.onNotice(
          `Добыча при вас. Чтобы сдать её, одолейте ещё ${remaining} гвардейцев.`,
          'warning',
        )
      } else {
        this.completeObjective('home')
      }
      this.emitView(true)
      return
    }

    if (playerPosition.distanceTo(this.vendorPosition) < 6) {
      this.callbacks.onShop()
      return
    }

    if (
      this.faction === 'guard' &&
      playerPosition.distanceTo(this.commanderPosition) < 6 &&
      this.actors.some((actor) => actor.role === 'commander' && actor.alive)
    ) {
      if (this.completeObjective('orders')) {
        this.callbacks.onNotice(
          'Командир: «Налётчики уже близко. Защитить дворец, затем проверить старый форт!»',
          'success',
        )
        this.gold += 25
        this.achievements.recordGoldEarned(25)
        this.playSound('coin')
      } else {
        this.callbacks.onNotice('Командир: «Приказ прежний. Не стой столбом!»', 'info')
      }
      this.emitView(true)
      return
    }

    if (playerPosition.distanceTo(this.caravan.position) < 7) {
      if (this.faction === 'guard') {
        this.callbacks.onNotice('Корован под охраной. Всё спокойно, гвардеец.', 'info')
        this.health = Math.min(this.maxHealth, this.health + 8)
        return
      }
      if (this.caravanCooldown > 0) {
        this.callbacks.onNotice('Этот корован уже пуст. Ждите следующий обоз.', 'warning')
        return
      }
      this.gold += 95
      this.achievements.recordGoldEarned(95)
      this.achievements.recordCaravanRobbed(false)
      this.caravanCooldown = 40
      this.caravanRobbedFlash = 1
      this.completeObjective('raid')
      const lootGuidance = this.isObjectiveDone('guards')
        ? 'Добыча при вас: сдайте её у зелёного маяка в лагере.'
        : 'Добыча при вас: одолейте охрану и сдайте её у зелёного маяка в лагере.'
      this.callbacks.onNotice(
        `Корован ограблен! +95 золота. ${lootGuidance}`,
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
    if (this.faction === 'villain') this.completeObjective('rally')
    const message = this.squadFollowing
      ? this.faction === 'guard'
        ? 'Ближайшие гвардейцы держат строй за вами.'
        : 'Отряд следует за вами и атакует ваших врагов.'
      : 'Отряд удерживает текущую позицию.'
    this.callbacks.onNotice(message, this.squadFollowing ? 'success' : 'info')
    this.playSound('command')
    this.emitView(true)
  }

  purchase(item: ShopItem): { ok: boolean; message: string } {
    const currentLevel = item.upgrade ? this.upgrades[item.upgrade] : 0
    if (item.upgrade && currentLevel >= (item.maxLevel ?? Number.POSITIVE_INFINITY)) {
      return { ok: false, message: `${item.name}: достигнут максимальный уровень.` }
    }
    const price = getShopItemPrice(item, this.upgrades)
    if (this.gold < price) return { ok: false, message: 'Не хватает золота.' }

    if (item.id === 'arm') {
      const part = this.firstPartWithStatus(['leftArm', 'rightArm'], 'missing')
      if (!part) return { ok: false, message: 'Обе руки на месте. Протез пока не нужен.' }
      this.body[part] = 'prosthetic'
      this.restorePlayerLimb(part)
    } else if (item.id === 'leg') {
      const part = this.firstPartWithStatus(['leftLeg', 'rightLeg'], 'missing')
      if (!part) return { ok: false, message: 'Обе ноги на месте. Протез пока не нужен.' }
      this.body[part] = 'prosthetic'
      this.restorePlayerLimb(part)
    } else if (item.id === 'eye') {
      const part = this.firstPartWithStatus(['leftEye', 'rightEye'], 'missing')
      if (!part) return { ok: false, message: 'Зрение в порядке. Хрустальный глаз не нужен.' }
      this.body[part] = 'prosthetic'
    } else if (item.id === 'medicine') {
      if (this.health >= this.maxHealth && this.body.bleeding === 0 && !this.hasWounds()) {
        return { ok: false, message: 'Вы полностью здоровы.' }
      }
      this.health = Math.min(this.maxHealth, this.health + 55)
      this.body.bleeding = 0
      this.healWounds()
    } else if (item.id === 'blade') {
      this.damage += 8
      this.upgrades.blade += 1
    } else if (item.id === 'vitality') {
      this.upgrades.vitality += 1
      this.maxHealth = getMaxHealth(this.upgrades)
      this.health = Math.min(this.maxHealth, this.health + MAX_HEALTH_PER_LEVEL)
    } else {
      this.upgrades.endurance += 1
      this.maxStamina = getMaxStamina(this.upgrades)
      this.stamina = Math.min(this.maxStamina, this.stamina + MAX_STAMINA_PER_LEVEL)
    }

    this.gold -= price
    this.achievements.recordPurchase(item.id)
    this.playSound('coin')
    this.emitView(true)
    const levelSuffix = item.upgrade ? ` Уровень ${this.upgrades[item.upgrade]}.` : ''
    return { ok: true, message: `${item.name}: покупка совершена.${levelSuffix}` }
  }

  save(): SavedGame {
    const save: SavedGame = {
      version: 1,
      faction: this.faction,
      position: [this.player.position.x, this.player.position.y, this.player.position.z],
      health: this.health,
      stamina: this.stamina,
      gold: this.gold,
      kills: this.kills,
      damage: this.damage,
      body: { ...this.body },
      objectives: this.objectives.map((objective) => ({ ...objective })),
      elapsed: this.elapsed,
      savedAt: new Date().toISOString(),
      eventCooldown: this.activeEvent ? this.eventCooldownRange().min : this.eventCooldown,
      championDamageBonus: this.championDamageBonus,
      campaignCompleted: this.campaignCompleted,
      ...(this.campaignCompletedAt === undefined
        ? {}
        : { campaignCompletedAt: this.campaignCompletedAt }),
      threatTier: this.threatTier,
      nextThreatWaveAt: this.nextThreatWaveAt,
      upgradeLevels: { ...this.upgrades },
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    this.callbacks.onNotice('Игра сохранена. Корованы никуда не денутся.', 'success')
    this.playSound('save')
    return save
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
    this.audio.setMusicContext(
      this.faction,
      zoneAt(this.player.position.x, this.player.position.z),
    )
    this.postProcessor.render()
    this.frameHandle = requestAnimationFrame(this.loop)
  }

  private update(delta: number): void {
    this.elapsed += delta
    this.updateThreat()
    this.cleanupDeadActors()
    this.shakeClock += delta
    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * delta)
    this.damageFlash = Math.max(0, this.damageFlash - FLASH_DECAY * delta)
    this.attackCooldown = Math.max(0, this.attackCooldown - delta)
    this.attackAnimation = Math.max(0, this.attackAnimation - delta * 4.2)
    this.abilityCooldown = Math.max(0, this.abilityCooldown - delta)
    this.caravanCooldown = Math.max(0, this.caravanCooldown - delta)
    this.caravanRobbedFlash = Math.max(0, this.caravanRobbedFlash - delta * 2)
    this.updatePlayer(delta)
    this.updateCaravan(delta)
    this.updateProjectiles(delta)
    this.updateActors(delta)
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

  private registerBoxObstacle(
    x: number,
    z: number,
    width: number,
    depth: number,
    rotation = 0,
  ): void {
    this.staticObstacles.push({
      kind: 'box',
      x,
      z,
      halfWidth: width * 0.5,
      halfDepth: depth * 0.5,
      cos: Math.cos(rotation),
      sin: Math.sin(rotation),
    })
  }

  private registerCircleObstacle(x: number, z: number, radius: number): void {
    this.staticObstacles.push({ kind: 'circle', x, z, radius })
  }

  private obstacleOverlapsCircle(
    obstacle: StaticObstacle,
    x: number,
    z: number,
    radius: number,
  ): boolean {
    const minimumDistance = radius + COLLISION_SKIN
    if (obstacle.kind === 'circle') {
      const dx = x - obstacle.x
      const dz = z - obstacle.z
      const combinedRadius = obstacle.radius + minimumDistance
      return dx * dx + dz * dz < combinedRadius * combinedRadius
    }

    const dx = x - obstacle.x
    const dz = z - obstacle.z
    const localX = dx * obstacle.cos - dz * obstacle.sin
    const localZ = dx * obstacle.sin + dz * obstacle.cos
    const closestX = THREE.MathUtils.clamp(localX, -obstacle.halfWidth, obstacle.halfWidth)
    const closestZ = THREE.MathUtils.clamp(localZ, -obstacle.halfDepth, obstacle.halfDepth)
    const separationX = localX - closestX
    const separationZ = localZ - closestZ
    return (
      separationX * separationX + separationZ * separationZ <
      minimumDistance * minimumDistance
    )
  }

  private isWalkablePosition(x: number, z: number, radius: number): boolean {
    if (Math.abs(x) > WORLD_HALF || Math.abs(z) > WORLD_HALF) return false
    return !this.staticObstacles.some((obstacle) =>
      this.obstacleOverlapsCircle(obstacle, x, z, radius),
    )
  }

  private pushCharacterOutOfObstacle(
    position: THREE.Vector3,
    radius: number,
    obstacle: StaticObstacle,
  ): boolean {
    const minimumDistance = radius + COLLISION_SKIN
    if (obstacle.kind === 'circle') {
      const dx = position.x - obstacle.x
      const dz = position.z - obstacle.z
      const combinedRadius = obstacle.radius + minimumDistance
      const distanceSquared = dx * dx + dz * dz
      if (distanceSquared >= combinedRadius * combinedRadius) return false
      if (distanceSquared < 0.000001) {
        position.x += combinedRadius
        return true
      }

      const distance = Math.sqrt(distanceSquared)
      const pushScale = (combinedRadius - distance) / distance
      position.x += dx * pushScale
      position.z += dz * pushScale
      return true
    }

    const dx = position.x - obstacle.x
    const dz = position.z - obstacle.z
    const localX = dx * obstacle.cos - dz * obstacle.sin
    const localZ = dx * obstacle.sin + dz * obstacle.cos
    const closestX = THREE.MathUtils.clamp(localX, -obstacle.halfWidth, obstacle.halfWidth)
    const closestZ = THREE.MathUtils.clamp(localZ, -obstacle.halfDepth, obstacle.halfDepth)
    const separationX = localX - closestX
    const separationZ = localZ - closestZ
    const distanceSquared = separationX * separationX + separationZ * separationZ
    if (distanceSquared >= minimumDistance * minimumDistance) return false

    let localPushX = 0
    let localPushZ = 0
    if (distanceSquared > 0.000001) {
      const distance = Math.sqrt(distanceSquared)
      const pushScale = (minimumDistance - distance) / distance
      localPushX = separationX * pushScale
      localPushZ = separationZ * pushScale
    } else {
      const pushX = obstacle.halfWidth + minimumDistance - Math.abs(localX)
      const pushZ = obstacle.halfDepth + minimumDistance - Math.abs(localZ)
      if (pushX < pushZ) localPushX = (localX >= 0 ? 1 : -1) * pushX
      else localPushZ = (localZ >= 0 ? 1 : -1) * pushZ
    }

    position.x += localPushX * obstacle.cos + localPushZ * obstacle.sin
    position.z += -localPushX * obstacle.sin + localPushZ * obstacle.cos
    return true
  }

  private resolveCharacterOverlaps(position: THREE.Vector3, radius: number): boolean {
    let collided = false
    for (let pass = 0; pass < COLLISION_RESOLUTION_PASSES; pass += 1) {
      let adjusted = false
      for (const obstacle of this.staticObstacles) {
        if (!this.pushCharacterOutOfObstacle(position, radius, obstacle)) continue
        adjusted = true
        collided = true
      }

      const clampedX = THREE.MathUtils.clamp(position.x, -WORLD_HALF, WORLD_HALF)
      const clampedZ = THREE.MathUtils.clamp(position.z, -WORLD_HALF, WORLD_HALF)
      if (clampedX !== position.x || clampedZ !== position.z) {
        position.x = clampedX
        position.z = clampedZ
        adjusted = true
        collided = true
      }
      if (!adjusted) break
    }
    return collided
  }

  private moveCharacter(
    position: THREE.Vector3,
    movementX: number,
    movementZ: number,
    radius: number,
  ): boolean {
    const distance = Math.hypot(movementX, movementZ)
    const steps = Math.max(1, Math.ceil(distance / COLLISION_MAX_STEP))
    const stepX = movementX / steps
    const stepZ = movementZ / steps
    let collided = false

    for (let step = 0; step < steps; step += 1) {
      const intendedX = position.x + stepX
      const intendedZ = position.z + stepZ
      position.x = intendedX
      position.z = intendedZ
      if (this.resolveCharacterOverlaps(position, radius)) collided = true
      if (
        Math.abs(position.x - intendedX) > 0.000001 ||
        Math.abs(position.z - intendedZ) > 0.000001
      ) {
        collided = true
      }
    }
    return collided
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

  private segmentIntersectsBounds(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ): boolean {
    const dx = endX - startX
    const dz = endZ - startZ
    let near = 0
    let far = 1
    for (const [start, delta, minimum, maximum] of [
      [startX, dx, minX, maxX],
      [startZ, dz, minZ, maxZ],
    ] as const) {
      if (Math.abs(delta) < 0.000001) {
        if (start < minimum || start > maximum) return false
        continue
      }
      const first = (minimum - start) / delta
      const second = (maximum - start) / delta
      near = Math.max(near, Math.min(first, second))
      far = Math.min(far, Math.max(first, second))
      if (near > far) return false
    }
    return true
  }

  private pointInsideEnclosure(position: THREE.Vector3, enclosure: NavigationEnclosure): boolean {
    return (
      position.x > enclosure.insideMinX &&
      position.x < enclosure.insideMaxX &&
      position.z > enclosure.insideMinZ &&
      position.z < enclosure.insideMaxZ
    )
  }

  private findNavigationPathWaypoint(
    position: THREE.Vector3,
    destinationX: number,
    destinationZ: number,
    radius: number,
    enclosure: NavigationEnclosure,
    preferredSign: number,
  ): boolean {
    const [leftFront, rightFront, leftRear, rightRear] = enclosure.detours
    const detours =
      preferredSign > 0
        ? [rightFront, leftFront, rightRear, leftRear]
        : [leftFront, rightFront, leftRear, rightRear]
    const points: Array<readonly [number, number]> = [
      [position.x, position.z],
      ...detours,
      [destinationX, destinationZ],
    ]
    const destinationIndex = points.length - 1
    const distances = points.map(() => Number.POSITIVE_INFINITY)
    const previous = points.map(() => -1)
    const visited = points.map(() => false)
    distances[0] = 0

    for (let iteration = 0; iteration < points.length; iteration += 1) {
      let current = -1
      for (let index = 0; index < points.length; index += 1) {
        if (visited[index]) continue
        if (current < 0 || distances[index] < distances[current]) current = index
      }
      if (current < 0 || !Number.isFinite(distances[current])) break
      if (current === destinationIndex) break
      visited[current] = true

      for (let next = 1; next < points.length; next += 1) {
        if (visited[next] || next === current) continue
        const [currentX, currentZ] = points[current]
        const [nextX, nextZ] = points[next]
        if (!this.isMovementPathClear(currentX, currentZ, nextX, nextZ, radius)) continue
        const distance = Math.hypot(nextX - currentX, nextZ - currentZ)
        const candidateDistance = distances[current] + distance
        if (candidateDistance >= distances[next]) continue
        distances[next] = candidateDistance
        previous[next] = current
      }
    }

    if (!Number.isFinite(distances[destinationIndex])) return false
    let waypointIndex = destinationIndex
    while (previous[waypointIndex] > 0) waypointIndex = previous[waypointIndex]
    if (previous[waypointIndex] !== 0) return false
    const [waypointX, waypointZ] = points[waypointIndex]
    this.navigationWaypoint.set(waypointX, 0, waypointZ)
    return true
  }

  private getNavigationWaypoint(
    position: THREE.Vector3,
    destination: THREE.Vector3,
    radius: number,
    preferredSign: number,
  ): THREE.Vector3 | null {
    for (const enclosure of this.navigationEnclosures) {
      const positionInside = this.pointInsideEnclosure(position, enclosure)
      const destinationInside = this.pointInsideEnclosure(destination, enclosure)
      const gateSpan = enclosure.gateOutside[1] - enclosure.gateInside[1]
      const gateProgress =
        Math.abs(gateSpan) < 0.000001
          ? 0
          : (position.z - enclosure.gateInside[1]) / gateSpan
      const inGatePassage =
        Math.abs(position.x - enclosure.gateInside[0]) < enclosure.gateHalfWidth
      if (
        inGatePassage &&
        destinationInside &&
        gateProgress > 0.08 &&
        gateProgress < 1.1
      ) {
        this.navigationWaypoint.set(
          enclosure.gateInside[0],
          0,
          enclosure.gateInside[1],
        )
        return this.navigationWaypoint
      }
      if (
        inGatePassage &&
        !destinationInside &&
        gateProgress > -0.1 &&
        gateProgress < 0.92
      ) {
        this.navigationWaypoint.set(
          enclosure.gateOutside[0],
          0,
          enclosure.gateOutside[1],
        )
        return this.navigationWaypoint
      }
      if (positionInside && destinationInside) continue

      if (positionInside) {
        const [outsideX, outsideZ] = enclosure.gateOutside
        const waypoint = this.isMovementPathClear(
          position.x,
          position.z,
          outsideX,
          outsideZ,
          radius,
        )
          ? enclosure.gateOutside
          : enclosure.gateInside
        this.navigationWaypoint.set(waypoint[0], 0, waypoint[1])
        return this.navigationWaypoint
      }

      if (destinationInside) {
        const [insideX, insideZ] = enclosure.gateInside
        if (
          this.isMovementPathClear(
            position.x,
            position.z,
            insideX,
            insideZ,
            radius,
          )
        ) {
          this.navigationWaypoint.set(insideX, 0, insideZ)
          return this.navigationWaypoint
        }
        const [outsideX, outsideZ] = enclosure.gateOutside
        if (
          this.findNavigationPathWaypoint(
            position,
            outsideX,
            outsideZ,
            radius,
            enclosure,
            preferredSign,
          )
        ) {
          return this.navigationWaypoint
        }
        continue
      }

      if (
        !this.segmentIntersectsBounds(
          position.x,
          position.z,
          destination.x,
          destination.z,
          enclosure.outerMinX,
          enclosure.outerMaxX,
          enclosure.outerMinZ,
          enclosure.outerMaxZ,
        ) ||
        this.isMovementPathClear(
          position.x,
          position.z,
          destination.x,
          destination.z,
          radius,
        )
      ) {
        continue
      }
      if (
        this.findNavigationPathWaypoint(
          position,
          destination.x,
          destination.z,
          radius,
          enclosure,
          preferredSign,
        )
      ) {
        return this.navigationWaypoint
      }
    }
    return null
  }

  private actorColliderRadiusForRole(role: ActorRole): number {
    return role === 'brute' || role === 'champion'
      ? LARGE_ACTOR_COLLIDER_RADIUS
      : ACTOR_COLLIDER_RADIUS
  }

  private moveActorWithSteering(
    actor: Actor,
    desiredDirection: THREE.Vector3,
    distance: number,
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
    if (this.faction === 'elf' && zoneAt(this.player.position.x, this.player.position.z) === 'forest') {
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
        this.callbacks.onNotice('Выносливость иссякла — щит опущен.', 'warning')
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
    this.verticalVelocity -= 23 * delta
    this.player.position.y += this.verticalVelocity * delta
    if (this.player.position.y <= PLAYER_HEIGHT) {
      const landed = !this.onGround && this.verticalVelocity < -2
      this.player.position.y = PLAYER_HEIGHT
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
    for (const actor of this.actors) {
      this.updateActorIndicators(actor)
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
      this.updateActorReaction(actor, delta)
      const knockbackSpeed = this.updateActorKnockback(actor, delta)
      if (actor.role === 'commander' && actor.reaction !== 'stagger') {
        this.updateCommander(actor, delta)
      }
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
      let investigatesPlayer = false
      let targetPosition: THREE.Vector3 | null = null
      let wandering = false
      const baseAggroRange = actor.role === 'archer' ? 18 : 15
      const enraged = actor.rageTimer > 0
      const senseRange = baseAggroRange + (enraged ? RAGE_RANGE_BONUS : 0)
      const leashRange = senseRange * 2.25
      const colliderRadius = this.actorColliderRadiusForRole(actor.role)
      const navigationSign = Math.sin(actor.phase * 3.17 + 0.4) >= 0 ? 1 : -1
      const hostileToPlayer = hostile(actor.faction, this.faction)
      const canSensePlayer = hostileToPlayer && playerDistance < senseRange
      const canTrackPlayer =
        hostileToPlayer && actor.playerAggro && playerDistance < leashRange
      if (canSensePlayer || canTrackPlayer) {
        actor.playerAggro = true
        actor.aggroMemory = AGGRO_MEMORY_DURATION
        if (actor.lastKnownTargetPos) actor.lastKnownTargetPos.copy(this.player.position)
        else actor.lastKnownTargetPos = this.player.position.clone()
      }
      const shouldPursuePlayer =
        hostileToPlayer &&
        actor.playerAggro &&
        (canSensePlayer || canTrackPlayer || actor.aggroMemory > 0)
      if (!shouldPursuePlayer) {
        actor.playerAggro = false
        actor.aggroMemory = 0
        actor.lastKnownTargetPos = null
      }
      let retaliationTarget: Actor | null = null
      if (actor.retaliationTimer > 0 && actor.targetId) {
        const candidate = this.actors.find((other) => other.id === actor.targetId)
        if (
          candidate?.alive &&
          candidate.id !== actor.ignoredTargetId &&
          hostile(actor.faction, candidate.faction)
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
      } else if (shouldPursuePlayer) {
        actor.targetId = null
        pursuesPlayer = true
        if (canSensePlayer || canTrackPlayer) {
          targetsPlayer = true
          targetPosition = this.player.position
        } else if (actor.lastKnownTargetPos) {
          investigatesPlayer = true
          targetPosition = actor.lastKnownTargetPos
        }
      } else if (
        actor.faction === this.faction &&
        actor.squadEligible &&
        this.squadFollowing &&
        actor.role !== 'commander'
      ) {
        targetActor = this.findNearestEnemy(actor, actor.role === 'archer' ? 15 : 9)
        if (targetActor) {
          targetPosition = targetActor.mesh.position
        } else {
          const formationAngle = actor.phase * 3.7
          const formationTarget = this.player.position
            .clone()
            .add(new THREE.Vector3(Math.sin(formationAngle) * 3.2, 0, Math.cos(formationAngle) * 3.2))
          const navigationTarget = this.getNavigationWaypoint(
            actor.mesh.position,
            formationTarget,
            colliderRadius,
            navigationSign,
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
        }
      } else if (actor.role !== 'commander') {
        targetActor =
          playerDistance < 32
            ? this.findNearestEnemy(actor, actor.role === 'archer' ? 15 : 6.5)
            : null
        if (targetActor) {
          targetPosition = targetActor.mesh.position
        } else {
          wandering = true
          let navigationTarget = this.getNavigationWaypoint(
            actor.mesh.position,
            actor.wanderTarget,
            colliderRadius,
            navigationSign,
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
              navigationSign,
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

      if (targetPosition) {
        const offset = targetPosition.clone().sub(actor.mesh.position)
        offset.y = 0
        const distance = offset.length()
        if (distance > 0.001) facingDirection.copy(offset).normalize()
        const navigationTarget = this.getNavigationWaypoint(
          actor.mesh.position,
          targetPosition,
          colliderRadius,
          navigationSign,
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
        } else if (investigatesPlayer) {
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
        } else {
          const stopDistance = targetEventProp
            ? targetEventProp.attackRange
            : targetsPlayer
              ? 2.55
              : 2.45
          if (distance > stopDistance) {
            direction.copy(facingDirection)
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
        desiredSpeed =
          actor.speed *
          (pursuesPlayer || retaliationTarget ? 1.25 : 1) *
          (enraged ? RAGE_SPEED_MULTIPLIER : 1) *
          (this.hasCommanderAura(actor) ? COMMANDER_SPEED_MULTIPLIER : 1) *
          (wandering ? actor.wanderPace : 1)
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
        travelled = this.moveActorWithSteering(actor, direction, requestedDistance)
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
  }

  private updateActorIndicators(actor: Actor): void {
    const playerDistance = actor.mesh.position.distanceTo(this.player.position)
    const ring = actor.mesh.getObjectByName('faction-ring')
    if (ring) {
      ring.visible = actor.alive && playerDistance < 42
      if (ring instanceof THREE.Mesh && ring.material instanceof THREE.MeshBasicMaterial) {
        const ragePulse = (Math.sin(this.elapsed * 14 + actor.phase) + 1) * 0.5
        ring.material.color.copy(this.factionColor(actor.faction))
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
      actor.mesh.position.y + 3.65 * actor.mesh.scale.y,
      actor.mesh.position.z,
    )
    actor.healthBar.visible =
      actor.alive &&
      hostile(actor.faction, this.faction) &&
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
    const binding = this.comicMaterials.applyOutline(root, kind)
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
        this.interactableOutlineBindings.splice(index, 1)
      }
    }
    for (let index = this.outlineBindings.length - 1; index >= 0; index -= 1) {
      if (this.objectBelongsToRoot(root, this.outlineBindings[index].root)) {
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
    actor.action = {
      kind,
      phase: 'windup',
      elapsed: 0,
      duration: this.actorWindup(actor.role),
      target,
      targetPosition: targetPosition.clone(),
      contactRange,
    }
    this.faceActorToward(actor, targetPosition, 1)
    this.acquireActorTelegraph(actor)
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
      return this.health > 0 && hostile(actor.faction, this.faction)
        ? this.player.position
        : null
    }
    if (action.target.kind === 'actor') {
      const targetId = action.target.id
      const target = this.actors.find((candidate) => candidate.id === targetId)
      return target?.alive && hostile(actor.faction, target.faction)
        ? target.mesh.position
        : null
    }
    const target = this.eventPropTargets.get(action.target.id)
    return target && target.hp > 0 ? target.position : null
  }

  private resolveActorActionContact(actor: Actor, action: ActorAction): void {
    if (action.kind === 'arrow') {
      this.fireActorArrow(actor, this.resolveActorActionTarget(actor, action) ?? action.targetPosition)
      return
    }

    const livePosition = this.resolveActorActionTarget(actor, action)
    if (
      !livePosition ||
      actor.mesh.position.distanceTo(livePosition) >
        action.contactRange + CONTACT_RANGE_FORGIVENESS
    ) {
      return
    }
    if (action.kind === 'meleePlayer') {
      this.actorAttackPlayer(actor)
      return
    }
    if (action.kind === 'meleeActor' && action.target.kind === 'actor') {
      const targetId = action.target.id
      const target = this.actors.find((candidate) => candidate.id === targetId)
      if (target?.alive && hostile(actor.faction, target.faction)) {
        this.actorAttackActor(actor, target)
      }
      return
    }
    if (action.kind === 'eventProp' && action.target.kind === 'eventProp') {
      const target = this.eventPropTargets.get(action.target.id)
      if (target && target.hp > 0) this.actorAttackEventProp(actor, target)
    }
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
    entry.mesh.position.set(actor.mesh.position.x, TELEGRAPH_Y, actor.mesh.position.z)
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
      if (!actor.alive || !hostile(this.faction, actor.faction)) continue
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
      this.presentCombatFeedback(event, { callout: false, hitStop: false })
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
      actor.faction,
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
    faction: Faction,
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
        color: this.factionColor(faction),
        emissive: this.factionColor(faction),
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
      faction,
      damage,
      sourceActorId,
      travelled: 0,
      detachChance,
    })
  }

  private updateCommander(actor: Actor, delta: number): void {
    actor.reinforcementTimer -= delta
    if (actor.reinforcementTimer > 0) return
    actor.reinforcementTimer += COMMANDER_REINFORCEMENT_INTERVAL
    if (
      actor.reinforcementsCalled >= COMMANDER_REINFORCEMENT_LIMIT ||
      this.actors.length >= MAX_ACTORS
    ) {
      return
    }

    const angle = actor.phase + actor.reinforcementsCalled * 1.9
    const position = actor.mesh.position.clone().add(
      new THREE.Vector3(Math.sin(angle) * 3.2, 0, Math.cos(angle) * 3.2),
    )
    this.spawnActor(
      actor.faction,
      'soldier',
      position.x,
      position.z,
      this.actors.length,
    )
    actor.reinforcementsCalled += 1
    if (actor.mesh.position.distanceTo(this.player.position) < 35) {
      this.callbacks.onNotice('Командир вызвал подкрепление!', 'warning')
    }
  }

  private hasCommanderAura(actor: Actor): boolean {
    return this.actors.some(
      (other) =>
        other !== actor &&
        other.alive &&
        other.role === 'commander' &&
        other.reaction !== 'stagger' &&
        other.faction === actor.faction &&
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
      actor.wanderTarget.set(x, 0, z)
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
      const minimumDistance = actor.faction === other.faction ? 1.45 : 1.15
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
    this.caravan.position.x += this.caravanDirection * delta * 3.4
    if (this.caravan.position.x > 58) this.caravanDirection = -1
    if (this.caravan.position.x < -58) this.caravanDirection = 1
    this.caravan.rotation.y = this.caravanDirection > 0 ? 0 : Math.PI
    const wheels = this.caravan.getObjectsByProperty('name', 'wheel')
    for (const wheel of wheels) wheel.rotation.z -= delta * (3.4 / 0.9)
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
            projectile.faction,
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
        Math.abs(end.x) > WORLD_HALF + 4 ||
        Math.abs(end.z) > WORLD_HALF + 4 ||
        end.y < -1
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
    if (projectile.owner === 'actor' && hostile(projectile.faction, this.faction)) {
      const playerCenter = this.player.position.clone().add(new THREE.Vector3(0, 1.45, 0))
      const fraction = this.segmentSphereHit(start, end, playerCenter, PROJECTILE_HIT_RADIUS)
      if (fraction !== null) nearest = { fraction, actor: null, player: true }
    }

    for (const actor of this.actors) {
      if (!actor.alive || !hostile(projectile.faction, actor.faction)) continue
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
        particle.mesh.position.y <= GORE_GROUND_Y &&
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
    const position = this.player.position
    const eventPrompt = this.activeEvent?.getPrompt?.()
    if (eventPrompt) {
      this.prompt = eventPrompt
    } else if (this.hasElfLoot() && position.distanceTo(this.elfHomePosition) < 6) {
      const guards = this.objectives.find((objective) => objective.id === 'guards')
      this.prompt = this.isObjectiveDone('guards')
        ? '[E] Сдать добычу'
        : `[E] Проверить добычу • охрана ${guards?.progress ?? 0}/${guards?.target ?? 4}`
    } else if (position.distanceTo(this.vendorPosition) < 6) {
      this.prompt = '[E] Лавка лекаря и механика'
    } else if (
      this.faction === 'guard' &&
      position.distanceTo(this.commanderPosition) < 6 &&
      this.actors.some((actor) => actor.role === 'commander' && actor.alive)
    ) {
      this.prompt = '[E] Выслушать командира'
    } else if (position.distanceTo(this.caravan.position) < 7) {
      this.prompt =
        this.faction === 'guard'
          ? '[E] Проверить корован'
          : this.caravanCooldown > 0
            ? 'Корован уже разграблен'
            : '[E] ГРАБИТЬ КОРОВАН'
    } else {
      this.prompt = document.pointerLockElement === this.renderer.domElement ? '' : 'Нажмите на мир, чтобы управлять камерой'
    }
  }

  private updateMission(): void {
    const currentZone = zoneAt(this.player.position.x, this.player.position.z)
    if (currentZone !== this.lastZone) {
      this.lastZone = currentZone
      this.achievements.recordZone(currentZone)
      this.callbacks.onNotice(`Новая область: ${this.zoneName(currentZone)}`, 'info')
      if (this.faction === 'villain' && currentZone === 'palace') this.completeObjective('breach')
    }

    if (
      this.faction === 'guard' &&
      currentZone === 'fort' &&
      this.isObjectiveDone('orders') &&
      this.isObjectiveDone('defend')
    ) {
      this.completeObjective('patrol')
    }
    if (!this.campaignCompleted && this.objectives.every((objective) => objective.done)) {
      this.campaignCompleted = true
      this.campaignCompletedAt = this.elapsed
      this.gold += 250
      this.eventCooldown = Math.min(this.eventCooldown, 12)
      this.callbacks.onNotice(
        'Кампания завершена! +250 золота. Мир остаётся открытым для свободной игры.',
        'success',
      )
      this.playSound('victory')
      this.emitView(true)
    }
  }

  private updateThreat(): void {
    const nextTier = getThreatTier(this.elapsed)
    if (nextTier > this.threatTier) {
      this.threatTier = nextTier
      this.callbacks.onNotice(
        `Угроза усилилась: уровень ${this.threatTier}/${MAX_THREAT_TIER}. Враги крепче, события и налёты чаще.`,
        'warning',
      )
      this.playSound('event')
      this.emitView(true)
    }

    if (
      this.threatTier < 2 ||
      this.elapsed < this.nextThreatWaveAt ||
      this.activeEvent
    ) {
      return
    }

    const scheduledAt = this.nextThreatWaveAt
    this.nextThreatWaveAt = this.elapsed + this.threatWaveInterval()
    const spawned = this.spawnThreatWave(scheduledAt)
    if (spawned > 0) {
      this.callbacks.onNotice(
        `Вражеский налёт: бойцов ${spawned}. Уровень угрозы ${this.threatTier}.`,
        'warning',
      )
      this.playSound('event')
    }
  }

  private eventCooldownRange(): { min: number; max: number } {
    const tierOffset = this.threatTier - 1
    return {
      min: Math.max(30, EVENT_COOLDOWN_MIN - tierOffset * 5),
      max: Math.max(42, EVENT_COOLDOWN_MAX - tierOffset * 7),
    }
  }

  private threatWaveInterval(): number {
    return Math.max(THREAT_WAVE_MIN_INTERVAL, 130 - this.threatTier * 12)
  }

  private enemyHealthMultiplier(faction: Faction): number {
    return hostile(this.faction, faction) ? 1 + (this.threatTier - 1) * 0.12 : 1
  }

  private enemyDamageMultiplier(actor: Actor): number {
    return hostile(this.faction, actor.faction) ? 1 + (this.threatTier - 1) * 0.09 : 1
  }

  private spawnThreatWave(scheduledAt: number): number {
    const availableSlots = Math.max(0, MAX_ACTORS - this.actors.length)
    const requested = Math.min(4, this.threatTier)
    const count = Math.min(availableSlots, requested)
    if (count === 0) return 0

    const enemyFaction: Faction = this.faction === 'guard' ? 'villain' : 'guard'
    let spawned = 0
    const baseAngle = scheduledAt * 0.037 + this.threatTier * 1.7
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
        const x = THREE.MathUtils.clamp(
          this.player.position.x + Math.sin(angle) * radius,
          -WORLD_HALF + 3,
          WORLD_HALF - 3,
        )
        const z = THREE.MathUtils.clamp(
          this.player.position.z + Math.cos(angle) * radius,
          -WORLD_HALF + 3,
          WORLD_HALF - 3,
        )
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
        { objectiveEligible: false, squadEligible: false },
      )
      actor.playerAggro = true
      actor.aggroMemory = AGGRO_MEMORY_DURATION
      actor.lastKnownTargetPos = this.player.position.clone()
      spawned += 1
    }
    return spawned
  }

  private cleanupDeadActors(): void {
    for (let index = this.actors.length - 1; index >= 0; index -= 1) {
      const actor = this.actors[index]
      if (this.activeEvent?.ownedActorIds.includes(actor.id)) continue
      if (actor.deathAt !== null && this.elapsed - actor.deathAt >= CORPSE_LIFETIME) {
        this.removeActorById(actor.id)
      }
    }
  }

  private updateEvents(delta: number): void {
    if (this.ended) {
      this.cancelActiveEvent()
      return
    }

    const event = this.activeEvent
    if (event) {
      if (event.state === 'active') {
        event.update?.(delta)
        if (event.state === 'active' && event.timer !== null) {
          event.timer = Math.max(0, event.timer - delta)
          if (event.timer <= 0) event.state = 'failed'
        }
      }
      if (event.state !== 'active') this.finishEvent(event.state === 'succeeded')
      return
    }

    this.eventCooldown = Math.max(0, this.eventCooldown - delta)
    if (this.eventCooldown > 0) return
    if (!this.startRandomEvent()) this.eventCooldown = EVENT_RETRY
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

    this.activeEvent = event
    this.callbacks.onNotice(`Событие: ${event.title}. ${event.description}`, event.tone)
    this.playSound('event')
    this.emitView(true)
    return true
  }

  private getEligibleEventKinds(): WorldEventKind[] {
    const kinds: WorldEventKind[] = [
      'richCaravan',
      'defendHome',
      'champion',
      'rescue',
      'bounty',
    ]
    return kinds.filter((kind) => {
      if (kind === 'bounty') {
        return this.getEligibleBountyTargets().length > 0 || this.actors.length < MAX_ACTORS
      }
      if (kind === 'defendHome' && this.villageHouses.length === 0) return false
      return this.actors.length + EVENT_REQUIRED_SLOTS[kind] <= MAX_ACTORS
    })
  }

  private finishEvent(succeeded: boolean): void {
    const event = this.activeEvent
    if (!event) return

    let message: string
    if (succeeded) {
      this.achievements.recordWorldEvent(event.kind, true)
      if (event.kind === 'richCaravan') {
        this.gold += 180
        this.achievements.recordGoldEarned(180)
        this.achievements.recordCaravanRobbed(true)
        message = 'Богатый корован ограблен, а погоня отстала. +180 золота.'
      } else if (event.kind === 'defendHome') {
        this.gold += 90
        this.achievements.recordGoldEarned(90)
        this.health = Math.min(this.maxHealth, this.health + 8)
        message = 'Дом отстояли! +90 золота и +8 здоровья.'
      } else if (event.kind === 'champion') {
        this.gold += 120
        this.achievements.recordGoldEarned(120)
        const damageBonus = Math.min(
          6,
          Math.max(0, CHAMPION_DAMAGE_CAP - this.championDamageBonus),
        )
        this.championDamageBonus += damageBonus
        this.damage += damageBonus
        message =
          damageBonus > 0
            ? `Чемпион повержен! +120 золота и +${damageBonus} урона.`
            : 'Чемпион повержен! +120 золота. Предел бонуса урона уже достигнут.'
      } else if (event.kind === 'rescue') {
        message = 'Пленник спасён и присоединился к вашему отряду.'
      } else {
        this.gold += 70
        this.achievements.recordGoldEarned(70)
        message = 'Награда за цель получена. +70 золота.'
      }
      this.callbacks.onNotice(message, 'success')
      this.playSound('eventWin')
    } else {
      this.achievements.recordWorldEvent(event.kind, false)
      const failureMessages: Record<WorldEventKind, string> = {
        richCaravan: 'Богатый корован ушёл вместе с добычей.',
        defendHome: 'Дом не удалось защитить — огонь взял своё.',
        champion: 'Чемпион скрылся.',
        rescue: 'Пленника спасти не удалось.',
        bounty: 'Срок награды истёк. Цель больше не отмечена.',
      }
      this.callbacks.onNotice(failureMessages[event.kind], 'danger')
      this.playSound('eventFail')
    }

    event.cleanup()
    this.activeEvent = null
    const cooldown = this.eventCooldownRange()
    this.eventCooldown = cooldown.min + this.eventRng() * (cooldown.max - cooldown.min)
    this.emitView(true)
  }

  private cancelActiveEvent(): void {
    if (!this.activeEvent) return
    this.activeEvent.cleanup()
    this.activeEvent = null
  }

  private createWorldEvent(config: Omit<WorldEvent, 'cleanup'>): WorldEvent {
    let cleaned = false
    const event: WorldEvent = {
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
    if (this.actors.length + EVENT_REQUIRED_SLOTS.richCaravan > MAX_ACTORS) return null

    const id = this.nextEventId('richCaravan')
    const caravan = this.createCaravan(true)
    const roadX = this.pickEventRoadX()
    caravan.position.set(roadX, 0, -23)
    this.scene.add(caravan)
    this.registerNamedInteractableOutline(caravan, 'cargo')

    const enemyFaction = this.pickEventEnemyFaction()
    const ownedActorIds: string[] = []
    const escortOffsets: Array<[number, number]> = [
      [-4.5, -4],
      [0, 4.5],
      [4.5, -4],
    ]
    escortOffsets.forEach(([x, z], index) => {
      const escort = this.spawnActor(
        enemyFaction,
        index === 1 ? 'brute' : 'soldier',
        THREE.MathUtils.clamp(roadX + x, -WORLD_HALF + 3, WORLD_HALF - 3),
        -23 + z,
        this.actors.length + index,
        {
          objectiveEligible: false,
          squadEligible: false,
          eventOwnerId: id,
        },
      )
      ownedActorIds.push(escort.id)
    })

    let robbed = false
    let robberyPoint: THREE.Vector3 | null = null
    let direction = roadX > 0 ? -1 : 1
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'richCaravan',
      state: 'active',
      title: 'Золотой корован',
      description: 'Ограбьте обоз и оторвитесь от места налёта на 18 метров.',
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
          caravan.position.x += direction * delta * 2.8
          if (caravan.position.x > 58) direction = -1
          if (caravan.position.x < -58) direction = 1
          caravan.rotation.y = direction > 0 ? 0 : Math.PI
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
          escort.home.set(caravan.position.x + x, 0, caravan.position.z + z)
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
          event.description = 'Уходите от места налёта на 18 метров до конца отсчёта.'
          event.markerPos.copy(robberyPoint)
          const cargo = caravan.getObjectByName('cargo')
          if (cargo instanceof THREE.Mesh) cargo.scale.y = 0.38
          this.callbacks.onNotice('Добыча у вас. Теперь оторвитесь от погони!', 'warning')
          this.playSound('coin')
        }
        return true
      },
      getPrompt: () =>
        !robbed && this.player.position.distanceTo(caravan.position) < 7
          ? '[E] Ограбить золотой корован'
          : null,
    })
    return event
  }

  private startDefendHomeEvent(): WorldEvent | null {
    if (
      this.villageHouses.length === 0 ||
      this.actors.length + EVENT_REQUIRED_SLOTS.defendHome > MAX_ACTORS
    ) {
      return null
    }

    const id = this.nextEventId('defendHome')
    const house =
      this.villageHouses[Math.floor(this.eventRng() * this.villageHouses.length)]
    const target: EventPropTarget = {
      id: `${id}-home`,
      ownerId: id,
      object: house,
      hp: 100,
      maxHp: 100,
      position: house.position.clone(),
      attackRange: 5.2,
    }
    this.eventPropTargets.set(target.id, target)
    const fire = this.createHouseFireEffect(target.position)
    this.scene.add(fire)
    this.spawnDecal(target.position, 'scorch', 4.8)

    const enemyFaction = this.pickEventEnemyFaction()
    const ownedActorIds: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2 + this.eventRng() * 0.45
      const radius = 17 + this.eventRng() * 4
      const attacker = this.spawnActor(
        enemyFaction,
        index === 3 ? 'brute' : 'soldier',
        THREE.MathUtils.clamp(
          target.position.x + Math.sin(angle) * radius,
          -WORLD_HALF + 3,
          WORLD_HALF - 3,
        ),
        THREE.MathUtils.clamp(
          target.position.z + Math.cos(angle) * radius,
          -WORLD_HALF + 3,
          WORLD_HALF - 3,
        ),
        this.actors.length + index,
        {
          objectiveEligible: false,
          squadEligible: false,
          aiMode: 'attackEventProp',
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
      description: 'Уничтожьте четырёх налётчиков, пока дом ещё стоит.',
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
        event.description = `Уничтожьте налётчиков. Прочность дома: ${Math.ceil(target.hp)}/${target.maxHp}.`
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
    if (this.actors.length + EVENT_REQUIRED_SLOTS.champion > MAX_ACTORS) return null

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
        eventOwnerId: id,
      },
    )
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'champion',
      state: 'active',
      title: 'Странствующий чемпион',
      description: 'Отыщите и победите элитного бойца.',
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
    if (this.actors.length + EVENT_REQUIRED_SLOTS.rescue > MAX_ACTORS) return null

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
        eventOwnerId: id,
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
          eventOwnerId: id,
          ignoredTargetId: captive.id,
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
          eventOwnerId: id,
          ignoredTargetId: captive.id,
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
      captive.aiMode = 'normal'
      captive.squadEligible = true
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
      description: 'Убейте охрану или освободите живого пленника лично.',
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
    const id = this.nextEventId('bounty')
    const candidates = this.getEligibleBountyTargets()
    let spawned = false
    let target =
      candidates.length > 0
        ? candidates[Math.floor(this.eventRng() * candidates.length)]
        : null
    if (!target) {
      if (this.actors.length >= MAX_ACTORS) return null
      const position = this.pickEventPosition()
      target = this.spawnActor(
        this.pickEventEnemyFaction(),
        'soldier',
        position.x,
        position.z,
        this.actors.length,
        {
          objectiveEligible: false,
          squadEligible: false,
          eventOwnerId: id,
        },
      )
      spawned = true
    }

    const bountyTarget = target
    let event: WorldEvent
    event = this.createWorldEvent({
      id,
      kind: 'bounty',
      state: 'active',
      title: 'Награда за голову',
      description: 'Уничтожьте отмеченную цель за 40 секунд.',
      tone: 'info',
      timer: 40,
      progress: 0,
      target: 1,
      markerId: `${id}-marker`,
      markerPos: bountyTarget.mesh.position.clone(),
      ownedActorIds: spawned ? [bountyTarget.id] : [],
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

  private getEligibleBountyTargets(): Actor[] {
    return this.actors.filter(
      (actor) =>
        actor.alive &&
        hostile(this.faction, actor.faction) &&
        actor.role !== 'commander' &&
        actor.role !== 'captive' &&
        !actor.eventOwnerId,
    )
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
    const candidates = [
      new THREE.Vector3(-54, 0, -13),
      new THREE.Vector3(-29, 0, 18),
      new THREE.Vector3(-12, 0, 55),
      new THREE.Vector3(18, 0, -51),
      new THREE.Vector3(39, 0, 13),
      new THREE.Vector3(57, 0, 34),
      new THREE.Vector3(13, 0, 57),
      new THREE.Vector3(54, 0, -12),
    ]
    const distant = candidates.filter(
      (position) => position.distanceTo(this.player.position) >= 22,
    )
    const pool = distant.length > 0 ? distant : candidates
    return pool[Math.floor(this.eventRng() * pool.length)].clone()
  }

  private pickEventRoadX(): number {
    const candidates = [-54, -30, -5, 24, 52]
    const distant = candidates.filter(
      (x) => this.player.position.distanceTo(new THREE.Vector3(x, 0, -23)) >= 20,
    )
    const pool = distant.length > 0 ? distant : candidates
    return pool[Math.floor(this.eventRng() * pool.length)]
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
      if (child instanceof THREE.Mesh) geometries.add(child.geometry)
      const material = child.material
      if (Array.isArray(material)) material.forEach((entry) => materials.add(entry))
      else materials.add(material)
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => {
      if (!ComicMaterialLibrary.isLibraryOwned(material)) material.dispose()
    })
  }

  private actorAttackPlayer(actor: Actor): void {
    const baseDamage =
      actor.role === 'commander'
        ? 10
        : actor.role === 'champion'
          ? 17
          : actor.role === 'brute'
            ? 14
            : 6 + Math.random() * 3
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
    const baseDamage =
      attacker.role === 'commander'
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
      attacker.faction,
      false,
      { attackKind: 'allyMelee', sourceActorId: attacker.id },
    )
  }

  private actorAttackEventProp(actor: Actor, target: EventPropTarget): void {
    target.hp = Math.max(0, target.hp - (4 + this.eventRng() * 2))
    this.createHitParticles(target.position, actor.faction)
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
    this.playSound(frontalBlock ? 'block' : 'hurt')
    if (canInjure && !frontalBlock && Math.random() < 0.11 && this.health < 82) {
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
    killerFaction: Faction,
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
      hostile(target.faction, this.faction)
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
        hostile(target.faction, sourceActor.faction)
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
    this.createHitParticles(target.mesh.position, target.faction)
    if (directPlayerKill && target.hp > 0) {
      this.playSound(impact >= 0.55 ? 'hitHeavy' : 'hitLight', {
        position: target.mesh.position,
        intensity: impact,
        variantSeed: this.actorSequence + target.id.length,
      })
    }
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
        killerFaction,
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
        actor.faction !== source.faction ||
        !hostile(actor.faction, this.faction) ||
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
    killerFaction: Faction,
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
    this.playSound('down', {
      position: deathPosition,
      intensity: largeBody ? 1 : 0.65,
      variantSeed: this.actorSequence + actor.id.length,
    })

    const objectiveAdvanced =
      killerFaction === this.faction && this.creditFactionObjective(actor)
    this.activeEvent?.onKill?.(actor, { killerFaction, directPlayerKill })
    if (!directPlayerKill) {
      if (objectiveAdvanced) {
        this.callbacks.onNotice('Союзник победил врага. Счётчик задачи обновлён.', 'info')
        this.emitView(true)
      }

      return
    }

    this.kills += 1
    this.achievements.recordKill(actor.role, actor.faction)
    if (actor.eventOwnerId) {
      this.emitView(true)
      return
    }
    const reward = actor.role === 'commander' ? 55 : 12
    this.gold += reward
    this.achievements.recordGoldEarned(reward)
    this.callbacks.onNotice(
      actor.role === 'commander' ? 'Командир дворца повержен!' : `Враг повержен. +${reward} золота`,
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
      0.62,
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
    const part = available[Math.floor(Math.random() * available.length)]
    const wasWounded = this.body[part] === 'wounded'
    const severe = wasWounded || Math.random() < 0.4
    if (severe) {
      this.body[part] = 'missing'
      this.achievements.recordInjury(part, true)
      if (!part.includes('Eye')) {
        this.body.bleeding = Math.min(2.1, this.body.bleeding + (part.includes('Leg') ? 0.48 : 0.34))
        this.hidePlayerLimb(part)
      }
      this.callbacks.onNotice(
        part.includes('Eye')
          ? `Тяжёлая травма: потерян ${formatPart(part)}. Часть обзора закрыта.`
          : `Тяжёлая травма: потеряна ${formatPart(part)}! Найдите лекаря, иначе истечёте кровью.`,
        'danger',
      )
    } else {
      this.body[part] = 'wounded'
      this.achievements.recordInjury(part, false)
      this.body.bleeding = Math.min(1.2, this.body.bleeding + 0.12)
      this.callbacks.onNotice(`Ранение: ${formatPart(part)}.`, 'warning')
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
      this.comicMaterials.createToonMaterial({
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
      if (!(object instanceof THREE.Mesh) || object.userData.comicOutline === true) return
      object.material = this.comicMaterials.createToonMaterial({
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
      this.comicMaterials.createToonMaterial({
        color: this.factionColor(actor.faction),
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
    if (
      !this.activeEvent &&
      this.objectives.filter((entry) => entry.done).length === 1
    ) {
      this.eventCooldown = 0
    }
    this.callbacks.onNotice(`Задача выполнена: ${objective.text}`, 'success')
    this.achievements.recordObjectiveCompleted()
    this.playSound('objective')
    this.emitView(true)
    return true
  }

  private incrementObjective(id: string): boolean {
    const objective = this.objectives.find((entry) => entry.id === id)
    if (!objective || objective.done) return false
    objective.progress = Math.min(objective.target ?? 1, (objective.progress ?? 0) + 1)
    if (objective.progress >= (objective.target ?? 1)) {
      const completed = this.completeObjective(id)
      if (completed && this.faction === 'elf' && id === 'guards' && this.isObjectiveDone('raid')) {
        this.callbacks.onNotice(
          'Путь свободен. Сдайте добычу у зелёного маяка в эльфийском лагере — цель отмечена на карте.',
          'info',
        )
      }
    }
    return true
  }

  private isObjectiveDone(id: string): boolean {
    return this.objectives.some((objective) => objective.id === id && objective.done)
  }

  private creditFactionObjective(actor: Actor): boolean {
    if (!actor.objectiveEligible) return false
    if (this.faction === 'elf' && actor.faction === 'guard') {
      return this.incrementObjective('guards')
    }
    if (this.faction === 'guard' && actor.faction !== 'guard') {
      return this.incrementObjective('defend')
    }
    if (this.faction === 'villain' && actor.role === 'commander') {
      return this.completeObjective('commander')
    }
    return false
  }

  private hasElfLoot(): boolean {
    return (
      this.faction === 'elf' &&
      this.isObjectiveDone('raid') &&
      !this.isObjectiveDone('home')
    )
  }

  private endGame(result: 'victory' | 'defeat'): void {
    if (this.ended) return
    this.dropShield()
    this.cancelActiveEvent()
    this.clearTransientCombatFeedback()
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
      { id: 'village', x: -46, z: -39, kind: 'landmark' },
      { id: 'palace', x: 42, z: -42, kind: 'landmark' },
      { id: 'forest', x: -45, z: 42, kind: 'landmark' },
      { id: 'fort', x: 45, z: 44, kind: 'landmark' },
    ]
    if (this.hasElfLoot()) {
      markers.push({
        id: 'loot-turn-in',
        x: this.elfHomePosition.x,
        z: this.elfHomePosition.z,
        kind: 'objective',
        label: this.isObjectiveDone('guards')
          ? 'Сдать добычу'
          : 'Лагерь эльфов: сдача добычи',
      })
    }
    if (this.activeEvent) {
      markers.push({
        id: this.activeEvent.markerId,
        x: this.activeEvent.markerPos.x,
        z: this.activeEvent.markerPos.z,
        kind: 'event',
        label: this.activeEvent.title,
      })
    }
    for (const actor of this.actors) {
      if (!actor.alive) continue
      markers.push({
        id: actor.id,
        x: actor.mesh.position.x,
        z: actor.mesh.position.z,
        kind: actor.faction === this.faction ? 'ally' : 'enemy',
      })
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
      zone: zoneAt(this.player.position.x, this.player.position.z),
      body: { ...this.body },
      objectives: this.objectives.map((objective) => ({ ...objective })),
      prompt: this.prompt,
      markers,
      squad: this.actors.filter(
        (actor) =>
          actor.alive &&
          actor.faction === this.faction &&
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
      activeEvent: this.activeEvent
        ? {
            id: this.activeEvent.id,
            kind: this.activeEvent.kind,
            title: this.activeEvent.title,
            description: this.activeEvent.description,
            tone: this.activeEvent.tone,
            progress: this.activeEvent.progress,
            target: this.activeEvent.target,
            ...(this.activeEvent.timer === null
              ? {}
              : { timeRemaining: Math.max(0, this.activeEvent.timer) }),
          }
        : null,
    }
    this.callbacks.onView(view)
  }

  private setupLights(): void {
    this.hemisphere = new THREE.HemisphereLight(
      this.palette.worldSky,
      this.palette.worldAmbientGround,
      1.65,
    )
    this.scene.add(this.hemisphere)
    this.sun = new THREE.DirectionalLight(this.palette.worldSun, 2.65)
    this.sun.position.set(-35, 58, 24)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.left = -85
    this.sun.shadow.camera.right = 85
    this.sun.shadow.camera.top = 85
    this.sun.shadow.camera.bottom = -85
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 150
    this.sun.target.position.set(0, 0, 0)
    this.scene.add(this.sun, this.sun.target)
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
    pattern: 'grass' | 'dirt' | 'stone' | 'scree' | 'wood' | 'roof',
    repeatX: number,
    repeatY: number,
  ): THREE.CanvasTexture {
    const cached = this.generatedTextures.get(key)
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
    for (const character of key) seed = (seed * 31 + character.charCodeAt(0)) % 2147483647
    const random = seededRandom(Math.max(1, seed))
    const light = mix(detail, this.palette.surface, 0.34)
    const dark = mix(detail, this.palette.text, 0.3)

    if (pattern === 'grass') {
      for (let index = 0; index < 210; index += 1) {
        context.fillStyle = (index % 5 === 0 ? light : index % 3 === 0 ? dark : detail).getStyle()
        const x = Math.floor(random() * 64)
        const y = Math.floor(random() * 64)
        context.fillRect(x, y, index % 7 === 0 ? 2 : 1, 1 + Math.floor(random() * 3))
      }
    } else if (pattern === 'dirt' || pattern === 'scree') {
      const count = pattern === 'scree' ? 175 : 130
      for (let index = 0; index < count; index += 1) {
        context.fillStyle = (index % 4 === 0 ? light : index % 2 === 0 ? dark : detail).getStyle()
        const size = pattern === 'scree' ? 1 + Math.floor(random() * 4) : 1 + Math.floor(random() * 2)
        context.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), size, size)
      }
    } else if (pattern === 'stone') {
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
    } else if (pattern === 'wood') {
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

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeatX, repeatY)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.generatedTextures.set(key, texture)
    return texture
  }

  private createAtmosphere(): void {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create sky texture')
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, this.palette.worldSky.getStyle())
    gradient.addColorStop(0.58, this.palette.worldHorizon.getStyle())
    gradient.addColorStop(1, this.palette.worldFog.getStyle())
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
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
    this.scene.add(sky)

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
    this.scene.add(this.sunDisc)

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
    this.scene.add(this.moonDisc)

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
    this.scene.add(this.stars)

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
      this.scene.add(group)
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
    for (const weatherKind of WEATHER_KINDS) {
      this.weatherWeights[weatherKind] = weatherKind === kind ? 1 : 0
    }
  }

  private updateWeather(delta: number): void {
    if (!this.weatherEnabled) {
      this.restoreWeatherVisuals()
      return
    }

    const nextZone = this.resolveWeatherZone()
    if (nextZone !== this.weatherZone) {
      this.weatherZone = nextZone
      this.setWeatherTarget(WEATHER_BY_ZONE[nextZone])
    }
    this.updateWeatherWeights(delta)
    this.applyWeatherEnvironment()
    this.updatePrecipitation(delta)
    this.updateLightning(delta)
  }

  private resolveWeatherZone(): ZoneId {
    const x = this.player.position.x
    const z = this.player.position.z
    if (
      Math.abs(x) < WEATHER_ZONE_HYSTERESIS ||
      Math.abs(z) < WEATHER_ZONE_HYSTERESIS
    ) {
      return this.weatherZone
    }
    return zoneAt(x, z)
  }

  private updateWeatherWeights(delta: number): void {
    if (delta <= 0) return
    const response = 1 - Math.exp(-WEATHER_RESPONSE_RATE * delta)
    let total = 0
    for (const kind of WEATHER_KINDS) {
      const target = kind === this.weatherTarget ? 1 : 0
      this.weatherWeights[kind] +=
        (target - this.weatherWeights[kind]) * response
      total += this.weatherWeights[kind]
    }
    if (total <= 0) return
    for (const kind of WEATHER_KINDS) {
      this.weatherWeights[kind] /= total
    }
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
    this.groundFoliageUniforms.uWindStrength.value = Math.min(
      GROUND_FOLIAGE_MAX_WIND_STRENGTH,
      this.weightedWeatherValue('windStrength'),
    )
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
    this.groundFoliageUniforms.uWindStrength.value =
      GROUND_FOLIAGE_DEFAULT_WIND_STRENGTH
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
    const wind = this.groundFoliageUniforms.uWindDirection.value
    const windStrength = this.groundFoliageUniforms.uWindStrength.value
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
    const wind = this.groundFoliageUniforms.uWindDirection.value
    const windStrength = this.groundFoliageUniforms.uWindStrength.value
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

  private createGroundDetails(): void {
    this.createPebbles()
    this.rebuildGroundFoliage()
  }

  private createPebbles(): void {
    const placements = this.createGroundDetailPlacements('fort', 110, 4871, 'pebbles')
    const pebbles = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.26, 0),
      new THREE.MeshStandardMaterial({
        color: mix(this.palette.borderStrong, this.palette.accent, 0.22),
        roughness: 1,
      }),
      placements.length,
    )
    const dummy = new THREE.Object3D()
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]
      dummy.position.set(placement.x, 0.14, placement.z)
      dummy.rotation.set(
        placement.width * TWO_PI,
        placement.yaw,
        placement.tone * TWO_PI,
      )
      dummy.scale.set(
        0.45 + placement.width * 1.5,
        0.4 + placement.height * 0.7,
        0.45 + placement.tone * 1.5,
      )
      dummy.updateMatrix()
      pebbles.setMatrixAt(index, dummy.matrix)
    }
    pebbles.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    pebbles.instanceMatrix.needsUpdate = true
    pebbles.computeBoundingSphere()
    this.scene.add(pebbles)
  }

  private rebuildGroundFoliage(): void {
    this.clearGroundFoliage()
    if (this.groundFoliageQuality === 'off') return
    this.createGrassFoliage()
    this.createFernFoliage()
    this.createFlowerFoliage()
  }

  private clearGroundFoliage(): void {
    for (const mesh of this.groundFoliageMeshes) {
      mesh.removeFromParent()
      mesh.dispose()
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => material.dispose())
    }
    this.groundFoliageMeshes.length = 0
  }

  private createGrassFoliage(): void {
    const placements = this.collectGroundFoliagePlacements('grass')
    if (placements.length === 0) return

    const geometry = new THREE.ConeGeometry(0.1, GRASS_FOLIAGE_HEIGHT, 3).translate(
      0,
      GRASS_FOLIAGE_HEIGHT * 0.5,
      0,
    )
    const material = this.createGroundFoliageMaterial(
      { color: 0xffffff, flatShading: true, roughness: 1 },
      GRASS_FOLIAGE_HEIGHT,
      GRASS_FOLIAGE_SWAY,
    )
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const zoneColors: Record<ZoneId, THREE.Color> = {
      neutral: mix(this.palette.worldNeutralGround, this.palette.success, 0.52),
      forest: mix(this.palette.worldForestGround, this.palette.success, 0.58),
      fort: mix(this.palette.worldFortGround, this.palette.warning, 0.34),
      palace: mix(this.palette.worldPalaceGround, this.palette.success, 0.32),
    }

    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]
      const scale = GRASS_FOLIAGE_SCALES[placement.zone]
      const width = THREE.MathUtils.lerp(scale.width[0], scale.width[1], placement.width)
      const height = THREE.MathUtils.lerp(scale.height[0], scale.height[1], placement.height)
      dummy.position.set(placement.x, 0.02, placement.z)
      dummy.rotation.set(0, placement.yaw, 0)
      dummy.scale.set(width, height, width)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      color
        .copy(zoneColors[placement.zone])
        .lerp(this.palette.worldHorizon, placement.tone * 0.12)
      mesh.setColorAt(index, color)
    }

    this.addGroundFoliageMesh(mesh, GRASS_FOLIAGE_SWAY)
  }

  private createFernFoliage(): void {
    const placements = this.collectGroundFoliagePlacements('fern')
    if (placements.length === 0) return

    const material = this.createGroundFoliageMaterial(
      { color: 0xffffff, flatShading: true, roughness: 1, side: THREE.DoubleSide },
      FERN_FOLIAGE_HEIGHT,
      FERN_FOLIAGE_SWAY,
    )
    const mesh = new THREE.InstancedMesh(
      this.createFernGeometry(),
      material,
      placements.length,
    )
    const dummy = new THREE.Object3D()
    const baseColor = mix(this.palette.worldForestGround, this.palette.success, 0.62)
    const color = new THREE.Color()

    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]
      const width = 0.78 + placement.width * 0.58
      const height = 0.85 + placement.height * 0.55
      dummy.position.set(placement.x, 0.02, placement.z)
      dummy.rotation.set(0, placement.yaw, 0)
      dummy.scale.set(width, height, width)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      color.copy(baseColor).lerp(this.palette.worldHorizon, placement.tone * 0.1)
      mesh.setColorAt(index, color)
    }

    this.addGroundFoliageMesh(mesh, FERN_FOLIAGE_SWAY)
  }

  private createFlowerFoliage(): void {
    const placements = this.collectGroundFoliagePlacements('flower')
    if (placements.length === 0) return

    const material = this.createGroundFoliageMaterial(
      { color: 0xffffff, roughness: 0.86, vertexColors: true },
      FLOWER_FOLIAGE_HEIGHT,
      FLOWER_FOLIAGE_SWAY,
    )
    const mesh = new THREE.InstancedMesh(
      this.createFlowerGeometry(),
      material,
      placements.length,
    )
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()

    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]
      const width = 0.78 + placement.width * 0.42
      const height = 0.82 + placement.height * 0.48
      dummy.position.set(placement.x, 0.02, placement.z)
      dummy.rotation.set(0, placement.yaw, 0)
      dummy.scale.set(width, height, width)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      const tint = 0.9 + placement.tone * 0.1
      color.setRGB(tint, tint, tint)
      mesh.setColorAt(index, color)
    }

    this.addGroundFoliageMesh(mesh, FLOWER_FOLIAGE_SWAY)
  }

  private collectGroundFoliagePlacements(
    bucket: GroundFoliageBucket,
  ): GroundFoliagePlacement[] {
    const placements: GroundFoliagePlacement[] = []
    for (const zone of GROUND_FOLIAGE_ZONES) {
      const count = this.groundFoliageCount(bucket, zone)
      if (count === 0) continue
      placements.push(
        ...this.createGroundDetailPlacements(
          zone,
          count,
          GROUND_FOLIAGE_SEEDS[bucket][zone],
          bucket,
        ),
      )
    }
    return placements
  }

  private groundFoliageCount(bucket: GroundFoliageBucket, zone: ZoneId): number {
    if (this.groundFoliageQuality === 'off') return 0
    return GROUND_FOLIAGE_COUNTS[bucket][zone][this.groundFoliageQuality]
  }

  private createGroundDetailPlacements(
    zone: ZoneId,
    target: number,
    seed: number,
    label: string,
  ): GroundFoliagePlacement[] {
    const random = seededRandom(seed)
    const placements: GroundFoliagePlacement[] = []
    const negativeX = zone === 'neutral' || zone === 'forest'
    const negativeZ = zone === 'neutral' || zone === 'palace'
    const minX = negativeX ? -WORLD_HALF + GROUND_FOLIAGE_EDGE_MARGIN : GROUND_FOLIAGE_EDGE_MARGIN
    const maxX = negativeX ? -GROUND_FOLIAGE_EDGE_MARGIN : WORLD_HALF - GROUND_FOLIAGE_EDGE_MARGIN
    const minZ = negativeZ ? -WORLD_HALF + GROUND_FOLIAGE_EDGE_MARGIN : GROUND_FOLIAGE_EDGE_MARGIN
    const maxZ = negativeZ ? -GROUND_FOLIAGE_EDGE_MARGIN : WORLD_HALF - GROUND_FOLIAGE_EDGE_MARGIN
    const maxAttempts = Math.max(target * GROUND_FOLIAGE_MAX_ATTEMPTS, 1)

    for (let attempt = 0; attempt < maxAttempts && placements.length < target; attempt += 1) {
      const x = THREE.MathUtils.lerp(minX, maxX, random())
      const z = THREE.MathUtils.lerp(minZ, maxZ, random())
      if (zoneAt(x, z) !== zone || !this.canPlaceGroundFoliage(x, z)) continue
      placements.push({
        zone,
        x,
        z,
        yaw: random() * TWO_PI,
        width: random(),
        height: random(),
        tone: random(),
      })
    }

    if (placements.length < target) {
      console.warn(
        `Korovany: ${label} placement in ${zone} produced ${placements.length}/${target} instances.`,
      )
    }
    return placements
  }

  private canPlaceGroundFoliage(x: number, z: number): boolean {
    const roadHalfWidth = 3 + GROUND_FOLIAGE_ROAD_CLEARANCE
    const onHorizontalRoad =
      Math.abs(z + 23) <= roadHalfWidth &&
      Math.abs(x) <= 75 + GROUND_FOLIAGE_ROAD_CLEARANCE
    const onVerticalRoad =
      Math.abs(x) <= roadHalfWidth &&
      z >= -67 - GROUND_FOLIAGE_ROAD_CLEARANCE &&
      z <= 75 + GROUND_FOLIAGE_ROAD_CLEARANCE
    if (onHorizontalRoad || onVerticalRoad) return false
    if (!this.isWalkablePosition(x, z, GROUND_FOLIAGE_CLEARANCE)) return false

    for (const enclosure of this.navigationEnclosures) {
      if (
        x >= enclosure.outerMinX &&
        x <= enclosure.outerMaxX &&
        z >= enclosure.outerMinZ &&
        z <= enclosure.outerMaxZ
      ) {
        return false
      }
    }

    for (const [clearX, clearZ, radius] of GROUND_FOLIAGE_CLEARINGS) {
      const dx = x - clearX
      const dz = z - clearZ
      const clearance = radius + GROUND_FOLIAGE_CLEARANCE
      if (dx * dx + dz * dz <= clearance * clearance) return false
    }
    return true
  }

  private createFernGeometry(): THREE.BufferGeometry {
    const vertices: number[] = []
    for (let frond = 0; frond < 4; frond += 1) {
      const angle = (frond / 4) * TWO_PI
      const outwardX = Math.sin(angle)
      const outwardZ = Math.cos(angle)
      const sideX = Math.cos(angle)
      const sideZ = -Math.sin(angle)
      const point = (side: number, outward: number, y: number): [number, number, number] => [
        sideX * side + outwardX * outward,
        y,
        sideZ * side + outwardZ * outward,
      ]
      const baseLeft = point(-0.025, 0, 0)
      const baseRight = point(0.025, 0, 0)
      const middleLeft = point(-0.1, 0.18, 0.34)
      const middleRight = point(0.1, 0.18, 0.34)
      const tip = point(0, 0.4, FERN_FOLIAGE_HEIGHT)
      vertices.push(
        ...baseLeft,
        ...baseRight,
        ...middleRight,
        ...baseLeft,
        ...middleRight,
        ...middleLeft,
        ...middleLeft,
        ...middleRight,
        ...tip,
      )
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.computeVertexNormals()
    return geometry
  }

  private createFlowerGeometry(): THREE.BufferGeometry {
    const stemSource = new THREE.CylinderGeometry(0.024, 0.035, 0.58, 5).translate(
      0,
      0.29,
      0,
    )
    const budSource = new THREE.OctahedronGeometry(0.15, 0).translate(0, 0.64, 0)
    const stem = stemSource.index ? stemSource.toNonIndexed() : stemSource
    const bud = budSource.index ? budSource.toNonIndexed() : budSource
    if (stem !== stemSource) stemSource.dispose()
    if (bud !== budSource) budSource.dispose()
    stem.deleteAttribute('uv')
    bud.deleteAttribute('uv')
    this.setGeometryVertexColor(stem, mix(this.palette.success, this.palette.text, 0.18))
    this.setGeometryVertexColor(bud, this.palette.warning)
    const geometry = mergeGeometries([stem, bud])
    stem.dispose()
    bud.dispose()
    return geometry
  }

  private setGeometryVertexColor(geometry: THREE.BufferGeometry, color: THREE.Color): void {
    const count = geometry.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }

  private createGroundFoliageMaterial(
    parameters: THREE.MeshStandardMaterialParameters,
    foliageHeight: number,
    swayAmplitude: number,
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(parameters)
    const heightUniform = { value: foliageHeight }
    const swayUniform = { value: swayAmplitude }
    material.onBeforeCompile = (shader) => {
      const commonMarker = '#include <common>'
      const beginVertexMarker = '#include <begin_vertex>'
      if (
        !shader.vertexShader.includes(commonMarker) ||
        !shader.vertexShader.includes(beginVertexMarker)
      ) {
        throw new Error('Korovany: Three.js foliage shader chunks changed.')
      }
      shader.uniforms.uTime = this.groundFoliageUniforms.uTime
      shader.uniforms.uWindDirection = this.groundFoliageUniforms.uWindDirection
      shader.uniforms.uWindStrength = this.groundFoliageUniforms.uWindStrength
      shader.uniforms.uFoliageHeight = heightUniform
      shader.uniforms.uSwayAmplitude = swayUniform
      shader.vertexShader = shader.vertexShader
        .replace(
          commonMarker,
          `${commonMarker}
uniform float uTime;
uniform vec2 uWindDirection;
uniform float uWindStrength;
uniform float uFoliageHeight;
uniform float uSwayAmplitude;`,
        )
        .replace(
          beginVertexMarker,
          `${beginVertexMarker}
#ifdef USE_INSTANCING
  float groundFoliageHeight = smoothstep(0.0, uFoliageHeight, position.y);
  vec2 groundFoliageRoot = (modelMatrix * instanceMatrix[3]).xz;
  float groundFoliagePhase =
    dot(groundFoliageRoot, vec2(0.31, 0.37)) + uTime * ${GROUND_FOLIAGE_WIND_SPEED.toFixed(1)};
  float groundFoliageWave =
    sin(groundFoliagePhase) + 0.35 * sin(groundFoliagePhase * 0.47 + 1.7);
  vec2 groundFoliageAxisX =
    (modelMatrix * vec4(instanceMatrix[0].xyz, 0.0)).xz;
  vec2 groundFoliageAxisZ =
    (modelMatrix * vec4(instanceMatrix[2].xyz, 0.0)).xz;
  vec2 groundFoliageLocalWind = vec2(
    dot(uWindDirection, normalize(groundFoliageAxisX)) /
      max(length(groundFoliageAxisX), 0.0001),
    dot(uWindDirection, normalize(groundFoliageAxisZ)) /
      max(length(groundFoliageAxisZ), 0.0001)
  );
  transformed.xz += groundFoliageLocalWind *
    (uWindStrength * uSwayAmplitude * groundFoliageHeight *
      groundFoliageHeight * groundFoliageWave);
#endif`,
        )
    }
    material.customProgramCacheKey = () => 'ground-foliage-wind-v1'
    return material
  }

  private addGroundFoliageMesh(mesh: THREE.InstancedMesh, swayAmplitude: number): void {
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.StaticDrawUsage)
      mesh.instanceColor.needsUpdate = true
    }
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.computeBoundingSphere()
    if (mesh.boundingSphere) {
      mesh.boundingSphere.radius +=
        swayAmplitude * GROUND_FOLIAGE_MAX_WIND_STRENGTH * GROUND_FOLIAGE_WAVE_MAX
    }
    this.groundFoliageMeshes.push(mesh)
    this.scene.add(mesh)
  }

  private updateAtmosphere(delta: number): void {
    this.groundFoliageUniforms.uTime.value = this.elapsed
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

  private updateDayNight(): void {
    if (!this.dynamicDayNight) {
      this.nightFactor = 0
      this.sun.position.set(-35, 58, 24)
      this.sun.color.copy(this.palette.worldSun)
      this.sun.intensity = 2.65
      this.hemisphere.color.copy(this.palette.worldSky)
      this.hemisphere.groundColor.copy(this.palette.worldAmbientGround)
      this.hemisphere.intensity = 1.65
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

    const dayPhase = (this.elapsed / DAY_LENGTH + DAY_START_OFFSET) % 1
    const sunAngle = dayPhase * TWO_PI
    const elevation = Math.sin(sunAngle)
    const orbitalX = Math.cos(sunAngle) * SUN_ARC_RADIUS
    const orbitalY = elevation * SUN_ARC_HEIGHT
    const orbitalZ = Math.sin(sunAngle) * SUN_ARC_DEPTH
    const nightToTwilight = smoothstep(-0.18, 0.08, elevation)
    const twilightToDay = smoothstep(0.08, 0.6, elevation)
    const dayFactor = smoothstep(-0.08, 0.45, elevation)
    this.nightFactor = 1 - dayFactor

    this.sun.position.set(orbitalX, Math.max(MIN_SHADOW_LIGHT_HEIGHT, orbitalY), orbitalZ)
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

  private buildWorld(): void {
    this.createAtmosphere()
    this.createGround()
    this.createRoads()
    this.createVillage()
    this.createPalace()
    this.createForest()
    this.createFort()
    this.createBoundary()
    this.createGroundDetails()
  }

  private createGround(): void {
    const zoneColors: Record<ZoneId, THREE.Color> = {
      neutral: this.palette.worldNeutralGround,
      palace: this.palette.worldPalaceGround,
      forest: this.palette.worldForestGround,
      fort: this.palette.worldFortGround,
    }
    const zones: Array<[ZoneId, number, number]> = [
      ['neutral', -40, -40],
      ['palace', 40, -40],
      ['forest', -40, 40],
      ['fort', 40, 40],
    ]
    for (const [zone, x, z] of zones) {
      const details: Record<ZoneId, THREE.Color> = {
        neutral: mix(this.palette.warning, this.palette.text, 0.36),
        palace: this.palette.borderStrong,
        forest: mix(this.palette.success, this.palette.text, 0.3),
        fort: mix(this.palette.accent, this.palette.borderStrong, 0.62),
      }
      const patterns: Record<ZoneId, 'grass' | 'stone' | 'scree'> = {
        neutral: 'grass',
        palace: 'stone',
        forest: 'grass',
        fort: 'scree',
      }
      const material = new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          `ground-${zone}`,
          zoneColors[zone],
          details[zone],
          patterns[zone],
          zone === 'palace' ? 10 : 18,
          zone === 'palace' ? 10 : 18,
        ),
        roughness: 1,
      })
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), material)
      this.groundSurfaces.set(zone, {
        material,
        baseColor: material.color.clone(),
        baseRoughness: material.roughness,
      })
      ground.rotation.x = -Math.PI / 2
      ground.position.set(x, -0.04, z)
      ground.receiveShadow = true
      this.scene.add(ground)
    }
    const grid = new THREE.GridHelper(160, 32, this.palette.borderStrong, this.palette.border)
    grid.position.y = 0.015
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
    materials.forEach((material) => {
      material.transparent = true
      material.opacity = 0.09
    })
    this.scene.add(grid)
  }

  private createRoads(): void {
    const roadBase = mix(this.palette.borderStrong, this.palette.soft, 0.45)
    const roadDetail = mix(this.palette.warning, this.palette.text, 0.6)
    const horizontalRoadMaterial = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'road-dirt-horizontal',
        roadBase,
        roadDetail,
        'dirt',
        24,
        2,
      ),
      roughness: 1,
    })
    const verticalRoadMaterial = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'road-dirt-vertical',
        roadBase,
        roadDetail,
        'dirt',
        2,
        24,
      ),
      roughness: 1,
    })
    const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(150, 6), horizontalRoadMaterial)
    horizontal.rotation.x = -Math.PI / 2
    horizontal.position.set(0, 0.03, -23)
    horizontal.receiveShadow = true
    this.scene.add(horizontal)
    const vertical = new THREE.Mesh(new THREE.PlaneGeometry(6, 142), verticalRoadMaterial)
    vertical.rotation.x = -Math.PI / 2
    vertical.position.set(0, 0.035, 4)
    vertical.receiveShadow = true
    this.scene.add(vertical)

    const rutMaterial = new THREE.MeshStandardMaterial({
      color: mix(this.palette.borderStrong, this.palette.text, 0.45),
      roughness: 1,
      transparent: true,
      opacity: 0.34,
    })
    for (const offset of [-1.35, 1.35]) {
      const horizontalRut = new THREE.Mesh(new THREE.PlaneGeometry(150, 0.22), rutMaterial)
      horizontalRut.rotation.x = -Math.PI / 2
      horizontalRut.position.set(0, 0.045, -23 + offset)
      this.scene.add(horizontalRut)
      const verticalRut = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 142), rutMaterial)
      verticalRut.rotation.x = -Math.PI / 2
      verticalRut.position.set(offset, 0.05, 4)
      this.scene.add(verticalRut)
    }
  }

  private createVillage(): void {
    this.scene.add(this.createZoneLabel('ВОЛЬНЫЕ ЗЕМЛИ', -43, -52))
    const housePositions: Array<[number, number, number]> = [
      [-58, -50, 0.2],
      [-40, -55, -0.15],
      [-58, -34, -0.25],
      [-34, -37, 0.12],
    ]
    for (const [x, z, rotation] of housePositions) {
      const house = this.createHouse(x, z, rotation, false)
      this.villageHouses.push(house)
      this.scene.add(house)
    }
    const shop = this.createHouse(this.vendorPosition.x, this.vendorPosition.z, 0.08, true)
    this.scene.add(shop)
    const sign = this.createSign('ЛЕКАРЬ • ПРОТЕЗЫ', this.vendorPosition.x, 4.5, this.vendorPosition.z + 2.8)
    this.scene.add(sign)
    const vendorBeacon = this.createBeacon(
      this.vendorPosition.x,
      this.vendorPosition.z + 3.8,
      this.palette.warning,
    )
    this.scene.add(vendorBeacon)
    this.registerInteractableOutline(vendorBeacon)
    const well = new THREE.Group()
    const stone = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'well-stone',
        this.palette.borderStrong,
        this.palette.border,
        'stone',
        4,
        2,
      ),
      roughness: 1,
    })
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1.2, 12, 1, true), stone)
    ring.position.y = 0.6
    ring.castShadow = true
    well.add(ring)
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 1.4, 8),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'village-roof',
          this.palette.accent,
          mix(this.palette.accent, this.palette.text, 0.45),
          'roof',
          5,
          3,
        ),
        roughness: 0.9,
      }),
    )
    roof.position.y = 3.4
    roof.castShadow = true
    well.add(roof)
    well.position.set(-48, 0, -47)
    this.registerCircleObstacle(well.position.x, well.position.z, 2)
    this.scene.add(well)
  }

  private createPalace(): void {
    this.scene.add(this.createZoneLabel('ИМПЕРСКИЙ УДЕЛ', 43, -55))
    const palaceStone = mix(this.palette.link, this.palette.surface, 0.72)
    const stone = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'palace-stone',
        palaceStone,
        mix(this.palette.link, this.palette.borderStrong, 0.68),
        'stone',
        6,
        5,
      ),
      roughness: 0.78,
    })
    const trim = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'palace-roof',
        this.palette.warning,
        mix(this.palette.warning, this.palette.text, 0.4),
        'roof',
        5,
        4,
      ),
      metalness: 0.22,
      roughness: 0.55,
    })
    const palace = new THREE.Group()
    const palaceX = 44
    const palaceZ = -47
    const wallWidth = 18
    const wallDepth = 14
    const wallHeight = 10
    const wallThickness = 1.5
    const gateWidth = 4.5
    const gateHeight = 6.2
    const sideX = wallWidth * 0.5 - wallThickness * 0.5
    const frontZ = wallDepth * 0.5 - wallThickness * 0.5
    const gateSegmentWidth = (wallWidth - gateWidth) * 0.5
    const gateSegmentX = gateWidth * 0.5 + gateSegmentWidth * 0.5
    const addPalaceWall = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
    ): void => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), stone)
      wall.position.set(x, y, z)
      wall.castShadow = true
      wall.receiveShadow = true
      palace.add(wall)
    }
    addPalaceWall(wallWidth, wallHeight, wallThickness, 0, wallHeight * 0.5, -frontZ)
    addPalaceWall(wallThickness, wallHeight, wallDepth, -sideX, wallHeight * 0.5, 0)
    addPalaceWall(wallThickness, wallHeight, wallDepth, sideX, wallHeight * 0.5, 0)
    addPalaceWall(
      gateSegmentWidth,
      wallHeight,
      wallThickness,
      -gateSegmentX,
      wallHeight * 0.5,
      frontZ,
    )
    addPalaceWall(
      gateSegmentWidth,
      wallHeight,
      wallThickness,
      gateSegmentX,
      wallHeight * 0.5,
      frontZ,
    )
    addPalaceWall(
      gateWidth,
      wallHeight - gateHeight,
      wallThickness,
      0,
      gateHeight + (wallHeight - gateHeight) * 0.5,
      frontZ,
    )
    this.registerBoxObstacle(palaceX, palaceZ - frontZ, wallWidth, wallThickness)
    this.registerBoxObstacle(palaceX - sideX, palaceZ, wallThickness, wallDepth)
    this.registerBoxObstacle(palaceX + sideX, palaceZ, wallThickness, wallDepth)
    this.registerBoxObstacle(
      palaceX - gateSegmentX,
      palaceZ + frontZ,
      gateSegmentWidth,
      wallThickness,
    )
    this.registerBoxObstacle(
      palaceX + gateSegmentX,
      palaceZ + frontZ,
      gateSegmentWidth,
      wallThickness,
    )
    for (const x of [-10, 10]) {
      for (const z of [-8, 8]) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 13, 10), stone)
        tower.position.set(x, 6.5, z)
        tower.castShadow = true
        palace.add(tower)
        this.registerCircleObstacle(palaceX + x, palaceZ + z, 3.5)
        const roof = new THREE.Mesh(new THREE.ConeGeometry(4.1, 4.5, 10), trim)
        roof.position.set(x, 15, z)
        roof.castShadow = true
        palace.add(roof)
      }
    }
    this.navigationEnclosures.push({
      insideMinX: palaceX - sideX + wallThickness * 0.5,
      insideMaxX: palaceX + sideX - wallThickness * 0.5,
      insideMinZ: palaceZ - frontZ + wallThickness * 0.5,
      insideMaxZ: palaceZ + frontZ - wallThickness * 0.5,
      outerMinX: palaceX - 13.5,
      outerMaxX: palaceX + 13.5,
      outerMinZ: palaceZ - 11.5,
      outerMaxZ: palaceZ + 11.5,
      gateInside: [palaceX, palaceZ + 4],
      gateOutside: [palaceX, palaceZ + 12.8],
      gateHalfWidth: gateWidth * 0.5,
      detours: [
        [palaceX - 14.8, palaceZ + 12.8],
        [palaceX + 14.8, palaceZ + 12.8],
        [palaceX - 14.8, palaceZ - 12.8],
        [palaceX + 14.8, palaceZ - 12.8],
      ],
    })
    const banner = new THREE.Mesh(new THREE.BoxGeometry(2.2, 4.2, 0.15), new THREE.MeshStandardMaterial({ color: this.palette.accent }))
    banner.position.set(0, 8.4, 7.62)
    palace.add(banner)
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.warning,
      emissive: this.palette.warning,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    })
    this.buildingWindowGlows.push({ material: windowMaterial, legacyIntensity: 0.55 })
    for (const x of [-5.5, 5.5]) {
      for (const y of [3.5, 6.5]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.18), windowMaterial)
        window.position.set(x, y, 7.16)
        palace.add(window)
      }
    }
    palace.add(this.createTorch(-2.8, 2.7, 7.7), this.createTorch(2.8, 2.7, 7.7))
    palace.position.set(palaceX, 0, palaceZ)
    this.scene.add(palace)
    this.scene.add(this.createBeacon(40, -36, this.palette.link))
  }

  private createForest(): void {
    this.scene.add(this.createZoneLabel('ЧАЩА ЭЛЕНВУДА', -44, 53))
    const random = seededRandom(217)
    for (let index = 0; index < 74; index += 1) {
      const x = -76 + random() * 70
      const z = 5 + random() * 70
      if (Math.hypot(x + 46, z - 43) < 12) continue
      const scale = 0.72 + random() * 0.9
      this.scene.add(this.createTreeLod(x, z, scale))
    }
    const huts: Array<[number, number]> = [
      [-55, 40],
      [-61, 50],
      [-39, 34],
    ]
    for (const [x, z] of huts) this.scene.add(this.createElfHut(x, z))
    this.scene.add(this.createBeacon(-48, 43, this.palette.success))
  }

  private createFort(): void {
    this.scene.add(this.createZoneLabel('ЧЁРНЫЙ КРЯЖ', 46, 54))
    const random = seededRandom(914)
    const rockMaterial = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'mountain-rock',
        mix(this.palette.accent, this.palette.borderStrong, 0.7),
        mix(this.palette.borderStrong, this.palette.text, 0.45),
        'scree',
        3,
        3,
      ),
      roughness: 1,
    })
    for (let index = 0; index < 35; index += 1) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.7 + random() * 3.2, 0),
        rockMaterial,
      )
      rock.position.set(7 + random() * 69, 0.7 + random() * 1.4, 5 + random() * 70)
      rock.scale.y = 0.7 + random() * 1.8
      rock.rotation.set(random(), random(), random())
      rock.castShadow = true
      rock.receiveShadow = true
      this.scene.add(rock)
    }

    const fort = new THREE.Group()
    const fortX = 47
    const fortZ = 45
    const wallWidth = 22
    const wallDepth = 18
    const wallHeight = 7
    const wallThickness = 2.5
    const gateWidth = 5
    const gateHeight = 5
    const gateSegmentWidth = (wallWidth - gateWidth) * 0.5
    const gateSegmentX = gateWidth * 0.5 + gateSegmentWidth * 0.5
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'fort-stone',
        mix(this.palette.borderStrong, this.palette.bg, 0.32),
        mix(this.palette.accent, this.palette.border, 0.4),
        'stone',
        6,
        4,
      ),
      roughness: 1,
    })
    const rearWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallWidth, wallHeight, wallThickness),
      wallMaterial,
    )
    rearWall.position.set(0, wallHeight * 0.5, wallDepth * 0.5)
    rearWall.castShadow = true
    rearWall.receiveShadow = true
    fort.add(rearWall)
    const sideA = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, wallDepth),
      wallMaterial,
    )
    sideA.position.set(-wallWidth * 0.5, wallHeight * 0.5, 0)
    sideA.castShadow = true
    sideA.receiveShadow = true
    fort.add(sideA)
    const sideB = sideA.clone()
    sideB.position.x = wallWidth * 0.5
    fort.add(sideB)
    for (const x of [-gateSegmentX, gateSegmentX]) {
      const gateWall = new THREE.Mesh(
        new THREE.BoxGeometry(gateSegmentWidth, wallHeight, wallThickness),
        wallMaterial,
      )
      gateWall.position.set(x, wallHeight * 0.5, -wallDepth * 0.5)
      gateWall.castShadow = true
      gateWall.receiveShadow = true
      fort.add(gateWall)
    }
    const gateLintel = new THREE.Mesh(
      new THREE.BoxGeometry(gateWidth, wallHeight - gateHeight, wallThickness),
      wallMaterial,
    )
    gateLintel.position.set(
      0,
      gateHeight + (wallHeight - gateHeight) * 0.5,
      -wallDepth * 0.5,
    )
    gateLintel.castShadow = true
    fort.add(gateLintel)
    this.registerBoxObstacle(fortX, fortZ + wallDepth * 0.5, wallWidth, wallThickness)
    this.registerBoxObstacle(
      fortX - wallWidth * 0.5,
      fortZ,
      wallThickness,
      wallDepth,
    )
    this.registerBoxObstacle(
      fortX + wallWidth * 0.5,
      fortZ,
      wallThickness,
      wallDepth,
    )
    this.registerBoxObstacle(
      fortX - gateSegmentX,
      fortZ - wallDepth * 0.5,
      gateSegmentWidth,
      wallThickness,
    )
    this.registerBoxObstacle(
      fortX + gateSegmentX,
      fortZ - wallDepth * 0.5,
      gateSegmentWidth,
      wallThickness,
    )
    for (const x of [-wallWidth * 0.5, wallWidth * 0.5]) {
      for (const z of [-wallDepth * 0.5, wallDepth * 0.5]) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 10, 8), wallMaterial)
        tower.position.set(x, 5, z)
        tower.castShadow = true
        fort.add(tower)
        this.registerCircleObstacle(fortX + x, fortZ + z, 3.8)
      }
    }
    this.navigationEnclosures.push({
      insideMinX: fortX - wallWidth * 0.5 + wallThickness * 0.5,
      insideMaxX: fortX + wallWidth * 0.5 - wallThickness * 0.5,
      insideMinZ: fortZ - wallDepth * 0.5 + wallThickness * 0.5,
      insideMaxZ: fortZ + wallDepth * 0.5 - wallThickness * 0.5,
      outerMinX: fortX - wallWidth * 0.5 - 3.8,
      outerMaxX: fortX + wallWidth * 0.5 + 3.8,
      outerMinZ: fortZ - wallDepth * 0.5 - 3.8,
      outerMaxZ: fortZ + wallDepth * 0.5 + 3.8,
      gateInside: [fortX, fortZ - 5.8],
      gateOutside: [fortX, fortZ - 14],
      gateHalfWidth: gateWidth * 0.5,
      detours: [
        [fortX - 16, fortZ - 14],
        [fortX + 16, fortZ - 14],
        [fortX - 16, fortZ + 14],
        [fortX + 16, fortZ + 14],
      ],
    })
    const flag = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 0.15), new THREE.MeshStandardMaterial({ color: this.palette.accent }))
    flag.position.set(0, 12, 0)
    fort.add(flag)
    fort.add(this.createTorch(-3.4, 2.8, -10.1), this.createTorch(3.4, 2.8, -10.1))
    fort.position.set(fortX, 0, fortZ)
    this.scene.add(fort)
    this.scene.add(this.createBeacon(47, 45, this.palette.accent))
  }

  private createBoundary(): void {
    const material = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'boundary-stone',
        mix(this.palette.borderStrong, this.palette.bg, 0.4),
        this.palette.border,
        'scree',
        2,
        2,
      ),
      roughness: 1,
    })
    for (let index = -76; index <= 76; index += 8) {
      for (const [x, z] of [
        [index, -79],
        [index, 79],
        [-79, index],
        [79, index],
      ]) {
        const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), material)
        stone.position.set(x, 0.65, z)
        stone.scale.y = 1.6
        stone.rotation.y = index
        stone.castShadow = true
        this.scene.add(stone)
      }
    }
  }

  private createTorch(x: number, y: number, z: number): THREE.Group {
    const group = new THREE.Group()
    const bracket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 1.5, 6),
      new THREE.MeshStandardMaterial({
        color: this.palette.borderStrong,
        metalness: 0.6,
        roughness: 0.4,
      }),
    )
    bracket.position.y = -0.72
    bracket.castShadow = true
    group.add(bracket)
    const flameMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.warning,
      emissive: this.palette.warning,
      emissiveIntensity: 1.3,
      roughness: 0.3,
    })
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 7), flameMaterial)
    flame.position.y = 0.25
    flame.userData.baseScale = 1
    this.flames.push(flame)
    group.add(flame)
    const light = new THREE.PointLight(this.palette.warning, 1.4, 11, 2)
    light.position.y = 0.35
    this.torchLights.push(light)
    group.add(light)
    group.position.set(x, y, z)
    return group
  }

  private createHouse(x: number, z: number, rotation: number, shop: boolean): THREE.Group {
    const group = new THREE.Group()
    const woodBase = shop
      ? mix(this.palette.warning, this.palette.soft, 0.55)
      : mix(this.palette.accent, this.palette.soft, 0.72)
    const wood = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        shop ? 'shop-timber' : 'village-timber',
        woodBase,
        mix(this.palette.warning, this.palette.text, 0.52),
        'wood',
        4,
        4,
      ),
      roughness: 0.95,
    })
    const body = new THREE.Mesh(new THREE.BoxGeometry(shop ? 9 : 7, 4.8, shop ? 7 : 6), wood)
    body.position.y = 2.4
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(shop ? 7 : 5.7, 3.5, 4),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'house-shingles',
          this.palette.accent,
          mix(this.palette.accent, this.palette.text, 0.4),
          'roof',
          5,
          4,
        ),
        roughness: 1,
      }),
    )
    roof.position.y = 6.5
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    group.add(roof)
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 2.8, 0.3),
      new THREE.MeshStandardMaterial({ color: this.palette.bg, roughness: 1 }),
    )
    door.position.set(0, 1.4, (shop ? 3.5 : 3) + 0.16)
    group.add(door)
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.warning,
      emissive: this.palette.warning,
      emissiveIntensity: shop ? 0.75 : 0.38,
      roughness: 0.4,
    })
    this.buildingWindowGlows.push({
      material: windowMaterial,
      legacyIntensity: shop ? 0.75 : 0.38,
    })
    const windowOffset = shop ? 2.7 : 2.1
    for (const windowX of [-windowOffset, windowOffset]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 0.18), windowMaterial)
      window.position.set(windowX, 2.75, (shop ? 3.5 : 3) + 0.18)
      group.add(window)
    }
    group.position.set(x, 0, z)
    group.rotation.y = rotation
    this.registerBoxObstacle(x, z, shop ? 9 : 7, shop ? 7 : 6, rotation)
    return group
  }

  private createElfHut(x: number, z: number): THREE.Group {
    const group = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'elf-hut-bark',
        mix(this.palette.warning, this.palette.bg, 0.55),
        mix(this.palette.warning, this.palette.text, 0.55),
        'wood',
        5,
        4,
      ),
      roughness: 1,
    })
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.3, 5.5, 9), wood)
    trunk.position.y = 2.75
    trunk.castShadow = true
    group.add(trunk)
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(4.8, 4, 9),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'elf-leaf-roof',
          mix(this.palette.success, this.palette.bg, 0.25),
          mix(this.palette.success, this.palette.text, 0.36),
          'roof',
          6,
          4,
        ),
        roughness: 1,
      }),
    )
    roof.position.y = 7
    roof.castShadow = true
    group.add(roof)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.6, 0.25), new THREE.MeshStandardMaterial({ color: this.palette.bg }))
    door.position.set(0, 1.3, 3.05)
    group.add(door)
    group.position.set(x, 0, z)
    this.registerCircleObstacle(x, z, 3.3)
    return group
  }

  private createTreeLod(x: number, z: number, scale: number): THREE.LOD {
    const lod = new THREE.LOD()
    const near = new THREE.Group()
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.62, 4.5, 7),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'tree-bark',
          mix(this.palette.warning, this.palette.bg, 0.45),
          mix(this.palette.warning, this.palette.text, 0.58),
          'wood',
          2,
          5,
        ),
        roughness: 1,
      }),
    )
    trunk.position.y = 2.25
    trunk.castShadow = true
    near.add(trunk)
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: mix(this.palette.worldForestGround, this.palette.worldHorizon, 0.16),
      roughness: 1,
      transparent: true,
    })
    for (const [height, radius] of [
      [4.4, 2.6],
      [6.1, 2.1],
      [7.6, 1.45],
    ]) {
      const foliage = new THREE.Mesh(new THREE.ConeGeometry(radius, 3.4, 8), foliageMaterial)
      foliage.userData.cameraPassThrough = true
      foliage.position.y = height
      foliage.castShadow = true
      near.add(foliage)
    }
    near.scale.setScalar(scale)
    lod.addLevel(near, 0)
    lod.position.set(x, 0, z)
    this.foliageOccluders.push({
      root: lod,
      material: foliageMaterial,
      radius: 2.7 * scale,
      centerY: 5.8 * scale,
    })
    return lod
  }

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
    const factionMaterial = this.comicMaterials.createToonMaterial({
      color: this.factionColor(faction),
      surface: faction === 'guard' ? 'metal' : 'cloth',
      emissive: faction === 'guard' ? this.factionColor(faction) : undefined,
      emissiveIntensity: faction === 'guard' ? 0.07 : undefined,
    })
    const skinMaterial = this.comicMaterials.createToonMaterial({
      color: mix(this.palette.warning, this.palette.surface, 0.7),
      surface: 'skin',
    })
    const darkMaterial = this.comicMaterials.createToonMaterial({
      color: mix(this.palette.text, this.palette.bg, 0.28),
      surface: 'dark',
    })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(player ? 1.05 : 0.9, 1.3, 0.58), factionMaterial)
    torso.name = 'torso'
    torso.position.y = 1.72
    torso.castShadow = true
    torsoPivot.add(torso)

    const head = new THREE.Mesh(
      faction === 'elf' ? new THREE.ConeGeometry(0.44, 0.88, 8) : new THREE.SphereGeometry(0.43, 10, 8),
      skinMaterial,
    )
    head.name = 'head'
    head.position.y = 2.72
    if (faction === 'elf') head.rotation.z = Math.PI
    head.castShadow = true
    headPivot.add(head)

    for (const [name, x] of [
      ['leftArm', -0.68],
      ['rightArm', 0.68],
    ] as const) {
      const pivot = new THREE.Group()
      pivot.name = name
      pivot.position.set(x, 2.2, 0)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.18, 0.3), factionMaterial)
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
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.12, 0.42), darkMaterial)
      leg.position.y = -0.5
      leg.castShadow = true
      pivot.add(leg)
      pelvisPivot.add(pivot)
    }

    const weaponPivot = new THREE.Group()
    weaponPivot.name = 'weapon'
    weaponPivot.position.set(0.88, 1.75, 0.1)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.65, 0.24), darkMaterial)
    blade.position.y = -0.15
    blade.rotation.z = -0.2
    blade.castShadow = true
    weaponPivot.add(blade)
    torsoPivot.add(weaponPivot)

    if (faction === 'guard') {
      const helmet = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.53, 0.48, 8), darkMaterial)
      helmet.position.y = 3.02
      helmet.castShadow = true
      headPivot.add(helmet)
      if (player) {
        const shield = new THREE.Mesh(
          new THREE.BoxGeometry(0.78, 1.15, 0.16),
          darkMaterial,
        )
        shield.name = 'shield'
        shield.position.set(-0.82, 1.85, 0.08)
        shield.rotation.z = 0.12
        shield.castShadow = true
        torsoPivot.add(shield)
      }
    } else if (faction === 'villain') {
      const horns = [-0.28, 0.28].map((x) => {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.65, 7), darkMaterial)
        horn.position.set(x, 3.25, 0)
        horn.rotation.z = x > 0 ? -0.3 : 0.3
        horn.castShadow = true
        return horn
      })
      horns.forEach((horn) => headPivot.add(horn))
    }

    if (!player) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.72, 0.9, 24),
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

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object.name === 'faction-ring') return
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    return group
  }

  private applyActorVisualVariation(
    mesh: THREE.Group,
    faction: Faction,
    role: ActorRole,
    index: number,
  ): void {
    const variation = Math.sin((index + 1) * 12.9898 + faction.length * 7.23)
    const bodyPivot = mesh.getObjectByName('body-pivot')
    if (bodyPivot) {
      const roleWidth = role === 'brute' || role === 'champion' ? 1.025 : 1
      bodyPivot.scale.set(
        roleWidth * (1 + variation * 0.035),
        1 - variation * 0.025,
        roleWidth * (1 + variation * 0.02),
      )
    }
    const torso = mesh.getObjectByName('torso')
    if (torso instanceof THREE.Mesh && torso.material instanceof THREE.MeshToonMaterial) {
      torso.material.color.offsetHSL(variation * 0.012, variation * 0.03, variation * 0.025)
    }
  }

  private createActorHealthBar(faction: Faction): {
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
    context.fillStyle = this.factionColor(faction).getStyle()
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
    context.fillStyle = this.factionColor(actor.faction).getStyle()
    context.fillRect(3, 3, innerWidth * ratio, actor.healthBarCanvas.height - 6)
    actor.healthBarTexture.needsUpdate = true
  }

  private createCaravan(gilded = false): THREE.Group {
    const group = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        gilded ? 'rich-caravan-wood' : 'caravan-wood',
        gilded
          ? mix(this.palette.warning, this.palette.surface, 0.22)
          : mix(this.palette.warning, this.palette.bg, 0.48),
        gilded
          ? mix(this.palette.warning, this.palette.text, 0.34)
          : mix(this.palette.warning, this.palette.text, 0.55),
        'wood',
        4,
        3,
      ),
      roughness: 0.92,
    })
    const metal = new THREE.MeshStandardMaterial({
      color: gilded ? this.palette.warning : this.palette.borderStrong,
      roughness: 0.55,
      metalness: gilded ? 0.76 : 0.45,
    })
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.65, 3.1), wood)
    base.position.y = 1.6
    base.castShadow = true
    group.add(base)
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 2.5, 2.5),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          gilded ? 'rich-caravan-crate' : 'caravan-crate',
          gilded ? mix(this.palette.warning, this.palette.surface, 0.15) : this.palette.warning,
          mix(this.palette.warning, this.palette.text, 0.42),
          'wood',
          3,
          3,
        ),
        roughness: 0.8,
        emissive: gilded ? this.palette.warning : this.palette.bg,
        emissiveIntensity: gilded ? 0.32 : 0,
      }),
    )
    cargo.name = 'cargo'
    cargo.position.y = 3
    cargo.castShadow = true
    group.add(cargo)
    const wheelGeometry = new THREE.CylinderGeometry(0.9, 0.9, 0.32, 12)
    wheelGeometry.rotateX(Math.PI / 2)
    const spokeMaterial = new THREE.MeshStandardMaterial({
      color: mix(this.palette.warning, this.palette.borderStrong, 0.55),
      metalness: 0.22,
      roughness: 0.62,
    })
    for (const x of [-1.7, 1.7]) {
      for (const z of [-1.72, 1.72]) {
        const wheel = new THREE.Group()
        wheel.name = 'wheel'
        wheel.position.set(x, 1.05, z)
        const tire = new THREE.Mesh(wheelGeometry, metal)
        tire.castShadow = true
        wheel.add(tire)
        const horizontalSpoke = new THREE.Mesh(
          new THREE.BoxGeometry(1.45, 0.12, 0.38),
          spokeMaterial,
        )
        const verticalSpoke = horizontalSpoke.clone()
        verticalSpoke.rotation.z = Math.PI / 2
        wheel.add(horizontalSpoke, verticalSpoke)
        group.add(wheel)
      }
    }
    const horse = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1), wood)
    horse.position.set(4.2, 1.9, 0)
    horse.castShadow = true
    group.add(horse)
    const horseHead = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.8), wood)
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

  private createZoneLabel(text: string, x: number, z: number): THREE.Sprite {
    return this.createSign(text, x, 9, z, 17, 3.2)
  }

  private createSign(
    text: string,
    x: number,
    y: number,
    z: number,
    width = 12,
    height = 2.5,
  ): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 96
    const context = canvas.getContext('2d')
    if (context) {
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--cp-panel-strong').trim()
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--cp-accent').trim()
      context.lineWidth = 7
      context.strokeRect(3.5, 3.5, canvas.width - 7, canvas.height - 7)
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--cp-text').trim()
      context.font = '700 31px "Segoe UI", Aptos, Calibri, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(text, canvas.width / 2, canvas.height / 2)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    this.generatedTextures.set(`sign-${text}`, texture)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
    sprite.position.set(x, y, z)
    sprite.scale.set(width, height, 1)
    sprite.renderOrder = 5
    return sprite
  }

  private createBeacon(x: number, z: number, color: THREE.Color): THREE.Group {
    const group = new THREE.Group()
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.16, 8, 24),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.22
    group.add(ring)
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.4, 5, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22 }),
    )
    column.position.y = 2.5
    group.add(column)
    group.position.set(x, 0, z)
    return group
  }

  private spawnPopulation(): void {
    const spawns: Array<[Faction, ActorRole, number, number]> = [
      ['guard', 'commander', 40, -36],
      ['guard', 'soldier', 32, -38],
      ['guard', 'archer', 50, -33],
      ['guard', 'brute', 56, -52],
      ['guard', 'soldier', 23, -24],
      ['guard', 'archer', 8, -25],
      ['elf', 'scout', -48, 38],
      ['elf', 'archer', -38, 45],
      ['elf', 'scout', -56, 52],
      ['elf', 'archer', -27, 28],
      ['elf', 'scout', -12, 15],
      ['villain', 'minion', 43, 39],
      ['villain', 'brute', 53, 48],
      ['villain', 'archer', 37, 53],
      ['villain', 'minion', 27, 30],
      ['villain', 'brute', 12, 18],
    ]
    spawns.forEach(([faction, role, x, z], index) => this.spawnActor(faction, role, x, z, index))
  }

  private spawnActor(
    faction: Faction,
    role: ActorRole,
    x: number,
    z: number,
    index: number,
    options: ActorSpawnOptions = {},
  ): Actor {
    const mesh = this.createCharacter(faction, false)
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
          this.comicMaterials.createToonMaterial({
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
    this.applyActorVisualVariation(mesh, faction, role, index)
    const outlineBinding = this.registerOutline(mesh, 'enemy')
    mesh.position.set(x, 0, z)
    this.resolveCharacterOverlaps(mesh.position, this.actorColliderRadiusForRole(role))
    this.scene.add(mesh)
    const healthBar = this.createActorHealthBar(faction)
    healthBar.sprite.position.set(mesh.position.x, 3.65 * mesh.scale.y, mesh.position.z)
    this.scene.add(healthBar.sprite)
    const phase = index * 0.73
    const home = mesh.position.clone()
    const initialAngle = phase * 4.7
    const baseHp =
      role === 'commander'
        ? 150
        : role === 'champion'
          ? 260
          : role === 'brute'
            ? 130
            : role === 'archer'
              ? 45
              : role === 'scout'
                ? 55
                : 70
    const hp = Math.round(baseHp * this.enemyHealthMultiplier(faction))
    const speed =
      role === 'scout'
        ? 4.8
        : role === 'champion'
          ? 4.15
          : role === 'archer'
            ? 3.2
            : role === 'brute'
              ? 2.6
              : role === 'commander'
                ? 0
                : 3.7
    const actor: Actor = {
      id: `${faction}-${role}-${this.actorSequence++}`,
      faction,
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
    const availableSlots = Math.min(2, Math.max(0, MAX_ACTORS - this.actors.length))
    if (availableSlots >= 1) {
      this.spawnActor('guard', 'soldier', x - 5, z - 4, this.actors.length + 1)
    }
    if (availableSlots >= 2) {
      this.spawnActor('guard', 'soldier', x + 5, z + 4, this.actors.length + 2)
    }
    if (availableSlots > 0) {
      this.callbacks.onNotice('Засада! Охрана корована вступает в бой.', 'warning')
    }
  }

  private findNearestEnemy(actor: Actor, range: number): Actor | null {
    const locked = actor.targetId
      ? this.actors.find((other) => other.id === actor.targetId)
      : undefined
    if (
      locked?.alive &&
      locked.id !== actor.ignoredTargetId &&
      hostile(actor.faction, locked.faction) &&
      actor.mesh.position.distanceTo(locked.mesh.position) < range * 1.35
    ) {
      return locked
    }

    actor.targetId = null
    let nearest: Actor | null = null
    let bestDistance = range
    for (const other of this.actors) {
      if (
        !other.alive ||
        other === actor ||
        other.id === actor.ignoredTargetId ||
        !hostile(actor.faction, other.faction)
      ) {
        continue
      }
      const distance = actor.mesh.position.distanceTo(other.mesh.position)
      if (distance < bestDistance) {
        nearest = other
        bestDistance = distance
      }
    }
    actor.targetId = nearest?.id ?? null
    return nearest
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
    if (!this.screenShakeEnabled || this.paused || this.ended) return
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
    if (!this.screenShakeEnabled) return
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
    if (immediate || !this.screenShakeEnabled || this.paused || this.ended) {
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
    decal.mesh.position.set(position.x, DECAL_Y, position.z)
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

  private createHitParticles(position: THREE.Vector3, faction: Faction): void {
    for (let index = 0; index < 7; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12, 0),
        new THREE.MeshBasicMaterial({ color: this.factionColor(faction) }),
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
        pose.stagger * 0.2
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
      object.userData.comicOutline === true ||
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
