import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  getFactionStartPosition2D,
  getSiteWorldPosition2D,
} from '../src/game/content/registry.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  getExpeditionGraph,
  isExpeditionSegmentClear,
  planExpeditionRoute,
  validateExpeditionRoute,
  buildExpeditionGuidance,
  buildExpeditionKnowledge,
  ExpeditionPlanner,
  normalizeExpeditionState,
  type ExpeditionGraph,
  type ExpeditionInput,
  type ExpeditionKnowledge,
  type ExpeditionPoint,
  type ExpeditionRoute,
  type ExpeditionView,
} from '../src/game/world/ExpeditionPlanner.ts'
import { WORLD_FACTIONS } from '../src/game/world/worldTypes.ts'
import type { Faction } from '../src/game/types.ts'
import { formatRegionGridLabel } from '../src/game/content/gameCopy.ts'
import { buildCampaignContractViews, buildChronicleRumourViews, buildInitialGameView } from '../src/game/world/CampaignView.ts'
import {
  createCampaignContractState,
  createGeneratedObjectives,
  pinObjective,
  resolveActiveObjectiveNode,
} from '../src/game/world/CampaignDirector.ts'
import { createChronicleRegions, createChronicleState } from '../src/game/world/Chronicle.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { createBridgeAmbushPlan } from '../src/game/world/BridgeAmbush.ts'
import type { ActiveRunSaveV3, JsonValue } from '../src/game/run/runTypes.ts'
import { normalizeActiveRunSaveV3 } from '../src/game/run/storage.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'

const FIXED_SEEDS = Array.from({ length: 200 }, (_, index) =>
  (20_260_905 + Math.imul(index, 2_654_435_761)) >>> 0)
const unknown: ExpeditionKnowledge = { discoveredRegionIds: new Set(), risks: new Map() }

function fixture(faction: Faction = 'villain', seed = 20_260_905, blueprint = generateWorld(seed)) {
  const player = getFactionStartPosition2D(blueprint, faction)
  assert.ok(player)
  const finalId = blueprint.objectives[faction].finalNodeId
  const objectives = createGeneratedObjectives(blueprint, faction)
    .map((objective) => ({ ...objective, done: objective.id !== finalId }))
  const input: ExpeditionInput = {
    faction, player, heading: 0, objectives, activeObjectiveId: finalId,
    contracts: buildCampaignContractViews({
      blueprint, faction, objectives, contracts: createCampaignContractState(),
      sitePosition: (id) => getSiteWorldPosition2D(blueprint, id) ?? null,
    }),
    rumours: [], discoveredRegionIds: new Set([blueprint.criticalPaths[faction].regionIds[0]]),
    chronicleRegions: createChronicleRegions(blueprint), contestedRegionIds: new Set(),
  }
  return { blueprint, input, finalId }
}

/** The reviewed run: seed 20261006, the villain at the B3 treasure with only the E2 fortress left. */
const REVIEW_SEED = 20_261_006
const REVIEW_BRIDGE = 'bridge-road-branch-shop-region-2-1'

function reviewFixture() {
  const blueprint = generateWorld(REVIEW_SEED)
  const faction: Faction = 'villain'
  const label = (id: string) => {
    const region = blueprint.regions.find((entry) => entry.id === id)
    assert.ok(region, id)
    return formatRegionGridLabel(region.coordinate.x, region.coordinate.y)
  }
  const finalId = blueprint.objectives.villain.finalNodeId
  const treasure = blueprint.objectives.villain.nodes.find((node) => node.id === 'objective-villain-branch')
  assert.ok(treasure)
  assert.equal(label(treasure.regionId), 'B3')
  const player = getSiteWorldPosition2D(blueprint, treasure.siteId)
  assert.ok(player)
  // The contract arm of the fork was done, which closed its alternative.
  const objectives = createGeneratedObjectives(blueprint, faction).map((objective) =>
    objective.id === 'objective-villain-alt' ? { ...objective, skipped: true }
      : { ...objective, done: objective.id !== finalId })
  const contracts = createCampaignContractState()
  const input: ExpeditionInput = {
    faction, player, heading: 0, objectives,
    activeObjectiveId: resolveActiveObjectiveNode(blueprint, faction, objectives, contracts.pinnedNodeId)?.id ?? null,
    contracts: buildCampaignContractViews({
      blueprint, faction, objectives, contracts,
      sitePosition: (id) => getSiteWorldPosition2D(blueprint, id) ?? null,
    }),
    rumours: [],
    // A5 camp, the B5-B4 road, the B2 contract and the B3 treasure: east of the river is fog.
    discoveredRegionIds: new Set(['region-0-4', 'region-1-4', 'region-1-3', 'region-1-2', 'region-1-1']),
    chronicleRegions: createChronicleRegions(blueprint), contestedRegionIds: new Set(),
  }
  assert.equal(input.activeObjectiveId, finalId)
  return { blueprint, input, finalId, label }
}

/**
 * What the compass asks of the player: an itinerary, and a first straight line from where
 * they stand to the arrow's point. A bare bearing to a destination across a river fails.
 */
