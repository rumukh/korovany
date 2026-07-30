import { RandomStream } from '../random/RandomStream.ts'
import { deriveSeed, parseSeed, type SeedInput } from '../random/seed.ts'
import type { Faction, ZoneId } from '../types.ts'
import {
  DEFAULT_REGION_SIZE,
  FACTION_CONTRACT_SITES,
  WORLD_FACTIONS,
  WORLD_GENERATOR_VERSION,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type BridgeCrossing,
  type CardinalDirection,
  type CriticalPath,
  type EncounterKind,
  type EncounterSlot,
  type FactionObjectiveGraph,
  type FactionRecord,
  type MacroRiver,
  type RegionConnection,
  type RegionCoordinate,
  type RoadConnection,
  type RoadConnectionKind,
  type RoadNetwork,
  type RoadSegment,
  type SiteId,
  type Territory,
  type WorldBlueprint,
  type WorldRegion,
  type WorldSite,
} from './worldTypes.ts'
import {
  computeWorldFingerprint,
  validateWorldBlueprint,
  type WorldValidationIssue,
} from './WorldValidator.ts'

interface EndpointCoordinates {
  start: RegionCoordinate
  finale: RegionCoordinate
}

interface HeightArchetype {
  baseHeight: number
  relief: number
  roughnessPermille: number
  featureScale: number
  detailScale: number
}

const ENDPOINTS: FactionRecord<EndpointCoordinates> = {
  elf: {
    start: { x: 0, y: 0 },
    finale: { x: 4, y: 3 },
  },
  guard: {
    start: { x: 4, y: 0 },
    finale: { x: 0, y: 3 },
  },
  villain: {
    start: { x: 0, y: 4 },
    finale: { x: 4, y: 1 },
  },
}

const TERRITORY_ANCHORS: FactionRecord<RegionCoordinate> = {
  elf: ENDPOINTS.elf.start,
  guard: ENDPOINTS.guard.start,
  villain: ENDPOINTS.villain.start,
}

const FINALE_TERRITORIES: FactionRecord<Faction> = {
  elf: 'guard',
  guard: 'villain',
  villain: 'guard',
}

const HEIGHT_ARCHETYPES: Record<ZoneId, HeightArchetype> = {
  neutral: {
    baseHeight: 5,
    relief: 7,
    roughnessPermille: 320,
    featureScale: 96,
    detailScale: 24,
  },
  palace: {
    baseHeight: 8,
    relief: 5,
    roughnessPermille: 220,
    featureScale: 112,
    detailScale: 28,
  },
  forest: {
    baseHeight: 7,
    relief: 11,
    roughnessPermille: 480,
    featureScale: 80,
    detailScale: 20,
  },
  fort: {
    baseHeight: 18,
    relief: 22,
    roughnessPermille: 690,
    featureScale: 72,
    detailScale: 16,
  },
}

const DIRECTION_ORDER: Record<CardinalDirection, number> = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
}

/**
 * Roadmap 1.5 — the band the macro river is allowed to wander inside.
 *
 * Not a style choice. `transverseRegionPath` throws unless the two campaign anchors differ
 * in x with the river column strictly between them, and every anchor sits at x ∈ {0, 4}
 * (`ENDPOINTS`). Keeping every river region inside `[1, WORLD_WIDTH - 2]` is therefore the
 * invariant that keeps all three campaigns solvable, whatever the meander does — and
 * `WorldValidator` checks it, so a regression throws at generation rather than shipping.
 */
const RIVER_MIN_COLUMN = 1
const RIVER_MAX_COLUMN = WORLD_WIDTH - 2

/** Per-row chance, in hundredths, of the river stepping one square west, then east. */
const RIVER_JOG_WEST_PERMILLE = 240
const RIVER_JOG_EAST_PERMILLE = 480

/** How many shuffled orderings a road tries before falling back to a constructed path. */
const ROAD_PATH_ATTEMPTS = 8

/**
 * What the road builders need to know about the water, derived once from the macro river.
 *
 * A row holding **two** river squares is a row where the river turns, and its water runs
 * north-into-the-square, then east or west out of it. A road crossing such a row
 * transversely would have to run *along* that lateral leg to leave, which no bridge spans,
 * so a crossing there is impassable rather than merely ugly. Every road path in this file
 * is built to ford only on a `straightRow`, and `WorldValidator` rejects a bridge that
 * lands anywhere else.
 */
interface RiverPlan {
  regionIds: ReadonlySet<string>
  bendRegionIds: ReadonlySet<string>
  columnsByRow: readonly (readonly number[])[]
  straightRows: readonly number[]
}

export class WorldGenerationError extends Error {
  readonly issues: WorldValidationIssue[]

  constructor(issues: WorldValidationIssue[]) {
    const summary = issues
      .slice(0, 5)
      .map((issue) => `${issue.code} at ${issue.path}`)
      .join(', ')
    super(`Deterministic world construction produced an invalid blueprint: ${summary}`)
    this.name = 'WorldGenerationError'
    this.issues = issues
  }
}

