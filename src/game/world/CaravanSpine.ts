/**
 * W2-2, PR B — «грабить корованы» as the spine of every run: where its caravans stand.
 *
 * PR A gave a caravan each side's own verb, but a run still met one, the bridge, and could
 * walk past it. Here every new run gets its caravans in fixed places on its real roads:
 *
 * - **The camp's choice.** Two offers near the start: one on the road to the finale (the
 *   trunk), one on another road, far enough apart that their activation circles never touch.
 *   Different owners, one light and one rich, so the choice is one of pay and risk. The camp's
 *   node closes when the chosen cart settles (`CaravanBeats.isCaravanOpeningSettled`).
 * - **The crossing.** The bridge ambush, unchanged. Every critical road crosses the river,
 *   so it is always on the trunk.
 * - **One more road beat** on the trunk, clear of the bridge along it and after it when the
 *   road allows: on the way to the finale, never a detour.
 *
 * The finale opens once `CARAVAN_SPINE_FINALE_GATE` of them have settled.
 *
 * A road beat's cart stands on a 24 m lane of one road leg (the bridge's lane length), 12–36 m
 * from its square's centre; every leg is 40 m, so the lane never leaves it. Its placement is
 * the square's zone, as the letter has it: a forest road for the elves, a mountain pass by the
 * villain's fort, an open road in the palace's and the people's zones.
 *
 * Deterministic from the blueprint and the faction. Geometry decides; only near-ties, tiers
 * and owners are drawn, from the run's own `deriveSeed(seed, 'caravan-beats:' + faction)`
 * stream, which nothing else reads and nothing saves. The blueprint is only read, so world
 * fingerprints and generator streams are exactly what they were.
 */
import {
  getFactionStartPosition2D,
  getSiteWorldPosition2D,
  isInsideRegionWater,
} from '../content/registry.ts'
import { RandomStream } from '../random/RandomStream.ts'
import { deriveSeed } from '../random/seed.ts'
import type { SerializableState } from '../run/runTypes.ts'
import type { Faction } from '../types.ts'
import {
  approachSign,
  deterministicSide,
  translated,
  withinBounds,
} from './BridgeAmbush.ts'
import {
  caravanBeatEnemyRoles,
  caravanMarketSite,
  createCaravanBeatPlans,
  createCaravanBeatsState,
  restoreCaravanBeatsState,
  CARAVAN_BEATS_VERSION,
  type CaravanBeatPlacement,
  type CaravanBeatPlan,
  type CaravanBeatPoint,
  type CaravanBeatRole,
  type CaravanBeatSlot,
  type CaravanBeatsRestore,
  type CaravanBeatsState,
  type CaravanBeatTier,
} from './CaravanBeats.ts'
import {
  getExpeditionGraph,
  planExpeditionRoute,
  validateExpeditionRoute,
  type ExpeditionGraph,
  type ExpeditionRoute,
} from './ExpeditionPlanner.ts'
import { FINALE_PROFILES } from './FinaleDirector.ts'
import type { WorldBlueprint } from './worldTypes.ts'

/** Where a road lane starts and ends, from its square's centre along the leg. */
export const CARAVAN_LANE_NEAR = 12
export const CARAVAN_LANE_FAR = 36
/** Lanes keep this far from water, sampled along the lane. */
export const CARAVAN_LANE_WATER_CLEARANCE = 4
/** …and from any site: a cart is not parked in somebody's yard. */
export const CARAVAN_LANE_SITE_CLEARANCE = 10
/**
 * …and from every objective site but the camp. A contract's builders scatter their fighters
 * 17–22 m round its site, and a cart's staging keeps 16 m of road clear, so 45 m keeps the
 * two fights apart.
 */
export const CARAVAN_LANE_OBJECTIVE_CLEARANCE = 45
/** The camp is where the choice is made, not where a cart stands. */
export const CARAVAN_LANE_CAMP_CLEARANCE = 40
/** Outside the finale's 32 m engage radius plus the cart's 34 m activation. */
export const CARAVAN_LANE_FINALE_CLEARANCE = 70
/** Road beats keep their distance from the bridge's cart, so the two never stage together. */
export const CARAVAN_LANE_CROSSING_CLEARANCE = 90

