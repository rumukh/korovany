/**
 * W2-2 — the caravan beat: «можно грабить корованы» as something a run does on purpose.
 *
 * A beat is one gilded cart on a real road at a seed-derived spot, with its own escort (or,
 * when the player's side owns the cart, raiders), fought where it stands and then resolved
 * by the **faction's own verb** from the letter:
 *
 * - **Elf** robs: take the cargo for gold, or give it to «домики деревяные» for rations.
 * - **Guard** never pockets cargo. It escorts its own carts on the commander's orders,
 *   walking one in or sending it on alone, and confiscates an enemy's for a bounty.
 * - **Villain**, «сам себе командир», plunders, press-gangs the crew into his troops, or
 *   burns the cargo. Burning an imperial cart leaves the palace finale one escort short.
 *
 * Every outcome moves the world's one market. The generator places exactly one shop, «Можно
 * покупать и т. п.», so supply is only ever visible as its prices. A cart that arrives
 * raises them less; a cart that never arrives raises them more. The writes go through the
 * chronicle's own helpers and take no roll.
 *
 * The bridge ambush was the first beat and stays one: its plan, its id, its combatants and
 * its lane are `createBridgeAmbushPlan`'s, so a version-1 `bridgeAmbush` save migrates
 * without loss (`restoreCaravanBeatsState`).
 *
 * Pure: no THREE, no actors, no clock and no random stream. The engine spawns and moves
 * things and pays out; everything here is decided from numbers, so it can be driven in a
 * test exactly as the engine drives it.
 */
import {
  CARAVAN_BEAT_CHOICE_LABELS,
  CARAVAN_BEAT_DECLINED_HINT,
  CARAVAN_BEAT_DORMANT_HINT,
  CARAVAN_BEAT_OPTIONAL_STAKE,
  CARAVAN_BEAT_UNAVAILABLE_HINT,
  CARAVAN_SPINE_STAKE,
  describeCaravanBeatAbandon,
  describeCaravanBeatAlternatives,
  describeCaravanBeatApproach,
  describeCaravanBeatDeclined,
  describeCaravanBeatDormant,
  describeCaravanBeatStagingWait,
  describeCaravanBeatChoice,
  describeCaravanBeatDelivering,
  describeCaravanBeatFight,
  describeCaravanBeatHint,
  describeCaravanBeatSecured,
  describeCaravanBeatSquadFull,
  describeCaravanBeatTask,
  describeCaravanBeatTitle,
  formatActorRole,
  formatRegionGridLabel,
  type CaravanBeatMarketCopy,
} from '../content/gameCopy.ts'
import type { SerializableState } from '../run/runTypes.ts'
import type {
  ActorRole,
  Allegiance,
  ChoicePayoutView,
  ChoiceTravelView,
  Faction,
  Objective,
} from '../types.ts'
import {
  BRIDGE_AMBUSH_ACTIVATION_RADIUS,
  BRIDGE_AMBUSH_CARGO_HEALTH,
  BRIDGE_AMBUSH_CHOICE_RADIUS,
  BRIDGE_AMBUSH_DELIVERY_ESCORT_RADIUS,
  BRIDGE_AMBUSH_DELIVERY_SPEED,
  BRIDGE_AMBUSH_STAGING_CLEARANCE,
  bridgeAmbushEnemyFaction,
  bridgeAmbushEnemyRole,
  createBridgeAmbushPlan,
  normalizeBridgeAmbushState,
  type BridgeAmbushState,
} from './BridgeAmbush.ts'
import {
  SUPPLY_CARAVAN_GAIN,
  SUPPLY_CARAVAN_LOSS,
  SUPPLY_SABOTAGE_LOSS,
  supplyPriceMultiplier,
} from './Chronicle.ts'
import {
  buildExpeditionGuidance,
  getExpeditionGraph,
  type ExpeditionRoute,
  type ExpeditionTarget,
  type ExpeditionView,
} from './ExpeditionPlanner.ts'
import { FINALE_PROFILES } from './FinaleDirector.ts'
import type { WorldBlueprint, WorldSite } from './worldTypes.ts'

export type CaravanBeatPlacement = 'bridge' | 'forest' | 'open' | 'pass'
/**
 * Where a beat sits in the run. `crossing` is the old bridge ambush. PR B's spine adds the
 * two `offer`s the camp chooses between and one more `road` beat on the way to the finale.
 */
export type CaravanBeatSlot = 'offer' | 'crossing' | 'road'
export type CaravanBeatRole = 'rob' | 'defend'
export type CaravanBeatTier = 'light' | 'standard' | 'rich'
export type CaravanBeatOutcome =
  | 'take'
  | 'give'
  | 'deliver'
  | 'release'
  | 'confiscate'
  | 'plunder'
  | 'press'
  | 'burn'
export type CaravanBeatEnding = CaravanBeatOutcome | 'lost' | 'escaped'
export type CaravanBeatPhase =
  | 'approach'
  | 'fighting'
  | 'secured'
  | 'delivering'
  | 'resolved'
  | 'lost'
  | 'escaped'
  | 'unavailable'
  /** The other caravan at the camp, the one the run did not take: it went its own way. */
  | 'declined'

export const CARAVAN_BEAT_OUTCOMES: readonly CaravanBeatOutcome[] = [
  'take', 'give', 'deliver', 'release', 'confiscate', 'plunder', 'press', 'burn',
]
export const CARAVAN_BEAT_PLACEMENTS: readonly CaravanBeatPlacement[] = [
  'bridge', 'forest', 'open', 'pass',
]

export interface CaravanBeatPoint {
  x: number
  z: number
}

export interface CaravanBeatSpawnPoint extends CaravanBeatPoint {
  combatantId: string
}

export interface CaravanBeatPlan {
  id: string
  slot: CaravanBeatSlot
  placement: CaravanBeatPlacement
  regionId: string
  bridgeId: string | null
  /** Unit direction of the lane the cart stands on and is walked along. */
  axis: CaravanBeatPoint
  approachSign: -1 | 1
  /** The bridge, or the middle of a road lane: what the beat is "at". */
  anchor: CaravanBeatPoint
  cargoStart: CaravanBeatPoint
  alternateApproach: CaravanBeatPoint
  deliveryEnd: CaravanBeatPoint
  openingRoute: ExpeditionRoute
  deliveryRoute: ExpeditionRoute
  spawnPoints: CaravanBeatSpawnPoint[]
  role: CaravanBeatRole
  tier: CaravanBeatTier
  /** Whose cart it is. */
  owner: Faction
  /** Who the player fights at this cart: its escort when robbing, the raiders when defending. */
  opponent: Faction
  enemyRoles: ActorRole[]
  /** The cart's own surviving escort, when the player is on its side. */
  protectorRole: ActorRole | null
  /** The world's one market: every cart was bound for it. */
  marketSiteId: string | null
  marketRegionId: string | null
}

export interface CaravanBeatCombatantState {
  id: string
  allegiance: Allegiance
  role: ActorRole
  enemy: boolean
  health: number
  maxHealth: number
  defeated: boolean
}

export interface CaravanBeatState {
  id: string
  placement: CaravanBeatPlacement
  regionId: string
  phase: CaravanBeatPhase
  cargoX: number
  cargoZ: number
  cargoHealth: number
  cargoMaxHealth: number
  /** 0..1 along the lane, for the outcomes that walk the cart. */
  progress: number
  outcome: CaravanBeatOutcome | null
  consequence: string | null
  rewardPaid: boolean
  unavailableReason: string | null
  /** Seconds left before an engaged cart the player walked away from settles itself. */
  abandonRemaining: number | null
  /**
   * Seconds the cart has waited, with the player beside it, for room on a crowded road.
   * Saved, so a continue resumes the wait instead of starting it again.
   */
  stagingStalled: number
  combatants: CaravanBeatCombatantState[]
}

export interface CaravanBeatsState {
  version: typeof CARAVAN_BEATS_VERSION
  /**
   * PR B — the campaign waits on its caravans: the camp is a choice between two of them and
   * the finale opens after `CARAVAN_SPINE_FINALE_GATE`. False for a run saved before that,
   * which keeps the campaign it started with.
   */
  spine: boolean
  /** The camp's offer the player said they would take, before either cart was met. */
  chosenOfferId: string | null
  /** A burned cart already thinned the palace finale; a second burn does not. */
  garrisonThinned: boolean
  beats: CaravanBeatState[]
}

