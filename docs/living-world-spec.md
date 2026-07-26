# Living World: autonomous world simulation

> Design spec for КОРОВАНЫ. Fully client-side — no backend, no new art assets.
> Reuses the existing region, actor, event, marker, notice, and particle systems.
> Assumes Phase 0 (legacy four-zone removal) has landed: generated 5×5 runs are the
> only world path, and `generatedWorld` / `generatedBlueprint` are non-nullable.

## 1. Goal

Today the world only exists where the player is standing. Nothing happens unless the
player is present to watch it happen.

This spec adds a **world that keeps running without the player**: factions push front
lines at each other, beasts come out of the forest and burn settlements, caravans travel
real roads and get intercepted, and NPCs fight, break, and rally on their own.

Five layers, each independently shippable:

| Layer | Name | Summary |
| --- | --- | --- |
| 1 | **Хроника** (Chronicle) | Data-only tick over all 25 regions. No meshes, no actors. **Implemented.** |
| 2 | **Materialization** | Chronicle events become 3D only when the player is near. **Implemented.** |
| 3 | **Fauna** | Beasts and civilians as non-playable allegiances. **Implemented.** |
| 4 | **NPC AI** | Perception, morale, threat scoring, flanking, commander orders. |
| 5 | **Ambient life** | Civilians, wildlife, campfires — cheap, highly visible. |

This spec covers **Layers 1, 2 and 3 in implementation detail** and fixes the contracts
that Layers 4–5 build on.

## 2. Current baseline (reference)

| System | Location | Notes |
| --- | --- | --- |
| Region streaming | `RegionManager` (`world/RegionManager.ts:106-112`) | `visibleRadius` and `simulationRadius` both default to `1`, so only a 3×3 neighbourhood of the 25 regions is ever simulated. |
| Region state | `RegionRuntime` (`world/RegionRuntime.ts:69-95`) | Owns runtime ids and a `deltaState` JSON bag; `extractDelta` / `applyDelta` persist it. |
| Territory | `WorldRegion.territory` (`world/worldTypes.ts:58-67`) | Written once by `WorldGenerator`; nothing writes it at runtime. |
| Site ownership | `WorldSite.owner` (`world/worldTypes.ts:88-94`) | Same — static blueprint data, no runtime entity. |
| Actor budget | `ActorBudget` (`world/ActorBudget.ts`) | `MAX_ACTORS = 25` split into reserved categories and enforced in one place. Was checked ad hoc at every spawn site. |
| Events | `updateEvents` / `startRandomEvent` / `finishEvent` | One player-anchored event plus `MAX_LOCATED_EVENTS` located ones; `eventCooldown` 50–70 s scaled by threat tier. |
| Event placement | `pickEventPosition()` / `pickLocatedEventPosition()` | Player-ring placement, plus a site- or region-anchored variant for chronicle events. |
| Threat waves | `updateThreat` / `spawnThreatWave` | Spawns hostiles in a 13 m ring around the player. |
| Actor AI | `updateActors` | Sense range 15 m (18 m archers); NPC-vs-NPC hunt radius 6.5 m (15 m archers); no morale. |
| Actor AI (decisions) | `ActorAi` (`world/ActorAi.ts`) | Target selection, pack morale and player-pursuit gating as pure functions, so a headless harness can exercise the code the game runs. Movement and collision stay in `GameEngine`. |
| Hostility | `ALLEGIANCE_RELATIONS` (`types.ts`) | A 5×5 matrix over `Faction | 'beast' | 'civilian'`. Replaced `hostile(a, b) => a !== b`. |
| Caravan | `updateCaravan` | Patrols the generated road network between two patrol anchors. |
| Determinism | `RandomStream` + `deriveSeed` | Five gameplay streams: `combat`, `director`, `event`, `loot`, `chronicle`. |
| Save | `ActiveRunSaveV3` (`run/runTypes.ts`) | Includes `regionDeltas`, `directorState`, `eventState`, `chronicleState`, `rngStates`. |

## 3. Design rules

1. **The chronicle is data, not objects.** It never touches `THREE`, the scene graph,
   the navmesh, or the actor list. This is what makes simulating all 25 regions free.
2. **The player is an observer, not a trigger.** A raid resolves whether or not the
   player shows up. Arriving late means finding the aftermath — literally: `aftermath`
   is a Layer 2 event kind.
3. **Determinism is not negotiable.** Shareable seeds are a headline feature. The
   chronicle uses its own derived stream and is asserted in tests.
4. **Consequences must be legible.** Every chronicle outcome maps to something the
   player can see: a recoloured map region, a burned settlement, shop prices, or the
   composition of the next encounter.

## 4. Layer 1 — «Хроника»

### 4.1 Tick

A fixed-step accumulator in `update()`, after `updateThreat()`:

```
CHRONICLE_TICK_SECONDS = 8
```

`updateChronicle(delta)` accumulates `delta` and runs whole ticks. Each tick is
O(regions + roadConnections) — roughly 25 + 40 iterations of scalar arithmetic. Never
per-frame.

### 4.2 Per-region state

Because backward compatibility is not required, this is a **first-class typed field**
on `RegionDelta`, not an untyped entry in `deltaState`. `REGION_DELTA_VERSION` is
bumped to `2`; saves that fail normalization are discarded, not migrated.

```ts
// world/Chronicle.ts, re-exported from world/RegionRuntime.ts
export interface RegionChronicleState {
  control: Territory                  // mutable; seeded from blueprint.territory
  pressure: Record<Faction, number>   // 0..1 military pressure
  beastPressure: number               // 0..1
  settlementIntegrity: number         // 0..100, aggregate over the region's settlement sites
  supply: number                      // 0..1, drives shop stock and prices
  lastEventTick: number
}

export interface RegionDelta {
  version: 2
  // …existing fields…
  chronicle: RegionChronicleState
}
```

`settlementIntegrity` covers every civilian site in the region —
`CHRONICLE_SETTLEMENT_SITE_KINDS = ['settlement', 'shop', 'recovery']`. A generated
world contains exactly one of each, so a region without one simply stays at `100`.

