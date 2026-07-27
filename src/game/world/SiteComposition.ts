import { artVariation, type ArtVariation } from '../art/index.ts'
import type { FenceStyle, RoofStyle, WallStyle } from '../art/index.ts'
import { SITE_PRESENTATIONS } from '../content/registry.ts'
import type { ZoneId } from '../types.ts'
import type { SiteKind, Territory } from './worldTypes.ts'

/**
 * What a place is made of.
 *
 * A site used to be one box with a roof on it. This module answers the question the
 * box never did: *what is actually here?* A settlement is four houses around a well
 * with a fence and a gate on the road side; a shop is a building, a stall, crates
 * and a sign; a stronghold is a keep inside a curtain wall with towers and banners.
 *
 * It is deliberately pure. No `three`, no geometry, no scene — layouts are plain
 * numbers, so they can be asserted in a Node test, replayed for determinism and
 * consumed by both the near and the far level of the same site without building
 * anything twice.
 *
 * Site-local space: **+Z is outward from the region centre**, which is where the
 * site prefab is rotated to face, so the *approach* — and therefore the front of
 * everything the player walks up to — is **-Z**.
 */

export type BuildingArchetype = 'house' | 'hall' | 'shop' | 'hut' | 'keep'

export interface BuildingSpec {
  archetype: BuildingArchetype
  wallStyle: WallStyle
  roofStyle: RoofStyle
  width: number
  depth: number
  wallHeight: number
  storeys: number
  windows: number
  chimney: boolean
  porch: boolean
  balcony: boolean
  crenellated: boolean
  /** Selects the shared art variation, and therefore the cached buffer. */
  variant: number
}

export type SitePropKind =
  | 'banner'
  | 'barrel'
  | 'brazier'
  | 'cairn'
  | 'cart'
  | 'chest'
  | 'crate'
  | 'gate'
  | 'lantern'
  | 'monument'
  | 'obelisk'
  | 'pillar'
  | 'shrine'
  | 'signboard'
  | 'stall'
  | 'tent'
  | 'tower'
  | 'washing-line'
  | 'waystone'
  | 'well'
  | 'woodpile'

export interface SiteBuildingPlacement {
  id: string
  spec: BuildingSpec
  x: number
  z: number
  rotation: number
  /** Collision radius. `0` means the building does not block movement. */
  radius: number
}

export interface SitePropPlacement {
  id: string
  kind: SitePropKind
  variant: number
  x: number
  z: number
  rotation: number
  scale: number
  radius: number
  /** Length along +X, for props that span a distance (walls, gates). */
  length?: number
}

export interface SiteFencePlacement {
  id: string
  style: FenceStyle
  x: number
  z: number
  rotation: number
  length: number
}

export interface SiteLayout {
  buildings: SiteBuildingPlacement[]
  props: SitePropPlacement[]
  fences: SiteFencePlacement[]
  /**
   * Radius of the walkable clearing a site occupies, used to keep dressing and
   * ground cover from growing through a village.
   */
  clearingRadius: number
}

export interface SiteLayoutInput {
  siteId: string
  kind: SiteKind
  owner: Territory
  biome: ZoneId
  seed: number | string
}

interface TerritoryStyle {
  wallStyle: WallStyle
  roofStyle: RoofStyle
  fence: FenceStyle
  /** Proportion multiplier: elves build tall and thin, the fort builds low and wide. */
  slenderness: number
  crenellated: boolean
}

/**
 * Architecture as characterisation.
 *
 * The player should be able to tell whose ground they are standing on before they
 * see a banner, and the cheapest way to do that is to give each faction a different
 * way of holding a wall up.
 */
