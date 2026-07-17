# 04 - Enemy Reactions, Telegraphs, and Death Motion

> Implementation-ready combat-behavior spec for КОРОВАНЫ. This is not only an animation
> pass: readable anticipation requires delayed contact and therefore changes combat
> timing. The rules below preserve approximate attack cadence while creating real dodge
> windows and bounded stagger behavior.

## 1. Goal

Make enemies look and feel responsive rather than sliding into instant damage events.
Every hostile action should have a readable beginning, contact moment, and recovery, and
every meaningful player hit should produce a role-appropriate response.

The target behavior is:

1. ordinary enemies visibly prepare attacks before damage resolves;
2. heavy enemies advertise slower, larger attacks;
3. light hits flinch without trivially stun-locking;
4. repeated or heavy hits can produce a real stagger;
5. knockback and death direction reflect the contact source;
6. all state remains deterministic inside the existing update loop.

## 2. Scope and non-goals

### In scope

- Actor attack phases: windup, contact, and recovery.
- Target revalidation at contact time.
- Procedural anticipation/recovery poses on existing limb pivots.
- Light flinch, poise, stagger, and role resistance.
- Velocity-based bounded knockback.
- Directional authored death poses selected from a small set.
- Telegraph rings/wedges for attacks that need extra readability.

### Out of scope

- Skeletal animation clips, inverse kinematics, ragdolls, or a physics engine.
- Perfect weapon collision or parry.
- New player dodge-roll controls.
- A general behavior tree rewrite.
- Boss phases or unique boss movesets.
- Changing objective, reward, injury, or gore rules.

## 3. Verified baseline

| System | Current behavior |
| --- | --- |
| Actor model | `Actor` stores role, HP, speed, cooldowns, target IDs, stride, retreat/aura/event fields, and health-bar resources, but no action or reaction state. |
| Targeting | `updateActors()` chooses player, actor, event prop, formation, or wander target and steers around static obstacles/enclosures. |
| Melee contact | Inside stop distance, an actor with zero cooldown calls `actorAttackPlayer()`, `actorAttackActor()`, or `actorAttackEventProp()` and damage resolves immediately. |
| Archer contact | An archer inside range immediately creates a projectile when cooldown reaches zero. |
| Animation | Actors receive stride animation only; `animateCharacter(actor.mesh, actor.stride, 0)` never supplies an attack value. |
| Player hit response | `damageActor()` creates blood/particles, updates HP/bar, optionally detaches a limb, applies one immediate positional knockback step, and may kill. |
| Death | `killActor()` instantly rotates the whole character to +/- 90 degrees, lowers Y, rotates the weapon, hides indicators, and emits gore. |
| Collision | Actor movement already routes through role-specific radii and `moveCharacter()`/steering. |

## 4. Design corrections

- **A telegraph with immediate damage is false information.** Contact must move to the end
  of a real windup, and the target must be revalidated then.
- **Do not add a full actor state machine that replaces targeting.** Keep the current
  target-selection/steering logic and gate it with a small action/reaction layer.
- **Do not let every hit cancel every windup.** That creates permanent stun-lock with the
  current attack speed. Light flinch is mostly visual; only poise break or lethal damage
  cancels an action.
- **Do not teleport for knockback.** The current one-step move can pop through a visual
  reaction. Use a short velocity integrated through existing collision movement.
- **Do not use unbounded additive timers.** Action and reaction state is one active record
  per actor; stronger reactions replace weaker ones.
- **Do not infer contact from animation pose.** The action timer is authoritative; visuals
  sample it.
- **Do not make color the only telegraph.** Pose, ring/wedge shape, timing, and sound carry
  the same warning.

## 5. Runtime state model

Add:

```ts
type ActorActionKind = 'meleePlayer' | 'meleeActor' | 'eventProp' | 'arrow'
type ActorActionPhase = 'windup' | 'recovery'
type HitReactionKind = 'none' | 'flinch' | 'stagger'
type DeathStyle = 'sideFall' | 'backFall' | 'spinFall' | 'launchFall'

interface ActorAction {
  kind: ActorActionKind
  phase: ActorActionPhase
  elapsed: number
  duration: number
  target:
    | { kind: 'player' }
    | { kind: 'actor'; id: string }
    | { kind: 'eventProp'; id: string }
  targetPosition: THREE.Vector3
}
```

