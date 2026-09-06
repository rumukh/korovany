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
- Explicit destination selection and clearing. Existing contract/rumour commitment
  actions remain explicit; inspecting a route must not commit to or complete a task.
- A short road itinerary with the next crossing/region and an honest uncertainty note.

Known objective destinations may retain their existing visibility through fog.
For an explicitly selected known mission, its planned road itinerary may extend
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
or substantial departure from the itinerary changes. No navigation grids are built by
the atlas.

The default compass follows the existing active campaign objective as a labelled
straight-line bearing. It does not expose an unselected itinerary through fog.
Explicitly selecting a ready mission or live rumour may expose that mission's dashed,
unscouted road itinerary and crossing symbols. Unexplored region owners, biomes,
actors, unrelated sites, river legs, and the rest of the road network remain hidden.
A discovered utility site does not grant the mission-only fog exception; a route to
it through unexplored regions remains a compass bearing until scouted.

### UI, interaction, and persistence

M, the minimap, the compact compass, and the touch map button open the paused atlas.
Desktop presents map and destinations together; narrow screens have explicit Map
and Targets controls. Zoom, fit, pointer/touch pan, keyboard map movement, a complete
button-based destination list, stakes, deadlines, and exclusive alternatives are
available. Focus is contained and restored; reduced motion needs no decorative
movement. Road/bridge guidance is independent of `view.prompt`.

The atlas only calls `setExpeditionTarget` and `setExpeditionPreference`; it never
calls the contract or rumour commitment actions. `directorState.expedition` version 1
stores `mode` (`campaign`, `selected`, or `none`), the bounded target kind/ID, and
`preference` (`shortest` or `cautious`). It stores no route geometry. Invalid present
blocks report a warning; completed, legitimately skipped, expired, and unknown targets
explain their removal and return to the existing campaign-selection fallback.
Explicit clearing survives a reload.

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