export function generateWorld(seedInput: SeedInput): WorldBlueprint {
  const seed = parseSeed(seedInput)
  const regions = createRegions(seed)
  const regionById = new Map(regions.map((region) => [region.id, region]))
  const regionByCoordinate = new Map(
    regions.map((region) => [coordinateKey(region.coordinate), region]),
  )
  const candidateConnections = createConnections(regions, regionByCoordinate)
  const connectionByPair = new Map(
    candidateConnections.map((connection) => [
      unorderedPair(connection.fromRegionId, connection.toRegionId),
      connection,
    ]),
  )
  const river = createRiver(seed, regionByCoordinate, connectionByPair)
  const riverPlan = planRiver(river, regionById)
  const sites = createSites(seed, river, riverPlan, regions, regionById)
  const siteById = new Map(sites.map((site) => [site.id, site]))
  const starts = createStartMap()
  const finales = createFinaleMap()
  const criticalPaths = createCriticalPaths(
    seed,
    riverPlan,
    starts,
    finales,
    siteById,
    regionById,
  )
  const roads = createRoadNetwork(
    seed,
    river,
    riverPlan,
    starts,
    sites,
    siteById,
    criticalPaths,
    regionById,
    connectionByPair,
  )
  const requiredConnectionIds = new Set([
    ...river.segments.map((segment) => segment.connectionId),
    ...roads.segments.map((segment) => segment.connectionId),
  ])
  const connections = selectConnections(
    seed,
    regions,
    candidateConnections,
    requiredConnectionIds,
  )
  const bridges = createBridges(roads, river, regionById)
  const encounters = createEncounters(seed, finales, regions, siteById)
  const objectives = createObjectives(seed, starts, finales, siteById)

  const blueprint: WorldBlueprint = {
    generatorVersion: WORLD_GENERATOR_VERSION,
    seed,
    dimensions: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    regionSize: DEFAULT_REGION_SIZE,
    origin: {
      x: -(WORLD_WIDTH * DEFAULT_REGION_SIZE) / 2,
      z: -(WORLD_HEIGHT * DEFAULT_REGION_SIZE) / 2,
    },
    bounds: {
      minX: -(WORLD_WIDTH * DEFAULT_REGION_SIZE) / 2,
      maxX: (WORLD_WIDTH * DEFAULT_REGION_SIZE) / 2,
      minZ: -(WORLD_HEIGHT * DEFAULT_REGION_SIZE) / 2,
      maxZ: (WORLD_HEIGHT * DEFAULT_REGION_SIZE) / 2,
    },
    regions,
    connections,
    sites,
    starts,
    finales,
    criticalPaths,
    roads,
    river,
    bridges,
    encounters,
    objectives,
    fingerprint: '',
  }
  blueprint.fingerprint = computeWorldFingerprint(blueprint)

  const validation = validateWorldBlueprint(blueprint)
  if (!validation.valid) throw new WorldGenerationError(validation.issues)
  return blueprint
}

export const generateWorldBlueprint = generateWorld

export class WorldGenerator {
  private readonly seedInput: SeedInput | undefined

  constructor(seedInput?: SeedInput) {
    this.seedInput = seedInput
  }

  static generate(seedInput: SeedInput): WorldBlueprint {
    return generateWorld(seedInput)
  }

  generate(seedInput?: SeedInput): WorldBlueprint {
    const selectedSeed = seedInput ?? this.seedInput
    if (selectedSeed === undefined) {
      throw new TypeError('WorldGenerator requires a seed')
    }
    return generateWorld(selectedSeed)
  }
}

function createRegions(seed: number): WorldRegion[] {
  const regions: WorldRegion[] = []
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      const id = regionId(x, y)
      const territory = territoryAt(seed, { x, y })
      const biome = biomeForTerritory(territory)
      const archetype = HEIGHT_ARCHETYPES[biome]
      const profileStream = namedStream(seed, `height-profile:${id}`)
      regions.push({
        id,
        coordinate: { x, y },
        biome,
        territory,
        heightProfile: {
          baseHeight: archetype.baseHeight + profileStream.integer(-2, 3),
          relief: archetype.relief + profileStream.integer(0, 5),
          roughnessPermille: Math.min(
            1000,
            archetype.roughnessPermille + profileStream.integer(-40, 41),
          ),
          featureScale: archetype.featureScale + profileStream.integer(-8, 9),
          detailScale: archetype.detailScale + profileStream.integer(-3, 4),
        },
        edges: [],
        siteIds: [],
        encounterSlotIds: [],
      })
    }
  }
  return regions
}

function createConnections(
  regions: readonly WorldRegion[],
  regionByCoordinate: ReadonlyMap<string, WorldRegion>,
): RegionConnection[] {
  const connections: RegionConnection[] = []
  for (const region of regions) {
    const east = regionByCoordinate.get(
      coordinateKey({ x: region.coordinate.x + 1, y: region.coordinate.y }),
    )
    if (east) addConnection(region, east, 'east', connections)

    const south = regionByCoordinate.get(
      coordinateKey({ x: region.coordinate.x, y: region.coordinate.y + 1 }),
    )
    if (south) addConnection(region, south, 'south', connections)
  }
  return connections
}

function addConnection(
  from: WorldRegion,
  to: WorldRegion,
  direction: CardinalDirection,
  connections: RegionConnection[],
): void {
  const id = `connection-${from.id}-${to.id}`
  connections.push({
    id,
    fromRegionId: from.id,
    toRegionId: to.id,
    direction,
  })
}

