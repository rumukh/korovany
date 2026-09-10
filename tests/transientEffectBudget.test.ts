import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import * as THREE from 'three'
import { TransientEffectBudget, transientSourceCost, transientAllocationReceipts, type TransientSource } from '../src/game/TransientEffectBudget.ts'
import { sumVisualAllocationReceipts } from '../src/game/diagnostics/VisualBudgetAccounting.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { SecondaryEffectPool } from '../src/game/SecondaryEffectPool.ts'
const loader = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
} })
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

test('costs use actual draw ranges, groups, instances, transparent sides and shadow submissions', () => {
  const geometry = new THREE.BoxGeometry()
  const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
  const mesh = new THREE.InstancedMesh(geometry, material, 5)
  mesh.count = 3
  mesh.castShadow = true
  assert.deepEqual(transientSourceCost(mesh), { calls: 3, triangles: 72 })
  mesh.count = 0
  assert.deepEqual(transientSourceCost(mesh), { calls: 0, triangles: 0 })
  mesh.count = 3
  geometry.setDrawRange(0, 6)
  assert.deepEqual(transientSourceCost(mesh), { calls: 3, triangles: 12 })
  const grouped = new THREE.Mesh(geometry, [material, material, material, material, material, material])
  geometry.setDrawRange(0, Infinity)
  assert.deepEqual(transientSourceCost(grouped), { calls: 12, triangles: 24 })
  material.opacity = 0
  assert.deepEqual(transientSourceCost(grouped), { calls: 0, triangles: 0 })
  geometry.dispose(); material.dispose(); mesh.dispose()
})

function engineFixture(quality: 'high' | 'balanced' | 'low', bloomEnabled = true) {
  const geometry = new THREE.OctahedronGeometry(0.1)
  const material = new THREE.MeshBasicMaterial()
  const spriteMaterial = new THREE.SpriteMaterial()
  const meshes = (count: number) => Array.from({ length: count }, () => new THREE.Mesh(geometry, material))
  const sprites = (count: number) => Array.from({ length: count }, () => new THREE.Sprite(spriteMaterial))
  const scene = new THREE.Scene()
  const pool = new SecondaryEffectPool(scene, 42)
  const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: quality, bloomEnabled })
  pool.emit('spark', new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Color(), 48, policy)
  const tellMeshes = meshes(4), projectiles = meshes(3)
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    visualPolicy: policy, transientBudget: new TransientEffectBudget(), secondaryEffects: pool,
    telegraphPool: tellMeshes.map((mesh) => ({ mesh })), finaleTelegraphs: meshes(1),
    projectiles: projectiles.map((mesh) => ({ mesh })), lootPickups: [], lootCollectionBursts: [],
    weaponTrail: meshes(1)[0], rain: new THREE.LineSegments(geometry, material), snow: new THREE.Points(geometry, material),
    impactRayFx: sprites(16).map((sprite) => ({ sprite, active: true, priority: 1 })),
    damageNumberFx: sprites(24).map((sprite) => ({ sprite, active: true, priority: 1 })),
    comicCalloutFx: sprites(10).map((sprite) => ({ sprite, active: true, priority: 1 })),
    particles: meshes(180).map((mesh) => ({ mesh, mode: 'blood' })),
    inactiveGoreParticles: [],
    decals: meshes(72).map((mesh) => ({ mesh, active: true })),
  })
  return { engine, tellMeshes, projectiles, pool, dispose() {
    pool.dispose(); geometry.dispose(); material.dispose(); spriteMaterial.dispose()
  } }
}

