import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'
import * as artBarrel from '../src/game/art/index.ts'
import type { LoftSection } from '../src/game/art/index.ts'
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
 * `docs/08` §7 sets `ART_LIBRARY_MATERIALS<=24`, and until now nothing checked it.
 * Two sibling sessions are adding surfaces against that ceiling, so this pins both
 * the limit and the headroom: the library's own worst case is every outline kind in
 * both variants plus a contact shadow, and whatever is left is Wave 2's to spend.
 *
 * The ceiling was 12 and left 3 shared slots for two sessions, which is not a
 * budget either could live inside. The number is not the valuable half of this
 * test — the enforcement is. What actually costs frames is per-mesh materials and
 * shader-program churn, and "one material per surface, never per mesh" already
 * prevents that. If the combined total ever approaches 24, treat it as a design
 * smell to review rather than a number to raise again.
 *
 * The ceiling appears once, below. It used to be spelled out three times and one
 * of the three was missed when the number changed, which is exactly the failure
 * this binding prevents.
 */
test('the library stays inside its documented material budget', () => {
  // Single source of truth, and it must match `docs/08` §7.
  const ART_LIBRARY_MATERIALS = 24

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
    worstCase <= ART_LIBRARY_MATERIALS,
    `ART_LIBRARY_MATERIALS is ${String(ART_LIBRARY_MATERIALS)}; `
    + `the library itself uses ${String(worstCase)}`,
  )

  // Contact shadows share one material per distinct opacity, and the world only
  // ever asks for the default — CONTACT_SHADOW_MATERIALS<=4 has room to spare.
  const second = library.createContactShadow()
  assert.equal(second.material, shadow.material, 'contact shadows share a material')
  assert.equal(library.libraryOwnedMaterialCount, worstCase)

  // Shared surfaces count against the same ceiling. Spending the headroom exactly
  // proves the number the spec advertises to Wave 2 is really available, rather
  // than trusting the subtraction: fill every remaining slot and land on the
  // ceiling precisely.
  const headroom = ART_LIBRARY_MATERIALS - worstCase
  assert.equal(headroom, 15, 'the spec promises Wave 2 fifteen shared slots')
  for (let index = 0; index < headroom; index += 1) {
    library.acquireMaterial(`wave2-${String(index)}`, {
      color: 0x808080,
      surface: 'cloth',
    })
  }
  assert.equal(library.libraryOwnedMaterialCount, ART_LIBRARY_MATERIALS)

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

/**
 * `outlineProjection` hand-mirrors three's `defaultnormal_vertex`: an instanced normal
 * has to be divided by the squared basis lengths *before* the basis multiply, because
 * `mat3( instanceMatrix )` is the vertex transform rather than its inverse transpose. Get
 * it wrong and a non-uniformly scaled instance skews its own ink until the hull creeps
 * inside the source — a geometric failure that no test of ours would notice, because both
 * the shell and the source keep rendering.
 *
 * A mirror of a dependency looks unpinnable from inside the repo, since both sides of the
 * comparison seem to be ours. They are not: three ships the chunk as an importable string,
 * so the upstream half can be asserted directly against the installed version.
 *
 * This pins the *behaviour*, not the version number. A bump that leaves the
 * inverse-transpose handling alone stays green; one that changes it goes red, which is the
 * only bump that should. A `REVISION === '185'` assertion would fail on every release and
 * be silenced by the first person to bump it — precisely the drift it was meant to catch.
 *
 * If the dependency half goes red, `outlineProjection` must be re-derived against whatever
 * replaced the chunk. It must not be "fixed" to match these assertions.
 */
test('the instanced outline normal mirrors three, and three still does what it mirrors', () => {
  const library = createLibrary()
  const outline = library.getOutlineMaterial('enemy', true)
  const outlineShader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  }
  outline.onBeforeCompile(outlineShader as never, null as never)

  // Our half.
  const ours = outlineShader.vertexShader
  assert.ok(
    /kInstanceScaleSq\s*=\s*vec3\(\s*dot\(\s*kInstanceBasis\[\s*0\s*\]/.test(
      ours.replace(/\s+/g, ' '),
    ),
    'the outline must build the squared basis lengths it divides by',
  )
  assert.ok(
    /kOutlineNormal = kInstanceBasis \* \( kOutlineNormal \/ max\( kInstanceScaleSq/.test(
      ours.replace(/\s+/g, ' '),
    ),
    'the instanced outline normal must be divided by the squared lengths before the basis multiply',
  )

  // The dependency half: this is three's own chunk, not ours.
  const chunk = THREE.ShaderChunk.defaultnormal_vertex
  const at = chunk.indexOf('#ifdef USE_INSTANCING')
  assert.ok(at >= 0, 'defaultnormal_vertex must still branch on USE_INSTANCING')
  // Sliced forward so the USE_BATCHING block above cannot satisfy these by accident.
  const instancing = chunk.slice(at).replace(/\s+/g, ' ')
  assert.ok(
    /transformedNormal \/= vec3\( dot\( im\[ 0 \], im\[ 0 \] \)/.test(instancing),
    'three still divides the instanced normal by its squared basis lengths; if this is ' +
      'red, re-derive outlineProjection against the new chunk rather than editing this test',
  )
  assert.ok(
    /transformedNormal = im \* transformedNormal/.test(instancing),
    'three still multiplies by the instance basis after the division',
  )

  library.dispose()
})

/**
 * The band driver divides the albedo back out of `directDiffuse`. Since three 0.185
 * that accumulator carries `material.diffuseContribution`, which is
 * `diffuseColor * (1 - metalness)`, so the metalness factor has to be divided back
 * out too or it silently scales the driver.
 *
 * Shipped behaviour before the fix: metal (metalness 0.35) peaked at 0.65, so it
 * could never reach the top band at any key intensity, and every band boundary was
 * crossed 53.8% late. Metalness-0 presets were exact, which is why it survived.
 *
 * The second half pins the *dependency* identity rather than our own text. The
 * original comment asserted `directDiffuse == ... * diffuseColor / PI`, which was
 * true of an older three and never of the pinned one. A three upgrade that moves
 * this back — or renames the field — must fail here rather than quietly re-break
 * metal, because nothing else in this suite reads the shader body at all.
 */
test('the toon band driver divides the metalness factor back out', () => {
  const library = createLibrary()
  const material = library.createMaterial({ color: 0xffffff, surface: 'metal' })
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)

  const driver = shader.fragmentShader
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
  assert.ok(
    /material\.metalness/.test(driver),
    'the band driver must compensate for the metalness factor baked into directDiffuse',
  )
  assert.ok(
    /kLit\s*=[^;]*\/\s*kDiffuseScale/.test(driver),
    'kLit must divide by the compensated scale, not by the raw albedo luminance',
  )

  // The dependency half: these are three's own chunks, not ours.
  const pars = THREE.ShaderChunk.lights_physical_pars_fragment
  const setup = THREE.ShaderChunk.lights_physical_fragment
  assert.ok(
    /struct PhysicalMaterial \{[^}]*\bfloat metalness;/.test(pars),
    'PhysicalMaterial must still declare metalness for the compensation to compile',
  )
  assert.ok(
    /material\.metalness\s*=\s*metalnessFactor/.test(setup),
    'material.metalness must still be the same scalar baked into diffuseContribution',
  )
  assert.ok(
    /material\.diffuseContribution\s*=\s*diffuseColor\.rgb\s*\*\s*\(\s*1\.0\s*-\s*metalnessFactor\s*\)/
      .test(setup),
    'directDiffuse still carries (1 - metalness); if three drops this, remove the divisor',
  )
  assert.ok(
    /directDiffuse \+= irradiance \* BRDF_Lambert\( material\.diffuseContribution \)/
      .test(THREE.ShaderChunk.lights_physical_pars_fragment),
    'RE_Direct_Physical must still accumulate the contribution rather than diffuseColor',
  )

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

test('a teardown sweep can identify a shell without knowing its binding', () => {
  const library = createLibrary()
  const root = new THREE.Group()
  const source = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    library.acquireMaterial('sweep-probe', { surface: 'stone', color: 0x445566 }),
    6,
  )
  root.add(source)

  const binding = library.applyOutline(root, 'landmark', { instanced: true })
  assert.equal(binding.shells.length, 1)
  const shell = binding.shells[0]

  // The hazard this guards: an instanced shell's `instanceMatrix` IS the source's,
  // so a sweep that calls `InstancedMesh.dispose()` on it frees a buffer the source
  // still draws from — silent corruption, not a throw. A sweep cannot see bindings,
  // so it needs a way to recognise a shell and decline.
  assert.equal(shell instanceof THREE.InstancedMesh, true)
  assert.equal(
    (shell as THREE.InstancedMesh).instanceMatrix,
    source.instanceMatrix,
    'the shell borrows the source matrix, which is what makes a bare dispose unsafe',
  )
  assert.equal(StylizedArtLibrary.isOutlineShell(shell), true, 'shells are identifiable')
  assert.equal(
    StylizedArtLibrary.isOutlineShell(source),
    false,
    'a source must stay sweepable',
  )
  assert.equal(StylizedArtLibrary.isOutlineShell(root), false)

  library.releaseOutline(binding)
  assert.equal(
    source.instanceMatrix.count > 0,
    true,
    'releasing the shell leaves the source buffer intact',
  )

  source.geometry.dispose()
  source.dispose()
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
  //
  // This test spent its whole life checking zero cap triangles. It passed
  // `{ caps: true }` — an option `TubeOptions` does not have, so it was silently
  // dropped and every tube here was built UNCAPPED. Measured: `{ caps: true }` yields
  // 96 triangles, exactly what passing no options yields; `capStart`/`capEnd` yields
  // 108. The twelve triangles this test exists to check were the twelve it never built.
  //
  // It was invisible because `tests/` is not in `tsconfig.app.json`'s `include`, so no
  // type-check has ever read this file, and `--experimental-strip-types` strips types
  // without checking them. A typo in an option name is exactly what a type-checker is
  // for, and there wasn't one here. See the population guard below: a wrong option name
  // now shows up as missing geometry rather than as a quieter test.
  const capCounts = new Set<number>()
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
      { radius: 0.4, radialSegments: 6, capStart: true, capEnd: true },
    )
    // The caps must actually exist, measured against the same tube without them. A
    // bare count would pin a shape; a difference pins that the option did something,
    // whatever the segment count.
    const bare = tubeAlongPoints(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      { radius: 0.4, radialSegments: 6 },
    )
    const capTriangles = geometry.getAttribute('position').count
      - bare.getAttribute('position').count
    capCounts.add(capTriangles)
    bare.dispose()
    assert.ok(
      capTriangles > 0,
      'this tube was built with no cap geometry, so the winding check below walks only '
      + 'the wall and the test cannot fail at the thing it is named for',
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
  // Every direction must have produced caps, and the same amount of them — one
  // orientation silently losing its caps is the failure this test was written for, and
  // a per-tube `> 0` alone would not see it.
  assert.equal(
    capCounts.size,
    1,
    'the tube directions produced different cap vertex counts '
    + `(${[...capCounts].join(', ')}), so at least one is not capped like the others`,
  )
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

  // Five entries below cannot fail this assertion, and are kept anyway because this
  // list doubles as the "every producer is represented" roster the siblings extend.
  // `extrude`, `displaced`, `faceted`, `merged` and `composed prop` all end in
  // `computeVertexNormals()`, which derives the normals *from* the winding, so the two
  // sides of this comparison stop being independent and agree by construction.
  // Measured: reversing a capsule gives 236 disagreements, and a bare
  // `computeVertexNormals()` — no displacement needed — launders it straight back to 0.
  // Their real coverage is `NORMAL_DERIVED_CASES` in the signed-volume test below.
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
      { radius: 0.18, radialSegments: 6, capStart: true, capEnd: true },
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
    // Fully collapsed sections, which `loft tapered to a point` above only
    // approaches. The lower-ring cases shipped with wrong normals: the face normal
    // was crossed against the LOWER ring's tangential edge, so collapsing that ring
    // zeroed it and every face above fell through to a fixed (0,1,0). Upward spikes
    // were always fine, which is why this needs both directions to say anything —
    // one of them passes on the broken code.
    ['loft collapsed lower ring (spike down)', loftProfile({
      profile: polygonProfile(0.6, 8),
      sections: [
        { y: 0, scaleX: 0 },
        { y: 1, scaleX: 1 },
      ],
    })],
    ['loft collapsed upper ring (spike up)', loftProfile({
      profile: polygonProfile(0.6, 8),
      sections: [
        { y: 0, scaleX: 1 },
        { y: 1, scaleX: 0 },
      ],
    })],
    // Position-independent: a pinch in the middle of the list fires it on the faces
    // immediately above, so this is not a "first section" special case.
    ['loft mid-list pinch (hourglass)', loftProfile({
      profile: polygonProfile(0.6, 8),
      sections: [
        { y: 0, scaleX: 1 },
        { y: 1, scaleX: 0 },
        { y: 2, scaleX: 1 },
      ],
    })],
    ['tapered box bottomScale 0', taperedBox({
      width: 1, height: 2, depth: 1, bottomScale: 0,
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

    // Composition, not construction. Every case above is one builder's output; a
    // real prop is several merged together, and `mergeAll` normalises attributes
    // and concatenates buffers across parts that need not agree with each other.
    // Adopted from the world-object session, which reaches a case none of the
    // builder-level entries do.
    ['composed prop (lathe + loft + tapered box)', mergeAll([
      latheProfile([
        { x: 0.05, y: 0 },
        { x: 0.4, y: 0.3 },
        { x: 0.25, y: 0.7 },
      ], { segments: 10 }),
      loftProfile({
        profile: rectProfile(0.4, 0.4),
        sections: [
          { y: 0, scaleX: 1 },
          { y: 0.6, scaleX: 0.5, scaleZ: 0.5 },
        ],
      }),
      taperedBox({ width: 0.3, height: 0.5, depth: 0.3, topScale: 0.6 }),
    ], { name: 'composed-prop' })],

    // A mirror reflects positions but leaves vertex order alone, so without an
    // explicit reversal `transformed` turns any part inside-out — 100% of
    // triangles, not a subtle few. Both storage paths, because `reverseWinding`
    // reorders an index buffer but has to swap every attribute in step when there
    // is none. Making a left/right pair this way is the obvious thing to reach for.
    ['mirrored tapered box (non-indexed)', transformed(
      taperedBox({ width: 0.6, height: 1, depth: 0.4, topScale: 0.7 }),
      { scale: { x: -1, y: 1, z: 1 } },
    )],
    ['mirrored lathe (indexed)', transformed(
      latheProfile([
        { x: 0.05, y: 0 },
        { x: 0.4, y: 0.3 },
        { x: 0.25, y: 0.7 },
      ], { segments: 12 }),
      { scale: { x: -1, y: 1, z: 1 } },
    )],
    // Determinant, not "any negative component": two mirrored axes compose back
    // into a rotation and must NOT be reversed.
    ['doubly mirrored tapered box (det > 0)', transformed(
      taperedBox({ width: 0.6, height: 1, depth: 0.4 }),
      { scale: { x: -1, y: -1, z: 1 } },
    )],
  ]

  // Pins that this kit's own case list keeps an indexed member. Every builder here
  // emits non-indexed geometry except `latheProfile`, which passes through
  // `THREE.LatheGeometry`. The `BoxGeometry` control above happens to be indexed too,
  // so the helper's index dereference is already covered — but a checker that walks
  // raw position triples and ignores the index buffer reads `latheProfile` as
  // *partially* reversed (7 of 15 pseudo-triangles here) while reading the loft
  // family correctly, which looks like a builder bug and is not one. Keep an indexed
  // case so that asymmetry stays visible in the builder list, not just the controls.
  assert.ok(
    cases.some(([, geometry]) => geometry.getIndex() !== null),
    'at least one case must be indexed, or the index path is never tested',
  )

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
 * The test above is a SIGN test: it asks which side of zero `wind · normal` falls
 * on. That is enough to catch a full inversion and blind to everything short of
 * one — a normal can be 72 degrees wrong and still have a positive dot product.
 *
 * That is not hypothetical. `loftProfile` crossed its face normal against the
 * LOWER ring's tangential edge, so any collapsed lower section zeroed it and every
 * face above took the `(0, 1, 0)` fallback. On faceted output that reads as a
 * 104-125 degree error and the sign test does catch it. On *smooth* output the
 * radial normal blends the fallback away into a 72 degree tilt, and the sign test
 * reported 0 disagreements — clean — on a downward spike lit as though it pointed
 * at the sky, ink shell and all. Measured, before and after the fix:
 *
 *     taperedBox bottomScale 0      worst 104.04 deg -> 0.00    sign test 4 -> 0
 *     loft mid-list pinch           worst 125.26 deg -> 0.00    sign test 4 -> 0
 *     stylizedCapsule bottomScale 0 worst  72.14 deg -> 20.97   sign test 0 -> 0
 *
 * The third row is the reason this test exists. So: measure the angle, not the
 * sign.
 */
test('collapsed sections keep their normals, in magnitude not just in sign', () => {
  // Worst angle between a triangle's own winding normal and the normal actually
  // stored on it, plus how many triangles were solid enough to judge. Faceted
  // lofts write the exact face normal, so for them the answer is 0 and any
  // deviation at all is a defect.
  const worstDegrees = (
    geometry: THREE.BufferGeometry,
    keep?: (midY: number) => boolean,
  ): { worst: number, judged: number } => {
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
    let worst = 0
    let judged = 0
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      const indices = [at(triangle), at(triangle + 1), at(triangle + 2)]
      a.fromBufferAttribute(position, indices[0])
      b.fromBufferAttribute(position, indices[1])
      c.fromBufferAttribute(position, indices[2])
      // Region filter, applied before anything is judged so `judged` reports the
      // population of the region rather than of the whole shape.
      if (keep && !keep((a.y + b.y + c.y) / 3)) continue
      wind.crossVectors(edge1.subVectors(b, a), edge2.subVectors(c, a))
      if (wind.lengthSq() < 1e-14) continue
      wind.normalize()
      stored.set(0, 0, 0)
      for (const i of indices) {
        corner.fromBufferAttribute(normal, i)
        stored.add(corner)
      }
      if (stored.lengthSq() < 1e-14) continue
      stored.normalize()
      judged += 1
      const cos = Math.min(1, Math.max(-1, wind.dot(stored)))
      worst = Math.max(worst, (Math.acos(cos) * 180) / Math.PI)
    }
    return { worst, judged }
  }

  // Faceted lofts store the face normal verbatim, so exact agreement is the real
  // contract and a loose threshold would let the 20-degree band back in.
  const faceted: [string, THREE.BufferGeometry][] = [
    ['collapsed lower ring', loftProfile({
      profile: polygonProfile(0.6, 8),
      sections: [{ y: 0, scaleX: 0 }, { y: 1, scaleX: 1 }],
    })],
    ['collapsed upper ring', loftProfile({
      profile: polygonProfile(0.6, 8),
      sections: [{ y: 0, scaleX: 1 }, { y: 1, scaleX: 0 }],
    })],
    ['mid-list pinch', loftProfile({
      profile: polygonProfile(0.6, 8),
      sections: [{ y: 0, scaleX: 1 }, { y: 1, scaleX: 0 }, { y: 2, scaleX: 1 }],
    })],
    ['anisotropic collapse', loftProfile({
      profile: polygonProfile(0.6, 8),
      sections: [{ y: 0, scaleX: 0, scaleZ: 0 }, { y: 1, scaleX: 1, scaleZ: 0.4 }],
    })],
    ['tapered box bottomScale 0', taperedBox({
      width: 1, height: 2, depth: 1, bottomScale: 0,
    })],
    // Healthy controls: if the assertion is wrong these fail too, which is how we
    // know a pass means something.
    ['tapered box plain', taperedBox({
      width: 1, height: 2, depth: 1, topScale: 0.6,
    })],
  ]
  for (const [label, geometry] of faceted) {
    const { worst, judged } = worstDegrees(geometry)
    // Vacuity guard: a shape whose triangles were all skipped reports worst 0 and
    // is indistinguishable from a perfect one.
    assert.ok(judged > 0, `${label} judged no triangles at all`)
    // 1e-3 deg, not 0. Positions and normals are Float32Array, so recomputing the
    // winding normal from stored positions and comparing it to the stored normal
    // costs ~3e-6 deg of rounding on a polygon profile (0 on an axis-aligned rect
    // one, which stores its components exactly). Measured floor 4.2e-6, defect
    // 104-125, so this sits two orders above the noise and five below the bug.
    assert.ok(
      worst < 1e-3,
      `${label} stores normals up to ${worst.toFixed(2)} deg off its own winding`,
    )
    geometry.dispose()
  }

  // Smooth output legitimately deviates — the radial normal is not the face normal
  // — so the honest assertion is differential: collapsing a section must not make a
  // capsule any worse than the healthy one of the same tessellation. Before the fix
  // this read 72.14 against 20.97 while the sign test called both clean.
  //
  // Measured on the LOWER HALF only, because whole-shape this was not measuring the
  // parameter at all. `bottomScale` perturbs the bottom cap, the capsule is mirror
  // symmetric, and the deviation peaks at the cap either way — so the healthy shape's
  // worst triangle sits at y = -0.95 and the spiked shape's worst sits at its own
  // untouched mirror image, y = +0.95. Equal to the bit:
  //
  //     region    healthy worst       spiked worst       margin
  //     whole     20.969619 @ -0.95   20.969619 @ +0.95  0.000e+0   <- symmetry
  //     y < 0     20.969619 @ -0.95    7.861194 @ -0.74  13.1084
  //
  // So the assertion was passing on capsule symmetry rather than on the repair, with
  // the 1e-6 epsilon absorbing nothing and a float nudge anywhere in the top cap
  // enough to fail a healthy build. Not a coincidence to be re-tuned: the extremum
  // had relocated out of the region under test, which is the second way to lose an
  // assertion's subject and leaves exactly as little trace as the first.
  //
  // This fixes the region and the exact-tie flake. It does NOT make the assertion
  // sensitive to a downward-only regression — a spike that got worse but stayed under
  // the healthy cap's 20.97 would still pass, and catching that needs a directional
  // measure rather than a worst-of.
  const healthy = stylizedCapsule({ radius: 0.5, height: 1 })
  const spiked = stylizedCapsule({ radius: 0.5, height: 1, bottomScale: 0 })
  const lowerHalf = (midY: number): boolean => midY < 0
  const healthyMeasure = worstDegrees(healthy, lowerHalf)
  const spikedMeasure = worstDegrees(spiked, lowerHalf)
  assert.ok(healthyMeasure.judged > 0, 'healthy capsule judged no triangles')
  assert.ok(
    spikedMeasure.worst <= healthyMeasure.worst + 1e-6,
    `bottomScale 0 capsule deviates ${spikedMeasure.worst.toFixed(2)} deg vs `
      + `${healthyMeasure.worst.toFixed(2)} deg for the healthy one`,
  )
  // The collapse also used to delete half the judgeable faces — 46 against 92 — so
  // even a magnitude test could have been fooled by measuring fewer things. The
  // floor keeps the population identical: 46 each under the region filter, and the
  // pairing rather than the value is what carries the guarantee.
  assert.equal(
    spikedMeasure.judged,
    healthyMeasure.judged,
    'a collapsed cap must not silently remove faces from judgement',
  )
  healthy.dispose()
  spiked.dispose()

  // The capsule pair above no longer *covers* the repaired code path, which is not
  // the same as the path being unreachable — worth correcting, because the stronger
  // claim invites deleting a branch that production still enters. The floor applies
  // to the bottom ring only. Measured: `bottomScale: 0` is floored to radius 0.02000
  // and yields 92 non-degenerate triangles, identical to the plain capsule, so
  // `loftProfile`'s collapsed-ring branch never fires for it. `topScale: 0` is
  // unfloored — min ring radius 0.00000, 76 non-degenerate triangles — so the
  // repaired path is still live, just not exercised by this pair.
  //
  // Fixing the floor removed the input the loft assertion depended on. Two fixes in
  // one commit, and the second neutralised the first one's only smooth test. So a
  // direct smooth loft has to carry that coverage.
  //
  // It has to be a TALL one. The sign test's blindness here is not a blind spot
  // but a blind *zone* with an exact boundary. In smooth mode `normalFor` takes X
  // and Z from the profile — the true radial whenever the section is isotropic,
  // which every case in this test is — and only Y from the corrupted face normal,
  // so the stored normal was `normalize((r, 1))` while the truth is
  // `normalize((h * r, -h_r))`; their dot is proportional to `(h - r)`.
  // (On an ANISOTROPIC section the profile direction is not the radial at all; that
  // is a separate defect, guarded by its own test below.)
  // Measured on the broken builder, radius 1, sweeping height:
  //
  //     h = 4.0    sign test 0 bad    worst  60.41 deg   <- blind
  //     h = 2.0    sign test 0 bad    worst  72.14 deg   <- blind
  //     h = 1.0    sign test 0 bad    worst  90.00 deg   <- the boundary, h = r
  //     h = 0.9999 sign test 8 bad    worst  90.00 deg   <- caught
  //     h = 0.5    sign test 8 bad    worst 108.76 deg   <- caught
  //
  // The blindness is aligned with use rather than orthogonal to it: every shape
  // anyone builds with a collapsed bottom ring — icicle, stalactite, spear tip,
  // hanging horn, tail — is tall relative to its radius. The sign test catches the
  // squat cone nobody builds and misses the tall spike the parameter exists for,
  // so the squat regime needs no assertion here and the tall one needs this.
  const tallLoft = (bottomScale: number, height: number): THREE.BufferGeometry =>
    loftProfile({
      profile: polygonProfile(1, 8),
      sections: [{ y: 0, scaleX: bottomScale }, { y: height, scaleX: 1 }],
      smooth: true,
    })
  for (const height of [4, 2]) {
    // Not paired on `judged`: unlike the floored capsule, a genuinely collapsed
    // loft ring produces degenerate triangles by construction, so its skipped
    // count is geometry rather than defect.
    const spike = worstDegrees(tallLoft(0, height))
    const blunt = worstDegrees(tallLoft(0.04, height))
    assert.ok(spike.judged > 0, `tall smooth spike h=${height} judged nothing`)
    // 0.5 deg of slack: a collapsed cone and a near-collapsed frustum are not the
    // same shape, and the gap between them widens as the shape squats. Measured
    // post-fix the spike is marginally *better* than the blunt one (7.67 vs 7.69
    // at h=4, 7.18 vs 7.21 at h=2); pre-fix it was 60.41 and 72.14 against the
    // same baselines. So this sits 25x above the observed difference and 100x
    // below the defect.
    assert.ok(
      spike.worst <= blunt.worst + 0.5,
      `tall smooth spike h=${height} deviates ${spike.worst.toFixed(2)} deg vs `
        + `${blunt.worst.toFixed(2)} deg for the blunt one — and the sign test `
        + 'cannot see this, which is why the assertion is on magnitude',
    )
  }

  // The floor exists to stop a cap ring reaching zero. It used to be applied to
  // `sin(angle)` and then multiplied by `bottomScale`, so it protected exactly the
  // default capsule and nothing else: 0.5 -> 0.010, 0.1 -> 0.002, 0 -> 0.000.
  for (const bottomScale of [1, 0.5, 0.1, 0.001, 0]) {
    const capsule = stylizedCapsule({ radius: 0.5, height: 1, bottomScale })
    const position = capsule.getAttribute('position')
    let lowest = Infinity
    for (let i = 0; i < position.count; i += 1) {
      lowest = Math.min(lowest, position.getY(i))
    }
    let smallest = Infinity
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getY(i) - lowest) > 1e-9) continue
      smallest = Math.min(smallest, Math.hypot(position.getX(i), position.getZ(i)))
    }
    assert.ok(
      smallest > 1e-3,
      `bottomScale ${bottomScale} collapses the bottom ring to ${smallest}`,
    )
    capsule.dispose()
  }
})

/**
 * Every smooth-normal test above judges a shape whose correct answer is itself
 * approximate — a polygon has creases, a collapsed ring has no tangent plane — so
 * each asserts a magnitude or a comparison rather than a value. That left one class
 * of defect with nowhere to fail: an error that is *exactly zero* on the isotropic
 * case every other test uses, and grows only when `scaleX !== scaleZ`.
 *
 * A ring is `R(rotation) . S(scaleX, scaleZ)` applied to the profile, so its normals
 * transform by the inverse transpose, `R . S^-1`. `normalFor` used the raw profile
 * point, which is the direction *before* the squash — correct whenever the two
 * scales agree, and wrong by a widening margin as they diverge. Measured against the
 * exact ellipse normal on the untapered wall, where a smooth normal is unambiguous:
 *
 *     scaleZ         1.00    0.90    0.75    0.50    0.25
 *     before        0.000   3.013   8.202  19.442  36.809  worst deg
 *     after         0.000   0.000   0.000   0.000   0.000
 *
 * 342 tests passed over it, because `stylizedCapsule` — whose `depthScale` is the
 * one shipped route to an anisotropic section, and is documented for limbs that
 * should not be cylinders — is called nowhere yet. It is exported from the barrel,
 * so the first sibling to build a limb would have been the one to find this.
 */
test('a smooth loft normal is exact on an anisotropic section, not merely plausible', () => {
  // `scaleX`/`scaleZ` are supplied as written, NOT normalised here, because the second
  // case deliberately omits `scaleZ` — the builder must default it to `scaleX` exactly
  // as the position loop does. A test that always names both scales passes under
  // `scaleZ ?? 1` as happily as under `scaleZ ?? scaleX`; that omission is the whole
  // point of the isotropic case and it is worth 23.7 deg on a `{ scaleX: 0.4 }` section.
  const cases: [label: string, section: Omit<LoftSection, 'y'>][] = [
    ['isotropic', { scaleX: 1, scaleZ: 1 }],
    ['anisotropic 0.5', { scaleX: 1, scaleZ: 0.5 }],
    ['anisotropic 0.25', { scaleX: 1, scaleZ: 0.25 }],
    // Pins `scaleZ ?? scaleX`. The shape is a circle of radius 0.4, so the exact normal
    // is purely radial and any other default reads as anisotropy that is not there.
    ['scaleX only', { scaleX: 0.4 }],
    // Pins the rotation convention. `applyAxisAngle(UP, +rotation)` turns opposite to
    // the position loop's `x cos - z sin`, a silent 2r error: 30/60/90 deg at 15/30/45.
    ['rotated 30deg', { scaleX: 1, scaleZ: 0.5, rotation: Math.PI / 6 }],
    ['rotated -50deg + squash', { scaleX: 0.8, scaleZ: 0.3, rotation: -0.873 }],
  ]

  for (const [label, section] of cases) {
    const scaleX = section.scaleX ?? 1
    const scaleZ = section.scaleZ ?? scaleX
    const rotation = section.rotation ?? 0
    const wall = loftProfile({
      profile: polygonProfile(1, 64),
      sections: [{ ...section, y: 0 }, { ...section, y: 1 }],
      smooth: true,
      capBottom: false,
      capTop: false,
    })
    const position = wall.getAttribute('position')
    const normal = wall.getAttribute('normal')
    // Caps are excluded above rather than filtered here: their normals are
    // legitimately vertical, so leaving them in contributes a constant 90 deg and
    // swamps the term under test. An earlier revision of this probe measured a flat
    // 44.286 deg at every scale and read it as the builder's error — a reading that
    // does not move with the condition under test is measuring something else.
    let worst = 0
    let judged = 0
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i)
      const z = position.getZ(i)
      if (Math.hypot(x, z) < 1e-9) continue
      // Undo the section's rotation, take the exact ellipse normal
      // `(x / scaleX^2, z / scaleZ^2)` in that frame, then rotate it forward again.
      const localX = x * Math.cos(-rotation) - z * Math.sin(-rotation)
      const localZ = x * Math.sin(-rotation) + z * Math.cos(-rotation)
      const nx = localX / (scaleX * scaleX)
      const nz = localZ / (scaleZ * scaleZ)
      const exact = new THREE.Vector3(
        nx * Math.cos(rotation) - nz * Math.sin(rotation),
        0,
        nx * Math.sin(rotation) + nz * Math.cos(rotation),
      ).normalize()
      const stored = new THREE.Vector3().fromBufferAttribute(normal, i)
      if (stored.lengthSq() < 1e-12) continue
      judged += 1
      // The claim is scoped to the HORIZONTAL component: this repair makes the
      // in-plane direction exact under scale and section rotation. Y is still the
      // face's own approximation, so comparing full vectors would fold an untouched
      // term into a verdict about this one. The wall is vertical, so Y is 0 anyway;
      // zeroing it keeps that true if a later case tapers.
      stored.setY(0)
      if (stored.lengthSq() < 1e-12) continue
      const dot = Math.min(1, Math.max(-1, stored.normalize().dot(exact)))
      worst = Math.max(worst, (Math.acos(dot) * 180) / Math.PI)
    }
    assert.ok(judged > 0, `${label} judged no wall vertex at all`)
    // A proportional floor, for the reason S3 found the hard way: the verdict ranges
    // over the judged vertices, and three `continue`s above can shrink that set
    // without changing the result's colour. Measured, all six cases judge 384/384 —
    // including a 500:1 taper, so the `setY(0)` skip added with this test never bites
    // and is a guard rather than a filter. That is worth pinning, because it was
    // added in the same patch as the claim it protects and nothing else records it.
    assert.ok(
      judged >= position.count * 0.9,
      `${label} judged only ${judged} of ${position.count} vertices — the skips above `
        + 'have become a filter, so `worst` is a maximum over a shrinking population',
    )
    assert.ok(
      worst < 0.01,
      `${label}: smooth normals sit ${worst.toFixed(4)} deg off the exact ellipse `
        + 'normal — normalFor is not applying the inverse transpose `R . S^-1`, so '
        + 'anisotropic or rotated sections are mis-shaded',
    )
    wall.dispose()
  }

  // A collapsed section has no tangent plane and no invertible scale. The requirement
  // is finiteness, not accuracy: dividing by zero here would write NaN into the normal
  // buffer, which renders as black and survives every angular assertion above because
  // NaN fails every comparison rather than failing one.
  for (const collapsed of [{ scaleX: 0, scaleZ: 1 }, { scaleX: 1, scaleZ: 0 }, { scaleX: 0 }]) {
    const spike = loftProfile({
      profile: polygonProfile(1, 8),
      sections: [{ ...collapsed, y: 0 }, { scaleX: 1, y: 1 }],
      smooth: true,
    })
    const normal = spike.getAttribute('normal')
    for (let i = 0; i < normal.count; i += 1) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
      assert.ok(
        Number.isFinite(length) && Math.abs(length - 1) < 1e-3,
        `collapsed section ${JSON.stringify(collapsed)} wrote a normal of length `
          + `${String(length)} — the inverse scale was taken without guarding zero`,
      )
    }
    spike.dispose()
  }
})

/**
 * `tubeAlongPoints` stored a purely radial vector as the surface normal. That is
 * correct for a constant-radius tube — the surface is a generalised cylinder and
 * its normal really is perpendicular to the axis — and wrong for every tapered
 * one, by exactly the taper angle. A horn shaded like a cylinder is the visible
 * symptom: the highlight sits in a band instead of running to the tip.
 *
 * The reviewer established the blast radius across the merged product, which is
 * the reason this is a test and not a note. It is not one caller: eight direct
 * `tubeAlongPoints` sites in `CharacterKit` pass a varying radius and omit
 * `smooth` — headgear horn, bow limbs, beast head, beast tail, deer neck and two
 * antler tubes, ox head — and every one of their builders has a live call site in
 * `GameEngine.ts`. A ninth sits inside `branchStructure`, whose three `PropKit`
 * callers are `broadleafGeometry`, `deadTreeGeometry` and `thornTreeGeometry`,
 * all reachable through `treeGeometry` from `WorldPropLibrary`. My own call graph
 * said "one live caller" because I ran it on this branch, where `branchStructure`
 * genuinely has no caller — a branch-local answer to a programme-level question.
 *
 * Derivation, checked against numerical differentiation of the surface before it
 * was written: for `P(t,th) = C(t) + r(t)*u(th)` with a parallel-transport frame,
 * `dP/dt = a*T + r'*u` and `dP/dth = r*v`, giving an outward normal along
 * `u - (dr/ds)*T`. `getPointAt` is arc-length parameterised, so `ds = L*dt`.
 * Brute force agreed to 0.0000 deg; the old radial vector was out by 7.1250 deg
 * on the taper below, which is `atan(0.5/4)` to four places.
 *
 * The constant-radius case is asserted strictly rather than within a tolerance,
 * because the sampled slope is exactly zero there and the code returns the
 * untouched vector. That makes every non-tapered caller bit-for-bit unchanged,
 * and a strict assertion is the only kind that can prove it.
 */
test('a tapered tube leans its normal along the axis by the taper angle', () => {
  const length = 4
  const wide = 0.6
  const narrow = 0.1
  const radialSegments = 8
  const tubularSegments = 6
  const spine = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: length / 2, z: 0 },
    { x: 0, y: length, z: 0 },
  ]
  // Side walls are emitted before the caps, six vertices per quad.
  const sideVertices = 6 * radialSegments * tubularSegments

  const slope = (narrow - wide) / length
  const expectedY = -slope / Math.hypot(1, slope)
  assert.ok(
    Math.abs(expectedY) > 0.1,
    `the taper must be steep enough to discriminate, got ${String(expectedY)}`,
  )

  const tapered = tubeAlongPoints(spine, {
    radius: (t: number) => wide + (narrow - wide) * t,
    radialSegments,
    tubularSegments,
  })
  const taperedNormal = tapered.getAttribute('normal')
  const taperedPosition = tapered.getAttribute('position')
  assert.ok(
    taperedNormal.count >= sideVertices,
    `expected at least ${String(sideVertices)} vertices, got ${String(taperedNormal.count)}`,
  )

  for (let i = 0; i < sideVertices; i += 1) {
    const nx = taperedNormal.getX(i)
    const ny = taperedNormal.getY(i)
    const nz = taperedNormal.getZ(i)

    assert.ok(
      Math.abs(ny - expectedY) < 1e-6,
      `vertex ${String(i)} has axial normal ${String(ny)}, expected ${String(expectedY)} — `
        + 'a radial vector is not the normal of a tapered surface',
    )
    assert.ok(
      Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-6,
      `vertex ${String(i)} normal is not unit length`,
    )

    // The lean must be purely axial: the horizontal part still points straight out.
    const px = taperedPosition.getX(i)
    const pz = taperedPosition.getZ(i)
    const radial = Math.hypot(px, pz)
    const horizontal = Math.hypot(nx, nz)
    if (radial > 1e-6 && horizontal > 1e-6) {
      const alignment = (nx * px + nz * pz) / (horizontal * radial)
      assert.ok(
        alignment > 1 - 1e-6,
        `vertex ${String(i)} normal was rotated about the axis, alignment ${String(alignment)}`,
      )
    }
  }
  tapered.dispose()

  // Control: a constant radius must be untouched, exactly.
  const straight = tubeAlongPoints(spine, {
    radius: 0.3,
    radialSegments,
    tubularSegments,
  })
  const straightNormal = straight.getAttribute('normal')
  for (let i = 0; i < sideVertices; i += 1) {
    assert.equal(
      straightNormal.getY(i),
      0,
      `constant-radius vertex ${String(i)} gained an axial normal of `
        + `${String(straightNormal.getY(i))} — the no-taper path is no longer a no-op`,
    )
  }
  straight.dispose()

  // Control: `smooth` omitted is `smooth: true`, which is what puts the live
  // call sites on this path at all. If the default ever flips, this fails here
  // rather than in someone else's shading.
  const explicit = tubeAlongPoints(spine, {
    radius: (t: number) => wide + (narrow - wide) * t,
    radialSegments,
    tubularSegments,
    smooth: true,
  })
  const explicitNormal = explicit.getAttribute('normal')
  const rebuilt = tubeAlongPoints(spine, {
    radius: (t: number) => wide + (narrow - wide) * t,
    radialSegments,
    tubularSegments,
  })
  const rebuiltNormal = rebuilt.getAttribute('normal')
  assert.equal(explicitNormal.count, rebuiltNormal.count)
  for (let i = 0; i < explicitNormal.count; i += 1) {
    assert.equal(
      rebuiltNormal.getY(i),
      explicitNormal.getY(i),
      `omitting smooth diverged from smooth: true at vertex ${String(i)}`,
    )
  }
  explicit.dispose()
  rebuilt.dispose()
})