function selectConnections(
  seed: number,
  regions: readonly WorldRegion[],
  candidates: readonly RegionConnection[],
  requiredConnectionIds: ReadonlySet<string>,
): RegionConnection[] {
  const candidateById = new Map(candidates.map((connection) => [connection.id, connection]))
  for (const connectionId of requiredConnectionIds) {
    if (!candidateById.has(connectionId)) {
      throw new Error(`Required connection ${connectionId} is not a grid edge`)
    }
  }

  const parent = new Map(regions.map((region) => [region.id, region.id]))
  const findRoot = (regionIdValue: string): string => {
    let root = regionIdValue
    while (parent.get(root) !== root) root = parent.get(root) ?? root
    let current = regionIdValue
    while (current !== root) {
      const next = parent.get(current) ?? root
      parent.set(current, root)
      current = next
    }
    return root
  }
  const union = (connection: RegionConnection): boolean => {
    const fromRoot = findRoot(connection.fromRegionId)
    const toRoot = findRoot(connection.toRegionId)
    if (fromRoot === toRoot) return false
    parent.set(toRoot, fromRoot)
    return true
  }

  const selectedIds = new Set<string>()
  for (const connection of candidates) {
    if (!requiredConnectionIds.has(connection.id)) continue
    selectedIds.add(connection.id)
    union(connection)
  }

  const spanningCandidates = namedStream(seed, 'connections:spanning').shuffle(
    candidates.filter((connection) => !selectedIds.has(connection.id)),
  )
  for (const connection of spanningCandidates) {
    if (!union(connection)) continue
    selectedIds.add(connection.id)
  }

  const extraCandidates = namedStream(seed, 'connections:extras').shuffle(
    candidates.filter((connection) => !selectedIds.has(connection.id)),
  )
  const extraCount = Math.min(
    extraCandidates.length,
    namedStream(seed, 'connections:extra-count').integer(2, 6),
  )
  for (let index = 0; index < extraCount; index += 1) {
    selectedIds.add(extraCandidates[index].id)
  }

  for (const region of regions) region.edges.length = 0
  const regionById = new Map(regions.map((region) => [region.id, region]))
  const selected = candidates.filter((connection) => selectedIds.has(connection.id))
  for (const connection of selected) {
    const from = requireRegion(regionById, connection.fromRegionId)
    const to = requireRegion(regionById, connection.toRegionId)
    from.edges.push({
      direction: connection.direction,
      toRegionId: to.id,
      connectionId: connection.id,
    })
    to.edges.push({
      direction: oppositeDirection(connection.direction),
      toRegionId: from.id,
      connectionId: connection.id,
    })
  }
  for (const region of regions) {
    region.edges.sort(
      (first, second) => DIRECTION_ORDER[first.direction] - DIRECTION_ORDER[second.direction],
    )
  }
  return selected
}

/**
 * Roadmap 1.5 — one river, still north to south, no longer a straight column.
 *
 * The source column is drawn from the stream that always drew it, with the same bounds, so
 * a given seed's river still *starts* where it always started. The meander is new entropy
 * on its own derived stream, which is the rule this generator is built on: adding a step
 * must not shift another step's numbers.
 *
 * Two constraints shape the walk, and both are load-bearing rather than aesthetic:
 *
 * - **At most one lateral step per row.** Two in a row would put three river squares side
 *   by side, and `road-branch-river-route` — which follows the river — would then read as
 *   a transverse crossing of its own water and demand a bridge in the middle of it.
 * - **One row is drawn as the ford and never jogs.** It lies in `1 … WORLD_HEIGHT - 2`,
 *   which is inside every faction's crossing band (elf and guard span rows 0–3, the
 *   villain rows 1–4), so a straight square to ford at always exists for all three. Without
 *   it a seed where every row happened to jog would have no legal crossing and
 *   `transverseRegionPath` would throw — a generation failure, against a 0/500 gate.
 */
function createRiver(
  seed: number,
  regionByCoordinate: ReadonlyMap<string, WorldRegion>,
  connectionByPair: ReadonlyMap<string, RegionConnection>,
): MacroRiver {
  const stream = namedStream(seed, 'river:macro-path')
  let column = stream.integer(RIVER_MIN_COLUMN, RIVER_MAX_COLUMN + 1)
  const meander = namedStream(seed, 'river:meander')
  const fordRow = meander.integer(1, WORLD_HEIGHT - 1)

  const regionPath: string[] = []
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    regionPath.push(requireRegionAt(regionByCoordinate, { x: column, y }).id)
    // Drawn on every row, taken on some: a constant number of draws per row keeps the
    // meander's stream position independent of the shape it produces.
    const roll = meander.integer(0, 1000)
    if (y === fordRow) continue
    const delta =
      roll < RIVER_JOG_WEST_PERMILLE ? -1 : roll < RIVER_JOG_EAST_PERMILLE ? 1 : 0
    const jogged = column + delta
    if (delta === 0 || jogged < RIVER_MIN_COLUMN || jogged > RIVER_MAX_COLUMN) continue
    column = jogged
    regionPath.push(requireRegionAt(regionByCoordinate, { x: column, y }).id)
  }

  return {
    id: 'river-main',
    sourceEdge: 'north',
    mouthEdge: 'south',
    regionPath,
    segments: regionPath.slice(1).map((toRegionId, index) => {
      const fromRegionId = regionPath[index]
      return {
        id: `river-segment-${index}`,
        connectionId: requireConnection(connectionByPair, fromRegionId, toRegionId).id,
        fromRegionId,
        toRegionId,
      }
    }),
  }
}

function planRiver(
  river: MacroRiver,
  regionById: ReadonlyMap<string, WorldRegion>,
): RiverPlan {
  const columnsByRow: number[][] = Array.from({ length: WORLD_HEIGHT }, () => [])
  for (const regionIdValue of river.regionPath) {
    const coordinate = requireRegion(regionById, regionIdValue).coordinate
    columnsByRow[coordinate.y].push(coordinate.x)
  }
  for (const columns of columnsByRow) columns.sort((first, second) => first - second)

  const bendRegionIds = new Set<string>()
  for (let row = 0; row < columnsByRow.length; row += 1) {
    if (columnsByRow[row].length <= 1) continue
    for (const column of columnsByRow[row]) bendRegionIds.add(regionId(column, row))
  }

  return {
    regionIds: new Set(river.regionPath),
    bendRegionIds,
    columnsByRow,
    straightRows: columnsByRow
      .map((columns, row) => (columns.length === 1 ? row : -1))
      .filter((row) => row >= 0),
  }
}

/**
 * Roadmap 1.5 — optional sites placed by eligibility rather than at literal region ids.
 *
 * What was here put the settlement at `region-2-2`, the frontier event at `region-4-4` and
 * the landmark at `region-2-3` for **every seed**, and only the treasure varied, over four
 * fixed candidates. The six literals are genuinely independent of the river solver, which
 * is why the roadmap files this ahead of anything that touches the critical path.
 *
 * Each site now draws from a candidate pool that matches the thing its name promises — a
 * crossroads settlement in the middle of the map, a frontier event on the world edge, a
 * riverside shop upstream of a riverside recovery, a treasure hidden away from where any
 * faction lives — **on its own derived stream**, so adding a site's draw cannot shift
 * another's. Anchor squares are excluded everywhere and no two optional sites may share a
 * square, so the branch roads between them are always real roads.
 *
 * Every pool is non-empty by construction: the interior is nine squares against at most
 * six river squares, the border sixteen against six anchors. The `pool.length === 0`
 * fallback is there because a future change to `ENDPOINTS` or to the meander could narrow
 * one, and a generation failure is measured against a 0/500 gate.
 */
