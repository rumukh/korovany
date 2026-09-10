# Finite GFX-03 first-visual capture tooling

This is the CPU-prepared tooling for the **first human character-image decision**,
not that decision or a completed graphics milestone. Character art stays at the
existing implementation checkpoint. No browser/GPU run is part of the tooling
checkpoint. Run only after the coordinator supplies the integrated affine-normal
fix and a fresh serialized graphics window.

## One short job, three actual worlds

The job uses the existing `graphics-run.mjs`, production `dist` server, isolated
Chrome profile, `window.__korovanyGraphics`, and whole-frame diagnostics. It does
not add another engine, renderer, account, model, or testing framework.

Dry preparation, with no server/browser/files created:

```powershell
node scripts\graphics-first-visual.mjs --workspace C:\absolute\integration-worktree --out C:\absolute\new-evidence
```

After building the **approved integration worktree** and receiving its graphics
window, the coordinator can execute:

```powershell
node scripts\graphics-first-visual.mjs --workspace C:\absolute\integration-worktree --out C:\absolute\new-evidence --expected-commit FULL_40_CHARACTER_SHA --execute --lease CURRENT_COORDINATOR_WINDOW_ID
```

`GRAPHICS_WORKSPACE` and `GRAPHICS_OUTPUT` are equivalent defaults for the two
paths. `--chrome` overrides the existing installed-Chrome path.
`--workspace` selects the build, dependency installation, Git identity, and
fixture save/manifest resources; tooling can therefore be run against the
authoritative GFX-06 worktree without copying art or changing that branch here.
The job prints its exact executable/arguments before execution. A lease string
is recorded provenance, **not acquisition or proof that the GPU is available**.

The estimated reserved duration is **10-15 minutes**, not a measured runtime.
There are three launches, not fourteen baseline jobs:

| Per faction | Frames |
| --- | ---: |
| Existing player: front / three-quarter / profile, current pose | 3 |
| Existing companion-0: front / three-quarter / profile, current pose | 3 |
| Player plus existing NPC context through the normal gameplay camera | 1 |
| Held player walk, companion windup, companion contact | 3 |
| Guard player's shield pose, or the actual elf/villain companion archer aiming | 1 |

Total: **33 staged views plus three opening frames**, one browser/server owned
by the existing runner. All three use clear visual weather, visual time 16.8,
seed 20260906, enhanced Balanced, 1920x1080, DPR 1, and matching effect preferences.
Simulation remains held; the normal-camera images are gameplay *views*, not a
claim of natural play or completed combat. No profile, active motion sequence,
baseline-corpus rerun, lifecycle campaign, or image-generation job is included.

## Additive versioned stage contract

The existing API version remains 1. A capability reports
`capabilities.characterPortrait === 1`. The optional stage payload has its own
version and only finite enums:

```ts
portrait: {
  version: 1,
  subject: 'player' | 'companion-0' | 'companion-1' | 'companion-2',
  view: 'front' | 'three-quarter' | 'profile' | 'gameplay',
  pose: 'current' | 'idle' | 'walk' | 'windup' | 'contact' | 'guard' | 'aim',
  frame?: {
    position: readonly [number, number, number],
    target: readonly [number, number, number],
    fov: number,
    near: number,
    far: number,
  },
}
```

Example:

```js
window.__korovanyGraphics.stage({
  label: 'STAGED elf companion face; actual production rig, held simulation',
  portrait: { version: 1, subject: 'companion-0', view: 'three-quarter', pose: 'current' },
})
window.__korovanyGraphics.render(2)
window.__korovanyGraphics.stage({ label: 'Restore production camera and poses', portrait: null })
```

Companions are the actual squad membership, sorted by durable actor ID. Missing
slots fail; the stage does not silently spawn replacements. Guard/aim require
the corresponding existing equipment. Dead subjects permit only `current`.
There is no arbitrary pose angle, expression, function, or engine-evaluation
endpoint. Unknown fields, nonfinite camera data, excessive camera ranges,
unsupported versions, and mixed portrait/world/effect requests fail explicitly.

