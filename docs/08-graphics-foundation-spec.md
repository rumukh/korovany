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
- **Do not request `PCFSoftShadowMap`.** three 0.185 deprecates it: `WebGLShadowMap`
  overwrites the type with `PCFShadowMap` on the first frame and warns once, so the
  build runs a filter the source does not name. Ask for `PCFShadowMap` directly and
  soften it with `shadow.radius`, which scales the five-tap Vogel disk the modern PCF
  path samples. The default radius of `1` is one texel — a hard edge — so a shadow
  type set and a softness left alone is a hard shadow with no warning attached.
  Shipped at `SHADOW_SOFTNESS_RADIUS = 4`: at ±52 across 2048² that is 0.051 world
  units per texel, so roughly a 0.2-unit penumbra. `14` was measured to stipple
  character surfaces, five taps being too sparse for a disk that wide.

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

### 6.1 Which of these rules will stop you, and which depend on care

This spec makes **61 normative statements** (`MUST` / `NEVER` / `never`). They are not
uniformly backed, and nothing in the prose distinguishes the two kinds. Measured against
`tests/` and `.oxlintrc.json`:

| Rule | Instrument | Fails how |
| --- | --- | --- |
| `ART_LIBRARY_MATERIALS <= 24` | `tests/art.test.ts` | red test |
| Library owns 9, Wave 2 headroom 15 | `tests/art.test.ts` — *acquires all 15* | red test |
| Outline eligibility, budget, distance cull | `tests/art.test.ts` | red test |
| LOD thresholds and swap behaviour | `tests/art.test.ts` | red test |
| Disposal exactly once, ref-count balance | `tests/art.test.ts`, `tests/mergeOwnership.test.ts` | red test |
| Vertex-colour attribute presence | `tests/art.test.ts` | red test |
| Instanced-mesh material sharing | `tests/art.test.ts` | red test |
| Determinism from `artVariation` | `tests/art.test.ts` | red test |
| **Export block ordering in `art/index.ts`** | **enforced.** `tests/art.test.ts` parses the barrel and fails on any block whose values run or types run leaves ordinal order, naming the pair; a companion test rejects a name exported twice. Both prove their detector on doped input *before* believing its verdict on the file | **silently**, until this test |
| **Label namespacing (`npc:`, `props:`)** | tests *use* `npc:torso` / `props:cart`; **none asserts a caller namespaced anything** | **silently** |
| **"Do not `.clone()` a stylized material"** | **partly enforced.** `tests/worldArt.test.ts` walks a streamed scene and fails any material advertising `stylizedSurfacePreset` without the injection — proven red by mutation, naming all 5 affected meshes. **Covers the world scene only**; `GameEngine`'s character, fauna and caravan materials are not in that scene | silently, at runtime, as unbanded shading |

The quantitative contract is genuinely enforced — every budget in §7 has a test that
*spends* it, not merely one that compares it. **The conventions were not**, and the first
was violated within hours of the first sibling branch: `applyHeadPose` landed at line 121
of `src/game/art/index.ts` where its sorted position is 115, and all four CI gates
reported success on two successive commits carrying it. That is correct behaviour by every
instrument involved. It is also the entire point.

That row now has an instrument, and building it is the clearest argument in this document
for building them. Getting one cosmetic two-line fix reviewed produced, between two
sessions: a first pass that reported the whole export list unsorted — sorting across module
groups, when the convention is per block; a verification anchored on a name absent from the
run, which measured an empty slice and printed `sorted: true`; an edit that duplicated one
name and dropped another, which `tsc` accepts in a barrel without complaint; a first draft
of the detector itself that used `localeCompare` **and** `>=` joined by `||`, two
comparators for one question, in the function whose own comment forbade exactly that; and
finally a case-insensitive `Group-Object`, PowerShell's default, reporting three duplicate
exports that do not exist — `artVariation` is a value and `ArtVariation` is its options
type. **Five instrument failures around a change that moved two lines.** The rule had been
kept by care for the whole of Wave 1, and care had already missed `bridgeParts` sitting
ahead of `brazierParts` in the `PropKit` run, which no reviewer ever saw and the new test
found in its first run.

**Treat any remaining unbacked row as advisory and the backed rows as load-bearing.** If you
need an advisory rule to hold, the cheapest correct move is to add its instrument in the same
PR as the reliance. A rule whose only enforcement is that someone remembers it has a
half-life, and this table exists so that the half-life is visible rather than discovered.

The three convention rows shared a shape worth naming, because it is easy to mistake for
coverage: **a rule can be tested at its mechanism and unenforced at its call sites.** The
clone hazard had five assertions behind it and not one fired when a caller cloned and forgot
to adopt — `tests/worldArt.test.ts` now closes that for the world scene, and the character
path is still open. Export ordering is now closed outright. **Label namespacing is the one
left**, and it is the purest example of the shape: the tests are full of `npc:torso` and
`props:cart`, and not one of them asserts that a caller namespaced anything. Two of these
rows were written as a flat "none" in the first draft of this table and were wrong —
grepping the tests finds hits for all three. The hits are *uses*, not *assertions*, and the
difference is the whole of what this section is for.

A note on the instrument that closed it, because it is the cheapest habit in this document.
A check that has never been observed failing is indistinguishable from a check that cannot
fail: **`0` is the normal output both for *nothing is wrong* and for *my pattern cannot see
it*.** So the new test plants a forgery in the scene and asserts the detector reports exactly
that one, and the detector was additionally proven red by mutating `createMaterial` to skip
the injection for one surface. The first mutation attempted was inert — it gated on
`'bark'`, which is a valid surface that this scene does not contain — and the test passed,
which said nothing about the test. **A mutation that perturbs nothing observable is not a
control**, and the pass it produces is the same green as a real one.

#### A summary that reads the same on both paths

`npm run docs:facts` is one of the four gates every branch here is measured by, and until
this commit its summary was **byte-identical between a passing run and a failing one**:

```
clean run    exit 0    ... TOTAL 2313 facts, 187 missing ...  declared residue: 187 accepted, 0 NOT accepted
doped run    exit 1    ... TOTAL 2313 facts, 187 missing ...  declared residue: 187 accepted, 0 NOT accepted
```

The mechanism is worth stating because it is not carelessness. The failure class this gate
most often catches — a number written in the document contradicting the number the tool
counts — **moves no count. It contradicts one.** So every total the summary prints is
unchanged by it, the mismatch was written to `stderr` *after* the last line of `stdout`, and
the last thing a reader saw was `0 NOT accepted`. Exit code red, summary green.

That is the worse of the two available arrangements: **the verdict lived in the stream nobody
reads, contradicted by the stream everybody does.** Fixed by ending both exit paths — the
summary and the early return taken when recall controls fail — with a stated verdict on
`stdout`, and held there by `tests/strategyFactsVerdict.test.ts`, which compares the two runs
and asserts the failing invocation actually failed *before* comparing their wording.

One observation logged rather than chased, because it belongs to whoever owns that document.
The script's `--break=<word>` flag exists to answer "does a green run mean anything", and its
own comment says a term whose deletion leaves the run green is a term the gate does not gate.
**`--break=seed` removes 87 occurrences from `docs/STRATEGY.md` and every figure is
identical** — 2313 facts, 187 missing, 187 accepted, PASSED. Whether those facts are anchored
on other words or are already inside the declared residue is a question for that document's
owner; what is recorded here is only that the deletion is invisible to the gate.
#### Most of a new gate was already gated, and the mutations said which part

The barrel tests above were written from a report that `tsc` accepts a duplicate re-export
silently. Correcting that premise took two passes and the second one reversed the first, so
both are set out here. It took four mutations of the real file — each applied to
`src/game/art/index.ts`, then every gate run against it:

| mutation | Node loads | `npm run build` | ordering gate | coverage gate |
| --- | --- | --- | --- | --- |
| a formatter changes one closing quote to `"` | yes | passes | **fires**, 7 blocks vs 6 parsed | passes |
| a value is exported twice | **`SyntaxError`** | — | dead | dead |
| a type is exported twice | yes | **`TS2300`**, both lines | passes | fires |
| an export is aliased, `{ x as x }` | yes | **passes** | passes, on a smaller file | **fires** |

So the duplicate half of that test catches nothing that was not already caught, harder and
earlier: a duplicated value stops the module loading, which takes the whole suite with it, so
the assertion written for that case is unreachable code. A duplicated type fails the build
before the suite runs. The test keeps the check only so that `npm test` on its own names the
barrel, and the comment above it now says so rather than repeating the premise.

The half that earns its place is the one nobody asked for. **Aliasing an export leaves the
build green, the module loading, and the name invisible to the text parse that the ordering
gate shares** — so the ordering gate goes on passing while checking a quietly smaller file.
That is the same failure as the `>= 5` floor two paragraphs down, arriving through a
different door: a check that reports on a subset and describes it as the file. The
cross-check against the runtime namespace closes it, and needs no maintenance, because the
population maintains itself.

Two things about how this was found are worth more than the finding. **The premise came from
a peer's report of their own breakage and was carried into a commit message and a test
comment without being run once** — plausible, first-hand, and adopted at the wrong scope.
And **the mutation written to prove the duplicate check works never reached it**: Node
rejected the file, the run went red, and a red run under a mutation is exactly as easy to
mistake for a working detector as a green one is for a working subject. The failure had to be
read to see it came from the loader, not the assertion.

Then the peer re-ran it and the correction above turned out to be over-broad in its turn.
**`tsc --noEmit -p tsconfig.json` really does exit 0 on a duplicated value re-export**, with
no output — so "neither is silent" was true of the union of the gates and false of the one
command a person is most likely to run alone. Their report was reproducible; what it could
not carry was scope, because a single instrument had been sampled and written up as a claim
about the world.

The control settles it and inverts the finding. That same invocation exits 0 on
`export const wrong: number = 'definitely a string'`. The root `tsconfig.json` is `"files":
[]` with two `references` and no `--build`, so **it type-checks zero files**: it is not blind
to duplicate exports, it is blind, and no green it has ever produced was evidence about
anything. `npm run build` opens with `tsc -b`, which reports `TS2300` and exits 2 on both
duplicate forms — the table above holds because that is the column it measured.

