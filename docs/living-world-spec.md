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
| 4 | **NPC AI** | Perception, morale, threat scoring, flanking, commander orders. **Implemented.** |
| 5 | **Ambient life** | Civilians, wildlife, campfires — cheap, highly visible. |

This spec covers **Layers 1, 2, 3 and 4 in implementation detail** and fixes the contracts
that Layer 5 builds on.

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
| Actor AI (decisions) | `ActorAi` (`world/ActorAi.ts`) | Target selection, morale, alert acceptance and flanking ranks as pure functions, so a headless harness can exercise the code the game runs. Movement and collision stay in `GameEngine`. |
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
| `wolf` | 42 hp, fastest, lowest poise | Pack hunter. **Routs** when half or fewer of its *own kind* in the pack are still standing and nearby — kin, not pack, because a wolf takes courage from wolves and not from the troll beside it. Pulling one wolf away from the others breaks it as surely as killing them does. |
| `boar` | 70 hp, mid poise | **Charger.** Winds up for `BOAR_CHARGE_WINDUP`, then commits to a straight line it cannot steer, so it can be side-stepped. Never routs. |
| `bear` | 135 hp, 74 poise | The brute profile with fur: slow, heavy, and the wrecker a forest raid leads with. |
| `troll` | 165 hp, 88 poise | **Prop-wrecker.** Spawns in `attackEventProp` mode and takes the settlement apart at roughly twice a raider's rate. Leads a raid in `fort` biomes. |

`planBeastPack()` sizes the party from `beastPressure`: most raids lead with a wrecker (a
beast raid that cannot hurt the settlement is just wildlife), escorts are wolves until the
forest is loud enough to send boars, and the plan is **trimmed to fit** the actor budget
rather than refused. A `WOLF_PACK_CHANCE` share of raids arrive instead as a pure wolf
pack — all teeth, no siege engine — which reads differently and is where pack cohesion
matters most.

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

## 5C. Layer 4 — NPC AI

### 5C.1 Threat scoring replaces two rules at once

`world/ActorAi.ts` gains `selectThreat`, and the engine calls it instead of the pair it
used before. It replaces:

1. **Nearest-wins.** `selectCombatTarget` took the closest hostile and nothing else.
2. **The player override.** `updateActors` asked "can I see the player?" *before* it asked
   "is there anything to fight?", which §9 measured as a **step function at 21 m**: 100%
   of beast attacks on the player inside `BEAST_SENSE_RANGE`, 100% on the garrison outside
   it, nothing in between.

Both are now one scored pass over every hostile **and the player**. Cost is expressed in
metres, so each weight reads as "treats it as if it were this much closer"; lowest cost
wins:

```
cost = distance
     × (1 − wounded × (1 − hpFraction))     // finish what is nearly finished
     × (1 + crowd × alliesAlreadyOnIt)      // do not stack six deep on one target
     × rolePreference                        // player / backline / heavy
     × (locked ? THREAT_LOCK_BONUS : 1)      // hysteresis, so nobody dithers
```

`ThreatStyle` is the per-role table, and the deviations are the whole content of
role-aware targeting:

| Role | Behaviour |
| --- | --- |
| `archer`, `scout` | Shoot past the front rank at whoever is doing the damage; treat a brute walking up as a bad trade. |
| `brute`, `champion`, `bear`, `troll` | `wounded: 0`, `crowd: 0`, no preferences at all. "Prefers whatever blocks it" is the *absence* of the other terms, not an extra one. |
| `wolf` | The only **negative** `crowd` in the table: a pack piles onto one animal rather than spreading out. |
| everything else | Defaults. |

The player is deliberately **not** range-gated inside `selectThreat`.
`evaluatePlayerPursuit` has already decided whether they are a legal candidate at all, so
a tracked player 40 m away simply loses on cost to a soldier 4 m away — and beyond sense
range they are not a candidate, which is sight rather than targeting and is a different
thing from the step function. Retaliation still hard-overrides everything: hit an actor
and it comes for you regardless of what the scoring thinks.

`selectCombatTarget` is **kept and still exported.** A negative control that
re-implements the old rule only proves the re-implementation right; keeping the real
function callable means both arms of the Layer 4 measurements are shipped code.

