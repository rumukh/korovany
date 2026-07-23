import type {
  AbilityId,
  ActorRole,
  BodyPart,
  Faction,
  ShopItem,
  WorldEventKind,
  ZoneId,
} from './types'

export const ACHIEVEMENTS_STORAGE_KEY = 'korovany-achievements-v1'

export type AchievementRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export type AchievementCategory =
  | 'journey'
  | 'combat'
  | 'factions'
  | 'economy'
  | 'caravans'
  | 'events'
  | 'mastery'
  | 'quirks'
  | 'collection'

export interface AchievementDefinition {
  id: string
  name: string
  description: string
  rarity: AchievementRarity
  category: AchievementCategory
  target: number
  hidden?: boolean
}

export interface AchievementView extends AchievementDefinition {
  progress: number
  unlocked: boolean
  unlockedAt: string | null
}

export interface AchievementUnlock {
  id: string
  name: string
  description: string
  rarity: AchievementRarity
  category: AchievementCategory
  unlockedAt: string
}

export interface AchievementSummary {
  unlocked: number
  total: number
  percent: number
  byRarity: Record<AchievementRarity, { unlocked: number; total: number }>
}

type NumericMap<Key extends string> = Record<Key, number>

export interface AchievementStats {
  runsStarted: number
  kills: number
  killsByRole: NumericMap<ActorRole>
  killsByFaction: NumericMap<Faction>
  goldEarned: number
  purchases: number
  purchasesByItem: NumericMap<ShopItem['id']>
  caravansRobbed: number
  richCaravansRobbed: number
  objectivesCompleted: number
  eventsCompleted: number
  eventsFailed: number
  eventsByKind: NumericMap<WorldEventKind>
  victories: number
  defeats: number
  factionVictories: NumericMap<Faction>
  injuries: number
  limbsLost: number
  abilityUses: number
  shieldBlocks: number
  squadCommands: number
  completedRunSeconds: number
  zonesVisited: ZoneId[]
}

export interface AchievementRunState {
  runId: string
  faction: Faction
  startedAt: string
  kills: number
  killsSinceDamage: number
  bestKillStreak: number
  damageTaken: number
  injuries: number
  limbsLost: number
  goldEarned: number
  purchases: number
  objectivesCompleted: number
  eventsCompleted: number
  abilitiesUsed: number
  shieldBlocks: number
  squadCommands: number
  caravansRobbed: number
  zonesVisited: ZoneId[]
  eventKindsCompleted: WorldEventKind[]
  unlockedIds: string[]
  result: 'victory' | 'defeat' | null
  elapsedAtEnd: number
  healthAtEnd: number
}

interface AchievementStore {
  version: 1
  stats: AchievementStats
  unlocked: Record<string, string>
  lastStartedRunId: string | null
}

interface AchievementContext {
  stats: AchievementStats
  run: AchievementRunState | null
}

interface InternalAchievementDefinition extends AchievementDefinition {
  getProgress: (context: AchievementContext) => number
}

const ACTOR_ROLES: ActorRole[] = [
  'soldier',
  'scout',
  'commander',
  'minion',
  'archer',
  'brute',
  'champion',
  'captive',
]
const FACTIONS: Faction[] = ['elf', 'guard', 'villain']
const SHOP_ITEM_IDS: ShopItem['id'][] = ['medicine', 'arm', 'leg', 'eye', 'blade']
const EVENT_KINDS: WorldEventKind[] = ['richCaravan', 'defendHome', 'champion', 'rescue', 'bounty']
const ZONES: ZoneId[] = ['neutral', 'palace', 'forest', 'fort']

export const ACHIEVEMENT_RARITY_LABELS: Record<AchievementRarity, string> = {
  common: 'Обычное',
  uncommon: 'Необычное',
  rare: 'Редкое',
  epic: 'Эпическое',
  legendary: 'Легендарное',
}

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  journey: 'Путь героя',
  combat: 'Ратное дело',
  factions: 'Охота на фракции',
  economy: 'Золото и торговля',
  caravans: 'Корованы',
  events: 'События мира',
  mastery: 'Мастерство',
  quirks: 'Шрамы и странности',
  collection: 'Коллекция подвигов',
}

export const ACHIEVEMENT_RARITY_ORDER: AchievementRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]

export const ACHIEVEMENT_CATEGORY_ORDER: AchievementCategory[] = [
  'journey',
  'combat',
  'factions',
  'economy',
  'caravans',
  'events',
  'mastery',
  'quirks',
  'collection',
]

function emptyNumericMap<Key extends string>(keys: readonly Key[]): NumericMap<Key> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as NumericMap<Key>
}