/** 2 since PR B's spine; a version-1 block (PR A) loads as a run without one. */
export const CARAVAN_BEATS_VERSION = 2
export const CARAVAN_BEAT_CARGO_HEALTH = BRIDGE_AMBUSH_CARGO_HEALTH
export const CARAVAN_BEAT_ACTIVATION_RADIUS = BRIDGE_AMBUSH_ACTIVATION_RADIUS
export const CARAVAN_BEAT_CHOICE_RADIUS = BRIDGE_AMBUSH_CHOICE_RADIUS
export const CARAVAN_BEAT_DELIVERY_ESCORT_RADIUS = BRIDGE_AMBUSH_DELIVERY_ESCORT_RADIUS
export const CARAVAN_BEAT_DELIVERY_SPEED = BRIDGE_AMBUSH_DELIVERY_SPEED
/**
 * Beyond this a cart the player was engaged with is a cart they walked away from. It is
 * the road cart's `CARAVAN_ESCORT_RANGE`, the distance at which the game stops pretending
 * anybody is there to see the escort.
 */
export const CARAVAN_BEAT_ABANDON_RANGE = 90
/**
 * How long a walked-away cart waits. Twice 90 m at the 8.2 m/s walk is about 22 s, so a
 * player who stepped back to eat a ration and returned is never punished for it, and one who
 * left for the next objective learns what happened to the cart within half a minute.
 */
export const CARAVAN_BEAT_ABANDON_SECONDS = 30
/** A walked cart that has not moved for this long while escorted finishes where it stands. */
export const CARAVAN_BEAT_DELIVERY_STALL_SECONDS = 6
/**
 * How long a cart waits for room on a crowded road while the player stands by it. The same
 * patience it has for a player who walked away (`CARAVAN_BEAT_ABANDON_SECONDS`): after that
 * it goes through without a fight, and the run moves on rather than waiting on the budget.
 */
export const CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS = 30
/**
 * PR B — the finale opens after this many caravans have settled, whatever their ending.
 * Two: the camp's choice and one met on the road. One would leave the road optional again;
 * three would force the last detour on a run that is already going badly.
 */
export const CARAVAN_SPINE_FINALE_GATE = 2
/**
 * The villain's press-gang stops at four companions: the three starters and one more, which
 * is the size a rescue already reaches. The fourth borrows a spare slot from the actor
 * budget's lower categories; `MAX_ACTORS` still holds and the finale's campaign slots can
 * still be reserved, which `tests/caravanBeats.test.ts` checks at a full world.
 */
export const CARAVAN_BEAT_SQUAD_CAP = 4
/**
 * What the cargo is worth to a gold verb, by escort size. The anchors are the shipped carts:
 * the old bridge seizure paid 85 for three escorts, the road cart 95 for two, a chronicle
 * ambush 140 for four actors and the rich caravan 180 with a chase. A standard beat (the
 * bridge's three escorts) sits between the first two; a light one is the road cart's two
 * escorts without its repeat; a rich one adds a brute.
 */
export const CARAVAN_BEAT_VALUE: Readonly<Record<CaravanBeatTier, number>> = {
  light: 70,
  standard: 90,
  rich: 120,
}
/** A ration heals 35, the price of field medicine, so two rations stand in for ~70 gold. */
export const CARAVAN_BEAT_GIVE_RATIONS: Readonly<Record<CaravanBeatTier, number>> = {
  light: 2,
  standard: 2,
  rich: 3,
}
/** The commander's wage for walking a cart in: less than the cargo, plus a ration for the road. */
export const CARAVAN_BEAT_WAGE_SHARE = 0.6
export const CARAVAN_BEAT_DELIVER_RATIONS = 1
/** The commander's bounty for confiscated cargo: the palace keeps the rest. */
export const CARAVAN_BEAT_BOUNTY_SHARE = 0.8

const POSITION_EPSILON = 0.08
const SETTLED_PHASES: readonly CaravanBeatPhase[] = ['resolved', 'lost', 'escaped', 'unavailable']
const ENGAGED_PHASES: readonly CaravanBeatPhase[] = ['fighting', 'secured', 'delivering']
const PHASES: readonly CaravanBeatPhase[] = [
  'approach', 'fighting', 'secured', 'delivering', 'resolved', 'lost', 'escaped', 'unavailable', 'declined',
]
/** Endings a run takes part in: an unavailable or declined cart is no step of its progress. */
const PROGRESS_PHASES: readonly CaravanBeatPhase[] = ['resolved', 'lost', 'escaped']

function distance(first: CaravanBeatPoint, second: CaravanBeatPoint): number {
  return Math.hypot(first.x - second.x, first.z - second.z)
}

function roundToFive(value: number): number {
  return Math.round(value / 5) * 5
}

