import type { AchievementUnlock } from './achievements'

export type Faction = 'elf' | 'guard' | 'villain'

/**
 * §5.3 — who counts as "us" in a fight. `Faction` deliberately stays the three playable
 * sides: it carries a spawn point, a signature ability, an objective graph, event
 * weights, and a brand colour. A wolf has none of those, so widening `Faction` would
 * force meaningless rows into `FACTION_INFO`, `ABILITY_INFO`, and `EVENT_WEIGHTS`
 * forever. Beasts and civilians are allegiances instead.
 */
export type Allegiance = Faction | 'beast' | 'civilian'

export const ALLEGIANCES: readonly Allegiance[] = [
  'elf',
  'guard',
  'villain',
  'beast',
  'civilian',
]

export type AllegianceRelation = 'hostile' | 'neutral' | 'friendly'

/**
 * Every hostility decision — targeting, projectile eligibility, friendly fire, map
 * marker colour, kill attribution — reads this table rather than comparing factions.
 *
 * Read it as "row *regards* column". It happens to be symmetric today: one-sided
 * aggression (a civilian that flees rather than fights) is Layer 4/5 behaviour, not a
 * relation, so nothing here needs to be lopsided yet.
 */
export const ALLEGIANCE_RELATIONS: Record<
  Allegiance,
  Record<Allegiance, AllegianceRelation>
> = {
  elf: {
    elf: 'friendly',
    guard: 'hostile',
    villain: 'hostile',
    beast: 'hostile',
    civilian: 'neutral',
  },
  guard: {
    elf: 'hostile',
    guard: 'friendly',
    villain: 'hostile',
    beast: 'hostile',
    civilian: 'neutral',
  },
  villain: {
    elf: 'hostile',
    guard: 'hostile',
    villain: 'friendly',
    beast: 'hostile',
    civilian: 'neutral',
  },
  // Wildlife does not take sides: everything with two legs is either food or a threat,
  // and other beasts are neither.
  beast: {
    elf: 'hostile',
    guard: 'hostile',
    villain: 'hostile',
    beast: 'friendly',
    civilian: 'hostile',
  },
  // Civilians are nobody's enemy until something comes out of the forest for them.
  civilian: {
    elf: 'neutral',
    guard: 'neutral',
    villain: 'neutral',
    beast: 'hostile',
    civilian: 'friendly',
  },
}

export function allegianceRelation(a: Allegiance, b: Allegiance): AllegianceRelation {
  return ALLEGIANCE_RELATIONS[a][b]
}

export function areAllegiancesHostile(a: Allegiance, b: Allegiance): boolean {
  return ALLEGIANCE_RELATIONS[a][b] === 'hostile'
}

export function isFactionAllegiance(value: Allegiance): value is Faction {
  return value !== 'beast' && value !== 'civilian'
}

/** Layer 3 — the four things that come out of the forest. */
export type BeastRole = 'wolf' | 'boar' | 'bear' | 'troll'

export const BEAST_ROLES: readonly BeastRole[] = ['wolf', 'boar', 'bear', 'troll']

export type ActorRole =
  | 'soldier'
  | 'scout'
  | 'commander'
  | 'minion'
  | 'archer'
  | 'brute'
  | 'champion'
  | 'captive'
  /**
   * Layer 5 — a villager. Named for what it does rather than for its allegiance, so it
   * does not collide with `Allegiance`'s `civilian`: the role is how it behaves in a
   * fight (badly), the allegiance is whose side it is on (nobody's).
   */
  | 'peasant'
  | BeastRole

export function isBeastRole(role: ActorRole): role is BeastRole {
  return (BEAST_ROLES as readonly string[]).includes(role)
}