So the sequence runs: a green read as a property of the subject, corrected to a claim about
all gates, corrected again by a control nobody had run on the instrument itself. **Each step
was a true reading attached to a question it did not answer**, and only the last one asked
whether the instrument could fail at all.
#### A green pull request is a claim about a base that may already be gone

Wave 2 and Wave 3 branch off this foundation and merge in parallel, so the gates above have
a property worth stating outright: **they run against the base as it was when the run
started, not as it is when you press merge.** GitHub tests a simulated merge — the CI job
for PR #40 checked out `Merge 04d64b1 into 113977b` — but `113977b` had been superseded
fifteen minutes before that PR landed.

Measured on this repository, the first day two waves were open at once:

```
19:18:47Z   #40 CI runs, checking out  Merge 04d64b1 into 113977b     green
19:33:47Z   #38 merges                 main becomes d66478b
19:33:56Z   #40 merges, nine seconds later
            git merge-base --is-ancestor d66478b 04d64b1  ->  exit 1
```

Both pull requests touched `src/game/art/index.ts`. Neither one's CI ever saw the other's
version of it, and the barrel gate this section is about would not have caught a conflict
between them, because it never ran on a tree containing both. Branch protection carries the
required check under its correct name but sets `required_status_checks.strict` to `false`,
which GitHub documents as *"Require branches to be up to date before merging."*

**This was a near miss, not an incident.** `main` at `075b112` passes all four gates, and
the push-triggered run on it succeeded; the two changes were genuinely independent. It is
recorded because the next pair may not be, and because the cost of finding out is one
command: fast-forward to `main` and run the suite before assuming your merged work is the
work that was tested.

One instrument note, since it nearly wrote a false sentence into this paragraph.
`gh run list --json headSha` reports `04d64b1` for that run — the pull request head, not the
tree the job checked out, which was a merge commit that exists nowhere in the repository's
history. **The field is named for what you asked about, not for what ran**, and only the
checkout line in the log distinguishes them.

#### The cancelled runs were builds, and the flag is still wrong

`deploy-pages.yml` carried `cancel-in-progress: true` on a workflow-level concurrency group
covering both jobs. The evidence first offered for its being harmful was a run `cancelled`
eight seconds before a successful one, read as a deployment killed mid-flight.

It was not. Every cancellation in this repository's history — **four**, not one — killed the
`build` job:

| run | commit | build | deploy |
| --- | --- | --- | --- |
| 30392484430 | `d66478b` | cancelled 9 s in, 0 steps recorded | **0 steps** |
| 30362159815 | `c8ca38e` | cancelled inside `npm ci` | **0 steps** |
| 30357016872 | `f582e49` | cancelled | **0 steps** |
| 30355639257 | `1ff6ed4` | cancelled | **0 steps** |

with the control that makes those zeros mean anything: a successful run reports `build` 10
steps and `deploy` **3**. The API does report deploy's steps when deploy runs.

That conclusion held. **The reasoning behind it did not, and a reviewer's larger population
is what showed the difference.** They enumerated all 82 recorded Pages runs since the
repository was created — run numbers 1–82 with no gaps, 77 success / 4 cancelled / 1 failure
— fetched every jobs endpoint with `filter=all`, and found the 77 successful deploy jobs
each recording exactly three steps. That is a **77-instance positive control** where mine
was one.

It also produced the counterexample to my inference. The single failed run's deploy job was
**skipped**, and it reports `steps: []` too. So empty steps is not a synonym for "never
executed" — it is equally what a skipped dependant looks like. My argument had been *zeros
plus one control therefore never ran*; the correct argument is zeros **plus no runner, plus
no artifacts, plus no `github-pages` deployment record** for those four SHAs. Same verdict,
different support, and only the second kind survives contact with the failure case.

Restated at the strength it was actually measured:

> **Across all 82 recorded Pages runs, no deployment job is recorded as starting and then
> being cancelled.** Three of the four cancellations were runner-assigned builds; the fourth
> was cancelled before a runner was assigned. "Four builds did work and were abandoned" was
> never measured.

> `gh run list --conclusion cancelled` answers *was a run cancelled*. It was read as *was a
> deployment interrupted*.

The flag is still wrong — the group covers `deploy`, so the window is open — but on the
template's grounds rather than an incident's, and the one-word framing hid a cost: `true`
had correctly abandoned four superseded builds, which is the behaviour it exists to provide.

**The platform claim I was about to correct from memory was right.** `queue` is a real
concurrency key. Checked against the workflow JSON schema, which declares
`additionalProperties: false`, it is `enum [single, max]`, default `single`, *"additional
pending runs cancel the previous one"* — and `queue: max` with `cancel-in-progress: true` is
disallowed outright.

That default is why `ci.yml` gives pushes to `main` a unique group: it owes a verdict to
every commit, and a third push would cancel the pending second. `deploy-pages.yml` owes no
such thing — `main` is linear, so a superseding push contains the commit it displaces and
only the newest content is served. **The same scheduler behaviour is a defect in one
workflow and the desired behaviour in the other**, which is why the `ci.yml` fix was not
copied across.

**That argument assumes the event population is pushes to `main`, and it is not.** The
workflow also carries `workflow_dispatch`. A manual run from a non-`main` ref enters the same
fixed `pages` group, can displace a pending `main` push under `queue: single`, and is only
rejected *afterwards* by the environment's `main`-only branch policy — by which point the
push it replaced is gone. An old re-run can arrive late the same way. All 82 recorded runs
were pushes, so this has never happened, but "`main` is linear" is a statement about one
trigger of two. Neither `single` nor `max` addresses it; a current-`main`/SHA freshness check
would, and none is proposed here. **Recorded as a known gap rather than fixed**, because the
fix is a different change from the one this section is about.

The guard is `tests/deployWorkflow.test.ts`, and its ceiling is stated in the file: it reads
the input handed to the scheduler and cannot observe the scheduler. The pending behaviour in
particular is **unobservable from run history, because `cancel-in-progress: true` prevents
the pending state from arising at all** — the setting suppresses its own evidence. What the
check can fail for is the realistic case: somebody edits the flag back.

It parses `concurrency:` blocks by indentation rather than grepping for the string, so a key
relocated under a job-level block is caught. Six doped inputs — and **the sixth
found a hole in the detector**: the Pages-deployment pattern anchored `uses:` at line start,
so a step written compactly as `- uses: actions/deploy-pages@v4` was invisible to it. The
real file uses the other form, so every run against this repository would have passed while
the check was blind to the exact evasion it was written for.

#### Doping the compiler, since nobody does

The finding above — that `tsc --noEmit -p tsconfig.json` type-checks zero files — surfaced
by accident, inside an argument about something else. It generalises to a question nobody
asks: **a compiler's name is taken as its specification, so a vacuous one survives
indefinitely.** The doping rule in this document was written for detectors we build. It
had never been pointed at a tool we did not write, and `npm run build` runs two
type-checking commands, neither of which had ever been shown capable of failing.

Both were doped. A blatant type error was appended to one file on each surface the build
claims to cover; the mutation's application was confirmed before its result was read, and
every file was restored byte-exact:

| doped file | `npm run build` | first error |
| --- | --- | --- |
| `src/game/art/index.ts` | **exit 2** | `TS2322` naming the file |
| `tests/deployWorkflow.test.ts` | **exit 2** | `TS2322` naming the file |
| `scripts/AudioDirector.test.ts` | **exit 2** | `TS2322` naming the file |
| `vite.config.ts` | **exit 2** | `TS2322` naming the file |

So `tsc -b` genuinely checks `src` and `vite.config.ts`, and `tsc --noEmit -p
tsconfig.test.json` genuinely checks `tests` and `scripts`. **The gate is sound; only the
ad-hoc short form is vacuous.** That is a negative result, and it is one that is normally
never earned — the reason nobody had it is that there was no reason to doubt it, which is
precisely the condition the vacuous invocation had been surviving under for the life of
the repository.

The population, because four passes prove only four files: **84 tracked `.ts`/`.tsx` files,
84 under an `include`** — 48 `src`, 34 `tests`, 1 `scripts`, plus `vite.config.ts`. None
orphaned.

No guard was added for that last number, deliberately. It could fire only when a TypeScript
file is added outside `src`, `tests` and `scripts` — a location nothing imports and `vite`
does not bundle, so it would gate a scenario with no consequence. **An instrument that can
only fire on something harmless is nearer to theatre than to a gate**, and §6's own rule
cuts that way: a documented absence beats a check that cannot fail for a reason worth
failing over.

#### The guard was reading the wrong population, and a probe with no Pages in it proved it

The check shipped above asserts that no workflow can cancel a Pages deployment in flight.
It was doped six ways before it shipped and it caught all six. It was still wrong, and the
way it was wrong is the defect this section has catalogued more than any other: **a true
answer about the wrong subject.**

Its first line filtered the population — `if (!DEPLOYS_PAGES.test(file.source)) continue` —
so it opened a workflow only after finding `actions/deploy-pages` in it. Every doped case
was therefore a mutation of a *deploying* workflow, and every one was caught. The question
never asked was whether the file that does the cancelling has to be the file that deploys.

It does not. The schema is explicit, and it was read rather than recalled:

> a run waits when "another job or workflow using the same concurrency group **in the
> repository** is in progress", and `cancel-in-progress: true` cancels "any currently
> running job or workflow **in the same concurrency group**".

A concurrency group is repository-wide. **The hazard is membership of the group, not
authorship of the deployment** — so the workflow able to kill a deployment need not mention
Pages anywhere, and a workflow that mentions Pages nowhere was the one file the check was
guaranteed never to open.

Constructed and measured, against the real check with the real runner:

| `.github/workflows/zz-probe-caller.yml` | before | after |
| --- | --- | --- |
| `group: pages`, `cancel-in-progress: true`, no Pages reference | **exit 0, 2/2 pass** | **exit 1**, `joins Pages group \`pages\` with cancel-in-progress \`true\`` |

