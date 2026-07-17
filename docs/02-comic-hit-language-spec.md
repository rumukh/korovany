# 02 - Comic Hit Language

> Implementation-ready combat-presentation spec for КОРОВАНЫ. It adds original
> comic-book typography, trails, and impact timing without introducing a DOM update for
> every hit or pretending the current combat model has parries and critical-hit rules.

## 1. Goal

Make every successful player attack communicate four things immediately:

1. where contact occurred;
2. how much damage landed;
3. whether the hit was ordinary, heavy, blocked, or lethal;
4. which attack produced it.

The presentation should be exuberant but legible: chunky damage numbers, occasional
Russian onomatopoeia, a short weapon arc, impact rays, and tightly bounded hit stop.

## 2. Scope and non-goals

### In scope

- Engine-owned pooled world-space damage numbers.
- Cached fixed-text comic callouts such as `БАЦ!`, `ХРЯСЬ!`, `БУМ!`, and `БЛОК!`.
- Pooled impact-ray sprites and one player weapon-trail visual.
- Local-player hit stop with per-attack limits.
- A typed result/event emitted by the centralized damage routes.
- Reduced-motion behavior and combat-clutter budgets.

### Out of scope

- A new gameplay critical-hit chance or damage multiplier.
- Weapon-vs-weapon sparks or parry text; no clash event exists.
- React-rendered text for each impact.
- Floating numbers for passive bleeding ticks.
- Physics-based slash ribbons or motion-vector post-processing.
- Localization infrastructure beyond keeping visible strings in one typed table.

## 3. Verified baseline

| System | Current behavior |
| --- | --- |
| Actor damage | `damageActor()` applies brute frontal mitigation, blood, HP, health bar, particles, detach chance, immediate knockback, and death routing, but returns no result. |
| Player damage | `damagePlayer()` computes guard/shield mitigation, blood or sparks, HP, injury, trauma, flash, sound, and a forced view emission. |
| Attack kinds | Player melee, villain cleave, player arrow, actor melee, actor arrow, and AI-vs-AI damage all eventually use the centralized damage routes. |
| Critical hits | No crit stat, roll, or multiplier exists. Random melee damage is not exposed as a critical-hit event. |
| Animation | `attackAnimation` drives the player's right arm and weapon. NPC attacks currently resolve immediately with no attack animation. |
| Loop | `loop()` clamps delta to `0.05`, updates simulation only when active, then always updates camera and renders. |
| UI cadence | `emitView(false)` is throttled to roughly 90 ms, making React unsuitable for crisp per-hit text. |
| Sprite precedent | Actor health bars and signs already use generated canvas textures and `THREE.Sprite`. |
| Combat FX | Sparks are capped at 48, gore at 180, decals at 72; ordinary faction hit particles still allocate per impact. |

## 4. Design corrections

- **Do not call a high random damage roll a gameplay critical hit.** There is no crit
  system. Use presentation weights (`normal`, `heavy`, `lethal`, `blocked`) derived from
  the actual attack kind and post-mitigation result.
- **Do not put damage-number state in `GameView`.** A cleave can hit several actors inside
  one 90 ms UI throttle window. World sprites are the correct high-frequency surface.
- **Do not freeze the `AudioContext` for hit stop.** Pause only gameplay simulation; audio
  transients and rendering continue.
- **Do not apply hit stop for every AI-vs-AI hit.** Only direct local-player impacts may
  freeze the local simulation.
- **Do not add stop time once per cleave target.** A multi-target cleave gets one bounded
  stop using the heaviest result.
- **Do not allocate a new canvas/texture for every number.** Pool a fixed set of canvases,
  textures, materials, and sprites and redraw only when an entry is acquired.
- **Do not show text through the whole map.** Local-player feedback is limited by distance,
  lifetime, and pool priority.

## 5. Combat result contract

Replace the implicit `void` actor-damage outcome with:

```ts
type AttackKind = 'melee' | 'cleave' | 'arrow' | 'allyMelee' | 'actorArrow'
type HitWeight = 'normal' | 'heavy' | 'lethal' | 'blocked'

interface DamageResult {
  applied: boolean
  dealt: number
  killed: boolean
  weight: HitWeight
  position: THREE.Vector3
  direction: THREE.Vector3
}

interface CombatFeedbackEvent extends DamageResult {
  attackKind: AttackKind
  targetId: string | 'player'
  directPlayerAction: boolean
}
```

Extend the existing `damageActor` options with `attackKind`; do not add another positional
argument. Compute `dealt` after brute mitigation, compute `killed` from final HP, and
return a non-applied result when the target is already dead.

Weight rules:

| Condition | Weight |
| --- | --- |
| Shield block | `blocked` |
| Target killed | `lethal` |
| Cleave, or dealt damage >= 22% of target max HP | `heavy` |
| Otherwise | `normal` |

This classification changes presentation only. It must not increase damage, detach
chance, rewards, or objective credit.