`RegionManager.getRegionChronicle` / `setRegionChronicle` are the read/write seam; the
engine keeps the live map and flushes it into the deltas inside `saveGeneratedRun()`.

### 4.3 World-level state

Cross-region data that belongs to no single region lives in a new `chronicleState`
block on the run save, alongside `directorState` and `eventState`. The run save becomes
`ActiveRunSaveV3` (`ACTIVE_RUN_SAVE_VERSION = 3`); the storage key is unchanged so a
stale v2 blob is read, rejected, and reported rather than silently orphaned.

```ts
export interface ChronicleCaravan {
  id: string
  ownerFaction: Faction
  fromSiteId: SiteId
  toSiteId: SiteId
  regionPath: RegionId[]
  progress: number        // 0..1 along regionPath
  intact: boolean
}

export interface ChronicleEvent {
  id: string
  tick: number
  kind: 'regionCaptured' | 'beastRaid' | 'settlementBurned' | 'caravanLost' | 'caravanArrived'
  regionId: RegionId
  faction: Faction | null
  siteId: SiteId | null
}

export interface ChronicleState {
  tick: number
  factionStrength: Record<Faction, number>   // 0..1
  caravans: ChronicleCaravan[]
  log: ChronicleEvent[]                      // bounded ring buffer, newest last
}
```

`log` is capped at `CHRONICLE_LOG_LIMIT = 40` entries so the save stays bounded. The log
stores **structured** events, not sentences: the Russian copy is rendered from
`content/gameCopy.ts` when the view is built, so wording can change without a save bump.

### 4.4 Tick rules

All rolls use `chronicleRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))`,
whose state is persisted in `rngStates.chronicle` exactly like the four existing streams.
`tickChronicle()` is a pure function of `(blueprint, state, regions, rng, environment)`,
so an identical seed and environment sequence always replays an identical history.

> **Environment caveat.** Neither environment input is random, and neither depends on a
> display setting. `nightFactor` is `computeNightFactor(elapsed)`; `stormFactor` is the
> rain + snow share of a weather mix that always lerps toward
> `WEATHER_BY_ZONE[biome under the player]`. Both live in `world/WorldEnvironment.ts`,
> which `GameEngine` also uses to drive rendering, so simulation and visuals cannot
> drift apart. `dynamicDayNight` and `weatherEnabled` gate **rendering only** — turning
> either off for performance leaves beast pressure, raids, and every other chronicle
> outcome exactly as they were. `tests/worldEnvironment.test.ts` asserts a byte-identical
> chronicle history across all four toggle combinations, with a negative control so the
> assertion cannot pass vacuously.
>
> (`weatherRng`, the one `Date.now()` seed in `GameEngine`, feeds `randomWeatherRange`
> only, which times cosmetic lightning flashes and thunder claps. It never reaches the
> weather mix or the chronicle.)
>
> What does still track the player: the weather mix is a per-frame lerp, so `stormFactor`
> depends on the route walked and on frame pacing. A chronicle history therefore replays
> exactly for a given seed *and* playthrough, not across arbitrary playthroughs of the
> same seed. That is inherent to anything that reacts to where the player walks.
> `tickChronicle()` itself is pure and is asserted to be bit-identical for a fixed seed
> and environment sequence in `tests/chronicle.test.ts`.

**1. Faction fronts.** Pressure grows toward `factionStrength[faction]` in regions a
faction controls and decays elsewhere. For each road segment in `blueprint.roads` the
attacker's `pressure` in the source region is compared against the defender's in the
target region; the defender also loses `PRESSURE_ATTRITION` per hostile neighbour, so a
region surrounded by enemies is ground down rather than deadlocked. When attacker
pressure exceeds defender pressure by `CONTROL_FLIP_MARGIN` a weighted roll flips
`control` and logs `regionCaptured`. A region that just changed hands or was raided is
immune for `CONTROL_FLIP_COOLDOWN_TICKS`, which also prevents a region flipping twice in
one tick. `factionStrength` is `STRENGTH_BASE` plus a share of the map held plus, for
the player's faction, a share of completed objectives — so the campaign and the
chronicle reinforce each other rather than running in parallel.

**2. Beast pressure.** Grows per tick in `forest` and `fort` biomes, scaled up at night
(`computeNightFactor(elapsed)`) and during `rain` / `snow` weather, and decays by
`BEAST_CONTROL_DECAY` in regions under faction control. Above `BEAST_RAID_THRESHOLD` it
triggers a `beastRaid` against a settlement in that region and resets to
`BEAST_RAID_RESET`.

**3. Settlement integrity.** A raid — faction or beast — drops
`settlementIntegrity`. At `0` the settlement is `разорено`: its shop and recovery
functions go offline, its prefab reads as burned, and `settlementBurned` is logged.
Integrity regenerates slowly after `SETTLEMENT_CALM_TICKS` without an event, but a
region that reached `0` stays razed for the rest of the run.

**4. Caravans.** Each tick, caravans advance `progress` along their `regionPath`.
**Entering** a region whose `control` is hostile to the caravan's owner, or whose
`beastPressure` is at least `CARAVAN_BEAST_THRESHOLD`, rolls an interception — a quiet
friendly corridor is simply safe. A lost caravan sets `intact = false` and reduces the
destination region's `supply`; arrivals raise it. New caravans spawn along road
connections that touch a trading site (settlement, shop, healer) when fewer than
`CHRONICLE_CARAVAN_LIMIT` are in transit.

### 4.5 Effects the player can feel

| Chronicle state | Player-visible effect |
| --- | --- |
| `control` | Minimap territory colour; `WorldMapRegion.territory` reads chronicle control instead of blueprint territory. |
| `control` | Encounter faction composition: a flipped region's encounter plans are rebuilt against its new owner before it is next simulated. |
| `beastPressure` | Frequency of beast encounters (Layer 3) — ambient prowlers above `AMBIENT_BEAST_PRESSURE`, raid packs above `MATERIALIZE_BEAST_PRESSURE` — and caravan interception risk. |
| `settlementIntegrity` | Scorched prefab, offline shop/recovery, hatched map tile, Layer 2 `aftermath`. |
| `supply` | Shop prices scale by `1 + (1 - supply) * SUPPLY_PRICE_SWING`, surfaced as `GameView.shopPriceMultiplier`. |
| `log` | «Хроника» feed entries, notices, and map overlays. |

