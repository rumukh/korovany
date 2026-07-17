# Weather System (Rain / Snow / Overcast)

> Design spec for КОРОВАНЫ. Fully client-side, with no backend or external art assets.
> Targets the current engine, where dynamic day/night and bloom are already implemented.
> Reuses `this.palette`, `zoneAt`, `updateAtmosphere`, the procedural-texture cache,
> Web Audio, and the four ground surfaces created by `createGround`.

## 1. Goal

Give each zone a distinct, player-local weather identity:

- `forest` -> rain
- `fort` -> snow
- `neutral` -> overcast
- `palace` -> clear

Weather transitions settle over roughly six seconds as the player crosses a zone boundary.
It changes precipitation, fog range, sky/cloud tint, light levels, wind, and the relevant
zone ground material. Rain can produce lightning followed by delayed thunder.

Weather is cosmetic only: it does not affect movement, combat, AI, objectives, saves, or
deterministic gameplay state.

## 2. Locked decisions

| Decision | Rationale |
| --- | --- |
| Ship **zone-driven weather only**. | The previous cycle-driver option left the implementation unresolved and contradicted the fixed zone identities. A global scheduler can be a later feature. |
| Treat weather as a **camera-local atmosphere**, not four simultaneous regional simulations. | Fog and sky are scene-global, while precipitation is camera-centered. The player experiences the weather of the zone they occupy. |
| Blend four profile weights instead of using one `intensity` scalar. | One scalar cannot represent an interrupted transition or a rain-to-snow cross-fade without a hard mode swap. |
| Render rain as `LineSegments` and snow as `Points`. | WebGL points have a square screen-space footprint and cannot produce true stretched streaks with `PointsMaterial`. Each effect should use the primitive that matches it. |
| Let `App.tsx` own `localStorage`. | This matches the existing day/night and bloom settings flow: React reads/persists the preference and passes it to `GameEngine`. |
| Apply weather **after** day/night every frame. | Weather must modify the current dawn/day/dusk/night result, never restore or blend toward fixed daytime colors. |

### Non-goals for v1

- A global or seeded weather schedule.
- Different weather visible simultaneously in distant zones.
- Roof/interior precipitation occlusion.
- A weather HUD field or save-game field.
- Weather-driven gameplay modifiers.

## 3. Current baseline

| System | Current location | Relevant behavior |
| --- | --- | --- |
| Zones | `zoneAt(x, z)` | Quadrant split into `neutral / palace / forest / fort`. |
| Zone tracking | `updateMission()`, `this.lastZone` | Updated after the atmosphere tick, so weather should resolve its own zone immediately after player movement rather than depend on `lastZone`. |
| Fog | constructor, `this.fog` | `THREE.Fog(worldFog, 48, 132)`; `updateDayNight()` already changes its color. |
| Sky/background | `createAtmosphere()`, `updateDayNight()` | `backgroundColor`, `skyMaterial`, sun, moon, and stars are already dynamic. |
| Lighting | `setupLights()`, `updateDayNight()` | `sun` and `hemisphere` are fields and are rewritten every frame. |
| Clouds | `createAtmosphere()` | Ten cloud groups share one local material; retain that material as a field for weather tint/opacity. |
| Ground | `createGround()` | Four textured `MeshStandardMaterial` planes are created but not retained; store them by `ZoneId`. |
| Atmosphere loop | `updateAtmosphere(delta)` | Moves clouds and pulses flames. Weather wind must be updated before this method so foliage can consume it later. |
| Bloom | `BloomPostProcessor` | Already renders every frame; precipitation must avoid bright additive blending that would bloom unnaturally. |
| Disposal | `destroy()` | Handles `Mesh`, `Sprite`, and `Points`, but not `LineSegments`; extend it for rain and the existing grid helper. |
| Settings | `App.tsx` | Day/night and bloom use a state + ref + constructor argument + live setter pattern. |

## 4. Weather model

```ts
type WeatherKind = 'clear' | 'overcast' | 'rain' | 'snow'

const ZONE_WEATHER: Record<ZoneId, WeatherKind> = {
  neutral: 'overcast',
  palace: 'clear',
  forest: 'rain',
  fort: 'snow',
}
```

Maintain normalized weights for all four profiles:

