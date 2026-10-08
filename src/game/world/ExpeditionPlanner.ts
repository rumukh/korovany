import {
  getBlueprintRegionBounds,
  getRegionRoadLegs,
  getRegionRiverLegs,
  getRegionWaterBounds,
  getSiteWorldPosition2D,
  type RegionRoadLeg,
} from '../content/registry.ts'
import { formatRegionGridLabel, generatedSiteLabel } from '../content/gameCopy.ts'
import type {
  CampaignContractView,
  ChoicePayoutView,
  ChoiceTravelView,
  ChronicleRumourView,
  Faction,
  Objective,
} from '../types.ts'
import type { SerializableState } from '../run/runTypes.ts'
import { getReadyObjectiveNodes } from './CampaignDirector.ts'
import type { RegionChronicleState } from './Chronicle.ts'
import type { WorldBlueprint, WorldBounds } from './worldTypes.ts'

export const EXPEDITION_VERSION = 1
export const MAX_EXPEDITION_POINTS = 128
export const MAX_EXPEDITION_REGIONS = 25
/** A dry straight approach this short replaces a road detour. docs/13 records why 60 m. */
export const DIRECT_APPROACH_METERS = 60
/** Up to this far only when the road itinerary would at least double the walk, or is missing. */
export const DIRECT_APPROACH_DETOUR_METERS = 80
export const DIRECT_APPROACH_DETOUR_RATIO = 2
const EPSILON = 0.001
const ROAD_ARRIVAL_RADIUS = 3
const TRANSPORT_CLEARANCE = 0.6
/** W2-3 — metres of player movement a card's memoised travel estimate may lag behind. */
export const TRAVEL_MEMO_STEP = 4
const TRAVEL_MEMO_LIMIT = 64

export interface ExpeditionPoint { x: number; z: number }
export type ExpeditionPreference = 'shortest' | 'cautious'
export interface ExpeditionTargetIdentity {
  kind: 'objective' | 'rumour' | 'site' | 'caravanBeat'
  id: string
}
export interface ExpeditionState {
  version: 1
  /** `campaign` charts the active objective; `selected` charts an explicit atlas choice. */
  mode: 'campaign' | 'selected'
  target: ExpeditionTargetIdentity | null
  preference: ExpeditionPreference
}
export type ExpeditionNotice = 'invalid-save' | 'stale-target' | null
export interface ExpeditionTarget extends ExpeditionTargetIdentity {
  key: string
  title: string
  regionId: string
  regionLabel: string
  position: ExpeditionPoint
  directDistance: number
  task: string
  stake: string
  timeRemaining: number | null
  exclusive: boolean
  committed: boolean
  /** W2-3 — what the choice pays, passed through from its card. Absent on unpriced targets. */
  payout?: ChoicePayoutView | null
  /** W2-3 — a contract's own clock while it is on offer. */
  timeLimit?: number | null
  /** W2-3 — the walk its card quotes. Absent for a plain site. */
  travel?: ChoiceTravelView | null
}
export interface ExpeditionKnowledge {
  discoveredRegionIds: ReadonlySet<string>
  risks: ReadonlyMap<string, { hostile: boolean; contested: boolean }>
}
interface GraphNode extends ExpeditionPoint { id: string }
export interface ExpeditionRoad extends RegionRoadLeg {
  fromNode: string
  toNode: string
  length: number
  traversable: boolean
}
export interface ExpeditionGraph {
  bounds: WorldBounds
  nodes: ReadonlyMap<string, GraphNode>
  roads: readonly ExpeditionRoad[]
  adjacency: ReadonlyMap<string, readonly ExpeditionRoad[]>
  regions: ReadonlyMap<string, WorldBounds>
  water: readonly WorldBounds[]
  rivers: readonly { id: string; regionId: string; from: ExpeditionPoint; to: ExpeditionPoint }[]
  bridges: readonly { id: string; regionId: string; position: ExpeditionPoint; roadLegIds: string[] }[]
}
export interface ExpeditionLeg {
  kind: 'road' | 'connector'
  roadLegId: string | null
  regionId: string
  from: ExpeditionPoint
  to: ExpeditionPoint
}
export interface ExpeditionWaypoint extends ExpeditionPoint {
  regionId: string
  kind: 'road' | 'bridge' | 'approach' | 'destination'
  bridgeId: string | null
}
export type ExpeditionRouteReason = 'off-road' | 'disconnected' | 'out-of-bounds' | 'limit'
export interface ExpeditionRoute {
  /** `direct` is a short unverified straight approach that replaced a road detour. */
  status: 'road' | 'direct' | 'arrived' | 'unavailable'
  reason: ExpeditionRouteReason | null
  preference: ExpeditionPreference
  legs: ExpeditionLeg[]
  points: ExpeditionWaypoint[]
  regionIds: string[]
  bridgeIds: string[]
  roadDistance: number
  connectorDistance: number
  directDistance: number
  cost: number
  knownRiskDistance: number
  knownRiskRegionIds: string[]
  unscoutedRegionIds: string[]
}
export interface ExpeditionTransport {
  roads: { id: string; regionId: string; from: ExpeditionPoint; to: ExpeditionPoint; blocked: boolean }[]
  rivers: ExpeditionGraph['rivers']
  bridges: { id: string; regionId: string; position: ExpeditionPoint; unscouted: boolean }[]
}
export interface ExpeditionGuidance {
  next: ExpeditionWaypoint | null
  bearing: number
  distance: number
  remainingRoadDistance: number
  connector: boolean
  arrived: boolean
}
export interface ExpeditionView {
  mode: ExpeditionState['mode']
  preference: ExpeditionPreference
  target: ExpeditionTarget | null
  targets: ExpeditionTarget[]
  route: ExpeditionRoute | null
  shortest: ExpeditionRoute | null
  cautious: ExpeditionRoute | null
  transport: ExpeditionTransport
  guidance: ExpeditionGuidance | null
  bearingReason: 'fog' | null
  notice: ExpeditionNotice
}
export interface ExpeditionInput {
  faction: Faction
  player: ExpeditionPoint
  heading: number
  objectives: readonly Objective[]
  contracts: readonly CampaignContractView[]
  rumours: readonly ChronicleRumourView[]
  activeObjectiveId: string | null
  discoveredRegionIds: ReadonlySet<string>
  chronicleRegions: ReadonlyMap<string, RegionChronicleState>
  contestedRegionIds: ReadonlySet<string>
  /** W2-2 — every caravan beat the atlas may chart, the old bridge ambush among them. */
  caravanBeats?: readonly {
    id: string
    title: string
    regionId: string
    position: ExpeditionPoint
    task: string
    stake: string
    payout?: ChoicePayoutView | null
    travel?: ChoiceTravelView | null
  }[]
  /**
   * W2-2, PR B — while the camp's choice is open, the caravan the compass follows ahead of the
   * active objective: the one taken with «Взяться», or before that the camp's nearest offer.
   */
  leadingCaravanBeatId?: string | null
  /** …and the gate's next caravan, which it follows when no objective is left before it. */
  trailingCaravanBeatId?: string | null
}