/**
 * How fast a role walks, and how many radians of gait phase it spends per metre.
 *
 * These lived inline in `GameEngine` and were pinned by source regexes, because
 * `GameEngine` cannot be constructed in a Node test. Across six review passes those
 * regexes were walked past six different ways — prefix matching, a statement added
 * after the pinned line, compound assignment, hoisting a term out of the matched
 * window, writing the value somewhere else entirely, and finally routing a role name
 * through a constant so a *negative* assertion about the token stopped matching.
 *
 * Five correct patches, one family, and the root was never regex quality: **reading
 * code can always be defeated by rewriting it.** The last of those evasions is what
 * made the case unarguable — the two default-branch pins asserted that a role name was
 * *absent* from a slice, and absence is defeated by moving the token, which is the same
 * manoeuvre as three of the earlier five.
 *
 * So they are functions, and the wobble test's `GAITS` table is now checked by calling
 * them. `actorGaitCadence` returns **radians per metre travelled**, not per second —
 * `updateActors` does `gaitPhase += travelled * cadence` — which a test once got wrong
 * by a factor of 3.7 and thereby sized a guard against a gait model the engine does not
 * run.
 */
export function actorGaitCadence(role: ActorRole): number {
  if (isBeastRole(role)) return role === 'wolf' ? 9.6 : role === 'boar' ? 8.8 : 5.2
  if (role === 'scout') return 8.4
  if (role === 'brute' || role === 'champion') return 5.8
  if (role === 'archer') return 7.2
  return 6.8
}

/**
 * **Humanoids only, despite the parameter type.** Beasts never reach it: `createActor`
 * reads `beast?.speed ?? actorSpeedForRole(role)`, so a quadruped takes its profile's
 * speed and short-circuits. Handed a beast role directly it returns the humanoid
 * default of 3.7, where the profiles are wolf 5.4, boar 4.6, bear 3.4, troll 2.9.
 *
 * A reviewer found that and put the choice correctly: **either the function's domain is
 * wrong or its beast behaviour is.** It is the domain — `actorGaitCadence` above really
 * does answer for all thirteen roles and branches on `isBeastRole` to do it, and the
 * two sitting side by side with the same signature invites reading them as a pair.
 * Narrowing the parameter type is the honest fix and is a wider change than the hour
 * warrants; the wiring assertion pins the `beast?.speed ??` short-circuit so the
 * unreachable branch stays unreachable, and this note says why it is unreachable rather
 * than leaving the next reader to discover that 3.7 is not a wolf.
 */
export function actorSpeedForRole(role: ActorRole): number {
  if (role === 'scout') return 4.8
  if (role === 'champion') return 4.15
  if (role === 'archer') return 3.2
  if (role === 'brute') return 2.6
  if (role === 'commander') return 0
  // §5D — slower than a soldier at a walk, faster than one in a panic. The 1.15x every
  // routing actor gets makes a bolting villager outrun a strolling one, which is the read.
  if (role === 'peasant') return 3.1
  return 3.7
}
export type ZoneId = 'neutral' | 'palace' | 'forest' | 'fort'

export type HatchMotif = 'scrape' | 'chevron' | 'organic' | 'slash'

export interface ZoneInfo {
  name: string
  subtitle: string
  accent: string
  motif: HatchMotif
}

export type PartStatus = 'healthy' | 'wounded' | 'missing' | 'prosthetic'

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

export type LootRarity = 'common' | 'uncommon' | 'rare' | 'legendary'

export type LootRewardKind = 'coins' | 'medicine' | 'whetstone'

export interface LootReward {
  kind: LootRewardKind
  rarity: LootRarity
  amount: number
  label: string
}

export interface LootToastView {
  id: number
  rarity: LootRarity
  title: string
  detail: string
}

export type RandomWorldEventKind =
  | 'richCaravan'
  | 'defendHome'
  | 'champion'
  | 'rescue'
  | 'bounty'

/** Layer 2 — chronicle situations that materialize at a site or region. */
export type ChronicleWorldEventKind =
  | 'factionRaid'
  | 'caravanAmbush'
  | 'warband'
  | 'aftermath'
  | 'beastRaid'

export type WorldEventKind = RandomWorldEventKind | ChronicleWorldEventKind

