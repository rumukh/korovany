# GFX-01: reproducible production fixtures and whole-frame accounting

This is instrumentation, **not a graphics upgrade or visual approval**. The
original gallery, its nine images, and its manifest are unchanged. The baseline
world is seed `20260906`, runtime ancestor
`f36ee7ce06c9cf7b1c220d04b707be4fcf1cc7ff`.

[Measured results and raw evidence](graphics-baseline-results.md)

## Run it

Use the existing Node/npm toolchain and an installed Chrome. No browser testing
framework or downloaded assets are needed. Run the existing command first; use
`npm ci` only if dependencies are missing. Commands below are PowerShell examples;
replace the absolute output directories with new directories of your own.

```powershell
npm run build
npm run graphics:baseline -- --out C:\graphics-evidence\captures --repeat 2
npm run graphics:baseline -- --out C:\graphics-evidence\active --cases elf-opening,guard-opening,villain-opening,crowded-25,streaming-boundary --profile --warmup 120 --frames 300
npm run graphics:baseline -- --out C:\graphics-evidence\counter-control --cases guard-opening,crowded-25 --profile --timing-only --warmup 120 --frames 300
npm run graphics:baseline -- --out C:\graphics-evidence\camera-route --cases elf-forest-obstruction,guard-riverside-close --profile --native-route --no-post --lifecycle
npm run graphics:baseline -- --out C:\graphics-evidence\touch-layout --cases guard-riverside-close,crowded-25,night --width 390 --height 844
```

`--chrome` (or `CHROME_PATH`) selects an executable. The Windows default is
`C:\Program Files\Google\Chrome\Application\chrome.exe`. `--headed` replaces the
default new-headless browser. `--no-post` uses the actual existing bloom-off
direct path, not an empty composer. `--dpr` defaults to 1; the engine's ordinary
DPR cap still applies and the manifest records the actual buffer size.

The runner serves **dist**, never the development server. It selects a unique
loopback port with Vite's `--strictPort`, creates a fresh browser profile inside
the requested artifact directory, and records the process IDs and Chrome flags.
It closes that browser, stops only its own children, and deletes only the profile
it created. It never opens the user's browser data. Existing result manifests
are not overwritten. Acquire the coordinated graphics lease before a run; do not
run two copies or simultaneous CPU-heavy builds during timing measurements.

Each run writes PNGs, per-capture JSON, raw per-frame profiles, browser events,
process logs, and `manifest.json`. Captures include a visible **STAGED FIXTURE**
label. The manifest identifies the Git revision, dirty worktree, built HTML hash,
hardware/browser/backend, viewport, settings, seed, time, and measurement mode.
Keep the raw files; a summary is not a replacement for them.

## What the fixtures mean

| Fixture | Actual production prerequisite |
| --- | --- |
| `elf-opening`, `guard-opening`, `villain-opening` | Fresh UI-launched world and normal starting actors, no relocation; held simulation with an explicit visual clock |
| `elf-forest-obstruction` | Real elf save, then field-manifest player/companion coordinates and yaw/pitch at the obstructing tree |
| `guard-riverside-close` | Real guard save beside the riverside shop; original yaw/pitch; the **production solver**, not a forced camera position, produces the collision view |
| `villain-slope` | Real villain save with field-manifest highland slope positions |
| `bridge-water-edge` | Generated bridge/river/terrain; nearby subjects placed using production terrain and collision queries |
| `crowded-25` | Normal world plus 25 actual NPCs, excluding the player; existing NPCs staged at legal separated points, missing slots filled through `spawnActor` and `ActorBudget` |
| `neutral-biome`, `night`, `rain`, `snow` | Real generated terrain; explicit presentation-only environment conditions |
| `streaming-boundary` | Actual connected region seam; scheduled normal forward/back input loads and unloads the production neighborhood |

The three JSON files under `scripts\graphics\saves` are unchanged exports of
isolated virtual game runs, **not personal browser saves**. They contain the
production local-storage save envelope and are read by the ordinary Continue
path and normalizer. Their times are approximately 32.2, 43.0, and 34.1 seconds.
Transient enemies, actions, projectiles and effects are not all persisted by the
save format. Reconstruction therefore retains saved health/objectives and
re-materializes actors normally; it is not a pixel-identical replay of the
earlier natural field sessions. No finale completion is implied.

