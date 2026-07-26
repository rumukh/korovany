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
| 5 | **Ambient life** | Civilians, wildlife, campfires — cheap, highly visible. **Implemented.** |

This spec covers **all five layers in implementation detail**. §8 records what shipped and
what was deliberately left undone.

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
| Ambient life | `AmbientLife` (`world/AmbientLife.ts`) | Layer 5's numbers: how busy a village is, when a fire is lit, what startles a deer, what a storm costs. Pure, like the rest of `world/`. |
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
yet. Layer 5 confirmed that: a villager is hostile to beasts by this table and still never
attacks one, because `ActorAi.isPacifistRole` gates the *behaviour* while the relation
stays symmetric (§5D.2). `tests/allegiance.test.ts` asserts the matrix is total,
symmetric, self-friendly, and that the three factions still regard each other exactly as
`a !== b` did.

Everything hostility-shaped routes through it: targeting (`findNearestEnemy`,
retaliation, NPC-vs-NPC hunting), projectile eligibility, friendly fire, ally alerting,
actor separation spacing, minimap marker colour and the `faction-ring` under each actor,
kill attribution and rewards.

`civilian` exists in the matrix and is wired through it, but Layer 3 spawns none: the
ambient civilians that make it visible are Layer 5's job, and §5D.2 is where they arrive.

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

## 5D. Layer 5 — Ambient life

### 5D.1 The decision the whole layer turns on: what needs an actor slot

Layer 5 was scoped as *the cheapest perceived value per actor slot in the whole feature*.
The cheapest possible is **zero slots**, and that is what four of its five parts cost:

| Thing | Cost | Why |
| --- | --- | --- |
| Villagers | `ambient` slots | They can be killed, beasts hunt them, they need morale and a place in the actor list. |
| Deer, birds, crows | **props, 0 slots** | The brief said *non-combat* wildlife. A thing that cannot be fought needs no hp, no allegiance, no health bar, no threat score and no slot — it needs a mesh and a reason to run. |
| Campfires | **props, 0 slots** | The idle NPCs standing at the fire are the villagers, who are already paid for. |
| Torches | **a child mesh on an existing actor, 0 slots** | Plus exactly one shared light (§5D.4). |
| The storm hunch and slow | **0 slots** | A pose offset and a speed multiplier on actors that already exist. |

That split is not an optimisation, it is the design. It means the six-slot `ambient`
reserve is spent entirely on the one thing in the layer that can die, and that **nothing
Layer 5 adds can ever crowd out a raid** — a deer costs a raid nothing, so there is no
tension to resolve. `world/AmbientLife.ts` holds the numbers, pure and THREE-free like
`Chronicle`, `Materialization`, `Fauna`, `WorldEnvironment` and `ActorAi`.

### 5D.2 Civilians

`civilian` has been in `ALLEGIANCE_RELATIONS` since Layer 3 with nothing wearing it.
Layer 5 gives it a body: `ActorRole` gains **`peasant`** — named for what it does rather
than whose side it is on, so the role and the allegiance do not collide.

**How many there are is `planCivilianCount(settlementIntegrity)`**, and that is the
cheapest thing in the layer: it makes a chronicle number the player has never seen legible
on the ground. Three villagers in an intact square, one in a scarred one, none in a razed
one. A square that was raided last night is *visibly* quieter than one that was not,
without a single line of UI.

They are charged to **`ambient`**, like the prowlers and the caravan escort, so a
materialized raid takes their slots rather than arriving short. A village that empties
because something is burning three hundred metres away is a better failure than a raid two
beasts down.

**Behaviour is three rules and no new system:**

1. **They walk between the houses.** `updateCivilianRoutine` moves the villager's `home`
   to another spot in the settlement; `chooseWanderTarget` already scatters an actor
   around its `home`, so moving `home` is the entire implementation.
2. **They never pick a fight.** `isPacifistRole` gates `selectThreat` and the retaliation
   branch in `damageActor`. Hostility is a *relation* — a wolf will eat a villager and
   the matrix says so — but *starting a fight* is a behaviour, and without the gate a
   villager scores the wolf like any other target and walks over to be eaten.
3. **They scatter**, which is §5D.3.

### 5D.3 Panic is a third *reason*, not a second morale system

