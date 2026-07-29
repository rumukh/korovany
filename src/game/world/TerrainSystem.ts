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

/**
 * A whole region's terrain, evaluated once and kept.
 *
 * Roadmap 0.3 measured `NavigationSystem.buildGrid` at ~8,000 fBm evaluations per region
 * — one height per cell plus four more for the slope — landing on the first pathfind
 * after every region activation. This is the field those consumers read instead.
 *
 * `heights` is a `Float32Array` because that is the precision its consumer already keeps:
 * `NavigationGrid.heights` is a `Float32Array`, so a cell height stored here is bit-for-bit
 * the number the grid held before this cache existed. `slopes` is a `Float64Array` on
 * purpose — the walkability test is `slope <= maxSlope`, and rounding the comparison's left
 * side to 32 bits could flip a cell that sits exactly on the threshold. Two types, two
 * reasons, both about matching the old numbers exactly rather than about memory.
 */
export interface RegionHeightField {
  regionId: RegionId
  bounds: Bounds2D
  columns: number
  rows: number
  cellWidth: number
  cellDepth: number
  slopeSampleDistance: number
  terrainRevision: number
  heights: Float32Array
  slopes: Float64Array
}

export interface RegionHeightFieldRequest {
  columns: number
  rows: number
  slopeSampleDistance?: number
}

/**
 * Deterministic counters, for the controls that prove the caches are still being hit.
 *
 * `heightSamples` counts live noise evaluations — every `sampleHeight` that actually ran
 * the fBm. A cached region grid rebuild must add **zero** to it.
 *
 * `profileLoads` and `noiseCornerLoads` count the two memoisations inside the evaluator:
 * how many times the four surrounding region height profiles had to be looked up again,
 * and how many times a noise call site had to hash four fresh lattice corners. A sample
 * that memoised nothing would cost one profile load and six corner loads; a region sweep
 * costs a small constant and a fraction of one. Nothing in the simulation reads any of
 * these — they exist so a test can fail when an optimisation quietly stops working.
 */
export interface TerrainSampleStats {
  heightSamples: number
  profileLoads: number
  noiseCornerLoads: number
  fieldBuilds: number
  fieldHits: number
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
/**
 * How many region height fields to keep. The engine streams a 3×3 window, so nine is the
 * working set and twelve leaves room for the region being walked out of. Each field is
 * `columns * rows` floats plus the same count of doubles — 25 kB for the shipped 40×40
 * grid — so the cap is about not leaking a whole world, not about saving bytes.
 */
const MAX_CACHED_HEIGHT_FIELDS = 12

export class TerrainSystem {
  readonly blueprint: WorldBlueprint
  readonly layout: WorldLayout
  readonly bounds: Bounds2D

  private readonly seed: number
  private readonly sampleDistance: number
  private readonly maxWalkableSlope: number
  private readonly tileResolution: number
  private readonly sampler: HeightSampler
  private readonly heightFields = new Map<RegionId, RegionHeightField>()
  private fieldBuilds = 0
  private fieldHits = 0
  private revision = 1

  constructor(blueprint: WorldBlueprint, options: TerrainSystemOptions = {}) {
    this.blueprint = blueprint
    this.layout = normalizeWorldBlueprint(blueprint)
    this.bounds = { ...this.layout.bounds }
    this.seed = hashSeed(this.layout.seed)
    this.sampler = new HeightSampler(this.layout, this.seed)
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
    this.heightFields.clear()
  }

  getSampleStats(): TerrainSampleStats {
    return {
      heightSamples: this.sampler.sampleCount,
      profileLoads: this.sampler.profileLoads,
      noiseCornerLoads: this.sampler.noiseCornerLoads,
      fieldBuilds: this.fieldBuilds,
      fieldHits: this.fieldHits,
    }
  }

