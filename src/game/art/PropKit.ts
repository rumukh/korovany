import * as THREE from 'three'
import { fbm3 } from './ArtNoise.ts'
import type { ArtVariation } from './ArtRandom.ts'
import {
  bakeOutlineNormals,
  bakeSkyOcclusion,
  bakeVerticalOcclusion,
  branchStructure,
  displaceGeometry,
  ensureVertexColors,
  extrudeProfile,
  gradientVertexColors,
  latheProfile,
  loftProfile,
  mergeAll,
  paintVertexColors,
  polygonProfile,
  rectProfile,
  taperedBox,
  transformed,
  tubeAlongPoints,
  type TaperedBoxOptions,
  type TransformOptions,
} from './GeometryKit.ts'

/**
 * The world-object vocabulary for КОРОВАНЫ.
 *
 * `GeometryKit` knows how to make *shapes*; this module knows what the world is made
 * of. Wall segments with doors and shuttered windows, roofs with real eaves and a
 * ridge, chimneys, porches, fences, gates, wells, market stalls, banners, carts,
 * barrels, braziers, three tree species per biome, layered rock, and bridges that are
 * not two boxes.
 *
 * Two conventions run through everything here and both are load-bearing:
 *
 * 1. **Every geometry carries a `color` attribute.** Props are drawn with
 *    vertex-coloured materials, and a vertex-coloured material on geometry without
 *    colours renders black. There is no texture budget in this game; baked vertex
 *    colour is the entire detail layer.
 * 2. **Composite props return `PropPart[]`, not a geometry.** A lantern is a wooden
 *    post and a glowing pane, a stall is timber and striped cloth. Tagging each part
 *    with the surface it wants lets a caller merge a whole settlement into one mesh
 *    per surface — four draw calls for a village instead of forty.
 *
 * Nothing here reads the clock or calls `Math.random()`. Variation arrives as an
 * `ArtVariation` the caller opened, so a prop built from a constant seed is
 * byte-identical everywhere and can be shared as a single buffer by the whole world.
 */

// ---------------------------------------------------------------------------
// Surfaces and parts
// ---------------------------------------------------------------------------

/**
 * The material family a part wants.
 *
 * Deliberately coarse. Timber, stone, thatch and iron all collapse into `hard`
 * because their stylized presets differ by a few hundredths of roughness while the
 * baked vertex colour differs by everything — and merging them halves the draw calls
 * for every settlement in the world.
 */
export type PropSurface = 'hard' | 'cloth' | 'foliage' | 'glow'

export interface PropPart {
  geometry: THREE.BufferGeometry
  surface: PropSurface
}

/** Stable merge order, so a composed site produces meshes in a fixed sequence. */
export const PROP_SURFACES: readonly PropSurface[] = [
  'hard',
  'foliage',
  'cloth',
  'glow',
]

export interface MergedPropSurface {
  surface: PropSurface
  geometry: THREE.BufferGeometry
}

/**
 * Merges tagged parts into one geometry per surface.
 *
 * Consumes the parts: merging is a move. Surfaces with no parts are omitted rather
 * than returned empty, so callers never create a mesh with zero triangles.
 */
export function mergePropParts(
  parts: readonly PropPart[],
  options: { name?: string; outlineNormals?: boolean } = {},
): MergedPropSurface[] {
  const merged: MergedPropSurface[] = []
  for (const surface of PROP_SURFACES) {
    const geometries = parts
      .filter((part) => part.surface === surface)
      .map((part) => part.geometry)
    if (geometries.length === 0) continue
    const geometry = mergeAll(geometries, {
      name: `${options.name ?? 'prop'}-${surface}`,
    })
    // Always re-bake, never inherit. A part that arrived already welded — a building
    // handed straight to an LOD level, say — carries normals welded against *its own*
    // corners, and `mergeAll` fills the gaps for parts that had none by copying their
    // shading normals. Both are wrong for the merged whole: the seams between parts
    // are exactly where an unwelded hull cracks open.
    if (options.outlineNormals !== false && surface === 'hard') {
      bakeOutlineNormals(geometry)
    }
    merged.push({ surface, geometry })
  }
  return merged
}

/** Bakes a transform into every part. Returns the same array for chaining. */
export function transformParts(
  parts: readonly PropPart[],
  transform: TransformOptions,
): readonly PropPart[] {
  for (const part of parts) transformed(part.geometry, transform)
  return parts
}

/** Tags a geometry with the surface it should be drawn with. */
export function propPart(
  geometry: THREE.BufferGeometry,
  surface: PropSurface = 'hard',
): PropPart {
  return { geometry, surface }
}

// ---------------------------------------------------------------------------
// Internal shape helpers
// ---------------------------------------------------------------------------

type PieceShape = Omit<TaperedBoxOptions, 'width' | 'height' | 'depth'>

/**
 * A flat-coloured box, anchored at its base and placed in one call.
 *
 * Nine tenths of a building is boxes at known offsets; spelling that out with
 * `taperedBox` + `ensureVertexColors` + `transformed` at every site would triple the
 * length of this file and hide the shape behind the plumbing.
 */
function piece(
  width: number,
  height: number,
  depth: number,
  color: THREE.ColorRepresentation,
  transform: TransformOptions = {},
  shape: PieceShape = {},
): THREE.BufferGeometry {
  const geometry = taperedBox({
    width,
    height,
    depth,
    anchor: 'base',
    ...shape,
  })
  ensureVertexColors(geometry, color)
  return transformed(geometry, transform)
}

/** Overrides a part's colour with a vertical ramp. */
function shade(
  geometry: THREE.BufferGeometry,
  bottom: THREE.ColorRepresentation,
  top: THREE.ColorRepresentation,
  bias = 1,
): THREE.BufferGeometry {
  return gradientVertexColors(geometry, { bottom, top, bias })
}

/**
 * Breaks a flat colour up with seeded noise.
 *
 * A stone wall that is one RGB triple reads as plastic no matter how good the
 * lighting is. Three percent of mottling in the vertex colour is invisible as an
 * effect and completely changes how the surface sits in a frame.
 */
function mottle(
  geometry: THREE.BufferGeometry,
  seed: number,
  strength = 0.08,
  frequency = 1.4,
): THREE.BufferGeometry {
  return paintVertexColors(geometry, (context, out) => {
    const sample = fbm3(
      context.x * frequency,
      context.y * frequency,
      context.z * frequency,
      seed,
      2,
    )
    out.multiplyScalar(1 + sample * strength)
  })
}

function colorOf(value: THREE.ColorRepresentation): THREE.Color {
  return new THREE.Color(value)
}

/** Mixes towards white for a highlight or towards near-black for a shadow. */
function tone(value: THREE.ColorRepresentation, amount: number): THREE.Color {
  const target = amount >= 0 ? WHITE : NEAR_BLACK
  return colorOf(value).lerp(target, Math.min(1, Math.abs(amount)))
}

const WHITE = new THREE.Color(0xffffff)
const NEAR_BLACK = new THREE.Color(0x0a0b0d)

// ---------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------

export type TreeSpecies =
  | 'conifer'
  | 'broadleaf'
  | 'slender'
  | 'dead'
  | 'topiary'
  | 'thorn'

export interface TreePalette {
  bark: THREE.ColorRepresentation
  barkShade: THREE.ColorRepresentation
  canopyLow: THREE.ColorRepresentation
  canopyHigh: THREE.ColorRepresentation
}

export interface TreeOptions {
  variation: ArtVariation
  /** Uint32 noise seed for bark displacement. */
  noiseSeed: number
  palette: TreePalette
  height?: number
  trunkRadius?: number
  canopyRadius?: number
  /** `far` drops branch recursion and canopy tiers for the distant LOD level. */
  detail?: 'near' | 'far'
  name?: string
}

/**
 * A tree, by species.
 *
 * The world used to have exactly one tree per biome, which is why a forest read as
 * wallpaper: identical silhouettes repeated at three scales. Each species here has a
 * different *shape grammar* — a conifer is stacked tiers, a broadleaf is a branched
 * skeleton under clustered lobes, a birch is a bare pale pole with a high crown — so
 * a mixed stand has a varied skyline even though every instance shares one buffer.
 */
export function treeGeometry(
  species: TreeSpecies,
  options: TreeOptions,
): THREE.BufferGeometry {
  const geometry = buildTree(species, options)
  geometry.name = options.name ?? `prop-tree-${species}`
  bakeSkyOcclusion(geometry, { strength: 0.24 })
  bakeVerticalOcclusion(geometry, { strength: 0.26, falloff: 0.9 })
  return bakeOutlineNormals(geometry)
}

function buildTree(
  species: TreeSpecies,
  options: TreeOptions,
): THREE.BufferGeometry {
  switch (species) {
    case 'conifer':
      return coniferGeometry(options)
    case 'broadleaf':
      return broadleafGeometry(options)
    case 'slender':
      return slenderTreeGeometry(options)
    case 'dead':
      return deadTreeGeometry(options)
    case 'topiary':
      return topiaryGeometry(options)
    default:
      return thornTreeGeometry(options)
  }
}

/** A tapered trunk with a root flare, displaced into bark. */
function trunkGeometry(
  height: number,
  radius: number,
  palette: TreePalette,
  noiseSeed: number,
  sides: number,
  lean: number,
  detail: 'near' | 'far',
): THREE.BufferGeometry {
  const trunk = loftProfile({
    profile: polygonProfile(radius, detail === 'far' ? 5 : sides),
    sections: [
      { y: 0, scaleX: 1.34 },
      { y: height * 0.08, scaleX: 0.94 },
      { y: height * 0.42, scaleX: 0.74, offsetX: lean * 0.35 },
      { y: height * 0.78, scaleX: 0.56, offsetX: lean * 0.75 },
      { y: height, scaleX: 0.4, offsetX: lean },
    ],
    name: 'tree-trunk',
  })
  if (detail === 'near') {
    displaceGeometry(trunk, {
      seed: noiseSeed,
      amplitude: radius * 0.16,
      frequency: 2.4,
      octaves: 2,
      flatBase: height * 0.06,
    })
  }
  return shade(trunk, palette.barkShade, palette.bark, 0.75)
}

function coniferGeometry(options: TreeOptions): THREE.BufferGeometry {
  const variation = options.variation
  const height = options.height ?? 5.4
  const radius = options.trunkRadius ?? 0.3
  const canopyRadius = options.canopyRadius ?? 1.75
  const detail = options.detail ?? 'near'
  const lean = variation.signed(0.12)
  const parts = [
    trunkGeometry(
      height,
      radius,
      options.palette,
      options.noiseSeed,
      7,
      lean,
      detail,
    ),
  ]

  // Tiers overlap by design: a gap between two skirts reads as a mistake, an
  // overlap reads as a branch whorl growing out from under the one above it.
  const tierCount = detail === 'far' ? 3 : 5
  for (let index = 0; index < tierCount; index += 1) {
    const amount = index / (tierCount - 1)
    const base = height * (0.16 + amount * 0.66)
    const tierRadius = canopyRadius * (1 - amount * 0.66) * variation.around(1, 0.08)
    const tierHeight = height * (0.3 - amount * 0.13)
    const tier = loftProfile({
      profile: polygonProfile(tierRadius, detail === 'far' ? 6 : 8, variation.angle()),
      sections: [
        { y: 0, scaleX: 0.42 },
        { y: tierHeight * 0.1, scaleX: 1 },
        { y: tierHeight * 0.55, scaleX: 0.7 },
        { y: tierHeight, scaleX: 0.06 },
      ],
      name: `tree-tier-${String(index)}`,
    })
    transformed(tier, {
      position: { x: lean * amount * 0.8, y: base, z: 0 },
      rotation: { x: 0, y: variation.angle(), z: 0 },
    })
    shade(
      tier,
      tone(options.palette.canopyLow, -0.12 + amount * 0.12),
      options.palette.canopyHigh,
      0.85,
    )
    parts.push(tier)
  }
  return mergeAll(parts, { name: 'prop-conifer' })
}

function broadleafGeometry(options: TreeOptions): THREE.BufferGeometry {
  const variation = options.variation
  const height = options.height ?? 4.6
  const radius = options.trunkRadius ?? 0.34
  const canopyRadius = options.canopyRadius ?? 2.1
  const detail = options.detail ?? 'near'
  const parts: THREE.BufferGeometry[] = []

  if (detail === 'near') {
    const skeleton = branchStructure({
      variation,
      height: height * 0.72,
      baseRadius: radius,
      tipRadius: radius * 0.3,
      branchCount: 3,
      depth: 2,
      spread: 0.72,
      lengthFalloff: 0.6,
      radialSegments: 4,
      segmentsPerBranch: 2,
      lean: 0.07,
      name: 'broadleaf-skeleton',
    })
    // Root flare, so the trunk meets the ground instead of ending at it.
    const flare = loftProfile({
      profile: polygonProfile(radius * 1.75, 7),
      sections: [
        { y: 0, scaleX: 1 },
        { y: radius * 1.4, scaleX: 0.62 },
        { y: radius * 3, scaleX: 0.52 },
      ],
      name: 'broadleaf-flare',
    })
    parts.push(
      shade(skeleton, options.palette.barkShade, options.palette.bark, 0.7),
      shade(flare, tone(options.palette.barkShade, -0.2), options.palette.bark, 0.9),
    )
  } else {
    parts.push(
      trunkGeometry(
        height * 0.7,
        radius,
        options.palette,
        options.noiseSeed,
        6,
        0,
        'far',
      ),
    )
  }

  // Three to five lobes at different heights and offsets. An asymmetric crown is
  // what separates a tree from a lollipop.
  const lobeCount = detail === 'far' ? 2 : variation.integer(3, 6)
  for (let index = 0; index < lobeCount; index += 1) {
    const angle = variation.angle()
    const spread = canopyRadius * variation.range(0.18, 0.52)
    const lobeRadius = canopyRadius * variation.range(0.52, 0.86)
    const lobeHeight = lobeRadius * variation.range(1.05, 1.5)
    const lobe = loftProfile({
      profile: polygonProfile(lobeRadius, detail === 'far' ? 6 : 7, variation.angle()),
      sections: [
        { y: 0, scaleX: 0.3 },
        { y: lobeHeight * 0.24, scaleX: 0.94 },
        { y: lobeHeight * 0.58, scaleX: 1 },
        { y: lobeHeight * 0.86, scaleX: 0.74 },
        { y: lobeHeight, scaleX: 0.22 },
      ],
      name: `broadleaf-lobe-${String(index)}`,
    })
    transformed(lobe, {
      position: {
        x: Math.cos(angle) * spread,
        y: height * variation.range(0.5, 0.78),
        z: Math.sin(angle) * spread,
      },
    })
    shade(lobe, options.palette.canopyLow, options.palette.canopyHigh, 0.9)
    parts.push(lobe)
  }
  return mergeAll(parts, { name: 'prop-broadleaf' })
}

function slenderTreeGeometry(options: TreeOptions): THREE.BufferGeometry {
  const variation = options.variation
  const height = options.height ?? 6.2
  const radius = options.trunkRadius ?? 0.17
  const detail = options.detail ?? 'near'
  const lean = variation.signed(0.35)
  const trunk = loftProfile({
    profile: polygonProfile(radius, detail === 'far' ? 4 : 6),
    sections: [
      { y: 0, scaleX: 1.3 },
      { y: height * 0.1, scaleX: 1 },
      { y: height * 0.55, scaleX: 0.78, offsetX: lean * 0.4 },
      { y: height * 0.86, scaleX: 0.5, offsetX: lean },
      { y: height, scaleX: 0.3, offsetX: lean * 1.2 },
    ],
    name: 'slender-trunk',
  })
  // Pale bark with dark ticks. The ticks are noise in the vertex colour, not a
  // texture, and they are the only reason this species reads as a different tree
  // rather than a thin version of the last one.
  shade(trunk, tone(options.palette.bark, 0.28), tone(options.palette.bark, 0.46), 1)
  paintVertexColors(trunk, (context, out) => {
    const tick = fbm3(context.x * 9, context.y * 2.4, context.z * 9, options.noiseSeed, 2)
    if (tick > 0.34) out.multiplyScalar(0.42)
  })

  const parts = [trunk]
  const crownCount = detail === 'far' ? 1 : 3
  const canopyRadius = options.canopyRadius ?? 1.1
  for (let index = 0; index < crownCount; index += 1) {
    const angle = variation.angle()
    const crown = loftProfile({
      profile: polygonProfile(canopyRadius * variation.range(0.7, 1), 6, variation.angle()),
      sections: [
        { y: 0, scaleX: 0.34 },
        { y: 0.34, scaleX: 1 },
        { y: 0.86, scaleX: 0.82 },
        { y: 1.3, scaleX: 0.16 },
      ],
      name: `slender-crown-${String(index)}`,
    })
    transformed(crown, {
      position: {
        x: lean * 1.2 + Math.cos(angle) * canopyRadius * 0.36,
        y: height * variation.range(0.72, 0.94),
        z: Math.sin(angle) * canopyRadius * 0.36,
      },
    })
    shade(crown, options.palette.canopyLow, options.palette.canopyHigh, 0.8)
    parts.push(crown)
  }
  return mergeAll(parts, { name: 'prop-slender-tree' })
}

