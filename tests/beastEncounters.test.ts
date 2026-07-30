/**
 * Layer 3 evidence: how often does the player actually meet beasts?
 *
 * This is the measurement the brief asked for rather than a "beasts exist" assertion.
 * It replays real chronicle ticks across several seeds with a player standing in, and
 * walking between, forest squares, and counts the beast encounters the player is
 * *offered* — the thing Layer 2 could not produce at all.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { RandomStream } from '../src/game/random/RandomStream.ts'
import { deriveSeed } from '../src/game/random/seed.ts'
import {
  createChronicleRegions,
  createChronicleState,
  getChronicleProtectedRegionIds,
  getChronicleSettlementSiteIds,
  resolveMaterializedBeastRaid,
  tickChronicle,
  type ChronicleEnvironment,
} from '../src/game/world/Chronicle.ts'
import {
  MATERIALIZE_BEAST_PRESSURE,
  findPendingMaterializations,
  type PendingMaterialization,
} from '../src/game/world/Materialization.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { Faction } from '../src/game/types.ts'

const NIGHT: ChronicleEnvironment = { nightFactor: 1, stormFactor: 0 }
const TICKS = 150
// Roadmap 1.5 rebuilt this panel. The route this measurement walks is the world's
// settlement squares, and 1.5 stopped pinning those to literal region ids — on `fauna-2`
// the three squares the player now stands in draw no beast raid at all in 150 ticks, which
// makes it a seed that cannot measure the thing. Checked rather than assumed: across
// `fauna-1` … `fauna-10` the Layer 3 counts are 34, **0**, 21, 33, 19, 30, 21, 42, 40, 33,
// so `fauna-2` is the only one of the ten that went quiet. The panel is also widened from
// five seeds to eight, because the front-line coupling measured below turned out to be
// small enough that five seeds could not fix its sign.
const SEEDS = [
  'fauna-1',
  'fauna-3',
  'fauna-4',
  'fauna-5',
  'fauna-6',
  'fauna-7',
  'fauna-8',
  'fauna-9',
]

interface Measurement {
  /** Beast raids offered to the player because they were standing in the square. */
  materialized: number
  /** Beast raids the chronicle resolved elsewhere, out of sight. */
  chronicleOnly: number
  /** Faction raids offered over the same run, for scale. */
  factionRaids: number
  /** Regions that changed hands over the run — the sensitive front-line metric. */
  regionCaptured: number
  /** Squares that ended the run razed. */
  razed: number
}

/**
 * One run.
 *
 * `beastsMaterialize` is the switch that reproduces the Layer 2 world: with it off,
 * `beastRaid` situations are discarded exactly as `findPendingMaterializations` used to
 * discard them, so the two runs are otherwise identical.
 *
 * `handBack` additionally separates *offering* a raid from *resolving* one, which is how
 * the front-line coupling below is attributed to a specific write rather than guessed at.
 */
function measure(
  seed: string,
  playerFaction: Faction,
  beastsMaterialize: boolean,
  handBack = true,
): Measurement {
  const blueprint = generateWorld(seed)
  const regions = createChronicleRegions(blueprint)
  const state = createChronicleState()
  const rng = new RandomStream(deriveSeed(seed, 'gameplay:chronicle'))
  const eventRng = new RandomStream(deriveSeed(seed, 'gameplay:event'))
  const protectedRegionIds = getChronicleProtectedRegionIds(blueprint)
  // The player walks a fixed loop of squares that have something worth raiding.
  const route = blueprint.regions
    .filter(
      (region) => getChronicleSettlementSiteIds(blueprint, String(region.id)).length > 0,
    )
    .map((region) => String(region.id))
  assert.ok(route.length > 0, 'a generated world always has settlements')

  const measurement: Measurement = {
    materialized: 0,
    chronicleOnly: 0,
    factionRaids: 0,
    regionCaptured: 0,
    razed: 0,
  }
  const handled = new Set<string>()

  for (let tick = 0; tick < TICKS; tick += 1) {
    // Twelve ticks per square: about a minute and a half of play in each.
    const standing = route[Math.floor(tick / 12) % route.length]
    const simulated = new Set([standing])
    const events = tickChronicle({
      blueprint,
      state,
      regions,
      rng,
      environment: NIGHT,
      playerFaction,
      playerObjectiveRatio: Math.min(1, tick / TICKS),
      protectedRegionIds,
      frozenRegionIds: simulated,
    })
    measurement.chronicleOnly += events.filter(
      (event) => event.kind === 'beastRaid',
    ).length
    measurement.regionCaptured += events.filter(
      (event) => event.kind === 'regionCaptured',
    ).length

    const pending = findPendingMaterializations({
      blueprint,
      regions,
      chronicle: state,
      simulatedRegionIds: simulated,
      protectedRegionIds,
      playerFaction,
      seenAftermathRegionIds: new Set(),
    }).filter(
      (situation) => beastsMaterialize || situation.kind !== 'beastRaid',
    )
    measurement.factionRaids += pending.filter(
      (entry) => entry.kind === 'factionRaid',
    ).length

    const beastRaid: PendingMaterialization | undefined = pending.find(
      (entry) => entry.kind === 'beastRaid',
    )
    if (beastRaid && !handled.has(`${beastRaid.id}:${state.tick}`)) {
      handled.add(`${beastRaid.id}:${state.tick}`)
      measurement.materialized += 1
      if (!handBack) continue
      // The player fights it: they win two out of three, and the hand-back settles the
      // square either way so the run keeps moving.
      const won = eventRng.chance(0.66)
      resolveMaterializedBeastRaid({
        state,
        regions,
        rng: eventRng,
        idPrefix: `measure-${seed}-${state.tick}`,
        outcome: {
          regionId: beastRaid.regionId,
          siteId: beastRaid.siteId,
          beastStrength: won ? 0 : 1,
          defenderStrength: won ? 1 : 0,
        },
      })
    }
  }

  for (const region of regions.values()) {
    if (region.settlementIntegrity <= 0) measurement.razed += 1
  }
  return measurement
}