/** The five the director rolls for; the chronicle kinds are placed, not rolled. */
export const RANDOM_WORLD_EVENT_KINDS: readonly RandomWorldEventKind[] = [
  'richCaravan',
  'defendHome',
  'champion',
  'rescue',
  'bounty',
]

export const CHRONICLE_WORLD_EVENT_KINDS: readonly ChronicleWorldEventKind[] = [
  'factionRaid',
  'caravanAmbush',
  'warband',
  'aftermath',
  'beastRaid',
]

export function isRandomWorldEventKind(
  kind: WorldEventKind,
): kind is RandomWorldEventKind {
  return (RANDOM_WORLD_EVENT_KINDS as readonly string[]).includes(kind)
}

/**
 * Roadmap 1.3 — the three things a chronicle rumour can ask for.
 *
 * They live here, beside the event kinds, because copy, the HUD and `CampaignDirector` all
 * need the vocabulary and none of them should have to import the director to get it. The
 * set is deliberately closed at three: each one is an *embodied* verb — walk beside it,
 * stand in it, burn it — and anything that could be honoured without going somewhere would
 * be the map-menu economy this project rejected by name.
 */
export type RumourKind = 'escort' | 'defend' | 'sabotage'

export const RUMOUR_KINDS: readonly RumourKind[] = ['escort', 'defend', 'sabotage']

export type RumourOutcome = 'kept' | 'broken'

/**
 * One rumour as the HUD sees it.
 *
 * Everything here is either a sentence or a number the panel draws directly; the director
 * keeps the ids. `outcome` is set only on the resolved entry the panel holds on screen for
 * a moment, which is the whole of 1.3's answer to "the feed never attributes an outcome to
 * a decision".
 */
export interface ChronicleRumourView {
  id: string
  kind: RumourKind
  title: string
  /** What the player would have to physically do. */
  task: string
  /** What walking past it costs. */
  stake: string
  /** Map square the player has to be in, e.g. `C3`. */
  regionLabel: string
  /** Seconds left before it resolves either way. */
  timeRemaining: number
  pinned: boolean
  /** 0..1 of the embodied requirement. */
  progress: number
  /** Where to go. Null when the square has not been placed in the world yet. */
  x: number | null
  z: number | null
  /** Set only on a resolved entry, never on a live one. */
  outcome: RumourOutcome | null
  outcomeText: string | null
}

export interface WorldEventView {
  id: string
  kind: WorldEventKind
  title: string
  description: string
  tone: NoticeTone
  progress?: number
  target?: number
  timeRemaining?: number
}

/**
 * Roadmap 1.4 — the status of a signature contract, as the HUD sees it.
 *
 * Mirrors `ContractStatus` in `CampaignDirector` for the same reason `RumourKind` mirrors
 * nothing and simply lives here: the panel and the copy need the vocabulary and neither
 * should have to import the director to get it.
 */
export type CampaignContractStatus = 'offered' | 'active' | 'kept' | 'failed'

/**
 * One ready campaign node as the HUD sees it.
 *
 * The list is the fork. Before 1.4 the HUD was handed exactly one active objective, because
 * the director returned the *first* ready node and nothing else — so a branched graph would
 * have presented a straight line. This is the list version, and every entry is something
 * the player can pin right now.
 *
 * `contract` is null on an ordinary campaign errand and set on the faction's signature
 * contract. Both are **required**: the entry says which one is pinned, never which one is
 * skipped, because nothing here can be skipped.
 */
export interface CampaignContractView {
  /** The objective node id. */
  id: string
  contract: string | null
  title: string
  /** What the player would have to physically go and do. */
  task: string
  /** What failing costs, stated before the choice. */
  stake: string
  /** Map square, e.g. `C3`. */
  regionLabel: string
  pinned: boolean
  /** Null on an ordinary errand; the contract's state otherwise. */
  status: CampaignContractStatus | null
  /** Seconds left on a running contract's clock, null when it is not running. */
  timeRemaining: number | null
  /** Where to go. Null until the square has been placed in the world. */
  x: number | null
  z: number | null
}

