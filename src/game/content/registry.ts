import { RandomStream } from '../random/RandomStream.ts'
import { deriveSeed, keyedRandom } from '../random/seed.ts'
import type { ActorRole, Faction, ZoneId } from '../types.ts'
import {
  WORLD_FACTIONS,
  type EncounterKind,
  type EncounterSlot,
  type RegionId,
  type SiteKind,
  type Territory,
  type WorldBlueprint,
  type WorldRegion,
  type WorldSite,
} from '../world/worldTypes.ts'

export type WeatherAffinity =
  | 'clear'
  | 'breeze'
  | 'rain'
  | 'mist'
  | 'storm'
  | 'ash'

export type SiteFlavor =
  | 'roadside'
  | 'civic'
  | 'wild'
  | 'military'
  | 'mystic'
  | 'ruined'
  | 'mercantile'

export type EncounterFlavor =
  | 'patrol'
  | 'road-ambush'
  | 'territorial'
  | 'fortified'
  | 'woodland'
  | 'arcane'
  | 'raiders'

export interface BiomeProfile {
  id: ZoneId
  label: string
  terrainColor: number
  secondaryColor: number
  accentColor: number
  weatherAffinity: readonly WeatherAffinity[]
  foliageDensity: number
  decorationDensity: number
  siteFlavors: readonly SiteFlavor[]
  encounterFlavors: readonly EncounterFlavor[]
}

export const BIOME_PROFILES = {
  neutral: {
    id: 'neutral',
    label: 'Зона людей',
    terrainColor: 0x8d8357,
    secondaryColor: 0x5d6d3f,
    accentColor: 0xc48742,
    weatherAffinity: ['clear', 'breeze', 'rain'],
    foliageDensity: 0.32,
    decorationDensity: 0.48,
    siteFlavors: ['roadside', 'civic', 'mercantile', 'ruined'],
    encounterFlavors: ['patrol', 'road-ambush', 'raiders'],
  },
  palace: {
    id: 'palace',
    label: 'Зона императора',
    terrainColor: 0x777d86,
    secondaryColor: 0xa4a8ad,
    accentColor: 0x547ac4,
    weatherAffinity: ['clear', 'breeze', 'mist'],
    foliageDensity: 0.1,
    decorationDensity: 0.58,
    siteFlavors: ['civic', 'military', 'roadside'],
    encounterFlavors: ['patrol', 'fortified', 'territorial'],
  },
  forest: {
    id: 'forest',
    label: 'Зона эльфов',
    terrainColor: 0x45653d,
    secondaryColor: 0x284b31,
    accentColor: 0x75a862,
    weatherAffinity: ['rain', 'mist', 'breeze'],
    foliageDensity: 0.9,
    decorationDensity: 0.64,
    siteFlavors: ['wild', 'mystic', 'ruined'],
    encounterFlavors: ['woodland', 'road-ambush', 'territorial'],
  },
  fort: {
    id: 'fort',
    label: 'Зона злого',
    terrainColor: 0x554d50,
    secondaryColor: 0x312f35,
    accentColor: 0xb75b70,
    weatherAffinity: ['storm', 'ash', 'breeze'],
    foliageDensity: 0.06,
    decorationDensity: 0.72,
    siteFlavors: ['military', 'ruined', 'mystic'],
    encounterFlavors: ['fortified', 'raiders', 'territorial'],
  },
} as const satisfies Record<ZoneId, BiomeProfile>

export type SitePrefabShape =
  | 'camp'
  | 'keep'
  | 'houses'
  | 'stall'
  | 'shrine'
  | 'obelisk'
  | 'chest'
  | 'monument'

export interface SitePrefabParameters {
  shape: SitePrefabShape
  footprintWidth: number
  footprintDepth: number
  wallHeight: number
  roofHeight: number
  detailCount: number
  towerCount: number
  solid: boolean
}

export interface SitePresentation {
  kind: SiteKind
  label: string
  markerLabel: string
  prefab: Readonly<SitePrefabParameters>
}