/**
 * The test above compares winding against the geometry's own stored normals, which
 * is exactly the check that caught the shipped loft inversion. It has one blind
 * spot: a builder that flipped its normals *and* its winding together would agree
 * with itself and pass. This one never reads the normal attribute — for a closed
 * body every face must point away from the centroid — so the two together pin the
 * absolute orientation rather than merely internal consistency.
 *
 * The invariant is not universal, and the guard below is what keeps that honest.
 * It holds for any shape that is star-convex about its own centroid; it says
 * nothing at all about one whose faces are *orthogonal* to the centroid ray. A
 * flat lathe — a disc annulus, every point at the same `y` — is the reachable
 * example: its faces point along +/-Y while "away from the centroid" is purely
 * radial, so `wind · outward` is 0 to floating-point and the sign that falls out
 * is noise. Measured, that case reports 32 of 32 faces "inward" at |cos| = 0.000000
 * while being perfectly well formed. So each case must also prove the invariant
 * *applies* to it, or a future addition gets a confident, entirely spurious
 * inversion report and someone "fixes" a builder that was never broken.
 */
test('closed builders wind outward, independently of their normals', () => {
  // `weakest` is the smallest |cos| between a face's winding and its centroid ray:
  // how decisively the invariant classified the least clear-cut face. `inward` is
  // meaningful only when `weakest` is comfortably above zero. `judged` is the number
  // of faces that survived both degeneracy guards — without it a geometry whose every
  // triangle is skipped returns `inward 0, weakest Infinity` and passes both
  // assertions while having been measured not at all.
  const measure = (geometry: THREE.BufferGeometry): {
    inward: number
    weakest: number
    judged: number
    triangles: number
  } => {
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
    let weakest = Infinity
    let judged = 0
    for (let triangle = 0; triangle + 2 < position.count; triangle += 3) {
      a.fromBufferAttribute(position, triangle)
      b.fromBufferAttribute(position, triangle + 1)
      c.fromBufferAttribute(position, triangle + 2)
      wind.crossVectors(edge1.subVectors(b, a), edge2.subVectors(c, a))
      if (wind.lengthSq() < 1e-14) continue
      outward.copy(a).add(b).add(c).divideScalar(3).sub(centroid)
      if (outward.lengthSq() < 1e-14) continue
      judged += 1
      if (wind.dot(outward) <= 0) inward += 1
      weakest = Math.min(weakest, Math.abs(wind.normalize().dot(outward.normalize())))
    }
    const triangles = Math.floor(position.count / 3)
    if (source !== geometry) source.dispose()
    return { inward, weakest, judged, triangles }
  }

  // Same control set as the relative test, and valid here for the same reason:
  // every one of these is star-convex about its own centroid, so "away from the
  // centroid" is well defined for each. A box alone would leave the fan caps and
  // curved walls this test's real cases are made of entirely uncalibrated.
  //
  // The last entry is an *open* indexed surface built by three.js, and it is here
  // to pin what the two lathe cases below rely on: that `measure` handles an open
  // profile and an index buffer correctly. Note what it cannot do — `latheProfile`
  // is a thin passthrough to `THREE.LatheGeometry`, so this control validates the
  // checker, not the builder. Absolute validation of `latheProfile` comes from the
  // axis-radial test, whose control is a cylinder built by a different code path.
  const controls: [string, THREE.BufferGeometry][] = [
    ['BoxGeometry', new THREE.BoxGeometry(1, 1, 1)],
    ['ConeGeometry', new THREE.ConeGeometry(0.5, 1, 8)],
    ['SphereGeometry', new THREE.SphereGeometry(0.5, 12, 8)],
    ['CylinderGeometry', new THREE.CylinderGeometry(0.5, 0.7, 1, 8)],
    ['LatheGeometry (open profile)', new THREE.LatheGeometry([
      new THREE.Vector2(0.2, 0),
      new THREE.Vector2(0.45, 0.35),
      new THREE.Vector2(0.3, 0.75),
    ], 16)],
  ]
  for (const [name, control] of controls) {
    const { inward, judged } = measure(control)
    assert.ok(judged > 0, `${name} control judged no faces at all`)
    assert.equal(inward, 0, `${name} control must wind outward`)
    control.dispose()
  }

  // The controls only ever show `measure` agreeing with correct input, which says
  // nothing about whether it can disagree. Reverse every face of one and require it
  // to be caught — and recompute normals first, because that is what `displaceGeometry`
  // does downstream and it is exactly the step that makes a *normal-agreement* check
  // tautological. This check never reads the normal attribute, so recomputing them
  // changes nothing here; the assertion below is what proves that rather than asserts it.
  const reversed = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()
  const reversedPosition = reversed.getAttribute('position')
  for (let triangle = 0; triangle + 2 < reversedPosition.count; triangle += 3) {
    for (const axis of ['X', 'Y', 'Z'] as const) {
      const second = reversedPosition[`get${axis}`](triangle + 1)
      const third = reversedPosition[`get${axis}`](triangle + 2)
      reversedPosition[`set${axis}`](triangle + 1, third)
      reversedPosition[`set${axis}`](triangle + 2, second)
    }
  }
  reversedPosition.needsUpdate = true
  reversed.computeVertexNormals()
  const caught = measure(reversed)
  assert.equal(
    caught.inward,
    caught.judged,
    'a fully reversed box must be reported inward on every judged face, even after '
    + 'computeVertexNormals() has rewritten its normals to agree with the new winding',
  )
  assert.ok(caught.judged > 0, 'the reversed control judged no faces at all')
  reversed.dispose()

  const cases: [builder: string, label: string, geometry: THREE.BufferGeometry][] = [
    ['loftProfile', 'loft rect', loftProfile({
      profile: rectProfile(1, 1),
      sections: [{ y: -0.5 }, { y: 0.5 }],
    })],
    ['loftProfile', 'loft polygon', loftProfile({
      profile: polygonProfile(0.5, 8),
      sections: [{ y: -0.5 }, { y: 0.5 }],
    })],
    ['taperedBox', 'tapered box', taperedBox({ width: 1, height: 1, depth: 1 })],
    ['taperedBox', 'bevelled box', taperedBox({ width: 1, height: 1, depth: 1, bevel: 0.15 })],
    ['stylizedCapsule', 'stylized capsule', stylizedCapsule({ radius: 0.4, height: 1 })],
    // `latheProfile` belongs here specifically, and its absence was a real gap:
    // it is the only *indexed* builder in the kit, so it is the only case that
    // exercises this helper's `toNonIndexed()` branch. Both a closed profile
    // (touches the axis at both ends, so the body seals itself) and an open one
    // (a skirt with no caps). Closure is not what this invariant needs — the open
    // skirt classifies more decisively than the closed solid (|cos| 0.96 against
    // 0.93), because a skirt's side walls do face away from the mesh centroid.
    // What it needs is that faces are not orthogonal to the centroid ray, which
    // the guard at the bottom of this test now enforces for every case.
    ['latheProfile', 'lathe closed profile', latheProfile([
      { x: 0, y: 0 },
      { x: 0.35, y: 0.15 },
      { x: 0.5, y: 0.45 },
      { x: 0.3, y: 0.8 },
      { x: 0, y: 1 },
    ], { segments: 16 })],
    ['latheProfile', 'lathe open profile', latheProfile([
      { x: 0.2, y: 0 },
      { x: 0.45, y: 0.35 },
      { x: 0.3, y: 0.75 },
    ], { segments: 16 })],
    ['tubeAlongPoints', 'tube upward', tubeAlongPoints(
      [{ x: 0, y: -0.5, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0.5, z: 0 }],
      { radius: 0.2 },
    )],
    ['tubeAlongPoints', 'tube downward', tubeAlongPoints(
      [{ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: -0.5, z: 0 }],
      { radius: 0.2 },
    )],
    // `extrudeProfile` was missing entirely, and its absence was found by asking which
    // builders the case list covers rather than by review. It is the only builder whose
    // geometry three.js generates from a `Shape`, so it is the only one whose winding
    // this kit does not itself decide.
    ['extrudeProfile', 'extrude square', extrudeProfile(
      [{ x: -0.4, y: -0.4 }, { x: 0.4, y: -0.4 }, { x: 0.4, y: 0.4 }, { x: -0.4, y: 0.4 }],
      { depth: 0.6 },
    )],
    ['extrudeProfile', 'extrude hexagon', extrudeProfile(
      Array.from({ length: 6 }, (_, corner) => ({
        x: 0.4 * Math.cos((corner / 6) * Math.PI * 2),
        y: 0.4 * Math.sin((corner / 6) * Math.PI * 2),
      })),
      { depth: 0.5 },
    )],
  ]

  let totalJudged = 0
  for (const [, label, geometry] of cases) {
    const { inward, weakest, judged, triangles } = measure(geometry)
    // Prove the invariant applies before trusting what it says. 0.2 is a TRIPWIRE on
    // this test's own cases, not a correctness threshold on geometry in general, and
    // the difference is not academic. Measured, `probe-inventory2.mts`:
    //
    //   this test's cases       min 0.3527 (tube up/down), NOT the closed lathe at
    //                           0.9255 — an earlier revision of this comment said the
    //                           lathe and it was stale the moment the tubes were added.
    //                           Real headroom over the guard is 1.76x, not 4.6x.
    //   shipped game art        Box(0.78, 0.04, 0.2) at GameEngine.ts:7181 scores
    //                           0.1474 and winds perfectly correctly — it would FAIL
    //                           this guard. Cone(0.06, 0.62, 4) at :7119 scores 0.3292.
    //
    // So a control or case shaped like this game's own art can sit below 0.2 while
    // being entirely well formed: the margin falls with aspect ratio and with coarse
    // tessellation, and thin slabs and slender spikes are exactly what the art uses.
    // Two whole families are degenerate rather than merely tight, and both are already
    // in `src`: flat open surfaces (Circle/Plane/Ring, 7 sites — one of them this
    // library's own contact shadow) score exactly 0 because their centroid lies in
    // their own plane, and non-star-convex solids (Torus, 2 sites) score 0.28-0.34
    // with roughly half their faces spuriously inward. Neither is a winding fault.
    // Anything in either family belongs in the signed-volume test below, not here.
    //
    // S1 raised flatness as a second declining axis alongside non-star-convexity, which
    // is right, and measuring it turned up four axes rather than two. Lofted boxes,
    // `flatprobe.mts`, `weakest` against the 0.2 guard:
    //
    //   section flatness   0.28x0.3  0.2879 PASS   0.6x0.1   0.1050 FAIL
    //   (width:depth)      0.4 x0.2  0.2091 PASS   1.0x0.04  0.0406 FAIL
    //   elongation         h=1 0.3067 PASS   h=2 0.1597 FAIL   h=8 0.0405 FAIL
    //   radial coarseness  3-gon 0.1592 FAIL  4-gon 0.2227    32-gon 0.2992
    //   axial subdivision  2 rings 0.6529 -> 40 rings 0.2905, asymptote, never crosses
    //
    // Three of the four cross the guard on geometry with **no concavity at all**, and
    // the fourth never does however far it is pushed. So "non-star-convex" names too
    // little and "more triangles" names the wrong thing: the property the guard needs
    // is **compactness** — how far a face sits from the centroid along the surface,
    // against how far it sits from the centroid at all. All four axes move that one
    // quantity, which is why they cannot be enumerated as separate rules.
    //
    // Two corrections fall out, one to S1's report and one to the paragraph above it.
    // **Elongation alone does fail**: a square 0.3x0.3 section at height 2 reads 0.1597,
    // where S1 measured aspect 8.0 still passing at 0.315 and concluded elongation was
    // exempt. And **"coarse tessellation" is only true radially** — a 3-gon section
    // fails at 0.1592 while a 32-gon passes at 0.2992, but along the axis the margin
    // moves the *other* way, falling with *more* rings toward an asymptote it never
    // crosses. Both halves of that sentence were written as one claim and they are two.
    //
    // Practical consequence for whoever extends this case list: a plank, banner, blade
    // or rail will fail here while being perfectly wound. `PropKit.ts:874` and `:3944`
    // ship `rectProfile(0.045, 0.012)` and `(0.075, 0.018)` and measure 0.0277 and
    // 0.0414. Route flat and slender shapes to the signed-volume test; a failure here
    // is a statement about the instrument's domain, not about winding.
    assert.ok(
      weakest > 0.2,
      `${label} is too flat for the centroid invariant to classify `
      + `(weakest |cos| ${weakest.toFixed(6)}) — its faces are near-orthogonal to `
      + 'the centroid ray, so any verdict here is floating-point noise, not winding',
    )
    // `weakest` alone cannot catch an empty measurement: with no judged face it stays
    // at its `Infinity` seed and sails past the guard above.
    assert.ok(judged > 0, `${label} judged no faces at all`)
    // ...and `judged > 0` is a floor of ONE, which catches only total collapse. The
    // verdict below ranges over the judged faces alone, so a case that quietly stops
    // presenting most of its triangles gets a weaker test with an identical green
    // result. Every case here judges 100% today, so this asserts a real property of
    // the builders rather than a fitted coverage number: THEY MUST NOT EMIT DEGENERATE
    // TRIANGLES. `measure` skips exactly two things — zero-area faces and faces whose
    // centroid coincides with the body's — and neither should occur in this kit's
    // output at all. The 0.9 is headroom against a sliver at a fan cap, not a fit.
    //
    // Found by S3 in their own coverage instrument, where per-geometry share had
    // fallen to 64% under an aggregate that still looked healthy. The aggregate floor
    // below cannot see that failure: one case collapsing while another grows leaves
    // the total untouched.
    assert.ok(
      judged >= triangles * 0.9,
      `${label} judged only ${judged} of ${triangles} triangles `
        + `(${((judged / triangles) * 100).toFixed(1)}%) — faces are leaving the `
        + 'measurement, either because the builder now emits degenerate or '
        + 'centroid-coincident geometry or because a skip was added to `measure`. '
        + 'Either way the winding verdict below now ranges over a subset, and no '
        + 'other assertion here reports that it shrank',
    )
    assert.equal(inward, 0, `${label} must wind outward`)
    totalJudged += judged
    geometry.dispose()
  }

  // A floor on the population, so an enumeration that quietly stops producing cases
  // cannot pass by measuring nothing. These cases judge 588 faces today; the floor
  // sits below that but far above anything a truncated list would reach.
  assert.ok(
    totalJudged > 400,
    `the centroid sweep judged only ${totalJudged} faces across ${cases.length} cases`,
  )
  assert.deepEqual(
    [...new Set(cases.map(([builder]) => builder))].sort(),
    [...CENTROID_WINDING_BUILDERS].sort(),
    'the centroid case list no longer covers the builders it claims to',
  )
})