§5C.2's whole argument was that two independent "should I run" systems on one actor fight
each other. Layer 5 does not add a third: `MoraleBreak` gains **`panic`** and
`evaluateMorale` gains one branch, checked after the `actorResolve === null` gate and
before cohesion.

`findCivilianAlarm` measures its input, and the interesting part is what counts as
alarming — **none of it is "something hostile to me"**:

1. Anything at war with the villager (a wolf).
2. **Anything already in a fight** — an actor holding a target, or one chasing the player.
   The three sides are `neutral` to civilians in the matrix and must stay that way;
   making them hostile would turn every patrol in the world into a peasant hunt. Without
   this rule a faction raid would sweep through a village that carried on walking between
   the houses, because a hostility search would find nothing.
3. **A body.** Corpses stay in the actor list for `CORPSE_LIFETIME`, so this is free, and
   it keeps a square that has just been fought over frightening while the evidence lies
   in it.

The **player** is passed separately and only counts while *menacing* — a few seconds after
they swing at something. Villagers who bolted from anybody walking past would make a
village unapproachable, and walking in and *then* drawing steel is the joke.

**Panic tracks.** A villager already running re-measures its alarm on every morale check.
This is two fixes in one: it keeps running while the wolf is still there instead of
stopping every four seconds to be caught, and it runs from where the wolf *is* rather than
where it was when the panic started — a frozen `alarmPos` curves the villager back into
it. `Actor.alarmPos` is deliberately not `alertPos`: an alert is a place worth walking
*to*, an alarm is a place worth putting your back to.

**`CIVILIAN_PANIC_SPEED_MULTIPLIER = 1.55` is measured, not chosen, and it is the
difference between the feature working and being dead content.** At the `1.15×` every
routing actor gets, a villager makes 3.57 m/s against a wolf's 5.4 and cannot escape:
scattering saved **0 of 180** villagers across 60 fights, with the mechanic visibly and
correctly running the whole time. At `1.55` it makes 4.8 m/s — a wolf still runs it down
slowly, so a raid on a village still reads as a raid on a village, but a bear (3.4) or a
troll (2.9) never will. §9 has the numbers.

### 5D.4 Wildlife, campfires and torches — the zero-slot half

**Deer and birds are `WildlifeProp`s, not `Actor`s.** They graze or perch until something
comes too close, then bolt in a straight line away from it using the same `fleeDirection`
a panicking villager uses. `shouldStartle` folds "birds startled by sprinting" into one
rule over both species: anything moving fast is heard from further off. Crows land on
bodies that have been down for `CROW_CORPSE_DELAY` and leave when the body does, which is
the cheapest possible way to make a battlefield read as an aftermath.

**Campfires** are lit when `computeNightFactor(elapsed)` passes `CAMPFIRE_NIGHT_THRESHOLD`,
and villagers drift to them — that is the "night campfires with idle NPCs" from the brief,
implemented by moving the same `home` the day routine moves. The threshold reads the
**simulation's** night. The *brightness* follows the rendered `nightFactor`, which
genuinely is a display value. That split is the whole point of `WorldEnvironment`: turning
the day/night cycle off for performance must not put out every fire in the world.

**Torches** are a child mesh on soldiers, scouts and minions after dark, and there is
**exactly one point light in the world** for all of them, following the nearest bearer. A
light per torch would put twenty in the scene, and the 60 fps target is the one thing this
layer is not allowed to spend.

### 5D.5 Weather reactions

`weatherPaceMultiplier(stormFactor)` costs an NPC `AMBIENT_STORM_SLOW` of its pace, and
`weatherHunch` bends the torso pivot forward. Both read `computeStormFactor` over the
simulation's weather mix, never `weatherEnabled`.

**The slow applies to non-combat movement only** — wandering, holding an order, walking to
an alert — and never to a pursuit, an attack approach, or a beast. Trudging through sleet
is what a storm looks like; fighting 22% slower in it is a balance change nobody asked
for. Beasts are excluded from the hunch as well: the pivot bends a biped's spine, and
bending a quadruped's back at the shoulders makes it look broken rather than cold.

### 5D.6 What Layer 5 does *not* persist

