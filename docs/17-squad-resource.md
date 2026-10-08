# W3-1 - The squad as a managed resource

**Status:** implemented on a branch over `main` at 6bb640e.

## Outcome

The squad is something the player keeps alive, replenishes and spends. Companions can use the same
care already present in the run, every side replaces losses through a verb from the letter, and a
fight the squad settles without the player no longer pays full personal gold.

No soldier is bought. No actor role, event kind, currency, biome or actor slot is added.
`MAX_ACTORS = 25` and the shared squad cap of four remain unchanged.

## Care

The `T` panel shows actual companion health and lets the player spend one existing ration on one
nearby wounded companion. The range is 14 m, the existing regroup distance. A ration restores 35 HP.
A distant, dead or fully healthy member consumes nothing.

The shop's existing field medicine can target the player or a nearby companion. It keeps the same
price and supply multiplier. The player treatment still restores 55 HP, closes wounds and stops
bleeding; a companion receives 55 HP because companions have no limb or bleeding model.

Every recovery site has two treatments per run. One `E` press can restore the player through the
existing +40 HP, stamina, wound and bleeding path and every wounded companion within 14 m by 40 HP.
The prompt shows `2/2`, `1/2` or `0/2` and names every effect of that press.

An errand at an exhausted healer still completes. The service and the objective are separate facts:
`E` may say only «Осмотреть», consume no treatment and still close the errand. This preserves #118's
production rule and prevents the old harness stall from becoming a player-facing stall.

## Replenishment

Living members plus earned, not-yet-materialized reinforcements never exceed four.

- **Elves:** a freed captive joins only the elves. A successful defence of the wooden houses adds one
  scout partisan when there is room.
- **Palace guard:** an attended `deliver` or `confiscate` caravan order adds one soldier. Releasing a
  cart, walking away from it or completing the order with a full squad adds nobody.
- **Villain:** press-gang remains the cart's existing immediate recruit. After at least one companion
  dies, the villain may return to the old fort once per run and press `E` to add one minion.

Guards and villains still rescue captives, receive the event's existing gold and loot, and say that
the captive went home. They do not borrow the elves' replenishment route.

An earned reinforcement uses a stable source ID. It materializes at the cart, defended house or old
fort after the finished event releases its actors. If even the highest-priority squad reservation
cannot fit it at that instant, one bounded entitlement waits at that same place. Save, reload and
retry cannot duplicate it.

## Personal credit

A real contribution is one of:

- a player hit on an event actor;
- a hit or blocked contact from an event actor;
- an event interaction.

Any such contribution keeps full personal gold, even if the player later steps away to heal or
chase. Without one, event and contract gold are each halved with `floor`, and the warning notice
says the full and paid amounts. Kill gold, caravan choice payouts, loot, healing, damage bonuses and
world consequences are unchanged.

Cards price the condition before the fight, for example `Плата: 120 · без тебя 60`.
The contract board, journal and live event card read the same reward tables the engine pays.

## Persistence

`directorState.squadResource` version 1 owns:

- treatments remaining by generated recovery-site ID;
- casualties and the one villain muster;
- reinforcement counts and at most the cap's worth of pending entitlements;
- stable contribution keys for resumable contract and located fights.

Companion HP remains in the existing normalized `companions` list; it is not duplicated.
An absent block is an older save and receives compatible fresh treatments. Missing stable starter
IDs reconstruct casualties. A malformed present block fails closed: treatment exhausted, muster
spent, no invented recruit and no invented full-credit contribution, with a Russian warning.

W3-4's `directorState.encounterRemnants` remains a separate sibling block.

## Harness contract

The harness adds `squadResource: 'legacy' | 'managed'`. The legacy arm is current `main`; the managed
arm models the same treatment, replenishment and credit decisions as the engine.

The report includes:

- companion healing and treatment actions by source;
- recovery-site uses;
- replacements by faction and source;
- attended guard deliveries and confiscations;
- reduced settlements, gold withheld and contributed settlements ending beyond 40 m.

The full panel uses 40 seeds per faction and policy on whatever other shipped arms are current.
Stop before shipping if a faction exceeds 1.5 replacements per run. Control movement is judged by
policy totals at a scaled 12/120 band, or by a second disjoint set pooled to 80 seeds for a noisy cell.

## Acceptance evidence

The final matched panel is [the published harness baseline](run-harness.md#baseline): 184/360
managed wins against 168/360 under `legacy`, with the duelist level at 93/120. Every winning
finale had a living companion. No recovery site was used more than twice; faction replacements
were 0.38, 1.02 and 0.43 per run for elves, guards and villains.

The one-ration reserve is a harness policy, not a game restriction. Component ablation showed why
it exists: unreserved care won 86/120 duelist runs against 96 under both legacy and reserved care.
The T panel leaves the choice to a person, but says «последний - себе не останется» beside the
player's current health.

Production-method tests cover chosen ration and medicine care, group recovery, exhausted healer
errands, all replenishment sources and cap controls, persistence, contribution credit and
non-droppable notice tags. UI tests cover price disclosure, shop targets, journal muster, hints
and 44 px care controls.

The required isolated Chromium executable could not expose WebGL1 or WebGL2 on this host, even
with both SwiftShader ANGLE backends, so the real renderer could not mount headlessly. A bounded
Vite browser harness rendered the production `GameScreen` and its real orders, shop, journal and
event components instead. At 1366x768 and 390x844 it observed:

- a 44 px keyboard/click ration action with player HP and the last-ration warning;
- no horizontal overflow, with the narrow dialog inside 8-382 px and 8-836 px;
- 44 px shop target and buy controls, live companion selection and healing;
- the old-fort muster line and 44 px journal action;
- `Плата: 70 · без тебя 35` on one line at 390 px;
- reduced motion and bloom off without removing any information.
