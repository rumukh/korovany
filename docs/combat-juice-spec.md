# Combat Juice: Camera Shake, Damage Vignette, Sparks, Decals & Cartoon Gore

> Implementation-ready design spec for КОРОВАНЫ. Fully client-side, with no backend,
> new art assets, or gameplay balance changes. Verified against the current
> `GameEngine.ts`, `types.ts`, `App.tsx`, and `App.css`.

## 1. Goal

Make combat feel more readable and absurdly impactful with five bounded feedback layers:

1. short camera impulses on meaningful local impacts;
2. a red damage flash and low-health edge treatment;
3. bright sparks on supported metal/impact events;
4. recycled blood and scorch decals on the flat world ground.
5. deliberately excessive, low-poly blood sprays, chunks, splats, and visual-only
   dismemberment.

The presentation is arcade-cartoon gore, not realism. Effects must remain optional where
camera motion is involved, must not create unbounded GPU objects, and must not invent
combat events that the game does not have.

## 2. Verified baseline

| System | Current behavior |
| --- | --- |
| Player damage | `damagePlayer(baseDamage, incomingDirection, canInjure)` computes post-armor/post-shield `dealt`, subtracts health, creates faction hit particles, and plays `block` or `hurt`. It returns no result and does not force a view emission. |
| Actor damage/death | `damageActor(...)` applies brute mitigation, particles, detach, knockback, and routes death through `killActor(...)`. |
| Cleave | `cleave()` directly iterates eligible actors. There is no separate cleave-impact event and no hit count. |
| Weapon contact | Attacks resolve directly against actors. There is no parry, weapon collider, or weapon-vs-weapon clash event. |
| Particles | `Particle.mode` is currently only `'smoke'`; every particle owns and disposes its geometry/material. |
| Bleed FX | `Math.floor(elapsed * 2) % 10 === 0` remains true for many consecutive frames, so the current condition can emit a burst every frame during each matching window. |
| Camera | `updateCamera()` lerps `camera.position` toward a collision-resolved position, calls `lookAt`, and runs every render frame, including while paused. |
| View/UI | `emitView(false)` is throttled to once per 90 ms. `GameView` is required data constructed both by `emitView()` and `createInitialView()`. |
| Settings | `App.tsx` owns persisted music, day/night, and bloom settings and applies live changes through engine setters. |
| Textures/teardown | Generated canvas textures already live in `generatedTextures`; `destroy()` traverses the scene for geometry/material disposal and disposes cached textures separately. |

## 3. Corrections to the original proposal

- **Do not add random offsets directly to `camera.position`.** The next frame's lerp
  would start from the shaken position, feeding noise into camera follow and causing
  drift. Keep an unshaken follow position and derive the rendered pose from it.
- **Do not use frame-by-frame `Math.random()` for shake.** White noise reads as camera
  buzz. Sample smooth deterministic noise or mixed sine waves from a shake clock.
- **Do not claim weapon-clash sparks.** No clash event exists. Ship sparks on shield
  blocks and cleave hits; add weapon clashes only with a future parry/contact system.
- **Use a real decal pool.** Removing and disposing the oldest decal at the cap is a
  bounded collection, not pooling. Expired entries should become hidden and be reused.
- **Do not freeze transient screen feedback on pause.** Because the camera still updates
  while paused, frozen trauma would shake forever. Clear shake and damage flash when
  pausing or ending; world decals may freeze with gameplay.

## 4. Feature design

### 4.1 Camera shake: stable trauma model

Add a separate smoothed camera position plus transient trauma:

```ts
private readonly cameraFollowPosition = new THREE.Vector3()
private trauma = 0                  // 0..1
private shakeClock = 0
private screenShakeEnabled: boolean
```

`addTrauma(amount)` clamps accumulated trauma to `1` and is a no-op when shake is
disabled, paused, or ended. `setScreenShakeEnabled(false)` also clears existing trauma.
During active gameplay, advance `shakeClock` and decay trauma by
`SHAKE_DECAY * delta`.

`updateCamera(immediate)` must:

1. compute the normal collision-resolved camera destination;
2. copy/lerp that destination into `cameraFollowPosition`, never the shaken pose;
3. sample smooth signed X/Y/roll noise from `shakeClock`;
4. scale it by `trauma²`;
5. add position noise in camera-right/world-up space;
6. pass the shaken candidate through `resolveCameraPosition(target, candidate)` again;
7. copy the safe result to `camera.position`, call `lookAt(target)`, then apply roll;
8. pass the final safe position to foliage occlusion.

The second collision resolve is required. "Keep the offset small" alone cannot support
the no-camera-clipping acceptance criterion.

#### Trauma triggers

All incoming-hit intensity uses post-mitigation `dealt`, not `baseDamage`.

| Event | Trauma |
| --- | --- |
| Normal player damage | Lerp `0.12..0.35` from `clamp(dealt / 20, 0, 1)` |
| Frontal shield block | `0.08`; do not also apply normal-hit trauma |
| Cleave that hits at least one actor | `0.42` once per activation, not once per target |
| Nearby direct player kill | Up to `0.08`, linearly fading to zero at 12 units |
| AI-vs-AI kill or cleave miss | None |

Track `didHit` in `cleave()` so a miss produces no impact feedback. A kill accent may
accumulate with the hit that caused it, but the global trauma clamp prevents runaway
shake.

### 4.2 Damage flash and low-health vignette

Add required `GameView.damageFlash: number` in the `0..1` range.

- In `damagePlayer`, set `damageFlash = max(current, newIntensity)` so a weaker
  overlapping hit cannot dim a stronger flash.
- Scale `newIntensity` from post-mitigation `dealt`. Cap shield-block chip feedback at
  `0.12`; normal hits lerp from `0.25..0.85`.
- Force one `emitView(true)` after damage/injury state is final so the flash is not
  delayed by the 90 ms throttle. Subsequent decay may use normal throttled emissions.
- Decay with `FLASH_DECAY * delta`.
- `createInitialView()` sets `damageFlash: 0`.

Render a `damage-vignette` after the existing `screen-vignette` and before HUD/modal
content. Its inline opacity is `view.damageFlash`; CSS adds a short linear opacity
transition to smooth the 90 ms React update cadence. Give the world, vignette, HUD, and
modal layers explicit z-indices so the tint sits above WebGL but below readable UI.

Low health is based on a ratio, not the current hard-coded max:

```ts
const lowHealth = view.health > 0 && view.health / view.maxHealth <= 0.25
```

Apply a `low-health` class to `game-screen` and render a separate edge-only pulse. Under
`prefers-reduced-motion: reduce`, disable the pulse animation and show a fixed,
lower-opacity edge tint.

### 4.3 Spark bursts

Extend the existing particle variant:

```ts
interface Particle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  eventId?: string
  mode?: 'smoke' | 'spark'
}
```

`createSparks(position, incomingDirection, count)` creates tiny warning/white
`MeshBasicMaterial` octahedra with high lateral/upward velocity and `SPARK_LIFE`.
`updateParticles()` gives sparks stronger gravity, fast spin, and normalized shrink
using `life / SPARK_LIFE`.

Supported triggers:

- frontal player shield block, including blocked actor projectiles;
- each cleave target actually hit, subject to the global active-spark budget.

Ordinary hits retain the existing faction-colored burst. Do not add a
weapon-vs-weapon trigger until a real parry/contact event exists. Limit active sparks
to `SPARK_MAX_ACTIVE`; `createSparks` only fills available slots. Bright basic colors
remain readable without bloom and cross the bloom threshold when bloom is enabled.

### 4.4 Recycled ground decals

Use a lazily grown, fixed-cap pool:

```ts
type DecalKind = 'blood' | 'scorch'

interface Decal {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  age: number
  lifetime: number
  serial: number
  active: boolean
}
```

- Add `createDecalTexture(key, kind)` and cache both transparent `CanvasTexture`s in
  the existing `generatedTextures` map. Use deterministic irregular alpha shapes from
  `seededRandom`; do not add separate texture fields or per-decal textures.
- `spawnDecal(position, kind, scale)` reuses an inactive entry, allocates while the
  pool is below `DECAL_MAX`, or immediately recycles the oldest active entry. The array
  and active count never exceed `DECAL_MAX`.
