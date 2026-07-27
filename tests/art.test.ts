import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  GeometryCache,
  OUTLINE_NORMAL_ATTRIBUTE,
  StylizedArtLibrary,
  artNoiseSeed,
  artVariation,
  bakeOutlineNormals,
  bakeVerticalOcclusion,
  branchStructure,
  createLod,
  displaceGeometry,
  extrudeProfile,
  facetGeometry,
  fbm3,
  hasOutlineNormals,
  hasStylizedShader,
  latheProfile,
  loftProfile,
  mergeAll,
  polygonProfile,
  rectProfile,
  stylizedCapsule,
  taperedBox,
  transformed,
  tubeAlongPoints,
} from '../src/game/art/index.ts'

const INK = {
  player: 0x2b3a55,
  enemy: 0x5a1f2b,
  interactable: 0x4a3a12,
  landmark: 0x22303a,
} as const

function createLibrary(): StylizedArtLibrary {
  return new StylizedArtLibrary({ ink: INK })
}

/**
 * `docs/08` §7 sets `ART_LIBRARY_MATERIALS<=12`, and until now nothing checked it.
 * Two sibling sessions are adding surfaces against that ceiling, so this pins both
 * the limit and the headroom: the library's own worst case is every outline kind in
 * both variants plus a contact shadow, and whatever is left is Wave 2's to spend.
 */
test('the library stays inside its documented material budget', () => {
  const library = createLibrary()
  const kinds = ['player', 'enemy', 'interactable', 'landmark'] as const

  for (const kind of kinds) {
    for (const smooth of [false, true]) {
      library.getOutlineMaterial(kind, smooth)
    }
  }
  const shadow = library.createContactShadow()

  const worstCase = library.libraryOwnedMaterialCount
  assert.equal(
    worstCase,
    9,
    'eight outline materials plus one shared contact shadow',
  )
  assert.ok(
    worstCase <= 12,
    `ART_LIBRARY_MATERIALS is 12; the library itself uses ${String(worstCase)}`,
  )

  // Contact shadows share one material per distinct opacity, and the world only
  // ever asks for the default — CONTACT_SHADOW_MATERIALS<=4 has room to spare.
  const second = library.createContactShadow()
  assert.equal(second.material, shadow.material, 'contact shadows share a material')
  assert.equal(library.libraryOwnedMaterialCount, worstCase)

  // Shared surfaces count against the same ceiling. This is the arbitration point:
  // Wave 2 has three slots before the budget in docs/08 has to be renegotiated.
  for (let index = 0; index < 3; index += 1) {
    library.acquireMaterial(`wave2-${String(index)}`, {
      color: 0x808080,
      surface: 'cloth',
    })
  }
  assert.equal(library.libraryOwnedMaterialCount, 12)

  library.dispose()
  assert.equal(library.libraryOwnedMaterialCount, 0, 'teardown clears every map')
})

test('art noise is deterministic and bounded', () => {
  for (let index = 0; index < 64; index += 1) {
    const x = index * 0.37
    const first = fbm3(x, x * 0.5, x * 1.7, 12345)
    const second = fbm3(x, x * 0.5, x * 1.7, 12345)
    assert.equal(first, second, 'the same inputs must produce the same noise')
    assert.ok(first >= -1 && first <= 1, `noise ${String(first)} is out of range`)
  }
  assert.notEqual(fbm3(1, 2, 3, 1), fbm3(1, 2, 3, 2))
})

test('art streams are namespaced away from gameplay streams', () => {
  const first = artVariation('коровaны', 'npc:torso')
  const second = artVariation('коровaны', 'npc:torso')
  const other = artVariation('коровaны', 'props:cart')
  const sequence = [first.unit(), first.unit(), first.unit()]
  const repeat = [second.unit(), second.unit(), second.unit()]
  assert.deepEqual(sequence, repeat, 'the same seed and label must replay exactly')
  assert.notDeepEqual(sequence, [other.unit(), other.unit(), other.unit()])
  assert.notEqual(artNoiseSeed('seed', 'a'), artNoiseSeed('seed', 'b'))
})

test('lofted bodies produce complete, normalized geometry', () => {
  const box = taperedBox({
    width: 1,
    height: 2,
    depth: 0.6,
    topScale: 0.72,
    bevel: 0.12,
    anchor: 'base',
  })
  const position = box.getAttribute('position')
  const normal = box.getAttribute('normal')
  assert.ok(position.count > 0)
  assert.equal(normal.count, position.count)
  assert.equal(box.getAttribute('uv').count, position.count)
  box.computeBoundingBox()
  const bounds = box.boundingBox
  assert.ok(bounds)
  assert.ok(Math.abs(bounds.min.y) < 1e-6, 'base anchoring puts the origin at y=0')
  assert.ok(Math.abs(bounds.max.y - 2) < 1e-6)
  for (let index = 0; index < normal.count; index += 1) {
    const length = Math.hypot(
      normal.getX(index),
      normal.getY(index),
      normal.getZ(index),
    )
    assert.ok(Math.abs(length - 1) < 1e-4, `normal ${String(index)} is not unit length`)
  }
  box.dispose()
})

test('capsules, lathes and tubes stay finite', () => {
  const geometries = [
    stylizedCapsule({ radius: 0.2, height: 0.9, radialSegments: 7, capSegments: 2 }),
    latheProfile([
      { x: 0.01, y: 0 },
      { x: 0.4, y: 0.3 },
      { x: 0.28, y: 0.8 },
      { x: 0.01, y: 1 },
    ]),
    tubeAlongPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0.2, y: 0.8, z: 0.1 },
        { x: 0.1, y: 1.6, z: -0.2 },
      ],
      { radius: (t) => 0.14 * (1 - t) + 0.03, capEnd: true },
    ),
  ]
  for (const geometry of geometries) {
    const position = geometry.getAttribute('position')
    assert.ok(position.count > 0, `${geometry.name} produced no vertices`)
    for (let index = 0; index < position.count * 3; index += 1) {
      assert.ok(
        Number.isFinite((position.array as ArrayLike<number>)[index]),
        `${geometry.name} produced a non-finite position`,
      )
    }
    geometry.dispose()
  }
})