function compassProblems(graph: ExpeditionGraph, view: ExpeditionView, player: ExpeditionPoint): string[] {
  const problems = view.route?.status === 'road'
    ? validateExpeditionRoute(graph, view.route) : ['not-a-road-itinerary']
  const next = view.guidance?.next
  if (!next) problems.push('no-guidance')
  else if (!isExpeditionSegmentClear(graph, player, next)) problems.push('crosses-water')
  return problems
}

/** The pre-change default: no itinerary, just an arrow straight at the destination. */
function bearingOnly(graph: ExpeditionGraph, view: ExpeditionView, input: ExpeditionInput): ExpeditionView {
  assert.ok(view.target)
  return {
    ...view, route: null, shortest: null, cautious: null,
    guidance: buildExpeditionGuidance(graph, null, view.target, input.player, input.heading),
  }
}

/** Anything a view shows inside fog beyond the charted mission's own transport. */
function fogLeaks(view: ExpeditionView, known: ReadonlySet<string>): string[] {
  const charted = new Set(view.route?.bridgeIds ?? [])
  return [
    ...view.transport.roads.filter((road) => !known.has(road.regionId)).map((road) => `road:${road.id}`),
    ...view.transport.rivers.filter((river) => !known.has(river.regionId)).map((river) => `river:${river.id}`),
    ...view.transport.bridges.filter((bridge) => !known.has(bridge.regionId) && !charted.has(bridge.id))
      .map((bridge) => `bridge:${bridge.id}`),
    ...view.transport.bridges.filter((bridge) => bridge.unscouted === known.has(bridge.regionId))
      .map((bridge) => `bridge-label:${bridge.id}`),
    ...view.targets.filter((target) => target.kind === 'site' && !known.has(target.regionId))
      .map((target) => `site:${target.id}`),
    ...(view.route?.knownRiskRegionIds ?? []).filter((id) => !known.has(id)).map((id) => `risk:${id}`),
    ...(view.route?.regionIds ?? []).filter((id) => !known.has(id) !== view.route?.unscoutedRegionIds.includes(id))
      .map((id) => `unscouted-label:${id}`),
  ]
}

test('600 generated start-to-finale itineraries use legal bounded roads and real bridges', () => {
  let routes = 0
  for (const seed of FIXED_SEEDS) {
    const blueprint = generateWorld(seed)
    const before = JSON.stringify(blueprint)
    const graph = getExpeditionGraph(blueprint)
    assert.equal(getExpeditionGraph(blueprint), graph, 'immutable graph must be cached')
    for (const faction of WORLD_FACTIONS) {
      const start = getFactionStartPosition2D(blueprint, faction)
      const end = getSiteWorldPosition2D(blueprint, blueprint.finales[faction])
      assert.ok(start && end)
      const route = planExpeditionRoute(graph, start, end, unknown)
      assert.equal(route.status, 'road', `${seed}/${faction}: ${route.reason}`)
      assert.deepEqual(validateExpeditionRoute(graph, route), [], `${seed}/${faction}`)
      assert.ok(route.roadDistance > 0)
      assert.ok(route.points.length >= 3 && route.points.length <= 128)
      assert.ok(route.regionIds.length <= 25)
      assert.ok(route.bridgeIds.length > 0, `${seed}/${faction} omitted its river crossing`)
      for (const id of route.bridgeIds) {
        assert.ok(blueprint.bridges.some((bridge) => bridge.id === id))
      }
      routes += 1
    }
    assert.equal(JSON.stringify(blueprint), before, 'planning must not mutate world identity or topology')
  }
  assert.equal(routes, 600)
})

test('a plausible straight line across unbridged water fails the actual route validator', () => {
  const graph = getExpeditionGraph(generateWorld(20_260_905))
  const water = graph.water[0]
  const z = (water.minZ + water.maxZ) / 2
  const from = { x: water.minX - 8, z }
  const to = { x: water.maxX + 8, z }
  assert.equal(isExpeditionSegmentClear(graph, from, to), false)
  const forged: ExpeditionRoute = {
    status: 'road', reason: null, preference: 'shortest',
    legs: [{ kind: 'road', roadLegId: graph.roads[0].id, regionId: graph.roads[0].regionId, from, to }],
    points: [], regionIds: [], bridgeIds: [], roadDistance: 26, connectorDistance: 0,
    directDistance: 26, cost: 26, knownRiskDistance: 0, knownRiskRegionIds: [], unscoutedRegionIds: [],
  }
  assert.ok(validateExpeditionRoute(graph, forged).includes('water-or-bounds'))
  assert.ok(validateExpeditionRoute(graph, forged).includes('not-a-road'))
})

test('disconnected and off-road fixtures do not turn a compass bearing into a road', () => {
  const blueprint = generateWorld(20_260_905)
  const graph = getExpeditionGraph(blueprint)
  const start = getFactionStartPosition2D(blueprint, 'elf')
  const end = getSiteWorldPosition2D(blueprint, blueprint.finales.elf)
  assert.ok(start && end)
  const disconnected = { ...graph, adjacency: new Map() }
  assert.equal(planExpeditionRoute(disconnected, start, end, unknown).reason, 'disconnected')
  const noRoads = { ...graph, roads: [] }
  const offRoad = planExpeditionRoute(noRoads, start, end, unknown)
  assert.equal(offRoad.status, 'unavailable')
  assert.equal(offRoad.reason, 'off-road')
  assert.deepEqual(offRoad.points, [])
  assert.deepEqual(offRoad.legs, [])
})

