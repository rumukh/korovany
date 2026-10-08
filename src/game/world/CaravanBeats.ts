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
  CARAVAN_BEAT_OPTIONAL_STAKE,
  CARAVAN_BEAT_UNAVAILABLE_HINT,
  describeCaravanBeatAbandon,
  describeCaravanBeatApproach,
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
import type { ActorRole, Allegiance, Faction, Objective } from '../types.ts'
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
export type CaravanBeatSlot = 'crossing'
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
  combatants: CaravanBeatCombatantState[]
}

export interface CaravanBeatsState {
  version: 1
  /** A burned cart already thinned the palace finale; a second burn does not. */
  garrisonThinned: boolean
  beats: CaravanBeatState[]
}

export const CARAVAN_BEATS_VERSION = 1
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
  'approach', 'fighting', 'secured', 'delivering', 'resolved', 'lost', 'escaped', 'unavailable',
]

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
function marketSite(blueprint: WorldBlueprint): WorldSite | null {
  return blueprint.sites.find((site) => site.kind === 'shop') ??
    blueprint.sites.find((site) => site.kind === 'settlement' || site.kind === 'recovery') ??
    null
}

function createCrossingBeatPlan(blueprint: WorldBlueprint, faction: Faction): CaravanBeatPlan | null {
  const bridge = createBridgeAmbushPlan(blueprint, faction)
  if (!bridge) return null
  const opponent = bridgeAmbushEnemyFaction(blueprint, faction, bridge)
  const market = marketSite(blueprint)
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

export function createCaravanBeatsState(plans: readonly CaravanBeatPlan[]): CaravanBeatsState {
  return {
    version: CARAVAN_BEATS_VERSION,
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
  if (isCaravanBeatSettled(state)) return false
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
  placement: CaravanBeatPlacement
  role: CaravanBeatRole
  owner: Faction
  tier: CaravanBeatTier
  phase: CaravanBeatPhase
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
  active: boolean
  tracked: boolean
}

export interface CaravanBeatsView {
  beats: CaravanBeatView[]
  /** The one the field HUD shows, or null. */
  active: CaravanBeatView | null
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

export function buildCaravanBeatView(
  context: CaravanBeatViewContext,
  plan: CaravanBeatPlan,
  state: CaravanBeatState,
): CaravanBeatView {
  const { blueprint, faction, player, heading, expedition } = context
  const cargo = { x: state.cargoX, z: state.cargoZ }
  const title = describeCaravanBeatTitle(plan.placement, faction, plan.role)
  const tracked = expedition?.mode === 'selected' &&
    expedition.target?.kind === 'caravanBeat' && expedition.target.id === plan.id
  const base = {
    id: plan.id,
    placement: plan.placement,
    role: plan.role,
    owner: plan.owner,
    tier: plan.tier,
    title,
    regionLabel: regionLabel(blueprint, plan.regionId),
    x: cargo.x,
    z: cargo.z,
    escort: escortRoles(state, plan),
    tracked,
  }
  if (state.phase === 'unavailable') {
    return {
      ...base,
      phase: 'unavailable',
      description: state.unavailableReason ?? 'Встреча недоступна.',
      hint: CARAVAN_BEAT_UNAVAILABLE_HINT,
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
    const route = tracked ? expedition?.route ?? null : plan.openingRoute
    const road = tracked && expedition?.guidance
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
    ? describeCaravanBeatApproach(faction, plan.role, plan.owner, plan.placement)
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
  const automatic = !settled &&
    (state.phase !== 'approach' || near || rootCompleted(blueprint, faction, context.objectives))
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
  if (!state) return { beats: [], active: null }
  const beats: CaravanBeatView[] = []
  for (const beat of state.beats) {
    const plan = plans.find((entry) => entry.id === beat.id)
    if (plan) beats.push(buildCaravanBeatView(context, plan, beat))
  }
  return { beats, active: pickActiveBeat(beats) }
}

export interface CaravanBeatExpeditionTarget {
  id: string
  title: string
  regionId: string
  position: CaravanBeatPoint
  task: string
  stake: string
}

/** The beats the atlas may chart: anything not yet settled and not being walked already. */
export function caravanBeatExpeditionTargets(
  faction: Faction,
  plans: readonly CaravanBeatPlan[],
  state: CaravanBeatsState | null,
): CaravanBeatExpeditionTarget[] {
  if (!state) return []
  const targets: CaravanBeatExpeditionTarget[] = []
  for (const beat of state.beats) {
    const plan = plans.find((entry) => entry.id === beat.id)
    if (!plan || isCaravanBeatSettled(beat) || beat.phase === 'delivering') continue
    targets.push({
      id: plan.id,
      title: describeCaravanBeatTitle(plan.placement, faction, plan.role),
      regionId: plan.regionId,
      position: { x: beat.cargoX, z: beat.cargoZ },
      task: describeCaravanBeatTask(plan.placement),
      stake: CARAVAN_BEAT_OPTIONAL_STAKE,
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
    combatants: state.combatants.map((entry) => ({ ...entry })),
  }
}

export function serializeCaravanBeatsState(state: CaravanBeatsState): SerializableState {
  return {
    version: CARAVAN_BEATS_VERSION,
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
  if (
    !combatants || cargoX === null || cargoZ === null || cargoHealth === null ||
    cargoMaxHealth === null || progress === null || outcome === undefined ||
    consequence === undefined || abandonRemaining === undefined ||
    typeof source.rewardPaid !== 'boolean' || source.unavailableReason !== null
  ) {
    return null
  }
  const phase = source.phase
  const rewardPaid = source.rewardPaid
  const current = { x: cargoX, z: cargoZ }
  if (Math.abs(caravanBeatDeliveryProgress(plan, current) - progress) > 0.02) return null
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
    combatants,
  }
}

/** The version-1 block, checked against freshly derived plans. Null when anything disagrees. */
export function normalizeCaravanBeatsState(
  value: unknown,
  blueprint: WorldBlueprint,
  faction: Faction,
  plans: readonly CaravanBeatPlan[],
): CaravanBeatsState | null {
  const source = record(value)
  if (
    !source ||
    source.version !== CARAVAN_BEATS_VERSION ||
    typeof source.garrisonThinned !== 'boolean' ||
    !Array.isArray(source.beats) ||
    source.beats.length !== plans.length
  ) {
    return null
  }
  const saved = source.beats
  const beats: CaravanBeatState[] = []
  for (const [index, plan] of plans.entries()) {
    const beat = normalizeBeat(saved[index], plan, faction, blueprint)
    if (!beat) return null
    beats.push(beat)
  }
  return { version: CARAVAN_BEATS_VERSION, garrisonThinned: source.garrisonThinned, beats }
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
 * - `caravanBeats` present → normalised; malformed means rejected, never repaired.
 * - Only the version-1 `bridgeAmbush` present → migrated (the shipped normaliser decides
 *   whether the old block is sound, exactly as it did before).
 * - Neither → a run from before the bridge existed, which stays without beats.
 */
export function restoreCaravanBeatsState(
  director: SerializableState | undefined,
  blueprint: WorldBlueprint,
  faction: Faction,
  plans: readonly CaravanBeatPlan[],
): CaravanBeatsRestore {
  const saved = director?.caravanBeats
  if (saved !== undefined && saved !== null) {
    const state = normalizeCaravanBeatsState(saved, blueprint, faction, plans)
    if (state) return { state, rejected: false, reopened: false }
    return {
      state: {
        version: CARAVAN_BEATS_VERSION,
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
    state: { version: CARAVAN_BEATS_VERSION, garrisonThinned: false, beats },
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