### 5C.2 One morale rule, two doors

Layer 3 shipped pack cohesion for beasts; Layer 4 was asked for individual morale. Two
independent "should I run" systems on the same actor would fight each other, so
`evaluateMorale` is the single entry point and the two rules are two **reasons** rather
than two mechanisms:

- **Cohesion governs packs.** Unchanged, delegated to `shouldBeastRout`. A wolf counts
  wolves; losing half of them breaks it however healthy it is.
- **Individual morale governs individuals** — including a beast whose cohesion rule can
  never fire. The measured case is `bear+wolf+boar`: one wolf, kin size 1, share
  permanently 1, so cohesion correctly never breaks it (§9 measured 0 routs in 60 fights,
  and that was the right answer for a *cohesion* rule). Breaking a lone wolf standing over
  its dead bear is this half's job, and §9 now measures it doing so.

```
morale = 1 + resolve(role)
       − MORALE_WOUND × (1 − hpFraction)²          // superlinear: decides things at the end
       − MORALE_LOSSES × (1 − groupShare)
       − (commanderLost ? MORALE_COMMANDER_LOSS : 0)
       + (commanderNearby ? MORALE_COMMANDER_RALLY : 0)
break when morale ≤ 0
```

Solved against the threshold, a soldier with its group intact breaks just under **21%
hp** — the spec's "~25%" expressed as a curve rather than a cliff — or at half health
with half the local group on the ground.

**`groupShare` counts the bodies, not a remembered roster.** `localGroupShare` is
standing allies over standing plus fallen, within `MORALE_GROUP_RADIUS`. That needs no
state in the save, works for an actor however it was spawned, and measures exactly what
the player can see. The engine keeps corpses in the actor list for `CORPSE_LIFETIME`, so
it is a memory of *recent* losses — an hour-old battlefield should not still be breaking
people.

**`actorResolve` returning `null` is a hard gate, checked before either door.** It is
where campaign safety lives:

| Role | Why it can never break |
| --- | --- |
| `commander` | He is what rallies everyone else, and a campaign objective can require killing him. §7's rule that an objective must stay completable is enforced here, by construction. |
| `champion` | A boss that flees is not a boss. |
| `captive` | Not a combatant; the rescue event owns its behaviour. |
| `boar`, `bear`, `troll` | Layer 3 said "never routs" and that is still true. The answer comes from `BEAST_PROFILES[role].routThreshold`, not from a second copy of it here. |

**Where it runs to.** A broken **beast** runs from whatever broke it and, past the leash,
is gone — that is what makes breaking a pack a way to end a raid, and it is unchanged.
Anything else **falls back on `home`** and stays in the world the whole time: it can be
chased down, it can be rallied, and it comes back when its nerve returns. Nothing an
objective might need ever leaves the map because it lost a morale check. If the rally
point is already underfoot it gives ground to the nearest threat instead, because
standing still is not a rout.

**Rally.** A commander within `COMMANDER_ORDER_RANGE` clears a rout and grants
`MORALE_RALLY_SECONDS` of immunity. A rout that simply runs its clock out grants the same
immunity, and that recovery lives in `updateActorMorale` rather than in
`updateRoutingActor` — see §9, where putting it in the obvious place made it unreachable.

### 5C.3 Alert propagation

`alertCooldown` has been on `Actor` since long before this layer and only ever carried
"the player just hit me", which is why a wolf walking into a garrison woke exactly the
soldier it walked into. `announceSighting` now shares any *first* sighting with allies
within `ALERT_SIGHTING_RADIUS`, and `ActorAi.acceptsAlert` decides who takes it.

The one rule with substance: **an ally already holding a target of its own does not drop
it for hearsay.** Without it, one shout re-aims a whole square onto a single sighting and
every fight in earshot dissolves. The alert hands over the sighted *position*, not the
target id — being told where to look is realistic, being told what to attack is not, and
the recipient re-runs its own scoring when it gets there.

