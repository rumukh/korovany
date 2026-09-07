# GFX-01 baseline results

**The reproducible tooling and available-hardware baseline are delivered. No
graphics tier or performance target is approved by these results.** In particular,
the real 25-NPC encounter exceeds the proposed 700-draw High ceiling, and the
measured RAF p95 values do not meet the literal 16.7 ms target.

[Runbook and API](graphics-baseline-tooling.md) |
[Evidence index, metadata and trace hashes](images/gfx-01-baseline/evidence.json)

The measured checkpoint is
`931360200e5d24cb6f02da3ac1066174aeb0309f` (instrumentation implementation
`fce7207bd44cebe91275b15318da6b7e9af613c8` plus a bounded Windows loopback-readiness
fix). All four final runs recorded a clean worktree and the same built HTML.
The original nine-image field review remains unchanged.

## Conditions and limits

AMD Ryzen 7 5800X (8 cores/16 threads), MSI MS-7C91 system, approximately 96 GiB
installed RAM, NVIDIA GeForce RTX 4070 Ti SUPER, Windows 10 (`10.0.19045`), driver
`32.0.16.1088`. Chrome `152.0.7977.76`, new-headless mode, actual
**ANGLE NVIDIA / Direct3D11 / WebGL2**, THREE revision 185. The real
`EXT_disjoint_timer_query_webgl2` extension was available without forcing a
backend or enabling a synthetic timing source.

Main measurements used 1920x1080 CSS and internal pixels, DPR 1, high foliage,
bloom/ink/weather/dynamic lighting/camera effects enabled. Music and SFX were
muted; audio update/submission code still ran. Each profile had **120 active
warm-up frames and 300 active sample frames**. Capture-time CSS animation holds
were released before profiling. The renderer's ordinary simulation-delta clamp,
hit stop, actor cap, AI, combat, injury, objective and save behavior were retained.

The browser/profile/server were isolated, **not the entire machine**. Other
graphics workers had no GPU lease; the coordinator put waiting workers idle
before the final runs. Whole-system CPU busy percentage still ranged from
**14.9% to 41.3%** over the desktop profile windows. That includes game, browser,
harness and other system work; no attribution to unrelated processes is claimed.
Power/thermal policy was not fixed. These are useful instrumented desktop
observations, not a globally isolated laboratory result.

**Unavailable:** real mobile and integrated-GPU devices. The nine 390x844 cases
are layout/capture evidence on this same discrete-GPU desktop, not device
performance passes. Sustained thermal behavior and human visual approval remain
release requirements.

## Active desktop measurements

Milliseconds below are separate p95 distributions. RAF is browser frame-interval
pacing; CPU update and submission are actual engine work. Percentiles of separate
components must not be added to construct a percentile of their sum. Draws include
scene, ink, shadow and post submissions. Main-view triangles include scene and
ink, excluding shadow/post copies.

| Fixture | RAF p95 | CPU update p95 | CPU submit p95 | GPU p95 | Max draws | Max main-view triangles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Elf opening | 17.7 | 2.4 | 8.3 | 8.79 | 617 | 315,912 |
| Guard opening | 17.2 | 1.3 | 3.3 | 3.47 | 516 | 84,888 |
| Villain opening | 17.2 | 1.6 | 3.1 | 2.55 | 319 | 97,232 |
| Forest obstruction | 17.0 | 2.6 | 6.1 | 6.22 | 369 | 308,054 |
| Riverside close camera | 16.9 | 2.5 | 5.2 | 4.56 | 522 | 349,058 |
| Villain slope | 16.8 | 1.7 | 4.2 | 5.59 | 645 | 233,206 |
| Bridge/water edge | 17.4 | 2.8 | 9.3 | 8.61 | 745 | 253,186 |
| Crowded 25-NPC encounter | 17.7 | 3.0 | 9.2 | 9.75 | **1,423** | 179,652 |
| Neutral biome | 17.5 | 2.0 | 7.2 | 6.28 | 687 | 99,724 |
| Night | 17.3 | 1.7 | 4.7 | 3.68 | 503 | 84,888 |
| Rain | 17.4 | 1.9 | 6.8 | 6.27 | 688 | 99,724 |
| Snow | 17.4 | 1.9 | 6.9 | 7.40 | 688 | 99,724 |
| Streaming boundary | 17.6 | 1.4 | 3.5 | 4.82 | 430 | 127,480 |