export const SITE_PRESENTATIONS = {
  'faction-start': {
    kind: 'faction-start',
    label: 'Лагерь фракции',
    markerLabel: 'Лагерь',
    prefab: {
      shape: 'camp',
      footprintWidth: 7,
      footprintDepth: 5,
      wallHeight: 2.4,
      roofHeight: 1.5,
      detailCount: 3,
      towerCount: 0,
      solid: true,
    },
  },
  'final-stronghold': {
    kind: 'final-stronghold',
    label: 'Крепость противника',
    markerLabel: 'Крепость',
    prefab: {
      shape: 'keep',
      footprintWidth: 12,
      footprintDepth: 10,
      wallHeight: 6,
      roofHeight: 1,
      detailCount: 4,
      towerCount: 2,
      solid: true,
    },
  },
  settlement: {
    kind: 'settlement',
    label: 'Домики деревяные',
    markerLabel: 'Домики',
    prefab: {
      shape: 'houses',
      footprintWidth: 9,
      footprintDepth: 7,
      wallHeight: 3.3,
      roofHeight: 1.8,
      detailCount: 3,
      towerCount: 0,
      solid: true,
    },
  },
  shop: {
    kind: 'shop',
    label: 'Можно покупать и т. п.',
    markerLabel: 'Лавка',
    prefab: {
      shape: 'stall',
      footprintWidth: 5.5,
      footprintDepth: 4,
      wallHeight: 2.7,
      roofHeight: 1.2,
      detailCount: 3,
      towerCount: 0,
      solid: true,
    },
  },
  recovery: {
    kind: 'recovery',
    label: 'Лечение и протезы',
    markerLabel: 'Лечение',
    prefab: {
      shape: 'shrine',
      footprintWidth: 4,
      footprintDepth: 4,
      wallHeight: 2.5,
      roofHeight: 1.6,
      detailCount: 2,
      towerCount: 0,
      solid: false,
    },
  },
  event: {
    kind: 'event',
    label: 'Набег на кого-то',
    markerLabel: 'Набег',
    prefab: {
      shape: 'obelisk',
      footprintWidth: 3,
      footprintDepth: 3,
      wallHeight: 5,
      roofHeight: 0,
      detailCount: 3,
      towerCount: 0,
      solid: true,
    },
  },
  treasure: {
    kind: 'treasure',
    label: 'Тайник с добром',
    markerLabel: 'Тайник',
    prefab: {
      shape: 'chest',
      footprintWidth: 1.8,
      footprintDepth: 1.2,
      wallHeight: 1,
      roofHeight: 0.4,
      detailCount: 1,
      towerCount: 0,
      solid: false,
    },
  },
  landmark: {
    kind: 'landmark',
    label: '3-хмерный ориентир',
    markerLabel: 'Ориентир',
    prefab: {
      shape: 'monument',
      footprintWidth: 4.5,
      footprintDepth: 4.5,
      wallHeight: 7,
      roofHeight: 1,
      detailCount: 3,
      towerCount: 1,
      solid: true,
    },
  },
} as const satisfies Record<SiteKind, SitePresentation>

export interface SerializablePoint2 {
  x: number
  z: number
}

export interface GeneratedActorSpawnSpec {
  id: string
  encounterId: string
  faction: Faction
  role: ActorRole
  localX: number
  localZ: number
  worldX: number
  worldZ: number
  objective: boolean
  objectiveEligible: boolean
  unique: boolean
}

export type EncounterTerrain =
  | 'open-ground'
  | 'bridge-toll'
  | 'forest-crossfire'
  | 'settlement-siege'

export interface GeneratedEncounterPlan {
  id: string
  encounterId: string
  regionId: RegionId
  kind: EncounterKind
  difficulty: number
  hostileFaction: Faction
  hostileToPlayer: boolean
  flavor: EncounterFlavor
  /**
   * Roadmap 1.5 — what the square actually is, and therefore how the pack is arranged.
   *
   * Layout permutation on its own is isomorphic: a different river column is the same
   * campaign in a different place. What makes a place read as a place is the encounter
   * grammar, so a pack in a square with a bridge stands across the bridge, a pack in the
   * woods splits into two firing lines either side of the road, and a pack at a village
   * rings it with a heavy at the gate. `open-ground` is the pre-1.5 arrangement and is
   * still what most squares get.
   */
  terrain: EncounterTerrain
  ordinaryCount: number
  bossCount: number
  spawns: GeneratedActorSpawnSpec[]
}

