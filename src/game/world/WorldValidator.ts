import { hashString32 } from '../random/seed.ts'
import type { Faction, ZoneId } from '../types.ts'
import {
  DEFAULT_REGION_SIZE,
  WORLD_BIOMES,
  WORLD_FACTIONS,
  WORLD_GENERATOR_VERSION,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type CardinalDirection,
  type EncounterSlot,
  type FactionObjectiveGraph,
  type FactionObjectiveNode,
  type RegionConnection,
  type RoadConnection,
  type SiteKind,
  type Territory,
  type WorldBlueprint,
  type WorldRegion,
  type WorldSite,
} from './worldTypes.ts'

export interface WorldValidationIssue {
  code: string
  path: string
  message: string
  severity: 'error'
}

export interface WorldValidationResult {
  valid: boolean
  issues: WorldValidationIssue[]
}

interface ValidationContext {
  issues: WorldValidationIssue[]
  add: (code: string, path: string, message: string) => void
}

interface ExpectedBridgeCrossing {
  roadConnectionId: string
  regionId: string
  roadSegmentIds: readonly [string, string]
}

const DIRECTION_DELTAS: Record<CardinalDirection, readonly [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
}

const OPPOSITE_DIRECTION: Record<CardinalDirection, CardinalDirection> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
}

const SITE_KINDS: readonly SiteKind[] = [
  'faction-start',
  'final-stronghold',
  'settlement',
  'shop',
  'recovery',
  'event',
  'treasure',
  'landmark',
]

const OPTIONAL_SITE_KINDS: readonly SiteKind[] = ['shop', 'recovery', 'event', 'treasure']

export function canonicalizeWorldBlueprint(blueprint: WorldBlueprint): string {
  const withoutFingerprint: Record<string, unknown> = {}
  const source = blueprint as unknown as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (key !== 'fingerprint') withoutFingerprint[key] = source[key]
  }
  return canonicalSerialize(withoutFingerprint, new WeakSet<object>())
}

export function computeWorldFingerprint(blueprint: WorldBlueprint): string {
  const canonical = canonicalizeWorldBlueprint(blueprint)
  const first = hashString32(canonical)
  const second = hashString32(`korovan-world-v1:${canonical}`)
  return `wg1-${toHex32(first)}${toHex32(second)}`
}

export function validateWorldBlueprint(blueprint: WorldBlueprint): WorldValidationResult {
  const issues: WorldValidationIssue[] = []
  const context: ValidationContext = {
    issues,
    add: (code, path, message) => {
      issues.push({ code, path, message, severity: 'error' })
    },
  }

  validateHeader(blueprint, context)

  const regions = Array.isArray(blueprint.regions) ? blueprint.regions : []
  const connections = Array.isArray(blueprint.connections) ? blueprint.connections : []
  const sites = Array.isArray(blueprint.sites) ? blueprint.sites : []
  const encounters = Array.isArray(blueprint.encounters) ? blueprint.encounters : []

  if (!Array.isArray(blueprint.regions)) {
    context.add('regions.type', 'regions', 'Regions must be an array')
  }
  if (!Array.isArray(blueprint.connections)) {
    context.add('connections.type', 'connections', 'Connections must be an array')
  }
  if (!Array.isArray(blueprint.sites)) {
    context.add('sites.type', 'sites', 'Sites must be an array')
  }
  if (!Array.isArray(blueprint.encounters)) {
    context.add('encounters.type', 'encounters', 'Encounters must be an array')
  }

  const regionById = indexById(regions, 'regions', context)
  const connectionById = indexById(connections, 'connections', context)
  const siteById = indexById(sites, 'sites', context)
  const encounterById = indexById(encounters, 'encounters', context)

  validateRegions(regions, regionById, context)
  const regionAdjacency = validateConnections(
    regions,
    connections,
    regionById,
    connectionById,
    context,
  )
  validateRegionReachability(regions, regionAdjacency, context)
  validateSites(blueprint, regions, sites, regionById, siteById, context)
  validateCriticalPaths(blueprint, regionById, siteById, connectionById, context)
  validateRoads(blueprint, sites, regionById, connectionById, siteById, context)
  validateRiverAndBridges(blueprint, regionById, connectionById, context)
  validateEncounters(
    blueprint,
    regions,
    encounters,
    regionById,
    siteById,
    encounterById,
    context,
  )
  validateObjectives(blueprint, siteById, regionById, regionAdjacency, context)
  validateFingerprint(blueprint, context)

  return { valid: issues.length === 0, issues }
}

export const validateWorld = validateWorldBlueprint

export class WorldValidator {
  static validate(blueprint: WorldBlueprint): WorldValidationResult {
    return validateWorldBlueprint(blueprint)
  }

  validate(blueprint: WorldBlueprint): WorldValidationResult {
    return validateWorldBlueprint(blueprint)
  }
}

function validateHeader(blueprint: WorldBlueprint, context: ValidationContext): void {
  if (blueprint.generatorVersion !== WORLD_GENERATOR_VERSION) {
    context.add(
      'version.unsupported',
      'generatorVersion',
      `Generator version must be ${WORLD_GENERATOR_VERSION}`,
    )
  }
  if (!isUint32(blueprint.seed) || blueprint.seed === 0) {
    context.add('seed.invalid', 'seed', 'Seed must be a nonzero uint32')
  }
  if (
    blueprint.dimensions?.width !== WORLD_WIDTH ||
    blueprint.dimensions?.height !== WORLD_HEIGHT
  ) {
    context.add(
      'dimensions.invalid',
      'dimensions',
      `World dimensions must be ${WORLD_WIDTH}x${WORLD_HEIGHT}`,
    )
  }
  if (blueprint.regionSize !== DEFAULT_REGION_SIZE) {
    context.add(
      'regionSize.invalid',
      'regionSize',
      `Region size must be ${DEFAULT_REGION_SIZE}`,
    )
  }
  const halfWidth = (WORLD_WIDTH * DEFAULT_REGION_SIZE) / 2
  const halfHeight = (WORLD_HEIGHT * DEFAULT_REGION_SIZE) / 2
  if (blueprint.origin?.x !== -halfWidth || blueprint.origin?.z !== -halfHeight) {
    context.add(
      'origin.invalid',
      'origin',
      'World origin must center the generated region grid around zero',
    )
  }
  if (
    blueprint.bounds?.minX !== -halfWidth ||
    blueprint.bounds?.maxX !== halfWidth ||
    blueprint.bounds?.minZ !== -halfHeight ||
    blueprint.bounds?.maxZ !== halfHeight
  ) {
    context.add(
      'bounds.invalid',
      'bounds',
      'World bounds must match the centered generated region grid',
    )
  }
}