### 4.6 UI

- **News feed.** `App.tsx` previously had only transient `Notice` toasts that expire
  after 4.3 s and no history. A compact, collapsible **«Хроника»** panel now sits under
  the minimap, fed by `GameView.chronicle`, showing the most recent entries with their
  map square. Only events in **discovered** regions are shown, so it doubles as a
  fog-of-war reward — an unexplored world starts with an empty feed by design.
- **Map overlays.** Regions on a front line — control differing from a road-connected
  neighbour — get a hatched overlay and crossed swords; razed regions get a scorched
  tint and a flame. Both reuse the existing `generated-map-region` grid.
- **Notices.** High-salience chronicle events (a region flipping control, a settlement
  burning, a caravan lost) in a discovered region also raise a normal `onNotice`,
  capped at two per tick batch.

### 4.7 Copy

All player-facing strings are Russian, in the established register: dry, dark, faintly
absurd, censored. Anchored in original spec motifs — «корованы», «домики деревяные»,
«надо слушаться командира» — rather than generic fantasy-war phrasing.

Examples:

```
Квадрат C3 отжали: теперь там охрана дворца. Местным объяснили, что надо слушаться нового командира.
Корован до точки «Лавка» не доехал: в квадрате D2 его ограбили раньше пользователя.
В квадрате B2 зверьё осмелело. Местные предпочитают не выходить.
```

Chronicle copy lives in `content/gameCopy.ts` next to `createGeneratedObjectiveText`,
not hardcoded in `GameEngine.ts` the way the five existing event builders are.
`describeChronicleEvent` picks between phrasings using a stable hash of the event id, so
a given seeded history always reads the same way.

## 5. Contracts fixed now for Layers 2–5

> **Status.** §5.1 and §5.2 landed with Layer 2. §5.3 landed with Layer 3.

### 5.1 Actor budget allocator

The ad-hoc `actors.length + n <= MAX_ACTORS` checks scattered across the engine are gone.
`world/ActorBudget.ts` owns the cap:

```ts
type ActorBudgetCategory = 'squad' | 'campaign' | 'chronicle' | 'ambient'

const ACTOR_BUDGET: Record<ActorBudgetCategory, number> = {
  squad: 3,
  campaign: 8,
  chronicle: 8,
  ambient: 6,
}

const ACTOR_BUDGET_PRIORITY = ['squad', 'campaign', 'chronicle', 'ambient'] // high → low
```

The four reserves add up to `MAX_ACTORS` exactly, and that is asserted in
`tests/actorBudget.test.ts`.

- `reserve(category, count)` is all-or-nothing and returns whether it succeeded;
  `reserveUpTo` grants a partial reservation for callers that can scale down (threat
  waves, caravan ambushes).
- **A category may only borrow from the spare capacity of *lower*-priority ones.** That
  single rule is what makes `ambient` yield its slots first: it is last in priority, so
  it has nothing to hide behind, while `squad` and `campaign` keep a guaranteed floor.
- When free capacity is not enough, the allocator calls back into the engine
  (`yieldActorSlots`) asking the lowest-priority categories, in order, to give actors up.
  The engine hands whole located events back to the chronicle before plucking individual
  fighters out of one — half a raid is worse than no raid.
- `GameEngine` re-derives the ledger from the live actor list on every reservation
  (`actorUsageByCategory`), so it cannot drift out of sync with the scene.
- `spawnActor` is the hard gate. `ActorSpawnOptions.budget` is **required**, so the
  compiler refuses an uncategorised spawn, and `claimActorSlot` evicts the least
  important actor rather than let `actors.length` pass `MAX_ACTORS`.

### 5.2 Located events

`pickEventPosition()` — the 22–38 m player ring — is unchanged and still used by
`richCaravan`, `champion`, `rescue`, and `bounty`: those events are *about* the player.
`pickLocatedEventPosition(siteId, regionId)` is the new variant. It anchors on a site,
falls back to the region centre, scatters within `LOCATED_EVENT_SCATTER`, and refuses a
spot closer than `LOCATED_EVENT_MIN_DISTANCE` for its first twelve attempts, so the world
visibly acts somewhere other than underfoot. If the site really is underfoot, the fight
simply comes to the player. `defendHome` was already site-placed and stays that way.

`MAX_ACTIVE` is now **one player-anchored event plus `MAX_LOCATED_EVENTS` located ones**.
`WorldEvent` gained `anchor`, `regionId`, `situationId`, `slots`, and an optional
`handBack()`. The engine keeps `activeEvents[]`; kills, prompts, interactions, and map
markers fan out across all of them, while the HUD banner shows the player-anchored event
if there is one and otherwise the nearest located one.

## 5A. Layer 2 — Materialization

### 5A.1 What the chronicle holds back

The chronicle already refuses to act in a simulated region (`frozenRegionIds`), because
the player must never watch a building change state from thin air. `world/Materialization.ts`
names what that leaves pending. It is pure — no `THREE`, no scene, no actors, no RNG — so
the dependency runs one way: materialization consumes chronicle output, never the reverse.

`findPendingMaterializations()` returns situations sorted by urgency, ties broken on a
stable id so the same world state always yields the same order:

| Kind | Fires when | Becomes |
| --- | --- | --- |
| `factionRaid` | A road-connected neighbour's pressure beats the simulated region's by `MATERIALIZE_RAID_MARGIN`, the region is not a campaign anchor, and it still has a settlement. | Three attackers assaulting the settlement, two defenders on it. |
| `caravanAmbush` | A chronicle caravan is rolling through a simulated region that is hostile ground or above `CARAVAN_BEAST_THRESHOLD`. | A cart, two escorts, two raiders. The player can rob it. |
| `warband` | A simulated region held by a faction hostile to the player sits above `MATERIALIZE_WARBAND_PRESSURE`. | A three-strong patrol holding the square. |
| `aftermath` | A simulated region is already razed and its aftermath has not been shown this run. | Scorch, smoke, and two looters picking over the ashes. |
| `beastRaid` | Layer 3. A simulated region's `beastPressure` is above `MATERIALIZE_BEAST_PRESSURE`, it still has an intact settlement, and it is past the post-event cooldown. | A wrecker and its escorts against the settlement's two-strong garrison. |