The scan now reads every workflow and the group selects it. Two details were worth getting
right rather than fast:

- **Absent means safe.** The documented default for `cancel-in-progress` is `false`, so a
  workflow sharing the group without the key cannot cancel anything and must not be
  reported. The deploying workflow is still held to the stricter rule — present *and*
  `false` — so that deleting the line fails rather than falling back to a default that
  happens to be correct today.
- **A widened scan can be wrong in the other direction.** A check that flags everything
  passes its own doped cases for the wrong reason and gets switched off the first time it
  blocks something legitimate. A third test pins the cases that must stay quiet, including
  the live one: `ci.yml` cancels superseded runs on purpose, and it asserts that `ci.yml`
  still cancels via an expression before concluding anything from its silence.

Two things are worth carrying out of this beyond the fix. First, **six doped inputs bought
less assurance than they appeared to**, because all six were drawn from inside the filter
they were meant to test; doping proves a detector fires, and says nothing about the
population it was pointed at. Second, the probe run that first exposed this returned
**exit 1 for a missing `tsx` package**, which is byte-identical to the exit code of a real
assertion failure — the flattering reading was one unprinted line away from being published
as "the guard already catches it".

**Then the fixed guard was doped again, and it had two more.** A workflow joining the group
with `concurrency: { group: pages, cancel-in-progress: true }` on one inline line **passed**,
while the identical values in block form failed. The parser's inability to read the inline
form had been documented as acceptable on the grounds that an unreadable block counts as no
block and no block is itself a risk — which is true of the *deploying* workflow and false of
every other one, where an unreadable block simply produced no finding. **The same blind spot
was fail-closed on one file and fail-open on the rest**, and the documentation asserted the
first while the population had just been widened to the second. And `cancel-in-progress:
'false'` — a workflow explicitly declining to cancel — was **flagged**, because a quoted
scalar is not the string `false`. That is the false alarm that gets a gate deleted rather
than fixed.

| probe | before | after |
| --- | --- | --- |
| inline form, `group: pages`, cancel true | exit 0, **evades** | exit 1, caught |
| block form, same values | exit 1, caught | exit 1, caught |
| shares group, `cancel-in-progress: 'false'` | exit 1, **false alarm** | exit 0, quiet |

Both fixed: the inline form is parsed, and scalars are unquoted and compared case-insensitively.

The count that matters is three. **Three rounds of defects in one 300-line check, each found
only by doping it again after declaring it sound**, and the second round was introduced by
the fix for the first. A gate is not a thing you verify once; **the only evidence that a
check works is a failing run you produced on purpose, and it expires the moment the check
changes.**

**Then a reviewer found a fourth**, and it settled the design argument. `uses:
"actions/deploy-pages@v4"` — valid YAML, quoted, naming the identical action — was invisible
to the detector, so a second Pages-deploying workflow with the flag reversed passed the whole
gate. Reproduced here: exit 0.

Four rounds, and every fix had been a fix to a *form*: unquoted `uses:`, compact `- uses:`,
block mappings, inline mappings, quoted scalars. **There is no argument that the list of
forms is now complete, and each round had been declared sound with the same confidence as
this one.** A hand-rolled YAML parser has an unbounded blind-spot surface, and the failure
mode is always silence.

So the universal claim was withdrawn. The test no longer asserts *"no workflow can cancel a
Pages deployment"* — it asserts *"no workflow **on disk**, in a form this check can read"* —
and the gap that leaves is closed from the other side, by pinning the population:

- **The set of workflow files is asserted exactly.** Any workflow added, removed or renamed
  fails, in whatever dialect it is written, and a person must open it, check its concurrency
  group against the Pages group, and update the list. A parser meeting an unfamiliar spelling
  fails silently; **a file list fails loudly and cannot be evaded by syntax.**
- **The deployment's effective concurrency is pinned by value** — group `pages`, flag
  `false` — so a change survives even if the structure moves somewhere the parser reads
  differently.

That is a weaker claim and a stronger instrument, which is the trade this section has been
recommending to other people since its first entry. **The check that can be defeated by an
unfamiliar syntax was replaced by one that cannot, at the cost of admitting it only detects
change rather than danger.**

One coda, because it is the same error one level up. I concluded that reviewer had **never
run** — `updated_at` frozen thirteen seconds after creation, nothing after a direct probe —
and I reported that to two sessions as a finding about the delegation mechanism. I even ran
a positive control first: another session, demonstrably alive, showed a current `updated_at`.
**That control established the field *can* move, not that it moves whenever a session is
working** — sensitivity, not completeness, which is precisely the distinction published three
paragraphs above it. The reviewer was working the entire time and returned the best-evidenced
findings of the day. **I applied my own newest rule to a detector I built and failed to apply
it to the one I was using to judge a colleague.**

The session store settles the timings, and they are worse than that account. A sibling
resolved them rather than accept either party's recollection; re-derived here, the reviewer's
first turn **completed** carrying a `Request changes` verdict about half an hour before I
published that it had produced nothing, with `updated_at` never moving off thirteen seconds
in between. The reading turns on one fact worth stating because I had it backwards in my own
notes: `turns.timestamp` is the turn's **completion** time, not the arrival time of its
message. Proof is that turn 0's `user_message` is byte-identical to `sessions.summary` — the
kickoff, present at creation — yet is stamped twenty-four minutes after creation for that
session and seventy-two for this one. **A kickoff cannot arrive an hour after the session that
was created holding it.**

The rung is not the mistake, it is which of two instruments got reported. My inbox was empty,
and that was true, checkable by me, and the only thing I actually observed. `updated_at` was
frozen, which meant nothing. I published *"it has produced nothing"* — a claim about another
party's internal state, for which I had no instrument at all — when the supported sentence was
*"it has sent me nothing."* **Both render in English as "nothing has happened," and only one of
them was mine to say.** That is the same shape as the duration error recorded against me the
same evening, where a correctly measured elapsed time was reused one clause later as a report
latency: *a quantity true of one subject, restated about a different subject, in words that fit
both.* Neither has a tell, and in both cases re-resolving the source would have confirmed the
measurement and missed the substitution.

One limit stayed open for two hours, and it is worth keeping as written before it was closed:
*the store shows the reviewer's turn completing, not whether that turn was delivered anywhere,
so "it had produced a verdict" is established and "it had sent one" is not.* The distinction is
the same one this coda is about, and it would have been poor form to lose it while writing the
entry.

That limit is now closed, and closing it produced a better instrument fact than the entry it
was blocking — and then, hours later, a defect in the fact itself. Three consecutive turns in
this session are stamped within **five milliseconds** of the clock reading on the message that
opens the *next* turn — the same offset three times, which is not three independent events. A
cross-session message written while the recipient is busy is therefore held and released at the
recipient's turn boundary, so the two readings are one event. That gives delivery a bound where
before there was none. The verdict was produced by
`21:56:55.065`; it was demonstrably *not* in this session's context during the turn that ended
`22:27:00.533`, since that turn published the opposite; and it is the message that opened the
turn ending `22:45:44.615`. Delivery therefore falls in that window, and the gap between
produced and delivered is **at least thirty minutes and five seconds** — a bound, not a point,
because the exact instant is no longer recoverable. The two-instrument distinction stops being a
distinction and becomes an interval with two named ends. The corollary is worth more than the
closure: **the timestamp on an incoming message is when the reader became free, not when the
sender sent it.** Correctly measured, of a different subject — the same class, discovered inside
the instrument being used to audit that class.

The defect in it is the direction, and the direction was never read. The paragraph above
originally said the turn was stamped four milliseconds **before** the clock on the next
message; the store says the opposite, five milliseconds **after** it, in five pairs across two
independent session stores — two re-measured here, three reported by a sibling from its own.
The inversion is not a transcription slip, because it is precisely the direction the account
required: a message delivered *at* completion carries a clock reading at or after the stamp and
never before it. **The wrong sign and the wrong mechanism are one error, and each made the
other look supported.** A sibling proposed the competing account — the turn row is finalised
when the next input arrives, making the offset a write latency — which fits the identical rows
and dies on two counts: twenty-one sessions in this store had their final turn before
`2026-07-27T00:00Z` and every one has its final turn stamped, a row that account cannot write;
and the reviewer's turn 1 is stamped `21:58:27.392` while the message opening its turn 2 was
sent no earlier than `22:07:09.222`, eight minutes forty-two seconds clear. What survives is
neither: the next turn's clock and the previous turn's row are two reads bracketing one
boundary, in that order, five milliseconds apart.

The rung is that **the corollary never needed the mechanism.** The alignment alone fixes the
incoming clock to the recipient's boundary; the mechanism was added because it made the
sentence sound explained, and the added part is the only part that was false. The observation
was sufficient before it was justified, and justifying it introduced the sole refutable claim
in the paragraph. **Over-justification is a risk and not a courtesy.** It also has a companion
already recorded three rungs above — the evidence that killed the competing account is the
nine-minute reviewer case, collected an hour earlier for an unrelated question and never
re-read against this one. *Evidence is filed under the question that prompted it,* and nothing
prompts a second reading.

The rung, however, is the near-miss that fact caused. Reading three four-millisecond offsets, I
concluded the field was arrival rather than completion, that the paragraph above was wrong, and
that a sibling who had adopted and committed the reading needed telling. **It survives, and the
discriminating case was cheap:** if the stamp were the next message's arrival, the reviewer's
turn 1 stamp of `21:58:27.392` would be when this session's status check landed, and that check
was sent inside a turn bounded by `22:07:09.222` and `22:27:00.533` — eight minutes forty-two
seconds clear, minimum. What made the error possible is that **three readings existed and only
two were ever compared.** The original proof — a kickoff cannot be stamped an hour after the
session created holding it — eliminates *arrival of the turn's own message* and says nothing
whatever about *arrival of the next one*. **Eliminating one alternative is not confirming
yours unless the space has been enumerated**, and a proof that discriminates against the
reading already rejected feels exactly as conclusive as one that discriminates against the
reading held. The control was
in this session's own conversation the entire time and cost a single query, which is the same
free-and-therefore-invisible shape recorded twice above.

