import type { Faction } from '../src/game/types.ts'
import {
  WORLD_FACTIONS,
  type WorldBlueprint,
} from '../src/game/world/worldTypes.ts'

/**
 * Roadmap 1.5 — the distributional guardrail the generator never had.
 *
 * `tests/worldGenerator.test.ts` asserts a layout is *complete*. Nothing asserted it was
 * *varied*, so a generator that quietly lost diversity passed the whole suite including
 * the 500-seed run. This module is the missing half: it reduces a corpus of seeds to a
 * handful of numbers, and `tests/worldVariety.test.ts` puts floors under them.
 *
 * Two rules govern what belongs here, and both come straight from the roadmap.
 *
 * **Only axes this milestone actually makes vary.** A threshold on something the generator
 * is not intended to move is a test that fails on the day it lands and teaches nothing.
 * So: river shape, territory and road-network layout, the objective middle-site
 * distribution, and optional-site region entropy.
 *
 * **Campaign-anchor entropy is deliberately excluded.** `ENDPOINTS` is a fixed table and
 * stays fixed until roadmap 2.2, because `transverseRegionPath` throws unless the two
 * endpoints straddle the river in x and the river runs north-to-south. Asserting anchor
 * variety now would assert a property the code is not intended to have. That axis is added
 * when 2.2 lands, not before — and {@link ANCHOR_AXIS_EXCLUSION} is the written reason,
 * pinned by a test so it cannot be dropped silently.
 */

export const ANCHOR_AXIS_EXCLUSION =
  'Campaign-anchor entropy is excluded until roadmap 2.2: ENDPOINTS is fixed by ' +
  'construction because transverseRegionPath requires endpoints that straddle a ' +
  'north-south river, so asserting anchor variety would assert a property 1.5 does ' +
  'not ship.'

export const OPTIONAL_SITE_IDS = [
  'site-settlement-crossroads',
  'site-shop-riverside',
  'site-recovery-riverside',
  'site-event-frontier',
  'site-treasure-hidden',
  'site-landmark-old-road',
] as const

export type VarietyAxis = 'river' | 'layout' | 'objectives' | 'optionalSites'

export const VARIETY_AXES = [
  'river',
  'layout',
  'objectives',
  'optionalSites',
] as const satisfies readonly VarietyAxis[]

export interface VarietyMetrics {
  seeds: number
  /** Distinct macro-river region paths — the shape, not just the column. */
  riverShapes: number
  /** Distinct sets of columns the river occupies. */
  riverColumnSets: number
  /** How many of the sampled rivers take at least one lateral step. */
  riverJoggedShare: number
  /** Distinct territory maps, read as one string of 25 owners. */
  territoryMaps: number
  /** Distinct branch-road networks — the part of the road graph the sites move. */
  branchRoadLayouts: number
  /** Distinct critical corridors across the three factions. */
  criticalLayouts: number
  /** Distinct whole campaign graphs, all three factions together. */
  campaignGraphs: number
  /** Smallest per-faction count of distinct middle (errand) sites. */
  minMiddleSitesPerFaction: number
  /** Smallest per-faction count of distinct contract sites. */
  minContractSitesPerFaction: number
  /** Smallest per-faction normalised entropy over the middle-site draw. */
  minMiddleSiteEntropy: number
  /** Distinct placements of the six optional sites, as one tuple. */
  optionalPlacements: number
  /** Smallest per-site count of distinct regions across the corpus. */
  minOptionalSiteRegions: number
  /** Smallest per-site normalised entropy of the region distribution. */
  minOptionalSiteEntropy: number
}

export interface VarietyThresholds {
  riverShapes: number
  riverColumnSets: number
  riverJoggedShare: number
  territoryMaps: number
  branchRoadLayouts: number
  criticalLayouts: number
  campaignGraphs: number
  minMiddleSitesPerFaction: number
  minContractSitesPerFaction: number
  minMiddleSiteEntropy: number
  optionalPlacements: number
  minOptionalSiteRegions: number
  minOptionalSiteEntropy: number
}

/**
 * Which metric belongs to which axis. The negative control walks this map: collapsing one
 * axis of the corpus must break at least one metric that is *attributed to that axis*, so
 * a threshold cannot quietly become a tautology satisfied by a neighbour's entropy.
 */
export const METRIC_AXES: Readonly<Record<keyof VarietyThresholds, VarietyAxis>> = {
  riverShapes: 'river',
  riverColumnSets: 'river',
  riverJoggedShare: 'river',
  territoryMaps: 'layout',
  branchRoadLayouts: 'layout',
  criticalLayouts: 'layout',
  campaignGraphs: 'objectives',
  minMiddleSitesPerFaction: 'objectives',
  minContractSitesPerFaction: 'objectives',
  minMiddleSiteEntropy: 'objectives',
  optionalPlacements: 'optionalSites',
  minOptionalSiteRegions: 'optionalSites',
  minOptionalSiteEntropy: 'optionalSites',
}

