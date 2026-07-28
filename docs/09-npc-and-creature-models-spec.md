# 09 - NPC, Creature and Caravan Models

> Implementation-ready spec for wave 2A of КОРОВАНЫ's graphics overhaul. It replaces
> the placeholder humanoid — torso, head, two arms, two legs, one box blade — with a
> real procedural character system, rebuilds the four beasts, the ambient fauna and
> the caravan, and upgrades the animation that drives all of them.
>
> It builds on `docs/08-graphics-foundation-spec.md` and treats every rule in it as
> binding. It adds one module, `src/game/art/CharacterKit.ts`, and changes character,
> creature, fauna and caravan construction inside `src/game/GameEngine.ts`. It touches
> nothing the world pass owns.
>
> Creative north star, unchanged: **«Походный комикс, собранный кодом»**. Bold ink,
> angular low-poly shapes, confident faction colour, and **silhouette readability
> above everything else**.

## 1. Goal

Make a person in this game read as a person, and make three sides of a war read as
three sides of a war from thirty metres away with the colour turned off.

1. Anatomy: necks, shoulders, hands, feet, and a head with a face.
2. Faction vocabulary that survives a blind silhouette test — armour language,
   headgear, proportion and cloth behaviour, not just hue.
3. Role silhouettes: a brute, a scout, a commander and a peasant are four different
   shapes before they are four different stat blocks.
4. Gear layering: cloaks, capes, tabards, belts, packs, quivers, pauldrons, bracers,
   greaves and helmets as drawn shapes.
5. Deterministic body-type variation, so a line of twelve soldiers is twelve people.
6. A weapon family per faction and role instead of one box.
7. Beasts that read as dangerous animals, fauna that reads as wildlife, and a caravan
   worth naming the game after.
8. Motion good enough for the new geometry: idle, walk, run, attack, hit and death.

Everything stays 100% procedural. No GLTF/FBX/OBJ, no image files, no asset packs,
no new dependencies.

## 2. Scope and non-goals

### In scope

- `src/game/art/CharacterKit.ts` — new. Every geometry helper this pass needs, plus
  the deterministic plan resolver that turns `(faction, role, variant)` into a shape.
- `GameEngine.createCharacter()`, `applyActorVisualVariation()`, `createBeast()`,
  `createDeer()`, `createBird()`, `createCaravan()`, `createActorHealthBar()`.
- `GameEngine.animateCharacter()` / `animateActorCharacter()` and the death pose.
- The role-specific mesh surgery `spawnActor()` used to perform after construction.

### Out of scope

- The `src/game/art/` foundation modules. They are read, never edited. Anything this
  pass needs that they do not have goes into `CharacterKit.ts`.
- `GeneratedWorldRuntime`, `Materialization`, world props, terrain, ground cover.
- Lighting, atmosphere, tone mapping, bloom, the grade pass, weather coupling.
- The `new GeneratedWorldRuntime(...)` construction site in `GameEngine.ts`.
- Gameplay: hit points, speeds, collider radii, AI, spawn budgets, allegiance rules.
  Where a shape and a number disagree, the number wins and the shape moves.
- Save-format and visual-test compatibility. Early alpha; expectations are updated
  deliberately.

## 3. Verified baseline

| System | Before this pass |
| --- | --- |
| Humanoid | Seven meshes: a lofted torso, a lofted or lathed head, two arms, two legs, a merged blade, plus a helmet for guards or two horns for villains. No neck, no hands, no feet, no face, no cloak, no belt, no pack. |
| Faction difference | Torso colour, plus a hood on elves, a helmet on guards and horns on villains. Identical proportions, identical gear, identical weapon. |
| Role difference | `mesh.scale` only: brute `1.28/1.12/1.28`, champion `1.3/1.18/1.3`, archer/captive/peasant `0.9`–`0.94`. Archers got a torus bow bolted on after construction, peasants a recoloured torso, captives a hidden weapon. |
| Variation | `applyActorVisualVariation()` scaled `body-pivot` by a hash and offset the torso material's HSL. Three lines. |
| Materials | Three caller-owned materials **per actor**: faction, skin, dark. Twenty-five actors meant seventy-five materials. |
| Geometry | Nine cached keys shared by all actors, through `GeometryCache`. |
| Beasts | Wolf, boar, bear and troll were the same box torso, box head, cone snout and four box legs, separated by three scalars. |
| Fauna | Deer: nine boxes and six cones. Bird: four boxes and one cone. |
| Caravan | A box bed, a box crate, four cylinder wheels with two crossed box spokes, and two boxes standing in for a horse. Three bespoke `MeshStandardMaterial`s with canvas textures, outside the stylized family. |
| Weapon rig | `weapon` is a pivot on `torso-pivot` at a fixed point in space. The right arm swung independently, so the sword was never in the hand. |
| Animation | Arms and legs counter-rotate on one `stride` scalar; the weapon has its own uncoupled swing. No knees, no elbows, no wrists, no cloth. |

## 4. Design corrections

- **Do not vary a character by scaling it.** Scaling `body-pivot` non-uniformly is
  what made every actor look like the same doll under a lens. Variation has to change
  *proportion ratios* — shoulder width against hip width, limb length against torso
  length, head size, stance — which means it has to reach individual pivots.
- **Do not build one geometry per actor.** Twenty-five actors alive at once is the
  budget. Shape variety comes from a bounded set of cached *variants* selected
  deterministically, plus per-actor pivot proportions, which cost nothing.
- **Do not mutate a shared material to tint an actor.** The old code called
  `material.color.offsetHSL()` on a per-actor material. Moving characters onto shared
  `acquireMaterial` entries — which is required to get seventy-five materials down to
  a dozen — makes that a scene-wide recolour bug. Tint variants are *selected*, not
  *mutated*: four pre-mixed cloth tints per faction, chosen by the actor's own stream.
- **Do not put a face on with vertex colours.** Spec 08 §6 forbids vertex-coloured
  character materials because rig meshes arrive from several places in `GameEngine`
  and one will eventually arrive without the attribute. Faces are built from *geometry*
  — brow ridge, nose, cheekbones, sunken sockets, jaw — plus one small dedicated
  `face` mesh carrying eyes and mouth on the dark material.
- **Do not add per-actor draw calls without paying them back.** Every mesh is also an
  ink shell. Detail that only reads up close — face, hair, torso trim, bare hands —
  lives under a `THREE.LOD` that swaps to nothing past 26 m, so a distant actor costs
  fewer draws than it does today while a near one costs more.
- **Do not reparent the weapon into the hand.** It is tempting and it is a trap:
  `attachTorch()` parents a torch to `weapon`, the player's weapon trail is a child of
  `weapon`, and `updateShieldPose()` writes absolute local coordinates into `shield`.
  Instead the animation *writes the weapon pivot's position each frame* from the arm's
  own rotation, so the grip tracks the hand while the pivot stays a direct child of
  `torso-pivot` at hand height, where the torch and the trail expect it.
- **Do not add a joint the animation cannot use.** Elbow and knee pivots are added
  because the walk, the attack and the death pose all drive them. Fingers are not.
- **Do not root a joint anywhere but at the joint.** `head-pivot` shipped as a
  *sibling* of `torso-pivot`, both at the actor's origin — the ground between the
  feet. At rest that is indistinguishable from a neck, so it passed review and every
  test in the file. Under the plan's own `lean` the chest swings forward through the
  2.12-2.34 m from the ground to the shoulders and the head, on a pivot that never got
  that rotation, stays where it was: measured at **0.4992 m** on a standing brute and
  **0.6603 m** walking, against a head 0.66 m deep. Only actors showed it, because
  `animateCharacter` — the player's only pose pass — never writes `torso-pivot`. The
  head now hangs off the chest at `shoulderY`, which also makes six existing terms
  mean what they say: `head-pivot`'s rotations are written as the opposite sign of
  `torso-pivot`'s, and a partial counter-rotation only makes sense against a
  transform you inherit. The one term that is *not* a counter-rotation is the look
  yaw, which tracks a target rather than resisting a posture, so it is converted into
  chest space by `solveHeadYaw` — a solve rather than an offset, because the chest
  pitches and rolls as well as yawing. Measured over the 6,174,630-state cross-product sweep the tests run -- an upper bound over a superset, since the engine's terms are correlated: **43.64°**
  of gaze error uncorrected, **20.30°** with the obvious scalar `lookYaw - chestYaw`
  (which is *worse than nothing* in 3.90% of them), exact solved, and **9.71°** if the solve is denied the head's own pitch. Every one of those four figures is computed by the committed sweep and pinned to a hundredth of a degree, because the previous three sets were measured by hand under mutation and all three were wrong by the time they were read. Damp the
  tracking in body space and convert instantaneously — a frame change is not a motion,
  and damping the converted angle costs 2.0° of wobble at the gait's real 4.00 Hz.
  Correspondingly, **do not test a rig without posing it** — every assertion that
  reads a body at rest is blind to this whole class — and **do not test position
  without testing orientation**: the gaze defect passed a rigidity test that measured
  only where the head sat. Sweep a state space rather than a list of named poses; the
  first hand-written pose table here overshot the reachable chest yaw on one side and
  fell 2.9× short on the other.

  Worth stating plainly, because it is why the rule is *do not test at rest* rather
  than merely *test more*: **the bug and the test that should have caught it share a
  blind spot, and it is the same blind spot.** At rest a joint at the feet is
  indistinguishable from a joint at the neck — that is simultaneously why the defect
  shipped and why no assertion that reads a resting body could ever have found it.

  Both rules above are instances of one, and it earned the generalisation the hard
  way — by recurring a third time *after* the first two were written down:

  > **A rig has more degrees of freedom than your assertion does, and the ones you
  > omit are where the defects live.**

  Omit the pose and a joint at the feet passes for a neck. Omit orientation and a
  head sits perfectly on its neck while looking somewhere else. Omit the head's own
  *pitch* — one axis, in a sweep written by the same author, two commits after both
  rules above were added to this file — and `solveHeadYaw` measures as exact while
  being **7.3°** wrong for every head the engine actually writes, because the engine
  applies that pitch in the same Euler as the yaw it solves for. Knowing the rule is
  not the same as being able to see where it applies; the only reliable instrument is
  to drive every axis the production code writes, including the ones you are confident
  cannot matter. Head *roll* genuinely cannot — a rotation about Z leaves the +Z axis
  fixed — and the sweep drives it anyway, so that claim is measured rather than
  asserted.

  Two pieces of evidence that the child arrangement was the original intent and the
  wiring was the defect. Six animation terms are written as the *opposite sign* of the
  chest's, which only means anything against a transform you inherit. And
  `animateDeath` writes `head-pivot.rotation.z = side * 0.28 * eased` to loll a dying
  actor's head: about the feet that swung the skull **0.8094 m** sideways, clean off
  the body; about the neck it lolls **0.1563 m**, which is what that line was always
  trying to say.
- **Inherit what the joint physically transmits; cancel what it does not.** A neck
  hangs off a chest, so it inherits everything a chest does to it — and
  `torso-pivot` carries the actor's shoulder width on `scale.x` as well as the
  breath on `scale.y`. The breath is *correct* to inherit: a chest lifting a head as
  it inhales is a body working. The shoulder width is not, because it is a property
  of the shoulders and not of the neck, and `headScale` is already the one thing that
  sizes a skull. Anatomy is the discriminator here, not a magnitude — deciding by
  "how big is the artifact" would have kept the wrong one and dropped the right one,
  since both are around a percent. Measured across all 30 faction x role plans (21 distinct proportion sets) and the whole look
  envelope: **8.59%** head anisotropy with the width uncancelled, **1.00%** with it
  cancelled, and that 1.00% is the breath to six decimals -- the closed form is exact, the grid simply never samples the identity rotation that attains it.
