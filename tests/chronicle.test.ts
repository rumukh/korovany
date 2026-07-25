import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BEAST_RAID_THRESHOLD,
  CHRONICLE_LOG_LIMIT,
  CHRONICLE_TICK_SECONDS,
  cloneChronicleState,
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  getContestedRegionIds,
  getSupplyPriceMultiplier,
  isRegionRazed,
  normalizeChronicleState,
  normalizeRegionChronicleState,
  tickChronicle,
  type ChronicleEnvironment,
  type ChronicleEvent,
  type ChronicleState,
  type RegionChronicleState,
} from '../src/game/world/Chronicle.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  REGION_DELTA_VERSION,
  normalizeRegionDelta,
} from '../src/game/world/RegionRuntime.ts'
import type { Faction } from '../src/game/types.ts'
import type { WorldBlueprint } from '../src/game/world/worldTypes.ts'

const CLEAR_DAY: ChronicleEnvironment = { nightFactor: 0, stormFactor: 0 }
const STORMY_NIGHT: ChronicleEnvironment = { nightFactor: 1, stormFactor: 1 }

interface RunOptions {
  ticks: number
  seed?: number | string
  faction?: Faction
  objectiveRatio?: number
  environment?: ChronicleEnvironment
  frozenRegionIds?: ReadonlySet<string>
}

interface RunResult {
  blueprint: WorldBlueprint
  state: ChronicleState
  regions: Map<string, RegionChronicleState>
  events: ChronicleEvent[]
  rngState: number
}

function runChronicle(blueprint: WorldBlueprint, options: RunOptions): RunResult {
  const state = createChronicleState()
  const regions = createChronicleRegions(blueprint)
  const rng = new RandomStream(
    deriveSeed(options.seed ?? blueprint.seed, 'gameplay:chronicle'),
  )
  const events: ChronicleEvent[] = []
  for (let tick = 0; tick < options.ticks; tick += 1) {
    events.push(
      ...tickChronicle({
        blueprint,
        state,
        regions,
        rng,
        environment: options.environment ?? CLEAR_DAY,
        playerFaction: options.faction ?? 'elf',
        playerObjectiveRatio: options.objectiveRatio ?? 0,
        protectedRegionIds: getChronicleProtectedRegionIds(blueprint),
        frozenRegionIds: options.frozenRegionIds ?? new Set<string>(),
      }),
    )
  }
  return { blueprint, state, regions, events, rngState: rng.getState() }
}

function fingerprint(result: RunResult): string {
  return JSON.stringify({
    tick: result.state.tick,
    strength: result.state.factionStrength,
    caravans: result.state.caravans,
    log: result.state.log,
    regions: [...result.regions.entries()].sort(([first], [second]) =>
      first.localeCompare(second),
    ),
    rngState: result.rngState,
  })
}

test('the chronicle tick is data only and runs at a fixed 8 second step', () => {
  assert.equal(CHRONICLE_TICK_SECONDS, 8)
  const blueprint = generateWorld('chronicle-cadence')
  const before = process.hrtime.bigint()
  const result = runChronicle(blueprint, { ticks: 200 })
  const microsecondsPerTick = Number(process.hrtime.bigint() - before) / 1000 / 200
  assert.equal(result.state.tick, 200)
  assert.ok(
    microsecondsPerTick < 1000,
    `chronicle tick took ${microsecondsPerTick.toFixed(1)}µs, budget is 1000µs`,
  )
})

test('the same seed produces an identical chronicle history over a fixed tick count', () => {
  const first = runChronicle(generateWorld(20260725), { ticks: 150 })
  const second = runChronicle(generateWorld(20260725), { ticks: 150 })
  assert.equal(fingerprint(first), fingerprint(second))
  assert.ok(first.events.length > 0)

  const other = runChronicle(generateWorld(20260726), { ticks: 150 })
  assert.notEqual(fingerprint(first), fingerprint(other))
})

