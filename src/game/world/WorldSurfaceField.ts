import { Color } from 'three'
import { BRIDGE_PIER_SPAN_FRACTION, BRIDGE_PIER_WIDTH_FRACTION, artNoiseSeed, fbm3 } from '../art/index.ts'
import { getRegionRiverLegs, getRegionRoadLegs, getSiteWorldPosition2D } from '../content/registry.ts'
import type { ZoneId } from '../types.ts'
import { composeSiteLayout, resolveSiteLayoutTransform } from './SiteComposition.ts'
import type { Bounds2D, Point2, TerrainSystem } from './TerrainSystem.ts'
import type { RegionId, SiteKind, WorldBlueprint } from './worldTypes.ts'
import { canonicalBridgeSize } from './WorldPropLibrary.ts'

export const WORLD_SURFACE_REVISION = 'tactile-world-1'
export const WORLD_DETAIL_METRES = 4
export const WORLD_PAVING_METRES = 6

export type WorldSurfaceMaterial = 'grass' | 'soil' | 'rock' | 'paving' | 'water' | 'bridge'

/** Presentation metadata only. TerrainSystem and CollisionWorld retain physical authority. */
export interface WorldSurfaceSample {
  regionId: RegionId | null
  biome: ZoneId
  material: WorldSurfaceMaterial
  road: number
  paving: number
  vegetation: number
  shore: number
  visualWaterDepth: number
  flowX: number
  flowZ: number
  bridgeContact: number
}

export interface WorldCourtSurface {
  readonly siteId: string
  readonly regionId: RegionId
  readonly kind: SiteKind
  readonly x: number
  readonly z: number
  readonly radius: number
  readonly rotation: number
}

export interface WorldBridgeContact {
  readonly bridgeId: string
  readonly regionId: RegionId
  readonly x: number
  readonly z: number
}

interface Segment {
  readonly start: Point2
  readonly end: Point2
  readonly length: number
  readonly dx: number
  readonly dz: number
}

interface WaterSegment extends Segment {
  readonly fromX: number
  readonly fromZ: number
  readonly toX: number
  readonly toZ: number
}

const GROUND_COLORS: Readonly<Record<ZoneId, Color>> = {
  neutral: new Color(0x92906b),
  palace: new Color(0x959980),
  forest: new Color(0x697b57),
  fort: new Color(0x827d78),
}
const SOIL = new Color(0x96816a)
const PAVING = new Color(0xaaa99a)
const ROCK = new Color(0x8b8b84)

export function createWorldSurfaceSample(): WorldSurfaceSample {
  return {
    regionId: null, biome: 'neutral', material: 'soil', road: 0, paving: 0,
    vegetation: 0, shore: 0, visualWaterDepth: 0, flowX: 0, flowZ: 1, bridgeContact: 0,
  }
}

export class WorldSurfaceField {
  readonly revision = WORLD_SURFACE_REVISION
  readonly courts: readonly WorldCourtSurface[]
  readonly bridgeContacts: readonly WorldBridgeContact[]
  private readonly terrain: TerrainSystem
  private readonly roads: readonly Segment[]
  private readonly river: readonly WaterSegment[]
  private readonly bridges: readonly Point2[]
  private readonly seed: number
  private readonly roadHalfWidth: number
  private readonly waterHalfWidth: number
  private readonly bridgeHalfWidth: number
  private readonly bridgeHalfSpan: number
  private readonly scratch = createWorldSurfaceSample()
  private readonly biomes: ReadonlyMap<string, ZoneId>