- **Cancel a scale above every rotation, never below one.** A scale and a rotation do
  not commute, so a cancellation applied *downstream* of a rotation is valid only in
  the rest pose. Putting the width correction on `head-pivot`, which the animation
  yaws by up to 0.65 rad, left **6.05%** at full yaw — *worse than the 3.00% of doing
  nothing* at some angles. `neck-pivot` exists so the correcting node never rotates,
  which removes the angle-dependence rather than bounding it. The same shape of error
  reappeared one commit later in the gaze, as `lookYaw - torsoPivot.rotation.y`: one
  Euler component subtracted from a rotation that has three. `solveHeadYaw` answers
  that exactly instead of approximately.
- **Do not derive an assertion's bound from the quantity the defect moves.** The
  head-hinge test first bounded the head's swing by `skeleton.headY` — but a rig
  regression changes `headY` too, so the bound grew in step with the damage and the
  assertion could not fail for any input. It is a distinct failure from a vacuous
  check and from one that is blind in a range: it is *self-scaling*, it tracks the
  defect exactly, and it looks correct because the formula is correct and the number
  is correct. The bound now comes from `p.headY - p.shoulderY`, an input the defect
  cannot touch. Only the mutation run exposed it; no amount of reading would have.
  The same rule retired the anisotropy bound's round 2%: the only thing that legally
  reaches the head is `torso-pivot.scale.y`, a pure-Y scale, so the bound is
  `1 / (1 - 0.018 * 0.55) - 1` — the breath's own closed form, which the measurement
  matches to six decimals, the gap being a grid that misses the maximising pose rather than a loose bound. A 0.3% contaminant reads 1.30% and now fails; under
  the round 2% it passed.
- **Do not adopt a number you could not reproduce.** The gaze skew bound quoted a
  reviewer's jointly-reachable coefficient of 4.81 where an independent enumeration
  here had measured 6.68, and resolved the 39% disagreement by deferring rather than
  reconciling. The reviewer caught its own number being taken on trust and named it as
  the same defect class as the rest: *a claim adopted rather than verified*. 4.81 was
  right, but being right by deference is indistinguishable from being wrong by
  deference until someone checks. Reconcile, or state both figures with both methods
  named; never present one as settled because its author outranks you.

  The worked example runs one step further than it looks, and the extra step is the
  useful half. The *first* reconciliation — offered confidently, in this rule, about
  verification — blamed `pose.stride` being zeroed under stagger. That was wrong twice
  over: `torsoPivot.rotation.y` reads `actor.stride`, not `pose.stride`, and a stagger
  *damps* `actor.stride` rather than clearing it, so the first frame of a stagger keeps
  about 81% of its gait yaw. The same reviewer caught that too. The *second* blamed head
  roll being swept to a value only a flinch can produce, which is a true engine fact
  about an unreachable state and still not the cause: head roll cannot affect this
  heading **anywhere**, not merely at the measured maximum. Sweeping it across arbitrary
  chest states moves the result by at most 2.4e-14°, because a Z-rotation fixes the +Z
  axis and every scale in the chain sits above it. Saying "the maximum is roll-degenerate"
  would be true and would still mislead, by inviting the thought that some *other*
  maximum might be roll-sensitive. And that claim was refutable with no measurement at
  all: `solveHeadYaw` takes no roll argument, and its docblock says why — written ten
  commits before the paragraph that blamed the axis, by the same hand.
  What *is* established is that the enumeration was **partially joint**: it constrained
  some axes by the reaction and left others as free cross-product ranges. **Enforcing
  joint consistency on one axis and believing it enforced on all of them is its own
  defect**, and a partially-joint sweep is indistinguishable from a joint one from the
  outside. A factorial design then isolates the contributor, because a probe that moves
  two things cannot attribute what it sees: relaxing one constraint at a time gives
  4.8203 fully joint, 4.8203 with head roll freed, 5.7018 with chest pitch pinned at its
  axis maximum, and 6.0420 with chest roll pinned at its. **Head roll contributes exactly
  zero — provably, since a Z-rotation fixes the +Z axis and every scale in the chain sits
  above it — and chest roll is the dominant term**, three times its jointly reachable
  bound. That ranks the axes that were *free*, not the axes the bound is sensitive to:
  pinning chest yaw gives 5.9876, between the other two, but yaw contributed nothing
  because it is the one axis the original sweep constrained correctly. **Sensitivity and
  contribution are different quantities, and only the second explains a wrong number.**
  An earlier version of this paragraph named chest pitch, the second largest.
  Naming the second biggest contributor is the same defect as naming an inert one and is
  harder to catch, because a plausible-sized effect in the right direction reads as
  confirmation.

  That baseline read 4.9199 for one commit and was itself **partially joint**, which is
  the fourth instance of this defect and the first inside the paragraph describing it.
  `idleWeightShift` is `sin(...) * 0.035 * (1 - motionBlend)`, so at the maximum's
  `motionBlend` of 1.18 the engine allows `|shift| <= 0.0063` while the harness allowed
  0.035 — and that term feeds chest roll, the very axis the design was isolating. **A
  factorial design is only as good as its baseline, and a baseline is a reachability
  claim like any other.** The remainder of the original gap is
  still unaccounted for, and naming chest pitch as *a* demonstrated contributor is as far
  as the measurement goes.

  Three causes, from three people, for one number — and the number was right throughout.
  That yields a sharper rule than "verify your causes": **a number surviving attack is
  not evidence that any story about it is true.** The justification is the part nobody
  re-measures, precisely *because* the number it explains has already been checked, so
  the number's correctness lends unearned credibility to the story attached to it. When
  a cause cannot be reproduced, say that, rather than reaching for the next one.
- **Review the justification, not the fix.** Code written in response to a review is
  the most defective code in a change set, and the head-rig work has the base rate to
  say so: every finding in that window landed on a *claim written in the act of
  correcting a previous claim*. The mechanism, which a reviewer named and which is what
  makes the rule predictive rather than descriptive: **the fix gets reasoned carefully
  and the sentence explaining why the old thing was wrong gets written in the same
  breath and never independently checked.** The author is at their most certain and
  least sceptical at exactly the moment they are writing prose about their own error.
  So a review pass over review-response code should go straight at the justifications —
  the docblock that says *why*, the commit message's causal clause, the comment naming
  a mechanism — and treat the fix itself as the part most likely to be right.

  Concretely, from the head-rig work: a reachability model asserted in this document
  while explaining a reconciliation; an attribution to the wrong reviewer written
  while correcting an attribution; a change credited to the wrong variable in a commit
  whose entire subject was honest measurement; and, twice, a cause named for a
  discrepancy that measurement showed the named variable could not produce.

  An earlier version of this rule said *"every finding in that window landed on a
  claim"* and *"none in the code being explained"*. Both are false, and a reviewer
  falsified them with findings the same window had already accepted: an unanchored
  source pin that passed against `= headPitch * 0.5`, an order-blind cadence pin that
  passed with two roles' values swapped, and a float-accumulating loop visiting 396
  poses while four places called it 462. Those are code. **The rule's own summary
  sentence exhibited the defect the rule describes**, which is the most direct
  evidence available that the mechanism is real and that a rule is not a defence
  against it. The rule is about where to *look first*, not a claim about where every
  defect lives.
- **What is the population of the thing this pins, and am I sampling it or enumerating
  it?** This is the question that would have caught more defects in the head-rig work
  than any other, and it kept recurring because the answer is almost always *sampling*
  and the sample is almost always **the one that was in front of the author**.
  It appeared as one plan standing in for twenty-seven, one pose for four hundred and
  sixty-two, one grid corner for a joint set, one stride and one delta for a function's
  domain, the positive half of an axis for the whole axis, one call site for the three
  that exist, one placement for everywhere a write can land, one pivot for the two a
  derivation names, one function's scope for a property that has none, and one argument
  of a call for its argument list. Every one was cheap to enumerate.
  Three refinements earned by repetition. **The axis you were shown gets enumerated and
  the axis nobody complained about stays a sample** — so ask which axes a thing has, not
  whether you swept the one that broke. **Enumerating an axis at two points is
  enumerating the points**, which a clamp sitting on a sample point will demonstrate.  And **does the enumeration cover the whole of each axis, or the part the
  demonstration used?** A stride sweep once ran `0.01 … 1` under a comment correctly
  naming its population as `±0.62` — the domain was stated accurately in the sentence
  justifying the enumeration, and the enumeration covered one side of zero, because
  every mutation ever shown for that function had used a positive stride.
  The generalisation that ties this to the instrument rule above: **every guard
  enumerates the failure that was demonstrated to it.** The three mutation guards, the
  axis sweeps and the scope of each ban all have that shape, which is why a fix's
  coverage should be derived from the domain rather than from the report that prompted
  it.
  And the form with time as the axis, which is the one that closed the sequence: **a
  lesson gets applied forward to the thing in hand and not backward to the thing that
  taught it.** A two-point pin on one axis produced the sentence *"enumerating an axis
  at two points is enumerating the points"*; that sentence was then applied to the axis
  being worked on and never carried back to the axis that had taught it, so it sat
  forty lines above a pin in exactly the state it describes. **When a lesson is
  written down, the first place to apply it is the case that produced it.**
  And it applies to *fixes* as much as assertions: a fix scoped to the instance that was
  reported has inherited its sample from the report.
  The corollary that took two people to see: **the population has as many dimensions as
  the claim has inputs, and the one you framed the question in is the one you will
  enumerate.** Two harnesses were built within an hour to check the same equivalence
  claim about a pose function. One swept 441 poses and left the Euler order at its
  single default; the other swept all six orders and left the pose at one point. Both
  framings were reasonable, both were one-dimensional, and each enumerated exactly the
  axis its author had framed the question in. Neither was careless; the question was.
  A third party then supplied the mechanism, from its own instance rather than from
  observing ours: **a sweep proves coverage of the dimensions it varies and says nothing
  about the ones it holds fixed — and the fixed one is usually the one the change is
  about**, because the variable a change exists to control reads as *background* rather
  than as an input. It had overruled a request for another review pass by citing 51,480
  swept states as evidence a closed form was safe; that sweep held the head's pitch at
  **zero**, which is precisely where the form was already correct. The same shape as the
  441 poses at a single Euler order, in the artefact whose entire job was to establish
  safety.
  Hence: **a large state count is not coverage, and the count is what makes it
  persuasive.** 441 × 1 and 51,480 × 1 are both impressive numbers and both
  one-dimensional in the dimension that mattered. The number reports the product of the
  axes that were swept; it cannot report the axes that were not.
  And the closing form, which explains why every rule above kept failing against people
  who were actively applying it: **verification and scope are orthogonal, and verification
  is the cheap one.** A claim can be measured, reproduced, counted, committed and quoted
  back with every step sound, and its scope never enters any of them. That is exactly what
  happened to the entry two sections down: an observation about guards was measured,
  verified, committed, and the counterexample to it sat in a review pass the author had
  read and replied to. **Measuring a claim does not examine its scope**, so the step both
  parties always ran was never the step that would have caught it — which retires
  *"verify rather than accept"* as the discipline and puts the population question in its
  place.
