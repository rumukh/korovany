# NG-13 - Expedition atlas

**Status:** implemented and integrated locally; see [combined acceptance](NEXT-GEN.md#6-integrated-milestone).
**Parent contract:** [Next-generation milestone](NEXT-GEN.md).
**Baseline:** `0993fa6`.
**Implementation base:** `8cc1186a5538aa98e9d32fd8559d6fb2c1a0a462`.

## 1. Outcome

The player can open a readable campaign atlas, compare the available commitments,
choose a destination, and follow a road itinerary over an actual bridge. Moment-to-
moment guidance remains visible when a shop, ration, or other interaction is nearby.

This is navigation and decision support, not autopilot, fast travel, a new quest
generator, or permission to reveal the entire living world.

## 2. Current behavior and evidence

`App.MiniMap` renders a 5x5 grid with faction/biome state and markers. It does not draw
roads, rivers, bridges, or a route. `getGeneratedPrompt` provides straight-line
distance only when a higher-priority interaction prompt has not replaced it.

The elf opening selected a roughly 458 m mandatory destination; the guard opening
selected one about 296 m away despite a nearby contract. During the villain journey,
the player reached a river bank with approximately 280 m still shown to the objective.
A bridge was visible in the 3D scene, but the minimap supplied no crossing instruction.

`WorldBlueprint.roads`, `river`, `bridges`, site positions, existing region bounds,
and `GeneratedWorldRuntime.getBridgePosition` already contain the necessary geometry.
Rendered roads use region-center-to-edge-center legs. Reuse or narrowly extract that
projection; do not invent a spline that disagrees with the walkable crossing.

## 3. Atlas interaction

`M`, the minimap, and a labelled touch action open a dedicated atlas. It pauses the
single-player simulation, has a proper close action and Escape handling, restores
focus, and cannot coexist with another blocking gameplay overlay.

Provide:

- A scalable, pannable map with fit-to-world and a usable small-screen layout.
- Roads, river legs, bridge symbols, discovered regions, and clear player orientation.
- A selectable list of ready campaign objectives, live rumours, and discovered useful
  sites. Include region labels, distances, stakes, deadlines, and mutually exclusive
  alternatives without duplicating long prose in the main HUD.
- Explicit destination selection, and clearing back to the active objective's route.
  Existing contract/rumour commitment actions remain explicit; inspecting a route
  must not commit to or complete a task.
- A short road itinerary with the next crossing/region and an honest uncertainty note.

Known objective destinations may retain their existing visibility through fog.
For the default target (a taken live rumour, the camp's chosen caravan, the active campaign
objective, or the caravan a shut finale still waits on)
or an explicitly selected known mission, its planned road itinerary may extend
through unexplored ground, drawn dashed and labelled unscouted. This deliberately
exposes only transport geometry along that itinerary, not arbitrary hidden sites,
biomes, owners, actors, event intentions, or the rest of the road network.

Never set `discovered` merely because the map is open or a route is planned. Unknown
region risk is uniformly unknown; route selection must not secretly consult its live
enemy/control/supply data. The pathfinder doctrine's hidden living markers stay hidden.

## 4. Routing contract

Add a pure `world\ExpeditionPlanner.ts` using the existing blueprint, region/site
projections, and a knowledge-filtered risk view. Graph traversal is deterministic,
with stable ID tie-breaking and no random-stream consumption.

The route is an ordered sequence of actual connected road legs and bridge crossings,
not a line between two site centers. Include the local approach/departure explicitly.
A dashed off-road connector is a bearing, not a certified walkable path; do not label
it safe when local collision/navigation has not confirmed it.

Offer the shortest road route and, when meaningfully different, a cautious route that
penalizes *known* hostile/contested regions. Describe the trade-off in distance and
known danger. Do not fabricate a second route, claim safety through fog, or leak
hidden danger through different route costs.

Bound route output to at most 128 points and 25 distinct region visits for a simple
path in the current world. Cache the immutable road graph. Recompute decisions when
the target, current leg, discovered information, or relevant known world state changes,
not by regenerating the world or building every navigation grid each frame.

If no road itinerary is available, say so and offer a clearly marked compass bearing.
This is an explicit unavailable-path state, not a successful empty route or a fake
straight-line crossing through water.

## 5. In-world guidance

Expose `GameView.expedition` and use `ui\ExpeditionAtlas.tsx` plus scoped CSS.
Keep a compact compass/next-waypoint strip in normal play. Show destination identity,
distance with its meaning, and the next useful instruction, especially a crossing.

The compass is independent of `view.prompt`: ration use, shopping, looting, and
inspection must not erase the selected destination. Reuse a bounded waypoint marker
or current marker system rather than adding a full-screen effect or a marker per actor.
No camera steering or player movement is performed automatically.

Distinguish sites with their region label rather than presenting several identical
generic labels with no way to tell them apart. Keyboard users must be able to obtain
the same information from the destination list without operating a graphical map.

## 6. Make interaction prompts honest

This is a required, narrowly coupled repair discovered during play.

`handleGeneratedInteraction` currently allows rations only when no site is nearby.
`getGeneratedPrompt` can still advertise a ration near a site with no applicable
interaction. At the elf bounty landmark the advertised action did nothing; away from
the landmark it worked.

Share the relevant eligibility/priority decision between prompt construction and
execution. A nearby site with no available action must not suppress a valid ration
fallback. Preserve real sabotage, event, shop/recovery, objective, treasure, and
caravan priorities, and the iron-ration doctrine's prohibition on manual consumption.

Do not change healing amounts, invent infinite supplies, auto-complete a live contract,
or solve the mismatch by hiding every useful prompt. The action advertised must be the
action a press actually attempts.

## 7. Persistence and ownership

Own `directorState.expedition`: version, selected destination/waypoint identity, and
route preference. Camera pan/zoom may remain transient. Do not persist a stale full
world copy or materialized route geometry.

Rebuild the route from the validated blueprint and restored knowledge. If a target is
completed, skipped, expired, or no longer known/legal, explain the change and clear or
advance guidance using the existing campaign selection rules. Do not resurrect a
skipped contract or automatically pin a different rumour.

Do not change `WorldGenerator`, the objective DAG, world fingerprints, the source
allegiance matrix, or contract reward/fail-forward semantics.

## 8. Acceptance

1. The baseline villain route and representative routes for all factions use real
   crossing geometry. Every route's road adjacency and bridge references validate.
2. An intentionally invalid straight-line river crossing is rejected by a negative
   control. A route that only looks plausible on a screenshot is insufficient.
3. Across 200 fixed seeds and all three factions, all 600 generated start-to-finale
   critical paths produce legal bounded road itineraries. Separate disconnected and
   off-road fixtures exercise explicit unavailable/connector states; returning
   "no route" for everything cannot pass. The underlying world fingerprints stay
   unchanged.
4. Poisoning hidden region control, supply, and actor data does not alter a
   knowledge-limited route's cost, label, or visible information.
5. Opening, panning, selecting, and closing the atlas does not advance paused timers,
   consume RNG, discover regions, accept a contract, or change an event deadline.
6. The next waypoint updates on travel and streaming. Shops, rations, and other
   contextual prompts do not remove navigation guidance.
7. The reproduced ration case works near a non-actionable landmark, including
   boundary distances, and remains blocked by the iron-ration doctrine. A genuine
   shop/caravan interaction still has its intended priority.
8. Destination/preference round-trip through save/continue; invalid and stale targets
   are handled explicitly. Initial and live views agree.
9. Desktop and narrow layouts support keyboard, pointer, and touch. Escape does not
   open pause behind the atlas, and closing does not leave movement held.

Add `tests\expeditionPlanner.test.ts` and suitable interaction/overlay coverage with
the existing runner. Relevant commands:

```text
node --experimental-strip-types --test tests\expeditionPlanner.test.ts tests\mapMarkers.test.ts tests\campaignView.test.ts tests\factionContracts.test.ts tests\chronicleCommitments.test.ts tests\runStorage.test.ts tests\hints.test.ts
npm run build
```

Observe actual browser navigation to a bridge and interaction at a landmark. Update
controls, teaching, and this specification with the delivered knowledge/routing policy.

## 9. Delivered behavior and evidence

### Navigation and knowledge

`ExpeditionPlanner` is the engine's live planner, not a test-only model. Its graph is
cached by blueprint identity and contains validated road-connection/segment references
projected as region-center-to-edge-center legs. `getRegionRoadLegs` and
`getRegionWaterBounds` are shared with `GeneratedWorldRuntime`, so the map, route
admission, rendered strips, and bridge openings use the same geometry. Roads whose
complete legs intersect water blockers are displayed when discovered but are not
routable. No generator topology, world fingerprint, or actor budget was changed.

The player and destination join the nearest water-clear road strip in their own
regions. Those local connectors are explicitly unverified bearings: they have not
been certified against every prop and terrain slope. A player already on a road does
not receive an unchecked shortcut to a more distant leg. Distances describe
horizontal map meters, not guaranteed travel time or a safety rating. A road route
has at most 128 points and 25 distinct regions; no-route results have an explicit
reason and no fabricated polyline.

Shortest uses mapped travel distance. Cautious adds penalties only for discovered
hostile/contested regions: hostile road legs cost three times their length, contested
legs twice, and legs with both flags four times. Unknown regions have no secretly
consulted enemy/control/supply score. An alternative is presented as a different
route only when it actually reduces known-risk exposure. The graph is immutable;
route decisions are cached until the destination, nearest road leg, known information,
short-range band (60 m, 80 m, or farther with a dry line), or substantial departure from
the itinerary changes. No navigation grids are built by the atlas.

Without an atlas choice, the compass charts a default target exactly as if the player
had selected it: the same road itinerary, next instruction, crossing symbols, and fog
exception. A taken live rumour is that target until it is kept, broken, dropped or
expires; otherwise it is the active campaign objective. W2-2's caravan spine adds two
places to that order (see [the caravan spine](16-caravan-spine.md)): while the camp's
choice is open, the caravan the player took with «Взяться» leads ahead of the objective,
and once no objective is left before a finale the caravans still hold shut, the nearest
caravan by road follows after it. The whole order is an atlas choice, a taken live rumour,
the camp's chosen caravan, the active objective, then the gate's next caravan. Explicitly
selecting a ready mission, live rumour, caravan or site overrides the default, and
«Убрать маршрут» returns to it.
Either way, a mission may expose its own dashed, unscouted road itinerary and crossing
symbols. Unexplored region owners, biomes, actors, unrelated sites, river legs, and the
rest of the road network remain hidden. A discovered utility site does not grant the
mission-only fog exception; a route to it through unexplored regions remains a compass
bearing until scouted. When no road itinerary exists, the compass keeps the labelled
straight-line bearing and the atlas says that the road is unavailable.

A short target is approached in a straight line instead of by a road detour, for the
default and for explicit selections alike. Up to 60 m (`DIRECT_APPROACH_METERS`) this
applies whenever the straight segment passes the planner's water test; up to 80 m only
when the road itinerary would be at least twice as long, or does not exist. Such a
route has the `direct` status and stays an unverified approach: it is drawn dotted,
the compass reads «Подход к цели», and the atlas adds «Подход не проверен: проверено
только, что на прямой нет воды.» Anything farther or across water keeps road routing,
or the labelled bearing when there is no road.

### UI, interaction, and persistence

M, the minimap, the compact compass, and the touch map button open the paused atlas.
Desktop presents map and destinations together; narrow screens have explicit Map
and Targets controls. Zoom, fit, pointer/touch pan, keyboard map movement, a complete
button-based destination list, stakes, deadlines, and exclusive alternatives are
available. Focus is contained and restored; reduced motion needs no decorative
movement. Road/bridge guidance is independent of `view.prompt`.

The atlas only calls `setExpeditionTarget` and `setExpeditionPreference`; it never
calls the contract or rumour commitment actions. `directorState.expedition` version 1
stores `mode` (`campaign` or `selected`), the bounded target kind/ID, and
`preference` (`shortest` or `cautious`). It stores no route geometry. Invalid present
blocks report a warning; completed, legitimately skipped, expired, and unknown targets
explain their removal and return to the existing campaign-selection fallback.
Clearing writes `campaign`, which survives a reload. A version-1 save from before
2026-10-07 may hold `none`, the old «Убрать маршрут»; it loads as `campaign` without
a warning, because clearing now means returning to the default route. A target of kind
`bridgeAmbush` loads as `caravanBeat` with the same ID: W2-2 made the bridge one caravan
beat among others, and the atlas lists every beat the run can still meet under that kind,
priced as its card is. A spine's road beats are not listed until the camp has chosen.

Both initial and live views carry `expedition`. Initial position and heading now use
the same start projection as the actual engine rather than the former site-center
approximation. Restored rumours share `buildChronicleRumourViews`, including position
and deadline filtering, with the live board.

`chooseGeneratedInteraction` now makes the relevant prompt/execution priority decision
once for both callers. Non-actionable landmarks permit the ration fallback; real
events, sabotage, shop/recovery, objective/treasure actions, and caravans keep priority.
Iron rations still prohibit manual use. Healing remains 35, capped by maximum health;
bleeding reduction, supplies, rewards, and contract fail-forward rules are unchanged.
A rejected sabotage attempt reports rejection instead of falling through to an
unadvertised caravan action.

`ui\gameOverlay.ts` provides the shared priority
end > achievements > shop > atlas > orders > pause. App retains additive modal flags.
Only the topmost owner renders and handles Escape; lower pause state is preserved.
New held input is refused while paused, opening clears existing input, and a recreated
engine immediately honours any active overlay. Gameplay achievement dialogs defer
Escape to the same arbitration rather than registering a second Escape handler.
The integrated orders state uses this same owner. Both dialogs refuse competing
overlays and return focus without resuming a lower pause.

### Validation and bounded field observations

The final selected Node run passed **143 tests**, including all **600** critical
start-to-finale itineraries from 200 fixed seeds and three factions. The seed list is
fixed in `tests\expeditionPlanner.test.ts`; no unavailable route is accepted by that
gate. Every critical route has legal road adjacency, a real bridge reference, and
bounded output. The same suite includes a deliberately invalid straight-line water
crossing, disconnected/off-road fixtures, a real lower-risk detour, poisoned hidden
state, stale targets, save normalization, initial/live parity, and live-runtime
bridge collision/navigation. `npm run build` passes. The existing linter also passed
for the new feature modules and tests; no packages or test framework were added.

| Native browser observation | Result |
| --- | --- |
| All three factions, seed `20260905` | Opened and completed the ordinary camp arrival using gameplay inputs. Atlas destinations and the independent compass were present. |
| Villain bridge journey | Walked from approximately `(-157, 177)` across the actual bridge at `(-80, 160)` to `(-60, 160)`, then back. The compass showed the crossing instruction at 15 m. Three Q-follow companions also crossed in this bounded observation. |
| Elf bounty landmark | At `(-147.9281, -12.8335)`, about 0.624 m from the landmark anchor, the advertised E ration changed health from 84.0417 to 100 and supplies from 1 to 0. Objectives and the bounty compass were unchanged. |
| Paused atlas | Save snapshots before/after zoom, pan, preference changes, and fit had identical player, companion, RNG, discovery, chronicle, event, contract, supply, and gameplay timer state. |
| Desktop `1366x768` and narrow `390x844` | No horizontal document overflow; visible atlas controls were at least 44 CSS pixels. Native keyboard focus wrapping, M, Escape, repeat suppression, minimap/touch opening, touch zoom/pan/cancellation, the Map/Targets switch, reduced motion, and bloom-off presentation were exercised. |
| Save/continue | A selected villain route survived a real page reload and continue. The final guard route also reconstructed on a clean page load. |

One important unavailable-path case is intentional, not hidden by the 600-route gate.
The guard's nearby `cull` offer is about 100 m away at `site-shop-riverside` in D1
(`region-3-0`, position `(74.09195, -142.99721)`). The river turns north-to-west at
`(80, -160)` without a bridge; D1's complete east, south, and west road legs include
the blocked center. The atlas therefore reports no road itinerary and offers only
a labelled bearing. It does not invent a bridge or a shoreline spline. The guard's
other A3 offer produced a legal 482 m road itinerary plus 26 m of unverified approaches.

These were bounded opening and navigation observations, not full campaign completions,
combat balance findings, or a frame-rate benchmark. Combined C/T/order/finale
observations are recorded in the parent milestone. The integrated touch HUD has
eight actions in three rows, with both information columns scrolling above them.

Evidence screenshots, native CDP helpers, and `atlas-final-tests.txt` are in this
session's artifacts, outside the repository. Native Chrome required its own profile,
anti-occlusion flags, and focus emulation during automated input; touch/reduced-motion
emulation was held in the same CDP gesture session. Final focus behavior was confirmed
after a clean page load rather than relying on an older hot-reloaded instance.

### 2026-10-07: road guidance by default

The 2026-10-06 gameplay review followed the default bearing on seed `20261006` and
walked the villain into the river about 150 m short of the E2 fortress. One atlas click
on the same objective revealed the bridge road. Selecting a mission reveals exactly its
own itinerary, so the old fog rule withheld nothing that a click did not show.

`ExpeditionPlanner.buildView` now plans the `campaign` target with the same function,
decision cache and mission fog exception as a selection. That target is a taken live
rumour while it lasts, otherwise the active objective. It re-plans when the target
changes (a node completes, a contract or rumour is pinned or dropped, a rumour resolves,
a selected target expires or closes), when the nearest road leg, known information or
short-range band changes, or when the player is more than 12 m from every leg. An
escort's target is the centre of its cart's square, so it re-plans when the cart changes
square, not per frame. A distant bridge card stands aside for a taken rumour as it does
for a pinned contract; otherwise it keeps its own itinerary until tracked. In the atlas,
the default target reads «Компас и так ведёт сюда», and «Убрать маршрут» is enabled only
for an explicit choice.

Road routing alone made the first instruction of almost every run a detour: every one
of the 600 fixed launches has its camp within 20.0 m on a dry line, yet 573 compasses
opened with «Выход к дороге», a median 24 degrees (at most 64) off the camp. The
short-range rule above fixes that. 60 m was chosen because:

- it covers every launch camp three times over;
- it is inside the fog's far distance in every weather profile (72 m in rain, 132 m
  when clear), so the player can see what the arrow points at;