`beastRaid` was **deliberately not materialized in Layer 2.** It needed beasts, and
beasts needed §5.3's `Allegiance` matrix — a wolf is not a faction. Re-skinning a faction
squad as "beasts" would have been a lie in the save, in the minimap colours, and in
`hostile()`. Beast raids therefore stayed chronicle-only until Layer 3, which added them
as a fifth kind (§5B.3); the Layer 2 test that asserted one could never appear now asserts
that one does.

### 5A.2 De-materialization is not cancellation

A located event whose region stops being simulated — or whose `LOCATED_EVENT_TIMEOUT`
expires — is **handed back**, not deleted. `handBack()` folds whatever was still standing
into chronicle state through pure functions in `Chronicle.ts`:

- `resolveMaterializedRaid` rolls the winner from the surviving share of each side, flips
  control (never for a campaign anchor), damages the settlement, and logs `regionCaptured`
  — or, if the attackers are spent, `raidRepelled`. Wiping out one side skips the roll
  entirely, so a fight the player finished resolves deterministically. Either way the
  assault force is paid for out of the **source** region's pressure
  (`RAID_SOURCE_SPEND_WON` / `RAID_SOURCE_SPEND_REPELLED`) — that is the number the front
  is measured on, so winning a raid actually pushes the front back instead of putting the
  same fight straight back on the board.
- `resolveMaterializedCaravan` writes off a caravan whose escort is gone and logs
  `caravanLost`; an intact one simply rejoins its route in `state.caravans`.
- `resolveMaterializedWarband` scales the faction's pressure in the square by how much of
  the warband survived. Nothing is logged: nothing happened that the chronicle would have
  written down on its own.

`findFactionRaids` also honours `lastEventTick` / `CONTROL_FLIP_COOLDOWN_TICKS`, exactly
as `resolveFronts` does, so a square that was just fought over gets the same breathing
room whether the chronicle or the player settled it.

The same functions run when the player *does* finish the fight, so a raid resolves the
same way whether or not anybody watched. `ChronicleEventKind` gains `raidRepelled`; the
«Хроника» feed and the map overlays pick it up with no further work.

> **A hand-back must not re-decide a fight the player watched end.** `resolveLocatedEventOutcome`
> calls `handBack()` **unconditionally**, on success and on failure alike, and the
> resolvers roll a winner from the surviving share of each side. That is only safe while
> an event's failure condition already implies the outcome the roll would produce.
>
> `factionRaid` satisfies that **by construction, not by design**: it fails when
> `defenderStrength === 0`, so `resolveMaterializedRaid` rolls `chance(1)` and cannot
> disagree. Nothing enforces the property — **change `factionRaid`'s failure condition to
> anything that does not imply a wiped defence and this bug reappears silently.**
>
> Layer 3 hit exactly that. `beastRaid` fails when the *settlement* falls, which is
> decoupled from the garrison's survival — the homestead can burn while the soldiers are
> off chasing wolves — so the hand-back re-rolled and, measured across the realistic
> configuration, contradicted the player about three times in four. The failure is worse
> than a silent state bug because the symptom is *narrative*: the feed congratulated the
> player on holding a settlement they had just watched burn, which teaches them the
> chronicle lies. The fix is §5B.3's rule that a decided outcome is passed as a decided
> outcome, never as live survivor counts.

The hand-back roll uses the seeded `event` stream, not `Math.random()`, so materialization
and its outcome replay identically for a given seed and route.

### 5A.3 Copy

Layer 2 copy lives in `content/gameCopy.ts` alongside the chronicle phrasings —
`describeLocatedEvent`, `describeLocatedEventStart`, `describeLocatedEventOutcome`,
`describeEventHandback`, and `WORLD_EVENT_FAILURE_MESSAGES`, which moved out of
`GameEngine.ts`. Same register as Layer 1:

```
В квадрате C3 набигают: охрана дворца пришли за домиками.
Корован до точки «Лавка» не доедет. Забери груз сам, пока это делают за тебя.
Пользователь ушёл из квадрата C3. Чем там кончилось — прочитаешь в хронике.
```

### 5.3 Allegiance

`hostile(a, b) => a !== b` cannot express wildlife, civilians, or truces. Replace it:

```ts
export type Allegiance = Faction | 'beast' | 'civilian'

export const ALLEGIANCE_RELATIONS:
  Record<Allegiance, Record<Allegiance, 'hostile' | 'neutral' | 'friendly'>>
```

`Faction` deliberately stays the three playable sides. It carries a spawn point, a
signature ability, an objective graph, event weights, and a brand colour — a wolf has
none of those, and widening `Faction` would force meaningless rows in every one of
those tables.

**Implemented, with one amendment.** The design pass said `Actor` would *gain*
`allegiance`, defaulting to its `faction`. In the code `Actor.faction` was **replaced**
by `Actor.allegiance` instead. Keeping both would have left every wolf carrying a
faction it does not belong to, which is exactly the lie §5.3 exists to prevent, and two
fields that must agree are two fields that can drift. Every one of the twenty-one call
sites that read `actor.faction` wanted the allegiance; the two that genuinely need a
`Faction` — achievement kill stats and the faction brand colour — narrow with
`isFactionAllegiance()`. `achievements.recordKill` now takes `Faction | null` so a beast
counts as a kill without being tallied against one of the three sides.

The matrix is symmetric today. One-sided aggression — a civilian that flees rather than
fights — is Layer 4/5 *behaviour*, not a relation, so nothing here needs to be lopsided
yet. `tests/allegiance.test.ts` asserts the matrix is total, symmetric, self-friendly,
and that the three factions still regard each other exactly as `a !== b` did.

Everything hostility-shaped routes through it: targeting (`findNearestEnemy`,
retaliation, NPC-vs-NPC hunting), projectile eligibility, friendly fire, ally alerting,
actor separation spacing, minimap marker colour and the `faction-ring` under each actor,
kill attribution and rewards.