test('cautious routing takes a real lower-risk detour, but does not fabricate alternatives', () => {
  let measured = false
  for (const seed of FIXED_SEEDS.slice(0, 20)) {
    const { blueprint, input } = fixture('villain', seed)
    const graph = getExpeditionGraph(blueprint)
    const target = getSiteWorldPosition2D(blueprint, blueprint.finales.villain)
    assert.ok(target)
    const shortest = planExpeditionRoute(graph, input.player, target, unknown)
    for (const regionId of shortest.regionIds.slice(1, -1)) {
      const knowledge: ExpeditionKnowledge = {
        discoveredRegionIds: new Set(blueprint.regions.map((region) => region.id)),
        risks: new Map([[regionId, { hostile: true, contested: true }]]),
      }
      const direct = planExpeditionRoute(graph, input.player, target, knowledge)
      const cautious = planExpeditionRoute(graph, input.player, target, knowledge, 'cautious')
      if (cautious.knownRiskDistance >= direct.knownRiskDistance) continue
      assert.equal(cautious.status, 'road')
      assert.deepEqual(validateExpeditionRoute(graph, cautious), [])
      assert.ok(cautious.roadDistance >= direct.roadDistance)
      assert.ok(cautious.cost < direct.roadDistance + direct.connectorDistance + direct.knownRiskDistance)
      measured = true
      break
    }
    if (measured) break
  }
  assert.ok(measured, 'vacuity control: a real alternate path must have been exercised')
  const { blueprint, input, finalId } = fixture()
  const planner = new ExpeditionPlanner(blueprint)
  assert.ok(planner.select({ kind: 'objective', id: finalId }, { ...input, discoveredRegionIds: new Set() }))
  assert.equal(planner.buildView({ ...input, discoveredRegionIds: new Set() }).cautious, null)
})

test('poisoned hidden control, supply, pressure and actors cannot change a route or its visible labels', () => {
  const { blueprint, input, finalId } = fixture()
  const known = input.discoveredRegionIds
  const poisonedRegions = new Map([...input.chronicleRegions].map(([id, region]) => [
    id, known.has(id) ? region : {
      ...region, control: 'guard' as const, supply: 0,
      pressure: { elf: 1, guard: 1, villain: 1 }, beastPressure: 1, settlementIntegrity: 0,
    },
  ]))
  const poisoned = {
    ...input, chronicleRegions: poisonedRegions,
    contestedRegionIds: new Set(blueprint.regions.filter((region) => !known.has(region.id)).map((region) => region.id)),
    actors: Array.from({ length: 25 }, (_, index) => ({ id: `hidden-${index}`, x: 0, z: 0, hostile: true })),
  }
  assert.deepEqual(buildExpeditionKnowledge(poisoned, blueprint), buildExpeditionKnowledge(input, blueprint))
  const clean = new ExpeditionPlanner(blueprint)
  const dirty = new ExpeditionPlanner(blueprint)
  clean.select({ kind: 'objective', id: finalId }, input)
  dirty.select({ kind: 'objective', id: finalId }, poisoned)
  clean.setPreference('cautious')
  dirty.setPreference('cautious')
  const before = clean.buildView(input)
  assert.ok(before.route && before.route.unscoutedRegionIds.length > 0)
  assert.deepEqual(dirty.buildView(poisoned), before)
  assert.ok(before.transport.roads.every((road) => known.has(road.regionId)))
  assert.ok(before.transport.rivers.every((river) => known.has(river.regionId)))
  assert.ok(before.targets.filter((target) => target.kind === 'site').every((site) => known.has(site.regionId)))
})

test('selection and repeated view/pan reads do not mutate commitments, clocks, discovery, or RNG', () => {
  const { blueprint, input, finalId } = fixture()
  const streams = Array.from({ length: 6 }, (_, index) => new RandomStream(index + 1))
  const before = JSON.stringify({
    objectives: input.objectives, contracts: input.contracts, rumours: input.rumours,
    regions: [...input.chronicleRegions], discovered: [...input.discoveredRegionIds],
    streams: streams.map((stream) => stream.getState()),
  })
  const planner = new ExpeditionPlanner(blueprint)
  const automatic = planner.buildView(input)
  assert.equal(automatic.mode, 'campaign')
  assert.equal(automatic.target?.id, finalId)
  assert.equal(automatic.route?.status, 'road', 'the default compass charts the active objective by road')
  assert.equal(planner.getStats().planCount, 1)
  assert.ok(planner.select({ kind: 'objective', id: finalId }, input))
  for (let frame = 0; frame < 30; frame += 1) {
    planner.buildView(input)
    planner.setPreference(frame % 2 ? 'shortest' : 'cautious')
  }
  assert.equal(planner.getStats().planCount, 2, 'stable current leg and knowledge reuse the route decision')
  assert.equal(JSON.stringify({
    objectives: input.objectives, contracts: input.contracts, rumours: input.rumours,
    regions: [...input.chronicleRegions], discovered: [...input.discoveredRegionIds],
    streams: streams.map((stream) => stream.getState()),
  }), before)
  // «Убрать маршрут» returns to the active objective's road, not to a bare bearing or nothing.
  assert.ok(planner.select(null, input))
  const cleared = planner.buildView(input)
  assert.equal(cleared.mode, 'campaign')
  assert.equal(cleared.target?.id, finalId)
  assert.deepEqual(cleared.route, automatic.route)
  const reloaded = new ExpeditionPlanner(blueprint, planner.serialize()).buildView(input)
  assert.equal(reloaded.mode, 'campaign')
  assert.deepEqual(reloaded.route, automatic.route)
})

