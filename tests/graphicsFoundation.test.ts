import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import {
  ART_SHADOW_ATTRIBUTE,
  ART_SURFACE_ATTRIBUTE,
  ART_VISIBILITY_ATTRIBUTE,
  ART_WIND_ATTRIBUTE,
  StylizedArtLibrary,
  bakeOutlineNormals,
  ensureVertexColors,
  validateArtGeometry,
} from '../src/game/art/index.ts'
import { BloomPostProcessor } from '../src/game/BloomPostProcessor.ts'
import {
  WorldPresentationRegistry,
  shadowSubmissionCost,
  stabilizeKeyLight,
} from '../src/game/world/WorldPresentationRegistry.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { CameraVisibility } from '../src/game/cameraVisibility.ts'
import { GraphicsFoundationFixture } from '../src/game/diagnostics/GraphicsFoundationFixture.ts'

const ink = { player: 0x102030, enemy: 0x301020, interactable: 0x302010, landmark: 0x203010 }
const library = () => new StylizedArtLibrary({ ink, enhanced: true })
const box = () => bakeOutlineNormals(new THREE.BoxGeometry(1, 2, 1))
function compile(material: THREE.Material, kind: 'standard' | 'basic' | 'depth' = 'standard') {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib[kind].vertexShader, fragmentShader: THREE.ShaderLib[kind].fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)
  return shader
}

test('per-instance fade owns a full clone and synchronizes only the chosen instance and its ink', () => {
  const art = library()
  const geometry = box()
  const material = art.acquireMaterial('shared', { color: 0x98aa65, surface: 'foliage' })
  const first = new THREE.InstancedMesh(geometry, material, 3)
  const other = new THREE.InstancedMesh(geometry, material, 3)
  const outline = art.applyOutline(first, 'landmark', { instanced: true })
  const binding = art.bindRenderSource(first, { visibility: true, shadowParticipation: true })
  assert.notEqual(first.geometry, geometry)
  assert.notEqual(first.geometry.getAttribute('position').array, geometry.getAttribute('position').array)
  assert.equal(outline.shells[0].geometry, first.geometry)
  art.setSourceVisibility(binding, 0.2, 1)
  const attribute = first.geometry.getAttribute(ART_VISIBILITY_ATTRIBUTE)
  assert.equal(attribute.getX(0), 1)
  assert.ok(Math.abs(attribute.getX(1) - 0.2) < 1e-6)
  assert.equal(attribute.getX(2), 1)
  assert.equal(other.geometry.hasAttribute(ART_VISIBILITY_ATTRIBUTE), false)
  assert.equal(other.material, first.material)
  assert.equal(material.opacity, 1)
  assert.equal(material.transparent, false)
  assert.equal(material.depthWrite, true)
  assert.equal(first.count, 3)
  first.count = 1
  art.refreshRenderSource(binding)
  assert.equal((outline.shells[0] as THREE.InstancedMesh).count, 1)
  first.count = 3
  art.refreshRenderSource(binding)
  assert.equal((outline.shells[0] as THREE.InstancedMesh).count, 3)
  art.releaseOutline(outline)
  let disposed = 0
  first.geometry.addEventListener('dispose', () => disposed++)
  art.releaseRenderSource(binding)
  art.releaseRenderSource(binding)
  assert.equal(disposed, 1)
  assert.equal(first.geometry, geometry)
  assert.equal(art.getRenderBindingStats().sources, 0)
  first.dispose(); other.dispose(); geometry.dispose(); art.dispose()
})