`civilian` exists in the matrix and is wired through it, but Layer 3 spawns none: the
ambient civilians that make it visible are Layer 5's job.

## 5B. Layer 3 — Fauna

### 5B.1 What a beast is

Beast *species* are `ActorRole`s, not allegiances: `wolf | boar | bear | troll`. A role
is what a thing does in a fight, which is exactly the axis they differ on, and it means
they inherit the whole existing actor pipeline — poise, stagger, knockback, hit
reactions, corpses, gore, health bars, outlines — without a parallel system.

`world/Fauna.ts` is the pure half, the same shape as `Chronicle.ts` and
`Materialization.ts`: no `THREE`, no scene, no actor list, every roll on a seeded
`RandomStream`.

| Role | Profile | Behaviour |
| --- | --- | --- |
| `wolf` | 42 hp, fastest, lowest poise | Pack hunter. **Routs** when less than half its pack is still standing *and nearby* — pulling one wolf away from the pack breaks it as surely as killing the pack does. |
| `boar` | 70 hp, mid poise | **Charger.** Winds up for `BOAR_CHARGE_WINDUP`, then commits to a straight line it cannot steer, so it can be side-stepped. Never routs. |
| `bear` | 135 hp, 74 poise | The brute profile with fur: slow, heavy, and the wrecker a forest raid leads with. |
| `troll` | 165 hp, 88 poise | **Prop-wrecker.** Spawns in `attackEventProp` mode and takes the settlement apart at roughly twice a raider's rate. Leads a raid in `fort` biomes. |

`planBeastPack()` sizes the party from `beastPressure`: a wrecker always leads (a beast
raid that cannot hurt the settlement is just wildlife), escorts are wolves until the
forest is loud enough to send boars, and the plan is **trimmed to fit** the actor budget
rather than refused.

### 5B.2 Meshes

Procedural quadrupeds from the same `BoxGeometry` / `ConeGeometry` primitives and
`ComicMaterialLibrary.createToonMaterial` the humanoids use — no external assets, no new
art pipeline. `createBeast()` reuses the humanoid **pivot names** (`body-pivot`,
`torso-pivot`, `head-pivot`, `pelvis-pivot`, `leftArm` / `rightArm` for the front legs,
`leftLeg` / `rightLeg` for the hind ones, `faction-ring`). That is what lets
`animateCharacter`, the death motion, limb detachment, the outline pass and the health
bar keep working with no beast branch: the stride that swings a soldier's arms swings a
wolf's legs, and because front-left shares a sign with hind-right it comes out as a
diagonal quadruped gait rather than a hopping one.

### 5B.3 `beastRaid` materializes

`beastRaid` was the one situation Layer 2 deliberately refused to fake, and
`tests/materialization.test.ts` asserted it never appeared. That assertion is now
inverted rather than deleted: Layer 3 must produce it, and only under the conditions
that justify it.

`findBeastRaids()` fires in a simulated region above `MATERIALIZE_BEAST_PRESSURE` that
still has an intact settlement and is past the usual post-event cooldown. The margin
below `BEAST_RAID_THRESHOLD` is the same idea as `MATERIALIZE_RAID_MARGIN`: the player
should meet the pack, not the wreckage. Unlike a faction raid it has no attacker faction
and no source region — beasts march from nowhere and hold no ground.

`resolveMaterializedBeastRaid()` is the hand-back, and runs whether the player walked
out or finished the fight. Beasts that win chew the settlement and reset pressure to
`BEAST_RAID_RESET`; beasts that are driven off drop it to `BEAST_RAID_REPELLED_RESET` —
lower, because a raid the chronicle resolved on its own only fed them. Control never
changes and no faction's pressure moves, because beasts do not hold ground.
`ChronicleEventKind` gains `beastsRepelled`; the «Хроника» feed and map overlays pick it
up with no further work.

**A settlement that has already fallen is handed back as `defenderStrength: 0`, not as a
live survivor count.** This is the rule the §5A.2 warning exists for: `beastRaid` fails
when the homestead is destroyed, which says nothing about how many of the garrison are
still upright, so passing the live count let the chronicle roll a *different* winner than
the one the player just watched. The stake of a beast raid is the settlement, not the
garrison's lives — once it is down the defence has lost however many soldiers survived.
`tests/materialization.test.ts` hammers 24 rng states to prove a decided outcome cannot be
overturned, with a control asserting that an *abandoned* raid — the one case where nobody
decided anything — is still genuinely rolled.

**The guard `findFactionRaids` has and `findBeastRaids` deliberately does not.**
`findFactionRaids` skips chronicle-protected regions because a faction raid can *flip
control*. A beast raid cannot: `resolveMaterializedBeastRaid` never touches `control` or
any faction's pressure, and campaign completability is protected by `isProtectedSite`
shielding the anchor sites themselves, not by the region list. The guard would therefore
be unreachable code implying a coverage it does not provide.

### 5B.4 Ambient prowlers

The cheap, always-on half: one beast at a time in a square the chronicle says is loud
(`AMBIENT_BEAST_PRESSURE`), on the **`ambient`** budget so it yields its slot the moment
a real fight needs the room, and removed when its region streams out. Suppressed while a
`beastRaid` is running — two sources of beasts at once reads as an infestation rather
than a world. Raid packs are charged to **`chronicle`**, like every other located event.

### 5B.5 Copy

`describeLocatedEvent('beastRaid')`, the `beastsRepelled` chronicle phrasings, and
`describeBeastProwler()` live in `content/gameCopy.ts` with everything else:

```
Из леса в квадрате B2 полезло зверьё. Домики деревяные пока стоят.
Зверьё из квадрата B2 погнали обратно в лес. Домики деревяные пока деревяные.
В квадрате C4 что-то ходит по кустам и не платит за проход.
```

## 6. Tuning constants

Spec constants, unchanged from the design pass:

```
CHRONICLE_TICK_SECONDS=8        CHRONICLE_LOG_LIMIT=40
CONTROL_FLIP_MARGIN=0.18        PRESSURE_GROWTH=0.06     PRESSURE_DECAY=0.03
BEAST_GROWTH_FOREST=0.05        BEAST_GROWTH_FORT=0.04   BEAST_NIGHT_MULTIPLIER=1.6
BEAST_STORM_MULTIPLIER=1.3      BEAST_RAID_THRESHOLD=0.75
SETTLEMENT_RAID_DAMAGE=[18,34]  SETTLEMENT_REGEN=1.5     SUPPLY_PRICE_SWING=0.45
CHRONICLE_CARAVAN_LIMIT=3       CARAVAN_INTERCEPT_BASE=0.12
DEFEND_HOME_MAX_DISTANCE=95
```

Constants added while implementing Layer 1, because the design pass left the rules
underspecified once real numbers were plugged in:

```
PRESSURE_ATTRITION=0.015        CONTROL_FLIP_COOLDOWN_TICKS=3
STRENGTH_BASE=0.25              STRENGTH_TERRITORY_SHARE=0.45
STRENGTH_OBJECTIVE_SHARE=0.3
BEAST_CONTROL_DECAY=0.02        BEAST_RAID_RESET=0.35
SETTLEMENT_CALM_TICKS=4
SUPPLY_BASELINE=0.6             SUPPLY_DRIFT=0.04
SUPPLY_CARAVAN_GAIN=0.14        SUPPLY_CARAVAN_LOSS=0.19
CARAVAN_HOSTILE_RISK=0.18       CARAVAN_BEAST_RISK=0.2
CARAVAN_BEAST_THRESHOLD=0.5     CARAVAN_PROGRESS_PER_TICK=0.18
CHRONICLE_MAX_CATCHUP_TICKS=8   CHRONICLE_FEED_LIMIT=8
```

Without `PRESSURE_ATTRITION` the fronts deadlock: every faction's pressure converges on
its own `factionStrength`, so the gap never reaches `CONTROL_FLIP_MARGIN` and no region
ever changes hands until the player has completed most of the campaign.

Constants added by Layer 2:

```
ACTOR_BUDGET={squad:3,campaign:8,chronicle:8,ambient:6}   MAX_ACTORS=25
MAX_LOCATED_EVENTS=2            MATERIALIZE_INTERVAL=6
LOCATED_EVENT_MIN_DISTANCE=26   LOCATED_EVENT_MAX_DISTANCE=150
LOCATED_EVENT_SCATTER=9         LOCATED_EVENT_TIMEOUT=150
THREAT_WAVE_EVENT_RADIUS=45
MATERIALIZE_RAID_MARGIN=CONTROL_FLIP_MARGIN*0.6           MATERIALIZE_WARBAND_PRESSURE=0.32
RAID_SOURCE_SPEND_WON=0.5       RAID_SOURCE_SPEND_REPELLED=0.35
EVENT_REQUIRED_SLOTS={factionRaid:5,caravanAmbush:4,warband:3,aftermath:2}
LOCATED_EVENT_REWARDS={factionRaid:110,caravanAmbush:140,warband:80,aftermath:45}
```

`MATERIALIZE_RAID_MARGIN` is deliberately *below* `CONTROL_FLIP_MARGIN`: the player should
meet the fight, not the result of it. `MATERIALIZE_WARBAND_PRESSURE` sits just under the
`0.35` a faction starts with in a region it controls, so walking into hostile territory
reliably produces a patrol — and `resolveMaterializedWarband` cuts a wiped warband's
pressure to `0.3×`, well below the threshold, so it takes the chronicle a dozen ticks to
put another one there.

Constants added by Layer 3:

```
BEAST_PROFILES={wolf:{hp:42,speed:5.4,poise:26,dmg:9,rout:0.5},
                boar:{hp:70,speed:4.6,poise:46,dmg:14},
                bear:{hp:135,speed:3.4,poise:74,dmg:21},
                troll:{hp:165,speed:2.9,poise:88,dmg:24}}
BEAST_SENSE_RANGE=21            BEAST_LEASH_RANGE=52
WOLF_PACK_RADIUS=16             BEAST_ROUT_SECONDS=9
BOAR_CHARGE_RANGE=14            BOAR_CHARGE_WINDUP=0.55
BOAR_CHARGE_SPEED=11.5          BOAR_CHARGE_DURATION=1.05
BOAR_CHARGE_COOLDOWN=4.5        BOAR_CHARGE_DAMAGE=22
MATERIALIZE_BEAST_PRESSURE=BEAST_RAID_THRESHOLD-0.12                 (=0.63)
BEAST_RAID_REPELLED_RESET=0.18  BEAST_RAID_DEFENDERS=2
EVENT_REQUIRED_SLOTS.beastRaid=5    LOCATED_EVENT_REWARDS.beastRaid=95
AMBIENT_BEAST_PRESSURE=0.45     AMBIENT_BEAST_LIMIT=2
AMBIENT_BEAST_RADIUS=62         AMBIENT_BEAST_INTERVAL=11
```

Beasts sense further than soldiers look (21 m against 15) and hunt across the whole
square rather than waiting to be walked into — without that a raid pack mills around the
settlement instead of reaching its garrison. `MATERIALIZE_BEAST_PRESSURE` sits below
`BEAST_RAID_THRESHOLD` for the same reason `MATERIALIZE_RAID_MARGIN` sits below
`CONTROL_FLIP_MARGIN`.

## 7. Edge cases

- **Fog of war.** Chronicle events in undiscovered regions still happen; they are just
  not shown. Discovering a region reveals its current state, not its history.
- **Player's own region.** The chronicle never flips control of, or burns a settlement
  in, a region that is currently simulated — Layer 2 materializes that as a real fight
  instead, so the player never watches a building change state from thin air. Beast
  pressure still accumulates there, so the reckoning waits for them to leave.
- **Campaign safety.** `faction-start` and `final-stronghold` sites are never destroyed
  and their regions never flip, so a generated campaign always remains completable.
  `WorldValidator` asserts that every mapped start and finale region is in
  `getChronicleProtectedRegionIds`, so weakening the protection list breaks the
  500-seed campaign test rather than shipping silently.
- **Victory / defeat.** The chronicle stops ticking when the run ends.
- **Save during a chronicle tick.** Ticks are atomic within one `update()` call, so a
  save always captures a coherent state.
