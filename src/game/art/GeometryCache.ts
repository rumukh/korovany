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

  /**
   * Drops one reference and disposes the geometry when the last one goes.
   *
   * **Currently unreachable on this branch, and deliberately so.** The only consumer is
   * `GameEngine.acquireArtGeometry`, which acquires and never releases; the cache is
   * freed in one `dispose()` at teardown. Measured on `rumukh-s1-art-foundation`: one
   * `acquire` call site, zero `release` call sites. That is a fact about this branch and
   * not about the merged tree — see the last paragraph.
   *
   * That matters before anyone adds the first one, because **this count is keyed, not
   * holder-identified, and the distinction is not recoverable from a key.** Two regions
   * holding `'tree'` and one region releasing twice produce the identical call sequence.
   * Measured on this class:
   *
   *     A and B acquire 'tree'          references 2
   *     A releases                      references 1   nothing disposed
   *     A releases again                references 0   entry deleted, geometry DISPOSED
   *                                     — while B is still drawing it
   *
   * So the only anomaly this method can detect is `!existing`, which is the case where
   * the entry is already gone and there is nothing left to corrupt. **It can see the
   * harmless mistake and not the harmful one.** A throw or a warning added here would
   * fire exactly when no damage is possible and stay silent exactly when damage is
   * certain — the reference count would look guarded without being so.
   *
   * The fix is holder identity, because that is the minimum that distinguishes one
   * holder releasing twice from two holders releasing once. A better message or a
   * key-level guard cannot substitute for it, and should not be mistaken for it.
   *
   * **That condition has already fired one branch over, and the answer is not a token on
   * this signature.** The world-object layer wraps this cache — five `cache.release(key)`
   * sites in `WorldPropLibrary` — and puts the guard one layer up, on the caller-facing
   * receipt: its `release(asset)` rejects a repeat through a `WeakSet<PropAsset>`,
   * because an asset object carries the identity a key cannot. Prefer that shape over
   * changing this signature. It leaves every other consumer untouched, and it names the
   * fault as "this asset came back twice" at the boundary that owns it, rather than
   * inferring it from a reference count after the damage.
   *
   * One raw `release(key)` there is correct and is not a bypass: rolling back a
   * partially-acquired asset, where no receipt was ever issued, so no receipt can be
   * double-spent. That is the case a receipt guard cannot cover, and the reason this
   * method must stay silent on `!existing` rather than throwing.
   */
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
 * Detaches every level of an LOD, freeing nothing.
 *
 * It removes the meshes and empties `lod.levels`; it does not dispose anything,
 * and `THREE.Mesh` has no `dispose()` to call in any case. LOD levels routinely
 * share cached geometry and library-owned materials, so the caller decides what
 * actually gets freed — which in practice means a matching `release(key)` for
 * every `acquire(key)` that fed a level. Believing this frees them leaks every
 * level for the life of the page.
 */
export function clearLod(lod: THREE.LOD): void {
  for (const level of [...lod.levels]) {
    lod.remove(level.object)
  }
  lod.levels.length = 0
}
