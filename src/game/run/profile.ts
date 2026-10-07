import type { ProfileSaveV1, RunHistorySummary } from './runTypes'

export interface BoonStartingEffects {
  startingHealthBonus: number
  startingStaminaBonus: number
  startingGoldBonus: number
  startingSupplyCount: number
  revealAdjacentRegions: boolean
  startingDamageBonus: number
}

export interface BoonDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly unlockCost: number
  readonly defaultUnlocked: boolean
  readonly effects: Readonly<Partial<BoonStartingEffects>>
}

export const BOON_CATALOGUE = [
  {
    id: 'provisions',
    name: 'Припасы',
    description: 'В начале забега в котомке лежит один дорожный паёк.',
    unlockCost: 0,
    defaultUnlocked: true,
    effects: { startingSupplyCount: 1 },
  },
  {
    id: 'scout-map',
    name: 'Карта разведчика',
    description: 'Соседние регионы сразу открыты: разведчик уже подходил, и картинка стала 3-хмерной.',
    unlockCost: 0,
    defaultUnlocked: true,
    effects: { revealAdjacentRegions: true },
  },
  {
    id: 'sturdy-gear',
    name: 'Крепкое снаряжение',
    description: 'Немного дополнительного здоровья. Труп тоже будет 3Д, но позже.',
    unlockCost: 0,
    defaultUnlocked: true,
    effects: { startingHealthBonus: 8 },
  },
  {
    id: 'trail-rations',
    name: 'Походный рацион',
    description: 'Немного дополнительной выносливости: можно прыгать и т. п.',
    unlockCost: 45,
    defaultUnlocked: false,
    effects: { startingStaminaBonus: 8 },
  },
  {
    id: 'merchant-seal',
    name: 'Как в Daggerfall',
    description: 'Стартовых монет хватает, чтобы сразу что-нибудь купить.',
    unlockCost: 70,
    defaultUnlocked: false,
    effects: { startingGoldBonus: 15 },
  },
  {
    id: 'whetstone',
    name: 'Точильный камень',
    description: 'Оружие немного усилено с начала забега.',
    unlockCost: 95,
    defaultUnlocked: false,
    effects: { startingDamageBonus: 1 },
  },
] as const satisfies readonly BoonDefinition[]

export type BoonId = (typeof BOON_CATALOGUE)[number]['id']

export const DEFAULT_STARTING_BOON_IDS = [
  'provisions',
  'scout-map',
  'sturdy-gear',
] as const satisfies readonly BoonId[]

const NO_BOON_EFFECTS: BoonStartingEffects = {
  startingHealthBonus: 0,
  startingStaminaBonus: 0,
  startingGoldBonus: 0,
  startingSupplyCount: 0,
  revealAdjacentRegions: false,
  startingDamageBonus: 0,
}

export function isBoonId(value: unknown): value is BoonId {
  return (
    typeof value === 'string' &&
    BOON_CATALOGUE.some((definition) => definition.id === value)
  )
}

export function getBoonDefinition(boonId: string | null | undefined): BoonDefinition | null {
  if (!isBoonId(boonId)) return null
  return BOON_CATALOGUE.find((definition) => definition.id === boonId) ?? null
}

export function isBoonUnlocked(
  profile: Pick<ProfileSaveV1, 'unlockedBoonIds'>,
  boonId: string,
): boonId is BoonId {
  return isBoonId(boonId) && profile.unlockedBoonIds.includes(boonId)
}

export function validateBoonSelection(
  profile: Pick<ProfileSaveV1, 'selectedBoonId' | 'unlockedBoonIds'>,
  boonId: string | null = profile.selectedBoonId,
): BoonId | null {
  return boonId !== null && isBoonUnlocked(profile, boonId) ? boonId : null
}

export function getStartingBoonEffects(
  boonId: string | null | undefined,
): BoonStartingEffects {
  const definition = getBoonDefinition(boonId)
  return {
    ...NO_BOON_EFFECTS,
    ...(definition?.effects ?? {}),
  }
}

export function calculateStartingEffects(
  selection:
    | string
    | null
    | undefined
    | Pick<ProfileSaveV1, 'selectedBoonId' | 'unlockedBoonIds'>,
): BoonStartingEffects {
  const boonId =
    typeof selection === 'object' && selection !== null
      ? validateBoonSelection(selection)
      : selection
  return getStartingBoonEffects(boonId)
}

export const getProfileStartingEffects = calculateStartingEffects

function copyProfile(profile: ProfileSaveV1): ProfileSaveV1 {
  return {
    ...profile,
    unlockedBoonIds: [...profile.unlockedBoonIds],
    unlockedContentIds: [...profile.unlockedContentIds],
    unlockedCosmeticIds: [...profile.unlockedCosmeticIds],
    runHistory: profile.runHistory.map((summary) => ({ ...summary })),
    finalizedRunIds: [...profile.finalizedRunIds],
    seenHints: [...profile.seenHints],
  }
}

export function selectProfileBoon(
  profile: ProfileSaveV1,
  boonId: string,
): ProfileSaveV1 | null {
  const selectedBoonId = validateBoonSelection(profile, boonId)
  if (!selectedBoonId) return null
  return {
    ...copyProfile(profile),
    selectedBoonId,
  }
}

export type BoonUnlockStatus =
  | 'unlocked'
  | 'already-unlocked'
  | 'unknown-boon'
  | 'insufficient-currency'

export interface BoonUnlockResult {
  status: BoonUnlockStatus
  profile: ProfileSaveV1
  cost: number
}

