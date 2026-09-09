import * as THREE from 'three'
import {
  CHARACTER_ART_REVISION, CHARACTER_PHYSICAL_PALETTE,
  buildCharacterSkeleton, buildIllustratedHead, buildIllustratedFace,
  buildIllustratedHair, buildIllustratedHeadgear, buildIllustratedTorso,
  buildIllustratedChestArmor, buildIllustratedShoulder, buildIllustratedHand,
  buildUpperArm, buildForearm, buildThigh, buildShin, buildCloak,
  buildTorsoTrim, buildWeaponHead, buildWeaponGrip, buildOffhand, buildWristRope,
  type CharacterPlan, type CharacterVisualLevel, type CharacterPhysicalSurface,
} from './CharacterKit.ts'
import { bakeOutlineNormals, mergeAll, transformed } from './GeometryKit.ts'
import { GeometryCache } from './GeometryCache.ts'
import { StylizedArtLibrary } from './StylizedArtLibrary.ts'
import { ART_SURFACE_ATTRIBUTE, artGeometryBytes } from './ArtPresentation.ts'
import type { ArtGeometryLease, ArtRenderSourceBinding } from './ArtRenderBinding.ts'
import { disposeOwnedVisualResources } from '../visualLifecycle.ts'
import type { VisualAllocationReceipt } from '../diagnostics/VisualBudgetAccounting.ts'

export type CharacterLimb = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg'
export type CharacterLimbAppearance = 'healthy' | 'wounded' | 'missing' | 'prosthetic'
export type CharacterAppearance = Readonly<Partial<Record<CharacterLimb, CharacterLimbAppearance>>>
export type CharacterContactPart = 'torso' | 'head' | CharacterLimb | 'weapon' | 'shield'

export interface CharacterAnimationRig {
  leftArm: THREE.Object3D | null
  rightArm: THREE.Object3D | null
  leftElbow: THREE.Object3D | null
  rightElbow: THREE.Object3D | null
  leftLeg: THREE.Object3D | null
  rightLeg: THREE.Object3D | null
  leftKnee: THREE.Object3D | null
  rightKnee: THREE.Object3D | null
  weapon: THREE.Object3D | null
  cloak: THREE.Object3D | null
  waistY: number
  shoulderY: number
  upperArm: number
  forearm: number
  elbowRest: number
  armSplay: number
  legSplay: number
  mainHand: number
  beast: null
  boundArms: boolean
  lean: number
}

interface Part {
  readonly bone: THREE.Bone
  readonly build: (level: CharacterVisualLevel) => THREE.BufferGeometry
  readonly surface: CharacterPhysicalSurface
  readonly color: number
  readonly limb: CharacterLimb | null
}

interface ContactAnchor {
  readonly node: THREE.Object3D
  readonly point: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly surface: CharacterPhysicalSurface
  readonly limb: CharacterLimb | null
}

export interface CharacterContact {
  readonly point: THREE.Vector3
  readonly normal: THREE.Vector3
  surface: CharacterPhysicalSurface
}

const LIMBS = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const
const SURFACES: Record<CharacterPhysicalSurface, readonly [number, number, number, number]> = {
  skin: [0.79, 0, 0.46, 0.13], hair: [0.93, 0, 0.56, 0.08],
  cloth: [0.94, 0, 0.62, 0.12], leather: [0.86, 0.02, 0.62, 0.11],
  bone: [0.79, 0, 0.51, 0.1], metal: [0.45, 0.38, 0.61, 0.19],
  dark: [0.94, 0, 0.52, 0.08],
}

function paint(geometry: THREE.BufferGeometry, color: number, surface: CharacterPhysicalSurface): THREE.BufferGeometry {
  const rgb = new THREE.Color(color)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  const response = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    colors.set([rgb.r, rgb.g, rgb.b], i * 3)
    response.set(SURFACES[surface], i * 4)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute(ART_SURFACE_ATTRIBUTE, new THREE.BufferAttribute(response, 4))
  return geometry
}

function ownedLease(geometry: THREE.BufferGeometry): ArtGeometryLease {
  StylizedArtLibrary.markLibraryOwned(geometry)
  let released = false
  return {
    geometry,
    release() {
      if (released) return
      released = true
      geometry.dispose()
    },
  }
}

function cachedLease(cache: GeometryCache, key: string, build: () => THREE.BufferGeometry): ArtGeometryLease {
  const geometry = cache.acquire(key, () => {
    const result = build()
    StylizedArtLibrary.markLibraryOwned(result)
    return result
  })
  let released = false
  return { geometry, release() { if (!released) { released = true; cache.release(key) } } }
}