test('branch structures are deterministic for a seed', () => {
  const build = (): THREE.BufferGeometry =>
    branchStructure({
      variation: artVariation(4242, 'tree:test'),
      height: 3,
      baseRadius: 0.24,
      branchCount: 3,
      depth: 1,
      radialSegments: 4,
      segmentsPerBranch: 3,
    })
  const first = build()
  const second = build()
  assert.deepEqual(
    Array.from(first.getAttribute('position').array as ArrayLike<number>),
    Array.from(second.getAttribute('position').array as ArrayLike<number>),
  )
  first.dispose()
  second.dispose()
})

test('merging reconciles attribute sets instead of returning null', () => {
  const withColor = taperedBox({ width: 1, height: 1, depth: 1 })
  bakeVerticalOcclusion(withColor, { strength: 0.4 })
  const withoutColor = taperedBox({ width: 0.5, height: 0.5, depth: 0.5 })
  const merged = mergeAll([withColor, withoutColor], { name: 'merge-test' })
  assert.ok(merged.getAttribute('color'), 'merged geometry keeps vertex colours')
  assert.equal(merged.name, 'merge-test')
  merged.dispose()
})

test('merging an empty list fails loudly', () => {
  assert.throws(() => mergeAll([]), RangeError)
})

test('vertical occlusion darkens the base and leaves the top alone', () => {
  const geometry = taperedBox({ width: 1, height: 2, depth: 1, anchor: 'base' })
  bakeVerticalOcclusion(geometry, { strength: 0.5, falloff: 2 })
  const position = geometry.getAttribute('position')
  const color = geometry.getAttribute('color')
  let lowest = Infinity
  let highest = -Infinity
  for (let index = 0; index < position.count; index += 1) {
    if (position.getY(index) < 1e-6) lowest = Math.min(lowest, color.getX(index))
    if (position.getY(index) > 2 - 1e-6) highest = Math.max(highest, color.getX(index))
  }
  assert.ok(lowest < 0.6, `base vertices should be darkened, got ${String(lowest)}`)
  assert.ok(highest > 0.99, `top vertices should be untouched, got ${String(highest)}`)
  geometry.dispose()
})

test('outline normals are welded, unit length and detectable', () => {
  const geometry = taperedBox({ width: 1, height: 1, depth: 1, bevel: 0.1 })
  assert.equal(hasOutlineNormals(geometry), false)
  bakeOutlineNormals(geometry)
  assert.equal(hasOutlineNormals(geometry), true)
  const outline = geometry.getAttribute(OUTLINE_NORMAL_ATTRIBUTE)
  const position = geometry.getAttribute('position')
  assert.equal(outline.count, position.count)

  const byPosition = new Map<string, string>()
  for (let index = 0; index < outline.count; index += 1) {
    const length = Math.hypot(
      outline.getX(index),
      outline.getY(index),
      outline.getZ(index),
    )
    assert.ok(Math.abs(length - 1) < 1e-4)
    const key = `${position.getX(index).toFixed(4)}|${position
      .getY(index)
      .toFixed(4)}|${position.getZ(index).toFixed(4)}`
    const value = `${outline.getX(index).toFixed(4)}|${outline
      .getY(index)
      .toFixed(4)}|${outline.getZ(index).toFixed(4)}`
    const seen = byPosition.get(key)
    if (seen !== undefined) {
      assert.equal(seen, value, 'coincident vertices must share one outline normal')
    } else {
      byPosition.set(key, value)
    }
  }
  geometry.dispose()
})

test('displacement is seeded and can keep a flat base', () => {
  const build = (): THREE.BufferGeometry =>
    displaceGeometry(new THREE.IcosahedronGeometry(1, 1), {
      seed: 99,
      amplitude: 0.3,
      frequency: 1.4,
      flatBase: 0.5,
    })
  const first = build()
  const second = build()
  assert.deepEqual(
    Array.from(first.getAttribute('position').array as ArrayLike<number>),
    Array.from(second.getAttribute('position').array as ArrayLike<number>),
  )
  first.dispose()
  second.dispose()
})

test('the geometry cache is reference counted', () => {
  const cache = new GeometryCache()
  let builds = 0
  const build = (): THREE.BufferGeometry => {
    builds += 1
    return new THREE.BoxGeometry(1, 1, 1)
  }
  const first = cache.acquire('box', build)
  const second = cache.acquire('box', build)
  assert.equal(builds, 1, 'a cached key must build once')
  assert.equal(first, second)
  assert.equal(cache.referenceCount('box'), 2)

  let disposals = 0
  first.addEventListener('dispose', () => {
    disposals += 1
  })
  cache.release('box')
  assert.equal(disposals, 0, 'a still-referenced geometry must survive')
  cache.release('box')
  assert.equal(disposals, 1)
  assert.equal(cache.size, 0)

  cache.dispose()
  cache.dispose()
  assert.throws(() => cache.acquire('box', build))
})

test('LOD levels must be ordered from nearest to farthest', () => {
  const near = new THREE.BoxGeometry(1, 1, 1)
  const far = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshBasicMaterial()
  const lod = createLod({
    levels: [
      { geometry: near, distance: 0 },
      { geometry: far, distance: 40 },
    ],
    material,
  })
  assert.equal(lod.levels.length, 2)
  assert.throws(() =>
    createLod({
      levels: [
        { geometry: near, distance: 40 },
        { geometry: far, distance: 0 },
      ],
      material,
    }),
  )
  near.dispose()
  far.dispose()
  material.dispose()
})