test('with no atlas choice the compass follows the active objective by road, exactly as a selection would', () => {
  let routes = 0
  let bearingsIntoWater = 0
  for (const seed of FIXED_SEEDS) {
    const world = generateWorld(seed)
    for (const faction of WORLD_FACTIONS) {
      const { blueprint, input, finalId } = fixture(faction, seed, world)
      const context = `${seed}/${faction}`
      const planner = new ExpeditionPlanner(blueprint)
      const automatic = planner.buildView(input)
      assert.equal(automatic.mode, 'campaign', context)
      assert.equal(automatic.target?.id, finalId, context)
      assert.equal(automatic.bearingReason, null, context)
      assert.deepEqual(compassProblems(planner.graph, automatic, input.player), [], context)
      assert.ok(automatic.route && automatic.route.bridgeIds.length > 0, `${context} skipped its crossing`)
      assert.deepEqual(fogLeaks(automatic, input.discoveredRegionIds), [], context)
      const chosen = new ExpeditionPlanner(blueprint)
      assert.ok(chosen.select({ kind: 'objective', id: finalId }, input))
      assert.deepEqual({ ...automatic, mode: 'selected' }, chosen.buildView(input), context)
      // Negative control: the same check rejects the pre-change straight-line default.
      const old = compassProblems(planner.graph, bearingOnly(planner.graph, automatic, input), input.player)
      assert.equal(old[0], 'not-a-road-itinerary', context)
      if (old.includes('crosses-water')) bearingsIntoWater += 1
      routes += 1
    }
  }
  assert.equal(routes, 600)
  // Every critical path crosses a river, so every pre-change start bearing pointed into one.
  assert.equal(bearingsIntoWater, routes, 'the negative control must see each old bearing reach water')
})

test('the reviewed villain leaves the B3 treasure on the C2 bridge road, not toward the river bank', () => {
  const { blueprint, input, finalId, label } = reviewFixture()
  const planner = new ExpeditionPlanner(blueprint)
  const view = planner.buildView(input)
  assert.equal(view.mode, 'campaign')
  assert.equal(view.target?.id, finalId)
  assert.ok(view.target && view.route)
  assert.equal(label(view.target.regionId), 'E2')
  assert.deepEqual(compassProblems(planner.graph, view, input.player), [])
  assert.deepEqual(view.route.regionIds.map(label), ['B3', 'B2', 'C2', 'D2', 'E2'])
  assert.deepEqual(view.route.bridgeIds, [REVIEW_BRIDGE])
  assert.deepEqual(view.route.unscoutedRegionIds.map(label), ['C2', 'D2', 'E2'])
  // Negative control: the old default's straight line runs into the river short of the fortress.
  assert.equal(isExpeditionSegmentClear(planner.graph, input.player, view.target.position), false)
  assert.deepEqual(compassProblems(planner.graph, bearingOnly(planner.graph, view, input), input.player),
    ['not-a-road-itinerary', 'crosses-water'])

  // On the west bank's road the next instruction is the crossing itself.
  const bridge = planner.graph.bridges.find((entry) => entry.id === REVIEW_BRIDGE)
  assert.ok(bridge)
  const bank = planner.buildView({ ...input, player: { x: bridge.position.x - 15, z: bridge.position.z } })
  assert.equal(bank.mode, 'campaign')
  assert.equal(bank.guidance?.next?.kind, 'bridge')
  assert.equal(bank.guidance?.next?.bridgeId, REVIEW_BRIDGE)
  assert.ok(bank.guidance && Math.abs(bank.guidance.distance - 15) < 0.01)

  // Fog: the itinerary's own unscouted bridge is drawn, and no other road, river, site or risk.
  const known = input.discoveredRegionIds
  assert.deepEqual(fogLeaks(view, known), [])
  assert.ok(view.transport.bridges.some((entry) => entry.id === REVIEW_BRIDGE && entry.unscouted))
  const hiddenRoads = planner.graph.roads.filter((road) => !known.has(road.regionId))
  assert.ok(hiddenRoads.length > 0)
  const leaky: ExpeditionView = { ...view, transport: { ...view.transport, roads: [
    ...view.transport.roads,
    ...hiddenRoads.map((road) => ({ id: road.id, regionId: road.regionId, from: road.center, to: road.edge, blocked: false })),
  ] } }
  assert.equal(fogLeaks(leaky, known).length, hiddenRoads.length, 'sensitivity control for the fog check')
  const poisoned: ExpeditionInput = {
    ...input,
    chronicleRegions: new Map([...input.chronicleRegions].map(([id, region]) => [id, known.has(id) ? region : {
      ...region, control: 'guard' as const, supply: 0,
      pressure: { elf: 1, guard: 1, villain: 1 }, beastPressure: 1, settlementIntegrity: 0,
    }])),
    contestedRegionIds: new Set(blueprint.regions.filter((region) => !known.has(region.id)).map((region) => region.id)),
  }
  assert.deepEqual(new ExpeditionPlanner(blueprint).buildView(poisoned), view)
})

