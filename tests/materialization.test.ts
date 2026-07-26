import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BEAST_RAID_REPELLED_RESET,
  BEAST_RAID_RESET,
  BEAST_RAID_THRESHOLD,
  CARAVAN_BEAST_THRESHOLD,
  CONTROL_FLIP_COOLDOWN_TICKS,
  createChronicleRegions,
  createChronicleState,
  getCaravanRegionId,
  getChronicleProtectedRegionIds,
  getChronicleSettlementSiteIds,
  resolveMaterializedBeastRaid,
  resolveMaterializedCaravan,
  resolveMaterializedRaid,
  resolveMaterializedWarband,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import {
  MATERIALIZE_BEAST_PRESSURE,
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

/**
 * Layer 3 replaced the Layer 2 assertion that this could never happen. Layer 2 refused
 * to fake a beast raid with a re-skinned faction squad; now that beasts exist, the
 * situation must actually be produced — and only under the conditions that justify it.
 */
test('a loud square with a settlement materializes a beast raid', () => {
  const scenario = harness()
  const regionId = beastRaidRegionId(scenario)
  assert.ok(regionId, 'expected a region with a settlement')
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  armBeasts(scenario, region)

  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: new Set([regionId]) }),
  )
  const raid = pending.find((entry) => entry.kind === 'beastRaid')
  assert.ok(raid, 'expected a beastRaid')
  assert.equal(raid.regionId, regionId)
  assert.equal(raid.id, `beasts:${regionId}`)
  // Beasts belong to no faction and march from nowhere — that is the whole point of
  // §5.3, and the reason a re-skinned faction squad would have been a lie.
  assert.equal(raid.faction, null)
  assert.equal(raid.sourceRegionId, null)
  assert.equal(
    raid.siteId,
    String(getChronicleSettlementSiteIds(scenario.blueprint, regionId)[0]),
  )
  assert.ok(raid.beastPressure >= MATERIALIZE_BEAST_PRESSURE)
})

test('a beast raid materializes before the chronicle would write one down', () => {
  const scenario = harness()
  const regionId = beastRaidRegionId(scenario)
  assert.ok(regionId)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  assert.ok(
    MATERIALIZE_BEAST_PRESSURE < BEAST_RAID_THRESHOLD,
    'the player should meet the pack, not the wreckage',
  )
  armBeasts(scenario, region)
  // Deliberately between the two thresholds: the chronicle would not fire here yet.
  region.beastPressure = (MATERIALIZE_BEAST_PRESSURE + BEAST_RAID_THRESHOLD) / 2
  const pending = findPendingMaterializations(
    scenario.context({ simulatedRegionIds: new Set([regionId]) }),
  )
  assert.ok(pending.some((entry) => entry.kind === 'beastRaid'))
})

test('a quiet, razed, or freshly fought-over square produces no beast raid', () => {
  const scenario = harness()
  const regionId = beastRaidRegionId(scenario)
  assert.ok(regionId)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  const beastRaids = (): boolean =>
    findPendingMaterializations(
      scenario.context({ simulatedRegionIds: new Set([regionId]) }),
    ).some((entry) => entry.kind === 'beastRaid')

  // Negative control: the positive case must be reachable from this exact setup, or
  // every assertion below would pass for the wrong reason.
  armBeasts(scenario, region)
  assert.equal(beastRaids(), true, 'the armed scenario must produce a raid')

  region.beastPressure = MATERIALIZE_BEAST_PRESSURE - 0.01
  assert.equal(beastRaids(), false, 'quiet forest')

  armBeasts(scenario, region)
  region.settlementIntegrity = 0
  assert.equal(beastRaids(), false, 'nothing left to eat')

  armBeasts(scenario, region)
  region.lastEventTick = scenario.chronicle.tick
  assert.equal(beastRaids(), false, 'a square that was just fought over')
})

test('beasts are hostile to whoever holds the ground, whichever side that is', () => {
  const scenario = harness()
  const regionId = beastRaidRegionId(scenario)
  assert.ok(regionId)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  for (const control of ['elf', 'guard', 'villain', 'neutral'] as const) {
    armBeasts(scenario, region)
    region.control = control
    if (control !== 'neutral') region.beastPressure = BEAST_RAID_THRESHOLD
    const pending = findPendingMaterializations(
      scenario.context({
        simulatedRegionIds: new Set([regionId]),
        playerFaction: control === 'elf' ? 'elf' : 'guard',
      }),
    )
    const raid = pending.find((entry) => entry.kind === 'beastRaid')
    assert.ok(raid, `expected a beastRaid on ${control} ground`)
    assert.equal(raid.defender, control)
  }
})

