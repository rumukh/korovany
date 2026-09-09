# Visual preferences and preview integration

The graphics preview uses the existing `GameEngineSettings`, `GameEngineOptions`,
App preference state, effect setters, and save/continue flow. It does not introduce
another game engine, campaign format, or settings service.

## Player-facing behavior

The menu and pause dialog offer **Исходная / Улучшенная (предпросмотр)** and
**Высокое / Сбалансированное / Низкое**. Legacy remains the default. Quality only
affects the enhanced path; selecting Low must not degrade the legacy comparison.

Mode and quality are construction-scoped. Changing a selector records a pending
preference, not a live scene rebuild. The pause dialog separately identifies the
current rendering mode and explains how to apply a change: leave through
**В главное меню**, which saves the active campaign, then continue that campaign
from the menu. Closing pause keeps the current engine and visuals. The existing
menu action refuses to leave when its checkpoint cannot be persisted; selectors
never start a new campaign, clear a save, or resume a paused fight.

`hudMode` is a DOM-only Full/Compact preference reserved for the compact HUD
consumer. It defaults to Full and is excluded from renderer reload comparisons.
It is not a `GameView`, `RunConfig`, or `GameEngineSettings` field.

New preferences are stored as one versioned record at
`korovany-visual-preferences`. Existing bloom, ink, foliage, weather, camera,
day/night, audio, and theme keys remain authoritative and are not migrated or
overwritten. Invalid records and storage failures use the existing
`Korovany: ...` console-warning convention. A failed preference write also leaves
a visible message in the controls; the selection remains usable in the current
tab without claiming it was persisted.

## Public settings and policy contract

`src/game/visualSettings.ts` exports:

| Export | Contract |
| --- | --- |
| `VisualLaunchPreferences` | `visualMode: 'legacy' \| 'enhanced'`, `visualQuality: 'high' \| 'balanced' \| 'low'` |
| `VisualPreferences` | Launch preferences plus `hudMode: 'full' \| 'compact'`; App-owned |
| `VisualSettings` | Launch preferences plus the existing `dynamicDayNight`, `weatherEnabled`, `bloomEnabled`, `inkOutlinesEnabled`, `screenShakeEnabled`, `foliageQuality` engine fields |
| `FoliageQuality` | Existing `'off' \| 'low' \| 'high'`; still re-exported from `GameEngine.ts` |
| `normalizeVisualPreferences(value, onWarning?)` | Validated, immutable preferences; invalid fields warn and independently fall back |
| `normalizeVisualSettings(value, onWarning?)` | Immutable engine visual subset; no device probing, campaign data, or HUD field |
| `loadVisualPreferences(storage, onWarning?)` | Reads the new record only; accepts the existing `StorageLike` read interface |
| `saveVisualPreferences(storage, preferences, onWarning?)` | One write, returns `false` on failure; never writes campaign or old effect keys |
| `visualPreferenceApplication(selected, active)` | `'next-launch'`, `'current'`, or `'reload-required'`; HUD-only changes do not require a reload |
| `foliageQualityDensity(quality)` | Existing density mapping: Off 0, Low 0.55, High 1 |

`GameEngineSettings extends VisualSettings`; `GameEngineOptions` retains its
existing partial-options/required-`generatedRun` shape. There is no
`setVisualMode` or `setVisualQuality` API that could update only future spawns.
The existing live effect setters refresh the policy and retain their current
application paths.

`GameEngine.getVisualPolicy(): VisualQualityPolicy` returns the cached,
deeply immutable policy from `src/game/visualPolicy.ts`. Reading it does not
allocate each frame.

| Policy field | Meaning |
| --- | --- |
| `preferences` | Normalized requested engine visual settings, including independent off preferences |
| `mode`, `quality`, `previewAvailable`, `revision` | Effective legacy/enhanced mode, requested tier, compiled capability, and presentation-only revision |
| `reducedMotion`, `cameraEffects` | Explicit environmental motion preference and permitted decorative camera effects |
| `camera` | `collision: 'legacy-ray' \| 'volume'`, `foregroundFade`; no gameplay sight-policy input |
| `render` | `scale`, `maxPixelRatio`, `maxPixels`; CSS/HUD layout stays unscaled |
| `post` | `enabled`, `bloom`, `grade`, `antialiasing: 'none' \| 'fxaa'` |
| `shadows` | `mapSize`, `worldDistance`, `worldCasterBudget`, `worldInstanceBudget`, `worldTriangleBudget` |
| `ink` | `enabled`, `minPixels`, `maxPixels`; legacy retains its existing extrusion instead |
| `lod` | `distanceScale`, fractional `hysteresis`; character projected-importance selection and world LOD consume the same tier envelope |
| `density` | Bounded `foliage`, `weather`, `ambientLife`, and `particles` cosmetic factors |
| `budget` | Provisional frame-time, whole-frame draw, main-view triangle and tracked-resource ceilings; `null` for the unchanged legacy comparison |

`resolveVisualPolicy(settings, environment?)` is the pure resolver.
`environment.reducedMotion` is supplied by the caller; the resolver performs no
media-query, user-agent, GPU, simulation, or random-stream access.

Bloom disabled always resolves to **no composer**, including in enhanced mode.
Low enhanced also resolves to the direct path. Selecting enhanced must never
turn a stored bloom-off preference back on. Runtime allocation/driver failures
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

## Capability activation is not visual approval

At the original enabling checkpoint `VISUAL_PREVIEW_AVAILABLE` was `false`.
The GFX-02 foundation now sets it to `true` for an explicitly requested enhanced
preview. Legacy remains the stored default. This enables the camera, foreground,
material/ink, bounded world-shadow and AA foundation, not the later character,
world-content or atmosphere upgrades and not an approved hardware tier.

The supported next-stage activation is a **coordinated checkpoint change** to
this single constant in `visualPolicy.ts`, alongside the integrated GFX-02
consumers. GFX-02 may make that change in its coordinator-approved implementation
checkpoint to capture its actual preview. This is not a per-device guess or an
additional feature flag in each builder. Consumers use effective policy fields,
not private copies of `visualMode` or URL-dependent bypasses.

Pure tests can explicitly pass `{ enhancedAvailable: true }` to the resolver to
exercise candidate policy data before GPU work. That override alone does not
activate an engine, allocate graphics, or constitute browser evidence.
Enabling capability leaves `DEFAULT_VISUAL_PREFERENCES.visualMode = 'legacy'`.
Human visual approval, real-device budgets and default promotion are separate
gates owned by the coordinator. Partial preview milestones must not be described
as completed quality tiers.

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
