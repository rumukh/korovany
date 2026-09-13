import * as THREE from 'three'
import { BOW_AIM_DRAW, BowAimPose, type BowAimRig } from './BowAimPose.ts'

/** Borrowed immutable cache assets. The caller retains and releases their lifetime. */
export interface LegacyBowResources {
  readonly bowGeometry: THREE.BufferGeometry
  readonly arrowGeometry: THREE.BufferGeometry
  /** Straight segment along Y, centered at zero, with endpoints at -0.5 and +0.5. */
  readonly stringGeometry: THREE.BufferGeometry
  readonly bowMaterial: THREE.Material
  readonly arrowMaterial: THREE.Material
  readonly stringMaterial: THREE.Material
}

interface SavedTransform {
  readonly node: THREE.Object3D
  readonly position: THREE.Vector3
  readonly quaternion: THREE.Quaternion
  readonly scale: THREE.Vector3
  readonly matrix: THREE.Matrix4
  readonly matrixAutoUpdate: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function legacyRig(root: THREE.Group): BowAimRig {
  const rig: unknown = root.userData.rig
  const plan: unknown = root.userData.characterPlan
  if (!record(rig) || !record(plan) || plan.faction !== 'elf' || plan.kit !== 'hero' || plan.armed !== true ||
      typeof plan.gloved !== 'boolean' || root.getObjectByName('character-body-batch') ||
      !(rig.torsoPivot instanceof THREE.Object3D) || !(rig.leftArm instanceof THREE.Object3D) ||
      !(rig.rightArm instanceof THREE.Object3D) || !(rig.leftElbow instanceof THREE.Object3D) ||
      !(rig.rightElbow instanceof THREE.Object3D) || typeof rig.upperArm !== 'number' || typeof rig.forearm !== 'number') {
    throw new Error('Legacy bow presentation requires the production legacy elf-player rig and plan')
  }
  return {
    torso: rig.torsoPivot, leftArm: rig.leftArm, rightArm: rig.rightArm,
    leftElbow: rig.leftElbow, rightElbow: rig.rightElbow, upperArm: rig.upperArm, forearm: rig.forearm,
    handOffset: { y: plan.gloved ? -0.11 : -0.09, z: plan.gloved ? 0.01 : 0.0094 },
  }
}

const RECOVERY_SECONDS = 0.35
const UNIT_Y = new THREE.Vector3(0, 1, 0)

/** Legacy-only visual adapter. It never creates or reads a gameplay projectile. */
export class LegacyBowPresentation {
  readonly root: THREE.Group
  readonly visual = new THREE.Group()
  private readonly rig: BowAimRig
  private readonly pose: BowAimPose
  private readonly weapon: THREE.Object3D
  private readonly shield: THREE.Object3D | undefined
  private readonly melee: readonly THREE.Object3D[]
  private readonly arrow: THREE.Mesh
  private readonly strings: readonly [THREE.Mesh, THREE.Mesh]
  private readonly inverse = new THREE.Matrix4()
  private readonly center = new THREE.Vector3()
  private readonly endpoint = new THREE.Vector3()
  private readonly segment = new THREE.Vector3()
  private readonly savedVisibility = new Map<THREE.Object3D, boolean>()
  private savedTransforms: SavedTransform[] = []
  private aiming = false
  private remaining = 0
  private disposed = false

  constructor(root: THREE.Group, resources: LegacyBowResources) {
    this.root = root
    this.rig = legacyRig(root)
    this.pose = new BowAimPose(this.rig)
    const weapon = root.getObjectByName('weapon')
    const head = weapon?.getObjectByName('weapon-head')
    if (!weapon || weapon.parent !== this.rig.torso || !head ||
        root.getObjectByName('legacy-bow-presentation')) {
      throw new Error('Legacy bow requires a unique named weapon on the torso')
    }
    for (const geometry of [resources.bowGeometry, resources.arrowGeometry, resources.stringGeometry]) {
      if (!(geometry instanceof THREE.BufferGeometry) || !geometry.hasAttribute('position')) {
        throw new Error('Legacy bow requires caller-owned mesh geometry')
      }
    }
    for (const material of [resources.bowMaterial, resources.arrowMaterial, resources.stringMaterial]) {
      if (!(material instanceof THREE.Material)) throw new Error('Legacy bow requires caller-owned materials')
    }
    const positions = resources.stringGeometry.getAttribute('position')
    let minY = Infinity, maxY = -Infinity
    for (let i = 0; i < positions.count; i++) {
      minY = Math.min(minY, positions.getY(i))
      maxY = Math.max(maxY, positions.getY(i))
    }
    if (!Number.isFinite(minY + maxY) || Math.abs(minY + 0.5) > 1e-6 || Math.abs(maxY - 0.5) > 1e-6) {
      throw new Error('Legacy bow string geometry must be a centered unit-Y segment')
    }
    this.weapon = weapon
    this.shield = root.getObjectByName('shield')
    const grip = weapon.getObjectByName('weapon-grip-detail') ?? weapon.getObjectByName('weapon-grip')
    this.melee = grip ? [head, grip] : [head]
    const wood = new THREE.Mesh(resources.bowGeometry, resources.bowMaterial)
    wood.name = 'legacy-bow-wood'
    wood.position.z = -0.17
    this.arrow = new THREE.Mesh(resources.arrowGeometry, resources.arrowMaterial)
    this.arrow.name = 'legacy-bow-arrow'
    this.strings = [
      new THREE.Mesh(resources.stringGeometry, resources.stringMaterial),
      new THREE.Mesh(resources.stringGeometry, resources.stringMaterial),
    ]
    this.strings[0].name = 'legacy-bow-string-lower'
    this.strings[1].name = 'legacy-bow-string-upper'
    this.visual.name = 'legacy-bow-presentation'
    this.visual.visible = false
    for (const mesh of [wood, this.arrow, ...this.strings]) {
      mesh.castShadow = head.castShadow
      mesh.receiveShadow = head.receiveShadow
      mesh.userData.visualSubsystem = 'dynamicArt'
      this.visual.add(mesh)
    }
    this.updateString(BOW_AIM_DRAW)
    weapon.add(this.visual)
  }

