# GFX-05 Stage B: posed contacts and transient admission

CPU implementation on the pinned joined base
`9a0e875a69e03acc84ec734d328d56ea78e3898f`. This is not the later moving
portrait/normal/capture branch, a browser/GPU result, a completed quality tier,
or human/default approval. Stage A remains in history; its environment and
compact-HUD implementation is not replaced.

The separately authorized NPC injury-stream fix follows the unchanged
`9c47cd68` implementation and `b931c40` reproduction ancestry. It fixes the
mode-dependent injury RNG gate described below; visual and complete
whole-frame/resource acceptance remain open.

## Contact routing

`ContactPresentation.ts` consumes the published `characterPresenter` and
`creaturePresenter` weak-map lookups. `sampleContact` fills reusable caller
scratch using the actual posed point, inverse-transpose CPU normal and physical
surface. No per-hit `getObjectByName`/scene traversal or rig mutation is added.
Missing, hidden and unarmed anchor rejection does not reuse a previous sample.

An already-admitted projectile intersection remains the primary point.
The existing collision-sphere center supplies its presentation normal; a bounded
set of cached body anchors selects available material identity, not a new hit
test. Hidden/absent anchors leave a projectile explicitly unclassified rather
than fabricate a posed success. Ordinary melee uses torso; shield contacts use
the posed shield. A sampled attacker weapon tip supplies a cosmetic incoming
direction and source material where available.

`DamageActorOptions` and `DamagePlayerOptions` carry optional
`presentationPoint`/`presentationNormal`. `DamageResult.presentationContact`
is additive and separately owned: it does not replace or mutate
`DamageResult.position`, `.direction`, projectile storage, poise, knockback,
death, contact eligibility or audio positions. Retained feedback copies the
scratch; synchronous secondary emission reuses it.

Contact origins distinguish `posed`, `projectile`, `admitted-legacy`,
`admitted-event` and `admitted-world`. Legacy roots without presenters retain
only the existing admitted point with unknown physical surface.

**Actual wagon API limitation:** on this base `WagonPresenter` has no
`sampleContact` method. Its existing weak-map lookup can identify a wagon
event fallback, but no posed wagon anchor is claimed. The event point remains
the admitted point. Existing homestead/fire event targets have no per-part
physical surface metadata and remain `unknown`; optional `presentationSurface`
can carry a known classification from a real future caller. A fire marker does
not imply that all building surfaces are wood.

World collision feedback samples `WorldSurfaceField.sampleInto` only when the
already-resolved contact is on existing terrain. Stone/paving, soil/grass,
water and bridge classification select secondary response without changing the
point or physical normal. Optical water depth and decorative bridge camber are
not new heights. Cover impacts without terrain metadata remain unknown.

## Bounded material response and primary cues

Metal produces restrained sparks; skin/hair produces small blood particles;
cloth/soil produces dust; leather/bone/wood/stone produces chips; water produces
small droplets. Known non-metal weapons against armor use chips rather than
metal-on-metal sparks. These are physical response colors, not faction colors.

All secondary kinds share the existing 48-slot opaque instance batch and its
quality/motion admission. Surface-normal-oriented scattering uses reusable
vectors. No light, per-actor material, new shader family or transparent particle
stack is introduced. The existing primary impact-ray pool is reused at the
sampled point, depth-tested and directionally oriented, with a smaller bounded
envelope and restrained reduced-motion size.

Real `damagePlayer`, `damageActor`, projectile, cleave and event-prop call sites
route the admitted contact. Zero-damage perfect guard emits a shield contact,
not a damage number or extra sound/hit-stop. Evasion, rejected/dead targets,
missing melee anchors and zero-damage non-defense contacts produce no new
physical burst. Each cleave target routes once; its summary retains the original
text/audio/hit-stop behavior and does not emit a centroid physical burst.

Existing injury/death/bleeding cosmetics retain their owners and population
ceilings. This change does not redesign dismemberment or change seeded combat,
event, loot, director, chronicle or world streams.

### Persisted NPC injury stream (fixed)

`GameEngine.generatedRngStreams.injury` is a dedicated gameplay stream derived
from `deriveSeed(blueprint.seed, 'gameplay:injury')`. The shared
`createGeneratedRngStreams` initializer in `random/GeneratedRngStreams.ts`
is called by the actual engine constructor in both visual modes. Its exact
record contains combat, director, event, loot, chronicle, rumour and injury;
the six existing labels/restore behavior are unchanged.

Only the two NPC injury decisions now read `injury.next()`:
`damageActor`'s existing detachment chance and `detachActorLimb`'s existing
ordered visible-limb selection, also used by the death path. No player injury
roll is moved off `combatRng`. Cosmetic variation, Three.js UUID construction,
render settings, skin/material construction and pool occupancy cannot consume
or influence this stream.

