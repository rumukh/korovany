import * as THREE from 'three'
import {
  GeometryCache,
  PROP_SURFACES,
  artNoiseSeed,
  artVariation,
  bannerParts,
  barrelGeometry,
  brazierParts,
  bridgeParts,
  buildingParts,
  bushGeometry,
  cairnGeometry,
  cartParts,
  chestParts,
  crateGeometry,
  deadfallGeometry,
  fencePanelParts,
  gateParts,
  groundCoverGeometry,
  haystackParts,
  lanternPostParts,
  marketStallParts,
  mergePropParts,
  monumentParts,
  obeliskParts,
  outcropGeometry,
  pillarParts,
  propPart,
  reedClusterGeometry,
  screeGeometry,
  shrineParts,
  signboardParts,
  strataRockGeometry,
  stumpGeometry,
  tentParts,
  towerParts,
  treeGeometry,
  washingLineParts,
  waystoneParts,
  wellParts,
  woodpileGeometry,
  type ArtVariation,
  type BuildingPalette,
  type FenceStyle,
  type GroundCoverKind,
  type GroundCoverPalette,
  type PropPalette,
  type PropPart,
  type PropSurface,
  type RockPalette,
  type TreePalette,
  type TreeSpecies,
} from '../art/index.ts'
import type { ZoneId } from '../types.ts'
import {
  buildingSpecKey,
  type BuildingSpec,
  type SitePropKind,
} from './SiteComposition.ts'
import type { Territory } from './worldTypes.ts'

/**
 * The world's shared prop catalogue.
 *
 * Two rules decide everything in this file.
 *
 * **Shared props are built from a constant seed.** A forest tree is visible in three
 * streamed regions at once and drawn a hundred times; it has to be *one* buffer.
 * Variation therefore lives in the cache *key*, not in the world seed: the key
 * selects which of the twelve tree species/biome combinations you get, and the
 * geometry for a given key is byte-identical in every world. Layout — which key goes
 * where, at what angle and scale — is what the world seed varies.
 *
 * **Lifetime is reference counted.** `acquire` hands out an asset holding one cache
 * key per surface; `release` drops exactly those keys. A region that loads, unloads
 * and reloads must end where it started, which is what `tests/worldArt.test.ts`
 * asserts.
 */

/** Fixed seed for every shared prop. Never derive this from the world seed. */
const PROP_ART_SEED = 'korovany:props'

export type PropDetail = 'near' | 'far'

export interface PropSurfaceGeometry {
  surface: PropSurface
  geometry: THREE.BufferGeometry
  key: string
}

export interface PropAsset {
  key: string
  surfaces: PropSurfaceGeometry[]
}

export type PropRequest =
  | { kind: 'tree'; biome: ZoneId; slot: number; detail: PropDetail }
  | { kind: 'undergrowth'; biome: ZoneId; slot: number }
  | { kind: 'rock'; biome: ZoneId; slot: number; detail: PropDetail }
  | { kind: 'reeds'; biome: ZoneId }
  | { kind: 'groundCover'; biome: ZoneId; cover: GroundCoverKind }
  | {
      kind: 'building'
      spec: BuildingSpec
      biome: ZoneId
      owner: Territory
      detail: PropDetail
    }
  | {
      kind: 'siteProp'
      prop: SitePropKind
      biome: ZoneId
      owner: Territory
      variant: number
      length?: number
    }
  | {
      kind: 'fence'
      style: FenceStyle
      biome: ZoneId
      owner: Territory
      length: number
    }
  | {
      kind: 'bridge'
      biome: ZoneId
      owner: Territory
      span: number
      width: number
      detail: PropDetail
    }

/**
 * Keys the retention window holds by default, and the dominant term in the live cache
 * budget.
 *
 * Exported because the budget assertion in `tests/worldArt.test.ts` used to be a bare
 * `176` citing a `PROP_CACHE_ENTRIES_MAX` that exists in no code — a number descended
 * from a constant governing the *other* geometry cache entirely. A budget with no
 * mechanical link to the thing that determines it silently stops meaning anything the
 * moment that thing changes.
 */
export const PROP_RETENTION_DEFAULT = 128