  get bowAimingActive(): boolean { return this.aiming }

  setBowAiming(enabled: boolean): void {
    this.assertActive()
    if (enabled === this.aiming) return
    if (enabled) {
      if (!this.available(this.rig.leftArm) && !this.available(this.rig.rightArm)) {
        throw new Error('Legacy bow requires a surviving arm')
      }
      const nodes = [this.weapon, this.rig.leftArm, this.rig.rightArm, this.rig.leftElbow, this.rig.rightElbow,
        ...(this.shield ? [this.shield] : [])]
      this.savedTransforms = nodes.map((node) => ({
        node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
        matrix: node.matrix.clone(), matrixAutoUpdate: node.matrixAutoUpdate,
      }))
      for (const node of this.melee) {
        this.savedVisibility.set(node, node.visible)
        node.visible = false
      }
      this.pose.reset()
      this.remaining = 0
      this.aiming = true
      this.visual.visible = true
      this.arrow.visible = true
      this.updateString(BOW_AIM_DRAW)
      this.stowShield()
    } else {
      this.aiming = false
      this.remaining = 0
      this.visual.visible = false
      for (const saved of this.savedTransforms) {
        saved.node.position.copy(saved.position)
        saved.node.quaternion.copy(saved.quaternion)
        saved.node.scale.copy(saved.scale)
        saved.node.matrix.copy(saved.matrix)
        saved.node.matrixAutoUpdate = saved.matrixAutoUpdate
        saved.node.matrixWorldNeedsUpdate = true
      }
      for (const [node, visible] of this.savedVisibility) node.visible = visible
      this.savedTransforms = []
      this.savedVisibility.clear()
    }
  }

  poseBowAim(origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.assertActive()
    if (!this.aiming) return
    const left = this.available(this.rig.leftArm), right = this.available(this.rig.rightArm)
    if (!left && !right) {
      this.setBowAiming(false)
      return
    }
    const recoil = this.remaining > 0 ? Math.sin((1 - this.remaining / RECOVERY_SECONDS) * Math.PI) : 0
    this.pose.apply(origin, direction, left ? -1 : 1, left && right, this.remaining > 0, recoil)
    this.inverse.copy(this.rig.torso.matrixWorld).invert()
    this.weapon.matrixAutoUpdate = false
    this.weapon.matrix.multiplyMatrices(this.inverse, this.pose.frame)
    this.weapon.matrixWorldNeedsUpdate = true
    this.updateString(this.remaining > 0 ? 0 : this.pose.drawMeters)
    this.stowShield()
  }

  beginArrowPresentation(direction: THREE.Vector3, verticalAim: number): void {
    this.assertActive()
    if (!this.aiming) return
    if (!this.available(this.rig.leftArm) && !this.available(this.rig.rightArm)) {
      this.setBowAiming(false)
      throw new Error('Legacy arrow presentation requires a surviving arm')
    }
    if (![direction.x, direction.y, direction.z, verticalAim].every(Number.isFinite) || direction.lengthSq() < 1e-10) {
      throw new Error('Legacy arrow presentation requires a finite shot direction')
    }
    this.remaining = RECOVERY_SECONDS
    this.arrow.visible = false
    this.updateString(0)
  }

  advanceActionPresentation(delta: number, cancelled: boolean): void {
    this.assertActive()
    if (!Number.isFinite(delta) || delta < 0) throw new Error('Invalid legacy bow presentation timestep')
    if (!this.aiming) return
    if (cancelled || (!this.available(this.rig.leftArm) && !this.available(this.rig.rightArm))) {
      this.setBowAiming(false)
      return
    }
    if (this.remaining <= 0) return
    this.remaining = Math.max(0, this.remaining - delta)
    if (this.remaining === 0) {
      this.arrow.visible = true
      this.updateString(this.pose.drawMeters)
    }
  }

  private updateString(draw: number): void {
    this.arrow.position.z = -0.17 - draw
    this.center.set(0.02, 0, -0.23 - draw)
    for (let i = 0; i < 2; i++) {
      this.endpoint.set(0.02, i === 0 ? -0.74 : 0.74, -0.23)
      this.segment.copy(this.endpoint).sub(this.center)
      const length = this.segment.length()
      const mesh = this.strings[i]
      mesh.position.copy(this.center).add(this.endpoint).multiplyScalar(0.5)
      mesh.quaternion.setFromUnitVectors(UNIT_Y, this.segment.multiplyScalar(1 / length))
      mesh.scale.set(1, length, 1)
    }
  }

  private available(arm: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = arm; node && node !== this.root; node = node.parent) {
      if (!node.visible) return false
    }
    return true
  }

  private stowShield(): void {
    if (!this.shield) return
    this.shield.position.set(0, this.rig.leftArm.position.y - 0.28, -0.44)
    this.shield.rotation.set(0, Math.PI, 0)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Legacy bow presentation is disposed')
  }

  dispose(): void {
    if (this.disposed) return
    this.setBowAiming(false)
    this.visual.removeFromParent()
    this.disposed = true
  }
}
