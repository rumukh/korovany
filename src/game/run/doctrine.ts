/**
 * Roadmap 1.6 — the in-run doctrine draft.
 *
 * **Rules, not stats.** Every card here changes *when*, *where* or *whether* something
 * happens. None of them adds a number to an existing scalar, and that is the rule the
 * catalogue is checked against rather than a preference: the thing this initiative replaces
 * is `BOON_CATALOGUE`, six flat scalars merged by spread, none of which reads any other. A
 * doctrine that granted +10 damage would be the seventh.
 *
 * **Sidegrades only, and a hard slot cap.** Interaction explosion and power creep are the
 * named risk. Every card gives something and takes something, and `equipDoctrine` refuses
 * the fourth — in mechanics, not in the panel, because a cap the UI enforces is a cap that
 * a second caller can walk around.
 *
 * Three properties this file exists to hold:
 *
 * 1. **The offer is keyed on the seed and the draft index, and on nothing else.** It never
 *    touches the run's persisted streams — `combat`, `director`, `event`, `loot`,
 *    `chronicle`, `rumour` — because drawing from one of them would shift every subsequent
 *    encounter or loot roll as a side effect of a panel opening. `rollDoctrineOffer` builds
 *    its own `RandomStream` from a `gameplay:doctrine:<index>` derivation and throws it
 *    away, so the same seed and the same index give the same three cards on the first frame,
 *    after a reload, and in a test.
 * 2. **Nothing here is a `WorldBlueprint` input.** The doctrine set identifies a *run*, not
 *    a world; the fingerprint that carries it lives in `run/ruleset.ts` and is deliberately
 *    a different value from `blueprintFingerprint`.
 * 3. **The pool is profile state.** Ids live in `unlockedContentIds`, a field that has
 *    existed since the first profile and, until this initiative, was never written.
 */

import { RandomStream } from '../random/RandomStream.ts'
import { deriveSeed, type SeedInput } from '../random/seed.ts'
import type { ProfileSaveV1 } from './runTypes.ts'

/**
 * What a doctrine actually changes, as a set of rules the engine reads.
 *
 * Booleans on purpose. A number here would be the first step back towards the flat-scalar
 * boons this initiative exists to replace, and `tests/doctrines.test.ts` asserts that every
 * field of this shape is a boolean.
 */
export interface DoctrineEffects {
  /** `vanguard` — threat waves stop arriving on the clock and arrive on a closed objective. */
  threatWavesOnObjective: boolean
  /** `quartermaster` — the trader sells no upgrades, and the scarcity surcharge never rises. */
  tradeOnlyCare: boolean
  /** `pathfinder` — entering a square reveals its neighbours; living bodies leave the minimap. */
  scoutedHorizon: boolean
  /** `beast-truce` — beasts ignore an unstruck player, and no morale check ever breaks. */
  beastTruce: boolean
  /** `iron-ration` — a ration is spent the instant blood starts, and cannot be eaten by hand. */
  rationOnBleed: boolean
  /** `forced-march` — sprinting costs nothing; standing still returns nothing. */
  forcedMarch: boolean
}

export interface DoctrineDefinition {
  readonly id: string
  readonly name: string
  /** The rule that changes. One sentence, in the imperative of the world. */
  readonly rule: string
  /** What the run gains. */
  readonly gives: string
  /** What the run gives up. Never empty — a card with no cost is not a sidegrade. */
  readonly takes: string
  readonly unlockCost: number
  readonly defaultUnlocked: boolean
  readonly effect: keyof DoctrineEffects
}

/**
 * The pool.
 *
 * Six cards against three slots, so a draft is a choice rather than an inventory. Three are
 * open from the first run — otherwise a new player would never see the mechanic that
 * explains what profile currency is *for* — and three are bought, which is what gives the
 * currency somewhere to go once the boons are all open at 210.
 */
