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

export interface GeneratedEncounterPlan {
  id: string
  encounterId: string
  regionId: RegionId
  kind: EncounterKind
  difficulty: number
  hostileFaction: Faction
  hostileToPlayer: boolean
  flavor: EncounterFlavor
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
  const localZ = Math.sin(angle) * radius

  if (
    blueprint.river.regionPath.includes(region.id) &&
    Math.abs(localX) < 9
  ) {
    const side =
      keyedRandom(blueprint.seed, `site-river-bank:${site.id}`) < 0.5 ? -1 : 1
    localX = side * Math.max(11, radius * 0.75)
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
  const spawns: GeneratedActorSpawnSpec[] = []

  for (let index = 0; index < actorCount; index += 1) {
    const isBoss = slot.kind === 'boss' && index === 0
    const isElite = slot.kind === 'elite' && index === 0
    const role = isBoss
      ? BOSS_ROLES[encounterFaction]
      : isElite
        ? ELITE_ROLES[encounterFaction]
        : stream.pick(ORDINARY_ROLES[encounterFaction])
    const angle =
      stream.range(0, Math.PI * 2) + (index * Math.PI * 2) / actorCount
    const radius = index === 0 ? 1.5 : stream.range(3.2, 6.2)
    const worldX = clamp(
      center.x + Math.cos(angle) * radius,
      bounds.minX + 6,
      bounds.maxX - 6,
    )
    const worldZ = clamp(
      center.z + Math.sin(angle) * radius,
      bounds.minZ + 6,
      bounds.maxZ - 6,
    )
    const objective = isBoss
    spawns.push({
      id: `${slot.id}:actor:${index}`,
      encounterId: slot.id,
      faction: encounterFaction,
      role,
      localX: worldX - (bounds.minX + bounds.maxX) / 2,
      localZ: worldZ - (bounds.minZ + bounds.maxZ) / 2,
      worldX,
      worldZ,
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
  let localX = stream.range(-18, 18)
  const localZ = stream.range(-18, 18)
  if (blueprint.river.regionPath.includes(region.id) && Math.abs(localX) < 11) {
    localX = (stream.chance(0.5) ? -1 : 1) * stream.range(13, 20)
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
