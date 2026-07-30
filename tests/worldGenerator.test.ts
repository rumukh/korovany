import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WorldGenerator,
  generateWorld,
} from '../src/game/world/WorldGenerator.ts'
import {
  computeWorldFingerprint,
  validateWorldBlueprint,
} from '../src/game/world/WorldValidator.ts'
import {
  DEFAULT_REGION_SIZE,
  WORLD_BIOMES,
  WORLD_FACTIONS,
  type FactionObjectiveGraph,
  type WorldBlueprint,
} from '../src/game/world/worldTypes.ts'

test('the same seed produces a deeply equal serializable world and fingerprint', () => {
  const first = generateWorld('the caravan road')
  const second = generateWorld('the caravan road')
  const fromClass = new WorldGenerator('the caravan road').generate()

  assert.deepEqual(first, second)
  assert.deepEqual(first, fromClass)
  assert.equal(first.fingerprint, second.fingerprint)
  assert.equal(first.fingerprint, computeWorldFingerprint(first))
  assert.deepEqual(first.origin, { x: -200, z: -200 })
  assert.deepEqual(first.bounds, { minX: -200, maxX: 200, minZ: -200, maxZ: 200 })
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first)
  assert.equal(first.regionSize, DEFAULT_REGION_SIZE)
  assert.equal(first.dimensions.width * first.regionSize, 400)
  assert.equal(first.dimensions.height * first.regionSize, 400)
})

test('different seeds materially change generated world data', () => {
  const first = generateWorld(1001)
  const second = generateWorld(1002)

  assert.notEqual(first.seed, second.seed)
  assert.notEqual(first.fingerprint, second.fingerprint)
  assert.notDeepEqual(
    first.regions.map((region) => region.heightProfile),
    second.regions.map((region) => region.heightProfile),
  )
  assert.notDeepEqual(
    first.regions.map((region) => [region.territory, region.biome]),
    second.regions.map((region) => [region.territory, region.biome]),
  )
  assert.notDeepEqual(
    first.connections.map((connection) => connection.id),
    second.connections.map((connection) => connection.id),
  )
})

test('five hundred sequential seeds generate valid finite campaigns', () => {
  for (let seed = 0; seed < 500; seed += 1) {
    const world = generateWorld(seed)
    const validation = validateWorldBlueprint(world)
    assert.equal(
      validation.valid,
      true,
      `seed ${seed}: ${validation.issues
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(', ')}`,
    )
    assert.equal(world.regions.length, 25)
  }
})

test('campaign content, faction routes, objectives, and optional branches are complete', () => {
  const world = generateWorld('content-contract')
  assert.deepEqual(new Set(world.regions.map((region) => region.biome)), new Set(WORLD_BIOMES))

  const siteKinds = new Set(world.sites.map((site) => site.kind))
  for (const kind of ['shop', 'recovery', 'event', 'treasure'] as const) {
    assert.ok(siteKinds.has(kind), `missing ${kind}`)
  }
  assert.ok(
    world.roads.connections.some((road) => road.kind === 'branch'),
    'missing non-critical road branch',
  )

  const siteById = new Map(world.sites.map((site) => [site.id, site]))
  const regionById = new Map(world.regions.map((region) => [region.id, region]))
  for (const faction of WORLD_FACTIONS) {
    const start = siteById.get(world.starts[faction])
    const finale = siteById.get(world.finales[faction])
    assert.equal(start?.kind, 'faction-start')
    assert.equal(start?.campaignFaction, faction)
    assert.equal(regionById.get(start?.regionId ?? '')?.territory, faction)
    assert.equal(finale?.kind, 'final-stronghold')
    assert.equal(finale?.campaignFaction, faction)
    assert.notEqual(finale?.owner, faction)
    assert.notEqual(finale?.owner, 'neutral')
    assert.notEqual(regionById.get(finale?.regionId ?? '')?.territory, faction)
    assert.notEqual(regionById.get(finale?.regionId ?? '')?.territory, 'neutral')

    const criticalPath = world.criticalPaths[faction]
    assert.ok(criticalPath.transitionCount >= 6 && criticalPath.transitionCount <= 8)
    assert.equal(criticalPath.transitionCount, criticalPath.regionIds.length - 1)
    assert.equal(criticalPath.regionIds[0], start?.regionId)
    assert.equal(criticalPath.regionIds.at(-1), finale?.regionId)

    const criticalRoad = world.roads.connections.find(
      (road) => road.kind === 'critical' && road.faction === faction,
    )
    assert.deepEqual(criticalRoad?.regionPath, criticalPath.regionIds)
    verifyObjectiveGraph(world, world.objectives[faction])
  }
})

