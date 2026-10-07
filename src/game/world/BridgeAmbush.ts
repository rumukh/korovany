/**
 * The old bridge's geometry and its version-1 save format.
 *
 * The bridge ambush was the game's one caravan beat. W2-2 generalised it into
 * `world/CaravanBeats.ts`, where the bridge is one placement among several. Two things stay
 * here:
 *
 * - **Placement.** `createBridgeAmbushPlan` still picks the first reachable bridge on the
 *   faction's road to its finale. The crossing beat uses that plan unchanged, so its id,
 *   its combatant ids and its lane are exactly what the old saves recorded.
 * - **The version-1 `directorState.bridgeAmbush` block.** `normalizeBridgeAmbushState` is
 *   what `restoreCaravanBeatsState` migrates. A save is never rewritten in this format
 *   again; the serializer remains so tests can write the old shape.
 */
import {
  getBlueprintRegionBounds,
  getFactionStartPosition2D,
  getSiteWorldPosition2D,
  isInsideRegionWater,
} from '../content/registry.ts'
import type { SerializableState } from '../run/runTypes.ts'
import type { ActorRole, Allegiance, Faction } from '../types.ts'
import {
  getExpeditionGraph,
  planExpeditionRoute,
  validateExpeditionRoute,
  type ExpeditionRoute,
} from './ExpeditionPlanner.ts'
import type { WorldBlueprint } from './worldTypes.ts'

export type BridgeAmbushChoice = 'seize' | 'deliver'
export type BridgeAmbushPhase =
  | 'approach'
  | 'fighting'
  | 'secured'
  | 'delivering'
  | 'resolved'
  | 'lost'
  | 'unavailable'

export interface BridgeAmbushPoint {
  x: number
  z: number
}

export interface BridgeAmbushSpawnPoint extends BridgeAmbushPoint {
  combatantId: string
}

export interface BridgeAmbushPlan {
  id: string
  bridgeId: string
  regionId: string
  axis: BridgeAmbushPoint
  approachSign: -1 | 1
  bridge: BridgeAmbushPoint
  cargoStart: BridgeAmbushPoint
  alternateApproach: BridgeAmbushPoint
  deliveryEnd: BridgeAmbushPoint
  openingRoute: ExpeditionRoute
  deliveryRoute: ExpeditionRoute
  spawnPoints: BridgeAmbushSpawnPoint[]
}

export interface BridgeAmbushCombatantState {
  id: string
  allegiance: Allegiance
  role: ActorRole
  enemy: boolean
  health: number
  maxHealth: number
  defeated: boolean
}

export interface BridgeAmbushState {
  version: 1
  phase: BridgeAmbushPhase
  bridgeId: string | null
  cargoX: number
  cargoZ: number
  cargoHealth: number
  cargoMaxHealth: number
  progress: number
  outcome: BridgeAmbushChoice | null
  consequence: string | null
  rewardPaid: boolean
  unavailableReason: string | null
  combatants: BridgeAmbushCombatantState[]
}

export const BRIDGE_AMBUSH_VERSION = 1
export const BRIDGE_AMBUSH_CARGO_HEALTH = 100
export const BRIDGE_AMBUSH_ACTIVATION_RADIUS = 34
export const BRIDGE_AMBUSH_CHOICE_RADIUS = 5.5
export const BRIDGE_AMBUSH_DELIVERY_ESCORT_RADIUS = 7
export const BRIDGE_AMBUSH_DELIVERY_SPEED = 2.35
export const BRIDGE_AMBUSH_STAGING_CLEARANCE = 16

const UNKNOWN_ROAD = { discoveredRegionIds: new Set<string>(), risks: new Map() }
const POSITION_EPSILON = 0.08

function distance(first: BridgeAmbushPoint, second: BridgeAmbushPoint): number {
  return Math.hypot(first.x - second.x, first.z - second.z)
}