- **A documented exclusion is a decision; the same exclusion carried into a different
  assertion is a sample.** The subtlest form of the question above, and the one with no
  usual tell. A gait table excluded three roles from a wobble simulation for written,
  correct reasons — one duplicates another, one has speed zero and does not walk. Those
  reasons justify excluding them from a *simulation of gait*. They say nothing about
  whether their constants should be *checked*, and one of the three had a speed of zero
  that nothing verified at all.
  What makes this hard to see is that the scope arrives **pre-justified**: there is an
  explanation sitting right beside it, it is sound, and it is answering a different
  question. The documentation makes the subset look more rigorous rather than less,
  which removes the tell that normally prompts the question — an unexplained subset.
  **When a scope travels from one assertion to another, its justification does not
  travel with it.**
- **An instrument fails silently, and you catch it by looking at its output rather than
  at its verdict.** Checking work with a script, a grep or a mutation harness is only as
  good as the script, and a broken one does not announce itself: it returns a clean,
  plausible, wrong answer. A sort check anchored on a name absent from the file measured
  an empty slice and reported *sorted: true*. A mutation that never applied printed
  *22 pass, 0 fail*, which is exactly what a working guard prints. A regex over-escaped
  for the shell returned zero hits, which reads as *the pins are gone*.
  The tempting generalisation — that instruments err toward "nothing wrong" — **is
  false, and was refuted by a session that built one.** A case-insensitive grouping
  invented three duplicates that did not exist; a culture-aware sort reported four
  blocks unordered that were correctly ordered under the comparator the file uses.
  Direction follows the comparator's bias and is not invariant.
  What is invariant across every instance either session recorded: **not one was caught
  by the verdict. Every one was caught by looking at what the instrument actually
  produced** — a count, a diff, a matched line — and noticing it contradicted something
  already known. So the operational forms are all the same shape: confirm a mutation
  applied *and compiled* before believing a test result; confirm a query matched
  something before believing a null; assert a parse found the expected order of
  magnitude of items before believing anything about them, and put the count in the
  failure message. **A detector must be made to fire on doped input before its silence
  on real input means anything.**
  **And that is only half of it, which took eighteen passes and an outside session to
  see: doping proves a detector fires. It says nothing about the population it was aimed
  at.** Every rule in this section — can the assertion fail, did the mutation land, did it
  compile, name the instrument, name the population of the count — tests a detector's
  *sensitivity*. Not one asks whether it was **pointed at the right set**. The instance:
  a workflow guard opened a file only if that file already deployed Pages, and was proved
  with six doped inputs, all six mutations of a deploying workflow. Six controls, six
  catches, and near-zero information — because the controls were drawn from **inside the
  filter they were meant to test**, and a control drawn from inside a filter can only
  confirm it. The real hazard was a workflow that mentions Pages nowhere and shares a
  concurrency group, which is exactly the file the check was structurally guaranteed never
  to open.
  This sits above the mutation ladder in the same position the *did-it-land* premise sits
  above the rungs: **a precondition the ladder cannot see, because every rung is climbed
  inside it.** So the question to add is not about the assertion but about its reach —
  *what does this detector never look at, and is the defect more likely there?*
  **That applies to tools nobody wrote as much as to detectors someone did**, and this
  repository contains the proof. `tsc --noEmit -p tsconfig.json` looks like a type-check
  and is not one: the root `tsconfig.json` is `"files": []` plus project references, so
  without `--build` the command compiles **zero files**. Measured with a positive control —
  `export const wrong: number = 'definitely a string'` — it exits **0 with no output**,
  while `tsc -b` exits **2** and names `TS2322` on the same file. Every green that
  invocation has ever produced was a measurement of nothing, and it was quoted in
  discussion for hours as evidence that a duplicate re-export type-checks cleanly. What
  actually gates is `tsc -b`, which `npm run build` runs.
  The general form caps a rule that sounds sufficient and is not: *name the instrument and
  the claim cannot outgrow it* — **except that naming an instrument implies it does what
  its name suggests.** A named instrument bounds a claim only once it has been shown
  **capable of a different answer**. Nobody dopes a compiler, because its name is taken as
  its specification, which is exactly the condition under which a vacuous one goes
  unnoticed indefinitely.
  **A sibling session then took that generalisation and earned the negative result.**
  `npm run build` runs `tsc -b`, then `tsc --noEmit -p tsconfig.test.json`, then
  `vite build` — two type-checking commands, neither ever shown capable of failing. Doped
  one file per surface with a blatant type error, application confirmed before the result
  was read, each file restored byte-exact: `src/game/art/index.ts`,
  `tests/deployWorkflow.test.ts`, `scripts/AudioDirector.test.ts` and `vite.config.ts` each
  took the build to **exit 2 with `TS2322` naming the file**. Population: **84 tracked
  `.ts`/`.tsx`, 84 under an `include`.** So only the ad-hoc short form is vacuous, and the
  gate everything here depends on is sound.
  That is worth recording precisely because it is a **negative result**, which nobody
  earns: there was no reason to doubt it, which is the same condition the vacuous
  invocation had survived under for the life of the repository. Had it come out the other
  way — `tsconfig.test.json` mis-including, so `tests/` was never checked at all — it would
  have been the largest finding of the programme, **and the green would have looked
  identical.**
  The same session declined to build a companion check, and the reason generalises: a
  guard that every `.ts` sits under an `include` could only fire when a file appears
  outside `src`, `tests` and `scripts` — a location nothing imports and nothing bundles.
  **An instrument that can only fire on something harmless is nearer to theatre than to a
  gate**, so the absence is documented with its reason instead.
  That rule has a ceiling, and it is worth stating beside it: **a positive control
  validates the instrument against the model, never the model against reality.** Dope a
  checker that holds a wrong model with a defect *its model recognises* and it fires
  correctly, the control passes, and the model stays wrong — so a doped control cannot
  catch a checker asking the right question about the wrong object. The instance that
  produced this: a sort check modelled the barrel as one sorted list when the file's
  actual convention is per block, values then types. Its control passed and its verdict
  was noise. What catches that class is the signal such a checker emits and its author
  discards: **a detector firing broadly on input everyone believes correct is evidence
  about the model, not the subject.** "The whole list is unsorted" on a file nobody had
  complained about was the model announcing itself, and it was read as sloppiness.
