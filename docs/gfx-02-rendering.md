# GFX-02 rendering foundation

Explicit enhanced preview only. Legacy remains the default, and bloom disabled
still means direct rendering without a composer in every mode. Availability is
not human art-direction approval, final batching, or a hardware-tier pass.

The implementation extends `StylizedArtLibrary`, `stylizedShader`,
`GeneratedWorldRuntime`, the existing camera call sites and the single
`BloomPostProcessor`. It does not replace the simulation, generated art pipeline
or quality settings. The resolved policy is documented in
[visual-settings.md](visual-settings.md).

## Camera, ink and shadows

The enhanced camera sweeps a sphere against real geometry faces, edge capsules
and vertices; nine terrain-footprint probes guard its path. It bounds five
framing candidates, 64 intersecting hard sources and 32,768 tested triangles per
sweep. Overflow is reported and conservatively blocks rather than ignores work.
Final follow and shake positions are constrained too. Recovery/shoulder changes
use time-based damping and hysteresis, not a minimum boom that can pass a wall.

Streamed foreground instances are registered explicitly. At most eight fade at
once, with source and ink sharing opaque depth-writing ordered dither. Camera
fade never changes a shared material's opacity, source visibility, instance
count, gameplay sight or world shadows. Close player geometry uses the same
binding machinery. Distant enemies receive no depth-disabled silhouette.

Enhanced structural ink is neutral; existing faction rings, interaction/focus
and threat feedback retain their separate meaning. Width is based on actual
internal pixels and projected geometry extent; legacy extrusion and the existing
8-draw-per-region / 48-visible world caps remain available.

One key light uses a light-space texel-snapped shadow projection. Characters keep
priority; nearby world buildings, canopy and rocks are admitted against the
shared policy's actual submitted draw/instance/triangle caps. Material groups and
active LOD count. An admitted instanced batch has a real depth participation mask
for nearby members, but its full submitted work is charged. Camera dither does
not drive that mask; density and active LOD do.

Lighting retains zero direct-light ramp floor, albedo/metalness compensation,
post-weather synchronization, specular and output color management. Enhanced
band/rim/grade strengths are restrained and hemisphere fill is neutralized.
The initial enhanced skin palette is physical rather than derived from UI
warning colors; character geometry and the later full palette pass remain
GFX-03's responsibility. No emissive body fill is added.

## Material/attribute API

Import public foundation types and helpers from `src/game/art/index.ts`.
`createMaterial` is caller-owned; `acquireMaterial` is library-owned;
`adoptMaterial` retains caller ownership. Shared material parameters and cached
geometry data are immutable to consumers. Enhanced shared materials have a
128-key ceiling; keys must describe bounded palette/layout/mapping choices,
never instance IDs or frame time.

Additional `StylizedMaterialOptions`:

```ts
mapping?: 'uv' | 'world-xz' | 'world-triplanar'
metersPerRepeat?: number
attributes?: ArtAttributeLayout
```

Metre scale is positive. World mapping samples world coordinates, not arbitrary
object scale. All variants remain the same standard-material family. No new
texture, model or network dependency is required.

| Geometry input | Contract |
| --- | --- |
| `position`, `normal` | Finite vec3 position/shading data; existing winding and indices preserved |
| `outlineNormal` | Welded rest-space normal for hard-edged ink, transformed with skin/wind |
| `color` | Linear RGB, required with `vertexColors`; use white material base for mixed-surface batches |
| `uv` | Required by a UV-mapped texture, not a world-mapped layout |
| `skinIndex`, `skinWeight` | Four valid integral joint indices and four finite nonnegative normalized weights |
| `artSurfaceResponse` | Optional vec4 absolute roughness/metalness/band/rim, each 0..1 |
| `artWind` | Optional vec2 flex/phase, each 0..1; rigid parts have zero flex |
| `artWater` | Optional vec4 normalized flow X/Z, shore proximity 0..1 and nonnegative visual depth in metres |
| `artVisibility` | Camera-only scalar 0..1; an instance-divisor attribute on instanced sources |
| `artShadowParticipation` | Separate depth-only scalar instance admission mask |
| `artWeatherResponse` | Reserved vec2 capped roughness/value response; effect not installed yet |

`attributes.surfaceResponse`, `.wind`, `.water` and `.visibility` explicitly
require the corresponding layout during binding validation. Unbound ordinary
enhanced meshes use a constant fully visible camera attribute. Bake optional
channels/defaults before cache insertion and before merging mixed parts.

`validateArtGeometry(source, geometry?)` checks required attribute counts/ranges,
indices and skin data. `artGeometryBytes(geometry)` reports unique backing-array
bytes. A material clone does not inherit shader hooks or ownership.

## Render-source leases and replacement