Nothing. Villagers, deer, fires and torches are all rebuilt from chronicle state and the
world clock on load — a village's headcount is a function of `settlementIntegrity`, which
is already saved, and everything else is scenery. `ACTIVE_RUN_SAVE_VERSION` and
`REGION_DELTA_VERSION` stay at **3 and 2**. Bumping them for state that is not written
would discard everyone's run for nothing.

### 5D.7 Copy

`describeVillageLife`, `describeCivilianDeath` and the `panic` phrasing in `describeRout`
live in `content/gameCopy.ts` with everything else. `describeRout` now takes the *reason*
rather than a boolean, because Layer 5 added a third and a two-valued flag would have had
to lie about it.

```
В квадрате C3 местные ходят от домика к домику и делают вид, что заняты.
Местные разбежались по кустам. Домики деревяные постоят и без них.
Мирный житель прилёг. Он вам ничего не сделал, но домики деревяные уже никто не достроит. +0 золота.
Местного не стало. Он хотел дойти до домика, а дошёл только до середины.
```

Killing a villager pays **no gold, no loot and no kill on the counter**, and `recordKill`
is never reached so it cannot be tallied against one of the three sides. The line is the
entire reward, which is the correct price for it.

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

Constants added by Layer 5:

```
AMBIENT_CIVILIAN_LIMIT=3        CIVILIAN_SPAWN_RADIUS=58
CIVILIAN_HOME_RADIUS=16         CIVILIAN_INTERVAL=5
CIVILIAN_MIN_INTEGRITY=25       CIVILIAN_ALARM_RADIUS=12
CIVILIAN_PANIC_SECONDS=4        CIVILIAN_PANIC_RECOVERY=1.5
CIVILIAN_PANIC_SPEED_MULTIPLIER=1.55                       CIVILIAN_MENACE_SECONDS=6
ROLE_RESOLVE.peasant=-0.6       peasant hp=26, speed=3.1
CAMPFIRE_NIGHT_THRESHOLD=0.45   CAMPFIRE_LIMIT=2
CAMPFIRE_GATHER_RADIUS=3.2      CAMPFIRE_SMOKE_INTERVAL=1.4
CAMPFIRE_SEARCH_INTERVAL=3      (a determinism bound, not a cost one — see below)
TORCH_LIGHT_RANGE=26            (one shared light, not one per torch)
WILDLIFE_DEER_LIMIT=3           WILDLIFE_BIRD_LIMIT=9
WILDLIFE_SPAWN_MIN_RADIUS=22    WILDLIFE_SPAWN_MAX_RADIUS=54
WILDLIFE_DESPAWN_RADIUS=78      WILDLIFE_INTERVAL=4
DEER_STARTLE_RADIUS=14          DEER_SPRINT_STARTLE_BONUS=7
DEER_BOLT_SECONDS=2.6           DEER_BOLT_SPEED=11      DEER_GRAZE_SPEED=1.5
BIRD_STARTLE_RADIUS=7           BIRD_SPRINT_STARTLE_BONUS=5
BIRD_FLIGHT_SECONDS=3.4         BIRD_CLIMB_SPEED=5.5    BIRD_CRUISE_SPEED=8
CROW_CORPSE_RADIUS=2.6          CROW_CORPSE_DELAY=2.5
AMBIENT_STORM_SLOW=0.22         AMBIENT_STORM_HUNCH=0.22
```

`AMBIENT_CIVILIAN_LIMIT=3` is deliberately under the six-slot `ambient` reserve: prowlers
and caravan escorts are charged there too, and a village that starved the wolves out of
the forest would be a worse world than one with two villagers in it.

`CIVILIAN_ALARM_RADIUS=12` is *shorter* than a soldier's 15 m sense range on purpose. A
villager reacts to a fight in the street, not to one across the square, so a raid arrives
before the village empties — the scatter should be something the player watches happen
rather than something already finished when they get there.

`CIVILIAN_PANIC_SPEED_MULTIPLIER=1.55` is the one number in this layer that was solved
rather than picked; §5D.3 and §9 both say why. `CIVILIAN_PANIC_RECOVERY=1.5` is far
shorter than `MORALE_RALLY_SECONDS=12` for the same reason: panic is a reflex, not nerve,
and twelve seconds of immunity would leave a villager standing calmly beside the wolf that
just chased it.