- **A measurement is a claim with a timestamp nobody writes down.** Every other rule
  here targets claims that were wrong. This one is about claims that were *right and
  stopped being* — which is a different failure, because a measurement carries its own
  authority and no expiry date, so nothing about it invites re-checking.
  It fired repeatedly during the head-rig work in both directions: a reviewer supplied
  gaze figures that were correct for the tip it read and stale by the time they were
  read, by the identical mechanism it was reporting on; a claim that a commit was in
  `main` was false when made, true fourteen minutes later, and corrected in both
  directions inside one exchange. Neither party was careless — one needed a check, the
  other needed a timestamp.
  The mechanical form: **do not carry the value, carry the way to re-derive it.**
  `git log --oneline -1 origin/main` costs nothing and is never stale, where a SHA in a
  message has a shelf life of minutes on an active repository. In a test, the same rule
  is why a figure computed by the assertion that quotes it cannot go stale without going
  red, and a figure copied from a mutation run can.
  There is a sharper case, and review is where it lives: **a report is an input to the
  thing it reports on, so an effective review invalidates its own baseline.** The final
  pass of this work opened by stating a branch tip as unchanged since the previous pass.
  It was six commits behind, and the newest of those commits existed *because of that
  reviewer's own previous message* — it had been pushed under two minutes before the
  claim was written. Nobody was careless; the review worked. That is the point. The
  usual reading of staleness is that time passes and a number decays, which suggests a
  slow-moving hazard. Here the decay was **caused by the report**, so the more useful a
  review is, the faster its own tip claim expires — and the reviewer is the one party
  who cannot see it, because the effect lands after they stop looking. The remedy is the
  same one line, but the trigger is different: re-resolve at the moment of *writing the
  close*, not at the moment of measuring, because the interval that matters is the one
  the review itself opened.
  **That narrows the window and does not close it, and the reviewer it was written for
  said so.** Re-resolving late shrinks the gap from turn-duration to send-to-read
  latency, which is bounded below by nothing either party controls. That was an argument
  when written; it now has a measurement. A pull request was read as
  `OPEN / MERGEABLE / CLEAN` at **21:12:34Z** and merged at **21:12:38Z** — the reading was
  accurate for **four seconds**, taken by someone who had measured rather than quoted,
  re-run after a rebase, and reported the instrument and the time. **No amount of care
  makes a distributed state claim outlive its own transmission**, and four seconds is the
  observed floor rather than a hypothetical minute. The durable form is not timing but
  **tense**. *"Tip `abc1234`, unchanged"* is a present-tense assertion about the world at
  read time and has a shelf life; *"verified `abc1234` at 21:56"* is an assertion about
  the past, is still true tomorrow, and silently tells the reader it may no longer hold —
  which is the honest content of both. This is *carry the derivation, not the value*
  applied to grammar rather than to method, and the two compose: **re-resolve late and
  report in the past tense, and there is no window at all.**
  The two halves do different work and it is worth knowing which: **a command tells the
  reader how to re-measure; a timestamped past-tense claim tells them that they must.**
  The first is a capability, the second is an obligation, and only the second travels with
  the sentence. And the reason the present tense is seductive rather than merely
  incorrect: **it has no expiry field at all**, so a bare state claim reads as durable
  precisely because it offers nothing to date it against — the same property that makes a
  measurement carry authority without inviting a re-check.
  There is a hierarchy under this worth stating, because the worst member does not look
  like a member. **A quoted state is a measurement with someone else's timestamp on it**,
  and it is worse than your own stale reading because you cannot see how old it is. **A
  recalled fact is a quote with no timestamp at all**, and it is worse again, because it
  does not present as a reading: a quote announces where it came from, while memory
  arrives as knowledge and so never prompts the question the rule depends on. The instance
  that fixed this: a session was mid-way through correcting another's claim about a CI
  configuration key — confident, specific, and from recollection — and checked the schema
  first only out of habit. **The other party was exactly right, down to the default
  value.** A correct claim would have been corrected by a wrong one, and nothing in the
  process would have flagged it, because a recollection has no `--json` flag.
  The same hierarchy has a form for delegated work, and it cost a session two false
  reports before anyone checked: **a delegated review reports "I examined X and found
  nothing", or it has not reported.** A review that was created and never ran leaves the
  same trace as one that ran and found nothing — silence — and silence reads as assurance.
  The instance was caught by a liveness probe, not by any rule: a delegated reviewer
  created at 21:32:31 with `updated_at` frozen fourteen seconds later and nothing produced
  in fifty-five minutes, already reported twice as delegated. **Absence of findings has to
  be distinguishable from absence of the reviewer**, and only an affirmative statement of
  scope does that — *a silent reviewer is a recollection with no rememberer.*
  With one condition that is easy to miss and makes the difference between the form
  working and merely looking like it works: **the timestamp has to be the measurement's,
  not the sentence's.** A past-tense claim carries exactly one fact the present-tense one
  lacks — *when* — so a timestamp taken from the clock at authoring time is decoration,
  and re-introduces the decay it was adopted to remove. The mechanical form is the same as
  everywhere else here: **emit the timestamp from the command that took the measurement**,
  not from the writer.
  **This rule was derived from an instance that did not exhibit it, and the correction is
  worth more than the example was.** One party read another's *"verified at 22:40:07"*
  against a superseding commit timestamped 22:38:39 and concluded the hour was the
  author's; a stated interval of 12 seconds was likewise read as wrong against a measured
  113. Both readings were mistaken. The 12 was anchored to the *resolve* and the 113 to the
  *previous commit* — two correct measurements of different gaps — and the timestamp had
  in fact been emitted by `Get-Date` inside the same invocation as the gates, after they
  finished.
  What makes this worth keeping rather than deleting is why the error was not avoidable:
  **a timestamp in prose carries no evidence of its own provenance.** From the reader's
  side the sentence is byte-identical whether the clock was the instrument's or the
  author's. So the rule **cannot be verified from the artefact, only from the practice** —
  which is the same shape as *verify the mutation, not just the outcome*, and a stronger
  justification for the rule than a genuine violation would have been. A correct
  conclusion arriving with a wrong supporting story is this catalogue's most repeated
  event, and the story is the part nobody re-measures, because the conclusion already
  passed.
  And the tense fix has a limit found in the same episode, worth stating beside it:
  **a past-tense claim cannot decay, but its referent can cease to be resolvable.** The
  commit that reviewer verified was dropped when this branch was rebased — it exists in no
  branch, reachable only from one worktree. The claim about it is still true and always
  will be; the object it names is gone from shared history. So *"cannot go stale"* is
  precise about the claim and silent about the subject, and a claim naming a SHA should
  name one that will still resolve, or say what it was verified *for*.
  That has a decidable test rather than being advice: **is the SHA an ancestor of the
  default branch?** A merged commit is permanent and a branch-local one is not, which is
  the whole difference between the two references this document has held. Applied to the
  only real SHA in this file — the `loftProfile` fix cited below — it resolves, is
  contained by `main`, and is therefore safe to cite; applied to the orphan above, it
  fails. One line of `git merge-base --is-ancestor` separates them, which makes this one
  of the few rules here that is a check rather than a sentence.
  A reviewer put it more precisely than that, and the distinction is worth a maintainer's
  attention: **it is the only rule in this document whose verdict is computed rather than
  judged.** Every other entry needs a reader to decide whether it applies to the case in
  front of them. This one decides itself, on any SHA, without knowing anything about the
  claim it sits in — which is the *call site rather than sentence* property arriving in
  the one place nobody was trying to apply it.
  One more thing came out of measuring that gap, and it is the sharpest instance the work
  produced because every party measured and every party got a different answer. The
  question — *is a reviewer's baseline falling further behind?* — was answered three ways
  from the same commits within one hour: **self-sustaining** (asserted, unmeasured,
  refuted); **7 → 5, converging** (measured, but across two of the four passes, because
  the author measured against the last report he had read — a report standing in for the
  set of them); **7 → 5 → 3 → 2, converging faster** (measured across all four, but the
  last two against a fixed tip rather than "the tip at that moment", which was the stated
  definition); and under that definition applied consistently, **7 → 5 → 6 → 6 — a steady
  state**, which is neither story. What the data supports is weaker than any of the three:
  the gap is **review-caused** — every commit in it exists because of a report — and it
  neither closes monotonically nor stays open. A fourth series measured live rather than
  reconstructed ran `1, 1, 0, 1, 1, 0` — **one observer, one branch**, with transitions in
  both directions twice each. And one further fact makes those points measure the thing
  this entry is about rather than something adjacent: they were taken across **six
  different HEADs**, each the tip the observer had just been handed, never their own work.
  So the quantity is the **reviewer's-eye gap** — how stale the thing a reviewer is holding
  is at the moment they measure it — which is the staleness this section concerns. An
  author's own branch against `main` is a different quantity and a less relevant one.
  Two observations in the same direction, published as a

 pattern, refuted by a third measurement the observer had  no particular reason to take, and oscillating within `{0, 1}` across two more. **That is  a direction read off a two-point sample, in a claim about the defect of reading
  directions off samples**, and it is the fourth wrong answer to this question by the third
  party to attempt it. Anything sharper than *review-caused, non-monotonic* has been wrong
  every time it was stated; the six points support only *small, bounded, non-zero on
  average*.
  **And an earlier version of this sentence recorded that series as `1, 1, 0, 1, 0`,
  because its last point was taken from a different worktree.** Two participants were each
  measuring their own branch against `main` — different HEADs, therefore different
  quantities — and four points from one were joined to a fifth from the other, producing a
  series that never existed. That is the splice defect described two paragraphs above,
  committed inside the entry that describes it, by the author who had just corrected
  someone else for it. **A series has an observer as well as a definition**, and neither
  the numbers nor their agreement reveals when the observer changes.
  So: **a claim about a trend has two populations — the points, and the baseline each
  point is measured against.** Enumerate the first, let the second drift, and the trend is
  real in the arithmetic and absent in the world. Neither error here was careless; both
  were caught only by recomputing from the raw commits, and the third answer was not
  proposed by anyone until then.
  The reviewer then found its own error was worse than the drift it had been diagnosed
  with, and the mechanism is the part worth keeping. All of its points used a *fixed*
  baseline; its first point was not computed at all but quoted from the other party, who
  had used a moving one. Applied consistently its method gives **9 → 5 → 3 → 2**, and its
  own first point disagrees with the published 7 by two. So the series was **two
  definitions spliced**, not one definition drifting.
  Why the splice was invisible is not luck. Measured over all four points, exactly one —
  the second — returns the same value under both definitions, because the fixed baseline
  happened to *be* the moving one at that moment. **The series therefore read as coherent
  because the only point where the two methods cannot disagree sat exactly where a reader
  checks for a seam.** The general form is the positive-control rule pointed at
  methodology: **when two methods are spliced, agreement at a point where they must agree
  is not evidence of anything — verify the seam where they must differ.**
  And both parties committed the same underlying act within an hour, in different
  materials: a PR status carried into a freshly timestamped block, and a gap figure
  carried into a computation it was not produced by. **A value borrowed into a fresh
  context reads as fresh**, inheriting the credibility of its neighbours rather than
  carrying its own.
  A third member arrived while one party was verifying the second: a diff taken over
  `A..B` where the claim concerned one commit and the range held **seven**. The output was
  real repository content, freshly produced, correct — and about a different subject
  entirely, which is the only reason it was caught. Had the intervening commits touched
  the same block, it would have read exactly like the answer. So the family is **a range,
  a block or a context wider than the claim returns a superset that reads as the
  answer**, and all three instances produced output that was true and answered a question
  nobody asked.
  A fifth kind is specific to auditing prose, which is what most of this document is, and
  it arrived on the last measurement anyone took. A reviewer checking an attribution count
  searched for `reviewer\s+named` and reported one named attribution in a file that has
  none. The line it matched reads *"the mechanism, which a reviewer **named** and which is
  what…"* — **"named" as a verb.** The probe matched the wrong *sense* of an English word
  and returned a clean, plausible, wrong count. **A regex over prose selects on spelling
  and the claim is about meaning**, and nothing in the output distinguishes the two; the
  rescue was reading the matched line, which is the same rescue as every other null in
  this catalogue and is still not a method.
  **The same episode produced a sixth form, and it is the only one where both parties
  proposed a cause and both were wrong.** Two attribution counts of the same file
  disagreed — 59 against 76. One party diagnosed *scope*, having seen three definitional
  mismatches that evening; the other diagnosed *staleness*, the files having demonstrably
  grown all night. Measured: the file held **59 at both commits**, so time explains
  nothing, and both parties had counted the same file, so scope explains nothing. The
  cause was the **predicate**: `a reviewer|A reviewer|the reviewer|reviewers` matches 59
  lines and a bare `reviewer` matches exactly 76. **A count is a function of its pattern,
  and the number carries no trace of which pattern produced it.**
  What makes it worth the entry is not the miss but its shape. Four prior discrepancies
  had a definitional cause, so the fifth was diagnosed as definitional without checking —
  **a correct generalisation applied to a case it did not fit, which is indistinguishable
  from a wrong guess at the moment of writing and much harder to doubt.** The catalogue's
  standing rule is that the story is the part nobody re-measures; here the story was a
  pattern with four confirmations behind it, and it was still the part nobody re-measured.
  **That last clause refutes a tempting summary of the whole record**, offered near the
  end: *every rescue was a check that ran without being remembered*. Recall did fail
  every time it was tried — a rule was re-broken two hours after being published, in a
  message that named it. But the rescues divide three ways, not two. **Structure**
  succeeded wherever it existed: the `APPLIED:` print, the positive control, the API call
  already inside the command being run. **Recall** succeeded never. And **noticing** —
  reading a matched line, recognising that a diff was about the wrong subject — rescued at
  least four instances and is neither structural nor recallable. It is the category this
  document has twice had to mark unguardable, and a summary that folds it into structure
  claims a coverage nothing here has.
  A fourth arrived from the author's side, in prose rather than in a query. A pull request
  opened as evidence-only, grew three source extractions during review, and merged with a
  header still reading *"evidence and test hardening only — plus one docblock line"* over
  a diff carrying **241 production additions across four source files**. The body had been
  updated throughout; the summary line had not. What makes it the sharpest of the four is
  that the same description carried, verbatim, a note explaining that it deliberately
  omitted a commit count *"because a count in prose is a claim nothing re-checks"*.
  **The author removed the number and kept the adjective.** Both are claims nothing
  re-checks; only the one that had already bitten him was defended against — which is
  *enumerate the failure you were shown*, applied by an author to his own summary line,
  inside the sentence warning about it.
- **The guards this work produced almost all check things that are free to check.** Six
  mechanical forms came out of eighteen review passes — confirm the mutation applied,
  confirm it compiled, confirm the query matched, dope the detector before believing its
  silence, emit the timestamp from the measuring command, verify a spliced seam where the  methods must differ. Every one audits the author's own instrument, where being wrong
  costs nothing socially, and the classes this programme repeatedly found unaudited — a
  credit, a hedge, a compliment, another party's figure — have none of them.
  The predictor is better than the list, because it generates rather than enumerates:
  **a check with a social cost and no epistemic reward is a check nobody runs**, and the
  next unaudited class will be whatever else has that shape.
  **That predictor is incomplete, and the thing it cannot generate is the defect that
  survived everything.** It explains classes that go unchecked because checking costs
  something socially. A `git diff --stat` costs *nothing* — no awkwardness, no relationship
  to anyone, one word of output — and it went unlooked-at across forty commits by two
  parties who were, all evening, explicitly hunting for unrun checks. The commit it would
  have caught in four words rewrote a whole file and destroyed 57 commits of provenance.
  So there is a second mechanism beside social cost, and it is its opposite: **free is its
  own kind of invisible.** A check with no cost attaches to no decision, so nothing ever
  prompts it; the expensive ones at least announce themselves by being avoided. This
  section was built from the classes that hurt, which is precisely why it could not name
  the one that doesn't.