const TERRITORY_STYLES: Record<Territory, TerritoryStyle> = {
  elf: {
    wallStyle: 'timber-frame',
    roofStyle: 'thatch',
    fence: 'picket',
    slenderness: 1.18,
    crenellated: false,
  },
  guard: {
    wallStyle: 'stone',
    roofStyle: 'tile',
    fence: 'iron',
    slenderness: 1,
    crenellated: true,
  },
  villain: {
    wallStyle: 'log',
    roofStyle: 'shingle',
    fence: 'palisade',
    slenderness: 0.86,
    crenellated: true,
  },
  neutral: {
    wallStyle: 'plank',
    roofStyle: 'thatch',
    fence: 'rail',
    slenderness: 1,
    crenellated: false,
  },
}

const BUILDING_VARIANTS = 2
const PROP_VARIANTS = 2

/**
 * Composes a site into buildings, props and fences.
 *
 * Deterministic in `(seed, siteId)`: the same world always produces the same
 * village, and two villages in the same world are laid out differently.
 */
export function composeSiteLayout(input: SiteLayoutInput): SiteLayout {
  const variation = artVariation(input.seed, `site:${input.siteId}`)
  const prefab = SITE_PRESENTATIONS[input.kind].prefab
  const style = TERRITORY_STYLES[input.owner]
  const context: LayoutContext = {
    variation,
    style,
    owner: input.owner,
    biome: input.biome,
    width: prefab.footprintWidth,
    depth: prefab.footprintDepth,
    wallHeight: prefab.wallHeight,
    detailCount: prefab.detailCount,
    towerCount: prefab.towerCount,
    anchorZ: -(prefab.footprintDepth / 2 + 2.5),
  }
  switch (input.kind) {
    case 'settlement':
      return keepApproachWalkable(context, composeSettlement(context))
    case 'shop':
      return keepApproachWalkable(context, composeShop(context))
    case 'faction-start':
      return keepApproachWalkable(context, composeCamp(context))
    case 'final-stronghold':
      return keepApproachWalkable(context, composeStronghold(context))
    case 'recovery':
      return keepApproachWalkable(context, composeShrine(context))
    case 'event':
      return keepApproachWalkable(context, composeEventSite(context))
    case 'treasure':
      return keepApproachWalkable(context, composeTreasure(context))
    default:
      return keepApproachWalkable(context, composeLandmark(context))
  }
}

/**
 * Last line of defence for the site's own destination.
 *
 * Every layout already places its solid pieces off the approach deliberately, so in
 * practice this changes nothing. It exists because the failure it guards against is
 * silent and severe: an objective that says "reach the settlement" pointing at a
 * spot the pathfinder rejects. A building that would cover it is dropped; a prop is
 * demoted to decoration rather than losing its art.
 */
function keepApproachWalkable(
  context: LayoutContext,
  layout: SiteLayout,
): SiteLayout {
  const margin = 0.8
  const blocks = (x: number, z: number, radius: number): boolean =>
    Math.hypot(x, z - context.anchorZ) <= radius + margin ||
    (z <= context.anchorZ && Math.abs(x) <= radius + margin)
  return {
    ...layout,
    buildings: layout.buildings.filter(
      (entry) => !blocks(entry.x, entry.z, entry.radius),
    ),
    props: layout.props.map((entry) =>
      entry.radius >= 0.5 && blocks(entry.x, entry.z, entry.radius * entry.scale)
        ? { ...entry, radius: 0 }
        : entry,
    ),
  }
}

interface LayoutContext {
  variation: ArtVariation
  style: TerritoryStyle
  owner: Territory
  biome: ZoneId
  width: number
  depth: number
  wallHeight: number
  detailCount: number
  towerCount: number
  /**
   * Local Z of the site's canonical position — the objective marker, the pathfinding
   * destination and the interaction point.
   *
   * `GeneratedWorldRuntime` places the site group `footprintDepth / 2 + 2.5` *past*
   * the anchor along the outward radial, so in layout space the anchor sits that far
   * back down -Z. Nothing solid may cover it: a building parked on top of it makes
   * "reach the settlement" an objective the player cannot complete.
   */
  anchorZ: number
}