  constructor(blueprint: WorldBlueprint, terrain: TerrainSystem, options: {
    readonly roadWidth: number
    readonly riverWidth: number
    readonly bridgeWidth: number
  }) {
    if (![options.roadWidth, options.riverWidth, options.bridgeWidth].every((v) => Number.isFinite(v) && v > 0)) {
      throw new RangeError('World surface widths must be positive and finite')
    }
    this.terrain = terrain
    this.biomes = new Map(terrain.layout.regions.map((region) =>
      [`${region.coordinate.x}:${region.coordinate.z}`, region.blueprint.biome]))
    this.seed = artNoiseSeed(blueprint.seed, 'world:surface')
    this.roadHalfWidth = options.roadWidth / 2
    this.waterHalfWidth = options.riverWidth / 2
    const bridgeSize = canonicalBridgeSize(options.riverWidth + 4, options.bridgeWidth)
    this.bridgeHalfWidth = bridgeSize.width / 2
    this.bridgeHalfSpan = bridgeSize.span / 2
    this.roads = Object.freeze(blueprint.regions.flatMap((region) =>
      getRegionRoadLegs(blueprint, region).map((leg) => segment(leg.center, leg.edge))))
    const river: WaterSegment[] = []
    for (const id of blueprint.river.regionPath) {
      const [entry, exit] = getRegionRiverLegs(blueprint, id)
      if (!entry || !exit) throw new Error(`Missing ordered river legs for ${id}`)
      const incoming = segment(entry.edge, entry.center)
      const outgoing = segment(exit.center, exit.edge)
      const bendLength = Math.hypot(incoming.dx + outgoing.dx, incoming.dz + outgoing.dz)
      const bendX = (incoming.dx + outgoing.dx) / bendLength
      const bendZ = (incoming.dz + outgoing.dz) / bendLength
      river.push(
        { ...incoming, fromX: incoming.dx, fromZ: incoming.dz, toX: bendX, toZ: bendZ },
        { ...outgoing, fromX: bendX, fromZ: bendZ, toX: outgoing.dx, toZ: outgoing.dz },
      )
    }
    this.river = Object.freeze(river)
    this.bridges = Object.freeze(blueprint.bridges.map((bridge) => {
      const region = terrain.getRegion(bridge.regionId)
      if (!region) throw new Error(`Missing bridge region ${bridge.regionId}`)
      return Object.freeze({
        x: (region.bounds.minX + region.bounds.maxX) / 2,
        z: (region.bounds.minZ + region.bounds.maxZ) / 2,
      })
    }))
    this.bridgeContacts = Object.freeze(blueprint.bridges.flatMap((bridge, index) => {
      const center = this.bridges[index]
      return [-1, 1].flatMap((sideX) => [-1, 1].map((sideZ) => Object.freeze({
        bridgeId: bridge.id, regionId: bridge.regionId,
        x: center.x + sideX * bridgeSize.span * BRIDGE_PIER_SPAN_FRACTION,
        z: center.z + sideZ * bridgeSize.width * BRIDGE_PIER_WIDTH_FRACTION / 2,
      })))
    }))
    const courts: WorldCourtSurface[] = []
    for (const site of blueprint.sites) {
      const region = terrain.getRegion(site.regionId)
      const anchor = getSiteWorldPosition2D(blueprint, site)
      if (!region || !anchor) throw new Error(`Missing surface site ${site.id}`)
      if (site.owner !== 'guard' && region.blueprint.biome !== 'palace') continue
      if (!['settlement', 'shop', 'final-stronghold', 'faction-start'].includes(site.kind)) continue
      const layout = composeSiteLayout({
        siteId: site.id, kind: site.kind, owner: site.owner, biome: region.blueprint.biome, seed: blueprint.seed,
      })
      courts.push(Object.freeze({
        siteId: site.id, regionId: site.regionId, kind: site.kind,
        ...resolveSiteLayoutTransform(site.kind, anchor, region.bounds),
        radius: Math.max(2, layout.clearingRadius - 3.5),
      }))
    }
    this.courts = Object.freeze(courts)
  }

  /** Writes into caller-owned scratch; no height, collision, visibility or weather side effects. */
  sampleInto(x: number, z: number, out: WorldSurfaceSample): WorldSurfaceSample {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('World surface coordinates must be finite')
    const region = this.terrain.getRegionAt(x, z)
    out.regionId = region?.id ?? null
    out.biome = region?.blueprint.biome ?? 'neutral'
    let roadDistance = Infinity
    for (const road of this.roads) roadDistance = Math.min(roadDistance, distanceToSegment(x, z, road))
    out.road = 1 - smooth(this.roadHalfWidth - 0.35, this.roadHalfWidth + 1.25, roadDistance)
    const court = this.courtCoverage(x, z)
    const palace = this.blendGround(x, z, null)
    out.paving = Math.max(court, out.road * smooth(0.4, 0.8, palace))
    this.sampleWaterInto(x, z, out)
    const waterDistance = this.waterDistance(x, z)
    const wetBank = 1 - smooth(this.waterHalfWidth, this.waterHalfWidth + 4, waterDistance)
    const patch = fbm3(x / 7, 0, z / 7, this.seed + 17, 2) * 0.5 + 0.5
    out.vegetation = smooth(0.28, 0.7, patch + wetBank * 0.16) *
      (1 - out.road) * (1 - out.paving) *
      smooth(this.waterHalfWidth + 0.25, this.waterHalfWidth + 1, waterDistance)
    const onBridge = this.onBridge(x, z)
    const inWater = this.inWater(x, z)
    if (onBridge || inWater) {
      out.vegetation = 0
      out.paving = 0
    }
    out.material = onBridge ? 'bridge' : inWater ? 'water'
      : out.paving > 0.5 ? 'paving' : out.road > 0.35 ? 'soil'
        : out.biome === 'fort' ? 'rock' : out.vegetation > 0.3 ? 'grass' : 'soil'
    return out
  }

