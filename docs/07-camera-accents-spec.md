# 07 - Bounded Camera Accents

> Implementation-ready camera-feel spec for КОРОВАНЫ. It builds on the existing stable
> trauma shake with restrained field-of-view envelopes and frame-rate-independent follow
> damping. All new motion obeys the existing screen-shake preference.

## 1. Goal

Use the camera to emphasize acceleration and major combat moments without turning normal
movement into constant zooming. The player should feel:

- a wider view while sprinting;
- a quick outward punch on cleave;
- a tiny release on jump and grounded compression on landing;
- a short inward emphasis on a nearby direct kill;
- no accumulated drift, stale pause effect, or motion when camera effects are disabled.

The camera remains third person with the current distance, pitch limits, collision ray,
and look target.

## 2. Scope and non-goals

### In scope

- Continuous sprint FOV blend.
- Small bounded one-shot FOV envelopes for cleave, jump, landing, block, and kill.
- Frame-rate-independent camera-follow damping.
- A typed camera-accent queue consumed by combat/movement events.
- Integration with current trauma shake and motion preference.
- Pause/end/focus lifecycle clearing.

### Out of scope

- Camera cuts, cinematic kill cams, slow-motion replay, depth of field, chromatic
  aberration, motion blur, or lens distortion.
- Dynamic shoulder switching or lock-on targeting.
- Changing mouse sensitivity with FOV.
- Moving the camera through collision to preserve an accent.
- Screen-space speed-line art; spec 02 owns impact-line language and a future overlay spec
  can own sustained speed lines.
- A second accessibility toggle in milestone one.

## 3. Verified baseline

| System | Current behavior |
| --- | --- |
| Camera | One `PerspectiveCamera(56, 1, 0.1, 240)`. |
| Follow | `updateCamera(immediate)` builds a target and desired position, resolves collision, then uses fixed `lerp(..., 0.12)` when not immediate. |
| Shake | Stable `cameraFollowPosition`, trauma-squared smooth sine noise, second collision resolve, and roll already exist. |
| Loop | Camera updates and renders even while gameplay is paused; active simulation owns trauma decay. |
| Setting | Persisted `screenShakeEnabled` defaults off for reduced-motion users and clears trauma when disabled. |
| Movement | `updatePlayer()` computes `sprinting` as a local boolean from shift, stamina, movement, shield, and leg state. |
| Jump | Vertical velocity/on-ground state exists, but landing has no explicit edge event. |
| Combat | Cleave and direct-player kills already have authoritative points that add trauma; block and damage also do. |
| Projection | Resize updates aspect/projection; ordinary camera update does not change FOV. |

## 4. Design corrections

- **Do not set FOV directly at event call sites.** Queue bounded envelopes and resolve one
  final target each frame.
- **Do not add FOV impulses cumulatively without a clamp.** Dense kills/cleaves otherwise
  create an extreme lens.
- **Do not gate only translation shake.** The existing camera-motion preference must also
  disable FOV accents and reset the base FOV immediately.
- **Do not use fixed per-frame lerp for new camera behavior.** The current `0.12` follow
  blend is frame-rate dependent; move it to delta-based damping while touching this path.
- **Do not age accents only in gameplay update.** Camera renders while hit stop is active.
  One-shot envelopes use visual/raw frame delta so their wall-clock duration remains
  stable, but pause/end clears them.
- **Do not combine a large kill zoom with hit stop and trauma.** Values are deliberately
  small and the final offset is clamped.
- **Do not modify camera distance to simulate zoom.** FOV changes preserve the
  collision-resolved camera position and avoid pushing through geometry.

## 5. Runtime model

```ts
type CameraAccentKind = 'cleave' | 'jump' | 'land' | 'block' | 'kill'

interface CameraAccent {
  kind: CameraAccentKind
  age: number
  duration: number
  magnitude: number
}
```

Add:

```ts
private readonly cameraAccents: CameraAccent[] = []
private sprintFovBlend = 0
private currentFov = CAMERA_BASE_FOV
private isSprinting = false
private wasOnGround = true
```

`queueCameraAccent(kind, magnitude?)`:

- no-ops when screen shake/camera effects are disabled, paused, or ended;
- replaces an active accent of the same kind when the new magnitude is larger;
- keeps at most `CAMERA_ACCENT_MAX = 4` one-shot entries;
- if full, replaces the lowest-magnitude oldest entry only when the new one is stronger.

No `THREE.Vector3` is stored in an FOV accent.

## 6. FOV composition

Final target:

```text
targetFov =
  CAMERA_BASE_FOV
  + SPRINT_FOV_BONUS * sprintFovBlend
  + clamp(sum(sampleAccent(entry)), FOV_ACCENT_MIN, FOV_ACCENT_MAX)
```

Then:

