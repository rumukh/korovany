# КОРОВАНЫ — Strategy and systems record

> **Two documents in one.** §*What shipped* is the systems record: fifteen design
> specifications distilled and folded in, then deleted from `docs/`. Everything from
> §*Current-state assessment* onward is the strategy — an assessment of where the project stands
> and a prioritised plan for what to build next.
>
> The strategy half was owned and written by **Agent OPUS** (Claude Opus 5), adversarially
> reviewed across three full rounds by **Agent SOL** (GPT-5.6 Sol). Both sign-offs are at the
> bottom; SOL's is pasted verbatim from SOL's own message and was not written by OPUS. Nothing
> in this work changed gameplay code — the document is the deliverable.
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
measuring it (§What shipped → Living world → Measured findings, Q1). That is why the harness comes first and why
almost every initiative below names the number that would prove it worked.

## What shipped: the systems record

This part is the surviving record of fifteen design specifications, folded into this document
and deleted in the same commit. It covers 6,047 lines and 296 KB of `docs/*-spec.md`.

**What was kept:** every named constant and its value, every threshold, timing, probability,
role table, formula, design rule, negative control, self-correction, and every measured result.
**What was dropped**, and deliberately: restated context, motivational prose, "current baseline"
tables that only described code that already existed, file-by-file change lists that git history
now holds better than prose, spec section numbering, and the specs' own **effort estimates** —
planning artifacts for work that is finished, carrying nothing a future implementer needs.

Coverage is checked mechanically by a tool **that is in this repository**: `scripts/strategy-facts.mjs`,
run as `npm run docs:facts`, with its extracted fact set in `scripts/strategy-facts.fixtures.json`
and its control corpus in `scripts/strategy-facts.controls.json`. Regenerate with
`node scripts/strategy-facts.mjs --generate` (which reads the deleted specs back out of commit
`d854a75`) and then `node scripts/strategy-facts.mjs`. A figure only its author can reproduce is not
evidence — and **four** successive versions of this measurement were wrong, each in a way that was
invisible to itself until someone else broke it.

1. **A document-wide token set** reported "93.4% numeric coverage". It counted a number as preserved
   if it occurred *anywhere* in a 2,800-line file, so loot's 120 ms beam reveal registered as present
   because `120` appears in the weather table. **Global presence is not contextual preservation.**
2. **A section-scoped version whose control sampled its own output.** It deleted facts the extractor
   had already selected and confirmed the miss count rose — a test of the *matcher*, silent about
   whether the extractor recognises a class at all. **You cannot test recall by sampling from your
   own precision set.**
3. **A gate that could not fail.** Exit status was driven only by the storage-key check, so deleting
   every occurrence of `chronicle` produced eight missing facts and exited `0`, while the prose
   matcher accepted three signature words out of four — enough that deleting a rule's single most
   discriminating token still scored the rule preserved.
4. **A 100% that measured tokens, not facts.** Constants and numbers were independent bags, so
   `BLOOM_LAYER` and `1` both being present said nothing about `BLOOM_LAYER = 1`; a role table
   containing `30` and `7` said nothing about which role had which; single-digit integers were never
   extracted at all; and `STOP_WORDS` discarded `not`, `never`, `before` and `after`, so *"do not
   make bloom responsible for outlines"* and *"do make bloom responsible for outlines"* had identical
   signatures. Six adversarial mutations — two value swaps, a row swap, a polarity inversion and an
   ordering inversion — all passed at 100%.

Every one of the four was found by **Agent SOL**, and three of them by breaking the tool rather than
reading it. The pattern has a name, and it is the most transferable thing this exercise produced:
**a tool answered a question nobody checked it could answer.** SOL made the same error once itself
while auditing — a shell that flattened a JSON array made every prose probe look like a single common
word — and reported it rather than the finding it appeared to support.

**What the checker does now.** It is **section-scoped**: each spec is compared only against the
consolidated section that replaces it. It extracts **ten declared classes**. Its controls come from a
**hand-authored corpus** in `strategy-facts.controls.json`, written against the specs and never
produced by the extractor, so a class the extractor cannot see still has a control that fails. Each
control mutates the document and must raise the miss count; one that does not fire names its class
and aborts the run. **The gate gates**: any miss not on the declared list exits non-zero.

Two capabilities exist because deletion turned out to be the easy mutation, and corruption the one
that matters. **A dropped rule is a gap; an inverted rule is a lie that reads as authoritative.**

**`npm run docs:mutate`** applies a committed table of *semantic* mutations —
`strategy-facts.mutants.json` — and fails if any survives. It inverts every prohibition in the
document (`do not → do`, `must not → must`, `never → always`), flips a comparison
(`shorter than → longer than`), reverses a phase ordering (`after → before`), and corrupts bound
values including single digits (`BLOOM_LAYER 1→9`, `ARCHER_DAMAGE 7→9`, `MAX_ACTORS 25→35`,
`MAX_ACTIVE_VOICES 24→42`, `DAY_LENGTH 240→420`, `CIVILIAN_ALARM_RADIUS 12→21`) and swaps a role's
hit points. All twelve are caught. Inverting all 199 occurrences of `never` produces 60 new misses;
it used to produce none, because `never` was a stop word — the single most load-bearing word in a
repo whose culture is negative controls was being discarded before the probe was built.

**An internal-consistency check** answers what preservation checking structurally cannot see.
Corrupting `MAX_ACTORS = 25` to `35` at two of its three sites leaves the third intact, so every
per-spec fact still has a window that satisfies it and the run stays green — while the document now
says both 25 and 35. Partial corruption is the realistic shape of a bad merge. A constant bound to
two different values is wrong *regardless of which is right*, so this is checkable without knowing
the truth. Four of the twelve mutants are caught only this way. Deliberate divergences, where the
document records both what a spec asked for and what shipped, are declared in
`strategy-facts.contradictions.json` with a reason — currently one entry, `FIRST_EVENT_AT`, which is
50 in the spec and 30 in the code.

The check found a **real error in this document** the first time it ran: `CAMERA_ACCENT_MAX` was
being used for the four-entry list cap, when the spec binds `CAMERA_ACCENT_MAX = 7` as the FOV clamp
bound and `CAMERA_ACCENT_MAX_ENTRIES = 4` as the cap. Two sentences asserted a constant equal to a
value it is not. Corrected.

**What "preserved" means operationally**, stated rather than implied:

| Class | Preserved when |
| --- | --- |
| `constant`, `storageKey` | the literal token appears in the owning section |
| `numericValue` | the number appears in the owning section, not inside a longer number |
| `relation` — binding | the value follows the name **with no other number in between** |
| `relation` — row | the name and **all** of that row's values appear in **one line** |
| `relation` — comparison | the name and its comparative marker (`shorter`, `below`, `above` …) appear in one line |
| `formula`, and the five rule classes | the three rarest words of the source sentence **all** appear, verbatim, inside one three-line window |
| a rule that was **negated** | additionally, some **single sentence** contains those words **and** a negation |
| a rule that carried an **ordering** marker | additionally, some single sentence contains those words **and** that marker |

Signature words are the three **rarest** in the corpus, by document frequency across all fifteen
specs — not the three longest, which is what an earlier version used and which selected `therefore`,
`controls` and `create` as often as `combatMotion`, `rain-to-snow` or `faction-start`. Rarity makes
the discriminating token mandatory. **Matching is exact-form.** British/American spelling
normalisation applies on both sides — `behaviour`/`behavior` is one lexeme rewritten to one lexeme,
which cannot merge two distinct words.

**Inflection normalisation was tried and removed, and this records why rather than deleting the
evidence.** A stemmer collapsed `flash`/`flashes` and `callout`/`callouts`, which is legitimate. It
also collapsed `clear`, `clears` and `clearly` to `clear`, and `apply`, `applies` and `app` to `ap`.
The first of those produced a **false positive on a genuinely absent fact**: the rule that
`setScreenShakeEnabled(false)` **also clears existing trauma** was missing from §5, and the adverb in
*"incoming damage reads clearly"* satisfied its probe. The worked example the note gave for the
stemmer was false as well — it did not in fact equate `reserve` with `reserved`.

Hardening it — dropping those two rules and adding required-distinction tests — fixed the known
collisions but not the shape of the problem. **A global many-to-one collapse lets any word in a
section satisfy any probe that normalises to the same token, and a false positive is worse than a
miss: a miss is a gap, a false positive is the tool certifying something that is not there.** So it
is gone. Removing it exposed **twelve** facts it had been covering, all now restored and listed in
the commit that removed it. If inflection tolerance is wanted later it must be probe-scoped — a
curated map attached to one specific fact — never a global normaliser.

**The tool verifies this document's own arithmetic.** Hand-maintaining a figure inside a note whose
subject is not trusting hand-maintained figures is self-refuting, and it had already drifted once:
a `--break` occurrence count was hand-written into this note and disagreed with what the tool
printed, and it drifted again as the document grew. The checker now reads
back the headline result and the residue count stated below and **fails if either disagrees** with
what it just computed.

**Result: 2,287 facts across the fifteen pairings, 94.6% present in the owning section.**

| Class | Facts | Preserved | | Class | Facts | Preserved |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| numeric value | 576 | 100% | | budget rule | 128 | 89.8% |
| named constant | 342 | 100% | | lifecycle / ownership rule | 145 | 83.4% |
| accessibility rule | 23 | 100% | | edge-case rule | 101 | 82.2% |
| storage key | 12, from `src` | 100% | | design rule | 251 | 78.9% |
| relation (binding, row, comparison) | 644 | 98.9% | | | | |
| formula | 76 | 98.7% | | **total** | **2,287** | **94.6%** |

**The residue is 123 facts, and it is not rounded away.** Every one is enumerated in
`scripts/strategy-facts.accepted.json` with its spec, class and source sentence, so the gap is
auditable entry by entry: 53 design rules, 24 lifecycle rules, 17 edge cases, 14 budget rules, 14
relations and 1 formula. The gate is a **ratchet, not a threshold**: the run fails if a miss appears
that is *not* on that list, so preservation can only improve and a green `npm run docs:facts` means
"nothing regressed" — a claim it can actually support. Removing `AMBIENT_BEAST_LIMIT` from §1, for
instance, produces `NEW MISS: living-world [constant] AMBIENT_BEAST_LIMIT` and exit 1.

Two kinds. Most are **co-occurrence** failures: the rule is in the document but its three rarest
words do not fall inside one three-line window, usually because the distillation split one spec
sentence into two. The rest are **polarity** failures: the rule is present and stated affirmatively
where the spec stated it as a prohibition. Both are real fidelity gaps for normative text, and
neither is a missing number — **every constant, storage key, numeric value and name→value binding in
all fifteen specs is present in its owning section.**

**What this instrument cannot detect — stated because an undeclared limit is the failure this whole
thread has been about.**

It validates **presence and binding. It does not validate meaning.** Concretely, all of the following
would pass a green run:

- A rule preserved correctly but **attributed to the wrong subsystem** inside the same section.
- A number preserved with the **wrong unit** — `0.12` seconds written as `0.12` metres.
- A rule preserved in one place and **contradicted in another** part of the same document.
- A negation expressed **without a negation token** — "bloom owns outlines" carries the opposite of
  "outlines must not depend on bloom", but contains no `not` for the polarity check to find.
- A paraphrase that **inverts meaning while keeping the rare words**, since the signature is a bag.
- Anything about whether a preserved claim is **true of the code**. The acceptance ledgers below were
  checked by reading `src/`, by hand; no part of that is mechanical, and two of its rows were wrong
  until an adversarial reviewer checked them in source.
- **A comparative relation asserted once in prose between two constants that are each correctly
  bound.** This one has a worked example, because it survived the mutation table and is being left
  in rather than chased. §1 says:

  > `CIVILIAN_PANIC_RECOVERY = 1.5` is far shorter than `MORALE_RALLY_SECONDS = 12`

  Flip `shorter` to `longer` and nothing fails. Both constants are present, both values are bound to
  the right names, and the `relation`/comparison kind attaches a marker to a *named* constant on the
  same line — but the claim here is about the **pair**, and the pair is not a tracked fact. Catching
  it means encoding pairwise comparisons between arbitrary constants, which is an eleventh class,
  and there would be a twelfth after it. **A known limit that is written down is worth more than
  another epicycle.**

**On the controls themselves.** Every control is now hand-authored against the specs rather than
drawn from the extractor's own output, which removes the circularity an earlier version had — where
eight of nine controls sampled fixtures produced by the same extractor under test, and only the
storage-key class, enumerated from `src/`, was genuinely independent. But independence of the
*controls* does not make the *extractor* complete. A control can only mutate a fact some class
already models. **A class the extractor does not model has no control, and cannot have one** — the
`relation` class exists at all because a human read the specs and noticed that `BLOOM_LAYER` and `1`
were being counted separately, not because any control fired.

So the honest general statement, which this document should make once rather than keep
rediscovering: **no mechanical checker of this kind is complete.** Mutation testing bounds the
classes you thought of and says nothing about the ones you did not. What the tool buys is that a
specific, enumerated set of regressions cannot happen silently — and that the residue is written
down rather than rounded away.

That an earlier revision of this document scored **100%** and this one scores **94.6%** is the point.
The instrument got stricter five times; the score went 93.4 → 100 → 88.4 → 100 → 68.6 → **94.6**, and only
the falls are informative. A number that cannot go down is not a measurement.

Four extractor exclusions are declared rather than silent, because each removes a *misclassification*
rather than a fact: effort estimates in days or weeks (planning artifacts for finished work); dead
line-number citations into files that no longer exist; and — narrowed after audit — cross-references
to sibling specs, where the **reference token** is now stripped and the sentence kept, because
dropping the whole line also dropped the invariant that line carried. The old blanket exclusion of
TypeScript member declarations is **gone**: `private thunderDelay = -1` is now a `relation` binding,
which is the only class that captures a single-digit sentinel.

**Storage keys are a closed set**, enumerated from `src/` rather than sampled, because the class is
finite and there is no excuse for missing one. The checker **fails the run** if any key is absent
from the section that owns it:

| Key | Owned by |
| --- | --- |
| `korovany-ink-outlines` | §8 toon shading |
| `korovany-bloom` | §10 bloom |
| `korovany-foliage` | §11 ground foliage |
| `korovany-dynamic-day-night` | §12 day/night |
| `korovany-weather` | §13 weather |
| `korovany-sfx-volume`, `korovany-music-muted` | §15 layered audio |
| `korovany-theme`, `korovany-screen-shake` | UI theme and comfort settings — no folded spec |
| `korovany-profile-v1`, `korovany-achievements-v1` | meta-progression — no folded spec |
| `korovany-generated-run-v2` | active-run save — no folded spec |

Two documents in `docs/` were deliberately **not** folded:
`from-four-zones-to-a-seeded-campaign.md` and its `.ru.md` translation. They are published
bilingual articles, not specifications — a different genre, and `PRODUCT.md` treats promo
writing as a pillar rather than as engineering debt.

Each entry below states what the feature is, what actually shipped, where it lives in code, and
an honest status. **Status is not copied from the spec's own checkboxes.** The 164 acceptance
criteria across those fifteen files carried 113 unchecked boxes for features that demonstrably
shipped, which made the archive actively misleading. Every criterion has been re-checked against
the code at `b6f94ad`, and the result is recorded in the ledger at the end of this part —
including, in several cases, "specified but never implemented".

---

### 1. Living world — five layers

*Formerly `living-world-spec.md`, 1,761 lines, the largest spec in the project and the only one
whose acceptance criteria were all already checked.*

A world that keeps running without the player: factions push front lines, beasts raid
settlements, caravans travel real roads and get intercepted, NPCs fight, break and rally on
their own. Fully client-side, no new art assets. Five layers, each independently shippable, all
five shipped.

| Layer | Name | What it does |
| --- | --- | --- |
| 1 | **Хроника** (Chronicle) | Data-only tick over all 25 regions. No meshes, no actors. |
| 2 | **Materialization** | Chronicle situations become 3D only when the player is near. |
| 3 | **Fauna** | Beasts and civilians as non-playable allegiances. |
| 4 | **NPC AI** | Perception, morale, threat scoring, flanking, commander orders. |
| 5 | **Ambient life** | Civilians, wildlife, campfires — cheap, highly visible. |

#### Design rules

These four rules governed every layer and are worth keeping as standing constraints:

1. **The chronicle is data, not objects.** It never touches `THREE`, the scene graph, the
   navmesh or the actor list. This is what makes simulating all 25 regions free.
2. **The player is an observer, not a trigger.** A raid resolves whether or not the player shows
   up. Arriving late means finding the aftermath — literally: `aftermath` is a Layer 2 event kind.
3. **Determinism is not negotiable.** Shareable seeds are a headline feature. The chronicle uses
   its own derived stream and is asserted in tests.
4. **Consequences must be legible.** Every chronicle outcome maps to something the player can
   see: a recoloured map region, a burned settlement, shop prices, or the composition of the
   next encounter.

#### Layer 1 — Chronicle

Fixed-step accumulator in `update()`, after `updateThreat()`. Each tick is
O(regions + roadConnections) ≈ 25 + 40 iterations of scalar arithmetic; never per-frame. The
acceptance bar was **under 1 ms per tick with no per-frame cost**, and it was met.

**A note on how that bar is enforced, because it is the one criterion in the archive that was
mechanised and it is flaky.** `tests/chronicle.test.ts:90-101` asserts `microsecondsPerTick < 1000`
over 200 ticks using `process.hrtime`. Measured on this machine at commit `6442e96`: **15 of 15 runs
pass when the file is run alone**, but the full `npm test` fails it in roughly one run in four, worst
observed **1,214 µs** — 21% over. Node's test runner executes files concurrently, so a wall-clock
budget competes with every other test file for CPU. The budget is not wrong and the code is not slow;
**a wall-clock assertion inside a concurrent runner measures the machine as much as the code.** This
is the same class of problem the acceptance ledger calls "unverifiable by inspection" — except here
somebody did mechanise it, and mechanising it is what made it non-deterministic. If it is worth
keeping, it wants an explicit serial marker or a budget with headroom rather than a bar set at
roughly the observed value; that is a code change and therefore outside this document's remit.

```ts
interface RegionChronicleState {
  control: Territory                  // mutable; seeded from blueprint.territory
  pressure: Record<Faction, number>   // 0..1 military pressure
  beastPressure: number               // 0..1
  settlementIntegrity: number         // 0..100, aggregate over the region's settlement sites
  supply: number                      // 0..1, drives shop stock and prices
  lastEventTick: number
}
interface ChronicleCaravan {
  id: string; ownerFaction: Faction; fromSiteId: SiteId; toSiteId: SiteId
  regionPath: RegionId[]; progress: number; intact: boolean
}
interface ChronicleState {
  tick: number; factionStrength: Record<Faction, number>
  caravans: ChronicleCaravan[]; log: ChronicleEvent[]   // bounded ring buffer, newest last
}
```

`ChronicleEventKind` = `regionCaptured | beastRaid | settlementBurned | caravanLost |
caravanArrived | raidRepelled | beastsRepelled`. The log stores **structured** events, not
sentences; Russian copy is rendered from `content/gameCopy.ts` by stable hash of the event id,
so wording changes need no save bump and a seeded history always reads the same.

`RegionChronicleState` is a first-class typed field on `RegionDelta`, not an untyped
`deltaState` entry. `REGION_DELTA_VERSION = 2`, `ACTIVE_RUN_SAVE_VERSION = 3`; saves that fail
normalization are discarded, not migrated. Read/write seam is
`RegionManager.getRegionChronicle` / `setRegionChronicle`; the engine keeps the live map and
flushes it into deltas inside `saveGeneratedRun()`.

**Tick rules**, in order — `tickChronicle()` is pure over `(blueprint, state, regions, rng,
environment)`, with `chronicleRng = new RandomStream(deriveSeed(blueprint.seed,
'gameplay:chronicle'))` persisted in `rngStates.chronicle`:

1. **Faction fronts.** Pressure grows toward `factionStrength[faction]` in controlled regions and
   decays elsewhere. For each road segment, attacker pressure (source region) is compared against
   defender; the defender also loses `PRESSURE_ATTRITION` per hostile neighbour. When the
   attacker exceeds the defender by `CONTROL_FLIP_MARGIN`, a weighted roll flips `control` and
   logs `regionCaptured`. A region that just changed hands or was raided is immune for
   `CONTROL_FLIP_COOLDOWN_TICKS`.
   `factionStrength = STRENGTH_BASE + share of map held + (player's faction) share of completed
   objectives`.
2. **Beast pressure.** Grows per tick in `forest` and `fort` biomes, scaled up at night and in
   rain/snow, decaying by `BEAST_CONTROL_DECAY` under faction control. Above
   `BEAST_RAID_THRESHOLD` it triggers a raid on a settlement and resets to `BEAST_RAID_RESET`.
3. **Settlement integrity.** A raid drops it; at `0` the settlement is `разорено` — shop and
   recovery go offline, the prefab reads as burned, `settlementBurned` is logged. It regenerates
   after `SETTLEMENT_CALM_TICKS` without an event, but **a region that reached `0` stays razed
   for the rest of the run.**
4. **Caravans.** Advance `progress` along `regionPath`. Entering a region hostile to the owner,
   or one whose `beastPressure ≥ CARAVAN_BEAST_THRESHOLD`, rolls an interception — "a quiet
   friendly corridor is simply safe". Loss sets `intact = false` and reduces destination
   `supply`; arrival raises it. New caravans spawn along road connections touching a trading
   site when fewer than `CHRONICLE_CARAVAN_LIMIT` are in transit.

`CHRONICLE_SETTLEMENT_SITE_KINDS = ['settlement', 'shop', 'recovery']`. A generated world
contains exactly one of each, so a region without one simply stays at `100`.
Shop price multiplier is `1 + (1 - supply) * SUPPLY_PRICE_SWING`.

**UI.** A collapsible «Хроника» panel under the minimap, fed by `GameView.chronicle`, showing
**discovered regions only** — an empty feed is by design and a fog-of-war reward. Front-line
regions (control differing from a road-connected neighbour) get hatch and crossed swords; razed
regions get a scorched tint and flame. Notices for high-salience events are capped at two per
tick batch.

#### Layer 2 — Materialization

`world/Materialization.ts` is pure: no `THREE`, no scene, no actors, **no RNG**.
`findPendingMaterializations()` returns situations sorted by urgency, ties broken on a stable id.
The chronicle refuses to act in a simulated region (`frozenRegionIds`).

| Kind | Fires when | Becomes |
| --- | --- | --- |
| `factionRaid` | Road-connected neighbour's pressure beats the simulated region's by `MATERIALIZE_RAID_MARGIN`; region is not a campaign anchor and still has a settlement | 3 attackers assaulting the settlement, 2 defenders on it |
| `caravanAmbush` | A chronicle caravan rolls through a simulated region that is hostile ground or above `CARAVAN_BEAST_THRESHOLD` | A cart, 2 escorts, 2 raiders; the player can rob it |
| `warband` | Simulated region held by a faction hostile to the player, above `MATERIALIZE_WARBAND_PRESSURE` | A 3-strong patrol |
| `aftermath` | Simulated region already razed and aftermath not yet shown this run | Scorch, smoke, 2 looters |
| `beastRaid` | Simulated region above `MATERIALIZE_BEAST_PRESSURE`, intact settlement, past post-event cooldown | A wrecker plus escorts against the settlement's 2-strong garrison |

**De-materialization is not cancellation.** A located event whose region stops being simulated,
or whose `LOCATED_EVENT_TIMEOUT` expires, is handed back through pure functions in
`Chronicle.ts`: `resolveMaterializedRaid` rolls a winner from each side's surviving share, flips
control (never a campaign anchor), damages the settlement and logs `regionCaptured` or
`raidRepelled`; wiping out one side skips the roll. The assault force is paid out of the
**source** region's pressure. `resolveMaterializedCaravan` writes off a caravan whose escort is
gone; an intact one rejoins `state.caravans`. `resolveMaterializedWarband` scales the faction's
pressure by warband survival and logs nothing — a **wiped warband cuts its region's pressure to
`0.3×`**, which "takes the chronicle a dozen ticks to put another one there". The hand-back roll
uses the seeded `event` stream, never `Math.random()`.

`pickLocatedEventPosition(siteId, regionId)` anchors on a site, falls back to the region centre,
scatters within `LOCATED_EVENT_SCATTER`, and refuses a spot closer than
`LOCATED_EVENT_MIN_DISTANCE` for its first twelve attempts. The older
`pickEventPosition()` — a 22–38 m ring around the player — is retained for `richCaravan`,
`champion`, `rescue` and `bounty`.

**An unenforced invariant, recorded because it bit once and can bite again.**
`resolveLocatedEventOutcome` calls `handBack()` unconditionally, on success and failure alike.
That is only safe while an event's failure condition already implies the outcome the roll would
produce. `factionRaid` satisfies it **by construction, not by design**: it fails when
`defenderStrength === 0`, so the roll is `chance(1)` and cannot disagree. In the spec's own
words: *"Nothing enforces the property — change `factionRaid`'s failure condition to anything
that does not imply a wiped defence and this bug reappears silently."* Layer 3 hit exactly that:
`beastRaid` fails when the *settlement* falls, which is decoupled from the garrison's survival,
so the hand-back re-rolled and **contradicted the player about three times in four**. The
symptom was narrative rather than mechanical — the feed congratulated the player on holding a
settlement they had just watched burn, "which teaches them the chronicle lies".

#### Layer 3 — Fauna

Species are `ActorRole`s, not allegiances. `world/Fauna.ts` is the pure half; every roll is on a
seeded stream.

| Role | hp / speed / poise / dmg | Behaviour |
| --- | --- | --- |
| `wolf` | 42 / 5.4 / 26 / 9, `routThreshold 0.5` | Pack hunter. **Routs** when half or fewer of its *own kind* in the pack are standing and nearby — kin, not pack. Pulling one wolf away breaks it as surely as killing them. |
| `boar` | 70 / 4.6 / 46 / 14 | **Charger.** Winds up, then commits to a straight line it cannot steer. Never routs. |
| `bear` | 135 / 3.4 / 74 / 21 | Brute profile with fur; the wrecker a forest raid leads with. |
| `troll` | 165 / 2.9 / 88 / 24 | **Prop-wrecker.** Spawns in `attackEventProp` mode and takes a settlement apart at roughly twice a raider's rate. Leads raids in `fort` biomes. |

`planBeastPack()` sizes the party from `beastPressure`; most raids lead with a wrecker, escorts
are wolves until the forest is loud enough for boars, and a pack too large for the budget is
**trimmed rather than refused** (the wrecker is always first in the list, so a squeezed raid is
smaller but not toothless). `WOLF_PACK_CHANCE = 0.3` of raids arrive as a pure wolf pack.

**Meshes.** Procedural quadrupeds from the same `BoxGeometry`/`ConeGeometry` primitives and
`ComicMaterialLibrary.createToonMaterial`. `createBeast()` deliberately reuses the humanoid
**pivot names** — `body-pivot`, `torso-pivot`, `head-pivot`, `pelvis-pivot`, `leftArm`/`rightArm`
as front legs, `leftLeg`/`rightLeg` as hind legs, `faction-ring` — so `animateCharacter`, death
motion, limb detachment, the outline pass and health bars all work with **no beast branch**.
Front-left shares a sign with hind-right, producing a diagonal quadruped gait.

`resolveMaterializedBeastRaid()`: beasts that win chew the settlement and reset pressure to
`BEAST_RAID_RESET`; driven off, it resets to `BEAST_RAID_REPELLED_RESET`. **Control never
changes and no faction's pressure moves.** A fallen settlement is handed back as
`defenderStrength: 0`, not a live survivor count. `tests/materialization.test.ts` hammers 24 rng
states to prove a decided outcome cannot be overturned, with a control asserting that an
*abandoned* raid is still genuinely rolled.

Ambient prowlers: one beast at a time in a square above `AMBIENT_BEAST_PRESSURE`, charged to the
`ambient` budget, removed when its region streams out, and suppressed while a `beastRaid` runs.
Raid packs are charged to `chronicle`.

#### Layer 4 — NPC AI

`selectThreat` replaced two rules at once: nearest-wins targeting, and a player override that
ran *before* target selection. Cost is in metres, lowest cost wins:

```
cost = distance
     × (1 − wounded × (1 − hpFraction))     // finish what is nearly finished
     × (1 + crowd × alliesAlreadyOnIt)      // do not stack six deep on one target
     × rolePreference                        // player / backline / heavy
     × (locked ? THREAT_LOCK_BONUS : 1)      // hysteresis, so nobody dithers
```

Archers and scouts shoot past the front rank; brute, champion, bear and troll have
`wounded: 0, crowd: 0` and no preferences — their style is "the *absence* of the other terms";
`wolf` is the only negative `crowd`, which is why `THREAT_CROWD_FLOOR` exists at all (without a
floor, a large enough pack would drive the multiplier to zero and every wolf would fixate on one
animal forever). The player is deliberately **not** range-gated inside `selectThreat` —
`evaluatePlayerPursuit` has already decided candidacy. Retaliation hard-overrides everything.
`selectCombatTarget` is kept and still exported so both measurement arms are shipped code.

**Morale** — one rule, two doors:

```
morale = 1 + resolve(role)
       − MORALE_WOUND × (1 − hpFraction)²          // superlinear: decides things at the end
       − MORALE_LOSSES × (1 − groupShare)
       − (commanderLost ? MORALE_COMMANDER_LOSS : 0)
       + (commanderNearby ? MORALE_COMMANDER_RALLY : 0)
break when morale ≤ 0
```

`MORALE_WOUND = 1.6` is **solved, not chosen**: with the group intact and no commander either
way, `1 − 1.6 × (1 − h)² ≤ 0` at `h ≈ 0.21`, which is the "own hp below ~25%" the design asked
for. `MORALE_LOSSES = 0.7` then puts "half your health gone *and* your mates are dead" just over
the line while leaving a healthy actor standing over corpses in the fight.

`groupShare` counts **bodies, not a remembered roster** — standing allies over standing plus
fallen within `MORALE_GROUP_RADIUS`, with corpses persisting `CORPSE_LIFETIME`, so it is a
memory of *recent* losses and needs no save state. `actorResolve` returning `null` is a hard
gate checked before either door: `commander` (a campaign objective may require killing him),
`champion` ("a boss that flees is not a boss"), `captive`, and `boar`/`bear`/`troll` (whose
answer comes from `BEAST_PROFILES`). A broken **beast** runs from what broke it and is gone past
the leash; anything else falls back on its rally point and stays in the world, where it can be
run down or rallied. A commander within `COMMANDER_ORDER_RANGE` clears a rout and grants
`MORALE_RALLY_SECONDS` of immunity.

