import { RandomStream } from '../random/RandomStream.ts'
import { deriveSeed, parseSeed, type SeedInput } from '../random/seed.ts'
import type { Faction, ZoneId } from '../types.ts'
import {
  DEFAULT_REGION_SIZE,
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
  const sites = createSites(seed, river, regionById)
  const siteById = new Map(sites.map((site) => [site.id, site]))
  const starts = createStartMap()
  const finales = createFinaleMap()
  const criticalPaths = createCriticalPaths(
    seed,
    river,
    starts,
    finales,
    siteById,
    regionById,
  )
  const roads = createRoadNetwork(
    seed,
    river,
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

function createRiver(
  seed: number,
  regionByCoordinate: ReadonlyMap<string, WorldRegion>,
  connectionByPair: ReadonlyMap<string, RegionConnection>,
): MacroRiver {
  const stream = namedStream(seed, 'river:macro-path')
  const column = stream.integer(1, WORLD_WIDTH - 1)
  const regionPath: string[] = []
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
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

function createSites(
  seed: number,
  river: MacroRiver,
  regionById: ReadonlyMap<string, WorldRegion>,
): WorldSite[] {
  const sites: WorldSite[] = []
  const addSite = (site: WorldSite): void => {
    sites.push(site)
    requireRegion(regionById, site.regionId).siteIds.push(site.id)
  }

  for (const faction of WORLD_FACTIONS) {
    const startRegion = requireRegionAtId(regionById, ENDPOINTS[faction].start)
    const finaleRegion = requireRegionAtId(regionById, ENDPOINTS[faction].finale)
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

  const siteStream = namedStream(seed, 'sites:optional-placement')
  const treasureCandidates = [
    regionId(3, 4),
    regionId(4, 4),
    regionId(3, 3),
    regionId(1, 3),
  ] as const
  const optionalSites: ReadonlyArray<readonly [SiteId, WorldSite['kind'], string]> = [
    ['site-settlement-crossroads', 'settlement', regionId(2, 2)],
    ['site-shop-riverside', 'shop', river.regionPath[0]],
    ['site-recovery-riverside', 'recovery', river.regionPath.at(-1) ?? river.regionPath[0]],
    ['site-event-frontier', 'event', regionId(4, 4)],
    ['site-treasure-hidden', 'treasure', siteStream.pick(treasureCandidates)],
    ['site-landmark-old-road', 'landmark', regionId(2, 3)],
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
  river: MacroRiver,
  starts: FactionRecord<SiteId>,
  finales: FactionRecord<SiteId>,
  siteById: ReadonlyMap<string, WorldSite>,
  regionById: ReadonlyMap<string, WorldRegion>,
): FactionRecord<CriticalPath> {
  const riverRegion = requireRegion(regionById, river.regionPath[0])
  const create = (faction: Faction): CriticalPath => {
    const start = requireSite(siteById, starts[faction])
    const finale = requireSite(siteById, finales[faction])
    const regionIds = transverseRegionPath(
      seed,
      `critical-path:${faction}`,
      requireRegion(regionById, start.regionId).coordinate,
      requireRegion(regionById, finale.regionId).coordinate,
      riverRegion.coordinate.x,
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
      monotonicRegionPath(seed, `roads:${id}`, fromCoordinate, toCoordinate),
    )
  }

  addBranchRoad('road-connector-elf-guard', starts.elf, starts.guard)
  addBranchRoad('road-connector-guard-villain', starts.guard, starts.villain)
  addBranchRoad('road-branch-shop', starts.elf, 'site-shop-riverside')
  addRoad(
    'road-branch-river-route',
    'branch',
    'site-shop-riverside',
    'site-recovery-riverside',
    [...river.regionPath],
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
    const finale = requireSite(siteById, finales[faction])
    const startNodeId = `objective-${faction}-start`
    const middleNodeId = `objective-${faction}-branch`
    const finalNodeId = `objective-${faction}-finale`
    return {
      faction,
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
          id: finalNodeId,
          kind: 'defeat',
          siteId: finale.id,
          regionId: finale.regionId,
          prerequisiteIds: [middleNodeId],
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

function monotonicRegionPath(
  seed: number,
  semanticKey: string,
  from: RegionCoordinate,
  to: RegionCoordinate,
): string[] {
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
  const path = [regionId(coordinate.x, coordinate.y)]
  for (const [deltaX, deltaY] of shuffledMoves) {
    coordinate.x += deltaX
    coordinate.y += deltaY
    path.push(regionId(coordinate.x, coordinate.y))
  }
  return path
}

function transverseRegionPath(
  seed: number,
  semanticKey: string,
  from: RegionCoordinate,
  to: RegionCoordinate,
  riverColumn: number,
): string[] {
  const horizontalDirection = Math.sign(to.x - from.x)
  if (
    horizontalDirection === 0 ||
    riverColumn <= Math.min(from.x, to.x) ||
    riverColumn >= Math.max(from.x, to.x)
  ) {
    throw new Error('Critical path endpoints must lie on opposite sides of the river')
  }

  const crossingY = namedStream(seed, `${semanticKey}:crossing-row`).integer(
    Math.min(from.y, to.y),
    Math.max(from.y, to.y) + 1,
  )
  const beforeRiver = {
    x: riverColumn - horizontalDirection,
    y: crossingY,
  }
  const afterRiver = {
    x: riverColumn + horizontalDirection,
    y: crossingY,
  }
  const approach = monotonicRegionPath(
    seed,
    `${semanticKey}:approach`,
    from,
    beforeRiver,
  )
  const departure = monotonicRegionPath(
    seed,
    `${semanticKey}:departure`,
    afterRiver,
    to,
  )
  return [
    ...approach,
    regionId(riverColumn, crossingY),
    regionId(afterRiver.x, afterRiver.y),
    ...departure.slice(1),
  ]
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
