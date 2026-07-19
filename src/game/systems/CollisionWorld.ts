import type { RegionId } from '../world/worldTypes.ts'
import type {
  Bounds2D,
  Point2,
  Point3,
} from '../world/TerrainSystem.ts'

export interface TerrainCollisionSampler {
  readonly bounds?: Bounds2D
  sampleHeight(x: number, z: number): number
  estimateSlope?(x: number, z: number, distance?: number): number
  isWalkableSlope?(
    x: number,
    z: number,
    maxSlope?: number,
    distance?: number,
  ): boolean
}

interface ColliderBase {
  id: string
  regionId: RegionId
  x: number
  z: number
  enabled?: boolean
  blocksMovement?: boolean
  tags?: readonly string[]
}

export interface CircleCollider extends ColliderBase {
  shape: 'circle'
  radius: number
}

export interface BoxCollider extends ColliderBase {
  shape: 'box'
  halfWidth: number
  halfDepth: number
  rotation?: number
}

export type Collider = CircleCollider | BoxCollider

export interface CircleShape {
  shape: 'circle'
  x: number
  z: number
  radius: number
}

export interface BoxShape {
  shape: 'box'
  x: number
  z: number
  halfWidth: number
  halfDepth: number
  rotation?: number
}

export type ColliderShape = CircleShape | BoxShape

export interface CollisionQueryOptions {
  excludeIds?: Iterable<string>
  regionIds?: Iterable<RegionId>
  includeDisabled?: boolean
  includeNonBlocking?: boolean
  predicate?: (collider: Collider) => boolean
}

export interface WalkablePositionOptions extends CollisionQueryOptions {
  maxSlope?: number
  slopeSampleDistance?: number
  requireActiveBounds?: boolean
}

export interface ResolveMovementOptions extends WalkablePositionOptions {
  maxIterations?: number
  maxStep?: number
  preventSteepTerrain?: boolean
}

export interface CollisionResolution extends Point3 {
  blocked: boolean
  collisionIds: string[]
  requested: Point2
}

export interface CollisionWorldOptions {
  cellSize?: number
  worldBounds?: Bounds2D
  maxWalkableSlope?: number
  movementIterations?: number
}

export interface CollisionWorldDebugStats {
  colliderCount: number
  bucketCount: number
  regionCount: number
  lastQueryCandidateCount: number
  revision: number
}

interface StoredColliderBase {
  id: string
  regionId: RegionId
  x: number
  z: number
  enabled: boolean
  blocksMovement: boolean
  tags: readonly string[]
}

interface StoredCircleCollider extends StoredColliderBase {
  shape: 'circle'
  radius: number
}

interface StoredBoxCollider extends StoredColliderBase {
  shape: 'box'
  halfWidth: number
  halfDepth: number
  rotation: number
}

type StoredCollider = StoredCircleCollider | StoredBoxCollider

const DEFAULT_CELL_SIZE = 8
const DEFAULT_MAX_SLOPE = Math.PI * (42 / 180)
const DEFAULT_MOVEMENT_ITERATIONS = 8
const EPSILON = 1e-8

export class CollisionWorld {
  private readonly terrain?: TerrainCollisionSampler
  private readonly cellSize: number
  private readonly maxWalkableSlope: number
  private readonly movementIterations: number
  private readonly colliders = new Map<string, StoredCollider>()
  private readonly colliderBuckets = new Map<string, Set<string>>()
  private readonly regionColliders = new Map<RegionId, Set<string>>()
  private readonly buckets = new Map<string, Set<string>>()
  private readonly regionRevisions = new Map<RegionId, number>()
  private worldBounds?: Bounds2D
  private activeBounds: Bounds2D[] | null = null
  private revision = 0
  private lastQueryCandidateCount = 0

