# W2-2 — The caravan spine

**Status:** implemented in two pull requests: #111 (each side's verb and its consequences) and this one (the spine).
**Parent:** the gameplay review of 2026-10-06 and the wave-2 programme.
**Code:** `src/game/world/CaravanSpine.ts` (placement), `src/game/world/CaravanBeats.ts` (rules, state, views),
`GameEngine` (runtime), `CaravanBeatHud.tsx` (cards).

## 1. Outcome

«Можно грабить корованы» is what every run is about, not something it may walk past. The camp is a decision between
two caravans, at least two caravans are met before the finale, and each side settles a won cart with its own verb from
the letter, with a consequence the world remembers. The review found a villain could finish a run with «корованов —
0»: only the bridge ambush was guaranteed, and it was optional.

The spine changes no generator stream, no world fingerprint and no objective graph. Caravans are director state, as
contracts are.

## 2. Where the caravans stand

`planCaravanSpine(blueprint, faction)` returns, in the order their state is saved:

1. **Two offers** near the start. One stands on the trunk, the road from the start to the finale, 60–220 m along it,
   aiming for 120 m. The other stands on another road, 60–240 m away by road, aiming for 130 m. They are at least 70 m
   apart, so their 34 m activation circles never touch. When a world has no such pair, both come from anywhere 50–320
   m away by road, still 70 m apart; a single offer or none is the last resort.
2. **The crossing**, the bridge ambush exactly as PR A shipped it. Every critical road crosses the river.
3. **One road beat** on the trunk, at least 80 m from the bridge along it, 160 m from the start and 60 m short of the
   finale, and 60 m from either offer. It prefers the stretch past the bridge, halfway to the finale.

A road beat's cart stands on a 24 m lane of one road leg, 12–36 m from its square's centre (every leg is 40 m). A lane
is turned away within 4 m of water, 10 m of any site, 45 m of an objective site (a contract's fighters scatter 17–22 m
from it, and a cart keeps 16 m of road clear), 40 m of the camp, 70 m of the finale, or 90 m of the bridge's cart.
Placement is the square's zone: a forest road in the forest, a mountain pass by the fort, an open road elsewhere.

Geometry decides. Near-ties are broken, and tiers and owners drawn, from `deriveSeed(seed, 'caravan-beats:' + faction)`,
a stream nothing else reads and nothing saves. Over seeds 0–499 and all three sides:

- the planner never writes to the blueprint, and plans the same caravans for a fresh world of the same seed;
- two offers in 92–98 % of worlds, on two roads in 60–69 %, none in at most 0.4 %;
- four caravans in 88–93 % of worlds and never fewer than two;
- the offers stand in each side's zone of the letter: the elves' mostly on forest roads, the guard's on open roads,
  the villain's on passes;
- it costs about 11 ms a world for all three sides.

## 3. The offers and the carts

The elves and the villain rob the other two sides' carts. The palace guard gets two orders: an escort of its own cart
against one enemy, and a raid on the other's. One offer is light and the other rich. The crossing and the road beat are
standard; the road beat belongs to the side the finale is fought against.

| Tier | Gold verbs | Escort |
| --- | ---: | --- |
| light | 70 | two: the bridge's first two posts |
| standard | 90 | the bridge's three |
| rich | 120 | three, the middle one the side's elite (a brute; a second blade for the elves, who field none) |

What each verb pays and writes is PR A's table (`caravanBeatReward`, `caravanBeatMarketWrite`); the README lists it.

## 4. The camp's choice

- A spine run's first objective reads «Суть такова: выбрать корован» and is held: standing at the camp closes nothing.
  So the launch compass does not point there: until an offer is taken it leads to the nearest one by road, ties in
  plan order, and its second line reads «ближний · второй — в карточке» («выбирать не из чего» with one offer). The
  field keeps the camp's card meanwhile. A run without a spine keeps W1-3's straight approach to the camp.
- The opening card prices both offers in W2-3's language (`ChoicePrice`): what the side's first verb pays, the walk,
  the known danger, then the side's other verbs as words, so the card never adds alternatives up. On the field it is
  the short form: a one-line rule, and for each offer its square, guard, pay, walk and «Взяться», which fits both
  offers above the fold at 1366×768. The journal's card adds the side's lead, the other verbs and how to choose. A
  world with one offer left (a single-offer world, or one whose other cart could not be staged) says «один корован».
- «Взяться» points the compass at one offer, the farther one included. Walking up to either cart is the choice: the
  cart met first is the one taken, and every other offer is declined («за двумя корованами погонишься — ни одного не
  ограбишь»).
- The camp's objective closes on the frame the met cart settles, whatever its ending. An offer that cannot be staged
  also settles the camp, and the other offer stays on its road.
- The road beats are dormant until then: no cart, no atlas target, a line in the journal.
- No random event is rolled while the choice is open.

## 5. The gate