test('the default compass re-plans when its objective changes, not on every frame', () => {
  const { blueprint } = reviewFixture()
  const faction: Faction = 'villain'
  const [startId, branchId, contractId, altId] = ['start', 'branch', 'contract', 'alt']
    .map((suffix) => `objective-villain-${suffix}`)
  let objectives = createGeneratedObjectives(blueprint, faction)
    .map((objective) => ({ ...objective, done: objective.id === startId }))
  const contracts = createCampaignContractState()
  const camp = getSiteWorldPosition2D(blueprint, blueprint.starts.villain)
  const altSite = blueprint.objectives.villain.nodes.find((node) => node.id === altId)?.siteId
  const rumourAt = altSite ? getSiteWorldPosition2D(blueprint, altSite) : null
  assert.ok(camp && rumourAt)
  const at = (player: ExpeditionPoint, rumours: ExpeditionInput['rumours'] = []): ExpeditionInput => ({
    faction, player, heading: 0, objectives, rumours,
    activeObjectiveId: resolveActiveObjectiveNode(blueprint, faction, objectives, contracts.pinnedNodeId)?.id ?? null,
    contracts: buildCampaignContractViews({
      blueprint, faction, objectives, contracts,
      sitePosition: (id) => getSiteWorldPosition2D(blueprint, id) ?? null,
    }),
    discoveredRegionIds: new Set(['region-0-4']),
    chronicleRegions: createChronicleRegions(blueprint), contestedRegionIds: new Set(),
  })
  const planner = new ExpeditionPlanner(blueprint)
  const plans = () => planner.getStats().planCount
  const first = planner.buildView(at(camp))
  assert.equal(first.target?.id, branchId, 'nothing pinned: the first ready node')
  assert.ok(first.route?.status === 'road')
  for (let frame = 0; frame < 30; frame += 1) planner.buildView(at(camp))
  assert.equal(plans(), 1, 'an unchanged frame reuses the decision')

  // Joining a road leg is a new decision; walking along it is not.
  const leg = first.route.legs.find((entry) => entry.kind === 'road')
  assert.ok(leg)
  const along = (share: number) => ({
    x: leg.from.x + (leg.to.x - leg.from.x) * share, z: leg.from.z + (leg.to.z - leg.from.z) * share,
  })
  planner.buildView(at(along(0.3)))
  const joined = plans()
  for (const share of [0.4, 0.5, 0.6, 0.7]) planner.buildView(at(along(share)))
  assert.equal(plans(), joined, 'progress along the same leg reuses the decision')

  // A pinned contract moves the active objective, and the road with it.
  assert.ok(pinObjective(contracts, contractId, [branchId, contractId, altId]))
  const pinned = planner.buildView(at(camp))
  assert.equal(pinned.target?.id, contractId)
  assert.deepEqual(compassProblems(planner.graph, pinned, camp), [])
  assert.equal(plans(), joined + 1)

  // A taken rumour is a commitment, not an atlas choice: the compass stays on the objective.
  const rumour = {
    id: 'rumour:taken', kind: 'defend' as const, title: 'Взятый слух', task: '', stake: '',
    regionLabel: 'C5', timeRemaining: 40, pinned: true, progress: 0,
    x: rumourAt.x, z: rumourAt.z, outcome: null, outcomeText: null,
  }
  const taken = planner.buildView(at(camp, [rumour]))
  assert.equal(taken.target?.id, contractId)
  assert.ok(taken.targets.some((target) => target.id === rumour.id && target.committed))
  assert.equal(plans(), joined + 1)

  // Charting that rumour, then losing it, returns guidance to the objective's road.
  assert.ok(planner.select({ kind: 'rumour', id: rumour.id }, at(camp, [rumour])))
  assert.equal(planner.buildView(at(camp, [rumour])).target?.id, rumour.id)
  assert.equal(plans(), joined + 2)
  const expired = planner.buildView(at(camp, [{ ...rumour, timeRemaining: 0 }]))
  assert.equal(expired.mode, 'campaign')
  assert.equal(expired.notice, 'stale-target')
  assert.equal(expired.target?.id, contractId)
  assert.deepEqual(expired.route, pinned.route)
  assert.equal(plans(), joined + 3)

  // The pinned node completes and closes its alternative, as the engine records it.
  objectives = objectives.map((objective) => objective.id === contractId ? { ...objective, done: true }
    : objective.id === altId ? { ...objective, skipped: true } : objective)
  contracts.pinnedNodeId = null
  const next = planner.buildView(at(camp))
  assert.equal(next.target?.id, branchId)
  assert.deepEqual(compassProblems(planner.graph, next, camp), [])
  assert.equal(plans(), joined + 4)
})

