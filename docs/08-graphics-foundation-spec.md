# 08 - Procedural Graphics Foundation

> Implementation-ready foundation spec for КОРОВАНЫ. It replaces the split
> toon/standard look with one stylized material system, adds a shared procedural
> geometry toolkit under `src/game/art/`, and upgrades lighting, atmosphere and
> post-processing. It is the contract that the NPC-model pass and the world-object
> pass code against.
>
> Creative north star: **«Походный комикс, собранный кодом»** — a marching comic
> assembled from code. Bold ink, angular low-poly shapes, confident faction colour,
> readable silhouettes. Not photoreal AAA gloss, not asset-store fantasy.

## 1. Goal

Give the whole frame one coherent hand-inked look and give the two follow-up art
passes a toolkit strong enough that they never hand-roll a primitive again.

1. One material family for characters *and* world, so a screenshot reads as one
   drawing instead of two renderers sharing a camera.
2. A geometry kit that makes an angular, hand-carved silhouette cheaper to build
   than a `BoxGeometry`.
3. Ink outlines that survive non-uniform scale, hard edges and instancing, and that
   are available to important world silhouettes, not only to actors.
4. Lighting, sky, fog and grade that make silhouettes pop and stop objects from
   floating.
5. Determinism, disposal and frame budget preserved exactly as specs 01 and 05
   require.

Everything remains 100% procedural. No GLTF/FBX/OBJ, no image files, no texture
downloads, no new art dependencies. That is a product pillar, not a preference.

## 2. Scope and non-goals

### In scope

- `src/game/art/` — noise, seeded variation, geometry construction, geometry cache,
  LOD assembly, vertex-colour and vertex-AO baking, outline-normal baking.
- `StylizedArtLibrary` — one banded-toon material family over `MeshStandardMaterial`,
  shared ramps, shared outline materials, shared contact-shadow resources.
- Normal-extruded ink outlines with screen-stable thickness.
- Key/fill/rim light rig, tightened shadow frustum, painted sky gradient, tuned fog.
- Tone-mapping change and a comic grade pass behind the existing bloom toggle.
- Porting the existing characters and world meshes onto the new system.

### Out of scope

- Redesigning NPC anatomy, gear layering, faces, cloaks or animation. That belongs
  to the NPC-model pass, which builds on this kit.
- Redesigning trees, rocks, buildings, settlements or props in detail. That belongs
  to the world-object pass.
- A full-screen edge detector, SSAO, SSGI, deferred rendering or a render-graph.
- Weather, foliage wind, day/night timing, camera accents, combat FX ownership.
  Those keep their existing specs.
- Save-format compatibility. This is early alpha; world fingerprints and visual test
  expectations may change and are updated deliberately.

Spec 01 keeps ownership of the outline *policy* (what is eligible, distance culling,
the `Чернильные контуры` setting). This spec changes only the outline *technique* and
widens eligibility to explicitly registered world silhouettes.
Spec 05 keeps ownership of zone palettes, hatch motifs and the fog tint blend. Its
four-quadrant layout is historical: the game now streams a seeded 5x5 region grid and
biome identity comes from `BIOME_PROFILES`. Its material-ownership, budget and
accessibility rules still apply verbatim.

## 3. Verified baseline

| System | Current behavior |
| --- | --- |
| Characters | `GameEngine.createCharacter()` builds a person from one `BoxGeometry` torso, a sphere or cone head, two box arms, two box legs, a box blade, a cylinder helmet and cone horns. No hands, feet, faces, cloaks or gear layering. |
| Actor variation | `applyActorVisualVariation()` scales `body-pivot` by a `Math.sin` of the index and offsets torso HSL. Nothing else varies. |
| Character materials | Three shared `MeshToonMaterial`s per character from `ComicMaterialLibrary`, using one four-texel `DataTexture` ramp. |
| World materials | `GeneratedWorldRuntime.createSharedMaterials()` builds ~20 `MeshStandardMaterial`s, most carrying a 64x64 `DataTexture` from `ProceduralSurfaceTexture.ts`. |
| Trees | `forestTreeGeometry()` merges one cylinder and three cones. Rocks are a `DodecahedronGeometry`, palace dressing a cylinder, neutral dressing a cone. |
| Ground cover | `groundCoverGeometry()` returns a 3-sided cone, a hand-built fern, a cylinder+octahedron flower or a dodecahedron pebble. |
| Buildings | `addPrefabBody()` composes boxes, cones and cylinders per `SITE_PRESENTATIONS` prefab shape. |
| Outlines | `ComicMaterialLibrary.applyOutline()` clones each opaque mesh into a back-side shell scaled by `1.045` / `1.035`. Per-mesh, characters and interactables only, skipped for `InstancedMesh`. |
| Lighting | One `HemisphereLight` and one shadow-casting `DirectionalLight`, both keyframed by the day/night system. One shared torch `PointLight`. Shadow frustum is ±85 at 2048², no bias tuning. |
| Atmosphere | `createAtmosphere()` builds a three-stop canvas sky gradient on a 178-unit sphere, sun/moon discs, 220 star points and ten dodecahedron cloud groups. |
| Post | `BloomPostProcessor` owns `RenderPass -> UnrealBloomPass -> OutputPass` at strength `0.55`, radius `0.4`, threshold `0.85`, and falls back to direct rendering when bloom is off. |
| Renderer | Antialias on, DPR capped at `1.75`, `PCFSoftShadowMap`, sRGB output, ACES filmic tone mapping at exposure `0.92`. |
| Determinism | World construction draws from `RandomStream` seeded through `deriveSeed(blueprint.seed, label)`. `tests/worldGenerator.test.ts` and `WorldValidator` depend on it. `GameEngine` still has a legacy `seededRandom()` LCG used only for decorative atmosphere. |
| Lifecycle | `GameEngine.destroy()` deduplicates geometries/materials in `Set`s and skips `ComicMaterialLibrary.isLibraryOwned()` materials. `GeneratedWorldRuntime.dispose()` owns its `materials.all` and `materials.textures`. |

## 4. Design corrections

- **Do not keep two lighting models in one frame.** `MeshToonMaterial` ignores
  roughness, environment response and the hemisphere ground term the world depends
  on; `MeshStandardMaterial` ignores the band structure the characters depend on.
  One family, one ramp.
- **Do not write a bespoke `ShaderMaterial` for the stylized look.** It would lose
  shadows, fog, instancing, vertex colours, tone mapping and the day/night lights,
  and every one of those is already load-bearing. Inject into
  `MeshStandardMaterial` with `onBeforeCompile` instead and keep three.js's own
  light loop.
- **Do not band the final pixel.** Posterizing `gl_FragColor` destroys emissive FX,
  transparent particles and the sky. Band the *direct diffuse* term only, leave
  indirect/ambient smooth, and leave specular alone.
- **Do not scale outline shells uniformly.** A `1.045` scale on a 0.12 x 1.65 blade
  is a 0.005-unit line on one axis and a 0.07-unit line on another. Extrude along
  the normal in view space so thickness is a screen-space constant.
- **Do not extrude along the shading normal on merged hard-edged geometry.** Split
  vertices at a hard corner point in different directions and the hull cracks. Bake
  a welded `outlineNormal` attribute and use it when present.
- **Do not build a material per mesh.** Every helper either returns a caller-owned
  material explicitly or hands back a library-owned shared instance. A palette entry
  plus a surface id is a cache key.
- **Do not add a second full-screen pass when bloom is off.** The grade lives inside
  the existing composer chain; direct rendering stays a real, supported path and the
  art must read without it.
- **Do not add dynamic lights for rim or fill.** Rim is a shader term. Fill is the
  existing hemisphere light plus one non-shadowing directional light.
- **Do not call `Math.random()` in construction.** Visual variation derives from the
  world seed through a dedicated `art:` stream namespace so it never consumes from a
  gameplay stream and never desynchronizes a run.
- **Do not grow the texture budget to add detail.** Baked vertex colours and baked
  vertex occlusion are free at runtime and cost three or four bytes per vertex.
- **Do not let the toolkit reach back into `GameEngine`.** `src/game/art/` imports
  only `three`, `three/addons` and `src/game/random/`. It must stay importable from
  a Node test with no DOM.

## 5. Architecture

### 5.1 Module layout

```text
src/game/art/
  index.ts                 barrel; the only import path siblings need
  ArtNoise.ts              deterministic hash noise, fbm, curl-free jitter
  ArtRandom.ts             seeded visual streams and variation helpers
  GeometryKit.ts           geometry construction, vertex colour, AO, outline normals
  GeometryCache.ts         ref-counted geometry cache and LOD assembly
  StylizedArtLibrary.ts    material family, ramps, outlines, contact shadows
  stylizedShader.ts        the GLSL injected by the material family
```

Dependency rule: `GeometryKit` may use `ArtNoise`/`ArtRandom`; `GeometryCache` may use
`GeometryKit`; `StylizedArtLibrary` may use `GeometryKit`. Nothing in `art/` imports
`GameEngine`, `world/` or `content/`.

### 5.2 Deterministic variation

```ts
function createArtStream(seed: SeedInput, label: string): RandomStream
function artVariation(seed: SeedInput, label: string): ArtVariation
function wrapArtVariation(stream: RandomStream): ArtVariation
function artNoiseSeed(seed: SeedInput, label: string): number

interface ArtVariation {
  unit(): number                       // [0,1)
  signed(spread: number): number       // [-spread, +spread)
  around(base: number, spread: number): number
  range(minimum: number, maximum: number): number
  integer(minInclusive: number, maxExclusive: number): number
  pick<T>(values: readonly T[]): T
  chance(probability: number): boolean
  angle(): number                      // [0, 2π)
  readonly stream: RandomStream        // for snapshots and cloning
}
```

`createArtStream` prefixes every label with `art:` before `deriveSeed`, so a visual
stream can never collide with `region-dressing:`, `combat`, `loot` or any other
gameplay namespace. Construction code must take its variation from one of these and
never from `Math.random()`.

