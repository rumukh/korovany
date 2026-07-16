# Bloom Post-Processing

> Design spec for КОРОВАНЫ. Fully client-side — no backend, no new art assets.
> Wraps the existing render loop in an `EffectComposer` and reuses the emissive
> materials already on torches, projectiles, the sky sun, and faction accents.

## 1. Goal

Add a **selective bloom** post-processing pass so the game's many emissive elements —
torch flames, the sky sun, faction-colored beacons, magic/arrow trails — glow the way
they visually promise to, without washing out the flat-shaded world. This is the single
highest-impact-per-line visual upgrade because the art is already emissive-heavy; it
just isn't blooming.

## 2. Current baseline (reference)

| System | Location | Notes |
| --- | --- | --- |
| Render loop | `loop()` | `renderer.render(this.scene, this.camera)` every frame — **no composer, no post FX.** |
| Tone mapping | constructor | `ACESFilmicToneMapping`, exposure `0.92`, `outputColorSpace = SRGBColorSpace`. |
| Pixel ratio | constructor | `setPixelRatio(min(devicePixelRatio, 1.75))`. |
| Emissive sources | `createTorch()`, `createAtmosphere()`, `factionColor()` beacons, projectile/ability meshes | `MeshStandardMaterial.emissive` (flames `emissiveIntensity` up to ~1.55) and `MeshBasicMaterial` sun. |
| Resize | `ResizeObserver` | Updates `camera.aspect` + `renderer.setSize`. |
| Teardown | `destroy()` | Cancels rAF, disposes renderer/scene. |

`three@0.185` ships the required `postprocessing` example modules
(`EffectComposer`, `RenderPass`, `UnrealBloomPass`, `ShaderPass`, `OutputPass`).

## 3. Approach

Introduce an `EffectComposer` and render through it. Because bloom must operate in
**linear HDR**, tone mapping and sRGB conversion move to the end of the chain via
`OutputPass`, preserving the current ACES look. In Three.js r185, `OutputPass` reads
the tone-mapping mode and exposure from the renderer, so the renderer must remain
configured with `ACESFilmicToneMapping` and exposure `0.92`:

```text
RenderPass(scene, camera)            // off-screen linear HDR
  → UnrealBloomPass(resolution, strength, radius, threshold)
  → OutputPass()                     // reads renderer ACES/exposure and applies ACES + sRGB
```

Two options for selectivity, in preference order:

1. **Threshold bloom (ship first).** A single `UnrealBloomPass` with `threshold ≈ 0.85`
   so only bright/emissive pixels bloom. Cheapest, and good enough given the palette.
2. **Selective (masked) bloom (optional follow-up).** Two-pass: render a bloom-only
   layer (objects on `BLOOM_LAYER`) into a bloom texture, then additively composite over
   the base with a `ShaderPass`. Use only if threshold bloom bleeds into bright ground
   textures. Emissive meshes opt in via `mesh.layers.enable(BLOOM_LAYER)`.

## 4. Engine changes (`GameEngine.ts`)

Use a focused `BloomPostProcessor` helper so the composer lifecycle is isolated from
the gameplay engine. `App` owns the persisted preference, as it already does for theme,
music, and dynamic day/night; `GameEngine` receives the initial value and exposes a
live setter.

- **Constructor / `BloomPostProcessor.setEnabled()`** — build the composer after the
  renderer pixel ratio and output settings are configured; add `RenderPass`,
  `UnrealBloomPass`, and `OutputPass`. When `bloomEnabled` is false, do not retain
  composer render targets.
- **`loop()`** — render through the composer when enabled, else fall back to the current
  direct `renderer.render` path:
  ```ts
  if (this.composer) this.composer.render()
  else this.renderer.render(this.scene, this.camera)
  ```
- **Tone mapping** — leave `renderer.toneMapping`, `toneMappingExposure`, and
  `outputColorSpace` unchanged for both paths. `OutputPass` consumes those settings,
  while direct rendering continues to apply them exactly as before.
- **Resize handler** — call `composer.setSize(w, h)` with logical pixels. The composer
  already captures the renderer pixel ratio and resizes every pass; do not separately
  mutate `bloomPass.resolution`. Keep the `min(dpr, 1.75)` cap.
- **`destroy()` / live disable** — explicitly dispose each added pass, then dispose the
  composer render targets. `EffectComposer.dispose()` does not dispose its pass list.

## 5. Interaction with the day/night spec

If the day/night cycle ships, bloom makes torches and windows read beautifully after
dark. Recommend a modest **night bloom boost**: scale `bloomPass.strength` by
`1 + nightFactor * 0.4` inside `updateDayNight` so nighttime feels luminous without
overblowing daytime. This remains an optional follow-up; the shipped bloom path is
deliberately independent of the private day/night state.

## 6. UI / settings

- **Settings toggle** `Свечение (bloom)` on/off, persisted in `localStorage`
  (`korovany-bloom`), mirroring `theme` / `musicMuted`. Default **on** for fine-pointer
  devices and **off** for coarse-pointer devices.
- Optional 3-step **quality** select (`Off / Medium / High`) mapping to bloom
  resolution + strength presets; `Off` uses the direct-render fallback. This doubles as
  the perf escape hatch for low-end GPUs.
- No `GameView` or `SavedGame` change (render setting, not game state).

## 7. Tuning constants

```text
BLOOM_STRENGTH=0.55     BLOOM_RADIUS=0.4     BLOOM_THRESHOLD=0.85
BLOOM_NIGHT_BOOST=0.4   (only if day/night present)
Presets:  Medium → strength 0.4, half-res    High → strength 0.55, full-res (dpr-capped)
BLOOM_LAYER=1           (only for optional selective mode)
```

## 8. Edge cases

- **Exposure parity:** verify OutputPass reproduces the current exposure `0.92` /
  ACES look; adjust `toneMappingExposure` on the composed output if needed so the
  toggle is visually seamless.
- **Fog + sky:** the sky sun (`MeshBasicMaterial`, `fog:false`) should bloom; ensure the
  threshold doesn't bloom bright fog/horizon bands — tune `threshold`, or use selective
  mode.
- **Transparency ordering:** smoke/particle transparent materials must still sort
  correctly through `RenderPass` (they do — same forward render).
- **Context loss / resize storms:** guard composer calls when width/height is 0
  (minimized) to avoid zero-sized render targets.
- **Low-end fallback:** coarse-pointer devices default to `Off`; the persisted toggle
  remains the explicit escape hatch on other low-end devices.

## 9. Acceptance criteria

- [ ] Torch flames, the sky sun, projectiles, and faction beacons visibly bloom; flat
      ground/props do not.
- [ ] Composer path preserves the current ACES tone map + exposure; toggling bloom off
      is visually identical to today's direct render.
- [ ] Resize and pixel-ratio cap are respected; no zero-sized target crashes.
- [ ] Settings toggle (and optional quality preset) persists and applies live.
- [ ] `destroy()` disposes all passes/targets; no GPU leak across run restarts.
- [ ] 60 fps on mid-range hardware at `High`; TypeScript build and oxlint pass.

## 10. Effort

**~0.5 day** for threshold bloom + toggle + resize/teardown wiring. Optional selective
(masked) bloom adds **~0.5 day**.