A second discriminator exists, it is independent of that one, and it was inside a dataset both
sessions had already swept: **fifteen sessions have exactly one recorded turn, and all fifteen
turn 0 rows carry a timestamp** — all fifteen created on an earlier calendar day, so none is a
turn still in flight. A field meaning *when the next message arrived* cannot be populated when
there is no next message. Nobody ran that query, and the reason is the point: the sweep that
produced those rows was aimed at *how large is my sample*, and the evidence for *how many
readings survive* was in the same table. This is the sharp edge of the rung, because the
obvious repair does not reach it. A sibling widened the original proof from three sessions to
sixty-nine, which is the complete remedy for a badly aimed sample and **no remedy at all here**
— every one of the sixty-nine is consistent with both surviving readings, since each predicts a
large positive delta from creation. **Widening the population fixes the sample; it cannot fix
the space.** The two failures are orthogonal, and only the first is repairable after the fact
by collecting more. So the pair of rules this section already carries — consult a primary
source, and name the population you consulted it on — needs a third that neither implies:
**enumerate the readings the answer could have.** A query answers the question asked of the
data; enumerating the space is what makes it the right question.

That sentence originally read *ten of them created on earlier days*, and a sibling recomputed it
rather than reading it: the day-boundary predicate returns **fifteen** in UTC and fifteen shifted
to local, while `julianday('now') - julianday(created_at) > 1` returns ten. **Ten is "older than
twenty-four hours", which is not what the sentence claimed.** Third instance in one session of
the same defect — *the cells are correct and the label is not the command that produced them* —
and the first where the mismatch ran against its author: the stricter test was the right one to
run for the purpose, the looser label undersold the evidence, and **an understated number is a
self-critical claim, which nobody has an interest in auditing.** The direction rule predicted
exactly this and it still went unnoticed for two hours.

The same sibling proposed that **enumerating the space requires a second party**, since a solo
author can widen a population indefinitely without leaving their own hypotheses. The claim is
too strong and this session's own record refutes it: the third reading of the timestamp field
was raised here, against a position already committed here; the aim defect in the four-case
sample was named here at 23:39:05, in the same turn that replaced it with a sixty-nine-row
sweep; and the inverted sign above was found by its own author. What every one of those has in
common is sharper than the rule it replaces — **none came from reflection; each came from
running an instrument for an unrelated purpose and reading a row nobody asked for.**
Enumeration is a side effect of measurement, not of thinking harder. That strengthens the
sibling's practical conclusion rather than weakening it: shipping a reproduction with a claim
works *because a reproduction is an instrument*, and instruments generate hypotheses in whoever
runs them — including the person who built one to defend a claim.

That list was audited by the sibling it names, which reported one case as misattributed to it.
The finding is right and the sentence above is what made it available: *the session that ran
it* names nobody, so each reader resolved the pronoun toward the other. **An ambiguous
attribution is not read as ambiguous; it is read as settled, in whichever direction the reader
sits.** Both offenders are now named instead of referred to, and the object is corrected too —
the aim defect was in the four-case sample, while the sweep was its remedy.

The store settles it in one column neither party had queried. The sixty-nine-row population
first appears here at 23:39:05, inside the same turn that names the aim defect; the sibling
reproduces it five minutes later and credits this session by name; and half an hour after that
its own ledger assigns the named-population leg to itself. So a misattribution exists and it
ran toward the sibling, not away from it, which is the reverse of the direction offered
alongside the correction — and that direction mattered, because the rule being applied was that
self-diminishing claims go unaudited.

The mechanism is worth more than the correction. The sibling did query the store, and quoted
two real rows; the excerpt of this session's turn stopped at the end of the aim-defect
sentence, and the next paragraph of the same turn is the eighty-row count that answers who ran
the sweep. **The excerpt was cut at the boundary of the question being asked**, so evidence
sufficient to settle a second question was collected and then trimmed away before it could.
That is the filing rule one level further in than it has appeared before: not which query gets
run, but how much of a returned row gets read.

The rule was restated a second time as a count — *four for four tonight* — and the count is
where it becomes visible why it survived. Of the eight commits from `6ec675a` to `e00a231`,
four record a correction that no incoming message had named, and all four reached the sibling
as messages from here. The same four events are self-generated from one seat and second-party
from the other, and only the receiving seat leaves a record. A count taken over hypotheses that
arrived can only ever be N for N, because arrival is the property being counted: the population
was selected by the predicate. That is the aim defect once more, inside the message adopting
the three legs as a rule, which is the strongest evidence yet that it is structural rather than
careless — it recurs in the act of writing down the rule against it. The consequence is
procedural. The correct population cannot be assembled by either party alone, because a
self-generated hypothesis leaves no trace in the channel that would display it; each side has
to volunteer its own, and that is simultaneously the only evidence that can refute the rule and
the one form nobody is prompted to produce.

One consequence for the direction rule stated elsewhere in this section: the unaudited direction
is not self-criticism as such. A reviewer here withdrew their own blanket rule — maximally
self-critical — and it was checked twice, by them and independently here, because **it shipped
with a reproduction attached.** A claim goes unaudited when nobody has an interest in building
the instrument for it; when the claimant supplies the instrument, the direction stops mattering.
The actionable form is not *be suspicious of your own bad news*, which is another discipline,
but **ship the reproduction with the concession**, which is structure and works both ways at
once.

#### Round five: the pin fired, and firing for the wrong reason is its own defect

A second reviewer, reading the pinned-population design, went after the thing the pin was
supposed to make safe to leave imperfect: **the group name.** Two spellings of it defeated the
comparison on a branch that had already survived four rounds.

| group as written | GitHub sees | this check saw | test named for the property |
| --- | --- | --- | --- |
| `pages` | the deployment's group | match | fails, correctly |
| `"pages"` / `'pages'` | the deployment's group | match | fails, correctly |
| **`PAGES`** | **the deployment's group** | **different group** | **passed** |
| **`${{ 'pages' }}`** | **the deployment's group** | **different group** | **passed** |

GitHub matches concurrency groups **case-insensitively**. `PAGES` is not a near-miss or a
trick; it is the deployment's own group, and a workflow declaring it with
`cancel-in-progress: true` could cancel a deployment while the test asserting that no workflow
can do so passed.

**The gate did fail — on the population pin, not on the hazard.** That is the finding, and it
is a defect in the pin's own theory rather than a vindication of it. A pin reports *"a workflow
was added"*, which is the message a maintainer resolves by **reading the workflow, deciding it
is fine, and updating the pin.** The one time that judgement is wrong is exactly the time the
group check needed to be right, and it was not. A backstop that fires for a reason the
maintainer is expected to dismiss is one honest mistake away from being no backstop.

So the pin stays and the readable subset was made correct: group comparison is
case-insensitive, folded and literal block scalars are resolved to their value, and a group
built from an expression is treated as able to produce any protected group whose name appears
inside it.

**The reviewer's own recommendation was measured and rejected on evidence.** They asked for
dynamic groups to be handled *conservatively* — any unresolvable group treated as dangerous.
Implemented as stated, that fails the build on this repository: `ci.yml` cancels deliberately
under `group: ${{ github.workflow }}-${{ github.ref ... }}`, which is unresolvable and
harmless, and three tests go red on the real file set. The substring rule is the weaker form
that survives contact with the repository it has to run in, and the case is now a permanent
negative control beside the positives.

Each of the three fixes was reverted individually against the new test to confirm it fails,
with the mutation's application printed before the verdict was read: reverting the
case-insensitive compare fails on `PAGES`; disabling block-scalar resolution fails on the
folded form; widening the expression rule to *"unreadable means dangerous"* fails on `ci.yml`.
**Five rounds, and the only reason there is a fifth is that somebody doped the part the design
had declared safe to leave imperfect.**

#### Round six: the pins covered the file set and one file's values, not the gap between

The same reviewer then found what neither pin reaches — **an edit to an existing pinned
workflow.** Changing only `ci.yml`'s `group:` to `"group": pages`, leaving its cancelling
expression untouched, keeps the file set identical and the deployment's values identical, so
neither pin fires. `"group"` is the same property as `group` to any YAML parser and was a
different one to this check, whose key pattern accepted no quotes. **Five tests passed while
CI could cancel a deployment.**

That is the sixth defect and the sixth to be a defect in a *form*. Answering it with a seventh
spelling would repeat what the previous five demonstrated does not converge, so the answer is
both halves at once:

- **The parser learns the form**, because round five established that the readable subset has
  to be correct underneath the pins rather than excused by them. Quoted keys are read, on the
  `concurrency:` line and on its children.
- **A pin that does not parse at all.** Every line in every workflow that mentions concurrency
  is collected as text — in any dialect, quoted or not, nested anywhere — and compared against
  a fixed list. A spelling this file has never seen still changes the text. **The failure mode
  of a parser is silence; the failure mode of a string comparison is noise, and noise is the
  survivable one.**

It is deliberately not a file hash. Comment-only lines are skipped and trailing comments
stripped, both verified by negative control: editing the rationale comment in `ci.yml` and
changing `permissions: contents: read` to `write` leave it green, while all three group
mutations fail it. **A gate that fires on unrelated edits gets disabled, and a disabled gate
is the one failure this catalogue cannot recover from.**

One instrument note, because it nearly produced a false negative. A probe script threw while
formatting output *after* writing the mutation and *before* the restore in its `finally`, so
the next run's baseline was silently the mutated file. It surfaced only because the harness
prints whether each mutation landed and one reported `False` for an edit that should have
applied — **the restore had already made it true.** The `APPLIED:` print earned its place
again, this time by catching contamination rather than absence.

#### Round seven: the pin caught all three, and that is not the same as the guard working

The same reviewer returned with three more mutations of `ci.yml`. The text pin caught **all
three** — its first live test, and it passed. The parser caught **one**. That gap is the whole
entry, because a pin that fires says *"the concurrency lines changed"*, and a maintainer
resolves that by reading the diff and updating the pin. **The instrument that fires and the
instrument that understands are not the same instrument, and only one of them makes the
maintainer's next move the right one.**

