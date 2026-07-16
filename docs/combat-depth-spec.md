# Combat Depth: Faction Abilities & Enemy Variety

> Design spec for КОРОВАНЫ. Fully client-side — no backend, no new art assets.
> Everything reuses existing box/cone primitives, `factionColor()`, the particle
> system, and the current input wiring.

## 1. Goal

Turn the single-button melee loop (`attack()`, bound to LMB in `onMouseDown`) into a
two-layer combat system:

1. Keep the primary melee attack as-is.
2. Add one **signature secondary ability per faction**.
3. Differentiate enemy roles so fights read differently by zone.

## 2. Previous baseline (reference)

| System | Location | Notes |
| --- | --- | --- |
| Primary attack | `GameEngine.attack()` | 0.52 s cooldown, range 3.6, nearest hostile, base `damage` 26/28/31, arm penalty, 13% limb detach. |
| Actor model | `Actor`, `spawnActor()` | Four roles with mostly identical melee behavior. |
| Actor AI | `updateActors()` | Chase/attack player, squad-follow, wander. |
| Enemy → player damage | `actorAttackPlayer()` | 6–9 dmg (commander 10), guard armor ×0.72, 11% injury chance. |
| Input | engine keyboard/mouse handlers; React touch controls | LMB/touch → `attack()`. |

## 3. Combat direction and damage rules

All directional combat uses one canonical aim vector derived from `cameraYaw`. The
crosshair, bow, cleave, and raised shield therefore agree even while the player is
standing still. Activating a directional ability also rotates the player mesh toward
that vector.

All actor damage goes through `damageActor()`:

- applies the brute's frontal modifier for melee, arrows, cleave, and actor combat;
- prevents limb detachment from brutes regardless of damage source;
- applies optional knockback and the world clamp;
- routes deaths through `killActor()` so rewards, kills, and objectives retain their
  existing attribution rules.

Incoming player damage goes through `damagePlayer()`, which applies guard armor and
then the frontal shield modifier. Melee attacks may injure; archer projectiles do not.

## 4. Player abilities

| Faction | Ability | Trigger | Effect | Cost / cooldown |
| --- | --- | --- | --- | --- |
| **Elf** | **Лесная стрела** | RMB / `KeyR` / touch | Fires a 24 u/s projectile up to 30 u. Damage falls linearly from 18 to 10 by travelled distance. The nearest hostile intersected by the swept 0.9 u hit volume is struck; non-brutes have a 25% limb-detach chance. | 15 stamina, 0.9 s |
| **Guard** | **Стойка щита** *(hold)* | RMB / `KeyR` / touch hold | Frontal hits (`dot > 0.2`) deal ×0.15 damage after armor and cannot injure. Movement is ×0.5, sprint is disabled, and stamina regeneration is suppressed while 18 stamina/s is drained. | Requires stamina, 0.4 s after lowering |
| **Villain** | **Сокрушающий рывок** | RMB / `KeyR` / touch | Immediately lunges 3 u along aim, then hits every hostile within 4.5 u and a 120° forward arc for `(damage − arm penalty, min 8) ×1.1`; each target is knocked back 3 u. | 30 stamina, 3.5 s |

The elf ability is unavailable when both arms are missing. Failed activations do not
spend stamina or start cooldown.

## 5. Enemy roles and population

`ActorRole` is shared from `types.ts`.

| Role | hp | speed | Behavior |
| --- | ---: | ---: | --- |
| `scout` | 55 | 4.8 | Melee hit-and-run; retreats for 0.62 s after attacking. |
| `soldier` | 70 | 3.7 | Baseline melee. |
| `minion` | 70 | 3.7 | Baseline melee used by the villain faction. |
| `archer` | 45 | 3.2 | Maintains 8–12 u, fires every 1.8 s for 7 damage, and can target the player or hostile actors. |
| `brute` | 130 | 2.6 | Deals 14 damage, takes ×0.5 damage from frontal hits (`dot > 0.2`), and cannot lose limbs. |
| `commander` | 150 | 0 | Allies within 10 u receive speed ×1.15 and damage +4. Calls one soldier every 25 s, up to four total. |

`spawnPopulation()` replaces baseline actors rather than adding an unbounded second
set: guards receive archers and a brute, elves receive two archers, and villains
receive an archer and two brutes. The initial population remains 16 actors.