function createSites(
  seed: number,
  river: MacroRiver,
  riverPlan: RiverPlan,
  regions: readonly WorldRegion[],
  regionById: ReadonlyMap<string, WorldRegion>,
): WorldSite[] {
  const sites: WorldSite[] = []
  const addSite = (site: WorldSite): void => {
    sites.push(site)
    requireRegion(regionById, site.regionId).siteIds.push(site.id)
  }

  const claimed = new Set<string>()
  for (const faction of WORLD_FACTIONS) {
    const startRegion = requireRegionAtId(regionById, ENDPOINTS[faction].start)
    const finaleRegion = requireRegionAtId(regionById, ENDPOINTS[faction].finale)
    claimed.add(startRegion.id)
    claimed.add(finaleRegion.id)
    addSite({
      id: startSiteId(faction),
      kind: 'faction-start',
      regionId: startRegion.id,
      owner: faction,
      campaignFaction: faction,
    })
    addSite({
      id: finaleSiteId(faction),
      kind: 'final-stronghold',
      regionId: finaleRegion.id,
      owner: finaleRegion.territory,
      campaignFaction: faction,
    })
  }

  const anchorCoordinates = WORLD_FACTIONS.flatMap((faction) => [
    ENDPOINTS[faction].start,
    ENDPOINTS[faction].finale,
  ])
  const isFarFromAnchors = (region: WorldRegion): boolean =>
    anchorCoordinates.every(
      (anchor) => manhattanDistance(region.coordinate, anchor) >= 2,
    )
  const isBorder = (region: WorldRegion): boolean =>
    region.coordinate.x === 0 ||
    region.coordinate.y === 0 ||
    region.coordinate.x === WORLD_WIDTH - 1 ||
    region.coordinate.y === WORLD_HEIGHT - 1
  const dryLand = (predicate: (region: WorldRegion) => boolean): string[] =>
    regions
      .filter(
        (region) =>
          !claimed.has(region.id) && !riverPlan.regionIds.has(region.id) && predicate(region),
      )
      .map((region) => region.id)

  const place = (siteId: SiteId, candidates: readonly string[]): string => {
    const pool =
      candidates.length > 0
        ? candidates
        : regions.filter((region) => !claimed.has(region.id)).map((region) => region.id)
    const chosen = namedStream(seed, `sites:placement:${siteId}`).pick(pool)
    claimed.add(chosen)
    return chosen
  }

  // The shop goes upstream of the recovery point, so `road-branch-river-route` runs down
  // the river the way the river runs and never doubles back on itself.
  const shopIndex = namedStream(seed, 'sites:placement:site-shop-riverside').integer(
    0,
    river.regionPath.length - 1,
  )
  const shopRegionId = river.regionPath[shopIndex]
  claimed.add(shopRegionId)
  const recoveryCandidates = river.regionPath
    .slice(shopIndex + 1)
    .filter((regionIdValue) => !claimed.has(regionIdValue))
  const recoveryRegionId = place('site-recovery-riverside', recoveryCandidates)

  const optionalSites: ReadonlyArray<readonly [SiteId, WorldSite['kind'], string]> = [
    ['site-shop-riverside', 'shop', shopRegionId],
    ['site-recovery-riverside', 'recovery', recoveryRegionId],
    [
      'site-settlement-crossroads',
      'settlement',
      place(
        'site-settlement-crossroads',
        dryLand(
          (region) =>
            Math.abs(region.coordinate.x - Math.floor(WORLD_WIDTH / 2)) <= 1 &&
            Math.abs(region.coordinate.y - Math.floor(WORLD_HEIGHT / 2)) <= 1,
        ),
      ),
    ],
    ['site-event-frontier', 'event', place('site-event-frontier', dryLand(isBorder))],
    [
      'site-treasure-hidden',
      'treasure',
      place('site-treasure-hidden', dryLand(isFarFromAnchors)),
    ],
    [
      'site-landmark-old-road',
      'landmark',
      place('site-landmark-old-road', dryLand(() => true)),
    ],
  ]
  for (const [id, kind, regionIdValue] of optionalSites) {
    const region = requireRegion(regionById, regionIdValue)
    addSite({
      id,
      kind,
      regionId: region.id,
      owner: region.territory,
    })
  }

  return sites
}

function createCriticalPaths(
  seed: number,
  riverPlan: RiverPlan,
  starts: FactionRecord<SiteId>,
  finales: FactionRecord<SiteId>,
  siteById: ReadonlyMap<string, WorldSite>,
  regionById: ReadonlyMap<string, WorldRegion>,
): FactionRecord<CriticalPath> {
  const create = (faction: Faction): CriticalPath => {
    const start = requireSite(siteById, starts[faction])
    const finale = requireSite(siteById, finales[faction])
    const regionIds = transverseRegionPath(
      seed,
      `critical-path:${faction}`,
      requireRegion(regionById, start.regionId).coordinate,
      requireRegion(regionById, finale.regionId).coordinate,
      riverPlan,
    )
    return {
      faction,
      startSiteId: start.id,
      finaleSiteId: finale.id,
      regionIds,
      transitionCount: regionIds.length - 1,
    }
  }

  return {
    elf: create('elf'),
    guard: create('guard'),
    villain: create('villain'),
  }
}