An eligible positive-damage, non-brute admitted hit with a nonzero detachment
option consumes one chance draw. If chosen, detachment consumes one additional
draw only when a visible limb exists. The selection still uses the same
`floor(next * visible.length)` rule and left-arm/right-arm/left-leg/right-leg
candidate order. Probability one still consumes its original chance draw;
zero/absent chance, rejected/dead/inactive, zero-damage, blocked, paused and
ended contacts consume none. A direct death-path limb choice consumes one
selection draw; an empty candidate set consumes none. Damage, hit-stop,
stamina, defense windows, visual body updates and death behavior are unchanged.

`saveGeneratedRun()` writes the current uint32 at
`ActiveRunSaveV3.rngStates.injury`. A stored value, including zero, restores
exactly. The existing free-form bounded RNG map accepts this additive key:
no save version/key/fingerprint change or destructive migration is needed.
Old valid saves without injury initialize it from the world seed, in either
visual mode, and persist it at their next ordinary save. This is a deterministic
starting point for the newly recorded stream, not reconstruction of historical
unrecorded global-random state. Other saved stream values remain intact.

The updated actual-engine regression observes stream states only through the
existing save API. Warm legacy, warm enhanced, test-only isolated-cosmetic
controls and cold enhanced allocations agree for all three seeds:

| Seed | First admitted hit | Saved injury state after the hit |
| --- | --- | ---: |
| 42 | Left leg missing; 20 damage, 80 HP | 4247260669 |
| 20260906 | Left arm missing; 20 damage, 80 HP | 316882220 |
| 20260910 | No limb missing; 20 damage, 80 HP | 4050900814 |

The tests still exercise real gore and cold Three.js constructors. Additional
cases serialize after multiple decisions, restore using the same constructor
initializer and compare subsequent fresh-NPC hit sequences in both modes;
they do not introduce an ordinary-NPC appearance save format. Old-save
acceptance, zero-state restore, exact chance/selection draw counts, no-limb
cases, real lethal selection, player defense/combat ownership and live visual
settings are covered separately. No production global override, ghost legacy
work, cosmetic-only partial isolation or dependency patch is used.

### Historical paired-mode reproduction (`b931c40`, before the fix)

At `b931c40`, `tests/contactPresentation.test.ts`, test **actual paired engine
modes reproduce global injury coupling; cosmetic isolation alone misses cold
UUID consumption**, executed the paths below. The current test is **actual
paired engine modes keep NPC injury independent of warm cosmetics and cold
UUID allocations**; it turns the same warm/cold controls into a regression for
the fixed stream rather than asserting the former divergent result.

The original reproduction executed the production `damageActor`, `createBloodBurst`, `acquireGoreParticle`,
`detachActorLimb`, presenter appearance replacement and enhanced secondary
emission. The actor's initial real presenter/pose and health are held constant;
64 real gore slots and, except for the cold control, the real secondary pool are
prepared before tracing. Audio/text/health-bar rendering boundaries are not
the injury implementation. This is a bounded call-path reproduction, not a
natural campaign or GPU capture.

The controlled global sequence is 0.1 followed by 0.95 values, with
`baseDamage=20` and `detachChance=0.75`. Every arm deals 20 damage and leaves
80 HP:

| Actual engine arm | Explicit hit-gore global draws before admission | Global admission draw | Result |
| --- | ---: | ---: | --- |
| Legacy contact path, warm allocations | 307 | 308 (0.95) | No missing limb |
| Enhanced material contact path, warm allocations | 0 | 1 (0.1) | Right leg missing |
| Legacy, real blood helper redirected to art randomness in the test only | 0 | 1 (0.1) | Right leg missing |
| Enhanced, same art-random blood control, warm secondary pool | 0 | 1 (0.1) | Right leg missing |
| Enhanced, same control, cold real secondary pool | 0 | 13 (0.95) after 12 UUID draws | No missing limb |

The isolated-blood control still executes the real helper. Its temporary
global-function override is test instrumentation only, not a proposed runtime
fix. The cold control constructs the real `SecondaryEffectPool` through the
engine; it demonstrates an additional consumer, not a hypothetical statement.

Affected locations in production checkpoint `9c47cd68`:

- `GameEngine.ts:11978`: NPC non-brute detachment admission,
  `Math.random() < options.detachChance`.
- `GameEngine.ts:12511`: visible-limb selection inside `detachActorLimb`.
  The death path calls this selection twice (three times for large bodies).
  Player injury admission/selection instead uses the existing `combatRng`.
