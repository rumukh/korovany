import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { artVariation } from '../src/game/art/ArtRandom.ts'
import { GeometryCache } from '../src/game/art/GeometryCache.ts'
import {
  bridgeParts,
  buildingParts,
  fencePanelParts,
  mergePropParts,
  monumentParts,
  outcropGeometry,
  propPart,
  strataRockGeometry,
  StylizedArtLibrary,
  stumpGeometry,
  treeGeometry,
  wellParts,
  type BuildingPalette,
  type PropPalette,
  type RoofStyle,
  type TreeSpecies,
  type WallStyle,
} from '../src/game/art/index.ts'
import { SITE_PRESENTATIONS } from '../src/game/content/registry.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import {
  buildingSpecKey,
  composeSiteLayout,
  type SitePropKind,
} from '../src/game/world/SiteComposition.ts'
import {
  WorldPropLibrary,
  type PropRequest,
} from '../src/game/world/WorldPropLibrary.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import type { SiteKind, Territory, WorldBlueprint } from '../src/game/world/worldTypes.ts'

/**
 * §10 — world objects and props.
 *
 * Three things are actually load bearing here and each one has cost the project a
 * bug before: geometry that a vertex-coloured material renders black without, cache
 * references that have to balance across region streaming, and the ink budget that
 * turns into frame time the moment nobody counts it.
 */

const PROP_PALETTE: PropPalette = {
  timber: 0x8a6a44,
  timberShade: 0x4a3524,
  stone: 0x9aa0a8,
  stoneShade: 0x4b5158,
  metal: 0x7d8590,
  cloth: 0xb4462f,
  clothAccent: 0xe0c78a,
  glow: 0xffc46a,
  accent: 0xc48742,
}

const BUILDING_PALETTE: BuildingPalette = {
  foundation: 0x6c6f74,
  wall: 0xd6c7a4,
  wallShade: 0x8d8262,
  timber: 0x6a4a2f,
  roof: 0x8a5a3a,
  roofShade: 0x4a2f1e,
  roofRidge: 0x5a4030,
  trim: 0xa08560,
  door: 0x5e3d26,
  glass: 0x18202a,
  glow: 0xffc46a,
}

const WALL_STYLES: readonly WallStyle[] = ['timber-frame', 'log', 'stone', 'plank']
const ROOF_STYLES: readonly RoofStyle[] = [
  'thatch',
  'shingle',
  'tile',
  'flat',
  'conical',
]
const TREE_SPECIES: readonly TreeSpecies[] = [
  'conifer',
  'broadleaf',
  'slender',
  'dead',
  'topiary',
  'thorn',
]
const SITE_KINDS: readonly SiteKind[] = [
  'faction-start',
  'final-stronghold',
  'settlement',
  'shop',
  'recovery',
  'event',
  'treasure',
  'landmark',
]
const TERRITORIES: readonly Territory[] = ['elf', 'guard', 'villain', 'neutral']
const BIOMES = ['neutral', 'palace', 'forest', 'fort'] as const
const GROUND_COVERS = ['fern', 'flower', 'grass', 'pebble'] as const
const FENCE_STYLES = ['rail', 'palisade', 'picket', 'iron', 'curtain'] as const
const PROP_DETAILS = ['near', 'far'] as const
const SITE_PROP_KINDS: readonly SitePropKind[] = [
  'banner',
  'barrel',
  'brazier',
  'cairn',
  'cart',
  'chest',
  'crate',
  'gate',
  'lantern',
  'monument',
  'obelisk',
  'pillar',
  'shrine',
  'signboard',
  'stall',
  'tent',
  'tower',
  'washing-line',
  'waystone',
  'well',
  'woodpile',
]

/**
 * Every prop the world is capable of asking for.
 *
 * Enumerated from the request union rather than hand-listed, because the winding
 * bug that filled every outlined prop solid survived a full independent review by
 * hiding in a builder nobody had thought to name: the check that existed was scoped
 * to the one reported shape instead of the whole family. A test over a hand-written
 * subset re-creates exactly that blind spot the first time someone adds a builder
 * and forgets to add a case.
 */
function everyPropRequest(): Array<[string, PropRequest]> {
  const requests: Array<[string, PropRequest]> = []
  for (const biome of BIOMES) {
    for (let slot = 0; slot < 3; slot += 1) {
      for (const detail of PROP_DETAILS) {
        requests.push([`tree/${biome}/${String(slot)}/${detail}`, { kind: 'tree', biome, slot, detail }])
        requests.push([`rock/${biome}/${String(slot)}/${detail}`, { kind: 'rock', biome, slot, detail }])
      }
      requests.push([`undergrowth/${biome}/${String(slot)}`, { kind: 'undergrowth', biome, slot }])
    }
    requests.push([`reeds/${biome}`, { kind: 'reeds', biome }])
    for (const cover of GROUND_COVERS) {
      requests.push([`ground/${biome}/${cover}`, { kind: 'groundCover', biome, cover }])
    }
    for (const detail of PROP_DETAILS) {
      requests.push([
        `bridge/${biome}/${detail}`,
        { kind: 'bridge', biome, owner: 'neutral', span: 9, width: 4, detail },
      ])
    }
  }
  for (const owner of TERRITORIES) {
    for (const style of FENCE_STYLES) {
      requests.push([
        `fence/${style}/${owner}`,
        { kind: 'fence', style, biome: 'forest', owner, length: 6 },
      ])
    }
    for (const prop of SITE_PROP_KINDS) {
      requests.push([
        `siteProp/${prop}/${owner}`,
        { kind: 'siteProp', prop, biome: 'forest', owner, variant: 0, length: 4 },
      ])
    }
    for (const roofStyle of ROOF_STYLES) {
      for (const wallStyle of WALL_STYLES) {
        for (const detail of PROP_DETAILS) {
          requests.push([
            `building/${roofStyle}/${wallStyle}/${owner}/${detail}`,
            {
              kind: 'building',
              biome: 'forest',
              owner,
              detail,
              spec: {
                width: 5,
                depth: 4,
                wallHeight: 3,
                storeys: 1,
                wallStyle,
                roofStyle,
                windows: 2,
                chimney: true,
                porch: true,
                balcony: false,
                crenellated: false,
              },
            },
          ])
        }
      }
    }
  }
  return requests
}

/**
 * Worst angle, in degrees, between a face's geometric normal and the shading normal
 * its vertices carry.
 *
 * `windingDisagreements` is a **sign** test, so it is blind to a normal that points
 * the roughly-right way but is badly wrong in magnitude. That is exactly the shape of
 * the collapsed-section defect: a loft section that pinches to zero takes its normal
 * from a zeroed edge and falls back to straight up, so a downward spike shades as
 * though it points at the sky — measured upstream at 104-125 degrees, and passing a
 * sign test cleanly the whole time.
 *
 * Smooth-shaded revolved solids legitimately run high here (a healthy capsule is
 * about 21 degrees, the coarse pillar lathe about 73), so this is not a tight bound.
 * It exists to catch the >90 degree signature, where a normal has diverged so far
 * from its face that it is no longer describing the same surface.
 */
function worstNormalError(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return 0
  const index = geometry.index
  const triangles = index ? index.count / 3 : position.count / 3
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const geometric = new THREE.Vector3()
  const shading = new THREE.Vector3()
  let worst = 0
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const offset = triangle * 3
    const first = index ? index.getX(offset) : offset
    const second = index ? index.getX(offset + 1) : offset + 1
    const third = index ? index.getX(offset + 2) : offset + 2
    a.fromBufferAttribute(position, first)
    b.fromBufferAttribute(position, second)
    c.fromBufferAttribute(position, third)
    edgeA.subVectors(b, a)
    edgeB.subVectors(c, a)
    geometric.crossVectors(edgeA, edgeB)
    if (geometric.lengthSq() < 1e-12) continue
    geometric.normalize()
    shading.set(0, 0, 0)
    for (const vertex of [first, second, third]) {
      shading.x += normal.getX(vertex)
      shading.y += normal.getY(vertex)
      shading.z += normal.getZ(vertex)
    }
    // A zeroed shading normal is the collapsed-section failure in its purest form.
    if (shading.lengthSq() < 1e-12) return 180
    shading.normalize()
    const degrees =
      (Math.acos(Math.max(-1, Math.min(1, geometric.dot(shading)))) * 180) / Math.PI
    if (degrees > worst) worst = degrees
  }
  return worst
}