  constructor(
    terrain?: TerrainCollisionSampler,
    options: CollisionWorldOptions = {},
  ) {
    this.terrain = terrain
    this.cellSize = positiveOr(options.cellSize, DEFAULT_CELL_SIZE)
    this.maxWalkableSlope = finiteOr(
      options.maxWalkableSlope,
      DEFAULT_MAX_SLOPE,
    )
    this.movementIterations = Math.max(
      1,
      Math.floor(
        positiveOr(options.movementIterations, DEFAULT_MOVEMENT_ITERATIONS),
      ),
    )
    const bounds = options.worldBounds ?? terrain?.bounds
    this.worldBounds = bounds ? normalizeBounds(bounds) : undefined
  }

  get size(): number {
    return this.colliders.size
  }

  getRevision(regionId?: RegionId): number {
    return regionId === undefined
      ? this.revision
      : (this.regionRevisions.get(regionId) ?? 0)
  }

  getRegionRevision(regionId: RegionId): number {
    return this.getRevision(regionId)
  }

  setWorldBounds(bounds: Bounds2D | null): void {
    this.worldBounds = bounds ? normalizeBounds(bounds) : undefined
    this.revision += 1
  }

  getWorldBounds(): Bounds2D | undefined {
    return this.worldBounds ? { ...this.worldBounds } : undefined
  }

  setActiveBounds(bounds: Bounds2D | readonly Bounds2D[] | null): void {
    if (bounds === null) {
      this.activeBounds = null
    } else if (Array.isArray(bounds)) {
      this.activeBounds = bounds.map((entry) => normalizeBounds(entry))
    } else {
      this.activeBounds = [normalizeBounds(bounds as Bounds2D)]
    }
    this.revision += 1
  }

  getActiveBounds(): readonly Bounds2D[] | null {
    return this.activeBounds?.map((bounds) => ({ ...bounds })) ?? null
  }

  registerCollider(collider: Collider): void {
    const normalized = normalizeCollider(collider)
    const previous = this.colliders.get(normalized.id)
    if (previous) {
      this.removeStoredCollider(previous, false)
      if (previous.regionId !== normalized.regionId) {
        this.bumpRevision(previous.regionId)
      }
    }

    this.colliders.set(normalized.id, normalized)
    let regionIds = this.regionColliders.get(normalized.regionId)
    if (!regionIds) {
      regionIds = new Set()
      this.regionColliders.set(normalized.regionId, regionIds)
    }
    regionIds.add(normalized.id)

    const bucketKeys = this.bucketKeysForBounds(colliderBounds(normalized))
    this.colliderBuckets.set(normalized.id, bucketKeys)
    for (const key of bucketKeys) {
      let bucket = this.buckets.get(key)
      if (!bucket) {
        bucket = new Set()
        this.buckets.set(key, bucket)
      }
      bucket.add(normalized.id)
    }
    this.bumpRevision(normalized.regionId)
  }

  addCollider(collider: Collider): void {
    this.registerCollider(collider)
  }

  registerCircle(collider: Omit<CircleCollider, 'shape'>): void {
    this.registerCollider({ ...collider, shape: 'circle' })
  }

  addCircle(collider: Omit<CircleCollider, 'shape'>): void {
    this.registerCircle(collider)
  }

  registerBox(collider: Omit<BoxCollider, 'shape'>): void {
    this.registerCollider({ ...collider, shape: 'box' })
  }

  addBox(collider: Omit<BoxCollider, 'shape'>): void {
    this.registerBox(collider)
  }

  getCollider(id: string): Collider | undefined {
    const collider = this.colliders.get(id)
    return collider ? cloneCollider(collider) : undefined
  }

  hasCollider(id: string): boolean {
    return this.colliders.has(id)
  }

  removeCollider(id: string): boolean {
    const collider = this.colliders.get(id)
    if (!collider) return false
    this.removeStoredCollider(collider, true)
    return true
  }

  removeRegion(regionId: RegionId): number {
    const resolvedRegionId = this.resolveRegionId(regionId)
    if (resolvedRegionId === undefined) return 0
    const ids = this.regionColliders.get(resolvedRegionId)
    if (!ids || ids.size === 0) return 0

    const colliders = [...ids]
      .map((id) => this.colliders.get(id))
      .filter((collider): collider is StoredCollider => collider !== undefined)
    for (const collider of colliders) {
      this.removeStoredCollider(collider, false)
    }
    this.bumpRevision(resolvedRegionId)
    return colliders.length
  }