/**
 * Which builders each winding test speaks for. The coverage test below checks the
 * union against the builders it derives from `GeometryKit.ts`, and each test checks
 * its own cases against its own entry here, so neither list can drift from the other.
 */
const CENTROID_WINDING_BUILDERS = [
  'loftProfile', 'taperedBox', 'stylizedCapsule',
  'latheProfile', 'tubeAlongPoints', 'extrudeProfile',
] as const
const VOLUME_WINDING_BUILDERS = ['branchStructure', 'tubeAlongPoints'] as const

/**
 * The cases in the normal-agreement test above that it cannot possibly fail, because
 * the geometry's normals are derived from its own winding by `computeVertexNormals()`.
 * Pinned by name rather than skipped: if one of these stops being normal-derived it
 * fails here and should move back, and a new laundered case has somewhere to go.
 */
const NORMAL_DERIVED_CASES = [
  'extrude', 'displaced', 'faceted', 'merged', 'composed prop',
] as const

/**
 * Edges used by exactly one triangle. Zero means the surface is closed.
 *
 * Welded by quantised position rather than by index, because most of the kit's output
 * is non-indexed by the time it reaches here -- `facetGeometry` and `displaceGeometry`
 * both hard-edge their result, so an index-based count would call every shape open.
 */
const boundaryEdgeCount = (geometry: THREE.BufferGeometry): number => {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const count = index ? index.count : position.count
  const round = (value: number) => Math.round(value * 1e4) / 1e4
  const key = (slot: number) => {
    const vertex = index ? index.getX(slot) : slot
    return `${round(position.getX(vertex))},${round(position.getY(vertex))},${round(position.getZ(vertex))}`
  }
  const edges = new Map<string, number>()
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    const a = key(triangle)
    const b = key(triangle + 1)
    const c = key(triangle + 2)
    if (a === b || b === c || a === c) continue
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      const edge = from < to ? `${from}|${to}` : `${to}|${from}`
      edges.set(edge, (edges.get(edge) ?? 0) + 1)
    }
  }
  let boundary = 0
  for (const uses of edges.values()) if (uses === 1) boundary += 1
  return boundary
}

