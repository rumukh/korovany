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
  assert.equal(material.userData.stylizedSurface, 'metal')
  // Ownership must not move, or the engine's teardown predicate would skip a material
  // nobody else disposes.
  assert.equal(StylizedArtLibrary.isLibraryOwned(material), false)

  const before = material.onBeforeCompile
  library.adoptMaterial(material, { surface: 'stone' })
  assert.equal(material.userData.stylizedSurface, 'metal', 'adopting twice is a no-op')
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
  // if this control ever fails the assertion is wrong, not the geometry kit.
  const control = new THREE.BoxGeometry(1, 1, 1)
  assert.equal(disagreements(control), 0, 'BoxGeometry control must agree')
  control.dispose()

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

  library.adoptMaterial(clone, { surface: 'cloth' })
  assert.equal(hasStylizedShader(clone), true, 'adoptMaterial must repair a clone')
  assert.equal(
    StylizedArtLibrary.isLibraryOwned(clone),
    false,
    'repairing does not transfer ownership',
  )

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
