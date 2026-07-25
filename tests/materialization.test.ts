import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BEAST_RAID_THRESHOLD,
  CARAVAN_BEAST_THRESHOLD,
  CONTROL_FLIP_COOLDOWN_TICKS,
  createChronicleRegions,
  createChronicleState,
  getCaravanRegionId,
  getChronicleProtectedRegionIds,
  getChronicleSettlementSiteIds,
  resolveMaterializedCaravan,
  resolveMaterializedRaid,
  resolveMaterializedWarband,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import {
  MATERIALIZE_RAID_MARGIN,
  MATERIALIZE_WARBAND_PRESSURE,
  findPendingMaterializations,
  type MaterializationContext,
} from '../src/game/world/Materialization.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { Faction } from '../src/game/types.ts'
import type { WorldBlueprint } from '../src/game/world/worldTypes.ts'

const SEED = 'materialization'

interface Harness {
  blueprint: WorldBlueprint
  regions: Map<string, RegionChronicleState>
  chronicle: ChronicleState
  context: (overrides?: Partial<MaterializationContext>) => MaterializationContext
}

function harness(seed: string | number = SEED): Harness {
  const blueprint = generateWorld(seed)
  const regions = createChronicleRegions(blueprint)
  const chronicle = createChronicleState()
  return {
    blueprint,
    regions,
    chronicle,
    context: (overrides = {}) => ({
      blueprint,
      regions,
      chronicle,
      simulatedRegionIds: new Set<string>(),
      protectedRegionIds: getChronicleProtectedRegionIds(blueprint),
      playerFaction: 'elf',
      seenAftermathRegionIds: new Set<string>(),
      ...overrides,
    }),
  }
}

/** A pair of road-connected regions with a settlement in the target. */
function findRaidPair(
  test: Harness,
): { sourceId: string; targetId: string; siteId: string } | null {
  for (const segment of test.blueprint.roads.segments) {
    for (const [from, to] of [
      [segment.fromRegionId, segment.toRegionId],
      [segment.toRegionId, segment.fromRegionId],
    ] as const) {
      const targetId = String(to)
      const protectedIds = getChronicleProtectedRegionIds(test.blueprint)
      if (protectedIds.has(targetId)) continue
      const siteIds = getChronicleSettlementSiteIds(test.blueprint, targetId)
      if (siteIds.length === 0) continue
      return { sourceId: String(from), targetId, siteId: String(siteIds[0]) }
    }
  }
  return null
}

function arm(
  test: Harness,
  sourceId: string,
  targetId: string,
  attacker: Faction,
  defender: Faction,
): void {
  const source = test.regions.get(sourceId)
  const target = test.regions.get(targetId)
  assert.ok(source && target)
  // Past the post-event breathing room a freshly created region starts inside.
  test.chronicle.tick = Math.max(test.chronicle.tick, CONTROL_FLIP_COOLDOWN_TICKS)
  source.control = attacker
  source.pressure = { elf: 0, guard: 0, villain: 0 }
  source.pressure[attacker] = 0.9
  target.control = defender
  target.pressure = { elf: 0, guard: 0, villain: 0 }
  target.pressure[defender] = 0.1
}

test('nothing materializes in regions that are not simulated', () => {
  const scenario = harness()
  const pair = findRaidPair(scenario)
  assert.ok(pair)
  arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
  assert.deepEqual(findPendingMaterializations(scenario.context()), [])
})

test('a front about to break materializes as a faction raid at its settlement', () => {
  const scenario = harness()
  const pair = findRaidPair(scenario)
  assert.ok(pair)
  arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: new Set([pair.targetId]) }),
  )
  const raid = pending.find((entry) => entry.kind === 'factionRaid')
  assert.ok(raid, 'expected a factionRaid')
  assert.equal(raid.regionId, pair.targetId)
  assert.equal(raid.siteId, pair.siteId)
  assert.equal(raid.faction, 'villain')
  assert.equal(raid.defender, 'guard')
  assert.equal(raid.id, `raid:${pair.targetId}:villain`)
})

test('a front below the raid margin stays in the chronicle', () => {
  const scenario = harness()
  const pair = findRaidPair(scenario)
  assert.ok(pair)
  arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
  const source = scenario.regions.get(pair.sourceId)
  const target = scenario.regions.get(pair.targetId)
  assert.ok(source && target)
  source.pressure.villain = 0.5
  target.pressure.guard = 0.5 - MATERIALIZE_RAID_MARGIN * 0.5
  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: new Set([pair.targetId]) }),
  )
  assert.equal(
    pending.some((entry) => entry.kind === 'factionRaid'),
    false,
  )
})

