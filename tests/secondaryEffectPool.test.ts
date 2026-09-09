import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { SecondaryEffectPool, SECONDARY_EFFECT_CAPACITY } from '../src/game/SecondaryEffectPool.ts'
import { sumVisualAllocationReceipts } from '../src/game/diagnostics/VisualBudgetAccounting.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { resolveVisualSubsystemAllocation } from '../src/game/visualBudget.ts'
import { RandomStream } from '../src/game/random/RandomStream.ts'

const point = new THREE.Vector3(10, 3, -4)
const direction = new THREE.Vector3(1, 0, 0)
const color = new THREE.Color(0xffbb22)
const high = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'high' })

test('secondary contacts share one batch and hard capacity with priority admission and no fresh resources', () => {
  const scene = new THREE.Scene(), pool = new SecondaryEffectPool(scene, 42)
  const geometry = pool.mesh.geometry, material = pool.mesh.material
  const matrices = pool.mesh.instanceMatrix.array, colors = pool.mesh.instanceColor!.array
  assert.equal(pool.emit('shard', point, null, color, 48, high), 48)
  assert.equal(pool.emit('shard', point, null, color, 7, high), 0)
  assert.equal(pool.emit('spark', point, direction, color, 7, high), 7)
  assert.equal(pool.snapshot().replaced, 7)
  assert.equal(pool.snapshot().dropped, 7)
  assert.equal(pool.mesh.count, SECONDARY_EFFECT_CAPACITY)
  for (let burst = 0; burst < 100; burst++) {
    pool.emit('spark', point, direction, color, 7, high)
    pool.update(0.03, false)
    assert.ok(pool.mesh.count <= SECONDARY_EFFECT_CAPACITY)
  }
  assert.equal(scene.children.length, 1)
  assert.equal(pool.mesh.geometry, geometry)
  assert.equal(pool.mesh.material, material)
  assert.equal(pool.mesh.instanceMatrix.array, matrices)
  assert.equal(pool.mesh.instanceColor!.array, colors)
  assert.equal(material.depthTest, true)
  assert.equal(material.transparent, false)
  assert.equal(pool.mesh.castShadow, false)
  assert.equal(pool.mesh.userData.noComicOutline, true)
  pool.update(1, false)
  assert.equal(pool.mesh.count, 0)
  assert.equal(pool.mesh.visible, false)
  pool.emit('spark', point, direction, color, 1, high)
  assert.equal(pool.mesh.visible, true)
  pool.dispose()
  assert.equal(scene.children.length, 0)
})

test('actual fixed backing receipts are deduplicated and do not claim the shared pipeline allocation or GPU completion', () => {
  for (const quality of ['high', 'balanced', 'low'] as const) {
    const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: quality })
    const allocation = resolveVisualSubsystemAllocation(policy)!
    const pool = new SecondaryEffectPool(new THREE.Scene(), 42)
    pool.emit('spark', point, direction, color, 48, policy)
    const snapshot = pool.snapshot()
    const receipts = pool.getAllocationReceipts()
    const summed = sumVisualAllocationReceipts([...receipts, ...receipts])
    assert.deepEqual(summed.postAndEffects, snapshot.resources)
    assert.ok(snapshot.resources.cpuBackingBytes > 0)
    assert.ok(snapshot.resources.cpuBackingBytes < 32 * 1024)
    assert.ok(snapshot.resources.cpuBackingBytes < allocation.limits.postAndEffects.cpuBackingBytes)
    assert.ok(snapshot.sourceDrawCeiling < allocation.transientEffectDraws)
    assert.ok(snapshot.sourceTriangles < allocation.limits.postAndEffects.mainViewTriangles)
    assert.equal(snapshot.resources.gpuAllocatedBytes, null)
    assert.equal(snapshot.resourcesComplete, false)
    assert.equal(snapshot.cpuMs, null)
    assert.equal(snapshot.draws, null)
    assert.equal(summed.dynamicArt.cpuBackingBytes, 0)
    assert.equal(summed.world.cpuBackingBytes, 0)
    pool.dispose()
    assert.equal(pool.getAllocationReceipts().length, 0)
  }
})

test('density admission is real, effect-off clears held particles, and reduced motion suppresses rotation/travel', () => {
  const scene = new THREE.Scene()
  const full = new SecondaryEffectPool(scene, 42), reduced = new SecondaryEffectPool(scene, 42)
  const small = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'low' }, { reducedMotion: true })
  full.emit('spark', point, direction, color, 10, high)
  reduced.emit('spark', point, direction, color, 10, small)
  assert.equal(reduced.mesh.count, 4)
  full.update(0.1, false); reduced.update(0.1, true)
  const ordinary = new THREE.Matrix4(), quiet = new THREE.Matrix4()
  full.mesh.getMatrixAt(0, ordinary); reduced.mesh.getMatrixAt(0, quiet)
  const location = new THREE.Vector3().setFromMatrixPosition(ordinary)
  const quietLocation = new THREE.Vector3().setFromMatrixPosition(quiet)
  assert.ok(quietLocation.distanceTo(point) < location.distanceTo(point))
  assert.equal(quiet.elements[1], 0)
  assert.equal(quiet.elements[2], 0)
  const off = { ...high, density: { ...high.density, particles: 0 } }
  assert.equal(full.emit('shard', point, null, color, 1, off), 0)
  assert.equal(full.mesh.count, 0)
  full.dispose(); reduced.dispose()
})

test('art-only seeded effects copy inputs without consuming combat RNG or mutating contact vectors', () => {
  const first = new SecondaryEffectPool(new THREE.Scene(), 123)
  const second = new SecondaryEffectPool(new THREE.Scene(), 123)
  const combat = new RandomStream(123), before = combat.getState()
  const origin = point.clone(), incoming = direction.clone()
  for (const pool of [first, second]) {
    pool.emit('spark', point, direction, color, 7, high)
    pool.update(0.05, false)
  }
  assert.deepEqual(first.mesh.instanceMatrix.array, second.mesh.instanceMatrix.array)
  assert.deepEqual(first.mesh.instanceColor!.array, second.mesh.instanceColor!.array)
  assert.deepEqual(point, origin)
  assert.deepEqual(direction, incoming)
  assert.deepEqual(combat.getState(), before)
  first.dispose(); second.dispose()
})

test('exclusive pool resources dispose once, even on cleanup failure; no post-disposal emission', () => {
  const pool = new SecondaryEffectPool(new THREE.Scene(), 42)
  const disposals = { geometry: 0, material: 0, mesh: 0 }
  pool.mesh.geometry.addEventListener('dispose', () => { disposals.geometry++ })
  pool.mesh.material.addEventListener('dispose', () => { disposals.material++; throw new Error('deliberate release failure') })
  pool.mesh.addEventListener('dispose', () => { disposals.mesh++ })
  assert.throws(() => pool.dispose(), AggregateError)
  pool.dispose()
  assert.deepEqual(disposals, { geometry: 1, material: 1, mesh: 1 })
  assert.equal(pool.mesh.parent, null)
  assert.equal(pool.getAllocationReceipts().length, 0)
  assert.throws(() => pool.emit('spark', point, direction, color, 1, high), /disposed/)
  assert.throws(() => pool.update(0.1, false), /disposed/)
})