test('skinned ink borrows live bind data and atomic replacement retains excluded triangles and fade', () => {
  const art = library()
  const geometry = box()
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4))
  const weights = new Float32Array(count * 4)
  for (let index = 0; index < count; index++) weights[index * 4] = 1
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
  const material = art.acquireMaterial('skin', { color: 0xdab08e, surface: 'skin' })
  const source = new THREE.SkinnedMesh(geometry, material)
  const bone = new THREE.Bone()
  source.add(bone)
  const skeleton = new THREE.Skeleton([bone])
  source.bind(skeleton)
  source.position.set(3, 0, 1)
  const root = new THREE.Group()
  root.add(source)
  const binding = art.bindRenderSource(source, { visibility: true, deformationPadding: 2 })
  const outline = art.applyOutline(root, 'structural')
  const shell = outline.shells[0]
  assert.ok(shell instanceof THREE.SkinnedMesh)
  assert.equal(shell.skeleton, skeleton)
  bone.rotation.z = 0.4
  root.updateMatrixWorld(true)
  skeleton.update()
  const first = source.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(source.matrixWorld)
  const second = shell.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(shell.matrixWorld)
  assert.ok(first.distanceTo(second) < 1e-6)
  art.setSourceVisibility(binding, 0.25)
  const replacement = geometry.clone()
  replacement.setIndex(Array.from(geometry.index!.array).slice(0, 12))
  let released = 0
  art.replaceRenderSourceGeometry(binding, { geometry: replacement, release: () => { released++; replacement.dispose() } })
  assert.equal(source.geometry.index!.count, 12)
  assert.equal(shell.geometry, source.geometry)
  assert.equal(art.getSourceVisibility(binding), 0.25)
  const old = source.geometry
  const broken = geometry.clone()
  broken.deleteAttribute('skinWeight')
  let invalidReleased = false
  assert.throws(() => art.replaceRenderSourceGeometry(binding, { geometry: broken, release: () => { invalidReleased = true } }), /skinWeight/)
  assert.equal(source.geometry, old)
  assert.equal(shell.geometry, old)
  assert.equal(invalidReleased, false)
  assert.equal(released, 0)
  let skeletonDisposed = false
  const disposeSkeleton = skeleton.dispose.bind(skeleton)
  skeleton.dispose = () => { skeletonDisposed = true; disposeSkeleton() }
  art.releaseOutline(outline)
  art.releaseRenderSource(binding)
  assert.equal(released, 1)
  assert.equal(skeletonDisposed, false)
  broken.dispose(); geometry.dispose(); skeleton.dispose(); art.dispose()
})

test('packed response and wind are explicit layouts; source, skin-aware ink and depth share deformation', () => {
  const art = library()
  const geometry = ensureVertexColors(box())
  const count = geometry.getAttribute('position').count
  const responses = new Float32Array(count * 4)
  for (let index = 0; index < count; index++) responses.set([0.8, 0.1, 0.7, 0.2], index * 4)
  geometry.setAttribute(ART_SURFACE_ATTRIBUTE, new THREE.BufferAttribute(responses, 4))
  geometry.setAttribute(ART_WIND_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(count * 2).fill(0.5), 2))
  const material = art.acquireMaterial('packed-wind', {
    color: 0xffffff, surface: 'cloth', vertexColors: true,
    mapping: 'world-triplanar', metersPerRepeat: 2,
    attributes: { surfaceResponse: true, wind: true },
  })
  const source = new THREE.InstancedMesh(geometry, material, 2)
  const binding = art.bindRenderSource(source, { visibility: true, shadowParticipation: true, deformationPadding: 0.2 })
  const outline = art.applyOutline(source, 'structural', { instanced: true })
  const main = compile(material), inkShader = compile(outline.shells[0].material as THREE.Material, 'basic')
  const depth = compile(source.customDepthMaterial!, 'depth')
  for (const shader of [main, inkShader, depth]) assert.match(shader.vertexShader, /transformed \+= kArtWindShear/)
  assert.match(inkShader.vertexShader, /skinMatrix \* vec4\( kOutlineNormal/)
  assert.match(main.fragmentShader, /roughnessFactor = vArtSurface.x/)
  assert.match(main.fragmentShader, /vStylizedWorld\.yz \/ uArtMeters/)
  assert.match(main.fragmentShader, /kArtDither/)
  assert.match(inkShader.fragmentShader, /kArtDither/)
  assert.doesNotMatch(depth.fragmentShader, /kArtDither|vArtVisibility/)
  assert.match(depth.fragmentShader, /vArtShadowParticipation < 0.5/)
  assert.equal(main.uniforms.uArtWind, depth.uniforms.uArtWind)
  assert.equal(inkShader.uniforms.uArtTime, main.uniforms.uArtTime)
  art.setLightingReference({ environment: {
    timeSeconds: 10, windX: 1, windZ: 0, windStrength: 0.7, rain: 1, snow: 0, wetness: 0,
    skyColor: new THREE.Color(0xc2d1df), horizonColor: new THREE.Color(0xb0a38d),
  } })
  assert.equal(depth.uniforms.uArtTime.value, 10)
  assert.throws(() => art.createMaterial({ color: 0xffffff, surface: 'cloth', attributes: { weatherResponse: true } }), /not installed/)
  const invalid = geometry.clone()
  invalid.deleteAttribute(ART_SURFACE_ATTRIBUTE)
  assert.throws(() => validateArtGeometry(source, invalid), /artSurfaceResponse/)
  invalid.dispose()
  art.releaseOutline(outline); art.releaseRenderSource(binding); source.dispose(); geometry.dispose(); art.dispose()
})

