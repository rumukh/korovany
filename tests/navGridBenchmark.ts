/**
 * The region navmesh grid-build benchmark, and the controls that keep it honest.
 *
 * Roadmap 0.3 exists because a benchmark found a stall, not because code looked slow:
 * `NavigationSystem.buildGrid` evaluated ~8,000 fBm height samples per region — one per
 * cell for the height, four more per cell for the slope — at production defaults of 80 m
 * regions and 2 m cells. That is 1,600 cells, and it landed on the first pathfind after
 * every region activation, up to three times per 3×3 streaming step.
 *
 * This file is the instrument, committed so the before and after are measured the same
 * way. It wires the same four real modules `tests/runHarness.ts` does — `generateWorld`,
 * `TerrainSystem`, `CollisionWorld`, `NavigationSystem` — and asks each of a seed's
 * regions for its grid.
 *
 * ---
 *
 * **THE TWO NUMBERS IT REPORTS, AND WHY THERE ARE TWO.**
 *
 * 1. `buildMs` — wall-clock per region grid build. This is the number the roadmap's signal
 *    ("max synchronous grid build under 8 ms") is written against. It is also the number
 *    that means the least across machines: the strategy document measured `sampleHeight`
 *    at ~2.8 µs and grid builds at 20–29 ms median; a 2026 laptop runs the same code at
 *    ~0.63 µs and 5–6 ms. Same mechanism, same shape, faster box. A millisecond threshold
 *    asserted in CI would therefore be measuring the runner, so this file asserts on it
 *    only as a *ratio* between two arms measured in the same process.
 *
 * 2. `liveHeightSamples` — how many times the terrain actually evaluated the noise, counted
 *    by `TerrainSystem.getSampleStats()`. This is machine-independent, exact, and is what
 *    the controls assert. A cached region grid rebuild must add **zero** to it.
 *
 * ---
 *
 * **THE NEGATIVE CONTROL.** `withHeightField: false` wraps the terrain in an adapter that
 * satisfies `NavigationTerrain` *without* `getRegionHeightField`. Nothing else changes: same
 * world, same collision, same grid. It is not a debug switch bolted onto production code —
 * the method is optional in the interface precisely so a terrain that cannot cache still
 * works — and it is the arm that fails if the cache silently stops being hit, because then
 * both arms report the same sample count and the same time.
 */

import { performance } from 'node:perf_hooks'
import { CollisionWorld } from '../src/game/systems/CollisionWorld.ts'
import {
  NavigationSystem,
  type NavigationGrid,
  type NavigationTerrain,
} from '../src/game/systems/NavigationSystem.ts'
import { TerrainSystem } from '../src/game/world/TerrainSystem.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { RegionId } from '../src/game/world/worldTypes.ts'

/** The three seeds the strategy document's own streaming benchmark used. */
export const BENCHMARK_SEEDS = [
  'korovany-blog',
  'fauna-1',
  'strategy-bench',
] as const

export interface RegionBuildSample {
  regionId: RegionId
  buildMs: number
  liveHeightSamples: number
  cells: number
}

export interface GridBuildReport {
  seed: string
  withHeightField: boolean
  regions: RegionBuildSample[]
  medianMs: number
  maxMs: number
  totalMs: number
  liveHeightSamples: number
  /** Grids keyed by region, so two arms can be compared cell for cell. */
  grids: Map<RegionId, NavigationGrid>
}

export interface GridBuildOptions {
  seed: string
  /** `false` runs the negative control: a terrain that cannot hand over a cached field. */
  withHeightField?: boolean
  /**
   * Model a region being streamed back in rather than seen for the first time: build the
   * grid, register a collider in that region — which is what activation does, and what
   * moves `colliderRevision` and misses `getGrid`'s cache — then measure the rebuild.
   *
   * Done per region, in the order the engine touches them, so the arm does not depend on
   * how many fields the terrain keeps. Sweeping all 25 regions and only then rebuilding
   * would evict the early fields before asking for them again, which is a property of a
   * 25-region loop and not of a 3x3 stream.
   */
  rebuildAfterColliders?: boolean
}

