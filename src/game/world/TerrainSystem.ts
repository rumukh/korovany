import {
  BufferGeometry,
  Float32BufferAttribute,
} from 'three'
import {
  DEFAULT_REGION_SIZE,
  type RegionBlueprint,
  type RegionId,
  type WorldBlueprint,
} from './worldTypes.ts'

export interface Point2 {
  x: number
  z: number
}

export interface Point3 extends Point2 {
  y: number
}

export interface Bounds2D {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface TerrainHeightProfile {
  baseHeight: number
  amplitude: number
  frequency: number
  detailFrequency: number
  roughness: number
  macroWeight: number
  ridgeWeight: number
}

export interface NormalizedRegion {
  id: RegionId
  blueprint: RegionBlueprint
  coordinate: Point2
  bounds: Bounds2D
  biomeId?: string
  heightProfile: TerrainHeightProfile
}

export interface WorldLayout {
  blueprint: WorldBlueprint
  seed: string | number
  regionSize: number
  bounds: Bounds2D
  regions: readonly NormalizedRegion[]
  regionById: ReadonlyMap<RegionId, NormalizedRegion>
  regionByCoordinate: ReadonlyMap<string, NormalizedRegion>
  minCoordinate: Point2
  maxCoordinate: Point2
  origin: Point2
}

export interface TerrainSystemOptions {
  sampleDistance?: number
  maxWalkableSlope?: number
  tileResolution?: number
}

export interface TerrainTileData {
  regionId: RegionId
  resolution: number
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint16Array | Uint32Array
  bounds: Bounds2D
}

type UnknownRecord = Record<string, unknown>

const DEFAULT_TILE_RESOLUTION = 32
const DEFAULT_SAMPLE_DISTANCE = 0.5
const DEFAULT_MAX_WALKABLE_SLOPE = Math.PI * (42 / 180)

export class TerrainSystem {
  readonly blueprint: WorldBlueprint
  readonly layout: WorldLayout
  readonly bounds: Bounds2D

  private readonly seed: number
  private readonly sampleDistance: number
  private readonly maxWalkableSlope: number
  private readonly tileResolution: number
  private revision = 1

  constructor(blueprint: WorldBlueprint, options: TerrainSystemOptions = {}) {
    this.blueprint = blueprint
    this.layout = normalizeWorldBlueprint(blueprint)
    this.bounds = { ...this.layout.bounds }
    this.seed = hashSeed(this.layout.seed)
    this.sampleDistance = positiveOr(options.sampleDistance, DEFAULT_SAMPLE_DISTANCE)
    this.maxWalkableSlope = finiteOr(
      options.maxWalkableSlope,
      DEFAULT_MAX_WALKABLE_SLOPE,
    )
    this.tileResolution = Math.max(
      1,
      Math.floor(positiveOr(options.tileResolution, DEFAULT_TILE_RESOLUTION)),
    )
  }

  getRevision(): number {
    return this.revision
  }

  invalidate(): void {
    this.revision += 1
  }

  getRegion(regionId: RegionId): NormalizedRegion | undefined {
    const direct = this.layout.regionById.get(regionId)
    if (direct) return direct
    const id = String(regionId)
    return this.layout.regions.find((region) => String(region.id) === id)
  }

  getRegionAt(x: number, z: number): NormalizedRegion | undefined {
    if (!containsPoint(this.bounds, x, z)) return undefined

    const coordinateX = Math.min(
      this.layout.maxCoordinate.x,
      Math.floor((x - this.layout.origin.x) / this.layout.regionSize) +
        this.layout.minCoordinate.x,
    )
    const coordinateZ = Math.min(
      this.layout.maxCoordinate.z,
      Math.floor((z - this.layout.origin.z) / this.layout.regionSize) +
        this.layout.minCoordinate.z,
    )
    const indexed = this.layout.regionByCoordinate.get(
      coordinateKey(coordinateX, coordinateZ),
    )
    if (indexed && containsPoint(indexed.bounds, x, z)) return indexed

    return this.layout.regions.find((region) =>
      containsPoint(region.bounds, x, z),
    )
  }

  getRegionIdAt(x: number, z: number): RegionId | undefined {
    return this.getRegionAt(x, z)?.id
  }

  getBiomeAt(x: number, z: number): string | undefined {
    return this.getRegionAt(x, z)?.biomeId
  }