  sample(x: number, z: number): Readonly<WorldSurfaceSample> {
    return Object.freeze(this.sampleInto(x, z, createWorldSurfaceSample()))
  }

  /** The paving channel alone, for clipped patches; does not evaluate unrelated flow/cover. */
  pavingAt(x: number, z: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('World surface coordinates must be finite')
    const court = this.courtCoverage(x, z)
    let road = 0
    for (const leg of this.roads) {
      if (x < Math.min(leg.start.x, leg.end.x) - this.roadHalfWidth - 1.25 ||
          x > Math.max(leg.start.x, leg.end.x) + this.roadHalfWidth + 1.25 ||
          z < Math.min(leg.start.z, leg.end.z) - this.roadHalfWidth - 1.25 ||
          z > Math.max(leg.start.z, leg.end.z) + this.roadHalfWidth + 1.25) continue
      road = Math.max(road, 1 - smooth(this.roadHalfWidth - 0.35, this.roadHalfWidth + 1.25,
        distanceToSegment(x, z, leg)))
    }
    const value = Math.max(court, road > 0 ? road * smooth(0.4, 0.8, this.blendGround(x, z, null)) : 0)
    return value > 0 && (this.onBridge(x, z) || this.inWater(x, z)) ? 0 : value
  }

  mayContainPaving(bounds: Bounds2D): boolean {
    const overlaps = (minX: number, maxX: number, minZ: number, maxZ: number): boolean =>
      bounds.maxX >= minX && bounds.minX <= maxX && bounds.maxZ >= minZ && bounds.minZ <= maxZ
    for (const court of this.courts) {
      const radius = court.radius + 1
      if (overlaps(court.x - radius, court.x + radius, court.z - radius, court.z + radius)) return true
    }
    const width = this.roadHalfWidth + 1.25
    return this.roads.some((road) => overlaps(
      Math.min(road.start.x, road.end.x) - width, Math.max(road.start.x, road.end.x) + width,
      Math.min(road.start.z, road.end.z) - width, Math.max(road.start.z, road.end.z) + width,
    ))
  }