/** The trunk offer: this far along the road to the finale, aiming for the middle. */
export const CARAVAN_OFFER_TRUNK_WINDOW = { min: 60, max: 220, target: 120 } as const
/** The other offer: this far from the start by road, off the trunk. */
export const CARAVAN_OFFER_BRANCH_WINDOW = { min: 60, max: 240, target: 130 } as const
/** The offers' activation circles (34 m each) never touch: walking up to one is choosing it. */
export const CARAVAN_OFFER_SEPARATION = 70
/** Where both offers may stand when the two-roads pattern does not fit the world. */
export const CARAVAN_OFFER_WIDE_WINDOW = { min: 50, max: 320, firstTarget: 120, secondTarget: 160 } as const
/** The road beat keeps this much trunk between itself and the bridge. */
export const CARAVAN_ROAD_BEAT_CROSSING_GAP = 80
/** …and this much air between itself and either offer. */
export const CARAVAN_ROAD_BEAT_OFFER_GAP = 60
/** …and stands this far along the trunk at least, and this far short of its end. */
export const CARAVAN_ROAD_BEAT_START = 160
export const CARAVAN_ROAD_BEAT_END_MARGIN = 60

const LANE_HALF = (CARAVAN_LANE_FAR - CARAVAN_LANE_NEAR) / 2
const LANE_MIDDLE = (CARAVAN_LANE_FAR + CARAVAN_LANE_NEAR) / 2
const LANE_SAMPLES = 8
/** A lane is on the trunk when its middle lies this close to the trunk's road. */
const TRUNK_TOLERANCE = 2
/** Metres of jitter a near-tie may be broken by. */
const TIE_JITTER = 15
const UNKNOWN_ROAD = { discoveredRegionIds: new Set<string>(), risks: new Map() }

/** How the camp's two offers were found. Reported, so the placement test can count them. */
export type CaravanOpeningPattern = 'twoRoads' | 'wide' | 'single' | 'none'

export interface CaravanSpinePlan {
  /** Offers first, then the crossing, then the road beat: the saved beats' order. */
  plans: CaravanBeatPlan[]
  opening: CaravanOpeningPattern
  /** The road from the start to the finale, in metres. */
  trunkLength: number
  /** Each plan's distance along the trunk, or null for one off it. */
  along: ReadonlyMap<string, number | null>
}

interface Lane {
  legId: string
  regionId: string
  axis: CaravanBeatPoint
  mid: CaravanBeatPoint
  placement: CaravanBeatPlacement
  /** By road from the start. */
  roadDistance: number
  /** Along the trunk, when the lane is on it. */
  along: number | null
  approach: ExpeditionRoute
}

interface LaneGeometry {
  lane: Lane
  sign: -1 | 1
  cargoStart: CaravanBeatPoint
  deliveryEnd: CaravanBeatPoint
  alternateApproach: CaravanBeatPoint
  openingRoute: ExpeditionRoute
  deliveryRoute: ExpeditionRoute
  enemyPoints: CaravanBeatPoint[]
  protectorPoint: CaravanBeatPoint
}

interface BeatSpec {
  role: CaravanBeatRole
  owner: Faction
  opponent: Faction
  tier: CaravanBeatTier
}

function distance(first: CaravanBeatPoint, second: CaravanBeatPoint): number {
  return Math.hypot(first.x - second.x, first.z - second.z)
}

/** Arc length along a route to the point of it nearest `point`, and how far off it that is. */
function alongRoute(route: ExpeditionRoute, point: CaravanBeatPoint): { along: number; off: number } {
  let travelled = 0
  let best = { along: Number.POSITIVE_INFINITY, off: Number.POSITIVE_INFINITY }
  for (const leg of route.legs) {
    const dx = leg.to.x - leg.from.x
    const dz = leg.to.z - leg.from.z
    const length = Math.hypot(dx, dz)
    const t = length < 1e-6
      ? 0
      : Math.max(0, Math.min(1, ((point.x - leg.from.x) * dx + (point.z - leg.from.z) * dz) / (length * length)))
    const off = distance(point, { x: leg.from.x + dx * t, z: leg.from.z + dz * t })
    if (off < best.off) best = { along: travelled + length * t, off }
    travelled += length
  }
  return best
}

function placementOf(blueprint: WorldBlueprint, regionId: string): CaravanBeatPlacement {
  const biome = blueprint.regions.find((region) => region.id === regionId)?.biome
  return biome === 'forest' ? 'forest' : biome === 'fort' ? 'pass' : 'open'
}

