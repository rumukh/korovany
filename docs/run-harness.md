# The run harness as a balance instrument

**Status:** W1-5, 2026-10-07. Tests-only: no game behaviour changed. The streaming window was corrected the same
day in #108, after W1-6 found the shipped arms simulating the whole 3x3. Every number below is from the corrected
window and **supersedes the baseline published with #106**, which was measured in the 3x3. Its 239 `crowded`
contract abandonments, and every figure derived from them, came from the harness rather than the game.

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
| `regionWindow` | `square`; `engine` with shipped encounters or fought events | `engine`: the plus | `square` |
| `commanders` | `inert`: a body and a swing | `shipped`: W1-6's call for men | `legacy`: the call before W1-6 |
| `escalation` (W2-1) | `time` | `progress`: pacing follows progress, enemy stats the clock | `time`; `progressAll` |
| `caravanBeats` (W2-2) | `off` | `shipped`, in `HARNESS_SPINE_ARMS`: the spine | `beatPolicy`: `walk`, `ignore` |

- **Squad.** `getStartingSquad`'s starters spawn where `spawnGeneratedStartingSquad` puts them, follow in formation
  through `selectSquadIntent` and `getSquadFollowSpeed`, fight through the squad's own `selectThreat` pass and the
  `CombatResolver` tables, and stay dead. A rescue recruits its captive, as `rescueCaptive` does.
- **Body and purse.** Hits roll `shouldInjurePlayer` and `injurePlayer`'s limb table; a lost limb bleeds and a lost leg
  slows. The starting boon ration is in the bag. The scripted player eats below half health, detours up to 90 m to a
  healer (+40, full stamina, wounds and bleeding cleared) or a trader (medicine +55, prostheses) when below 65 % or
  bleeding, and claims treasure. Gold comes from kills, loot, treasure, events, contracts and caravans at the
  engine's rates; prices follow the square's supply.
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
- **Commanders' call for men (W1-6).** `updateCommander` calls a soldier every 25 s, four per commander each time he
  is fielded. `legacy` is the rule before W1-6: every commander, all the time, each call borrowing room the budget
  lends. `shipped` is the rule now: a commander who is not hostile to the player calls only while his own people are
  fighting, and every call takes a slot out of `campaign`'s own share or waits. The clock, the gate and the admission
  are exported (`advanceCommanderClock`, `commanderGathers`), and the fidelity test steps them beside the engine's own
  `updateCommander` frame for frame. Only the guard meets such a commander: the boss slots of the elf's and the
  villain's finales are the guard's own strongholds, so for the guard they field friendly garrisons, each led by one.

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

**Known engine behaviour, mirrored rather than fixed.** When a square streams back into the plus, the engine refields
every encounter in it that was not cleared, at full health. Only uniques and cleared encounters are remembered, in the
region's delta. A player who crosses back and forth over a square's edge meets the same encounter again each time,
unhurt, and the damage they dealt is erased. The harness does the same, so its numbers include it: a `cautious` run,
whose retreats cross edges, spawns 477 to 1 080 encounter bodies against about 70 for the other policies. It is
logged for wave 3 as a streaming-hysteresis and encounter-persistence item.

## Metrics

Every report carries a `balance` block, populated by the arms that feed it. Nothing in it draws from any stream.

- **Caravans:** robbed, escorted and lost, by cart; robberies lost to NPCs, and the squad's share of them, which W1-2
  keeps at zero; claims the player opened, loads started and loads the player broke.
- **Contracts:** started, kept, failed, abandoned, and why each abandoned contract stalled (`crowded` or `noGround`).
  `lostToEvents` counts W1-1's symptom, a contract abandoned while a random event was up. Also counted: seconds a
  contract waited on its site and why, located fights handed back to make room, and random events stood down.
- **Rumour feasibility:** for every offer, the atlas's road ETA from where the player stood against the time to its
  deadline, and the share beyond reach.
- **Companions:** started, recruited, lost and to whom, standing when the finale opened and at the end, their kills.
- **Doctrine drafts reached** and the **maximum threat tier**, whatever the doctrine arm.
- **W2-1:** every tier rise with its cause (`time` or `progress`), when each draft actually opened and how many of
  them the 30 s ceiling opened outside a calm moment (`draftsForced`), the finale's pacing tier and the clock's tier
  its boss was scaled by, and threat waves by trigger (clock or closed objective).
- **Damage by system** (encounter, finale, random, contract or located event, threat wave, caravan, bleeding) and the
  **system behind each death**.
- **Encounters:** how many the generator fielded, the bodies it spawned, how many stood on the road at once on
  average, and the seconds in which the actor budget refused one. The report's `regionWindow` names the window. Also
  the soldiers commanders called (W1-6), which count on the road once called.
- `sweepBalance` aggregates them per faction and policy, with the run-length distribution.

## Running it

```bash
node --experimental-strip-types --test tests/runHarnessBalance.test.ts
KOROVANY_BALANCE_SEEDS=40 node --experimental-strip-types --test tests/runHarnessBalance.test.ts
```

The committed file runs in about 20 s: its sweep takes three seeds per cell and asserts bands that held at forty.

## Baseline

`HARNESS_SHIPPED_ARMS`, 30 Hz, 600 s limit, seeds `1 + 7919 n` for n = 0…39: 360 runs on `main` at 29adca3, in the
engine's streaming window. W1-6 added `commanders: 'shipped'` to the shipped arms. The same 360 runs with it are this
baseline cell for cell: no friendly garrison fought beside a scripted player long enough to call a soldier.

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
- **Rumours.** 420 of 1 226 offers (34 %) were beyond the player's reach the moment they were offered.
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
`legacy` and then `shipped`; 30 Hz, 600 s, seeds `1 + 7919 n` for n = 0…39, all three policies, 120 runs a row.

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
- **Known residual.** The three `crowded` arrivals are one site: seed 1's «Зверьё у домиков» (`cull`), which every
  policy reaches on the contrary arm. Its window holds 18 bodies of the guard's own garrisons, and a beast raid needs
  five slots where four are left, under every commander rule, `inert` included. A guard who takes that arm always
  loses its payout. A follow-up lets the guard's own idle garrisons step out of sight to make room for a contract.