test('the art library separates caller-owned and library-owned materials', () => {
  const library = createLibrary()
  const owned = library.createMaterial({ color: 0x884422, surface: 'cloth' })
  assert.equal(StylizedArtLibrary.isLibraryOwned(owned), false)

  const shared = library.acquireMaterial('bark', { color: 0x554433, surface: 'bark' })
  const sharedAgain = library.acquireMaterial('bark', {
    color: 0x000000,
    surface: 'stone',
  })
  assert.equal(shared, sharedAgain, 'one key means one material instance')
  assert.equal(StylizedArtLibrary.isLibraryOwned(shared), true)
  assert.equal(library.sharedMaterialCount, 1)
  assert.equal(StylizedArtLibrary.isLibraryOwned(library.rampTexture), true)

  let disposals = 0
  shared.addEventListener('dispose', () => {
    disposals += 1
  })
  library.dispose()
  library.dispose()
  assert.equal(disposals, 1, 'library resources dispose exactly once')
  owned.dispose()
})

test('stylized materials compile the injection and share a program key', () => {
  const library = createLibrary()
  const material = library.createMaterial({ color: 0xffffff, surface: 'stone' })
  assert.equal(material.customProgramCacheKey(), 'korovany-stylized-v1')

  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)
  assert.ok(shader.uniforms.uToonRamp, 'the ramp uniform is bound')
  assert.ok(shader.vertexShader.includes('vStylizedWorld'))
  assert.ok(shader.fragmentShader.includes('uToonRamp'))
  assert.ok(
    !shader.fragmentShader.includes('#include <lights_fragment_end>\n#include'),
    'the injection replaces the chunk exactly once',
  )

  const outline = library.getOutlineMaterial('enemy', true)
  const outlineShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  }
  outline.onBeforeCompile(outlineShader as never, null as never)
  assert.ok(outlineShader.vertexShader.includes('attribute vec3 outlineNormal;'))
  assert.ok(outlineShader.vertexShader.includes('uOutlineThickness'))
  assert.equal(outline.side, THREE.BackSide)

  material.dispose()
  library.dispose()
})

test('lighting reference updates reach every material through shared uniforms', () => {
  const library = createLibrary()
  const first = library.createMaterial({ color: 0xffffff, surface: 'cloth' })
  const second = library.createMaterial({ color: 0x111111, surface: 'metal' })
  const shaders = [first, second].map((material) => {
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    }
    material.onBeforeCompile(shader as never, null as never)
    return shader
  })
  library.setLightingReference({
    keyIntensity: 0.4,
    rimColor: new THREE.Color(0x102030),
  })
  for (const shader of shaders) {
    assert.equal(shader.uniforms.uBandReference.value, 0.4)
    assert.equal((shader.uniforms.uRimColor.value as THREE.Color).getHex(), 0x102030)
  }
  first.dispose()
  second.dispose()
  library.dispose()
})

test('the lighting ramp starts at zero so cast shadows survive banding', () => {
  const library = createLibrary()
  const bytes = library.rampTexture.image.data as Uint8Array
  assert.equal(bytes.length, 4)
  assert.equal(
    bytes[0],
    0,
    'a non-zero first stop would lift every shadowed fragment back into the light',
  )
  for (let index = 1; index < bytes.length; index += 1) {
    assert.ok(
      bytes[index] > bytes[index - 1],
      'ramp stops must increase monotonically',
    )
  }
  assert.equal(bytes[3], 255)
  library.dispose()
})

test('the shadow tint is normalized so a dark lighting colour cannot dim ambient', () => {
  const library = createLibrary()
  const material = library.createMaterial({ color: 0xffffff, surface: 'cloth' })
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)

  library.setLightingReference({ shadowTint: new THREE.Color(0x0a0c06) })
  const tint = shader.uniforms.uShadowTint.value as THREE.Color
  assert.ok(
    Math.max(tint.r, tint.g, tint.b) > 0.99,
    'the brightest channel must stay at full strength',
  )
  assert.ok(
    Math.min(tint.r, tint.g, tint.b) > 0.5,
    `a tint of ${tint.getHexString()} would act as a dimmer, not a tint`,
  )
  assert.ok(tint.b < tint.r, 'the source hue must still be recognizable')

  material.dispose()
  library.dispose()
})

test('outlines skip transparent, marked and instanced meshes by default', () => {
  const library = createLibrary()
  const root = new THREE.Group()
  const opaque = new THREE.Mesh(
    taperedBox({ width: 1, height: 1, depth: 1 }),
    new THREE.MeshBasicMaterial(),
  )
  opaque.name = 'torso'
  const transparent = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4 }),
  )
  const ring = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  ring.name = 'faction-ring'
  const excluded = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  excluded.userData.noComicOutline = true
  const instanced = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    4,
  )
  root.add(opaque, transparent, ring, excluded, instanced)

  const binding = library.applyOutline(root, 'enemy')
  assert.equal(binding.shells.length, 1)
  assert.equal(binding.shells[0].parent, opaque)
  assert.equal(binding.shells[0].geometry, opaque.geometry)

  const second = library.applyOutline(root, 'enemy')
  assert.equal(second.shells.length, 1, 'existing shells are never re-outlined')
  library.releaseOutline(second)

  const instancedBinding = library.applyOutline(root, 'landmark', { instanced: true })
  const instancedShell = instancedBinding.shells.find(
    (shell) => shell instanceof THREE.InstancedMesh,
  )
  assert.ok(instancedShell instanceof THREE.InstancedMesh)
  assert.equal(instancedShell.instanceMatrix, instanced.instanceMatrix)
  assert.equal(instancedShell.count, instanced.count)

  library.releaseOutline(binding)
  library.releaseOutline(instancedBinding)
  assert.equal(opaque.children.length, 0)
  library.dispose()
})