| mutation on `ci.yml` | parser | text pin |
| --- | --- | --- |
| `"group": pages` — quoted key | **caught** (round six) | caught |
| `group: >2-` / `>-2` — block header with an indentation indicator | missed | caught |
| `${{ format('{0}{1}', 'pa', 'ges') }}` — assembles the name without spelling it | missed | caught |

The block-scalar miss is a readable-form defect and was fixed as one: the YAML header carries
an optional indentation digit in either order, and the check accepted neither.

The `format` miss is different in kind and is the first defect here that **cannot** be answered
by learning another form. No list of spellings closes it, because the group is not spelled —
it is computed. So the rule was restated as being about *readability* rather than danger: **an
expression carrying a construct this check does not model is treated as able to produce the
protected group.** A function call is the detectable form of "not modelled".

That is fail-closed, and the price is stated in the source rather than discovered later: a
legitimate `format('ci-{0}', github.ref)` group is reported too. It is defensible only because
of a distinction this document made two rounds earlier and had to apply against itself — **it
fires on a concurrency edit whose safety genuinely cannot be decided here, not on an unrelated
edit.** The `permissions: read → write` control stays green. A gate that cries about the
subject it guards is survivable; one that cries about everything else is not.

Both were measured before shipping, and the measurement is the reason the rule is this narrow
rather than the reviewer's original. **Blanket "every dynamic expression is dangerous" turns
three tests red on the real file set** — implemented and confirmed independently by both
parties, and withdrawn by its author. The function-call form turns **none** red, because no
workflow here calls a function in a group.

And it closes one bypass, not the class. Measured, not assumed: `${{ github.event.inputs.g }}`
and `${{ env.GROUP }}` name nothing and call nothing, can resolve to anything, and remain
invisible to the parser — **caught by the pin alone.** Which is the honest summary of seven
rounds: *the parser is a heuristic that gets better, and the pin is the thing that is actually
load-bearing.* It took six rounds of trying to complete the parser to be able to write that
sentence.

#### Round eight: the pin was defeated, and the defect was the claim made for it

One round after calling the pin load-bearing, the same reviewer defeated it. A job keyed
`"\u0063oncurrency"` with `"\u0067roup": pages` is valid YAML that decodes to a cancelling
block, and **contains none of the words the pin searches for**. Seven of seven passed. They
verified the decoding against the runner's own parser dependency rather than the spec alone,
and caught a contamination in their first attempt — a probe named *"Encoded concurrency
probe"*, whose display line tripped the pin for the wrong reason. **A probe containing the word
the detector looks for tests the probe, not the subject**, and that one was caught before it
could be reported as a pass.

The defect is not the missing escape form, it is the sentence shipped alongside the pin: *"this
pin does not parse."* **It does. A keyword filter is a lexer, and it has exactly one structural
assumption — that the words appear literally in the source.** The assumption was real, was
never stated, and was therefore never tested. Every earlier round in this section is a check
that was wrong about YAML; this is the first one that was wrong about *itself*.

So the fix is to make the assumption a test rather than teach the pin one more encoding. YAML's
double-quoted escapes are a closed list, and **only the hex forms can produce an ASCII letter**
— the named escapes yield control characters, space, slash, backslash, quote, NEL, NBSP, LS and
PS, none of which can spell part of a keyword. Rejecting hex escapes closes the letter-hiding
class rather than one member of it, which is the first fix in eight rounds that can say so.

The cheaper rule was measured and rejected. Both workflows contain **zero backslashes of any
kind**, so banning all of them would also have been free today — and would fire on the first
multi-line `run:` or Windows path anyone adds. Both were run as controls and both stay green
under the hex rule. *Free today* is not the test; **what it costs the day someone writes
ordinary YAML is the test**, and that is the same reasoning that kept the blanket expression
rule out one round earlier.

One member is examined and deliberately left open, on the terms this section now uses for
things it cannot close: a double-quoted scalar may carry a line continuation, so a keyword can
be split across two lines where no per-line scan sees it. As an implicit mapping key that is
not valid YAML, and a rule against trailing backslashes would fire on every multi-line `run:`
in the repository. Recorded, not guarded.

A closing qualification, because *closed by proof* sounded stronger than it is. A sibling
session reached the same boundary from the other side and went one step further than this fix
can: their head-pose write passes the Euler order as an argument on every frame, so a runtime
reassignment is overwritten rather than detected — **an invariant that reasserts itself, not a
guard that can be walked around.** That option is unavailable here, and the reason is not the
domain. `cancel-in-progress` is read off the *incoming* run, so a Pages deployment cannot
declare itself uncancellable; the property that must hold belongs to whoever writes the next
workflow file. So the enumerability boundary has three boxes rather than two: an **open** domain
is not completable and the pin plus a maintainer's judgement is the mechanism; a **closed,
self-owned** property should be reasserted, which removes the need to detect at all; a
**closed, other-owned** property admits a provably complete detector and nothing better. This
round is in the third box. **The discriminator is not the size of the domain, it is who owns
the property** — which is why a complete detector here is still permanently a detector.

#### Round nine: the rule was right and the scope was the file

The escape rule shipped in round eight scanned every line of every workflow, and the next round
rejected it from the opposite side: `run: printf '\x1b[32mAll gates passed\x1b[0m\n'` is ordinary
shell, YAML never decodes it, and the gate fired on it and named it. **That is precisely the cost
the commit shipping the rule said the rule avoided.**

The rule was not wrong; its scope was the file rather than the assumption. Two facts narrow it to
exactly what the pin needs, and both are closed rather than enumerated. First, **YAML decodes
escapes only inside double-quoted scalars** — plain and single-quoted scalars carry backslashes
through literally, so `'\u0063oncurrency'` is simply a key of that name and collides with nothing.
Second, **a keyword can only be hidden from the pin in a key**: the pin holds an exact list of
lines mentioning the three words, and any line carrying one of them as a *value* still carries its
own key literally, so it stays on the list. Only escaping the key removes the line. The scan is
therefore double-quoted mapping keys, and YAML has exactly two key syntaxes — implicit
(`key: value`) and explicit (`? key` / `: value`) — which keeps the enumeration closed. Values,
block scalars and shell source are no longer read at all.

**The lesson is about the controls, not the rule.** Banning all backslashes was measured and
rejected last round against a shell continuation and a Windows path, and both stayed green under
the rule that shipped, which is how it was reported as costing nothing. Neither contains a
complete hex escape. **They were the two forms already imagined by whoever chose the rule** — a
false-positive control set is a sample like any other, and that one was aimed by the same
imagination it was meant to audit. The replacement is drawn from a population instead, ordinary
workflow content containing backslashes: eleven cases, five encoded-key attacks and six benign,
each printed with whether the mutation landed and which test failed by name. All five attacks
fail on that test alone; all six benign cases stay green.

One instrument note, because it nearly cost the result. The first harness reported exit codes and
matched TAP output to name the failing test, but `node --test` prints the spec reporter, so every
positive case printed `exit=1` beside an **empty** list of failing tests. Exit 1 is *the suite
failed*; the claim being made was *this test fired*. The two were one regex apart, and the only
reason the gap surfaced is that the harness prints its own detail next to its own verdict, so the
disagreement was visible on the summary line. **An instrument whose summary cannot contradict its
detail would have reported five clean passes for the wrong reason.**

#### Round ten: the scan read lines when the position is what decides

The tenth defect is the ninth one level down, and it was found by the same reviewer inside
twenty minutes of the fix landing. `run: printf '%s\n' '{"caf\u00e9":true}'` is a plain YAML
scalar carrying a shell command carrying JSON, and the narrowed scan read the quoted token
before the colon as a mapping key. The gate fired on it, naming an unrelated line, and no
concurrency-shaped payload was required to do it — the JSON key is `café`. Reproduced exactly
against `2737068`: mutation landed, exit 1, that test alone.

The controls are where the lesson is, again. The ninth round replaced its imagined
false-positive set with a population and said so; **the population was ordinary content
containing backslashes, which is a population of the wrong dimension.** Its `N6` case put an
escape in a JSON *value* and therefore never exercised the colon-after-quote heuristic that the
whole fix turned on. A control one field away from the rule certifies nothing, and the
paragraph certifying it had been written with the previous round's lesson explicitly in hand.
**Widening the sample does not help when the axis is wrong, which is the same distinction —
sample against space — recorded three rungs above about hypotheses rather than controls.**

So the fix is positional and the controls are positional with it. YAML admits a double-quoted
mapping key in exactly three places: the first token of a block-mapping entry, after an
explicit `?`, and inside a flow collection. Everything else on a line belongs to a value, and a
value is text unless it opens `{` or `[` — and a plain scalar *cannot* begin with either, which
makes that a decision rather than a guess. Block-scalar content is skipped by indentation, flow
collections are tracked across lines by depth, and tags and anchors are stripped because they
precede a node without being one. The ninth round's sufficiency argument survives unchanged and
now rests on position rather than spelling: a keyword can only be hidden in a key, every key
position is scanned, and nothing that is not a key position is.

Nineteen cases, enumerated over positions rather than forms: eight key positions that must fire
and eleven value, comment and block-scalar positions that must not. All nineteen correct, each
printed with whether the mutation landed and which tests failed by name. Two of the positives
also fail the text pin, which is right — they spell `concurrency` literally and are not on the
pinned list.

One instrument failure, and it is the worst of the night. The first reproduction attempt used
`[IO.File]::ReadAllText` with a path relative to a probe worktree, and .NET resolves relative
paths against the *process* directory rather than PowerShell's. **So the harness mutated the
live repository, ran the guard in the untouched probe, and printed `mutation applied: True`
beside a green result** — a false refutation of a correct report, with every line of the output
true. It survived only because the restore in the `finally` was wrong in the identical way and
put the file back. The tell was available and I nearly missed it: the reviewer's measurement
and mine disagreed, and **a disagreement with a careful party is evidence about the instrument
before it is evidence about the claim.** Absolute paths now, and the harness prints the landed
line.