const FACTION_RIVALS: Record<Faction, readonly Faction[]> = {
  elf: ['guard', 'villain'],
  guard: ['villain', 'elf'],
  villain: ['guard', 'elf'],
}

const ORDINARY_ROLES: Record<Faction, readonly ActorRole[]> = {
  elf: ['scout', 'archer', 'soldier'],
  guard: ['soldier', 'archer', 'soldier'],
  villain: ['minion', 'archer', 'brute'],
}

const ELITE_ROLES: Record<Faction, ActorRole> = {
  elf: 'champion',
  guard: 'brute',
  villain: 'brute',
}

const BOSS_ROLES: Record<Faction, ActorRole> = {
  elf: 'champion',
  guard: 'commander',
  villain: 'champion',
}

export function getBlueprintRegionBounds(
  blueprint: WorldBlueprint,
  regionOrId: WorldRegion | RegionId,
): { minX: number; maxX: number; minZ: number; maxZ: number } | undefined {
  const region =
    typeof regionOrId === 'string'
      ? blueprint.regions.find((candidate) => candidate.id === regionOrId)
      : regionOrId
  if (!region) return undefined
  const minX = blueprint.origin.x + region.coordinate.x * blueprint.regionSize
  const minZ = blueprint.origin.z + region.coordinate.y * blueprint.regionSize
  return {
    minX,
    maxX: minX + blueprint.regionSize,
    minZ,
    maxZ: minZ + blueprint.regionSize,
  }
}

export type RegionRiverLegDirection = 'north' | 'south' | 'east' | 'west'

export interface RegionRiverLeg {
  direction: RegionRiverLegDirection
  edge: SerializablePoint2
  center: SerializablePoint2
}

/**
 * Roadmap 1.5 — where the water actually runs inside one square.
 *
 * The macro river may now step sideways, so a square is no longer guaranteed to hold a
 * straight north-to-south band: it holds one leg from the edge it enters by to the square's
 * centre, and one from the centre to the edge it leaves by. For a square the river passes
 * straight through, the two legs are collinear and reproduce exactly the band that was
 * there before. Everything that has to know where the water is — the surface, the water
 * colliders, ground cover, site and encounter placement — reads it from here, so there is
 * one answer rather than five approximations of one.
 */
export function getRegionRiverLegs(
  blueprint: WorldBlueprint,
  regionOrId: WorldRegion | RegionId,
): RegionRiverLeg[] {
  const region =
    typeof regionOrId === 'string'
      ? blueprint.regions.find((candidate) => candidate.id === regionOrId)
      : regionOrId
  const bounds = region ? getBlueprintRegionBounds(blueprint, region) : undefined
  if (!region || !bounds) return []
  const index = blueprint.river.regionPath.indexOf(region.id)
  if (index < 0) return []

  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  }
  const neighbourDirection = (
    neighbourId: string | undefined,
  ): RegionRiverLegDirection | undefined => {
    const neighbour = blueprint.regions.find((candidate) => candidate.id === neighbourId)
    if (!neighbour) return undefined
    const deltaX = neighbour.coordinate.x - region.coordinate.x
    const deltaY = neighbour.coordinate.y - region.coordinate.y
    if (deltaX === 1 && deltaY === 0) return 'east'
    if (deltaX === -1 && deltaY === 0) return 'west'
    if (deltaX === 0 && deltaY === 1) return 'south'
    if (deltaX === 0 && deltaY === -1) return 'north'
    return undefined
  }
  const edgeOf = (direction: RegionRiverLegDirection): SerializablePoint2 => {
    if (direction === 'east') return { x: bounds.maxX, z: center.z }
    if (direction === 'west') return { x: bounds.minX, z: center.z }
    if (direction === 'north') return { x: center.x, z: bounds.minZ }
    return { x: center.x, z: bounds.maxZ }
  }

  const entry =
    neighbourDirection(blueprint.river.regionPath[index - 1]) ?? 'north'
  const exit = neighbourDirection(blueprint.river.regionPath[index + 1]) ?? 'south'
  return [entry, exit].map((direction) => ({
    direction,
    edge: edgeOf(direction),
    center,
  }))
}