function distinct(values: readonly string[]): number {
  return new Set(values).size
}

/** Shannon entropy normalised by the entropy of a uniform draw over the observed support. */
function normalisedEntropy(values: readonly string[]): number {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  if (counts.size <= 1) return 0
  let bits = 0
  for (const count of counts.values()) {
    const share = count / values.length
    bits -= share * Math.log2(share)
  }
  return bits / Math.log2(counts.size)
}

function regionOf(world: WorldBlueprint, siteId: string): string {
  return world.sites.find((site) => site.id === siteId)?.regionId ?? 'missing'
}

function riverShape(world: WorldBlueprint): string {
  return world.river.regionPath.join('>')
}

function riverColumnSet(world: WorldBlueprint): string {
  const byId = new Map(world.regions.map((region) => [region.id, region]))
  const columns = new Set(
    world.river.regionPath.map((regionId) => byId.get(regionId)?.coordinate.x ?? -1),
  )
  return [...columns].sort((first, second) => first - second).join(',')
}

function isJogged(world: WorldBlueprint): boolean {
  return riverColumnSet(world).includes(',')
}

function territoryMap(world: WorldBlueprint): string {
  return world.regions.map((region) => region.territory[0]).join('')
}

function branchRoadLayout(world: WorldBlueprint): string {
  return world.roads.connections
    .filter((road) => road.kind === 'branch')
    .map((road) => `${road.id}:${road.regionPath.join('>')}`)
    .join('|')
}

function criticalLayout(world: WorldBlueprint): string {
  return WORLD_FACTIONS.map((faction) =>
    world.criticalPaths[faction].regionIds.join('>'),
  ).join('|')
}

function campaignGraph(world: WorldBlueprint): string {
  return WORLD_FACTIONS.map((faction) =>
    world.objectives[faction].nodes
      .map((node) => `${node.kind}@${node.siteId}`)
      .join('+'),
  ).join('|')
}

function optionalPlacement(world: WorldBlueprint): string {
  return OPTIONAL_SITE_IDS.map((siteId) => `${siteId}=${regionOf(world, siteId)}`).join('|')
}

function objectiveSite(world: WorldBlueprint, faction: Faction, role: 'middle' | 'contract'): string {
  const nodes = world.objectives[faction].nodes
  const node =
    role === 'contract'
      ? nodes.find((candidate) => candidate.contract !== undefined)
      : nodes.find(
          (candidate) =>
            candidate.contract === undefined &&
            candidate.prerequisiteIds.length > 0 &&
            candidate.id !== world.objectives[faction].finalNodeId,
        )
  return node?.siteId ?? 'missing'
}

export function measureVariety(worlds: readonly WorldBlueprint[]): VarietyMetrics {
  const middlesByFaction = WORLD_FACTIONS.map((faction) =>
    worlds.map((world) => objectiveSite(world, faction, 'middle')),
  )
  const contractsByFaction = WORLD_FACTIONS.map((faction) =>
    worlds.map((world) => objectiveSite(world, faction, 'contract')),
  )
  const regionsBySite = OPTIONAL_SITE_IDS.map((siteId) =>
    worlds.map((world) => regionOf(world, siteId)),
  )

  return {
    seeds: worlds.length,
    riverShapes: distinct(worlds.map(riverShape)),
    riverColumnSets: distinct(worlds.map(riverColumnSet)),
    riverJoggedShare: worlds.filter(isJogged).length / Math.max(1, worlds.length),
    territoryMaps: distinct(worlds.map(territoryMap)),
    branchRoadLayouts: distinct(worlds.map(branchRoadLayout)),
    criticalLayouts: distinct(worlds.map(criticalLayout)),
    campaignGraphs: distinct(worlds.map(campaignGraph)),
    minMiddleSitesPerFaction: Math.min(...middlesByFaction.map(distinct)),
    minContractSitesPerFaction: Math.min(...contractsByFaction.map(distinct)),
    minMiddleSiteEntropy: Math.min(...middlesByFaction.map(normalisedEntropy)),
    optionalPlacements: distinct(worlds.map(optionalPlacement)),
    minOptionalSiteRegions: Math.min(...regionsBySite.map(distinct)),
    minOptionalSiteEntropy: Math.min(...regionsBySite.map(normalisedEntropy)),
  }
}

