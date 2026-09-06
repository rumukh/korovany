# Korovany: the next-generation playable milestone

**Status:** all four features implemented and integrated; direct release to main approved on 2026-09-06.
**Baseline:** reconnaissance on `0993fa6` on 2026-09-05; implementation and integration on `8cc1186`.

## 1. Direction

Make the player a better fighter, a real squad commander, and an informed expedition
leader, then give that expedition a finale worth remembering. Preserve the procedural
comic-book identity, Russian voice, browser delivery, and finite seeded campaign.

This is not a graphics rewrite, an ECS migration, or a collection of new currencies.
The art overhaul, aimed three-beat melee, ten contract adaptations, exclusive campaign
branches, doctrines, chronicle commitments, and run epilogues already exist. The
historical assessment in `STRATEGY.md` must not be mistaken for the current baseline.

## 2. Hands-on evidence

All three factions were played on seed `20260905` with the default starting supplies.
These were bounded opening play sessions, not full campaign completions or a controlled
balance experiment. Gameplay ran in the real browser engine, through keyboard, mouse,
and existing UI action handlers. No health, positions, enemies, or objectives were
rewritten to advance a run.

The embedded browser rejected pointer lock with `WrongDocumentError`. Play therefore
continued in isolated native Chromium with working pointer lock and a separate profile.
Screenshots remain in the coordinating session's artifacts.

| Faction | Observed play | Useful evidence |
| --- | --- | --- |
| Elf | About 45 seconds of run time; opening, caravan escort fight, bounty contract, injury, bleeding, and ration use | The opening selected a roughly 454-458 m objective despite nearer contract choices. Sprinting consumed resources needed for combat. The ration prompt displaced navigation guidance. |
| Guard | About 77 seconds; settlement beast defense, shield use, an isolated patrol fight, hold and recall orders | Shield holding exhausted 100 stamina in about six seconds. Fighting with local defenders differed markedly from fighting alone. The squad count remained three while the squad was far behind. |
| Villain | About 78 seconds; caravan guards, inspection, roaming champion, healing, and travel through five regions | Two companions initially lagged far behind. A champion was quickly defeated with allied support. A direct course toward the next objective reached a river bank; the bridge was visible in the scene but absent from the minimap. |

Do not infer faction win rates, optimal combat timings, universal frame rates, or finale
difficulty from these samples. The actual campaign finales were inspected in code, not
completed during this reconnaissance.

### Findings that change the implementation

1. **Combat has commitment but little explicit defensive expression.** Keep its aimed
   contact and finisher risk. Add a bounded evasive step and a timing reward for the
   guard instead of replacing melee with another damage model.
2. **A count is not a command interface.** Show the current order, actual companions,
   health, and distant/blocked members. Orders must change the live AI, not just the HUD.
3. **Distance is not a route.** Show actual roads and crossing instructions, keep
   navigation visible during contextual interactions, and distinguish planned travel
   from unexplored uncertainty.
4. **One interaction mismatch was reproduced and traced.** Near the elf bounty's
   non-interactive landmark, the HUD offered a ration but the interaction did nothing.
   Away from the site, the same input restored 35 health. In `GameEngine`,
   `handleGeneratedInteraction` permits rations only in its `!site` branch, while
   `getGeneratedPrompt` can advertise them after a non-actionable nearby site. NG-13
   owns the narrowly related prompt/interaction correction.
5. **Finales need authored behavior, not additional ordinary roles.** Existing finale
   plans are a boss role plus two escorts. The actual enemy ownership is fixed:
   elf versus guard, guard versus villain, villain versus guard. Three new finales
   must distinguish those three campaigns without inventing an unreachable elf boss.

The ordinary caravan becoming NPC-looted after its guards died was also observed.
That is a future caravan-agency investigation, not authorization for an economy rewrite
inside this milestone.

## 3. Specifications