test('a beast raid the player wins thins the forest; one they lose feeds it', () => {
  const scenario = harness()
  const regionId = beastRaidRegionId(scenario)
  assert.ok(regionId)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  const siteId = String(getChronicleSettlementSiteIds(scenario.blueprint, regionId)[0])

  armBeasts(scenario, region)
  const integrityBefore = region.settlementIntegrity
  const repelled = resolveMaterializedBeastRaid({
    state: scenario.chronicle,
    regions: scenario.regions,
    rng: new RandomStream(deriveSeed(SEED, 'beasts:repelled')),
    idPrefix: 'test-repelled',
    outcome: { regionId, siteId, beastStrength: 0, defenderStrength: 1 },
  })
  assert.equal(repelled.beastsWon, false)
  assert.deepEqual(
    repelled.events.map((entry) => entry.kind),
    ['beastsRepelled'],
  )
  assert.equal(region.beastPressure, BEAST_RAID_REPELLED_RESET)
  assert.equal(region.settlementIntegrity, integrityBefore)

  armBeasts(scenario, region)
  const won = resolveMaterializedBeastRaid({
    state: scenario.chronicle,
    regions: scenario.regions,
    rng: new RandomStream(deriveSeed(SEED, 'beasts:won')),
    idPrefix: 'test-won',
    outcome: { regionId, siteId, beastStrength: 1, defenderStrength: 0 },
  })
  assert.equal(won.beastsWon, true)
  assert.equal(won.events[0]?.kind, 'beastRaid')
  assert.equal(won.events[0]?.faction, null)
  assert.equal(region.beastPressure, BEAST_RAID_RESET)
  assert.ok(region.settlementIntegrity < 100, 'the settlement should have been chewed on')
})

/**
 * The engine's `beastRaid` event can fail with defenders still standing — the homestead
 * burns while the garrison is chasing wolves — so it hands back `defenderStrength: 0` to
 * say "the settlement is already lost". That must resolve deterministically, or the
 * chronicle re-rolls a fight the player watched end and logs the opposite outcome.
 */
test('a decided beast raid is not re-rolled by the hand-back', () => {
  const scenario = harness()
  const regionId = beastRaidRegionId(scenario)
  assert.ok(regionId)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  const siteId = String(getChronicleSettlementSiteIds(scenario.blueprint, regionId)[0])

  // Every rng state, so this cannot pass by luck of the stream.
  for (let seed = 0; seed < 24; seed += 1) {
    armBeasts(scenario, region)
    const lost = resolveMaterializedBeastRaid({
      state: scenario.chronicle,
      regions: scenario.regions,
      rng: new RandomStream(deriveSeed(SEED, `decided-lost-${seed}`)),
      idPrefix: `decided-lost-${seed}`,
      // One beast of three left, but the settlement is already down.
      outcome: { regionId, siteId, beastStrength: 1 / 3, defenderStrength: 0 },
    })
    assert.equal(lost.beastsWon, true, `settlement lost must stay lost (seed ${seed})`)
    assert.ok(
      region.settlementIntegrity < 100,
      'a lost settlement must actually take the damage',
    )

    armBeasts(scenario, region)
    const won = resolveMaterializedBeastRaid({
      state: scenario.chronicle,
      regions: scenario.regions,
      rng: new RandomStream(deriveSeed(SEED, `decided-won-${seed}`)),
      idPrefix: `decided-won-${seed}`,
      outcome: { regionId, siteId, beastStrength: 0, defenderStrength: 1 / 2 },
    })
    assert.equal(won.beastsWon, false, `a wiped pack must stay wiped (seed ${seed})`)
  }

  // Negative control: an *undecided* hand-back — the player walked out mid-fight — must
  // still be a roll, otherwise the assertions above would hold for the wrong reason.
  const outcomes = new Set<boolean>()
  for (let seed = 0; seed < 40; seed += 1) {
    armBeasts(scenario, region)
    outcomes.add(
      resolveMaterializedBeastRaid({
        state: scenario.chronicle,
        regions: scenario.regions,
        rng: new RandomStream(deriveSeed(SEED, `undecided-${seed}`)),
        idPrefix: `undecided-${seed}`,
        outcome: { regionId, siteId, beastStrength: 1 / 3, defenderStrength: 1 },
      }).beastsWon,
    )
  }
  assert.equal(outcomes.size, 2, 'an abandoned beast raid should still be rolled')
})

test('a beast raid never flips control: beasts do not hold ground', () => {  const scenario = harness()
  const regionId = beastRaidRegionId(scenario)
  assert.ok(regionId)
  const region = scenario.regions.get(regionId)
  assert.ok(region)
  armBeasts(scenario, region)
  region.control = 'guard'
  region.pressure = { elf: 0.1, guard: 0.7, villain: 0.2 }
  const pressureBefore = { ...region.pressure }
  resolveMaterializedBeastRaid({
    state: scenario.chronicle,
    regions: scenario.regions,
    rng: new RandomStream(deriveSeed(SEED, 'beasts:control')),
    idPrefix: 'test-control',
    outcome: {
      regionId,
      siteId: String(getChronicleSettlementSiteIds(scenario.blueprint, regionId)[0]),
      beastStrength: 1,
      defenderStrength: 0,
    },
  })
  assert.equal(region.control, 'guard')
  assert.deepEqual(region.pressure, pressureBefore)
})

/** First region that actually has something for a pack to come for. */
function beastRaidRegionId(scenario: Harness): string | null {
  for (const region of scenario.blueprint.regions) {
    const regionId = String(region.id)
    if (getChronicleSettlementSiteIds(scenario.blueprint, regionId).length > 0) {
      return regionId
    }
  }
  return null
}

/** Loud forest, intact settlement, past the post-event breathing room. */
function armBeasts(scenario: Harness, region: RegionChronicleState): void {
  scenario.chronicle.tick = Math.max(
    scenario.chronicle.tick,
    CONTROL_FLIP_COOLDOWN_TICKS,
  )
  region.beastPressure = BEAST_RAID_THRESHOLD + 0.2
  region.settlementIntegrity = 100
  region.lastEventTick = 0
}