  /** Optical cues for the unchanged ribbon, including water underneath a real bridge. */
  sampleWaterInto(x: number, z: number, out: WorldSurfaceSample): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('World surface coordinates must be finite')
    let distance = Infinity
    let nearestX = 0, nearestZ = 1
    let flowX = 0, flowZ = 0
    const influence = this.waterHalfWidth * 2
    for (const leg of this.river) {
      const along = fraction(x, z, leg)
      const d = Math.hypot(x - leg.start.x - leg.dx * leg.length * along, z - leg.start.z - leg.dz * leg.length * along)
      const nearest = d < distance
      if (!nearest && d >= influence) continue
      const incoming = leg.fromX === leg.dx && leg.fromZ === leg.dz
      const turn = incoming ? smooth(0.55, 1, along) : smooth(0, 0.45, along)
      const dx = leg.fromX + (leg.toX - leg.fromX) * turn
      const dz = leg.fromZ + (leg.toZ - leg.fromZ) * turn
      const length = Math.hypot(dx, dz)
      if (nearest) { distance = d; nearestX = dx / length; nearestZ = dz / length }
      // Overlapping legs contribute continuously; nearest-leg switching tears the
      // procedural flow phase along the diagonal of a right-angle bend.
      const weight = Math.max(0, 1 - d / influence) ** 2
      flowX += dx / length * weight
      flowZ += dz / length * weight
    }
    const flowLength = Math.hypot(flowX, flowZ)
    out.flowX = flowLength > 1e-8 ? flowX / flowLength : nearestX
    out.flowZ = flowLength > 1e-8 ? flowZ / flowLength : nearestZ
    out.shore = smooth(this.waterHalfWidth - 1.4, this.waterHalfWidth, distance)
    out.visualWaterDepth = 2.8 * (1 - smooth(0, this.waterHalfWidth, distance))
    out.bridgeContact = 0
    for (const bridge of this.bridges) {
      const pierX = this.bridgeHalfSpan * 2 * BRIDGE_PIER_SPAN_FRACTION
      const dx = Math.min(Math.abs(x - bridge.x - pierX), Math.abs(x - bridge.x + pierX))
      const dz = Math.max(0, Math.abs(z - bridge.z) - this.bridgeHalfWidth * BRIDGE_PIER_WIDTH_FRACTION)
      out.bridgeContact = Math.max(out.bridgeContact, 1 - smooth(0.18, 0.65, Math.hypot(dx, dz)))
    }
  }

  writeGroundColor(x: number, z: number, out: Color): Color {
    const sample = this.sampleInto(x, z, this.scratch)
    this.blendGround(x, z, out)
    const macro = fbm3(x / 38, 0, z / 38, this.seed, 3)
    const medium = fbm3(x / 9, 0, z / 9, this.seed + 29, 2)
    out.lerp(SOIL, (1 - sample.vegetation) * 0.22 + sample.road * 0.48)
    const normal = this.terrain.sampleNormal(x, z)
    out.lerp(ROCK, smooth(0.12, 0.48, 1 - normal.y) * 0.7)
    return out.multiplyScalar(1 + macro * 0.19 + medium * 0.055)
  }

  writePavingColor(x: number, z: number, out: Color): Color {
    const strength = this.pavingAt(x, z)
    this.writeGroundColor(x, z, out)
    return out.lerp(PAVING, smooth(0, 0.9, strength))
  }

  private waterDistance(x: number, z: number): number {
    let distance = Infinity
    for (const leg of this.river) distance = Math.min(distance, distanceToSegment(x, z, leg))
    return distance
  }

  private onBridge(x: number, z: number): boolean {
    return this.bridges.some((bridge) =>
      Math.abs(x - bridge.x) <= this.bridgeHalfSpan && Math.abs(z - bridge.z) <= this.bridgeHalfWidth)
  }

  private courtCoverage(x: number, z: number): number {
    let coverage = 0
    for (const area of this.courts) {
      const distance = Math.hypot(x - area.x, z - area.z)
      if (distance > area.radius + 1.4) continue
      const edge = fbm3(x * 0.32, 0, z * 0.32, this.seed, 2)
      coverage = Math.max(coverage, 1 - smooth(area.radius - 1.2, area.radius + 0.6, distance + edge * 0.8))
    }
    return coverage
  }

  private inWater(x: number, z: number): boolean {
    return this.river.some((leg) => {
      const along = (x - leg.start.x) * leg.dx + (z - leg.start.z) * leg.dz
      const across = Math.abs((x - leg.start.x) * leg.dz - (z - leg.start.z) * leg.dx)
      return along >= 0 && along <= leg.length && across < this.waterHalfWidth
    })
  }

  private blendGround(x: number, z: number, color: Color | null): number {
    const layout = this.terrain.layout
    const fx = (x - layout.origin.x) / layout.regionSize + layout.minCoordinate.x - 0.5
    const fz = (z - layout.origin.z) / layout.regionSize + layout.minCoordinate.z - 0.5
    const x0 = Math.floor(fx), z0 = Math.floor(fz)
    const tx = smooth(0, 1, fx - x0), tz = smooth(0, 1, fz - z0)
    let palace = 0
    color?.setRGB(0, 0, 0)
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const cx = Math.max(layout.minCoordinate.x, Math.min(layout.maxCoordinate.x, x0 + i))
      const cz = Math.max(layout.minCoordinate.z, Math.min(layout.maxCoordinate.z, z0 + j))
      const biome = this.biomes.get(`${cx}:${cz}`)
      if (!biome) throw new Error('World surface blend has no region')
      const weight = (i ? tx : 1 - tx) * (j ? tz : 1 - tz)
      if (biome === 'palace') palace += weight
      if (color) {
        color.r += GROUND_COLORS[biome].r * weight
        color.g += GROUND_COLORS[biome].g * weight
        color.b += GROUND_COLORS[biome].b * weight
      }
    }
    return palace
  }
}

function segment(start: Point2, end: Point2): Segment {
  const length = Math.hypot(end.x - start.x, end.z - start.z)
  if (!(length > 0)) throw new Error('World surface route has a zero-length leg')
  return Object.freeze({
    start: Object.freeze({ ...start }), end: Object.freeze({ ...end }), length,
    dx: (end.x - start.x) / length, dz: (end.z - start.z) / length,
  })
}

function fraction(x: number, z: number, leg: Segment): number {
  return Math.max(0, Math.min(1, ((x - leg.start.x) * leg.dx + (z - leg.start.z) * leg.dz) / leg.length))
}

function distanceToSegment(x: number, z: number, leg: Segment): number {
  const t = fraction(x, z, leg)
  return Math.hypot(x - leg.start.x - leg.dx * leg.length * t, z - leg.start.z - leg.dz * leg.length * t)
}

function smooth(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
}