/**
 * Faces wound inward relative to the geometry's centroid, and how many faces the
 * question could be asked of at all.
 *
 * The third instrument, and the only one that localises. The other two both fail on a
 * *partial* inversion, which is the realistic shape of the fault:
 *
 * - `windingDisagreements` reads the normals, and `displaceGeometry` derives normals
 *   **from** winding via `computeVertexNormals()`. Measured on this pass's own builders,
 *   it misses a reversal at every fraction **including 100%** — after displacement the
 *   reversed faces carry reversed normals and agree tautologically. It is not weak on
 *   displaced geometry, it is blind.
 * - `signedVolume` is a sum, so reversed faces cancel against correct ones. Measured:
 *   it misses 5% on every prop tried and 25% on a fort rock.
 *
 * Centroid winding reads no normals and is per-face, so it survives both. Its own limit
 * is that it assumes roughly star-convex geometry: a face orthogonal to the centroid ray
 * carries no signal, and a concave prop has legitimately inward faces — a building's
 * porch recesses and window reveals put its healthy baseline at 300 of 844. So it is
 * used here for **sensitivity**, not for an absolute `=== 0`, and faces below the
 * decisiveness floor are excluded rather than counted as inverted.
 */
function centroidInwardFaces(geometry: THREE.BufferGeometry): {
  inward: number
  decisive: number
} {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const triangles = index ? index.count / 3 : position.count / 3
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const face = new THREE.Vector3()
  const middle = new THREE.Vector3()
  const ray = new THREE.Vector3()
  const centre = new THREE.Vector3()
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    centre.x += position.getX(vertex)
    centre.y += position.getY(vertex)
    centre.z += position.getZ(vertex)
  }
  centre.divideScalar(Math.max(1, position.count))
  let inward = 0
  let decisive = 0
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const offset = triangle * 3
    const first = index ? index.getX(offset) : offset
    const second = index ? index.getX(offset + 1) : offset + 1
    const third = index ? index.getX(offset + 2) : offset + 2
    a.fromBufferAttribute(position, first)
    b.fromBufferAttribute(position, second)
    c.fromBufferAttribute(position, third)
    edgeA.subVectors(b, a)
    edgeB.subVectors(c, a)
    face.crossVectors(edgeA, edgeB)
    if (face.lengthSq() < 1e-14) continue
    face.normalize()
    middle.copy(a).add(b).add(c).divideScalar(3)
    ray.subVectors(middle, centre)
    if (ray.lengthSq() < 1e-14) continue
    ray.normalize()
    const alignment = face.dot(ray)
    // Orthogonal to the ray: the invariant has nothing to say about this face. A flat
    // annulus reports every face "inward" at |cos| = 0 without being malformed.
    if (Math.abs(alignment) < 0.08) continue
    decisive += 1
    if (alignment < 0) inward += 1
  }
  return { inward, decisive }
}

/**
 * Reverses a fraction of a geometry's faces, then recomputes normals from the result.
 *
 * Damage is spread by stride rather than taken as a block from index zero. A block can
 * land entirely on faces the centroid check cannot read — the tower lathe's first 2%
 * are all near-orthogonal to the centroid ray — which measures where the damage was put
 * rather than whether the instrument works.
 */
function reverseFaceFraction(
  geometry: THREE.BufferGeometry,
  fraction: number,
): THREE.BufferGeometry {
  const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = copy.getAttribute('position')
  const triangles = Math.floor(position.count / 3)
  const wanted = Math.max(1, Math.round(triangles * fraction))
  const stride = Math.max(1, Math.floor(triangles / wanted))
  for (let triangle = 0; triangle < triangles; triangle += stride) {
    const first = triangle * 3
    const third = first + 2
    for (const attribute of Object.values(copy.attributes)) {
      for (let part = 0; part < attribute.itemSize; part += 1) {
        const array = attribute.array as unknown as number[]
        const left = first * attribute.itemSize + part
        const right = third * attribute.itemSize + part
        const swap = array[left]
        array[left] = array[right]
        array[right] = swap
      }
    }
  }
  // The displacement model: normals derived from whatever the winding now says.
  copy.computeVertexNormals()
  return copy
}

/** Triangles whose vertex order disagrees with the normal the builder stored. */
function windingDisagreements(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return 0
  const index = geometry.index
  const triangles = index ? index.count / 3 : position.count / 3
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const geometric = new THREE.Vector3()
  const shading = new THREE.Vector3()
  let disagree = 0
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const offset = triangle * 3
    const first = index ? index.getX(offset) : offset
    const second = index ? index.getX(offset + 1) : offset + 1
    const third = index ? index.getX(offset + 2) : offset + 2
    a.fromBufferAttribute(position, first)
    b.fromBufferAttribute(position, second)
    c.fromBufferAttribute(position, third)
    edgeA.subVectors(b, a)
    edgeB.subVectors(c, a)
    geometric.crossVectors(edgeA, edgeB)
    // A degenerate sliver has no orientation to be wrong about.
    if (geometric.lengthSq() < 1e-12) continue
    shading.set(0, 0, 0)
    for (const vertex of [first, second, third]) {
      shading.x += normal.getX(vertex)
      shading.y += normal.getY(vertex)
      shading.z += normal.getZ(vertex)
    }
    if (geometric.dot(shading) < 0) disagree += 1
  }
  return disagree
}

const RUNTIME_OPTIONS = {
  terrainResolution: 6,
  decorationDensity: 1,
} as const

function createRuntime(seed: string | number) {
  const scene = new THREE.Scene()
  const blueprint = generateWorld(seed)
  const runtime = new GeneratedWorldRuntime(scene, blueprint, {
    ...RUNTIME_OPTIONS,
    outlineDressing: true,
  })
  return { scene, blueprint, runtime }
}

function focusRegion(
  runtime: GeneratedWorldRuntime,
  blueprint: WorldBlueprint,
  predicate: (region: WorldBlueprint['regions'][number]) => boolean,
): void {
  const region = blueprint.regions.find(predicate)
  assert.ok(region)
  const center = runtime.getRegionCenter(region.id)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })
}

function attributeDigest(geometry: THREE.BufferGeometry, name: string): string {
  const attribute = geometry.getAttribute(name)
  assert.ok(attribute, `missing ${name} attribute`)
  let hash = 0x811c9dc5
  for (let index = 0; index < attribute.array.length; index += 1) {
    // Quantized so the digest is stable across the last bit of float noise while
    // still catching any real change in shape or colour.
    const value = Math.round((attribute.array[index] as number) * 4096)
    hash = Math.imul(hash ^ (value & 0xffff), 0x01000193) >>> 0
    hash = Math.imul(hash ^ (value >>> 16), 0x01000193) >>> 0
  }
  return hash.toString(16)
}

