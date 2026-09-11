import * as THREE from 'three'
import { dampingAlpha } from './cameraAccents.ts'

export const CAMERA_CANDIDATE_LIMIT = 5
export const CAMERA_OCCLUDER_LIMIT = 64
export const CAMERA_TRIANGLE_LIMIT = 32768
export const CAMERA_TERRAIN_STEPS = 32
export const CAMERA_RECOVERY_STEPS = 4
export const CAMERA_RECOVERY_DIRECTIONS = 7
export const CAMERA_TARGET_PROBES = 3
const TARGET_SIGHT_RADIUS = 0.02

export interface CameraSweepResult {
  distance: number
  blocked: boolean
  overflow: boolean
  triangleTests: number
  initialOverlap: boolean
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
  result.initialOverlap = false
  if (length > 1e-8) direction.multiplyScalar(1 / length)
  // Occupancy queries still need a ray to detect closed-solid containment.
  else direction.set(0.3713906763541037, 0.5570860145311556, 0.7427813527082074)
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
        result.initialOverlap = true
        return
      }
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
    if (centerExits && firstCenterHit < Infinity) {
      result.distance = 0
      result.blocked = result.initialOverlap = true
      return
    }
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
  recovery: 'none' | 'previous' | 'local'
  targetProbes: number
  visibleTargetProbes: number
  visibilityCut: boolean
  framingActive: boolean
  framingCut: boolean
  framedTargetProbes: number
  framingError: number
  torsoNdcX: number
  torsoNdcY: number
  headNdcX: number
  headNdcY: number
}

