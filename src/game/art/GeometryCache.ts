import * as THREE from 'three'

/**
 * Shared geometry lifetime for a streamed world.
 *
 * The campaign streams a 5x5 region grid: a forest tree can be visible in three
 * regions at once and must survive any one of them unloading. A plain `Map` cache
 * cannot express that, and disposing on the first unload frees a buffer another
 * region is still drawing from. So the cache is reference counted, and releasing is
 * the only sanctioned way to let a shared geometry go.
 */
export class GeometryCache {
  private readonly entries = new Map<
    string,
    { geometry: THREE.BufferGeometry; references: number }
  >()
  private disposed = false

  /** Builds on first use, and hands back the same geometry afterwards. */
  acquire(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    if (this.disposed) {
      throw new Error('Cannot acquire geometry from a disposed cache')
    }
    const existing = this.entries.get(key)
    if (existing) {
      existing.references += 1
      return existing.geometry
    }
    const geometry = build()
    geometry.name = geometry.name || key
    this.entries.set(key, { geometry, references: 1 })
    return geometry
  }

  /** Drops one reference and disposes the geometry when the last one goes. */
  release(key: string): void {
    const existing = this.entries.get(key)
    if (!existing) return
    existing.references -= 1
    if (existing.references > 0) return
    this.entries.delete(key)
    existing.geometry.dispose()
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  referenceCount(key: string): number {
    return this.entries.get(key)?.references ?? 0
  }

  get size(): number {
    return this.entries.size
  }

  /** Releases everything unconditionally. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.values()) entry.geometry.dispose()
    this.entries.clear()
  }
}

export interface LodLevel {
  geometry: THREE.BufferGeometry
  /** Camera distance at which this level takes over. */
  distance: number
}

export interface CreateLodOptions {
  levels: readonly LodLevel[]
  material: THREE.Material | THREE.Material[]
  castShadow?: boolean
  receiveShadow?: boolean
  name?: string
}

/**
 * Assembles a `THREE.LOD` from pre-built levels.
 *
 * Levels must be ordered nearest first. Streamed regions use two levels — a near
 * one with displacement and welded outline normals, a far one built from the same
 * profile at lower segment counts. Instanced props do not use LOD at all: they draw
 * the cheap level directly, because swapping an instanced buffer per frame costs
 * more than the triangles it saves.
 */
export function createLod(options: CreateLodOptions): THREE.LOD {
  if (options.levels.length === 0) {
    throw new RangeError('An LOD needs at least one level')
  }
  const lod = new THREE.LOD()
  lod.name = options.name ?? 'art-lod'
  let previousDistance = -Infinity
  for (const level of options.levels) {
    // three.js stores `Math.abs( distance )`, so a negative slips through and then
    // reorders itself; equal distances make the earlier level permanently
    // unreachable; NaN fails every comparison and silently disables selection.
    if (!Number.isFinite(level.distance) || level.distance < 0) {
      throw new RangeError('LOD distances must be finite and non-negative')
    }
    if (level.distance <= previousDistance) {
      throw new RangeError('LOD levels must be ordered from nearest to farthest')
    }
    previousDistance = level.distance
    const mesh = new THREE.Mesh(level.geometry, options.material)
    mesh.name = `${lod.name}:${String(level.distance)}`
    mesh.castShadow = options.castShadow === true
    mesh.receiveShadow = options.receiveShadow !== false
    lod.addLevel(mesh, level.distance)
  }
  return lod
}

/**
 * Disposes the meshes of an LOD without touching its geometries or materials.
 *
 * LOD levels routinely share cached geometry and library-owned materials, so the
 * caller decides what actually gets freed.
 */
export function clearLod(lod: THREE.LOD): void {
  for (const level of [...lod.levels]) {
    lod.remove(level.object)
  }
  lod.levels.length = 0
}
