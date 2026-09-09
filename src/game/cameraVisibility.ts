import * as THREE from 'three'
import { dampingAlpha } from './cameraAccents.ts'

export const CAMERA_CANDIDATE_LIMIT = 5
export const CAMERA_OCCLUDER_LIMIT = 64
export const CAMERA_TRIANGLE_LIMIT = 32768
export const CAMERA_TERRAIN_STEPS = 32

export interface CameraSweepResult {
  distance: number
  blocked: boolean
  overflow: boolean
  triangleTests: number
}

export interface CameraVolumeQuery {
  sweep(from: THREE.Vector3, to: THREE.Vector3, radius: number, result: CameraSweepResult): void
}

export interface CameraTriangleSource {
  readonly geometry: THREE.BufferGeometry
  readonly matrix: THREE.Matrix4
  readonly bounds: THREE.Box3
}

const a = new THREE.Vector3()
const b = new THREE.Vector3()
const c = new THREE.Vector3()
const closest = new THREE.Vector3()
const normal = new THREE.Vector3()
const triangle = new THREE.Triangle()
const direction = new THREE.Vector3()
const point = new THREE.Vector3()
const expanded = new THREE.Box3()
const ray = new THREE.Ray()

function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number {
  const x = origin.x - center.x, y = origin.y - center.y, z = origin.z - center.z
  const projection = x * dir.x + y * dir.y + z * dir.z
  const square = x * x + y * y + z * z - radius * radius
  if (square <= 0) return 0
  const discriminant = projection * projection - square
  if (discriminant < 0) return Infinity
  const distance = -projection - Math.sqrt(discriminant)
  return distance < 0 ? Infinity : distance
}

function rayEdge(origin: THREE.Vector3, dir: THREE.Vector3, first: THREE.Vector3, second: THREE.Vector3, radius: number): number {
  const bx = second.x - first.x, by = second.y - first.y, bz = second.z - first.z
  const ox = origin.x - first.x, oy = origin.y - first.y, oz = origin.z - first.z
  const bb = bx * bx + by * by + bz * bz
  const bd = bx * dir.x + by * dir.y + bz * dir.z
  const bo = bx * ox + by * oy + bz * oz
  const dd = dir.x * ox + dir.y * oy + dir.z * oz
  const oo = ox * ox + oy * oy + oz * oz
  const aa = bb - bd * bd
  const beta = bb * dd - bo * bd
  const cc = bb * oo - bo * bo - radius * radius * bb
  const discriminant = beta * beta - aa * cc
  let hit = Infinity
  if (aa > 1e-10 && discriminant >= 0) {
    const distance = (-beta - Math.sqrt(discriminant)) / aa
    const along = bo + distance * bd
    if (distance >= 0 && along >= 0 && along <= bb) hit = distance
  }
  return Math.min(hit, raySphere(origin, dir, first, radius), raySphere(origin, dir, second, radius))
}