Camera staging sets requested yaw/pitch only. It does not replace camera
collision. Position staging and crowd creation are explicit synthetic
prerequisites; they are never described as natural travel. `--native-route`
then performs real CDP mouse/keyboard input from that starting state, records the
input and before/after camera/player values, and uses the supported drag path if
native pointer capture is refused. It does not reproduce the original review's
input timing.

The crowded fixture does not modify HP, allegiance, combat timing, objectives,
actor budgets, or the cap. It verifies that the low-priority 26th reservation is
refused. NPCs can fight, die and leave the active set during a profile: raw rows
report allocated, living, moving, and acting populations separately. Corpses
count toward the production cap while the production cleanup policy retains
them. A screenshot with 25 allocated NPCs is not a claim that all 25 are visible
or alive throughout a long fight.

## Instrumentation contract

Without `?graphicsDiagnostics=1`, no diagnostic context, observer, GPU query,
fixture clock, or browser API is created. The default-off browser control starts
a real ordinary engine and verifies the API is absent.

The opt-in query also accepts `visualSeed` (uint32), `visualTime` (non-negative
seconds), and `visualWeather` (`clear`, `overcast`, `rain`, `snow`). These live in
`GraphicsClock`, using independent `art:graphics-fixture:*` streams. They never
replace `elapsed`, `weatherWeights`, or a gameplay RNG. Sun/sky, precipitation
and lightning use that presentation clock/seed. Actor action clocks remain the
real action clocks. This is not a deterministic full-combat replay system;
unrecorded input timing and pre-existing stochastic combat/FX can diverge once
simulation advances.

The version-1 `window.__korovanyGraphics` API exists for one engine lifetime:

| Method | Contract |
| --- | --- |
| `snapshot()` | Actual viewport, backend, camera, policy (when the integration getter exists), world fingerprint, actor counts, gameplay RNG states, resource ledger, latest complete frame |
| `world()` | Real blueprint, generated site/bridge positions and region bounds |
| `probe([{x,z}])` | Bounded, read-only production terrain/collision samples in the loaded neighborhood |
| `stage({label, player?, companions?, camera?, crowd?})` | Manual mode only; finite/bounded coordinates, existing companion identities and an explicit prerequisite label required |
| `render(frames = 1)` | Production builders' existing scene and render pipeline; zero simulation delta; **not an FPS measurement** |
| `step(frames = 1, deltaSeconds = 1/60)` | Bounded fixed-step calls to the actual logical-frame path; labeled manual, never substituted for RAF profiling |
| `profile({warmupFrames, sampleFrames, inputs?, counters?})` | Active production RAF updates; resolves after requested samples and bounded asynchronous GPU query draining |
| `stop()` | Explicit cancellation, rejects an outstanding profile |
| engine destruction | Cancels profiling, restores instance methods/`info.autoReset`, deletes owned queries, drops diagnostic references and removes the browser API |

`inputs` is an ordered array of `{frame, keys}`. It uses normal movement/shield
input and cannot save, rewrite RNG/time, or change stats. Profiling a paused or
ended run is rejected. A run ending before completion is an error, not a shorter
successful benchmark. Staging/manual stepping while profiling is rejected.
The diagnostic owners have bounded frame/query capacities and throw on lost
patch ownership rather than overwriting another instrument.

The integrated engine calls `GameEngine.getVisualPolicy()` directly and publishes
the immutable result at `snapshot().runtime.visualPolicy`. Its `preferences`
record contains the requested settings; `mode`, `previewAvailable`, and
`revision` describe the effective compiled presentation. An enhanced request does
not bypass preview availability. The outer `visualRevision` remains the GFX-01
fixture/instrumentation revision, not the effective art revision. Actual
rendering/buffer dimensions and pass submissions remain authoritative, regardless
of requested quality. See [the shared policy contract](visual-settings.md).

## Reading the measurements