  sampleHeight(x: number, z: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0

    const profile = this.sampleBlendedProfile(x, z)
    const macro = valueNoise2D(this.seed ^ 0x6d2b79f5, x * 0.006, z * 0.006)
    const detail = fractalNoise2D(
      this.seed,
      x * profile.frequency,
      z * profile.frequency,
      profile.roughness,
      Math.pow(
        clamp(profile.detailFrequency / profile.frequency, 1.25, 8),
        1 / 3,
      ),
    )
    const ridgeNoise = valueNoise2D(
      this.seed ^ 0x9e3779b9,
      x * profile.frequency * 0.55,
      z * profile.frequency * 0.55,
    )
    const ridge = 1 - Math.abs(ridgeNoise)
    const shaped =
      detail * (1 - profile.macroWeight - profile.ridgeWeight) +
      macro * profile.macroWeight +
      (ridge * 2 - 1) * profile.ridgeWeight

    return profile.baseHeight + shaped * profile.amplitude
  }

  sampleNormal(x: number, z: number, distance = this.sampleDistance): Point3 {
    const step = positiveOr(distance, this.sampleDistance)
    const dx =
      (this.sampleHeight(x + step, z) - this.sampleHeight(x - step, z)) /
      (2 * step)
    const dz =
      (this.sampleHeight(x, z + step) - this.sampleHeight(x, z - step)) /
      (2 * step)
    const length = Math.hypot(dx, 1, dz)
    if (!Number.isFinite(length) || length <= Number.EPSILON) {
      return { x: 0, y: 1, z: 0 }
    }
    return {
      x: -dx / length,
      y: 1 / length,
      z: -dz / length,
    }
  }

  estimateSlope(x: number, z: number, distance = this.sampleDistance): number {
    const normal = this.sampleNormal(x, z, distance)
    return Math.acos(clamp(normal.y, -1, 1))
  }

  sampleSlope(x: number, z: number, distance = this.sampleDistance): number {
    return this.estimateSlope(x, z, distance)
  }

  isWalkableSlope(
    x: number,
    z: number,
    maxSlope = this.maxWalkableSlope,
    distance = this.sampleDistance,
  ): boolean {
    return this.estimateSlope(x, z, distance) <= maxSlope
  }

  createRegionTileData(
    regionOrId: RegionBlueprint | RegionId,
    resolution = this.tileResolution,
  ): TerrainTileData {
    const region = this.resolveRegion(regionOrId)
    if (!region) {
      throw new Error(`Unknown terrain region: ${String(regionOrId)}`)
    }

    const segments = Math.max(1, Math.floor(positiveOr(resolution, this.tileResolution)))
    const side = segments + 1
    const vertexCount = side * side
    const positions = new Float32Array(vertexCount * 3)
    const normals = new Float32Array(vertexCount * 3)
    const uvs = new Float32Array(vertexCount * 2)
    const indexCount = segments * segments * 6
    const indices =
      vertexCount > 65_535
        ? new Uint32Array(indexCount)
        : new Uint16Array(indexCount)
    const width = region.bounds.maxX - region.bounds.minX
    const depth = region.bounds.maxZ - region.bounds.minZ

    let vertexOffset = 0
    let uvOffset = 0
    for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
      const z = region.bounds.minZ + (depth * zIndex) / segments
      for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
        const x = region.bounds.minX + (width * xIndex) / segments
        const y = this.sampleHeight(x, z)
        const normal = this.sampleNormal(x, z)
        positions[vertexOffset] = x
        positions[vertexOffset + 1] = y
        positions[vertexOffset + 2] = z
        normals[vertexOffset] = normal.x
        normals[vertexOffset + 1] = normal.y
        normals[vertexOffset + 2] = normal.z
        uvs[uvOffset] = xIndex / segments
        uvs[uvOffset + 1] = zIndex / segments
        vertexOffset += 3
        uvOffset += 2
      }
    }

    let indexOffset = 0
    for (let zIndex = 0; zIndex < segments; zIndex += 1) {
      for (let xIndex = 0; xIndex < segments; xIndex += 1) {
        const topLeft = zIndex * side + xIndex
        const topRight = topLeft + 1
        const bottomLeft = topLeft + side
        const bottomRight = bottomLeft + 1
        indices[indexOffset] = topLeft
        indices[indexOffset + 1] = bottomLeft
        indices[indexOffset + 2] = topRight
        indices[indexOffset + 3] = topRight
        indices[indexOffset + 4] = bottomLeft
        indices[indexOffset + 5] = bottomRight
        indexOffset += 6
      }
    }

