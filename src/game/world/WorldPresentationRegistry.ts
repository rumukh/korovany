import * as THREE from 'three'
import { StylizedArtLibrary, type ArtRenderSourceBinding } from '../art/index.ts'
import {
  sweepCameraSphere,
  type CameraSweepResult,
  type CameraTriangleSource,
  type CameraVolumeQuery,
} from '../cameraVisibility.ts'
import { dampingAlpha } from '../cameraAccents.ts'
import type { VisualQualityPolicy } from '../visualPolicy.ts'

export const FOREGROUND_FADE_LIMIT = 8
export const PRESENTATION_SOURCE_LIMIT = 1024
export const PRESENTATION_INSTANCE_LIMIT = 4096

export interface PresentationRegistration {
  dispose(): void
}

interface SourceDescriptor {
  readonly id: string
  readonly regionId: string
  readonly binding: ArtRenderSourceBinding
}

export interface OccluderDescriptor extends SourceDescriptor {
  readonly kind: 'solid' | 'foreground'
}

export interface ShadowCasterDescriptor extends SourceDescriptor {
  readonly priority: 'building' | 'canopy' | 'rock'
}

interface Entry {
  descriptor: SourceDescriptor
  kind?: 'solid' | 'foreground'
  priority?: ShadowCasterDescriptor['priority']
  pieces: Array<{ geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; bounds: THREE.Box3; index: number }>
  lods: THREE.LOD[]
  active: boolean
  distance: number
  released: boolean
}

interface Fade {
  entry: Entry | null
  index: number
  wanted: boolean
  value: number
}

export interface WorldPresentationDebug {
  sources: number
  instances: number
  fadedInstances: number
  shadowDraws: number
  shadowInstances: number
  shadowTriangles: number
  selectedShadowInstances: number
  rejectedShadowBatches: number
}

export function shadowSubmissionCost(
  mesh: THREE.Mesh,
  output = { draws: 0, instances: 0, triangles: 0 },
): { draws: number; instances: number; triangles: number } {
  const geometry = mesh.geometry
  const count = geometry.index?.count ?? geometry.getAttribute('position').count
  const start = Math.max(0, geometry.drawRange.start)
  const end = Math.min(count, start + geometry.drawRange.count)
  const instanceCount = mesh instanceof THREE.InstancedMesh ? mesh.count : 1
  let draws = 0
  let vertices = 0
  if (Array.isArray(mesh.material)) {
    for (const group of geometry.groups) {
      const material = mesh.material[group.materialIndex ?? 0]
      if (!material?.visible) continue
      const length = Math.max(0, Math.min(end, group.start + group.count) - Math.max(start, group.start))
      if (length < 3) continue
      draws++
      vertices += Math.floor(length / 3) * 3
    }
  } else if (mesh.material.visible && end - start >= 3) {
    draws = 1
    vertices = Math.floor((end - start) / 3) * 3
  }
  output.draws = instanceCount > 0 ? draws : 0
  output.instances = draws * instanceCount
  output.triangles = vertices / 3 * instanceCount
  return output
}

export class WorldPresentationRegistry implements CameraVolumeQuery {
  readonly debug: WorldPresentationDebug = {
    sources: 0, instances: 0, fadedInstances: 0, shadowDraws: 0, shadowInstances: 0,
    shadowTriangles: 0, selectedShadowInstances: 0, rejectedShadowBatches: 0,
  }
  private readonly entries = new Map<string, Entry>()
  private readonly candidates: CameraTriangleSource[] = []
  private readonly shadowCandidates: Entry[] = []
  private readonly fades: Fade[] = Array.from({ length: FOREGROUND_FADE_LIMIT }, () => ({
    entry: null, index: 0, wanted: false, value: 1,
  }))
  private readonly instance = new THREE.Matrix4()
  private readonly ray = new THREE.Ray()
  private readonly delta = new THREE.Vector3()
  private readonly point = new THREE.Vector3()
  private readonly bounds = new THREE.Box3()
  private readonly shadowCost = { draws: 0, instances: 0, triangles: 0 }
  private readonly art: StylizedArtLibrary
  private disposed = false

  constructor(art: StylizedArtLibrary) { this.art = art }

  registerOccluder(descriptor: OccluderDescriptor): PresentationRegistration {
    return this.register(`occluder:${descriptor.id}`, descriptor, descriptor.kind)
  }

  registerShadowCaster(descriptor: ShadowCasterDescriptor): PresentationRegistration {
    return this.register(`shadow:${descriptor.id}`, descriptor, undefined, descriptor.priority)
  }