/**
 * Live entries a full set of resident regions can hold beyond the window.
 *
 * `visibleRadius: 1` under Chebyshev distance keeps 9 regions resident, and their
 * in-use keys are almost entirely already pinned by the window — measured peak across
 * a full-sweep lap is 130 total against a 128-key window, so only a couple of entries
 * are genuinely outside it. The allowance is deliberately far above that: it is a
 * ceiling that catches unbounded growth, not a fit to the current figure.
 */
export const PROP_RESIDENT_HEADROOM = 48

export class WorldPropLibrary {
  private readonly cache = new GeometryCache()
  /**
   * Recently released keys, newest last, at most one entry per key.
   *
   * Region streaming is a sliding window: walking one region east unloads three
   * regions and reloads them the moment the player turns around. Dropping the last
   * reference the instant a region unloads means rebuilding a settlement — lathes,
   * seeded noise, welded outline normals and all — every time the player crosses a
   * boundary twice. Holding the last `retentionLimit` released keys turns that into
   * a map lookup, at a bounded and measurable memory cost.
   *
   * The one-entry-per-key invariant is the whole value of the window. A forest tree
   * is released by every region that unloads holding it, so pushing blindly spent
   * three slots on one geometry and left the window covering roughly half the keys
   * it advertised. Surplus references are handed straight back to the cache
   * instead, which is safe precisely because the entry already in the window is
   * still pinning the geometry.
   */
  private readonly retained: string[] = []
  private readonly retentionLimit: number

  constructor(options: { retention?: number } = {}) {
    this.retentionLimit = Math.max(0, Math.floor(options.retention ?? PROP_RETENTION_DEFAULT))
  }

  /** Live cache entries, including geometry held only by the retention window. */
  get size(): number {
    return this.cache.size
  }

  /** Entries kept alive purely so a returning region does not rebuild them. */
  get retainedCount(): number {
    return this.retained.length
  }

  /**
   * True while every retained key still has a live cache entry to pin.
   *
   * A *phantom pin* is a key sitting in the window with no entry behind it. It occupies
   * a slot, pins nothing, and releases nothing on eviction, so the window silently
   * covers fewer keys than it advertises — and worse, retaining one at the limit evicts
   * a real key, actively displacing the geometry the window exists to keep.
   *
   * This is asserted directly because the obvious indirect form does not work. Checking
   * `cacheSize >= retainedCount` looks equivalent — every real pin has an entry, so the
   * cache cannot be smaller than the window — but `cacheSize` also counts entries held
   * only by live borrowers, and those mask a phantom deficit one for one. With `B`
   * borrower-only entries the comparison reduces to `B >= P`, so it fires only once
   * phantoms outnumber `B`. Measured mid-stream: `B = 28`, and the comparison first
   * detected at **29 phantoms** while this predicate detects at 1. A real phantom bug
   * introduces a handful, not thirty.
   *
   * Found by a reviewer who measured the weakened form before accepting it as
   * equivalent to the one they had proposed.
   */
  get retentionIsIntact(): boolean {
    return this.retained.every((key) => this.cache.has(key))
  }

  referenceCount(key: string): number {
    return this.cache.referenceCount(key)
  }

  /**
   * Builds on first use and shares afterwards.
   *
   * The returned asset is the caller's receipt: hand the same object back to
   * {@link release} exactly once.
   */
  acquire(request: PropRequest): PropAsset {
    const canonical = canonicalRequest(request)
    const key = describeRequest(canonical)
    return this.acquireKeyed(key, surfaceLayout(canonical), () =>
      buildParts(canonical, key),
    )
  }

  /**
   * Shares a one-off composition — a settlement's merged props, a region's road
   * furniture — under a caller-chosen key.
   *
   * The surface list has to be known before the first build, because the cache
   * stores one geometry per key and a second `acquire` must not have to rebuild the
   * whole thing just to discover what came out. {@link sitePropSurfaces} derives it
   * from the composed layout.
   */
  acquireComposite(
    key: string,
    surfaces: readonly PropSurface[],
    build: () => PropPart[],
  ): PropAsset {
    return this.acquireKeyed(key, surfaces, build)
  }

