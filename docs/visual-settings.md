# Graphics defaults and interface preferences

Graphics use the existing `GameEngineSettings`, `GameEngineOptions`,
App preference state, effect setters, and save/continue flow. It does not introduce
another game engine, campaign format, or settings service.

## Player-facing behavior

New and continued runs use **enhanced graphics at High quality**. The menu and
pause dialog no longer expose mode or quality selectors, preview notices, or
graphics-reload instructions. App launches use the engine defaults rather than
persisted graphics choices, so existing original/low/balanced preferences cannot
downgrade a run. Campaign data and independently saved effect choices are retained.

The main menu places faction start cards above seed, boon and doctrine setup.
Theme, effect, audio and HUD controls follow the world preview and profile history
in a bottom **Настройки** section. DOM order matches the visual and keyboard order.
The pause dialog retains its existing live controls.

Mode and quality remain construction-scoped engine options for explicit
diagnostic comparisons. They are not player preferences. Closing pause keeps the
current engine and visuals. The existing **В главное меню** action saves the
active campaign and refuses to leave when its checkpoint cannot be persisted.

`hudMode` is a DOM-only Full/Compact preference, exposed as **Боевой интерфейс**
in the menu and pause interface controls. It defaults to Full.
Changing it applies immediately without restarting
the engine, dismissing an overlay or resuming a paused fight.
It is not a `GameView`, `RunConfig`, or `GameEngineSettings` field.

Compact mode groups the existing mission boards under **Поход**, and chronicle
and rumours under **Вести**. Native keyboard/touch disclosures keep all original
actions and full copy available; active contract/rumour deadlines remain in the
closed summaries. Vitals, ability/defense, squad, compass, E prompts, finale cues,
all four notice slots and their teaching messages remain outside the disclosures.
It also restrains notice decoration and the peripheral damage tint without
changing damage state or intentional injury-related vision loss. Full mode keeps
the original panel arrangement. Browser layout/visual acceptance is separate from
the CPU-tested DOM contract.

Interface preferences are stored as `{ version: 2, hudMode }` at
`korovany-visual-preferences`. Version 1 records are also read, retaining only
`hudMode` and discarding the retired graphics fields. Reads do not rewrite
storage; the next HUD preference save writes version 2.
Existing bloom, ink, foliage, weather, camera,
day/night, audio, and theme keys remain authoritative and are not migrated or
overwritten. Invalid records and storage failures use the existing
`Korovany: ...` console-warning convention. A failed preference write also leaves
a visible message in the controls; the selection remains usable in the current
tab without claiming it was persisted.

## Public settings and policy contract

`src/game/visualSettings.ts` exports:

**Export:** `VisualLaunchPreferences`

- **Contract:** `visualMode: 'legacy' | 'enhanced'`, `visualQuality: 'high' | 'balanced' | 'low'`

**Export:** `VisualPreferences`

- **Contract:** Only `hudMode: 'full' | 'compact'`; App-owned, with no graphics tier fields

**Export:** `VisualSettings`

- **Contract:** Launch preferences plus the existing `dynamicDayNight` , `weatherEnabled` , `bloomEnabled` ,
  `inkOutlinesEnabled` , `screenShakeEnabled` , `foliageQuality` engine fields

**Export:** `FoliageQuality`

- **Contract:** Existing `'off' | 'low' | 'high'`; still re-exported from `GameEngine.ts`

**Export:** `normalizeVisualPreferences(value, onWarning?)`

- **Contract:** Validated, immutable HUD preferences; invalid HUD values warn and fall back to Full

**Export:** `normalizeVisualSettings(value, onWarning?)`

- **Contract:** Immutable engine visual subset, defaulting to enhanced/High; explicit diagnostic tiers remain supported.
  No device probing, campaign data, or HUD field

**Export:** `loadVisualPreferences(storage, onWarning?)`

- **Contract:** Reads version 1 or 2 of the interface record only; accepts the existing `StorageLike` read interface

**Export:** `saveVisualPreferences(storage, preferences, onWarning?)`

- **Contract:** One write, returns `false` on failure; never writes campaign or old effect keys

**Export:** `foliageQualityDensity(quality)`

- **Contract:** Existing density mapping: Off 0, Low 0.55, High 1


`GameEngineSettings extends VisualSettings`; `GameEngineOptions` retains its
existing partial-options/required-`generatedRun` shape. There is no
`setVisualMode` or `setVisualQuality` API that could update only future spawns.
The existing live effect setters refresh the policy and retain their current
application paths.

