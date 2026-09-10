# GFX-05 Stage B: posed contacts and transient admission

CPU implementation on the pinned joined base
`9a0e875a69e03acc84ec734d328d56ea78e3898f`. This is not the later moving
portrait/normal/capture branch, a browser/GPU result, a completed quality tier,
or human/default approval. Stage A remains in history; its environment and
compact-HUD implementation is not replaced.

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

**Pre-existing global-random boundary:** legacy hit gore, decals and callouts
use global `Math.random`, and NPC dismemberment also reads that source. Enhanced
material feedback replaces some cosmetic draws with the isolated `art:` pool,
so exact legacy global-random draw-sequence parity is not claimed. Gameplay
roll sites and probabilities are unchanged, but a deterministic replay that
monkey-patches global `Math.random` can choose a different NPC limb. This was
reported to the coordinator; no unauthorized gameplay-RNG migration or invisible
legacy-particle replay was added to conceal the coupling. Seeded stream and
damage/window invariants are covered separately.

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
