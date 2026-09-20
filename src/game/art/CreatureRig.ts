import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { GeometryCache } from './GeometryCache.ts'
import { StylizedArtLibrary } from './StylizedArtLibrary.ts'
import { ART_SURFACE_ATTRIBUTE } from './ArtPresentation.ts'
import { SURFACE_WEATHER_RESPONSE, bakeWeatherResponse } from './AtmospherePresentation.ts'
import type { ArtGeometryLease, ArtRenderSourceBinding } from './ArtRenderBinding.ts'
import { bakeOutlineNormals } from './GeometryKit.ts'
import { buildCreatureLimbSegment, buildCreatureFoot, type BeastKind, type CharacterVisualLevel } from './CharacterKit.ts'
import type { VisualQualityPolicy } from '../visualPolicy.ts'
import type { VisualAllocationReceipt } from '../diagnostics/VisualBudgetAccounting.ts'
import { disposeOwnedVisualResources } from '../visualLifecycle.ts'
import { TerrainFootFrame, selectCharacterVisualLevel, type CharacterContact, type CharacterContactPart } from './CharacterRig.ts'

const CREATURES = new WeakMap<THREE.Object3D, CreaturePresenter>()
export function creaturePresenter(root: THREE.Object3D): CreaturePresenter | undefined { return CREATURES.get(root) }

export interface CreatureLeg {
  readonly upper: THREE.Object3D
  readonly knee: THREE.Object3D
  readonly foot: THREE.Object3D
  readonly upperLength: number
  readonly lowerLength: number
  readonly front: boolean
  readonly side: number
  readonly supportsWeight: boolean
}

/** Shared by beasts, deer and the ox team; geometry is fresh until the caller caches it. */
export function createCreatureLeg(
  kind: BeastKind | 'deer' | 'ox', name: string, length: number, front: boolean, side: number,
  material: THREE.MeshStandardMaterial, build: (key: string, factory: () => THREE.BufferGeometry) => THREE.BufferGeometry,
): CreatureLeg {
  const upper = new THREE.Group()
  upper.name = name
  const upperLength = length * (kind === 'deer' ? 0.55 : 0.52)
  const lowerLength = length - upperLength
  const thigh = new THREE.Mesh(build(`creature-upper:${kind}:${length}`, () => buildCreatureLimbSegment(kind, upperLength, true)), material)
  thigh.name = `${name}-upper`
  upper.add(thigh)
  const knee = new THREE.Group()
  knee.name = name === 'leftArm' ? 'leftElbow' : name === 'rightArm' ? 'rightElbow'
    : name === 'leftLeg' ? 'leftKnee' : name === 'rightLeg' ? 'rightKnee' : `${name}-knee`
  knee.position.y = -upperLength
  upper.add(knee)
  const shin = new THREE.Mesh(build(`creature-lower:${kind}:${length}`, () => buildCreatureLimbSegment(kind, lowerLength, false)), material)
  shin.name = `${name}-lower`
  knee.add(shin)
  const foot = new THREE.Group()
  foot.name = `${name}-foot`
  foot.position.y = -lowerLength
  knee.add(foot)
  const hoof = new THREE.Mesh(build(`creature-foot:${kind}`, () => buildCreatureFoot(kind)), material)
  hoof.name = `${name}-sole`
  foot.add(hoof)
  return { upper, knee, foot, upperLength, lowerLength, front, side, supportsWeight: !(kind === 'troll' && front) }
}

/**
 * Batches the production animal's rigid surfaces without replacing its pose hierarchy.
 * Named meshes become bone anchors; the existing creature animator still owns the joints.
 */
export class CreaturePresenter {
  readonly root: THREE.Group
  readonly source: THREE.SkinnedMesh
  readonly skeleton: THREE.Skeleton
  readonly binding: ArtRenderSourceBinding
  readonly legs: readonly CreatureLeg[]
  readonly wings: readonly [THREE.Object3D, THREE.Object3D] | null
  readonly perchFeet: readonly THREE.Object3D[]
  level: CharacterVisualLevel = 'near'
  private readonly art: StylizedArtLibrary
  private readonly cache: GeometryCache
  private readonly key: string
  private readonly base: THREE.BufferGeometry
  private readonly limbByBone: string[]
  private readonly hidden = new Set<string>()
  private readonly contacts = new Map<CharacterContactPart, THREE.Object3D>()
  private readonly normalMatrix = new THREE.Matrix3()
  private readonly world = new THREE.Vector3()
  private readonly local = new THREE.Vector3()
  private readonly rest = new THREE.Vector3()
  private readonly inverse = new THREE.Matrix4()
  private readonly footFrame = new TerrainFootFrame()
  private readonly height: number
  private disposed = false