    return {
      regionId: region.id,
      resolution: segments,
      positions,
      normals,
      uvs,
      indices,
      bounds: { ...region.bounds },
    }
  }

  createTileData(
    regionOrId: RegionBlueprint | RegionId,
    resolution = this.tileResolution,
  ): TerrainTileData {
    return this.createRegionTileData(regionOrId, resolution)
  }

  createRegionGeometry(
    regionOrId: RegionBlueprint | RegionId,
    resolution = this.tileResolution,
  ): BufferGeometry {
    const tile = this.createRegionTileData(regionOrId, resolution)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(tile.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(tile.normals, 3))
    geometry.setAttribute('uv', new Float32BufferAttribute(tile.uvs, 2))
    geometry.setIndex(Array.from(tile.indices))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    geometry.userData.regionId = tile.regionId
    return geometry
  }

  createGeometry(
    regionOrId: RegionBlueprint | RegionId,
    resolution = this.tileResolution,
  ): BufferGeometry {
    return this.createRegionGeometry(regionOrId, resolution)
  }

  private resolveRegion(
    regionOrId: RegionBlueprint | RegionId,
  ): NormalizedRegion | undefined {
    if (typeof regionOrId === 'object' && regionOrId !== null) {
      return this.layout.regions.find(
        (region) => region.blueprint === regionOrId,
      )
    }
    return this.getRegion(regionOrId as RegionId)
  }

  private sampleBlendedProfile(x: number, z: number): TerrainHeightProfile {
    const coordinateX =
      (x - this.layout.origin.x) / this.layout.regionSize +
      this.layout.minCoordinate.x -
      0.5
    const coordinateZ =
      (z - this.layout.origin.z) / this.layout.regionSize +
      this.layout.minCoordinate.z -
      0.5
    const x0 = Math.floor(coordinateX)
    const z0 = Math.floor(coordinateZ)
    const xWeight = smootherStep(coordinateX - x0)
    const zWeight = smootherStep(coordinateZ - z0)
    const p00 = this.profileAtCoordinate(x0, z0)
    const p10 = this.profileAtCoordinate(x0 + 1, z0)
    const p01 = this.profileAtCoordinate(x0, z0 + 1)
    const p11 = this.profileAtCoordinate(x0 + 1, z0 + 1)

    return {
      baseHeight: bilerp(
        p00.baseHeight,
        p10.baseHeight,
        p01.baseHeight,
        p11.baseHeight,
        xWeight,
        zWeight,
      ),
      amplitude: bilerp(
        p00.amplitude,
        p10.amplitude,
        p01.amplitude,
        p11.amplitude,
        xWeight,
        zWeight,
      ),
      frequency: bilerp(
        p00.frequency,
        p10.frequency,
        p01.frequency,
        p11.frequency,
        xWeight,
        zWeight,
      ),
      detailFrequency: bilerp(
        p00.detailFrequency,
        p10.detailFrequency,
        p01.detailFrequency,
        p11.detailFrequency,
        xWeight,
        zWeight,
      ),
      roughness: bilerp(
        p00.roughness,
        p10.roughness,
        p01.roughness,
        p11.roughness,
        xWeight,
        zWeight,
      ),
      macroWeight: bilerp(
        p00.macroWeight,
        p10.macroWeight,
        p01.macroWeight,
        p11.macroWeight,
        xWeight,
        zWeight,
      ),
      ridgeWeight: bilerp(
        p00.ridgeWeight,
        p10.ridgeWeight,
        p01.ridgeWeight,
        p11.ridgeWeight,
        xWeight,
        zWeight,
      ),
    }
  }

  private profileAtCoordinate(x: number, z: number): TerrainHeightProfile {
    const clampedX = clamp(
      x,
      this.layout.minCoordinate.x,
      this.layout.maxCoordinate.x,
    )
    const clampedZ = clamp(
      z,
      this.layout.minCoordinate.z,
      this.layout.maxCoordinate.z,
    )
    const direct = this.layout.regionByCoordinate.get(
      coordinateKey(clampedX, clampedZ),
    )
    if (direct) return direct.heightProfile

    let nearest = this.layout.regions[0]
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const region of this.layout.regions) {
      const distance =
        (region.coordinate.x - clampedX) ** 2 +
        (region.coordinate.z - clampedZ) ** 2
      if (
        distance < nearestDistance ||
        (distance === nearestDistance &&
          String(region.id) < String(nearest?.id))
      ) {
        nearest = region
        nearestDistance = distance
      }
    }
    return nearest?.heightProfile ?? defaultHeightProfile(this.seed, 0, 0)
  }
}