  clearRegion(regionId: RegionId): number {
    return this.removeRegion(regionId)
  }

  clear(): void {
    if (this.colliders.size === 0 && this.buckets.size === 0) return
    const regionIds = [...this.regionColliders.keys()]
    this.colliders.clear()
    this.colliderBuckets.clear()
    this.regionColliders.clear()
    this.buckets.clear()
    this.revision += 1
    for (const regionId of regionIds) {
      this.regionRevisions.set(
        regionId,
        (this.regionRevisions.get(regionId) ?? 0) + 1,
      )
    }
  }

  queryBounds(
    bounds: Bounds2D,
    options: CollisionQueryOptions = {},
  ): Collider[] {
    const candidates = this.collectCandidates(normalizeBounds(bounds))
    const filter = createQueryFilter(options)
    const result: Collider[] = []
    for (const collider of candidates) {
      if (!filter(collider)) continue
      if (!boundsOverlap(bounds, colliderBounds(collider))) continue
      result.push(cloneCollider(collider))
    }
    result.sort(compareColliderIds)
    return result
  }

  queryOverlaps(
    shape: ColliderShape,
    options: CollisionQueryOptions = {},
  ): Collider[] {
    const normalizedShape = normalizeShape(shape)
    const candidates = this.collectCandidates(colliderBounds(normalizedShape))
    const filter = createQueryFilter(options)
    const result: Collider[] = []
    for (const collider of candidates) {
      if (!filter(collider) || !shapesOverlap(normalizedShape, collider)) continue
      result.push(cloneCollider(collider))
    }
    result.sort(compareColliderIds)
    return result
  }

  queryCircle(
    x: number,
    z: number,
    radius: number,
    options: CollisionQueryOptions = {},
  ): Collider[] {
    return this.queryOverlaps(
      { shape: 'circle', x, z, radius: Math.max(0, radius) },
      options,
    )
  }

  overlaps(
    shape: ColliderShape,
    options: CollisionQueryOptions = {},
  ): boolean {
    return this.queryOverlaps(shape, options).length > 0
  }

  overlapsCircle(
    x: number,
    z: number,
    radius: number,
    options: CollisionQueryOptions = {},
  ): boolean {
    return this.queryCircle(x, z, radius, options).length > 0
  }

  isWithinBounds(
    x: number,
    z: number,
    radius = 0,
    requireActiveBounds = true,
  ): boolean {
    const safeRadius = Math.max(0, radius)
    if (
      this.worldBounds &&
      !circleInsideBounds(this.worldBounds, x, z, safeRadius)
    ) {
      return false
    }
    if (!requireActiveBounds || this.activeBounds === null) return true
    if (this.activeBounds.length === 0) return false
    if (this.activeBounds.length === 1) {
      return circleInsideBounds(this.activeBounds[0], x, z, safeRadius)
    }

    return (
      this.activeBounds.some((bounds) => pointInsideBounds(bounds, x, z)) &&
      cardinalCircleSamples(x, z, safeRadius).every((sample) =>
        this.activeBounds?.some((bounds) =>
          pointInsideBounds(bounds, sample.x, sample.z),
        ),
      )
    )
  }