`presentCombatFeedback(event)` is the one fan-out point for number sprites, callouts,
impact rays, audio requests from spec 06, and camera accents from spec 07. It is an
internal method, not a general event bus.

## 6. Pooled world-space typography

### 6.1 Damage-number pool

Create a lazily warmed pool:

```ts
interface DamageNumberFx {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  targetId: string | 'player'
  attackKind: AttackKind
  value: number
  weight: HitWeight
  age: number
  lifetime: number
  velocity: THREE.Vector3
  active: boolean
  priority: number
}
```

- Pool capacity: `DAMAGE_NUMBER_MAX = 24`.
- Canvas size: `256 x 128`; draw at device-independent texture size, not DPR.
- Sprite material: transparent, `depthTest:false`, `depthWrite:false`,
  `toneMapped:false`.
- Draw a dark offset/outline, then the colored number. Use the existing UI font stack;
  do not download a font.
- Spawn at target position plus role-scaled head height and a deterministic alternating
  horizontal offset.
- Float upward, drift away from the contact direction, scale up for 80 ms, hold, then
  shrink/fade.
- Reuse the lowest-priority oldest active entry only when the pool is full.
- Clear `targetId`, `attackKind`, accumulated `value`, and `weight` when an entry returns
  to the pool.

Priority order is `lethal > blocked > heavy > normal`. AI-vs-AI damage numbers are
disabled by default. Incoming player damage may show one red number above the player,
but passive bleeding does not.

### 6.2 Fixed callout pool

Callouts use cached textures rather than redrawing text:

```ts
type ComicCallout = 'БАЦ!' | 'ХРЯСЬ!' | 'БУМ!' | 'БЛОК!'
```

- Cache one `CanvasTexture` per word in `generatedTextures`.
- Pool ten sprites sharing those textures/material configurations.
- Use jagged procedural starburst backing shapes with both color and silhouette
  differences.
- Normal melee has a 22% callout chance; heavy hits 70%; lethal hits 100%; blocks 45%.
- Cleave chooses one callout at the attack centroid, not one per victim.
- Never spawn more than one callout in `CALLOUT_COOLDOWN = 0.12` seconds.

Random suppression affects only callout selection. Damage numbers always appear when an
eligible direct-player result can acquire a pool entry.

### 6.3 Coalescing repeated hits

If the same target receives another eligible hit inside `NUMBER_MERGE_WINDOW = 0.09`
seconds, merge only when the attack kind is the same:

- add damage to the existing displayed value;
- restart at no more than 70% of full lifetime;
- upgrade weight/priority but never downgrade it.

Cleave targets remain separate because they have distinct positions. Projectile and
melee impacts do not merge.

## 7. Impact rays and weapon trail

### 7.1 Impact rays

Create one cached transparent radial-line `CanvasTexture` and a pool of 16 sprites.

- Spawn at the contact point, oriented as a sprite.
- Rotate randomly, expand from `0.4` to `1.8` world units, and fade in 180 ms.
- Tint by weight: off-white normal, warning heavy, danger lethal, link/accent blocked.
- At capacity, lethal/heavy effects may recycle the oldest normal effect.
- Rays do not cast shadows and remain below number/callout render order.

### 7.2 Player weapon trail

Attach one reusable trail mesh to the player's weapon pivot:

- `RingGeometry` arc or a small custom crescent geometry;
- transparent `MeshBasicMaterial`, `DoubleSide`, `depthWrite:false`,
  `toneMapped:false`;
- hidden except during the active segment of melee/cleave animation;
- opacity and scale sampled from `attackAnimation`;
- faction-tinted edge with a pale center;
- villain cleave uses a larger arc, but still one mesh.

Do not sample historical blade positions or allocate trail segments in milestone one.
The current attack animation is stylized enough for an authored arc.

## 8. Hit stop

Add:

```ts
private hitStopRemaining = 0
private pendingCleaveHitStop = 0
```

`requestHitStop(seconds)` takes the maximum of current and requested duration; it never
adds durations. In `loop()`:

1. read and clamp raw delta;
2. consume up to raw delta from `hitStopRemaining`;
3. pass only the remainder to gameplay `update()`;
4. always update camera and render;
5. age hit text only with gameplay time, so the contact frame remains visually frozen.

Durations:

| Event | Stop |
| --- | --- |
| Normal direct-player melee/arrow | 28 ms |
| Heavy direct-player hit | 48 ms |
| Lethal direct-player hit | 64 ms |
| Cleave with one or more hits | 58 ms once |
| Shield block on player | 24 ms |
| AI-vs-AI or miss | 0 ms |

For cleave, collect all `DamageResult`s, present each number, then request one stop using
the highest weight. A missed attack produces a trail but no stop, number, callout, or
impact ray.

When the existing screen-shake preference is disabled or reduced motion is preferred,
cap all stops at 20 ms. A later dedicated `combatMotion` setting may split these controls,
but another toggle is not required for milestone one.

## 9. Update and lifecycle rules

