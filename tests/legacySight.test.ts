import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  LegacySightRegistry,
  captureLegacySightHierarchy,
  isLegacySightSource,
} from '../src/game/world/LegacySightRegistry.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { StylizedArtLibrary } from '../src/game/art/index.ts'

const ink = { player: 0x102030, enemy: 0x301020, interactable: 0x302010, landmark: 0x203010 }

function capture(root: THREE.Object3D): THREE.Object3D[] {
  const result: THREE.Object3D[] = []
  root.traverse((object) => { if (isLegacySightSource(object)) result.push(object) })
  return result
}

function sight(from: THREE.Vector3, to: THREE.Vector3, sources: THREE.Object3D[]): boolean {
  const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0.1, Math.max(0.1, from.distanceTo(to) - 0.5))
  return ray.intersectObjects(sources, false).length === 0
}

test('canonical sight keeps both LOD forms, material slots and first-render matrix cadence', () => {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  root.position.x = 5
  root.userData.generatedSiteId = 'site'
  const lod = new THREE.LOD()
  const near = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 1), [
    new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
    ...Array.from({ length: 5 }, () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
  ])
  const far = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 3), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.65 }))
  lod.addLevel(near, 0)
  lod.addLevel(far, 30)
  root.add(lod)
  const ignored = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial())
  root.add(ignored, new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2))
  scene.add(root)
  const registry = new LegacySightRegistry(scene)
  const binding = registry.registerLegacySightRegion('region', captureLegacySightHierarchy(root))
  binding.setAttached(true)
  const canonical: THREE.Object3D[] = []
  registry.collectLegacySightSources(canonical)
  const legacy = capture(root)
  assert.equal(legacy.length, 2)
  assert.equal(canonical.length, 2)
  assert.deepEqual(canonical[0].matrixWorld.elements, near.matrixWorld.elements, 'Registration must not eagerly update world matrices')
  const rayPairs = [
    [new THREE.Vector3(5, 0, -5), new THREE.Vector3(5, 0, 5)],
    [new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, 0, 5)],
    [new THREE.Vector3(6, 0, -5), new THREE.Vector3(6, 0, 5)],
  ]
  for (const pair of rayPairs) assert.equal(sight(pair[0], pair[1], canonical), sight(pair[0], pair[1], legacy))
  scene.updateMatrixWorld(true)
  near.visible = false; far.visible = true
  for (const pair of rayPairs) assert.equal(sight(pair[0], pair[1], canonical), sight(pair[0], pair[1], legacy))
  assert.equal(sight(rayPairs[0][0], rayPairs[0][1], canonical), false)
  // Current rendering visibility and opacity must not re-filter captured sight.
  far.material.opacity = 0
  far.visible = false
  assert.equal(sight(rayPairs[0][0], rayPairs[0][1], canonical), false)
  // Enhanced source changes cannot change the canonical triangles/transforms.
  near.position.x = 20
  near.geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1)
  near.updateMatrixWorld()
  assert.equal(sight(rayPairs[0][0], rayPairs[0][1], canonical), false)
  let borrowedFreed = 0
  ;(canonical[0] as THREE.Mesh).geometry.addEventListener('dispose', () => borrowedFreed++)
  binding.dispose()
  assert.equal(canonical.length, 0, 'Unregister drains the live engine sight array before receipt release')
  assert.equal(borrowedFreed, 0)
  binding.dispose()
  registry.dispose()
})