function createRoadNetwork(
  seed: number,
  river: MacroRiver,
  riverPlan: RiverPlan,
  starts: FactionRecord<SiteId>,
  sites: readonly WorldSite[],
  siteById: ReadonlyMap<string, WorldSite>,
  criticalPaths: FactionRecord<CriticalPath>,
  regionById: ReadonlyMap<string, WorldRegion>,
  connectionByPair: ReadonlyMap<string, RegionConnection>,
): RoadNetwork {
  const roadConnections: RoadConnection[] = []
  const roadSegments: RoadSegment[] = []

  const addRoad = (
    id: string,
    kind: RoadConnectionKind,
    fromSiteId: string,
    toSiteId: string,
    regionPath: string[],
    faction?: Faction,
  ): void => {
    const segmentIds: string[] = []
    for (let index = 1; index < regionPath.length; index += 1) {
      const fromRegionId = regionPath[index - 1]
      const toRegionId = regionPath[index]
      const segmentId = `${id}-segment-${index - 1}`
      roadSegments.push({
        id: segmentId,
        roadConnectionId: id,
        connectionId: requireConnection(connectionByPair, fromRegionId, toRegionId).id,
        fromRegionId,
        toRegionId,
      })
      segmentIds.push(segmentId)
    }
    roadConnections.push({
      id,
      kind,
      fromSiteId,
      toSiteId,
      regionPath,
      segmentIds,
      ...(faction === undefined ? {} : { faction }),
    })
  }

  for (const faction of WORLD_FACTIONS) {
    const criticalPath = criticalPaths[faction]
    addRoad(
      `road-critical-${faction}`,
      'critical',
      criticalPath.startSiteId,
      criticalPath.finaleSiteId,
      [...criticalPath.regionIds],
      faction,
    )
  }

  const addBranchRoad = (id: string, fromSiteId: string, toSiteId: string): void => {
    const from = requireSite(siteById, fromSiteId)
    const to = requireSite(siteById, toSiteId)
    const fromCoordinate = requireRegion(regionById, from.regionId).coordinate
    const toCoordinate = requireRegion(regionById, to.regionId).coordinate
    addRoad(
      id,
      'branch',
      fromSiteId,
      toSiteId,
      branchRegionPath(seed, `roads:${id}`, fromCoordinate, toCoordinate, riverPlan),
    )
  }

  const shopSite = requireSite(siteById, 'site-shop-riverside')
  const recoverySite = requireSite(siteById, 'site-recovery-riverside')
  const shopIndex = river.regionPath.indexOf(shopSite.regionId)
  const recoveryIndex = river.regionPath.indexOf(recoverySite.regionId)
  if (shopIndex < 0 || recoveryIndex <= shopIndex) {
    throw new Error('Riverside sites must sit on the river, shop upstream of recovery')
  }

  addBranchRoad('road-connector-elf-guard', starts.elf, starts.guard)
  addBranchRoad('road-connector-guard-villain', starts.guard, starts.villain)
  addBranchRoad('road-branch-shop', starts.elf, 'site-shop-riverside')
  // The one road that runs *with* the water rather than across it, so it carries no
  // bridge — which the meander preserves, because one lateral step per row can never put
  // three river squares in a row for this path to straddle.
  addRoad(
    'road-branch-river-route',
    'branch',
    'site-shop-riverside',
    'site-recovery-riverside',
    river.regionPath.slice(shopIndex, recoveryIndex + 1),
  )
  addBranchRoad('road-branch-event', 'site-recovery-riverside', 'site-event-frontier')
  addBranchRoad('road-branch-treasure', 'site-event-frontier', 'site-treasure-hidden')
  addBranchRoad('road-branch-settlement', 'site-treasure-hidden', 'site-settlement-crossroads')
  addBranchRoad('road-branch-landmark', 'site-settlement-crossroads', 'site-landmark-old-road')

  const listedSiteIds = new Set(
    roadConnections.flatMap((road) => [road.fromSiteId, road.toSiteId]),
  )
  for (const site of sites) {
    if (!listedSiteIds.has(site.id)) {
      throw new Error(`Road construction omitted site ${site.id}`)
    }
  }

  return { connections: roadConnections, segments: roadSegments }
}

function createBridges(
  roads: RoadNetwork,
  river: MacroRiver,
  regionById: ReadonlyMap<string, WorldRegion>,
): BridgeCrossing[] {
  const bridges: BridgeCrossing[] = []
  const riverRegionIds = new Set(river.regionPath)
  for (const road of roads.connections) {
    for (let index = 1; index < road.regionPath.length - 1; index += 1) {
      const previousRegionId = road.regionPath[index - 1]
      const regionIdValue = road.regionPath[index]
      const nextRegionId = road.regionPath[index + 1]
      if (
        !isTransverseRiverCrossing(
          previousRegionId,
          regionIdValue,
          nextRegionId,
          riverRegionIds,
          regionById,
        )
      ) {
        continue
      }
      const firstSegmentId = road.segmentIds[index - 1]
      const secondSegmentId = road.segmentIds[index]
      if (!firstSegmentId || !secondSegmentId) {
        throw new Error(`Road ${road.id} has no segments for its river crossing`)
      }
      bridges.push({
        id: `bridge-${road.id}-${regionIdValue}`,
        regionId: regionIdValue,
        roadConnectionId: road.id,
        roadSegmentIds: [firstSegmentId, secondSegmentId],
        riverId: river.id,
      })
    }
  }
  return bridges
}

function createEncounters(
  seed: number,
  finales: FactionRecord<SiteId>,
  regions: readonly WorldRegion[],
  siteById: ReadonlyMap<string, WorldSite>,
): EncounterSlot[] {
  const encounters: EncounterSlot[] = []
  const regularKinds: readonly EncounterKind[] = ['patrol', 'ambush', 'elite']

  for (const region of regions) {
    const stream = namedStream(seed, `encounter:${region.id}`)
    const encounter: EncounterSlot = {
      id: `encounter-${region.id}`,
      regionId: region.id,
      kind: stream.pick(regularKinds),
      difficulty: stream.integer(1, 5),
      hostileTo:
        region.territory === 'neutral'
          ? [...WORLD_FACTIONS]
          : WORLD_FACTIONS.filter((faction) => faction !== region.territory),
    }
    encounters.push(encounter)
    region.encounterSlotIds.push(encounter.id)
  }

  for (const faction of WORLD_FACTIONS) {
    const site = requireSite(siteById, finales[faction])
    const encounter: EncounterSlot = {
      id: `encounter-boss-${faction}`,
      regionId: site.regionId,
      kind: 'boss',
      difficulty: 5,
      hostileTo: [faction],
      siteId: site.id,
    }
    encounters.push(encounter)
    const region = regions.find((candidate) => candidate.id === site.regionId)
    if (!region) throw new Error(`Boss encounter region ${site.regionId} does not exist`)
    region.encounterSlotIds.push(encounter.id)
  }

  return encounters
}