export type BodyPart =
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg'
  | 'leftEye'
  | 'rightEye'

export interface BodyState {
  leftArm: PartStatus
  rightArm: PartStatus
  leftLeg: PartStatus
  rightLeg: PartStatus
  leftEye: PartStatus
  rightEye: PartStatus
  bleeding: number
}

export type AbilityId = 'bow' | 'shield' | 'cleave'

export interface AbilityView {
  id: AbilityId
  name: string
  ready: boolean
  active: boolean
  cooldown: number
  cooldownMax: number
}

export const ABILITY_INFO: Record<
  Faction,
  {
    id: AbilityId
    name: string
    cooldownMax: number
    staminaCost: number
  }
> = {
  elf: {
    id: 'bow',
    name: 'Лесная стрела',
    cooldownMax: 0.9,
    staminaCost: 15,
  },
  guard: {
    id: 'shield',
    name: 'Стойка щита',
    cooldownMax: 0.4,
    staminaCost: 0,
  },
  villain: {
    id: 'cleave',
    name: 'Сокрушающий рывок',
    cooldownMax: 3.5,
    staminaCost: 30,
  },
}

export function createAbilityView(
  faction: Faction,
  stamina = 100,
  body?: BodyState,
): AbilityView {
  const info = ABILITY_INFO[faction]
  const canUseBow =
    info.id !== 'bow' ||
    !body ||
    body.leftArm !== 'missing' ||
    body.rightArm !== 'missing'
  return {
    id: info.id,
    name: info.name,
    ready: (info.id === 'shield' ? stamina > 0 : stamina >= info.staminaCost) && canUseBow,
    active: false,
    cooldown: 0,
    cooldownMax: info.cooldownMax,
  }
}

/**
 * The player's melee sequence, as the HUD sees it.
 *
 * The beat counter is the only place the game says out loud that the attack button is a
 * sequence rather than a cooldown, and the finisher flag is the only place it says the
 * third beat costs something. `world/CombatResolver.ts` owns the timings; this is what
 * survives into the view.
 */
export interface MeleeView {
  /** The beat in flight, or the beat the sequence is still open on. 0 when closed. */
  beat: number
  /** How many beats the sequence has. The HUD draws this many pips. */
  beats: number
  /** True when the next press would throw the finisher and the stamina is there. */
  finisherReady: boolean
  /** Stamina the finisher costs. */
  finisherCost: number
  /** True while the finisher is running: no cancel, no movement. */
  committed: boolean
}

export function createMeleeView(beats: number, finisherCost: number): MeleeView {
  return {
    beat: 0,
    beats,
    finisherReady: false,
    finisherCost,
    committed: false,
  }
}

export interface Objective {
  id: string
  text: string
  done: boolean
  progress?: number
  target?: number
}

export interface MapMarker {
  id: string
  x: number
  z: number
  /**
   * §5.3 — colour follows the allegiance matrix, not the faction: `beast` is hostile to
   * everyone and gets its own tint, `neutral` is anything the player has no quarrel with.
   */
  kind:
    | 'player'
    | 'ally'
    | 'enemy'
    | 'beast'
    | 'neutral'
    | 'caravan'
    | 'landmark'
    | 'objective'
    | 'event'
    /** Roadmap 1.3 — the pinned rumour. Always visible, like the objective pin. */
    | 'rumour'
    /**
     * Roadmap 1.4 — a ready campaign node the player has *not* pinned.
     *
     * The pinned one keeps `objective`, so the compass still has one answer. This kind
     * exists because a fork the map does not draw is a fork the player never finds out
     * about, which is exactly the failure mode 1.4 is written against.
     */
    | 'contract'
  label?: string
  heading?: number
}

export interface WorldMapBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface WorldMapRegion {
  id: string
  gridX: number
  gridZ: number
  biome: ZoneId
  territory: Faction | 'neutral'
  discovered: boolean
  current: boolean
  contested: boolean
  razed: boolean
}

export interface ChronicleEntryView {
  id: string
  tick: number
  regionLabel: string
  text: string
  tone: NoticeTone
}