export function createExpeditionState(): ExpeditionState {
  return { version: 1, mode: 'campaign', target: null, preference: 'shortest' }
}

export function normalizeExpeditionState(value: unknown): { state: ExpeditionState; notice: ExpeditionNotice } {
  if (value === undefined) return { state: createExpeditionState(), notice: null }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record: Record<string, unknown> = { ...value }
    const target = readTargetIdentity(record.target)
    if (
      record.version === 1 &&
      (record.preference === 'shortest' || record.preference === 'cautious') &&
      (record.mode === 'campaign' || record.mode === 'none' || record.mode === 'selected') &&
      (record.mode === 'selected' ? target !== null : record.target === null)
    ) {
      // A version-1 `none` is the old «Убрать маршрут». Clearing now returns to the
      // active objective's route, so such a save resumes on that default.
      return {
        state: {
          version: 1, mode: record.mode === 'selected' ? 'selected' : 'campaign', target,
          preference: record.preference,
        },
        notice: null,
      }
    }
  }
  return { state: createExpeditionState(), notice: 'invalid-save' }
}

function readTargetIdentity(value: unknown): ExpeditionTargetIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record: Record<string, unknown> = { ...value }
  // W2-2 — a version-1 save that tracked the bridge ambush tracks the same beat, by the
  // same id, now that the bridge is one caravan beat among others.
  const kind = record.kind === 'bridgeAmbush' ? 'caravanBeat' : record.kind
  return (kind === 'objective' || kind === 'rumour' ||
    kind === 'site' || kind === 'caravanBeat') &&
    typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 160 &&
    record.id.trim() === record.id
    ? { kind, id: record.id } : null
}

export function serializeExpeditionState(state: ExpeditionState): SerializableState {
  return {
    version: 1, mode: state.mode, preference: state.preference,
    target: state.target ? { kind: state.target.kind, id: state.target.id } : null,
  }
}

export function expeditionTargetKey(target: ExpeditionTargetIdentity): string {
  return `${target.kind}:${target.id}`
}

const graphs = new WeakMap<WorldBlueprint, ExpeditionGraph>()

/** Cached transport only: no actors, ownership, mutable simulation or random streams. */
export function getExpeditionGraph(blueprint: WorldBlueprint): ExpeditionGraph {
  const cached = graphs.get(blueprint)
  if (cached) return cached
  const regions = new Map<string, WorldBounds>()
  const nodes = new Map<string, GraphNode>()
  const adjacency = new Map<string, ExpeditionRoad[]>()
  const water: WorldBounds[] = []
  const rivers: ExpeditionGraph['rivers'][number][] = []
  for (const region of blueprint.regions) {
    const bounds = getBlueprintRegionBounds(blueprint, region)
    if (!bounds) continue
    regions.set(region.id, bounds)
    water.push(...getRegionWaterBounds(blueprint, region.id).map((entry) => entry.bounds))
    for (const leg of getRegionRiverLegs(blueprint, region)) {
      rivers.push({ id: `river:${region.id}:${leg.direction}`, regionId: region.id, from: leg.edge, to: leg.center })
    }
  }
  // A rendered strip is a routable edge only when a real connection references it.
  const segments = new Map(blueprint.roads.segments.map((segment) => [segment.id, segment]))
  const connections = new Map(blueprint.connections.map((connection) => [connection.id, connection]))
  const referenced = new Set<string>()
  for (const road of blueprint.roads.connections) {
    for (let index = 0; index < road.regionPath.length - 1; index += 1) {
      const segment = segments.get(road.segmentIds[index])
      if (!segment || segment.roadConnectionId !== road.id) continue
      const from = road.regionPath[index]
      const to = road.regionPath[index + 1]
      const connection = connections.get(segment.connectionId)
      if (!connection) continue
      if (
        ((segment.fromRegionId === from && segment.toRegionId === to) ||
          (segment.fromRegionId === to && segment.toRegionId === from)) &&
        ((connection.fromRegionId === from && connection.toRegionId === to) ||
          (connection.fromRegionId === to && connection.toRegionId === from))
      ) referenced.add(segment.id)
    }
  }
  const roads: ExpeditionRoad[] = []
  for (const region of blueprint.regions) {
    for (const leg of getRegionRoadLegs(blueprint, region)) {
      const fromNode = `center:${region.id}`
      const toNode = `edge:${leg.edge.x}:${leg.edge.z}`
      const road: ExpeditionRoad = {
        ...leg, fromNode, toNode, length: distance(leg.center, leg.edge),
        traversable: leg.segmentIds.some((id) => referenced.has(id)) &&
          segmentClear(water, blueprint.bounds, leg.center, leg.edge),
      }
      roads.push(road)
      for (const [id, point] of [[fromNode, leg.center], [toNode, leg.edge]] as const) {
        nodes.set(id, { id, ...point })
        if (!adjacency.has(id)) adjacency.set(id, [])
        if (road.traversable) adjacency.get(id)?.push(road)
      }
    }
  }
  roads.sort((a, b) => a.id.localeCompare(b.id))
  for (const edges of adjacency.values()) edges.sort((a, b) => a.id.localeCompare(b.id))
  const bridges = blueprint.bridges.flatMap((bridge) => {
    const bounds = regions.get(bridge.regionId)
    const crossing = roads.filter((road) => road.regionId === bridge.regionId &&
      road.traversable && bridge.roadSegmentIds.some((id) => road.segmentIds.includes(id)))
    if (!bounds || crossing.length < 2) return []
    return [{
      id: bridge.id, regionId: bridge.regionId,
      position: { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
      roadLegIds: crossing.map((road) => road.id),
    }]
  }).sort((a, b) => a.id.localeCompare(b.id))
  const graph = { bounds: { ...blueprint.bounds }, nodes, roads, adjacency, regions, water, rivers, bridges }
  graphs.set(blueprint, graph)
  return graph
}

function inBounds(point: ExpeditionPoint, bounds: WorldBounds): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z) &&
    point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ
}