/**
 * Roadmap 1.4 — the campaign graph, as a diamond rather than a chain.
 *
 * What was here emitted three nodes on a linear chain and took exactly one seeded draw per
 * faction, which is where the roadmap's "3 factions × 2 middle sites = 6 distinct campaign
 * graphs across all 2³² seeds" comes from. What is here now is:
 *
 * ```
 *            ┌─ errand ──┐
 *   start ───┤           ├─── finale
 *            └─ contract ┘
 * ```
 *
 * **Both middle nodes are required.** That is deliberate and it is the whole shape of the
 * first slice: the persisted `Objective` has no optional concept and the win condition is
 * still `every(o => o.done)`, so what the fork buys the player is an **order**, not an
 * exclusive route. Exclusive routes are 2.1.
 *
 * The contract node names a signature template — one per faction, adapted from a shipped
 * event builder — and it draws its site from **its own derived stream**, so adding this
 * step cannot shift the errand draw that was here before. A given seed still gets exactly
 * the errand it always got; the contract is new numbers from new entropy.
 *
 * Graph count per faction goes from 2 to 6, and across the three factions from 6 to 18,
 * before the treasure site's own four placements are counted. That is a measured
 * improvement rather than a fix: 1.5 is where generator diversity is actually addressed.
 */
function createObjectives(
  seed: number,
  starts: FactionRecord<SiteId>,
  finales: FactionRecord<SiteId>,
  siteById: ReadonlyMap<string, WorldSite>,
): FactionRecord<FactionObjectiveGraph> {
  const choices: FactionRecord<readonly SiteId[]> = {
    elf: ['site-shop-riverside', 'site-event-frontier'],
    guard: ['site-recovery-riverside', 'site-settlement-crossroads'],
    villain: ['site-treasure-hidden', 'site-landmark-old-road'],
  }

  const create = (faction: Faction): FactionObjectiveGraph => {
    const start = requireSite(siteById, starts[faction])
    const middle = requireSite(
      siteById,
      namedStream(seed, `objectives:${faction}`).pick(choices[faction]),
    )
    const template = FACTION_CONTRACT_SITES[faction]
    const contractSite = requireSite(
      siteById,
      namedStream(seed, `objectives:contract:${faction}`).pick(template.siteIds),
    )
    const finale = requireSite(siteById, finales[faction])
    const startNodeId = `objective-${faction}-start`
    const middleNodeId = `objective-${faction}-branch`
    const contractNodeId = `objective-${faction}-contract`
    const finalNodeId = `objective-${faction}-finale`
    return {
      faction,
      // Topologically ordered, and `tests/campaignDirector.test.ts` asserts it stays that
      // way: with prerequisites listed before the nodes that need them, the first not-done
      // node always has its prerequisites satisfied, which is what the pre-1.4 `.find()`
      // depended on and what the new "all ready nodes" reader agrees with.
      nodes: [
        {
          id: startNodeId,
          kind: 'arrive',
          siteId: start.id,
          regionId: start.regionId,
          prerequisiteIds: [],
        },
        {
          id: middleNodeId,
          kind: middle.kind === 'treasure' ? 'claim' : 'interact',
          siteId: middle.id,
          regionId: middle.regionId,
          prerequisiteIds: [startNodeId],
        },
        {
          id: contractNodeId,
          kind: template.kind,
          siteId: contractSite.id,
          regionId: contractSite.regionId,
          prerequisiteIds: [startNodeId],
          contract: template.id,
        },
        {
          id: finalNodeId,
          kind: 'defeat',
          siteId: finale.id,
          regionId: finale.regionId,
          prerequisiteIds: [middleNodeId, contractNodeId],
        },
      ],
      rootNodeIds: [startNodeId],
      finalNodeId,
    }
  }

  return {
    elf: create('elf'),
    guard: create('guard'),
    villain: create('villain'),
  }
}

function createStartMap(): FactionRecord<SiteId> {
  return {
    elf: startSiteId('elf'),
    guard: startSiteId('guard'),
    villain: startSiteId('villain'),
  }
}

function createFinaleMap(): FactionRecord<SiteId> {
  return {
    elf: finaleSiteId('elf'),
    guard: finaleSiteId('guard'),
    villain: finaleSiteId('villain'),
  }
}

function monotonicCoordinatePath(
  seed: number,
  semanticKey: string,
  from: RegionCoordinate,
  to: RegionCoordinate,
): RegionCoordinate[] {
  const moves: Array<readonly [number, number]> = []
  const horizontalDirection = Math.sign(to.x - from.x)
  const verticalDirection = Math.sign(to.y - from.y)
  for (let index = 0; index < Math.abs(to.x - from.x); index += 1) {
    moves.push([horizontalDirection, 0])
  }
  for (let index = 0; index < Math.abs(to.y - from.y); index += 1) {
    moves.push([0, verticalDirection])
  }

  const shuffledMoves = namedStream(seed, semanticKey).shuffle(moves)
  const coordinate = { ...from }
  const path = [{ ...coordinate }]
  for (const [deltaX, deltaY] of shuffledMoves) {
    coordinate.x += deltaX
    coordinate.y += deltaY
    path.push({ ...coordinate })
  }
  return path
}