#### A gate of my own: the count was fine and its predicate had a clock in it

A sibling reported that its own "six sessions idle beyond fifty hours" had been a `LIMIT 6`
restated as a census. Mine was not: twenty-one reproduces with no limit clause, and all eighty
sessions carrying turns have a stamped final turn. **The predicate was the defect instead.**
Idleness is measured against `now`, so the same query over the same unchanged rows returns 11
at 01:00, 20 at 02:00 and 21 at 02:52. The number nearly doubled inside two hours while the
data stood still, and it went into a permanent document as though it were a measurement.

This file's gate named `no spec makes a status claim that can only expire` did not fire, and
the reason is worth more than the fix. Its nine patterns all name an unfinished state, an
absent artefact or a pending merge — every one a phrase that *advertises* its own volatility. A
relative-time threshold advertises nothing: `twenty-one sessions have been idle over fifty
hours` reads exactly like a finished measurement. **The gate detects the vocabulary of
currency, not the semantics of a moving referent**, and the perishable claim with no currency
vocabulary in it is precisely the one that gets written down.

The distinguishing property turns out to be tense rather than wording. `One limit stayed open
for two hours` and `twenty-one sessions have been idle over fifty hours` are the same
construction; only the first has both ends nailed to named events. That suggested a mechanical
rule, so the population was counted before the rule was written: twenty-four
number-plus-time-unit lines across the three specs, of which twenty-two are closed intervals
between two named events, two are anchored at reading time, and one carries a count. **A guard
would have been wrong on twenty-three of twenty-four**, which is a refutation obtained for one
query rather than for another reviewer round — the tenth round's discipline moved one step
earlier, to before the guard exists.

So the remedy stays an authoring rule, and it is one already written in this section: cite
endpoints, not lengths. It was derived for commit ranges after the same gate rejected `the
eight most recent commits`, and it was never carried across to time. **Third instance in one
session of a rule held in this repository, about the exact thing in front of its author, and
not applied.** Both offenders are pinned: the count now names `2026-07-27T00:00Z`, and a nearby
`for two days` names its first entry.

One instrument note, and it is the same family as the `[IO.File]` path failure two rounds up.
The re-wrap ran inside a PowerShell function that printed progress with `Write-Output`, which
joins the function's **return stream** — so two progress strings were prepended to the document
as lines 1 and 2. Every check aimed at the edit passed: longest-line unchanged, the over-120
set identical to `HEAD`, the paragraph diffs correct. **A contamination lands where nothing is
looking precisely because the looking was aimed at the thing being changed.** Reading the whole
diff rather than the changed hunks is what caught it, and it is the cheapest habit in this
file.

Writing that paragraph made the gate fail, because quoting its pattern list is
indistinguishable to it from using those phrases — the use-versus-mention defect that took ten
rounds to remove from the deployment guard, sitting in a second guard in the same suite.
Markdown offers a clean structural exemption, since a code span is always a mention. **It was
measured and refused.** Across the three specs there are 1,817 code spans and exactly one line
matching any pattern, so an exemption would be validated against an empty population of real
offenders, and it would hand every future expiring claim a legal disguise costing one backtick.

That is the opposite call from the tenth round, and the difference is not correctness, since
both are false positives on content nobody should be punished for. The tenth round rejected
ordinary JSON that any workflow author might write, an open population that has to keep being
served. This one rejected one paragraph written by the guard's own author about the guard,
where routing around it costs a sentence. **A false positive earns a fix when the population it
rejects is one you must keep serving, and a reword when it is not.**

The sibling then supplied its own side of the count, which is the only thing that could test
the rule rather than restate it: four self-generated corrections against thirteen named by an
incoming message, all four of which travelled outward. **So from each seat every one of the
other's self-generated findings arrives labelled as a second-party contribution**, and the
symmetry is confirmed from both ends instead of asserted from one. Its stated range needs one
character to reproduce — `ea7bbcb..2fc9685` counts sixteen, and thirteen plus four needs
`ea7bbcb^..`, an interval whose notation excludes the endpoint the count includes.

Its own addition is better than the correction it arrived with. **Commit granularity
undercounts**, because several self-generated findings ride inside commits whose headline
correction came from someone else, so the unit of counting was itself a population choice
neither party made deliberately. That is the aim axis one level below where both of us had been
applying it: we had been asking whether the population was well chosen and never whether the
*unit* was.

The mechanism turns out to be a missing field rather than a selection effect, and the store
says so directly. Sixty-seven turns in this session from 18:00Z: the body of every inbound
message is retained in `user_message`, the `from_project_session_id` identifying its sender
survives in **none** of them, and an outbound message has no field at all — it exists only as
prose the sender wrote about having sent it. **Attribution is precisely the column the record
does not keep, in both directions.** So a count of second-party contributions cannot be taken
from the data by either party; it can only be taken from narration written at the time by the
party with an interest in it.

That closes three separate defects with one cause. The sibling's ledger assigning this
session's population to itself, the unresolvable pronoun corrected in `9ced1fd`, and both
parties' N-for-N counts are the same event: **a body arrives with its sender stripped, and half
an hour later the label is all that remains.** The remedy is the instrument that settled the
previous exchange, and it generalises — first appearance across the two turn tables, ordered by
timestamp, is the only attribution evidence either party holds. It is exact, it is cheap, and
it went unused until the exchange that produced `9ced1fd`, because attribution had never been
the question anyone was asking.

One observation of the sibling's is worth recording because it reframes the suite: **the yield
moved.** Every gate here was built for code, and the catches through this correspondence have
been in documentation — the expiring-status guard on a commit-range phrasing and again on a
quoted pattern list, the mangled-join test on three consecutive re-wraps, `docs:facts` on stale
acceptances. Nobody designed for that, and it is where the defects were.

#### Widening a population cannot strengthen a refutation

The clock finding above travelled to the sibling session, reproduced there, and came back with
a simplification that does not survive. The claim is that the load-bearing fact never needed
the idleness filter at all, because all eighty sessions with turns carry a stamped final turn,
and that sentence has no clock in it. It has no clock and it also has no argument. The account
under test says the row for turn N is written when the input opening turn N+1 arrives. A
stamped final turn refutes that only where no next input ever arrived, which is exactly what
idleness establishes. Among all eighty are sessions that were mid-conversation, whose final row
is stamped precisely because the next message did arrive — rows the hypothesis predicts,
counted as evidence against it.

Measured while writing this. Three sessions had a turn inside the last quarter hour and six
inside the last hour, the two most recent being this session and the sibling's, both at zero
minutes elapsed. This session's own final row is the cleanest available example. Turn 308
carries `2026-07-29T01:15:44.989Z`, and the message opening turn 309 carries `01:15:44.983Z` —
six milliseconds earlier, the thirteenth consecutive instance of that sign and the first where
one side of the pair came from outside the store rather than from a report about it. That row
is stamped because the next input arrived. It sits inside the eighty and outside the
twenty-one, and citing it against arrival-of-next cites the clearest demonstration of
arrival-of-next.

The rung is that a clock and a filter are different defects, and dropping the filter is not a
way to fix the clock. The clock lived in the predicate's form, an interval measured from the
moment of reading, and anchoring the endpoint removes it while keeping the filter — which is
what the corrected sentence does and why it is stable. Widening from twenty-one to eighty
removed the clock a second time and paid for it with the discrimination. Stated generally:
**widening a population cannot strengthen a refutation when the added members are predicted by
the hypothesis.** The added rows are not weak counterexamples, they are the hypothesis's own
predictions, and an aggregate that mixes them is no stronger than its most idle member. This is
the same reach recorded one entry above, where the instinct on finding a clock was to
substitute the bigger number, and the bigger number was the one that cannot discriminate.

#### Rules that fire leave no record, so the sample is all failures

The sibling's diagnosis of the truncated excerpt — a correct query over the right population,
trimmed to the width of the question before being read — prompted a check of whether the
instrument shares the fault. It does not. A five-thousand-character response was requested
whole and delivered whole; the tail computed inside SQLite matches the tail received, character
for character, at 5,327. That failure is therefore entirely author-side, which makes it worse
rather than better. The store returned everything and the reader asked for less.

The row pulled as test data for that check contained the more useful finding. It is the longest
response in this session's store, and it is the one recording corollary 196 — an instrument
that cannot fail is not passing — together with the commitment that follows from it, that zero
output is never accepted from an instrument which has not been seen to fail.

That commitment fired twice tonight and left no trace either time. `gh run list --commit`
returned null for a run that existed, and the query was reissued against the branch with a
filter on the head SHA. A filter for `^# pass` over the test output matched nothing, because
the runner prints its summary behind an information sign rather than a hash, and the tail was
read instead of a zero being reported. Neither felt like applying a recorded rule; both felt
like ordinary caution. Neither produced a defect, a commit, or a line in any ledger.

Which exposes the defect in a thesis both sessions have been building all evening. Five
instances were counted of a rule held in this repository, about the exact thing in front of its
author, and not carried forward. Every one of those instances is visible because it produced a
defect that somebody then found. A rule that fires produces nothing at all. **The sample of
rule-applications consists entirely of failures, because failure is the property that generates
the record** — structurally the same defect as counting hypotheses that arrived and finding N
for N, one level up and about rules rather than findings.

The correct model was already written, in the same file, under a heading that states it
outright: the rule did not stop me, it shortened the round trip. Cataloguing a class does not
prevent the next instance; it makes the correction arrive in one round instead of never. That
is a claim about latency, and a five-instance count scores rules against prevention, which is
the wrong bar and one this programme had already rejected in writing. The count is not evidence
that rules fail to generalise. It is evidence that the ones which fail are the only ones that
can be counted.

#### The two stores do not differ; the sentence reporting them did

The sibling reported its store as the starker case — the cross-session wrapper stripped before
storage, so no sender field exists to be empty — against this one, understood to retain a field
that is merely null. Measured across all 311 turns of this session: `from_project_session_id`
appears in none, `from_session_id` in none, and the wrapper tag in exactly one. **The two
stores behave identically.** The difference was an artefact of the sentence that reported the
first measurement.