/**
 * Distance from a point to the water running through its square, or `Infinity` if the
 * river does not pass through it at all.
 *
 * Measured to the legs as line segments rather than to an axis-aligned box, because the
 * thing callers actually need is clearance: a point just past the end of the north leg is
 * three units from the water even though no box contains it, and an encounter that spawns
 * its ring of actors around such a point drops half of them in the river.
 */
export function distanceToRegionRiver(
  blueprint: WorldBlueprint,
  regionOrId: WorldRegion | RegionId,
  x: number,
  z: number,
): number {
  const legs = getRegionRiverLegs(blueprint, regionOrId)
  let closest = Number.POSITIVE_INFINITY
  for (const leg of legs) {
    closest = Math.min(closest, distanceToSegment(x, z, leg.edge, leg.center))
  }
  return closest
}

export function isInsideRegionRiver(
  blueprint: WorldBlueprint,
  regionOrId: WorldRegion | RegionId,
  x: number,
  z: number,
  halfWidth: number,
): boolean {
  return distanceToRegionRiver(blueprint, regionOrId, x, z) < halfWidth
}

/**
 * Half the water band and the width of the hole a bridge opens in it, mirroring
 * `GeneratedWorldRuntime`'s default `riverWidth` of 10 and `bridgeWidth` of 6.
 *
 * The blueprint carries no widths — they are a runtime style — so anything that has to keep
 * an actor out of the water restates the defaults, exactly as the site and encounter
 * clearances already do.
 */
const RIVER_HALF_WIDTH = 5
const BRIDGE_GAP = 7.5

/**
 * Whether a point is inside the water *collider* rather than the water surface.
 *
 * The difference is the bridge: a square with a crossing has the middle of its band open,
 * which is the one place a toll can stand on the water and still be standing on something.
 */
export function isInsideRegionWater(
  blueprint: WorldBlueprint,
  regionOrId: WorldRegion | RegionId,
  x: number,
  z: number,
  radius = 0,
): boolean {
  for (const leg of blockingRiverLegs(blueprint, regionOrId)) {
    if (distanceToSegment(x, z, leg.from, leg.to) < RIVER_HALF_WIDTH + radius) return true
  }
  return false
}

function blockingRiverLegs(
  blueprint: WorldBlueprint,
  regionOrId: WorldRegion | RegionId,
): { from: SerializablePoint2; to: SerializablePoint2 }[] {
  const legs = getRegionRiverLegs(blueprint, regionOrId)
  if (legs.length === 0) return []
  const regionId = typeof regionOrId === 'string' ? regionOrId : regionOrId.id
  const inset = blueprint.bridges.some((bridge) => bridge.regionId === regionId)
    ? BRIDGE_GAP / 2
    : 0
  return legs.map((leg) => {
    const deltaX = leg.center.x - leg.edge.x
    const deltaZ = leg.center.z - leg.edge.z
    const length = Math.hypot(deltaX, deltaZ)
    const scale = length > inset ? (length - inset) / length : 0
    return {
      from: leg.edge,
      to: { x: leg.edge.x + deltaX * scale, z: leg.edge.z + deltaZ * scale },
    }
  })
}

/** Move a point off the water along the shortest way out, or leave it where it is. */
function pushOutOfWater(
  blueprint: WorldBlueprint,
  regionOrId: WorldRegion | RegionId,
  point: SerializablePoint2,
  clearance: number,
): SerializablePoint2 {
  const legs = blockingRiverLegs(blueprint, regionOrId)
  if (legs.length === 0) return point
  let result = point
  for (let pass = 0; pass < 3; pass += 1) {
    let nearest: { distance: number; closest: SerializablePoint2 } | undefined
    for (const leg of legs) {
      const closest = closestPointOnSegment(result, leg.from, leg.to)
      const distance = Math.hypot(result.x - closest.x, result.z - closest.z)
      if (!nearest || distance < nearest.distance) nearest = { distance, closest }
    }
    if (!nearest || nearest.distance >= clearance) break
    const deltaX = result.x - nearest.closest.x
    const deltaZ = result.z - nearest.closest.z
    const length = Math.hypot(deltaX, deltaZ)
    const unitX = length > 0.001 ? deltaX / length : 1
    const unitZ = length > 0.001 ? deltaZ / length : 0
    result = {
      x: nearest.closest.x + unitX * clearance,
      z: nearest.closest.z + unitZ * clearance,
    }
  }
  return result
}