- `GameEngine.ts:11954` calls hit `createBloodBurst` only in the legacy branch;
  its explicit global draws are at `16613`, `16622-16633`, `16644-16654`.
  The enhanced player hit branch likewise omits legacy hit-gore work.
- Remaining explicit cosmetic global consumers are death satellite positions
  (`12190-12197`), detached spray/velocity (`12517`, `12534`), callout
  chance/rotation/word (`16135`, `16150`, `16168`), legacy impact-ray rotation
  (`16317`), decal rotation/scale (`16710-16713`), and bleed direction (`16748`).
  Different prior gore occupancy also changes later accepted particle counts.
- Three.js `MathUtils.generateUUID` itself consumes four `Math.random` values
  at `node_modules/three/src/math/MathUtils.js:21-24`. `BufferGeometry:81`,
  `Material:51`, `Object3D:97` and `Texture:76` invoke it. Cold effects,
  new sprites/maps, geometry replacement and mode-specific art allocations
  therefore affect the same global source even when explicit art variation is
  isolated.

**Historical cosmetic-only proposal (not adopted):** route every explicit cosmetic
caller above in both legacy and enhanced paths through existing
`createArtStream(seed, label)` / `artVariation`, never through combat/event/loot
streams. This removes the demonstrated explicit warm hit-gore coupling without
editing the two injury roll sites or their probabilities. It does **not** prove
mode-independent injury while those sites still read global randomness:
the cold-pool control already fails because of Three.js UUID allocation.
Prewarming one pool would not cover later sprites, streaming or injury geometry.

The coordinator subsequently authorized the dedicated persisted NPC injury
stream documented above. That fixes the root cause rather than attempting to
control every implicit allocation consumer. The historical reproduction and its
raw log remain evidence of the original failure; they are not the result of the
fixed code. No broader cosmetic/global-RNG migration was made.

## Transient draw admission and inventory

`TransientEffectBudget` consumes
`resolveVisualSubsystemAllocation(getVisualPolicy())`: **44/24/20** transient
draws for High/Balanced/Low. The 16/16/0 post reservation is never donated.
Legacy remains uncapped by the enhanced tier allocation.

The engine prepares actual live source identities before its single post/direct
render call. Conservative costs account for geometry draw ranges, material
groups, submitted instances, transparent double-sided source draws and caster
depth submissions. The controller includes secondary particles, gore, smoke,
debris, decals, damage numbers, callouts, impact rays, weapon trail, rain/snow,
projectiles, telegraphs and pooled loot presentation.

Defensive/finale tells, projectiles and visible reward tokens are protected.
Contact rays/secondary feedback rank ahead of decorative callouts, gore,
decals and smoke. Only cosmetic render visibility is temporarily omitted;
simulation, timers, pool capacities and actor population are unchanged.
Original visibility is restored in `finally`, including a rendering failure.
Owned resources remain with their original pools; the controller does not
dispose borrowed sources and clears its own references at engine teardown.

If protected work alone exceeds a tier, it stays visible and `overBudget` is
reported instead of hiding an attack or inventing a pass. This situation needs
later batching/evidence, not a silently larger allocation.

`getTransientEffectInventory()` returns actual source identities and deduplicated
typed backing receipts charged to `postAndEffects`. Shared geometry and inactive
retained pool resources are counted once. Canvas-backed texture storage is
explicitly missing, not reported as exact `width * height * 4` allocation.
GPU uploads, complete retained/peak inventory and disjoint CPU scopes remain
unknown. The shared composer/shadow/canvas bucket is not charged again here.

The existing diagnostic `rendering.contacts` reports sampler/fallback counters;
`rendering.transientEffects` reports requested/admitted/omitted conservative
draw/triangle bounds, protected cost, `overBudget` and explicit missing data.
`measuredDraws`, `cpuMs` and `complete` do not pretend a source estimate is an
actual GPU frame. Persistent sky/cloud/fire attribution remains open.

## CPU evidence and remaining visual tasks

Targeted tests invoke real production samplers, generated world classification,
damage/projectile/cleave/event methods, perfect/rear/late defense and evasion
at all tiers, the actual primary-cue update, actual engine budget collection
and real logical-frame render failure cleanup. Negative cases forbid per-hit
scene lookup, mutate posed transforms, move disposed projectile storage,
reject missing anchors, saturate cosmetic pools and overflow protected tells.
The existing build/type/lint and combat/finale/diagnostic suites remain the
validation tools; no dependency or test framework is added.

There is no GPU/browser lease for this CPU task. Surface contacts in motion,
first combined visual review, grayscale/night/wetness/flare tuning, true
whole-frame/subsystem GPU and CPU accounting, physical-device budgets, live
390x844 focus/touch/text-scaling evidence and human approval still require a
separate serialized capture task. No AO or default promotion is included.
