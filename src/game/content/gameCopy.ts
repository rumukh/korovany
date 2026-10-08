import { SITE_PRESENTATIONS } from './registry.ts'
import { getDoctrineDefinition } from '../run/doctrine.ts'
import {
  RUN_COMPLETION_REWARD,
  type RunCompletionRewardBreakdown,
  type RunCompletionRewardInput,
} from '../run/profile.ts'
import { computeRunRulesetFingerprint } from '../run/ruleset.ts'
import type {
  ActorRole,
  BodyPart,
  ChoicePayoutView,
  ChoiceTravelView,
  ChronicleWorldEventKind,
  Faction,
  LootRarity,
  LootToastView,
  NoticeTone,
  RandomWorldEventKind,
  RumourKind,
  RumourOutcome,
  ZoneId,
} from '../types.ts'
import type {
  ArchivedRunStatus,
  RunEpilogue,
  RunEpilogueBeat,
  RunEpilogueControl,
  RunEpilogueWound,
  RunHistorySummary,
} from '../run/runTypes.ts'
import type { CaravanLooterKind, CaravanRobber } from '../world/CaravanClaim.ts'
import type {
  CaravanBeatOutcome,
  CaravanBeatPlacement,
  CaravanBeatRole,
} from '../world/CaravanBeats.ts'
import type { ChronicleEventKind } from '../world/Chronicle.ts'
import type { ContractId, ObjectiveKind, SiteKind } from '../world/worldTypes.ts'
import type { SquadCommandMode, SquadMemberStatus } from '../world/SquadCommand.ts'
import type { HudMode } from '../visualSettings.ts'

export const HUD_MODE_LABELS: Readonly<Record<HudMode, string>> = {
  full: 'Полный',
  compact: 'Компактный',
}

export const COMPACT_HUD_COPY = {
  setting: 'Боевой интерфейс',
  settingHelp: 'Меняется сразу. В компактном виде раскрой «Поход» и «Вести», чтобы увидеть все подряды и слухи.',
  mission: 'Поход',
  news: 'Вести',
  expand: 'Раскрыть / свернуть',
  choices: 'Подряды на выбор',
  doctrine: 'Можно выбрать устав',
  chronicle: 'Записей в хронике',
  settled: 'Пункты похода закрыты',
  seconds: 'с',
} as const

