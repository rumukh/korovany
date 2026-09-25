import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  CAMERA_CANDIDATE_LIMIT,
  CAMERA_OCCLUDER_LIMIT,
  CAMERA_RECOVERY_DIRECTIONS,
  CAMERA_RECOVERY_STEPS,
  CAMERA_TRIANGLE_LIMIT,
  CameraRecoveryError,
  CameraVisibility,
  sweepCameraSphere,
  type CameraSweepResult,
  type CameraTriangleSource,
  type CameraVolumeQuery,
} from '../src/game/cameraVisibility.ts'

function obstacle(x: number, y: number, z: number, width = 1, height = 4, depth = 1): CameraTriangleSource {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  geometry.computeBoundingBox()
  const matrix = new THREE.Matrix4().makeTranslation(x, y, z)
  return { geometry, matrix, bounds: geometry.boundingBox!.clone().applyMatrix4(matrix) }
}

function sweep(from: THREE.Vector3, to: THREE.Vector3, sources: readonly CameraTriangleSource[], radius = 0.35) {
  const result: CameraSweepResult = { distance: 0, blocked: false, overflow: false, triangleTests: 0, initialOverlap: false }
  sweepCameraSphere(from, to, radius, sources, result)
  return result
}

function query(sources: readonly CameraTriangleSource[]): CameraVolumeQuery {
  return { sweep: (from, to, radius, result) => sweepCameraSphere(from, to, radius, sources, result) }
}

test('the swept camera stops at the near surface minus its radius, never beyond a minimum boom', () => {
  const source = obstacle(0, 2, 2, 8, 8, 1)
  const result = sweep(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, 10), [source])
  assert.ok(Math.abs(result.distance - 1.15) < 1e-6)
  assert.equal(result.blocked, true)
  assert.equal(result.overflow, false)
  assert.equal(result.triangleTests, 12)
  source.geometry.dispose()
})

test('a camera sphere catches an edge and a thin post missed by the center ray', () => {
  for (const x of [0.26, 0.31]) {
    const source = obstacle(x, 2, 4, 0.06, 2, 0.06)
    const from = new THREE.Vector3(0, 2, 0), to = new THREE.Vector3(0, 2, 10)
    const centerRay = new THREE.Ray(from, new THREE.Vector3(0, 0, 1))
    assert.equal(centerRay.intersectsBox(source.bounds), false)
    const result = sweep(from, to, [source])
    assert.equal(result.blocked, true)
    assert.ok(result.distance > 3.5 && result.distance < 4)
    source.geometry.dispose()
  }
})

test('geometry entirely behind or beside the sweep does not clamp its length', () => {
  const sources = [obstacle(0, 2, -5), obstacle(4, 2, 5)]
  const result = sweep(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, 10), sources)
  assert.equal(result.distance, 10)
  assert.equal(result.blocked, false)
  for (const source of sources) source.geometry.dispose()
})

test('a back-facing surface ahead blocks travel without classifying the starting center as inside', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -2, -2, 3, 2, -2, 3, 0, 2, 3,
  ], 3))
  geometry.computeBoundingBox()
  const source = { geometry, matrix: new THREE.Matrix4(), bounds: geometry.boundingBox! }
  try {
    const result = sweep(new THREE.Vector3(), new THREE.Vector3(0, 0, 6), [source])
    assert.equal(result.initialOverlap, false)
    assert.equal(result.blocked, true)
    assert.ok(Math.abs(result.distance - 2.65) < 1e-6)
  } finally { geometry.dispose() }
})

test('overlap at the start is detected both at a face and inside a closed solid', () => {
  const source = obstacle(0, 2, 0, 4, 4, 4)
  for (const from of [new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, 1.9)]) {
    const result = sweep(from, new THREE.Vector3(0, 2, 10), [source])
    assert.equal(result.distance, 0)
    assert.equal(result.blocked, true)
    assert.equal(result.initialOverlap, true)
    const stationary = sweep(from, from, [source])
    assert.equal(stationary.blocked, true, 'A stationary pose inside a solid is not validated clearance')
    assert.equal(stationary.initialOverlap, true)
  }
  source.geometry.dispose()
})