test('every prop geometry carries the colour attribute its material needs', () => {
  const checked: Array<[string, THREE.BufferGeometry]> = []

  for (const species of TREE_SPECIES) {
    checked.push([
      `tree:${species}`,
      treeGeometry(species, {
        variation: artVariation('props', `tree:${species}`),
        noiseSeed: 0x51ee7,
        palette: {
          bark: 0x7a5a3a,
          barkShade: 0x33241a,
          canopyLow: 0x1c3a28,
          canopyHigh: 0x64a355,
        },
      }),
    ])
  }

  checked.push([
    'rock',
    strataRockGeometry({
      variation: artVariation('props', 'rock'),
      noiseSeed: 0xb0d1e,
      palette: { low: 0x2e3138, high: 0x8b9298, cap: 0x3f6a3a },
    }),
  ])

  for (const wallStyle of WALL_STYLES) {
    for (const roofStyle of ROOF_STYLES) {
      const parts = buildingParts({
        variation: artVariation('props', `building:${wallStyle}:${roofStyle}`),
        noiseSeed: 0xb0115,
        palette: BUILDING_PALETTE,
        width: 5,
        depth: 4,
        wallHeight: 3,
        storeys: 2,
        wallStyle,
        roofStyle,
        windows: 2,
        chimney: true,
        porch: true,
        balcony: true,
        crenellated: roofStyle === 'flat',
        lit: true,
      })
      assert.ok(parts.length >= 1)
      for (const part of parts) {
        checked.push([`building:${wallStyle}:${roofStyle}:${part.surface}`, part.geometry])
      }
    }
  }

  for (const parts of [
    wellParts({ variation: artVariation('props', 'well'), noiseSeed: 1, palette: PROP_PALETTE }),
    monumentParts({
      variation: artVariation('props', 'monument'),
      noiseSeed: 2,
      palette: PROP_PALETTE,
    }),
    fencePanelParts({
      variation: artVariation('props', 'fence'),
      noiseSeed: 3,
      palette: PROP_PALETTE,
      style: 'palisade',
      length: 5,
    }),
    bridgeParts({
      variation: artVariation('props', 'bridge'),
      noiseSeed: 4,
      palette: PROP_PALETTE,
      span: 14,
      width: 6,
      style: 'timber',
    }),
  ]) {
    for (const part of parts) checked.push([`prop:${part.surface}`, part.geometry])
  }

  for (const [label, geometry] of checked) {
    const position = geometry.getAttribute('position')
    assert.ok(position.count > 0, `${label} produced no geometry`)
    assert.ok(
      geometry.getAttribute('color'),
      `${label} has no colour attribute and would render black`,
    )
    const colors = geometry.getAttribute('color')
    assert.equal(colors.count, position.count, `${label} colour count mismatch`)
    for (let index = 0; index < position.count * 3; index += 1) {
      assert.ok(
        Number.isFinite(colors.array[index] as number),
        `${label} has a non-finite vertex colour`,
      )
    }
    for (let index = 0; index < position.count * 3; index += 1) {
      assert.ok(
        Number.isFinite(position.array[index] as number),
        `${label} has a non-finite position`,
      )
    }
  }
})

/**
 * Signed volume of a mesh. Positive means the triangles face outwards.
 *
 * This is the assertion that actually protects the ink, and it is deliberately
 * independent of the shading normals. `displaceGeometry` recomputes normals *from*
 * the winding, so after it runs a reversed prop has reversed normals too and the
 * two agree perfectly — a normal-agreement check goes quiet at exactly the moment
 * it would matter most. Volume does not care what the normals claim.
 */
function signedVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const count = index ? index.count : position.count
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const cross = new THREE.Vector3()
  let total = 0
  for (let offset = 0; offset < count; offset += 3) {
    const first = index ? index.getX(offset) : offset
    const second = index ? index.getX(offset + 1) : offset + 1
    const third = index ? index.getX(offset + 2) : offset + 2
    a.fromBufferAttribute(position, first)
    b.fromBufferAttribute(position, second)
    c.fromBufferAttribute(position, third)
    cross.crossVectors(b, c)
    total += a.dot(cross) / 6
  }
  return total
}

test('every prop faces outwards, measured by volume rather than by normals', () => {
  const cases: Array<[string, THREE.BufferGeometry]> = []
  for (const species of TREE_SPECIES) {
    cases.push([
      `tree:${species}`,
      treeGeometry(species, {
        variation: artVariation('props', `volume:${species}`),
        noiseSeed: 0x501d,
        palette: {
          bark: 0x7a5a3a,
          barkShade: 0x33241a,
          canopyLow: 0x1c3a28,
          canopyHigh: 0x64a355,
        },
      }),
    ])
  }
  cases.push([
    'rock',
    strataRockGeometry({
      variation: artVariation('props', 'volume:rock'),
      noiseSeed: 0xb0d,
      palette: { low: 0x2e3138, high: 0x8b9298 },
    }),
  ])
  cases.push([
    'outcrop',
    outcropGeometry({
      variation: artVariation('props', 'volume:outcrop'),
      noiseSeed: 0x0c,
      palette: { low: 0x2e3138, high: 0x8b9298 },
    }),
  ])
  cases.push([
    'stump',
    stumpGeometry({
      variation: artVariation('props', 'volume:stump'),
      noiseSeed: 0x57,
      low: 0x4a3524,
      high: 0xa08a60,
    }),
  ])
  for (const roofStyle of ROOF_STYLES) {
    cases.push([
      `building:${roofStyle}`,
      buildingParts({
        variation: artVariation('props', `volume:${roofStyle}`),
        noiseSeed: 0xb0115,
        palette: BUILDING_PALETTE,
        width: 5,
        depth: 4,
        wallHeight: 3,
        wallStyle: 'timber-frame',
        roofStyle,
        windows: 2,
        chimney: true,
      })[0].geometry,
    ])
  }

  for (const [label, geometry] of cases) {
    assert.ok(
      signedVolume(geometry) > 0,
      `${label} is inside out; a BackSide ink hull over it would fill the silhouette`,
    )
  }
})

test('a partial inversion is detectable, which volume and normals alone cannot manage', () => {
  // A review measured that this suite's two orientation instruments both miss a
  // *partial* reversal — the realistic fault, since a builder inverts one section, not
  // a whole prop. Reproduced on this pass's own builders, reversing a fraction of the
  // faces and recomputing normals from the result:
  //
  //   building   2% reversed   volume +97.4 (missed)   normal agreement (missed)
  //   fort rock  25% reversed  volume  +1.0 (missed)   normal agreement (missed)
  //
  // Normal agreement misses at **every** fraction including 100%, because
  // `computeVertexNormals` derives the normals from the reversed winding. Signed volume
  // is a sum and the reversed faces cancel against the correct ones. Centroid winding
  // reads no normals and is per-face, so it sees what both of them miss.
  //
  // These props are not star-convex — a building's porch recesses and window reveals
  // give it a healthy baseline of ~300 inward faces of 844 — so the assertion is
  // sensitivity, not `=== 0`.
  const library = new WorldPropLibrary({ retention: 0 })
  const cases: Array<[string, PropRequest]> = [
    [
      'building',
      {
        kind: 'building',
        biome: 'forest',
        owner: 'elf',
        detail: 'near',
        spec: {
          width: 5,
          depth: 4,
          wallHeight: 3,
          storeys: 1,
          wallStyle: 'timber-frame',
          roofStyle: 'thatch',
          windows: 2,
          chimney: true,
          porch: true,
          balcony: false,
          crenellated: false,
        },
      },
    ],
    ['rock', { kind: 'rock', biome: 'fort', slot: 0, detail: 'near' }],
    ['crate', { kind: 'siteProp', prop: 'crate', biome: 'forest', owner: 'neutral', variant: 0 }],
    ['tower', { kind: 'siteProp', prop: 'tower', biome: 'forest', owner: 'guard', variant: 0 }],
    ['bridge', { kind: 'bridge', biome: 'forest', owner: 'neutral', span: 9, width: 4, detail: 'near' }],
  ]
  try {
    for (const [label, request] of cases) {
      const asset = library.acquire(request)
      const hard = asset.surfaces.find((surface) => surface.surface === 'hard')
      assert.ok(hard, `${label} has no hard surface`)
      const shipped = centroidInwardFaces(hard.geometry)
      assert.ok(
        shipped.decisive > 0,
        `${label}: no face carries centroid signal, so the check says nothing`,
      )

      // Two percent is well below what either other instrument can see.
      const damaged = reverseFaceFraction(hard.geometry, 0.02)
      const after = centroidInwardFaces(damaged)
      assert.ok(
        after.inward > shipped.inward,
        `${label}: reversing 2% of faces did not raise the inward count `
        + `(${String(shipped.inward)} -> ${String(after.inward)}), so this suite `
        + 'cannot detect a partial inversion at all',
      )
      damaged.dispose()
      library.release(asset)
    }
  } finally {
    library.dispose()
  }
})