`CAMPFIRE_SEARCH_INTERVAL=3` is **a determinism bound rather than a performance one**, and
it is the only constant here that exists for that reason. Placing a fire calls
`pickVillagePosition`, which draws from the shared seeded `event` stream and can fail;
without a throttle the number of draws would be a function of frame rate, so the same seed
would produce different world events on a fast machine and a slow one. Everything else
that touches that stream is already bounded by a timer or an event. `updateCivilianRoutine`
is bounded the same way, on the `wanderTimer` a villager already carries.

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
- **A civilian can never block an objective.** Villagers spawn with
  `objectiveEligible: false` and `squadEligible: false`, are charged to `ambient` so they
  are the first thing evicted, and hold no site: `isProtectedSite` and the objective graph
  do not know they exist. Killing one advances nothing and strands nothing — `killActor`
  returns before the reward path, so there is no gold, no loot, no kill on the counter and
  no `recordKill`. The 500-seed campaign test is unaffected because nothing Layer 5 writes
  reaches the blueprint, the chronicle or the save.
- **A villager caught between two armies.** The three sides are `neutral` to civilians and
  stay that way; a faction raid is alarming (§5D.3 rule 2) but never *targets* a villager,
  so a village in a war zone scatters and survives. Only beasts and the player can
  actually kill one, which is the correct set: the meme's factions rob korovans, they do
  not hunt peasants.
- **Wildlife and the actor cap.** Deer, birds and crows are not actors at all, so no
  amount of them can move `actors.length`. Their cost is draw calls and a per-frame loop
  over at most twelve props, bounded by `WILDLIFE_DEER_LIMIT` and `WILDLIFE_BIRD_LIMIT`
  and despawned past `WILDLIFE_DESPAWN_RADIUS` or when their region streams out.
- **A crow on a body that gets up.** It cannot — corpses do not revive — but the prop
  drops its perch and is collected if its actor is ever alive again or leaves the list, so
  a crow can never end up circling an id nobody holds.
- **A fire in a razed square.** `updateCampfires` skips a site `isChronicleSiteRazed`
  reports as burned, so a settlement that the chronicle destroyed does not cheerfully
  light a campfire on its own ashes. `planCivilianCount` empties it of villagers by the
  same token.
- **Panic that never ends.** A villager re-panics while its alarm is present, which is a
  loop by construction. It terminates three ways: the alarm walks away, the villager is
  killed, or it strays past `CIVILIAN_SPAWN_RADIUS + CIVILIAN_HOME_RADIUS` from the player
  and is despawned by the next headcount. The one thing it must not do is stop *while the
  wolf is still there*, which is what the first implementation did every four seconds and
  what made scattering worthless (§9).

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
- [x] Civilians walk between the houses of a settlement, scatter when a fight starts
      nearby, and can be killed by anyone — including the player, who gets a line and
      nothing else for it.
- [x] How busy a village is follows the chronicle's `settlementIntegrity`, so a square
      that was raided last night is visibly quieter than one that was not.
- [x] Non-combat wildlife: deer that graze and bolt, birds that flush when the player
      sprints past, crows that settle on bodies and leave with them. **None of it costs an
      actor slot**, so none of it can crowd out a raid.
- [x] Campfires are lit at night with villagers gathered round them, and patrols carry
      torches after dark — from `WorldEnvironment`'s night, not the renderer's, so the
      day/night toggle cannot put them out. *(Torches observed in the browser; the
      campfire was never caught in frame — see §9.)*
- [x] NPCs hunch and slow in a storm, from the simulation's weather mix, and the slow
      applies to walking rather than to fighting.
- [x] Ambient life adds no persisted state, so no save or delta version changes.
- [x] A civilian can never block or strand a campaign objective, and 500 seeded campaigns
      remain completable.
- [x] Actor count never exceeds `MAX_ACTORS` with ambient life in play, and ambient actors
      are evicted when a raid materializes rather than the cap being breached.
- [x] `npm run build`, `npm run lint`, and `npm test` pass.

**Deliberately left undone**, so a reader does not go looking for them:

- **Villagers have no dialogue, no shop, and no interaction prompt.** They are scenery
  that bleeds, not NPCs. Giving them a prompt would make every village a menu.