test('an overlapping look target retains a validated camera while moving away from or toward a wall', () => {
  const wall = obstacle(0, 2, 0.4, 20, 20, 0.2)
  const terrain = () => 0
  for (const desiredZ of [-10, 10]) {
    const solver = new CameraVisibility()
    const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 100)
    const output = new THREE.Vector3()
    solver.resolve(new THREE.Vector3(0, 1.65, -1), new THREE.Vector3(0, 7, -11),
      camera, 0, true, query([wall]), terrain, output)
    assert.deepEqual(output.toArray(), [0, 7, -11])
    for (const z of [0, 0.01, -0.01, 0, -0.4, -1]) {
      const target = new THREE.Vector3(0, 1.65, z)
      const targetBefore = target.clone()
      const previous = output.clone()
      solver.resolve(target, new THREE.Vector3(0, 7, desiredZ), camera, 1 / 60, false,
        query([wall]), terrain, output)
      if (Math.abs(z) < 0.02) assert.ok(output.distanceTo(target) > 1, 'A look-target overlap must not collapse a safe camera to zero boom')
      assert.equal(sweep(output, output, [wall], 0.32).blocked, false)
      assert.equal(sweep(previous, output, [wall], 0.32).blocked, false, 'Actual follow travel must retain clearance')
      assert.ok(wall.bounds.distanceToPoint(output) >= 0.32)
      assert.deepEqual(target, targetBefore)
      if (Math.abs(z) < 0.02) assert.equal(solver.debug.recovery, 'previous')
      solver.constrain(target, output.clone().add(new THREE.Vector3(0.1, -0.1, 0.2)),
        query([wall]), terrain, output)
      assert.equal(sweep(output, output, [wall], 0.32).blocked, false, 'Shake must use the same validated-origin policy')
      if (Math.abs(z) < 0.02) assert.ok(output.distanceTo(target) > 1)
    }
  }
  wall.geometry.dispose()
})

test('overlap recovery rejects an unsafe previous camera and finds a bounded local origin', () => {
  const wall = obstacle(0, 2, 0.4, 20, 20, 0.2)
  const trap = obstacle(0, 7, -11, 3, 3, 3)
  const solver = new CameraVisibility()
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 100)
  const output = new THREE.Vector3()
  solver.resolve(new THREE.Vector3(0, 1.65, -1), new THREE.Vector3(0, 7, -11),
    camera, 0, true, query([wall]), () => 0, output)
  assert.equal(sweep(output, output, [trap], 0.32).initialOverlap, true)
  const target = new THREE.Vector3(0, 1.65, 0)
  solver.resolve(target, new THREE.Vector3(0, 7, -10), camera, 1 / 60, false,
    query([wall, trap]), () => 0, output)
  assert.equal(solver.debug.recovery, 'local')
  assert.ok(output.distanceTo(target) > 0)
  assert.equal(sweep(output, output, [wall, trap], 0.32).blocked, false)
  assert.ok(output.y >= 0.32)
  solver.constrain(target, new THREE.Vector3(0, 7, -11), query([wall, trap]), () => 0, output)
  assert.equal(sweep(output, output, [wall, trap], 0.32).blocked, false)
  wall.geometry.dispose(); trap.geometry.dispose()
})

test('without a previous camera, a bounded free origin is found without crossing a wall outside the target', () => {
  const wall = obstacle(0, 2, 0.4, 20, 20, 0.2)
  for (const targetZ of [0, 0.4]) {
    for (const desiredZ of [-10, 10]) {
      const solver = new CameraVisibility()
      const target = new THREE.Vector3(0, 1.65, targetZ)
      const output = new THREE.Vector3()
      const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 100)
      solver.resolve(target, new THREE.Vector3(0, 7, desiredZ), camera, 0, true, query([wall]), () => 0, output)
      assert.equal(solver.debug.recovery, 'local')
      assert.equal(sweep(output, output, [wall], 0.32).blocked, false)
      assert.ok(output.distanceTo(target) > 0)
      if (targetZ === 0) assert.ok(output.z < 0.3 - 0.32, 'An external target must recover on its original side of the wall')
      assert.ok(solver.debug.sweeps <= CAMERA_RECOVERY_DIRECTIONS * CAMERA_RECOVERY_STEPS * 2 + CAMERA_CANDIDATE_LIMIT + 3)
    }
  }
  const enclosure = obstacle(0, 0, 0, 100, 100, 100)
  const output = new THREE.Vector3(9, 8, 7)
  const solver = new CameraVisibility()
  assert.throws(() => solver.resolve(new THREE.Vector3(0, 1.65, 0), new THREE.Vector3(0, 7, -10),
    new THREE.PerspectiveCamera(56, 1, 0.1, 100), 0, true, query([enclosure]), () => 0, output),
  (error) => error instanceof CameraRecoveryError && /no safe pose/.test(error.message))
  assert.deepEqual(output.toArray(), [9, 8, 7], 'Exhausted recovery must report failure, not publish an overlapping camera')
  assert.equal(solver.debug.recovery, 'failed')
  wall.geometry.dispose(); enclosure.geometry.dispose()
})