The actor array has a lifetime cap of 25 entries, including dead actors. Ambushes use
only remaining slots. Commander reinforcements are limited to four total per
commander, not four currently alive actors.

## 6. Data model

```ts
export type ActorRole =
  | 'soldier'
  | 'scout'
  | 'commander'
  | 'minion'
  | 'archer'
  | 'brute'

export interface AbilityView {
  id: 'bow' | 'shield' | 'cleave'
  name: string
  ready: boolean
  active: boolean
  cooldown: number
  cooldownMax: number
}

interface Projectile {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  owner: 'player' | 'actor'
  faction: Faction
  damage: number
  sourceActorId: string | null
  travelled: number
  detachChance: number
}
```

`GameView` includes `ability`. Both `GameEngine.emitView()` and
`App.createInitialView()` construct it through `createAbilityView()`, so the loading
frame is type-safe and displays valid state before the first engine update.

**Save compatibility:** ability and actor combat state are runtime-derived and are
not persisted. `SavedGame` remains version 1; old saves load unchanged.

## 7. Projectile behavior

- Movement uses light gravity and swept segment/sphere collision to prevent
  tunnelling.
- The nearest eligible hit along each frame segment wins.
- Eligibility is symmetric and faction-based: player and actor projectiles can hit
  any hostile actor, while hostile actor projectiles can also hit the player.
- Friendly fire is disabled.
- Actor projectiles store `sourceActorId`; outstanding shots are removed when that
  actor dies.
- Expired, out-of-world, hit, and destroyed projectiles remove and dispose their
  geometry and material.

## 8. Input, lifecycle, and UI

- Desktop RMB and `KeyR` activate only while the game canvas owns pointer lock.
- Public `useAbility()` / `setShield()` methods do **not** require pointer lock,
  allowing the coarse-pointer touch overlay to work normally.
- RMB context-menu prevention is scoped to the game container or active pointer
  lock, rather than the whole page.
- Guard release is handled by mouseup, keyup, touch pointerup/cancel/leave, pause,
  pointer-lock loss, window blur, visibility loss, stamina exhaustion, and game end.
- Every added browser listener is removed by `destroy()`.
- The HUD ability chip shows name, ready/active state, remaining cooldown, and a
  linear recharge meter.
- The fifth touch action uses pointer down/up so guard brace is hold-based.
- The control ribbon displays `ПКМ/R` and the faction-specific ability name.
- `playSound()` includes bow, arrow, block, and cleave cues.

## 9. Tuning constants

```text
BOW_DAMAGE=18          BOW_MIN_DAMAGE=10    BOW_SPEED=24
BOW_RANGE=30           BOW_COOLDOWN=0.9     BOW_COST=15

SHIELD_MULTIPLIER=0.15 SHIELD_DRAIN=18/s    SHIELD_SLOW=0.5
SHIELD_FRONT_DOT=0.2   SHIELD_RERAISE=0.4

CLEAVE_MULTIPLIER=1.1  CLEAVE_RADIUS=4.5    CLEAVE_ARC=120°
CLEAVE_DASH=3          CLEAVE_KNOCKBACK=3   CLEAVE_COOLDOWN=3.5
CLEAVE_COST=30

ARCHER_RANGE=[8,12]    ARCHER_DAMAGE=7      ARCHER_SPEED=3.2
ARCHER_PROJECTILE=16   ARCHER_FIRE_COOLDOWN=1.8

COMMANDER_AURA=10      COMMANDER_SPEED=1.15 COMMANDER_DAMAGE=+4
REINFORCEMENT_TIME=25  REINFORCEMENT_LIMIT=4
MAX_ACTORS=25
```

## 10. Acceptance criteria

- [x] Each faction has a secondary bound to RMB, `KeyR`, and touch with visible state and cooldown.
- [x] Guard brace reduces frontal damage only, blocks frontal injuries, drains stamina without simultaneous regeneration, slows movement, and cannot become stuck active.
- [x] Elf arrows use swept first-hit collision and defined falloff; villain cleave hits and knocks back multiple post-dash targets.
- [x] Actor projectiles respect faction hostility and support player, ally, and enemy targets.
- [x] Brute mitigation and limb immunity apply through every damage path; player ability kills retain rewards and objective credit.
- [x] Scouts retreat, archers kite, brutes are visually larger, and commander aura/reinforcement behavior is bounded.
- [x] Old v1 saves load; the initial React view includes ability state.
- [x] TypeScript build and oxlint pass.