/**
 * A terrain that answers every question `NavigationSystem` asks except the cached one.
 *
 * Written out by hand rather than by deleting a property, so it is obvious that the arm
 * differs in exactly one capability.
 */
function withoutHeightField(terrain: TerrainSystem): NavigationTerrain {
  return {
    layout: terrain.layout,
    sampleHeight: (x, z) => terrain.sampleHeight(x, z),
    estimateSlope: (x, z, distance) => terrain.estimateSlope(x, z, distance),
    getRevision: () => terrain.getRevision(),
  }
}

export function measureGridBuilds(options: GridBuildOptions): GridBuildReport {
  const withHeightField = options.withHeightField !== false
  const blueprint = generateWorld(options.seed)
  const terrain = new TerrainSystem(blueprint)
  const collision = new CollisionWorld(terrain)
  collision.setWorldBounds(terrain.bounds)
  const navigation = new NavigationSystem(
    blueprint,
    withHeightField ? terrain : withoutHeightField(terrain),
    collision,
  )
  const regionIds = blueprint.regions.map((region) => region.id)
  navigation.setActiveRegions(regionIds)

  const grids = new Map<RegionId, NavigationGrid>()
  const regions: RegionBuildSample[] = []
  terrain.resetSampleStats()
  for (const regionId of regionIds) {
    if (options.rebuildAfterColliders === true) {
      navigation.getGrid(regionId)
      const bounds = terrain.getRegion(regionId)?.bounds
      if (bounds) {
        collision.registerCircle({
          id: `benchmark-activation:${String(regionId)}`,
          regionId,
          x: (bounds.minX + bounds.maxX) / 2,
          z: (bounds.minZ + bounds.maxZ) / 2,
          radius: 1.5,
        })
      }
      terrain.resetSampleStats()
    }
    const before = terrain.getSampleStats().heightSamples
    const start = performance.now()
    const grid = navigation.getGrid(regionId)
    const buildMs = performance.now() - start
    if (!grid) continue
    grids.set(regionId, grid)
    regions.push({
      regionId,
      buildMs,
      liveHeightSamples: terrain.getSampleStats().heightSamples - before,
      cells: grid.columns * grid.rows,
    })
  }

  const times = regions.map((entry) => entry.buildMs)
  return {
    seed: options.seed,
    withHeightField,
    regions,
    medianMs: median(times),
    maxMs: times.length === 0 ? 0 : Math.max(...times),
    totalMs: times.reduce((sum, value) => sum + value, 0),
    liveHeightSamples: regions.reduce(
      (sum, entry) => sum + entry.liveHeightSamples,
      0,
    ),
    grids,
  }
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/**
 * Every difference between two grids for the same region, as readable strings.
 *
 * Empty means the cached field reproduced the live evaluation exactly — which is the whole
 * safety argument for this change, so the comparison is on the *stored* values rather than
 * on a tolerance.
 */
export function diffGrids(
  expected: NavigationGrid,
  actual: NavigationGrid,
): string[] {
  const problems: string[] = []
  if (expected.columns !== actual.columns || expected.rows !== actual.rows) {
    problems.push(
      `grid shape ${expected.columns}x${expected.rows} became ${actual.columns}x${actual.rows}`,
    )
    return problems
  }
  for (let index = 0; index < expected.walkable.length; index += 1) {
    if (expected.walkable[index] !== actual.walkable[index]) {
      problems.push(
        `walkable[${index}] ${expected.walkable[index]} became ${actual.walkable[index]}`,
      )
    }
    if (expected.heights[index] !== actual.heights[index]) {
      problems.push(
        `heights[${index}] ${expected.heights[index]} became ${actual.heights[index]}`,
      )
    }
    if (problems.length >= 8) break
  }
  return problems
}

export function formatReport(report: GridBuildReport): string {
  const arm = report.withHeightField ? 'cached field' : 'live control'
  return (
    `${report.seed.padEnd(16)} ${arm.padEnd(13)} ` +
    `median ${report.medianMs.toFixed(2)} ms  ` +
    `max ${report.maxMs.toFixed(2)} ms  ` +
    `all ${report.regions.length} ${report.totalMs.toFixed(0)} ms  ` +
    `live height samples ${report.liveHeightSamples}`
  )
}
