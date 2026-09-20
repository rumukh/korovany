import * as THREE from 'three'
import { createArtStream } from './art/ArtRandom.ts'
import { sumVisualAllocationReceipts, type VisualAllocationReceipt } from './diagnostics/VisualBudgetAccounting.ts'
import { disposeOwnedVisualResources, type VisualResourceOwner } from './visualLifecycle.ts'
import type { VisualQualityPolicy } from './visualPolicy.ts'

export const SECONDARY_EFFECT_CAPACITY = 48
export const SECONDARY_EFFECT_REVISION = 'gfx-05-secondary-1'
export type SecondaryKind = 'spark' | 'shard' | 'chip' | 'dust' | 'blood' | 'splash'

// Position, velocity, age/lifetime, radius, priority, serial, RGB.
const STRIDE = 14
const AGE = 6, LIFE = 7, RADIUS = 8, PRIORITY = 9, SERIAL = 10, COLOR = 11

/** One bounded opaque instance batch. It owns no actor, hit result, light or gameplay clock. */
export class SecondaryEffectPool {
  readonly mesh: THREE.InstancedMesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>
  private readonly states = new Float64Array(SECONDARY_EFFECT_CAPACITY * STRIDE)
  private readonly rng
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly scale = new THREE.Vector3()
  private readonly color = new THREE.Color()
  private readonly outward = new THREE.Vector3()
  private readonly tangent = new THREE.Vector3()
  private readonly bitangent = new THREE.Vector3()
  private readonly owned: VisualResourceOwner[]
  private readonly receipts: readonly VisualAllocationReceipt[]
  private count = 0
  private serial = 0
  private disposed = false
  private accepted = 0
  private dropped = 0
  private replaced = 0