```ts
currentFov = THREE.MathUtils.damp(currentFov, targetFov, CAMERA_FOV_DAMPING, visualDelta)
```

Assign `camera.fov` and call `updateProjectionMatrix()` only when the new value differs by
at least `0.01`.

FOV is clamped globally to `52..65` degrees.

### 6.1 Continuous sprint

Promote the existing local sprint result to `this.isSprinting`. Damp `sprintFovBlend`
toward 1 while actually moving at sprint speed and toward 0 otherwise.

Do not trigger sprint FOV when:

- shift is held without movement;
- stamina is empty;
- shield is active;
- a leg state prevents sprint;
- game is paused/ended.

This reuses the authoritative gameplay sprint decision; camera code must not recompute it
from keys.

### 6.2 One-shot envelopes

Use simple normalized curves:

```ts
const pulse = Math.sin(Math.PI * t) // t 0..1
```

Kill uses negative magnitude (brief inward zoom). Others use signed magnitudes below.
Entries remove themselves when age reaches duration.

| Event | Magnitude | Duration | Notes |
| --- | ---: | ---: | --- |
| Cleave with at least one hit | `+5.5` | `0.24 s` | One event, not per target |
| Cleave miss | `+2.0` | `0.16 s` | Swing commitment only |
| Jump takeoff | `+1.0` | `0.18 s` | Very subtle |
| Landing after airborne >= 0.22 s | `-1.4` | `0.16 s` | Skip tiny curb/frame contacts |
| Shield block | `-0.8` | `0.12 s` | Complements block trauma |
| Nearby direct-player kill | `-2.4` max | `0.20 s` | Distance-fades to zero at 14 units |

Normal melee hits do not change FOV. Spec 02 hit stop and existing trauma already cover
them.

## 7. Camera update refactor

Change signature:

```ts
private updateCamera(delta: number, immediate: boolean): void
```

Loop:

1. read `rawDelta` from clock and clamp as today;
2. let spec 02 consume hit-stop simulation time if present;
3. if active, update gameplay with simulation delta;
4. update camera accents with `rawDelta` only when not paused/ended;
5. call `updateCamera(rawDelta, false)`;
6. render.

Inside `updateCamera`:

- replace `cameraFollowPosition.lerp(resolved, 0.12)` with component-wise
  `THREE.MathUtils.damp` or an equivalent exponential factor
  `1 - exp(-CAMERA_FOLLOW_DAMPING * delta)`;
- retain the unshaken follow position;
- compute the collision-resolved base pose;
- apply existing trauma offset/roll and second collision resolve;
- update FOV independently of position;
- preserve final foliage-occlusion update.

`immediate=true` copies position, clears sprint blend/accents as appropriate, sets base
FOV, and updates projection once. This path is used at engine construction/teleports.

The refactor should match the current perceived 60 fps follow rate. An equivalent damping
constant for `0.12` per 60 Hz frame is approximately `7.7`; tune by capture rather than
retaining a frame-dependent special case.

## 8. Event ownership

| Event source | Camera call |
| --- | --- |
| `updatePlayer()` | Set `isSprinting`; detect takeoff and qualifying landing. |
| `cleave()` | Queue one hit/miss accent after target iteration. |
| `damagePlayer()` shield branch | Queue one block accent. |
| `killActor()` | Queue distance-scaled kill accent only for direct player kill. |
| `setScreenShakeEnabled(false)` | Clear trauma, accents, sprint blend, and base FOV. |

Specs 02 and 07 should not both queue the same cleave/kill event. The recommended owner is
`presentCombatFeedback()` for hits and explicit `cleave()` aggregation for the one
multi-target accent.

## 9. Settings and reduced motion

Continue using `screenShakeEnabled` as the camera-motion preference:

- UI label may become `Эффекты камеры` with helper text including shake and zoom, while
  retaining the storage key for compatibility;
- existing stored values continue to work;
- reduced-motion default remains off;
- disabling live clears trauma and all FOV state, sets exactly `56`, and updates
  projection immediately;
- enabling does not replay suppressed accents.

Damage flash, static low-health treatment, damage numbers, toon shading, loot, and audio
remain enabled.

If user feedback later demands separate controls, migrate to a structured camera setting
in a dedicated accessibility change. Do not add two nearly identical booleans now.

## 10. Pause, focus, and end lifecycle

- `setPaused(true)`, `endGame()`, `onWindowBlur()`, and disabling camera effects clear
  one-shot accents and damp/reset sprint state.
- Pause displays base FOV immediately rather than freezing halfway through a zoom.
- Trauma and FOV reset happen before the paused/end frame renders.
- Tab suspension cannot resume with a stale large raw delta because clock delta remains
  clamped and transient state was cleared on visibility/focus loss.
- `destroy()` requires no camera-specific GPU disposal.

