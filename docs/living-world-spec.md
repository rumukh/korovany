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
| 2 | **Materialization** | Chronicle events become 3D only when the player is near. |
| 3 | **Fauna** | Beasts and civilians as non-playable allegiances. |
| 4 | **NPC AI** | Perception, morale, threat scoring, flanking, commander orders. |
| 5 | **Ambient life** | Civilians, wildlife, campfires — cheap, highly visible. |

This spec covers **Layer 1 in implementation detail** and fixes the contracts that
Layers 2–5 build on.

## 2. Current baseline (reference)

| System | Location | Notes |
| --- | --- | --- |
| Region streaming | `RegionManager` (`world/RegionManager.ts:106-112`) | `visibleRadius` and `simulationRadius` both default to `1`, so only a 3×3 neighbourhood of the 25 regions is ever simulated. |
| Region state | `RegionRuntime` (`world/RegionRuntime.ts:69-95`) | Owns runtime ids and a `deltaState` JSON bag; `extractDelta` / `applyDelta` persist it. |
| Territory | `WorldRegion.territory` (`world/worldTypes.ts:58-67`) | Written once by `WorldGenerator`; nothing writes it at runtime. |
| Site ownership | `WorldSite.owner` (`world/worldTypes.ts:88-94`) | Same — static blueprint data, no runtime entity. |
| Actor budget | `MAX_ACTORS = 25` (`GameEngine.ts`) | Checked ad hoc at every spawn site rather than centrally. |
| Events | `updateEvents` / `startRandomEvent` / `finishEvent` | One active event; player-anchored; `eventCooldown` 50–70 s scaled by threat tier. |
| Event placement | `pickEventPosition()` | Always a 22–38 m ring around the player. |
| Threat waves | `updateThreat` / `spawnThreatWave` | Spawns hostiles in a 13 m ring around the player. |
| Actor AI | `updateActors` | Sense range 15 m (18 m archers); NPC-vs-NPC hunt radius 6.5 m (15 m archers); no morale. |
| Hostility | `hostile(a, b) => a !== b` | Any two different factions are hostile. Three factions only. |
| Caravan | `updateCaravan` | Patrols the generated road network between two patrol anchors. |
| Determinism | `RandomStream` + `deriveSeed` | Five gameplay streams: `combat`, `director`, `event`, `loot`, `chronicle`. |
| Save | `ActiveRunSaveV3` (`run/runTypes.ts`) | Includes `regionDeltas`, `directorState`, `eventState`, `chronicleState`, `rngStates`. |

## 3. Design rules

1. **The chronicle is data, not objects.** It never touches `THREE`, the scene graph,
   the navmesh, or the actor list. This is what makes simulating all 25 regions free.
2. **The player is an observer, not a trigger.** A raid resolves whether or not the
   player shows up. Arriving late means finding the aftermath.
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

> **Environment caveat.** Neither environment input is random. `nightFactor` is derived
> from `dayPhase`, i.e. from `elapsed`. `stormFactor` is `weatherWeights.rain +
> weatherWeights.snow`, and `weatherWeights` only ever lerps toward
> `WEATHER_BY_ZONE[biome under the player]` — so weather kind is a pure function of the
> seeded world and where the player is standing. (`weatherRng`, the one `Date.now()`
> seed in `GameEngine`, feeds `randomWeatherRange` only, which times cosmetic lightning
> flashes and thunder claps. It never touches `weatherWeights`.)
>
> What this does mean: both inputs track the player. `stormFactor` is a per-frame lerp,
> so it depends on the route walked and on frame pacing, and each input is pinned flat
> when its display setting is off — `dynamicDayNight: false` forces `nightFactor` to `0`,
> and `weatherEnabled: false` snaps the weights to `clear`. So a chronicle history
> replays exactly for a given seed *and* playthrough, not across arbitrary playthroughs
> of the same seed. That is inherent to anything that reacts to where the player walks.
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
(`dayPhase`) and during `rain` / `snow` weather, and decays by `BEAST_CONTROL_DECAY` in
regions under faction control. Above `BEAST_RAID_THRESHOLD` it triggers a `beastRaid`
against a settlement in that region and resets to `BEAST_RAID_RESET`.

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
| `beastPressure` | Frequency of beast encounters (Layer 3), caravan interception risk. |
| `settlementIntegrity` | Scorched prefab, offline shop/recovery, hatched map tile. |
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

> **Status: not implemented.** Layer 1 is pure data and does not need any of this, so
> §5 was deliberately deferred rather than landing alongside it. Everything below is
> still outstanding.

### 5.1 Actor budget allocator

Replace the ad-hoc `actors.length + n <= MAX_ACTORS` checks scattered across the engine
with one allocator:

```ts
type ActorBudgetCategory = 'squad' | 'campaign' | 'chronicle' | 'ambient'

const ACTOR_BUDGET: Record<ActorBudgetCategory, number> = {
  squad: 3,
  campaign: 8,
  chronicle: 8,
  ambient: 6,
}
```

`reserveActorSlots(category, count)` returns whether the reservation succeeded and
never lets the total exceed `MAX_ACTORS`. `ambient` yields its slots first when a
higher-priority category needs room.

### 5.2 Located events

`pickEventPosition()` gains a variant that places an event **at a site or region**
rather than in a ring around the player, and `MAX_ACTIVE` becomes one player-anchored
event plus N ambient ones. An event whose region stops being simulated de-materializes
back into chronicle state instead of being cancelled.

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
  Layer 2 supersedes it with chronicle-driven `factionRaid` / `beastRaid`.

## 8. Acceptance criteria

- [x] The chronicle ticks over all 25 regions regardless of player position, at a
      measured cost under 1 ms per tick, with no per-frame cost.
- [x] Region control changes hands over a long run; the minimap reflects it; encounter
      composition in a flipped region matches its new owner.
- [x] Beast pressure rises at night and in storms and falls under faction control.
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
- [ ] Actor count never exceeds `MAX_ACTORS`; ambient actors yield first.
      *(Deferred with §5.1 — Layer 1 spawns no actors.)*
- [x] `npm run build`, `npm run lint`, and `npm test` pass.

## 9. Effort

**Layer 1: shipped.** The tick rules and the save/versioning work were the bulk; the
feed and map overlays were the fiddly bits.
Layer 2 ~2 days, Layer 3 ~3 days (new meshes and AI), Layer 4 ~3 days, Layer 5 ~1 day.
§5's contracts remain outstanding and should land with Layer 2.