export interface WorldMapView {
  bounds: WorldMapBounds
  currentRegionId?: string
  seed?: number
  generatorVersion?: number
  regions: WorldMapRegion[]
}

export interface GameView {
  faction: Faction
  health: number
  maxHealth: number
  damageFlash: number
  stamina: number
  maxStamina: number
  gold: number
  kills: number
  damage: number
  zone: ZoneId
  body: BodyState
  objectives: Objective[]
  prompt: string
  markers: MapMarker[]
  worldMap: WorldMapView
  chronicle: ChronicleEntryView[]
  /** Roadmap 1.3 — up to two open rumours, plus the last verdict while it is fresh. */
  rumours: ChronicleRumourView[]
  /** Roadmap 1.4 — every campaign node the player could take on right now. */
  contracts: CampaignContractView[]
  shopPriceMultiplier: number
  squad: number
  elapsed: number
  pointerLocked: boolean
  paused: boolean
  caravanCooldown: number
  ability: AbilityView
  melee: MeleeView
  activeEvent: WorldEventView | null
  lootToast: LootToastView | null
  campaignCompleted: boolean
  threatTier: number
  upgrades: UpgradeLevels
}

export interface GameCallbacks {
  onView: (view: GameView) => void
  onNotice: (message: string, tone?: NoticeTone) => void
  onShop: () => void
  onPauseRequest: () => void
  onSaveRequest: () => void
  onEnd: (result: 'victory' | 'defeat') => void
  onAchievementUnlocked: (achievement: AchievementUnlock) => void
  /**
   * A diegetic first-time line was shown. The engine has no profile, so persisting the
   * ledger is the caller's job — and it is reported when the line is *shown*, not when it
   * is queued, so nothing is marked as taught that the player never saw.
   */
  onHintSeen: (hintId: string) => void
}

export interface ShopItem {
  id: 'medicine' | 'arm' | 'leg' | 'eye' | UpgradeId
  name: string
  description: string
  price: number
  priceStep?: number
  maxLevel?: number
  upgrade?: UpgradeId
}

export type UpgradeId = 'blade' | 'vitality' | 'endurance'

export type UpgradeLevels = Record<UpgradeId, number>

export const DEFAULT_UPGRADE_LEVELS: UpgradeLevels = {
  blade: 0,
  vitality: 0,
  endurance: 0,
}

export const MAX_HEALTH_PER_LEVEL = 15
export const MAX_STAMINA_PER_LEVEL = 12
export const MAX_THREAT_TIER = 5
export const THREAT_TIER_SECONDS = 180

export const FACTION_INFO: Record<
  Faction,
  {
    name: string
    shortName: string
    subtitle: string
    description: string
    perk: string
    spawn: [number, number]
  }
> = {
  elf: {
    name: 'Лесные эльфы',
    shortName: 'Эльф',
    subtitle: 'Раз лесные — то густой лес',
    description: 'Действие начинается в густом лесу, где стоят домики деревяные. Можно устраивать засады и грабить корованы.',
    perk: 'В густом лесу скорость выше, а союзники прибегают на зов.',
    spawn: [-48, 43],
  },
  guard: {
    name: 'Охрана дворца',
    shortName: 'Охранник',
    subtitle: 'Надо слушаться командира',
    description: 'Надо защищать дворец от злого, шпионов и партизан эльфов, потом ходить на набеги.',
    perk: 'Тяжёлая броня и поддержка имперских солдат.',
    spawn: [43, -42],
  },
  villain: {
    name: 'Злодей',
    shortName: 'Злодей',
    subtitle: 'Пользователь сам себе командир',
    description: 'Пользователь собирает войска в старом форте, приказывает напасть на дворец и сам идёт в атаку.',
    perk: 'Сильный удар и личный отряд приспешников.',
    spawn: [47, 45],
  },
}