export const VISUAL_SETTINGS_COPY = {
  title: 'Интерфейс',
  storageFailed: 'Не удалось сохранить настройки. Выбор останется только в этой вкладке.',
} as const

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
  raidRepelled: [
    ({ regionLabel, faction }) =>
      `Набег на квадрат ${regionLabel} отбили. ${capitalize(factionName(faction))} ушли считать потери.`,
    ({ regionLabel }) =>
      `В квадрате ${regionLabel} налётчиков сложили прямо у забора. Домики деревяные устояли.`,
    ({ regionLabel }) =>
      `Квадрат ${regionLabel} не отдали. Значит, кто-то там всё-таки слушался командира.`,
  ],
  beastRaid: [
    ({ regionLabel }) =>
      `В квадрате ${regionLabel} зверьё осмелело. Местные предпочитают не выходить.`,
    ({ regionLabel, siteLabel }) =>
      `Из леса в квадрате ${regionLabel} полезло зверьё и подъело точку «${siteLabel ?? 'Домики'}». Ночь была шумная.`,
    ({ regionLabel }) =>
      `Квадрат ${regionLabel}: кто-то большой ходит вокруг и точит когти о заборы.`,
  ],
  beastsRepelled: [
    ({ regionLabel }) =>
      `Зверьё из квадрата ${regionLabel} погнали обратно в лес. Домики деревяные пока деревяные.`,
    ({ regionLabel }) =>
      `В квадрате ${regionLabel} мохнатым объяснили, что домики — не еда, а корованы — не буфет.`,
    ({ siteLabel }) =>
      `Точку «${siteLabel ?? 'Домики деревяные'}» отстояли: стая ушла в лес считать, кого недосчиталась.`,
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
  raidRepelled: 'success',
  beastRaid: 'warning',
  beastsRepelled: 'success',
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

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
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

/** Failure lines for the five player-anchored events the director rolls for. */
export const WORLD_EVENT_FAILURE_MESSAGES: Record<RandomWorldEventKind, string> = {
  richCaravan: 'Богатый корован ушёл вместе с добычей.',
  defendHome: 'Дом не отстояли — огонь сожрал всё.',
  champion: 'Чемпион ушёл непобеждённым.',
  rescue: 'Пленника не удалось спасти.',
  bounty: 'Время вышло. Цель больше не в розыске.',
}

/** Layer 2 — copy for events the chronicle places at a site instead of at the player. */
export interface LocatedEventCopyContext {
  /** Map square label, e.g. `C3`. */
  regionLabel: string
  siteLabel: string | null
  /** Attacker, caravan owner, or warband owner. */
  faction: Faction | null
  /** Whoever holds the ground. */
  defender: Faction | null
}

export interface LocatedEventCopy {
  title: string
  description: string
}

const DEFAULT_SITE_LABEL = 'Домики деревяные'

const LOCATED_EVENT_COPY: Record<
  ChronicleWorldEventKind,
  (context: LocatedEventCopyContext) => LocatedEventCopy
> = {
  factionRaid: ({ faction, siteLabel }) => ({
    title: 'Набег на домики',
    description: `${capitalize(factionName(faction))} пришли за точкой «${siteLabel ?? DEFAULT_SITE_LABEL}». Положи налётчиков, пока домики ещё деревяные.`,
  }),
  caravanAmbush: ({ siteLabel }) => ({
    title: 'Корован под ножом',
    description: `Корован до точки «${siteLabel ?? 'склад'}» не доедет. Забери груз сам, пока это делают за тебя.`,
  }),
  warband: ({ faction, regionLabel }) => ({
    title: 'Чужая ватага',
    description: `По квадрату ${regionLabel} ходит ватага (${factionName(faction)}) и смотрит нехорошо. Проредить.`,
  }),
  aftermath: ({ siteLabel }) => ({
    title: 'Что осталось',
    description: `На пепелище точки «${siteLabel ?? DEFAULT_SITE_LABEL}» кто-то шарит по углям. Объясни, что это чужие угли.`,
  }),
  beastRaid: ({ siteLabel }) => ({
    title: 'Зверьё у домиков',
    description: `Из леса пришли за точкой «${siteLabel ?? DEFAULT_SITE_LABEL}». Положи стаю, пока домики деревяные ещё деревяные.`,
  }),
}

const LOCATED_EVENT_START: Record<
  ChronicleWorldEventKind,
  (context: LocatedEventCopyContext) => string
> = {
  factionRaid: ({ regionLabel, faction }) =>
    `В квадрате ${regionLabel} набигают: ${factionName(faction)} пришли за домиками.`,
  caravanAmbush: ({ regionLabel }) =>
    `В квадрате ${regionLabel} режут корован. Успей — там ещё осталось.`,
  warband: ({ regionLabel, faction }) =>
    `По квадрату ${regionLabel} ходит ватага (${factionName(faction)}). Дорогу лучше не уступать.`,
  aftermath: ({ regionLabel }) =>
    `Квадрат ${regionLabel} догорел без пользователя. На пепелище уже кто-то шарит.`,
  beastRaid: ({ regionLabel }) =>
    `Из леса в квадрате ${regionLabel} полезло зверьё. Домики деревяные пока стоят.`,
}

const LOCATED_EVENT_OUTCOME: Record<
  ChronicleWorldEventKind,
  (succeeded: boolean, context: LocatedEventCopyContext) => string
> = {
  factionRaid: (succeeded, { regionLabel, faction }) =>
    succeeded
      ? 'Набег отбит. Домики деревяные пока деревяные, местные снова слушаются командира.'
      : `Домики догорели. В квадрате ${regionLabel} теперь ${factionName(faction)} и новые правила.`,
  caravanAmbush: (succeeded, { regionLabel }) =>
    succeeded
      ? 'Корован ограблен по всем правилам. Конкуренты остались с пустой телегой.'
      : `Корован увели прямо из-под носа. В квадрате ${regionLabel} кто-то оказался шустрее.`,
  warband: (succeeded, { regionLabel }) =>
    succeeded
      ? `Ватагу проредили. В квадрате ${regionLabel} стало заметно тише.`
      : 'Ватага ушла своей дорогой. Ну и пусть идёт, пока идётся.',
  aftermath: (succeeded, { siteLabel }) =>
    succeeded
      ? 'Мародёров с пепелища прогнали. Углям это, конечно, уже не поможет.'
      : `С точки «${siteLabel ?? DEFAULT_SITE_LABEL}» вынесли даже угли. Пользователь опоздал, как обычно.`,
  beastRaid: (succeeded, { regionLabel, siteLabel }) =>
    succeeded
      ? 'Стаю положили прямо у забора. Шкуры остались, домики тоже.'
      : `Зверьё доело точку «${siteLabel ?? DEFAULT_SITE_LABEL}» и ушло обратно в лес квадрата ${regionLabel}. Отсыпаться.`,
}

/**
 * Layer 3 — one wandering beast, not a raid. Shown once per square so the forest reads
 * as inhabited without turning the notice feed into a nature documentary.
 */
export function describeBeastProwler(regionLabel: string): string {
  return `В квадрате ${regionLabel} что-то ходит по кустам и не платит за проход.`
}

/**
 * Layer 4 §5C.6 — the cart was taken by somebody who is not the player. Beasts and
 * raiders get different lines because "кто-то съел груз" and "кто-то увёл груз" are
 * genuinely different disappointments.
 */
export function describeCaravanPlundered(byBeast: boolean): string {
  return byBeast
    ? 'Корован обглодали без пользователя. Охрана лежит, груз в кустах, телега пустая.'
    : 'Корован увели без пользователя. Охрану положили, груз растащили — приходи в следующий раз пораньше.'
}

/**
 * Layer 4 §5C.2, extended by Layer 5 — somebody on the field decided this was not their
 * fight after all. Shown for the squares the player can actually see, so a rout reads as
 * a thing that happened rather than a thing the numbers did.
 *
 * Takes the reason rather than a boolean because Layer 5 added a third one and a
 * two-valued flag would have had to lie about it.
 */
export function describeRout(reason: 'cohesion' | 'individual' | 'panic'): string {
  if (reason === 'cohesion') return 'Стая посыпалась и ломанулась в лес. Договориться не вышло.'
  if (reason === 'panic') {
    return 'Местные разбежались по кустам. Домики деревяные постоят и без них.'
  }
  return 'У кого-то сдали нервы: бежит и не оборачивается.'
}

/**
 * Layer 4 §5C.2 — the commander talked somebody back into the line.
 */
export const RALLY_NOTICE = 'Командир наорал — беглец вернулся в строй. Дисциплина, чтоб её.'

/**
 * Layer 5 — the village is inhabited. Shown once per square, like the prowler line, so
 * the feed reads as a world and not as a headcount.
 */
export function describeVillageLife(regionLabel: string, count: number): string {
  if (count <= 1) {
    return `В квадрате ${regionLabel} у домиков кто-то один шевелится. Остальные, видимо, уже нашевелились.`
  }
  return `В квадрате ${regionLabel} местные ходят от домика к домику и делают вид, что заняты.`
}

/**
 * Layer 5 — a civilian went down. `byPlayer` is the interesting one: the game's whole
 * register lives in the gap between "wolves ate a villager" and "you did that on
 * purpose". No gold, no achievement — the line is the entire reward.
 */
export function describeCivilianDeath(byPlayer: boolean): string {
  return byPlayer
    ? 'Мирный житель прилёг. Он вам ничего не сделал, но домики деревяные уже никто не достроит. +0 золота.'
    : 'Местного не стало. Он хотел дойти до домика, а дошёл только до середины.'
}

export function describeLocatedEvent(
  kind: ChronicleWorldEventKind,
  context: LocatedEventCopyContext,
): LocatedEventCopy {
  return LOCATED_EVENT_COPY[kind](context)
}

export function describeLocatedEventStart(
  kind: ChronicleWorldEventKind,
  context: LocatedEventCopyContext,
): string {
  return LOCATED_EVENT_START[kind](context)
}

export function describeLocatedEventOutcome(
  kind: ChronicleWorldEventKind,
  succeeded: boolean,
  context: LocatedEventCopyContext,
): string {
  return LOCATED_EVENT_OUTCOME[kind](succeeded, context)
}

/**
 * Shown when the player walks out of a materialized event's region: the fight is not
 * cancelled, it is handed back to the chronicle, which will write down who won.
 */
export function describeEventHandback(regionLabel: string): string {
  return `Пользователь ушёл из квадрата ${regionLabel}. Чем там кончилось — прочитаешь в хронике.`
}

// ---------------------------------------------------------------------------
// Roadmap 1.3 — rumours the player can take on
// ---------------------------------------------------------------------------

/**
 * The only place in the game where the world asks the player a question instead of
 * reporting an answer.
 *
 * Three rules for these lines. **The stake is stated before the choice**, in the same
 * sentence as the cost, because a time-boxed decision with a vague consequence is a
 * lottery. **The verdict names the decision**, since the whole complaint 1.3 answers is
 * that the chronicle feed never attributes an outcome to anything the player did. And a
 * broken promise reads differently from a shrug: `committed` is in the copy, not only in
 * the state, because "ты обещал" and "никто не обещал" are different sentences about the
 * same burned village.
 */
export interface RumourCopyContext {
  /** Where the player has to be, as a map square. */
  regionLabel: string
  /** The square that pays for it. */
  targetLabel: string
  siteLabel: string | null
  faction: Faction | null
}

export const RUMOUR_PANEL_TITLE = 'Слухи'
export const RUMOUR_PANEL_HINT = 'Взяться можно за один. Остальное мир решит без тебя.'
export const RUMOUR_PIN_LABEL = 'Взяться'
export const RUMOUR_UNPIN_LABEL = 'Бросить'

const RUMOUR_TITLES: Record<RumourKind, string> = {
  escort: 'Корован без охраны',
  defend: 'На домики собираются',
  sabotage: 'Чужой склад',
}

export function describeRumourTitle(kind: RumourKind): string {
  return RUMOUR_TITLES[kind]
}

/** What the player would have to physically do. */
export function describeRumourTask(
  kind: RumourKind,
  context: RumourCopyContext,
): string {
  const site = context.siteLabel ?? DEFAULT_SITE_LABEL
  if (kind === 'escort') {
    return `Идти рядом с корованом до точки «${site}». Сейчас он в квадрате ${context.regionLabel}.`
  }
  if (kind === 'defend') {
    return `Постоять в квадрате ${context.regionLabel}, пока не отстанут. Ногами, не по карте.`
  }
  return `Дойти до склада «${site}» в квадрате ${context.regionLabel} и поджечь его (E).`
}

/** What it costs to walk past. Stated before the choice, not after it. */
export function describeRumourStake(
  kind: RumourKind,
  context: RumourCopyContext,
): string {
  const site = context.siteLabel ?? DEFAULT_SITE_LABEL
  if (kind === 'escort') {
    return `Не пойдёшь — корован ляжет по дороге, а в квадрате ${context.targetLabel} всё подорожает.`
  }
  if (kind === 'defend') {
    return `Не придёшь — квадрат ${context.targetLabel} отойдёт под ${factionGenitive(context.faction)}, а точку «${site}» подпалят.`
  }
  return `Не тронешь — со склада снабдят набег на квадрат ${context.targetLabel}, и он сменит хозяина.`
}

/**
 * The outcome, attributed to the decision.
 *
 * `committed` splits every broken line in two on purpose: the world does the same thing
 * either way, and the difference the player is owed is whether it was their doing.
 */
export function describeRumourVerdict(
  kind: RumourKind,
  outcome: RumourOutcome,
  committed: boolean,
  context: RumourCopyContext,
): string {
  const site = context.siteLabel ?? DEFAULT_SITE_LABEL
  if (kind === 'escort') {
    if (outcome === 'kept') {
      return `Корован дошёл до точки «${site}» целым. Дошёл потому, что рядом кто-то шёл.`
    }
    return committed
      ? `Ты взялся вести корован и не довёл. В квадрате ${context.targetLabel} теперь дороже, и виноват известно кто.`
      : `Корован никто не повёл, и он не дошёл. Слух был, охраны не было.`
  }
  if (kind === 'defend') {
    if (outcome === 'kept') {
      return `Набег на квадрат ${context.regionLabel} отбили. Пользователь стоял там, а не читал сводку.`
    }
    return committed
      ? `Ты взялся держать квадрат ${context.regionLabel} и ушёл. Квадрат отошёл под ${factionGenitive(context.faction)}.`
      : `Квадрат ${context.regionLabel} держать было некому — он отошёл под ${factionGenitive(context.faction)}.`
  }
  if (outcome === 'kept') {
    return `Склад «${site}» в квадрате ${context.regionLabel} сгорел. Набег на ${context.targetLabel} так и не собрался, а цены у соседей заметили.`
  }
  return committed
    ? `Ты собирался поджечь склад в квадрате ${context.regionLabel} и не дошёл. Оттуда снабдили набег на ${context.targetLabel}.`
    : `Склад в квадрате ${context.regionLabel} отработал как задумано: набег на ${context.targetLabel} состоялся.`
}

export function describeRumourPinned(kind: RumourKind): string {
  return `Взялся: «${RUMOUR_TITLES[kind]}». Теперь это дело пользователя, а не строчка в хронике.`
}

export function describeRumourDropped(kind: RumourKind): string {
  return `Бросил: «${RUMOUR_TITLES[kind]}». Мир доведёт до конца сам, и не в твою пользу.`
}

/**
 * W2-3 — the verdict on a rumour card: whether the walk fits the clock with room to spare,
 * only just, or not at all. «Впритык» is the honest middle: it fits with no margin for a
 * fight on the way.
 */
export const RUMOUR_REACH_WORDS: Readonly<Record<'yes' | 'tight' | 'no', string>> = {
  yes: 'успеешь',
  tight: 'впритык',
  no: 'не успеть',
}

/**
 * W2-3 — «идти ~30 с · осталось 48 с · успеешь»: the walk the compass charts against the clock.
 * A taken escort met somewhere other than its cart's square now says where first:
 * «встретить в D2 · идти ~6 с · …».
 */
export function describeRumourReach(
  walkSeconds: number | null,
  remainingSeconds: number,
  reach: 'yes' | 'tight' | 'no' | null,
  meetLabel: string | null = null,
): string {
  const parts: string[] = []
  if (meetLabel) parts.push(`встретить в ${meetLabel}`)
  if (walkSeconds !== null) {
    parts.push(walkSeconds <= 0 ? 'ты на месте' : `идти ~${String(walkSeconds)} с`)
  }
  parts.push(`осталось ${String(Math.ceil(remainingSeconds))} с`)
  if (reach) parts.push(RUMOUR_REACH_WORDS[reach])
  return parts.join(' · ')
}

/** W2-3 — what keeping a rumour paid, in the faction's own voice. */
export function describeRumourReward(faction: Faction, reward: ChoicePayoutView): string {
  const amount = reward.gold > 0
    ? `+${String(reward.gold)} золота`
    : `+${formatRussianCount(reward.supplies, RATION_FORMS)}`
  if (faction === 'guard') return `Командир доволен: ${amount}.`
  if (faction === 'villain') return `Сам себе командир — сам себе и премия: ${amount}.`
  return `Домики деревяные делятся пайком: ${amount}.`
}

/** W2-3 — the kept verdict's notice, with what keeping it paid. */
export function describeRumourVerdictPaid(
  verdictLine: string,
  faction: Faction,
  reward: ChoicePayoutView,
): string {
  return `${verdictLine} ${describeRumourReward(faction, reward)}`
}

/** The prompt at the depot, once the player has actually committed to burning it. */
export function describeSabotagePrompt(siteLabel: string | null): string {
  return `[E] Поджечь склад: ${siteLabel ?? DEFAULT_SITE_LABEL}`
}

export const SABOTAGE_DONE_NOTICE =
  'Склад горит. Припасы, которыми собирались снабжать набег, теперь дым.'

// ---------------------------------------------------------------------------
// Roadmap 1.4 / 2.1 — faction contracts
// ---------------------------------------------------------------------------

/**
 * The words for the fork.
 *
 * Two rules, and the second one is where 2.1 rewrote 1.4. **The stake is stated before the
 * choice**, same as a rumour's. And **the copy now says plainly that the arms are
 * alternatives** — 1.4's panel was obliged to say the opposite («выбираешь порядок, а не
 * дорогу») because both arms were required and a HUD implying otherwise would have been
 * selling 2.1 on 1.4's budget. Subset completion ships the road, so the panel says road.
 */
export interface ContractCopyContext {
  /** Where the work is, as a map square. */
  regionLabel: string
  siteLabel: string | null
}

/**
 * W1-1 — why a contract the player reached could not be put on the ground. Only genuine
 * reasons are listed: the game's own random events and a contract already on the ground
 * never spend the start grace, so neither can be why one is abandoned.
 */
export type ContractStartBlock = 'crowded' | 'noGround'

export const CONTRACT_PANEL_TITLE = 'Подряды'
export const CONTRACT_PANEL_HINT = 'Возьмёшь один — второй закроется сам. Это дорога, а не очередь.'
/** The line under a plain campaign node, so a required errand does not read as optional. */
export const CONTRACT_ERRAND_STAKE = 'Пункт обязательный: без него забег не закроется.'
/** The line under an arm of the fork, so an alternative does not read as required. */
export const CONTRACT_EXCLUSIVE_BADGE = 'Или — или'
export const CONTRACT_PIN_LABEL = 'Взяться'
export const CONTRACT_UNPIN_LABEL = 'Бросить'
export const CONTRACT_FAILED_TASK = 'Подряд сорван. Дойти до точки — пункт закроется пустым.'
/** How a node the run walked past reads in the objective list. */
export const OBJECTIVE_SKIPPED_LABEL = 'Мимо'
export const OBJECTIVE_OPTIONAL_LABEL = 'На выбор'

const CONTRACT_TITLES: Record<ContractId, string> = {
  plunder: 'Жирный корован',
  bulwark: 'Домики жгут',
  unshackle: 'Свои в верёвках',
  duel: 'Заезжий чемпион',
  reprisal: 'Долг по голове',
  relief: 'Налёт на своих',
  ambush: 'Чужой обоз уже берут',
  muster: 'Чужая ватага',
  cull: 'Зверьё у домиков',
  scavenge: 'Пепелище с гостями',
}

export function describeContractTitle(id: ContractId): string {
  return CONTRACT_TITLES[id]
}

/** What the player would have to physically go and do. */
export function describeContractTask(
  id: ContractId,
  context: ContractCopyContext,
): string {
  const site = context.siteLabel ?? DEFAULT_SITE_LABEL
  const where = `до точки «${site}» в квадрате ${context.regionLabel}`
  switch (id) {
    case 'plunder':
      return `Дойти ${where} и обнести обоз, пока охрана не опомнилась.`
    case 'bulwark':
      return `Дойти ${where} и отбить налёт, пока дом ещё стоит.`
    case 'unshackle':
      return `Дойти ${where} и снять верёвки со своего.`
    case 'duel':
      return `Дойти ${where} и уложить чемпиона. Он тут именно за этим.`
    case 'reprisal':
      return `Дойти ${where} и закрыть долг по голове, пока помеченный не ушёл.`
    case 'relief':
      return `Дойти ${where} и разогнать налётчиков, пока защитники ещё стоят.`
    case 'ambush':
      return `Дойти ${where} и забрать груз раньше тех, кто уже взялся.`
    case 'muster':
      return `Дойти ${where} и проредить чужую ватагу, пока она не окрепла.`
    case 'cull':
      return `Дойти ${where} и перебить стаю, пока домики целы.`
    case 'scavenge':
      return `Дойти ${where} и вынести из пепла всё, что мародёры ещё не унесли.`
  }
}

/** What failing costs. Stated before the choice, and never overstated. */
export function describeContractStake(
  id: ContractId,
  context: ContractCopyContext,
): string {
  const site = context.siteLabel ?? DEFAULT_SITE_LABEL
  const tail = `Награды не будет, а пункт всё равно закрывать: дойдёшь до «${site}» и пойдёшь дальше пустым.`
  switch (id) {
    case 'plunder':
      return `Провалишь — обоз уйдёт своим ходом. Платить будет некому. ${tail}`
    case 'bulwark':
      return `Провалишь — «${site}» догорит без тебя. ${tail}`
    case 'unshackle':
      return `Провалишь — своего уведут. ${tail}`
    case 'duel':
      return `Провалишь — чемпион поедет дальше и будет рассказывать. ${tail}`
    case 'reprisal':
      return `Провалишь — помеченный уйдёт, и долг останется висеть. ${tail}`
    case 'relief':
      return `Провалишь — защитников положат, а квадрат сменит хозяина. ${tail}`
    case 'ambush':
      return `Провалишь — груз увезут те, кто взялся раньше. ${tail}`
    case 'muster':
      return `Провалишь — ватага останется на ногах и осмелеет. ${tail}`
    case 'cull':
      return `Провалишь — стая доломает домики. ${tail}`
    case 'scavenge':
      return `Провалишь — мародёры вынесут пепелище до тебя. ${tail}`
  }
}

export function describeContractStarted(id: ContractId): string {
  switch (id) {
    case 'plunder':
      return 'Обоз на месте, охрана тоже. Подряд пошёл.'
    case 'bulwark':
      return 'Налётчики уже здесь. Подряд пошёл, дом горит.'
    case 'unshackle':
      return 'Свой в верёвках, рядом двое. Подряд пошёл.'
    case 'duel':
      return 'Чемпион вышел и ждёт. Подряд пошёл.'
    case 'reprisal':
      return 'Помеченный на месте и уже оглядывается. Подряд пошёл.'
    case 'relief':
      return 'Налётчики жмут защитников. Подряд пошёл.'
    case 'ambush':
      return 'Обоз стоит, вокруг чужие руки. Подряд пошёл.'
    case 'muster':
      return 'Ватага на месте и не рада. Подряд пошёл.'
    case 'cull':
      return 'Стая уже у домиков. Подряд пошёл.'
    case 'scavenge':
      return 'Пепелище дымит, по нему ходят чужие. Подряд пошёл.'
  }
}

export function describeContractKept(id: ContractId, reward: number): string {
  const paid = `Подряд закрыт, ${String(reward)} золотых сверху.`
  switch (id) {
    case 'plunder':
      return `Обоз обнесён по-хозяйски. ${paid}`
    case 'bulwark':
      return `Налёт отбит, дом стоит. ${paid}`
    case 'unshackle':
      return `Верёвки сняты, свой при оружии. ${paid}`
    case 'duel':
      return `Чемпион лёг, и рассказывать будет уже не он. ${paid}`
    case 'reprisal':
      return `Долг по голове закрыт. ${paid}`
    case 'relief':
      return `Налётчики разбежались, квадрат остался чей был. ${paid}`
    case 'ambush':
      return `Груз уехал с тобой, а не с ними. ${paid}`
    case 'muster':
      return `Ватага прорежена и больше не ватага. ${paid}`
    case 'cull':
      return `Стая легла, домики целы. ${paid}`
    case 'scavenge':
      return `Пепелище вынесено начисто. ${paid}`
  }
}

/**
 * The fail-forward line.
 *
 * It has to say two things in one breath: the contract is lost, and the run is not. That is
 * the difference between an event and a campaign objective, and it is the sentence the
 * player reads at the exact moment the difference matters.
 */
export function describeContractFailed(
  id: ContractId,
  context: ContractCopyContext,
): string {
  const site = context.siteLabel ?? DEFAULT_SITE_LABEL
  const tail = `Дорога не закрыта: дойди до точки «${site}» в квадрате ${context.regionLabel} — пункт закроется, но пустым.`
  switch (id) {
    case 'plunder':
      return `Обоз ушёл. ${tail}`
    case 'bulwark':
      return `Дом догорел. ${tail}`
    case 'unshackle':
      return `Своего увели. ${tail}`
    case 'duel':
      return `Чемпион уехал непобитым. ${tail}`
    case 'reprisal':
      return `Помеченный ушёл. ${tail}`
    case 'relief':
      return `Защитников не стало. ${tail}`
    case 'ambush':
      return `Груз увезли без тебя. ${tail}`
    case 'muster':
      return `Ватага устояла. ${tail}`
    case 'cull':
      return `Домики доломали. ${tail}`
    case 'scavenge':
      return `Пепелище вынесли до тебя. ${tail}`
  }
}

/**
 * The contract could not even be put on the ground, and its patience ran out.
 *
 * W1-1 — and it says why. Only a genuine reason can get here now, so the line names it
 * instead of shrugging at the hour and the place.
 */
export function describeContractAbandoned(
  id: ContractId,
  context: ContractCopyContext,
  reason: ContractStartBlock,
): string {
  const site = context.siteLabel ?? DEFAULT_SITE_LABEL
  const why =
    reason === 'crowded'
      ? 'вокруг и так слишком людно, места под подряд не осталось'
      : 'у точки не нашлось ровной земли под подряд'
  return `«${CONTRACT_TITLES[id]}» так и не собрался: ${why}. Точка «${site}» в квадрате ${context.regionLabel} всё равно твоя: дойди и закрывай пункт.`
}

/**
 * W1-1 — the player reached one arm while the other is still on the ground. Nothing is
 * lost and no patience is spent: one contract at a time, and the running one has a clock.
 */
export function describeContractQueued(id: ContractId, running: ContractId): string {
  return `«${CONTRACT_TITLES[id]}» ждёт своей очереди: пока идёт «${CONTRACT_TITLES[running]}», второй подряд не начать.`
}

/**
 * W1-1 — the player reached the contract in the middle of a random event of their own: a
 * fight they are trading blows in, a cart they have just robbed. The contract waits, its
 * patience untouched, rather than make that vanish.
 */
export function describeContractWaitsForEvent(id: ContractId, eventTitle: string): string {
  return `Сначала доделай начатое: пока идёт «${eventTitle}», «${CONTRACT_TITLES[id]}» подождёт.`
}

/**
 * W1-1 — a random event called off because the player reached the contract they chose.
 * The interruption is the game's own, so it costs nothing and pays nothing.
 */
export function describeRandomEventStoodDown(title: string): string {
  return `«${title}» — отбой: пользователь пришёл по подряду. Ни штрафа, ни награды.`
}

/** W2-2 — the same stand-down when the player reached a caravan instead of a contract. */
export function describeRandomEventStoodDownForCaravan(title: string): string {
  return `«${title}» — отбой: пользователь пришёл грабить корованы. Ни штрафа, ни награды.`
}

/** W1-1 — a located fight handed back to the chronicle to make room for the contract. */
export function describeEventHandbackForContract(regionLabel: string): string {
  return `Подряду нужны люди: бой в квадрате ${regionLabel} ушёл в хронику, чем кончился — прочитаешь там.`
}

// ---------------------------------------------------------------------------
// W2-3 — the price on a choice card
// ---------------------------------------------------------------------------

/**
 * The words for what a choice costs and pays, said before it is made.
 *
 * One rule: **a card quotes only what the game will actually do.** The payout comes from the
 * table the engine pays from, the walk from the itinerary the compass would chart, the
 * danger from squares the player has seen. A straight line is called a straight line, and a
 * square in fog is counted, never named.
 */
export const CHOICE_PRICE_COPY = {
  payout: 'Плата',
  timeLimit: 'Срок',
  walk: 'Идти',
  danger: 'Опасно',
  fog: 'в тумане',
  noDanger: 'Известной опасности нет',
  payoutLabel: 'Что заплатят',
  routeLabel: 'Срок, дорога и опасность',
} as const

const GOLD_FORMS: RussianCountForms = ['золотой', 'золотых', 'золотых']
const RATION_FORMS: RussianCountForms = ['паёк', 'пайка', 'пайков']
const SQUARE_FORMS: RussianCountForms = ['квадрат', 'квадрата', 'квадратов']

function joinRussianList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`
}

/** «Плата: 220 золотых, +6 к урону и легендарный трофей.» Null when it pays nothing named. */
export function describeChoicePayout(payout: ChoicePayoutView): string | null {
  const parts: string[] = []
  if (payout.gold > 0) {
    parts.push(payout.withoutPlayerGold === undefined
      ? formatRussianCount(payout.gold, GOLD_FORMS)
      : `${String(payout.gold)} · без тебя ${String(payout.withoutPlayerGold)}`)
  }
  if (payout.supplies > 0) parts.push(formatRussianCount(payout.supplies, RATION_FORMS))
  if (payout.heal > 0) parts.push(`+${String(payout.heal)} здоровья`)
  if (payout.damage > 0) parts.push(`+${String(payout.damage)} к урону`)
  if (payout.companion) parts.push('свой в отряд')
  if (payout.loot === 'legendary') parts.push('легендарный трофей')
  else if (payout.loot === 'uncommon') parts.push('трофей')
  if (parts.length === 0) return null
  return `${CHOICE_PRICE_COPY.payout}: ${joinRussianList(parts)}.`
}

export function describeChoiceGoldCondition(payout: ChoicePayoutView): string | null {
  return payout.gold > 0 && payout.withoutPlayerGold !== undefined
    ? `${CHOICE_PRICE_COPY.payout}: ${String(payout.gold)} · без тебя ${String(payout.withoutPlayerGold)}.`
    : null
}

/** A contract's own clock, which starts on arrival rather than now. */
export function describeContractTimeLimit(seconds: number): string {
  return `${CHOICE_PRICE_COPY.timeLimit}: ${String(Math.ceil(seconds))} с с начала`
}

/** «Идти ~45 с, 370 м дороги» — at walking pace, and honest about how it was measured. */
export function describeChoiceTravel(travel: ChoiceTravelView): string {
  const walk = `${CHOICE_PRICE_COPY.walk} ~${String(travel.seconds)} с`
  const meters = Math.ceil(travel.meters)
  switch (travel.basis) {
    case 'arrived':
      return 'Ты уже на месте'
    case 'road':
      return `${walk}, ${String(meters)} м дороги`
    case 'direct':
      return `${walk}, ${String(meters)} м: рядом`
    case 'straight':
      return `${walk}, ${String(meters)} м по прямой: дороги нет`
  }
}

/** «Опасно: B2, C3 · в тумане: 1 квадрат», or a plain «нет» about what is known. */
export function describeChoiceDanger(travel: ChoiceTravelView): string {
  const parts: string[] = []
  if (travel.danger.length > 0) parts.push(`${CHOICE_PRICE_COPY.danger}: ${travel.danger.join(', ')}`)
  if (travel.unscouted > 0) {
    parts.push(`${CHOICE_PRICE_COPY.fog}: ${formatRussianCount(travel.unscouted, SQUARE_FORMS)}`)
  }
  if (parts.length === 0) return CHOICE_PRICE_COPY.noDanger
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/** The short form for a destination row: «300 золотых · идти ~45 с». */
export function describeChoiceSummary(
  payout: ChoicePayoutView | null,
  travel: ChoiceTravelView | null,
): string | null {
  const parts: string[] = []
  if (payout && payout.gold > 0) parts.push(formatRussianCount(payout.gold, GOLD_FORMS))
  else if (payout && payout.supplies > 0) parts.push(formatRussianCount(payout.supplies, RATION_FORMS))
  if (travel) {
    parts.push(travel.basis === 'arrived' ? 'на месте' : `идти ~${String(travel.seconds)} с`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export function describeObjectivePinned(text: string): string {
  return `Взялся: «${text}».`
}

export function describeObjectiveDropped(text: string): string {
  return `Бросил: «${text}». Пункт никуда не делся, просто теперь не первый.`
}

/**
 * Roadmap 2.1 — the sentence the whole initiative exists to be able to say.
 *
 * It arrives at the exact moment the road forks shut, and it says the two things a player
 * has to be told once: the other arm is gone, and that is not a loss. A run that closed
 * every pin would not be a route.
 */
export function describeObjectiveSkipped(text: string): string {
  return `Мимо: «${text}». Ты пошёл другой дорогой — этот пункт закрылся сам, и закрывать его больше не надо.`
}

// ---------------------------------------------------------------------------
// Roadmap 1.6 — the doctrine draft
// ---------------------------------------------------------------------------

/**
 * The words for the draft.
 *
 * Two rules, and the second is the one this initiative is emphatic about. **The panel never
 * quotes a number**, because there is no number to quote: a doctrine changes a rule, and a
 * card that could be described as «+10 к урону» would be the thing 1.6 exists to replace.
 * And **the cost is stated on the same card as the gain**, because the whole mitigation for
 * power creep is that every card is a sidegrade — a panel that showed only the upside would
 * be selling a boon in a doctrine's coat.
 *
 * The names and the rule lines themselves live in `run/doctrine.ts` beside the effect each
 * one flips, so a card cannot promise one thing and do another.
 */
export const DOCTRINE_PANEL_TITLE = 'Устав похода'
export const DOCTRINE_DRAFT_HINT = 'Взять можно один. Устав меняет правило, а не число.'
export const DOCTRINE_TAKE_LABEL = 'Принять'
/** Above the equipped strip, when there is nothing left to draft. */
export const DOCTRINE_EQUIPPED_HINT = 'Устав принят и не меняется до конца забега.'
export const DOCTRINE_MENU_EYEBROW = 'Уставы'
export const DOCTRINE_MENU_TITLE = 'Правила, а не числа — по три на забег'
export const DOCTRINE_MENU_NOTE =
  'Открытые уставы попадают в раздачу: чем их больше, тем реальнее выбор на первом же закрытом пункте.'

export function describeDoctrineDraftOpened(index: number, total: number): string {
  return `Раздача уставов ${String(index)}/${String(total)}: выбери, по какому правилу идти дальше.`
}

export function describeDoctrineTaken(name: string, rule: string): string {
  return `Принят «${name}». ${rule}`
}

/** The strip's own line when three slots are full — the cap, said out loud. */
export function describeDoctrineSlots(taken: number, total: number): string {
  return `Уставов принято: ${String(taken)} из ${String(total)}.`
}

// ---------------------------------------------------------------------------
// Engine notices
// ---------------------------------------------------------------------------

/**
 * What the engine says through `onNotice`, moved out of `GameEngine.ts` unchanged.
 *
 * A copy move, not a rewrite: every line below is the string that was embedded at its call
 * site, and the numbers that used to be baked into a sentence are parameters so the
 * sentence cannot drift from the amount the engine actually awarded. Nothing is deduped
 * against `types.ts` — the zone names here are the engine's, which differ from
 * `ZONE_INFO`'s on purpose, and merging them would be a copy change wearing a refactor's
 * clothes.
 */

const BODY_PART_NAMES: Record<BodyPart, string> = {
  leftArm: 'левая рука',
  rightArm: 'правая рука',
  leftLeg: 'левая нога',
  rightLeg: 'правая нога',
  leftEye: 'левый глаз',
  rightEye: 'правый глаз',
}

export function formatBodyPart(part: BodyPart): string {
  return BODY_PART_NAMES[part]
}

/** The engine's own zone names, which are not `ZONE_INFO`'s. */
const ZONE_DISCOVERY_NAMES: Record<ZoneId, string> = {
  neutral: 'Вольные земли',
  palace: 'Имперский удел',
  forest: 'Чаща Эленвуда',
  fort: 'Чёрный кряж',
}

export const ABILITY_BLOCKED_NO_ARMS_NOTICE =
  'Без рук лук не натянуть. Можно достать или купить протез.'
export const ABILITY_BLOCKED_NO_STAMINA_NOTICE =
  'Выносливость кончилась. Можно ползать и т. п., но приём не выйдет.'
export const FINISHER_BLOCKED_NO_STAMINA_NOTICE =
  'На добивание выносливости не хватило — вышел обычный замах.'
export const SHIELD_DROPPED_NOTICE = 'Выносливость кончилась — щит опущен.'
export const COMBAT_MASTERY_SAVE_WARNING =
  'Боевые таймеры в записи повреждены: защита снята, оставлена безопасная передышка. Выносливость не восстановлена.'

export const COMBAT_MASTERY_COPY = {
  title: 'Боевой шаг',
  seconds: 'с',
  evade: 'Уворот',
  ready: 'Готов',
  active: 'Шаг идёт',
  protected: 'Окно уворота',
  recovery: 'Передышка',
  guardReady: 'Точный щит готов',
  guardWindow: 'Поймай удар щитом',
  guardHeld: 'Обычный щит',
  guardRecovery: 'Точный щит через',
  guardUnavailable: 'Точный щит недоступен',
  evaded: 'Ушёл от удара',
  perfectGuard: 'Вовремя! Щит без урона',
  camera: 'Управление камерой',
  capture: 'Захватить мышь',
  drag: 'Тяни по миру — камера. Щелчок — удар.',
  bowDrag: 'Тяни по миру — прицел. Щелчок — выстрел.',
  touchLook: 'Тяни по миру — камера',
  native: 'Мышь — камера; ЛКМ — удар',
  bowNative: 'Мышь — прицел; ЛКМ — выстрел',
} as const

export function describeEvadeRefused(reason: import('../world/CombatMastery.ts').EvadeReadiness): string {
  switch (reason) {
    case 'stamina': return 'На уворот нужно 25 выносливости.'
    case 'legs': return 'Без обеих ног не отшагнуть. Нужен протез.'
    case 'committed': return 'Добивание уже пошло — из него не выйти.'
    case 'active': return 'Шаг уже идёт.'
    case 'cooldown': return 'Сначала передышка — потом новый уворот.'
    case 'paused': return 'Поход на паузе.'
    case 'ended': return 'Поход закончен.'
    case 'input': return 'Сначала закончи ввод.'
    case 'ready': return 'Уворот готов.'
  }
}

export function describePointerLockFailure(reason: string): string {
  const cause = reason === 'WrongDocumentError' ? 'захват недоступен в этом окне' :
    reason === 'NotSupportedError' ? 'браузер не умеет захватывать мышь' :
    reason === 'SecurityError' || reason === 'NotAllowedError' ? 'браузер запретил захват мыши' :
    'браузер отклонил захват мыши'
  return `${cause[0].toUpperCase()}${cause.slice(1)}. Тяни по миру для обзора; щелчок — удар.`
}

/** Roadmap 1.6 — «Устав сухого пайка» spends a ration the moment blood shows. */
export const RATION_ON_BLEED_NOTICE =
  'Пошла кровь — паёк ушёл сам, по уставу. Кровь остановлена, котомка легче.'

export const CARAVAN_DEFENDED_BY_PLAYER_NOTICE =
  'Ты играешь охраной дворца: этот корован надо защищать.'
export const CARAVAN_ALREADY_ROBBED_NOTICE = 'Этот корован уже ограбили. Ждём следующий.'
export const CARAVAN_STILL_GUARDED_NOTICE =
  'Сначала разберись с живой охраной корована.'
export const CARAVAN_DEFENSE_NOT_EARNED_NOTICE =
  'Корован цел. Перевязку выдают только за врага, которого ты снял с телеги.'
export const CARAVAN_DEFENSE_COOLDOWN_NOTICE =
  'Перевязку уже выдали. Интенданту нужно время пополнить сумку.'
export const CARAVAN_AMBUSH_NOTICE = 'Засада! Охрана корована набигает.'
export const RICH_CARAVAN_LOOT_TAKEN_NOTICE = 'Добыча у тебя. Теперь уходи от погони!'

export function describeCaravanRobbed(reward: number): string {
  return `Корован ограблен! +${reward} золота. Охрана уже набигает.`
}

export function describeCaravanDefenseAid(healed: number): string {
  return `Корован отстояли. Интендант перевязал раны: +${healed} здоровья.`
}

/** The escort fell to the player's side: for a few seconds nobody else may load the cart. */
export const CARAVAN_CLAIM_NOTICE =
  'Охрана корована легла. Груз твой — бери, пока не растащили.'

/** The HUD cue while somebody else is loading a cart: what is happening and what to do. */
export function describeCaravanLootCue(looter: CaravanLooterKind, defend: boolean): string {
  if (looter === 'beast') {
    return defend ? 'Зверьё лезет в корован — отгони!' : 'Зверьё потрошит корован — отгони!'
  }
  return defend ? 'Мародёр грузит корован — сбей его!' : 'Корован грузят без тебя — успей первым!'
}

/** The player's hit made a looter drop the load. */
export function describeCaravanLootInterrupted(defend: boolean): string {
  return defend
    ? 'Мародёра сбили с телеги. Груз на месте.'
    : 'Мародёр бросил груз. Корован снова ничей — то есть твой.'
}

/** An emptied road cart says who emptied it while the engine still knows. */
export function describeCaravanEmptyPrompt(robbedBy: CaravanRobber | null): string {
  switch (robbedBy) {
    case 'player': return 'Этот корован ты уже обчистил'
    case 'raider': return 'Корован увели без тебя'
    case 'beast': return 'Корован обглодали звери'
    default: return 'Корован уже ограбили'
  }
}

/** The same honesty for the notice an E press on an empty cart gets. */
export function describeCaravanAlreadyRobbed(robbedBy: CaravanRobber | null): string {
  switch (robbedBy) {
    case 'player': return 'Этот корован ты уже обчистил. Ждём следующий.'
    case 'raider': return 'Этот корован увели без тебя. Ждём следующий.'
    case 'beast': return 'Этот корован обглодали звери. Ждём следующий.'
    default: return CARAVAN_ALREADY_ROBBED_NOTICE
  }
}

// ---------------------------------------------------------------------------
// W2-2 — caravan beats: «Можно грабить корованы», each side in its own words
// ---------------------------------------------------------------------------

export const BRIDGE_AMBUSH_TITLE = 'Засада у старого моста'

const CARAVAN_BEAT_PLACES: Record<CaravanBeatPlacement, string> = {
  bridge: 'у старого моста',
  forest: 'на лесной дороге',
  open: 'на открытой дороге',
  pass: 'на горном перевале',
}

const CARAVAN_OWNERS: Record<Faction, string> = {
  elf: 'обоз лесных эльфов',
  guard: 'обоз дворца',
  villain: 'корован злодея',
}

export function describeCaravanBeatPlace(placement: CaravanBeatPlacement): string {
  return CARAVAN_BEAT_PLACES[placement]
}

/** The guard's beats arrive as orders, because «надо слушаться командира». */
export function describeCaravanBeatTitle(
  placement: CaravanBeatPlacement,
  faction: Faction,
  role: CaravanBeatRole,
): string {
  const place = CARAVAN_BEAT_PLACES[placement]
  if (faction === 'guard') return role === 'defend' ? `Приказ: обоз ${place}` : `Приказ: набег ${place}`
  return placement === 'bridge' ? BRIDGE_AMBUSH_TITLE : `Корован ${place}`
}

export function describeCaravanBeatTask(placement: CaravanBeatPlacement): string {
  return `Добраться по настоящей дороге к гружёной телеге ${CARAVAN_BEAT_PLACES[placement]}.`
}

export const CARAVAN_BEAT_OPTIONAL_STAKE =
  'Необязательная встреча: маршрут не принимает слух и не меняет выбранный подряд.'
export const CARAVAN_BEATS_SAVE_WARNING =
  'Запись корованов повреждена. Встречи закрыты без награды; поход продолжается.'
export const BRIDGE_AMBUSH_UNAVAILABLE_NOTICE =
  'На открывающей дороге не нашлось доступного моста. Встреча отмечена как недоступная.'
export const CARAVAN_BEAT_CHOICE_FOCUS_NOTICE =
  'Курсор свободен. Выбери в панели, что делать с грузом.'
export const CARAVAN_BEAT_CAPACITY_NOTICE =
  'У корована сейчас слишком людно. Встреча дождётся, пока освободится дорога.'
export const CARAVAN_BEAT_SQUAD_FULL_NOTICE =
  'Войско полно: больше бойцов не прокормить. Выбери другой исход.'
export const CARAVAN_BEAT_NO_ROOM_NOTICE =
  'Обозникам негде встать рядом с телегой. Выбери другой исход.'
export const CARAVAN_BEAT_REOPENED_NOTICE =
  'Злодей обозы не водит: телега у моста снова ждёт твоего решения.'

// ---------------------------------------------------------------------------
// W2-2, PR B — «грабить корованы» as the spine of the run
// ---------------------------------------------------------------------------

/** The camp's node in a run with a spine: the first thing the run decides. */
export const CARAVAN_SPINE_ROOT_TEXT = 'Суть такова: выбрать корован'

/** The atlas's stake for a cart the finale waits on. */
export const CARAVAN_SPINE_STAKE =
  'Без корованов штурма не будет: до него надо разобраться с двумя, как бы ни кончилось.'

export const CARAVAN_OPENING_TITLE = 'Суть такова: два корована'

/**
 * The opening card's title for the offers still open. A world without a second road (a few
 * in a hundred), or one whose other cart could not be staged, has a single caravan to take.
 */
export function describeCaravanOpeningTitle(offers: number): string {
  return offers === 1 ? 'Суть такова: один корован' : CARAVAN_OPENING_TITLE
}

/** The opening card's first line, in each side's words. */
export function describeCaravanOpeningLead(faction: Faction, offers = 2): string {
  if (offers === 1) {
    switch (faction) {
      case 'elf':
        return 'Мимо домиков деревяных идёт один корован. С него поход и начнётся.'
      case 'guard':
        return 'Командир дал один приказ. С него служба и начнётся.'
      case 'villain':
        return 'Сам себе командир: на дороге один корован. С него и начнём.'
    }
  }
  switch (faction) {
    case 'elf':
      return 'Мимо домиков деревяных идут два корована. Возьмёшься за один — второй уйдёт своей дорогой.'
    case 'guard':
      return 'Командир дал два приказа на выбор. Возьмёшься за один — второй отдадут другим.'
    case 'villain':
      return 'Сам себе командир: на дорогах два корована. Пойдёшь на один — второй уйдёт своей дорогой.'
  }
}

export const CARAVAN_OPENING_HINT =
  'Нажми «Взяться» или просто иди к телеге: к какой подойдёшь, та и выбрана.'

/** The field card's one line, what taking one costs; the journal's card says it at length. */
export function describeCaravanOpeningRule(faction: Faction, offers = 2): string {
  if (offers === 1) return faction === 'guard' ? 'Приказ один — с него и начнёшь.' : 'Корован один — с него и начнёшь.'
  return faction === 'guard' ? 'Возьмёшься за один — второй отдадут.' : 'Возьмёшься за один — второй уйдёт.'
}

export const CARAVAN_OFFER_TAKE_LABEL = 'Взяться'
export const CARAVAN_OFFER_TAKEN_LABEL = 'Взялся'

/** «Взяться», with the square: the camp's two carts often share a road's name. */
export function describeCaravanOfferChosen(title: string, regionLabel: string): string {
  return `Взялся: «${title}» в ${regionLabel}. Компас ведёт к телеге.`
}

/**
 * The compass's second line while it leads to one of the camp's offers on its own, before
 * «Взяться»: the nearest by road, and the other one is in the card. The line above already
 * says «Корован…» or «Приказ…», so this one fits the compass at 1366 px.
 */
export function describeCaravanOfferCompassNote(offers: number): string {
  return offers > 1 ? 'ближний · второй — в карточке' : 'выбирать не из чего'
}

export function describeCaravanOffersDeclined(faction: Faction): string {
  return faction === 'guard'
    ? 'Второй приказ отдали другим: за двумя обозами не уследишь.'
    : 'Второй корован ушёл своей дорогой: за двумя корованами погонишься — ни одного не ограбишь.'
}

export const CARAVAN_BEAT_DORMANT_HINT = 'Выйдет на дорогу после первого корована.'

/** A road beat while the camp still chooses: no cart stands there yet. */
export function describeCaravanBeatDormant(
  faction: Faction,
  role: CaravanBeatRole,
  owner: Faction,
  placement: CaravanBeatPlacement,
): string {
  const cart = `${CARAVAN_OWNERS[owner]} ${CARAVAN_BEAT_PLACES[placement]}`
  if (faction === 'guard') {
    return role === 'defend'
      ? `Приказ подождёт: ${cart} выйдет на дорогу после первого корована.`
      : `Набег подождёт: ${cart} выйдет на дорогу после первого корована.`
  }
  return `${capitalize(cart)} выйдет на дорогу после первого корована.`
}

export const CARAVAN_BEAT_DECLINED_HINT = 'Выбор сделан у лагеря; эта телега в поход не вошла.'

/** The camp's offer the run did not take. */
export function describeCaravanBeatDeclined(
  faction: Faction,
  _role: CaravanBeatRole,
  owner: Faction,
  placement: CaravanBeatPlacement,
): string {
  const cart = `${CARAVAN_OWNERS[owner]} ${CARAVAN_BEAT_PLACES[placement]}`
  return faction === 'guard'
    ? `Приказ отдали другим: ${cart} ушёл без тебя.`
    : `${capitalize(cart)} ушёл другой дорогой: ты взялся за другой корован.`
}

/** A cart waiting for room on a crowded road, with the seconds it will still wait. */
export function describeCaravanBeatStagingWait(seconds: number): string {
  return `На дороге тесно, драке негде развернуться. Корован ждёт ещё ${String(Math.max(0, Math.ceil(seconds)))} с, потом проедет без тебя.`
}

/** The cart gave up on the road: the run moves on without that fight. */
export function describeCaravanBeatStagingGaveUp(placement: CaravanBeatPlacement): string {
  return `${capitalize(CARAVAN_BEAT_PLACES[placement])} так и не стало просторно: корован проехал без драки. Поход идёт дальше.`
}

/** The finale objective's line while the gate is shut. */
export function describeCaravanSpineGate(settled: number, required: number): string {
  return `Штурм после корованов: ${String(Math.min(settled, required))}/${String(required)}`
}

export const CARAVAN_SPINE_GATE_OPEN_NOTICE = 'Корованы разобраны: путь на штурм открыт.'

/**
 * The side's other verbs on a cart, said after its price. Words rather than another payout,
 * so a card never adds alternatives up: «Или: 3 пайка домикам деревяным.»
 */
export function describeCaravanBeatAlternatives(input: {
  outcomes: readonly CaravanBeatOutcome[]
  rations: number
  thinsGarrison: boolean
}): string | null {
  const parts: string[] = []
  for (const outcome of input.outcomes) {
    switch (outcome) {
      case 'give':
        parts.push(`${formatRussianCount(input.rations, RATION_FORMS)} домикам деревяным`)
        break
      case 'release':
        parts.push('отпустить своим ходом, без жалованья')
        break
      case 'press':
        parts.push('забрить обозников в войско')
        break
      case 'burn':
        parts.push(input.thinsGarrison
          ? 'сжечь груз — у ворот дворца станет на одного стражника меньше'
          : 'сжечь груз назло хозяевам')
        break
      default:
        break
    }
  }
  return parts.length > 0 ? `Или: ${parts.join('; или ')}.` : null
}

/** The prompt line beside a beat's cart, by what the player can do there right now. */
export const CARAVAN_BEAT_PROMPTS = {
  releaseCursor: '[E] Освободить курсор и выбрать судьбу груза',
  chooseWithButtons: 'Выбери кнопкой, что делать с грузом',
  approachToChoose: 'Подойди к телеге, чтобы решить судьбу груза',
  walkBeside: 'Иди рядом: телега движется только с проводником',
  returnToCart: 'Вернись к телеге — без проводника она стоит',
  defend: 'Отбей налётчиков от телеги',
  rob: 'Сначала одолей живых защитников телеги',
  clear: 'Подступ к телеге свободен',
} as const

/** Where a staging point could not be found, said for the place it could not be found at. */
export function describeCaravanBeatNoGround(placement: CaravanBeatPlacement): string {
  return placement === 'bridge'
    ? 'Берег у выбранного моста занят постройками; безопасно поставить встречу нельзя.'
    : 'Обочина у корована занята постройками; безопасно поставить встречу нельзя.'
}

export function describeCaravanBeatApproach(
  faction: Faction,
  role: CaravanBeatRole,
  owner: Faction,
  placement: CaravanBeatPlacement,
): string {
  const place = CARAVAN_BEAT_PLACES[placement]
  const cart = CARAVAN_OWNERS[owner]
  if (role === 'defend') {
    return `Приказ командира: налётчики зажали ${cart} ${place}. Отбей груз — его ждут на торгу.`
  }
  if (faction === 'guard') {
    return `Приказ командира: ${cart} ${place} везёт врагу припасы. Положи охрану и конфискуй груз для дворца.`
  }
  if (faction === 'villain') {
    return `${capitalize(cart)} идёт ${place}. Сам себе командир: охрану положить, а с грузом — как захочешь.`
  }
  return `${capitalize(cart)} идёт ${place} под охраной. Можно грабить корованы — сначала положи охрану.`
}

export function describeCaravanBeatFight(role: CaravanBeatRole, remaining: number): string {
  return role === 'defend'
    ? `Налётчики бьют охрану и телегу. Осталось врагов: ${remaining}.`
    : `Охрана не отдаёт телегу. Осталось защитников: ${remaining}.`
}

export function describeCaravanBeatSecured(faction: Faction, role: CaravanBeatRole): string {
  if (role === 'defend') return 'Налётчики отбиты, обоз цел. Проведи его сам или отпусти своим ходом.'
  if (faction === 'guard') return 'Охрана легла. Груз конфискуется для дворца, командир платит награду.'
  if (faction === 'villain') {
    return 'Охрана легла. Сам себе командир: забрать добро, забрить обозников в войско или сжечь груз.'
  }
  return 'Охрана легла, телега цела. Груз можно забрать себе или отдать домикам деревяным.'
}

export function describeCaravanBeatSecuredNotice(role: CaravanBeatRole): string {
  return role === 'defend'
    ? 'Налётчики отбиты. Подойди к обозу и выбери в панели: вести его или отпустить.'
    : 'Охрана легла. Подойди к телеге и выбери в панели, что делать с грузом.'
}

export function describeCaravanBeatDelivering(outcome: CaravanBeatOutcome): string {
  return outcome === 'give'
    ? 'Веди телегу рядом: за отметкой её разберут домики деревяные.'
    : 'Иди рядом с обозом до отметки: без проводника он стоит.'
}

export function describeCaravanBeatDeliveryStarted(outcome: CaravanBeatOutcome): string {
  return outcome === 'give'
    ? 'Веди телегу рядом с собой: домики деревяные ждут за отметкой.'
    : 'Веди обоз рядом с собой до отметки.'
}

export function describeCaravanBeatHint(
  phase: 'approach' | 'fighting' | 'secured' | 'delivering' | 'settled',
  role: CaravanBeatRole,
  placement: CaravanBeatPlacement,
  routeLabel: string,
): string {
  switch (phase) {
    case 'approach':
      return `Маршрут: ${routeLabel}. Запасной подход — ${placement === 'bridge' ? 'по сухому берегу' : 'по сухой обочине'} рядом с телегой.`
    case 'fighting':
      return role === 'defend'
        ? 'Не дай налётчикам добить телегу; твой отряд принимает обычные приказы.'
        : 'Выбор груза откроется только после последнего живого защитника.'
    case 'secured':
      return 'Подойди к телеге и выбери один исход. E ничего не тратит автоматически.'
    case 'delivering':
      return 'Держись рядом с телегой до отмеченного конца дороги.'
    case 'settled':
      return 'Исход записан в этом забеге; обязательные цели похода не менялись.'
  }
}

/** Shown while the player is out of reach of an engaged cart and the clock is running. */
export function describeCaravanBeatAbandon(
  phase: 'fighting' | 'secured' | 'delivering',
  role: CaravanBeatRole,
  seconds: number,
): string {
  const left = `${Math.max(0, Math.ceil(seconds))} с`
  if (phase === 'delivering') return `Без проводника телегу доведут сами, но без награды: ${left}.`
  if (phase === 'secured') {
    return role === 'defend'
      ? `Обоз уйдёт своим ходом без жалованья: ${left}. Вернись к телеге.`
      : `Брошенный груз растащат: ${left}. Вернись к телеге.`
  }
  return role === 'defend'
    ? `Без тебя налётчики добьют обоз: ${left}. Вернись к телеге.`
    : `Корован уйдёт без тебя: ${left}. Вернись к телеге.`
}

export const CARAVAN_BEAT_CHOICE_LABELS: Record<CaravanBeatOutcome, string> = {
  take: 'Забрать груз',
  give: 'Отдать домикам деревяным',
  deliver: 'Довести обоз',
  release: 'Отпустить своим ходом',
  confiscate: 'Конфисковать для дворца',
  plunder: 'Забрать добро',
  press: 'Забрить в войско',
  burn: 'Сжечь груз',
}

// W2-3 owns `RATION_FORMS`; the beat lines count rations in the same words its price cards do.
function formatRations(count: number): string {
  return `+${formatRussianCount(count, RATION_FORMS)}`
}

/** `1.18` → `×1,18`, the way the shop prints a surcharge. */
export function formatPriceFactor(value: number): string {
  return `×${value.toFixed(2).replace('.', ',')}`
}

/** What one caravan does to the world's one market, before and after. */
export interface CaravanBeatMarketCopy {
  regionLabel: string
  before: number
  after: number
}

export function describeCaravanBeatMarket(market: CaravanBeatMarketCopy | null): string {
  if (!market) return 'торг этого не заметит'
  return `цены в лавке ${market.regionLabel} ${formatPriceFactor(market.before)} → ${formatPriceFactor(market.after)}`
}

export interface CaravanBeatChoiceCopy {
  outcome: CaravanBeatOutcome
  gold: number
  rations: number
  thinsGarrison: boolean
  squadSize: number
  squadCap: number
  market: CaravanBeatMarketCopy | null
}

export function describeCaravanBeatChoice(choice: CaravanBeatChoiceCopy): string {
  const market = describeCaravanBeatMarket(choice.market)
  switch (choice.outcome) {
    case 'take':
    case 'plunder':
      return `+${choice.gold} золота сразу; ${market}.`
    case 'give':
      return `${formatRations(choice.rations)} от домиков; ${market}.`
    case 'deliver':
      return `+${choice.gold} от командира и ${formatRations(choice.rations)}, если идти рядом; ${market}.`
    case 'release':
      return `Сразу и без жалованья; ${market}.`
    case 'confiscate':
      return `+${choice.gold} награды от командира; ${market}.`
    case 'press':
      return `+1 боец в войско (${choice.squadSize}/${choice.squadCap}); ${market}.`
    case 'burn':
      return choice.thinsGarrison
        ? `У ворот дворца станет на одного стражника меньше; ${market}.`
        : `Только дым и злорадство; ${market}.`
  }
}

export function describeCaravanBeatSquadFull(squadSize: number, squadCap: number): string {
  return `Войско полно: ${squadSize}/${squadCap}. Больше не прокормить.`
}

export interface CaravanBeatOutcomeCopy {
  outcome: CaravanBeatOutcome
  gold: number
  rations: number
  thinnedGarrison: boolean
  /** The player walked away from a delivery and it finished without them, unpaid. */
  unattended: boolean
  market: CaravanBeatMarketCopy | null
}

/** The line a resolved cart keeps: notice, journal card and сводка all say it. */
export function describeCaravanBeatOutcome(result: CaravanBeatOutcomeCopy): string {
  const market = capitalize(describeCaravanBeatMarket(result.market))
  switch (result.outcome) {
    case 'take':
      return `Груз забран: +${result.gold} золота. ${market}.`
    case 'give':
      return result.unattended
        ? `Домики деревяные забрали телегу сами, без пайков для пользователя. ${market}.`
        : `Телега ушла к домикам деревяным: ${formatRations(result.rations)}. ${market}.`
    case 'deliver':
      return result.unattended
        ? `Обоз дошёл без проводника, командир не заплатил. ${market}.`
        : `Обоз доведён: +${result.gold} от командира, ${formatRations(result.rations)}. ${market}.`
    case 'release':
      return result.unattended
        ? `Обоз ушёл своим ходом без тебя и дошёл. ${market}.`
        : `Обоз отпущен своим ходом и дошёл. ${market}.`
    case 'confiscate':
      return `Груз конфискован для дворца: +${result.gold} награды. ${market}.`
    case 'plunder':
      return `Добро забрано: +${result.gold} золота. ${market}.`
    case 'press':
      return `Обозники забриты в войско: +1 боец. ${market}.`
    case 'burn':
      return result.thinnedGarrison
        ? `Груз сожжён. Дворец без подвоза: у ворот на одного стражника меньше. ${market}.`
        : `Груз сожжён. ${market}.`
  }
}

export type CaravanBeatLossCause = 'destroyed' | 'looted' | 'abandoned'

export function describeCaravanBeatLost(
  role: CaravanBeatRole,
  cause: CaravanBeatLossCause,
  market: CaravanBeatMarketCopy | null,
): string {
  const tail = capitalize(describeCaravanBeatMarket(market))
  if (cause === 'destroyed') return `Налётчики разбили телегу. ${tail}.`
  if (cause === 'looted') return `Груз растащили без тебя. ${tail}.`
  return role === 'defend'
    ? `Без тебя налётчики добили обоз. ${tail}.`
    : `Брошенный груз растащили. ${tail}.`
}

export function describeCaravanBeatEscaped(market: CaravanBeatMarketCopy | null): string {
  return `Корован ушёл, пока тебя не было, и дошёл. ${capitalize(describeCaravanBeatMarket(market))}.`
}

export const CARAVAN_BEAT_UNAVAILABLE_HINT =
  'Поход и его цели продолжаются без этой необязательной встречи.'

const CARAVAN_BEAT_ENDING_WORDS: Record<CaravanBeatOutcome | 'lost' | 'escaped', string> = {
  take: 'ограблен',
  give: 'отдан домикам',
  deliver: 'доведён',
  release: 'отпущен',
  confiscate: 'конфискован',
  plunder: 'ограблен',
  press: 'обозники забриты',
  burn: 'сожжён',
  lost: 'потерян',
  escaped: 'ушёл',
}

export function describeCaravanBeatEnding(ending: CaravanBeatOutcome | 'lost' | 'escaped'): string {
  return CARAVAN_BEAT_ENDING_WORDS[ending]
}

/** W1-2 backlog — a chronicle ambush of the player's own side's cart is defended, not robbed. */
export function describeCaravanAmbushDefence(context: LocatedEventCopyContext): LocatedEventCopy {
  return {
    title: 'Свой корован под ножом',
    description: `Налётчики режут корован (${factionName(context.faction)}) до точки «${context.siteLabel ?? 'склад'}». Свой груз не грабят — отбей его.`,
  }
}

export function describeCaravanAmbushDefenceStart(context: LocatedEventCopyContext): string {
  return `В квадрате ${context.regionLabel} режут свой корован. Успей отбить.`
}

export const CARAVAN_AMBUSH_DEFENCE_PROMPT = 'Отбей налётчиков от корована'

export function describeCaravanAmbushDefended(reward: number): string {
  return `Корован отбит и идёт дальше целым. Хозяева груза заплатили: +${reward} золота.`
}

/** The guard's rich-caravan raid, said the way the guard does it: confiscation, not robbery. */
export const RICH_CARAVAN_CONFISCATE_DESCRIPTION =
  'Конфискуй груз для дворца и отойди от места на 18 метров.'
/** The guard's E at any enemy cart it raids: the rich caravan or a chronicle ambush. */
export const CARAVAN_CONFISCATE_PROMPT = '[E] Конфисковать груз для дворца'
/** A chronicle ambush the guard won as a raid: the cargo went to the palace, not to its pocket. */
export const CARAVAN_AMBUSH_CONFISCATED_OUTCOME =
  'Груз конфискован для дворца по всем правилам. Конкуренты остались с пустой телегой.'
export const RICH_CARAVAN_CONFISCATED_NOTICE = 'Груз конфискован. Теперь уходи от погони!'

/** W2-3 — the amount is handed in from `WORLD_EVENT_REWARDS`, like every other success line. */
export function describeRichCaravanConfiscated(gold: number): string {
  return `Груз конфискован для дворца, погоня позади. Командир выдал награду: +${gold} золота.`
}

const SQUAD_NAMES: Record<Faction, string> = {
  elf: 'Партизаны эльфов',
  guard: 'Солдаты охраны',
  villain: 'Войска злодея',
}

export const SQUAD_ORDER_LABELS: Record<SquadCommandMode, string> = {
  follow: 'Следом',
  hold: 'Держать',
  focus: 'Всем в цель',
  regroup: 'Ко мне',
}

export const SQUAD_ORDER_DETAILS: Record<SquadCommandMode, string> = {
  follow: 'Идти строем, прикрывать фланги. Отставшие догоняют по дороге.',
  hold: 'Занять место возле тебя. Оборонять 6 м, не гнаться дальше 8 м.',
  focus: 'Выбери видимого врага в пределах 30 м. Потеряем цель — вернём прежний приказ.',
  regroup: 'Выйти из погони и собраться. Снова пойдём следом, когда дойдут все живые.',
}

export const SQUAD_STATUS_LABELS: Record<SquadMemberStatus, string> = {
  following: 'Следом',
  holding: 'На месте',
  positioning: 'К позиции',
  regrouping: 'Собирается',
  engaged: 'В бою',
  distant: 'Далеко',
  blocked: 'Путь закрыт',
  routing: 'Отступает',
  recovering: 'После удара',
}

export const SQUAD_COMMAND_COPY = {
  title: 'Приказы отряду',
  open: 'Открыть приказы отряду',
  close: 'Закрыть приказы',
  pause: 'Мир на паузе. Открытие панели само по себе ничего не приказывает.',
  confirm: 'Отдать приказ',
  cancel: 'Отмена',
  roster: 'Живые спутники',
  target: 'Цель отряда',
  chooseTarget: 'Выбери противника',
  noTargets: 'Видимых противников в пределах 30 м нет. Поверни камеру или подойди ближе.',
  distant: 'Отставший не значит погибший. Если путь закрыт, приблизься: за границей активных областей отряд ждёт, а не телепортируется.',
  empty: 'В отряде никого нет. Местная охрана тебе не подчиняется.',
  invalidOrder: 'Такого приказа нет.',
  invalidAnchor: 'Здесь отряду не встать. Выбери свободное место.',
  invalidTarget: 'Цель недоступна: нужен видимый противник не дальше 30 м.',
  invalidSave: 'Сохранённый приказ повреждён. Возвращён прежний режим отряда.',
  focusLost: 'Цель потеряна. Отряд возвращается к прежнему приказу.',
  regrouped: 'Отряд собрался. Снова идём следом.',
  rejected: 'Приказ не принят. Проверь цель и состав отряда.',
  quick: 'Q — следом / держать',
  current: 'Сейчас',
  anchor: 'Место обороны',
  metres: 'м',
} as const

export const SQUAD_RESOURCE_SAVE_WARNING =
  'Запись ухода за отрядом повреждена. Лечение и сбор закрыты, чтобы их нельзя было получить заново.'

export const SQUAD_REPLENISHMENT_COPY: Record<Faction, string> = {
  elf: 'Партизаны приходят после спасения пленника или защиты домиков деревяных.',
  guard: 'Командир присылает солдата за доведённый или конфискованный корован.',
  villain: 'Корован можно забрить сразу, а одного павшего заменить сбором в старом форте.',
}

export const SQUAD_CARE_COPY = {
  healthy: 'Здоров',
  journalTitle: 'Отряд как запас',
  open: 'Приказы и лечение',
  medicineTarget: 'Кого лечить',
  player: 'Пользователь',
} as const

export function describeSquadCareStock(rations: number, range: number): string {
  return `Паёк: ${String(rations)} · рядом до ${String(range)} м`
}

export function describeSquadTreatmentAction(
  nearby: boolean,
  rations: number,
  healed: number,
): string {
  if (!nearby) return 'Слишком далеко'
  if (rations <= 0) return 'Нет пайка'
  if (rations === 1) {
    return `Паёк +${String(healed)} · последний — себе не останется`
  }
  return `Паёк +${String(healed)} · останется ${String(Math.max(0, rations - 1))}`
}

export function describePlayerCareState(health: number, maxHealth: number): string {
  return `Пользователь ${String(Math.ceil(health))}/${String(Math.ceil(maxHealth))}`
}

export function describeSquadCareJournal(rations: number, range: number): string {
  return `Паёк лечит выбранного спутника в пределах ${String(range)} м. Сейчас пайков: ${String(rations)}.`
}

export function describeVillainMusterJournal(regionLabel: string, remaining: number): string {
  return `Старый форт, квадрат ${regionLabel}: сбор ${String(remaining)}/1.`
}

export function describeSquadMedicineTarget(input: {
  role: ActorRole
  health: number
  maxHealth: number
  distance: number
  range: number
}): string {
  const distance = input.distance > input.range ? ' · далеко' : ''
  return `${describeSquadRole(input.role)} · ${String(Math.ceil(input.health))}/${String(input.maxHealth)}${distance}`
}

export function describeSquadOrder(faction: Faction, order: boolean | SquadCommandMode): string {
  const mode = typeof order === 'boolean' ? order ? 'follow' : 'hold' : order
  return `${SQUAD_NAMES[faction]}: приказ «${SQUAD_ORDER_LABELS[mode]}».`
}

export const REINFORCEMENTS_ORDERED_NOTICE =
  'Командир приказал подкреплению вступить в бой!'

export function describeRationEaten(healed: number): string {
  return `Дорожный паёк вернул ${healed} здоровья. Не спрашивай, из чего он.`
}

export function describeCompanionRation(
  role: ActorRole,
  healed: number,
): string {
  return `${describeSquadRole(role)} съел паёк: +${String(healed)} здоровья. Отряд пока не испарился.`
}

export function describeCompanionMedicine(
  role: ActorRole,
  healed: number,
): string {
  return `Полевой набор ушёл в дело: ${describeSquadRole(role)} получил +${String(healed)} здоровья.`
}

export function describeRecoveryPrompt(input: {
  remaining: number
  total: number
  completesErrand: boolean
  treatsPlayer: boolean
  companionCount: number
}): string {
  const count = `лечений ${String(input.remaining)}/${String(input.total)}`
  if (input.remaining <= 0) {
    return input.completesErrand
      ? `[E] Осмотреть · лекарь занят · ${count}`
      : `Лекарь занят — зайди в другой поход · ${count}`
  }
  if (!input.treatsPlayer && input.companionCount === 0) {
    return input.completesErrand
      ? `[E] Осмотреть · лечить некого · ${count}`
      : `Лечить некого · ${count}`
  }
  const effects: string[] = []
  if (input.completesErrand) effects.push('осмотреть')
  if (input.treatsPlayer) effects.push('вылечить пользователя')
  if (input.companionCount > 0) effects.push('подлечить отряд рядом')
  const action = effects.join(' и ')
  return `[E] ${action.charAt(0).toUpperCase()}${action.slice(1)} · ${count}`
}

export function describeRecoveryTreated(
  playerTreated: boolean,
  companions: number,
  remaining: number,
): string {
  const player = playerTreated ? 'Пользователя вылечили.' : ''
  const squad = companions > 0
    ? `${player ? ' ' : ''}Отряд рядом подлатали: ${String(companions)}.`
    : ''
  return `${player}${squad} У лекаря осталось ${String(remaining)}/2.`
}

export const RECOVERY_EXHAUSTED_NOTICE =
  'Лекарь занят — лечений 0/2. Осмотреть место всё равно можно.'

export const RECOVERY_NOBODY_HURT_NOTICE =
  'Лечить некого. Лекарь приберёг оба глаза и прочие инструменты.'

export const COMPANION_TREATMENT_TOO_FAR_NOTICE =
  'Спутник слишком далеко. Собери отряд ближе, паёк по воздуху не летает.'

export const COMPANION_TREATMENT_FULL_NOTICE =
  'У этого спутника здоровье полное. Паёк пока останется в сумке.'

export const COMPANION_TREATMENT_NO_RATIONS_NOTICE =
  'Пайков нет. Можно достать лечение у торговца или найти лекаря.'

export const COMPANION_TREATMENT_UNAVAILABLE_NOTICE =
  'Этого спутника уже нет в живом отряде. Лечить запись в списке бесполезно.'

export function describeSquadReinforcementJoined(
  source: 'elfDefense' | 'guardOrder' | 'villainMuster',
): string {
  if (source === 'elfDefense') {
    return 'Домики деревяные отбиты. Один партизан идёт с отрядом.'
  }
  if (source === 'guardOrder') {
    return 'Приказ по коровану исполнен. Командир прислал одного солдата.'
  }
  return 'Сбор в старом форте поднят. Один прихвостень вступил в войско.'
}

export function describeSquadReinforcementWaiting(
  source: 'elfDefense' | 'guardOrder' | 'villainMuster',
): string {
  if (source === 'elfDefense') return 'Партизан заработан и ждёт у домиков, пока на поле станет свободнее.'
  if (source === 'guardOrder') return 'Солдат прислан и ждёт у корована, пока на поле станет свободнее.'
  return 'Прихвостень созван и ждёт в старом форте, пока на поле станет свободнее.'
}

export function describeSquadReinforcementFull(
  source: 'elfDefense' | 'guardOrder',
): string {
  return source === 'elfDefense'
    ? 'Дом отбит, но отряд полон 4/4. Партизан остался защищать домики.'
    : 'Приказ исполнен, но отряд полон 4/4. Солдат остался при короване.'
}

export function describeVillainMusterPrompt(input: {
  casualties: number
  squadSize: number
  cap: number
  remaining: number
}): string | null {
  if (input.casualties <= 0) return null
  if (input.remaining <= 0) return `Сбор в старом форте уже потрачен · 0/1`
  if (input.squadSize >= input.cap) return `Войско полно ${String(input.squadSize)}/${String(input.cap)} · сбор 1/1`
  return '[E] Потратить сбор 1/1: заменить одного павшего прихвостнем'
}

export function describeRazedSite(kind: SiteKind): string {
  return kind === 'shop'
    ? 'Лавка сгорела вместе с домиками деревяными. Торговать не с кем.'
    : 'Лечить некому: знахаря вынесли вперёд ногами, а избу — по брёвнышку.'
}

export const HEALER_TREATED_NOTICE = 'Пользователя вылечили. До протезов дело пока не дошло.'
export const TREASURE_ALREADY_LOOTED_NOTICE = 'Этот тайник уже пуст.'

export function describeTreasureFound(reward: number): string {
  return `В тайнике нашлись припасы и ${reward} золота.`
}

export function describeSiteInspected(kind: SiteKind): string {
  return `Осмотрено: «${generatedSiteLabel(kind)}».`
}

export function describeObjectiveCompleted(text: string): string {
  return `Задача выполнена: ${text}.`
}

export function describeZoneDiscovered(zone: ZoneId): string {
  return `Открыта область: «${ZONE_DISCOVERY_NAMES[zone]}».`
}

/**
 * W2-1 — the night, said once, on the step that crosses into it. That step is dusk — the
 * moment the villagers gather and the fires are lit, with the sun still low over the
 * horizon — so the line says it is getting dark rather than that it is dark. Short on
 * purpose: it lands in the same stack as everything else, and the world shows the rest.
 */
export const NIGHT_FALL_NOTICE =
  'Смеркается: деревни садятся у костров, зверьё выходит на охоту. До рассвета пара минут.'

/**
 * The threat-tier line, for a rise of the tier on the HUD.
 *
 * W2-1 — that tier is pacing: events, waves and drafts. Enemies only get tougher with the
 * clock (`getEnemyScalingTier`), so only a rise the clock paid for says «Враги сильнее». A
 * rise the run's progress earned says so, and promises attention rather than stats.
 */
export function describeThreatTier(
  tier: number,
  maxTier: number,
  cause: 'time' | 'progress' = 'time',
): string {
  if (cause === 'progress') {
    return `Про пользователя прослышали: угроза ${tier}/${maxTier}. Гостей и событий больше, и раздают уставы.`
  }
  return `Угроза растёт: уровень ${tier}/${maxTier}. Враги сильнее, событий и набегов больше.`
}

/**
 * W2-1 — the clock's tier rose under one the run had already earned: the HUD does not move,
 * but the enemies did, and that is the one change a player has to be told about.
 */
export function describeEnemiesStronger(clockTier: number, maxTier: number): string {
  return `Время берёт своё: враги крепче и бьют больнее — по часам угроза уже ${clockTier}/${maxTier}.`
}

export function describeThreatWave(spawned: number, tier: number): string {
  return `На пользователя набигают: ${formatRussianCount(spawned, [
    'враг',
    'врага',
    'врагов',
  ])}. Угроза: ${tier}.`
}

export function describeEventStarted(title: string, description: string): string {
  return `Событие: ${title}. ${description}`
}

export function describeReducedPersonalGold(fullGold: number, paidGold: number): string {
  return `Отряд справился без пользователя: в кошель ${String(paidGold)} из ${String(fullGold)} золотых.`
}

/**
 * The four fixed success lines; the champion's depends on how much damage it granted.
 *
 * W2-3 — the amounts are handed in from `WORLD_EVENT_REWARDS`, the table the engine pays
 * from and the contract cards price from, instead of being spelled inside the sentence.
 */
export function describeRandomEventSuccess(
  kind: Exclude<RandomWorldEventKind, 'champion'>,
  reward: { gold: number; heal: number },
  companionJoined = true,
): string {
  switch (kind) {
    case 'richCaravan':
      return `Богатый корован ограблен, погоня позади. +${reward.gold} золота.`
    case 'defendHome':
      return `Дом отбили! +${reward.gold} золота и +${reward.heal} здоровья.`
    case 'rescue':
      return companionJoined
        ? 'Пленник спасён и теперь идёт в твоём отряде.'
        : 'Пленник спасён и пошёл домой. В чужое войско его не записывают.'
    case 'bounty':
      return `Заказ выполнен, награда в кармане. +${reward.gold} золота.`
  }
}

export function describeChampionDefeated(gold: number, damageBonus: number): string {
  return damageBonus > 0
    ? `Чемпион побеждён! +${gold} золота и +${damageBonus} к урону.`
    : `Чемпион побеждён! +${gold} золота. Урон уже достиг предела.`
}

export function describeKillReward(
  kind: 'beast' | 'commander' | 'soldier',
  reward: number,
): string {
  if (kind === 'beast') {
    return `Зверьё стало на одну штуку тише. Шкура, конечно, тоже 3Д. +${reward} золота.`
  }
  if (kind === 'commander') return 'Командир дворца больше не командир.'
  return `Враг побеждён. Труп тоже 3Д. +${reward} золота.`
}

export function describeLimbLost(part: BodyPart): string {
  return part.includes('Eye')
    ? `Потерян ${formatBodyPart(part)}. Теперь пол-экрана не видно; ищи протез.`
    : `Потеряна ${formatBodyPart(part)}. Без лечения истечёшь кровью; самое хорошее — протез.`
}

export function describeWound(part: BodyPart): string {
  return `Ранение: ${formatBodyPart(part)}. Если не вылечить, станет хуже.`
}

// ---------------------------------------------------------------------------
// «Походная сводка» — the run epilogue
// ---------------------------------------------------------------------------

/**
 * The postcard.
 *
 * One entry point, `describeRunEpilogue`, renders both the panel and the copyable text, so
 * the thing a player pastes into a chat cannot drift from the thing they were shown. The
 * сводка stores kinds, roles and map squares; the sentences are written here and are free to
 * change without touching a single saved profile.
 *
 * There is no i18n layer and there is not going to be one — see the rejected ideas. These
 * lines are Russian because the game is.
 */

const ACTOR_ROLE_FORMS: Record<ActorRole, RussianCountForms> = {
  soldier: ['солдат', 'солдата', 'солдат'],
  scout: ['разведчик', 'разведчика', 'разведчиков'],
  commander: ['командир', 'командира', 'командиров'],
  minion: ['прихвостень', 'прихвостня', 'прихвостней'],
  archer: ['лучник', 'лучника', 'лучников'],
  brute: ['громила', 'громилы', 'громил'],
  champion: ['чемпион', 'чемпиона', 'чемпионов'],
  captive: ['пленник', 'пленника', 'пленников'],
  peasant: ['крестьянин', 'крестьянина', 'крестьян'],
  wolf: ['волк', 'волка', 'волков'],
  boar: ['кабан', 'кабана', 'кабанов'],
  bear: ['медведь', 'медведя', 'медведей'],
  troll: ['тролль', 'тролля', 'троллей'],
}

export function describeSquadRole(role: ActorRole): string {
  return role === 'captive' ? 'освобождённый' : ACTOR_ROLE_FORMS[role][0]
}

const WOUND_STATUS_NAMES: Record<RunEpilogueWound['status'], string> = {
  wounded: 'ранение',
  missing: 'нет',
  prosthetic: 'протез',
}

const EPILOGUE_TITLES: Record<ArchivedRunStatus, string> = {
  victory: 'Походная сводка: корованы ограблены',
  defeat: 'Походная сводка: труп тоже 3Д',
  abandoned: 'Походная сводка: поход бросили',
}

const EPILOGUE_STATUS_WORDS: Record<ArchivedRunStatus, string> = {
  victory: 'победа',
  defeat: 'поражение',
  abandoned: 'поход брошен',
}

const CONTROL_NAMES: Record<keyof RunEpilogueControl, string> = {
  elf: 'эльфы',
  guard: 'охрана',
  villain: 'злодей',
  neutral: 'ничьи',
}

/**
 * With no backend, "поделиться" is a file and a clipboard. Said in the interface rather than
 * in a design document, so nobody builds a button that needs a server that does not exist.
 */
export const EPILOGUE_SHARE_NOTE =
  'Сервера у нас нет и не будет: «поделиться» — это скачать картинку или скопировать текст и отправить самому.'

export const EPILOGUE_COPY_LABEL = 'Скопировать текст'
export const EPILOGUE_COPIED_LABEL = 'Скопировано'
export const EPILOGUE_COPY_FAILED_LABEL = 'Не вышло — выдели и скопируй руками'
export const EPILOGUE_IMAGE_LABEL = 'Скачать картинку'
export const EPILOGUE_IMAGE_FAILED_LABEL = 'Картинка не сохранилась'
export const EPILOGUE_EMPTY_NOTICE =
  'Сводка этого забега уже осыпалась: подробности хранятся только для последних походов.'

export function formatActorRole(role: ActorRole): string {
  return ACTOR_ROLE_FORMS[role][0]
}

/** `754` → `12:34`. The engine counts run time in seconds; a postcard does not. */
export function formatRunClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function describeEpilogueRoute(epilogue: RunEpilogue): string {
  if (epilogue.route.length === 0) {
    return 'Маршрут: с места так и не сдвинулись.'
  }
  const truncated = epilogue.routeTotal > epilogue.route.length
  const path = truncated
    ? `${epilogue.route.slice(0, -1).join(' → ')} → … → ${epilogue.route[epilogue.route.length - 1]}`
    : epilogue.route.join(' → ')
  const squares = formatRussianCount(epilogue.routeTotal, ['квадрат', 'квадрата', 'квадратов'])
  return `Маршрут: ${path} — ${squares} из ${epilogue.regionsTotal}.`
}

function describeEpilogueMap(epilogue: RunEpilogue): string {
  const parts = (Object.keys(CONTROL_NAMES) as (keyof RunEpilogueControl)[])
    .filter((territory) => epilogue.control[territory] > 0)
    .map((territory) => `${CONTROL_NAMES[territory]} — ${epilogue.control[territory]}`)
  return parts.length === 0
    ? 'Карта на конец: кто там теперь хозяин, разведка не доложила.'
    : `Карта на конец: ${parts.join(', ')}.`
}

function describeEpilogueBeat(beat: RunEpilogueBeat): string {
  return describeChronicleEvent(
    {
      kind: beat.kind,
      regionLabel: beat.region,
      faction: beat.faction,
      siteLabel: null,
    },
    `${beat.kind}:${beat.region}:${String(beat.tick)}`,
  )
}

function describeEpilogueBody(epilogue: RunEpilogue): string {
  const parts = epilogue.wounds.map(
    (wound) => `${formatBodyPart(wound.part)} — ${WOUND_STATUS_NAMES[wound.status]}`,
  )
  const bleeding = epilogue.bleeding ? ' Кровь так и не остановили.' : ''
  if (parts.length === 0) {
    return epilogue.bleeding
      ? `Тело: целое, но течёт.${bleeding}`
      : 'Тело: целое. Даже как-то неловко.'
  }
  const lost =
    epilogue.limbsLost > 0
      ? ` Всего потеряно частей: ${String(epilogue.limbsLost)}.`
      : ''
  return `Тело: ${parts.join(', ')}.${lost}${bleeding}`
}

function describeEpilogueSquad(epilogue: RunEpilogue): string {
  if (epilogue.companions.length === 0) return 'Отряд: до конца не дошёл никто.'
  const parts = epilogue.companions.map((companion) =>
    formatRussianCount(companion.count, ACTOR_ROLE_FORMS[companion.role]),
  )
  return `Отряд: ${parts.join(', ')} — дошли.`
}

/**
 * Roadmap 1.6 — the doctrines a run went out under, by name rather than by id.
 *
 * The сводка stores ids, because ids are what a save should hold; the words are chosen here
 * and are free to change without touching a profile. A run that drafted nothing still says
 * nothing at all — a heading with no rows under it is worse than silence.
 */
function describeEpilogueDoctrines(epilogue: RunEpilogue): string | null {
  if (epilogue.doctrines.length === 0) return null
  const names = epilogue.doctrines.map(
    (id) => getDoctrineDefinition(id)?.name ?? id,
  )
  return `Уставы: ${names.join(', ')}.`
}

function describeEpilogueCause(epilogue: RunEpilogue): string {
  const killer = epilogue.causeRole ? formatActorRole(epilogue.causeRole) : null
  switch (epilogue.cause) {
    case 'objectives':
      return 'Итог: все задачи закрыты. Летописцы уже преувеличивают.'
    case 'beast':
      return killer
        ? `Итог: пользователя доел ${killer}. Шкура, конечно, тоже 3Д.`
        : 'Итог: пользователя доело зверьё. Лес не спрашивал имени.'
    case 'faction':
      return killer
        ? `Итог: пользователя уронил ${killer}. Всё по-честному, в открытую.`
        : 'Итог: пользователя уронили чужие. Кто именно — не разглядели.'
    case 'bleeding':
      return killer
        ? `Итог: кровь не остановили. Начал это ${killer}, закончил сам пользователь.`
        : 'Итог: кровь не остановили. Никто не добивал — само дотекло.'
    case 'abandoned':
      return 'Итог: поход бросили на полпути. Мир как-нибудь сам.'
    case 'unknown':
      return 'Итог: здоровье кончилось, а протокол — нет. История умалчивает.'
  }
}

/**
 * W2-2 — what became of the run's caravans, by square and by how they ended. The guard's line
 * says «обозы»: it escorts and confiscates, it does not rob, and its сводка should not say so.
 */
function describeEpilogueCaravans(summary: RunHistorySummary, epilogue: RunEpilogue): string | null {
  const caravans = epilogue.caravans ?? []
  if (caravans.length === 0) return null
  const parts = caravans.map((caravan) =>
    `${caravan.region} ${CARAVAN_BEAT_PLACES[caravan.placement]} — ${describeCaravanBeatEnding(caravan.ending)}`)
  return `${summary.faction === 'guard' ? 'Обозы' : 'Корованы'}: ${parts.join('; ')}.`
}

function describeEpilogueTally(summary: RunHistorySummary, epilogue: RunEpilogue): string {
  return [
    `побед — ${String(summary.kills)}`,
    `золота — ${String(summary.endingGold)}`,
    `задач — ${String(summary.objectivesCompleted)}`,
    `серия — ${String(epilogue.bestKillStreak)}`,
    `корованов — ${String(epilogue.caravansRobbed)}`,
    `событий — ${String(epilogue.eventsCompleted)}`,
  ].join(' · ')
}

export interface RunEpilogueCopy {
  title: string
  subtitle: string
  route: string
  map: string
  beats: string[]
  body: string
  squad: string
  /** `null` when the run drafted no doctrines. Readers must render nothing. */
  doctrines: string | null
  /** W2-2 — `null` when no caravan beat settled. Readers must render nothing. */
  caravans: string | null
  cause: string
  tally: string
  /**
   * Roadmap 1.6 — the run's ruleset fingerprint, which is *not* the world's.
   *
   * A shared seed means one world; a shared seed **and** this value mean one run. The
   * postcard prints both because after 1.6 they are genuinely different questions, and a
   * share block that printed only the seed would be quietly claiming two runs were the same
   * when their doctrines made them different games.
   */
  ruleset: string
  /** The copyable seed-and-story block, exactly as the panel above reads. */
  text: string
}

export function describeRunEpilogue(
  summary: RunHistorySummary,
  epilogue: RunEpilogue,
): RunEpilogueCopy {
  const title = EPILOGUE_TITLES[summary.status]
  const subtitle = `seed ${String(summary.seed)} · ${CHRONICLE_FACTION_NAMES[summary.faction]} · ${
    EPILOGUE_STATUS_WORDS[summary.status]
  } · ${formatRunClock(epilogue.elapsed)}`
  const route = describeEpilogueRoute(epilogue)
  const map = describeEpilogueMap(epilogue)
  const beats = epilogue.beats.map(describeEpilogueBeat)
  const body = describeEpilogueBody(epilogue)
  const squad = describeEpilogueSquad(epilogue)
  const doctrines = describeEpilogueDoctrines(epilogue)
  const caravans = describeEpilogueCaravans(summary, epilogue)
  const cause = describeEpilogueCause(epilogue)
  const tally = describeEpilogueTally(summary, epilogue)
  const ruleset = computeRunRulesetFingerprint({
    seed: summary.seed,
    generatorVersion: summary.generatorVersion,
    faction: summary.faction,
    selectedBoonId: summary.selectedBoonId,
    doctrines: epilogue.doctrines,
  })
  const text = [
    'КОРОВАНЫ — походная сводка',
    subtitle,
    '',
    route,
    map,
    '',
    ...(beats.length > 0 ? ['Летопись:', ...beats.map((beat) => `· ${beat}`), ''] : []),
    body,
    squad,
    ...(doctrines ? [doctrines] : []),
    ...(caravans ? [caravans] : []),
    cause,
    '',
    tally,
    '',
    `Повторить этот мир: seed ${String(summary.seed)}, ${CHRONICLE_FACTION_NAMES[summary.faction]}.`,
    `Повторить этот забег: устав ${ruleset}.`,
  ].join('\n')
  return {
    title,
    subtitle,
    route,
    map,
    beats,
    body,
    squad,
    doctrines,
    caravans,
    cause,
    tally,
    ruleset,
    text,
  }
}

/**
 * W1-4 — the end screen's receipt: the profile reward, line by line, in the words the hint
 * promised. Amounts come from `computeRunCompletionRewardBreakdown`, so this file only names
 * them; it never recomputes a number the archive did not pay.
 */
export interface RunRewardLine {
  id: keyof Omit<RunCompletionRewardBreakdown, 'total'>
  label: string
  amount: number
}

export const RUN_REWARD_LINES_LABEL = 'Из чего сложилась награда'

const PROFILE_COIN_FORMS: RussianCountForms = ['монета', 'монеты', 'монет']

export function describeRunRewardLines(
  summary: RunCompletionRewardInput,
  breakdown: RunCompletionRewardBreakdown,
): RunRewardLine[] {
  const rules = RUN_COMPLETION_REWARD
  const kills = String(summary.kills)
  const gold = String(summary.endingGold)
  const objectiveSteps = rules.objectiveCap / rules.coinsPerObjective
  return [
    {
      id: 'completion',
      label: summary.status === 'victory' ? 'Суть выполнена' : 'Труп тоже 3Д — за попытку',
      amount: breakdown.completion,
    },
    {
      id: 'kills',
      label:
        breakdown.kills >= rules.killCap
          ? `Побед — ${kills}: больше ${String(rules.killCap)} за драки не платят`
          : summary.kills === 0
            ? 'Побед — 0: пацифизм не оплачивается'
            : `Побед — ${kills}: монета за каждые ${String(rules.killsPerCoin)}`,
      amount: breakdown.kills,
    },
    {
      id: 'objectives',
      label: `Суть такова: ${String(summary.objectivesCompleted)} из ${String(objectiveSteps)}`,
      amount: breakdown.objectives,
    },
    {
      id: 'gold',
      label:
        breakdown.gold >= rules.goldCap
          ? `Золото — ${gold}: больше ${String(rules.goldCap)} из кошелька не вытрясти`
          : summary.endingGold === 0
            ? 'Кошелёк пуст: всё ушло торговцу, как в Daggerfall'
            : breakdown.gold === 0
              ? `Золото — ${gold}: на монету не наскрёб`
              : `Золото — ${gold}: монета за десяток`,
      amount: breakdown.gold,
    },
  ]
}

/** The shop's line under the purse: what banking it is worth, at the same bounded rate. */
export function describePurseReward(coins: number): string {
  if (coins <= 0) return 'Десяток не набрался: профилю пока ничего.'
  const amount = `+${formatRussianCount(coins, PROFILE_COIN_FORMS)} профиля`
  return coins >= RUN_COMPLETION_REWARD.goldCap
    ? `Доживёт до конца похода — ${amount}, больше не дают.`
    : `Доживёт до конца похода — ${amount}.`
}

// ---------------------------------------------------------------------------
// Diegetic first-time lines
// ---------------------------------------------------------------------------

/**
 * One line per mechanic that owns a piece of the HUD, shown the first time the player
 * meets that mechanic and never again (`seenHints` on the profile).
 *
 * Not a tutorial: there is no mode, no modal and no ordering. Each line is attached to the
 * moment its HUD element first says something — the stamina line arrives when the bar
 * moves, the prosthetic line when a prosthetic is on, the threat line when the tier climbs
 * — because explaining stamina to somebody who has not spent any is worse than saying
 * nothing. `content/hints.ts` owns *when*; this file owns *what it says*.
 *
 * Same register as the rest of the game: in-fiction, self-ironic, never corporate. Each
 * line has to earn its place by telling the player something the HUD alone does not — what
 * the number is made of, what it costs, or what it will do next.
 */
export const FINALE_COPY = {
  huntsmaster: {
    name: 'Имперский ловчий',
    introduction: 'Ловчий вышел на след. Уходи с линии; после залпа сближайся.',
    transition: 'Ловчий меняет ритм: линия, веер, линия.',
  },
  warlord: {
    name: 'Воевода форта',
    introduction: 'Воевода держит проход. Шаг вбок от разгона, удар после промаха.',
    transition: 'Два тяжёлых замаха. После первого будет второй.',
  },
  marshal: {
    name: 'Маршал дворца',
    introduction: 'Маршал держит строй. Сними фланг — появится проход.',
    transition: 'Строй распущен. Маршал идёт вперёд сам.',
  },
} as const

export const FINALE_ATTACK_CUES = {
  fan: 'Три стрелы веером — между линиями',
  lane: 'Прицельная стрела — шаг вбок',
  cleave: 'Широкий замах — отступи или прикройся',
  charge: 'Разгон по прямой — уходи вбок',
  heavyCleave: 'Первый замах — не спеши отвечать',
  heavySlam: 'Второй удар — узкая полоса впереди',
  commandSweep: 'Фронтальный взмах — зайди с фланга',
  advance: 'Натиск — освободи полосу',
  press: 'Последний взмах — потом отвечай',
} as const

export const FINALE_RECOVERY_CUE = 'Открыт — время ответить'
export const FINALE_RESUME_CUE = 'Противник готовится. Смотри на новый замах.'
export const FINALE_POSITIONING_CUE = 'Меняет позицию'
export const FINALE_SUSPENDED_CUE = 'Бой приостановлен — здоровье сохранено'
export const FINALE_DEFEATED_CUE = 'Противник повержен. Поход завершён.'

export function describeFinaleDefeat(profile: keyof typeof FINALE_COPY): string {
  return `${FINALE_COPY[profile].name}: ${FINALE_DEFEATED_CUE}`
}
export const FINALE_RESTORE_WARNING =
  'Запись финального боя повреждена: состояние отвергнуто. Отметки побед сохранены.'
/** W3-4 — a saved remnant block that could not be trusted: every pack is fielded whole again. */
export const ENCOUNTER_REMNANTS_SAVE_WARNING =
  'Запись о недобитых отрядах повреждена: в своих квадратах они встанут в полном составе. Поход продолжается.'

export type HintId =
  | 'health'
  | 'stamina'
  | 'bleeding'
  | 'limbLoss'
  | 'prosthetic'
  | 'gold'
  | 'upgrades'
  | 'shopPrices'
  | 'zone'
  | 'objectives'
  | 'interact'
  | 'map'
  | 'expedition'
  | 'caravanSpine'
  | 'bridgeAmbush'
  | 'caravanLoot'
  | 'chronicle'
  | 'rumours'
  | 'contracts'
  | 'exclusive'
  | 'doctrines'
  | 'squad'
  | 'squadCare'
  | 'threat'
  | 'threatEarned'
  | 'ability'
  | 'melee'
  | 'evade'
  | 'perfectGuard'
  | 'cameraFallback'
  | 'finale'
  | 'events'
  | 'loot'

export interface HintCopy {
  readonly text: string
  readonly tone: NoticeTone
}

const HINT_COPY: Record<HintId, HintCopy> = {
  health: {
    text: 'Здоровье само не зарастает: лечат паёк, торговец и трофеи. Полоска слева — весь запас пользователя.',
    tone: 'warning',
  },
  stamina: {
    text: 'Выносливость уходит на бег, прыжки и приёмы. Кончится — останется ходить пешком и т. п.',
    tone: 'info',
  },
  bleeding: {
    text: 'Кровь идёт сама, без твоего участия, и здоровье капает вместе с ней. Останавливают паёк и лекарь, а не характер.',
    tone: 'danger',
  },
  limbLoss: {
    text: 'Оторванное не отрастает: без руки бьёшь слабее, без ноги ходишь медленнее, без глаза видишь полмира. Помогает только протез у торговца.',
    tone: 'danger',
  },
  prosthetic: {
    text: 'Протез встал на место. Не как родное, но держит: штраф меньше, чем был, и картинка снова 3-хмерная.',
    tone: 'success',
  },
  gold: {
    text: 'Золото тратится у торговца: лечение, протезы, заточка. Что доживёт до конца забега, вернётся монетами профиля — монета за десяток, но не больше 15 за поход.',
    tone: 'success',
  },
  upgrades: {
    text: 'Улучшение живёт до конца забега, не дольше. Число с мечом слева — это оно и есть.',
    tone: 'success',
  },
  shopPrices: {
    text: 'Торговцы прослышали, кто тут ходит, и подняли цены. Чем громче забег, тем дороже лечиться.',
    tone: 'warning',
  },
  zone: {
    text: 'Новая область — свои хозяева, своё зверьё и свои цены. Смотреть, куда зашёл, полезно.',
    tone: 'info',
  },
  objectives: {
    text: 'Список «Суть такова» слева — весь смысл забега. Закроешь его — победа, и корован ушёл не зря. Не каждый пункт обязателен: часть закрывается тем, что ты выбрал другую дорогу.',
    tone: 'success',
  },
  interact: {
    text: 'Подсказка внизу означает, что рядом есть на что нажать E: торговец, тайник или корован.',
    tone: 'info',
  },
  map: {
    text: 'Карта открывается ногами: где прошёл, то и видно. Точки на ней — свои, чужие и корованы.',
    tone: 'info',
  },
  expedition: {
    text: 'Компас сам ведёт по дорогам и мостам. M или карта — атлас: другая цель там не значит «взяться за слух». Пунктир в тумане — неизведанная дорога, а подход к ней ещё надо пройти самому.',
    tone: 'info',
  },
  caravanSpine: {
    text: 'Корован выбран — поход начался. Штурм откроется после двух корованов, чем бы они ни кончились: следующие ждут на дороге к цели, компас подскажет.',
    tone: 'info',
  },
  bridgeAmbush: {
    text: 'Корован — не декорация: сначала бой, потом выбор. Эльф забирает груз или отдаёт домикам, охрана ведёт обоз по приказу, злодей грабит, забривает или жжёт. Исход меняет цены в лавке.',
    tone: 'info',
  },
  caravanLoot: {
    text: 'Полоска внизу — кто-то грузит корован. Удар по мародёру сбивает погрузку, а кто первым у телеги, того и груз. Охрана дворца тут не грабит, а отбивает.',
    tone: 'warning',
  },
  chronicle: {
    text: 'Хроника справа — то, что мир делает без пользователя. Пока ты идёшь, кого-то уже грабят.',
    tone: 'info',
  },
  rumours: {
    text: 'Слух — где мир спрашивает, а не докладывает. Взяться можно за один: провести корован, постоять в квадрате, сжечь склад. На карточке — путь, срок и плата. Пройдёшь мимо — случится и без тебя.',
    tone: 'info',
  },
  contracts: {
    text: 'Пунктов открылось несколько, один из них — подряд твоей стороны. На карточке плата, срок, дорога и где опасно. Обязательные закроешь в любом порядке.',
    tone: 'info',
  },
  exclusive: {
    text: 'Один пункт закрылся сам, зачёркнутым: ты пошёл другой дорогой, и туда уже не надо. Помеченные «или — или» — это развилка, а не очередь, и забег засчитается без того, что ты прошёл мимо.',
    tone: 'warning',
  },
  doctrines: {
    text: 'Устав меняет правило, а не число: что-то даёт и что-то забирает. Раздача приходит с угрозой — за закрытые пункты, а кто тянет, тому по часам, — и принятое уже не меняется.',
    tone: 'info',
  },
  squad: {
    text: 'Q — следом или держать место, T — все приказы: выбрать цель или собрать отряд. Полоса показывает живых спутников; «далеко» не значит «погиб».',
    tone: 'success',
  },
  squadCare: {
    text: 'Спутников тоже лечат: в T выбери раненого рядом и потрать паёк, у торговца направь полевой набор, а у лекаря всего два лечения на поход.',
    tone: 'success',
  },
  threat: {
    text: 'Угроза в углу растёт по часам, раз в три минуты, и тогда враги крепчают. Закрытые пункты поднимают её раньше, но это гости и события, а не сила врагов.',
    tone: 'warning',
  },
  // W2-1 — for every profile, including the ones that learned the old rule: the first time
  // the tier on the HUD is one the run earned rather than one the clock paid for.
  threatEarned: {
    text: 'Угрозу ты заработал: за закрытый пункт гостей и событий больше и раздают уставы. А крепчают враги только по часам — раз в три минуты.',
    tone: 'warning',
  },
  ability: {
    text: 'Эльф: держи ПКМ/R — прицел, ЛКМ — выстрел за 15 выносливости. Отпусти — клинок. Охрана держит щит, злодей делает рывок. Полоска — перезарядка.',
    tone: 'info',
  },
  melee: {
    text: 'Удар идёт в три замаха: два лёгких, третий — добивание. Он ест выносливость и ломает стойку, но с него уже не сойти. Первые два можно бросить бегом, прыжком, приёмом или уворотом на C.',
    tone: 'info',
  },
  evade: {
    text: 'C и направление — шаг из-под удара за 25 выносливости; без направления — назад. Защищает лишь середина шага. Стена остановит ноги, а кровь всё равно идёт.',
    tone: 'info',
  },
  perfectGuard: {
    text: 'Подними щит перед самым ударом в лицо: точный блок съест 12 выносливости, но не здоровье. Один раз за подъём; стрелку через полкарты сдачи не даст.',
    tone: 'info',
  },
  cameraFallback: {
    text: 'Без захвата мыши тоже воюют: тяни по миру для обзора, щёлкай для удара. На сенсорном экране одна рука ведёт героя кнопками, другая поворачивает мир.',
    tone: 'info',
  },
  finale: {
    text: 'Финальный противник показывает замах на земле. Шагни из полосы, прикройся щитом или зайди с отрядом сбоку. После удара он открыт; на половине здоровья меняет тактику, но не лечится.',
    tone: 'warning',
  },
  events: {
    text: 'События идут по таймеру и заканчиваются без тебя тоже. Успел — забрал награду, ушёл из квадрата — прочитаешь в хронике.',
    tone: 'info',
  },
  loot: {
    text: 'С павших падает добыча. Монеты идут в кошелёк сразу, остальное лечит или точит.',
    tone: 'success',
  },
}

export const HINT_IDS = Object.keys(HINT_COPY) as readonly HintId[]

export function isHintId(value: unknown): value is HintId {
  return typeof value === 'string' && Object.hasOwn(HINT_COPY, value)
}

export function describeHint(id: HintId): HintCopy {
  return HINT_COPY[id]
}

export const EXPEDITION_COPY = {
  title: 'Атлас похода',
  open: 'Открыть атлас похода',
  close: 'Закрыть атлас',
  paused: 'Поход на паузе',
  intro: 'Выбери, куда идти. Маршрут не принимает слух и не закрывает подряд.',
  fit: 'Весь мир',
  zoomIn: 'Приблизить карту',
  zoomOut: 'Отдалить карту',
  pan: 'Карту можно двигать пальцем или мышью. Все цели доступны в списке.',
  destinations: 'Куда идём',
  empty: 'Известных целей пока нет.',
  clear: 'Убрать маршрут',
  selected: 'Путь выбран',
  select: 'Проложить путь',
  followed: 'Компас и так ведёт сюда',
  shortest: 'Короткий',
  cautious: 'Осторожный',
  sameRoute: 'Другого пути с меньшей известной опасностью нет.',
  riskPolicy: 'Осторожный путь учитывает только известных врагов и спорные земли. Неизведанное не считается безопасным.',
  fog: 'Объезд проходит через туман. Для этой точки доступен только ориентир; карту открывают ногами.',
  bearing: 'По прямой, не дорога',
  directMeters: 'м по прямой: цель рядом, воды на пути нет',
  directApproach: 'Подход не проверен: проверено только, что на прямой нет воды.',
  noRoute: 'Дорожный путь недоступен. Компас — только направление, не проход через воду.',
  noSelection: 'Цель не выбрана',
  approach: 'Подход не проверен: обходи воду и препятствия.',
  road: 'Дорога',
  river: 'Река',
  bridge: 'Мост',
  unscouted: 'Пунктир: неизведанный путь',
  connector: 'Точки: непроверенный подход',
  knownRisk: 'Известные опасные регионы',
  unknownRegions: 'Неизведанные регионы',
  neutral: 'Люди',
  exclusive: 'Или — или: другой подряд закроется',
  committed: 'Уже выбран на доске',
  objective: 'Пункт похода',
  rumour: 'Слух',
  site: 'Открытая точка',
  caravanBeat: 'Корован',
  arrive: 'Ты у цели. Действие — отдельно.',
  nextBridge: 'Через мост',
  nextRoad: 'По дороге',
  nextApproach: 'Выход к дороге',
  nextDestination: 'Подход к цели',
  unknown: 'Неизведано',
  directions: 'Север сверху',
  legend: 'Условные обозначения',
  atlas: 'Атлас',
  meters: 'м',
  roadMeters: 'м дороги',
  approachMeters: 'м подхода',
  straightMeters: 'м по прямой',
  seconds: 'с',
  regions: 'регионов',
  itinerary: 'Путь по регионам',
  routeOptions: 'Выбор дороги',
  destination: 'Цель',
  map: 'Карта',
  targets: 'Цели',
  atlasPane: 'Раздел атласа',
} as const

export const EXPEDITION_TARGET_UNAVAILABLE_NOTICE = 'Эта цель уже недоступна. Открой атлас и выбери действующую.'
export const EXPEDITION_PREFERENCE_INVALID_NOTICE = 'Неизвестный способ прокладки пути.'
export const GENERATED_ACTION_UNAVAILABLE_NOTICE = 'Это действие сейчас недоступно.'

export function describeExpeditionNotice(notice: 'invalid-save' | 'stale-target'): string {
  return notice === 'invalid-save'
    ? 'Сохранённый маршрут повреждён или другой версии. Компас снова указывает на пункт похода.'
    : 'Выбранная цель завершена, закрыта или больше неизвестна. Компас вернулся к текущему пункту похода.'
}

/** W3-6b — the loot toast's rarity words, now the small line of a find's notice. */
export const LOOT_RARITY_LABELS: Readonly<Record<LootRarity, string>> = {
  common: 'Обычная',
  uncommon: 'Необычная',
  rare: 'Редкая',
  legendary: 'Легендарная',
}

/** The three lines an achievement or a find shows in the notice lane. */
export interface NoticeArtCopy {
  label: string
  title: string
  detail: string
  /** The same lines as one sentence: the notice's text in the log and its merge key. */
  message: string
}

/** W3-6b — an unlocked achievement as a notice: the old banner's three lines. */
export function describeAchievementNotice(rarityLabel: string, name: string, description: string): NoticeArtCopy {
  const label = `Достижение открыто · ${rarityLabel}`
  return { label, title: name, detail: description, message: `${label}. ${name}. ${description}` }
}

/** W3-6b — a find as a notice: the old loot toast's three lines. */
export function describeLootNotice(toast: Pick<LootToastView, 'rarity' | 'title' | 'detail'>): NoticeArtCopy {
  const label = `${LOOT_RARITY_LABELS[toast.rarity]} награда`
  return { label, title: toast.title, detail: toast.detail, message: `${label}. ${toast.title}. ${toast.detail}` }
}