function finite(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= minimum && value <= maximum ? value : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** The world's one shop. Every generated world has it; a settlement-kind site is the fallback. */
export function caravanMarketSite(blueprint: WorldBlueprint): WorldSite | null {
  return blueprint.sites.find((site) => site.kind === 'shop') ??
    blueprint.sites.find((site) => site.kind === 'settlement' || site.kind === 'recovery') ??
    null
}

function createCrossingBeatPlan(blueprint: WorldBlueprint, faction: Faction): CaravanBeatPlan | null {
  const bridge = createBridgeAmbushPlan(blueprint, faction)
  if (!bridge) return null
  const opponent = bridgeAmbushEnemyFaction(blueprint, faction, bridge)
  const market = caravanMarketSite(blueprint)
  return {
    id: bridge.id,
    slot: 'crossing',
    placement: 'bridge',
    regionId: bridge.regionId,
    bridgeId: bridge.bridgeId,
    axis: bridge.axis,
    approachSign: bridge.approachSign,
    anchor: bridge.bridge,
    cargoStart: bridge.cargoStart,
    alternateApproach: bridge.alternateApproach,
    deliveryEnd: bridge.deliveryEnd,
    openingRoute: bridge.openingRoute,
    deliveryRoute: bridge.deliveryRoute,
    spawnPoints: bridge.spawnPoints,
    role: faction === 'guard' ? 'defend' : 'rob',
    tier: 'standard',
    owner: 'guard',
    opponent,
    enemyRoles: [0, 1, 2].map((index) => bridgeAmbushEnemyRole(opponent, index)),
    protectorRole: faction === 'guard' ? 'soldier' : null,
    marketSiteId: market?.id ?? null,
    marketRegionId: market ? String(market.regionId) : null,
  }
}

/** Every beat this run can meet, in a fixed order. Deterministic from the blueprint alone. */
export function createCaravanBeatPlans(blueprint: WorldBlueprint, faction: Faction): CaravanBeatPlan[] {
  const crossing = createCrossingBeatPlan(blueprint, faction)
  return crossing ? [crossing] : []
}

export function createCaravanBeatState(plan: CaravanBeatPlan): CaravanBeatState {
  const combatants: CaravanBeatCombatantState[] = plan.enemyRoles.map((role, index) => ({
    id: `${plan.id}:enemy:${index}`,
    allegiance: plan.opponent,
    role,
    enemy: true,
    health: 0,
    maxHealth: 0,
    defeated: false,
  }))
  if (plan.protectorRole) {
    combatants.push({
      id: `${plan.id}:protector:0`,
      allegiance: plan.owner,
      role: plan.protectorRole,
      enemy: false,
      health: 0,
      maxHealth: 0,
      defeated: false,
    })
  }
  return {
    id: plan.id,
    placement: plan.placement,
    regionId: plan.regionId,
    phase: 'approach',
    cargoX: plan.cargoStart.x,
    cargoZ: plan.cargoStart.z,
    cargoHealth: CARAVAN_BEAT_CARGO_HEALTH,
    cargoMaxHealth: CARAVAN_BEAT_CARGO_HEALTH,
    progress: 0,
    outcome: null,
    consequence: null,
    rewardPaid: false,
    unavailableReason: null,
    abandonRemaining: null,
    stagingStalled: 0,
    combatants,
  }
}

export function createUnavailableCaravanBeatState(
  plan: CaravanBeatPlan,
  reason: string,
): CaravanBeatState {
  return {
    ...createCaravanBeatState(plan),
    phase: 'unavailable',
    cargoHealth: 0,
    unavailableReason: reason,
    combatants: [],
  }
}

/** A fresh run's beats. `spine` is set for every new run since PR B; tests pass false. */
export function createCaravanBeatsState(
  plans: readonly CaravanBeatPlan[],
  spine = false,
): CaravanBeatsState {
  return {
    version: CARAVAN_BEATS_VERSION,
    spine,
    chosenOfferId: null,
    garrisonThinned: false,
    beats: plans.map((plan) => createCaravanBeatState(plan)),
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The verbs this side may use on this cart, in the order the panel lists them. */
export function caravanBeatChoices(faction: Faction, plan: CaravanBeatPlan): CaravanBeatOutcome[] {
  if (plan.role === 'defend') return ['deliver', 'release']
  if (faction === 'elf') return ['take', 'give']
  if (faction === 'villain') return ['plunder', 'press', 'burn']
  return ['confiscate']
}

/** Outcomes the player walks the cart for, along its lane. */
export function isCaravanBeatLaneOutcome(outcome: CaravanBeatOutcome): boolean {
  return outcome === 'give' || outcome === 'deliver'
}

/**
 * Every seizure counts once toward «Грабить корованы»: the elf's and the villain's verbs,
 * and the guard's confiscation, which the game already counts for the guard's rich-caravan
 * and chronicle-ambush raids. Walking a cart in or sending it on is an escort, never a seizure.
 */
export function caravanBeatCountsAsRobbery(outcome: CaravanBeatOutcome): boolean {
  return outcome !== 'deliver' && outcome !== 'release'
}

export interface CaravanBeatReward {
  gold: number
  rations: number
  recruits: number
  /** The verb removes a palace finale escort, if one can still be removed. */
  burnsSupply: boolean
}

/** What an outcome pays the player. One table; the engine pays exactly this. */
export function caravanBeatReward(plan: CaravanBeatPlan, outcome: CaravanBeatOutcome): CaravanBeatReward {
  const value = CARAVAN_BEAT_VALUE[plan.tier]
  const none: CaravanBeatReward = { gold: 0, rations: 0, recruits: 0, burnsSupply: false }
  switch (outcome) {
    case 'take':
    case 'plunder':
      return { ...none, gold: value }
    case 'give':
      return { ...none, rations: CARAVAN_BEAT_GIVE_RATIONS[plan.tier] }
    case 'deliver':
      return {
        ...none,
        gold: roundToFive(value * CARAVAN_BEAT_WAGE_SHARE),
        rations: CARAVAN_BEAT_DELIVER_RATIONS,
      }
    case 'release':
      return none
    case 'confiscate':
      return { ...none, gold: roundToFive(value * CARAVAN_BEAT_BOUNTY_SHARE) }
    case 'press':
      return { ...none, recruits: 1 }
    case 'burn':
      return { ...none, burnsSupply: true }
  }
}

/**
 * Whether burning this cart can still thin the palace finale: the villain's verb, on a cart
 * owned by the side the villain's finale is fought against, once per run.
 */
export function caravanBeatThinsGarrison(
  faction: Faction,
  plan: CaravanBeatPlan,
  garrisonThinned: boolean,
): boolean {
  return faction === 'villain' && !garrisonThinned &&
    plan.owner === FINALE_PROFILES[faction].enemyFaction
}

export interface CaravanBeatMarketWrite {
  kind: 'arrival' | 'loss'
  amount: number
}

/**
 * How an ending moves the market. A cart that reaches it (delivered, sent on, handed to the
 * houses who trade it on, or one that got away) adds the chronicle's arrival; one that never
 * does costs the chronicle's loss, and a burned one costs a burned depot's.
 */
export function caravanBeatMarketWrite(
  plan: CaravanBeatPlan,
  ending: CaravanBeatEnding,
): CaravanBeatMarketWrite | null {
  if (!plan.marketRegionId) return null
  switch (ending) {
    case 'give':
    case 'deliver':
    case 'release':
    case 'escaped':
      return { kind: 'arrival', amount: SUPPLY_CARAVAN_GAIN }
    case 'burn':
      return { kind: 'loss', amount: SUPPLY_SABOTAGE_LOSS }
    case 'take':
    case 'plunder':
    case 'press':
    case 'confiscate':
    case 'lost':
      return { kind: 'loss', amount: SUPPLY_CARAVAN_LOSS }
  }
}

/** The before/after price factors of a market write, for the panel and the notice. */
export function caravanBeatMarketChange(
  write: CaravanBeatMarketWrite | null,
  supply: number | null,
): { before: number; after: number } | null {
  if (!write || supply === null || !Number.isFinite(supply)) return null
  const after = write.kind === 'arrival' ? supply + write.amount : supply - write.amount
  return { before: supplyPriceMultiplier(supply), after: supplyPriceMultiplier(after) }
}

export function caravanBeatRemainingEnemies(state: CaravanBeatState): number {
  return state.combatants.filter((entry) => entry.enemy && !entry.defeated).length
}

export function isCaravanBeatSettled(state: CaravanBeatState): boolean {
  return SETTLED_PHASES.includes(state.phase)
}

export function isCaravanBeatEngaged(state: CaravanBeatState): boolean {
  return ENGAGED_PHASES.includes(state.phase)
}

/** Settled, or the camp's other caravan that went its own way: nothing more happens there. */
export function isCaravanBeatClosed(state: CaravanBeatState): boolean {
  return isCaravanBeatSettled(state) || state.phase === 'declined'
}

/**
 * Who guards (or raids) a cart of this weight. The bridge's three are the standard; a light
 * cart drops the archer, and a rich one puts the side's elite in the middle post: a brute for
 * the palace and the villain, a second blade for the elves, who field no brutes.
 */
export function caravanBeatEnemyRoles(opponent: Faction, tier: CaravanBeatTier): ActorRole[] {
  const roles = [0, 1, 2].map((index) => bridgeAmbushEnemyRole(opponent, index))
  if (tier === 'light') return roles.slice(0, 2)
  if (tier === 'rich') roles[1] = opponent === 'elf' ? 'soldier' : 'brute'
  return roles
}

// ---------------------------------------------------------------------------
// PR B — the spine: the camp's choice and the finale's gate
// ---------------------------------------------------------------------------

/** Ends at which a cart has had its say in the run: something happened there, or could not. */
const COMMITTED_PHASES: readonly CaravanBeatPhase[] = [
  'fighting', 'secured', 'delivering', 'resolved', 'lost', 'escaped',
]

function isOfferBeat(plans: readonly CaravanBeatPlan[], beat: CaravanBeatState): boolean {
  return plans.find((plan) => plan.id === beat.id)?.slot === 'offer'
}

/**
 * Whether the camp's choice is behind the run. Always, without a spine. With one: once either
 * offer has settled, or once nothing at the camp can be met any more — no offer was placed, or
 * every one is closed. «Суть такова»: the run does not go on until a caravan has been met.
 */
export function isCaravanOpeningSettled(
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState | null,
): boolean {
  if (!state?.spine) return true
  const offers = state.beats.filter((beat) => isOfferBeat(plans, beat))
  return offers.length === 0 || offers.some(isCaravanBeatSettled) || offers.every(isCaravanBeatClosed)
}

/** The camp holds the first node of the campaign while its choice is open. */
export function caravanSpineHoldsCamp(
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState | null,
): boolean {
  return !isCaravanOpeningSettled(plans, state)
}

/** A spine's road beats wait for the camp: no cart stands on them until the choice is made. */
export function isCaravanBeatDormant(
  plan: CaravanBeatPlan,
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState | null,
): boolean {
  return plan.slot !== 'offer' && caravanSpineHoldsCamp(plans, state)
}

export interface CaravanSpineGate {
  open: boolean
  /** Settled beats, which may run past `required`. */
  settled: number
  required: number
}

/**
 * The finale's gate: it opens once `CARAVAN_SPINE_FINALE_GATE` beats have settled. Every
 * ending counts — lost, escaped and unavailable as much as resolved — because each of them
 * ends in bounded time, which is what keeps the gate from ever stranding a run. The camp's
 * declined offer is not a beat the run can meet, so it neither counts nor is required, and a
 * world with fewer beats than the gate asks is never asked for more than it has.
 */
export function caravanSpineGate(
  state: CaravanBeatsState | null,
  /** The run harness measures other gates (`beatGate`); the game always asks the shipped one. */
  finaleGate: number = CARAVAN_SPINE_FINALE_GATE,
): CaravanSpineGate {
  if (!state?.spine) return { open: true, settled: 0, required: 0 }
  const counted = state.beats.filter((beat) => beat.phase !== 'declined')
  const settled = counted.filter(isCaravanBeatSettled).length
  const required = Math.min(Math.max(0, Math.floor(finaleGate)), counted.length)
  return { open: settled >= required, settled, required }
}

/**
 * The caravans the run took part in: resolved, lost or escaped. A cart that could not be
 * staged, or the camp's declined offer, moved nobody forward.
 */
export function caravanSpineMetCount(state: CaravanBeatsState | null): number {
  if (!state?.spine) return 0
  return state.beats.filter((beat) => PROGRESS_PHASES.includes(beat.phase)).length
}

/**
 * Met caravans per step of W2-1's progress. Two, the coordinator's fallback, because one per
 * step was measured out of band: with the tier rising on every cart the threat waves dealt
 * nearly three times their damage and the duelist's wins fell 20 points, while two per step
 * keeps the waves at their baseline and every policy within 10 points of its wins. The finale
 * is fought at pacing tier 4 either way. `docs/run-harness.md` has the sweep.
 */
export const CARAVAN_SPINE_BEATS_PER_STEP = 2

/** The progress steps the met caravans pay for (W2-1's `caravanBeatsResolved`). */
export function caravanSpineProgressBeats(state: CaravanBeatsState | null): number {
  return Math.floor(caravanSpineMetCount(state) / CARAVAN_SPINE_BEATS_PER_STEP)
}

/**
 * «Взяться»: the player says which offer they will take, and the compass follows it. Only an
 * offer still waiting at an open camp can be chosen. Returns whether anything changed.
 */
export function chooseCaravanOffer(
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState,
  offerId: string,
): boolean {
  if (!caravanSpineHoldsCamp(plans, state) || state.chosenOfferId === offerId) return false
  const beat = state.beats.find((entry) => entry.id === offerId)
  if (!beat || beat.phase !== 'approach' || !isOfferBeat(plans, beat)) return false
  state.chosenOfferId = offerId
  return true
}

/**
 * One offer was met: it is the choice now, and every other offer still waiting at the camp
 * goes its own way. Returns the ids declined.
 */
export function declineOtherCaravanOffers(
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState,
  metId: string,
): string[] {
  if (!state.spine) return []
  const declined: string[] = []
  for (const beat of state.beats) {
    if (beat.id === metId || beat.phase !== 'approach' || !isOfferBeat(plans, beat)) continue
    beat.phase = 'declined'
    declined.push(beat.id)
  }
  state.chosenOfferId = metId
  return declined
}

/**
 * While the gate is shut and nothing else leads, the compass goes to the nearest caravan the
 * run can still meet, by the distance the caller measures (the road, for the engine).
 */
export function caravanSpineNextBeat(
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState | null,
  distanceTo: (point: CaravanBeatPoint) => number,
): string | null {
  // The camp's choice is the camp's to lead; the gate leads only once it is made.
  if (!state?.spine || caravanSpineGate(state).open || caravanSpineHoldsCamp(plans, state)) return null
  let best: { id: string; distance: number } | null = null
  for (const beat of state.beats) {
    const plan = plans.find((entry) => entry.id === beat.id)
    if (!plan || isCaravanBeatClosed(beat) || isCaravanBeatDormant(plan, plans, state)) continue
    const away = distanceTo({ x: beat.cargoX, z: beat.cargoZ })
    if (best === null || away < best.distance) best = { id: beat.id, distance: away }
  }
  return best?.id ?? null
}

/** Whether a committed offer leaves the others nothing to wait for (the normaliser's rule). */
function openingCommitted(plans: readonly CaravanBeatPlan[], beats: readonly CaravanBeatState[]): boolean {
  return beats.some((beat) => isOfferBeat(plans, beat) && COMMITTED_PHASES.includes(beat.phase))
}

/**
 * The caravans the compass follows on its own: the camp's chosen offer, which leads ahead of
 * the active objective while the choice is open, and the gate's next cart, which follows it
 * when no objective is left before the shut finale. An atlas choice and a taken rumour still
 * come first (`ExpeditionPlanner`).
 */
export function caravanSpineLeads(
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState | null,
  distanceTo: (point: CaravanBeatPoint) => number,
): { leading: string | null; trailing: string | null } {
  if (!state?.spine) return { leading: null, trailing: null }
  const chosen = state.chosenOfferId === null
    ? undefined
    : state.beats.find((beat) => beat.id === state.chosenOfferId)
  const leading = caravanSpineHoldsCamp(plans, state) && chosen !== undefined && !isCaravanBeatClosed(chosen)
    ? chosen.id
    : null
  return { leading, trailing: caravanSpineNextBeat(plans, state, distanceTo) }
}

export function caravanBeatDeliveryProgress(plan: CaravanBeatPlan, point: CaravanBeatPoint): number {
  const dx = plan.deliveryEnd.x - plan.cargoStart.x
  const dz = plan.deliveryEnd.z - plan.cargoStart.z
  const lengthSq = dx * dx + dz * dz
  if (lengthSq <= Number.EPSILON) return 0
  return Math.min(1, Math.max(0,
    ((point.x - plan.cargoStart.x) * dx + (point.z - plan.cargoStart.z) * dz) / lengthSq))
}

export function caravanBeatLanePoint(plan: CaravanBeatPlan, progress: number): CaravanBeatPoint {
  return {
    x: plan.cargoStart.x + (plan.deliveryEnd.x - plan.cargoStart.x) * progress,
    z: plan.cargoStart.z + (plan.deliveryEnd.z - plan.cargoStart.z) * progress,
  }
}

/** Keeps unrelated encounter spawns out of the cart's lane until the beat settles. */
export function caravanBeatReservesStagingPoint(
  plan: CaravanBeatPlan,
  state: CaravanBeatState,
  point: CaravanBeatPoint,
): boolean {
  if (isCaravanBeatClosed(state)) return false
  const lane = caravanBeatLanePoint(plan, caravanBeatDeliveryProgress(plan, point))
  return distance(point, lane) <= BRIDGE_AMBUSH_STAGING_CLEARANCE
}

export function caravanBeatCanChoose(state: CaravanBeatState, player: CaravanBeatPoint): boolean {
  return state.phase === 'secured' &&
    state.cargoHealth > 0 &&
    caravanBeatRemainingEnemies(state) === 0 &&
    distance({ x: state.cargoX, z: state.cargoZ }, player) <= CARAVAN_BEAT_CHOICE_RADIUS
}

export type CaravanBeatAbandonEnding = 'escaped' | 'lost' | 'release' | 'unattended'

/**
 * One frame of the walked-away clock. Engaged carts only; inside the range the clock is off
 * and starts again from the top next time. Returns how the cart settles when the clock runs
 * out: a robbery that was never finished escapes, a defence that was never finished is lost,
 * a robbed cart left standing is looted, an escorted one goes on alone, and a walk the player
 * abandoned finishes without them.
 */
export function advanceCaravanBeatAbandon(
  plan: CaravanBeatPlan,
  state: CaravanBeatState,
  playerDistance: number,
  delta: number,
): CaravanBeatAbandonEnding | null {
  if (!isCaravanBeatEngaged(state) || !(playerDistance > CARAVAN_BEAT_ABANDON_RANGE)) {
    state.abandonRemaining = null
    return null
  }
  const step = Number.isFinite(delta) ? Math.max(0, delta) : 0
  const remaining = (state.abandonRemaining ?? CARAVAN_BEAT_ABANDON_SECONDS) - step
  if (remaining > 0) {
    state.abandonRemaining = remaining
    return null
  }
  state.abandonRemaining = null
  if (state.phase === 'delivering') return 'unattended'
  if (state.phase === 'secured') return plan.role === 'defend' ? 'release' : 'lost'
  return plan.role === 'defend' ? 'lost' : 'escaped'
}

// ---------------------------------------------------------------------------
// The HUD
// ---------------------------------------------------------------------------

export interface CaravanBeatChoiceView {
  outcome: CaravanBeatOutcome
  label: string
  detail: string
  disabledReason: string | null
}

export interface CaravanBeatView {
  id: string
  /** PR B — optional on the view, so a hand-built view from before the spine still reads. */
  slot?: CaravanBeatSlot
  placement: CaravanBeatPlacement
  role: CaravanBeatRole
  owner: Faction
  tier: CaravanBeatTier
  phase: CaravanBeatPhase
  /** A spine's road beat before the camp's choice: no cart there yet. */
  dormant?: boolean
  title: string
  description: string
  hint: string
  regionLabel: string
  x: number
  z: number
  distance: number
  bearing: number
  routeLabel?: string
  remainingEnemies: number
  totalEnemies: number
  /** Who is guarding (or raiding) the cart, by role. */
  escort: string
  cargoHealth: number
  cargoMaxHealth: number
  progress: number
  canChoose: boolean
  choices: CaravanBeatChoiceView[]
  outcome: CaravanBeatOutcome | null
  consequence: string | null
  abandonRemaining: number | null
  /** Seconds this cart has waited for room on a crowded road, while it is waiting. */
  stagingStalled?: number
  active: boolean
  tracked: boolean
  /** W2-3's price for an open cart: the side's first verb, and the walk there. */
  payout?: ChoicePayoutView | null
  /** The side's other verbs, said after the price: «или 3 пайка домикам деревяным». */
  alternatives?: string | null
  travel?: ChoiceTravelView | null
  /** The camp's offer the player said they would take. */
  chosen?: boolean
}

/** PR B — the camp's choice, while it is open. */
export interface CaravanOpeningView {
  offers: CaravanBeatView[]
  chosenId: string | null
}

export interface CaravanBeatsView {
  beats: CaravanBeatView[]
  /** The one the field HUD shows, or null. */
  active: CaravanBeatView | null
  /** The camp's choice while it is open; null once made, and in a run without a spine. */
  opening?: CaravanOpeningView | null
  /** The finale's gate in a spine run; null without one. */
  gate?: CaravanSpineGateView | null
}

/** The gate as the objective list shows it: on the finale's own line. */
export interface CaravanSpineGateView extends CaravanSpineGate {
  objectiveId: string
}

export interface CaravanBeatViewContext {
  blueprint: WorldBlueprint
  faction: Faction
  objectives: readonly Objective[]
  player: CaravanBeatPoint
  heading: number
  expedition?: Pick<ExpeditionView, 'mode' | 'target' | 'route' | 'guidance'>
  squadSize: number
  garrisonThinned: boolean
  /**
   * A burn would still send a palace escort away right now: `finaleGarrisonThinTarget` names
   * one. The panel promises the thinning only when the engine would then perform it.
   */
  garrisonCanThin: boolean
  /** The market square's supply right now, or null when nobody knows it. */
  marketSupply: number | null
  /**
   * W2-3 — how the caller times a walk, as the contract cards do. Without it the beat cards
   * quote no walk.
   */
  travel?: (point: CaravanBeatPoint) => ChoiceTravelView | null
}

function regionLabel(blueprint: WorldBlueprint, regionId: string | null): string {
  const region = regionId ? blueprint.regions.find((entry) => entry.id === regionId) : undefined
  return region ? formatRegionGridLabel(region.coordinate.x, region.coordinate.y) : '??'
}

function rootCompleted(
  blueprint: WorldBlueprint,
  faction: Faction,
  objectives: readonly Objective[],
): boolean {
  const root = blueprint.objectives[faction].nodes.find(
    (node) => node.siteId === blueprint.starts[faction],
  )
  return root !== undefined &&
    objectives.some((objective) => objective.id === root.id && objective.done)
}

function escortRoles(state: CaravanBeatState, plan: CaravanBeatPlan): string {
  const roles = state.combatants.length > 0
    ? state.combatants.filter((entry) => entry.enemy).map((entry) => entry.role)
    : plan.enemyRoles
  return roles.map(formatActorRole).join(', ')
}

/** The market line for one ending, from the market's supply now. */
export function caravanBeatMarketCopy(
  context: Pick<CaravanBeatViewContext, 'blueprint' | 'marketSupply'>,
  plan: CaravanBeatPlan,
  ending: CaravanBeatEnding,
): CaravanBeatMarketCopy | null {
  const change = caravanBeatMarketChange(caravanBeatMarketWrite(plan, ending), context.marketSupply)
  return change ? { regionLabel: regionLabel(context.blueprint, plan.marketRegionId), ...change } : null
}

function buildChoices(
  context: CaravanBeatViewContext,
  plan: CaravanBeatPlan,
): CaravanBeatChoiceView[] {
  return caravanBeatChoices(context.faction, plan).map((outcome) => {
    const reward = caravanBeatReward(plan, outcome)
    const thinsGarrison = reward.burnsSupply &&
      context.garrisonCanThin &&
      caravanBeatThinsGarrison(context.faction, plan, context.garrisonThinned)
    return {
      outcome,
      label: CARAVAN_BEAT_CHOICE_LABELS[outcome],
      detail: describeCaravanBeatChoice({
        outcome,
        gold: reward.gold,
        rations: reward.rations,
        thinsGarrison,
        squadSize: context.squadSize,
        squadCap: CARAVAN_BEAT_SQUAD_CAP,
        market: caravanBeatMarketCopy(context, plan, outcome),
      }),
      disabledReason: outcome === 'press' && context.squadSize >= CARAVAN_BEAT_SQUAD_CAP
        ? describeCaravanBeatSquadFull(context.squadSize, CARAVAN_BEAT_SQUAD_CAP)
        : null,
    }
  })
}

/**
 * W2-3's price for a cart the run can still meet: the side's first verb through the shared
 * `ChoicePayoutView`, the other verbs as words, so the card never adds alternatives up.
 */
export function caravanBeatPayout(faction: Faction, plan: CaravanBeatPlan): ChoicePayoutView {
  const reward = caravanBeatReward(plan, caravanBeatChoices(faction, plan)[0])
  return {
    gold: reward.gold,
    supplies: reward.rations,
    heal: 0,
    damage: 0,
    companion: reward.recruits > 0,
    loot: null,
  }
}

function beatAlternatives(
  context: CaravanBeatViewContext,
  plan: CaravanBeatPlan,
  garrisonThinned: boolean,
): string | null {
  const [, ...others] = caravanBeatChoices(context.faction, plan)
  return describeCaravanBeatAlternatives({
    outcomes: others,
    rations: CARAVAN_BEAT_GIVE_RATIONS[plan.tier],
    thinsGarrison: context.garrisonCanThin &&
      caravanBeatThinsGarrison(context.faction, plan, garrisonThinned),
  })
}

export function buildCaravanBeatView(
  context: CaravanBeatViewContext,
  plan: CaravanBeatPlan,
  state: CaravanBeatState,
  spine?: { plans: readonly CaravanBeatPlan[]; state: CaravanBeatsState },
): CaravanBeatView {
  const { blueprint, faction, player, heading, expedition } = context
  const cargo = { x: state.cargoX, z: state.cargoZ }
  const title = describeCaravanBeatTitle(plan.placement, faction, plan.role)
  const tracked = expedition?.mode === 'selected' &&
    expedition.target?.kind === 'caravanBeat' && expedition.target.id === plan.id
  // PR B — the compass may lead here on its own (the camp's chosen offer, the gate's next cart).
  const led = expedition?.mode === 'campaign' &&
    expedition.target?.kind === 'caravanBeat' && expedition.target.id === plan.id
  const open = !isCaravanBeatClosed(state)
  const base = {
    id: plan.id,
    slot: plan.slot,
    placement: plan.placement,
    role: plan.role,
    owner: plan.owner,
    tier: plan.tier,
    dormant: spine ? isCaravanBeatDormant(plan, spine.plans, spine.state) : false,
    title,
    regionLabel: regionLabel(blueprint, plan.regionId),
    x: cargo.x,
    z: cargo.z,
    escort: escortRoles(state, plan),
    stagingStalled: state.stagingStalled,
    tracked,
    payout: open ? caravanBeatPayout(faction, plan) : null,
    alternatives: open
      ? beatAlternatives(context, plan, spine?.state.garrisonThinned ?? context.garrisonThinned)
      : null,
    travel: open && state.phase === 'approach' ? context.travel?.(cargo) ?? null : null,
    chosen: spine?.state.chosenOfferId === plan.id,
  }
  const closedCard = {
    distance: distance(player, cargo),
    bearing: 0,
    remainingEnemies: 0,
    totalEnemies: 0,
    cargoHealth: 0,
    cargoMaxHealth: state.cargoMaxHealth,
    progress: 0,
    canChoose: false,
    choices: [],
    outcome: null,
    consequence: null,
    abandonRemaining: null,
    active: false,
  }
  if (state.phase === 'unavailable') {
    return {
      ...base,
      ...closedCard,
      phase: 'unavailable',
      description: state.unavailableReason ?? 'Встреча недоступна.',
      hint: CARAVAN_BEAT_UNAVAILABLE_HINT,
    }
  }
  if (state.phase === 'declined') {
    return {
      ...base,
      ...closedCard,
      phase: 'declined',
      description: describeCaravanBeatDeclined(faction, plan.role, plan.owner, plan.placement),
      hint: CARAVAN_BEAT_DECLINED_HINT,
    }
  }
  if (base.dormant) {
    return {
      ...base,
      ...closedCard,
      cargoHealth: state.cargoHealth,
      phase: state.phase,
      description: describeCaravanBeatDormant(faction, plan.role, plan.owner, plan.placement),
      hint: CARAVAN_BEAT_DORMANT_HINT,
    }
  }

  let guidance = {
    bearing: Math.atan2(cargo.x - player.x, player.z - cargo.z) - heading,
    distance: distance(player, cargo),
  }
  let routeLabel = 'прямой ориентир'
  if (state.phase === 'approach') {
    const target: ExpeditionTarget = {
      kind: 'site',
      id: plan.id,
      key: `site:${plan.id}`,
      title,
      regionId: plan.regionId,
      regionLabel: '',
      position: plan.cargoStart,
      directDistance: distance(player, plan.cargoStart),
      task: '',
      stake: '',
      timeRemaining: null,
      exclusive: false,
      committed: false,
    }
    const charted = tracked || led
    const route = charted ? expedition?.route ?? null : plan.openingRoute
    const road = charted && expedition?.guidance
      ? expedition.guidance
      : buildExpeditionGuidance(getExpeditionGraph(blueprint), route, target, player, heading)
    if (road.next) {
      guidance = { bearing: road.bearing, distance: road.distance }
      routeLabel = road.arrived ? 'у телеги'
        : route?.status === 'road'
          ? road.connector ? 'подход к дороге'
            : plan.placement === 'bridge' ? 'по дороге к мосту' : 'по дороге к телеге'
          : 'по прямой, не дорога'
    }
  } else if (state.phase === 'delivering') {
    routeLabel = plan.placement === 'bridge' ? 'телега идёт по оси моста' : 'телега идёт по дороге'
  }

  const remaining = caravanBeatRemainingEnemies(state)
  const settled = isCaravanBeatSettled(state)
  const description = state.phase === 'approach'
    ? state.stagingStalled > 0
      ? describeCaravanBeatStagingWait(CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS - state.stagingStalled)
      : describeCaravanBeatApproach(faction, plan.role, plan.owner, plan.placement)
    : state.phase === 'fighting'
      ? describeCaravanBeatFight(plan.role, remaining)
      : state.phase === 'secured'
        ? describeCaravanBeatSecured(faction, plan.role)
        : state.phase === 'delivering' && state.outcome
          ? describeCaravanBeatDelivering(state.outcome)
          : state.consequence ?? describeCaravanBeatSecured(faction, plan.role)
  const abandonPhase = state.phase === 'fighting' || state.phase === 'secured' ||
    state.phase === 'delivering' ? state.phase : null
  const hint = abandonPhase && state.abandonRemaining !== null
    ? describeCaravanBeatAbandon(abandonPhase, plan.role, state.abandonRemaining)
    : describeCaravanBeatHint(
        settled ? 'settled' : state.phase as 'approach' | 'fighting' | 'secured' | 'delivering',
        plan.role,
        plan.placement,
        routeLabel,
      )

  const suppress = (expedition?.mode === 'selected' && !tracked) ||
    (expedition?.mode === 'campaign' && expedition.target?.committed === true)
  const near = distance(player, cargo) <= CARAVAN_BEAT_ACTIVATION_RADIUS
  // A spine run meets several carts, so one waiting on the road takes the field card only
  // when the player is at it or the compass leads there; otherwise the compass keeps the
  // objective's road and the cart waits in the journal and the atlas. A run without a spine
  // has the one bridge, which leads from the camp on, as it always did.
  const awaitedOnRoad = spine?.state.spine === true
    ? led
    : rootCompleted(blueprint, faction, context.objectives)
  const automatic = !settled && (state.phase !== 'approach' || near || awaitedOnRoad)
  const active = (tracked || automatic) &&
    (state.phase !== 'approach' || tracked || !suppress || near)

  return {
    ...base,
    phase: state.phase,
    description,
    hint,
    distance: guidance.distance,
    bearing: guidance.bearing,
    routeLabel,
    remainingEnemies: remaining,
    totalEnemies: state.combatants.filter((entry) => entry.enemy).length,
    cargoHealth: state.cargoHealth,
    cargoMaxHealth: state.cargoMaxHealth,
    progress: state.progress,
    canChoose: caravanBeatCanChoose(state, player),
    choices: state.phase === 'secured' ? buildChoices(context, plan) : [],
    outcome: state.outcome,
    consequence: state.consequence,
    abandonRemaining: state.abandonRemaining,
    active,
  }
}

/** Settled carts stay on the field HUD this close, so the outcome reads where it happened. */
const SETTLED_HUD_RADIUS = 60

function pickActiveBeat(beats: readonly CaravanBeatView[]): CaravanBeatView | null {
  const nearest = (list: readonly CaravanBeatView[]) =>
    list.reduce<CaravanBeatView | null>((best, entry) =>
      best === null || entry.distance < best.distance ? entry : best, null)
  const engaged = beats.filter((entry) => entry.active &&
    (entry.phase === 'fighting' || entry.phase === 'secured' || entry.phase === 'delivering'))
  if (engaged.length > 0) return nearest(engaged)
  const tracked = beats.find((entry) => entry.tracked && entry.active)
  if (tracked) return tracked
  const approaching = beats.filter((entry) => entry.active)
  if (approaching.length > 0) return nearest(approaching)
  return nearest(beats.filter((entry) =>
    (entry.phase === 'resolved' || entry.phase === 'lost' || entry.phase === 'escaped') &&
    entry.distance <= SETTLED_HUD_RADIUS))
}

export function buildCaravanBeatsView(
  context: CaravanBeatViewContext,
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState | null,
): CaravanBeatsView {
  if (!state) return { beats: [], active: null, opening: null, gate: null }
  const spine = { plans, state }
  const beats: CaravanBeatView[] = []
  for (const beat of state.beats) {
    const plan = plans.find((entry) => entry.id === beat.id)
    if (plan) beats.push(buildCaravanBeatView(context, plan, beat, spine))
  }
  const opening = caravanSpineHoldsCamp(plans, state)
    ? {
        offers: beats.filter((beat) => beat.slot === 'offer' && beat.phase === 'approach'),
        chosenId: state.chosenOfferId,
      }
    : null
  return {
    beats,
    active: pickActiveBeat(beats),
    opening,
    gate: state.spine
      ? {
          ...caravanSpineGate(state),
          objectiveId: context.blueprint.objectives[context.faction].finalNodeId,
        }
      : null,
  }
}

export interface CaravanBeatExpeditionTarget {
  id: string
  title: string
  regionId: string
  position: CaravanBeatPoint
  task: string
  stake: string
  /** W2-3 — the same price the beat's card quotes. */
  payout: ChoicePayoutView | null
  travel: ChoiceTravelView | null
}

/**
 * The beats the atlas may chart: anything the run can still meet and is not walking already.
 * A spine's dormant road beats are not charted until the camp's choice wakes them.
 */
export function caravanBeatExpeditionTargets(
  faction: Faction,
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState | null,
  travel?: (point: CaravanBeatPoint) => ChoiceTravelView | null,
): CaravanBeatExpeditionTarget[] {
  if (!state) return []
  const targets: CaravanBeatExpeditionTarget[] = []
  for (const beat of state.beats) {
    const plan = plans.find((entry) => entry.id === beat.id)
    if (
      !plan ||
      isCaravanBeatClosed(beat) ||
      beat.phase === 'delivering' ||
      isCaravanBeatDormant(plan, plans, state)
    ) {
      continue
    }
    const position = { x: beat.cargoX, z: beat.cargoZ }
    targets.push({
      id: plan.id,
      title: describeCaravanBeatTitle(plan.placement, faction, plan.role),
      regionId: plan.regionId,
      position,
      task: describeCaravanBeatTask(plan.placement),
      stake: state.spine ? CARAVAN_SPINE_STAKE : CARAVAN_BEAT_OPTIONAL_STAKE,
      payout: caravanBeatPayout(faction, plan),
      travel: travel?.(position) ?? null,
    })
  }
  return targets
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function serializeBeat(state: CaravanBeatState): SerializableState {
  return {
    id: state.id,
    placement: state.placement,
    regionId: state.regionId,
    phase: state.phase,
    cargoX: state.cargoX,
    cargoZ: state.cargoZ,
    cargoHealth: state.cargoHealth,
    cargoMaxHealth: state.cargoMaxHealth,
    progress: state.progress,
    outcome: state.outcome,
    consequence: state.consequence,
    rewardPaid: state.rewardPaid,
    unavailableReason: state.unavailableReason,
    abandonRemaining: state.abandonRemaining,
    stagingStalled: state.stagingStalled,
    combatants: state.combatants.map((entry) => ({ ...entry })),
  }
}

export function serializeCaravanBeatsState(state: CaravanBeatsState): SerializableState {
  return {
    version: CARAVAN_BEATS_VERSION,
    spine: state.spine,
    chosenOfferId: state.chosenOfferId,
    garrisonThinned: state.garrisonThinned,
    beats: state.beats.map(serializeBeat) as SerializableState[string],
  }
}

function isPhase(value: unknown): value is CaravanBeatPhase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value)
}

function isOutcome(value: unknown): value is CaravanBeatOutcome {
  return typeof value === 'string' && (CARAVAN_BEAT_OUTCOMES as readonly string[]).includes(value)
}

function readReason(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 500 ? value : null
}

function normalizeCombatants(
  value: unknown,
  fresh: readonly CaravanBeatCombatantState[],
): CaravanBeatCombatantState[] | null {
  if (!Array.isArray(value) || value.length !== fresh.length) return null
  const savedById = new Map<string, CaravanBeatCombatantState>()
  for (const item of value) {
    const entry = record(item)
    if (!entry || typeof entry.id !== 'string' || savedById.has(entry.id)) return null
    const expected = fresh.find((candidate) => candidate.id === entry.id)
    const health = finite(entry.health, 0, 10_000)
    const maxHealth = finite(entry.maxHealth, 0, 10_000)
    if (
      !expected ||
      entry.allegiance !== expected.allegiance ||
      entry.role !== expected.role ||
      entry.enemy !== expected.enemy ||
      typeof entry.defeated !== 'boolean' ||
      health === null ||
      maxHealth === null ||
      health > maxHealth ||
      (entry.defeated && health !== 0) ||
      (!entry.defeated && maxHealth > 0 && health <= 0) ||
      (maxHealth === 0 && health !== 0)
    ) {
      return null
    }
    savedById.set(entry.id, { ...expected, health, maxHealth, defeated: entry.defeated })
  }
  return fresh.map((entry) => savedById.get(entry.id) as CaravanBeatCombatantState)
}

function normalizeBeat(
  value: unknown,
  plan: CaravanBeatPlan,
  faction: Faction,
  blueprint: WorldBlueprint,
  version: 1 | typeof CARAVAN_BEATS_VERSION,
): CaravanBeatState | null {
  const source = record(value)
  if (
    !source ||
    source.id !== plan.id ||
    source.placement !== plan.placement ||
    source.regionId !== plan.regionId ||
    !isPhase(source.phase)
  ) {
    return null
  }
  if (source.phase === 'unavailable') {
    const reason = readReason(source.unavailableReason)
    if (!reason || source.rewardPaid !== false || source.outcome !== null) return null
    return createUnavailableCaravanBeatState(plan, reason)
  }
  const fresh = createCaravanBeatState(plan)
  const combatants = normalizeCombatants(source.combatants, fresh.combatants)
  const cargoX = finite(source.cargoX, blueprint.bounds.minX, blueprint.bounds.maxX)
  const cargoZ = finite(source.cargoZ, blueprint.bounds.minZ, blueprint.bounds.maxZ)
  const cargoHealth = finite(source.cargoHealth, 0, CARAVAN_BEAT_CARGO_HEALTH)
  const cargoMaxHealth = finite(source.cargoMaxHealth, CARAVAN_BEAT_CARGO_HEALTH, CARAVAN_BEAT_CARGO_HEALTH)
  const progress = finite(source.progress, 0, 1)
  const outcome = isOutcome(source.outcome) ? source.outcome : source.outcome === null ? null : undefined
  const consequence = source.consequence === null
    ? null
    : readReason(source.consequence) ?? undefined
  const abandonRemaining = source.abandonRemaining === null
    ? null
    : finite(source.abandonRemaining, 0, CARAVAN_BEAT_ABANDON_SECONDS) ?? undefined
  // A version-1 cart (PR A) never waited for room on the road.
  const stagingStalled = version === 1
    ? 0
    : finite(source.stagingStalled, 0, CARAVAN_BEAT_STAGING_GIVE_UP_SECONDS)
  if (
    !combatants || cargoX === null || cargoZ === null || cargoHealth === null ||
    cargoMaxHealth === null || progress === null || outcome === undefined ||
    consequence === undefined || abandonRemaining === undefined || stagingStalled === null ||
    typeof source.rewardPaid !== 'boolean' || source.unavailableReason !== null
  ) {
    return null
  }
  const phase = source.phase
  const rewardPaid = source.rewardPaid
  const current = { x: cargoX, z: cargoZ }
  if (Math.abs(caravanBeatDeliveryProgress(plan, current) - progress) > 0.02) return null
  // The stall clock only runs while the cart waits to be staged.
  if (stagingStalled > 0 && phase !== 'approach') return null
  const enemiesDown = combatants.every((entry) => !entry.enemy || entry.defeated)
  const spawned = combatants.every((entry) => entry.maxHealth > 0 || entry.defeated)
  const lane = outcome !== null && isCaravanBeatLaneOutcome(outcome) &&
    (phase === 'delivering' || phase === 'resolved')
  const atStart = distance(current, plan.cargoStart) <= POSITION_EPSILON
  const onLane = distance(current, caravanBeatLanePoint(plan, progress)) <= 1
  const undecided = outcome === null && consequence === null && !rewardPaid
  const valid = (() => {
    switch (phase) {
      case 'approach':
        return !spawned && undecided && abandonRemaining === null && atStart
      case 'declined':
        return plan.slot === 'offer' && !spawned && undecided && abandonRemaining === null &&
          atStart && cargoHealth === CARAVAN_BEAT_CARGO_HEALTH
      case 'fighting':
        return spawned && !enemiesDown && cargoHealth > 0 && undecided && atStart
      case 'secured':
        return enemiesDown && cargoHealth > 0 && undecided && atStart
      case 'delivering':
        return enemiesDown && outcome !== null && lane &&
          caravanBeatChoices(faction, plan).includes(outcome) &&
          consequence === null && !rewardPaid && onLane
      case 'resolved':
        return enemiesDown && outcome !== null && consequence !== null && rewardPaid &&
          abandonRemaining === null &&
          (lane ? progress >= 0.99 && onLane : progress === 0 && atStart)
      case 'lost':
        return cargoHealth === 0 && outcome === null && consequence !== null && !rewardPaid &&
          abandonRemaining === null && atStart
      case 'escaped':
        return plan.role === 'rob' && !enemiesDown && cargoHealth > 0 && outcome === null &&
          consequence !== null && !rewardPaid && abandonRemaining === null && atStart
    }
  })()
  if (!valid) return null
  return {
    id: plan.id,
    placement: plan.placement,
    regionId: plan.regionId,
    phase,
    cargoX,
    cargoZ,
    cargoHealth,
    cargoMaxHealth,
    progress,
    outcome,
    consequence,
    rewardPaid,
    unavailableReason: null,
    abandonRemaining,
    stagingStalled,
    combatants,
  }
}

/**
 * A spine's beats must tell one story: at most one offer met, every other offer then gone its
 * own way (or never stageable), nothing declined before a choice was made, and no road beat
 * touched while the camp still waits.
 */
function spineConsistent(plans: readonly CaravanBeatPlan[], state: CaravanBeatsState): boolean {
  const offers = state.beats.filter((beat) => isOfferBeat(plans, beat))
  const committed = offers.filter((beat) => COMMITTED_PHASES.includes(beat.phase))
  if (committed.length > 1) return false
  if (committed.length === 1 && offers.some((beat) => beat.phase === 'approach')) return false
  if (!openingCommitted(plans, state.beats) && offers.some((beat) => beat.phase === 'declined')) {
    return false
  }
  if (state.chosenOfferId !== null && !offers.some((beat) => beat.id === state.chosenOfferId)) return false
  if (!caravanSpineHoldsCamp(plans, state)) return true
  return state.beats.every((beat) => isOfferBeat(plans, beat) ||
    (beat.phase === 'approach' && beat.stagingStalled === 0))
}

/**
 * A saved block, checked against freshly derived plans. Null when anything disagrees.
 *
 * Version 1 (PR A) is a run without a spine, read against the crossing alone; version 2
 * carries the spine flag, the camp's choice and each cart's stall clock. The caller derives
 * `plans` from the same flag (`restoreCaravanSpine`), so a mismatch is a rejection here.
 */
export function normalizeCaravanBeatsState(
  value: unknown,
  blueprint: WorldBlueprint,
  faction: Faction,
  plans: readonly CaravanBeatPlan[],
): CaravanBeatsState | null {
  const source = record(value)
  const version = source?.version
  if (
    !source ||
    (version !== 1 && version !== CARAVAN_BEATS_VERSION) ||
    typeof source.garrisonThinned !== 'boolean' ||
    !Array.isArray(source.beats) ||
    source.beats.length !== plans.length
  ) {
    return null
  }
  const spine = version === 1 ? false : source.spine
  const chosenOfferId = version === 1 ? null : source.chosenOfferId
  if (typeof spine !== 'boolean' || (chosenOfferId !== null && typeof chosenOfferId !== 'string')) {
    return null
  }
  if (!spine && (chosenOfferId !== null || plans.some((plan) => plan.slot !== 'crossing'))) return null
  const saved = source.beats
  const beats: CaravanBeatState[] = []
  for (const [index, plan] of plans.entries()) {
    const beat = normalizeBeat(saved[index], plan, faction, blueprint, version)
    if (!beat) return null
    beats.push(beat)
  }
  const state: CaravanBeatsState = {
    version: CARAVAN_BEATS_VERSION,
    spine,
    chosenOfferId,
    garrisonThinned: source.garrisonThinned,
    beats,
  }
  return !spine || spineConsistent(plans, state) ? state : null
}

const LEGACY_SEIZE: Readonly<Record<Faction, CaravanBeatOutcome>> = {
  elf: 'take',
  guard: 'confiscate',
  villain: 'plunder',
}

const LEGACY_DELIVER: Readonly<Record<Faction, CaravanBeatOutcome>> = {
  elf: 'give',
  guard: 'deliver',
  villain: 'deliver',
}

/**
 * The old bridge block in the new shape. Phases and wounds carry over one for one, and an
 * outcome already paid keeps its words. Two cases need care:
 *
 * - The old «Забрать груз» becomes the side's own gold verb. It was paid in full then, so
 *   nothing is paid again.
 * - A villain who was walking the cart when the game updated has no walking verb any more.
 *   Nothing had been paid, so the cart goes back to the bridge, the choice opens again, and
 *   the engine says so. Nobody gets an outcome they did not choose.
 */
function migrateLegacyBridge(
  legacy: BridgeAmbushState,
  plan: CaravanBeatPlan,
  faction: Faction,
): { state: CaravanBeatState; reopened: boolean } {
  if (legacy.phase === 'unavailable') {
    return {
      state: createUnavailableCaravanBeatState(
        plan,
        legacy.unavailableReason ?? 'Мостовой переход недоступен.',
      ),
      reopened: false,
    }
  }
  const reopened = faction === 'villain' && legacy.phase === 'delivering'
  const outcome = legacy.outcome === 'seize'
    ? LEGACY_SEIZE[faction]
    : legacy.outcome === 'deliver' ? LEGACY_DELIVER[faction] : null
  return {
    state: {
      id: plan.id,
      placement: plan.placement,
      regionId: plan.regionId,
      phase: reopened ? 'secured' : legacy.phase,
      cargoX: reopened ? plan.cargoStart.x : legacy.cargoX,
      cargoZ: reopened ? plan.cargoStart.z : legacy.cargoZ,
      cargoHealth: legacy.cargoHealth,
      cargoMaxHealth: legacy.cargoMaxHealth,
      progress: reopened ? 0 : legacy.progress,
      outcome: reopened ? null : outcome,
      consequence: legacy.consequence,
      rewardPaid: legacy.rewardPaid,
      unavailableReason: null,
      abandonRemaining: null,
      stagingStalled: 0,
      combatants: legacy.combatants.map((entry) => ({ ...entry })),
    },
    reopened,
  }
}

export interface CaravanBeatsRestore {
  /** Null for a run saved before any beat existed: it keeps its original campaign. */
  state: CaravanBeatsState | null
  /** A present block was malformed; every beat is closed without a reward. */
  rejected: boolean
  /** A migrated villain delivery reopened its choice; the engine says so once. */
  reopened: boolean
}

/**
 * The beats a restored run continues with.
 *
 * - `caravanBeats` present → normalised; malformed means rejected, never repaired. A rejected
 *   spine keeps its spine: every cart is closed without a reward, which settles the camp and
 *   opens the finale's gate, so the run goes on rather than waiting on carts it cannot meet.
 * - Only the version-1 `bridgeAmbush` present → migrated (the shipped normaliser decides
 *   whether the old block is sound, exactly as it did before).
 * - Neither → a run from before the bridge existed, which stays without beats.
 *
 * `plans` must match `spine`; `restoreCaravanSpine` derives both from the saved block.
 */
export function restoreCaravanBeatsState(
  director: SerializableState | undefined,
  blueprint: WorldBlueprint,
  faction: Faction,
  plans: readonly CaravanBeatPlan[],
  spine = false,
): CaravanBeatsRestore {
  const saved = director?.caravanBeats
  if (saved !== undefined && saved !== null) {
    const state = normalizeCaravanBeatsState(saved, blueprint, faction, plans)
    if (state) return { state, rejected: false, reopened: false }
    return {
      state: {
        version: CARAVAN_BEATS_VERSION,
        spine,
        chosenOfferId: null,
        garrisonThinned: false,
        beats: plans.map((plan) => createUnavailableCaravanBeatState(
          plan,
          'Запись корована повреждена; награда не выдана.',
        )),
      },
      rejected: true,
      reopened: false,
    }
  }
  const legacy = director?.bridgeAmbush
  if (legacy === undefined || legacy === null) return { state: null, rejected: false, reopened: false }
  const beats = plans.map((plan) => createCaravanBeatState(plan))
  const crossing = plans.findIndex((plan) => plan.slot === 'crossing')
  const restored = normalizeBridgeAmbushState(
    legacy, blueprint, faction, createBridgeAmbushPlan(blueprint, faction),
  )
  let reopened = false
  if (crossing >= 0) {
    const migrated = migrateLegacyBridge(restored.state, plans[crossing], faction)
    beats[crossing] = migrated.state
    reopened = migrated.reopened
  }
  return {
    state: { version: CARAVAN_BEATS_VERSION, spine: false, chosenOfferId: null, garrisonThinned: false, beats },
    rejected: restored.rejected,
    reopened,
  }
}

// ---------------------------------------------------------------------------
// The сводка
// ---------------------------------------------------------------------------

export interface CaravanBeatSummary {
  placement: CaravanBeatPlacement
  regionId: string
  ending: CaravanBeatEnding
}

/**
 * The settled beats of a terminal save, for the сводка. Tolerant on purpose: the сводка is
 * built from a snapshot without a blueprint, so it reads the recorded ids rather than
 * re-deriving plans, and an entry it cannot read is simply left out of a postcard.
 */
export function summarizeCaravanBeats(value: unknown): CaravanBeatSummary[] {
  const source = record(value)
  if (!source || !Array.isArray(source.beats)) return []
  const summaries: CaravanBeatSummary[] = []
  for (const item of source.beats) {
    const beat = record(item)
    if (!beat || typeof beat.regionId !== 'string' || beat.regionId.length === 0) continue
    if (!(CARAVAN_BEAT_PLACEMENTS as readonly string[]).includes(String(beat.placement))) continue
    const placement = beat.placement as CaravanBeatPlacement
    if (beat.phase === 'resolved' && isOutcome(beat.outcome)) {
      summaries.push({ placement, regionId: beat.regionId, ending: beat.outcome })
    } else if (beat.phase === 'lost' || beat.phase === 'escaped') {
      summaries.push({ placement, regionId: beat.regionId, ending: beat.phase })
    }
  }
  return summaries
}