function deadTreeGeometry(options: TreeOptions): THREE.BufferGeometry {
  const variation = options.variation
  const height = options.height ?? 4.2
  const radius = options.trunkRadius ?? 0.28
  const detail = options.detail ?? 'near'
  const skeleton = branchStructure({
    variation,
    height,
    baseRadius: radius,
    tipRadius: radius * 0.16,
    branchCount: detail === 'far' ? 2 : 3,
    depth: detail === 'far' ? 1 : 2,
    spread: 0.95,
    lengthFalloff: 0.54,
    radialSegments: 4,
    segmentsPerBranch: 2,
    lean: 0.13,
    name: 'dead-tree',
  })
  shade(
    skeleton,
    tone(options.palette.barkShade, -0.2),
    tone(options.palette.bark, 0.12),
    0.7,
  )
  const stump = loftProfile({
    profile: polygonProfile(radius * 1.9, 7),
    sections: [
      { y: 0, scaleX: 1 },
      { y: radius, scaleX: 0.66 },
      { y: radius * 2.4, scaleX: 0.55 },
    ],
    name: 'dead-tree-base',
  })
  shade(stump, tone(options.palette.barkShade, -0.3), options.palette.barkShade, 0.9)
  return mergeAll([skeleton, stump], { name: 'prop-dead-tree' })
}

function topiaryGeometry(options: TreeOptions): THREE.BufferGeometry {
  const variation = options.variation
  const height = options.height ?? 2.9
  const radius = options.trunkRadius ?? 0.16
  const canopyRadius = options.canopyRadius ?? 0.92
  const trunk = piece(radius * 2, height * 0.36, radius * 2, options.palette.bark, {}, {
    topScale: 0.86,
  })
  shade(trunk, options.palette.barkShade, options.palette.bark, 1)
  // A clipped cone on a bare stem. Formal planting is a *statement about the people
  // who live here*, which is the whole reason the palace biome gets its own species.
  const cone = loftProfile({
    profile: polygonProfile(canopyRadius, 8, variation.angle()),
    sections: [
      { y: 0, scaleX: 0.52 },
      { y: height * 0.14, scaleX: 1 },
      { y: height * 0.42, scaleX: 0.82 },
      { y: height * 0.62, scaleX: 0.44 },
      { y: height * 0.7, scaleX: 0.1 },
    ],
    name: 'topiary-cone',
  })
  transformed(cone, { position: { x: 0, y: height * 0.34, z: 0 } })
  shade(cone, options.palette.canopyLow, options.palette.canopyHigh, 0.9)
  return mergeAll([trunk, cone], { name: 'prop-topiary' })
}

function thornTreeGeometry(options: TreeOptions): THREE.BufferGeometry {
  const variation = options.variation
  const height = options.height ?? 2.4
  const radius = options.trunkRadius ?? 0.22
  const skeleton = branchStructure({
    variation,
    height: height * 0.6,
    baseRadius: radius,
    tipRadius: radius * 0.14,
    branchCount: 3,
    depth: 2,
    spread: 1.24,
    lengthFalloff: 0.68,
    radialSegments: 4,
    segmentsPerBranch: 2,
    lean: 0.2,
    name: 'thorn-skeleton',
  })
  shade(skeleton, tone(options.palette.barkShade, -0.25), options.palette.bark, 0.6)
  const parts = [skeleton]
  // Sparse, dark clumps rather than a canopy: the fort lands are meant to look like
  // nothing has managed to grow there for a while.
  for (let index = 0; index < 4; index += 1) {
    const angle = variation.angle()
    const reach = height * variation.range(0.3, 0.62)
    const clump = loftProfile({
      profile: polygonProfile(variation.range(0.2, 0.36), 5, variation.angle()),
      sections: [
        { y: 0, scaleX: 0.4 },
        { y: 0.16, scaleX: 1 },
        { y: 0.34, scaleX: 0.3 },
      ],
      name: `thorn-clump-${String(index)}`,
    })
    transformed(clump, {
      position: {
        x: Math.cos(angle) * reach,
        y: height * variation.range(0.42, 0.78),
        z: Math.sin(angle) * reach,
      },
    })
    shade(clump, options.palette.canopyLow, options.palette.canopyHigh, 0.7)
    parts.push(clump)
  }
  return mergeAll(parts, { name: 'prop-thorn' })
}

export interface UndergrowthOptions {
  variation: ArtVariation
  noiseSeed: number
  low: THREE.ColorRepresentation
  high: THREE.ColorRepresentation
  radius?: number
  height?: number
  name?: string
}

/** A clustered shrub. Three overlapping lobes read as leaves, one reads as a rock. */
export function bushGeometry(options: UndergrowthOptions): THREE.BufferGeometry {
  const variation = options.variation
  const radius = options.radius ?? 0.62
  const height = options.height ?? 0.7
  const parts: THREE.BufferGeometry[] = []
  const lobeCount = variation.integer(3, 5)
  for (let index = 0; index < lobeCount; index += 1) {
    const angle = (index / lobeCount) * Math.PI * 2 + variation.signed(0.5)
    const spread = radius * variation.range(0.18, 0.46)
    const lobeRadius = radius * variation.range(0.5, 0.82)
    const lobe = loftProfile({
      profile: polygonProfile(lobeRadius, 6, variation.angle()),
      sections: [
        { y: 0, scaleX: 0.55 },
        { y: height * 0.42, scaleX: 1 },
        { y: height * 0.82, scaleX: 0.72 },
        { y: height, scaleX: 0.2 },
      ],
      name: `bush-lobe-${String(index)}`,
    })
    transformed(lobe, {
      position: {
        x: Math.cos(angle) * spread,
        y: variation.range(0, height * 0.22),
        z: Math.sin(angle) * spread,
      },
    })
    shade(lobe, options.low, options.high, 0.85)
    parts.push(lobe)
  }
  const geometry = mergeAll(parts, { name: options.name ?? 'prop-bush' })
  mottle(geometry, options.noiseSeed, 0.1, 2.6)
  bakeSkyOcclusion(geometry, { strength: 0.24 })
  return bakeOutlineNormals(geometry)
}

/** A cut stump with a pale ring, root buttresses and a shattered rim. */
export function stumpGeometry(options: UndergrowthOptions): THREE.BufferGeometry {
  const variation = options.variation
  const radius = options.radius ?? 0.42
  const height = options.height ?? 0.5
  const body = loftProfile({
    profile: polygonProfile(radius, 8),
    sections: [
      { y: 0, scaleX: 1.32 },
      { y: height * 0.28, scaleX: 1.02 },
      { y: height, scaleX: 0.94 },
    ],
    name: 'stump-body',
  })
  displaceGeometry(body, {
    seed: options.noiseSeed,
    amplitude: radius * 0.14,
    frequency: 3.2,
    octaves: 2,
    flatBase: height * 0.2,
  })
  shade(body, tone(options.low, -0.24), options.low, 0.8)
  const cut = loftProfile({
    profile: polygonProfile(radius * 0.94, 8),
    sections: [
      { y: 0, scaleX: 1 },
      { y: 0.06, scaleX: 0.96 },
    ],
    name: 'stump-cut',
  })
  transformed(cut, { position: { x: 0, y: height, z: 0 } })
  shade(cut, options.high, tone(options.high, 0.18), 1)
  const parts = [body, cut]
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2 + variation.signed(0.6)
    const root = piece(
      radius * 0.34,
      height * 0.42,
      radius * 1.5,
      options.low,
      {
        position: {
          x: Math.cos(angle) * radius * 0.9,
          y: 0,
          z: Math.sin(angle) * radius * 0.9,
        },
        rotation: { x: 0, y: -angle, z: 0 },
      },
      { topScale: 0.4 },
    )
    shade(root, tone(options.low, -0.3), options.low, 1)
    parts.push(root)
  }
  const geometry = mergeAll(parts, { name: options.name ?? 'prop-stump' })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: height * 0.6 })
  return bakeOutlineNormals(geometry)
}

/** A fallen log with a splintered end and two broken branch stubs. */
export function deadfallGeometry(options: UndergrowthOptions): THREE.BufferGeometry {
  const variation = options.variation
  const radius = options.radius ?? 0.3
  const length = options.height ?? 3.2
  const log = loftProfile({
    profile: polygonProfile(radius, 7),
    sections: [
      { y: 0, scaleX: 1.1 },
      { y: length * 0.36, scaleX: 0.92, offsetX: variation.signed(0.06) },
      { y: length * 0.74, scaleX: 0.8, offsetX: variation.signed(0.08) },
      { y: length, scaleX: 0.58 },
    ],
    name: 'deadfall-log',
  })
  displaceGeometry(log, {
    seed: options.noiseSeed,
    amplitude: radius * 0.16,
    frequency: 2.2,
    octaves: 2,
  })
  shade(log, tone(options.low, -0.2), options.high, 0.7)
  // Lay it down before the stubs go on, so the stubs can point sideways in world
  // space instead of straight up out of a rolled log.
  transformed(log, { rotation: { x: Math.PI / 2, y: 0, z: 0 } })
  const parts = [log]
  for (let index = 0; index < 2; index += 1) {
    const stub = tubeAlongPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: variation.signed(0.2), y: radius * 1.2, z: variation.range(0.2, 0.5) },
      ],
      { radius: radius * 0.3, radialSegments: 4, tubularSegments: 2, capEnd: true },
    )
    transformed(stub, {
      position: {
        x: variation.signed(radius * 0.5),
        y: radius * 0.5,
        z: length * variation.range(0.2, 0.8),
      },
      rotation: { x: 0, y: variation.angle(), z: 0 },
    })
    shade(stub, tone(options.low, -0.3), options.low, 1)
    parts.push(stub)
  }
  const geometry = mergeAll(parts, { name: options.name ?? 'prop-deadfall' })
  bakeSkyOcclusion(geometry, { strength: 0.28 })
  return bakeOutlineNormals(geometry)
}

/** Reeds. Flat, double-sided blades that fan out from one root. */
export function reedClusterGeometry(
  options: UndergrowthOptions,
): THREE.BufferGeometry {
  const variation = options.variation
  const height = options.height ?? 1.2
  const blades: THREE.BufferGeometry[] = []
  const count = variation.integer(5, 8)
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + variation.signed(0.4)
    const bladeHeight = height * variation.range(0.6, 1.15)
    const lean = variation.range(0.12, 0.36)
    const blade = loftProfile({
      profile: rectProfile(0.045, 0.012),
      sections: [
        { y: 0, scaleX: 1 },
        { y: bladeHeight * 0.5, scaleX: 0.8, offsetX: lean * 0.35 },
        { y: bladeHeight * 0.86, scaleX: 0.45, offsetX: lean * 0.8 },
        { y: bladeHeight, scaleX: 0.06, offsetX: lean },
      ],
      name: `reed-${String(index)}`,
    })
    transformed(blade, {
      rotation: { x: 0, y: angle, z: 0 },
      position: {
        x: Math.cos(angle) * variation.range(0, 0.1),
        y: 0,
        z: Math.sin(angle) * variation.range(0, 0.1),
      },
    })
    shade(blade, options.low, options.high, 0.6)
    blades.push(blade)
  }
  const geometry = mergeAll(blades, { name: options.name ?? 'prop-reeds' })
  return geometry
}

// ---------------------------------------------------------------------------
// Rock and terrain features
// ---------------------------------------------------------------------------

export interface RockPalette {
  low: THREE.ColorRepresentation
  high: THREE.ColorRepresentation
  /** Moss, lichen, ash or snow on the upward faces. Omit for bare stone. */
  cap?: THREE.ColorRepresentation
  capStrength?: number
}

export interface RockOptions {
  variation: ArtVariation
  noiseSeed: number
  palette: RockPalette
  radius?: number
  height?: number
  detail?: 'near' | 'far'
  name?: string
}

/**
 * Bedded rock: three or four offset slabs with visible strata.
 *
 * A displaced icosahedron is a potato. Real rock has bedding planes, and stacking
 * offset slabs gives the ink outline a set of horizontal ledges to catch, which is
 * what makes a boulder read as stone from forty metres away.
 */
export function strataRockGeometry(options: RockOptions): THREE.BufferGeometry {
  const variation = options.variation
  const radius = options.radius ?? 1.2
  const height = options.height ?? 1.4
  const detail = options.detail ?? 'near'
  const bedCount = detail === 'far' ? 2 : variation.integer(3, 5)
  const parts: THREE.BufferGeometry[] = []
  let cursor = 0
  for (let index = 0; index < bedCount; index += 1) {
    const amount = index / bedCount
    const bedHeight = (height / bedCount) * variation.range(0.72, 1.3)
    const bedRadius = radius * (1 - amount * 0.42) * variation.around(1, 0.12)
    const bed = loftProfile({
      profile: polygonProfile(bedRadius, detail === 'far' ? 5 : 7, variation.angle()),
      sections: [
        { y: 0, scaleX: 1 },
        { y: bedHeight * 0.7, scaleX: variation.range(0.9, 1.08) },
        { y: bedHeight, scaleX: variation.range(0.74, 0.96) },
      ],
      name: `rock-bed-${String(index)}`,
    })
    transformed(bed, {
      position: {
        x: variation.signed(radius * 0.16),
        y: cursor,
        z: variation.signed(radius * 0.16),
      },
      rotation: { x: 0, y: variation.angle(), z: variation.signed(0.05) },
    })
    // Each bed gets its own value so the seam between two beds is a colour step, not
    // just a normal break.
    const bedTone = variation.range(-0.14, 0.14)
    shade(bed, tone(options.palette.low, bedTone), tone(options.palette.high, bedTone), 0.9)
    parts.push(bed)
    cursor += bedHeight * 0.82
  }
  const geometry = mergeAll(parts, { name: options.name ?? 'prop-strata-rock' })
  if (detail === 'near') {
    displaceGeometry(geometry, {
      seed: options.noiseSeed,
      amplitude: radius * 0.11,
      frequency: 2.1,
      octaves: 2,
      mode: 'ridge',
      flatBase: height * 0.14,
    })
  }
  applyRockCap(geometry, options.palette)
  bakeSkyOcclusion(geometry, { strength: 0.3 })
  bakeVerticalOcclusion(geometry, { strength: 0.32, falloff: height * 0.5 })
  return bakeOutlineNormals(geometry)
}

/** A tilted wedge of exposed bedrock. Reads as a cliff at any scale. */
export function outcropGeometry(options: RockOptions): THREE.BufferGeometry {
  const variation = options.variation
  const radius = options.radius ?? 2.2
  const height = options.height ?? 2.6
  const tilt = variation.range(0.18, 0.38)
  const wedge = loftProfile({
    profile: polygonProfile(radius, 6, variation.angle()),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 0.72 },
      { y: height * 0.4, scaleX: 0.86, scaleZ: 0.6, offsetX: tilt * height * 0.4 },
      { y: height * 0.78, scaleX: 0.6, scaleZ: 0.42, offsetX: tilt * height * 0.78 },
      { y: height, scaleX: 0.3, scaleZ: 0.22, offsetX: tilt * height },
    ],
    name: 'outcrop',
  })
  displaceGeometry(wedge, {
    seed: options.noiseSeed,
    amplitude: radius * 0.12,
    frequency: 1.5,
    octaves: 3,
    mode: 'ridge',
    flatBase: height * 0.1,
  })
  shade(wedge, options.palette.low, options.palette.high, 0.85)
  applyRockCap(wedge, options.palette)
  wedge.name = options.name ?? 'prop-outcrop'
  bakeSkyOcclusion(wedge, { strength: 0.32 })
  bakeVerticalOcclusion(wedge, { strength: 0.34, falloff: height * 0.4 })
  return bakeOutlineNormals(wedge)
}

/** A fan of broken chips at the foot of a slope. */
export function screeGeometry(options: RockOptions): THREE.BufferGeometry {
  const variation = options.variation
  const radius = options.radius ?? 1.1
  const chips: THREE.BufferGeometry[] = []
  const count = variation.integer(6, 11)
  for (let index = 0; index < count; index += 1) {
    const angle = variation.angle()
    const distance = radius * Math.sqrt(variation.unit())
    const size = radius * variation.range(0.1, 0.26)
    const chip = loftProfile({
      profile: polygonProfile(size, 5, variation.angle()),
      sections: [
        { y: 0, scaleX: 1 },
        { y: size * variation.range(0.5, 1.1), scaleX: variation.range(0.3, 0.7) },
      ],
      name: `scree-chip-${String(index)}`,
    })
    transformed(chip, {
      position: {
        x: Math.cos(angle) * distance,
        y: 0,
        z: Math.sin(angle) * distance,
      },
      rotation: { x: variation.signed(0.3), y: variation.angle(), z: variation.signed(0.3) },
    })
    const chipTone = variation.range(-0.18, 0.18)
    shade(chip, tone(options.palette.low, chipTone), tone(options.palette.high, chipTone), 0.9)
    chips.push(chip)
  }
  const geometry = mergeAll(chips, { name: options.name ?? 'prop-scree' })
  bakeSkyOcclusion(geometry, { strength: 0.26 })
  return geometry
}

