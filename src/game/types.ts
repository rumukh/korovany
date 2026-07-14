export type Faction = 'elf' | 'guard' | 'villain'

export type ZoneId = 'neutral' | 'palace' | 'forest' | 'fort'

export type PartStatus = 'healthy' | 'wounded' | 'missing' | 'prosthetic'

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
  kind: 'player' | 'ally' | 'enemy' | 'caravan' | 'landmark'
}

export interface GameView {
  faction: Faction
  health: number
  maxHealth: number
  stamina: number
  gold: number
  kills: number
  damage: number
  zone: ZoneId
  body: BodyState
  objectives: Objective[]
  prompt: string
  markers: MapMarker[]
  squad: number
  elapsed: number
  pointerLocked: boolean
  paused: boolean
  caravanCooldown: number
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
}

export interface GameCallbacks {
  onView: (view: GameView) => void
  onNotice: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  onShop: () => void
  onPauseRequest: () => void
  onSaveRequest: () => void
  onEnd: (result: 'victory' | 'defeat') => void
}

export interface ShopItem {
  id: 'medicine' | 'arm' | 'leg' | 'eye' | 'blade'
  name: string
  description: string
  price: number
}

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
    name: 'Лесные эльфы',
    shortName: 'Эльф',
    subtitle: 'Тень густого леса',
    description: 'Защищайте деревянные дома, устраивайте засады и, разумеется, грабьте корованы.',
    perk: 'Быстрее в лесу, союзники отвечают на зов.',
    spawn: [-48, 43],
  },
  guard: {
    name: 'Охрана дворца',
    shortName: 'Гвардеец',
    subtitle: 'Приказ прежде всего',
    description: 'Получайте приказы командира, держите оборону дворца и ходите в карательные рейды.',
    perk: 'Тяжёлая броня и поддержка имперских солдат.',
    spawn: [43, -42],
  },
  villain: {
    name: 'Злодей',
    shortName: 'Злодей',
    subtitle: 'Сам себе командир',
    description: 'Соберите войско в старом форте и поведите его на дворец. Делайте что захотите.',
    perk: 'Сильный удар и личный отряд приспешников.',
    spawn: [47, 45],
  },
}

export const ZONE_INFO: Record<ZoneId, { name: string; subtitle: string }> = {
  neutral: { name: 'Вольные земли', subtitle: 'нейтральная зона людей' },
  palace: { name: 'Имперский удел', subtitle: 'дворец и казармы' },
  forest: { name: 'Чаща Эленвуда', subtitle: 'земли лесных эльфов' },
  fort: { name: 'Чёрный кряж', subtitle: 'горы и старый форт' },
}

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'medicine',
    name: 'Полевой набор',
    description: 'Восстанавливает здоровье, лечит раны и останавливает кровотечение.',
    price: 35,
  },
  {
    id: 'arm',
    name: 'Заводная рука',
    description: 'Заменяет первую потерянную руку и возвращает силу удара.',
    price: 110,
  },
  {
    id: 'leg',
    name: 'Стальная нога',
    description: 'Заменяет первую потерянную ногу и позволяет снова бегать.',
    price: 125,
  },
  {
    id: 'eye',
    name: 'Хрустальный глаз',
    description: 'Заменяет потерянный глаз и возвращает полный обзор.',
    price: 90,
  },
  {
    id: 'blade',
    name: 'Кованый клинок',
    description: 'Навсегда увеличивает урон на 8.',
    price: 140,
  },
]

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
      { id: 'raid', text: 'Ограбить имперский корован', done: false },
      { id: 'guards', text: 'Победить дворцовую охрану', done: false, progress: 0, target: 4 },
      { id: 'home', text: 'Вернуться с добычей в чащу', done: false },
    ]
  }

  if (faction === 'guard') {
    return [
      { id: 'orders', text: 'Получить приказ командира', done: false },
      { id: 'defend', text: 'Разбить налётчиков', done: false, progress: 0, target: 4 },
      { id: 'patrol', text: 'Дойти до старого форта', done: false },
    ]
  }

  return [
    { id: 'rally', text: 'Собрать приспешников командой', done: false },
    { id: 'breach', text: 'Войти в имперский удел', done: false },
    { id: 'commander', text: 'Победить командира дворца', done: false },
  ]
}
