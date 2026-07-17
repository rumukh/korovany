# 03 - Loot Spectacle Without an Inventory Rewrite

> Implementation-ready reward-presentation spec for КОРОВАНЫ. It adds beams, bursts,
> magnet pickups, and reward cards while deliberately preserving the current gold/shop
> progression and version-1 save schema.

## 1. Goal

Turn victories into visible rewards that briefly occupy the world and then snap back into
the existing progression loop. A drop should be understandable from silhouette, beam,
sound, and card before the player reads its exact value.

The recommended milestone adds bonus consumable rewards, not randomized gear. It should
feel like loot without forcing an inventory, equipment comparison, affix generator, or
save migration into an otherwise compact game.

## 2. Scope and non-goals

### In scope

- A capped runtime pool of physical reward pickups.
- Rarity colors plus distinct beam/ring shapes.
- Coin, medicine, and whetstone bonus rewards.
- Burst, hover, magnet, collection, and expiry states.
- A low-frequency React reward card on collection.
- Guaranteed settlement before save so runtime drops are not lost.
- Reuse of existing `gold`, `health`, and `damage` save fields.

### Out of scope

- Inventory slots, equipment, item comparison, affixes, vendors buying items, or salvage.
- Replacing the fixed healer/mechanic shop.
- Weapons with unique meshes or attack behavior.
- Persisting arbitrary world pickup positions.
- Changing base kill rewards or event completion rewards.
- A `SavedGame` version bump.

If randomized equipment is later approved, write a separate progression spec and migrate
to `SavedGame` version 2 explicitly. Do not smuggle a partial inventory into optional
fields on version 1.

## 3. Verified baseline

| System | Current behavior |
| --- | --- |
| Kill reward | A direct player kill grants `12` gold or `55` for a commander immediately in `killActor()`. Event-owned actors return before this ordinary reward path. |
| Event reward | Event completion directly grants fixed gold and sometimes persistent champion damage bonus. |
| Shop | Five fixed purchases spend gold on medicine, prosthetics, an eye, or blade damage. |
| Save | `SavedGame` version 1 already stores current `health`, `gold`, and `damage`; `readSavedGame()` rejects any other version. |
| World/UI | `GameView` carries gold, health, damage, notices, prompts, and zone; `emitView(false)` is throttled to about 90 ms. |
| FX infrastructure | Procedural canvas textures, reusable basic materials, sprites, beacons, particles, and a generated-texture cache already exist. |
| Population | Actor count is capped at 25, but corpses and event objects remain in the scene until their existing cleanup paths run. |

## 4. Design corrections

- **Do not convert mandatory kill gold into missable pickups.** Objective and economy
  behavior currently assumes immediate credit. Base rewards remain immediate; drops are
  bonus rewards and a spectacle layer.
- **Do not call three consumable bonuses an inventory.** The collected reward applies
  immediately and the card describes the state change.
- **Do not use rarity color alone.** Beam height, ring count, star points, label, and audio
  also encode rarity.
- **Do not persist active world pickups.** Settle them before saving, and let uncollected
  bonuses disappear on defeat/return to menu.
- **Do not spawn a drop for every AI kill.** Only direct player kills and explicit event
  reward moments can roll bonus loot.
- **Do not create one light per beam.** Emissive/basic meshes provide the glow; bloom is
  optional.
- **Do not make loot depend on bloom, outlines, or layered audio.** Those specs enhance
  it when present but the pickup remains readable alone.

## 5. Reward model

Add shared, serializable value types, but keep runtime meshes in `GameEngine.ts`:

```ts
export type LootRarity = 'common' | 'uncommon' | 'rare' | 'legendary'
export type LootRewardKind = 'coins' | 'medicine' | 'whetstone'

export interface LootReward {
  kind: LootRewardKind
  rarity: LootRarity
  amount: number
  label: string
}

export interface LootToastView {
  id: number
  rarity: LootRarity
  title: string
  detail: string
}
```

Runtime state:

```ts
type LootPickupState = 'burst' | 'idle' | 'magnet'

interface LootPickup {
  root: THREE.Group
  reward: LootReward
  state: LootPickupState
  velocity: THREE.Vector3
  age: number
  idleAge: number
  active: boolean
  serial: number
}
```

### Reward effects

| Kind | Effect |
| --- | --- |
| `coins` | Add `amount` to `gold`. |
| `medicine` | Heal by `amount`, capped at `maxHealth`; if already full, convert to half `amount` gold, rounded up. |
| `whetstone` | Add `amount` to `damage`, capped at `LOOT_DAMAGE_CAP`; excess converts to `25` gold per unused point. |

All three resulting values are already represented by version-1 saves.

## 6. Drop table and eligibility

### 6.1 Eligibility