/** A stacked waymarker. Small, human-made, and instantly reads as "someone came through". */
export function cairnGeometry(options: RockOptions): THREE.BufferGeometry {
  const variation = options.variation
  const radius = options.radius ?? 0.42
  const height = options.height ?? 1.1
  const stones: THREE.BufferGeometry[] = []
  const count = variation.integer(4, 7)
  let cursor = 0
  for (let index = 0; index < count; index += 1) {
    const amount = index / count
    const stoneRadius = radius * (1 - amount * 0.55) * variation.around(1, 0.14)
    const stoneHeight = (height / count) * variation.range(0.7, 1.2)
    const stone = loftProfile({
      profile: polygonProfile(stoneRadius, 6, variation.angle()),
      sections: [
        { y: 0, scaleX: 1 },
        { y: stoneHeight, scaleX: variation.range(0.72, 0.96) },
      ],
      name: `cairn-stone-${String(index)}`,
    })
    transformed(stone, {
      position: { x: variation.signed(radius * 0.12), y: cursor, z: variation.signed(radius * 0.12) },
      rotation: { x: 0, y: variation.angle(), z: variation.signed(0.07) },
    })
    const stoneTone = variation.range(-0.16, 0.16)
    shade(stone, tone(options.palette.low, stoneTone), tone(options.palette.high, stoneTone), 0.9)
    stones.push(stone)
    cursor += stoneHeight * 0.92
  }
  const geometry = mergeAll(stones, { name: options.name ?? 'prop-cairn' })
  applyRockCap(geometry, options.palette)
  bakeSkyOcclusion(geometry, { strength: 0.3 })
  return bakeOutlineNormals(geometry)
}

/**
 * Tints upward-facing vertices towards moss, lichen, ash or snow.
 *
 * Weathering is directional in the real world and biome-specific in this one: the
 * forest grows moss on its rocks, the fort lands get ash, the palace gets pale
 * lichen. One dot product in the vertex colour buys all three.
 */
function applyRockCap(
  geometry: THREE.BufferGeometry,
  palette: RockPalette,
): THREE.BufferGeometry {
  if (palette.cap === undefined) return geometry
  const cap = colorOf(palette.cap)
  const strength = Math.min(1, Math.max(0, palette.capStrength ?? 0.55))
  return paintVertexColors(geometry, (context, out) => {
    const upward = Math.max(0, context.normalY)
    const amount = strength * upward * upward * Math.min(1, context.heightRatio * 1.6)
    out.setRGB(
      out.r + (cap.r - out.r) * amount,
      out.g + (cap.g - out.g) * amount,
      out.b + (cap.b - out.b) * amount,
    )
  })
}

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

export type WallStyle = 'timber-frame' | 'log' | 'stone' | 'plank'
export type RoofStyle = 'thatch' | 'shingle' | 'tile' | 'flat' | 'conical'

export interface BuildingPalette {
  foundation: THREE.ColorRepresentation
  wall: THREE.ColorRepresentation
  wallShade: THREE.ColorRepresentation
  /** Posts, beams, quoins, barge boards — whatever frames the wall. */
  timber: THREE.ColorRepresentation
  roof: THREE.ColorRepresentation
  roofShade: THREE.ColorRepresentation
  roofRidge: THREE.ColorRepresentation
  trim: THREE.ColorRepresentation
  door: THREE.ColorRepresentation
  /** Unlit glazing. Dark, so a window reads as an opening even at noon. */
  glass: THREE.ColorRepresentation
  /** Lit glazing, drawn on the `glow` surface. */
  glow: THREE.ColorRepresentation
}

export interface BuildingOptions {
  variation: ArtVariation
  noiseSeed: number
  palette: BuildingPalette
  width: number
  depth: number
  /** Height of a single storey. */
  wallHeight: number
  storeys?: number
  wallStyle: WallStyle
  roofStyle: RoofStyle
  /** Ridge height as a fraction of the half-span. `0.9` is a steep northern roof. */
  roofPitch?: number
  /** How far the roof oversails the walls. Eaves are most of what says "roof". */
  eaves?: number
  chimney?: boolean
  porch?: boolean
  balcony?: boolean
  /** Windows per long face, per storey. */
  windows?: number
  door?: boolean
  /** Draws the glazing on the `glow` surface. */
  lit?: boolean
  /** Crenellated parapet instead of a cornice on a flat roof. */
  crenellated?: boolean
  detail?: 'near' | 'far'
  name?: string
}

/**
 * A building, assembled from parts.
 *
 * The old world drew a house as a tapered box with a pyramid on top, which is why
 * every settlement read as a stack of crates. A building is *openings*: a door you
 * could walk through, windows with frames and sills and shutters, a chimney that
 * says someone is inside, eaves that throw a shadow line across the wall. None of
 * that needs a texture and all of it needs to be built.
 *
 * Openings are applied geometry, not boolean cuts. A recessed frame with a dark
 * panel behind it reads as a hole from every angle a third-person camera can reach,
 * costs a dozen triangles, and does not require a CSG library in a game that ships
 * as a single HTML file.
 */
export function buildingParts(options: BuildingOptions): PropPart[] {
  const detail = options.detail ?? 'near'
  const palette = options.palette
  const variation = options.variation
  const storeys = Math.max(1, Math.min(3, Math.floor(options.storeys ?? 1)))
  const width = options.width
  const depth = options.depth
  const storeyHeight = options.wallHeight
  const eaves = options.eaves ?? Math.min(width, depth) * 0.12 + 0.18
  const parts: PropPart[] = []
  const hard: THREE.BufferGeometry[] = []

  const plinthHeight = Math.max(0.16, storeyHeight * 0.11)
  const plinth = piece(
    width + plinthHeight * 1.6,
    plinthHeight,
    depth + plinthHeight * 1.6,
    palette.foundation,
    {},
    { topScale: 0.97, bevel: plinthHeight * 0.3 },
  )
  shade(plinth, tone(palette.foundation, -0.28), palette.foundation, 0.9)
  hard.push(plinth)

  let cursor = plinthHeight
  let topWidth = width
  let topDepth = depth
  for (let storey = 0; storey < storeys; storey += 1) {
    // Upper storeys jetty out over the one below. It is a real building technique, it
    // throws a shadow line, and it stops a two-storey house being one tall box.
    const jetty = storey === 0 ? 0 : Math.min(width, depth) * 0.06
    const storeyWidth = width + jetty * 2
    const storeyDepth = depth + jetty * 2
    const body = piece(
      storeyWidth,
      storeyHeight,
      storeyDepth,
      palette.wall,
      { position: { x: 0, y: cursor, z: 0 } },
      { topScale: storey === storeys - 1 ? 0.985 : 1, bevel: 0.07 },
    )
    shade(body, palette.wallShade, palette.wall, 0.8)
    mottle(body, options.noiseSeed + storey * 31, 0.07, 0.9)
    hard.push(body)

    if (detail === 'near') {
      hard.push(
        ...wallDressing(
          options.wallStyle,
          storeyWidth,
          storeyDepth,
          storeyHeight,
          cursor,
          palette,
          variation,
        ),
      )
      const windowCount = Math.max(0, Math.floor(options.windows ?? 2))
      if (windowCount > 0) {
        parts.push(
          ...windowRow(
            windowCount,
            storeyWidth,
            storeyDepth,
            storeyHeight,
            cursor,
            palette,
            options.lit === true,
            storey,
            variation,
          ),
        )
      }
      if (storey === 0 && options.door !== false) {
        hard.push(
          ...doorParts(storeyDepth, storeyHeight, cursor, palette, variation),
        )
      }
      if (storey === storeys - 1 && options.balcony === true && storeys > 1) {
        hard.push(...balconyParts(storeyWidth, storeyDepth, cursor, palette))
      }
    }

    cursor += storeyHeight
    topWidth = storeyWidth
    topDepth = storeyDepth
  }

  const roofHeight =
    options.roofStyle === 'flat'
      ? Math.max(0.24, storeyHeight * 0.18)
      : Math.max(0.5, (Math.min(topWidth, topDepth) / 2) * (options.roofPitch ?? 0.86))
  hard.push(
    ...roofParts(
      options.roofStyle,
      topWidth + eaves * 2,
      topDepth + eaves * 2,
      roofHeight,
      cursor,
      palette,
      options.noiseSeed,
      detail,
      options.crenellated === true,
    ),
  )

  if (detail === 'near' && options.roofStyle !== 'flat') {
    hard.push(...rafterTails(topWidth, topDepth, eaves, cursor, palette))
  }
  if (detail === 'near' && options.chimney === true) {
    hard.push(
      ...chimneyParts(topWidth, topDepth, cursor, roofHeight, palette, variation),
    )
  }
  if (detail === 'near' && options.porch === true) {
    hard.push(...porchParts(topWidth, topDepth, storeyHeight, plinthHeight, palette))
  }

  const merged = mergeAll(hard, { name: options.name ?? 'prop-building' })
  bakeSkyOcclusion(merged, { strength: 0.24 })
  bakeVerticalOcclusion(merged, { strength: 0.26, falloff: storeyHeight * 0.5 })
  // A building is the one prop that gets handed straight to an LOD level without
  // passing through `mergePropParts`, so it welds its own outline normals: without
  // them the ink hull splits open along every wall corner and eave.
  bakeOutlineNormals(merged)
  parts.unshift(propPart(merged, 'hard'))
  return parts
}

/**
 * Whatever holds the wall up, expressed on its face.
 *
 * Wall style is the loudest single signal of *who built this*. Elf settlements get
 * exposed timber framing, the guard gets dressed stone with quoins, the fort gets
 * heavy horizontal logs, and rural neutrals get vertical planking.
 */
function wallDressing(
  style: WallStyle,
  width: number,
  depth: number,
  height: number,
  baseY: number,
  palette: BuildingPalette,
  variation: ArtVariation,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const thickness = 0.1
  const halfWidth = width / 2
  const halfDepth = depth / 2

  if (style === 'timber-frame' || style === 'stone') {
    // Corner posts on a timber frame; quoins on stone. Same four positions, and both
    // give the ink outline a vertical to run down at every corner.
    for (const signX of [-1, 1]) {
      for (const signZ of [-1, 1]) {
        const post = piece(
          thickness * 2.2,
          height,
          thickness * 2.2,
          palette.timber,
          {
            position: {
              x: signX * (halfWidth - thickness * 0.4),
              y: baseY,
              z: signZ * (halfDepth - thickness * 0.4),
            },
          },
        )
        shade(post, tone(palette.timber, -0.22), palette.timber, 0.8)
        parts.push(post)
      }
    }
  }

  if (style === 'timber-frame') {
    const railY = baseY + height * 0.58
    for (const signZ of [-1, 1]) {
      const rail = piece(
        width * 0.99,
        thickness * 1.4,
        thickness,
        palette.timber,
        { position: { x: 0, y: railY, z: signZ * (halfDepth + thickness * 0.3) } },
      )
      shade(rail, tone(palette.timber, -0.2), palette.timber, 1)
      parts.push(rail)
      for (const signX of [-1, 1]) {
        const brace = piece(
          thickness,
          height * 0.52,
          thickness,
          palette.timber,
          {
            position: {
              x: signX * width * 0.3,
              y: baseY + height * 0.06,
              z: signZ * (halfDepth + thickness * 0.3),
            },
            rotation: { x: 0, y: 0, z: signX * 0.42 },
          },
        )
        shade(brace, tone(palette.timber, -0.2), palette.timber, 1)
        parts.push(brace)
      }
    }
  }

  if (style === 'log') {
    // Horizontal courses. Only the proud edge of each log is modelled: the wall body
    // behind it is already solid, so a full stack of cylinders would be triangles
    // spent on geometry nobody can see.
    const courses = Math.max(3, Math.round(height / 0.44))
    for (let index = 0; index < courses; index += 1) {
      const y = baseY + (index + 0.5) * (height / courses)
      const courseHeight = (height / courses) * 0.72
      for (const signZ of [-1, 1]) {
        const course = piece(
          width * (0.97 + (index % 2) * 0.02),
          courseHeight,
          thickness * 0.7,
          palette.timber,
          { position: { x: 0, y: y - courseHeight / 2, z: signZ * (halfDepth + thickness * 0.2) } },
          { topScale: 0.7 },
        )
        shade(course, tone(palette.timber, -0.24), palette.timber, 0.7)
        parts.push(course)
      }
    }
  }

  if (style === 'stone') {
    const bandY = baseY + height * 0.72
    const band = piece(
      width + thickness,
      thickness * 1.6,
      depth + thickness,
      palette.trim,
      { position: { x: 0, y: bandY, z: 0 } },
      { topScale: 0.94 },
    )
    shade(band, tone(palette.trim, -0.2), palette.trim, 1)
    parts.push(band)
  }

  if (style === 'plank') {
    const plankCount = Math.max(4, Math.round(width / 0.7))
    for (let index = 0; index < plankCount; index += 1) {
      const x = -halfWidth + ((index + 0.5) / plankCount) * width
      for (const signZ of [-1, 1]) {
        const plank = piece(
          thickness * 0.7,
          height * variation.range(0.9, 1),
          thickness * 0.5,
          palette.timber,
          { position: { x, y: baseY, z: signZ * (halfDepth + thickness * 0.15) } },
        )
        shade(plank, tone(palette.timber, -0.26), palette.timber, 0.85)
        parts.push(plank)
      }
    }
  }
  return parts
}

/** A door: two jambs, a lintel, a battened leaf and a threshold step. */
function doorParts(
  depth: number,
  height: number,
  baseY: number,
  palette: BuildingPalette,
  variation: ArtVariation,
): THREE.BufferGeometry[] {
  const doorWidth = Math.min(1.1, height * 0.52)
  const doorHeight = height * 0.66
  const z = depth / 2
  const parts: THREE.BufferGeometry[] = []
  const leaf = piece(
    doorWidth,
    doorHeight,
    0.1,
    palette.door,
    { position: { x: 0, y: baseY, z: z + 0.02 } },
  )
  shade(leaf, tone(palette.door, -0.34), palette.door, 0.75)
  parts.push(leaf)
  for (let index = 0; index < 2; index += 1) {
    const batten = piece(
      doorWidth * 0.86,
      0.09,
      0.05,
      palette.timber,
      {
        position: {
          x: 0,
          y: baseY + doorHeight * (0.22 + index * 0.44),
          z: z + 0.09,
        },
      },
    )
    shade(batten, tone(palette.timber, -0.2), palette.timber, 1)
    parts.push(batten)
  }
  for (const signX of [-1, 1]) {
    const jamb = piece(
      0.12,
      doorHeight + 0.12,
      0.16,
      palette.trim,
      { position: { x: signX * (doorWidth / 2 + 0.06), y: baseY, z: z + 0.02 } },
    )
    shade(jamb, tone(palette.trim, -0.2), palette.trim, 1)
    parts.push(jamb)
  }
  const lintel = piece(
    doorWidth + 0.34,
    0.14,
    0.2,
    palette.trim,
    { position: { x: 0, y: baseY + doorHeight + 0.06, z: z + 0.01 } },
  )
  shade(lintel, tone(palette.trim, -0.16), palette.trim, 1)
  parts.push(lintel)
  const step = piece(
    doorWidth + 0.5,
    0.12,
    0.5,
    palette.foundation,
    { position: { x: 0, y: baseY - 0.1, z: z + 0.22 } },
    { topScale: 0.9 },
  )
  shade(step, tone(palette.foundation, -0.3), palette.foundation, 1)
  parts.push(step)
  // A single crooked board nailed across the threshold. Small asymmetries are what
  // stop a procedural building looking machined.
  const scuff = piece(
    doorWidth * 0.7,
    0.05,
    0.06,
    palette.timber,
    {
      position: { x: variation.signed(0.1), y: baseY + 0.02, z: z + 0.14 },
      rotation: { x: 0, y: 0, z: variation.signed(0.08) },
    },
  )
  shade(scuff, tone(palette.timber, -0.3), palette.timber, 1)
  parts.push(scuff)
  return parts
}