function createDefaultStats(): AchievementStats {
  return {
    runsStarted: 0,
    kills: 0,
    killsByRole: emptyNumericMap(ACTOR_ROLES),
    killsByFaction: emptyNumericMap(FACTIONS),
    goldEarned: 0,
    purchases: 0,
    purchasesByItem: emptyNumericMap(SHOP_ITEM_IDS),
    caravansRobbed: 0,
    richCaravansRobbed: 0,
    objectivesCompleted: 0,
    eventsCompleted: 0,
    eventsFailed: 0,
    eventsByKind: emptyNumericMap(EVENT_KINDS),
    victories: 0,
    defeats: 0,
    factionVictories: emptyNumericMap(FACTIONS),
    injuries: 0,
    limbsLost: 0,
    abilityUses: 0,
    shieldBlocks: 0,
    squadCommands: 0,
    completedRunSeconds: 0,
    zonesVisited: [],
  }
}

function createRunState(
  faction: Faction,
  runId: string = crypto.randomUUID(),
): AchievementRunState {
  return {
    runId,
    faction,
    startedAt: new Date().toISOString(),
    kills: 0,
    killsSinceDamage: 0,
    bestKillStreak: 0,
    damageTaken: 0,
    injuries: 0,
    limbsLost: 0,
    goldEarned: 0,
    purchases: 0,
    objectivesCompleted: 0,
    eventsCompleted: 0,
    abilitiesUsed: 0,
    shieldBlocks: 0,
    squadCommands: 0,
    caravansRobbed: 0,
    zonesVisited: [],
    eventKindsCompleted: [],
    unlockedIds: [],
    result: null,
    elapsedAtEnd: 0,
    healthAtEnd: 0,
  }
}

