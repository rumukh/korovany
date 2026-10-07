# The run harness as a balance instrument

**Status:** W1-5, 2026-10-07. Tests-only: no game behaviour changed.

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
| `escalation` (W2-1) | `time` | `progress`: pacing follows progress, enemy stats the clock | `time`; `progressAll` |

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
on the start site, wins as often and takes about 20 s longer per win: a beeline p50 of 128 s against 106 s.

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
- **W2-1:** every tier rise with its cause (`time` or `progress`), when each draft actually opened, the finale's
  pacing tier and the clock's tier its boss was scaled by, and threat waves by trigger (clock or closed objective).
- **Damage by system** (encounter, finale, random, contract or located event, threat wave, caravan, bleeding) and the
  **system behind each death**.
- `sweepBalance` aggregates them per faction and policy, with the run-length distribution.

## Running it

```bash
node --experimental-strip-types --test tests/runHarnessBalance.test.ts
KOROVANY_BALANCE_SEEDS=40 node --experimental-strip-types --test tests/runHarnessBalance.test.ts
```

The committed file runs in about 20 s: its sweep takes three seeds per cell and asserts bands that held at forty.

## Baseline

`HARNESS_SHIPPED_ARMS`, 30 Hz, 600 s limit, seeds `1 + 7919 n` for n = 0…39: 360 runs, on `main` at d56950b with
W1-1's contract rule and W1-2's caravan claim merged.

| Policy · faction | Win / defeat / timeout | Won in p10–p50–p90 | Damage taken | Kills |
| --- | --- | --- | ---: | ---: |
| beeline · elf | 15 / 25 / 0 | 79–109–233 s | 142 | 2.7 |
| beeline · guard | 16 / 24 / 0 | 85–105–185 s | 154 | 3.4 |
| beeline · villain | 25 / 15 / 0 | 79–92–116 s | 105 | 2.6 |
| cautious · elf | 13 / 10 / 17 | 81–109–233 s | 128 | 2.5 |
| cautious · guard | 14 / 14 / 12 | 86–105–158 s | 145 | 3.4 |
| cautious · villain | 21 / 11 / 8 | 79–93–111 s | 101 | 2.5 |
| duelist · elf | 38 / 2 / 0 | 82–99–129 s | 106 | 8.9 |
| duelist · guard | 38 / 2 / 0 | 86–108–129 s | 91 | 8.5 |
| duelist · villain | 36 / 4 / 0 | 81–97–132 s | 90 | 8.5 |

| Policy · faction | Squad at finale | Drafts p50 / max | Tier p50 / max | Contracts s / k / a | Late rumours |
| --- | --- | --- | --- | --- | ---: |
| beeline · elf | 2.8 (37/38) | 0 / 2 | 1 / 3 | 13 / 13 / 26 | 41 % |
| beeline · guard | 2.8 (38/39) | 0 / 1 | 1 / 2 | 13 / 12 / 27 | 15 % |
| beeline · villain | 2.9 (40/40) | 0 / 0 | 1 / 1 | 12 / 12 / 28 | 21 % |
| cautious · elf | 2.9 (38/38) | 1 / 3 | 2 / 4 | 14 / 14 / 26 | 60 % |
| cautious · guard | 2.8 (38/39) | 0 / 3 | 1 / 4 | 13 / 12 / 27 | 35 % |
| cautious · villain | 2.9 (40/40) | 0 / 3 | 1 / 4 | 12 / 12 / 28 | 37 % |
| duelist · elf | 3.1 (40/40) | 0 / 0 | 1 / 1 | 17 / 17 / 23 | 35 % |
| duelist · guard | 3.0 (40/40) | 0 / 0 | 1 / 1 | 14 / 11 / 26 | 16 % |
| duelist · villain | 3.0 (40/40) | 0 / 0 | 1 / 1 | 12 / 12 / 28 | 25 % |

Squad at finale is the mean number of companions standing when the finale opened, recruits included, and in brackets
the finales at least one of them reached. Tier is the highest threat tier the campaign reached. Contracts are started,
kept and abandoned.

Over all 360 runs:

- **Run length.** 306 runs end inside three minutes; the 37 that reach ten are all cautious stalls.
- **Deaths.** 107 defeats: the finale 51, the road's encounters 27, located fights 14, bleeding 12, random events 2,
  a threat wave 1. The finale deals the most damage (22 403), then encounters (14 960); events, threat waves and the
  road cart's escort together deal 4 720.
- **Contracts.** 120 started, 115 kept and 5 failed; 239 abandoned, every one of them `crowded`. W1-1 took the
  random events out of the cause: 11 stood down for a contract, and 48 located fights were handed back to make room.
  Eighteen abandonments still came with a random event up, which is W1-1's symptom, because even its making way
  would not have left room. What is left is the shared actor budget: the 3 × 3 window's own encounters hold it, and
  `campaign` may borrow all of `chronicle`'s room. Before W1-1 the same sweep kept 63 and abandoned 288, 88 of them
  to a random event.
- **Caravans.** The scripted players robbed 18 carts, all of them contract caravans, and 21 rich caravans drove off
  unrobbed. No NPC took a cart: not one load was started. A claim opened 120 times, each after the player won an
  escort fight, and `ignore` never went back for the cargo. Before W1-2, the same sweep lost 35 road carts to the
  elf's and villain's own squad. Under `engage`, chronicle ambush raiders do load their cart, and the W1-2 test in
  `runHarnessBalance.test.ts` shows it.
