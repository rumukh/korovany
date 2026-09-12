import * as THREE from 'three'
import { resolveVisualSubsystemAllocation } from './visualBudget.ts'
import type { VisualQualityPolicy } from './visualPolicy.ts'
import type { VisualAllocationReceipt } from './diagnostics/VisualBudgetAccounting.ts'

export type TransientSource = THREE.Mesh | THREE.Sprite | THREE.Points | THREE.Line
export type TransientCategory = 'contact' | 'number' | 'callout' | 'ray' | 'gore' | 'decal' | 'smoke' | 'debris' | 'trail' | 'weather' | 'tell' | 'projectile' | 'loot' | 'environment'
interface Candidate {
  source: TransientSource
  priority: number
  calls: number
  triangles: number
  visible: boolean
  protected: boolean
}

/** Conservative submitted work, including groups, instances and a caster's depth draw. */
export function transientSourceCost(source: TransientSource, target = { calls: 0, triangles: 0 }): { calls: number; triangles: number } {
  target.calls = target.triangles = 0
  if (source instanceof THREE.Sprite) {
    if (source.material.visible) { target.calls = 1; target.triangles = 2 }
    return target
  }
  const geometry = source.geometry
  const instances = source instanceof THREE.InstancedMesh ? source.count : 1
  const available = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
  const start = geometry.drawRange.start, end = Math.min(available, start + geometry.drawRange.count)
  let calls = 0, triangles = 0
  const count = (material: THREE.Material | undefined, from: number, to: number) => {
    // Opacity does not suppress submission and shared loot callbacks can change it at draw time.
    if (!material?.visible || instances === 0 || to <= from) return
    const sides = material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1
    calls += sides + (source.castShadow ? 1 : 0)
    if (source instanceof THREE.Mesh) triangles += (to - from) / 3 * instances * sides
  }
  if (Array.isArray(source.material)) {
    for (const group of geometry.groups) count(source.material[group.materialIndex ?? 0],
      Math.max(start, group.start), Math.min(end, group.start + group.count))
  } else count(source.material, start, end)
  target.calls = calls
  target.triangles = triangles
  return target
}

/** Budget selection is render-only; original visibility is restored even after renderer failure. */
export class TransientEffectBudget {
  private readonly cache = new WeakMap<TransientSource, Candidate>()
  private readonly candidates: Candidate[] = []
  private readonly seen = new Set<TransientSource>()
  private policy: VisualQualityPolicy | null = null
  private prepared = false
  private submitted = 0
  private triangles = 0
  private requested = 0
  private omitted = 0
  private limit = 0
  private triangleLimit = 0
  private protectedCalls = 0
  private environmentCalls = 0
  private camera: THREE.Camera | null = null
  private readonly frustum = new THREE.Frustum()
  private readonly projection = new THREE.Matrix4()
  private readonly cost = { calls: 0, triangles: 0 }