test('every transverse road and river-region crossing has exactly one bridge', () => {
  const world = generateWorld('bridges')
  const expected = deriveTransverseCrossings(world)
  const actual = new Map(
    world.bridges.map((bridge) => [
      bridgeKey(bridge.roadConnectionId, bridge.regionId),
      bridge,
    ]),
  )

  assert.ok(expected.size > 0)
  assert.equal(world.bridges.length, actual.size)
  assert.equal(actual.size, expected.size)
  for (const [key, crossing] of expected) {
    const bridge = actual.get(key)
    assert.ok(bridge)
    assert.equal(bridge.regionId, crossing.regionId)
    assert.equal(bridge.roadConnectionId, crossing.roadConnectionId)
    assert.deepEqual(bridge.roadSegmentIds, crossing.roadSegmentIds)
    assert.equal(bridge.riverId, world.river.id)
  }

  for (const faction of WORLD_FACTIONS) {
    const road = world.roads.connections.find(
      (candidate) => candidate.kind === 'critical' && candidate.faction === faction,
    )
    assert.ok(road)
    const criticalCrossings = [...expected.values()].filter(
      (crossing) => crossing.roadConnectionId === road.id,
    )
    assert.equal(criticalCrossings.length, 1)
    assert.ok(
      world.bridges.some((bridge) => bridge.roadConnectionId === road.id),
      `${faction} critical route does not cross a bridge`,
    )
  }

  const riverRoute = world.roads.connections.find(
    (road) => road.id === 'road-branch-river-route',
  )
  assert.ok(riverRoute)
  // Roadmap 1.5 — the riverside shop and recovery point are now placed along the river
  // rather than pinned to its source and mouth, so the road that runs *with* the water is
  // the stretch between them. It still carries no bridge, and that is what the meander's
  // one-sideways-step-per-row rule buys: three river squares in a row would make this
  // road read as a transverse crossing of its own river.
  const shopRegionId = world.sites.find((site) => site.id === 'site-shop-riverside')?.regionId
  const recoveryRegionId = world.sites.find(
    (site) => site.id === 'site-recovery-riverside',
  )?.regionId
  const shopIndex = world.river.regionPath.indexOf(shopRegionId ?? '')
  const recoveryIndex = world.river.regionPath.indexOf(recoveryRegionId ?? '')
  assert.ok(shopIndex >= 0 && recoveryIndex > shopIndex)
  assert.deepEqual(
    riverRoute.regionPath,
    world.river.regionPath.slice(shopIndex, recoveryIndex + 1),
  )
  assert.equal(
    world.bridges.some((bridge) => bridge.roadConnectionId === riverRoute.id),
    false,
  )
})

/**
 * Roadmap 1.5 — the meander, and the three things that keep it from breaking a campaign.
 *
 * The river may now step one square sideways as it runs south. Every rule below is
 * load-bearing rather than decorative, and each one is checked over five hundred seeds
 * because the failure mode is a seed nobody generated.
 */