```ts
interface ArtGeometryLease {
  readonly geometry: THREE.BufferGeometry
  release(): void
}

const binding = art.bindRenderSource(source, {
  geometryLease,        // optional; ownership transfers on successful binding
  visibility: true,
  shadowParticipation: source instanceof THREE.InstancedMesh,
  deformationPadding: 0.4,
})
art.setSourceVisibility(binding, 0.25, instanceIndex)
art.setShadowParticipation(binding, 1, instanceIndex)
art.refreshRenderSource(binding) // after live count/matrix/bounds changes
art.replaceRenderSourceGeometry(binding, nextLease)
art.releaseRenderSource(binding)
```

The binding owns a full geometry clone for mutable state, not a shallow view of
cached attributes. `getRenderSourceBinding` finds an existing binding;
`getSourceVisibility` reads its current camera state; `getRenderBindingStats`
reports source count and exclusive geometry/attribute bytes. Attribute bytes are
a subset of geometry bytes, not an additional allocation.

Replacement validates/prepares first, detaches old ink links, swaps the stable
source and shell geometry, preserves fade/skin state, then releases the prior
exclusive geometry/lease. Preparation failure leaves the old source intact and
the next lease with its caller. Do not directly replace `source.geometry`.
Keep the outline layout compatible. Capacity/matrix-buffer identity is fixed for
an instance binding; increasing density inside capacity is supported.

`applyOutline` produces skinned shells for skinned sources, borrowing the
skeleton, bind matrices and geometry. The rig alone disposes skeleton/bone data.
Instance shells still borrow the source matrix and restore their own parked
matrix before disposal. Release outline bindings before source bindings, then
source/geometry owners. Both releases are idempotent; foreign bindings fail.

GFX-03's intended one-body batch may use logical part/index ranges and
event-driven actor-owned injury/prosthetic geometry. Bindings preserve the
excluded triangles; `Bone.visible` is not treated as vertex visibility.

## Canonical gameplay sight

`LegacySightRegistry` and `WorldPresentationRegistry` are separate. Enhancing
render geometry must not alter the original `cameraObstacles` collection used by
squad LOS/focus.

`captureLegacySightHierarchy(root)` records baseline geometry and local
transforms before presentation mutations. Later GFX-04 builders retain exact
legacy keys/receipts and supply `LegacySightNode` descriptors explicitly.
`registerLegacySightRegion(regionId, hierarchy)` returns a binding whose
`setAttached` tracks residency and whose `dispose` unregisters proxies only.
Runtime owners retain borrowed geometry receipts until that binding is released.

`GeneratedWorldRuntime.collectLegacySightSources(target)` refreshes the existing
engine array at its original visible-region signature boundary. Both original
LOD forms, index/groups/winding, single/array material-side data and opacity
eligibility are retained. Later raycasts do not add a visibility/opacity filter.

Hidden prefixed canonical nodes participate only in the original scene-matrix
update cadence, never rendering, ink, shadows or enhanced camera queries. First
frames are not eagerly updated by AI. `setLegacySightRazedSite(siteId, side)`
mirrors the original site scale/material-side transition, including saved raze
restoration. New foundations, wind, dither, density and LOD do not alter sight.

Presentation registration takes a stable ID/region/binding and an occluder kind
(`solid`/`foreground`) or shadow priority (`building`/`canopy`/`rock`). Receipts
unregister before binding/geometry disposal. Main geometry bounds are only a
broad phase for camera collision, not a solid courtyard AABB.

## Shared environment and post

`setLightingReference` accepts optional `StylizedPresentationEnvironment` with
time, normalized XZ wind/strength, rain/snow, sky/horizon colors and wetness.
It copies into library-owned uniforms without changing authoritative weather.
Skin/wind position/normal transforms agree between source, ink and key depth.
The water layout provides bounded flow and procedural-sky response within this
family, without another renderer or real-time reflection target.

GFX-05's atmosphere/wetness formulas are deliberately not installed here.
Positive wetness, an atmosphere request or `attributes.weatherResponse` throws
descriptively rather than silently claiming an effect. The agreed types are
reserved for that consumer's implementation and visual review.

Enhanced post is scene -> bloom -> grade -> OutputPass -> FXAA. OutputPass is the
only tone/color conversion; FXAA is display-referred and non-tone-mapped.
No bloom ping-pong target is multisampled. The owner uses actual physical input
dimensions with composer DPR 1, including resizing. Direct/Low/bloom-off paths
have no composer.

The opt-in diagnostic stage supports `foundation: true` and
`antialiasing: 'none' | 'fxaa'` for labelled shader and same-post AA comparisons.
They are not user quality settings. Actual passes remain reported alongside
requested policy. The baseline runner accepts `--visual-mode`, `--quality`,
`--foundation`, `--no-aa`, independent off flags and `--motion`; manual motion
frames follow profiling and never enter its timing sample.

Original GFX-01 evidence remains immutable. Targeted CPU results and browser
evidence accompany the checkpoint; pixel correctness, temporal quality and
real-device budgets are not established by the API contract alone.