/** All moves on one axis, then all moves on the other. The two constructed orderings. */
function axisOrderedPath(
  from: RegionCoordinate,
  to: RegionCoordinate,
  first: 'vertical' | 'horizontal',
): RegionCoordinate[] {
  const path: RegionCoordinate[] = [{ ...from }]
  const stepTo = (x: number, y: number): void => {
    const current = path[path.length - 1]
    const deltaX = Math.sign(x - current.x)
    const deltaY = Math.sign(y - current.y)
    let cursor = { ...current }
    while (cursor.x !== x || cursor.y !== y) {
      cursor = {
        x: cursor.x + (cursor.x === x ? 0 : deltaX),
        y: cursor.y + (cursor.y === y ? 0 : deltaY),
      }
      path.push(cursor)
    }
  }
  if (first === 'vertical') {
    stepTo(from.x, to.y)
    stepTo(to.x, to.y)
  } else {
    stepTo(to.x, from.y)
    stepTo(to.x, to.y)
  }
  return path
}

/**
 * A monotonic path that never sets foot in the water.
 *
 * The shuffled orderings carry the variety, so they are tried first; the constructed
 * fallback exists because a shuffle *can* wander onto a meandering river and the generator
 * is not allowed to fail. Both fallbacks are river-free by construction for the endpoints
 * this is ever called with:
 *
 * - `vertical` first runs up the anchor's own column, and every anchor sits at x ∈ {0, 4}
 *   while every river square sits in `[1, WORLD_WIDTH - 2]`; the horizontal leg then runs
 *   along the ford row and stops one square short of its single river square.
 * - `horizontal` first runs away from that same single river square along the ford row,
 *   then up the far anchor's column.
 */
function bankPath(
  seed: number,
  semanticKey: string,
  from: RegionCoordinate,
  to: RegionCoordinate,
  riverPlan: RiverPlan,
  fallback: 'vertical' | 'horizontal',
): RegionCoordinate[] {
  for (let attempt = 0; attempt < ROAD_PATH_ATTEMPTS; attempt += 1) {
    const path = monotonicCoordinatePath(seed, `${semanticKey}:attempt-${attempt}`, from, to)
    if (path.every((step) => !riverPlan.regionIds.has(regionId(step.x, step.y)))) {
      return path
    }
  }
  return axisOrderedPath(from, to, fallback)
}

/**
 * Roadmap 1.5 — the campaign corridor, which still fords the river exactly once.
 *
 * The endpoints are `ENDPOINTS`, unchanged and unpermuted: this solver throws unless they
 * differ in x with a river square strictly between them, and permuting the anchors means
 * freeing the river's axis, which is roadmap 2.2 and explicitly not this milestone. What
 * moved is *where* the ford is: the crossing row is drawn from the rows where the river
 * runs straight, because a road that fords a turning square would have to leave along the
 * water's lateral leg, and no bridge spans that.
 */
function transverseRegionPath(
  seed: number,
  semanticKey: string,
  from: RegionCoordinate,
  to: RegionCoordinate,
  riverPlan: RiverPlan,
): string[] {
  const horizontalDirection = Math.sign(to.x - from.x)
  const eligibleRows = riverPlan.straightRows.filter((row) => {
    if (row < Math.min(from.y, to.y) || row > Math.max(from.y, to.y)) return false
    const column = riverPlan.columnsByRow[row][0]
    return column > Math.min(from.x, to.x) && column < Math.max(from.x, to.x)
  })
  if (horizontalDirection === 0 || eligibleRows.length === 0) {
    throw new Error('Critical path endpoints must lie on opposite sides of the river')
  }

  const crossingY = namedStream(seed, `${semanticKey}:crossing-row`).pick(eligibleRows)
  const riverColumn = riverPlan.columnsByRow[crossingY][0]
  const beforeRiver = { x: riverColumn - horizontalDirection, y: crossingY }
  const afterRiver = { x: riverColumn + horizontalDirection, y: crossingY }
  const approach = bankPath(
    seed,
    `${semanticKey}:approach`,
    from,
    beforeRiver,
    riverPlan,
    'vertical',
  )
  const departure = bankPath(
    seed,
    `${semanticKey}:departure`,
    afterRiver,
    to,
    riverPlan,
    'horizontal',
  )
  return [
    ...approach.map((step) => regionId(step.x, step.y)),
    regionId(riverColumn, crossingY),
    ...departure.map((step) => regionId(step.x, step.y)),
  ]
}

/**
 * A branch road between two sites, forbidden from fording the river where it turns.
 *
 * Branch roads run between squares the seed chose, so unlike the campaign corridor they
 * cannot be constructed around a ford in advance. Shuffled orderings are tried first and
 * almost always pass; the fallback takes the road to a straight row, crosses there, and
 * comes back — a deliberate detour rather than a monotonic path, which the blueprint
 * permits and which is the honest shape of a road that has to reach a bridge.
 */
function branchRegionPath(
  seed: number,
  semanticKey: string,
  from: RegionCoordinate,
  to: RegionCoordinate,
  riverPlan: RiverPlan,
): string[] {
  for (let attempt = 0; attempt < ROAD_PATH_ATTEMPTS; attempt += 1) {
    const path = monotonicCoordinatePath(seed, `${semanticKey}:attempt-${attempt}`, from, to)
    if (!fordsABend(path, riverPlan)) return path.map((step) => regionId(step.x, step.y))
  }
  return fordedDetourPath(from, to, riverPlan).map((step) => regionId(step.x, step.y))
}

function fordsABend(
  path: readonly RegionCoordinate[],
  riverPlan: RiverPlan,
): boolean {
  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = path[index - 1]
    const crossing = path[index]
    const next = path[index + 1]
    if (!riverPlan.bendRegionIds.has(regionId(crossing.x, crossing.y))) continue
    if (previous.y !== crossing.y || next.y !== crossing.y) continue
    if ((previous.x - crossing.x) * (next.x - crossing.x) < 0) return true
  }
  return false
}