**Alerts.** `announceSighting` shares any *first* sighting with allies within
`ALERT_SIGHTING_RADIUS`; `acceptsAlert` decides who takes it. The rule with substance: **an ally
already holding a target does not drop it for hearsay.** The alert hands over the sighted
*position*, not the target id, and the recipient re-runs its own scoring on arrival. It lands in
`alertPos`/`alertTimer`, deliberately not `lastKnownTargetPos`, which `updateActors` clears every
frame an actor is not pursuing the player.

**Commander orders.** Broadcasts a `SquadOrder` — `hold` / `assault` / `escort` — to allies
within `COMMANDER_ORDER_RANGE`. Orders carry a timer rather than clearing on death, so a squad
keeps its last orders for a few seconds; his death applies `MORALE_COMMANDER_LOSS` to everyone
who could see it and cancels any rally. He keeps `speed: 0`. An `escort` order from the caravan
outranks a `hold`.

**Flanking.** With two or more allies on one target, secondaries claim offset approach angles.
`engagementRank` is a stable rank by actor id, so a flanker dying promotes everyone behind it.
**Every slot is inside ±66°, and that bound is load-bearing** — past a right angle the radial
component goes negative and the actor never converges. `flankBlend` folds the offset away over
the last few metres, otherwise attackers orbit forever. An event prop has no queue, so a prop
attacker takes rank 0 and comes straight in.

**The caravan as an agent.** Two guards on a permanent `escort` order; anything hostile within
`CARAVAN_PANIC_RANGE` triggers `CARAVAN_PANIC_SPEED_MULTIPLIER` on the existing road path —
panic is speed, not a new route, because the cart cannot leave the road network. A hostile
reaching an unguarded cart takes it, which is `caravanLost` for everyone. A killed guard is not
replaced for `CARAVAN_ESCORT_RESPAWN_DELAY`. Escorts are charged to `ambient` deliberately, so
they yield their slots first.

Layer 4 adds **no persisted state**; save and delta versions stayed at 3 and 2.

#### Layer 5 — Ambient life

The decision the whole layer turns on is what needs an actor slot:

| Thing | Cost | Why |
| --- | --- | --- |
| Villagers | `ambient` slots | They can be killed, beasts hunt them, they need morale and a place in the actor list |
| Deer, birds, crows | **props, 0 slots** | Non-combat: no hp, allegiance, health bar, threat score or slot |
| Campfires | **props, 0 slots** | The idle NPCs at the fire are the villagers, already paid for |
| Torches | **child mesh on an existing actor, 0 slots** | Plus exactly one shared light for all of them |
| Storm hunch and slow | **0 slots** | A pose offset and a speed multiplier |

The consequence is the point: **nothing Layer 5 adds can ever crowd out a raid.**

`ActorRole` gained `peasant` (hp 26, speed 3.1). `planCivilianCount(settlementIntegrity)` gives
**three villagers in an intact square, one in a scarred one, none in a razed one**, so how busy a
village looks follows the chronicle directly. `isPacifistRole` gates both `selectThreat` and the
retaliation branch in `damageActor`.

**Panic** is a third `MoraleBreak` reason, checked after the `actorResolve === null` gate and
before cohesion. `findCivilianAlarm` counts three things: anything at war with the villager;
anything already in a fight (an actor holding a target or chasing the player — the three sides
stay `neutral` to civilians); and **a body**. The player is passed separately and counts only
while *menacing*, for `CIVILIAN_MENACE_SECONDS` after swinging. Panic **tracks** — it is
re-measured every morale check, and `alarmPos` is deliberately not `alertPos`, because "an alert
is a place worth walking *to*, an alarm is a place worth putting your back to".

Deer and birds use the same `fleeDirection` a panicking villager uses; `shouldStartle` folds
"birds startled by sprinting" into one rule over both species; crows land on bodies down for
`CROW_CORPSE_DELAY` and leave when the body does. Campfires are lit when the **simulation's**
night factor passes `CAMPFIRE_NIGHT_THRESHOLD`, while their *brightness* follows the rendered
night factor — so the day/night display toggle cannot put them out. Torches are child meshes on
soldiers, scouts and minions after dark, with **exactly one point light in the world** following
the nearest bearer.

`weatherPaceMultiplier(stormFactor)` costs an NPC `AMBIENT_STORM_SLOW` of pace and `weatherHunch`
bends the torso pivot forward. Both read `computeStormFactor`, never `weatherEnabled`. The slow
applies to **non-combat movement only** — wandering, holding an order, walking to an alert —
never a pursuit, an attack approach, or a beast, because "fighting 22% slower in it is a balance
change nobody asked for".

Killing a villager pays **no gold, no loot and no kill on the counter**; `recordKill` is never
reached.

#### Tuning constants

```text
# Layer 1 — chronicle
CHRONICLE_TICK_SECONDS=8        CHRONICLE_LOG_LIMIT=40
CHRONICLE_MAX_CATCHUP_TICKS=8   CHRONICLE_FEED_LIMIT=8
CONTROL_FLIP_MARGIN=0.18        CONTROL_FLIP_COOLDOWN_TICKS=3
PRESSURE_GROWTH=0.06            PRESSURE_DECAY=0.03      PRESSURE_ATTRITION=0.015
STRENGTH_BASE=0.25              STRENGTH_TERRITORY_SHARE=0.45  STRENGTH_OBJECTIVE_SHARE=0.3
BEAST_GROWTH_FOREST=0.05        BEAST_GROWTH_FORT=0.04
BEAST_NIGHT_MULTIPLIER=1.6      BEAST_STORM_MULTIPLIER=1.3
BEAST_RAID_THRESHOLD=0.75       BEAST_RAID_RESET=0.35    BEAST_CONTROL_DECAY=0.02
SETTLEMENT_RAID_DAMAGE=[18,34]  SETTLEMENT_REGEN=1.5     SETTLEMENT_CALM_TICKS=4
SUPPLY_BASELINE=0.6             SUPPLY_DRIFT=0.04        SUPPLY_PRICE_SWING=0.45
SUPPLY_CARAVAN_GAIN=0.14        SUPPLY_CARAVAN_LOSS=0.19
CHRONICLE_CARAVAN_LIMIT=3       CARAVAN_INTERCEPT_BASE=0.12
CARAVAN_HOSTILE_RISK=0.18       CARAVAN_BEAST_RISK=0.2
CARAVAN_BEAST_THRESHOLD=0.5     CARAVAN_PROGRESS_PER_TICK=0.18
DEFEND_HOME_MAX_DISTANCE=95

# Layer 2 — materialization
ACTOR_BUDGET={squad:3, campaign:8, chronicle:8, ambient:6}      MAX_ACTORS=25
MAX_LOCATED_EVENTS=2            MATERIALIZE_INTERVAL=6
LOCATED_EVENT_MIN_DISTANCE=26   LOCATED_EVENT_MAX_DISTANCE=150
LOCATED_EVENT_SCATTER=9         LOCATED_EVENT_TIMEOUT=150
THREAT_WAVE_EVENT_RADIUS=45
MATERIALIZE_RAID_MARGIN=CONTROL_FLIP_MARGIN*0.6                 (=0.108)
MATERIALIZE_WARBAND_PRESSURE=0.32
RAID_SOURCE_SPEND_WON=0.5       RAID_SOURCE_SPEND_REPELLED=0.35
EVENT_REQUIRED_SLOTS={factionRaid:5, caravanAmbush:4, warband:3, aftermath:2, beastRaid:5}
LOCATED_EVENT_REWARDS={factionRaid:110, caravanAmbush:140, warband:80, aftermath:45, beastRaid:95}

# Layer 3 — fauna
BEAST_PROFILES={wolf:{hp:42,speed:5.4,poise:26,dmg:9,rout:0.5},
                boar:{hp:70,speed:4.6,poise:46,dmg:14},
                bear:{hp:135,speed:3.4,poise:74,dmg:21},
                troll:{hp:165,speed:2.9,poise:88,dmg:24}}
BEAST_SENSE_RANGE=21            BEAST_LEASH_RANGE=52
WOLF_PACK_RADIUS=16             WOLF_PACK_CHANCE=0.3     BEAST_ROUT_SECONDS=9
BOAR_CHARGE_RANGE=14            BOAR_CHARGE_WINDUP=0.55  BOAR_CHARGE_SPEED=11.5
BOAR_CHARGE_DURATION=1.05       BOAR_CHARGE_COOLDOWN=4.5 BOAR_CHARGE_DAMAGE=22
MATERIALIZE_BEAST_PRESSURE=BEAST_RAID_THRESHOLD-0.12             (=0.63)
BEAST_RAID_REPELLED_RESET=0.18  BEAST_RAID_DEFENDERS=2
AMBIENT_BEAST_PRESSURE=0.45     AMBIENT_BEAST_LIMIT=2
AMBIENT_BEAST_RADIUS=62         AMBIENT_BEAST_INTERVAL=11

# Layer 4 — NPC AI
THREAT_PROVOKED_BIAS=0.55       THREAT_LOCK_BONUS=0.8    THREAT_CROWD_FLOOR=0.35
THREAT_STYLES.archer={wounded:0.5, crowd:0.4,  player:0.7,  backline:0.7,  heavy:1.45}
THREAT_STYLES.scout ={wounded:0.7, crowd:0.45, player:0.85, backline:0.8,  heavy:1.2}
THREAT_STYLES.wolf  ={wounded:0.72,crowd:-0.22,player:1,    backline:0.95, heavy:1.15}
THREAT_STYLES.boar  ={wounded:0.2, crowd:0.15, player:1,    backline:1,    heavy:1}
THREAT_STYLES.{brute,champion,bear,troll}={wounded:0, crowd:0, player:1, backline:1, heavy:1}
MORALE_WOUND=1.6                MORALE_LOSSES=0.7        MORALE_BREAK=0
MORALE_COMMANDER_LOSS=0.35      MORALE_COMMANDER_RALLY=0.45
ROLE_RESOLVE={commander:null, champion:null, captive:null,
              brute:0.45, soldier:0, minion:-0.1, archer:-0.12, scout:-0.18, peasant:-0.6}
MORALE_GROUP_RADIUS=14          MORALE_CHECK_INTERVAL=0.35
MORALE_ROUT_SECONDS=7           MORALE_RALLY_SECONDS=12
MORALE_COMMANDER_SHOCK_SECONDS=10                        MORALE_LAST_STAND_SECONDS=2
MORALE_RALLY_POINT_TOLERANCE=3  MORALE_NOTICE_RANGE=45   MORALE_NOTICE_COOLDOWN=9
ALERT_SIGHTING_RADIUS=20        ALERT_COOLDOWN=1.5
ALERT_INVESTIGATE_SECONDS=12    ALERT_ARRIVAL_DISTANCE=3
FLANK_OFFSETS=[0, 1.15, -1.15, 0.62, -0.62, 0.95]
FLANK_BLEND_DISTANCE=7          FLANK_MAX_ANGLE=1.2
COMMANDER_ORDER_RANGE=18        COMMANDER_ORDER_DURATION=6  COMMANDER_ORDER_TOLERANCE=3.5
CARAVAN_ESCORT_COUNT=2          CARAVAN_ESCORT_RANGE=90     CARAVAN_ESCORT_RESPAWN_DELAY=25
CARAVAN_PANIC_RANGE=16          CARAVAN_PANIC_SECONDS=4     CARAVAN_PANIC_SPEED_MULTIPLIER=1.7
CARAVAN_GUARDED_RANGE=7         CARAVAN_PLUNDER_RANGE=3.4   CARAVAN_PLUNDER_COOLDOWN=55

# Layer 5 — ambient life
AMBIENT_CIVILIAN_LIMIT=3        CIVILIAN_SPAWN_RADIUS=58  CIVILIAN_HOME_RADIUS=16
CIVILIAN_INTERVAL=5             CIVILIAN_MIN_INTEGRITY=25 CIVILIAN_ALARM_RADIUS=12
CIVILIAN_PANIC_SECONDS=4        CIVILIAN_PANIC_RECOVERY=1.5
CIVILIAN_PANIC_SPEED_MULTIPLIER=1.55                     CIVILIAN_MENACE_SECONDS=6
peasant hp=26, speed=3.1
CAMPFIRE_NIGHT_THRESHOLD=0.45   CAMPFIRE_LIMIT=2          CAMPFIRE_GATHER_RADIUS=3.2
CAMPFIRE_SMOKE_INTERVAL=1.4     CAMPFIRE_SEARCH_INTERVAL=3
TORCH_LIGHT_RANGE=26
WILDLIFE_DEER_LIMIT=3           WILDLIFE_BIRD_LIMIT=9
WILDLIFE_SPAWN_MIN_RADIUS=22    WILDLIFE_SPAWN_MAX_RADIUS=54
WILDLIFE_DESPAWN_RADIUS=78      WILDLIFE_INTERVAL=4
DEER_STARTLE_RADIUS=14          DEER_SPRINT_STARTLE_BONUS=7
DEER_BOLT_SECONDS=2.6           DEER_BOLT_SPEED=11        DEER_GRAZE_SPEED=1.5
BIRD_STARTLE_RADIUS=7           BIRD_SPRINT_STARTLE_BONUS=5
BIRD_FLIGHT_SECONDS=3.4         BIRD_CLIMB_SPEED=5.5      BIRD_CRUISE_SPEED=8
CROW_CORPSE_RADIUS=2.6          CROW_CORPSE_DELAY=2.5
AMBIENT_STORM_SLOW=0.22         AMBIENT_STORM_HUNCH=0.22
```

Three of these are worth their rationale. **`PRESSURE_ATTRITION`**: without it the fronts
deadlock — every faction's pressure converges on its own `factionStrength`, so the gap never
reaches `CONTROL_FLIP_MARGIN` and no region ever changes hands until the player has completed
most of the campaign. **`MATERIALIZE_RAID_MARGIN`** is deliberately *below* `CONTROL_FLIP_MARGIN`
so "the player should meet the fight, not the result of it". **`CAMPFIRE_SEARCH_INTERVAL`** is a
determinism bound rather than a performance one, and the only constant here that exists for that
reason: `pickVillagePosition` draws from the shared seeded `event` stream and can fail, so
unthrottled, the draw count would be a function of frame rate.

`AMBIENT_CIVILIAN_LIMIT = 3` sits deliberately under the six-slot `ambient` reserve, because
prowlers and caravan escorts are charged there too. `CIVILIAN_ALARM_RADIUS = 12` is deliberately
*shorter* than a soldier's 15 m sense range, so "a raid arrives before the village empties".
`CIVILIAN_PANIC_RECOVERY = 1.5` is far shorter than `MORALE_RALLY_SECONDS = 12` because "panic
is a reflex, not nerve".

#### The actor budget

```ts
type ActorBudgetCategory = 'squad' | 'campaign' | 'chronicle' | 'ambient'
const ACTOR_BUDGET = { squad: 3, campaign: 8, chronicle: 8, ambient: 6 }
const ACTOR_BUDGET_PRIORITY = ['squad', 'campaign', 'chronicle', 'ambient']  // high → low
```

The four reserves add to `MAX_ACTORS = 25` exactly, asserted in `tests/actorBudget.test.ts`.
`reserve()` is all-or-nothing; `reserveUpTo` grants partial (threat waves, caravan ambushes). **A
category may only borrow from the spare capacity of lower-priority ones.** On shortfall the
allocator calls back into the engine asking lowest-priority categories in order, and the engine
**hands whole located events back to the chronicle before plucking individual fighters out of
one — half a raid is worse than no raid.** `spawnActor` is the hard gate: the `budget` option is
required, and `claimActorSlot` evicts the least important actor rather than let `actors.length`
pass the cap.

A warning attached to this contract: **reservations have side effects.** `reserveActorSlots` can
make lower-priority categories give actors up, so it must be called only once a spawn is
definitely going to happen — never as a cheap pre-filter in a loop.

#### The allegiance matrix

```ts
type Allegiance = Faction | 'beast' | 'civilian'
const ALLEGIANCE_RELATIONS: Record<Allegiance, Record<Allegiance, 'hostile' | 'neutral' | 'friendly'>>
```

A 5×5 matrix that replaced `hostile(a, b) => a !== b`. Implemented with one amendment: the design
said `Actor` would *gain* `allegiance`; in code `Actor.faction` was **replaced** by
`Actor.allegiance` across twenty-one call sites, and the two that need a real `Faction`
(achievement kill stats, faction brand colour) narrow with `isFactionAllegiance()`. The matrix is
symmetric today; a villager is hostile to beasts by the table and still never attacks one,
because `isPacifistRole` gates *behaviour* rather than the table. `tests/allegiance.test.ts`
asserts it is total, symmetric, self-friendly, and that the three factions regard each other
exactly as `a !== b` did. It routes targeting, projectile eligibility, friendly fire, ally
alerting, actor separation, minimap marker colour, the faction ring, and kill attribution.

#### Measured findings

This is the most valuable content in the original spec, and the reason its measurement culture is
called out as an asset elsewhere in this document. Every table below was **counted, not reasoned
forward from the rules**, and in two places the measurement contradicted what the spec's own
earlier draft had claimed.

**Layer 3.** Five seeds, 150 chronicle ticks each (~20 minutes of play), player walking a fixed
loop of settlement squares, night environment. The Layer 2 column is a **negative control** — the
identical simulation with `beastRaid` situations discarded:

| Seed | Beast raids met | Raids off-screen | Settlements burned | Regions captured | Razed |
| --- | --- | --- | --- | --- | --- |
| fauna-1 | 0 → 9 | 13 → 11 | 2 → 1 | 22 → 20 | 2 → 1 |
| fauna-2 | 0 → 3 | 7 → 6 | 2 → 2 | 46 → 39 | 2 → 2 |
| fauna-3 | 0 → 7 | 12 → 13 | 2 → 2 | 28 → 25 | 2 → 2 |
| fauna-4 | 0 → 6 | 15 → 10 | 2 → 2 | 18 → 16 | 2 → 2 |
| fauna-5 | 0 → 3 | 6 → 5 | 1 → 1 | 14 → 14 | 1 → 1 |
| **total** | **0 → 28** | **53 → 45** | **9 → 8** | **128 → 114** | **9 → 8** |

> **"Two of these numbers contradict what this section claimed before it was measured."**

The first draft asserted the two layers were uncoupled, on the evidence that faction raids
*offered* did not move (12 → 12) — a metric far too sparse, since only one of the five seeds
produces faction raids at all. `regionCaptured`, which fires 128 times over the same runs, shows
the fronts measurably slow down: **128 → 114, about 11% fewer captures.** The channel is
`resolveMaterializedBeastRaid` writing `region.lastEventTick`, which `resolveFronts` gates on
through `CONTROL_FLIP_COOLDOWN_TICKS`. That is defensible design — a settlement that just drove
off a wolf pack is not overrun by an army in the same breath — "but it is a coupling, and the
earlier text denied it". Off-screen raids fall the same way, 53 → 45, for the same reason; note
`fauna-3` moves the *other* way, "so this is a tendency, not a law". A third arm in
`tests/beastEncounters.test.ts` offers raids but never hands them back: captures then land on
**128, exactly the Layer 2 number**, attributing the whole effect to the hand-back's write.

**The per-frame AI.** `tests/actorAi.test.ts` re-implements the pre-extraction engine code and
asserts agreement over **~14,000 comparisons**, plus a negative control proving the comparison can
detect a changed implementation. The standing caveat, which applies to every number in this
section:

> **The harness models movement and contact.** No navmesh, collision, steering, separation,
> terrain, wind-up, poise or stagger. Its numbers describe what the decision logic does, not what
> a player experiences. All three answers came out differently from the prediction written before
> the measurement.

**Q1 — does the wolf rout rule change how encounters end?** As shipped it did not, because it
**never fired**: zero routs across 60 fights of `bear+wolf+wolf` and 60 of `troll+wolf+wolf`. Two
local rules collided. A wrecker has 135–165 hp against a wolf's 42, so it always outlived its
escorts and the last one standing was the one role with `routThreshold: 0`; and morale measured
over the *whole* pack could not reach the threshold anyway, since a mixed pack escorts its
wrecker with exactly two wolves and losing one leaves a share of exactly `0.5`, which strict `<`
rejects. **Layer 3's headline beast behaviour was dead content.** Three changes were needed, and
all three: morale became kin-relative; `planBeastPack` sometimes builds pure wolf packs; and
`shouldBeastRout` fires at `<=`, not `<` — "load-bearing, not a rounding preference: without it a
two-wolf escort can never break."

| Composition | Routs | Defender deaths | Beast attacks |
| --- | --- | --- | --- |
| `bear+wolf+wolf` | 0 → 60 | 178 → 117 | 912 → 597 |
| `troll+wolf+wolf` | 0 → 60 | 180 → 106 | 835 → 590 |
| `wolf×3` | 0 → 60 | 60 → 53 | 642 → 586 |
| `wolf×4` | 0 → 120 | 119 → 60 | 1237 → 720 |
| `bear+wolf+boar` | 0 → 0 | 180 → 180 | 899 → 896 |

The last row is not a failure: that pack contains a single wolf, whose kin size is one and whose
share is therefore always `1`. It never had a pack to lose and correctly never breaks.

**Q2 — do beasts spend themselves on faction NPCs instead of the player?** No — "and it is not a
tendency but a **step function**". Standing in the raid, 100% of beast attacks landed on the
player and zero on the garrison; beyond `BEAST_SENSE_RANGE`, zero on the player and 100% on the
garrison. There was no middle. This was recorded as a finding rather than patched, on the grounds
that "a measured 'the current rule is a step function at 21 m' is a better handover than
'targeting could be smarter'."

**Q3 — what does beasts-being-hostile-to-all-three do?** With both arms identical in count,
position and pack and only the matrix entry differing: **player damage 130,881 → 6,658, a 20×
reduction**, and beast deaths 0 → 180. "Without it a raid is an unbounded siege on the player
alone."

**Layer 4.** Both arms are shipped code, 60 fights per arm. The step function is gone —
`bear+wolf+wolf` against a three-strong garrison, player standing in it:

| Arm | On the player | On the garrison |
| --- | --- | --- |
| Layer 3 (`selectCombatTarget`, player first) | 358 | **0** |
| Layer 4 (`selectThreat`) | 3,000 | **600** |

The Layer 3 column is kept as a live control rather than a memory: if it ever stops being exactly
zero, the two arms are no longer measuring what they claim to. With the player watching from six
metres away instead of standing in it:

| Metric | Layer 3 | Layer 4 |
| --- | --- | --- |
| Damage taken by the player | 73,286 | **6,284** |
| Attacks on the garrison | 0 | 183 |
| Beast deaths | 60 | **116** |

**An 11.7× reduction in damage taken, and the raid now resolves.** The second number causes the
first: under Layer 3 the beasts could not be killed by the garrison because they never engaged
it, so a player who stood aside watched an unbounded siege.

Morale on `bear+wolf+boar`, whose single wolf has kin size 1 and cohesion share permanently 1:

| Arm | Routs | By role | Beast deaths | Defender deaths |
| --- | --- | --- | --- | --- |
| Cohesion only (Layer 3) | **0** | — | 117 | 180 |
| Unified (Layer 4) | 240 | wolf 84, soldier 156 | 32 | 156 |

Compositions with real kin still break by cohesion after unification — `bear+wolf+wolf` records
166 cohesion routs alongside 208 individual ones, which is the assertion that would catch
individual morale having quietly *replaced* the Layer 3 rule rather than joining it.

Morale also makes a fight decisive instead of mutually annihilating. Two identical ranks of four
soldiers, 12 m apart: without morale, 2 survivors across 60 fights and 0 routs; with morale, 240
survivors and 242 routs. **Which** side wins is an artefact and is recorded as one — fighters act
in array order, so whoever is listed first lands the first blow of each frame, and swapping the
order flips the result completely (240 elf deaths and 0 guard deaths becomes 0 and 240).
`tests/layer4Ai.test.ts` asserts the swap.

Role preference, three archers behind a brute: nearest-wins put 780 attacks on the archer and 600
on the brute (ratio 1.30); threat scoring put 959 and 478 (**2.01**). Finishing the wounded: both
arms finish the same two enemies on near-identical attack volume (423 vs 425 swings), but
defender deaths fall **60 → 5**.

**Layer 5.** The panic mechanic shipped correct, visible, and completely inert:

| Arm | Attacks on villagers | Villagers killed (of 180) | Lived |
| --- | --- | --- | --- |
| Panic off | 420 | **180** | 0 |
| Panic on, at the shared 1.15× rout speed | 434 | **180** | 0 |

Attacks went *up*. A villager at `3.1 × 1.15 = 3.57 m/s` cannot outrun a wolf at `5.4`. In the
spec's own words: **"This is Layer 3's rout rule again in different clothing"** — a headline
behaviour implemented to spec, reading correctly in the code, firing in every fight and changing
nothing. Three fixes were required: panic had to *track* rather than freeze an `alarmPos`;
`CIVILIAN_PANIC_SPEED_MULTIPLIER` became `1.55`, giving `4.8 m/s`, which loses to a wolf slowly
and beats a bear outright; and the harness needed a despawn. After:

| Metric | Off | On |
| --- | --- | --- |
| Attacks landed on villagers | 420 | **190** |
| Villagers killed (of 180) | 180 | **60** |
| Villagers that escaped the square | 0 | 60 |
| **Villagers that lived, total** | **0 of 180** | **120 of 180** |

**And the finding nobody predicted: scenery was deciding fights.** Three arms, same seeds:

| Arm | Attacks on the garrison | Attacks on beasts | **Beasts killed** |
| --- | --- | --- | --- |
| No villagers in the square at all | 664 | 408 | **1** |
| Villagers, panic off (they stand still) | 649 | 758 | **49** |
| Villagers, panic on (they scatter) | 549 | 618 | **0** |

**Stationary villagers are bait** — 49 beasts killed against 1 in a square with no villagers in
it. "That is scenery deciding who wins a raid, which is precisely what ambient life must not do."
So the strongest argument for civilian panic turns out **not** to be that it saves villagers, but
that without it, adding decoration to a square measurably changes the outcome of the fight in it.

**Browser observations** (non-headless Chrome on `dist/index.html` over `file://`): the world
boots with 25 regions and **no console or page errors in any run**; **58–60 fps** with ambient
life in play at every sample; three `neutral` markers in 60 of 60 samples over 90 seconds,
matching `AMBIENT_CIVILIAN_LIMIT` exactly; villager markers moving 0.46–1.85 map per cent between
samples 1.2 s apart; and **at most 16 actor-bearing markers across every run, against a cap of
25**.

#### Defects the measurements found

Recorded because the pattern is more useful than the individual bugs. Every one of these was
implemented exactly as designed, passed a reading, and was wrong.

1. **`ROLE_RESOLVE` was a `Partial` read with `?? 0`.** `??` fires on `null`, so every "never
   breaks" entry became "breaks like a soldier": commanders and champions routed in 60 fights out
   of 60. The general rule extracted from it — worth keeping — is that **a `Partial` lookup read
   with `??` is a trap wherever the sentinel value carries meaning.** Make the table exhaustive:
   `Record<K, V | null>`, not `Partial<Record<K, V | null>>`. The same shape applies to
   `ALLEGIANCE_RELATIONS`, `BEAST_PROFILES` and `ACTOR_BUDGET`.
2. **The rally-recovery branch was unreachable.** It lived in `updateRoutingActor`, which does not
   run on the frame `routTimer` reaches zero, so an actor that ran its clock out re-broke on the
   same frame and ran forever.
3. **Alert propagation was inert.** `announceSighting` wrote into `aggroMemory` /
   `lastKnownTargetPos`, which is cleared every frame an actor is not pursuing the player — and in
   the one surviving case it *overwrote* that actor's memory of where the player went.
4. **Flanking ranks three and up walked away from the target.** The ladder ran to ±135° and π;
   `cos(135°) ≈ −0.71` gives a negative radial component, so distance grows, `flankBlend` pins at
   1, and the actor recedes forever.
5. **A killed caravan escort was replaced in the same frame**, spawning 2.6 m from the cart and
   inside the 7 m guard radius, so "a cart that is genuinely lost if the guards lose" was
   unreachable through combat.
6. **A rescued captive could never fight again.** `isPacifistRole` listed `captive`, and
   `rescueCaptive` flips `aiMode`, never `role`. Every rescued companion was permanently unable to
   select a target, occupied a squad slot, and soaked damage for the rest of the run. **No test
   covered it, and the 208-test suite passed throughout.** Rule: *pacifism that follows the role
   goes in the role table; pacifism that follows a state belongs to the state.*
7. **Crows built and destroyed themselves every four seconds**, because a crow inherited its
   region from the corpse and `Actor.generatedRegionId` is `null` for the starting squad,
   companions and `defendHome` attackers — suppressing ordinary wildlife spawning the whole time.
8. **A bird that finished fleeing teleported nineteen metres straight down** — flight has no
   ground clamp and the landed branch hard-assigns `y` in one frame.
9. **An unthrottled seeded draw** — `updateCampfires` ran every frame and `pickVillagePosition`
   draws up to twenty values from the shared seeded `event` stream, so **two players on the same
   seed doing the same things at 30 and 144 fps would have desynchronised and got different world
   events.** A determinism bug rather than a cost one.

Two harness corrections are worth keeping for the same reason. Corpses were never aged out, which
permanently depressed `groupShare` and manufactured routs. And a broken non-beast "ran home" from
a rally point it was already standing on — the recurrence being the interesting part:

> **A behaviour whose whole point is disengaging degenerated into standing in the fight not
> fighting** — strictly worse than either real outcome, so it biases the comparison hard and in a
> direction that flatters the arm without the mechanism. The movement model is where this class of
> error lives, it will keep arriving in new clothes for anything that leaves, retreats, avoids or
> keeps distance, and it does not announce itself: it looks like a plausible number.

A third harness correction is the most transferable result in the section, because it is a
**negative control on the measurement itself**. The harness searched for civilian alarms over the
*living* actors while the engine searches `this.actors`, which retains corpses for
`CORPSE_LIFETIME`. Fixing that fidelity gap **raised panic events from 214 to 320 and total
villager displacement from 2,580 m to 8,020 m** — and:

> **The outcome numbers in the tables above did not move at all**, which is the useful part: the
> conclusion did not depend on the fidelity gap.

That is what distinguishes a measurement you can act on from one that merely produced numbers.

#### The determinism caveat