**The sighting lands in `alertPos` / `alertTimer`, not in `lastKnownTargetPos`.** That
distinction is the whole mechanism working rather than not: `lastKnownTargetPos` and
`aggroMemory` are the *player's* breadcrumb, and `updateActors` clears both on every frame
an actor is not pursuing the player — which is precisely the state a bystander being
shouted at is in. Writing the alert there left the entire feature inert except for
cancelling an idle timer, and in the one case the write survived (an actor already chasing
the player) it overwrote that actor's memory of where the player went. See §9.

### 5C.4 Commander orders

A commander stops being a stationary damage buff. He broadcasts a `SquadOrder` —
`hold` / `assault` / `escort` — to allies within `COMMANDER_ORDER_RANGE`, and the order is
what an ally does when it has nothing to fight, instead of wandering in a circle around
wherever it spawned. He picks it from what is in front of him: a prop his side is taking
apart means `assault`, otherwise he holds the ground he is on. Orders carry a timer rather
than being cleared on his death, so a squad keeps its last orders for a few seconds after
he falls.

His death applies `MORALE_COMMANDER_LOSS` to everyone who could see it and cancels any
rally he had just handed out.

**He keeps `speed: 0`, and that is a deviation from the prompt's sketch rather than an
oversight.** A commander who can move can walk off an objective site, and §7 says a
campaign objective must stay completable; he is also the fixed point a rally is measured
from. What made him furniture was the aura being his only output, not his feet. An
`escort` order from the caravan outranks a `hold` from a commander who happens to be
standing near the road.

### 5C.5 Flanking

With two or more allies on one target, the secondary attackers claim offset approach
angles instead of queueing on the same stop-distance ring. `engagementRank` gives a stable
rank by actor id — so it does not churn frame to frame, and a flanker dying promotes
everyone behind it — and `flankApproachAngle` maps rank to a slot.

**Every slot is inside ±66°, and that bound is load-bearing.** The offset rotates the
approach *direction*, so anything past a right angle gives a negative radial component:
the attacker walks away, the distance grows, the blend stays pinned at full, and it never
converges. The first draft of the ladder ran to ±135° and π; see §9.

`flankBlend` folds the offset away over the last few metres. Without it the offset point
rotates as fast as the attacker moves and the attacker orbits the target forever, which is
what a naive implementation does.

An event prop has no queue — nothing ranks itself against a barricade — so a prop attacker
takes rank 0 and comes straight in.

**This is the one Layer 4 mechanic the headless harness cannot measure.** Flanking is an
approach path, and an approach path needs the steering, separation and collision
`tests/aiHarness.ts` does not have. Its rules are tested as geometry in
`tests/actorAi.test.ts` and checked by eye in the browser; no number in §9 is about them.

### 5C.6 The caravan as an agent

The caravan stops being a moving prop:

- **Escort.** Two guards walk with the cart on a permanent `escort` order.
- **Panic.** Anything hostile within `CARAVAN_PANIC_RANGE` makes the driver whip the
  horses — `CARAVAN_PANIC_SPEED_MULTIPLIER` on the existing road path. Panic is speed, not
  a new route: the cart cannot leave the road network.
- **Vulnerability.** A hostile that reaches an unguarded cart takes it. That is a
  `caravanLost` for everyone, the player included: the cargo shrinks, the cooldown starts,
  and the notice says who ate it. A killed guard is not replaced for
  `CARAVAN_ESCORT_RESPAWN_DELAY`, or the replacement spawns inside the guard radius on the
  same frame and the cart can never actually be lost — see §9.

**Escorts are charged to `ambient`, deliberately.** It is the lowest-priority reserve, so
the moment a materialized raid or a threat wave needs the slots the guards are the first
thing given up (§5.1) — and a cart losing its escort because a settlement three hundred
metres away is burning is a better failure than a raid arriving two beasts short. It also
means the escort costs nothing at all when the player is nowhere near the road: the guards
are despawned outside `CARAVAN_ESCORT_RANGE` or when the cart's region stops being
simulated.

### 5C.7 What Layer 4 does *not* persist
Nothing here reaches the save. Morale timers, rout state, commander orders and the caravan
escort are all per-actor or per-frame combat state, and actors are not persisted — they
are respawned from chronicle and event state on load. `ACTIVE_RUN_SAVE_VERSION` and
`REGION_DELTA_VERSION` are therefore **unchanged at 3 and 2**. Bumping them for state that
is not written would be noise, and discarding everyone's run for it would be worse.