Extend `Actor`:

```ts
action: ActorAction | null
reaction: HitReactionKind
reactionRemaining: number
poise: number
maxPoise: number
poiseRecoveryDelay: number
staggerImmunity: number
knockbackVelocity: THREE.Vector3
lastHitDirection: THREE.Vector3
deathStyle: DeathStyle | null
deathAge: number
```

Give `EventPropTarget` a stable `id` and maintain a runtime
`Map<string, EventPropTarget>` while an event owns attackable props. `targetPosition` is
copied at action creation and may be refreshed while a live target is valid. No action
keeps a direct `Actor` or event-prop reference that could become stale. Event cleanup
unregisters its targets before removing their objects.

State priority:

```text
dead > stagger > action > flinch overlay > locomotion
```

Flinch may overlay locomotion/action pose but does not stop their timers. Stagger cancels
the current action and movement. Death clears all other state.

## 6. Attack phase behavior

### 6.1 Starting an action

When current logic would attack:

1. create an `ActorAction` instead of resolving damage;
2. set the role's current attack cooldown immediately;
3. stop movement and face the target;
4. show the appropriate anticipation pose/telegraph;
5. let ordinary targeting continue only after recovery.

Cooldown remains measured from action start so contact-to-contact cadence stays close to
the current `0.8`, `1.15`, `1.3`, and `1.35` second values. Recovery is part of that
cooldown, not additional unbounded delay.

### 6.2 Contact

When windup reaches its duration:

- resolve exactly once;
- re-find an actor target by ID and require it to be alive;
- require player/actor/event target to remain inside role-specific contact range plus
  `0.35` units of forgiveness;
- for arrows, use the current live target position if valid, otherwise the copied
  position;
- if validation fails, produce a whiff/release visual and no damage;
- transition to recovery either way.

The player can therefore escape a melee windup by moving out of range. Obstacle and line
of sight behavior remains equivalent to current combat; adding combat raycasts is a
separate change.

### 6.3 Role timings

| Role | Windup | Recovery | Telegraph |
| --- | ---: | ---: | --- |
| Scout/minion | 0.18 s | 0.18 s | weapon pullback only |
| Soldier/captive attacker | 0.26 s | 0.24 s | pullback + short ground tick |
| Archer | 0.32 s | 0.20 s | bow/weapon raise + thin aim line |
| Commander | 0.38 s | 0.28 s | double-chevron ground wedge |
| Brute | 0.56 s | 0.42 s | large expanding wedge |
| Champion | 0.48 s | 0.36 s | aura pulse + large wedge |

Existing scout retreat begins after contact/whiff, not at windup start. Commander aura
updates continue during windup unless the commander is staggered.

## 7. Flinch, poise, and stagger

### 7.1 Light flinch

Every nonlethal actor hit:

- copies normalized horizontal `lastHitDirection`;
- sets `reaction='flinch'` for `0.12` seconds;
- adds a short torso lean/head snap and arm recoil;
- does not cancel action, targeting, or cooldown.

Repeated flinches take the maximum remaining duration; they do not add.

### 7.2 Poise

Role poise:

| Role group | Max poise |
| --- | ---: |
| Scout/minion/archer | 18 |
| Soldier | 28 |
| Commander | 46 |
| Brute | 58 |
| Champion | 72 |

Poise damage uses post-mitigation damage:

```text
normal melee/arrow: dealt * 0.75
cleave: dealt * 1.45
lethal: irrelevant; death wins
```

After a hit, delay regeneration for `0.75` seconds. Then recover
`POISE_RECOVERY_PER_SECOND` up to max. When poise reaches zero:

1. set `reaction='stagger'`;
2. cancel any action without resolving contact;
3. clear retreat movement for the stagger duration;
4. reset poise to `maxPoise * 0.7` after stagger;
5. apply `STAGGER_IMMUNITY = 0.45` seconds before poise can break again.