function segmentClear(water: readonly WorldBounds[], bounds: WorldBounds, from: ExpeditionPoint, to: ExpeditionPoint): boolean {
  if (!inBounds(from, bounds) || !inBounds(to, bounds)) return false
  return !water.some((box) => {
    let low = 0
    let high = 1
    for (const [start, delta, min, max] of [
      [from.x, to.x - from.x, box.minX - TRANSPORT_CLEARANCE, box.maxX + TRANSPORT_CLEARANCE],
      [from.z, to.z - from.z, box.minZ - TRANSPORT_CLEARANCE, box.maxZ + TRANSPORT_CLEARANCE],
    ]) {
      if (Math.abs(delta) < EPSILON) {
        if (start < min || start > max) return false
      } else {
        const first = (min - start) / delta
        const last = (max - start) / delta
        low = Math.max(low, Math.min(first, last))
        high = Math.min(high, Math.max(first, last))
        if (low > high) return false
      }
    }
    return low <= high
  })
}

export function isExpeditionSegmentClear(graph: ExpeditionGraph, from: ExpeditionPoint, to: ExpeditionPoint): boolean {
  return segmentClear(graph.water, graph.bounds, from, to)
}

function distance(a: ExpeditionPoint, b: ExpeditionPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function project(point: ExpeditionPoint, from: ExpeditionPoint, to: ExpeditionPoint): ExpeditionPoint {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = dx * dx + dz * dz
  const fraction = length < EPSILON ? 0
    : Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.z - from.z) * dz) / length))
  return { x: from.x + dx * fraction, z: from.z + dz * fraction }
}

function regionAt(graph: ExpeditionGraph, point: ExpeditionPoint): string | null {
  for (const [id, bounds] of graph.regions) {
    if (point.x >= bounds.minX && point.x < bounds.maxX && point.z >= bounds.minZ && point.z < bounds.maxZ) return id
  }
  return null
}

interface Attachment { road: ExpeditionRoad; point: ExpeditionPoint; length: number }
function attachments(graph: ExpeditionGraph, point: ExpeditionPoint): Attachment[] {
  const regionId = regionAt(graph, point)
  const candidates = graph.roads.filter((road) => road.traversable && road.regionId === regionId)
    .map((road) => ({ road, point: project(point, road.center, road.edge) }))
    .filter((entry) => isExpeditionSegmentClear(graph, point, entry.point))
    .map((entry) => ({ ...entry, length: distance(point, entry.point) }))
    .sort((a, b) => a.length - b.length || a.road.id.localeCompare(b.road.id))
  // Join the nearest reachable strip, rather than replacing road travel with a long
  // unchecked shortcut to another leg in the same region.
  return candidates.filter((entry) => entry.length <= (candidates[0]?.length ?? 0) + EPSILON)
}

export function buildExpeditionKnowledge(input: Pick<ExpeditionInput,
  'faction' | 'discoveredRegionIds' | 'chronicleRegions' | 'contestedRegionIds'>,
  blueprint: WorldBlueprint,
): ExpeditionKnowledge {
  const risks = new Map<string, { hostile: boolean; contested: boolean }>()
  for (const id of input.discoveredRegionIds) {
    const region = blueprint.regions.find((candidate) => candidate.id === id)
    if (!region) continue
    const owner = input.chronicleRegions.get(id)?.control ?? region.territory
    risks.set(id, { hostile: owner !== 'neutral' && owner !== input.faction, contested: input.contestedRegionIds.has(id) })
  }
  return { discoveredRegionIds: new Set(input.discoveredRegionIds), risks }
}

function riskPenalty(knowledge: ExpeditionKnowledge, regionId: string): number {
  if (!knowledge.discoveredRegionIds.has(regionId)) return 0
  const risk = knowledge.risks.get(regionId)
  return (risk?.hostile ? 2 : 0) + (risk?.contested ? 1 : 0)
}