  private acquireKeyed(
    key: string,
    layout: readonly PropSurface[],
    build: () => PropPart[],
  ): PropAsset {
    // Built at most once for the whole asset, and only if some surface is missing
    // from the cache. Building per surface would run the lathes and the noise once
    // per draw group, which is what the first version of this did.
    let pending: Map<PropSurface, THREE.BufferGeometry> | null = null
    const take = (surface: PropSurface): THREE.BufferGeometry => {
      if (!pending) {
        pending = new Map()
        for (const entry of mergePropParts(build(), { name: key })) {
          pending.set(entry.surface, entry.geometry)
        }
      }
      const geometry = pending.get(surface)
      if (!geometry) {
        throw new Error(`Prop ${key} produced no ${surface} surface`)
      }
      // Ownership moves to the cache; anything left over is disposed below.
      pending.delete(surface)
      return geometry
    }

    const surfaces: PropSurfaceGeometry[] = []
    try {
      for (const surface of layout) {
        const surfaceKey = `${key}#${surface}`
        // Acquire *before* dropping the retention pin. Releasing first would take the
        // reference count to zero, dispose the geometry the window exists to
        // preserve, and rebuild it on the very next line.
        const geometry = this.cache.acquire(surfaceKey, () => take(surface))
        this.unretain(surfaceKey)
        surfaces.push({ surface, geometry, key: surfaceKey })
      }
    } catch (error) {
      // A half-acquired asset never reaches the caller, so nothing would ever release
      // the references it already took. Give them back before rethrowing.
      for (const acquired of surfaces) this.cache.release(acquired.key)
      this.disposePending(pending)
      throw error
    }
    this.disposePending(pending)
    return { key, surfaces }
  }

  /** Frees whatever a build produced that no cache key claimed. */
  private disposePending(
    pending: Map<PropSurface, THREE.BufferGeometry> | null,
  ): void {
    if (!pending) return
    for (const geometry of pending.values()) geometry.dispose()
    pending.clear()
  }

  /**
   * Receipts already handed back.
   *
   * `GeometryCache.release(key)` cannot detect a double release, because a key has no
   * holder identity: A releasing twice while B is still drawing leaves the reference
   * count at 1, so the release is *effective* and steals B's reference silently. A
   * receipt does have identity, so the fault is exactly "this asset came back twice"
   * and it can be caught at the boundary rather than inferred from a count later.
   */
  private readonly returned = new WeakSet<PropAsset>()

  release(asset: PropAsset): void {
    if (this.returned.has(asset)) {
      throw new Error(
        `Prop asset ${asset.key} was released twice; the second release takes a `
        + 'reference belonging to another holder, which frees a buffer still in use',
      )
    }
    this.returned.add(asset)
    for (const surface of asset.surfaces) this.retain(surface.key)
  }

  /**
   * Builds a prop without caching it.
   *
   * Used inside a composite build callback, where the parts are about to have a
   * transform baked into them and merged into their settlement's mesh. Handing out
   * a shared buffer to a caller that is going to mutate it is the one thing the
   * cache must never do.
   *
   * The returned parts are the caller's to merge or dispose.
   */
  build(request: PropRequest): PropPart[] {
    const canonical = canonicalRequest(request)
    return buildParts(canonical, describeRequest(canonical))
  }

  dispose(): void {
    this.retained.length = 0
    this.cache.dispose()
  }

  /** Takes over the caller's reference rather than dropping it. */
  private retain(key: string): void {
    if (this.retentionLimit === 0) {
      this.cache.release(key)
      return
    }
    const existing = this.retained.indexOf(key)
    if (existing >= 0) {
      // Already pinned. Give this reference back rather than spending a second slot
      // on a geometry one slot already keeps alive, and move the key to the newest
      // end so a shared prop is not evicted while it is still in circulation.
      this.cache.release(key)
      this.retained.splice(existing, 1)
      this.retained.push(key)
      return
    }
    this.retained.push(key)
    while (this.retained.length > this.retentionLimit) {
      const evicted = this.retained.shift()
      if (evicted !== undefined) this.cache.release(evicted)
    }
  }

  /** Hands a retained reference back to a caller that is acquiring the key again. */
  private unretain(key: string): void {
    const index = this.retained.indexOf(key)
    if (index < 0) return
    this.retained.splice(index, 1)
    this.cache.release(key)
  }
}

