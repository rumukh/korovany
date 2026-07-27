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

interface ArtVariation {
  unit(): number                       // [0,1)
  signed(spread: number): number       // [-spread, +spread]
  around(base: number, spread: number): number
  pick<T>(values: readonly T[]): T
  chance(probability: number): boolean
  angle(): number                      // [0, 2π)
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
function fbm3(x, y, z, seed, octaves = 3, lacunarity = 2, gain = 0.5): number
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
function rectProfile(width: number, depth: number, corner?: number): Vec2[]
function polygonProfile(radius: number, sides: number, rotation?: number): Vec2[]
function loftProfile(options: LoftOptions): THREE.BufferGeometry
function latheProfile(points: readonly Vec2[], options?): THREE.BufferGeometry
function extrudeProfile(points: readonly Vec2[], options?): THREE.BufferGeometry

// Curve-driven bodies
function tubeAlongPoints(points: readonly Vec3Like[], options?): THREE.BufferGeometry
function branchStructure(options: BranchStructureOptions): THREE.BufferGeometry

// Organic surfaces
function displaceGeometry(geometry, options: DisplaceOptions): THREE.BufferGeometry  // mutates in place
function facetGeometry(geometry, options?: FacetOptions): THREE.BufferGeometry       // returns a copy

// Composition
function mergeAll(parts, options?): THREE.BufferGeometry          // disposes sources
function transformed(geometry, transform): THREE.BufferGeometry

// Shading data — all mutate and return the geometry passed in
function ensureVertexColors(geometry, fill?): THREE.BufferGeometry
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
  readonly size: number
  dispose(): void
}

function createLod(options: {
  levels: readonly { geometry: THREE.BufferGeometry; distance: number }[]
  material: THREE.Material | THREE.Material[]
  castShadow?: boolean
  receiveShadow?: boolean
}): THREE.LOD
```

The cache is ref-counted: `acquire` on an existing key increments, `release`
decrements and disposes at zero. One region streaming out must not dispose a tree
another region is still drawing. `dispose()` releases everything unconditionally and
is idempotent.

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
  createContactShadow(options?: ContactShadowOptions): THREE.Mesh
  readonly rampTexture: THREE.DataTexture
  dispose(): void
  static isLibraryOwned(resource: THREE.Material | THREE.BufferGeometry | THREE.Texture): boolean
static markLibraryOwned(resource: THREE.Material | THREE.BufferGeometry | THREE.Texture): void

// from ./stylizedShader.ts, re-exported by the barrel
function hasStylizedShader(material: THREE.Material): boolean
}
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
- Disposal is **terminal**. Every factory — `createMaterial`, `acquireMaterial`,
  `adoptMaterial`, `getOutlineMaterial`, `applyOutline`, `createContactShadow` —
  throws after `dispose()`. `dispose()` itself stays idempotent.

The `surface` id chooses roughness/metalness/band/rim defaults; it is a preset name,
not a shader permutation. All surfaces compile the same program.

#### Shading injection

Injected before `#include <opaque_fragment>` in the standard fragment shader:

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
and erase cast shadows entirely. Direct light bands down to nothing and the
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
tightening exposes; `shadow.camera.far` follows the tighter frustum.

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
  streaming handle lifetime.
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
  and returns the same object (`displaceGeometry`, all `paint*`/`bake*`) or returns a
  copy (`facetGeometry`, `transformed`). Never apply an in-place helper to a buffer
  obtained from `GeometryCache.acquire`.

## 7. Budgets

```text
ART_RAMP_TEXELS=4                    one shared DataTexture for the whole game
ART_RAMP_STOPS=0, 0.42, 0.72, 1.0
ART_LIBRARY_MATERIALS<=12            outlines (4 kinds x 2 variants) + contact shadows
OUTLINE_THICKNESS=0.0042             view-space units per unit of depth, ~0.36% of frame height
OUTLINE_MIN_DEPTH=2.0
OUTLINE_MAX_DEPTH=42.0
OUTLINE_CHARACTER_SCALE (retired)    replaced by normal extrusion
OUTLINE_ACTOR_DISTANCE=38            unchanged from spec 01
OUTLINE_INTERACTABLE_DISTANCE=46     unchanged from spec 01
OUTLINE_WORLD_DRAWS_MAX=8            instanced world silhouettes per visible region
CONTACT_SHADOW_TEXELS=64x64          one shared DataTexture
CONTACT_SHADOW_MATERIALS<=4          one shared material per distinct opacity
CONTACT_SHADOW_DRAWS_MAX=26          25 actors plus the player
SHADOW_MAP=2048                      unchanged
SHADOW_FRUSTUM=52                    down from 85
RIM_LIGHT_COUNT=1                    non-shadowing
BLOOM=0.42 strength / 0.55 radius / 0.9 threshold
GRADE_VIGNETTE=0.22
POST_PASSES=4                        render, bloom, grade, output
GEOMETRY_CACHE_ENTRIES_MAX=64
CHARACTER_GEOMETRY_KEYS=9            shared by all 25 actors, not one set each
BEAST_GEOMETRY_KEYS<=26              keyed by bulk/length, shared across the four roles
CARAVAN_GEOMETRY_KEYS=6              shared by every caravan in the run
```

Targets:

- No new full-screen pass when bloom is disabled.
- No per-frame allocation in any code this spec adds. The grade pass, the outline
  update and the contact shadows allocate nothing after construction.
- The banded-toon injection compiles one extra program variant, not one per material.
- Sustained frame time at 25 actors must not regress by more than 1 ms against the
  pre-change build. If it does, drop the rim directional light first, then the paper
  tooth term, then the grade pass. Do not reduce actor count or drop the player
  outline.

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
  by every teardown path forever. Call `StylizedArtLibrary.markLibraryOwned()` to hand
  the library a resource you built; never write the marker by hand.
- **Disposal is terminal.** Every resource-producing entry point — `createMaterial`,
  `acquireMaterial`, `adoptMaterial`, `getOutlineMaterial`, `applyOutline` and
  `createContactShadow` — throws after `dispose()`, so a late caller cannot resurrect a
  library-owned material that the now-cleared maps will never release. `dispose()`
  itself remains idempotent.
- Outline shells share their source geometry and a shared material. They add nothing
  to dispose; removing the source removes them.
- Instanced outline shells share `instanceMatrix` with their source. They must be
  removed before the source `InstancedMesh` is disposed, and must not call
  `InstancedMesh.dispose()` themselves — that would free the shared buffer.
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