function roadWeight(road: ExpeditionRoad, knowledge: ExpeditionKnowledge, preference: ExpeditionPreference): number {
  return preference === 'cautious' ? 1 + riskPenalty(knowledge, road.regionId) : 1
}

/** Shortest path over real road legs; local approaches are explicitly unverified bearings. */
export function planExpeditionRoute(
  graph: ExpeditionGraph,
  from: ExpeditionPoint,
  to: ExpeditionPoint,
  knowledge: ExpeditionKnowledge,
  preference: ExpeditionPreference = 'shortest',
): ExpeditionRoute {
  const empty = (reason: ExpeditionRouteReason): ExpeditionRoute => ({
    status: 'unavailable', reason, preference, legs: [], points: [], regionIds: [], bridgeIds: [],
    roadDistance: 0, connectorDistance: 0, directDistance: distance(from, to), cost: 0,
    knownRiskDistance: 0, knownRiskRegionIds: [], unscoutedRegionIds: [],
  })
  if (!inBounds(from, graph.bounds) || !inBounds(to, graph.bounds)) return empty('out-of-bounds')
  const starts = attachments(graph, from)
  const ends = attachments(graph, to)
  if (starts.length === 0 || ends.length === 0) return empty('off-road')
  const best: { value: { cost: number; key: string; legs: ExpeditionLeg[] } | null } = { value: null }
  const consider = (start: Attachment, end: Attachment, middle: ExpeditionLeg[]) => {
    const allLegs: ExpeditionLeg[] = [
      { kind: 'connector', roadLegId: null, regionId: start.road.regionId, from, to: start.point },
      ...middle,
      { kind: 'connector', roadLegId: null, regionId: end.road.regionId, from: end.point, to },
    ]
    const legs = allLegs.filter((leg) => distance(leg.from, leg.to) > EPSILON)
    const cost = legs.reduce((sum, leg) => sum + distance(leg.from, leg.to) *
      (preference === 'cautious' && leg.kind === 'road' ? 1 + riskPenalty(knowledge, leg.regionId) : 1), 0)
    const key = legs.map((leg) => leg.roadLegId ?? `${leg.from.x}:${leg.from.z}`).join('|')
    if (!best.value || cost < best.value.cost - EPSILON || (Math.abs(cost - best.value.cost) < EPSILON && key < best.value.key)) {
      best.value = { cost, key, legs }
    }
  }
  for (const start of starts) {
    const costs = new Map<string, number>()
    const paths = new Map<string, ExpeditionLeg[]>()
    for (const id of [start.road.fromNode, start.road.toNode]) {
      const node = graph.nodes.get(id)
      if (!node) continue
      costs.set(id, start.length + distance(start.point, node) * roadWeight(start.road, knowledge, preference))
      paths.set(id, [{ kind: 'road', roadLegId: start.road.id, regionId: start.road.regionId, from: start.point, to: node }])
    }
    const visited = new Set<string>()
    while (visited.size < graph.nodes.size) {
      const next = [...costs.keys()].filter((id) => !visited.has(id))
        .sort((a, b) => (costs.get(a) ?? Infinity) - (costs.get(b) ?? Infinity) || a.localeCompare(b))[0]
      if (!next) break
      visited.add(next)
      const current = graph.nodes.get(next)
      if (!current) break
      for (const road of graph.adjacency.get(next) ?? []) {
        const id = road.fromNode === next ? road.toNode : road.fromNode
        if (visited.has(id)) continue
        const node = graph.nodes.get(id)
        if (!node) continue
        const cost = (costs.get(next) ?? Infinity) + road.length * roadWeight(road, knowledge, preference)
        if (cost >= (costs.get(id) ?? Infinity) - EPSILON) continue
        costs.set(id, cost)
        paths.set(id, [...(paths.get(next) ?? []),
          { kind: 'road', roadLegId: road.id, regionId: road.regionId, from: current, to: node }])
      }
    }
    for (const end of ends) {
      if (start.road.id === end.road.id) {
        consider(start, end, [{ kind: 'road', roadLegId: start.road.id, regionId: start.road.regionId, from: start.point, to: end.point }])
      }
      for (const id of [end.road.fromNode, end.road.toNode]) {
        const path = paths.get(id)
        const node = graph.nodes.get(id)
        if (!path || !node) continue
        consider(start, end, [...path, {
          kind: 'road', roadLegId: end.road.id, regionId: end.road.regionId, from: node, to: end.point,
        }])
      }
    }
  }
  const winner = best.value
  if (!winner) return empty('disconnected')
  return routeFromLegs(graph, winner.legs, knowledge, preference, distance(from, to), winner.cost)
}