test('region control changes hands over a long run', () => {
  const blueprint = generateWorld('chronicle-fronts')
  const result = runChronicle(blueprint, { ticks: 240, objectiveRatio: 1 })
  const flipped = blueprint.regions.filter(
    (region) =>
      result.regions.get(String(region.id))?.control !== region.territory,
  )
  assert.ok(
    flipped.length > 0,
    'expected at least one region to change hands over 240 ticks',
  )
  assert.ok(
    result.events.some((event) => event.kind === 'regionCaptured'),
    'expected a regionCaptured entry in the log',
  )
})

test('campaign start and finale regions never flip and their sites are never destroyed', () => {
  for (const seed of [7, 64, 512, 4096]) {
    const blueprint = generateWorld(seed)
    const anchors = getChronicleProtectedRegionIds(blueprint)
    assert.ok(anchors.size > 0)
    const result = runChronicle(blueprint, {
      ticks: 400,
      objectiveRatio: 1,
      environment: STORMY_NIGHT,
    })
    for (const region of blueprint.regions) {
      if (!anchors.has(String(region.id))) continue
      const chronicle = result.regions.get(String(region.id))
      assert.equal(
        chronicle?.control,
        region.territory,
        `seed ${seed}: anchor region ${region.id} changed hands`,
      )
      assert.equal(isRegionRazed(chronicle), false)
    }
    for (const event of result.events) {
      assert.equal(
        anchors.has(String(event.regionId)) && event.kind === 'regionCaptured',
        false,
      )
    }
  }
})

test('the chronicle never flips or burns a region the player is standing in', () => {
  const blueprint = generateWorld('chronicle-frozen')
  const frozen = new Set(blueprint.regions.map((region) => String(region.id)))
  const result = runChronicle(blueprint, {
    ticks: 300,
    objectiveRatio: 1,
    environment: STORMY_NIGHT,
    frozenRegionIds: frozen,
  })
  for (const region of blueprint.regions) {
    const chronicle = result.regions.get(String(region.id))
    assert.equal(chronicle?.control, region.territory)
    assert.equal(chronicle?.settlementIntegrity, 100)
  }
  assert.equal(
    result.events.some(
      (event) => event.kind === 'regionCaptured' || event.kind === 'beastRaid',
    ),
    false,
  )
})

test('beast pressure rises faster at night and in storms and decays under faction control', () => {
  const blueprint = generateWorld('chronicle-beasts')
  const forest = blueprint.regions.find((region) => region.biome === 'forest')
  assert.ok(forest)

  const calm = runChronicle(blueprint, { ticks: 6, environment: CLEAR_DAY })
  const storm = runChronicle(blueprint, { ticks: 6, environment: STORMY_NIGHT })
  const calmPressure = calm.regions.get(String(forest.id))?.beastPressure ?? 0
  const stormPressure = storm.regions.get(String(forest.id))?.beastPressure ?? 0
  assert.ok(
    stormPressure > calmPressure,
    `expected storm-night pressure ${stormPressure} to exceed calm ${calmPressure}`,
  )

  const neutral = blueprint.regions.find(
    (region) => region.biome === 'neutral' && region.territory !== 'neutral',
  )
  if (neutral) {
    assert.equal(calm.regions.get(String(neutral.id))?.beastPressure, 0)
  }
})