The crowded run held **25 allocated NPCs in all 300 measured frames**, plus the
player. Between 21 and 25 NPCs were alive, and up to 11 had live actions.
The sample's CPU-total p95 was **12.0 ms**; its maximum whole-frame triangle
count was **252,551**. These are real production actors and combat, not 25
decorative models or a paused scene. Corpses remain in the cap according to the
ordinary production lifetime. No stats were inflated and no dead actors were
replaced to keep the count up.

Across the desktop and native/no-post profiles there are **4,500 steady
full-counter frames**: zero inactive frames, zero GL/accumulated-renderer counter
disagreements, and **zero steady-frame `readPixels` calls**. The bloom pipeline
submits 15 post draws, not the final single triangle reported by the old
last-pass reading.

## Counter-disabled control

These controls use fresh copies of the same guard/crowd fixtures, warm-up and
sample lengths. The GL allocation/draw and renderer wrappers were actually
removed and native `info.autoReset` restored. CPU markers, runtime telemetry and
supported GPU queries remained. Draw and allocation fields are explicitly null.

| Fixture / mode | CPU total p50 | CPU total p95 | GPU p95 | System CPU busy |
| --- | ---: | ---: | ---: | ---: |
| Guard, full counters | 3.1 ms | 4.5 ms | 3.47 ms | 18.1% |
| Guard, counters removed | 3.2 ms | 5.5 ms | 5.48 ms | 22.9% |
| Crowd, full counters | 7.9 ms | 12.0 ms | 9.75 ms | 26.5% |
| Crowd, counters removed | 8.1 ms | 11.6 ms | 9.47 ms | 23.7% |

The load and live fights differ enough that these pairs **do not isolate an
exact profiler tax**. No subtraction, zero-overhead claim or corrected game-only
number is applied. The full-counter timings include instrumentation overhead.
Quieter, replicated device runs are needed for precise overhead calibration.

## Cold, streaming and allocation evidence

Engine initialization and the first render are recorded separately. For the
first capture in each desktop case, constructor times ranged from about
**119.6 to 377.2 ms**, and cold render times from **90.4 to 760.9 ms**. They
include real procedural construction or shader/target initialization within
their named scopes, but not the preceding menu/HTML parse. Warm-up spikes are
not discarded from the raw trace: the crowd's largest warm-up RAF interval was
**183.2 ms**, despite its much lower steady p95.

The streaming case used normal forward/back input at the connected west edge of
the guard's opening region. It actually crossed into `region-3-0` and back:

| Transition | Streaming CPU | Whole engine CPU | Next RAF interval | API storage change |
| --- | ---: | ---: | ---: | --- |
| Load `region-2-0` and `region-2-1` | 24.9 ms | 38.5 ms | 39.5 ms | 583,720 bytes allocated |
| Unload those regions on return | 2.9 ms | 5.6 ms | 17.4 ms | 94,080 bytes released |

The differing load/unload byte totals include retained production caches; they
are not, by themselves, a memory leak.

Desktop sampled API storage peaked between **103.18 and 105.07 MiB**, including
**101.20 MiB of render targets** (a subset, not an amount to add again). The
canvas's separately estimated RGBA resolve, four-sample color, and depth add
about **71.19 MiB** at 1920x1080. The resulting scope is roughly
**174.4-176.3 MiB**, before unobservable browser swapchain, driver/program,
alignment and tiling overhead. No unknown format was encountered.

The native/no-post routes submitted **zero post draws** and retained a
32.0 MiB shadow-target allocation instead of the bloom target set. They are not
a matched visual A/B timing comparison because native input changed the camera.

Three real pause/menu/Continue/destruction cycles were exercised for each
forest/riverside route. The API was removed and diagnostic methods/queries
released; repeated resumed allocations settled. However, the ledger still
observed **33,566,496 bytes, eight texture handles and one program** after each
engine destruction, before context garbage collection; geometry buffers were
zero. The residual was identical across the cycles. This is **not a zero-resource
sign-off and not proof of a resident VRAM leak**. It is a concrete shadow/renderer
ownership follow-up for the integration lifecycle pass.