test('bridge tracking charts a real road without pinning campaign or rumour state', () => {
  const { blueprint, input } = fixture('elf')
  const plan = createBridgeAmbushPlan(blueprint, 'elf')
  assert.ok(plan)
  input.bridgeAmbush = {
    id: plan.id,
    title: 'Засада у старого моста',
    regionId: plan.regionId,
    position: plan.cargoStart,
    task: 'Дойти по дороге.',
    stake: 'Не принимает подряд.',
  }
  const before = JSON.stringify({
    objectives: input.objectives,
    contracts: input.contracts,
    rumours: input.rumours,
  })
  const planner = new ExpeditionPlanner(blueprint)
  assert.equal(planner.select({ kind: 'bridgeAmbush', id: plan.id }, input), true)
  const view = planner.buildView(input)
  assert.equal(view.target?.kind, 'bridgeAmbush')
  assert.equal(view.target?.id, plan.id)
  assert.equal(view.route?.status, 'road')
  assert.deepEqual(validateExpeditionRoute(planner.graph, view.route!), [])
  assert.equal(view.bearingReason, null)
  assert.deepEqual(normalizeExpeditionState(planner.serialize()).state.target, {
    kind: 'bridgeAmbush',
    id: plan.id,
  })
  assert.equal(JSON.stringify({
    objectives: input.objectives,
    contracts: input.contracts,
    rumours: input.rumours,
  }), before)

  input.bridgeAmbush = null
  const completed = planner.buildView(input)
  assert.equal(completed.mode, 'campaign')
  assert.equal(completed.notice, null)
})

test('a discovered utility site does not grant the mission-only unscouted transport exception', () => {
  const { blueprint, input } = fixture()
  const site = blueprint.sites.find((entry) => entry.id === blueprint.finales.villain)
  assert.ok(site)
  const discovered = new Set([...input.discoveredRegionIds, site.regionId])
  const knowledge = { ...input, discoveredRegionIds: discovered }
  const planner = new ExpeditionPlanner(blueprint)
  assert.ok(planner.select({ kind: 'site', id: site.id }, knowledge))
  const view = planner.buildView(knowledge)
  assert.equal(view.target?.id, site.id)
  assert.equal(view.bearingReason, 'fog')
  assert.equal(view.route, null)
  assert.equal(view.shortest, null)
  assert.equal(view.cautious, null)
  assert.ok(view.transport.roads.every((road) => discovered.has(road.regionId)))
  assert.ok(view.transport.bridges.every((bridge) => discovered.has(bridge.regionId)))
})

test('completed, skipped, expired and no-longer-known targets clear without accepting another rumour', () => {
  for (const status of ['done', 'skipped'] as const) {
    const { blueprint, input, finalId } = fixture()
    const targetId = status === 'skipped'
      ? blueprint.objectives[input.faction].nodes.find((node) => node.optional)?.id
      : finalId
    assert.ok(targetId)
    input.activeObjectiveId = targetId
    input.objectives = input.objectives.map((objective) => objective.id === targetId ? { ...objective, done: false } : objective)
    input.contracts = buildCampaignContractViews({
      blueprint, faction: input.faction, objectives: input.objectives, contracts: createCampaignContractState(),
      sitePosition: (id) => getSiteWorldPosition2D(blueprint, id) ?? null,
    })
    const planner = new ExpeditionPlanner(blueprint)
    assert.ok(planner.select({ kind: 'objective', id: targetId }, input))
    const changed = { ...input, objectives: input.objectives.map((objective) =>
      objective.id === targetId ? { ...objective, [status]: true } : objective) }
    const view = planner.buildView(changed)
    assert.equal(view.mode, 'campaign')
    assert.equal(view.notice, 'stale-target')
    assert.equal(view.target, null)
  }
  const { blueprint, input } = fixture()
  const planner = new ExpeditionPlanner(blueprint)
  const rumour = {
    id: 'rumour:live', kind: 'defend' as const, title: 'Live offer', task: '', stake: '',
    regionLabel: 'A1', timeRemaining: 10, pinned: false, progress: 0,
    x: input.player.x, z: input.player.z, outcome: null, outcomeText: null,
  }
  const withRumour = { ...input, rumours: [rumour] }
  assert.ok(planner.select({ kind: 'rumour', id: rumour.id }, withRumour))
  const expired = planner.buildView({ ...withRumour, rumours: [{ ...rumour, timeRemaining: 0 }] })
  assert.equal(expired.mode, 'campaign')
  assert.equal(expired.notice, 'stale-target')
  assert.equal(rumour.pinned, false)
  const site = planner.buildView(input).targets.find((target) => target.kind === 'site')
  assert.ok(site)
  assert.ok(planner.select(site, input))
  const forgotten = planner.buildView({ ...input, discoveredRegionIds: new Set() })
  assert.equal(forgotten.notice, 'stale-target')
  assert.equal(forgotten.targets.some((target) => target.key === site.key), false)
  assert.equal(planner.select({ kind: 'site', id: 'not-a-site' }, input), false)
})

test('absent legacy state is normal, but malformed present selections are reported and bounded', () => {
  assert.equal(normalizeExpeditionState(undefined).notice, null)
  for (const value of [null, {}, { version: 2 }, {
    version: 1, mode: 'selected', preference: 'shortest', target: { kind: 'site', id: 'x'.repeat(161) },
  }, { version: 1, mode: 'selected', preference: 'safe', target: { kind: 'site', id: 'x' } }]) {
    assert.equal(normalizeExpeditionState(value).notice, 'invalid-save')
  }
})