test('campaign anchors never host a raid', () => {
  const scenario = harness()
  const protectedIds = getChronicleProtectedRegionIds(scenario.blueprint)
  assert.ok(protectedIds.size > 0)
  for (const segment of scenario.blueprint.roads.segments) {
    for (const [from, to] of [
      [segment.fromRegionId, segment.toRegionId],
      [segment.toRegionId, segment.fromRegionId],
    ] as const) {
      if (!protectedIds.has(String(to))) continue
      arm(scenario, String(from), String(to), 'villain', 'guard')
    }
  }
  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: protectedIds }),
  )
  assert.equal(
    pending.some(
      (entry) => entry.kind === 'factionRaid' && protectedIds.has(entry.regionId),
    ),
    false,
  )
})

test('a caravan crossing hostile ground materializes as an ambush', () => {
  const scenario = harness()
  const region = scenario.blueprint.regions[4]
  const regionId = String(region.id)
  const state = scenario.regions.get(regionId)
  assert.ok(state)
  state.control = 'guard'
  scenario.chronicle.caravans.push({
    id: 'caravan-test-1',
    ownerFaction: 'villain',
    fromSiteId: 'from',
    toSiteId: 'to',
    regionPath: [regionId],
    progress: 0,
    intact: true,
  })
  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: new Set([regionId]) }),
  )
  const ambush = pending.find((entry) => entry.kind === 'caravanAmbush')
  assert.ok(ambush)
  assert.equal(ambush.caravanId, 'caravan-test-1')
  assert.equal(ambush.faction, 'villain')
  assert.equal(getCaravanRegionId(scenario.chronicle.caravans[0]), regionId)
})

test('a caravan on quiet friendly ground is not ambushed', () => {
  const scenario = harness()
  const regionId = String(scenario.blueprint.regions[4].id)
  const state = scenario.regions.get(regionId)
  assert.ok(state)
  state.control = 'villain'
  state.beastPressure = CARAVAN_BEAST_THRESHOLD - 0.1
  scenario.chronicle.caravans.push({
    id: 'caravan-test-2',
    ownerFaction: 'villain',
    fromSiteId: 'from',
    toSiteId: 'to',
    regionPath: [regionId],
    progress: 0,
    intact: true,
  })
  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: new Set([regionId]) }),
  )
  assert.equal(
    pending.some((entry) => entry.kind === 'caravanAmbush'),
    false,
  )
})

test('a hostile square under pressure materializes a warband, the player\u2019s does not', () => {
  const scenario = harness()
  const hostileId = String(scenario.blueprint.regions[2].id)
  const friendlyId = String(scenario.blueprint.regions[3].id)
  const hostile = scenario.regions.get(hostileId)
  const friendly = scenario.regions.get(friendlyId)
  assert.ok(hostile && friendly)
  hostile.control = 'guard'
  hostile.pressure.guard = MATERIALIZE_WARBAND_PRESSURE + 0.1
  friendly.control = 'elf'
  friendly.pressure.elf = MATERIALIZE_WARBAND_PRESSURE + 0.1

  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: new Set([hostileId, friendlyId]) }),
  )
  const warbands = pending.filter((entry) => entry.kind === 'warband')
  assert.deepEqual(
    warbands.map((entry) => entry.regionId),
    [hostileId],
  )
  assert.equal(warbands[0].faction, 'guard')
})

test('a razed square materializes its aftermath exactly once', () => {
  const scenario = harness()
  const regionId = String(scenario.blueprint.regions[6].id)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  region.settlementIntegrity = 0
  region.control = 'neutral'
  const simulatedRegionIds = new Set([regionId])
  const first = findPendingMaterializations(scenario.context({ simulatedRegionIds }))
  assert.equal(
    first.some((entry) => entry.kind === 'aftermath' && entry.regionId === regionId),
    true,
  )
  const second = findPendingMaterializations(
    scenario.context({
      simulatedRegionIds,
      seenAftermathRegionIds: new Set([regionId]),
    }),
  )
  assert.equal(
    second.some((entry) => entry.kind === 'aftermath'),
    false,
  )
})

test('pending situations come back most urgent first and are stable', () => {
  const scenario = harness()
  const pair = findRaidPair(scenario)
  assert.ok(pair)
  arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
  const warbandId = String(
    scenario.blueprint.regions.find((region) => String(region.id) !== pair.targetId)?.id,
  )
  const warband = scenario.regions.get(warbandId)
  assert.ok(warband)
  warband.control = 'guard'
  warband.pressure.guard = MATERIALIZE_WARBAND_PRESSURE + 0.2

  const simulatedRegionIds = new Set([pair.targetId, warbandId])
  const first = findPendingMaterializations(scenario.context({ simulatedRegionIds }))
  const second = findPendingMaterializations(scenario.context({ simulatedRegionIds }))
  assert.deepEqual(
    first.map((entry) => entry.id),
    second.map((entry) => entry.id),
  )
  assert.equal(first[0].kind, 'factionRaid')
  assert.ok(first.length >= 2)
})