test('every prop the world can build is oriented outwards', () => {
  // The family-wide version of the check above, measured two ways because each is
  // blind where the other sees. `loftProfile` wound every triangle against its
  // stored normal, which put a BackSide ink hull in front of the object instead of
  // behind it, and it survived review because the winding check in place covered
  // only the single builder that had been reported.
  //
  // Controls first, so the detector is known to discriminate before it is trusted to
  // report zero across 500-odd geometries. A check that cannot fail is worse than no
  // check, because it reads as evidence.
  const control = new THREE.BoxGeometry(1, 1, 1)
  assert.equal(windingDisagreements(control), 0, 'a stock box is wound correctly')
  const reversed = control.toNonIndexed()
  const position = reversed.getAttribute('position')
  for (let triangle = 0; triangle < position.count / 3; triangle += 1) {
    const first = triangle * 3
    const third = first + 2
    for (const attribute of Object.values(reversed.attributes)) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        const a = attribute.array[first * attribute.itemSize + component]
        attribute.array[first * attribute.itemSize + component] =
          attribute.array[third * attribute.itemSize + component]
        attribute.array[third * attribute.itemSize + component] = a
      }
    }
  }
  assert.ok(
    windingDisagreements(reversed) > 0,
    'the detector must notice a deliberately reversed box',
  )
  control.dispose()
  reversed.dispose()

  // The control above is non-indexed, and a *correctly wound* control cannot detect
  // index-blindness at all: a checker that ignores the index still reads 0 on stock
  // three.js primitives, because they are correctly wound. Only an indexed pair
  // exposes it, and the discriminating half is the *stock* geometry — an index-blind
  // walk reassembles it into `floor(vertexCount / 3)` pseudo-triangles from vertices
  // that were never a triangle, and reports a nonzero artefact on geometry that is
  // perfectly fine. Measured: an index-blind walk reports 6 for this sphere whether
  // it is correct or fully reversed, i.e. its answer is uncorrelated with the thing
  // it claims to measure. That is how a reversed lathe once read as a partial flip.
  const indexed = new THREE.SphereGeometry(1, 8, 6)
  assert.ok(indexed.index, 'the indexed control must actually be indexed')
  assert.equal(
    windingDisagreements(indexed),
    0,
    'the detector is index-blind: a correctly wound indexed sphere must report zero',
  )
  const flipped = indexed.clone()
  const flippedIndex = flipped.index
  assert.ok(flippedIndex)
  for (let triangle = 0; triangle < flippedIndex.count / 3; triangle += 1) {
    const offset = triangle * 3
    const second = flippedIndex.getX(offset + 1)
    flippedIndex.setX(offset + 1, flippedIndex.getX(offset + 2))
    flippedIndex.setX(offset + 2, second)
  }
  // Reversed purely through the index buffer: every position byte is untouched, so
  // this is invisible to anything that reads positions in raw triples.
  assert.ok(
    windingDisagreements(flipped) > flippedIndex.count / 6,
    'reversing every triangle must make most of them disagree',
  )
  indexed.dispose()
  flipped.dispose()

  const library = new WorldPropLibrary({ retention: 0 })
  const requests = everyPropRequest()
  let geometries = 0
  const failures: string[] = []
  const open: string[] = []
  try {
    for (const [label, request] of requests) {
      for (const part of library.build(request)) {
        geometries += 1
        const disagree = windingDisagreements(part.geometry)
        if (disagree > 0) {
          failures.push(`${label}#${part.surface}: ${String(disagree)} triangles`)
        }
        // Magnitude, not just sign — see `worstNormalError`. A collapsed loft section
        // shades a downward spike as though it pointed at the sky, which a sign test
        // waves through.
        const error = worstNormalError(part.geometry)
        if (error > 90) {
          failures.push(
            `${label}#${part.surface}: normal ${error.toFixed(1)}deg from its face`,
          )
        }
        // Both metrics in one pass. Building the whole request space is the most
        // expensive thing in this file, and `generatedWorldRuntime.test.ts` is
        // already the dominant concurrent load in the suite — walking it twice to
        // measure two properties of the same geometry buys nothing.
        if (signedVolume(part.geometry) <= 0) open.push(label)
        part.geometry.dispose()
      }
    }
  } finally {
    library.dispose()
  }
  assert.deepEqual(failures, [], 'props wound against their normals')
  // Signed volume is the assertion that survives `displaceGeometry` recomputing
  // normals, but it is only meaningful for a closed solid. Rather than skip the open
  // shapes, pin exactly which ones they are: a builder that turns inside out joins
  // this set and fails, and a shape that becomes closed also fails and gets removed.
  // Fern fronds are sheets, one per biome; everything else the world draws is solid.
  assert.deepEqual(
    open.sort(),
    BIOMES.map((biome) => `ground/${biome}/fern`).sort(),
    'an unexpected prop encloses no volume, which usually means it is inside out',
  )
  // Guards the enumeration itself: a request space that quietly stopped producing
  // anything would otherwise pass this test with flying colours.
  assert.ok(
    geometries >= 500,
    `only ${String(geometries)} geometries were checked; the enumeration has holes`,
  )
})

test('every prop winds its triangles to agree with its shading normals', () => {  const cases: Array<[string, THREE.BufferGeometry]> = [
    [
      'building',
      buildingParts({
        variation: artVariation('props', 'winding-building'),
        noiseSeed: 5,
        palette: BUILDING_PALETTE,
        width: 5,
        depth: 4,
        wallHeight: 3,
        storeys: 2,
        wallStyle: 'timber-frame',
        roofStyle: 'thatch',
        windows: 2,
        chimney: true,
        porch: true,
        balcony: true,
      })[0].geometry,
    ],
    [
      'tree',
      treeGeometry('conifer', {
        variation: artVariation('props', 'winding-tree'),
        noiseSeed: 6,
        palette: {
          bark: 0x7a5a3a,
          barkShade: 0x33241a,
          canopyLow: 0x1c3a28,
          canopyHigh: 0x64a355,
        },
      }),
    ],
    [
      'rock',
      strataRockGeometry({
        variation: artVariation('props', 'winding-rock'),
        noiseSeed: 7,
        palette: { low: 0x2e3138, high: 0x8b9298 },
      }),
    ],
    [
      'well',
      mergePropParts(
        wellParts({
          variation: artVariation('props', 'winding-well'),
          noiseSeed: 8,
          palette: PROP_PALETTE,
        }),
        { name: 'winding-well' },
      )[0].geometry,
    ],
  ]

  // A `BackSide` inverted-hull outline over reversed geometry renders the *near*
  // faces and paints the whole prop the colour of its own ink. The shared geometry
  // kit wound its lofts backwards once; this is the assertion that says the merged
  // compositions built on top of it come out the right way round.
  //
  // Delegates to the one index-aware checker rather than re-walking the buffers.
  // This loop used to read raw position triples, which silently misreads any indexed
  // geometry as `floor(vertexCount / 3)` pseudo-triangles assembled from vertices
  // that were never a triangle. `latheProfile` is the kit's only indexed builder, so
  // that blindness had exactly one victim and it looked like a builder bug.
  for (const [label, geometry] of cases) {
    const position = geometry.getAttribute('position')
    assert.ok(position.count > 0, `${label} produced no triangles`)
    assert.equal(
      windingDisagreements(geometry),
      0,
      `${label} has triangles wound against their shading normals`,
    )
  }
})