test('waypoints advance at real road legs and compass heading matches the camera convention', () => {
  const { blueprint, input, finalId } = fixture()
  const planner = new ExpeditionPlanner(blueprint)
  planner.select({ kind: 'objective', id: finalId }, input)
  const first = planner.buildView(input)
  assert.ok(first.route?.status === 'road' && first.target)
  const nextLeg = first.route.legs.find((leg) => leg.kind === 'road' &&
    Math.hypot(leg.to.x - input.player.x, leg.to.z - input.player.z) > 80)
  assert.ok(nextLeg)
  const travelled = planner.buildView({ ...input, player: nextLeg.to })
  assert.notDeepEqual(travelled.guidance?.next, first.guidance?.next)
  assert.ok(travelled.guidance && first.guidance)
  assert.ok(travelled.guidance.remainingRoadDistance < first.guidance.remainingRoadDistance)
  const north = { ...first.target, position: { x: input.player.x, z: input.player.z - 10 } }
  assert.equal(buildExpeditionGuidance(planner.graph, null, north, input.player, 0).bearing, 0)
  const east = { ...north, position: { x: input.player.x + 10, z: input.player.z } }
  assert.equal(buildExpeditionGuidance(planner.graph, null, east, input.player, Math.PI / 2).bearing, 0)
})

test('standing on a road never replaces the first road leg with an unchecked connector', () => {
  const { blueprint } = fixture()
  const graph = getExpeditionGraph(blueprint)
  const destination = getSiteWorldPosition2D(blueprint, blueprint.finales.villain)
  assert.ok(destination)
  let checked = 0
  for (const road of graph.roads.filter((entry) => entry.traversable)) {
    const from = { x: (road.center.x + road.edge.x) / 2, z: (road.center.z + road.edge.z) / 2 }
    const route = planExpeditionRoute(graph, from, destination, unknown)
    if (route.status !== 'road') continue
    assert.equal(route.legs[0].kind, 'road', road.id)
    checked += 1
  }
  assert.ok(checked > 20, 'this must exercise real connected road interiors')
})

function saveFixture(): { save: ActiveRunSaveV3; input: ExpeditionInput; blueprint: ReturnType<typeof generateWorld> } {
  const { blueprint, input } = fixture()
  const config = { seed: blueprint.seed, generatorVersion: 1 as const, faction: input.faction, selectedBoonId: 'provisions' }
  const initial = buildInitialGameView({ blueprint, config, restored: undefined })
  const regionId = [...input.discoveredRegionIds][0]
  const save: ActiveRunSaveV3 = {
    version: 3, runId: 'atlas-roundtrip', config, status: 'active',
    startedAt: '2026-09-05T12:00:00.000Z', updatedAt: '2026-09-05T12:01:00.000Z',
    blueprintFingerprint: blueprint.fingerprint,
    currentLocation: { regionId, localPosition: [0, 0, 0], worldPosition: [input.player.x, 0, input.player.z], heading: input.heading },
    player: { health: initial.health, maxHealth: initial.maxHealth, stamina: initial.stamina, maxStamina: initial.maxStamina,
      gold: initial.gold, kills: 0, damage: initial.damage, body: initial.body, objectives: [...input.objectives], upgrades: initial.upgrades },
    discoveredRegionIds: [...input.discoveredRegionIds], regionDeltas: {}, directorState: {}, eventState: {},
    chronicleState: createChronicleState(), rngStates: { combat: 1, event: 2, director: 3, loot: 4 },
    achievementRunState: { runId: 'atlas-roundtrip', faction: input.faction, startedAt: '2026-09-05T12:00:00.000Z',
      kills: 0, killsSinceDamage: 0, bestKillStreak: 0, damageTaken: 0, injuries: 0, limbsLost: 0, goldEarned: 0,
      purchases: 0, objectivesCompleted: 0, eventsCompleted: 0, abilitiesUsed: 0, shieldBlocks: 0, squadCommands: 0,
      caravansRobbed: 0, zonesVisited: [initial.zone], eventKindsCompleted: [], unlockedIds: [], result: null,
      elapsedAtEnd: 0, healthAtEnd: 0 },
  }
  return { save, input, blueprint }
}

test('bounded destination/preference survives real save normalization and initial/live views agree', () => {
  const { blueprint, save, input } = saveFixture()
  const planner = new ExpeditionPlanner(blueprint)
  assert.ok(input.activeObjectiveId)
  planner.select({ kind: 'objective', id: input.activeObjectiveId }, input)
  planner.setPreference('cautious')
  save.directorState.expedition = planner.serialize()
  const encoded = JSON.stringify(save.directorState.expedition)
  assert.ok(encoded.length < 300)
  assert.equal(encoded.includes('points'), false)
  const restored = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(save)))
  assert.ok(restored)
  assert.deepEqual(restored.directorState.expedition, save.directorState.expedition)
  const initial = buildInitialGameView({ blueprint, config: save.config, restored })
  const live = new ExpeditionPlanner(blueprint, restored.directorState.expedition).buildView({
    ...input, chronicleRegions: new Map(),
  })
  assert.deepEqual(initial.expedition, live)
  assert.deepEqual(restored.rngStates, save.rngStates)
  assert.equal(initial.markers[0].x, input.player.x)
  assert.equal(initial.markers[0].z, input.player.z)
})