function closestPointOnSegment(
  point: SerializablePoint2,
  start: SerializablePoint2,
  end: SerializablePoint2,
): SerializablePoint2 {
  const deltaX = end.x - start.x
  const deltaZ = end.z - start.z
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ
  if (lengthSquared <= Number.EPSILON) return start
  const projected = clamp(
    ((point.x - start.x) * deltaX + (point.z - start.z) * deltaZ) / lengthSquared,
    0,
    1,
  )
  return { x: start.x + deltaX * projected, z: start.z + deltaZ * projected }
}

function distanceToSegment(
  x: number,
  z: number,
  start: SerializablePoint2,
  end: SerializablePoint2,
): number {
  const deltaX = end.x - start.x
  const deltaZ = end.z - start.z
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ
  if (lengthSquared <= Number.EPSILON) return Math.hypot(x - start.x, z - start.z)
  const projected = clamp(
    ((x - start.x) * deltaX + (z - start.z) * deltaZ) / lengthSquared,
    0,
    1,
  )
  return Math.hypot(x - (start.x + deltaX * projected), z - (start.z + deltaZ * projected))
}

export function getSiteWorldPosition2D(
  blueprint: WorldBlueprint,
  siteOrId: WorldSite | string,
): SerializablePoint2 | undefined {
  const site =
    typeof siteOrId === 'string'
      ? blueprint.sites.find((candidate) => candidate.id === siteOrId)
      : siteOrId
  if (!site) return undefined
  const region = blueprint.regions.find((candidate) => candidate.id === site.regionId)
  const bounds = region ? getBlueprintRegionBounds(blueprint, region) : undefined
  if (!region || !bounds) return undefined

  const regionSites = blueprint.sites
    .filter((candidate) => candidate.regionId === region.id)
    .sort((first, second) => first.id.localeCompare(second.id))
  const index = Math.max(
    0,
    regionSites.findIndex((candidate) => candidate.id === site.id),
  )
  const count = Math.max(1, regionSites.length)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const radius = Math.min(18, blueprint.regionSize * 0.23)
  const baseAngle =
    keyedRandom(blueprint.seed, `site-layout:${region.id}`) * Math.PI * 2
  const angle = baseAngle + (index * Math.PI * 2) / count
  let localX = Math.cos(angle) * radius
  let localZ = Math.sin(angle) * radius

  // Roadmap 1.5 — the river may now turn inside a square, so being clear of it is no
  // longer "far enough in x". Push off the leg that is in the way, on the axis that leg
  // runs across.
  const side = keyedRandom(blueprint.seed, `site-river-bank:${site.id}`) < 0.5 ? -1 : 1
  const offset = Math.max(11, radius * 0.75)
  if (isInsideRegionRiver(blueprint, region, centerX + localX, centerZ + localZ, 9)) {
    localX = side * offset
  }
  if (isInsideRegionRiver(blueprint, region, centerX + localX, centerZ + localZ, 9)) {
    localZ = side * offset
  }

  const margin = Math.min(10, blueprint.regionSize * 0.2)
  return {
    x: clamp(centerX + localX, bounds.minX + margin, bounds.maxX - margin),
    z: clamp(centerZ + localZ, bounds.minZ + margin, bounds.maxZ - margin),
  }
}

