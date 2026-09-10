# GFX-03 character rendering: implementation checkpoints

**Enhanced-preview implementation in progress. Not visual approval or a completed
performance tier.** Legacy remains unchanged and the existing staged
save-to-menu/continue preference lifecycle applies.

The user requested believable adult anatomy, visible elf faces inside separate
hoods, and visible villain faces beneath fitted helmet/bone/horn gear. The guard
uniform and helmet vocabulary is retained, with fitted proportions. These are
procedural production builders, not imported models or a separate showcase.

## Production paths

`GameEngine.createCharacter` resolves the existing faction/role/variant/finale
plan. Enhanced mode applies `illustratedCharacterPlan` and builds a
`CharacterPresenter` from `art/index.ts`; legacy uses the original factory.
The enhanced body uses independently authored cranial, orbital, jaw, nose, ear,
neck and open-cover geometry. Physical colors are defined by the bounded
`CHARACTER_PHYSICAL_PALETTE`, not the UI warning color.

The named waist, neck, head, arm/elbow and leg/knee hierarchy remains the pose
authority. Bone children carry the render surfaces. Compatible surfaces combine
into one indexed, mixed-surface `SkinnedMesh`, without a material group for every
former part. Weapon and shield stay independently named and attached in chest
space. The full affine hand frame follows the handle through nonuniform art
scale; support hands fit the shield or two-handed weapon. Captive wrist ropes
remain separately hideable when rescued.

Equipment uses a two-joint skin palette: rigid weapon surfaces use its root,
while bow string/nock vertices use the draw joint. NPC windup pulls the actual
string and arrow; contact/recovery removes the nocked arrow and releases the
string. The elf player's real arrow event immediately emits its unchanged
projectile, then starts a short, presentation-only released-bow recovery with
the offhand stowed. Expiry or a new action restores the normal weapon. The
named weapon node, torch/trail children, fade binding and skeleton stay stable
through these geometry changes. A surviving hand is selected without restoring
a missing arm. `jointCount` includes both body and equipment palettes.

Player windup/contact/recovery presentation reads the existing melee state.
It does not advance that state, spend stamina, create contacts or change
finisher commitment. NPC/finale action and gaze code remains authoritative.
Grounding affects visual body/joint/foot transforms only, uses the existing
height authority and has bounded offsets. Collider roots, vertical velocity,
navigation, actor capacity and saved gameplay fields are not its outputs.

`CreaturePresenter` batches the actual beast/fauna construction paths while
retaining their named transforms. Beasts and deer have articulated leg segments
and separate paws/cloven hooves; birds have independently hinged wings and
articulated perching feet that tuck during flight. `TerrainFootFrame` aligns
human and animal soles through complete affine parent transforms rather than
subtracting only knee/hip X angles. Troll hands are excluded from ground
planting. The four existing beast profiles and
wildlife simulation remain unchanged.

`WagonPresenter` is used by the default patrol, rich moving event and located
ambush. Cargo remains an ordinary separately addressable mesh with its existing
caller-owned robbery material. Two articulated draft oxen keep their own bodies;
the compatible wagon frame/wheel/harness surfaces use a separate batch. Wheel
rotation reads actual travel and each wheel's radius. Visual front-axle steering,
bounded frame slope, trace endpoints and cargo settling do not steer or move the
route/collider root.

## LOD and resource ownership

Humanoid hero/near/mid/far selection uses projected height and the shared policy's
distance scale and hysteresis. Role silhouettes retain bows, complete hafts,
quivers, packs, shields and headgear. Coarse geometry removes small bevels and
reduces local topology rather than deleting entire role components. Ink and
shadow participation reduce separately; the engine's outline setting, distance
and corpse policy remain required. LOD selection also runs for manual diagnostic
frames after the camera is resolved.

An active health bar replaces the redundant ground faction ring, not the actor.
It also holds a distant engaged character at least at Mid importance. Low Mid
omits the contact blob and Low Far omits the ground ring; body, weapon and shield
remain drawn. Death keeps status decorations off. These preview rules bound
the persistent status cost without discarding health or attack information.
Flat enhanced faction rings use one double-sided pass rather than submitting
an empty back-face pass followed by a front-face pass.

Animals use their actual body height, projected importance and the shared
hysteresis for hero/near/mid/far participation. Far animals retain their complete
body and animation but skip close terrain-foot sampling and ink/shadow work.
Animal topology refinement and the full dynamic-art fleet performance gate remain
work in progress. A one-body draw does not itself establish a tier pass, and the
whole-frame draw budget is not a character-only allowance.