Neither environment input is random and neither depends on a display setting. `nightFactor` is
`computeNightFactor(elapsed)`; `stormFactor` is the rain-plus-snow share of a weather mix that
always lerps toward the biome under the player. `dynamicDayNight` and `weatherEnabled` gate
**rendering only**, and `tests/worldEnvironment.test.ts` asserts a byte-identical chronicle
history across all four toggle combinations, with a negative control so the assertion cannot pass
vacuously. `weatherRng` — the one `Date.now()` seed in `GameEngine` — feeds `randomWeatherRange`
only, which times cosmetic lightning and thunder, and never reaches the weather mix or the
chronicle.

What does still track the player, quoted because the strategy sections below depend on it:

> **The weather mix is a per-frame lerp, so `stormFactor` depends on the route walked and on frame
> pacing. A chronicle history therefore replays exactly for a given seed *and* playthrough, not
> across arbitrary playthroughs of the same seed.** That is inherent to anything that reacts to
> where the player walks. `tickChronicle()` itself is pure and is asserted to be bit-identical for
> a fixed seed and environment sequence in `tests/chronicle.test.ts`.

#### Edge cases worth keeping

Fog of war hides events in undiscovered regions but does not stop them; discovering a region
reveals its current state, not its history. The chronicle never flips control of, or burns a
settlement in, a currently-simulated region — Layer 2 materializes it instead — though beast
pressure still accumulates there. Campaign anchors are protected: `faction-start` and
`final-stronghold` sites are never destroyed and their regions never flip, and `WorldValidator`
asserts every mapped start and finale region is in `getChronicleProtectedRegionIds`, so weakening
the list breaks the 500-seed campaign test. The chronicle stops ticking when the run ends, and
ticks are atomic within one `update()` call.

`defendHome` had a regression worth remembering: it could never fire in generated mode, because
it selected from `villageHouses`, which only the deleted legacy builder populated. It now targets
the nearest generated `settlement` site within `DEFEND_HOME_MAX_DISTANCE`.

A wolf pulled 20 m from its pack breaks as readily as one whose pack is dead, because
`beastPackShare` counts only pack-mates within `WOLF_PACK_RADIUS` — **which makes kiting a real
tactic**. A charge that stops making progress ends there and goes on cooldown. A civilian can
never block an objective: villagers spawn `objectiveEligible: false`, `squadEligible: false`,
hold no site, and `killActor` returns before the reward path. A villager caught between two armies
is alarming but never targeted, because the three sides are `neutral` to civilians — "only beasts
and the player can actually kill one … the meme's factions rob korovans, they do not hunt
peasants". Panic terminates three ways: the alarm walks away, the villager is killed, or it
strays past `CIVILIAN_SPAWN_RADIUS + CIVILIAN_HOME_RADIUS` from the player and is despawned by the
next headcount.

#### Deliberately left undone

Quoted verbatim, "so a reader does not go looking for them":

- **Villagers have no dialogue, no shop, and no interaction prompt.** They are scenery that
  bleeds, not NPCs. Giving them a prompt would make every village a menu.
- **Wildlife cannot be hunted.** Deer and birds are props with no hp, which is exactly what makes
  them free. Making them killable would mean making them actors, and the six-slot reserve would
  then be spent on scenery rather than on the villagers.
- **Villagers are not persisted and do not remember the player.** A village repopulates from
  `settlementIntegrity` on the next visit whatever happened last time.
- **No civilian reputation or crime system.** Killing villagers costs nothing but the line.
- **Feel is not measured.** Whether a village reads as inhabited is the entire point of this layer
  and no number is about it; it was checked by eye in the browser and the spec said so rather than
  inventing a metric.

Two further gaps the spec flagged against itself: **flanking is the one Layer 4 mechanic the
headless harness cannot measure**, so it is asserted as geometry and eye-checked; and **a campfire
was never caught in frame**, because lighting one needs the player alive at night and within
`CIVILIAN_SPAWN_RADIUS` of a site, and five runs died between 54 and 110 seconds. What survives is
an argument rather than a sighting — fires are gated on the same threshold as the torches, which
*were* observed lighting on schedule — "That is weaker evidence than the rest of this list and is
recorded as such."

**Status: shipped, and the only spec in the archive whose 37 acceptance criteria were all checked
before this consolidation.** Independent verification of a sample against the code found no
contradictions; the layer boundaries, budget arithmetic and determinism assertions are pinned by
`tests/chronicle.test.ts`, `tests/materialization.test.ts`, `tests/actorBudget.test.ts`,
`tests/actorAi.test.ts`, `tests/layer4Ai.test.ts`, `tests/aiQuestions.test.ts`,
`tests/beastEncounters.test.ts`, `tests/fauna.test.ts`, `tests/ambientLife.test.ts`,
`tests/allegiance.test.ts` and `tests/worldEnvironment.test.ts`.

**Residual constants, budgets and edge rules the layers depend on.** `MAX_ACTIVE` is now *"one
player-anchored event plus `MAX_LOCATED_EVENTS` located ones"*, with `eventCooldown` at **50–70 s**
scaled by threat tier. `WEATHER_BY_ZONE[biome under the player]` and its sibling live in
`world/WorldEnvironment.ts`. Chronicle prose lives in named tables — `WORLD_EVENT_FAILURE_MESSAGES`
moved out of `describeEventHandback`, and `describeRout()`, `RALLY_NOTICE` and
`describeCaravanPlundered()` live beside it — so the feed's wording is data, not string literals
buried in the engine. Feed toasts clear after **4.3 s** with no history, which is why the collapsible
«Хроника» panel exists at all. NPC-vs-NPC hunt radius is **6.5 m** (15 m for archers). Ambient
prowlers appear above `AMBIENT_BEAST_PRESSURE = 0.45` with `AMBIENT_BEAST_LIMIT = 2`, and raid packs
above `MATERIALIZE_BEAST_PRESSURE`.

**The budget split is the design, not an optimisation.** Ambient life sits on the **`ambient`**
budget so it yields its slot the moment anything real needs it; ambient prowlers are **evicted when a
raid materialises** rather than the cap being breached. Layer 5 was scoped as *the cheapest perceived
value per actor slot* — and the cheapest possible is **zero slots**, which is what four of its five
parts cost: they allocate no actor at all and their props are capped separately. A converted captive
becomes `normal`, moving **from the `ambient` to the `squad` budget** and getting its weapon back.
The panic arm exhausts its frame budget before resolved fights are handled — *"not resolved fights"*
is the deliberate ordering.

**Measured residue.** Menacing ambience came out at **0.60** map per cent per sample against **0.46**
calm. Corpse-aware alarms cost about a **17%** drop against baseline — *"the price of three villagers
running through a fight"*. Birds climb **~19 m** over `BIRD_FLIGHT_SECONDS = 3.4`
(`BIRD_CLIMB_SPEED = 5.5`, `BIRD_CRUISE_SPEED = 8`), and **27 m** of horizontal flight cannot reach a
78 m despawn radius from a 22–54 m spawn — so a bird could never despawn by flying away, and had to
be given an explicit timer.

**Edge rules.** A frozen `alarmPos` — remembering where the villager was when the panic *started* —
is what curves the flight path instead of producing a straight line. Victory or defeat **stops the
chronicle ticking**; it does not keep simulating a world the player has left.
`findPendingMaterializations` used to *discard* pending entries — picking from a smaller set — which is why an early measurement
looked cleaner than it was. If a site really is underfoot, the actor acts somewhere other
than directly under the player.

**The invariants, stated as invariants.** *The dependency runs one way: materialization consumes
chronicle output, never the reverse* — `world/Materialization.ts` reads the chronicle and the
chronicle never reads it back. *The player must never watch a building change state from thin air*,
so materialization happens outside view and the player never watches a building change state from
thin air. Ambient actors are invisible to the campaign: *the objectives do not know they exist —
killing one advances nothing and strands nothing*, enforced through `killActor`. A crow **can never
end up circling an id nobody holds**. And the two acceptance criteria that bound the whole layer:
**beasts never change who holds a square, and 500 seeded campaigns remain completable**; *a civilian
can never block or strand a campaign objective*, again across 500 seeded campaigns, with
`WorldValidator` asserting it.

**Named failure modes, kept because they were found the hard way.** *"Panic that never ends"* — a
villager re-panics while its own alarm is still present, a feedback loop rather than a bug in the
panic itself. An attacker with **no queue to rank against fell through to the *player's* queue**,
which is how a bird's expired timer produced a wrong result. And `tests/materialization.test.ts`
once **asserted a thing never appeared** — an assertion that had to be inverted once it did.

**Two rules about rules.** Any config value that encodes an opt-out — *"no threshold", "never
spawns", "not eligible"* — should be expressed that way in the table rather than as a magic
sentinel. And the counterfactual discipline: *the counterfactual was written to check that villagers
do not **defuse** a raid* — that is, to test for the thing ambient life must **not** do. Scattering
puts the effect back: **0 against the empty-square baseline**.

**Alarm and morale constants, written out.** `ALERT_SIGHTING_RADIUS = 20` with `ALERT_COOLDOWN = 1.5`
unchanged; `CIVILIAN_ALARM_RADIUS = 12` is **shorter** than a soldier's 15 on purpose, so civilians
raise alarms later and less reliably than trained troops. `MORALE_LOSSES = 0.7` is what the design asks for, and it is what puts a hurt squad's state into
morale terms rather than leaving it to teammates' guesswork, and it puts "half
your health gone" into morale terms. Saves are `ActiveRunSaveV3` (`ACTIVE_RUN_SAVE_VERSION = 3`); the storage key is
unchanged and the storage shape is versioned with it.
`WorldSite.owner` is static blueprint data: site ownership has no runtime entity behind it, which
is why the chronicle had to invent one. Of the implementation work, the simulation layers **were the
bulk; the feed and map overlays were
the fiddly bits**.

**The remaining rules, kept because each was a bug or a near-bug once.** The chronicle clock is the
same clock `GameEngine` uses to drive rendering, so simulation and **visuals** never diverge; it also
times cosmetic lightning **flashes** and thunder claps, which is why turning the day/night **cycle**
off for performance must not put out every fire in the world. `reserve(category, count)` is
all-or-nothing and returns whether it **succeeded**, and an actor spawned by an event must be
**re-categorised** or it eats that event's budget for the rest of the run. **Budget starvation** is
the named failure: a located raid holding all eight chronicle slots must not lock the others out. A
hand-back **must not re-decide** a fight the player watched end. **Campaign safety**: `faction-start`
and `final-stronghold` sites are excluded outright, so no objective a campaign **might** need can
leave the map through a morale check — a `defendHome` regression found in **Phase** 0 is why the rule
is explicit.

**Beasts and ambient life.** The `boar` (70 hp, mid poise) is a **Charger** that winds up over
`BOAR_CHARGE_WINDUP` and can be **side-stepped**; it cannot steer **mid-charge**, so a charge into
scenery is a real outcome rather than a bug. A crow cannot settle on a body that gets up, because
corpses do not **revive**. A `captive` is **not a combatant** — the rescue event owns its behaviour —
and Layer 5 **confirmed** that a villager is hostile to beasts by that point. Escorts run for the
**treeline** and lose the cart when the escort loses, and the escort costs nothing at all when the
player is **nowhere** near it. Beast kinds were extended to a **fifth**, and the Layer 2 test that
asserted one could never appear had to be inverted. **Trudging** movement routes only to an alert,
never to a pursuit, an attack approach or a beast. A hand-back that is never reached cannot be
**tallied** against one of the three side outcomes. Threat waves fire only inside
`THREAT_WAVE_EVENT_RADIUS`, so **distant** work is not counted. Destruction is measured when the
**homestead** is destroyed, which says nothing about how many defenders survived.

**Two honest limits.** The bird slot bound is `±66°` and `tests/actorAi.test.ts` asserts every slot
has a **positive** in-range value; the offset **rotates** rather than being re-picked, which is what
makes the bound load-bearing. Layer 3 shipped with three behaviour claims deliberately left
**unmeasured**. And the general rule, which **matters** more than the bug that produced it: `??`
cannot distinguish an intentional `null` from an absent key, so a table's `null` produces not a
visual **wobble** but a campaign that cannot be completed. The surviving evidence is *not* the step
function surviving — it is `evaluatePlayerPursuit` **saying** so.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Region streaming` → 1 / 3 / 3 / 25 · `Actor budget` → 25 · `Events` → 50 / 70 ·
`Threat waves` → 13 · `Actor AI` → 15 / 18 / 6.5 / 15 · `Ambient life` → 5 · `Hostility` → 5 / 5 ·
`beastPressure` → 3 · `settlementIntegrity` → 2 · `supply` → 1 / 1 · `bear` → 135 / 74 · `troll` →
165 / 88 · `Torches` → 0 · `The storm hunch and slow` → 0 · `fauna-1` → 1 / 0 / 9 / 13 · `fauna-2`
→ 2 / 0 / 3 / 7 · `fauna-3` → 3 / 0 / 7 / 12 · `fauna-4` → 4 / 0 / 6 / 15 · `fauna-5` → 5 / 0 / 3
/ 6 · `Metric` → 3 / 4 · `Damage taken by the player` → 73 / 286 / 6 / 284 · `Attacks on the
garrison` → 0 / 183 · `Beast deaths` → 60 / 116 · `No morale` → 2 / 0 · `Morale` → 240 / 242 ·
`Nearest-wins` → 780 / 600 / 1.30 · `Threat scoring` → 959 / 478 / 2.01 · `Arm` → 180 · `Panic
off` → 420 / 180 / 0 · `Attacks landed on villagers` → 420 / 190 · `Villagers that escaped the
square` → 0 / 60 · `Villagers alive at the end` → 0 / 60 · `No villagers in the square at all` →
664 / 408 / 1.

- `CIVILIAN_ALARM_RADIUS=12` is *shorter* than a soldier's 15 m sense range on purpose.
- 2. **`CIVILIAN_PANIC_SPEED_MULTIPLIER = 1.55`.** Solved against the beast profiles rather than
  chosen: `3.1 × 1.55 = 4.8 m/s` loses to a wolf's `5.4` slowly and beats a bear's `3.4` outright.
- *`CIVILIAN_PANIC_SPEED_MULTIPLIER = 1.55`.** Solved against the beast profiles rather than chosen:
  `3.1 × 1.55 = 4.8 m/s` loses to a wolf's `5.4` slowly and beats a bear's `3.4` outright.
- Actor budget — `ActorBudget` (`world/ActorBudget.ts`) — `MAX_ACTORS = 25` split into reserved
  categories and enforced in one place. Was checked ad hoc at every spawn site.
- Each tick is O(regions + roadConnections) — roughly 25 + 40 iterations of scalar arithmetic.
- `log` is capped at `CHRONICLE_LOG_LIMIT = 40` entries so the save stays bounded.
- The log stores **structured** events, not sentences: the Russian copy is rendered from
  `content/gameCopy.ts` when the view is built, so wording can change without a save bump.
- **A category may only borrow from the spare capacity of *lower*-priority ones.** That single rule
  is what makes `ambient` yield its slots first: it is last in priority, so it has nothing to hide
  behind, while `squad` and `campaign` keep a guaranteed floor.
- `GameEngine` re-derives the ledger from the live actor list on every reservation
  (`actorUsageByCategory`), so it cannot drift out of sync with the scene.
- It is pure — no `THREE`, no scene, no actors, no RNG — so the dependency runs one way:
  materialization consumes chronicle output, never the reverse.
- `beastRaid` was **deliberately not materialized in Layer 2.** It needed beasts, and beasts needed
  §5.3's `Allegiance` matrix — a wolf is not a faction.
- `resolveMaterializedRaid` rolls the winner from the surviving share of each side, flips control
  (never for a campaign anchor), damages the settlement, and logs `regionCaptured` — or, if the
  attackers are spent, `raidRepelled`.
- The same functions run when the player *does* finish the fight, so a raid resolves the same way
  whether or not anybody watched.
- > `factionRaid` satisfies that **by construction, not by design**: it fails when >
  `defenderStrength === 0`, so `resolveMaterializedRaid` rolls `chance(1)` and cannot > disagree.
- The fix is §5B.3's rule that a decided outcome is passed as a decided > outcome, never as live
  survivor counts.
- `hostile(a, b) => a !== b` cannot express wildlife, civilians, or truces.
- `Faction` deliberately stays the three playable sides.
- `boar` — 70 hp, mid poise — **Charger.** Winds up for `BOAR_CHARGE_WINDUP`, then commits to a
  straight line it cannot steer, so it can be side-stepped. Never routs.
- `planBeastPack()` sizes the party from `beastPressure`: most raids lead with a wrecker (a beast
  raid that cannot hurt the settlement is just wildlife), escorts are wolves until the forest is
  loud enough to send boars, and the plan is **trimmed to fit** the actor budget rather than
  refused.
- `beastRaid` was the one situation Layer 2 deliberately refused to fake, and
  `tests/materialization.test.ts` asserted it never appeared.
- Beasts that win chew the settlement and reset pressure to `BEAST_RAID_RESET`; beasts that are
  driven off drop it to `BEAST_RAID_REPELLED_RESET` — lower, because a raid the chronicle resolved
  on its own only fed them.
- Control never changes and no faction's pressure moves, because beasts do not hold ground.
- **Individual morale governs individuals** — including a beast whose cohesion rule can never fire.
  The measured case is `bear+wolf+boar`: one wolf, kin size 1, share permanently 1, so cohesion
  correctly never breaks it (§9 measured 0 routs in 60 fights, and that was the right answer for a
  *cohesion* rule).
- The measured case is `bear+wolf+boar`: one wolf, kin size 1, share permanently 1, so cohesion
- `commander` — He is what rallies everyone else, and a campaign objective can require killing him.
  §7's rule that an objective must stay completable is enforced here, by construction.
- `boar`, `bear`, `troll` — Layer 3 said "never routs" and that is still true. The answer comes from
  `BEAST_PROFILES[role].routThreshold`, not from a second copy of it here.
- Nothing an objective might need ever leaves the map because it lost a morale check.
- `engagementRank` gives a stable rank by actor id — so it does not churn frame to frame, and a
  flanker dying promotes everyone behind it — and `flankApproachAngle` maps rank to a slot.
- *Every slot is inside ±66°, and that bound is load-bearing.** The offset rotates the approach
  *direction*, so anything past a right angle gives a negative radial component: the attacker walks
  away, the distance grows, the blend stays pinned at full, and it never converges.
- A killed guard is not replaced for `CARAVAN_ESCORT_RESPAWN_DELAY`, or the replacement spawns
  inside the guard radius on the same frame and the cart can never actually be lost — see §9.
- It also means the escort costs nothing at all when the player is nowhere near the road: the guards
  are despawned outside `CARAVAN_ESCORT_RANGE` or when the cart's region stops being simulated.
- Rout and rally notices are rate-limited to one line per `MORALE_NOTICE_COOLDOWN` and only shown
  for what is within `MORALE_NOTICE_RANGE` — a rout the player cannot see is a number, not a moment.
- Deer, birds, crows — **props, 0 slots** — The brief said *non-combat* wildlife. A thing that
  cannot be fought needs no hp, no allegiance, no health bar, no threat score and no slot — it needs
  a mesh and a reason to run.
- That split is not an optimization, it is the design.
- It means the six-slot `ambient` reserve is spent entirely on the one thing in the layer that can
  die, and that **nothing Layer 5 adds can ever crowd out a raid** — a deer costs a raid nothing, so
  there is no tension to resolve.
- Layer 5 gives it a body: `ActorRole` gains **`peasant`** — named for what it does rather than
  whose side it is on, so the role and the allegiance do not collide.
- *How many there are is `planCivilianCount(settlementIntegrity)`**, and that is the cheapest thing
  in the layer: it makes a chronicle number the player has never seen legible on the ground.
- They are charged to **`ambient`**, like the prowlers and the caravan escort, so a materialized
  raid takes their slots rather than arriving short.
- 2. **They never pick a fight.** `isPacifistRole` gates `selectThreat` and the retaliation branch
  in `damageActor`.
- *The slow applies to non-combat movement only** — wandering, holding an order, walking to an alert
  — and never to a pursuit, an attack approach, or a beast.
- Killing a villager pays **no gold, no loot and no kill on the counter**, and `recordKill` is never
  reached so it cannot be tallied against one of the three sides.
- **Campaign safety.** `faction-start` and `final-stronghold` sites are never destroyed and their
  regions never flip, so a generated campaign always remains completable.
- **Victory / defeat.** The chronicle stops ticking when the run ends.
- **`defendHome` regression.** Phase 0 found that this event could never fire in generated mode: it
  selected from `villageHouses`, which only the deleted legacy world builder ever populated, and the
  eligibility filter excluded it outright.
- The director's threat waves are suppressed only while a fight is within
  `THREAT_WAVE_EVENT_RADIUS`, so distant world events do not starve it.
- **Reservations have side effects.** `reserveActorSlots` can make lower-priority categories give
  actors up, so it must only be called once a spawn is definitely going to happen — never as a cheap
  pre-filter in a loop that may skip the spawn.
- **Beasts and the campaign.** A beast raid never flips control and never touches faction pressure,
  so no amount of wildlife can make a generated campaign uncompletable.
- **A pack that will not fit.** `planBeastPack` is trimmed to whatever the actor budget granted
  rather than refusing to spawn, but the wrecker is always first in the list, so a squeezed raid is
  a smaller raid and not a toothless one.
- **A wolf with no kin never breaks *by cohesion*.** Cohesion is measured over a beast's own
  species, so a lone wolf escorting a bear has a kin size of one and a share that is always `1`.
- **A commander who breaks would strand the run.** A generated campaign objective can require
  killing a specific commander, so `actorResolve('commander')` is `null` and he cannot rout at all —
  enforced in the pure rule rather than by a check at the call site.
- **A caravan escort that eats a raid's slots.** Escorts are charged to `ambient`, the
  lowest-priority reserve, so a materialized raid takes their slots rather than arriving short
  (§5.1).
- **A civilian can never block an objective.** Villagers spawn with `objectiveEligible: false` and
  `squadEligible: false`, are charged to `ambient` so they are the first thing evicted, and hold no
  site: `isProtectedSite` and the objective graph do not know they exist.
- **A villager caught between two armies.** The three sides are `neutral` to civilians and stay that
  way; a faction raid is alarming (§5D.3 rule 2) but never *targets* a villager, so a village in a
  war zone scatters and survives.
- **Wildlife and the actor cap.** Deer, birds and crows are not actors at all, so no amount of them
  can move `actors.length`.
- Their cost is draw calls and a per-frame loop over at most twelve props, bounded by
  `WILDLIFE_DEER_LIMIT` and `WILDLIFE_BIRD_LIMIT` and despawned past `WILDLIFE_DESPAWN_RADIUS` or
  when their region streams out.
- It terminates three ways: the alarm walks away, the villager is killed, or it strays past
  `CIVILIAN_SPAWN_RADIUS + CIVILIAN_HOME_RADIUS` from the player and is despawned by the next
  headcount.
- Actor count never exceeds `MAX_ACTORS`; ambient actors yield first.
- A wolf pack routs when it breaks; a boar charges and cannot steer; a troll takes a settlement
  apart instead of fighting people.
- `beastRaid` materializes and resolves back into chronicle state, and the Layer 2 test that
  asserted it never could now asserts that it does.
- Cohesion breaks a pack that has lost its own kind; individual morale breaks the lone wolf cohesion
  cannot, and anything hurt, alone, or that has just watched its commander fall.
- Commanders and champions never rout, so an objective that requires killing one can never be
  stranded; a broken non-beast falls back on its rally point and stays in the world, where it can be
  run down or rallied.
- The caravan has an escort that fights for it, bolts when something comes out of the treeline, and
  loses the cart when the escort loses.
- Non-combat wildlife: deer that graze and bolt, birds that flush when the player sprints past,
  crows that settle on bodies and leave with them.
- *None of it costs an actor slot**, so none of it can crowd out a raid.
- Campfires are lit at night with villagers gathered round them, and patrols carry torches after
  dark — from `WorldEnvironment`'s night, not the renderer's, so the day/night toggle cannot put
  them out.
- `tests/beastEncounters.test.ts` pins the explanation rather than asserting it, with a third arm in
  which raids are offered but never handed back: captures then land on **128, exactly the Layer 2
  number**.
- *Q1 — does the wolf rout rule change how encounters end?** As shipped it did not, because it
  **never fired**: zero routs across 60 fights of `bear+wolf+wolf` and 60 of `troll+wolf+wolf`.
- The last row is not a failure: that pack contains a single wolf, whose kin size is one and whose
  share is therefore always `1`. It never had a pack to lose and correctly never breaks — the rule
  is about cohesion, not about being outnumbered.
- The wolf breaks in every fight, all of it through the individual door and none through cohesion,
  and the boar and bear never break at all.
- *`ROLE_RESOLVE` was a `Partial` read with `?? 0`.** `??` fires on `null`, so every "never breaks"
  entry became "breaks like a soldier": commanders and champions routed in **60 fights out of 60**,
  which would have stranded any objective that requires killing one.
- This one had teeth because the sentinel encoded a safety constraint — "this actor may never leave
  the field" — so the failure was not a balance wobble but a campaign that cannot be completed.
- *The rally-recovery branch was unreachable.** It lived in `updateRoutingActor`, which the frame
  `routTimer` reaches zero does not run — so an actor that ran its clock out never got its immunity
  and simply re-broke on the same frame, running forever.
- The harness drives `ActorAi` directly and never touches `GameEngine`, so none of these could show
  up as a number.
- Attacks went *up*. A villager at `3.1 × 1.15 = 3.57 m/s` cannot outrun a wolf at `5.4`, so every
  one of them was caught, and running merely spread the same bites over more ground.
- *The harness needed a despawn**, matching the engine's, or a chase ran to the frame budget and
  "got away" was invisible — the single most interesting outcome of the behavior had no way to be
  counted.
- That is scenery deciding who wins a raid, which is precisely what ambient life must not do.
  Scattering puts it back: 0 against the empty-square baseline of 1.
- The structural argument is stronger than a number anyway: four of the five parts of this layer
  allocate no actor, and the props are capped at twelve.
- Every villager is dead, escaped or safe long before the budget runs out, so the civilian numbers
  above are unaffected — but the beast-side numbers in the second table are from a fight that was
  still notionally in progress, and should be read as a comparison between arms rather than as
  outcomes.
- **The actor cap holds**: at most 16 actor-bearing markers across every run, against a cap of 25,
  with ambient life present throughout.
- `rescueCaptive` frees a prisoner by flipping `aiMode` to `normal`, moving it to the `squad` budget
  and handing its weapon back — it never changes `role`, which stays `captive` for the whole run.
- *A bird that finished fleeing teleported nineteen metres straight down.** Flight integrates
  velocity with no ground clamp — that is what makes it flight — so a bird climbs ~19 m over
  `BIRD_FLIGHT_SECONDS`.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.



### 2. Combat depth — faction abilities and enemy roles

*Formerly `combat-depth-spec.md`. All 8 acceptance criteria were already checked.*

Turns the single-button melee loop into two layers: keep the primary melee attack, add one
signature secondary per faction on RMB / `KeyR` / touch, and differentiate enemy roles so fights
read differently by zone.

| Faction | Ability | Effect | Cost / cooldown |
| --- | --- | --- | --- |
| Elf | **Лесная стрела** | 24 u/s projectile up to 30 u. Damage falls linearly 18 → 10 over travelled distance. The nearest hostile intersected by the swept 0.9 u hit volume is struck; non-brutes have a 25% limb-detach chance. | 15 stamina, 0.9 s |
| Guard | **Стойка щита** *(hold)* | Frontal hits (`dot > 0.2`) deal ×0.15 damage after armour and cannot injure. Movement ×0.5, sprint disabled, stamina regeneration suppressed while 18/s drains. | Requires stamina, 0.4 s after lowering |
| Villain | **Сокрушающий рывок** | Lunges 3 u along aim, then hits every hostile within 4.5 u and a 120° forward arc for `max(damage − arm penalty, 8) × 1.1`; each target knocked back 3 u. | 30 stamina, 3.5 s |

| Role | hp | speed | Behaviour |
| --- | ---: | ---: | --- |
| `scout` | 55 | 4.8 | Melee hit-and-run; retreats for 0.62 s after attacking |
| `soldier` | 70 | 3.7 | Baseline melee |
| `minion` | 70 | 3.7 | Baseline melee, villain faction |
| `archer` | 45 | 3.2 | Maintains 8–12 u, fires every 1.8 s for 7 damage, can target the player or hostile actors |
| `brute` | 130 | 2.6 | 14 damage, takes ×0.5 from frontal hits (`dot > 0.2`), cannot lose limbs |
| `commander` | 150 | 0 | Allies within 10 u get speed ×1.15 and damage +4. Calls one soldier every 25 s, up to four total |

```text
BOW_DAMAGE=18          BOW_MIN_DAMAGE=10     BOW_SPEED=24
BOW_RANGE=30           BOW_COOLDOWN=0.9      BOW_COST=15
SHIELD_MULTIPLIER=0.15 SHIELD_DRAIN=18/s     SHIELD_SLOW=0.5
SHIELD_FRONT_DOT=0.2   SHIELD_RERAISE=0.4
CLEAVE_MULTIPLIER=1.1  CLEAVE_RADIUS=4.5     CLEAVE_ARC=120°  (dot 0.5)
CLEAVE_DASH=3          CLEAVE_KNOCKBACK=3    CLEAVE_COOLDOWN=3.5   CLEAVE_COST=30
ARCHER_RANGE=[8,12]    ARCHER_DAMAGE=7       ARCHER_SPEED=3.2
ARCHER_PROJECTILE=16   ARCHER_FIRE_COOLDOWN=1.8
COMMANDER_AURA=10      COMMANDER_SPEED=1.15  COMMANDER_DAMAGE=+4
REINFORCEMENT_TIME=25  REINFORCEMENT_LIMIT=4                  MAX_ACTORS=25
PROJECTILE_HIT_RADIUS=0.9   guard armour ×0.72   injury chance 11%
```

The primary attack this layered on top of is unchanged and is the baseline every number here is
relative to: **0.52 s cooldown, range 3.6, base damage 26 / 28 / 31 by faction, 13% limb-detach
chance**, with enemy melee at 6–9 damage (commander 10).

All directional combat uses **one canonical aim vector derived from `cameraYaw`**, so the
crosshair, bow, cleave and raised shield agree even while the player is standing still.
All actor damage goes through `damageActor()`, which applies the brute's frontal modifier for
melee, arrows, cleave and actor-vs-actor combat, prevents limb detachment from brutes regardless
of source, applies optional knockback and the world clamp, and routes deaths through
`killActor()` so rewards and objective credit keep their existing attribution. Incoming player
damage goes through `damagePlayer()`, applying guard armour first and then the frontal shield
modifier; melee may injure, archer projectiles never do. The elf ability is unavailable when both
arms are missing, and failed activations spend no stamina and start no cooldown.

Projectiles use light gravity and swept segment/sphere collision to prevent tunnelling; the
nearest eligible hit along each frame segment wins; eligibility is symmetric and faction-based;
friendly fire is disabled; actor projectiles store `sourceActorId` and outstanding shots are
removed when that actor dies.

`spawnPopulation()` **replaces** baseline actors rather than adding an unbounded second set —
guards receive archers and a brute, elves two archers, villains an archer and two brutes; the
initial population stays 16. Reinforcements are limited to four *total* per commander, not four
currently alive.

Desktop RMB and `KeyR` activate only while the canvas owns pointer lock, but the public
`useAbility()` / `setShield()` methods deliberately do **not** require it, so the coarse-pointer
touch overlay works. Guard release is handled by mouseup, keyup, touch pointerup/cancel/leave,
pause, pointer-lock loss, window blur, visibility loss, stamina exhaustion and game end — the
brace cannot become stuck active.

**Status: shipped and verified.** Every constant found in code at `GameEngine.ts:895-948`; role
tables match; `AbilityView` and `createAbilityView()` at `types.ts:218-256`; `MAX_ACTORS` has
since moved to `world/ActorBudget.ts:15`. `SHIELD_RERAISE = 0.4` exists as behaviour but not as a
named constant.

**Two bounding rules.** The actor array has a **lifetime cap of 25 entries including dead actors**,
so corpses consume budget — which is why gore and loot are pooled separately rather than spawned as
actors. Expired, out-of-world, hit and destroyed projectiles **remove and dispose** rather than
accumulating. And the criterion that defines the guard: **guard brace reduces frontal damage only**
and blocks frontal injuries only — it is a facing mechanic, not a damage-reduction stat.

Two budget consequences: the 25-entry lifetime cap includes dead actors **and ambushes**, and
commander reinforcements draw from **only remaining slots**, limited to four total. The guard brace
criterion covers **simultaneous** frontal attacks as well as single ones.

**The role table, bound row by row, because a table of loose numbers says nothing about which role
owns which.** Primary attack: windup `0.52` s, reach `3.6`, arc `26`, damage `28`. `scout` 55 hp,
speed `4.8`, retreats `0.62` s after attacking. `soldier` 70 hp / `3.7`; `minion` 70 hp / `3.7`;
`archer` 45 hp / `3.2`, range `[8, 12]`. `brute` 130 hp / `2.6`, deals 14 damage, takes ×`0.5` damage
from frontal hits (`dot > 0.2`) and **cannot lose limbs**. `commander` 150 hp, speed `0`, deals 10,
rallies at `1.15`. Pickups are `owner = 'player'`.

**Guard — Стойка щита**, held on RMB / `KeyR` / touch hold: frontal hits (`dot > 0.2`) deal ×`0.15`
damage **after armour** and **cannot injure**; movement is ×`0.5`, sprint is disabled, and stamina
regeneration is **suppressed while 18 stamina/s is drained**; it requires stamina and has a `0.4` s
lockout after lowering. Order of operations: armour, then the frontal shield modifier. **Melee
attacks may injure; archer projectiles do not.** The elf ability is unavailable when **both arms are
missing**, and failed activations do not consume anything. The actor array has a lifetime cap of 25
entries **including dead actors**, and ambushes draw from it. Guard brace reduces frontal damage
only, blocks frontal injuries, drains stamina **without simultaneous regeneration**, slows movement,
and **cannot become stuck active**.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Primary attack` → 0.52 / 3.6 / 26 / 28 · `scout` → 55 / 4.8 / 0.62 · `soldier` → 70
/ 3.7 · `minion` → 70 / 3.7 · `archer` → 45 / 3.2 / 8 / 12 · `brute` → 130 / 2.6 / 14 / 0.5 ·
`commander` → 150 / 0 / 10 / 1.15.