`GameEngine.getVisualPolicy(): VisualQualityPolicy` returns the cached,
deeply immutable policy from `src/game/visualPolicy.ts`. Reading it does not
allocate each frame.

**Policy field:** `preferences`

- **Meaning:** Normalized requested engine visual settings, including independent off preferences

**Policy field:** `mode`, `quality`, `previewAvailable`, `revision`

- **Meaning:** Effective legacy/enhanced mode, requested tier, compiled capability, and presentation-only revision

**Policy field:** `reducedMotion`, `cameraEffects`

- **Meaning:** Explicit environmental motion preference and permitted decorative camera effects

**Policy field:** `camera`

- **Meaning:** `collision: 'legacy-ray' | 'volume'`, `foregroundFade`; no gameplay sight-policy input

**Policy field:** `render`

- **Meaning:** `scale`, `maxPixelRatio`, `maxPixels`; CSS/HUD layout stays unscaled

**Policy field:** `post`

- **Meaning:** `enabled`, `bloom`, `grade`, `antialiasing: 'none' | 'fxaa'`

**Policy field:** `shadows`

- **Meaning:** `mapSize`, `worldDistance`, `worldCasterBudget`, `worldInstanceBudget`, `worldTriangleBudget`

**Policy field:** `ink`

- **Meaning:** `enabled`, `minPixels`, `maxPixels`; legacy retains its existing extrusion instead

**Policy field:** `lod`

- **Meaning:** `distanceScale` , fractional `hysteresis` ; character projected-importance selection and world LOD
  consume the same tier envelope

**Policy field:** `density`

- **Meaning:** Bounded `foliage`, `weather`, `ambientLife`, and `particles` cosmetic factors

**Policy field:** `budget`

- **Meaning:** Provisional frame-time, whole-frame draw, main-view triangle and tracked-resource ceilings; `null` for
  the unchanged legacy comparison


`resolveVisualPolicy(settings, environment?)` is the pure resolver.
`environment.reducedMotion` is supplied by the caller; the resolver performs no
media-query, user-agent, GPU, simulation, or random-stream access.

Bloom disabled always resolves to **no composer**, including in enhanced mode.
Low enhanced diagnostic comparisons also resolve to the direct path. The enhanced
default must never turn a stored bloom-off preference back on. Runtime allocation/driver failures
are reported by the frame owner separately: policy data is not a claim that a
GPU effect succeeded.

The live bloom setter applies resolved `post.enabled` and `post.antialiasing`
together, including when bloom was off at launch. Thus an enhanced High/Balanced
off-to-on transition creates the FXAA chain rather than retaining the launch-time
`none` AA value. A labelled diagnostic no-AA comparison remains local to that
comparison; the next explicit bloom setter call restores policy, while resize
and ordinary comparison renders retain the diagnostic override.

Shadow caster budgets count **submitted draws**, including groups and the active
LOD. Instance and triangle budgets count **actual submitted work**, not merely
selected casters: a full instanced batch still costs its submitted instances and
triangles when an attribute masks some instances in the shadow shader. Admit
whole batches only when they fit, or use an explicitly bounded compacted
representation. Selected and submitted counts must remain separate diagnostics.
The existing `GeneratedWorldRuntime` ink ceilings (8 draws per region, 48 visible)
remain the authoritative constants and are not replaced with per-tier copies.

All numerical enhanced envelopes are provisional engineering limits, not
achieved-device claims. They do not change `MAX_ACTORS = 25`, companion identities,
collision, navigation, squad LOS/focus, terrain samples, generation fingerprints,
RNG ownership, combat windows, injuries, objectives, or saves.

The [subsystem allocation contract](graphics-subsystem-budgets.md) partitions
these same global ceilings between dynamic art, world, and post/transient effects.
It is acceptance data, not another preference or permission to alter gameplay.
Incomplete subsystem attribution remains explicitly incomplete.

## Default promotion and diagnostic comparisons

The September 17, 2026 settings change promotes the integrated enhanced path to
High by default at the user's request. `VISUAL_PREVIEW_AVAILABLE` remains the
single compiled capability flag; consumers still use the resolved policy.
This promotion is not a new claim of physical-device or performance certification.

The graphics runner defaults to enhanced/High. Its `--visual-mode` and `--quality`
arguments now use `visualMode` and `visualQuality` query parameters, accepted only
with `graphicsDiagnostics=1`, rather than retired local-storage preferences.
Invalid diagnostic values fail explicitly. Without diagnostic opt-in the query
cannot override the normal defaults. Explicit legacy comparisons retain the
original renderer, and lower enhanced tiers remain covered by policy tests.
Diagnostic choices are never persisted in campaign or interface records.

