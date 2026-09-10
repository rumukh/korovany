# Joined graphics CPU candidate

This checkpoint joins the approved immutable implementation inputs. The user
approved the current stylized character direction after reviewing the three
openings and 33 portraits captured on
`f61ce8d9e3381d4c73a48b0e09d40a777831e619`. That art-direction decision is not
approval of performance tiers, all animation/camera/world cases, device support
or complete resource ownership. Legacy remains the default; enhanced remains
opt-in, and bloom-off/Low retain the sole pipeline's genuine direct path.

| Input | Immutable checkpoint | Scope |
| --- | --- | --- |
| User feedback and progress | `7929bcce47609e5e6cc0420765df532388c089ad` | Master-plan status and requested three-faction head/anatomy direction |
| Foundation camera/evidence | `025973ea91fff14a6ddff6a51bdde3c4c0e74be1` | Original failures preserved; torso-visibility CPU correction, not post-fix GPU approval |
| Character/creature/caravan | `fc1af5436c7db73cd090f8a61823430f4a45408c` | Production presenters, anatomy, equipment, injury/LOD and all caravan paths |
| World | `3ef70590d68c6e509c006bf206478a61a9dfa563` | Tactile world, continuous water flow, exact physical/canonical sight boundaries |
| Atmosphere/effects/HUD | `e7383b84ca3c9099210871a8207522c451ca9022` | Actual shared weather/atmosphere, bounded secondary pool and optional compact HUD |
| Completed contact/admission/injury follow-up | `d48233b6c6d4f59abedfd2ae113b5fb818d87b9c` | Stage B, persisted NPC injury isolation and final three CPU review corrections |
| Exact current-main gameplay fixes | `4963002d9b2629dc809495e3d13583dbc3cb79c2` | Locomotion/posture, stopped and blocked movement, jump rearming, committed boar charge, true vertical camera/bow aiming and terrain collision |
| Strict portrait-save fix | `f61ce8d9e3381d4c73a48b0e09d40a777831e619` | Unchanged Chronicle synchronization no longer increments region revisions; full save comparison remains strict |
| Live subsystem diagnostics | `6313eecf66472cb83914abb5c748340acc5af648` | Actual source/pass and GL-handle attribution, shared/unmapped buckets and explicitly incomplete assessment |
| Flush ground receivers | `34b2bd4552bc921a5385c9521a1a9ab0122f23b5` | Paving on terrain and render-only road alignment after canonical capture; fixed depth bias and one factory road material |
| Known pipeline allocation billing | `218ae58c79380d695c7cdbdacf77e50a49ba8dbd` | Standard maps and observed shadow/post targets billed once; matching canvas/MSAA estimates separately labeled |

The merges preserve the individual histories, including the original GFX-01
corpus and GFX-02 failed motion evidence. Their measurements remain attributed
to the source commits that produced them, not to this joined implementation.
The prior first-visual candidate `3188a1e9662ae456638bb52d80a2a186eef452a2`
and its prepared jobs remain immutable historical artifacts. The completed Stage B
and current-main fixes form a new candidate; older build/job hashes must not be
used to run it.
The approved `f61ce8d` portraits and the ground-receiver comparison captured on
`7eb3d83c147373231caa14e876b3b5a5b95c2f96` remain evidence for their respective
source commits, not measurements of the final merged payload.

## Integration-only changes

Mixed character/creature/prop geometry now carries the actual GFX-05
`artWeatherResponse` channel before caching and merging. The additive
`bakeWeatherResponse(geometry, response)` helper uses the shared bounded defaults
and preserves already-authored channels. Character body/equipment materials
and packed world materials explicitly require that layout. No actor-specific
materials, new draws, shader family or per-frame material mutation is added.

Physical material identity survives batching: skin, cloth, metal and leather
have separate responses; bark/leaf parts retain their own defaults; prosthetic
replacement writes metal into its own geometry only. Simple ground/paving
continue using their shared per-material default, while water/glow and ink
are excluded from wetness. The existing library environment uniforms are the
single runtime weather/atmosphere source for all consumers.