The pose adapter invokes the actual `GameEngine.animateCharacter`, retained
head/weapon/hand helpers, and fixed authored pose coefficients. It never advances
an action, samples a gameplay random stream, rebuilds a healthy body, changes
injury indices/materials, raises the gameplay shield flag, or calls attack.
Local transforms, including affine hand/foot matrices, are retained and restored
between requests and on release. Gameplay roots and visibility masks are not
rewritten. Existing saves and paid commitments remain intact.

While a portrait is active, `step`, `profile`, and nonzero/nonmanual logical
frames are rejected before simulation. `render` remains zero-delta even when the
run was already paused. Clear with `portrait: null` before active gameplay or
other fixture prerequisites. Staging never resumes a paused fight.

An owned DOM label visibly says **STAGED PORTRAIT - NOT CAMERA COLLISION
EVIDENCE** (or **STAGED GAMEPLAY VIEW**). It uses text content, is removed on clear
and disposal, and does not alter the player's persistent HUD preference.

## Posed bounds, camera fitting, and comparisons

`GraphicsCharacterPortrait` reads actually referenced, posed mesh vertices,
including skinning, rather than a rest-pose bound or empty head anchor. It
excludes ink shells and transparent effects. Head-affiliated bone vertices and
ordinary head descendants determine the face/helmet bound; a bounded neck/upper
torso margin supplies a bust frame. Measurement is limited to 512 nodes and
200,000 referenced vertices per subject.

The three portrait directions are predefined offsets of 0, 45, and 90 degrees
from the subject's actual forward axis. A 38-degree camera fits the head/bust
bound using both viewport axes, then derives near/far clearance. Invalid/oversized
fits fail rather than moving the subject. The `gameplay/current` view has no
portrait camera override and uses the original production camera/pose.

Portrait camera overrides deliberately **do not exercise gameplay collision**.
World geometry and other NPCs are not hidden; actual occlusion remains visible.
`focusInsideClip` reports geometric framing, not final-pixel face visibility
through foliage/gear, GPU shader correctness, or human approval.
Normal gameplay captures require at least one actual companion head inside the
camera clip volume and record the projected player/companion context. This is a
framing prerequisite, not proof that those pixels are unobstructed.

For a later same-camera before/after job, pass the earlier completed portrait
`manifest.json` as `--portrait-reference`. Matching fixture/subject/role/faction
and capture-condition metadata is required. Close views replay the recorded
position/target/FOV/near/far exactly, with finite and local-to-subject validation.
If changed art no longer fits that fixed camera, metadata reports it; the runner
does not silently reframe and call it the same view. The gameplay view continues
to use production camera behavior and records that actual camera separately.
Both builds must contain this stage. Existing field images are not fabricated
into matching portrait "before" frames.

## Output and safety evidence

Each image has a SHA-256, JSON sidecar, runtime commit, built HTML hash, effective
quality, subject identity, root transform, requested pose/view, actual posed
body/head bounds, measured vertex count, and full camera/projection metadata.
The run manifest records source worktree, tooling hash, reference-manifest hash,
declared lease, backend/browser, viewport, staging labels and owned-process
cleanup. No existing manifest or baseline image is overwritten.

The runner compares actual gameplay telemetry and an ordinary production save
before/after every portrait and after clear. Only the save's export `updatedAt`
timestamp is excluded; injuries, player/actor positions, health, stamina,
cooldowns, melee/defense/action state, objectives, identities, and gameplay RNG
remain compared. Failure stops the job and retains its partial evidence.

CPU coverage validates the finite contract, 108 all-faction/view/pose combinations
with wounded/missing/prosthetic parts, repeatable held transforms and exact frame
replay, real production stage/companion routing, rejected active simulation,
dead/unsupported cases, restoration after a rejected camera, and a corrupted
rendered-head-vertex control. The portable job's default path is tested as inert.
The existing diagnostic/fixture tests remain applicable.

Actual screenshots, a rendered normal-shader decision, user face approval,
complete GL allocation attribution, and 25-actor performance remain separate
pending work. None is inferred from this tooling or its CPU checks.