This provides burst openings without allowing permanent stun-lock.

### 7.3 Stagger duration

```text
scout/minion/archer=0.34 s
soldier=0.30 s
commander=0.24 s
brute=0.20 s
champion=0.18 s
```

Large roles move less but still visibly react. A cleave can break poise more quickly; it
does not bypass immunity.

## 8. Knockback and directional death

### 8.1 Knockback

Replace immediate positional knockback in `damageActor()` with velocity:

```ts
actor.knockbackVelocity.addScaledVector(hitDirection, requestedKnockback * scale)
```

During actor update:

- integrate X/Z displacement through `moveCharacter()` using the actor collider;
- apply exponential damping independent of frame rate;
- clamp velocity to `KNOCKBACK_MAX_SPEED`;
- do not steer while velocity exceeds `KNOCKBACK_STEER_THRESHOLD`;
- zero blocked components when collision prevents motion.

Brutes, commanders, and champions use role resistance. Knockback cannot move actors
outside world bounds or through registered walls.

### 8.2 Death style selection

Choose once in `killActor()` using copied hit context:

| Condition | Style |
| --- | --- |
| Cleave or high knockback | `launchFall` |
| Strong lateral hit | `spinFall` |
| Source in front | `backFall` |
| Otherwise | `sideFall` |

Animate the root over `DEATH_POSE_TIME` with easing, then freeze:

- tilt/spin toward or away from `lastHitDirection`;
- lower Y to the current corpse height;
- rotate weapon and remaining limbs;
- keep existing gore, decals, detached limbs, objective credit, rewards, and health-bar
  hiding exactly once.

This is an authored procedural collapse, not a ragdoll. Corpse collision behavior remains
unchanged.

## 9. Telegraph visuals and procedural poses

### 9.1 Pose sampler

Extend animation input:

```ts
interface CharacterPose {
  stride: number
  attack: number
  anticipation: number
  recovery: number
  flinch: number
  stagger: number
}
```

Either change `animateCharacter()` to accept this object or add
`animateActorCharacter(actor)`. Do not continue adding positional numeric arguments.

Pose rules:

- anticipation pulls weapon arm back and leans torso away from target;
- contact snaps weapon arm forward;
- recovery overshoots slightly, then returns;
- flinch offsets both arms/head opposite the hit;
- stagger lowers torso and opens arms;
- role scale changes amplitude, not state semantics.

Use named pivots where available. If head/torso need animation, name them in
`createCharacter()` rather than searching by child index.

### 9.2 Ground telegraphs

Use a pool of at most eight flat wedge/ring meshes:

- absolute Y just above ground;
- `MeshBasicMaterial`, transparent, depth-write off;
- length equals validated melee range;
- wedge grows during windup and disappears at contact;
- soldier tick is short and narrow; brute/champion/commander use distinct broader shapes;
- no per-actor dynamic light.

At pool pressure, retain brute/champion/commander telegraphs before soldier ticks. The
pose is always present even if no ground entry is available.

Archers use one thin ground/air line only inside the existing ranged attack window. It is
an aim warning, not a guaranteed projectile trajectory.

## 10. Update and lifecycle rules

- `updateActors()` first updates death motion, reaction timers/poise, knockback, and active
  action; only actors free for locomotion continue into existing targeting/steering.
- An actor can resolve at most one contact in one update even if delta crosses both
  windup and recovery boundaries.
- Pause freezes action/reaction/poise/knockback/death timers with world simulation.
- Event cleanup hides/releases telegraphs owned by removed actors.
- `killActor()` clears `action`, reaction timers, and knockback before selecting death
  state.
- `destroy()` disposes the telegraph pool through scene ownership.
- No actor-state field is serialized; actor population already respawns on load.

## 11. File-level changes