export const DOCTRINE_CATALOGUE = [
  {
    id: 'vanguard',
    name: 'Устав дозора',
    rule: 'Волны угрозы перестают приходить по часам и приходят на закрытый пункт.',
    gives: 'Дорога тихая: пока идёшь, никто не набигает по расписанию.',
    takes: 'Зато каждый закрытый пункт заканчивается дракой — по нынешней угрозе.',
    unlockCost: 0,
    defaultUnlocked: true,
    effect: 'threatWavesOnObjective',
  },
  {
    id: 'quartermaster',
    name: 'Интендантский устав',
    rule: 'Торговец больше не продаёт улучшения, зато накрутка за нехватку товара не растёт.',
    gives: 'Лечение и протезы стоят одинаково весь забег, где бы ты ни встал.',
    takes: 'Ни клинка, ни сердца, ни выучки: забег кончится с тем, с чем начался.',
    unlockCost: 0,
    defaultUnlocked: true,
    effect: 'tradeOnlyCare',
  },
  {
    id: 'forced-march',
    name: 'Устав скорого шага',
    rule: 'Бег не ест выносливость, но на месте она не восстанавливается.',
    gives: 'Бежать можно сколько угодно — ноги казённые.',
    takes: 'Отсидеться и отдышаться не выйдет: стоишь — не восстанавливаешься.',
    unlockCost: 0,
    defaultUnlocked: true,
    effect: 'forcedMarch',
  },
  {
    id: 'pathfinder',
    name: 'Устав следопыта',
    rule: 'Зашёл в квадрат — соседние открылись сами; зато на карте больше нет живых тел.',
    gives: 'Карта открывается на шаг вперёд, а не по факту прихода.',
    takes: 'Кто там за холмом — свои, чужие или волки — карта молчит.',
    unlockCost: 60,
    defaultUnlocked: false,
    effect: 'scoutedHorizon',
  },
  {
    id: 'iron-ration',
    name: 'Устав сухого пайка',
    rule: 'Паёк уходит сам, как только пошла кровь, и останавливает её. Руками его не съесть.',
    gives: 'Кровь больше не утекает незамеченной: паёк срабатывает сам.',
    takes: 'Подлечиться пайком по своему усмотрению нельзя — он ждёт крови.',
    unlockCost: 85,
    defaultUnlocked: false,
    effect: 'rationOnBleed',
  },
  {
    id: 'beast-truce',
    name: 'Устав звериного перемирия',
    rule: 'Зверьё не трогает того, кто не тронул его. Зато ни у кого больше не сдают нервы.',
    gives: 'Лес пропускает: волк проходит мимо, пока ты не махнул первым.',
    takes: 'И свои, и чужие бьются до конца — бежать с поля больше некому.',
    unlockCost: 110,
    defaultUnlocked: false,
    effect: 'beastTruce',
  },
] as const satisfies readonly DoctrineDefinition[]

export type DoctrineId = (typeof DOCTRINE_CATALOGUE)[number]['id']

/** Open from the first run, so the draft exists before any currency has been earned. */
export const DEFAULT_DOCTRINE_IDS = DOCTRINE_CATALOGUE.filter(
  (definition) => definition.defaultUnlocked,
).map((definition) => definition.id)

/**
 * The hard slot cap. Three, and the roadmap's mitigation for the named risk.
 *
 * Enforced by `equipDoctrine` returning false rather than by a disabled button, because the
 * engine, a restored save and a test are all callers and only one of them has a button.
 */
export const MAX_EQUIPPED_DOCTRINES = 3

/**
 * When a draft opens, in `threatTier`.
 *
 * `getThreatTier` is `min(5, 1 + floor(elapsed / 180))`, so tiers 2, 3 and 4 are three, six
 * and nine minutes. The anchor is deliberately the tier and not a timer of this feature's
 * own: the tier already exists, is already persisted in `directorState` and already paces
 * the run, so the draft lands on beats the player is already feeling.
 */
export const DOCTRINE_DRAFT_TIERS = [2, 3, 4] as const

/** Cards on the table at one draft. Fewer only when the pool has run short. */
export const DOCTRINE_OFFER_SIZE = 3

const NO_DOCTRINE_EFFECTS: DoctrineEffects = {
  threatWavesOnObjective: false,
  tradeOnlyCare: false,
  scoutedHorizon: false,
  beastTruce: false,
  rationOnBleed: false,
  forcedMarch: false,
}

export function isDoctrineId(value: unknown): value is DoctrineId {
  return (
    typeof value === 'string' &&
    DOCTRINE_CATALOGUE.some((definition) => definition.id === value)
  )
}

export function getDoctrineDefinition(
  doctrineId: string | null | undefined,
): DoctrineDefinition | null {
  if (!isDoctrineId(doctrineId)) return null
  return DOCTRINE_CATALOGUE.find((definition) => definition.id === doctrineId) ?? null
}

/**
 * The rules a set of equipped ids adds up to.
 *
 * A plain fold with no ordering and no interaction between cards: the effects are disjoint
 * by construction — one card, one field — which is the cheapest available answer to
 * "interaction explosion". Unknown ids are ignored rather than fatal, so a save written by a
 * build that shipped a card this one does not have loses the rule instead of the run.
 */
export function resolveDoctrineEffects(
  equipped: Iterable<string>,
): DoctrineEffects {
  const effects: DoctrineEffects = { ...NO_DOCTRINE_EFFECTS }
  for (const id of equipped) {
    const definition = getDoctrineDefinition(id)
    if (definition) effects[definition.effect] = true
  }
  return effects
}

// ---------------------------------------------------------------------------
// The profile pool
// ---------------------------------------------------------------------------