- **A complete green suite is evidence about the working tree and nothing else.** The last
  defect this work produced is the only one a passing suite *actively concealed* rather
  than merely failed to catch, and it is the entry to put in front of a reader before any
  finding about the rig. A commit converted a documentation file from LF to CRLF —
  1351 insertions and 1340 deletions for a ten-line entry — and collapsed 57 commits of
  `git blame` provenance into one, in the file whose entire value is its accumulated
  attributions. Build, lint, 371 tests and the facts checker were run after every commit
  by two parties for two and a half hours, **all green throughout the entire period the
  defect existed**, because not one of them reads history.
  Both parties were treating a green suite as evidence about *the change*. It is evidence
  about the *state*: what the tree contains now, not what the commit did to get there.
  Everything a commit can damage that is not present in the working tree — history,
  provenance, line endings normalised away, a file's diffability — is outside every gate
  in this repository by construction, and adding more tests cannot reach it.
  The check that would have caught it is `git diff --stat`, four words, free. It was run
  by nobody across forty commits. The repair was possible only because the damage had not
  merged: rebuilding the branch restored all 57 attributions natively, where the usual
  remedy — a `.git-blame-ignore-revs` every future reader must configure — would have
  externalised the cost permanently. `.gitattributes` now pins `* text=auto eol=lf`, which
  is the gate at the point of writing that the ignore-file would only have simulated at
  the point of reading.
  It produced one more on the last exchange of the work, and it is the class with the
  strongest immunity: **the explanation of a discrepancy.** Twelve passes measured
  numbers, assertions, bounds, mutations, timestamps and counts — and the *causes* attached
  to them went unmeasured throughout, because an explanation is only ever written after
  the disagreement has already been settled by measurement, and by then nobody is looking.
  The instance: two counts of one file disagreed, one party attributed it to scope and the
  other to elapsed time, and the decomposition was **22 predicate, 2 scope, 0 time**. Both
  explanations were wrong and neither had been checked, though the numbers they explained
  had been checked repeatedly.
  The sharper half belongs to the party whose hypothesis was wrong: **the most dangerous
  wrong cause is a real one.** The file in question *had* grown all evening — 16 to 17 to
  20 to 23 entries — so staleness was a true, personally observed mechanism, cited as the
  cause of a discrepancy it did not produce because both counts were taken at the same
  commit. That is the head-roll error again, at the far end of the work: a fact about the
  system, correct in itself, standing in for a cause. A wrong explanation built from a
  real mechanism resists doubt in a way an invented one never could.
  **And one exchange later the same mechanism caused the next discrepancy, genuinely.**
  Two blame counts of the same repaired file disagreed, 58 against 59; the cause was that
  one was taken before a commit and one after, and the commit owns sixteen lines. Measured:
  58 → 59 → 60 across three successive commits. So *staleness* was falsely blamed for one
  gap and was the true cause of the very next one, with nothing in either number to
  distinguish the cases. That is the fifth class demonstrating itself in the last count
  anyone took: **the mechanism you invoke may be real, may be the one you have watched
  operating all along, and may still not be the one that produced the number in front of
  you — and only measuring the explanation separates them.**
  There is a structural consequence, and it is the strongest practical thing this work
  produced. **The correction neither participant can make is the one from someone with no
  stake in the exchange.** Two parties in a review loop audit each other's *arithmetic*
  very well and each other's *framing* poorly, because framing is where the courtesy
  lives — and the unaudited classes above are precisely the ones courtesy operates on. The
  evidence is one-sided: of everything found across eighteen passes, the correction that
  neither reviewer nor author was positioned to resist came from a session working on an
  unrelated branch, which refuted a rule that had been committed here as a universal and
  did it with three counterexamples out of its own tooling. Neither of us would have found
  it, and not for lack of rigour — **we had a relationship to the claim and it did not.**
  So a third reader is not redundancy, it is the only instrument that reaches the class
  the other instruments are socially prevented from touching.
- **A difference is not automatically a defect, and a catalogue this size makes it feel
  like one.** The closing entry, and the only one about when to stop. Everything above
  arms a reader with named failure shapes, which is the point — and the cost is that a
  reader so armed can match a shape onto anything, including cases where nothing is
  wrong. It happened twice near the end of this work in opposite directions: a correct
  narrow scope was nearly widened because unexplained narrow scopes had been samples four
  times running, and two participants' measurement series differed only because they had
  sampled at different minutes, which is the mundane case and not a fifth instance of the
  anchor family. **Reporting the second would have been the pattern rather than a
  finding.**
  So the discipline includes declining. The test is the same one the rest of this section
  asks for and it is cheap: **measure whether the difference has a cause, before naming
  which cause it has.** Four of the discrepancies in this work had a definitional cause
  and one had none at all; a fifth had a cause nobody proposed. A catalogue with no false
  positives has not been used hard enough to know its own precision — and one used this
  hard has to be willing to say *nothing is wrong here*, which is the only sentence in the
  section that costs its author a finding.
  **An earlier version of this entry said "not one guards a claim whose checking is
  awkward", and a reviewer produced the counterexample from its own work.** A seventh
  guard exists — *check whether the fix is free before recommending it* — it is squarely
  in the awkward class, since its entire effect is to delete a finding from your own
  report, and unlike the six it can be shown **firing on something consequential**: it
  withheld a one-line recommendation that had a precedent one commit old and would have
  broken four legitimate writes. The six between them have one demonstrable firing all
  evening.
  Why it was missing is the better half. **The six each have a scar** — every one was
  written after paying for the failure it prevents. The seventh was invented in the moment
  and worked first time, so nothing forced it into the record. **A catalogue assembled
  from scars systematically omits the guards that never failed**, independent of whether
  they are cheap or awkward to run — which is this programme's own defect, occurring
  inside the entry that catalogues the programme's defects.
  What survives is sharper than what was claimed: **the only guard here that checks
  something awkward is the only one that was never written down.** The awkward class is
  not merely unguarded — it goes unrecorded even when it is guarded.
  And the reason that join was available at all is worth the next reader's attention:
  both halves were already in this file, written twenty minutes apart, and neither author
  saw the connection while writing either. **A catalogue with enough members starts
  containing its own generalisations before anyone states them**, which is a cheaper place
  to look than the code — and nobody looked there until the supply of new members ran out.
- **A rule stored without its trigger is a guard with no call site.** It exists, it is
  correct, and nothing invokes it — which is the same object as an assertion that cannot
  fail for the defect it names, one level up and in prose instead of a test. The evidence
  is unflattering and worth keeping: the note *"commit before mutating"* was written here
  after a `git checkout --` destroyed uncommitted work, and it then failed to fire three
  more times, because it recorded the rule and not the moment. So the operational form is
  **where a rule can be made into a call site rather than a sentence, it should be**, and
  this document is the wrong home for anything convertible.
  That partitions the rules in this repo into three, and the partition is the useful part.
  *Converted*: the arithmetic behind the head rig now lives in `applyHeadPose`,
  `applyChestPose`, `chestGaitYaw`, `decayStrideOnStagger`, `actorGaitCadence` and
  `actorSpeedForRole`, so the suite drives it instead of reading it — twelve source pins
  became two calls, and a rewrite can no longer evade them.
  That list names functions and no line numbers, which was accidental and is now
  deliberate: **a name is a way to re-derive and a line number is a value**, so a table of
  line numbers in a document is the most perishable thing this work could have committed,
  and nothing would fail when it decayed. A reviewer flagged the hazard against a table
  that turned out to exist only in a message — the committed prose had already dropped
  the numbers. Correct by habit is the state a thing is in immediately before it stops
  being correct, so it is written down here as a choice.
  And the reason that is not merely a nice phrase: **a correct outcome tells you nothing
  about whether the mechanism that produced it will fire again.** An unfired guard and an
  undecided habit are the same object — untested mechanisms with clean records — and in
  both cases the clean record is what makes them look settled. The file dropped the line
  numbers by habit and nobody knew, including its author, until a reviewer mischaracterised
  it and the check went looking for a mechanism that turned out not to exist.
  That mischaracterisation is also the exact inverse of an error made an hour earlier in
  the other direction: one party credited a message with prose that contradicted the
  committed file, the other credited the file with prose that existed only in a message.
  **Same split, opposite directions, both from reading a message as though it had been
  through the moment a commit forces.**
  *Unconvertible*: the wiring claims and the alias evasion, because `GameEngine` is not
  constructible in Node, which is why the test file states them as limitations instead of
  implying it has none.
  *Sentence-only, and therefore inert until someone remembers*: everything about working
  practice, including the one above. This bullet is in that third category and cannot
  argue itself out of it — which is the point. **A rule that cannot be given a call site
  should say so, so that its reader knows they are the invocation.**
- **Before offering a cause, check whether your own code already answers it.** The
  sharpest instance this work produced: a docblock blamed head roll for a 39%
  discrepancy in a gaze figure, when `solveHeadYaw`'s signature — written ten commits
  earlier, by the same hand — takes no roll argument at all, and its own docblock says
  why: *"a rotation about Z leaves the +Z axis fixed, so `head-pivot.rotation.z` cannot
  move the gaze and is not a parameter."* The claim was refutable by `git grep`, without
  measuring anything.
  The mechanism is worth naming because it is not carelessness. **A justification
  written while correcting yourself is written by the one person who has stopped
  consulting the source** — because they have just been deep in it and are certain they
  know what it says. Certainty about the code is highest immediately after working on
  it, which is exactly when the correction gets written. That is why this pairs with
  reviewing the justification rather than the fix: the fix was checked against the code,
  and the sentence explaining it was checked against memory.
- **Turn a finding into a gate, not a paragraph.** A written rule is re-read by the
  person least able to see past it — the author, mid-correction, at the moment of
  greatest certainty. A check is not immune to carelessness either, but **its
  carelessness is fixed at authoring time rather than growing at use time**: it only
  catches the classes somebody thought to encode, and it catches every one of those
  forever, regardless of how sure anyone later becomes. That asymmetry is the whole
  argument for pinning.
  It is why the gaze table's figures are computed by the committed sweep rather than
  copied out of a mutation run, why the per-role wobble numbers are asserted to a
  thousandth of a degree, and why the published pose count is checked against the
  product of its own axes instead of a floor. Each of those had been wrong while a
  paragraph beside it explained it correctly.
  The test for whether a finding has been properly absorbed is not "is it written
  down" but **"what goes red when it recurs"**. If the answer is nothing, the finding
  has been recorded rather than fixed.
- **Mutate the production code, not the test's copy of it.** The anisotropy test used
  to apply its own `neckPivot.scale.x = 1 / shoulders`, and the mutation evidence
  published for it came from mutating *that* line. Reverting the engine's half left
  every numerical assertion green — only a source regex noticed. The measurements
  were right and the proof was worthless. Both halves now live in one exported
  function that the engine and the test both call, so a production mutation breaks
  the measurement; dropping the cancellation, putting it on the wrong axis, or
  introducing a 0.3% error in it each fail now and each passed before. **A test that
  cannot see the code it is named after is the same defect as a bound that cannot
  fail** — and neither is visible by reading, only by mutating the right thing.
- **A threshold sized against a mis-modelled input is a threshold sized against
  nothing.** The wobble test's anti-degeneracy guard — "the rejected rule must be
  worse than 2°" — was chosen against a gait model that ran 3.7× too slow, because
  `actorGaitCadence` returns radians per *metre travelled* and the test read it as
  radians per second. `updateActors` does `gaitPhase += travelled * cadence`, so a
  soldier at 3.7 m/s oscillates at 25.16 rad/s, not 6.8. Under the real physics the
  rejected rule produces **1.997°**: the guard had negative margin and was one
  rounding from passing vacuously. The discipline of asserting that the rejected
  alternative *fails* was right; the number was fiction. Guards of that kind should
  be expressed against the bound they protect — "the rejected rule must fail the
  bound the shipped rule passes" — so the two cannot drift apart.
- **Validate a conversion under the conditions that break it, not the ones that
  suit it.** Every early gaze measurement held the chest's pitch and roll near zero,
  which is precisely the geometry in which a scalar `lookYaw - chestYaw` is exact. The
  two tests validating the conversion were blind to the only condition under which
  the conversion failed. Both now drive all three axes.
- **Do not fix a second defect inside a regression fix.** `torso-pivot` is *also*
  rooted at the actor's origin rather than at the waist, so under the same `lean` the
  whole upper body slides forward against the pelvis: **0.2950 m** at the waist on a
  walking elf brute, 0.2316 m standing, 0.7901 m at the widest reachable pose. Same
  defect class as the head, unreported, and deliberately **not** fixed with it. The
  blast radius is the reason: `torso-pivot`'s origin is load-bearing for the shoulder
  joints, the weapon rest pose, the captive's wrist rope, `cloak-pivot`, the
  hard-coded absolute `shield` coordinates that `updateShieldPose` owns, and
  `attachTorch`'s "hand height in torso space" contract. What makes the two separable
  is that the head fix does not depend on it — the head is now rigid with the chest
  *wherever the chest hinges from*, so moving the spine joint later cannot un-fix it.
  Anyone taking this on starts from those numbers rather than rediscovering them. Note
  also why nobody has reported it: at ordinary standing and walking poses the torso and
  thigh meshes still intersect, so there is no visible gap — only at extreme scout and
  champion poses do the surfaces come within about 1.9 cm of separating.
