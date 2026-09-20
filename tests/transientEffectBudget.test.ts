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
  assert.deepEqual(transientSourceCost(grouped), { calls: 12, triangles: 24 })
  assert.deepEqual(transientSourceCost(mesh), { calls: 3, triangles: 72 })
  const spriteMaterial = new THREE.SpriteMaterial({ opacity: 0 })
  const sprite = new THREE.Sprite(spriteMaterial)
  assert.deepEqual(transientSourceCost(sprite), { calls: 1, triangles: 2 })
  spriteMaterial.visible = false
  assert.deepEqual(transientSourceCost(sprite), { calls: 0, triangles: 0 })
  material.visible = false
  assert.deepEqual(transientSourceCost(grouped), { calls: 0, triangles: 0 })
  geometry.dispose(); material.dispose(); spriteMaterial.dispose(); mesh.dispose()
})

test('shared loot opacity from a previous draw cannot hide a real double-sided submission from admission', () => {
  const geometry = new THREE.PlaneGeometry()
  const ordinaryMaterial = new THREE.MeshBasicMaterial()
  const sharedMaterial = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, opacity: 0 })
  const scene = new THREE.Scene(), camera = new THREE.Camera()
  const engine = Object.create(GameEngine.prototype)
  const previousPickup = new THREE.Mesh(geometry, sharedMaterial)
  const beam = new THREE.Mesh(geometry, sharedMaterial)
  engine.bindLootOpacity(previousPickup)
  engine.bindLootOpacity(beam)
  previousPickup.userData.lootOpacity = 0
  beam.userData.lootOpacity = 0.32
  const beforeRender = (mesh: THREE.Mesh) =>
    Reflect.apply(mesh.onBeforeRender, mesh, [null, scene, camera, geometry, sharedMaterial, null])
  const sources = Array.from({ length: 20 }, () => new THREE.Mesh(geometry, ordinaryMaterial))
  const budget = new TransientEffectBudget()
  try {
    for (const protectedBeam of [true, false]) {
      beforeRender(previousPickup)
      assert.equal(sharedMaterial.opacity, 0)
      budget.begin(resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'low' }))
      for (const source of sources) budget.add(source, 'tell', 200, true)
      budget.add(beam, 'loot', 150, protectedBeam)
      budget.apply()
      assert.equal(budget.snapshot().requestedDrawUpperBound, 22)
      assert.equal(budget.snapshot().admittedDrawUpperBound, protectedBeam ? 22 : 20)
      assert.equal(budget.snapshot().protectedDrawUpperBound, protectedBeam ? 22 : 20)
      assert.equal(budget.snapshot().omittedDrawUpperBound, protectedBeam ? 0 : 2)
      assert.equal(budget.snapshot().overBudget, protectedBeam)
      assert.equal(beam.visible, protectedBeam)
      assert.ok(sources.every((source) => source.visible), 'protected tell semantics must remain unchanged')
      if (beam.visible) {
        beforeRender(beam)
        assert.equal(sharedMaterial.opacity, 0.32, 'the real production callback changes opacity at draw time')
        assert.deepEqual(transientSourceCost(beam), { calls: 2, triangles: 4 })
      }
      budget.restore()
      assert.equal(beam.visible, true)
    }
  } finally {
    budget.clear()
    geometry.dispose(); ordinaryMaterial.dispose(); sharedMaterial.dispose()
  }
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
    atmosphereRoot: new THREE.Group(), flames: [], camera: new THREE.PerspectiveCamera(),
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