- Each mesh is a flat `PlaneGeometry`, rotated onto XZ, randomly rotated/scaled,
  positioned at absolute `DECAL_Y`, with `transparent:true`, `depthWrite:false`,
  `polygonOffset:true`, and no shadows.
- `updateDecals(delta)` fades during the final `DECAL_FADE` seconds. At expiry, set
  `visible=false` and `active=false`; do not remove or dispose it.
- Pool meshes stay in the scene until engine teardown. The existing scene traversal
  disposes their geometry/material once, and `generatedTextures` disposes the two
  shared textures once. Do not add a second decal-disposal pass.

Triggers:

- `killActor()` spawns one blood decal using the actor's X/Z before the corpse Y
  adjustment. AI kills may leave decals but never add camera trauma.
- Replace the current frame-window bleed emission with a `bleedFxCooldown`. While
  bleeding, emit at most one bleed particle and one small blood decal every
  `BLEED_FX_INTERVAL`; health drain remains unchanged.
- `startDefendHomeEvent()` spawns one scorch decal under the house fire. Static torches
  do not continuously create scorch marks.

The current world navigation surface is flat, so absolute `DECAL_Y` is sufficient for
this scope. Decals on bridges, roofs, slopes, or arbitrary props require a later
downward surface raycast and are explicitly out of scope.

### 4.5 Cartoon gore amplification

Every unblocked character hit emits a directional blood burst in addition to the
existing faction-colored impact burst. The system is intentionally excessive but uses a
hard active budget and an inactive mesh pool:

- ordinary actor hits emit `14..30` low-poly droplets based on post-mitigation damage;
- player hits emit `18..36` droplets so incoming damage reads clearly in third person;
- normal deaths emit 52 particles and six chunks; large bodies emit 72 particles and ten
  chunks;
- every death creates one oversized central pool plus five to eight satellite splats;
- one third of airborne droplets and every chunk create a recycled ground splat when
  they land;
- normal melee gains a high visual detach chance, cleave gains a higher one, and deaths
  throw two or three remaining limbs. Detachment remains cosmetic and does not alter AI
  damage, speed, targeting, or objectives;
- player limb loss emits its own blood/chunk burst without changing the existing injury
  probability or bleed balance.

`GORE_MAX_ACTIVE` caps blood and chunk meshes at 180. Expired or landed gore meshes stay
in the scene hidden in `inactiveGoreParticles` and are reused; they are not disposed per
burst. The existing scene teardown owns final disposal. The separate decal pool grows to
72 entries and immediately recycles the oldest active splat at capacity.

The damage overlay also includes large edge blotches and stylized drips. It remains below
HUD and modal content, uses the existing `damageFlash` value, and introduces no separate
state or save data.

## 5. Settings and accessibility

Persist `Тряска экрана` under `korovany-screen-shake`.

- A stored value wins; otherwise default to off when
  `matchMedia('(prefers-reduced-motion: reduce)').matches`.
- Mirror the existing bloom setting: App state + ref, menu and pause toggles, persisted
  write with warning on failure, constructor initialization, and live
  `setScreenShakeEnabled(enabled)`.
- Do not append another positional boolean to the already boolean-heavy constructor.
  Replace the trailing music/day-night/bloom booleans with a settings object:

  ```ts
  interface GameEngineSettings {
    musicMuted: boolean
    dynamicDayNight: boolean
    bloomEnabled: boolean
    screenShakeEnabled: boolean
  }
  ```

  Preserve the current defaults when a setting is omitted.
- The toggle affects camera shake only. Damage flash, static reduced-motion low-health
  tint, sparks, and decals remain enabled.

## 6. Lifecycle rules

- `setPaused(true)` and `endGame()` clear `trauma` and `damageFlash`, then force a view
  emission if needed. Resuming cannot reveal a stale red frame or restart old shake.
- Decal ages and particle life remain inside active `update()`, so world FX freeze while
  paused consistently with actors and projectiles. Landed gore returns to its inactive
  pool; it is not removed from the scene or disposed during play.
- `destroy()` relies on scene traversal for pooled decal mesh resources and on
  `generatedTextures` for shared decal textures. No resource is disposed twice by new
  code.