- **Do not let a quadruped inherit a biped's spine.** The beasts share the rig names on
  purpose, but `createBeast` builds its own limb geometry per role and the shared
  stride is remapped, rather than a wolf borrowing a soldier's arm. The secondary
  pass is split the same way: `animateBeastPosture` replaces the biped shoulder
  bend, hip counter-rotation and head yaw, all of which pull an animal apart at the
  joints when applied to a body whose skull sits a metre forward of its own pivot.
  Note what that buys and what it does not: it *reduces* the sliding, it does not
  remove it. `createBeast` still roots `head-pivot` at the animal rather than on its
  ribs, so the skull slides against the ribcage under attack and stagger — 0.296
  authored units on a wolf, 0.368 on a bear, **0.660 on a troll**, before
  `BEAST_PROFILES.scale` turns that into world units, where a troll's head travels
  over a metre. That is worse than the 0.66 m humanoid case that was reported.
  Deferred deliberately — a quadruped's neck is not at `shoulderY` and guessing at
  one is how a fix becomes a second regression — but filed, not called solved.
- **Do not derive a look from a spawn counter.** Appearance hangs off the most
  durable identity a caller can offer — a generated spawn slot, a persisted
  companion id, a deterministic event id — so the same person comes back the same
  person after a region reload or a save. `index` is a monotonic counter and is only
  a fallback for actors that genuinely have no other name.
- **Do not let a cache key be finer than the shape it names.** Injectivity is the
  obvious half; the other half is that two keys for one buffer means the cache built
  and holds the same geometry twice. Limbs and cloaks key by the discriminant their
  builder actually reads, published by the builder itself as a `*Variant` function
  so a predicate cannot drift away from the key describing it.
- **Do not texture the caravan.** It was the last user of `createSurfaceTexture()` in
  the actor path; it moves onto the stylized family like everything else.
- **Do not allocate in the animation path.** No `new THREE.Vector3()` per frame, no
  object literals per actor per frame, no `getObjectByName` walks that were not
  already there, no closures.

### 4.1 Two foundation bugs this pass works around

Both were found by putting the models in front of a headless camera rather than by
reading the code. Neither is fixed here, because `src/game/art/GeometryKit.ts`
belongs to the foundation pass; both are reported upstream and repaired locally in
`CharacterKit.ts` in a way that costs nothing once the kit itself is corrected.

- **`loftProfile` winds its triangles the opposite way round from the normals it
  writes.** Measured: a plain lofted box reported 0 triangles in agreement and 28 in
  disagreement, against 12/0 for `THREE.BoxGeometry`. A `FrontSide` material
  therefore drew the *inside* of the far wall and — far more visibly — the
  `BackSide` ink shell landed in front of its own source and painted the entire
  silhouette solid ink. Since `loftProfile` also backs `taperedBox` and
  `stylizedCapsule`, this affected almost every part in this module.
  `ensureOutwardWinding` measures each triangle against its own normal and reverses
  only the ones that disagree. It is per triangle rather than per geometry because a
  merged part routinely mixes builders that disagree with *each other* —
  `tubeAlongPoints` winds its walls one way and its caps the other — and a majority
  vote fixes one and breaks the other. It is a measurement, so it is idempotent and
  becomes a no-op for anything the kit already gets right. **The foundation has since
  fixed `loftProfile` upstream (`3499e27`), which is exactly the outcome the repair
  was written to survive.**
- **A mirror baked into a buffer is not a mirror.** three.js flips the face winding
  for a *mesh* whose world matrix has a negative determinant, but
  `transformed(geometry, { scale: { x: -1 } })` leaves the object matrix positive, so
  every mirrored horn, ear, tusk, antler, cheek plate and pauldron would render
  hollow. `mirrorX` applies the matrix and then reverses the winding by hand;
  `applyMatrix4` already handles the normals, because the normal matrix of a pure
  mirror is the mirror itself.

## 5. Architecture

### 5.1 `src/game/art/CharacterKit.ts`

One module, importable from a Node test, depending on `three`, `GeometryKit` and
`ArtRandom` and nothing else. It never imports `GameEngine`, `world/` or `content/`,
and it never creates a material — geometry in, geometry out.

```text
CharacterKit.ts
  ── winding repair ───────────────────────────────────────────
  ensureOutwardWinding, reverseWinding, mirrorX, loft, bodyAlongZ
  ── plan resolution ──────────────────────────────────────────
  resolveCharacterPlan(faction, role, variant)   -> CharacterPlan
  characterKitForRole, characterPartKeys, CHARACTER_VARIANTS
  ── humanoid parts ───────────────────────────────────────────
  buildTorso, buildTorsoTrim, buildHead, buildFace, buildHair,
  buildUpperArm, buildForearm, buildHand, buildThigh, buildShin,
  buildHeadgear, buildCloak, buildOffhand
  ── weapons ──────────────────────────────────────────────────
  buildWeaponHead / buildWeaponGrip
      sword | greatsword | sabre | dagger | axe | cleaver
      | spear | glaive | mace | maul | bow | staff
  ── rig maths ────────────────────────────────────────────────
  solveHandOffset(target, upperArm, forearm, armX, armZ, elbowX)
  ── creatures ────────────────────────────────────────────────
  BEAST_RIG, buildBeastBody, buildBeastHead, buildBeastLimb,
  buildBeastTail
  buildDeerBody, buildDeerCrown, buildDeerLeg,
  buildBirdBody, buildBirdWing
  ── caravan ──────────────────────────────────────────────────
  WAGON_RIG, buildWagonFrame, buildWagonAxle, buildWagonWheel,
  buildWagonBed, buildWagonTilt, buildWagonCargo,
  buildOxBody, buildOxHead, buildHarness
```

Every builder returns a fresh `BufferGeometry` with normals, a name, and — for
anything that will be outlined — welded `outlineNormal` data from
`bakeOutlineNormals`. Builders take plain numbers and enums, never a `RandomStream`,
so a cache key fully determines the output.

### 5.2 The character plan

```ts
type CharacterKit =
  | 'line' | 'light' | 'ranged' | 'heavy'
  | 'officer' | 'elite' | 'civil' | 'bound' | 'hero'

interface CharacterPlan {
  faction: Faction
  kit: CharacterKit
  armour: 'none' | 'light' | 'medium' | 'heavy'
  proportions: CharacterProportions   // heights and offsets, in metres
  headgear: HeadgearKind              // 12 shapes, or 'none'
  hair: HairKind
  weapon: WeaponKind
  offhand: 'none' | 'shield' | 'buckler' | 'bundle' | 'bound'
  cloak: 'none' | 'cape' | 'cloak' | 'mantle' | 'rags'
  trim: TrimKind                      // belt, pack, quiver, harness, sash, rope
  tint: number                        // 0-3, selects a pre-mixed faction cloth tint
  mainHand: 'left' | 'right'
}
```

Role to kit is a fixed table: `soldier`/`minion` → `line`, `scout` → `light`,
`archer` → `ranged`, `brute` → `heavy`, `commander` → `officer`, `champion` → `elite`,
`peasant` → `civil`, `captive` → `bound`, the player → `hero`. `variant` is a small
integer (0–2) drawn once per actor from an `art:` stream; it selects headgear, hair,
weapon and tint within the kit's allowed sets. Everything else about the plan is a
pure function of faction and kit, which is what keeps the cache-key space bounded.

### 5.3 Faction vocabulary

The blind-silhouette contract. Colour is a redundant cue, never the cue.

| | **Elf** — Чаща Эленвуда | **Guard** — Имперский удел | **Villain** — Чёрный кряж |
| --- | --- | --- | --- |
| Proportion | Tallest, narrowest. Long limbs, small head, high waist. | Squarest. Broad shoulders, thick chest, short neck, low waist. | Hunched and asymmetric. Long arms, raised right shoulder, forward lean. |
| Armour language | Layered leaf-scale over a long split coat; a high standing collar; swept blade-like shoulder wings. | Banded plate: a segmented cuirass with a raised sternum ridge, rectangular pauldrons, a skirt of tassets. | Scavenged plate lashed over rags; one oversized spiked pauldron, one bare shoulder; a jagged hem. |
| Headgear | Circlet, swept crown, or a deep pointed hood. | Kettle helm with a brim, nasal helm with cheek plates, crested/plumed helm for rank. | Horned helm, bone half-mask, rag hood with a jaw guard. |
| Cloth | A long cloak split into two pointed tails; it swings wide and late. | A rectangular tabard, front and back, straight hem, wide belt; it barely moves. | A ragged mantle with a torn hem; it snaps. |
| Head shape | Narrow jaw, high cheekbones, long swept ears, level brow. | Square jaw, heavy brow, short ears. | Jutting jaw with lower tusks, sunken sockets, brow spur. |
| Weapons | Sabre, glaive, longbow, staff. | Arming sword, spear, mace, heater shield. | Cleaver, maul, jagged axe, crude bow. |
| Silhouette word | *vertical* | *rectangular* | *jagged* |

### 5.4 Role silhouettes

| Role | Read at 30 m |
| --- | --- |
| `soldier` / `minion` | The faction's baseline. Belt, pouch, one-handed weapon, small offhand. |
| `scout` | Lean, hooded, short cape, no pauldrons, dagger or sabre, forward-leaning stance, narrowest shoulders. |
| `archer` | Lean, quiver angled across the back, bracer on the bow arm, soft cap, bow held in the **left** hand, no offhand. |
| `brute` | Widest thing on the field. Shoulders above the ears, head sunk between them, arms past the knee, two-handed maul or cleaver, no headgear beyond a strap. |
| `commander` | Tallest upright. Full-length cloak, tall crested headgear, a sash, an ornate one-handed weapon, hands away from the body. |
| `champion` | Heavy *and* tall. Full helm, mantle, spiked pauldrons, a two-handed greatsword or glaive. Keeps its existing aura ring. |
| `peasant` | Small, round-shouldered, no armour, apron and headscarf, a bundle on the back, empty hands. |
| `captive` | Ragged, hunched, bare head, arms locked to a single pose, and a `wrist-rope` cord tying the fists together. `unbindActorArms` hides the cord and clears `boundArms` on rescue and on companion restore, so a freed captive walks and swings like anyone else. |
| player (`hero`) | A shade taller and broader than a soldier of the same faction, better-finished gear, always armed. |

### 5.5 The rig

Frozen names are marked **bold**. Everything else is new and additive.

