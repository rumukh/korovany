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
 * The contract a node runs, if any.
 *
 * Deliberately *not* a fifth `ObjectiveKind`. Nine new campaign verbs is the explicitly
 * rejected design; what a contract adds is not a verb but the promotion of a shipped event
 * builder into a campaign object with a bounded clock and a fail-forward guarantee. The
 * node still wears one of the four verbs above, which is what it degrades to when its
 * contract falls through.
 *
 * Roadmap 1.4 promoted three. **Roadmap 2.1 promotes the other seven**, so the ten ids
 * below are one-for-one with the ten shipped builders in `GameEngine` and there is still
 * not a single new campaign behaviour among them:
 *
 * ```
 * plunder  richCaravan    bulwark  defendHome     unshackle rescue
 * duel     champion       reprisal bounty         relief    factionRaid
 * ambush   caravanAmbush  muster   warband        cull      beastRaid
 * scavenge aftermath
 * ```
 *
 * The union lives here rather than in `CampaignDirector` because the blueprint is the thing
 * that names it, and the validator has to be able to check it without importing the
 * director.
 */
export type ContractId =
  | 'plunder'
  | 'bulwark'
  | 'unshackle'
  | 'duel'
  | 'reprisal'
  | 'relief'
  | 'ambush'
  | 'muster'
  | 'cull'
  | 'scavenge'

export const CONTRACT_IDS = [
  'plunder',
  'bulwark',
  'unshackle',
  'duel',
  'reprisal',
  'relief',
  'ambush',
  'muster',
  'cull',
  'scavenge',
] as const satisfies readonly ContractId[]

export interface FactionObjectiveNode {
  id: string
  kind: ObjectiveKind
  siteId: SiteId
  regionId: RegionId
  prerequisiteIds: string[]
  /** Roadmap 1.4 — the contract this node runs. 2.1 puts one on each arm of the fork. */
  contract?: ContractId
  /**
   * Roadmap 2.1 — the node is **not required for victory**.
   *
   * This is the half of the initiative the persisted `Objective` had to grow a field for.
   * While every node was required the win condition could stay `every(o => o.done)` and
   * what the player chose was an order; an optional node is what makes the choice a
   * *route*. An optional node is still only settled by being done or skipped — it never
   * simply evaporates — which is what keeps "the campaign can be won without doing
   * everything" from becoming "the campaign can be won without doing anything".
   */
  optional?: boolean
  /**
   * Roadmap 2.1 — the fork this node is one arm of.
   *
   * Nodes sharing a group are **alternatives**: completing one marks the rest `skipped`
   * and takes them off the board. That is the whole of "exclusive route" as something the
   * player can see — taking one arm means visibly not taking the other — and it is also
   * what makes the group safe, because a group is only ever settled by a completion.
   */
  exclusiveGroup?: string
}

export interface FactionObjectiveGraph {
  faction: Faction
  nodes: FactionObjectiveNode[]
  rootNodeIds: string[]
  finalNodeId: string
}

/**
 * Where a contract may be sited, and which of the four verbs it wears.
 *
 * This is generator vocabulary, so it lives here beside the graph it shapes — the same
 * split 1.3 used, where `RumourKind` sits in `types.ts` and the deadlines that govern a
 * rumour sit in `CampaignDirector`. The clock, the start grace, the shipped event builder
 * each contract is adapted from and the fail-forward guarantee are the director's, in
 * `CONTRACT_TEMPLATES`; `tests/factionContracts.test.ts` pins that the two tables cover
 * exactly the same ten ids.
 *
 * Every candidate list is **disjoint from that faction's errand choices** in
 * `createObjectives`, and the generator additionally refuses to put the two arms of a fork
 * on one square, so the fork is always different places on the map. A fork whose arms
 * shared a site would be a fork the player cannot see, which is the thing this initiative
 * exists to avoid.
 */
export interface FactionContractSiting {
  id: ContractId
  faction: Faction
  kind: ObjectiveKind
  siteIds: readonly SiteId[]
}

