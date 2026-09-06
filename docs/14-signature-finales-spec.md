# NG-14 - Signature finales

**Status:** implemented and integrated locally; see [combined acceptance](NEXT-GEN.md#6-integrated-milestone).
**Parent contract:** [Next-generation milestone](NEXT-GEN.md).
**Baseline:** `0993fa6`.

## 1. Outcome

Each faction's expedition ends in a recognizable encounter with a named opponent,
two meaningful phases, readable attacks, and a reason to use movement, defense, and
squad commands. The ending must remain compatible with the generated campaign and
with save/continue.

Do not confuse a larger health pool, another ordinary champion, or a cosmetic title
with a new encounter.

## 2. Verified baseline and an important constraint

`content\registry.ts` builds each boss encounter as one objective-eligible unique
boss and two escorts. Its ordinary role mapping is elf -> champion, guard ->
commander, villain -> champion.

More importantly, `WorldGenerator.FINALE_TERRITORIES` fixes enemy ownership:

| Player campaign | Existing finale enemy | New encounter identity |
| --- | --- | --- |
| Elf | Guard | Imperial Huntsmaster: a ranged pursuit/exposure fight |
| Guard | Villain | Fort Warlord: a committed heavy-attack fight |
| Villain | Guard | Palace Marshal: a command-and-frontage fight |

Use these three **campaign-specific** profiles. A plan keyed only by enemy allegiance
would give elves and villains the same finale, while a new elf enemy profile would
be unreachable in the current generator. Do not change ownership or world topology
to conceal that mistake.

`spawnGeneratedRegionEncounters` already gates the player's final encounter on
prerequisites and assigns the final objective ID to its unique boss. Build on that
ownership. Regular champions, other campaigns' boss slots, and ordinary commanders
must not acquire the new finale behavior accidentally.

## 3. Encounter vocabulary

Use working internal IDs `huntsmaster`, `warlord`, and `marshal`. Final names and
short attack cues belong in Russian copy. Preserve the existing faction colors.

### Imperial Huntsmaster - elf campaign

Ranged pressure alternates with deliberate recovery. A readable three-shot fan and
an aimed firing lane force the player to choose lateral movement or closing distance.
Between attacks the boss may reposition to validated nearby arena anchors rather
than teleporting or shooting through cover.

Below half health, alternate firing lanes and fan pressure in a different sequence,
but retain a punishable recovery. Do not make the bow faction win by waiting through
permanent ranged invulnerability. The held weapon and visible telegraph must explain
the projectile attack.

### Fort Warlord - guard campaign

Alternate a broad, clearly marked cleave with a committed straight charge. Aim is
locked before the damaging part; the charge cannot track the player around a corner.
Missing exposes the boss to a visible recovery.

Below half health, use a two-part heavy sequence with a distinct second tell. The
guard can block or time a perfect guard where the common defense rules permit it,
or move aside. Do not require the sibling dodge's invulnerability to survive an
otherwise unavoidable pattern.

### Palace Marshal - villain campaign

Alternate a directional command/sweep pattern with a formation-breaking advance.
The two existing escorts support the marshal's frontage; eliminating or focusing an
escort changes the space available to the player. Do not summon unlimited replacements.

Below half health, the marshal abandons the static frontage for a more aggressive
sequence, leaving a clear counterattack interval. The villain's cleave and the
squad's focus/regroup orders should have an intelligible use, not a scripted bonus.

### Shared fairness rules

- At least 0.55 seconds of visible tell for signature attacks and at least 0.4 seconds
  of punishable recovery after a heavy sequence are initial tuning targets.
- A phase change occurs once on crossing 50% health; it is not a heal or an immunity
  wall. No action resolves damage on the same frame it first advertises its tell.
- Damage uses current positions and the advertised cone/lane/projectile footprint.
  Locked attacks cannot silently retarget during contact.
- All attacks respect collision, current player defense, armor, injury, death-cause
  attribution, and the existing damage-feedback path.
- Do not fire through props, across inactive regions, or from an unloaded boss.

## 4. Architecture

Add a pure `world\FinaleDirector.ts` for encounter definitions, phase/action state,
bounded timers, and attack/movement intents. It consumes plain combat/arena inputs
and returns explicit intents. It must be callable by tests and by the live engine.

Use a dedicated derivation such as `finale:<encounterId>` for any seeded variation,
or fixed deterministic sequences. UI and phase presentation never consume existing
combat, loot, event, or chronicle streams.

The engine adapter owns collision-aware movement, projectile creation, hit resolution,
actor lookup, and feedback. It calls the existing `damagePlayer`/`damageActor` and
objective completion paths. NG-11's optional `sourceActorId` spelling is the shared
attacker-identity contract; do not create another health or damage counter.

Do not modify the global role speed table to make a finale commander move. Only the
identified finale actor receives its profile's movement behavior. Ordinary immobile
commanders and unrelated AI retain their current contracts.

## 5. Arena, budget, and presentation

Use the generated finale site and nearby collision-valid anchors. The world remains
open: no new wall can trap the player or sever a critical road. Leash the encounter
to a recoverable area and return actors by navigation, not teleportation.

Prioritize the unique boss within the existing campaign actor budget. Its two escorts
are bounded supporting actors, not a new population system. An unavailable escort
slot cannot strand the campaign. Do not evict player companions to fund spectacle,
raise `MAX_ACTORS = 25`, or reset the encounter when an optional spawn is deferred.

Expose `GameView.finale` with identity, health, phase, and concise current tell.
Use `ui\FinaleHud.tsx` and feature-scoped CSS. Show the encounter only when relevant;
do not leak another campaign's boss through fog.

Provide a short, non-blocking introduction, distinct telegraph shapes/cues, and a
legible defeat beat. Reuse the art library, rig, audio cues, and existing boss music
intensity. Any new procedural weapon/accent must use bounded shared resources and
have explicit disposal. No imported model, cutscene service, or soundtrack rewrite.

Reduced motion and bloom-off modes retain every gameplay tell. Important warnings
cannot depend on screen shake, color alone, particles, or a camera cut.

## 6. Persistence and campaign safety

Own `directorState.finale`, with a version, encounter/boss identity, phase, health,
remaining action/recovery state, and bounded escort state as required. Avoid storing
duplicate unbounded actor/world snapshots.

Unloading or leaving the arena suspends the encounter's relevant action state. It
does not heal the boss, duplicate escorts, continue invisible attacks, or grant loot.
Reentry and continue restore health/phase before the first damaging update.

The existing defeated actor/cleared encounter deltas are authoritative. A stale
director block cannot resurrect a dead boss. A completed objective remains completed
when the new block is absent in a legacy save.

Only the actual owned final boss defeat completes the final objective. Respect its
prerequisites and the existing terminal-run finalization path. An ally delivering the
last blow must not strand the run, and repeated death/stream/save callbacks must not
award the result twice. Unlike an ordinary contract, a finale does not fail forward
to an automatic win merely because the player arrived.

## 7. Acceptance

1. Each campaign selects the intended reachable profile from its existing finale,
   without changing the blueprint fingerprint or enemy ownership.
2. All profiles emit demonstrably different attack traces in both phases. A negative
   control aliasing one profile to another must fail the identity test.
3. Tell, contact, locked aim, and recovery are exercised at 30/60/144 Hz schedules.
   A control that applies damage at the first tell must fail.
4. Movement/defense can avoid or mitigate signature attacks through their real
   footprints. Correctly timed counterplay differs from standing in the attack.
5. Regular champions, ordinary commanders, and another campaign's boss slot keep
   their previous behavior and cannot trigger the player's finale HUD or victory.
6. A mid-fight save round-trips boss health, phase, and already-consumed actions.
   Reentry, depleted actor budget, and stale defeated IDs cannot duplicate or heal.
7. Boss death by player or companion completes the correct final objective once.
   Defeat remains terminal, rewards remain bounded, and unavailable escorts do not
   turn into mandatory missing targets.
8. All three finales are observed in the actual browser, including phase transition,
   defense, disengage/reentry, and a terminal outcome. Test-only setup may arrange a
   reproducible encounter; it must not replace the engine's fight or victory logic.
9. Existing rendering ownership and actor budgets hold; new effects disappear on
   completion, unload, and engine destruction.

Add focused director and runtime cases, such as `tests\finaleDirector.test.ts`.
Relevant existing coverage is:

```text
node --experimental-strip-types --test tests\finaleDirector.test.ts tests\finaleRuntime.test.ts tests\combatResolver.test.ts tests\campaignDirector.test.ts tests\factionContracts.test.ts tests\actorBudget.test.ts tests\campaignView.test.ts tests\runStorage.test.ts tests\runEpilogue.test.ts tests\hints.test.ts
npm run build
```

Update this specification with final timings and delivered pattern details. Clearly
separate observed browser behavior from pure simulation or uncompleted scenarios.

## 8. Delivered slice

Implementation base: `8cc1186a5538aa98e9d32fd8559d6fb2c1a0a462`, which adds the
upstream UI fixes after the inspected `0993fa6` baseline. Neither generator data nor
the world fingerprint algorithm changes.

### Production paths

`world\FinaleDirector.ts` supplies the campaign-specific identity, deterministic
sequences, phase latch, bounded state normalizer, contact admission, and explicit
movement/contact intents. `GameEngine` invokes it only for the unique actor owned by
the player's final encounter. Ordinary commanders still have speed zero; ordinary
champions and the other campaigns' encounter slots do not enter this branch.

The initial and live `CampaignView` paths publish the nullable `GameView.finale`
record. Its fields are `profile`, `encounterId`, `bossId`, `name`, `enemyFaction`,
`health`, `maxHealth`, `phase`, `stage`, `cue`, `progress`, and `escortsAlive`.
`bossId` in the view is the live `generated:<spawnId>` actor ID. The persistence
identity uses the stable generated spawn ID instead.

Russian names and cues live in `content\gameCopy.ts`, with a real first-sighting
entry in `content\hints.ts`. `ui\FinaleHud.tsx` is non-interactive and non-blocking.
It shows the health, phase, current tell/recovery, and surviving escort count; the
existing end screen also names the defeated opponent. No keys or overlays are added.
While this HUD is present, notices move away from its tell and health display.

The profiles reuse the guard/villain rigs and geometry/material caches: bow, hood and
quiver for the Huntsmaster; maul and heavy headgear for the Warlord; glaive and crested
officer kit for the Marshal. Allegiance colors remain unchanged. Ground tells use at
most three reusable, terrain-projected meshes of at most 64 triangles each, rather
than particles or bloom. The
existing boss music intensity and sound cues are reused.

### Patterns and final timings

Health below is the tier-one profile maximum. The existing enemy health multiplier
is applied on first materialization, and the resulting maximum and current health
are then persisted rather than recomputed on reentry.

| Campaign / profile | Base health | Phase one | Phase two | Approach speed, phase 1 / 2 |
| --- | --- | --- | --- | --- |
| Elf / `huntsmaster` | 340 | Fan, lane | Lane, fan, lane | 3.2 / 3.8 |
| Guard / `warlord` | 440 | Cleave, straight charge | Heavy cleave, separately told slam, charge | 2.8 / 3.4 |
| Villain / `marshal` | 380 | Command sweep, advance; two flanking escort posts | Advance, broad press, advance; escorts no longer hold static frontage | 2.3 / 4.0 |

| Attack | Tell | Contact | Recovery | Footprint / base damage |
| --- | --- | --- | --- | --- |
| Fan | 0.75 s | 0.16 s release | 1.05 s | Three arrows at -0.28, 0 and +0.28 radians; range 24, speed 20, damage 9 each |
| Lane | 0.80 s | 0.16 s release | 0.85 s | One locked arrow; range 27, speed 25, damage 17 |
| Cleave | 0.80 s | 0.18 s | 0.90 s | Radius 4.6, half-angle 1.05 radians, damage 22 |
| Charge | 0.90 s | 0.75 s | 1.10 s | Straight travel up to 7.5, speed 10, half-width 0.95, damage 24 once per body |
| Heavy cleave | 0.70 s | 0.18 s | 0.40 s | Radius 4.8, half-angle 1.25 radians, damage 20 |
| Heavy slam | 0.65 s | 0.18 s | 1.10 s | Length 5.2, half-width 1, damage 26 |
| Command sweep | 0.85 s | 0.18 s | 0.80 s | Radius 4.2, half-angle 1.2 radians, damage 18 |
| Advance | 0.75 s | 0.80 s | 0.65 s | Straight travel up to 5.6, speed 7, half-width 0.85, damage 19 once per body |
| Press | 0.75 s | 0.18 s | 1.05 s | Radius 4.8, half-angle 1.4 radians, damage 23 |

The 1.4-second introduction is non-blocking. Crossing 50 percent health changes
phase once and provides a 1.15-second transition, with no healing or damage immunity.
The Huntsmaster has a bounded 0.65-second reposition between attacks. Navigation and
collision validate actual movement; a charge does not steer or slide around a prop.
Poise breaks, the explicit perfect-guard hook, and charge displacement settle the
action into recovery. Hits remain governed by the existing damage, armor, injury,
feedback and death paths.

The final press tell was increased from the development prototype's 0.65 seconds
to 0.75 seconds. Its 4.8-unit footprint plus a 0.64-unit player body can then be
cleared by ordinary 8.2-unit walking even from the front of an overlapping body.
The focused footprint test pins this bound for every broad signature swing; this is
not a claim that every injured stance or a retreat into a wall is safe.

Browser inspection found that the generator's roads are raised 0.14 above terrain.
The first warning mesh was below the road, hiding the middle fan lane. Final warning
vertices are raised 0.24, and their bounds include only populated vertices. This
changes presentation, not attack timing or collision.

The final correctness pass also fixed two geometric edge cases. Huntsmaster tells
now lock both horizontal aim and vertical pitch to the target's current body height;
the bow pose and launched arrows share that pitch. On the generated downhill
regression, the stationary grounded player now takes the intended 9 damage, while
the former horizontal-only negative control misses.

Charges now lock a collision-planned travel limit at the start of the tell, using
the same movement resolver, actual actor radius, terrain and active bounds as their
movement. The bounded 0.1-unit planning probes may conservatively shorten a path;
the live charge cannot later exceed that advertised reach. Warning width remains
the attack/body allowance, not a larger radius used to probe movement. Start/end
caps also advertise nearby contact when the path is zero or very short. The exact
generated gate regression has a nonzero warning area (about 7 square units for its
zero-path cap), rather than an invisible degenerate strip, and admits the same
nearby contact at 30/60/144 Hz. Solid scenery can still occlude the camera's view;
the cap was also observed from the open courtyard side, without disabling depth
or collision.

The encounter envelope is 32 units from both the arena anchor and the boss. Profile
destinations are bounded to 22 units around the anchor. Leaving suspends damage
intents and returns the boss by navigation, not teleportation. There are only the
two original escort IDs; a dead escort is not replaced. Boss-first materialization
uses the existing campaign budget, can wait for a slot, and cannot spend squad slots
or satisfy the objective merely because materialization is deferred.

### Persistence and integration contract

`directorState.finale` has internal version 2. It contains the exact campaign,
encounter, region, site and spawn identity, the mirrored boss health/maximum/position,
the phase, bounded remaining timers, locked action origin/direction, absolute
projectile origin height, pitch, charge travel limit, consumed hit IDs, and at most
two escort health/position/cooldown/death records. It stores no scene
objects and consumes none of the combat, loot, event or chronicle random streams.

An absent legacy block is valid. Version-one development records migrate without
healing or changing phase; their unmodelled tells/contacts settle into recovery,
while an existing recovery keeps its remainder. A malformed present block is
rejected with a Russian warning and a separate clean state, never the partially
parsed candidate. This prevents a rejected forged `defeated` flag from suppressing
the boss while leaving the objective incomplete. Existing defeated actor IDs,
cleared encounters, and completed objectives
remain authoritative over stale data. Restored health and phase are applied before
the actor enters its first update.

Leaving or unloading forfeits unfinished contact into its normal recovery rather
than replaying it. Suspension applies to both sides: an inactive owned boss or escort
is removed from combat target pools, queued actor attacks against it are cancelled
without refunding their cooldown, and damage admission rejects already-fired or
direct contacts. A squad left on Hold cannot defeat an unresponsive boss while the
player is outside the engagement envelope. Ordinary NPC combat remains available,
and returning neither heals the boss nor resets the encounter.

Saving a tell retains its locked aim and remaining time; consumed
contact is settled to recovery on continue, and in-flight arrows are not recreated.
Return/continue has a separate 0.65-second readmission cue. Saving partway through
that cue preserves its remainder instead of refreshing it on every continue.
Health stays damageable during active cues and phase transitions.

Both melee and ranged finale damage pass `DamagePlayerOptions.sourceActorId`.
NG-11 now calls `GameEngine.interruptFinaleAttack(sourceActorId: string)` when an
admitted perfect melee guard interrupts a real attacker. The remaining contacts in
that signature sweep are cancelled immediately. The hook is a no-op for other
actors or an action already recovering; a blocked projectile does not remotely stun
its shooter. The combined damage path retains lazy base-damage admission before RNG
and injury resolution.

Only the owned boss's actual lethal hit, after prerequisites, completes the final
objective. Actor death writes authoritative deltas, then calls the existing objective
and terminal paths. Surviving escorts and owned effects leave without extra kill
rewards. A player arrow killing the boss defers owned projectile removal until the
current projectile iteration is safe. Repeated lethal callbacks and finalization
cannot duplicate the outcome or profile currency.

### Acceptance evidence and limits

The final regression selection passed 235 tests across 17 relevant files, including
33 focused director/engine finale cases. `npm run build` and the existing
`npm run lint` also passed. No new packages, test runners, or build tools were added.

`tests\finaleDirector.test.ts` exercises the production director, including
campaign/allegiance aliasing and early-contact negative controls, both phase traces,
30/60/144 Hz schedules, locked aim, real footprints, collision primitives, ordinary
walking and shield arithmetic, slot exhaustion, bounded normalization, and reentry.

`tests\finaleRuntime.test.ts` runs actual `GameEngine` prototype methods under the
existing Node runner, using Node's built-in import-resolution hook. Only scene/audio
and environment fixture boundaries are replaced; loot-mesh creation is recorded
rather than materialized in those headless cases. Tests exercise actual damage,
injury admission, projectile cover, source attribution, boss/escort death, region
streaming, boss-first spawning, save construction, objective completion, and
`finalizeRunSnapshot` idempotency. They include player and ally last hits, terminal
defeat, a player-arrow last hit amid enemy projectiles, charge interruption, and
unchanged ordinary projectile behavior.

The native-browser observations used seed `20260905`, generator version 1 and world
fingerprint `wg1-4b29a52d3ecf4c26`. These were explicitly staged encounters:
prerequisites and non-finale encounters were marked complete in a normal engine save,
and the existing starting companions were placed near the finale. Player health,
stamina and damage were normal starting values, not an invulnerability or a custom
fight/win implementation. Keyboard and existing action handlers then drove combat.
Animation was briefly stopped only for still screenshots. These are not natural
full-campaign completions or controlled difficulty measurements.

| Profile | Observed live behavior | Terminal result |
| --- | --- | --- |
| Huntsmaster | Three fan lanes and single lanes; phase transition; save/menu/continue; ordinary sprint disengagement and return without healing; bow and melee with the starting squad | Victory at about 15.91 gameplay seconds, player health 100 |
| Warlord | Cleave, straight charge, heavy cleave and separate slam; a real 22-damage frontal hit became 2.376 through the existing guard shield; a lateral move avoided the locked charge; phase-two save and return | Victory at about 20.76 seconds, player health about 91.31; player finisher last hit |
| Marshal | Two flanking escort posts; aimed attacks removed both escorts permanently; advance/press phase; clear street disengagement and return; phase-two save retained health and both dead escorts | Victory at about 39.97 seconds, player health 70; `villain-archer-2`, a non-event squad companion, delivered the last arrow |

Those detailed field-check runs included explicit pauses, departures, returns and
controlled observation of complete attack sequences. After the version-two fixes,
all three fights were repeated from fresh, full-health fixtures through real phase
transitions and victories: Huntsmaster at about 5.24 seconds with player health 89,
Warlord at about 8.72 seconds with health 97.624, and Marshal at about 6.52 seconds
with health 100 and an allied arrow last hit. These short combat-only repeats used
the three starting companions and no excursion; they are not campaign completion
times or a difficulty benchmark.

There were also genuine failed attempts: an unmoving elf died, and an injured villain
died after an automated westward retreat became stuck against castle scenery. The
successful Marshal retry used a clear street approach and ordinary backsteps for
broad sweeps. No colliders were disabled or movement teleported to conceal the
failed route. General navigation is not claimed to be perfect.

The HUD was observed at desktop 1366x768 and narrow 390x844. The narrow case had no
horizontal overflow and retained the existing 44x44 touch controls. Bloom-off
observation retained the ground warnings; actual reduced-motion Warlord and Marshal
instances retained their tells and phase cues. Native Chrome required disabling OS
occlusion throttling to keep the observation window rendering; a pointer-lock retry
was needed after switching mobile emulation back to desktop. The shipping input
fallback remains NG-11's responsibility.

All three terminal observations had zero owned warning meshes visible and zero
owned projectiles. The isolated profile contained one terminal record per run and
no active slot after the final victory. Representative evidence is retained as
session artifacts, not imported game assets: `elf-road-safe-tell.png`,
`elf-midfight-continue.json`, `elf-narrow-bloom-off.png`,
`guard-real-shield-trace.json`, `guard-two-part-heavy-trace.json`,
`villain-street-disengage.json`, `villain-midfight-continue.json`,
`villain-companion-last-hit.json`, and `finales-terminal-manifest.json`.
Final-version evidence includes `final-v2-elf-victory.json`,
`final-v2-guard-victory.json`, `final-v2-villain-victory.json`,
`huntsmaster-slope-contact.json`, `finale-v1-migration-result.json`,
`marshal-zero-path-warning.json`, `marshal-cap-courtyard-view.png`, and
`marshal-advertised-near-contact.json`.

A live pause check released held movement and kept health, action remainder and
gameplay time unchanged while rendering continued. Menu teardown emitted exactly
one disposal per owned warning geometry/material, including all three fan meshes,
and removed the world canvas. See `finale-live-pause-and-triple-disposal.json` and
`finale-teardown.json`.

The feature-local observations above came from the isolated finale implementation.
Combined bridge/order/defense/finale observations are recorded separately in the
parent milestone. Neither set of staged finale evidence is a natural full-campaign
completion or the earlier opening reconnaissance reaching a finale.