function validateRegions(
  regions: readonly WorldRegion[],
  regionById: ReadonlyMap<string, WorldRegion>,
  context: ValidationContext,
): void {
  if (regions.length < 17 || regions.length > WORLD_WIDTH * WORLD_HEIGHT) {
    context.add(
      'regions.count',
      'regions',
      `World must contain between 17 and ${WORLD_WIDTH * WORLD_HEIGHT} regions`,
    )
  }

  const coordinates = new Set<string>()
  const biomes = new Set<ZoneId>()
  const territories = new Set<Territory>()

  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index]
    const path = `regions[${index}]`
    const { x, y } = region.coordinate ?? {}
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x < 0 ||
      x >= WORLD_WIDTH ||
      y < 0 ||
      y >= WORLD_HEIGHT
    ) {
      context.add('region.coordinate', `${path}.coordinate`, 'Region coordinate is out of bounds')
    } else {
      const coordinateKey = `${x},${y}`
      if (coordinates.has(coordinateKey)) {
        context.add(
          'region.coordinateDuplicate',
          `${path}.coordinate`,
          `Coordinate ${coordinateKey} is used more than once`,
        )
      }
      coordinates.add(coordinateKey)
    }

    if (!isBiome(region.biome)) {
      context.add('region.biome', `${path}.biome`, 'Region biome is not a ZoneId archetype')
    } else {
      biomes.add(region.biome)
    }
    if (!isTerritory(region.territory)) {
      context.add('region.territory', `${path}.territory`, 'Region territory is invalid')
    } else {
      territories.add(region.territory)
    }

    validateHeightProfile(region, path, context)
    validateRegionEdges(region, regionById, path, context)

    if (!Array.isArray(region.siteIds)) {
      context.add('region.siteIds', `${path}.siteIds`, 'Region site ids must be an array')
    } else if (new Set(region.siteIds).size !== region.siteIds.length) {
      context.add('region.siteIdsDuplicate', `${path}.siteIds`, 'Region site ids must be unique')
    }
    if (!Array.isArray(region.encounterSlotIds)) {
      context.add(
        'region.encounterSlotIds',
        `${path}.encounterSlotIds`,
        'Region encounter slot ids must be an array',
      )
    } else if (new Set(region.encounterSlotIds).size !== region.encounterSlotIds.length) {
      context.add(
        'region.encounterSlotIdsDuplicate',
        `${path}.encounterSlotIds`,
        'Region encounter slot ids must be unique',
      )
    }
  }

  for (const biome of WORLD_BIOMES) {
    if (!biomes.has(biome)) {
      context.add('biomes.missing', 'regions', `World is missing biome ${biome}`)
    }
  }
  for (const territory of ['neutral', ...WORLD_FACTIONS] as const) {
    if (!territories.has(territory)) {
      context.add('territories.missing', 'regions', `World is missing territory ${territory}`)
    }
  }
}

function validateHeightProfile(
  region: WorldRegion,
  regionPath: string,
  context: ValidationContext,
): void {
  const profile = region.heightProfile
  if (!profile) {
    context.add(
      'region.heightProfile',
      `${regionPath}.heightProfile`,
      'Region height profile is required',
    )
    return
  }

  const integerFields: ReadonlyArray<readonly [string, number]> = [
    ['baseHeight', profile.baseHeight],
    ['relief', profile.relief],
    ['roughnessPermille', profile.roughnessPermille],
    ['featureScale', profile.featureScale],
    ['detailScale', profile.detailScale],
  ]
  for (const [name, value] of integerFields) {
    if (!Number.isSafeInteger(value)) {
      context.add(
        'region.heightProfileInteger',
        `${regionPath}.heightProfile.${name}`,
        `${name} must be an integer`,
      )
    }
  }
  if (profile.relief < 0) {
    context.add(
      'region.heightProfileRelief',
      `${regionPath}.heightProfile.relief`,
      'Relief cannot be negative',
    )
  }
  if (profile.roughnessPermille < 0 || profile.roughnessPermille > 1000) {
    context.add(
      'region.heightProfileRoughness',
      `${regionPath}.heightProfile.roughnessPermille`,
      'Roughness must be between 0 and 1000',
    )
  }
  if (profile.featureScale <= 0 || profile.detailScale <= 0) {
    context.add(
      'region.heightProfileScale',
      `${regionPath}.heightProfile`,
      'Height sampling scales must be positive',
    )
  }
}

function validateRegionEdges(
  region: WorldRegion,
  regionById: ReadonlyMap<string, WorldRegion>,
  path: string,
  context: ValidationContext,
): void {
  if (!Array.isArray(region.edges)) {
    context.add('region.edges', `${path}.edges`, 'Region edges must be an array')
    return
  }

  const directions = new Set<CardinalDirection>()
  const connectionIds = new Set<string>()
  for (let edgeIndex = 0; edgeIndex < region.edges.length; edgeIndex += 1) {
    const edge = region.edges[edgeIndex]
    const edgePath = `${path}.edges[${edgeIndex}]`
    if (!isDirection(edge.direction)) {
      context.add('edge.direction', `${edgePath}.direction`, 'Edge direction is invalid')
    } else if (directions.has(edge.direction)) {
      context.add(
        'edge.directionDuplicate',
        `${edgePath}.direction`,
        `Region has multiple ${edge.direction} edges`,
      )
    } else {
      directions.add(edge.direction)
    }
    if (!isNonemptyId(edge.toRegionId) || !regionById.has(edge.toRegionId)) {
      context.add('edge.regionReference', `${edgePath}.toRegionId`, 'Edge region does not exist')
    }
    if (!isNonemptyId(edge.connectionId)) {
      context.add('edge.connectionId', `${edgePath}.connectionId`, 'Edge connection id is invalid')
    } else if (connectionIds.has(edge.connectionId)) {
      context.add(
        'edge.connectionDuplicate',
        `${edgePath}.connectionId`,
        'Region lists a connection more than once',
      )
    } else {
      connectionIds.add(edge.connectionId)
    }
  }
}

function validateConnections(
  regions: readonly WorldRegion[],
  connections: readonly RegionConnection[],
  regionById: ReadonlyMap<string, WorldRegion>,
  connectionById: ReadonlyMap<string, RegionConnection>,
  context: ValidationContext,
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>()
  for (const region of regions) adjacency.set(region.id, new Set<string>())
  const pairs = new Set<string>()

  for (let index = 0; index < connections.length; index += 1) {
    const connection = connections[index]
    const path = `connections[${index}]`
    const from = regionById.get(connection.fromRegionId)
    const to = regionById.get(connection.toRegionId)

    if (!from) {
      context.add(
        'connection.fromReference',
        `${path}.fromRegionId`,
        'Connection source region does not exist',
      )
    }
    if (!to) {
      context.add(
        'connection.toReference',
        `${path}.toRegionId`,
        'Connection destination region does not exist',
      )
    }
    if (connection.fromRegionId === connection.toRegionId) {
      context.add('connection.self', path, 'Connection cannot link a region to itself')
    }
    if (!isDirection(connection.direction)) {
      context.add('connection.direction', `${path}.direction`, 'Connection direction is invalid')
    }

    if (from && to && isDirection(connection.direction)) {
      const [deltaX, deltaY] = DIRECTION_DELTAS[connection.direction]
      if (
        to.coordinate.x !== from.coordinate.x + deltaX ||
        to.coordinate.y !== from.coordinate.y + deltaY
      ) {
        context.add(
          'connection.cardinality',
          path,
          'Connection direction does not match adjacent coordinates',
        )
      }

      const pair = unorderedPair(connection.fromRegionId, connection.toRegionId)
      if (pairs.has(pair)) {
        context.add('connection.duplicatePair', path, 'Regions are connected more than once')
      }
      pairs.add(pair)
      adjacency.get(from.id)?.add(to.id)
      adjacency.get(to.id)?.add(from.id)

      const forwardEdge = from.edges?.find(
        (edge) =>
          edge.connectionId === connection.id &&
          edge.toRegionId === to.id &&
          edge.direction === connection.direction,
      )
      const reverseDirection = OPPOSITE_DIRECTION[connection.direction]
      const reverseEdge = to.edges?.find(
        (edge) =>
          edge.connectionId === connection.id &&
          edge.toRegionId === from.id &&
          edge.direction === reverseDirection,
      )
      if (!forwardEdge) {
        context.add(
          'connection.forwardEdge',
          path,
          'Connection is missing its source region edge',
        )
      }
      if (!reverseEdge) {
        context.add(
          'connection.reverseEdge',
          path,
          'Connection is missing its symmetric destination edge',
        )
      }
    }
  }

  for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
    const region = regions[regionIndex]
    if (!Array.isArray(region.edges)) continue
    for (let edgeIndex = 0; edgeIndex < region.edges.length; edgeIndex += 1) {
      const edge = region.edges[edgeIndex]
      const path = `regions[${regionIndex}].edges[${edgeIndex}]`
      const connection = connectionById.get(edge.connectionId)
      if (!connection) {
        context.add(
          'edge.connectionReference',
          `${path}.connectionId`,
          'Edge connection does not exist',
        )
        continue
      }
      if (!isDirection(edge.direction)) continue

      const isForward =
        connection.fromRegionId === region.id && connection.toRegionId === edge.toRegionId
      const isReverse =
        connection.toRegionId === region.id && connection.fromRegionId === edge.toRegionId
      const expectedDirection = isForward
        ? connection.direction
        : isReverse && isDirection(connection.direction)
          ? OPPOSITE_DIRECTION[connection.direction]
          : null
      if (!expectedDirection || edge.direction !== expectedDirection) {
        context.add(
          'edge.connectionMismatch',
          path,
          'Edge does not match the referenced connection',
        )
      }
    }
  }

  return adjacency
}