test('production sky and zero-opacity stars reserve two draws before crowded transients without budgeting off-view clouds', () => {
  const f = engineFixture('high')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const context = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '', globalAlpha: 1 }
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
  })
  const scene = new THREE.Scene()
  const budget = f.engine.transientBudget as TransientEffectBudget
  const camera = new THREE.PerspectiveCamera(56, 1920 / 1080, 0.1, 240)
  camera.position.set(0, 8, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  Object.assign(f.engine, {
    scene, player: new THREE.Group(), camera,
    palette: { worldSky: new THREE.Color(0xa0b8c8), bg: new THREE.Color(0x303030),
      worldHorizon: new THREE.Color(0xb0c0c8), worldSun: new THREE.Color(0xffdfaf), worldFog: new THREE.Color(0xa0b0c0) },
    dayNightKeyframes: { day: { skyTint: new THREE.Color(1, 1, 1) } },
    generatedTextures: new Map(), cloudBaseColor: new THREE.Color(), clouds: [],
  })
  try {
    f.engine.createAtmosphere()
    // The day/night update places the moon opposite the sun before any production frame.
    f.engine.moonDisc.position.copy(f.engine.sunDisc.position).multiplyScalar(-1)
    assert.equal(f.engine.stars.material.opacity, 0)
    assert.equal(f.engine.stars.frustumCulled, false)
    const sky = f.engine.atmosphereRoot.getObjectByName('atmosphere-sky')
    assert.ok(sky instanceof THREE.Mesh)
    assert.equal(transientSourceCost(sky).triangles, 1088)
    f.engine.prepareTransientEffects()
    budget.apply()
    assert.equal(budget.snapshot().reservedEnvironmentDrawUpperBound, 2)
    assert.equal(budget.snapshot().admittedDrawUpperBound, 44)
    assert.equal(budget.snapshot().protectedDrawUpperBound, 10)
    assert.equal(budget.snapshot().overBudget, false)
    assert.equal(sky.visible, true)
    assert.equal(f.engine.stars.visible, true)
    assert.equal(f.pool.mesh.visible, true)
    const environmentSources: THREE.Object3D[] = []
    f.engine.atmosphereRoot.traverse((source: THREE.Object3D) => environmentSources.push(source))
    assert.equal(environmentSources.filter((source) => source.userData.transientCategory === 'environment').length, 2)
    assert.ok(f.engine.clouds.every(({ group }: { group: THREE.Group }) =>
      group.children.every((cloud) => cloud.visible)), 'off-view clouds are not hidden just to fit an invented reserve')
    budget.restore()
    const inventory = f.engine.getTransientEffectInventory()
    assert.ok(inventory.sources.includes(sky) && inventory.sources.includes(f.engine.stars))
    assert.ok(inventory.sources.includes(f.engine.clouds[0].group.children[0]), 'retained off-view backing is still inventoried')

    // Without the reservation, a saturated 44-draw transient allowance misses the two real environment submissions.
    const missed = new TransientEffectBudget()
    missed.begin(f.engine.visualPolicy)
    for (const particle of f.engine.particles) missed.add(particle.mesh, 'gore', 0)
    missed.apply()
    assert.equal(missed.snapshot().admittedDrawUpperBound + transientSourceCost(sky).calls +
      transientSourceCost(f.engine.stars).calls, 46)
    missed.restore()

    f.engine.flames.push(new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 6), new THREE.MeshBasicMaterial()))
    scene.add(f.engine.flames[0])
    f.engine.prepareTransientEffects()
    budget.apply()
    assert.equal(budget.snapshot().reservedEnvironmentDrawUpperBound, 3)
    assert.equal(budget.snapshot().admittedDrawUpperBound, 44)
    assert.equal(f.engine.flames[0].visible, true)
    budget.restore()
  } finally {
    budget.clear()
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
    scene.traverse((source) => {
      if (!(source instanceof THREE.Mesh) && !(source instanceof THREE.Points)) return
      geometries.add(source.geometry)
      for (const material of Array.isArray(source.material) ? source.material : [source.material]) materials.add(material)
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    for (const texture of f.engine.generatedTextures.values()) texture.dispose()
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    f.dispose()
  }
})

test('environment reservation follows live view/layer visibility and never hides a protected-only overrun', () => {
  const geometry = new THREE.PlaneGeometry(), material = new THREE.MeshBasicMaterial({ opacity: 0 })
  const root = new THREE.Group(), offView = new THREE.Mesh(geometry, material), hidden = new THREE.Mesh(geometry, material)
  offView.position.set(1000, 0, -10)
  hidden.visible = false
  root.add(offView, hidden)
  const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 100), budget = new TransientEffectBudget()
  const sky = new THREE.Mesh(geometry, material)
  sky.position.z = -2
  root.add(sky)
  try {
    budget.begin(resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'low' }), camera)
    budget.reserveEnvironment(root)
    budget.reserveEnvironment(root)
    const tells = Array.from({ length: 20 }, () => new THREE.Mesh(geometry, material))
    for (const tell of tells) budget.add(tell, 'tell', 200, true)
    budget.apply()
    assert.equal(budget.snapshot().reservedEnvironmentDrawUpperBound, 1, 'duplicate roots do not double-charge')
    assert.equal(budget.snapshot().admittedDrawUpperBound, 21)
    assert.equal(budget.snapshot().overBudget, true)
    assert.ok(sky.visible && tells.every((tell) => tell.visible))
    budget.restore()
    sky.layers.set(1)
    budget.begin(resolveVisualPolicy({ visualMode: 'enhanced' }), camera)
    budget.reserveEnvironment(root)
    budget.apply()
    assert.equal(budget.snapshot().reservedEnvironmentDrawUpperBound, 0)
    budget.restore()
    sky.layers.set(0)
    offView.position.set(0, 0, -3)
    budget.begin(resolveVisualPolicy({ visualMode: 'enhanced' }), camera)
    budget.reserveEnvironment(root)
    budget.apply()
    assert.equal(budget.snapshot().reservedEnvironmentDrawUpperBound, 2, 'moving a cloud into view updates the reserve')
    budget.restore()
    assert.equal(hidden.visible, false)
  } finally { budget.clear(); geometry.dispose(); material.dispose() }
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
