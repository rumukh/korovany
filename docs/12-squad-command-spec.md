# NG-12 - Squad command

**Status:** implemented and integrated locally; see [combined acceptance](NEXT-GEN.md#6-integrated-milestone).
**Parent contract:** [Next-generation milestone](NEXT-GEN.md).
**Baseline:** `0993fa6`.
**Implementation base:** `8cc1186a5538aa98e9d32fd8559d6fb2c1a0a462`.

## 1. Outcome

The starting companions become a squad the player can understand and direct: hold a
crossing, concentrate on a dangerous target, or disengage and regroup. The interface
must describe the actual live squad, including members that are hurt or left behind.

Do not turn the game into an RTS, increase the actor cap, add a recruitment economy,
or replace existing morale and navigation.

## 2. Baseline behavior

`squadMovement.ts` defines three starting members per faction, catch-up speed, and
regroup distance. `GameEngine.commandSquad` toggles one boolean. `updateActors` gates
formation following and hunting with that boolean. The HUD exposes a count, not the
current command, membership, health, or distance.

Companions already save stable IDs, roles, health, and positions. Eligible rescued
companions must remain supported. Faction-aligned garrisons, caravan escorts, event
actors, and civilians are not automatically the player's squad.

During play, a held guard squad remained at the settlement while the player fought
elsewhere; its HUD still read three. Recall brought two back quickly while another
remained distant. Two villain companions initially lagged near camp and later
regrouped during streaming. Treat these as required navigation/roster regression
scenarios, not evidence that every missing member has died.

## 3. Commands

| Command | Live behavior | End condition |
| --- | --- | --- |
| Follow | Travel in a stable formation around the player, engage nearby threats, use existing catch-up rules | Another order |
| Hold | Keep a collision-valid anchor at the player's position when ordered; defend a bounded perimeter instead of wandering or chasing indefinitely | Another order |
| Focus | Eligible squad members prioritize one visible hostile actor, subject to role, morale, range, and navigation constraints | Target dies, becomes invalid, leaves the command envelope, or another order |
| Regroup | Disengage from optional pursuits and return to the player's formation; defend only as necessary to escape | Members reach formation, then Follow |

Keep `Q` as a quick Follow/Hold toggle. `T` and a labelled HUD/touch control open the
orders panel. Selecting an order is explicit; opening or closing the panel alone must
not issue one. Keyboard focus and buttons provide the complete interaction without
hover, a radial gesture, or a held key.

A fresh run may start in Follow so its existing starting party actually travels with
the player. Preserve a restored legacy `squadFollowing` value when the new block is
absent: true becomes Follow; false becomes Hold at the restored location.

### Behavioral bounds

Start with a 6-unit Hold defense radius and an 8-unit chase leash. Focus selection is
limited to 30 units from the player, requires current visibility/line of sight, and
must respect current allegiance and doctrine-specific hostility. No civilian, captive,
friendly, dead actor, or hidden map marker becomes a target by accident.

Focus remembers the prior Follow/Hold stance and returns to it when the target is no
longer valid. Regroup ends in Follow. Do not silently choose an unrelated replacement
target when the focus target disappears.

Morale routing, hit reactions, and mandatory event ownership still take priority where
they do today. A command is not a heal, an immunity, a speed upgrade, or permission to
commandeer every friendly NPC in a region.

## 4. Formation and pathing

Use stable slots derived from companion identity, oriented to the player's movement
or facing. Put melee members toward the flanks/front and archers behind the contact
line. Do not reshuffle every frame or use frame-time randomness.

Reuse `NavigationSystem`, `CollisionWorld`, and existing catch-up helpers. Validate
anchors and local destinations against the live collision world. Do not fix a stuck
member by disabling colliders, assigning maximum speed forever, or teleporting it
through scenery.

Exercise departure from all three generated starting camps on seed `20260905`.
If a starting placement is trapped inside prop collision, correct placement through
the existing walkability machinery, narrowly in the companion initialization path.
If a later destination is unreachable, expose a bounded blocked/distant state and
replan on relevant navigation revisions rather than presenting the order as fulfilled.

The player and squad must cross a real bridge without the squad cutting through water.
Do not expand navigation work to unrelated ambient NPCs.

## 5. Architecture and UI

Add a pure `world\SquadCommand.ts` module containing command state, transition and
eligibility rules, and role-aware slot selection. Extend `squadMovement.ts` only for
shared movement behavior the live engine actually uses.

Centralize squad membership in one predicate used by commands, the roster, companion
serialization, and cleanup. It must retain the existing distinction between the
player's companions and event-owned/faction-aligned bystanders.

`GameView.squadCommand` includes the current order, focus/anchor summary, and a bounded
roster of stable ID, role, health, maximum health, and meaningful state such as engaged,
following, holding, regrouping, distant, or blocked. Keep the existing numeric `squad`
field for its current consumers.

Use `ui\SquadCommandPanel.tsx` and scoped CSS. A compact persistent strip shows the
current order and party status; the full panel is available on demand. New controls
must not bury health or the fighting space under another permanent card. Distinguish
states with text/icon shape, not just faction color.

The panel pauses the game and cooperates with the atlas/shop/pause overlay contract.
Clear movement, attack, and shield input when it opens. On confirmation, revalidate
the chosen target and report an explicit rejection if it is no longer legal.

## 6. Persistence and lifecycle

Own `directorState.squadCommand`. Save its version, mode, finite anchor, prior stance,
and stable focus identifier where meaningful. Never save object references or a
THREE vector.

Restore companions before resolving focus identity. A target whose region has not yet
materialized may need bounded deferred resolution; do not silently select a new one.
If focus cannot resume, return to the saved base stance and explain that the target is
gone. Keep Hold anchored across save/continue and region activation.

Deaths remove members from the live roster exactly once. Streaming is not death.
Continuing must not create a second starting squad or revive a defeated member.
Do not overwrite other features' director-state blocks.

## 7. Acceptance

1. All four orders change actual engine-used decisions. In a two-hostile fixture,
   Focus changes whom an eligible member attacks; removing focus priority must fail.
2. Hold stays within its bounded anchor/leash even when a hostile retreats. A control
   that ignores Hold must fail the perimeter scenario.
3. Regroup stops an optional pursuit, follows a collision-valid path, and returns to
   Follow; it does not clear morale or teleport a stranded actor.
4. Ordinary friendly garrisons, event escorts, civilians, captives, and hostile
   doctrine-exempt beasts cannot accidentally enter the squad/focus set.
5. Starting parties depart each faction camp, and follow/hold/recall are exercised on
   seed `20260905`, around props, and over a bridge.
6. A distant living member remains distinguishable from a dead member. Health and
   order status agree between HUD, live state, and a resumed save.
7. Command state round-trips; invalid enums/coordinates/IDs are rejected or explicitly
   normalized. Old absent blocks preserve the legacy Follow/Hold meaning.
8. Keyboard, mouse, and touch can choose and cancel orders. Escape and the atlas
   cannot leave two active overlays or a stuck movement/shield input.
9. Actor count stays at or below 25, and selection/formation work is bounded at that
   cap. No per-frame path rebuild or per-member material allocation is introduced.

Add `tests\squadCommand.test.ts` and focused integration coverage. Existing relevant
selectors include:

```text
node --experimental-strip-types --test tests\squadCommand.test.ts tests\squadMovement.test.ts tests\actorAi.test.ts tests\allegiance.test.ts tests\actorBudget.test.ts tests\campaignView.test.ts tests\runStorage.test.ts tests\hints.test.ts
npm run build
```

Update controls, teaching copy, and this specification. Record any real navigation
limitation instead of making the roster claim an order succeeded when it did not.

## 8. Delivered implementation

`world\SquadCommand.ts` owns the versioned command state, validation, transitions,
membership, target eligibility, formation slots, roster status and plain view data.
The real `GameEngine.updateActors` calls its intent selector before ordinary
optional hunting, alerts and wandering. Existing action windups, hit reactions,
morale routing, role-specific attacks, separation and collision remain authoritative.

### Orders and identities

- New runs start in Follow. Hold records a collision-valid player anchor and heading,
  acquires enemies inside 6 units, and bounds ordinary pursuit/movement at 8 units.
  Knockback and morale still take priority; an order is not immunity.
- Focus selects an on-screen, unobstructed, living hostile within 30 units. Terrain
  and scene occlusion are checked, and doctrine-specific `hostileToPlayer` still
  applies. Confirmation revalidates the selected ID. Loss, death or invalidation
  returns to the saved base stance with a notice, never another focused ID.
- Regroup drops optional pursuits and finishes only when every living member has a
  successful path, a clear final connection and an arrived formation position.
  A debounce used to display `blocked` cannot authorize arrival. Losing the last
  member is not announced as a successful recall.
- Membership requires a living, non-hostile, eligible party actor on the squad
  budget with normal AI and no event owner. Commanding, counting, roster building,
  saving and region cleanup use that predicate. A rescued captive joins only after
  its event releases it; ordinary garrisons, escorts and civilians are excluded.
- Starter IDs are `squad:<faction>:starter:<index>`. Slots are allocated from identity
  without per-frame randomness and persist as optional companion `formationSlot`
  values in `0..24`. Death does not rearrange survivors. Melee slots face forward;
  archer slots sit behind. Existing restored IDs and roles are retained.

### Navigation and truthful status

Catch-up retains the existing speed helper and its bounds. Squad routes are cached
per member and refreshed on destination changes, meaningful collider/region revisions
or bounded failed-progress retries. The global collision revision is deliberately
not used: the baseline updates active bounds every frame.

Live acceptance reproduced a specific villain brute failure at approximately
`(-155.780609, 185.748812)`: the body was collision-valid, but its navigation grid
cell could not start a path. A clear 0.8-unit step onto a neighboring cell restored
an ordinary route. `squadMovement.findSquadNavigationPath` now tries at most 36
collision-checked local connectors, no farther than 2.4 units, only for this
grid-entry case. The engine walks every connector through normal movement.
No actor is repositioned, no collider is disabled and no ambient AI is changed.

Preferred starting positions are separately checked after region materialization;
a bounded nearby search is used only when necessary. The starter migration marker,
restored membership and stable IDs prevent duplicate parties or revival.

Cached navigation relinquishes waypoint priority once the current direct connection
clears, so archers can resume their existing firing/retreat range instead of walking
to point-blank distance. A newly obstructed direct connection is replanned.
Blocked detection measures forward progress rather than rewarding sideways jitter.
Collision remains authoritative even where the coarse navigation grid misses a
thin obstacle.

The roster distinguishes following, taking position, holding, regrouping, engaged,
distant, blocked, routing and hit recovery. Distance is measured from the player;
the distant threshold is 18 units. A failed path or stalled progress becomes visibly
blocked after 1.5 seconds, but cannot finish Regroup even before that label appears.
Streaming never counts as a companion death.

### UI and persistence

The compact strip and `ui\SquadCommandPanel.tsx` expose current order, stable member
number/role, actual health and state. Desktop shows all three starter rows; narrow
screens can swipe the compact roster and use the full panel. Buttons and choice
labels have at least 44 CSS-pixel hit areas. The left HUD has a bounded scroll area
and sticky vitals so extra squad content cannot scroll the whole game surface or
overlap the reserved touch movement area.

Opening does not order anything. Radio/target selection requires explicit confirmation.
`Q` remains the quick toggle; `T` and the labelled strip open the panel. Opening pauses
immediately and clears movement, melee and shield input through `setPaused`.
The panel uses the existing document scroll lock and a local Tab focus trap.
Escape goes through the existing engine/App pause callback; it closes orders without
opening pause behind them. Shop, achievements, pause and ending state gate opening.

`directorState.squadCommand` stores only version, mode, base stance, finite anchor/
heading and an optional focus ID. The active-run/profile keys and versions do not
change. Absent legacy blocks map old `squadFollowing=true` to Follow and false/absent
to Hold at the restored location. Malformed present commands produce a warning and
use that legacy fallback. Focus lookup runs after companions and initial regions are
restored; a target absent then is explicitly released rather than retried indefinitely.
Both initial and live campaign view builders publish `squadCommand`.

Shared signatures for integration:

```ts
GameCallbacks.onSquadCommandRequest?: () => void
GameEngine.commandSquad(order?: SquadCommandMode, focusTargetId?: string): boolean
RunCompanionState.formationSlot?: number
```

Explicit orders are valid from the paused panel; the no-argument quick toggle is not.
The App owns `squadCommandOpen` within the shared `GameOverlayState` and mirrors
that complete state in `overlaysRef`. Explicit open/close/confirm callbacks share
NG-13's overlay arbitration, preserve lower pause intent, and reject stale or
competing modal actions.

## 9. Acceptance evidence

The existing Node runner exercises the actual `GameEngine` class through
`tests\squadRuntimeHarness.ts`. Only rendering/audio sinks and final damage bookkeeping
are substituted; actor decisions, action windup/contact targeting, reactions,
separation, steering, collision and navigation are production methods. This is
distinct from the browser evidence below, which uses the fully constructed engine.

The expanded targeted run passed **133 cases**, covering the required selectors plus
navigation, collision, copy, mobile layout, pause layout, achievement scroll locking
and viewport regression selectors. `npm run build` and the existing `oxlint` on
changed source/fixtures also pass. No package or new testing framework was added.

Negative controls remove Focus priority, ignore Hold, retain stale waypoint priority
over archer range, attempt a water shortcut and exercise both null and physically
blocked cached paths near an apparent arrival. Regression coverage includes the
measured villain grid cell, per-frame active-bound revisions without per-frame path
rebuilds, empty-party recall, bounded IDs/slots, legacy saves and no revived starters.

Native Chrome play used normal keyboard/mouse/touch actions on seed `20260905`.
Game positions, health, enemy populations and objectives were not rewritten:

| Scenario | Observed result |
| --- | --- |
| Guard departure, Hold and recall | Three companions remained within 4.395 units of the held anchor while the player walked about 33 units away. The roster showed living members at 30/31/37 units. Recall returned all three and changed to Follow only after arrival. |
| Guard suspend/continue | IDs, roles, health, slots and the distant Hold anchor round-tripped exactly; the party stayed three, not six. |
| Elf departure and Focus | All three left camp. Selecting the farther of two caravan guards made all eligible members target that exact guard. Its health went from 70 to 0; its recorded death restored the original Hold anchor. |
| Wounded elf recall | A 3/55 scout's morale routing remained active. Two members arrived while the scout was visibly retreating; Regroup did not falsely complete or heal it. |
| Villain camp grid regression | The original live blocked brute was reproduced and diagnosed. After the connector fix, a fresh real departure/recall brought all three back, including the brute, with unchanged health. |
| Final-code bridge crossing | Player and all three original companions crossed `bridge-road-critical-villain-region-1-2` west to east. All four passed the actual central crossing. Across 1,474 sampled movement frames there were zero water or static-collider overlaps; actor count never exceeded 25. |
| Real casualties after crossing | The minion and archer subsequently died in combat on the far side. They disappeared from the living roster while the surviving brute retained its identity and health. Save/continue restored only the survivor, not a new starter squad. |
| Desktop and narrow UI | Observed at 1366x768 and 390x844. Native keyboard selection/cancel/confirmation and native touch selection/confirmation work. Escape leaves no second dialog. The narrow HUD ends at 685.58 px before controls beginning at 689.61 px, with game scroll height 844 and scroll position zero. |
| Input cancellation and paused time | Orders kept elapsed time unchanged, cleared held movement, shield and melee, and did not accept new held movement. Native touch cancellation stopped movement without a stuck key. |
| Reduced motion and bloom off | The villain departure and bridge run were observed with bloom disabled and reduced-motion settings; orders, roster text and collision behavior remained available. |

Raw evidence and screenshots are retained in the implementation session's artifact
directory, not in the repository. Key records are `squad-final-real-bridge-crossing.json`,
`squad-villain-blocked-diagnosis.json`, `squad-villain-connector-fixed.json`,
`squad-focused-guard-defeated.json`, `squad-guard-suspend-continue.json`,
`squad-final-casualties-continue.json`, `squad-native-touch-cancelled.json` and
`squad-narrow-final-layout.json`.

### Deliberate limits

This is not a global navigation repair. A genuinely unreachable destination or a
member outside active navigation regions can remain blocked/distant until the player
approaches or changes the destination. A badly hurt member can keep routing under
the existing morale rules. Neither case grants healing, immunity, teleportation or
a false fulfilled order.

Finale participation remains bounded by the player's engagement envelope. A held
party cannot keep attacking a suspended boss or its escorts after the player leaves:
those targets become unavailable, pending swings are cancelled without refunding
cooldown, and damage is rejected until reentry. Ordinary enemies remain valid targets.

The feature-local samples above predate the combined build. Integrated `M`/`T`,
bridge, defense, and finale observations are recorded in the parent milestone.
These samples establish command behavior and collision/roster truth, not universal
path reachability or a measured frame-rate guarantee.