export function chooseHostileFaction(
  blueprint: WorldBlueprint,
  slot: EncounterSlot,
  playerFaction: Faction,
): Faction {
  const region = blueprint.regions.find((candidate) => candidate.id === slot.regionId)
  const site = slot.siteId
    ? blueprint.sites.find((candidate) => candidate.id === slot.siteId)
    : undefined
  const territorialFaction = hostileTerritory(site?.owner ?? region?.territory, playerFaction)
  if (territorialFaction) return territorialFaction

  const rivals = FACTION_RIVALS[playerFaction]
  const index = Math.floor(
    keyedRandom(
      blueprint.seed,
      `encounter-faction:${slot.id}:${playerFaction}`,
    ) * rivals.length,
  )
  return rivals[Math.min(index, rivals.length - 1)]
}

export function createGeneratedEncounterPlan(
  blueprint: WorldBlueprint,
  slot: EncounterSlot,
  playerFaction: Faction,
): GeneratedEncounterPlan {
  const region = blueprint.regions.find((candidate) => candidate.id === slot.regionId)
  const bounds = region ? getBlueprintRegionBounds(blueprint, region) : undefined
  if (!region || !bounds) {
    throw new Error(`Encounter ${slot.id} refers to unknown region ${slot.regionId}`)
  }

  const stream = new RandomStream(
    deriveSeed(
      blueprint.seed,
      `encounter-plan:${slot.id}:player:${playerFaction}`,
    ),
  )
  const hostileToPlayer = slot.hostileTo.includes(playerFaction)
  const encounterFaction = hostileToPlayer
    ? chooseHostileFaction(blueprint, slot, playerFaction)
    : playerFaction
  const difficulty = Math.max(1, Math.min(5, Math.floor(slot.difficulty)))
  const actorCount =
    slot.kind === 'boss'
      ? 3
      : Math.min(
          4,
          2 +
            Math.floor((difficulty - 1) / 2) +
            (slot.kind === 'ambush' && stream.chance(0.35) ? 1 : 0),
        )
  const sitePosition = slot.siteId
    ? getSiteWorldPosition2D(blueprint, slot.siteId)
    : undefined
  const center = encounterCenter(
    blueprint,
    region,
    bounds,
    slot,
    stream,
    sitePosition,
  )
  const biomeProfile = BIOME_PROFILES[region.biome]
  const flavor = stream.pick(biomeProfile.encounterFlavors)
  const terrain = chooseEncounterTerrain(blueprint, region, slot)
  const stations = composeTerrainStations({
    terrain,
    blueprint,
    region,
    bounds,
    center,
    stream,
    actorCount,
  })
  const spawns: GeneratedActorSpawnSpec[] = []

  for (let index = 0; index < actorCount; index += 1) {
    const isBoss = slot.kind === 'boss' && index === 0
    const isElite = slot.kind === 'elite' && index === 0
    const station = stations[index]
    const role = isBoss
      ? BOSS_ROLES[encounterFaction]
      : isElite || station.post === 'lead'
        ? ELITE_ROLES[encounterFaction]
        : station.post === 'shooter'
          ? 'archer'
          : stream.pick(ORDINARY_ROLES[encounterFaction])
    const worldX = clamp(station.x, bounds.minX + 6, bounds.maxX - 6)
    const worldZ = clamp(station.z, bounds.minZ + 6, bounds.maxZ - 6)
    const dry = pushOutOfWater(
      blueprint,
      region,
      { x: worldX, z: worldZ },
      // The agent radius plus a little: an actor that materialises in the river cannot
      // move, and no keep-out drops a water collider the way one drops a wall.
      RIVER_HALF_WIDTH + 1.2,
    )
    const objective = isBoss
    spawns.push({
      id: `${slot.id}:actor:${index}`,
      encounterId: slot.id,
      faction: encounterFaction,
      role,
      localX: dry.x - (bounds.minX + bounds.maxX) / 2,
      localZ: dry.z - (bounds.minZ + bounds.maxZ) / 2,
      worldX: dry.x,
      worldZ: dry.z,
      objective,
      objectiveEligible: objective,
      unique: isBoss,
    })
  }

  return {
    id: slot.id,
    encounterId: slot.id,
    regionId: slot.regionId,
    kind: slot.kind,
    difficulty,
    hostileFaction: encounterFaction,
    hostileToPlayer,
    flavor,
    terrain,
    ordinaryCount: slot.kind === 'boss' ? actorCount - 1 : actorCount,
    bossCount: slot.kind === 'boss' ? 1 : 0,
    spawns,
  }
}