test('the merged hard surface of a prop carries welded outline normals', () => {  const parts = buildingParts({
    variation: artVariation('props', 'outline'),
    noiseSeed: 7,
    palette: BUILDING_PALETTE,
    width: 5,
    depth: 4,
    wallHeight: 3,
    wallStyle: 'timber-frame',
    roofStyle: 'thatch',
    windows: 2,
    lit: true,
  })
  const hard = parts.find((part) => part.surface === 'hard')
  assert.ok(hard)
  assert.ok(hard.geometry.getAttribute('outlineNormal'))

  // §08 — the ink is extruded along the welded normal, so every one of them has to
  // be unit length or a corner shoots a spike into the frame.
  const normals = hard.geometry.getAttribute('outlineNormal')
  for (let index = 0; index < normals.count; index += 1) {
    const length = Math.hypot(
      normals.getX(index),
      normals.getY(index),
      normals.getZ(index),
    )
    assert.ok(Math.abs(length - 1) < 1e-3, `outline normal ${String(index)} is not unit`)
  }
})

test('shared props are byte-identical for a key, whatever the world seed is', () => {
  const first = new WorldPropLibrary({ retention: 0 })
  const second = new WorldPropLibrary({ retention: 0 })
  const requests = [
    { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' },
    { kind: 'tree', biome: 'fort', slot: 1, detail: 'far' },
    { kind: 'undergrowth', biome: 'forest', slot: 2 },
    { kind: 'rock', biome: 'fort', slot: 1, detail: 'near' },
    { kind: 'groundCover', biome: 'neutral', cover: 'grass' },
    { kind: 'reeds', biome: 'forest' },
  ] as const

  for (const request of requests) {
    const a = first.acquire(request)
    const b = second.acquire(request)
    assert.equal(a.key, b.key)
    assert.equal(
      attributeDigest(a.surfaces[0].geometry, 'position'),
      attributeDigest(b.surfaces[0].geometry, 'position'),
      `${a.key} is not reproducible`,
    )
    assert.equal(
      attributeDigest(a.surfaces[0].geometry, 'color'),
      attributeDigest(b.surfaces[0].geometry, 'color'),
      `${a.key} colours are not reproducible`,
    )
    first.release(a)
    second.release(b)
  }
  assert.equal(first.size, 0)
  assert.equal(second.size, 0)
  first.dispose()
  second.dispose()
})

test('the prop cache shares one buffer and frees it on the last release', () => {
  const library = new WorldPropLibrary({ retention: 0 })
  const request = { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' } as const

  const first = library.acquire(request)
  const second = library.acquire(request)
  assert.equal(library.size, 1)
  assert.equal(library.referenceCount(first.surfaces[0].key), 2)
  assert.equal(
    first.surfaces[0].geometry,
    second.surfaces[0].geometry,
    'two regions asking for the same tree must get the same buffer',
  )

  let disposed = 0
  first.surfaces[0].geometry.addEventListener('dispose', () => {
    disposed += 1
  })

  library.release(first)
  assert.equal(disposed, 0, 'a geometry another region still draws must not be freed')
  assert.equal(library.referenceCount(second.surfaces[0].key), 1)
  library.release(second)
  assert.equal(disposed, 1)
  assert.equal(library.size, 0)
  library.dispose()
})

test('a prop with several surfaces holds one cache reference per surface', () => {
  const library = new WorldPropLibrary({ retention: 0 })
  const asset = library.acquire({
    kind: 'siteProp',
    prop: 'shrine',
    biome: 'forest',
    owner: 'elf',
    variant: 0,
  })
  assert.deepEqual(
    asset.surfaces.map((surface) => surface.surface),
    ['hard', 'cloth', 'glow'],
  )
  assert.equal(library.size, 3)
  for (const surface of asset.surfaces) {
    assert.ok(surface.geometry.getAttribute('color'))
    assert.equal(library.referenceCount(surface.key), 1)
  }
  library.release(asset)
  assert.equal(library.size, 0)
  library.dispose()
})

test('a site never builds anything on top of its own destination', () => {
  // The objective, the map marker and the pathfinding destination are all the site's
  // canonical position, which sits `footprintDepth / 2 + 2.5` back down -Z from the
  // layout origin. A building parked on it makes "reach the settlement" impossible.
  for (const kind of SITE_KINDS) {
    for (const owner of TERRITORIES) {
      for (const seed of [0, 7, 4242]) {
        const layout = composeSiteLayout({
          siteId: `blocking-${kind}-${owner}-${String(seed)}`,
          kind,
          owner,
          biome: 'neutral',
          seed,
        })
        const prefab = SITE_PRESENTATIONS[kind].prefab
        const anchorZ = -(prefab.footprintDepth / 2 + 2.5)
        const solid = [
          ...layout.buildings.map((entry) => ({
            id: entry.id,
            x: entry.x,
            z: entry.z,
            radius: entry.radius,
          })),
          // Matches the runtime threshold: props below 0.5 register no collider.
          ...layout.props
            .filter((entry) => entry.radius >= 0.5)
            .map((entry) => ({
              id: entry.id,
              x: entry.x,
              z: entry.z,
              radius: entry.radius * entry.scale,
            })),
        ]
        for (const entry of solid) {
          assert.ok(
            Math.hypot(entry.x, entry.z - anchorZ) > entry.radius + 0.6,
            `${kind}/${owner} seed ${String(seed)}: ${entry.id} covers the site position`,
          )
          // And the lane in from the road has to stay open, not just the point.
          const onCorridor =
            entry.z <= anchorZ && Math.abs(entry.x) < entry.radius + 0.6
          assert.equal(
            onCorridor,
            false,
            `${kind}/${owner} seed ${String(seed)}: ${entry.id} blocks the approach`,
          )
        }
      }
    }
  }
})

test('a failed multi-surface acquire returns every reference it took', () => {
  const library = new WorldPropLibrary({ retention: 0 })
  assert.throws(() =>
    library.acquireComposite('partial', ['hard', 'cloth'], () => [
      propPart(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), 'hard'),
    ]),
  )
  // The asset never reached a caller, so nothing would ever have released the `hard`
  // key it already took.
  assert.equal(library.size, 0)
  assert.equal(library.referenceCount('partial#hard'), 0)
  library.dispose()
})

test('a quantized cache key builds the geometry that key describes', () => {
  const library = new WorldPropLibrary({ retention: 0 })
  // 5.1 and 5.2 collapse onto the same key. If the builder still saw the raw number,
  // the buffer behind that key would depend on which request arrived first.
  const first = library.acquire({
    kind: 'fence',
    style: 'rail',
    biome: 'forest',
    owner: 'elf',
    length: 5.1,
  })
  const firstKey = first.key
  const firstBox = first.surfaces[0].geometry.boundingBox
    ? first.surfaces[0].geometry.boundingBox
    : (first.surfaces[0].geometry.computeBoundingBox(),
      first.surfaces[0].geometry.boundingBox)
  assert.ok(firstBox)
  const firstWidth = firstBox.max.x - firstBox.min.x
  library.release(first)

  const second = new WorldPropLibrary({ retention: 0 })
  const other = second.acquire({
    kind: 'fence',
    style: 'rail',
    biome: 'forest',
    owner: 'elf',
    length: 5.2,
  })
  assert.equal(other.key, firstKey, 'the two lengths must share a key')
  other.surfaces[0].geometry.computeBoundingBox()
  const otherBox = other.surfaces[0].geometry.boundingBox
  assert.ok(otherBox)
  const otherWidth = otherBox.max.x - otherBox.min.x
  assert.ok(
    Math.abs(firstWidth - otherWidth) < 1e-6,
    `one key produced two widths: ${String(firstWidth)} vs ${String(otherWidth)}`,
  )
  second.release(other)
  library.dispose()
  second.dispose()
})

test('a site layout is deterministic, bounded and expresses its territory', () => {
  for (const kind of SITE_KINDS) {
    for (const owner of TERRITORIES) {
      const input = {
        siteId: `site-${kind}-${owner}`,
        kind,
        owner,
        biome: 'forest',
        seed: 4242,
      } as const
      const first = composeSiteLayout(input)
      const second = composeSiteLayout(input)
      assert.deepEqual(first, second, `${kind}/${owner} layout is not deterministic`)
      assert.ok(
        first.buildings.length + first.props.length > 0,
        `${kind}/${owner} composed nothing`,
      )
      assert.ok(first.clearingRadius > 0)

      const ids = [
        ...first.buildings.map((entry) => entry.id),
        ...first.props.map((entry) => entry.id),
        ...first.fences.map((entry) => entry.id),
      ]
      assert.equal(new Set(ids).size, ids.length, `${kind}/${owner} has duplicate ids`)

      for (const building of first.buildings) {
        assert.ok(Number.isFinite(building.x) && Number.isFinite(building.z))
        assert.ok(
          Math.hypot(building.x, building.z) <= first.clearingRadius,
          `${kind}/${owner} put a building outside its own clearing`,
        )
        assert.ok(building.spec.width > 0 && building.spec.depth > 0)
      }
      for (const prop of first.props) {
        assert.ok(Number.isFinite(prop.x) && Number.isFinite(prop.z))
        assert.ok(prop.scale > 0)
      }
    }
  }

  // Territory has to change the architecture, not only the banner colour.
  const styles = TERRITORIES.map((owner) => {
    const layout = composeSiteLayout({
      siteId: 'settlement-style',
      kind: 'settlement',
      owner,
      biome: 'neutral',
      seed: 11,
    })
    const first = layout.buildings[0]
    assert.ok(first)
    return `${first.spec.wallStyle}/${first.spec.roofStyle}`
  })
  assert.equal(new Set(styles).size, TERRITORIES.length)

  // Two settlements in the same world are different places.
  const alpha = composeSiteLayout({
    siteId: 'settlement-a',
    kind: 'settlement',
    owner: 'neutral',
    biome: 'neutral',
    seed: 11,
  })
  const beta = composeSiteLayout({
    siteId: 'settlement-b',
    kind: 'settlement',
    owner: 'neutral',
    biome: 'neutral',
    seed: 11,
  })
  assert.notDeepEqual(alpha.buildings, beta.buildings)
})

test('building keys collapse similar buildings and separate different ones', () => {
  const base = composeSiteLayout({
    siteId: 'keys',
    kind: 'settlement',
    owner: 'guard',
    biome: 'palace',
    seed: 5,
  }).buildings[0]
  assert.ok(base)
  const key = buildingSpecKey(base.spec, 'palace', 'guard')
  assert.equal(key, buildingSpecKey({ ...base.spec }, 'palace', 'guard'))
  assert.notEqual(key, buildingSpecKey(base.spec, 'forest', 'guard'))
  assert.notEqual(key, buildingSpecKey(base.spec, 'palace', 'villain'))
  assert.notEqual(
    key,
    buildingSpecKey({ ...base.spec, variant: base.spec.variant + 1 }, 'palace', 'guard'),
  )
})

test('merging tagged parts produces one geometry per surface and consumes the parts', () => {
  const parts = [
    ...wellParts({
      variation: artVariation('props', 'merge-well'),
      noiseSeed: 1,
      palette: PROP_PALETTE,
    }),
    ...monumentParts({
      variation: artVariation('props', 'merge-monument'),
      noiseSeed: 2,
      palette: PROP_PALETTE,
    }),
  ]
  const totalVertices = parts.reduce(
    (total, part) => total + part.geometry.getAttribute('position').count,
    0,
  )
  const merged = mergePropParts(parts, { name: 'merge-test' })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].surface, 'hard')
  assert.equal(merged[0].geometry.getAttribute('position').count, totalVertices)
  assert.ok(merged[0].geometry.getAttribute('color'))
  assert.ok(merged[0].geometry.getAttribute('outlineNormal'))
  merged[0].geometry.dispose()
})