test('shadow admission prices submitted batches and groups, not a selected subset or camera fade', () => {
  const art = library()
  const registry = new WorldPresentationRegistry(art)
  const geometry = box()
  const material = art.acquireMaterial('foliage', { color: 0x556644, surface: 'foliage' })
  const mesh = new THREE.InstancedMesh(geometry, material, 10)
  for (let index = 0; index < 10; index++) mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(index * 12, 0, 2))
  const binding = art.bindRenderSource(mesh, { visibility: true, shadowParticipation: true })
  const registration = registry.registerShadowCaster({ id: 'tree', regionId: 'test', binding, priority: 'canopy' })
  const camera = new THREE.PerspectiveCamera()
  registry.prepare(camera)
  const policy = resolveVisualPolicy({ visualMode: 'enhanced' }, { enhancedAvailable: true }).shadows
  registry.updateShadows(new THREE.Vector3(), { ...policy, worldInstanceBudget: 5 })
  assert.equal(mesh.castShadow, false)
  assert.equal(registry.debug.rejectedShadowBatches, 1)
  registry.updateShadows(new THREE.Vector3(), { ...policy, worldDistance: 10, worldInstanceBudget: 10 })
  assert.equal(mesh.castShadow, true)
  assert.equal(registry.debug.shadowInstances, 10)
  assert.equal(registry.debug.selectedShadowInstances, 1)
  assert.equal(registry.debug.shadowTriangles, 120)
  assert.equal(mesh.geometry.getAttribute(ART_SHADOW_ATTRIBUTE).getX(0), 1)
  assert.equal(mesh.geometry.getAttribute(ART_SHADOW_ATTRIBUTE).getX(1), 0)
  art.setSourceVisibility(binding, 0, 0)
  registry.updateShadows(new THREE.Vector3(), { ...policy, worldDistance: 10, worldInstanceBudget: 10 })
  assert.equal(mesh.castShadow, true)
  assert.equal(mesh.geometry.getAttribute(ART_SHADOW_ATTRIBUTE).getX(0), 1)
  assert.equal(shadowSubmissionCost(new THREE.Mesh(geometry, [material, material, material, material, material, material])).draws, 6)
  registration.dispose(); registry.dispose(); art.releaseRenderSource(binding); mesh.dispose(); geometry.dispose(); art.dispose()
})

test('foreground exit hysteresis suppresses one-frame canopy flicker without retaining unloaded sources', () => {
  const art = library(), registry = new WorldPresentationRegistry(art)
  const geometry = box()
  const mesh = new THREE.InstancedMesh(geometry, art.acquireMaterial('canopy', { color: 0x718653, surface: 'foliage' }), 1)
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 2, 4))
  const binding = art.bindRenderSource(mesh, { visibility: true })
  const registration = registry.registerOccluder({ id: 'canopy', regionId: 'test', binding, kind: 'foreground' })
  registry.prepare(new THREE.PerspectiveCamera())
  const camera = new THREE.Vector3(0, 2, 8)
  registry.updateForeground(camera, [new THREE.Vector3(0, 2, 0)], 0, true)
  assert.equal(art.getSourceVisibility(binding), 0)
  registry.updateForeground(camera, [], 1 / 60, false)
  assert.equal(art.getSourceVisibility(binding), 0)
  registry.updateForeground(camera, [], 0.2, false)
  assert.ok(art.getSourceVisibility(binding) > 0.5)
  registration.dispose()
  assert.equal(art.getSourceVisibility(binding), 1)
  registry.dispose(); art.releaseRenderSource(binding); mesh.dispose(); geometry.dispose(); art.dispose()
})

