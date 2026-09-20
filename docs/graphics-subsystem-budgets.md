# Provisional subsystem allocations

**Engineering envelopes, not achieved-device results or permission to ship.**
The CPU-reviewed foundation source is
`bfae58b34a411ab434d387e6710fd97be6b2acb3`. Its GPU/GLSL/motion evidence is still
pending at this allocation checkpoint. Legacy remains the default; enhanced is
an explicit foundation preview, not completed GFX-02, character/world art, or a
quality-tier approval.

These allocations partition the existing policy, not a second settings system.
`resolveVisualSubsystemAllocation(getVisualPolicy())` in
`src/game/visualBudget.ts` returns immutable acceptance data for enhanced mode
and `null` for legacy. It checks that the draw, main-view triangle and GPU-byte
allocations exactly sum to the existing global policy. A future global change
requires an explicit coordinated allocation revision; no owner inherits spare
capacity automatically.

## Evidence used, and what it does not establish

The unchanged [GFX-01 results](graphics-baseline-results.md), measured at
`931360200e5d24cb6f02da3ac1066174aeb0309f`, record 1,423 peak whole-frame draws
with 25 allocated NPCs plus the player, 21-25 living NPCs and up to 11 acting.
Crowd main-view triangles peaked at 179,652; CPU-total p95 was 12.0 ms, RAF p95
17.7 ms and GPU p95 9.75 ms. The bridge reached 745 draws. The legacy bloom chain
used 15 draws, not its last single-triangle pass. Baseline storage was roughly
174.4-176.3 MiB when the tracked API allocations and separate canvas estimate
are combined, before unknown driver/browser overhead.

Those are whole-frame discrete-desktop observations, not measurements of the
new skinned character batch or subsystem costs. They justify batching, paying
for all passes, and reserving pipeline storage. They do **not** give either
characters or world the full 700/450/300 draw cap. The legacy overrun does not
block a first-role prototype: measure that new role's real contribution and a
labelled fleet projection, rather than requiring still-legacy actors to meet
the final integrated target before they can be replaced.

No new benchmark was run to choose these numbers. Real integrated/mobile devices,
sustained thermal behavior, human visual review, and the eventual combined
frame/resource matrix remain missing. A 390x844 viewport is layout evidence only.

## Non-overlapping frame allocations

| Tier | Dynamic art (GFX-03) | World (GFX-04) | Post + transient effects (GFX-02/05/06) | Existing total |
| --- | ---: | ---: | ---: | ---: |
| High | 360 draws | 280 draws | 60 draws | 700 draws |
| Balanced | 260 draws | 150 draws | 40 draws | 450 draws |
| Low | 180 draws | 100 draws | 20 draws | 300 draws |

Every number includes that owner's **source + ink + shadow** submissions.
Material groups and submitted instances count, even when a shader masks them.
The dynamic allowance is shared by the player, **all 25 NPC slots**, corpses
retained by production, health/contact presentation, creatures, ambient fauna
and every live default/rich/located caravan. `MAX_ACTORS` stays 25; three
companion identities and their gameplay are unchanged. This is not a population
reduction or an instruction to hide roles to hit a draw target.

World includes all simultaneously loaded/rendered terrain, roads, water,
buildings, trees, rocks, dressing and their ink/shadows. No per-region copy of the
whole allowance. Existing world ink caps remain 8 per region and 48 visible.
World shadows are **subsets** of its row, using the actual policy fields:

| Tier | Map | Distance | `worldCasterBudget` (draws) | `worldInstanceBudget` | `worldTriangleBudget` |
| --- | ---: | ---: | ---: | ---: | ---: |
| High | 2048 | 40 m | 16 | 48 | 60,000 |
| Balanced | 1024 | 28 m | 8 | 24 | 30,000 |
| Low | 512 | 0 m | 0 | 0 | 0 |

Use `shadowSubmissionCost` and `WorldPresentationRegistry.debug` from the
foundation. The instance budget counts submitted instances **per draw/group**,
not unique selected trees. `selectedShadowInstances` is a separate statistic;
full batches retain their submitted triangle/instance charge despite masks.

Inside the final bucket, reserve **16/16/0 draws for the sole post pipeline**
and **44/24/20 for transient effects**. Sixteen is the provisional allowance for
the existing 15-draw bloom path plus final FXAA, not a new measured result.
Bloom-off/Low must actually submit zero post draws; unused post capacity is not
silently reassigned to effects. GFX-05 owns pooled sparks, blood, dust, damage
numbers, callouts, decals, transient impact lights and weapon-trail effects.
GFX-03 owns persistent rigs, equipment/attachment anchors, health bars, contact
shadows and their animation. A shared effect is billed once to GFX-05, never
again to every actor.

