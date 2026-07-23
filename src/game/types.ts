import type { AchievementUnlock } from './achievements'

export type Faction = 'elf' | 'guard' | 'villain'

export type ActorRole =
  | 'soldier'
  | 'scout'
  | 'commander'
  | 'minion'
  | 'archer'
  | 'brute'
  | 'champion'
  | 'captive'

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

export type WorldEventKind =
  | 'richCaravan'
  | 'defendHome'
  | 'champion'
  | 'rescue'
  | 'bounty'

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
    name: 'Стрела в спину',
    cooldownMax: 0.9,
    staminaCost: 15,
  },
  guard: {
    id: 'shield',
    name: 'Стоять, бояться!',
    cooldownMax: 0.4,
    staminaCost: 0,
  },
  villain: {
    id: 'cleave',
    name: 'Рывок с ноги',
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
  kind: 'player' | 'ally' | 'enemy' | 'caravan' | 'landmark' | 'objective' | 'event'
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
}

export interface WorldMapView {
  mode: 'legacy' | 'generated'
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
  squad: number
  elapsed: number
  pointerLocked: boolean
  paused: boolean
  caravanCooldown: number
  ability: AbilityView
  activeEvent: WorldEventView | null
  lootToast: LootToastView | null
  campaignCompleted: boolean
  threatTier: number
  upgrades: UpgradeLevels
}

export interface SavedGame {
  version: 1
  faction: Faction
  position: [number, number, number]
  health: number
  stamina: number
  gold: number
  kills: number
  damage: number
  body: BodyState
  objectives: Objective[]
  elapsed: number
  savedAt: string
  eventCooldown?: number
  championDamageBonus?: number
  campaignCompleted?: boolean
  campaignCompletedAt?: number
  threatTier?: number
  nextThreatWaveAt?: number
  upgradeLevels?: Partial<UpgradeLevels>
}

export interface GameCallbacks {
  onView: (view: GameView) => void
  onNotice: (message: string, tone?: NoticeTone) => void
  onShop: () => void
  onPauseRequest: () => void
  onSaveRequest: () => void
  onEnd: (result: 'victory' | 'defeat') => void
  onAchievementUnlocked: (achievement: AchievementUnlock) => void
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

export const SAVE_KEY = 'korovany-save-v1'

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
    name: 'Лесная братва',
    shortName: 'Ушастый',
    subtitle: 'Лесная гопота с луками',
    description: 'Сидите по кустам, стреляйте в спину и, ясное дело, грабьте корованы.',
    perk: 'В лесу носитесь как угорелые, а свои сбегаются на свист.',
    spawn: [-48, 43],
  },
  guard: {
    name: 'Дворцовая вахта',
    shortName: 'Вахтёр',
    subtitle: 'Приказ — это святое',
    description: 'Ловите приказы командира, держите дворец и от души зачищайте всех, на кого укажут.',
    perk: 'Броня как у танка и толпа имперских солдат за спиной.',
    spawn: [43, -42],
  },
  villain: {
    name: 'Злодей',
    shortName: 'Злодей',
    subtitle: 'Сам себе закон',
    description: 'Сколотите банду в старом форте и ведите её на дворец. Творите дичь — вам можно.',
    perk: 'Бьёте как молот и таскаете за собой личную свору приспешников.',
    spawn: [47, 45],
  },
}