That sentence was that the sender identifier survives in none of sixty-seven turns, which reads
either as a column present and null throughout, or as an identifier that never reaches storage
at all. The second was meant and the first was read. This is the ambiguity rule recorded two
entries above, written there about attribution and now earning a wider statement: **an
ambiguous measurement report is not read as ambiguous, it is read as settled, in whichever
direction the reader sits.** The direction available here made the reader's own store the
distinctive one.

The corrected measurement is sharper than either statement of it. The single row carrying the
wrapper tag is a message body in which the correspondent wrote the phrase by hand, and the only
rows naming a session identifier are bodies quoting one in prose. Five system notifications
name a session precisely, and do so solely to report that it finished processing. **The
substrate contributes no sender identity whatever; every surviving trace of one is voluntary
narration by a party** — which is the same channel whose relabelling produced the
misattributions this enquiry began with, so the only attribution evidence in the record is of
the kind already known to fail.

The timing is the result worth keeping. The entry immediately above concludes that cataloguing
a class does not prevent the next instance but shortens the correction to a single round. The
ambiguity rule was written two exchanges before its author violated it, and the violation was
corrected in the exchange that followed. That is the latency model confirmed on its own author
within the hour, and it remains the only form in which either claim can be observed working at
all.

#### A property of another party's instrument, asserted from no evidence

A pair measured in this session was reported as the first whose two halves have independent
provenance, on the grounds that the stamp came from SQLite and the message clock from the
prompt. The sibling accepted it and recorded a hole in its own twelve pairs — that it had been
the transcriber on both sides. **That hole was never established.** The sibling's message
states only that the sign holds over twelve consecutive turns and that this is every pair it
has; it says nothing whatever about where its message clocks came from. A property of another
party's instrument was asserted from no evidence, and it was accepted because it arrived as
praise for the asserter's own measurement rather than as criticism of theirs.

The mechanism is again the sentence, for the third consecutive exchange by the same author.
*The first where one side of the pair came from outside the store rather than from a report
about it* reads either as a claim about this session's access, that twelve arrived as reports
and one was read directly, or as a claim about the series, that no earlier pair had independent
halves. The first is true and small. The second is unfounded and interesting. The reader took
the second.

Two instances one exchange apart now permit the ambiguity rule to be corrected, and as stated
it was wrong. It read *settled, in whichever direction the reader sits*, which implies
self-interest. Measured: the first resolution made the reader's own store the distinctive case
and favoured them; the second located a hole in the reader's own work and cost them. **The
constant is not who benefits but that a distinction exists.** Ambiguity resolves toward the
reading under which something new is being said, whoever it costs — which is a worse property
than self-interest, because self-interest at least has an auditor sitting opposite.

One further defect in the same sentence. *The thirteenth consecutive instance* merges two
series held in two stores; twelve consecutive turns in the sibling's store and one observation
in this one do not form a run of thirteen, and the word performing the merge is the
unit-of-counting problem recorded two entries above. What survives is exact and much smaller:
**within this session, one pair whose halves were read directly rather than received as a
report, agreeing in sign and in magnitude with a result reported by the other party.**
Everything beyond that belongs to whoever can state their own provenance.

#### The unrecorded population cannot be counted, and that includes by me

The sibling supported the previous entry with a measurement: twenty-nine silent successes of
one rule against five recorded failures across all rules. Counted here against their stated
head, the range gives thirty rather than twenty-nine, and twenty-nine matches the same range
one commit earlier — **a count taken at one commit and published against another**, which is
the defect recorded by the very commit being counted from. Third instance of a range endpoint
from the same author, and the smallest.

The larger objection is that the number cannot mean what it is offered to mean. **If a success
leaves no record, no count of successes can be drawn from the record.** What is countable here
is commits at which the check ran, and that is recorded, in every verification block. What is
absent is any evidence that a run prevented something. Zero findings across thirty runs is
precisely the profile corollary 196 describes: an instrument that never fires is
indistinguishable from an instrument that cannot fire.

There is a mechanism for the zero, and it is not prevention. The rule was created by fixing the
defect, and the practice it installed — printing all three heads together — makes that defect
visible at the moment it would occur. Thirty occasions on which a defect had no opportunity to
form silently is not thirty preventions. The count is of opportunities removed by construction,
which is a different quantity and a much less interesting one.

The same objection lands on the evidence offered in the previous entry, which was this
session's. Two cautions were reported there as silent applications of a recorded rule.
**Neither can be shown to have been caused by it.** Both may be caution that would have
occurred had the rule never been written, and the counterfactual is exactly what is not stored.
That is the missing column from two entries above, one level up and about causes rather than
parties: not who said it, but what produced it. Both survivors are therefore narrower than
either party wrote them. **Any number that can be produced for the silent population is a count
of something else** — runs, opportunities, or commits — and **a rule's application is
unattributable even where the behaviour is observed.**

### 6.2 Known residue: sign-only assertions guarding loops

Thirteen assertions across my four art test files (`art`, `worldArt`, `characterArt`,
`mergeOwnership`) take the form `assert.ok(x > 0)` or `assert.ok(xs.length >= n)` with no
message; the same shape appears **46 times across the whole `tests/` suite**, so this is a
house habit rather than a foundation defect. Most are fixture guards and harmless. A few are
**floors standing in front of the loop that does the actual testing** — `worldArt.test.ts`'s
prop-colour check asserts `parts.length >= 1` and then iterates, so a builder that silently
returned fewer parts would shrink the covered population without failing anything. This is
§6's own rule (*prefer magnitudes and exact counts to signs and inequalities*) unapplied to
the tests that enforce §6.

They are listed as a class rather than by line number, because line numbers rot and the
detection is one command. Note the leading `\s*`: assertions inside a `test()` body are
indented, and the same pattern anchored at `^assert` returns **zero** on this repository
while thirteen of them sit in the files it names.

```powershell
Select-String -Path tests\*.test.ts -Pattern '^\s*assert\.ok\([^,]*[><]=?\s*\d+\)$'
```

That anchoring bug is not hypothetical — it is the first form this section shipped with,
caught only by running the published command instead of trusting the measurement it was
derived from. The measurement had trimmed each line; the command could not. **A count and
the command that is supposed to reproduce it are two different instruments, and agreeing
about a number is not the same as measuring the same population** — the count above is
thirteen for four files and forty-six for the suite, from one pattern.

Not fixed here: converting a floor to an exact count requires knowing each true population,
and two of the four files are open in sibling pull requests. **Whoever narrows one should
assert the count, not the sign, and should watch it fail once first.**

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
site (PropKit.ts line at time of measurement; positions drift, the sites do not)
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

### 7.0.5 What the visual QA cannot answer, measured rather than assumed

The metalness fix divides the toon band driver by `kAlbedoLuma * max(1 - metalness, 1e-3)`
rather than by `kAlbedoLuma` alone. For the `metal` surface — `metalness: 0.35` — that is
a factor of **1 / 0.65 = 1.538× on `kLit`**, which is why the pre-fix shader could not
push a metal surface into the top toon band.

The programme lead asked for the guard/palace start to be re-captured after the fix, on
the grounds that the earlier sign-off — *"metal armour reads"* — had been taken against
the unfixed shader. Reasonable, and the answer is not the one either of us expected.

**A/B with only that line changed**, same seed, faction, viewport and toggles:

```text
                       mean    p95   p99   max   >160    >190
pre-fix  kAlbedoLuma   83.01   115   145   245   2154    1369
shipped  kDiffuseScale 82.98   115   144   245   2131    1367
delta                  -0.03     0    -1     0    -23      -2
```

**The frame is identical within noise.** A 1.538× change to the band driver for every
metal surface in the scene moves the aggregate luminance histogram by less than a
quantisation step.

That is not evidence the fix does nothing — the arithmetic is not in doubt. It is evidence
about the **instrument**: a full-frame luminance histogram cannot see a large change
applied to a small pixel population, and `surface: 'metal'` has six call sites in
`GameEngine.ts` and none in `CharacterKit.ts`, so the armour vocabulary in question may
not be what fills this viewport at all.

> **The capture neither validated nor invalidated the original sign-off, and could not
> have.** Reporting "metal reads" from this instrument was a claim outside its domain in
> both directions — before the fix and after it.

What would answer it: a capture framing a known metal object over a known pixel region, or
reading `kNormalized` back from the shader for a metal material directly. Neither is
expensive; both are follow-ups rather than blockers, because the defect being fixed is
arithmetic and the arithmetic is checked by the chunk pin in `tests/art.test.ts`, which
fails loudly if a three.js upgrade moves the accumulation the fix depends on.

### 7.0.6 The follow-up above, run: count bands, not brightness

§7.0.5 left the question open and named what would close it. This is that measurement.

**Ask the question the ramp actually answers.** `kScale = kBanded / kNormalized` and
`directDiffuse` is proportional to `kNormalized`, so the banded result is proportional to
`kBanded` **alone** — flat within a band, whatever the geometry is doing. A scan line
across a lit sphere is therefore a staircase, and **the number of steps is the number of
ramp stops that surface can reach.** That is a small integer, not a distribution, and it
does not care what fraction of the viewport is metal.

Two spheres, one directional key, `paperStrength: 0`, `rimStrength: 0`, `roughness: 1`.
The second sphere differs from the first **in `metalness` and in nothing else** — same
preset, colour, geometry, band strength, light. Light intensity is the library's own
`keyIntensity`, which is defined as the luminance that maps to the top of the ramp.

```text
                          bands   luminance plateaus        plateau widths (px, of 98 lit)
metal 0.35   pre-fix        3     4-35, 100-105, 130-135     36, 39, 23
metal 0.35   shipped        4     4-29, 82-86, 106-110,      23, 25, 26, 24
                                  124-130
control 0    pre-fix        4     3-12, 95-96, 122-123,      19, 26, 31, 54
                                  142-144
control 0    shipped        4     3-12, 95-96, 122-123,      19, 26, 31, 54
```