function validateRegionReachability(
  regions: readonly WorldRegion[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  context: ValidationContext,
): void {
  if (regions.length === 0) return
  const reached = reachableFrom(regions[0].id, adjacency)
  for (const region of regions) {
    if (!reached.has(region.id)) {
      context.add(
        'regions.unreachable',
        `regions.${region.id}`,
        `Region ${region.id} is not reachable from the world graph`,
      )
    }
  }
}

function validateSites(
  blueprint: WorldBlueprint,
  regions: readonly WorldRegion[],
  sites: readonly WorldSite[],
  regionById: ReadonlyMap<string, WorldRegion>,
  siteById: ReadonlyMap<string, WorldSite>,
  context: ValidationContext,
): void {
  const siteListings = new Map<string, number>()
  const kindCounts = new Map<SiteKind, number>()

  for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
    const region = regions[regionIndex]
    if (!Array.isArray(region.siteIds)) continue
    for (let siteIndex = 0; siteIndex < region.siteIds.length; siteIndex += 1) {
      const siteId = region.siteIds[siteIndex]
      const site = siteById.get(siteId)
      siteListings.set(siteId, (siteListings.get(siteId) ?? 0) + 1)
      if (!site) {
        context.add(
          'region.siteReference',
          `regions[${regionIndex}].siteIds[${siteIndex}]`,
          'Region references a site that does not exist',
        )
      } else if (site.regionId !== region.id) {
        context.add(
          'region.siteMismatch',
          `regions[${regionIndex}].siteIds[${siteIndex}]`,
          'Region lists a site assigned to another region',
        )
      }
    }
  }

  for (let index = 0; index < sites.length; index += 1) {
    const site = sites[index]
    const path = `sites[${index}]`
    if (!SITE_KINDS.includes(site.kind)) {
      context.add('site.kind', `${path}.kind`, 'Site kind is invalid')
    } else {
      kindCounts.set(site.kind, (kindCounts.get(site.kind) ?? 0) + 1)
    }
    const region = regionById.get(site.regionId)
    if (!region) {
      context.add('site.regionReference', `${path}.regionId`, 'Site region does not exist')
    } else if (isTerritory(site.owner) && site.owner !== region.territory) {
      context.add(
        'site.ownerMismatch',
        `${path}.owner`,
        'Site owner must match its region territory',
      )
    }
    if (!isTerritory(site.owner)) {
      context.add('site.owner', `${path}.owner`, 'Site owner is invalid')
    }
    if (site.campaignFaction !== undefined && !isFaction(site.campaignFaction)) {
      context.add(
        'site.campaignFaction',
        `${path}.campaignFaction`,
        'Site campaign faction is invalid',
      )
    }
    if ((siteListings.get(site.id) ?? 0) !== 1) {
      context.add(
        'site.regionListing',
        path,
        'Every site must be listed exactly once by its assigned region',
      )
    }
  }

  for (const requiredKind of OPTIONAL_SITE_KINDS) {
    if ((kindCounts.get(requiredKind) ?? 0) < 1) {
      context.add('site.requiredKind', 'sites', `World requires at least one ${requiredKind} site`)
    }
  }

  const mappedStarts = new Set<string>()
  const mappedFinales = new Set<string>()
  for (const faction of WORLD_FACTIONS) {
    const startId = blueprint.starts?.[faction]
    const finaleId = blueprint.finales?.[faction]
    validateFactionSite(
      faction,
      startId,
      'faction-start',
      siteById,
      `starts.${faction}`,
      context,
    )
    validateFactionSite(
      faction,
      finaleId,
      'final-stronghold',
      siteById,
      `finales.${faction}`,
      context,
    )
    if (typeof startId === 'string') mappedStarts.add(startId)
    if (typeof finaleId === 'string') mappedFinales.add(finaleId)

    const starts = sites.filter(
      (site) => site.kind === 'faction-start' && site.campaignFaction === faction,
    )
    if (starts.length !== 1) {
      context.add(
        'site.startCount',
        `starts.${faction}`,
        `Faction ${faction} must have exactly one start site`,
      )
    }
    const finales = sites.filter(
      (site) => site.kind === 'final-stronghold' && site.campaignFaction === faction,
    )
    if (finales.length !== 1) {
      context.add(
        'site.finaleCount',
        `finales.${faction}`,
        `Faction ${faction} must have exactly one finale site`,
      )
    }

    const start = siteById.get(startId)
    if (start && start.owner !== faction) {
      context.add(
        'site.startOwner',
        `starts.${faction}`,
        'Faction start must be owned by its campaign faction',
      )
    }
    const startRegion = start && regionById.get(start.regionId)
    if (startRegion && startRegion.territory !== faction) {
      context.add(
        'site.startTerritory',
        `starts.${faction}`,
        'Faction start must be in territory owned by its campaign faction',
      )
    }
    const finale = siteById.get(finaleId)
    if (finale && (finale.owner === 'neutral' || finale.owner === faction)) {
      context.add(
        'site.finaleHostility',
        `finales.${faction}`,
        'Faction finale must be owned by a hostile faction',
      )
    }
    const finaleRegion = finale && regionById.get(finale.regionId)
    if (
      finaleRegion &&
      (finaleRegion.territory === 'neutral' || finaleRegion.territory === faction)
    ) {
      context.add(
        'site.finaleTerritory',
        `finales.${faction}`,
        'Faction finale must be in hostile non-neutral territory',
      )
    }
  }

  if (mappedStarts.size !== WORLD_FACTIONS.length) {
    context.add('site.startMappingUnique', 'starts', 'Faction start mappings must be unique')
  }
  if (mappedFinales.size !== WORLD_FACTIONS.length) {
    context.add('site.finaleMappingUnique', 'finales', 'Faction finale mappings must be unique')
  }
}

function validateFactionSite(
  faction: Faction,
  siteId: string,
  expectedKind: SiteKind,
  siteById: ReadonlyMap<string, WorldSite>,
  path: string,
  context: ValidationContext,
): void {
  const site = siteById.get(siteId)
  if (!site) {
    context.add('site.mappingReference', path, `Mapped site ${siteId} does not exist`)
    return
  }
  if (site.kind !== expectedKind) {
    context.add('site.mappingKind', path, `Mapped site must have kind ${expectedKind}`)
  }
  if (site.campaignFaction !== faction) {
    context.add('site.mappingFaction', path, 'Mapped site belongs to another campaign faction')
  }
}

