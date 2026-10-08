# The run harness as a balance instrument

**Status:** W1-5, 2026-10-07. Tests-only: no game behaviour changed. The streaming window was corrected the same
day in #108, after W1-6 found the shipped arms simulating the whole 3x3. Every number below is from the corrected
window and **supersedes the baseline published with #106**, which was measured in the 3x3. Its 239 `crowded`
contract abandonments, and every figure derived from them, came from the harness rather than the game. On 2026-10-08
W2-2's caravan spine joined `HARNESS_SHIPPED_ARMS`, and the [baseline](#baseline) was re-published with it. W3-5's
errand press joined the same day, and the baseline was re-published again; so it was once more when W3-4's
remnants and streaming hold joined. W3-3's HP cap and first-staging composition now join W3-1's managed squad in
the shipped arms, and the baseline is re-published below.

`tests/runHarness.ts` drives whole campaigns headlessly through the real generator, terrain, collision, navigation,
chronicle, campaign director, combat resolver and actor AI. The gameplay review of 2026-10-06 used it for 330 runs and
said why its difficulty numbers could not guide tuning: it had no squad, no healing, and it counted events instead of
fighting them. This document describes what was added, how to run it, and the baseline it now produces.

## What was added

Every addition is an opt-in arm. With all of them at their defaults a run is the run every pinned number in
`runHarness.test.ts`, `runHarnessSchedules.test.ts`, `runHarnessSweep.test.ts` and the other harness tests describes.
`HARNESS_SHIPPED_ARMS` turns them all on.

| Arm | Default | Shipped | Control |
| --- | --- | --- | --- |
| `squad` | `off` | `starting`: the faction's three starters | `decoy`: the same bodies, never striking |
| `sustain` | `off` | `shipped`: wounds, rations, healers, medicine, loot, gold | `visit`: the same trips, no healing |
| `eventModel` | `counted` | `fought`: director, contracts, located fights, waves, road cart | `counted` |
| `eventPolicy` | `ignore` | `ignore`; `engage` detours to fights and the road cart | — |
| `eventDirector` | `shipped` | `shipped` | `silent`: no random events, everything else kept |
| `playerKit` | `harness` | `shipped`: 8.2 m/s, faction damage, the engine's spawn | `harness` |
| `encounterModel` | `harness` | `shipped`: `createGeneratedEncounterPlans` and the finale | `harness` |
| `encounterHealth` (W3-3) | `legacy`: clock × difficulty | `capped`: combined cap at 1.65 | `legacy` |
| `encounterComposition` (W3-3) | `legacy`: generated roles | `tiered`: first-staging mixes | `legacy` |
| `regionWindow` | `square`; `engine` with shipped encounters or fought events | `engine`: the plus | `square` |
| `commanders` | `inert`: a body and a swing | `shipped`: W1-6's call for men | `legacy`: the call before W1-6 |
| `staging` | `none`: nobody steps back | `friendly`: W1-6's own packs make room | `none` |
| `escalation` (W2-1) | `time` | `progress`: pacing follows progress, enemy stats the clock | `time`; `progressAll` |
| `caravanBeats` (W2-2) | `off`: before the spine | `shipped`: the caravan spine | `beatPolicy`: `walk`, `ignore` |
| `rumourSteering` (W2-3) | `cart`: an escort's cart's square | `meeting`: where its cart is met | `cart` |
| `errand` (W3-5) | `clear`: waits for no hostile within 12 m | `press`: the engine's `E` at the errand | `clear` |
| `encounterMemory` (W3-4) | `fresh`: a pack comes back whole | `remnants`: its dead and wounds stay | `fresh` |
| `streaming` (W3-4) | `instant`: on the player's square | `held`: 16 m before a turn back recentres | `instant` |
| `squadResource` (W3-1) | `legacy`: player-only care, old recruits, full pay | `managed` | component arms |

- **Squad.** `getStartingSquad`'s starters spawn where `spawnGeneratedStartingSquad` puts them, follow in formation
  through `selectSquadIntent` and `getSquadFollowSpeed`, fight through the squad's own `selectThreat` pass and the
  `CombatResolver` tables, and stay dead. Under `squadResource: 'managed'`, only an elf rescue recruits its captive;
  wooden-house defences, kept guard orders, villain press-gangs and the old-fort muster are the other embodied routes.
- **Body and purse.** Hits roll `shouldInjurePlayer` and `injurePlayer`'s limb table; a lost limb bleeds and a lost leg
  slows. The starting boon ration is in the bag. The scripted player eats below half health, detours up to 90 m to a
  healer (+40, full stamina, wounds and bleeding cleared) or a trader (medicine +55, prostheses) when below 65 % or
  bleeding, and claims treasure. Gold comes from kills, loot, treasure, events, contracts and caravans at the
  engine's rates; prices follow the square's supply. W3-1's scripted policy treats a companion only while doing so
  leaves one ration for the player. That is a harness policy, not a game rule.
- **Events as fights.** The five player-anchored builders, the five located builders, the director's weights and
  cooldowns, the threat wave and the road caravan are copied as data in `tests/runHarnessEvents.ts`.
  `tests/runHarnessFidelity.test.ts` loads the shipped `GameEngine` class and calls its own builders with the same
  random-stream state: every spawn, clock, reward and draw count has to match.
- **Who gets the cart.** W1-2's `world/CaravanClaim.ts` runs as shipped. Once a cart's escort is down, a looter has to
  stand at it for 3.5 s and any blow that lands breaks the channel. A player who won the escort fight keeps the cart
  for 9 s, the squad never loads it, and an ambush's raiders walk to their cart. The fidelity test drives this wiring
  beside the engine's `updateCaravanEscort` and the ambush's `update`, frame for frame. Since W2-2 an ambush of the
  player's own side's cart is defended, not robbed: there is nothing to take, it is won when both raiders are down,
  and it pays 90 instead of 140, as `startCaravanAmbushEvent` and `resolveLocatedEventOutcome` do.
- **Contracts as the engine runs them, W1-1 included.** Before the fix landed, the harness reproduced the defect: seed
  31677 as the elf lost its contract to a bounty, and the same run with the director held `silent` kept it. The
  fidelity test written to go red when the fix landed did. Now a random event the player was merely near stands down,
  and the contract waits while the player is fighting one. Located fights are handed back to make room, the director
  keeps out within 120 m of an un-started contract, and only a genuine stall, `crowded` or `noGround`, spends the
  12 s grace. Seed 95029 shows the stand-down in a whole run.
- **The finale** is driven by `FinaleDirector.advanceFinale` and `resolveFinaleContactTargets`: tells, footprints,
  charges and volleys, not an ordinary swing.
- **W3-3 generated encounters.** `encounterHealth: 'capped'` shares the engine's 1.65 combined hostile HP ceiling.
  `encounterComposition: 'tiered'` shares its isolated staging decision: actor count and stations stay fixed, while
  existing roles form faction-specific screens and heavy lines from the pacing tier. A remnant keeps that role
  signature. The controls restore the uncapped product or the generator's original roles independently.
- **Commanders' call for men (W1-6).** `updateCommander` calls a soldier every 25 s, four per commander each time he
  is fielded. `legacy` is the rule before W1-6: every commander, all the time, each call borrowing room the budget
  lends. `shipped` is the rule now: a commander who is not hostile to the player calls only while his own people are
  fighting, and every call takes a slot out of `campaign`'s own share or waits. The clock, the gate and the admission
  are exported (`advanceCommanderClock`, `commanderGathers`), and the fidelity test steps them beside the engine's own
  `updateCommander` frame for frame. Only the guard meets such a commander: the boss slots of the elf's and the
  villain's finales are the guard's own strongholds, so for the guard they field friendly garrisons, each led by one.
- **The player's own packs make room (W1-6).** When the contract the player stands on is still short of room once
  the game's own events made way, `world/StagingRoom.ts` picks the generator's ordinary packs that are not hostile
  to the player, idle, unhurt, at least 60 m away and outside the camera's view. They step back into their squares,
  farthest first, as many as the contract is short. They come home when no staging has asked for 4 s, the whole
  pack fits and none of its stations is in view or within 60 m, or with their square. A player who walks within
  25 m of one of its stations calls the pack home, and from then on only sight keeps it away (the empty-post
  rule). The harness and the engine share the module. The harness's camera is the engine's at rest:
  `cameraOrbitDistance` behind the heading at `CAMERA_DEFAULT_PITCH`, `CAMERA_BASE_FOV` on 16:9. The fidelity test
  has the engine's own `updateCamera` pose its camera and holds the harness's cone to what the engine's
  `stagingViewer` reads off it.

### Walk speed: the harness's 6.4 m/s is not the engine's 8.2

The engine's `updatePlayer` walks at 8.2 m/s, ×1.65 when sprinting, ×1.14 for an elf in the forest, and slower with
a lost leg. The harness's own kit, `playerKit: 'harness'`, walks at 6.4 m/s (`HARNESS_PLAYER_SPEED`). That is the
default and every pinned arm, so every pinned travel time and run length in the suite was walked at 6.4. The number
was never the engine's; it stays because changing it would move every pinned number. `playerKit: 'shipped'`
(`HARNESS_SHIPPED_PLAYER_SPEED`) walks at the engine's 8.2 with its multipliers, and so does the baseline below,
because `HARNESS_SHIPPED_ARMS` carries the shipped kit. A path walked at 6.4 takes 8.2 / 6.4 ≈ 1.28 times as long as
the engine's walk; fights and waits do not scale. In the ablation the harness kit, which also hits for 28 and spawns
on the start site, wins about as often and takes about 30 s longer per win: a beeline p50 of 119 s against 90 s.

### Streaming window: the engine simulates a plus, not the 3x3

`GeneratedWorldRuntime` builds its `RegionManager` with `visibleRadius: 1` and `simulationRadius: 1`. The engine shows
the 3x3 block of squares around the player, Chebyshev distance 1. It simulates only the five-square plus inside it,
Manhattan distance 1: the player's square and its four neighbours. Encounters spawn, situations materialize, the
chronicle freezes and navigation routes in the plus alone. Until W1-6 found it, the harness simulated the whole 3x3,
which in the middle of the map means nine squares of encounters where the engine has five.

The pinned arms keep the 3x3, because every pinned number was measured in it. A run with the shipped encounters or the
fought events uses `regionWindow: 'engine'`, which reads both sets off a real `RegionManager` built with the runtime's
options. The fidelity test walks a real `GeneratedWorldRuntime` over every square of the map and runs the engine's own
`syncGeneratedRegions` after each step. The harness has to name the squares the engine spawns encounters in, in its
order, and the 3x3 is told apart from it on every square. The harness still lifts the fog on the visible 3x3.

The 3x3 put 17.2 encounter bodies on the road at once against the plus's 11.1, and kept the actor budget full for
45 s a run, which is what refused the contract builders. With `regionWindow: 'square'`, the shipped arms give #106's
baseline back exactly, cell for cell.