**The control is identical in both builds** — same four plateaus, same luminances, same
pixel counts, no tolerance applied. That is the shader comment's *"metalness 0 is
unaffected, exactly"* as a measurement, and it is what makes the metal row mean anything:
the two builds differ in one line, and everything not downstream of that line is bitwise
unmoved. A control that reads exactly zero is the discriminator; a control that merely
reads *small* would have left driver noise and AA as live explanations.

**Metal loses its brightest band entirely.** Pre-fix it reaches three stops where the
otherwise-identical non-metal sphere reaches four. Post-fix it reaches four. So a quarter
of every lit metal surface — 24 of 98 scan pixels — was rendering one stop below where the
ramp says it should.

**And the bands that did survive sat in the wrong places.** Post-fix the widths are
23/25/26/24, near-equal quarters, which is what a four-stop ramp over a uniform driver
must produce. Pre-fix they are 36/39/23: the dark band is **1.57× too wide** and eats the
terminator. That is the *"every band boundary is crossed 53.8% late"* claim measured as
geometry coverage rather than inferred from arithmetic — the fix is not a brightness
change, it is the band boundaries returning to the geometry they belong on.

#### The whole shipped range, and a surface that lost banding altogether

`metal`'s 0.35 is not the maximum. `GameEngine.ts:12416` is
`metalness: gilded ? 0.76 : 0.45` — the gilded caravan's wheel rims, and 0.76 is the
largest value in the codebase. S1 pointed at it as a structural cliff rather than a
gradient, which the same probe settles by extending the subject list:

```text
metalness      pre-fix bands   shipped bands   pre-fix max   shipped max
  0.76               1               4              88           112
  0.45               3               4             138           126
  0.35               3               4             134           130
  0  (control)       4               4             144           144   <- identical
```

**At 0.76 the pre-fix build produced no bands at all** — a single continuous run across the
whole lit crescent. The arithmetic behaving exactly as written, and a different failure
from the one at 0.35:

- Band 1 of the ramp requires `kNormalized >= 0.25`.
- Pre-fix, `kNormalized <= 1 - metalness`, which at 0.76 is **0.24**.
- `DEFAULT_RAMP[0]` is `0`, deliberately, so cast shadows survive; `metal.bandStrength`
  is `1`, so the mix is not softened.
- Therefore `kBanded == 0`, `kScale == 0`, and **`directDiffuse` is multiplied to zero.**

What remains on those rims is specular and indirect, neither of which is banded — hence a
smooth gradient where every other surface in the game is stepped. They did not read as
*dim* metal; they read as **not participating in the shading model at all.**

Nor could it be escaped by lighting the scene harder, which is the first thing one would
try. `GameEngine.ts:11358` sets the band reference to
`sun.intensity + rimLight.intensity * 0.4`, so the denominator grows with the key and the
ratio stays bounded above by `1 - metalness` however bright the sun gets — the rim term
pushing it strictly below. **No time of day, weather state or palette banded those wheels.**

The measurement earns its place over the arithmetic for one reason: **0.76 sits past a
boundary that nothing in the source marks.** 0.45 and 0.35 lose one stop and look merely
wrong; 0.76 crosses `1 - m < 0.25` and loses the mechanism. One call site, one literal a
notch above its neighbour, in a different regime — and no reader of `createCaravan` could
have seen that from the call site.

#### One more thing this probe got wrong before it got it right

The four-subject version first sliced the frame into equal columns and mapped column *i*
to subject *i*. The spheres did not land where that arithmetic said: two shared a column,
and the run reported `metalness: 0.35` with **230 lit pixels and five bands** — a reading
of a *pair* of spheres, presented under one subject's name. It was caught only because
five bands is impossible on a four-stop ramp.

The fix was to stop computing where the subjects should be and **segment the row by
occupancy**, then assert the count matches the subject list and fail loudly otherwise.

> **A probe that assumes where its subject is will happily measure something else and
> report it under the subject's name.** Locate the subject in the data; do not derive its
> position from parameters you also chose.

Same family as the calibration trap below, and the same remedy: take the fact from the
system rather than from your own arithmetic about the system.

#### The calibration trap in this probe, which caught me

The first run used light intensity **3.2**, chosen as "bright enough to saturate". That is
1.208× `keyIntensity`, so the pre-fix driver — 0.65× — reached 0.785 and **cleared the
0.75 boundary into the top stop**. The probe duly reported **four bands for both builds**
and the defect looked absent. Only the plateau *width* hinted otherwise: 4 pixels against
38.

Nothing about that run looked malformed. It had a clean control, a well-formed staircase,
and a plausible answer. **The sensitivity of the instrument was set by a parameter I chose
for unrelated reasons, and the wrong choice put the defect just inside the passing side of
a boundary.** Calibrating the key to the one intensity the library actually defines —
the value that maps to the top of the ramp — is what made the measurement discriminating,
and it is defensible for a reason that has nothing to do with getting the answer I wanted.

> **An instrument with a free parameter has a sensitivity, and the experimenter sets it.**
> Pick that parameter from the system's own definitions, not from convenience, or the
> measurement silently becomes a test of the parameter instead of a test of the code.

This belongs to the same family as §13's other entries and is the sixth shape in it: not
*"the assertion never saw the input"* and not *"two questions share an answer set"*, but
**"the assertion saw the input at a setting where the defect does not express."**

### 7.0.7 A visual sign-off must carry the SHA of the tree it was captured from

Every other mitigation this programme tried against stale trees — resolve the branch by
name, `git merge-base --is-ancestor`, content probes, test-count fingerprints — **narrows
the window between capture and claim. None of them closes it**, because all of them are
checks performed *around* the capture rather than properties *of* it.

The near-miss that produced this rule: a reviewer had edited `stylizedShader.ts` for an
unrelated comment correction, so the diff stat showed the file as changed. *"Changed"* and
*"changed in the way I needed"* are different facts, and only a content probe distinguishes
them — the adjacent-question defect aimed at a diff stat instead of at a test. Had the
sequencing gone ten minutes differently, this PR would have shipped QA screenshots of
superseded shading, and **nothing in the process would have caught it**, because a
screenshot does not record what it is a screenshot *of*.

> **A capture that names its own tree cannot silently describe a different one.** Record
> the SHA at capture time, in the artifact or beside it, and a sign-off becomes falsifiable
> after the fact by anyone, without re-running it.

The asymmetry is what makes it worth the line of tooling: the check costs one command at
capture time and is free forever after, whereas every process-level mitigation costs
vigilance on every message and degrades the moment attention lapses. It also survives the
condition that defeated the rest of them here — **it needs no ref to resolve, so a cached
or orphaned ref cannot corrupt it.** This generalises past graphics: any claim produced by
looking at a build rather than by asserting over it has the same hole.

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

### 7.1.1 Is the visible-set cap a test or a definition? Measured, and it is a budget

The programme lead's closing rule, arrived at after a sibling retracted an invariant that
was preserved by construction:

> **An identity preserved by construction is not evidence, however exact it looks.** After
> deriving one, ask what it forbids — then build the forbidden state and watch it fail. If
> you cannot construct a failure, you have a definition, not a test.

Applied to `OUTLINE_WORLD_VISIBLE_DRAWS_MAX = 48`, which this pass introduced. The
forbidden state is a focus position whose nine visible regions draw more than 48 ink
shells between them. Three attempts to construct it:

```text
lever                                                per-region peak   visible peak
baseline                                                           7             41
OUTLINE_WORLD_DRAWS_MAX raised 8 -> 64                             7             41
takesInkShell loosened to ink instanced meshes too                 7             41
both together                                                      7             41
```

**None of them moves it.** The peak is bound by *content* — the number of ink-worthy
objects a region actually contains — not by either budget or by the filter. The
per-region budget of 8 is itself never reached; the busiest region spends 7.

So the honest classification is: **48 is a budget, not an assertion about a reachable
state.** It cannot fail on this content, and the mutation that does make it fail —
lowering the constant to 20 — changes the number rather than producing the state. That is
what a budget *should* be, because its job is to catch growth that has not happened yet;
but recording it as a test that could fail today would be exactly the overclaim §7.2
exists to name.

This also sharpens the split in §7.2.1. That section distinguishes an assertion that goes
red because the code got better from a budget that goes red because a constant needs
updating. The visible-set cap sits firmly on the budget side, and now it says so.

**What would make it a test again** is content growth: more ink-worthy objects per region.
That is precisely the change it guards, so the day it fires is the day it was worth
having — and the measurement above tells the next person how much headroom there is
before that day arrives, which is 48 against a content ceiling of 41–43.

The `charged == built` reconciliation beside it is a different case and survives the rule:
dropping one clause from the mirrored `takesInkShell` filter makes prediction and reality
diverge, and it is caught by name. That forbidden state is constructible with a one-line
code change, so that one is a test.

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
`CHARACTER_GEOMETRY_KEYS<=180`, asserted in `tests/characterArt.test.ts` against
`keys.size` in the character-plan sweep.

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
guard**: `GameEngine.removeAndDisposeObject` and the `this.root.traverse` sweep in
`GeneratedWorldRuntime.dispose`.

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
`StylizedArtLibrary.isLibraryOwned`, on both the geometry and the material — it simply
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
- [ ] Sustained frame time at 25 actors is within 1 ms of the pre-change build — **for a
      change that adds no geometry**. See §7: this criterion governs shader, lighting,
      post-processing and outline-machinery work, which is the population it was written
      against. A pass that adds geometry is judged by the two ceilings below instead.
- [ ] Draw calls per frame at a faction start are within `DRAW_CALLS_PER_FRAME_MAX`.
- [ ] Vertices per frame at a faction start are within `VERTICES_PER_FRAME_MAX`.

## 14. Effort

**2.5-3.5 days.** The kit itself is mechanical. The time goes into the shader
injection being correct across every material variant the game already uses, into
outline extrusion behaving on merged geometry and instances, into resource ownership
being provably single-dispose, and into re-tuning every emissive value that the tone
mapping change moves.