- **Wildlife cannot be hunted.** Deer and birds are props with no hp, which is exactly
  what makes them free (§5D.1). Making them killable would mean making them actors, and
  the six-slot reserve would then be spent on scenery rather than on the villagers.
- **Villagers are not persisted and do not remember the player.** A village repopulates
  from `settlementIntegrity` on the next visit whatever happened last time. Persisting
  them would be a save version bump for state the chronicle already summarises.
- **No civilian reputation or crime system.** Killing villagers costs nothing but the
  line. The three sides have no opinion about it, and adding one is a different feature.
- **Feel is not measured.** Whether a village reads as inhabited is the entire point of
  this layer and no number in §9 is about it; it was checked by eye in the browser and
  §9 says so rather than inventing a metric.

## 9. Effort

**Layers 1, 2 and 3: shipped.** In Layer 1 the tick rules and the save/versioning work
were the bulk; the feed and map overlays were the fiddly bits. In Layer 2 the actor budget
and the hand-back contract were the substance; unpicking the single-`activeEvent`
assumption threaded through the engine was the tedious part. In Layer 3 the §5.3 matrix
was a day's mechanical work across twenty-one call sites, and reusing the humanoid pivot
names for the quadrupeds saved the entire animation, death, gore and outline pipeline from
needing a beast branch. In Layer 5 the meshes and placement were most of the volume and
almost none of the difficulty; the one hard part was noticing that the headline behaviour
did not work.

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

### Measured effect of Layer 5

**Layer 5: shipped.** Almost all of it is scenery, and the honest headline is that
**most of what this layer is for cannot be measured at all.** Whether a village reads as
inhabited, whether a deer bolting past sells the forest, whether a lit fire at night makes
a square feel occupied — none of that is a number, and inventing one would be worse than
saying so. Those were checked by eye in the browser. What *is* measurable is the one
behaviour with a decision in it, and it produced a contradicted prediction and a design
change.

Same harness, same standing caveat: `tests/aiHarness.ts` runs the game's real decision
code but models movement and contact. 60 fights per arm; a `bear + wolf + wolf` pack
raiding a two-strong garrison with three villagers in the street, no player.

#### The mechanic shipped correct, visible, and completely inert

The first implementation of panic was exactly as designed. Villagers noticed a fight,
broke, and ran — `findCivilianAlarm` fired, `evaluateMorale` returned `panic`, and the
displacement was there in the numbers. It saved **nobody**:

| Arm | Attacks on villagers | Villagers killed (of 180) | Lived |
| --- | --- | --- | --- |
| Panic off | 420 | **180** | 0 |
| Panic on, at the shared `1.15×` rout speed | 434 | **180** | 0 |

Attacks went *up*. A villager at `3.1 × 1.15 = 3.57 m/s` cannot outrun a wolf at `5.4`, so
every one of them was caught, and running merely spread the same bites over more ground.
**This is Layer 3's rout rule again in different clothing**: a headline behaviour that is
implemented to spec, reads correctly in the code, and fires in every fight while changing
nothing. It was found only because deaths were counted side by side rather than reasoned
about.

Two defects and one tuning change were needed, and all three were required:

1. **Panic must track.** The first version froze `alarmPos` at the moment of the break, so
   a villager ran from where the wolf *was* and curved back into it, and the four-second
   timer expired mid-chase leaving it standing still for `CIVILIAN_PANIC_RECOVERY` with
   the wolf on top of it. It now re-measures every morale check.
2. **`CIVILIAN_PANIC_SPEED_MULTIPLIER = 1.55`.** Solved against the beast profiles rather
   than chosen: `3.1 × 1.55 = 4.8 m/s` loses to a wolf's `5.4` slowly and beats a bear's
   `3.4` outright. A villager can make the treeline; a wolf will still eat one.
3. **The harness needed a despawn**, matching the engine's, or a chase ran to the frame
   budget and "got away" was invisible — the single most interesting outcome of the
   behaviour had no way to be counted.

Measured after, panic off → on:

| Metric | Off | On |
| --- | --- | --- |
| Attacks landed on villagers | 420 | **190** |
| Villagers killed (of 180) | 180 | **60** |
| Villagers that escaped the square | 0 | 60 |
| Villagers alive at the end | 0 | 60 |
| **Villagers that lived, total** | **0 of 180** | **120 of 180** |

