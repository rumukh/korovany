# Live subsystem budget diagnostics

The opt-in graphics API now connects the production render observer and live
allocation inventories to `assessVisualSubsystemBudget`. It is not another
renderer, quality policy, benchmark baseline, or hardware approval.

Use the existing production build and isolated runner:

```powershell
npm run build
node scripts\graphics-run.mjs --out C:\graphics-evidence\subsystem-smoke --cases guard-opening --repeat 1 --visual-mode enhanced
```

This command performs a bounded manual rendering smoke, not an active performance
profile. The per-capture JSON contains `snapshot.subsystemBudget`. Interactive
consumers can read `window.__korovanyGraphics.snapshot().subsystemBudget`;
`capabilities.subsystemBudget` is `1`. The API still requires the explicit
`graphicsDiagnostics=1` query. The original GFX-01 baseline images, manifests and
raw profiles are unchanged.

## What is wired

`GameEngine` supplies diagnostic-only callbacks for actual player/actor,
creature/wagon and atmosphere roots, live Character/Creature presenter receipts,
`GeneratedWorldRuntime.getVisualInventory()` and
`getTransientEffectInventory()`. The collector also walks those live roots at
snapshot time for material textures, rigid wagon parts, borrowed source/ink
geometry and skeleton backing stores. Inactive effect-pool sources use their
explicit inventory owner, not whether this frame happened to render them.

`GraphicsFrameMeter` retains the existing nested `render` /
`renderBufferDirect` / raw-GL observer. Each actual GL draw contributes once to
the original whole-frame counter and its same-frame subsystem partition:

| Dimension | Values |
| --- | --- |
| Charge | `dynamicArt`, `world`, `postAndEffects`, `unattributed` |
| Pass | `scene`, `ink`, `shadow`, `post` |
| Work | Actual calls, triangles, lines, points, submitted instances |

Instance counts are **submitted instance executions**, not unique NPCs or
selected shadow instances. Six material groups of a three-instance mesh cost
six calls and 18 submitted instances in that pass. Two transparent sides are two
actual calls. Shadow and post work are included. No role-count projection,
main-view-only count or final-composer-pass proxy is used.

Production `visualSubsystem` tags and bounded live-root identity lookup determine
the source's owner. Ink borrows the actual parent's owner even if the shell has
stale copied metadata. Unrecognized sources, invalid/conflicting owners and raw
GL outside a source boundary stay explicitly unattributed. Non-world render
passes with an actual source boundary are classified as post processing.

The owner/pass matrix, **including unattributed work**, must reconcile to the
existing whole-frame matrix. Unknown ownership makes coverage incomplete; it
does not quietly become world work or invent a reconciliation failure. The
existing assessment still reports actual known per-subsystem and global
overruns.

Source details name the actual source ID, borrowed-source ID, material UUID,
material-group range/index, owner, pass and observed work. They are limited to
2,048 entries for the latest frame. Overflow is reported; aggregate counters
still count every submission. Details contain scalar IDs, not retained meshes.
Root lookup uses a refreshed WeakMap (4,096-root bound, 64-ancestor bound), not
an unbounded per-frame scene walk.

## Physical allocation accounting

CPU receipts deduplicate **physical backing identities** across all live
providers, not only within one rig. Base and mutable binding-clone buffers retain
their distinct identities. Borrowed ink and skeletons do not create duplicate
allocations. Body and independently articulated weapon skeletons are both
included. Canonical sight buffers remain CPU-only; a real observed GPU upload
of a canonical-only backing is reported as a coverage violation.

Cross-owner allocations occupy an explicit shared bucket. Conflicting byte
lengths, resource kinds or CPU-only claims are reported separately and cannot
turn into multiple successful exclusive charges. Unowned CPU data also remains
separate. Raw provider coverage declarations are preserved under
`inventory.providers`, distinct from the composed collector's remaining gaps.

`GraphicsResources` connects owners to **real GL handles and storage calls**:

* `bufferData` and texture upload backings identify the storage actually used.
* Submitted sources identify their geometry, instance, skin and texture inputs.
* Existing THREE texture properties link actual texture handles; missing handles
  remain unknown rather than forcing an upload.
* Observed render targets identify color/depth/MSAA storage. Pipeline targets are
  charged once to post/effects. Common shadow targets remain shared until an
  explicit charge policy exists.

GPU byte counts come from the existing ledger's actual GL storage dimensions,
formats, samples and levels, **never a CPU receipt's byte length**. For example,
a 16-byte uploaded view of a 128-byte CPU backing is 16 bytes of observed GL
buffer storage, not 128. Multiple source/ink references do not duplicate the
handle's storage. Live known-owner, shared and unattributed GPU bytes reconcile
to the complete ledger. Unknown formats and implicit-MSAA estimates remain
explicit.

`inventory.gpu.byOwner` reports known mapped storage, while the assessment's
`subsystems.*.resources.gpuAllocatedBytes` remains null until ownership and
coverage can actually be closed. A known mapped lower bound already exceeding
its owner's ceiling is still reported as `knownMappedGpuBytes`; missing
coverage cannot hide that overrun.

Upload ownership can outlive a source while the actual GL handle remains live.
It is observation of retained API storage, not proof that a disposed owner
released all resources or that the bytes are driver-resident VRAM. Texture
handles and backing data do not retain source meshes or region hierarchies.
Target disposal removes diagnostic target registrations, and disabling or
disposing instrumentation restores methods and drops the lookup state.

## Snapshot and assessment semantics

| Field | Meaning |
| --- | --- |
| `frameId`, `submissions`, `sourceDetails` | Work from the latest completed logical frame |
| `inventory` | Current live retained owners, collected only on an explicit snapshot |
| `sameFrameStorage` | Current allocation events still match the measured frame's ledger |
| `subsystems.*.cpuMs` | Null: disjoint presentation-update scopes are not implemented |
| `assessment` | Existing provisional policy assessment plus precise composed coverage gaps |

CPU update/submission timings in the whole-frame profiler remain their original
actual scopes. They are not apportioned by draw count, estimated from actor
counts, summed across overlapping scopes, or reconstructed by adding p95s.
The canvas allocation estimate is supplied only when its dimensions still match
the measured frame. If resources changed after the frame, that staleness is
explicit rather than pretending the live inventory was captured historically.

Counter-disabled controls expose no subsystem submissions or live GPU inventory.
Their historical ledger is not recycled as current evidence. Legacy mode still
has no subsystem tier allocation. A snapshot before any completed frame cannot
claim measured source work.

**The current assessment intentionally remains incomplete** unless there is an
observed overrun/inconsistency. Missing retained cache APIs, unused shared
material/injected-uniform resources, unuploaded or unmapped backings, shared
charge policy, canvas/driver storage, disjoint presentation-update timings and
temporary construction peaks prevent a false acceptance result. These are
specific engineering coverage limits, not newly measured performance failures
or hardware-tier approval.

## Validation scope

The Node cases exercise the production observer and collector with real THREE
geometry, actual Character/Creature/Wagon construction, streamed world
inventories and the secondary-effect pool. GL/DOM execution is doubled for CPU
tests; no fabricated GPU durations are used. Negative controls include unknown
owners, raw GL without a source, root conflicts, cross-owner physical sharing,
conflicting receipts, borrowed body/weapon skin, grouped instancing, double
passes, nested shadow/post work, canonical-only uploads, source-detail overflow,
counter removal, stale frame storage and failed observer installation cleanup.

A separate small real-renderer smoke establishes the browser snapshot wiring.
It is not a rerun of the original performance baseline and does not approve
hardware tiers or the art direction.