function routeFromLegs(
  graph: ExpeditionGraph, legs: ExpeditionLeg[], knowledge: ExpeditionKnowledge,
  preference: ExpeditionPreference, directDistance: number, cost: number,
): ExpeditionRoute {
  const regionIds = [...new Set(legs.map((leg) => leg.regionId))]
  const points: ExpeditionWaypoint[] = []
  const bridgeIds: string[] = []
  const addPoint = (point: ExpeditionPoint, leg: ExpeditionLeg, last: boolean) => {
    if (points.length && distance(points[points.length - 1], point) < EPSILON) return
    const bridge = graph.bridges.find((entry) => entry.regionId === leg.regionId &&
      distance(entry.position, point) < EPSILON &&
      legs.some((part) => part.roadLegId !== null && entry.roadLegIds.includes(part.roadLegId)))
    if (bridge && !bridgeIds.includes(bridge.id)) bridgeIds.push(bridge.id)
    points.push({ ...point, regionId: leg.regionId, bridgeId: bridge?.id ?? null,
      kind: last ? 'destination' : bridge ? 'bridge' : leg.kind === 'connector' ? 'approach' : 'road' })
  }
  legs.forEach((leg, index) => {
    addPoint(leg.from, leg, false)
    addPoint(leg.to, leg, index === legs.length - 1)
  })
  const unavailable = points.length > MAX_EXPEDITION_POINTS || regionIds.length > MAX_EXPEDITION_REGIONS
  return {
    status: unavailable ? 'unavailable' : legs.length ? 'road' : 'arrived',
    reason: unavailable ? 'limit' : null, preference,
    legs: unavailable ? [] : legs, points: unavailable ? [] : points,
    regionIds: unavailable ? [] : regionIds, bridgeIds: unavailable ? [] : bridgeIds,
    directDistance, cost,
    roadDistance: legs.filter((leg) => leg.kind === 'road').reduce((sum, leg) => sum + distance(leg.from, leg.to), 0),
    connectorDistance: legs.filter((leg) => leg.kind === 'connector').reduce((sum, leg) => sum + distance(leg.from, leg.to), 0),
    knownRiskDistance: legs.filter((leg) => leg.kind === 'road').reduce((sum, leg) =>
      sum + distance(leg.from, leg.to) * riskPenalty(knowledge, leg.regionId), 0),
    knownRiskRegionIds: regionIds.filter((id) => riskPenalty(knowledge, id) > 0),
    unscoutedRegionIds: regionIds.filter((id) => !knowledge.discoveredRegionIds.has(id)),
  }
}

/** The straight line cut at region borders, so every leg stays local to one region. */
function directLegs(graph: ExpeditionGraph, from: ExpeditionPoint, to: ExpeditionPoint): ExpeditionLeg[] {
  const cuts = new Set([0, 1])
  for (const bounds of graph.regions.values()) {
    for (const [start, end, edges] of [
      [from.x, to.x, [bounds.minX, bounds.maxX]],
      [from.z, to.z, [bounds.minZ, bounds.maxZ]],
    ] as const) {
      if (Math.abs(end - start) < EPSILON) continue
      for (const edge of edges) {
        const share = (edge - start) / (end - start)
        if (share > EPSILON && share < 1 - EPSILON) cuts.add(share)
      }
    }
  }
  const at = (share: number): ExpeditionPoint => share === 0 ? { ...from } : share === 1 ? { ...to }
    : { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share }
  const shares = [...cuts].sort((a, b) => a - b)
  const legs: ExpeditionLeg[] = []
  for (let index = 1; index < shares.length; index += 1) {
    const regionId = regionAt(graph, at((shares[index - 1] + shares[index]) / 2))
    if (!regionId) return []
    legs.push({ kind: 'connector', roadLegId: null, regionId, from: at(shares[index - 1]), to: at(shares[index]) })
  }
  return legs
}

/**
 * A short target on a dry straight line is approached directly rather than by a road
 * detour. Only water and the world edge are checked, so it stays an unverified approach.
 */
export function planDirectApproach(
  graph: ExpeditionGraph,
  from: ExpeditionPoint,
  to: ExpeditionPoint,
  knowledge: ExpeditionKnowledge,
  road: ExpeditionRoute,
): ExpeditionRoute | null {
  const length = distance(from, to)
  if (length <= EPSILON || length > DIRECT_APPROACH_DETOUR_METERS ||
    !isExpeditionSegmentClear(graph, from, to)) return null
  if (length > DIRECT_APPROACH_METERS && road.status === 'road' &&
    road.roadDistance + road.connectorDistance < length * DIRECT_APPROACH_DETOUR_RATIO) return null
  const legs = directLegs(graph, from, to)
  if (!legs.length) return null
  const route = routeFromLegs(graph, legs, knowledge, road.preference, length, length)
  return route.status === 'road' ? { ...route, status: 'direct' } : null
}

/**
 * W2-3 — the walk a choice card quotes: the itinerary the compass would chart from `from`
 * to `to` under the shortest preference (the shortest road route, or the short straight
 * approach that replaces it, decided exactly as `buildView` decides it), timed at `speed`
 * metres per second.
 *
 * With no road itinerary to plan the card still gets a number, the straight line, and
 * `basis: 'straight'` says so; like the compass's labelled bearing it has not been checked
 * for water. Danger is read from `knowledge`, which only carries discovered squares, so a
 * card never names a square the fog still hides: those are counted in `unscouted` instead.
 */
export function estimateChoiceTravel(
  blueprint: WorldBlueprint,
  from: ExpeditionPoint,
  to: ExpeditionPoint,
  knowledge: ExpeditionKnowledge,
  speed: number,
): ChoiceTravelView {
  const graph = getExpeditionGraph(blueprint)
  const road = planExpeditionRoute(graph, from, to, knowledge)
  const route = planDirectApproach(graph, from, to, knowledge, road) ?? road
  let meters: number
  let basis: ChoiceTravelView['basis']
  let regionIds: string[]
  if (route.status === 'road' || route.status === 'direct') {
    meters = route.roadDistance + route.connectorDistance
    basis = route.status
    regionIds = route.regionIds
  } else if (route.status === 'arrived') {
    meters = 0
    basis = 'arrived'
    regionIds = []
  } else {
    meters = distance(from, to)
    basis = 'straight'
    regionIds = [...new Set(directLegs(graph, from, to).map((leg) => leg.regionId))]
  }
  const label = (id: string): string => {
    const region = blueprint.regions.find((entry) => entry.id === id)
    return region ? formatRegionGridLabel(region.coordinate.x, region.coordinate.y) : '??'
  }
  return {
    meters,
    seconds: Math.ceil(meters / Math.max(0.1, speed)),
    basis,
    danger: regionIds.filter((id) => riskPenalty(knowledge, id) > 0).map(label),
    unscouted: regionIds.filter((id) => !knowledge.discoveredRegionIds.has(id)).length,
  }
}