```ts
type WeatherWeights = Record<WeatherKind, number>

private readonly weatherWeights: WeatherWeights = {
  clear: 1,
  overcast: 0,
  rain: 0,
  snow: 0,
}
```

Each frame, move every weight toward a one-hot target with the same exponential response:

```ts
const response = 1 - Math.exp((-3 * delta) / WEATHER_BLEND)
weight += (targetWeight - weight) * response
```

Starting from normalized weights, this keeps the sum at 1 and reaches about 95% of the new
profile in `WEATHER_BLEND` seconds. It also handles a player reversing direction during a
transition without capturing a new source state or allocating objects.

Use a small boundary hysteresis for weather only: retain `weatherZone` while either
`abs(x) < WEATHER_ZONE_HYSTERESIS` or `abs(z) < WEATHER_ZONE_HYSTERESIS`. Once the player
moves beyond that strip, resolve with `zoneAt`. This prevents weather targets from
chattering around the quadrant axes; normal zone notices keep their existing behavior.

### Profiles

All colors are palette-derived and precomputed. Numeric values are starting points:

| Kind | Fog near/far | Sun scale | Hemisphere scale | Cloud opacity | Sky brightness | Wet | Frost | Wind |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `clear` | 48 / 132 | 1.00 | 1.00 | 0.58 | 1.00 | 0 | 0 | 0.20 |
| `overcast` | 40 / 112 | 0.78 | 0.90 | 0.78 | 0.90 | 0 | 0 | 0.35 |
| `rain` | 30 / 95 | 0.62 | 0.78 | 0.90 | 0.78 | 1 | 0 | 0.85 |
| `snow` | 34 / 105 | 0.82 | 0.96 | 0.82 | 0.94 | 0 | 1 | 0.45 |

Weighted profile values drive the global atmosphere. `rain` and `snow` weights separately
drive their renderers, so a forest-to-fort transition briefly looks like sleet rather than
turning every existing drop into a snowflake.

## 5. Precipitation

Create both reusable renderers once in `setupWeather()` and hide them when their weight is
below `PRECIP_VISIBLE_EPSILON`.

### 5.1 Rain

- One `THREE.LineSegments` object with `RAIN_COUNT` independent segments.
- Each segment is `RAIN_LENGTH` long and leans along `windDir * windStrength`.
- Use a transparent `LineBasicMaterial` with `NormalBlending`, `depthWrite:false`, and
  palette-derived blue-grey color. Do not use additive blending; rain should not trigger
  bloom.
- Opacity is `weatherWeights.rain`.

### 5.2 Snow

- One `THREE.Points` object with `SNOW_COUNT` points.
- Use a small procedurally generated soft-circle `CanvasTexture` with `PointsMaterial`;
  register the texture in `generatedTextures` so existing teardown disposes it.
- Give each point a stable seeded drift phase. Update it with slow fall, wind, and a
  sinusoidal XZ offset.
- Use `NormalBlending`, `transparent:true`, `depthWrite:false`, and a near-white
  palette-derived color below the bloom threshold.
- Opacity is `weatherWeights.snow`.

### 5.3 Camera-centered volume

Store particle positions in world space. Each frame:

1. Update only a renderer whose weight exceeds `PRECIP_VISIBLE_EPSILON`.
2. Move positions by fall speed and wind.
3. Wrap X/Z to the opposite side of a box centered on the camera.
4. Wrap Y from below world ground (`y < 0`) to `PRECIP_TOP`.
5. Mark the existing position attributes dirty.

The world ground is flat, so a height map is unnecessary. Set both objects
`frustumCulled = false`; the manually maintained volume is already bounded around the
camera. The loop mutates typed arrays and scratch vectors only: no per-frame arrays,
colors, vectors, callbacks, or render objects.

Steady rain or snow costs one draw call. A rain-to-snow transition costs two draw calls for
at most the blend window, which is preferable to an incorrect hard material swap.

## 6. Atmosphere and ground composition

`update()` keeps this order:

```text
updatePlayer
...
updateDayNight        // writes the base atmosphere for the current time
updateWeather         // overlays weather on that base
updateAtmosphere      // moves clouds/flames and later consumes weather wind
```

`updateWeather(delta)` must assume `updateDayNight()` has just restored the base values.
It then:

1. Updates `weatherZone`, target weights, `windDir`, and `windStrength`.
2. Multiplies the current sun/hemisphere intensities by the weighted weather scales.
3. Applies palette-relative desaturation and brightness to `backgroundColor`,
   `fog.color`, and `skyMaterial.color` using preallocated scratch colors.
4. Sets `fog.near/far` from the weighted profiles.
5. Tints the retained shared cloud material and sets its weighted opacity.
6. Updates rain/snow geometry and opacity.
7. Advances lightning and thunder timers.

Do not lerp weather toward absolute daytime colors: that would brighten storms at night.
Weather tint helpers operate relative to whatever `updateDayNight()` produced that frame.

### Ground surfaces

Retain each ground material with its exact baseline values:

```ts
interface GroundSurface {
  material: THREE.MeshStandardMaterial
  baseColor: THREE.Color
  baseRoughness: number
}

private readonly groundSurfaces = new Map<ZoneId, GroundSurface>()
```

Ground dressing is regional even though the live atmosphere is camera-local. This is
intentional: it keeps visible neighboring terrain coherent without pretending that fog and
sky can be spatially partitioned.

- Forest ground is darkened and moves toward roughness `0.58` while weather is enabled.
- Fort ground is lightly tinted toward `palette.surface` for frost; keep roughness high.
- Neutral and palace ground stay at their baseline material values.
- Disabling weather restores every cached color and roughness exactly.

Because the procedural texture supplies the zone detail, modify `material.color` as a
multiplier; do not regenerate or edit textures.

## 7. Lightning and thunder

Create one dedicated, normally dark `HemisphereLight` for lightning. Do not spike the
day/night lights directly; a separate light prevents ownership conflicts and makes reset
unambiguous.

- Lightning is eligible only while `weatherWeights.rain >= 0.7`.
- A dedicated `weatherRng` chooses the next interval in
  `[LIGHTNING_MIN, LIGHTNING_MAX]`; never reuse `eventRng`.
- Drive a short time-based flash envelope (`LIGHTNING_FLASH`), not a frame count.
- Queue thunder with an engine timer in `[THUNDER_DELAY_MIN, THUNDER_DELAY_MAX]`.
  Do not use `setTimeout`, which would outlive pause/destroy.
- If the player leaves the rain zone after a flash, already queued thunder still plays.
  Disabling weather or destroying the engine cancels the flash and queued thunder.

Add `'thunder'` to `playSound`, but give it a dedicated procedural-noise branch
(`AudioBufferSourceNode` -> low-pass filter -> gain envelope). The existing oscillator
frequency table is suitable for short cues, not thunder.

## 8. Engine changes (`GameEngine.ts`)

Representative fields:

```ts
private weatherEnabled: boolean
private weatherZone: ZoneId
private readonly weatherWeights: WeatherWeights
private rain!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
private snow!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
private cloudMaterial!: THREE.MeshBasicMaterial
private readonly groundSurfaces = new Map<ZoneId, GroundSurface>()
private readonly windDir = new THREE.Vector2(1, 0.2).normalize()
private windStrength = 0.2
private lightningLight!: THREE.HemisphereLight
private lightningCooldown = 0
private lightningFlash = 0
private thunderDelay = -1
```

- **Constructor**: accept `weatherEnabled = true` after the existing render settings.
  After `buildWorld()`, call `setupWeather()`, then apply day/night and weather once.
- **`createAtmosphere()`**: retain the shared cloud material as `this.cloudMaterial`.
- **`createGround()`**: retain each zone material and cloned baseline values.
- **`setupWeather()`**: build rain, snow, the snow texture, and the lightning light once.
- **`updateWeather(delta)`**: implement profile blending, composition, precipitation,
  wind, and lightning as described above.
- **`setDynamicDayNight(enabled)`**: after refreshing the day/night base, call the
  weather-application path with zero delta so the live overlay remains visible while
  paused and does not wait for the next frame.
- **`setWeatherEnabled(enabled)`**: apply immediately, including while paused. Enabling
  initializes weights to the current zone profile; disabling hides precipitation,
  cancels lightning/thunder, calls `updateDayNight()` to restore the current time-of-day
  base, restores cloud/fog ranges and all ground baselines, then calls
  `updateAtmosphere(0)` so future foliage uniforms can refresh.