/** Two closed boxes in one buffer, like a building body merged with its eave. */
function compound(...boxes: readonly (readonly [number, number, number, number, number, number])[]): CameraTriangleSource {
  const parts = boxes.map(([x, y, z, width, height, depth]) => {
    const part = new THREE.BoxGeometry(width, height, depth).toNonIndexed()
    part.translate(x, y, z)
    return part
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    parts.flatMap((part) => [...part.getAttribute('position').array]), 3))
  geometry.computeBoundingBox()
  for (const part of parts) part.dispose()
  return { geometry, matrix: new THREE.Matrix4(), bounds: geometry.boundingBox! }
}

test('a head embedded in compound eave geometry recovers beside the visible torso instead of throwing', () => {
  // The target sits inside the eave slab, but the containment ray first enters
  // the overlapping post above it, so the target is not classified as inside.
  // Every path out crosses the slab, which is what froze the palace-guard run.
  const eave = compound([0, 1.7, 0, 4, 0.3, 4], [0, 2.05, 0, 0.6, 0.7, 0.6])
  const target = new THREE.Vector3(0, 1.65, 0)
  const occupancy = sweep(target, target, [eave], 1e-4)
  assert.equal(occupancy.initialOverlap, false, 'Negative control: compound parity reports the center outside')
  assert.equal(sweep(target, target, [eave], 0.32).initialOverlap, true)
  for (const desired of [new THREE.Vector3(0, 6.65, -10), new THREE.Vector3(10, 6.65, 0)]) {
    const solver = new CameraVisibility()
    const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 100)
    const output = new THREE.Vector3()
    solver.resolve(target, desired, camera, 0, true, query([eave]), () => 0, output)
    assert.equal(solver.debug.recovery, 'embedded')
    assert.equal(sweep(output, output, [eave], 0.32).blocked, false)
    assert.ok(!(Math.abs(output.x) < 2.32 && Math.abs(output.z) < 2.32 && output.y > 1.85),
      `The camera must not cross to the upper side of the eave: ${output.toArray()}`)
    assert.ok(solver.debug.visibleTargetProbes > 0, 'The recovered camera must still see the unembedded torso')
    solver.constrain(target, output.clone().add(new THREE.Vector3(0.1, -0.05, 0.1)), query([eave]), () => 0, output)
    assert.equal(sweep(output, output, [eave], 0.32).blocked, false)
  }
  eave.geometry.dispose()
})

test('a clear previous camera is kept when no local volume can be recovered around an embedded target', () => {
  // A thick ceiling holds the head; a floor leaves only a thin gap at torso height.
  const ceiling = obstacle(0, 21.4, 0, 40, 40, 40)
  const floor = obstacle(0, -19, 0, 40, 40, 40)
  const target = new THREE.Vector3(0, 1.65, 0)
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 100)
  const terrain = () => -60
  const solver = new CameraVisibility()
  const output = new THREE.Vector3()
  solver.resolve(target, new THREE.Vector3(0, 1.65, -24), camera, 0, true, query([]), terrain, output)
  const previous = output.clone()
  assert.deepEqual(previous.toArray(), [0, 1.65, -24])
  solver.resolve(target, new THREE.Vector3(0, 1.65, -24), camera, 1 / 60, false, query([ceiling, floor]), terrain, output)
  assert.equal(solver.debug.recovery, 'previous')
  assert.equal(solver.debug.targetProbes, 1, 'Only the torso probe in the gap is eligible')
  assert.equal(sweep(output, output, [ceiling, floor], 0.32).blocked, false)
  assert.equal(sweep(previous, output, [ceiling, floor], 0.32).blocked, false, 'Recovery must validate travel from the kept camera')
  const fresh = new CameraVisibility()
  const untouched = new THREE.Vector3(1, 2, 3)
  assert.throws(() => fresh.resolve(target, new THREE.Vector3(0, 1.65, -24), camera, 0, true,
    query([ceiling, floor]), terrain, untouched), CameraRecoveryError)
  assert.deepEqual(untouched.toArray(), [1, 2, 3])
  ceiling.geometry.dispose(); floor.geometry.dispose()
})