- Ordinary direct-player kill: `30%` chance.
- Commander direct-player kill: guaranteed, minimum `rare`.
- Champion event success: one guaranteed `legendary` reward at the event marker.
- Other event success: one guaranteed `uncommon` or better reward at the player.
- Event-owned ordinary enemies do not independently roll unless the event explicitly
  opts in.
- AI-vs-AI kills never roll.

### 6.2 Rarity roll for ordinary eligible kills

```text
common=62%
uncommon=27%
rare=9%
legendary=2%
```

### 6.3 Kind/value by rarity

| Rarity | Allowed rewards |
| --- | --- |
| Common | Coins `5..10` |
| Uncommon | Coins `12..20` or medicine `12..18` |
| Rare | Coins `28..42`, medicine `24..32`, or whetstone `+1` |
| Legendary | Coins `70`, medicine `45`, or whetstone `+2` |

Use a dedicated runtime `lootRng`; do not reuse event RNG sequencing or texture RNG.
Exact reward is fixed when spawned and cannot reroll while the pickup is active.

`LOOT_DAMAGE_CAP = 60` limits bonus whetstones only. Existing shop behavior is not
changed. If current damage is already at or above the cap, exclude whetstones from the
roll and choose another reward.

## 7. World presentation

### 7.1 Pooled pickup visual

Each pooled `THREE.Group` contains:

- a low-poly central token whose geometry indicates kind:
  - coin: short cylinder;
  - medicine: octahedron with a cross-shaped pair of boxes;
  - whetstone: elongated dodecahedron/prism;
- one vertical beam plane pair, crossed at 90 degrees;
- one ground ring;
- optional second ring for rare/legendary;
- a small starburst sprite above legendary drops.

Geometry and materials are shared by kind/rarity. No per-pickup light or canvas texture is
created. Beam and ring materials use `MeshBasicMaterial`, `transparent:true`,
`depthWrite:false`, `toneMapped:false`.

Rarity shape language:

| Rarity | Beam | Rings | Pulse |
| --- | --- | --- | --- |
| Common | 1.6 units | one smooth ring | none |
| Uncommon | 2.6 units | one broken/segmented ring | slow |
| Rare | 4.2 units | two rings | alternating scale |
| Legendary | 6.5 units | two rings + starburst | strong, capped |

Colors derive from the application palette and must be tested in both themes:
common off-white, uncommon success, rare link/accent, legendary warning.

### 7.2 State machine

**Burst (`0..0.45 s`)**

- Spawn at the actor's pre-corpse death position plus `0.4` Y.
- Apply small radial/upward velocity.
- Use gravity and ground clamp; collision with world walls is not required.
- Token scales from `0.2` to `1`.

**Idle**

- Ground at absolute `LOOT_Y` because the current navigable world is flat.
- Bob with deterministic phase; rotate central token only.
- Beam fades to full opacity over 120 ms.
- At age 15 seconds, begin magnet regardless of distance so bonuses are not quietly
  wasted during normal play.

**Magnet**

- Trigger when player is inside `LOOT_MAGNET_RADIUS` after burst or at forced magnet age.
- Use damped acceleration toward player chest, with a maximum speed.
- Collect inside `LOOT_COLLECT_RADIUS`.
- Do not use teleporting lerp coefficients that vary by frame rate.

### 7.3 Pool pressure

`LOOT_MAX_ACTIVE = 20`.

When eligible loot is requested at capacity:

1. settle the oldest active common pickup immediately;
2. recycle that entry for the new reward;
3. if no common exists, settle the oldest lowest-rarity entry;
4. always show a compact collection burst/card for the settled reward.

Never discard a rolled reward silently.

## 8. Collection and UI card

`collectLoot(pickup, reason)`:

1. applies the fixed reward exactly once;
2. marks the pickup inactive before invoking callbacks;
3. hides/resets its meshes;
4. spawns one bounded collection burst;
5. plays one loot cue when audio spec 06 exists, otherwise the current `coin` cue;
6. sets `lootToast` and forces `emitView(true)`.

Add required `GameView.lootToast: LootToastView | null`.

The React layer renders one `loot-toast` card for 2.4 seconds:

- rarity label and shape icon;
- reward name;
- exact result, for example `Урон 31 -> 32`, `+18 золота`, or
  `Здоровье 62 -> 80`;
- no comparison buttons or interaction;
- a monotonic `id` lets the same reward text restart the card.

Engine time owns visibility: store `lootToastExpiresAt`, clear it in `update()`, and force
one view emission on clear. Do not schedule React timeouts that can outlive an engine
instance.

## 9. Save, pause, and end behavior

- `save()` calls `settleActiveLoot('save')` before constructing `SavedGame`, applying all
  active rewards and clearing their visuals. The resulting gold/health/damage are stored
  by the existing version-1 fields.
