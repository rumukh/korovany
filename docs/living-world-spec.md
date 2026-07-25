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
| 1 | **Хроника** (Chronicle) | Data-only tick over all 25 regions. No meshes, no actors. |
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
| Determinism | `RandomStream` + `deriveSeed` | Four gameplay streams: `combat`, `director`, `event`, `loot`. |
| Save | `ActiveRunSaveV2` (`run/runTypes.ts:74-91`) | Includes `regionDeltas`, `directorState`, `eventState`, `rngStates`. |

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
// world/RegionRuntime.ts
export interface RegionChronicleState {
  control: Territory                  // mutable; seeded from blueprint.territory
  pressure: Record<Faction, number>   // 0..1 military pressure
  beastPressure: number               // 0..1
  settlementIntegrity: number         // 0..100, per settlement site in the region
  supply: number                      // 0..1, drives shop stock and prices
  lastEventTick: number
}

export interface RegionDelta {
  version: 2
  // …existing fields…
  chronicle: RegionChronicleState
}
```

### 4.3 World-level state

Cross-region data that belongs to no single region lives in a new `chronicleState`
block on the run save, alongside `directorState` and `eventState`:

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

export interface ChronicleState {
  tick: number
  factionStrength: Record<Faction, number>   // 0..1
  caravans: ChronicleCaravan[]
  log: ChronicleEvent[]                      // bounded ring buffer, newest last
}
```

`log` is capped at `CHRONICLE_LOG_LIMIT = 40` entries so the save stays bounded.

### 4.4 Tick rules

All rolls use `chronicleRng = new RandomStream(deriveSeed(blueprint.seed, 'gameplay:chronicle'))`,
whose state is persisted in `rngStates.chronicle` exactly like the four existing streams.

**1. Faction fronts.** For each road connection in `blueprint.roads`, compare the
attacker's `pressure` in the source region against the defender's in the target region.
Pressure grows toward `factionStrength[faction]` in regions a faction controls and
decays elsewhere. When attacker pressure exceeds defender pressure by
`CONTROL_FLIP_MARGIN`, `control` flips and a `regionCaptured` event is logged.

The player's own faction gains strength from completed objectives, so the campaign and
the chronicle reinforce each other rather than running in parallel.

**2. Beast pressure.** Grows per tick in `forest` and `fort` biomes, scaled up at night
(`dayPhase`) and during `rain` / `snow` weather, and decays in regions under faction
control. Above `BEAST_RAID_THRESHOLD` it triggers a `beastRaid` against a settlement in
that region and resets to a partial value.

**3. Settlement integrity.** A raid — faction or beast — drops
`settlementIntegrity`. At `0` the settlement is `разорено`: its shop and recovery
functions go offline, its marker changes, and `settlementBurned` is logged. Integrity
regenerates slowly while the region is uncontested.

**4. Caravans.** Each tick, caravans advance `progress` along their `regionPath`.
Traversing a region whose `control` is hostile to the caravan's owner, or whose
`beastPressure` is high, rolls an interception. A lost caravan sets `intact = false`
and reduces the destination region's `supply`. Arrivals raise it. New caravans spawn
between settlement sites when fewer than `CHRONICLE_CARAVAN_LIMIT` are in transit.

### 4.5 Effects the player can feel

| Chronicle state | Player-visible effect |
| --- | --- |
| `control` | Minimap territory colour; `WorldMapRegion.territory` now reads chronicle control instead of blueprint territory. |
| `control` | Encounter faction composition when a region is next simulated. |
| `beastPressure` | Frequency of beast encounters (Layer 3) and ambient growls. |
| `settlementIntegrity` | Scorched prefab, offline shop/recovery, aftermath props. |
| `supply` | Shop prices scale by `1 + (1 - supply) * SUPPLY_PRICE_SWING`. |
| `log` | News feed entries and map overlays. |

### 4.6 UI

- **News feed.** `App.tsx` currently has only transient `Notice` toasts that expire
  after 4.3 s and no history. Add a compact, collapsible **«Хроника»** panel fed by
  `GameView.chronicle`, showing the most recent entries with region coordinates. Only
  events in **discovered** regions are shown, so it doubles as a fog-of-war reward.
- **Map overlays.** Contested regions get a hatched overlay; burned settlements get a
  distinct marker. Reuse the existing `generated-map-region` grid.