## 11. File-level changes

| File | Changes |
| --- | --- |
| `src/game/GameEngine.ts` | Accent state/queue/sampling, sprint promotion, landing detection, event triggers, delta-based follow damping, FOV composition/projection updates, and lifecycle clearing. |
| `src/App.tsx` | Optional wording/helper update for the existing screen-shake toggle; storage/state plumbing remains. |
| `src/game/types.ts` | No `GameView` or `SavedGame` change. |
| `src/App.css` | No required change beyond optional settings helper style. |

## 12. Tuning constants

```text
CAMERA_BASE_FOV=56
CAMERA_FOV_MIN=52
CAMERA_FOV_MAX=65
SPRINT_FOV_BONUS=4.5
SPRINT_BLEND_DAMPING=6.5
CAMERA_FOV_DAMPING=13
CAMERA_FOLLOW_DAMPING=7.7
CAMERA_ACCENT_MIN=-3.5
CAMERA_ACCENT_MAX=7
CAMERA_ACCENT_MAX_ENTRIES=4
LANDING_MIN_AIR_TIME=0.22
KILL_ACCENT_RANGE=14
```

Tune with bloom both on and off; bloom can make a fast FOV change appear larger because
bright edges expand.

## 13. Accessibility and comfort

- Existing reduced-motion default disables all new camera motion.
- Maximum FOV change is bounded and no effect oscillates continuously except smooth
  sprint blend.
- No camera roll is added beyond current trauma shake.
- FOV never encodes required gameplay information.
- Sprint FOV stops promptly when shield, stamina, injury, or input ends sprint.
- Test at narrow and wide viewport aspect ratios for peripheral distortion.
- UI/HUD remains screen-fixed and must not scale with WebGL camera FOV.

## 14. Edge cases

- Multiple kills in one cleave replace/merge same-kind kill accent and remain inside the
  negative clamp; they do not zoom once per corpse.
- Cleave's outward pulse and kill's inward pulse can overlap, but the summed clamp and
  one-shot curves keep FOV within `52..65`.
- A kill outside 14 units produces no camera accent even if objective credit is local.
- AI-vs-AI kills never queue accents.
- Jump input held across landing cannot create repeated takeoff accents; trigger on
  `onGround -> airborne` transition only.
- A frame that takes off and lands due to a large clamped delta must not queue both unless
  recorded airtime crossed the threshold.
- Resize projection updates and FOV projection updates can happen in the same frame
  safely; avoid duplicate work when neither value changed.
- Camera collision shortening the follow distance does not change FOV bounds or bypass
  motion settings.

## 15. Acceptance criteria

- [ ] Sprint smoothly approaches a wider FOV only during authoritative sprint and returns
      at a frame-rate-independent rate.
- [ ] Cleave, qualifying jump/landing, shield block, and nearby direct kill queue the
      specified bounded one-shot accents exactly once.
- [ ] Multi-target attacks and rapid kills never push FOV outside `52..65` or create
      unbounded queue entries.
- [ ] Disabling camera effects or reduced-motion default clears shake/FOV state and renders
      base FOV immediately; re-enabling replays nothing.
- [ ] Camera follow damping has comparable settling at 30/60/120 fps and preserves current
      collision/foliage behavior without drift.
- [ ] Pause, end, blur, visibility changes, and hit stop cannot leave a stale zoom or
      sprint blend.
- [ ] HUD remains fixed and readable at min/max FOV and common aspect ratios.
- [ ] No `GameView` or `SavedGame` schema change is introduced.
- [ ] Production build, oxlint, deterministic envelope tests, 30/60/120 fps capture,
      collision test, reduced-motion browser check, and rapid multi-kill stress pass.

## 16. Dependencies and effort

- Existing trauma shake is the foundation.
- Spec 02 supplies weighted direct-hit results/hit stop and must not duplicate accent
  triggers.
- Spec 04 supplies true contact timing for future enemy-driven camera responses, though
  this milestone does not add FOV for ordinary enemy attacks.

Recommended suite rollout:

1. spec 01: toon materials, selective outlines, and resource ownership;
2. spec 02: centralized damage result/feedback contract and pooled hit visuals;
3. spec 04: real enemy action phases and reactions consuming that contract;
4. spec 06: layered audio consuming combat/action events;
5. spec 07: camera accents consuming the same feedback without duplicate triggers;
6. spec 03: loot spectacle, optionally enhanced by outline/audio hooks but safe alone;
7. spec 05: zone art pass after material/resource conventions are stable.

The numbering preserves proposal order; rollout order follows technical dependencies.

**1.5-2 days.** Envelope math is small. Refactoring follow damping without changing
camera feel, coordinating hit-stop timing, and validating comfort/collision across frame
rates are the meaningful work.