  constructor(scene: THREE.Scene, seed: number) {
    this.rng = createArtStream(seed, 'combat-secondary-1')
    const geometry = new THREE.OctahedronGeometry(1, 0)
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true, depthWrite: true })
    this.mesh = new THREE.InstancedMesh(geometry, material, SECONDARY_EFFECT_CAPACITY)
    this.owned = [geometry, material, this.mesh]
    this.mesh.name = 'secondary-contact-effects'
    this.mesh.userData.noComicOutline = true
    this.mesh.userData.visualSubsystem = 'postAndEffects'
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.visible = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.setColorAt(0, this.color)
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage)
    // Receipts describe actual backing stores, not an estimate of a GPU upload.
    const receipts: VisualAllocationReceipt[] = []
    for (const attribute of Object.values(geometry.attributes)) receipts.push({
      identity: attribute.array.buffer, chargedTo: 'postAndEffects', kind: 'geometry',
      cpuBytes: attribute.array.buffer.byteLength, gpuBytes: null,
    })
    for (const attribute of [this.mesh.instanceMatrix, this.mesh.instanceColor!]) receipts.push({
      identity: attribute.array.buffer, chargedTo: 'postAndEffects', kind: 'geometry',
      cpuBytes: attribute.array.buffer.byteLength, gpuBytes: null,
    })
    receipts.push({
      identity: this.states.buffer, chargedTo: 'postAndEffects', kind: 'other',
      cpuBytes: this.states.byteLength, gpuBytes: 0,
    })
    this.receipts = Object.freeze(receipts.map((receipt) => Object.freeze(receipt)))
    scene.add(this.mesh)
  }

  emit(
    kind: SecondaryKind,
    point: THREE.Vector3,
    direction: THREE.Vector3 | null,
    color: THREE.Color,
    requested: number,
    policy: Pick<VisualQualityPolicy, 'density' | 'reducedMotion'>,
    contactNormal?: THREE.Vector3,
  ): number {
    this.assertActive()
    if (!['spark', 'shard', 'chip', 'dust', 'blood', 'splash'].includes(kind) || !Number.isInteger(requested) || requested < 0 ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z) ||
        !Number.isFinite(color.r) || !Number.isFinite(color.g) || !Number.isFinite(color.b) ||
        (direction && (!Number.isFinite(direction.x) || !Number.isFinite(direction.y) || !Number.isFinite(direction.z))) ||
        (contactNormal && (!Number.isFinite(contactNormal.x) || !Number.isFinite(contactNormal.y) || !Number.isFinite(contactNormal.z)))) {
      throw new RangeError('Invalid secondary contact effect')
    }
    const density = policy.density.particles
    if (!Number.isFinite(density) || density < 0 || density > 1) throw new RangeError('Invalid secondary effect density')
    const limit = Math.floor(SECONDARY_EFFECT_CAPACITY * density)
    while (this.count > limit) {
      let weakest = 0
      for (let slot = 1; slot < this.count; slot++) {
        if (this.states[slot * STRIDE + PRIORITY] < this.states[weakest * STRIDE + PRIORITY] ||
            (this.states[slot * STRIDE + PRIORITY] === this.states[weakest * STRIDE + PRIORITY] &&
              this.states[slot * STRIDE + SERIAL] < this.states[weakest * STRIDE + SERIAL])) weakest = slot
      }
      this.count--
      this.states.copyWithin(weakest * STRIDE, this.count * STRIDE, (this.count + 1) * STRIDE)
      this.dropped++
    }
    const admitted = Math.min(SECONDARY_EFFECT_CAPACITY, Math.floor(requested * density))
    const priority = kind === 'spark' ? 1 : 0
    const motion = policy.reducedMotion ? 0.3 : 1
    const directionLength = direction ? Math.hypot(direction.x, direction.z) : 0
    const dx = directionLength > 0.0001 ? direction!.x / directionLength : 0
    const dz = directionLength > 0.0001 ? direction!.z / directionLength : 1
    if (contactNormal) {
      this.outward.copy(contactNormal).normalize()
      if (this.outward.lengthSq() < 1e-8) this.outward.set(0, 1, 0)
      this.tangent.set(Math.abs(this.outward.y) > 0.9 ? 1 : 0, Math.abs(this.outward.y) > 0.9 ? 0 : 1, 0)
        .cross(this.outward).normalize()
      this.bitangent.crossVectors(this.outward, this.tangent).normalize()
    }
    let emitted = 0
    this.dropped += requested - admitted
    for (let index = 0; index < admitted; index++) {
      const slot = this.acquire(limit, priority)
      if (slot < 0) { this.dropped++; continue }
      const offset = slot * STRIDE
      const side = (this.rng.next() - 0.5) * (kind === 'spark' ? 8 : 4) * motion
      const outward = (kind === 'spark' ? 1.5 + this.rng.next() * 3 : (this.rng.next() - 0.5) * 4) * motion
      this.states[offset] = point.x
      this.states[offset + 1] = point.y
      this.states[offset + 2] = point.z
      this.states[offset + 3] = dx * outward - dz * side
      this.states[offset + 4] = (kind === 'spark' ? 4 + this.rng.next() * 5 : 2 + this.rng.next() * 4) * motion
      this.states[offset + 5] = dz * outward + dx * side
      if (contactNormal) {
        const spread = (this.rng.next() - 0.5) * 2 * motion
        const force = Math.abs(outward) + motion
        for (let axis = 0; axis < 3; axis++) this.states[offset + 3 + axis] =
          this.outward.getComponent(axis) * force + this.tangent.getComponent(axis) * side +
          this.bitangent.getComponent(axis) * spread
      }
      this.states[offset + AGE] = 0
      this.states[offset + LIFE] = kind === 'spark' ? 0.24 : kind === 'shard' ? 0.55 + this.rng.next() * 0.35 : 0.3 + this.rng.next() * 0.2
      this.states[offset + RADIUS] = kind === 'spark' ? 0.055 : kind === 'shard' ? 0.12 : kind === 'dust' ? 0.065 : 0.045
      this.states[offset + PRIORITY] = priority
      this.states[offset + SERIAL] = ++this.serial
      const whiteSpark = kind === 'spark' && index % 3 === 0
      const strength = kind === 'spark' ? 1.35 : 1
      this.states[offset + COLOR] = (whiteSpark ? 1 : color.r) * strength
      this.states[offset + COLOR + 1] = (whiteSpark ? 1 : color.g) * strength
      this.states[offset + COLOR + 2] = (whiteSpark ? 1 : color.b) * strength
      emitted++
    }
    this.accepted += emitted
    this.writeInstances(policy.reducedMotion)
    return emitted
  }

  private acquire(limit: number, priority: number): number {
    if (this.count < limit) return this.count++
    let oldest = -1
    for (let slot = 0; slot < this.count; slot++) {
      if (this.states[slot * STRIDE + PRIORITY] >= priority) continue
      if (oldest < 0 || this.states[slot * STRIDE + SERIAL] < this.states[oldest * STRIDE + SERIAL]) oldest = slot
    }
    if (limit === 0 || oldest < 0) return -1
    this.replaced++
    return oldest
  }

  update(delta: number, reducedMotion: boolean): void {
    this.assertActive()
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Invalid secondary effect delta')
    for (let slot = this.count - 1; slot >= 0; slot--) {
      const offset = slot * STRIDE
      this.states[offset + AGE] += delta
      if (this.states[offset + AGE] >= this.states[offset + LIFE]) {
        this.count--
        this.states.copyWithin(offset, this.count * STRIDE, (this.count + 1) * STRIDE)
        continue
      }
      this.states[offset + 4] -= delta * (this.states[offset + PRIORITY] ? 18 : 9) * (reducedMotion ? 0.3 : 1)
      for (let axis = 0; axis < 3; axis++) this.states[offset + axis] += this.states[offset + axis + 3] * delta
    }
    this.writeInstances(reducedMotion)
  }

  private writeInstances(reducedMotion: boolean): void {
    for (let slot = 0; slot < this.count; slot++) {
      const offset = slot * STRIDE
      const age = this.states[offset + AGE]
      const radius = this.states[offset + RADIUS] * Math.max(0.01, 1 - age / this.states[offset + LIFE])
      this.position.fromArray(this.states, offset)
      this.scale.setScalar(radius)
      this.euler.set(reducedMotion ? 0 : age * 14, 0, reducedMotion ? 0 : age * 11)
      this.rotation.setFromEuler(this.euler)
      this.matrix.compose(this.position, this.rotation, this.scale)
      this.mesh.setMatrixAt(slot, this.matrix)
      this.color.fromArray(this.states, offset + COLOR)
      this.mesh.setColorAt(slot, this.color)
    }
    this.mesh.count = this.count
    this.mesh.visible = this.count > 0
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  clear(): void {
    this.count = 0
    this.mesh.count = 0
    this.mesh.visible = false
    this.states.fill(0)
  }

  getAllocationReceipts(): readonly VisualAllocationReceipt[] {
    return this.disposed ? [] : this.receipts
  }

  snapshot() {
    return {
      revision: SECONDARY_EFFECT_REVISION, capacity: SECONDARY_EFFECT_CAPACITY,
      active: this.count, accepted: this.accepted, dropped: this.dropped, replaced: this.replaced,
      // Potential source work only. The existing frame meter owns actual rendered submissions.
      sourceDrawCeiling: 1, sourceTriangles: this.count * 8,
      resources: sumVisualAllocationReceipts(this.getAllocationReceipts()).postAndEffects,
      resourcesComplete: false, cpuMs: null, draws: null,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clear()
    this.mesh.removeFromParent()
    disposeOwnedVisualResources(this.owned)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Secondary effect pool is disposed')
  }
}