- **`destroy()`**: extend scene disposal to `THREE.Line`/`THREE.LineSegments`, or dispose
  rain explicitly. Keep disposal single-owner to avoid double-disposing the same object.
- **`playSound()`**: add the procedural thunder branch.

## 9. UI and persistence (`App.tsx`, `App.css`)

Use the existing settings architecture:

- Add `WEATHER_ENABLED_KEY = 'korovany-weather'`.
- Add `readWeatherEnabled()` with the same guarded `localStorage` handling as day/night.
  Default to enabled.
- Add React state plus a ref, pass the current value to the `GameEngine` constructor, and
  call `engine.setWeatherEnabled(next)` from the toggle.
- Add `Погода` toggles to both `MenuScreen` and `PauseModal`, mirroring the existing
  day/night and bloom controls and ARIA state.
- Persist only the preference. Do not add weather to `SavedGame` or `GameView`.

## 10. Tuning constants

```text
WEATHER_BLEND=6
WEATHER_ZONE_HYSTERESIS=2
PRECIP_VISIBLE_EPSILON=0.01

RAIN_COUNT=1600
RAIN_SPEED=30
RAIN_LENGTH=0.9

SNOW_COUNT=1200
SNOW_SPEED=2.8
SNOW_DRIFT=0.7

PRECIP_HALF_EXTENT=22
PRECIP_TOP=26

GROUND_WET_ROUGHNESS=0.58
GROUND_WET_DARKEN=0.22
GROUND_FROST_TINT=0.24

LIGHTNING_MIN=8
LIGHTNING_MAX=22
LIGHTNING_FLASH=0.12
THUNDER_DELAY_MIN=0.3
THUNDER_DELAY_MAX=1.6
```

## 11. Edge cases

- **Rapid boundary reversals:** profile weights converge from their current values, so
  transitions remain continuous. Weather-only hysteresis prevents target chatter.
- **Day/night toggle while weather is active:** `setDynamicDayNight()` already reapplies
  day/night and calls `updateAtmosphere(0)`; it must also reapply the current weather
  overlay before rendering.
- **Weather toggle while paused:** the setter applies/restores all visible state
  synchronously; timers remain frozen.
- **Pause:** the normal update gate freezes precipitation, lightning, and thunder together
  with the game.
- **Bloom:** normal alpha blending and sub-threshold colors keep rain/snow from glowing.
- **Under cover:** precipitation can pass through roofs. This is accepted for v1 and
  documented as a local-atmosphere limitation.
- **Save/load:** weather is reconstructed from the loaded player position and the UI
  preference; no migration or RNG state is required.
- **Theme changes:** the engine palette remains construction-time state, matching the
  existing day/night behavior.
- **Foliage integration:** the foliage feature can read `windDir` and `windStrength`
  directly from the same engine; clear weather retains a gentle breeze.

## 12. Acceptance criteria

- [ ] Forest rain, fort snow, neutral overcast, and palace clear all match the player's
      current zone; a transition reaches roughly 95% in six seconds.
- [ ] Reversing across a boundary never snaps the atmosphere or converts existing rain
      segments into snow points; rain/snow may cross-fade as sleet.
- [ ] Steady precipitation costs one draw call, a rain-to-snow blend costs at most two,
      and the update loop allocates no per-frame objects.
- [ ] Fog range/color, sky, clouds, sun, and hemisphere lighting compose with the current
      day/night state and never reset the scene to fixed daytime values.
- [ ] Forest ground restores exactly from wetness and fort ground restores exactly from
      frost when weather is disabled; unrelated zone grounds are not globally recolored.
- [ ] Lightning uses a time-based flash and delayed procedural thunder; pause, disable,
      and destroy leave no orphaned timer or audio work.
- [ ] The menu and pause toggles persist and apply live, including while paused.
- [ ] Rain/snow do not bloom noticeably; precipitation and new line geometry are disposed
      on restart.
- [ ] TypeScript build and oxlint pass, and weather preserves the existing 60 fps target
      on the project's baseline machine at the DPR cap.

## 13. Effort

**About 1.5 days.** Correct rain/snow renderers, transition-safe profile composition, and
day/night/settings integration are the main work. Lightning/thunder and teardown are
small but should be implemented with the same state-machine discipline.