Healthy humanoid batches use cache receipts. Each live rig retains at most its
two most recently used body templates, so a return across a nearby LOD threshold
can reuse construction work without retaining the full taxonomy. Retention has
its own receipts, is included in known CPU accounting and is drained after
active source bindings at teardown. Missing limb triangles are
explicitly removed from owned derived indices; prosthetic and wound data affect
owned color/response attributes. Bone visibility is never used as a substitute
for removing triangles. Replacements retain these states across LOD and camera
fade without modifying another actor's cached geometry.

Every returned `ArtGeometryReplacementOutcome` transfers the next lease,
including `committed-with-errors`. A thrown preparation failure alone leaves a
distinct lease with the caller. Cleanup errors are propagated outside the
rejected-lease catch. Release outlines and source bindings before skeleton/bone
textures. The source rig owns the skeleton; ink and depth borrow it.

Creature source-part geometry is still retained by the engine's bounded geometry
cache until teardown; the rig retains one canonical body receipt independently
of its binding's active geometry. Rejected material/binding preparation releases
only that builder's receipts and restores its original named meshes. This is not
yet a claim that every animal LOD/cache allocation settles at its final budget.

## Contact and accounting interfaces

Both `characterPresenter(root)` and `creaturePresenter(root)` return the
corresponding production presenter, or `undefined` for a different/legacy root.
Their `sampleContact(part, target)` methods use cached named transforms and fill
caller-owned `point`/`normal` vectors plus physical `surface`. Hidden/missing or
absent parts return `false`. Normals use the world inverse transpose.
`CharacterContactPart` covers torso, head, four limbs, weapon, weaponGrip,
weaponTip and shield. Grip origins follow the actual hand frame; tip positions
are read from the generated weapon geometry rather than one constant for every
weapon. Torso surface identity follows the actual armor/cloth layer, including
unarmored civilians. Not every creature has every part.

These presentation anchors do not replace an already-resolved projectile
intersection or `DamageResult.direction`. GFX-05 owns impact routing and effects.

Presenters expose `allocationReceipts()` using actual CPU backing identities and
the shared `VisualAllocationReceipt` schema. Unknown GPU upload attribution is
`null`, not a CPU-array-size estimate of a GPU allocation. Active humanoid binding
clones are reported separately from base geometry. The runtime-dependent storage
of plain JavaScript matrix arrays is not reported as an invented byte-addressed
allocation. Persistent source and
registered ink/health objects carry `visualSubsystem: 'dynamicArt'` tags for the
existing diagnostics owner to integrate.

**Full inventory and per-frame attribution remain incomplete.** Current receipts
are not closure over every cache original, health/contact resource, bone texture,
GL handle, submission path or CPU scope. No `resourcesComplete` or hardware-tier
success is asserted. GFX-01/GFX-06 own the coordinated extension to existing
whole-frame accounting; there is no second profiler.

## Current acceptance limits

CPU tests exercise actual GameEngine factories, indexed deformed finger vertices,
full hand/handle matrices, world contact normals, explicit missing-limb indices,
shared-neighbor immutability, terrain/root separation, LOD replacement, independent
animal joints, plain/gilded wagons and stopped wheel behavior. The original
rig/gaze/geometry regressions remain in place. Guard variants are checked against
the shared per-tier source-plus-ink geometry envelope with ring/contact/health
geometry included; this is a geometry upper bound, not an actual GL/frame result.
The production guard graph also stays within the per-role near/mid/far
submission upper bounds with health both hidden and visible, explicitly pricing
transparent double-sided material passes. This does not replace whole-frame GL
measurements or establish the fleet's actual LOD mix.

Still required before a complete milestone claim:

- Real same-camera/lighting all-faction portraits and player-plus-NPC gameplay
  frames, followed by the user's anatomical/art-direction decision.
- The coordinated affine-bone normal correction. At the approved starting
  foundation, skin/ink normals use direction multiplication, which is not the
  inverse transpose for nonuniform/sheared bone transforms. Keeping source and
  ink equal does not make that normal mathematically correct.
- Complete pose/attachment/injury/LOD motion evidence across the population.
- Remaining animal/faction art refinement and measured construction/replacement
  CPU, submitted draws and full allocation inventory.
- Leased production 25-actor whole-frame and lifecycle measurements with explicit
  device and unsupported-hardware limitations.

No browser/GPU job is authorized by this document. The coordinator's serialized
window and the existing GFX-01 capture contract remain mandatory. No default
promotion or human approval is implied by a CPU checkpoint or a successful bundle.