test('merged courtyard bounds are only a broad phase, not a solid wall', () => {
  const left = new THREE.BoxGeometry(1, 4, 1).toNonIndexed()
  left.translate(-3, 2, 5)
  const right = new THREE.BoxGeometry(1, 4, 1).toNonIndexed()
  right.translate(3, 2, 5)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    ...left.getAttribute('position').array, ...right.getAttribute('position').array,
  ], 3))
  geometry.computeBoundingBox()
  const source = { geometry, matrix: new THREE.Matrix4(), bounds: geometry.boundingBox! }
  assert.equal(source.bounds.containsPoint(new THREE.Vector3(0, 2, 5)), true)
  const result = sweep(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, 10), [source])
  assert.equal(result.blocked, false)
  left.dispose(); right.dispose(); geometry.dispose()
})

test('camera query and triangle overflow is conservative and observable', () => {
  const source = obstacle(3, 2, 4)
  const broad = new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10))
  const sources = Array.from({ length: CAMERA_OCCLUDER_LIMIT + 1 }, () => ({ ...source, bounds: broad }))
  const result = sweep(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, 8), sources)
  assert.equal(result.overflow, true)
  assert.equal(result.distance, 0)
  const geometry = new THREE.BufferGeometry()
  const values = new Float32Array((CAMERA_TRIANGLE_LIMIT + 1) * 9)
  for (let offset = 0; offset < values.length; offset += 9) values.set([3, 0, 3, 3, 1, 3, 3, 0, 4], offset)
  geometry.setAttribute('position', new THREE.BufferAttribute(values, 3))
  const budget = sweep(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, 8), [
    { geometry, matrix: new THREE.Matrix4(), bounds: broad },
  ])
  assert.equal(budget.overflow, true)
  assert.equal(budget.triangleTests, CAMERA_TRIANGLE_LIMIT + 1)
  source.geometry.dispose(); geometry.dispose()
})

test('the production camera selects an alternate framing without changing its target', () => {
  const source = obstacle(0, 4, 5, 2, 4, 1)
  const target = new THREE.Vector3(0, 1.65, 0)
  const desired = new THREE.Vector3(0, 8, 10)
  const originalTarget = target.clone(), originalDesired = desired.clone()
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 200)
  const solver = new CameraVisibility()
  const out = new THREE.Vector3()
  solver.resolve(target, desired, camera, 0, true, query([source]), () => 0, out)
  assert.ok(out.distanceTo(target) > 7, `alternate boom ${out.toArray()}`)
  assert.notEqual(solver.debug.shoulder, 0)
  assert.ok(solver.debug.candidates <= CAMERA_CANDIDATE_LIMIT)
  assert.deepEqual(target, originalTarget)
  assert.deepEqual(desired, originalDesired)
  assert.equal(sweep(target, out, [source]).blocked, false)
  source.geometry.dispose()
})