test('a generated dense forest and nearby site actually contribute bounded world shadows', () => {
  const art = library()
  const scene = new THREE.Scene()
  const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'high' }, { enhancedAvailable: true })
  const blueprint = generateWorld(20260906)
  const world = new GeneratedWorldRuntime(scene, blueprint, { art, visualPolicy: policy, outlineDressing: true })
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 250)
  let forest = false, building = false
  for (const region of blueprint.regions.filter((entry) => entry.biome === 'forest' || entry.siteIds.length > 0)) {
    const center = world.getRegionCenter(region.id)!
    world.update({ focus: center, deltaSeconds: 0 })
    camera.position.set(center.x, center.y + 8, center.z + 10)
    scene.updateMatrixWorld(true)
    world.presentation!.prepare(camera)
    world.presentation!.updateShadows(new THREE.Vector3(center.x, center.y, center.z), policy.shadows)
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.castShadow) return
      if (object.userData.presentationDressingKind === 'tree') forest = true
      if (object.name.startsWith('site-body:') || object.name.startsWith('site-props:')) building = true
    })
    const debug = world.presentation!.debug
    assert.ok(debug.shadowDraws <= policy.shadows.worldCasterBudget)
    assert.ok(debug.shadowInstances <= policy.shadows.worldInstanceBudget)
    assert.ok(debug.shadowTriangles <= policy.shadows.worldTriangleBudget)
    if (forest && building) break
  }
  assert.equal(forest, true, 'No real canopy batch was admitted')
  assert.equal(building, true, 'No real nearby site was admitted')
  world.dispose()
  assert.equal(art.getRenderBindingStats().sources, 0)
  art.dispose()
})

test('light-space shadow projection resists sub-texel translation without changing direction', () => {
  const make = (x: number) => {
    const light = new THREE.DirectionalLight()
    light.position.set(-35 + x, 58, 24)
    light.target.position.set(x, 0, 0)
    light.shadow.mapSize.set(1024, 1024)
    const before = light.position.clone().sub(light.target.position).normalize()
    stabilizeKeyLight(light, new THREE.Vector3(x, 2, 0), 34)
    const after = light.position.clone().sub(light.target.position).normalize()
    assert.ok(before.distanceTo(after) < 1e-10)
    return light
  }
  const first = make(0), second = make(0.0001)
  const direction = first.position.clone().sub(first.target.position).normalize()
  const delta = second.target.position.clone().sub(first.target.position)
  assert.ok(delta.clone().addScaledVector(direction, -delta.dot(direction)).length() < 1e-8)
  first.shadow.dispose(); second.shadow.dispose()
})

test('the sole composer sizes physical input once, applies one output conversion, and releases all post owners', () => {
  let size = new THREE.Vector2(900, 600)
  const renderer = {
    getDrawingBufferSize: (target: THREE.Vector2) => target.copy(size),
    getPixelRatio: () => 1.5,
    getSize: (target: THREE.Vector2) => target.set(600, 400),
    render() {},
  }
  const post = new BloomPostProcessor(renderer as never, new THREE.Scene(), new THREE.PerspectiveCamera(), true,
    { enhanced: true, antialiasing: 'fxaa' })
  const composer = Reflect.get(post, 'composer')
  assert.equal(composer.renderTarget1.width, 900)
  assert.equal(composer.renderTarget1.height, 600)
  assert.equal(composer.renderTarget1.samples, 0)
  assert.equal(composer.getPixelRatio?.() ?? Reflect.get(composer, '_pixelRatio'), 1)
  assert.deepEqual(post.getDebugSnapshot().passes, ['scene', 'bloom', 'grade', 'output', 'fxaa'])
  const aa = Reflect.get(post, 'aaPass')
  assert.equal(aa.material.toneMapped, false)
  assert.doesNotMatch(aa.material.fragmentShader, /tonemapping_fragment|colorspace_fragment/)
  size = new THREE.Vector2(520, 320)
  post.setSize(600, 400)
  assert.equal(composer.renderTarget1.width, 520)
  assert.equal(aa.uniforms.resolution.value.x, 1 / 520)
  let disposed = 0
  composer.renderTarget1.addEventListener('dispose', () => disposed++)
  post.setEnabled(false)
  assert.equal(post.getDebugSnapshot().composer, false)
  assert.equal(disposed, 1)
  post.dispose()
  assert.equal(disposed, 1)
})

