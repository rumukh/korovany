import * as THREE from 'three'

export const BOW_AIM_HEIGHT = 2.05
export const BOW_AIM_PITCH_LIMIT = 1.2
export type BowAimSource = 'keyboard' | 'mouse' | 'pointer' | 'button'

/** Gameplay coordinates, independent of camera collision, render quality and shake. */
export class BowAim {
  readonly sources = new Set<BowAimSource>()
  readonly anchor = new THREE.Vector3()
  readonly eye = new THREE.Vector3()
  readonly target = new THREE.Vector3()
  readonly origin = new THREE.Vector3()
  readonly direction = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  heading = 0

  resolve(
    position: THREE.Vector3, yaw: number, pitch: number, leftArmMissing: boolean, range: number,
    firstHit: (start: THREE.Vector3, end: THREE.Vector3) => number | null,
  ): void {
    const sin = Math.sin(yaw), cos = Math.cos(yaw)
    this.forward.set(sin, 0, -cos)
    this.anchor.copy(position).y += BOW_AIM_HEIGHT
    this.eye.copy(this.anchor).addScaledVector(this.forward, -4)
    this.eye.x += cos * 0.75
    this.eye.z += sin * 0.75
    this.direction.copy(this.forward).multiplyScalar(Math.cos(pitch)).y = -Math.sin(pitch)
    this.target.copy(this.anchor).addScaledVector(this.direction, range)
    const hit = firstHit(this.anchor, this.target)
    if (hit !== null) this.target.copy(this.anchor).addScaledVector(this.direction, Math.max(0.12, range * hit))

    // Shrinking only the horizontal offsets keeps a very close shot in front of the
    // hand instead of turning the bow back toward the player's chest.
    const distance = Math.hypot(this.target.x - position.x, this.target.z - position.z)
    const lateral = Math.min(0.25, distance * 0.2) * (leftArmMissing ? 1 : -1)
    const ahead = Math.min(0.35, distance * 0.25)
    this.heading = Math.atan2(sin, -cos)
    this.origin.set(
      position.x - cos * lateral + sin * ahead,
      position.y + BOW_AIM_HEIGHT,
      position.z - sin * lateral - cos * ahead,
    )
    if (firstHit(this.anchor, this.origin) !== null) this.origin.copy(this.anchor)
    this.direction.subVectors(this.target, this.origin)
    const length = this.direction.length()
    const horizontal = Math.hypot(this.direction.x, this.direction.z)
    const elevation = THREE.MathUtils.clamp(
      Math.atan2(this.direction.y, horizontal), -BOW_AIM_PITCH_LIMIT, BOW_AIM_PITCH_LIMIT,
    )
    this.direction.y = 0
    this.direction.normalize().multiplyScalar(Math.cos(elevation)).y = Math.sin(elevation)
    this.target.copy(this.origin).addScaledVector(this.direction, length)
  }
}
