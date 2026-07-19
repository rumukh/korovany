import type { Faction, ZoneId } from '../types.ts'

export const WORLD_GENERATOR_VERSION = 1 as const
export const WORLD_WIDTH = 5
export const WORLD_HEIGHT = 5
export const DEFAULT_REGION_SIZE = 80

export const WORLD_FACTIONS = ['elf', 'guard', 'villain'] as const satisfies readonly Faction[]
export const WORLD_BIOMES = [
  'neutral',
  'palace',
  'forest',
  'fort',
] as const satisfies readonly ZoneId[]

export type RegionId = string
export type ConnectionId = string
export type SiteId = string
export type Territory = Faction | 'neutral'
export type CardinalDirection = 'north' | 'east' | 'south' | 'west'

export interface WorldDimensions {
  width: number
  height: number
}

export interface WorldOrigin {
  x: number
  z: number
}

export interface WorldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface RegionCoordinate {
  x: number
  y: number
}

export interface RegionHeightProfile {
  baseHeight: number
  relief: number
  roughnessPermille: number
  featureScale: number
  detailScale: number
}

export interface CardinalEdge {
  direction: CardinalDirection
  toRegionId: RegionId
  connectionId: ConnectionId
}

export interface WorldRegion {
  id: RegionId
  coordinate: RegionCoordinate
  biome: ZoneId
  territory: Territory
  heightProfile: RegionHeightProfile
  edges: CardinalEdge[]
  siteIds: SiteId[]
  encounterSlotIds: string[]
}

export type RegionBlueprint = WorldRegion

export interface RegionConnection {
  id: ConnectionId
  fromRegionId: RegionId
  toRegionId: RegionId
  direction: CardinalDirection
}

export type SiteKind =
  | 'faction-start'
  | 'final-stronghold'
  | 'settlement'
  | 'shop'
  | 'recovery'
  | 'event'
  | 'treasure'
  | 'landmark'

export interface WorldSite {
  id: SiteId
  kind: SiteKind
  regionId: RegionId
  owner: Territory
  campaignFaction?: Faction
}

export interface FactionRecord<T> {
  elf: T
  guard: T
  villain: T
}

export interface CriticalPath {
  faction: Faction
  startSiteId: SiteId
  finaleSiteId: SiteId
  regionIds: RegionId[]
  transitionCount: number
}

export type RoadConnectionKind = 'critical' | 'branch'

export interface RoadSegment {
  id: string
  roadConnectionId: string
  connectionId: ConnectionId
  fromRegionId: RegionId
  toRegionId: RegionId
}

export interface RoadConnection {
  id: string
  kind: RoadConnectionKind
  fromSiteId: SiteId
  toSiteId: SiteId
  regionPath: RegionId[]
  segmentIds: string[]
  faction?: Faction
}

export interface RoadNetwork {
  connections: RoadConnection[]
  segments: RoadSegment[]
}

export interface RiverSegment {
  id: string
  connectionId: ConnectionId
  fromRegionId: RegionId
  toRegionId: RegionId
}

export interface MacroRiver {
  id: string
  sourceEdge: CardinalDirection
  mouthEdge: CardinalDirection
  regionPath: RegionId[]
  segments: RiverSegment[]
}

export interface BridgeCrossing {
  id: string
  regionId: RegionId
  roadConnectionId: string
  roadSegmentIds: [string, string]
  riverId: string
}

export type EncounterKind = 'patrol' | 'ambush' | 'elite' | 'boss'

export interface EncounterSlot {
  id: string
  regionId: RegionId
  kind: EncounterKind
  difficulty: number
  hostileTo: Faction[]
  siteId?: SiteId
}

export type ObjectiveKind = 'arrive' | 'interact' | 'defeat' | 'claim'

export interface FactionObjectiveNode {
  id: string
  kind: ObjectiveKind
  siteId: SiteId
  regionId: RegionId
  prerequisiteIds: string[]
}

export interface FactionObjectiveGraph {
  faction: Faction
  nodes: FactionObjectiveNode[]
  rootNodeIds: string[]
  finalNodeId: string
}

export interface WorldBlueprint {
  generatorVersion: typeof WORLD_GENERATOR_VERSION
  seed: number
  dimensions: WorldDimensions
  regionSize: number
  origin: WorldOrigin
  bounds: WorldBounds
  regions: WorldRegion[]
  connections: RegionConnection[]
  sites: WorldSite[]
  starts: FactionRecord<SiteId>
  finales: FactionRecord<SiteId>
  criticalPaths: FactionRecord<CriticalPath>
  roads: RoadNetwork
  river: MacroRiver
  bridges: BridgeCrossing[]
  encounters: EncounterSlot[]
  objectives: FactionRecord<FactionObjectiveGraph>
  fingerprint: string
}