export const ZONE_INFO: Record<ZoneId, ZoneInfo> = {
  neutral: {
    name: 'Зона людей',
    subtitle: 'нейтральная — можно покупать и т. п.',
    accent: '#c48742',
    motif: 'scrape',
  },
  palace: {
    name: 'Зона императора',
    subtitle: 'где дворец и его охрана',
    accent: '#547ac4',
    motif: 'chevron',
  },
  forest: {
    name: 'Зона эльфов',
    subtitle: 'густой лес и домики деревяные',
    accent: '#5b9d54',
    motif: 'organic',
  },
  fort: {
    name: 'Зона злого',
    subtitle: 'в горах, там есть старый форт',
    accent: '#b75b70',
    motif: 'slash',
  },
}

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'medicine',
    name: 'Полевой набор',
    description: 'Лечит раны и останавливает кровотечение. Если пользователя не вылечат — он умрёт.',
    price: 35,
  },
  {
    id: 'arm',
    name: 'Заводная рука',
    description: 'Заменяет потерянную руку. Самое хорошее — поставить протез.',
    price: 110,
  },
  {
    id: 'leg',
    name: 'Стальная нога',
    description: 'Заменяет потерянную ногу: не придётся ползать или кататься на коляске.',
    price: 125,
  },
  {
    id: 'eye',
    name: 'Хрустальный глаз',
    description: 'Заменяет потерянный глаз и возвращает ту половину экрана.',
    price: 90,
  },
  {
    id: 'blade',
    name: 'Кованый клинок',
    description: 'Навсегда увеличивает урон на 8. Каждая следующая закалка дороже.',
    price: 140,
    priceStep: 90,
    maxLevel: 10,
    upgrade: 'blade',
  },
  {
    id: 'vitality',
    name: 'Крепкое сердце',
    description: `Увеличивает максимум здоровья на ${MAX_HEALTH_PER_LEVEL} и сразу восстанавливает столько же.`,
    price: 120,
    priceStep: 80,
    maxLevel: 8,
    upgrade: 'vitality',
  },
  {
    id: 'endurance',
    name: 'Походная выучка',
    description: `Увеличивает максимум выносливости на ${MAX_STAMINA_PER_LEVEL} и сразу восполняет запас.`,
    price: 100,
    priceStep: 65,
    maxLevel: 8,
    upgrade: 'endurance',
  },
]

export function normalizeUpgradeLevels(value?: unknown): UpgradeLevels {
  if (!isRecord(value)) return { ...DEFAULT_UPGRADE_LEVELS }

  return {
    blade: normalizeUpgradeLevel(value.blade, 10),
    vitality: normalizeUpgradeLevel(value.vitality, 8),
    endurance: normalizeUpgradeLevel(value.endurance, 8),
  }
}

export function getShopItemPrice(
  item: ShopItem,
  levels: UpgradeLevels,
  priceMultiplier = 1,
): number {
  const base = item.upgrade
    ? item.price + (item.priceStep ?? 0) * levels[item.upgrade]
    : item.price
  const multiplier =
    Number.isFinite(priceMultiplier) && priceMultiplier > 0 ? priceMultiplier : 1
  return Math.max(1, Math.round(base * multiplier))
}

export function getMaxHealth(levels: UpgradeLevels): number {
  return 100 + levels.vitality * MAX_HEALTH_PER_LEVEL
}

export function getMaxStamina(levels: UpgradeLevels): number {
  return 100 + levels.endurance * MAX_STAMINA_PER_LEVEL
}

export function getThreatTier(elapsed: number): number {
  return Math.min(MAX_THREAT_TIER, 1 + Math.floor(Math.max(0, elapsed) / THREAT_TIER_SECONDS))
}

export function createHealthyBody(): BodyState {
  return {
    leftArm: 'healthy',
    rightArm: 'healthy',
    leftLeg: 'healthy',
    rightLeg: 'healthy',
    leftEye: 'healthy',
    rightEye: 'healthy',
    bleeding: 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeUpgradeLevel(value: unknown, maxLevel: number): number {
  return isFiniteNumber(value) ? Math.min(maxLevel, Math.max(0, Math.floor(value))) : 0
}