/**
 * The laundered cases that are *open* surfaces, measured by `boundaryEdgeCount` and
 * asserted below rather than trusted. `displaced` tears along its hard edges because
 * `displaceGeometry` pushes each vertex along its own normal and coincident vertices
 * at a crease do not share one; the two composites are open because `latheProfile`
 * with non-zero start and end radii revolves a tube rather than a solid.
 */
const OPEN_NORMAL_DERIVED_CASES = ['displaced', 'merged', 'composed prop'] as const

/**
 * Signed volume about the geometry's own bounding-box centre.
 *
 * The recentring is load-bearing, not tidiness. The divergence sum is translation-
 * invariant only for a *closed* surface; for an open one it measures the cone from the
 * origin out to the surface, so it drifts with position and eventually changes sign
 * with the winding untouched. Measured on `composed prop`, which is open: +0.22255 at
 * the authored position, negative once moved +4 in y -- an offset any prop placement
 * exceeds, so the un-centred form was a false failure waiting for someone to move a
 * rock. About the shape's own centre all five sit at +0.23578 to +1.17084 and none
 * flips at any offset, so the assertion is about winding rather than placement.
 */
const signedVolume = (geometry: THREE.BufferGeometry): { volume: number, judged: number } => {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position')
  const centre = new THREE.Box3().setFromBufferAttribute(
    position as THREE.BufferAttribute,
  ).getCenter(new THREE.Vector3())
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const cross = new THREE.Vector3()
  let volume = 0
  let judged = 0
  for (let triangle = 0; triangle + 2 < position.count; triangle += 3) {
    a.fromBufferAttribute(position, triangle).sub(centre)
    b.fromBufferAttribute(position, triangle + 1).sub(centre)
    c.fromBufferAttribute(position, triangle + 2).sub(centre)
    cross.crossVectors(b, c)
    if (!Number.isFinite(cross.lengthSq())) continue
    judged += 1
    volume += a.dot(cross) / 6
  }
  if (source !== geometry) source.dispose()
  return { volume, judged }
}

const reverseWinding = (geometry: THREE.BufferGeometry): THREE.BufferGeometry => {
  const flipped = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = flipped.getAttribute('position')
  for (let triangle = 0; triangle + 2 < position.count; triangle += 3) {
    for (const axis of ['X', 'Y', 'Z'] as const) {
      const second = position[`get${axis}`](triangle + 1)
      const third = position[`get${axis}`](triangle + 2)
      position[`set${axis}`](triangle + 1, third)
      position[`set${axis}`](triangle + 2, second)
    }
  }
  position.needsUpdate = true
  // Exactly what `displaceGeometry` does downstream, and the step that would make a
  // normal-agreement check agree with itself. This measure never reads normals.
  flipped.computeVertexNormals()
  return flipped
}

/**
 * `reverseWinding` inverts every triangle, which is the one damage shape a signed-volume
 * measure always catches — the sum flips wholesale. This inverts a contiguous *prefix*
 * instead, which is the shape that nets against the untouched remainder. Contiguity is
 * deliberate: a scattered selection of the same size tends to cancel to nothing and would
 * report the opposite conclusion, so the selection rule is part of the instrument.
 */
const reversePrefix = (geometry: THREE.BufferGeometry, fraction: number): THREE.BufferGeometry => {
  const flipped = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = flipped.getAttribute('position')
  const damaged = Math.floor(Math.floor(position.count / 3) * fraction)
  for (let triangle = 0; triangle < damaged; triangle += 1) {
    const base = triangle * 3
    for (const axis of ['X', 'Y', 'Z'] as const) {
      const second = position[`get${axis}`](base + 1)
      const third = position[`get${axis}`](base + 2)
      position[`set${axis}`](base + 1, third)
      position[`set${axis}`](base + 2, second)
    }
  }
  position.needsUpdate = true
  flipped.computeVertexNormals()
  return flipped
}

/**
 * The centroid test is the sharper instrument — it catches a *single* reversed face —
 * but it only speaks about shapes that are star-convex about their own centroid, and
 * its `weakest > 0.2` guard makes it decline rather than lie when they are not. That
 * leaves a real hole, because two things the kit actually builds fall in it. Measured:
 *
 *     branchStructure depth 0    weakest 0.066479   declines
 *     branchStructure depth 1    weakest 0.007099   declines, 116 of 335 spuriously inward
 *     branchStructure depth 2    weakest 0.000031   declines, 488 of 1085 spuriously inward
 *     tubeAlongPoints, bent      weakest 0.024843   declines,  24 of  96 spuriously inward
 *
 * A trunk with limbs is not star-convex, and neither is a bent tube — the exact shapes
 * the NPC pass needs for horns and tails and the world pass needs for branches. Signed
 * volume is the complement: it does not care whether the body is convex, and it never
 * reads the normal attribute either, so `computeVertexNormals()` downstream cannot make
 * it tautological.
 *
 * What it *does* care about was asserted in this test's own title and never measured.
 * None of these four is closed:
 *
 *     bare trunk             5 boundary edges
 *     one level of limbs    25
 *     two levels of limbs   85
 *     bent tube             12
 *
 * `branchStructure` leaves the limb sockets open and `tubeAlongPoints` does not cap its
 * ends. For an open surface the divergence sum is not an enclosed volume and drifts with
 * position, so `signedVolume` measures about each shape's own centre — see its docblock.
 * That is what makes the sign below a statement about winding rather than about placement.
 * The split is re-measured on every run so this block cannot quietly go stale.
 *
 * It is a much blunter tool and that is stated here rather than discovered later. It is
 * a *sum*, so partial inversions cancel. Measured on a fully-formed capsule, reversing
 * a fraction of faces and recomputing normals:
 *
 *     reversed   centroid           signed volume
 *      2%        1 of 92  caught     0.6587  missed
 *     10%        9 of 92  caught     0.5905  missed
 *     25%       23 of 92  caught     0.4289  missed
 *     50%       46 of 92  caught    -0.2258  caught
 *
 * So volume detects a global flip and nothing subtler. It is here to cover the shapes
 * the centroid test must refuse, not to second-guess it where it already speaks.
 */
test('branch and tube builders wind outward by volume, where the centroid test must decline', () => {
  const variation = artVariation('art-test-winding', 'branch')
  const cases: [builder: string, label: string, geometry: THREE.BufferGeometry][] = [
    ['branchStructure', 'bare trunk', branchStructure({
      variation, height: 1, baseRadius: 0.1, depth: 0,
    })],
    ['branchStructure', 'one level of limbs', branchStructure({
      variation, height: 1, baseRadius: 0.1, depth: 1,
    })],
    ['branchStructure', 'two levels of limbs', branchStructure({
      variation, height: 1, baseRadius: 0.1, depth: 2,
    })],
    ['tubeAlongPoints', 'bent tube', tubeAlongPoints(
      [
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0.5, z: 0 },
        { x: 0.5, y: 0.6, z: 0 }, { x: 1, y: 0.6, z: 0 },
      ],
      { radius: 0.12 },
    )],
  ]

  let totalJudged = 0
  const openness: [string, number][] = []
  for (const [, label, geometry] of cases) {
    openness.push([label, boundaryEdgeCount(geometry)])
    const { volume, judged } = signedVolume(geometry)
    assert.ok(judged > 0, `${label} judged no faces at all`)
    assert.ok(volume > 0, `${label} encloses non-positive volume ${volume.toFixed(6)}`)

    // Reversal negates the sum exactly, so this is arithmetic and not a per-shape
    // proof. Asserted as the identity it is rather than as a sign: `< 0` is entailed by
    // the `> 0` two lines above and so cannot fail for any reason to do with this shape,
    // while the equality still catches the two harness faults that matter — a
    // `reverseWinding` that no-ops, and a `signedVolume` that returns a magnitude.
    const flipped = reverseWinding(geometry)
    const reversed = signedVolume(flipped)
    assert.equal(
      reversed.volume,
      -volume,
      `${label} reversed reads ${reversed.volume.toFixed(6)}, not ${(-volume).toFixed(6)}. `
      + 'Swapping two vertices negates the scalar triple product term by term, so this is '
      + 'an exact identity; a residual means the measure is not a signed sum',
    )
    flipped.dispose()

    totalJudged += judged
    geometry.dispose()
  }

  // Every one of these is open, which is why `signedVolume` recentres. If a builder
  // starts capping its ends the block above needs rewriting, so notice it here.
  assert.deepEqual(
    openness.filter(([, edges]) => edges === 0).map(([label]) => label),
    [],
    'a builder here became closed; the volume reasoning above was written for open surfaces',
  )

  // 1601 faces today across the four cases; the floor is a guard against an
  // enumeration that stops producing, not a pin on the exact geometry.
  assert.ok(
    totalJudged > 1200,
    `the volume sweep judged only ${totalJudged} faces across ${cases.length} cases`,
  )
  assert.deepEqual(
    [...new Set(cases.map(([builder]) => builder))].sort(),
    [...VOLUME_WINDING_BUILDERS].sort(),
    'the volume case list no longer covers the builders it claims to',
  )
})

