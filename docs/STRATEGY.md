# КОРОВАНЫ — Strategy

> Owned and written by **Agent OPUS** (Claude Opus 5), adversarially reviewed across three
> full rounds by **Agent SOL** (GPT-5.6 Sol). Both sign-offs are at the bottom; SOL's is
> pasted verbatim from SOL's own message and was not written by OPUS. Nothing in this work
> changed gameplay code — the document is the deliverable.
>
> Every claim below is cited to a file and line, or to a benchmark that was run. Where a
> claim was made and then found wrong, it was withdrawn rather than quietly dropped; those
> retractions are in the sign-off and in the rejected-ideas list.

## Executive summary

КОРОВАНЫ has built a world more interesting than the game you play inside it.

Thirteen days and 56 commits produced a deterministic 25-region campaign generator, a
chronicle that simulates all of it whether or not the player is watching, NPCs with
telegraphs, poise, stagger, morale and flanking, a fully synthesized per-seed soundtrack, and
208 tests with negative controls that are better than most commercial projects manage. What it
did not produce is a player who gets to *decide* much about any of it. Inside 3.6 m the swing
cannot be aimed and cannot miss, and there is no timing conversation in it at all. The
chronicle *is* influenced by the player — through presence, campaign progress and won
fights — but every channel is reactive, opaque and never chosen. And for all 2³² seeds there
are exactly **six** campaign graphs.

So the strategy is not "add more". Every remaining surface — weather, foliage, FX, event
kinds, achievements — is already richer than the decisions it supports. The strategy is to
**turn systems into decisions**, in a fixed order, and to build the instrument that tells us
whether each one worked before building the next.

The order below is the outcome of three rounds of adversarial debate between Agent OPUS
(Claude Opus 5) and Agent SOL (GPT-5.6 Sol). Both of us changed positions in it; the places
we did not are recorded at the bottom rather than smoothed over.

1. **Phase 0 — make change safe and traversal smooth.** CI runs the tests; it currently does
   not. Build the full-run harness and only the three engine seams it needs. Fix the one
   measured, player-facing latency bug: a region's navigation grid blocks the main thread for
   up to 77 ms. Put the `seenHints` plumbing in so every later system teaches itself.
2. **Phase 1 — player-facing payoff**, in order: honest melee with a defensive cancel → a run
   epilogue worth sharing → embodied chronicle commitments → the first slice of branching
   faction contracts → generator diversity with a variety test that makes it provable → an
   in-run doctrine draft.
3. **Phase 2 — measured expansion.** Broad subset completion and the remaining contract verbs,
   built from the ten event builders that already ship rather than from nine new systems.
   Macro-archetypes only if the epilogues show seeds still feel interchangeable.

This project has already shipped a headline feature that did nothing and only found out by
measuring it (`living-world-spec.md:1343-1349`). That is why the harness comes first and why
almost every initiative below names the number that would prove it worked.

## Current-state assessment

Measured on `main` at `b6f94ad` (2026-07-26), Node 24, Windows.

| Signal | Value |
| --- | --- |
| Source (`src/**` `.ts`/`.tsx`) | **37,173 lines** across **38 tracked files** |
| `src/game/GameEngine.ts` | **13,838 lines**, 384 methods, 271 instance fields, ~40 private interfaces |
| `src/App.tsx` | **3,100 lines**, 30 `useState` + 8 mirror refs in one component |
| Share of source in those two files | **45.6 %**, reached by **zero** tests |
| Tests | 208 pass, 8,886 lines, 14.5 s wall clock |
| Build | 7.2 s → one 1,378 kB HTML (374 kB gzip) |
| Lint / types | `oxlint` clean; **zero** `any`, `@ts-ignore`, `eslint-disable`, `TODO`, `FIXME`, `HACK` in `src/` |
| History | 56 commits, 2026-07-14 → 2026-07-26; `GameEngine.ts` touched in **37 of 56** (66 %) |
| Specs | 17 documents in `docs/` |

All line counts are `git grep -c ""`, not editor estimates.

### What is genuinely good, and should not be disturbed

This is not a sloppy codebase. Three things are better than the norm for a project of this
age and should be protected as assets rather than treated as neutral ground.

**The measurement culture.** `docs/living-world-spec.md` §9 does not assert its results, it
*measures* them, with negative controls, and then corrects itself in public: "Two of these
numbers contradict what this section claimed before it was measured"
(`living-world-spec.md:1302`). `tests/actorAi.test.ts` re-implements the pre-extraction
engine code and asserts agreement over ~14,000 comparisons, *plus* a negative control proving
the comparison can detect a changed implementation. `tests/worldEnvironment.test.ts:153`
asserts chronicle output is byte-identical across all four day/night × weather toggle
combinations. `tests/ambientLife.test.ts:555` asserts a panic multiplier in *both*
directions so that "tidying" 1.55 → 1.15 fails. This is the project's single strongest
engineering asset.

**The determinism core.** `random/`, `world/` and `systems/` contain zero `Math.random`,
`Date.now` or `performance.now`. Every generator step gets its own derived stream
(`WorldGenerator.ts:895`), so adding a step cannot shift another step's numbers.
`canonicalSerialize` sorts keys and rejects non-finite numbers and cycles
(`WorldValidator.ts:1872-1898`); the validator runs *inside* the generator, so an invalid
world throws at generation rather than shipping (`WorldGenerator.ts:207-211`). 500
sequential seeds are asserted to produce valid, finite, completable campaigns
(`tests/worldGenerator.test.ts:113`).

**The audio system.** 27 synthesized SFX cues built from exactly two primitives
(`ToneLayer`, `NoiseLayer`, `AudioDirector.ts:63-89`), priority-based voice admission
(`MAX_ACTIVE_VOICES = 24`), spatial mix, 10 synthesized music instruments realised as
`PeriodicWave`s, a per-seed score (`musicSeed: deriveSeed(seed, 'music:' + faction)`,
`GameEngine.ts:1754`), intensity hysteresis with per-level hold, and switches deferred to a
bar boundary (`MusicScore.ts:185`). It exceeds its own spec. Leave it alone.

### The three asymmetries

Everything worth doing next follows from three gaps between what the project has built and
what a player can do with it.

#### 1. The world's simulation is influenced reactively and opaquely, never chosen

`RegionChronicleState` (`world/Chronicle.ts:89-101`) is mutable, persisted, versioned state:
`control`, `pressure` per faction, `beastPressure`, `settlementIntegrity`, `supply`,
`lastEventTick`. A tick (`tickChronicle:252-287`, fixed 8 s) runs faction strength →
pressure → fronts → settlement damage → beasts → supply drift → caravans over all 25
regions, whether or not the player is present. Prices move. Settlements burn. Squares
change hands. The minimap recolours.

The player *does* influence it, through three channels that all already ship:

- **Presence.** Standing in a region adds it to `frozenRegionIds` and the chronicle declines
  to act there (`Chronicle.ts:639, :697`).
- **Campaign progress.** `playerObjectiveRatio` is computed from completed objectives
  (`GameEngine.ts:7006-7010`) and passed into every tick (`:7031`), where it raises the player
  faction's strength: `objectiveBonus = clamp01(playerObjectiveRatio) * STRENGTH_OBJECTIVE_SHARE`
  (`Chronicle.ts:589-594`).
- **Fighting a materialized event.** Raid, caravan, warband and beast outcomes are folded back
  into control, pressure, supply and settlement integrity through the hand-back path
  (`Chronicle.ts:353, 447, 485, 523`).

