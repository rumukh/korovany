import { SITE_PRESENTATIONS } from './registry.ts'
import type { Faction, NoticeTone } from '../types.ts'
import type { ChronicleEventKind } from '../world/Chronicle.ts'
import type { ObjectiveKind, SiteKind } from '../world/worldTypes.ts'

export type RussianCountForms = readonly [one: string, few: string, many: string]

export function formatRussianCount(value: number, forms: RussianCountForms): string {
  const count = Math.max(0, Math.trunc(value))
  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  const form =
    lastTwoDigits >= 11 && lastTwoDigits <= 14
      ? forms[2]
      : lastDigit === 1
        ? forms[0]
        : lastDigit >= 2 && lastDigit <= 4
          ? forms[1]
          : forms[2]
  return `${count} ${form}`
}

export function generatedSiteLabel(kind: SiteKind): string {
  return SITE_PRESENTATIONS[kind].label
}

export function createGeneratedObjectiveText(
  kind: ObjectiveKind,
  siteKind?: SiteKind,
): string {
  if (!siteKind) {
    switch (kind) {
      case 'arrive':
        return 'Добраться до цели'
      case 'interact':
        return 'Осмотреть цель'
      case 'claim':
        return 'Забрать награду'
      case 'defeat':
        return 'Победить врагов у цели'
    }
  }

  const label = generatedSiteLabel(siteKind)
  switch (kind) {
    case 'arrive':
      return `Добраться до точки «${label}»`
    case 'interact':
      return `Осмотреть точку «${label}»`
    case 'claim':
      return `Забрать награду в точке «${label}»`
    case 'defeat':
      return `Победить врагов у точки «${label}»`
  }
}

const REGION_COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Turns a 0-based region coordinate into a map square label such as `C3`. */
export function formatRegionGridLabel(gridX: number, gridZ: number): string {
  const column = Math.max(0, Math.trunc(gridX))
  const row = Math.max(0, Math.trunc(gridZ)) + 1
  const letter =
    column < REGION_COLUMN_LETTERS.length
      ? REGION_COLUMN_LETTERS[column]
      : `X${column}`
  return `${letter}${row}`
}

const CHRONICLE_FACTION_NAMES: Record<Faction, string> = {
  elf: 'лесные эльфы',
  guard: 'охрана дворца',
  villain: 'злодей',
}

export interface ChronicleCopyContext {
  kind: ChronicleEventKind
  /** Map square label, e.g. `C3`. */
  regionLabel: string
  faction: Faction | null
  siteLabel: string | null
}

const CHRONICLE_PHRASES: Record<
  ChronicleEventKind,
  readonly ((context: ChronicleCopyContext) => string)[]
> = {
  regionCaptured: [
    ({ regionLabel, faction }) =>
      `Квадрат ${regionLabel} отжали: теперь там ${factionName(faction)}. Местным объяснили, что надо слушаться нового командира.`,
    ({ regionLabel, faction }) =>
      `В квадрате ${regionLabel} сменился хозяин — зашли ${factionName(faction)}. Флаг перевесили, вопросов не задавали.`,
    ({ regionLabel, faction }) =>
      `Квадрат ${regionLabel} перешёл под ${factionGenitive(faction)}. Пользователя, как обычно, спросить забыли.`,
  ],
  beastRaid: [
    ({ regionLabel }) =>
      `В квадрате ${regionLabel} зверьё осмелело. Местные предпочитают не выходить.`,
    ({ regionLabel, siteLabel }) =>
      `Из леса в квадрате ${regionLabel} полезло зверьё и подъело точку «${siteLabel ?? 'Домики'}». Ночь была шумная.`,
    ({ regionLabel }) =>
      `Квадрат ${regionLabel}: кто-то большой ходит вокруг и точит когти о заборы.`,
  ],
  settlementBurned: [
    ({ regionLabel, siteLabel }) =>
      `Точка «${siteLabel ?? 'Домики деревяные'}» в квадрате ${regionLabel} разорена. Домики деревяные больше не деревяные.`,
    ({ regionLabel, siteLabel }) =>
      `В квадрате ${regionLabel} догорела точка «${siteLabel ?? 'Домики деревяные'}». Торговать и лечить там больше некому.`,
    ({ regionLabel }) =>
      `Квадрат ${regionLabel} выжжен дотла. Осталось пепелище и очень тихие соседи.`,
  ],
  caravanLost: [
    ({ regionLabel, siteLabel }) =>
      `Корован до точки «${siteLabel ?? 'неизвестно куда'}» не доехал: в квадрате ${regionLabel} его ограбили раньше пользователя.`,
    ({ regionLabel }) =>
      `В квадрате ${regionLabel} разграбили корован. Обидно: пользователь как раз собирался.`,
    ({ regionLabel, faction }) =>
      `Корован (${factionName(faction)}) лёг в квадрате ${regionLabel}. Товар разошёлся по чужим рукам.`,
  ],
  caravanArrived: [
    ({ regionLabel, siteLabel }) =>
      `Корован дошёл до точки «${siteLabel ?? 'склада'}» целым. В квадрате ${regionLabel} кто-то плохо старался.`,
    ({ siteLabel }) =>
      `В точку «${siteLabel ?? 'склад'}» завезли товар. Цены подобрели, но ненадолго.`,
    ({ regionLabel }) =>
      `Через квадрат ${regionLabel} прошёл корован и никто его не ограбил. Позор.`,
  ],
}

const CHRONICLE_TONES: Record<ChronicleEventKind, NoticeTone> = {
  regionCaptured: 'warning',
  beastRaid: 'warning',
  settlementBurned: 'danger',
  caravanLost: 'danger',
  caravanArrived: 'info',
}

/**
 * Renders a chronicle log entry. `variantKey` picks a phrasing deterministically so the
 * same seeded history always reads the same way.
 */
export function describeChronicleEvent(
  context: ChronicleCopyContext,
  variantKey: string,
): string {
  const phrases = CHRONICLE_PHRASES[context.kind]
  return phrases[stableIndex(variantKey, phrases.length)](context)
}

export function chronicleEventTone(kind: ChronicleEventKind): NoticeTone {
  return CHRONICLE_TONES[kind]
}

function factionName(faction: Faction | null): string {
  return faction ? CHRONICLE_FACTION_NAMES[faction] : 'непонятно кто'
}

function factionGenitive(faction: Faction | null): string {
  if (faction === 'elf') return 'руку лесных эльфов'
  if (faction === 'guard') return 'руку охраны дворца'
  if (faction === 'villain') return 'руку злодея'
  return 'ничью руку'
}

function stableIndex(value: string, length: number): number {
  if (length <= 1) return 0
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % length
}

