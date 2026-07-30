/**
 * Roadmap 1.5 — the variety test, written before the generator changed.
 *
 * The order is the point. `tests/worldGenerator.test.ts` asserts a world is *complete*;
 * this file asserts a *corpus* of worlds is varied, and it was authored and its floors
 * fixed before a line of the generator moved, so everything after it is provable rather
 * than asserted.
 *
 * What it covers is deliberately narrow — river shape, territory and road-network layout,
 * the objective middle-site distribution, optional-site region entropy. Campaign-anchor
 * entropy is **excluded**, with the reason written down in `ANCHOR_AXIS_EXCLUSION` and
 * pinned below.
 *
 * And it carries its own negative control. A distributional floor is the easiest kind of
 * test to make vacuous: pick a number the corpus already clears for unrelated reasons and
 * it will pass forever. So each axis is ablated in turn and the floors it owns must break.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { WORLD_FACTIONS, type WorldBlueprint } from '../src/game/world/worldTypes.ts'
import {
  ANCHOR_AXIS_EXCLUSION,
  METRIC_AXES,
  OPTIONAL_SITE_IDS,
  VARIETY_AXES,
  VARIETY_THRESHOLDS,
  collapseAxis,
  describeVarietyFailures,
  findVarietyFailures,
  measureVariety,
  straightenRivers,
  type VarietyThresholds,
} from './worldVariety.ts'

const CORPUS_SIZE = 200

let cachedCorpus: WorldBlueprint[] | undefined

function corpus(): WorldBlueprint[] {
  if (!cachedCorpus) {
    cachedCorpus = Array.from({ length: CORPUS_SIZE }, (_, seed) => generateWorld(seed))
  }
  return cachedCorpus
}

test('two hundred seeds clear every variety floor this milestone covers', () => {
  const metrics = measureVariety(corpus())
  const failures = findVarietyFailures(metrics)
  assert.deepEqual(
    failures,
    [],
    `variety floors not met: ${describeVarietyFailures(failures)}`,
  )
  assert.equal(metrics.seeds, CORPUS_SIZE)
})

test('the negative control fires: ablating an axis breaks the floors that axis owns', () => {
  const base = corpus()
  assert.deepEqual(findVarietyFailures(measureVariety(base)), [])

  for (const axis of VARIETY_AXES) {
    const ablated = measureVariety(collapseAxis(base, axis))
    const failures = findVarietyFailures(ablated)
    const owned = failures.filter((failure) => failure.axis === axis)
    assert.ok(
      owned.length > 0,
      `collapsing the ${axis} axis left every ${axis} floor satisfied, so those floors ` +
        'are measuring something else',
    )
    // And an ablation must not be a blunt instrument: collapsing one axis is not allowed
    // to fail another axis's floors, or "which axis is broken" stops meaning anything.
    const collateral = failures.filter((failure) => failure.axis !== axis)
    assert.deepEqual(
      collateral.map((failure) => failure.metric),
      [],
      `collapsing ${axis} also broke ${describeVarietyFailures(collateral)}`,
    )
  }
})

test('every floor is owned by an axis, and every axis owns a floor', () => {
  const metricNames = Object.keys(VARIETY_THRESHOLDS) as (keyof VarietyThresholds)[]
  assert.ok(metricNames.length >= 10)
  for (const metric of metricNames) {
    assert.ok(VARIETY_AXES.includes(METRIC_AXES[metric]), `${metric} has no axis`)
  }
  for (const axis of VARIETY_AXES) {
    assert.ok(
      metricNames.some((metric) => METRIC_AXES[metric] === axis),
      `axis ${axis} owns no floor`,
    )
  }
})

test('a straightened river fails the river floors and nothing else', () => {
  const failures = findVarietyFailures(measureVariety(straightenRivers(corpus())))
  assert.ok(
    failures.some((failure) => failure.metric === 'riverShapes'),
    'putting every river back in one straight column did not trip riverShapes',
  )
  assert.ok(
    failures.some((failure) => failure.metric === 'riverJoggedShare'),
    'putting every river back in one straight column did not trip riverJoggedShare',
  )
  assert.deepEqual(
    failures.filter((failure) => failure.axis !== 'river').map((failure) => failure.metric),
    [],
  )
})

test('optional sites are placed by eligibility, not by a literal region id', () => {
  const worlds = corpus()
  for (const siteId of OPTIONAL_SITE_IDS) {
    const regions = new Set(
      worlds.map(
        (world) => world.sites.find((site) => site.id === siteId)?.regionId ?? 'missing',
      ),
    )
    assert.ok(!regions.has('missing'), `${siteId} is missing from some world`)
    assert.ok(
      regions.size >= VARIETY_THRESHOLDS.minOptionalSiteRegions,
      `${siteId} only ever lands in ${regions.size} region(s)`,
    )
  }

  // No two optional sites may share a square: a fork whose arms are the same place is a
  // fork the player cannot see, which is the thing roadmap 1.4 already spent a slice on.
  for (const world of worlds) {
    const regions = OPTIONAL_SITE_IDS.map(
      (siteId) => world.sites.find((site) => site.id === siteId)?.regionId,
    )
    assert.equal(
      new Set(regions).size,
      OPTIONAL_SITE_IDS.length,
      `seed ${world.seed} put two optional sites in one region`,
    )
  }
})

test('campaign-anchor entropy is excluded on purpose, and the reason is written down', () => {
  // Not an oversight and not a floor set to zero: `ENDPOINTS` is a fixed table until
  // roadmap 2.2, so this asserts the property the code *is* intended to have. When 2.2
  // frees the river axis and the anchors with it, this test is the thing that fails and
  // says "now add the anchor axis".
  const worlds = corpus()
  const reference = worlds[0]
  for (const faction of WORLD_FACTIONS) {
    const startRegion = (world: WorldBlueprint): string | undefined =>
      world.sites.find((site) => site.id === world.starts[faction])?.regionId
    const finaleRegion = (world: WorldBlueprint): string | undefined =>
      world.sites.find((site) => site.id === world.finales[faction])?.regionId
    for (const world of worlds) {
      assert.equal(startRegion(world), startRegion(reference))
      assert.equal(finaleRegion(world), finaleRegion(reference))
    }
  }
  assert.ok(ANCHOR_AXIS_EXCLUSION.includes('2.2'))
  assert.ok(ANCHOR_AXIS_EXCLUSION.length > 80)
  assert.ok(!Object.values(METRIC_AXES).includes('anchors' as never))
})
