# GFX-04 world-art preview

The tactile world is an **enhanced-preview consumer**, not a default promotion or
an approved hardware tier. It uses the existing visual mode/quality lifecycle:
save to the menu and continue to apply construction-scoped art changes. Legacy
builders and the original screenshots remain available and unchanged.

## Content and physical boundaries

Ground uses one world-XZ substrate map with broad biome/soil variation baked in
linear vertex color. Detail is authored in metres rather than in region UVs;
increasing map resolution samples the same courses and grain, not more tiles.
Palace countryside is soil/vegetation. Paving is restricted to actual roads and
guard/palace site courts, with irregular worn edges. Court patches subdivide and
clip the original triangle planes; terrain, road and river position/index streams
are not replaced or displaced.

The existing species catalogue now has branch-supported leaf masses and canopy
gaps. Trunks, dead wood and stones have zero wind flex; live masses, reeds and
ground cover use the shared foundation wind. Ground cover grows in deterministic
patches, retains the original population ceilings and live density prefix, and
never changes collision, visibility rules or actor populations.

Building walls and roofs carry different packed surface responses. Eave fascia,
local wear and downward foundation contact refine the existing architecture.
Foundation sides merge into the site's existing hard draw after canonical sight
capture; they add no walkable cap, collider or elevated floor. The original
building origins, specifications, site layout RNG and approaches are unchanged.

River flow is derived from the ordered macro route. Shared water channels encode
bank proximity and optical depth, not new bathymetry or a physical-height API.
The foundation provides restrained flow modulation and sky response. Small contact
rings are projected onto the existing water-support triangles at the actual bridge
piers and disappear with the near bridge level. **Bridge deck geometry, camber,
support relationship and water-collider gaps remain exactly the legacy geometry.**
No planar-reflection target, SSR, normal map or external art dependency is added.

## Consumer API

`GeneratedWorldRuntime.surfaces` is a `WorldSurfaceField` in enhanced mode and
`null` in legacy. `WorldSurfaceField.ts` exports:

| API | Meaning |
| --- | --- |
| `sample(x, z)` | Frozen presentation metadata for a point |
| `createWorldSurfaceSample()` / `sampleInto(x, z, out)` | Caller-owned scratch for repeated sampling |
| `pavingAt(x, z)` | The same paving channel without unrelated cover/flow evaluation |
| `sampleWaterInto(x, z, out)` | Optical water data, including water underneath a real bridge |
| `courts` | Frozen site descriptors from unchanged layouts and the exact clamped site transform |
| `bridgeContacts` | Frozen contacts using the same pier constants as `bridgeParts` |

Samples contain `regionId`, `biome`, a visual material classification
(`grass`, `soil`, `rock`, `paving`, `water`, `bridge`), bounded `road`, `paving`,
`vegetation`, `shore`, `bridgeContact`, normalized `flowX`/`flowZ`, and
`visualWaterDepth`. No physical height or normal is exposed here. GFX-05 must
continue using terrain/collision authority for admission and label any visual
offset as such. Field sampling never changes the blueprint or authoritative
environment.

World props pack `artSurfaceResponse` and `artWind` before caching. The
world-owned `paintPropResponse` helper supplies rigid defaults on mixed parts.
The original CPU content checkpoint omitted the reserved weather-response
channel. The joined GFX-05 integration now bakes it before cache insertion and
mixed-part merging, using that owner's `SURFACE_WEATHER_RESPONSE` defaults.
Trunk/branch bark and live foliage keep distinct response values; building and
cloth groups retain their authored surface response. The same material family
consumes the channel. Water/glow remain excluded, and no world-only material
mutation or competing weather controller is introduced.

## Sight, instancing and ownership

Enhanced building meshes retain explicit **legacy-key geometry receipts** for
canonical sight. The baseline hierarchy capture substitutes those exact buffers,
including both LOD forms and material-side semantics. Additional court, footing
and water-contact art is added only after capture. The existing canonical registry
owns proxy nodes and scene-matrix cadence; no art-only transform or fade enters
squad sight. Raze/save-restoration behavior stays with the foundation.

Enhanced outline creation follows render-source binding, so ink actually borrows
the mutable source clone rather than an earlier cache buffer. Registrations
release first, followed by canonical bindings, ink and render-source bindings,
then region geometry and prop receipts. Cached data is never modified by a fade.
Reeds and ground cover are not solid camera obstacles. Low does not allocate
unused instance shadow-mask clones; its foreground visibility remains available.

Four surface groups, six main dressing buckets and four cover kinds are retained.
Building LOD uses the common distance scale/hysteresis. Low uses cheaper shared
tree/rock geometry at construction, without reselecting collider-producing
placements or deleting structural instances.

## Resource evidence and remaining gate

The shared subsystem allocation is read through
`resolveVisualSubsystemAllocation`. The existing 128-key retention window,
176-entry cache guard and 8/48 ink ceilings remain unchanged. Four generated
world maps are used: substrate, rock, water and paving. Only High paving uses
256 pixels; other maps are at most 128. Full RGBA8 mip-chain storage remains
below the agreed 0.75 MiB envelope. No reflection or additional post target is
allocated by world art.

`GeneratedWorldRuntime.getVisualInventory()` supplies actual source identities
and `VisualAllocationReceipt` entries for CPU backing stores, including retained
cache keys, full mutable binding clones, instance buffers, maps and additional
canonical-only geometry. The cache inventory follows actual disposal, including
retention and failed acquisitions; it is not a second cache or disposal owner.
Source/ink borrowing is deduplicated by backing-buffer identity. Rendered objects
are tagged `userData.visualSubsystem = 'world'` for the existing whole-frame
instrumentation owner.

**The inventory explicitly remains incomplete:** GPU ownership attribution,
JavaScript proxy/object storage and temporary construction peaks require the
integrated diagnostics. Unknown GPU bytes are `null`, not zero; the CPU receipt
sum is not a claim of complete VRAM or heap coverage. Named source/ink/shadow
costs must be reconciled against actual GFX-01 GL submissions before approving
the world frame envelope.

Targeted CPU coverage includes full tactile prop attribute/rigid/winding checks,
real-ray canopy-gap controls, exact bridge/ribbon/collider preservation, court
triangle-interior support, source/ink clone identity, canonical sight
differentials and three streaming laps with bounded retained backing stores.
CPU correctness and a successful offline build do not establish visual quality.
All-biome/player-plus-NPC captures, motion, weather, streaming and real-device
whole-frame evidence still require the coordinator's serialized browser lease
and visual decision. Desktop phone-size emulation is not mobile hardware evidence.
