# NG-11 - Combat mastery

**Status:** implemented and integrated locally; see [combined acceptance](NEXT-GEN.md#6-integrated-milestone).
**Parent contract:** [Next-generation milestone](NEXT-GEN.md).
**Baseline:** reconnaissance `0993fa6`; implementation `8cc1186a5538aa98e9d32fd8559d6fb2c1a0a462`.

## 1. Outcome

A player can deliberately evade a readable attack without abandoning the game's
one-button melee sequence. A skilled guard can turn a precisely timed shield raise
into an opening. Camera control remains usable when a browser cannot grant pointer
lock.

This is an intentional extension of the combat vocabulary, not a claim that the
existing combat is mathematically unfair. Preserve aimed arcs, authoritative contact
frames, whiffs, poise, the three-beat sequence, and the committed finisher.

## 2. Current behavior

`world\CombatResolver.ts` already owns melee timing, damage, armor, poise, stagger, and
reaction arithmetic. `GameEngine.attack`, `updatePlayerMelee`, `updatePlayer`,
`setShield`, and `damagePlayer` integrate them.

Sprint, jump, and abilities can cancel early melee beats. Only guards have a shield;
there is no evasive action or perfect-guard timing state. Shield holding drains stamina
continuously. Pointer-lock failure is currently swallowed, and camera movement depends
on `document.pointerLockElement`.

The reconnaissance exercised elf bow/melee, guard shield/melee, and villain cleave.
It also reproduced pointer-lock rejection in the embedded browser and working mouse
control in native Chromium.

## 3. Evasive step

Use `C` on keyboard and a clearly labelled touch action. Direction comes from current
camera-relative movement input; with no movement input, step backward from the aim
direction. Normalize diagonals.

Initial shipping targets:

| Parameter | Value |
| --- | --- |
| Stamina cost | 25, paid once when accepted |
| Action duration | 0.30 seconds |
| Healthy maximum travel | 4.2 world units |
| Evasion window | 0.06 through 0.18 seconds after acceptance |
| Cooldown | 0.85 seconds from acceptance |

Keep these as named constants. Changes require a recorded rationale and corresponding
acceptance updates, not undocumented tuning.

The step can cancel beats one and two through the existing cancel seam. It cannot
cancel the committed finisher, start while another step is active, start without the
required stamina, or bypass pause/end/input-focus guards. Holding or repeating `C`
does not queue a chain of steps.

Use the existing collision-aware movement path. Never teleport through a prop, a
river, an inactive region boundary, or an unwalkable slope. Colliding shortens travel;
it does not refund stamina or prolong the evasion window. Respect existing leg-loss
and prosthetic mobility penalties; two missing legs prevent the action.

Drop the guard shield on acceptance. Do not simultaneously attack, fire an ability,
or regenerate stamina as if standing idle during the step. Bleeding, environmental
consequences, and fall/terrain rules are not cancelled by evasion.

Eligible incoming combat contact during the window produces an explicit avoided
outcome before injury rolls, health mutation, damage achievements, and hit feedback.
Avoided damage must not consume an injury RNG sample. Do not implement protection by
subtracting damage and adding the health back afterward.

## 4. Perfect guard

Keep held shield behavior and frontal eligibility. The first eligible frontal contact
within 0.12 seconds of a newly raised shield can be a perfect guard, provided at least
12 stamina remains. Spend that cost once, prevent chip damage from that contact, and
produce a distinct short cue.

A perfect-guard window is single-use. It cannot be refreshed more often than once per
0.65 seconds by tapping the shield. Raising with insufficient stamina still permits
ordinary shield behavior, not a free perfect guard. Rear contacts and later contacts
use normal damage resolution.

A melee attacker receives a short, bounded interruption/recovery opening through the
existing reaction/action contract. Do not invent player damage reflection, permanent
stunlock, a new player-poise meter, or a multiplicative damage buff. A blocked arrow
does not remotely stun its shooter.

Pass real attacker identity where available using
`DamagePlayerOptions.sourceActorId?: string`. Projectile sources may no longer exist;
the block remains valid without manufacturing a live attacker.

## 5. Input and presentation

Add `world\CombatMastery.ts` for the pure action/defense state and decisions. Engine
integration owns physical movement, presentation, and actor lookup. The pure module
must run under the existing Node test runner without DOM or THREE scene construction.

Expose `GameView.combatMastery` with action readiness, remaining cooldown, active
progress, and brief defensive outcome information. Use a compact
`ui\CombatMasteryHud.tsx` with feature-scoped CSS; do not add another large permanent
HUD card. Teach the action through `content\gameCopy.ts` and `content\hints.ts`.

Animate the existing player rig with a restrained lean/step pose that follows actual
movement. Reuse current sound and effect vocabulary. Reduced motion must remove
decorative camera motion without changing defense timing or hiding its state.

### Pointer-lock fallback

Keep native pointer-lock controls unchanged when lock succeeds. If it fails, report
the reason in a concise player-facing notice and enable drag-to-look on the world
surface. Support a touch look gesture as well as the existing movement buttons.

In unlocked fallback mode, distinguish a click from a drag with a small movement
threshold. A look drag must not also swing, and a single click must not attack twice.
Do not capture HUD gestures, text-field input, browser shortcuts, or another pointer's
movement control. Cancel capture and held actions on blur, pointer cancellation, pause,
and teardown. Never repeatedly retry a known failing request every frame.

## 6. Persistence and ownership

Save bounded state in `directorState.combatMastery`, with a version and finite
remaining timers. Stamina remains owned by `RunPlayerState`.

Saving mid-step or during a perfect-guard window must not create a fresh window on
continue. Restore the exact remaining state, or deliberately settle transient motion
while preserving already-paid costs and the remaining cooldown. Document the chosen
policy. Older absent blocks initialize inactive with no artificial reward.

Own player input, player-only poses, defense admission, and relevant UI/copy. Do not
rewrite actor AI, squad orders, world generation, boss scheduling, or audio composition.
Keep the existing `honestMelee` off path functional. A development-only mastery flag
may provide an explicit comparison arm; it must not add a confusing settings panel.

## 7. Acceptance

1. Each faction can evade through both keyboard and touch controls. A normal moving
   step travels no farther than 4.2 units and spends exactly 25 stamina.
2. Early melee beats cancel; the finisher does not. Repeated input, zero stamina,
   missing legs, pause, and death cannot create an illegal step.
3. Identical contact before, within, and after the window gives hit/avoid/hit.
   Bleeding continues. Avoidance never increments damage or injury counters.
4. A front contact in the guard window differs from a late or rear contact. The
   second contact and rapid re-raises cannot reuse its one-shot reward.
5. Collision fixtures include a wall, water away from a bridge, a bridge, and a
   streamed boundary. There is no tunneling at supported frame deltas.
6. 30/60/144 Hz schedules preserve the state machine's intended timing to the
   resolution of a frame. No global fixed-timestep rewrite is a prerequisite.
7. Suspend/continue, blur, and opening either sibling overlay release inputs without
   renewing protection, costs, or cooldowns.
8. A negative control that removes defense admission fails the avoided-contact
   scenario. Tests reach the engine-used resolver, not a parallel implementation.
9. Browser observation demonstrates a real dodge, a perfect guard, and pointer-lock
   fallback. An isolated helper test is not proof that inputs are wired.

Add focused coverage such as `tests\combatMastery.test.ts` and extend the relevant
existing combat, persistence, view, and hint cases. Use the existing runner:

```text
node --experimental-strip-types --test tests\combatMastery.test.ts tests\honestMelee.test.ts tests\combatResolver.test.ts tests\campaignView.test.ts tests\hints.test.ts tests\runStorage.test.ts
npm run build
```

Update the README controls and this spec with actual delivered behavior and any justified
tuning changes. Report limitations plainly; do not claim human feel from arithmetic.

## 8. Delivered rules and integration

Implemented on 2026-09-05. The approved step cost, duration, distance, window and
cooldown are unchanged. The evasion window includes both 0.06 and 0.18, with only a
floating-point tolerance at those boundaries. The perfect-guard window expires at
0.12: contacts before that boundary can qualify; contacts at/after it cannot.

`world\CombatMastery.ts` is the production state machine, defense admission, view
factory and version-1 save normalizer. `GameEngine.evade()` is the keyboard/touch
entry point. `updatePlayer` integrates the returned displacement through its existing
`moveCharacter` / `CollisionWorld.resolveMovement` path. Diagonals are normalized;
no-input steps go backward. The bounded step does not acquire the elf forest speed
bonus. Existing one-missing-leg and prosthetic multipliers apply; two missing legs
refuse the step. Jump/vertical physics and the existing bleed update remain live.

Acceptance pays 25 once, cancels only cancellable melee, drops the shield, and blocks
melee/ability starts and idle stamina recovery for the remaining action. Collision
shortens displacement without refunding cost or extending protection. The existing
`honestMelee` off arm remains usable, including the same evasion exclusion.

`damagePlayer` calls `resolveCombatMasteryContact` before health, injuries,
damage achievements or ordinary hit feedback. Its first argument is now
`number | (() => number)`: the ordinary NPC melee caller supplies a thunk, so an
avoided contact does not even roll its base damage. Existing numeric callers remain
compatible. Bleeding is outside this combat admission path.

Perfect guard spends 12 on its first eligible frontal contact and removes chip
damage. It preserves ordinary shield direction, armor, drain and release cooldown.
If paying the cost leaves zero stamina, the shield drops immediately. A live melee
source receives the existing `stagger` reaction and an attack-cooldown floor of
**0.24 seconds**; an already longer reaction is not shortened. Its current action,
charge and telegraph are released, without reflected damage or a poise-damage bonus.
This is the chosen short opening, not a change to ordinary role poise tuning.
Arrows and missing/dead sources never remotely interrupt an actor.
Against the owned signature boss, the same melee guard immediately settles its
signature action into recovery and cancels the sweep's remaining contacts. It does
not renew an action already recovering.

Shared additions:

- `GameView.combatMastery`, including readiness/reason, cooldown, active/settled
  progress, actual protection, one-shot guard state, short outcome and camera mode.
- `LiveViewInput.combatMastery`, `cameraMode` and optional `inputBlocked`; initial
  and live views use the same mastery factory and restore policy.
- `DamagePlayerOptions.sourceActorId?: string`, populated for normal NPC melee,
  boar charges and actor projectiles.
- `GameCallbacks.onPointerGestureCancelled?: (pointerId: number) => void`, for
  App-owned suppression of a cancelled world's delayed click.

The HUD is inside the existing melee strip, not another permanent card. The touch
button is labelled `Уворот`; all three new teaching triggers claim `combatMastery`.
The existing rig receives a small movement-dependent step/lean, reduced under
reduced motion. Perfect guard has a stronger fixed-variant block cue and an explicit
short text outcome. No new audio composition or unbounded effect pool was added.

### Input lifecycle and camera fallback

Native pointer lock still uses relative mouse movement and press-to-attack. Failure
is reported with its reason and switches to world-surface drag/touch look. A six-CSS-
pixel threshold distinguishes a tap/click from a drag; a drag cannot also attack.
The failed request is not retried by subsequent world clicks. Only the explicit
capture button retries. `R` also works unlocked.

Mouse combat retains per-button `mousedown`/`mouseup` edges, while pointer events
own gesture identity, movement and capture. This matters for left/right button
chords: Pointer Events alone only report the first press and final release. Both
chord orders now attack once and release the shield, in native and fallback modes.

`input\CombatInput.ts` supplies the shared gesture classifier, camera-relative
movement, `instantGameplayAction`, and `GameplayPointerCaptures`. Instant combat
buttons respond on pointer down, including a second finger while the first holds
movement; their click handler is reserved for keyboard activation. A compatibility
click therefore cannot duplicate the action.

Pause, blur, hidden document, pointer cancellation and teardown release held inputs
and owned captures. A bounded App-owned ledger also suppresses delayed clicks from
cancelled gestures: browser observation found that simply releasing a capture could
otherwise activate an unrelated pause-menu button. New pointer downs and keyboard
clicks are not suppressed. The world and HUD share this ledger, including when
`GameScreen` is replaced by the main menu.

Editable targets, IME composition, prevented events and browser modifier shortcuts
do not drive gameplay. Plain Escape remains an overlay-close key even when a field
has focus. `F` still saves while paused, without repeat writes. `P`/Escape still
delegate to the existing App pause callback, without a competing Escape listener.
`Q` remains follow/hold; `T` and `M` now use the shared orders/atlas owner alongside
`C` in the same gameplay-key dispatcher. Both overlays synchronously settle held
input without refreshing the mastery action or its cooldown.

### Save policy

`directorState.combatMastery` version 1 contains remaining evade action/cooldown,
guard rearm, ability cooldown, legacy attack cooldown and settled melee state.
Stamina and health remain in the existing player block.

Saving or releasing input settles transient displacement and protection rather
than reopening them on continue. Remaining action recovery still elapses before
ordinary movement/attacks/idle stamina recovery resume. A held shield is released
with its existing cooldown; its timing window cannot resume. A committed finisher's
remaining phase is retained, with no buffered next attack and no second stamina
charge or duplicate contact. Early cancellable melee is settled.

If a committed finisher save is continued with the development comparison option
`honestMelee: false`, that already-paid phase/contact/recovery still completes
without a new buffer or charge. Future attacks use the legacy 0.52-second swing.
The comparison flag therefore cannot freeze a restored commitment indefinitely or
let a legacy swing bypass it.

Absent blocks are an ordinary old-save case. Malformed present versions, enums,
non-finite/out-of-range or incoherent timers produce the existing warning notice
path and conservative bounded cooldowns. A corrupt windup cannot manufacture a
finisher contact. No wall-clock time, DOM state or protection window is persisted.

## 9. Acceptance evidence and limits

The following existing-runner selection passed **137 tests**, followed by
`npm run build` (including production and test TypeScript checks):

```text
node --experimental-strip-types --test tests\combatMastery.test.ts tests\combatMasteryEngine.test.ts tests\honestMelee.test.ts tests\combatResolver.test.ts tests\campaignView.test.ts tests\hints.test.ts tests\gameCopy.test.ts tests\runStorage.test.ts tests\collisionWorld.test.ts tests\mobileHudLayout.test.ts tests\viewportOverflow.test.ts tests\achievementScrollLock.test.ts tests\pauseDialogLayout.test.ts
npm run build
```

The engine tests load the actual `GameEngine` methods with Node's module-resolution
hook; only construction/rendering/audio presentation are replaced by fixtures.
They execute the live evade, movement, melee contact, shield, damage, keyboard,
pointer and release methods. Removing protection from the admitted-contact fixture
changes it back to damage, RNG draws, injury and damage feedback. This is not a
source-string-only assertion or a second combat implementation.

Coverage includes both window boundaries, second/late/rear/poor guard contacts,
orphan and live-source arrows, zero-stamina shield exhaustion, old/corrupt saves,
retained finisher commitment, no repeat/queued evasion, lifecycle cancellation,
secondary-finger actions and delayed-click suppression. Real collision fixtures
include a wall, river blockers with/without a bridge gap, steep terrain and streamed
bounds at 30/60/144 Hz and the engine's capped 50 ms delta. Existing honest-melee,
armor/injury, view, hint, storage and upstream narrow/scroll-layout controls remain
in the selection.

The final read-only review found two additional input/continue edges: mouse-button
chord releases and a retained finisher under the legacy comparison flag. Both have
dedicated production-method regressions; the mouse fix was also exercised through
real Chromium button chords and rechecked with primary-touch world taps and
secondary-finger melee.

### Browser observations

An isolated native Chromium profile used the loopback server on port 5171, never
the coordinator's browser or port. Seed `20260905` launched all three factions.
Evidence JSON and screenshots are in this implementation session's artifacts,
outside the repository. The recorded browser was Chrome 152.0.7977.76 on Windows;
the Node runner was 25.6.0.

| Observation | Result |
| --- | --- |
| Real `C` and multi-touch evade, all factions | Each accepted action spent exactly 25. Open elf/guard samples travelled 4.2. The villain fort samples were shortened by scenery (about 2.35 for the moving touch step), without a refund. |
| Actual guard contact | A controlled live soldier fixture used the normal factory/budget, 0.26 tell, 2.55 contact range and engine update loop. Native `R` produced zero health loss, exactly 12 spent and the 0.24 stagger/opening. |
| Actual avoided contact and bleed control | Native `W` + `C` met the same live melee contact inside the protection window. Contact dealt zero; a deliberately configured 0.5 bleed continued to subtract health at the elapsed gameplay rate. |
| Native and fallback camera | Native capture succeeded. Rejection was then induced only at `canvas.requestPointerLock`, with `WrongDocumentError`, to exercise the real failure adapter and controls. A 135-pixel drag changed yaw by 0.378 radians with zero attacks; a click attacked once; further world input made no retry. |
| Mouse chords and touch attacks | Right-then-left and left-then-right presses, releasing in both corresponding orders, each invoked one attack and left no held shield in native and fallback modes. The initial capture click did not attack. A later fallback drag still turned without attacking. Secondary-finger melee and a primary world tap each invoked one attack. |
| Real focus loss | A temporary tab in the same isolated browser caused `document.hasFocus() === false` and a hidden document during a held look/step. Keys and capture cleared, protection settled, remaining cooldown did not renew, and returning/releasing did not attack. The temporary tab was closed by its own target ID. |
| Suspend/continue | Real C, pause, Save, main-menu checkpoint and Continue were exercised three times. Each constructor restored the exact saved stamina and remaining timers before its first frame; all resumed protection/direction/guard windows remained closed. The recorded 27.4832 stamina did not become a fresh bar. |
| Narrow/reduced-motion/keyboard UI | 390x844 touch targets were 44x44 and stayed inside the viewport, with no horizontal overflow. 1366x768 was also inspected. Villain runs exercised both engine and CSS reduced motion with bloom off. Tab + Space resumed without jumping; paused F saved; native unlocked R retained the bow's 15/0.9 and cleave's 30/3.5 cost/cooldown. Text-field C typed text without evasion. |

Representative artifacts: `ng11-camera-evidence.json`, `ng11-guard-evidence.json`,
`ng11-persistence-evidence.json`, `ng11-blur-evidence.json`,
`ng11-guard-touch-final-evidence.json`, `ng11-elf-touch-complete-evidence.json`,
`ng11-villain-reduced-complete-evidence.json`, `ng11-elf-keyboard-final-evidence.json`
and `ng11-villain-keyboard-complete-evidence.json`, with corresponding PNG captures.
The final mouse-edge evidence is `ng11-mouse-chords-evidence.json` and
`ng11-guard-touch-post-review-evidence.json`.
`ng11-escape-field-evidence.json` records native Tab navigation to the pause
dialog's range input, then Escape closing the dialog without leaving keys held.
The complete final runner output is retained in `ng11-final-tests.tap`.

These are bounded browser samples and a labelled controlled contact fixture, not a
balance study, human-feel verdict, full campaign completion or measured performance
guarantee. The embedded-browser rejection from reconnaissance was not re-observed
naturally here; the final fallback check injected that browser-API failure while
leaving game input/defense code intact. Combined bridge, squad, atlas, finale, and
camera observations are recorded separately in the parent milestone.