- **`defendHome` regression.** Phase 0 found that this event could never fire in
  generated mode: it selected from `villageHouses`, which only the deleted legacy world
  builder ever populated, and the eligibility filter excluded it outright. It now
  targets the nearest generated `settlement` site within `DEFEND_HOME_MAX_DISTANCE`.
  Layer 2 supersedes it with chronicle-driven `factionRaid`; Layer 3 adds `beastRaid`
  alongside it.
- **Walking out mid-fight.** A located event is handed back, not cancelled, and the
  chronicle logs who won. The player sees «Пользователь ушёл из квадрата C3…» and finds
  the consequence in the feed and on the map.
- **Save during a materialized fight.** Events are not persisted; the save keeps only the
  cooldown, exactly as before. On load the chronicle state still describes the same
  pending situation, so the fight simply materializes again rather than being lost.
- **Budget starvation.** A located raid holding all eight chronicle slots blocks a
  player-anchored event until it resolves; `getEligibleEventKinds` reports this honestly
  instead of spawning a half-populated event. The director's threat waves are suppressed
  only while a fight is within `THREAT_WAVE_EVENT_RADIUS`, so distant world events do not
  starve it.
- **Reservations have side effects.** `reserveActorSlots` can make lower-priority
  categories give actors up, so it must only be called once a spawn is definitely going
  to happen — never as a cheap pre-filter in a loop that may skip the spawn.
- **Actors that change hands.** A rescued captive joins the squad permanently, so
  `rescueCaptive` moves it to the `squad` category. An actor that outlives the event that
  spawned it must be re-categorised, or it eats that event's budget for the rest of the
  run and stays evictable as if it were still a bystander.
- **Beasts and the campaign.** A beast raid never flips control and never touches faction
  pressure, so no amount of wildlife can make a generated campaign uncompletable. Campaign
  anchors are chronicle-protected against beast raids exactly as they are against faction
  ones, and `tests/beastEncounters.test.ts` replays 150 chronicle ticks across five seeds
  asserting no anchor is ever razed.
- **Beasts do, however, slow the war down.** Not through pressure but through
  `lastEventTick`: a settled beast raid gives its square the same
  `CONTROL_FLIP_COOLDOWN_TICKS` of immunity any other fight does, which measures out at
  about 11% fewer region captures over a long run (§9). This was not predicted — it was
  found by counting — and it is kept because a square that has just fought off a pack
  should not change hands in the same breath.
- **A pack that will not fit.** `planBeastPack` is trimmed to whatever the actor budget
  granted rather than refusing to spawn, but the wrecker is always first in the list, so a
  squeezed raid is a smaller raid and not a toothless one.
- **A wolf pulled away from its pack.** `beastPackShare` counts only pack-mates within
  `WOLF_PACK_RADIUS`, so a wolf that chased the player 20 m from its pack breaks as
  readily as one whose pack is dead. That is deliberate: it makes kiting a real tactic
  rather than a way to fight the pack one at a time for free.
- **A charge into scenery.** The boar cannot steer mid-charge, so a charge that stops
  making progress ends there and goes on cooldown instead of grinding along the wall.
- **The wolf rout rule is currently unreachable in shipped content.** Measured at zero
  routs across 120 fights of the two compositions `planBeastPack` builds (§9). The rule is
  correct and fires reliably in an all-wolf pack; it is the *content* that never presents
  one, because every pack leads with a wrecker that outlives its escorts and cannot break.
  Making it reachable is a balance decision, not a bug fix, so it is recorded here rather
  than changed unilaterally: the candidates are letting a wolf measure its pack share over
  wolves alone, relaxing `routThreshold` to fire at exactly half, or building packs that
  are sometimes wolves-only.

## 8. Acceptance criteria

- [x] The chronicle ticks over all 25 regions regardless of player position, at a
      measured cost under 1 ms per tick, with no per-frame cost.
- [x] Region control changes hands over a long run; the minimap reflects it; encounter
      composition in a flipped region matches its new owner.
- [x] Beast pressure rises at night and in storms and falls under faction control, and
      does so identically whether or not day/night and weather are being rendered.
- [x] A settlement can be reduced to `разорено`; its shop and recovery go offline and
      its prefab reads as burned.
- [x] Losing caravans raises prices at the destination settlement.
- [x] The «Хроника» feed shows recent events for discovered regions only.
- [x] The same seed produces an identical chronicle history over a fixed tick count.
- [x] Chronicle state survives save → load through `RegionDelta.chronicle` and
      `ChronicleState`; malformed saves are rejected, not migrated.
- [x] Campaign start and finale regions never flip and their sites are never destroyed;
      500 seeded campaigns remain completable. `WorldValidator` asserts that every
      campaign anchor region is chronicle-protected.
- [x] Actor count never exceeds `MAX_ACTORS`; ambient actors yield first.
- [x] Chronicle events materialize only in simulated regions, at a site or region rather
      than in a ring around the player.
- [x] A player-anchored event and up to `MAX_LOCATED_EVENTS` located ones coexist without
      breaching the actor cap.
- [x] Leaving a region de-materializes its event back into chronicle state instead of
      cancelling it, and the chronicle records who won.
- [x] Materialization and its outcomes are seeded, so they replay for a given seed and
      route.
- [x] Hostility is decided by `ALLEGIANCE_RELATIONS`, not by comparing factions: beasts
      are hostile to all three sides and to civilians by the matrix rather than by
      accident, and civilians are hostile to nothing but the forest.
- [x] Beasts exist as `wolf` / `boar` / `bear` / `troll` with procedural quadruped meshes
      built from the existing primitives and `ComicMaterialLibrary` — no new assets.
- [x] A wolf pack routs when it breaks; a boar charges and cannot steer; a troll takes a
      settlement apart instead of fighting people.
- [x] `beastRaid` materializes and resolves back into chronicle state, and the Layer 2
      test that asserted it never could now asserts that it does.
- [x] Beasts never change who holds a square, and 500 seeded campaigns remain completable.
- [x] Beasts respect `MAX_ACTORS`: raid packs are charged to `chronicle`, prowlers to
      `ambient`, and both go through `claimActorSlot` like everything else.
- [x] `npm run build`, `npm run lint`, and `npm test` pass.

## 9. Effort

