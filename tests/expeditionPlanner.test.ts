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
  planDirectApproach,
  planExpeditionRoute,
  validateExpeditionRoute,
  buildExpeditionGuidance,
  buildExpeditionKnowledge,
  estimateChoiceTravel,
  estimateWalkSeconds,
  ExpeditionPlanner,
  normalizeExpeditionState,
  DIRECT_APPROACH_DETOUR_METERS,
  DIRECT_APPROACH_DETOUR_RATIO,
  DIRECT_APPROACH_METERS,
  type ExpeditionGraph,
  type ExpeditionInput,
  type ExpeditionKnowledge,
  type ExpeditionPoint,
  type ExpeditionRoute,
  type ExpeditionView,
} from '../src/game/world/ExpeditionPlanner.ts'
import { PLAYER_WALK_SPEED } from '../src/game/world/CombatMastery.ts'
import { WORLD_FACTIONS } from '../src/game/world/worldTypes.ts'
import type { Faction } from '../src/game/types.ts'
import { formatRegionGridLabel } from '../src/game/content/gameCopy.ts'
import { buildCampaignContractViews, buildChronicleRumourViews, buildInitialGameView } from '../src/game/world/CampaignView.ts'
import {
  createCampaignContractState,
  createGeneratedObjectives,
  findEscortMeeting,
  pinObjective,
  resolveActiveObjectiveNode,
  rumourTargetPoint,
  serializeChronicleCommitmentState,
  type ChronicleCommitmentState,
} from '../src/game/world/CampaignDirector.ts'
import { createChronicleRegions, createChronicleState } from '../src/game/world/Chronicle.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { createBridgeAmbushPlan } from '../src/game/world/BridgeAmbush.ts'
import { planCaravanSpine } from '../src/game/world/CaravanSpine.ts'
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
  const discoveredRegionIds = new Set([blueprint.criticalPaths[faction].regionIds[0]])
  const chronicleRegions = createChronicleRegions(blueprint)
  const contestedRegionIds = new Set<string>()
  // W2-3 — the cards are priced the way both view builders price them, on healthy legs.
  const knowledge = buildExpeditionKnowledge({ faction, discoveredRegionIds, chronicleRegions, contestedRegionIds }, blueprint)
  const input: ExpeditionInput = {
    faction, player, heading: 0, objectives, activeObjectiveId: finalId,
    contracts: buildCampaignContractViews({
      blueprint, faction, objectives, contracts: createCampaignContractState(),
      sitePosition: (id) => getSiteWorldPosition2D(blueprint, id) ?? null,
      travel: (point) => estimateChoiceTravel(blueprint, player, point, knowledge, PLAYER_WALK_SPEED),
    }),
    rumours: [], discoveredRegionIds, chronicleRegions, contestedRegionIds,
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
  const problems = view.route?.status === 'road' || view.route?.status === 'direct'
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

function turnBetween(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

/** A taken live rumour at `to`: the default target wherever it is put, as the atlas charts it. */
function pinnedAt(input: ExpeditionInput, player: ExpeditionPoint, to: ExpeditionPoint): ExpeditionInput {
  return {
    ...input, player, rumours: [{
      id: 'rumour:defend:probe', kind: 'defend', title: 'Проба', task: '', stake: '', regionLabel: '??',
      timeRemaining: 60, pinned: true, progress: 0, x: to.x, z: to.z, outcome: null, outcomeText: null,
    }],
  }
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
      assert.equal(automatic.route?.status, 'road', `${context}: a long target keeps road routing`)
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

/**
 * A legacy run's launch: a save from before the caravan spine, standing where `view` launched,
 * with the camp still to reach and no caravans in its director state.
 */
function legacyLaunch(
  blueprint: ReturnType<typeof generateWorld>,
  config: { seed: number; generatorVersion: number; faction: Faction; selectedBoonId: string },
  view: ReturnType<typeof buildInitialGameView>,
): ReturnType<typeof buildInitialGameView> {
  const start = blueprint.sites.find((site) => site.id === blueprint.starts[config.faction])
  assert.ok(start)
  const marker = view.markers[0]
  const restored: ActiveRunSaveV3 = {
    version: 3, runId: 'legacy-launch', config: { ...config, generatorVersion: 1 }, status: 'active',
    startedAt: '2026-09-05T12:00:00.000Z', updatedAt: '2026-09-05T12:00:00.000Z',
    blueprintFingerprint: blueprint.fingerprint,
    currentLocation: { regionId: start.regionId, localPosition: [0, 0, 0], worldPosition: [marker.x, 0, marker.z],
      heading: marker.heading ?? 0 },
    player: { health: view.health, maxHealth: view.maxHealth, stamina: view.stamina, maxStamina: view.maxStamina,
      gold: view.gold, kills: 0, damage: view.damage, body: view.body,
      objectives: createGeneratedObjectives(blueprint, config.faction), upgrades: view.upgrades },
    discoveredRegionIds: [start.regionId], regionDeltas: {}, directorState: {}, eventState: {},
    chronicleState: createChronicleState(), rngStates: { combat: 1, event: 2, director: 3, loot: 4 },
    achievementRunState: { runId: 'legacy-launch', faction: config.faction, startedAt: '2026-09-05T12:00:00.000Z',
      kills: 0, killsSinceDamage: 0, bestKillStreak: 0, damageTaken: 0, injuries: 0, limbsLost: 0, goldEarned: 0,
      purchases: 0, objectivesCompleted: 0, eventsCompleted: 0, abilitiesUsed: 0, shieldBlocks: 0, squadCommands: 0,
      caravansRobbed: 0, zonesVisited: [view.zone], eventKindsCompleted: [], unlockedIds: [], result: null,
      elapsedAtEnd: 0, healthAtEnd: 0 },
  }
  return buildInitialGameView({ blueprint, config, restored })
}

test('the launch compass leads a spine run to its nearest offer by road and a legacy run straight to its camp', () => {
  let legacyLaunches = 0
  let roadTurned = 0
  let offerLaunches = 0
  let campLaunches = 0
  let notFirstOffer = 0
  let crowMisleads = 0
  for (const seed of FIXED_SEEDS) {
    const blueprint = generateWorld(seed)
    const graph = getExpeditionGraph(blueprint)
    for (const faction of WORLD_FACTIONS) {
      const context = `${seed}/${faction}`
      const config = { seed, generatorVersion: blueprint.generatorVersion, faction, selectedBoonId: 'provisions' }
      const view = buildInitialGameView({ blueprint, config, restored: undefined })
      const player = { x: view.markers[0].x, z: view.markers[0].z }
      const heading = view.markers[0].heading ?? 0
      const camp = blueprint.objectives[faction].nodes.find((node) => node.siteId === blueprint.starts[faction])
      assert.ok(camp, context)

      // W2-2, PR B — a spine run's camp is decided at a cart, so the compass leads to the camp's
      // nearest offer by road, recomputed here from the plans; ties keep the plan's order.
      const offers = planCaravanSpine(blueprint, faction).plans.filter((plan) => plan.slot === 'offer')
      if (offers.length > 0) {
        const road = offers.map((plan) =>
          estimateChoiceTravel(blueprint, player, plan.cargoStart, unknown, PLAYER_WALK_SPEED).meters)
        const nearest = road.indexOf(Math.min(...road))
        const crow = offers.map((plan) => Math.hypot(plan.cargoStart.x - player.x, plan.cargoStart.z - player.z))
        if (crow.indexOf(Math.min(...crow)) !== nearest) crowMisleads += 1
        assert.equal(view.expedition.mode, 'campaign', context)
        assert.equal(view.expedition.target?.kind, 'caravanBeat', context)
        assert.equal(view.expedition.target?.id, offers[nearest].id, context)
        assert.deepEqual(compassProblems(graph, view.expedition, player), [], context)
        if (nearest > 0) notFirstOffer += 1
        offerLaunches += 1
      } else {
        // A world with no offer has no choice to hold, and launches as it always did.
        assert.equal(view.expedition.target?.id, camp.id, context)
        campLaunches += 1
      }

      // Control: a run saved before the spine keeps W1-3's rule, straight at the camp.
      const legacy = legacyLaunch(blueprint, config, view)
      const { expedition } = legacy
      assert.equal(legacy.caravanBeats.opening ?? null, null, context)
      assert.ok(expedition.target && expedition.guidance, context)
      assert.equal(expedition.target.id, camp.id, context)
      assert.equal(expedition.route?.status, 'direct', context)
      assert.deepEqual(compassProblems(graph, expedition, player), [], context)
      const straight = Math.atan2(expedition.target.position.x - player.x, player.z - expedition.target.position.z) - heading
      assert.ok(turnBetween(expedition.guidance.bearing, straight) < 1e-9, `${context}: the arrow is off the camp`)
      // Negative control: the road itinerary the compass followed before this rule.
      const road = planExpeditionRoute(graph, player, expedition.target.position, unknown)
      assert.equal(road.status, 'road', context)
      const detour = buildExpeditionGuidance(graph, road, expedition.target, player, heading)
      if (turnBetween(detour.bearing, straight) > Math.PI / 18) roadTurned += 1
      legacyLaunches += 1
    }
  }
  assert.equal(legacyLaunches, 600)
  assert.ok(roadTurned >= 400, `the road-only arrow must visibly miss the camp, but missed it in ${roadTurned}`)
  assert.equal(offerLaunches + campLaunches, 600)
  assert.ok(offerLaunches >= 590, `a spine launch leads to an offer in almost every world, got ${offerLaunches}`)
  // Sensitivity: a compass that always took the trunk's offer, or the nearer one as the crow
  // flies, would fail here.
  assert.ok(notFirstOffer >= 60, `the nearer offer is often the second one, got ${notFirstOffer}`)
  assert.ok(crowMisleads >= 50, `the crow's nearest offer is not always the road's, got ${crowMisleads}`)
})

test('a short target across water keeps a bridge road or a labelled bearing, never a straight approach', () => {
  let checked = 0
  let bridged = 0
  for (const seed of FIXED_SEEDS.slice(0, 30)) {
    const { blueprint, input } = fixture('villain', seed)
    const graph = getExpeditionGraph(blueprint)
    for (const water of graph.water) {
      const midX = (water.minX + water.maxX) / 2
      const midZ = (water.minZ + water.maxZ) / 2
      for (const [from, to] of [
        [{ x: water.minX - 6, z: midZ }, { x: water.maxX + 6, z: midZ }],
        [{ x: midX, z: water.minZ - 6 }, { x: midX, z: water.maxZ + 6 }],
      ]) {
        if (Math.hypot(to.x - from.x, to.z - from.z) > DIRECT_APPROACH_METERS) continue
        if (![from, to].every((point) => Math.abs(point.x) < 199 && Math.abs(point.z) < 199)) continue
        assert.equal(isExpeditionSegmentClear(graph, from, to), false)
        const road = planExpeditionRoute(graph, from, to, unknown)
        assert.equal(planDirectApproach(graph, from, to, unknown, road), null)
        const view = new ExpeditionPlanner(blueprint).buildView(pinnedAt(input, from, to))
        assert.equal(view.target?.kind, 'rumour')
        if (view.route?.status === 'road') {
          assert.deepEqual(compassProblems(graph, view, from), [], `${seed}: the first leg must stay dry`)
          if (view.route.bridgeIds.length > 0) bridged += 1
        } else {
          assert.equal(view.route?.status, 'unavailable', `${seed}: never a straight line through water`)
        }
        checked += 1
      }
    }
  }
  assert.ok(checked >= 500, `only ${checked} short crossings were exercised`)
  assert.ok(bridged >= 100, `only ${bridged} short crossings took a bridge`)

  // The D1 bend on seed 20260905: the river turns west at (80, -160) with no bridge, so a
  // shop 30 m away across it has no road at all. It stays a labelled bearing.
  const { blueprint, input } = fixture('guard', 20_260_905)
  const graph = getExpeditionGraph(blueprint)
  const shop = getSiteWorldPosition2D(blueprint, 'site-shop-riverside')
  assert.ok(shop)
  let bend = 0
  for (let radius = 15; radius <= DIRECT_APPROACH_METERS; radius += 5) {
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const angle = degrees * Math.PI / 180
      const player = { x: shop.x + Math.cos(angle) * radius, z: shop.z + Math.sin(angle) * radius }
      if (Math.abs(player.x) > 199 || Math.abs(player.z) > 199 || isExpeditionSegmentClear(graph, player, shop)) continue
      const view = new ExpeditionPlanner(blueprint).buildView(pinnedAt(input, player, shop))
      assert.notEqual(view.route?.status, 'direct', `${radius} m at ${degrees}°`)
      bend += 1
    }
  }
  assert.ok(bend >= 50, `only ${bend} wet lines around the bend were exercised`)
})

test('a dry 60-80 m target goes straight only when the road would double the walk, never past 80 m', () => {
  let doubled = 0
  let roadKept = 0
  let farKept = 0
  for (const seed of FIXED_SEEDS.slice(0, 20)) {
    const { blueprint, input } = fixture('villain', seed)
    const graph = getExpeditionGraph(blueprint)
    for (const site of blueprint.sites) {
      const target = getSiteWorldPosition2D(blueprint, site)
      if (!target) continue
      for (const radius of [70, 100]) {
        for (let turn = 0; turn < 4; turn += 1) {
          const angle = turn * Math.PI / 2 + 0.37
          const player = { x: target.x + Math.cos(angle) * radius, z: target.z + Math.sin(angle) * radius }
          if (Math.abs(player.x) > 199 || Math.abs(player.z) > 199 ||
            !isExpeditionSegmentClear(graph, player, target)) continue
          const view = new ExpeditionPlanner(blueprint).buildView(pinnedAt(input, player, target))
          if (radius > DIRECT_APPROACH_DETOUR_METERS) {
            assert.notEqual(view.route?.status, 'direct', `${seed}: ${radius} m must keep the road`)
            farKept += 1
            continue
          }
          const road = planExpeditionRoute(graph, player, target, unknown)
          const doubles = road.status !== 'road' ||
            road.roadDistance + road.connectorDistance >= radius * DIRECT_APPROACH_DETOUR_RATIO
          assert.equal(view.route?.status === 'direct', doubles, `${seed}: ${radius} m`)
          if (doubles) doubled += 1
          else roadKept += 1
        }
      }
    }
  }
  assert.ok(doubled >= 100 && roadKept >= 100 && farKept >= 100, `${doubled}/${roadKept}/${farKept}`)
})

/** The reviewed villain at the A5 camp with the camp done: three ready nodes, nothing pinned. */
function campFixture() {
  const { blueprint } = reviewFixture()
  const faction: Faction = 'villain'
  const [startId, branchId, contractId, altId] = ['start', 'branch', 'contract', 'alt']
    .map((suffix) => `objective-villain-${suffix}`)
  const state = {
    objectives: createGeneratedObjectives(blueprint, faction)
      .map((objective) => ({ ...objective, done: objective.id === startId })),
    contracts: createCampaignContractState(),
  }
  const camp = getSiteWorldPosition2D(blueprint, blueprint.starts.villain)
  assert.ok(camp)
  const at = (player: ExpeditionPoint, rumours: ExpeditionInput['rumours'] = []): ExpeditionInput => ({
    faction, player, heading: 0, objectives: state.objectives, rumours,
    activeObjectiveId: resolveActiveObjectiveNode(blueprint, faction, state.objectives,
      state.contracts.pinnedNodeId)?.id ?? null,
    contracts: buildCampaignContractViews({
      blueprint, faction, objectives: state.objectives, contracts: state.contracts,
      sitePosition: (id) => getSiteWorldPosition2D(blueprint, id) ?? null,
    }),
    discoveredRegionIds: new Set(['region-0-4']),
    chronicleRegions: createChronicleRegions(blueprint), contestedRegionIds: new Set(),
  })
  return { blueprint, ids: { startId, branchId, contractId, altId }, state, camp, at }
}

test('the default compass re-plans when its objective changes, not on every frame', () => {
  const { blueprint, ids, state, camp, at } = campFixture()
  const planner = new ExpeditionPlanner(blueprint)
  const plans = () => planner.getStats().planCount
  const first = planner.buildView(at(camp))
  assert.equal(first.target?.id, ids.branchId, 'nothing pinned: the first ready node')
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
  assert.ok(pinObjective(state.contracts, ids.contractId, [ids.branchId, ids.contractId, ids.altId]))
  const pinned = planner.buildView(at(camp))
  assert.equal(pinned.target?.id, ids.contractId)
  assert.deepEqual(compassProblems(planner.graph, pinned, camp), [])
  assert.equal(plans(), joined + 1)

  // An explicit choice overrides the default, and clearing it returns to the same road.
  assert.ok(planner.select({ kind: 'objective', id: ids.altId }, at(camp)))
  assert.equal(planner.buildView(at(camp)).target?.id, ids.altId)
  assert.ok(planner.select(null, at(camp)))
  const cleared = planner.buildView(at(camp))
  assert.equal(cleared.target?.id, ids.contractId)
  assert.deepEqual(cleared.route, pinned.route)
  assert.equal(plans(), joined + 3)

  // The pinned node completes and closes its alternative, as the engine records it.
  state.objectives = state.objectives.map((objective) => objective.id === ids.contractId
    ? { ...objective, done: true } : objective.id === ids.altId ? { ...objective, skipped: true } : objective)
  state.contracts.pinnedNodeId = null
  const next = planner.buildView(at(camp))
  assert.equal(next.target?.id, ids.branchId)
  assert.deepEqual(compassProblems(planner.graph, next, camp), [])
  assert.equal(plans(), joined + 4)
})

test('a taken live rumour leads the default compass until it is kept, broken or expires', () => {
  const { blueprint, ids, camp, at } = campFixture()
  const rumourId = 'rumour:defend:test'
  const live = {
    id: rumourId, kind: 'defend' as const, regionId: 'region-1-3', targetRegionId: 'region-1-3',
    sourceRegionId: null, siteId: null, caravanId: null, faction: null, raisedTick: 0, deadlineTick: 12,
    progress: 0, actioned: false,
  }
  const commitments: ChronicleCommitmentState = { rumours: [live], pinnedRumourId: null, nextOfferTick: 20, verdict: null }
  const views = (tick = 0) => buildChronicleRumourViews(blueprint, commitments, tick)
  const planner = new ExpeditionPlanner(blueprint)
  const plans = () => planner.getStats().planCount

  // Offered but not taken: the objective keeps the compass.
  const offered = planner.buildView(at(camp, views()))
  assert.equal(offered.target?.id, ids.branchId)
  assert.ok(offered.targets.some((target) => target.id === rumourId && !target.committed))
  assert.equal(plans(), 1)

  // Taken: the rumour leads, charted exactly as an explicit selection would chart it.
  commitments.pinnedRumourId = rumourId
  const taken = planner.buildView(at(camp, views()))
  assert.equal(taken.mode, 'campaign')
  assert.equal(taken.target?.kind, 'rumour')
  assert.equal(taken.target?.id, rumourId)
  assert.deepEqual(compassProblems(planner.graph, taken, camp), [])
  assert.equal(plans(), 2)
  const chosen = new ExpeditionPlanner(blueprint)
  assert.ok(chosen.select({ kind: 'rumour', id: rumourId }, at(camp, views())))
  assert.deepEqual({ ...taken, mode: 'selected' }, chosen.buildView(at(camp, views())))
  for (let frame = 0; frame < 20; frame += 1) planner.buildView(at(camp, views()))
  assert.equal(plans(), 2, 'a live rumour in an unchanged square is not re-planned per frame')

  // An explicit atlas choice still overrides it; clearing returns to the rumour.
  assert.ok(planner.select({ kind: 'objective', id: ids.contractId }, at(camp, views())))
  assert.equal(planner.buildView(at(camp, views())).target?.id, ids.contractId)
  assert.ok(planner.select(null, at(camp, views())))
  assert.equal(planner.buildView(at(camp, views())).target?.id, rumourId)

  // Kept or broken: the verdict replaces the offer, and the objective leads again.
  for (const outcome of ['kept', 'broken'] as const) {
    const settled: ChronicleCommitmentState = {
      rumours: [], pinnedRumourId: null, nextOfferTick: 20,
      verdict: { rumourId, kind: 'defend', outcome, committed: true, regionId: live.regionId,
        targetRegionId: live.targetRegionId, siteId: null, faction: null, tick: 5 },
    }
    const resolved = planner.buildView(at(camp, buildChronicleRumourViews(blueprint, settled, 5)))
    assert.equal(resolved.mode, 'campaign')
    assert.equal(resolved.target?.id, ids.branchId, outcome)
    assert.equal(resolved.notice, null, 'a resolved commitment is not a stale atlas choice')
    assert.equal(resolved.targets.some((target) => target.kind === 'rumour'), false)
    planner.buildView(at(camp, views()))
  }
  // Expired: past its deadline the offer is gone and the objective leads again.
  assert.equal(planner.buildView(at(camp, views(12))).target?.id, ids.branchId)
})

test('a taken escort rumour re-plans when its cart changes square, not on every frame', () => {
  const { blueprint, camp, at } = campFixture()
  const escort = {
    id: 'rumour:escort:caravan-test', kind: 'escort' as const, regionId: 'region-1-3', targetRegionId: 'region-2-2',
    sourceRegionId: 'region-1-3', siteId: null, caravanId: 'caravan-test', faction: null, raisedTick: 0,
    deadlineTick: 20, progress: 0, actioned: false,
  }
  const commitments: ChronicleCommitmentState = {
    rumours: [escort], pinnedRumourId: escort.id, nextOfferTick: 30, verdict: null,
  }
  const planner = new ExpeditionPlanner(blueprint)
  const view = () => planner.buildView(at(camp, buildChronicleRumourViews(blueprint, commitments, 0)))
  const first = view()
  assert.equal(first.target?.id, escort.id)
  // The cart rolls on inside the same square for many frames: one decision.
  for (let frame = 0; frame < 40; frame += 1) view()
  assert.equal(planner.getStats().planCount, 1)
  // The chronicle moves the escort to the cart's new square (`advanceRumourProgress`).
  escort.regionId = 'region-1-2'
  const moved = view()
  assert.equal(planner.getStats().planCount, 2)
  assert.notDeepEqual(moved.target?.position, first.target?.position)
  assert.equal(moved.target?.regionId, 'region-1-2')
  assert.deepEqual(compassProblems(planner.graph, moved, camp), [])
})

test('caravan beat tracking charts a real road without pinning campaign or rumour state', () => {
  const { blueprint, input } = fixture('elf')
  const plan = createBridgeAmbushPlan(blueprint, 'elf')
  assert.ok(plan)
  input.caravanBeats = [{
    id: plan.id,
    title: 'Засада у старого моста',
    regionId: plan.regionId,
    position: plan.cargoStart,
    task: 'Дойти по дороге.',
    stake: 'Не принимает подряд.',
  }]
  const before = JSON.stringify({
    objectives: input.objectives,
    contracts: input.contracts,
    rumours: input.rumours,
  })
  const planner = new ExpeditionPlanner(blueprint)
  assert.equal(planner.select({ kind: 'caravanBeat', id: plan.id }, input), true)
  const view = planner.buildView(input)
  assert.equal(view.target?.kind, 'caravanBeat')
  assert.equal(view.target?.id, plan.id)
  assert.equal(view.route?.status, 'road')
  assert.deepEqual(validateExpeditionRoute(planner.graph, view.route!), [])
  assert.equal(view.bearingReason, null)
  assert.deepEqual(normalizeExpeditionState(planner.serialize()).state.target, {
    kind: 'caravanBeat',
    id: plan.id,
  })
  // A version-1 save that tracked the bridge ambush keeps tracking the same beat.
  assert.deepEqual(normalizeExpeditionState({
    version: 1, mode: 'selected', preference: 'shortest',
    target: { kind: 'bridgeAmbush', id: plan.id },
  }), {
    state: { version: 1, mode: 'selected', preference: 'shortest', target: { kind: 'caravanBeat', id: plan.id } },
    notice: null,
  })
  assert.equal(JSON.stringify({
    objectives: input.objectives,
    contracts: input.contracts,
    rumours: input.rumours,
  }), before)

  input.caravanBeats = []
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

/** W2-3 — the rumour cards as the launch path prices them for `saveFixture`'s save. */
function pricedRumours(
  blueprint: ReturnType<typeof generateWorld>,
  input: ExpeditionInput,
  commitments: ChronicleCommitmentState,
  tick: number,
  chronicle: ActiveRunSaveV3['chronicleState'],
) {
  const knowledge = buildExpeditionKnowledge({
    faction: input.faction, discoveredRegionIds: input.discoveredRegionIds,
    chronicleRegions: new Map(), contestedRegionIds: new Set(),
  }, blueprint)
  return buildChronicleRumourViews(blueprint, commitments, tick, {
    faction: input.faction,
    travel: (point) => estimateChoiceTravel(blueprint, input.player, point, knowledge, PLAYER_WALK_SPEED),
    chronicle,
  })
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

test('a save in the middle of a taken rumour resumes on that rumour and falls back once it expires', () => {
  const { blueprint, save, input } = saveFixture()
  const regionId = blueprint.criticalPaths.villain.regionIds[2]
  const rumour = {
    id: 'rumour:defend:saved', kind: 'defend' as const, regionId, targetRegionId: regionId,
    sourceRegionId: null, siteId: null, caravanId: null, faction: null, raisedTick: 0, deadlineTick: 6,
    progress: 2, actioned: false,
  }
  const commitments: ChronicleCommitmentState = {
    rumours: [rumour], pinnedRumourId: rumour.id, nextOfferTick: 10, verdict: null,
  }
  save.directorState.chronicleCommitments = serializeChronicleCommitmentState(commitments) as JsonValue
  save.directorState.expedition = new ExpeditionPlanner(blueprint).serialize()
  const resume = () => {
    const restored = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(save)))
    assert.ok(restored)
    return buildInitialGameView({ blueprint, config: save.config, restored }).expedition
  }
  const first = resume()
  assert.equal(first.mode, 'campaign')
  assert.equal(first.target?.kind, 'rumour')
  assert.equal(first.target?.id, rumour.id)
  assert.deepEqual(first, new ExpeditionPlanner(blueprint).buildView({
    ...input, rumours: pricedRumours(blueprint, input, commitments, 0, save.chronicleState),
    chronicleRegions: new Map(),
  }), 'the first restored frame agrees with the live planner')
  assert.deepEqual(resume(), first, 'continuing again changes nothing')

  // An explicit atlas choice saved mid-rumour still wins on continue.
  const explicit = new ExpeditionPlanner(blueprint)
  assert.ok(input.activeObjectiveId)
  assert.ok(explicit.select({ kind: 'objective', id: input.activeObjectiveId }, {
    ...input, rumours: buildChronicleRumourViews(blueprint, commitments, 0),
  }))
  save.directorState.expedition = explicit.serialize()
  assert.equal(resume().target?.id, input.activeObjectiveId)

  // Past the deadline the restored compass is back on the objective, with no stale notice.
  save.directorState.expedition = new ExpeditionPlanner(blueprint).serialize()
  save.chronicleState.tick = rumour.deadlineTick
  const expired = resume()
  assert.equal(expired.target?.id, input.activeObjectiveId)
  assert.equal(expired.notice, null)
  assert.equal(expired.targets.some((target) => target.kind === 'rumour'), false)
})

test('a save in the middle of a taken escort resumes on the square its cart is met in', () => {
  const { blueprint, save, input } = saveFixture()
  const start = blueprint.regions.find((region) => region.id === save.currentLocation.regionId)
  assert.ok(start)
  // A cart two squares along the player's row, rolling toward them.
  const step = start.coordinate.x >= 2 ? 1 : -1
  const along = (offset: number): string => {
    const region = blueprint.regions.find((entry) =>
      entry.coordinate.x === start.coordinate.x - step * offset && entry.coordinate.y === start.coordinate.y)
    assert.ok(region)
    return region.id
  }
  const path = [along(2), along(1), along(0)]
  save.chronicleState = createChronicleState()
  save.chronicleState.caravans.push({
    id: 'caravan-saved', ownerFaction: input.faction, fromSiteId: 'site-from', toSiteId: 'site-to',
    regionPath: path, progress: 0, intact: true,
  })
  const escort = {
    id: 'rumour:escort:caravan-saved', kind: 'escort' as const, regionId: path[0], targetRegionId: path[2],
    sourceRegionId: null, siteId: null, caravanId: 'caravan-saved', faction: null, raisedTick: 0, deadlineTick: 5,
    progress: 0, actioned: false,
  }
  const commitments: ChronicleCommitmentState = {
    rumours: [escort], pinnedRumourId: escort.id, nextOfferTick: 10, verdict: null,
  }
  save.directorState.chronicleCommitments = serializeChronicleCommitmentState(commitments) as JsonValue
  save.directorState.expedition = new ExpeditionPlanner(blueprint).serialize()
  const restored = normalizeActiveRunSaveV3(JSON.parse(JSON.stringify(save)))
  assert.ok(restored)
  const resumed = buildInitialGameView({ blueprint, config: save.config, restored }).expedition

  // The meeting the engine's first frame works out from the same place at the same tick.
  const meeting = findEscortMeeting(escort, { blueprint, state: save.chronicleState },
    (point) => estimateWalkSeconds(blueprint, input.player, point, PLAYER_WALK_SPEED), 0)
  assert.ok(meeting, 'the fixture must be a cart the player can meet')
  assert.notEqual(meeting, escort.regionId, 'the fixture must be met somewhere other than where it is')
  assert.equal(resumed.target?.id, escort.id)
  assert.deepEqual(resumed.target?.position,
    rumourTargetPoint(blueprint, { kind: 'escort', regionId: meeting, siteId: null }))

  const knowledge = buildExpeditionKnowledge({
    faction: input.faction, discoveredRegionIds: input.discoveredRegionIds,
    chronicleRegions: new Map(), contestedRegionIds: new Set(),
  }, blueprint)
  const live = new ExpeditionPlanner(blueprint).buildView({
    ...input, chronicleRegions: new Map(),
    rumours: buildChronicleRumourViews(blueprint, commitments, 0, {
      faction: input.faction, chronicle: save.chronicleState,
      travel: (point) => estimateChoiceTravel(blueprint, input.player, point, knowledge, PLAYER_WALK_SPEED),
      meeting: () => meeting,
    }),
  })
  assert.deepEqual(resumed, live, 'the first restored frame agrees with the live compass')
  // Control: without the meeting, the restored compass would lead to the cart's square.
  const unmet = new ExpeditionPlanner(blueprint).buildView({
    ...input, chronicleRegions: new Map(), rumours: buildChronicleRumourViews(blueprint, commitments, 0),
  })
  assert.notDeepEqual(unmet.target?.position, resumed.target?.position)
})

test('restored live rumours share the same position and deadline builder, and expired ones stay out', () => {
  const { blueprint, save, input } = saveFixture()
  const regionId = [...input.discoveredRegionIds][0]
  const rumour = { id: 'rumour:restored', kind: 'defend' as const, regionId, targetRegionId: regionId,
    sourceRegionId: null, siteId: null, caravanId: null, faction: null, raisedTick: 0, deadlineTick: 5,
    progress: 0, actioned: false }
  const commitments = { rumours: [rumour], pinnedRumourId: null, nextOfferTick: 10, verdict: null }
  const rumours = pricedRumours(blueprint, input, commitments, 0, save.chronicleState)
  // The launch path prices the restored card: the walk the compass charts, its verdict and
  // the reward, exactly as the live board does.
  assert.ok(rumours[0].travel && rumours[0].travel.seconds > 0)
  assert.equal(rumours[0].reach, 'yes')
  assert.equal(rumours[0].reward?.gold, 15)
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