test('default, explicit and cleared guidance each survive save and continue, as does a legacy cleared save', () => {
  const { blueprint, save, input } = saveFixture()
  const liveInput = { ...input, chronicleRegions: new Map() }
  const resume = (expedition: JsonValue | undefined) => {
    if (expedition === undefined) delete save.directorState.expedition
    else save.directorState.expedition = expedition
    const restored = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(save)))
    assert.ok(restored)
    return { restored, view: buildInitialGameView({ blueprint, config: save.config, restored }).expedition }
  }
  const automatic = new ExpeditionPlanner(blueprint)
  const live = automatic.buildView(liveInput)
  assert.equal(live.mode, 'campaign')
  assert.equal(live.route?.status, 'road')
  const fresh = resume(automatic.serialize())
  assert.deepEqual(fresh.view, live)
  assert.deepEqual(resume(undefined).view, live, 'a save from before the atlas resumes on the same road')
  // Continuing writes back the same bounded state; nothing accrues across continues.
  assert.deepEqual(new ExpeditionPlanner(blueprint, fresh.restored.directorState.expedition).serialize(),
    automatic.serialize())

  const site = live.targets.find((target) => target.kind === 'site')
  assert.ok(site)
  const explicit = new ExpeditionPlanner(blueprint)
  assert.ok(explicit.select({ kind: site.kind, id: site.id }, liveInput))
  const chosen = resume(explicit.serialize())
  assert.equal(chosen.view.mode, 'selected')
  assert.equal(chosen.view.target?.key, site.key)
  assert.deepEqual(chosen.view, explicit.buildView(liveInput))

  assert.ok(explicit.select(null, liveInput))
  assert.deepEqual(explicit.serialize(), automatic.serialize())
  assert.deepEqual(resume(explicit.serialize()).view, live, '«Убрать маршрут» resumes on the default road')

  // Version 1 stored «Убрать маршрут» as `none`; it now means the same default.
  const legacy = resume({ version: 1, mode: 'none', target: null, preference: 'shortest' })
  assert.deepEqual(legacy.view, live)
  assert.equal(legacy.view.notice, null)
  assert.deepEqual(normalizeExpeditionState({ version: 1, mode: 'none', target: null, preference: 'cautious' }),
    { state: { version: 1, mode: 'campaign', target: null, preference: 'cautious' }, notice: null })
  assert.equal(normalizeExpeditionState({
    version: 1, mode: 'none', target: { kind: 'site', id: site.id }, preference: 'shortest',
  }).notice, 'invalid-save')
})

test('restored live rumours share the same position and deadline builder, and expired ones stay out', () => {
  const { blueprint, save, input } = saveFixture()
  const regionId = [...input.discoveredRegionIds][0]
  const rumour = { id: 'rumour:restored', kind: 'defend' as const, regionId, targetRegionId: regionId,
    sourceRegionId: null, siteId: null, caravanId: null, faction: null, raisedTick: 0, deadlineTick: 5,
    progress: 0, actioned: false }
  const commitments = { rumours: [rumour], pinnedRumourId: null, nextOfferTick: 10, verdict: null }
  const rumours = buildChronicleRumourViews(blueprint, commitments, 0)
  const planner = new ExpeditionPlanner(blueprint)
  planner.select({ kind: 'rumour', id: rumour.id }, { ...input, rumours })
  save.directorState.chronicleCommitments = { ...commitments, rumours: [{ ...rumour }] }
  save.directorState.expedition = planner.serialize()
  const initial = buildInitialGameView({ blueprint, config: save.config, restored: save })
  assert.deepEqual(initial.expedition, new ExpeditionPlanner(blueprint, save.directorState.expedition)
    .buildView({ ...input, rumours, chronicleRegions: new Map() }))
  save.chronicleState.tick = 5
  const expired = buildInitialGameView({ blueprint, config: save.config, restored: save })
  assert.equal(expired.expedition.notice, 'stale-target')
  assert.equal(expired.expedition.targets.some((target) => target.kind === 'rumour'), false)
})

test('planned crossing coincides with getBridgePosition and the live collision/nav opening', () => {
  const { blueprint, input, finalId } = fixture()
  const planner = new ExpeditionPlanner(blueprint)
  planner.select({ kind: 'objective', id: finalId }, input)
  const view = planner.buildView(input)
  assert.ok(view.route && view.route.bridgeIds.length > 0)
  const runtime = new GeneratedWorldRuntime(new THREE.Scene(), blueprint, { decorationDensity: 0, terrainResolution: 6 })
  try {
    const bridge = planner.graph.bridges.find((entry) => entry.id === view.route?.bridgeIds[0])
    assert.ok(bridge)
    const position = runtime.getBridgePosition(bridge.id)
    assert.ok(position)
    assert.equal(position.x, bridge.position.x)
    assert.equal(position.z, bridge.position.z)
    runtime.update({ deltaSeconds: 0, focus: position })
    const from = { x: position.x - 12, z: position.z }
    const to = { x: position.x + 12, z: position.z }
    assert.ok(isExpeditionSegmentClear(planner.graph, from, to))
    const result = runtime.collision.resolveMovement(from, to, 0.6)
    assert.equal(result.blocked, false)
    assert.ok(Math.abs(result.x - to.x) < 0.01)
    const path = runtime.findPath(from, to)
    assert.ok(path && path.length > 0)
  } finally {
    runtime.dispose()
  }
})