  prepare(camera: THREE.PerspectiveCamera): void {
    for (const entry of this.entries.values()) {
      const { source, bounds } = entry.descriptor.binding
      for (const lod of entry.lods) lod.update(camera)
      source.updateWorldMatrix(true, false)
      entry.active = true
      for (let node: THREE.Object3D | null = source; node !== null; node = node.parent) {
        if (!node.visible) { entry.active = false; break }
      }
      const count = source instanceof THREE.InstancedMesh ? source.count : 1
      if (count > entry.pieces.length) throw new Error('Presentation instance capacity changed without re-registration')
      for (let index = 0; index < count; index++) {
        const piece = entry.pieces[index]
        piece.geometry = source.geometry
        piece.matrix.copy(source.matrixWorld)
        if (source instanceof THREE.InstancedMesh) {
          source.getMatrixAt(index, this.instance)
          piece.matrix.multiply(this.instance)
        }
        piece.bounds.copy(bounds).applyMatrix4(piece.matrix)
      }
    }
  }

  sweep(from: THREE.Vector3, to: THREE.Vector3, radius: number, result: CameraSweepResult): void {
    this.candidates.length = 0
    for (const entry of this.entries.values()) {
      if (!entry.active || entry.kind !== 'solid') continue
      const source = entry.descriptor.binding.source
      const count = source instanceof THREE.InstancedMesh ? source.count : 1
      for (let index = 0; index < count; index++) this.candidates.push(entry.pieces[index])
    }
    sweepCameraSphere(from, to, radius, this.candidates, result)
  }

  updateForeground(camera: THREE.Vector3, subjects: readonly THREE.Vector3[], delta: number, immediate: boolean): void {
    for (const fade of this.fades) fade.wanted = false
    for (const entry of this.entries.values()) {
      if (!entry.active || entry.kind !== 'foreground') continue
      const source = entry.descriptor.binding.source
      const count = source instanceof THREE.InstancedMesh ? source.count : 1
      for (let index = 0; index < count; index++) {
        const piece = entry.pieces[index]
        if (piece.bounds.distanceToPoint(camera) > 18) continue
        let obstructs = false
        for (const subject of subjects) {
          const distance = this.delta.subVectors(subject, camera).length()
          if (distance < 0.1 || distance > 22) continue
          this.ray.set(camera, this.delta.multiplyScalar(1 / distance))
          this.bounds.copy(piece.bounds).expandByScalar(0.35)
          if (this.bounds.containsPoint(camera) ||
              (this.ray.intersectBox(this.bounds, this.point) && this.point.distanceTo(camera) < distance - 0.15)) {
            obstructs = true
            break
          }
        }
        if (!obstructs) continue
        let fade = this.fades.find((value) => value.entry === entry && value.index === index)
        if (!fade) {
          fade = this.fades.find((value) => value.entry === null)
          if (!fade) continue
          fade.entry = entry; fade.index = index; fade.value = 1
        }
        fade.wanted = true
      }
    }
    this.debug.fadedInstances = 0
    for (const fade of this.fades) {
      if (!fade.entry) continue
      const source = fade.entry.descriptor.binding.source
      if (!fade.entry.active || (source instanceof THREE.InstancedMesh && fade.index >= source.count)) fade.wanted = false
      fade.value = immediate ? (fade.wanted ? 0 : 1) :
        THREE.MathUtils.lerp(fade.value, fade.wanted ? 0 : 1, dampingAlpha(fade.wanted ? 18 : 7, delta))
      if (fade.value > 0.995 && !fade.wanted) fade.value = 1
      if (fade.value < 0.005 && fade.wanted) fade.value = 0
      this.art.setSourceVisibility(fade.entry.descriptor.binding, fade.value,
        source instanceof THREE.InstancedMesh ? fade.index : undefined)
      if (fade.value === 1 && !fade.wanted) fade.entry = null
      else this.debug.fadedInstances++
    }
  }

