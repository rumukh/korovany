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

/**
 * Roadmap 1.4 — the signature contract a node runs, if any.
 *
 * Deliberately *not* a fifth `ObjectiveKind`. Nine new campaign verbs is the explicitly
 * rejected design; what a contract adds is not a verb but the promotion of a shipped event
 * builder into a campaign object with a bounded clock and a fail-forward guarantee. The
 * node still wears one of the four verbs above, which is what it degrades to when its
 * contract falls through.
 *
 * The union lives here rather than in `CampaignDirector` because the blueprint is the thing
 * that names it, and the validator has to be able to check it without importing the
 * director.
 */
export type ContractId = 'plunder' | 'bulwark' | 'unshackle'

export const CONTRACT_IDS = [
  'plunder',
  'bulwark',
  'unshackle',
] as const satisfies readonly ContractId[]

export interface FactionObjectiveNode {
  id: string
  kind: ObjectiveKind
  siteId: SiteId
  regionId: RegionId
  prerequisiteIds: string[]
  /** Roadmap 1.4 — set on exactly one node per faction graph. */
  contract?: ContractId
}

export interface FactionObjectiveGraph {
  faction: Faction
  nodes: FactionObjectiveNode[]
  rootNodeIds: string[]
  finalNodeId: string
}

/**
 * Where a faction's signature contract may be sited, and which of the four verbs it wears.
 *
 * This is generator vocabulary, so it lives here beside the graph it shapes — the same
 * split 1.3 used, where `RumourKind` sits in `types.ts` and the deadlines that govern a
 * rumour sit in `CampaignDirector`. The clock, the start grace, the shipped event builder
 * each contract is adapted from and the fail-forward guarantee are the director's, in
 * `FACTION_CONTRACTS`; `tests/factionContracts.test.ts` pins that the two tables cover
 * exactly the same three ids.
 *
 * Every candidate list is **disjoint from that faction's errand choices** in
 * `createObjectives`, so the fork is always two different places on the map. A fork whose
 * arms share a site would be a fork the player cannot see, which is the thing this slice
 * exists to avoid.
 */
export interface FactionContractSiting {
  id: ContractId
  faction: Faction
  kind: ObjectiveKind
  siteIds: readonly SiteId[]
}

export const FACTION_CONTRACT_SITES: FactionRecord<FactionContractSiting> = {
  elf: {
    id: 'unshackle',
    faction: 'elf',
    // `rescue`: a prisoner and two guards. The node completes by freeing them, so the verb
    // it degrades to is `interact` — walk up and cut the ropes.
    kind: 'interact',
    siteIds: [
      'site-settlement-crossroads',
      'site-landmark-old-road',
      'site-recovery-riverside',
    ],
  },
  guard: {
    id: 'bulwark',
    faction: 'guard',
    // `defendHome`: four raiders and something burning. `defeat` is the verb.
    kind: 'defeat',
    siteIds: ['site-shop-riverside', 'site-landmark-old-road', 'site-event-frontier'],
  },
  villain: {
    id: 'plunder',
    faction: 'villain',
    // `richCaravan`: a fat cart and its escort. `claim` is the verb — take the load.
    kind: 'claim',
    siteIds: [
      'site-settlement-crossroads',
      'site-shop-riverside',
      'site-event-frontier',
    ],
  },
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