The historical documentation regression gate now recognizes an exact
one-millisecond token rather than matching the suffix of decimal component
measurements. It explicitly distinguishes the unchanged Chronicle tick bar
and the new named provisional effects CPU allowance. Unknown restatements still
fail, and the old no-added-geometry population scope remains required. No
measured value or global budget was edited to satisfy the test.

## Current-main and Stage B composition

The current-main fixes are preserved in history and behavior, not replaced by
the older graphics base. The enhanced `CharacterAnimationRig` exposes its actual
`torsoPivot` so the shared pose reset prevents accumulated evade tilt. Authored
and weather resting lean blend rather than stack, gait follows actual travel,
stopped actors settle, and a committed boar charge uses its collision path
without steering around a blocker. Jump release/rearming and grounded movement
retain the current-main implementation.

Both camera policies use current-main view-angle pitch and the trigonometric
orbit, with upward look not orbiting beneath the terrain. Enhanced mode retains
its volume/terrain and torso-sight candidate solver, follow/shake constraints
and foreground registry; its final viewing direction follows the same true
pitch/yaw as bow aiming. The enhanced elf's existing bow presenter receives
the actual shot elevation, including its unchanged ballistic launch offset,
rather than the older fixed horizontal cosmetic direction. Movement, melee,
shield and evade headings remain on the ground plane.

Historic fixture pitch numbers and the recorded river player/yaw/pitch are
still replayed without modifying their evidence, but they now enter the
current-main view-angle semantics. They are not a pixel-identical comparison
with the earlier camera model. Both recorded-position and native-route camera
proof must be recaptured on the new candidate before temporal approval.

The completed Stage B routes cached posed contacts and material responses while
preserving admitted projectile points and gameplay damage/direction. Confirmed
shield fallback is limited to an already-admitted block/perfect guard; the
raised contact is copied before stamina exhaustion lowers the shield.
Transient admission surrounds the existing single render call and restores
borrowed visibility in `finally`, including portrait/manual rendering failures.
Visible zero-opacity material slots still count; protected tells, projectiles
and rewards stay visible with an explicit overrun rather than a false budget pass.

`createGeneratedRngStreams` adds persisted `gameplay:injury` for NPC detachment
chance and visible-limb selection only. Player injury stays on combat RNG.
Old valid V3 saves without the new key derive its initial state from the same
world seed; an existing state, including zero, restores exactly and is written
by the ordinary save path. No version/key/fingerprint migration or cosmetic
global override is added. This is a deterministic starting point for formerly
unrecorded injury randomness, not a reconstruction of historical global state.
See [the complete Stage B contract](gfx-05-stage-b.md).

## Live diagnostics and ground-contact composition

The exact live diagnostics checkpoint adds the two engine host callbacks
`subsystemRoots` and `subsystemInventory`, with no change to save, portrait,
contact, camera or simulation ownership. The existing opt-in API exposes
`capabilities.subsystemBudget === 1` and `snapshot().subsystemBudget`.
The same nested render/GL observer bills source, ink, shadow and post work
once to `dynamicArt`, `world`, `postAndEffects` or `unattributed`.

The snapshot combines those actual completed-frame counts with current retained
owner receipts and observed GL handles. Source details are bounded to 2,048
records; unknown ownership stays unattributed. CPU backing identity is distinct
from actual GPU storage size. Unassigned shared and unmapped GPU allocations remain
separate, known mapped lower bounds can expose overruns, and missing subsystem
CPU scopes remain `null`. A no-overrun frame is not a complete inventory or
device pass. See [live subsystem diagnostics](graphics-subsystem-diagnostics.md)
for exact fields, stale-frame checks and explicit coverage gaps.

The approved pipeline-billing follow-up now applies the established subsystem
policy to known common shadow/post targets and standard ramps/contact maps:
these exact physical identities are charged to `postAndEffects` once, while
raw `claimantOwners` preserve who sampled them. The read-only
`StylizedArtLibrary.getStandardTextureInventory()` exposes only already-created
standard maps through `standardPipelineTextures`; it creates or uploads nothing
and transfers no resource ownership. Unrelated cross-owner storage stays shared.