test('real engine collection reconciles every owned transient category under H44/B24/L20 without borrowing post capacity', () => {
  for (const [quality, limit] of [['high', 44], ['balanced', 24], ['low', 20]] as const) {
    for (const bloomEnabled of [false, true]) {
      const f = engineFixture(quality, bloomEnabled), budget = f.engine.transientBudget as TransientEffectBudget
      try {
        const health = 100
        f.engine.prepareTransientEffects()
        budget.apply()
        const snapshot = budget.snapshot()
        assert.equal(snapshot.drawLimit, limit)
        assert.equal(snapshot.admittedDrawUpperBound, limit)
        assert.ok(snapshot.requestedDrawUpperBound > 300)
        assert.ok(snapshot.omittedDrawUpperBound > 0)
        assert.equal(snapshot.protectedDrawUpperBound, 8)
        assert.equal(snapshot.overBudget, false)
        assert.equal(snapshot.complete, false)
        assert.equal(snapshot.measuredDraws, null)
        assert.equal(snapshot.cpuMs, null)
        for (const mesh of [...f.tellMeshes, ...f.projectiles]) assert.equal(mesh.visible, true)
        assert.equal(f.pool.mesh.visible, true)
        assert.equal(f.engine.particles.length, 180)
        assert.equal(health, 100)
        const actualSources = f.engine.getTransientEffectInventory().sources as TransientSource[]
        const enabledCost = actualSources.filter((source) => source.visible).reduce((total, source) => total + transientSourceCost(source).calls, 0)
        assert.equal(enabledCost, limit)
        budget.restore()
        for (const source of actualSources) assert.equal(source.visible, true)
        const receipts = f.engine.getTransientEffectInventory().receipts
        const totals = sumVisualAllocationReceipts(receipts)
        assert.equal(totals.dynamicArt.cpuBackingBytes, 0)
        assert.equal(totals.world.cpuBackingBytes, 0)
        assert.equal(totals.postAndEffects.gpuAllocatedBytes, null)
      } finally { budget.restore(); f.dispose() }
    }
  }
})

test('over-budget defensive tells are not hidden, and visibility restores after an explicit render failure', () => {
  const geometry = new THREE.PlaneGeometry(), material = new THREE.MeshBasicMaterial()
  const budget = new TransientEffectBudget(), sources = Array.from({ length: 30 }, () => new THREE.Mesh(geometry, material))
  budget.begin(resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'low' }))
  for (const source of sources) budget.add(source, 'tell', 200, true)
  const cosmetic = new THREE.Mesh(geometry, material)
  budget.add(cosmetic, 'decal', 0)
  assert.throws(() => {
    budget.apply()
    try {
      assert.equal(budget.snapshot().overBudget, true)
      assert.equal(budget.snapshot().protectedDrawUpperBound, 30)
      assert.equal(cosmetic.visible, false)
      for (const source of sources) assert.equal(source.visible, true)
      throw new Error('render failed')
    } finally { budget.restore() }
  }, /render failed/)
  assert.equal(cosmetic.visible, true)
  budget.begin(resolveVisualPolicy({ visualMode: 'enhanced' }))
  budget.add(cosmetic, 'decal', 0)
  budget.apply()
  assert.throws(() => budget.begin(resolveVisualPolicy({})), /restored/)
  assert.throws(() => budget.add(cosmetic, 'decal', 0), /outside/)
  budget.restore()
  geometry.dispose(); material.dispose()
})

test('hidden roots, inactive pooled slots and shared backing are not invented as new work or duplicate resources', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial()
  const source = new THREE.Mesh(geometry, material), hidden = new THREE.Group()
  hidden.visible = false
  hidden.add(source)
  const sibling = new THREE.Mesh(geometry, material)
  const budget = new TransientEffectBudget()
  budget.begin(resolveVisualPolicy({ visualMode: 'enhanced' }))
  budget.add(source, 'decal', 1)
  budget.add(sibling, 'gore', 1)
  budget.add(sibling, 'gore', 1)
  budget.apply()
  assert.equal(budget.snapshot().requestedDrawUpperBound, 1)
  budget.restore()
  assert.equal(source.visible, true)
  assert.equal(hidden.visible, false)
  assert.deepEqual(sumVisualAllocationReceipts(transientAllocationReceipts([source, sibling])),
    sumVisualAllocationReceipts(transientAllocationReceipts([source])))
  geometry.dispose(); material.dispose()
})