export const ZONE_INFO: Record<ZoneId, ZoneInfo> = {
  neutral: {
    name: 'Вольные земли',
    subtitle: 'ничьё — значит, можно грабить',
    accent: '#c48742',
    motif: 'scrape',
  },
  palace: {
    name: 'Имперский удел',
    subtitle: 'дворец, казарма и куча стражи',
    accent: '#547ac4',
    motif: 'chevron',
  },
  forest: {
    name: 'Чаща Эленвуда',
    subtitle: 'вотчина лесной гопоты',
    accent: '#5b9d54',
    motif: 'organic',
  },
  fort: {
    name: 'Чёрный кряж',
    subtitle: 'горы, форт и дурная слава',
    accent: '#b75b70',
    motif: 'slash',
  },
}

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'medicine',
    name: 'Полевая аптечка',
    description: 'Штопает раны, глушит кровотечение и поднимает на ноги. Не спрашивайте, из чего.',
    price: 35,
  },
  {
    id: 'arm',
    name: 'Заводная рука',
    description: 'Прикручивается вместо оторванной руки. Бьёт даже злее родной.',
    price: 110,
  },
  {
    id: 'leg',
    name: 'Стальная нога',
    description: 'Ставится вместо потерянной ноги. Снова носитесь как раньше, только скрипите.',
    price: 125,
  },
  {
    id: 'eye',
    name: 'Хрустальный глаз',
    description: 'Вставляется в пустую глазницу. Видит всё, а моргать так и не научился.',
    price: 90,
  },
  {
    id: 'blade',
    name: 'Кованый клинок',
    description: 'Точим железо: +8 к урону навсегда. Каждая заточка бьёт по кошельку больнее.',
    price: 140,
    priceStep: 90,
    maxLevel: 10,
    upgrade: 'blade',
  },
  {
    id: 'vitality',
    name: 'Крепкое сердце',
    description: `Раздувает максимум здоровья на ${MAX_HEALTH_PER_LEVEL} и тут же доливает столько же.`,
    price: 120,
    priceStep: 80,
    maxLevel: 8,
    upgrade: 'vitality',
  },
  {
    id: 'endurance',
    name: 'Походная выучка',
    description: `Прибавляет ${MAX_STAMINA_PER_LEVEL} выносливости и сразу забивает шкалу под завязку.`,
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

export function getShopItemPrice(item: ShopItem, levels: UpgradeLevels): number {
  if (!item.upgrade) return item.price
  return item.price + (item.priceStep ?? 0) * levels[item.upgrade]
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

export function createObjectives(faction: Faction): Objective[] {
  if (faction === 'elf') {
    return [
      { id: 'raid', text: 'Обнести имперский корован', done: false },
      { id: 'guards', text: 'Раскидать дворцовую охрану', done: false, progress: 0, target: 4 },
      { id: 'home', text: 'Дотащить хабар к зелёному маяку в лагере', done: false },
    ]
  }

  if (faction === 'guard') {
    return [
      { id: 'orders', text: 'Выслушать бухтёж командира', done: false },
      { id: 'defend', text: 'Отметелить налётчиков', done: false, progress: 0, target: 4 },
      { id: 'patrol', text: 'Доползти до старого форта', done: false },
    ]
  }

  return [
    { id: 'rally', text: 'Свистнуть приспешников в кучу', done: false },
    { id: 'breach', text: 'Ввалиться в имперский удел', done: false },
    { id: 'commander', text: 'Уложить командира дворца', done: false },
  ]
}

export function restoreObjectives(
  faction: Faction,
  savedObjectives?: Objective[],
): Objective[] {
  const currentObjectives = createObjectives(faction)
  if (!savedObjectives) return currentObjectives

  return currentObjectives.map((objective) => {
    const saved = savedObjectives.find((entry) => entry.id === objective.id)
    if (!saved) return objective

    const progress =
      objective.target === undefined
        ? undefined
        : saved.done
          ? objective.target
          : Math.min(objective.target, Math.max(0, saved.progress ?? 0))

    return {
      ...objective,
      done: saved.done,
      ...(progress === undefined ? {} : { progress }),
    }
  })
}

export function normalizeSavedGame(value: unknown): SavedGame | null {
  if (!isRecord(value) || value.version !== 1 || !isFaction(value.faction)) return null
  if (
    !isPosition(value.position) ||
    !isFiniteNumber(value.health) ||
    !isFiniteNumber(value.stamina) ||
    !isFiniteNumber(value.gold) ||
    !isFiniteNumber(value.kills) ||
    !isFiniteNumber(value.damage) ||
    !isFiniteNumber(value.elapsed) ||
    typeof value.savedAt !== 'string'
  ) {
    return null
  }

  const body = normalizeBody(value.body)
  const objectives = normalizeObjectives(value.objectives)
  if (!body || !objectives) return null
  const championDamageBonus = isFiniteNumber(value.championDamageBonus)
    ? Math.max(0, value.championDamageBonus)
    : 0
  const upgradeLevels =
    value.upgradeLevels === undefined
      ? inferLegacyUpgradeLevels(value.faction, value.damage, championDamageBonus)
      : normalizeUpgradeLevels(value.upgradeLevels)

  const save: SavedGame = {
    version: 1,
    faction: value.faction,
    position: value.position,
    health: Math.max(0, value.health),
    stamina: Math.max(0, value.stamina),
    gold: Math.max(0, Math.floor(value.gold)),
    kills: Math.max(0, Math.floor(value.kills)),
    damage: Math.max(0, value.damage),
    body,
    objectives,
    elapsed: Math.max(0, value.elapsed),
    savedAt: value.savedAt,
    upgradeLevels,
  }

  if (isFiniteNumber(value.eventCooldown)) save.eventCooldown = Math.max(0, value.eventCooldown)
  if (isFiniteNumber(value.championDamageBonus)) save.championDamageBonus = championDamageBonus
  if (typeof value.campaignCompleted === 'boolean') {
    save.campaignCompleted = value.campaignCompleted
  }
  if (isFiniteNumber(value.campaignCompletedAt)) {
    save.campaignCompletedAt = Math.max(0, value.campaignCompletedAt)
  }
  if (isFiniteNumber(value.threatTier)) {
    save.threatTier = Math.min(MAX_THREAT_TIER, Math.max(1, Math.floor(value.threatTier)))
  }
  if (isFiniteNumber(value.nextThreatWaveAt)) {
    save.nextThreatWaveAt = Math.max(0, value.nextThreatWaveAt)
  }

  return save
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFaction(value: unknown): value is Faction {
  return value === 'elf' || value === 'guard' || value === 'villain'
}

function isPosition(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => isFiniteNumber(entry))
  )
}

function isPartStatus(value: unknown): value is PartStatus {
  return value === 'healthy' || value === 'wounded' || value === 'missing' || value === 'prosthetic'
}

function normalizeBody(value: unknown): BodyState | null {
  if (!isRecord(value)) return null
  const { leftArm, rightArm, leftLeg, rightLeg, leftEye, rightEye, bleeding } = value
  if (
    !isPartStatus(leftArm) ||
    !isPartStatus(rightArm) ||
    !isPartStatus(leftLeg) ||
    !isPartStatus(rightLeg) ||
    !isPartStatus(leftEye) ||
    !isPartStatus(rightEye) ||
    !isFiniteNumber(bleeding)
  ) {
    return null
  }

  return {
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    leftEye,
    rightEye,
    bleeding: Math.max(0, bleeding),
  }
}

function normalizeObjectives(value: unknown): Objective[] | null {
  if (!Array.isArray(value)) return null
  const objectives: Objective[] = []
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.text !== 'string' ||
      typeof entry.done !== 'boolean'
    ) {
      return null
    }
    if (entry.progress !== undefined && !isFiniteNumber(entry.progress)) return null
    if (entry.target !== undefined && !isFiniteNumber(entry.target)) return null
    objectives.push({
      id: entry.id,
      text: entry.text,
      done: entry.done,
      ...(entry.progress === undefined ? {} : { progress: Math.max(0, entry.progress) }),
      ...(entry.target === undefined ? {} : { target: Math.max(0, entry.target) }),
    })
  }
  return objectives
}

function normalizeUpgradeLevel(value: unknown, maxLevel: number): number {
  return isFiniteNumber(value) ? Math.min(maxLevel, Math.max(0, Math.floor(value))) : 0
}

function inferLegacyUpgradeLevels(
  faction: Faction,
  damage: number,
  championDamageBonus: number,
): UpgradeLevels {
  const baseDamage = faction === 'villain' ? 31 : faction === 'guard' ? 28 : 26
  const bladeLevels = Math.floor(
    Math.max(0, damage - baseDamage - championDamageBonus) / 8,
  )
  return {
    ...DEFAULT_UPGRADE_LEVELS,
    blade: normalizeUpgradeLevel(bladeLevels, 10),
  }
}