/** Every traversable road leg a cart could stand on, with its road distance and trunk place. */
function candidateLanes(
  blueprint: WorldBlueprint,
  faction: Faction,
  graph: ExpeditionGraph,
  start: CaravanBeatPoint,
  trunk: ExpeditionRoute | null,
  crossing: CaravanBeatPlan | null,
): Lane[] {
  const camp = getSiteWorldPosition2D(blueprint, blueprint.starts[faction])
  const finale = getSiteWorldPosition2D(blueprint, blueprint.finales[faction])
  const sites = blueprint.sites
    .map((site) => getSiteWorldPosition2D(blueprint, site))
    .filter((point): point is NonNullable<typeof point> => point !== undefined && point !== null)
  const objectiveSites = blueprint.objectives[faction].nodes
    .filter((node) => node.siteId !== blueprint.starts[faction])
    .map((node) => getSiteWorldPosition2D(blueprint, node.siteId))
    .filter((point): point is NonNullable<typeof point> => point !== undefined && point !== null)
  const bridgeRegions = new Set(blueprint.bridges.map((bridge) => String(bridge.regionId)))
  const lanes: Lane[] = []
  for (const road of graph.roads) {
    if (!road.traversable || bridgeRegions.has(road.regionId)) continue
    const dx = road.edge.x - road.center.x
    const dz = road.edge.z - road.center.z
    const legLength = Math.hypot(dx, dz)
    if (legLength < CARAVAN_LANE_FAR + 1) continue
    const axis = { x: dx / legLength, z: dz / legLength }
    const near = translated(road.center, axis, CARAVAN_LANE_NEAR)
    const far = translated(road.center, axis, CARAVAN_LANE_FAR)
    const mid = translated(road.center, axis, LANE_MIDDLE)
    let clear = true
    for (let step = 0; step <= LANE_SAMPLES && clear; step += 1) {
      const point = {
        x: near.x + (far.x - near.x) * step / LANE_SAMPLES,
        z: near.z + (far.z - near.z) * step / LANE_SAMPLES,
      }
      if (isInsideRegionWater(blueprint, road.regionId, point.x, point.z, CARAVAN_LANE_WATER_CLEARANCE)) {
        clear = false
      } else if (sites.some((site) => distance(site, point) < CARAVAN_LANE_SITE_CLEARANCE)) {
        clear = false
      }
    }
    if (!clear) continue
    if (objectiveSites.some((site) => distance(site, mid) < CARAVAN_LANE_OBJECTIVE_CLEARANCE)) continue
    if (camp && distance(camp, mid) < CARAVAN_LANE_CAMP_CLEARANCE) continue
    if (finale && distance(finale, mid) < CARAVAN_LANE_FINALE_CLEARANCE) continue
    if (crossing && distance(crossing.cargoStart, mid) < CARAVAN_LANE_CROSSING_CLEARANCE) continue
    const approach = planExpeditionRoute(graph, start, mid, UNKNOWN_ROAD)
    if (approach.status !== 'road') continue
    const onTrunk = trunk ? alongRoute(trunk, mid) : null
    lanes.push({
      legId: road.id,
      regionId: road.regionId,
      axis,
      mid,
      placement: placementOf(blueprint, road.regionId),
      roadDistance: approach.roadDistance + approach.connectorDistance,
      along: onTrunk && onTrunk.off < TRUNK_TOLERANCE ? onTrunk.along : null,
      approach,
    })
  }
  return lanes.sort((left, right) => left.legId.localeCompare(right.legId))
}

/**
 * The cart's lane as the bridge lays out its own: the cart stands on the near end, is walked
 * to the far end, and its escort and its own soldier stand where the bridge's would. Null
 * when any of it is wet, out of bounds or off the road.
 */