const definitions: InternalAchievementDefinition[] = [
  {
    id: 'first-march',
    name: 'Понеслась',
    description: 'Начать первый забег.',
    rarity: 'common',
    category: 'journey',
    target: 1,
    getProgress: ({ stats }) => stats.runsStarted,
  },
  {
    id: 'road-regular',
    name: 'Заядлый',
    description: 'Начать 5 забегов.',
    rarity: 'common',
    category: 'journey',
    target: 5,
    getProgress: ({ stats }) => stats.runsStarted,
  },
  {
    id: 'seasoned-wanderer',
    name: 'Хроник',
    description: 'Начать 15 забегов.',
    rarity: 'uncommon',
    category: 'journey',
    target: 15,
    getProgress: ({ stats }) => stats.runsStarted,
  },
  {
    id: 'first-blood',
    name: 'Первая кровь',
    description: 'Лично уронить первого врага.',
    rarity: 'common',
    category: 'combat',
    target: 1,
    getProgress: ({ stats }) => stats.kills,
  },
  {
    id: 'warm-up',
    name: 'Размялся',
    description: 'Лично уронить 5 врагов.',
    rarity: 'common',
    category: 'combat',
    target: 5,
    getProgress: ({ stats }) => stats.kills,
  },
  {
    id: 'warrior',
    name: 'Мясник',
    description: 'Лично уронить 25 врагов.',
    rarity: 'uncommon',
    category: 'combat',
    target: 25,
    getProgress: ({ stats }) => stats.kills,
  },
  {
    id: 'battlefield-terror',
    name: 'Гроза обочин',
    description: 'Лично уронить 100 врагов.',
    rarity: 'rare',
    category: 'combat',
    target: 100,
    getProgress: ({ stats }) => stats.kills,
  },
  {
    id: 'living-legend',
    name: 'Живая легенда',
    description: 'Лично уронить 300 врагов.',
    rarity: 'legendary',
    category: 'combat',
    target: 300,
    getProgress: ({ stats }) => stats.kills,
  },
  {
    id: 'elf-hunter',
    name: 'Лесоруб',
    description: 'Уронить 20 ушастых из чащи.',
    rarity: 'uncommon',
    category: 'factions',
    target: 20,
    getProgress: ({ stats }) => stats.killsByFaction.elf,
  },
  {
    id: 'guard-breaker',
    name: 'Смена не пришла',
    description: 'Уронить 20 дворцовых вахтёров.',
    rarity: 'uncommon',
    category: 'factions',
    target: 20,
    getProgress: ({ stats }) => stats.killsByFaction.guard,
  },
  {
    id: 'villain-hunter',
    name: 'Злодею злодей',
    description: 'Уронить 20 приспешников злодея.',
    rarity: 'uncommon',
    category: 'factions',
    target: 20,
    getProgress: ({ stats }) => stats.killsByFaction.villain,
  },
  {
    id: 'brute-force',
    name: 'Кто кого',
    description: 'Уронить 5 громил.',
    rarity: 'uncommon',
    category: 'combat',
    target: 5,
    getProgress: ({ stats }) => stats.killsByRole.brute,
  },
  {
    id: 'chain-of-command',
    name: 'Дерзость',
    description: 'Уронить командира.',
    rarity: 'uncommon',
    category: 'combat',
    target: 1,
    getProgress: ({ stats }) => stats.killsByRole.commander,
  },
  {
    id: 'commander-collector',
    name: 'Кадровый голод',
    description: 'Уронить 5 командиров.',
    rarity: 'rare',
    category: 'combat',
    target: 5,
    getProgress: ({ stats }) => stats.killsByRole.commander,
  },
  {
    id: 'champion-fallen',
    name: 'Трофейный шлем',
    description: 'Уронить заезжего чемпиона.',
    rarity: 'rare',
    category: 'combat',
    target: 1,
    getProgress: ({ stats }) => stats.killsByRole.champion,
  },
  {
    id: 'champion-hunter',
    name: 'Гроза чемпионов',
    description: 'Уронить 5 чемпионов.',
    rarity: 'epic',
    category: 'combat',
    target: 5,
    getProgress: ({ stats }) => stats.killsByRole.champion,
  },
  {
    id: 'silence-archers',
    name: 'Тишина на стенах',
    description: 'Уронить 10 лучников.',
    rarity: 'uncommon',
    category: 'combat',
    target: 10,
    getProgress: ({ stats }) => stats.killsByRole.archer,
  },
  {
    id: 'ten-in-run',
    name: 'Разошёлся',
    description: 'Лично уронить 10 врагов за один забег.',
    rarity: 'uncommon',
    category: 'mastery',
    target: 10,
    getProgress: ({ run }) => run?.kills ?? 0,
  },
  {
    id: 'twenty-five-in-run',
    name: 'Берсерк',
    description: 'Лично уронить 25 врагов за один забег.',
    rarity: 'epic',
    category: 'mastery',
    target: 25,
    hidden: true,
    getProgress: ({ run }) => run?.kills ?? 0,
  },
  {
    id: 'untouched-streak',
    name: 'Неуловимый',
    description: 'Уронить 10 врагов подряд без единой царапины.',
    rarity: 'epic',
    category: 'mastery',
    target: 10,
    hidden: true,
    getProgress: ({ run }) => run?.bestKillStreak ?? 0,
  },
  {
    id: 'first-purse',
    name: 'Мелочь звенит',
    description: 'Намародёрить 100 золота.',
    rarity: 'common',
    category: 'economy',
    target: 100,
    getProgress: ({ stats }) => stats.goldEarned,
  },
  {
    id: 'heavy-purse',
    name: 'Кошель пухнет',
    description: 'Намародёрить 500 золота.',
    rarity: 'uncommon',
    category: 'economy',
    target: 500,
    getProgress: ({ stats }) => stats.goldEarned,
  },
  {
    id: 'gold-magnate',
    name: 'Корованный барон',
    description: 'Намародёрить 2000 золота.',
    rarity: 'rare',
    category: 'economy',
    target: 2000,
    getProgress: ({ stats }) => stats.goldEarned,
  },
  {
    id: 'first-purchase',
    name: 'Клиент',
    description: 'Отовариться у барыги впервые.',
    rarity: 'common',
    category: 'economy',
    target: 1,
    getProgress: ({ stats }) => stats.purchases,
  },
  {
    id: 'regular-customer',
    name: 'Свой человек',
    description: 'Отовариться у барыги 10 раз.',
    rarity: 'uncommon',
    category: 'economy',
    target: 10,
    getProgress: ({ stats }) => stats.purchases,
  },
  {
    id: 'tempered-steel',
    name: 'Заточка',
    description: 'Прикупить кованый клинок.',
    rarity: 'common',
    category: 'economy',
    target: 1,
    getProgress: ({ stats }) => stats.purchasesByItem.blade,
  },
  {
    id: 'field-medic',
    name: 'Сам себе коновал',
    description: 'Прикупить 3 полевые аптечки.',
    rarity: 'uncommon',
    category: 'economy',
    target: 3,
    getProgress: ({ stats }) => stats.purchasesByItem.medicine,
  },
  {
    id: 'more-metal',
    name: 'Киборг-корованщик',
    description: 'Вкрутить 3 протеза.',
    rarity: 'rare',
    category: 'quirks',
    target: 3,
    getProgress: ({ stats }) =>
      stats.purchasesByItem.arm + stats.purchasesByItem.leg + stats.purchasesByItem.eye,
  },
  {
    id: 'caravan-robber',
    name: 'Грабить корованы',
    description: 'Обнести первый корован.',
    rarity: 'common',
    category: 'caravans',
    target: 1,
    getProgress: ({ stats }) => stats.caravansRobbed,
  },
  {
    id: 'caravan-professional',
    name: 'Корованщик со стажем',
    description: 'Обнести 10 корованов.',
    rarity: 'rare',
    category: 'caravans',
    target: 10,
    getProgress: ({ stats }) => stats.caravansRobbed,
  },
  {
    id: 'golden-road',
    name: 'Золотая жила',
    description: 'Свалить от погони с 3 жирными корованами.',
    rarity: 'epic',
    category: 'caravans',
    target: 3,
    getProgress: ({ stats }) => stats.richCaravansRobbed,
  },
  {
    id: 'first-objective',
    name: 'Галочка',
    description: 'Сделать первое делишко.',
    rarity: 'common',
    category: 'journey',
    target: 1,
    getProgress: ({ stats }) => stats.objectivesCompleted,
  },
  {
    id: 'ten-objectives',
    name: 'Работяга',
    description: 'Обтяпать 10 делишек.',
    rarity: 'uncommon',
    category: 'journey',
    target: 10,
    getProgress: ({ stats }) => stats.objectivesCompleted,
  },
  {
    id: 'thirty-objectives',
    name: 'Всё чётко',
    description: 'Обтяпать 30 делишек.',
    rarity: 'rare',
    category: 'journey',
    target: 30,
    getProgress: ({ stats }) => stats.objectivesCompleted,
  },
  {
    id: 'first-event',
    name: 'Влез в движуху',
    description: 'Закрыть движуху в мире.',
    rarity: 'common',
    category: 'events',
    target: 1,
    getProgress: ({ stats }) => stats.eventsCompleted,
  },
  {
    id: 'five-events',
    name: 'Свой в движухе',
    description: 'Закрыть 5 движух в мире.',
    rarity: 'uncommon',
    category: 'events',
    target: 5,
    getProgress: ({ stats }) => stats.eventsCompleted,
  },
  {
    id: 'twenty-events',
    name: 'Хронист угара',
    description: 'Закрыть 20 движух в мире.',
    rarity: 'rare',
    category: 'events',
    target: 20,
    getProgress: ({ stats }) => stats.eventsCompleted,
  },
  {
    id: 'event-rich-caravan',
    name: 'Куш',
    description: 'Закрыть движуху «Жирный корован».',
    rarity: 'common',
    category: 'events',
    target: 1,
    getProgress: ({ stats }) => stats.eventsByKind.richCaravan,
  },
  {
    id: 'event-defend-home',
    name: 'Пожарный',
    description: 'Отбить дом у налётчиков.',
    rarity: 'common',
    category: 'events',
    target: 1,
    getProgress: ({ stats }) => stats.eventsByKind.defendHome,
  },
  {
    id: 'event-champion',
    name: 'Принял вызов',
    description: 'Закрыть движуху с заезжим чемпионом.',
    rarity: 'uncommon',
    category: 'events',
    target: 1,
    getProgress: ({ stats }) => stats.eventsByKind.champion,
  },
  {
    id: 'event-rescue',
    name: 'Своих не бросаем',
    description: 'Распутать бедолагу у дороги.',
    rarity: 'common',
    category: 'events',
    target: 1,
    getProgress: ({ stats }) => stats.eventsByKind.rescue,
  },
  {
    id: 'event-bounty',
    name: 'По следу',
    description: 'Срубить награду за меченую голову.',
    rarity: 'common',
    category: 'events',
    target: 1,
    getProgress: ({ stats }) => stats.eventsByKind.bounty,
  },
  {
    id: 'all-events',
    name: 'Видал всякое',
    description: 'Закрыть движухи всех пяти видов.',
    rarity: 'rare',
    category: 'collection',
    target: EVENT_KINDS.length,
    getProgress: ({ stats }) =>
      EVENT_KINDS.filter((kind) => stats.eventsByKind[kind] > 0).length,
  },
  {
    id: 'four-zones-run',
    name: 'Карта в сапоге',
    description: 'Оббегать все четыре земли за один забег.',
    rarity: 'uncommon',
    category: 'journey',
    target: ZONES.length,
    getProgress: ({ run }) => run?.zonesVisited.length ?? 0,
  },
  {
    id: 'four-zones-ever',
    name: 'Знаю тропки',
    description: 'Открыть все земли мира.',
    rarity: 'common',
    category: 'collection',
    target: ZONES.length,
    getProgress: ({ stats }) => stats.zonesVisited.length,
  },
  {
    id: 'first-victory',
    name: 'Корованы наши!',
    description: 'Дожать забег до победы.',
    rarity: 'uncommon',
    category: 'mastery',
    target: 1,
    getProgress: ({ stats }) => stats.victories,
  },
  {
    id: 'three-banners',
    name: 'Три знамени',
    description: 'Взять победу за каждую из трёх банд.',
    rarity: 'legendary',
    category: 'collection',
    target: FACTIONS.length,
    getProgress: ({ stats }) =>
      FACTIONS.filter((faction) => stats.factionVictories[faction] > 0).length,
  },
  {
    id: 'ten-victories',
    name: 'Хозяин дорог',
    description: 'Дожать до победы 10 забегов.',
    rarity: 'epic',
    category: 'mastery',
    target: 10,
    getProgress: ({ stats }) => stats.victories,
  },
  {
    id: 'speed-victory',
    name: 'Пока чайник кипит',
    description: 'Победить меньше чем за 5 минут.',
    rarity: 'epic',
    category: 'mastery',
    target: 1,
    hidden: true,
    getProgress: ({ run }) =>
      Number(run?.result === 'victory' && run.elapsedAtEnd <= 300),
  },
  {
    id: 'flawless-victory',
    name: 'Ни царапины',
    description: 'Победить, не словив ни разу.',
    rarity: 'legendary',
    category: 'mastery',
    target: 1,
    hidden: true,
    getProgress: ({ run }) =>
      Number(run?.result === 'victory' && run.damageTaken === 0),
  },
  {
    id: 'last-breath',
    name: 'На честном слове',
    description: 'Победить, имея не больше 20 здоровья.',
    rarity: 'rare',
    category: 'mastery',
    target: 1,
    hidden: true,
    getProgress: ({ run }) =>
      Number(run?.result === 'victory' && run.healthAtEnd <= 20),
  },
  {
    id: 'battle-scar',
    name: 'Боевой шрам',
    description: 'Словить первое ранение.',
    rarity: 'common',
    category: 'quirks',
    target: 1,
    getProgress: ({ stats }) => stats.injuries,
  },
  {
    id: 'parting-ways',
    name: 'Расстались по-хорошему',
    description: 'Лишиться части тела.',
    rarity: 'uncommon',
    category: 'quirks',
    target: 1,
    getProgress: ({ stats }) => stats.limbsLost,
  },
  {
    id: 'ability-student',
    name: 'Коронный финт',
    description: 'Пустить в ход способность банды 10 раз.',
    rarity: 'common',
    category: 'mastery',
    target: 10,
    getProgress: ({ stats }) => stats.abilityUses,
  },
  {
    id: 'ability-master',
    name: 'На автомате',
    description: 'Пустить в ход способность банды 100 раз.',
    rarity: 'rare',
    category: 'mastery',
    target: 100,
    getProgress: ({ stats }) => stats.abilityUses,
  },
  {
    id: 'shield-wall',
    name: 'Стена щитов',
    description: 'Отбить щитом 25 ударов.',
    rarity: 'rare',
    category: 'mastery',
    target: 25,
    getProgress: ({ stats }) => stats.shieldBlocks,
  },
  {
    id: 'born-commander',
    name: 'Пахан',
    description: 'Скомандовать братве 10 раз.',
    rarity: 'uncommon',
    category: 'mastery',
    target: 10,
    getProgress: ({ stats }) => stats.squadCommands,
  },
  {
    id: 'long-road',
    name: 'Часовой на тропе',
    description: 'Провести в законченных забегах целый час.',
    rarity: 'rare',
    category: 'journey',
    target: 3600,
    getProgress: ({ stats }) => stats.completedRunSeconds,
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function parseNumericMap<Key extends string>(
  value: unknown,
  keys: readonly Key[],
): NumericMap<Key> {
  const record = isRecord(value) ? value : {}
  return Object.fromEntries(
    keys.map((key) => [key, nonNegativeNumber(record[key])]),
  ) as NumericMap<Key>
}

function parseStringArray<Key extends string>(value: unknown, allowed: readonly Key[]): Key[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is Key => allowed.includes(entry as Key)))]
}