test('region streaming returns every borrowed prop reference', () => {
  const { runtime, blueprint } = createRuntime('prop-streaming')
  assert.equal(runtime.propCacheSize, 0)

  focusRegion(runtime, blueprint, (region) => region.biome === 'forest')
  assert.ok(runtime.propCacheSize > 0, 'a streamed forest borrows shared geometry')

  // A full lap of the map loads and unloads every region at least once. The cache
  // holds a retention window on top of the live references, so the invariant is that
  // two identical laps settle on the same number — a leaked reference would make the
  // second lap end higher than the first.
  const lap = (): number => {
    for (const region of blueprint.regions) {
      const center = runtime.getRegionCenter(region.id)
      assert.ok(center)
      runtime.update({ deltaSeconds: 0, focus: center })
    }
    return runtime.propCacheSize
  }
  const first = lap()
  const second = lap()
  const third = lap()
  assert.equal(second, third, 'the live prop count is still moving after two laps')
  assert.ok(
    third <= Math.max(first, second),
    'streaming a lap of the map grew the live prop count',
  )
  // §10 budget: PROP_CACHE_ENTRIES_MAX.
  assert.ok(
    runtime.propCacheSize <= 176,
    `live prop entries ${String(runtime.propCacheSize)} exceed the 176 budget`,
  )
  assert.ok(runtime.retainedPropCount <= 128)

  runtime.dispose()
  assert.equal(runtime.propCacheSize, 0)
  assert.equal(runtime.retainedPropCount, 0)
})