/** A row of shuttered windows on both long faces. */
function windowRow(
  count: number,
  width: number,
  depth: number,
  height: number,
  baseY: number,
  palette: BuildingPalette,
  lit: boolean,
  storey: number,
  variation: ArtVariation,
): PropPart[] {
  const hard: THREE.BufferGeometry[] = []
  const glazing: THREE.BufferGeometry[] = []
  const windowWidth = Math.min(0.62, width / (count * 2.6))
  const windowHeight = Math.min(0.86, height * 0.34)
  const sillY = baseY + height * (storey === 0 ? 0.42 : 0.36)

  for (const signZ of [-1, 1]) {
    const z = signZ * (depth / 2)
    // The back face gets one fewer opening than the front. Buildings are not
    // symmetrical and a camera that circles one will notice if they are.
    const faceCount = signZ === 1 ? count : Math.max(1, count - 1)
    for (let index = 0; index < faceCount; index += 1) {
      const spread = width * 0.62
      const x =
        faceCount === 1
          ? 0
          : -spread / 2 + (index / (faceCount - 1)) * spread
      const pane = piece(
        windowWidth,
        windowHeight,
        0.06,
        lit ? palette.glow : palette.glass,
        { position: { x, y: sillY, z: z + signZ * 0.02 } },
      )
      if (lit) {
        shade(pane, tone(palette.glow, -0.12), palette.glow, 0.6)
        glazing.push(pane)
      } else {
        shade(pane, tone(palette.glass, -0.3), palette.glass, 0.6)
        hard.push(pane)
      }
      for (const signX of [-1, 1]) {
        const jamb = piece(
          0.08,
          windowHeight + 0.1,
          0.11,
          palette.trim,
          {
            position: {
              x: x + signX * (windowWidth / 2 + 0.04),
              y: sillY - 0.05,
              z: z + signZ * 0.03,
            },
          },
        )
        shade(jamb, tone(palette.trim, -0.2), palette.trim, 1)
        hard.push(jamb)
        // Shutters hang open at a shallow angle so they read from the front without
        // widening the silhouette enough to clip a neighbouring window.
        const shutter = piece(
          windowWidth * 0.52,
          windowHeight,
          0.05,
          palette.door,
          {
            position: {
              x: x + signX * (windowWidth * 0.62),
              y: sillY,
              z: z + signZ * 0.1,
            },
            rotation: { x: 0, y: signX * signZ * variation.range(0.4, 0.7), z: 0 },
          },
        )
        shade(shutter, tone(palette.door, -0.3), palette.door, 0.8)
        hard.push(shutter)
      }
      const head = piece(
        windowWidth + 0.26,
        0.09,
        0.14,
        palette.trim,
        { position: { x, y: sillY + windowHeight + 0.02, z: z + signZ * 0.02 } },
      )
      shade(head, tone(palette.trim, -0.16), palette.trim, 1)
      hard.push(head)
      const sill = piece(
        windowWidth + 0.3,
        0.07,
        0.18,
        palette.trim,
        { position: { x, y: sillY - 0.07, z: z + signZ * 0.04 } },
        { topScale: 0.86 },
      )
      shade(sill, tone(palette.trim, -0.24), palette.trim, 1)
      hard.push(sill)
    }
  }

  const parts: PropPart[] = []
  if (hard.length > 0) {
    parts.push(propPart(mergeAll(hard, { name: 'building-windows' }), 'hard'))
  }
  if (glazing.length > 0) {
    parts.push(propPart(mergeAll(glazing, { name: 'building-glazing' }), 'glow'))
  }
  return parts
}

/**
 * A roof with eaves, a ridge and a profile that says what it is made of.
 *
 * Thatch bulges and sags, shingle steps course by course, tile is crisp with a
 * capped ridge. All three come out of the same loft: the only thing that changes is
 * the section list, which means the whole material story costs zero extra draw calls
 * and zero extra geometry.
 */
function roofParts(
  style: RoofStyle,
  span: number,
  depth: number,
  height: number,
  baseY: number,
  palette: BuildingPalette,
  noiseSeed: number,
  detail: 'near' | 'far',
  crenellated: boolean,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []

  if (style === 'flat') {
    const slab = piece(
      span,
      height,
      depth,
      palette.roof,
      { position: { x: 0, y: baseY, z: 0 } },
      { topScale: 0.98, bevel: 0.06 },
    )
    shade(slab, palette.roofShade, palette.roof, 0.8)
    parts.push(slab)
    if (crenellated && detail === 'near') {
      parts.push(...crenellations(span, depth, baseY + height, palette))
    } else {
      const cornice = piece(
        span + 0.24,
        0.14,
        depth + 0.24,
        palette.roofRidge,
        { position: { x: 0, y: baseY + height, z: 0 } },
        { topScale: 0.92 },
      )
      shade(cornice, tone(palette.roofRidge, -0.2), palette.roofRidge, 1)
      parts.push(cornice)
    }
    return parts
  }

  if (style === 'conical') {
    const cone = loftProfile({
      profile: polygonProfile(span / 2, detail === 'far' ? 6 : 9),
      sections: [
        { y: 0, scaleX: 1.04 },
        { y: height * 0.1, scaleX: 1 },
        { y: height * 0.55, scaleX: 0.62 },
        { y: height, scaleX: 0.05 },
      ],
      name: 'roof-conical',
    })
    transformed(cone, { position: { x: 0, y: baseY, z: 0 } })
    shade(cone, palette.roofShade, palette.roof, 0.7)
    parts.push(cone)
    const finial = piece(
      0.14,
      height * 0.26,
      0.14,
      palette.roofRidge,
      { position: { x: 0, y: baseY + height * 0.94, z: 0 } },
      { topScale: 0.2 },
    )
    shade(finial, tone(palette.roofRidge, -0.2), palette.roofRidge, 1)
    parts.push(finial)
    return parts
  }

  const roof = loftProfile({
    profile: rectProfile(span, depth, Math.min(span, depth) * 0.04),
    sections: roofSections(style, height, detail),
    name: `roof-${style}`,
  })
  transformed(roof, { position: { x: 0, y: baseY, z: 0 } })
  shade(roof, palette.roofShade, palette.roof, 0.7)
  if (style === 'thatch' && detail === 'near') {
    // Thatch is a bundled organic surface; a perfectly ruled eave line reads as
    // plastic. A little ridged noise puts the straw back.
    displaceGeometry(roof, {
      seed: noiseSeed,
      amplitude: Math.min(span, depth) * 0.022,
      frequency: 3.4,
      octaves: 2,
      mode: 'ridge',
    })
  }
  parts.push(roof)

  const ridge = piece(
    span * 0.96,
    height * 0.12,
    style === 'tile' ? depth * 0.09 : depth * 0.07,
    palette.roofRidge,
    { position: { x: 0, y: baseY + height * 0.96, z: 0 } },
    { topScale: style === 'tile' ? 0.5 : 0.75, bevel: 0.03 },
  )
  shade(ridge, tone(palette.roofRidge, -0.22), palette.roofRidge, 1)
  parts.push(ridge)

  if (detail === 'near') {
    // Barge boards close the gable ends. Without them the roof solid ends in a
    // knife edge and the ink outline has nothing to hold onto.
    for (const signZ of [-1, 1]) {
      const barge = piece(
        span * 0.99,
        height * 0.14,
        0.08,
        palette.trim,
        {
          position: {
            x: 0,
            y: baseY + height * 0.06,
            z: signZ * (depth / 2 - 0.02),
          },
        },
        { topScale: 0.3, shearX: 0 },
      )
      shade(barge, tone(palette.trim, -0.2), palette.trim, 1)
      parts.push(barge)
    }
  }
  return parts
}

function roofSections(
  style: RoofStyle,
  height: number,
  detail: 'near' | 'far',
): { y: number; scaleX?: number; scaleZ?: number }[] {
  if (detail === 'far') {
    return [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: height, scaleX: 0.9, scaleZ: 0.04 },
    ]
  }
  if (style === 'thatch') {
    return [
      { y: -height * 0.06, scaleX: 0.99, scaleZ: 0.99 },
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: height * 0.18, scaleX: 0.99, scaleZ: 0.9 },
      { y: height * 0.52, scaleX: 0.97, scaleZ: 0.6 },
      { y: height * 0.82, scaleX: 0.94, scaleZ: 0.28 },
      { y: height, scaleX: 0.9, scaleZ: 0.07 },
    ]
  }
  if (style === 'tile') {
    return [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: height * 0.06, scaleX: 0.99, scaleZ: 0.95 },
      { y: height * 0.55, scaleX: 0.96, scaleZ: 0.5 },
      { y: height, scaleX: 0.92, scaleZ: 0.05 },
    ]
  }
  // Shingle. Stepped sections put a course line on the slope, and the ink outline
  // follows every step — a shingled roof reads as shingled from its silhouette.
  const sections: { y: number; scaleX?: number; scaleZ?: number }[] = [
    { y: 0, scaleX: 1, scaleZ: 1 },
  ]
  const courses = 4
  for (let index = 1; index <= courses; index += 1) {
    const amount = index / courses
    const inner = 1 - amount
    sections.push({
      y: height * (amount - 0.02),
      scaleX: 1 - amount * 0.06,
      scaleZ: Math.max(0.05, inner + 0.06),
    })
    sections.push({
      y: height * amount,
      scaleX: 1 - amount * 0.08,
      scaleZ: Math.max(0.045, inner),
    })
  }
  return sections
}

/** Exposed rafter ends under the eaves. Cheap, and instantly says "built". */
function rafterTails(
  width: number,
  depth: number,
  eaves: number,
  baseY: number,
  palette: BuildingPalette,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const count = Math.max(3, Math.round(width / 0.9))
  for (let index = 0; index < count; index += 1) {
    const x = -width / 2 + ((index + 0.5) / count) * width
    for (const signZ of [-1, 1]) {
      const tail = piece(
        0.09,
        0.12,
        eaves + 0.14,
        palette.timber,
        {
          position: {
            x,
            y: baseY - 0.12,
            z: signZ * (depth / 2 + eaves * 0.4),
          },
        },
      )
      shade(tail, tone(palette.timber, -0.3), palette.timber, 1)
      parts.push(tail)
    }
  }
  return parts
}

function chimneyParts(
  width: number,
  depth: number,
  wallTop: number,
  roofHeight: number,
  palette: BuildingPalette,
  variation: ArtVariation,
): THREE.BufferGeometry[] {
  const x = (width / 2) * variation.range(0.5, 0.72)
  const z = variation.signed(depth * 0.16)
  const stackHeight = roofHeight + 0.9
  const stack = piece(
    0.52,
    stackHeight,
    0.46,
    palette.foundation,
    { position: { x, y: wallTop - 0.4, z } },
    { topScale: 0.86, bevel: 0.04 },
  )
  shade(stack, tone(palette.foundation, -0.3), palette.foundation, 0.7)
  const cap = piece(
    0.68,
    0.14,
    0.6,
    palette.trim,
    { position: { x, y: wallTop - 0.4 + stackHeight, z } },
    { topScale: 0.86 },
  )
  shade(cap, tone(palette.trim, -0.18), palette.trim, 1)
  const pot = piece(
    0.2,
    0.22,
    0.2,
    palette.roofRidge,
    { position: { x, y: wallTop - 0.4 + stackHeight + 0.14, z } },
    { topScale: 0.78 },
  )
  shade(pot, tone(palette.roofRidge, -0.24), palette.roofRidge, 1)
  return [stack, cap, pot]
}

function porchParts(
  width: number,
  depth: number,
  storeyHeight: number,
  plinthHeight: number,
  palette: BuildingPalette,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const postHeight = storeyHeight * 0.78
  const reach = Math.min(1.5, depth * 0.28)
  const spacing = Math.min(1.5, width * 0.3)
  for (const signX of [-1, 1]) {
    const post = piece(
      0.14,
      postHeight,
      0.14,
      palette.timber,
      {
        position: {
          x: signX * spacing,
          y: plinthHeight - 0.06,
          z: depth / 2 + reach - 0.12,
        },
      },
      { topScale: 0.86 },
    )
    shade(post, tone(palette.timber, -0.28), palette.timber, 0.9)
    parts.push(post)
    const brace = piece(
      0.09,
      0.4,
      0.09,
      palette.timber,
      {
        position: {
          x: signX * spacing,
          y: plinthHeight + postHeight - 0.44,
          z: depth / 2 + reach - 0.12,
        },
        rotation: { x: 0, y: 0, z: signX * 0.7 },
      },
    )
    shade(brace, tone(palette.timber, -0.24), palette.timber, 1)
    parts.push(brace)
  }
  const canopy = loftProfile({
    profile: rectProfile(spacing * 2.6, reach + 0.3, 0.05),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: 0.26, scaleX: 0.96, scaleZ: 0.9, offsetZ: -0.16 },
    ],
    name: 'porch-canopy',
  })
  transformed(canopy, {
    position: { x: 0, y: plinthHeight + postHeight, z: depth / 2 + reach / 2 },
  })
  shade(canopy, palette.roofShade, palette.roof, 0.7)
  parts.push(canopy)
  return parts
}

function balconyParts(
  width: number,
  depth: number,
  baseY: number,
  palette: BuildingPalette,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const deckWidth = width * 0.62
  const deckDepth = 0.72
  const deck = piece(
    deckWidth,
    0.12,
    deckDepth,
    palette.timber,
    { position: { x: 0, y: baseY + 0.24, z: depth / 2 + deckDepth / 2 - 0.06 } },
  )
  shade(deck, tone(palette.timber, -0.3), palette.timber, 1)
  parts.push(deck)
  const balusterCount = Math.max(4, Math.round(deckWidth / 0.32))
  for (let index = 0; index <= balusterCount; index += 1) {
    const x = -deckWidth / 2 + (index / balusterCount) * deckWidth
    const baluster = piece(
      0.06,
      0.5,
      0.06,
      palette.timber,
      { position: { x, y: baseY + 0.36, z: depth / 2 + deckDepth - 0.12 } },
    )
    shade(baluster, tone(palette.timber, -0.22), palette.timber, 1)
    parts.push(baluster)
  }
  const rail = piece(
    deckWidth,
    0.09,
    0.12,
    palette.trim,
    { position: { x: 0, y: baseY + 0.86, z: depth / 2 + deckDepth - 0.12 } },
  )
  shade(rail, tone(palette.trim, -0.18), palette.trim, 1)
  parts.push(rail)
  return parts
}

/** Merlons around a parapet. The one silhouette that says "fortification" instantly. */
function crenellations(
  width: number,
  depth: number,
  baseY: number,
  palette: BuildingPalette,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const merlon = 0.44
  const gap = 0.34
  const step = merlon + gap
  const along = (length: number): number[] => {
    const count = Math.max(2, Math.floor(length / step))
    const used = count * step - gap
    const start = -used / 2 + merlon / 2
    return Array.from({ length: count }, (_, index) => start + index * step)
  }
  for (const x of along(width)) {
    for (const signZ of [-1, 1]) {
      const block = piece(
        merlon,
        0.42,
        0.28,
        palette.roofRidge,
        { position: { x, y: baseY, z: signZ * (depth / 2 - 0.14) } },
        { topScale: 0.92 },
      )
      shade(block, tone(palette.roofRidge, -0.24), palette.roofRidge, 1)
      parts.push(block)
    }
  }
  for (const z of along(depth - 0.9)) {
    for (const signX of [-1, 1]) {
      const block = piece(
        0.28,
        0.42,
        merlon,
        palette.roofRidge,
        { position: { x: signX * (width / 2 - 0.14), y: baseY, z } },
        { topScale: 0.92 },
      )
      shade(block, tone(palette.roofRidge, -0.24), palette.roofRidge, 1)
      parts.push(block)
    }
  }
  return parts
}

// ---------------------------------------------------------------------------
// Settlement dressing
// ---------------------------------------------------------------------------

export interface PropPalette {
  timber: THREE.ColorRepresentation
  timberShade: THREE.ColorRepresentation
  stone: THREE.ColorRepresentation
  stoneShade: THREE.ColorRepresentation
  metal: THREE.ColorRepresentation
  cloth: THREE.ColorRepresentation
  clothAccent: THREE.ColorRepresentation
  glow: THREE.ColorRepresentation
  accent: THREE.ColorRepresentation
}

export interface PropOptions {
  variation: ArtVariation
  noiseSeed: number
  palette: PropPalette
  name?: string
}

export type FenceStyle = 'rail' | 'palisade' | 'picket' | 'iron' | 'curtain'

export interface FenceOptions extends PropOptions {
  style: FenceStyle
  length: number
  height?: number
}

/**
 * One panel of fence, built along +X and anchored at its centre.
 *
 * Fencing is the single cheapest way to turn scattered buildings into a *place*: it
 * draws the boundary between "someone lives here" and "wilderness", which is a
 * readability problem long before it is an art problem.
 *
 * `curtain` is the fortification case and delegates to {@link curtainWallParts}, so a
 * stronghold's perimeter is masonry with a walkway and merlons rather than a very
 * long garden fence.
 */
