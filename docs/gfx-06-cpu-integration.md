# Joined graphics CPU candidate

This checkpoint joins the approved immutable implementation inputs. It is **not**
a rendered art decision, completed graphics tier, or default promotion. Legacy
remains the default; bloom-off and Low retain the sole pipeline's genuine direct
path. No browser/GPU job is authorized by this document.

| Input | Immutable checkpoint | Scope |
| --- | --- | --- |
| User feedback and progress | `7929bcce47609e5e6cc0420765df532388c089ad` | Master-plan status and requested three-faction head/anatomy direction |
| Foundation camera/evidence | `025973ea91fff14a6ddff6a51bdde3c4c0e74be1` | Original failures preserved; torso-visibility CPU correction, not post-fix GPU approval |
| Character/creature/caravan | `fc1af5436c7db73cd090f8a61823430f4a45408c` | Production presenters, anatomy, equipment, injury/LOD and all caravan paths |
| World | `3ef70590d68c6e509c006bf206478a61a9dfa563` | Tactile world, continuous water flow, exact physical/canonical sight boundaries |
| Atmosphere/effects/HUD | `e7383b84ca3c9099210871a8207522c451ca9022` | Actual shared weather/atmosphere, bounded secondary pool and optional compact HUD |

The merges preserve the individual histories, including the original GFX-01
corpus and GFX-02 failed motion evidence. Their measurements remain attributed
to the source commits that produced them, not to this joined implementation.

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
| Diagnostic `rendering` | Combined `camera`, `bindings`, `post`, `foundationFixture`, `atmosphere` and `secondaryEffects`; raw inventories contain object identities and are not automatically JSON-safe GPU evidence. |

GFX-05 Stage B owns final posed-contact selection, per-hit material routing,
perfect-guard/cleave feedback and visual tuning. This integration does not
replace an already-resolved projectile intersection, `DamageResult.direction`,
damage/injury timing, terrain/collision queries or authoritative weather with a
sampled cosmetic anchor. The existing APIs above need no additional contact
adapter before that distinct assignment.

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

The separately assigned affine/nonuniform-bone **shader** normal correction is
not implemented by this integration. Correct CPU contact normals do not prove
correct rendered source/ink/depth normals. Only an exact coordinator-forwarded
follow-up may be merged; no duplicate normal patch is implied here.

Portrait tooling remains with its original owner. After that and the normal
fix, the first joined browser window should show the actual three factions
front/three-quarter/profile and in player-plus-NPC play, not repeat the full
old baseline before the user sees the new anatomy. The user's guard uniform
preference and rejection of elf/villain pumpkin-like heads remain an explicit
visual decision, not something CPU geometry bounds can approve.

Post-fix river-camera endpoint/motion, actual shader compilation, world/biome/
water/bridge continuity, night/weather/compact-HUD behavior, resize/DPR,
input/focus cancellation and resource ownership require joined runtime evidence.
Subsystem CPU/GPU attribution, real 25-NPC frame budgets, temporary/resident
allocation closure, offline release, supported context recovery, named
mobile/integrated hardware and human approval remain open. A past runner exit
code or this CPU candidate is not a temporal, device or art-quality pass.