/**
 * The floors.
 *
 * Every one of them sits below what the generator measured when 1.5 landed and above what
 * it measured the day before, which is the only way a floor can both prove the change and
 * survive ordinary drift. Measured over seeds 0–199, before → after:
 *
 * ```
 * riverShapes            3 → 72     riverColumnSets       3 → 6
 * riverJoggedShare    0.00 → 0.77   optionalPlacements   12 → 200
 * minOptionalSiteRegions 1 → 9      minOptionalSiteEntropy 0.00 → 0.85
 * territoryMaps        176 → 176    branchRoadLayouts   194 → 200
 * criticalLayouts      192 → 189    campaignGraphs      131 → 131
 * ```
 *
 * The last two rows are the axes 1.5 does **not** move. They are floors anyway, and the
 * negative control proves they bind — that is the whole point of a guardrail: it is here
 * for the change that has not been written yet.
 *
 * `riverColumnSets` maxes out at six — the column band is `{1, 2, 3}` and the river's
 * occupied columns are always contiguous — so five is a floor with a square of headroom
 * rather than a slack one.
 */
export const VARIETY_THRESHOLDS: VarietyThresholds = {
  riverShapes: 40,
  riverColumnSets: 5,
  riverJoggedShare: 0.6,
  territoryMaps: 150,
  branchRoadLayouts: 180,
  criticalLayouts: 170,
  campaignGraphs: 110,
  minMiddleSitesPerFaction: 2,
  minContractSitesPerFaction: 3,
  minMiddleSiteEntropy: 0.9,
  optionalPlacements: 150,
  minOptionalSiteRegions: 6,
  minOptionalSiteEntropy: 0.8,
}

export interface VarietyFailure {
  metric: keyof VarietyThresholds
  axis: VarietyAxis
  measured: number
  required: number
}

export function findVarietyFailures(
  metrics: VarietyMetrics,
  thresholds: VarietyThresholds = VARIETY_THRESHOLDS,
): VarietyFailure[] {
  const failures: VarietyFailure[] = []
  for (const key of Object.keys(thresholds) as (keyof VarietyThresholds)[]) {
    const measured = metrics[key]
    const required = thresholds[key]
    if (measured < required) {
      failures.push({ metric: key, axis: METRIC_AXES[key], measured, required })
    }
  }
  return failures
}

export function describeVarietyFailures(failures: readonly VarietyFailure[]): string {
  return failures
    .map(
      (failure) =>
        `${failure.metric} (${failure.axis}) = ${Number(failure.measured.toFixed(3))} < ${failure.required}`,
    )
    .join('; ')
}

/**
 * The negative control's instrument.
 *
 * Collapsing an axis rewrites every world in the corpus so that the named axis carries the
 * value the *first* world happens to have, and leaves the other axes untouched. That is a
 * genuine ablation rather than a rewrite of the assertions: if a metric attributed to the
 * collapsed axis still clears its floor afterwards, the floor was measuring something else.
 */
export function collapseAxis(
  worlds: readonly WorldBlueprint[],
  axis: VarietyAxis,
): WorldBlueprint[] {
  const reference = worlds[0]
  return worlds.map((world) => {
    if (axis === 'river') {
      return { ...world, river: reference.river }
    }
    if (axis === 'layout') {
      return {
        ...world,
        regions: world.regions.map((region, index) => ({
          ...region,
          territory: reference.regions[index].territory,
        })),
        roads: reference.roads,
        criticalPaths: reference.criticalPaths,
      }
    }
    if (axis === 'objectives') {
      return { ...world, objectives: reference.objectives }
    }
    const referenceRegionById = new Map(
      reference.sites.map((site) => [site.id, site.regionId]),
    )
    return {
      ...world,
      sites: world.sites.map((site) =>
        referenceRegionById.has(site.id)
          ? { ...site, regionId: referenceRegionById.get(site.id) ?? site.regionId }
          : site,
      ),
    }
  })
}

/**
 * A second, sharper control aimed at one property rather than a whole axis: put every
 * river back in a single straight column and leave its column choice alone. It is the
 * exact shape of the pre-1.5 generator, so the river floors have to notice.
 */
export function straightenRivers(worlds: readonly WorldBlueprint[]): WorldBlueprint[] {
  return worlds.map((world) => {
    const byId = new Map(world.regions.map((region) => [region.id, region]))
    const column = byId.get(world.river.regionPath[0])?.coordinate.x ?? 2
    const rows = new Set(
      world.river.regionPath.map((regionId) => byId.get(regionId)?.coordinate.y ?? 0),
    )
    return {
      ...world,
      river: {
        ...world.river,
        regionPath: [...rows]
          .sort((first, second) => first - second)
          .map((row) => `region-${column}-${row}`),
      },
    }
  })
}