test('beast raids ruin settlements and take the shop and healer offline', () => {
  const blueprint = generateWorld('chronicle-raids')
  const settlementRegions = new Set(
    blueprint.sites
      .filter(
        (site) =>
          site.kind === 'settlement' ||
          site.kind === 'shop' ||
          site.kind === 'recovery',
      )
      .map((site) => String(site.regionId)),
  )
  assert.ok(settlementRegions.size > 0)

  const state = createChronicleState()
  const regions = createChronicleRegions(blueprint)
  for (const regionId of settlementRegions) {
    const chronicle = regions.get(regionId)
    assert.ok(chronicle)
    chronicle.control = 'neutral'
    chronicle.beastPressure = BEAST_RAID_THRESHOLD
  }
  const rng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))
  const events: ChronicleEvent[] = []
  for (let tick = 0; tick < 120; tick += 1) {
    events.push(
      ...tickChronicle({
        blueprint,
        state,
        regions,
        rng,
        environment: STORMY_NIGHT,
        playerFaction: 'guard',
        playerObjectiveRatio: 0,
        protectedRegionIds: getChronicleProtectedRegionIds(blueprint),
        frozenRegionIds: new Set<string>(),
      }),
    )
  }

  assert.ok(events.some((event) => event.kind === 'beastRaid'))
  const burned = events.filter((event) => event.kind === 'settlementBurned')
  assert.ok(burned.length > 0, 'expected a settlement to be reduced to разорено')
  for (const event of burned) {
    assert.equal(isRegionRazed(regions.get(String(event.regionId))), true)
  }
  const burnedIds = burned.map((event) => event.regionId)
  assert.equal(new Set(burnedIds).size, burnedIds.length, 'burned only once')
})

test('losing caravans raises prices at the destination settlement', () => {
  const blueprint = generateWorld('chronicle-caravans')
  const observed = runChronicle(blueprint, { ticks: 200, objectiveRatio: 1 })
  assert.ok(
    observed.events.some((event) => event.kind === 'caravanLost'),
    'expected at least one intercepted caravan over a long run',
  )
  assert.ok(
    observed.events.some((event) => event.kind === 'caravanArrived'),
    'expected at least one caravan to arrive over a long run',
  )

  assert.equal(
    getSupplyPriceMultiplier({
      control: 'neutral',
      pressure: { elf: 0, guard: 0, villain: 0 },
      beastPressure: 0,
      settlementIntegrity: 100,
      supply: 1,
      lastEventTick: 0,
    }),
    1,
  )
  assert.equal(
    getSupplyPriceMultiplier({
      control: 'neutral',
      pressure: { elf: 0, guard: 0, villain: 0 },
      beastPressure: 0,
      settlementIntegrity: 100,
      supply: 0,
      lastEventTick: 0,
    }),
    1.45,
  )

  const route = blueprint.roads.connections.find(
    (connection) => connection.regionPath.length >= 3,
  )
  assert.ok(route)
  const destinationId = String(route.regionPath[route.regionPath.length - 1])
  const state = createChronicleState()
  const regions = createChronicleRegions(blueprint)
  const destination = regions.get(destinationId)
  assert.ok(destination)
  const rng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))

  let supplyBefore = destination.supply
  let priceBefore = getSupplyPriceMultiplier(destination)
  let lost = false
  for (let attempt = 0; attempt < 80 && !lost; attempt += 1) {
    // A hostile, beast-infested corridor and a quiet destination isolate the
    // caravan's own effect on supply from raids and front-line shuffling.
    for (const [regionId, chronicle] of regions) {
      chronicle.control = 'guard'
      chronicle.beastPressure = regionId === destinationId ? 0 : 1
    }
    state.caravans = [
      {
        id: `caravan-probe-${attempt}`,
        ownerFaction: 'elf',
        fromSiteId: route.fromSiteId,
        toSiteId: route.toSiteId,
        regionPath: [...route.regionPath],
        progress: 0.4,
        intact: true,
      },
    ]
    supplyBefore = destination.supply
    priceBefore = getSupplyPriceMultiplier(destination)
    lost = tickChronicle({
      blueprint,
      state,
      regions,
      rng,
      environment: CLEAR_DAY,
      playerFaction: 'elf',
      playerObjectiveRatio: 0,
      protectedRegionIds: getChronicleProtectedRegionIds(blueprint),
      frozenRegionIds: new Set<string>(),
    }).some((event) => event.kind === 'caravanLost')
  }

  assert.equal(lost, true, 'expected the probe caravan to be intercepted')
  assert.ok(
    destination.supply < supplyBefore,
    `supply should fall from ${supplyBefore} to below it, got ${destination.supply}`,
  )
  assert.ok(
    getSupplyPriceMultiplier(destination) > priceBefore,
    'a lost caravan must raise prices at the destination',
  )
})