function regionCenter(
  blueprint: WorldBlueprint,
  regionId: string,
): BridgeAmbushPoint | null {
  const bounds = getBlueprintRegionBounds(blueprint, regionId)
  return bounds
    ? { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
    : null
}

function bridgeAxis(
  blueprint: WorldBlueprint,
  bridgeId: string,
): BridgeAmbushPoint | null {
  const bridge = blueprint.bridges.find((entry) => entry.id === bridgeId)
  const road = bridge && blueprint.roads.connections.find(
    (entry) => entry.id === bridge.roadConnectionId,
  )
  if (!bridge || !road) return null
  const index = road.regionPath.indexOf(bridge.regionId)
  const before = regionCenter(blueprint, road.regionPath[index - 1])
  const after = regionCenter(blueprint, road.regionPath[index + 1])
  if (!before || !after) return null
  const dx = after.x - before.x
  const dz = after.z - before.z
  const length = Math.hypot(dx, dz)
  return length > 0.001 ? { x: dx / length, z: dz / length } : null
}

function withinBounds(
  blueprint: WorldBlueprint,
  point: BridgeAmbushPoint,
  margin: number,
): boolean {
  return point.x >= blueprint.bounds.minX + margin &&
    point.x <= blueprint.bounds.maxX - margin &&
    point.z >= blueprint.bounds.minZ + margin &&
    point.z <= blueprint.bounds.maxZ - margin
}

function translated(
  point: BridgeAmbushPoint,
  axis: BridgeAmbushPoint,
  along: number,
  side = 0,
): BridgeAmbushPoint {
  return {
    x: point.x + axis.x * along - axis.z * side,
    z: point.z + axis.z * along + axis.x * side,
  }
}

function approachSign(
  route: ExpeditionRoute,
  bridge: BridgeAmbushPoint,
  axis: BridgeAmbushPoint,
  start: BridgeAmbushPoint,
): -1 | 1 {
  for (let index = route.legs.length - 1; index >= 0; index -= 1) {
    const leg = route.legs[index]
    const endpoint = distance(leg.to, bridge) <= distance(leg.from, bridge)
      ? leg.from
      : leg.to
    if (distance(endpoint, bridge) < 0.1) continue
    const projection =
      (endpoint.x - bridge.x) * axis.x + (endpoint.z - bridge.z) * axis.z
    if (Math.abs(projection) > 0.1) return projection < 0 ? -1 : 1
  }
  const projection = (start.x - bridge.x) * axis.x + (start.z - bridge.z) * axis.z
  return projection < 0 ? -1 : 1
}

function deterministicSide(seed: number, key: string): -1 | 1 {
  let hash = seed >>> 0
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0
  }
  return (hash & 1) === 0 ? -1 : 1
}

/**
 * Picks the first reachable bridge on the faction's generated road to its finale.
 * Fallback bridges are still ordered by real road distance, never by a straight-line guess.
 */