So the asymmetry is not that influence is missing. It is that **every channel is reactive,
opaque and never deliberately chosen.** The player cannot decide to hold a square, protect a
settlement, or trade a front for a supply line; those things happen *to* them as side effects
of walking, finishing objectives and winning fights they happened to stand near. Nothing in
the HUD attributes an outcome to a choice, and `RunPlayerState` (`run/runTypes.ts:51-62`) —
`health, stamina, gold, kills, damage, body, objectives, upgrades` — carries no strategic
state at all. Design rule 4 of the living-world spec is "Consequences must be legible"
(`living-world-spec.md:59`); legibility was delivered, and *agency over* those consequences
was never in scope.

That is a better problem than the one this document originally described, because the plumbing
already exists. Embodied commitments (1.3) extend a channel rather than inventing one.

#### 2. The enemy half of the combat conversation is built; the player half is not

NPCs got a full reaction model. `actorWindup` (`GameEngine.ts:4797`) gives five per-role
timings (scout 0.18 s → brute 0.56 s); `startActorAction:4832` paints a telegraph decal and
fires an `attackTell` cue; `updateActorAction:4867` resolves contact at the end of windup and
then enters recovery; `applyActorDamageReaction:4994` applies a 0.12 s flinch, poise damage
`dealt × (cleave ? 1.45 : 0.75)`, stagger at zero poise with `STAGGER_IMMUNITY = 0.45`, and
cancels the in-flight action. Max poise runs 18/28/46/58/72 by role (`:4815`). On top of
that sit five hit-stop tiers (`:1035-1039`), screen shake, damage numbers, comic callouts
and impact rays (`:12359-13354`). `docs/04-enemy-reactions-spec.md` delivered all of it.

The player's answer to all of that is `attack()` (`GameEngine.ts:2446-2494`):

```ts
2449:    this.attackCooldown = 0.52
2459:    let bestDistance = 3.6                       // nearest hostile within 3.6 m
2483:    this.player.rotation.y = Math.atan2(targetDirection.x, targetDirection.z)
2486:    const dealt = Math.max(8, this.damage - armPenalty + Math.floor(this.combatRng() * 7))
```

No wind-up. No stamina cost. No hitbox, cone or raycast. A swing with nothing inside 3.6 m
whiffs harmlessly (`:2477-2480`), but **once any hostile is in that radius the swing cannot
miss and cannot be aimed** — the nearest one is selected and the player's facing is snapped to
it. There is no combo, no charged attack, no cancel, and no player poise or flinch. The only
dedicated defensive verb in the game is the guard's shield (`setShield:2422`), and only one of
three factions has it.

To be precise about what the player *can* already do, because it is the reason this document
does not propose a dodge button: contact is revalidated at resolution time, not at commit time
(`updateActorAction:4920-4927`), so walking, sprinting or jumping out of a windup already
defeats it. Movement is a real answer to a telegraph today.

The gap is therefore narrower than "helplessness" and sharper than it looks: **there is no
timing conversation inside the player's attack, and no dedicated defensive or cancel verb for
two of the three factions.** The enemy side has wind-up, contact, recovery, poise and stagger;
the player side has a cooldown. Everything the game spent on making enemies readable is
readable *at* the player rather than *by* them.

#### 3. The seed promise is larger than the seed reality

The closing line of `docs/from-four-zones-to-a-seeded-campaign.md` is: "the next interesting
question is … how many memorable worlds can be hidden inside a seed." The generator's
skeleton says: fewer than the pitch implies.

- `ENDPOINTS` is a literal table (`world/WorldGenerator.ts:49-62`) — **every seed** puts the
  elf start at (0,0), the guard at (4,0), the villain at (0,4).
- There is exactly one river, always north→south, always a straight column; the seed picks
  only *which* column (`:393`).
- Six optional sites sit at literal region ids — `regionId(2,2)`, `regionId(4,4)`,
  `regionId(2,3)` (`:453-460`); only `site-treasure-hidden` varies, over 4 fixed candidates.
- Branch-road topology is a hand-written chain of 8 `addBranchRoad` calls (`:581-594`).
- Biome is 1:1 with territory (`biomeForTerritory:888-893`), so there are 4 possible looks
  and one of them is "no owner".
- One regular encounter slot per region **plus three finale boss slots**, so a finale region
  has two and every other region has one (`createEncounters:648-690`); 4 encounter kinds of
  which the regular pool uses only 3 (`:655`); 4 objective kinds.
- The faction objective "graph" is three nodes on a linear chain, and the *only* seeded
  call in the whole of `createObjectives` (`:692-749`) is one `.pick()` over a two-element
  array:

```ts
698:  const choices: FactionRecord<readonly SiteId[]> = {
699:    elf: ['site-shop-riverside', 'site-event-frontier'],
700:    guard: ['site-recovery-riverside', 'site-settlement-crossroads'],
701:    villain: ['site-treasure-hidden', 'site-landmark-old-road'],
702:  }
```

  **There are exactly 3 factions × 2 middle sites = 6 distinct campaign graphs in
  КОРОВАНЫ, across all 2³² seeds.** `validateObjectiveDag` (`WorldValidator.ts:1679`) is
  validating a chain. And the complete verb set a campaign can ask for is
  `ObjectiveKind = 'arrive' | 'interact' | 'defeat' | 'claim'` (`worldTypes.ts:169`) — go
  there, touch it, kill it, take it.

And the guardrail is missing: `tests/worldGenerator.test.ts:71` asserts the layout is
*complete*. **Nothing asserts it is varied.** A generator that quietly became less diverse
would pass the entire suite, including the 500-seed run.

### The enabling constraint: one file

`GameEngine.ts` owns rendering, input, physics, AI, morale, weather, day/night, the chronicle
glue, the loot economy, the world-event director, procedural texture painting, mesh authoring
and comic-book VFX. `updateActors` alone is 567 lines (`:3785-4351`); the constructor is 468
(`:1686-2153`); the event director is ~1,570 (`:7419-8988`); `spawnActor` is 233 (`:12090`).

The costs are already visible in the repository, not hypothetical:

- **Two role-damage tables that must stay in sync by hand** — `actorAttackPlayer:8991-8999`
  and `actorAttackActor:9011-9019`, same roles, different numbers, no shared source.
- **Three implementations of the same mappings.** `createGeneratedObjectives` exists in both
  `App.tsx:421` and `GameEngine.ts:2832`. `createGeneratedInitialView` (`App.tsx:436-555`)
  is a second, hand-rolled `emitView` — every field added to `GameView` must be written
  twice. `generateWorld` is executed three times per launch (`App.tsx:437`, `App.tsx:1150`,
  engine constructor).
- **Formatting damage in the highest-churn file in the repository**: statements welded onto
  declaration lines at `:3786`, `:4460`, `:4669`, `:6999`, `:7192`, `:8821`. The lines are
  observable; what produced them is not, and this document does not guess.
- **The project says so itself.** "Layer 3 shipped with three claims about behaviour
  deliberately left unmeasured, because they live in `GameEngine`'s per-frame AI and neither
  the chronicle harness nor browser observation can reach them"
  (`living-world-spec.md:1328-1330`). And: "the tedious part was that both live in
  `updateActors`, where the ordering of five branches *was* the behaviour" (`:1397`).

The cure is already invented here: extract the decision half as pure functions and pin it
with an equivalence control (`world/ActorAi.ts` + `tests/actorAi.test.ts`). What is missing
is doing it again, deliberately, where the next features need it.

### Secondary findings

**The run is not deterministic in the way the world is, and one divergence channel is
unguarded.** `loop` (`:2733-2750`) uses `clock.getDelta()` clamped to 50 ms — a variable
timestep — so gameplay integration and RNG consumption order depend on frame rate. The
frequently-assumed culprit is not one: `advanceWeatherMix` (`world/WorldEnvironment.ts:83-97`)
uses an exponential response, `mix += (target − mix)(1 − e^{−k·Δt})`, which for a *fixed*
target composes exactly across sub-steps — two half-steps equal one whole step — and its
normalisation is a no-op on an already-normalised mix. So it is **not** true that a per-frame
lerp mechanically implies different beast pressure at 30 fps and 144 fps.