## Repeatable scenes, not retouched beauty shots

All 26 capture pairs across the four final runs passed the declared small
same-device tolerance. **19 pairs were byte-identical**. The remaining seven
differed by only one or two pixels, with a maximum channel difference of 1/255;
the exact locations, hashes and comparison data are preserved. No image was
retouched. A tolerance result is not a cross-driver pixel guarantee or visual
approval.

The forest scene reproduces instanced foliage across the subjects, including
structural `region-1-1` instance 6. The guard collision solver reproduces a
**1.842 m horizontal camera distance**, without overriding the camera position.
The native routes successfully used the game's drag fallback after Chrome
refused pointer capture, with actual yaw change and player movement.

| Desktop fixture | Raw capture |
| --- | --- |
| Three faction openings | [Elf](images/gfx-01-baseline/desktop/elf-opening.png), [guard](images/gfx-01-baseline/desktop/guard-opening.png), [villain](images/gfx-01-baseline/desktop/villain-opening.png) |
| Foreground tree and collision camera | [Forest](images/gfx-01-baseline/desktop/elf-forest-obstruction.png), [riverside](images/gfx-01-baseline/desktop/guard-riverside-close.png) |
| Slope and crossing | [Villain slope](images/gfx-01-baseline/desktop/villain-slope.png), [bridge/water](images/gfx-01-baseline/desktop/bridge-water-edge.png) |
| Real crowd | [Staged 25-NPC setup](images/gfx-01-baseline/desktop/crowded-25.png), [active combat endpoint](images/gfx-01-baseline/desktop/crowded-25-active-end.png) |
| Environment | [Neutral](images/gfx-01-baseline/desktop/neutral-biome.png), [night](images/gfx-01-baseline/desktop/night.png), [rain](images/gfx-01-baseline/desktop/rain.png), [snow](images/gfx-01-baseline/desktop/snow.png) |
| Streaming prerequisite | [Connected boundary](images/gfx-01-baseline/desktop/streaming-boundary.png) |
| No-post native endpoints | [Forest](images/gfx-01-baseline/native-no-post/elf-forest-obstruction-active-end.png), [riverside](images/gfx-01-baseline/native-no-post/guard-riverside-close-active-end.png) |
| 390x844 problem cases | [Crowd](images/gfx-01-baseline/small-viewport/crowded-25.png), [riverside](images/gfx-01-baseline/small-viewport/guard-riverside-close.png), [night](images/gfx-01-baseline/small-viewport/night.png) |

The 390x844 captures retain the existing crowded HUD and severe riverside
cropping; they do not declare those readability problems solved.

## Evidence and acceptance state

The evidence directory commits 27 unmodified representative PNGs, all 26
first-capture metadata records, the four original run manifests, and **17
losslessly gzipped raw per-frame JSON profiles** with both compressed and
uncompressed SHA-256 hashes. The index maps every file. Full raw capture pairs,
browser event logs, process logs, and the collection script remain in:

```text
C:\Users\predi\.copilot\session-state\78d2667c-359d-4f21-a9bb-3ed54c0390f0\files
  gfx01-final-desktop-02
  gfx01-final-controls
  gfx01-final-native
  gfx01-final-layout
```

The runner proved the ordinary no-query engine has no diagnostics API. All eight
recorded browser/server PIDs were stopped, all owned profiles removed, and the
graphics lease was released before this report was packaged. No external asset
requests occurred in the measured fixture pages. The production build and
single-file offline bundle completed, focused lint was clean, and 101 targeted
Node cases covered hooks, negative controls, save/world/RNG invariants, actor
budget and outline ownership.

**Integration decision:** retain the proposed targets as gates; do not silently
raise them or remove actors. High draw and pacing gates remain unmet, with the
crowd and bridge exceeding 700 draws. The observed main-view triangle count is
below the proposed High ceiling in these bounded scenes, but that does not
approve future richer art or untested devices. Balanced/mobile scope cannot be
finalized from a discrete desktop. Real mobile/integrated measurements, residual
resource ownership review, sustained device trials and human visual approval
remain explicitly open.