function normalizeRunNumber(value: unknown, integer = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value))
  return integer ? Math.floor(normalized) : normalized
}

function normalizeRunStringArray<Key extends string>(
  value: unknown,
  allowed?: readonly Key[],
): Key[] | null {
  if (!Array.isArray(value) || value.length > 512) return null
  const entries: Key[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.length > 128 ||
      (allowed && !allowed.includes(entry as Key))
    ) {
      return null
    }
    if (!seen.has(entry)) {
      seen.add(entry)
      entries.push(entry as Key)
    }
  }
  return entries
}

export function normalizeAchievementRunState(value: unknown): AchievementRunState | null {
  if (!isRecord(value)) return null
  if (
    typeof value.runId !== 'string' ||
    value.runId.length === 0 ||
    value.runId.length > 128 ||
    !FACTIONS.includes(value.faction as Faction) ||
    typeof value.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.startedAt))
  ) {
    return null
  }

  const kills = normalizeRunNumber(value.kills, true)
  const killsSinceDamage = normalizeRunNumber(value.killsSinceDamage, true)
  const bestKillStreak = normalizeRunNumber(value.bestKillStreak, true)
  const damageTaken = normalizeRunNumber(value.damageTaken)
  const injuries = normalizeRunNumber(value.injuries, true)
  const limbsLost = normalizeRunNumber(value.limbsLost, true)
  const goldEarned = normalizeRunNumber(value.goldEarned)
  const purchases = normalizeRunNumber(value.purchases, true)
  const objectivesCompleted = normalizeRunNumber(value.objectivesCompleted, true)
  const eventsCompleted = normalizeRunNumber(value.eventsCompleted, true)
  const abilitiesUsed = normalizeRunNumber(value.abilitiesUsed, true)
  const shieldBlocks = normalizeRunNumber(value.shieldBlocks, true)
  const squadCommands = normalizeRunNumber(value.squadCommands, true)
  const caravansRobbed = normalizeRunNumber(value.caravansRobbed, true)
  const elapsedAtEnd = normalizeRunNumber(value.elapsedAtEnd)
  const healthAtEnd = normalizeRunNumber(value.healthAtEnd)
  const zonesVisited = normalizeRunStringArray(value.zonesVisited, ZONES)
  const eventKindsCompleted = normalizeRunStringArray(value.eventKindsCompleted, EVENT_KINDS)
  const unlockedIds = normalizeRunStringArray<string>(value.unlockedIds)
  const result =
    value.result === null || value.result === 'victory' || value.result === 'defeat'
      ? value.result
      : undefined

  if (
    kills === null ||
    killsSinceDamage === null ||
    bestKillStreak === null ||
    damageTaken === null ||
    injuries === null ||
    limbsLost === null ||
    goldEarned === null ||
    purchases === null ||
    objectivesCompleted === null ||
    eventsCompleted === null ||
    abilitiesUsed === null ||
    shieldBlocks === null ||
    squadCommands === null ||
    caravansRobbed === null ||
    elapsedAtEnd === null ||
    healthAtEnd === null ||
    zonesVisited === null ||
    eventKindsCompleted === null ||
    unlockedIds === null ||
    result === undefined
  ) {
    return null
  }

  return {
    runId: value.runId,
    faction: value.faction as Faction,
    startedAt: value.startedAt,
    kills,
    killsSinceDamage,
    bestKillStreak,
    damageTaken,
    injuries,
    limbsLost,
    goldEarned,
    purchases,
    objectivesCompleted,
    eventsCompleted,
    abilitiesUsed,
    shieldBlocks,
    squadCommands,
    caravansRobbed,
    zonesVisited,
    eventKindsCompleted,
    unlockedIds,
    result,
    elapsedAtEnd,
    healthAtEnd,
  }
}