export function createBridgeAmbushPlan(
  blueprint: WorldBlueprint,
  faction: Faction,
): BridgeAmbushPlan | null {
  const start = getFactionStartPosition2D(blueprint, faction)
  const finale = getSiteWorldPosition2D(blueprint, blueprint.finales[faction])
  if (!start || !finale) return null
  const graph = getExpeditionGraph(blueprint)
  const opening = planExpeditionRoute(graph, start, finale, UNKNOWN_ROAD)
  const openingIds = opening.status === 'road' ? opening.bridgeIds : []
  const openingBridges = graph.bridges.filter((entry) => openingIds.includes(entry.id))
  const preferredIds = graph.bridges
    .filter((entry) => {
      const bridge = blueprint.bridges.find((candidate) => candidate.id === entry.id)
      const road = bridge && blueprint.roads.connections.find(
        (candidate) => candidate.id === bridge.roadConnectionId,
      )
      return road?.kind === 'critical' &&
        road.faction === faction &&
        openingBridges.some((candidate) => distance(candidate.position, entry.position) < 0.1)
    })
    .map((entry) => entry.id)
  const fallbacks = graph.bridges
    .filter((bridge) => !preferredIds.includes(bridge.id) && !openingIds.includes(bridge.id))
    .map((bridge) => ({
      id: bridge.id,
      route: planExpeditionRoute(graph, start, bridge.position, UNKNOWN_ROAD),
    }))
    .filter((entry) => entry.route.status === 'road')
    .sort((left, right) =>
      left.route.roadDistance - right.route.roadDistance || left.id.localeCompare(right.id))
    .map((entry) => entry.id)

  for (const bridgeId of [...new Set([...preferredIds, ...openingIds, ...fallbacks])]) {
    const bridgeEntry = graph.bridges.find((entry) => entry.id === bridgeId)
    const axis = bridgeAxis(blueprint, bridgeId)
    if (!bridgeEntry || !axis) continue
    const bridge = { ...bridgeEntry.position }
    const routeToBridge = planExpeditionRoute(graph, start, bridge, UNKNOWN_ROAD)
    if (routeToBridge.status !== 'road') continue
    const sign = approachSign(routeToBridge, bridge, axis, start)
    const cargoStart = translated(bridge, axis, sign * 10.5)
    const deliveryEnd = translated(bridge, axis, sign * -14)
    const side = deterministicSide(blueprint.seed, `${faction}:${bridgeId}`)
    const alternateApproach = translated(cargoStart, axis, sign * 1.5, side * 7)
    const openingRoute = planExpeditionRoute(graph, start, cargoStart, UNKNOWN_ROAD)
    const deliveryRoute = planExpeditionRoute(graph, cargoStart, deliveryEnd, UNKNOWN_ROAD)
    if (
      openingRoute.status !== 'road' ||
      deliveryRoute.status !== 'road' ||
      !deliveryRoute.bridgeIds.some((id) => {
        const crossed = graph.bridges.find((entry) => entry.id === id)
        return crossed !== undefined && distance(crossed.position, bridge) < 0.1
      }) ||
      validateExpeditionRoute(graph, openingRoute).length > 0 ||
      validateExpeditionRoute(graph, deliveryRoute).length > 0
    ) {
      continue
    }
    const dry = [cargoStart, deliveryEnd, alternateApproach].every((point) =>
      withinBounds(blueprint, point, 2) &&
      !isInsideRegionWater(blueprint, bridgeEntry.regionId, point.x, point.z, 1.4))
    if (!dry) continue
    const enemyPoints = [
      translated(cargoStart, axis, sign * 2.8, side * -2.5),
      translated(cargoStart, axis, sign * -2.8, side * -1.8),
      translated(cargoStart, axis, sign * -3, side * -2.7),
    ]
    const protectorPoint = translated(cargoStart, axis, sign * -4.2, side * 1.2)
    if ([...enemyPoints, protectorPoint].some((point) =>
      !withinBounds(blueprint, point, 1) ||
      isInsideRegionWater(blueprint, bridgeEntry.regionId, point.x, point.z, 0.9))) {
      continue
    }
    return {
      id: `bridge-ambush:${bridgeId}`,
      bridgeId,
      regionId: bridgeEntry.regionId,
      axis,
      approachSign: sign,
      bridge,
      cargoStart,
      alternateApproach,
      deliveryEnd,
      openingRoute,
      deliveryRoute,
      spawnPoints: [
        ...enemyPoints.map((point, index) => ({
          ...point,
          combatantId: `bridge-ambush:${bridgeId}:enemy:${index}`,
        })),
        { ...protectorPoint, combatantId: `bridge-ambush:${bridgeId}:protector:0` },
      ],
    }
  }
  return null
}

/** Who holds the bridge cart's road: the guard's escort, or the raiders the guard fights. */
export function bridgeAmbushEnemyFaction(
  blueprint: WorldBlueprint,
  faction: Faction,
  plan: BridgeAmbushPlan,
): Faction {
  if (faction !== 'guard') return 'guard'
  return deterministicSide(blueprint.seed, plan.id) < 0 ? 'elf' : 'villain'
}

export function bridgeAmbushEnemyRole(allegiance: Faction, index: number): ActorRole {
  if (index === 2) return 'archer'
  if (allegiance === 'villain') return 'minion'
  return index === 1 ? 'scout' : 'soldier'
}