export function fencePanelParts(options: FenceOptions): PropPart[] {
  if (options.style === 'curtain') {
    return curtainWallParts({
      variation: options.variation,
      noiseSeed: options.noiseSeed,
      palette: options.palette,
      length: options.length,
      ...(options.height === undefined ? {} : { height: options.height }),
      ...(options.name === undefined ? {} : { name: options.name }),
    })
  }
  const variation = options.variation
  const palette = options.palette
  const length = options.length
  const height = options.height ?? (options.style === 'palisade' ? 1.9 : 1.05)
  const parts: THREE.BufferGeometry[] = []
  const wood = options.style === 'iron' ? palette.metal : palette.timber
  const woodShade = options.style === 'iron' ? tone(palette.metal, -0.3) : palette.timberShade

  if (options.style === 'palisade') {
    const stakes = Math.max(3, Math.round(length / 0.34))
    for (let index = 0; index < stakes; index += 1) {
      const x = -length / 2 + ((index + 0.5) / stakes) * length
      const stakeHeight = height * variation.range(0.86, 1.12)
      const stake = piece(
        0.28,
        stakeHeight,
        0.24,
        wood,
        {
          position: { x, y: 0, z: variation.signed(0.04) },
          rotation: { x: variation.signed(0.03), y: 0, z: variation.signed(0.03) },
        },
        // Sharpened tops. A flat-topped palisade reads as a garden fence.
        { topScale: 0.12 },
      )
      shade(stake, woodShade, wood, 0.8)
      parts.push(stake)
    }
    const band = piece(
      length,
      0.12,
      0.1,
      wood,
      { position: { x: 0, y: height * 0.62, z: -0.16 } },
    )
    shade(band, woodShade, wood, 1)
    parts.push(band)
  } else {
    const postCount = Math.max(2, Math.round(length / 2.2) + 1)
    for (let index = 0; index < postCount; index += 1) {
      const x = -length / 2 + (index / (postCount - 1)) * length
      const post = piece(
        options.style === 'iron' ? 0.09 : 0.15,
        height * 1.12,
        options.style === 'iron' ? 0.09 : 0.15,
        wood,
        { position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: variation.signed(0.03) } },
        { topScale: options.style === 'picket' ? 0.5 : 0.9 },
      )
      shade(post, woodShade, wood, 0.85)
      parts.push(post)
    }
    const railCount = options.style === 'picket' ? 2 : 3
    for (let index = 0; index < railCount; index += 1) {
      const y = height * (0.28 + (index / Math.max(1, railCount - 1)) * 0.62)
      const rail = piece(
        length,
        0.09,
        0.07,
        wood,
        { position: { x: 0, y, z: 0 } },
      )
      shade(rail, woodShade, wood, 1)
      parts.push(rail)
    }
    if (options.style === 'picket' || options.style === 'iron') {
      const pales = Math.max(4, Math.round(length / 0.28))
      for (let index = 0; index < pales; index += 1) {
        const x = -length / 2 + ((index + 0.5) / pales) * length
        const pale = piece(
          options.style === 'iron' ? 0.045 : 0.09,
          height,
          options.style === 'iron' ? 0.045 : 0.05,
          wood,
          { position: { x, y: 0, z: 0 } },
          { topScale: options.style === 'iron' ? 0.25 : 0.6 },
        )
        shade(pale, woodShade, wood, 0.9)
        parts.push(pale)
      }
    }
  }

  const geometry = mergeAll(parts, { name: options.name ?? 'prop-fence' })
  bakeVerticalOcclusion(geometry, { strength: 0.24, falloff: 0.35 })
  return [propPart(geometry, 'hard')]
}

export interface GateOptions extends PropOptions {
  width: number
  height?: number
  /** Hangs a cloth banner over the arch. */
  banner?: boolean
}

/** A gate: two heavy piers, a lintel, two leaves and an optional banner. */
export function gateParts(options: GateOptions): PropPart[] {
  const palette = options.palette
  const width = options.width
  const height = options.height ?? 3.4
  const hard: THREE.BufferGeometry[] = []
  const cloth: THREE.BufferGeometry[] = []

  for (const signX of [-1, 1]) {
    const pier = piece(
      0.7,
      height,
      0.7,
      palette.stone,
      { position: { x: signX * (width / 2 + 0.35), y: 0, z: 0 } },
      { topScale: 0.86, bevel: 0.06 },
    )
    shade(pier, palette.stoneShade, palette.stone, 0.75)
    mottle(pier, options.noiseSeed + 7, 0.09, 1.1)
    hard.push(pier)
    const cap = piece(
      0.92,
      0.2,
      0.92,
      palette.stone,
      { position: { x: signX * (width / 2 + 0.35), y: height, z: 0 } },
      { topScale: 0.8 },
    )
    shade(cap, palette.stoneShade, palette.stone, 1)
    hard.push(cap)
    const leaf = piece(
      width / 2 - 0.05,
      height * 0.78,
      0.14,
      palette.timber,
      {
        position: { x: signX * (width / 4), y: 0, z: 0 },
        rotation: { x: 0, y: signX * 0.12, z: 0 },
      },
    )
    shade(leaf, palette.timberShade, palette.timber, 0.8)
    hard.push(leaf)
    for (let index = 0; index < 2; index += 1) {
      const strap = piece(
        width / 2 - 0.15,
        0.1,
        0.06,
        palette.metal,
        {
          position: {
            x: signX * (width / 4),
            y: height * (0.2 + index * 0.4),
            z: 0.1,
          },
          rotation: { x: 0, y: signX * 0.12, z: 0 },
        },
      )
      shade(strap, tone(palette.metal, -0.3), palette.metal, 1)
      hard.push(strap)
    }
  }

  const lintel = piece(
    width + 1.7,
    0.42,
    0.86,
    palette.stone,
    { position: { x: 0, y: height, z: 0 } },
    { topScale: 0.94, bevel: 0.05 },
  )
  shade(lintel, palette.stoneShade, palette.stone, 0.9)
  hard.push(lintel)

  if (options.banner !== false) {
    const drape = clothPanel(
      width * 0.42,
      height * 0.5,
      palette.cloth,
      palette.clothAccent,
      options.variation,
    )
    transformed(drape, { position: { x: 0, y: height - 0.06, z: 0.5 } })
    cloth.push(drape)
  }

  const geometry = mergeAll(hard, { name: options.name ?? 'prop-gate' })
  bakeSkyOcclusion(geometry, { strength: 0.24 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: 0.8 })
  const parts = [propPart(geometry, 'hard')]
  if (cloth.length > 0) {
    parts.push(propPart(mergeAll(cloth, { name: 'prop-gate-banner' }), 'cloth'))
  }
  return parts
}

/**
 * A hanging cloth with a wave in it.
 *
 * Anchored at the *top*, because everything that uses one — a banner, a gate drape,
 * washing on a line, a stall awning — hangs from a fixed point and falls.
 */
function clothPanel(
  width: number,
  height: number,
  top: THREE.ColorRepresentation,
  bottom: THREE.ColorRepresentation,
  variation: ArtVariation,
): THREE.BufferGeometry {
  const phase = variation.angle()
  const amplitude = width * 0.16
  const sections = []
  const steps = 5
  for (let index = 0; index <= steps; index += 1) {
    const amount = index / steps
    sections.push({
      y: -height * amount,
      scaleX: 1 - amount * 0.08,
      offsetZ: Math.sin(phase + amount * 3.4) * amplitude * amount,
      rotation: Math.sin(phase * 1.3 + amount * 2.2) * 0.06,
    })
  }
  sections.reverse()
  const panel = loftProfile({
    profile: rectProfile(width, 0.035),
    sections,
    name: 'cloth-panel',
  })
  return shade(panel, bottom, top, 0.8)
}

export interface BannerOptions extends PropOptions {
  height?: number
  width?: number
  /** Draws a pennant instead of a rectangular banner. */
  pennant?: boolean
}

/** A banner on a pole. The loudest available statement of who holds this ground. */
export function bannerParts(options: BannerOptions): PropPart[] {
  const palette = options.palette
  const height = options.height ?? 3.2
  const width = options.width ?? 0.68
  const pole = piece(
    0.09,
    height,
    0.09,
    palette.timber,
    {},
    { topScale: 0.7 },
  )
  shade(pole, palette.timberShade, palette.timber, 0.8)
  const finial = piece(
    0.16,
    0.2,
    0.16,
    palette.metal,
    { position: { x: 0, y: height, z: 0 } },
    { topScale: 0.15 },
  )
  shade(finial, tone(palette.metal, -0.2), palette.metal, 1)
  const crossbar = piece(
    width * 1.1,
    0.06,
    0.06,
    palette.timber,
    { position: { x: 0, y: height - 0.16, z: 0 } },
  )
  shade(crossbar, palette.timberShade, palette.timber, 1)
  const hard = mergeAll([pole, finial, crossbar], {
    name: options.name ?? 'prop-banner-pole',
  })
  bakeVerticalOcclusion(hard, { strength: 0.2, falloff: 0.5 })

  const cloth = clothPanel(
    width,
    height * (options.pennant === true ? 0.36 : 0.52),
    palette.cloth,
    palette.clothAccent,
    options.variation,
  )
  transformed(cloth, { position: { x: 0, y: height - 0.2, z: 0 } })
  return [propPart(hard, 'hard'), propPart(cloth, 'cloth')]
}

export interface WellOptions extends PropOptions {
  radius?: number
}

/** A well: a stone ring, two posts, a winch and a bucket. Villages need a centre. */
export function wellParts(options: WellOptions): PropPart[] {
  const palette = options.palette
  const radius = options.radius ?? 0.78
  const ring = loftProfile({
    profile: polygonProfile(radius, 9),
    sections: [
      { y: 0, scaleX: 1.08 },
      { y: 0.5, scaleX: 1 },
      { y: 0.62, scaleX: 1.06 },
    ],
    name: 'well-ring',
  })
  shade(ring, palette.stoneShade, palette.stone, 0.75)
  mottle(ring, options.noiseSeed, 0.11, 2.2)
  // A dark disc just below the rim. Without it the well is a stone tube; with it,
  // it is a hole, and the eye reads holes as depth.
  const water = loftProfile({
    profile: polygonProfile(radius * 0.86, 9),
    sections: [
      { y: 0, scaleX: 1 },
      { y: 0.04, scaleX: 1 },
    ],
    name: 'well-water',
  })
  transformed(water, { position: { x: 0, y: 0.3, z: 0 } })
  shade(water, 0x0b1418, 0x16323a, 1)

  const parts = [ring, water]
  for (const signX of [-1, 1]) {
    const post = piece(
      0.13,
      1.55,
      0.13,
      palette.timber,
      { position: { x: signX * radius * 0.82, y: 0.44, z: 0 } },
      { topScale: 0.8 },
    )
    shade(post, palette.timberShade, palette.timber, 0.85)
    parts.push(post)
  }
  const beam = piece(
    radius * 2.1,
    0.12,
    0.12,
    palette.timber,
    { position: { x: 0, y: 1.94, z: 0 } },
  )
  shade(beam, palette.timberShade, palette.timber, 1)
  parts.push(beam)
  const roof = loftProfile({
    profile: rectProfile(radius * 2.5, radius * 1.7, 0.05),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: 0.42, scaleX: 0.9, scaleZ: 0.06 },
    ],
    name: 'well-roof',
  })
  transformed(roof, { position: { x: 0, y: 2.02, z: 0 } })
  shade(roof, tone(palette.timber, -0.3), palette.accent, 0.7)
  parts.push(roof)
  const rope = piece(
    0.04,
    0.72,
    0.04,
    palette.timberShade,
    { position: { x: 0, y: 1.18, z: 0 } },
  )
  shade(rope, palette.timberShade, palette.timber, 1)
  parts.push(rope)
  const bucket = latheProfile(
    [
      { x: 0.001, y: 0 },
      { x: 0.16, y: 0 },
      { x: 0.19, y: 0.26 },
      { x: 0.18, y: 0.28 },
      { x: 0.001, y: 0.28 },
    ],
    { segments: 7, name: 'well-bucket' },
  )
  transformed(bucket, { position: { x: 0, y: 1.16, z: 0 } })
  shade(bucket, palette.timberShade, palette.timber, 0.8)
  parts.push(bucket)

  const geometry = mergeAll(parts, { name: options.name ?? 'prop-well' })
  bakeSkyOcclusion(geometry, { strength: 0.26 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: 0.5 })
  return [propPart(geometry, 'hard')]
}

export interface StallOptions extends PropOptions {
  width?: number
  depth?: number
}

/** A market stall: counter, four posts, a striped awning and goods on the board. */
export function marketStallParts(options: StallOptions): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const width = options.width ?? 2.4
  const depth = options.depth ?? 1.5
  const hard: THREE.BufferGeometry[] = []

  const counter = piece(
    width,
    0.94,
    depth * 0.5,
    palette.timber,
    { position: { x: 0, y: 0, z: depth * 0.2 } },
    { topScale: 0.96 },
  )
  shade(counter, palette.timberShade, palette.timber, 0.8)
  hard.push(counter)
  const board = piece(
    width + 0.3,
    0.1,
    depth * 0.66,
    palette.timber,
    { position: { x: 0, y: 0.94, z: depth * 0.2 } },
  )
  shade(board, tone(palette.timber, 0.08), tone(palette.timber, 0.18), 1)
  hard.push(board)

  for (const signX of [-1, 1]) {
    for (const signZ of [-1, 1]) {
      const post = piece(
        0.11,
        2.1,
        0.11,
        palette.timber,
        {
          position: {
            x: signX * (width / 2 - 0.05),
            y: 0,
            z: signZ * (depth / 2),
          },
        },
        { topScale: 0.82 },
      )
      shade(post, palette.timberShade, palette.timber, 0.85)
      hard.push(post)
    }
  }

  // Goods. Three small stacked boxes at slightly wrong angles read as merchandise
  // far better than any amount of counter detail.
  for (let index = 0; index < 3; index += 1) {
    const goods = piece(
      variation.range(0.18, 0.3),
      variation.range(0.14, 0.26),
      variation.range(0.16, 0.26),
      palette.accent,
      {
        position: {
          x: -width * 0.3 + index * width * 0.3,
          y: 1.04,
          z: depth * 0.2 + variation.signed(0.1),
        },
        rotation: { x: 0, y: variation.angle(), z: 0 },
      },
    )
    shade(goods, tone(palette.accent, -0.3), palette.accent, 0.8)
    hard.push(goods)
  }

  const awning = loftProfile({
    profile: rectProfile(width + 0.5, depth + 0.6, 0.04),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: 0.42, scaleX: 0.92, scaleZ: 0.1, offsetZ: -0.12 },
    ],
    name: 'stall-awning',
  })
  transformed(awning, { position: { x: 0, y: 2.08, z: 0 } })
  // Stripes are hue steps in the vertex colour: no texture, and they survive the
  // merge into the settlement's single cloth mesh.
  const stripeWidth = (width + 0.5) / 6
  const stripeA = colorOf(palette.cloth)
  const stripeB = colorOf(palette.clothAccent)
  paintVertexColors(awning, (context, out) => {
    const band = Math.floor((context.x + (width + 0.5) / 2) / stripeWidth)
    const chosen = band % 2 === 0 ? stripeA : stripeB
    out.setRGB(chosen.r, chosen.g, chosen.b).multiplyScalar(0.82 + context.heightRatio * 0.22)
  })

  const geometry = mergeAll(hard, { name: options.name ?? 'prop-stall' })
  bakeSkyOcclusion(geometry, { strength: 0.24 })
  bakeVerticalOcclusion(geometry, { strength: 0.28, falloff: 0.5 })
  return [propPart(geometry, 'hard'), propPart(awning, 'cloth')]
}

/** A post, an arm, a hanging board and two chains. Says "this building is a shop". */
export function signboardParts(options: PropOptions): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const parts: THREE.BufferGeometry[] = []
  const post = piece(0.12, 2.5, 0.12, palette.timber, {}, { topScale: 0.86 })
  shade(post, palette.timberShade, palette.timber, 0.85)
  parts.push(post)
  const arm = piece(
    0.86,
    0.09,
    0.09,
    palette.timber,
    { position: { x: 0.42, y: 2.32, z: 0 } },
  )
  shade(arm, palette.timberShade, palette.timber, 1)
  parts.push(arm)
  const brace = piece(
    0.42,
    0.07,
    0.07,
    palette.timber,
    { position: { x: 0.06, y: 1.96, z: 0 }, rotation: { x: 0, y: 0, z: -0.72 } },
  )
  shade(brace, palette.timberShade, palette.timber, 1)
  parts.push(brace)
  for (const offset of [-0.26, 0.26]) {
    const chain = piece(
      0.03,
      0.16,
      0.03,
      palette.metal,
      { position: { x: 0.72 + offset, y: 2.16, z: 0 } },
    )
    shade(chain, tone(palette.metal, -0.3), palette.metal, 1)
    parts.push(chain)
  }
  // A cut silhouette rather than a rectangle: the board is the shop's only piece of
  // signage and a shaped one reads at a distance where lettering never could.
  const board = extrudeProfile(
    [
      { x: -0.36, y: 0 },
      { x: 0.36, y: 0 },
      { x: 0.42, y: -0.3 },
      { x: 0, y: -0.48 },
      { x: -0.42, y: -0.3 },
    ],
    { depth: 0.06, name: 'sign-board' },
  )
  transformed(board, {
    position: { x: 0.72, y: 2.16, z: 0 },
    rotation: { x: 0, y: variation.signed(0.12), z: 0 },
  })
  shade(board, tone(palette.accent, -0.28), palette.accent, 0.7)
  parts.push(board)

  const geometry = mergeAll(parts, { name: options.name ?? 'prop-signboard' })
  bakeVerticalOcclusion(geometry, { strength: 0.24, falloff: 0.5 })
  return [propPart(geometry, 'hard')]
}