Run `node scripts/graphics-run.mjs --out ABSOLUTE_DIRECTORY --cases guard-opening --repeat 1 --settings-controls`
to check real desktop/mobile menu and pause controls, fresh and migrated High
defaults, live HUD changes without an engine restart, and save/continue preservation.
The same check measures all three launch buttons inside the initial QHD viewport,
including 125% and 150% display scaling, and verifies the bottom settings layout.
The runner also asserts that requested diagnostic comparisons match the active policy.

Pure tests can pass `{ enhancedAvailable: false }` to exercise the unavailable
capability fallback. An environment override alone does not allocate graphics or
constitute browser evidence.

## Sizing and resource ownership

`resolveVisualViewport(render, width, height, devicePixelRatio): VisualViewport`
returns CSS dimensions, device and effective pixel ratios, and integer 3D buffer
dimensions. It rejects invalid measurements, accommodates zero-sized hidden
containers, and enforces the tier's internal pixel ceiling. This is sizing data,
not a second resize observer or proof of a target allocation. GFX-02 owns the
coordinator-authorized narrow adapter at the existing engine resize call site:
consume this helper and synchronize the sole `BloomPostProcessor`'s actual
dimensions and pixel ratio. AA and ink consume those actual internal dimensions.
GFX-06 retains the policy/helper and final sizing/lifecycle acceptance. No second
resize controller is introduced. The original enabling checkpoint preserved the existing renderer sizing path.
The GFX-02 adapter now applies the resolved CSS dimensions/pixel ratio atomically
with `setDrawingBufferSize` on the enhanced path; legacy keeps its original
`setPixelRatio` cap and `setSize` behavior. Both use the one existing resize
observer. Enhanced DPR changes re-enter that same adapter.

`BloomPostProcessor` uses the renderer's actual drawing-buffer dimensions, an
explicit scene target and composer pixel ratio 1. Thus cached composer DPR cannot
double-apply scaling after construction, resize or monitor changes. FXAA receives
the reciprocal actual input dimensions, and ink receives that same physical
viewport. Target sizing does not upscale the DOM/HUD or briefly allocate targets
using the previous CSS size and a new larger DPR.

`src/game/visualLifecycle.ts` exports:

```ts
interface VisualResourceOwner {
  dispose(): void
}

interface VisualFrameOwner extends VisualResourceOwner {
  render(): void
  setSize(width: number, height: number): void
}

function disposeOwnedVisualResources(owned: VisualResourceOwner[]): void
```

`BloomPostProcessor` is the sole frame/composer/output owner. The engine owns the
outer resize lifecycle; the frame owner resizes its targets. No actor, region,
material library, or effect may create a competing composer or output path.

The disposal helper drains an explicitly owned allocation list, de-duplicates
identities, releases in reverse acquisition order, attempts every release, and
throws an `AggregateError` containing failures. Repeated calls on that drained
list do nothing. Register allocations immediately so a failed later construction
step still releases earlier resources. Callers must report cleanup failures
before claiming a lower fallback path is safe.

Only exclusively owned allocations enter such a list. Libraries continue owning
their shared geometries, materials and procedural maps. Actor-owned derived
injury geometry and source skeleton/bone data belong to the actor; ink shells
borrow them. Release outline/registration bindings before the source owner.
Borrowing is never permission to dispose a skeleton, instance buffer or cached
material. The helper does not replace existing library reference receipts.

## Consumer file boundaries

GFX-06 owns these settings, policy, sizing/lifecycle helpers, App wiring, controls,
and their tests. GFX-01 owns diagnostics and whole-frame accounting, reading the
shared policy rather than creating competing quality settings.

GFX-02 owns camera/foreground registration, lighting/material/shader and
`BloomPostProcessor` implementation. Its common material environment extension
belongs on `StylizedArtLibrary.setLightingReference`: presentation time, wind,
rain/snow/wetness and sky/horizon inputs are copied into library-owned uniforms,
not authoritative weather. That shader/attribute API is defined by the foundation,
not implemented by the enabling settings contract.

GFX-03 and GFX-04 consume that foundation for character rigs and world art,
including matching source/ink/depth deformation and explicit registration
lifetimes. They do not build alternate settings, post pipelines, or shader
families. GFX-05 consumes the same presentation environment and density/motion
policy, owns pooled effects and the compact HUD, and separately addresses the
existing environment-setter coupling. Presentation occluders must not replace
the legacy camera-obstacle collection used by gameplay squad LOS/focus.