test('every prop acquire is matched by exactly one release, on every path', () => {
  // `GeometryCache.release(key)` carries no holder identity and returns silently for a
  // key nobody holds, so one holder releasing twice is indistinguishable *inside the
  // cache* from two holders releasing once each — the second holder simply loses a
  // buffer it is still drawing from. No guard within the cache can close that.
  //
  // It is detectable from outside: a release against a key whose reference count is
  // already zero is exactly the double-release signature. This drives a full region
  // lifecycle — load, unload, reload, a lap that forces retention eviction, then
  // teardown — and watches every call.
  const overReleases: string[] = []
  const acquiredKeys = new Set<string>()
  let acquires = 0
  let releases = 0
  const realAcquire = GeometryCache.prototype.acquire
  const realRelease = GeometryCache.prototype.release
  GeometryCache.prototype.acquire = function patchedAcquire(
    this: GeometryCache,
    key: string,
    build: () => THREE.BufferGeometry,
  ): THREE.BufferGeometry {
    acquires += 1
    acquiredKeys.add(key)
    return realAcquire.call(this, key, build)
  }
  GeometryCache.prototype.release = function patchedRelease(
    this: GeometryCache,
    key: string,
  ): void {
    releases += 1
    if (this.referenceCount(key) === 0) overReleases.push(key)
    realRelease.call(this, key)
  }

  try {
    const { blueprint, runtime } = createRuntime('release-accounting')
    const regions = blueprint.regions
    const focusOn = (index: number): void => {
      const center = runtime.getRegionCenter(regions[index].id)
      assert.ok(center)
      runtime.update({ deltaSeconds: 0, focus: center })
    }

    focusOn(0)
    const liveAfterLoad = runtime.propCacheSize
    assert.ok(liveAfterLoad > 0, 'a loaded region must borrow shared geometry')

    // Unload it by moving to the far corner, then come back: the returning region must
    // be served by the retention window, not by a rebuild of geometry it never released.
    focusOn(regions.length - 1)
    focusOn(0)

    // A full lap pushes far more distinct keys through the window than it can hold,
    // which is the only way to exercise the eviction release path.
    for (let index = 0; index < regions.length; index += 1) focusOn(index)

    assert.deepEqual(
      overReleases,
      [],
      'a key was released while nobody held it, which frees a live buffer',
    )

    // The exact fault this test exists for, driven rather than inferred. A review
    // showed the `referenceCount === 0` check above is blind to the dangerous case:
    // when A releases twice while B still holds the key, the count is still 1 at the
    // moment of the fault, so the second release *succeeds* and quietly takes B's
    // reference. Only holder identity can see that, which is why `release` takes a
    // receipt and refuses one it has already accepted.
    const library = new WorldPropLibrary({ retention: 0 })
    const request = { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' } as const
    const holderA = library.acquire(request)
    const holderB = library.acquire(request)
    const shared = holderB.surfaces[0].geometry
    let freed = false
    shared.addEventListener('dispose', () => {
      freed = true
    })
    library.release(holderA)
    assert.throws(
      () => {
        library.release(holderA)
      },
      /released twice/,
      'a receipt returned twice must be refused, not silently applied',
    )
    assert.equal(freed, false, "B's buffer was freed while B still held it")
    library.release(holderB)
    library.dispose()

    // An accounting test that observed nothing would pass every assertion above, so
    // pin that it actually watched a meaningful amount of traffic.
    assert.ok(
      acquires >= 200,
      `only ${String(acquires)} acquires observed; the lifecycle did not run`,
    )
    assert.ok(
      acquiredKeys.size >= 40,
      `only ${String(acquiredKeys.size)} distinct keys observed`,
    )
    assert.ok(releases > 0, 'no releases observed; the unload path did not run')

    // `dispose()` frees the retention window wholesale rather than through `release`,
    // so the totals deliberately do not have to converge — what must hold is that
    // nothing survives it.
    runtime.dispose()
    assert.equal(runtime.propCacheSize, 0, 'teardown must return every borrowed key')
    assert.equal(runtime.retainedPropCount, 0)
    assert.deepEqual(overReleases, [], 'teardown over-released a key')
  } finally {
    GeometryCache.prototype.acquire = realAcquire
    GeometryCache.prototype.release = realRelease
  }
})

test('the retention window never releases a key a live region still holds', () => {
  // The window takes over a *released* reference. If it ever evicted a key that a
  // resident region were still using, the region would keep drawing a disposed buffer.
  const library = new WorldPropLibrary({ retention: 2 })
  const request = { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' } as const

  const live = library.acquire(request)
  const key = live.surfaces[0].key
  let disposed = false
  live.surfaces[0].geometry.addEventListener('dispose', () => {
    disposed = true
  })

  // A second holder takes the same key, then releases it into the window.
  library.release(library.acquire(request))
  // Now flood the window well past its limit so the key is evicted from it.
  for (const filler of [
    { kind: 'undergrowth', biome: 'forest', slot: 0 },
    { kind: 'undergrowth', biome: 'forest', slot: 1 },
    { kind: 'undergrowth', biome: 'forest', slot: 2 },
    { kind: 'groundCover', biome: 'forest', cover: 'grass' },
    { kind: 'groundCover', biome: 'forest', cover: 'fern' },
  ] as const) {
    library.release(library.acquire(filler))
  }

  assert.equal(disposed, false, 'eviction freed a buffer a live holder still borrows')
  assert.ok(
    library.referenceCount(key) >= 1,
    'the live holder lost its reference to an evicted key',
  )
  library.release(live)
  library.dispose()
})

test('the retention window hands a returning region the same buffer', () => {
  const library = new WorldPropLibrary({ retention: 8 })
  const request = { kind: 'tree', biome: 'forest', slot: 1, detail: 'near' } as const

  const first = library.acquire(request)
  const geometry = first.surfaces[0].geometry
  let disposed = 0
  geometry.addEventListener('dispose', () => {
    disposed += 1
  })
  library.release(first)
  assert.equal(disposed, 0, 'a just-unloaded region must not throw its geometry away')
  assert.equal(library.retainedCount, 1)

  const second = library.acquire(request)
  assert.equal(second.surfaces[0].geometry, geometry)
  assert.equal(library.retainedCount, 0, 'the pin moves back to the caller')
  assert.equal(library.referenceCount(second.surfaces[0].key), 1)

  library.release(second)
  // Push the key out of an eight-slot window with unrelated work.
  const filler = [
    { kind: 'tree', biome: 'neutral', slot: 0, detail: 'near' },
    { kind: 'tree', biome: 'palace', slot: 0, detail: 'near' },
    { kind: 'tree', biome: 'fort', slot: 0, detail: 'near' },
    { kind: 'rock', biome: 'fort', slot: 0, detail: 'near' },
    { kind: 'rock', biome: 'fort', slot: 1, detail: 'near' },
    { kind: 'rock', biome: 'neutral', slot: 0, detail: 'near' },
    { kind: 'undergrowth', biome: 'forest', slot: 0 },
    { kind: 'undergrowth', biome: 'forest', slot: 1 },
    { kind: 'groundCover', biome: 'forest', cover: 'grass' },
  ] as const
  for (const entry of filler) library.release(library.acquire(entry))
  assert.equal(disposed, 1, 'an evicted retention pin has to free its geometry')
  assert.equal(library.retainedCount, 8)
  library.dispose()
})

test('a library with no retention frees geometry on the last release', () => {
  const library = new WorldPropLibrary({ retention: 0 })
  const asset = library.acquire({
    kind: 'groundCover',
    biome: 'forest',
    cover: 'flower',
  })
  assert.equal(library.size, 1)
  library.release(asset)
  assert.equal(library.size, 0)
  assert.equal(library.retainedCount, 0)
  library.dispose()
})

test('the retention window spends one slot per key, not one per release', () => {
  // A forest tree is held by every region that can see it, so it is released once
  // per region that unloads. Pushing a slot per release spent three of them on one
  // geometry and left the window covering roughly half the keys it advertised.
  const library = new WorldPropLibrary({ retention: 4 })
  const request = { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' } as const
  const holders = [
    library.acquire(request),
    library.acquire(request),
    library.acquire(request),
  ]
  const key = holders[0].surfaces[0].key
  assert.equal(library.referenceCount(key), 3)

  for (const holder of holders) library.release(holder)
  assert.equal(library.retainedCount, 1, 'three releases, one slot')
  assert.equal(
    library.referenceCount(key),
    1,
    'the surplus references go back to the cache, not into the window',
  )

  // The geometry is still alive and still the same buffer, which is the entire
  // point of holding it.
  const again = library.acquire(request)
  assert.equal(again.surfaces[0].geometry, holders[0].surfaces[0].geometry)
  assert.equal(library.retainedCount, 0, 'the pin moves back to the caller')
  assert.equal(library.referenceCount(key), 1)
  library.release(again)
  library.dispose()
})

test('re-releasing a retained key keeps it from being evicted', () => {
  const library = new WorldPropLibrary({ retention: 2 })
  const hot = { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' } as const
  const first = library.acquire(hot)
  const hotKey = first.surfaces[0].key
  library.release(first)

  // Two unrelated keys would evict the oldest slot, except that touching the hot
  // key again moves it to the newest end of the window.
  const cold = library.acquire({ kind: 'undergrowth', biome: 'forest', slot: 0 })
  library.release(cold)
  const second = library.acquire(hot)
  library.release(second)
  const colder = library.acquire({ kind: 'undergrowth', biome: 'forest', slot: 1 })
  library.release(colder)

  assert.ok(
    library.referenceCount(hotKey) > 0,
    'a prop still in circulation must not be evicted ahead of a colder one',
  )
  library.dispose()
})

/**
 * Ink shells that can draw in the same frame.
 *
 * An LOD renders exactly one level, so counting every shell under it bills a
 * building for a silhouette the frame never draws. The budget is a frame-time
 * budget, so it has to be counted the way the frame pays it.
 */
function simultaneousInkDraws(object: THREE.Object3D): number {
  if (object instanceof THREE.LOD) {
    let worst = 0
    for (const level of object.levels) {
      worst = Math.max(worst, simultaneousInkDraws(level.object))
    }
    return worst
  }
  // Asks the library rather than matching its marker string. The marker is private
  // to the library and has been renamed once already this cycle; a test that reads it
  // directly goes quietly blind the moment it moves again.
  let total = StylizedArtLibrary.isOutlineShell(object) ? 1 : 0
  for (const child of object.children) total += simultaneousInkDraws(child)
  return total
}

test('a visible region never spends more ink than the budget allows', () => {
  const { scene, blueprint, runtime } = createRuntime('ink-budget')
  const stronghold = blueprint.sites.find(
    (site) => site.kind === 'final-stronghold',
  )
  assert.ok(stronghold)

  let busiest = 0
  for (const region of [
    ...blueprint.regions.filter((entry) => entry.id === stronghold.regionId),
    ...blueprint.regions,
  ]) {
    const center = runtime.getRegionCenter(region.id)
    assert.ok(center)
    runtime.update({ deltaSeconds: 0, focus: center })

    const snapshots = new Map(
      runtime
        .getDebugSnapshot()
        .regionRoots.map((entry) => [String(entry.regionId), entry]),
    )
    for (const root of scene.children) {
      const regionId = root.userData.generatedWorldRegionId
      if (regionId === undefined) continue
      const inkDraws = simultaneousInkDraws(root)
      busiest = Math.max(busiest, inkDraws)
      assert.ok(
        inkDraws <= 8,
        `region ${String(regionId)} draws ${String(inkDraws)} ink shells, budget is 8`,
      )
      // The budget is only a budget if what it charges matches what gets built.
      // It billed one draw per `applyOutline` call until a review caught it, which
      // priced a four-mesh building at a quarter of what it costs.
      const snapshot = snapshots.get(String(regionId))
      assert.ok(snapshot)
      assert.equal(
        inkDraws,
        snapshot.inkDraws,
        `region ${String(regionId)} charged ${String(
          snapshot.inkDraws,
        )} ink draws but built ${String(inkDraws)}`,
      )
    }
  }
  // And it has to actually be spent. Tying ink to the one bucket per biome that
  // also collides left seven of the eight draws permanently idle.
  assert.ok(
    busiest >= 5,
    `the busiest region spent only ${String(busiest)} of 8 ink draws`,
  )
  runtime.dispose()
})

test('settlement buildings block movement and their squares stay walkable', () => {
  const { blueprint, runtime } = createRuntime('site-collision')
  const settlement = blueprint.sites.find((site) => site.kind === 'settlement')
  assert.ok(settlement)
  const center = runtime.getRegionCenter(settlement.regionId)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })

  const colliders = runtime.collision
    .queryBounds(runtime.bounds)
    .filter((collider) => collider.id.startsWith(`site-building:${settlement.id}:`))
  assert.ok(colliders.length >= 3, 'a village is several buildings, and each one blocks')

  // The centre of the site must remain reachable — the old single box collider
  // covered the whole footprint, which would have sealed a composed village shut.
  const sitePosition = runtime.getSitePosition(settlement)
  assert.ok(sitePosition)
  const blocking = runtime.collision
    .queryBounds({
      minX: sitePosition.x - 1,
      maxX: sitePosition.x + 1,
      minZ: sitePosition.z - 1,
      maxZ: sitePosition.z + 1,
    })
    .filter((collider) => collider.id.startsWith('site-'))
  assert.ok(
    blocking.length <= 2,
    'the middle of a settlement should not be one solid block',
  )
  runtime.dispose()
})

test('every site in a region gets its own share of the ink budget', () => {
  // Seed chosen because it puts two sites in one region — only about one region in
  // forty does, so a self-selecting test would quietly never run.
  const { scene, blueprint, runtime } = createRuntime('two-sites')
  const counts = new Map<string, number>()
  for (const site of blueprint.sites) {
    counts.set(site.regionId, (counts.get(site.regionId) ?? 0) + 1)
  }
  const shared = [...counts.entries()].find(([, count]) => count > 1)
  assert.ok(shared, 'the seed must produce a region with two sites')
  const [regionId] = shared
  const center = runtime.getRegionCenter(regionId)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })

  const root = scene.children.find(
    (child) => child.userData.generatedWorldRegionId === regionId,
  )
  assert.ok(root)
  // The site sub-budget exists so one site cannot starve the trees. It must not also
  // let the first site starve the second.
  const sites = blueprint.sites.filter((entry) => entry.regionId === regionId)
  assert.ok(sites.length > 1)
  for (const site of sites) {
    const group = root.getObjectByName(`site:${site.id}`)
    assert.ok(group)
    let inked = 0
    group.traverse((object) => {
      if (StylizedArtLibrary.isOutlineShell(object)) inked += 1
    })
    assert.ok(inked > 0, `${site.id} received no ink while the region had budget left`)
  }
  runtime.dispose()
})

