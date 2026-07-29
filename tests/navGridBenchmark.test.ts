import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BENCHMARK_SEEDS,
  diffGrids,
  formatReport,
  measureGridBuilds,
  median,
} from './navGridBenchmark.ts'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import { NavigationSystem } from '../src/game/systems/NavigationSystem.ts'
import { TerrainSystem } from '../src/game/world/TerrainSystem.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

/**
 * Roadmap 0.3's guardrail: the cached region height field must produce the grid the live
 * noise evaluation produced, cell for cell, or the optimisation has changed the game.
 */
test('a cached region height field builds the same grid as live sampling', () => {
  for (const seed of BENCHMARK_SEEDS) {
    const live = measureGridBuilds({ seed, withHeightField: false })
    const cached = measureGridBuilds({ seed, withHeightField: true })
    assert.equal(cached.grids.size, live.grids.size)
    assert.ok(cached.grids.size > 0)
    for (const [regionId, expected] of live.grids) {
      const actual = cached.grids.get(regionId)
      assert.ok(actual, `no cached grid for ${String(regionId)}`)
      assert.deepEqual(
        diffGrids(expected, actual),
        [],
        `seed ${seed}, region ${String(regionId)}`,
      )
    }
  }
})

/**
 * The equality above is about the grid. This is about every other consumer of the terrain:
 * the batched evaluator inside `TerrainSystem` carries state between calls, so the claim
 * that it cannot change a value has to survive scattered, non-monotonic queries too —
 * exactly what actor grounding and prop placement do.
 */
test('the batched height evaluator matches a fresh evaluation at scattered points', () => {
  const blueprint = generateWorld('strategy-bench')
  const sweeping = new TerrainSystem(blueprint)
  const scattered = new TerrainSystem(blueprint)
  const bounds = sweeping.bounds

  const points: Array<{ x: number; z: number }> = []
  for (let index = 0; index < 4000; index += 1) {
    points.push({
      x: bounds.minX + ((index * 37.13) % (bounds.maxX - bounds.minX)),
      z: bounds.minZ + ((index * 91.7) % (bounds.maxZ - bounds.minZ)),
    })
  }

  // One instance walks the points in a locality-friendly sweep, the other in reverse and
  // interleaved with far-away probes. A sampler whose cache leaked into a result would
  // disagree between the two orders.
  const swept = points.map((point) => sweeping.sampleHeight(point.x, point.z))
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]
    scattered.sampleHeight(bounds.minX, bounds.maxZ)
    assert.equal(
      scattered.sampleHeight(point.x, point.z),
      swept[index],
      `height diverged at ${point.x},${point.z}`,
    )
  }

  // Normals and slopes are four more samples each and are what walkability reads.
  for (const point of points.slice(0, 200)) {
    assert.equal(
      scattered.estimateSlope(point.x, point.z, 0.5),
      sweeping.estimateSlope(point.x, point.z, 0.5),
    )
  }
})

/**
 * The negative control. Region activation registers colliders, which moves
 * `colliderRevision` and misses the grid cache — the pass roadmap 0.3 is about. With the
 * field, that rebuild must evaluate **no** noise at all; without it, it pays the full
 * five samples per cell it always paid. If the cache quietly stops being hit, the two
 * numbers converge and this fails.
 */
test('a collider-driven grid rebuild costs no height samples with the cached field', () => {
  for (const seed of BENCHMARK_SEEDS) {
    const cached = measureGridBuilds({
      seed,
      withHeightField: true,
      rebuildAfterColliders: true,
    })
    const control = measureGridBuilds({
      seed,
      withHeightField: false,
      rebuildAfterColliders: true,
    })

    const cells = control.regions.reduce((sum, entry) => sum + entry.cells, 0)
    assert.equal(
      cached.liveHeightSamples,
      0,
      `${seed}: cached rebuild still evaluated noise`,
    )
    assert.equal(
      control.liveHeightSamples,
      cells * 5,
      `${seed}: the control should pay one height and four slope samples per cell`,
    )
    for (const [regionId, expected] of control.grids) {
      const actual = cached.grids.get(regionId)
      assert.ok(actual)
      assert.deepEqual(diffGrids(expected, actual), [])
    }
  }
})