/**
 * Which cards this profile may draft.
 *
 * `unlockedContentIds` is the store, and the defaults are folded in on read rather than
 * written at profile creation, so a profile that predates this initiative gains the three
 * open cards without a migration — the same shape `unlockedBoonIds` uses for its own
 * defaults.
 */
export function getUnlockedDoctrineIds(
  profile: Pick<ProfileSaveV1, 'unlockedContentIds'>,
): DoctrineId[] {
  const unlocked = new Set<string>([...DEFAULT_DOCTRINE_IDS, ...profile.unlockedContentIds])
  return DOCTRINE_CATALOGUE.filter((definition) => unlocked.has(definition.id)).map(
    (definition) => definition.id,
  )
}

export function isDoctrineUnlocked(
  profile: Pick<ProfileSaveV1, 'unlockedContentIds'>,
  doctrineId: string,
): doctrineId is DoctrineId {
  return isDoctrineId(doctrineId) && getUnlockedDoctrineIds(profile).includes(doctrineId)
}

export type DoctrineUnlockStatus =
  | 'unlocked'
  | 'already-unlocked'
  | 'unknown-doctrine'
  | 'insufficient-currency'

export interface DoctrineUnlockResult {
  status: DoctrineUnlockStatus
  profile: ProfileSaveV1
  cost: number
}

/** Spends profile currency into `unlockedContentIds`. Mirrors `unlockBoon` exactly. */
export function unlockDoctrine(
  profile: ProfileSaveV1,
  doctrineId: string,
): DoctrineUnlockResult {
  const definition = getDoctrineDefinition(doctrineId)
  const copy: ProfileSaveV1 = {
    ...profile,
    unlockedBoonIds: [...profile.unlockedBoonIds],
    unlockedContentIds: [...new Set(profile.unlockedContentIds)],
    unlockedCosmeticIds: [...profile.unlockedCosmeticIds],
    runHistory: profile.runHistory.map((summary) => ({ ...summary })),
    finalizedRunIds: [...profile.finalizedRunIds],
    seenHints: [...profile.seenHints],
  }
  if (!definition) return { status: 'unknown-doctrine', profile: copy, cost: 0 }
  if (isDoctrineUnlocked(copy, definition.id)) {
    return { status: 'already-unlocked', profile: copy, cost: 0 }
  }
  if (copy.profileCurrency < definition.unlockCost) {
    return { status: 'insufficient-currency', profile: copy, cost: definition.unlockCost }
  }
  copy.profileCurrency -= definition.unlockCost
  copy.unlockedContentIds.push(definition.id)
  return { status: 'unlocked', profile: copy, cost: definition.unlockCost }
}

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

export interface DoctrineOfferInput {
  /** The run's world seed. The only entropy an offer ever reads. */
  seed: SeedInput
  /** 0, 1 or 2 — which of the three drafts this is. */
  draftIndex: number
  /** The ids this run may draft, snapshotted at launch. */
  pool: readonly string[]
  /** Already equipped, and therefore off the table. */
  equipped: readonly string[]
}

/**
 * The three cards on the table, for one seed and one draft.
 *
 * **Its own entropy, and no side effects.** The dedicated `gameplay:doctrine:<index>`
 * derivation is the whole of warning 2 in `docs/STRATEGY.md`: a shuffle taken from the
 * event stream would move the next encounter roll, so the offer would change the world
 * simply by being looked at. This builds a stream, shuffles, and drops it — nothing is
 * persisted in `rngStates` and nothing else advances, which is what
 * `tests/doctrines.test.ts` asserts by snapshotting the run's six streams around a call.
 *
 * Recomputed rather than stored, so a reload cannot disagree with the frame before it.
 */
export function rollDoctrineOffer(input: DoctrineOfferInput): DoctrineId[] {
  const index = Math.max(0, Math.trunc(input.draftIndex))
  const equipped = new Set(input.equipped)
  const available = DOCTRINE_CATALOGUE.filter(
    (definition) => input.pool.includes(definition.id) && !equipped.has(definition.id),
  ).map((definition) => definition.id)
  if (available.length === 0) return []
  const stream = new RandomStream(deriveSeed(input.seed, `gameplay:doctrine:${String(index)}`))
  return stream.shuffle(available).slice(0, DOCTRINE_OFFER_SIZE)
}

// ---------------------------------------------------------------------------
// The run state
// ---------------------------------------------------------------------------

/**
 * The doctrine ledger, as it rides in `directorState`.
 *
 * Three fields and nothing derived. `pool` is snapshotted at launch so unlocking a card at
 * the menu between a checkpoint and a continue cannot rewrite an open offer; `anchors`
 * counts draft points crossed rather than storing the offer, because an offer that is
 * recomputed cannot drift from the one the player was shown.
 */