test('releasing an outline twice is safe and detaches every shell', () => {
  const library = createLibrary()
  const root = new THREE.Group()
  const opaque = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    library.acquireMaterial('release-probe', { surface: 'cloth', color: 0x223344 }),
  )
  root.add(opaque)

  const binding = library.applyOutline(root, 'enemy')
  assert.equal(binding.shells.length, 1)
  const shell = binding.shells[0]

  // This is the invariant that makes releasing before the scene sweep safe in
  // GameEngine.destroy(): a shell never owns geometry, it borrows its source's and
  // parents itself to it. Detaching a shell early therefore cannot hide a geometry
  // from the sweep — the source still carries it.
  assert.equal(shell.geometry, opaque.geometry, 'shells borrow, never own, geometry')
  assert.equal(shell.parent, opaque, 'shells parent to their source')

  library.releaseOutline(binding)
  assert.equal(shell.parent, null, 'the shell leaves the scene graph')
  assert.equal(binding.shells.length, 0, 'the binding is emptied, not left dangling')

  // GameEngine.destroy() releases bindings it may already have released via
  // unregisterOutlineRoot; the second pass must be a no-op rather than a throw.
  library.releaseOutline(binding)

  // The source keeps everything it lent out.
  assert.equal(opaque.geometry.attributes.position.count > 0, true)
  assert.equal((opaque.material as THREE.Material).userData.disposed, undefined)

  opaque.geometry.dispose()
  library.dispose()
})

test('contact shadows share one geometry, material and texture', () => {
  const library = createLibrary()
  const first = library.createContactShadow({ radius: 0.7 })
  const second = library.createContactShadow({ radius: 1.2 })
  assert.equal(first.geometry, second.geometry)
  assert.equal(first.material, second.material)
  assert.equal(StylizedArtLibrary.isLibraryOwned(first.geometry), true)
  assert.equal(first.scale.x, 0.7)
  assert.equal(second.scale.x, 1.2)
  library.dispose()
  assert.throws(() => library.createContactShadow())
})

test('contact shadow opacity is a cache key, not a per-mesh property', () => {
  const library = createLibrary()
  const defaultShadow = library.createContactShadow()
  const sameOpacity = library.createContactShadow({ opacity: 0.34 })
  const faint = library.createContactShadow({ opacity: 0.12 })
  assert.equal(defaultShadow.material, sameOpacity.material)
  assert.notEqual(defaultShadow.material, faint.material)
  const faintMaterial = faint.material as THREE.MeshBasicMaterial
  // The bug this guards: a single shared material meant the first caller's opacity
  // silently won and every later `opacity` option was discarded.
  assert.equal(faintMaterial.opacity, 0.12)
  assert.equal((defaultShadow.material as THREE.MeshBasicMaterial).opacity, 0.34)
  library.dispose()
  assert.equal(faintMaterial.opacity, 0.12)
})

test('instanced outline shells release without freeing the source matrix buffer', () => {
  const library = createLibrary()
  const source = new THREE.InstancedMesh(
    bakeOutlineNormals(taperedBox({ width: 1, height: 2, depth: 1 })),
    library.createMaterial({ color: 0x556677, surface: 'bark' }),
    6,
  )
  source.count = 4
  const root = new THREE.Group()
  root.add(source)

  const binding = library.applyOutline(root, 'landmark', { instanced: true })
  const shell = binding.shells.find((entry) => entry instanceof THREE.InstancedMesh)
  assert.ok(shell instanceof THREE.InstancedMesh)
  // Capacity, not the live count: a density control that raises `count` later must
  // still have matrices to draw from.
  assert.equal(shell.instanceMatrix.count, source.instanceMatrix.count)
  assert.equal(shell.instanceMatrix, source.instanceMatrix)

  // `onBeforeRender` is what keeps a density/LOD change from drawing stale instances.
  source.count = 2
  shell.onBeforeRender(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  )
  assert.equal(shell.count, 2)

  let sourceMatrixDisposed = false
  source.instanceMatrix.addEventListener?.('dispose', () => {
    sourceMatrixDisposed = true
  })
  library.releaseOutline(binding)
  // three.js only frees an InstancedMesh's per-object VAO from `dispose()`, so the
  // shell has to be disposed — but with its own matrix restored first, or the
  // source's shared buffer goes with it.
  assert.notEqual(shell.instanceMatrix, source.instanceMatrix)
  assert.equal(sourceMatrixDisposed, false)
  // The restored buffer is the shell's own, and it is deliberately one instance
  // rather than capacity: it never reaches the draw path, so sizing it to capacity
  // would identity-fill and discard `capacity * 16` floats per region load.
  assert.equal(shell.instanceMatrix.count, 1)
  assert.equal(shell.parent, null)
  assert.equal(root.children.length, 1)

  source.geometry.dispose()
  library.dispose()
})

test('createLod rejects distances that would make a level unreachable', () => {
  const material = new THREE.MeshBasicMaterial()
  const level = () => new THREE.BoxGeometry(1, 1, 1)
  const near = level()
  const far = level()
  assert.throws(() =>
    createLod({
      levels: [
        { geometry: near, distance: 12 },
        { geometry: far, distance: 12 },
      ],
      material,
    }),
  )
  assert.throws(() =>
    createLod({
      levels: [
        { geometry: near, distance: 0 },
        { geometry: far, distance: -20 },
      ],
      material,
    }),
  )
  assert.throws(() =>
    createLod({
      levels: [
        { geometry: near, distance: 0 },
        { geometry: far, distance: Number.NaN },
      ],
      material,
    }),
  )
  const lod = createLod({
    levels: [
      { geometry: near, distance: 0 },
      { geometry: far, distance: 30 },
    ],
    material,
  })
  assert.equal(lod.levels.length, 2)
  near.dispose()
  far.dispose()
  material.dispose()
})