/** Continuous sphere/triangle faces, edge capsules and vertices, not a center ray. */
export function sweepCameraSphere(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  sources: readonly CameraTriangleSource[],
  result: CameraSweepResult,
): void {
  if (![from.x, from.y, from.z, to.x, to.y, to.z, radius].every(Number.isFinite) || radius <= 0) {
    throw new RangeError('Camera sweep must be finite with a positive radius')
  }
  const length = direction.subVectors(to, from).length()
  result.distance = length
  result.blocked = false
  result.overflow = false
  result.triangleTests = 0
  direction.multiplyScalar(1 / Math.max(length, 1e-9))
  ray.set(from, direction)
  let candidates = 0
  for (const source of sources) {
    expanded.copy(source.bounds).expandByScalar(radius)
    if (!expanded.containsPoint(from) &&
        (!ray.intersectBox(expanded, point) || point.distanceTo(from) > result.distance)) continue
    if (++candidates > CAMERA_OCCLUDER_LIMIT) {
      result.overflow = result.blocked = true
      result.distance = 0
      return
    }
    const position = source.geometry.getAttribute('position')
    const indices = source.geometry.getIndex()
    const count = indices?.count ?? position.count
    let firstCenterHit = Infinity
    let centerExits = false
    for (let offset = 0; offset + 2 < count; offset += 3) {
      if (++result.triangleTests > CAMERA_TRIANGLE_LIMIT) {
        result.overflow = result.blocked = true
        result.distance = 0
        return
      }
      a.fromBufferAttribute(position, indices ? indices.getX(offset) : offset).applyMatrix4(source.matrix)
      b.fromBufferAttribute(position, indices ? indices.getX(offset + 1) : offset + 1).applyMatrix4(source.matrix)
      c.fromBufferAttribute(position, indices ? indices.getX(offset + 2) : offset + 2).applyMatrix4(source.matrix)
      triangle.set(a, b, c)
      triangle.closestPointToPoint(from, closest)
      if (closest.distanceToSquared(from) <= radius * radius) {
        result.distance = 0
        result.blocked = true
        return
      }
      if (length < 1e-8) continue
      triangle.getNormal(normal)
      const velocity = normal.dot(direction)
      const planeDistance = normal.dot(point.subVectors(from, a))
      if (Math.abs(velocity) > 1e-8) {
        const centerDistance = -planeDistance / velocity
        if (centerDistance >= 0 && centerDistance < firstCenterHit) {
          point.copy(from).addScaledVector(direction, centerDistance)
          if (triangle.containsPoint(point)) {
            firstCenterHit = centerDistance
            centerExits = velocity > 0
          }
        }
        for (let side = -1; side <= 1; side += 2) {
          const distance = (side * radius - planeDistance) / velocity
          if (distance < 0 || distance > result.distance) continue
          point.copy(from).addScaledVector(direction, distance).addScaledVector(normal, -side * radius)
          if (triangle.containsPoint(point)) result.distance = distance
        }
      }
      result.distance = Math.min(result.distance,
        rayEdge(from, direction, a, b, radius), rayEdge(from, direction, b, c, radius),
        rayEdge(from, direction, c, a, radius))
    }
    // Closed authored solids can contain the starting center without touching
    // its sphere. The first outward crossing is not a safe exit camera position.
    if (centerExits && firstCenterHit < Infinity) result.distance = 0
  }
  result.blocked = result.distance < length - 1e-6
}

export interface CameraVisibilityDebug {
  candidates: number
  sweeps: number
  triangleTests: number
  terrainSamples: number
  overflows: number
  shoulder: number
  boomDistance: number
  playerVisibility: number
}

export class CameraVisibility {
  readonly debug: CameraVisibilityDebug = {
    candidates: 0, sweeps: 0, triangleTests: 0, terrainSamples: 0, overflows: 0,
    shoulder: 0, boomDistance: 0, playerVisibility: 1,
  }
  private readonly sweepResult: CameraSweepResult = { distance: 0, blocked: false, overflow: false, triangleTests: 0 }
  private readonly candidate = new THREE.Vector3()
  private readonly solved = new THREE.Vector3()
  private readonly best = new THREE.Vector3()
  private readonly follow = new THREE.Vector3()
  private readonly previous = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly sample = new THREE.Vector3()
  private initialized = false
  private shoulder = 0
  private shoulderHold = 0
  private releaseHold = 0
  private radius = 0.35

  reset(): void { this.initialized = false; this.shoulder = 0; this.shoulderHold = 0; this.releaseHold = 0 }