/**
 * Keep-out margin around the site anchor and the corridor leading to it.
 *
 * Sized for what actually has to fit — the 0.45-radius agent plus a comfortable
 * margin — rather than generously. An over-large keep-out on a settlement's 5.6-unit
 * house ring rejects more candidate positions than it can relocate, and a village
 * quietly loses half its houses.
 */
const ANCHOR_CLEARANCE = 1.6

function buildingSpec(
  context: LayoutContext,
  archetype: BuildingArchetype,
  overrides: Partial<BuildingSpec> = {},
): BuildingSpec {
  const style = context.style
  const variation = context.variation
  const base = ARCHETYPE_SIZES[archetype]
  const width = quantize(base.width * variation.around(1, 0.09))
  const depth = quantize(base.depth * variation.around(1, 0.09))
  const wallHeight = quantize(
    base.wallHeight * style.slenderness * variation.around(1, 0.07),
  )
  return {
    archetype,
    wallStyle: style.wallStyle,
    roofStyle: style.roofStyle,
    width,
    depth,
    wallHeight,
    storeys: base.storeys,
    windows: base.windows,
    chimney: base.chimney,
    porch: base.porch,
    balcony: base.balcony && style.slenderness > 1,
    crenellated: style.crenellated && archetype === 'keep',
    variant: variation.integer(0, BUILDING_VARIANTS),
    ...overrides,
  }
}

const ARCHETYPE_SIZES: Record<
  BuildingArchetype,
  {
    width: number
    depth: number
    wallHeight: number
    storeys: number
    windows: number
    chimney: boolean
    porch: boolean
    balcony: boolean
  }
> = {
  house: {
    width: 4.4,
    depth: 3.4,
    wallHeight: 2.7,
    storeys: 1,
    windows: 2,
    chimney: true,
    porch: false,
    balcony: false,
  },
  hall: {
    width: 7.2,
    depth: 4.6,
    wallHeight: 3.4,
    storeys: 2,
    windows: 3,
    chimney: true,
    porch: true,
    balcony: true,
  },
  shop: {
    width: 5,
    depth: 3.8,
    wallHeight: 2.9,
    storeys: 1,
    windows: 2,
    chimney: false,
    porch: true,
    balcony: false,
  },
  hut: {
    width: 3,
    depth: 2.6,
    wallHeight: 2.1,
    storeys: 1,
    windows: 1,
    chimney: true,
    porch: false,
    balcony: false,
  },
  keep: {
    width: 9,
    depth: 7.4,
    wallHeight: 3.9,
    storeys: 2,
    windows: 3,
    chimney: false,
    porch: false,
    balcony: false,
  },
}

/** Rounds to a quarter unit so two similar buildings share one cached buffer. */
function quantize(value: number): number {
  return Math.round(value * 4) / 4
}

/** A stable key for the geometry a spec describes. */
export function buildingSpecKey(
  spec: BuildingSpec,
  biome: ZoneId,
  owner: Territory,
): string {
  return [
    'building',
    biome,
    owner,
    spec.archetype,
    spec.wallStyle,
    spec.roofStyle,
    spec.width.toFixed(2),
    spec.depth.toFixed(2),
    spec.wallHeight.toFixed(2),
    String(spec.storeys),
    String(spec.windows),
    spec.chimney ? 'c' : '-',
    spec.porch ? 'p' : '-',
    spec.balcony ? 'b' : '-',
    spec.crenellated ? 'm' : '-',
    String(spec.variant),
  ].join(':')
}

/** Faces a building at `angle` on a ring back towards the middle of the site. */
function facingCentre(angle: number): number {
  return Math.atan2(-Math.cos(angle), -Math.sin(angle))
}

/** Ring angle that points straight down the approach, towards the road. */
const APPROACH_ANGLE = -Math.PI / 2

/** Half-width of the arc kept clear of buildings on the approach side. */
const APPROACH_GAP = 0.85

/**
 * True when a circle at `(x, z)` leaves both the site anchor and the corridor
 * leading to it walkable.
 *
 * The corridor is the segment from well outside the site up to the anchor along the
 * approach, so a player or a pathfinder can always reach the point the objective and
 * the map marker both name.
 */