**Intervals are not CPU durations.** `intervalMs` is the interval preceding the
current RAF callback, including browser pacing/scheduling. It is not capped to
the gameplay timestep. `updateMs` includes real game update, camera and audio
submission. `submissionMs` brackets rendering, including its CPU work and
instrumentation; `cpuMs` is their sum. Neither measures DOM compositing or all
browser threads. `streamingMs` brackets world update, actor region synchronization
and camera-obstacle refresh. Transition rows include both current and next RAF
intervals because a current CPU spike often stretches the **next** interval.

The complete logical frame sets `renderer.info.autoReset=false` and resets once,
before the update/render sequence. Instance-local GL draw observers count the
actual primitive and instance totals. They independently agree with the
accumulated renderer totals. A disagreement is a failure, not a scene-cost
estimate. Shadow `renderBufferDirect` calls with null scene, source ink shells,
ordinary scene work, and post work are separately labeled. The baseline bloom
chain submits 15 fullscreen draws; its final one-triangle reading is never
reported as the scene cost. Resolve blits are also recorded.

GPU time is returned only by a real `EXT_disjoint_timer_query_webgl2` extension.
Queries are bounded, polled only after `QUERY_RESULT_AVAILABLE`, and rejected
on disjoint/context loss. Unsupported, exhausted, and timed-out queries have
explicit statuses and null durations. No `finish()` or profiling readback is
used. The existing composer's one-time output validation is counted in cold
capture/resize frames; steady performance rows must have zero `readPixels`
calls.

`--timing-only` removes the GL draw/allocation and renderer wrappers and restores
native `info.autoReset`; it does **not** leave a boolean check in every draw.
Draw/resource data are null, never fake zeros. CPU markers, runtime telemetry
and supported GPU queries remain, so this is a **counter-disabled control**,
not an entirely uninstrumented application. Run it on fresh copies of the same
fixture with the same warm-up/sample settings. Compare CPU and GPU distributions
alongside the full-count run; do not blindly subtract one percentile from another
or claim an exact observer tax from two changing fights. The full-count run's
cost includes the observer tax.

Resource accounting is installed **before** renderer construction. It observes
buffers, texture storage/mips/faces/layers, renderbuffers, framebuffers,
programs/shaders and VAOs, including resources retained off-scene and composer
ping-pong targets. Resizes/replacements/deletion adjust the same ledger.
`renderTargetBytes` is a subset of `trackedBytes`, not an extra amount to add.
Depth24 is accounted as a 32-bit storage word; implicit multisampled-render-to-
texture storage and the canvas's color resolve/MSAA/depth are separate estimates.
Unknown formats are explicitly listed and prevent a complete-budget claim.
Driver overhead, alignment/tiling and extra browser swapchain copies are not
observable here. These numbers are **allocated API storage/estimates, not
resident VRAM measurements**.

Warm-up, steady samples, raw per-frame rows, initialization render cost, streaming
transitions and maxima are preserved separately. The opening UI/renderer build
and initial region materialization happen before the first render;
`runtime.initializationMs` measures the engine constructor separately from the
cold render. Neither includes the preceding menu/HTML parse. The runner records
whole-system CPU busy percentage over each profile from OS CPU-time counters;
this is a load observation, not attribution to particular processes.

Repeat captures compare lossless pixels, not only compressed hashes. The
declared same-device tolerance is at most 16 changed pixels with a maximum
channel difference of 2/255 across the entire image, to admit tiny browser DOM
compositor rounding; larger drift fails the run. Raw images/hashes, the changed
pixel count, delta, and bounding rectangle remain available. This is not a
cross-GPU pixel equivalence guarantee and does not constitute human approval.

## Scope and release limitations

All performance targets in the master plan remain **integration targets**.
Exceeding one is evidence for later improvements, not permission to raise a cap,
remove actors or promote a visual tier. No hardware tier is approved by this
harness. A 390x844 window on a discrete-GPU desktop is only layout evidence.
Real mobile and integrated-GPU measurements, sustained thermal/device behavior,
and human visual approval remain required before the corresponding release gate.

The runner isolates its browser/profile/server, not the entire shared computer.
Record the machine, OS/browser/driver/backend, dimensions, headless/headed mode,
power/thermal state if known, and overlapping work. Do not compare runs taken
while other workers compile or benchmark. No process-name-based termination or
reconfiguration of unrelated applications is part of this tool.