  resolve(
    target: THREE.Vector3, desired: THREE.Vector3, camera: THREE.PerspectiveCamera,
    delta: number, immediate: boolean, query: CameraVolumeQuery,
    terrain: (x: number, z: number) => number, output: THREE.Vector3,
  ): void {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Invalid camera delta')
    this.debug.candidates = this.debug.sweeps = this.debug.triangleTests = this.debug.terrainSamples = this.debug.overflows = 0
    const halfHeight = camera.near * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    this.radius = Math.max(0.32, Math.hypot(halfHeight, halfHeight * camera.aspect) + 0.12)
    this.right.subVectors(desired, target).setY(0).normalize()
    this.right.set(this.right.z, 0, -this.right.x)
    this.shoulderHold = Math.max(0, this.shoulderHold - delta)
    this.releaseHold = Math.max(0, this.releaseHold - delta)
    let score = -Infinity
    let chosen = 0
    for (let index = 0; index < CAMERA_CANDIDATE_LIMIT; index++) {
      this.candidate.copy(desired)
      if (index === 1 || index === 2) {
        this.candidate.addScaledVector(this.right, index === 1 ? 3.4 : -3.4)
        this.candidate.y += 0.8
      } else if (index === 3) this.candidate.y += 5.2
      else if (index === 4) { this.candidate.lerp(target, 0.25); this.candidate.y += 3 }
      this.safePosition(target, this.candidate, query, terrain, this.solved)
      this.debug.candidates++
      const distance = this.solved.distanceTo(target)
      const candidateScore = distance - (index === 0 ? 0 : index === 3 ? 1.1 : 0.55) +
        (index === this.shoulder && this.shoulderHold > 0 ? 1.2 : 0)
      if (candidateScore > score) { score = candidateScore; chosen = index; this.best.copy(this.solved) }
      if (index === 0 && distance >= desired.distanceTo(target) - 0.15 && this.shoulderHold === 0) break
    }
    if (chosen !== this.shoulder) { this.shoulder = chosen; this.shoulderHold = 0.35 }
    const wanted = this.best.distanceTo(target)
    const current = this.follow.distanceTo(target)
    if (immediate || !this.initialized) {
      this.follow.copy(this.best)
      this.initialized = true
    } else {
      this.previous.copy(this.follow)
      if (wanted < current - 0.12) this.releaseHold = 0.16
      const alpha = wanted < current ? 1 : this.releaseHold > 0 ? 0 : dampingAlpha(6, delta)
      this.follow.lerp(this.best, alpha)
      this.safePosition(target, this.follow, query, terrain, this.solved)
      this.follow.copy(this.solved)
      // Check the actual follow displacement too. Do not smooth through a corner.
      if (this.previous.distanceToSquared(this.follow) < 16 && this.previous.distanceToSquared(target) > 1) {
        this.sweep(query, this.previous, this.follow)
        if (this.sweepResult.blocked && this.sweepResult.distance > 0) {
          this.offset.subVectors(this.follow, this.previous).setLength(Math.max(0, this.sweepResult.distance - 0.02))
          this.follow.copy(this.previous).add(this.offset)
          this.safePosition(target, this.follow, query, terrain, this.solved)
          this.follow.copy(this.solved)
        }
      }
    }
    output.copy(this.follow)
    this.debug.shoulder = this.shoulder
    this.debug.boomDistance = output.distanceTo(target)
    const visibility = THREE.MathUtils.smoothstep(this.debug.boomDistance, 0.8, 3.6)
    this.debug.playerVisibility = immediate ? visibility :
      THREE.MathUtils.lerp(this.debug.playerVisibility, visibility, dampingAlpha(16, delta))
  }

  constrain(
    target: THREE.Vector3, candidate: THREE.Vector3, query: CameraVolumeQuery,
    terrain: (x: number, z: number) => number, output: THREE.Vector3,
  ): void { this.safePosition(target, candidate, query, terrain, output) }

  private sweep(query: CameraVolumeQuery, from: THREE.Vector3, to: THREE.Vector3): void {
    query.sweep(from, to, this.radius, this.sweepResult)
    this.debug.sweeps++
    this.debug.triangleTests += this.sweepResult.triangleTests
    if (this.sweepResult.overflow) this.debug.overflows++
  }

  private height(terrain: (x: number, z: number) => number, x: number, z: number): number {
    this.debug.terrainSamples++
    const height = terrain(x, z)
    if (!Number.isFinite(height)) throw new Error('Camera terrain sampler returned a non-finite height')
    return height
  }

  private clearsTerrain(terrain: (x: number, z: number) => number, position: THREE.Vector3): boolean {
    // Nine footprint probes cover the near-plane volume on slopes, not merely
    // its center. The underlying production height query remains unchanged.
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        if (position.y - this.radius < this.height(terrain, position.x + x * this.radius, position.z + z * this.radius)) return false
      }
    }
    return true
  }

  private safePosition(
    target: THREE.Vector3, wanted: THREE.Vector3, query: CameraVolumeQuery,
    terrain: (x: number, z: number) => number, output: THREE.Vector3,
  ): void {
    output.copy(wanted)
    output.y = Math.max(output.y, this.height(terrain, output.x, output.z) + this.radius + 0.16)
    this.offset.subVectors(output, target)
    const distance = this.offset.length()
    this.sweep(query, target, output)
    if (this.sweepResult.blocked) output.copy(target).addScaledVector(
      this.offset, Math.max(0, this.sweepResult.distance - 0.04) / Math.max(distance, 1e-6),
    )
    this.offset.subVectors(output, target)
    const steps = Math.min(CAMERA_TERRAIN_STEPS, Math.max(1, Math.ceil(this.offset.length() / 0.45)))
    for (let step = 1; step <= steps; step++) {
      this.sample.copy(target).addScaledVector(this.offset, step / steps)
      if (this.clearsTerrain(terrain, this.sample)) continue
      let lower = (step - 1) / steps
      let upper = step / steps
      for (let iteration = 0; iteration < 6; iteration++) {
        const middle = (lower + upper) * 0.5
        this.sample.copy(target).addScaledVector(this.offset, middle)
        if (this.clearsTerrain(terrain, this.sample)) lower = middle
        else upper = middle
      }
      output.copy(target).addScaledVector(this.offset, lower)
      break
    }
  }
}