- Incoming player damage goes through `damagePlayer()`, which applies guard armor and then the
  frontal shield modifier. Melee attacks may injure; archer projectiles do not.
- **Guard** — **Стойка щита** *(hold)* — RMB / `KeyR` / touch hold — Frontal hits (`dot > 0.2`) deal
  ×0.15 damage after armor and cannot injure. Movement is ×0.5, sprint is disabled, and stamina
  regeneration is suppressed while 18 stamina/s is drained. — Requires stamina, 0.4 s after lowering

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

**Input, UI and save contracts.** Ability and actor combat state are **runtime-derived and not
persisted**, so old saves load unchanged and no migration was needed. Desktop RMB and `KeyR` activate
only while the game canvas owns pointer lock, but the public `useAbility()` / `setShield()` methods
do **not** require it, so the coarse-pointer touch overlay works normally. **RMB context-menu
prevention is scoped to the game container or active pointer lock** — not the whole page — and every
added browser listener is removed on teardown. Guard release is handled by mouseup, keyup, touch
pointerup/cancel/leave, pause, pointer-lock loss, window blur, visibility loss, stamina exhaustion
and game end; the fifth touch action uses **pointer down/up** so the brace is hold-based. The HUD
chip shows **ready / active / cooldown** with a linear meter, and the control ribbon displays
**`ПКМ/R`** plus the faction-specific ability name. Activating a directional ability **rotates the
player mesh toward the canonical aim vector** so the animation and the hit test agree. Bow, arrow,
block and cleave all have distinct audio cues.




### 3. Enemy reactions — telegraphs, poise, death motion

*Formerly `04-enemy-reactions-spec.md`. 10 criteria, all unchecked in the archive.*

Gives every hostile action a readable beginning, contact moment and recovery, plus role-scaled
flinch, poise and stagger, velocity-based knockback, and directional authored death poses. The
spec was explicit that this is **not** only an animation pass: *"readable anticipation requires
delayed contact and therefore changes combat timing."*

| Role | Windup | Recovery | Max poise | Stagger | Telegraph |
| --- | ---: | ---: | ---: | ---: | --- |
| Scout / minion | 0.18 s | 0.18 s | 18 | 0.34 s | weapon pullback only |
| Soldier / captive attacker | 0.26 s | 0.24 s | 28 | 0.30 s | pullback + short ground tick |
| Archer | 0.32 s | 0.20 s | 18 | 0.34 s | bow raise + thin aim line |
| Commander | 0.38 s | 0.28 s | 46 | 0.24 s | double-chevron ground wedge |
| Brute | 0.56 s | 0.42 s | 58 | 0.20 s | large expanding wedge |
| Champion | 0.48 s | 0.36 s | 72 | 0.18 s | aura pulse + large wedge |

The cadence bar was explicit and is the reason this was not treated as an animation pass:
**contact-to-contact time for an uninterrupted soldier must stay within 10% of the previous
behaviour** — *"dodgeability comes from moving contact inside that cadence, not simply lowering
enemy DPS."*

```text
FLINCH_TIME=0.12           POISE_REGEN_DELAY=0.75    POISE_RECOVERY_PER_SECOND=22
STAGGER_IMMUNITY=0.45      KNOCKBACK_DAMPING=11      KNOCKBACK_MAX_SPEED=11
KNOCKBACK_STEER_THRESHOLD=0.8                        LARGE_ROLE_KNOCKBACK_SCALE=0.55
TELEGRAPH_MAX=8            TELEGRAPH_Y=0.055         CONTACT_RANGE_FORGIVENESS=0.35
DEATH_POSE_TIME=0.24       attack cooldowns preserved at 0.8 / 1.15 / 1.3 / 1.35 s
poise damage: normal melee or arrow = dealt × 0.75, cleave = dealt × 1.45
poise reset to maxPoise × 0.7 after stagger
```

**State priority is `dead > stagger > action > flinch overlay > locomotion`.** Flinch may overlay
locomotion or an action pose without stopping their timers; stagger cancels the current action
and movement; death clears everything else.

Starting an action creates an `ActorAction` instead of resolving damage: the role's attack
cooldown is set immediately (measured from action start, with recovery inside it), movement stops,
the actor faces the target, and the anticipation pose and telegraph appear. Contact resolves
**exactly once**: the actor target is re-found by id and must be alive, and must be inside
role-specific contact range plus 0.35 forgiveness; arrows use the live target position if valid,
otherwise the copied one. A failed validation produces a whiff visual and no damage, and the
action transitions to recovery either way.

Death style is chosen once in `killActor()` from copied hit context: cleave or high knockback →
`launchFall`; strong lateral hit → `spinFall`; source in front → `backFall`; otherwise
`sideFall`. The root animates over `DEATH_POSE_TIME` with easing and then freezes — *"This is an
authored procedural collapse, not a ragdoll."*

**Knockback is velocity, not translation.** `actor.knockbackVelocity.addScaledVector(hitDirection,
requestedKnockback × roleScale)`, integrated on X/Z **through `moveCharacter()` using the actor's
own collider**, with frame-rate-independent exponential damping, a clamp to
`KNOCKBACK_MAX_SPEED`, no steering while velocity exceeds `KNOCKBACK_STEER_THRESHOLD`, and blocked
components zeroed on collision. It therefore cannot move an actor outside world bounds or through
a registered wall, and a knockback into a wall damps at the wall rather than accumulating velocity
for a later launch.

**Pose rules**, sampled from the authoritative action timer rather than driving it: anticipation
pulls the weapon arm back and leans the torso away; contact snaps the weapon arm forward; recovery
overshoots slightly and returns; flinch offsets both arms and the head opposite the hit; stagger
lowers the torso and opens the arms. **Role scale changes amplitude, not state semantics.** Poses
use named pivots — head and torso are named in `createCharacter()` rather than found by child
index.

`updateActors()` updates death motion, reaction timers, poise, knockback and the active action
*before* anything continues into targeting and steering, and resolves **at most one contact per
actor per update even if the frame's delta crosses both phase boundaries**. Pause freezes action,
reaction, poise, knockback and death timers.

Ground telegraphs are at most eight pooled flat wedge/ring meshes just above ground, transparent
with depth-write off, whose length equals the validated melee range; the wedge grows during
windup and disappears at contact. Under pool pressure, brute, champion and commander telegraphs
are retained before soldier ticks — **and the pose is always present even when no ground entry is
available**, so the warning never disappears entirely. Archers get one thin line inside the
existing ranged window only: *"It is an aim warning, not a guaranteed projectile trajectory."*

The design corrections are the most reusable part: *"A telegraph with immediate damage is false
information."* · *"Do not let every hit cancel every windup. That creates permanent stun-lock with
the current attack speed."* · *"Do not teleport for knockback."* · *"Do not infer contact from
animation pose. The action timer is authoritative; visuals sample it."* · *"Do not make colour the
only telegraph."*

Telegraph opacity must remain readable **in all four zone ground textures and at night**. Reduced
motion shortens root translation, spin and knockback visual travel by 40% but never
removes windup timing or the ground warning.

**Status: shipped, criteria now resolved as 4 verified / 4 partial / 2 unverifiable.** All six
role tables match code exactly (`actorWindup:4797-4804`, `actorRecovery:4806-4813`,
`actorMaxPoise:4815-4822`, `actorStaggerDuration:4824-4830`); the action lifecycle is at
`:4832-4926`; the telegraph pool at `:1471`/`:5088` with teardown at `:2242`. Cadence tolerance,
wall-pop guarantees, death-hook exactly-once and the browser captures are behavioural claims that
inspection cannot settle. **One deviation found:** the spec says stagger immunity simply blocks a
second break, but `GameEngine.ts:5027` also floors poise at `maxPoise × 0.7` *during* immunity —
an implementation detail that was never in the spec.

**Ownership, pooling and edge cases.** Telegraph targets are held as a `Map<string,
EventPropTarget>` keyed by stable id while an event owns attackable props — deliberately, so nothing
keeps a direct `Actor` or event-prop reference that could become **stale** after removal. AI-vs-AI
targets are likewise looked up by stable actor id, so array removal or reordering cannot repoint an
in-flight attack. The **telegraph pool never exceeds eight** entries and releases them when actors
die or events end; event cleanup hides and releases telegraphs owned by removed actors, and
`destroy()` disposes the pool **through scene ownership** rather than a bespoke pass. Event props can
become invalid during cleanup: an invalid prop action becomes a **whiff and cannot damage a
replacement target**.

Two consequences worth stating plainly, because they are the point of the feature: the player can **escape a melee windup by moving out of range**, or by putting an obstacle between
themselves and the attacker, during the telegraph — that is the readability
payoff — and brutes, commanders and champions apply role resistance, so **knockback cannot be
stacked** into a chain-launch. The spec's own scaling note: if the role timing tables grow further,
extract pure config and types into a separate module rather than widening `GameEngine`.

**Negative controls the spec fixed.** *"Do not add a full actor state machine that replaces
targeting."* · *"Do not use unbounded additive timers"* — action and reaction state are bounded, and
repeated flinches take the **maximum remaining duration** rather than accumulating. Actors receive
stride animation through `animateActorCharacter(actor)`; *do not continue adding positional numeric
parameters* to it, and role timing tables belong in `src/game/combatConfig.ts` — *do not move mutable
Three.js actor state out of the engine*. *"Do not flash the entire screen for enemy windups"* — the
telegraph is local to the attacker. A **captive never starts an attack until its existing AI mode
changes**. The death animation **must not call reward, objective or event kill hooks more than
once**. And the criterion that binds the whole feature: light hits visibly flinch but **do not
cancel attacks**; only a poise break does.

`killActor()` instantly rotates the whole character to **±90 degrees**, lowers Y, rotates the weapon,
hides indicators and emits gore — the death "animation" is a single pose change, not a clip. The
principal risks the spec named for itself were the telegraph timing, **knockback, and event-target
cleanup**.