### 5C.8 Copy

`describeRout()`, `RALLY_NOTICE` and `describeCaravanPlundered()` live in
`content/gameCopy.ts` with everything else. Rout and rally notices are rate-limited to one
line per `MORALE_NOTICE_COOLDOWN` and only shown for what is within
`MORALE_NOTICE_RANGE` — a rout the player cannot see is a number, not a moment.

```
Стая посыпалась и ломанулась в лес. Договориться не вышло.
У кого-то сдали нервы: бежит и не оборачивается.
Командир наорал — беглец вернулся в строй. Дисциплина, чтоб её.
Корован обглодали без пользователя. Охрана лежит, груз в кустах, телега пустая.
Корован увели без пользователя. Охрану положили, груз растащили — приходи в следующий раз пораньше.
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
WOLF_PACK_CHANCE=0.3
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

Constants added by Layer 4:

```
THREAT_PROVOKED_BIAS=0.55       THREAT_LOCK_BONUS=0.8     THREAT_CROWD_FLOOR=0.35
THREAT_STYLES.archer={wounded:0.5,crowd:0.4,player:0.7,backline:0.7,heavy:1.45}
THREAT_STYLES.scout ={wounded:0.7,crowd:0.45,player:0.85,backline:0.8,heavy:1.2}
THREAT_STYLES.wolf  ={wounded:0.72,crowd:-0.22,player:1,backline:0.95,heavy:1.15}
THREAT_STYLES.boar  ={wounded:0.2,crowd:0.15,player:1,backline:1,heavy:1}
THREAT_STYLES.{brute,champion,bear,troll}={wounded:0,crowd:0,player:1,backline:1,heavy:1}
MORALE_WOUND=1.6                MORALE_LOSSES=0.7         MORALE_BREAK=0
MORALE_COMMANDER_LOSS=0.35      MORALE_COMMANDER_RALLY=0.45
ROLE_RESOLVE={commander:null,champion:null,captive:null,
              brute:0.45,soldier:0,minion:-0.1,archer:-0.12,scout:-0.18}