- **Notices.** High-salience chronicle events (a region the player has visited flipping
  control, a settlement they traded at burning) also raise a normal `onNotice`.

### 4.7 Copy

All player-facing strings are Russian, in the established register: dry, dark, faintly
absurd, censored. Anchored in original spec motifs — «корованы», «домики деревяные»,
«надо слушаться командира» — rather than generic fantasy-war phrasing.

Examples:

```
Гвардия выжгла эльфийский лагерь в квадрате C3. Домики деревяные больше не деревяные.
Корован из Лавки не доехал. Кто-то ограбил корован раньше пользователя.
В квадрате B2 зверьё осмелело. Местные предпочитают не выходить.
```

Chronicle copy lives in `content/gameCopy.ts` next to `createGeneratedObjectiveText`,
not hardcoded in `GameEngine.ts` the way the five existing event builders are.

## 5. Contracts fixed now for Layers 2–5

These are small changes that unblock later layers and should land with Layer 1.

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

```
CHRONICLE_TICK_SECONDS=8        CHRONICLE_LOG_LIMIT=40
CONTROL_FLIP_MARGIN=0.18        PRESSURE_GROWTH=0.06     PRESSURE_DECAY=0.03
BEAST_GROWTH_FOREST=0.05        BEAST_GROWTH_FORT=0.04   BEAST_NIGHT_MULTIPLIER=1.6
BEAST_STORM_MULTIPLIER=1.3      BEAST_RAID_THRESHOLD=0.75
SETTLEMENT_RAID_DAMAGE=[18,34]  SETTLEMENT_REGEN=1.5     SUPPLY_PRICE_SWING=0.45
CHRONICLE_CARAVAN_LIMIT=3       CARAVAN_INTERCEPT_BASE=0.12
DEFEND_HOME_MAX_DISTANCE=95
```

## 7. Edge cases

- **Fog of war.** Chronicle events in undiscovered regions still happen; they are just
  not shown. Discovering a region reveals its current state, not its history.
- **Player's own region.** The chronicle never flips control of, or burns, a settlement
  in a region that is currently simulated — Layer 2 materializes that as a real fight
  instead, so the player never watches a building change state from thin air.
- **Campaign safety.** `faction-start` and `final-stronghold` sites are never destroyed
  and their regions never flip, so a generated campaign always remains completable.
  `WorldValidator` gains an assertion for this.
- **Victory / defeat.** The chronicle stops ticking when the run ends.
- **Save during a chronicle tick.** Ticks are atomic within one `update()` call, so a
  save always captures a coherent state.
- **`defendHome` regression.** Phase 0 found that this event could never fire in
  generated mode: it selected from `villageHouses`, which only the deleted legacy world
  builder ever populated, and the eligibility filter excluded it outright. It now
  targets the nearest generated `settlement` site within `DEFEND_HOME_MAX_DISTANCE`.
  Layer 2 supersedes it with chronicle-driven `factionRaid` / `beastRaid`.

## 8. Acceptance criteria

- [ ] The chronicle ticks over all 25 regions regardless of player position, at a
      measured cost under 1 ms per tick, with no per-frame cost.
- [ ] Region control changes hands over a long run; the minimap reflects it; encounter
      composition in a flipped region matches its new owner.
- [ ] Beast pressure rises at night and in storms and falls under faction control.
- [ ] A settlement can be reduced to `разорено`; its shop and recovery go offline and
      its prefab reads as burned.
- [ ] Losing caravans raises prices at the destination settlement.
- [ ] The «Хроника» feed shows recent events for discovered regions only.
- [ ] The same seed produces an identical chronicle history over a fixed tick count.
- [ ] Chronicle state survives save → load through `RegionDelta.chronicle` and
      `ChronicleState`; malformed saves are rejected, not migrated.
- [ ] Campaign start and finale regions never flip and their sites are never destroyed;
      500 seeded campaigns remain completable.
- [ ] Actor count never exceeds `MAX_ACTORS`; ambient actors yield first.
- [ ] `npm run build`, `npm run lint`, and `npm test` pass.

## 9. Effort

**Layer 1: ~2–3 days.** The tick rules and the save/versioning work are the bulk; the
feed and map overlays are the fiddly bits.
Layer 2 ~2 days, Layer 3 ~3 days (new meshes and AI), Layer 4 ~3 days, Layer 5 ~1 day.