**Layers 1, 2 and 3: shipped.** In Layer 1 the tick rules and the save/versioning work
were the bulk; the feed and map overlays were the fiddly bits. In Layer 2 the actor budget
and the hand-back contract were the substance; unpicking the single-`activeEvent`
assumption threaded through the engine was the tedious part. In Layer 3 the §5.3 matrix
was a day's mechanical work across twenty-one call sites, and reusing the humanoid pivot
names for the quadrupeds saved the entire animation, death, gore and outline pipeline from
needing a beast branch.
Layer 4 ~3 days, Layer 5 ~1 day.

### Measured effect of Layer 3

Five seeds, 150 chronicle ticks each (~20 minutes of play), player walking a fixed loop of
settlement squares, night environment. Counted side by side rather than reasoned forward
from the rules — Layer 2 (`beastRaid` discarded) → Layer 3:

| Seed | Beast raids met | Raids off-screen | Settlements burned | Regions captured | Razed |
| --- | --- | --- | --- | --- | --- |
| fauna-1 | 0 → 9 | 13 → 11 | 2 → 1 | 22 → 20 | 2 → 1 |
| fauna-2 | 0 → 3 | 7 → 6 | 2 → 2 | 46 → 39 | 2 → 2 |
| fauna-3 | 0 → 7 | 12 → 13 | 2 → 2 | 28 → 25 | 2 → 2 |
| fauna-4 | 0 → 6 | 15 → 10 | 2 → 2 | 18 → 16 | 2 → 2 |
| fauna-5 | 0 → 3 | 6 → 5 | 1 → 1 | 14 → 14 | 1 → 1 |
| **total** | **0 → 28** | **53 → 45** | **9 → 8** | **128 → 114** | **9 → 8** |

Zero to 28. The Layer 2 column is a negative control, not a rhetorical one: it runs the
identical simulation with `beastRaid` situations discarded the way
`findPendingMaterializations` used to discard them, so if the measurement were picking up
anything other than the new code path it would score above zero too.

**Two of these numbers contradict what this section claimed before it was measured.**

The first draft asserted the two layers were uncoupled, on the evidence that faction raids
*offered* did not move (12 → 12). That metric was far too sparse — only one of the five
seeds produces faction raids at all. `regionCaptured`, which fires 128 times over the same
runs, shows the fronts measurably slow down: **128 → 114, about 11% fewer captures.** The
channel is `resolveMaterializedBeastRaid` writing `region.lastEventTick`, which
`resolveFronts` gates on through `CONTROL_FLIP_COOLDOWN_TICKS` — the same breathing room
§5A.2 already grants a square the player fought over. That is defensible design (a
settlement that just drove off a wolf pack is not overrun by an army in the same breath)
but it is a coupling, and the earlier text denied it.

Off-screen beast raids fall the same way, **53 → 45**, for the same reason: a square the
player settled does not come back up to the raid threshold as soon. Note `fauna-3` moves
the *other* way (12 → 13), so this is a tendency, not a law.

`tests/beastEncounters.test.ts` pins the explanation rather than asserting it, with a
third arm in which raids are offered but never handed back: captures then land on **128,
exactly the Layer 2 number**. That attributes the whole effect to the hand-back's write
rather than to the raid existing, and it will fail if anyone adds a second channel.

What did hold: settlements burned and squares razed both drift *down* (9 → 8), because a
beast raid the player wins is a settlement that survives.

### Measured effect of the per-frame AI

Layer 3 shipped with three claims about behaviour deliberately left unmeasured, because
they live in `GameEngine`'s per-frame AI and neither the chronicle harness nor browser
observation can reach them. `world/ActorAi.ts` now holds the decision half of that AI as
pure functions — target selection, pack morale, player-pursuit gating — with an
equivalence control in `tests/actorAi.test.ts` that re-implements the pre-extraction
engine code and asserts agreement over ~14,000 comparisons, plus a negative control
proving the comparison can detect a changed implementation. `tests/aiHarness.ts` drives
those real functions over seeded fights; `tests/aiQuestions.test.ts` answers the three
questions with 60 fights per arm.

**The harness models movement and contact.** No navmesh, collision, steering, separation,
terrain, wind-up, poise or stagger. Its numbers describe what the decision logic does, not
what a player experiences. All three answers came out differently from the prediction
written before the measurement.

**Q1 — does the wolf rout rule change how encounters end?** It works, and **it never fires
in either shipped raid composition.** Zero routs across 60 fights of `bear+wolf+wolf` and
60 of `troll+wolf+wolf`. The cause is a collision of two local rules: a wrecker has
135–165 hp against a wolf's 42, so it always outlives its escorts, and `routThreshold` is
`0` for bears and trolls — by the time half the pack is down, the only survivor is the one
role that cannot break. In an all-wolf pack the rule fires in **60 of 60** fights and
matters: beast deaths 180 → 120, one wolf escaping per fight, and the garrison losing 60 →
53 of its own because the fight ends sooner. But `planBeastPack` always leads with a
wrecker, so **the shipped game never routs a wolf.** `tests/aiQuestions.test.ts` pins the
zero, so if a composition change makes it fire, that test fails and this paragraph gets
revisited rather than silently rotting.

**Q2 — do beasts spend themselves on faction NPCs instead of the player?** No, and it is
not a tendency but a switch. `updateActors` evaluates player pursuit *before*
`findNearestEnemy`, so a beast that can sense the player ignores every NPC in the square.
Standing in the raid, **100% of beast attacks land on the player and zero on the
garrison**; beyond `BEAST_SENSE_RANGE`, **zero land on the player and 100% on the
garrison**. There is no middle. The prediction that beasts would divide their attention
was simply wrong.

**Q3 — what does beasts-being-hostile-to-all-three do?** It is what lets a beast raid end.
With the two arms identical in count, position and pack — only the matrix entry differing
— a garrison beasts are willing to fight destroys the pack and resolves the raid, while
one they ignore leaves the player as the only thing worth biting: **player damage 130,881
→ 6,658, a 20× reduction**, and beast deaths 0 → 180. Hostile-to-all-three is not flavour
in the table; without it a raid is an unbounded siege on the player alone.