test('original forest and riverside requests exercise actual registered camera and foreground geometry', () => {
  const manifest = JSON.parse(readFileSync(new URL('../docs/images/graphics-review/capture-manifest.json', import.meta.url), 'utf8'))
  for (const file of ['elf-forest-contract.png', 'guard-melee-impact.png']) {
    const frame = manifest.captures.find((entry: { file: string }) => entry.file === file)
    assert.ok(frame)
    const art = library(), scene = new THREE.Scene()
    const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'high' }, { enhancedAvailable: true })
    const world = new GeneratedWorldRuntime(scene, generateWorld(20260906), { art, visualPolicy: policy, outlineDressing: true })
    world.update({ focus: frame.player.position, deltaSeconds: 0 })
    const target = new THREE.Vector3().copy(frame.player.position)
    target.y += 1.65
    const desired = target.clone().add(new THREE.Vector3(-Math.sin(frame.camera.yaw) * 10,
      5.2 + frame.camera.pitch * 3.5, Math.cos(frame.camera.yaw) * 10))
    const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 300)
    camera.position.copy(frame.camera.position)
    scene.updateMatrixWorld(true)
    world.presentation!.prepare(camera)
    const solver = new CameraVisibility()
    solver.resolve(target, desired, camera, 0, true, world.presentation!, (x, z) => world.sampleHeight(x, z), camera.position)
    camera.lookAt(target)
    world.presentation!.prepare(camera)
    const subjects = [target, ...frame.nearbyActors.filter((actor: { id: string }) => actor.id.startsWith('squad:'))
      .map((actor: { position: THREE.Vector3 }) => new THREE.Vector3().copy(actor.position).add(new THREE.Vector3(0, 1.35, 0)))]
    world.presentation!.updateForeground(camera.position, subjects, 0, true)
    assert.equal(solver.debug.overflows, 0)
    if (file.startsWith('guard')) {
      assert.ok(camera.position.distanceTo(target) > 3.5, `Riverside still compressed: ${JSON.stringify(solver.debug)}`)
    } else assert.ok(world.presentation!.debug.fadedInstances > 0, 'Original foreground vegetation was not registered/faded')
    console.log(`GFX-02 CPU ${file}: boom=${solver.debug.boomDistance.toFixed(3)}, shoulder=${solver.debug.shoulder}, faded=${world.presentation!.debug.fadedInstances}, triangles=${solver.debug.triangleTests}`)
    world.dispose(); art.dispose()
  }
})

test('the joint skin/wind/depth fixture uses production bindings and releases its skeleton and state', () => {
  const art = library(), scene = new THREE.Scene()
  const fixture = new GraphicsFoundationFixture(art, scene, new THREE.Vector3(), 0)
  fixture.update(0.7)
  scene.updateMatrixWorld(true)
  scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh) object.skeleton.update() })
  assert.equal(fixture.snapshot().borrowedSkeleton, true)
  assert.ok(fixture.snapshot().sourceInkPositionError! < 1e-6)
  assert.equal(art.getRenderBindingStats().sources, 2)
  fixture.dispose()
  fixture.dispose()
  assert.equal(art.getRenderBindingStats().sources, 0)
  assert.equal(scene.children.length, 0)
  art.dispose()
})