function knowledgeKey(knowledge: ExpeditionKnowledge): string {
  return [
    [...knowledge.discoveredRegionIds].sort().join(','),
    [...knowledge.risks].sort(([a], [b]) => a.localeCompare(b))
      .map(([id, risk]) => `${id}:${Number(risk.hostile)}:${Number(risk.contested)}`).join(','),
  ].join('|')
}

const NO_KNOWLEDGE: ExpeditionKnowledge = { discoveredRegionIds: new Set(), risks: new Map() }

/**
 * W2-3 — the walk's seconds for a decision rather than a card: no memo and no knowledge, so
 * the answer depends only on where the player stands. The shortest itinerary never weighs
 * danger, so nothing the fog hides can move it.
 */
export function estimateWalkSeconds(
  blueprint: WorldBlueprint,
  from: ExpeditionPoint,
  to: ExpeditionPoint,
  speed: number,
): number {
  return estimateChoiceTravel(blueprint, from, to, NO_KNOWLEDGE, speed).seconds
}

function withinRegion(graph: ExpeditionGraph, regionId: string, point: ExpeditionPoint): boolean {
  const bounds = graph.regions.get(regionId)
  return bounds !== undefined && point.x >= bounds.minX - EPSILON && point.x <= bounds.maxX + EPSILON &&
    point.z >= bounds.minZ - EPSILON && point.z <= bounds.maxZ + EPSILON
}

export function validateExpeditionRoute(graph: ExpeditionGraph, route: ExpeditionRoute): string[] {
  const errors: string[] = []
  if (route.status !== 'road' && route.status !== 'direct') return ['not-a-road-itinerary']
  if (route.points.length > MAX_EXPEDITION_POINTS || route.regionIds.length > MAX_EXPEDITION_REGIONS) errors.push('unbounded')
  if (!route.legs.length) errors.push('empty')
  if (route.status === 'direct' && (route.legs.some((leg) => leg.kind !== 'connector') ||
    route.connectorDistance > DIRECT_APPROACH_DETOUR_METERS + EPSILON)) errors.push('not-a-direct-approach')
  route.legs.forEach((leg, index) => {
    if (!isExpeditionSegmentClear(graph, leg.from, leg.to)) errors.push('water-or-bounds')
    if (index && distance(route.legs[index - 1].to, leg.from) > EPSILON) errors.push('disconnected')
    if (leg.kind === 'road') {
      const road = graph.roads.find((entry) => entry.id === leg.roadLegId)
      if (!road?.traversable || road.regionId !== leg.regionId ||
        distance(project(leg.from, road.center, road.edge), leg.from) > EPSILON ||
        distance(project(leg.to, road.center, road.edge), leg.to) > EPSILON) errors.push('not-a-road')
    } else if (!withinRegion(graph, leg.regionId, leg.from) || !withinRegion(graph, leg.regionId, leg.to)) {
      errors.push('nonlocal-connector')
    }
  })
  for (const id of route.bridgeIds) if (!graph.bridges.some((bridge) => bridge.id === id)) errors.push('missing-bridge')
  return errors
}

export function buildExpeditionTargets(blueprint: WorldBlueprint, input: ExpeditionInput): ExpeditionTarget[] {
  const targets: ExpeditionTarget[] = []
  const add = (target: Omit<ExpeditionTarget, 'key' | 'directDistance' | 'regionLabel'>) => {
    const region = blueprint.regions.find((entry) => entry.id === target.regionId)
    if (!region || !inBounds(target.position, blueprint.bounds)) return
    targets.push({ ...target, key: expeditionTargetKey(target), directDistance: distance(input.player, target.position),
      regionLabel: formatRegionGridLabel(region.coordinate.x, region.coordinate.y) })
  }
  for (const node of getReadyObjectiveNodes(blueprint, input.faction, input.objectives)) {
    const contract = input.contracts.find((entry) => entry.id === node.id)
    const position = getSiteWorldPosition2D(blueprint, node.siteId)
    if (!contract || !position) continue
    add({ kind: 'objective', id: node.id, regionId: node.regionId, position, title: contract.title,
      task: contract.task, stake: contract.stake, timeRemaining: contract.timeRemaining,
      exclusive: contract.exclusive, committed: contract.pinned,
      payout: contract.payout ?? null, timeLimit: contract.timeLimit ?? null, travel: contract.travel ?? null })
  }
  for (const rumour of input.rumours) {
    if (rumour.outcome !== null || rumour.timeRemaining <= 0 || rumour.x === null || rumour.z === null) continue
    const position = { x: rumour.x, z: rumour.z }
    const regionId = regionAt(getExpeditionGraph(blueprint), position)
    if (!regionId) continue
    add({ kind: 'rumour', id: rumour.id, position, regionId, title: rumour.title, task: rumour.task,
      stake: rumour.stake, timeRemaining: rumour.timeRemaining, exclusive: false, committed: rumour.pinned,
      payout: rumour.reward ?? null, travel: rumour.travel ?? null })
  }
  for (const target of input.caravanBeats ?? []) {
    add({
      kind: 'caravanBeat',
      id: target.id,
      position: target.position,
      regionId: target.regionId,
      title: target.title,
      task: target.task,
      stake: target.stake,
      timeRemaining: null,
      exclusive: false,
      committed: false,
      payout: target.payout ?? null,
      travel: target.travel ?? null,
    })
  }
  for (const site of blueprint.sites) {
    if (!input.discoveredRegionIds.has(site.regionId)) continue
    const position = getSiteWorldPosition2D(blueprint, site)
    if (!position) continue
    add({ kind: 'site', id: site.id, regionId: site.regionId, position, title: generatedSiteLabel(site.kind),
      task: '', stake: '', timeRemaining: null, exclusive: false, committed: false })
  }
  return targets.sort((a, b) => a.directDistance - b.directDistance || a.key.localeCompare(b.key))
}