export function cloneAchievementRunState(value: unknown): AchievementRunState | null {
  return normalizeAchievementRunState(value)
}

function parseStats(value: unknown): AchievementStats {
  const source = isRecord(value) ? value : {}
  return {
    runsStarted: nonNegativeNumber(source.runsStarted),
    kills: nonNegativeNumber(source.kills),
    killsByRole: parseNumericMap(source.killsByRole, ACTOR_ROLES),
    killsByFaction: parseNumericMap(source.killsByFaction, FACTIONS),
    goldEarned: nonNegativeNumber(source.goldEarned),
    purchases: nonNegativeNumber(source.purchases),
    purchasesByItem: parseNumericMap(source.purchasesByItem, SHOP_ITEM_IDS),
    caravansRobbed: nonNegativeNumber(source.caravansRobbed),
    richCaravansRobbed: nonNegativeNumber(source.richCaravansRobbed),
    objectivesCompleted: nonNegativeNumber(source.objectivesCompleted),
    eventsCompleted: nonNegativeNumber(source.eventsCompleted),
    eventsFailed: nonNegativeNumber(source.eventsFailed),
    eventsByKind: parseNumericMap(source.eventsByKind, EVENT_KINDS),
    victories: nonNegativeNumber(source.victories),
    defeats: nonNegativeNumber(source.defeats),
    factionVictories: parseNumericMap(source.factionVictories, FACTIONS),
    injuries: nonNegativeNumber(source.injuries),
    limbsLost: nonNegativeNumber(source.limbsLost),
    abilityUses: nonNegativeNumber(source.abilityUses),
    shieldBlocks: nonNegativeNumber(source.shieldBlocks),
    squadCommands: nonNegativeNumber(source.squadCommands),
    completedRunSeconds: nonNegativeNumber(source.completedRunSeconds),
    zonesVisited: parseStringArray(source.zonesVisited, ZONES),
  }
}