test('terrain clearance applies to the final follow and shake positions on a slope', () => {
  const solver = new CameraVisibility()
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 200)
  const target = new THREE.Vector3(0, 1.65, 0), desired = new THREE.Vector3(0, 3, 10)
  const terrain = (_x: number, z: number) => Math.max(0, z * 0.8)
  const out = new THREE.Vector3()
  solver.resolve(target, desired, camera, 0, true, query([]), terrain, out)
  assert.ok(out.y > terrain(out.x, out.z) + 0.3)
  for (let frame = 0; frame < 60; frame++) {
    desired.x = Math.sin(frame * 0.2) * 3
    solver.resolve(target, desired, camera, 1 / 60, false, query([]), terrain, out)
    assert.ok(out.y > terrain(out.x, out.z) + 0.3)
    const shaken = out.clone().add(new THREE.Vector3(0.1, -2, 0.1))
    solver.constrain(target, shaken, query([]), terrain, out)
    assert.ok(out.y >= terrain(out.x, out.z) + 0.3)
    assert.ok(solver.debug.terrainSamples < 4000)
  }
})

test('release damping converges across frame rates without hunting or invalid positions', () => {
  const settle = (fps: number) => {
    const solver = new CameraVisibility()
    const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 200)
    const target = new THREE.Vector3(0, 1.65, 0)
    const out = new THREE.Vector3()
    solver.resolve(target, new THREE.Vector3(0, 3, 2), camera, 0, true, query([]), () => 0, out)
    const desired = new THREE.Vector3(0, 8, 10)
    for (let frame = 0; frame < fps * 2; frame++) solver.resolve(target, desired, camera, 1 / fps, false, query([]), () => 0, out)
    return out
  }
  assert.ok(settle(30).distanceTo(settle(120)) < 0.002)
})

test('looking down over an open hill returns to the nominal view without repeated elevation jumps', () => {
  const terrain = (x: number, z: number) =>
    5 * Math.exp(-(((z - 5) / 1.3) ** 2)) * Math.exp(-((x / 6) ** 2))
  for (const fps of [30, 60, 120]) {
    const solver = new CameraVisibility()
    const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 240)
    const target = new THREE.Vector3(0, terrain(0, 0) + 1.65, 0)
    const desired = new THREE.Vector3(), output = new THREE.Vector3()
    const step = (pitch: number, immediate = false) => {
      desired.copy(target).add(new THREE.Vector3(0, 12 * Math.sin(pitch), 12 * Math.cos(pitch)))
      solver.resolve(target, desired, camera, immediate ? 0 : 1 / fps, immediate,
        query([]), terrain, output, 0, pitch)
    }
    step(0.38, true)
    const initialShoulder = solver.debug.shoulder
    assert.equal(initialShoulder, 3, 'The ridge initially needs an elevated camera')
    let previousShoulder = solver.debug.shoulder, switches = 0, returning = false, largestReturnStep = 0
    const previous = output.clone()
    for (let frame = 0; frame < fps * 4; frame++) {
      step(0.95)
      if (solver.debug.shoulder !== previousShoulder) switches++
      if (solver.debug.shoulder === 0) returning = true
      if (returning) largestReturnStep = Math.max(largestReturnStep, output.distanceTo(previous))
      previous.copy(output)
      previousShoulder = solver.debug.shoulder
      assert.equal(solver.debug.visibleTargetProbes, solver.debug.targetProbes)
      assert.equal(solver.debug.framingError, 0)
      if (frame > fps * 2) assert.equal(solver.debug.shoulder, 0, 'A clear nominal view must not lose to extra height')
    }
    assert.equal(switches, 1, `${fps}fps must settle rather than alternate on every hold timeout`)
    assert.ok(largestReturnStep < 40 / fps, `Unobstructed return snapped ${largestReturnStep}m at ${fps}fps`)
    assert.ok(output.distanceTo(desired) < 0.002)
  }
})

test('a collision on the final shake path updates close-player fade as well as camera clearance', () => {
  const solver = new CameraVisibility()
  const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 200)
  const target = new THREE.Vector3(0, 2, 0), out = new THREE.Vector3()
  solver.resolve(target, new THREE.Vector3(4, 2, 0), camera, 0, true, query([]), () => 0, out)
  assert.equal(solver.debug.playerVisibility, 1)
  const wall = obstacle(0, 2, 2.5, 4, 8, 1)
  solver.constrain(target, new THREE.Vector3(0.1, 2, 10), query([wall]), () => 0, out)
  assert.ok(out.distanceTo(target) < 2)
  assert.ok(solver.debug.playerVisibility < 0.5)
  assert.equal(solver.debug.boomDistance, out.distanceTo(target))
  wall.geometry.dispose()
})