export interface DoctrineRunState {
  pool: DoctrineId[]
  equipped: DoctrineId[]
  /** Draft points the threat tier has crossed, 0..3. */
  anchors: number
}

export function createDoctrineRunState(pool: readonly string[]): DoctrineRunState {
  return {
    pool: DOCTRINE_CATALOGUE.filter((definition) => pool.includes(definition.id)).map(
      (definition) => definition.id,
    ),
    equipped: [],
    anchors: 0,
  }
}

export function cloneDoctrineRunState(state: DoctrineRunState): DoctrineRunState {
  return { pool: [...state.pool], equipped: [...state.equipped], anchors: state.anchors }
}

/**
 * Opens a draft for every anchor tier the run has now reached.
 *
 * Idempotent and monotonic: it is called every frame, it never re-opens a draft a restore
 * already counted, and a run that jumps two tiers while a tab was in the background still
 * owes the player two drafts rather than one.
 */
export function advanceDoctrineAnchors(
  state: DoctrineRunState,
  threatTier: number,
): boolean {
  const reached = DOCTRINE_DRAFT_TIERS.filter((tier) => threatTier >= tier).length
  if (reached <= state.anchors) return false
  state.anchors = reached
  return true
}

/**
 * Whether a draft is waiting, and which index it is.
 *
 * The index is the equipped count rather than the anchor count, which is what makes an
 * ignored offer wait instead of stacking: a player who walks past the first draft meets it
 * again, still as draft one, and the third card is still the third card.
 */
export function pendingDoctrineDraftIndex(state: DoctrineRunState): number | null {
  if (state.equipped.length >= MAX_EQUIPPED_DOCTRINES) return null
  if (state.anchors <= state.equipped.length) return null
  return state.equipped.length
}

/** The cards on the table right now, or an empty list when no draft is open. */
export function getDoctrineOffer(
  state: DoctrineRunState,
  seed: SeedInput,
): DoctrineId[] {
  const index = pendingDoctrineDraftIndex(state)
  if (index === null) return []
  return rollDoctrineOffer({
    seed,
    draftIndex: index,
    pool: state.pool,
    equipped: state.equipped,
  })
}

/**
 * Takes a card, and refuses every reason it should be refused.
 *
 * The slot cap lives here rather than in the panel. So does "it has to be on the table":
 * without that check the mechanic would be a menu of everything unlocked, and the draft —
 * the thing that makes two runs differ — would be decoration.
 */
export function equipDoctrine(
  state: DoctrineRunState,
  seed: SeedInput,
  doctrineId: string,
): boolean {
  if (!isDoctrineId(doctrineId)) return false
  if (state.equipped.length >= MAX_EQUIPPED_DOCTRINES) return false
  if (state.equipped.includes(doctrineId)) return false
  if (!getDoctrineOffer(state, seed).includes(doctrineId)) return false
  state.equipped.push(doctrineId)
  return true
}

/**
 * Reads the ledger back off a save, dropping anything it does not recognise.
 *
 * Same policy as 1.3's commitments and 1.4's contracts rather than the save-level
 * discard-and-report one: this is a field inside a free-form bag, so a card written by a
 * build that knew an id this one does not is forgotten, not fatal. The cap is re-applied on
 * the way in, because a hand-edited `localStorage` is a caller too.
 */
export function normalizeDoctrineRunState(value: unknown): DoctrineRunState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return createDoctrineRunState(DEFAULT_DOCTRINE_IDS)
  }
  const record = value as Record<string, unknown>
  const pool = Array.isArray(record.pool) ? record.pool : []
  const equippedRaw = Array.isArray(record.equipped) ? record.equipped : []
  const state = createDoctrineRunState(pool.filter(isDoctrineId))
  for (const id of equippedRaw) {
    if (!isDoctrineId(id)) continue
    if (state.equipped.includes(id)) continue
    if (state.equipped.length >= MAX_EQUIPPED_DOCTRINES) break
    state.equipped.push(id)
    if (!state.pool.includes(id)) state.pool.push(id)
  }
  const anchors =
    typeof record.anchors === 'number' && Number.isFinite(record.anchors)
      ? Math.max(0, Math.min(DOCTRINE_DRAFT_TIERS.length, Math.trunc(record.anchors)))
      : 0
  // A ledger that says fewer anchors than cards would hide the next draft forever.
  state.anchors = Math.max(anchors, state.equipped.length)
  return state
}

/** The JSON that goes into `directorState`. Bounded by the catalogue and the slot cap. */
export function serializeDoctrineRunState(
  state: DoctrineRunState,
): Record<string, unknown> {
  return {
    pool: [...state.pool],
    equipped: [...state.equipped],
    anchors: state.anchors,
  }
}