test('adoptMaterial styles a caller-owned material without taking ownership', () => {
  const library = createLibrary()
  const material = new THREE.MeshStandardMaterial({ color: 0x884422 })
  const adopted = library.adoptMaterial(material, { surface: 'metal' })
  assert.equal(adopted, material)
  assert.equal(material.userData.stylizedSurfacePreset, 'metal')
  // Ownership must not move, or the engine's teardown predicate would skip a material
  // nobody else disposes.
  assert.equal(StylizedArtLibrary.isLibraryOwned(material), false)

  const before = material.onBeforeCompile
  library.adoptMaterial(material, { surface: 'stone' })
  assert.equal(
    material.userData.stylizedSurfacePreset,
    'metal',
    'adopting twice is a no-op',
  )
  assert.equal(material.onBeforeCompile, before)

  material.dispose()
  library.dispose()
  assert.throws(() => library.adoptMaterial(new THREE.MeshStandardMaterial()))
})

test('tube caps wind outward regardless of tube direction', () => {
  // Downward and horizontal tubes used to get reversed caps, which `FrontSide` culls.
  for (const points of [
    [
      [0, 4, 0],
      [0, 2, 0],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [2, 1, 0],
      [4, 1, 0],
    ],
  ] as const) {
    const geometry = tubeAlongPoints(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      { radius: 0.4, radialSegments: 6, caps: true },
    )
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const index = geometry.getIndex()
    assert.ok(index === null || index.count > 0)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const stored = new THREE.Vector3()
    const edge1 = new THREE.Vector3()
    const edge2 = new THREE.Vector3()
    const face = new THREE.Vector3()
    const triangles = index ? index.count / 3 : position.count / 3
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      const i0 = index ? index.getX(triangle * 3) : triangle * 3
      const i1 = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
      const i2 = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
      a.fromBufferAttribute(position, i0)
      b.fromBufferAttribute(position, i1)
      c.fromBufferAttribute(position, i2)
      face.copy(edge1.subVectors(b, a)).cross(edge2.subVectors(c, a))
      if (face.lengthSq() < 1e-12) continue
      face.normalize()
      stored.fromBufferAttribute(normal, i0)
      if (stored.lengthSq() < 1e-12) continue
      assert.ok(
        face.dot(stored.normalize()) > 0,
        'every triangle must wind to agree with its own vertex normal',
      )
    }
    geometry.dispose()
  }
})


/**
 * The tube test above only ever covered `tubeAlongPoints`. `loftProfile` is the
 * workhorse under tapered boxes, capsules, trunks, roofs and most actor parts,
 * and it shipped wound inside-out: every triangle's winding opposed its own
 * outward normal, so `FrontSide` drew the far wall of every solid and the
 * `BackSide` ink shell drew in front of the mesh instead of behind it.
 */