- across about 16,500 sampled pairs on 40 fixed seeds, the median road itinerary of a
  dry pair is about three times the straight line at 10 m and twice at 20 m, but only 1.4
  to 1.5 times from 30 m on. Wet straight lines meanwhile grow from 9% at 60 m to 17% at
  80 m and 24% at 100 m. Past 60 m the road usually costs little and is often needed.

The 80 m extension applies only when the road would at least double the walk, which was
about a quarter of the dry 60 to 80 m pairs, or when there is no road at all.

The expedition hint fires once per profile, on the first explicit atlas choice or the
first frame the default compass takes up a road itinerary. That is normally right after
the camp, which is itself a short straight approach, so the launch frame stays quiet.

Evidence:

- `tests\expeditionPlanner.test.ts`:
  - The 600 fixed start-to-finale defaults equal explicit selections, keep road routing,
    and never cross water on the first compass leg; the old straight bearing fails all 600.
  - The reviewed B3 treasure case routes B3 > B2 > C2 > D2 > E2 over
    `bridge-road-branch-shop-region-2-1` and exposes nothing else through fog.
  - All 600 launch compasses point straight at the camp (error under 1e-9 radians); the
    road-only arrow missed by more than 10 degrees in 474.
  - 708 short wet crossings, 168 of them bridged, never become straight approaches, nor do
    67 wet lines around the bridgeless D1 bend on seed `20260905`.
  - Dry 60 to 80 m targets go straight exactly when the road doubles the walk (266 straight,
    312 by road), and none of 478 dry targets past 80 m does.
  - A taken rumour leads until kept, broken, dropped or expired; an escort re-plans only
    when its cart changes square; mid-rumour, default, explicit, cleared and legacy saves
    all continue as saved.