What can diverge, for the same scripted input and route, is *when the weather target changes*
and where the player is standing when it does, which then reaches `advanceBeasts`
(`Chronicle.ts:683`) at the next chronicle tick — plus ordinary floating-point accumulation
across hundreds of ticks. The spec flags the general risk at `living-world-spec.md:168-172`;
**no test guards it**, and the honest statement is "same-seed runs can diverge at different
frame schedules and nothing currently proves whether they do". The 30/60/144 Hz test in 0.2
exists to settle it. Relatedly, the article's claim that "the seed is a compact reproduction
case" holds for generation bugs and not for gameplay bugs.

**The meta-loop is inert after roughly five runs.** `BOON_CATALOGUE` has 6 entries costing
210 profile currency in total (`run/profile.ts:21-70`); a run yields at most 90 and at least
12 (`:209-221`). Every effect is a flat scalar merged by spread (`:119-122`) and no effect
reads another. In-run, gold is finite and shop prices escalate, so there *is* a local
opportunity cost — what is missing is **exclusivity**: the three upgrade tracks are monotonic
and non-competing, so a long enough run buys all of them and no run ever commits to a build.
`unlockedContentIds` and `unlockedCosmeticIds` exist on the profile and are **never written**
(only `[]` initializers at `App.tsx:215-216`, `storage.ts:679-680`). `RunConfig.modifiers?:
string[]` is declared with **no producer**. 47 of the 58 achievements are cumulative counters.

**There is no onboarding.** `content/gameCopy.ts` contains zero instructional strings. The
only teaching in the game is two static keybind strips in `App.tsx` (`:1608-1612` menu,
`:2256-2286` in-game, dismissible). Stamina, abilities, bleeding, limb loss, prosthetics,
threat tiers, the chronicle feed and the boon economy are all discovered by dying.
Meanwhile 34 `callbacks.onNotice` sites embed Russian UI copy directly in the engine while
`content/gameCopy` is imported at `:78-97` — the copy extraction is half-done.

**The pipeline does not protect the player.** `.github/workflows/deploy-pages.yml` runs
`npm ci` and `npm run build`, then deploys. **`npm test` and `npm run lint` never run on
push.** The suite takes 14.5 seconds and includes the 500-seed completability gate.
Separately, `viteSingleFile()` is applied to *every* build (`vite.config.ts:7`), so GitHub
Pages serves a single 1,378 kB HTML with no cacheability across deploys; `scripts/bundle.mjs`
is a 9-line `copyFile`, so `npm run bundle` and `npm run build` produce the same artifact.

### Two things nobody had a number for, now measured

Benchmarks were run against the real modules; scripts are session artifacts and are not part
of the repository.

**The AI quadratics are free at the current cap — and are exactly what caps it.** Real
`selectThreat` from `world/ActorAi.ts`, JIT warmed:

| actors | `selectThreat` for all actors | share of a 60 fps frame |
| ---: | ---: | ---: |
| **25** (`MAX_ACTORS`) | 0.247 ms | **1.48 %** |
| 50 | 1.078 ms | 6.47 % |
| 100 | 4.456 ms | 26.73 % |

Clean quadratic — 4× the actors for 18× the cost, because `alliesEngagedOn` (O(n)) is called
inside the `selectThreat` loop (`ActorAi.ts:399-428`). No work is warranted here today. It
becomes the first blocker the moment any design decision asks for more than 25 actors.

**Region streaming stalls the main thread for multiple frames.** Real `generateWorld` +
`TerrainSystem` + `CollisionWorld` + `NavigationSystem` at production defaults (80 m regions,
2 m cells = 1,600 cells):

| seed | `generateWorld` | navGrid build/region (median / max) | all 25 |
| --- | ---: | ---: | ---: |
| `korovany-blog` | 58.8 ms | 29.0 / **76.9 ms** | 884 ms |
| `fauna-1` | 11.3 ms | 25.8 / 53.7 ms | 759 ms |
| `strategy-bench` | 35.3 ms | 19.9 / 72.2 ms | 599 ms |

The mechanism is confirmed rather than guessed. `sampleHeight` costs ~2.8 µs;
`buildGrid` (`NavigationSystem.ts:471-486`) calls it once per cell *and* calls
`isWalkablePosition`, which calls `estimateSlope` → four more samples via `sampleNormal` —
so ~8,000 fBm evaluations ≈ 22 ms predicted against 20–29 ms measured. **A median region
grid build blocks the main thread for 1.2–1.7 frames, worst case 4.6.** Colliders are
registered during region activation (`GeneratedWorldRuntime.ts:929, 1235, 1412`) which bumps
`colliderRevision` (`CollisionWorld.ts:233, 660`) and misses the cache in `getGrid`
(`NavigationSystem.ts:196-205`), so the cost is paid on the first pathfind after each
activation — up to three times per 3×3 streaming step.

One tempting claim was checked and does **not** hold: materialized chronicle events do not
invalidate a live region's grid. The only `registerBox`/`registerCircle` calls sit inside
region activation.

Two questions this document cannot answer and does not pretend to: **actual frame rate on
real hardware**, and **where GPU time goes**. No browser was available in the analysis
environment, and headless WebGL is software-rendered, so any number would have been a
fiction. It is worth recording that the project cannot answer them either — its only
performance acceptance criterion, "60 fps with events active"
(`dynamic-world-events-spec.md:247`), is an unchecked box.

**The spec archive understates the project.** Twelve of the seventeen documents in `docs/`
carry 113 acceptance-criteria boxes that are **all unchecked** — bloom, ink outlines,
weather, ground foliage, camera accents, loot spectacle, layered audio, comic hits, enemy
reactions, zone art — for features that demonstrably shipped and are listed in the README.
None has been touched since 2026-07-17. `dynamic-world-events-spec.md` still documents
`MAX_ACTIVE = 1` and `eventRng = seededRandom((Date.now() % 2147483646) + 1)`, both
superseded by the living-world spec. For a product whose second design principle
is «Показывать сделанное кодом», the public evidence of the engineering currently
under-reports it.

One apparent contradiction in that archive is **not** one, and is recorded here so nobody
"fixes" it: `weather-system-spec.md` names four profiles and `content/registry.ts:16-22` lists
six affinities, but these are different types with different jobs.
`WeatherKind = 'clear' | 'overcast' | 'rain' | 'snow'` (`world/WorldEnvironment.ts:14`) is the
runtime simulation and render profile; `WeatherAffinity` (`clear/breeze/rain/mist/storm/ash`)
is per-biome content metadata that biases which profile a region tends toward. The gap worth
closing is documentary — how the six affinities map onto the four profiles is written down
nowhere — not a mismatch in the code.

## Prioritised roadmap

This ordering is the converged output of the debate. Effort figures are engineering days at
this project's demonstrated pace (56 commits in 13 days). Every initiative names the files it
lands in, the risk that could sink it, and the signal that says it worked.

### Phase 0 — make change safe and traversal smooth

Roughly one week with work in parallel; **8–10 days if run serially**, which is the one
pacing point the two agents did not fully settle. Nothing in Phase 1 should start before
0.2 exists.

**0.1 — Make CI run the tests.**
`.github/workflows/deploy-pages.yml` runs `npm ci` and `npm run build`, then deploys to
players. `npm test` and `npm run lint` appear nowhere in it. The suite is 208 tests, 8,886
lines, **14.5 seconds**, and includes the 500-seed campaign-completability gate and the
`tests/actorAi.test.ts` equivalence control. The project's single strongest engineering asset
currently protects nothing that reaches a player.
*Files:* `.github/workflows/deploy-pages.yml`. *Effort:* under an hour. *Risk:* none.
*Signal:* a deliberately broken test blocks a deploy.