/** Which surfaces a composed set of site props will produce. */
export function sitePropSurfaces(
  kinds: readonly SitePropKind[],
): PropSurface[] {
  const wanted = new Set<PropSurface>()
  for (const kind of kinds) {
    for (const surface of SITE_PROP_SURFACES[kind]) wanted.add(surface)
  }
  return PROP_SURFACES.filter((surface) => wanted.has(surface))
}

/**
 * Which surfaces a request produces, decided *before* the geometry is built.
 *
 * The cache stores one geometry per key, so a prop with a cloth awning and a glowing
 * pane needs three keys — and the caller has to know how many before the first build
 * runs, or the second acquire would rebuild everything to find out.
 */
function surfaceLayout(request: PropRequest): PropSurface[] {
  switch (request.kind) {
    case 'tree':
    case 'undergrowth':
    case 'reeds':
    case 'groundCover':
      return ['foliage']
    case 'rock':
      return ['hard']
    case 'fence':
      return ['hard']
    case 'bridge':
      return ['hard']
    case 'building':
      return request.detail === 'far' || request.spec.windows === 0
        ? ['hard']
        : ['hard', 'glow']
    default:
      return SITE_PROP_SURFACES[request.prop]
  }
}

const SITE_PROP_SURFACES: Record<SitePropKind, PropSurface[]> = {
  banner: ['hard', 'cloth'],
  barrel: ['hard'],
  brazier: ['hard', 'glow'],
  cairn: ['hard'],
  cart: ['hard', 'cloth'],
  chest: ['hard'],
  crate: ['hard'],
  gate: ['hard', 'cloth'],
  lantern: ['hard', 'glow'],
  monument: ['hard'],
  obelisk: ['hard', 'glow'],
  pillar: ['hard'],
  shrine: ['hard', 'cloth', 'glow'],
  signboard: ['hard'],
  stall: ['hard', 'cloth'],
  tent: ['hard', 'cloth'],
  tower: ['hard'],
  'washing-line': ['hard', 'cloth'],
  waystone: ['hard'],
  well: ['hard'],
  woodpile: ['hard'],
}

function describeRequest(request: PropRequest): string {
  switch (request.kind) {
    case 'tree':
      return `tree:${request.biome}:${String(request.slot)}:${request.detail}`
    case 'undergrowth':
      return `undergrowth:${request.biome}:${String(request.slot)}`
    case 'rock':
      return `rock:${request.biome}:${String(request.slot)}:${request.detail}`
    case 'reeds':
      return `reeds:${request.biome}`
    case 'groundCover':
      return `ground:${request.biome}:${request.cover}`
    case 'building':
      return `${buildingSpecKey(request.spec, request.biome, request.owner)}:${request.detail}`
    case 'fence':
      return `fence:${request.biome}:${request.owner}:${request.style}:${quantize(
        request.length,
      ).toFixed(1)}`
    case 'bridge':
      return `bridge:${request.biome}:${request.owner}:${quantize(
        request.span,
      ).toFixed(1)}:${quantize(request.width).toFixed(1)}:${request.detail}`
    default:
      return `siteprop:${request.biome}:${request.owner}:${request.prop}:${String(
        request.variant,
      )}${request.length === undefined ? '' : `:${quantize(request.length).toFixed(1)}`}`
  }
}

/** Snaps a dimension so near-identical props collapse onto one cached buffer. */
function quantize(value: number): number {
  return Math.round(value * 2) / 2
}

/**
 * Rounds a request's free dimensions to the same grid the cache key uses.
 *
 * The key quantizes: a fence 5.1 long and one 5.2 long are the same key. If the
 * *builder* still saw the raw number, the geometry behind that key would depend on
 * which request happened to build it first — a load-order dependency masquerading as
 * a shared buffer. Canonicalizing first is what makes "geometry is a pure function of
 * the key" actually true.
 */
function canonicalRequest(request: PropRequest): PropRequest {
  switch (request.kind) {
    case 'fence':
      return { ...request, length: quantize(request.length) }
    case 'bridge':
      return {
        ...request,
        span: quantize(request.span),
        width: quantize(request.width),
      }
    case 'siteProp':
      return request.length === undefined
        ? request
        : { ...request, length: quantize(request.length) }
    default:
      return request
  }
}