Two thirds of a village survives a beast raid when it scatters and none does when it does
not — but the wolves still catch a third of them, which is the number
`CIVILIAN_PANIC_SPEED_MULTIPLIER` is chosen to produce. `tests/ambientLife.test.ts`
asserts the margin in both directions so that anyone "tidying" the multiplier back to the
shared `1.15` gets a failing test rather than a silent return to dead content.

#### The finding nobody predicted: scenery was deciding fights

The counterfactual was written to check that villagers do not *defuse* a raid. It found
the opposite problem in the arm without panic. Three arms, same seeds:

| Arm | Attacks on the garrison | Attacks on beasts | **Beasts killed** |
| --- | --- | --- | --- |
| No villagers in the square at all | 664 | 408 | **1** |
| Villagers, panic off (they stand still) | 649 | 758 | **49** |
| Villagers, panic on (they scatter) | 549 | 618 | **0** |

**Stationary villagers are bait.** Standing four metres from the garrison they hold the
pack inside the soldiers' reach and it dies there — 49 beasts killed against 1 in a square
with no villagers in it. That is scenery deciding who wins a raid, which is precisely what
ambient life must not do. Scattering puts it back: 0 against the empty-square baseline
of 1.

So the strongest argument for civilian panic turns out **not** to be "it saves villagers",
which is what the design predicted and what the first measurement refuted outright. It is
that *without* it, adding decoration to a square measurably changes the outcome of the
fight in it. The garrison still gets its raid either way — 549 attacks against a 664
baseline, an 17% drop, which is the price of three villagers running through a fight.

#### What these numbers are not

- **Not about how any of it looks.** The harness has no meshes. Campfires, torches, the
  storm hunch, deer, birds and crows contribute exactly zero numbers to this section,
  because there is nothing in them for a headless model to count. They were checked in a
  browser and that is the whole of the evidence for them.
- **Not a frame-rate claim.** The 60 fps target was checked by eye in the browser, not
  measured here. The structural argument is stronger than a number anyway: four of the
  five parts of this layer allocate no actor, and the props are capped at twelve.
- **Not resolved fights.** The panic arm exhausts its frame budget, because the harness
  has no "go back to your raid" behaviour for a beast that chased a villager out of the
  square; the engine has one, through `home` wandering and `LOCATED_EVENT_TIMEOUT`. Every
  villager is dead, escaped or safe long before the budget runs out, so the civilian
  numbers above are unaffected — but the beast-side numbers in the second table are from
  a fight that was still notionally in progress, and should be read as a comparison
  between arms rather than as outcomes.

#### What the browser did and did not show

Non-headless Chrome on `dist/index.html` over `file://`, driven by the minimap: marker
`style.left/top` are map-relative percentages, and `WASD` reaches the engine without
pointer lock because the key handler is bound to `window`. **Observed:**

- The world boots, 25 regions, and **no console or page errors in any run**.
- **58–60 fps** with ambient life in play, at every sample.
- **Civilians spawn at a settlement, render, and persist** — three `neutral` markers in
  60 of 60 samples over 90 seconds, matching `AMBIENT_CIVILIAN_LIMIT` exactly, announced
  by «В квадрате D1 местные ходят от домика к домику…».
- **They walk between the houses**: villager markers move 0.46–1.85 map per cent between
  samples 1.2 s apart, i.e. metres, not jitter.
- **Deer**, grazing among the trees in the rain, rendering as intended — box torso, four
  legs, raised neck, antlers, cone muzzle.
- **Torches**, lit on soldiers after dark, with the single shared point light pooling on
  the ground around the bearer.
- **The actor cap holds**: at most 16 actor-bearing markers across every run, against a
  cap of 25, with ambient life present throughout.

**Not observed, stated rather than rounded up:**

- **A campfire was never caught in frame.** Lighting one needs the player alive at night
  *and* within `CIVILIAN_SPAWN_RADIUS` of a site, and five runs died between 54 s and
  110 s of run time — before or just as the day turned. What this leaves is an argument
  rather than a sighting: fires are gated on exactly the same `civilianRoutine`
  threshold as the torches, which *were* observed lighting on schedule, and the mesh is
  the same primitives-and-a-light construction as the torch and the deer, both of which
  were seen rendering. That is weaker evidence than the rest of this list and is recorded
  as such.