  updateShadows(anchor: THREE.Vector3, policy: VisualQualityPolicy['shadows']): void {
    this.debug.shadowDraws = this.debug.shadowInstances = this.debug.shadowTriangles = 0
    this.debug.selectedShadowInstances = this.debug.rejectedShadowBatches = 0
    this.shadowCandidates.length = 0
    for (const entry of this.entries.values()) {
      if (!entry.priority) continue
      const source = entry.descriptor.binding.source
      source.castShadow = false
      if (!entry.active || policy.worldCasterBudget === 0) continue
      const count = source instanceof THREE.InstancedMesh ? source.count : 1
      entry.distance = Infinity
      for (let index = 0; index < count; index++) {
        entry.distance = Math.min(entry.distance, entry.pieces[index].bounds.distanceToPoint(anchor))
      }
      if (entry.distance <= policy.worldDistance) this.shadowCandidates.push(entry)
    }
    this.shadowCandidates.sort((left, right) =>
      shadowPriority(left.priority!) - shadowPriority(right.priority!) || left.distance - right.distance ||
      left.descriptor.id.localeCompare(right.descriptor.id))
    for (const entry of this.shadowCandidates) {
      const source = entry.descriptor.binding.source
      const cost = shadowSubmissionCost(source, this.shadowCost)
      if (this.debug.shadowDraws + cost.draws > policy.worldCasterBudget ||
          this.debug.shadowInstances + cost.instances > policy.worldInstanceBudget ||
          this.debug.shadowTriangles + cost.triangles > policy.worldTriangleBudget) {
        this.debug.rejectedShadowBatches++
        continue
      }
      source.castShadow = cost.draws > 0
      this.debug.shadowDraws += cost.draws
      this.debug.shadowInstances += cost.instances
      this.debug.shadowTriangles += cost.triangles
      const count = source instanceof THREE.InstancedMesh ? source.count : 1
      for (let index = 0; index < count; index++) {
        const selected = entry.pieces[index].bounds.distanceToPoint(anchor) <= policy.worldDistance
        if (selected) this.debug.selectedShadowInstances++
        if (source instanceof THREE.InstancedMesh) {
          this.art.setShadowParticipation(entry.descriptor.binding, selected ? 1 : 0, index)
        }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    for (const fade of this.fades) {
      if (fade.entry) this.art.setSourceVisibility(fade.entry.descriptor.binding, 1,
        fade.entry.descriptor.binding.source instanceof THREE.InstancedMesh ? fade.index : undefined)
      fade.entry = null
    }
    for (const entry of this.entries.values()) if (entry.priority) entry.descriptor.binding.source.castShadow = false
    this.disposed = true
    this.entries.clear()
    this.candidates.length = this.shadowCandidates.length = 0
    this.debug.sources = this.debug.instances = this.debug.fadedInstances = 0
  }

  private register(key: string, descriptor: SourceDescriptor, kind?: Entry['kind'], priority?: Entry['priority']): PresentationRegistration {
    const { source, bounds } = descriptor.binding
    const count = source instanceof THREE.InstancedMesh ? source.instanceMatrix.count : 1
    if (this.disposed || this.entries.has(key) || this.entries.size >= PRESENTATION_SOURCE_LIMIT ||
        this.debug.instances + count > PRESENTATION_INSTANCE_LIMIT || bounds.isEmpty() ||
        ![bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)) {
      throw new Error(`Invalid or over-budget presentation registration: ${key}`)
    }
    const lods: THREE.LOD[] = []
    for (let node = source.parent; node; node = node.parent) if (node instanceof THREE.LOD) lods.push(node)
    const entry: Entry = {
      descriptor, kind, priority, lods, active: false, distance: 0, released: false,
      pieces: Array.from({ length: count }, (_, index) => ({
        geometry: source.geometry, matrix: new THREE.Matrix4(), bounds: new THREE.Box3(), index,
      })),
    }
    this.entries.set(key, entry)
    this.debug.sources++
    this.debug.instances += count
    return {
      dispose: () => {
        if (entry.released) return
        entry.released = true
        for (const fade of this.fades) {
          if (fade.entry !== entry) continue
          this.art.setSourceVisibility(descriptor.binding, 1, source instanceof THREE.InstancedMesh ? fade.index : undefined)
          fade.entry = null
        }
        if (priority) source.castShadow = false
        this.entries.delete(key)
        this.candidates.length = this.shadowCandidates.length = 0
        if (!this.disposed) { this.debug.sources--; this.debug.instances -= count }
      },
    }
  }
}

function shadowPriority(priority: ShadowCasterDescriptor['priority']): number {
  return priority === 'building' ? 0 : priority === 'canopy' ? 1 : 2
}

const lightDirection = new THREE.Vector3()
const lightRight = new THREE.Vector3()
const lightUp = new THREE.Vector3()
const lightAnchor = new THREE.Vector3()
const worldUp = new THREE.Vector3(0, 1, 0)

export function stabilizeKeyLight(light: THREE.DirectionalLight, anchor: THREE.Vector3, halfExtent: number): void {
  lightDirection.subVectors(light.position, light.target.position).normalize()
  if (lightDirection.lengthSq() < 0.5) throw new Error('Key light has no direction')
  lightRight.crossVectors(worldUp, lightDirection)
  if (lightRight.lengthSq() < 1e-8) lightRight.set(1, 0, 0)
  else lightRight.normalize()
  lightUp.crossVectors(lightDirection, lightRight).normalize()
  const texel = halfExtent * 2 / light.shadow.mapSize.x
  lightAnchor.copy(anchor)
  const x = lightAnchor.dot(lightRight), y = lightAnchor.dot(lightUp)
  lightAnchor.addScaledVector(lightRight, Math.round(x / texel) * texel - x)
  lightAnchor.addScaledVector(lightUp, Math.round(y / texel) * texel - y)
  light.target.position.copy(lightAnchor)
  light.position.copy(lightAnchor).addScaledVector(lightDirection, 90)
  const camera = light.shadow.camera
  if (camera.left !== -halfExtent) {
    camera.left = camera.bottom = -halfExtent
    camera.right = camera.top = halfExtent
    camera.updateProjectionMatrix()
  }
}
