# GFX-05 Stage A: CPU implementation contract

Stage A builds on the approved `3d2a77e48bd7514742445f17da735739654366fd`.
It implements independent environment, secondary-pool and DOM-HUD work.
This is not full GFX-05 completion, a rendered/device budget result, human
visual approval, or default promotion. Legacy remains the default. No AO,
new post pass/target, external asset, dependency or testing framework is added.

## Environment

The real `GameEngine.setWeatherEnabled` no longer snaps the authoritative
weather mix. Zero-delta presentation refreshes do not visit a new biome or
advance weather, elapsed time, chronicle, AI environment, gameplay RNG or
hit-stop. The normal `update()` ordering remains unchanged: chronicle observes
the existing mix before that frame's weather advancement.

The reserved `StylizedPresentationEnvironment` and optional
`artWeatherResponse` now have real enhanced-only shader behavior. See
[the rendering contract](gfx-02-rendering.md) for copied uniforms, ordered
depth/height atmosphere, wetness exclusions and dry/fog restoration.
All source/ink/skin/wind/depth/camera/lease/sight ownership stays with the
foundation. There is no shared-material mutation loop or dependency on the
unused legacy `groundSurfaces` map.

`art/index.ts` additionally exports `ATMOSPHERE_REVISION`,
`SURFACE_WEATHER_RESPONSE`, `WEATHER_ROUGHNESS_DROP_MAX`,
`WEATHER_VALUE_DROP_MAX`, `WEATHER_ROUGHNESS_FLOOR`,
`createAtmospherePresentation`, `writeAtmospherePresentation`,
`sampleAtmosphereOpacity`, and `weatheredRoughness`.

`PrecipitationPresentation.ts` reuses the original 420-drop and 300-flake
buffers. Enhanced density controls real draw ranges, not just alpha. Rain and
snow wrap relative to existing sampled terrain/camera elevation, avoid the
immediate lens area, and reduce density, drift and motion for reduced motion.
Terrain samples are bounded by the live precipitation count; their actual frame
cost still needs the existing whole-frame profiler. No per-drop mesh or
raycast is added. This initial implementation does not interpret bridge camber
as collision height or consume the unpublished integrated world-surface packet.
Reduced motion suppresses decorative lightning illumination, not weather time.

The engine's existing diagnostics include `rendering.atmosphere` with the
implemented revision, active profile and wetness.

## Secondary contact pool and honest accounting

`SecondaryEffectPool.ts` owns the existing generic shards and sparks as one
opaque, depth-tested, non-shadowing instance batch. Its combined ceiling is 48
particles; the shared policy lowers actual admission. Spark priority can replace
older generic shards, but saturated equal-priority requests are dropped with
explicit counters. Expiration reuses slots; pause/terminal cleanup clears them.
Disposal removes the batch before the engine scene sweep and drains its
exclusive geometry/material/instance resources exactly once.

Only this pool's cosmetic `art:` RNG is consumed. It does not own damage,
defense, cleave summaries, hit-stop, sound, injury, body attachments or actor
population. It preserves existing admitted-contact anchors and colors for now;
material/posed-anchor routing is explicitly Stage B. No contact light is added
in Stage A.

**Pool accounting:** `SECONDARY_EFFECT_CAPACITY` / `SECONDARY_EFFECT_REVISION`

- **Meaning:** 48 combined slots / implemented visual revision

**Pool accounting:** `getAllocationReceipts()`

- **Meaning:** Unique actual typed backing stores, charged only to `postAndEffects`

**Pool accounting:** `snapshot().resources`

- **Meaning:** Existing `sumVisualAllocationReceipts` result; retained buffer payload under 32 KiB, not exact JS heap

**Pool accounting:** `sourceDrawCeiling` / `sourceTriangles`

- **Meaning:** One potential scene submission and 8 triangles per live slot (384 maximum), not measured rendered work

**Pool accounting:** `accepted` / `dropped` / `replaced`

- **Meaning:** Admission and saturation counters

**Pool accounting:** `gpuAllocatedBytes`, `draws`, `cpuMs`

- **Meaning:** Unknown until attached to actual GPU allocations and disjoint whole-frame measurements

**Pool accounting:** `resourcesComplete`

- **Meaning:** Explicitly false: the pool is not the complete pipeline/effects inventory


These receipts do not claim the 176/136/88 MiB shared bucket, count the composer,
shadow or canvas twice, or borrow another subsystem's capacity. The existing
whole-frame diagnostics remain the only profiler. Existing gore, decals,
numbers, callouts, rays, trails and other transient work still require joint
accounting against the 44/24/20 transient-draw allocations; one small pool
cannot establish a full effects or tier pass. The engine includes the partial
pool snapshot as `rendering.secondaryEffects`.

## Compact HUD

`CompactMissionHud` and `CompactWorldNews` wrap the original panels rather than
replace campaign logic. `VisualSettingsControls` uses the existing
`VisualPreferences.hudMode` and `onVisualPreferencesChange` callback. No new
storage key, engine setting, overlay owner, campaign field or `GameView` field
is introduced. Full mode remains the default and original arrangement.

Native disclosure summaries have 44 CSS-pixel targets and wrapping/scalable
text. Space activates the disclosure without also jumping; Escape and the
existing overlay shortcuts retain their original owner. All original contract
choices, stakes, pins, rumours and doctrine actions remain reachable. Essential
combat, navigation, interaction, finale and teaching notices remain outside
collapsed content. Existing focus traps, inertness and pointer-cancellation
paths are unchanged.

The actual production `GameScreen` is also a named export so the existing
TypeScript compiler and React server renderer can exercise the whole UI in
Node. Tests substitute CSS/asset loading only, not a second gameplay HUD.

## Evidence boundary and integration

Targeted Node coverage includes real engine setter/update/chronicle calls and
an old-snap negative control, production material and streamed-world builders,
source/ink/depth hooks, particle resource/admission/defense/lifecycle paths,
and actual full/compact React HUD/overlay markup. Source/test types and changed
paths use the existing TypeScript/oxlint commands.

No browser/GPU lease was used for Stage A. Shader hook assembly is not a GLSL
driver result; server-rendered HTML and CSS guards are not viewport screenshots
or a physical mobile-device result. GPU compilation, motion, grayscale, live
focus/touch layout, text scaling and independent-toggle captures remain pending.
No frame-time, rendered draw, physical VRAM or complete-inventory claim follows
from CPU tests.

The coordinator integrates this branch with the immutable GFX-03 presenter and
GFX-04 world-surface packets. Do not independently overwrite their same-base
`GameEngine`/runtime/art-barrel changes. Stage B then consumes cached posed
character contact anchors and read-only material metadata, completes joined-art
atmosphere/contact tuning and the leased all-feature acceptance matrix. Bridge
geometry/support and all gameplay invariants remain unchanged. AO still needs
separate explicit clearance and is outside both the current implementation
and its completion claim.