test('a raid the player abandons is resolved, not cancelled', () => {
  const scenario = harness()
  const pair = findRaidPair(scenario)
  assert.ok(pair)
  arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
  const rng = new RandomStream(deriveSeed(SEED, 'gameplay:event'))
  const resolution = resolveMaterializedRaid({
    state: scenario.chronicle,
    regions: scenario.regions,
    rng,
    protectedRegionIds: getChronicleProtectedRegionIds(scenario.blueprint),
    idPrefix: 'handback-test',
    outcome: {
      regionId: pair.targetId,
      sourceRegionId: pair.sourceId,
      siteId: pair.siteId,
      attacker: 'villain',
      attackerStrength: 1,
      defenderStrength: 0,
    },
  })
  assert.equal(resolution.attackerWon, true)
  assert.equal(scenario.regions.get(pair.targetId)?.control, 'villain')
  assert.ok(
    resolution.events.some((event) => event.kind === 'regionCaptured'),
    'the chronicle records who won',
  )
  assert.ok(scenario.chronicle.log.length > 0)
  assert.ok(
    (scenario.regions.get(pair.targetId)?.settlementIntegrity ?? 100) < 100,
    'the raid still costs the settlement',
  )
})

test('wiping out the attackers is recorded as a repelled raid', () => {
  const scenario = harness()
  const pair = findRaidPair(scenario)
  assert.ok(pair)
  arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
  const before = scenario.regions.get(pair.targetId)?.pressure.villain ?? 0
  const sourceBefore = scenario.regions.get(pair.sourceId)?.pressure.villain ?? 0
  const resolution = resolveMaterializedRaid({
    state: scenario.chronicle,
    regions: scenario.regions,
    rng: new RandomStream(1),
    protectedRegionIds: getChronicleProtectedRegionIds(scenario.blueprint),
    idPrefix: 'handback-repelled',
    outcome: {
      regionId: pair.targetId,
      sourceRegionId: pair.sourceId,
      siteId: pair.siteId,
      attacker: 'villain',
      attackerStrength: 0,
      defenderStrength: 1,
    },
  })
  assert.equal(resolution.attackerWon, false)
  assert.equal(scenario.regions.get(pair.targetId)?.control, 'guard')
  assert.equal(scenario.regions.get(pair.targetId)?.settlementIntegrity, 100)
  assert.deepEqual(
    resolution.events.map((event) => event.kind),
    ['raidRepelled'],
  )
  assert.ok((scenario.regions.get(pair.targetId)?.pressure.villain ?? 1) <= before)
  assert.ok(
    (scenario.regions.get(pair.sourceId)?.pressure.villain ?? 1) < sourceBefore,
    'the assault force is spent out of the region it marched from',
  )
})

test('a repelled raid does not immediately re-materialize on the same settlement', () => {
  const scenario = harness()
  const pair = findRaidPair(scenario)
  assert.ok(pair)
  arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
  // Pressures a real run actually produces, rather than the lopsided ones `arm` uses.
  const source = scenario.regions.get(pair.sourceId)
  const target = scenario.regions.get(pair.targetId)
  assert.ok(source && target)
  source.pressure.villain = 0.45
  target.pressure.guard = 0.3

  const simulatedRegionIds = new Set([pair.targetId])
  const raidPending = (): boolean =>
    findPendingMaterializations(scenario.context({ simulatedRegionIds })).some(
      (entry) => entry.kind === 'factionRaid',
    )
  assert.equal(raidPending(), true, 'the raid should be pending before it is fought')

  resolveMaterializedRaid({
    state: scenario.chronicle,
    regions: scenario.regions,
    rng: new RandomStream(1),
    protectedRegionIds: getChronicleProtectedRegionIds(scenario.blueprint),
    idPrefix: 'handback-treadmill',
    outcome: {
      regionId: pair.targetId,
      sourceRegionId: pair.sourceId,
      siteId: pair.siteId,
      attacker: 'villain',
      attackerStrength: 0,
      defenderStrength: 1,
    },
  })

  assert.equal(
    raidPending(),
    false,
    'winning a raid must not put the same one straight back on the board',
  )
  // And it is the spent assault force that keeps it off, not just the cooldown.
  scenario.chronicle.tick += CONTROL_FLIP_COOLDOWN_TICKS + 1
  assert.equal(raidPending(), false)
})

test('a square that was just fought over gets the same cooldown a front does', () => {
  const scenario = harness()
  const pair = findRaidPair(scenario)
  assert.ok(pair)
  arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
  const target = scenario.regions.get(pair.targetId)
  assert.ok(target)
  scenario.chronicle.tick = 10
  target.lastEventTick = 10
  const simulatedRegionIds = new Set([pair.targetId])
  assert.equal(
    findPendingMaterializations(scenario.context({ simulatedRegionIds })).some(
      (entry) => entry.kind === 'factionRaid',
    ),
    false,
  )
  scenario.chronicle.tick = 10 + CONTROL_FLIP_COOLDOWN_TICKS
  assert.equal(
    findPendingMaterializations(scenario.context({ simulatedRegionIds })).some(
      (entry) => entry.kind === 'factionRaid',
    ),
    true,
  )
})

