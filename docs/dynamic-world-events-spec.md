# Dynamic World Events & Varied Objectives

> Design spec for КОРОВАНЫ. Fully client-side — no backend, no new art assets.
> Reuses the existing actor, particle, marker, notice, and input systems.

## 1. Goal

Add an **optional, time-boxed event layer** on top of the fixed 3-step objective
chain (`createObjectives`). Events spawn procedurally as the player roams, grant
extra gold / loot / buffs, and make repeat runs feel alive — without touching the
win condition (`updateMission`).

## 2. Current baseline (reference)

| System | Location | Notes |
| --- | --- | --- |
| Objectives | `createObjectives` in `types.ts`; `completeObjective`, `incrementObjective`, and `updateMission` in `GameEngine.ts` | Fixed per faction; victory when all objectives are `done`. |
| Caravan | `updateCaravan`, `interact`, and `spawnAmbush` in `GameEngine.ts` | Single mover; +95 gold; 40 s cooldown. |
| Markers | `emitView` in `GameEngine.ts` | `MapMarker.kind` = `player \| ally \| enemy \| caravan \| landmark \| objective`. |
| Helpers | `seededRandom`, `spawnActor`, `callbacks.onNotice` | Available for reuse. |

## 3. Event catalog (5 kinds)

| Kind | Setup | Success condition | Reward | Fail |
| --- | --- | --- | --- | --- |
| `richCaravan` | Spawn a gilded caravan variant + 3-enemy escort; marker. | Rob it via proximity `interact`, then move at least 18 m from the robbery point before the 25 s timer expires. | +180 gold | Player defeat or timer → caravan escapes, no event gold. |
| `defendHome` | Pick a tracked village house, attach fire/smoke FX, and spawn 4 event attackers with that house as their AI target. The house is an event target with 100 hp. | Kill all attackers within 45 s while house hp remains above 0. | +90 gold and restore 8 health, capped at 100. | House hp reaches 0 or timer expires → house "burns" (flavor), no reward. |
| `champion` | Spawn 1 elite roaming actor (hp 260, aura). | Kill the champion. | +120 gold and +6 damage, up to a cumulative **+18 champion damage per run**. At the cap, only gold is granted. | None; persists until killed or the run ends. |
| `rescue` | Spawn a captive ally guarded by 2 enemies; marker. The captive starts with combat disabled and is not squad-eligible. | Kill both guards **or** `interact` next to the living captive. | Transfer the captive out of event ownership, enable normal ally AI, and make it squad-eligible. | Captive killed → fail. |
| `bounty` | Mark a living hostile non-critical actor, excluding commanders, captives, and actors owned by another event. If none is eligible and one actor slot is free, spawn a dedicated target. | Kill the marked enemy within 40 s, regardless of killer. | +70 gold | Timer → a spawned target despawns; an existing target is only unmarked and resumes normal AI. |

Kind selection is **faction-weighted** (e.g., guard sees more `defendHome`, elf more
`richCaravan`, villain more `champion`).

## 4. Scheduler

A lightweight state machine in `update()`:

- First event fires when the first main objective is completed, or at
  `elapsed ≈ 50 s` if the player keeps roaming without completing one.
- **Max 1 active event** at a time.
- After an event ends: `eventCooldown` 60–90 s (seeded jitter) before the next.
- Uses a dedicated `eventRng = seededRandom(seed)`. If the seed derives from the date,
  this dovetails with a future daily-challenge feature; a random seed is fine standalone.
- Do not start a new event after victory / defeat or when only the final main objective
  remains. An already-active event may continue; victory / defeat cancels it without reward.
- Build the weighted pool from kinds that are currently eligible and fit within
  `MAX_ACTORS`. If no kind is eligible, retry after 10 s instead of consuming the normal
  60–90 s cooldown.

## 5. Data model (`types.ts`)

```ts
export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

export type WorldEventKind =
  | 'richCaravan' | 'defendHome' | 'champion' | 'rescue' | 'bounty'

export interface WorldEventView {
  id: string
  kind: WorldEventKind
  title: string
  description: string
  tone: NoticeTone
  progress?: number
  target?: number
  timeRemaining?: number   // seconds; omitted for untimed (champion)
}

// GameView: add  activeEvent: WorldEventView | null
// MapMarker.kind: add 'event'
export type ActorRole = /* existing… */ | 'champion' | 'captive'

// Optional v1 fields; old v1 saves remain valid.
// SavedGame: add eventCooldown?: number
// SavedGame: add championDamageBonus?: number
```