test('the macro river meanders inside the rules that keep every campaign solvable', () => {
  let jogged = 0
  const shapes = new Set<string>()
  for (let seed = 0; seed < 500; seed += 1) {
    const world = generateWorld(seed)
    const byId = new Map(world.regions.map((region) => [region.id, region]))
    const path = world.river.regionPath.map((regionId) => {
      const region = byId.get(regionId)
      assert.ok(region, `${regionId} is not a region`)
      return region.coordinate
    })
    shapes.add(path.map((step) => `${step.x},${step.y}`).join('>'))

    assert.equal(path[0].y, 0, `seed ${seed}: the source is not on the north edge`)
    assert.equal(
      path[path.length - 1].y,
      world.dimensions.height - 1,
      `seed ${seed}: the mouth is not on the south edge`,
    )

    const rowCounts = new Map<number, number>()
    for (let index = 0; index < path.length; index += 1) {
      const step = path[index]
      rowCounts.set(step.y, (rowCounts.get(step.y) ?? 0) + 1)
      // Inside the navigable band, so the campaign anchors at x ∈ {0, 4} always straddle it.
      assert.ok(
        step.x >= 1 && step.x <= world.dimensions.width - 2,
        `seed ${seed}: the river left the navigable band at ${step.x},${step.y}`,
      )
      if (index === 0) continue
      const previous = path[index - 1]
      const deltaX = step.x - previous.x
      const deltaY = step.y - previous.y
      assert.ok(
        (deltaX === 0 && deltaY === 1) || (Math.abs(deltaX) === 1 && deltaY === 0),
        `seed ${seed}: the river stepped ${deltaX},${deltaY}`,
      )
      if (deltaY === 0 && index > 1) {
        assert.notEqual(
          path[index - 2].y,
          previous.y,
          `seed ${seed}: two sideways steps in row ${step.y}`,
        )
      }
    }

    for (let row = 0; row < world.dimensions.height; row += 1) {
      const count = rowCounts.get(row) ?? 0
      assert.ok(count === 1 || count === 2, `seed ${seed}: row ${row} holds ${count} river squares`)
    }
    if (path.length > world.dimensions.height) jogged += 1

    // No bridge may span a square where the river turns: its water leaves sideways, so a
    // road fording it would have to run along the water to get out.
    const turning = new Set(
      [...rowCounts.entries()]
        .filter(([, count]) => count > 1)
        .flatMap(([row]) =>
          path.filter((step) => step.y === row).map((step) => `region-${step.x}-${step.y}`),
        ),
    )
    for (const bridge of world.bridges) {
      assert.equal(
        turning.has(bridge.regionId),
        false,
        `seed ${seed}: ${bridge.id} spans a turning square`,
      )
    }
  }

  // Non-vacuity: a meander that never meanders would satisfy every rule above.
  assert.ok(jogged > 250, `only ${jogged} of 500 rivers took a sideways step`)
  assert.ok(shapes.size > 40, `only ${shapes.size} distinct river shapes over 500 seeds`)
})

test('the validator rejects a river that leaves the rules the solver depends on', () => {
  const world = generateWorld('river-rules')

  const outOfBand = structuredClone(world)
  const bandRegion = outOfBand.regions.find(
    (region) => region.id === outOfBand.river.regionPath[0],
  )
  assert.ok(bandRegion)
  outOfBand.river.regionPath[0] = 'region-0-0'
  assert.ok(
    validateWorldBlueprint(outOfBand).issues.some((issue) => issue.code === 'river.column'),
  )

  const jumped = structuredClone(world)
  jumped.river.regionPath[1] = jumped.river.regionPath[jumped.river.regionPath.length - 1]
  assert.ok(
    validateWorldBlueprint(jumped).issues.some((issue) => issue.code === 'river.macroStep'),
  )

  // Three squares in a row is the shape that would make the road running *with* the river
  // read as a transverse crossing of it, so it is rejected rather than merely unlikely.
  const byId = new Map(world.regions.map((region) => [region.id, region]))
  const straightRow = world.river.regionPath.find((regionId) => {
    const coordinate = byId.get(regionId)?.coordinate
    return coordinate?.x === 2 && coordinate.y > 0 && coordinate.y < 4
  })
  assert.ok(straightRow, 'this seed has no middle-column square to widen')
  const widened = structuredClone(world)
  const row = byId.get(straightRow)?.coordinate.y ?? 2
  const at = widened.river.regionPath.indexOf(straightRow)
  widened.river.regionPath.splice(at + 1, 0, `region-3-${row}`, `region-4-${row}`)
  const widenedIssues = validateWorldBlueprint(widened).issues
  assert.ok(widenedIssues.some((issue) => issue.code === 'river.lateralRun'))
  assert.ok(widenedIssues.some((issue) => issue.code === 'river.column'))
})

test('semantic and fingerprint tampering produce structured validation issues', () => {
  const world = generateWorld('tamper-evidence')
  const tampered = structuredClone(world)
  tampered.regions[0].coordinate.x = 99

  const result = validateWorldBlueprint(tampered)
  assert.equal(result.valid, false)
  assert.ok(result.issues.every((issue) => issue.severity === 'error'))
  assert.ok(result.issues.some((issue) => issue.code === 'region.coordinate'))
  assert.ok(result.issues.some((issue) => issue.code === 'fingerprint.mismatch'))

  const missingBridge = structuredClone(world)
  missingBridge.bridges.pop()
  const bridgeResult = validateWorldBlueprint(missingBridge)
  assert.ok(bridgeResult.issues.some((issue) => issue.code === 'bridge.missing'))
  assert.ok(bridgeResult.issues.some((issue) => issue.code === 'fingerprint.mismatch'))

  const fingerprintOnly = structuredClone(world)
  fingerprintOnly.fingerprint = 'wg1-tampered'
  assert.equal(computeWorldFingerprint(fingerprintOnly), world.fingerprint)
  assert.ok(
    validateWorldBlueprint(fingerprintOnly).issues.some(
      (issue) => issue.code === 'fingerprint.mismatch',
    ),
  )
})