  isWalkablePosition(
    x: number,
    z: number,
    radius = 0,
    options: WalkablePositionOptions = {},
  ): boolean {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !this.isWithinBounds(
        x,
        z,
        radius,
        options.requireActiveBounds !== false,
      )
    ) {
      return false
    }
    const maxSlope = finiteOr(options.maxSlope, this.maxWalkableSlope)
    if (
      this.terrain?.isWalkableSlope &&
      !this.terrain.isWalkableSlope(
        x,
        z,
        maxSlope,
        options.slopeSampleDistance,
      )
    ) {
      return false
    }
    if (
      !this.terrain?.isWalkableSlope &&
      this.terrain?.estimateSlope &&
      this.terrain.estimateSlope(x, z, options.slopeSampleDistance) > maxSlope
    ) {
      return false
    }
    return !this.overlapsCircle(x, z, Math.max(0, radius), options)
  }

  isPositionWalkable(
    position: Point2,
    radius = 0,
    options: WalkablePositionOptions = {},
  ): boolean {
    return this.isWalkablePosition(position.x, position.z, radius, options)
  }

  sampleHeight(x: number, z: number): number {
    return this.terrain?.sampleHeight(x, z) ?? 0
  }

  sampleGround(x: number, z: number): Point3 {
    return { x, y: this.sampleHeight(x, z), z }
  }

  resolveMovement(
    start: Point2,
    requested: Point2,
    radius: number,
    options: ResolveMovementOptions = {},
  ): CollisionResolution {
    const safeRadius = Math.max(0, finiteOr(radius, 0))
    const deltaX = requested.x - start.x
    const deltaZ = requested.z - start.z
    const distance = Math.hypot(deltaX, deltaZ)
    const defaultStep = Math.max(0.05, safeRadius > 0 ? safeRadius * 0.5 : this.cellSize * 0.1)
    const maxStep = positiveOr(options.maxStep, defaultStep)
    const steps = Math.max(1, Math.ceil(distance / maxStep))
    const stepX = deltaX / steps
    const stepZ = deltaZ / steps
    let x = start.x
    let z = start.z
    const collisionIds = new Set<string>()

    for (let step = 0; step < steps; step += 1) {
      const targetX = x + stepX
      const targetZ = z + stepZ
      const bounded = this.clampToBounds(
        targetX,
        targetZ,
        safeRadius,
        options.requireActiveBounds !== false,
      )
      const resolved = this.resolvePenetrations(
        bounded.x,
        bounded.z,
        safeRadius,
        options,
      )
      x = resolved.x
      z = resolved.z
      for (const id of resolved.collisionIds) collisionIds.add(id)
    }

    if (
      options.preventSteepTerrain === true &&
      !this.isWalkablePosition(x, z, safeRadius, {
        ...options,
        maxSlope: options.maxSlope,
      })
    ) {
      x = start.x
      z = start.z
    }

    const blocked =
      Math.hypot(x - requested.x, z - requested.z) > 1e-5 ||
      collisionIds.size > 0
    return {
      x,
      y: this.sampleHeight(x, z),
      z,
      blocked,
      collisionIds: [...collisionIds].sort(),
      requested: { ...requested },
    }
  }

  resolveCircleMovement(
    start: Point2,
    requested: Point2,
    radius: number,
    options: ResolveMovementOptions = {},
  ): CollisionResolution {
    return this.resolveMovement(start, requested, radius, options)
  }

  getDebugStats(): CollisionWorldDebugStats {
    return {
      colliderCount: this.colliders.size,
      bucketCount: this.buckets.size,
      regionCount: this.regionColliders.size,
      lastQueryCandidateCount: this.lastQueryCandidateCount,
      revision: this.revision,
    }
  }

  private resolvePenetrations(
    startX: number,
    startZ: number,
    radius: number,
    options: ResolveMovementOptions,
  ): { x: number; z: number; collisionIds: string[] } {
    let x = startX
    let z = startZ
    const collisionIds = new Set<string>()
    const iterations = Math.max(
      1,
      Math.floor(
        positiveOr(options.maxIterations, this.movementIterations),
      ),
    )

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const overlaps = this.queryCircle(x, z, radius, options)
      if (overlaps.length === 0) break

      let moved = false
      for (const collider of overlaps) {
        const push = circlePushOut(x, z, radius, collider)
        if (!push) continue
        x += push.x
        z += push.z
        collisionIds.add(collider.id)
        moved = true
      }
      const bounded = this.clampToBounds(
        x,
        z,
        radius,
        options.requireActiveBounds !== false,
      )
      x = bounded.x
      z = bounded.z
      if (!moved) break
    }
    return { x, z, collisionIds: [...collisionIds] }
  }

  private clampToBounds(
    x: number,
    z: number,
    radius: number,
    requireActiveBounds: boolean,
  ): Point2 {
    let clamped = { x, z }
    if (this.worldBounds) {
      clamped = clampCircleCenter(this.worldBounds, clamped.x, clamped.z, radius)
    }
    if (!requireActiveBounds) return clamped
    if (this.activeBounds?.length === 1) {
      clamped = clampCircleCenter(
        this.activeBounds[0],
        clamped.x,
        clamped.z,
        radius,
      )
    } else if (
      this.activeBounds &&
      this.activeBounds.length > 1 &&
      !circleInsideBoundsUnion(
        this.activeBounds,
        clamped.x,
        clamped.z,
        radius,
      )
    ) {
      clamped = nearestCircleCenterInBoundsUnion(
        this.activeBounds,
        clamped.x,
        clamped.z,
        radius,
      )
    }
    return clamped
  }

  private collectCandidates(bounds: Bounds2D): StoredCollider[] {
    const ids = new Set<string>()
    for (const key of this.bucketKeysForBounds(bounds)) {
      const bucket = this.buckets.get(key)
      if (!bucket) continue
      for (const id of bucket) ids.add(id)
    }
    this.lastQueryCandidateCount = ids.size
    return [...ids]
      .sort()
      .map((id) => this.colliders.get(id))
      .filter((collider): collider is StoredCollider => collider !== undefined)
  }

  private bucketKeysForBounds(bounds: Bounds2D): Set<string> {
    const minX = Math.floor(bounds.minX / this.cellSize)
    const maxX = Math.floor(bounds.maxX / this.cellSize)
    const minZ = Math.floor(bounds.minZ / this.cellSize)
    const maxZ = Math.floor(bounds.maxZ / this.cellSize)
    const keys = new Set<string>()
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        keys.add(`${x}:${z}`)
      }
    }
    return keys
  }

  private removeStoredCollider(
    collider: StoredCollider,
    bumpRevision: boolean,
  ): void {
    this.colliders.delete(collider.id)
    const bucketKeys = this.colliderBuckets.get(collider.id)
    if (bucketKeys) {
      for (const key of bucketKeys) {
        const bucket = this.buckets.get(key)
        bucket?.delete(collider.id)
        if (bucket?.size === 0) this.buckets.delete(key)
      }
    }
    this.colliderBuckets.delete(collider.id)
    const regionIds = this.regionColliders.get(collider.regionId)
    regionIds?.delete(collider.id)
    if (regionIds?.size === 0) this.regionColliders.delete(collider.regionId)
    if (bumpRevision) this.bumpRevision(collider.regionId)
  }

  private bumpRevision(regionId: RegionId): void {
    this.revision += 1
    this.regionRevisions.set(
      regionId,
      (this.regionRevisions.get(regionId) ?? 0) + 1,
    )
  }

  private resolveRegionId(regionId: RegionId): RegionId | undefined {
    if (this.regionColliders.has(regionId)) return regionId
    const target = String(regionId)
    return [...this.regionColliders.keys()].find(
      (candidate) => String(candidate) === target,
    )
  }
}

