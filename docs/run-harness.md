# The run harness as a balance instrument

**Status:** W1-5, 2026-10-07. Tests-only: no game behaviour changed. The streaming window was corrected the same
day, after W1-6 found the shipped arms simulating the whole 3x3; every number below is from the corrected window.

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
  beside the engine's `updateCaravanEscort` and the ambush's `update`, frame for frame.
- **Contracts as the engine runs them, W1-1 included.** Before the fix landed, the harness reproduced the defect: seed
  31677 as the elf lost its contract to a bounty, and the same run with the director held `silent` kept it. The
  fidelity test written to go red when the fix landed did. Now a random event the player was merely near stands down,
  and the contract waits while the player is fighting one. Located fights are handed back to make room, the director
  keeps out within 120 m of an un-started contract, and only a genuine stall, `crowded` or `noGround`, spends the
  12 s grace. Seed 95029 shows the stand-down in a whole run.
- **The finale** is driven by `FinaleDirector.advanceFinale` and `resolveFinaleContactTargets`: tells, footprints,
  charges and volleys, not an ordinary swing.

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
45 s a run, which is what refused the contract builders. With `regionWindow: 'square'`, the shipped arms give the
first baseline back exactly, cell for cell.

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
  deadline, and the share beyond reach. W2-3 adds, per run, the candidates the board looked at while an offer was due
  and how many it turned down as beyond reach (`candidatesSeen`, `candidatesUnreachable`), and what kept rumours paid
  into the purse (`rewardGold`, `rewardRations`). The pay only lands while `sustain` models the purse.
- **Companions:** started, recruited, lost and to whom, standing when the finale opened and at the end, their kills.
- **Doctrine drafts reached** and the **maximum threat tier**, whatever the doctrine arm.
- **Damage by system** (encounter, finale, random, contract or located event, threat wave, caravan, bleeding) and the
  **system behind each death**.
- **Encounters:** how many the generator fielded, the bodies it spawned, how many stood on the road at once on
  average, and the seconds in which the actor budget refused one. The report's `regionWindow` names the window.
- `sweepBalance` aggregates them per faction and policy, with the run-length distribution.

## Running it

```bash
node --experimental-strip-types --test tests/runHarnessBalance.test.ts
KOROVANY_BALANCE_SEEDS=40 node --experimental-strip-types --test tests/runHarnessBalance.test.ts
```

The committed file runs in about 20 s: its sweep takes three seeds per cell and asserts bands that held at forty.

## Baseline

`HARNESS_SHIPPED_ARMS`, 30 Hz, 600 s limit, seeds `1 + 7919 n` for n = 0…39: 360 runs on `main` at 29adca3, in the
engine's streaming window.

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
  handed back to make room. In the 3x3 the same sweep started 120 and abandoned 239 as `crowded`. The starvation the
  first baseline reported came from the harness's window, not from the game.
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

### W2-3: rumours the player can meet

The same 360 runs on W2-3, which offers a rumour only when the player can meet it from where they stand, and none
while one is pinned. The board offers 545 rumours instead of 1 226. The road-only estimate above still calls 66 of
them late (12 %), every one an escort: it times the walk to the square the cart is in when offered, while the board
times it to the square where the player would meet the cart. Wins, run lengths and gold do not move: 200 wins against
201, every cell's p10–p50–p90 within a second, about 334 gold a run.

| Policy · faction | Win / defeat / timeout | Late rumours |
| --- | --- | ---: |
| beeline · elf | 14 / 26 / 0 | 8 % |
| beeline · guard | 14 / 24 / 2 | 25 % |
| beeline · villain | 22 / 18 / 0 | 0 % |
| cautious · elf | 12 / 16 / 12 | 16 % |
| cautious · guard | 10 / 16 / 14 | 25 % |
| cautious · villain | 19 / 9 / 12 | 1 % |
| duelist · elf | 35 / 5 / 0 | 5 % |
| duelist · guard | 36 / 4 / 0 | 5 % |
| duelist · villain | 38 / 2 / 0 | 0 % |

The review's `commit` arm pins the first rumour within 110 m and walks to it. With honest melee, heavy defence, the
nearest contract, seeded doctrines and a 1 200 s limit, in the engine's window (`regionWindow: 'engine'`), 40 seeds
per faction:

| Policy | Offers a run | Kept | Broken (while pinned) | Kept : broken | Wins | Median win |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| beeline before | 4.35 | 1.11 | 2.40 (0.68) | 0.46 | 111 / 120 | 156 s |
| beeline after | 2.11 | 1.32 | 0.28 (0.09) | 4.8 | 113 / 120 | 117 s |
| cautious before | 8.68 | 1.18 | 6.61 (1.24) | 0.18 | 96 / 120 | 151 s |
| cautious after | 2.33 | 1.38 | 0.50 (0.19) | 2.8 | 104 / 120 | 118 s |

After W2-3 every faction keeps at least 2.2 rumours for each one it breaks: beeline elf 4.3, guard 4.1, villain 6.1;
cautious elf 2.2, guard 2.6, villain 3.4. More are kept because the arm no longer holds its one pin on a rumour it
cannot meet, and a nearby rumour's clock is 48 s rather than 96 s. That is also why its winning runs are shorter.

With every W1-5 arm on as well (`HARNESS_SHIPPED_ARMS` with `rumourPolicy: 'commit'`, 600 s), kept : broken goes
from 0.36 to 1.39 for `beeline` and from 0.11 to 0.39 for `cautious`, on 52 % and 68 % fewer offers. The guard's and
the villain's kept rumours paid 8 to 9 gold a run, 2.4 % to 2.9 % of what their runs earned, and the elf's 0.33 to
0.57 rations a run against the 1.0 to 1.4 it ate. Here the scripted player's own goals take the wheel from a pinned
rumour: a healer, a contract's fight, the road cart. It also chases a pinned escort from square to square, so 35 of
the 41 rumours `beeline` broke were escorts. The `cautious` arm meets the same encounters again each time it retreats
across a square's edge, as the window section above describes.

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

## What it still does not model

The harness header lists these with the bias each one introduces. In short: no props, buildings, trees or water as
colliders. No player bow, shield, rush, evasion, perfect guard or knockback, so only the blow itself knocks a looter
off a cart. No flanking, separation, commanders or boar charges. The squad only follows. The sustain policy is a
script that never buys an upgrade. The bridge ambush, civilians, ambient prowlers, campfires, achievements and the
profile are not modelled. The pinned arms keep a 6.4 m/s walk, a 22 m sense range, a contract grace from before
W1-1 and a simulated 3x3, none of them the engine's.

A number from this harness is a scripted player's, not a person's.