test('a campaign anchor survives even a raid the attackers win', () => {
  const scenario = harness()
  const protectedId = [...getChronicleProtectedRegionIds(scenario.blueprint)][0]
  const region = scenario.regions.get(protectedId)
  assert.ok(region)
  const control = region.control
  resolveMaterializedRaid({
    state: scenario.chronicle,
    regions: scenario.regions,
    rng: new RandomStream(7),
    protectedRegionIds: getChronicleProtectedRegionIds(scenario.blueprint),
    idPrefix: 'handback-anchor',
    outcome: {
      regionId: protectedId,
      sourceRegionId: null,
      siteId: null,
      attacker: control === 'villain' ? 'guard' : 'villain',
      attackerStrength: 1,
      defenderStrength: 0,
    },
  })
  assert.equal(scenario.regions.get(protectedId)?.control, control)
})

test('the hand-back roll is deterministic for a given rng state', () => {
  const run = (): boolean => {
    const scenario = harness('handback-determinism')
    const pair = findRaidPair(scenario)
    assert.ok(pair)
    arm(scenario, pair.sourceId, pair.targetId, 'villain', 'guard')
    return resolveMaterializedRaid({
      state: scenario.chronicle,
      regions: scenario.regions,
      rng: new RandomStream(deriveSeed(4242, 'gameplay:event')),
      protectedRegionIds: getChronicleProtectedRegionIds(scenario.blueprint),
      idPrefix: 'handback-determinism',
      outcome: {
        regionId: pair.targetId,
        sourceRegionId: pair.sourceId,
        siteId: pair.siteId,
        attacker: 'villain',
        attackerStrength: 0.5,
        defenderStrength: 0.5,
      },
    }).attackerWon
  }
  assert.equal(run(), run())
})

test('an intact caravan rejoins its route, a lost one is written off', () => {
  const scenario = harness()
  const regionId = String(scenario.blueprint.regions[4].id)
  const destinationId = String(scenario.blueprint.regions[5].id)
  scenario.chronicle.caravans.push({
    id: 'caravan-handback',
    ownerFaction: 'villain',
    fromSiteId: 'from',
    toSiteId: 'to',
    regionPath: [regionId, destinationId],
    progress: 0,
    intact: true,
  })
  const supplyBefore = scenario.regions.get(destinationId)?.supply ?? 0

  assert.deepEqual(
    resolveMaterializedCaravan({
      state: scenario.chronicle,
      regions: scenario.regions,
      idPrefix: 'handback-intact',
      outcome: { caravanId: 'caravan-handback', regionId, intact: true },
    }),
    [],
  )
  assert.equal(scenario.chronicle.caravans.length, 1)

  const events = resolveMaterializedCaravan({
    state: scenario.chronicle,
    regions: scenario.regions,
    idPrefix: 'handback-lost',
    outcome: { caravanId: 'caravan-handback', regionId, intact: false },
  })
  assert.deepEqual(
    events.map((event) => event.kind),
    ['caravanLost'],
  )
  assert.equal(scenario.chronicle.caravans.length, 0)
  assert.ok((scenario.regions.get(destinationId)?.supply ?? 1) < supplyBefore)
})

test('a thinned warband loosens its faction grip on the square', () => {
  const scenario = harness()
  const regionId = String(scenario.blueprint.regions[2].id)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  region.control = 'guard'
  region.pressure.guard = 0.8

  resolveMaterializedWarband({
    regions: scenario.regions,
    outcome: { regionId, faction: 'guard', survivorShare: 1 },
  })
  assert.equal(scenario.regions.get(regionId)?.pressure.guard, 0.8)

  resolveMaterializedWarband({
    regions: scenario.regions,
    outcome: { regionId, faction: 'guard', survivorShare: 0 },
  })
  const after = scenario.regions.get(regionId)?.pressure.guard ?? 1
  assert.ok(after < MATERIALIZE_WARBAND_PRESSURE, `expected ${after} to drop below the threshold`)
})

test('beast raids are still chronicle-only: Layer 2 never materializes them', () => {
  const scenario = harness()
  const regionId = String(scenario.blueprint.regions[8].id)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  region.beastPressure = BEAST_RAID_THRESHOLD + 0.2
  region.control = 'neutral'
  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: new Set([regionId]) }),
  )
  assert.equal(
    pending.some((entry) => String(entry.kind) === 'beastRaid'),
    false,
  )
})