`subsystemBudget.knownGpuBudgetLowerBounds.pipeline` reports observed storage
and available matching canvas/implicit-MSAA estimates separately. Stale storage,
resized framebuffers, unknown sample counts or absent frames do not get invented
estimates. The known pipeline lower bound can expose an overrun without making
full `gpuAllocatedBytes`, disjoint CPU timings, unused cache/material storage
or construction-peak coverage complete. The original `6313eecf` smoke remains
historical evidence; its formerly shared pipeline classification is not a fresh
measurement of this merged checkpoint.

The flush-receiver checkpoint composes through the same world inventory.
Enhanced paving removes its former 16 cm lift. Rendered roads cancel their
14 cm lift only after canonical sight captured the unchanged original buffer
and transform. Depth testing/writing remain enabled; fixed units -8 for road
and -16 for paving, with factor zero and ordered opaque draws, separate paint
layers without introducing physical surfaces. A single factory road material
borrows the terrain map; the live collector charges that observed texture
handle once despite both materials and retains unknown total GPU coverage.
No new per-region material, texture, draw, collider or canonical sight mutation
is introduced.

The owner confirmed repaired boot/contact-disc occlusion in one held opening;
coarse rendered terrain versus continuous physical height and flat contact-disc
clipping on slopes remain limitations. Neither that image nor the user's
character-direction approval resolves the final world/motion/device matrix.

## Interfaces for the next consumers

| Interface | Required semantics |
| --- | --- |
| `characterPresenter(root)` / `creaturePresenter(root)` from `art/index.ts` | Actual cached presenter lookup; `undefined` for absent/legacy/wrong roots. No inferred cast or per-contact scene traversal. |
| `presenter.sampleContact(part, target)` | Fills caller-owned `CharacterContact.point`, `.normal`, `.surface`; world-space point and inverse-transpose contact normal. Returns `false` for absent/hidden/missing/unarmed anchors; callers must not reuse stale scratch after `false`. |
| `CharacterContactPart` | Torso/head/four limbs/weapon/weaponGrip/weaponTip/shield; not every creature supplies every part. |
| `characterPresenter(root).setAppearance(...)` | Existing owned derived geometry and replacement contract, preserving missing/prosthetic state and shared neighbors. |
| `wagonPresenter(root)` | All default/rich/located production paths retain their presenter, cargo and articulated draft animals; motion does not replace route/collision authority. |
| `GeneratedWorldRuntime.surfaces` | `WorldSurfaceField` in enhanced mode, `null` in legacy. |
| `createWorldSurfaceSample()` / `surfaces.sampleInto(x, z, target)` | Read-only classification scratch: material, region/biome, road/paving/vegetation/shore/flow/visual water depth/bridge contact. No new physical height or normal. |
| `surfaces.courts` / `.bridgeContacts` | Frozen metadata from unchanged site layouts and canonical bridge dimensions. Decorative bridge camber is not a new collision deck. |
| `GeneratedWorldRuntime.getVisualInventory()` | Actual CPU receipts and source identities, retained caches/full clones/maps/canonical-only backing. Explicitly incomplete GPU/JS/temporary-peak coverage. |
| `presenter.allocationReceipts()` / `SecondaryEffectPool.getAllocationReceipts()` | Real backing identities and existing charge buckets; unknown uploads remain `gpuBytes: null`. The small secondary pool is not the full effects inventory. |
| `GameEngine.getVisualPolicy()` | Single effective settings policy, reported by the existing diagnostic snapshot. New art, compact DOM and effect preferences do not become campaign fields. |
| `ContactPresentation` / `getTransientEffectInventory()` | Actual cached posed/material routing and source/backing inventory; explicit fallback provenance and incomplete GPU/CPU measurement coverage. |
| Diagnostic `rendering` | Combined `camera`, `bindings`, `post`, `foundationFixture`, `characterPortrait`, `atmosphere`, `secondaryEffects`, `contacts` and `transientEffects`; raw inventories contain object identities and are not automatically JSON-safe GPU evidence. |
| Diagnostic `subsystemBudget` | Actual same-frame owner/pass submissions, bounded source details, live retained CPU/GL inventory, known pipeline billing with raw consumers, `sameFrameStorage`, `knownGpuBudgetLowerBounds` and provisional `assessment`; missing GPU/CPU coverage is explicit. |