const PRESENTERS = new WeakMap<THREE.Object3D, CharacterPresenter>()
export function characterPresenter(root: THREE.Object3D): CharacterPresenter | undefined {
  return PRESENTERS.get(root)
}

/** Presentation importance uses camera distance/zoom, not simulation actor distance. */
export function selectCharacterVisualLevel(
  previous: CharacterVisualLevel, projectedHeight: number, hero: boolean, hysteresis: number,
): CharacterVisualLevel {
  if (!Number.isFinite(projectedHeight) || projectedHeight < 0 ||
      !Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 1) {
    throw new RangeError('Invalid character projected importance')
  }
  if (hero) return 'hero'
  const order: readonly CharacterVisualLevel[] = ['far', 'mid', 'near']
  const current = Math.max(0, order.indexOf(previous))
  const thresholds = [0.055, 0.13]
  let level = current
  while (level < 2 && projectedHeight > thresholds[level] * (1 + hysteresis)) level++
  while (level > 0 && projectedHeight < thresholds[level - 1] * (1 - hysteresis)) level--
  return order[level]
}

/**
 * The engine's real named rig, with one body draw and independently addressable equipment.
 * Bone children follow the existing Group joints; the simulation never follows a bone.
 */
export class CharacterPresenter {
  readonly root: THREE.Group
  readonly rig: CharacterAnimationRig
  readonly sources: THREE.Mesh[] = []
  readonly bindings: ArtRenderSourceBinding[] = []
  readonly skeleton: THREE.Skeleton
  readonly body: THREE.SkinnedMesh
  readonly plan: CharacterPlan
  readonly anchors = new Map<CharacterContactPart, ContactAnchor>()
  readonly hands: readonly [THREE.Bone, THREE.Bone]
  readonly feet: readonly [THREE.Object3D, THREE.Object3D]
  readonly anatomy
  level: CharacterVisualLevel
  private readonly art: StylizedArtLibrary
  private readonly cache: GeometryCache
  private readonly player: boolean
  private readonly parts: Part[] = []
  private readonly bones: THREE.Bone[] = []
  private readonly boneLimb: number[] = []
  private readonly bindMatrices: THREE.Matrix4[] = []
  private readonly appearance: Record<CharacterLimb, CharacterLimbAppearance> = {
    leftArm: 'healthy', rightArm: 'healthy', leftLeg: 'healthy', rightLeg: 'healthy',
  }
  private readonly sourceBases = new Map<THREE.Mesh, ArtGeometryLease>()
  private readonly scratch = new THREE.Vector3()
  private readonly inverse = new THREE.Matrix4()
  private readonly normalMatrix = new THREE.Matrix3()
  private disposed = false