export function buildExpeditionGuidance(
  graph: ExpeditionGraph, route: ExpeditionRoute | null, target: ExpeditionTarget,
  player: ExpeditionPoint, heading: number,
): ExpeditionGuidance {
  let next: ExpeditionWaypoint = { ...target.position, regionId: target.regionId, kind: 'destination', bridgeId: null }
  let remainingRoadDistance = 0
  let connector = true
  if (route?.status === 'road') {
    let closestIndex = 0
    let closestDistance = Infinity
    let nearest = player
    route.legs.forEach((leg, index) => {
      const point = project(player, leg.from, leg.to)
      const separation = distance(player, point)
      if (separation < closestDistance - EPSILON) {
        closestDistance = separation
        closestIndex = index
        nearest = point
      }
    })
    let leg = route.legs[closestIndex]
    if (distance(player, leg.to) <= ROAD_ARRIVAL_RADIUS && closestIndex < route.legs.length - 1) {
      closestIndex += 1
      leg = route.legs[closestIndex]
      nearest = leg.from
    }
    const point = closestDistance > 8 ? nearest : leg.to
    const bridge = graph.bridges.find((entry) => distance(entry.position, point) < EPSILON)
    next = { ...point, regionId: leg.regionId, bridgeId: bridge?.id ?? null,
      kind: bridge ? 'bridge' : leg.kind === 'connector' || closestDistance > 8 ? 'approach' : 'road' }
    remainingRoadDistance = route.legs.slice(closestIndex).reduce((sum, part, index) =>
      sum + (part.kind === 'road' ? distance(index === 0 ? nearest : part.from, part.to) : 0), 0)
    connector = leg.kind === 'connector' || closestDistance > 8
    if (closestIndex === route.legs.length - 1) next.kind = 'destination'
  }
  return {
    next, bearing: Math.atan2(next.x - player.x, player.z - next.z) - heading,
    distance: distance(player, next), remainingRoadDistance, connector,
    arrived: distance(player, target.position) <= ROAD_ARRIVAL_RADIUS,
  }
}

/** One planner per engine. Only its bounded selection is saved; geometry is reconstructed. */
export class ExpeditionPlanner {
  readonly graph: ExpeditionGraph
  private readonly blueprint: WorldBlueprint
  private state: ExpeditionState
  private notice: ExpeditionNotice
  private decisionKey = ''
  private shortest: ExpeditionRoute | null = null
  private cautious: ExpeditionRoute | null = null
  private planCount = 0

  constructor(blueprint: WorldBlueprint, saved?: unknown) {
    this.blueprint = blueprint
    this.graph = getExpeditionGraph(blueprint)
    const normalized = normalizeExpeditionState(saved)
    this.state = normalized.state
    this.notice = normalized.notice
  }

  serialize(): SerializableState { return serializeExpeditionState(this.state) }
  getStats(): { planCount: number; graphNodeCount: number } {
    return { planCount: this.planCount, graphNodeCount: this.graph.nodes.size }
  }
  takeNotice(): ExpeditionNotice {
    const notice = this.notice
    this.notice = null
    return notice
  }
  select(target: ExpeditionTargetIdentity | null, input: ExpeditionInput): boolean {
    if (target !== null && !buildExpeditionTargets(this.blueprint, input)
      .some((entry) => entry.key === expeditionTargetKey(target))) return false
    // Clearing an explicit choice returns to the active objective's route, not to nothing.
    this.state = { ...this.state, mode: target ? 'selected' : 'campaign', target: target ? { ...target } : null }
    this.notice = null
    this.decisionKey = ''
    return true
  }
  setPreference(preference: ExpeditionPreference): boolean {
    if (preference !== 'shortest' && preference !== 'cautious') return false
    this.state.preference = preference
    return true
  }

  private readonly travelMemo = new Map<string, ChoiceTravelView>()

  /**
   * W2-3 — `estimateChoiceTravel` for the cards, remembered per `TRAVEL_MEMO_STEP` metres of
   * the player's movement, so a card re-plans about twice a second at walking pace rather
   * than on every emitted view. Display only: no rumour offer and no seeded draw reads it.
   */
  measureTravel(
    input: Pick<ExpeditionInput, 'faction' | 'discoveredRegionIds' | 'chronicleRegions' | 'contestedRegionIds'>,
    from: ExpeditionPoint,
    to: ExpeditionPoint,
    speed: number,
  ): ChoiceTravelView {
    const knowledge = buildExpeditionKnowledge(input, this.blueprint)
    const key = [
      Math.round(from.x / TRAVEL_MEMO_STEP), Math.round(from.z / TRAVEL_MEMO_STEP),
      to.x, to.z, speed, knowledgeKey(knowledge),
    ].join('|')
    const remembered = this.travelMemo.get(key)
    if (remembered) return { ...remembered, danger: [...remembered.danger] }
    if (this.travelMemo.size >= TRAVEL_MEMO_LIMIT) this.travelMemo.clear()
    const travel = estimateChoiceTravel(this.blueprint, from, to, knowledge, speed)
    this.travelMemo.set(key, travel)
    return { ...travel, danger: [...travel.danger] }
  }