export function shapesOverlap(
  first: ColliderShape,
  second: ColliderShape,
): boolean {
  if (first.shape === 'circle' && second.shape === 'circle') {
    const radius = first.radius + second.radius
    return (first.x - second.x) ** 2 + (first.z - second.z) ** 2 <= radius ** 2
  }
  if (first.shape === 'circle' && second.shape === 'box') {
    return circleBoxOverlap(first, second)
  }
  if (first.shape === 'box' && second.shape === 'circle') {
    return circleBoxOverlap(second, first)
  }
  return boxBoxOverlap(first as BoxShape, second as BoxShape)
}

function normalizeCollider(collider: Collider): StoredCollider {
  if (!collider.id) throw new Error('Collider id must not be empty')
  if (!Number.isFinite(collider.x) || !Number.isFinite(collider.z)) {
    throw new Error(`Collider ${collider.id} has an invalid position`)
  }
  const base: StoredColliderBase = {
    id: collider.id,
    regionId: collider.regionId,
    x: collider.x,
    z: collider.z,
    enabled: collider.enabled !== false,
    blocksMovement: collider.blocksMovement !== false,
    tags: collider.tags ? [...collider.tags] : [],
  }
  if (collider.shape === 'circle') {
    if (!Number.isFinite(collider.radius) || collider.radius < 0) {
      throw new Error(`Collider ${collider.id} has an invalid radius`)
    }
    return { ...base, shape: 'circle', radius: collider.radius }
  }
  if (
    !Number.isFinite(collider.halfWidth) ||
    !Number.isFinite(collider.halfDepth) ||
    collider.halfWidth < 0 ||
    collider.halfDepth < 0
  ) {
    throw new Error(`Collider ${collider.id} has invalid box extents`)
  }
  return {
    ...base,
    shape: 'box',
    halfWidth: collider.halfWidth,
    halfDepth: collider.halfDepth,
    rotation: finiteOr(collider.rotation, 0),
  }
}