function buildParts(request: PropRequest, key: string): PropPart[] {
  const variation = artVariation(PROP_ART_SEED, key)
  const noiseSeed = artNoiseSeed(PROP_ART_SEED, key)
  switch (request.kind) {
    case 'tree': {
      const species = treeSpecies(request.biome, request.slot)
      const profile = TREE_PROFILES[request.biome]
      return [
        propPart(
          treeGeometry(species, {
            variation,
            noiseSeed,
            palette: profile.palette,
            height: profile.height * SPECIES_HEIGHT[species],
            detail: request.detail,
            name: key,
          }),
          'foliage',
        ),
      ]
    }
    case 'undergrowth':
      return [propPart(buildUndergrowth(request.biome, request.slot, variation, noiseSeed, key), 'foliage')]
    case 'rock':
      return [
        propPart(
          buildRock(request.biome, request.slot, request.detail, variation, noiseSeed, key),
          'hard',
        ),
      ]
    case 'reeds':
      return [
        propPart(
          reedClusterGeometry({
            variation,
            noiseSeed,
            low: 0x28401e,
            high: 0xa8b556,
            height: 1.35,
            name: key,
          }),
          'foliage',
        ),
      ]
    case 'groundCover':
      return [
        propPart(
          groundCoverGeometry(request.cover, {
            variation,
            noiseSeed,
            palette: groundCoverPalette(request.biome),
            name: key,
          }),
          'foliage',
        ),
      ]
    case 'building':
      return buildingParts({
        variation,
        noiseSeed,
        palette: buildingPalette(request.biome, request.owner),
        width: request.spec.width,
        depth: request.spec.depth,
        wallHeight: request.spec.wallHeight,
        storeys: request.spec.storeys,
        wallStyle: request.spec.wallStyle,
        roofStyle: request.spec.roofStyle,
        windows: request.spec.windows,
        chimney: request.spec.chimney,
        porch: request.spec.porch,
        balcony: request.spec.balcony,
        crenellated: request.spec.crenellated,
        lit: true,
        detail: request.detail,
        name: key,
      })
    case 'fence':
      return fencePanelParts({
        variation,
        noiseSeed,
        palette: propPalette(request.biome, request.owner),
        style: request.style,
        length: request.length,
        name: key,
      })
    case 'bridge':
      return bridgeParts({
        variation,
        noiseSeed,
        palette: propPalette(request.biome, request.owner),
        span: request.span,
        width: request.width,
        style: request.biome === 'palace' || request.biome === 'fort' ? 'stone' : 'timber',
        detail: request.detail,
        name: key,
      })
    default:
      return buildSiteProp(request.prop, {
        variation,
        noiseSeed,
        palette: propPalette(request.biome, request.owner),
        name: key,
        length: request.length,
      })
  }
}

interface SitePropContext {
  variation: ArtVariation
  noiseSeed: number
  palette: PropPalette
  name: string
  length?: number
}

function buildSiteProp(kind: SitePropKind, context: SitePropContext): PropPart[] {
  const base = {
    variation: context.variation,
    noiseSeed: context.noiseSeed,
    palette: context.palette,
    name: context.name,
  }
  switch (kind) {
    case 'banner':
      return bannerParts(base)
    case 'barrel':
      return [propPart(barrelGeometry(base), 'hard')]
    case 'brazier':
      return brazierParts(base)
    case 'cairn':
      return [
        propPart(
          cairnGeometry({
            variation: context.variation,
            noiseSeed: context.noiseSeed,
            palette: {
              low: context.palette.stoneShade,
              high: context.palette.stone,
            },
            name: context.name,
          }),
          'hard',
        ),
      ]
    case 'cart':
      return cartParts(base)
    case 'chest':
      return chestParts(base)
    case 'crate':
      return [propPart(crateGeometry(base), 'hard')]
    case 'gate':
      return gateParts({ ...base, width: context.length ?? 3.2 })
    case 'lantern':
      return lanternPostParts(base)
    case 'monument':
      return monumentParts(base)
    case 'obelisk':
      return obeliskParts(base)
    case 'pillar':
      return pillarParts(base)
    case 'shrine':
      return shrineParts(base)
    case 'signboard':
      return signboardParts(base)
    case 'stall':
      return marketStallParts(base)
    case 'tent':
      return tentParts(base)
    case 'tower':
      return towerParts({ ...base, roof: true })
    case 'washing-line':
      return washingLineParts(base)
    case 'waystone':
      return waystoneParts(base)
    case 'well':
      return wellParts(base)
    default:
      return [propPart(woodpileGeometry(base), 'hard')]
  }
}