export function createBridgeAmbushState(
  blueprint: WorldBlueprint,
  faction: Faction,
  plan: BridgeAmbushPlan | null = createBridgeAmbushPlan(blueprint, faction),
): BridgeAmbushState {
  if (!plan) {
    return createUnavailableBridgeAmbushState(null, 'На открывающей дороге нет доступного мостового перехода.')
  }
  const hostile = bridgeAmbushEnemyFaction(blueprint, faction, plan)
  const combatants: BridgeAmbushCombatantState[] = Array.from({ length: 3 }, (_, index) => ({
    id: `bridge-ambush:${plan.bridgeId}:enemy:${index}`,
    allegiance: hostile,
    role: bridgeAmbushEnemyRole(hostile, index),
    enemy: true,
    health: 0,
    maxHealth: 0,
    defeated: false,
  }))
  if (faction === 'guard') {
    combatants.push({
      id: `bridge-ambush:${plan.bridgeId}:protector:0`,
      allegiance: 'guard',
      role: 'soldier',
      enemy: false,
      health: 0,
      maxHealth: 0,
      defeated: false,
    })
  }
  return {
    version: BRIDGE_AMBUSH_VERSION,
    phase: 'approach',
    bridgeId: plan.bridgeId,
    cargoX: plan.cargoStart.x,
    cargoZ: plan.cargoStart.z,
    cargoHealth: BRIDGE_AMBUSH_CARGO_HEALTH,
    cargoMaxHealth: BRIDGE_AMBUSH_CARGO_HEALTH,
    progress: 0,
    outcome: null,
    consequence: null,
    rewardPaid: false,
    unavailableReason: null,
    combatants,
  }
}

export function createUnavailableBridgeAmbushState(
  plan: BridgeAmbushPlan | null,
  reason: string,
): BridgeAmbushState {
  return {
    version: BRIDGE_AMBUSH_VERSION,
    phase: 'unavailable',
    bridgeId: plan?.bridgeId ?? null,
    cargoX: plan?.cargoStart.x ?? 0,
    cargoZ: plan?.cargoStart.z ?? 0,
    cargoHealth: 0,
    cargoMaxHealth: BRIDGE_AMBUSH_CARGO_HEALTH,
    progress: 0,
    outcome: null,
    consequence: null,
    rewardPaid: false,
    unavailableReason: reason,
    combatants: [],
  }
}

export function bridgeAmbushDeliveryProgress(
  plan: BridgeAmbushPlan,
  point: BridgeAmbushPoint,
): number {
  const dx = plan.deliveryEnd.x - plan.cargoStart.x
  const dz = plan.deliveryEnd.z - plan.cargoStart.z
  const lengthSq = dx * dx + dz * dz
  if (lengthSq <= Number.EPSILON) return 0
  return Math.min(1, Math.max(0,
    ((point.x - plan.cargoStart.x) * dx + (point.z - plan.cargoStart.z) * dz) / lengthSq))
}