function normalizeShape(shape: ColliderShape): ColliderShape {
  if (shape.shape === 'circle') {
    return {
      shape: 'circle',
      x: finiteOr(shape.x, 0),
      z: finiteOr(shape.z, 0),
      radius: Math.max(0, finiteOr(shape.radius, 0)),
    }
  }
  return {
    shape: 'box',
    x: finiteOr(shape.x, 0),
    z: finiteOr(shape.z, 0),
    halfWidth: Math.max(0, finiteOr(shape.halfWidth, 0)),
    halfDepth: Math.max(0, finiteOr(shape.halfDepth, 0)),
    rotation: finiteOr(shape.rotation, 0),
  }
}

function cloneCollider(collider: StoredCollider): Collider {
  const base = {
    id: collider.id,
    regionId: collider.regionId,
    x: collider.x,
    z: collider.z,
    enabled: collider.enabled,
    blocksMovement: collider.blocksMovement,
    tags: [...collider.tags],
  }
  return collider.shape === 'circle'
    ? { ...base, shape: 'circle', radius: collider.radius }
    : {
        ...base,
        shape: 'box',
        halfWidth: collider.halfWidth,
        halfDepth: collider.halfDepth,
        rotation: collider.rotation,
      }
}

function createQueryFilter(
  options: CollisionQueryOptions,
): (collider: StoredCollider) => boolean {
  const excluded = options.excludeIds
    ? new Set(options.excludeIds)
    : undefined
  const regionIds = options.regionIds
    ? new Set([...options.regionIds].map(String))
    : undefined
  return (collider) => {
    if (!options.includeDisabled && !collider.enabled) return false
    if (!options.includeNonBlocking && !collider.blocksMovement) return false
    if (excluded?.has(collider.id)) return false
    if (regionIds && !regionIds.has(String(collider.regionId))) return false
    return options.predicate?.(cloneCollider(collider)) !== false
  }
}

function colliderBounds(collider: ColliderShape): Bounds2D {
  if (collider.shape === 'circle') {
    return {
      minX: collider.x - collider.radius,
      maxX: collider.x + collider.radius,
      minZ: collider.z - collider.radius,
      maxZ: collider.z + collider.radius,
    }
  }
  const rotation = collider.rotation ?? 0
  const cosine = Math.abs(Math.cos(rotation))
  const sine = Math.abs(Math.sin(rotation))
  const extentX = collider.halfWidth * cosine + collider.halfDepth * sine
  const extentZ = collider.halfWidth * sine + collider.halfDepth * cosine
  return {
    minX: collider.x - extentX,
    maxX: collider.x + extentX,
    minZ: collider.z - extentZ,
    maxZ: collider.z + extentZ,
  }
}

