import * as THREE from 'three'

export const BOW_AIM_DRAW = 0.3
const MIN_DRAW = 0.08

export interface BowAimRig {
  readonly torso: THREE.Object3D
  readonly leftArm: THREE.Object3D
  readonly rightArm: THREE.Object3D
  readonly leftElbow: THREE.Object3D
  readonly rightElbow: THREE.Object3D
  readonly upperArm: number
  readonly forearm: number
  /** Offset from the authored wrist to the actual hand's grip center. */
  readonly handOffset?: { readonly y: number; readonly z: number }
}

/** Shared bounded arm solve; neither renderer nor gameplay owns its targets. */
export class BowAimPose {
  private readonly rig: BowAimRig
  readonly frame = new THREE.Matrix4()
  readonly nock = new THREE.Vector3()
  drawMeters = BOW_AIM_DRAW
  private readonly inverse = new THREE.Matrix4()
  private readonly side = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly gripOrigin = new THREE.Vector3()
  private readonly gripTarget = new THREE.Vector3()
  private readonly nockTarget = new THREE.Vector3()
  private readonly scratch = new THREE.Vector3()
  private readonly local = new THREE.Vector3()

  constructor(rig: BowAimRig) {
    this.rig = rig
    if (![rig.upperArm, rig.forearm].every((n) => Number.isFinite(n) && n > 0) ||
        ![rig.handOffset?.y ?? 0, rig.handOffset?.z ?? 0].every(Number.isFinite) ||
        rig.leftArm.parent !== rig.torso || rig.rightArm.parent !== rig.torso ||
        rig.leftElbow.parent !== rig.leftArm || rig.rightElbow.parent !== rig.rightArm) {
      throw new Error('Bow pose requires a finite articulated arm chain on the torso')
    }
  }

  reset(): void { this.drawMeters = BOW_AIM_DRAW }