/**
 * The first build — no cache to fall back on — must still evaluate the same five samples
 * per cell it always did. This is the control for the opposite failure: an optimisation
 * that got faster by sampling less terrain than the grid describes.
 */
test('a first grid build samples the terrain exactly once per cell and four times for slope', () => {
  const report = measureGridBuilds({ seed: 'fauna-1', withHeightField: true })
  for (const region of report.regions) {
    assert.equal(
      region.liveHeightSamples,
      region.cells * 5,
      `${String(region.regionId)} sampled ${region.liveHeightSamples} for ${region.cells} cells`,
    )
  }
  assert.equal(report.regions[0].cells, 1600)
})

/**
 * The signal, measured as a ratio so it means the same thing on any machine.
 *
 * The arm this compares is the one the roadmap describes: a region streamed back in, whose
 * colliders re-register and move `colliderRevision`, missing `getGrid`'s cache. Both arms
 * run in the same process against the same worlds, so the only difference is the cached
 * field. The threshold is deliberately far from the measured result — better than 10x on
 * the machines this has run on — because a wall-clock assertion sitting close to its bound
 * on a shared CI runner is a flake, not a gate. The sample-count controls above already
 * fail *exactly* when the cache stops working; this is the one that says it is worth having.
 *
 * The first-build arm is printed rather than asserted. Both of its arms share the batched
 * evaluator, so the improvement there is against the previous commit, not against anything
 * measurable inside one process — run this file on both commits to see it.
 */
test('the cached field makes a streamed-back region grid build materially faster', () => {
  const live: number[] = []
  const cached: number[] = []
  const lines: string[] = []
  for (const seed of BENCHMARK_SEEDS) {
    lines.push(
      formatReport(measureGridBuilds({ seed, withHeightField: false })),
      formatReport(measureGridBuilds({ seed, withHeightField: true })),
    )
    const liveRebuild = measureGridBuilds({
      seed,
      withHeightField: false,
      rebuildAfterColliders: true,
    })
    const cachedRebuild = measureGridBuilds({
      seed,
      withHeightField: true,
      rebuildAfterColliders: true,
    })
    live.push(...liveRebuild.regions.map((entry) => entry.buildMs))
    cached.push(...cachedRebuild.regions.map((entry) => entry.buildMs))
    lines.push(
      `${formatReport(liveRebuild)}  (streamed back in)`,
      `${formatReport(cachedRebuild)}  (streamed back in)`,
    )
  }
  console.log(`\nRoadmap 0.3 — region navmesh grid build\n${lines.join('\n')}\n`)

  const liveMedian = median(live)
  const cachedMedian = median(cached)
  assert.ok(liveMedian > 0 && cachedMedian > 0)
  assert.ok(
    cachedMedian < liveMedian * 0.5,
    `expected the cached field to beat live sampling: ${cachedMedian.toFixed(2)} ms vs ${liveMedian.toFixed(2)} ms`,
  )
})

/**
 * The other half of the change, and the control that keeps it honest.
 *
 * Making the *first* build cheaper is not a cache — the samples still happen — it is the
 * two memoisations inside the evaluator: the four surrounding region height profiles, and
 * the four hashed lattice corners each of the six noise call sites reads. Neither can alter
 * a value, so nothing but a counter can tell you they are working. Without them a region
 * field costs one profile load and six corner loads per sample; these bounds are an order
 * of magnitude below that, and are what fails if the memoisation is disabled or defeated.
 */
test('a region field sweep resolves profiles and noise corners far less than once per sample', () => {
  const blueprint = generateWorld('korovany-blog')
  const terrain = new TerrainSystem(blueprint)
  terrain.resetSampleStats()
  const field = terrain.getRegionHeightField(blueprint.regions[12].id, {
    columns: 40,
    rows: 40,
    slopeSampleDistance: 0.5,
  })
  assert.ok(field)

  const stats = terrain.getSampleStats()
  const samples = 40 * 40 * 5
  assert.equal(stats.heightSamples, samples)
  // A region spans two region-coordinate quadrants per axis, so a row-major sweep crosses
  // between them a bounded number of times per row rather than a number of times per
  // sample. Measured: 80 for a 40-row sweep, against 8,000 with no memoisation at all.
  assert.ok(
    stats.profileLoads <= 40 * 4,
    `profile loads ${stats.profileLoads} of ${samples} samples`,
  )
  assert.ok(
    stats.noiseCornerLoads < samples,
    `noise corner loads ${stats.noiseCornerLoads} of ${samples * 6} unmemoised`,
  )
  console.log(
    `\nRoadmap 0.3 — evaluator memoisation over one 40x40 region field:\n` +
      `  ${samples} height samples, ${stats.profileLoads} profile loads ` +
      `(${samples} unmemoised), ${stats.noiseCornerLoads} noise corner loads ` +
      `(${samples * 6} unmemoised)\n`,
  )
})

