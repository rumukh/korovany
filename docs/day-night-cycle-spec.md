# Day/Night Cycle & Dynamic Sky

> Design spec for КОРОВАНЫ. Fully client-side — no backend, no new art assets.
> Reuses `setupLights`, `createAtmosphere`, `updateAtmosphere`, the `this.palette`
> colors, torch `PointLight`s, and the already-tracked `elapsed` clock.

## 1. Goal

Replace the fixed midday lighting with a looping **day → night cycle** that arcs the
sun across the sky and recolors the sky dome, fog, ambient, and sun light through
dawn, noon, dusk, and night. Torches and building windows glow after dark. The effect
is purely cosmetic — no mission, combat, or save rule changes — and it respects the
active UI theme because every color is derived from `this.palette`.

## 2. Pre-implementation baseline (reference)

| System | Location | Notes |
| --- | --- | --- |
| Sun light | `setupLights()` | `DirectionalLight(worldSun, 2.65)` fixed at `(-35, 58, 24)`; shadow map 2048, ortho frustum ±85. Held in a **local** — not a field. |
| Ambient | `setupLights()` | `HemisphereLight(worldSky, worldAmbientGround, 1.65)`, also local. |
| Sky dome | `createAtmosphere()` | Gradient sphere (r 178) `worldSky → worldHorizon → worldFog`; emissive sun mesh at `(-88, 74, -112)`; 10 drifting cloud groups in `this.clouds`. |
| Fog | constructor | `new THREE.Fog(worldFog, 48, 132)`. |
| Background | constructor | `scene.background = worldSky`. |
| Torch flames | `createTorch()`, `this.flames[]` | Emissive cones that pulse in `updateAtmosphere`. Each torch also adds a `PointLight(warning, 1.4, 11, 2)` that is **not** currently stored. |
| Clock | `update()` | `this.elapsed` accumulates clamped delta; persisted in `SavedGame`. |
| Tone mapping | constructor | `ACESFilmicToneMapping`, exposure `0.92`. |

## 3. Time model

```text
DAY_LENGTH = 240            // seconds for a full 24 h loop (tunable)
DAY_START_OFFSET = 0.18      // new campaigns begin in mid-morning
dayPhase   = (elapsed / DAY_LENGTH + DAY_START_OFFSET) % 1
                             // 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight
sunAngle   = dayPhase * TWO_PI
elevation  = sin(sunAngle)                  // −1..1; > 0 means the sun is above the horizon
nightToTwilight = smoothstep(-0.18, 0.08, elevation)
twilightToDay   = smoothstep( 0.08, 0.60, elevation)
dayFactor       = smoothstep(-0.08, 0.45, elevation)
nightFactor     = 1 - dayFactor
```

Because `dayPhase` is derived from the persisted `elapsed`, **the time of day is
reconstructed automatically on load** — no new save fields. The constant offset applies
equally to new and loaded games, so `elapsed = 0` starts in mid-morning and the same save
always reloads at the same phase.

## 4. Lighting keyframes

Colors are computed **relative to `this.palette`** (never hard-coded), so light and
dark UI themes both work. Two smoothstep weights blend the three stops by `elevation`:

| Stop | `elevation` | Sun intensity | Sun color | Background | Fog | Hemisphere |
| --- | --- | ---: | --- | --- | --- | --- |
| Night | ≤ −0.18 | 0.15 | `mix(worldSun, worldFog, 0.7)` | `mix(worldSky, worldFog, 0.45) × 0.22` | `worldFog × 0.35` | 0.45, both colors dimmed |
| Dawn/Dusk | 0.08 | 1.4 | `mix(worldSun, danger, 0.35)` | `mix(worldSky, warning, 0.4)` | `mix(worldFog, warning, 0.3)` | 1.0, warm tints |
| Day | ≥ 0.60 | 2.65 | `worldSun` | `worldSky` | `worldFog` | 1.65 |

The gradient sky texture is multiplicatively tinted: its day keyframe must therefore be
neutral white, not `worldSky`, or the baseline texture is darkened twice. Its twilight
and night tints are palette-derived; the night tint is
`mix(worldSky, worldFog, 0.45) × 0.28`. `nightFactor` drives torch/window glow (§5).

## 5. Engine changes (`GameEngine.ts`)

Promote the lights to fields and add a per-frame driver.

```ts
private sun!: THREE.DirectionalLight
private hemisphere!: THREE.HemisphereLight
private skyMaterial!: THREE.MeshBasicMaterial    // sky-dome tint
private sunDisc!: THREE.Mesh                     // emissive sky sun
private moonDisc!: THREE.Mesh                    // small emissive sphere
private stars!: THREE.Points
private readonly torchLights: THREE.PointLight[] = []
private readonly buildingWindowGlows: BuildingWindowGlow[] = []
private readonly backgroundColor = new THREE.Color()
private readonly fog: THREE.Fog
private readonly dayNightKeyframes: DayNightKeyframes
```