function validateCriticalPaths(
  blueprint: WorldBlueprint,
  regionById: ReadonlyMap<string, WorldRegion>,
  siteById: ReadonlyMap<string, WorldSite>,
  connectionById: ReadonlyMap<string, RegionConnection>,
  context: ValidationContext,
): void {
  const transitionCounts = new Set<number>()
  const connectedPairs = connectionPairSet(connectionById.values())

  for (const faction of WORLD_FACTIONS) {
    const criticalPath = blueprint.criticalPaths?.[faction]
    const path = `criticalPaths.${faction}`
    if (!criticalPath) {
      context.add('criticalPath.missing', path, `Faction ${faction} is missing a critical path`)
      continue
    }
    if (criticalPath.faction !== faction) {
      context.add('criticalPath.faction', `${path}.faction`, 'Critical path faction is incorrect')
    }
    if (
      criticalPath.startSiteId !== blueprint.starts?.[faction] ||
      criticalPath.finaleSiteId !== blueprint.finales?.[faction]
    ) {
      context.add(
        'criticalPath.endpoints',
        path,
        'Critical path site endpoints do not match faction mappings',
      )
    }
    if (!Array.isArray(criticalPath.regionIds) || criticalPath.regionIds.length < 2) {
      context.add(
        'criticalPath.regions',
        `${path}.regionIds`,
        'Critical path must contain at least two regions',
      )
      continue
    }

    const actualTransitions = criticalPath.regionIds.length - 1
    if (
      criticalPath.transitionCount !== actualTransitions ||
      actualTransitions < 6 ||
      actualTransitions > 8
    ) {
      context.add(
        'criticalPath.length',
        path,
        'Critical path must specify and contain 6 to 8 region transitions',
      )
    }
    transitionCounts.add(actualTransitions)

    if (new Set(criticalPath.regionIds).size !== criticalPath.regionIds.length) {
      context.add('criticalPath.revisit', `${path}.regionIds`, 'Critical path cannot revisit a region')
    }
    for (let index = 0; index < criticalPath.regionIds.length; index += 1) {
      const regionId = criticalPath.regionIds[index]
      if (!regionById.has(regionId)) {
        context.add(
          'criticalPath.regionReference',
          `${path}.regionIds[${index}]`,
          'Critical path region does not exist',
        )
      }
      if (
        index > 0 &&
        !connectedPairs.has(unorderedPair(criticalPath.regionIds[index - 1], regionId))
      ) {
        context.add(
          'criticalPath.connection',
          `${path}.regionIds[${index}]`,
          'Consecutive critical path regions are not connected',
        )
      }
    }

    const start = siteById.get(criticalPath.startSiteId)
    const finale = siteById.get(criticalPath.finaleSiteId)
    if (start && criticalPath.regionIds[0] !== start.regionId) {
      context.add('criticalPath.startRegion', path, 'Critical path does not begin at its start site')
    }
    if (finale && criticalPath.regionIds.at(-1) !== finale.regionId) {
      context.add('criticalPath.finaleRegion', path, 'Critical path does not end at its finale site')
    }
  }

  if (transitionCounts.size > 1) {
    context.add(
      'criticalPath.equivalence',
      'criticalPaths',
      'All factions must have equivalent critical path lengths',
    )
  }
}

function validateRoads(
  blueprint: WorldBlueprint,
  sites: readonly WorldSite[],
  regionById: ReadonlyMap<string, WorldRegion>,
  connectionById: ReadonlyMap<string, RegionConnection>,
  siteById: ReadonlyMap<string, WorldSite>,
  context: ValidationContext,
): void {
  const roadConnections = Array.isArray(blueprint.roads?.connections)
    ? blueprint.roads.connections
    : []
  const roadSegments = Array.isArray(blueprint.roads?.segments) ? blueprint.roads.segments : []
  if (!Array.isArray(blueprint.roads?.connections)) {
    context.add('roads.connectionsType', 'roads.connections', 'Road connections must be an array')
  }
  if (!Array.isArray(blueprint.roads?.segments)) {
    context.add('roads.segmentsType', 'roads.segments', 'Road segments must be an array')
  }

  const roadById = indexById(roadConnections, 'roads.connections', context)
  const segmentById = indexById(roadSegments, 'roads.segments', context)
  const worldPairs = connectionPairSet(connectionById.values())
  const referencedSegmentCounts = new Map<string, number>()
  const siteAdjacency = new Map<string, Set<string>>()
  for (const site of sites) siteAdjacency.set(site.id, new Set<string>())
  let branchToOptionalContent = false

  for (let index = 0; index < roadConnections.length; index += 1) {
    const road = roadConnections[index]
    const path = `roads.connections[${index}]`
    const fromSite = siteById.get(road.fromSiteId)
    const toSite = siteById.get(road.toSiteId)
    if (!fromSite) {
      context.add('road.fromSiteReference', `${path}.fromSiteId`, 'Road source site does not exist')
    }
    if (!toSite) {
      context.add(
        'road.toSiteReference',
        `${path}.toSiteId`,
        'Road destination site does not exist',
      )
    }
    if (road.kind !== 'critical' && road.kind !== 'branch') {
      context.add('road.kind', `${path}.kind`, 'Road connection kind is invalid')
    }
    if (road.kind === 'critical' && !isFaction(road.faction)) {
      context.add('road.faction', `${path}.faction`, 'Critical road requires a faction')
    }
    if (road.kind === 'branch' && road.faction !== undefined) {
      context.add('road.branchFaction', `${path}.faction`, 'Branch road cannot be faction critical')
    }
    if (!Array.isArray(road.regionPath) || road.regionPath.length === 0) {
      context.add('road.regionPath', `${path}.regionPath`, 'Road must contain a region path')
      continue
    }
    if (!Array.isArray(road.segmentIds)) {
      context.add('road.segmentIds', `${path}.segmentIds`, 'Road segment ids must be an array')
      continue
    }
    if (road.segmentIds.length !== road.regionPath.length - 1) {
      context.add(
        'road.segmentCount',
        `${path}.segmentIds`,
        'Road must have one segment per region transition',
      )
    }
    if (new Set(road.segmentIds).size !== road.segmentIds.length) {
      context.add('road.segmentDuplicate', `${path}.segmentIds`, 'Road segment ids must be unique')
    }

    if (fromSite && road.regionPath[0] !== fromSite.regionId) {
      context.add('road.startRegion', path, 'Road path does not begin at its source site region')
    }
    if (toSite && road.regionPath.at(-1) !== toSite.regionId) {
      context.add('road.endRegion', path, 'Road path does not end at its destination site region')
    }
    if (fromSite && toSite) {
      siteAdjacency.get(fromSite.id)?.add(toSite.id)
      siteAdjacency.get(toSite.id)?.add(fromSite.id)
      if (
        road.kind === 'branch' &&
        (OPTIONAL_SITE_KINDS.includes(fromSite.kind) ||
          OPTIONAL_SITE_KINDS.includes(toSite.kind))
      ) {
        branchToOptionalContent = true
      }
    }

    for (let pathIndex = 0; pathIndex < road.regionPath.length; pathIndex += 1) {
      const regionId = road.regionPath[pathIndex]
      if (!regionById.has(regionId)) {
        context.add(
          'road.regionReference',
          `${path}.regionPath[${pathIndex}]`,
          'Road region does not exist',
        )
      }
      if (
        pathIndex > 0 &&
        !worldPairs.has(unorderedPair(road.regionPath[pathIndex - 1], regionId))
      ) {
        context.add(
          'road.regionConnection',
          `${path}.regionPath[${pathIndex}]`,
          'Road traverses regions without a world connection',
        )
      }
    }

    for (let segmentIndex = 0; segmentIndex < road.segmentIds.length; segmentIndex += 1) {
      const segmentId = road.segmentIds[segmentIndex]
      referencedSegmentCounts.set(
        segmentId,
        (referencedSegmentCounts.get(segmentId) ?? 0) + 1,
      )
      const segment = segmentById.get(segmentId)
      if (!segment) {
        context.add(
          'road.segmentReference',
          `${path}.segmentIds[${segmentIndex}]`,
          'Road segment does not exist',
        )
        continue
      }
      if (
        segment.roadConnectionId !== road.id ||
        segment.fromRegionId !== road.regionPath[segmentIndex] ||
        segment.toRegionId !== road.regionPath[segmentIndex + 1]
      ) {
        context.add(
          'road.segmentOrder',
          `${path}.segmentIds[${segmentIndex}]`,
          'Road segment does not match its ordered region transition',
        )
      }
    }
  }

  for (let index = 0; index < roadSegments.length; index += 1) {
    const segment = roadSegments[index]
    const path = `roads.segments[${index}]`
    const road = roadById.get(segment.roadConnectionId)
    const connection = connectionById.get(segment.connectionId)
    if (!road) {
      context.add(
        'roadSegment.roadReference',
        `${path}.roadConnectionId`,
        'Road segment connection does not exist',
      )
    }
    if (!connection) {
      context.add(
        'roadSegment.worldConnectionReference',
        `${path}.connectionId`,
        'Road segment world connection does not exist',
      )
    } else if (!connectionMatchesPair(connection, segment.fromRegionId, segment.toRegionId)) {
      context.add(
        'roadSegment.connectionMismatch',
        path,
        'Road segment regions do not match its world connection',
      )
    }
    if ((referencedSegmentCounts.get(segment.id) ?? 0) !== 1) {
      context.add(
        'roadSegment.listing',
        path,
        'Road segment must be listed exactly once by its road connection',
      )
    }
  }

  for (const faction of WORLD_FACTIONS) {
    const criticalRoads = roadConnections.filter(
      (road) => road.kind === 'critical' && road.faction === faction,
    )
    if (criticalRoads.length !== 1) {
      context.add(
        'road.criticalCount',
        `roads.${faction}`,
        `Faction ${faction} must have exactly one critical road`,
      )
      continue
    }
    const road = criticalRoads[0]
    const criticalPath = blueprint.criticalPaths?.[faction]
    if (
      criticalPath &&
      (road.fromSiteId !== criticalPath.startSiteId ||
        road.toSiteId !== criticalPath.finaleSiteId ||
        !sameStringArray(road.regionPath, criticalPath.regionIds))
    ) {
      context.add(
        'road.criticalMismatch',
        `roads.${faction}`,
        'Critical road must exactly follow its faction critical path',
      )
    }
  }

  if (!branchToOptionalContent) {
    context.add(
      'road.branchMissing',
      'roads.connections',
      'Road network requires a non-critical branch to optional content',
    )
  }

  if (sites.length > 0) {
    const reachedSites = reachableFrom(sites[0].id, siteAdjacency)
    for (const site of sites) {
      if (!reachedSites.has(site.id)) {
        context.add(
          'roads.siteUnreachable',
          `sites.${site.id}`,
          `Site ${site.id} is not connected to the road network`,
        )
      }
    }
  }
}

