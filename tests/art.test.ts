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
  fbm3,
  hasOutlineNormals,
  latheProfile,
  mergeAll,
  stylizedCapsule,
  taperedBox,
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