function laneGeometry(
  blueprint: WorldBlueprint,
  faction: Faction,
  graph: ExpeditionGraph,
  start: CaravanBeatPoint,
  lane: Lane,
): LaneGeometry | null {
  const sign = approachSign(lane.approach, lane.mid, lane.axis, start)
  const cargoStart = translated(lane.mid, lane.axis, sign * LANE_HALF)
  const deliveryEnd = translated(lane.mid, lane.axis, -sign * LANE_HALF)
  const side = deterministicSide(blueprint.seed, `${faction}:${lane.legId}`)
  const alternateApproach = translated(cargoStart, lane.axis, sign * 1.5, side * 7)
  const openingRoute = planExpeditionRoute(graph, start, cargoStart, UNKNOWN_ROAD)
  const deliveryRoute = planExpeditionRoute(graph, cargoStart, deliveryEnd, UNKNOWN_ROAD)
  if (
    openingRoute.status !== 'road' ||
    deliveryRoute.status !== 'road' ||
    validateExpeditionRoute(graph, openingRoute).length > 0 ||
    validateExpeditionRoute(graph, deliveryRoute).length > 0
  ) {
    return null
  }
  const dry = (point: CaravanBeatPoint, margin: number, clearance: number) =>
    withinBounds(blueprint, point, margin) &&
    !isInsideRegionWater(blueprint, lane.regionId, point.x, point.z, clearance)
  if (![cargoStart, deliveryEnd, alternateApproach].every((point) => dry(point, 2, 1.4))) return null
  const enemyPoints = [
    translated(cargoStart, lane.axis, sign * 2.8, side * -2.5),
    translated(cargoStart, lane.axis, sign * -2.8, side * -1.8),
    translated(cargoStart, lane.axis, sign * -3, side * -2.7),
  ]
  const protectorPoint = translated(cargoStart, lane.axis, sign * -4.2, side * 1.2)
  if (![...enemyPoints, protectorPoint].every((point) => dry(point, 1, 0.9))) return null
  return {
    lane, sign, cargoStart, deliveryEnd, alternateApproach, openingRoute, deliveryRoute,
    enemyPoints, protectorPoint,
  }
}

function lanePlan(
  blueprint: WorldBlueprint,
  faction: Faction,
  geometry: LaneGeometry,
  slot: CaravanBeatSlot,
  spec: BeatSpec,
): CaravanBeatPlan {
  const id = `caravan-beat:${geometry.lane.legId}`
  const market = caravanMarketSite(blueprint)
  const defending = spec.role === 'defend'
  return {
    id,
    slot,
    placement: geometry.lane.placement,
    regionId: geometry.lane.regionId,
    bridgeId: null,
    axis: geometry.lane.axis,
    approachSign: geometry.sign,
    anchor: geometry.lane.mid,
    cargoStart: geometry.cargoStart,
    alternateApproach: geometry.alternateApproach,
    deliveryEnd: geometry.deliveryEnd,
    openingRoute: geometry.openingRoute,
    deliveryRoute: geometry.deliveryRoute,
    spawnPoints: [
      ...geometry.enemyPoints.map((point, index) => ({ ...point, combatantId: `${id}:enemy:${index}` })),
      { ...geometry.protectorPoint, combatantId: `${id}:protector:0` },
    ],
    role: spec.role,
    tier: spec.tier,
    owner: spec.owner,
    opponent: spec.opponent,
    enemyRoles: caravanBeatEnemyRoles(spec.opponent, spec.tier),
    protectorRole: defending && faction === 'guard' ? 'soldier' : null,
    marketSiteId: market?.id ?? null,
    marketRegionId: market ? String(market.regionId) : null,
  }
}

/**
 * The camp's two carts, by side. The elves and the villain rob the two other sides' carts;
 * the palace guard gets two orders, an escort of its own cart against one enemy and a raid
 * on the other's, so each side meets both of its enemies at the camp.
 */
function offerSpecs(faction: Faction, rng: RandomStream): [BeatSpec, BeatSpec] {
  const lightFirst = rng.next() < 0.5
  const swapOwners = rng.next() < 0.5
  const tiers: [CaravanBeatTier, CaravanBeatTier] = lightFirst ? ['light', 'rich'] : ['rich', 'light']
  const rob = (owner: Faction, tier: CaravanBeatTier): BeatSpec => ({ role: 'rob', owner, opponent: owner, tier })
  if (faction === 'guard') {
    const raided: Faction = swapOwners ? 'villain' : 'elf'
    const raiders: Faction = raided === 'elf' ? 'villain' : 'elf'
    const escort: BeatSpec = { role: 'defend', owner: 'guard', opponent: raiders, tier: tiers[0] }
    return [escort, rob(raided, tiers[1])]
  }
  const owners: [Faction, Faction] = faction === 'elf' ? ['guard', 'villain'] : ['guard', 'elf']
  if (swapOwners) owners.reverse()
  return [rob(owners[0], tiers[0]), rob(owners[1], tiers[1])]
}