MORALE_GROUP_RADIUS=14          MORALE_CHECK_INTERVAL=0.35
MORALE_ROUT_SECONDS=7           MORALE_RALLY_SECONDS=12
MORALE_COMMANDER_SHOCK_SECONDS=10
MORALE_RALLY_POINT_TOLERANCE=3  MORALE_LAST_STAND_SECONDS=2
MORALE_NOTICE_RANGE=45          MORALE_NOTICE_COOLDOWN=9
ALERT_SIGHTING_RADIUS=20        (ALERT_COOLDOWN=1.5 unchanged)
ALERT_INVESTIGATE_SECONDS=12    ALERT_ARRIVAL_DISTANCE=3
FLANK_OFFSETS=[0,1.15,-1.15,0.62,-0.62,0.95]              FLANK_BLEND_DISTANCE=7
FLANK_MAX_ANGLE=1.2
COMMANDER_ORDER_RANGE=18        COMMANDER_ORDER_DURATION=6
COMMANDER_ORDER_TOLERANCE=3.5
CARAVAN_ESCORT_COUNT=2          CARAVAN_ESCORT_RANGE=90
CARAVAN_ESCORT_RESPAWN_DELAY=25
CARAVAN_PANIC_RANGE=16          CARAVAN_PANIC_SECONDS=4
CARAVAN_PANIC_SPEED_MULTIPLIER=1.7
CARAVAN_GUARDED_RANGE=7         CARAVAN_PLUNDER_RANGE=3.4
CARAVAN_PLUNDER_COOLDOWN=55
```

`MORALE_WOUND=1.6` is solved, not chosen: with the group intact and no commander either
way, `1 − 1.6 × (1 − h)² ≤ 0` at `h ≈ 0.21`, which is the "own hp below ~25%" the spec
asks for. `MORALE_LOSSES=0.7` then puts "half your health gone *and* your mates are dead"
just over the line while leaving a healthy actor standing over corpses in the fight.

`THREAT_CROWD_FLOOR` exists for `wolf`'s negative `crowd`: without a floor a large enough
pack would drive the multiplier to zero and every wolf would fixate on one animal forever.

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
- **A wolf with no kin never breaks *by cohesion*.** Cohesion is measured over a beast's
  own species, so a lone wolf escorting a bear has a kin size of one and a share that is
  always `1`. That is deliberate: the rule is about pack cohesion, not about being
  outnumbered. Layer 4's individual morale is what breaks it instead (§5C.2), and §9
  measures that happening in every fight of the composition that used to produce zero.
  Ambient prowlers carry no `packId` at all and so answer only to the individual half.
- **Beast targeting was a step function, not a preference.** Layer 3's `updateActors`
  evaluated player pursuit before `findNearestEnemy`, so inside `BEAST_SENSE_RANGE` every
  beast attack went to the player and outside it none did (§9). Layer 4's `selectThreat`
  replaced it: the player is scored in the same pass as every NPC, and §9 measures the
  garrison's share going from zero to real.
- **A commander who breaks would strand the run.** A generated campaign objective can
  require killing a specific commander, so `actorResolve('commander')` is `null` and he
  cannot rout at all — enforced in the pure rule rather than by a check at the call site.
  Everything else that is not a beast falls back on `home` and stays in the world, so no
  actor an objective might need ever leaves the map because of a morale check.
- **A caravan escort that eats a raid's slots.** Escorts are charged to `ambient`, the
  lowest-priority reserve, so a materialized raid takes their slots rather than arriving
  short (§5.1). Losing the guards may well cost the cart — that is the intended trade, not
  a failure.

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
- [x] Targeting weighs distance, target health, role and how many allies are already on a
      target, and the §9 Q2 step function at `BEAST_SENSE_RANGE` is gone: inside sense
      range the split is a mix, and outside it the player is not a candidate at all.
- [x] One morale rule covers packs and individuals. Cohesion breaks a pack that has lost
      its own kind; individual morale breaks the lone wolf cohesion cannot, and anything
      hurt, alone, or that has just watched its commander fall.
- [x] Commanders and champions never rout, so an objective that requires killing one can
      never be stranded; a broken non-beast falls back on its rally point and stays in the
      world, where it can be run down or rallied.
- [x] A commander broadcasts a squad objective to nearby allies and his death is a morale
      event, rather than the aura being his only output.
- [x] A sighting of any hostile — not just the player — carries to allies in earshot, and
      an ally already fighting something does not drop it for hearsay.
- [x] Secondary attackers claim offset approach angles instead of queueing on one ring,
      and the offset folds away at contact so they converge rather than orbit.
- [x] The caravan has an escort that fights for it, bolts when something comes out of the
      treeline, and loses the cart when the escort loses. Escorts are charged to `ambient`
      and yield their slots first.
- [x] Layer 4 adds no persisted state, so no save or delta version changes.
- [x] 500 seeded campaigns remain completable.
- [x] `npm run build`, `npm run lint`, and `npm test` pass.

## 9. Effort

**Layers 1, 2 and 3: shipped.** In Layer 1 the tick rules and the save/versioning work
were the bulk; the feed and map overlays were the fiddly bits. In Layer 2 the actor budget
and the hand-back contract were the substance; unpicking the single-`activeEvent`
assumption threaded through the engine was the tedious part. In Layer 3 the §5.3 matrix
was a day's mechanical work across twenty-one call sites, and reusing the humanoid pivot
names for the quadrupeds saved the entire animation, death, gore and outline pipeline from
needing a beast branch.
Layer 5 ~1 day.

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

**Q1 — does the wolf rout rule change how encounters end?** As shipped it did not, because
it **never fired**: zero routs across 60 fights of `bear+wolf+wolf` and 60 of
`troll+wolf+wolf`. Two local rules collided. A wrecker has 135–165 hp against a wolf's 42,
so it always outlived its escorts and the last one standing was the one role with
`routThreshold: 0`; and morale measured over the *whole* pack could not reach the
threshold anyway, since a mixed pack escorts its wrecker with exactly two wolves and
losing one leaves a share of exactly `0.5`, which strict `<` rejects.

Layer 3's headline beast behaviour was therefore dead content. Three changes make it
reachable, and all three are needed — the first two were measured together and still
produced 0 routs until the third landed:

1. **Morale is kin-relative.** A wolf counts the wolves, not the troll beside it. This is
   the principled form as well as the effective one.
2. **`planBeastPack` sometimes builds pure wolf packs** (`WOLF_PACK_CHANCE = 0.3`) — all
   teeth and no siege engine, which reads differently and gives cohesion somewhere to
   matter.
3. **`shouldBeastRout` fires at `<=`, not `<`.** Load-bearing, not a rounding preference:
   without it a two-wolf escort can never break.

Measured after, 60 fights per arm, rout off → on:

| Composition | Routs | Defender deaths | Beast attacks |
| --- | --- | --- | --- |
| `bear+wolf+wolf` | 0 → 60 | 178 → 117 | 912 → 597 |
| `troll+wolf+wolf` | 0 → 60 | 180 → 106 | 835 → 590 |
| `wolf×3` | 0 → 60 | 60 → 53 | 642 → 586 |
| `wolf×4` | 0 → 120 | 119 → 60 | 1237 → 720 |
| `bear+wolf+boar` | 0 → 0 | 180 → 180 | 899 → 896 |

A raid that breaks up costs the settlement's defenders roughly a third fewer lives. The
last row is not a failure: that pack contains a single wolf, whose kin size is one and
whose share is therefore always `1`. It never had a pack to lose and correctly never
breaks — the rule is about cohesion, not about being outnumbered.

**Q2 — do beasts spend themselves on faction NPCs instead of the player?** No, and it is
not a tendency but a **step function**. `updateActors` evaluates player pursuit *before*
`findNearestEnemy`, so a beast that can sense the player ignores every NPC in the square.
Standing in the raid, **100% of beast attacks land on the player and zero on the
garrison**; beyond `BEAST_SENSE_RANGE`, **zero land on the player and 100% on the
garrison**. There is no middle. This is recorded as a finding rather than patched: it is
precisely what Layer 4's threat scoring exists to replace, and a measured "the current
rule is a step function at 21 m" is a better handover than "targeting could be smarter".

**Q3 — what does beasts-being-hostile-to-all-three do?** It is what lets a beast raid
*end*, and it looks like flavour while being load-bearing. With the two arms identical in
count, position and pack — only the matrix entry differing — a garrison beasts are willing
to fight destroys the pack and resolves the raid, while one they ignore leaves the player
as the only thing worth biting: **player damage 130,881 → 6,658, a 20× reduction**, and
beast deaths **0 → 180**. Without it a raid is an unbounded siege on the player alone.

### Measured effect of Layer 4

**Layer 4: shipped.** Threat scoring and morale were the substance; the tedious part was
that both live in `updateActors`, where the ordering of five branches *was* the behaviour.

Same harness, same caveat, sharpened: `tests/aiHarness.ts` runs the game's real decision
code but models movement and contact — no navmesh, collision, steering, separation,
terrain, wind-up, poise or stagger. **Every number below describes what the decision logic
does, not what a player experiences.** Both arms are shipped code: the Layer 3 arm calls
`selectCombatTarget` and the cohesion-only rout, which are still exported for exactly this
reason, and the Layer 4 arm calls `selectThreat` and `evaluateMorale`. 60 fights per arm.

**Nothing here is about flanking.** Flanking is an approach path and the harness has no
steering; §5C.5 says so at the mechanic and `tests/layer4Ai.test.ts` says so at the top.

#### The step function is gone

`bear+wolf+wolf` raiding a three-strong garrison, player standing in it, attacks by what
they landed on:

| Arm | On the player | On the garrison |
| --- | --- | --- |
| Layer 3 (`selectCombatTarget`, player first) | 358 | **0** |
| Layer 4 (`selectThreat`) | 3,000 | **600** |

Zero to six hundred. The Layer 3 column is kept as a live control rather than a memory: if
it ever stops being exactly zero, the two arms are no longer measuring what they claim to.

Beyond `BEAST_SENSE_RANGE` the player still takes **0** attacks in both arms, and that is
*not* the step function surviving — it is `evaluatePlayerPursuit` saying the player cannot
be seen. Sight and targeting are different rules and only the second one changed.

#### What that does to a fight

Same raid, player watching from six metres away instead of standing in it:

| Metric | Layer 3 | Layer 4 |
| --- | --- | --- |
| Damage taken by the player | 73,286 | **6,284** |
| Attacks on the garrison | 0 | 183 |
| Beast deaths | 60 | **116** |

**An 11.7× reduction in damage taken, and the raid now resolves.** The second number is
the cause of the first: under Layer 3 the beasts could not be killed by the garrison
because they never engaged it, so a player who stood aside watched an unbounded siege.
This was predicted before measurement as "beasts will divide their attention", which is
the same prediction §9 Q2 recorded as *wrong* for Layer 3 — it is right now only because
the rule it was wrong about has been replaced.

#### Morale

`bear+wolf+boar` — the composition §9 named above, whose single wolf has kin size 1 and
whose cohesion share is therefore permanently 1:

| Arm | Routs | By role | Beast deaths | Defender deaths |
| --- | --- | --- | --- | --- |
| Cohesion only (Layer 3) | **0** | — | 117 | 180 |
| Unified (Layer 4) | 240 | wolf 84, soldier 156 | 32 | 156 |

The wolf breaks in every fight, all of it through the individual door and none through
cohesion, and the boar and bear never break at all. Layer 3's 0 was the right answer for a
cohesion rule and stays the control; §5C.2's second half is what was missing.

Compositions with real kin still break by cohesion after the unification —
`bear+wolf+wolf` records 166 cohesion routs alongside 208 individual ones — which is the
assertion that would catch individual morale having quietly *replaced* Layer 3's rule
rather than joining it.

**Morale makes a fight decisive instead of mutually annihilating.** Two identical ranks of
four soldiers, 12 m apart:

| Arm | Survivors across 60 fights | Routs |
| --- | --- | --- |
| No morale | 2 (one man a side) | 0 |
| Morale | **240** (one side walks away whole) | 242 |

**Which** side wins is an artefact and is recorded as one. Fighters act in array order, so
whoever is listed first lands the first blow of each frame, and morale converts that
consistent half-frame edge into a rout. Swapping the listing order flips the winner
completely — 240 elf deaths and 0 guard deaths becomes 0 and 240 — so the claim is
decisiveness, not an advantage for anybody. `tests/layer4Ai.test.ts` asserts the swap.

#### Role preference and finishing the wounded

Three archers behind a brute that is standing in front of an enemy archer, attacks by the
role that took them:

| Arm | On the archer | On the brute | Ratio |
| --- | --- | --- | --- |
| Nearest-wins | 780 | 600 | 1.30 |
| Threat scoring | 959 | 478 | **2.01** |

And a healthy enemy beside a nearly-dead one at almost the same distance: both arms finish
the same two enemies on near-identical attack volume (423 vs 425 swings), but defender
deaths fall **60 → 5**. Killing the wounded one first removes an incoming attacker for the
rest of the fight — a change in outcome with no change in effort.

#### Two defects the measurements found

Both were implemented exactly as designed, passed a reading, and were wrong.

1. **`ROLE_RESOLVE` was a `Partial` read with `?? 0`.** `??` fires on `null`, so every
   "never breaks" entry became "breaks like a soldier": commanders and champions routed in
   **60 fights out of 60**, which would have stranded any objective that requires killing
   one. The table is now exhaustive over every non-beast role, so the compiler refuses a
   role with no answer, and `tests/actorAi.test.ts` asserts the `null` roles hold under
   inputs that break everything else — with a positive control that those same inputs do
   break everything else.

   **The general rule, which matters more than the bug.** `??` cannot distinguish *absent*
   from *deliberately null*, so **a `Partial` lookup read with `??` is a trap wherever the
   sentinel value carries meaning.** It collapses the two cases into the default and does
   it silently: the types are satisfied, the reading looks right, and the only symptom is
   behaviour nobody counted. This one had teeth because the sentinel encoded a safety
   constraint — "this actor may never leave the field" — so the failure was not a balance
   wobble but a campaign that cannot be completed. Where a table's `null` means something,
   make the table exhaustive (`Record<K, V | null>`, not `Partial<Record<K, V | null>>`) and
   let the compiler demand an answer per key. Where a default genuinely is wanted, `??` is
   fine — but then no value in the table should ever legitimately be `null`.

   This applies beyond `ROLE_RESOLVE`. `ALLEGIANCE_RELATIONS`, `BEAST_PROFILES` and
   `ACTOR_BUDGET` are all exhaustive `Record`s for the same reason, and any future table
   that encodes an opt-out — "no threshold", "never spawns", "not eligible" — should be too.
2. **The rally-recovery branch was unreachable.** It lived in `updateRoutingActor`, which
   the frame `routTimer` reaches zero does not run — so an actor that ran its clock out
   never got its immunity and simply re-broke on the same frame, running forever. Visible
   in the harness only as a fight that stopped resolving. Recovery now lives in
   `updateActorMorale`, latched on `routReason`.

#### Three more the review pass found, which the harness could not

The harness drives `ActorAi` directly and never touches `GameEngine`, so none of these
could show up as a number. All three were found by reading the diff against the engine.

3. **Alert propagation was inert.** `announceSighting` wrote its payload into
   `aggroMemory` and `lastKnownTargetPos` — both of which `updateActors` clears on every
   frame an actor is not pursuing the player, which is exactly the state of the bystander
   being shouted at. The whole §5C.3 mechanism reduced to cancelling an idle timer, and in
   the one case the write survived — an actor already chasing the player — the alert
   *overwrote* that actor's memory of where the player went, sending it to investigate an
   unrelated wolf. Alerts now have their own `alertPos` / `alertTimer`.
4. **Flanking ranks three and up walked away from the target.** The ladder ran to ±135°
   and π, and the offset rotates the approach *direction*: `cos(135°) ≈ −0.71`, so the
   radial component is negative. Distance grows, `flankBlend` stays pinned at 1, the rank
   is stable, and the actor recedes forever. It surfaced through a related defect — a prop
   attacker had no queue to rank against and fell through to the *player's* queue, so a
   raider sent to knock down a barricade could be ranked against allies fighting the
   player and walk away from the barricade — but the divergence was general. The ladder is
   now bounded to ±66° and `tests/actorAi.test.ts` asserts every slot has a positive
   closing component, which is the assertion that would have caught it.
5. **A killed caravan escort was replaced in the same frame.** `updateCaravanEscort`
   filtered the dead out, respawned, and *then* asked "is anyone guarding the cart?" — and
   the replacement spawns 2.6 m from it, well inside the 7 m guard radius. The documented
   "cart that is genuinely lost if the guards lose" was therefore unreachable through
   combat. `CARAVAN_ESCORT_RESPAWN_DELAY` leaves a real gap.

The harness needed two corrections of its own before any of this counted. Corpses were
never aged out, so `groupShare` stayed permanently depressed and manufactured routs the
game would not produce — it now expires bodies at `CORPSE_LIFETIME`, matching the engine.
And a broken non-beast "ran home" from a rally point it was already standing on, which is
the *exact* "rout as skip your turn" model that inverted this harness's first measurement
back in Layer 3; both the engine and the harness now give ground to the nearest threat
when the rally point is overrun.

**That second one recurring is the interesting part, and it is a warning about the seam
rather than a one-off.** Both times the decision code was right and the harness's idea of
what an actor *does* with that decision was wrong, and both times the failure took the
same shape: **a behaviour whose whole point is disengaging degenerated into standing in
the fight not fighting** — strictly worse than either real outcome, so it biases the
comparison hard and in a direction that flatters the arm without the mechanism. The
movement model is where this class of error lives, it will keep arriving in new clothes
for anything that leaves, retreats, avoids or keeps distance, and it does not announce
itself: it looks like a plausible number. `tests/aiHarness.ts`'s header now says so
specifically, and names the two occurrences, rather than relying on the general
"models decisions, not outcomes" caveat to cover it.

The check that the extension did not quietly change the old answers is that **Q1, Q2 and
Q3 all still pass unchanged** with both Layer 4 arms off, which is why they default to off.