function circleBoxOverlap(circle: CircleShape, box: BoxShape): boolean {
  const local = worldToBoxLocal(circle.x, circle.z, box)
  const closestX = clamp(local.x, -box.halfWidth, box.halfWidth)
  const closestZ = clamp(local.z, -box.halfDepth, box.halfDepth)
  return (
    (local.x - closestX) ** 2 + (local.z - closestZ) ** 2 <=
    circle.radius ** 2
  )
}

function boxBoxOverlap(first: BoxShape, second: BoxShape): boolean {
  const axes = [
    boxAxis(first.rotation ?? 0, true),
    boxAxis(first.rotation ?? 0, false),
    boxAxis(second.rotation ?? 0, true),
    boxAxis(second.rotation ?? 0, false),
  ]
  const centerDelta = {
    x: second.x - first.x,
    z: second.z - first.z,
  }
  for (const axis of axes) {
    const distance = Math.abs(centerDelta.x * axis.x + centerDelta.z * axis.z)
    const firstRadius = boxProjectionRadius(first, axis)
    const secondRadius = boxProjectionRadius(second, axis)
    if (distance > firstRadius + secondRadius) return false
  }
  return true
}

function boxAxis(rotation: number, primary: boolean): Point2 {
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return primary
    ? { x: cosine, z: sine }
    : { x: -sine, z: cosine }
}

function boxProjectionRadius(box: BoxShape, axis: Point2): number {
  const xAxis = boxAxis(box.rotation ?? 0, true)
  const zAxis = boxAxis(box.rotation ?? 0, false)
  return (
    box.halfWidth * Math.abs(xAxis.x * axis.x + xAxis.z * axis.z) +
    box.halfDepth * Math.abs(zAxis.x * axis.x + zAxis.z * axis.z)
  )
}

function circlePushOut(
  x: number,
  z: number,
  radius: number,
  collider: Collider,
): Point2 | null {
  if (collider.shape === 'circle') {
    const deltaX = x - collider.x
    const deltaZ = z - collider.z
    const distance = Math.hypot(deltaX, deltaZ)
    const penetration = radius + collider.radius - distance
    if (penetration < -EPSILON) return null
    if (distance <= EPSILON) {
      const direction = stableDirection(collider.id)
      return {
        x: direction.x * (penetration + EPSILON),
        z: direction.z * (penetration + EPSILON),
      }
    }
    return {
      x: (deltaX / distance) * (Math.max(0, penetration) + EPSILON),
      z: (deltaZ / distance) * (Math.max(0, penetration) + EPSILON),
    }
  }

  const local = worldToBoxLocal(x, z, collider)
  const closest = {
    x: clamp(local.x, -collider.halfWidth, collider.halfWidth),
    z: clamp(local.z, -collider.halfDepth, collider.halfDepth),
  }
  const outsideDelta = {
    x: local.x - closest.x,
    z: local.z - closest.z,
  }
  const outsideDistance = Math.hypot(outsideDelta.x, outsideDelta.z)
  let localPush: Point2
  if (outsideDistance > EPSILON) {
    const penetration = radius - outsideDistance
    if (penetration < -EPSILON) return null
    localPush = {
      x:
        (outsideDelta.x / outsideDistance) *
        (Math.max(0, penetration) + EPSILON),
      z:
        (outsideDelta.z / outsideDistance) *
        (Math.max(0, penetration) + EPSILON),
    }
  } else {
    const distanceToXFace = collider.halfWidth - Math.abs(local.x)
    const distanceToZFace = collider.halfDepth - Math.abs(local.z)
    if (distanceToXFace <= distanceToZFace) {
      localPush = {
        x: signOrOne(local.x) * (distanceToXFace + radius + EPSILON),
        z: 0,
      }
    } else {
      localPush = {
        x: 0,
        z: signOrOne(local.z) * (distanceToZFace + radius + EPSILON),
      }
    }
  }
  return boxLocalVectorToWorld(localPush, collider.rotation ?? 0)
}

