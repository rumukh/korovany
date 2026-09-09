import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  CAMERA_CANDIDATE_LIMIT,
  CAMERA_OCCLUDER_LIMIT,
  CAMERA_TRIANGLE_LIMIT,
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
  const result: CameraSweepResult = { distance: 0, blocked: false, overflow: false, triangleTests: 0 }
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

test('overlap at the start is detected both at a face and inside a closed solid', () => {
  const source = obstacle(0, 2, 0, 4, 4, 4)
  for (const from of [new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, 1.9)]) {
    const result = sweep(from, new THREE.Vector3(0, 2, 10), [source])
    assert.equal(result.distance, 0)
    assert.equal(result.blocked, true)
  }
  source.geometry.dispose()
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