test('every geometry-kit builder winds to agree with its normals', () => {
  const disagreements = (geometry: THREE.BufferGeometry): number => {
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const index = geometry.getIndex()
    const count = index ? index.count : position.count
    const at = (i: number): number => (index ? index.getX(i) : i)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const edge1 = new THREE.Vector3()
    const edge2 = new THREE.Vector3()
    const wind = new THREE.Vector3()
    const stored = new THREE.Vector3()
    const corner = new THREE.Vector3()
    let bad = 0
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      const indices = [at(triangle), at(triangle + 1), at(triangle + 2)]
      a.fromBufferAttribute(position, indices[0])
      b.fromBufferAttribute(position, indices[1])
      c.fromBufferAttribute(position, indices[2])
      wind.crossVectors(edge1.subVectors(b, a), edge2.subVectors(c, a))
      if (wind.lengthSq() < 1e-14) continue
      stored.set(0, 0, 0)
      for (const i of indices) {
        corner.fromBufferAttribute(normal, i)
        stored.add(corner)
      }
      if (stored.lengthSq() < 1e-14) continue
      if (wind.dot(stored) <= 0) bad += 1
    }
    return bad
  }

  // Pins the convention: three.js's own builders are correct by definition, so
  // if a control ever fails the assertion is wrong, not the geometry kit.
  // A box alone is the weakest possible control — every face is an axis-aligned
  // plane, so it exercises none of the curved walls, tapered sides or triangle-fan
  // caps this kit actually emits. The cone contributes a fan cap and a tapered
  // wall, the sphere curved quads and degenerate pole triangles, the cylinder fan
  // caps at both ends. Between them they cover every topology the builders below
  // produce, so a convention error cannot hide in a shape three.js does not make.
  const controls: [string, THREE.BufferGeometry][] = [
    ['BoxGeometry', new THREE.BoxGeometry(1, 1, 1)],
    ['ConeGeometry', new THREE.ConeGeometry(0.5, 1, 8)],
    ['SphereGeometry', new THREE.SphereGeometry(0.5, 12, 8)],
    ['CylinderGeometry', new THREE.CylinderGeometry(0.5, 0.7, 1, 8)],
  ]
  for (const [name, control] of controls) {
    assert.equal(disagreements(control), 0, `${name} control must agree`)
    control.dispose()
  }

  const cases: [string, THREE.BufferGeometry][] = [
    [
      'loft faceted',
      loftProfile({
        profile: polygonProfile(1, 12),
        sections: [
          { y: 0, scaleX: 1 },
          { y: 1, scaleX: 0.8 },
          { y: 2, scaleX: 0.3 },
        ],
      }),
    ],
    [
      'loft smooth',
      loftProfile({
        profile: polygonProfile(1, 10),
        sections: [
          { y: 0, scaleX: 1 },
          { y: 1.5, scaleX: 0.6 },
        ],
        smooth: true,
      }),
    ],
    [
      'loft rect bevelled',
      loftProfile({
        profile: rectProfile(1, 1, 0.15),
        sections: [
          { y: 0, scaleX: 1 },
          { y: 1, scaleX: 0.7 },
        ],
      }),
    ],
    ['tapered box', taperedBox({ width: 1, height: 2, depth: 1, topScale: 0.6 })],
    ['stylized capsule', stylizedCapsule({ radius: 0.4, height: 1.2 })],
    ['lathe', latheProfile([
      { x: 0.05, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0.3, y: 1 },
    ])],

    // The rest of the family. The invariant is only worth what it covers, and the
    // sibling sessions have a standing instruction to add their builders here — so
    // every producer in the kit must already be represented, or the instruction
    // reads as "add yours to this list of six".
    ['extrude', extrudeProfile(
      [
        { x: -0.5, y: -0.3 },
        { x: 0.5, y: -0.3 },
        { x: 0.6, y: 0.2 },
        { x: 0, y: 0.6 },
        { x: -0.6, y: 0.2 },
      ],
      { depth: 0.35, centered: true },
    )],
    ['tube body faceted', tubeAlongPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0.3, y: 0.7, z: 0.15 },
        { x: 0.1, y: 1.5, z: -0.25 },
      ],
      { radius: 0.18, radialSegments: 6, caps: true },
    )],
    ['tube body smooth', tubeAlongPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: -0.4, y: 0.6, z: 0.2 },
        { x: 0.2, y: 1.3, z: 0.4 },
      ],
      { radius: (t) => 0.2 * (1 - t) + 0.04, radialSegments: 7, smooth: true },
    )],
    // The one most likely to be extended by someone who is not me: the spec points
    // both sibling sessions at this for trees, roots, driftwood, antlers and tails.
    ['branch structure', branchStructure({
      variation: artVariation(20260727, 'winding:branch'),
      height: 2.4,
      baseRadius: 0.2,
      branchCount: 3,
      depth: 2,
      radialSegments: 5,
    })],
    ['displaced', displaceGeometry(
      taperedBox({ width: 1, height: 1.4, depth: 1, topScale: 0.8, segments: 3 }),
      { seed: 7, amplitude: 0.12, frequency: 1.7 },
    )],
    ['faceted', facetGeometry(stylizedCapsule({ radius: 0.35, height: 0.9 }))],
    ['transformed', transformed(
      taperedBox({ width: 0.8, height: 1.6, depth: 0.6, topScale: 0.5 }),
      { rotation: { x: 0.6, y: -1.1, z: 0.35 }, scale: { x: 1.3, y: 0.7, z: 1 } },
    )],
    ['merged', mergeAll([
      taperedBox({ width: 1, height: 1, depth: 1 }),
      transformed(latheProfile([
        { x: 0.05, y: 0 },
        { x: 0.4, y: 0.4 },
        { x: 0.1, y: 0.9 },
      ]), { position: { x: 0, y: 1, z: 0 } }),
    ])],

    // Adversarial loft parameters none of the shape cases above reach. A twist or a
    // shear is exactly where a naive side-quad diagonal flips sign.
    ['loft twisted', loftProfile({
      profile: polygonProfile(0.6, 7),
      sections: [
        { y: 0, scaleX: 1 },
        { y: 0.8, scaleX: 0.9, rotation: 0.9 },
        { y: 1.6, scaleX: 0.7, rotation: 1.8 },
      ],
    })],
    ['loft sheared', loftProfile({
      profile: rectProfile(0.8, 0.8),
      sections: [
        { y: 0, scaleX: 1 },
        { y: 1, scaleX: 0.9, offsetX: 0.5, offsetZ: -0.35 },
      ],
    })],
    ['loft tapered to a point', loftProfile({
      profile: polygonProfile(0.7, 9),
      sections: [
        { y: 0, scaleX: 1 },
        { y: 1.2, scaleX: 0.02 },
      ],
    })],
    ['loft anisotropic', loftProfile({
      profile: polygonProfile(0.5, 8),
      sections: [
        { y: 0, scaleX: 1.4, scaleZ: 0.5 },
        { y: 1, scaleX: 0.4, scaleZ: 1.5 },
      ],
    })],
    ['loft uncapped', loftProfile({
      profile: polygonProfile(0.5, 6),
      sections: [
        { y: 0, scaleX: 1 },
        { y: 1, scaleX: 0.8 },
      ],
      capBottom: false,
      capTop: false,
    })],
    ['loft triangular', loftProfile({
      profile: polygonProfile(0.6, 3),
      sections: [
        { y: 0, scaleX: 1 },
        { y: 1, scaleX: 0.5 },
      ],
    })],
  ]

  for (const [label, geometry] of cases) {
    assert.equal(
      disagreements(geometry),
      0,
      `${label} must wind to agree with its normals`,
    )
    geometry.dispose()
  }
})

/**
 * The test above compares winding against the geometry's own stored normals, which
 * is exactly the check that caught the shipped loft inversion. It has one blind
 * spot: a builder that flipped its normals *and* its winding together would agree
 * with itself and pass. This one never reads the normal attribute — for a closed
 * body every face must point away from the centroid — so the two together pin the
 * absolute orientation rather than merely internal consistency.
 */