function validateRiverAndBridges(
  blueprint: WorldBlueprint,
  regionById: ReadonlyMap<string, WorldRegion>,
  connectionById: ReadonlyMap<string, RegionConnection>,
  context: ValidationContext,
): void {
  const river = blueprint.river
  const riverSegments = Array.isArray(river?.segments) ? river.segments : []
  indexById(riverSegments, 'river.segments', context)
  const roadConnections = Array.isArray(blueprint.roads?.connections)
    ? blueprint.roads.connections
    : []
  const roadById = indexByIdWithoutIssues(roadConnections)
  const roadSegments = Array.isArray(blueprint.roads?.segments) ? blueprint.roads.segments : []
  const roadSegmentById = indexByIdWithoutIssues(roadSegments)

  if (!river || !isNonemptyId(river.id)) {
    context.add('river.id', 'river.id', 'A macro river with a valid id is required')
    return
  }
  if (!isDirection(river.sourceEdge) || !isDirection(river.mouthEdge)) {
    context.add('river.boundaryDirection', 'river', 'River boundary directions are invalid')
  }
  if (river.sourceEdge !== 'north' || river.mouthEdge !== 'south') {
    context.add(
      'river.orientation',
      'river',
      'Macro river must run from the north edge to the south edge',
    )
  }
  if (!Array.isArray(river.regionPath) || river.regionPath.length < 3) {
    context.add(
      'river.regionPath',
      'river.regionPath',
      'Macro river must cross at least three regions',
    )
    return
  }
  if (new Set(river.regionPath).size !== river.regionPath.length) {
    context.add('river.revisit', 'river.regionPath', 'River cannot revisit a region')
  }
  if (!Array.isArray(river.segments)) {
    context.add('river.segmentsType', 'river.segments', 'River segments must be an array')
  } else if (river.segments.length !== river.regionPath.length - 1) {
    context.add(
      'river.segmentCount',
      'river.segments',
      'River must have one segment per region transition',
    )
  }

  const firstRegion = regionById.get(river.regionPath[0])
  const lastRegion = regionById.get(river.regionPath.at(-1) ?? '')
  if (
    firstRegion &&
    isDirection(river.sourceEdge) &&
    !isOnBoundary(firstRegion, river.sourceEdge)
  ) {
    context.add('river.sourceBoundary', 'river.sourceEdge', 'River source is not on its named edge')
  }
  if (lastRegion && isDirection(river.mouthEdge) && !isOnBoundary(lastRegion, river.mouthEdge)) {
    context.add('river.mouthBoundary', 'river.mouthEdge', 'River mouth is not on its named edge')
  }

  for (let index = 0; index < river.regionPath.length; index += 1) {
    const region = regionById.get(river.regionPath[index])
    if (!region) {
      context.add(
        'river.regionReference',
        `river.regionPath[${index}]`,
        'River region does not exist',
      )
    }
    const previous = index > 0 ? regionById.get(river.regionPath[index - 1]) : undefined
    if (
      previous &&
      region &&
      (region.coordinate.x !== previous.coordinate.x ||
        region.coordinate.y !== previous.coordinate.y + 1)
    ) {
      context.add(
        'river.verticalPath',
        `river.regionPath[${index}]`,
        'Macro river regions must form a north-to-south vertical sequence',
      )
    }
  }

  for (let index = 0; index < riverSegments.length; index += 1) {
    const segment = riverSegments[index]
    const path = `river.segments[${index}]`
    const connection = connectionById.get(segment.connectionId)
    if (
      segment.fromRegionId !== river.regionPath[index] ||
      segment.toRegionId !== river.regionPath[index + 1]
    ) {
      context.add('river.segmentOrder', path, 'River segment does not match its region path')
    }
    if (!connection) {
      context.add(
        'river.connectionReference',
        `${path}.connectionId`,
        'River segment world connection does not exist',
      )
    } else if (!connectionMatchesPair(connection, segment.fromRegionId, segment.toRegionId)) {
      context.add(
        'river.connectionMismatch',
        path,
        'River segment regions do not match its world connection',
      )
    }
  }

  const bridges = Array.isArray(blueprint.bridges) ? blueprint.bridges : []
  if (!Array.isArray(blueprint.bridges)) {
    context.add('bridges.type', 'bridges', 'Bridges must be an array')
  }
  indexById(bridges, 'bridges', context)
  const riverRegionIds = new Set(river.regionPath)
  const expectedCrossings = deriveExpectedBridgeCrossings(
    roadConnections,
    riverRegionIds,
    regionById,
  )
  const seenCrossings = new Set<string>()
  const validCrossings = new Set<string>()
  for (let index = 0; index < bridges.length; index += 1) {
    const bridge = bridges[index]
    const path = `bridges[${index}]`
    const road = roadById.get(bridge.roadConnectionId)
    const region = regionById.get(bridge.regionId)
    const crossingKey =
      isNonemptyId(bridge.roadConnectionId) && isNonemptyId(bridge.regionId)
        ? bridgeCrossingKey(bridge.roadConnectionId, bridge.regionId)
        : undefined
    const expected = crossingKey ? expectedCrossings.get(crossingKey) : undefined
    let malformed = false

    if (bridge.riverId !== river.id) {
      context.add(
        'bridge.riverReference',
        `${path}.riverId`,
        'Bridge must reference the macro river',
      )
      malformed = true
    }
    if (!road) {
      context.add(
        'bridge.roadReference',
        `${path}.roadConnectionId`,
        'Bridge road connection does not exist',
      )
      malformed = true
    }
    if (!region) {
      context.add(
        'bridge.regionReference',
        `${path}.regionId`,
        'Bridge region does not exist',
      )
      malformed = true
    } else if (!riverRegionIds.has(region.id)) {
      context.add(
        'bridge.riverRegion',
        `${path}.regionId`,
        'Bridge region is not occupied by the macro river',
      )
      malformed = true
    }

    if (!Array.isArray(bridge.roadSegmentIds) || bridge.roadSegmentIds.length !== 2) {
      context.add(
        'bridge.segmentIds',
        `${path}.roadSegmentIds`,
        'Bridge must reference the two road segments bordering its river region',
      )
      malformed = true
    } else {
      if (new Set(bridge.roadSegmentIds).size !== 2) {
        context.add(
          'bridge.segmentDuplicate',
          `${path}.roadSegmentIds`,
          'Bridge road segment references must be distinct',
        )
        malformed = true
      }
      for (let segmentIndex = 0; segmentIndex < bridge.roadSegmentIds.length; segmentIndex += 1) {
        const segment = roadSegmentById.get(bridge.roadSegmentIds[segmentIndex])
        if (!segment) {
          context.add(
            'bridge.segmentReference',
            `${path}.roadSegmentIds[${segmentIndex}]`,
            'Bridge road segment does not exist',
          )
          malformed = true
        } else if (road && segment.roadConnectionId !== road.id) {
          context.add(
            'bridge.segmentRoadMismatch',
            `${path}.roadSegmentIds[${segmentIndex}]`,
            'Bridge road segment belongs to another road connection',
          )
          malformed = true
        }
      }
    }

    if (crossingKey) {
      if (seenCrossings.has(crossingKey)) {
        context.add(
          'bridge.duplicateCrossing',
          path,
          'Road and river-region crossing has multiple bridges',
        )
      }
      seenCrossings.add(crossingKey)
    }

    if (!expected) {
      if (
        road &&
        region &&
        riverRegionIds.has(region.id) &&
        Array.isArray(road.regionPath) &&
        road.regionPath.includes(region.id)
      ) {
        context.add(
          'bridge.nonTransverse',
          path,
          'Bridge marks road travel that does not cross the river east-to-west',
        )
      }
      context.add(
        'bridge.extra',
        path,
        'Bridge does not mark a transverse road and river-region crossing',
      )
    } else if (
      Array.isArray(bridge.roadSegmentIds) &&
      !sameStringArray(bridge.roadSegmentIds, expected.roadSegmentIds)
    ) {
      context.add(
        'bridge.segmentMismatch',
        `${path}.roadSegmentIds`,
        'Bridge segments must be the ordered road segments on either side of the river region',
      )
      malformed = true
    }

    if (malformed) {
      context.add('bridge.malformed', path, 'Bridge crossing data is malformed')
    } else if (crossingKey && expected) {
      validCrossings.add(crossingKey)
    }
  }

  for (const crossingKey of expectedCrossings.keys()) {
    if (!validCrossings.has(crossingKey)) {
      context.add(
        'bridge.missing',
        'bridges',
        'Every transverse road and river-region crossing requires exactly one bridge',
      )
    }
  }
}