function worldToBoxLocal(x: number, z: number, box: BoxShape): Point2 {
  const rotation = box.rotation ?? 0
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const deltaX = x - box.x
  const deltaZ = z - box.z
  return {
    x: deltaX * cosine + deltaZ * sine,
    z: -deltaX * sine + deltaZ * cosine,
  }
}

function boxLocalVectorToWorld(vector: Point2, rotation: number): Point2 {
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return {
    x: vector.x * cosine - vector.z * sine,
    z: vector.x * sine + vector.z * cosine,
  }
}

function stableDirection(id: string): Point2 {
  let hash = 0
  for (const character of id) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x45d9f3b)
  }
  const angle = ((hash >>> 0) / 0x1_0000_0000) * Math.PI * 2
  return { x: Math.cos(angle), z: Math.sin(angle) }
}

function normalizeBounds(bounds: Bounds2D): Bounds2D {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minZ) ||
    !Number.isFinite(bounds.maxZ) ||
    bounds.maxX < bounds.minX ||
    bounds.maxZ < bounds.minZ
  ) {
    throw new Error('Invalid collision bounds')
  }
  return { ...bounds }
}

function boundsOverlap(first: Bounds2D, second: Bounds2D): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minZ <= second.maxZ &&
    first.maxZ >= second.minZ
  )
}

function pointInsideBounds(
  bounds: Bounds2D,
  x: number,
  z: number,
): boolean {
  return (
    x >= bounds.minX &&
    x <= bounds.maxX &&
    z >= bounds.minZ &&
    z <= bounds.maxZ
  )
}

function circleInsideBounds(
  bounds: Bounds2D,
  x: number,
  z: number,
  radius: number,
): boolean {
  return (
    x - radius >= bounds.minX &&
    x + radius <= bounds.maxX &&
    z - radius >= bounds.minZ &&
    z + radius <= bounds.maxZ
  )
}

function cardinalCircleSamples(
  x: number,
  z: number,
  radius: number,
): Point2[] {
  return [
    { x: x - radius, z },
    { x: x + radius, z },
    { x, z: z - radius },
    { x, z: z + radius },
  ]
}

function clampCircleCenter(
  bounds: Bounds2D,
  x: number,
  z: number,
  radius: number,
): Point2 {
  const minimumX = Math.min(bounds.maxX, bounds.minX + radius)
  const maximumX = Math.max(bounds.minX, bounds.maxX - radius)
  const minimumZ = Math.min(bounds.maxZ, bounds.minZ + radius)
  const maximumZ = Math.max(bounds.minZ, bounds.maxZ - radius)
  return {
    x: clamp(x, minimumX, maximumX),
    z: clamp(z, minimumZ, maximumZ),
  }
}

function circleInsideBoundsUnion(
  boundsList: readonly Bounds2D[],
  x: number,
  z: number,
  radius: number,
): boolean {
  return (
    boundsList.some((bounds) => pointInsideBounds(bounds, x, z)) &&
    cardinalCircleSamples(x, z, radius).every((sample) =>
      boundsList.some((bounds) =>
        pointInsideBounds(bounds, sample.x, sample.z),
      ),
    )
  )
}

function nearestCircleCenterInBoundsUnion(
  boundsList: readonly Bounds2D[],
  x: number,
  z: number,
  radius: number,
): Point2 {
  let nearest = { x, z }
  let distance = Number.POSITIVE_INFINITY
  for (const bounds of boundsList) {
    const candidate = clampCircleCenter(bounds, x, z, radius)
    if (
      !circleInsideBoundsUnion(
        boundsList,
        candidate.x,
        candidate.z,
        radius,
      )
    ) {
      continue
    }
    const candidateDistance = (candidate.x - x) ** 2 + (candidate.z - z) ** 2
    if (candidateDistance < distance) {
      nearest = candidate
      distance = candidateDistance
    }
  }
  return nearest
}

function compareColliderIds(first: Collider, second: Collider): number {
  return first.id.localeCompare(second.id)
}

function signOrOne(value: number): number {
  return value < 0 ? -1 : 1
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