| File | Changes |
| --- | --- |
| `src/game/GameEngine.ts` | Actor action/reaction fields, stable event-prop target registry, role configs, start/update/resolve action methods, target revalidation, poise, knockback integration, pose sampling, telegraph pool, and death animation. |
| `src/game/types.ts` | No `GameView` or `SavedGame` change. Export no runtime action types unless tests are extracted. |
| `src/App.tsx` | No required change. Existing combat controls remain. |

If the role timing tables grow further, extract pure config/types into
`src/game/combatConfig.ts`; do not move mutable Three.js actor state out merely to reduce
line count.

## 12. Tuning constants

```text
FLINCH_TIME=0.12
POISE_REGEN_DELAY=0.75
POISE_RECOVERY_PER_SECOND=22
STAGGER_IMMUNITY=0.45

KNOCKBACK_DAMPING=11
KNOCKBACK_MAX_SPEED=11
KNOCKBACK_STEER_THRESHOLD=0.8
LARGE_ROLE_KNOCKBACK_SCALE=0.55

TELEGRAPH_MAX=8
TELEGRAPH_Y=0.055
CONTACT_RANGE_FORGIVENESS=0.35
DEATH_POSE_TIME=0.24
```

Tune damage cadence after adding windups. Contact-to-contact time for an uninterrupted
soldier should remain within 10% of the current behavior; dodgeability comes from moving
contact inside that cadence, not simply lowering enemy DPS.

## 13. Accessibility and readability

- Telegraph shape/size and pose carry meaning independent of color.
- Reduced motion shortens root translation/spin and knockback visual travel by 40%, but
  does not remove windup timing or ground warning.
- Telegraph opacity must remain readable in all four zone ground textures and at night.
- Do not flash the entire screen for enemy windups.
- Archer and heavy-melee warnings should have distinct silhouettes.
- A failed/missed attack still completes a recovery pose so the player's dodge is visible
  and understandable.

## 14. Edge cases

- If a target dies, changes faction relationship, or leaves range during windup, contact
  becomes a whiff and cannot damage a replacement target.
- If an actor is staggered on the same frame its windup would resolve, lethal/stagger
  priority is processed before contact.
- AI-vs-AI targets are looked up by stable actor ID; array removal/reordering cannot
  retarget the attack.
- Event props can become invalid during cleanup. An invalid prop action whiffs and drops
  its reference.
- A captive never starts an attack until its existing AI mode changes.
- Knockback into a wall damps at the wall and does not accumulate velocity for a later
  launch.
- Actor arrows spawn once at contact. Existing projectile source cleanup still removes
  arrows if the source dies afterward.
- Death animation must not call reward/objective/event kill hooks more than once.

## 15. Acceptance criteria

- [ ] Every actor melee/arrow attack has a real windup, one validated contact/whiff, and
      recovery; damage no longer resolves at windup start.
- [ ] Uninterrupted attack cadence remains within the agreed baseline tolerance.
- [ ] Moving out of melee range during windup prevents contact without retargeting another
      entity.
- [ ] Light hits visibly flinch but do not cancel attacks; poise breaks cause bounded,
      immunity-protected stagger and can cancel windups.
- [ ] Brutes/champions/commanders are harder to stagger and use larger, slower, distinct
      telegraphs.
- [ ] Knockback integrates through existing collision and cannot pop actors through walls
      or world bounds.
- [ ] Death style reflects hit direction/weight, settles to a stable corpse, and preserves
      one-time gore, event, objective, and reward behavior.
- [ ] Telegraph pool never exceeds eight and releases entries when actors die or events
      clean up.
- [ ] Pause/resume and save/load leave no stale action or telegraph; `SavedGame` stays
      version 1.
- [ ] Production build, oxlint, cadence tests, dodge/whiff tests, poise immunity tests,
      collision knockback tests, and browser captures for each role pass.

## 16. Dependencies and effort

- Spec 02's `AttackKind`/`DamageResult` should feed poise and death-style selection.
- Spec 06 can layer anticipation/contact/whiff audio after action phases exist.

**3-4 days.** This changes combat timing and therefore needs more validation than a
cosmetic animation pass. Target revalidation, anti-stunlock rules, collision-safe
knockback, and event-target cleanup are the principal risks.