test('closed builders wind outward, independently of their normals', () => {
  const inwardFaces = (geometry: THREE.BufferGeometry): number => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry
    const position = source.getAttribute('position')
    const centroid = new THREE.Vector3()
    for (let i = 0; i < position.count; i += 1) {
      centroid.x += position.getX(i)
      centroid.y += position.getY(i)
      centroid.z += position.getZ(i)
    }
    centroid.divideScalar(position.count)

    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const edge1 = new THREE.Vector3()
    const edge2 = new THREE.Vector3()
    const wind = new THREE.Vector3()
    const outward = new THREE.Vector3()
    let inward = 0
    for (let triangle = 0; triangle + 2 < position.count; triangle += 3) {
      a.fromBufferAttribute(position, triangle)
      b.fromBufferAttribute(position, triangle + 1)
      c.fromBufferAttribute(position, triangle + 2)
      wind.crossVectors(edge1.subVectors(b, a), edge2.subVectors(c, a))
      if (wind.lengthSq() < 1e-14) continue
      outward.copy(a).add(b).add(c).divideScalar(3).sub(centroid)
      if (outward.lengthSq() < 1e-14) continue
      if (wind.dot(outward) <= 0) inward += 1
    }
    if (source !== geometry) source.dispose()
    return inward
  }

  // Same control set as the relative test, and valid here for the same reason:
  // every one of these is star-convex about its own centroid, so "away from the
  // centroid" is well defined for each. A box alone would leave the fan caps and
  // curved walls this test's real cases are made of entirely uncalibrated.
  const controls: [string, THREE.BufferGeometry][] = [
    ['BoxGeometry', new THREE.BoxGeometry(1, 1, 1)],
    ['ConeGeometry', new THREE.ConeGeometry(0.5, 1, 8)],
    ['SphereGeometry', new THREE.SphereGeometry(0.5, 12, 8)],
    ['CylinderGeometry', new THREE.CylinderGeometry(0.5, 0.7, 1, 8)],
  ]
  for (const [name, control] of controls) {
    assert.equal(inwardFaces(control), 0, `${name} control must wind outward`)
    control.dispose()
  }

  const cases: [string, THREE.BufferGeometry][] = [
    ['loft rect', loftProfile({
      profile: rectProfile(1, 1),
      sections: [{ y: -0.5 }, { y: 0.5 }],
    })],
    ['loft polygon', loftProfile({
      profile: polygonProfile(0.5, 8),
      sections: [{ y: -0.5 }, { y: 0.5 }],
    })],
    ['tapered box', taperedBox({ width: 1, height: 1, depth: 1 })],
    ['bevelled box', taperedBox({ width: 1, height: 1, depth: 1, bevel: 0.15 })],
    ['stylized capsule', stylizedCapsule({ radius: 0.4, height: 1 })],
    ['tube upward', tubeAlongPoints(
      [{ x: 0, y: -0.5, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0.5, z: 0 }],
      { radius: 0.2 },
    )],
    ['tube downward', tubeAlongPoints(
      [{ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: -0.5, z: 0 }],
      { radius: 0.2 },
    )],
  ]

  for (const [label, geometry] of cases) {
    assert.equal(inwardFaces(geometry), 0, `${label} must wind outward`)
    geometry.dispose()
  }
})

/**
 * `dispose: false` promises the inputs survive. It used to mean "survive, modified":
 * a non-indexed part was passed through by reference and then had a white `color`
 * or a synthesised `outlineNormal` written onto it, which renders the caller's
 * geometry white and changes which outline material it resolves to.
 */
test('mergeAll with dispose:false leaves the caller geometries untouched', () => {
  const coloured = taperedBox({ width: 1, height: 1, depth: 1 })
  const vertexCount = coloured.getAttribute('position').count
  coloured.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 3).fill(0.25), 3),
  )
  const plain = taperedBox({ width: 1, height: 1, depth: 1 })

  const merged = mergeAll([coloured, plain], { dispose: false })

  assert.equal(
    plain.getAttribute('color'),
    undefined,
    'a kept input must not be given a colour attribute',
  )
  assert.equal(
    hasOutlineNormals(plain),
    false,
    'a kept input must not be given outline normals',
  )
  assert.ok(plain.getAttribute('position'), 'a kept input must not be disposed')
  assert.ok(merged.getAttribute('color'), 'the merge itself still reconciles colour')

  const single = mergeAll([plain], { dispose: false })
  assert.notEqual(single, plain, 'a kept single part must come back as a copy')

  single.dispose()
  merged.dispose()
  plain.dispose()
  coloured.dispose()
})

/**
 * `applyMatrix4` transforms `position`, `normal` and `tangent`. Baked ink normals
 * are a custom attribute, so a rotated part used to keep them in the old frame and
 * extrude its shell sideways into the mesh it should be haloing.
 */
test('transformed carries baked outline normals through a rotation', () => {
  const geometry = taperedBox({ width: 1, height: 2, depth: 1 })
  bakeOutlineNormals(geometry)

  const before = new THREE.Vector3().fromBufferAttribute(
    geometry.getAttribute(OUTLINE_NORMAL_ATTRIBUTE) as THREE.BufferAttribute,
    0,
  )
  const expected = before
    .clone()
    .applyEuler(new THREE.Euler(0, Math.PI / 2, 0))
    .normalize()

  transformed(geometry, { rotation: { x: 0, y: Math.PI / 2, z: 0 } })

  const after = new THREE.Vector3().fromBufferAttribute(
    geometry.getAttribute(OUTLINE_NORMAL_ATTRIBUTE) as THREE.BufferAttribute,
    0,
  )
  assert.ok(
    after.distanceTo(expected) < 1e-5,
    `outline normal must follow the rotation: ${after.toArray().join(',')} vs ${expected.toArray().join(',')}`,
  )
  geometry.dispose()
})

/**
 * `docs/08` is the contract two sibling sessions code against, and it has already
 * drifted from the barrel twice. This does not prove the prose is right, but it
 * does make any change to the public surface a deliberate, reviewable act.
 */