export function normalizeWorldBlueprint(blueprint: WorldBlueprint): WorldLayout {
  const world = asRecord(blueprint) ?? {}
  const rawRegions = readRegions(world)
  if (rawRegions.length === 0) {
    throw new Error('World blueprint must contain at least one region')
  }

  const seed = readSeed(world)
  const preliminaries = rawRegions.map((blueprintRegion, index) => {
    const record = asRecord(blueprintRegion) ?? {}
    const coordinate = readCoordinate(record, index)
    const id = readRegionId(record, coordinate)
    const explicitBounds = readBounds(record.bounds) ?? readBounds(record)
    return {
      id,
      blueprint: blueprintRegion,
      coordinate,
      explicitBounds,
      record,
    }
  })
  const minCoordinate = {
    x: Math.min(...preliminaries.map((region) => region.coordinate.x)),
    z: Math.min(...preliminaries.map((region) => region.coordinate.z)),
  }
  const maxCoordinate = {
    x: Math.max(...preliminaries.map((region) => region.coordinate.x)),
    z: Math.max(...preliminaries.map((region) => region.coordinate.z)),
  }
  const explicitWorldBounds = readBounds(world.bounds) ?? readBounds(world.worldBounds)
  const inferredRegionSize = preliminaries
    .map((region) =>
      region.explicitBounds
        ? region.explicitBounds.maxX - region.explicitBounds.minX
        : undefined,
    )
    .find((size) => size !== undefined && size > 0)
  const coordinateColumns = maxCoordinate.x - minCoordinate.x + 1
  const boundsRegionSize =
    explicitWorldBounds && coordinateColumns > 0
      ? (explicitWorldBounds.maxX - explicitWorldBounds.minX) / coordinateColumns
      : undefined
  const regionSize = positiveOr(
    readNumber(world, ['regionSize', 'tileSize', 'regionWorldSize']) ??
      inferredRegionSize ??
      boundsRegionSize,
    DEFAULT_REGION_SIZE,
  )
  const worldOriginRecord = asRecord(world.origin) ?? asRecord(world.worldOrigin)
  const origin = {
    x:
      explicitWorldBounds?.minX ??
      readNumber(world, ['originX', 'minX']) ??
      readNumber(worldOriginRecord, ['x']) ??
      minCoordinate.x * regionSize,
    z:
      explicitWorldBounds?.minZ ??
      readNumber(world, ['originZ', 'minZ']) ??
      readNumber(worldOriginRecord, ['z']) ??
      minCoordinate.z * regionSize,
  }
  const numericSeed = hashSeed(seed)
  const regions = preliminaries.map<NormalizedRegion>((region) => {
    const bounds =
      region.explicitBounds ??
      boundsFromOrigin(
        readPoint(region.record.origin) ?? readPoint(region.record.worldOrigin),
        region.coordinate,
        minCoordinate,
        origin,
        regionSize,
      )
    return {
      id: region.id,
      blueprint: region.blueprint,
      coordinate: { ...region.coordinate },
      bounds,
      biomeId: readBiomeId(region.record),
      heightProfile: readHeightProfile(
        region.record,
        numericSeed,
        region.coordinate.x,
        region.coordinate.z,
      ),
    }
  })
  regions.sort(compareRegions)

  const bounds =
    explicitWorldBounds ?? {
      minX: Math.min(...regions.map((region) => region.bounds.minX)),
      maxX: Math.max(...regions.map((region) => region.bounds.maxX)),
      minZ: Math.min(...regions.map((region) => region.bounds.minZ)),
      maxZ: Math.max(...regions.map((region) => region.bounds.maxZ)),
    }
  const regionById = new Map<RegionId, NormalizedRegion>()
  const regionByCoordinate = new Map<string, NormalizedRegion>()
  for (const region of regions) {
    regionById.set(region.id, region)
    regionByCoordinate.set(
      coordinateKey(region.coordinate.x, region.coordinate.z),
      region,
    )
  }

  return {
    blueprint,
    seed,
    regionSize,
    bounds,
    regions,
    regionById,
    regionByCoordinate,
    minCoordinate,
    maxCoordinate,
    origin,
  }
}

export function compareRegions(a: NormalizedRegion, b: NormalizedRegion): number {
  return (
    a.coordinate.z - b.coordinate.z ||
    a.coordinate.x - b.coordinate.x ||
    String(a.id).localeCompare(String(b.id))
  )
}