- `tests\campaignView.test.ts`: every launch first frame approaches its camp straight;
  restored first frames carry the planner's road.
- `tests\hints.test.ts`: the launch frame stays quiet, the first default road fires the
  line once, an earlier explicit choice counts, and the objectives line keeps its spacing.
- `tests\caravanBeats.test.ts` (formerly `tests\bridgeAmbush.test.ts`): the engine's
  expedition input, the tracked bridge card, «Убрать маршрут», a taken rumour and
  `saveGeneratedRun` agree.
- Six mutations each fail at least one of these tests: no straight approach, a straight
  approach through water, no detour ratio, rumours that never lead, the hint only on
  selection, and re-planning every frame. Selection-only planning fails 14 of them,
  including all seven added with the default road.

Browser observations used an isolated headless Chrome with SwiftShader at one to three
frames per second, so they support no feel or difficulty conclusions. A fresh villain
run on seed `20261006` opened with «Подход к цели - 21 м», its arrow on the straight
bearing to the camp. Walking in counted it down; after the camp the objectives line and
then the new expedition line arrived, while the bridge card led «по дороге к мосту».
A labelled setup then placed the villain at the B3 treasure with the start, contract and
treasure done, the alternative skipped, and no bridge-ambush block, as in the reviewed
build. The compass read «Выход к дороге - 6 м», then «По дороге - 20 м» on the road. From
15 m west of the C2 bridge it read «Через мост - 15 м», counted down, and switched to
«По дороге - 43 м» after the crossing. The atlas showed «290 м дороги + 18 м подхода» over
B3 > B2 > C2 > D2 > E2 with the unscouted bridge. A taken A3 rumour led the compass and
kept the pending bridge card aside, survived save and continue, and «Бросить» handed back.
Neither `1366x768` nor `390x844` overflowed horizontally or had a control under 44 CSS
pixels. A real save, reload and continue kept the default, explicit and cleared states.