// ---------------------------------------------------------------------------
// Biome and territory palettes
// ---------------------------------------------------------------------------

interface TreeProfile {
  palette: TreePalette
  height: number
  species: readonly TreeSpecies[]
}

const SPECIES_HEIGHT: Record<TreeSpecies, number> = {
  conifer: 1,
  broadleaf: 0.86,
  slender: 1.14,
  dead: 0.78,
  topiary: 0.54,
  thorn: 0.46,
}

/**
 * Three species per biome, chosen so a stand has a varied skyline.
 *
 * The fort lands get two and no third: nothing much grows there, and the gap is
 * filled with rock, which is the point.
 */
const TREE_PROFILES: Record<ZoneId, TreeProfile> = {
  neutral: {
    palette: {
      bark: 0x8a6b48,
      barkShade: 0x4a3524,
      canopyLow: 0x3f5a24,
      canopyHigh: 0x9dbb59,
    },
    height: 4.6,
    species: ['broadleaf', 'slender', 'conifer'],
  },
  palace: {
    palette: {
      bark: 0x7e7566,
      barkShade: 0x413c34,
      canopyLow: 0x24402e,
      canopyHigh: 0x6d9366,
    },
    height: 4.4,
    species: ['topiary', 'slender', 'conifer'],
  },
  forest: {
    palette: {
      bark: 0x7a5a3a,
      barkShade: 0x33241a,
      canopyLow: 0x1c3a28,
      canopyHigh: 0x64a355,
    },
    height: 6.2,
    species: ['conifer', 'broadleaf', 'slender'],
  },
  fort: {
    palette: {
      bark: 0x554c48,
      barkShade: 0x241f1e,
      canopyLow: 0x2a2320,
      canopyHigh: 0x5c4a40,
    },
    height: 4,
    species: ['dead', 'thorn'],
  },
}

function treeSpecies(biome: ZoneId, slot: number): TreeSpecies {
  const species = TREE_PROFILES[biome].species
  return species[Math.abs(Math.floor(slot)) % species.length]
}

const UNDERGROWTH_SLOTS: Record<ZoneId, readonly string[]> = {
  neutral: ['bush', 'haystack', 'stump'],
  palace: ['bush', 'stump'],
  forest: ['bush', 'stump', 'deadfall'],
  fort: ['bush', 'deadfall'],
}

function buildUndergrowth(
  biome: ZoneId,
  slot: number,
  variation: ArtVariation,
  noiseSeed: number,
  key: string,
): THREE.BufferGeometry {
  const slots = UNDERGROWTH_SLOTS[biome]
  const chosen = slots[Math.abs(Math.floor(slot)) % slots.length]
  const trees = TREE_PROFILES[biome]
  if (chosen === 'stump') {
    return stumpGeometry({
      variation,
      noiseSeed,
      low: trees.palette.barkShade,
      high: trees.palette.bark,
      name: key,
    })
  }
  if (chosen === 'deadfall') {
    return deadfallGeometry({
      variation,
      noiseSeed,
      low: trees.palette.barkShade,
      high: trees.palette.bark,
      radius: 0.28,
      height: 3,
      name: key,
    })
  }
  if (chosen === 'haystack') {
    const parts = haystackParts({
      variation,
      noiseSeed,
      palette: propPalette(biome, 'neutral'),
      name: key,
    })
    // Select by surface rather than by index. A haystack is one `hard` part today,
    // but an index-0 assumption would silently drop and mis-tag geometry the day it
    // grows a second one.
    const merged = mergePropParts(parts, { name: key })
    const body = merged.find((entry) => entry.surface === 'hard')
    for (const entry of merged) {
      if (entry !== body) entry.geometry.dispose()
    }
    if (!body) throw new Error(`Haystack ${key} produced no hard surface`)
    return body.geometry
  }
  return bushGeometry({
    variation,
    noiseSeed,
    low: trees.palette.canopyLow,
    high: trees.palette.canopyHigh,
    radius: biome === 'fort' ? 0.5 : 0.72,
    height: biome === 'fort' ? 0.5 : 0.8,
    name: key,
  })
}

