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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeUpgradeLevel(value: unknown, maxLevel: number): number {
  return isFiniteNumber(value) ? Math.min(maxLevel, Math.max(0, Math.floor(value))) : 0
}