**Save / load:** events are transient — **not** persisted. `SavedGame` stays
**version 1** because the new fields are optional. Save the current `eventCooldown`; when
saving during an active event, save `EVENT_COOLDOWN_MIN` instead, so reloading cannot
replace an abandoned event immediately. On load:

```ts
eventCooldown =
  savedGame?.eventCooldown ??
  Math.max(0, FIRST_EVENT_AT - (savedGame?.elapsed ?? 0))
```

An in-progress event is abandoned on save/quit. Persist `championDamageBonus` so the
+18 cap remains correct across saves; old v1 saves default it to 0.

## 6. Engine changes (`GameEngine.ts`)

New internal type + fields:

```ts
interface WorldEvent {
  id: string
  kind: WorldEventKind
  state: 'active' | 'succeeded' | 'failed'
  title: string
  description: string
  tone: NoticeTone
  timer: number | null          // null = untimed
  progress: number
  target: number
  markerId: string
  markerPos: THREE.Vector3
  ownedActorIds: string[]       // event-spawned actors removed on cleanup
  ownedProps: THREE.Object3D[]  // event-created props/FX removed on cleanup
  update?(delta: number): void  // movement, prop damage, escape/flee checks
  onKill?(actor: Actor, context: ActorKillContext): void
  onInteract?(): boolean        // returns true if handled
  cleanup(): void               // idempotent
}

interface ActorKillContext {
  killerFaction: Faction
  directPlayerKill: boolean
}

interface EventPropTarget {
  object: THREE.Object3D
  hp: number
  maxHp: number
  position: THREE.Vector3
}

private activeEvent: WorldEvent | null = null
private eventCooldown: number
private championDamageBonus: number
private readonly villageHouses: THREE.Group[] = []
private readonly eventRng = seededRandom((Date.now() % 2147483646) + 1)
```

Methods:

- **`updateEvents(delta)`** — called in `update()`: invoke the active event's `update`,
  decrement its timer, and detect success/fail. On resolve, use one central
  `finishEvent(result)` path to apply the reward once, play sound, show a notice, run
  idempotent cleanup, clear `activeEvent`, and set cooldown. When idle and cooldown ≤ 0,
  call `startRandomEvent()`. Event callbacks only update event state; they never remove
  actors inline, so cleanup cannot mutate `actors` during combat iteration.
- **`startRandomEvent()`** — weighted pick via `eventRng`, dispatch to a
  `startXxxEvent()` builder. Filter ineligible kinds and preflight all required actor
  slots before choosing.
- **Five builders** (`startRichCaravanEvent`, `startDefendHomeEvent`,
  `startChampionEvent`, `startRescueEvent`, `startBountyEvent`) — spawn actors/props
  (reuse `spawnActor`, a `createCaravan` variant, particle smoke), set marker pos,
  timer, and event callbacks. Event-specific closure state handles the rich-caravan
  robbery/escape phases, house hp, captive transfer, and whether a bounty target was
  spawned or borrowed.
- **Actor event metadata:** extend `Actor` / `spawnActor` options with
  `objectiveEligible`, `squadEligible`, and an AI mode (`normal`, `captive`,
  `attackEventProp`). Defaults preserve current actors. Event-spawned combatants use
  `objectiveEligible:false`; captives additionally use `squadEligible:false` and
  `captive` AI until rescued.
- **House targeting:** retain non-shop houses in `villageHouses`. `attackEventProp`
  actors prioritize the event target over normal aggro, move into melee range, and
  damage `EventPropTarget.hp` on their attack cooldown. The house itself is borrowed,
  never added to `ownedProps`, and never disposed; only attached event FX are owned.
- Hook **`killActor`**: pass `{ killerFaction, directPlayerKill }` to
  `activeEvent.onKill` after normal objective-credit evaluation but before the existing
  indirect-kill early return. Event success is based on the target actor's death and is
  not gated on `directPlayerKill`.
- Hook **`interact()`**: before the vendor/caravan checks,
  `if (this.activeEvent?.onInteract?.()) return` (handles `rescue` proximity and
  `richCaravan` loot).
- Hook **`updatePrompt()`** with the same precedence so nearby captives and the rich
  caravan show an `[E]` prompt.
- **`emitView`**: push the event marker (`kind:'event'`, with `label`) and set
  `view.activeEvent`.
