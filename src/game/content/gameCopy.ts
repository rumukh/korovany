import { SITE_PRESENTATIONS } from './registry.ts'
import type { ChronicleWorldEventKind, Faction, NoticeTone, RandomWorldEventKind } from '../types.ts'
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
  | 'chronicle'
  | 'squad'
  | 'threat'
  | 'ability'
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
    text: 'Золото тратится у торговца: лечение, протезы, заточка. Что доживёт до конца забега, вернётся монетами профиля — на них открываются припасы к следующему.',
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
    text: 'Список «Суть такова» слева — весь смысл забега. Закроешь все пункты — победа, и корован ушёл не зря.',
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
  chronicle: {
    text: 'Хроника справа — то, что мир делает без пользователя. Пока ты идёшь, кого-то уже грабят.',
    tone: 'info',
  },
  squad: {
    text: 'Рядом свои, и счётчик с человечком слева считает живых. Q переключает приказ: идти следом или держать место.',
    tone: 'success',
  },
  threat: {
    text: 'Угроза в углу растёт от времени, а не от подвигов. Чем дольше забег, тем злее гости.',
    tone: 'warning',
  },
  ability: {
    text: 'Приём (ПКМ или R) не бесплатный: ест выносливость и уходит на перезарядку. Полоска под иконкой — сколько ждать.',
    tone: 'info',
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