export function serializeBridgeAmbushState(state: BridgeAmbushState): SerializableState {
  return {
    version: BRIDGE_AMBUSH_VERSION,
    phase: state.phase,
    bridgeId: state.bridgeId,
    cargoX: state.cargoX,
    cargoZ: state.cargoZ,
    cargoHealth: state.cargoHealth,
    cargoMaxHealth: state.cargoMaxHealth,
    progress: state.progress,
    outcome: state.outcome,
    consequence: state.consequence,
    rewardPaid: state.rewardPaid,
    unavailableReason: state.unavailableReason,
    combatants: state.combatants.map((entry) => ({ ...entry })),
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finite(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= minimum && value <= maximum ? value : null
}

function phase(value: unknown): value is BridgeAmbushPhase {
  return value === 'approach' || value === 'fighting' || value === 'secured' ||
    value === 'delivering' || value === 'resolved' || value === 'lost' ||
    value === 'unavailable'
}

export function normalizeBridgeAmbushState(
  value: unknown,
  blueprint: WorldBlueprint,
  faction: Faction,
  plan: BridgeAmbushPlan | null = createBridgeAmbushPlan(blueprint, faction),
): { state: BridgeAmbushState; rejected: boolean } {
  const invalid = () => ({
    state: createUnavailableBridgeAmbushState(
      plan,
      'Запись встречи повреждена; награда не выдана.',
    ),
    rejected: true,
  })
  const source = record(value)
  if (!source || source.version !== BRIDGE_AMBUSH_VERSION || !phase(source.phase)) return invalid()
  if (source.phase === 'unavailable') {
    const reason = typeof source.unavailableReason === 'string' &&
      source.unavailableReason.length > 0 && source.unavailableReason.length <= 500
      ? source.unavailableReason
      : null
    if (!reason || source.rewardPaid !== false || source.outcome !== null) return invalid()
    return { state: createUnavailableBridgeAmbushState(plan, reason), rejected: false }
  }
  if (!plan || source.bridgeId !== plan.bridgeId || !Array.isArray(source.combatants)) return invalid()
  const fresh = createBridgeAmbushState(blueprint, faction, plan)
  if (source.combatants.length !== fresh.combatants.length) return invalid()
  const savedById = new Map<string, BridgeAmbushCombatantState>()
  for (const value of source.combatants) {
    const entry = record(value)
    if (!entry || typeof entry.id !== 'string' || savedById.has(entry.id)) return invalid()
    const expected = fresh.combatants.find((candidate) => candidate.id === entry.id)
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
      return invalid()
    }
    savedById.set(entry.id, { ...expected, health, maxHealth, defeated: entry.defeated })
  }
  const combatants = fresh.combatants.map((entry) => savedById.get(entry.id) as BridgeAmbushCombatantState)
  const cargoX = finite(source.cargoX, blueprint.bounds.minX, blueprint.bounds.maxX)
  const cargoZ = finite(source.cargoZ, blueprint.bounds.minZ, blueprint.bounds.maxZ)
  const cargoHealth = finite(source.cargoHealth, 0, BRIDGE_AMBUSH_CARGO_HEALTH)
  const cargoMaxHealth = finite(source.cargoMaxHealth, BRIDGE_AMBUSH_CARGO_HEALTH, BRIDGE_AMBUSH_CARGO_HEALTH)
  const progress = finite(source.progress, 0, 1)
  const outcome = source.outcome === 'seize' || source.outcome === 'deliver'
    ? source.outcome
    : source.outcome === null ? null : undefined
  const consequence = source.consequence === null
    ? null
    : typeof source.consequence === 'string' && source.consequence.length <= 500
      ? source.consequence
      : undefined
  if (
    cargoX === null || cargoZ === null || cargoHealth === null || cargoMaxHealth === null ||
    progress === null || outcome === undefined || consequence === undefined ||
    typeof source.rewardPaid !== 'boolean' || source.unavailableReason !== null
  ) {
    return invalid()
  }
  const current = { x: cargoX, z: cargoZ }
  const computedProgress = bridgeAmbushDeliveryProgress(plan, current)
  if (Math.abs(computedProgress - progress) > 0.02) return invalid()
  const allEnemiesDefeated = combatants.every((entry) => !entry.enemy || entry.defeated)
  const spawned = combatants.every((entry) => entry.maxHealth > 0 || entry.defeated)
  const beforeChoice = source.phase === 'approach' || source.phase === 'fighting' ||
    source.phase === 'secured'
  if (
    (source.phase === 'approach' && spawned) ||
    (source.phase === 'fighting' && (!spawned || allEnemiesDefeated || cargoHealth <= 0)) ||
    (source.phase === 'secured' && (!allEnemiesDefeated || cargoHealth <= 0)) ||
    ((source.phase === 'delivering' || source.phase === 'resolved') && !allEnemiesDefeated) ||
    (beforeChoice && (outcome !== null || consequence !== null || source.rewardPaid)) ||
    (source.phase === 'delivering' && (outcome !== 'deliver' || consequence !== null || source.rewardPaid)) ||
    (source.phase === 'resolved' && (outcome === null || consequence === null || !source.rewardPaid)) ||
    (source.phase === 'lost' && (cargoHealth !== 0 || outcome !== null || consequence === null || source.rewardPaid)) ||
    ((source.phase !== 'delivering' && !(source.phase === 'resolved' && outcome === 'deliver')) &&
      distance(current, plan.cargoStart) > POSITION_EPSILON) ||
    ((source.phase === 'delivering' || (source.phase === 'resolved' && outcome === 'deliver')) &&
      distance(current, translated(plan.cargoStart, {
        x: plan.deliveryEnd.x - plan.cargoStart.x,
        z: plan.deliveryEnd.z - plan.cargoStart.z,
      }, progress)) > 1)
  ) {
    return invalid()
  }
  if (
    source.phase === 'resolved' && outcome === 'deliver' && progress < 0.99 ||
    source.phase === 'resolved' && outcome === 'seize' && progress !== 0
  ) {
    return invalid()
  }
  return {
    state: {
      version: BRIDGE_AMBUSH_VERSION,
      phase: source.phase,
      bridgeId: plan.bridgeId,
      cargoX,
      cargoZ,
      cargoHealth,
      cargoMaxHealth,
      progress,
      outcome,
      consequence,
      rewardPaid: source.rewardPaid,
      unavailableReason: null,
      combatants,
    },
    rejected: false,
  }
}