- **The scatter was measured, not seen.** Villager displacement while the player was
  menacing came out at 0.60 map per cent per sample against 0.46 calm — a difference in
  the right direction, but far too small to claim, because the villagers wandered out of
  the twelve-metre alarm radius between the swing and the sample. The scatter's evidence
  is the harness numbers above and the geometry tests, not the browser.
- **Birds, crows and the storm hunch** were not isolated. Rain was falling in every night
  screenshot, so the storm factor was certainly non-zero and the hunch was being applied,
  but a 0.22 rad lean on a distant NPC is not something eye-checking can honestly confirm.

#### Four defects the review pass found, which the harness could not

The harness drives `ActorAi` directly and never touches `GameEngine`, so none of these
could show up as a number. All four were found by reading the diff, and the first was a
regression in a system Layer 5 does not otherwise touch.

1. **A rescued captive could never fight again.** `isPacifistRole` listed `captive`
   alongside `peasant`, which looks obviously right and is wrong: `role` is not a
   captive's state, `aiMode` is. `rescueCaptive` frees a prisoner by flipping `aiMode` to
   `normal`, moving it to the `squad` budget and handing its weapon back — it never
   changes `role`, which stays `captive` for the whole run. The gate therefore left every
   rescued companion permanently unable to select a target, and the retaliation gate in
   `damageActor` closed the last door, so it would not even hit back when hit. It occupied
   a squad slot and soaked damage for the rest of the run. **No test covered it**, and the
   208-test suite passed throughout. The general rule now written at the predicate:
   *pacifism that follows the role goes in the role table; pacifism that follows a state
   belongs to the state.* A caged captive needed no entry at all — `updateActors`
   short-circuits on `aiMode === 'captive'` before targeting, and `actorResolve` already
   stops it panicking.
2. **Crows built and destroyed themselves every four seconds.** The crow inherited its
   region from the corpse it came for, and `Actor.generatedRegionId` is `null` for the
   starting squad, companions and `defendHome` attackers. `isRegionSimulated(null)` is
   false and the despawn test runs every frame, so a crow on any such body was disposed on
   the next frame — then re-spawned on the next tick, for the corpse's whole lifetime,
   while its `return` suppressed the ordinary wildlife spawn the entire time. It now takes
   its region from where it is standing, like every other prop.
3. **A bird that finished fleeing teleported nineteen metres straight down.** Flight
   integrates velocity with no ground clamp — that is what makes it flight — so a bird
   climbs ~19 m over `BIRD_FLIGHT_SECONDS`. When the timer expired it fell through to the
   landed branch, which hard-assigns `y` to ground height, in one frame, in plain sight.
   The code comment claimed the bird "flies out and is collected", and the numbers refuted
   it: 27 m of horizontal flight cannot reach a 78 m despawn radius from a 22–54 m spawn.
   A bird that finishes its flight is now removed, which is what the comment meant.
4. **An unthrottled seeded draw, which is a determinism bug rather than a cost one.**
   `updateCampfires` ran every frame with no cooldown, and its site search calls
   `pickVillagePosition`, which draws up to twenty values from the shared seeded `event`
   stream and can fail. Every other consumer of that stream is bounded by an event or a
   timer; this one would have been bounded by **frame rate**, so two players on the same
   seed doing the same things at 30 and 144 fps would have desynchronised and got
   different world events. `updateCivilianRoutine` had the same shape for a villager
   standing on its own `home`. Both are now throttled — the campfire on
   `CAMPFIRE_SEARCH_INTERVAL`, the villager on the `wanderTimer` it already had.

The harness needed one correction of its own. It searched for alarms over the *living*,
while the engine searches `this.actors`, which keeps corpses for `CORPSE_LIFETIME` — and
a body in the road is one of the three things §5D.3 calls alarming. It now scans the same
set the engine does, which raised panic events from 214 to 320 and displacement from
2,580 m to 8,020 m over the batch. **The outcome numbers in the tables above did not move
at all**, which is the useful part: the conclusion did not depend on the fidelity gap.