function fordedDetourPath(
  from: RegionCoordinate,
  to: RegionCoordinate,
  riverPlan: RiverPlan,
): RegionCoordinate[] {
  // Vertical travel can never straddle anything, so a road that changes no column needs no
  // ford and no detour.
  if (from.x === to.x) return axisOrderedPath(from, to, 'vertical')

  const midpoint = (from.y + to.y) / 2
  const inRange = riverPlan.straightRows.filter(
    (row) => row >= Math.min(from.y, to.y) && row <= Math.max(from.y, to.y),
  )
  const rows = inRange.length > 0 ? inRange : riverPlan.straightRows
  const fordRow = rows.reduce((best, row) =>
    Math.abs(row - midpoint) < Math.abs(best - midpoint) ? row : best,
  )

  const path: RegionCoordinate[] = [{ ...from }]
  const stepTo = (x: number, y: number): void => {
    const start = path[path.length - 1]
    const deltaX = Math.sign(x - start.x)
    const deltaY = Math.sign(y - start.y)
    let cursor = { ...start }
    while (cursor.x !== x || cursor.y !== y) {
      cursor = {
        x: cursor.x + (cursor.x === x ? 0 : deltaX),
        y: cursor.y + (cursor.y === y ? 0 : deltaY),
      }
      path.push(cursor)
    }
  }
  stepTo(from.x, fordRow)
  stepTo(to.x, fordRow)
  stepTo(to.x, to.y)
  return path
}

function isTransverseRiverCrossing(
  previousRegionId: string,
  regionIdValue: string,
  nextRegionId: string,
  riverRegionIds: ReadonlySet<string>,
  regionById: ReadonlyMap<string, WorldRegion>,
): boolean {
  if (!riverRegionIds.has(regionIdValue)) return false
  const previous = requireRegion(regionById, previousRegionId).coordinate
  const crossing = requireRegion(regionById, regionIdValue).coordinate
  const next = requireRegion(regionById, nextRegionId).coordinate
  return (
    previous.y === crossing.y &&
    next.y === crossing.y &&
    (previous.x - crossing.x) * (next.x - crossing.x) < 0
  )
}

function territoryAt(seed: number, coordinate: RegionCoordinate): Territory {
  for (const faction of WORLD_FACTIONS) {
    if (sameCoordinate(coordinate, ENDPOINTS[faction].start)) return faction
    if (sameCoordinate(coordinate, ENDPOINTS[faction].finale)) {
      return FINALE_TERRITORIES[faction]
    }
  }
  if (
    coordinate.x === Math.floor(WORLD_WIDTH / 2) &&
    coordinate.y === Math.floor(WORLD_HEIGHT / 2)
  ) {
    return 'neutral'
  }

  const distances = WORLD_FACTIONS.map((faction, index) => ({
    faction,
    index,
    score:
      manhattanDistance(coordinate, TERRITORY_ANCHORS[faction]) * 4 +
      namedStream(
        seed,
        `territory:${coordinate.x},${coordinate.y}:${faction}`,
      ).integer(-3, 4),
  }))
  distances.sort((first, second) => first.score - second.score || first.index - second.index)
  return distances[1].score - distances[0].score <= 1 ? 'neutral' : distances[0].faction
}

function biomeForTerritory(territory: Territory): ZoneId {
  if (territory === 'elf') return 'forest'
  if (territory === 'guard') return 'palace'
  if (territory === 'villain') return 'fort'
  return 'neutral'
}

function namedStream(seed: number, semanticKey: string): RandomStream {
  return new RandomStream(deriveSeed(seed, semanticKey))
}

function requireRegionAt(
  regionByCoordinate: ReadonlyMap<string, WorldRegion>,
  coordinate: RegionCoordinate,
): WorldRegion {
  const region = regionByCoordinate.get(coordinateKey(coordinate))
  if (!region) throw new Error(`Region at ${coordinate.x},${coordinate.y} does not exist`)
  return region
}

function requireRegionAtId(
  regionById: ReadonlyMap<string, WorldRegion>,
  coordinate: RegionCoordinate,
): WorldRegion {
  return requireRegion(regionById, regionId(coordinate.x, coordinate.y))
}

function requireRegion(
  regionById: ReadonlyMap<string, WorldRegion>,
  regionIdValue: string,
): WorldRegion {
  const region = regionById.get(regionIdValue)
  if (!region) throw new Error(`Region ${regionIdValue} does not exist`)
  return region
}

function requireSite(siteById: ReadonlyMap<string, WorldSite>, siteId: string): WorldSite {
  const site = siteById.get(siteId)
  if (!site) throw new Error(`Site ${siteId} does not exist`)
  return site
}

function requireConnection(
  connectionByPair: ReadonlyMap<string, RegionConnection>,
  firstRegionId: string,
  secondRegionId: string,
): RegionConnection {
  const connection = connectionByPair.get(unorderedPair(firstRegionId, secondRegionId))
  if (!connection) {
    throw new Error(`Connection ${firstRegionId} to ${secondRegionId} does not exist`)
  }
  return connection
}

function regionId(x: number, y: number): string {
  return `region-${x}-${y}`
}

function startSiteId(faction: Faction): string {
  return `site-start-${faction}`
}

function finaleSiteId(faction: Faction): string {
  return `site-finale-${faction}`
}

function coordinateKey(coordinate: RegionCoordinate): string {
  return `${coordinate.x},${coordinate.y}`
}

function unorderedPair(first: string, second: string): string {
  return first < second ? `${first}\u0000${second}` : `${second}\u0000${first}`
}

function oppositeDirection(direction: CardinalDirection): CardinalDirection {
  if (direction === 'north') return 'south'
  if (direction === 'east') return 'west'
  if (direction === 'south') return 'north'
  return 'east'
}

function manhattanDistance(first: RegionCoordinate, second: RegionCoordinate): number {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y)
}

function sameCoordinate(first: RegionCoordinate, second: RegionCoordinate): boolean {
  return first.x === second.x && first.y === second.y
}