- The scripted player is what hides the old cost. `tests/commanderReinforcements.test.ts` fields each contract
  site's window through the engine's own spawner and holds the player 100 s by it before arriving. Over the 240 sites
  the old rule crowds out 16 of the guard's 80, and 11 with every hostile pack cleared; the shipped rule crowds out
  one, the same seed 1 site. A person who fights, heals or looks around by the palace before taking the contract
  pays the old rule's price; a script does not.

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
  count moved, under `progress` or `progressAll`.
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
and two met carts to a W2-1 progress step. Staging follows the engine's seam: W1-1's make-way, a campaign reservation,
a retry every 2 s and a cart let through after 30 s. The arms are `beatPolicy` (`engage`, `walk`, `ignore`),
`openingPolicy`, `verbPolicy`, `beatGate`, `beatsPerProgressStep` and `roadCart: 'farm'`. With the spine off every
report is main's byte for byte: 72 of 72 runs compared under the shipped and the pinned arms.

`HARNESS_SPINE_ARMS` against `HARNESS_SHIPPED_ARMS`, 30 Hz, 1 200 s, seeds `1 + 7919 n`: beeline 40, cautious 30 and
duelist 20 per side, 270 runs a row. Won in p50 is the middle of the three sides' medians.

| Arm | Wins (beeline / cautious / duelist) | Won in p50 | Carts met per run | Finale tier |
| --- | --- | --- | ---: | --- |
| spine off | 134 (49 / 29 / 56) | 89 / 88 / 93 s | — | 3 |
| spine | 127 (49 / 28 / 50) | 117 / 118 / 148 s | 2.05 | 4 |
| one cart per step | 115 (45 / 26 / 44) | 132 / 130 / 148 s | 2.04 | 4 |
| K = 3 | 96 (33 / 16 / 47) | 145 / 158 / 164 s | 2.79 | 4 |
| `walk` | 97 (37 / 16 / 44) | 179 / 174 / 197 s | 2.02 | 4 |
| `ignore` | 0 | — | 0.01 | never fielded |
| road cart farmed | 102 (36 / 18 / 48) | 136 / 130 / 148 s | 2.02 | 4 |

- Every side meets its caravans: about two a run, robbed or walked in. The elves rob 2.0, the villain 2.1, and the
  guard confiscates 0.9 and walks in or sends on 1.2, so «корованов — 0» is gone. 1 % of carts end lost or escaped.
- The camp closes at a median 17–25 s and the finale's gate opens at 82–113 s.
- Two met carts to a step is the coordinator's fallback, taken because one to a step put the threat waves at 1 036
  damage against the baseline's 367 and cost the duelist 12 wins. Two to a step keeps the waves at 392. Beeline wins are
  unchanged, cautious lose one and duelist six (10 points). The finale is fought at pacing tier 4 either way, against
  3 without the spine; its boss stays scaled by the clock.
- The scripted player's median win grows by 28–55 s, a third to two thirds. This harness cannot show option A's 6–10
  minutes: its player walks straight to every target, never reads a card and wins in a minute and a half without the
  spine. K = 3 adds another 30 s and costs another 31 wins, which is why the gate asks for two.
- Both offers are worth taking. Seeded, the scripted player took the trunk's 46 % of the time and the light one's 52 %.
  Forced, the trunk offer won 135 and the other road's 137.
- The verbs are real choices. An elf who gives heals 140 a run from rations against 31 and wins 37 of 90 against 28; a
  villain who press-gangs or burns brings 3.9 companions to the finale against 2.8, takes 32 finale damage against 42,
  and wins 52 against 38. A guard who walks carts in wins 57 against 40 for one who sends them on unpaid.
- Farming the road cart does not dominate: 84 more gold a run, 25 fewer wins, because its detours keep the player in
  fights. Without the spine the same farming was worth 10 wins (144 against 134); the carts are the better use of the
  time.
- Staging: 7 carts in 270 runs waited for room, 28 s in all, and none waited long enough to go through unfought. W1-6's
  step-back would change little here; the seam is ready for it.
- `ignore` is the gate's negative control: no win and no finale fielded in 270 runs. `walk` is the fail-forward
  control: 98 % of its carts settle on the walked-away clock, its gate opens at a median 135–161 s, and 97 runs win.
- `tests/runHarnessBeats.test.ts` holds these in whole runs: off is inert, the camp and the gate behave, `ignore` never
  reaches the finale, `walk` settles every cart by its clock, a crowded road makes way first and then lets the cart
  through, and each arm does what its name says.

## What it still does not model

The harness header lists these with the bias each one introduces. In short: no props, buildings, trees or water as
colliders. No player bow, shield, rush, evasion, perfect guard or knockback, so only the blow itself knocks a looter
off a cart. No flanking, separation, commanders' orders and rallies, or boar charges. The squad only follows. The
sustain policy is a script that never buys an upgrade. Caravan beats are modelled only in `HARNESS_SPINE_ARMS`,
on a straight lane with no cart collider and a player who takes the camp's offer on the first frame. Civilians,
ambient prowlers, campfires, achievements and the profile are not modelled. The pinned arms keep a 6.4 m/s walk, a
22 m sense range, a contract grace from before W1-1, a simulated 3x3 and an inert commander, none of them the
engine's.

A number from this harness is a scripted player's, not a person's.