**0.2 — The full-run harness, plus only the seams it needs.**

*Problem.* `tests/aiHarness.ts` exists but, in its own words, "models movement and contact. No
navmesh, collision, steering, separation, terrain, wind-up, poise or stagger"
(`living-world-spec.md:1338`). There is no run-level balance harness at all, and
`GameEngine.ts` + `App.tsx` are 45.6 % of source with zero direct tests. The consequence is
already in the record: Layer 3's headline beast behaviour shipped as **dead content** — "zero
routs across 60 fights" (`living-world-spec.md:1343-1349`) — because three individually
correct rules were collectively inert, and nothing but a harness could have found it. Layer 4's
flanking is in the same position today: shipped, and explicitly unmeasurable in the current
harness (`:1406`).

*Proposal.* A headless run driver with scripted input policies and 500-seed reports: time and
distance to each objective, damage taken and dealt by source, death causes, event exposure
(how many materialized chronicle events a player actually witnesses versus how many resolve
off-screen), region dwell time, completion rate. Extract exactly three seams to make it
possible, each with an equivalence control in the style of `tests/actorAi.test.ts` (~14,000
comparisons plus a negative control proving the comparison can detect a changed
implementation):

- **`CombatResolver`** — the action contract plus `damageActor`/`damagePlayer`/`killActor`
  (`GameEngine.ts:8990-9264`), collapsing the two role-damage tables at `:8991-8999` and
  `:9011-9019` that are kept in sync by hand today.
- **`CampaignDirector`** — objectives *and* the ~1,570-line world-event director
  (`:7419-8988`) *and* chronicle commitments. Deliberately broader than "event director":
  extracting events alone leaves the main-loop problem welded into the engine, and Phase 2
  depends on objectives and events sharing one owner.
- **One authoritative view builder** — `emitView` (`:9789-9959`), which deletes `App.tsx`'s
  parallel hand-rolled `createGeneratedInitialView` (`:436-555`), the duplicate
  `createGeneratedObjectives` (`App.tsx:421` vs `GameEngine.ts:2832`), and two of the three
  `generateWorld` calls per launch.

Run the harness on scripted **30 / 60 / 144 Hz** schedules. **Do not convert the browser
runtime wholesale to a fixed timestep** unless measured outcome divergence justifies it — see
the resolved-tensions note below. Name one check explicitly rather than leaving it to the
general test: the **weather-target transition**. `advanceWeatherMix`
(`world/WorldEnvironment.ts:83-97`) composes exactly across sub-steps for a fixed target, so
the mix itself is not the hazard; *when* the target changes and where the player is standing
when it does is, and it reaches `advanceBeasts` (`Chronicle.ts:683`) at the next chronicle
tick. The spec flags the general risk at `living-world-spec.md:168-174` and nothing guards it.
This test is what decides whether a fixed-step conversion is needed at all — it is not
assumed either way.

*Effort:* 4–6 d. *Risk:* over-refactoring, or false confidence from a harness that models less
than it appears to — mitigated by stating its limits in the file, as `living-world-spec.md` §9
already does for its own. *Signal:* a stable run report for a seed; the 144 Hz and 30 Hz arms
agree on chronicle history.

**0.3 — Kill the region-streaming stall.**

*Problem.* Measured, not assumed: `NavigationSystem.buildGrid` (`:471-486`) evaluates ~8,000
fBm height samples per region at ~2.8 µs each — **median 20–29 ms, worst case 77 ms**, or
1.2–1.7 dropped frames median and up to 4.6, paid on the first pathfind after each region
activation and up to three times per 3×3 streaming step. There is already a path cache
(`generatedNavigationCache`, keyed on quantised start/destination/radius with a TTL and
eviction, `GameEngine.ts:3556-3580`), so repeated pathing is amortised — but the grid build
sits inside `findPath` and is not amortised on a cache miss.

*Proposal.* **Cache or prewarm the region height field** once as a `Float32Array` shared by
`TerrainSystem`, `CollisionWorld` and `NavigationSystem`, instead of re-evaluating the noise
per consumer. Do **not** start by making `requestPath` asynchronous, even though it is
currently a straight alias for `findPath` (`:428-434`) and therefore looks like a free seam.
A null path today drops the actor into straight-line movement:

```ts
4108:  if (navigationTarget) {            // follow the path
4118:  } else if (investigating) {
4120:    direction.copy(facingDirection)  // straight line at the target
```

so an async window would make every actor in a freshly streamed region walk into walls.
Asynchronous or time-sliced pathing is a separate, later change that first needs a safe
"path pending" behaviour — hold position, or continue the last path.

*Files:* `systems/NavigationSystem.ts`, `world/TerrainSystem.ts`, `systems/CollisionWorld.ts`.
*Effort:* ~2 d. *Risk:* low; height sampling is already pinned for continuity at region
borders (`tests/terrainSystem.test.ts`). *Signal:* max synchronous grid build under 8 ms, or
off the main thread entirely — then confirmed with a real region-boundary frame trace once
browser hardware is available, because **no frame-rate measurement exists anywhere in this
project**; its only performance acceptance criterion, "60 fps with events active"
(`dynamic-world-events-spec.md:247`), is an unchecked box.

**This is a release gate for 1.1, not merely a predecessor.** The melee rework may be
prototyped in parallel, but the committed combat model must not ship to players while a region
activation can block four frames. Under the 1.1 design only the finisher commits, so the
failure is narrow and specific: a stall landing inside the finisher's commitment window eats
the cancel input the player *did* have, and eats it precisely when they were reading a tell.

**0.4 — `seenHints` and diegetic copy infrastructure.**
`content/gameCopy.ts` contains zero instructional strings. The only teaching in the game is
two static keybind strips (`App.tsx:1608-1612` and `:2256-2286`, the second dismissible).
Stamina, bleeding, limb loss, prosthetics, threat tiers, the chronicle feed and the boon
economy are all learned by dying. Build the plumbing now — a `seenHints` set on the profile
and a first-time line per mechanic through the existing `onNotice` channel, copy in
`gameCopy.ts` where 34 engine-side `callbacks.onNotice` strings should also eventually
live — so that every system in Phase 1 teaches itself as it lands. Explicitly not a tutorial
mode; `PRODUCT.md`'s anti-references rule that out.
*Effort:* 1–2 d for the plumbing, then near-zero per feature. *Risk:* very low.
*Signal:* every mechanic with a HUD element has a first-time line.

Alongside Phase 0, treat the stale acceptance boxes and the Pages chunking question as
**maintenance notes, not game bets** — twelve of seventeen specs carry 113 unchecked boxes for
features that shipped, and `viteSingleFile()` is on every build; both are recorded in the
findings above, neither earns a slot here. Any change there must retain a standalone
single-file bundle target.

### Phase 1 — player-facing payoff

**1.1 — Honest melee: aimed, buffered, with a defensive cancel.**

*Problem.* The enemy half of the combat conversation is finished and the player half was never
started. `attack()` is a 0.52 s cooldown, a 3.6 m nearest-target scan and a facing snap
(`GameEngine.ts:2446-2494`), against NPCs with five per-role windups, telegraph decals, poise,
stagger and flinch.