| Tier | Dynamic / world / effects main-view triangles | Dynamic / world / effects CPU scope per frame |
| --- | --- | --- |
| High | 250,000 / 330,000 / 20,000 = 600,000 | 4 / 4 / 2 ms |
| Balanced | 120,000 / 170,000 / 10,000 = 300,000 | 3 / 3 / 1 ms |
| Low | 60,000 / 85,000 / 5,000 = 150,000 | 4 / 4 / 2 ms |

Main-view triangles include source and ink, not shadow/post copies. Whole-frame
draws still include all passes. The CPU numbers are new provisional ceilings for
disjoint **presentation update plus submission** scopes of the same frame.
They exclude unchanged AI/combat/director/audio and DOM/browser work; the
unattributed remainder is not spare art time. World pays for its added canonical
sight matrix/collection work and presentation registry. Sum same-frame durations,
not separate p95s. Record cold construction, replacement and streaming spikes
separately; the global 16.7/16.7/33.3 ms p95 frame gate still applies to real
production frames and cannot be established by this per-frame checker.

## Retained resources and peak allocation

All values below are MiB. GPU allocations include their assigned buffer/texture
storage and the pipeline's canvas/MSAA estimates, not physical resident VRAM.

| Tier | Dynamic GPU | World GPU | Pipeline/effects GPU | Existing total |
| --- | ---: | ---: | ---: | ---: |
| High | 32 | 48 | 176 | 256 |
| Balanced | 24 | 32 | 136 | 192 |
| Low | 16 | 24 | 88 | 128 |

The pipeline bucket pays once for shared standard-family ramps/contact maps used
across owners, the key shadow target, composer/depth/bloom/AA targets and canvas
resolve/MSAA/depth. Do not bill a target to each caster. Role-only maps belong
to dynamic art; world-only procedural maps belong to world. Classification for
accounting does not transfer disposal ownership from `StylizedArtLibrary`,
`BloomPostProcessor`, the renderer or source owners.

| Tier / owner | CPU backing | Geometry | Full binding clones | Skin | CPU-only sight |
| --- | ---: | ---: | ---: | ---: | ---: |
| High dynamic | 64 | 40 | 24 | 8 | 0 |
| High world | 96 | 64 | 24 | 0 | 24 |
| High pipeline/effects | 32 | 8 | 0 | 0 | 0 |
| Balanced dynamic | 48 | 30 | 18 | 6 | 0 |
| Balanced world | 64 | 40 | 16 | 0 | 20 |
| Balanced pipeline/effects | 24 | 6 | 0 | 0 | 0 |
| Low dynamic | 32 | 20 | 12 | 4 | 0 |
| Low world | 48 | 30 | 12 | 0 | 12 |
| Low pipeline/effects | 16 | 4 | 0 | 0 | 0 |

These CPU limits cover retained backing stores, not an invented exact JavaScript
heap size. Also report cache keys/receipts, skeletons/bones, proxy nodes, and
heap observations when available. Unknown object/driver/program overhead is not
zero and prevents a claim of full heap/VRAM coverage. The foundation's 128 enhanced
material keys, 1,024 presentation registrations and 4,096 registered instance
slots remain hard safeguards, not extra budgets to multiply per region.

Geometry includes cache originals, active and inactive retained LODs,
injury/prosthetic derived geometry, positions/normals/colors/UVs, packed response,
wind/water/visibility data, skin indices/weights and indices. The foundation
clones **all backing attributes** for mutable bindings, not just visibility.
`getRenderBindingStats().geometryBytes` already includes its `attributeBytes`;
do not add the latter again. `artGeometryBytes` counts unique backing buffers
within one geometry; shared backing buffers across geometries must still be
deduplicated across receipts. Morph/instance/other additional storage, when
introduced, must also be enumerated rather than assumed covered by that helper.

Bone matrices, inverse-bind backing data, scratch poses and bone-texture CPU
storage belong to the rig. The bone texture's GPU allocation is billed once;
skinIndex/skinWeight remain in geometry and must not be added again as skin.
Source and ink borrow the same skeleton and geometry but submit separate draws.
Canonical sight proxies submit **zero** source/ink/shadow/GPU work. Retain exact
legacy geometry/transform/material-side behavior: shared render/sight geometry
is one allocation; additional legacy-only geometry and proxy matrices are a
CPU-only world charge. Do not upload invisible canonical data to simplify billing
or reduce it to make an envelope appear to fit.

Apply retained limits at both steady residency and construction/replacement
peaks: simultaneous old and new lease geometries, old/new full binding clones,
temporary merge/index arrays and skeleton data all cost real bytes. Do not keep
the full role x variant x four-LOD taxonomy resident per engine. A cache receipt
remaining after scene removal is still charged.

## First complete guard-soldier proof

The first role is a complete production role, not a lineup-only mesh: variants,
body, named shield/polearm/weapon attachments, spawn, moving/aiming/attacking,
injured/prosthetic/death poses, saved appearance and all relevant LODs.