  constructor(plan: CharacterPlan, art: StylizedArtLibrary, cache: GeometryCache, player: boolean) {
    this.plan = plan
    this.art = art
    this.cache = cache
    this.player = player
    this.level = player ? 'hero' : 'near'
    const p = plan.proportions
    const a = this.anatomy = buildCharacterSkeleton(p)
    this.root = a.root
    const cloth = CHARACTER_PHYSICAL_PALETTE.cloth[plan.faction][plan.tint % 3]
    const skin = CHARACTER_PHYSICAL_PALETTE.skin[plan.skinTone % 4]
    const metal = CHARACTER_PHYSICAL_PALETTE.metal
    const leather = CHARACTER_PHYSICAL_PALETTE.leather
    const dark = CHARACTER_PHYSICAL_PALETTE.dark
    const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0, limb: CharacterLimb | null = null) => {
      const node = new THREE.Bone()
      node.name = name
      node.position.set(x, y, z)
      parent.add(node)
      this.bones.push(node)
      this.boneLimb.push(limb === null ? 0 : LIMBS.indexOf(limb) + 1)
      return node
    }
    const part = (node: THREE.Bone, build: Part['build'], color: number, surface: CharacterPhysicalSurface, limb: CharacterLimb | null = null) => {
      this.parts.push({ bone: node, build, color, surface, limb })
    }
    const joint = (name: string, parent: THREE.Object3D, x: number, y: number) => {
      const node = new THREE.Group()
      node.name = name
      node.position.set(x, y, 0)
      parent.add(node)
      return node
    }
    const torso = bone('torso', a.torsoPivot, 0, a.torsoY)
    part(torso, () => buildIllustratedTorso(plan), cloth, 'cloth')
    part(torso, () => buildIllustratedChestArmor(plan),
      plan.faction === 'guard' && plan.armour !== 'none' ? metal : plan.faction === 'villain' ? leather : cloth,
      plan.faction === 'guard' && plan.armour !== 'none' ? 'metal' : 'leather')
    if (plan.trim !== 'none') {
      part(torso, () => transformed(buildTorsoTrim(plan.trim), { scale: { x: 0.88, y: 0.9, z: 0.92 } }), leather, 'leather')
    }
    const head = bone('head', a.headPivot, 0, a.headY)
    head.scale.setScalar(p.headScale)
    part(head, (level) => buildIllustratedHead(plan.faction, level), skin, 'skin')
    part(head, buildIllustratedFace, 0x3c302c, 'dark')
    if (plan.hair !== 'none') {
      part(head, () => buildIllustratedHair(plan.hair), CHARACTER_PHYSICAL_PALETTE.hair[plan.hairTone % 4], 'hair')
    }
    if (plan.headgear !== 'none') {
      const soft = ['hood', 'ragHood', 'cap'].includes(plan.headgear)
      const mask = plan.headgear === 'boneMask'
      part(head, (level) => buildIllustratedHeadgear(plan.headgear, level),
        soft ? cloth : mask ? CHARACTER_PHYSICAL_PALETTE.bone : plan.headgear === 'strap' ? leather : metal,
        soft ? 'cloth' : mask ? 'bone' : plan.headgear === 'strap' ? 'leather' : 'metal')
    }
    const arms: THREE.Group[] = []
    const elbows: THREE.Group[] = []
    const hands: THREE.Bone[] = []
    const legs: THREE.Group[] = []
    const knees: THREE.Group[] = []
    const feet: THREE.Object3D[] = []
    for (const side of [-1, 1]) {
      const limb: CharacterLimb = side < 0 ? 'leftArm' : 'rightArm'
      const arm = joint(limb, a.torsoPivot, side * p.shoulderX, a.shoulderY)
      const upper = bone(`${limb}-upper`, arm, 0, 0, 0, limb)
      part(upper, () => buildUpperArm(plan.faction, 'none', p.upperArm), cloth, 'cloth', limb)
      if (plan.armour !== 'none' && plan.kit !== 'light' && plan.kit !== 'ranged') {
        part(upper, () => buildIllustratedShoulder(plan, side), plan.faction === 'elf' ? cloth : metal,
          plan.faction === 'elf' ? 'leather' : 'metal', limb)
      }
      const elbow = joint(side < 0 ? 'leftElbow' : 'rightElbow', arm, 0, -p.upperArm)
      const forearm = bone(`${limb}-forearm`, elbow, 0, 0, 0, limb)
      part(forearm, () => buildForearm(plan.faction, 'none', false, p.forearm),
        plan.armour === 'none' ? skin : leather, plan.armour === 'none' ? 'skin' : 'leather', limb)
      const hand = bone(side < 0 ? 'leftHand' : 'rightHand', elbow, 0, -p.forearm, 0, limb)
      part(hand, () => buildIllustratedHand(side), plan.gloved ? leather : skin, plan.gloved ? 'leather' : 'skin', limb)
      arms.push(arm); elbows.push(elbow); hands.push(hand)
    }
    for (const side of [-1, 1]) {
      const limb: CharacterLimb = side < 0 ? 'leftLeg' : 'rightLeg'
      const leg = joint(limb, a.pelvisPivot, side * p.hipX, p.hipY)
      const thigh = bone(`${limb}-thigh`, leg, 0, 0, 0, limb)
      part(thigh, () => buildThigh(plan.faction, 'none', p.thigh), dark, 'cloth', limb)
      const knee = joint(side < 0 ? 'leftKnee' : 'rightKnee', leg, 0, -p.thigh)
      const shin = bone(`${limb}-shin`, knee, 0, 0, 0, limb)
      part(shin, () => buildShin(plan.faction, 'none', p.shin), leather, 'leather', limb)
      const foot = joint(`${limb}-sole`, knee, 0, -p.shin)
      foot.position.z = 0.1
      legs.push(leg); knees.push(knee); feet.push(foot)
    }
    this.hands = [hands[0], hands[1]]
    this.feet = [feet[0], feet[1]]
    let cloak: THREE.Bone | null = null
    if (plan.cloak !== 'none') {
      cloak = bone('cloak-pivot', a.torsoPivot, 0, a.shoulderY + 0.015)
      part(cloak, () => transformed(buildCloak(plan.faction, plan.cloak),
        { scale: { x: 0.87, y: 0.96, z: 0.86 } }), cloth, 'cloth')
    }
    const weapon = joint('weapon', a.torsoPivot, 0, 0)
    this.rig = {
      leftArm: arms[0], rightArm: arms[1], leftElbow: elbows[0], rightElbow: elbows[1],
      leftLeg: legs[0], rightLeg: legs[1], leftKnee: knees[0], rightKnee: knees[1],
      weapon, cloak, waistY: a.waistY, shoulderY: a.shoulderY, upperArm: p.upperArm,
      forearm: p.forearm, elbowRest: p.elbowRest, armSplay: p.armSplay, legSplay: p.legSplay,
      mainHand: plan.mainHand === 'right' ? 1 : -1, beast: null, boundArms: plan.boundArms, lean: p.lean,
    }
    this.root.updateMatrixWorld(true)
    for (const node of this.bones) this.bindMatrices.push(node.matrixWorld.clone())
    this.skeleton = new THREE.Skeleton(this.bones)
    const material = art.acquireMaterial('character:mixed:response-v1', {
      color: 0xffffff, surface: 'cloth', vertexColors: true, attributes: { surfaceResponse: true },
    })
    const base = this.bodyLease(this.level)
    this.body = new THREE.SkinnedMesh(base.geometry, material)
    this.body.name = 'character-body-batch'
    this.body.bind(this.skeleton, new THREE.Matrix4())
    this.root.add(this.body)
    try {
      this.bind(this.body, base)
      if (plan.armed) {
        const key = `illustrated-weapon:${plan.weapon}`
        const lease = cachedLease(cache, key, () => {
          const result = mergeAll([
            paint(buildWeaponHead(plan.weapon), plan.weapon === 'bow' ? dark : metal, plan.weapon === 'bow' ? 'dark' : 'metal'),
            paint(buildWeaponGrip(plan.weapon), leather, 'leather'),
          ])
          if (plan.weapon === 'bow') result.translate(0, 0, -0.17)
          return result
        })
        const mesh = new THREE.Mesh(lease.geometry, material)
        mesh.name = 'weapon-head'
        weapon.add(mesh)
        this.bind(mesh, lease)
      }
      if (plan.offhand !== 'none') {
        const lease = cachedLease(cache, `illustrated-offhand:${plan.offhand}:${plan.faction}`, () =>
          paint(buildOffhand(plan.offhand), plan.offhand === 'bundle' ? leather : cloth,
            plan.offhand === 'bundle' ? 'leather' : 'metal'))
        const shield = new THREE.Mesh(lease.geometry, material)
        shield.name = 'shield'
        shield.position.set(-0.82, 1.85 - a.waistY, 0.08)
        shield.rotation.z = 0.12
        a.torsoPivot.add(shield)
        this.bind(shield, lease)
        this.anchors.set('shield', { node: shield, point: new THREE.Vector3(0, 0, 0.08),
          normal: new THREE.Vector3(0, 0, 1), surface: 'metal', limb: 'leftArm' })
      }
      if (plan.boundArms) {
        const rope = new THREE.Mesh(
          cache.acquire('wrist-rope', () => { const g = buildWristRope(); StylizedArtLibrary.markLibraryOwned(g); return g }),
          art.acquireMaterial('character:rope', { color: leather, surface: 'leather' }),
        )
        rope.name = 'wrist-rope'
        rope.position.set(0, a.shoulderY - p.upperArm - p.forearm, 0.2)
        rope.scale.x = p.shoulderX / 0.5
        a.torsoPivot.add(rope)
      }
    } catch (error) {
      this.dispose()
      throw error
    }
    this.anchors.set('torso', { node: torso, point: new THREE.Vector3(0, 0.12, p.chestDepth * 0.5),
      normal: new THREE.Vector3(0, 0, 1), surface: plan.faction === 'guard' ? 'metal' : 'cloth', limb: null })
    this.anchors.set('head', { node: head, point: new THREE.Vector3(0, 0, 0.175),
      normal: new THREE.Vector3(0, 0, 1), surface: 'skin', limb: null })
    for (const name of LIMBS) {
      const node = this.rig[name]
      if (node) this.anchors.set(name, { node, point: new THREE.Vector3(0, -0.25, 0.13),
        normal: new THREE.Vector3(0, 0, 1), surface: 'cloth', limb: name })
    }
    this.anchors.set('weapon', { node: weapon, point: new THREE.Vector3(0, 0.65, 0),
      normal: new THREE.Vector3(0, 0, 1), surface: 'metal', limb: plan.mainHand === 'right' ? 'rightArm' : 'leftArm' })
    this.root.userData.rig = this.rig
    this.root.userData.characterPlan = plan
    PRESENTERS.set(this.root, this)
  }

  private bodyLease(level: CharacterVisualLevel): ArtGeometryLease {
    const key = `${CHARACTER_ART_REVISION}:${JSON.stringify(this.plan)}:${level}`
    return cachedLease(this.cache, key, () => {
      const geometries: THREE.BufferGeometry[] = []
      try {
        for (const part of this.parts) {
          const geometry = paint(part.build(level), part.color, part.surface)
          const index = this.bones.indexOf(part.bone)
          geometry.applyMatrix4(this.bindMatrices[index])
          // applyMatrix4 does not transform custom outline normals.
          bakeOutlineNormals(geometry)
          const count = geometry.getAttribute('position').count
          const indices = new Uint16Array(count * 4)
          const weights = new Float32Array(count * 4)
          for (let i = 0; i < count; i++) { indices[i * 4] = index; weights[i * 4] = 1 }
          geometry.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4))
          geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
          geometries.push(geometry)
        }
        const merged = mergeAll(geometries, { dispose: false, name: `character-body:${level}` })
        // An explicit index makes event-only triangle exclusion independent of draw groups.
        if (!merged.index) {
          merged.setIndex(Array.from({ length: merged.getAttribute('position').count }, (_, i) => i))
        }
        return merged
      } finally {
        for (const geometry of geometries) geometry.dispose()
      }
    })
  }

  private bind(source: THREE.Mesh, base: ArtGeometryLease): void {
    source.castShadow = true
    source.receiveShadow = true
    source.userData.visualSubsystem = 'dynamicArt'
    let binding: ArtRenderSourceBinding
    try {
      binding = this.art.bindRenderSource(source, { geometryLease: base, visibility: this.player, deformationPadding: 0.9 })
    } catch (error) {
      base.release()
      throw error
    }
    this.sources.push(source)
    this.bindings.push(binding)
    this.sourceBases.set(source, base)
  }

  setAppearance(next: CharacterAppearance): void {
    let changed = false
    for (const name of LIMBS) {
      const status = next[name] ?? this.appearance[name]
      if (!['healthy', 'wounded', 'missing', 'prosthetic'].includes(status)) throw new Error('Invalid character limb appearance')
      changed ||= status !== this.appearance[name]
    }
    if (!changed) return
    const state = { ...this.appearance, ...next }
    const base = this.bodyLease(this.level)
    let lease: ArtGeometryLease
    try { lease = this.appearanceLease(base.geometry, state) } finally { base.release() }
    let outcome
    try { outcome = this.art.replaceRenderSourceGeometry(this.bindings[0], lease) }
    catch (error) { lease.release(); throw error }
    this.sourceBases.set(this.body, lease)
    Object.assign(this.appearance, state)
    for (const name of LIMBS) {
      const joint = this.rig[name]
      if (joint) joint.visible = state[name] !== 'missing'
    }
    if (outcome.status === 'committed-with-errors') throw outcome.error
  }

  private appearanceLease(geometry: THREE.BufferGeometry, state = this.appearance): ArtGeometryLease {
    const copy = geometry.clone()
    try {
      const skin = copy.getAttribute('skinIndex')
      const color = copy.getAttribute('color')
      const surface = copy.getAttribute(ART_SURFACE_ATTRIBUTE)
      const prosthetic = new THREE.Color(CHARACTER_PHYSICAL_PALETTE.metal)
      for (let i = 0; i < skin.count; i++) {
        const limb = this.boneLimb[skin.getX(i)]
        if (!limb || state[LIMBS[limb - 1]] !== 'prosthetic') continue
        color.setXYZ(i, prosthetic.r, prosthetic.g, prosthetic.b)
        surface.setXYZW(i, ...SURFACES.metal)
      }
      const indices: number[] = []
      const index = copy.index!
      for (let i = 0; i < index.count; i += 3) {
        let hidden = false
        for (let corner = 0; corner < 3; corner++) {
          const limb = this.boneLimb[skin.getX(index.getX(i + corner))]
          if (limb && state[LIMBS[limb - 1]] === 'missing') hidden = true
        }
        if (!hidden) indices.push(index.getX(i), index.getX(i + 1), index.getX(i + 2))
      }
      copy.setIndex(indices)
      return ownedLease(copy)
    } catch (error) { copy.dispose(); throw error }
  }

  /** Reads final joint frames, including all axes and nonuniform variation, without gameplay writes. */
  syncAttachments(): void {
    const weapon = this.rig.weapon
    if (!weapon) return
    const hand = this.hands[this.rig.mainHand > 0 ? 1 : 0]
    this.anatomy.torsoPivot.updateWorldMatrix(true, true)
    this.inverse.copy(this.anatomy.torsoPivot.matrixWorld).invert()
    this.scratch.setFromMatrixPosition(hand.matrixWorld).applyMatrix4(this.inverse)
    weapon.position.copy(this.scratch)
    // A local quaternion cannot undo a sheared parent from nonuniform art scale.
    // Preserve the full handle frame so fingers and grip agree on every axis.
    weapon.updateWorldMatrix(true, false)
    this.inverse.copy(hand.parent!.matrixWorld).invert()
    hand.matrixAutoUpdate = false
    hand.matrix.multiplyMatrices(this.inverse, weapon.matrixWorld)
    hand.matrixWorldNeedsUpdate = true
  }

  sampleContact(part: CharacterContactPart, target: CharacterContact): boolean {
    const anchor = this.anchors.get(part)
    if (!anchor || (anchor.limb && this.appearance[anchor.limb] === 'missing')) return false
    for (let node: THREE.Object3D | null = anchor.node; node; node = node.parent) {
      if (!node.visible) return false
    }
    anchor.node.updateWorldMatrix(true, false)
    target.point.copy(anchor.point).applyMatrix4(anchor.node.matrixWorld)
    this.normalMatrix.getNormalMatrix(anchor.node.matrixWorld)
    target.normal.copy(anchor.normal).applyMatrix3(this.normalMatrix).normalize()
    target.surface = anchor.limb && this.appearance[anchor.limb] === 'prosthetic' ? 'metal' : anchor.surface
    return true
  }

  allocationReceipts(): VisualAllocationReceipt[] {
    const receipts: VisualAllocationReceipt[] = []
    const addGeometry = (geometry: THREE.BufferGeometry, kind: 'geometry' | 'binding-clone') => {
      const buffers = new Set<ArrayBufferLike>()
      for (const attribute of Object.values(geometry.attributes)) buffers.add(attribute.array.buffer)
      if (geometry.index) buffers.add(geometry.index.array.buffer)
      for (const identity of buffers) receipts.push({
        identity, chargedTo: 'dynamicArt', kind, cpuBytes: identity.byteLength, gpuBytes: null,
      })
    }
    for (const source of this.sources) {
      const base = this.sourceBases.get(source)!
      addGeometry(base.geometry, 'geometry')
      if (source.geometry !== base.geometry) addGeometry(source.geometry, 'binding-clone')
    }
    if (this.skeleton.boneMatrices) receipts.push({
      identity: this.skeleton.boneMatrices.buffer, chargedTo: 'dynamicArt', kind: 'skin',
      cpuBytes: this.skeleton.boneMatrices.byteLength, gpuBytes: null,
    })
    for (const inverse of this.skeleton.boneInverses) receipts.push({
      identity: inverse.elements, chargedTo: 'dynamicArt', kind: 'skin', cpuBytes: 16 * 8, gpuBytes: 0,
    })
    return receipts
  }

  get geometryBytes(): number {
    return this.sources.reduce((sum, source) => sum + artGeometryBytes(source.geometry), 0)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    PRESENTERS.delete(this.root)
    const owners = [
      { dispose: () => this.skeleton.dispose() },
      ...this.bindings.map((binding) => ({ dispose: () => this.art.releaseRenderSource(binding) })),
    ]
    try { disposeOwnedVisualResources(owners) }
    finally {
      if (this.plan.boundArms) this.cache.release('wrist-rope')
      for (const source of this.sources) source.removeFromParent()
      this.sourceBases.clear()
      this.bindings.length = 0
      this.sources.length = 0
    }
  }
}

export function createCharacterPresenter(
  plan: CharacterPlan, art: StylizedArtLibrary, cache: GeometryCache, player: boolean,
): CharacterPresenter {
  return new CharacterPresenter(plan, art, cache, player)
}