interface RockProfile {
  palette: RockPalette
  radius: number
  height: number
  slots: readonly ('strata' | 'outcrop' | 'scree' | 'cairn')[]
}

/**
 * Weathering per biome.
 *
 * Moss in the forest, pale lichen at the palace, ash in the fort, dry dust in the
 * neutral lands. One vertex-colour term, four completely different rocks.
 */
const ROCK_PROFILES: Record<ZoneId, RockProfile> = {
  neutral: {
    palette: { low: 0x4b463c, high: 0x9d9686, cap: 0xa89a70, capStrength: 0.28 },
    radius: 1,
    height: 1.1,
    slots: ['strata', 'scree'],
  },
  palace: {
    palette: { low: 0x5b5f66, high: 0xc2c4c0, cap: 0xb9c2b4, capStrength: 0.32 },
    radius: 1.05,
    height: 1.3,
    slots: ['strata', 'cairn'],
  },
  forest: {
    palette: { low: 0x36402f, high: 0x8d9484, cap: 0x4c7a3c, capStrength: 0.6 },
    radius: 1.1,
    height: 1.2,
    slots: ['strata', 'scree'],
  },
  fort: {
    palette: { low: 0x24252b, high: 0x767f88, cap: 0x8b8377, capStrength: 0.42 },
    radius: 1.35,
    height: 1.7,
    slots: ['strata', 'outcrop', 'scree'],
  },
}

function buildRock(
  biome: ZoneId,
  slot: number,
  detail: PropDetail,
  variation: ArtVariation,
  noiseSeed: number,
  key: string,
): THREE.BufferGeometry {
  const profile = ROCK_PROFILES[biome]
  const chosen = profile.slots[Math.abs(Math.floor(slot)) % profile.slots.length]
  const options = {
    variation,
    noiseSeed,
    palette: profile.palette,
    radius: profile.radius,
    height: profile.height,
    detail,
    name: key,
  }
  if (chosen === 'outcrop') {
    return outcropGeometry({ ...options, radius: profile.radius * 1.7, height: profile.height * 1.9 })
  }
  if (chosen === 'scree') {
    return screeGeometry({ ...options, radius: profile.radius * 1.1 })
  }
  if (chosen === 'cairn') {
    return cairnGeometry({ ...options, radius: profile.radius * 0.42, height: profile.height * 0.9 })
  }
  return strataRockGeometry(options)
}

interface TerritoryColors {
  cloth: number
  clothAccent: number
  accent: number
  metal: number
  glow: number
}

const TERRITORY_COLORS: Record<Territory, TerritoryColors> = {
  elf: {
    cloth: 0x2f6d4a,
    clothAccent: 0xd8c47a,
    accent: 0x7fb46a,
    metal: 0x9a9c86,
    glow: 0xbdf0a8,
  },
  guard: {
    cloth: 0x2d4d8c,
    clothAccent: 0xd9dde6,
    accent: 0x6f8ec6,
    metal: 0x8f97a2,
    glow: 0xffd9a0,
  },
  villain: {
    cloth: 0x8c2230,
    clothAccent: 0x2a2226,
    accent: 0xb75b70,
    metal: 0x6a6266,
    glow: 0xff9a52,
  },
  neutral: {
    cloth: 0xb4682f,
    clothAccent: 0xe6d3a3,
    accent: 0xc48742,
    metal: 0x8d8a84,
    glow: 0xffc46a,
  },
}

interface BiomeMaterials {
  timber: number
  timberShade: number
  stone: number
  stoneShade: number
  wall: number
  wallShade: number
  roof: number
  roofShade: number
  roofRidge: number
  trim: number
  door: number
}

