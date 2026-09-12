# Immutable affine-rig CPU fixture

`affine-rigs-fc1af54.json.gz` is lossless JSON from the actual consumer checkpoint
`fc1af5436c7db73cd090f8a61823430f4a45408c`. The capture ran CPU-only in the GFX-02
worktree: modules were read with `git cat-file` by immutable blob ID, transpiled
in memory with the repository's installed TypeScript, and used the installed
three.js. No consumer/worktree source was copied over or edited and no renderer,
browser, GPU model, or external asset was invoked.

Uncompressed compact-JSON SHA-256:
`c339ecf8555587c172cda4c9dfbd460087c8cc522271e280ed208abdefd02e60`.
Gzip SHA-256:
`189c17bfc1c78485dc71830894cfaff4367a8b5f9bcc349da2c9db8a0bd3b146`.

The file records module paths/blob IDs/source hashes, pose descriptions and:

- Six character body and six independent equipment poses from the real
  `createCharacterPresenter`, `syncAttachments` and `poseSupport` paths.
  Factions elf/guard/villain use the existing contact/support-hand test scales:
  body `(1.05, 0.95, 0.97)`, torso `(1.07, 1.01, 1)`, arm-Y `0.97`, multi-axis
  rotations and a translated/rotated root. Full hand matrices remain intact.
- Eight beast poses from real `GameEngine.createBeast` and `poseFeet`, with
  `body-pivot` scale `(1.05, 0.945, 0.97)`, torso/pelvis rotations and signed
  terrain slopes from `creatureArt.test.ts`.
- Four ox sources from real plain/gilded `createCaravan` and
  `WagonPresenter.update`, after four 0.05-second/0.15-metre visual steps on a
  `(0.08, -0.06)` slope. These particular maps are rigid controls after their
  bind transforms cancel; they must not be counted as failing old-normal cases.

Each vertex record contains its real source vertex/bone name/weights, weighted
bone matrix, both bind matrices, source model matrix, rest shading/outline
normal, position and actual `SkinnedMesh.getVertexPosition` result. There are
266 such records. The 188 triangle records preserve actual original triangle
positions and actual skinned positions with equal weights on all three corners.
Selection retains representative per-bone errors, not a population-performance
sample. No claim is made about unequal-weight geometric normal derivatives.

`affineSkinNormals.test.ts` evaluates the *emitted scalar GLSL body* using a small
test-only JavaScript syntax adapter. The geometric oracles use deformed triangle
cross products and tangent orthogonality, not a copied normal algorithm.
Additional weighted tests use two actual captured bone maps and three fixed
weight blends through three's real `getVertexPosition`; negative controls prove
that averaging inverse-transposes, skipping bind matrices or applying model
normals twice is distinguishable.

The CPU adapter uses JavaScript arithmetic, not a GLSL compiler or an exact
float32/driver simulation. Test pass is not GPU compilation, motion/art approval
or a claim about singular geometry having a well-defined physical normal.

The original reproducible capture helper is retained as a session artifact:
`C:\Users\predi\.copilot\session-state\071ce686-b3bf-4406-b482-0cad5b87136b\files\capture-affine-rig-fixtures.cjs`.
Its output also retains all loaded module hashes so a future capture can be
checked against the exact production source rather than an assumed current rig.