/** A four-plank crate with corner battens. */
export function crateGeometry(options: PropOptions & { size?: number }): THREE.BufferGeometry {
  const palette = options.palette
  const size = options.size ?? 0.6
  const body = piece(size, size * 0.9, size * 0.86, palette.timber, {}, { topScale: 0.98 })
  shade(body, palette.timberShade, palette.timber, 0.8)
  const parts = [body]
  for (const axis of ['x', 'z'] as const) {
    for (const sign of [-1, 1]) {
      const batten = piece(
        axis === 'x' ? 0.06 : size * 1.02,
        size * 0.9,
        axis === 'x' ? size * 0.88 : 0.06,
        palette.timber,
        {
          position: {
            x: axis === 'x' ? sign * (size / 2) : 0,
            y: 0,
            z: axis === 'z' ? sign * (size * 0.43) : 0,
          },
        },
      )
      shade(batten, tone(palette.timber, -0.14), tone(palette.timber, 0.06), 1)
      parts.push(batten)
    }
  }
  const geometry = mergeAll(parts, { name: options.name ?? 'prop-crate' })
  bakeSkyOcclusion(geometry, { strength: 0.24 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: size * 0.4 })
  return bakeOutlineNormals(geometry)
}

/** A staved barrel with two iron hoops. */
export function barrelGeometry(
  options: PropOptions & { radius?: number; height?: number },
): THREE.BufferGeometry {
  const palette = options.palette
  const radius = options.radius ?? 0.3
  const height = options.height ?? 0.78
  const body = loftProfile({
    profile: polygonProfile(radius, 9),
    sections: [
      { y: 0, scaleX: 0.84 },
      { y: height * 0.2, scaleX: 0.98 },
      { y: height * 0.5, scaleX: 1 },
      { y: height * 0.8, scaleX: 0.98 },
      { y: height, scaleX: 0.84 },
    ],
    name: 'barrel-body',
  })
  shade(body, palette.timberShade, palette.timber, 0.7)
  const parts = [body]
  for (const amount of [0.24, 0.74]) {
    const hoop = loftProfile({
      profile: polygonProfile(radius * 1.02, 9),
      sections: [
        { y: 0, scaleX: 1 },
        { y: 0.06, scaleX: 1 },
      ],
      name: 'barrel-hoop',
    })
    transformed(hoop, { position: { x: 0, y: height * amount, z: 0 } })
    shade(hoop, tone(palette.metal, -0.3), palette.metal, 1)
    parts.push(hoop)
  }
  const geometry = mergeAll(parts, { name: options.name ?? 'prop-barrel' })
  bakeSkyOcclusion(geometry, { strength: 0.24 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: height * 0.4 })
  return bakeOutlineNormals(geometry)
}

/** A stack of split logs under a lean-to. Firewood is civilization. */
export function woodpileGeometry(
  options: PropOptions & { width?: number; height?: number },
): THREE.BufferGeometry {
  const palette = options.palette
  const variation = options.variation
  const width = options.width ?? 1.9
  const height = options.height ?? 0.9
  const rows = Math.max(2, Math.round(height / 0.24))
  const parts: THREE.BufferGeometry[] = []
  for (let row = 0; row < rows; row += 1) {
    const rowWidth = width * (1 - (row / rows) * 0.18)
    const count = Math.max(2, Math.round(rowWidth / 0.26))
    for (let index = 0; index < count; index += 1) {
      const log = loftProfile({
        profile: polygonProfile(0.115, 6, variation.angle()),
        sections: [
          { y: 0, scaleX: 1 },
          { y: variation.range(0.5, 0.72), scaleX: variation.range(0.9, 1.05) },
        ],
        name: 'woodpile-log',
      })
      transformed(log, {
        rotation: { x: Math.PI / 2, y: 0, z: 0 },
        position: {
          x: -rowWidth / 2 + ((index + 0.5) / count) * rowWidth,
          y: 0.115 + row * 0.235,
          z: variation.signed(0.06),
        },
      })
      const logTone = variation.range(-0.2, 0.16)
      shade(log, tone(palette.timberShade, logTone), tone(palette.timber, logTone), 0.8)
      parts.push(log)
    }
  }
  const geometry = mergeAll(parts, { name: options.name ?? 'prop-woodpile' })
  bakeSkyOcclusion(geometry, { strength: 0.3 })
  bakeVerticalOcclusion(geometry, { strength: 0.32, falloff: height * 0.5 })
  return bakeOutlineNormals(geometry)
}

/** A two-wheeled cart with shafts and a covered load. */
export function cartParts(options: PropOptions & { length?: number }): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const length = options.length ?? 2.1
  const width = length * 0.62
  const hard: THREE.BufferGeometry[] = []

  const bed = piece(
    length,
    0.18,
    width,
    palette.timber,
    { position: { x: 0, y: 0.52, z: 0 } },
  )
  shade(bed, palette.timberShade, palette.timber, 1)
  hard.push(bed)
  for (const signZ of [-1, 1]) {
    const side = piece(
      length,
      0.34,
      0.09,
      palette.timber,
      { position: { x: 0, y: 0.7, z: signZ * (width / 2) } },
    )
    shade(side, palette.timberShade, palette.timber, 0.8)
    hard.push(side)
  }
  const tailboard = piece(
    0.09,
    0.34,
    width,
    palette.timber,
    { position: { x: -length / 2, y: 0.7, z: 0 } },
  )
  shade(tailboard, palette.timberShade, palette.timber, 0.8)
  hard.push(tailboard)

  for (const signZ of [-1, 1]) {
    const wheel = latheProfile(
      [
        { x: 0.001, y: -0.07 },
        { x: 0.34, y: -0.07 },
        { x: 0.42, y: -0.05 },
        { x: 0.42, y: 0.05 },
        { x: 0.34, y: 0.07 },
        { x: 0.001, y: 0.07 },
      ],
      { segments: 10, name: 'cart-wheel' },
    )
    transformed(wheel, {
      rotation: { x: Math.PI / 2, y: 0, z: 0 },
      position: { x: -length * 0.12, y: 0.42, z: signZ * (width / 2 + 0.08) },
    })
    shade(wheel, palette.timberShade, palette.timber, 0.6)
    hard.push(wheel)
  }
  const axle = piece(
    0.1,
    0.1,
    width + 0.34,
    palette.timber,
    { position: { x: -length * 0.12, y: 0.37, z: 0 } },
  )
  shade(axle, palette.timberShade, palette.timber, 1)
  hard.push(axle)
  for (const signZ of [-1, 1]) {
    const shaft = piece(
      length * 0.8,
      0.08,
      0.08,
      palette.timber,
      {
        position: { x: length * 0.5, y: 0.56, z: signZ * width * 0.3 },
        rotation: { x: 0, y: 0, z: -0.12 },
      },
    )
    shade(shaft, palette.timberShade, palette.timber, 1)
    hard.push(shaft)
  }

  const geometry = mergeAll(hard, { name: options.name ?? 'prop-cart' })
  bakeSkyOcclusion(geometry, { strength: 0.26 })
  bakeVerticalOcclusion(geometry, { strength: 0.28, falloff: 0.4 })

  const cover = clothPanel(
    width * 0.9,
    0.7,
    palette.cloth,
    palette.clothAccent,
    variation,
  )
  transformed(cover, {
    position: { x: length * 0.1, y: 1.12, z: 0 },
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
  })
  return [propPart(geometry, 'hard'), propPart(cover, 'cloth')]
}

/** Two poles, a line and three shirts. Nothing says "inhabited" faster. */
export function washingLineParts(
  options: PropOptions & { length?: number },
): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const length = options.length ?? 3.4
  const height = 1.85
  const hard: THREE.BufferGeometry[] = []
  for (const signX of [-1, 1]) {
    const pole = piece(
      0.09,
      height,
      0.09,
      palette.timber,
      {
        position: { x: signX * (length / 2), y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: signX * 0.04 },
      },
      { topScale: 0.7 },
    )
    shade(pole, palette.timberShade, palette.timber, 0.85)
    hard.push(pole)
    const crossbar = piece(
      0.36,
      0.05,
      0.05,
      palette.timber,
      { position: { x: signX * (length / 2), y: height - 0.12, z: 0 } },
    )
    shade(crossbar, palette.timberShade, palette.timber, 1)
    hard.push(crossbar)
  }
  const line = piece(
    length,
    0.025,
    0.025,
    palette.timberShade,
    { position: { x: 0, y: height - 0.16, z: 0 } },
  )
  shade(line, palette.timberShade, palette.timberShade, 1)
  hard.push(line)

  const cloths: THREE.BufferGeometry[] = []
  const count = variation.integer(3, 5)
  for (let index = 0; index < count; index += 1) {
    const x = -length * 0.34 + (index / Math.max(1, count - 1)) * length * 0.68
    const garment = clothPanel(
      variation.range(0.36, 0.58),
      variation.range(0.44, 0.72),
      index % 2 === 0 ? palette.cloth : palette.clothAccent,
      index % 2 === 0 ? palette.clothAccent : palette.cloth,
      variation,
    )
    transformed(garment, { position: { x, y: height - 0.16, z: 0 } })
    cloths.push(garment)
  }
  return [
    propPart(mergeAll(hard, { name: options.name ?? 'prop-washing-line' }), 'hard'),
    propPart(mergeAll(cloths, { name: 'prop-washing' }), 'cloth'),
  ]
}

/** A tripod brazier with glowing coals. The world's only warm light after dark. */
export function brazierParts(options: PropOptions & { height?: number }): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const height = options.height ?? 1.05
  const hard: THREE.BufferGeometry[] = []
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2 + variation.signed(0.2)
    const leg = piece(
      0.08,
      height,
      0.08,
      palette.metal,
      {
        position: {
          x: Math.cos(angle) * height * 0.22,
          y: 0,
          z: Math.sin(angle) * height * 0.22,
        },
        rotation: { x: -Math.sin(angle) * 0.2, y: 0, z: Math.cos(angle) * 0.2 },
      },
    )
    shade(leg, tone(palette.metal, -0.36), palette.metal, 0.8)
    hard.push(leg)
  }
  const bowl = latheProfile(
    [
      { x: 0.001, y: 0 },
      { x: 0.26, y: 0.08 },
      { x: 0.42, y: 0.28 },
      { x: 0.44, y: 0.32 },
      { x: 0.38, y: 0.32 },
      { x: 0.24, y: 0.12 },
      { x: 0.001, y: 0.05 },
    ],
    { segments: 9, name: 'brazier-bowl' },
  )
  transformed(bowl, { position: { x: 0, y: height, z: 0 } })
  shade(bowl, tone(palette.metal, -0.34), palette.metal, 0.7)
  hard.push(bowl)

  const coals = loftProfile({
    profile: polygonProfile(0.3, 7),
    sections: [
      { y: 0, scaleX: 0.9 },
      { y: 0.1, scaleX: 1 },
      { y: 0.2, scaleX: 0.4 },
    ],
    name: 'brazier-coals',
  })
  transformed(coals, { position: { x: 0, y: height + 0.2, z: 0 } })
  shade(coals, tone(palette.glow, -0.36), palette.glow, 0.6)

  const geometry = mergeAll(hard, { name: options.name ?? 'prop-brazier' })
  bakeVerticalOcclusion(geometry, { strength: 0.26, falloff: 0.4 })
  return [propPart(geometry, 'hard'), propPart(coals, 'glow')]
}

/** A lantern on a post: an iron cage with four lit panes. */
export function lanternPostParts(
  options: PropOptions & { height?: number },
): PropPart[] {
  const palette = options.palette
  const height = options.height ?? 2.6
  const post = piece(0.1, height, 0.1, palette.timber, {}, { topScale: 0.8 })
  shade(post, palette.timberShade, palette.timber, 0.85)
  const arm = piece(
    0.5,
    0.07,
    0.07,
    palette.metal,
    { position: { x: 0.22, y: height - 0.1, z: 0 } },
  )
  shade(arm, tone(palette.metal, -0.3), palette.metal, 1)
  const cage = piece(
    0.24,
    0.32,
    0.24,
    palette.metal,
    { position: { x: 0.6, y: height - 0.46, z: 0 } },
    { topScale: 0.62 },
  )
  shade(cage, tone(palette.metal, -0.34), palette.metal, 0.7)
  const cap = piece(
    0.3,
    0.1,
    0.3,
    palette.metal,
    { position: { x: 0.6, y: height - 0.14, z: 0 } },
    { topScale: 0.3 },
  )
  shade(cap, tone(palette.metal, -0.28), palette.metal, 1)
  const geometry = mergeAll([post, arm, cage, cap], {
    name: options.name ?? 'prop-lantern-post',
  })
  bakeVerticalOcclusion(geometry, { strength: 0.24, falloff: 0.5 })

  const pane = piece(
    0.19,
    0.24,
    0.19,
    palette.glow,
    { position: { x: 0.6, y: height - 0.42, z: 0 } },
    { topScale: 0.7 },
  )
  shade(pane, tone(palette.glow, -0.16), palette.glow, 0.5)
  return [propPart(geometry, 'hard'), propPart(pane, 'glow')]
}

/** A ridge tent with guy lines and a pennant. */
export function tentParts(
  options: PropOptions & { width?: number; length?: number; height?: number },
): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const width = options.width ?? 2.6
  const length = options.length ?? 3.2
  const height = options.height ?? 1.9
  const canvas = extrudeProfile(
    [
      { x: -width / 2, y: 0 },
      { x: width / 2, y: 0 },
      { x: width * 0.22, y: height * 0.72 },
      { x: 0, y: height },
      { x: -width * 0.22, y: height * 0.72 },
    ],
    { depth: length, centered: true, name: 'tent-canvas' },
  )
  transformed(canvas, { rotation: { x: 0, y: variation.signed(0.05), z: 0 } })
  shade(canvas, tone(palette.cloth, -0.3), palette.cloth, 0.7)

  const hard: THREE.BufferGeometry[] = []
  const ridge = piece(
    0.09,
    height + 0.4,
    0.09,
    palette.timber,
    { position: { x: 0, y: 0, z: length / 2 - 0.1 } },
    { topScale: 0.6 },
  )
  shade(ridge, palette.timberShade, palette.timber, 0.9)
  hard.push(ridge)
  for (const signX of [-1, 1]) {
    for (const signZ of [-1, 1]) {
      const guy = piece(
        0.05,
        1.15,
        0.05,
        palette.timberShade,
        {
          position: {
            x: signX * width * 0.62,
            y: 0,
            z: signZ * length * 0.4,
          },
          rotation: { x: 0, y: 0, z: -signX * 0.85 },
        },
      )
      shade(guy, palette.timberShade, palette.timber, 1)
      hard.push(guy)
    }
  }
  const pennant = clothPanel(
    0.3,
    0.42,
    palette.clothAccent,
    palette.cloth,
    variation,
  )
  transformed(pennant, { position: { x: 0, y: height + 0.36, z: length / 2 - 0.1 } })

  return [
    propPart(mergeAll(hard, { name: options.name ?? 'prop-tent-frame' }), 'hard'),
    propPart(mergeAll([canvas, pennant], { name: 'prop-tent-canvas' }), 'cloth'),
  ]
}

// ---------------------------------------------------------------------------
// Fortification
// ---------------------------------------------------------------------------

export interface TowerOptions extends PropOptions {
  radius?: number
  height?: number
  sides?: number
  roof?: boolean
  detail?: 'near' | 'far'
}