- Add `updateComicHitFx(delta)` inside active simulation update after particles.
- Pausing, ending, returning to menu, or losing focus sets `hitStopRemaining = 0` and
  hides every active number, callout, ray, and trail.
- World FX do not age while paused.
- Acquiring a pooled number clears the old canvas before drawing and resets texture,
  opacity, scale, rotation, velocity, priority, and timers.
- Pool objects stay in the scene until engine teardown.
- Canvas textures are disposed once; shared fixed callout/ray textures use
  `generatedTextures`.
- Never call `setTimeout` for effect expiry.

## 10. File-level changes

| File | Changes |
| --- | --- |
| `src/game/GameEngine.ts` | `DamageResult`, `CombatFeedbackEvent`, attack-kind options, damage return values, feedback fan-out, hit-stop loop handling, pools, weapon trail, updates, and clearing. |
| `src/game/types.ts` | No `GameView` or `SavedGame` change for milestone one. Export `AttackKind` only if audio or tests require a shared type. |
| `src/App.tsx` | No per-hit React state. Existing screen-shake/reduced-motion initialization remains authoritative. |
| `src/App.css` | No combat-number DOM styles. Optional settings help text only. |

If the implementation makes `GameEngine.ts` materially harder to navigate, extract
`ComicHitFx.ts` after behavior is working. Do not create a generic effects framework in
advance.

## 11. Tuning constants and budgets

```text
DAMAGE_NUMBER_MAX=24        DAMAGE_NUMBER_LIFE=0.72
DAMAGE_NUMBER_DISTANCE=30   NUMBER_MERGE_WINDOW=0.09
CALLOUT_MAX=10              CALLOUT_LIFE=0.46
CALLOUT_COOLDOWN=0.12       IMPACT_RAY_MAX=16
IMPACT_RAY_LIFE=0.18

HIT_STOP_NORMAL=0.028       HIT_STOP_HEAVY=0.048
HIT_STOP_LETHAL=0.064       HIT_STOP_CLEAVE=0.058
HIT_STOP_BLOCK=0.024        HIT_STOP_REDUCED_MAX=0.020
```

The combined text/ray system may have at most 50 visible sprites. No more than one trail
mesh exists. After pool warm-up, a 25-actor fight must create no new sprite, canvas,
texture, material, or trail geometry.

## 12. Accessibility and readability

- Weight is encoded by size, backing silhouette, word, and color; not color alone.
- Text uses a thick dark outline and must remain legible over snow-bright palace stone,
  dark forest, red gore, and night sky.
- Reduced motion caps hit stop, removes lateral number drift, and uses scale/fade only.
- Numbers display rounded post-mitigation damage, never pre-mitigation base damage.
- Do not cover the crosshair: project a candidate position and bias it away from the
  central 8% of the viewport when practical.
- Callouts are decorative. Missing one due to pool pressure cannot hide required damage
  or block information.

## 13. Edge cases

- A target killed by the same hit still produces one result; do not emit a normal event
  and a second death event.
- A brute's frontal mitigation must be reflected in the shown number and weight.
- A shield block uses `БЛОК!`, block color, chip damage, and no blood callout.
- Damage that rounds below one displays `1` only if positive; zero damage displays
  `БЛОК` rather than a fake number.
- If a target dies during cleave iteration, later logic must not acquire a second effect
  for that actor.
- When the tab resumes after a long suspension, the existing delta clamp applies and hit
  stop cannot exceed its requested wall-clock duration.
- If the source or target is removed before an FX update, sprites continue from copied
  positions and retain no object reference.

## 14. Acceptance criteria

- [ ] Direct player hits show post-mitigation damage at the correct target and use normal,
      heavy, lethal, or block presentation without changing combat damage.
- [ ] A kill produces one lethal result, one number, and at most one callout for that
      target.
- [ ] A multi-target cleave shows per-target numbers but applies one bounded hit stop and
      at most one callout.
- [ ] Misses and AI-vs-AI impacts do not freeze the local game or fabricate callouts.
- [ ] Hit-stop duration is stable at 30/60/120 fps; camera rendering and audio continue.
- [ ] Damage-number, callout, and ray pools respect 24/10/16 caps and stop allocating
      after warm-up.
- [ ] Weapon trail follows the player weapon pivot, hides on pause/end, and does not
      remain visible after interrupted input.
- [ ] Reduced-motion behavior caps stop time and removes drifting text.
- [ ] No per-hit React state/update is introduced; `SavedGame` remains version 1.
- [ ] Production build, oxlint, direct-hit/cleave/block/kill browser checks, and a
      25-actor clutter stress check pass.

## 15. Dependencies and effort

- Spec 04 may later provide richer windup/contact events, but this spec can ship using the
  current player attack routes.
- Specs 06 and 07 consume `CombatFeedbackEvent`; this spec owns that contract.

**2-2.5 days.** The visuals are straightforward. Correct centralized result plumbing,
single-stop cleave behavior, pooling, reduced-motion semantics, and edge-case testing are
the substantial work.