export function createGeneratedEncounterPlans(
  blueprint: WorldBlueprint,
  playerFaction: Faction,
): Record<string, GeneratedEncounterPlan> {
  const plans: Record<string, GeneratedEncounterPlan> = {}
  for (const slot of blueprint.encounters) {
    plans[slot.id] = createGeneratedEncounterPlan(
      blueprint,
      slot,
      playerFaction,
    )
  }
  return plans
}

export const generateEncounterPlan = createGeneratedEncounterPlan
export const generateEncounterPlans = createGeneratedEncounterPlans

/** Site kinds that put buildings and a perimeter on the ground worth besieging. */
const SIEGEABLE_SITE_KINDS: readonly SiteKind[] = [
  'settlement',
  'shop',
  'recovery',
  'faction-start',
]

/**
 * Half the water band, mirroring `GeneratedWorldRuntime`'s default `riverWidth` of 10.
 *
 * The blueprint carries no widths — they are a runtime style — so the affordance geometry
 * that has to keep actors out of the river restates the default, exactly as the site and
 * encounter clearances above already do.
 */
interface EncounterStation extends SerializablePoint2 {
  /** `lead` takes the faction's elite role, `shooter` an archer, `ordinary` a draw. */
  post: 'lead' | 'shooter' | 'ordinary'
}/**
 * Roadmap 1.5 — which template a square earns, read off what is actually in it.
 *
 * Ordered rather than drawn: a square with a bridge is a crossing before it is anything
 * else, a square with a village is a village, and the woods are the fallback that still
 * has a shape. Bosses keep the plain arrangement — a stronghold fight is already staged by
 * the stronghold.
 */
export function chooseEncounterTerrain(
  blueprint: WorldBlueprint,
  region: WorldRegion,
  slot: EncounterSlot,
): EncounterTerrain {
  if (slot.kind === 'boss') return 'open-ground'
  if (blueprint.bridges.some((bridge) => bridge.regionId === region.id)) {
    return 'bridge-toll'
  }
  if (
    blueprint.sites.some(
      (site) => site.regionId === region.id && SIEGEABLE_SITE_KINDS.includes(site.kind),
    )
  ) {
    return 'settlement-siege'
  }
  if (region.biome === 'forest') return 'forest-crossfire'
  return 'open-ground'
}