  buildView(input: ExpeditionInput): ExpeditionView {
    const targets = buildExpeditionTargets(this.blueprint, input)
    if (this.state.mode === 'selected' && !targets.some((entry) =>
      this.state.target && entry.key === expeditionTargetKey(this.state.target))) {
      const completedBeatTarget = this.state.target?.kind === 'caravanBeat'
      this.state = { ...this.state, mode: 'campaign', target: null }
      this.notice = completedBeatTarget ? null : 'stale-target'
      this.decisionKey = ''
    }
    const selected = this.state.target
    const caravan = (id: string | null | undefined) => id
      ? targets.find((entry) => entry.kind === 'caravanBeat' && entry.id === id)
      : undefined
    const target = this.state.mode === 'selected'
      ? targets.find((entry) => selected !== null && entry.key === expeditionTargetKey(selected)) ?? null
      // A taken live rumour is a time-boxed commitment, so it leads until it resolves. W2-2,
      // PR B — then the camp's caravan (taken, or else the nearest), then the active objective,
      // then the caravan the finale's gate still waits on.
      : targets.find((entry) => entry.kind === 'rumour' && entry.committed) ??
        caravan(input.leadingCaravanBeatId) ??
        targets.find((entry) => entry.kind === 'objective' && entry.id === input.activeObjectiveId) ??
        caravan(input.trailingCaravanBeatId) ?? null
    const knowledge = buildExpeditionKnowledge(input, this.blueprint)
    const attached = attachments(this.graph, input.player)[0]
    const reach = target ? distance(input.player, target.position) : Infinity
    const directBand = !target || reach > DIRECT_APPROACH_DETOUR_METERS ||
      !isExpeditionSegmentClear(this.graph, input.player, target.position) ? 'far'
      : reach > DIRECT_APPROACH_METERS ? 'detour' : 'near'
    const key = [
      this.state.mode, target?.key ?? '', target?.position.x, target?.position.z,
      attached?.road.id ?? regionAt(this.graph, input.player), directBand,
      [...knowledge.discoveredRegionIds].sort().join(','),
      [...knowledge.risks].sort(([a], [b]) => a.localeCompare(b))
        .map(([id, risk]) => `${id}:${Number(risk.hostile)}:${Number(risk.contested)}`).join(','),
    ].join('|')
    // Off-road travel can change the reachable bank without changing the nearest road.
    const route = this.state.preference === 'cautious' ? this.cautious ?? this.shortest : this.shortest
    const farFromRoute = (route?.status === 'road' || route?.status === 'direct') && route.legs.every((leg) =>
      distance(input.player, project(input.player, leg.from, leg.to)) > 12)
    if (key !== this.decisionKey || farFromRoute) {
      this.decisionKey = key
      // The default target is charted exactly as if the player had selected it.
      if (target) {
        this.planCount += 1
        const road = planExpeditionRoute(this.graph, input.player, target.position, knowledge)
        const direct = planDirectApproach(this.graph, input.player, target.position, knowledge, road)
        this.shortest = direct ?? road
        const cautious = direct ? null
          : planExpeditionRoute(this.graph, input.player, target.position, knowledge, 'cautious')
        const different = cautious !== null && cautious.legs.map((leg) => leg.roadLegId).join('|') !==
          road.legs.map((leg) => leg.roadLegId).join('|')
        this.cautious = cautious && different && cautious.status === 'road' &&
          cautious.knownRiskDistance < road.knownRiskDistance - 1 ? cautious : null
      } else {
        this.shortest = null
        this.cautious = null
      }
    }
    const chosen = this.state.preference === 'cautious' ? this.cautious ?? this.shortest : this.shortest
    // A mission, including the default objective, may chart its own itinerary through fog.
    // A discovered utility site does not grant that exception.
    const exposeUnscouted = target !== null && target.kind !== 'site'
    const visibleRoute = chosen && !exposeUnscouted && chosen.unscoutedRegionIds.length ? null : chosen
    const bridgeLocations = new Set<string>()
    const bridges = this.graph.bridges.filter((bridge) => {
      const key = `${bridge.position.x}:${bridge.position.z}`
      if (bridgeLocations.has(key)) return false
      const known = knowledge.discoveredRegionIds.has(bridge.regionId)
      if (!known && !(exposeUnscouted && chosen?.bridgeIds.includes(bridge.id))) return false
      bridgeLocations.add(key)
      return true
    }).map((bridge) => ({
      id: bridge.id, regionId: bridge.regionId, position: bridge.position,
      unscouted: !knowledge.discoveredRegionIds.has(bridge.regionId),
    }))
    return {
      mode: this.state.mode, preference: this.state.preference, target, targets,
      route: visibleRoute,
      shortest: exposeUnscouted || !this.shortest?.unscoutedRegionIds.length ? this.shortest : null,
      cautious: exposeUnscouted || !this.cautious?.unscoutedRegionIds.length ? this.cautious : null,
      transport: {
        roads: this.graph.roads.filter((road) => knowledge.discoveredRegionIds.has(road.regionId))
          .map((road) => ({ id: road.id, regionId: road.regionId, from: road.center, to: road.edge, blocked: !road.traversable })),
        rivers: this.graph.rivers.filter((river) => knowledge.discoveredRegionIds.has(river.regionId)),
        bridges,
      },
      guidance: target ? buildExpeditionGuidance(this.graph, visibleRoute, target, input.player, input.heading) : null,
      bearingReason: chosen && !visibleRoute ? 'fog' : null,
      notice: this.notice,
    }
  }
}