/**
 * All ten contracts, one per shipped event builder.
 *
 * The pairing of a contract with a faction is that faction's own identity rather than a
 * shuffle: the villain robs and scavenges, the guard protects and culls, the elf frees its
 * own and settles what was done to them.
 */
export const CONTRACT_SITINGS: Record<ContractId, FactionContractSiting> = {
  // --- elf ----------------------------------------------------------------
  unshackle: {
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
  duel: {
    id: 'duel',
    faction: 'elf',
    // `champion`: one travelling champion, and nothing to do with him but fight.
    kind: 'defeat',
    siteIds: [
      'site-landmark-old-road',
      'site-treasure-hidden',
      'site-settlement-crossroads',
    ],
  },
  reprisal: {
    id: 'reprisal',
    faction: 'elf',
    // `bounty`: a marked head on a 40 s clock.
    kind: 'defeat',
    siteIds: [
      'site-recovery-riverside',
      'site-landmark-old-road',
      'site-treasure-hidden',
    ],
  },
  // --- guard --------------------------------------------------------------
  bulwark: {
    id: 'bulwark',
    faction: 'guard',
    // `defendHome`: four raiders and something burning. `defeat` is the verb.
    kind: 'defeat',
    siteIds: ['site-shop-riverside', 'site-landmark-old-road', 'site-event-frontier'],
  },
  relief: {
    id: 'relief',
    faction: 'guard',
    // `factionRaid`: three raiders on two defenders. Breaking it is the verb.
    kind: 'defeat',
    siteIds: ['site-event-frontier', 'site-landmark-old-road', 'site-treasure-hidden'],
  },
  cull: {
    id: 'cull',
    faction: 'guard',
    // `beastRaid`: a pack, a homestead and a garrison of two.
    kind: 'defeat',
    siteIds: ['site-shop-riverside', 'site-event-frontier', 'site-treasure-hidden'],
  },
  // --- villain ------------------------------------------------------------
  plunder: {
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
  ambush: {
    id: 'ambush',
    faction: 'villain',
    // `caravanAmbush`: somebody else's cart, already being taken. `claim` again.
    kind: 'claim',
    siteIds: [
      'site-shop-riverside',
      'site-recovery-riverside',
      'site-event-frontier',
    ],
  },
  muster: {
    id: 'muster',
    faction: 'villain',
    // `warband`: a rival gang of three on the same ground.
    kind: 'defeat',
    siteIds: [
      'site-settlement-crossroads',
      'site-event-frontier',
      'site-recovery-riverside',
    ],
  },
  scavenge: {
    id: 'scavenge',
    faction: 'villain',
    // `aftermath`: looters in the ashes, and whatever they had not carried off yet.
    kind: 'claim',
    siteIds: [
      'site-settlement-crossroads',
      'site-shop-riverside',
      'site-recovery-riverside',
    ],
  },
}

/**
 * Each faction's signature contract — the one 1.4 shipped, and the one arm of the fork
 * that is always on the table.
 *
 * Kept as its own table rather than derived, because "the three factions demonstrably pick
 * different contracts" is a measured signal and a derivation would make it a tautology.
 */
export const FACTION_CONTRACT_SITES: FactionRecord<FactionContractSiting> = {
  elf: CONTRACT_SITINGS.unshackle,
  guard: CONTRACT_SITINGS.bulwark,
  villain: CONTRACT_SITINGS.plunder,
}

/**
 * Roadmap 2.1 — the contracts a faction may draw the *other* arm of its fork from.
 *
 * The signature is listed first and is never drawn against itself: the alternative comes
 * from the rest of the faction's pool, so a run always offers the faction's own signature
 * plus one of the verbs 1.4 left on the shelf.
 */
export const FACTION_CONTRACT_POOL: FactionRecord<readonly ContractId[]> = {
  elf: ['unshackle', 'duel', 'reprisal'],
  guard: ['bulwark', 'relief', 'cull'],
  villain: ['plunder', 'ambush', 'muster', 'scavenge'],
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