| ID | Specification | Player-facing result |
| --- | --- | --- |
| NG-11 | [Combat mastery](11-combat-mastery-spec.md) | Directional evasion, perfect guard, and usable camera controls when pointer lock is unavailable |
| NG-12 | [Squad command](12-squad-command-spec.md) | Follow, hold, focus, and regroup orders with a truthful companion roster |
| NG-13 | [Expedition atlas](13-expedition-atlas-spec.md) | An actionable campaign map, road-and-bridge routing, persistent guidance, and honest interaction prompts |
| NG-14 | [Signature finales](14-signature-finales-spec.md) | Three campaign-specific, two-phase encounters with readable counterplay and persistent consequences |

Each specification is a complete vertical slice: rules, live engine integration, UI,
teaching, persistence, and acceptance evidence. A pure module with no live caller is
not an implementation.

## 4. Shared integration contract

### Ownership

| Surface | Owner |
| --- | --- |
| Player input, evasion, perfect guard, player-only animation and damage-defense admission | NG-11 |
| Companion selection, formations, squad target policy, command UI and command persistence | NG-12 |
| Navigation presentation, atlas UI, route planning, contextual-prompt correction | NG-13 |
| Finale actor lifecycle, attack scheduling, boss presentation and terminal attribution | NG-14 |
| Generator topology, contract DAG, base allegiance matrix, base actor cap, art foundation, soundtrack composition | Unchanged by this milestone |