export function containsPoint(
  bounds: Bounds2D,
  x: number,
  z: number,
  padding = 0,
): boolean {
  return (
    x >= bounds.minX + padding &&
    x <= bounds.maxX - padding &&
    z >= bounds.minZ + padding &&
    z <= bounds.maxZ - padding
  )
}

function readRegions(world: UnknownRecord): RegionBlueprint[] {
  const candidate =
    world.regions ??
    world.regionBlueprints ??
    world.tiles ??
    world.regionGrid
  if (Array.isArray(candidate)) {
    return candidate.filter(isObject) as RegionBlueprint[]
  }
  const record = asRecord(candidate)
  return record
    ? (Object.values(record).filter(isObject) as RegionBlueprint[])
    : []
}

function readCoordinate(record: UnknownRecord, fallbackIndex: number): Point2 {
  const nested =
    asRecord(record.coordinate) ??
    asRecord(record.coordinates) ??
    asRecord(record.coord) ??
    asRecord(record.gridCoordinate) ??
    asRecord(record.grid)
  return {
    x: Math.floor(
      readNumber(record, ['gridX', 'column', 'col']) ??
        readNumber(nested, ['x', 'column', 'col']) ??
        fallbackIndex,
    ),
    z: Math.floor(
      readNumber(record, ['gridZ', 'row']) ??
        readNumber(nested, ['z', 'y', 'row']) ??
        0,
    ),
  }
}

function readRegionId(record: UnknownRecord, coordinate: Point2): RegionId {
  const id = record.id ?? record.regionId ?? record.key
  return String(id ?? `${coordinate.x},${coordinate.z}`) as RegionId
}

function readSeed(world: UnknownRecord): string | number {
  const seed = world.seed ?? world.rootSeed ?? world.worldSeed ?? 0
  return typeof seed === 'number' || typeof seed === 'string' ? seed : 0
}

function readBiomeId(record: UnknownRecord): string | undefined {
  const biome = record.biomeId ?? record.biome ?? record.zoneId ?? record.zone
  if (typeof biome === 'string') return biome
  const nested = asRecord(biome)
  const id = nested?.id ?? nested?.biomeId ?? nested?.key
  return typeof id === 'string' ? id : undefined
}

function readHeightProfile(
  region: UnknownRecord,
  seed: number,
  coordinateX: number,
  coordinateZ: number,
): TerrainHeightProfile {
  const source =
    asRecord(region.heightProfile) ??
    asRecord(region.terrainProfile) ??
    asRecord(region.terrain) ??
    region
  const defaults = defaultHeightProfile(seed, coordinateX, coordinateZ)
  const roughnessPermille = readNumber(source, ['roughnessPermille'])
  const featureScale = readNumber(source, ['featureScale'])
  const detailScale = readNumber(source, ['detailScale'])
  const macroWeight = clamp(
    finiteOr(
      readNumber(source, ['macroWeight', 'lowFrequencyWeight']),
      defaults.macroWeight,
    ),
    0,
    0.8,
  )
  const ridgeWeight = clamp(
    finiteOr(
      readNumber(source, ['ridgeWeight', 'ridge']),
      defaults.ridgeWeight,
    ),
    0,
    0.8 - macroWeight,
  )
  return {
    baseHeight: finiteOr(
      readNumber(source, [
        'baseHeight',
        'meanHeight',
        'elevation',
        'heightOffset',
        'base',
      ]),
      defaults.baseHeight,
    ),
    amplitude: Math.max(
      0,
      finiteOr(
        readNumber(source, ['amplitude', 'heightScale', 'relief', 'variation']),
        defaults.amplitude,
      ),
    ),
    frequency: positiveOr(
      readNumber(source, ['frequency', 'noiseFrequency', 'scale']) ??
        (featureScale !== undefined && featureScale > 0
          ? 1 / featureScale
          : undefined),
      defaults.frequency,
    ),
    detailFrequency: positiveOr(
      readNumber(source, ['detailFrequency']) ??
        (detailScale !== undefined && detailScale > 0
          ? 1 / detailScale
          : undefined),
      defaults.detailFrequency,
    ),
    roughness: clamp(
      finiteOr(
        readNumber(source, ['roughness', 'persistence']) ??
          (roughnessPermille === undefined
            ? undefined
            : roughnessPermille / 1000),
        defaults.roughness,
      ),
      0,
      0.95,
    ),
    macroWeight,
    ridgeWeight,
  }
}