  begin(policy: VisualQualityPolicy, camera?: THREE.Camera): void {
    if (this.prepared) throw new Error('Transient visibility must be restored before preparing another frame')
    this.candidates.length = 0
    this.seen.clear()
    this.submitted = this.triangles = this.requested = this.omitted = 0
    this.protectedCalls = 0
    this.environmentCalls = 0
    this.camera = camera ?? null
    if (camera) {
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem, camera.reversedDepth)
    }
    if (this.policy !== policy) {
      const allocation = resolveVisualSubsystemAllocation(policy)
      this.limit = allocation?.transientEffectDraws ?? Infinity
      this.triangleLimit = allocation?.limits.postAndEffects.mainViewTriangles ?? Infinity
      this.policy = policy
    }
  }

  /** Reserve existing environment submissions, not every cloud outside the current view. */
  reserveEnvironment(root: THREE.Object3D): void {
    if (!this.camera) throw new Error('Environment draw reservation requires the production camera')
    root.updateWorldMatrix(true, true)
    this.reserveEnvironmentSources(root, this.camera)
  }

  private reserveEnvironmentSources(root: THREE.Object3D, camera: THREE.Camera): void {
    if (!root.visible) return
    if ((root instanceof THREE.Mesh || root instanceof THREE.Sprite || root instanceof THREE.Points || root instanceof THREE.Line) &&
        root.layers.test(camera.layers) &&
        (root.castShadow || !root.frustumCulled || (root instanceof THREE.Sprite
          ? this.frustum.intersectsSprite(root) : this.frustum.intersectsObject(root)))) {
      const before = this.requested
      this.add(root, 'environment', 250, true)
      this.environmentCalls += this.requested - before
    }
    for (const child of root.children) this.reserveEnvironmentSources(child, camera)
  }

  add(source: TransientSource, category: TransientCategory, priority: number, protectedSource = false): void {
    if (this.prepared || !this.policy) throw new Error('Transient source added outside frame preparation')
    if (this.seen.has(source)) return
    this.seen.add(source)
    source.userData.visualSubsystem = 'postAndEffects'
    source.userData.transientCategory = category
    for (let parent: THREE.Object3D | null = source; parent; parent = parent.parent) if (!parent.visible) return
    const cost = transientSourceCost(source, this.cost)
    let candidate = this.cache.get(source)
    if (!candidate) {
      candidate = { source, priority, calls: 0, triangles: 0, visible: true, protected: false }
      this.cache.set(source, candidate)
    }
    candidate.priority = priority
    candidate.calls = cost.calls
    candidate.triangles = cost.triangles
    candidate.visible = source.visible
    candidate.protected = protectedSource
    this.candidates.push(candidate)
    this.requested += cost.calls
  }

  addTree(root: THREE.Object3D, category: TransientCategory, priority: number, protectedSource = false): void {
    if (!root.visible) return
    if (root instanceof THREE.Mesh || root instanceof THREE.Sprite || root instanceof THREE.Points || root instanceof THREE.Line) {
      this.add(root, category, priority, protectedSource)
    }
    for (const child of root.children) this.addTree(child, category, priority, protectedSource)
  }

  apply(): void {
    if (this.prepared || !this.policy) throw new Error('Transient frame is not ready')
    this.prepared = true
    this.candidates.sort((left, right) => Number(right.protected) - Number(left.protected) ||
      right.priority - left.priority || left.source.id - right.source.id)
    for (const candidate of this.candidates) {
      if (!candidate.protected && (this.submitted + candidate.calls > this.limit || this.triangles + candidate.triangles > this.triangleLimit)) {
        candidate.source.visible = false
        this.omitted += candidate.calls
      } else {
        this.submitted += candidate.calls
        this.triangles += candidate.triangles
        if (candidate.protected) this.protectedCalls += candidate.calls
      }
    }
  }

  restore(): void {
    if (!this.prepared) return
    for (const candidate of this.candidates) candidate.source.visible = candidate.visible
    this.prepared = false
  }

  clear(): void {
    this.restore()
    this.candidates.length = 0
    this.seen.clear()
    this.policy = null
    this.camera = null
    this.submitted = this.triangles = this.requested = this.omitted = this.protectedCalls = 0
    this.environmentCalls = 0
  }

  snapshot() {
    return {
      drawLimit: Number.isFinite(this.limit) ? this.limit : null,
      requestedDrawUpperBound: this.requested, admittedDrawUpperBound: this.submitted,
      omittedDrawUpperBound: this.omitted, admittedMainTrianglesUpperBound: this.triangles,
      protectedDrawUpperBound: this.protectedCalls,
      reservedEnvironmentDrawUpperBound: this.environmentCalls,
      overBudget: this.submitted > this.limit || this.triangles > this.triangleLimit,
      measuredDraws: null, cpuMs: null, complete: false,
      missing: ['Actual per-subsystem GL submissions and CPU scopes', 'Persistent effects outside known environment roots and complete allocation closure'],
    }
  }
}

/** Snapshot-only backing inventory; no disposal transfer, GL measurement or hidden full-bucket claim. */
export function transientAllocationReceipts(sources: readonly TransientSource[]): VisualAllocationReceipt[] {
  const receipts: VisualAllocationReceipt[] = []
  const seen = new Set<object>()
  const add = (identity: object, bytes: number, kind: 'geometry' | 'other') => {
    if (seen.has(identity)) return
    seen.add(identity)
    receipts.push({ identity, cpuBytes: bytes, gpuBytes: null, kind, chargedTo: 'postAndEffects' })
  }
  for (const source of sources) {
    if (!(source instanceof THREE.Sprite)) {
      for (const attribute of Object.values(source.geometry.attributes)) {
        const array = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array
        add(array.buffer, array.buffer.byteLength, 'geometry')
      }
      if (source.geometry.index) add(source.geometry.index.array.buffer, source.geometry.index.array.buffer.byteLength, 'geometry')
      if (source instanceof THREE.InstancedMesh) {
        add(source.instanceMatrix.array.buffer, source.instanceMatrix.array.byteLength, 'geometry')
        if (source.instanceColor) add(source.instanceColor.array.buffer, source.instanceColor.array.byteLength, 'geometry')
      }
    }
    const materials = Array.isArray(source.material) ? source.material : [source.material]
    for (const material of materials) {
      if (!('map' in material) || !(material.map instanceof THREE.Texture)) continue
      const image: unknown = material.map.image
      if (typeof image !== 'object' || !image) continue
      if ('data' in image && ArrayBuffer.isView(image.data)) {
        add(image.data.buffer, image.data.buffer.byteLength, 'other')
      }
    }
  }
  return receipts
}