test('lit windows belong to the near building level, not beside it', () => {
  const { scene, blueprint, runtime } = createRuntime('lod-glow')
  const settlement = blueprint.sites.find((site) => site.kind === 'settlement')
  assert.ok(settlement)
  const center = runtime.getRegionCenter(settlement.regionId)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })

  const root = scene.children.find(
    (child) => child.userData.generatedWorldRegionId === settlement.regionId,
  )
  assert.ok(root)
  const windows: THREE.Object3D[] = []
  root.traverse((object) => {
    if (object.name.startsWith(`site-windows:${settlement.id}:`)) {
      windows.push(object)
    }
  })
  assert.ok(windows.length > 0, 'a settlement should have lit windows')

  // The far level has no openings. A glow mesh parented beside the LOD instead of
  // under its near level leaves lit windows hanging in the air after the swap.
  for (const mesh of windows) {
    let cursor: THREE.Object3D | null = mesh.parent
    let nearLevel: THREE.Object3D | null = null
    while (cursor) {
      if (cursor instanceof THREE.LOD) {
        assert.ok(
          nearLevel === cursor.levels[0].object,
          `${mesh.name} is not under the near LOD level`,
        )
        break
      }
      nearLevel = cursor
      cursor = cursor.parent
    }
    assert.ok(cursor instanceof THREE.LOD, `${mesh.name} has no LOD ancestor`)
  }
  runtime.dispose()
})

test('reloading a region rebuilds the same world objects', () => {
  const { scene, blueprint, runtime } = createRuntime('region-reload')
  const target = blueprint.regions.find((region) => region.biome === 'forest')
  assert.ok(target)

  const snapshot = (): string[] => {
    const root = scene.children.find(
      (child) => child.userData.generatedWorldRegionId === target.id,
    )
    assert.ok(root)
    const names: string[] = []
    root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        names.push(`${object.name}#${String(object.count)}`)
      } else if (object instanceof THREE.Mesh || object instanceof THREE.LOD) {
        names.push(object.name)
      }
    })
    return names.sort()
  }

  const center = runtime.getRegionCenter(target.id)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })
  const before = snapshot()

  const far = blueprint.regions.find(
    (region) =>
      Math.abs(region.coordinate.x - target.coordinate.x) > 2 ||
      Math.abs(region.coordinate.y - target.coordinate.y) > 2,
  )
  assert.ok(far)
  const farCenter = runtime.getRegionCenter(far.id)
  assert.ok(farCenter)
  runtime.update({ deltaSeconds: 0, focus: farCenter })
  runtime.update({ deltaSeconds: 0, focus: center })

  assert.deepEqual(snapshot(), before)
  runtime.dispose()
})