/** A defensive tower: battered base, arrow slits, machicolation and a conical cap. */
export function towerParts(options: TowerOptions): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const radius = options.radius ?? 1.4
  const height = options.height ?? 6.5
  const sides = Math.max(5, Math.floor(options.sides ?? 8))
  const detail = options.detail ?? 'near'
  const parts: THREE.BufferGeometry[] = []

  const shaft = loftProfile({
    profile: polygonProfile(radius, sides),
    sections: [
      { y: 0, scaleX: 1.18 },
      { y: height * 0.14, scaleX: 1.02 },
      { y: height * 0.86, scaleX: 0.96 },
      { y: height, scaleX: 0.95 },
    ],
    name: 'tower-shaft',
  })
  shade(shaft, palette.stoneShade, palette.stone, 0.8)
  mottle(shaft, options.noiseSeed, 0.09, 0.8)
  parts.push(shaft)

  // The corbel ring is the difference between a tower and a chimney: it breaks the
  // vertical, catches a shadow, and gives the crenellations something to sit on.
  const corbel = loftProfile({
    profile: polygonProfile(radius * 1.18, sides),
    sections: [
      { y: 0, scaleX: 0.86 },
      { y: 0.28, scaleX: 1 },
      { y: 0.42, scaleX: 1 },
    ],
    name: 'tower-corbel',
  })
  transformed(corbel, { position: { x: 0, y: height - 0.14, z: 0 } })
  shade(corbel, palette.stoneShade, palette.stone, 1)
  parts.push(corbel)

  if (detail === 'near') {
    const merlonCount = sides
    for (let index = 0; index < merlonCount; index += 1) {
      const angle = (index / merlonCount) * Math.PI * 2 + Math.PI / merlonCount
      const merlon = piece(
        radius * 0.52,
        0.5,
        0.3,
        palette.stone,
        {
          position: {
            x: Math.cos(angle) * radius * 1.02,
            y: height + 0.28,
            z: Math.sin(angle) * radius * 1.02,
          },
          rotation: { x: 0, y: -angle, z: 0 },
        },
        { topScale: 0.94 },
      )
      shade(merlon, palette.stoneShade, palette.stone, 1)
      parts.push(merlon)
    }
    for (let index = 0; index < 3; index += 1) {
      const angle = variation.angle()
      const slit = piece(
        0.14,
        0.68,
        0.14,
        0x14161b,
        {
          position: {
            x: Math.cos(angle) * radius * 0.99,
            y: height * variation.range(0.34, 0.7),
            z: Math.sin(angle) * radius * 0.99,
          },
          rotation: { x: 0, y: -angle, z: 0 },
        },
      )
      shade(slit, 0x090b0e, 0x1c2028, 1)
      parts.push(slit)
    }
  }

  const geometry = mergeAll(parts, { name: options.name ?? 'prop-tower' })
  bakeSkyOcclusion(geometry, { strength: 0.26 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: height * 0.2 })
  const result = [propPart(geometry, 'hard')]

  if (options.roof === true) {
    const cone = loftProfile({
      profile: polygonProfile(radius * 1.24, sides),
      sections: [
        { y: 0, scaleX: 1 },
        { y: height * 0.06, scaleX: 0.92 },
        { y: height * 0.24, scaleX: 0.5 },
        { y: height * 0.34, scaleX: 0.04 },
      ],
      name: 'tower-roof',
    })
    transformed(cone, { position: { x: 0, y: height + 0.5, z: 0 } })
    shade(cone, tone(palette.accent, -0.34), palette.accent, 0.7)
    bakeSkyOcclusion(cone, { strength: 0.22 })
    bakeOutlineNormals(cone)
    result.push(propPart(cone, 'hard'))
  }
  return result
}

export interface CurtainWallOptions extends PropOptions {
  length: number
  height?: number
  thickness?: number
  crenellated?: boolean
}

/** A run of curtain wall with a walkway and merlons, built along +X. */
export function curtainWallParts(options: CurtainWallOptions): PropPart[] {
  const palette = options.palette
  const length = options.length
  const height = options.height ?? 3.6
  const thickness = options.thickness ?? 0.9
  const parts: THREE.BufferGeometry[] = []

  const body = loftProfile({
    profile: rectProfile(length, thickness, 0.06),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 1.3 },
      { y: height * 0.22, scaleX: 1, scaleZ: 1.06 },
      { y: height, scaleX: 1, scaleZ: 1 },
    ],
    name: 'curtain-wall',
  })
  shade(body, palette.stoneShade, palette.stone, 0.8)
  mottle(body, options.noiseSeed, 0.08, 0.7)
  parts.push(body)

  const walkway = piece(
    length,
    0.16,
    thickness * 1.32,
    palette.stone,
    { position: { x: 0, y: height, z: 0 } },
  )
  shade(walkway, palette.stoneShade, palette.stone, 1)
  parts.push(walkway)

  if (options.crenellated !== false) {
    const step = 0.78
    const count = Math.max(2, Math.floor(length / step))
    const start = -((count - 1) * step) / 2
    for (let index = 0; index < count; index += 1) {
      for (const signZ of [-1, 1]) {
        const merlon = piece(
          0.46,
          0.46,
          thickness * 0.34,
          palette.stone,
          {
            position: {
              x: start + index * step,
              y: height + 0.16,
              z: signZ * (thickness * 0.48),
            },
          },
          { topScale: 0.94 },
        )
        shade(merlon, palette.stoneShade, palette.stone, 1)
        parts.push(merlon)
      }
    }
  }

  const geometry = mergeAll(parts, { name: options.name ?? 'prop-curtain-wall' })
  bakeSkyOcclusion(geometry, { strength: 0.26 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: height * 0.3 })
  return [propPart(geometry, 'hard')]
}

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export interface BridgeOptions extends PropOptions {
  /** Crossing length along +X. */
  span: number
  /** Deck width along +Z. */
  width: number
  style: 'timber' | 'stone'
  /** Rise of the deck at mid-span. A flat bridge reads as a plank. */
  camber?: number
  detail?: 'near' | 'far'
}

/**
 * A bridge that is not a box.
 *
 * A crossing is a landmark — it is where the road meets the river, where the player
 * is funnelled, and where a fight is most likely to happen. It gets a cambered plank
 * deck, abutments at both banks, trestles in the water, a railing with posts and a
 * top rail that follows the camber, and diagonal braces.
 */
export function bridgeParts(options: BridgeOptions): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const span = options.span
  const width = options.width
  const camber = options.camber ?? Math.min(0.2, span * 0.012)
  const detail = options.detail ?? 'near'
  const deckColor = options.style === 'stone' ? palette.stone : palette.timber
  const deckShade = options.style === 'stone' ? palette.stoneShade : palette.timberShade
  const parts: THREE.BufferGeometry[] = []

  // Camber is deliberately tiny. The player walks on terrain height across the gap
  // in the water collider, not on the deck, so a picturesque arch would put their
  // knees through the planks at mid-span.
  const riseAt = (t: number): number => camber * (1 - (2 * t - 1) * (2 * t - 1))

  const plankCount = detail === 'far' ? 5 : Math.max(8, Math.round(span / 0.75))
  const plankLength = span / plankCount
  for (let index = 0; index < plankCount; index += 1) {
    const t = (index + 0.5) / plankCount
    const plank = piece(
      plankLength * 0.96,
      0.16,
      width,
      deckColor,
      { position: { x: -span / 2 + (index + 0.5) * plankLength, y: riseAt(t), z: 0 } },
    )
    const plankTone = variation.range(-0.14, 0.1)
    shade(plank, tone(deckShade, plankTone), tone(deckColor, plankTone), 0.9)
    parts.push(plank)
  }

  // Stringers under the planks. Without them the deck floats and the underside of a
  // bridge is exactly what the camera sees on the approach.
  for (const signZ of [-1, 1]) {
    const stringer = piece(
      span,
      0.3,
      0.22,
      deckColor,
      { position: { x: 0, y: camber * 0.5 - 0.3, z: signZ * (width / 2 - 0.2) } },
    )
    shade(stringer, deckShade, deckColor, 1)
    parts.push(stringer)
  }

  for (const signX of [-1, 1]) {
    const abutment = piece(
      1.5,
      2.4,
      width + 0.9,
      palette.stone,
      { position: { x: signX * (span / 2 + 0.4), y: -2.3, z: 0 } },
      { topScale: 0.86, bevel: 0.08 },
    )
    shade(abutment, palette.stoneShade, palette.stone, 0.8)
    mottle(abutment, options.noiseSeed + 3, 0.09, 0.9)
    parts.push(abutment)
  }

  if (detail === 'near') {
    for (const signX of [-1, 1]) {
      const pier = piece(
        0.44,
        2.6,
        width * 0.72,
        options.style === 'stone' ? palette.stone : palette.timber,
        { position: { x: signX * span * 0.22, y: -2.5, z: 0 } },
        { topScale: 0.78 },
      )
      shade(pier, deckShade, deckColor, 0.8)
      parts.push(pier)
      for (const signZ of [-1, 1]) {
        const brace = piece(
          0.16,
          1.5,
          0.16,
          deckColor,
          {
            position: { x: signX * span * 0.22, y: -1.4, z: signZ * width * 0.28 },
            rotation: { x: -signZ * 0.5, y: 0, z: 0 },
          },
        )
        shade(brace, deckShade, deckColor, 1)
        parts.push(brace)
      }
    }
  }

  const postCount = detail === 'far' ? 3 : Math.max(4, Math.round(span / 1.5))
  for (let index = 0; index <= postCount; index += 1) {
    const t = index / postCount
    const x = -span / 2 + t * span
    for (const signZ of [-1, 1]) {
      const post = piece(
        0.15,
        0.95,
        0.15,
        deckColor,
        { position: { x, y: riseAt(t) + 0.16, z: signZ * (width / 2 - 0.1) } },
        { topScale: 0.82 },
      )
      shade(post, deckShade, deckColor, 0.85)
      parts.push(post)
    }
  }
  const railSegments = detail === 'far' ? 3 : Math.max(6, Math.round(span / 1.1))
  for (let index = 0; index < railSegments; index += 1) {
    const t0 = index / railSegments
    const t1 = (index + 1) / railSegments
    const y0 = riseAt(t0)
    const y1 = riseAt(t1)
    const segmentLength = span / railSegments
    for (const signZ of [-1, 1]) {
      const rail = piece(
        segmentLength * 1.02,
        0.13,
        0.13,
        deckColor,
        {
          position: {
            x: -span / 2 + (index + 0.5) * segmentLength,
            y: (y0 + y1) / 2 + 1.0,
            z: signZ * (width / 2 - 0.1),
          },
          rotation: { x: 0, y: 0, z: Math.atan2(y1 - y0, segmentLength) },
        },
      )
      shade(rail, deckShade, deckColor, 1)
      parts.push(rail)
    }
  }

  const geometry = mergeAll(parts, { name: options.name ?? 'prop-bridge' })
  bakeSkyOcclusion(geometry, { strength: 0.26 })
  return [propPart(geometry, 'hard')]
}

/** A carved milestone at a junction. Navigation furniture, and free character. */
export function waystoneParts(options: PropOptions & { height?: number }): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const height = options.height ?? 1.35
  const stone = loftProfile({
    profile: polygonProfile(0.3, 5, variation.angle()),
    sections: [
      { y: 0, scaleX: 1.24 },
      { y: height * 0.2, scaleX: 1 },
      { y: height * 0.82, scaleX: 0.86 },
      { y: height, scaleX: 0.62 },
    ],
    name: 'waystone',
  })
  displaceGeometry(stone, {
    seed: options.noiseSeed,
    amplitude: 0.05,
    frequency: 3.2,
    octaves: 2,
    flatBase: height * 0.14,
  })
  shade(stone, palette.stoneShade, palette.stone, 0.8)
  const band = piece(
    0.5,
    0.1,
    0.5,
    palette.accent,
    { position: { x: 0, y: height * 0.62, z: 0 } },
    { topScale: 0.9 },
  )
  shade(band, tone(palette.accent, -0.3), palette.accent, 1)
  const geometry = mergeAll([stone, band], {
    name: options.name ?? 'prop-waystone',
  })
  bakeSkyOcclusion(geometry, { strength: 0.28 })
  bakeVerticalOcclusion(geometry, { strength: 0.32, falloff: height * 0.4 })
  return [propPart(geometry, 'hard')]
}

// ---------------------------------------------------------------------------
// Landmarks and site fixtures
// ---------------------------------------------------------------------------

export interface MonumentOptions extends PropOptions {
  height?: number
  radius?: number
}

/**
 * A stepped plinth under a carved column.
 *
 * Every region needs one thing a player can navigate by, and it has to read at the
 * far edge of the fog. Steps give the base a scale reference, the column gives the
 * skyline a vertical, and the cap gives the ink a heavy top so the silhouette does
 * not taper into nothing.
 */
export function monumentParts(options: MonumentOptions): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const height = options.height ?? 7
  const radius = options.radius ?? 1.1
  const parts: THREE.BufferGeometry[] = []

  for (let index = 0; index < 3; index += 1) {
    const step = piece(
      radius * (3.1 - index * 0.6),
      0.28,
      radius * (3.1 - index * 0.6),
      palette.stone,
      { position: { x: 0, y: index * 0.28, z: 0 }, rotation: { x: 0, y: Math.PI / 4, z: 0 } },
      { topScale: 0.97, bevel: 0.05 },
    )
    shade(step, palette.stoneShade, palette.stone, 0.9)
    parts.push(step)
  }
  const column = loftProfile({
    profile: polygonProfile(radius, 7, variation.angle()),
    sections: [
      { y: 0, scaleX: 1.14 },
      { y: height * 0.1, scaleX: 1 },
      { y: height * 0.72, scaleX: 0.82 },
      { y: height * 0.84, scaleX: 0.94 },
      { y: height, scaleX: 0.76 },
    ],
    name: 'monument-column',
  })
  transformed(column, { position: { x: 0, y: 0.84, z: 0 } })
  shade(column, palette.stoneShade, palette.stone, 0.75)
  mottle(column, options.noiseSeed, 0.09, 0.7)
  parts.push(column)
  const cap = loftProfile({
    profile: polygonProfile(radius * 1.24, 7, variation.angle()),
    sections: [
      { y: 0, scaleX: 0.9 },
      { y: 0.3, scaleX: 1 },
      { y: 0.9, scaleX: 0.5 },
      { y: 1.2, scaleX: 0.08 },
    ],
    name: 'monument-cap',
  })
  transformed(cap, { position: { x: 0, y: 0.84 + height, z: 0 } })
  shade(cap, tone(palette.accent, -0.3), palette.accent, 0.7)
  parts.push(cap)

  const geometry = mergeAll(parts, { name: options.name ?? 'prop-monument' })
  bakeSkyOcclusion(geometry, { strength: 0.28 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: 1.2 })
  return [propPart(geometry, 'hard')]
}

/** A leaning monolith on a cracked base, with a lit rune band. */
export function obeliskParts(options: MonumentOptions): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const height = options.height ?? 5.4
  const radius = options.radius ?? 0.62
  const base = loftProfile({
    profile: polygonProfile(radius * 2.1, 6, variation.angle()),
    sections: [
      { y: 0, scaleX: 1 },
      { y: 0.36, scaleX: 0.84 },
      { y: 0.52, scaleX: 0.78 },
    ],
    name: 'obelisk-base',
  })
  displaceGeometry(base, {
    seed: options.noiseSeed,
    amplitude: radius * 0.16,
    frequency: 2,
    octaves: 2,
    mode: 'ridge',
    flatBase: 0.1,
  })
  shade(base, palette.stoneShade, palette.stone, 0.85)
  const lean = variation.signed(0.16)
  const shaft = loftProfile({
    profile: rectProfile(radius * 2, radius * 2, radius * 0.34),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: height * 0.6, scaleX: 0.74, scaleZ: 0.74, offsetX: lean * 0.6 },
      { y: height * 0.88, scaleX: 0.5, scaleZ: 0.5, offsetX: lean * 0.9 },
      { y: height, scaleX: 0.16, scaleZ: 0.16, offsetX: lean },
    ],
    name: 'obelisk-shaft',
  })
  transformed(shaft, { position: { x: 0, y: 0.48, z: 0 }, rotation: { x: 0, y: variation.angle(), z: 0 } })
  shade(shaft, tone(palette.stoneShade, -0.2), palette.stone, 0.8)
  mottle(shaft, options.noiseSeed + 11, 0.1, 1.1)

  const geometry = mergeAll([base, shaft], {
    name: options.name ?? 'prop-obelisk',
  })
  bakeSkyOcclusion(geometry, { strength: 0.3 })
  bakeVerticalOcclusion(geometry, { strength: 0.32, falloff: 0.9 })

  const runes = loftProfile({
    profile: rectProfile(radius * 1.86, radius * 1.86, radius * 0.3),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: 0.3, scaleX: 0.98, scaleZ: 0.98 },
    ],
    name: 'obelisk-runes',
  })
  transformed(runes, { position: { x: 0, y: height * 0.3, z: 0 } })
  shade(runes, tone(palette.glow, -0.24), palette.glow, 0.5)
  return [propPart(geometry, 'hard'), propPart(runes, 'glow')]
}