function deriveExpectedBridgeCrossings(
  roads: readonly RoadConnection[],
  riverRegionIds: ReadonlySet<string>,
  regionById: ReadonlyMap<string, WorldRegion>,
): Map<string, ExpectedBridgeCrossing> {
  const crossings = new Map<string, ExpectedBridgeCrossing>()
  for (const road of roads) {
    if (!Array.isArray(road.regionPath) || !Array.isArray(road.segmentIds)) continue
    for (let index = 1; index < road.regionPath.length - 1; index += 1) {
      const regionId = road.regionPath[index]
      if (
        !isTransverseRoadCrossing(
          road.regionPath[index - 1],
          regionId,
          road.regionPath[index + 1],
          riverRegionIds,
          regionById,
        )
      ) {
        continue
      }
      const firstSegmentId = road.segmentIds[index - 1]
      const secondSegmentId = road.segmentIds[index]
      if (!isNonemptyId(firstSegmentId) || !isNonemptyId(secondSegmentId)) continue
      const crossing = {
        roadConnectionId: road.id,
        regionId,
        roadSegmentIds: [firstSegmentId, secondSegmentId] as const,
      }
      crossings.set(bridgeCrossingKey(road.id, regionId), crossing)
    }
  }
  return crossings
}

function isTransverseRoadCrossing(
  previousRegionId: string,
  regionId: string,
  nextRegionId: string,
  riverRegionIds: ReadonlySet<string>,
  regionById: ReadonlyMap<string, WorldRegion>,
): boolean {
  if (!riverRegionIds.has(regionId)) return false
  const previous = regionById.get(previousRegionId)
  const crossing = regionById.get(regionId)
  const next = regionById.get(nextRegionId)
  if (!previous || !crossing || !next) return false
  return (
    previous.coordinate.y === crossing.coordinate.y &&
    next.coordinate.y === crossing.coordinate.y &&
    (previous.coordinate.x - crossing.coordinate.x) *
      (next.coordinate.x - crossing.coordinate.x) <
      0
  )
}

function bridgeCrossingKey(roadConnectionId: string, regionId: string): string {
  return `${roadConnectionId}\u0000${regionId}`
}