export function unlockBoon(profile: ProfileSaveV1, boonId: string): BoonUnlockResult {
  const definition = getBoonDefinition(boonId)
  const copy = copyProfile(profile)
  copy.profileCurrency = boundedInteger(copy.profileCurrency, Number.MAX_SAFE_INTEGER)
  copy.unlockedBoonIds = [...new Set(copy.unlockedBoonIds)]
  if (!definition) return { status: 'unknown-boon', profile: copy, cost: 0 }
  if (copy.unlockedBoonIds.includes(definition.id)) {
    return { status: 'already-unlocked', profile: copy, cost: 0 }
  }
  if (copy.profileCurrency < definition.unlockCost) {
    return {
      status: 'insufficient-currency',
      profile: copy,
      cost: definition.unlockCost,
    }
  }

  copy.profileCurrency -= definition.unlockCost
  copy.unlockedBoonIds.push(definition.id)
  return {
    status: 'unlocked',
    profile: copy,
    cost: definition.unlockCost,
  }
}

export const unlockBoonWithCurrency = unlockBoon

/**
 * The profile is one localStorage blob rewritten on every save, so the hint ledger is
 * capped well above the number of hints that exist and far below anything that would make
 * the blob expensive to write.
 */
export const MAX_SEEN_HINTS = 256

/**
 * Records that a diegetic first-time line has been shown.
 *
 * Returns `null` when the hint was already recorded, so the caller can skip a profile
 * write instead of rewriting an identical blob on every duplicate report. The set is kept
 * in first-seen order and trimmed from the front, which only matters if a future build
 * ships more hints than the cap.
 */
export function recordSeenHint(
  profile: ProfileSaveV1,
  hintId: string,
): ProfileSaveV1 | null {
  if (typeof hintId !== 'string' || hintId.length === 0) return null
  if (profile.seenHints.includes(hintId)) return null
  const copy = copyProfile(profile)
  copy.seenHints = [...new Set([...copy.seenHints, hintId])].slice(-MAX_SEEN_HINTS)
  return copy
}

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(0, Math.floor(value)))
}

/**
 * Every number the profile reward is made of, so the end screen can print the same rules
 * the archive pays by.
 *
 * W1-4 added the purse. The «gold» hint always promised that gold surviving the run comes
 * back as profile coins, and until then the formula did not read gold at all. Ten gold make
 * a coin, at most fifteen a run, and the bounds are the argument:
 *
 * - **The cap is below the victory/defeat gap (45 − 12 = 33).** Hoarding can never out-earn
 *   the heal or prosthetic that wins the run, so spending stays right when the alternative
 *   is dying, and banking is right only when it is not.
 * - **It is the smallest bonus** (kills 25, objectives 20). A run now pays at most 105; the
 *   laziest one, dying at once with the untouched 55-gold purse, gains five coins, not a loop.
 * - **Ten to one is the counter's own scale.** A field kit costs 35 and an upgrade 100–140,
 *   so a purchase visibly costs 3–14 coins of the bonus, and 150 gold or more pays the cap.
 */
export const RUN_COMPLETION_REWARD = {
  victory: 45,
  defeat: 12,
  killsPerCoin: 4,
  killCap: 25,
  coinsPerObjective: 4,
  objectiveCap: 20,
  goldPerCoin: 10,
  goldCap: 15,
} as const

export interface RunCompletionRewardBreakdown {
  /** The outcome itself: victory or defeat. Zero for an abandoned run. */
  completion: number
  kills: number
  objectives: number
  /** The purse: gold that survived to the end, converted at the bounded rate. */
  gold: number
  total: number
}

export type RunCompletionRewardInput = Pick<
  RunHistorySummary,
  'status' | 'kills' | 'objectivesCompleted' | 'endingGold'
>

/** What a purse of this size pays at the end of a run; the shop prints it beside the purse. */
export function computePurseReward(gold: number): number {
  const rules = RUN_COMPLETION_REWARD
  return Math.min(
    rules.goldCap,
    Math.floor(boundedInteger(gold, 1_000_000) / rules.goldPerCoin),
  )
}

export function computeRunCompletionRewardBreakdown(
  summary: RunCompletionRewardInput,
): RunCompletionRewardBreakdown {
  if (summary.status !== 'victory' && summary.status !== 'defeat') {
    return { completion: 0, kills: 0, objectives: 0, gold: 0, total: 0 }
  }
  const rules = RUN_COMPLETION_REWARD
  const completion = summary.status === 'victory' ? rules.victory : rules.defeat
  const kills = Math.min(
    rules.killCap,
    Math.floor(boundedInteger(summary.kills, 10_000) / rules.killsPerCoin),
  )
  const objectives = Math.min(
    rules.objectiveCap,
    boundedInteger(summary.objectivesCompleted, 100) * rules.coinsPerObjective,
  )
  const gold = computePurseReward(summary.endingGold)
  return { completion, kills, objectives, gold, total: completion + kills + objectives + gold }
}

export function computeRunCompletionReward(summary: RunCompletionRewardInput): number {
  return computeRunCompletionRewardBreakdown(summary).total
}

export const computeCompletionReward = computeRunCompletionReward
export const BOONS = BOON_CATALOGUE
export const STARTING_BOON_IDS = DEFAULT_STARTING_BOON_IDS
export const getBoonEffects = getStartingBoonEffects
export const purchaseBoon = unlockBoon
export const calculateCompletionReward = computeRunCompletionReward