- **Events.** 365 random events and 1 238 located fights; 15 threat waves; 11 events won without the player.
- **Rumours.** 451 of 1 222 offers (37 %) were beyond the player's reach the moment they were offered.
- **Economy.** About 182 gold earned and 9 spent per run. About 54 health healed per run: rations 10 235,
  healers 4 613, medicine 2 258, loot 2 055.

## What each arm is worth

The same seeds, 20 per faction, `beeline` and `duelist`, with one arm changed at a time. The `reviewArms` row turns
every W1-5 arm off. With the review's own `commit` rumours and 1 200 s limit, those arms give 53/60 against 0/60:
the review's 88 % against 0 %.

| Arms | Beeline wins (elf / guard / villain) | Duelist wins (elf / guard / villain) | Beeline p50 | Duelist p50 |
| --- | --- | --- | ---: | ---: |
| all | 30/60 (7 / 11 / 12) | 55/60 (18 / 18 / 19) | 106 s | 104 s |
| `squad: off` | 14/60 (2 / 5 / 7) | 31/60 (9 / 12 / 10) | 117 s | 108 s |
| `squad: decoy` | 22/60 (5 / 6 / 11) | 50/60 (15 / 19 / 16) | 102 s | 106 s |
| `sustain: off` | 19/60 (4 / 7 / 8) | 30/60 (7 / 10 / 13) | 87 s | 94 s |
| `sustain: visit` | 23/60 (5 / 8 / 10) | 34/60 (8 / 13 / 13) | 93 s | 101 s |
| `eventModel: counted` | 31/60 (6 / 11 / 14) | 58/60 (18 / 20 / 20) | 102 s | 102 s |
| `encounterModel: harness` | 59/60 (20 / 19 / 20) | 34/60 (10 / 13 / 11) | 90 s | 159 s |
| `playerKit: harness` | 30/60 (8 / 13 / 9) | 56/60 (17 / 20 / 19) | 128 s | 127 s |
| reviewArms | 59/60 (20 / 20 / 19) | 1/60 (1 / 0 / 0) | 97 s | 181 s |
- The squad and healing are what turn fighting from fatal into the safer choice. Each roughly doubles the duelist's
  wins. The decoy placebo keeps most of the squad's value for a fighter, so the squad matters more as bodies between
  the player and the blow than as damage.
- The `visit` placebo lands near `sustain: off`, so the healing itself is the effect, not the detours to it.
- The generator's own encounters, not the stand-in's, are what make walking past everything dangerous.
- Events change little, because the shared actor budget is usually already full of encounters when the director
  tries to place one.

## W2-1: escalation by progress

Since W2-1 the shipped arms carry `escalation: 'progress'`: the pacing tier (the HUD's «Угроза», the drafts, the
director's cadence and the threat waves) is the clock or the run's progress, whichever is further, and enemy health
and damage stay on the clock's tier. `time` is the rule before it, and `progressAll` is the design that was measured
and rejected: progress scaling enemy stats as well. Same seeds, 30 Hz, 600 s, 40 seeds per cell:

| Policy · faction | `time` wins | `progress` wins | Drafts per win | `progressAll` wins |
| --- | ---: | ---: | ---: | ---: |
| beeline · elf | 15/40 | 13/40 | 2 | 6/40 |
| beeline · guard | 16/40 | 17/40 | 2 | 13/40 |
| beeline · villain | 25/40 | 25/40 | 2 | 17/40 |
| cautious · elf | 12/40 | 11/40 | 2 | 4/40 |
| cautious · guard | 14/40 | 16/40 | 2 | 9/40 |
| cautious · villain | 21/40 | 21/40 | 2 | 13/40 |
| duelist · elf | 38/40 | 36/40 | 2 | 30/40 |
| duelist · guard | 38/40 | 36/40 | 2 | 29/40 |
| duelist · villain | 36/40 | 36/40 | 2 | 34/40 |

- Under `time` the median win opened no draft. Under `progress`, 198 of 211 wins opened two or more before the end.
  Drafts wait for calm: the median delay after the tier that dealt them is 0 s, the p90 6.9 s.
- The finale is fought at pacing tier 3 with its boss scaled at the clock's tier 1. Under `progressAll` the same boss
  had a quarter more health, and the finale's defeats are most of the gap in that column.
- Run length moved by less than ten percent in every cell.
- «Устав дозора» stays distinct. Runs that held it threw 217 waves on closures and none on the clock; runs without it
  threw none on closures.
- `tests/runHarnessEscalation.test.ts` holds these in whole runs. With no card taken and the director silent, a
  `progress` run is the `time` run to the frame, and a `progressAll` run is not.

## What it still does not model

The harness header lists these with the bias each one introduces. In short: no props, buildings, trees or water as
colliders. No player bow, shield, rush, evasion, perfect guard or knockback, so only the blow itself knocks a looter
off a cart. No flanking, separation, commanders or boar charges. The squad only follows. The sustain policy is a
script that never buys an upgrade. The bridge ambush, civilians, ambient prowlers, campfires, achievements and the
profile are not modelled. The pinned arms keep a 6.4 m/s walk, a 22 m sense range and a contract grace from before
W1-1, none of them the engine's.

A number from this harness is a scripted player's, not a person's.
