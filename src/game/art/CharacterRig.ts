import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  CHARACTER_ART_REVISION, CHARACTER_PHYSICAL_PALETTE,
  buildCharacterSkeleton, buildIllustratedHead, buildIllustratedFace,
  buildIllustratedHair, buildIllustratedHeadgear, buildIllustratedTorso, buildIllustratedEyes, buildIllustratedHorns,
  buildIllustratedChestArmor, buildIllustratedShoulder, buildIllustratedHand,
  buildIllustratedTrim, buildIllustratedArm,
  buildUpperArm, buildForearm, buildThigh, buildIllustratedShin, buildIllustratedBoot, buildCloak,
  buildWeaponHead, buildWeaponGrip, buildOffhand, buildWristRope,
  type CharacterPlan, type CharacterVisualLevel, type CharacterPhysicalSurface,
} from './CharacterKit.ts'
import { bakeOutlineNormals, mergeAll, transformed } from './GeometryKit.ts'
import { GeometryCache } from './GeometryCache.ts'
import { StylizedArtLibrary } from './StylizedArtLibrary.ts'
import { ART_SURFACE_ATTRIBUTE, artGeometryBytes } from './ArtPresentation.ts'
import type { ArtGeometryLease, ArtRenderSourceBinding } from './ArtRenderBinding.ts'
import { disposeOwnedVisualResources } from '../visualLifecycle.ts'
import type { VisualAllocationReceipt } from '../diagnostics/VisualBudgetAccounting.ts'
import type { VisualQualityPolicy } from '../visualPolicy.ts'
import type { VisualQuality } from '../visualSettings.ts'

export type CharacterLimb = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg'
export type CharacterLimbAppearance = 'healthy' | 'wounded' | 'missing' | 'prosthetic'
export type CharacterAppearance = Readonly<Partial<Record<CharacterLimb, CharacterLimbAppearance>>>
export type CharacterContactPart = 'torso' | 'head' | CharacterLimb | 'weapon' | 'weaponGrip' | 'weaponTip' | 'shield'

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
const SUPPORT_WEAPONS = new Set(['spear', 'glaive', 'maul', 'greatsword', 'staff'])
const VISUAL_LEVELS: readonly CharacterVisualLevel[] = ['far', 'mid', 'near']
const PROJECTED_THRESHOLDS = [0.055, 0.13] as const
const BODY_GEOMETRY_RETENTION = 2
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
    colors[i * 3] = rgb.r
    colors[i * 3 + 1] = rgb.g
    colors[i * 3 + 2] = rgb.b
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
  const current = Math.max(0, VISUAL_LEVELS.indexOf(previous))
  let level = current
  while (level < 2 && projectedHeight > PROJECTED_THRESHOLDS[level] * (1 + hysteresis)) level++
  while (level > 0 && projectedHeight < PROJECTED_THRESHOLDS[level - 1] * (1 - hysteresis)) level--
  return VISUAL_LEVELS[level]
}

/** Shared affine sole frame for people, paws and hooves. Never writes a simulation root. */
export class TerrainFootFrame {
  private readonly point = new THREE.Vector3()
  private readonly normal = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly frame = new THREE.Matrix4()
  private readonly inverse = new THREE.Matrix4()