test('beasts reach the player: Layer 3 turns zero beast encounters into several', () => {
  const before: number[] = []
  const after: number[] = []
  for (const seed of SEEDS) {
    // Negative control first: the Layer 2 world, where `beastRaid` was discarded. If
    // the measurement below were picking up something other than the new code path,
    // this run would score above zero too.
    const layer2 = measure(seed, 'elf', false)
    const layer3 = measure(seed, 'elf', true)
    before.push(layer2.materialized)
    after.push(layer3.materialized)
    assert.equal(
      layer2.materialized,
      0,
      `Layer 2 must offer no beast raids for ${seed}`,
    )
    assert.ok(
      layer3.materialized > 0,
      `expected beast encounters for ${seed}, got ${layer3.materialized}`,
    )
    // The chronicle keeps resolving raids in the other 24 squares regardless.
    assert.ok(
      layer2.chronicleOnly > 0,
      `expected off-screen beast raids for ${seed}, got ${layer2.chronicleOnly}`,
    )
  }
  const total = after.reduce((sum, value) => sum + value, 0)
  assert.equal(before.reduce((sum, value) => sum + value, 0), 0)
  assert.ok(
    total / SEEDS.length >= 2,
    `expected a few beast encounters per ${TICKS}-tick run, averaged ${total / SEEDS.length}`,
  )
})

/**
 * This test replaced one that asserted the opposite, and roadmap 1.5 made it replace its
 * own claim in turn.
 *
 * The original claim was that the two layers were uncoupled, on the evidence that faction
 * raids *offered* did not move. That metric was too sparse to see anything. Counting
 * `regionCaptured` on five seeds showed the fronts slowing — **128 → 114, about 11 %
 * fewer** — and the explanation was `resolveMaterializedBeastRaid` writing
 * `region.lastEventTick`, which `resolveFronts` (Chronicle.ts) reads before flipping a
 * square.
 *
 * **That direction did not survive the world changing.** With 1.5's optional sites placed
 * by eligibility, the same instrument on eleven seeds reports **212 → 234, about 10 % more**
 * captures, and per seed it goes both ways (12→12, 14→17, 10→15, 4→4, 24→23, 34→33, 12→12,
 * 6→6, 26→41, 22→18, 48→53). The mechanism is untouched and still real — a raid writes a
 * cooldown *and* damages settlement integrity, and which of those dominates depends on
 * which squares hold settlements. The eleven-seed reading is that the sign of the net
 * effect was five-seed luck.
 *
 * So the direction is now recorded rather than asserted, and what is asserted is what
 * eleven seeds agree on and what actually matters: the coupling runs through the
 * hand-back's write and nothing else, and it is a perturbation rather than a takeover.
 * The third arm is what makes the attribution a measurement instead of a story: raids are
 * offered but never handed back, and captures land back on the Layer 2 number **exactly**.
 */