function clearsApproach(
  context: LayoutContext,
  x: number,
  z: number,
  radius: number,
): boolean {
  const clearance = radius + ANCHOR_CLEARANCE
  if (Math.hypot(x, z - context.anchorZ) < clearance) return false
  // Corridor: anything between the anchor and the outside world, within a lane.
  if (z <= context.anchorZ && Math.abs(x) < clearance) return false
  return true
}

function composeSettlement(context: LayoutContext): SiteLayout {
  const variation = context.variation
  const buildings: SiteBuildingPlacement[] = []
  const props: SitePropPlacement[] = []
  const fences: SiteFencePlacement[] = []
  const houseCount = variation.integer(3, 6)
  const ring = Math.max(context.width, context.depth) * 0.62

  for (let index = 0; index < houseCount; index += 1) {
    // Houses fill the arc that does *not* face the road. The village opens towards
    // the approach — which is how villages actually work, and which keeps the site's
    // canonical position and the corridor from the gate to it free of buildings.
    const base =
      APPROACH_ANGLE +
      APPROACH_GAP +
      (index / houseCount) * (Math.PI * 2 - APPROACH_GAP * 2)
    const archetype: BuildingArchetype =
      index === 0 ? 'hall' : variation.chance(0.3) ? 'hut' : 'house'
    const spec = buildingSpec(context, archetype)
    const radius = Math.max(spec.width, spec.depth) * 0.44
    const jitter = variation.signed(0.24)
    const distance = ring * variation.range(0.86, 1.18)
    // Nudge around the arc rather than giving up. A dropped house is a hole in the
    // village; a house fifteen degrees further round is a village.
    //
    // Nearest offset first, alternating sides: 0, -15, +15, -30, +30, -45. Scaling
    // the step by the attempt index instead walked out one side at a time and never
    // tried +15 at all, so a house blocked by a hair was moved four times further
    // than it needed to be, always in the same direction.
    let angle = base + jitter
    let placed = false
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const step = Math.ceil(attempt / 2) * 0.26
      const candidate = base + jitter + (attempt % 2 === 0 ? step : -step)
      if (
        clearsApproach(
          context,
          Math.cos(candidate) * distance,
          Math.sin(candidate) * distance,
          radius,
        )
      ) {
        angle = candidate
        placed = true
        break
      }
    }
    if (!placed) continue
    buildings.push({
      id: `house-${String(index)}`,
      spec,
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      rotation: facingCentre(angle) + variation.signed(0.16),
      radius,
    })
  }

  props.push(prop(context, 'well', 'well', 0, 0, 0.95))
  props.push(
    prop(context, 'cart', 'cart', ring * 0.42, ring * 0.36, 0.6, {
      rotation: variation.angle(),
    }),
  )
  props.push(
    prop(context, 'woodpile', 'woodpile', -ring * 0.5, ring * 0.3, 0.7, {
      rotation: variation.angle(),
    }),
  )
  props.push(
    prop(context, 'washing', 'washing-line', -ring * 0.36, -ring * 0.52, 0.4, {
      rotation: variation.angle(),
    }),
  )
  props.push(prop(context, 'lantern', 'lantern', ring * 0.24, -ring * 0.3, 0.3))
  props.push(
    prop(context, 'banner', 'banner', -ring * 0.2, ring * 0.16, 0.3, {
      scale: 0.9,
    }),
  )
  for (let index = 0; index < 3; index += 1) {
    props.push(
      prop(
        context,
        `barrel-${String(index)}`,
        variation.chance(0.5) ? 'barrel' : 'crate',
        ring * variation.signed(0.7),
        ring * variation.signed(0.7),
        0.36,
        { rotation: variation.angle() },
      ),
    )
  }

  // The fence runs around the outside with a gap on the approach side, which is
  // where the road arrives. A closed ring would read as a pen.
  const fenceRadius = ring * 1.45
  pushPerimeterFence(context, fences, props, fenceRadius, true)

  return {
    buildings,
    props,
    fences,
    clearingRadius: fenceRadius + 2.5,
  }
}