  constructor(
    root: THREE.Group, art: StylizedArtLibrary, cache: GeometryCache, key: string,
    legs: readonly CreatureLeg[] = [], excludedNames: readonly string[] = [],
  ) {
    this.root = root; this.art = art; this.cache = cache; this.key = key; this.legs = legs
    const leftWing = root.getObjectByName('leftWing'), rightWing = root.getObjectByName('rightWing')
    this.wings = leftWing && rightWing ? [leftWing, rightWing] : null
    const leftFoot = root.getObjectByName('leftBirdFoot'), rightFoot = root.getObjectByName('rightBirdFoot')
    this.perchFeet = leftFoot && rightFoot ? [leftFoot, rightFoot] : []
    const originals: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = []
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && !(node instanceof THREE.SkinnedMesh) &&
          !excludedNames.includes(node.name) && node.material instanceof THREE.MeshStandardMaterial &&
          StylizedArtLibrary.isOpaque(node.material) && !node.userData.noComicOutline) originals.push(node)
    })
    if (!originals.length || originals.length > 64) throw new Error('Creature requires 1..64 physical rigid parts')
    root.updateWorldMatrix(true, true)
    const rootInverse = root.matrixWorld.clone().invert()
    const binds = originals.map((node) => new THREE.Matrix4().multiplyMatrices(rootInverse, node.matrixWorld))
    this.limbByBone = originals.map((node) => {
      for (let parent: THREE.Object3D | null = node; parent && parent !== root; parent = parent.parent) {
        if (['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].includes(parent.name)) return parent.name
      }
      return ''
    })
    this.base = cache.acquire(key, () => {
      const parts: THREE.BufferGeometry[] = []
      try {
        originals.forEach((source, bone) => {
          const copy = source.geometry.clone()
          copy.deleteAttribute('uv')
          let geometry: THREE.BufferGeometry
          if (copy.index) geometry = copy
          else {
            try { geometry = mergeVertices(copy, 1e-5) } finally { copy.dispose() }
          }
          parts.push(geometry)
          geometry.applyMatrix4(binds[bone])
          bakeOutlineNormals(geometry)
          const count = geometry.getAttribute('position').count
          const color = new Float32Array(count * 3), response = new Float32Array(count * 4)
          const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4)
          const rgb = source.material.color
          for (let i = 0; i < count; i++) {
            color[i * 3] = rgb.r; color[i * 3 + 1] = rgb.g; color[i * 3 + 2] = rgb.b
            response[i * 4] = source.material.roughness; response[i * 4 + 1] = source.material.metalness
            response[i * 4 + 2] = 0.58; response[i * 4 + 3] = 0.12
            indices[i * 4] = bone; weights[i * 4] = 1
          }
          geometry.setAttribute('color', new THREE.BufferAttribute(color, 3))
          geometry.setAttribute(ART_SURFACE_ATTRIBUTE, new THREE.BufferAttribute(response, 4))
          const weather = Object.entries(SURFACE_WEATHER_RESPONSE)
            .find(([surface]) => surface === source.material.userData.stylizedSurfacePreset)?.[1]
          if (!weather) throw new Error('Creature source material has no physical weather preset')
          bakeWeatherResponse(geometry, weather)
          geometry.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4))
          geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
        })
        const geometry = mergeGeometries(parts, false)
        if (!geometry) throw new Error('Creature rigid parts have incompatible attributes')
        StylizedArtLibrary.markLibraryOwned(geometry)
        return geometry
      } finally { for (const part of parts) part.dispose() }
    })
    const bones = originals.map((source) => {
      const bone = new THREE.Bone()
      bone.name = source.name
      bone.position.copy(source.position)
      bone.quaternion.copy(source.quaternion)
      bone.scale.copy(source.scale)
      source.parent!.add(bone)
      for (const child of [...source.children]) bone.add(child)
      source.removeFromParent()
      return bone
    })
    root.updateWorldMatrix(true, true)
    this.skeleton = new THREE.Skeleton(bones)
    for (const name of ['torso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const) {
      const node = root.getObjectByName(name)
      if (node) this.contacts.set(name, node)
    }
    let lease: ArtGeometryLease | undefined
    let source: THREE.SkinnedMesh | undefined
    try {
      const material = art.acquireMaterial('creature:mixed:response-weather-v1', {
        color: 0xffffff, surface: 'cloth', vertexColors: true, attributes: { surfaceResponse: true, weatherResponse: true },
      })
      // The rig retains the canonical body independently of the binding's active view.
      cache.acquire(key, () => { throw new Error('Creature canonical body receipt was lost') })
      let released = false
      lease = { geometry: this.base, release: () => {
        if (!released) { released = true; cache.release(key) }
      } }
      this.source = source = new THREE.SkinnedMesh(this.base, material)
      source.name = `${key}-batch`
      source.castShadow = source.receiveShadow = true
      source.userData.visualSubsystem = 'dynamicArt'
      root.add(source)
      source.bind(this.skeleton, root.matrixWorld)
      this.binding = art.bindRenderSource(source, { geometryLease: lease, deformationPadding: 1.2 })
    } catch (error) {
      const cleanup = [
        { dispose: () => cache.release(key) },
        { dispose: () => this.skeleton.dispose() },
        { dispose: () => lease?.release() },
      ]
      source?.removeFromParent()
      for (let i = originals.length - 1; i >= 0; i--) {
        const bone = bones[i], original = originals[i]
        bone.parent?.add(original)
        for (const child of [...bone.children]) original.add(child)
        bone.removeFromParent()
      }
      try { disposeOwnedVisualResources(cleanup) } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Creature construction and cleanup failed')
      }
      throw error
    }
    this.height = this.base.boundingBox!.max.y - this.base.boundingBox!.min.y
    CREATURES.set(root, this)
  }

  hideLimb(name: string): void {
    if (this.disposed) throw new Error('Creature presenter is disposed')
    if (this.hidden.has(name)) return
    if (!this.limbByBone.includes(name)) throw new Error(`Creature has no limb partition ${name}`)
    const hidden = new Set(this.hidden).add(name)
    const geometry = this.base.clone()
    const index = geometry.index!, skin = geometry.getAttribute('skinIndex')
    const indices: number[] = []
    for (let i = 0; i < index.count; i += 3) {
      if (hidden.has(this.limbByBone[skin.getX(index.getX(i))])) continue
      indices.push(index.getX(i), index.getX(i + 1), index.getX(i + 2))
    }
    geometry.setIndex(indices)
    StylizedArtLibrary.markLibraryOwned(geometry)
    let released = false
    const lease: ArtGeometryLease = { geometry, release: () => {
      if (!released) { released = true; geometry.dispose() }
    } }
    let outcome
    try { outcome = this.art.replaceRenderSourceGeometry(this.binding, lease) }
    catch (error) { lease.release(); throw error }
    this.hidden.add(name)
    const limb = this.contacts.get(name as CharacterContactPart)
    if (limb) limb.visible = false
    if (outcome.status === 'committed-with-errors') throw outcome.error
  }

  poseFeet(delta: number, stride: number, sampleHeight: (x: number, z: number) => number): void {
    if (this.disposed) throw new Error('Creature presenter is disposed')
    this.root.updateWorldMatrix(true, true)
    for (const leg of this.legs) {
      if (!leg.upper.visible || !leg.supportsWeight) continue
      const gait = stride * leg.side * (leg.front ? -1 : 1)
      const bend = 0.12 + Math.max(0, -gait) * 0.8
      leg.knee.rotation.x = THREE.MathUtils.damp(leg.knee.rotation.x, bend, 14, delta)
      if (this.level === 'far') {
        this.footFrame.reset(leg.foot)
        continue
      }
      leg.knee.updateWorldMatrix(true, false)
      this.world.set(0, -leg.lowerLength, 0).applyMatrix4(leg.knee.matrixWorld)
      const ground = sampleHeight(this.world.x, this.world.z)
      if (!Number.isFinite(ground)) throw new Error('Creature terrain sample is non-finite')
      this.world.y += THREE.MathUtils.clamp(ground + Math.max(0, -gait) * 0.1 - this.world.y, -0.16, 0.16)
      this.inverse.copy(leg.upper.parent!.matrixWorld).invert()
      this.local.copy(this.world).applyMatrix4(this.inverse).sub(leg.upper.position)
      const length = this.local.length()
      const upper = leg.upperLength, lower = leg.lowerLength, scale = leg.upper.scale.y
      let lo = 0.02, hi = 2.55
      for (let i = 0; i < 14; i++) {
        const angle = (lo + hi) * 0.5
        if (Math.hypot((upper + lower * Math.cos(angle)) * scale, lower * Math.sin(angle)) > length) lo = angle
        else hi = angle
      }
      const angle = (lo + hi) * 0.5
      this.rest.set(0, -(upper + lower * Math.cos(angle)) * scale, -lower * Math.sin(angle)).normalize()
      leg.upper.quaternion.setFromUnitVectors(this.rest, this.local.normalize())
      leg.knee.rotation.set(angle, 0, 0, 'XYZ')
      this.footFrame.apply(leg.foot, this.root, sampleHeight)
    }
  }

  poseWildlife(time: number, panic: boolean, delta: number, sampleHeight: (x: number, z: number) => number): void {
    if (this.disposed) throw new Error('Creature presenter is disposed')
    if (this.wings) {
      const flap = Math.sin(time * (panic ? 26 : 3)) * (panic ? 0.9 : 0.1)
      this.wings[0].rotation.z = -flap
      this.wings[1].rotation.z = flap
      this.wings[0].rotation.x = this.wings[1].rotation.x = panic ? -0.12 : 0.06
      for (const foot of this.perchFeet) {
        this.footFrame.reset(foot)
        foot.position.y = panic ? 0.07 : 0
        foot.rotation.x = panic ? -0.8 : 0
        if (!panic && this.level !== 'far') this.footFrame.apply(foot, this.root, sampleHeight)
      }
      return
    }
    const stride = Math.sin(time * (panic ? 12 : 2.4)) * (panic ? 0.55 : 0.12)
    for (const leg of this.legs) leg.upper.rotation.x = stride * leg.side * (leg.front ? -1 : 1)
    this.poseFeet(delta, stride, sampleHeight)
  }

  updateLod(camera: THREE.PerspectiveCamera, policy: VisualQualityPolicy): void {
    if (this.disposed) throw new Error('Creature presenter is disposed')
    this.root.getWorldPosition(this.world)
    const distance = Math.max(0.2, this.world.distanceTo(camera.position))
    const projected = this.height * this.root.scale.y * camera.zoom * policy.lod.distanceScale /
      (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    const hero = projected > 0.36 * (this.level === 'hero' ? 1 - policy.lod.hysteresis : 1 + policy.lod.hysteresis)
    this.level = selectCharacterVisualLevel(this.level, projected, hero, policy.lod.hysteresis)
    const ink = this.level !== 'far'
    this.source.userData.characterInkEnabled = ink
    this.source.castShadow = policy.quality !== 'low' && (this.level === 'near' || this.level === 'hero')
    for (const child of this.source.children) {
      if (!StylizedArtLibrary.isOutlineShell(child)) continue
      if (typeof child.userData.policyOutlineEnabled === 'boolean') child.visible = child.userData.policyOutlineEnabled && ink
      else if (!ink) child.visible = false
    }
  }

  sampleContact(part: CharacterContactPart, target: CharacterContact): boolean {
    if (this.disposed) throw new Error('Creature presenter is disposed')
    const node = this.contacts.get(part)
    if (!node || this.hidden.has(part)) return false
    for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent) {
      if (!parent.visible) return false
    }
    node.updateWorldMatrix(true, false)
    target.point.set(0, part === 'head' || part === 'torso' ? 0 : -0.2, part === 'head' ? 0.32 : 0.13)
      .applyMatrix4(node.matrixWorld)
    this.normalMatrix.getNormalMatrix(node.matrixWorld)
    target.normal.set(0, 0, 1).applyMatrix3(this.normalMatrix).normalize()
    target.surface = part === 'head' ? 'skin' : 'hair'
    return true
  }

  allocationReceipts(): VisualAllocationReceipt[] {
    if (this.disposed) throw new Error('Creature presenter is disposed')
    const receipts: VisualAllocationReceipt[] = []
    for (const geometry of new Set([this.base, this.source.geometry])) {
      const buffers = new Set<ArrayBufferLike>()
      for (const attribute of Object.values(geometry.attributes)) buffers.add(attribute.array.buffer)
      if (geometry.index) buffers.add(geometry.index.array.buffer)
      for (const identity of buffers) receipts.push({
        identity, chargedTo: 'dynamicArt', kind: 'geometry', cpuBytes: identity.byteLength, gpuBytes: null,
      })
    }
    if (this.skeleton.boneMatrices) receipts.push({
      identity: this.skeleton.boneMatrices.buffer, chargedTo: 'dynamicArt', kind: 'skin',
      cpuBytes: this.skeleton.boneMatrices.byteLength, gpuBytes: null,
    })
    return receipts
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    CREATURES.delete(this.root)
    try { disposeOwnedVisualResources([
      { dispose: () => this.cache.release(this.key) },
      { dispose: () => this.skeleton.dispose() },
      { dispose: () => this.art.releaseRenderSource(this.binding) },
    ]) } finally { this.source.removeFromParent() }
  }
}
