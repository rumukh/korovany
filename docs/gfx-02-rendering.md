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

Candidate scores credit distance only up to the requested nominal boom. Extra
recovery height cannot repeatedly defeat an unobstructed normal view when the
shoulder hold expires. A still-clear, framed recovery view returns smoothly;
unsafe previous views retain immediate collision/framing recovery.

Origin containment uses the same fixed ray in stationary and moving queries,
and only considers centers inside the source bounds. Sweep direction still
controls face/edge contact, but cannot change whether an already-validated
origin is inside a compound source. This fixes the captured seed `4189091098`
failure that threw during follow movement and stopped the animation loop.

An overlapping look-at target is never accepted as a camera sweep origin.
Stationary sphere queries identify both surface overlap and closed-solid
containment. Recovery first revalidates the previous camera (within 32 metres),
then searches seven directions at four bounded local offsets if needed.
An external target cannot recover through a wall simply because its other side
is free. The camera origin alone changes; actors and the look target do not.
Follow and shake share this recovery rule and validate actual camera travel.
If no bounded safe pose exists, recovery reports an error without publishing an
overlapping position. `CameraSweepResult.initialOverlap` and
`CameraVisibility.debug.recovery` expose these cases.

The post-native riverside evidence revealed that a collision-cleared previous
camera could nevertheless have lost sight of the player. Three bounded
presentation-only torso sight probes now rank framing before boom length, and a
previous follow anchor must retain their visibility. Each probe excludes only a
point physically embedded in a solid, never makes a wall transparent, and checks
the original terrain height along its line. The final follow result is compared
with the validated target-visible candidate; if the travel sweep strands it
behind a roof, a presentation camera cut reacquires the candidate instead of
retaining an obstructed view. Scoped shake cannot reduce valid torso visibility.
`targetProbes`, `visibleTargetProbes` and `visibilityCut` are additive diagnostic
fields, including active-frame telemetry; no rig, world-registration, rebind or
gameplay sight API changed. Close constrained views may still shorten/fade the
player, and real post-fix motion approval remains separate from CPU ray checks.

The joined true-pitch camera exposed a second, distinct failure: a retained
camera could have three clear physical sight rays while projecting the actual
player off-screen. Production `CameraVisibility.resolve` now receives the
requested yaw, pitch and shake roll as optional trailing angles (omitting them
retains the geometry-only solver contract). A cached projection basis checks
player heights 1.1, 1.65 and 2.2 metres before candidate ranking, previous-anchor
reuse, final follow and scoped shake. Jointly clear and framed candidates rank
before boom length or shoulder hysteresis; an off-screen previous anchor cannot
strand an otherwise usable candidate. The five-candidate and geometry-query
bounds do not expand, and the projection checks allocate no per-frame objects.

Usable body-centre margins are normalized screen x within +/-0.6 and y within
+/-0.82, with near/far clipping enforced. Deliberate upward look may already put
the body below the screen in the unobstructed requested orbit; only that nominal
vertical range is retained rather than rotating the camera back at the player.
The actual yaw, pitch, arrow direction, actor roots and canonical sight remain
unchanged. Physically impossible framing retains bounded collision-safe recovery
and reports a positive `framingError`, not a false framing pass. Additive
`framingCut`, `framedTargetProbes`, `framingError`, torso/head NDC coordinates and
`framingActive` distinguish this gate from physical visibility. NDC counters use
the same final roll and projection as the rendered camera; they are not a
substitute for identifying the actual player in native-route screenshots.

Streamed foreground instances are registered explicitly. At most eight fade at
once, with source and ink sharing opaque depth-writing ordered dither. Camera
fade never changes a shared material's opacity, source visibility, instance
count, gameplay sight or world shadows. Close player geometry uses the same
binding machinery. Distant enemies receive no depth-disabled silhouette.
Inactive, LOD-replaced and out-of-count instances are restored to full visibility
and release their fade slots before new candidates are selected. Exit hysteresis
applies only to still-active instances leaving the camera corridor.

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

**Geometry input:** `position`, `normal`

- **Contract:** Finite vec3 position/shading data; existing winding and indices preserved

**Geometry input:** `outlineNormal`

- **Contract:** Welded rest-space normal for hard-edged ink, transformed with skin/wind

**Geometry input:** `color`

- **Contract:** Linear RGB, required with `vertexColors`; use white material base for mixed-surface batches