/**
 * The field is a cache, and a cache that never lets go is a leak. Nine regions are live at
 * once in the shipped 3x3 stream; the cap is twelve.
 */
test('region height fields are reused, rebuilt on invalidation, and bounded', () => {
  const blueprint = generateWorld('korovany-blog')
  const terrain = new TerrainSystem(blueprint)
  const request = { columns: 40, rows: 40, slopeSampleDistance: 0.5 }
  const first = blueprint.regions[0].id

  terrain.resetSampleStats()
  const built = terrain.getRegionHeightField(first, request)
  assert.ok(built)
  assert.equal(terrain.getSampleStats().fieldBuilds, 1)
  assert.equal(terrain.getSampleStats().heightSamples, 1600 * 5)

  assert.equal(terrain.getRegionHeightField(first, request), built)
  assert.equal(terrain.getSampleStats().fieldHits, 1)
  assert.equal(terrain.getSampleStats().fieldBuilds, 1)

  // A different lattice is a different field, not a stale hit.
  const coarse = terrain.getRegionHeightField(first, { ...request, columns: 20 })
  assert.ok(coarse)
  assert.notEqual(coarse, built)

  terrain.invalidate()
  const rebuilt = terrain.getRegionHeightField(first, request)
  assert.ok(rebuilt)
  assert.notEqual(rebuilt, built)

  for (const region of blueprint.regions) {
    terrain.getRegionHeightField(region.id, request)
  }
  terrain.resetSampleStats()
  terrain.getRegionHeightField(first, request)
  assert.equal(
    terrain.getSampleStats().fieldBuilds,
    1,
    'the oldest field should have been evicted, not kept for all 25 regions',
  )

  assert.equal(terrain.getRegionHeightField('nowhere' as never, request), undefined)
})

/**
 * `skipTerrainSlope` exists for one caller and must not become a way to walk up cliffs for
 * everyone else. Its default is off, and turning it on changes exactly the terrain half.
 */
test('skipTerrainSlope drops only the terrain half of a walkability test', () => {
  const blueprint = generateWorld('strategy-bench')
  const terrain = new TerrainSystem(blueprint)
  const collision = new CollisionWorld(terrain)
  collision.setWorldBounds(terrain.bounds)
  const navigation = new NavigationSystem(blueprint, terrain, collision)
  navigation.setActiveRegions(blueprint.regions.map((region) => region.id))

  const grid = navigation.getGrid(blueprint.regions[12].id)
  assert.ok(grid)
  let steep = 0
  let checked = 0
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const x = grid.bounds.minX + (column + 0.5) * grid.cellWidth
      const z = grid.bounds.minZ + (row + 0.5) * grid.cellDepth
      const options = {
        maxSlope: 0.2,
        slopeSampleDistance: 0.5,
        requireActiveBounds: false,
      }
      const withSlope = collision.isWalkablePosition(x, z, 0.35, options)
      const withoutSlope = collision.isWalkablePosition(x, z, 0.35, {
        ...options,
        skipTerrainSlope: true,
      })
      checked += 1
      if (withSlope !== withoutSlope) {
        steep += 1
        assert.equal(withSlope, false)
        assert.equal(withoutSlope, true)
        assert.ok(terrain.estimateSlope(x, z, 0.5) > 0.2)
      }
    }
  }
  assert.equal(checked, grid.columns * grid.rows)
  assert.ok(steep > 0, 'the fixture needs cells the slope test rejects')

  // A point outside the world is still not walkable, flag or no flag.
  const outside = { x: terrain.bounds.maxX + 50, z: terrain.bounds.maxZ + 50 }
  assert.equal(
    collision.isWalkablePosition(outside.x, outside.z, 0.35, {
      requireActiveBounds: false,
      skipTerrainSlope: true,
    }),
    false,
  )
})