function loadStore(): AchievementStore {
  const fallback: AchievementStore = {
    version: 1,
    stats: createDefaultStats(),
    unlocked: {},
    lastStartedRunId: null,
  }
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY)
    if (!raw) return fallback
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) {
      console.warn('Korovany: achievement data has an invalid shape and was reset.')
      return fallback
    }
    const unlockedSource = isRecord(value.unlocked) ? value.unlocked : {}
    const unlocked = Object.fromEntries(
      Object.entries(unlockedSource).filter(
        ([id, unlockedAt]) =>
          definitions.some((definition) => definition.id === id) && typeof unlockedAt === 'string',
      ),
    ) as Record<string, string>
    return {
      version: 1,
      stats: parseStats(value.stats),
      unlocked,
      lastStartedRunId:
        typeof value.lastStartedRunId === 'string' ? value.lastStartedRunId : null,
    }
  } catch (error) {
    console.warn('Korovany: achievement data could not be read and was reset.', error)
    return fallback
  }
}

function saveStore(store: AchievementStore): void {
  try {
    localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(store))
  } catch (error) {
    console.warn('Korovany: achievement progress could not be saved.', error)
  }
}

export function summarizeAchievements(achievements: AchievementView[]): AchievementSummary {
  const byRarity = Object.fromEntries(
    ACHIEVEMENT_RARITY_ORDER.map((rarity) => [rarity, { unlocked: 0, total: 0 }]),
  ) as AchievementSummary['byRarity']
  for (const achievement of achievements) {
    byRarity[achievement.rarity].total += 1
    if (achievement.unlocked) byRarity[achievement.rarity].unlocked += 1
  }
  const unlocked = achievements.filter((achievement) => achievement.unlocked).length
  return {
    unlocked,
    total: achievements.length,
    percent: achievements.length === 0 ? 0 : Math.round((unlocked / achievements.length) * 100),
    byRarity,
  }
}