- Pausing freezes burst, bob, magnet, and toast expiry with the rest of world simulation.
- Victory settles active loot before final view/result calculation.
- Defeat does not settle active bonus loot; inactive bonuses are run-local risk.
- Return to menu/destroy clears runtime pickups without callbacks.
- `setPaused(true)` does not hide active beams; they remain as frozen world state.
- No active pickup or toast is serialized.

## 10. File-level changes

| File | Changes |
| --- | --- |
| `src/game/types.ts` | `LootRarity`, `LootRewardKind`, `LootReward`, `LootToastView`, and required `GameView.lootToast`; no `SavedGame` change. |
| `src/game/GameEngine.ts` | Drop RNG/table, eligibility hooks, pooled pickup creation/update/collection/settlement, reward application, view field, and lifecycle. |
| `src/App.tsx` | `createInitialView().lootToast`, one noninteractive reward card, and rarity labels/icons. |
| `src/App.css` | Rarity-safe card styles, shape markers, enter/hold/exit animation, and reduced-motion fallback. |

Optional integrations:

- spec 01 may register loot groups as outlined interactables;
- spec 06 may replace the fallback coin cue with layered reveal/collect cues.

Neither is a prerequisite.

## 11. Tuning constants and budgets

```text
LOOT_DROP_CHANCE=0.30        LOOT_MAX_ACTIVE=20
LOOT_BURST_TIME=0.45         LOOT_FORCE_MAGNET_AGE=15
LOOT_MAGNET_RADIUS=5.5       LOOT_COLLECT_RADIUS=0.8
LOOT_MAGNET_ACCEL=34         LOOT_MAGNET_MAX_SPEED=22
LOOT_TOAST_TIME=2.4          LOOT_Y=0.34
LOOT_DAMAGE_CAP=60
```

Budget:

- at most 20 active pickup groups;
- no dynamic point lights;
- shared geometry by reward kind and shared materials by rarity;
- at most one active React loot card;
- no allocations after the 20-entry pool and shared resources are warm.

## 12. Accessibility and readability

- Every rarity has a text label and a distinct ring/beam silhouette.
- The toast uses the same high-contrast panel primitives as existing notices and does not
  rely on bloom.
- Reduced motion removes bobbing, rotation, and card translation; beam/ring opacity and
  static shapes remain.
- The card appears below critical health/objective information and never captures focus.
- Collection does not require precise interaction or a prompt; magnet/forced settlement
  prevents inaccessible tiny pickups.
- Medicine conversion at full health is stated in the card rather than silently changing
  reward kind.

## 13. Edge cases

- A direct player kill already grants base gold. Bonus coins must not replace or duplicate
  that fixed reward.
- Event-owned actors follow the event's explicit drop policy to prevent dozens of event
  bonuses.
- Collection and save settlement can race in one frame; marking inactive before applying
  reward guarantees exactly-once credit.
- If the player is dead while a pickup magnetizes, stop movement and leave defeat cleanup
  to clear it.
- If a medicine reward would heal zero, conversion uses the original amount, not missing
  health.
- If a whetstone partially exceeds the bonus cap, apply the usable points and convert only
  the remainder.
- Pool recycling settles before overwriting `reward`.
- A dropped actor may already have moved to corpse Y; use the death position copied at the
  start of `killActor()`.

## 14. Acceptance criteria

- [ ] Eligible direct-player kills roll bonus loot without changing existing base kill or
      event rewards.
- [ ] Common, uncommon, rare, and legendary drops are identifiable without color or bloom.
- [ ] Pickups transition burst -> idle -> magnet -> collected with frame-rate-independent
      movement and exactly-once reward application.
- [ ] Coin, medicine, and whetstone rewards correctly update existing gold, health, and
      damage fields, including conversion/cap cases.
- [ ] Saving settles all active pickups before serializing; reloading the version-1 save
      retains every settled reward and requires no migration.
- [ ] Pool pressure never discards a reward and active pickups never exceed 20.
- [ ] The collection card reports the exact before/after value, is engine-timed, does not
      capture input, and has a reduced-motion fallback.
- [ ] Defeat, victory, pause, return-to-menu, and repeated engine creation leave no active
      callbacks or leaked WebGL resources.
- [ ] Production build, oxlint, drop-distribution test, reward boundary tests, save/reload
      check, and 20-drop stress capture pass.

## 15. Future inventory threshold

Do not extend this system into equipment until all of the following are specified:

- item identity and deterministic generation;
- inventory/equipment capacity;
- comparison and replacement UX;
- shop/salvage economics;
- `SavedGame` v1 -> v2 migration and rollback behavior;
- actor/player stat ownership beyond the current scalar `damage`.

## 16. Effort

**2-3 days.** The world visual is modest. Exactly-once reward settlement, save behavior,
pooling, rarity readability, conversion boundaries, and UI lifecycle carry most of the
implementation and test cost.