GFX-05 Stage B's completed posed-contact selection, per-hit material routing and
perfect-guard/cleave feedback are now integrated. Final visual tuning and actual
runtime approval remain open. This integration does not
replace an already-resolved projectile intersection, `DamageResult.direction`,
damage/injury timing, terrain/collision queries or authoritative weather with a
sampled cosmetic anchor. Wagon event contacts remain an explicit admitted-event
fallback because `WagonPresenter` has no per-part contact sampler.

`ArtGeometryReplacementOutcome` remains decisive: **every returned** `committed`
or `committed-with-errors` outcome transfers the next lease. Only thrown
precommit preparation failure leaves a distinct next lease caller-owned.
Propagate returned errors outside the rejected-lease cleanup catch, never
release live committed geometry from that catch. Registrations and outline
bindings release before source bindings, then exclusive skeleton/geometry owners.

Canonical gameplay sight is separate from art geometry, visual LOD, fade,
weather, camera recovery and surface metadata. Existing collision/navigation,
generation fingerprints, actor capacity, companion identities, saves and
combat commitments retain their production owners.

## Remaining gates

The coordinator-forwarded affine/nonuniform-bone **shader** normal correction
`9840eed0fff1f853978cefbe526b20d979637250` is now integrated. Main and ink retain
both its program revision and the atmosphere revision; position/depth skinning
remains the original owner implementation. CPU contact/GLSL arithmetic checks
still do not prove actual driver compilation or rendered correctness.

Original-owner portrait tooling
`dcd4958cf52b0749e7dae18dd574e35764b766f9` is integrated with its diagnostic
camera restoration, post-LOD fitting and zero-simulation guards. The completed
`f61ce8d` gallery shows real player/companion front/three-quarter/profile and
held gameplay views for all factions, and the user accepted its stylized
direction. This does not turn held poses into natural combat or comprehensive
animation proof. Preserve those original images rather than recapturing them
solely because diagnostics or receiver geometry was integrated.

For that bounded window the existing runner adds only `--portrait-smoke`
(one fixed player/front/current stage with `--portraits`), `--hud-mode`,
`--recorded-river-endpoint` and `--runtime-controls`. The recorded endpoint
comes from the immutable GFX-02 failure manifest, stages player/yaw/pitch rather
than forcing a camera position, and stays separate from a newly driven native
route. Runtime controls use the same held engine for four fixed size/DPR
combinations and actual paused bloom toggles, then restore its viewport. The
work deadline is checked before new stages; no phase retries or builds run
inside a pinned capture job. Browser resource leases, GO requests, HOLD windows
and AcquireBy permission gates were cancelled by the user; ordinary timeouts,
logging, isolated profiles/ports and owned-process cleanup remain required.
Coordinator ownership of the remaining matrix avoids duplicate runs, not access
to a shared GPU. Historical scripts and manifests retain their executed
provenance but are not current permission policy.
The separately pinned final-candidate job also runs a bounded real crowd/contact
phase with the existing guard-input schedule. It records actual contact-counter
progress, secondary admission, saved-stream telemetry and conservative transient
overrun reporting; it must not turn unobserved contacts into successful evidence
or claim that a short run proves a perfect guard, whole-fleet tier or device budget.

Post-fix river-camera endpoint/motion, shader coverage beyond the approved portrait
paths, world/biome/
water/bridge continuity, night/weather/compact-HUD behavior, resize/DPR,
input/focus cancellation and resource ownership require joined runtime evidence.
Subsystem CPU/GPU attribution, real 25-NPC frame budgets, temporary/resident
allocation closure, offline play/network acceptance, supported context recovery
and named mobile/integrated hardware remain open. The existing `bundle` command
builds the application and copies its self-contained HTML to `bundle.html`;
a successful bundle build is not proof of offline play. A past runner exit code
or this CPU candidate is not a temporal or device-quality pass.