export class AchievementTracker {
  private readonly store = loadStore()
  private readonly onUnlock?: (achievement: AchievementUnlock) => void
  private run: AchievementRunState | null = null

  constructor(onUnlock?: (achievement: AchievementUnlock) => void) {
    this.onUnlock = onUnlock
  }

  beginRun(
    faction: Faction,
    startingZone?: ZoneId,
    runId: string = crypto.randomUUID(),
  ): void {
    this.run = createRunState(faction, runId)
    if (this.store.lastStartedRunId !== runId) {
      this.store.stats.runsStarted += 1
      this.store.lastStartedRunId = runId
    }
    if (startingZone) this.addZone(startingZone)
    this.commit()
  }

  recordKill(role: ActorRole, faction: Faction): void {
    if (!this.run) return
    this.store.stats.kills += 1
    this.store.stats.killsByRole[role] += 1
    this.store.stats.killsByFaction[faction] += 1
    this.run.kills += 1
    this.run.killsSinceDamage += 1
    this.run.bestKillStreak = Math.max(this.run.bestKillStreak, this.run.killsSinceDamage)
    this.commit()
  }

  recordPlayerDamage(amount: number, blocked: boolean): void {
    if (!this.run || amount <= 0) return
    this.run.damageTaken += amount
    this.run.killsSinceDamage = 0
    if (blocked) {
      this.run.shieldBlocks += 1
      this.store.stats.shieldBlocks += 1
    }
    this.commit()
  }

  recordInjury(_part: BodyPart, lost: boolean): void {
    if (!this.run) return
    this.run.injuries += 1
    this.store.stats.injuries += 1
    if (lost) {
      this.run.limbsLost += 1
      this.store.stats.limbsLost += 1
    }
    this.commit()
  }

  recordGoldEarned(amount: number): void {
    if (!this.run || amount <= 0) return
    this.run.goldEarned += amount
    this.store.stats.goldEarned += amount
    this.commit()
  }

  recordPurchase(itemId: ShopItem['id']): void {
    if (!this.run) return
    this.run.purchases += 1
    this.store.stats.purchases += 1
    this.store.stats.purchasesByItem[itemId] += 1
    this.commit()
  }

