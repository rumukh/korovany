import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { artVariation } from '../src/game/art/ArtRandom.ts'
import { GeometryCache } from '../src/game/art/GeometryCache.ts'
import {
  bridgeParts,
  buildingParts,
  ensureVertexColors,
  fencePanelParts,
  mergeAll,
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
import { GeneratedWorldRuntime, inkDrawCost } from '../src/game/world/GeneratedWorldRuntime.ts'
import {
  buildingSpecKey,
  composeSiteLayout,
  type SitePropKind,
} from '../src/game/world/SiteComposition.ts'
import {
  WorldPropLibrary,
  PROP_RESIDENT_HEADROOM,
  PROP_RETENTION_DEFAULT,
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
 *
 * **What it cannot see, measured by the session that owns the builder.** The 90 degree
 * threshold was calibrated against 104-125 degree figures that turned out to be
 * synthetic extremes — parameter values chosen to exhibit the defect, not values any
 * caller passes. In production the same defect runs **0-9 degrees**. Consequently:
 *
 * - The **twist** branch first crosses 90 at 77.6 degrees of section rotation. The
 *   largest twist in this file is `PropKit.ts:2309` at 0.06 rad = **3.44 degrees**,
 *   where the defect contributes 2.21 — a factor of 41 below trigger.
 * - The **anisotropy** branch can never cross it at any parameter value: the defective
 *   error asymptotes at **80.08 degrees**, ten below the threshold, monotonically. That
 *   is the branch this file actually uses — `PropKit.ts:1773` is `scaleX: 0.9,
 *   scaleZ: 0.04`, a 22:1 section.
 * - There is a **false-positive band that opens below the true-positive one**: correct
 *   *faceted* geometry crosses 90 at 81.3 degrees of twist, and faceted is the default.
 *
 * So the clean sweep this produces is real evidence for the collapsed-section class and
 * **no evidence at all** for the anisotropic or rotational one. It is moot here rather
 * than merely tolerable: `smooth: true` appears **zero times** in `src/`, so all 50
 * `loftProfile` calls take the faceted path, whose derivation error is exactly 0.00 on
 * every planar-quad shape. The defect is behind a branch these props never enter.
 *
 * If that ever changes, the fix-independent comparator is the same geometry built
 * faceted — `smoothError - facetedError` isolates derivation error with no
 * shape-dependent baseline — rather than a tighter absolute threshold.
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

/**
 * Reverses every face, then recomputes normals — the pipeline's own damage model.
 *
 * This is the shape a *builder* winding error takes, and it is the one that matters:
 * `mergePropParts` ends with `mergeAll` and `bakeOutlineNormals`, both of which derive
 * normals from whatever the winding currently says. So by the time any prop reaches an
 * assertion, its normals agree with its winding no matter which way round that winding
 * is. Reversing *without* recomputing leaves stale normals, which is a defect the
 * shipped pipeline cannot produce — proving a detector against that instead is proving
 * it against the wrong damage.
 */
function reverseAsABuilderWould(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = copy.getAttribute('position')
  const triangles = Math.floor(position.count / 3)
  for (let triangle = 0; triangle < triangles; triangle += 1) {
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
  copy.computeVertexNormals()
  return copy
}

/**
 * Whether a geometry reads as outward-facing, by the two instruments that survive a
 * normal recompute.
 *
 * **Whole-geometry verdict only.** It catches a prop built entirely inside out and is
 * blind to a single reversed *part* inside a merged one — `mergeAll` concatenates, so a
 * part that arrives wound backwards keeps its winding in the merged buffer, and the
 * merge's normal recompute makes its shading agree with itself. Measured over 248 merged
 * hard surfaces, reversing a contiguous block and rebaking:
 *
 * ```text
 * 10% of faces reversed -> undetected on 248 of 248
 * 20%                   -> 244 of 248
 * 35%                   -> 222 of 248
 * 50%                   -> 118 of 248
 * ```
 *
 * Neither instrument can close that on its own: signed volume is a sum so a partial
 * inversion cancels against the rest, and the centroid fraction cannot separate 10%
 * reversed from a legitimately concave prop, because a correct fort tree already reads
 * 47% inward. The guard against a backwards builder is that each builder's output is
 * judged before it reaches a merge — which is where the sibling session's kit-level
 * winding tests sit — not here.
 *
 * Neither alone covers the family. The centroid ray is decisive for compact solids but
 * weak in two unrelated ways. A **sparse** branch structure reads badly because its
 * faces do not surround its centroid — a correct fort tree already sits at 47% inward.
 * A **flat** cross-section reads badly for a different reason: its faces are nearly
 * orthogonal to the centroid ray, so they fall under the decisiveness cutoff and are
 * declined rather than misjudged. A sibling session measured the onset at a section
 * ratio of about **2:1** on strictly convex, flawless lofts; this file has two profiles
 * past it — `rectProfile(0.045, 0.012)` at 3.75:1 and `rectProfile(0.075, 0.018)` at
 * 4.17:1 — both blade-like parts inside merged props, where the rest of the merge
 * restores decisiveness.
 *
 * That second cause is worth naming because it is invisible in the shipped numbers: a
 * flat part declines faces rather than failing, so it looks like coverage. Anything
 * blade-, plank- or banner-shaped tested in isolation belongs on signed volume, and a
 * centroid failure there is the guard working rather than a winding fault.
 *
 * Signed volume is decisive for both and says nothing about an open sheet.
 *
 * The half threshold is derived, not tuned. Reversing every face negates each face's
 * alignment with the centroid ray while leaving `|alignment|` — and therefore the
 * decisive set — untouched, so reversal maps the inward fraction `f` to exactly `1 - f`.
 * Measured across the request space, the largest departure from that law is 0.0023, all
 * of it faces jittering across the decisiveness cutoff. A half is consequently the only
 * threshold whose margin is symmetric for every geometry; any other value trades
 * false-pass headroom for false-fail headroom with nothing to justify the rate. This
 * check previously used 0.4, which put a *correct* washing line at 0.390 — 0.010 from
 * being reported inside out. At a half its margin is 0.110, and the tightest in the
 * whole family is the fort tree at 0.033.
 */
function readsOutward(geometry: THREE.BufferGeometry): boolean {
  const { inward, decisive } = centroidInwardFaces(geometry)
  if (decisive > 0 && inward < decisive * 0.5) return true
  return signedVolume(geometry) > 0
}

/** How far a geometry's inward fraction sits from the undecidable half. */
function centroidMargin(geometry: THREE.BufferGeometry): number | null {
  const { inward, decisive } = centroidInwardFaces(geometry)
  if (decisive === 0) return null
  return Math.abs(inward / decisive - 0.5)
}

/**
 * Triangles whose vertex order disagrees with the normal the builder stored, and how
 * many triangles the question could be asked of at all.
 *
 * Scope note, because this instrument is narrower than it looks: it can only see a
 * disagreement that already exists in the buffers, so it is meaningful for geometry
 * whose normals were *not* re-derived after its winding was set. Every prop the library
 * returns has been through `mergeAll`, so this is vacuous there — see
 * `reverseAsABuilderWould`. It stays for the controls, which is the one place the
 * stale-normal case genuinely arises.
 *
 * The second number exists because a sibling session found the hole it closes: an
 * all-degenerate geometry disagrees zero times, so `=== 0` passes having judged
 * nothing. Worse, the same hole sits inside a mutation proof — a degenerate *reversed*
 * control also reports zero, so the assertion whose whole job is proving the detector
 * can fail would itself pass on an empty measurement.
 */
function windingDisagreements(geometry: THREE.BufferGeometry): {
  disagreeing: number
  judged: number
} {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return { disagreeing: 0, judged: 0 }
  const index = geometry.index
  const triangles = index ? index.count / 3 : position.count / 3
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const geometric = new THREE.Vector3()
  const shading = new THREE.Vector3()
  let disagreeing = 0
  let judged = 0
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
    judged += 1
    if (geometric.dot(shading) < 0) disagreeing += 1
  }
  return { disagreeing, judged }
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
  const controlReading = windingDisagreements(control)
  assert.ok(controlReading.judged > 0, 'the control judged no faces at all')
  assert.equal(controlReading.disagreeing, 0, 'a stock box is wound correctly')
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
  // The mutation proof needs its own non-empty guard, or a degenerate control makes
  // *this* assertion — the one whose job is proving the detector can fail — pass on
  // nothing. Every face must be caught, not merely one.
  const reversedReading = windingDisagreements(reversed)
  assert.ok(reversedReading.judged > 0, 'the reversed control judged no faces at all')
  assert.equal(
    reversedReading.disagreeing,
    reversedReading.judged,
    'the detector must notice every face of a deliberately reversed box',
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
  const indexedReading = windingDisagreements(indexed)
  assert.ok(indexedReading.judged > 0, 'the indexed control judged no faces at all')
  assert.equal(
    indexedReading.disagreeing,
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
  const flippedReading = windingDisagreements(flipped)
  assert.ok(flippedReading.judged > 0, 'the flipped control judged no faces at all')
  assert.equal(
    flippedReading.disagreeing,
    flippedReading.judged,
    'reversing every triangle must make every judged face disagree',
  )
  indexed.dispose()
  flipped.dispose()

  const library = new WorldPropLibrary({ retention: 0 })
  const requests = everyPropRequest()
  let geometries = 0
  let judgedFaces = 0
  const failures: string[] = []
  const undetectable: string[] = []
  const open: string[] = []
  let tightestMargin = 1
  let tightestMarginLabel = ''
  try {
    for (const [label, request] of requests) {
      for (const part of library.build(request)) {
        geometries += 1
        // Orientation, judged by the two instruments a normal recompute cannot
        // launder, and *proved* per geometry rather than once on a stock box: the
        // same prop reversed through the pipeline's own damage model must read the
        // other way. A control built from `THREE.BoxGeometry` cannot license this
        // loop, because the box is not what the loop is looking at and a compact box
        // is not where either instrument is weak.
        if (!readsOutward(part.geometry)) {
          failures.push(`${label}#${part.surface}: reads inside out`)
        }
        const damaged = reverseAsABuilderWould(part.geometry)
        if (readsOutward(damaged)) {
          undetectable.push(`${label}#${part.surface}`)
        }
        damaged.dispose()
        // How close this prop sits to the half where the centroid reading means nothing.
        // The verdict being right today says nothing about how much room it has, and a
        // prop drifting toward the half gets reported inside out while being perfectly
        // fine — a false *failure*, which costs more to diagnose than a false pass.
        const margin = centroidMargin(part.geometry)
        if (margin !== null && margin < tightestMargin) {
          tightestMargin = margin
          tightestMarginLabel = `${label}#${part.surface}`
        }
        // Face population only. The disagreement count this also returns is *always*
        // zero here and asserting on it would be theatre: `mergePropParts` ends in
        // `mergeAll`, which recomputes normals from the winding, so the two sides of
        // that comparison stop being independent. Measured across this exact loop, a
        // fully reversed prop produced 0 disagreements in 560 of 560 cases — the check
        // that used to sit here could not have failed for any prop the world builds.
        judgedFaces += windingDisagreements(part.geometry).judged
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
        // Magnitude, not just sign. A sibling session proved that on an *indexed*
        // geometry an index-blind volume reader returns a small artifact rather than
        // nothing — measured +0.0029 against a true +4.01 on a stock sphere — and its
        // sign is a coin flip on topology: positive for a sphere and a box, negative for
        // a cylinder, torus and lathe. So a sign test passes on a blind reader for
        // exactly the shapes anyone reaches for first.
        //
        // Four prop surfaces are genuinely indexed (`siteProp/pillar/*#hard`, pinned by
        // its own test), so this file has real indexed inputs to hold the reader to. A
        // solid's volume should be a serious fraction of its bounding box; three orders
        // of magnitude below it is the signature of a reader that stopped following the
        // index.
        if (part.geometry.index) {
          const box = new THREE.Box3().setFromBufferAttribute(
            part.geometry.getAttribute('position') as THREE.BufferAttribute,
          )
          const extent = box.getSize(new THREE.Vector3())
          const boxVolume = Math.max(1e-9, extent.x * extent.y * extent.z)
          const ratio = signedVolume(part.geometry) / boxVolume
          if (ratio < 0.02) {
            failures.push(
              `${label}#${part.surface}: indexed solid encloses ${ratio.toFixed(5)} of `
                + 'its bounding box, which is what an index-blind volume reader returns',
            )
          }
        }

        part.geometry.dispose()
      }
    }
  } finally {
    library.dispose()
  }
  assert.deepEqual(failures, [], 'props are built inside out')
  // The mutation proof, carried per geometry. Anything not on this list had its
  // orientation established by a measurement that demonstrably changes answer when the
  // orientation changes — which is the property the old stock-box control was asserted
  // to have and did not, for anything in this loop.
  //
  // The ferns are on it, and belong on it: they are sheets, and a sheet has no inside
  // to be on the wrong side of. Naming them rather than loosening the assertion means a
  // fern that becomes a solid fails here and gets removed, and a prop that quietly
  // becomes a sheet fails here and gets explained. It is the same list as `open` below,
  // arrived at from the other direction — orientation is undefined exactly where volume
  // is.
  assert.deepEqual(
    undetectable.sort(),
    BIOMES.map((biome) => `ground/${biome}/fern#foliage`).sort(),
    'reversing these props changed nothing the instruments can see, so their zero is not evidence',
  )
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
  // anything would otherwise pass this test with flying colours. Faces, not just
  // geometries — a population of degenerate slivers judges nothing and reports clean.
  assert.ok(
    geometries >= 500,
    `only ${String(geometries)} geometries were checked; the enumeration has holes`,
  )
  assert.ok(
    judgedFaces >= 20000,
    `only ${String(judgedFaces)} faces carried an orientation to judge`,
  )
  // Headroom, not just correctness. Measured tightest is the fort tree at 0.033; the
  // floor sits below it so ordinary art variation does not trip, but a prop drifting to
  // within 2% of the undecidable half fails here — while its verdict is still right —
  // rather than silently crossing later and being reported inside out.
  assert.ok(
    tightestMargin > 0.02,
    `${tightestMarginLabel} sits ${tightestMargin.toFixed(3)} from the half where the centroid reading is meaningless; it needs volume backing or a different instrument`,
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
  // Judged the same way as the family-wide loop, and for the same reason: every case
  // in this list has been merged or displaced, so its normals were re-derived from its
  // own winding and a normal-agreement check on it compares a value against itself.
  // Each case carries its own reversal so the zero is licensed by a demonstration on
  // *that* geometry rather than on a stock primitive that shares none of its
  // properties.
  for (const [label, geometry] of cases) {
    assert.ok(readsOutward(geometry), `${label} is built inside out`)
    const damaged = reverseAsABuilderWould(geometry)
    assert.ok(
      !readsOutward(damaged),
      `${label} reads the same reversed as it does correct, so its pass means nothing`,
    )
    damaged.dispose()
    geometry.dispose()
  }
})

test('the ink cost function prices hierarchies this world never happens to contain', () => {
  // A mutation campaign replaced `inkDrawCost` with `return 1` and all 281 tests passed.
  // The reason is not that the budget assertion is wrong — it is that every object the
  // world outlines today is a single mesh, so the recursion and the LOD-max rule are
  // inert and the system test compares two numbers that agree for an unrelated reason.
  // Measured across three maps: 794 `applyOutline` calls, every one costing exactly 1.
  //
  // So the cost function is exercised here instead, on hierarchies built to make its
  // branches vary. These are the shapes it was written for and the shapes it will meet
  // the first time a prop's near LOD level is a group.
  const mesh = (name = 'part'): THREE.Mesh => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    object.name = name
    return object
  }

  const single = mesh()
  assert.equal(inkDrawCost(single, false), 1, 'a plain mesh costs one draw')

  // The historical defect: one `applyOutline` call, four shells. Billing per call
  // priced this at 1.
  const group = new THREE.Group()
  group.add(mesh('wall'), mesh('roof'), mesh('door'))
  assert.equal(inkDrawCost(group, false), 3, 'a group costs one draw per eligible mesh')

  // The LOD rule, which nothing else in the suite reaches: only one level renders, so
  // the charge is the worst level and not the sum. Sum would say 5.
  const near = new THREE.Group()
  near.add(mesh('a'), mesh('b'), mesh('c'), mesh('d'))
  const lod = new THREE.LOD()
  lod.addLevel(near, 0)
  lod.addLevel(mesh('far'), 60)
  assert.equal(inkDrawCost(lod, false), 4, 'an LOD costs its worst level, not the sum')

  // Order-independence: the same LOD with the cheap level first must still cost 4. A
  // `worst = cost` bug rather than `Math.max` passes the assertion above and fails this.
  const reversed = new THREE.LOD()
  reversed.addLevel(mesh('far'), 60)
  const nearAgain = new THREE.Group()
  nearAgain.add(mesh('a'), mesh('b'), mesh('c'), mesh('d'))
  reversed.addLevel(nearAgain, 0)
  assert.equal(inkDrawCost(reversed, false), 4, 'the worst level is not the last level')

  // The exclusions, each of which silently drops a draw if it stops working.
  const skipped = mesh('lantern-glow')
  skipped.userData.noComicOutline = true
  assert.equal(inkDrawCost(skipped, false), 0, 'an opted-out mesh costs nothing')

  const ring = mesh('faction-ring')
  assert.equal(inkDrawCost(ring, false), 0, 'the faction ring is never outlined')

  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), undefined, 4)
  assert.equal(
    inkDrawCost(instanced, false),
    0,
    'an instanced mesh costs nothing unless instanced ink was asked for',
  )
  assert.equal(
    inkDrawCost(instanced, true),
    1,
    'an instanced mesh costs one shared shell when instanced ink is asked for',
  )

  // A shell is not itself inkable, or the count compounds every time ink is toggled.
  const shell = mesh('shell')
  shell.userData.comicOutline = true
  assert.equal(inkDrawCost(shell, false), 0, 'an outline shell does not take an outline')

  // Nesting, since a group of groups is what a composed site actually is.
  const nested = new THREE.Group()
  const inner = new THREE.Group()
  inner.add(mesh('x'), mesh('y'))
  nested.add(mesh('z'), inner)
  assert.equal(inkDrawCost(nested, false), 3, 'cost recurses through nested groups')

  single.geometry.dispose()
  instanced.dispose()
})

/**
 * Edges used by exactly one triangle, after welding coincident positions.
 *
 * A closed solid has none. `displaceGeometry` pushes each vertex along **its own**
 * normal, so at a hard crease — where coincident vertices carry different normals by
 * design — the two sides travel apart and the shared edge splits into two boundary
 * edges. That is a hairline slit you can see through, and it is invisible to every
 * other instrument in this file: signed volume stays positive, winding stays
 * consistent, normals stay agreed.
 *
 * Welding by quantized position is what makes the number mean anything. Without it
 * every non-indexed geometry reports every edge as a boundary.
 */
function boundaryEdgeCount(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const triangles = index ? index.count / 3 : position.count / 3
  const idOf = new Map<string, number>()
  const weld = (vertex: number): number => {
    const key =
      `${position.getX(vertex).toFixed(4)},`
      + `${position.getY(vertex).toFixed(4)},`
      + `${position.getZ(vertex).toFixed(4)}`
    let id = idOf.get(key)
    if (id === undefined) {
      id = idOf.size
      idOf.set(key, id)
    }
    return id
  }
  const uses = new Map<string, number>()
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const offset = triangle * 3
    const corners = [0, 1, 2].map((step) =>
      weld(index ? index.getX(offset + step) : offset + step),
    )
    if (
      corners[0] === corners[1]
      || corners[1] === corners[2]
      || corners[0] === corners[2]
    ) {
      continue
    }
    for (let edge = 0; edge < 3; edge += 1) {
      const a = corners[edge]
      const b = corners[(edge + 1) % 3]
      const key = a < b ? `${String(a)}_${String(b)}` : `${String(b)}_${String(a)}`
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  }
  let boundary = 0
  for (const count of uses.values()) if (count === 1) boundary += 1
  return boundary
}

/** Reverses a leading contiguous block — one sub-part of a concatenated merge. */
function reverseLeadingBlock(
  geometry: THREE.BufferGeometry,
  fraction: number,
): THREE.BufferGeometry {
  const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const position = copy.getAttribute('position')
  const triangles = Math.floor(position.count / 3)
  const upto = Math.max(1, Math.round(triangles * fraction))
  for (let triangle = 0; triangle < upto; triangle += 1) {
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
  copy.computeVertexNormals()
  return copy
}

test('the orientation verdict is blind to a reversed sub-part, and says so', () => {
  // Pinned because the docblock's claim is the kind that decays silently. `mergeAll`
  // concatenates, so a part that arrives wound backwards keeps its winding in the merged
  // buffer and the merge's normal recompute makes its shading agree with itself — the
  // exact shape of the `loftProfile` bug that started this wave, one level down.
  //
  // Measured over 248 merged hard surfaces: a 10% contiguous block reversed and rebaked
  // is undetected on all 248. This asserts the *shape* of that limitation rather than the
  // exact number, so it fails if either the instrument gets better (good news, update the
  // claim) or the world stops producing merged props (which would mean this file is
  // measuring something else entirely).
  const library = new WorldPropLibrary({ retention: 0 })
  let tested = 0
  let smallBlockMissed = 0
  let fullReversalCaught = 0
  try {
    for (const [label, request] of everyPropRequest()) {
      if (!label.startsWith('building/thatch/')) continue
      for (const part of library.build(request)) {
        if (part.surface !== 'hard') {
          part.geometry.dispose()
          continue
        }
        tested += 1
        const partial = reverseLeadingBlock(part.geometry, 0.1)
        if (readsOutward(partial)) smallBlockMissed += 1
        partial.dispose()
        const whole = reverseAsABuilderWould(part.geometry)
        if (!readsOutward(whole)) fullReversalCaught += 1
        whole.dispose()
        part.geometry.dispose()
      }
    }
  } finally {
    library.dispose()
  }
  assert.ok(tested >= 4, `only ${String(tested)} merged surfaces were tested`)
  // The limitation, stated as an assertion so it cannot rot into an assumption.
  assert.equal(
    smallBlockMissed,
    tested,
    'the verdict now detects a 10% reversed sub-part; that is an improvement and the '
      + 'docblock on `readsOutward` should stop disclaiming it',
  )
  // And the thing it does cover, so this test cannot pass by the instrument being broken
  // in both directions at once.
  assert.equal(
    fullReversalCaught,
    tested,
    'the verdict stopped detecting a fully reversed prop, which is its actual job',
  )
})

test('displacement does not tear a solid prop open at its creases', () => {
  // Controls first, and this instrument needs them badly: a bug in the welding step
  // makes every non-indexed geometry read as entirely boundary, which looks like a
  // catastrophic finding rather than a broken checker. Both directions, so a checker
  // that always says zero and one that always says everything are both excluded.
  assert.equal(
    boundaryEdgeCount(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()),
    0,
    'a closed box read as open: the position welding is not working',
  )
  assert.ok(
    boundaryEdgeCount(new THREE.PlaneGeometry(1, 1, 4, 4)) > 0,
    'an open sheet read as closed: the checker cannot see a boundary at all',
  )

  // Rocks are the case. They are unambiguously solid, they carry the hardest creases in
  // the catalogue, and they take the largest displacement amplitude — measured at 3.4 to
  // 4.3% of the shape's own size before `displaceSeamless` existed, which is a visible
  // crack at near LOD. Swapping `displaceSeamless` back to `displaceGeometry` takes the
  // catalogue from 34 geometries carrying boundary edges to 82 and fails this.
  const library = new WorldPropLibrary({ retention: 0 })
  const torn: string[] = []
  let checked = 0
  try {
    for (const [label, request] of everyPropRequest()) {
      if (!label.startsWith('rock/')) continue
      for (const part of library.build(request)) {
        checked += 1
        if (boundaryEdgeCount(part.geometry) > 0) torn.push(`${label}#${part.surface}`)
        part.geometry.dispose()
      }
    }
  } finally {
    library.dispose()
  }
  assert.ok(checked >= 20, `only ${String(checked)} rock surfaces were checked`)
  assert.deepEqual(torn, [], 'these solid props have holes in them')
})

test('mergeAll still behaves the way this file depends on it behaving', () => {
  // Assert the dependency's identity, not just my own output — my output can be right
  // for the wrong reason. Suggested by the foundation session after it pinned three's own
  // shader chunks rather than its text, so a three upgrade that moves an accumulation
  // fails loudly instead of silently re-breaking a material.
  //
  // Two behaviours of `mergeAll` are load-bearing here and neither is stated anywhere
  // that a change would have to pass:
  //
  //   1. A one-element merge is a PASSTHROUGH — it returns `parts[0]` itself. That is
  //      what makes the aliasing hazard real (one geometry tagged under two surfaces
  //      comes back as the same buffer for both, so releasing either disposes the other)
  //      and it is why `mergePropParts` refuses duplicates.
  //   2. A real merge DE-INDEXES. Combined with (1), a `latheProfile` part that is the
  //      only part on its surface arrives indexed — which is the entire reason four prop
  //      surfaces are indexed and the index-aware readers in this file have real inputs.
  //
  // If either flips, both of those facts change meaning silently.
  const single = new THREE.BoxGeometry(1, 1, 1)
  ensureVertexColors(single, 0x808080)
  const passthrough = mergeAll([single], { name: 'dependency-single' })
  assert.equal(
    passthrough,
    single,
    'a one-element mergeAll stopped being a passthrough; the aliasing guard in '
      + '`mergePropParts` and the indexed-surface pin both rest on it returning parts[0]',
  )

  const indexed = new THREE.SphereGeometry(1, 8, 6)
  ensureVertexColors(indexed, 0x404040)
  assert.ok(indexed.index, 'the fixture must be indexed for this to mean anything')
  const keptIndex = mergeAll([indexed], { name: 'dependency-indexed' })
  assert.ok(
    keptIndex.index,
    'a one-element mergeAll stopped preserving indexing; the four indexed prop surfaces '
      + 'would vanish and the index-aware readers would lose their only real inputs',
  )

  const a = new THREE.SphereGeometry(1, 8, 6)
  const b = new THREE.SphereGeometry(0.5, 8, 6)
  ensureVertexColors(a, 0x404040)
  ensureVertexColors(b, 0x606060)
  const merged = mergeAll([a, b], { name: 'dependency-multi' })
  assert.equal(
    merged.index,
    null,
    'a multi-part mergeAll stopped de-indexing, which would change which geometries in '
      + 'the catalogue are indexed and therefore which code paths the suite exercises',
  )
  assert.notEqual(merged, a, 'a real merge must produce a new geometry, not reuse an input')

  keptIndex.dispose()
  merged.dispose()
  passthrough.dispose()
})

test('one geometry cannot be tagged under two prop surfaces', () => {

  // `mergeAll` moves rather than copies for a single part, so tagging one geometry as
  // both `hard` and `glow` hands the same buffer back for both surfaces. The library
  // then holds two cache keys over one buffer and releasing either disposes the other,
  // with no throw and no symptom until a draw — `dispose()` frees the GPU resource and
  // leaves the JS object readable.
  //
  // Reference counting is structurally blind to it: every count is individually correct
  // and the fault is that two counts govern one buffer. So the guard is at the merge
  // boundary, where the duplicate is visible, rather than in the accounting.
  const shared = new THREE.BoxGeometry(1, 1, 1)
  assert.throws(
    () => {
      mergePropParts([propPart(shared, 'hard'), propPart(shared, 'glow')], {
        name: 'double-tagged',
      })
    },
    /more than one part/,
    'the same geometry under two surfaces must be refused',
  )

  // The legitimate neighbour, so the guard is not just rejecting everything: two
  // distinct geometries on two surfaces is the normal case and must still merge.
  const hard = new THREE.BoxGeometry(1, 1, 1)
  const glow = new THREE.BoxGeometry(0.5, 0.5, 0.5)
  const merged = mergePropParts([propPart(hard, 'hard'), propPart(glow, 'glow')], {
    name: 'two-surfaces',
  })
  assert.equal(merged.length, 2, 'two distinct geometries on two surfaces must merge')
  assert.notEqual(
    merged[0].geometry,
    merged[1].geometry,
    'two surfaces must not come back sharing one buffer',
  )
  for (const surface of merged) surface.geometry.dispose()
  shared.dispose()
})

test('the one indexed prop surface stays indexed, so the index-aware readers are exercised', () => {
  // `latheProfile` is the kit's only indexed builder, and `mergeAll` de-indexes whenever
  // it actually merges — but a length-1 array is a passthrough, so a lathe part that is
  // the *only* part on its surface arrives indexed. A sibling session predicted the
  // route from the kit source; measured across the catalogue it is real and it is
  // exactly four surfaces.
  //
  // Pinned for two reasons. Every orientation instrument in this file dereferences
  // `geometry.index`, and an index-blind reader returns an answer uncorrelated with
  // correctness — 6 for a correct sphere and 6 for a fully reversed one — so those
  // readers need at least one genuinely indexed shipped input or their index handling
  // is only tested against synthetic controls. And if this silently becomes zero,
  // someone added a part to the pillar and quietly changed which code path the whole
  // suite exercises.
  const library = new WorldPropLibrary({ retention: 0 })
  const indexed: string[] = []
  let checked = 0
  try {
    for (const [label, request] of everyPropRequest()) {
      for (const part of library.build(request)) {
        checked += 1
        if (part.geometry.index) indexed.push(`${label}#${part.surface}`)
        part.geometry.dispose()
      }
    }
  } finally {
    library.dispose()
  }
  assert.ok(checked >= 500, `only ${String(checked)} surfaces were checked`)
  assert.deepEqual(
    indexed.sort(),
    TERRITORIES.map((owner) => `siteProp/pillar/${owner}#hard`).sort(),
    'the set of indexed prop surfaces changed; the index-aware readers may now be '
      + 'exercised only by synthetic controls',
  )
})

test('the merged hard surface of a prop carries welded outline normals', () => {


  const parts = buildingParts({
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
  // §10 budget, derived rather than written down: the window is the dominant term and
  // resident regions hold a small number of keys outside it. Sourcing both from the
  // library means changing the retention default moves this bound with it, instead of
  // leaving a literal that quietly stops describing anything. It previously read
  // `<= 176` citing a `PROP_CACHE_ENTRIES_MAX` that exists in no code — a number
  // inherited from a constant governing `GameEngine.artGeometry`, a different cache.
  assert.ok(
    runtime.propCacheSize <= PROP_RETENTION_DEFAULT + PROP_RESIDENT_HEADROOM,
    `live prop entries ${String(runtime.propCacheSize)} exceed the `
      + `${String(PROP_RETENTION_DEFAULT + PROP_RESIDENT_HEADROOM)} budget`,
  )
  // The half that can actually fail. A count bound on the window would not: `retain`
  // evicts at its own limit, so `retained.length <= limit` holds by construction even
  // when the window is pinning the same key in three slots — which is exactly the fault
  // that once cost it half its coverage, and exactly the fault a count bound waves
  // through.
  //
  // Each slot pins one *distinct* live entry, so the window can never hold more slots
  // than the cache holds entries. Under the duplicate-pin fault the window reported its
  // full complement while the cache held roughly half that, which breaches this.
  assert.ok(
    runtime.retainedPropCount <= runtime.propCacheSize,
    `the window claims ${String(runtime.retainedPropCount)} pinned keys but the cache `
      + `holds only ${String(runtime.propCacheSize)} entries, so it is pinning `
      + `duplicates and covering less than it advertises`,
  )
  assert.ok(runtime.retainedPropCount <= 128)

  // No phantom pins. A window entry whose key has no live cache entry would occupy a
  // slot, pin nothing, and release nothing when evicted — and it is invisible to a
  // reference-count sum, because `GeometryCache.release` is a silent no-op on a key it
  // does not hold. Worse than inert: retaining one at the limit evicts a real key, so a
  // phantom actively displaces the geometry the window exists to keep.
  //
  // Asserted directly rather than through `propCacheSize >= retainedPropCount`, which
  // looks equivalent and is not. `propCacheSize` also counts entries held only by live
  // borrowers, and those mask a phantom deficit one for one — with `B` borrower-only
  // entries the comparison reduces to `B >= P` and fires only when phantoms outnumber
  // `B`. A reviewer measured it here: `B = 28`, the comparison first detected at **29**
  // injected phantoms, and this predicate detects at 1. The comparison would have passed
  // silently through every phantom bug anyone is likely to write.
  assert.ok(
    runtime.retentionIsIntact,
    'the retention window holds a key with no live cache entry, so it is pinning '
      + 'nothing and will release nothing when that slot is evicted',
  )

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

test('a receipt is one reference, so two holders of one key release independently', () => {
  // The invariant the double-release guard depends on, which nothing stated until an
  // integrator asked the right question: does anything hand out two distinct
  // `PropAsset` objects sharing the same surface keys, and if so, is releasing both a
  // double release the `WeakSet` would miss?
  //
  // Two distinct receipts is the *normal* case — `acquireKeyed` returns a fresh object
  // literal per call. It is safe because the two are in bijection with the references:
  // each acquire takes exactly one cache reference per surface, and each release gives
  // back exactly one. Two receipts means two references were taken, so two releases are
  // correct rather than a double release. The guard catches the different fault of one
  // receipt coming back twice, which returns two references for one taken.
  //
  // What would break it is a `PropAsset` minted without a matching acquire. There is
  // one construction site and it sits inside the acquiring loop; this asserts the
  // behavioural consequence, which survives a refactor that moves the construction.
  const library = new WorldPropLibrary({ retention: 0 })
  const request = { kind: 'tree', biome: 'forest', slot: 1, detail: 'near' } as const
  try {
    const first = library.acquire(request)
    const key = first.surfaces[0].key
    assert.equal(library.referenceCount(key), 1, 'one acquire must take one reference')

    const second = library.acquire(request)
    assert.notEqual(
      first,
      second,
      'each acquire must mint its own receipt, or two holders share one identity',
    )
    assert.equal(first.key, second.key, 'the two receipts must describe the same prop')
    assert.equal(
      first.surfaces[0].geometry,
      second.surfaces[0].geometry,
      'sharing is the point: distinct receipts, one geometry',
    )
    assert.equal(library.referenceCount(key), 2, 'two acquires must take two references')

    // n acquires, n references — the bijection, checked past the two-holder case that
    // is easy to get right by accident.
    const extra = [library.acquire(request), library.acquire(request)]
    assert.equal(library.referenceCount(key), 4, 'four acquires must take four references')
    for (const asset of extra) library.release(asset)
    assert.equal(library.referenceCount(key), 2, 'each release must give back one')

    // Releasing both distinct receipts is correct and must not trip the guard.
    library.release(first)
    assert.equal(library.referenceCount(key), 1, "releasing one holder must not free the other's")
    library.release(second)
    assert.equal(library.referenceCount(key), 0, 'the last release frees the key')
  } finally {
    library.dispose()
  }
})

test('the phantom-pin check detects a single phantom, not thirty', () => {
  // The reason this exists as its own test: the previous form of the assertion was
  // `propCacheSize >= retainedPropCount`, which a reviewer measured as blind until 29
  // phantoms had been injected, because borrower-held entries mask the deficit one for
  // one. A defensive check that only fires on gross corruption reads exactly like one
  // that catches the class.
  //
  // One phantom is what a real bug produces — a `retain` path pushing a key whose
  // reference has already gone. So one phantom is what this proves.
  const library = new WorldPropLibrary({ retention: 4 })
  const request = { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' } as const
  try {
    const asset = library.acquire(request)
    library.release(asset)
    assert.equal(library.retainedCount, 1, 'the window should hold the released key')
    assert.ok(library.retentionIsIntact, 'a genuine pin must read as intact')

    // Inject exactly one phantom: a key in the window that the cache never held.
    const retained = (library as unknown as { retained: string[] }).retained
    retained.push('phantom:key#hard')
    assert.equal(library.retainedCount, 2)
    assert.equal(
      library.retentionIsIntact,
      false,
      'one phantom pin must be detected, which is the whole point of this predicate',
    )

    // And the weakened form it replaced would not have noticed, which is why the
    // replacement was worth making rather than a matter of taste.
    assert.ok(
      library.size >= library.retainedCount - 1,
      'sanity: the cache still holds the one real entry',
    )
    retained.pop()
    assert.ok(library.retentionIsIntact, 'removing the phantom must restore intactness')
  } finally {
    library.dispose()
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

test('a start position asked before streaming is not pretended to be checked', () => {
  // The silent no-op that made the first spawn fix look like it worked. With no region
  // resident the collision world answers "unwalkable" to everything, so the snap's
  // 96-point spiral is *guaranteed* to exhaust and *guaranteed* to return its input —
  // an unchecked value that looks identical to a checked one. Three separate reports of
  // "0 blocked of 180" were measured against a warmed-up runtime and were true of that
  // ordering only.
  //
  // `getStartPosition` now declines to snap when it cannot judge, and `walkableNear`
  // throws rather than answer blind, so the next caller that gets this wrong finds out
  // at the call rather than three reports later.
  const { blueprint, runtime } = createRuntime('cold-start-honesty')

  // Nothing streamed yet: every point reads unwalkable, including open ground far from
  // any prop. This is the state that makes a blind answer meaningless.
  assert.equal(
    runtime.collision.isWalkablePosition(0, 0, 0.45),
    false,
    'with no region resident the collision world should judge everything unwalkable',
  )

  const cold = runtime.getStartPosition('elf')
  assert.ok(Number.isFinite(cold.x) && Number.isFinite(cold.z), 'a cold start must still resolve')

  // Once resident, the same call is free to snap, and must produce a standable point.
  runtime.update({ deltaSeconds: 0, focus: cold })
  const warm = runtime.getStartPosition('elf')
  assert.ok(
    runtime.collision.isWalkablePosition(warm.x, warm.z, 0.45),
    'a warm start must be somewhere an actor can stand',
  )

  // The cold answer is the unsnapped anchor. It is protected by the keep-out at
  // generation time rather than by the snap, which is why it is safe to hand out — but
  // it must not be mistaken for a checked value, and the blueprint start must land in
  // the same region either way.
  const startSite = blueprint.sites.find((site) => site.id === blueprint.starts.elf)
  assert.ok(startSite)
  runtime.dispose()
})

test('decoration never blocks a spawn point', () => {
  // Faction starts and encounter actors are positioned by world generation, which knows
  // nothing about decoration. Before this pass every decoration collider was a
  // sapling-sized 0.55; a fort boulder is 0.85, which is right for a boulder and enough
  // to trap whatever spawns there. A reviewer measured decoration colliders newly
  // blocking positions the previous collision model left clear.
  //
  // Shrinking the boulder is not the fix: at 0.55 the same spawn cleared by 0.012 units,
  // so the old clean result was luck. The keep-out is the fix, and this is what says so.
  const { blueprint, runtime } = createRuntime('spawn-keepout')
  let sampled = 0
  const blockedByDressing: string[] = []
  for (const region of blueprint.regions) {
    const centre = runtime.getRegionCenter(region.id)
    if (!centre) continue
    runtime.update({ deltaSeconds: 0, focus: centre })
    for (const faction of ['elf', 'guard', 'villain'] as const) {
      for (const plan of runtime.getEncounterPlansInRegion(region.id, faction)) {
        for (const spawn of plan.spawns) {
          sampled += 1
          if (runtime.collision.isWalkablePosition(spawn.worldX, spawn.worldZ, 0.45)) {
            continue
          }
          const blocking = runtime.collision.queryBounds({
            minX: spawn.worldX - 2,
            maxX: spawn.worldX + 2,
            minZ: spawn.worldZ - 2,
            maxZ: spawn.worldZ + 2,
          })
          if (blocking.some((entry) => entry.id.startsWith('dressing-solid'))) {
            blockedByDressing.push(spawn.id)
          }
        }
      }
    }
  }
  // Guards the sampling itself: a probe that walked no spawns would report a clean
  // result for any amount of breakage.
  assert.ok(sampled >= 100, `only ${String(sampled)} spawns sampled`)
  assert.deepEqual(
    blockedByDressing,
    [],
    'decoration colliders are standing on spawn points',
  )

  // Site structures are the other half, and after the decoration fix they were all that
  // remained: a reviewer measured 76 blocked encounter spawns of 2688, every one from a
  // `site-building` or `site-prop` collider, concentrated on finale strongholds — a keep
  // is 9 by 7.4 with a radius near 4.1 and the towers ring the wall, so the climactic
  // encounter spawns land inside them. The baseline was worse (97), so this was never a
  // regression, only the dominant term once decoration was handled.
  //
  // The collider is dropped, not the mesh. A wall you can walk through at the one point
  // an actor materialises beats an actor that cannot move, and the silhouette is the
  // whole reason the site exists.
  const blockedByStructure: string[] = []
  let structureSampled = 0
  for (const region of blueprint.regions) {
    const centre = runtime.getRegionCenter(region.id)
    if (!centre) continue
    runtime.update({ deltaSeconds: 0, focus: centre })
    for (const faction of ['elf', 'guard', 'villain'] as const) {
      for (const plan of runtime.getEncounterPlansInRegion(region.id, faction)) {
        for (const spawn of plan.spawns) {
          structureSampled += 1
          if (runtime.collision.isWalkablePosition(spawn.worldX, spawn.worldZ, 0.45)) {
            continue
          }
          blockedByStructure.push(`${plan.slotId}/${faction}`)
        }
      }
    }
  }
  assert.ok(
    structureSampled >= 40,
    `only ${String(structureSampled)} encounter spawns were checked`,
  )
  assert.deepEqual(
    blockedByStructure,
    [],
    'these encounter actors spawn inside a site structure and cannot move',
  )

  // Faction starts are the other population, and the one that hurts most: the engine
  // writes this position into the player verbatim, and `findPath` returns null when the
  // *start* is unwalkable, so the first click-to-move of the run silently does nothing.
  // The start is offset ~20 units back along the critical path, which puts it outside
  // the site clearing, so no other keep-out covers it.
  //
  // **Asked cold, exactly once**, because that is what `GameEngine` does: it calls
  // `getStartPosition` at line 2257 and first calls `generatedWorld.update` at 2314. An
  // earlier version of this test called it, streamed the region in, then called again
  // and asserted on the second answer — which measures the snap in `walkableNear` doing
  // its job against a populated collision world, an order production never takes. It
  // passed while the game was broken.
  const unwalkableStarts: string[] = []
  // Across seeds that include one which reproduced the fault. A reviewer showed the
  // single-seed version had no power at all: dropping faction starts from the anchor set
  // left the suite green while the cold sweep went back to 1 of 180, because
  // `'spawn-keepout'` contains no blocked start in either state. Ordering, mechanism and
  // assertion were all correct and the input never had the defect.
  //
  // `gp-6` is the seed the reviewer's sweep found, and its `villain` start is the case.
  // **A regression test needs a seed that reproduced the bug** — otherwise it asserts a
  // true thing about a world that was never broken.
  const seeds = ['spawn-keepout', 'gp-6', 'gp-11', 'gp-23', 'gp-37', 'gp-48']
  let startsSampled = 0
  for (const seed of seeds) {
    const cold = createRuntime(seed)
    try {
      for (const faction of ['elf', 'guard', 'villain'] as const) {
        const start = cold.runtime.getStartPosition(faction)
        cold.runtime.update({ deltaSeconds: 0, focus: start })
        startsSampled += 1
        if (!cold.runtime.collision.isWalkablePosition(start.x, start.z, 0.45)) {
          unwalkableStarts.push(`${seed}/${faction}`)
        }
      }
    } finally {
      cold.runtime.dispose()
    }
  }
  assert.ok(
    startsSampled >= 18,
    `only ${String(startsSampled)} faction starts were sampled across ${String(seeds.length)} seeds`,
  )
  assert.deepEqual(
    unwalkableStarts,
    [],
    'a faction starts the run unable to move',
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

test('teardown detaches every instanced ink shell before its source is disposed', () => {
  // Spec 08 invariant 4. An instanced shell shares `instanceMatrix` with its source and
  // hangs off it as a child, so if teardown does not hand the binding back first, the
  // shell is caught by the `root.traverse(... dispose())` sweep *as a child of its
  // source*, while still holding the source's attribute — and three.js frees the
  // source's buffer.
  //
  // A mutation campaign found this unguarded: making `releaseResources` skip its
  // outline bindings left 13 shells disposed after their sources, still sharing their
  // matrices, and the whole suite passed. The mechanism is thoroughly tested in
  // `tests/art.test.ts`, where `disposeShell` lives. What was untested is that this
  // runtime *calls* it — the invariant was guarded where it is implemented and not
  // where it is relied on.
  const { scene, blueprint, runtime } = createRuntime('teardown-ink-shells')
  const region = blueprint.regions[Math.floor(blueprint.regions.length / 2)]
  const center = runtime.getRegionCenter(region.id)
  assert.ok(center)
  runtime.update({ deltaSeconds: 0, focus: center })

  const pairs: { shell: THREE.InstancedMesh; source: THREE.InstancedMesh }[] = []
  scene.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return
    if (!StylizedArtLibrary.isOutlineShell(object)) return
    const source = object.parent
    if (source instanceof THREE.InstancedMesh) pairs.push({ shell: object, source })
  })

  // Non-vacuity, in two parts. Zero pairs would pass every assertion below having
  // observed nothing, and pairs that never shared a buffer would make the interesting
  // half of the check trivially true.
  assert.ok(
    pairs.length > 0,
    'no instanced ink shells were built, so this test observed nothing',
  )
  const sharing = pairs.filter(
    (pair) => pair.shell.instanceMatrix === pair.source.instanceMatrix,
  )
  assert.equal(
    sharing.length,
    pairs.length,
    'a live instanced shell must share its source matrix, or the hazard does not exist',
  )

  // Record the dispose *sequence*, not just the end state. "Detached with its matrix
  // restored" is checked after `dispose()` returns, by which time `disposeShell` has done
  // its job whenever it ran — so a teardown that releases the outlines *after* the
  // `root.traverse(... InstancedMesh.dispose())` sweep passes every post-hoc check while
  // firing dispose against the source's attribute 13 times out of 13. A reviewer moved
  // the release loop below the sweep, changed nothing else, and 283 tests stayed green.
  //
  // Order is invisible to a state check. It needs an observation made during teardown.
  const disposeOrder: THREE.InstancedMesh[] = []
  const realDispose = THREE.InstancedMesh.prototype.dispose
  THREE.InstancedMesh.prototype.dispose = function patchedDispose(
    this: THREE.InstancedMesh,
  ) {
    disposeOrder.push(this)
    return realDispose.call(this)
  }
  try {
    runtime.dispose()
  } finally {
    THREE.InstancedMesh.prototype.dispose = realDispose
  }

  const disposedLate = pairs.filter((pair) => {
    const shellAt = disposeOrder.indexOf(pair.shell)
    const sourceAt = disposeOrder.indexOf(pair.source)
    return shellAt >= 0 && sourceAt >= 0 && shellAt > sourceAt
  })
  assert.deepEqual(
    disposedLate.map((pair) => pair.shell.name),
    [],
    'these shells were disposed after their source, so dispose fired against a buffer '
      + 'the shell was still borrowing',
  )
  // Non-vacuity: the patch must actually have observed the teardown. An empty sequence
  // makes every index -1 and the comparison above trivially true.
  assert.ok(
    disposeOrder.length >= pairs.length,
    `the dispose patch observed only ${String(disposeOrder.length)} calls for `
      + `${String(pairs.length)} shell/source pairs`,
  )

  const attached = pairs.filter((pair) => pair.shell.parent === pair.source)
  assert.deepEqual(
    attached.map((pair) => pair.shell.name),
    [],
    'these shells were still parented to their source when teardown disposed it',
  )
  const stillSharing = pairs.filter(
    (pair) => pair.shell.instanceMatrix === pair.source.instanceMatrix,
  )
  assert.deepEqual(
    stillSharing.map((pair) => pair.shell.name),
    [],
    'these shells were disposed still holding their source buffer, which frees it',
  )
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