`ArtNoise` provides pure functions with no state:

```ts
function hashInt3(x: number, y: number, z: number, seed: number): number   // uint32
function hashUnit3(x: number, y: number, z: number, seed: number): number  // [0,1)
function hashUnit(index: number, seed: number): number                     // [0,1)
function valueNoise3(x: number, y: number, z: number, seed: number): number  // [-1,1]
function fbm3(x, y, z, seed, octaves = 3, lacunarity = 2.03, gain = 0.5): number
function ridgeNoise3(x, y, z, seed, octaves = 3): number
```

They are integer-hash based, allocation-free and identical on every machine, so a
displaced rock is byte-identical for a given seed.

### 5.3 Geometry construction kit

```ts
// Angular bodies. `taperedBox` takes an optional `bevel` — there is no separate
// bevelBox; one builder covers the plain, tapered and bevelled cases.
function taperedBox(options: TaperedBoxOptions): THREE.BufferGeometry
function stylizedCapsule(options: StylizedCapsuleOptions): THREE.BufferGeometry

// Profile-driven bodies
function rectProfile(width: number, depth: number, bevel?: number): Vec2Like[]
function polygonProfile(radius: number, sides: number, phase?: number): Vec2Like[]
function loftProfile(options: LoftOptions): THREE.BufferGeometry
function latheProfile(points: readonly Vec2Like[], options?): THREE.BufferGeometry  // unit normals, incl. the last ring
function extrudeProfile(points: readonly Vec2Like[], options?): THREE.BufferGeometry

// Curve-driven bodies
function tubeAlongPoints(points: readonly Vec3Like[], options?): THREE.BufferGeometry
function branchStructure(options: BranchStructureOptions): THREE.BufferGeometry

// Organic surfaces
function displaceGeometry(geometry, options: DisplaceOptions): THREE.BufferGeometry  // mutates in place
function facetGeometry(geometry, options?: FacetOptions): THREE.BufferGeometry       // returns a copy

// Composition
function mergeAll(parts, options?): THREE.BufferGeometry          // disposes sources
function transformed(geometry, transform): THREE.BufferGeometry   // mutates in place

// Shading data — all mutate and return the geometry passed in
function ensureVertexColors(geometry, base?): THREE.BufferGeometry
function paintVertexColors(geometry, paint: VertexPaint): THREE.BufferGeometry
function gradientVertexColors(geometry, options): THREE.BufferGeometry
function bakeVerticalOcclusion(geometry, options?): THREE.BufferGeometry
function bakeSkyOcclusion(geometry, options?): THREE.BufferGeometry
function bakeOutlineNormals(geometry, options?): THREE.BufferGeometry
function hasOutlineNormals(geometry): boolean
```

Rules the kit enforces so siblings cannot get them wrong:

- Every builder returns a fresh, indexed-or-not-but-consistent `BufferGeometry` with
  normals computed and a `name` set.
- `mergeAll` disposes its inputs by default and throws with a readable message when
  the merge fails, because a silent `null` from `mergeGeometries` is the single most
  common way this codebase leaks a half-built prop.
- Merge requires matching attribute sets; the kit normalizes `color` presence across
  parts so a vertex-coloured leaf can merge with an uncoloured trunk.
- `displaceGeometry` is seeded and **mutates the geometry in place**, recomputing
  shading normals and re-baking `outlineNormal` if the attribute is already there.
  Like every other `bake*`/`paint*` helper it returns the same object it was given, so
  it must never be applied to a geometry obtained from `GeometryCache.acquire` — that
  buffer belongs to every other mesh sharing the key. Displace first, cache after.
- `bakeVerticalOcclusion` darkens vertex colour towards the geometry's own minimum Y,
  which is the cheap "this object touches the ground" cue. `bakeSkyOcclusion` is the
  same idea driven by upward-facing normals rather than height.
- `bakeOutlineNormals` welds by quantized position and writes an `outlineNormal`
  attribute; the outline material picks the smooth variant automatically.
- **Winding invariant.** Every builder emits triangles whose vertex order agrees with
  the normal it stores: for each non-degenerate triangle,
  `cross(b - a, c - a) · n > 0`. Base surfaces render `FrontSide` and ink shells render
  `BackSide`, so a builder that gets this backwards draws the far wall of every solid
  and flips its outline in front of the object instead of behind it — a defect that
  survives silhouette inspection because most kit shapes are symmetric. `art.test.ts`
  asserts the invariant over every builder against three.js primitives as controls; any
  new builder must be added to that list.

  Note the invariant is deliberately **relative** — winding against the geometry's own
  stored normal — and not "faces point away from the centroid". The absolute form is
  stronger where it applies but false-fails on anything not star-convex; a twisted loft
  reports phantom errors under it. A second test applies the absolute check to the
  closed, convex builders only, which closes the one blind spot the relative form has:
  a builder that inverted its normals *and* its winding together would agree with
  itself. Together they pin orientation absolutely without rejecting valid shapes. If
  you add a twisted, shelled or otherwise non-convex builder, add it to the relative
  test only.
- `facetGeometry` is **non-destructive**: it returns a hard-edged copy and leaves the
  input untouched, so it is safe on a cached buffer. Pass `{ dispose: true }` only when
  you own the input and want move semantics. `mergeAll` is the one helper that consumes
  its inputs by default.

### 5.4 Geometry cache and LOD

```ts
class GeometryCache {
  acquire(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry
  release(key: string): void
  has(key: string): boolean
  referenceCount(key: string): number
  readonly size: number
  dispose(): void
}

function createLod(options: {
  levels: readonly { geometry: THREE.BufferGeometry; distance: number }[]
  material: THREE.Material | THREE.Material[]
  castShadow?: boolean
  receiveShadow?: boolean
  name?: string
}): THREE.LOD

/** Detaches every level of an LOD built by `createLod`. Frees nothing — the
    caller still owes a `release` for each cached geometry that fed a level. */
function clearLod(lod: THREE.LOD): void
```

The cache is ref-counted: `acquire` on an existing key increments, `release`
decrements and disposes at zero. One region streaming out must not dispose a tree
another region is still drawing. `dispose()` releases everything unconditionally and
is idempotent.

**Status: wired.** The engine uses this for actor and caravan geometry, and the streamed
world uses it too — `src/game/world/WorldPropLibrary.ts` imports `GeometryCache` at `:3`
and holds one at `:135`, keyed `acquire`/`release` with regions tracking receipts rather
than geometry objects. Measured on this tree, not reported: a 128-key retention window,
peak **128** live entries over three laps of a 5x5 map (120-128 across five seeds),
**118** over a single sweep and **80** over straight-line traversal
against a ceiling of 176, 0 after dispose, balanced over laps. §12 is done.

This paragraph used to describe the streamed world as still building its own buffers,
which was true when written and false the moment the trees merged. That is the shape of
claim §7.4 is about.

The cost that buys is measured, not assumed. An instrumented `A → B → A` region cycle
rebuilds **225 procedural geometries per load/unload/reload**, each one a
loft/displace/vertex-colour/merge/`bakeOutlineNormals` chain. The ledger balances
exactly — net geometry growth per cycle is `0`, nothing is double-disposed, and no
library-owned resource is freed by streaming — so this is recurring construction cost,
not a leak. 225 rebuilds per cycle is the number the runtime-level cache removes.

**The release path to copy is `src/game/world/WorldPropLibrary.ts`.** `GameEngine` only
ever calls `acquire`, because its cache lives as long as the process and is torn down
wholesale by `dispose()` — so it is not the example to follow for streaming. The prop
library is: keyed acquire, receipts held by region, release on unload, a retention window,
and a double-release guard that throws.

This paragraph used to deny that any release path existed here. That was the most
dangerous of the four expired claims, because understating what is wired is inert, while
telling the next reader nothing exists routes them into reinventing a working, measured
implementation.

Three lifetime rules, none of which the API enforces. The first two were paid for by that
pass; the third was found reviewing it and has no known instance:

1. **Re-acquire before you unretain.** If a retention window is holding the last reference
   to a key, `acquire` it *before* dropping the window's reference. `release` deletes the
   entry and disposes at zero, so the other order frees the exact buffer the window exists
   to preserve and silently rebuilds it on the next line.
2. **A retention window must collapse duplicate keys.** One shared geometry released by
   three unloading regions otherwise spends three slots on one entry, and the window covers
   a fraction of the keys it advertises. Surplus references go straight back to the cache;
   the entry already pinned keeps the count above zero.