/** The road beat robs (or, for the guard, raids) the side its finale is fought against. */
function roadSpec(faction: Faction): BeatSpec {
  const owner = FINALE_PROFILES[faction].enemyFaction
  return { role: 'rob', owner, opponent: owner, tier: 'standard' }
}

const SPINE_CACHE = new WeakMap<WorldBlueprint, Map<Faction, CaravanSpinePlan>>()

/**
 * Every caravan a new run meets, in the order its beats are saved. Pure and cached per
 * blueprint and faction, like the expedition graph it is planned on.
 */
export function planCaravanSpine(blueprint: WorldBlueprint, faction: Faction): CaravanSpinePlan {
  const cached = SPINE_CACHE.get(blueprint)?.get(faction)
  if (cached) return cached
  const plan = computeCaravanSpine(blueprint, faction)
  const byFaction = SPINE_CACHE.get(blueprint) ?? new Map<Faction, CaravanSpinePlan>()
  byFaction.set(faction, plan)
  SPINE_CACHE.set(blueprint, byFaction)
  return plan
}

function computeCaravanSpine(blueprint: WorldBlueprint, faction: Faction): CaravanSpinePlan {
  const crossing = createCaravanBeatPlans(blueprint, faction)[0] ?? null
  const start = getFactionStartPosition2D(blueprint, faction)
  const finale = getSiteWorldPosition2D(blueprint, blueprint.finales[faction])
  const along = new Map<string, number | null>()
  if (!start || !finale) {
    if (crossing) along.set(crossing.id, null)
    return { plans: crossing ? [crossing] : [], opening: 'none', trunkLength: 0, along }
  }
  const graph = getExpeditionGraph(blueprint)
  const trunkRoute = planExpeditionRoute(graph, start, finale, UNKNOWN_ROAD)
  const trunk = trunkRoute.status === 'road' ? trunkRoute : null
  const trunkLength = trunk ? trunk.roadDistance + trunk.connectorDistance : 0
  const lanes = candidateLanes(blueprint, faction, graph, start, trunk, crossing)
  const rng = new RandomStream(deriveSeed(blueprint.seed, `caravan-beats:${faction}`))
  const geometry = new Map<string, LaneGeometry | null>()
  const shaped = (lane: Lane): LaneGeometry | null => {
    if (!geometry.has(lane.legId)) {
      geometry.set(lane.legId, laneGeometry(blueprint, faction, graph, start, lane))
    }
    return geometry.get(lane.legId) ?? null
  }
  /** The candidate nearest `target`, ties broken by the run's own stream; one draw each. */
  const pick = (pool: readonly Lane[], target: number, key: (lane: Lane) => number): LaneGeometry | null => {
    const scored = pool.map((lane) => ({ lane, score: Math.abs(key(lane) - target) + rng.next() * TIE_JITTER }))
    scored.sort((left, right) => left.score - right.score || left.lane.legId.localeCompare(right.lane.legId))
    for (const { lane } of scored) {
      const shape = shaped(lane)
      if (shape) return shape
    }
    return null
  }

  const trunkLanes = lanes.filter((lane) => lane.along !== null)
  let first = pick(
    trunkLanes.filter((lane) => (lane.along ?? 0) >= CARAVAN_OFFER_TRUNK_WINDOW.min &&
      (lane.along ?? 0) <= CARAVAN_OFFER_TRUNK_WINDOW.max),
    CARAVAN_OFFER_TRUNK_WINDOW.target,
    (lane) => lane.along ?? 0,
  )
  const apartFrom = (anchor: LaneGeometry | null) => (lane: Lane) =>
    anchor !== null && lane.legId !== anchor.lane.legId &&
    distance(lane.mid, anchor.lane.mid) >= CARAVAN_OFFER_SEPARATION
  let second = first
    ? pick(
        lanes.filter((lane) => lane.along === null &&
          lane.roadDistance >= CARAVAN_OFFER_BRANCH_WINDOW.min &&
          lane.roadDistance <= CARAVAN_OFFER_BRANCH_WINDOW.max &&
          apartFrom(first)(lane)),
        CARAVAN_OFFER_BRANCH_WINDOW.target,
        (lane) => lane.roadDistance,
      )
    : null
  let opening: CaravanOpeningPattern = 'twoRoads'
  if (!first || !second) {
    // The world has no second road near the camp: both offers come from anywhere within
    // reach, still apart. Same and wider windows, so a run never starts without a choice
    // it could have had.
    const pool = lanes.filter((lane) => lane.roadDistance >= CARAVAN_OFFER_WIDE_WINDOW.min &&
      lane.roadDistance <= CARAVAN_OFFER_WIDE_WINDOW.max)
    first = pick(pool, CARAVAN_OFFER_WIDE_WINDOW.firstTarget, (lane) => lane.roadDistance)
    second = first
      ? pick(pool.filter(apartFrom(first)), CARAVAN_OFFER_WIDE_WINDOW.secondTarget,
        (lane) => lane.roadDistance)
      : null
    opening = first && second ? 'wide' : first ? 'single' : 'none'
  }

  const offers = [first, second].filter((entry): entry is LaneGeometry => entry !== null)
  const crossingAlong = crossing && trunk ? alongRoute(trunk, crossing.anchor).along : null
  const roadPool = trunkLanes.filter((lane) => {
    const at = lane.along ?? 0
    return at >= CARAVAN_ROAD_BEAT_START &&
      at <= trunkLength - CARAVAN_ROAD_BEAT_END_MARGIN &&
      (crossingAlong === null || Math.abs(at - crossingAlong) >= CARAVAN_ROAD_BEAT_CROSSING_GAP) &&
      offers.every((offer) => offer.lane.legId !== lane.legId &&
        distance(offer.lane.mid, lane.mid) >= CARAVAN_ROAD_BEAT_OFFER_GAP)
  })
  // After the bridge when the road allows, halfway from it to the finale; else before it.
  const afterCrossing = crossingAlong === null
    ? roadPool
    : roadPool.filter((lane) => (lane.along ?? 0) > crossingAlong)
  const road = afterCrossing.length > 0
    ? pick(afterCrossing, crossingAlong === null
      ? trunkLength * 0.55
      : (crossingAlong + trunkLength) / 2, (lane) => lane.along ?? 0)
    : pick(roadPool, crossingAlong === null
      ? trunkLength * 0.55
      : (crossingAlong + CARAVAN_ROAD_BEAT_START) / 2, (lane) => lane.along ?? 0)

  const specs = offerSpecs(faction, rng)
  const plans: CaravanBeatPlan[] = offers.map((offer, index) =>
    lanePlan(blueprint, faction, offer, 'offer', specs[index]))
  if (crossing) plans.push(crossing)
  if (road) plans.push(lanePlan(blueprint, faction, road, 'road', roadSpec(faction)))
  for (const plan of plans) {
    const placed = trunk ? alongRoute(trunk, plan.anchor) : null
    along.set(plan.id, placed && placed.off < TRUNK_TOLERANCE ? placed.along : null)
  }
  return { plans, opening, trunkLength, along }
}