test('bridge validation rejects duplicates, malformed records, and along-river bridges', () => {
  const world = generateWorld('bridge-validation')
  assert.ok(world.bridges.length > 0)

  const duplicate = structuredClone(world)
  const duplicateBridge = structuredClone(duplicate.bridges[0])
  duplicateBridge.id = `${duplicateBridge.id}-duplicate`
  duplicate.bridges.push(duplicateBridge)
  assert.ok(
    validateWorldBlueprint(duplicate).issues.some(
      (issue) => issue.code === 'bridge.duplicateCrossing',
    ),
  )

  const malformed = structuredClone(world)
  malformed.bridges[0].roadSegmentIds.pop()
  const malformedIssues = validateWorldBlueprint(malformed).issues
  assert.ok(malformedIssues.some((issue) => issue.code === 'bridge.segmentIds'))
  assert.ok(malformedIssues.some((issue) => issue.code === 'bridge.malformed'))
  assert.ok(malformedIssues.some((issue) => issue.code === 'bridge.missing'))

  const nonTransverse = structuredClone(world)
  const riverRoute = nonTransverse.roads.connections.find(
    (road) => road.id === 'road-branch-river-route',
  )
  assert.ok(riverRoute)
  nonTransverse.bridges.push({
    id: 'bridge-invalid-along-river',
    regionId: riverRoute.regionPath[1],
    roadConnectionId: riverRoute.id,
    roadSegmentIds: [riverRoute.segmentIds[0], riverRoute.segmentIds[1]],
    riverId: nonTransverse.river.id,
  })
  const nonTransverseIssues = validateWorldBlueprint(nonTransverse).issues
  assert.ok(nonTransverseIssues.some((issue) => issue.code === 'bridge.nonTransverse'))
  assert.ok(nonTransverseIssues.some((issue) => issue.code === 'bridge.extra'))
})

function verifyObjectiveGraph(world: WorldBlueprint, graph: FactionObjectiveGraph): void {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const completed = new Set<string>()
  for (const node of graph.nodes) {
    assert.ok(world.sites.some((site) => site.id === node.siteId))
    assert.ok(world.regions.some((region) => region.id === node.regionId))
    assert.ok(node.prerequisiteIds.every((id) => completed.has(id)))
    completed.add(node.id)
  }
  assert.ok(graph.rootNodeIds.every((id) => nodeById.has(id)))
  assert.equal(nodeById.get(graph.finalNodeId)?.siteId, world.finales[graph.faction])
  assert.equal(completed.size, graph.nodes.length)
}

function deriveTransverseCrossings(world: WorldBlueprint) {
  const regionById = new Map(world.regions.map((region) => [region.id, region]))
  const riverRegionIds = new Set(world.river.regionPath)
  const crossings = new Map<
    string,
    {
      roadConnectionId: string
      regionId: string
      roadSegmentIds: [string, string]
    }
  >()

  for (const road of world.roads.connections) {
    for (let index = 1; index < road.regionPath.length - 1; index += 1) {
      const previous = regionById.get(road.regionPath[index - 1])
      const crossing = regionById.get(road.regionPath[index])
      const next = regionById.get(road.regionPath[index + 1])
      if (
        !previous ||
        !crossing ||
        !next ||
        !riverRegionIds.has(crossing.id) ||
        previous.coordinate.y !== crossing.coordinate.y ||
        next.coordinate.y !== crossing.coordinate.y ||
        (previous.coordinate.x - crossing.coordinate.x) *
          (next.coordinate.x - crossing.coordinate.x) >=
          0
      ) {
        continue
      }
      const value = {
        roadConnectionId: road.id,
        regionId: crossing.id,
        roadSegmentIds: [
          road.segmentIds[index - 1],
          road.segmentIds[index],
        ] as [string, string],
      }
      crossings.set(bridgeKey(value.roadConnectionId, value.regionId), value)
    }
  }
  return crossings
}

function bridgeKey(roadConnectionId: string, regionId: string): string {
  return `${roadConnectionId}\u0000${regionId}`
}