test('legacy raze material and scale, restored after capture, retain the same sight changes', () => {
  const scene = new THREE.Scene(), root = new THREE.Group()
  root.userData.generatedSiteId = 'razed'
  root.position.set(2, 0, 0)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  mesh.position.y = 3
  root.add(mesh); scene.add(root)
  const registry = new LegacySightRegistry(scene)
  const nodes = captureLegacySightHierarchy(root)
  const binding = registry.registerLegacySightRegion('region', nodes)
  binding.setAttached(true)
  const canonical: THREE.Object3D[] = []
  registry.collectLegacySightSources(canonical)
  scene.updateMatrixWorld(true)
  const before = new THREE.Vector3(2, 5, -8), after = new THREE.Vector3(2, 5, 8)
  assert.equal(sight(before, after, canonical), false)
  registry.setRazedSite('razed')
  root.scale.set(1, 0.68, 1)
  mesh.material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide })
  assert.equal(sight(before, after, canonical), sight(before, after, [mesh]), 'Raze matrices change at the render boundary, not on the event')
  scene.updateMatrixWorld(true)
  assert.equal(sight(before, after, canonical), true)
  assert.equal(sight(before, after, canonical), sight(before, after, [mesh]))
  binding.dispose()
  const restored = registry.registerLegacySightRegion('region', nodes)
  restored.setAttached(true)
  registry.collectLegacySightSources(canonical)
  registry.setRazedSite('razed')
  scene.updateMatrixWorld(true)
  assert.equal(sight(before, after, canonical), true, 'A restored raze is applied to the new canonical site')
  restored.dispose(); registry.dispose()
})

test('generated enhanced sight is differential-equal across density, LOD, fade, raze and streaming', () => {
  const blueprint = generateWorld(20260906)
  const make = (enhanced: boolean) => {
    const scene = new THREE.Scene()
    const art = new StylizedArtLibrary({ ink, enhanced })
    const policy = resolveVisualPolicy({ visualMode: enhanced ? 'enhanced' : 'legacy' }, { enhancedAvailable: true })
    const runtime = new GeneratedWorldRuntime(scene, blueprint, { art, visualPolicy: policy, outlineDressing: true })
    return { scene, art, runtime }
  }
  const legacy = make(false), enhanced = make(true)
  const sources: THREE.Object3D[] = []
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 250)
  let compared = 0, blocked = 0, clear = 0
  for (const region of blueprint.regions.filter((entry) => entry.biome === 'forest' || entry.siteIds.length > 0).slice(0, 7)) {
    const center = legacy.runtime.getRegionCenter(region.id)!
    for (const world of [legacy, enhanced]) world.runtime.update({ focus: center, deltaSeconds: 0 })
    const originals = capture(legacy.scene)
    enhanced.runtime.collectLegacySightSources(sources)
    assert.equal(sources.length, originals.length)
    camera.position.set(center.x, center.y + 10, center.z + 12)
    enhanced.runtime.presentation!.prepare(camera)
    const subjects = [new THREE.Vector3(center.x, center.y + 1.5, center.z)]
    enhanced.runtime.presentation!.updateForeground(camera.position, subjects, 0, true)
    enhanced.runtime.setDecorationDensity(0.2)
    for (const world of [legacy, enhanced]) world.scene.updateMatrixWorld(true)
    for (let x = -20; x <= 20; x += 5) {
      for (let z = -20; z <= 20; z += 5) {
        const from = new THREE.Vector3(center.x + x, center.y + 1.5, center.z + z)
        const to = new THREE.Vector3(center.x - x + 1, center.y + 1.5, center.z - z + 1)
        const expected = sight(from, to, originals)
        assert.equal(sight(from, to, sources), expected)
        compared++
        if (expected) clear++; else blocked++
      }
    }
    assert.deepEqual(
      enhanced.runtime.collision.queryBounds(enhanced.runtime.bounds).map((entry) => entry.id).sort(),
      legacy.runtime.collision.queryBounds(legacy.runtime.bounds).map((entry) => entry.id).sort(),
    )
    assert.equal(enhanced.runtime.blueprint.fingerprint, legacy.runtime.blueprint.fingerprint)
  }
  assert.ok(compared >= 300)
  assert.ok(blocked > 0 && clear > 0, 'The differential must exercise both blocked and clear rays')
  enhanced.runtime.dispose()
  assert.equal(sources.length, 0)
  legacy.runtime.dispose()
  enhanced.art.dispose(); legacy.art.dispose()
})