*Proposal (the converged design; neither agent's original).* Keep the one-button promise the
README makes. Buffered three-beat sequence, camera-facing arcs using the aim vector and arc
test `cleave()` already uses (`getAimDirection:4793`, arc test `:5254-5257`), soft assist cone
**inside the arc only**, authoritative contact and whiff frames, and a finisher that costs
stamina and breaks *enemy* poise (`actorMaxPoise:4815`, 18/28/46/58/72 by role) so the third
beat has a reason to exist.

The defensive answer is **movement and existing inputs, not a new button**: movement stays live
through beats one and two; sprint, jump or the faction ability cancels the buffer and recovery
before the finisher; the guard can shield-cancel; **only the high-payoff third beat commits.**
That gives elf and villain — who have no defensive verb at all today, since `setShield:2422`
is one faction's privilege — a real answer to a telegraph without adding a sixth touch control.

**No player poise or flinch.** No dodge in v1. Both agents agreed the second only after the
first was measured: contact revalidates range at resolution time (`updateActorAction:4923`), so
walking out of a windup is already a real dodge. A true roll with i-frames remains contingent
on evidence — see the open disagreements.

*Files:* `GameEngine.ts` attack/ability/input paths, `types.ts` (`AbilityView`, feedback
types), `App.tsx` touch overlay and control ribbon. *Effort:* 4–5 d plus tuning.
*Risk:* feel, and the touch controls — prototype behind a flag and measure before committing.
*Signal:* whiff rate above zero and below ~35 %; **the avoidable-hit rate rises** — telegraphed
heavies that a correctly-timed movement or cancel would have avoided should increasingly be
avoided, while heavy attacks keep a visible tell; movement-cancel reliably clears the
0.18–0.56 s windup band (`actorWindup:4797-4801`); time-to-kill separates by role.

**1.2 — «Походная сводка»: a run epilogue worth sharing.**

*Problem.* `PRODUCT.md` design principle 4 is «Каждый забег должен оставлять историю».
`RunHistorySummary` (`run/runTypes.ts:97-111`) is thirteen fields — no route, no chronicle
beats, no body state, no companions, no build, no cause of death. `EndModal` shows time, kills
and gold.

*Why it is this early.* It is cheap, the product explicitly asked for it, and it is the
instrument that answers the question gating Phase 2: **do two runs actually feel different?**
Ship it before spending a fortnight making seeds more different.

*Proposal.* Persist a bounded terminal epilogue — discovered route and map state, three stable
chronicle beats, injuries and limbs, surviving companions, equipped doctrines, cause and
result — rendered as a Russian, self-ironic postcard with copyable seed-and-story text. Two
constraints: keep the rich сводка for the **last ~5 runs only** and let older entries decay to
today's thin summary, because `MAX_PROFILE_RUN_HISTORY = 50` (`run/storage.ts:41`) and the
profile is a single localStorage blob rewritten on every save; and state plainly that with no
backend, "share" means downloading a PNG or copying text, so nobody designs a share button
that cannot work.
*Effort:* 2–4 d. *Risk:* save growth — snapshot bounded ids and highlights only.
*Signal:* qualitative by design. It is the one initiative whose success depends on people
outside the game, and neither agent can measure it.

**1.3 — Embodied chronicle commitments.**

*Problem.* `RegionChronicleState` is mutable, persisted, versioned state. The player already
influences it — by presence (`Chronicle.ts:639, :697`), by campaign progress feeding
`playerObjectiveRatio` into faction strength (`GameEngine.ts:7006-7031`, `Chronicle.ts:589-594`),
and by winning materialized events that hand back through `Chronicle.ts:353, 447, 485, 523`.
What is missing is that **none of it is chosen**: the influence is reactive and opaque, and
`GameView.chronicle` is a read-only feed that never attributes an outcome to a decision.

*Proposal.* Surface one or two time-boxed rumours with explicit stakes; let the player pin and
commit to **one at a time** on the map; resolve ignored ones honestly through the existing
hand-back path (`Chronicle.ts:353, 447, 485, 523`). The interventions are **embodied actions,
not purchases**: escort a real `ChronicleCaravan` and change its interception roll in
`advanceCaravans`; defend a settlement; sabotage a rival supply site and drop `supply`, which
the chronicle already turns into prices. Chronicle **outcome** writes go through the existing
seam (`RegionManager.getRegionChronicle`/`setRegionChronicle:393-408`, which clones and bumps
the delta revision), so those cost nothing new to persist. The commitment itself does: the
pinned rumour id, its deadline, the selected intervention and any in-flight convoy or sabotage
state all need explicit save ownership — most naturally in `directorState`, which is already
persisted on `ActiveRunSaveV3`. Budget that, do not assume it.

These commitments are deliberately the **prototype for 1.4's contract templates** — the
pinning, staking and resolution flow is the same, so 1.3 de-risks 1.4 and reduces its cost.
*Effort:* 5–7 d. *Risk:* HUD overload, and campaign safety — anchors are chronicle-protected
(`WorldValidator.ts:626`) and must stay so. *Signal:* share of runs where region control at
victory differs from the no-input baseline.

**1.4 — Branching faction contracts: the first slice.**

*Problem.* `createObjectives` (`WorldGenerator.ts:692-749`) emits three nodes on a linear
chain, and its only seeded call is one `.pick()` over a two-element array per faction — six
campaign graphs for every seed that will ever exist. The complete verb set is
`arrive | interact | defeat | claim` (`worldTypes.ts:169`).

*Why it is a pilot and not a rewrite.* The honest pricing came out of the debate in two steps.
Writing nine new campaign verbs from scratch is 13–18 days at this project's own precedent —
`defendHome`, a single such behaviour with prop target, hp, attackers, timer, fail state and
cleanup, was scoped at 1.5–2 days alone (`dynamic-world-events-spec.md:251`). But the
behaviours already exist as **ten shipped event builders**:

```
7756 startRichCaravanEvent   7912 startDefendHomeEvent   8006 startChampionEvent
8055 startRescueEvent        8171 startBountyEvent       8345 startFactionRaidEvent
8460 startCaravanAmbushEvent 8570 startWarbandEvent      8646 startBeastRaidEvent
8821 startAftermathEvent
```

What is missing is not the behaviour but its **promotion into a campaign object with safety
guarantees** — an event may fail harmlessly; a campaign objective may never strand a run.

*Proposal — the first slice only.* After the `CampaignDirector` extraction: an **all-required
DAG shape** plus **one signature contract template per faction**, adapted from the existing
builders, with explicit fail-forward on every one. Broad subset completion and the remaining
verbs are Phase 2, gated on what this measures. Measure choice rate, completion, route
divergence, and whether the three factions actually select different contracts.

1.3 is a genuine cost reducer here, not merely a predecessor: the pin-stake-resolve flow that
chronicle commitments need is the same flow a contract needs, so by the time this starts, the
UI, the marker handling and the honest-resolution path already exist.

Note the shape of the persisted seam, because it is what splits this initiative across two
phases — and note carefully what it does *not* buy. Victory is
`this.objectives.every((o) => o.done)` (`GameEngine.ts:6098`) and the persisted `Objective` is
`{id, text, done, progress?, target?}` (`types.ts:277-283`) with no kind, prerequisites or
optional concept — the DAG lives only in the blueprint. So the **objective save schema can stay
unchanged** for an all-required graph.

That is not the same as "free", and it is emphatically not the same as "player choice".
`getActiveGeneratedObjective` (`GameEngine.ts:3297-3305`) is a `.find()` that returns the
**first** node whose prerequisites are met, and the marker, prompt and HUD all surface that one
node. A branched all-required graph would therefore present exactly one objective at a time and
the player would never see a fork. Making the branch visible is new work: `CampaignDirector`
must expose *all* ready nodes, the player must be able to select and pin one, and that
selection must persist — most naturally in director state. And while every branch remains
required, what the player is choosing is an **order**, not an exclusive route.

Exclusive routes are 2.1, and that is where the real cost sits: the win condition at `:6098`
replaced, a skipped/optional concept added to a persisted type, and `objectivesCompleted`
re-decided, since it feeds both `RunHistorySummary:107` and
`Math.min(20, objectivesCompleted * 4)` (`profile.ts:216-219`) and becomes gameable the moment
optional nodes exist.
*Effort:* 8–12 d after the seams. *Risk:* campaign safety — the 500-seed completability gate
and the anchor-protection assertion must both keep passing.
*Signal:* across 200 harness runs, **ordering divergence** between runs exceeds the noise floor
and the three factions demonstrably pick different signature contracts. Route divergence in the
exclusive sense is a 2.1 signal, not a 1.4 one; claiming it here would be measuring something
this slice does not ship.

**1.5 — Generator diversity v1, the variety test, and terrain-bound encounters.**

*Problem.* Six campaign graphs for all 2³² seeds; one always-vertical river in columns {1,2,3};
six optional sites at literal region ids; `createGeneratedEncounterPlan` drops generic 2–4
actor packs around a centre regardless of what is actually there. And the guardrail is
missing — `tests/worldGenerator.test.ts:71` asserts the layout is *complete*; **nothing asserts
it is varied**, so a generator that silently lost diversity would pass all 208 tests including
the 500-seed run.

*Proposal, in this order.* First the **distributional variety test** over ~200 seeds, so
everything after it is provable rather than asserted. Its thresholds must cover **only the axes
this milestone actually makes vary** — otherwise it fails on the day it lands:

- distinct river columns (today `{1,2,3}` from `stream.integer(1,4)`, `:393`)
- territory and road-network layout spread
- objective middle-site distribution (today one `.pick()` of two per faction)
- optional-site region entropy, once those six literals become a seeded pick

**Campaign-anchor entropy is deliberately excluded.** `ENDPOINTS` is fixed and stays fixed
until 2.2, so asserting anchor variety now would assert a property the code is not intended to
have. Add that axis when 2.2 lands, not before. Include a **negative control**: removing any one
axis must fail the test, so it cannot quietly become a tautology.

Then **eligible optional-site placement** (the six literals at `WorldGenerator.ts:453-460` are
genuinely independent of the river solver) and a **river lateral jog or meander**; bridge
derivation already handles arbitrary transverse crossings (`isTransverseRiverCrossing:842-858`).
Then **two or three terrain-bound encounter templates** composed around real affordances — a
bridge toll, a forest crossfire, a settlement siege — because layout permutation alone is
isomorphic and only the encounter grammar makes a place read as a place.

Endpoint permutation is **not** part of this milestone, and the reason is structural rather
than budgetary: `transverseRegionPath:801-808` throws unless the two endpoints differ in x with
the river column strictly between them, and the river is always a vertical column
(`createRiver:393-397`). Moving the anchors means moving the river axis, which is 2.2.
*Effort:* 4–6 d. *Risk:* generator and validator regressions — the 500-seed gate is the
guardrail. *Signal:* the variety test's metrics move on the axes it covers, its negative
control fails when an axis is removed, and generation failure rate stays 0/500.

**1.6 — In-run doctrine draft: rules, not stats.**

*Problem.* `BOON_CATALOGUE` is six flat scalars costing 210 profile currency against a maximum
of 90 per run — `45` for a victory or `12` for a defeat, plus `min(25, kills/4)` plus
`min(20, objectivesCompleted × 4)` (`profile.ts:209-221`) — merged by spread (`:119-122`) and
never interacting: the persistent layer is fully unlocked in three to five runs and then inert.
In-run, gold is finite and prices escalate, so there is a local opportunity cost — but the
three upgrade tracks are monotonic and non-competing, so a long enough run buys all of them
and no run ever commits to a build. `unlockedContentIds`,
`unlockedCosmeticIds` and `RunConfig.modifiers` are all declared and never written.

*Proposal (a joint position; both agents moved to reach it).* Profile currency unlocks a pool
of **doctrine cards that change rules, not numbers**, held in `unlockedContentIds` — a field
that exists and is never written. Each run drafts three from a seeded offer, maximum three
equipped. Anchor the draft points on `threatTier = min(5, 1 + floor(elapsed / 180))`
(`types.ts:405-406, :558`), which already exists, is already persisted in the director state
and already paces the run: drafts at **3, 6 and 9 minutes**, cap reached naturally. That
anchoring deliberately decouples this initiative from 1.4, so a contracts slip cannot stall it.

**Where the state lives matters and the obvious answer is wrong.** `RunConfig`
(`run/runTypes.ts:34-40`) is *immutable launch configuration* — seed, generator version,
faction, boon. Doctrines drafted at minute three are not launch configuration and must not be
written into `RunConfig.modifiers`; that field should be reserved for future launch-time
challenge rules, which is what its name and position imply. Active doctrine ids belong in
`RunPlayerState`, `directorState`, or a new run-build block on `ActiveRunSaveV3`.

**Offers need their own random stream.** The run currently derives five —
`combat`, `director`, `event`, `loot`, `chronicle` — and their states are persisted
(`rngStates`, `run/runTypes.ts:93`). Drawing a doctrine offer from any of them would shift
every subsequent draw from that stream and silently change encounters or loot as a side effect
of a UI event. Add a dedicated `doctrine` stream via `deriveSeed`, or key the offer purely on
seed + tier. Persistent challenge mutators follow later, once a doctrine pool exists.

*Effort:* 4–6 d plus tuning. *Risk:* interaction explosion and power creep — sidegrades only
and a hard slot cap. **The doctrine set must not enter `WorldBlueprint.fingerprint`**:
`computeWorldFingerprint` (`WorldValidator.ts:83-88`) hashes canonical generated-world data
only, and `blueprintFingerprint` is the world-identity check used to reject mismatched saves
(`run/runTypes.ts:84, :110`; `run/storage.ts:488-534`). Folding a ruleset into it would give
two identical worlds different world fingerprints and blur what the validator is asserting.
Modifiers belong in a **separate run/ruleset fingerprint** carried on the run config and the
share descriptor, so a shared seed still means one world and a shared *seed + ruleset* means
one run. *Signal:* profile currency spent past run five; distinct equipped sets across run
history.

### Phase 2 — measured expansion

**2.1 — Broad subset completion and the remaining contract verbs.** Gated on 1.4's numbers.
This is where the cost sits and where the save shape moves: the win condition at
`GameEngine.ts:6098` is replaced, `Objective` gains a skipped/optional concept, and
`objectivesCompleted` is re-decided. Save-shape churn is acceptable under this project's
discard-and-report policy (`run/runTypes.ts:15-16`) but is not free.

**2.2 — Full non-isomorphic macro-archetypes**, explicitly deferred until run epilogues and
player evidence show that seeds still feel interchangeable after 1.5. See the open
disagreements: one agent would schedule this, the other would not.

## Explicitly rejected ideas

**A general `GameEngine.ts` refactor or an ECS rewrite.** The file is 13,838 lines with zero
`any`, zero `@ts-ignore`, zero lint suppressions and zero `TODO`/`FIXME`/`HACK`. It is not
rotting; it is *blocking specific work*. Extract the three seams 0.2 names and nothing else. A
wholesale rewrite also defeats the one technique that makes extraction safe here — an
equivalence control needs a stable other side to compare against.

**A performance sprint on the AI quadratics or the renderer.** Measured: `selectThreat` for
all actors costs **1.48 % of a 60 fps frame at `MAX_ACTORS = 25`**. The 105 `new
THREE.Vector3(`, 119 `.clone()` and O(n²) `getActorSeparation` are real and bounded by the
same cap. The one measured stall worth fixing is 0.3, and it earns its place because a
benchmark found it, not because the code looked slow. If a future initiative raises the actor
cap, `alliesEngagedOn` inside the `selectThreat` loop (`ActorAi.ts:399-428`) is the first thing
to go — 26.7 % of a frame at 100 actors.

**Making `requestPath` asynchronous as the first move on the streaming stall.** It looks like a
free seam — it is currently a straight alias for `findPath` (`NavigationSystem.ts:428-434`).
But a null path drops actors into straight-line movement (`GameEngine.ts:4108-4122`), so an
async window would have every actor in a freshly streamed region walking into walls. Cache the
height field first; asynchronous pathing needs a safe "path pending" actor state before it is
worth attempting. *(Proposed by OPUS, caught by SOL.)*

**More biomes, enemy types, weapons, weather, foliage, FX, achievements or random event
kinds.** Both agents reached this independently. These surfaces are already richer than the
decisions they support: four biomes, seven faction combat roles plus four beast roles, 27 audio cues, ten event kinds and 58
achievements sit on top of six campaign graphs and one universal primary attack loop. Vocabulary is not the
bottleneck; grammar is.

**Nine new campaign verbs in one initiative.** *(Proposed by SOL, withdrawn by SOL.)* It is
13–18 days of new systems and exactly the interaction pile this repository has learned not to
trust. Superseded by 2.1, which promotes existing event builders instead.

**A "pay gold at a settlement for +pressure" garrison lever.** *(Proposed by OPUS, killed by
SOL.)* A spreadsheet button masquerading as agency; it would turn a 3D game into a map-menu
economy. Chronicle influence must be embodied — escort, defend, sabotage.

**Player poise and flinch in the first melee milestone.** *(Proposed by OPUS, opposed by SOL,
conceded.)* Removing player agency is the wrong opening move, and the enemy stagger model
already supplies the readability the change was meant to buy.

**A dodge/roll button with i-frames in melee v1.** Deferred, not banned — replaced by the
movement-and-ability cancel in 1.1. Kept as a conditional; see the open disagreements.

**Converting the browser runtime to a fixed timestep as a precondition for anything.**
*(Proposed by OPUS, attacked by SOL, conceded.)* It changes input latency, collision cadence,
hit-stop and every timer at once. Run scripted 30/60/144 Hz schedules first and convert only
if measured outcome divergence justifies it.

**Un-single-filing the deployed build for cacheability.** `viteSingleFile()` is applied to
every build (`vite.config.ts:7`), so Pages serves one 1,378 kB HTML (374 kB gzip) with no
cross-deploy caching, and `scripts/bundle.mjs` turns out to be a nine-line `copyFile` — the
"standalone offline HTML" is a byproduct, not a protected feature, and would survive a
`--mode single` split. **But there is no load measurement**, and acting on an unmeasured
performance hunch is exactly what this document rejects elsewhere. A maintenance note, not an
initiative; any change must retain a standalone single-file target.

**Permuting the campaign anchors over the eight square symmetries as a cheap variety win.**
*(Proposed by OPUS, withdrawn after reading the solver.)* `transverseRegionPath:801-808` throws
unless the endpoints differ in x with the river column strictly between them, and the river is
always vertical (`createRiver:393-397`). Freeing the anchors requires freeing the river axis,
which is 2.2 — so endpoint permutation is **not** in 1.5 and its cost is not carried by that
estimate. It ships with the archetype work or not at all.

**Full non-isomorphic macro-archetype generators as current work.** *(Proposed by SOL,
deferred by agreement.)* Four new generators, each needing its own critical-path solver, road
topology and `WorldGenerationError` surface against the 500-seed gate, at 10–15 days.
Revisited only if 1.2's epilogues show seeds still feel interchangeable after 1.5.

**Persistent launch-time-only run modifiers as the answer to the dead meta-loop.** *(Proposed
by OPUS, superseded by the joint doctrine-draft model in 1.5.)* Rules-not-stats was the right
principle; selecting them before launch was the wrong delivery. Challenge mutators may follow
once a doctrine pool exists.

**A standalone tutorial mode.** `PRODUCT.md`'s anti-references rule out the corporate version,
and a modal that explains stamina before the player has any is worse than nothing. 0.4 ships
teaching inside the fiction, attached to the mechanic, once.

**An i18n layer.** Tempting — there is none, and 545 Cyrillic string lines live outside
`content/` across five files, with `formatRussianCount` hand-rolled for Russian only
(`gameCopy.ts:8-21`). Rejected for now: the product is explicitly aimed at a Russian-speaking
audience (`PRODUCT.md` §Users), the humour is untranslatable by design, and an i18n pass would
freeze copy in every file at precisely the moment the game most needs new copy (0.4, 1.2, 2.1).
Revisit when the copy stops moving.

**Villager dialogue, a reputation or crime system, and huntable wildlife.** Already rejected by
`living-world-spec.md` §8 with reasons this document endorses: an interaction prompt "would
make every village a menu", and making wildlife killable would convert free props into actor
slots that then compete with raids for the six-slot ambient reserve.

**Save migration.** The project's policy is discard-and-report, not migrate
(`run/runTypes.ts:15-16`, asserted in `tests/runStorage.test.ts:362`). It is correct while the
save shape is still moving, and several initiatives here move it.

## Open disagreements

Both positions are stated as their author would state them. Where the debate produced a test
instead of an answer, that is said plainly rather than dressed up as consensus.

**(a) Whether a true dodge is ever needed.**
*SOL:* Start with a defensive cancel using existing inputs — movement live through beats one
and two, sprint/jump/ability cancelling the buffer and recovery, guard shield-cancel, only the
third beat committing. A roll adds a button, a touch affordance, animation and collision
states and a stamina rebalance, and enemy contact already revalidates range so ordinary
movement answers telegraphs today. Add a true dodge only if scripted 30/60/144 Hz fights and
browser play show movement-cancel cannot reliably clear the tells.
*OPUS:* Agreed as the first milestone, but the condition matters and should be written down:
the windup band is 0.18–0.56 s (`actorWindup:4797-4801`), and if a beat's commitment window
exceeds the 0.18 s scout/minion floor, movement stops being an answer and the dodge becomes
the missing half of the mechanic rather than scope creep.
*Status:* converted into an acceptance criterion, not resolved by agreement. Both agents accept
the test; neither has conceded the prediction. Explicitly preserved as a conditional tension
rather than a permanent ban.

**(b) Whether macro-archetypes ever get scheduled.**
*SOL:* Conditional Phase 2 — only if the harness, the epilogues and player evidence say seeds
still feel interchangeable after 1.5. Permuted endpoints alone are isomorphic variety; after
five minutes the same campaign is still the same campaign, and only genuinely non-isomorphic
layouts plus a terrain-bound encounter grammar make a route recognisable as *that seed*. Not
"start sooner" — conditional, on evidence.
*OPUS:* Probably never at this price. A player remembers what they *did* longer than the shape
of the coastline, and 10–15 days is most of a month against a loop whose primary attack is
still one universal, unaimed swing today. The mechanism argument is conceded entirely — the
cheap version provably does not exist — and the price is still declined.
*Status:* genuinely unresolved. 2.2 exists as a placeholder gated on 1.2's evidence, which is
the compromise neither agent argued for.

**(c) Phase 0's pacing.**
*SOL:* Roughly one week, with work in parallel.
*OPUS:* Eight to ten days if run serially — the harness and seams alone are 4–6 d, the nav
work 2 d. The difference is entirely about how many people are working, and it is recorded so
nobody plans against the optimistic number by accident.

**(d) Labelling, not substance.** SOL classes the CI gap and the spec archive as documentation
and process debt that belong outside the ranked roadmap; OPUS accepted Phase 0 placement but
holds that 208 tests not gating a production deploy is a product risk rather than hygiene.
Both agents want it done in the first hour.

### Tensions the debate actually resolved

Recorded because a document that shows only its disagreements misrepresents the process.

**Fixed-step conversion.** OPUS opened holding this strongly, as a precondition for measuring
anything. SOL argued that it changes input latency, collision cadence, hit-stop and every timer
at once, and that scripted-schedule equivalence tests should come first with conversion only on
measured divergence. OPUS conceded in Round 3. **Resolved by concession, not still open.**

**The streaming stall's placement.** OPUS measured it, then filed it at P1.2 as a prerequisite
created by the melee rework. SOL argued it is a player-facing latency bug that exists today,
independent of every design initiative, at two days' work — and that burying it behind a 4–6
day harness and a 4–5 day combat rework is indefensible. OPUS conceded; it is now 0.3. SOL then
supplied the constraint that stopped the obvious fix being wrong.

**Where meta-progression lives.** OPUS proposed persistent launch-time modifiers; SOL proposed
in-run sidegrades. SOL adopted OPUS's "rules, not stats" framing over its own; OPUS adopted
SOL's "during the run, not before it" priority. Neither agent's original survived, and 1.6 is
the thing that did.

**Campaign contracts.** SOL opened with a five-act branching DAG plus nine faction verbs as a
single P0 initiative. OPUS attacked the costing — the verbs do not exist as `ObjectiveKind`
and were priced at 13–18 days — and SOL withdrew the nine-verb scope as overlarge. OPUS's own
number then turned out to be against the wrong baseline, because ten event builders already
ship those behaviours; SOL supplied that correction. **SOL explicitly accepted the P1 split
first slice after melee, with broad subset completion and the remaining verbs in P2**, which is
the shape in 1.4 and 2.1. This is a resolved position change on both sides, not an open
disagreement. What remains is a difference of emphasis rather than of plan: SOL holds that the
campaign must eventually stop being six graphs; OPUS holds that the expensive half is campaign
*safety* rather than behaviour, since an event may fail harmlessly and an objective may never
strand a run.

**What "all-required DAG" actually buys.** OPUS priced an all-required branching graph as a
drop-in because the persisted `Objective` shape does not change. SOL pointed out that
`getActiveGeneratedObjective` (`GameEngine.ts:3297-3305`) is a `.find()` returning only the
first ready node, so such a graph would show one objective at a time and present no visible
choice at all — and that with every branch required, the choice is an ordering, not a route.
1.4 and its success signal were rewritten accordingly. **OPUS conceded.**

## Sign-off

**Agent OPUS — Claude Opus 5.**

I studied this repository independently before contacting my peer: every document in `docs/`,
the whole of `src/game/`, `npm ci` / `npm test` / `npm run lint` / `npm run build`, and two
benchmarks of my own against the real modules because I did not want to bring an unmeasured
performance opinion into a repository whose culture is negative controls.

I changed my mind on eight things over three rounds, and I want them on the record rather than
smoothed into a consensus voice. I opened saying I would spend nothing on performance; my own
benchmark showed a 77 ms streaming stall and I was wrong about which performance. I then put
that fix behind two large initiatives, and SOL was right that a two-day player-facing latency
bug does not wait for a combat rework. I proposed converting the runtime to a fixed timestep
and SOL was right that measuring divergence first is better engineering. I proposed player
poise, and it was a bad idea. I proposed a buy-a-garrison chronicle lever, and SOL correctly
called it a spreadsheet button. I proposed permuting the campaign anchors as a cheap variety
win, argued it twice, then read `transverseRegionPath:801-808` and found the critical-path
solver is hardcoded to a vertical river — the cheap version does not exist, and SOL's
expensive framing was right. I proposed launch-time run modifiers where SOL's mid-run doctrine
draft is the better delivery of the same principle. And I priced nine campaign verbs at 13–18
days against a write-from-scratch baseline, which SOL correctly identified as the wrong
baseline: ten event builders already ship those behaviours. I also missed the run epilogue
entirely; it belongs in this plan and it is SOL's.

Then SOL reviewed the finished draft and found four more things wrong with it, all now fixed:
the source file count (38 tracked files, not 28); my claim that the player's influence over the
chronicle is "one bit", which is simply false — `playerObjectiveRatio` feeds faction strength
on every tick (`GameEngine.ts:7006-7031` → `Chronicle.ts:589-594`) and materialized-event
hand-backs write control, pressure, supply and integrity, so the real problem is that influence
is *reactive and unchosen*, which is a better argument than the one I made; my claim that a
per-frame weather lerp mechanically implies different beast pressure at 30 fps and 144 fps,
when `advanceWeatherMix` composes exactly across sub-steps for a fixed target and the real
hazard is target-transition sampling; and "exactly one encounter per region", when finale
regions have two. SOL also correctly stopped me attributing a cause to the welded-together
lines in `GameEngine.ts` that I could observe but not explain, and sharpened "the swing cannot
miss" into the true version: an empty swing whiffs, but inside 3.6 m it cannot, and movement is
already a defence against telegraphs.

That review is the most useful thing that happened to this document.

SOL then reviewed it again and found five more, which is why the roadmap is worth reading:
that mid-run doctrine ids must not go into `RunConfig`, which is immutable launch
configuration, nor into `WorldBlueprint.fingerprint`, which validates canonical world data;
that doctrine offers need their own derived random stream or they will silently perturb the
event and loot streams; that "persistence is free" for chronicle commitments was only true of
the *outcome* writes and not of the pin, the deadline or any in-flight state; that the variety
test must not assert anchor entropy on axes the milestone does not make vary; and — the sharpest
of all of them — that an all-required branching DAG buys no visible choice whatsoever, because
`getActiveGeneratedObjective` is a `.find()` that surfaces one node at a time. That last one
was the load-bearing claim in my own pricing of contracts, and it was wrong.

I have been corrected more times in this debate than I have corrected — twelve distinct points
to two, by my count. In its last pass SOL also caught an internal contradiction I had
introduced myself: the rejected-ideas entry still said endpoint permutation "survives inside
1.4" while §1.5 said it did not. The document is better for all of it, and I would rather it
say so than pretend the two columns were even.

What I still hold, having been argued at: the expensive half of campaign contracts is
*safety*, not behaviour — an event may fail harmlessly, a campaign objective may never strand
a run, and reusing a shipped event builder does not amortise that; and macro-archetypes are a
fortnight I would spend elsewhere. Both sit in the open disagreements above, unresolved, which
is where they belong.

One correction I issued against myself during the debate, since this document will be cited:
I claimed `GameEngine.ts:4499` shadowed an imported `beastPackShare`. It does not — it is a
deliberate adapter around the free function. I withdrew it before it could propagate, and SOL
confirmed it had not relied on it.

Two things this document deliberately does not know, and says so in place rather than
guessing: the game's actual frame rate on real hardware, and where its GPU time goes. No
browser was available in the analysis environment and headless WebGL is software-rendered, so
any number would have been a fiction. The project cannot answer them either — which is an
argument for instrumentation, and is why 0.3 ends with "confirm with a real frame trace".

The single recommendation I would defend hardest is the cheapest one on the list: **wire the
tests into CI today.** This project has 208 tests, negative controls, equivalence harnesses
and a 500-seed completability gate that take fourteen and a half seconds to run, and not one
of them stands between a mistake and a player.

*Signed, Agent OPUS (Claude Opus 5), 2026-07-27.*

---

*(Agent SOL's sign-off follows, pasted verbatim exactly as SOL sent it. It has not been
edited, trimmed or written on SOL's behalf.)*

**Agent SOL (GPT-5.6 Sol)** — I approve this strategy. It correctly prioritises measurement, traversal latency, player agency, run memory, and embodied Chronicle choices over more surface content; I retain the documented evidence gate for macro-archetypes and the implementation reservation that immutable world identity remain separate from mutable run and doctrine state.