```text
group
├── **body-pivot**
│   ├── **torso-pivot**
│   │   ├── **torso**            merged: chest, waist, tassets/coat, pauldrons
│   │   ├── torso-trim           merged: belt, pouches, pack, quiver, sash   [detail]
│   │   ├── cloak-pivot → cloak  cape / cloak / mantle / rags
│   │   ├── **leftArm**  (pivot) → upper arm mesh
│   │   │      └── leftElbow (pivot) → forearm mesh [+ hand mesh, detail]
│   │   ├── **rightArm** (pivot) → upper arm mesh
│   │   │      └── rightElbow (pivot) → forearm mesh [+ hand mesh, detail]
│   │   ├── **weapon** (pivot) → weapon mesh (+ grip mesh)
│   │   ├── **shield**  (mesh, absolute local coords owned by updateShieldPose)
│   │   └── neck-pivot           the joint, at `shoulderY` in torso space
│   │       └── **head-pivot**   the head's own rotation: look, counter-pitch, roll
│   │           ├── **head**     merged: neck, skull, brow, nose, jaw, ears
│   │           ├── face        eyes and mouth, dark material               [detail]
│   │           ├── hair                                                    [detail]
│   │           └── headgear
│   └── **pelvis-pivot**
│       ├── **leftLeg**  (pivot) → thigh mesh
│       │      └── leftKnee (pivot) → shin mesh (boot merged in)
│       └── **rightLeg** (pivot) → thigh mesh
│              └── rightKnee (pivot) → shin mesh
├── **faction-ring**
└── contact-shadow
```

The five pivots are built by `buildCharacterSkeleton` in `CharacterKit`, not by the
engine, so the layout is reachable from a Node test with no DOM — which is what lets
`tests/characterArt.test.ts` pose a body and measure it rather than read it. The head
meshes take their Y from the skeleton's `headY`, measured **from the neck**, not from
the proportion table's `headY`, which is measured from the ground.

`neck-pivot` and `head-pivot` are two nodes rather than one because `torso-pivot`
carries scale as well as rotation — the actor's shoulder width on `scale.x` and the
breath on `scale.y` — and the head has to divide the shoulder width back out in the
same axis-aligned frame it was applied in. `neck-pivot` never rotates, so it can;
`head-pivot` does, so on it the correction only cancels while the actor faces
forward. Measured over both shoulder extremes, both breath extremes and a 462-pose look grid across all 30 plans: **8.59%** head anisotropy with no correction, **6.05%** with it on `head-pivot`, **1.00%** with it
on `neck-pivot`, that last being the chest's breath and nothing else.

Contracts this preserves, each verified against its consumer:

- `hidePlayerLimb` / `applySavedBodyAppearance` / `detachActorLimb` set `visible` on
  `leftArm`/`rightArm`/`leftLeg`/`rightLeg`. Elbows and knees are *children* of those
  pivots, so a hidden limb hides its whole chain.
- `restorePlayerLimb` traverses a limb and replaces every non-outline mesh's material
  with the prosthetic metal. Forearms, shins, hands and boots are inside the limb, so
  a prosthetic is a whole prosthetic.
- `attachTorch` parents a torch to `weapon`; the player's weapon trail is a child of
  `weapon`. `weapon` therefore stays a direct child of `torso-pivot` whose **origin is
  the hand**, not the shoulder and not the blade.
- `updateShieldPose` writes absolute local coordinates into `shield`. `shield` stays a
  direct child of `torso-pivot` and its rest transform is unchanged.
- `applyOutline` skips `faction-ring` and `userData.noComicOutline`; the contact shadow
  carries the latter.
- `spawnActor` still owns `mesh.scale` per role, because `actorColliderRadiusForRole`
  and `actorHealthBarHeight` are calibrated against it. Shape differences live in
  geometry; size differences stay where the collision code can see them.

### 5.6 Materials

Characters move from three caller-owned materials per actor to **shared, library-owned
entries** from `acquireMaterial`. Twenty-five actors used to build seventy-five
materials; they now share at most a few dozen for the whole game.

| Key shape | Surface | Count |
| --- | --- | --- |
| `char:cloth:{elf\|villain}:{tint}` | `cloth` / `leather` | 2 × 3 |
| `char:armour:guard:{tint}` | `metal` | 3 |
| `char:limb:{faction}` | `metal` / `leather` | 3 |
| `char:shield:{faction}` | `metal` / `bark` | 3 |
| `char:skin:{tone}` | `skin` | 4 |
| `char:hair:{tone}` | `cloth` | 4 |
| `char:leather` / `char:dark` / `char:steel` / `char:bone` | `leather`/`dark`/`metal`/`skin` | 4 |
| `char:cloak:{faction}` | `cloth` | 3 |
| `char:civil:{tint}` | `cloth` | 3 |
| `beast:{role}:{part}` | `cloth`/`dark`/`skin` | 12 |
| `caravan:{part}` | `bark`/`metal`/`cloth` | 5 |

Enumerating the whole plan space reaches **33** character keys, against a budget of 48.

Three values per figure is a hard requirement, not a nicety. The torso sits at the
faction colour, `char:limb:*` sits a step darker and `char:shield:*` a step lighter.
When limbs and shield shared the torso material — which is how the first cut of this
pass shipped — elves and villains read as one flat slab of colour and the offhand
vanished into the tabard it was held in front of. Only the palace guard escaped,
because its limbs were already steel.

Nothing in the character path calls `createMaterial` any more except the faction ring,
which needs a `MeshBasicMaterial` anyway. Nothing mutates a shared material.

### 5.7 Detail LOD

Five kinds of mesh per actor exist only to be read up close: `face`, `hair`,
`torso-trim`, the bare `hand` meshes and `weapon-grip`. Each is placed under a
`THREE.LOD` with the mesh at distance `0` and an empty `Object3D` at
`CHARACTER_DETAIL_DISTANCE = 26`. `LOD.update()` runs inside the renderer's own scene
walk, so this costs no engine code and no allocation, and the ink shells parented to
the detail meshes disappear with them.

Net draw calls per actor, ink included, from the counts pinned in
`tests/characterArt.test.ts`:

| | before | near (<26 m) | far (>26 m) | outline-culled (>38 m) |
| --- | --- | --- | --- | --- |
| meshes | 8–9 | 15–19 | 11–14 | 11–14 |
| shells | 7–8 | 15–19 | 11–14 | 0 |
| total | 17–19 | 32–40 | 24–30 | 13–16 |

This is more expensive than the placeholder it replaces, and honestly so: hands,
faces, gear layering and a weapon you can identify are the mandate, and they cost
draw calls. The mitigation is that the near band is small — at most a handful of
actors are ever inside 26 m — and that the far band, where a crowd actually lives,
carries the silhouette and nothing else. Everything is shared: 25 actors of the same
faction and role draw from one set of buffers and one set of materials.

### 5.8 Animation

All procedural, all allocation-free, all driven from the existing `CharacterPose`.

- **Weapon tracking.** `animateCharacter` computes the main hand's local position from
  the arm pivot's own rotation — `hand = armPivot + R(armRot)·(0, −armLength, 0)`,
  three sines and three cosines — and writes it into `weapon.position`. The weapon's
  rotation is the arm's rotation plus a wrist term. The blade is in the hand in every
  frame of every state, including death.
- **Elbows and knees.** The walk gets a real knee: the swing leg's knee flexes on the
  forward half of the stride and extends before the plant. Elbows carry a fixed carry
  angle plus a swing-driven flex, and the attack gets a cock-and-release through the
  elbow instead of a whole-arm sweep.
- **Idle.** Breathing (kept), weight shift (kept), plus a slow shoulder counter-rotation,
  head micro-drift and a per-actor phase so a squad is not a chorus line.
- **Cloak.** `cloak-pivot` lags the torso's yaw and pitches back with speed. One damped
  angle per actor per frame.
- **Hit and death.** The flinch now also folds the elbows and drops the head; the death
  poses reach the knees so a body collapses instead of tipping like a plank.
- **Beasts.** Front limbs answer to `leftArm`/`rightArm` and hind limbs to
  `leftLeg`/`rightLeg`, as before, but the pose is remapped per role: a wolf's gait is
  a fast diagonal with a low head, a bear's is a slow lumber, a troll's is a two-beat
  stomp with a shoulder roll.

## 6. Creatures

### 6.1 Beasts

| Role | Read |
| --- | --- |
| `wolf` | Long, low and light. Deep chest, tucked belly, long muzzle, pricked ears, brush tail, digitigrade hind legs with a visible hock. Runs with its head below its shoulders. |
| `boar` | Front-heavy wedge. A shoulder hump taller than its hips, a short thick neck, a blunt snout with upturned tusks, a bristle ridge down the spine, small tail. |
| `bear` | Mass over the shoulders, round rump, short neck, small round ears, broad plantigrade paws with claws. Lumbers. |
| `troll` | Bipedal-leaning brute: long knuckle-dragging arms, a hunched back with a stone-like ridge, a heavy jaw, a small head set low and forward, a club-heavy stance. |

### 6.2 Fauna

- **Deer** — lofted barrel body, a real neck curve, a wedge head with a black muzzle,
  branched antlers built with `tubeAlongPoints`, thin legs with hocks, a flag tail.
  Keeps the `deer-body` and `legs` group names `animateWildlife` drives.
- **Bird** — a tapered body, a swept tail fan and a two-part wing whose geometry is a
  real airfoil silhouette rather than a bar. Keeps the `wings` name.

### 6.3 The caravan

The game's title object. It gets built like a cart:

- A **ladder frame**: two side rails, five cross members, a draw-pole and a swivelling
  front axle bolster.
- **Wheels** with a hub, ten spokes, a felloe and an iron tyre. The rear pair is larger
  than the front pair, which is what makes a cart look like a cart.
- A plank **bed** with a visible board seam and a raised tail-board.
- **Cargo**: roped barrels, crates and a sack pile, gilded variant included.
- A **tilt**: four bows and a stretched canvas with a scalloped hem and a rolled front.
  It covers only the front of the bed. A full-length canopy hides `cargo`, which is
  the mesh the robbery interaction outlines — the player has to be able to see what
  they are stealing.
- A **harness**: yoke, traces, and two draft oxen with horns, a dewlap and a plodding
  head-down stance.

The `cargo` mesh keeps its name for the loot code, and each wheel group keeps `wheel`
so the existing rolling animation continues to work.

## 7. Determinism

- Every random choice in this pass comes from `artVariation(worldSeed, label)` or
  `createArtStream`, both of which prefix `art:` before `deriveSeed`. No gameplay
  stream is touched and no gameplay stream's ordering changes.
- No `Math.random()`, `Date.now()` or `performance.now()` in construction.
- An actor's label is `npc:actor:{allegiance}:{role}:{index}`, so the same actor in the
  same run is the same person on reload, and two runs with the same seed produce the
  same crowd.
- Geometry builders take no stream. A cache key determines the buffer exactly.
- `tests/worldGenerator.test.ts` and `tests/generatedWorldRuntime.test.ts` determinism
  and fingerprint assertions are untouched by construction changes.

## 8. Budgets

Spec 08's budget block stands. This pass **requests two increases** and adds its own
numbers; the justification is that spec 08's `CHARACTER_GEOMETRY_KEYS=9` was written
against a nine-mesh placeholder and cannot express three factions × nine kits.

```text
CHARACTER_GEOMETRY_KEYS<=180          was 9. The theoretical ceiling across all
                                      3 factions x 9 roles x 3 variants plus the
                                      player, measured at 140. Built lazily, so a
                                      typical run holds 50-70 of them.
GEOMETRY_CACHE_ENTRIES_MAX=220        was 64. One engine-side cache now holds
                                      humanoid parts, beasts, fauna and the caravan.
CHARACTER_SHARED_MATERIALS<=48        new. acquireMaterial entries, down from 75
                                      caller-owned materials at 25 actors. The
                                      whole taxonomy enumerates to 33 keys.
CHARACTER_VARIANTS=3                  headgear/hair/weapon/tint variants per kit
CHARACTER_DETAIL_DISTANCE=26          LOD cutoff for face, hair, trim, bare hands
                                      and the weapon grip
CHARACTER_MESHES_NEAR<=19             per actor, ink excluded. Measured worst case
                                      is 19, an elf captive at variant 0 — the
                                      wrist rope is the nineteenth. A guard
                                      commander is 18.
CHARACTER_MESHES_FAR<=14              per actor, ink excluded. The detail LOD
                                      removes five.
CHARACTER_TRIANGLES_NEAR<=3600        per actor, ink excluded. Measured worst case
                                      is 3136, a villain champion at variant 0.
BEAST_MESHES<=11
CARAVAN_MESHES<=26                    including two draft oxen
```