  recordCaravanRobbed(rich: boolean): void {
    if (!this.run) return
    this.run.caravansRobbed += 1
    this.store.stats.caravansRobbed += 1
    if (rich) this.store.stats.richCaravansRobbed += 1
    this.commit()
  }

  recordObjectiveCompleted(): void {
    if (!this.run) return
    this.run.objectivesCompleted += 1
    this.store.stats.objectivesCompleted += 1
    this.commit()
  }

  recordZone(zone: ZoneId): void {
    if (!this.run) return
    this.addZone(zone)
    this.commit()
  }

  recordWorldEvent(kind: WorldEventKind, succeeded: boolean): void {
    if (!this.run) return
    if (succeeded) {
      this.run.eventsCompleted += 1
      this.store.stats.eventsCompleted += 1
      this.store.stats.eventsByKind[kind] += 1
      if (!this.run.eventKindsCompleted.includes(kind)) this.run.eventKindsCompleted.push(kind)
    } else {
      this.store.stats.eventsFailed += 1
    }
    this.commit()
  }

  recordAbilityUse(_ability: AbilityId): void {
    if (!this.run) return
    this.run.abilitiesUsed += 1
    this.store.stats.abilityUses += 1
    this.commit()
  }

  recordSquadCommand(): void {
    if (!this.run) return
    this.run.squadCommands += 1
    this.store.stats.squadCommands += 1
    this.commit()
  }

  recordCampaignEnd(
    result: 'victory' | 'defeat',
    elapsed: number,
    health: number,
  ): void {
    if (!this.run || this.run.result !== null) return
    this.run.result = result
    this.run.elapsedAtEnd = Math.max(0, elapsed)
    this.run.healthAtEnd = Math.max(0, health)
    this.store.stats.completedRunSeconds += Math.max(0, elapsed)
    if (result === 'victory') {
      this.store.stats.victories += 1
      this.store.stats.factionVictories[this.run.faction] += 1
    } else {
      this.store.stats.defeats += 1
    }
    this.commit()
  }

  getRunState(): AchievementRunState | null {
    return this.run ? cloneAchievementRunState(this.run) : null
  }

  restoreRun(state: AchievementRunState): boolean {
    const restored = normalizeAchievementRunState(state)
    if (!restored || restored.result !== null) return false
    if (
      this.run &&
      (this.run.result !== null ||
        this.run.runId !== restored.runId ||
        this.run.faction !== restored.faction)
    ) {
      return false
    }
    this.run = restored
    return true
  }

  getCatalogue(): AchievementView[] {
    const context = { stats: this.store.stats, run: this.run }
    return definitions.map(({ getProgress, ...definition }) => ({
      ...definition,
      progress: Math.min(definition.target, Math.max(0, getProgress(context))),
      unlocked: Boolean(this.store.unlocked[definition.id]),
      unlockedAt: this.store.unlocked[definition.id] ?? null,
    }))
  }

  getSummary(): AchievementSummary {
    return summarizeAchievements(this.getCatalogue())
  }

  getCurrentRunUnlocks(): AchievementView[] {
    const unlockedIds = new Set(this.run?.unlockedIds ?? [])
    return this.getCatalogue().filter((achievement) => unlockedIds.has(achievement.id))
  }

  getCurrentRunUnlockCount(): number {
    return this.run?.unlockedIds.length ?? 0
  }

  private addZone(zone: ZoneId): void {
    if (!this.run) return
    if (!this.run.zonesVisited.includes(zone)) this.run.zonesVisited.push(zone)
    if (!this.store.stats.zonesVisited.includes(zone)) this.store.stats.zonesVisited.push(zone)
  }

  private commit(): void {
    const newlyUnlocked = this.evaluate()
    saveStore(this.store)
    for (const achievement of newlyUnlocked) this.onUnlock?.(achievement)
  }

  private evaluate(): AchievementUnlock[] {
    const context = { stats: this.store.stats, run: this.run }
    const newlyUnlocked: AchievementUnlock[] = []
    for (const definition of definitions) {
      if (this.store.unlocked[definition.id]) continue
      if (definition.getProgress(context) < definition.target) continue
      const unlockedAt = new Date().toISOString()
      this.store.unlocked[definition.id] = unlockedAt
      if (this.run && !this.run.unlockedIds.includes(definition.id)) {
        this.run.unlockedIds.push(definition.id)
      }
      newlyUnlocked.push({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        rarity: definition.rarity,
        category: definition.category,
        unlockedAt,
      })
    }
    return newlyUnlocked
  }
}

export function readAchievementCatalogue(): AchievementView[] {
  return new AchievementTracker().getCatalogue()
}