/**
 * The complement of the test above: not "which builders does the centroid test decline"
 * but "which geometry can the *normal-agreement* test never speak about at all".
 *
 * `computeVertexNormals()` derives normals from winding, so anything that ends in it
 * agrees with itself no matter how it is wound. Five cases in the agreement test are in
 * that state, and displacement is not the cause — a bare recompute is enough:
 *
 *     reversed stylizedCapsule   disagreements 236 -> 0 after computeVertexNormals()
 *     reversed taperedBox        disagreements  12 -> 0
 *
 * Five kit functions launder, and one of them is a *builder*, so no downstream transform
 * is needed for the hole to open:
 *
 *     extrudeProfile :475   displaceGeometry :819 :857   facetGeometry :894
 *     mergeAll :937 :960    bakeOutlineNormals :1301
 *
 * Volume rather than centroid, and that is measured rather than assumed — the centroid
 * test reports false positives on both merged composites, because a lathe stacked on a
 * box is not star-convex about the merged centroid:
 *
 *     case              centroid inward/judged   signed volume
 *     extrude                    0/16              0.27650
 *     displaced                  0/28              1.17080
 *     faceted                    0/92              0.45055
 *     merged                     2/52   <- false   1.15821
 *     composed prop              2/64   <- false   0.22255
 *
 * So asserting `inward === 0` here would fail on correct geometry.
 *
 * What is *not* true, and was asserted here in prose until it was measured: that all
 * five are closed. Boundary-edge counts say only two are, which matters because the
 * divergence sum is a volume only for a closed surface:
 *
 *     case              boundary edges   volume    un-centred sign flips at +y
 *     extrude                 0          0.27650      never    <- closed
 *     faceted                 0          0.45055      never    <- closed
 *     displaced              40          1.17084      never
 *     merged                 20          1.16336      +256
 *     composed prop          20          0.23578      +4
 *
 * `signedVolume` therefore measures about each shape's own centre, which makes the
 * result independent of where the caller placed it and the sign a statement about
 * winding for open and closed alike. The open three are pinned by name in
 * `OPEN_NORMAL_DERIVED_CASES` and the split is re-measured on every run.
 */
test('normal-derived geometry is checked by volume, because agreement is vacuous there', () => {
  const cases: [label: string, geometry: THREE.BufferGeometry][] = [
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
    ['displaced', displaceGeometry(
      taperedBox({ width: 1, height: 1.4, depth: 1, topScale: 0.8, segments: 3 }),
      { seed: 7, amplitude: 0.12, frequency: 1.7 },
    )],
    ['faceted', facetGeometry(stylizedCapsule({ radius: 0.35, height: 0.9 }))],
    ['merged', mergeAll([
      taperedBox({ width: 1, height: 1, depth: 1 }),
      transformed(latheProfile([
        { x: 0.05, y: 0 },
        { x: 0.4, y: 0.4 },
        { x: 0.1, y: 0.9 },
      ]), { position: { x: 0, y: 1, z: 0 } }),
    ])],
    ['composed prop', mergeAll([
      latheProfile([
        { x: 0.05, y: 0 },
        { x: 0.4, y: 0.3 },
        { x: 0.25, y: 0.7 },
      ], { segments: 10 }),
      loftProfile({
        profile: rectProfile(0.4, 0.4),
        sections: [
          { y: 0, scaleX: 1 },
          { y: 0.6, scaleX: 0.5, scaleZ: 0.5 },
        ],
      }),
      taperedBox({ width: 0.3, height: 0.5, depth: 0.3, topScale: 0.6 }),
    ], { name: 'composed-prop' })],
  ]

  let totalJudged = 0
  const open: string[] = []
  for (const [label, geometry] of cases) {
    if (boundaryEdgeCount(geometry) > 0) open.push(label)
    const { volume, judged } = signedVolume(geometry)
    assert.ok(judged > 0, `${label} was judged on no triangles, so its result means nothing`)
    assert.ok(volume > 0, `${label} encloses ${volume.toFixed(5)}, so it is wound inside out`)

    // Reversal negates this sum *exactly* -- swapping two vertices negates the scalar
    // triple product term by term, measured at 0.00e+0 residual on all five. So this
    // is arithmetic rather than a detection, and it says nothing about whether this
    // particular case is a fair subject for the measure. Asserted as that identity
    // rather than as a sign, because `< 0` is entailed by the `> 0` above it and cannot
    // fail for any shape reason -- while the equality still bites the one substitution
    // that would fake a pass everywhere at once: a detector returning a magnitude.
    const flipped = reverseWinding(geometry)
    const caught = signedVolume(flipped)
    assert.equal(
      caught.volume,
      -volume,
      `reversing ${label} read ${caught.volume.toFixed(5)}, not ${(-volume).toFixed(5)} — `
      + 'the negation is exact term by term, so any residual means the measure is not a '
      + 'signed sum',
    )
    flipped.dispose()

    // The property the recentring buys, asserted rather than described. The sign is what
    // the check above consumes, and for an open surface it is not translation-invariant:
    // un-centred, `composed prop` reads +0.22255 where it is authored and goes negative
    // once moved +4 in y, `merged` at +256, both with their winding untouched. Without
    // this the suite would have gone red on correct geometry the first time a sibling
    // repositioned a prop. Sign rather than magnitude, because summing large coordinates
    // loses precision by cancellation and that is not the defect being pinned.
    const moved = geometry.clone()
    moved.translate(0, 311, -177)
    const shifted = signedVolume(moved)
    assert.ok(
      shifted.volume > 0,
      `${label} volume went from ${volume.toFixed(5)} to ${shifted.volume.toFixed(5)} under a `
      + 'pure translation, so the measure is about placement rather than winding',
    )
    moved.dispose()

    totalJudged += judged
    geometry.dispose()
  }

  // Measured, not assumed. If a kit change closes one of these or opens one of the
  // closed pair, the comment block above stops being true and the recentring becomes
  // load-bearing for a different set -- so it reports here rather than going quiet.
  assert.deepEqual(
    open,
    [...OPEN_NORMAL_DERIVED_CASES],
    'the closed/open split of the laundered family changed; re-check the block above this test',
  )

  // Actual total is 252. A floor stops an enumeration that quietly stops producing
  // geometry from passing by producing none.
  assert.ok(totalJudged > 200, `only ${String(totalJudged)} triangles judged across the family`)

  assert.deepEqual(
    cases.map(([label]) => label),
    [...NORMAL_DERIVED_CASES],
    'the laundered-case roster drifted from the cases actually checked here',
  )
})

/**
 * Per-part signed volume inside a merged buffer. `mergeAll` concatenates, so each part
 * owns a contiguous run of vertices; each run is measured about its **own** centre, so a
 * part is judged on how it winds rather than on where in the prop it sits.
 *
 * Reads positions only — no normal attribute is consulted, so the `computeVertexNormals()`
 * that every merge path runs downstream cannot make the result agree with itself.
 */
const mergedSpanVolumes = (parts: THREE.BufferGeometry[]): {
  spans: number[]
  consumed: number
  total: number
} => {
  const merged = mergeAll(parts.map((part) => part.clone()))
  const source = merged.index ? merged.toNonIndexed() : merged
  const position = source.getAttribute('position')
  const vertex = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const cross = new THREE.Vector3()
  const spans: number[] = []
  let cursor = 0
  for (const part of parts) {
    const flat = part.index ? part.toNonIndexed() : part
    const count = flat.getAttribute('position').count
    if (flat !== part) flat.dispose()
    const box = new THREE.Box3()
    for (let slot = cursor; slot < cursor + count && slot < position.count; slot += 1) {
      box.expandByPoint(vertex.fromBufferAttribute(position, slot))
    }
    const centre = box.getCenter(new THREE.Vector3())
    let volume = 0
    for (let triangle = cursor; triangle + 2 < cursor + count && triangle + 2 < position.count; triangle += 3) {
      a.fromBufferAttribute(position, triangle).sub(centre)
      b.fromBufferAttribute(position, triangle + 1).sub(centre)
      c.fromBufferAttribute(position, triangle + 2).sub(centre)
      cross.crossVectors(b, c)
      volume += a.dot(cross) / 6
    }
    spans.push(volume)
    cursor += count
  }
  const total = position.count
  if (source !== merged) source.dispose()
  merged.dispose()
  return { spans, consumed: cursor, total }
}

/**
 * A reversed sub-part inside a merged prop, which is the defect a two-kit integration is
 * most likely to produce: one builder returns a part wound inside out, it is merged into
 * a prop, and the merge's normal recompute makes its shading agree with itself before
 * anything looks at it.
 *
 * Neither test above sees it, and the reason is worth stating because both *look* like
 * they should. Measured, `probe-laundered.mts`:
 *
 *     one part reversed              merged volume   the `volume > 0` test above
 *     merged, part 0 of 2               -0.83664     catches
 *     merged, part 1 of 2               +0.83664     PASSES   <- blind
 *     composed prop, part 0 of 3        -0.06498     catches
 *     composed prop, part 1 of 3        +0.12378     PASSES   <- blind
 *     composed prop, part 2 of 3        +0.17698     PASSES   <- blind
 *
 * The signed volume of a prop is a *sum*: a small reversed part is netted against the
 * larger correct ones and the total stays positive. Blind on 3 of 5, and blind in the
 * direction that matters — it is the incidental parts that get reversed, not the body.
 *
 * The centroid test cannot take over either, though it is the sharper instrument. On the
 * *correct* geometry, before any mutation:
 *
 *     merged          weakest 0.3075   2 of 52 faces spuriously inward
 *     composed prop   weakest 0.2158   2 of 64 faces spuriously inward
 *
 * Neither figure is a property of the shape alone, and that is the disqualification rather
 * than a caveat on it. `measure` averages vertex *positions*, so refining one part of a
 * merged prop drags the shared reference point into that part: the composed prop's lathe
 * holds 62.5% of the vertices at `segments: 10` and 97.7% at 256, moving the centroid
 * 0.062 up the axis and the reading 0.2158 -> 0.1900 while the surface is unchanged.
 * Judged about an area-weighted centroid, invariant to how finely the same surface is cut,
 * it converges to 0.1886. Refining the loft instead moves it *up*, to 0.2358. Measured by
 * review, `probe-centroid-weighting.mts`. Quote neither number without its tessellation.
 *
 * A prop is several bodies side by side, so it is not star-convex about the centroid of
 * the whole — the same disqualification `branchStructure` carries above. Pointing
 * `inward === 0` at these would go red on art that is perfectly well formed.
 *
 * So the part is the right subject, not the prop. The sweep below injects the defect one
 * part at a time and requires each injection to be caught, so what this test detects is
 * demonstrated rather than claimed. It does not, however, make the measure exact: moving
 * the subject from prop to part lowers the threshold at which a partial inversion hides,
 * it does not remove it. The measured floor is in the second sweep at the end of the test.
 */
test('a merged prop is checked part by part, because the volume sum hides a reversed part', () => {
  const props: [label: string, build: () => THREE.BufferGeometry[]][] = [
    ['merged', () => [
      taperedBox({ width: 1, height: 1, depth: 1 }),
      transformed(latheProfile([
        { x: 0.05, y: 0 },
        { x: 0.4, y: 0.4 },
        { x: 0.1, y: 0.9 },
      ]), { position: { x: 0, y: 1, z: 0 } }),
    ]],
    ['composed prop', () => [
      latheProfile([
        { x: 0.05, y: 0 },
        { x: 0.4, y: 0.3 },
        { x: 0.25, y: 0.7 },
      ], { segments: 10 }),
      loftProfile({
        profile: rectProfile(0.4, 0.4),
        sections: [
          { y: 0, scaleX: 1 },
          { y: 0.6, scaleX: 0.5, scaleZ: 0.5 },
        ],
      }),
      taperedBox({ width: 0.3, height: 0.5, depth: 0.3, topScale: 0.6 }),
    ]],
  ]

  for (const [label, build] of props) {
    const parts = build()
    const baseline = mergedSpanVolumes(parts)

    // The walk is the whole instrument. If the per-part counts stopped adding up to the
    // merged buffer -- a merge that reorders, welds or drops vertices -- every span below
    // would be measured over the wrong triangles and could still come out positive. So
    // the walk reports rather than going quiet.
    assert.equal(
      baseline.consumed,
      baseline.total,
      `${label}: the part spans cover ${String(baseline.consumed)} of ${String(baseline.total)} `
      + 'merged vertices, so mergeAll no longer lays parts down in order and these volumes '
      + 'are measured over the wrong triangles',
    )
    assert.ok(baseline.spans.length > 1, `${label} is not a multi-part prop, so it proves nothing here`)
    for (const [index, volume] of baseline.spans.entries()) {
      assert.ok(
        volume > 0,
        `${label} part ${String(index)} encloses ${volume.toFixed(5)}, so it is merged in inside out`,
      )
    }
    for (const part of parts) part.dispose()

    // Which mutations make this red, rather than whether any does. One part reversed at a
    // time, every part in turn. `reverseWinding` recomputes normals on the way out, so
    // each injected part arrives laundered exactly as a real one would.
    for (let index = 0; index < baseline.spans.length; index += 1) {
      const mutated = build()
      const original = mutated[index]
      mutated[index] = reverseWinding(original)
      original.dispose()
      const probe = mergedSpanVolumes(mutated)
      assert.equal(
        probe.consumed,
        probe.total,
        `${label}: reversing part ${String(index)} changed the merged vertex layout`,
      )
      // Stated as the identity it is, rather than as `spans[index] < 0`. Reversal does not
      // move a vertex, so the span's bounding box and centre are unchanged and every
      // triangle's determinant negates -- the span negates *bit-exactly*, which is why
      // strict equality on floats is the right operator here and passes.
      //
      // The consequence is that `spans[index] < 0` was entailed: given the `volume > 0`
      // assertion on every baseline span above, it could not fail. Three assertions in this
      // loop, two independent guarantees. Reviewed by S1-review-2, who found it; the same
      // shape as the whole-prop entailment that `21e5c9d` annotated, recurring inside the
      // test written to replace it.
      //
      // What this rewrite does NOT do is detect more. Measured, one mutation at a time,
      // each assertion run alone:
      //
      //     mutation                         spans[i] < 0   exact negation
      //     spans over the whole buffer          RED             RED
      //     spans returned in reverse order      RED             RED
      //
      // So it is a readability fix, not hardening, and should not be described as hardening:
      // it stops a reader counting three assertions and inferring three guarantees. The
      // grading is earned by the `filter(...).length === 1` assertion below and by this one
      // equally -- both catch a blinded instrument on their own.
      assert.equal(
        probe.spans[index],
        -baseline.spans[index],
        `${label}: reversing part ${String(index)} left its span at `
        + `${probe.spans[index].toFixed(5)}, so a reversed sub-part would ship undetected`,
      )
      // And only that part. A detector that reported every span negative would catch all
      // five injections while saying nothing about which part is at fault.
      assert.equal(
        probe.spans.filter((volume) => volume < 0).length,
        1,
        `${label}: reversing part ${String(index)} turned another part's span negative too, `
        + 'so this measures the prop rather than the part',
      )
      for (const part of mutated) part.dispose()
    }

    // And the floor, which is the thing this test was silent about. The docblock's own
    // argument -- "the signed volume of a prop is a *sum*" -- applies to a span as well as
    // to a prop, so moving the subject from prop to part lowered the blind threshold
    // without removing it. Measured, contiguous prefix of one part, before the merge:
    //
    //     reversed    merged p0  merged p1  composed p0  composed p1  composed p2
    //        10%        BLIND      BLIND       BLIND        BLIND        BLIND
    //        20%        BLIND      BLIND       BLIND        BLIND        BLIND
    //        35%        BLIND      BLIND       BLIND        BLIND        BLIND
    //        50%        catch      BLIND       BLIND        BLIND        BLIND
    //        65%        catch      catch       catch        catch        catch
    //
    // Blind on 19 of 35 injections. So `spans[i] > 0` certifies "no part is *mostly*
    // inside out", not "no part is inside out", and a builder that inverted a third of one
    // part would ship. The per-face centroid instrument is the one that would catch it,
    // and it declines on exactly these shapes for the reason given above -- a prop is
    // several bodies side by side and is not star-convex about its own centroid.
    //
    // Asserted in both directions so the claim stays coupled to the instrument: 35% must
    // still be missed (if that changes, the instrument improved and this comment is now
    // wrong), and a full reversal must still be caught (that is its actual job).
    for (let index = 0; index < baseline.spans.length; index += 1) {
      const missed = build()
      const partial = missed[index]
      missed[index] = reversePrefix(partial, 0.35)
      partial.dispose()
      assert.ok(
        mergedSpanVolumes(missed).spans[index] > 0,
        `${label}: the span guard now catches a 35% prefix reversal of part ${String(index)}. `
        + 'That is an improvement, not a failure — update the measured floor above.',
      )
      for (const part of missed) part.dispose()

      const whole = build()
      const full = whole[index]
      whole[index] = reversePrefix(full, 1)
      full.dispose()
      assert.ok(
        mergedSpanVolumes(whole).spans[index] < 0,
        `${label}: a fully reversed part ${String(index)} is no longer caught, `
        + 'so the guard has stopped doing the job it is kept for',
      )
      for (const part of whole) part.dispose()
    }
  }
})