test('a failed outline disposal still drains all borrowers and releases owned source geometry once', () => {
  const art = library()
  const geometry = box()
  const source = new THREE.InstancedMesh(geometry, art.acquireMaterial('failure', { color: 0x889944, surface: 'foliage' }), 2)
  const binding = art.bindRenderSource(source, { visibility: true })
  const first = art.applyOutline(source, 'structural', { instanced: true })
  const second = art.applyOutline(source, 'structural', { instanced: true })
  const firstShell = first.shells[0] as THREE.InstancedMesh
  const secondShell = second.shells[0] as THREE.InstancedMesh
  firstShell.addEventListener('dispose', () => { throw new Error('Injected shell disposal failure') })
  let secondReleased = 0, ownedReleased = 0
  secondShell.addEventListener('dispose', () => secondReleased++)
  source.geometry.addEventListener('dispose', () => ownedReleased++)
  assert.throws(() => art.releaseRenderSource(binding), AggregateError)
  assert.equal(firstShell.parent, null)
  assert.equal(secondShell.parent, null)
  assert.notEqual(firstShell.instanceMatrix, source.instanceMatrix)
  assert.notEqual(secondShell.instanceMatrix, source.instanceMatrix)
  assert.equal(secondReleased, 1)
  assert.equal(ownedReleased, 1)
  assert.equal(source.geometry, geometry)
  assert.equal(art.getRenderBindingStats().sources, 0)
  art.releaseRenderSource(binding)
  art.releaseOutline(first); art.releaseOutline(second)
  assert.equal(secondReleased, 1)
  assert.equal(ownedReleased, 1)
  source.dispose(); geometry.dispose(); art.dispose()
})

test('a failed replacement cleanup still releases its old lease after switching every borrower', () => {
  const art = library()
  const geometry = box()
  const source = new THREE.Mesh(geometry, art.acquireMaterial('replace-failure', { color: 0xdab08e, surface: 'skin' }))
  let oldLeaseReleased = 0
  const binding = art.bindRenderSource(source, {
    geometryLease: { geometry, release: () => oldLeaseReleased++ }, visibility: true,
  })
  const outline = art.applyOutline(source, 'structural')
  source.geometry.addEventListener('dispose', () => { throw new Error('Injected old geometry disposal failure') })
  const next = box()
  let nextLeaseReleased = 0
  assert.throws(() => art.replaceRenderSourceGeometry(binding, {
    geometry: next, release: () => nextLeaseReleased++,
  }), AggregateError)
  assert.equal(oldLeaseReleased, 1)
  assert.equal(nextLeaseReleased, 0)
  assert.equal(outline.shells[0].geometry, source.geometry)
  assert.notEqual(source.geometry, geometry)
  art.releaseOutline(outline); art.releaseRenderSource(binding)
  assert.equal(nextLeaseReleased, 1)
  geometry.dispose(); next.dispose(); art.dispose()
})

test('presentation registration rejects foreign, duplicate and released source bindings', () => {
  const art = library(), foreignArt = library(), registry = new WorldPresentationRegistry(art)
  const geometry = box()
  const source = new THREE.Mesh(geometry, art.acquireMaterial('registration', { color: 0x777777, surface: 'stone' }))
  const binding = art.bindRenderSource(source)
  assert.throws(() => foreignArt.releaseRenderSource(binding), /another owner/)
  const foreignRegistry = new WorldPresentationRegistry(foreignArt)
  assert.throws(() => foreignRegistry.registerOccluder({ id: 'foreign', regionId: 'r', binding, kind: 'solid' }), /registration/)
  const registration = registry.registerOccluder({ id: 'valid', regionId: 'r', binding, kind: 'solid' })
  assert.throws(() => registry.registerOccluder({ id: 'duplicate-source', regionId: 'r', binding, kind: 'foreground' }), /registration/)
  art.releaseRenderSource(binding)
  assert.throws(() => registry.prepare(new THREE.PerspectiveCamera()), /Unregister/)
  registration.dispose()
  registry.dispose(); foreignRegistry.dispose(); geometry.dispose(); art.dispose(); foreignArt.dispose()
})