/** A new run's caravans: the spine's plans and their fresh state. */
export function createCaravanSpine(
  blueprint: WorldBlueprint,
  faction: Faction,
): { plans: CaravanBeatPlan[]; state: CaravanBeatsState } {
  const plans = planCaravanSpine(blueprint, faction).plans
  return { plans, state: createCaravanBeatsState(plans, true) }
}

export interface CaravanSpineRestore extends CaravanBeatsRestore {
  /** The plans the restored state was read against: the spine's, or the crossing alone. */
  plans: CaravanBeatPlan[]
}

/**
 * A continued run's caravans. Which plans apply is read off the saved block first: a version-2
 * spine gets the spine; PR A's version 1, a non-spine version 2, an old `bridgeAmbush` block
 * and a run from before any caravan keep the crossing alone and the campaign they started with.
 */
export function restoreCaravanSpine(
  director: SerializableState | undefined,
  blueprint: WorldBlueprint,
  faction: Faction,
): CaravanSpineRestore {
  const saved = director?.caravanBeats
  const block = saved && typeof saved === 'object' && !Array.isArray(saved)
    ? saved as Record<string, unknown>
    : null
  const spine = block?.version === CARAVAN_BEATS_VERSION && block.spine === true
  const plans = spine
    ? planCaravanSpine(blueprint, faction).plans
    : createCaravanBeatPlans(blueprint, faction)
  return { ...restoreCaravanBeatsState(director, blueprint, faction, plans, spine), plans }
}