All four touch integration points in `src\game\GameEngine.ts`, `src\App.tsx`,
`src\game\types.ts`, `src\game\world\CampaignView.ts`, and the copy/hint registries.
Keep those edits additive and localized. Do not reformat these files or extract
unrelated systems. New UI belongs in feature-specific components under `src\game\ui\`
with scoped CSS rather than another large block of JSX in `App.tsx`.

Reserve these distinct public view fields and save blocks:

| Feature | `GameView` field | `directorState` block |
| --- | --- | --- |
| NG-11 | `combatMastery` | `combatMastery` |
| NG-12 | `squadCommand` | `squadCommand` |
| NG-13 | `expedition` | `expedition` |
| NG-14 | `finale` | `finale` |

Use typed factories/normalizers for each block, including an internal version. Wire
both `buildInitialGameView` and `buildLiveGameView`; do not revive a second independent
view builder. Update the HUD teaching registry for new player-facing fields rather
than exempting them merely to satisfy its coverage gate.

NG-11 owns an optional `sourceActorId?: string` sibling field on
`DamagePlayerOptions`, if needed for perfect-guard reactions. Other features must use
that spelling and the existing damage path; they must not invent another health sink.
NG-14 may add the identical optional declaration on its isolated branch if necessary
for standalone compilation.

### Controls and overlays

- Keep movement, sprint, jump, attack, abilities, `E`, `F`, and pause controls.
- `C` is evasion; `Q` remains the quick follow/hold toggle.
- `T` opens squad orders; `M` opens the atlas.
- Touch exposes the same actions without relying on a keyboard, hover, or pointer lock.
- Atlas and order selection pause this single-player game. Only one blocking overlay
  may be open. Escape closes the topmost overlay without also reopening pause.
- Opening an overlay, losing focus, or cancelling a pointer gesture releases held
  inputs. Closing one must not silently resume a still-open shop, end screen, or pause.

Coordinate additive pause predicates and input callbacks explicitly when combining the
branches. None of the four owners may replace another feature's overlay state.

### Persistence and identity

Absent optional blocks in an older save are normal compatibility cases. Malformed
present blocks are not: normalize finite bounds and enums, and report rejection through
existing warning/notice conventions. Never manufacture success or silently renew an
action window.

Persist decisions and remaining gameplay timers, not meshes, DOM state, or wall-clock
timestamps. Repeated suspend/continue must not refresh stamina, evade cooldowns,
boss health, rewards, or completed objectives. Preserve the existing active-run and
profile keys and terminal finalization path.

None of these four features changes a generated world. Keep world fingerprints,
generation streams, and campaign reachability unchanged. New procedural choices use
isolated seed derivations, never consume combat/loot/director streams for UI work, and
do not promise deterministic input replays across frame schedules.

### Delivery

Each feature is implemented in a fresh isolated session using `gpt-6-astra`, maximum
reasoning, and the long-context configuration requested by the user. The coordinator
collects and integrates completed changes; shared files are not a reason to leave four
incompatible demonstrations.

Implementation and integration were kept uncommitted until explicit release approval.
On 2026-09-06, the user authorized committing and pushing the combined result directly
to main. Preserve remote history and the original implementation worktrees; do not
archive an uncommitted implementation worktree or discard user changes.

## 5. Milestone acceptance

The combined build must launch all three factions, complete their existing opening
objectives and contracts, expose all new actions, and retain the existing victory,
defeat, suspend/continue, profile, and offline-bundle behavior.

The baseline `MAX_ACTORS = 25` remains in force. Effects and geometry use bounded
resources with explicit ownership and disposal. No remote service, imported art pack,
new package, account system, or network dependency is required for play.

Use the existing Node test runner and build scripts. Feature tests must exercise the
actual functions called by the engine and contain negative controls for the behavior
they claim to measure. Source-string assertions alone are not acceptance evidence.

Observe the integrated browser at desktop `1366x768` and narrow `390x844` sizes.
Actions must remain reachable, controls at least 44 CSS pixels where applicable, text
readable, and combat space usable. Exercise reduced motion, bloom off, paused menus,
input cancellation, and keyboard-only UI navigation. Do not claim browser observation
from headless simulation alone, or claim a performance threshold that was not measured.

The final field check must combine the features: choose a route over a real bridge,
take the squad along it, defend against a telegraphed attack, change an order, enter a
finale, and suspend/continue without losing or duplicating state.

## 6. Integrated milestone

The four isolated implementations are now combined in one working build. Their
feature-local evidence remains in the individual specs; the observations below
describe the combined code rather than assuming that four standalone passes compose.

### Shared behavior

The initial and live views supply all four feature fields. The same run save carries
version-one `combatMastery`, `squadCommand`, and `expedition` blocks alongside
version-two `finale`. Saved decisions, paid stamina, remaining action timers, stable
companion identities, and boss wounds survive together.

One App-owned overlay state arbitrates end, achievements, shop, atlas, orders, and
pause. Blocking happens synchronously with input/capture cancellation; Escape
dismisses only the active owner. Closing achievements restores an underlying pause
rather than resuming the simulation. The narrow HUD exposes all eight touch actions
in three rows, with scrollable information columns above them.

Perfect melee guard now explicitly interrupts an owned finale signature and cancels
its remaining sweep contacts without renewing an existing recovery. Projectile
blocks do not stun their shooters. Finale suspension is symmetric: an absent player
cannot leave a Hold squad attacking an unresponsive boss. Inactive finale actors are
excluded from combat targets, queued attacks are cancelled without a cooldown refund,
and damage admission rejects late contacts until reentry. Ordinary NPC combat is
unchanged. Starting squad orientation also uses the actual initial camera heading.

### Combined evidence

The existing full Node suite passes **713 tests**, including the 600 fixed
seed/faction critical road itineraries and actual-engine integration regressions.
The existing bundle/type-check pipeline and linter pass. No dependency manifest,
world fingerprint, generator stream, or actor-cap change was needed.

An isolated Chrome 152 renderer, driven through CDP, exercised the running game:

| Surface | Combined observation |
| --- | --- |
| Faction openings | Elf, guard, and villain completed their ordinary opening arrival on seed `20260905`, through live movement and interaction paths. |
| Bridge expedition | The villain selected the Fat Caravan itinerary in the atlas and crossed its real bridge at `(-80, 160)` with all three original companions. Across 746 advancing-frame samples there were no observed collider overlaps or unbounded steps; the maximum actor count was 15. No positions, health, or objectives were rewritten for this journey. |
| Orders and overlays | Native M/T/Escape, keyboard Hold/Focus confirmation, live Regroup movement, refused competing overlays, focus restoration, and held movement/shield cancellation were exercised together. Map zoom/pan and destination changes left gameplay state frozen. Save revision counters themselves still advance when a snapshot is written. |
| Touch and layout | Desktop `1366x768` and narrow `390x844` layouts were observed. All eight touch actions were reachable and at least 44 CSS pixels. Native multi-touch evasion spent 25 stamina; opening the atlas preserved the cost/cooldown and settled protection. Taps did not issue an order through a newly opened panel. |
| Camera and focus | An explicitly injected capture rejection enabled native drag-to-look without an attack. A click attacked once, with no retry loop. Native capture recovered after restoring the API; actual separate-tab focus loss cleared held input. |
| Persistence | Three real save/menu/continue cycles retained exact first-view resources, action timers, companion identity/health/slots, orders, and selected itinerary. Each finale also resumed its exact saved phase and wounded boss health. |
| Finales | All three profiles reached phase two and victory with the integrated squad, combat, and HUD. A real perfect guard interrupted the Warlord; the successful guard attempt used an explicitly selected squad Focus target. Reduced motion and bloom-off rendering were exercised. |
| Offline delivery | The generated `bundle.html` launched from disk with HTTP blocked and the browser reporting offline. The world rendered, C spent its real cost, and M/T opened their dialogs without an HTTP resource request. |

The finale runs used labelled setup of prerequisites, non-finale encounters, and
starting positions before the fight. They are **not natural full-campaign
completions or balance/TTK benchmarks**. The first guard counterplay attempt produced
a perfect guard but subsequently ended in defeat while injured and bleeding; a fresh
attempt won. The opening, bridge, and finale observations must not be conflated into
an uninterrupted campaign.

Reproducible scripts, JSON traces, screenshots, and runner logs are retained in the
takeover session's artifacts outside the repository. The individual feature specs
continue to document intentional limits such as unverified local route approaches
and genuinely blocked or distant companions.

### 2026-09-06 delivery to the original checkout

The completed takeover integration was recovered and delivered to the original main
checkout, including its new untracked source, tests, and specifications and the UI
dependencies from `8cc1186`. At the time of this copy, the original checkout's
`main` HEAD stayed at `0993fa6`: the delivery changed working files, not branch
history. The four feature worktrees
and the separate combined worktree were preserved. Content-hashed incoming snapshots
and backups of the original files are retained in the coordinator's artifacts.

In the delivered checkout, 132 targeted integration and UI cases, the existing build,
and the existing linter passed. Fresh native-browser observations covered all three
faction launches, desktop evasion plus atlas/orders arbitration, menu and gameplay
gallery Escape, a confirmed Hold order, and all eight narrow-screen touch actions.
A native touch evasion spent exactly 25 stamina. A real save/menu/continue cycle
retained exact first-view health, stamina, elapsed time, evade cooldown, order,
companion identities, and selected itinerary, with all four versioned state blocks.

These delivery observations supplement the combined bridge and staged-finale evidence
above; they do not claim a new full campaign, full-suite run, or performance study.
The recovered integration already owns menu/game gallery keyboard handling centrally,
so a subsequently corrected standalone atlas gallery callback was not copied over
the combined App.

## 7. Remaining follow-up

There is no known unfinished implementation or integration task in NG-11 through
NG-14. The following work remains outside the delivered milestone:

| Priority | Follow-up | Current limit |
| --- | --- | --- |
| 1 | Full natural campaigns and balance tuning for all three factions | Opening journeys and staged finale fights were observed separately, not as uninterrupted start-to-victory campaigns. These observations do not establish difficulty or progression balance. |
| 2 | Local navigation and road-access hardening | Off-road approaches are unverified, some companions can genuinely become blocked/distant, and the seed `20260905` D1 cull/shop offer has an unbridged river bend rather than a usable local road itinerary. |
| 3 | Caravan reward and interaction agency | Killing an ordinary caravan's escorts can precede NPC looting and leave the player without a robbery opportunity. Its intended ownership/reward timing needs a focused investigation. |
| 4 | Representative-device performance profiling | Frame pacing, sustained frame rate, memory, and long-run behavior have not been benchmarked across target hardware and browsers. |

The atlas labels uncertain routes instead of certifying them, and squad status reports
blocked or distant members instead of teleporting or reviving them. Those limitations
are intentional disclosures, not claims that all navigation cases have been solved.