test('the public barrel exports exactly the documented surface', async () => {
  const art = await import('../src/game/art/index.ts')
  const expected = [
    'GeometryCache',
    'OUTLINE_NORMAL_ATTRIBUTE',
    'StylizedArtLibrary',
    'artNoiseSeed',
    'artVariation',
    'bakeOutlineNormals',
    'bakeSkyOcclusion',
    'bakeVerticalOcclusion',
    'branchStructure',
    'clearLod',
    'createArtStream',
    'createLod',
    'displaceGeometry',
    'ensureVertexColors',
    'extrudeProfile',
    'facetGeometry',
    'fbm3',
    'gradientVertexColors',
    'hasOutlineNormals',
    'hasStylizedShader',
    'hashInt3',
    'hashUnit',
    'hashUnit3',
    'latheProfile',
    'loftProfile',
    'mergeAll',
    'paintVertexColors',
    'polygonProfile',
    'rectProfile',
    'ridgeNoise3',
    'stylizedCapsule',
    'taperedBox',
    'transformed',
    'tubeAlongPoints',
    'valueNoise3',
    'wrapArtVariation',
  ]
  assert.deepEqual(
    Object.keys(art).sort(),
    expected,
    'update docs/08 §5 and this list together when the art surface changes',
  )
})

test('a cloned stylized material is repairable and cannot forge ownership', () => {
  const library = createLibrary()
  const shared = library.acquireMaterial('clone-source', {
    surface: 'cloth',
    color: 0x884422,
  })
  assert.equal(hasStylizedShader(shared), true)
  assert.equal(StylizedArtLibrary.isLibraryOwned(shared), true)

  // `Material.copy()` deep-clones userData through JSON but copies neither the
  // ownership symbol nor `onBeforeCompile`.
  const clone = shared.clone()
  assert.equal(
    hasStylizedShader(clone),
    false,
    'a clone loses the injection, so it must not claim to have it',
  )
  assert.equal(
    StylizedArtLibrary.isLibraryOwned(clone),
    false,
    'a clone must not inherit library ownership or teardown would skip it forever',
  )

  // The preset label *does* survive, because userData is deep-copied through JSON.
  // That is the trap: a clone advertises `stylizedSurfacePreset: 'cloth'` while
  // carrying no injection at all. The label is for humans reading a debugger; the
  // only sound question is hasStylizedShader().
  assert.equal(clone.userData.stylizedSurfacePreset, 'cloth')
  assert.equal(hasStylizedShader(clone), false)

  library.adoptMaterial(clone, { surface: 'cloth' })
  assert.equal(hasStylizedShader(clone), true, 'adoptMaterial must repair a clone')
  assert.equal(
    StylizedArtLibrary.isLibraryOwned(clone),
    false,
    'repairing does not transfer ownership',
  )

  // `clone()` and `copy()` are not the only ways to derive a material. Both copy
  // own *enumerable* symbol keys, so the ownership marker has to be hidden from
  // enumeration rather than merely un-nameable — otherwise the derivative claims
  // ownership, teardown skips it, and it leaks silently for the life of the page.
  const assigned = Object.assign(new THREE.MeshStandardMaterial(), shared)
  const spread = Object.assign(
    new THREE.MeshStandardMaterial(),
    { ...(shared as unknown as Record<string, unknown>) },
  )
  for (const [name, derived] of [
    ['Object.assign', assigned],
    ['spread', spread],
  ] as const) {
    assert.equal(
      StylizedArtLibrary.isLibraryOwned(derived),
      false,
      `${name} must not inherit library ownership`,
    )
  }

  // The shader flag is deliberately the opposite: it stays enumerable because the
  // thing it tracks, `onBeforeCompile`, is an own enumerable property too. Both
  // travel under Object.assign and neither survives clone(), so the flag never
  // disagrees with reality. Hiding it would leave assign-derived materials carrying
  // the injection while reporting none, and adoptMaterial would inject twice.
  for (const [name, derived] of [
    ['Object.assign', assigned],
    ['spread', spread],
  ] as const) {
    assert.equal(
      hasStylizedShader(derived),
      derived.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile,
      `${name} must keep the shader flag and the injection in agreement`,
    )
    derived.dispose()
  }

  // Granting ownership deliberately still works, and stays idempotent.
  const adopted = new THREE.MeshStandardMaterial()
  StylizedArtLibrary.markLibraryOwned(adopted)
  StylizedArtLibrary.markLibraryOwned(adopted)
  assert.equal(StylizedArtLibrary.isLibraryOwned(adopted), true)
  adopted.dispose()

  clone.dispose()
  library.dispose()
})

test('every factory refuses to produce resources after disposal', () => {
  const library = createLibrary()
  library.dispose()
  assert.throws(() => library.createMaterial({ surface: 'cloth', color: 0x112233 }))
  assert.throws(() => library.acquireMaterial('late', { surface: 'cloth', color: 0x112233 }))
  assert.throws(() => library.adoptMaterial(new THREE.MeshStandardMaterial()))
  assert.throws(() => library.getOutlineMaterial('player', false))
  assert.throws(() => library.applyOutline(new THREE.Group(), 'player'))
  // Idempotent second dispose must stay a no-op.
  library.dispose()
})

test('facetGeometry leaves its input alone unless asked to consume it', () => {
  const source = taperedBox({ width: 1, height: 1, depth: 1 })
  const sourceNormals = source.getAttribute('normal').array.slice()
  const faceted = facetGeometry(source)
  assert.notEqual(faceted, source, 'a faceted result must be a separate geometry')
  assert.deepEqual(
    Array.from(source.getAttribute('normal').array),
    Array.from(sourceNormals),
    'the input normals must not be recomputed in place',
  )
  assert.ok(source.getAttribute('position').count > 0, 'the input must stay usable')
  faceted.dispose()

  const consumed = taperedBox({ width: 1, height: 1, depth: 1 })
  const moved = facetGeometry(consumed, { dispose: true })
  assert.notEqual(moved, consumed)
  moved.dispose()
  source.dispose()
})