### 2026-10-07: priced destinations (W2-3)

The contract board, the journal and the atlas now quote a choice's price before it is made.
A ready objective's card and its atlas destination carry three fields:

- `payout`: everything keeping the contract pays, from `contractPayout`, which reads the same
  `WORLD_EVENT_REWARDS` table `GameEngine` pays from. It names gold, a companion, damage (only
  what the run's champion cap still allows), healing and the guaranteed trophy. An errand, a
  failed contract and a kept contract carry none.
- `timeLimit`: the contract's own clock while it is still on offer.
- `travel`: `estimateChoiceTravel` times the itinerary the compass would chart from where the
  player stands, using the same shortest road route or short straight approach, at
  `PLAYER_WALK_SPEED` (8.2 m/s) times the current leg mobility. It ignores sprint, fights,
  props and the elf's forest stride, so it is a walking estimate, not a guarantee. With no road
  to plan it quotes the straight line as `basis: 'straight'`, labelled «по прямой: дороги нет»,
  just as the compass labels its bearing.

`travel.danger` names only discovered hostile or contested squares on that itinerary, from the
same knowledge filter the cautious route uses. Squares still in fog are counted in
`travel.unscouted` and never named. The fog's exception for a mission's own itinerary covers
the walk's distance: it exposes no more than selecting the destination already draws.

Cards are measured on the live path through `ExpeditionPlanner.measureTravel`, which remembers
an estimate per 4 m of player movement, and on the launch path directly, after the starting
boon's reveal, so initial and live views agree. The atlas list row shows a short form
(«300 золотых · идти ~45 с»); the detail shows the full price. The bridge-ambush destination is
left unpriced for the caravan-beat work that replaces it.

### 2026-10-08: reachable rumours (W2-3, part 2)

A rumour destination now carries the same `payout` and `travel` as a contract. The payout is
what keeping it pays, from `rumourKeptReward`: 15 gold for the guard and the villain, a ration
for the elf. The travel is the walk to `rumourTargetPoint`, the point the compass and the map
pin already use: the depot for a sabotage, the middle of the square otherwise, and for an
escort the square its cart is in now.

The rumour card itself adds a reach line, «идти ~N с · осталось M с · успеешь». The verdict comes
from `estimateRumourReach`, the rule the board used to make the offer, read again from where the
player stands, with the seconds already spent in the current chronicle tick. «Успеешь» means
the walk fits with the offer's margin (×1.5 and 8 s), «впритык» only without it, and «не
успеть» not at all. An escort is timed square by square, to wherever its cart will have rolled
by each check.

The offer is timed by `estimateWalkSeconds`: the same itinerary, without the per-4 m memo and
without knowledge, so an offer depends on the player's position and body and nothing else. The
shortest itinerary never weighs danger, so the fog cannot move it. The board asks for no walk
longer than `RUMOUR_OFFER_WALK_SECONDS`, 25 s at the player's own pace; the card's verdict
leaves that ceiling out, because it judges a rumour already on the board.