function composeShop(context: LayoutContext): SiteLayout {
  const variation = context.variation
  const spec = buildingSpec(context, 'shop')
  const buildings: SiteBuildingPlacement[] = [
    {
      id: 'shop',
      spec,
      x: 0,
      z: context.depth * 0.24,
      rotation: Math.PI,
      radius: Math.max(spec.width, spec.depth) * 0.44,
    },
  ]
  const props: SitePropPlacement[] = [
    prop(context, 'stall', 'stall', -context.width * 0.42, -context.depth * 0.4, 0.9, {
      rotation: variation.signed(0.3),
    }),
    prop(context, 'sign', 'signboard', context.width * 0.44, -context.depth * 0.3, 0.3),
    prop(context, 'lantern', 'lantern', -context.width * 0.5, context.depth * 0.1, 0.3),
    prop(context, 'barrel-0', 'barrel', context.width * 0.3, -context.depth * 0.52, 0.34, {
      rotation: variation.angle(),
    }),
    prop(context, 'barrel-1', 'barrel', context.width * 0.42, -context.depth * 0.42, 0.34, {
      rotation: variation.angle(),
    }),
    prop(context, 'crate-0', 'crate', -context.width * 0.16, -context.depth * 0.56, 0.34, {
      rotation: variation.angle(),
    }),
  ]
  const fences: SiteFencePlacement[] = []
  return { buildings, props, fences, clearingRadius: context.width * 1.15 }
}

function composeCamp(context: LayoutContext): SiteLayout {
  const variation = context.variation
  const buildings: SiteBuildingPlacement[] = []
  const props: SitePropPlacement[] = []
  const fences: SiteFencePlacement[] = []
  const ring = Math.max(context.width, context.depth) * 0.5

  const hutSpec = buildingSpec(context, 'hut')
  buildings.push({
    id: 'hut',
    spec: hutSpec,
    x: ring * 0.7,
    z: ring * 0.5,
    rotation: facingCentre(Math.PI * 0.25),
    radius: Math.max(hutSpec.width, hutSpec.depth) * 0.44,
  })

  for (let index = 0; index < 2; index += 1) {
    const angle = Math.PI * (0.8 + index * 0.55) + variation.signed(0.2)
    props.push(
      prop(
        context,
        `tent-${String(index)}`,
        'tent',
        Math.cos(angle) * ring,
        Math.sin(angle) * ring,
        1.1,
        { rotation: facingCentre(angle) },
      ),
    )
  }
  props.push(prop(context, 'brazier', 'brazier', 0, 0, 0.6))
  for (let index = 0; index < 2; index += 1) {
    props.push(
      prop(
        context,
        `banner-${String(index)}`,
        'banner',
        (index === 0 ? -1 : 1) * ring * 0.75,
        -ring * 0.85,
        0.3,
      ),
    )
  }
  for (let index = 0; index < 3; index += 1) {
    props.push(
      prop(
        context,
        `crate-${String(index)}`,
        variation.chance(0.4) ? 'barrel' : 'crate',
        ring * variation.signed(0.85),
        ring * variation.signed(0.85),
        0.36,
        { rotation: variation.angle() },
      ),
    )
  }
  pushPerimeterFence(context, fences, props, ring * 1.75, false)
  return { buildings, props, fences, clearingRadius: ring * 1.9 + 2 }
}