/** Four carved posts, a canopy, hanging cloth and a votive bowl that burns. */
export function shrineParts(options: MonumentOptions): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const height = options.height ?? 2.9
  const radius = options.radius ?? 1.5
  const hard: THREE.BufferGeometry[] = []

  const platform = piece(
    radius * 2.3,
    0.26,
    radius * 2.3,
    palette.stone,
    {},
    { topScale: 0.94, bevel: 0.06 },
  )
  shade(platform, palette.stoneShade, palette.stone, 0.9)
  hard.push(platform)

  for (const signX of [-1, 1]) {
    for (const signZ of [-1, 1]) {
      const post = latheProfile(
        [
          { x: 0.001, y: 0 },
          { x: 0.19, y: 0 },
          { x: 0.14, y: 0.24 },
          { x: 0.17, y: 0.42 },
          { x: 0.12, y: height * 0.72 },
          { x: 0.17, y: height * 0.88 },
          { x: 0.12, y: height },
          { x: 0.001, y: height },
        ],
        { segments: 7, name: 'shrine-post' },
      )
      transformed(post, {
        position: { x: signX * radius * 0.78, y: 0.26, z: signZ * radius * 0.78 },
      })
      shade(post, palette.timberShade, palette.timber, 0.8)
      hard.push(post)
    }
  }
  const canopy = loftProfile({
    profile: rectProfile(radius * 2.4, radius * 2.4, radius * 0.2),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: 0.16, scaleX: 0.94, scaleZ: 0.94 },
      { y: 0.86, scaleX: 0.3, scaleZ: 0.3 },
      { y: 1.06, scaleX: 0.06, scaleZ: 0.06 },
    ],
    name: 'shrine-canopy',
  })
  transformed(canopy, { position: { x: 0, y: height + 0.26, z: 0 } })
  shade(canopy, tone(palette.accent, -0.34), palette.accent, 0.7)
  hard.push(canopy)

  const bowlStand = piece(0.24, 0.6, 0.24, palette.stone, {
    position: { x: 0, y: 0.26, z: 0 },
  })
  shade(bowlStand, palette.stoneShade, palette.stone, 0.9)
  hard.push(bowlStand)
  const bowl = latheProfile(
    [
      { x: 0.001, y: 0 },
      { x: 0.22, y: 0.04 },
      { x: 0.34, y: 0.2 },
      { x: 0.3, y: 0.22 },
      { x: 0.19, y: 0.08 },
      { x: 0.001, y: 0.04 },
    ],
    { segments: 9, name: 'shrine-bowl' },
  )
  transformed(bowl, { position: { x: 0, y: 0.86, z: 0 } })
  shade(bowl, tone(palette.metal, -0.3), palette.metal, 0.8)
  hard.push(bowl)

  const geometry = mergeAll(hard, { name: options.name ?? 'prop-shrine' })
  bakeSkyOcclusion(geometry, { strength: 0.26 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: 0.7 })

  const flame = loftProfile({
    profile: polygonProfile(0.2, 6),
    sections: [
      { y: 0, scaleX: 1 },
      { y: 0.16, scaleX: 0.8 },
      { y: 0.34, scaleX: 0.1 },
    ],
    name: 'shrine-flame',
  })
  transformed(flame, { position: { x: 0, y: 0.98, z: 0 } })
  shade(flame, tone(palette.glow, -0.2), palette.glow, 0.5)

  const drapes: THREE.BufferGeometry[] = []
  for (const signZ of [-1, 1]) {
    const drape = clothPanel(
      radius * 1.3,
      height * 0.34,
      palette.cloth,
      palette.clothAccent,
      variation,
    )
    transformed(drape, {
      position: { x: 0, y: height + 0.2, z: signZ * radius * 0.86 },
    })
    drapes.push(drape)
  }
  return [
    propPart(geometry, 'hard'),
    propPart(mergeAll(drapes, { name: 'prop-shrine-drapes' }), 'cloth'),
    propPart(flame, 'glow'),
  ]
}

/** A banded chest, half sunk into a rock plinth. */
export function chestParts(
  options: PropOptions & { width?: number; height?: number },
): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const width = options.width ?? 1.5
  const height = options.height ?? 0.86
  const depth = width * 0.66
  const parts: THREE.BufferGeometry[] = []

  const plinth = loftProfile({
    profile: polygonProfile(width * 0.82, 6, variation.angle()),
    sections: [
      { y: 0, scaleX: 1.1 },
      { y: 0.2, scaleX: 0.94 },
      { y: 0.3, scaleX: 0.86 },
    ],
    name: 'chest-plinth',
  })
  displaceGeometry(plinth, {
    seed: options.noiseSeed,
    amplitude: 0.09,
    frequency: 2.4,
    octaves: 2,
    mode: 'ridge',
  })
  shade(plinth, palette.stoneShade, palette.stone, 0.9)
  parts.push(plinth)

  const body = piece(
    width,
    height * 0.6,
    depth,
    palette.timber,
    { position: { x: 0, y: 0.28, z: 0 }, rotation: { x: 0, y: variation.signed(0.16), z: 0 } },
    { bevel: 0.04 },
  )
  shade(body, palette.timberShade, palette.timber, 0.8)
  parts.push(body)
  const lid = loftProfile({
    profile: rectProfile(width * 1.03, depth * 1.03, 0.05),
    sections: [
      { y: 0, scaleX: 1, scaleZ: 1 },
      { y: height * 0.2, scaleX: 0.98, scaleZ: 0.72 },
      { y: height * 0.34, scaleX: 0.94, scaleZ: 0.3 },
    ],
    name: 'chest-lid',
  })
  transformed(lid, {
    position: { x: 0, y: 0.28 + height * 0.6, z: 0 },
    rotation: { x: 0, y: variation.signed(0.16), z: 0 },
  })
  shade(lid, palette.timberShade, palette.timber, 0.7)
  parts.push(lid)
  for (const offset of [-0.3, 0.3]) {
    const band = piece(
      width * 0.09,
      height * 0.98,
      depth * 1.06,
      palette.metal,
      {
        position: { x: width * offset, y: 0.28, z: 0 },
        rotation: { x: 0, y: variation.signed(0.16), z: 0 },
      },
    )
    shade(band, tone(palette.metal, -0.34), palette.metal, 1)
    parts.push(band)
  }
  const lock = piece(
    width * 0.16,
    height * 0.22,
    0.1,
    palette.accent,
    {
      position: { x: 0, y: 0.28 + height * 0.42, z: depth * 0.54 },
      rotation: { x: 0, y: variation.signed(0.16), z: 0 },
    },
  )
  shade(lock, tone(palette.accent, -0.3), palette.accent, 1)
  parts.push(lock)

  const geometry = mergeAll(parts, { name: options.name ?? 'prop-chest' })
  bakeSkyOcclusion(geometry, { strength: 0.26 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: 0.4 })
  return [propPart(geometry, 'hard')]
}

/** A haystack with a leaning pole and a tied top. */
export function haystackParts(
  options: PropOptions & { radius?: number; height?: number },
): PropPart[] {
  const palette = options.palette
  const variation = options.variation
  const radius = options.radius ?? 0.85
  const height = options.height ?? 1.85
  const lean = variation.signed(0.1)
  const stack = loftProfile({
    profile: polygonProfile(radius, 7, variation.angle()),
    sections: [
      { y: 0, scaleX: 0.84 },
      { y: height * 0.16, scaleX: 1 },
      { y: height * 0.55, scaleX: 0.86, offsetX: lean * 0.5 },
      { y: height * 0.84, scaleX: 0.5, offsetX: lean },
      { y: height, scaleX: 0.16, offsetX: lean * 1.3 },
    ],
    name: 'haystack',
  })
  displaceGeometry(stack, {
    seed: options.noiseSeed,
    amplitude: radius * 0.07,
    frequency: 3.6,
    octaves: 2,
    mode: 'ridge',
    flatBase: height * 0.1,
  })
  shade(stack, tone(palette.accent, -0.42), palette.accent, 0.8)
  const pole = piece(
    0.1,
    height * 1.16,
    0.1,
    palette.timber,
    { position: { x: radius * 0.2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: -0.05 } },
    { topScale: 0.5 },
  )
  shade(pole, palette.timberShade, palette.timber, 0.9)
  const tie = loftProfile({
    profile: polygonProfile(radius * 0.56, 7),
    sections: [
      { y: 0, scaleX: 1 },
      { y: 0.1, scaleX: 0.94 },
    ],
    name: 'haystack-tie',
  })
  transformed(tie, { position: { x: lean * 0.7, y: height * 0.66, z: 0 } })
  shade(tie, palette.timberShade, palette.timber, 1)

  const geometry = mergeAll([stack, pole, tie], {
    name: options.name ?? 'prop-haystack',
  })
  bakeSkyOcclusion(geometry, { strength: 0.24 })
  bakeVerticalOcclusion(geometry, { strength: 0.3, falloff: height * 0.35 })
  return [propPart(geometry, 'hard')]
}

/** A carved standing pillar. The palace lands' repeating vertical. */
export function pillarParts(
  options: PropOptions & { height?: number; radius?: number },
): PropPart[] {
  const palette = options.palette
  const height = options.height ?? 2.8
  const radius = options.radius ?? 0.44
  const shaft = latheProfile(
    [
      { x: 0.001, y: 0 },
      { x: radius * 1.68, y: 0 },
      { x: radius * 1.5, y: 0.16 },
      { x: radius * 1.1, y: 0.32 },
      { x: radius, y: height * 0.72 },
      { x: radius * 1.28, y: height * 0.86 },
      { x: radius * 1.5, y: height * 0.94 },
      { x: radius * 1.42, y: height },
      { x: 0.001, y: height * 1.02 },
    ],
    { segments: 9, name: 'pillar' },
  )
  shade(shaft, palette.stoneShade, palette.stone, 0.75)
  mottle(shaft, options.noiseSeed, 0.08, 1.4)
  bakeVerticalOcclusion(shaft, { strength: 0.28, falloff: height * 0.28 })
  bakeSkyOcclusion(shaft, { strength: 0.22 })
  return [propPart(shaft, 'hard')]
}
// ---------------------------------------------------------------------------
// Ground cover
// ---------------------------------------------------------------------------

export type GroundCoverKind = 'fern' | 'flower' | 'grass' | 'pebble'

export interface GroundCoverPalette {
  low: THREE.ColorRepresentation
  high: THREE.ColorRepresentation
  bloom: THREE.ColorRepresentation
  bloomHigh: THREE.ColorRepresentation
  stone: THREE.ColorRepresentation
  stoneHigh: THREE.ColorRepresentation
}

export interface GroundCoverOptions {
  variation: ArtVariation
  noiseSeed: number
  palette: GroundCoverPalette
  name?: string
}

/**
 * Ground cover.
 *
 * All four kinds share one vertex-coloured material per biome, so each builder bakes
 * its own colour ramp — a tuft that is dark at the root and bright at the tip costs
 * nothing at runtime and does more for readability than any texture would at this
 * size. Every instance of a kind shares one buffer for the entire world, so the tuft
 * is allowed to be five blades instead of three.
 */
export function groundCoverGeometry(
  kind: GroundCoverKind,
  options: GroundCoverOptions,
): THREE.BufferGeometry {
  const geometry = buildGroundCover(kind, options)
  geometry.name = options.name ?? `prop-ground-${kind}`
  return geometry
}

function buildGroundCover(
  kind: GroundCoverKind,
  options: GroundCoverOptions,
): THREE.BufferGeometry {
  if (kind === 'grass') return grassTuftGeometry(options)
  if (kind === 'fern') return fernGeometry(options)
  if (kind === 'flower') return flowerGeometry(options)
  return pebbleGeometry(options)
}

function grassTuftGeometry(options: GroundCoverOptions): THREE.BufferGeometry {
  const variation = options.variation
  const blades: THREE.BufferGeometry[] = []
  const count = 5
  for (let index = 0; index < count; index += 1) {
    const rotation = (index / count) * Math.PI * 2 + variation.signed(0.5)
    const height = variation.range(0.38, 0.78)
    const lean = variation.signed(0.26)
    const blade = loftProfile({
      profile: rectProfile(0.075, 0.018),
      sections: [
        { y: 0, scaleX: 1, scaleZ: 1 },
        { y: height * 0.45, scaleX: 0.72, offsetX: lean * 0.4 },
        { y: height, scaleX: 0.08, offsetX: lean },
      ],
      name: `grass-blade-${String(index)}`,
    })
    transformed(blade, {
      rotation: { x: 0, y: rotation, z: 0 },
      position: { x: variation.signed(0.06), y: 0, z: variation.signed(0.06) },
    })
    shade(blade, options.palette.low, options.palette.high, 0.7)
    blades.push(blade)
  }
  return mergeAll(blades, { name: 'prop-grass-tuft' })
}

function fernGeometry(options: GroundCoverOptions): THREE.BufferGeometry {
  const vertices: number[] = []
  for (let frond = 0; frond < 5; frond += 1) {
    const angle = (frond / 5) * Math.PI * 2
    const outwardX = Math.sin(angle)
    const outwardZ = Math.cos(angle)
    const sideX = Math.cos(angle)
    const sideZ = -Math.sin(angle)
    const point = (
      side: number,
      outward: number,
      y: number,
    ): [number, number, number] => [
      sideX * side + outwardX * outward,
      y,
      sideZ * side + outwardZ * outward,
    ]
    const baseLeft = point(-0.025, 0, 0)
    const baseRight = point(0.025, 0, 0)
    const middleLeft = point(-0.11, 0.2, 0.32)
    const middleRight = point(0.11, 0.2, 0.32)
    const outerLeft = point(-0.06, 0.34, 0.5)
    const outerRight = point(0.06, 0.34, 0.5)
    const tip = point(0, 0.42, 0.68)
    vertices.push(
      ...baseLeft,
      ...baseRight,
      ...middleRight,
      ...baseLeft,
      ...middleRight,
      ...middleLeft,
      ...middleLeft,
      ...middleRight,
      ...outerRight,
      ...middleLeft,
      ...outerRight,
      ...outerLeft,
      ...outerLeft,
      ...outerRight,
      ...tip,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  )
  geometry.computeVertexNormals()
  geometry.name = 'prop-fern'
  return shade(geometry, options.palette.low, options.palette.high, 0.65)
}

function flowerGeometry(options: GroundCoverOptions): THREE.BufferGeometry {
  const variation = options.variation
  const parts: THREE.BufferGeometry[] = []
  // Two stems of different heights. A single bloom reads as a mistake in the
  // instance grid; a pair reads as a plant.
  for (let index = 0; index < 2; index += 1) {
    const height = variation.range(0.4, 0.6)
    const lean = variation.signed(0.06)
    const offsetX = variation.signed(0.09)
    const offsetZ = variation.signed(0.09)
    const stem = loftProfile({
      profile: polygonProfile(0.028, 5),
      sections: [
        { y: 0, scaleX: 1.2 },
        { y: height * 0.55, scaleX: 0.85, offsetX: lean },
        { y: height, scaleX: 0.7, offsetX: lean * 1.8 },
      ],
      name: `flower-stem-${String(index)}`,
    })
    transformed(stem, { position: { x: offsetX, y: 0, z: offsetZ } })
    shade(stem, options.palette.low, options.palette.high, 1)
    const bloom = transformed(
      loftProfile({
        profile: polygonProfile(0.13, 6, variation.angle()),
        sections: [
          { y: 0, scaleX: 0.2 },
          { y: 0.05, scaleX: 1 },
          { y: 0.11, scaleX: 0.55 },
        ],
        name: `flower-bloom-${String(index)}`,
      }),
      { position: { x: offsetX + lean * 1.8, y: height, z: offsetZ } },
    )
    shade(bloom, options.palette.bloom, options.palette.bloomHigh, 0.6)
    parts.push(stem, bloom)
  }
  return mergeAll(parts, { name: 'prop-flower' })
}

function pebbleGeometry(options: GroundCoverOptions): THREE.BufferGeometry {
  const variation = options.variation
  const parts: THREE.BufferGeometry[] = []
  const count = variation.integer(2, 4)
  for (let index = 0; index < count; index += 1) {
    const size = variation.range(0.11, 0.2)
    const stone = loftProfile({
      profile: polygonProfile(size, 5, variation.angle()),
      sections: [
        { y: 0, scaleX: 1 },
        { y: size * variation.range(0.6, 1.1), scaleX: variation.range(0.3, 0.66) },
      ],
      name: `pebble-${String(index)}`,
    })
    transformed(stone, {
      position: {
        x: variation.signed(0.16),
        y: 0,
        z: variation.signed(0.16),
      },
      rotation: { x: variation.signed(0.2), y: variation.angle(), z: variation.signed(0.2) },
    })
    const stoneTone = variation.range(-0.16, 0.16)
    shade(
      stone,
      tone(options.palette.stone, stoneTone),
      tone(options.palette.stoneHigh, stoneTone),
      0.8,
    )
    parts.push(stone)
  }
  const geometry = mergeAll(parts, { name: 'prop-pebble' })
  displaceGeometry(geometry, {
    seed: options.noiseSeed,
    amplitude: 0.018,
    frequency: 7,
    octaves: 2,
    mode: 'ridge',
  })
  return geometry
}