function validateEncounters(
  blueprint: WorldBlueprint,
  regions: readonly WorldRegion[],
  encounters: readonly EncounterSlot[],
  regionById: ReadonlyMap<string, WorldRegion>,
  siteById: ReadonlyMap<string, WorldSite>,
  encounterById: ReadonlyMap<string, EncounterSlot>,
  context: ValidationContext,
): void {
  const listings = new Map<string, number>()
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
    const region = regions[regionIndex]
    if (!Array.isArray(region.encounterSlotIds)) continue
    if (region.encounterSlotIds.length === 0) {
      context.add(
        'encounter.regionEmpty',
        `regions[${regionIndex}].encounterSlotIds`,
        'Every region requires at least one encounter slot',
      )
    }
    for (let encounterIndex = 0; encounterIndex < region.encounterSlotIds.length; encounterIndex += 1) {
      const encounterId = region.encounterSlotIds[encounterIndex]
      const encounter = encounterById.get(encounterId)
      listings.set(encounterId, (listings.get(encounterId) ?? 0) + 1)
      if (!encounter) {
        context.add(
          'region.encounterReference',
          `regions[${regionIndex}].encounterSlotIds[${encounterIndex}]`,
          'Region encounter slot does not exist',
        )
      } else if (encounter.regionId !== region.id) {
        context.add(
          'region.encounterMismatch',
          `regions[${regionIndex}].encounterSlotIds[${encounterIndex}]`,
          'Region lists an encounter assigned elsewhere',
        )
      }
    }
  }

  for (let index = 0; index < encounters.length; index += 1) {
    const encounter = encounters[index]
    const path = `encounters[${index}]`
    if (!regionById.has(encounter.regionId)) {
      context.add(
        'encounter.regionReference',
        `${path}.regionId`,
        'Encounter region does not exist',
      )
    }
    if (
      encounter.kind !== 'patrol' &&
      encounter.kind !== 'ambush' &&
      encounter.kind !== 'elite' &&
      encounter.kind !== 'boss'
    ) {
      context.add('encounter.kind', `${path}.kind`, 'Encounter kind is invalid')
    }
    if (
      !Number.isSafeInteger(encounter.difficulty) ||
      encounter.difficulty < 1 ||
      encounter.difficulty > 5
    ) {
      context.add(
        'encounter.difficulty',
        `${path}.difficulty`,
        'Encounter difficulty must be an integer from 1 to 5',
      )
    }
    if (
      !Array.isArray(encounter.hostileTo) ||
      encounter.hostileTo.length === 0 ||
      encounter.hostileTo.some((faction) => !isFaction(faction)) ||
      new Set(encounter.hostileTo).size !== encounter.hostileTo.length
    ) {
      context.add(
        'encounter.hostileTo',
        `${path}.hostileTo`,
        'Encounter hostility must contain unique valid factions',
      )
    }
    if (encounter.siteId !== undefined) {
      const site = siteById.get(encounter.siteId)
      if (!site) {
        context.add('encounter.siteReference', `${path}.siteId`, 'Encounter site does not exist')
      } else if (site.regionId !== encounter.regionId) {
        context.add(
          'encounter.siteRegion',
          `${path}.siteId`,
          'Encounter site is in another region',
        )
      }
    }
    if ((listings.get(encounter.id) ?? 0) !== 1) {
      context.add(
        'encounter.regionListing',
        path,
        'Encounter must be listed exactly once by its region',
      )
    }
  }

  for (const faction of WORLD_FACTIONS) {
    const finaleId = blueprint.finales?.[faction]
    const hasBoss = encounters.some(
      (encounter) => encounter.kind === 'boss' && encounter.siteId === finaleId,
    )
    if (!hasBoss) {
      context.add(
        'encounter.finaleBoss',
        `finales.${faction}`,
        `Faction ${faction} finale requires a boss encounter`,
      )
    }
  }
}

function validateObjectives(
  blueprint: WorldBlueprint,
  siteById: ReadonlyMap<string, WorldSite>,
  regionById: ReadonlyMap<string, WorldRegion>,
  regionAdjacency: ReadonlyMap<string, ReadonlySet<string>>,
  context: ValidationContext,
): void {
  const globalNodeIds = new Set<string>()

  for (const faction of WORLD_FACTIONS) {
    const graph = blueprint.objectives?.[faction]
    const path = `objectives.${faction}`
    if (!graph) {
      context.add('objective.graphMissing', path, `Faction ${faction} objective graph is missing`)
      continue
    }
    if (graph.faction !== faction) {
      context.add('objective.faction', `${path}.faction`, 'Objective graph faction is incorrect')
    }
    if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
      context.add('objective.nodes', `${path}.nodes`, 'Objective graph must contain nodes')
      continue
    }
    if (!Array.isArray(graph.rootNodeIds) || graph.rootNodeIds.length === 0) {
      context.add('objective.roots', `${path}.rootNodeIds`, 'Objective graph requires root nodes')
    }

    const nodeById = indexObjectiveNodes(graph, path, context)
    const dependents = new Map<string, Set<string>>()
    const indegree = new Map<string, number>()
    for (const node of graph.nodes) {
      dependents.set(node.id, new Set<string>())
      indegree.set(node.id, 0)
    }

    const startSite = siteById.get(blueprint.starts?.[faction])
    const reachableRegions = startSite
      ? reachableFrom(startSite.regionId, regionAdjacency)
      : new Set<string>()

    for (let index = 0; index < graph.nodes.length; index += 1) {
      const node = graph.nodes[index]
      const nodePath = `${path}.nodes[${index}]`
      if (globalNodeIds.has(node.id)) {
        context.add('objective.globalIdDuplicate', `${nodePath}.id`, 'Objective node id is not global')
      }
      globalNodeIds.add(node.id)

      const site = siteById.get(node.siteId)
      if (!site) {
        context.add('objective.siteReference', `${nodePath}.siteId`, 'Objective site does not exist')
      }
      if (!regionById.has(node.regionId)) {
        context.add(
          'objective.regionReference',
          `${nodePath}.regionId`,
          'Objective region does not exist',
        )
      }
      if (site && site.regionId !== node.regionId) {
        context.add(
          'objective.siteRegion',
          nodePath,
          'Objective site and region references do not match',
        )
      }
      if (startSite && !reachableRegions.has(node.regionId)) {
        context.add(
          'objective.worldUnreachable',
          nodePath,
          'Objective region is unreachable from the faction start',
        )
      }
      if (
        node.kind !== 'arrive' &&
        node.kind !== 'interact' &&
        node.kind !== 'defeat' &&
        node.kind !== 'claim'
      ) {
        context.add('objective.kind', `${nodePath}.kind`, 'Objective kind is invalid')
      }
      if (!Array.isArray(node.prerequisiteIds)) {
        context.add(
          'objective.prerequisites',
          `${nodePath}.prerequisiteIds`,
          'Objective prerequisites must be an array',
        )
        continue
      }
      if (new Set(node.prerequisiteIds).size !== node.prerequisiteIds.length) {
        context.add(
          'objective.prerequisiteDuplicate',
          `${nodePath}.prerequisiteIds`,
          'Objective prerequisites must be unique',
        )
      }
      for (const prerequisiteId of node.prerequisiteIds) {
        if (!nodeById.has(prerequisiteId)) {
          context.add(
            'objective.prerequisiteReference',
            `${nodePath}.prerequisiteIds`,
            `Objective prerequisite ${prerequisiteId} does not exist`,
          )
          continue
        }
        dependents.get(prerequisiteId)?.add(node.id)
        indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1)
      }
    }

    validateObjectiveRoots(graph, nodeById, indegree, path, context)
    validateObjectiveDag(graph, dependents, indegree, path, context)

    const finalNode = nodeById.get(graph.finalNodeId)
    if (!finalNode) {
      context.add(
        'objective.finalReference',
        `${path}.finalNodeId`,
        'Objective final node does not exist',
      )
    } else if (
      finalNode.siteId !== blueprint.finales?.[faction] ||
      finalNode.kind !== 'defeat'
    ) {
      context.add(
        'objective.finalSite',
        `${path}.finalNodeId`,
        'Final objective must defeat the faction finale site',
      )
    }
  }
}