/**
 * The three winding tests above are only as good as the set of builders they are pointed
 * at, and a hand-written list is exactly the thing that silently stops covering the kit
 * the first time someone adds a builder. So derive the set from the source instead: a
 * builder is a function that *returns* a `THREE.BufferGeometry` without *taking* one.
 * Everything that takes one is a transform (`displaceGeometry`, `mergeAll`, the vertex
 * colour and occlusion bakers) and its winding is inherited, not decided.
 */
test('every geometry builder in the kit is covered by a winding test', () => {
  const source = readFileSync(new URL('../src/game/art/GeometryKit.ts', import.meta.url), 'utf8')
  const builders: string[] = []
  const transforms: string[] = []
  for (const chunk of source.split('export function ').slice(1)) {
    const name = chunk.slice(0, chunk.indexOf('('))
    // Match the *closing* paren of the signature via its return type. Parameter lists
    // span many lines and contain `{}` in option defaults, so anything simpler either
    // stops at the first brace or runs past the function body.
    const header = /\)\s*:\s*THREE\.BufferGeometry\s*\{/.exec(chunk.slice(0, 900))
    if (!header) continue
    const parameters = chunk.slice(chunk.indexOf('('), header.index)
    if (parameters.includes('THREE.BufferGeometry')) transforms.push(name)
    else builders.push(name)
  }

  // Guard the derivation itself: if the parse silently matched nothing, every
  // assertion below would hold vacuously.
  assert.ok(builders.length > 0, 'derived no builders at all from GeometryKit.ts')
  assert.ok(transforms.length > 0, 'derived no transforms at all — the partition is not working')

  const covered = new Set<string>([...CENTROID_WINDING_BUILDERS, ...VOLUME_WINDING_BUILDERS])
  const uncovered = builders.filter((name) => !covered.has(name)).sort()
  assert.deepEqual(
    uncovered,
    [],
    'these builders create geometry but no winding test measures them — add a case to '
    + 'the centroid test if the shape is star-convex about its centroid, or to the '
    + 'volume test if it is not',
  )

  // And the reverse, so a builder that is renamed or removed does not leave a stale
  // claim of coverage behind.
  const derived = new Set(builders)
  assert.deepEqual(
    [...covered].filter((name) => !derived.has(name)).sort(),
    [],
    'a winding test claims to cover a builder that GeometryKit.ts no longer exports',
  )
})

/**
 * A third, independent absolute check, and the one that settles `latheProfile`.
 *
 * The centroid test above needs a body that is star-convex about its own
 * centroid. That holds for every case it lists — including the open lathe, which
 * classifies more decisively than the closed one (|cos| 0.96 against 0.93),
 * because a skirt's side walls do face away from the mesh centroid. But "is this
 * shape star-convex" is a judgement call made per case, and for a surface of
 * revolution there is a stronger invariant available that needs no such call:
 * every face must wind away from the **axis of revolution**, whatever the profile
 * does, open or closed.
 *
 * This reads no normals, so it cannot be fooled by a builder that flipped its
 * winding and its normals together, and it does not depend on closure. It is also
 * genuinely independent rather than a restatement — note that a
 * `THREE.LatheGeometry` control would *not* be, because `latheProfile` is a thin
 * passthrough to `THREE.LatheGeometry` plus a radius clamp. Comparing the two
 * compares a thing to itself and would agree even if both were inside-out, which
 * is why the control here is a `CylinderGeometry` built without the kit.
 *
 * The one shape this cannot speak about is a *flat* lathe — a disc annulus, every
 * point at one `y` — whose faces point along the axis rather than away from it.
 * That is the same degeneracy the centroid guard rejects, for the same reason.
 */
test('lathe surfaces wind away from their axis of revolution', () => {
  const axialInwardFaces = (geometry: THREE.BufferGeometry): { inward: number, classified: number } => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry
    const position = source.getAttribute('position')
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const edge1 = new THREE.Vector3()
    const edge2 = new THREE.Vector3()
    const wind = new THREE.Vector3()
    const radial = new THREE.Vector3()
    let inward = 0
    let classified = 0
    for (let triangle = 0; triangle + 2 < position.count; triangle += 3) {
      a.fromBufferAttribute(position, triangle)
      b.fromBufferAttribute(position, triangle + 1)
      c.fromBufferAttribute(position, triangle + 2)
      wind.crossVectors(edge1.subVectors(b, a), edge2.subVectors(c, a))
      if (wind.lengthSq() < 1e-14) continue
      // Radial direction from the Y axis to the face centre, with the axial
      // component discarded — this is what "outward" means for a solid of
      // revolution, and it is defined whether or not the profile closes.
      radial.copy(a).add(b).add(c).divideScalar(3)
      radial.y = 0
      if (radial.lengthSq() < 1e-8) continue
      // A cap faces *along* the axis, not away from it, so the radial invariant
      // says nothing about it — skip rather than guess. This is the same
      // degeneracy the centroid guard rejects, and the CylinderGeometry control
      // is what forced it to be stated: its two flat caps are 24 of its 48
      // triangles and were being scored as inverted.
      if (Math.abs(wind.normalize().dot(radial.normalize())) < 0.2) continue
      classified += 1
      if (wind.dot(radial) <= 0) inward += 1
    }
    if (source !== geometry) source.dispose()
    return { inward, classified }
  }

  // Deliberately not a `THREE.LatheGeometry` control: `latheProfile` is a thin
  // passthrough to it, so that comparison would be circular and would agree even
  // if both were inside-out. A cylinder is a surface of revolution built by a
  // different code path, which is what makes it a real control.
  const control = new THREE.CylinderGeometry(0.5, 0.7, 1, 12)
  const controlResult = axialInwardFaces(control)
  assert.equal(controlResult.inward, 0, 'CylinderGeometry control must wind outward')
  assert.equal(controlResult.classified, 24, 'the control\'s 24 side faces must be classified, its 24 cap faces skipped')
  control.dispose()

  const cases: [string, THREE.BufferGeometry, number][] = [
    ['closed profile', latheProfile([
      { x: 0, y: 0 },
      { x: 0.35, y: 0.15 },
      { x: 0.5, y: 0.45 },
      { x: 0.3, y: 0.8 },
      { x: 0, y: 1 },
    ], { segments: 16 }), 128],
    ['open profile', latheProfile([
      { x: 0.2, y: 0 },
      { x: 0.45, y: 0.35 },
      { x: 0.3, y: 0.75 },
    ], { segments: 16 }), 64],
    // The shape S3 measured at 6 agree / 9 disagree. A lathe emits
    // segments * (points - 1) * 2 triangles, which is always even, so 15 was
    // never a triangle count: this is the kit's only *indexed* builder, and an
    // index-blind reader sees floor(45 / 3) = 15 pseudo-triangles stitched from
    // unrelated vertices.
    ['S3-shaped profile', latheProfile([
      { x: 0.05, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0.3, y: 1 },
    ], { segments: 14 }), 56],
  ]

  for (const [label, geometry, expectedClassified] of cases) {
    const { inward, classified } = axialInwardFaces(geometry)
    // Pin how many faces the invariant actually spoke about, so the assertion
    // below cannot pass by classifying nothing.
    assert.equal(
      classified,
      expectedClassified,
      `lathe ${label} must classify ${String(expectedClassified)} faces`,
    )
    assert.equal(
      inward,
      0,
      `lathe ${label} must wind away from its axis`,
    )
    geometry.dispose()
  }
})

/**
 * `latheProfile` must hand back unit normals, and the reason is a `THREE`
 * quirk rather than anything this kit does.
 *
 * `LatheGeometry` builds each profile point's normal from the segment ahead of it,
 * carries it forward in `prevNormal`, and — for the **last** point only — pushes
 * `prevNormal` straight into the buffer. It copies that vector *before* it
 * normalises the working one, so the final ring's normals come out scaled by the
 * length of the last profile segment. Nothing downstream re-normalises them.
 *
 * This is asserted here rather than trusted because the failure has the worst
 * possible distribution: `transformed()` calls `applyMatrix4`, which runs
 * `applyNormalMatrix` and normalises as a side effect, so every lathe that is
 * *positioned* comes out clean and only the ones used at the origin carry it.
 * Measured before the fix, `buildHeadgear` was the only caller that reached the
 * origin: `cap` 27 vertices at |n| = 0.246416, `hood` 27 at 0.088549, `ragHood`
 * 21 at 0.088549 — and in every case the value equalled the length of the last
 * profile segment exactly, which is how the mechanism was confirmed rather than
 * inferred. The other nine headgear kinds measured a clean 1.000000 purely
 * because their lathes happened to be placed.
 *
 * The cost is not shading — three.js normalises `vNormal` in the fragment shader.
 * It is `bakeOutlineNormals`, which averages normals per welded position: a normal
 * 11x short is 11x under-weighted, so the ink shell extrudes the wrong way at the
 * peak of a hood, the single vertex where the silhouette is a point.
 */
test('lathe normals are unit length, including the last profile ring', () => {
  // Two profiles whose last segment is short, which is what makes the defect
  // visible: the shortfall IS the segment length, so a long final segment hides it.
  const cases: [label: string, points: { x: number, y: number }[]][] = [
    ['cap', [
      { x: 0.001, y: -0.05 },
      { x: 0.36, y: -0.06 },
      { x: 0.43, y: -0.02 },
      { x: 0.4, y: 0.08 },
      { x: 0.24, y: 0.24 },
      { x: 0.001, y: 0.3 },
    ]],
    ['hood', [
      { x: 0.001, y: -0.44 },
      { x: 0.4, y: -0.46 },
      { x: 0.47, y: -0.3 },
      { x: 0.47, y: -0.02 },
      { x: 0.4, y: 0.2 },
      { x: 0.22, y: 0.38 },
      { x: 0.08, y: 0.5 },
      { x: 0.001, y: 0.54 },
    ]],
    ['kettle brim', [
      { x: 0.3, y: -0.03 },
      { x: 0.52, y: -0.09 },
      { x: 0.52, y: -0.03 },
      { x: 0.3, y: 0.05 },
    ]],
  ]

  let judged = 0
  for (const [label, points] of cases) {
    const geometry = latheProfile(points, { segments: 9 })
    const normal = geometry.getAttribute('normal')
    assert.ok(normal, `lathe ${label} has no normals`)
    let worst = 0
    for (let index = 0; index < normal.count; index += 1) {
      const length = Math.hypot(
        normal.getX(index),
        normal.getY(index),
        normal.getZ(index),
      )
      worst = Math.max(worst, Math.abs(length - 1))
      judged += 1
    }
    // 1e-6 rather than a round number: `normalizeNormals` divides Float32 values by
    // a Float64 hypot and writes back to Float32, so the residual is bounded by one
    // Float32 ulp near 1, which is 6e-8. Measured worst across these three profiles
    // after the fix: 5.96e-8. The guard is 16x that, and 4 million times below the
    // 0.911451 the hood measured before it.
    assert.ok(
      worst < 1e-6,
      `lathe ${label} has a normal off unit length by ${worst.toExponential(6)}; `
      + 'LatheGeometry pushes the last profile point\'s normal from an unnormalised '
      + '`prevNormal`, so the final ring is scaled by the last segment\'s length',
    )
    geometry.dispose()
  }

  // Domain guard. A loop over an empty case list, or over geometry with no normal
  // attribute, would report a clean bill having compared nothing. Pinned exactly
  // rather than as a floor, because the count is derivable and a drift means the
  // cases changed: `LatheGeometry` emits `(segments + 1) * points` vertices, so
  // 10x6 + 10x8 + 10x4 = 180.
  assert.equal(
    judged,
    180,
    `measured ${String(judged)} normals across ${String(cases.length)} profiles, expected 180`,
  )

  // And prove the check can fail, because "worst < 1e-6" over correct input says
  // nothing about whether it would notice incorrect input. This reproduces exactly
  // what LatheGeometry does — scale the last profile point's ring by the last
  // segment's length — and requires the assertion above to reject it.
  //
  // The ring is STRIDED, not contiguous. `LatheGeometry` emits each meridian's whole
  // profile in order, so the last profile point of meridian `s` is at
  // `s * points.length + points.length - 1`. Measured on the hood profile: the raw
  // geometry's non-unit normals sit at exactly [7,15,23,31,39,47,55,63,71,79], and all
  // ten are at y = 0.540, the last profile point. Scaling the last ten *contiguous*
  // vertices instead would still produce a worst value of 0.911451 — scaling any unit
  // vector by 0.088549 does — so a mis-targeted plant is invisible in the number it
  // reports and has to be pinned by index.
  const control = latheProfile(cases[1][1], { segments: 9 })
  const controlNormals = control.getAttribute('normal')
  const profilePoints = cases[1][1].length
  const scale = Math.hypot(0.001 - 0.08, 0.54 - 0.5)
  const planted: number[] = []
  for (
    let index = profilePoints - 1;
    index < controlNormals.count;
    index += profilePoints
  ) {
    controlNormals.setXYZ(
      index,
      controlNormals.getX(index) * scale,
      controlNormals.getY(index) * scale,
      controlNormals.getZ(index) * scale,
    )
    planted.push(index)
  }
  assert.deepEqual(
    planted,
    [7, 15, 23, 31, 39, 47, 55, 63, 71, 79],
    'the plant did not land on the last profile ring; LatheGeometry\'s vertex order may '
    + 'have changed, in which case this reproduction is testing the wrong vertices',
  )
  let plantedWorst = 0
  for (let index = 0; index < controlNormals.count; index += 1) {
    plantedWorst = Math.max(
      plantedWorst,
      Math.abs(
        Math.hypot(
          controlNormals.getX(index),
          controlNormals.getY(index),
          controlNormals.getZ(index),
        ) - 1,
      ),
    )
  }
  assert.ok(
    plantedWorst > 1e-6,
    `the planted defect measured ${plantedWorst.toExponential(6)}, which the guard `
    + 'above would accept — so a green result on the real profiles means nothing',
  )
  // Pinned rather than merely "> guard": this is the exact figure the hood carried
  // before the fix, so if LatheGeometry's behaviour ever changes the reproduction
  // stops matching and this says so instead of quietly testing something else.
  assert.ok(
    Math.abs(plantedWorst - 0.911451) < 1e-5,
    `the reproduction measured ${plantedWorst.toFixed(6)}, not the 0.911451 the hood `
    + 'carried before the fix; LatheGeometry may no longer behave as this test assumes',
  )
  control.dispose()
})