3. **One key, one geometry object.** Two keys must never receive the same buffer. Each
   entry counts references independently, so releasing one key to zero disposes a buffer
   the other key still hands out — and every per-key count is correct at every step, so a
   `referenceCount` invariant cannot see it. Measured on this cache: two keys sharing one
   `BoxGeometry`, release one, and the survivor still returns the disposed geometry with
   its 24 vertices readable, because `dispose()` frees the GPU resource and leaves the JS
   object intact. The check that catches it belongs to the caller, which holds the
   receipts: distinct geometry objects must equal live entries.

   The reachable route to it is worth naming, because it is a *tempting* thing to write
   rather than an obscure one. `mergeAll` moves rather than copies when handed a single
   part — `dispose: true` returns `parts[0]` itself — so a builder that tags one geometry
   under two surfaces to get it drawn in two passes ("the lantern body, and the same body
   again in `glow`") yields that one object as the merged result for *both* surfaces, and
   a per-surface cache then keys it twice. With two or more parts on either surface the
   same mistake instead merges a geometry the other surface's merge already disposed. One
   `Set` of seen geometries at the top of a surface-partitioning merge rules out both.

Worth a test that streams a region in and out twice and asserts `referenceCount` returns
to its starting value rather than drifting up.

`createLod` is for streamed regions: a near level with displacement and an outline
normal, a far level built from the same profile at lower segment counts. Instanced
props do not use `LOD`; they use the cheap level directly. Distances must be finite,
non-negative and **strictly** increasing — `THREE.LOD` takes `Math.abs()` of what it is
given and silently reorders, and equal distances make the earlier level unreachable, so
`createLod` throws rather than shipping a level that never draws.

### 5.5 Stylized material family

One family, `MeshStandardMaterial` plus `onBeforeCompile`:

```ts
type StylizedSurface =
  | 'cloth' | 'skin' | 'metal' | 'dark' | 'leather'
  | 'bark' | 'foliage' | 'stone' | 'ground' | 'water' | 'glow'

interface StylizedMaterialOptions {
  color: THREE.ColorRepresentation
  surface: StylizedSurface
  map?: THREE.Texture | null
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  vertexColors?: boolean
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
  flatShading?: boolean
  depthWrite?: boolean
  roughness?: number
  metalness?: number
  rimStrength?: number
  bandStrength?: number
  name?: string
}

class StylizedArtLibrary {
  constructor(options: StylizedArtLibraryOptions)
  createMaterial(options: StylizedMaterialOptions): THREE.MeshStandardMaterial
  acquireMaterial(key: string, options: StylizedMaterialOptions): THREE.MeshStandardMaterial
  adoptMaterial(material: THREE.MeshStandardMaterial, options?: StylizedAdoptOptions): THREE.MeshStandardMaterial
  getOutlineMaterial(kind: OutlineKind, smooth: boolean): THREE.Material
  applyOutline(root: THREE.Object3D, kind: OutlineKind, options?: OutlineOptions): OutlineBinding
  releaseOutline(binding: OutlineBinding): void
  createContactShadow(options?: ContactShadowOptions): THREE.Mesh
  setLightingReference(reference: {
    keyIntensity?: number
    rimColor?: THREE.Color
    shadowTint?: THREE.Color
  }): void
  readonly rampTexture: THREE.DataTexture
  readonly sharedMaterialCount: number
  readonly libraryOwnedMaterialCount: number   // what ART_LIBRARY_MATERIALS bounds
  dispose(): void
  static isLibraryOwned(resource: THREE.Material | THREE.BufferGeometry | THREE.Texture): boolean
  static markLibraryOwned(resource: THREE.Material | THREE.BufferGeometry | THREE.Texture): void
  static isOutlineShell(object: THREE.Object3D): boolean
}

// from ./stylizedShader.ts, re-exported by the barrel — a free function, not a method
function hasStylizedShader(material: THREE.Material): boolean

// from ./GeometryKit.ts, re-exported by the barrel
const OUTLINE_NORMAL_ATTRIBUTE = 'outlineNormal'
```

Ownership, stated once and enforced everywhere:

- `createMaterial()` returns a **caller-owned** material. Whoever creates it disposes
  it. This matches today's `createToonMaterial()` contract.
- `acquireMaterial(key, …)` returns a **library-owned** shared instance, tagged with
  a module-private ownership symbol. Callers must never dispose it; the library does,
  exactly once. Use it for anything drawn more than a handful of times.
- The ramp texture, the outline materials, and the contact-shadow geometry/materials
  are library-owned.
- `adoptMaterial(material, options?)` injects the stylized shading into a material the
  caller already built, in place. **Ownership does not move** — `isLibraryOwned()` stays
  false and the caller still disposes it. Adopting the same material twice is a no-op.
  Use it for one-off meshes that must match the look but do not warrant a shared
  instance; use `acquireMaterial` for anything drawn repeatedly.
- `createContactShadow({ opacity })` shares one material per distinct opacity, rounded
  to 1/100. Opacity is therefore a cache key, not a per-mesh property: two calls with
  the same value get the same material, and mutating one mesh's `material.opacity`
  changes every mesh sharing that value.
- `StylizedArtLibrary.isLibraryOwned()` accepts materials, geometries and textures so
  every teardown traversal in the codebase can use one predicate. Hand a resource you
  built to the library's teardown with `markLibraryOwned()`; never write the marker
  yourself.
- **Never `.clone()` a stylized material and expect it to stay stylized.**
  `Material.clone()` copies `userData` but copies neither `onBeforeCompile` nor the
  ownership/injection symbols, so the clone renders as a plain standard material.
  This is why both markers are symbols rather than `userData` keys: a clone correctly
  reports `isLibraryOwned() === false` (so teardown cannot skip it forever) and
  `hasStylizedShader() === false` (so it can be repaired). Pass a clone through
  `adoptMaterial()` to reinstate the injection, or prefer `acquireMaterial()` with a
  distinct key over cloning in the first place.
- **`isOutlineShell()` deliberately does the opposite, and is not a missed hardening.**
  Its marker is a plain `userData` string, so it *does* survive `Object3D.clone()`.
  The two predicates answer different questions. Ownership is a relationship to the
  library and must not survive a copy, or teardown skips a clone forever. Shell-ness
  is an intrinsic property of the object, and it must survive a copy for a concrete
  reason: `Mesh.copy` assigns `geometry` **by reference**, so a cloned shell shares
  the same borrowed buffer, and disposing the clone frees the source's geometry just
  as disposing the original would. A sweep that did not recognise the clone would
  commit exactly the corruption the predicate exists to prevent. Promoting this
  marker to a symbol is a regression; `outline shells survive cloning` pins it.
- `userData.stylizedSurfacePreset` is a **human-readable label, never a marker**. It
  records which preset was applied, for debuggers and scene dumps. Because `userData`
  *is* deep-copied through JSON, a clone happily reports
  `stylizedSurfacePreset: 'cloth'` while carrying no injection whatsoever — which is
  precisely the wrong inference. The only sound question is `hasStylizedShader()`.
  `adoptMaterial` deliberately ignores the label for the same reason.
- Disposal is **terminal**. Every factory — `createMaterial`, `acquireMaterial`,
  `adoptMaterial`, `getOutlineMaterial`, `applyOutline`, `createContactShadow` —
  throws after `dispose()`. `dispose()` itself stays idempotent.

The `surface` id chooses roughness/metalness/band/rim defaults; it is a preset name,
not a shader permutation. All surfaces compile the same program.

#### Shading injection

Injected by replacing `#include <lights_fragment_end>` in the standard fragment
shader. That exact point matters: it is after all light accumulation, so the shader
sees aggregate direct diffuse with shadows already folded in, and it is before
`aomap_fragment` folds ambient occlusion into `indirectDiffuse`:

1. Recover the aggregate direct-light term as a **scalar luminance ratio**:
   `luminance(reflectedLight.directDiffuse) * PI / luminance(diffuseColor)`. Dividing
   per RGB channel would make band selection depend on albedo hue — a saturated red
   surface has no green or blue to divide back, so it would land several stops darker
   than a white one under identical light and every faction colour would band
   differently.
2. Sample the shared ramp with the luminance of that term, normalized by
   `uBandReference` — the current key intensity, so the bands sit in the same place
   at noon and at midnight.
3. Re-apply, blended by `uBandStrength`, so a surface can opt into softer banding
   without a second program.
4. Tint indirect light towards `uShadowTint` where the surface is unlit, so the dark
   half reads as a colour instead of as grey.
5. Add a Fresnel rim term, tinted by the sky colour, scaled by `uRimStrength` and by
   how lit the fragment already is, so unlit backs do not glow.
6. Add a low-cost "paper tooth" — three sines of the interpolated world position —
   so large flat surfaces stop banding into perfectly flat plates.

The shared four-band ramp:

```text
0.00 -> 0.00
0.33 -> 0.42
0.66 -> 0.72
1.00 -> 1.00
```

**The first stop must be zero.** The injection can only see the *aggregate* direct
term, which already has the shadow-map factor folded in. Spec 01's ramp started at
`0.28` because `MeshToonMaterial` ramps `dotNL` before the shadow factor is applied;
here the same floor would lift every shadowed fragment back to 28% of full key light
and erase cast shadows entirely. Measured on the shipped ramp, a `0.28` first stop
makes the band scale `ramp(k) / max(k, 1e-3)` reach **278x** at `k = 0` — a fully
shadowed fragment would be amplified by two and a half orders of magnitude. With the
shipped zero stop the multiplier below the first band edge is exactly `0`, so a
shadowed fragment stays black. Direct light bands down to nothing and the
hemisphere ambient carries the dark side.

`NearestFilter`, no mipmaps, `NoColorSpace`, one `DataTexture` for the whole game.

Two coupling rules follow from the same place and both are load-bearing:

- **`uBandReference` is written after weather, not after day/night.** The weather
  system multiplies `sun.intensity` by as little as `0.22` in rain, *after* the
  day/night pass has run. Reading the pre-weather intensity drops every surface into
  the lowest band the moment it starts raining, and the world goes black.
- **`uShadowTint` is normalized inside the library.** It multiplies
  `indirectDiffuse`, so it has to sit around `1.0` or it is a dimmer rather than a
  tint. Callers pass a lighting colour (the hemisphere ground colour); the library
  normalizes to the brightest channel and pulls most of the way back to white so
  only the hue survives.

Because the injection only reads `reflectedLight`, `material.diffuseColor`, `normal`
and `vViewPosition`, it is valid for every `MeshStandardMaterial` variant the game
uses: mapped, vertex-coloured, instanced, transparent, emissive, shadow-receiving and
fog-affected. Uniforms are per-material and cheap; the ramp texture is shared.

`onBeforeCompile` sets `material.customProgramCacheKey()` so materials with the same
injection share a compiled program.

#### Ink outlines

`applyOutline` still creates a back-side shell parented to the source mesh, so limb
and weapon pivots need no synchronization. Three changes:

- The shell material is a `MeshBasicMaterial` whose `project_vertex` is replaced. It
  offsets the vertex in **view space** along the view-space normal by
  `thickness * clamp(-mvPosition.z, minDepth, maxDepth)`. The depth term cancels
  against perspective, so the ink is `thickness * height / (2 tan(fov/2))` pixels
  wide — a fixed fraction of the frame, identical at 720p and 4K — instead of a
  shape-dependent smear. Clamping the depth is what lets distant props fade to a
  hairline rather than staying boldly outlined at the horizon.
- It reads `outlineNormal` when the geometry has one, so hard-edged merged props do
  not crack. `bakeOutlineNormals` is what makes a geometry eligible.
- Instanced meshes are supported: the shell for an `InstancedMesh` is another
  `InstancedMesh` sharing `instanceMatrix`, so an outlined forest costs one extra
  draw call, not one per tree. World silhouettes opt in explicitly through
  `applyOutline(root, 'landmark', { instanced: true })`; nothing is outlined by
  default.

Eligibility rules from spec 01 are unchanged: no transparent materials, no sprites,
points, lines, gore, decals, particles, sky, health bars, faction rings, ground cover
or anything tagged `userData.noComicOutline`.

#### Contact shadows

`createContactShadow()` returns a `Mesh` sharing one library-owned circle geometry and
one library-owned material with a procedurally generated radial-falloff `DataTexture`.
`depthWrite:false`, `toneMapped:false`, `renderOrder` below decals, `fog:true` so a
distant blob fades with everything else. Callers parent it under the object it grounds
and never dispose it. It is the cheapest possible answer to "things look like they
float", it needs no extra pass, and it works when shadow maps are disabled.

### 5.6 Lighting, atmosphere and post

Rig (all keyframed by the existing day/night authority, which stays the single owner
of colour and intensity over time):

| Light | Role | Shadows |
| --- | --- | --- |
| `HemisphereLight` | sky/ground ambient fill | no |
| `DirectionalLight` sun | key | yes |
| `DirectionalLight` rim | back-rim from roughly opposite the sun, ~0.35 of key, cooled towards the sky colour | no |
| `PointLight` torch | existing single shared torch light | no |

Shadow quality: the frustum tightens from ±85 to ±52 at the same 2048² map, roughly
2.7x the texel density; `bias = -0.0006`, `normalBias = 0.028` to kill the acne that
tightening exposes. `shadow.camera.far` goes the other way — 150 to 160 — because the
tighter lateral extent lets the light sit closer without clipping tall silhouettes out
of the far plane.

Sky: the gradient gains stops for zenith, upper sky, horizon glow and ground haze,
plus a deterministic dither so the 256-pixel gradient does not band on wide screens.
The horizon-glow stop tracks the sun colour, which is what makes it read as painted
rather than as a flat vertical wash.

Fog stays `THREE.Fog` because the weather system keyframes `near`/`far`; only its
tuning changes.

Tone mapping moves from `ACESFilmicToneMapping` to `NeutralToneMapping`. ACES rolls
saturated faction colour towards white and lifts blacks, which is exactly wrong for
ink. Neutral preserves hue and keeps outlines black. Exposure moves to `1.0`.

Post chain when bloom is enabled:

```text
RenderPass -> UnrealBloomPass -> ComicGradePass -> OutputPass
```

`ComicGradePass` is one fullscreen shader: vignette, shadow-tint towards the fog
colour, highlight-tint towards the sun colour, and a slight saturation lift. Bloom is
retuned to strength `0.42`, radius `0.55`, threshold `0.9` so emissive FX still bloom
but ink lines and dark cloth do not get eaten.

When bloom is disabled the renderer path is unchanged: direct `renderer.render()`,
no composer, no grade. The art must read in that path, and the acceptance criteria
check it.

## 6. What the two follow-up passes may rely on

The NPC-model pass and the world-object pass branch from this work. They may treat
the following as stable:

- `import { … } from '../art/index.ts'` — every helper named in §5.3–§5.5.
- `createMaterial` is caller-owned, `acquireMaterial` is library-owned. This is the
  only ownership question either pass has to answer.
- **Do not `.clone()` a stylized material.** `Material.clone()` copies neither the
  `onBeforeCompile` injection nor `customProgramCacheKey`, so the clone silently
  renders as a plain unbanded standard material. Use `acquireMaterial` with a distinct
  key for a variant; if a clone is unavoidable, run it through `adoptMaterial` to
  reinstate the injection. `hasStylizedShader(material)` reports whether a material
  actually carries the injection, which is what `adoptMaterial` now keys off.
- `GeometryCache` is ref-counted, so both passes can key by shape parameters and let
  streaming handle lifetime. `src/game/world/WorldPropLibrary.ts` is the worked example,
  and §5.4 lists the three lifetime rules the API does not enforce.
- `transformed` carries baked outline normals through the rotation, and `mergeAll`
  with `dispose: false` works on copies, so neither can quietly corrupt a geometry you
  still hold.
- `bakeOutlineNormals` before `applyOutline` for anything with hard edges.
- Deterministic variation comes from `artVariation(worldSeed, label)`; labels are
  namespaced by the caller (`npc:torso`, `props:cart`).
- Character rig names are load-bearing and unchanged: `body-pivot`, `torso-pivot`,
  `head-pivot`, `pelvis-pivot`, `torso`, `head`, `leftArm`, `rightArm`, `leftLeg`,
  `rightLeg`, `weapon`, `shield`, `faction-ring`. Animation, dismemberment,
  prosthetics and gore all address them by name. Add children freely; do not rename
  or reparent.
- `GeneratedWorldRuntimeOptions.art` accepts a library; when omitted the runtime
  builds and disposes its own, which is what keeps the Node tests working.
  `GeneratedWorldRuntimeOptions.outlineDressing` opts structural dressing into ink.
- World dressing and ground cover are drawn with **vertex-coloured shared
  materials**. A vertex-coloured material on geometry without a `color` attribute
  renders black, so any new dressing geometry must bake one — the geometry kit's
  `gradientVertexColors` / `bakeVerticalOcclusion` / `bakeSkyOcclusion` all do.
  Character materials deliberately do *not* use vertex colours, because meshes get
  attached to the rig from several places in `GameEngine` and one of them would
  eventually arrive without the attribute.

Constraints they must respect:

- No `Math.random()`, no `Date.now()`, no `performance.now()` in construction.
- No per-mesh materials for repeated props; use `acquireMaterial`.
- No new textures unless a vertex colour genuinely cannot express it.
- Every geometry they build is either owned by a `GeometryCache`, tracked in a
  region's geometry set, or disposed by the object that created it.
- Only `mergeAll` consumes its inputs. Every other kit helper either mutates in place
  and returns the same object (`displaceGeometry`, `transformed`, all `paint*`/`bake*`)
  or returns a copy (`facetGeometry`). Never apply an in-place helper to a buffer
  obtained from `GeometryCache.acquire` — `transformed(cache.acquire(key), …)` rotates
  the buffer every other holder of that key is sharing, and the result stays valid and
  correctly normalled, so nothing downstream will notice. Transform the *mesh*, or
  `facetGeometry` first and transform the copy.

Verifying what they build — four rules, each learned the expensive way:

- **Any helper that inspects geometry needs a test that deliberately corrupts a
  known-good input and asserts the helper reports the corruption.** A control that is
  only ever asked to read a clean shape cannot separate *the geometry is fine* from
  *the instrument is blind*, because both produce a pass. Four measured instances in
  this programme so far: a material-budget assertion pinned to a constant that never
  acquired a material; a winding check whose helper conformed the winding it was about
  to measure; a face walker that ignored the index buffer and so returned the same
  count for a correct sphere as for a fully reversed one; and 252 passing tests of
  which not one read the injected shader body. The first three are blind instruments
  and the corruption test above repairs all three. The fourth is different in kind —
  there was no instrument to corrupt — and no mutation can reach it. That case needs a
  coverage question rather than a mutation one: derive the population from source and
  assert both halves non-empty, as the builder-coverage test does by parsing the
  exports of `GeometryKit.ts`. Hardening the instruments you have is silent about the
  ones you never wrote.
- **Prefer magnitudes and exact counts to signs and inequalities.** `> 0` passes for a
  blind instrument as readily as for a correct one, so an assertion built on a sign is
  a coin flip against any defect that perturbs magnitude without perturbing sign. An
  exact count has no such blind spot.
- **An invariant has a domain, and the first question on a reported violation is
  whether the faces are inside it.** Signed volume is meaningless for a shape that
  encloses none, and a radial winding check says nothing about a flat cap. Pin the
  known exceptions by name as an *exact* set rather than skipping them, so that a shape
  which newly joins the set fails, and so does one that leaves it.
- **State what a check cannot detect, beside what it asserts.** Every failure above was a
  check doing exactly what it said, where what it said was narrower than the next reader
  assumed — so the gap has to be written at the assertion, because it is not recoverable
  from reading it. Three measured shapes it takes. Its *subject* can be wrong: the
  signed-volume mutation proof is algebraically entailed, since reversing a triangle
  negates its scalar triple product term by term (residual `0.0e+0` on nine geometries),
  so it grades the harness rather than the measure's discrimination. Its *domain* can be
  narrower than its name: the centroid winding guard needs compactness, not merely
  convexity, and declines a strictly convex lofted section at cross-section ratio 2.0 —
  one ships at 3.75. Its *aggregate* can hide its members: a merged prop's signed volume
  is a sum, blind to 3 of 5 single-part reversals, so the part is the subject and not the
  prop. A floor is the same rule for population — `>= 3` against a population of 4 lets
  one member vanish unremarked. One line of "this cannot see X" next to the assertion is
  the entire fix, and it is what makes the next reader's rediscovery a read instead.

## 7. Budgets

Every line names the **population it governs**, not only its value. Three budgets in this
programme were sized against one population and later spent on another, and in each case
the number had been written down and the population had not — see §7.2. A budget with no
nameable population is the next instance, so the column is mandatory rather than tidy.

```text
                                     value   population it governs
ART_RAMP_TEXELS                      4       one shared DataTexture, whole game
ART_RAMP_STOPS                       0, 0.42, 0.72, 1.0
ART_LIBRARY_MATERIALS               <=24     materials the library itself owns, whole game
OUTLINE_THICKNESS                    0.0042  view-space units per unit of depth (~0.36% frame height)
OUTLINE_MIN_DEPTH                    2.0     per outlined object
OUTLINE_MAX_DEPTH                    42.0    per outlined object
OUTLINE_CHARACTER_SCALE              retired replaced by normal extrusion
OUTLINE_ACTOR_DISTANCE               38      per actor
OUTLINE_INTERACTABLE_DISTANCE        46      per interactable
OUTLINE_WORLD_DRAWS_MAX              8       per VISIBLE REGION
OUTLINE_WORLD_VISIBLE_DRAWS_MAX      48      per FRAME: 9 regions (3x3 Chebyshev) x 8 = 72 worst case
OUTLINE_SITE_DRAWS_MAX               4       per SITE, out of its region's 8 (docs/10)
CONTACT_SHADOW_TEXELS                64x64   one shared DataTexture, whole game
CONTACT_SHADOW_MATERIALS            <=4      one per distinct opacity, whole game
CONTACT_SHADOW_DRAWS_MAX             26      per frame: 25 actors plus the player
SHADOW_MAP                           2048    one directional light
SHADOW_FRUSTUM                       52      one directional light
RIM_LIGHT_COUNT                      1       whole scene, non-shadowing
BLOOM                                0.42 strength / 0.55 radius / 0.9 threshold
GRADE_VIGNETTE                       0.22
POST_PASSES                          4       per frame: render, bloom, grade, output
DRAW_CALLS_PER_FRAME_MAX             507     per frame at a faction start (re-measured max 479; headroom 6%)
VERTICES_PER_FRAME_MAX               1170k   per frame at a faction start (re-measured max 1,078k; headroom 9%)
CHARACTER_GEOMETRY_KEYS             <=180    distinct keys across every faction x role x variant
BEAST_GEOMETRY_KEYS                 <=26     keyed by bulk/length, shared across the four roles
CARAVAN_GEOMETRY_KEYS                6       shared by every caravan in the run
PROP_RETENTION_DEFAULT               128     recently-released prop keys held by the prop library
PROP_RESIDENT_HEADROOM               48      live prop entries on top of the retention window
                                             (the prop cache ceiling is these two summed, and is
                                             asserted as the sum rather than as a literal 176)
```

**There are two geometry caches, and until Wave 4 only one of them had ever been
measured.** Naming both, because a budget that does not say which cache it governs is
the defect §7.2 describes:

| cache | population | measured |
|---|---|---|
| `WorldPropLibrary`'s own cache, read via `runtime.propCacheSize` | trees, rocks, buildings, site props — everything `PropRequest` can name | peak **128** over three laps of a 5x5 map (120–128 across five seeds); **118** over a single sweep, **80** over straight-line traversal, against a ceiling of `PROP_RETENTION_DEFAULT + PROP_RESIDENT_HEADROOM` = 176 |
| `GameEngine.artGeometry` | characters, beasts, fauna and the caravan — the six `acquireArtGeometry` sites | **102** distinct character part keys across every faction x role x variant, against the 180 that `tests/characterArt.test.ts` enforces; a single run touches 50-70 |

The 102 is the theoretical ceiling of the character contribution, enumerated from
`characterPartKeys` over all 81 plans rather than estimated. Beast, fauna and caravan keys
sit on top of it under their own budgets above.

The figure of 125 quoted through most of this programme's history belongs to the **first**
row. It was repeatedly cited while approving a ceiling described as governing "the
geometry cache", of which there are two — which is how a number sized for one population
came to be spent on another without anyone editing it.

**`GEOMETRY_CACHE_ENTRIES_MAX` has been removed from this block.** It was written here as
64, existed in no source file and was enforced nowhere; meanwhile the *prop* library's
cache was bounded at 176 in `tests/worldArt.test.ts` against `propCacheSize`. Two
different caches, one name, 2.75x apart, and no mechanical link between the written
number and the enforced one. The generic `GeometryCache` has no population-wide ceiling —
its holders bound it — and saying that plainly is better than naming a limit nothing
checks. The prop library's ceiling now appears above under the two constants that
actually determine it.


Targets:

- No new full-screen pass when bloom is disabled.
- No per-frame allocation in any code this spec adds. The grade pass, the outline
  update and the contact shadows allocate nothing after construction.
- The banded-toon injection compiles one extra program variant, not one per material.
- **Sustained frame time at 25 actors must not regress by more than 1 ms** — *for changes
  that add no geometry*: shader, lighting, post-processing and the outline machinery.
  That is the population this target was written against, when the shading foundation was
  the only change in flight. If it regresses, drop the rim directional light first, then
  the paper tooth term, then the grade pass. Do not reduce actor count or drop the player
  outline.
- **Draw calls per frame at a faction start: <= 507.** Measured maximum 453 (palace),
  plus ~12%.
- **Vertices per frame at a faction start: <= 1,170,000.** Measured maximum 1,043,911
  (elf forest), plus ~12%.

The last two are new, and they exist because the sentence above them was the **fourth**
instance of the defect §7.2 describes. "No measurable frame-time cost" was authored when
the foundation added no geometry; a pass whose entire purpose is to put more in the world
cannot be judged by it. The target was never about this work, so it has been scoped to
what it actually governs rather than deleted — it remains a real guard for foundation-level
changes — and the budgets this pass needs have been stated beside it.

**The trade, stated so nobody has to infer it: this release spends vertex throughput to
buy fidelity, deliberately.** Measured against `main` at a fixed seed and viewport:

```text
faction (biome)   draw calls        vertices / frame        ink's share of draws
elf (forest)      295 -> 449        112k -> 1,044k (9.3x)   107 (24%)
guard (palace)    316 -> 453         60k ->   340k (5.6x)    93 (21%)
villain (fort)    196 -> 333         88k ->   438k (5.0x)    70 (21%)
```

Three things belong with those numbers every time they are quoted:

1. **Frame time was measured under SwiftShader software rasterisation**, which is fill-
   and vertex-bound. It is directional only and is **not a GPU number**. No real-GPU
   capture exists yet; that is the first follow-up, not a covered base.

   This was checked rather than assumed. On the machine these numbers were taken on, no
   GPU is reachable from headless Chromium at all: the default configuration reports
   `NO WEBGL`, and forcing it (`--use-angle=default --ignore-gpu-blocklist`) yields
   *Microsoft Basic Render Driver* — a second software rasteriser, not hardware. The gap
   is a property of the environment, not of the effort spent on it, and it can only be
   closed on a machine with a GPU.
2. **Ink is only 15-20% of the vertex delta.** The rest is the product change — more in
   the world, not more decoration on the same world.
3. `ActorBudget.ts` and `ActorAi.ts` are byte-identical to `main`, so the 25-actor
   population is the same on both sides by construction rather than by configuration.

LOD and instancing tuning is the immediate follow-up. The ceilings above are set so a
genuine regression trips them while the next seed does not.

`ART_LIBRARY_MATERIALS` is the only budget here that a downstream session can blow
without noticing, so it is the one that is enforced rather than asserted: read
`library.libraryOwnedMaterialCount`, and `tests/art.test.ts` fails if the library's
own worst case plus the shared surfaces exceeds it. The library itself uses **9** —
eight outline materials and one contact shadow — leaving **fifteen** shared slots
for the NPC and world-object passes combined.

This number was 12, which left three slots for two sessions to share across three
factions and every biome's bark, foliage and stone. That was not a budget either
session could work inside; they would have collided within the hour. The rationale
for 24: what actually costs frames is per-mesh materials and shader-program churn,
and the "one material per surface, never per mesh" rule already prevents both. Two
dozen shared materials across an entire world plus all characters is modest for a
browser target and well inside what three.js batches comfortably.

The enforcement is the valuable half, not the number. Both Wave 2 sessions must
declare their material keys at integration so Wave 4 sees the real total. If that
total approaches 24, treat it as a design smell worth reviewing rather than a
number to raise again — the whole point of one shared material family is that it
stays small enough to reason about.

The other three budgets in this section sit behind `GameEngine` and need WebGL and
a DOM to measure, so they remain prose rather than tests. Saying so plainly is
better than implying they are enforced.

### 7.0 Open follow-ups, with the reasoning that makes them actionable
1. **No real-GPU frame-time measurement exists.** Checked, not assumed: no GPU is
   reachable from headless Chromium on the machine these numbers were taken on. Needs
   different hardware, not more effort.
2. **LOD and instancing tuning**, against the two new per-frame ceilings above.
3. **A handle-based `GeometryCache` API — but only if the handle carries identity.**
   `release(key)` cannot detect a double release because a key has no holder: A releasing
   twice while B still draws leaves the count at 1, so the release *succeeds* and steals
   B's reference. `WorldPropLibrary.release(asset)` takes a **receipt**, which does have
   identity, and refuses one it has already accepted. That is the shape to copy, and it is
   already in-tree. **A token that is handed out but never checked for reuse buys nothing**
   — the fix is the identity, not the indirection. Where an API can be receipt-shaped the
   class closes by construction and needs no test at all.
4. **An unreproduced collider finding, deliberately not taken.** A review reported a fort
   boulder collider (`0.55 → 0.85`) blocking 1 spawn in 180; the enumeration could not be
   reproduced. Navigation is the one system this pass measurably *improved* — blocked
   sites 3 → 0, unreachable 12 → 8 — and an unverified radius change is not worth risking
   that on. Reproduce the probe first, then decide.
5. **`inkDrawCost`'s recursion is uncovered by this world's data.** Measured across 4
   seeds and 3040 outlined objects: every one is a single mesh, so the function already
   returns 1 everywhere and `return 1` is an identity rather than a mutation. The branch
   that prices a multi-mesh building LOD correctly gains coverage only when something
   outlines a group.

### 7.0.1 One buffer behind two keys — the hazard `GeometryCache` cannot see

`GeometryCache` counts references **per key**. `mergeAll` **moves** rather than copies for
a single part — it returns `parts[0]` itself. Neither is wrong alone. Composed, a builder
that tags one geometry into two surfaces gets **one buffer behind two keys**, and
releasing either disposes geometry the other is still drawing.

**Per-key reference counting is structurally blind to this.** Every count is individually
correct; the fault is that two counts govern one buffer. That is the same shape as the
double-release problem — blind by construction, not broken — which is why the receipt
guard and this check are complementary rather than redundant.

The detector is an **identity** check, not a counting one: distinct geometry *objects*
held by the cache must equal live cache *entries*. Counts stay right under this defect;
identity does not. Measured on the merged tree:

```text
streamed world, 25 focus checkpoints    peak 122 entries / 122 distinct    0 collisions
whole prop request space, held at once      360 entries / 360 distinct    0 collisions
every character part, 1047 builds        114 keys / 1047 distinct objects  0 collisions
```

**Zero instances in either kit.** Recorded rather than left unsaid, because a latent
hazard measured to zero is a different thing from one nobody looked for, and the next
person to write a two-surface builder needs to know the trap is there.

`PropKit` is where it can happen — 31 `propPart` sites, each tagging a geometry with a
surface — and `mergePropParts` now **throws** on a repeated geometry object rather than
relying on nobody making the mistake. `CharacterKit` cannot reach it at all: it has no
surface-tagging mechanism, its only `surface:` and `GeometryCache` mentions are prose in
comments, and all three of its `mergeAll` calls return a single geometry. The empirical
result above is stated anyway, because the absence of a pattern is not the absence of the
behaviour.

### 7.0.2 Displacement tearing, measured at every site

`displaceGeometry` pushes each vertex along **its own normal**. At a hard crease the
coincident vertices carry different normals — that is what makes the crease hard — so
they travel apart and the shared edge splits into two boundary edges: a hairline slit you
can see through.

Three sites in this kit were measured when the hazard was found, and the ranking came out
**backwards**. The fort boulder was expected to be the disaster — amplitude 0.34, and the
code explicitly calls `toNonIndexed()` first, the exact precondition — and it measured
**zero**, because `IcosahedronGeometry` carries shared radial normals. The one that tore
was the forest trunk at a quarter the amplitude with nothing suspicious about it.

Eleven further sites in `PropKit` had never been measured. All of them now, across the
whole prop request space, 46 displacement calls at 10 distinct sites (one is unreachable
from the request enumeration). Boundary edges before → after raw displacement → after the
seam repair:

```text
PropKit.ts:994    7 calls    0 -> 1680 -> 0     worst single call  280
PropKit.ts:1748  16 calls    0 -> 2810 -> 0                        176
PropKit.ts:3850   1 call     0 ->  112 -> 0                        112
PropKit.ts:423    3 calls    0 ->  292 -> 0                        102
PropKit.ts:855    2 calls    0 ->  188 -> 0                         96
PropKit.ts:1025   2 calls    0 ->  144 -> 0                         72
PropKit.ts:796    3 calls    0 ->  192 -> 0                         64
PropKit.ts:3476   4 calls    0 ->  240 -> 0                         60
PropKit.ts:3762   4 calls    0 ->  192 -> 0                         48
PropKit.ts:3587   4 calls    0 ->  192 -> 0                         48

sites that would tear without the repair   10 of 10
sites still torn after the repair           0 of 10
```

Two things follow. **Every one of these tears** — the hazard is not amplitude-dependent
or input-dependent here, it is universal, and the 1-of-3 ratio from the original sample
understated it badly. And **the repair closes all of them**: every site starts closed at
0 boundary edges and returns to 0, so `displaceSeamless` is doing exactly what its
docblock claims across the entire prop catalogue rather than on the cases it was written
against.

The general point is the sampling one. Three sites suggested a conditional hazard worth
watching; eleven showed a universal one already fixed. Neither conclusion was available
from the other sample, and the difference is which sites happened to be in reach.

### 7.0.3 The visual-QA requirement, discharged by a control rather than by looking

*"No prop or character may render as a solid ink fill"* is the one QA requirement that
sounds subjective and is not. An ink shell that swallows its source draws the object as a
flat silhouette, which replaces shaded pixels rather than adding to them — so it shows up
as a large near-black fraction with a collapsed mid-tone band. Measured over ten captures
by decoding each frame and binning luma:

```text
nine scenarios                     1.6 - 4.6 % near-black,  95 - 98 % mid-tone
villain-fort-night-rain               21.6 %                     77.8 %
```

The outlier is the interesting part, and the naive reading — *ink is filling the fort* —
is wrong. Isolating each toggle:

```text
villain-fort day-clear      4.60      night-clear             4.14
             day-rain      23.59      night-rain             21.65
                                      night-rain, INK OFF    22.23   <- unchanged
```

**Night is not the cause; rain is; and turning ink off leaves it where it was.** The fort
is already the darkest biome (mean luma 51.9 against the palace's 79.7), so a uniform wet
darkening pushes a population that was sitting just above the threshold below it — the
mean falls 22% while the count across a fixed cut multiplies fivefold. A threshold effect
on the darkest start, not a fill.

Worth keeping as a method note: **the discriminating measurement was the ink-off control,
not the outlier.** Nine clean scenarios and one bad number cannot distinguish "ink is
broken here" from "this scene is dark", and no amount of staring at the capture settles
it either. One more capture with the suspected cause removed settles it in one comparison.
### 7.0.4 Streaming churn, measured on the tree that ships

Disposal counts over **three identical laps of a 5x5 map — 75 region loads** — counted by
wrapping `dispose` on the prototypes rather than by reading a counter the runtime keeps,
so the number is what the engine actually calls and does not inherit any bookkeeping the
runtime might get wrong.

```text
seed                 geometry   InstancedMesh   peak cache entries
3353944086               2965            1613                  122
integration-ink          3191            1595                  128
korovan-a                2906            1631                  121
korovan-b                2980            1624                  125
integration-disposal     2884            1643                  120
```

**The cache empties on dispose in every run — 0 entries — and `retentionIsIntact` holds at
all 75 loads, not only at lap boundaries.** Peak is 120–128 against a ceiling of 176, so
the headroom is about 27%.

**This corrects a figure of my own.** §5.4 and the budget table previously quoted 118,
which is the peak over a *single* sweep. Three laps reach 128 because retention accumulates
across re-entry, and three laps is the more demanding protocol, so 128 is what the budget
should be read against. Both are true measurements of different populations — which is the
defect §7.2 exists to name, found here in my own numbers.

**The keep-out costs nothing in churn.** Emptying the spawn anchor set — which disables it
entirely — leaves all three figures unchanged at 2965 / 1613 / 122. So dropping structural
placements near spawns removes placements that were never built rather than rebuilding
anything: the gameplay fix is free at the streaming layer.

The world pass reported 3102 geometry and 2861 InstancedMesh disposals over its own three
laps. Geometry agrees within seed variance. **The InstancedMesh figures do not reconcile**,
and the obvious explanation — the keep-out reducing instanced meshes — is refuted by the
measurement above. Recorded as unreconciled rather than explained away: these numbers are
of this tree, measured this way, and that is all they claim.

### 7.1 `OUTLINE_WORLD_DRAWS_MAX` — the multiplier, and the unit that changed

Two corrections, both found at Wave 4 integration by measuring rather than by
reading. Neither is a defect in what shipped; both are the spec describing less than
the code does.

**The multiplier was never stated.** `OUTLINE_WORLD_DRAWS_MAX=8` is written *per
visible region*. `GeneratedWorldRuntime` sets `visibleRadius: 1` and `RegionManager`
selects by Chebyshev distance, so the visible set is **3x3 = nine regions**, and
nothing anywhere capped their sum. A frame pays the sum. Read literally, the spec
promised 8 and the structural worst case was **72**.

Measured on the merged tree, 10 seeds x 25 focus positions = 250 samples:

```text
                        main    foundation   merged
per-region ink, max        0          1         7      budget 8
per-region ink, mean       0       0.51      4.05
visible-set ink, max       0          8        43      <- the number nobody had
visible-set ink, mean      0       3.44     27.05
visible regions            9          9         9
world draw calls, max    104        107       176
```

Per-region spend never exceeds 8 across any sample, so the documented budget is
correct and fully spent. The visible-set peak is 43. `OUTLINE_WORLD_VISIBLE_DRAWS_MAX`
is therefore **48** — the measured peak plus about 12%, a real ceiling well under the
structural 72 — and `tests/integration.test.ts` enforces it. Setting it at 72 would
have been a cap nothing could ever trip.

**The unit changed underneath the number.** The line used to read "instanced world
silhouettes", and it was sized when an outlined forest cost one draw for the whole
forest. Wave 2B spends it largely on non-instanced per-building meshes, so the same
8 buys far fewer objects than it was written to buy. That is a defensible trade — a
settlement's roofline is what makes it read as a place — but it is a different
currency, and the word "instanced" has been removed rather than left to mislead the
next reader.

### 7.2 Why every budget above names a population

`OUTLINE_WORLD_DRAWS_MAX` was not a one-off. Three budgets in this programme were sized
against one population and later spent on another, and in every case **the number was
written down and the population was not**:

| budget | sized against | later spent on |
|---|---|---|
| `OUTLINE_WORLD_DRAWS_MAX` | one visible region | nine of them — 3x3 Chebyshev, up to 72 draws a frame |
| `GEOMETRY_CACHE_ENTRIES_MAX` | the shared geometry cache, when there was one | quoted at a *different* cache once there were two, 2.75x apart, with no link between the written number and the enforced one |
| `CHARACTER_GEOMETRY_KEYS<=11` | **9 build sites in the source**, per its own annotation | summed with two sibling budgets and compared against a *cache-entry* ceiling — 43 against 64, "comfortable". Measured population is **102 distinct keys** |
| the guarded-sweep count | 4 material sweeps | read as covering 6 `isOutlineShell` call sites, of which 2 are disposal and occlusion, not material |
| the type gate | `src/`, via `tsc -b` | quoted as covering the repo, while `tests/` was in no config at all — §7.2.2 |

The second is the one with no tell. `OUTLINE_WORLD_DRAWS_MAX` was caught because somebody
watched a region reach 7 of 8 and went looking; the cache constant **changed meaning
without anyone editing it**, when a second cache was added and the word "entries" silently
became ambiguous. A number can go stale through a change made somewhere else entirely, and
nothing in the sentence records enough to notice.

The third is the sharpest, because the arithmetic looks like diligence. Summing
`CHARACTER_GEOMETRY_KEYS<=11`, `BEAST_GEOMETRY_KEYS<=26` and `CARAVAN_GEOMETRY_KEYS=6`
gives 43 and reads as headroom under a 64-entry cache. **They are not the same unit.** The
11 is annotated *"9 build sites, two keyed by player/faction"* — it counts **call sites in
the source**, while a cache holds one entry per **distinct key**, and one build site keyed
by faction × role × variant produces many. Measured across all 81 plans: **102** distinct
character keys, past 64 on its own. Nobody was careless — a line reading `NAME<=11` beside
a line reading `NAME<=64` invites addition, and neither says one counts code and the other
counts data. Fixed by naming the population and by making it enforceable:
`CHARACTER_GEOMETRY_KEYS<=180`, asserted at `tests/characterArt.test.ts:253`.

The fourth is the clearest tell. A commit message said "three of four material sweeps"
and it was later restated as three of six, because **the population was never inside the
sentence, so there was nothing to preserve.** The true ratio before that fix was 1 of 4.

None of these were carelessness. They are a property of how a budget gets recorded: a
bare `NAME=value` line carries no scope, so the scope survives only in whoever wrote it.
Hence the second column, and hence the rule that a budget with no nameable population is
the next instance.

### 7.2.1 A floor can assert a shape nobody meant to, and there are two kinds

Every budget above is enforced by a test, and every one of those tests needs a floor
proving it measured something — an assertion whose domain is empty passes by looking at
nothing, which is this programme's single defect class. But a floor can do a second job
nobody asked it for:

> **A floor that exists to prove the measurement ran can accidentally assert the shape of
> the thing measured. The tell is that the codebase improving makes it fail. Any
> assertion that goes red when the code gets better is asserting something nobody meant
> to.** The smallest value that still separates "ran" from "found nothing" is almost
> always 1.

Found in the material-sweep scanner, whose floor of `>= 3` also claimed *"at least three
separate material sweeps exist"* — so consolidating them into one guarded helper, the fix
that test's own docblock argues for, would have turned it red on a success. Applied to
the floors this wave added, it found three more, and **all three would have been tripped
by the LOD and instancing follow-up recommended in §7.0**:

| floor | value once ink is 4× cheaper | what it demanded |
|---|---|---|
| `perRegionPeak >= 5` | fires at 2 | spend more ink |
| `visibleSetPeak >= 40` | fires at 11 | spend more ink |
| `surfaces >= 476` | fires when two surfaces merge | draw more calls |

Replaced with claims that survive the improvement: what separates this tree from `main`
is **zero** world ink, so the floor is 1; the multiplier is a claim about **simultaneity**
rather than magnitude, true at 43 draws and equally true at 3; and the whole-request-space
sweep pins that **every request it enumerated produced something to judge**, which holds
however the surfaces are arranged. Measured maxima moved into failure messages and into
this document, where changing them is an edit rather than a test failure.

**And the corollary needs a split, because two of the replacements still go red on an
improvement and that is correct.** Under the same 4× simulation:

```text
old   "the busiest single region spent only 2 of 8 ink draws"
new   "the peak was 11 against a cap of 48 ... lower the cap rather than this floor"
```

Both fail. They demand opposite things.

> **The question that separates the bug from the budget: does the failure demand you
> change the code back, or that you update the constant describing the code?** The first
> is what the corollary names. The second is a budget tracking reality — and deleting it
> is exactly how a cap silently stops bounding anything, which is the failure this
> programme hit eight times.

So `visibleSetPeak * 2 >= OUTLINE_WORLD_VISIBLE_DRAWS_MAX` stays. If instancing takes the
peak to 12, the cap must come to 24 or below. That is the correct consequence, not a test
to silence.

### 7.2.2 A gate that reports success while checking nothing

Three facts were individually true and each hid the next:

```text
tsconfig.json        "files": [] + project references  ->  tsc --noEmit checks NOTHING, exits 0
tsconfig.app.json    "include": ["src"]                ->  no config ever reached tests/
npm test             --experimental-strip-types        ->  strips types without checking them
```

Measured: a planted `const x: number = 's'` in `src/` **passes `tsc --noEmit`** and fails
`tsc -b` with two errors. The same line in a *test* file passed **both** the build and the
suite. Roughly 8,000 lines of test code had no type coverage of any kind.

This is the same species as the budget defects above — a gate sized against one population
(`src/`, via `tsc -b`) and quoted as coverage of another (the repo) — and it was found in
the verification loop of the session that spent the day finding this pattern in everyone
else's work. **The rule is easy to state and hard to apply to yourself.**

Closing it surfaced twelve real errors and one that mattered: `tests/art.test.ts` passed
`{ caps: true }` to `tubeAlongPoints`, whose options are `capStart` and `capEnd`. Silently
dropped, so the test titled *"tube caps wind outward regardless of tube direction"* built
96 triangles — exactly what passing no options builds — and had no cap to judge. Proved by
reintroducing the defect its own title names: the old test stayed green, the fixed one
fails. **A wrong option name is precisely what a type-checker is for, and there wasn't
one.**

The other eleven were fixture gaps, and each was closed by **measuring rather than
reasoning**, because making a shape well-formed is exactly when another test's premise can
shift. The riskiest was a negative control whose actors ran with `hp` and `role`
undefined: `disagreements` = 698 before, 698 after.

Enforcement is `tsc --noEmit -p tsconfig.test.json` inside `npm run build`, plus a test
asserting that wiring — because the gate lives in a script where nothing running
`npm test` can see it, which is how the hole formed. Both mutations bite: deleting the
build step, and narrowing the config's `include`.

### 7.2.3 A mutation proof only licenses an assertion if the mutation is reachable

Found by the world-objects session in its own family-wide winding assertion, and it is the
sharpest failure mode this programme turned up because **both halves pass review and only
the pair is empty**.

Its control reversed a stock box **without rebaking normals** — and its pipeline cannot
produce that state, because `mergePropParts` ends in `mergeAll`, which recomputes normals
from the winding. So the control proved the detector could catch an **impossible** fault,
and that proof then licensed an assertion facing a real one it had never been tested
against. Measured: a fully reversed prop produced **0 disagreements in 560 of 560 cases**.
The assertion could not have failed for any prop the game builds.

> **A mutation proof only licenses an assertion if the mutation is drawn from the damage
> model the assertion actually faces.** A control that manufactures a state the pipeline
> cannot reach measures the detector against a world that does not exist — which is §7.2's
> defect with the populations swapped, inside the proof rather than inside the check.

Sibling to the rule already recorded here — *when an assertion fails, it may be wrong in
the direction of weakness*. Both describe a proof that looks complete and measures nothing.

**Applied to this branch's own mutation records**, which is the only use of a rule like
this that costs anything:

- The merge-orientation check survives it on both halves. Its control reverses one part
  *"every attribute swapped in step the way the kit's own `reverseWinding` does it"* — the
  pipeline's own function, not a hand-made half-reversal — and its instrument compares the
  merge output against **its own inputs by vertex order**, reading no stored normals at
  all. The rebake that laundered the assertion above cannot reach it. That was deliberate,
  not lucky: it is the reason the instrument was built that way.
- The ink-counter record already contains this rule applied without a name for it.
  Flattening `inkDrawCost` to `return 1` is listed as **"NOT caught — and it is not a
  mutation"**, because every outlined object in this world is a single mesh, so `return 1`
  is an identity rather than damage. Refusing to count it is the same judgement.

The general form for a reviewer: **ask what produced the damaged state, not whether the
detector noticed it.** If the answer is "the test wrote it by hand", the proof is about
the test.

### 7.3 Should the repo-wide sweep scan cover disposal and occlusion too?

Deferred to Wave 4 because it could only be answered with both kits merged. Answer:
**no**, and the reason is worth more than the verdict.

There are seven traversals in `src/game/` that either assign `Mesh.material` or call
`dispose()`. Four assign material and all four carry the `isOutlineShell` guard — those
are what the scan enforces. Three dispose, and **two of those carry no `isOutlineShell`
guard**: `GameEngine.ts:9137` and `GeneratedWorldRuntime.ts:1992`.

Both are correct anyway, because they reach safety a different way. They **release the
shells first, then traverse**, so by the time the traversal runs there is no shell left
to skip. `GeneratedWorldRuntime` releases every binding and empties `this.outlines`
immediately before its traversal, with a comment saying shells "have to be gone before
the source instanced mesh is disposed"; `removeAndDisposeObject` calls
`unregisterOutlineRoot` on its first line and says the same.

So a scan extended to disposal traversals would report **two violations out of two, both
false**, and the natural way to silence it would be to add a predicate that is redundant
given the ordering — which quietly suggests the ordering is optional. It is not: for
instanced sources the shell shares `instanceMatrix` with its source, and ordering is the
only thing that makes disposal safe.

**Widened to all twelve traversals rather than the seven, the false-positive rate gets
worse, and the extra cases name two more blindnesses a token scan has.** The foundation
session classified all twelve and flagged **five as unguarded — all five false**. Four
were the ordering case above, generalised: builders that are safe purely because they run
*before* anything outlines their output. The fifth is new and is the sharpest of the
three:

**A guard can be spelled differently.** `removeAndDisposeObject` does carry a predicate —
`StylizedArtLibrary.isLibraryOwned` at `GameEngine.ts:9150` and `:9153` — it simply
answers a *different question*: who owns this resource, not is this a shell. A scan
searching for the token `isOutlineShell` calls that site bare; a scan searching for "some
guard" calls it covered and would miss a genuinely unguarded sweep that happened to
mention any predicate. So the three failure modes are:

| the guard is… | a token scan says |
|---|---|
| the token it looks for | correct |
| a *different* predicate answering a different question | false positive, or false negative if the scan is loosened |
| an **ordering fact with no line of code at all** | false positive, always |

The third has no textual form to search for, which is why widening the scan cannot fix
it. The remedy is the other direction: **convert an ordering guard into an asserted one.**
`GeneratedWorldRuntime`'s dispose ordering was written only in a comment until a mutation
moved the release below the sweep and the suite stayed green; it is now asserted directly
— the test records the dispose sequence and requires each shell to precede its source.

The material sweeps need a *predicate* because they run while shells are attached. The
disposal sweeps need an *ordering* because they run to tear the shells down. One scan
cannot enforce both properties, and enforcing the wrong one is worse than enforcing
nothing.

## 8. Resource and lifecycle rules

- `StylizedArtLibrary` owns: the ramp `DataTexture`, the outline materials, the
  contact-shadow geometry, material and texture, and every `acquireMaterial` entry.
  `dispose()` releases each exactly once and is idempotent.
- Everything the library owns is marked with a module-private symbol, on
  materials, geometries *and* textures, so scene-traversal teardown can skip it with
  one predicate. `GameEngine.destroy()` and `removeAndDisposeObject()` both use it.
  A symbol rather than a `userData` key is deliberate: `Material.copy()` deep-copies
  `userData` through JSON but drops symbols, so a clone correctly reports
  `isLibraryOwned() === false` instead of forging library ownership and being skipped
  by every teardown path forever. The marker is also **non-enumerable**, which closes
  the other copy route: `Object.assign(new MeshStandardMaterial(), shared)` and object
  spread both copy own *enumerable* symbol keys, and either would otherwise hand
  ownership to a material the library never disposes. Call
  `StylizedArtLibrary.markLibraryOwned()` to hand the library a resource you built;
  never write the marker by hand.
- The stylized-shader flag is enumerable and that asymmetry is intentional. It tracks
  `onBeforeCompile`, itself an own enumerable property, so the flag and the injection
  propagate under identical rules and cannot disagree. Do not "harden" it to match the
  ownership marker: an assign-derived material would then carry the injection while
  reporting none, and `adoptMaterial` would inject a second time over the first.
- **Disposal is terminal.** Every resource-producing entry point — `createMaterial`,
  `acquireMaterial`, `adoptMaterial`, `getOutlineMaterial`, `applyOutline` and
  `createContactShadow` — throws after `dispose()`, so a late caller cannot resurrect a
  library-owned material that the now-cleared maps will never release. `dispose()`
  itself remains idempotent.
- Outline shells share their source geometry and a shared material. They add nothing
  to dispose; removing the source removes them.
- Instanced outline shells borrow their source's `instanceMatrix`. Release them
  through `library.releaseOutline(binding)`, which restores the shell's own
  never-uploaded matrix before calling `InstancedMesh.dispose()`. Calling `dispose()`
  is **required**, not forbidden: it is the only path to three.js's
  `releaseStatesOfObject`, and skipping it leaks one vertex array object per shell
  per region load. What you must never do is dispose a shell while it still holds
  the borrowed attribute, or dispose the source before releasing the shell.
- Every path that drops an outline binding calls `releaseOutline` first — dropping the
  reference detaches nothing and frees nothing. In the engine that means
  `unregisterOutlineRoot` (which runs on every actor death and interactable removal)
  and `destroy()`, which releases before the scene sweep so shells are gone by the time
  the traversal judges what to free. `releaseOutline` empties the binding, so releasing
  twice is a no-op and the two paths are safe to overlap.
- `GeometryCache.acquire/release` is the only correct way to share a geometry across
  streamed regions. Disposing a cached geometry directly is a bug.
- `GeneratedWorldRuntime` keeps ownership of `materials.all` and `materials.textures`.
  When it is handed an external library it must not dispose it.
- `BloomPostProcessor` disposes every pass and the composer, and rebuilds cleanly on
  toggle and resize.
- Engine teardown order is unchanged: world first, then scene traversal, then the
  library, then the renderer.

## 9. Determinism

- World generation, region streaming and validation are untouched. No art code runs
  inside `WorldGenerator`, `WorldValidator` or fingerprinting.
- Visual variation uses `art:`-prefixed streams derived from the world seed. Drawing
  from them cannot advance a gameplay stream.
- Noise is integer-hash based and produces identical output for identical inputs on
  every platform. No `Math.random`, no time, no floating-point accumulation across
  frames.
- The legacy `seededRandom()` LCG in `GameEngine` stays where it already is, for
  decorative atmosphere only.
- `tests/worldGenerator.test.ts` and `tests/generatedWorldRuntime.test.ts` must pass
  unchanged in their determinism assertions. Tests that encode *counts of meshes* or
  *specific geometry types* are visual expectations and are updated deliberately.

## 10. Accessibility and readability

- Faction identity stays redundant: torso colour, faction ring, silhouette and health
  bar. Outline colour is never the only cue.
- Banding must leave at least two visible bands on a character face at night. If it
  does not, raise the night hemisphere keyframe, not the character emissive.
- The grade pass vignette is bounded so HUD-adjacent world content stays readable.
- Ink outlines remain on by default and remain a user toggle.
- Nothing this spec adds is animated, so `prefers-reduced-motion` is unaffected.
- Both themes and both bloom states must be checked for player, guard metal, forest
  actors and fort actors.

## 11. Edge cases

- A material with `flatShading` has no shared normals; `bakeOutlineNormals` must be
  applied to the geometry, not inferred from the material.
- Non-uniformly scaled parents scale the extruded outline anisotropically again.
  Extrusion happens in view space after `modelViewMatrix`, so parent scale is already
  baked in; a heavily squashed parent still needs a smaller `thickness`.
- `InstancedMesh` outline shells must be created after `instanceMatrix` is filled. The
  shell allocates from `instanceMatrix.count` (capacity) and re-reads the source's live
  `count` in `onBeforeRender`, so the decoration-density control needs no manual sync.
- An instanced shell offsets along the instance-space inverse-transpose normal, not
  `mat3(instanceMatrix) * normal`; non-uniformly scaled dressing would otherwise get
  uneven ink that creeps inside the source.
- Transparent materials in a material array exclude the whole mesh from outlining, as
  in spec 01.
- A geometry with zero-length normals (degenerate triangles from a bad merge) would
  produce NaN offsets; `bakeOutlineNormals` normalizes and falls back to the shading
  normal.
- The banded injection divides by the luminance of `material.diffuseColor`; a pure-black
  albedo would divide by zero, so it is clamped.
- `NeutralToneMapping` changes the perceived brightness of every existing emissive
  tuning. Torch, window-glow and beacon intensities are re-checked, not left to drift.
- Contact shadows on steep terrain will clip; they are small, unlit, depth-tested and
  fade with distance, which is cheaper than projecting them.
- A geometry builder whose triangle winding disagrees with its stored normals renders
  the far wall under `FrontSide` and pushes the `BackSide` ink shell in front of the
  object. On a symmetric solid the silhouette is unchanged, so this cannot be caught by
  eye and must be caught by the winding assertion in `tests/art.test.ts`.
- An `InstancedMesh` caches its bounding sphere lazily over the `count` at first render.
  Raising `count` afterwards does not invalidate it, so instances enabled later can fall
  outside the stale sphere and frustum-cull the entire batch. Cosmetic dressing computes
  bounds at full capacity before the density control reduces `count`.

## 12. File-level changes

| File | Changes |
| --- | --- |
| `src/game/art/*` | New. Noise, seeded variation, geometry kit, cache/LOD, material library, shader injection. |
| `src/game/ComicMaterialLibrary.ts` | Removed. Superseded by `StylizedArtLibrary`; the outline binding types move to `art/`. |
| `src/game/GameEngine.ts` | Library swap, character geometry/material port, contact shadows, light rig, sky, shadow tuning, tone mapping, teardown predicate. |
| `src/game/BloomPostProcessor.ts` | Grade pass, retuned bloom, pass disposal. |
| `src/game/world/GeneratedWorldRuntime.ts` | Accepts an art library, shared materials move to the stylized family, trees/rocks/ground cover/buildings move onto the kit. |
| `tests/*` | Updated where they encoded old mesh counts or material classes. |
| `docs/08-graphics-foundation-spec.md` | This document. |

## 13. Acceptance criteria

- [ ] Characters and world share one material family; no `MeshToonMaterial` remains
      in the scene and no lit world surface is an unstyled `MeshStandardMaterial`.
- [ ] Direct light resolves into stable bands on both characters and world without
      breaking shadows, fog, emissive FX, transparency or instancing.
- [ ] Ink outlines have even thickness on a thin blade, a wide torso and a merged
      tree, and do not crack at hard edges after `bakeOutlineNormals`.
- [ ] An outlined instanced prop set costs one extra draw call, not one per instance.
- [ ] Silhouettes read against sky, ground and fog at day, twilight and night, in
      both themes, with bloom on and off.
- [ ] Objects are visibly grounded: contact shadows are present under actors and
      survive shadow-map-off and distant camera.
- [ ] Every geometry, material and texture the library owns is disposed exactly once;
      repeated start/return-to-menu cycles do not grow WebGL resource counts.
- [ ] Every geometry-kit builder satisfies the winding invariant
      (`cross(b - a, c - a) · n > 0`), verified against three.js primitives as controls.
- [ ] No `Math.random()` anywhere under `src/game/art/`, `createCharacter()` or the
      world construction path.
- [ ] `tests/worldGenerator.test.ts` determinism and fingerprint assertions pass
      unchanged.
- [ ] `npm run build`, `npm run lint` and `npm test` are green.
- [ ] Sustained frame time at 25 actors is within 1 ms of the pre-change build.

## 14. Effort

**2.5-3.5 days.** The kit itself is mechanical. The time goes into the shader
injection being correct across every material variant the game already uses, into
outline extrusion behaving on merged geometry and instances, into resource ownership
being provably single-dispose, and into re-tuning every emissive value that the tone
mapping change moves.