function validateObjectiveRoots(
  graph: FactionObjectiveGraph,
  nodeById: ReadonlyMap<string, FactionObjectiveNode>,
  indegree: ReadonlyMap<string, number>,
  path: string,
  context: ValidationContext,
): void {
  const rootIds = Array.isArray(graph.rootNodeIds) ? graph.rootNodeIds : []
  if (new Set(rootIds).size !== rootIds.length) {
    context.add('objective.rootDuplicate', `${path}.rootNodeIds`, 'Root node ids must be unique')
  }
  const actualRoots = new Set(
    [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id),
  )
  const declaredRoots = new Set(rootIds)
  for (const rootId of rootIds) {
    if (!nodeById.has(rootId)) {
      context.add(
        'objective.rootReference',
        `${path}.rootNodeIds`,
        `Objective root ${rootId} does not exist`,
      )
    }
  }
  if (!sameSet(actualRoots, declaredRoots)) {
    context.add(
      'objective.rootMismatch',
      `${path}.rootNodeIds`,
      'Declared roots must exactly match nodes without prerequisites',
    )
  }
}

function validateObjectiveDag(
  graph: FactionObjectiveGraph,
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
  indegree: ReadonlyMap<string, number>,
  path: string,
  context: ValidationContext,
): void {
  const remaining = new Map(indegree)
  const queue = graph.nodes.filter((node) => (remaining.get(node.id) ?? 0) === 0).map((node) => node.id)
  const visited = new Set<string>()
  let queueIndex = 0
  while (queueIndex < queue.length) {
    const nodeId = queue[queueIndex]
    queueIndex += 1
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    for (const dependentId of dependents.get(nodeId) ?? []) {
      const nextDegree = (remaining.get(dependentId) ?? 0) - 1
      remaining.set(dependentId, nextDegree)
      if (nextDegree === 0) queue.push(dependentId)
    }
  }
  if (visited.size !== graph.nodes.length) {
    context.add('objective.cycle', `${path}.nodes`, 'Objective prerequisites must be acyclic')
  }

  const reachedFromRoots = new Set<string>()
  const reachableQueue = Array.isArray(graph.rootNodeIds) ? [...graph.rootNodeIds] : []
  let reachableIndex = 0
  while (reachableIndex < reachableQueue.length) {
    const nodeId = reachableQueue[reachableIndex]
    reachableIndex += 1
    if (reachedFromRoots.has(nodeId)) continue
    reachedFromRoots.add(nodeId)
    for (const dependentId of dependents.get(nodeId) ?? []) reachableQueue.push(dependentId)
  }
  for (const node of graph.nodes) {
    if (!reachedFromRoots.has(node.id)) {
      context.add(
        'objective.unreachableNode',
        `${path}.nodes.${node.id}`,
        'Objective node is unreachable from a declared root',
      )
    }
  }
}

function validateFingerprint(blueprint: WorldBlueprint, context: ValidationContext): void {
  if (typeof blueprint.fingerprint !== 'string' || blueprint.fingerprint.length === 0) {
    context.add('fingerprint.missing', 'fingerprint', 'World fingerprint is required')
    return
  }
  try {
    const expected = computeWorldFingerprint(blueprint)
    if (blueprint.fingerprint !== expected) {
      context.add(
        'fingerprint.mismatch',
        'fingerprint',
        `Fingerprint does not match canonical world data; expected ${expected}`,
      )
    }
  } catch (error) {
    context.add(
      'fingerprint.unserializable',
      'fingerprint',
      error instanceof Error ? error.message : 'World data is not canonically serializable',
    )
  }
}

function indexById<T extends { id: string }>(
  values: readonly T[],
  path: string,
  context: ValidationContext,
): Map<string, T> {
  const indexed = new Map<string, T>()
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!isNonemptyId(value.id)) {
      context.add('id.invalid', `${path}[${index}].id`, 'Id must be a nonempty string')
      continue
    }
    if (indexed.has(value.id)) {
      context.add('id.duplicate', `${path}[${index}].id`, `Duplicate id ${value.id}`)
      continue
    }
    indexed.set(value.id, value)
  }
  return indexed
}

function indexByIdWithoutIssues<T extends { id: string }>(values: readonly T[]): Map<string, T> {
  const indexed = new Map<string, T>()
  for (const value of values) {
    if (!indexed.has(value.id)) indexed.set(value.id, value)
  }
  return indexed
}

function indexObjectiveNodes(
  graph: FactionObjectiveGraph,
  path: string,
  context: ValidationContext,
): Map<string, FactionObjectiveNode> {
  return indexById(graph.nodes, `${path}.nodes`, context)
}

function connectionPairSet(connections: Iterable<RegionConnection>): Set<string> {
  const pairs = new Set<string>()
  for (const connection of connections) {
    pairs.add(unorderedPair(connection.fromRegionId, connection.toRegionId))
  }
  return pairs
}

function reachableFrom(
  startId: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const reached = new Set<string>()
  const queue = [startId]
  let index = 0
  while (index < queue.length) {
    const id = queue[index]
    index += 1
    if (reached.has(id)) continue
    reached.add(id)
    for (const neighbor of adjacency.get(id) ?? []) {
      if (!reached.has(neighbor)) queue.push(neighbor)
    }
  }
  return reached
}

function connectionMatchesPair(
  connection: RegionConnection,
  firstRegionId: string,
  secondRegionId: string,
): boolean {
  return (
    (connection.fromRegionId === firstRegionId &&
      connection.toRegionId === secondRegionId) ||
    (connection.fromRegionId === secondRegionId && connection.toRegionId === firstRegionId)
  )
}

function isOnBoundary(region: WorldRegion, direction: CardinalDirection): boolean {
  if (direction === 'north') return region.coordinate.y === 0
  if (direction === 'south') return region.coordinate.y === WORLD_HEIGHT - 1
  if (direction === 'west') return region.coordinate.x === 0
  return region.coordinate.x === WORLD_WIDTH - 1
}

function isFaction(value: unknown): value is Faction {
  return value === 'elf' || value === 'guard' || value === 'villain'
}

function isBiome(value: unknown): value is ZoneId {
  return value === 'neutral' || value === 'palace' || value === 'forest' || value === 'fort'
}

function isTerritory(value: unknown): value is Faction | 'neutral' {
  return value === 'neutral' || isFaction(value)
}

function isDirection(value: unknown): value is CardinalDirection {
  return value === 'north' || value === 'east' || value === 'south' || value === 'west'
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < 0x1_0000_0000
}

function isNonemptyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function unorderedPair(first: string, second: string): string {
  return first < second ? `${first}\u0000${second}` : `${second}\u0000${first}`
}

function sameStringArray(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index])
}

function sameSet<T>(first: ReadonlySet<T>, second: ReadonlySet<T>): boolean {
  if (first.size !== second.size) return false
  for (const value of first) {
    if (!second.has(value)) return false
  }
  return true
}

function canonicalSerialize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('World data contains a non-finite number')
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new TypeError(`World data contains unsupported ${typeof value} value`)
  }
  if (ancestors.has(value)) throw new TypeError('World data contains a cycle')
  ancestors.add(value)

  let serialized: string
  if (Array.isArray(value)) {
    serialized = `[${value.map((entry) => canonicalSerialize(entry, ancestors)).join(',')}]`
  } else {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort(compareStrings)
    serialized = `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key], ancestors)}`)
      .join(',')}}`
  }

  ancestors.delete(value)
  return serialized
}

function compareStrings(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0
}

function toHex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}