  apply(origin: THREE.Vector3, direction: THREE.Vector3, main: -1 | 1, support: boolean, released: boolean, recoil: number): void {
    if (![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, recoil].every(Number.isFinite) ||
        Math.abs(direction.lengthSq() - 1) > 1e-5 || recoil < 0 || recoil > 1) {
      throw new Error('Bow aim requires a finite world nock origin and unit flight direction')
    }
    const torso = this.rig.torso
    torso.updateWorldMatrix(true, true)
    const determinant = torso.matrixWorld.determinant()
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
      throw new Error('Bow aim requires a finite invertible torso transform')
    }
    this.inverse.copy(torso.matrixWorld).invert()
    this.forward.copy(direction)
    this.up.set(0, 1, 0)
    this.side.crossVectors(this.up, this.forward)
    if (this.side.lengthSq() < 1e-8) {
      this.side.set(1, 0, 0)
      this.side.addScaledVector(this.forward, -this.side.dot(this.forward))
    }
    this.side.normalize()
    this.up.crossVectors(this.forward, this.side).normalize()
    const e = torso.matrixWorld.elements
    this.side.multiplyScalar(Math.hypot(e[0], e[1], e[2]))
    this.up.multiplyScalar(Math.hypot(e[4], e[5], e[6]))
    this.forward.multiplyScalar(Math.hypot(e[8], e[9], e[10]))
    let draw = released ? this.drawMeters : BOW_AIM_DRAW
    this.nock.copy(origin).addScaledVector(direction, -0.045 * recoil)
    this.frame.makeBasis(this.side, this.up, this.forward)
    this.gripOrigin.copy(this.nock).addScaledVector(this.side, -0.02).addScaledVector(this.forward, 0.23)
    this.gripTarget.copy(this.gripOrigin).addScaledVector(this.forward, draw).applyMatrix4(this.inverse)
    this.nockTarget.copy(this.nock).applyMatrix4(this.inverse)
    // Validate both reaches before changing either arm or forcing a hand matrix.
    const supportBend = support ? this.armBend(main === 1 ? -1 : 1, this.nockTarget) : null
    const arm = main > 0 ? this.rig.rightArm : this.rig.leftArm
    const maxReach = this.armLength(main, 0.02)
    if (!released && this.gripTarget.distanceTo(arm.position) > maxReach) {
      let lo = MIN_DRAW, hi = BOW_AIM_DRAW
      for (let i = 0; i < 24; i++) {
        const candidate = (lo + hi) * 0.5
        this.gripTarget.copy(this.gripOrigin).addScaledVector(this.forward, candidate).applyMatrix4(this.inverse)
        if (this.gripTarget.distanceTo(arm.position) > maxReach) hi = candidate
        else lo = candidate
      }
      draw = lo
      this.gripTarget.copy(this.gripOrigin).addScaledVector(this.forward, draw).applyMatrix4(this.inverse)
    }
    const gripBend = this.armBend(main, this.gripTarget)
    this.drawMeters = draw
    this.scratch.copy(this.gripOrigin).addScaledVector(this.forward, draw)
    this.frame.setPosition(this.scratch)
    this.applyArm(main, this.gripTarget, gripBend)
    if (supportBend !== null) this.applyArm(main === 1 ? -1 : 1, this.nockTarget, supportBend)
  }

  private handVector(side: -1 | 1): THREE.Vector3 {
    const elbow = side > 0 ? this.rig.rightElbow : this.rig.leftElbow
    return this.local.set(0, (-this.rig.forearm + (this.rig.handOffset?.y ?? 0)) * elbow.scale.y,
      (this.rig.handOffset?.z ?? 0) * elbow.scale.z)
  }

  private armBend(side: -1 | 1, target: THREE.Vector3): number {
    const arm = side > 0 ? this.rig.rightArm : this.rig.leftArm
    const reach = this.scratch.copy(target).sub(arm.position).length()
    let lo = 0.02, hi = 2.55
    if (!Number.isFinite(reach) || reach > this.armLength(side, lo) + 1e-6 || reach < this.armLength(side, hi) - 1e-6) {
      throw new RangeError(`Bow ${side > 0 ? 'right' : 'left'} hand target is unreachable: ${reach.toFixed(4)}m`)
    }
    for (let i = 0; i < 24; i++) {
      const bend = (lo + hi) * 0.5
      if (this.armLength(side, bend) > reach) lo = bend
      else hi = bend
    }
    return (lo + hi) * 0.5
  }

  private armLength(side: -1 | 1, bend: number): number {
    const arm = side > 0 ? this.rig.rightArm : this.rig.leftArm
    const elbow = side > 0 ? this.rig.rightElbow : this.rig.leftElbow
    const forearm = this.handVector(side).length()
    const sy = arm.scale.y, sz = arm.scale.z
    if (!Number.isFinite(arm.scale.lengthSq() + elbow.scale.lengthSq()) ||
        Math.min(arm.scale.x, sy, sz, elbow.scale.x, elbow.scale.y, elbow.scale.z, forearm) <= 0) {
      throw new Error('Bow aim requires finite positive arm segment scales')
    }
    return Math.hypot((this.rig.upperArm + forearm * Math.cos(bend)) * sy, forearm * Math.sin(bend) * sz)
  }

  private applyArm(side: -1 | 1, target: THREE.Vector3, bend: number): void {
    const arm = side > 0 ? this.rig.rightArm : this.rig.leftArm
    const elbow = side > 0 ? this.rig.rightElbow : this.rig.leftElbow
    const hand = this.handVector(side)
    const phase = Math.atan2(hand.z, -hand.y)
    const forearm = hand.length()
    this.local.set(0, -(this.rig.upperArm + forearm * Math.cos(bend)) * arm.scale.y,
      -forearm * Math.sin(bend) * arm.scale.z).normalize()
    this.scratch.copy(target).sub(arm.position).normalize()
    arm.quaternion.setFromUnitVectors(this.local, this.scratch)
    elbow.rotation.set(bend + phase, 0, 0, 'XYZ')
  }
}