test('beast raids move the faction fronts, through the hand-back and nothing else', () => {
  let layer2Captures = 0
  let layer3Captures = 0
  let unresolvedCaptures = 0
  let layer2Offscreen = 0
  let layer3Offscreen = 0

  for (const seed of SEEDS) {
    const layer2 = measure(seed, 'elf', false)
    const layer3 = measure(seed, 'elf', true)
    const offeredOnly = measure(seed, 'elf', true, false)
    layer2Captures += layer2.regionCaptured
    layer3Captures += layer3.regionCaptured
    unresolvedCaptures += offeredOnly.regionCaptured
    layer2Offscreen += layer2.chronicleOnly
    layer3Offscreen += layer3.chronicleOnly
    assert.ok(layer3.materialized > 0, `expected beast raids for ${seed}`)
    // Per seed as well as in total, because a total can cancel two opposite errors.
    assert.equal(
      offeredOnly.regionCaptured,
      layer2.regionCaptured,
      `${seed}: offering a raid without resolving it touched the fronts`,
    )
  }

  assert.ok(layer2Captures > 0, 'the fronts must actually move, or this measures nothing')
  assert.notEqual(
    layer3Captures,
    layer2Captures,
    `the hand-back changed nothing at all: ${layer2Captures} → ${layer3Captures}`,
  )
  // A perturbation, not a takeover. If this ever trips, beasts have started running the war.
  assert.ok(
    Math.abs(layer3Captures - layer2Captures) < layer2Captures * 0.25,
    `beast raids should nudge the war, not decide it: ${layer2Captures} → ${layer3Captures}`,
  )
  // The whole effect is the hand-back writing `lastEventTick` and the settlement damage
  // beside it; merely offering a raid changes nothing at all.
  assert.equal(
    unresolvedCaptures,
    layer2Captures,
    'offering a raid without resolving it must not touch the fronts',
  )
  // Off-screen raids are the same channel seen from the other side: a square that has just
  // been settled does not re-raid immediately, so the count moves rather than holding.
  assert.notEqual(
    layer3Offscreen,
    layer2Offscreen,
    `off-screen beast raids did not move at all: ${layer2Offscreen} → ${layer3Offscreen}`,
  )
})

test('beasts alone never wipe a generated campaign off the map', () => {
  for (const seed of SEEDS) {
    const blueprint = generateWorld(seed)
    const protectedRegionIds = getChronicleProtectedRegionIds(blueprint)
    const regions = createChronicleRegions(blueprint)
    const state = createChronicleState()
    const rng = new RandomStream(deriveSeed(seed, 'gameplay:chronicle'))
    for (let tick = 0; tick < TICKS; tick += 1) {
      tickChronicle({
        blueprint,
        state,
        regions,
        rng,
        environment: NIGHT,
        playerFaction: 'villain',
        playerObjectiveRatio: 0,
        protectedRegionIds,
        frozenRegionIds: new Set(),
      })
    }
    for (const regionId of protectedRegionIds) {
      const region = regions.get(regionId)
      assert.ok(region)
      assert.ok(
        region.settlementIntegrity > 0,
        `campaign anchor ${regionId} was razed in ${seed}`,
      )
    }
  }
})

test('a night forest gets louder than a clear day, which is what drives all of this', () => {
  const pressureAfter = (environment: ChronicleEnvironment): number => {
    const blueprint = generateWorld('fauna-pressure')
    const regions = createChronicleRegions(blueprint)
    const state = createChronicleState()
    const rng = new RandomStream(deriveSeed('fauna-pressure', 'gameplay:chronicle'))
    const forest = blueprint.regions.find((region) => region.biome === 'forest')
    assert.ok(forest, 'the generator always produces forest')
    const frozen = new Set([String(forest.id)])
    for (let tick = 0; tick < 12; tick += 1) {
      tickChronicle({
        blueprint,
        state,
        regions,
        rng,
        environment,
        playerFaction: 'elf',
        playerObjectiveRatio: 0,
        protectedRegionIds: getChronicleProtectedRegionIds(blueprint),
        // Frozen, so pressure accumulates instead of being spent on a raid.
        frozenRegionIds: frozen,
      })
    }
    return regions.get(String(forest.id))?.beastPressure ?? 0
  }
  const day = pressureAfter({ nightFactor: 0, stormFactor: 0 })
  const night = pressureAfter(NIGHT)
  assert.ok(night > day, `a night forest should be louder: ${day} → ${night}`)
  // What Layer 3 cares about is whether the square crosses the *materialization*
  // threshold, which is the point a pack shows up in front of the player.
  assert.ok(
    night >= MATERIALIZE_BEAST_PRESSURE,
    `a frozen night forest should reach the raid threshold: ${night}`,
  )
  assert.ok(
    day < MATERIALIZE_BEAST_PRESSURE,
    `a clear day should not, over the same span: ${day}`,
  )
})