function defaultHeightProfile(
  seed: number,
  coordinateX: number,
  coordinateZ: number,
): TerrainHeightProfile {
  const variation = hashUnit(seed, coordinateX, coordinateZ)
  const secondVariation = hashUnit(seed ^ 0x85ebca6b, coordinateX, coordinateZ)
  return {
    baseHeight: (variation - 0.5) * 2.5,
    amplitude: 3.5 + secondVariation * 2,
    frequency: 0.018 + variation * 0.008,
    detailFrequency: 0.075 + secondVariation * 0.02,
    roughness: 0.48,
    macroWeight: 0.35,
    ridgeWeight: 0.08,
  }
}

function boundsFromOrigin(
  explicitOrigin: Point2 | undefined,
  coordinate: Point2,
  minimum: Point2,
  worldOrigin: Point2,
  regionSize: number,
): Bounds2D {
  const minX =
    explicitOrigin?.x ??
    worldOrigin.x + (coordinate.x - minimum.x) * regionSize
  const minZ =
    explicitOrigin?.z ??
    worldOrigin.z + (coordinate.z - minimum.z) * regionSize
  return {
    minX,
    maxX: minX + regionSize,
    minZ,
    maxZ: minZ + regionSize,
  }
}

function readBounds(value: unknown): Bounds2D | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const min = asRecord(record.min)
  const max = asRecord(record.max)
  const minX = readNumber(record, ['minX', 'left']) ?? readNumber(min, ['x'])
  const maxX = readNumber(record, ['maxX', 'right']) ?? readNumber(max, ['x'])
  const minZ =
    readNumber(record, ['minZ', 'top']) ?? readNumber(min, ['z', 'y'])
  const maxZ =
    readNumber(record, ['maxZ', 'bottom']) ?? readNumber(max, ['z', 'y'])
  if (
    minX === undefined ||
    maxX === undefined ||
    minZ === undefined ||
    maxZ === undefined ||
    maxX <= minX ||
    maxZ <= minZ
  ) {
    return undefined
  }
  return { minX, maxX, minZ, maxZ }
}

function readPoint(value: unknown): Point2 | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const x = readNumber(record, ['x'])
  const z = readNumber(record, ['z', 'y'])
  return x === undefined || z === undefined ? undefined : { x, z }
}

function readNumber(
  record: UnknownRecord | undefined,
  names: readonly string[],
): number | undefined {
  if (!record) return undefined
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return isObject(value) ? (value as UnknownRecord) : undefined
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

function coordinateKey(x: number, z: number): string {
  return `${x}:${z}`
}

function smootherStep(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function bilerp(
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  z: number,
): number {
  return lerp(lerp(a, b, x), lerp(c, d, x), z)
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function hashSeed(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return mix32(Math.trunc(seed))
  }
  let hash = 0x811c9dc5
  for (const character of String(seed)) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return mix32(hash)
}

function hashUnit(seed: number, x: number, z: number): number {
  const hash = mix32(
    seed ^
      Math.imul(Math.trunc(x), 0x1b873593) ^
      Math.imul(Math.trunc(z), 0x85ebca6b),
  )
  return hash / 0x1_0000_0000
}

function mix32(value: number): number {
  let hash = value | 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return hash >>> 0
}

function valueNoise2D(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const xWeight = smootherStep(x - x0)
  const zWeight = smootherStep(z - z0)
  const a = hashUnit(seed, x0, z0) * 2 - 1
  const b = hashUnit(seed, x0 + 1, z0) * 2 - 1
  const c = hashUnit(seed, x0, z0 + 1) * 2 - 1
  const d = hashUnit(seed, x0 + 1, z0 + 1) * 2 - 1
  return bilerp(a, b, c, d, xWeight, zWeight)
}

function fractalNoise2D(
  seed: number,
  x: number,
  z: number,
  persistence: number,
  lacunarity = 2,
): number {
  let amplitude = 1
  let frequency = 1
  let total = 0
  let amplitudeTotal = 0
  for (let octave = 0; octave < 4; octave += 1) {
    total +=
      valueNoise2D(seed + Math.imul(octave, 0x9e3779b1), x * frequency, z * frequency) *
      amplitude
    amplitudeTotal += amplitude
    amplitude *= persistence
    frequency *= lacunarity
  }
  return amplitudeTotal > 0 ? total / amplitudeTotal : 0
}
