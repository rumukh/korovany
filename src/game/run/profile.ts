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

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(0, Math.floor(value)))
}

export function computeRunCompletionReward(
  summary: Pick<RunHistorySummary, 'status' | 'kills' | 'objectivesCompleted'>,
): number {
  if (summary.status === 'abandoned') return 0
  if (summary.status !== 'victory' && summary.status !== 'defeat') return 0
  const completionReward = summary.status === 'victory' ? 45 : 12
  const killReward = Math.min(25, Math.floor(boundedInteger(summary.kills, 10_000) / 4))
  const objectiveReward = Math.min(
    20,
    boundedInteger(summary.objectivesCompleted, 100) * 4,
  )
  return completionReward + killReward + objectiveReward
}

export const computeCompletionReward = computeRunCompletionReward
export const BOONS = BOON_CATALOGUE
export const STARTING_BOON_IDS = DEFAULT_STARTING_BOON_IDS
export const getBoonEffects = getStartingBoonEffects
export const purchaseBoon = unlockBoon
export const calculateCompletionReward = computeRunCompletionReward