export class CameraVisibility {
  readonly debug: CameraVisibilityDebug = {
    candidates: 0, sweeps: 0, triangleTests: 0, terrainSamples: 0, overflows: 0,
    shoulder: 0, boomDistance: 0, playerVisibility: 1, recovery: 'none',
    targetProbes: 0, visibleTargetProbes: 0, visibilityCut: false,
    framingActive: false, framingCut: false, framedTargetProbes: 0, framingError: 0,
    torsoNdcX: 0, torsoNdcY: 0, headNdcX: 0, headNdcY: 0,
  }
  private readonly sweepResult: CameraSweepResult = {
    distance: 0, blocked: false, overflow: false, triangleTests: 0, initialOverlap: false,
  }
  private readonly candidate = new THREE.Vector3()
  private readonly solved = new THREE.Vector3()
  private readonly best = new THREE.Vector3()
  private readonly follow = new THREE.Vector3()
  private readonly previous = new THREE.Vector3()
  private readonly lastSafe = new THREE.Vector3()
  private readonly collisionOrigin = new THREE.Vector3()
  private readonly recoveryCandidate = new THREE.Vector3()
  private readonly recoveryDirection = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly sample = new THREE.Vector3()
  private readonly sightSample = new THREE.Vector3()
  private readonly sightTargets = Array.from({ length: CAMERA_TARGET_PROBES }, () => new THREE.Vector3())
  private readonly sightEligible = new Uint8Array(CAMERA_TARGET_PROBES)
  private readonly framingTarget = new THREE.Vector3()
  private readonly viewForward = new THREE.Vector3()
  private readonly viewRight = new THREE.Vector3()
  private readonly viewUp = new THREE.Vector3()
  private readonly projected = new THREE.Vector3()
  private projectionX = 1
  private projectionY = 1
  private projectionOffsetX = 0
  private projectionOffsetY = 0
  private viewNear = 0.1
  private viewFar = 240
  private rollCos = 1
  private rollSin = 0
  private frameMinY = -0.82
  private frameMaxY = 0.82
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
    viewYaw?: number, viewPitch = 0, viewRoll = 0,
  ): void {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Invalid camera delta')
    this.debug.candidates = this.debug.sweeps = this.debug.triangleTests = this.debug.terrainSamples = this.debug.overflows = 0
    const halfHeight = camera.near * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    this.radius = Math.max(0.32, Math.hypot(halfHeight, halfHeight * camera.aspect) + 0.12)
    this.prepareFraming(target, desired, camera, viewYaw, viewPitch, viewRoll)
    this.prepareTargetSight(target, query, terrain)
    this.debug.visibilityCut = this.debug.framingCut = false
    this.previous.copy(this.lastSafe)
    const previousClear = this.initialized && this.previous.distanceTo(target) <= 32 &&
      this.clearPose(this.previous, query, terrain)
    const previousVisible = previousClear &&
      this.targetSightScore(this.previous, query, terrain) === this.debug.targetProbes
    const previousFramed = this.framingError(this.previous) === 0
    const previousSafe = previousVisible && previousFramed
    this.selectCollisionOrigin(target, desired, previousSafe, query, terrain)
    this.right.subVectors(desired, target).setY(0).normalize()
    this.right.set(this.right.z, 0, -this.right.x)
    this.shoulderHold = Math.max(0, this.shoulderHold - delta)
    this.releaseHold = Math.max(0, this.releaseHold - delta)
    this.best.copy(this.collisionOrigin)
    let bestSight = this.targetSightScore(this.best, query, terrain)
    let bestFraming = this.framingError(this.best)
    let score = this.best.distanceTo(target) > this.radius
      ? this.poseScore(bestSight, bestFraming) + this.best.distanceTo(target) : -Infinity
    let chosen = 0
    for (let index = 0; index < CAMERA_CANDIDATE_LIMIT; index++) {
      this.candidate.copy(desired)
      if (index === 1 || index === 2) {
        this.candidate.addScaledVector(this.right, index === 1 ? 3.4 : -3.4)
        this.candidate.y += 0.8
      } else if (index === 3) this.candidate.y += 5.2
      else if (index === 4) { this.candidate.lerp(target, 0.25); this.candidate.y += 3 }
      this.safePosition(this.collisionOrigin, this.candidate, query, terrain, this.solved)
      this.debug.candidates++
      const distance = this.solved.distanceTo(target)
      const sight = this.targetSightScore(this.solved, query, terrain)
      const framing = this.framingError(this.solved)
      const candidateScore = this.poseScore(sight, framing) + distance - (index === 0 ? 0 : index === 3 ? 1.1 : 0.55) +
        (index === this.shoulder && this.shoulderHold > 0 ? 1.2 : 0)
      if (candidateScore > score) {
        score = candidateScore; bestSight = sight; bestFraming = framing; chosen = index; this.best.copy(this.solved)
      }
      if (index === 0 && sight === this.debug.targetProbes && framing === 0 &&
          distance >= desired.distanceTo(target) - 0.15 && this.shoulderHold === 0) break
    }
    if (chosen !== this.shoulder) { this.shoulder = chosen; this.shoulderHold = 0.35 }
    const wanted = this.best.distanceTo(target)
    const current = this.follow.distanceTo(target)
    if (immediate || !previousSafe) {
      this.follow.copy(this.best)
      this.debug.visibilityCut = !immediate && previousClear && !previousVisible
      this.debug.framingCut = !immediate && previousClear && !previousFramed
      this.initialized = true
    } else {
      if (wanted < current - 0.12) this.releaseHold = 0.16
      const alpha = wanted < current ? 1 : this.releaseHold > 0 ? 0 : dampingAlpha(6, delta)
      this.follow.lerp(this.best, alpha)
      this.safePosition(this.collisionOrigin, this.follow, query, terrain, this.solved)
      this.follow.copy(this.solved)
      // A valid boom endpoint does not by itself validate camera travel between
      // frames. The old position is used only after checking its current volume.
      this.safePosition(this.previous, this.follow, query, terrain, this.solved)
      this.follow.copy(this.solved)
      const lostSight = this.targetSightScore(this.follow, query, terrain) < bestSight
      const lostFraming = this.framingError(this.follow) > bestFraming + 1e-6
      if (lostSight || lostFraming) {
        // Smooth camera travel must not strand the view behind a roof after a
        // valid target boom was found. Reacquire that collision-cleared pose.
        this.follow.copy(this.best)
        this.debug.visibilityCut = lostSight
        this.debug.framingCut = lostFraming
      }
    }
    output.copy(this.follow)
    this.lastSafe.copy(output)
    this.debug.shoulder = this.shoulder
    this.debug.boomDistance = output.distanceTo(target)
    this.debug.visibleTargetProbes = this.targetSightScore(output, query, terrain)
    this.updateFramingDebug(output)
    const visibility = THREE.MathUtils.smoothstep(this.debug.boomDistance, 0.8, 3.6)
    this.debug.playerVisibility = immediate ? visibility :
      THREE.MathUtils.lerp(this.debug.playerVisibility, visibility, dampingAlpha(16, delta))
  }

  constrain(
    target: THREE.Vector3, candidate: THREE.Vector3, query: CameraVolumeQuery,
    terrain: (x: number, z: number) => number, output: THREE.Vector3,
  ): void {
    this.framingTarget.copy(target)
    this.prepareTargetSight(target, query, terrain)
    this.previous.copy(this.lastSafe)
    const previousClear = this.initialized && this.previous.distanceTo(target) <= 32 &&
      this.clearPose(this.previous, query, terrain)
    const previousSafe = previousClear &&
      this.framingError(this.previous) === 0 &&
      this.targetSightScore(this.previous, query, terrain) === this.debug.targetProbes
    this.selectCollisionOrigin(target, candidate, previousSafe, query, terrain)
    this.safePosition(this.collisionOrigin, candidate, query, terrain, this.solved)
    if (previousSafe) this.safePosition(this.previous, this.solved, query, terrain, output)
    else output.copy(this.solved)
    const sight = this.targetSightScore(output, query, terrain)
    if (previousSafe && (this.targetSightScore(this.previous, query, terrain) > sight ||
        this.framingError(output) > 0)) output.copy(this.previous)
    this.lastSafe.copy(output)
    this.debug.boomDistance = output.distanceTo(target)
    this.debug.visibleTargetProbes = this.targetSightScore(output, query, terrain)
    this.updateFramingDebug(output)
    this.debug.playerVisibility = Math.min(this.debug.playerVisibility,
      THREE.MathUtils.smoothstep(this.debug.boomDistance, 0.8, 3.6))
  }

  private prepareFraming(
    target: THREE.Vector3, desired: THREE.Vector3, camera: THREE.PerspectiveCamera,
    yaw: number | undefined, pitch: number, roll: number,
  ): void {
    this.debug.framingActive = yaw !== undefined
    if (yaw === undefined) return
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || !Number.isFinite(roll)) throw new RangeError('Invalid camera view angles')
    this.framingTarget.copy(target)
    this.viewForward.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    this.viewRight.set(Math.cos(yaw), 0, Math.sin(yaw))
    this.viewUp.crossVectors(this.viewRight, this.viewForward)
    this.rollCos = Math.cos(roll); this.rollSin = Math.sin(roll)
    this.projectionX = camera.projectionMatrix.elements[0]
    this.projectionY = camera.projectionMatrix.elements[5]
    this.projectionOffsetX = camera.projectionMatrix.elements[8]
    this.projectionOffsetY = camera.projectionMatrix.elements[9]
    this.viewNear = camera.near; this.viewFar = camera.far
    this.frameMinY = -0.82; this.frameMaxY = 0.82
    // Looking deliberately above the horizon can place the player below the
    // frame even at the requested free orbit. Do not undo that view intent.
    for (let index = 0; index < CAMERA_TARGET_PROBES; index++) {
      this.projectTarget(desired, index)
      this.frameMinY = Math.min(this.frameMinY, this.projected.y)
      this.frameMaxY = Math.max(this.frameMaxY, this.projected.y)
    }
  }

  private projectTarget(position: THREE.Vector3, index: number): void {
    const x = this.framingTarget.x - position.x
    const y = this.framingTarget.y + (index === 1 ? -0.55 : index === 2 ? 0.55 : 0) - position.y
    const z = this.framingTarget.z - position.z
    const right = x * this.viewRight.x + y * this.viewRight.y + z * this.viewRight.z
    const up = x * this.viewUp.x + y * this.viewUp.y + z * this.viewUp.z
    const depth = x * this.viewForward.x + y * this.viewForward.y + z * this.viewForward.z
    const divisor = Math.abs(depth) > 1e-6 ? depth : depth < 0 ? -1e-6 : 1e-6
    this.projected.set(
      (right * this.rollCos + up * this.rollSin) * this.projectionX / divisor - this.projectionOffsetX,
      (up * this.rollCos - right * this.rollSin) * this.projectionY / divisor - this.projectionOffsetY,
      depth,
    )
  }

  private projectedError(): number {
    if (this.projected.z <= this.viewNear || this.projected.z >= this.viewFar) return 1000
    return Math.max(0, Math.abs(this.projected.x) - 0.6,
      this.frameMinY - this.projected.y, this.projected.y - this.frameMaxY)
  }

  private framingError(position: THREE.Vector3): number {
    if (!this.debug.framingActive) return 0
    let error = 0
    for (let index = 0; index < CAMERA_TARGET_PROBES; index++) {
      this.projectTarget(position, index)
      error = Math.max(error, this.projectedError())
    }
    return error
  }

  private poseScore(sight: number, framing: number): number {
    if (!this.debug.framingActive) return sight * 1000
    const jointlyUsable = sight === this.debug.targetProbes && framing === 0
    return sight * 10000 + (jointlyUsable ? 100000 : 0) - Math.min(framing, 100) * 10
  }

  private updateFramingDebug(position: THREE.Vector3): void {
    this.debug.framedTargetProbes = 0
    this.debug.framingError = this.framingError(position)
    if (!this.debug.framingActive) return
    for (let index = 0; index < CAMERA_TARGET_PROBES; index++) {
      this.projectTarget(position, index)
      if (this.projectedError() === 0) this.debug.framedTargetProbes++
      if (index === 1) {
        this.debug.torsoNdcX = this.projected.x; this.debug.torsoNdcY = this.projected.y
      } else if (index === 2) {
        this.debug.headNdcX = this.projected.x; this.debug.headNdcY = this.projected.y
      }
    }
  }

  private sweep(query: CameraVolumeQuery, from: THREE.Vector3, to: THREE.Vector3, radius = this.radius): void {
    query.sweep(from, to, radius, this.sweepResult)
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

  private clearPose(position: THREE.Vector3, query: CameraVolumeQuery, terrain: (x: number, z: number) => number): boolean {
    if (!this.clearsTerrain(terrain, position)) return false
    this.sweep(query, position, position)
    return !this.sweepResult.blocked && !this.sweepResult.overflow
  }

  private prepareTargetSight(target: THREE.Vector3, query: CameraVolumeQuery, terrain: (x: number, z: number) => number): void {
    this.debug.targetProbes = 0
    for (let index = 0; index < CAMERA_TARGET_PROBES; index++) {
      const point = this.sightTargets[index].copy(target)
      point.y += index === 1 ? -0.45 : index === 2 ? 0.35 : 0
      this.sweep(query, point, point, TARGET_SIGHT_RADIUS)
      // A physically embedded subject point is not a visible-through-walls
      // objective. Recover the camera volume without fabricating visibility.
      this.sightEligible[index] = Number(!this.sweepResult.blocked && !this.sweepResult.overflow &&
        point.y >= this.height(terrain, point.x, point.z) + TARGET_SIGHT_RADIUS)
      this.debug.targetProbes += this.sightEligible[index]
    }
  }

  private targetSightScore(position: THREE.Vector3, query: CameraVolumeQuery, terrain: (x: number, z: number) => number): number {
    let visible = 0
    for (let index = 0; index < CAMERA_TARGET_PROBES; index++) {
      if (!this.sightEligible[index]) continue
      const point = this.sightTargets[index]
      this.sweep(query, point, position, TARGET_SIGHT_RADIUS)
      if (this.sweepResult.blocked || this.sweepResult.overflow) continue
      const steps = Math.min(CAMERA_TERRAIN_STEPS, Math.max(1, Math.ceil(point.distanceTo(position) / 0.45)))
      let clear = true
      for (let step = 1; step < steps; step++) {
        this.sightSample.lerpVectors(point, position, step / steps)
        if (this.sightSample.y < this.height(terrain, this.sightSample.x, this.sightSample.z) + TARGET_SIGHT_RADIUS) {
          clear = false
          break
        }
      }
      if (clear) visible++
    }
    return visible
  }

  private selectCollisionOrigin(
    target: THREE.Vector3, wanted: THREE.Vector3, previousSafe: boolean, query: CameraVolumeQuery,
    terrain: (x: number, z: number) => number,
  ): void {
    this.debug.recovery = 'none'
    if (this.clearPose(target, query, terrain)) {
      this.collisionOrigin.copy(target)
      return
    }
    if (previousSafe) {
      this.collisionOrigin.copy(this.previous)
      this.debug.recovery = 'previous'
      return
    }
    // The look-at target is not a camera pose. Recover only the presentation
    // origin; never move an actor or accept a zero-distance overlapping sweep.
    this.sweep(query, target, target, 1e-4)
    const centerInside = this.sweepResult.initialOverlap && !this.sweepResult.overflow
    this.recoveryDirection.subVectors(wanted, target).normalize()
    for (let step = 0; step < CAMERA_RECOVERY_STEPS; step++) {
      const distance = (this.radius + 0.08) * 2 ** step
      for (let direction = 0; direction < CAMERA_RECOVERY_DIRECTIONS; direction++) {
        this.recoveryCandidate.copy(target)
        if (direction === 0) this.recoveryCandidate.addScaledVector(this.recoveryDirection, distance)
        else {
          const axis = Math.floor((direction - 1) / 2)
          this.recoveryCandidate.setComponent(axis,
            target.getComponent(axis) + (direction % 2 ? distance : -distance))
        }
        if (!this.clearPose(this.recoveryCandidate, query, terrain)) continue
        if (!centerInside) {
          // An overlapping sphere outside a wall may back away, but may not
          // jump through it merely because the other side is also unoccupied.
          this.sweep(query, target, this.recoveryCandidate, 1e-4)
          if (this.sweepResult.blocked || this.sweepResult.overflow) continue
        }
        this.collisionOrigin.copy(this.recoveryCandidate)
        this.debug.recovery = 'local'
        return
      }
    }
    throw new Error('Camera overlap recovery found no safe pose within its bounded search')
  }

  private safePosition(
    origin: THREE.Vector3, wanted: THREE.Vector3, query: CameraVolumeQuery,
    terrain: (x: number, z: number) => number, output: THREE.Vector3,
  ): void {
    output.copy(wanted)
    output.y = Math.max(output.y, this.height(terrain, output.x, output.z) + this.radius + 0.16)
    this.offset.subVectors(output, origin)
    const distance = this.offset.length()
    this.sweep(query, origin, output)
    if (this.sweepResult.initialOverlap) throw new Error('Camera sweep origin lost its validated clearance')
    if (this.sweepResult.blocked) output.copy(origin).addScaledVector(
      this.offset, Math.max(0, this.sweepResult.distance - 0.04) / Math.max(distance, 1e-6),
    )
    this.offset.subVectors(output, origin)
    const steps = Math.min(CAMERA_TERRAIN_STEPS, Math.max(1, Math.ceil(this.offset.length() / 0.45)))
    for (let step = 1; step <= steps; step++) {
      this.sample.copy(origin).addScaledVector(this.offset, step / steps)
      if (this.clearsTerrain(terrain, this.sample)) continue
      let lower = (step - 1) / steps
      let upper = step / steps
      for (let iteration = 0; iteration < 6; iteration++) {
        const middle = (lower + upper) * 0.5
        this.sample.copy(origin).addScaledVector(this.offset, middle)
        if (this.clearsTerrain(terrain, this.sample)) lower = middle
        else upper = middle
      }
      output.copy(origin).addScaledVector(this.offset, lower)
      break
    }
  }
}