**Known engine behaviour, mirrored rather than fixed — until W3-4.** When a square streamed back into the plus, the
engine refielded every encounter in it that was not cleared, at full health. Only uniques and cleared encounters were
remembered, in the region's delta. A player who crossed back and forth over a square's edge met the same encounter
again each time, unhurt, and the damage they dealt was erased. The harness did the same, so its numbers included it: a
`cautious` run, whose retreats cross edges, spawned 477 to 1 080 encounter bodies against about 70 for the other
policies. W3-4 fixed both halves: `encounterMemory` keeps what is left of a pack, and `streaming` holds the window's
centre for 16 m when the player turns back into the square just left. See
[its section](#w3-4-what-is-left-of-a-pack-недобитые-and-a-world-that-does-not-jump-back).

Since W3-4 the `engine` window is centred where `GeneratedWorldRuntime` centres it. The harness advances the same
`world/StreamingCentre.ts` state the runtime does, frame by frame, and reads the visible 3x3 and the simulated plus
around that centre off its `RegionManager`. `streaming: 'instant'` is the window before W3-4, centred on the player's
square. A second fidelity test walks the runtime over edge oscillations, a return deeper than the hold and a corner of
four squares, and the held window has to match the engine on every frame; the instant window is told apart.

## Metrics

Every report carries a `balance` block, populated by the arms that feed it. Nothing in it draws from any stream.

- **Caravans:** robbed, escorted and lost, by cart; robberies lost to NPCs, and the squad's share of them, which W1-2
  keeps at zero; claims the player opened, loads started and loads the player broke.
- **Contracts:** started, kept, failed, abandoned, and why each abandoned contract stalled (`crowded` or `noGround`).
  `lostToEvents` counts W1-1's symptom, a contract abandoned while a random event was up. Also counted: seconds a
  contract waited on its site and why, located fights handed back to make room, and random events stood down.
- **Rumour feasibility:** for every offer, the atlas's road ETA from where the player stood against the time to its
  deadline, and the share beyond reach. W2-3 adds, per run, the candidates the board looked at while an offer was due
  and how many it turned down as beyond reach (`candidatesSeen`, `candidatesUnreachable`), and what kept rumours paid
  into the purse (`rewardGold`, `rewardRations`). The pay only lands while `sustain` models the purse. Kept and broken
  rumours are also counted by kind (`keptByKind`, `brokenByKind`), so an escort's keep rate reads on its own.
- **Companions:** started, recruited, lost and to whom, standing when the finale opened and at the end, their kills.
- **Squad resources (W3-1):** companion healing and treatment actions by source, recovery-site uses, replacements by
  faction and source, attended guard deliveries and confiscations, reduced settlements, personal gold withheld, and
  contributed fights that settled beyond 40 m without losing full pay.
- **Doctrine drafts reached** and the **maximum threat tier**, whatever the doctrine arm.
- **W2-1:** every tier rise with its cause (`time` or `progress`), when each draft actually opened and how many of
  them the 30 s ceiling opened outside a calm moment (`draftsForced`), the finale's pacing tier and the clock's tier
  its boss was scaled by, and threat waves by trigger (clock or closed objective).
- **Damage by system** (encounter, finale, random, contract or located event, threat wave, caravan, bleeding) and the
  **system behind each death**.
- **Encounters:** how many the generator fielded, the bodies it spawned, how many stood on the road at once on
  average, and the seconds in which the actor budget refused one. The report's `regionWindow` names the window. Also
  the soldiers commanders called (W1-6), which count on the road once called, the packs that stepped back to make
  room for a contract and came home again, and how many of those the player called home from their posts (W1-6).
  W3-4 adds the survivors fielded again with their wounds (`remnantSurvivorsRestored`), the fallen passed over
  (`remnantFallenSkipped`), and the bodies fielded within 30 s of the same member leaving with its square
  (`refieldedWithin30s`), which is the churn of a crossing. `encounterTrace: true` records every member fielded,
  leaving alive and falling, for the invariant test. The streaming cost is counted too: the times the window moved
  its centre (`centreSwitches`), the squares that entered the simulated plus and the visible 3x3 after the first frame
  (`simulatedActivations`, `visibleActivations`; `sweepBalance` reports them per minute of run), and the hostile
  pursuers that left the field because their square streamed out (`pursuersStreamedOut`). W3-3 adds the largest
  hostile health multiplier, packs first staged by pacing tier and role signature, first-exchange-to-clear time by
  the same tier/mix key, and victories grouped by the highest tier reached.
- `sweepBalance` aggregates them per faction and policy, with the run-length distribution.
- **The errand's site (W3-5), per run only:** when the player first stood within 6 m of it while the errand was the
  active node, when the errand completed, and for how long before that something hostile stood within 12 m
  (`errandSite`).

## Running it

```bash
node --experimental-strip-types --test tests/runHarnessBalance.test.ts
KOROVANY_BALANCE_SEEDS=40 node --experimental-strip-types --test tests/runHarnessBalance.test.ts
```

The committed file runs in about 20 s: its sweep takes three seeds per cell and asserts bands that held at forty.

## Baseline

`HARNESS_SHIPPED_ARMS`, 30 Hz, 600 s limit, seeds `1 + 7919 n` for n = 0...39: 360 runs on W3-3 over
`main` at `8cd281f`, in the engine's streaming window. The matched control changes only
`encounterHealth: 'capped'` to `legacy` and `encounterComposition: 'tiered'` to `legacy`.
Cap-only and composition-only arms attribute the result; every arm keeps W3-1's managed squad,
W3-2's shipped combat economy, W3-4's remnants/streaming hold and all other shipped rules.

| Policy · faction | Shipped win / defeat / timeout | Control | Won in p10-p50-p90 | Damage | Kills |
| --- | --- | --- | --- | ---: | ---: |
| beeline · elf | 14 / 26 / 0 | 16 / 24 / 0 | 88-130-164 s | 192 | 8.0 |
| beeline · guard | 17 / 23 / 0 | 16 / 24 / 0 | 103-132-191 s | 163 | 10.2 |
| beeline · villain | 19 / 21 / 0 | 19 / 21 / 0 | 85-110-165 s | 154 | 9.0 |
| cautious · elf | 13 / 11 / 16 | 16 / 11 / 13 | 88-130-164 s | 173 | 7.5 |
| cautious · guard | 14 / 13 / 13 | 13 / 14 / 13 | 103-123-229 s | 152 | 10.0 |
| cautious · villain | 13 / 14 / 13 | 11 / 16 / 13 | 85-104-157 s | 143 | 8.7 |
| duelist · elf | 32 / 8 / 0 | 34 / 6 / 0 | 103-139-209 s | 185 | 18.8 |
| duelist · guard | 36 / 4 / 0 | 32 / 8 / 0 | 104-144-201 s | 135 | 20.1 |
| duelist · villain | 34 / 6 / 0 | 27 / 13 / 0 | 102-130-174 s | 150 | 16.9 |

| Policy · faction | Squad at finale | Drafts | Tier | Contracts s/k/a | Road | Late rumours | Carts |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| beeline · elf | 2.8 (37/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.0 | 6% | 2.05 |
| beeline · guard | 3.6 (40/40) | 3 / 3 | 4 / 4 | 40 / 37 / 0 | 11.6 | 2% | 2.10 |
| beeline · villain | 3.2 (39/39) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.7 | 4% | 2.10 |
| cautious · elf | 2.8 (34/37) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.7 | 7% | 2.03 |
| cautious · guard | 3.6 (39/40) | 3 / 3 | 4 / 4 | 40 / 37 / 0 | 11.0 | 2% | 2.10 |
| cautious · villain | 3.2 (37/37) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.1 | 8% | 2.05 |
| duelist · elf | 3.3 (37/37) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 9.8 | 15% | 2.00 |
| duelist · guard | 3.7 (39/39) | 3 / 3 | 4 / 4 | 40 / 33 / 0 | 10.5 | 3% | 2.08 |
| duelist · villain | 3.3 (38/38) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.9 | 8% | 2.13 |

- **Wins.** Shipped wins 192/360 against 184/360: beeline 50 against 51, cautious 40 against 40 and duelist
  102 against 93. Duelist clears the 96/120 floor and aims past 100. No policy rises by more than 9 or falls by
  more than 1. Cap-only is 51 / 40 / 93, identical to control; composition-only is 50 / 40 / 102, the shipped
  totals. The cap changes one cautious-guard defeat/timeout classification but no victory.
- **Attribution.** Duelist cells move elf 34->32, guard 32->36 and villain 27->34. The villain duelist's six
  defeats are encounters 2, finale 3 and located events 1; it had 13 defeats under control.
- **HP.** The theoretical clock/difficulty product is capped from 2.1904 to 1.65. The panel reaches the cap in
  long cautious cells, while most two-to-three-minute runs stage bodies at 1.36-1.52; this is why the cap arm
  moves no win by itself.
- **Safety.** All 360 runs start their contract, none abandon one, and every caravan beat reports zero staging
  stall/fail-forward. Generated bodies on the road remain 9.8-11.7 by cell; the largest mean actor-budget
  refusal is 0.34 seconds per guard run. Actor count and reservations are unchanged.
- **Deaths.** Over 120 runs per side, elves die to finale 23, located fights 9, encounters 6, bleeding 3 and
  one each to random events, a threat wave and a caravan. Guards die to finale 22, bleeding 8, located fights 6
  and encounters 4. Villains die to encounters 16, finale 15, located fights 4, bleeding 4 and caravan beats 2.
- **Highest tier.** Every victory reaches pacing tier 4; the report stores wins by highest tier rather than
  inferring it from the median.

The harness records every exact tier/role signature. Representative first-exchange-to-clear samples, chosen by
frequency rather than by result, are:

| Tier | Owner · mix | Fights | Mean clear |
| ---: | --- | ---: | ---: |
| 1 | villain · brute + archer | 25 | 6.8 s |
| 1 | guard · brute + archer | 17 | 17.4 s |
| 1 | elf · champion + archer | 10 | 9.0 s |
| 2 | villain · minion + archer | 22 | 13.6 s |
| 2 | villain · brute + archer | 19 | 7.7 s |
| 2 | guard · brute + archer | 16 | 5.8 s |
| 3 | guard · soldier + archer | 16 | 4.0 s |
| 3 | guard · archer + soldier | 11 | 10.0 s |
| 3 | villain · brute + archer | 11 | 6.4 s |
| 4 | villain · brute + brute | 7 | 6.1 s |
| 4 | guard · brute + brute | 4 | 5.5 s |
| 4 | guard · archer + brute | 3 | 3.5 s |

These durations include any time a cautious script leaves after the first exchange and comes back; they are not
isolated arena DPS. The full map, including sparse four-body mixes, is in each cell's
`timeToKillByTierAndMix` block.

The caravans by side are regenerated from the candidate cells. Timings are beeline / cautious / duelist:

| Side | Verbs over 120 runs | Camp p50 | Gate p50 | Press recruits; guards thinned |
| --- | --- | --- | --- | --- |
| Elves | take 106, give 135 | 25 / 25 / 25 s | 88 / 89 / 99 s | - |
| Palace guard | confiscate 103, deliver 67, release 79 | 18 / 18 / 18 s | 88 / 88 / 101 s | - |
| Villain | plunder 93, press 52, burn 105 | 17 / 17 / 19 s | 83 / 85 / 91 s | 52; 70 |

### Superseded: W3-1 baseline before W3-3

`{ ...HARNESS_SHIPPED_ARMS, encounterHealth: 'legacy', encounterComposition: 'legacy' }`, 30 Hz, 600 s limit,
seeds `1 + 7919 n` for n = 0…39: 360 runs on W3-1's branch over `main` at 6bb640e, in the engine's streaming
window. The matched control changes only `squadResource: 'managed'` to `squadResource: 'legacy'`. Both arms keep
W3-2's shipped combat economy and heavy melee defence, W3-4's remnants and streaming hold, and every earlier arm.

| Policy · faction | Managed win / defeat / timeout | Legacy | Won in p10-p50-p90 | Damage | Kills |
| --- | --- | --- | --- | ---: | ---: |
| beeline · elf | 16 / 24 / 0 | 12 / 28 / 0 | 88-125-158 s | 184 | 7.7 |
| beeline · guard | 16 / 24 / 0 | 16 / 24 / 0 | 101-132-173 s | 164 | 10.2 |
| beeline · villain | 19 / 21 / 0 | 17 / 23 / 0 | 87-116-146 s | 151 | 8.5 |
| cautious · elf | 16 / 11 / 13 | 11 / 8 / 21 | 88-125-266 s | 161 | 7.2 |
| cautious · guard | 13 / 14 / 13 | 12 / 17 / 11 | 101-131-164 s | 149 | 10.0 |
| cautious · villain | 11 / 16 / 13 | 9 / 17 / 14 | 89-116-160 s | 143 | 8.1 |
| duelist · elf | 34 / 6 / 0 | 33 / 7 / 0 | 103-141-176 s | 187 | 18.2 |
| duelist · guard | 32 / 8 / 0 | 31 / 9 / 0 | 109-143-187 s | 139 | 20.1 |
| duelist · villain | 27 / 13 / 0 | 27 / 13 / 0 | 101-128-166 s | 148 | 16.7 |

| Policy · faction | Squad at finale | Drafts | Tier | Contracts s/k/a | Road | Late rumours | Carts |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| beeline · elf | 2.9 (39/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.0 | 6% | 2.05 |
| beeline · guard | 3.6 (39/40) | 3 / 3 | 4 / 4 | 40 / 37 / 0 | 11.5 | 2% | 2.10 |
| beeline · villain | 3.3 (39/39) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.7 | 4% | 2.08 |
| cautious · elf | 3.0 (37/37) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.2 | 14% | 2.00 |
| cautious · guard | 3.5 (38/40) | 3 / 3 | 4 / 4 | 40 / 37 / 0 | 11.0 | 1% | 2.10 |
| cautious · villain | 3.3 (37/37) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.8 | 5% | 2.03 |
| duelist · elf | 3.3 (37/37) | 3 / 3 | 4 / 4 | 40 / 39 / 0 | 9.9 | 13% | 1.98 |
| duelist · guard | 3.7 (40/40) | 3 / 3 | 4 / 4 | 40 / 33 / 0 | 10.5 | 6% | 2.10 |
| duelist · villain | 3.3 (37/37) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.9 | 8% | 2.10 |

- **Wins.** Managed wins 184/360 against 168/360 under `legacy`: beeline 51 against 45, cautious 40 against 32,
  duelist 93 against 91. Every one of the 184 winning runs reached its finale with at least one companion. Policy
  movements are +6, +8 and +2 of 120, inside the scaled +12/120 control band.
- **Care.** Elves, guards and villains use 1.28, 1.08 and 0.51 companion treatments a run and restore 38.2, 26.1
  and 11.3 companion HP. No site is used more than twice. The script spends a ration on a companion only above one
  in the bag; without that reserve the duelist falls from 96 to 89 wins.
- **Replacements.** Elves receive 46 from rescues, guards 122 from kept caravan orders and villains 51 from
  press-gang, or 0.38, 1.02 and 0.43 a run. No muster was collected by this straight-line policy.
- **Credit.** Eight fights settled without a player contribution and withheld 358 personal gold. Twelve contributed
  guard fights settled beyond 40 m and kept full pay, the negative control for the removed distance penalty.
- **Economy.** Mean gold is 433.8 a run against 440.6 under `legacy`, 1.5% lower and inside the 5% band.

The caravans by side, measured on the managed arm. Timings are beeline / cautious / duelist:

| Side | Verbs over 120 runs | Camp p50 | Gate p50 | W3-1 replacements; guards thinned |
| --- | --- | --- | --- | --- |
| Elves | take 106, give 133 | 25 / 25 / 25 s | 88 / 89 / 103 s | 46; - |
| Palace guard | confiscate 103, deliver 65, release 79 | 18 / 18 / 18 s | 87 / 87 / 101 s | 122; - |
| Villain | plunder 93, press 51, burn 103 | 17 / 17 / 19 s | 83 / 85 / 90 s | 51; 68 |

### W3-1 attribution and policy control

The care effect was isolated before W3-2 joined the shipped arms. Wins over the moved cells:

| Cell | Legacy | Care | Recovery limit | Replenishment | Credit |
| --- | ---: | ---: | ---: | ---: | ---: |
| elf beeline | 9 | 20 | 9 | 9 | 9 |
| elf cautious | 9 | 17 | 9 | 9 | 9 |
| guard beeline | 18 | 16 | 18 | 13 | 18 |
| guard cautious | 13 | 6 | 13 | 11 | 13 |
| villain duelist | 25 | 26 | 25 | 25 | 25 |
| duelist total | 96 | 86 | 96 | 96 | 96 |

Care is the moving part. Unreserved, it removes elf road/finale deaths but spends the guard's last ration and moves
guard deaths into bleeding and the finale. Reserving one ration changes elf beeline 19 to 13 wins, elf cautious 16
to 13, guard beeline 13 to 16, guard cautious 6 to 13, villain duelist 26 to 27, and the duelist total 89 to 96.
This is a scripted-player policy, not a game rule. The UI instead warns when the player chooses to spend the last one.

The guard split found no cost from elf-only rescues: 18/40 wins, as legacy. Kept-order soldiers alone were 13/40
on the first seed set but 22/40 against legacy's 11/40 on n=40..79. Pooled, guard soldiers win 35/80 against 29/80;
the first set's five extra finale deaths reverse to seven fewer on the second. Distance is unchanged, so the harness
is not detouring for the outcome. Villain beeline similarly wins 43/80 against 37/80 across both sets. These paired
sets show why a +/-4/40 cell band is narrower than this harness's per-cell noise.

### Superseded: W3-2 baseline before the joint W3-1 panel

`HARNESS_SHIPPED_ARMS`, 30 Hz, 600 s limit, seeds `1 + 7919 n` for n = 0…39: 360 runs on W3-2's branch based on
`6896062`, in the engine's streaming window. The matched control changes only `combatEconomy: 'legacy'`; both arms
keep `meleeDefence: 'heavy'`, W3-4's remnants and streaming hold, and every other shipped arm. The control reproduces
main's 360 runs byte for byte when the W3-2-only metrics are left out. This baseline supersedes it.
With `encounterMemory: 'fresh'` and `streaming: 'instant'`, all 360 normalized report hashes also match main after
the W3-4 encounter metrics and W3-2 report-only fields are removed.

| Policy · side | Outcome | Prior | Win p10–p50–p90 | Taken / dealt | Whiff | Heavy avoid | Starved mean / rate |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| beeline · elf | 12 / 28 / 0 | 9 / 31 / 0 | 89–118–155 s | 246 / 1250 | 23.8 % | 18.2 % | 0.70 / 4.6 % |
| beeline · guard | 16 / 24 / 0 | 18 / 22 / 0 | 103–138–217 s | 171 / 1449 | 23.3 % | 19.5 % | 3.08 / 16.7 % |
| beeline · villain | 17 / 23 / 0 | 20 / 20 / 0 | 87–112–165 s | 166 / 1198 | 27.6 % | 20.7 % | 0.80 / 5.8 % |
| cautious · elf | 11 / 8 / 21 | 9 / 10 / 21 | 89–118–155 s | 212 / 1121 | 24.3 % | 21.2 % | 0.57 / 4.1 % |
| cautious · guard | 12 / 17 / 11 | 13 / 14 / 13 | 103–130–172 s | 158 / 1391 | 24.6 % | 26.6 % | 2.55 / 14.4 % |
| cautious · villain | 9 / 17 / 14 | 10 / 12 / 18 | 84–106–165 s | 150 / 1082 | 28.9 % | 25.0 % | 0.53 / 4.2 % |
| duelist · elf | 33 / 7 / 0 | 36 / 4 / 0 | 103–141–173 s | 192 / 2190 | 17.6 % | 77.8 % | 3.40 / 13.1 % |
| duelist · guard | 31 / 9 / 0 | 35 / 5 / 0 | 109–145–196 s | 145 / 2583 | 15.3 % | 78.1 % | 3.50 / 12.9 % |
| duelist · villain | 27 / 13 / 0 | 25 / 15 / 0 | 101–128–166 s | 150 / 2033 | 19.0 % | 76.2 % | 1.50 / 7.1 % |

| Policy · faction | Squad at finale | Drafts p50/max | Tier p50/max | Contracts s/k/a | Road | Late rumours | Carts |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| beeline · elf | 2.6 (38/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.0 | 6 % | 2.05 |
| beeline · guard | 2.4 (36/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 11.6 | 0 % | 2.15 |
| beeline · villain | 3.3 (39/39) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.7 | 4 % | 2.08 |
| cautious · elf | 2.7 (37/37) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.2 | 15 % | 2.00 |
| cautious · guard | 2.4 (36/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 11.2 | 3 % | 2.15 |
| cautious · villain | 3.3 (38/38) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.7 | 8 % | 2.05 |
| duelist · elf | 3.2 (37/37) | 3 / 3 | 4 / 4 | 40 / 39 / 0 | 9.9 | 13 % | 2.00 |
| duelist · guard | 2.6 (40/40) | 3 / 3 | 4 / 4 | 40 / 34 / 0 | 10.5 | 1 % | 2.10 |
| duelist · villain | 3.3 (38/38) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.9 | 9 % | 2.13 |

Squad at finale is the mean number of companions standing when the finale opened, recruits included, and in brackets
the finales at least one of them reached. Tier is the highest threat tier reached; every finale fielded was fought at
pacing tier 4. Contracts are started, kept and abandoned. Road is the mean generated encounter bodies on the field.
Carts are the spine's caravans a run met: resolved, lost or escaped.

Over all 360 runs, against the matched prior combat:

- **Wins.** 168 against 175. Beeline moves 47→45, cautious stays 32 and duelist moves 96→91. Each policy stays inside
  its allowed loss, and no faction/policy cell moves by more than 4 of 40.
- **Combat economy.** Duelists whiff 15.3–19.0 % of their own beats, avoid 76.2–78.1 % of telegraphed heavies and
  fall back from a finisher for stamina on 7.1–13.1 % of attempts. Damage taken moves +0.7 % overall,
  63 150 → 63 597, while damage dealt moves −2.2 %, 584 699 → 571 823.
- **Reaction sensitivity.** At 0.20 s, duelist wins are elf 33, guard 34 and villain 27; guard damage falls from
  145 to 141 and heavy avoidance rises from 78.1 % to 79.8 %. At 0.30 s the result is the shipped 0.25 s result
  cell for cell: 33 / 31 / 27. No 0.25 s script answers a 0.18–0.26 s tell it cannot clear.
- **Villain duelist deaths.** Prior combat: encounters 4, caravan beats 0, bleeding 0, finale 8, other systems 3.
  Shipped: encounters 3, caravan beats 0, bleeding 1, finale 7, other systems 2.
- **Run length.** 272 runs end inside three minutes and 46 reach ten minutes.
- **Deaths.** 146 defeats: the finale 61, road encounters 36, bleeding 23, located fights 22, caravan beats 2,
  and one each to a random event and a contract fight. The finale deals the most damage (20 960), then encounters
  (16 513), caravan beats (10 426), located fights (7 579) and contract fights (4 841).
- **Caravans.** The spine settles 748 carts: 742 resolved, 5 lost and 1 escaped, with no staging stall. Its players
  rob 594 and escort 148. Including road carts and chronicle ambushes, they rob 679 and escort 196; NPCs take 18
  after a full load, and the squad none.
- **Contracts.** All 360 runs start their contract: 343 kept, 16 failed and none abandoned. Random events stand
  down 112 times for a contract or caravan, and 57 located fights are handed back to make room.
- **Encounters and events.** The generator fields 20.0 encounters a run, with 11.0 bodies on the road and 0.05 s
  of actor-budget refusal. There are 490 random events, 3 436 located fights and 334 threat waves.
- **Rumours.** 39 of 571 offers (7 %) are beyond reach by the independent road-only estimate.
- **Economy.** A run earns about 441 gold, spends 23 and heals 103 health.
- **Squad.** A companion reaches 339 of 349 finales.

The caravans by side are regenerated from the same shipped cells. Timings are each policy's p50, beeline / cautious /
duelist:

| Side | Verbs over its 120 runs | Camp closed, p50 | Gate opened, p50 | Recruits, guards thinned |
| --- | --- | --- | --- | --- |
| Elves | take 106 (44 %), give 134 (56 %) | 25 / 25 / 25 s | 88 / 89 / 103 s | — |
| Palace guard | confiscate 105 (42 %), deliver 69 (27 %), release 79 (31 %) | 18 / 18 / 18 s | 88 / 88 / 104 s | — |
| Villain | plunder 93 (37 %), press 48 (19 %), burn 108 (43 %) | 17 / 17 / 19 s | 82 / 82 / 90 s | 48, 73 |

The camp's offer is taken on the road to the finale in 165 runs and on the other road in 189, the light one in 186
and the rich one in 168; 6 runs meet no offer. The scripted verb policy is unchanged from the prior baseline.

### Superseded: the baseline on 08d0448 with W3-4

`HARNESS_SHIPPED_ARMS`, 30 Hz, 600 s limit, seeds `1 + 7919 n` for n = 0...39: 360 runs on `main` at
08d0448, in the engine's streaming window. This baseline superseded the ones measured on
02059ed with the errand press, on 191cda5 and on 29adca3, kept below for the record. The shipped arms have taken in
W2-1's progress tier, W2-2's verbs and defended carts, W2-3's reachable rumours and meeting compass, W2-2's caravan
spine (`caravanBeats: 'shipped'`), W3-5's errand press (`errand: 'press'`) and W3-4's remnants and streaming hold
(`encounterMemory: 'remnants'`, `streaming: 'held'`): what a new run plays. "Spine off" is the same 360 runs with
`caravanBeats: 'off'`.

| Policy · faction | Win / defeat / timeout | Spine off | Won in p10–p50–p90 | Damage taken | Kills |
| --- | --- | --- | --- | ---: | ---: |
| beeline · elf | 9 / 31 / 0 | 14 / 26 / 0 | 88–129–173 s | 245 | 8.5 |
| beeline · guard | 18 / 22 / 0 | 19 / 21 / 0 | 103–140–210 s | 169 | 10.9 |
| beeline · villain | 20 / 20 / 0 | 18 / 22 / 0 | 87–107–138 s | 160 | 9.1 |
| cautious · elf | 9 / 10 / 21 | 12 / 8 / 20 | 88–129–173 s | 220 | 7.9 |
| cautious · guard | 13 / 14 / 13 | 14 / 17 / 9 | 103–147–184 s | 160 | 10.7 |
| cautious · villain | 10 / 12 / 18 | 18 / 10 / 12 | 84–98–132 s | 144 | 8.5 |
| duelist · elf | 36 / 4 / 0 | 37 / 3 / 0 | 103–141–189 s | 187 | 18.6 |
| duelist · guard | 35 / 5 / 0 | 35 / 5 / 0 | 111–144–186 s | 141 | 20.6 |
| duelist · villain | 25 / 15 / 0 | 38 / 2 / 0 | 102–129–171 s | 153 | 17.3 |

| Policy · faction | Squad at finale | Drafts p50/max | Tier p50/max | Contracts s/k/a | Road | Late rumours | Carts |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| beeline · elf | 2.6 (36/39) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.0 | 6 % | 2.02 |
| beeline · guard | 2.4 (36/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 11.6 | 0 % | 2.15 |
| beeline · villain | 3.1 (39/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.7 | 4 % | 2.10 |
| cautious · elf | 2.6 (35/39) | 3 / 3 | 4 / 4 | 39 / 39 / 0 | 10.5 | 9 % | 2.00 |
| cautious · guard | 2.4 (36/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 11.1 | 0 % | 2.15 |
| cautious · villain | 3.1 (39/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.3 | 14 % | 2.10 |
| duelist · elf | 3.3 (38/38) | 3 / 3 | 4 / 4 | 40 / 39 / 0 | 9.9 | 13 % | 2.00 |
| duelist · guard | 2.7 (39/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 10.5 | 5 % | 2.13 |
| duelist · villain | 3.3 (38/38) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.9 | 5 % | 2.13 |

Squad at finale is the mean number of companions standing when the finale opened, recruits included, and in brackets
the finales at least one of them reached. Tier is the highest threat tier the campaign reached; every finale fielded
was fought at pacing tier 4 (3 with the spine off). Contracts are started, kept and abandoned. Road is the mean number
of the generator's encounter bodies on the field over the run. Carts are the spine's caravans a run met: resolved,
lost or escaped.

Over all 360 runs, against the spine off:

- **Wins.** 175 against 205: beeline 47 against 51, cautious 32 against 44, duelist 96 against 110. The duelist's loss
  is mostly the villain's, 25 of 40 against 38: it dies on the way 7 times against once, 4 of them to the road's
  encounters, and at the finale 8 times against once. Wave 3's combat economy is to tune that with this instrument.
- **Run length.** 264 runs end inside three minutes (303 with the spine off), and the median win of a cell grows from
  77–107 s to 98–147 s. The 52 that reach ten minutes are all cautious stalls (41 with the spine off). No beeline run
  stalls.
- **Deaths.** 133 defeats:
  - the finale, 62;
  - the road's encounters, 32;
  - located fights, 19;
  - bleeding, 14;
  - random events, 4;
  - one each to a threat wave and a contract's fight.

  The finale deals the most damage (21 731), then the road's encounters (15 994), the caravans' escorts (10 027) and
  located fights (7 683). Contract fights deal 4 667.
- **Caravans.** Every side met about two of the spine's caravans a run, 751 in all:
  - 2 were lost and 2 escaped;
  - 1.66 a run were robbed and 0.42 walked in or sent on;
  - the camp closed at a median 17–25 s and the gate opened at 82–98 s, and no cart had to wait for room.

  With the road cart and the chronicle's ambushes, the players robbed 674 carts and escorted 206, against 77 and 20
  with the spine off. NPCs took 29 carts, each after a full load, and the squad none.
- **Contracts.** 359 of the 360 runs reached their contract and started it: 343 kept, 15 failed, none abandoned. 115
  random events stood down for a contract or a caravan (51 with the spine off), and 59 located fights were handed
  back to make room (50).
- **Encounters.** The generator fielded 20.0 encounters per run, with 10.8 of their bodies on the road at once on
  average, and the budget refused one for 0.05 s a run. A `beeline` run spawns 86 encounter bodies, a `duelist` one 82
  and a `cautious` one 137 (95 with the spine off), against 90, 85 and 939 before W3-4. By cell, the window moves its
  centre 4.9 to 5.5 times a minute on a beeline run, 4.1 to 4.9 on a duelist one and 3.5 to 4.7 on a cautious one, and
  brings 12.8 to 14.3, 10.8 to 12.8 and 9.0 to 11.4 squares a minute into the simulated plus, against 14.0, 12.3 and
  41.7 before W3-4. By cell, a beeline run fields 1.3 to 3.0 survivors of packs it met again, with their wounds, a
  cautious one 3.8 to 10.3 and a duelist one 0.1 to 0.4; they pass over 0.4 to 0.8, 1.3 to 3.9 and up to 0.4 fallen.
- **Events.** There were 494 random events, 3 408 located fights and 346 threat waves. The waves dealt 695 damage,
  against 801 before W3-4 and 628 with the spine off.
- **Rumours.** 37 of 583 offers (6 %) were beyond reach by this road-only estimate (24 of 365 with the spine off).
- **Economy.** About 436 gold earned and 23 spent per run (333 and 7). About 103 health healed per run (54): rations
  21 610, healers 5 550, medicine 5 311, loot 4 303, events 220.
- **Squad.** A companion reached 336 of 354 finales (355 of 358).

The caravans by side, the reference wave 3 tunes against. Timings are the median of each policy's 40 runs, beeline /
cautious / duelist:

| Side | Verbs over its 120 runs | Camp closed, p50 | Gate opened, p50 | Recruits, guards thinned |
| --- | --- | --- | --- | --- |
| Elves | take 105 (44 %), give 135 (56 %) | 25 / 25 / 25 s | 87 / 90 / 96 s | — |
| Palace guard | confiscate 106 (41 %), deliver 72 (28 %), release 79 (31 %) | 18 / 18 / 18 s | 88 / 88 / 98 s | — |
| Villain | plunder 96 (38 %), press 46 (18 %), burn 109 (43 %) | 17 / 17 / 19 s | 82 / 82 / 90 s | 46, 75 |

- The verbs are the scripted player's, not a person's: `verbPolicy: 'seeded'` picks uniformly among the verbs a cart
  offers the side, and never press-gangs into a full squad of four. The guard's split is therefore its carts': a raid
  can only be confiscated, an escort is delivered or released. The villain presses least because its squad is often
  full. What each verb is worth in wins, healing and finale damage is in
  [the spine's section](#w2-2-pr-b-the-caravan-spine).
- The camp's offer was taken on the road to the finale in 165 runs and on the other road in 189, the light one in 186
  and the rich one in 168; 6 runs met no offer. The caravans paid about one step of W2-1's progress a run (0.95–1.00
  by cell), two met carts to a step.

### Superseded: the baseline on 02059ed with the errand press

The same protocol on W3-5's branch, `main` at 02059ed with the errand press merged, before W3-4's remnants and
streaming hold joined the shipped arms. It is kept as the record #118 published, and
`{ ...HARNESS_SHIPPED_ARMS, encounterMemory: 'fresh', streaming: 'instant' }` reproduces it: with the spine on, all 360
runs hash to `main`'s at 04c1c7b byte for byte, the new fields left out. "Spine off" is the same 360 runs with
`caravanBeats: 'off'`.

| Policy · faction | Win / defeat / timeout | Spine off | Won in p10–p50–p90 | Damage taken | Kills |
| --- | --- | --- | --- | ---: | ---: |
| beeline · elf | 11 / 29 / 0 | 14 / 26 / 0 | 89–130–156 s | 243 | 8.4 |
| beeline · guard | 18 / 22 / 0 | 17 / 23 / 0 | 103–130–219 s | 167 | 10.8 |
| beeline · villain | 20 / 20 / 0 | 20 / 20 / 0 | 87–110–140 s | 159 | 8.8 |
| cautious · elf | 11 / 8 / 21 | 13 / 10 / 17 | 89–130–156 s | 217 | 7.7 |
| cautious · guard | 17 / 11 / 12 | 14 / 14 / 12 | 103–147–219 s | 158 | 10.8 |
| cautious · villain | 10 / 12 / 18 | 18 / 12 / 10 | 84–98–140 s | 144 | 8.2 |
| duelist · elf | 34 / 6 / 0 | 35 / 5 / 0 | 102–141–188 s | 180 | 18.2 |
| duelist · guard | 33 / 7 / 0 | 35 / 5 / 0 | 111–142–187 s | 144 | 20.0 |
| duelist · villain | 26 / 14 / 0 | 37 / 3 / 0 | 101–130–172 s | 149 | 17.2 |

| Policy · faction | Squad at finale | Drafts p50/max | Tier p50/max | Contracts s/k/a | Road | Late rumours | Carts |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| beeline · elf | 2.5 (37/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.1 | 5 % | 2.05 |
| beeline · guard | 2.4 (36/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 11.7 | 2 % | 2.13 |
| beeline · villain | 3.2 (40/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.7 | 7 % | 2.08 |
| cautious · elf | 2.5 (35/39) | 3 / 3 | 4 / 4 | 39 / 39 / 0 | 11.0 | 9 % | 2.00 |
| cautious · guard | 2.4 (36/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 11.2 | 4 % | 2.13 |
| cautious · villain | 3.2 (40/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.5 | 9 % | 2.08 |
| duelist · elf | 3.4 (37/37) | 3 / 3 | 4 / 4 | 39 / 38 / 0 | 9.9 | 14 % | 1.95 |
| duelist · guard | 2.6 (38/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 10.5 | 7 % | 2.10 |
| duelist · villain | 3.3 (38/38) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.9 | 5 % | 2.13 |

Squad at finale is the mean number of companions standing when the finale opened, recruits included, and in brackets
the finales at least one of them reached. Tier is the highest threat tier the campaign reached; every finale fielded
was fought at pacing tier 4 (3 with the spine off). Contracts are started, kept and abandoned. Road is the mean number
of the generator's encounter bodies on the field over the run. Carts are the spine's caravans a run met: resolved,
lost or escaped.

Over all 360 runs, against the spine off:

- **Wins.** 180 against 203: beeline 49 against 51, cautious 38 against 45, duelist 93 against 107. The duelist's loss
  is mostly the villain's, 26 of 40 against 37. It dies on the way far more often: 5 deaths to encounters against
  none, 3 to located fights against 2, 2 to bleeding against none and 1 to a caravan's escort. Meanwhile
  press-ganging and burning cut its finale damage from 34 to 23 a run. Wave 3's combat economy is to tune that with
  this instrument.
- **Run length.** 264 runs end inside three minutes (306 with the spine off), and the median win of a cell grows from
  77–107 s to 98–147 s. The 51 that reach ten minutes are all cautious stalls (39 with the spine off). No beeline
  guard stalls any more: the three that did on 191cda5 were W3-5's errand stall.
- **Deaths.** 129 defeats:
  - the finale, 53;
  - the road's encounters, 33;
  - located fights, 20;
  - bleeding, 15;
  - random events, 5;
  - one each to a threat wave, a contract's fight and a caravan's escort.

  The finale deals the most damage (21 630), then the road's encounters (15 450), the caravans' escorts (10 298) and
  located fights (7 296). Contract fights deal 4 473.
- **Caravans.** Every side met about two of the spine's caravans a run, 745 in all:
  - 4 were lost and 2 escaped;
  - 1.64 a run were robbed and 0.41 walked in or sent on;
  - the camp closed at a median 17–25 s and the gate opened at 82–105 s, and no cart had to wait for room.

  With the road cart and the chronicle's ambushes, the players robbed 670 carts and escorted 189, against 77 and 19
  with the spine off. NPCs took 23 carts, each after a full load, and the squad none.
- **Contracts.** 358 of the 360 runs reached their contract and started it: 342 kept, 15 failed, none abandoned. 115
  random events stood down for a contract or a caravan (51 with the spine off), and 51 located fights were handed
  back to make room (47).
- **Encounters.** The generator fielded 20.0 encounters per run, with 11.0 of their bodies on the road at once on
  average, and the budget refused one for 0.1 s a run. A `beeline` or `duelist` run spawns about 88 encounter bodies,
  and a `cautious` one 939 (1 096 with the spine off).
- **Events.** There were 503 random events, 3 458 located fights and 350 threat waves. The waves dealt 801 damage,
  against 2 181 on 191cda5. Seed 285 085's two guard runs took 1 488 of that while they stood at the errand's healer
  (W3-5). They now finish the errand on arrival and end in defeat at 156 and 158 s, before the first wave. The rest
  went from 693 to 801, against 649 with the spine off.
- **Rumours.** 42 of 593 offers (7 %) were beyond reach by this road-only estimate (33 of 383 with the spine off).
- **Economy.** About 433 gold earned and 19 spent per run (332 and 7). About 102 health healed per run (54): rations
  21 599, healers 5 834, medicine 4 735, loot 4 399, events 220. On 191cda5 healers restored 20 935, most of it to
  the guards stalled at the healer.
- **Squad.** A companion reached 337 of 354 finales (355 of 358).

The caravans by side, as #118 published them. Timings are the median of each policy's 40 runs, beeline /
cautious / duelist:

| Side | Verbs over its 120 runs | Camp closed, p50 | Gate opened, p50 | Recruits, guards thinned |
| --- | --- | --- | --- | --- |
| Elves | take 105 (44 %), give 133 (56 %) | 25 / 25 / 25 s | 85 / 90 / 97 s | — |
| Palace guard | confiscate 105 (42 %), deliver 68 (27 %), release 79 (31 %) | 18 / 18 / 18 s | 88 / 88 / 105 s | — |
| Villain | plunder 95 (38 %), press 47 (19 %), burn 108 (43 %) | 17 / 17 / 19 s | 82 / 82 / 91 s | 47, 75 |

- The verbs are the scripted player's, not a person's: `verbPolicy: 'seeded'` picks uniformly among the verbs a cart
  offers the side, and never press-gangs into a full squad of four. The guard's split is therefore its carts': a raid
  can only be confiscated, an escort is delivered or released. The villain presses least because its squad is often
  full. What each verb is worth in wins, healing and finale damage is in
  [the spine's section](#w2-2-pr-b-the-caravan-spine).
- The camp's offer was taken on the road to the finale in 165 runs and on the other road in 189, the light one in 186
  and the rich one in 168; 6 runs met no offer. The caravans paid about one step of W2-1's progress a run (0.93–1.00
  by cell), two met carts to a step.

### Superseded: the baseline on 191cda5

The same protocol on `main` at 191cda5, before W3-5's errand press joined the shipped arms. Its three beeline guard
timeouts, three of the cautious guard's and one of the cautious villain's were that stand-in's errand stall
([W3-5](#w3-5-the-errand-is-pressed-not-waited-out)). It is kept as the record that W2-2's follow-up and #117 measured
against, and `{ ...HARNESS_SHIPPED_ARMS, errand: 'clear', encounterMemory: 'fresh', streaming: 'instant' }`
reproduces it cell for cell.

| Policy · faction | Win / defeat / timeout | Spine off | Won in p10–p50–p90 | Damage taken | Kills |
| --- | --- | --- | --- | ---: | ---: |
| beeline · elf | 11 / 29 / 0 | 11 / 29 / 0 | 89–117–156 s | 253 | 8.6 |
| beeline · guard | 18 / 19 / 3 | 17 / 21 / 2 | 101–130–219 s | 342 | 11.3 |
| beeline · villain | 20 / 20 / 0 | 20 / 20 / 0 | 87–110–164 s | 157 | 8.9 |
| cautious · elf | 11 / 8 / 21 | 10 / 11 / 19 | 89–117–156 s | 234 | 8.0 |
| cautious · guard | 17 / 11 / 12 | 13 / 17 / 10 | 102–136–219 s | 337 | 11.3 |
| cautious · villain | 13 / 11 / 16 | 17 / 12 / 11 | 87–106–164 s | 141 | 8.3 |
| duelist · elf | 34 / 6 / 0 | 36 / 4 / 0 | 102–145–188 s | 178 | 18.3 |
| duelist · guard | 33 / 7 / 0 | 36 / 4 / 0 | 111–142–187 s | 144 | 20.0 |
| duelist · villain | 26 / 14 / 0 | 37 / 3 / 0 | 101–130–172 s | 149 | 17.2 |

| Policy · faction | Squad at finale | Drafts p50/max | Tier p50/max | Contracts s/k/a | Road | Late rumours | Carts |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| beeline · elf | 2.4 (33/38) | 3 / 3 | 4 / 4 | 39 / 39 / 0 | 11.0 | 7 % | 2.02 |
| beeline · guard | 2.3 (32/36) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 11.4 | 17 % | 2.08 |
| beeline · villain | 3.1 (39/40) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 11.7 | 7 % | 2.08 |
| cautious · elf | 2.4 (32/38) | 3 / 3 | 4 / 4 | 38 / 38 / 0 | 11.0 | 10 % | 1.98 |
| cautious · guard | 2.2 (32/37) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 11.0 | 18 % | 2.08 |
| cautious · villain | 3.2 (38/39) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.8 | 10 % | 2.08 |
| duelist · elf | 3.4 (36/36) | 3 / 3 | 4 / 4 | 39 / 39 / 0 | 9.9 | 13 % | 1.93 |
| duelist · guard | 2.6 (38/40) | 3 / 3 | 4 / 4 | 40 / 35 / 0 | 10.6 | 7 % | 2.10 |
| duelist · villain | 3.3 (38/38) | 3 / 3 | 4 / 4 | 40 / 40 / 0 | 10.9 | 5 % | 2.13 |

Squad at finale is the mean number of companions standing when the finale opened, recruits included, and in brackets
the finales at least one of them reached. Tier is the highest threat tier the campaign reached; every finale fielded
was fought at pacing tier 4 (3 with the spine off). Contracts are started, kept and abandoned. Road is the mean number
of the generator's encounter bodies on the field over the run. Carts are the spine's caravans a run met: resolved,
lost or escaped.

Over all 360 runs, against the spine off:

- **Wins.** 183 against 197: beeline 49 against 48, cautious 41 against 40, duelist 93 against 109. The duelist's loss
  is mostly the villain's, 26 of 40 against 37. It dies on the way far more often: 5 deaths to encounters against
  none, 3 to located fights against 2, and one each to a caravan's escort and to bleeding, while press-ganging and
  burning cut its finale damage from 34 to 23 a run. Wave 3's combat economy is to tune that with this instrument.
- **Run length.** 262 runs end inside three minutes (300 with the spine off), and the median win of a cell grows from
  78–108 s to 106–145 s. The 52 that reach ten minutes are 49 cautious stalls and three beeline guards (40 and 2).
- **Deaths.** 125 defeats: the finale 51, the road's encounters 37, located fights 14, bleeding 14, random events 6,
  threat waves 2 and a caravan's escort 1. Encounters deal the most damage (27 190), then the finale (20 530), the
  caravans' escorts (10 356) and located fights (10 205); contract fights deal 4 472.
- **Caravans.** Every side met about two of the spine's caravans a run: 738 in all, of which 4 were lost and 2
  escaped, robbed at 1.63 a run and walked in or sent on at 0.40. The camp closed at a median 17–25 s and the gate
  opened at 82–105 s, and no cart had to wait for room. With the road cart and the chronicle's ambushes, the players
  robbed 666 carts and escorted 185, against 76 and 22 with the spine off. NPCs took 22 carts, each after a full
  load, and the squad none.
- **Contracts.** 356 of the 360 runs reached their contract and started it: 341 kept, 15 failed, none abandoned. 113
  random events stood down for a contract or a caravan (51 with the spine off), and 49 located fights were handed
  back to make room.
- **Encounters.** The generator fielded 19.9 encounters per run, 10.9 of their bodies on the road at once on average,
  and the budget refused one for 0.1 s a run. A `beeline` or `duelist` run spawns about 87 encounter bodies, a
  `cautious` one 664 (1 226 with the spine off).
- **Events.** 507 random events, 3 436 located fights and 351 threat waves, which dealt 2 181 damage. 1 488 of it fell
  in the two runs of one guard, seed 285 085, which stall at an unfinished «interact» objective in region-1-4 (W3-5
  found that stall was the harness's own); the rest is 693, against 663 with the spine off.
- **Rumours.** 67 of 617 offers (11 %) were beyond reach by this road-only estimate (67 of 451 with the spine off).
- **Economy.** About 433 gold earned and 22 spent per run (337 and 9). About 145 health healed per run (92): healers
  20 935, rations 20 561, medicine 6 117, loot 4 371, events 220.
- **Squad.** A companion reached 318 of 342 finales (343 of 351).

The caravans by side, as #117 published them. Timings are the median of each policy's 40 runs, beeline /
cautious / duelist:

| Side | Verbs over its 120 runs | Camp closed, p50 | Gate opened, p50 | Recruits, guards thinned |
| --- | --- | --- | --- | --- |
| Elves | take 104 (44 %), give 131 (56 %) | 25 / 25 / 25 s | 90 / 90 / 97 s | — |
| Palace guard | confiscate 103 (42 %), deliver 66 (27 %), release 79 (32 %) | 18 / 18 / 18 s | 90 / 90 / 105 s | — |
| Villain | plunder 95 (38 %), press 47 (19 %), burn 108 (43 %) | 17 / 17 / 19 s | 82 / 82 / 91 s | 47, 75 |

- The verbs are the scripted player's, not a person's: `verbPolicy: 'seeded'` picks uniformly among the verbs a cart
  offers the side, and never press-gangs into a full squad of four. The guard's split is therefore its carts': a raid
  can only be confiscated, an escort is delivered or released. The villain presses least because its squad is often
  full. What each verb is worth in wins, healing and finale damage is in
  [the spine's section](#w2-2-pr-b-the-caravan-spine).
- The camp's offer was taken on the road to the finale in 165 runs and on the other road in 189, the light one in 186
  and the rich one in 168; 6 runs met no offer. The caravans paid about one step of W2-1's progress a run (0.90–1.00
  by cell), two met carts to a step.

### Superseded: the baseline on 29adca3

Measured before W2-1's progress tier, W2-2 and W2-3 joined the shipped arms, with the clock-only tier the drafts and
tier columns show. It is kept as the record that the W1-5 and W1-6 sections compared against; every current number is
in the [baseline](#baseline).

`HARNESS_SHIPPED_ARMS`, 30 Hz, 600 s limit, seeds `1 + 7919 n` for n = 0…39: 360 runs on `main` at 29adca3, in the
engine's streaming window. W1-6 added `commanders: 'shipped'` to the shipped arms. The same 360 runs with it are this
baseline cell for cell: no friendly garrison fought beside a scripted player long enough to call a soldier. W1-6 also
added `staging: 'friendly'`, which changes no cell of it: on the nearest arm no contract was ever short of room, so no
pack stepped back.

| Policy · faction | Win / defeat / timeout | Won in p10–p50–p90 | Damage taken | Kills |
| --- | --- | --- | ---: | ---: |
| beeline · elf | 14 / 26 / 0 | 63–88–149 s | 139 | 2.9 |
| beeline · guard | 14 / 24 / 2 | 76–87–107 s | 318 | 5.5 |
| beeline · villain | 23 / 17 / 0 | 68–89–108 s | 120 | 3.6 |
| cautious · elf | 12 / 14 / 14 | 63–87–111 s | 128 | 2.7 |
| cautious · guard | 10 / 16 / 14 | 71–86–107 s | 310 | 5.5 |
| cautious · villain | 19 / 11 / 10 | 68–83–107 s | 111 | 3.3 |
| duelist · elf | 35 / 5 / 0 | 78–96–133 s | 118 | 11.7 |
| duelist · guard | 36 / 4 / 0 | 80–107–136 s | 119 | 12.1 |
| duelist · villain | 38 / 2 / 0 | 75–94–144 s | 111 | 11.6 |

| Policy · faction | Squad at finale | Drafts p50/max | Tier p50/max | Contracts s/k/a | Road | Late rumours |
| --- | --- | --- | --- | --- | ---: | ---: |
| beeline · elf | 3.1 (35/37) | 0 / 0 | 1 / 1 | 40 / 39 / 0 | 10.9 | 37 % |
| beeline · guard | 2.8 (36/37) | 0 / 3 | 1 / 4 | 40 / 37 / 0 | 11.8 | 25 % |
| beeline · villain | 2.9 (40/40) | 0 / 0 | 1 / 1 | 40 / 40 / 0 | 11.8 | 21 % |
| cautious · elf | 3.0 (37/39) | 1 / 3 | 2 / 4 | 40 / 39 / 0 | 11.0 | 51 % |
| cautious · guard | 2.7 (36/38) | 1 / 3 | 2 / 4 | 40 / 37 / 0 | 11.5 | 30 % |
| cautious · villain | 2.9 (40/40) | 0 / 3 | 1 / 4 | 40 / 40 / 0 | 11.1 | 42 % |
| duelist · elf | 3.5 (40/40) | 0 / 1 | 1 / 2 | 40 / 40 / 0 | 10.1 | 32 % |
| duelist · guard | 2.9 (39/40) | 0 / 0 | 1 / 1 | 40 / 34 / 0 | 10.9 | 20 % |
| duelist · villain | 3.0 (40/40) | 0 / 0 | 1 / 1 | 40 / 40 / 0 | 11.0 | 17 % |

Squad at finale is the mean number of companions standing when the finale opened, recruits included, and in brackets
the finales at least one of them reached. Tier is the highest threat tier the campaign reached. Contracts are started,
kept and abandoned. Road is the mean number of the generator's encounter bodies on the field over the run.

Over all 360 runs:

- **Run length.** 302 runs end inside three minutes; the 40 that reach ten are 38 cautious stalls and two beeline
  guards.
- **Deaths.** 119 defeats: the finale 54, the road's encounters 30, located fights 18, bleeding 13, random events 2,
  threat waves 2. Encounters deal the most damage (24 534), then the finale (20 060) and located fights (8 545);
  contract fights deal 3 801.
- **Contracts.** Every run reached its contract and started it: 360 started, 346 kept, 12 failed and none abandoned;
  two were still running when their run ended. 51 random events stood down for a contract, and 47 located fights were
  handed back to make room. In the 3x3 the same sweep started 120 and abandoned 239 as `crowded`. The starvation
  #106's baseline reported came from the harness's window, not from the game.
- **Encounters.** The generator fielded 18.5 encounters per run (20.8 in the 3x3), with 11.1 of its bodies on the
  road at once on average (17.2 in the 3x3). The actor budget never had to refuse one; the 3x3 kept it full for
  45 s a run. A `beeline` or `duelist` run spawns about 70 encounter bodies. A `cautious` run spawns 477 to 1 080,
  because its retreats carry it back and forth across square edges, and the engine refields a square's uncleared
  encounters at full health each time the square streams back in.
- **Caravans.** The scripted players robbed 76 carts and lost 65, to escape, failure or raiders. NPCs took 12 of
  them, each after a full load, and the squad took none. A claim opened 164 times.
- **Events.** 393 random events and 2 850 located fights, more than double the 3x3's 1 238 now that the budget has
  room for them; 15 threat waves; 10 events won without the player.
- **Rumours.** 420 of 1 226 offers (34 %) were beyond the player's reach the moment they were offered. W2-3 offers
  only rumours the player can meet; see its section below.
- **Economy.** About 334 gold earned and 9 spent per run. About 96 health healed per run: healers 17 263,
  rations 10 877, loot 3 505, medicine 2 489, events 283.

## What each arm is worth

The same seeds, 20 per faction, `beeline` and `duelist`, with one arm changed at a time. The `reviewArms` row turns
every W1-5 arm off, and the window with them. With the review's own `commit` rumours and 1 200 s limit, those arms
give 53/60 against 0/60: the review's 88 % against 0 %.

| Arms | Beeline wins (elf / guard / villain) | Duelist wins (elf / guard / villain) | Beeline p50 | Duelist p50 |
| --- | --- | --- | ---: | ---: |
| all | 28/60 (6 / 10 / 12) | 57/60 (17 / 20 / 20) | 90 s | 95 s |
| `squad: off` | 14/60 (1 / 6 / 7) | 24/60 (8 / 9 / 7) | 92 s | 93 s |
| `squad: decoy` | 26/60 (9 / 6 / 11) | 42/60 (14 / 13 / 15) | 96 s | 98 s |
| `sustain: off` | 19/60 (4 / 9 / 6) | 19/60 (6 / 7 / 6) | 86 s | 86 s |
| `sustain: visit` | 15/60 (3 / 6 / 6) | 19/60 (4 / 9 / 6) | 88 s | 87 s |
| `eventModel: counted` | 29/60 (5 / 11 / 13) | 59/60 (19 / 20 / 20) | 96 s | 95 s |
| `encounterModel: harness` | 60/60 (20 / 20 / 20) | 39/60 (12 / 12 / 15) | 83 s | 157 s |
| `playerKit: harness` | 31/60 (7 / 14 / 10) | 57/60 (20 / 19 / 18) | 119 s | 116 s |
| `regionWindow: square` | 30/60 (7 / 11 / 12) | 55/60 (18 / 18 / 19) | 106 s | 104 s |
| reviewArms | 59/60 (20 / 20 / 19) | 1/60 (1 / 0 / 0) | 97 s | 181 s |

- The squad and healing are what turn fighting from fatal into the safer choice. Without the squad the duelist wins
  24 of 60 instead of 57, and without healing 19. The decoy placebo keeps about half of the squad's value for a
  fighter, so the squad matters as bodies between the player and the blow as much as for the blows it lands.
- The `visit` placebo lands at or below `sustain: off`, so the healing itself is the effect, not the detours to it.
- The generator's own encounters, not the stand-in's, are what make walking past everything dangerous.
- Fought events cost one or two wins in sixty; the scripted player walks past them (`eventPolicy: 'ignore'`).
- The window barely moves win rates, 30 and 55 in the 3x3 against 28 and 57, and wins come 10 to 15 s later in it.
  What it moved is the contracts, the located fights and how crowded the road is: see the baseline.

## W1-6: commanders and the contract room

`HARNESS_SHIPPED_ARMS` on both arms of the fork, `contractPolicy` `nearest` and `contrary`, with `commanders` at
`legacy` and then `shipped` and nobody stepping back (`staging: 'none'`); 30 Hz, 600 s, seeds `1 + 7919 n` for
n = 0…39, all three policies, 120 runs a row.

| Arm · faction | Arrivals | Started / kept | `crowded` | Calls per run | Wins |
| --- | ---: | --- | --- | --- | --- |
| nearest · elf | 120 | 120 / 118 | 0 → 0 | 0 → 0 | 61 → 61 |
| nearest · guard | 120 | 120 / 108 | 0 → 0 | 0.27 → 0 | 62 → 60 |
| nearest · villain | 120 | 120 / 120 | 0 → 0 | 0 → 0 | 80 → 80 |
| contrary · elf | 120 | 120 / 118 | 0 → 0 | 0 → 0 | 55 → 55 |
| contrary · guard | 120 | 117 / 94 | 3 → 3 | 0.25 → 0 | 63 → 63 |
| contrary · villain | 120 | 120 / 120 | 0 → 0 | 0 → 0 | 77 → 77 |

- The scripted players walk past the palace strongholds within a call or two, so the old rule called a quarter of a
  soldier per guard run and decided no contract. Started, kept and abandoned are identical under both rules in every
  row; guard kills per run move by 0.02, road bodies by less than 0.1, and a guard cell's median win by 2.4 s at most.
- **The residual, closed below.** The three `crowded` arrivals are one site: seed 1's «Зверьё у домиков» (`cull`),
  which every policy reaches on the contrary arm. Its window holds 18 bodies of the guard's own garrisons, and a
  beast raid needs five slots where four are left, under every commander rule, `inert` included.
- The scripted player is what hides the old cost. `tests/commanderReinforcements.test.ts` fields each contract
  site's window through the engine's own spawner and holds the player 100 s by it before arriving. Over the 240 sites
  the old rule crowds out 16 of the guard's 80, and 11 with every hostile pack cleared; the shipped rule crowds out
  one, the same seed 1 site. A person who fights, heals or looks around by the palace before taking the contract
  pays the old rule's price; a script does not.

### The player's own packs make room

`HARNESS_SHIPPED_ARMS` as W2-1 and W2-2's first PR left them (`escalation: 'progress'`, defended carts), on both
arms of the fork, with `staging` at `none` and then `friendly`; the same seeds and settings.

| Arm · faction | Arrivals | Started / kept | `crowded` | Packs stepped back per run | Win / defeat / timeout |
| --- | ---: | --- | --- | --- | --- |
| nearest · elf | 120 | 120 / 118 | 0 → 0 | 0 → 0 | 57 / 44 / 19 |
| nearest · guard | 120 | 120 / 108 | 0 → 0 | 0 → 0 | 66 / 42 / 12 |
| nearest · villain | 120 | 120 / 120 | 0 → 0 | 0 → 0 | 75 / 34 / 11 |
| contrary · elf | 120 | 120 / 118 | 0 → 0 | 0 → 0 | 48 / 54 / 18 |
| contrary · guard | 120 | 117 / 94 → 120 / 97 | 3 → 0 | 0 → 0.025 | 61 / 40 / 19 → 61 / 39 / 20 |
| contrary · villain | 120 | 120 / 120 | 0 → 0 | 0 → 0 | 77 / 36 / 7 |

- Every row but the guard's contrary arm is identical cell for cell: no contract there was ever short of room once
  the game's own events made way, so no pack stepped back.
- On the guard's contrary arm the three arrivals at «Зверьё у домиков» now start. In each run one pack of the
  palace's soldiers, out of sight behind the guard, steps back and comes home later, and all three contracts are
  kept. The cautious run that died at 142 s now lasts to the time limit, so one defeat becomes a timeout. Encounters
  fielded per run move by 0.02, kills by 0.03 and the duelist's median win by 1.0 s.
- `tests/contractStaging.test.ts` arrives at every contract site of the same 40 seeds through the engine's own
  spawner, facing each of four ways. With nobody stepping back the guard's one site is crowded; with the staging no
  site is, for any faction or heading. No enemy and nothing in view ever stepped back.
- **The empty-post rule** moves no cell of the table: no scripted player walks back to a post after its pack stepped
  back, so none of the three packs was called home (`packsCalledHome` 0). It is measured in the engine tests.
- **Known behaviour.** Until a pack is back, its post stands empty and the journal map shows none of its dots. The
  empty-post rule shortens that: a player at the post who looks away has the pack back as soon as the field has
  room for it. A player who keeps the post in view, or stays between 25 and 60 m without having walked up to it,
  still sees it empty.

## W2-1: escalation by progress

Since W2-1 the shipped arms carry `escalation: 'progress'`: the pacing tier (the HUD's «Угроза», the drafts, the
director's cadence and the threat waves) is the clock or the run's progress, whichever is further, and enemy health
and damage stay on the clock's tier. `time` is the rule before it, and `progressAll` is the design that was measured
and rejected: progress scaling enemy stats as well. Same seeds, the engine's window, 30 Hz, 600 s, 40 seeds per cell:

| Policy · faction | `time` wins | `progress` wins | Drafts per win | `progressAll` wins |
| --- | ---: | ---: | ---: | ---: |
| beeline · elf | 14/40 | 11/40 | 2 | 3/40 |
| beeline · guard | 14/40 | 16/40 | 2 | 9/40 |
| beeline · villain | 23/40 | 21/40 | 2 | 19/40 |
| cautious · elf | 12/40 | 10/40 | 2 | 4/40 |
| cautious · guard | 10/40 | 12/40 | 2 | 5/40 |
| cautious · villain | 18/40 | 17/40 | 2 | 13/40 |
| duelist · elf | 35/40 | 36/40 | 2 | 26/40 |
| duelist · guard | 36/40 | 36/40 | 2 | 24/40 |
| duelist · villain | 38/40 | 37/40 | 2 | 24/40 |

- Per policy, out of 120: beeline 51, 48 and 31; cautious 40, 39 and 22; duelist 109, 109 and 74.
- Under `time` the median win opened no draft. Under `progress`, 194 of 196 wins opened two or more before the end.
  Drafts in wins wait for calm: after the tier that dealt them the median delay is 0 s, the p90 3.1 s, the longest
  15.7 s.
- Calm alone had no ceiling. Four guard runs pinned in a fight from 360 s to the 600 s timeout (seeds 79191 and
  142543, beeline and cautious) never opened their third and fourth drafts. With the 30 s ceiling those eight open
  at 390 s and 570 s, `draftsForced` counts them, and the other 356 runs are the same in every recorded field: no win
  count moved, under `progress` or `progressAll`. W3-5 found the fight was the harness's own (see below).
- The finale is fought at pacing tier 3 with its boss scaled at the clock's tier 1. Under `progressAll` the same boss
  had a quarter more health, and the finale's defeats are most of the gap in that column.
- Run length moved by ten percent or less in every cell.
- «Устав дозора» stays distinct. Runs that held it threw 268 waves on closures; runs without it threw none.
- `tests/runHarnessEscalation.test.ts` holds these in whole runs. With no card taken and the director silent, a
  `progress` run is the `time` run to the frame, and a `progressAll` run is not.

## W2-2: a side defends its own ambushed cart

A chronicle ambush of the player's own side's cart is now defended, not robbed: no cargo is taken, it is won when both
raiders are down, and it pays 90 instead of 140. `HARNESS_SHIPPED_ARMS`, W2-1's `escalation: 'progress'` included, on
the baseline's seeds, `main` at 9f3bf5d against the W2-2 branch, 360 runs a policy:

| `eventPolicy` | Wins | Carts robbed | Carts escorted | Carts lost |
| --- | --- | --- | --- | --- |
| `ignore` | 196 → 198 | 76 → 76 | 22 → 22 | 70 → 70 |
| `engage` | 26 → 31 | 887 → 682 | 1 → 245 | 39 → 33 |

- Under `ignore` only guard runs change: two more wins and a little more gold. Every elf and villain run is identical.
- Under `engage` the scripted player detours to every ambush, and every side now fights for its own carts instead of
  robbing them: 205 fewer robberies and 244 more escorts, and no cell moved by more than two wins.
- Those runs leave the caravan beats off; the next section measures them.

## W2-2, PR B: the caravan spine

`caravanBeats: 'shipped'` runs the engine's spine on the harness's bodies (`tests/runHarnessBeats.ts`): the plans of
`planCaravanSpine`, the camp held until its met cart settles, the finale behind `caravanSpineGate`, each side's verbs
paid from `caravanBeatReward`, the market written by the chronicle's own helpers, a burn through `thinFinaleGarrison`,
and two met carts to a W2-1 progress step. Staging follows the engine's seam: W1-1's make-way, W1-6's step-back under
`staging: 'friendly'`, a campaign reservation, a retry every 2 s and a cart let through after 30 s. The arms are
`beatPolicy` (`engage`, `walk`, `ignore`), `openingPolicy`, `verbPolicy`, `beatGate`, `beatsPerProgressStep` and
`roadCart: 'farm'`. With the spine off every report is main's byte for byte: 72 of 72 runs compared under the shipped
and the pinned arms, on main at 7c893a3 and again at 043f4bb.

The shipped arms with the spine against the same arms with `caravanBeats: 'off'`, 30 Hz, 1 200 s, seeds
`1 + 7919 n`: beeline 40, cautious 30 and duelist 20 per side, 270 runs a row, on main at 7c893a3. The arms were
`HARNESS_SPINE_ARMS` and `HARNESS_SHIPPED_ARMS` then; the spine has since been folded into `HARNESS_SHIPPED_ARMS`, and
the [baseline](#baseline) re-published with it. The spine off, spine, `ignore` and `walk` rows repeat byte for byte at
043f4bb. Won in p50 is the middle of the three sides' medians.

| Arm | Wins (beeline / cautious / duelist) | Won in p50 | Carts met per run | Finale tier |
| --- | --- | --- | ---: | --- |
| spine off | 133 (48 / 29 / 56) | 89 / 88 / 93 s | — | 3 |
| spine | 128 (49 / 29 / 50) | 117 / 118 / 145 s | 2.06 | 4 |
| one cart per step | 115 (45 / 25 / 45) | 132 / 130 / 147 s | 2.04 | 4 |
| K = 3 | 100 (36 / 16 / 48) | 154 / 158 / 164 s | 2.79 | 4 |
| `walk` | 97 (36 / 18 / 43) | 180 / 174 / 190 s | 2.03 | 4 |
| `ignore` | 0 | — | 0.02 | never fielded |
| road cart farmed | 103 (37 / 18 / 48) | 130 / 105 / 145 s | 2.02 | 4 |

- Every side meets its caravans: about two a run, robbed or walked in. The elves rob 2.0, the villain 2.1, and the
  guard confiscates 0.9 and walks in or sends on 1.2, so «корованов — 0» is gone. 1 % of carts end lost or escaped.
- The camp closes at a median 17–25 s and the finale's gate opens at 82–113 s.
- Two met carts to a step is the coordinator's fallback, taken because one to a step put the threat waves at 1 324
  damage against the baseline's 364 and cost the duelist 11 wins. Two to a step keeps the waves at 335, leaving out one
  run: a beeline guard (seed 285 085) that stalls for 1 100 s at an unfinished «interact» objective in region-1-4,
  the same stall as the baseline's own timeout (seed 142 543), and takes 2 964 wave damage while it stands there.
  W3-5 found that stall was the harness's errand stand-in, not the game.
  Beeline gains one win, cautious none, and duelist loses six (10 points). The finale is fought at pacing tier 4 either
  way, against 3 without the spine; its boss stays scaled by the clock.
- The scripted player's median win grows by 28–52 s, a third to a half. This harness cannot show option A's 6–10
  minutes: its player walks straight to every target, never reads a card and wins in a minute and a half without the
  spine. K = 3 adds another 20–40 s and costs another 28 wins, which is why the gate asks for two.
- Both offers are worth taking. Seeded, the scripted player took the trunk's 45 % of the time and the light one's 55 %.
  Forced, the trunk offer won 132 and the other road's 135.
- The verbs are real choices. An elf who gives heals 139 a run from rations against 31 and wins 39 of 90 against 27; a
  villain who press-gangs or burns brings 3.9 companions to the finale against 2.8, takes 32 finale damage against 42,
  and wins 52 against 38. A guard who walks carts in wins 59 against 40 for one who sends them on unpaid.
- Farming the road cart does not dominate: 84 more gold a run, 25 fewer wins, because its detours keep the player in
  fights. Without the spine the same farming was worth 13 wins (146 against 133); the carts are the better use of the
  time.
- Staging: with W1-6's step-back in the seam, no cart in 270 runs waited for room. Before it was wired in, 7 carts
  waited 28 s in all, and none waited long enough to go through unfought. Under `walk` 6 carts waited 37 s in all,
  against 9 and 93 s before.
- `ignore` is the gate's negative control: no win and no finale fielded in 270 runs. `walk` is the fail-forward
  control: 99 % of its carts settle on the walked-away clock, its gate opens at a median 135–161 s, and 97 runs win.
- `tests/runHarnessBeats.test.ts` holds these in whole runs: off is inert, the camp and the gate behave, `ignore` never
  reaches the finale, `walk` settles every cart by its clock, a crowded road makes way first and then lets the cart
  through, and each arm does what its name says.

## W2-3: rumours the player can meet

Since W2-3 the board offers a rumour only when the player can meet it from where they stand, within a 25 s walk, and
none while one is pinned; the README's Rumours section has the rule. Everything below was measured against `main` at
9f3bf5d, before W2-2's change above. The shipped arms leave rumours unchased (`rumourPolicy: 'ignore'`), so in the
same 360 runs W2-3 changes only what the chronicle is offered: 451 rumours instead of 1 268. The road-only estimate
in the metrics still calls 67 of them late, 15 % against 39 %, and every one is an escort: it times the walk to the
square the cart is in when offered, while the board times it to the squares where the player would meet the cart.
Wins move by one run, 195 against 196, every cell's median win is unchanged, and a run still earns about 335 gold.

| Policy · faction | Win / defeat / timeout | Late rumours |
| --- | --- | ---: |
| beeline · elf | 11 / 29 / 0 | 13 % |
| beeline · guard | 16 / 22 / 2 | 24 % |
| beeline · villain | 20 / 20 / 0 | 0 % |
| cautious · elf | 10 / 11 / 19 | 20 % |
| cautious · guard | 12 / 18 / 10 | 33 % |
| cautious · villain | 17 / 12 / 11 | 3 % |
| duelist · elf | 36 / 4 / 0 | 9 % |
| duelist · guard | 36 / 4 / 0 | 2 % |
| duelist · villain | 37 / 3 / 0 | 3 % |

The review's `commit` arm pins the first rumour within 110 m and walks to it. With honest melee, heavy defence, the
nearest contract, seeded doctrines and a 1 200 s limit, in the engine's window (`regionWindow: 'engine'`), 80 seeds
per faction:

| Policy | Offers a run | Kept | Broken (while pinned) | Kept : broken | Wins | Median win |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| beeline before | 4.66 | 1.33 | 2.41 (0.78) | 0.55 | 225 / 240 | 160 s |
| beeline after | 2.05 | 1.55 | 0.30 (0.13) | 5.2 | 224 / 240 | 121 s |
| cautious before | 9.03 | 1.31 | 6.80 (1.25) | 0.19 | 187 / 240 | 144 s |
| cautious after | 2.29 | 1.55 | 0.56 (0.28) | 2.8 | 198 / 240 | 118 s |

Every faction now keeps at least two rumours for each one it breaks: beeline elf 4.2, guard 7.1, villain 4.7;
cautious elf 2.1, guard 5.0, villain 2.3. More are kept because the arm no longer holds its one pin on a rumour it
cannot meet, and a nearby rumour's clock is 48 s rather than 96 s. That is also why its winning runs are shorter.
The constants were chosen on this panel:

| Variant | Beeline kept : broken | Cautious kept : broken (elf / guard / villain) | Kept a run (beeline / cautious) |
| --- | ---: | --- | --- |
| walk ×1.0, no slack | 1.8 | 1.1 (0.8 / 1.1 / 1.1) | 1.62 / 1.54 |
| walk ×1.25 + 8 s | 3.9 | 2.0 (1.6 / 2.4 / 2.1) | 1.74 / 1.72 |
| walk ×1.5 + 8 s, as shipped | 5.2 | 2.8 (2.1 / 5.0 / 2.3) | 1.55 / 1.55 |
| without the 25 s ceiling | 4.9 | 2.0 (1.6 / 3.2 / 1.8) | 1.47 / 1.48 |
| an offer every 6 ticks | 6.0 | 2.4 (1.6 / 3.9 / 2.4) | 1.00 / 0.99 |

With every W1-5 arm on as well (`HARNESS_SHIPPED_ARMS` with `rumourPolicy: 'commit'`, 600 s, 40 seeds per faction),
kept : broken goes from 0.34 to 1.64 for `beeline` and from 0.11 to 0.50 for `cautious`, on 54 % and 71 % fewer
offers. The guard's and the villain's kept rumours paid 10 to 12 gold a run, 3.0 % to 3.7 % of what their runs
earned, and the elf's 0.42 to 0.53 rations a run against the 1.2 to 1.4 it ate. Here the scripted player's own goals
take the wheel from a pinned rumour: a healer, a contract's fight, the road cart. It also chases a pinned escort from
square to square, so 36 of the 45 rumours `beeline` broke were escorts. The `cautious` arm meets the same encounters
again each time it retreats across a square's edge, as the window section above describes. These shipped-arm numbers
walk escorts to the cart's square, `rumourSteering: 'cart'`; the follow-up below changed that.

### W2-3 follow-up: the escort compass meets the cart

A taken escort's compass used to lead to the square its cart was in, which the cart had usually left by the time the
player got there. It now leads to the square the cart can be met in, `findEscortMeeting`: the cart's square at the
earliest check the player can be there by the walk alone, and the cart's square again when no meeting fits. The engine
works it out once a chronicle tick, so the compass re-plans when the meeting square changes, not on every frame.
`rumourSteering: 'meeting'` walks the scripted player there, and `HARNESS_SHIPPED_ARMS` carries it; `cart`, the
default, is the control. On `main` at 7c893a3:

| Arms · policy | Escorts kept : broken | Escorts kept, broken | All kept : broken | Wins |
| --- | --- | --- | --- | --- |
| review · beeline | 1.19 → 1.41 | 80, 67 → 76, 54 | 5.17 → 5.97 | 224 → 219 |
| review · cautious | 0.85 → 1.19 | 88, 104 → 74, 62 | 2.76 → 4.02 | 198 → 197 |
| shipped · beeline | 0.58 → 1.03 | 21, 36 → 30, 29 | 1.64 → 2.28 | 38 → 37 |
| shipped · cautious | 0.24 → 0.36 | 24, 101 → 33, 91 | 0.50 → 0.60 | 27 → 29 |

The review arms are the panel above, 80 seeds per faction and 240 runs a row; the shipped arms are
`HARNESS_SHIPPED_ARMS` with `commit`, 40 seeds per faction. Fewer escorts are broken in every row. In the review arms
fewer are kept as well, because fewer are offered, 171 → 160 and 215 → 162: a player who meets a cart rather than
chasing it down the road passes fewer other carts. Kept rumours of every kind fall from 1.55 a run to 1.47 and 1.46
there, and rise from 0.62 to 0.68 and from 0.69 to 0.76 on the shipped arms.

Meeting with the offer's margin, ×1.5 + 8 s, was measured too and rejected: 1.31 and 1.06 on the review arms, but 0.41
and 0.17 on the shipped arms, worse than the cart's square. Its 8 s rules out the very next check even for a player
already beside the cart, so it led players away from carts they were walking with. Counting the square the player
stands in as no walk at all changed no run in either panel.

## W3-5: the errand is pressed, not waited out

W2-1's four guard timeouts (seeds 79191 and 142543, `beeline` and `cautious`) and the guard stalls the spine's
baseline found (142543, 197976 and 285085) were one stall, and it was the harness's, not the game's. In each run the
guard's errand, the «interact» node «Осмотреть точку «Лечение и протезы»», sat on `site-recovery-riverside`, a healer.
An encounter archer held 8–12 m off it. The scripted player never fights what it cannot reach, and the squad was
dead, so nobody touched the archer.

Until W3-5 the harness finished an errand only once nothing hostile stood within 12 m of the player on its site, so it
waited for ever. The arrows hurt, so the sustain arm pressed `E` at the healer, 53 to 189 times a run, and
`chooseGeneratedInteraction` said every one of those presses targeted the errand. The harness healed and stopped
there. The engine's `handleGeneratedInteraction` heals and completes the errand on that same press. Healed but never
done, the player neither died nor moved on. W2-1's "fight from 360 s to 600 s" was that archer.

A person at that spot sees «[E] Вылечиться: Лечение и протезы» and presses it once. Nothing between `interact` and
`completeGeneratedObjective` looks at nearby enemies: the site is reachable, the prompt appears and no event takes
the press. `tests/errandPress.test.ts` drives those production methods in seed 142543's world:

- one press with an archer 10 m away heals and completes the errand;
- 6.5 m off the site the same press does nothing;
- with the contract arm pinned, the press heals and leaves the errand undone.

A browser check on the same seed, with a labelled save that put the guard on the healer at 30 health with enemies on
it, finished the errand on the first `E`: «Задача выполнена: Осмотреть точку «Лечение и протезы».», and the compass
moved on to the finale.

The `errand` arm fixes the harness:

- `clear`, the default, is the stand-in every pinned number was measured with. `{ ...HARNESS_SHIPPED_ARMS, errand:
  'clear' }` gives the 191cda5 baseline back cell for cell, and with the spine off `main`'s runs at 043f4bb run for
  run (360 of 360). Since W3-4 both take `encounterMemory: 'fresh'` and `streaming: 'instant'` as well.
- `press`, in the shipped arms, is the engine's `E`:
  - the press completes the objective that `chooseGeneratedInteraction` says it targets, after the site's service;
  - the scripted player presses while its errand's prompt is up;
  - the completion lands where the stand-in's did, at step 7b, so the tier it earns rises on the next frame, as the
    engine's `interact` between frames does (see below);
  - nothing else completes an errand, so a press the engine would refuse shows as a stall instead of being waited
    out.
- `balance.errandSite` says when the player first stood on the errand's site, when the errand completed, and how long
  something hostile stood within 12 m before that. A stall reads as a long `heldSeconds` and no completion.

The baseline's protocol (30 Hz, 600 s, seeds `1 + 7919 n` for n = 0…39) on this branch, `clear` against `press`,
with the spine on, as the shipped arms play it, and off:

| Policy · faction | Spine on, `clear` | Spine on, `press` | Spine off, `clear` | Spine off, `press` |
| --- | --- | --- | --- | --- |
| beeline · elf | 11 / 29 / 0 | 11 / 29 / 0 | 11 / 29 / 0 | 14 / 26 / 0 |
| beeline · guard | 18 / 19 / 3 | 18 / 22 / 0 | 17 / 21 / 2 | 17 / 23 / 0 |
| beeline · villain | 20 / 20 / 0 | 20 / 20 / 0 | 20 / 20 / 0 | 20 / 20 / 0 |
| cautious · elf | 11 / 8 / 21 | 11 / 8 / 21 | 10 / 11 / 19 | 13 / 10 / 17 |
| cautious · guard | 17 / 11 / 12 | 17 / 11 / 12 | 13 / 17 / 10 | 14 / 14 / 12 |
| cautious · villain | 13 / 11 / 16 | 10 / 12 / 18 | 17 / 12 / 11 | 18 / 12 / 10 |
| duelist · elf | 34 / 6 / 0 | 34 / 6 / 0 | 36 / 4 / 0 | 35 / 5 / 0 |
| duelist · guard | 33 / 7 / 0 | 33 / 7 / 0 | 36 / 4 / 0 | 35 / 5 / 0 |
| duelist · villain | 26 / 14 / 0 | 26 / 14 / 0 | 37 / 3 / 0 | 37 / 3 / 0 |

The cells are win / defeat / timeout. Spine on, `clear` is the 191cda5 baseline, and spine on, `press` the current
one.

- **Errand stalls.** With the spine there are seven, and none under `press`:
  - three beeline guards (142543, 197976 and 285085) stood more than 500 s at the healer. They now end in defeat at
    142, 112 and 156 s;
  - the cautious guards on the same seeds now finish the errand on arrival. On 142543 and 197976 they then meet the
    cautious finale stall, and on 285085 the guard dies at 158 s;
  - a cautious villain on 79191 reached its errand, retreated and never came back. It now completes the errand and
    dies at 216 s.

  Without the spine there are four, on 79191 and 142543 under both policies, and none under `press`.
- **Timeouts.** 52 → 51 with the spine and 42 → 39 without it. Every timeout left is `cautious` at the finale. Below
  35 % health its retreat overrides the walk to the healer it chose, its health does not come back, and it shuttles
  across a square's edge. That is the class the baseline calls cautious stalls: W3-5 neither causes nor hides it.
- **What changed.** 100 runs changed with the spine and 103 without it. 94 and 101 of those had waited at the errand
  or stalled there. Under `clear`, these errands waited for their site to clear, with the spine:

  | Faction | Errands that waited | Mean wait | Longest |
  | --- | ---: | ---: | ---: |
  | elf | 34 of 115 | 10 s | 57 s |
  | guard | 37 of 113 | 13 s | 115 s |
  | villain | 23 of 119 | 4 s | 17 s |

  Under `press` no errand waits.
- **Wins.** With the spine, wins go 183 → 180: beeline 49 and duelist 93 either way, cautious 41 → 38. Without it,
  197 → 203. The three cautious wins lost are the cautious villain's, on 40 seeds. More seeds settle it:

  | Panel | Wins | Timeouts | Errand stalls |
  | --- | --- | --- | --- |
  | Spine on: beeline n = 40…139, cautious n = 30…129, 600 runs | 176 → 196 | 125 → 117 | 6 → 0 |
  | Spine off: n = 40…239, beeline and cautious, 1 200 runs | 397 → 473 | 216 → 183 | 7 → 0 |

  With the spine, beeline wins go 95 → 106 and cautious 81 → 90, and the stalls are the guard on 285085, 641440,
  958200 and 1100742. Without it, beeline goes 219 → 256 and cautious 178 → 217. The stand-in made the walking players
  stand in fights at the errand, and that cost them three to six points of wins.
- **Threat waves.** With the spine, threat-wave damage falls from 2 181 to 801: the Baseline's events have the
  breakdown.

**Where the press lands.** The engine runs `interact` between frames, so the tier an errand earns is raised in the
next frame's `updateThreat`, before anything that frame spawns. A first cut of this arm completed the errand
mid-frame. In 14 runs (48 without the spine) the finale's boss spawned in that same frame and took the old tier. The
completion now lands at step 7b, where the stand-in's did, and every finale is fielded at pacing tier 4 (3 without
the spine), as on 191cda5.

`tests/errandPress.test.ts` holds the stalled runs. Under `press`, each errand completes on the frame its site is
reached, with a hostile within 12 m, and the beeline runs end long before the limit. Under `clear`, none of them
completes in 300 s. `tests/runHarnessEscalation.test.ts` keeps `errand: 'clear'` for its fight that never ends. W1-2's
whole-run test in `tests/runHarnessBalance.test.ts` was checked against its own rule and keeps its seeds: under the
press the elf on 118786 and the guard on 1 are still the first seeds in the stride on which a raider starts a load.

## W3-4: what is left of a pack («Недобитые»), and a world that does not jump back

Two arms, both in `HARNESS_SHIPPED_ARMS`, and both shared with the engine rather than copied:

- `encounterMemory: 'remnants'` runs the engine's ledger, `world/EncounterRemnants.ts`, on the harness's own spawner,
  deaths and removals. A member that fell is passed over when its square streams back in, and a member that left the
  field hurt comes back on its post with the health and maximum it left with.
- `streaming: 'held'` centres the window where `GeneratedWorldRuntime` centres it, with `world/StreamingCentre.ts`:
  walking on recentres at the edge as before, and turning back into the square just left keeps the centre until the
  player is `STREAMING_RETURN_HOLD_METRES`, 16 m, inside it.

With both off, `fresh` and `instant`, every one of the baseline's 360 runs hashes to main's full report byte for byte
(main at 04c1c7b, the new fields left out), with the errand pressed and with it waited out. `HARNESS_SHIPPED_ARMS`
with the spine and the errand press, 30 Hz, 600 s, on the baseline's seeds, `1 + 7919 n` for n = 0…39, and on the
next forty, n = 40…79. A is the remnants alone, B the hold alone:

| Seeds | Arms | Wins (b / c / d) | Bodies a run (b / c / d) | c ÷ others | c squares / min | Damage (b / c / d) |
| --- | --- | --- | --- | ---: | ---: | --- |
| 0…39 | main | 180 (49 / 38 / 93) | 90 / 939 / 85 | 10.8× | 41.7 | 190 / 173 / 158 |
| 0…39 | A | 177 (50 / 35 / 92) | 90 / 1 562 / 85 | 17.8× | 68.7 | 191 / 175 / 160 |
| 0…39 | B | 175 (47 / 33 / 95) | 87 / 133 / 82 | 1.6× | 9.6 | 193 / 176 / 159 |
| 0…39 | A + B | 175 (47 / 32 / 96) | 86 / 137 / 82 | 1.6× | 9.8 | 191 / 175 / 160 |
| 40…79 | main | 180 (45 / 38 / 97) | 91 / 564 / 89 | 6.3× | 29.5 | 182 / 171 / 154 |
| 40…79 | A | 180 (44 / 39 / 97) | 90 / 514 / 89 | 5.7× | 29.7 | 181 / 170 / 154 |
| 40…79 | B | 187 (46 / 42 / 99) | 88 / 121 / 86 | 1.4× | 11.3 | 186 / 176 / 154 |
| 40…79 | A + B | 183 (44 / 41 / 98) | 88 / 110 / 86 | 1.3× | 10.4 | 185 / 174 / 154 |

b / c / d are beeline, cautious and duelist. c ÷ others is a cautious run's bodies over the mean of a beeline and a
duelist run's. c squares / min are the squares that entered a cautious run's simulated plus per minute of run
(`simulatedActivations`).

- **The remnants** change 111 of the 360 runs and the outcome of 7 (85 and 8 on the second set). They move no cell's
  median win by more than 5 s and one contract in each of two cells, and `crowded` stays at zero: the scripted players
  seldom come back to a pack they hurt, so the ledger is a rule of fairness rather than a balance lever. It closes the
  refill and the kill gold paid twice for the same men. With both arms on, by cell, a beeline run fields 1.3 to 3.0
  survivors again with their wounds and passes over 0.4 to 0.8 fallen, a cautious run 3.8 to 10.3 and 1.3 to 3.9, a
  duelist 0.1 to 0.4 and up to 0.4.
- **A alone moves the cautious bodies whichever way the script's thrash falls.** At low health the `cautious` policy
  flees whatever hostile is nearest, at any distance. When that pins it against a square's edge, the instant window
  recentred on every crossing and fielded the squares on the other side, whose packs then became the nearest. On main
  the cautious elf on seed 95 029 fields 24 260 bodies in its 600 s, and the villain on 522 655 fields 29 248. A
  leaves different bodies on the posts, which changes which runs fall into that thrash: the cautious bodies go from
  939 to 1 562 on the first set, where the villain on seed 269 247 fields 73 467 bodies, four a frame, and from 564 to
  514 on the second. It is not the game's churn: a person does not flee a pack two squares away.
- **The hold** takes the cautious bodies from 939 to 137 a run and from 564 to 110, 1.6 and 1.3 times what a beeline
  or duelist run spawns. The squares a cautious run brings into the plus fall from 41.7 a minute to 9.8 and from 29.5
  to 10.4, and its window moves 3.9 and 4.1 times a minute instead of 20.6 and 14.9. Beeline and duelist runs field 3
  to 5 % fewer bodies: they walk on, and walking on recentres exactly as before. Pursuers shed by streaming, the
  hostiles chasing the player when their square streamed out, fall from 103 and 79 a cautious run to 9.0 and 6.2, and
  stay at 2.6 to 2.9 a beeline one.
- **Damage taken moves by 2 % or less**, on every policy and both sets. The packs and fights of the squares behind a
  player who steps back over an edge stay on the field for those 16 m instead of vanishing on the spot, and the
  scripted players seldom stand there long. Deaths to located fights go from 20 to 19 and from 11 to 20. Wins move by
  −5 and +3 on the two sets, inside what one seed set's noise does to them.
- **The cautious edge thrash is a known harness-policy behaviour, masked rather than fixed.** The hold keeps the window
  from following the flee across an edge, so the thrash no longer fields bodies, but the policy still flees the
  nearest hostile at any distance. It is in the backlog with the cautious finale stall. The largest cautious run left,
  the elf on seed 7 920, fields 3 294 bodies against 3 834 on main: it circles a corner of three squares, and each
  square it steps into is not the one it just left, so the hold does not apply. That is the rule: walking on never
  waits.

The hold's distance on the first seed set, both arms' other halves as main (`encounterMemory: 'fresh'`):

| Hold | Wins (b / c / d) | Bodies (b / c / d) | c squares / min | Pursuers shed (b / c / d) | Damage (b / c / d) |
| --- | --- | --- | ---: | --- | --- |
| none | 180 (49 / 38 / 93) | 90 / 939 / 85 | 41.7 | 2.8 / 103 / 0.2 | 190 / 173 / 158 |
| 8 m | 172 (47 / 34 / 91) | 88 / 131 / 83 | 9.6 | 2.8 / 8.8 / 0.3 | 194 / 177 / 157 |
| 16 m | 175 (47 / 33 / 95) | 87 / 133 / 82 | 9.6 | 2.8 / 8.6 / 0.3 | 193 / 176 / 159 |
| 24 m | 172 (44 / 32 / 96) | 85 / 145 / 81 | 10.4 | 2.7 / 10.1 / 0.3 | 191 / 176 / 158 |
| 32 m | 169 (43 / 32 / 94) | 83 / 154 / 81 | 10.0 | 2.7 / 10.5 / 0.3 | 190 / 174 / 159 |

- Every hold from 8 m to 32 m stops the thrash about equally, and none of them separates on wins or damage. The
  harness cannot choose the distance; 16 m is chosen on the game's own numbers. A soldier senses at 15 m, so a player
  who fights across an edge, or steps back out of a soldier's reach from it, stays inside the hold. While turned back,
  the nearest unloaded ground is at least 64 m away, past where clear-weather fog begins at 48 m.
- `tests/runHarnessRemnants.test.ts` reads the opt-in encounter trace of whole shipped-arm runs: no fallen member is
  fielded again, every survivor comes back at the health it left with, and a square handed to another side fields
  its new owners whole; `fresh` breaks the first two on the same seeds.
  `tests/runHarnessFidelity.test.ts` walks a real `GeneratedWorldRuntime` back and forth over an edge, deeper than the
  hold and round a corner, beside the engine's own `syncGeneratedRegions`: the held window names the engine's squares
  on every frame and the instant window is told apart. `tests/streamingCentre.test.ts` holds the runtime to building
  no square and the engine to fielding nobody while an edge is walked back and forth.
- W1-2's whole-run test in `tests/runHarnessBalance.test.ts` and W3-5's stalled runs in `tests/errandPress.test.ts`
  were checked against their own rules. The remnants move none of their seeds. The hold moves W1-2's guard, re-picked
  as 126 705 (n = 16), and the elf keeps 118 786. Under the hold the errand stand-in no longer stalls W2-1's 79 191
  without the spine, which finishes its errand at 67 s, or 197 976 with it, at 238 s, and it now stalls 110 867 with
  the spine from 126 s. The test holds the new set, cut at 360 s.

## What it still does not model

The harness header lists these with the bias each one introduces. In short: no props, buildings, trees or water as
colliders. It therefore cannot measure W3-3 line of sight, cover rejection or blocked archer holds; those use engine
tests and a collider-dense generated settlement sample. No player bow, shield, rush, evasion, perfect guard or
knockback, so only the blow itself knocks a looter off a cart. No flanking, separation, commanders' orders and
rallies, or boar charges. The squad only follows. The
sustain policy is a script that never buys an upgrade. Caravan beats run on a straight lane with no cart collider,
and the scripted player picks the camp's offer by policy on the first frame rather than by reading the cards. Civilians,
ambient prowlers, campfires, achievements and the profile are not modelled. The pinned arms keep a 6.4 m/s walk, a
22 m sense range, a contract grace from before W1-1, a simulated 3x3, an inert commander, nobody making room and an
errand that waits for its site to clear, none of them the engine's. The staging arm's camera never looks round, so
what it counts as out of sight is what a player watching the road would not see.

One behaviour of a policy, not of the game, is kept on purpose. At low health the `cautious` player flees whatever
hostile is nearest, at any distance, and pinned against a square's edge it used to recentre the engine's window on
every crossing and field the squares beyond, tens of thousands of bodies in a run. W3-4's streaming hold masks that
thrash: the window no longer follows the flee across the edge. The policy is unchanged, and its fix is in the backlog
beside the cautious finale stall.

A number from this harness is a scripted player's, not a person's.
