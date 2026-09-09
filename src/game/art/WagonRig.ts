import * as THREE from 'three'
import { WAGON_RIG } from './CharacterKit.ts'
import { creaturePresenter, type CreaturePresenter } from './CreatureRig.ts'

const WAGONS = new WeakMap<THREE.Object3D, WagonPresenter>()
const X_AXIS = new THREE.Vector3(1, 0, 0)
export function wagonPresenter(root: THREE.Object3D): WagonPresenter | undefined { return WAGONS.get(root) }

/** All offsets are on visual children. The route/collider root remains the engine's. */
export class WagonPresenter {
  readonly root: THREE.Group
  readonly frame: THREE.Object3D
  private readonly wheels: readonly THREE.Object3D[]
  private readonly oxen: readonly { root: THREE.Object3D; head: THREE.Object3D; rig: CreaturePresenter }[]
  private readonly traces: readonly THREE.Object3D[]
  private readonly yoke: THREE.Object3D
  private readonly cargo: THREE.Object3D
  private readonly point = new THREE.Vector3()
  private readonly from = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly inverse = new THREE.Matrix4()
  private phase = 0
  private previousSpeed = 0
  private frameLift = 0
  private lastCargoScale = 1
  private disposed = false

  constructor(root: THREE.Group) {
    this.root = root
    const frame = root.getObjectByName('wagon-frame-pivot')
    const yoke = root.getObjectByName('draft-yoke')
    const cargo = root.getObjectByName('cargo')
    if (!frame || !yoke || !cargo) throw new Error('Incomplete production wagon rig')
    this.frame = frame; this.yoke = yoke; this.cargo = cargo
    this.wheels = root.getObjectsByProperty('name', 'wheel')
    this.oxen = root.getObjectsByProperty('name', 'draft-ox').map((ox) => {
      const head = ox.getObjectByName('ox-head'), rig = creaturePresenter(ox)
      if (!head || !rig) throw new Error('Draft team must have a posed head and articulated body')
      return { root: ox, head, rig }
    })
    const left = root.getObjectByName('left-trace'), right = root.getObjectByName('right-trace')
    if (!left || !right || this.wheels.length !== 4 || this.oxen.length !== 2) throw new Error('Wagon needs four wheels, two oxen, and two traces')
    this.traces = [left, right]
    WAGONS.set(root, this)
  }

  update(delta: number, travel: number, sampleHeight: (x: number, z: number) => number): void {
    if (this.disposed) throw new Error('Wagon presenter is disposed')
    if (!Number.isFinite(travel) || travel < 0 || !Number.isFinite(delta) || delta < 0) throw new Error('Invalid wagon visual motion')
    this.root.updateWorldMatrix(true, true)
    let rear = 0, front = 0, left = 0, right = 0
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]
      const radius: unknown = wheel.userData.wheelRadius
      if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) throw new Error('Wagon wheel has no valid rolling radius')
      wheel.rotation.z -= travel / radius
      this.point.set(wheel.position.x, 0, wheel.position.z).applyMatrix4(this.root.matrixWorld)
      const height = sampleHeight(this.point.x, this.point.z) - this.root.position.y
      if (!Number.isFinite(height)) throw new Error('Wagon terrain sample is non-finite')
      if (wheel.position.x < 0) rear += height * 0.5
      else front += height * 0.5
      if (wheel.position.z < 0) left += height * 0.5
      else right += height * 0.5
    }
    const load = THREE.MathUtils.clamp(this.cargo.scale.y, 0.3, 1)
    const speed = delta > 0 ? travel / delta : this.previousSpeed
    const acceleration = delta > 0 ? THREE.MathUtils.clamp((speed - this.previousSpeed) / delta, -8, 8) : 0
    this.previousSpeed = speed
    this.phase += travel * 2.3
    const settle = (1 - load) * 0.028
    this.frameLift = THREE.MathUtils.damp(this.frameLift, THREE.MathUtils.clamp((front + rear) * 0.5, -0.3, 0.3) + settle, 10, delta)
    this.frame.position.y = this.frameLift
    this.frame.rotation.z = THREE.MathUtils.damp(this.frame.rotation.z,
      THREE.MathUtils.clamp(Math.atan2(front - rear, WAGON_RIG.frontAxleX - WAGON_RIG.rearAxleX) - acceleration * 0.002, -0.16, 0.16), 9, delta)
    this.frame.rotation.x = THREE.MathUtils.damp(this.frame.rotation.x,
      THREE.MathUtils.clamp(-Math.atan2(right - left, WAGON_RIG.wheelZ * 2), -0.14, 0.14), 9, delta)
    // Robbery compression settles the load, not the visible deck or simulation root.
    this.cargo.position.y = 2.45 - (1 - load) * 0.67
    this.lastCargoScale = load
    for (let index = 0; index < this.oxen.length; index++) {
      const ox = this.oxen[index]
      this.point.set(ox.root.position.x, 0, ox.root.position.z).applyMatrix4(this.root.matrixWorld)
      const height = sampleHeight(this.point.x, this.point.z) - this.root.position.y
      if (!Number.isFinite(height)) throw new Error('Draft ox terrain sample is non-finite')
      ox.root.position.y = THREE.MathUtils.damp(ox.root.position.y, THREE.MathUtils.clamp(height, -0.45, 0.45), 12, delta)
      const stride = speed > 0.01 ? Math.sin(this.phase + index * 0.7) * 0.28 : 0
      for (const leg of ox.rig.legs) leg.upper.rotation.x = stride * leg.side * (leg.front ? -1 : 1)
      ox.rig.poseFeet(delta, stride, sampleHeight)
      ox.head.rotation.x = 0.2 + Math.abs(stride) * 0.1
    }
    this.root.updateWorldMatrix(true, true)
    for (let index = 0; index < this.traces.length; index++) {
      const trace = this.traces[index], side = index === 0 ? -1 : 1
      this.from.set(2.1, 1.38, side * 0.54).applyMatrix4(this.frame.matrixWorld)
      const ox = this.oxen[index]
      this.to.set(0, 1.82, 0.72).applyMatrix4(ox.root.matrixWorld)
      this.inverse.copy(trace.parent!.matrixWorld).invert()
      this.from.applyMatrix4(this.inverse)
      this.to.applyMatrix4(this.inverse)
      trace.position.copy(this.from).add(this.to).multiplyScalar(0.5)
      this.to.sub(this.from)
      trace.scale.x = this.to.length()
      trace.quaternion.setFromUnitVectors(X_AXIS, this.to.normalize())
    }
    this.yoke.position.y = 2.02 + (this.oxen[0].root.position.y + this.oxen[1].root.position.y) * 0.5
  }

  snapshot() {
    return { draftAnimals: this.oxen.length, wheels: this.wheels.length, phase: this.phase, load: this.lastCargoScale }
  }

  dispose(): void { this.disposed = true; WAGONS.delete(this.root) }
}