function composeStronghold(context: LayoutContext): SiteLayout {
  const variation = context.variation
  const keepSpec = buildingSpec(context, 'keep', {
    roofStyle: 'flat',
    crenellated: true,
    storeys: 2,
  })
  const buildings: SiteBuildingPlacement[] = [
    {
      id: 'keep',
      spec: keepSpec,
      x: 0,
      z: context.depth * 0.18,
      rotation: Math.PI,
      radius: Math.max(keepSpec.width, keepSpec.depth) * 0.46,
    },
  ]
  const props: SitePropPlacement[] = []
  const fences: SiteFencePlacement[] = []
  const wallRadius = Math.max(context.width, context.depth) * 0.86

  const towerCount = Math.max(2, context.towerCount + 2)
  for (let index = 0; index < towerCount; index += 1) {
    const angle = (index / towerCount) * Math.PI * 2 + Math.PI / 4
    props.push(
      prop(
        context,
        `tower-${String(index)}`,
        'tower',
        Math.cos(angle) * wallRadius,
        Math.sin(angle) * wallRadius,
        1.5,
        { rotation: -angle, scale: variation.around(1, 0.06) },
      ),
    )
  }

  props.push(
    prop(context, 'gate', 'gate', 0, -wallRadius, 0, {
      rotation: 0,
      length: Math.max(3.2, context.width * 0.34),
    }),
  )
  for (let index = 0; index < 2; index += 1) {
    props.push(
      prop(
        context,
        `banner-${String(index)}`,
        'banner',
        (index === 0 ? -1 : 1) * wallRadius * 0.42,
        -wallRadius * 0.72,
        0.3,
        { scale: 1.2 },
      ),
    )
    props.push(
      prop(
        context,
        `brazier-${String(index)}`,
        'brazier',
        (index === 0 ? -1 : 1) * wallRadius * 0.6,
        -wallRadius * 0.34,
        0.5,
      ),
    )
  }

  // Curtain wall runs between the towers, with the gate filling the approach side.
  const segments = towerCount
  for (let index = 0; index < segments; index += 1) {
    const from = (index / segments) * Math.PI * 2 + Math.PI / 4
    const to = ((index + 1) / segments) * Math.PI * 2 + Math.PI / 4
    const middle = (from + to) / 2
    const x = Math.cos(middle) * wallRadius
    const z = Math.sin(middle) * wallRadius
    // Skip the segment that would sit on top of the gate.
    if (z < -wallRadius * 0.72) continue
    const chord =
      2 * wallRadius * Math.sin((to - from) / 2) * 0.94
    fences.push({
      id: `wall-${String(index)}`,
      style: 'curtain',
      x,
      z,
      rotation: -middle + Math.PI / 2,
      length: chord,
    })
  }

  return { buildings, props, fences, clearingRadius: wallRadius + 4 }
}

function composeShrine(context: LayoutContext): SiteLayout {
  const props: SitePropPlacement[] = [
    prop(context, 'shrine', 'shrine', 0, 0, 1.7),
    prop(context, 'lantern-0', 'lantern', -context.width * 0.7, -context.depth * 0.5, 0.3),
    prop(context, 'lantern-1', 'lantern', context.width * 0.7, -context.depth * 0.5, 0.3),
    prop(context, 'cairn', 'cairn', context.width * 0.86, context.depth * 0.4, 0.5),
    prop(context, 'banner', 'banner', -context.width * 0.8, context.depth * 0.36, 0.3, {
      scale: 0.85,
    }),
  ]
  return {
    buildings: [],
    props,
    fences: [],
    clearingRadius: Math.max(context.width, context.depth) * 1.4,
  }
}

function composeEventSite(context: LayoutContext): SiteLayout {
  const variation = context.variation
  const props: SitePropPlacement[] = [
    prop(context, 'obelisk', 'obelisk', 0, 0, 1.2),
    prop(context, 'brazier', 'brazier', 0, -context.depth * 0.9, 0.5),
  ]
  // A ring of standing stones. Three is enough to read as deliberate, and they keep
  // off the approach for the same reason a village's houses do.
  for (let index = 0; index < 3; index += 1) {
    const angle =
      APPROACH_ANGLE +
      APPROACH_GAP +
      (index / 3) * (Math.PI * 2 - APPROACH_GAP * 2) +
      variation.signed(0.2)
    const distance = Math.max(context.width, context.depth) * 0.95
    props.push(
      prop(
        context,
        `stone-${String(index)}`,
        'waystone',
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        0.6,
        { rotation: variation.angle(), scale: variation.range(1.4, 2.2) },
      ),
    )
  }
  return {
    buildings: [],
    props,
    fences: [],
    clearingRadius: Math.max(context.width, context.depth) * 1.8,
  }
}