**Geometry input:** `uv`

- **Contract:** Required by a UV-mapped texture, not a world-mapped layout

**Geometry input:** `skinIndex`, `skinWeight`

- **Contract:** Four valid integral joint indices and four finite nonnegative normalized weights

**Geometry input:** `artSurfaceResponse`

- **Contract:** Optional vec4 absolute roughness/metalness/band/rim, each 0..1

**Geometry input:** `artWind`

- **Contract:** Optional vec2 flex/phase, each 0..1; rigid parts have zero flex

**Geometry input:** `artWater`

- **Contract:** Optional vec4 normalized flow X/Z, shore proximity 0..1 and nonnegative visual depth in metres

**Geometry input:** `artVisibility`

- **Contract:** Camera-only scalar 0..1; an instance-divisor attribute on instanced sources

**Geometry input:** `artShadowParticipation`

- **Contract:** Separate depth-only scalar instance admission mask

**Geometry input:** `artWeatherResponse`

- **Contract:** Optional vec2 maximum roughness drop (0..0.3) / fractional value darkening (0..0.22), installed by
  GFX-05 Stage A


`attributes.surfaceResponse`, `.weatherResponse`, `.wind`, `.water` and `.visibility` explicitly
require the corresponding layout during binding validation. Unbound ordinary
enhanced meshes use a constant fully visible camera attribute. Bake optional
channels/defaults before cache insertion and before merging mixed parts.
Every material slot on a source must use the same wind deformation layout;
rigid portions of a mixed-surface mesh use zero `artWind.x`, not a non-wind
material slot. Binding, replacement validation and outlining reject mismatches
in either slot order before creating inconsistent source/ink/depth silhouettes.

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
let replacement: ArtGeometryReplacementOutcome
try {
  replacement = art.replaceRenderSourceGeometry(binding, nextLease)
} catch (error) {
  nextLease.release() // preparation rejected this distinct, untransferred lease
  throw error
}
if (replacement.status === 'committed-with-errors') throw replacement.error
art.releaseRenderSource(binding)
```

The binding owns a full geometry clone for mutable state, not a shallow view of
cached attributes. `getRenderSourceBinding` finds an existing binding;
`getSourceVisibility` reads its current camera state; `getRenderBindingStats`
reports source count and exclusive geometry/attribute bytes. Attribute bytes are
a subset of geometry bytes, not an additional allocation.

Replacement validates/prepares first, synchronously swaps the stable source and
shell geometry links without reparenting events, preserves fade/skin state, then
releases the prior exclusive geometry/lease. Preparation failure throws with
the old source intact and the next lease still caller-owned.

The exported `ArtGeometryReplacementOutcome` distinguishes `status: 'committed'`
from `status: 'committed-with-errors'` with an `error: AggregateError`.
**Every returned outcome transfers the next lease.** The latter reports a
post-commit bounds-refresh or previous-resource cleanup failure; it is not a
rejected replacement. Report/propagate that error outside the rejected-lease
catch, and never release the live next lease from that catch. The binding later
releases it exactly once. Do not ignore an error outcome or directly replace
`source.geometry`.
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

### Affine skinned normals

The enhanced shader now transports both `normal` and welded `outlineNormal`
through the inverse-transpose of the **complete weighted skin map**:
`bindMatrixInverse * weightedBoneMatrix * bindMatrix`. It does not normalize the
old forward direction transform or average separately inverted bone matrices.
Three's later model/view `normalMatrix` still applies exactly once. Optional
wind's affine shear follows skinning for normals and forward-transformed
tangents, in the same order as the unchanged position deformation.

`skinNormalShader.ts` supplies the shared normal-only GLSL helpers and guarded
replacement of three's normal assignment. Enhanced main/ink cache keys carry
`affine-skin-normal-v1`; legacy keys/shading and depth skin-position code stay
unchanged. There is no new geometry attribute, rig/binding API, bone texture,
shader family or per-frame CPU deformation. GFX-05 fog/atmosphere integration
remains a separate merge.

The implementation scales the matrix, multiplies the normal by its cofactor
matrix, corrects determinant sign and normalizes without dividing by determinant
magnitude. This avoids unbounded inverse values near zero scale. For a singular
rank-two map, surviving oriented tangent area supplies the normal. If that area
also collapses, no physical normal exists: source and ink use the same finite
unit rest-direction fallback (positive Z for an invalid zero rest normal).
This is a bounded degeneracy rule, **not proof of correct shading for collapsed
geometry**. Positions and depth are never expanded or repaired. Non-finite or
incomplete bind/bone matrices are rejected by binding/geometry validation; pose
owners must continue supplying finite matrices after binding.

This is per-vertex affine normal transport. It is exact for the constant-weight
rigid partitions used by the actual character, creature and ox bodies and for
a local tangent under a fixed weighted affine map. It does not reconstruct
spatial derivatives of varying skin weights or wind flex across a triangle.
The bowstring's varying-weight deformation is not claimed to have newly
recomputed geometric normals; that is a distinct surface-differential problem.

CPU evidence uses 24 actual immutable `fc1af54` character/equipment/beast/ox poses:
266 vertex maps and 188 independently deformed production triangles. The emitted
GLSL arithmetic agrees with their tangent/face oracles; the old rule is wrong by
up to 10.2343 degrees on these poses. Negative controls cover omitted binds,
double model normal matrices, blended inverses and reversed skin/wind order.
The recorded wagon/ox pose is also a rigid control, not falsely labeled an
anisotropic failure. See `tests/affineSkinNormals.test.ts` and the fixture
provenance under `tests/fixtures/`. GPU compilation and integrated art/motion
evidence remain required; these CPU results do not establish driver behavior,
performance budgets or human model approval.

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

GFX-05 Stage A installs the reserved atmosphere/wetness composition. Positive
wetness and `attributes.weatherResponse` work in the enhanced library, including
newly streamed materials sharing its uniforms. Attribute-free materials use
bounded physical-surface presets. Water/glow/ink are excluded from wetness;
there is no metalness or emissive change. Roughness never drops below the smaller
of dry roughness and 0.35. Invalid environment/geometry values still throw before
publishing partial state.

The optional `environment.atmosphere` uses ordered view-depth knots
`nearDepth`/`midDepth`/`farDepth`, ordered `midOpacity`/`farOpacity` in [0,1],
linear `color`, world `baseHeight`, nonnegative `heightFalloff` and
`heightInfluence` in [0,1]. A protected near band blends into a smooth mid/far
ramp with bounded world-height attenuation. Source and ink sample the same
unextruded positions and use one linear-space fog application after material
tone mapping but before color-space conversion, not an additional post pass.
This preserves `toneMapped=false` ink and matches full-fog source/ink endpoints
within the direct path. The composer's later common OutputPass still tone-maps
the combined image: this is not a claim of identical direct/post fog pixels at
every exposure. `material.fog=false` excludes the sky.
A full environment without `atmosphere` restores stock fog; a lighting-only
partial call retains the environment. Legacy shading remains unchanged.

`ATMOSPHERE_REVISION` and the pure profile/reference helpers are exported from
the art barrel. The engine reports its active profile in diagnostic snapshots.
These are technical preview defaults: joined GFX-03/GFX-04 tuning, GPU evidence
and human visual approval remain separate gates.

Enhanced post is scene -> bloom -> grade -> OutputPass -> FXAA. OutputPass is the
only tone/color conversion; FXAA is display-referred and non-tone-mapped.
No bloom ping-pong target is multisampled. The owner uses actual physical input
dimensions with composer DPR 1, including resizing. Direct/Low/bloom-off paths
have no composer.
Each live bloom toggle applies both resolved enablement and antialiasing through
`BloomPostProcessor.setEnabled(enabled, antialiasing)`. Enabling bloom after an
enhanced High/Balanced bloom-off launch therefore installs FXAA immediately,
without an intermediate incorrectly configured composer.

The opt-in diagnostic stage supports `foundation: true` and
`antialiasing: 'none' | 'fxaa'` for labelled shader and same-post AA comparisons.
They are not user quality settings. Actual passes remain reported alongside
requested policy. The baseline runner accepts `--visual-mode`, `--quality`,
`--foundation`, `--no-aa`, independent off flags and `--motion`; manual motion
frames follow profiling and never enter its timing sample.
An explicit diagnostic AA override survives comparison renders and resizing, but
the next explicit engine bloom update restores the resolved AA policy (including
when bloom is set to its current value). Off/Low remain composer-free.

Original GFX-01 evidence remains immutable. Targeted CPU results and browser
evidence accompany the checkpoint; pixel correctness, temporal quality and
real-device budgets are not established by the API contract alone.