/**
 * Reversing a mirrored part's winding is only correct if every attribute moves
 * with it. The winding assertions above would catch a desynchronised `normal`,
 * because they compare winding against it — but not a desynchronised `color`,
 * `uv` or `outlineNormal`, which would silently smear vertex data across the
 * wrong corners. This pins the correspondence directly.
 */
test('a mirrored geometry keeps every attribute aligned to its vertex', () => {
  const geometry = bakeOutlineNormals(taperedBox({ width: 0.8, height: 1, depth: 0.5 }))
  const count = geometry.getAttribute('position').count

  // A colour derived from each vertex's own position, so the pairing is checkable
  // after the mirror without depending on vertex order.
  const colors = new Float32Array(count * 3)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = position.getX(i) + 5
    colors[i * 3 + 1] = position.getY(i) + 5
    colors[i * 3 + 2] = position.getZ(i) + 5
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  transformed(geometry, { scale: { x: -1, y: 1, z: 1 } })

  const mirroredPosition = geometry.getAttribute('position')
  const mirroredColor = geometry.getAttribute('color')
  const outlineNormal = geometry.getAttribute('outlineNormal')
  for (let i = 0; i < count; i += 1) {
    // The colour still encodes the vertex's *original* position, so mirroring x
    // means the stored red channel must be the negation of the new x.
    assert.ok(
      Math.abs(mirroredColor.getX(i) - 5 + mirroredPosition.getX(i)) < 1e-6,
      `vertex ${i} lost its colour pairing under the mirror`,
    )
    assert.ok(
      Math.abs(mirroredColor.getY(i) - 5 - mirroredPosition.getY(i)) < 1e-6,
      `vertex ${i} lost its colour pairing on an unmirrored axis`,
    )
    const ink = new THREE.Vector3().fromBufferAttribute(
      outlineNormal as THREE.BufferAttribute,
      i,
    )
    assert.ok(
      Number.isFinite(ink.length()) && Math.abs(ink.length() - 1) < 1e-4,
      `vertex ${i} ink normal must stay unit length, got ${ink.length()}`,
    )
  }

  geometry.dispose()
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
 * Three frozen surfaces, one per wave, each checked as a SUBSET of what the barrel
 * actually exports.
 *
 * This replaced an exact-set `deepEqual`. That assertion advertised itself as the
 * thing catching spec-vs-barrel drift, and it never was: all three drifts it is
 * credited with were **type-only** exports, erased before `Object.keys` runs, and
 * every one of them was caught by `every type the spec names is exported by the
 * barrel` below, which reads `index.ts` as text. The exact-set version's only
 * unique behaviour was going red when a sibling session *added* an export — which
 * is not a defect, and which forced both Wave 2 sessions to edit a list inside a
 * file the foundation owns. That is what produced the merge conflict this replaces.
 *
 * A subset check keeps the property that actually matters — an export cannot
 * silently DISAPPEAR — and drops the one that only generated conflicts.
 *
 * ⚠️ DOWNSTREAM SESSIONS: do not edit another wave's list. Adding an export to the
 * barrel requires no change here at all. Add a list of your own if you own a new
 * module, and change an existing list only when you are deliberately removing a
 * symbol from the surface its owner published.
 */
const FOUNDATION_SURFACE = [
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

const CHARACTER_KIT_SURFACE = [
  'BEAST_RIG',
  'CHARACTER_DETAIL_DISTANCE',
  'CHARACTER_VARIANTS',
  'WAGON_RIG',
  'buildBeastBody',
  'buildBeastHead',
  'buildBeastLimb',
  'buildBeastTail',
  'buildBirdBody',
  'buildBirdWing',
  'buildCloak',
  'buildDeerBody',
  'buildDeerCrown',
  'buildDeerLeg',
  'buildFace',
  'buildForearm',
  'buildHair',
  'buildHand',
  'buildHarness',
  'buildHead',
  'buildHeadgear',
  'buildOffhand',
  'buildOxBody',
  'buildOxHead',
  'buildShin',
  'buildThigh',
  'buildTorso',
  'buildTorsoTrim',
  'buildUpperArm',
  'buildWagonAxle',
  'buildWagonBed',
  'buildWagonCargo',
  'buildWagonFrame',
  'buildWagonTilt',
  'buildWagonWheel',
  'buildWeaponGrip',
  'buildWeaponHead',
  'buildWristRope',
  'characterKitForRole',
  'characterPartKeys',
  'cloakVariant',
  'forearmVariant',
  'resolveCharacterPlan',
  'shinVariant',
  'solveHandOffset',
  'thighVariant',
  'upperArmVariant',
]

const PROP_KIT_SURFACE = [
  'PROP_SURFACES',
  'bannerParts',
  'barrelGeometry',
  'brazierParts',
  'bridgeParts',
  'buildingParts',
  'bushGeometry',
  'cairnGeometry',
  'cartParts',
  'chestParts',
  'crateGeometry',
  'curtainWallParts',
  'deadfallGeometry',
  'fencePanelParts',
  'gateParts',
  'groundCoverGeometry',
  'haystackParts',
  'lanternPostParts',
  'marketStallParts',
  'mergePropParts',
  'monumentParts',
  'obeliskParts',
  'outcropGeometry',
  'pillarParts',
  'propPart',
  'reedClusterGeometry',
  'screeGeometry',
  'shrineParts',
  'signboardParts',
  'strataRockGeometry',
  'stumpGeometry',
  'tentParts',
  'towerParts',
  'transformParts',
  'treeGeometry',
  'washingLineParts',
  'waystoneParts',
  'wellParts',
  'woodpileGeometry',
]

/**
 * The counts are pinned separately from the lists themselves.
 *
 * A subset check is exactly the shape that passes by measuring nothing: empty the
 * array and every name in it is trivially present. `assert.deepEqual(missing, [])`
 * cannot tell "nothing is missing" from "nothing was looked for", so the sizes are
 * asserted before the membership is, and the test reports how many names each
 * assertion actually classified.
 *
 * **The size pin needs the uniqueness assertion beside it, and that is not obvious.**
 * S1 reviewed this guard and proposed the size pin alone — correctly, and it is the
 * clause everyone reaches for first. But a length is not a fingerprint: deleting
 * `mergeAll` and duplicating `fbm3` leaves the list at 36 names, so a size pin passes
 * while a real export has stopped being checked. **Under a length-only guard the
 * cheapest way to silence a regression is not to shrink the list, it is to pad it.**
 *
 * Both mutations are verified rather than argued:
 *
 *   delete 'mergeAll'                     -> red on the size pin
 *   delete 'mergeAll' + duplicate 'fbm3'  -> size back to 36, size pin PASSES,
 *                                            red on the uniqueness assertion only
 *
 * Neither clause subsumes the other. This is the `:2410` precedent one turn further
 * on: a floor stops a broken parse reporting success by finding *nothing*; uniqueness
 * stops a maintained list reporting success by finding the *same thing twice*. Empty
 * and degenerate are different failure modes and a count only sees the first.
 */
const SURFACE_SIZES = { foundation: 36, characterKit: 47, propKit: 39 }

/**
 * The same three pins written literally, by name.
 *
 * Redundant with the loop below, deliberately, and the reason is empirical rather than
 * stylistic: **three separate reviewers went looking for `FOUNDATION_SURFACE.length` and
 * none of them found it**, because the loop expresses the guarantee over a variable and
 * that spelling never appears as text. Each concluded the pin was missing and asked for
 * it to be added. The guarantee was present and passing the whole time.
 *
 * That is this file's own §13 theme aimed at itself: a check can be correct and still
 * be undiscoverable by a reader searching for the thing it protects. `git grep` is how
 * a reviewer asks *"is this pinned"*, and a guarantee that cannot answer that question
 * costs more in repeated review than the duplication costs in maintenance.
 *
 * The duplication is safe because it cannot diverge silently: if someone edits
 * `SURFACE_SIZES` without editing here, or vice versa, this assertion fails immediately
 * and names both numbers. A redundant check that goes red on divergence is not a second
 * source of truth — it is a cheap consistency proof between two statements of one.
 */
test('each frozen surface list is pinned to its exact length, by name', () => {
  assert.equal(FOUNDATION_SURFACE.length, 36)
  assert.equal(CHARACTER_KIT_SURFACE.length, 47)
  assert.equal(PROP_KIT_SURFACE.length, 39)

  // And the literals above must agree with the table the loop below reads, or one of
  // the two is being maintained and the other is decoration.
  assert.deepEqual(
    {
      foundation: FOUNDATION_SURFACE.length,
      characterKit: CHARACTER_KIT_SURFACE.length,
      propKit: PROP_KIT_SURFACE.length,
    },
    SURFACE_SIZES,
    'the by-name pins and SURFACE_SIZES disagree. They state the same fact twice so that '
    + 'a reviewer grepping for `FOUNDATION_SURFACE.length` finds an answer; if they can '
    + 'drift apart, the second copy is worse than useless. Update both.',
  )
})

test('the art barrel still exports every surface its owners published', async () => {
  const art = await import('../src/game/art/index.ts')
  const actual = new Set(Object.keys(art))

  const surfaces = [
    ['foundation (docs/08 §5)', FOUNDATION_SURFACE, SURFACE_SIZES.foundation],
    ['CharacterKit (docs/09 §5.1)', CHARACTER_KIT_SURFACE, SURFACE_SIZES.characterKit],
    ['PropKit (docs/10 §5)', PROP_KIT_SURFACE, SURFACE_SIZES.propKit],
  ] as const

  let classified = 0
  for (const [label, surface, size] of surfaces) {
    assert.equal(
      surface.length,
      size,
      `${label}: the frozen list is ${String(surface.length)} names but is pinned at `
      + `${String(size)}. A subset check over a shortened list passes by looking at `
      + 'less, so the size is asserted before the membership. Change both together, '
      + 'and only when deliberately removing a symbol from this surface.',
    )
    assert.equal(
      new Set(surface).size,
      surface.length,
      `${label}: the frozen list repeats a name, which inflates its size past a real removal`,
    )
    const missing = surface.filter((name) => !actual.has(name))
    assert.deepEqual(
      missing,
      [],
      `${label}: the barrel no longer exports these, so anything importing them from `
      + "`src/game/art` is broken. Restore the export, or remove it here and from the "
      + 'spec section named above in the same commit.',
    )
    classified += surface.length
  }

  // The three lists must together account for the barrel's whole runtime surface, or
  // a module could be dropped from `index.ts` entirely and every subset check above
  // would still pass — none of them looks at what is present but unlisted.
  assert.ok(
    actual.size >= classified,
    `the barrel exports ${String(actual.size)} runtime names but ${String(classified)} `
    + 'are pinned; the lists have drifted past the surface they describe',
  )
  const unlisted = [...actual].filter(
    (name) => !FOUNDATION_SURFACE.includes(name)
      && !CHARACTER_KIT_SURFACE.includes(name)
      && !PROP_KIT_SURFACE.includes(name),
  )
  // Deliberately NOT an assertion. A new export is not a defect, and making it one is
  // what forced two sibling sessions to edit this file and collide in it.
  if (unlisted.length > 0) {
    console.log(`note: art barrel exports ${String(unlisted.length)} unpinned names: ${unlisted.join(', ')}`)
  }
  assert.equal(
    classified,
    122,
    `expected to classify 122 published names, classified ${String(classified)}`,
  )
})

/**
 * The test above pins the barrel's *runtime* surface, and it cannot see two
 * things: type-only exports, which are erased before it runs, and — the reason
 * this exists — a spec that names a type the barrel never exported at all. That
 * second gap shipped twice. The spec said `Vec2[]` where the export is
 * `Vec2Like`, and it used `RandomStream` and `SeedInput` in four signatures that
 * the barrel did not re-export, so a sibling importing exactly what §5.2
 * documents got a compile error rather than a wrong result.
 *
 * So this reads the spec's own TypeScript blocks and requires every type they
 * name to be reachable from the barrel. It parses `index.ts` as text rather than
 * importing it, because a type-only export is invisible to `Object.keys`.
 */
test('every type the spec names is exported by the barrel', () => {
  const spec = readFileSync(
    new URL('../docs/08-graphics-foundation-spec.md', import.meta.url),
    'utf8',
  )
  const barrelSource = readFileSync(
    new URL('../src/game/art/index.ts', import.meta.url),
    'utf8',
  )

  const exported = new Set<string>()
  for (const match of barrelSource.matchAll(/^\s{2}(?:type\s+)?(\w+),\s*$/gm)) {
    exported.add(match[1]!)
  }
  for (const match of barrelSource.matchAll(/^export type \{\s*(\w+)\s*\}/gm)) {
    exported.add(match[1]!)
  }
  assert.ok(exported.size > 40, `barrel parse found only ${String(exported.size)} names`)

  // Only the ts-tagged fences. Prose names types loosely and would be noise.
  const fences = [...spec.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)```/g)]
    .map((match) => match[1]!)
  assert.ok(fences.length >= 4, `expected the spec's API blocks, found ${String(fences.length)}`)
  const code = fences.join('\n')

  // Names the spec declares itself are not expected to come from the barrel.
  const declared = new Set<string>()
  for (const match of code.matchAll(/\b(?:interface|type|class|enum)\s+(\w+)/g)) {
    declared.add(match[1]!)
  }

  const referenced = new Set<string>()
  for (const match of code.matchAll(/:\s*(?:readonly\s+)?([A-Z]\w*)/g)) {
    referenced.add(match[1]!)
  }
  for (const match of code.matchAll(/\breadonly\s+([A-Z]\w*)\[\]/g)) {
    referenced.add(match[1]!)
  }

  // `THREE.*` is qualified and resolves through three itself; `T` is a generic
  // parameter; the rest are ambient built-ins the spec uses in passing.
  const ambient = new Set(['THREE', 'T', 'Record', 'Partial', 'Readonly', 'Map', 'Set', 'Promise'])
  const unresolved = [...referenced]
    .filter((name) => !declared.has(name) && !exported.has(name) && !ambient.has(name))
    .sort()

  assert.deepEqual(
    unresolved,
    [],
    'docs/08 names these types but the art barrel does not export them, so code '
    + 'copied from the spec will not compile',
  )
})

/**
 * The gate above covers the type names in §5.2's signatures and nothing else. It
 * extracts identifiers in `: Position` and `readonly X[]` positions, and every
 * function name in this kit is lowercase and sits before a paren, so no function
 * has ever been checked by it. That leaves the more direct half of the same
 * contract unguarded: a sibling copying `createArtStream(...)` out of the spec
 * fails on the *call*, not on a type annotation.
 *
 * That is not hypothetical here. The neighbouring test records the type half
 * shipping broken twice, and a rename is strictly easier to get wrong than a type
 * reference, because renaming an export updates every call site the compiler can
 * see and leaves the one document that two other sessions are coding against
 * untouched. Nothing in `tsc -b`, `oxlint`, the suite or `vite build` reads
 * Markdown, so the spec is the only shipped artefact of mine with no automated
 * reader at all — which S3 found the hard way, with ten mangled lines in a file
 * three sessions had read and approved.
 *
 * Resolution is against the imported module rather than a regex over `index.ts`,
 * which is the difference between checking the contract and checking a parse of
 * it. Writing this, a barrel-text parser handling `export { x } from './y.ts'` in
 * list form but not single-line form reported `hasStylizedShader` missing — a red
 * light on correct code, from the check itself. `typeof bag[name] === 'function'`
 * cannot make that mistake: it asks the question a sibling's import asks.
 *
 * Deliberately scoped to fenced signatures. Prose in the baseline and retired-
 * budget sections cites `ComicMaterialLibrary` and `GEOMETRY_CACHE_ENTRIES_MAX`
 * precisely because they no longer exist, and widening this to every backticked
 * identifier would redden on text that is correct — which trains the next reader
 * to ignore it. The count floor is the other half: an extractor that silently
 * matches nothing passes a "no missing names" assertion perfectly.
 */
test('every function the spec declares in a signature block is a live export', () => {
  const spec = readFileSync(
    new URL('../docs/08-graphics-foundation-spec.md', import.meta.url),
    'utf8',
  )

  const fences = [...spec.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)```/g)]
    .map((match) => match[1]!)
  assert.ok(fences.length >= 4, `expected the spec's API blocks, found ${String(fences.length)}`)

  const declared = new Set<string>()
  for (const match of fences.join('\n').matchAll(/^\s*(?:export\s+)?function\s+(\w+)\s*[(<]/gm)) {
    declared.add(match[1]!)
  }
  assert.ok(
    declared.size >= 25,
    `spec parse found only ${String(declared.size)} signatures, so this cannot fail`,
  )

  const bag = artBarrel as unknown as Record<string, unknown>
  const missing = [...declared].filter((name) => typeof bag[name] !== 'function').sort()

  assert.deepEqual(
    missing,
    [],
    'docs/08 documents these functions but the art barrel does not export them, so '
    + 'code copied from the spec will not run',
  )
})

/**
 * A bulk material assignment by scene traversal is safe right up until someone
 * downstream parents an ink shell inside the group being swept, and then it
 * silently destroys the silhouette. `applyOutline` parents shells to their source,
 * so any group holding an outlined mesh holds shells too.
 *
 * The failure is invisible: the shell keeps its geometry and its transform and
 * simply stops extruding, so it renders as an exact duplicate of its source at the
 * same depth — a wasted draw, not a flicker. And nothing ever reassigns a shell's
 * material, so toggling ink off and on cannot repair it.
 *
 * S3 hit this on razed sites, where 12 of 12 sites lost their ink. Three of the
 * four material sweeps in `GameEngine.ts` were unguarded at the time. This is the
 * cheapest thing that stops a fourth: `isOutlineShell` is public and documented for
 * exactly this, but two sessions have now had to be told about it rather than being
 * stopped by anything.
 *
 * Deliberately repo-wide rather than scoped to one file, and deliberately not a list
 * to maintain: a sweep that trips this has a real bug and the fix is the guard, not
 * an entry in a table.
 *
 * **Wave 4 is authorised to narrow or delete this test rather than contort code to
 * satisfy it, and must delete it if shells become siblings of their source rather
 * than children** — that removes the class structurally and leaves this scanning for
 * a bug that can no longer exist. It parses TypeScript by paren balance over source
 * text, which is a heuristic scanner wearing a test's clothes, and merging three trees
 * will churn traversals heavily. Blocking integration on a parsing artifact costs more
 * than this test is worth.
 *
 * One self-defeat, found by reading these assertions rather than recalling them, then
 * measured, and now fixed. The floor used to be `sweeps.length >= 3`. Its only intended
 * job is *"the scan ran and didn't silently find nothing"* — but at 3 it additionally
 * encoded **"at least three separate material sweeps exist"**, a claim about code shape
 * nobody meant to make. The scan finds **4** (`GameEngine.ts` `:7460`, `:9974`, `:10661`,
 * `:10675`, all guarded), so the margin was **1**, and consolidating them into one
 * guarded helper — the fix this docblock argues for — would have dropped the count to 1
 * and turned the test red on a success.
 *
 * The general form, which is worth more than the instance:
 *
 * > **A floor that exists to prove the measurement ran can accidentally assert the shape
 * > of the thing measured. The tell is that the codebase improving makes it fail. Any
 * > assertion that goes red when the code gets better is asserting something nobody
 * > meant to.** The smallest value that still separates "ran" from "found nothing" is
 * > almost always 1.
 *
 * So the floor is 1, and the claim it was mistaken for — that the scan actually examined
 * every call site it found — is now made directly and shape-independently by the
 * `unterminated` assertion, which scales with whatever the tree contains.
 *
 * **Which of the four is load-bearing, contributed by S1 and verified here.** All four are
 * guarded, but three of the guards are defensive and one is live, and a consolidation that
 * kept "a guard" without keeping *that* guard would compile, pass, and break the game:
 *
 * ```text
 * GameEngine.ts:2168   this.player is outlined       registerOutline(this.player, 'player')
 * StylizedArtLibrary.ts:551   applyOutline does      source.add(shell)
 * GameEngine.ts:9893   restorePlayerLimb traverses   this.player.getObjectByName(part)
 * ```
 *
 * Shells are **children of their source mesh**, so that traversal walks real ink shells
 * every time a prosthetic is fitted — the `isOutlineShell` check at `:9898` is the only
 * one of the four that a player can actually reach. Its guard also predates the others in
 * this tree's history, which is the usual signature of the site somebody hit rather than
 * the site somebody anticipated.
 *
 * **What this test can and cannot detect**, stated because a scanner that reads as
 * exhaustive is the most dangerous kind. The paren walk counts parentheses in source
 * text, so one inside a string literal or a comment inside a traverse body closes it
 * early. A body truncated *after* `.material =` but *before* its guard reports a false
 * positive, which is loud and safe; a body truncated *before* `.material =` drops the
 * site silently, and that is the direction that matters. The `unterminated` assertion
 * catches both, because a traverse callback always ends at a closing brace and a
 * truncated capture almost never does — a detector, not a proof, and cheap enough to be
 * permanent rather than a measurement in prose that quietly stops being true.
 *
 * It was checked against a real parser rather than argued: running the same walk over a
 * copy with every string and comment span blanked out gives the identical end offset for
 * all 12 traverse sites, all 12 contain a callback, and 4 assign material. That is why
 * the brace check is stated as sufficient here — it agrees with the exact answer on
 * every site this tree has.
 *
 * And it is not redundant with the floor, which was measured rather than assumed. Insert
 * one line — `// closing this early: )` — inside a traverse body **and delete that body's
 * guard**, and the previous version of this test returns a **green clean bill on a
 * genuinely unguarded material sweep**: the truncated body loses `.material =` before
 * anyone notices, the site drops out of both lists, the remaining three still clear a
 * floor of three, and `unguarded` is empty for the worst possible reason. The version
 * below fails on it. **A scanner's own parse is part of its result, and until now
 * nothing here asserted it.**
 *
 * Before consolidating them, know that **one of the four is live in this tree** and the
 * other three are not. `:9974` `restorePlayerLimb` traverses a limb of `this.player`;
 * the player is outlined at `GameEngine.ts:2282`; and `applyOutline` parents each shell
 * as a *child of its source mesh* (`StylizedArtLibrary.ts:551`), so that traversal walks
 * real shells every time a prosthetic is fitted. Its guard is older than the other three
 * (`935c9a0`, not `774b0a2`) because that is the one someone hit. The razed-site, token
 * and ring sweeps are latent here only because nothing outlined happens to be parented
 * under what they walk — reachability, not absence of shells, and reachability is exactly
 * what a sibling changes. So the class is not hypothetical in this tree; it is reachable
 * at one site today. A consolidation may drop the count, but it must not drop the guard.
 */
test('every bulk material sweep by traversal excludes outline shells', () => {
  const root = new URL('../src/game/', import.meta.url)
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))

  const sweeps: string[] = []
  const unguarded: string[] = []
  const unterminated: string[] = []

  for (const name of files) {
    const source = readFileSync(new URL(name.split('\\').join('/'), root), 'utf8')
    for (const match of source.matchAll(/\.traverse\s*\(/g)) {
      // Walk from the traverse call's own paren to its match, so nested calls and
      // multi-line arrow bodies are captured whole.
      const open = match.index + match[0].length - 1
      let depth = 0
      let end = open
      let closed = false
      for (let i = open; i < source.length; i += 1) {
        if (source[i] === '(') depth += 1
        else if (source[i] === ')') {
          depth -= 1
          if (depth === 0) { end = i; closed = true; break }
        }
      }
      const line = source.slice(0, match.index).split('\n').length
      const label = `${name}:${String(line)}`
      if (!closed) { unterminated.push(label); continue }
      const body = source.slice(open, end)
      // A traverse callback is `(o) => { … }` or `function (o) { … }`, so a correctly
      // captured body ends at that callback's closing brace. One that ends anywhere else
      // was cut short — see the docblock on what cuts it short and why it matters.
      if (!/\}\s*$/.test(body)) { unterminated.push(`${label} (ends '${body.trimEnd().slice(-1)}')`); continue }
      if (!/\.material\s*=(?!=)/.test(body)) continue
      sweeps.push(label)
      if (!body.includes('isOutlineShell')) unguarded.push(label)
    }
  }

  // Every `.traverse(` the regex found must have yielded a body the paren walk closed at
  // a callback's closing brace. This is the claim the floor below is often mistaken for
  // and cannot make: the floor only notices the scan collapsing to nothing, while a walk
  // that ends in the wrong place for *one* site drops that site from both lists and reads
  // as a clean bill. Unlike a count it scales with whatever the tree contains, so it
  // cannot go red for the code improving.
  assert.deepEqual(
    unterminated,
    [],
    'the paren walk did not close at a callback brace for these traverse call sites, so '
    + 'their bodies were never examined and they are missing from both lists below',
  )

  // Floor of 1, not 3, and the reason is worth more than the test.
  //
  // A floor that exists to prove the *measurement ran* can accidentally assert the
  // *shape of the thing measured*, and the tell is that improving the codebase makes it
  // fail. At 3 this line additionally claimed "at least three separate material sweeps
  // exist" — a claim about code shape nobody meant to make. The scan finds 4, so the
  // margin was 1, and consolidating them into one guarded helper — the fix this
  // docblock argues for — drops the count to 1 and turns the test red on a success.
  //
  // The smallest value that still distinguishes "ran" from "found nothing" is 1. The
  // stronger claim now lives above, where it belongs, and is shape-independent.
  assert.ok(
    sweeps.length >= 1,
    'found no material-assigning traversal at all in src/game, which means the scan '
    + `broke rather than that the code is clean (${String(unterminated.length)} `
    + 'unterminated)',
  )
  assert.deepEqual(
    unguarded,
    [],
    'these traversals reassign Mesh.material without excluding ink shells; add '
    + '`StylizedArtLibrary.isOutlineShell(object)` to the guard',
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

/**
 * The deliberate counterpart to the test above, and the reason the two markers
 * are not symmetrical.
 *
 * A reviewer reading `isLibraryOwned` (symbol, must not survive a copy) beside
 * `isOutlineShell` (userData string, does survive a copy) will read the second
 * as a missed hardening and "fix" it. That would be a regression, and this test
 * is here to make it a loud one.
 *
 * The asymmetry follows from what each predicate claims. Ownership is a
 * *relationship* to the library: a clone the library never built must report
 * false, or teardown skips it forever. Shell-ness is an *intrinsic* property of
 * the object, and it has to survive cloning for a concrete reason that this test
 * pins directly — `Mesh.copy` assigns `geometry` by reference, so a cloned shell
 * shares the same borrowed buffer as the original. Disposing the clone frees the
 * source's geometry exactly as disposing the original would. A sweep that failed
 * to recognise the clone would commit the corruption the predicate exists to
 * prevent.
 */
test('outline shells survive cloning, because a clone shares the borrowed buffer', () => {
  const library = createLibrary()
  const root = new THREE.Group()
  const source = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  )
  root.add(source)
  const binding = library.applyOutline(root, 'enemy')
  const shell = binding.shells[0]
  assert.ok(shell, 'the fixture must actually produce a shell')
  assert.equal(StylizedArtLibrary.isOutlineShell(shell), true)

  const clone = shell.clone()

  // The premise. If three.js ever stopped sharing geometry across a clone, the
  // reasoning below would no longer hold and the marker rule should be revisited.
  assert.equal(
    clone.geometry,
    shell.geometry,
    'Mesh.copy assigns geometry by reference — this is why the marker must travel',
  )
  assert.equal(
    clone.geometry,
    source.geometry,
    'the shell borrows its source geometry, so the clone borrows it too',
  )

  // The consequence, measured rather than argued: disposing the clone fires
  // `dispose` on the buffer the source is still drawing from.
  let sourceBufferFreed = false
  source.geometry.addEventListener('dispose', () => {
    sourceBufferFreed = true
  })
  clone.geometry.dispose()
  assert.equal(
    sourceBufferFreed,
    true,
    'disposing a cloned shell frees the source buffer, so a sweep must decline it',
  )

  // The rule itself. Promote OUTLINE_MARKER to a symbol and this line fails.
  assert.equal(
    StylizedArtLibrary.isOutlineShell(clone),
    true,
    'a cloned shell is exactly as dangerous to dispose, so it must still be identifiable',
  )

  library.releaseOutline(binding)
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

/**
 * The shadow pass and the ink pass must ask the same question about opacity.
 *
 * Wave 4 review found them asking different ones. `applyOutline` has always tested the
 * material — a 62%-opaque ring has no silhouette to ink — while `GameEngine`'s
 * `markCharacterShadows` tested `userData.noComicOutline`, which is an *ink* marker
 * that covers transparent decorations only by coincidence. The two sets agreed on
 * contact shadows and faction rings, which carry the marker, and diverged on the one
 * transparent mesh in those four constructors that does not: the gilded caravan's
 * beacon torus. `transparent: true` exempts nothing from the depth pass — only
 * `castShadow` does — so three.js rendered it into the shadow map as a solid ring on
 * the ground under every gilded cart.
 *
 * `isOpaque` is now the single predicate both passes use, so this pins the predicate
 * rather than either caller. Each case below is a material shape that actually occurs
 * in this game, named for where.
 */
test('one predicate decides what has a silhouette, for ink and for shadows alike', () => {
  const cases: [label: string, material: THREE.Material | THREE.Material[], opaque: boolean][] = [
    ['a character body', new THREE.MeshStandardMaterial({ color: 0x884422 }), true],
    // The exact shape of the gilded caravan's beacon, which is what was casting.
    ['the caravan beacon', new THREE.MeshBasicMaterial({
      color: 0xffcc44,
      transparent: true,
      opacity: 0.62,
    }), false],
    // `transparent` false but faded: three.js still blends, and the silhouette is still
    // not solid. A predicate testing only the flag would call this opaque.
    ['a faded mesh with transparent unset', Object.assign(
      new THREE.MeshStandardMaterial({ color: 0x224488 }),
      { opacity: 0.4 },
    ), false],
    ['a faction ring', new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.48 }), false],
    // A multi-material mesh is only opaque if every slot is; a merged prop with one
    // glass surface has a hole in its silhouette wherever that group draws.
    ['a merged prop, all slots solid', [
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
      new THREE.MeshStandardMaterial({ color: 0x777777 }),
    ], true],
    ['a merged prop with one glass slot', [
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 }),
    ], false],
    // An empty material array draws nothing at all, and "nothing" is not a silhouette.
    ['a mesh with no materials', [], false],
  ]

  let judgedOpaque = 0
  let judgedTransparent = 0
  for (const [label, material, opaque] of cases) {
    assert.equal(
      StylizedArtLibrary.isOpaque(material),
      opaque,
      `${label} should be ${opaque ? 'opaque' : 'non-opaque'}`,
    )
    if (opaque) judgedOpaque += 1
    else judgedTransparent += 1
    for (const entry of Array.isArray(material) ? material : [material]) entry.dispose()
  }

  // Domain guard, and it has to be two-sided. A predicate that returned `true` for
  // everything and one that returned `false` for everything would each satisfy a
  // one-sided sweep, so both verdicts have to be exercised and counted.
  assert.ok(judgedOpaque >= 2, `only ${String(judgedOpaque)} opaque cases were judged`)
  assert.ok(
    judgedTransparent >= 4,
    `only ${String(judgedTransparent)} non-opaque cases were judged`,
  )

  // And the two callers must be the same caller. `applyOutline` gates on this
  // predicate; assert it declines to ink the beacon, so the shadow rule this now backs
  // is anchored to observed behaviour rather than to a shared function name.
  const library = createLibrary()
  const root = new THREE.Group()
  const solid = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    library.createMaterial({ color: 0x884422, surface: 'cloth' }),
  )
  const beacon = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.12, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.62 }),
  )
  root.add(solid, beacon)
  const binding = library.applyOutline(root, 'landmark')
  assert.equal(binding.shells.length, 1, 'exactly the solid mesh should have been inked')
  assert.equal(
    beacon.children.length,
    0,
    'the beacon was given an ink shell, so the two passes have drifted apart again',
  )
  library.releaseOutline(binding)
  library.dispose()
})