  apply(foot: THREE.Object3D, facing: THREE.Object3D, sampleHeight: (x: number, z: number) => number): void {
    const parent = foot.parent
    if (!parent) throw new Error('A terrain foot needs its articulated parent')
    parent.updateWorldMatrix(true, false)
    facing.updateWorldMatrix(true, false)
    this.point.copy(foot.position).applyMatrix4(parent.matrixWorld)
    const x = this.point.x, z = this.point.z
    const dx = (sampleHeight(x + 0.12, z) - sampleHeight(x - 0.12, z)) / 0.24
    const dz = (sampleHeight(x, z + 0.12) - sampleHeight(x, z - 0.12)) / 0.24
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) throw new Error('Foot terrain normal is non-finite')
    this.normal.set(-THREE.MathUtils.clamp(dx, -0.65, 0.65), 1, -THREE.MathUtils.clamp(dz, -0.65, 0.65)).normalize()
    this.forward.set(0, 0, 1).transformDirection(facing.matrixWorld)
    this.forward.addScaledVector(this.normal, -this.forward.dot(this.normal))
    if (this.forward.lengthSq() < 1e-10) {
      this.right.set(1, 0, 0).transformDirection(facing.matrixWorld)
      this.forward.crossVectors(this.right, this.normal)
    }
    this.forward.normalize()
    this.right.crossVectors(this.normal, this.forward).normalize()
    const e = parent.matrixWorld.elements
    this.right.multiplyScalar(Math.hypot(e[0], e[1], e[2]))
    this.forward.multiplyScalar(Math.hypot(e[8], e[9], e[10]))
    this.normal.multiplyScalar(Math.hypot(e[4], e[5], e[6]))
    this.frame.makeBasis(this.right, this.normal, this.forward).setPosition(this.point)
    this.inverse.copy(parent.matrixWorld).invert()
    foot.matrixAutoUpdate = false
    foot.matrix.multiplyMatrices(this.inverse, this.frame)
    foot.matrixWorldNeedsUpdate = true
  }

  reset(foot: THREE.Object3D): void {
    foot.matrixAutoUpdate = true
    foot.rotation.set(0, 0, 0, 'XYZ')
    foot.scale.setScalar(1)
  }
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
  private readonly quality: VisualQuality
  private readonly parts: Part[] = []
  private readonly bones: THREE.Bone[] = []
  private readonly boneLimb: number[] = []
  private readonly bindMatrices: THREE.Matrix4[] = []
  private readonly appearance: Record<CharacterLimb, CharacterLimbAppearance> = {
    leftArm: 'healthy', rightArm: 'healthy', leftLeg: 'healthy', rightLeg: 'healthy',
  }
  private readonly sourceBases = new Map<THREE.Mesh, ArtGeometryLease>()
  private readonly recentBodies = new Map<string, ArtGeometryLease>()
  private contactShadow: THREE.Object3D | null = null
  private wristRope: THREE.Object3D | null = null
  private ropeLease: ArtGeometryLease | null = null
  private readonly scratch = new THREE.Vector3()
  private readonly inverse = new THREE.Matrix4()
  private readonly normalMatrix = new THREE.Matrix3()
  private readonly armTarget = new THREE.Vector3()
  private readonly armLocal = new THREE.Vector3()
  private readonly orientation = new THREE.Quaternion()
  private readonly groundPoint = new THREE.Vector3()
  private readonly footFrame = new TerrainFootFrame()
  private pelvisOffset = 0
  private clothPitch = 0
  private clothRoll = 0
  private disposed = false

  constructor(plan: CharacterPlan, art: StylizedArtLibrary, cache: GeometryCache, player: boolean, quality: VisualQuality) {
    this.plan = plan
    this.art = art
    this.cache = cache
    this.player = player
    this.quality = quality
    this.level = player ? 'hero' : 'near'
    const p = plan.proportions
    const a = this.anatomy = buildCharacterSkeleton(p)
    this.root = a.root
    const cloth = CHARACTER_PHYSICAL_PALETTE.cloth[plan.faction][plan.tint % 3]
    const skin = CHARACTER_PHYSICAL_PALETTE.skin[plan.skinTone % 4]
    const metal = CHARACTER_PHYSICAL_PALETTE.metal
    const leather = CHARACTER_PHYSICAL_PALETTE.leather
    const dark = CHARACTER_PHYSICAL_PALETTE.dark
    const chestSurface: CharacterPhysicalSurface = plan.armour === 'none' ? 'cloth'
      : plan.faction === 'guard' ? 'metal' : 'leather'
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
    part(torso, (level) => buildIllustratedTorso(plan, level), cloth, 'cloth')
    part(torso, (level) => buildIllustratedChestArmor(plan, level),
      chestSurface === 'metal' ? metal : plan.faction === 'villain' && plan.armour !== 'none' ? leather : cloth,
      chestSurface)
    if (plan.trim !== 'none') {
      part(torso, (level) => transformed(buildIllustratedTrim(plan.trim, level), { scale: { x: 0.88, y: 0.9, z: 0.92 } }), leather, 'leather')
    }
    const head = bone('head', a.headPivot, 0, a.headY)
    head.scale.setScalar(p.headScale)
    part(head, (level) => buildIllustratedHead(plan.faction, level), skin, 'skin')
    part(head, buildIllustratedFace, 0x3c302c, 'dark')
    part(head, (level) => buildIllustratedEyes(false, level), 0xc4b8a1, 'skin')
    part(head, (level) => buildIllustratedEyes(true, level), 0x39352b, 'dark')
    if (plan.hair !== 'none') {
      part(head, () => buildIllustratedHair(plan.hair), CHARACTER_PHYSICAL_PALETTE.hair[plan.hairTone % 4], 'hair')
    }
    if (plan.headgear !== 'none') {
      const soft = ['hood', 'ragHood', 'cap'].includes(plan.headgear)
      const mask = plan.headgear === 'boneMask'
      part(head, (level) => buildIllustratedHeadgear(plan.headgear, level),
        soft ? cloth : mask ? CHARACTER_PHYSICAL_PALETTE.bone : plan.headgear === 'strap' ? leather : metal,
        soft ? 'cloth' : mask ? 'bone' : plan.headgear === 'strap' ? 'leather' : 'metal')
      if (plan.headgear === 'hornedHelm') part(head, buildIllustratedHorns, CHARACTER_PHYSICAL_PALETTE.bone, 'bone')
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
      part(upper, (level) => level === 'mid' || level === 'far' ? buildIllustratedArm(p.upperArm, false)
        : buildUpperArm(plan.faction, 'none', p.upperArm), cloth, 'cloth', limb)
      if (plan.armour !== 'none' && plan.kit !== 'light' && plan.kit !== 'ranged') {
        part(upper, () => buildIllustratedShoulder(plan, side), plan.faction === 'elf' ? cloth : metal,
          plan.faction === 'elf' ? 'leather' : 'metal', limb)
      }
      const elbow = joint(side < 0 ? 'leftElbow' : 'rightElbow', arm, 0, -p.upperArm)
      const forearm = bone(`${limb}-forearm`, elbow, 0, 0, 0, limb)
      part(forearm, (level) => level === 'mid' || level === 'far' ? buildIllustratedArm(p.forearm, true)
        : buildForearm(plan.faction, 'none', false, p.forearm),
        plan.armour === 'none' ? skin : leather, plan.armour === 'none' ? 'skin' : 'leather', limb)
      const hand = bone(side < 0 ? 'leftHand' : 'rightHand', elbow, 0, -p.forearm, 0, limb)
      part(hand, (level) => buildIllustratedHand(side, level), plan.gloved ? leather : skin, plan.gloved ? 'leather' : 'skin', limb)
      arms.push(arm); elbows.push(elbow); hands.push(hand)
    }
    for (const side of [-1, 1]) {
      const limb: CharacterLimb = side < 0 ? 'leftLeg' : 'rightLeg'
      const leg = joint(limb, a.pelvisPivot, side * p.hipX, p.hipY)
      const thigh = bone(`${limb}-thigh`, leg, 0, 0, 0, limb)
      part(thigh, () => buildThigh(plan.faction, 'none', p.thigh), dark, 'cloth', limb)
      const knee = joint(side < 0 ? 'leftKnee' : 'rightKnee', leg, 0, -p.thigh)
      const shin = bone(`${limb}-shin`, knee, 0, 0, 0, limb)
      part(shin, () => buildIllustratedShin(p.shin), leather, 'leather', limb)
      const foot = bone(`${limb}-sole`, knee, 0, -p.shin, 0, limb)
      part(foot, buildIllustratedBoot, leather, 'leather', limb)
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
        const positions = lease.geometry.getAttribute('position')
        const bow = plan.weapon === 'bow'
        let maximum = -Infinity
        for (let i = 0; i < positions.count; i++) maximum = Math.max(maximum, bow ? positions.getZ(i) : positions.getY(i))
        const tip = new THREE.Vector3()
        let tips = 0
        for (let i = 0; i < positions.count; i++) {
          if (Math.abs((bow ? positions.getZ(i) : positions.getY(i)) - maximum) > 1e-5) continue
          tip.add(this.scratch.fromBufferAttribute(positions, i))
          tips++
        }
        if (tips === 0) throw new Error('Weapon geometry has no finite tip')
        tip.multiplyScalar(1 / tips)
        const limb = plan.mainHand === 'right' ? 'rightArm' : 'leftArm'
        this.anchors.set('weaponGrip', { node: weapon, point: new THREE.Vector3(),
          normal: new THREE.Vector3(0, 0, 1), surface: 'leather', limb })
        this.anchors.set('weaponTip', { node: weapon, point: tip,
          normal: new THREE.Vector3(0, bow ? 0 : 1, bow ? 1 : 0), surface: 'metal', limb })
      }
      if (plan.offhand !== 'none') {
        const offhandColor = plan.offhand === 'bundle' ? leather : cloth
        const offhandSurface = plan.offhand === 'bundle' ? 'leather' : 'metal'
        const lease = cachedLease(cache, `illustrated-offhand:${plan.offhand}:${offhandColor}`, () =>
          paint(buildOffhand(plan.offhand), offhandColor, offhandSurface))
        const shield = new THREE.Mesh(lease.geometry, material)
        shield.name = 'shield'
        shield.position.set(-0.82, 1.85 - a.waistY, 0.08)
        shield.rotation.z = 0.12
        a.torsoPivot.add(shield)
        this.bind(shield, lease)
        this.anchors.set('shield', { node: shield, point: new THREE.Vector3(0, 0, 0.08),
          normal: new THREE.Vector3(0, 0, 1), surface: offhandSurface, limb: 'leftArm' })
      }
      if (plan.boundArms) {
        this.ropeLease = cachedLease(cache, 'wrist-rope', buildWristRope)
        const rope = new THREE.Mesh(
          this.ropeLease.geometry,
          art.acquireMaterial('character:rope', { color: leather, surface: 'leather' }),
        )
        rope.name = 'wrist-rope'
        this.wristRope = rope
        rope.position.set(0, a.shoulderY - p.upperArm - p.forearm, 0.2)
        rope.scale.x = p.shoulderX / 0.5
        a.torsoPivot.add(rope)
      }
    } catch (error) {
      try { this.dispose() } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Character construction and cleanup failed')
      }
      throw error
    }
    this.anchors.set('torso', { node: torso, point: new THREE.Vector3(0, 0.12, p.chestDepth * 0.5),
      normal: new THREE.Vector3(0, 0, 1), surface: chestSurface, limb: null })
    this.anchors.set('head', { node: head, point: new THREE.Vector3(0, 0, 0.175),
      normal: new THREE.Vector3(0, 0, 1), surface: 'skin', limb: null })
    for (const name of LIMBS) {
      const node = this.rig[name]
      if (node) this.anchors.set(name, { node, point: new THREE.Vector3(0, -0.25, 0.13),
        normal: new THREE.Vector3(0, 0, 1), surface: 'cloth', limb: name })
    }
    if (plan.armed) this.anchors.set('weapon', { node: weapon, point: new THREE.Vector3(0, 0.65, 0),
      normal: new THREE.Vector3(0, 0, 1), surface: plan.weapon === 'bow' ? 'leather' : 'metal',
      limb: plan.mainHand === 'right' ? 'rightArm' : 'leftArm' })
    this.root.userData.rig = this.rig
    this.root.userData.characterPlan = plan
    PRESENTERS.set(this.root, this)
    for (let side = 0; side < 2; side++) {
      arms[side].rotation.z = (side === 0 ? -1 : 1) * p.armSplay
      elbows[side].rotation.x = p.elbowRest
      legs[side].rotation.z = (side === 0 ? -1 : 1) * p.legSplay
    }
    weapon.rotation.set(0.34, 0, -this.rig.mainHand * 0.44)
    this.syncAttachments()
    this.poseSupport(0)
  }

  private detailLevel(level: CharacterVisualLevel): CharacterVisualLevel {
    return this.quality === 'low' && (level === 'near' || level === 'hero') ? 'mid'
      : this.quality === 'balanced' && level === 'hero' ? 'near' : level
  }

  private bodyLease(level: CharacterVisualLevel): ArtGeometryLease {
    const detail = this.detailLevel(level)
    const key = `${CHARACTER_ART_REVISION}:${JSON.stringify(this.plan)}:${detail}`
    const retained = this.recentBodies.get(key)
    if (retained) {
      const lease = cachedLease(this.cache, key, () => { throw new Error('Retained character geometry was lost') })
      this.recentBodies.delete(key)
      this.recentBodies.set(key, retained)
      return lease
    }
    const lease = cachedLease(this.cache, key, () => {
      const geometries: THREE.BufferGeometry[] = []
      try {
        for (const part of this.parts) {
          const built = part.build(detail)
          // Compact within a rigid part before adding constant palette/skin channels.
          // This preserves index reuse instead of expanding every face during merging.
          let geometry: THREE.BufferGeometry
          try {
            built.deleteAttribute('uv')
            geometry = built.index ? built.clone() : mergeVertices(built, 1e-5)
          } finally { built.dispose() }
          geometries.push(geometry)
          paint(geometry, part.color, part.surface)
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
        }
        // Every input is now indexed and has the explicit, identical character layout.
        // These are exclusive temporary inputs; finally below releases them, not the result.
        const merged = mergeGeometries(geometries, false)
        if (!merged) throw new Error('Character body parts disagree on their explicit indexed layout')
        merged.name = `character-body:${detail}`
        return merged
      } finally {
        for (const geometry of geometries) geometry.dispose()
      }
    })
    try {
      this.recentBodies.set(key, cachedLease(this.cache, key, () => {
        throw new Error('Newly acquired character geometry was lost')
      }))
      if (this.recentBodies.size > BODY_GEOMETRY_RETENTION) {
        const oldest = this.recentBodies.keys().next().value
        if (oldest === undefined) throw new Error('Character geometry retention is inconsistent')
        const previous = this.recentBodies.get(oldest)!
        this.recentBodies.delete(oldest)
        previous.release()
      }
      return lease
    } catch (error) {
      try { lease.release() } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Character retention and lease cleanup failed')
      }
      throw error
    }
  }

  updateLod(camera: THREE.PerspectiveCamera, policy: VisualQualityPolicy): void {
    this.assertActive()
    this.root.getWorldPosition(this.scratch)
    const distance = Math.max(0.2, this.scratch.distanceTo(camera.position))
    const projected = (this.plan.proportions.headY + 0.32) * this.root.scale.y * camera.zoom *
      policy.lod.distanceScale / (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    const level = selectCharacterVisualLevel(this.level, projected, this.player, policy.lod.hysteresis)
    if (this.detailLevel(level) !== this.detailLevel(this.level)) {
      const base = this.bodyLease(level)
      const altered = LIMBS.some((name) => this.appearance[name] !== 'healthy')
      let lease = base
      if (altered) {
        try { lease = this.appearanceLease(base.geometry) } finally { base.release() }
      }
      let outcome
      try { outcome = this.art.replaceRenderSourceGeometry(this.bindings[0], lease) }
      catch (error) { lease.release(); throw error }
      this.sourceBases.set(this.body, lease)
      this.level = level
      if (outcome.status === 'committed-with-errors') throw outcome.error
    }
    this.level = level
    // Coarse actors keep equipment, but do not pay all the near ink/shadow passes.
    for (const source of this.sources) {
      source.castShadow = policy.quality !== 'low' && (level === 'hero' || level === 'near')
      const ink = level !== 'far' && (level !== 'mid' || source === this.body)
      source.userData.characterInkEnabled = ink
      for (const child of source.children) {
        if (!StylizedArtLibrary.isOutlineShell(child)) continue
        if (typeof child.userData.policyOutlineEnabled === 'boolean') child.visible = child.userData.policyOutlineEnabled && ink
        else if (!ink) child.visible = false
      }
    }
    if (this.contactShadow) this.contactShadow.visible = level !== 'far'
  }

  attachContactShadow(shadow: THREE.Object3D): void {
    this.assertActive()
    if (this.contactShadow) throw new Error('Character contact shadow is already attached')
    this.contactShadow = shadow
    shadow.userData.visualSubsystem = 'dynamicArt'
    this.root.add(shadow)
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
    this.assertActive()
    let changed = false
    for (const name of LIMBS) {
      const status = next[name] ?? this.appearance[name]
      if (!['healthy', 'wounded', 'missing', 'prosthetic'].includes(status)) throw new Error('Invalid character limb appearance')
      changed ||= status !== this.appearance[name]
    }
    if (!changed) return
    const state = { ...this.appearance }
    for (const name of LIMBS) state[name] = next[name] ?? state[name]
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
      const wound = new THREE.Color(0x703b35)
      for (let i = 0; i < skin.count; i++) {
        const bone = skin.getX(i), limb = this.boneLimb[bone]
        if (!limb) continue
        const status = state[LIMBS[limb - 1]]
        if (status === 'prosthetic') {
          color.setXYZ(i, prosthetic.r, prosthetic.g, prosthetic.b)
          surface.setXYZW(i, ...SURFACES.metal)
        } else if (status === 'wounded' && (this.bones[bone].name.endsWith('-upper') || this.bones[bone].name.endsWith('-thigh'))) {
          this.scratch.fromBufferAttribute(copy.getAttribute('position'), i).applyMatrix4(this.skeleton.boneInverses[bone])
          if (this.scratch.z > 0.05 && this.scratch.y < -0.08 && this.scratch.y > -0.4) {
            color.setXYZ(i, wound.r, wound.g, wound.b)
          }
        }
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
    this.assertActive()
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
    if (this.wristRope?.visible) {
      this.root.updateWorldMatrix(true, true)
      this.inverse.copy(this.anatomy.torsoPivot.matrixWorld).invert()
      this.armLocal.setFromMatrixPosition(this.hands[0].matrixWorld).applyMatrix4(this.inverse)
      this.armTarget.setFromMatrixPosition(this.hands[1].matrixWorld).applyMatrix4(this.inverse)
      this.wristRope.position.copy(this.armLocal).add(this.armTarget).multiplyScalar(0.5)
      this.armTarget.sub(this.armLocal)
      this.wristRope.scale.set(this.armTarget.length(), 0.65, 0.65)
      this.armLocal.set(1, 0, 0)
      this.wristRope.quaternion.setFromUnitVectors(this.armLocal, this.armTarget.normalize())
    }
  }

  /** Fit a support arm to a real equipment-space handle; never move the shield or collider. */
  private fitArm(side: number, target: THREE.Vector3): void {
    const arm = side < 0 ? this.rig.leftArm! : this.rig.rightArm!
    const elbow = side < 0 ? this.rig.leftElbow! : this.rig.rightElbow!
    if (!arm.visible) return
    this.armTarget.copy(target).sub(arm.position)
    const scale = arm.scale.y
    const upper = this.plan.proportions.upperArm
    const forearm = this.plan.proportions.forearm
    const reach = this.armTarget.length()
    let minimum = 0.02, maximum = 2.55
    // Nonuniform upper-arm scale makes the endpoint locus elliptical, not circular.
    for (let iteration = 0; iteration < 14; iteration++) {
      const angle = (minimum + maximum) * 0.5
      const length = Math.hypot((upper + forearm * Math.cos(angle)) * scale, forearm * Math.sin(angle))
      if (length > reach) minimum = angle
      else maximum = angle
    }
    const angle = (minimum + maximum) * 0.5
    this.armLocal.set(0, -(upper + forearm * Math.cos(angle)) * scale, -forearm * Math.sin(angle)).normalize()
    if (reach < 1e-6) return
    this.armTarget.multiplyScalar(1 / reach)
    this.orientation.setFromUnitVectors(this.armLocal, this.armTarget)
    arm.quaternion.copy(this.orientation)
    elbow.rotation.set(angle, 0, 0, 'XYZ')
  }

  poseSupport(draw: number): void {
    this.assertActive()
    const weapon = this.rig.weapon!
    const shield = this.anchors.get('shield')?.node
    this.anatomy.torsoPivot.updateWorldMatrix(true, true)
    this.inverse.copy(this.anatomy.torsoPivot.matrixWorld).invert()
    if (shield) {
      this.scratch.set(0, 0.02, -0.11).applyMatrix4(shield.matrixWorld).applyMatrix4(this.inverse)
      this.fitArm(-1, this.scratch)
    } else if (SUPPORT_WEAPONS.has(this.plan.weapon) || this.plan.weapon === 'bow') {
      this.scratch.set(0, this.plan.weapon === 'bow' ? 0 : -0.28, this.plan.weapon === 'bow' ? -0.1 - draw * 0.3 : 0)
        .applyMatrix4(weapon.matrixWorld).applyMatrix4(this.inverse)
      this.fitArm(-this.rig.mainHand, this.scratch)
    }
    const side = this.rig.mainHand > 0 ? 0 : 1
    const hand = this.hands[side]
    if ((shield || SUPPORT_WEAPONS.has(this.plan.weapon)) && hand.parent) {
      hand.parent.updateWorldMatrix(true, false)
      const handle = shield ?? weapon
      handle.updateWorldMatrix(true, false)
      this.inverse.copy(hand.parent.matrixWorld).invert()
      // Keep the solved wrist position while matching the handle orientation.
      this.scratch.set(0, -this.plan.proportions.forearm, 0).applyMatrix4(hand.parent.matrixWorld)
      hand.matrix.copy(handle.matrixWorld).setPosition(this.scratch).premultiply(this.inverse)
      hand.matrixAutoUpdate = false
      hand.matrixWorldNeedsUpdate = true
    }
  }

  secondaryMotion(delta: number, stride: number, attack: number, reducedMotion: boolean): void {
    this.assertActive()
    const cloak = this.rig.cloak
    if (!cloak) return
    const scale = reducedMotion ? 0.15 : 1
    const pitch = (-0.035 - Math.abs(stride) * 0.21 - attack * 0.08) * scale
    const roll = stride * 0.065 * scale
    this.clothPitch = THREE.MathUtils.damp(this.clothPitch, pitch, 8, delta)
    this.clothRoll = THREE.MathUtils.damp(this.clothRoll, roll, 6, delta)
    cloak.rotation.set(this.clothPitch, 0, this.clothRoll, 'XYZ')
  }

  ground(
    delta: number, sampleHeight: (x: number, z: number) => number,
    grounded: boolean, baseBodyHeight: number, stride: number,
  ): void {
    this.assertActive()
    const body = this.anatomy.bodyPivot
    body.position.y = baseBodyHeight
    if (!grounded || this.level === 'far') {
      this.pelvisOffset = 0
      for (const foot of this.feet) this.footFrame.reset(foot)
      return
    }
    this.root.updateWorldMatrix(true, true)
    let correction = 0, supports = 0
    for (let side = 0; side < 2; side++) {
      const name = side === 0 ? 'leftLeg' : 'rightLeg'
      if (this.appearance[name] === 'missing') continue
      this.groundPoint.setFromMatrixPosition(this.feet[side].matrixWorld)
      const ground = sampleHeight(this.groundPoint.x, this.groundPoint.z)
      if (!Number.isFinite(ground)) throw new Error('Character terrain sample is non-finite')
      correction += THREE.MathUtils.clamp(ground - this.groundPoint.y, -0.16, 0.16)
      supports++
    }
    this.pelvisOffset = THREE.MathUtils.damp(this.pelvisOffset, supports ? correction / supports : 0, 14, delta)
    body.position.y += this.pelvisOffset
    this.root.updateWorldMatrix(true, true)
    for (let side = 0; side < 2; side++) {
      const name = side === 0 ? 'leftLeg' : 'rightLeg'
      if (this.appearance[name] === 'missing') continue
      const leg = this.rig[name]!
      const knee = side === 0 ? this.rig.leftKnee! : this.rig.rightKnee!
      const foot = this.feet[side]
      this.groundPoint.setFromMatrixPosition(foot.matrixWorld)
      const height = sampleHeight(this.groundPoint.x, this.groundPoint.z)
      const swing = Math.max(0, side === 0 ? -stride : stride)
      const targetY = height + 0.018 + swing * 0.12
      this.groundPoint.y += THREE.MathUtils.clamp(targetY - this.groundPoint.y, -0.22, 0.22)
      this.inverse.copy(this.anatomy.pelvisPivot.matrixWorld).invert()
      this.armTarget.copy(this.groundPoint).applyMatrix4(this.inverse).sub(leg.position)
      const length = this.armTarget.length()
      const upper = this.plan.proportions.thigh
      const lower = this.plan.proportions.shin
      const scale = leg.scale.y
      let lo = 0.02, hi = 2.2
      for (let i = 0; i < 14; i++) {
        const angle = (lo + hi) * 0.5
        if (Math.hypot((upper + lower * Math.cos(angle)) * scale, lower * Math.sin(angle)) > length) lo = angle
        else hi = angle
      }
      const bend = (lo + hi) * 0.5
      this.armLocal.set(0, -(upper + lower * Math.cos(bend)) * scale, -lower * Math.sin(bend)).normalize()
      this.armTarget.normalize()
      leg.quaternion.setFromUnitVectors(this.armLocal, this.armTarget)
      knee.rotation.set(bend, 0, 0, 'XYZ')
      this.footFrame.apply(foot, this.root, sampleHeight)
    }
    // The pelvis adjustment carries the whole skeleton; equipment must see its final frame.
    this.syncAttachments()
  }

  sampleContact(part: CharacterContactPart, target: CharacterContact): boolean {
    this.assertActive()
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
    this.assertActive()
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
    for (const retained of this.recentBodies.values()) addGeometry(retained.geometry, 'geometry')
    if (this.ropeLease) addGeometry(this.ropeLease.geometry, 'geometry')
    if (this.skeleton.boneMatrices) receipts.push({
      identity: this.skeleton.boneMatrices.buffer, chargedTo: 'dynamicArt', kind: 'skin',
      cpuBytes: this.skeleton.boneMatrices.byteLength, gpuBytes: null,
    })
    // Matrix4.elements is a JS array, not an observable byte-addressed backing store.
    // Its runtime-dependent storage remains outside this explicitly incomplete inventory.
    return receipts
  }

  get geometryBytes(): number {
    return this.sources.reduce((sum, source) => sum + artGeometryBytes(source.geometry), 0)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Character presenter is disposed')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    PRESENTERS.delete(this.root)
    const owners = [
      ...[...this.recentBodies.values()].map((lease) => ({ dispose: () => lease.release() })),
      { dispose: () => this.skeleton.dispose() },
      ...this.bindings.map((binding) => ({ dispose: () => this.art.releaseRenderSource(binding) })),
    ]
    const ropeLease = this.ropeLease
    this.ropeLease = null
    this.recentBodies.clear()
    if (ropeLease) owners.push({ dispose: () => ropeLease.release() })
    try { disposeOwnedVisualResources(owners) }
    finally {
      for (const source of this.sources) source.removeFromParent()
      this.sourceBases.clear()
      this.bindings.length = 0
      this.sources.length = 0
    }
  }
}

export function createCharacterPresenter(
  plan: CharacterPlan, art: StylizedArtLibrary, cache: GeometryCache, player: boolean, quality: VisualQuality = 'balanced',
): CharacterPresenter {
  return new CharacterPresenter(plan, art, cache, player, quality)
}