Four more contracts. `animateCharacter()` **supplies** the stride; do not continue adding positional
numeric **arguments** to it — role timing belongs in config, and moving mutable Three.js actor state
out of the engine is **merely** rearranging, not fixing. *"Do not teleport for knockback"*: the
current **one-step** move can pop an actor through geometry, so knockback integrates instead. Escaping
a windup by moving out of range also covers being blocked by an **obstacle**. Pause freezes
action, reaction, poise, knockback and death timers **with world simulation**, and pause/**resume**
plus save/load must leave no stale action or telegraph.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Animation` → 0 · `Death` → 90 · `ActorActionKind = meleePlayer` · `ActorActionPhase
= windup` · `HitReactionKind = none` · `DeathStyle = sideFall` · `kind = player` · `kind = actor`
· `kind = eventProp` · `Archer` → 0.32 / 0.20 · `Commander` → 0.38 / 0.28 · `Brute` → 0.56 / 0.42
· `Champion` → 0.48 / 0.36 · `reaction = flinch` · `Soldier` → 28 · `Commander` → 46 · `Brute` →
58 · `Champion` → 72 · `reaction = stagger` · `archer = 0.34` · `soldier = 0.30` · `commander =
0.24` · `brute = 0.20` · `champion = 0.18`.

- Animation — Actors receive stride animation only; `animateCharacter(actor.mesh, actor.stride, 0)`
  never supplies an attack value.
- **Do not let every hit cancel every windup.** That creates permanent stun-lock with the current
  attack speed.
- **Do not teleport for knockback.** The current one-step move can pop through a visual reaction.
- **Do not infer contact from animation pose.** The action timer is authoritative; visuals sample
  it.
- **Do not make color the only telegraph.** Pose, ring/wedge shape, timing, and sound carry the same
  warning.
- The player can therefore escape a melee windup by moving out of range.
- If the role timing tables grow further, extract pure config/types into `src/game/combatConfig.ts`;
  do not move mutable Three.js actor state out merely to reduce line count.
- Event props can become invalid during cleanup.
- Actor arrows spawn once at contact.
- Light hits visibly flinch but do not cancel attacks; poise breaks cause bounded,
  immunity-protected stagger and can cancel windups.
- Knockback integrates through existing collision and cannot pop actors through walls or world
  bounds.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 4. Comic hit language

*Formerly `02-comic-hit-language-spec.md`. 10 criteria, all unchecked in the archive.*

Every successful player attack communicates where contact occurred, how much damage landed,
whether it was ordinary, heavy, blocked or lethal, and which attack produced it — through pooled
world-space damage numbers, cached Russian onomatopoeia callouts, pooled impact rays, one weapon
trail and tightly bounded hit stop. No DOM update per hit.

```text
DAMAGE_NUMBER_MAX=24     DAMAGE_NUMBER_LIFE=0.72   DAMAGE_NUMBER_DISTANCE=30
NUMBER_MERGE_WINDOW=0.09 CALLOUT_MAX=10            CALLOUT_LIFE=0.46
CALLOUT_COOLDOWN=0.12    IMPACT_RAY_MAX=16         IMPACT_RAY_LIFE=0.18
HIT_STOP_NORMAL=0.028    HIT_STOP_HEAVY=0.048      HIT_STOP_LETHAL=0.064
HIT_STOP_CLEAVE=0.058    HIT_STOP_BLOCK=0.024      HIT_STOP_REDUCED_MAX=0.020
canvas 256×128, number scale-up 80 ms, rays expand 0.4 → 1.8 u and fade in 180 ms
callout chances: normal melee 22%, heavy 70%, lethal 100%, blocks 45%
```

The stop table in milliseconds, which is how the spec expressed it: normal direct-player
melee or arrow **28 ms**, heavy **48 ms**, lethal **64 ms**, cleave **58 ms once**, shield block
on the player **24 ms**, and AI-vs-AI or a miss **0 ms**. The combined text and ray systems are
budgeted at **≤50 visible sprites**, and `loop()` clamps raw delta at **0.05 s** before any of it
is consumed. The reduced-motion cap is **20 ms**. Existing budgets it has to coexist with are
sparks 48, gore 180 and decals 72. The acceptance bar was that hit-stop duration stay stable at
**30 / 60 / 120 fps** while camera rendering and audio continue.

Weight is `blocked` for a shield block, `lethal` for a kill, `heavy` for a cleave **or** damage
≥ 22% of the target's max HP, otherwise `normal`; priority runs `lethal > blocked > heavy >
normal`. Callout words are `'БАЦ!' | 'ХРЯСЬ!' | 'БУМ!' | 'БЛОК!'`.

```ts
type AttackKind = 'melee' | 'cleave' | 'arrow' | 'allyMelee' | 'actorArrow'
type HitWeight  = 'normal' | 'heavy' | 'lethal' | 'blocked'
interface DamageResult {
  applied: boolean; dealt: number; killed: boolean; weight: HitWeight
  position: THREE.Vector3; direction: THREE.Vector3
}
interface CombatFeedbackEvent extends DamageResult {
  attackKind: AttackKind; targetId: string | 'player'; directPlayerAction: boolean
}
```

`presentCombatFeedback(event)` is the single fan-out point for numbers, callouts, rays, audio
requests and camera accents — *"an internal method, not a general event bus."* Classification
changes presentation only and must never increase damage, detach chance, rewards or objective
credit.

Two rules carry most of the polish. **Coalescing:** the same target hit again inside
`NUMBER_MERGE_WINDOW` merges **only when the attack kind is the same** — damage adds to the
displayed value, lifetime restarts at ≤70%, and weight upgrades but never downgrades. Cleave
targets stay separate because their positions differ, and projectile and melee impacts never
merge. **Hit stop takes the maximum, never the sum:** for a cleave, every `DamageResult` is
collected and presented, then **one** stop is requested using the highest weight. A missed attack
produces a trail but no stop, number, callout or ray.

The loop reads and clamps raw delta, consumes up to that much from `hitStopRemaining`, passes only
the remainder to gameplay `update()`, always updates the camera and renders, and ages hit text
only with gameplay time so the contact frame stays visually frozen.

Design corrections worth keeping: *"Do not call a high random damage roll a gameplay critical hit.
There is no crit system."* · *"Do not put damage-number state in `GameView`. A cleave can hit
several actors inside one 90 ms UI throttle window."* · *"Do not freeze the `AudioContext` for hit
stop."* · *"Do not add stop time once per cleave target."* · *"Never call `setTimeout` for effect
expiry."*

**Lifecycle and edge cases.** `updateComicHitFx(delta)` runs inside the active simulation update,
after particles. Pausing, ending, returning to the menu or losing focus sets `hitStopRemaining = 0`
and hides every active number, callout, ray and trail; **world FX do not age while paused**.
Acquiring a pooled number clears the old canvas before drawing and resets texture, opacity, scale,
rotation, velocity, priority and timers. Pool objects stay in the scene until teardown; canvas
textures are disposed once, and the shared callout and ray textures live in `generatedTextures`. A
target killed by the same hit produces **one** result, not a separate death event; a brute's frontal
mitigation is reflected in the number and weight shown; a block shows `БЛОК!` with block colour,
chip damage and no blood callout; damage rounding below one displays `1` only if positive, and zero
damage displays `БЛОК` rather than a fake number; if a target dies mid-cleave, later logic must not
acquire a second effect for it; and after a long tab suspension the delta clamp applies so hit stop
cannot exceed its requested wall-clock duration.

Accessibility: **when the existing screen-shake preference is disabled or reduced motion is
preferred**, hit stop is capped and drift removed rather than the whole language being switched off.
Weight is encoded by size, backing silhouette, word and colour — never colour
alone. Reduced motion caps every stop at `HIT_STOP_REDUCED_MAX`, removes lateral drift and uses
scale and fade only. Numbers bias away from the central 8% of the viewport so they cannot cover
the crosshair.

**Status: shipped, criteria now 8 verified / 2 unverifiable.** All eleven constants at
`GameEngine.ts:1026-1041`; the type set at `:758-773`; cleave's single-stop path at `:5244-5278`
→ `presentCleaveFeedback:12495` → `requestHitStop:12527`; callout probabilities at `:12769-12776`;
weapon trail at `:1542`/`:2014`. Frame-rate stability and the browser stress check remain
unverified.

**Negative controls the spec fixed.** *"Do not allocate a new canvas or texture for every number"* —
pool a fixed set. *"Do not show text through the whole map"*: local-player feedback is local.
*"Do not sample historical blade positions or allocate trail segments per frame."* *"Do not create a
generic effect framework"* — extract `ComicHitFx.ts` only after the behaviour is working. Extend the
existing `damageActor` options with `attackKind` rather than adding a parallel path. **Never spawn
more than one callout in `CALLOUT_COOLDOWN = 0.12` seconds.** Numbers display **rounded
post-mitigation** damage, never pre-mitigation. If a target dies during cleave iteration, later logic
must not acquire a second effect for it.

**Pools and their pressure rules.** Pooled impact-ray sprites and one player weapon-trail visual: pool **ten** impact-ray sprites
sharing one cached transparent
radial-line `CanvasTexture` and material configuration, plus one player weapon-trail visual. Reuse
the **lowest-priority oldest active entry only when the pool is exhausted**, and a reused entry
**restarts at no more than 70% of full lifetime** so a recycled sprite cannot look newer than a live
one. If the same target receives another eligible hit inside `NUMBER_MERGE_WINDOW`, the numbers merge
rather than stacking. After pool warm-up, a **25-actor fight must create no new meshes**. A kill produces one lethal result, one number, and at
most one callout. Under the
existing screen-shake-off or reduced-motion preference, **cap all stops at 20 ms**; a later dedicated
`combatMotion` setting may supersede that. `damageActor` returns a **non-applied result when the
target is already dead**. **Callouts are decorative.** Missing one due to pool pressure **cannot** hide information the player
needs. And the scope check the spec set on itself: if the implementation makes
`GameEngine.ts` materially harder to navigate, extract `ComicHitFx.ts` — *after* the behaviour works.

**Eight remaining rules.** Damage numbers are **engine-owned**, pooled and world-space, not React
state. Sparks are capped at 48, gore at 180 and decals at 72, with ordinary hits keeping the
**faction** burst. *"Do not add stop time once per cleave target"* — a **multi-target** cleave
requests one stop. *"Do not allocate a new canvas or texture for every number"* — pool a fixed set of
**canvases**. Local-player feedback is deliberately **limited** in range rather than shown through the
whole map. Extend `damageActor` with `attackKind`; do not add another **positional** parameter. Rays
do not cast **shadows** and stay below number and callout render order. The trail is a **milestone**
of recent pivot positions rather than sampled history. Crosshair avoidance projects a **candidate**
position and biases it away. Missing a decorative callout under pool pressure cannot hide anything
**required**. When the tab **resumes** after a long suspension the delta clamp applies. If the
**source** or target is removed before an FX update, sprites continue on their last known transform
rather than snapping. Misses and AI-vs-AI impacts neither freeze the local game nor **fabricate** a
result, and the weapon trail **follows** the player weapon pivot and hides on pause or end.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Loop` → 0.05 · `UI cadence` → 90 · `Combat FX` → 48 / 180 / 72 · `depthTest =
false` · `depthWrite = false` · `toneMapped = false` · `ComicCallout = БАЦ!` ·
`pendingCleaveHitStop = 0` · `Heavy direct-player hit` → 48 · `Lethal direct-player hit` → 64 ·
`Cleave with one or more hits` → 58 · `Shield block on player` → 24 · `AI-vs-AI or miss` → 0.

- **Do not put damage-number state in `GameView`.** A cleave can hit several actors inside one 90 ms
  UI throttle window.
- **Do not freeze the `AudioContext` for hit stop.** Pause only gameplay simulation; audio
  transients and rendering continue.
- **Do not apply hit stop for every AI-vs-AI hit.** Only direct local-player impacts may freeze the
  local simulation.
- **Do not add stop time once per cleave target.** A multi-target cleave gets one bounded stop using
  the heaviest result.
- **Do not show text through the whole map.** Local-player feedback is limited by distance,
  lifetime, and pool priority.
- Extend the existing `damageActor` options with `attackKind`; do not add another positional
  argument.
- Pool ten sprites sharing those textures/material configurations.
- Damage numbers always appear when an eligible direct-player result can acquire a pool entry.
- If the same target receives another eligible hit inside `NUMBER_MERGE_WINDOW = 0.09` seconds,
  merge only when the attack kind is the same:
- When the existing screen-shake preference is disabled or reduced motion is preferred, cap all
  stops at 20 ms. A later dedicated `combatMotion` setting may split these controls, but another
  toggle is not required for milestone one.
- If the implementation makes `GameEngine.ts` materially harder to navigate, extract `ComicHitFx.ts`
  after behavior is working.
- The combined text/ray system may have at most 50 visible sprites.
- No more than one trail mesh exists. After pool warm-up, a 25-actor fight must create no new
  sprite, canvas, texture, material, or trail geometry.
- Do not cover the crosshair: project a candidate position and bias it away from the central 8% of
  the viewport when practical.
- Callouts are decorative. Missing one due to pool pressure cannot hide required damage or block
  information.
- A target killed by the same hit still produces one result; do not emit a normal event and a second
  death event.
- If the source or target is removed before an FX update, sprites continue from copied positions and
  retain no object reference.
- Misses and AI-vs-AI impacts do not freeze the local game or fabricate callouts.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

**Visual and motion contracts.** Pooled sprites use `depthTest: false`, `depthWrite: false` and
`toneMapped: false`, on a device-independent **256×128** canvas texture so text is identical across
pixel ratios. Numbers spawn at a **role-scaled head offset** with a **deterministic alternating**
left/right displacement — not random — so two simultaneous hits never stack. Motion is
**float, drift, hold, then shrink**, aged on gameplay time. Callouts get a **starburst backing**, and
a cleave callout is placed at the **centroid** of the attack rather than on one victim. Impact rays
take their tint from the damage kind, cast no shadows, and sit **below** number and callout render
order. The weapon trail is a **pale centre with a faction-coloured edge**.

If the source or target is removed before an FX update, the sprite **continues from its copied
position and retains no reference to the removed object** — the copy is the point, because holding
the object would resurrect it. Legibility was specified to be checked against the four hardest
backgrounds this game produces: **snow-bright palace stone, dark forest, red gore and the night
sky**.




### 5. Combat juice — shake, vignette, sparks, decals, gore

*Formerly `combat-juice-spec.md`. 13 criteria, all unchecked in the archive — the largest single
block of the 113.*

Five bounded feedback layers: short camera impulses on meaningful local impacts, a red damage
flash with a low-health edge treatment, sparks on blocks and cleaves, recycled blood and scorch
ground decals, and deliberately excessive low-poly gore. Arcade-cartoon, not realism.

```text
SHAKE_POS=0.22        SHAKE_ROLL=0.012      SHAKE_DECAY=2.1      SHAKE_FREQUENCY=24
TRAUMA_CLEAVE=0.42    TRAUMA_BLOCK=0.08     TRAUMA_DEATH_MAX=0.16  TRAUMA_DEATH_RANGE=12
FLASH_MIN=0.25        FLASH_MAX=0.85        FLASH_BLOCK_MAX=0.12   FLASH_DECAY=2.4
LOW_HEALTH_RATIO=0.25
SPARK_COUNT_BLOCK=7   SPARK_COUNT_CLEAVE=5  SPARK_LIFE=0.24        SPARK_MAX_ACTIVE=48
GORE_HIT=14..30       GORE_PLAYER_HIT=18..36  GORE_DEATH=52/72
GORE_MAX_ACTIVE=180   GORE_GROUND_Y=0.08
DECAL_MAX=72          DECAL_Y=0.025         DECAL_FADE=6
BLOOD_DECAL_LIFE=34   SCORCH_DECAL_LIFE=28  BLEED_FX_INTERVAL=1.25
```

Trauma sources: normal player damage lerps `0.12..0.35` from `clamp(dealt / 20, 0, 1)`; a frontal
shield block is a flat `0.08` and does *not* also apply normal-hit trauma; a cleave that hits at
least one actor is `0.42` **once per activation, not per target**; a nearby direct player kill is
up to `0.08` fading linearly to zero at 12 units; AI-vs-AI kills and cleave misses produce none.
*(The spec is internally inconsistent here — the trigger table says "up to 0.08" for the kill
accent while the constants block says `TRAUMA_DEATH_MAX = 0.16`. Preserved as found rather than
silently reconciled.)* All incoming-hit intensity uses post-mitigation `dealt`, never `baseDamage`.

The camera rule is the load-bearing one. `updateCamera` computes the normal collision-resolved
destination, lerps it into an **unshaken** `cameraFollowPosition`, samples smooth signed noise
from `shakeClock`, scales by `trauma²`, adds the offset — and then passes the shaken candidate
through `resolveCameraPosition` **a second time**, because *"'Keep the offset small' alone cannot
support the no-camera-clipping acceptance criterion."*

Decals use a genuine pool: `spawnDecal` reuses an inactive entry, allocates while below
`DECAL_MAX`, and otherwise recycles the oldest active one; at expiry the mesh is hidden and marked
inactive with **no removal or dispose**. `killActor()` spawns one blood decal from the actor's X/Z
*before* the corpse Y adjustment, and bleeding emits at most one particle and one small decal per
`BLEED_FX_INTERVAL`.

**The damage flash takes the maximum, never the sum**: `damageFlash = max(current, newIntensity)`,
scaled from post-mitigation `dealt` — normal hits lerp `0.25..0.85`, a block chip is capped at
`0.12` — and one `emitView(true)` is forced after damage and injury state is final, so the flash
survives the 90 ms view throttle. It decays at `FLASH_DECAY` per second. The vignette renders
**after** `screen-vignette` and **before** HUD and modals, with explicit z-indices so the tint sits
above WebGL but below readable UI.

**Gore composition** is specified rather than left to taste: an ordinary actor hit throws `14..30`
droplets scaled by post-mitigation damage, a player hit `18..36`; a death throws **52 particles
plus 6 chunks**, or **72 plus 10** for large bodies. Every death also lays **one oversized central
pool plus 5–8 satellite splats**, and **one third of airborne droplets and every chunk create a
ground splat on landing**. Deaths throw two or three remaining limbs. Detachment stays cosmetic —
it never alters AI damage, speed, targeting or objectives.

Design corrections: *"Do not add random offsets directly to `camera.position`."* (the next frame's
lerp would feed noise back into follow and drift) · *"Do not use frame-by-frame `Math.random()` for
shake. White noise reads as camera buzz."* · *"Do not claim weapon-clash sparks. No clash event
exists."* · *"Use a real decal pool. Removing and disposing the oldest decal at the cap is a
bounded collection, not pooling."* · *"Do not freeze transient screen feedback on pause. Because
the camera still updates while paused, frozen trauma would shake forever."*

One documented limitation has since been overtaken by the code: the spec noted that *"the current
world navigation surface is flat, so absolute `DECAL_Y` is sufficient"*, and explicitly put slopes
and bridges out of scope. The shipped code has moved past it — decals now use
`groundHeightAt(x, z) + DECAL_Y` (`GameEngine.ts:13299`).

**Status: shipped, criteria now 8 verified / 3 partial / 2 unverifiable.** Constants at
`GameEngine.ts:1010-1070`; low-health treatment at `App.tsx:2111-2117` with `App.css:1477-1492`
and a reduced-motion override at `App.css:4257`; `GameEngineSettings` at `GameEngine.ts:272-286`.
Gore burst counts (14..30 / 18..36 / 52 / 72) exist as behaviour but not as named constants, and
`LOW_HEALTH_RATIO` is likewise unnamed. The second camera collision resolve could not be confirmed
by inspection, and two acceptance bars are measurements nobody has taken: the 25-actor frame-time
budget, and **that the shaken camera settles in a comparable duration at 30, 60 and 120 fps
without crossing tested walls or large props**.

**Accessibility and readability.** The stated goal was to make combat feel more readable and **absurdly impactful** with five bounded
feedback layers. The five layers are deliberately *bounded* rather than
unlimited: shake, vignette, sparks, decals and gore each have a cap, so "more juice" cannot
degrade into unreadability. Under `prefers-reduced-motion: reduce` the low-health pulse animation
is disabled and a static state is shown instead. Spark and gore colours must **remain readable
without bloom** and cross the bloom threshold when bloom is enabled — the effect must not depend on
the post-processing stage being on. Modal layers carry explicit z-indices so the damage tint sits
above the WebGL canvas but below readable UI.

**Pools, budgets and teardown — the numbers the spec bound.** Sparks are emitted for each cleave
target actually hit, subject to a **global active-spark cap** (`SPARK_MAX_ACTIVE`); `createSparks`
only fills available slots rather than overflowing. Blood and chunk meshes stay **at or below 180
active entries** and return to the pool after landing or expiry; decals stay **below 72**, with **no
geometry, material or texture allocation after pool warm-up**. Pool meshes stay in the scene until
engine teardown — a landed gore mesh returns to the pool and is *not* removed from the scene or
disposed during play. The existing scene traversal disposes shared textures once: *"do not add a
second decal-disposal pass"*, and `destroy()` relies on that traversal for pooled decal resources.
Generated canvas textures already live in `generatedTextures`, and `App.tsx` owns the persisted
settings — the juice settings **mirror the bloom pattern**: App state plus a ref, a menu toggle and a
pause toggle, and an engine setter for live changes.

Edge cases: an overlapping weaker hit **cannot dim a stronger flash** (hence `max(current, new)`);
gore is paused consistently with actors and projectiles; and resuming from pause **cannot reveal a
stale red frame or restart a finished emission**. `Particle.mode` was previously only `'smoke'`, so
every particle path had to learn the new variants rather than assuming one.

**Negative controls the spec fixed.** Ordinary hits retain the existing faction-coloured burst — *do
not add a second parallel spark system*. Decal variation comes from `seededRandom`; *do not add
separate texture fields or per-decal textures*. Active decal count must **never exceed `DECAL_MAX`**,
and fire *does not continuously create scorch marks*. *"Do not append another positional boolean to
the already boolean-heavy signature."* Nonexistent weapon clashes **do not emit impact feedback**.
Camera-involved motion **must not create unbounded GPU objects**. And the tuning instruction, which
is really a warning about compounding: *"tune constants together in a 25-actor stress fight; do not
increase them one at a time."*

**The remaining numbers.** Normal player damage lerps the flash **0.12..0.35** from
`clamp(dealt / 20, 0, 1)`. Player hits emit **18..36** droplets (`GORE_PLAYER_HIT`) against
`GORE_HIT = 14..30`, so incoming damage reads clearly in third person. Camera follow state is a
reused `cameraFollowPosition` vector and `trauma` is a plain `0..1` scalar — no allocation per frame,
and `lowHealth` is derived from `view.health / view.maxHealth` rather than stored. `App.tsx` owns the
persisted **music, day/night and bloom** settings and the juice settings join that set through engine setters, so a change applies live; generated
canvas textures already live in `generatedTextures`, so the existing teardown traverses the scene and no separately maintained decal-disposal pass is
needed. Sparks fill only
available slots up to `SPARK_MAX_ACTIVE` — brighter is achieved by variant, not by count — and pools **stop allocating once the pool reaches its observed maximum**. The genuinely risky parts were named in advance: the corrected bleed
cadence, a **genuine recycled decal pool** rather than a pretend one, and stress validation at 25
actors.

**The remaining contracts.** The gore layer is deliberately excessive but **visual-only** — sprays,
chunks and splats never affect simulation. `updateCamera()` lerps toward a collision-resolved
destination **including** the second resolve, which *is* **required**: "keep the offset small" alone
does not prevent clipping. The pattern is **copy**-or-lerp that destination into
`cameraFollowPosition`, never the source. `addTrauma(amount)` clamps accumulated trauma to `1` and is a no-op when shake is disabled,
paused or ended; **`setScreenShakeEnabled(false)` also clears existing trauma**, so turning shake off
mid-fight stops the camera immediately rather than letting the remainder decay. During active
gameplay `shakeClock` advances and trauma decays by `SHAKE_DECAY * delta`. Shake is scaled by
`trauma²` so **repeated** hits do not
drift the camera. `newIntensity` scales from post-mitigation `dealt` with the **shield-block** case
capped separately. The decal pool allocates while below `DECAL_MAX` or **immediately** recycles the
oldest active entry — a **hard** active budget plus an inactive mesh pool. Settings mirror bloom:
App state, a ref, and menu and pause **toggles**. *"Do not append another positional boolean to the
already boolean-heavy **constructor**."* The named risks were the bleed cadence, a genuine recycled
pool, and **lifecycle** correctness under stress.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Bleed FX` → 2 / 10 / 0 · `trauma = 0` · `shakeClock = 0` · `Normal player damage` →
20 / 0 / 1 · `Nearby direct player kill` → 0.08 / 12 · `damageFlash = 0` · `DecalKind = blood` ·
`transparent = true` · `depthWrite = false` · `polygonOffset = true` · `visible = false` · `active
= false` · `GORE_HIT = 14` · `GORE_PLAYER_HIT = 18`.

- const lowHealth = view.health > 0 && view.health / view.maxHealth <= 0.25
- Effects must remain optional where camera motion is involved, must not create unbounded GPU
  objects, and must not invent combat events that the game does not have.
- Particles — `Particle.mode` is currently only `'smoke'`; every particle owns and disposes its
  geometry/material.
- Textures/teardown — Generated canvas textures already live in `generatedTextures`; `destroy()`
  traverses the scene for geometry/material disposal and disposes cached textures separately.
- **Do not use frame-by-frame `Math.random()` for shake.** White noise reads as camera buzz.
- **Do not claim weapon-clash sparks.** No clash event exists.
- `addTrauma(amount)` clamps accumulated trauma to `1` and is a no-op when shake is disabled,
  paused, or ended. `setScreenShakeEnabled(false)` also clears existing trauma.
- 2. copy/lerp that destination into `cameraFollowPosition`, never the shaken pose;
- Scale `newIntensity` from post-mitigation `dealt`.
- Limit active sparks to `SPARK_MAX_ACTIVE`; `createSparks` only fills available slots.
- `spawnDecal(position, kind, scale)` reuses an inactive entry, allocates while the pool is below
  `DECAL_MAX`, or immediately recycles the oldest active entry.
- The existing scene traversal disposes their geometry/material once, and `generatedTextures`
  disposes the two shared textures once. Do not add a second decal-disposal pass.
- `killActor()` spawns one blood decal using the actor's X/Z before the corpse Y adjustment. AI
  kills may leave decals but never add camera trauma.
- Expired or landed gore meshes stay in the scene hidden in `inactiveGoreParticles` and are reused;
  they are not disposed per burst. The existing scene teardown owns final disposal.
- Decal ages and particle life remain inside active `update()`, so world FX freeze while paused
  consistently with actors and projectiles.
- Tune constants together in a 25-actor stress fight.
- Blood/scorch decals fade and recycle; both pool size and active count stay at or below 72, with no
  geometry/material/texture allocation after pool warm-up.
- Blood/chunk meshes stay at or below 180 active entries, return to an inactive pool after
  landing/expiry, and stop allocating after the pool reaches its observed peak.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 6. Camera accents

*Formerly `07-camera-accents-spec.md`. 9 criteria, all unchecked in the archive.*

Restrained FOV envelopes and frame-rate-independent follow damping on top of the existing trauma
shake: a wider view while sprinting, an outward punch on cleave, a small release on jump and
compression on landing, and a short inward emphasis on a nearby direct kill.

```text
CAMERA_BASE_FOV=56     CAMERA_FOV_MIN=52      CAMERA_FOV_MAX=65
SPRINT_FOV_BONUS=4.5   SPRINT_BLEND_DAMPING=6.5
CAMERA_FOV_DAMPING=13  CAMERA_FOLLOW_DAMPING=7.7
CAMERA_ACCENT_MIN=-3.5 CAMERA_ACCENT_MAX=7    CAMERA_ACCENT_MAX_ENTRIES=4
LANDING_MIN_AIR_TIME=0.22                     KILL_ACCENT_RANGE=14
```

| Event | Magnitude | Duration | Notes |
| --- | ---: | ---: | --- |
| Cleave with at least one hit | +5.5 | 0.24 s | One event, not per target |
| Cleave miss | +2.0 | 0.16 s | Swing commitment only |
| Jump takeoff | +1.0 | 0.18 s | Very subtle |
| Landing after ≥ 0.22 s airborne | −1.4 | 0.16 s | Skips tiny curb and frame contacts |
| Shield block | −0.8 | 0.12 s | Complements block trauma |
| Nearby direct player kill | −2.4 max | 0.20 s | Distance-fades to zero at 14 units |

Each one-shot uses `pulse = Math.sin(Math.PI * t)` over `t ∈ 0..1`, and normal melee hits
deliberately do **not** change FOV — hit stop and trauma already cover them.

```
targetFov  = CAMERA_BASE_FOV + SPRINT_FOV_BONUS × sprintFovBlend
           + clamp(Σ sampleAccent(entry), CAMERA_ACCENT_MIN, CAMERA_ACCENT_MAX)
currentFov = damp(currentFov, targetFov, CAMERA_FOV_DAMPING, visualDelta)   clamped 52..65
```

The clamp bounds are also named `FOV_ACCENT_MIN` / `FOV_ACCENT_MAX` where the spec discusses the
sum. The camera itself is unchanged: `PerspectiveCamera(CAMERA_BASE_FOV, 1, 0.1, 240)`. The
acceptance bar for the follow refactor was **comparable settling at 30 / 60 / 120 fps** with no
drift and no change to collision or foliage behaviour.
`camera.fov` is assigned only when the value changes by at least `0.01`. Sprint promotes the
**authoritative gameplay sprint decision** rather than recomputing it from keys, so shift held
without movement, empty stamina, an active shield or a leg injury all correctly suppress it.

The follow refactor matters as much as the accents: the old fixed `lerp(resolved, 0.12)` is
frame-rate dependent, and *"an equivalent damping constant for `0.12` per 60 Hz frame is
approximately `7.7`; tune by capture rather than retaining a frame-dependent special case."*
Accents are aged with **raw** delta, not simulation delta, because the camera renders while hit
stop is active.

**Settings, ownership and accessibility.** Camera motion reuses `screenShakeEnabled` as its single
preference — the label became `Эффекты камеры` with helper text covering both shake and zoom while
**retaining the `korovany-screen-shake` storage key** for compatibility, so existing stored values
keep working. Disabling clears trauma and all FOV state, sets exactly `56`, and updates the
projection immediately; **enabling replays nothing**. The reduced-motion default stays off. Damage
flash, the static low-health treatment, damage numbers, toon shading, loot and audio all remain
enabled — this toggle is camera-only. *"If user feedback later demands separate controls, migrate to
a structured camera setting in a dedicated accessibility change. Do not add two nearly identical
booleans now."* Lifecycle: `setPaused(true)`, `endGame()`, `onWindowBlur()` and disabling all clear
one-shot accents and reset sprint state, and **pause shows base FOV immediately rather than freezing
half-way through a zoom**, with the reset happening *before* the paused frame renders. `destroy()`
needs no camera-specific GPU disposal. The queue is bounded at four entries with an explicit
replacement policy: a new accent of the same kind replaces an active one **only when its magnitude
is larger**, and at capacity the lowest-magnitude oldest entry is replaced **only** by something
stronger. Comfort rules: FOV never encodes required gameplay information, no effect oscillates
continuously except the smooth sprint blend, no camera roll is added beyond the existing trauma
shake, and the HUD stays screen-fixed and must not scale with the WebGL camera FOV at any aspect
ratio.

Design corrections: *"Do not set FOV directly at event call sites."* · *"Do not add FOV impulses
cumulatively without a clamp."* · *"Do not gate only translation shake."* · *"Do not modify camera
distance to simulate zoom."* · and an explicit ownership note that specs 02 and 07 must not both
queue the same cleave or kill event.

**Status: shipped, criteria now 5 verified / 3 partial / 1 unverifiable.** This is the only spec
in the archive whose logic was extracted into its own module: every constant lives in
`src/game/cameraAccents.ts:1-12`, with `sampleCameraAccent:85`, `advanceCameraAccents:91` and
`composeCameraFov:107-111`. Every accent magnitude and duration matches the table exactly
(`GameEngine.ts:5284-5288`, `:3759`, `:3781`, `:12375`, `:12384`). The settings label became
`Эффекты камеры` while **retaining the `korovany-screen-shake` storage key** for compatibility,
exactly as specified.

**Accessibility and comfort — the whole list, because this is the class most easily lost.** The
existing reduced-motion default disables *all* new camera motion. The maximum FOV change is bounded
and no effect oscillates continuously except the smooth sprint blend. No camera roll is added beyond
the current trauma shake. **FOV never encodes required gameplay information.** Sprint FOV stops
promptly when shield, stamina, injury or input ends the sprint. Peripheral distortion is to be
tested at narrow and wide viewport aspect ratios, and the **HUD remains screen-fixed and readable at
minimum and maximum FOV and at common aspect ratios** — it must not scale with the WebGL camera FOV.

Edge cases the spec called out: multiple kills inside one cleave **replace or merge** the same-kind
kill accent and stay inside the negative clamp — they do not zoom once per corpse.

**Lifecycle.** Camera accents must leave **no accumulated drift, no stale pause effect and no
motion when camera effects are disabled** — every accent no-ops when screen shake or camera effects
are off, when paused, or when the run has ended. Pause displays the **base FOV immediately** rather
than freezing halfway through a blend. Pause, end, blur, visibility change and hit stop must not be
able to leave the camera in an accented state. `destroy()` requires **no camera-specific GPU
disposal** — the accents own no textures or targets.

**Negative controls and the damping formula.** *"Do not add FOV impulses cumulatively without a
clamp"* — dense kills would otherwise walk the FOV out of range; multi-target attacks and rapid
kills must never push FOV outside the envelope. *"Do not use fixed per-frame lerp for new camera
behaviour"* — the shipped form is frame-rate independent:

```
currentFov = THREE.MathUtils.damp(currentFov, targetFov, CAMERA_FOV_LAMBDA, delta)
```

At most **`CAMERA_ACCENT_MAX_ENTRIES = 4`** one-shot entries are kept, clamped between
`CAMERA_ACCENT_MIN = -3.5` and `CAMERA_ACCENT_MAX = 7`. A frame that takes off and lands due
to a large clamped delta must not leave residue. `immediate = true` copies position and **clears the
sprint blend and accent state** rather than blending from a stale value.

**Two remaining contracts.** The accent list *"keeps at most `CAMERA_ACCENT_MAX_ENTRIES = 4` one-shot
entries"*, and `immediate = true` copies position **and clears the sprint blend and accent state** together — used
where an instant cut is appropriate, so a teleport cannot smear. **Tab suspension cannot resume with a stale large raw delta**,
because the delta clamp applies before any accent integrates it.

**Six more rules.** *"Do not add FOV impulses cumulatively without a clamp"* — dense kills and
**cleaves** are the case that breaks it. *"Do not gate only translation shake"*: the existing
**camera-motion** preference gates all of it. *"Do not **combine** a large kill zoom with hit stop and
trauma"* — the values were tuned to coexist, not to stack. *"Do not modify camera distance to
simulate zoom"*: FOV changes **preserve** collision behaviour, distance changes do not. Assign
`camera.fov` and call `updateProjectionMatrix()` **only when the value differs**. Camera code must not
**recompute** the sprint decision — it reuses the authoritative gameplay one. Jump input held across
landing cannot **create repeated** takeoff accents, and a frame that takes off and lands inside one
large clamped delta must not leave residue **unless** a new accent is genuinely due.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Camera` → 56 / 1 / 0.1 / 240 · `Follow` → 0.12 · `CameraAccentKind = cleave` ·
`sprintFovBlend = 0` · `isSprinting = false` · `wasOnGround = true` · `Cleave with at least one
hit` → 5.5 / 0.24 · `Cleave miss` → 2.0 / 0.16 · `Jump takeoff` → 1.0 / 0.18 · `Shield block` →
0.8 / 0.12 · `Nearby direct-player kill` → 2.4 / 0.20 / 14.

- currentFov = THREE.MathUtils.damp(currentFov, targetFov, CAMERA_FOV_DAMPING, visualDelta)
- const pulse = Math.sin(Math.PI * t) // t 0..1
- `immediate=true` copies position, clears sprint blend/accents as appropriate, sets base FOV, and
  updates projection once.
- Loop — Camera updates and renders even while gameplay is paused; active simulation owns trauma
  decay.
- **Do not set FOV directly at event call sites.** Queue bounded envelopes and resolve one final
  target each frame.
- **Do not gate only translation shake.** The existing camera-motion preference must also disable
  FOV accents and reset the base FOV immediately.
- **Do not use fixed per-frame lerp for new camera behavior.** The current `0.12` follow blend is
  frame-rate dependent; move it to delta-based damping while touching this path.
- **Do not age accents only in gameplay update.** Camera renders while hit stop is active.
- Normal melee hits do not change FOV. the sibling spec hit stop and existing trauma already cover
  them.
- 4. update camera accents with `rawDelta` only when not paused/ended;
- If user feedback later demands separate controls, migrate to a structured camera setting in a
  dedicated accessibility change. Do not add two nearly identical booleans now.
- Tab suspension cannot resume with a stale large raw delta because clock delta remains clamped and
  transient state was cleared on visibility/focus loss.
- Jump input held across landing cannot create repeated takeoff accents; trigger on `onGround ->
  airborne` transition only.
- Pause, end, blur, visibility changes, and hit stop cannot leave a stale zoom or sprint blend.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 7. Loot spectacle

*Formerly `03-loot-spectacle-spec.md`. 9 criteria, all unchecked in the archive.*

Bonus consumable drops — rarity-coded beams, magnet pickups and reward cards, added while
deliberately preserving the current economy — with beams, rings, magnet pickup and a React reward card,
layered on top of unchanged base kill and event rewards. **No inventory, no equipment, no save
migration** — it reuses the version-1 `gold` / `health` / `damage` fields.

```text
LOOT_DROP_CHANCE=0.30   LOOT_MAX_ACTIVE=20      LOOT_BURST_TIME=0.45
LOOT_FORCE_MAGNET_AGE=15  LOOT_MAGNET_RADIUS=5.5  LOOT_COLLECT_RADIUS=0.8
LOOT_MAGNET_ACCEL=34    LOOT_MAGNET_MAX_SPEED=22  LOOT_TOAST_TIME=2.4
LOOT_Y=0.34             LOOT_DAMAGE_CAP=60
rarity split: common 62% · uncommon 27% · rare 9% · legendary 2%
```

| Rarity | Rewards | Beam | Rings |
| --- | --- | ---: | --- |
| Common | Coins 5..10 | 1.6 u | one smooth ring |
| Uncommon | Coins 12..20 or medicine 12..18 | 2.6 u | one broken ring, slow pulse |
| Rare | Coins 28..42, medicine 24..32, or whetstone +1 | 4.2 u | two rings, alternating scale |
| Legendary | Coins 70, medicine 45, or whetstone +2 | 6.5 u | two rings + starburst |

This is **bonus** loot layered on top of the unchanged base reward — a direct player kill still
grants `12` gold immediately in `killActor()`, or `55` for a commander, and the spec was emphatic:
*"Do not convert mandatory kill gold into missable pickups."*

Eligibility: an ordinary direct-player kill rolls at 30%; a commander direct-player kill is
guaranteed and at least `rare`; champion event success is one guaranteed `legendary` at the event
marker; other event successes give one guaranteed `uncommon` or better. **AI-vs-AI kills never
roll.** Rewards are fixed at spawn and cannot be re-rolled while active, and a dedicated `lootRng`
is used — "do not reuse event RNG sequencing or texture RNG".

Reward application: coins add to gold; medicine heals capped at `maxHealth`, and **at full health
converts to half the amount in gold, rounded up**; whetstone adds damage capped at
`LOOT_DAMAGE_CAP`, with excess converting at **25 gold per unused point**. If damage is already at
the cap, whetstones are excluded from the roll entirely rather than rolled and wasted.

The state machine is `burst → idle → magnet → collected`. Burst spawns at the pre-corpse death
position plus 0.4 Y with a small radial velocity and scales the token 0.2 → 1; idle bobs on a
deterministic phase, **fades the beam in over 120 ms** (`reveal = clamp(idleAge / 0.12, 0, 1)`,
shipped at `GameEngine.ts:10443-10449`, driving beam opacity ×0.32, ring ×0.82 and starburst
×0.95), and **forces magnet at age 15 s regardless of distance**; magnet accelerates toward the
player's chest with a max speed — *"Do not use teleporting lerp coefficients that vary by frame
rate."*

Each pickup is **one vertical beam-plane pair crossed at 90°**, one ground ring, an optional
second ring for rare and legendary, and a small starburst sprite above legendary. Beams and rings
are `MeshBasicMaterial`, `transparent`, `depthWrite: false`, `toneMapped: false`, with geometry
and materials **shared by kind and rarity** — *"Do not create one light per beam."* There is no
per-pickup light and no per-pickup canvas texture.

**Pool pressure never discards a reward.** At 20 active, the oldest active common is settled
immediately and its entry recycled; if no common exists, the oldest lowest-rarity entry is
settled; either way a compact collection card is shown for the settled reward.
`collectLoot(pickup, reason)` applies the reward exactly once by marking the pickup inactive
*before* invoking callbacks, which is what makes collection and save-settlement racing in one
frame safe.

Save behaviour is asymmetric by design: `save()` settles all active pickups first, victory settles
before the final view, but **defeat does not settle** — uncollected bonuses are run-local risk.
**Pause freezes burst, bob, magnet and toast expiry but does not hide beams**; returning to the
menu or destroying the engine clears pickups **without** invoking reward callbacks; and no pickup
or toast is ever serialized.

Reduced motion removes bobbing, rotation and card translation **while leaving beam and ring
opacity and the static shapes intact**, so rarity stays readable without movement. Every rarity
carries a text label and a distinct ring/beam silhouette, so none of it depends on colour or on
bloom being enabled.

The card reports the exact result (`Урон 31 -> 32`, `+18 золота`, `Здоровье 62 -> 80`), takes no
input, and is timed by **engine time** via `lootToastExpiresAt`, because *"Do not schedule React
timeouts that can outlive an engine instance."*

The spec also set an explicit threshold for ever growing this into a real inventory: item identity
and deterministic generation, capacity, comparison UX, shop and salvage economics, a `SavedGame`
v1 → v2 migration with rollback, and stat ownership beyond the current scalar `damage` — *"Do not
smuggle a partial inventory into optional fields on version 1."*

**Status: shipped and among the most faithfully implemented in the archive — 6 verified / 2
partial / 1 unverifiable.** Every constant matches at `GameEngine.ts:857-867`; the rarity split is
exact at `:10275-10283` (`<0.62`, `<0.89`, `<0.98`, else legendary); the four types are unchanged
at `types.ts:129-143`; the dedicated RNG at `:1534`. The `settleActiveLoot('save')` call site
could not be confirmed by inspection, and "never discards a reward" is an invariant no test
asserts.

**Accessibility.** *"Do not use rarity colour alone."* Beam height, ring count, star points, the
label and the audio cue all carry rarity independently, so the tier survives colour blindness and a
desaturated display. Where an icon accompanies a pickup the pickup **remains readable alone** if the
icon is absent. The reward toast uses the same high-contrast panel primitives as existing notices
rather than inventing its own. Reduced motion removes bobbing, rotation and card translation while
keeping beam and ring opacity — the drop stays visible, it simply stops moving.

**Pooling, ownership and the boundary cases.** A **capped runtime pool of 20** physical reward
pickups backs the feature, with **no allocations after the pool and shared resources are warm**. Pool
recycling must settle **before** overwriting `reward`, and the exact reward is fixed when the pickup
spawns and **cannot reroll while the pickup is alive**. Actor count is capped at 25, but corpses and
event objects are not — which is why drops are pooled rather than spawned freely. Event-owned
ordinary enemies **do not independently roll** drops; they follow the event's explicit drop policy,
specifically to prevent an event turning into a loot fountain.

**Engine time owns toast visibility:** store `lootToastExpiresAt` and clear it in the engine, rather
than letting a React timer own it. If the player is dead while a pickup is magnetising, movement
stops and the pickup is left in the world. If a whetstone would partially exceed the bonus cap, the
**usable portion is applied** rather than the whole thing being discarded. Defeat, victory, pause,
return-to-menu and repeated engine creation must all leave no orphaned pickup, toast or pooled
entry.

**Negative controls the spec fixed.** *"Do not create one light per beam"* — emissive/basic meshes
provide the glow, and there is no per-pickup light or texture. *"Do not make loot depend on bloom,
outlines or layered audio"*: the drop must read with every optional visual system off. The reward
card appears **below** critical health and objective information and never occludes them. A direct
player kill already grants base gold, so bonus coins **must not duplicate or replace it** — no double-pay for the same kill. And
the scope fence: *do not extend this system into equipment* until all of the following specified conditions hold.

**The reward tables, since they are the feature's actual content.** Common drops give coins **5..10**; rare gives coins **28..42**, medicine `24..32`, or a whetstone `+1`. Actor count is
capped at 25 **but corpses and event objects are not**, which is the population fact that forces
pooling. A direct player kill already grants base gold, so bonus coins **must not duplicate or replace it** — no double-pay. If the player is dead while a pickup magnetizes, movement stops and the pickup is left in the world
for ordinary cleanup.
Conversion and cap cases apply to the damage fields too, not just to coins. The remaining risk the
spec named for itself: pooling, rarity readability, conversion boundaries and **UI lifecycle**.

**Seven more rules.** Out of scope by name: inventory slots, equipment, item comparison,
**affixes**, and vendors buying back. *"Do not **persist** active world pickups"* — settle them before
saving. *"Do not make loot depend on bloom, outlines or layered audio"*: those **enhance** it when
**present**, and the pickup remains readable alone. Legendary drops are 6.5 units tall with two rings
plus a starburst and a **strong**, capped audio cue. The toast is one view **emission** on clear, with
no React timeouts that can outlive the run. No allocations after the **20-entry** pool and shared
resources are warm. The card sits below critical health and objective information and never
**captures** input. Conversion and cap cases apply to the damage fields **including** the boundary
ones.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Kill reward` → 12 / 55 · `Population` → 25 · `LootRarity = common` ·
`LootRewardKind = coins` · `LootPickupState = burst` · `whetstone` → 25 · `Rare` → 1 · `Legendary`
→ 70 / 45 / 2 · `transparent = true` · `Common` → 1.6 · `Uncommon` → 2.6 · `Rare` → 4.2.

- Kill reward — A direct player kill grants `12` gold or `55` for a commander immediately in
  `killActor()`. Event-owned actors return before this ordinary reward path.
- Population — Actor count is capped at 25, but corpses and event objects remain in the scene until
  their existing cleanup paths run.
- **Do not convert mandatory kill gold into missable pickups.** Objective and economy behavior
  currently assumes immediate credit.
- **Do not call three consumable bonuses an inventory.** The collected reward applies immediately
  and the card describes the state change.
- **Do not persist active world pickups.** Settle them before saving, and let uncollected bonuses
  disappear on defeat/return to menu.
- **Do not spawn a drop for every AI kill.** Only direct player kills and explicit event reward
  moments can roll bonus loot.
- **Do not make loot depend on bloom, outlines, or layered audio.** Those specs enhance it when
  present but the pickup remains readable alone.
- Exact reward is fixed when spawned and cannot reroll while the pickup is active.
- Existing shop behavior is not changed. If current damage is already at or above the cap, exclude
  whetstones from the roll and choose another reward.
- Engine time owns visibility: store `lootToastExpiresAt`, clear it in `update()`, and force one
  view emission on clear.
- The toast uses the same high-contrast panel primitives as existing notices and does not rely on
  bloom.
- Event-owned actors follow the event's explicit drop policy to prevent dozens of event bonuses.
- Collection and save settlement can race in one frame; marking inactive before applying reward
  guarantees exactly-once credit.
- If the player is dead while a pickup magnetizes, stop movement and leave defeat cleanup to clear
- If a whetstone partially exceeds the bonus cap, apply the usable points and convert only the
  remainder.
- Pool recycling settles before overwriting `reward`.
- Pool pressure never discards a reward and active pickups never exceed 20.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 8. Toon shading and selective outlines

*Formerly `01-toon-shading-and-outlines-spec.md`. 9 criteria, all unchecked in the archive.*

Four-band toon lighting on opaque character surfaces plus inverted-hull silhouette shells on
selected meshes. Explicitly **not** a full-screen edge pass — selective, distance-culled and
toggleable.

```text
TOON_RAMP_LEVELS=4               gradient ramp 0.00→0.28, 0.33→0.52, 0.66→0.78, 1.00→1.00
OUTLINE_CHARACTER_SCALE=1.045    OUTLINE_INTERACTABLE_SCALE=1.035
OUTLINE_ACTOR_DISTANCE=38        OUTLINE_INTERACTABLE_DISTANCE=46
OUTLINE_CORPSE_SECONDS=8         MAX_OUTLINED_ACTORS=25
player shell hides when the collision-resolved camera is closer than 2.4 u
regression gate: 2 ms sustained frame time
```

The ramp is a 4-texel `DataTexture` with `NearestFilter`, no mipmaps and `NoColorSpace`. Shells
share source geometry, are parented to the source mesh, and use a shared `MeshBasicMaterial` with
`BackSide`, `depthTest: true`, `depthWrite: false`, `toneMapped: false`. Because they are
parented, limb animation, hiding, corpse poses and weapon animation move the outline with no
per-frame transform-copy pass.

Exclusions are extensive and deliberate: transparent materials, the `faction-ring`,
`userData.noComicOutline`, sprites, points, lines, LOD proxy foliage, particles, gore, decals,
flames, sky and health bars — and a transparent entry anywhere in a material array excludes the
whole mesh. Back-side shells give external silhouettes only, because *"dense internal edge lines …
would become noise."*

The toon ramp deliberately **stays on when outlines are off**: *"The setting is an ink/performance
control, not a full material hot-swap."*

Caveats worth keeping: *"Do not replace every `MeshStandardMaterial` in the scene."* · *"Do not
make bloom responsible for outlines."* · *"Do not add an `OutlinePass` only for this milestone."*
· *"Do not assume a fixed black works in both themes and at night."* · and the performance escape
hatch: *"If the actor stress scene regresses sustained frame time by more than 2 ms on the target
device, first lower outline distance. Do not silently remove the player outline or reduce gameplay
actor count."*

Night must retain at least two visible ramp bands, fixed via night hemisphere intensity or base
colours — **not** per-character lights.

**Settings, ownership and accessibility.** The toggle is `Чернильные контуры` in both the menu and
the pause modal, persisted under **`korovany-ink-outlines`**, defaulting to `true` including on
coarse pointers, with `setInkOutlinesEnabled(false)` hiding every shell immediately and live. It is
not part of `SavedGame`. Ownership is split deliberately: the library owns the gradient texture and
the shared outline materials and is **excluded from generic scene-material disposal**, while toon
materials from `createToonMaterial()` are scene-owned and released by the ordinary traversal;
`destroy()` collects unique geometries and materials into `Set`s first so shared resources are
disposed exactly once, and the outline registry is cleared **after** scene disposal. Shells are
**never** added to `generatedTextures`, never enter raycast or collision lists, and are ignored by
camera-obstacle collection; detached cosmetic limbs must not inherit a second shell from a cloned
mesh; and bindings must not retain detached scene roots. Runtime event props register and
unregister themselves. The budget is the existing **25-actor** population, at most three shared
outline materials and one shared gradient texture, with **zero per-frame allocation** — shells are
created when a binding is made, not per frame. Accessibility: the goal is to give characters and important interactables a bold, readable comic silhouette, so
combatants stay readable against every zone and every time
of day**; faction recognition must never depend
on outline colour, the toggle carries visible text and `aria-pressed`, and reduced motion does not
disable outlines or toon shading. The renderer keeps antialiasing, ACES filmic tone mapping and
exposure `0.92` under a `min(dpr, 1.75)` cap; `setPaused()` does not hide outlines.

**Status: shipped, criteria now 4 verified / 1 partial / 4 unverifiable.** The ramp is
`Uint8Array([71, 133, 199, 255])` = 0.278 / 0.522 / 0.780 / 1.00 at
`ComicMaterialLibrary.ts:51-63`; the eligibility filter with its `InstancedMesh` and transparency
exclusions at `:86-102`; distances as squared constants at `GameEngine.ts:882-885`. The named
constants `TOON_RAMP_LEVELS` and `MAX_OUTLINED_ACTORS` do not exist — their values are inlined.
Bloom-interaction parity, resource-leak freedom and the stress capture are all unverified.

**Negative controls the spec fixed.** *"Do not replace every `MeshStandardMaterial` in the scene"* —
a global swap would flatten terrain and architecture that are deliberately not toon-shaded. Every
shell is marked `userData.comicOutline = true` so later traversal **never outlines an outline**.
Cosmetic actor limbs use the same material helper so they do not look detached from the body.
Shared resources are each disposed exactly once, so repeated start → return-to-menu cycles cannot
double-dispose. The originality rule is explicit and belongs to the project's whole premise: the
look is built from procedural textures and **must not reproduce another game's characters or
proprietary iconography**.

**Two boundary facts.** `BloomPostProcessor` owns the post-processing chain — `RenderPass → UnrealBloomPass`, pass ordering
and resize/disposal — and when bloom is disabled the renderer does a direct render — toon shading does **not** reach into the composer, which is what lets either ship
without the other. The characters are *primitive, pivoted* rigs, and that is the constraint the whole
look is designed around. The outline budget stays bounded at the **existing maximum of 25 actors**.
Edge case: **camera-near shells can intersect the camera**, so the player's own shell must be handled
rather than assumed distant.

**The ownership contract in full, because this is the section where it is easiest to get wrong.**
Scene traversal disposes mesh geometry and materials and `generatedTextures`, which is the
**lifecycle** the library must stay outside of. The library owns one **four-texel** `DataTexture`
gradient ramp and the shared outline materials; those are marked **library-owned** and excluded from
generic scene-material disposal, and `ComicMaterialLibrary.dispose()` **releases** them. Toon
materials **returned** by `createToonMaterial()` are scene-owned — the library must neither retain nor
dispose them, and scene traversal **releases** those unique materials. Outline shells are never added
to `generatedTextures`; that map **remains** for generated textures only. Engine **teardown** clears
the outline registry after scene and resource disposal, and bindings must not retain detached scene
roots **indefinitely**. **Expose** the toggle in menu and pause settings labelled `Чернильные
контуры`.

**Four negative rules.** *"Do not make bloom responsible for outlines"* — outlines are dark and must
**remain** legible with bloom off. *"Do not outline transparent or **screen-facing** objects"*: decals,
particles and sprites are excluded. *"Do not assume a fixed black works in both themes and at
night"* — the outline colour is **semantic**, derived from the palette. *"Do not **allocate** outline
geometry per frame."* Cosmetic limbs use the same helper so they do not look **disconnected**. The
budget is no more than one outline draw per **eligible** opaque source mesh, and the remaining work
named for itself was ownership, distance culling, settings **plumbing** and day/night and theme
tuning.

**Baseline and budget.** The renderer runs ACES filmic tone mapping at exposure `0.92` under a
`min(dpr, 1.75)` cap. `ComicSurface` values include `'cloth'`; outline bindings are keyed by `kind`,
including `'player'`. The budget is stated against the current maximum population — the existing
25-actor cap — and **not** against a hoped-for one.

**The rules, as the spec worded them.** Scene traversal disposes mesh geometry and materials while
`generatedTextures` disposes cached canvas textures, and **several resources are already shared by
multiple meshes** — hence collecting geometries and materials into `Set`s before disposal so shared
resources are disposed exactly once. *"Do not outline transparent or screen-facing objects"*: decals,
particles, sprites, gore, foliage, sky and transparent FX **do not** get outlines; characters and
important interactables do. *"Do not allocate outline geometry per frame"* — shells are created with
their owning mesh. *"Do not add outline shells to `generatedTextures`; that map remains for canvas
textures."* Cosmetic actor limbs use the same material helper so they **do not look disconnected**
from the body. On a weak device, **first lower outline distance** — *do not silently remove the
player outline or reduce it below legibility*. **Faction recognition must not rely on outline
colour**: torso colour, rings and silhouettes carry it. The first goal is to make combatants
**readable against every zone and time of day**. Scene-owned toon materials, shared geometry and
library-owned gradient and outline resources must each be disposed exactly once.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Renderer` → 0.92 / 1.75.

- The target is an original > hand-inked comic-book treatment built from the game's existing
  low-poly geometry and > procedural textures. It must not reproduce another game's characters,
  logos, UI, or > authored assets.
- Renderer — `WebGLRenderer` uses antialiasing, ACES filmic tone mapping, exposure `0.92`, sRGB
  output, PCF soft shadows, and a DPR cap of `1.75`.
- Post-processing — `BloomPostProcessor` owns `RenderPass -> UnrealBloomPass -> OutputPass` and
  falls back to direct renderer output when bloom is disabled.
- **Do not add an `OutlinePass` only for this milestone.** It would force an `EffectComposer` even
  when bloom is off, add full-resolution depth work, and complicate pass ordering and
  resize/disposal. The current primitive, pivoted characters are a good fit for bounded
  inverted-hull shells.
- **Do not outline transparent or screen-facing objects.** Decals, particles, sprites, faction
  rings, sky objects, flames, and foliage transparency will halo or double-blend.
- Do not add outline shells to `generatedTextures`; that map remains for canvas textures.
- Faction recognition must not rely on outline color; torso color, rings, silhouettes, and
  health-bar color remain.
- Camera-near shells can intersect the camera.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 9. Zone art direction

*Formerly `05-zone-art-direction-spec.md`. 9 criteria, all unchecked in the archive.*

A per-zone visual grammar — two dominant hues plus one accent, a hatch motif, a silhouette prop
vocabulary, one landmark, restrained fog tint and a UI accent — so a screenshot is identifiable
before the zone title is read.

| Zone | Palette | Hatch motif | Silhouettes | Composition |
| --- | --- | --- | --- | --- |
| Neutral | Dusty ochre, muted teal, cream | Broad horizontal scrapes | leaning signs, carts, fences, pennants, crates | low, open, irregular skyline |
| Palace | Ivory stone, navy, restrained gold | Orderly chevrons and vertical ticks | standards, shield plaques, clipped pillars, braziers | tall, symmetric, axial to the gate |
| Forest | Deep teal, acid green, warm amber | Curved organic strokes | root arches, hanging pods, carved stumps, crescent lanterns | layered, asymmetrical, framed paths |
| Fort | Charcoal, rust red, bruised magenta | Sharp diagonal slashes | spikes, broken wheels, chains, skull-like notches | heavy, top-loaded, hostile diagonals |

```text
ZONE_BLEND_WIDTH=8       ZONE_TINT_DAMPING=3.5      ZONE_FOG_WEIGHT=0.04..0.10
ZONE_DECORATION_INSTANCES_MAX=94 total (neutral 26, palace 20, forest 22, fort 26)
ZONE_LANDMARK_MESHES_MAX=8 per landmark, ≤32 total landmark draws
HATCH_TEXTURE_SIZE=64    ≤8 new instanced draw calls, no dynamic lights
```

Hatching draws deterministic ink marks into the **same** 64×64 canvas as the base pattern, so
there is no second material and no extra draw call; the seed derives from the texture key, and
shared texture keys must include the profile and motif so two surfaces cannot collide on one cache
entry. Ground, major walls, roofs and signature props are hatched; skin, UI, gore, sky, particles
and transparent effects are not.

The composition order is fixed: `base semantic palette → day/night lighting and sky → weather
modulation → restrained local zone tint → material tone mapping and post-processing`. Zone tint
enters `updateAtmosphere()` only after the day/night colours are computed, is weighted by each
profile's `fogWeight`, damped over `ZONE_TINT_DAMPING`, and **never mutates the day/night
keyframes**.

Decorations avoid roads, spawn circles, beacons, event markers, the palace gate passage, shop
interaction radii and common combat lanes, are non-colliding, and are built once with world
generation rather than created on zone entry.

**Settings, ownership and accessibility.** Zone art has **no user-facing toggle** — it is
unconditional art direction, not a quality setting. On a `view.zone` change the zone-title panel is
keyed by zone so its entrance restarts, `--zone-accent` and `data-zone` are set, and a small CSS
motif rule renders; only the map, current-zone border and prompt accents are tinted. **Health,
danger, success, rarity and faction semantics are never recoloured.** Reduced motion uses a static
fade with no translation. Ownership: the profile factory is built once per engine after the runtime
palette is known, `uiAccent` is a CSS-safe string because *"do not pass `THREE.Color` through
`GameView`"*, `GameEngine` owns one reusable `ZoneVisualWeights` that the writer overwrites in place
so nothing is allocated per frame, and all four decoration sets are built with world generation —
nothing is created or removed on zone entry. Teardown clears `zoneDecorationSets`. Version-1 saves
load unchanged. Budgets: **≤94 decorative instances total**, ≤8 new instanced draw calls, ≤32
landmark mesh draws, at most one medium landmark per zone, and **no dynamic lights**.

Caveats: *"Do not solve zone identity by saturating ground colours."* · *"Do not add four
independent fog systems."* · *"Do not change gameplay `zoneAt()` to make visual transitions
smooth."* · *"Zone tint is supporting glue, not a full-screen filter."*

**Status: partially shipped — and this is one of two places where the archive was actively
misleading.** The profiles, fog tint and damping are real: `createZoneArtProfiles` at
`GameEngine.ts:1255-1296`, `ZONE_TINT_DAMPING = 3.5` at `:1071` used at `:11498`, and per-zone
`fogWeight` values of 0.055 / 0.045 / 0.075 / 0.09 all inside the specified 0.04–0.10 band. The
per-zone UI accents and motifs shipped as an expanded `ZONE_INFO` metadata type in
`types.ts:449-468`
(`#c48742`/`scrape`, `#547ac4`/`chevron`, `#5b9d54`/`organic`, `#b75b70`/`slash` — note these hex
values are code decisions; the spec named no hexes).

**But border blending was never implemented.** `writeZoneVisualWeights()`, `ZONE_BLEND_WIDTH` and
the `blendWidth = 8` default do not exist anywhere in `src`; `GameEngine.ts:11480` assigns
`zoneVisualWeights[zoneId] = zoneId === currentZone ? 1 : 0`, a hard 1/0 switch. `src/game/zoneArt.ts`
contains only the `ZoneVisualWeights` interface and `ZONE_ART_IDS` — eleven lines. Nor does
`ZONE_DECORATION_INSTANCES_MAX` (94) exist as an enforced budget. So of nine criteria: 2 verified,
**1 contradicted**, 6 unverifiable.

**Accessibility and comfort.** Light and dark themes must both preserve contrast for **all** zone
titles. Reduced motion uses a static fade with no translation and removes the animated motif sweeps;
the zone title stays informative without any animation at all. The three hatch motif primitives are
`scrape` (broken near-horizontal strokes with variable gaps), plus its siblings — the motif is a
CSS/`data-*` treatment in `src/App.tsx`, not a WebGL layer, so it inherits the page's contrast
settings rather than fighting them.

**Ownership, stated as a boundary.** Zone art direction adds accents **without duplicating
day/night, weather or foliage-wind ownership**: day/night owns time-of-day light and sky, weather
owns climate and precipitation, foliage owns ground vegetation and wind motion, and toon shading
owns character lighting and outlines. Zone art owns only palette, hatch motif and title treatment,
baked into cached surface textures. `GameEngine` owns **one reusable `ZoneVisualWeights` object**
that the blend function writes into rather than allocating per frame. Hatch textures live in the
existing `generatedTextures` cache and are disposed by the existing teardown; instanced decoration
geometry and materials are shared and **scene-owned**, so the ordinary traversal releases them and
nothing is disposed twice.

**Negative controls the spec fixed.** *"Do not add four independent fog systems"* — the scene has one
camera and one fog. *"Do not add decorative collision accidentally"*: most new props are visual only.
*"Do not add hundreds of individual meshes"* — repeated props use `InstancedMesh`. *"Do not duplicate
tree/grass work"*: forest identity additions extend existing generation rather than paralleling it.
The shape and palette rules are **original** — *do not reproduce proprietary iconography*. Never draw
high-frequency one-pixel grids that shimmer at camera distance. Added props near palace or fort
walls **must not enter gate detour nodes**, and procedural marks must not cover transparent canvas
pixels on signs and doors. At the origin (`X = 0`, `Z = 0`) the normalized visual weights prevent a four-color overbright tint — the blend is normalised, not summed.

**Two remaining facts.** Forest identity is carried by **74 deterministic tree LODs**, three huts and
a beacon — the zone is recognised by counted, seeded content, not by a tint. And the accessibility
floor: **UI accents cannot override health, danger, faction or rarity meanings**; the zone palette
decorates the HUD, it never re-codes it.

**Nine more rules.** Ownership is a boundary: foliage owns ground vegetation and wind, and zone art
must **expose** its own weights rather than reach across. *"Do not add four independent fog
systems"* — there is one camera and one **global** fog. *"Do not add hundreds of individual meshes"*:
repeated props are **grouped** into `InstancedMesh`. *"Do not change gameplay `zoneAt()` to make
visual transitions smoother"* — visual blending stays **separate** from the gameplay boundary. The
**waterless** sky, particles and transparent effects do not participate in fog. Zone tinting must
**never mutate the day/night keyframes themselves**. Large landmark silhouettes must not hide
**actors** or the player at ordinary camera distances, and props near palace or fort walls must not
enter gate detour nodes or the **camera-obstacle** set. Cache keys are distinct enough that two zones
cannot accidentally **reuse** one. Weather and foliage ownership must remain **compatible**.

**Bound values.** Forest identity is `74` deterministic tree LODs. `HatchMotif` includes `'scrape'`,
ground patterns include `'grass'`, decoration props are `collidable = false`, and
`ZONE_FOG_WEIGHT = 0.04` bounds how far zone tint may move the fog.

**The rules, and the ownership line.** *"Do not solve zone identity by saturating ground colours"* —
lighting, theme and blood already use that budget. *"Do not add decorative collision accidentally"*:
most new props are non-colliding. *"Do not add hundreds of individual meshes"* — repeated props use
`InstancedMesh` grouped by kind. *"Do not duplicate tree/grass work"*: forest identity additions are
roots and arches, not a second forest. *"Do not overwrite procedural material maps"* — zone hatching
is folded into cached surface textures while the sibling spec owns character lighting, and
`CanvasTexture` repeat, wrap and filter ownership stays unchanged. Ground vegetation and wind motion
belong to foliage; this spec may **expose** weights but not own them. `GameEngine` owns one reusable
`ZoneVisualWeights` object and the function **overwrites all** of its fields rather than allocating.
Fog mixes in weighted zone `fogTint` **by at most each profile's `fogWeight`**, and the decoration
budget is **no more than eight new instanced draw calls**. Added props near palace or fort walls
**must not** enter gate detour nodes or the camera-obstacle set. Reduced motion uses a static fade
with no translation, and the zone title stays informative without any animation.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

- **Do not add decorative collision accidentally.** Most new props are non-colliding.
- **Do not overwrite procedural material maps in the toon spec.** Zone hatching is folded into
  cached surface textures, while the sibling spec owns character lighting and selective outlines.
- These are original shape/palette rules.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.



### 10. Bloom post-processing

*Formerly `bloom-post-processing-spec.md`. 6 criteria, all unchecked in the archive — the smallest
spec in it.*

Wraps the render loop in an `EffectComposer` so existing emissive elements glow, with tone mapping
moved to `OutputPass` so bloom runs in linear HDR.

```text
BLOOM_STRENGTH=0.55   BLOOM_RADIUS=0.4   BLOOM_THRESHOLD=0.85
BLOOM_NIGHT_BOOST=0.4 (optional)         BLOOM_LAYER=1 (optional, selective mode only)
presets: Medium → strength 0.4, half-res · High → strength 0.55, full-res (DPR-capped)
renderer stays ACESFilmicToneMapping, exposure 0.92, SRGBColorSpace; DPR cap min(dpr, 1.75)
```

```text
RenderPass(scene, camera)  →  UnrealBloomPass(resolution, strength, radius, threshold)  →  OutputPass()
```

Threshold bloom ships first; masked selective bloom via a dedicated layer is an optional follow-up
to be used *"only if threshold bloom bleeds into bright ground textures."* The spec noted that
`three@0.185` already ships every module needed, so no dependency change was required. Flame
`emissiveIntensity` reaches ~1.55, which is what carries the torches over the threshold, and the
acceptance bar was 60 fps on mid-range hardware at the `High` preset.

**Settings and lifecycle.** The toggle is `Свечение (bloom)` persisted under
**`korovany-bloom`**, mirroring the `korovany-theme` and `korovany-music-muted` pattern, defaulting
**on** for fine pointers and **off** for coarse ones. The optional three-step `Off / Medium / High`
quality select was specified but never built; `Off` would have doubled as the low-end performance
escape hatch. The composer must be built **after** the renderer's pixel ratio and output settings
are configured, and when bloom is disabled its render targets must not be retained. Both paths leave
`renderer.toneMapping`, `toneMappingExposure` and `outputColorSpace` untouched. No `GameView` or
`SavedGame` change — it is a render setting, not game state.

The teardown rule is the one that catches people: *"`EffectComposer.dispose()` does not dispose its
pass list"* — each pass must be disposed explicitly first. Composer calls must also be guarded when
width or height is zero (a minimised window) to avoid zero-sized render targets, and resize must
use **logical** pixels via `composer.setSize` rather than separately mutating `bloomPass.resolution`.

**Status: shipped as threshold bloom; both optional extensions absent. 3 verified / 1 partial / 2
unverifiable.** `BLOOM_STRENGTH`, `BLOOM_RADIUS` and `BLOOM_THRESHOLD` all match at
`BloomPostProcessor.ts:7-9`; `OutputPass` is added last at `:49` with a comment recording that it
reads the renderer's ACES and exposure settings at render time; disposal is correct at `:70-73`
(`passes.forEach(pass => pass.dispose())` **then** `composer.dispose()`). The **Off/Medium/High
quality preset was never implemented** — only the boolean toggle — and neither `BLOOM_NIGHT_BOOST`
nor `BLOOM_LAYER` exists. The explicit zero-size guard could not be confirmed.

**Ownership and teardown.** The composer lives in a focused `BloomPostProcessor` helper so its
lifecycle is isolated from the gameplay engine, and **`App` owns the persisted preference** — the
engine never reads `localStorage`. `destroy()` cancels the rAF, disposes the renderer and scene, and
must dispose **all passes and targets** so nothing leaks across runs. Resize and the pixel-ratio cap
are respected and a **zero-sized render target must never be created** — a minimised window or a
zero-height container is the case that produces one.

**Two specified-but-unbuilt couplings.** `BLOOM_NIGHT_BOOST = 0.4` was to apply *only if day/night is
present*, and the spec's reasoning was that once the cycle ships, **bloom is what makes torches and
windows read at night**. Neither shipped: the processor is *deliberately independent of the private
day/night state*, which is a defensible boundary but leaves night torches without their intended
lift.

Four more rules. The composer already **captures** the renderer pixel ratio and resizes every pass, so
do not re-implement that. Bloom makes torches and windows read **beautifully** at night — which is
exactly why the unbuilt night boost was specified. Resize and the pixel-ratio cap are respected and a
zero-sized target must not be created, because that **crashes** the pass. `destroy()` disposes all
passes and targets so there is no GPU leak across run **restarts**.

**Bound baseline values.** Tone mapping exposure `0.92`, pixel ratio capped at `1.75`, emissive
sources around `1.55`, and `fog = false` on the materials that must not be fogged. `App` owns the
persisted preference **as it already does for theme**, keeping `localStorage` out of the engine.

**Teardown, stated precisely because the framework does not do it for you.** On `destroy()` or a live
disable, **explicitly dispose each added pass, then dispose the composer render targets** —
*`EffectComposer.dispose()` does not dispose its pass list.* The composer already captures the
renderer pixel ratio and resizes every pass, so **do not separately** re-implement that. And the
coupling that was specified but never built: if the day/night cycle ships, bloom makes torches and
windows **read beautifully after** dark.

**Three acceptance facts that are relational, not numeric.** With bloom disabled, the composer path
and the direct render must be **visually identical** — same exposure, same tone mapping, same colour
space — so the toggle changes only glow and never brightness. The **sky sun**
(`MeshBasicMaterial`, `fog: false`) *should* bloom while **bright fog and horizon bands must not**;
the threshold is tuned to separate them, or selective layers are used. And transparent smoke and
particles must **retain their sort order through `RenderPass`** — a post-processing stage is exactly
where transparency ordering silently breaks. Torch flames, the sky sun, projectiles and faction
beacons visibly bloom; flat surfaces do not.

---

### 11. Ground foliage and wind

*Formerly `ground-foliage-wind-spec.md`. 12 criteria, all unchecked in the archive.*

Deterministic instanced grass, ferns, flowers and static pebbles varying by zone, swaying via a
vertex-shader wind injected through `MeshStandardMaterial.onBeforeCompile` — no per-instance CPU
animation — with a user-selectable off / low / high quality.

```text
WIND_SPEED=1.6          DEFAULT_WIND_DIRECTION=normalize(1.0, 0.2)   DEFAULT_WIND_STRENGTH=0.25
GRASS_SWAY=0.12   FERN_SWAY=0.09   FLOWER_SWAY=0.10
GRASS_HEIGHT=0.70 FERN_HEIGHT=0.60 FLOWER_HEIGHT=0.75
FOLIAGE_CLEARANCE=0.35  ROAD_CLEARANCE=0.60   MAX_PLACEMENT_ATTEMPTS=target×40
castShadow=false        receiveShadow=false   program cache key 'ground-foliage-wind-v1'
organic totals: 1,000 at low · 2,990 at high · four total draw calls
```

| Bucket | Low (N/F/Ft/P) | High (N/F/Ft/P) | Wind |
| --- | ---: | ---: | :---: |
| grass / tufts | 230 / 370 / 150 / 60 | 700 / 1100 / 450 / 180 | yes |
| ferns | 0 / 90 / 0 / 0 | 0 / 260 / 0 / 0 | yes |
| flowers | 55 / 45 / 0 / 0 | 160 / 140 / 0 / 0 | yes |
| pebbles | 0 / 0 / 110 / 0 | 0 / 0 / 110 / 0 | no |

Buckets group by **render bucket, not zone**, with zone colour applied through
`InstancedMesh.setColorAt()`. Placement samples within `WORLD_HALF`, confirms the zone with
`zoneAt(x, z)`, and rejects the road corridors `abs(x) <= 3 + clearance` and
`abs(z + 23) <= 3 + clearance` around the 6-unit road geometry. It generates the `high` sequence
and uses its prefix for
`low`, so changing quality never reshuffles retained plants.

The shader is the substance:

```glsl
float h = smoothstep(0.0, uFoliageHeight, position.y);
vec2 root = (modelMatrix * instanceMatrix[3]).xz;
float phase = dot(root, vec2(0.31, 0.37)) + uTime * 1.6;
float wave = sin(phase) + 0.35 * sin(phase * 0.47 + 1.7);
vec2 axisX = (modelMatrix * vec4(instanceMatrix[0].xyz, 0.0)).xz;
vec2 axisZ = (modelMatrix * vec4(instanceMatrix[2].xyz, 0.0)).xz;
vec2 localWind = vec2(
  dot(uWindDirection, normalize(axisX)) / max(length(axisX), 0.0001),
  dot(uWindDirection, normalize(axisZ)) / max(length(axisZ), 0.0001)
);
transformed.xz += localWind * (uWindStrength * uSwayAmplitude * h * h * wave);
```

That per-instance basis transform exists because of a self-correction worth preserving: *"The
original draft added a world-space wind vector directly to instance-local coordinates. Random
instance yaw would therefore rotate the wind differently for every plant, and instance scale would
also distort its magnitude."* Two more: animating a separately translated bud by local vertex
height *"would make the bud detach from its stem"* (hence merged stem-and-bud geometry with vertex
colours), and wind must keep direction normalised with strength separate so *"weather gusts have
one scalar to change."*

Both shader chunk markers must be validated and the injection must **throw** if Three.js changes
them, because *"A silent no-op would ship static foliage."* Bounding spheres must be expanded by
the bucket's maximum sway, since shader displacement is invisible to Three.js culling. And
`cameraObstacles` must **not** be used for placement: *"it is collected later, contains render
objects rather than 2D footprints, and intentionally excludes planes and instanced meshes."*

**Status: static deterministic instanced ground cover and quality shipped under the region
streamer; shader wind and the specified global bucket/budget model did not.**

*An earlier revision of this document claimed "the setting shipped; the feature did not". That was
wrong, and the correction is recorded here rather than quietly swapped, because the original claim
was published in this repository's pull request.*

What **did** ship, in `world/GeneratedWorldRuntime.ts` rather than in `GameEngine`:

- **Four procedural cover kinds**, matching the spec's four buckets one for one —
  `type GroundCoverKind = 'fern' | 'flower' | 'grass' | 'pebble'` (`:2025`), with real geometry
  per kind (`groundCoverGeometry:2052`: grass is a translated 3-segment `ConeGeometry(0.08, 0.62)`,
  fern and flower are merged multi-part geometries, pebble is a `DodecahedronGeometry(0.2)`).
- **Per-biome counts**, the shipped equivalent of the spec's density table
  (`GROUND_COVER_COUNTS:2042`):

  | Biome | grass | fern | flower | pebble |
  | --- | ---: | ---: | ---: | ---: |
  | neutral | 260 | 0 | 36 | 18 |
  | palace | 45 | 0 | 0 | 35 |
  | forest | 420 | 90 | 28 | 12 |
  | fort | 70 | 0 | 0 | 120 |

  The forest/fern relationship the spec asked for survives exactly: ferns exist only in forest, and
  flowers only in neutral and forest.
- **One `InstancedMesh` per kind per region** (`createGroundCover:1259-1290`), with
  `StaticDrawUsage`, named `dressing-cosmetic:ground-<kind>:<regionId>` and materials shared from
  the region's palette — instanced, not per-plant meshes.
- **Real clearance logic** (`canPlaceGroundCover:1350-1373`): road corridors at
  `style.roadWidth / 2 + 1.1`, river corridors at `style.riverWidth / 2 + 1.4` in regions the river
  passes through, an 11 u exclusion around every site in the region, and a final
  `terrain.isWalkableSlope(x, z)` test. Placement is bounded rejection sampling at
  `maximumCount * 12` attempts (`:1330`) from a seeded stream — the spec's `target × 40` with a
  different budget.
- **Deterministic prefix-truncation quality** (`setDecorationDensity:686-693`):
  `mesh.count = floor(maximumCount * normalized)`, which is precisely the spec's requirement that
  `low` be an exact prefix of `high` — lowering quality truncates the instance list rather than
  re-rolling it, so retained plants never move.
- **The `off / low / high` setting**, mapping to density `0 / 0.55 / 1`
  (`foliageQualityDensity:1400`), persisted under `korovany-foliage`, with cycling controls in both
  the menu and the pause modal.

What did **not** ship: **the vertex-shader wind**. There is no `onBeforeCompile`, no
`uWindDirection`, `uWindStrength`, `uSwayAmplitude` or `uFoliageHeight`, and no
`customProgramCacheKey` anywhere in `src`. Ground cover is static. Nor did the spec's **global
four-draw-call bucket model** ship: meshes are per kind *per streamed region*, so the number of
ground-cover draws scales with loaded regions and exceeds four whenever more than one region is
loaded. Clearance is derived from the region style rather than from named constants, so
`FOLIAGE_CLEARANCE` and `ROAD_CLEARANCE` do not exist.

A wind vector does exist but is **inline and unnamed**: `direction: new THREE.Vector2(1, 0.2)
.normalize()` inside the `WindState` initialiser at `GameEngine.ts:1521`, with
`strength: DEFAULT_WIND_STRENGTH` (`= 0.25`, `:1079`). It drives precipitation, not foliage.
**There is no `DEFAULT_WIND_DIRECTION` constant** — an earlier revision of this section claimed
there was, and that was wrong.

**Ledger: 3 verified / 2 partial / 2 unverifiable / 5 absent or contradicted.** Recounted
criterion by criterion, because an earlier revision let "unverifiable" absorb things that are
simply not there — and because two earlier revisions of this row disagreed with each other and with
the criteria beneath it. The tally below is derived from the table, not the other way round:

| # | Criterion | Result |
| ---: | --- | --- |
| 1 | Grass, ferns, complete flowers sway; random yaw does not rotate apparent wind | **absent** — no wind |
| 2 | No per-frame instance buffer upload; atmosphere updates only shared uniforms | **absent** — no uniforms; but `StaticDrawUsage` means no per-frame upload either |
| 3 | Neutral, forest, fort, palace visibly distinct in density, scale, tint | **verified** — `GROUND_COVER_COUNTS` differs per biome; materials per biome |
| 4 | Layout deterministic; `low` an exact subset of `high` | **verified** — seeded placement + `mesh.count` truncation |
| 5 | Avoids roads, structures, compounds, spawns, quest clearings | **partial** — roads, river, an 11 u site radius and slope are covered; registered-structure footprints, authored compounds, faction spawns and quest clearings are not |
| 6 | Foliage disappears into fog without sorting artifacts | **unverifiable** — visual |
| 7 | Wind-displaced vertices do not clip at frustum edges | **absent** — no displacement to clip |
| 8 | Ground detail stays within four draw calls | **contradicted** — four kinds *per loaded region* |
| 9 | `off / low / high` persists and rebuilds cleanly from menu and pause | **verified** |
| 10 | Default breeze works without weather; weather coupling verified when weather exists | **absent** for foliage; the wind state exists but is precipitation-only |
| 11 | Build and lint pass; no WebGL shader errors | **partial** — build and lint pass; there is no shader to fail |
| 12 | `high` holds 60 fps on reference desktop; `low` measured on a coarse-pointer device | **unverifiable** — not measured |

**Settings ownership and disposal, per the spec's stated contract.** `App.tsx` owns persisted
visual settings, passes initial values into `GameEngine`, and calls engine setters for live changes —
*"foliage should follow this pattern rather than read `localStorage` inside the engine"*. Concretely
`App.tsx` owns `readFoliageQuality()`, the state and a ref, following the bloom setting, and exposes
a **three-state cycling button** in both the menu settings and the pause settings. During
`destroy()`, `InstancedMesh.dispose()` is called from the existing scene traversal, which disposes
only the organic foliage meshes and must **not dispose the same resources twice**; temporary source
geometries are disposed after the merged fern and flower geometries are built.

**The budget rule, stated as the spec stated it:** *"the replacement keeps the current
four-draw-call ground-detail budget."* This is the criterion the shipped implementation
**contradicts** — see the ledger below — because meshes are per kind *per streamed region*, so the
number of ground-cover draws scales with loaded regions rather than being globally bounded at four.

**Negative controls and placement rejections.** Per-zone tinting uses
`InstancedMesh.setColorAt()` so **four zones do not multiply draw calls**. *"Use the existing linear
fog for v1; do not introduce transparent instanced fade."* *"Do not cast foliage shadows and do not
update instance matrices after build"* — the cover is static by design, which is exactly why the
absent wind shader does not degrade it. *"Do not add `uFade` alpha in v1; if fog is ever removed,
prefer a dithered or opaque cutoff."* Placement rejects the vertical road corridor (`abs(x) <= 3 + clearance`) **and the horizontal one**
(`abs(z + 23) <= 3 + clearance`), matching the actual 6-unit road geometry, plus palace/fort compound
interiors — **walls alone do not exclude their courtyards**, which has to be
done deliberately. One writer establishes the canonical wind state **before** the atmosphere update,
so wind is not written twice per frame from two places.

**The baseline being replaced, and the reporting rule.** `createGroundScatter()` created **four**
`InstancedMesh` draw calls — **420** grass blades, **64** flower stems, **64** flower buds and **110**
pebbles — with instance matrices uploaded once and a bounding sphere computed per mesh. That is the
four-draw-call figure the budget rule refers to. `MeshStandardMaterial` participates in
`THREE.Fog(worldFog, 48, 132)` by default, and culling is mesh-level rather than a distance fade —
which is why the spec chose fog over an alpha fade for v1. Placement rejects the vertical road
corridor at `abs(x) <= 3 + clearance`. The diagnostic rule: log **bucket, zone, target and actual
count** if a future world layout cannot reach its target, rather than silently under-filling.

Four more rules. *"Do not cast foliage shadows and do not update instance matrices after
**construction**"* — the cover is static by **construction**, not by omission. A bounded rejection
loop must cap attempts, **for example** `target * 4`, so a hostile layout cannot spin. One writer
**writes** the canonical wind state before the atmosphere update. `destroy()` disposes only the
organic foliage meshes, **including** `InstancedMesh.dispose()`, and nothing twice.

**The baseline and the per-kind profile, bound to their owners.** `createGroundScatter()` produced
four draw calls — grass `420`, flower stems `64`, flower buds `64`, pebbles `110` — under
`THREE.Fog(worldFog, 48, 132)`. The replacement's per-biome profile is a table, not a scalar: ferns
`3 / 4 / 0 / 90`, flowers `55 / 45 / 0 / 0`, pebbles `0 / 0 / 110 / 0` across the four biomes.
`FoliageQuality` is `'off' | 'low' | 'high'`; the default wind strength is `0.25` and the disabled
value is `0`.

**The rules.** *"Use the existing linear fog for v1. Do not introduce transparent instance fading."*
One writer establishes the canonical wind state **before** the atmosphere update — *do not probe for
it elsewhere*. Rebuild disposes geometry and materials once: *do not also call the rebuild cleanup
path* and dispose the same resources twice. Dispose temporary source geometries **after** the merged
fern and flower geometries are created. The settings control reads
`Растительность: выкл. / низк. / высок.`, and the pause control calls the same engine setter as the
menu one. Default breeze works **without weather**, and weather coupling is **not** verified until the weather
system exists, and weather coupling is verified only when
the weather system exists — which, since wind never shipped, it never was.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Ground scatter` → 420 / 64 / 64 / 110 · `Fog` → 48 / 132 · `ferns` → 3 / 4 / 0 / 90
· `flowers` → 55 / 45 / 0 / 0 · `value = 0.25`.

- 3. Use the existing linear fog for v1.
- Direction and strength remain at the default breeze unless a weather implementation writes the
  same canonical wind state before the atmosphere update.
- Do not add `uFade` alpha in v1. If fog is ever removed, prefer a dithered opaque discard after
  visual testing rather than transparent instancing.
- During `destroy()`, call `InstancedMesh.dispose()` from the existing scene traversal before
  disposing geometry/materials. Do not also call the rebuild cleanup path and dispose the same
  resources twice.
- Default breeze works without weather; weather coupling is verified only when the weather system
  exists.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 12. Day/night cycle

*Formerly `day-night-cycle-spec.md`. All 6 acceptance criteria were already checked.*

A looping day→night cycle: the sun arcs the sky and recolours dome, fog, ambient and sun through
dawn, noon, dusk and night, with torches and building windows glowing after dark. Purely cosmetic.

```text
DAY_LENGTH=240              DAY_START_OFFSET=0.18
SUN_ARC_RADIUS=90           SUN_ARC_HEIGHT=70        SUN_ARC_DEPTH=40
CELESTIAL_DISC_DISTANCE=150 MIN_SHADOW_LIGHT_HEIGHT=8
SUN_INTENSITY=[0.15, 2.65]  HEMI_INTENSITY=[0.45, 1.65]
TORCH_INTENSITY=[1.4, 2.6]  FOG_NIGHT_SCALE=0.35     STAR_COUNT=180
TWILIGHT_BLEND=[-0.18, 0.08]                         DAY_BLEND=[0.08, 0.60]
```

```
dayPhase        = (elapsed / DAY_LENGTH + DAY_START_OFFSET) % 1   // 0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight
sunAngle        = dayPhase * TWO_PI
elevation       = sin(sunAngle)
dayFactor       = smoothstep(-0.08, 0.45, elevation)
nightFactor     = 1 − dayFactor
star opacity    = nightFactor² × 0.88
night sky tint  = mix(worldSky, worldFog, 0.45) × 0.28
flame emissive ramp 0.9 → 2.15
```

| Stop | elevation | Sun | Background | Fog | Hemisphere |
| --- | --- | ---: | --- | --- | ---: |
| Night | ≤ −0.18 | 0.15, colour `mix(worldSun, worldFog, 0.7)` | `mix(worldSky, worldFog, 0.45) × 0.22` | `worldFog × 0.35` | 0.45 |
| Dawn / dusk | 0.08 | 1.4 | `mix(worldSky, warning, 0.4)` | `mix(worldFog, warning, 0.3)` | 1.0 |
| Day | ≥ 0.60 | 2.65 | `worldSky` | `worldFog` | 1.65 |

Only the light's **Y** is clamped to `MIN_SHADOW_LIGHT_HEIGHT` for stable shadows; the visible sun
disc follows the true arc at 150 m, with the moon opposite.

The pre-implementation baseline is recorded because **the disable branch has to restore it
exactly**: `DirectionalLight(worldSun, 2.65)` at `(-35, 58, 24)` with a 2048 shadow map and an
orthographic frustum of ±85 (covering roughly 160 m of world); `HemisphereLight(worldSky,
worldAmbientGround, 1.65)`; a sky sphere of radius 178 with its sun mesh at `(-88, 74, -112)`; ten
cloud groups; `THREE.Fog(worldFog, 48, 132)`; and `PointLight(warning, 1.4, 11, 2)` per torch,
under ACES filmic tone mapping at exposure 0.92.

Two ownership caveats: the gradient sky
texture is *multiplicatively* tinted, so its day keyframe must be neutral white or the baseline
texture is darkened twice; and a dedicated `backgroundColor` must be kept, because *"assigning
`scene.background = palette.worldSky` and then mutating it would corrupt the palette source colour
by reference."*

**Settings and readability.** The toggle is `Динамическое время суток` in both the menu and the
pause modal, persisted under **`korovany-dynamic-day-night`**, defaulting to **on**, and applied to
a live engine immediately — *including while paused*. **Night must stay legible**: the clamped
minimums exist so there are no fully black frames, the moonlit floor stays readable, and no HUD tint
is required to compensate. Ownership: the per-frame driver allocates **no new geometry, colours,
vectors, arrays or materials**, indexed loops keep it O(torches + clouds) with no per-frame
callbacks, and disposal must include the `THREE.Points` star field so its geometry and material are
released. `this.palette` is captured at construction, and a live theme change already requires
re-initialisation, so no extra handling is needed.

Disabling restores every pre-implementation light, colour, celestial position, torch intensity and
window emissive explicitly, because *"merely forcing `dayPhase = 0.25` would move the light/disc
and would not reproduce the old scene exactly."* Time of day is derived from the persisted
`elapsed`, so it reconstructs on load with **zero migration and no new save fields**.

**Status: shipped, 4 verified / 2 partial. One numeric drift found.** `DAY_LENGTH = 240` and
`DAY_START_OFFSET = 0.18` at `world/WorldEnvironment.ts:31-33` with the phase formula at `:47`;
arc constants at `GameEngine.ts:1072-1077`; `updateDayNight()` at `:11508` with arc, clamp and disc
placement at `:11548-11568`. Twilight (1.4 / 1.0) and day (2.65 / 1.65) match exactly, and night
sun intensity is `0.15` as specified — **but night hemisphere intensity is `0.9` in code
(`GameEngine.ts:1312`) against `0.45` in the spec.** The torch and window emissive ramp exists as
behaviour but not as the named `TORCH_INTENSITY` constant; only `TORCH_LIGHT_RANGE = 26` is named.

**The curve, written out.** `DAY_LENGTH = 240` seconds for a full 24 h loop (tunable) and
`DAY_START_OFFSET = 0.18`, so new campaigns begin in mid-morning; the offset applies **equally to new
and loaded games**, so `elapsed = 0` starts in mid-morning rather than at midnight. From the sun
angle:

```
elevation       = sin(sunAngle)                  // -1..1; > 0 means above the horizon
nightToTwilight = smoothstep(-0.18, 0.08, elevation)
twilightToDay   = smoothstep( 0.08, 0.60, elevation)
```

Colours are computed **relative to `this.palette`** and never hard-coded, which is what lets the
zone palettes and the weather profiles compose with the cycle instead of fighting it. The background
colour is a reused `THREE.Color` instance, not a per-frame allocation.

**Two remaining facts.** The sky dome is a gradient sphere of radius 178
(`worldSky → worldHorizon → worldFog`) with an emissive sun mesh at `(-88, 74, -112)` and **10**
drifting cloud groups held in `this.clouds`. The toggle is a plain on/off available on **both the main menu and the pause modal**. It defaults on
and updates the world live.

Night clamps intensity and keeps a moonlit **blue-gray** palette so the world never goes fully black —
the readability floor is a palette decision, not a brightness slider.

**The baseline table, bound row by row.** Sun light intensity `2.65` at position `(35, 58, -24)`.
Sky dome radius `178` with the sun mesh at `(-88, 74, -112)`. `THREE.Fog(worldFog, 48, 132)`. Torch
flames at intensity `1.4`, range `11`, decay `2`. Tone mapping exposure `0.92`, and `fog = false`
where required. Day keyframe: fog weight `0.60`, sun `2.65`, hemisphere `1.65`. Night keyframe:
ambient `0.18`, sun `0.15`, hemisphere `0.7`, moon `0.45`.

Colours are computed **relative to `this.palette`** and never hard-coded, so light and sky compose
with the zone palettes instead of overriding them. Toggling the cycle off applies **while paused**,
and the disabled branch **restores every pre-implementation light, colour** and fog value rather than
leaving the world at whatever phase it happened to be in.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Sun light` → 2.65 / 35 / 58 / 24 · `Sky dome` → 178 / 88 / 74 / 112 · `Fog` → 48 /
132 · `Torch flames` → 1.4 / 11 / 2 · `Night` → 0.18 / 0.15 / 0.7 / 0.45 · `Day` → 0.60 / 2.65 /
1.65.

- **`createAtmosphere()`** — keep the gradient sphere but store its material as `this.skyMaterial`
  and drive its `.color` tint; store the sun mesh as `this.sunDisc`; add `this.moonDisc` on the
  opposite arc and a deterministic 180-point star field (`opacity = nightFactor² × 0.88`,
  `fog:false`).

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 13. Weather

*Formerly `weather-system-spec.md`. 9 criteria, all unchecked in the archive.*

Zone-driven, player-local weather: forest → rain, fort → snow, neutral → overcast, palace → clear,
settling over about six seconds at boundaries. Cosmetic only — no movement, combat, AI, objective,
save or determinism effect.

The four locked decisions are worth more than the numbers, because each is a rejected alternative:
ship **zone-driven weather only** (*"a global scheduler can be a later feature"*); keep atmosphere
**camera-local** rather than four regional sims (*"fog and sky are scene-global, while
precipitation is camera-centred"*); blend **four profile weights** rather than one `intensity`
scalar (*"one scalar cannot represent an interrupted transition or a rain-to-snow cross-fade
without a hard mode swap"*); and render rain as `LineSegments` with snow as `Points`, because
*"WebGL points have a square screen-space footprint and cannot produce true stretched streaks with
`PointsMaterial`."* Weather is applied **after** day/night every frame so that it can modify the
current dawn/day/dusk/night result and never restore or blend toward fixed daytime colours. It
modifies the current
dawn/day/dusk/night result and never blends back toward fixed daytime colours.

```text
WEATHER_BLEND=6            WEATHER_ZONE_HYSTERESIS=2      PRECIP_VISIBLE_EPSILON=0.01
RAIN_COUNT=1600  RAIN_SPEED=30  RAIN_LENGTH=0.9
SNOW_COUNT=1200  SNOW_SPEED=2.8 SNOW_DRIFT=0.7
PRECIP_HALF_EXTENT=22      PRECIP_TOP=26
GROUND_WET_ROUGHNESS=0.58  GROUND_WET_DARKEN=0.22        GROUND_FROST_TINT=0.24
LIGHTNING_MIN=8  LIGHTNING_MAX=22  LIGHTNING_FLASH=0.12
THUNDER_DELAY_MIN=0.3      THUNDER_DELAY_MAX=1.6
response = 1 − exp(−3 × delta / WEATHER_BLEND)      // ~95% in six seconds, weights sum to 1
baseline wind: THREE.Vector2(1, 0.2).normalize(), windStrength = 0.2
```

| Kind | Fog near/far | Sun | Hemisphere | Cloud opacity | Sky | Wet | Frost | Wind |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `clear` | 48 / 132 | 1.00 | 1.00 | 0.58 | 1.00 | 0 | 0 | 0.20 |
| `overcast` | 40 / 112 | 0.78 | 0.90 | 0.78 | 0.90 | 0 | 0 | 0.35 |
| `rain` | 30 / 95 | 0.62 | 0.78 | 0.90 | 0.78 | 1 | 0 | 0.85 |
| `snow` | 34 / 105 | 0.82 | 0.96 | 0.82 | 0.94 | 0 | 1 | 0.45 |

Lightning is eligible only while `rain ≥ 0.7`, uses one dedicated normally-dark `HemisphereLight`
to avoid ownership conflicts, and a **dedicated `weatherRng`** — *"never reuse `eventRng`."*
Thunder is queued on an engine timer, because *"Do not use `setTimeout`, which would outlive pause
or destroy."* Leaving the rain zone after a flash still plays the queued thunder; disabling weather
or destroying the engine cancels both. `thunder` needed its own procedural-noise branch because
*"the existing oscillator frequency table is suitable for short cues, not thunder."*

`destroy()` had to be extended to dispose `THREE.Line` / `LineSegments`, which the baseline
traversal (Mesh, Sprite, Points) did not cover. One limitation was accepted openly: *"Under cover:
precipitation can pass through roofs. This is accepted for v1 and documented as a local-atmosphere
limitation."*

**Status: shipped, but with the largest numeric drift in the archive — 5 verified / 1 partial / 3
unverifiable, and the shipped values should be treated as authoritative over the table above.**
The zone mapping is exact (`WEATHER_BY_ZONE` at `world/WorldEnvironment.ts:23-28`, renamed from
`ZONE_WEATHER`), and the blend is equivalent: `WEATHER_RESPONSE_RATE = -Math.log(0.05)/6` at `:35`
with `1 - exp(-rate × delta)` at `:89` — numerically the same 95%-in-six-seconds curve. What
drifted:

| Spec | Code |
| --- | --- |
| `RAIN_COUNT=1600` | `RAIN_DROP_COUNT=420` |
| `SNOW_COUNT=1200` | `SNOW_FLAKE_COUNT=300` |
| `RAIN_SPEED=30`, `RAIN_LENGTH=0.9` | `RAIN_FALL_SPEED=34`, `RAIN_STREAK_LENGTH=2.2` |
| `SNOW_SPEED=2.8`, `SNOW_DRIFT=0.7` | `SNOW_FALL_SPEED=5.4`, `SNOW_DRIFT_SPEED=0.65` |
| `PRECIP_HALF_EXTENT=22`, `PRECIP_TOP=26` | `HALF_WIDTH=24` / `HALF_DEPTH=20`, `TOP=25` |
| `GROUND_WET_ROUGHNESS=0.58` | `0.48` |
| `LIGHTNING_FLASH=0.12` | `LIGHTNING_FLASH_DURATION=0.18`, plus new `LIGHTNING_INTENSITY=5.5` |
| `THUNDER_DELAY=[0.3, 1.6]` | `[0.35, 1.1]` |
| rain fog `30/95`, sun `0.62` | rain fog `18/72`, sun `0.22` |

All four shipped profiles differ from the specified table and additionally gained `desaturation`
and `celestialScale` fields the spec never had. **These are the authoritative values**
(`GameEngine.ts:1081-1126`), and the spec table above is retained only as the historical design
intent:

| Kind | Fog near/far | Sun | Hemi | Cloud | Sky | Desat | Wind | Celestial |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `clear` | 48 / 132 | 1.00 | 1.00 | 0.30 | 1.00 | 0 | 0.25 | 1.00 |
| `overcast` | 32 / 96 | 0.48 | 0.78 | 0.76 | 0.82 | 0.42 | 0.58 | 0.40 |
| `rain` | 18 / 72 | 0.22 | 0.62 | 0.94 | 0.70 | 0.62 | 1.15 | 0.12 |
| `snow` | 24 / 82 | 0.42 | 0.76 | 0.86 | 0.88 | 0.50 | 0.78 | 0.26 |

`clear.windStrength` is `DEFAULT_WIND_STRENGTH = 0.25` (`:1079`); `BASE_CLOUD_OPACITY = 0.58`
(`:1127`). The setting is persisted under **`WEATHER_ENABLED_KEY = 'korovany-weather'`**
(`App.tsx:155`), read with a guarded `localStorage` accessor that **defaults to enabled**
(`:386`), surfaced as `Погода` in both the menu and the pause modal with matching ARIA state, and
applied live through `engine.setWeatherEnabled(next)` even while paused.

**`WEATHER_ZONE_HYSTERESIS` and `PRECIP_VISIBLE_EPSILON` do not exist** — the hysteresis is
unimplemented, and `GameEngine.ts:11198` is a plain zone comparison.

**Settings placement.** The weather toggle sits **with the day/night and bloom controls**, sharing
their ARIA state convention, rather than being hidden in a separate panel — one row of world-look
switches, all keyboard reachable and all announcing their pressed state.

**Lifecycle and disposal.** `setWeatherEnabled(enabled)` must **apply immediately, including while paused** — enabling and
disabling both take effect at once, and does not wait for the next frame; enabling restores all visible state and disabling
removes it, so a toggle from the pause menu is visible behind the modal. Pause uses the normal
update gate, which freezes precipitation, lightning and thunder **together**. `destroy()` had to be
extended to `THREE.Line` / `THREE.LineSegments` — the existing `destroy()` helper handles `Mesh`, `Sprite` and `Points` but not lines, which is what rain is — or to dispose rain explicitly; either way **disposal
stays single-owner** so no object is disposed twice, and the snow texture is registered in
`generatedTextures` so the existing teardown releases it.

**Draw-call budget.** Steady rain or snow costs **one draw call**; a rain-to-snow transition costs
**two**, for at most the blend window — *"which is preferable to an incorrect hard material swap"*.
Rain uses a transparent `LineBasicMaterial` with `NormalBlending` and `depthWrite: false` in a
palette-derived blue-grey; snow uses `NormalBlending`, `transparent: true`, `depthWrite: false` and a
near-white sprite. **Additive blending is prohibited for precipitation** precisely so it does not
cross the bloom threshold and glow.

Two design rules the spec fixed and the code kept: *blend four profile weights instead of using one
`intensity` scalar*, because one scalar cannot represent an interrupted transition or a rain-to-snow
cross-fade without a hard mode swap; and *apply weather **after** day/night every frame*, so weather
modifies the current dawn/day/dusk/night result and never restores or blends toward fixed daytime
colours.

**The blend, written out.** Weights approach their target profile exponentially rather than
linearly, so an interrupted transition stays continuous:

```
response = 1 - Math.exp((-3 * delta) / WEATHER_BLEND)   // WEATHER_BLEND = 6
weight  += (targetWeight - weight) * response
```

The director keeps `groundSurfaces` as a `Map<ZoneId, GroundSurface>`, a `windDir` of
`new THREE.Vector2(1, 0.2).normalize()`, and `thunderDelay = -1` as the inactive sentinel.

**Negative controls.** *"Do not lerp weather toward absolute daytime colours — that would brighten
night."* Ground darkening is a **multiplier**; *do not regenerate or edit textures*. **Persist only
the preference**: weather goes into neither `SavedGame` nor `GameView` state. Reversing across a zone
boundary must never snap the atmosphere, and rain and snow must **not bloom noticeably**.

**Three remaining facts.** The framing rule is that weather is a **camera-local atmosphere, not four
simultaneous zone weather systems** — one player, one sky. Lightning uses a **time-based flash with a
delayed procedural thunder**, and if the player leaves the rain zone after a flash the **already
queued thunder still plays** rather than being cancelled mid-air. The performance bar is the
existing **60 fps target on the project's baseline machine at the DPR cap** — weather must not spend
it.

The exact shipped blend line is `const response = 1 - Math.exp((-3 * delta) / WEATHER_BLEND)`.

**Seven more rules.** Weather is **camera-centered**, not four simultaneous zone systems. Rain renders
as `LineSegments` and snow as `Points`, because the WebGL points **primitive** has size limits that
rain would hit. The snow texture is registered in `generatedTextures` so existing teardown
**disposes** it. **Create** one dedicated, normally dark `HemisphereLight` for lightning rather than
modulating the day/night lights **directly**; a separate light prevents ownership conflicts. Keep
disposal single-owner to avoid **double-disposing**. Reversing across a boundary never snaps the
atmosphere nor **converts** one profile into another mid-blend. The menu and pause **toggles** persist
and apply live. Precipitation and the new line **geometry** must not bloom noticeably. Day/night and
settings **integration** were the main work; lightning and thunder were the tail.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Fog` → 48 / 132 · `WeatherKind = clear` · `clear = 1` · `overcast = 0` · `rain = 0`
· `snow = 0` · `clear` → 48 / 132 / 1.00 / 1.00 · `overcast` → 40 / 112 / 0.78 / 0.90 · `rain` →
30 / 95 / 0.62 / 0.78 · `snow` → 34 / 105 / 0.82 / 0.96 · `frustumCulled = false` ·
`lightningCooldown = 0` · `lightningFlash = 0` · `weatherEnabled = true`.

- Treat weather as a **camera-local atmosphere**, not four simultaneous regional simulations. — Fog
  and sky are scene-global, while precipitation is camera-centered. The player experiences the
  weather of the zone they occupy.
- Apply weather **after** day/night every frame. — Weather must modify the current
  dawn/day/dusk/night result, never restore or blend toward fixed daytime colors.
- Disposal — `destroy()` — Handles `Mesh`, `Sprite`, and `Points`, but not `LineSegments`; extend it
  for rain and the existing grid helper.
- Use a transparent `LineBasicMaterial` with `NormalBlending`, `depthWrite:false`, and
  palette-derived blue-gray color. Do not use additive blending; rain should not trigger bloom.
- Do not lerp weather toward absolute daytime colors: that would brighten storms at night.
- Because the procedural texture supplies the zone detail, modify `material.color` as a multiplier;
  do not regenerate or edit textures.
- Create one dedicated, normally dark `HemisphereLight` for lightning.
- **`destroy()`**: extend scene disposal to `THREE.Line`/`THREE.LineSegments`, or dispose rain
  explicitly. Keep disposal single-owner to avoid double-disposing the same object.
- Persist only the preference. Do not add weather to `SavedGame` or `GameView`.
- **Weather toggle while paused:** the setter applies/restores all visible state synchronously;
  timers remain frozen.
- Fog range/color, sky, clouds, sun, and hemisphere lighting compose with the current day/night
  state and never reset the scene to fixed daytime values.
- Lightning uses a time-based flash and delayed procedural thunder; pause, disable, and destroy
  leave no orphaned timer or audio work.
- The menu and pause toggles persist and apply live, including while paused.
- Rain/snow do not bloom noticeably; precipitation and new line geometry are disposed on restart.
- *About 1.5 days.** Correct rain/snow renderers, transition-safe profile composition, and
  day/night/settings integration are the main work.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 14. Dynamic world events

*Formerly `dynamic-world-events-spec.md`. 7 criteria, all unchecked — and the only spec in the
archive that was **partly superseded** by a later one.*

An optional, time-boxed event layer on top of the fixed objective chain. Events spawn as the
player roams, grant gold, loot or buffs, and never touch the win condition.

| Kind | Setup | Success | Reward | Fail |
| --- | --- | --- | --- | --- |
| `richCaravan` | Gilded caravan + 3-enemy escort; marker | Rob via proximity `interact`, then move ≥ 18 m from the robbery point before the 25 s timer expires | +180 gold | Defeat or timer — the caravan escapes |
| `defendHome` | A tracked village house with fire/smoke FX and 4 attackers targeting it; the house is an event target with 100 hp | Kill all attackers within 45 s while house hp > 0 | +90 gold, +8 health capped at 100 | House hp hits 0, or timer |
| `champion` | 1 elite roaming actor, hp 260, aura | Kill the champion | +120 gold and +6 damage, to a cumulative **+18 per run**; at the cap, gold only | None; persists until killed |
| `rescue` | A captive ally guarded by 2 enemies; combat disabled, not squad-eligible | Kill both guards **or** `interact` beside the living captive | Captive transfers out of event ownership, gains normal ally AI and squad eligibility | Captive killed |
| `bounty` | Mark a living hostile non-critical actor, excluding commanders, captives and other events' actors; spawn one if none eligible | Kill the marked enemy within 40 s, **regardless of killer** | +70 gold | Timer — a spawned target despawns, a borrowed one is only unmarked |

```text
FIRST_EVENT_AT=50   EVENT_COOLDOWN_MIN=60   EVENT_COOLDOWN_MAX=90   EVENT_RETRY=10
MAX_ACTIVE=1        CHAMPION_DAMAGE_CAP=18  MAX_ACTORS=25
durations: richCaravan 25 · defendHome 45 · bounty 40 · champion ∞
required slots: richCaravan 3 · defendHome 4 · champion 1 · rescue 3 · bounty 0 or 1
```

Kind selection is faction-weighted — guards see more `defendHome`, elves more `richCaravan`,
villains more `champion`. If no kind is eligible the scheduler retries after 10 s **instead of
consuming the normal cooldown**.

Two ownership rules did real work. Event callbacks only update event state and never remove actors
inline, *"so cleanup cannot mutate `actors` during combat iteration."* And the `defendHome` house
is **borrowed, never added to `ownedProps`, and never disposed** — only attached event FX are
owned. Campaign isolation is enforced by `creditFactionObjective` ignoring
`objectiveEligible: false` actors, while a borrowed bounty target keeps its original eligibility,
so killing it may still advance a main objective exactly as it would have without the event.

Events are transient and not persisted. Saving during an active event stores
`EVENT_COOLDOWN_MIN` instead of the live value, so reloading cannot immediately replace an
abandoned event; `championDamageBonus` **is** persisted so the +18 cap survives.

**Superseded content, flagged rather than deleted.** Four of this spec's decisions were replaced
and no longer describe the game. The first is behavioural and was under-reported as constant drift
in an earlier revision of this document:

- **Both objective-dependent scheduler rules vanished.** The spec required the first event to fire
  **on completion of the first main objective**, or at ~50 s if the player kept roaming, and
  **prohibited starting a new event when only the final main objective remained**. Shipped
  `updateEvents` (`GameEngine.ts:7419-7453`) is **purely timer-driven**: it decrements
  `eventCooldown`, calls `startRandomEvent()`, and falls back to `EVENT_RETRY` — there is no
  objective-count gate anywhere in the path, and `FIRST_EVENT_AT = 30` is a timer, not a trigger.
  So the campaign no longer paces events against progress, and an event can begin while the player
  is walking into the finale. That is a real behavioural change, not a tuning change.
- **`MAX_ACTIVE = 1`** → one player-anchored event plus up to `MAX_LOCATED_EVENTS = 2` located
  ones (`:1188`, guard at `:7464`).
- **`eventRng = seededRandom((Date.now() % 2147483646) + 1)`** → a derived stream,
  `this.eventRng = () => streams.event.next()` (`:1853`), one of `combat | director | event | loot
  | chronicle` (`:1527`). **No `Date.now()` seeding remains in the event path.**
- **`WorldEventKind`** → split into `RandomWorldEventKind | ChronicleWorldEventKind`
  (`types.ts:147-162`), the latter adding `factionRaid`, `caravanAmbush`, `warband`, `aftermath`
  and `beastRaid`.

**Lifecycle invariants**, which are the part most easily lost. Cleanup runs through an idempotent
`removeActorById()` that removes projectiles sourced by that actor, clears other actors'
`targetId` references, removes and disposes the mesh and splices it from `actors`. It is applied
**only to `ownedActorIds`**: a borrowed bounty target and a rescued ally both survive event
cleanup. Every `ownedProps` entry is removed and disposed, but the `defendHome` house is borrowed,
never added to `ownedProps`, and never disposed. Active-event cleanup is called from `destroy()`
**before** the final scene traversal. An event target killed by a **third faction** still resolves
the event: `onKill` runs after normal objective-credit evaluation but before the indirect-kill
early return, and success is never gated on `directPlayerKill`.

The HUD contract: `EventBanner` shows title, description, a countdown from `timeRemaining` and a
progress bar of `progress / target`, coloured by `tone`, and **pulses when `timeRemaining < 10`**
(`App.tsx:809-843`). The minimap renders `kind === 'event'` with a distinct colour and star/flag
glyph plus a legend entry.

**Status: shipped and then partly superseded — 4 verified / 2 partial / 1 superseded.** All five
rewards match (`GameEngine.ts:7664-7689`), as do all four timers, the 100 hp house and the
`CHAMPION_DAMAGE_CAP` at `:893`. Scheduler constants **drifted**: `FIRST_EVENT_AT` is 30 in code
(spec 50), `EVENT_COOLDOWN_MIN` is 50 (spec 60), `EVENT_COOLDOWN_MAX` is 70 (spec 90), and the
cooldown is now additionally threat-tier-scaled (`:7194-7195`). `EVENT_REQUIRED_SLOTS` matches
except `bounty`, which is 1 in code rather than 0-for-a-borrowed-target. The load-time formula
`eventCooldown = savedGame?.eventCooldown ?? max(0, FIRST_EVENT_AT − elapsed)` survives exactly
(`:1950`).

**Lifecycle invariants — the ones that keep events from corrupting the campaign.** `cleanup(): void` is **idempotent**, and there is an idempotent `removeActorById()` that also removes projectiles.
Victory or defeat mid-event forces cleanup with **no reward**. **Killing event-spawned actors never
advances campaign objectives**; cleanup removes only `ownedActorIds`; borrowed bounty targets and rescued allies remain. A borrowed
bounty target is *borrowed* — not owned, not despawned —
while spawned fallback targets are **objective-ineligible and removable**. The champion damage bonus
stacks to **+18 per run** and stays capped **across save and load**; v1 saves default it to `0`.
Randomness comes from a dedicated `eventRng = seededRandom(seed)` — concretely
`seededRandom((Date.now() % 2147483646) + 1)`, so if the seed derives from the date it still varies —
kept
separate from world generation so events cannot perturb the seeded world.

**Two remaining facts.** The caravan is a single mover worth **+95 gold** on a 40 s cooldown, handled
by `updateCaravan`, `interact` and `spawnAmbush`. `ActorRole` was widened with `'champion'` and
`'captive'` rather than adding a parallel type, and `MiniMap` renders `kind === 'event'` markers with
a distinct treatment so an event reads differently from an objective.

**Nine more rules, including the two scheduler rules that vanished.** The spec required the first
event to fire when the first main objective is **completed**, or at `elapsed ≈ 50 s` if the player
keeps roaming without **completing** one — both superseded by the shipped timer-only
`FIRST_EVENT_AT = 30`. The weighted pool is built from kinds **currently** eligible and affordable.
The `+18` champion cap remains **correct** across saves, with v1 saves defaulting to `0`.
`ownedProps: THREE.Object3D[]` holds **event-created** props and FX removed on cleanup, and the
**cleanup helpers** include an idempotent `removeActorById()` that also removes projectiles. Victory
or defeat mid-event triggers **force-cleanup** with no reward. Before starting a kind the **actor
budget** is checked against its `requiredSlots`. **Bounty safety**: **objective-critical** actors are
never eligible. Borrowed actors and props survive cleanup and the actor count never **exceeds** 25.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `Caravan` → 95 / 40 · `richCaravan` → 3 / 18 / 25 / 180 · `defendHome` → 4 / 100 /
45 / 90 · `champion` → 1 / 260 / 120 / 6 · `rescue` → 2 · `bounty` → 40 / 70 · `NoticeTone = info`
· `state = active` · `null = null` · `squadEligible = false` · `squadEligible = true`.

- `champion` — Spawn 1 elite roaming actor (hp 260, aura). — Kill the champion. — +120 gold and +6
  damage, up to a cumulative **+18 champion damage per run**. At the cap, only gold is granted. —
  None; persists until killed or the run ends.
- `rescue` — Spawn a captive ally guarded by 2 enemies; marker. The captive starts with combat
  disabled and is not squad-eligible. — Kill both guards **or** `interact` next to the living
  captive. — Transfer the captive out of event ownership, enable normal ally AI, and make it
  squad-eligible. — Captive killed → fail.
- First event fires when the first main objective is completed, or at `elapsed ≈ 50 s` if the player
  keeps roaming without completing one.
- Do not start a new event after victory / defeat or when only the final main objective remains.
- On resolve, use one central `finishEvent(result)` path to apply the reward once, play sound, show
  a notice, run idempotent cleanup, clear `activeEvent`, and set cooldown.
- `attackEventProp` actors prioritize the event target over normal aggro, move into melee range, and
  damage `EventPropTarget.hp` on their attack cooldown.
- **Cleanup helpers:** add an idempotent `removeActorById()` that removes projectiles sourced by
  that actor, clears other actors' `targetId` references, removes and disposes the mesh, and splices
  the actor from `actors`.
- **Actor budget:** before starting a kind that needs `requiredSlots`, require `actors.length +
  requiredSlots <= MAX_ACTORS` (25).
- **Bounty safety:** objective-critical actors are never eligible.
- Champion damage stacks to +18 per run and remains capped after save/load.
- Killing event-spawned actors never advances campaign objectives.
- `defendHome` attackers damage the tracked house even when the player leaves; rescue keeps the
  captive out of the squad until success; bounty never removes a commander.
- Old and new v1 saves load; active events are abandoned with a safe cooldown; champion damage
  remains capped; no TS / oxlint errors; 60 fps with events active.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.




### 15. Layered procedural audio

*Formerly `06-layered-audio-spec.md`. 10 criteria, all unchecked in the archive.*

Extracts an `AudioDirector` that replaces one-oscillator SFX with bounded layered cues, explicit
buses, per-cue variation, priority/cooldown/concurrency admission, cheap camera-relative stereo and
deterministic teardown — while keeping everything procedural and autoplay-compliant.

```text
masterGain=0.85    musicGain: active 0.18 / paused 0.08 / ended 0.035
sfxGain=0.62 × userSfxVolume        uiGain=0.48 × userSfxVolume
MASTER_COMPRESSOR_THRESHOLD=−18 dB   knee 12 dB, ratio 5:1, attack 0.003 s, release 0.18 s
MAX_ACTIVE_VOICES=24   MAX_ACTIVE_SOURCES=48
SFX_DISTANCE_MAX=42    PAN_MAX=0.85    SFX_VOLUME_DEFAULT=0.8
per-cue caps: hitLight 6 · hitHeavy 3 · gore 3 · swing 2 · block 2
              attackTell 4 · arrow 4 · lootCollect 2 · UI/event 2
priority: victory/eventFail/UI 100 · hurt/block/down 90 · heavy hit/legendary loot 75
          ordinary hit/attack tell 55 · swing/gore/arrow 40 · ambient detail 20
variation: pitch 0.94..1.06 ordinary, 0.90..1.04 gore/down; gain ±1.5 dB
intensity: body-layer gain varies by at most 6 dB, noise duration by at most 35%
```

```
music voices -> musicGain ----\
game voices  -> sfxGain -------+-> masterCompressor -> masterGain -> destination
UI voices    -> uiGain --------/

pan  = clamp(dot(normalizeXZ(source − listener), cameraRight) × distanceFactor, −0.85, 0.85)
gain = lerp(1, 0.35, clamp(distance / 42, 0, 1))
```

**No recipe exceeds three source layers**, and one request is one voice even with three source
nodes. The 14 cue recipes:

| Cue | Layers |
| --- | --- |
| `swing` | band-pass noise whoosh + quiet descending triangle |
| `hitLight` | short noise crack + low triangle body |
| `hitHeavy` | sharper crack + lower sine thump + short saw texture |
| `block` | high metallic square ping + low impact + high-pass noise tick |
| `hurt` | descending saw body + filtered noise breath |
| `gore` | low-pass noise splat + short irregular triangle drop |
| `down` | heavy sine fall + noise body + short accent tone |
| `bow` | high-pass noise string + triangle twang |
| `arrow` | narrow-band noise pass-by; **no low thump** |
| `cleave` | broad whoosh + low sweep; impact layers arrive from hit events |
| `attackTell` | role-pitched short pulse, one layer |
| `whiff` | quiet high-pass whoosh |
| `lootReveal` | two- or three-note rarity arpeggio |
| `lootCollect` | short upward triangle + sparkle tick |

Intensity is clamped `0..1` and never multiplies total output without that clamp: it varies the
body layer's gain by **at most 6 dB**, moves the low-frequency endpoint, changes noise duration by
**at most 35%**, and may gate an optional third layer above a threshold.

Admission runs in a fixed order: reject if the cue's cooldown is active unless the recipe
allows coalescing; reject if its per-cue concurrent cap is reached and it is not higher priority;
at global capacity, stop the oldest lowest-priority voice **only when the new voice has strictly
higher priority**; otherwise suppress. Every source's `ended` handler removes itself, and when the
last source ends the voice's nodes are disconnected and the record dropped.

Three spatial and lifecycle rules that are easy to lose: **player-owned and UI cues are always
centred**, never panned; **pan is copied at request time and does not track** for a transient
under 100 ms; and the SFX bus **ramps down over 100 ms** at end rather than cutting. A same-frame
multi-target cleave coalesces to **one heavy impact body plus at most two spatial crack voices**,
never one full stack per target. A shield block suppresses blood and gore audio entirely and uses
block layers even when chip damage is positive. Pool pressure may suppress decorative gore or
swing, but **never** player hurt or a result/UI confirmation.

`sfxVolume` persists under **`korovany-sfx-volume`** as a finite value clamped to `0..1`,
defaulting to `0.8`, exposed as a range input labelled `Громкость эффектов` in both the menu and
the pause settings and displayed as a rounded percentage. **`0` is mute — there is deliberately no
second SFX boolean.** Volume parsing rejects `NaN`, infinity and out-of-range values and falls back
to the default.

The design corrections are unusually transferable: *"Do not make impact louder by starting
unlimited oscillators."* · *"Do not connect SFX directly to destination."* · *"Do not create
white-noise buffers per cue"* — one reusable buffer per context. · *"Do not use
`AudioContext.suspend()` for pause or tab hide"*, because resuming can require a new user gesture;
ramp buses instead. · *"Do not play one wet splat per gore particle."* · *"Do not randomize beyond
recognition."* · *"Do not make SFX depend on React state timing."*

**Lifecycle, in four states.** Pause suppresses gameplay SFX while allowing UI cues, lets active
transients finish, and holds music at its paused target. End suppresses new gameplay cues after the
result cue and ramps the SFX bus down over 100 ms. Hidden ramps master to zero quickly while
keeping scheduler time coherent. Visible restores buses **only if the context is running** — and
*"never call `resume()` without a user gesture after browser suspension"*. Destroy stops every
tracked source **ignoring only `InvalidStateError`**, disconnects all nodes, clears the interval and
scheduler state, removes the global ownership guard and closes the context exactly once. All
transitions use short linear or exponential ramps to avoid clicks, and repeated start/menu/start
cycles must not leave an interval or context from the previous engine. Autoplay: the context is
created or resumed only after an existing pointer or keyboard interaction, and *"a sound request
before context creation may be dropped; do not queue stale combat sounds to play after the next
gesture."*

Accessibility: music and SFX controls stay independent; a UI confirmation must be audible at low
non-zero SFX volume **and** duplicated visually; important gameplay information is never audio-only
— attack telegraphs, damage state, block sparks and loot cards all stay visual; pan is capped and
near-player sounds are centred; and the mix avoids very high sustained tones, extreme sub-bass and
repeated urgent notification patterns.

Music migration was explicitly a *move*, not a rewrite: faction roots, tempo, patterns, zone shift
source and step sequencing all unchanged, with zone passed in via `setMusicContext` because
*"AudioDirector must not import GameEngine."*

**Status: shipped, and the most faithfully implemented spec in the archive — 6 verified / 2 partial
/ 2 unverifiable.** The bus graph is exact at `AudioDirector.ts:983-1017`, ending
`masterCompressor → masterGain → context.destination`, with compressor values
`−18 / 12 / 5 / 0.003 / 0.18` matching to the digit at `:1000-1004`. The spatial formulas match
exactly at `:661-662`. Every per-cue cap and priority band matches. Pitch ranges `[0.94, 1.06]` and
`[0.90, 1.04]` are exactly as specified.

Two divergences, both **beyond** the spec rather than short of it. The shipped cue set is 27, not
24: `defeat`, `achievement` and `thunder` were added. And the music system is materially richer
than "migrate without changing composition" — `MusicScore.ts` adds four intensity tiers
(`explore | alert | combat | boss`), a 16-step / 32-bar cycle, per-faction tempo and a per-seed
arrangement, with reverb and echo sends in the director. `SFX_GAIN` and `MUSIC_GAIN` are not named
constants, so the 0.62 and 0.18 values are unverified.

**Routing, caps and ownership.** Every source routes through a voice gain — *"do not connect SFX
directly to destination"* — into `musicGain` / `sfxGain` / `uiGain`, then
`masterCompressor → masterGain → destination`. All sources in one request share a parent voice gain
and an optional `StereoPannerNode`, and the request is **tracked as one voice even when it has three
source nodes**. `MAX_ACTIVE_VOICES = 24`: at global capacity the oldest lowest-priority voice is
stopped or faded, and only when the new voice outranks it. *"Do not make impact louder by starting
unlimited oscillators"* — **layer count and voice count are both capped, and priority determines
what survives**. A multi-target cleave cannot submit one full heavy/gore stack per target. The
director owns **all** Web Audio nodes and timers, and a **window-level stop owner** prevents
overlapping music when engine instances change.

Explicitly out of scope: downloaded samples, speech, voice acting, convolution reverb impulse files
and licensed audio — the no-external-assets constraint applies to sound exactly as it does to art.
Also explicitly rejected: *"suspending the `AudioContext` as ordinary pause behaviour"* — pause
lowers music gain targets instead, because suspension breaks scheduler time. The SFX slider is an **accessible range input** added to the menu **and pause settings**, labelled
`Громкость эффектов`, persisted under **`korovany-sfx-volume`**; the music mute toggle beside it
persists under **`korovany-music-muted`**. Teardown: `InvalidStateError` is ignored; other teardown errors are surfaced consistently, and a start → menu → start
cycle must leave **no delayed burst, click loop, orphan interval, node leak or overlapping music**.

**Spatialisation, written out.** Panning and attenuation are computed from the listener-relative
offset rather than from a full HRTF panner:

```
offset           = sourcePosition - listenerPosition
gain attenuation = lerp(1, 0.35, clamp(distance / 42, 0, 1))
```

The safety defaults — the compressor, the caps, the pan limit — are *"safety/tone defaults, not a
substitute for reasonable layer design"*. Music context is set through
`setMusicContext(faction, zone)`, or a callback that provides it, so the score follows the world
rather than sampling it.

**Three remaining facts.** The mix targets **nominal musical balance in the active, paused and ended
states** — three balances, not one with ducking bolted on. On pause, gameplay SFX requests are
suppressed while UI cues remain allowed. Music context takes the current zone —
`setMusicContext(faction, zone)` — so the score follows where the player is, not only who they are
fighting. The validation bar is a **25-actor stress fight** for result and UI cues together; the
named risks were voice cleanup, browser lifecycle behaviour and mix tuning across dense fights.

**Eight more rules.** Music gain targets lower values on pause and end and on **visibility** change.
Music **scheduled** sources are tracked separately from ordinary SFX sources. *"Do not create
white-noise buffers per cue"* — **generate** one reusable buffer per context. *"Do not play one wet
splat per gore particle"*: one combat event **produces** one body. Intensity never multiplies total
output without a clamp, so a lethal hit is **different** in recipe and priority, not simply louder —
it is one recipe and priority choice plus intensity, not four **simultaneous** `hit` calls. Coalesce
**multiple** same-frame cleave hits into one heavy impact body. Stereo pan is capped and near-player
sounds stay **centered**, for **clarity** as much as comfort; the director owns all Web Audio nodes
and timers. Pause, hidden tab, end, autoplay **restrictions** and repeated engine creation must all
leave a clean state, and SFX volume persists, clamps invalid values, applies live and stays
**separate** from music.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.

Bound values: `confirmation = 100` · `details = 20`.

- 3. cap concurrent sources and repeated cues;
- Context — `GameEngine` lazily creates one `AudioContext` on user interaction and owns it until
  `stopMusic()`/destroy.
- Pause/visibility — Music gain targets lower values on pause/end and zero when hidden/muted.
- Lifecycle — Music scheduled sources are tracked; ordinary SFX sources/nodes are not tracked or
  explicitly disconnected.
- **Do not use `AudioContext.suspend()` for pause or tab hide.** Resume can require a new user
  gesture.
- **Do not play one wet splat per gore particle.** One combat event produces one bounded gore layer
  regardless of particle count.
- **Do not randomize beyond recognition.** Variation stays within recipe ranges and uses
  deterministic per-request parameter selection where practical.
- **Do not make SFX depend on React state timing.** GameEngine submits cues directly at
  authoritative events.
- Do not pan player-owned swing, hurt, block, or UI cues away from center.
- Pass the current zone into `setMusicContext(faction, zone)` or provide a callback; do not let
  `AudioDirector` import `GameEngine`.
- The global `window.__korovanyStopMusic` ownership guard may remain, but it calls director
  destroy/stop rather than a partial `GameEngine.stopMusic()`.
- A sound request before context creation may be dropped; do not queue stale combat sounds to play
  after the next gesture.
- Repeated start/menu/start cycles cannot leave an interval or context from the prior engine.
- Production build, oxlint, recipe unit tests, admission/cooldown tests, autoplay browser check, and
  repeated lifecycle audio check pass.
- *3-4 days.** Node graphs and recipes are modest; migration of existing music, reliable voice
  cleanup, browser lifecycle behavior, and mix tuning across dense combat require the time.

**Rules and values this distillation had compressed too far**, restored in the spec's own
wording because for a normative rule the wording *is* the fact — a paraphrase that drops
`not`, or separates a rule's terms across three paragraphs, has not preserved it.



### Acceptance-criteria ledger

The archive contained **164 acceptance criteria across 15 specs, of which 113 were unchecked** —
including criteria for features that had demonstrably shipped and are advertised in `README.md`.
Leaving those boxes unchecked in a consolidated document would have preserved a falsehood, so
every criterion was re-checked against the code at `b6f94ad`. The result:

| Spec | Criteria | Verified | Partial | Unverifiable by inspection | Contradicted / absent |
| --- | ---: | ---: | ---: | ---: | ---: |
| Living world | 37 | 37 | — | — | — |
| Combat depth | 8 | 6 | 2 | 1* | — |
| Enemy reactions | 10 | 4 | 4 | 2 | — |
| Comic hit language | 10 | 6 | 3 | 1 | — |
| Combat juice | 13 | 8 | 3 | 2 | — |
| Camera accents | 9 | 5 | 3 | 1 | — |
| Loot spectacle | 9 | 6 | 2 | 1 | — |
| Toon shading & outlines | 9 | 4 | 1 | 4 | — |
| Zone art direction | 9 | 2 | — | 6 | **1** |
| Bloom | 6 | 3 | 1 | 2 | — |
| Ground foliage & wind | 12 | 3 | 2 | 2 | **5** |
| Day/night cycle | 6 | 4 | 2 | — | — |
| Weather | 9 | 5 | 1 | 3 | — |
| Dynamic world events | 7 | 4 | 2 | — | **1 superseded** |
| Layered audio | 10 | 6 | 2 | 2 | — |

\* rows may overlap where one criterion is partly verified and partly not; the columns record the
strongest honest statement available per criterion rather than a strict partition.

**"Unverifiable by inspection" is not a euphemism for "broken".** It covers claims that only a
running browser, a profiler or a stopwatch can settle — frame-time budgets, "no allocation after
pool warm-up", "60 fps on mid-range hardware", visual legibility, and every `npm run build` /
`oxlint` line that a criterion listed as its own acceptance step. Those are recorded as unknown
rather than assumed.

**Three findings are genuine gaps between specification and code**, and they are the reason this
ledger exists:

1. **Ground foliage *wind* was never implemented**, though the ground cover it was meant to
   animate was. Four procedural cover kinds, per-biome counts, per-region instanced meshes,
   road/river/site clearance and deterministic prefix-truncation quality all ship under the region
   streamer. What is absent is the vertex-shader sway and the spec's global four-draw-call bucket
   model. Four of its twelve criteria describe code that does not exist.
2. **Zone border blending was never implemented.** `writeZoneVisualWeights` and `ZONE_BLEND_WIDTH`
   are absent; zone visual weights are a hard 1/0 switch. The fog tint, damping and per-zone
   profiles *did* ship, so the feature is partly real — but its headline criterion, smooth
   blending near quadrant borders, is contradicted by the code.
3. **Bloom's quality preset was never implemented** — only the on/off toggle. `BLOOM_NIGHT_BOOST`
   and `BLOOM_LAYER` are likewise absent, though both were optional in the spec.

Two further classes of drift are recorded in the sections above rather than repeated here: **weather
constants drifted substantially** from the spec (rain and snow counts, fall speeds, precipitation
volume, fog ranges and all four profiles), and several **named constants were inlined** rather than
named (`TOON_RAMP_LEVELS`, `MAX_OUTLINED_ACTORS`, `HATCH_TEXTURE_SIZE`,
`ZONE_DECORATION_INSTANCES_MAX`, `LOW_HEALTH_RATIO`, `TORCH_INTENSITY`, `SHIELD_RERAISE`,
`SFX_GAIN`, `MUSIC_GAIN`). In every such case the shipped value is authoritative and this document
records both.

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

**The measurement culture.** The living-world spec did not assert its results, it
*measures* them, with negative controls, and then corrects itself in public: "Two of these
numbers contradict what this section claimed before it was measured"
(§What shipped → Living world → Measured findings). `tests/actorAi.test.ts` re-implements the pre-extraction
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
(§What shipped → Living world → Design rules, rule 4); legibility was delivered, and *agency over* those consequences
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
and impact rays (`:12359-13354`). §What shipped → Enemy reactions records all of it.

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
  (§What shipped → Living world → Measured findings). And: "the tedious part was that both live in
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
across hundreds of ticks. The general risk is recorded in §What shipped → Living world → The
determinism caveat; **no test guards it**, and the honest statement is "same-seed runs can diverge at different
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
(§What shipped → Dynamic world events), was an unchecked box.

**The spec archive understates the project.** Twelve of the seventeen documents in `docs/`
carry 113 acceptance-criteria boxes that are **all unchecked** — bloom, ink outlines,
weather, ground foliage, camera accents, loot spectacle, layered audio, comic hits, enemy
reactions, zone art — for features that demonstrably shipped and are listed in the README.
None had been touched since 2026-07-17. The dynamic-world-events spec still documented
`MAX_ACTIVE = 1` and `eventRng = seededRandom((Date.now() % 2147483646) + 1)`, both
superseded by the living-world spec. For a product whose second design principle
is «Показывать сделанное кодом», the public evidence of the engineering currently
under-reports it.

One apparent contradiction in that archive is **not** one, and is recorded here so nobody
"fixes" it: the weather spec named four profiles while `content/registry.ts:16-22` lists
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
(§What shipped → Living world → Measured findings). There is no run-level balance harness at all, and
`GameEngine.ts` + `App.tsx` are 45.6 % of source with zero direct tests. The consequence is
already in the record: Layer 3's headline beast behaviour shipped as **dead content** — "zero
routs across 60 fights" (§What shipped → Living world → Measured findings, Q1) — because three individually
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
tick. §What shipped → Living world → The determinism caveat records the risk; nothing guards it.
This test is what decides whether a fixed-step conversion is needed at all — it is not
assumed either way.

*Effort:* 4–6 d. *Risk:* over-refactoring, or false confidence from a harness that models less
than it appears to — mitigated by stating its limits in the file, as the living-world measurements
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
(§What shipped → Dynamic world events), was an unchecked box.

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
cleanup, was scoped at 1.5–2 days alone (§What shipped → Dynamic world events). But the
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
the living-world spec with reasons this document endorses (§What shipped → Living world →
Deliberately left undone): an interaction prompt "would
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

> **Provenance note, added after signing.** Both sign-offs below were given on 2026-07-27
> against a document that ended at §*Open disagreements* and contained no §*What shipped*. That
> part was added afterwards, when fifteen design specifications were folded into this file and
> deleted from `docs/`.
>
> **The signed material is unchanged.** No claim, number, initiative, effort figure, risk,
> success signal, rejected idea or open disagreement was altered. A line-by-line diff against
> commit `d854a75` shows **37 changed lines, every one of them a citation retarget**. Three
> mechanical edits were made to signed text and nothing else: the title and header note now
> describe a two-part document; **eighteen citations that pointed at spec files by line number
> were retargeted to internal sections of §What shipped**, keeping the surrounding claim and
> every quoted phrase identical, because the files they pointed at no longer exist; and this
> note was inserted. In two of those sentences the verb tense also moved from present to past
> ("still documents" → "still documented"), because the subject is a file this commit deletes.
>
> Everything added since — the fact-preservation checker in `scripts/strategy-facts.mjs`, its
> fixtures, four rounds of restored facts, and the recounted acceptance ledgers — lands entirely
> inside §*What shipped*. The signed sections remain byte-identical apart from the 37 lines above.
>
> One consequence is worth stating plainly rather than editing away. The signed assessment says
> «17 documents in `docs/`» and «twelve of the seventeen documents carry 113 acceptance-criteria
> boxes that are all unchecked». That was true when it was written and verified. After this
> consolidation `docs/` holds three files — this one and the two bilingual articles — and the
> 113 boxes have been resolved into the ledger at the end of §What shipped. **The signed
> sentences were deliberately left as written**, because they are a dated observation that the
> consolidation acted on, not a claim about the repository as it stands today.

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