test('the chronicle log stays bounded and keeps the newest entries last', () => {
  const blueprint = generateWorld('chronicle-log')
  const result = runChronicle(blueprint, { ticks: 400, objectiveRatio: 1 })
  assert.ok(result.state.log.length <= CHRONICLE_LOG_LIMIT)
  for (let index = 1; index < result.state.log.length; index += 1) {
    assert.ok(result.state.log[index].tick >= result.state.log[index - 1].tick)
  }
  assert.equal(
    result.state.log[result.state.log.length - 1].id,
    result.events[result.events.length - 1].id,
  )
})

test('contested regions are the ones on a front line', () => {
  const blueprint = generateWorld('chronicle-contested')
  const regions = createChronicleRegions(blueprint)
  const contested = getContestedRegionIds(blueprint, regions)
  for (const segment of blueprint.roads.segments) {
    const from = regions.get(String(segment.fromRegionId))
    const to = regions.get(String(segment.toRegionId))
    if (!from || !to || from.control === to.control) continue
    assert.equal(contested.has(String(segment.fromRegionId)), true)
    assert.equal(contested.has(String(segment.toRegionId)), true)
  }

  for (const chronicle of regions.values()) chronicle.control = 'guard'
  assert.equal(getContestedRegionIds(blueprint, regions).size, 0)
})

test('chronicle state survives a JSON round trip and rejects malformed data', () => {
  const blueprint = generateWorld('chronicle-save')
  const result = runChronicle(blueprint, { ticks: 90, objectiveRatio: 1 })
  const restored = normalizeChronicleState(
    JSON.parse(JSON.stringify(cloneChronicleState(result.state))),
  )
  assert.ok(restored)
  assert.deepEqual(restored, result.state)

  assert.equal(normalizeChronicleState(null), null)
  assert.equal(normalizeChronicleState({ ...result.state, tick: -1 }), null)
  assert.equal(
    normalizeChronicleState({ ...result.state, factionStrength: { elf: 0.5 } }),
    null,
  )
  assert.equal(
    normalizeChronicleState({
      ...result.state,
      log: [{ id: 'x', tick: 1, kind: 'nope', regionId: 'r', faction: null, siteId: null }],
    }),
    null,
  )
  assert.equal(
    normalizeChronicleState({
      ...result.state,
      caravans: [{ id: 'c', ownerFaction: 'beast', fromSiteId: 'a', toSiteId: 'b', regionPath: ['r'], progress: 0, intact: true }],
    }),
    null,
  )
})

test('region deltas carry chronicle state and reject deltas without it', () => {
  const blueprint = generateWorld('chronicle-delta')
  const region = blueprint.regions[0]
  const chronicle = normalizeRegionChronicleState({
    control: 'villain',
    pressure: { elf: 0.1, guard: 0.2, villain: 0.9 },
    beastPressure: 0.5,
    settlementIntegrity: 0,
    supply: 0.25,
    lastEventTick: 9,
  })
  assert.ok(chronicle)

  const delta = {
    version: REGION_DELTA_VERSION,
    regionId: String(region.id),
    revision: 3,
    clearedEncounterIds: [],
    defeatedActorIds: [],
    removedPropIds: [],
    collectedLootIds: [],
    completedInteractionIds: [],
    completedEventIds: [],
    chronicle,
    state: {},
  }
  assert.equal(REGION_DELTA_VERSION, 2)
  const normalized = normalizeRegionDelta(delta, region.id)
  assert.ok(normalized)
  assert.deepEqual(normalized.chronicle, chronicle)
  assert.equal(isRegionRazed(normalized.chronicle), true)

  const { chronicle: _dropped, ...withoutChronicle } = delta
  assert.equal(normalizeRegionDelta(withoutChronicle, region.id), null)
  assert.equal(
    normalizeRegionDelta({ ...delta, version: 1 }, region.id),
    null,
  )
  assert.equal(
    normalizeRegionDelta(
      { ...delta, chronicle: { ...chronicle, control: 'wolves' } },
      region.id,
    ),
    null,
  )
})