- **`setupLights()`** — assign `this.sun` / `this.hemisphere` instead of locals. Keep
  the shadow frustum (±85 covers the ~160 m world) but let the sun **position** be
  driven each frame; keep `sun.target` at the origin.
- **`createAtmosphere()`** — keep the gradient sphere but store its material as
  `this.skyMaterial` and drive its `.color` tint; store the sun mesh as `this.sunDisc`;
  add `this.moonDisc` on the opposite arc and a deterministic 180-point star field
  (`opacity = nightFactor² × 0.88`, `fog:false`). Push each torch's point light into
  `this.torchLights` from `createTorch()` and register each shared building-window
  material with its legacy emissive intensity.
- Keep a dedicated `backgroundColor`; assigning `scene.background = palette.worldSky`
  and then mutating it would corrupt the palette source color by reference.
- **`updateDayNight()`** — called from `update()` before `updateAtmosphere`:
  1. compute `dayPhase`, `elevation`, and the three blend factors;
  2. place the light on the 90 × 70 × 40 arc, clamping only its Y value to 8 for stable
     shadows; place the visible sun 150 m along the true arc and the moon opposite;
  3. lerp sun color/intensity, both hemisphere colors + intensity, fog, background,
     and sky tint from the §4 keyframes;
  4. ramp torch lights `1.4 → 2.6`, flame emissive `0.9 → 2.15`, window emissives,
     moon/sun opacity, and star opacity.
- **`setDynamicDayNight(enabled)`** — applies the selected mode immediately, including
  while paused. The disabled branch restores every pre-implementation light, color,
  celestial position, torch intensity, and window emissive value explicitly.
- Keep cloud/flame work in `updateAtmosphere` and use indexed loops there and in the
  lighting driver, so cost stays O(torches + clouds) without per-frame callbacks.
- Include `THREE.Points` in scene disposal so the star geometry/material are released.

**No new geometry, colors, vectors, arrays, or materials per frame** — keyframe colors
are precomputed once and every update mutates existing objects.

## 6. UI / settings

- Optional HUD tint: none required. The sky, fog, and torches carry the mood.
- **Settings toggle** (mirrors the existing `theme` / `musicMuted` pattern persisted in
  `localStorage` under `korovany-dynamic-day-night`): `Динамическое время суток`
  on/off, available on the main menu and pause modal. It defaults on and updates the
  active engine immediately. When off, use the explicit legacy branch described in §5;
  merely forcing `dayPhase = 0.25` would move the light/disc and would not reproduce the
  old scene exactly.
- No `GameView` / `SavedGame` shape change.

## 7. Tuning constants

```text
DAY_LENGTH=240              DAY_START_OFFSET=0.18
SUN_ARC_RADIUS=90           SUN_ARC_HEIGHT=70      SUN_ARC_DEPTH=40
CELESTIAL_DISC_DISTANCE=150 MIN_SHADOW_LIGHT_HEIGHT=8
SUN_INTENSITY=[0.15, 2.65]  HEMI_INTENSITY=[0.45, 1.65]
TORCH_INTENSITY=[1.4, 2.6]  FOG_NIGHT_SCALE=0.35   STAR_COUNT=180
TWILIGHT_BLEND=[-0.18, 0.08] DAY_BLEND=[0.08, 0.60]
```

## 8. Edge cases

- **Save/load:** time of day is derived from `elapsed`; old v1 saves map
  deterministically onto the cycle with zero migration.
- **Theme switch mid-run:** `this.palette` is captured at construction; a live theme
  change already requires a re-init in the current game, so no extra handling is needed.
- **Performance:** the driver only mutates existing materials/lights and precomputes all
  keyframe colors — no allocations in the loop.
- **Readability at night:** the night keyframe floors directional and hemisphere
  intensity and keeps a moonlit blue-grey palette so the world never goes fully black.
- **Shadows at low sun:** near the horizon shadows stretch; clamp the directional
  light's Y position to 8 while leaving the visible sun on its true arc.

## 9. Acceptance criteria

- [x] Sun/moon arc across the sky over `DAY_LENGTH`; sky, fog, ambient, and sun color
      shift smoothly through dawn → noon → dusk → night.
- [x] Torch point lights, flame emissives, and building windows strengthen at night and
      fade by day.
- [x] Night remains legible (moonlit floor, clamped minimums); no fully black frames.
- [x] Time of day reconstructs from `elapsed` on load; no `SavedGame` version bump.
- [x] Settings toggle disables the cycle and restores the baseline day look.
- [x] The per-frame driver allocates no render objects or callbacks; TypeScript build
      and oxlint pass.

## 10. Implementation scope

The implementation is confined to `GameEngine.ts`, `App.tsx`, and `App.css`. It adds no
dependencies, assets, backend work, save migration, or gameplay-rule changes.