| Per live rig | High | Balanced | Low |
| --- | ---: | ---: | ---: |
| Near whole-frame draws | 11 | 11 | 9 |
| Mid / far draws | 7 / 4 | 7 / 4 | 5 / 3 |
| Near main-view triangles | 8,000 | 6,000 | 4,000 |
| Exclusive CPU backing (MiB) | 2 | 1.5 | 1 |
| Construction/replacement peak backing (MiB) | 6 | 4 | 3 |
| Cold construction CPU / replacement CPU | 12 / 4 ms | 10 / 4 ms | 8 / 4 ms |
| Maximum joints | 64 | 64 | 64 |

A near 11-draw proof can be one compatible body batch plus weapon and shield:
3 source + 3 ink + 3 shadow + 2 health/contact. That is an upper-envelope example,
not permission to call material groups a single draw. Combine compatible
surfaces/weights and retain role silhouette gear at distance; use stable
importance/LOD hysteresis, never hide a shield/polearm merely because generic
face detail crossed 26 m.

At 26 fully near 11-draw rigs, 286 draws leave High 74 dynamic draws for actual
caravan/fauna and other dynamic presentation. For Balanced, a **labelled
projection** of 8 near + 9 mid + 9 far rigs is 187 draws, leaving 73 of 260.
The corresponding Low projection is 144, leaving 36 of 180. Neither projection
is a measured game workload, an actor-priority cap or permission to force
nearby combatants into unreadable LODs. Count the actual mix and extras in the
real 25-NPC fixture and actual caravans. A prototype's individual maxima do not
guarantee that all rigs at every maximum fit simultaneously.

Failing a per-role budget calls for compatible batching, bounded cache lifetime,
or silhouette-preserving LOD iteration. If the readable near/crowded case cannot
fit, send the coordinator actual source/group/pass costs, resource receipts,
timing scope/device, proposed tradeoff and affected gate. Do not raise global
caps, remove actors, alter squad LOS/collision, throw away an injury, or borrow
world/FX capacity without an explicit revised allocation checkpoint. The first
role may progress as a measured prototype while its combined frame is still
over budget; no full-role/tier approval follows automatically.

## Accounting API and evidence closure

`src/game/diagnostics/VisualBudgetAccounting.ts` exports:

**Export:** `VisualAllocationReceipt`

- **Contract:** Actual allocation identity, one `chargedTo` bucket, kind, CPU bytes and known GPU bytes or `null`

**Export:** `sumVisualAllocationReceipts(receipts)`

- **Contract:** Deduplicates identical backing-buffer/GL-handle identities; rejects conflicting charges; no
  ownership/disposal/GL side effects

**Export:** `VisualBudgetEvidence`

- **Contract:** Same-frame per-subsystem pass totals/CPU scopes/resources, existing `GraphicsFrame` data, explicit
  inventory closure, canvas estimate and actual world-shadow counters

**Export:** `assessVisualSubsystemBudget(allocation, evidence)`

- **Contract:** `within-provisional-envelope` , `incomplete` , or `over-budget-or-inconsistent` ; named issues/missing
  data, never a device approval


Receipts are an accounting input, **not new lifetime owners**. A CPU backing
buffer and its distinct GPU buffer are different allocations; use separate
identities/receipts when needed. An ink borrower repeats neither allocation.
Unknown GPU bytes propagate as unknown. The closed GPU sum must equal
`GraphicsResources.trackedBytes + implicitMultisampleBytesEstimate +` the
separate default-framebuffer estimate; `renderTargetBytes` is already a subset.
Draw sums reconcile every pass against the actual whole-frame meter, not only
the last composer pass. Lines/points and extra material groups are included.
Counter-disabled controls and incomplete attribution cannot produce a within
result. Unused quality/effect capacity remains reserved.

The contract does **not** install another profiler or pretend the foundation
already emits complete subsystem attribution. GFX-03/GFX-04 must deliver named
live allocation/CPU/source receipts with their builders; GFX-05 does the same for
transient effects. Until those are integrated with the existing diagnostics,
the subsystem assessment is incomplete even when the whole-frame counters agree.
Run the new pure receipt/assessment tests without GPU work. A final frame and
peak-residency inventory, full-frame timing distribution, actual rendered/motion
evidence and human decision are still required.

Foundation lifetime contract remains unchanged:
`ArtGeometryReplacementOutcome.status === 'committed'` **or**
`'committed-with-errors'` transfers the next lease. Only a thrown precommit error
leaves a distinct next lease caller-owned. Report a returned cleanup error
outside the caller's rejected-lease catch; never release now-live geometry from
that catch. Release registrations, outline bindings and source bindings before
exclusive skeleton/geometry owners, and preserve the canonical sight receipts.
