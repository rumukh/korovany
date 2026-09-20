# GFX-03 character rendering: implementation checkpoints

**The user approved the stylized character art direction on 2026-09-11 after
the three-faction portrait review. This is not a completed performance tier.**
Legacy remains unchanged and the existing staged
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

The joined atmosphere integration bakes `artWeatherResponse` into exclusive
parts before mixed-body/equipment caching. Values come from GFX-05's existing
`SURFACE_WEATHER_RESPONSE`: skin, cloth, leather and metal are distinct rather
than inheriting one cloth response for the entire batch. Hair uses the cloth
default and bone the skin default; neither introduces a new coefficient.
Prosthetic replacements write the metal response only into their owned
geometry. Creature and wagon batches preserve the weather preset of each
original physical material. These extra backing arrays are included by the
existing allocation receipts, not hidden from their CPU accounting.

Equipment uses a two-joint skin palette: rigid weapon surfaces use its root,
while bow string/nock vertices use the draw joint. NPC windup pulls the actual
string and arrow; contact/recovery removes the nocked arrow and releases the
string. The elf player's real arrow event immediately emits its unchanged
projectile, then starts a short, presentation-only released-bow recovery with
the offhand stowed. Expiry or a new action restores the normal weapon. The
named weapon node, torch/trail children, fade binding and skeleton stay stable
through these geometry changes. A surviving hand is selected without restoring
a missing arm. `jointCount` includes both body and equipment palettes.

### Held Forest Arrow presentation

`CharacterPresenter.setBowAiming(enabled: boolean): void` is an additive
enhanced elf-player presentation state, not gameplay authority.
`bowAimingActive` exposes its current visual state. Enabling requires a weapon
and at least one surviving arm; losing both arms exits immediately. The real
weapon source swaps to the existing two-bone ready bow, the offhand is stowed,
and all named torch/trail/ink children and source bindings remain attached.
Disabling restores the pre-aim arm/equipment transforms and the normal melee
weapon without mutating a paid projectile, damage, stamina or cooldown.

`poseBowAim(origin: THREE.Vector3, direction: THREE.Vector3): void` consumes a
finite **world nock origin** and **unit initial flight direction** supplied by
gameplay. Apply it last, after ordinary chest/arm/attachment and grounding work.
It fits both surviving arms without translating wrists away from the actual
forearm ends, preserves full affine hand matrices, and aligns the deformed arrow
nock and bow-forward axis to those supplied values. Hold draw is bounded to
0.08--0.30 m to accommodate the posed reach; this is not an aim-power mechanic.
An invalid or unreachable input throws before changing either arm/weapon pose;
the caller must not mask that contract failure with a visual-success fallback.

Call the existing `advanceActionPresentation(delta, interrupted)` each frame.
Here `interrupted` means an actual cancellation, **not** "the current attack is
not an arrow" while aim is held. `delta = 0` freezes the visual clock; a genuine
interruption still cancels immediately. `beginArrowPresentation(direction,
verticalAim)` remains the real-shot notification: it removes the nocked arrow
immediately, releases the string and plays the existing 0.35 s recovery. While
held, the grip recoils at most 0.045 m instead of jumping by the draw distance,
and recovery returns to a ready bow. Exiting during recoil restores melee
immediately. Without held aim, the original direct-shot recovery still returns
to the original melee weapon. `poseArrowRecovery` and `poseSupport` deliberately
do nothing while held, avoiding a second pose pass over `poseBowAim`.

The rejected initial gameplay nock offset `(-0.25, 1.65, 0.65)` is **not reachable**
by the existing elf hero at level aim: its draw-hand shoulder is 1.19236 m from
that origin but the upper arm plus forearm is 1.18 m; the bow hand with just
0.08 m of draw requires about 1.1996 m. This is not corrected by moving a root,
lengthening limbs or sourcing physics from render anchors. The art-side
regression fixture also covers arbitrary full-affine posed parents.
The gameplay owner settled the canonical nock at root-local
`(-0.25, 2.05, 0.35)`, mirrored for a missing left arm and rotated by the player
root heading, with neutral chest rotation during aim. Close targets may reduce
the lateral/forward offsets proportionally. This module consumes that origin;
it does not own or alter the gameplay muzzle constants.
The production CPU sweep covers 1,620 combinations through pitch +/-1.2 radians,
relative yaw +/-0.27, three close-target offset factors, signed terrain slopes,
real gait/grounding, breathing scale and both one-arm fallbacks. It measures
actual nock/finger vertices and unchanged roots, pelvis, legs and injury indices;
it is not a browser/input/physics or human visual acceptance claim.

### Legacy held-bow adapter

`LegacyBowPresentation` is a separate elf-player-only adapter over the production
legacy named rig. Construct it before applying that root's legacy outlines:

```ts
const bow = new LegacyBowPresentation(root, {
  bowGeometry, arrowGeometry, stringGeometry,
  bowMaterial, arrowMaterial, stringMaterial,
})
```

The caller supplies immutable cached assets: `buildWeaponGrip('bow')` wood
(the existing cache key is `char-weapon:bow:grip`),
`buildIllustratedNockedArrow()` and a centered unit-height Y segment such as
`new THREE.BoxGeometry(0.016, 1, 0.016)`. Materials are the caller's existing
wood/leather, arrow/metal and string/dark materials. Do not use
`buildWeaponHead('bow')`: that legacy part combines arrow and string and cannot
hide the released arrow independently. The helper owns only its group and four
mesh nodes, **not** the supplied geometry/materials; it never mutates or disposes
those cache assets. `dispose()` restores baseline state and removes its group.
Release caller-owned outline bindings and resources through their existing
owners at teardown.

It exposes the same `setBowAiming`, `poseBowAim`, `beginArrowPresentation`,
`advanceActionPresentation` and `bowAimingActive` integration surface. Pose it
last and use the same gameplay-owned canonical origin/direction. The shared
`BowAimPose` math handles both enhanced wrist anchors and legacy's actual glove
palm center, which is part of the forearm geometry. There are no detached hands,
stretched limbs, actor/root/leg writes or new gameplay decisions. A steady pose
only changes transforms; its two rigid string segments meet at the nock and
remain attached to the bow endpoints. `visual` exposes the helper's
`legacy-bow-presentation` group for the caller's normal outline ownership.

Only the original `weapon-head` and `weapon-grip-detail` representation are hidden
while held; hiding the LOD parent prevents automatic LOD updates from reviving
the old melee grip. The named weapon pivot, torch/trails, limb visibility,
prosthetic materials and shield remain intact. Release hides the real arrow,
recovery rearms it after 0.35 s, and exit/cancellation restores the saved melee
and shield state. Non-held shot notifications intentionally do nothing so the
unchanged legacy baseline is not modified. No GameEngine hookup is supplied by
this art module.

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

Balanced and Low NPC bodies use compact limb and boot topology; players and High
retain their previous geometry. Skull/jaw/nose/ear/neck anatomy, hair, physical
palette and weather-response values are unchanged at the corresponding detail level.
Near hands retain the curled handle opening with one finger band instead of
separate subpixel finger extrusions; Mid also omits tiny palm/arm/shoulder chamfers.
Joint bulges and limb endpoints remain, with fewer intermediate rings and a
six-sided Mid leg section. Boots replace three overlapping closed solids with
one closed outside skin, retaining the exact sole plane and bounding extents.
Six-direction surface probes bound the boot contour difference to less than
3 cm; they do not mistake a grazing-ray ankle-to-sole depth jump for a vertical
rig offset. Full-affine hand and sole transforms are unchanged.

Wrapped NPC grips retain the complete haft and blade, omitting small concentric
wrap ridges in these two tiers. Sword guards omit their small corner chamfer and
pommels retain their axial profile with five rather than seven radial segments.
Bow draw/release geometry,
shields, torch/trail children and contacts stay unchanged. Compact/full topology
has distinct cache keys; active and retained receipts still use real backing
identities. Neither the projected LOD thresholds, engaged-Mid floor, actor
population, ink participation nor subsystem allocations were reduced to obtain
the geometry savings. Whole-frame source-plus-ink maxima, not this per-actor
description, determine whether a crowded run fits its allocation.

Low NPC headgear also has coarse tessellation: nasal/crested dome and brow-band
rings, cheek-plate bevels, kettle brims, caps and open hood arcs. This does not
change skulls, jaw/nose/eye geometry, the fitted gear vocabulary, eye openings or
the presence of crests/horns. Players, Balanced and High keep their original
headgear buffers. Low headgear has its own body-template cache identity even
when Low Near and Balanced Mid otherwise resolve to the same body detail.
Low NPC eye and mouth marks keep their original forward polygons and planes,
indexing out the subpixel rear/side walls of their solid boxes/extrusions.
Their source backing attributes are retained and billed, not reported as freed
CPU memory. This reduces the three paired facial-mark parts from 100 to 18
submitted triangles without shortening a nose, changing a jaw or moving an eye.

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

- Complete pose/attachment/injury/LOD motion evidence across the population.
- Remaining animal/faction art refinement and measured construction/replacement
  CPU, submitted draws and full allocation inventory.
- Production 25-actor whole-frame and lifecycle measurements with explicit
  device and unsupported-hardware limitations.

The initial three-faction portrait/art-direction gate and coordinated affine-bone
normal correction are complete; neither stands in for the remaining coverage
above. Browser resource permission gates were cancelled by the user; the existing
GFX-01 capture contract, ordinary timeouts and owned-process cleanup remain.
No default promotion or hardware-tier approval is implied by a CPU checkpoint or
a successful bundle.