function composeTerrainStations(options: {
  terrain: EncounterTerrain
  blueprint: WorldBlueprint
  region: WorldRegion
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  center: SerializablePoint2
  stream: RandomStream
  actorCount: number
}): EncounterStation[] {
  const { terrain, blueprint, region, bounds, center, stream, actorCount } = options
  const regionCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  }

  if (terrain === 'bridge-toll') {
    // A toll is collected at the mouth of the deck, not in a field nearby. One collector
    // stands on the crossing itself — the bridge gap is the one strip of the square's
    // centre that is not water — and the rest hold the bank behind them, spread across the
    // road so walking round costs the player the same water it always did.
    const side = stream.chance(0.5) ? -1 : 1
    const stations: EncounterStation[] = [
      { x: regionCenter.x + side * 2.4, z: regionCenter.z, post: 'lead' },
    ]
    for (let index = 1; index < actorCount; index += 1) {
      const rank = index - 1
      stations.push({
        x: regionCenter.x + side * (RIVER_HALF_WIDTH + 5 + rank * 2.6),
        z: regionCenter.z + (rank % 2 === 0 ? 1 : -1) * (3.2 + rank * 1.4),
        post: rank === 0 ? 'shooter' : 'ordinary',
      })
    }
    return stations
  }

  if (terrain === 'settlement-siege') {
    const site = blueprint.sites
      .filter(
        (candidate) =>
          candidate.regionId === region.id && SIEGEABLE_SITE_KINDS.includes(candidate.kind),
      )
      .sort((first, second) => first.id.localeCompare(second.id))[0]
    const anchor = site ? getSiteWorldPosition2D(blueprint, site.id) : undefined
    const target = anchor ?? center
    // A ring facing in, opened toward the road so the player walks into the siege rather
    // than behind it. The heavy takes the gate.
    const gateAngle = Math.atan2(regionCenter.z - target.z, regionCenter.x - target.x)
    const stations: EncounterStation[] = []
    for (let index = 0; index < actorCount; index += 1) {
      const spread = ((index - (actorCount - 1) / 2) * Math.PI) / 3.2
      const radius = index === 0 ? 12 : stream.range(14, 19)
      const angle = gateAngle + spread
      stations.push({
        x: target.x + Math.cos(angle) * radius,
        z: target.z + Math.sin(angle) * radius,
        post: index === 0 ? 'lead' : index === actorCount - 1 ? 'shooter' : 'ordinary',
      })
    }
    return stations
  }

  if (terrain === 'forest-crossfire') {
    // Two firing lines either side of the lane the road makes through the trees, staggered
    // so the player is between them rather than in front of them.
    const alongZ = regionRoadRunsNorthSouth(blueprint, region)
    const stations: EncounterStation[] = []
    for (let index = 0; index < actorCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1
      const offset = side * stream.range(9, 13)
      const along = (Math.floor(index / 2) - 0.5) * 11 + stream.range(-2, 2)
      stations.push({
        x: center.x + (alongZ ? offset : along),
        z: center.z + (alongZ ? along : offset),
        post: index < 2 ? 'shooter' : 'ordinary',
      })
    }
    return stations
  }

  const stations: EncounterStation[] = []
  for (let index = 0; index < actorCount; index += 1) {
    const angle = stream.range(0, Math.PI * 2) + (index * Math.PI * 2) / actorCount
    const radius = index === 0 ? 1.5 : stream.range(3.2, 6.2)
    stations.push({
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
      post: 'ordinary',
    })
  }
  return stations
}

function regionRoadRunsNorthSouth(blueprint: WorldBlueprint, region: WorldRegion): boolean {
  const regionById = new Map(blueprint.regions.map((entry) => [entry.id, entry]))
  let northSouth = 0
  let eastWest = 0
  for (const segment of blueprint.roads.segments) {
    const otherId =
      segment.fromRegionId === region.id
        ? segment.toRegionId
        : segment.toRegionId === region.id
          ? segment.fromRegionId
          : undefined
    const other = otherId ? regionById.get(otherId) : undefined
    if (!other) continue
    if (other.coordinate.x === region.coordinate.x) northSouth += 1
    else eastWest += 1
  }
  return northSouth >= eastWest
}

function encounterCenter(
  blueprint: WorldBlueprint,
  region: WorldRegion,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  slot: EncounterSlot,
  stream: RandomStream,
  sitePosition?: SerializablePoint2,
): SerializablePoint2 {
  if (sitePosition) {
    const angle =
      keyedRandom(blueprint.seed, `encounter-site-offset:${slot.id}`) *
      Math.PI *
      2
    return {
      x: sitePosition.x + Math.cos(angle) * 8,
      z: sitePosition.z + Math.sin(angle) * 8,
    }
  }

  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  // Half the river plus the widest spawn ring below, so the actors placed around this
  // centre land on a bank rather than in the water.
  const clearance = 12
  let localX = stream.range(-18, 18)
  let localZ = stream.range(-18, 18)
  if (isInsideRegionRiver(blueprint, region, centerX + localX, centerZ + localZ, clearance)) {
    localX = (stream.chance(0.5) ? -1 : 1) * stream.range(13, 20)
  }
  if (isInsideRegionRiver(blueprint, region, centerX + localX, centerZ + localZ, clearance)) {
    localZ = (stream.chance(0.5) ? -1 : 1) * stream.range(13, 20)
  }
  return { x: centerX + localX, z: centerZ + localZ }
}

function hostileTerritory(
  territory: Territory | undefined,
  playerFaction: Faction,
): Faction | undefined {
  return territory && territory !== 'neutral' && territory !== playerFaction
    ? territory
    : undefined
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export const GENERATED_WORLD_FACTIONS = WORLD_FACTIONS