function composeTreasure(context: LayoutContext): SiteLayout {
  const variation = context.variation
  const props: SitePropPlacement[] = [
    prop(context, 'chest', 'chest', 0, 0, 0.8, { rotation: variation.signed(0.4) }),
    prop(context, 'cairn', 'cairn', context.width * 0.9, context.depth * 0.6, 0.45),
    prop(context, 'crate', 'crate', -context.width * 0.8, context.depth * 0.4, 0.34, {
      rotation: variation.angle(),
    }),
    prop(context, 'lantern', 'lantern', context.width * 0.7, -context.depth * 0.8, 0.3, {
      scale: 0.8,
    }),
  ]
  return { buildings: [], props, fences: [], clearingRadius: 6 }
}

function composeLandmark(context: LayoutContext): SiteLayout {
  const variation = context.variation
  const props: SitePropPlacement[] = [
    prop(context, 'monument', 'monument', 0, 0, 2.4),
  ]
  for (let index = 0; index < 2; index += 1) {
    props.push(
      prop(
        context,
        `banner-${String(index)}`,
        'banner',
        (index === 0 ? -1 : 1) * context.width * 0.66,
        -context.depth * 0.5,
        0.3,
        { scale: 1.3 },
      ),
    )
  }
  props.push(
    prop(context, 'waystone', 'waystone', context.width * 0.9, context.depth * 0.6, 0.4, {
      rotation: variation.angle(),
    }),
  )
  if (context.owner !== 'neutral') {
    props.push(
      prop(context, 'pillar-0', 'pillar', -context.width, context.depth * 0.8, 0.5),
    )
    props.push(
      prop(context, 'pillar-1', 'pillar', context.width, context.depth * 0.8, 0.5),
    )
  }
  return {
    buildings: [],
    props,
    fences: [],
    clearingRadius: Math.max(context.width, context.depth) * 1.8,
  }
}

function pushPerimeterFence(
  context: LayoutContext,
  fences: SiteFencePlacement[],
  props: SitePropPlacement[],
  radius: number,
  withGate: boolean,
): void {
  const sides = 8
  const chord = 2 * radius * Math.sin(Math.PI / sides) * 0.96
  let gateAdded = false
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2 + Math.PI / sides
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    // Two of the eight sides face the approach. Both are left open — a settlement
    // the player has to walk around to enter is a navigation problem, not a place —
    // and a single gate goes in the middle of the gap.
    if (z < -radius * 0.8) {
      if (withGate && !gateAdded) {
        gateAdded = true
        // Radius 0: a gate is a hole you walk through. Its geometry is two piers with
        // a gap between them, and a single circle collider at the centre would seal
        // the one route into the settlement.
        props.push(
          prop(context, 'gate', 'gate', 0, -radius, 0, {
            rotation: 0,
            length: chord * 0.62,
          }),
        )
      }
      continue
    }
    fences.push({
      id: `fence-${String(index)}`,
      style: context.style.fence,
      x,
      z,
      rotation: -angle + Math.PI / 2,
      length: chord,
    })
  }
}

function prop(
  context: LayoutContext,
  id: string,
  kind: SitePropKind,
  x: number,
  z: number,
  radius: number,
  overrides: Partial<Pick<SitePropPlacement, 'rotation' | 'scale' | 'length'>> = {},
): SitePropPlacement {
  const variation = context.variation
  return {
    id,
    kind,
    variant: variation.integer(0, PROP_VARIANTS),
    x,
    z,
    rotation: overrides.rotation ?? variation.signed(0.25),
    scale: overrides.scale ?? variation.around(1, 0.08),
    radius,
    ...(overrides.length === undefined ? {} : { length: overrides.length }),
  }
}