`caravanSpineGate` opens the finale once `CARAVAN_SPINE_FINALE_GATE` = 2 caravans have settled. Resolved, lost,
escaped and never staged all count, because each ends in bounded time: the walked-away clock (30 s beyond 90 m), the
cargo's health, or the staging give-up (30 s). The declined offer neither counts nor is required, and `required` is
clamped to the caravans a world has. The gate is one input, `CampaignGate`, threaded into `getReadyObjectiveNodes`,
`resolveActiveObjectiveNode` and `buildCampaignContractViews`; it defaults to open, so every older caller is unchanged.
The engine, the launch view, the atlas and the harness pass the same gate, and the finale fields its garrison only
when it is open.

Two rather than three: one would leave the road optional again, and three cost 28 of 128 wins in the harness for 20–40
s more run. Two rather than one-plus-the-crossing: the gate asks for a number, not for a place, so a cart that cannot
be staged never strands a run.

While the gate is shut the finale's row reads «Штурм после корованов: 1/2». The compass leads, in order: an atlas
choice, a taken live rumour, the camp's caravan (taken, or else the nearest offer by road), the active objective, and
with nothing else left, the gate's nearest caravan by road (amended in [the atlas spec](13-expedition-atlas-spec.md)).

## 6. Progress

Every two caravans the run met (resolved, lost or escaped) are one step of W2-1's progress
(`countProgressSteps({ caravanBeatsResolved })`, `CARAVAN_SPINE_BEATS_PER_STEP`). One to a step was measured first and
was out of band: threat waves dealt 1 324 damage against the baseline's 364 and the duelist lost 11 wins. Two to a step
keeps the waves at baseline. The finale is fought at pacing tier 4 either way; enemy stats follow the clock alone.

## 7. Staging

A cart stages through one seam, `requestBeatStagingRoom(count)`: W1-1's make-way (a random event the player is not in
the middle of stands down for the cart), then W1-6's step-back (`makeRoomForStaging('campaign', count)`: the
player's own idle packs out of sight make room, as they do for a contract), then a campaign reservation. Refused, the
card says so («На дороге тесно…»), the cart retries every 2 s, and its stall clock runs while the player stands by it.
After 30 s it goes through without its fight, unpaid, and counts as settled. Beat actors carry an `eventOwnerId`, so
W1-6's step-back never parks them. In the harness no cart waited for room once the step-back joined the seam; before,
7 in 270 runs waited 28 s in all.

## 8. Persistence

`directorState.caravanBeats` version 2 carries `spine`, `chosenOfferId`, `garrisonThinned` and each cart's state with
its `stagingStalled` clock. `restoreCaravanSpine` reads the flag first and normalises against the matching plans. The
normaliser refuses any story the spine cannot tell: two offers met, an offer declined before any was met, a road beat
touched while the camp waits, a chosen offer that is no offer, a stall clock past its end or outside the approach.

- A version-1 block (PR A), a non-spine version 2, an old `bridgeAmbush` block or a run from before any caravan keeps
  the campaign it started with: the camp closes on arrival and the finale has no gate.
- A malformed spine is refused, not repaired. Every cart closes unpaid, which settles the camp and opens the gate.

## 9. Tests and measurement

- `tests/caravanSpine.test.ts`: placement over 500 seeds with a control for the objective rule; an exhaustive
  never-strand simulation, with a gate that counts only robbed carts and an unclamped gate as controls; the camp's
  rules; persistence round trips and refusals; migration and fail-forward.
- `tests/caravanBeats.test.ts`: the camp, the dormant road, the gate and the finale's spawn, progress steps, the
  staging seam and the make-way, the compass leading to the nearest offer and «Взяться» retargeting it, the held
  camp's arrival, and the camp's quiet, on the production engine methods. Each guarantee was mutated in the engine
  and its test failed.
- `tests/openingInterface.test.ts`: the opening card (its short field form, the single-offer copy), the compass's
  line, the chosen offer, the journal and the gate line.
- `tests/expeditionPlanner.test.ts`, `tests/campaignView.test.ts` and `tests/hints.test.ts`: W1-3's launch rules,
  amended (see [the atlas spec](13-expedition-atlas-spec.md)): spine launches lead to the nearest offer by road, and
  legacy launches still go straight to the camp, as the control.
- `tests/runHarnessBeats.test.ts` and [the harness](run-harness.md#w2-2-pr-b-the-caravan-spine): in 270 runs a row the
  spine meets about two caravans a run for every side, wins 128 against 133 without it, and lengthens the scripted
  player's median win by 28–52 s. The gate's control never reaches the finale; the walk-away control still does.

## 10. Not done

- Binding a beat to a live `ChronicleCaravan`, so the cart robbed is the cart the chronicle tracks. Chronicle carts are
  spawned by the chronicle's own stream on trade routes, and pinning one to the trunk would change every seed's history.
- Folding `HARNESS_SPINE_ARMS` into `HARNESS_SHIPPED_ARMS`. It would move the published baseline and every whole-run
  test seeded on it, so it is left as a decision for the programme.
- Option A's 6–10 minute run is a joint outcome of waves 2 and 3; the harness's scripted player cannot show it.