- **Rewards:** gold via `this.gold`; healing via
  `this.health = Math.min(100, this.health + 8)`; champion damage via
  `Math.min(6, CHAMPION_DAMAGE_CAP - championDamageBonus)`. A rescued captive is the
  existing actor, not a second spawn: remove its id from `ownedActorIds`, switch it to
  normal AI, and set `squadEligible:true`.
- **Smoke/fire:** a `spawnSmokeParticle()` helper on an interval (reuse `particles` +
  `updateParticles`).
- **`playSound`**: add `'event' | 'eventWin' | 'eventFail'`.
- **Cleanup helpers:** add an idempotent `removeActorById()` that removes projectiles
  sourced by that actor, clears other actors' `targetId` references, removes and disposes
  the mesh, and splices the actor from `actors`. Event cleanup applies it only to
  `ownedActorIds`; borrowed bounty targets and rescued allies remain. Remove and dispose
  every `ownedProps` entry. Call active-event cleanup from `destroy()` before the final
  scene traversal.
- **Campaign isolation:** `creditFactionObjective` ignores actors with
  `objectiveEligible:false`. An existing bounty target retains its original eligibility,
  so killing it may still advance a main objective exactly as it would without the event.

## 7. UI (`App.tsx`)

- New **`EventBanner`** component (top-center, or below `ObjectiveList`): shows
  `activeEvent.title`, description, a countdown from `timeRemaining`, and a progress bar
  (`progress / target`). Color by `tone`. Pulse when `timeRemaining < 10`.
- **`MiniMap`**: render `kind === 'event'` markers with a distinct color + star/flag
  glyph; add a legend entry in `map-legend` and matching CSS.
- Feed `view.activeEvent` from `onView`; no new callbacks needed (events are
  engine-driven).
- Notices (existing `onNotice`) announce start / success / fail — already supported.

## 8. Tuning constants

```
FIRST_EVENT_AT=50       EVENT_COOLDOWN_MIN=60   EVENT_COOLDOWN_MAX=90
EVENT_RETRY=10          MAX_ACTIVE=1            MAX_ACTORS=25
CHAMPION_DAMAGE_CAP=18
durations: richCaravan=25  defendHome=45  bounty=40  champion=∞
required actor slots: richCaravan=3  defendHome=4  champion=1  rescue=3
                      bounty=0 for existing target, otherwise 1
rewards: per §3
```

## 9. Edge cases

- An event target killed by a **third faction** still resolves; `onKill` runs before the
  indirect-kill return and receives kill context for notices/future rules.
- Player leaves the area during `defendHome` → attackers still attack the house; only
  clearing them before the timer or house destruction succeeds.
- Victory / defeat mid-event → force-cleanup, no reward.
- Save during an active event → event is dropped, a 60 s cooldown is saved, and no
  markers or actors survive reload.
- **Actor budget:** before starting a kind that needs `requiredSlots`, require
  `actors.length + requiredSlots <= MAX_ACTORS` (25). Event cleanup splices all owned
  actors so their slots are reusable.
- **Bounty safety:** objective-critical actors are never eligible. Existing targets are
  not owned or despawned; spawned fallback targets are objective-ineligible and removable.
- Champion damage stacks to +18 per run and remains capped after save/load.
- An unrescued captive neither counts toward `view.squad` nor follows commands. A rescued
  captive counts once and obeys the `commandSquad` toggle.
- Killing event-spawned actors never advances campaign objectives. A borrowed bounty
  target keeps its pre-existing campaign behavior.

## 10. Acceptance criteria

- [ ] If at least two main objectives remain and actor capacity is available, an event
      triggers within ~1 min; only one is active at a time; cooldown/retry rules are enforced.
- [ ] Each of the 5 kinds spawns, tracks progress/timer, and resolves with the correct reward/penalty + notice + sound.
- [ ] `defendHome` attackers damage the tracked house even when the player leaves; rescue
      keeps the captive out of the squad until success; bounty never removes a commander.
- [ ] Event marker appears on the minimap with a legend entry; `EventBanner` shows a live countdown / progress.
- [ ] Killing / interacting advances events via the existing `killActor` / `interact` hooks (no duplicate logic).
- [ ] Event actors/props/projectiles are removed from scene and owning arrays on resolve /
      destroy; borrowed actors/props survive; actor count never exceeds 25.
- [ ] Old and new v1 saves load; active events are abandoned with a safe cooldown;
      champion damage remains capped; no TS / oxlint errors; 60 fps with events active.

## 11. Effort

**~1.5–2 days.** The 5 builders, scheduler, and cleanup discipline are the bulk; the
`defendHome` fire/smoke and the `EventBanner` are the fiddly bits.