const BIOME_MATERIALS: Record<ZoneId, BiomeMaterials> = {
  neutral: {
    timber: 0x8a6a44,
    timberShade: 0x4a3524,
    stone: 0x9a9284,
    stoneShade: 0x4e4a42,
    wall: 0xd8c9a6,
    wallShade: 0x8b8062,
    roof: 0xb08a4a,
    roofShade: 0x6a4c24,
    roofRidge: 0x5c4530,
    trim: 0x9d8158,
    door: 0x5e3d26,
  },
  palace: {
    timber: 0x9c927e,
    timberShade: 0x55503f,
    stone: 0xc7c8c2,
    stoneShade: 0x6b6f74,
    wall: 0xd5d6d0,
    wallShade: 0x83878c,
    roof: 0x4b6a96,
    roofShade: 0x27374f,
    roofRidge: 0x8f98a6,
    trim: 0xb0b2ae,
    door: 0x4c5568,
  },
  forest: {
    timber: 0x7c5c38,
    timberShade: 0x3a2a1a,
    stone: 0x7f8878,
    stoneShade: 0x3d453a,
    // Warmer and lighter than the biome would naturally suggest. The forest terrain
    // and its ambient are both strongly green, and a sand wall inside that reads as
    // olive drab — an elf hut has to separate from the grass it is standing on.
    wall: 0xe0d2ae,
    wallShade: 0x968a67,
    roof: 0x5f7a3c,
    roofShade: 0x2c3f1d,
    roofRidge: 0x4a3a24,
    trim: 0x9a7b4c,
    door: 0x4a3320,
  },
  fort: {
    timber: 0x5a4a40,
    timberShade: 0x2a221e,
    stone: 0x6a6c72,
    stoneShade: 0x2e3036,
    wall: 0x7a7378,
    wallShade: 0x3a363c,
    roof: 0x4a3a3e,
    roofShade: 0x241d20,
    roofRidge: 0x5d5054,
    trim: 0x6d6266,
    door: 0x38292c,
  },
}

function buildingPalette(biome: ZoneId, owner: Territory): BuildingPalette {
  const materials = BIOME_MATERIALS[biome]
  const colors = TERRITORY_COLORS[owner]
  return {
    foundation: materials.stone,
    wall: materials.wall,
    wallShade: materials.wallShade,
    timber: materials.timber,
    roof: materials.roof,
    roofShade: materials.roofShade,
    roofRidge: materials.roofRidge,
    trim: materials.trim,
    door: materials.door,
    // Unlit glazing is nearly black on purpose: an opening has to read as a hole in
    // full daylight, and the same pane switches to the glow surface after dark.
    glass: 0x151a22,
    glow: colors.glow,
  }
}

function propPalette(biome: ZoneId, owner: Territory): PropPalette {
  const materials = BIOME_MATERIALS[biome]
  const colors = TERRITORY_COLORS[owner]
  return {
    timber: materials.timber,
    timberShade: materials.timberShade,
    stone: materials.stone,
    stoneShade: materials.stoneShade,
    metal: colors.metal,
    cloth: colors.cloth,
    clothAccent: colors.clothAccent,
    glow: colors.glow,
    accent: colors.accent,
  }
}

const GROUND_COVER_PALETTES: Record<ZoneId, GroundCoverPalette> = {
  neutral: {
    low: 0x4a5a22,
    high: 0xb6c465,
    bloom: 0xd8b23c,
    bloomHigh: 0xf4e6a8,
    stone: 0x585448,
    stoneHigh: 0x9d9686,
  },
  palace: {
    low: 0x3e4a34,
    high: 0x8fa073,
    bloom: 0x8fa8d8,
    bloomHigh: 0xe4ecf6,
    stone: 0x646a70,
    stoneHigh: 0xc0c2be,
  },
  forest: {
    low: 0x24401c,
    high: 0x9cc45c,
    bloom: 0xc86a8c,
    bloomHigh: 0xf2d6e2,
    stone: 0x38402f,
    stoneHigh: 0x8a9182,
  },
  fort: {
    low: 0x3a3a30,
    high: 0x7d7a5c,
    bloom: 0xb75b70,
    bloomHigh: 0xe0a6ae,
    stone: 0x2a2b31,
    stoneHigh: 0x7c848c,
  },
}

function groundCoverPalette(biome: ZoneId): GroundCoverPalette {
  return GROUND_COVER_PALETTES[biome]
}