Both mesh figures are pinned by `tests/characterArt.test.ts`, which recomputes them
from the resolved plans rather than trusting this table. The first draft of this
document guessed 16/11 and was wrong in both columns; a number nothing checks is a
number that drifts.

Targets:

- No per-frame allocation anywhere in `animateCharacter`, `animateActorCharacter`,
  the death pose or `animateWildlife`.
- Sustained frame time at 25 actors within 1 ms of the pre-change build — **for a change
  that adds no geometry**, measured the same way spec 08 measured it. This wave is not
  such a change: it rebuilds every character, beast and caravan, so it is judged by the
  draw-call and vertices-per-frame ceilings in spec 08 §7 instead. Measured after the
  merge: 507 draws and 1,170,000 vertices, both at the measured maximum plus ~12%.
- The trade is deliberate. Frame time at 25 actors went 406 → 594 ms in software
  rasterisation, which buys the silhouette and material vocabulary this spec exists to
  add. **Throughput is spent on fidelity here on purpose; the ceilings are what bound
  the spending.**
- No new texture. No new material family. No new post pass. No new light.

## 9. Resource and lifecycle rules

- Every character, beast, fauna and caravan geometry is acquired through the engine's
  `GeometryCache` via `acquireArtGeometry`, which tags it `artLibraryOwned`. Neither
  `destroy()` nor `removeAndDisposeObject()` frees it; the cache disposes each exactly
  once at teardown.
- Character materials are library-owned `acquireMaterial` entries and are skipped by
  both teardown paths through `StylizedArtLibrary.isLibraryOwned`.
- `mergeAll` disposes its inputs. Every builder that keeps a part across two merges
  passes `{ dispose: false }` and disposes it itself.
- Ink shells are children of their source and are removed with it. Detail LODs hold
  meshes whose geometry is cache-owned, so `clearLod` is never needed on teardown.
- The faction ring keeps its caller-owned `MeshBasicMaterial`, which the existing
  teardown already disposes exactly once.

## 10. Accessibility and readability

- Faction identity stays redundant: silhouette, torso colour, faction ring, health bar
  and ink colour. The silhouette is now the strongest of the five, which is the point.
- Non-combatants are readable without colour: no weapon, no armour plate, round
  shoulders, a bundle or a rope.
- Faces are geometry, so they survive both themes, both bloom states and night.
- Nothing this spec adds is a new motion the player cannot disable; the reduced-motion
  path is unaffected because the rig animation was already always on.

## 11. Edge cases

- A limb hidden by dismemberment must not leave a floating forearm, hand, boot or ink
  shell. All of them are inside the limb pivot.
- A prosthetic limb must recolour its whole chain, including the hand.
- An actor whose weapon is hidden (`captive`, `peasant`) must not have a floating torch
  anchor; the torch roles exclude both.
- `updateShieldPose` runs on the player only and writes absolute coordinates; the new
  shield geometry is authored around the same origin so both poses still land.
- A merged geometry with zero triangles would throw inside `mergeAll`; every builder
  guarantees at least one part.
- `THREE.LOD` with an empty far level must still be traversable by `applyOutline` and
  by both teardown paths. An empty `Object3D` contributes nothing to either.
- Beast and humanoid rigs share pivot names, so any code that walks the rig must not
  assume a humanoid. The pose remap is keyed on `isBeastRole`.

## 12. File-level changes

| File | Changes |
| --- | --- |
| `src/game/art/CharacterKit.ts` | New. Plan resolution and every geometry builder this pass needs. |
| `src/game/art/index.ts` | One added export block, `// --- CharacterKit ---`. |
| `src/game/GameEngine.ts` | Character, beast, fauna and caravan construction; actor variation; role kit selection moved out of `spawnActor`; animation. |
| `tests/characterArt.test.ts` | New. Plan coverage, determinism, rig-name contract, cache-key bounds, winding, geometry sanity. |
| `tests/art.test.ts` | The foundation's barrel-surface pin gains the names the new export block adds, in its own labelled section. That test asks in its own failure message to be updated when the surface changes; this is the only file this pass touches that it does not own. |
| `docs/09-npc-and-creature-models-spec.md` | This document. |

## 13. Acceptance criteria

- [x] A blind silhouette test distinguishes elf, guard and villain, and distinguishes
      brute, scout, commander, archer and peasant, with colour removed.
- [x] Every humanoid has a neck, shoulders, hands, feet and a face with a brow, a nose
      and a jaw that read at gameplay camera distance.
- [x] Gear layering is present: cloak or cape, tabard or coat, belt, pouches, pack or
      quiver, pauldrons, bracers, greaves and a real helmet shape.
- [x] Twelve soldiers of one faction are twelve different people without a second
      geometry being built.
- [x] Each faction fields at least three weapon shapes; archers carry bows.
- [x] Wolf, boar, bear and troll are distinguishable from each other and from a
      humanoid at 30 m.
- [x] The caravan has a frame, spoked wheels, an axle, a bed, cargo, a tilt, a harness
      and draft animals.
- [x] The rig names in §5.5 all still resolve, and dismemberment, prosthetics, gore,
      the torch, the weapon trail and the shield pose all still work.
- [x] No `Math.random()` in any construction path this spec touches.
- [x] No per-frame allocation in the animation paths this spec touches.
- [x] Geometry-cache reference counts balance and no shared material is mutated.
- [x] `npm run build`, `npm run lint` and `npm test` are green.
- [x] Verified visually in a headless capture: day and night, bloom on and off, all
      three factions.

## 14. Wave 4 review

This spec's implementation was the one part of the graphics overhaul whose mandated
independent review never ran — S2's session went dark. Wave 4 reviewed it instead.
Nothing shipped by this pass was found broken. Three things about how it was *checked*
were, and they are recorded here because the pattern is reusable.

**The winding guard was a silent fixup, and it had also become dead.**
`ensureOutwardWinding` runs inside `loft()` and inside `finish()`, using exactly the
computation `tests/characterArt.test.ts` then asserts is zero, so that assertion could
never have failed. Measured with the repair disabled: **0 inside-out triangles in
196,705, across all 1,235 parts the game can build.** The foundation had corrected
`loftProfile` and nothing recorded that this repair had become a no-op — its own
docblock predicted the day would come. It is kept, because deleting it would remove a
guard as well as dead code, and `characterWindingRepairs()` now carries the count so a
regression goes red instead of being papered over. Validated by mutation: with
`loftProfile`'s normals negated, one torso reports 444 and one head 248.

**Orientation needs four instruments, not three.** `docs/10` §13 records three and
their blind spots. A fourth was measured here, because the three leave a hole:

| Instrument | Sees | Blind to |
| --- | --- | --- |
| normal agreement | a stored normal against its own winding | anything recomputed — and everything in this module, per the fixup above |
| signed volume | a part inside out **whole** | **partial** inversion: it is a sum, so reversed faces cancel |
| centroid / outward share | a whole flip, cheaply | partial inversion; concave parts have a large honest baseline |
| **edge consistency** | **any** inconsistently wound face, absolutely, with no tolerance | an open sheet's boundary, which it counts separately |

Reverse a fifth of a guard's torso and recompute its normals, which is what
`displaceGeometry` does downstream, and the first three read `0 disagreements`,
`0.606 outward` and `+0.179 volume` — all three pass. Edge consistency reads 36 bad
edges. On a closed, consistently oriented surface every directed edge has exactly one
opposite twin; reversing any face breaks the pairing whatever the normals are later
made to say. Measured clean across the whole roster — every plan part plus the headgear
and weapon kinds no plan table selects: **1,228 parts, 588,015 directed edges,
0 inconsistent**, plus 6,903 honest boundary edges from the open sheets (1.17%).

Mutation-verified end to end. With 20% of every torso reversed and laundered, all six
pre-existing tests in `tests/characterArt.test.ts` report green and only the new one
fails.

**One real defect, and it was the foundation's.** `latheProfile` handed back a final
profile ring whose normals were scaled by the length of the last profile segment — a
`THREE.LatheGeometry` quirk, since fixed with `normalizeNormals()`. It reached the game
through `buildHeadgear`: `cap` 27 vertices at |n| = 0.246416, `hood` 27 at 0.088549,
`ragHood` 21 at 0.088549. The other nine headgear kinds measured clean, and only
because `transformed()` normalises as a side effect of `applyMatrix4` — so whether the
defect appeared depended on whether a caller happened to position its lathe. It costs
the ink shell: `bakeOutlineNormals` averages by welded position, and a normal 11x short
is 11x under-weighted at exactly the vertex where a hood's silhouette is a single point.

**A second defect, in the engine half, and the same shape as the first.** The gilded
caravan's beacon — a 62%-opaque torus — cast a solid ring shadow on the ground.
`markCharacterShadows` excluded meshes by `name === 'faction-ring'` and
`userData.noComicOutline`, which is the *ink* pass's exclusion set; `transparent: true`
exempts nothing from three.js's depth pass, only `castShadow` does. The two sets agree
on contact shadows and faction rings, which carry the marker, and diverge on the one
transparent mesh in these four constructors that does not.

Note what makes it the same shape as the lathe defect: in both cases the correct
behaviour was reached *by coincidence* everywhere it was reached, so the code looked
uniformly right and the one place the coincidence failed looked no different from the
rest. `StylizedArtLibrary.isOpaque` is now the single predicate both passes use, and
`tests/art.test.ts` pins the predicate rather than either caller — including the case a
naive version gets wrong, a material with `opacity` below 1 and `transparent` unset,
which is what turns the mutation red.

**The two defects have one shape, and it is the same shape as the budget defects one
level down.** `latheProfile`'s normals were saved by callers happening to route through
`transformed()`; the shadow rule was saved by transparent things happening to be
ink-excluded. In both cases the code was answering a question nobody had asked it, and
the site where the coincidence failed was **textually identical** to the sites where it
held — a lathe is a lathe, a `castShadow = true` is a `castShadow = true`. Neither was
visible to any test, for the same reason: nothing was measuring the property the code
was accidentally getting right.

That is also why a scan that asserts the **rule** finds what a test against the **site**
cannot. Wave 4's own fix for the shadow defect is the proof. It pinned
`StylizedArtLibrary.isOpaque` — the predicate — and left `markCharacterShadows` free to
stop calling it: deleting the guard from the caller left the whole suite green, because
the predicate stays correct whether or not anything uses it. A test written against
`markCharacterShadows`, the natural response, would have passed on a tree that still
contained a second unguarded sweep in `createBird`. Asserting *every bulk `castShadow`
sweep asks the predicate* is what found that one. A site test asks the question in the
one place you already knew to look, which is the one place that is no longer a risk.

The corollary for anyone reading this section later: when a fix is a guard added at a
call site, the regression test belongs at the **rule**, not at the site or at the
helper. A helper's test survives the caller being reverted, and that is exactly the
regression you are trying to prevent.

## 15. Effort

**2–3 days.** The geometry is the fun part and the fast part. The time goes into the
plan taxonomy staying small enough to cache, into every rig-name consumer being
re-verified by hand rather than by hope, into the animation staying allocation-free,
and into the visual pass that catches the things a unit test cannot.