- All combat-feedback fields are runtime-only. `SavedGame` remains version 1 and old
  saves load unchanged.

## 7. File-level changes

| File | Changes |
| --- | --- |
| `src/game/types.ts` | Add required `GameView.damageFlash`. No `SavedGame` change. |
| `src/game/GameEngine.ts` | Stable camera-follow state, trauma/noise, impact triggers, flash decay, spark variant/budget, pooled blood/chunk bursts, exaggerated cosmetic dismemberment, bleed FX cooldown, larger decal pool/update, settings object/setter, lifecycle clearing, and view field. |
| `src/App.tsx` | Initial view field; screen-shake persistence/state/ref/toggles; settings object construction; low-health class; damage and low-health overlay elements. |
| `src/App.css` | Explicit overlay stacking, arcade blood-splatter damage treatment, low-health pulse, and reduced-motion static fallback. |

## 8. Tuning constants

```text
SHAKE_POS=0.22          SHAKE_ROLL=0.012       SHAKE_DECAY=2.1
SHAKE_FREQUENCY=24      TRAUMA_CLEAVE=0.42     TRAUMA_BLOCK=0.08
TRAUMA_DEATH_MAX=0.16   TRAUMA_DEATH_RANGE=12

FLASH_MIN=0.25          FLASH_MAX=0.85          FLASH_BLOCK_MAX=0.12
FLASH_DECAY=2.4         LOW_HEALTH_RATIO=0.25

SPARK_COUNT_BLOCK=7     SPARK_COUNT_CLEAVE=5    SPARK_LIFE=0.24
SPARK_MAX_ACTIVE=48

GORE_HIT=14..30         GORE_PLAYER_HIT=18..36  GORE_DEATH=52/72
GORE_MAX_ACTIVE=180     GORE_GROUND_Y=0.08

DECAL_MAX=72            DECAL_Y=0.025           DECAL_FADE=6
BLOOD_DECAL_LIFE=34     SCORCH_DECAL_LIFE=28   BLEED_FX_INTERVAL=1.25
```

Tune constants together in a 25-actor stress fight. Do not increase counts without
rechecking the active budgets.

## 9. Acceptance criteria

- [ ] Camera shake uses an unshaken follow position, smooth time-based noise, and
      `trauma²`; repeated hits do not drift the camera.
- [ ] The shaken candidate is collision-resolved, settles in a comparable duration at
      30/60/120 fps, and does not cross tested walls or large props.
- [ ] Normal damage and shield chip damage use post-mitigation intensity; the red flash
      appears on the hit emission and decays smoothly despite the 90 ms view throttle.
- [ ] Health at or below 25% shows an edge treatment; reduced-motion mode uses no pulse.
- [ ] Shield blocks and successful cleaves emit bounded sparks. Cleave misses and
      nonexistent weapon clashes do not emit impact feedback.
- [ ] Blood/scorch decals fade and recycle; both pool size and active count stay at or
      below 72, with no geometry/material/texture allocation after pool warm-up.
- [ ] Blood/chunk meshes stay at or below 180 active entries, return to an inactive pool
      after landing/expiry, and stop allocating after the pool reaches its observed peak.
- [ ] Unblocked hits, deaths, limb loss, and bleeding produce visibly exaggerated blood;
      shield blocks remain spark-only and gore does not alter combat balance.
- [ ] Bleed FX emit no more than once per `BLEED_FX_INTERVAL`.
- [ ] Pausing or ending clears transient shake/flash; resuming shows no stale feedback.
- [ ] The screen-shake setting persists, defaults off for reduced-motion users, applies
      live, and does not disable non-camera feedback.
- [ ] `GameView` is type-safe in engine and initial UI paths; `SavedGame` stays version
      1; old saves load; TypeScript build and oxlint pass.
- [ ] With 25 actors, bloom enabled, 48 active sparks, 180 active gore particles, and 72
      active decals, frame time shows no sustained regression beyond the agreed
      target-device budget.

## 10. Effort

**1.5-2 days.** Camera/flash work is small, but settings plumbing, stable camera state,
the corrected bleed cadence, a genuine recycled decal pool, and stress/lifecycle
verification make the original one-day estimate too optimistic.