  resetSampleStats(): void {
    this.sampler.sampleCount = 0
    this.sampler.profileLoads = 0
    this.sampler.noiseCornerLoads = 0
    this.fieldBuilds = 0
    this.fieldHits = 0
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
    return this.sampler.sample(x, z)
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

  /**
   * The region's height and slope, on the caller's own cell grid, built once and kept.
   *
   * `NavigationSystem` asks for exactly the lattice its grid uses, so the cell centres here
   * are the same floats it would have produced itself — the coordinate arithmetic below is
   * character-for-character what `buildGrid` does. The point of the cache is the *rebuild*:
   * registering a region's colliders bumps `colliderRevision`, which misses the grid cache
   * and used to re-evaluate all ~8,000 noise samples even though the terrain had not moved.
   */
  getRegionHeightField(
    regionId: RegionId,
    request: RegionHeightFieldRequest,
  ): RegionHeightField | undefined {
    const region = this.getRegion(regionId)
    if (!region) return undefined
    const columns = Math.max(1, Math.floor(request.columns))
    const rows = Math.max(1, Math.floor(request.rows))
    if (!Number.isFinite(columns) || !Number.isFinite(rows)) return undefined
    const slopeSampleDistance = positiveOr(
      request.slopeSampleDistance,
      this.sampleDistance,
    )

    const cached = this.heightFields.get(region.id)
    if (
      cached &&
      cached.terrainRevision === this.revision &&
      cached.columns === columns &&
      cached.rows === rows &&
      cached.slopeSampleDistance === slopeSampleDistance
    ) {
      this.fieldHits += 1
      // Reinsert so the eviction below drops the region nobody has asked about.
      this.heightFields.delete(region.id)
      this.heightFields.set(region.id, cached)
      return cached
    }

    const field = this.buildRegionHeightField(
      region,
      columns,
      rows,
      slopeSampleDistance,
    )
    this.fieldBuilds += 1
    this.heightFields.delete(region.id)
    this.heightFields.set(region.id, field)
    while (this.heightFields.size > MAX_CACHED_HEIGHT_FIELDS) {
      const oldest = this.heightFields.keys().next()
      if (oldest.done) break
      this.heightFields.delete(oldest.value)
    }
    return field
  }

  private buildRegionHeightField(
    region: NormalizedRegion,
    columns: number,
    rows: number,
    slopeSampleDistance: number,
  ): RegionHeightField {
    const width = region.bounds.maxX - region.bounds.minX
    const depth = region.bounds.maxZ - region.bounds.minZ
    const cellWidth = width / columns
    const cellDepth = depth / rows
    const heights = new Float32Array(columns * rows)
    const slopes = new Float64Array(columns * rows)
    const step = slopeSampleDistance
    const sampler = this.sampler

    for (let row = 0; row < rows; row += 1) {
      const z = region.bounds.minZ + (row + 0.5) * cellDepth
      for (let column = 0; column < columns; column += 1) {
        const x = region.bounds.minX + (column + 0.5) * cellWidth
        const index = row * columns + column
        heights[index] = sampler.sample(x, z)
        // The same five samples `buildGrid` used to take through `sampleHeight` and
        // `estimateSlope`, in the same order, through the same evaluator.
        const dx =
          (sampler.sample(x + step, z) - sampler.sample(x - step, z)) / (2 * step)
        const dz =
          (sampler.sample(x, z + step) - sampler.sample(x, z - step)) / (2 * step)
        slopes[index] = slopeFromDerivatives(dx, dz)
      }
    }

    return {
      regionId: region.id,
      bounds: { ...region.bounds },
      columns,
      rows,
      cellWidth,
      cellDepth,
      slopeSampleDistance,
      terrainRevision: this.revision,
      heights,
      slopes,
    }
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
}

/**
 * The height evaluator, extracted from `sampleHeight` so it can keep state between calls.
 *
 * It computes exactly what the inline version computed — same operations, same order, same
 * bits — and every number it caches is a pure function of integers, so the memoisation
 * cannot change a result. What it removes is repetition:
 *
 * 1. **The blended profile.** A point's height profile is a bilinear blend of the four
 *    region profiles around it. Locating those four used to mean four `Map` lookups on a
 *    freshly built `"x:z"` string, plus a freshly allocated profile object, *per sample* —
 *    measured at half the cost of a sample. The four corners only change when the sample
 *    crosses a region-coordinate boundary, which a region-sized sweep does at most once per
 *    axis, so they are unpacked into fields and refreshed only then.
 * 2. **The noise lattice corners.** `valueNoise2D` reads four hashed corners and
 *    interpolates. At the frequencies this terrain uses, a 0.5 m step moves the macro layer
 *    0.003 of a lattice cell — the same four corners answer hundreds of consecutive
 *    samples. Each of the six call sites keeps its own last-corners slot, so a repeat costs
 *    three comparisons instead of four hashes.
 *
 * Measured on the shipped 40×40 region grid: 0.63 µs → 0.23 µs per sample, with zero
 * mismatches against the inline implementation. `tests/navGridBenchmark.test.ts` pins that
 * equality on real generated worlds; `tests/terrainSystem.test.ts` pins the region-seam
 * continuity that made this change safe to attempt at all.
 */
const NOISE_SLOTS = 6
const MACRO_SLOT = 0
const RIDGE_SLOT = 1
const FRACTAL_SLOT = 2

class HeightSampler {
  sampleCount = 0
  profileLoads = 0
  noiseCornerLoads = 0

  private readonly layout: WorldLayout
  private readonly seed: number
  private readonly macroSeed: number
  private readonly ridgeSeed: number

  private quadrantX = Number.NaN
  private quadrantZ = Number.NaN
  private readonly cornerBaseHeight = new Float64Array(4)
  private readonly cornerAmplitude = new Float64Array(4)
  private readonly cornerFrequency = new Float64Array(4)
  private readonly cornerDetailFrequency = new Float64Array(4)
  private readonly cornerRoughness = new Float64Array(4)
  private readonly cornerMacroWeight = new Float64Array(4)
  private readonly cornerRidgeWeight = new Float64Array(4)

  private readonly slotSeed = new Float64Array(NOISE_SLOTS).fill(Number.NaN)
  private readonly slotX0 = new Float64Array(NOISE_SLOTS).fill(Number.NaN)
  private readonly slotZ0 = new Float64Array(NOISE_SLOTS).fill(Number.NaN)
  private readonly slotA = new Float64Array(NOISE_SLOTS)
  private readonly slotB = new Float64Array(NOISE_SLOTS)
  private readonly slotC = new Float64Array(NOISE_SLOTS)
  private readonly slotD = new Float64Array(NOISE_SLOTS)

  constructor(layout: WorldLayout, seed: number) {
    this.layout = layout
    this.seed = seed
    this.macroSeed = seed ^ 0x6d2b79f5
    this.ridgeSeed = seed ^ 0x9e3779b9
  }

  sample(x: number, z: number): number {
    this.sampleCount += 1
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
    if (x0 !== this.quadrantX || z0 !== this.quadrantZ) {
      this.refreshQuadrant(x0, z0)
    }
    const xWeight = smootherStep(coordinateX - x0)
    const zWeight = smootherStep(coordinateZ - z0)

    const baseHeight = this.blend(this.cornerBaseHeight, xWeight, zWeight)
    const amplitude = this.blend(this.cornerAmplitude, xWeight, zWeight)
    const frequency = this.blend(this.cornerFrequency, xWeight, zWeight)
    const detailFrequency = this.blend(
      this.cornerDetailFrequency,
      xWeight,
      zWeight,
    )
    const roughness = this.blend(this.cornerRoughness, xWeight, zWeight)
    const macroWeight = this.blend(this.cornerMacroWeight, xWeight, zWeight)
    const ridgeWeight = this.blend(this.cornerRidgeWeight, xWeight, zWeight)

    const macro = this.valueNoise(MACRO_SLOT, this.macroSeed, x * 0.006, z * 0.006)
    const detail = this.fractalNoise(
      x * frequency,
      z * frequency,
      roughness,
      Math.pow(clamp(detailFrequency / frequency, 1.25, 8), 1 / 3),
    )
    const ridgeNoise = this.valueNoise(
      RIDGE_SLOT,
      this.ridgeSeed,
      x * frequency * 0.55,
      z * frequency * 0.55,
    )
    const ridge = 1 - Math.abs(ridgeNoise)
    const shaped =
      detail * (1 - macroWeight - ridgeWeight) +
      macro * macroWeight +
      (ridge * 2 - 1) * ridgeWeight

    return baseHeight + shaped * amplitude
  }

  private blend(
    corners: Float64Array,
    xWeight: number,
    zWeight: number,
  ): number {
    return bilerp(corners[0], corners[1], corners[2], corners[3], xWeight, zWeight)
  }

  private refreshQuadrant(x0: number, z0: number): void {
    this.profileLoads += 1
    this.quadrantX = x0
    this.quadrantZ = z0
    this.storeCorner(0, this.profileAtCoordinate(x0, z0))
    this.storeCorner(1, this.profileAtCoordinate(x0 + 1, z0))
    this.storeCorner(2, this.profileAtCoordinate(x0, z0 + 1))
    this.storeCorner(3, this.profileAtCoordinate(x0 + 1, z0 + 1))
  }

  private storeCorner(index: number, profile: TerrainHeightProfile): void {
    this.cornerBaseHeight[index] = profile.baseHeight
    this.cornerAmplitude[index] = profile.amplitude
    this.cornerFrequency[index] = profile.frequency
    this.cornerDetailFrequency[index] = profile.detailFrequency
    this.cornerRoughness[index] = profile.roughness
    this.cornerMacroWeight[index] = profile.macroWeight
    this.cornerRidgeWeight[index] = profile.ridgeWeight
  }

  private valueNoise(
    slot: number,
    seed: number,
    x: number,
    z: number,
  ): number {
    const x0 = Math.floor(x)
    const z0 = Math.floor(z)
    if (
      this.slotSeed[slot] !== seed ||
      this.slotX0[slot] !== x0 ||
      this.slotZ0[slot] !== z0
    ) {
      this.slotSeed[slot] = seed
      this.slotX0[slot] = x0
      this.slotZ0[slot] = z0
      this.noiseCornerLoads += 1
      this.slotA[slot] = hashUnit(seed, x0, z0) * 2 - 1
      this.slotB[slot] = hashUnit(seed, x0 + 1, z0) * 2 - 1
      this.slotC[slot] = hashUnit(seed, x0, z0 + 1) * 2 - 1
      this.slotD[slot] = hashUnit(seed, x0 + 1, z0 + 1) * 2 - 1
    }
    return bilerp(
      this.slotA[slot],
      this.slotB[slot],
      this.slotC[slot],
      this.slotD[slot],
      smootherStep(x - x0),
      smootherStep(z - z0),
    )
  }

  private fractalNoise(
    x: number,
    z: number,
    persistence: number,
    lacunarity: number,
  ): number {
    let amplitude = 1
    let frequency = 1
    let total = 0
    let amplitudeTotal = 0
    for (let octave = 0; octave < 4; octave += 1) {
      total +=
        this.valueNoise(
          FRACTAL_SLOT + octave,
          this.seed + Math.imul(octave, 0x9e3779b1),
          x * frequency,
          z * frequency,
        ) * amplitude
      amplitudeTotal += amplitude
      amplitude *= persistence
      frequency *= lacunarity
    }
    return amplitudeTotal > 0 ? total / amplitudeTotal : 0
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

/**
 * The slope `estimateSlope` reports, from derivatives already in hand.
 *
 * Kept as one function so the cached field and the live query cannot drift: both reduce to
 * `acos(clamp(normal.y, -1, 1))` where `normal.y` is `1 / hypot(dx, 1, dz)`, including the
 * degenerate branch where the length is not usable and the normal points straight up.
 */
function slopeFromDerivatives(dx: number, dz: number): number {
  const length = Math.hypot(dx, 1, dz)
  const normalY =
    !Number.isFinite(length) || length <= Number.EPSILON ? 1 : 1 / length
  return Math.acos(clamp(normalY, -1, 1))
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
