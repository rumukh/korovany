# Next-generation graphics: a playable illustrated world

**Status: enhanced preview integrated; final acceptance in progress.** The
reproducible baseline, rendering foundation, character/world art, atmosphere,
effects, compact HUD and live subsystem diagnostics are joined. GFX-01 through
GFX-06 retain GPT-6 Astra, Max reasoning, and the 1M context tier. The user has
approved the stylized character direction after the three-faction portrait
gallery. Legacy remains the default; that art decision does not approve
performance tiers, physical mobile/integrated devices, or incomplete resource
accounting.

**Recommendation:** evolve the procedural comic into a richly lit, tactile
illustrated world. Fix visibility and surface response before increasing geometric
detail. Keep browser delivery, fully code-generated assets, faction readability,
and the existing campaign. A WebGPU rewrite is not the first milestone.

**Baseline:** `f36ee7ce06c9cf7b1c220d04b707be4fcf1cc7ff`, seed `20260906`.
The implemented art in specs [08](08-graphics-foundation-spec.md),
[09](09-npc-and-creature-models-spec.md), and
[10](10-world-objects-and-props-spec.md) is the starting point, not a list of
features still missing.

[Open the screenshot gallery](graphics-review.md) |
[Read the capture manifest](images/graphics-review/capture-manifest.json)

### Current implementation checkpoints

The unchanged natural-play gallery below remains the original evidence, not the
upgraded result. [GFX-01 results](graphics-baseline-results.md) document the
repeatable baseline. [The rendering contract](gfx-02-rendering.md) and
[subsystem allocations](graphics-subsystem-budgets.md) describe the implemented
foundation and provisional budgets consumed by the content workstreams.

The foundation at `bfae58b` completed the prescribed 14-job browser batch on
2026-09-09, including the three faction openings, original forest/riverside
camera scenarios, effects-off paths, motion fixtures, and bounded profiles.
That batch is technical evidence, not proof of final art quality or a passed
performance tier. The integration/allocation checkpoint is `3d2a77e`.
Final evidence assessment, live resize coverage, and combined release acceptance
remain separate from the recorded captures.

The recovered joined checkpoint `ec1d317` preserves the original workstream
histories and the newer main-branch movement/aim fixes. It includes idempotent
Chronicle save synchronization, flush visual road/paving receivers, and actual
same-frame subsystem submissions and allocation diagnostics. Current browser
commands use ordinary isolated profiles, timeouts and owned-process cleanup;
they require no graphics lease, GO, HOLD, or acquisition window. Historical
capture identifiers remain provenance, not execution prerequisites.

### Character direction after the first preview

The user's 2026-09-09 visual review found the guard uniform and helmets worth
preserving, but described the elf and villain heads as pumpkins and the NPC
models as insufficiently realistic. GFX-03 must address the anatomy, not merely
recolor or shrink the same shapes.

Keep the guard's recognizable uniform and helmet design. Give elves believable
faces visible inside separate hoods, with skin distinct from green clothing.
Give villains recognizable faces beneath fitted helmets and independently
constructed horns, rather than bulbous colored heads standing in for anatomy.
Skull, jaw, cheeks, brow, nose, eye sockets, ears, and neck must form a coherent
person at both portrait and gameplay distances.

The first character visual checkpoint covers all three factions from front,
three-quarter, profile, and ordinary gameplay views. Believable adult proportions,
hands, grips, and clothing layers are part of the target. This is anatomical
realism within the procedural browser pipeline, not authorization for imported
photoreal assets or a replacement engine.

**Subsequent decision:** the user explicitly selected **Approve this stylized
character direction** after viewing the actual `f61ce8d` gallery: three faction
openings and 33 player/NPC portrait and held-pose views. Front, three-quarter and
profile images used the production models, not concept art. This closes the
art-direction decision, not every animation, camera, performance or device gate.

## 1. What was actually played

Three fresh runs used the same seed and default Supplies boon in an isolated
Chrome 152 profile on Windows. Controls were native keyboard and mouse events
through CDP. Mouse capture was refused, so play used the game's supported
drag-to-look path. Engine references were read for navigation and evidence, not
used to rewrite player positions, health, actors, or objectives.

| Faction | Active game time | Observed play | Result at the last sample |
| --- | --- | --- | --- |
| Forest elves | 32.2 s | Caravan skirmish, archery and melee, evasion, camp arrival, forest travel, atlas destination selection, Hold/Follow/Regroup, bounty contract | Three regions discovered; camp and bounty completed; the alternative contract skipped by normal exclusivity; one personal kill |
| Palace guard | 43.1 s | Camp arrival, shield holding, settlement approach and interaction, riverside fighting against elves, Hold/Follow, melee and evasion | Four regions discovered; camp and settlement objective completed; one personal kill; riverside contract unfinished |
| Villain | 34.2 s | Uphill camp arrival, pursuit of a moving caravan, rush ability, close melee, damage and ration recovery, highland travel and Regroup | Two regions discovered; camp completed; one personal kill; reached the vicinity of an allied stronghold |

These are bounded opening/combat sessions, **not three completed campaigns**.
No finale was completed. The guard shield was held, but a successful perfect
guard was not established. The stronghold visited by the villain was not a
completed villain finale. Nothing here establishes faction balance or win rates.

All nine PNGs are original 1920x1080 browser captures at DPR 1. Dark UI, high
foliage, bloom, ink, weather, dynamic time of day, and camera effects were enabled.
Screenshots were taken during live play, before pausing between observations.
They retain HUD, notices, combat effects, and occlusion rather than hiding problems.
The manifest records hashes, camera/player coordinates, nearby actors, and timing.

There is no controlled FPS, GPU-time, or memory benchmark in this review. A seed
reproduces the world, not identical input timing or every weather particle.
These pictures are visual evidence, not pixel-exact regression fixtures.

## 2. Findings that set the priorities

| Priority | Observed problem | Evidence and current implementation | Upgrade consequence |
| --- | --- | --- | --- |
| P0 | The camera can stop showing a usable fight | [Guard close combat](images/graphics-review/guard-melee-impact.png). The camera was approximately 2.86 m above the player's ground position and only 1.85 m away horizontally, versus the ordinary 10 m horizontal offset. `resolveCameraPosition` uses one ray and a 2.2 m minimum boom distance. | Collision response must preserve character and opponent framing, not merely keep one camera point outside a wall. |
| P0 | Large foreground foliage interrupts nearby character silhouettes | [Elf contract approach](images/graphics-review/elf-forest-contract.png). A conifer covers companions at close range. `blocksCamera` explicitly excludes `InstancedMesh`; the separate foliage-occlusion path must not be assumed to cover streamed instanced vegetation. | Add a presentation-only visibility policy that works with generated instances and their ink shells. |
| P1 | Faces, cloth, armor, and background have weak value separation | [Elf opening](images/graphics-review/elf-opening.png), [villain opening](images/graphics-review/villain-opening.png). Existing geometry has faces and gear, but much of it reads as dark fill plus colored linework. Skin color is derived from UI warning/surface colors in `characterSkinMaterial`. | Give skin and physical surfaces deliberate art palettes; improve light response before adding more small meshes. |
| P1 | Colored contours compete with faction and combat signals | All three openings. `spawnActor` registers the `enemy` outline kind for actors, including allies; player ink is also tinted. This is not a claim that allegiance logic is wrong. | Separate neutral structural ink, selection, allegiance, and momentary threat highlighting. |
| P1 | Ground dominates the image with repetition rather than place | [Guard opening](images/graphics-review/guard-opening.png), [villain highlands](images/graphics-review/villain-highland-squad.png). Terrain uses repeating 64x64 procedural maps with nearest magnification; the palace biome applies paving across its terrain. | Introduce macro variation, authored material scale, and local paving/road/soil transitions. Do not just enlarge the existing pattern. |
| P1 | Important world objects are not participating in the same shadow budget as actors | Code inspection: the live `GeneratedWorldRuntime` construction omits `castShadows`, and `normalizeStyle` enables it only for explicit `true`. Terrain receives shadows; generated prop shadow flags depend on that option. | Route selected nearby buildings, trees, and large props into a bounded shadow policy. Do not enable every streamed object indiscriminately. |
| P1 | The composed image needs deliberate edge treatment | `WebGLRenderer({ antialias: true })` exists, but `BloomPostProcessor` creates a default `EffectComposer` without a multisampled target or an AA pass. In three 0.185, the default composer targets are not multisampled. | Treat scene resolve and final-image AA as part of the post pipeline; canvas antialiasing alone is not that solution. |
| P2 | Combat effects and persistent panels compete for the same small subjects | [Elf melee](images/graphics-review/elf-caravan-fight.png), [villain taking damage](images/graphics-review/villain-caravan-combat.png). Numbers, splashes, notices, ink, and bodies overlap. | Establish an effects hierarchy and offer a compact combat HUD without removing important information. |

The screenshots do not prove animation sliding, broken rig mathematics, bad
collision topology, or a memory leak. Those require their own measurements.
The animation and performance work below is a proposed quality target, not a
claim that those defects were demonstrated.

## 3. Visual target

The intended result is not photorealism. It is a coherent illustration with the
spatial depth, material response, motion quality, and image stability expected
from a modern game. Bold silhouettes remain; red wire-like detail everywhere does
not. Preserve the existing green/blue/pink faction semantics and Russian voice.

| Faction | Character direction | World and light direction |
| --- | --- | --- |
| Elves | Lean, layered woodland kit; readable hood openings, bow/quiver separation, leaf-shaped shields, warm skin against muted green cloth | Mixed canopy heights, shafts of open sky, bark and leaf-litter scale, damp soil, soft green bounce without turning every material green |
| Guard | Broad steel-and-cloth construction; visible visor/face distinction, blue tabards, restrained brass trim, unmistakable shield profiles | Paved courtyards rather than an infinite tile carpet, stone foundations, worn road edges, cool stone balanced by warm occupied windows |
| Villain | Asymmetric heavy kit, distinctive horns and silhouettes, rough leather, bone and dark iron; pink is an accent, not the entire material model | Layered scree and rock strata, weathered fortifications, cold distance, warm localized fire, legible characters against dark slopes |

Roles must still read independently of color: archer, line fighter, brute, officer,
civilian, and player. Upgrade the existing role taxonomy and deterministic
variation rather than substituting three elaborately modeled heroes and leaving
every NPC behind.

## 4. Delivery sequence

### GFX-01: establish a reproducible visual and performance baseline

Turn this field evidence into a small set of repeatable presentation fixtures:
three faction openings, the forest obstruction, the riverside camera collision,
the highland slope, a bridge/water edge, and a crowded 25-actor encounter.
Include neutral terrain, night, rain, and snow; the current field captures do
not constitute complete coverage of those conditions.

Fixtures should load real saves/worlds and invoke the production rendering
builders. Record camera, viewport, visual time, weather, quality settings, and
visual seed. Label any staged setup explicitly. Do not call it a natural run or
change production combat to make a picture easier to take.

Measure production builds after warm-up. Account for the complete frame:
CPU update/render submission, frame-time distribution, GPU time where supported,
draw calls across shadows/ink/post, triangles, render-target allocations, and
streaming spikes. `renderer.info.render.calls` sampled after this game's composer
reported the last one-triangle pass, not the cost of the world; that reading is
not an acceptable scene benchmark.

**Gate:** reproducible captures and whole-frame accounting exist on named desktop
and mobile/integrated devices. Unsupported GPU timing is reported as unavailable,
not replaced with an invented number. Finalize the provisional budgets in section 6.

### GFX-02: make the existing art visible and the image stable

Start here, before a character rebuild.

- Replace single-ray camera collision with a bounded swept-volume or multi-probe
  solve using the existing collision/camera data. Add entry/exit hysteresis and
  terrain clearance. When a wall shortens the boom, use a tested alternate
  shoulder/height and near-player fade instead of filling the screen with armor.
  Never move the player or an enemy to make the camera fit.
- Handle foreground instanced trees through per-instance visibility/fade data or
  a small registered occluder set. Fade source and ink together, preserve depth
  behavior, and prevent one shared-material edit from fading the entire forest.
  A distant hidden enemy must not become an always-visible wallhack silhouette.
- Introduce neutral structural ink with selective colored feedback. Keep the
  existing outline-off option and the world draw caps. Choose thickness from
  projected size and output resolution, not merely a new larger extrusion value.
- Audit linear/sRGB treatment, toon bands, ambient tint, rim strength, and grade
  together. Preserve saturated faction cloth without crushing its seams or
  illuminating every dark surface with emissive fill. Keep one material family.
- Enable nearby hero shadow casters through a costed policy: characters first,
  then relevant buildings, canopy, and large rocks. Stabilize the directional
  shadow projection; retain one shadow-casting key light initially.
- Give the bloom path a deliberate AA solution. Prototype a resolved, supported
  multisampled scene target or a measured final-image AA pass. Do not multisample
  every bloom ping-pong buffer. Keep ink sharp and retain a real no-post path.

**Primary surfaces:** `GameEngine.updateCamera`, `resolveCameraPosition`,
`blocksCamera`, outline registration, `GeneratedWorldRuntime`,
`StylizedArtLibrary`, `stylizedShader`, and `BloomPostProcessor`.

**Gate:** repeat the forest and riverside approaches without losing the player's
torso or the nearby opponent behind an avoidable foreground obstruction. Faces,
weapons, and faction silhouettes remain readable with bloom off. Obtain visual
approval of all three factions before changing their model vocabulary.

### GFX-03: premium procedural characters, creatures, and animation

Improve the existing `CharacterKit` rather than restarting from primitives.
Prioritize proportion, face planes, helmet openings, shoulder/hip transitions,
hands gripping weapons, and cloth thickness. Add detail where it changes a
silhouette or light response, not a ring of extra meshes around every joint.

Create dedicated, bounded skin, hair, cloth, leather, bone, and metal palettes.
Keep shared immutable materials and explicit cache keys. Optional generated
normal/roughness detail must have a consistent geometry attribute contract;
do not assign a map or vertex-colored material to builders missing its inputs.

Prototype a procedural skinned/rigid-weighted character batch for one complete
role first. Merge compatible body and gear surfaces to pay for richer geometry.
Do not replace cheap rigid pieces with a different draw per material group and
claim the character was batched. Preserve named attachment transforms and the
existing weapon, shield, torch, trail, injury, and prosthetic behavior.

Define hero/near/mid/far LODs by projected importance, with hysteresis and stable
silhouettes. Existing face/hair/trim detail already drops beyond 26 m; this is an
upgrade to that system, not the first use of LOD. Keep the player legible even
when the collision camera becomes close.

Drive richer anticipation, recoil, follow-through, aim, and secondary cloth from
the actual action states. Add bounded terrain-aware foot placement and pelvis
adjustment as presentation only. Animation cannot move collider roots, widen
damage windows, cancel finishers, restore injured limbs, or conceal attack tells.
Exercise moving, attacking, injured, shielded, and dying poses, not just a lineup.

Carry the same standards to beasts, ambient fauna, and the caravan: load-bearing
anatomy, feet/hooves on slopes, harness tension, wheel/axle alignment, and cargo
weight. A detailed wagon beside placeholder animals is not a finished asset.

**Primary surfaces:** `CharacterKit`, `GeometryKit`, `GeometryCache`,
`GameEngine.createCharacter`, the character/creature animation methods, and
saved-body appearance. A typed render-rig adapter may be extracted; no ECS rewrite.

**Gate:** player and NPC quality improve together for all three factions, role
silhouettes survive grayscale/distance review, attachments stay connected through
the full pose envelope, and the 25-actor frame stays inside its tier budget.

### GFX-04: build tactile places, not higher-resolution wallpaper

Replace single-pattern ground coverage with a hierarchy: broad soil/rock color
variation, medium-scale material breakup, and restrained close detail. Reuse the
existing procedural texture generator, vertex colors, noise helpers, and caches.
Start with explicitly budgeted maps up to the already-supported 256-pixel size.
Changing 64 to 256 alone does not solve pattern repetition.

Place paving around actual palace roads, settlements, and courtyards. Blend it
into soil, worn edges, grass, or exposed substrate outside those spaces. Use
world-space mapping for continuous terrain and selected steep rocks, with stable
material scale across region seams. More detailed render tessellation must sample
the existing terrain surface and must not silently invent new traversable heights.

Upgrade tree crowns into layered branch-and-leaf masses with species-specific
silhouettes, controlled gaps, and coherent wind. Favor instanced clusters,
distance-aware density, and ground cover grouped around believable growing areas.
Do not spend the actor budget on decorative life or make low foliage alter cover,
collision, NPC visibility rules, or navigation.

Give buildings thickness, foundation contact, roof/eave depth, material boundaries,
and site-specific wear. Existing doors, windows, fences, dressing, and settlements
already exist. Refine their construction and composition rather than proposing
them as new. Keep readable approaches, gates, roads, and bridge decks.

Water needs depth and shoreline cues, flow direction, restrained reflection from
the procedural sky, and contact at bridge supports. Preserve the exact river,
bridge, and collision geometry. Do not add real-time planar reflections or SSR
to every water strip as the default path.

**Primary surfaces:** `ProceduralSurfaceTexture`, `PropKit`, `WorldPropLibrary`,
`SiteComposition`, `GeneratedWorldRuntime`, and the terrain render-geometry path.

**Gate:** each biome and major site reads at gameplay distance without the HUD;
ground does not visibly restart its pattern at a region seam; all existing road
and bridge paths remain physically consistent with what is drawn.

### GFX-05: atmosphere and effects with a clear hierarchy

Use depth/height-aware atmosphere and deliberate near/mid/far contrast rather
than uniformly thickening fog. Match rain, snow, wetness, and wind to the existing
environment state. Surface wetness should change roughness and local value, not
turn every object into a mirror. Preserve a readable night play space.

Improve impacts with direction, contact location, short-lived light, and
material-specific response. Keep weapon tells and targets more important than
damage numbers, blood/sparks, or screen tint. Pool particles, decals, and lights;
do not create a light per actor or an unbounded layer of transparent sprites.

Prototype half-resolution ambient/contact occlusion only after GFX-02 through
GFX-04 are approved and budgeted. Mask it correctly around transparent foliage,
ink, particles, and the sky. This is an optional High-tier experiment, not a
mandatory dependency or a promise of global illumination. It explicitly extends
the older foundation spec's post-processing scope if approved.

Keep the current HUD language. Offer an optional compact combat presentation for
contracts/notices; health, stamina, defense timing, squad state, navigation, and
interactions remain available. Do not change the meaning of green, blue, pink,
gold, or danger red to match a decorative grade.

**Gate:** a fight remains readable at 390x844 and 1920x1080, in grayscale review,
with reduced motion, and with bloom/ink/weather independently disabled. Reduced
motion removes decorative shake and excessive motion, not combat information.

### GFX-06: integrate, profile, and promote the upgrade

Keep new rendering behind an explicit development/preview setting until the
previous gates pass. Preserve the existing presentation as the comparison and
fallback during development. Promote a balanced default only after evidence
from real supported devices, not because a high-end desktop can display it.

Introduce one typed visual-quality policy rather than scattered device checks.
It owns render scale, post effects, shadow participation, visual LOD, and cosmetic
density. Persist visual preferences separately from campaign saves. Existing
bloom-off users must retain their no-post behavior unless they explicitly opt
into enhanced effects.

Extend `BloomPostProcessor` or migrate its ownership once into a render-pipeline
module; do not leave two composers, two output passes, or conflicting resize paths.
Report an unsupported or failed effect through the existing warning conventions.
Dispose partial allocations before falling back to the documented lower path.

**Gate:** the full acceptance matrix in section 7 passes, resources settle after
repeated streaming and menu/run cycles, and the single-file offline bundle still
plays without external resource requests.

## 5. Shared implementation contract

| Boundary | Contract |
| --- | --- |
| Simulation | Preserve world seed/fingerprint, terrain queries, routes, actor cap, allegiance, action timing, damage, injuries, objectives, and save/continue semantics. Decorative changes are not permission to alter any of them. |
| Visual randomness | Reuse `art:` seed derivations. Never consume combat, loot, director, or world-generation streams for detail. Record a separate visual revision for comparisons; do not invalidate a campaign solely because its mesh changed. |
| Resource ownership | Material/geometry libraries own their shared resources; region and actor owners release references. Audit outlines, skinning data, instance buffers, procedural maps, and post targets together. No per-frame allocation of reusable render data. |
| Engine integration | Keep `GameEngine` as the gameplay owner. Add small typed presentation helpers at existing call sites, not an unrelated engine migration. Character and world work share the approved material/attribute/LOD contract. |
| Art production | Everything shipped for play remains generated in code. No downloaded textures, character packs, GLTF/FBX models, remote generation service, or runtime account is required. Review screenshots under `docs` are evidence, not game assets. |
| Interface | Preserve Russian copy and existing controls/overlay behavior. New quality controls use the current settings, copy, and accessibility patterns; they must not resume a paused fight. |

Character and world content work can proceed independently after the common
material, camera, and resource contracts are settled. Integrate those branches
before atmosphere tuning: four attractive isolated demos are not one coherent
game frame.

## 6. Provisional performance envelope

These are **proposed engineering targets, not measurements from this review**.
GFX-01 must name representative devices and either demonstrate these budgets or
revise the quality scope openly before implementation commits to them.

| Budget | High desktop | Balanced desktop/integrated | Low/mobile |
| --- | --- | --- | --- |
| Frame-time target, p95 after warm-up | At most 16.7 ms | At most 16.7 ms | At most 33.3 ms |
| Internal 3D pixel ceiling | About 2.1 MP | About 1.4 MP | About 0.9 MP |
| Whole-frame draw-call ceiling, including ink/shadow/post | 700 | 450 | 300 |
| Main-view triangle ceiling | 600k | 300k | 150k |
| Tracked allocated GPU-resource budget, including render targets | 256 MiB | 192 MiB | 128 MiB |
| Shadow policy | One 2048 key map, prioritized nearby world casters | One 1024-2048 key map, smaller caster set | Minimal key shadow or contact-only fallback |
| Post policy | Resolved AA, restrained bloom/grade; AO only if approved | Measured AA and optional bloom/grade | Genuine direct/no-post path |

All tiers retain `MAX_ACTORS = 25`, the three companions, and identical gameplay.
The current world-ink caps are eight draws per region and 48 visible draws total;
preserve them unless a measured, explicit replacement budget is approved.

Render scale affects the 3D buffer, not DOM/HUD text. Apply hysteresis to dynamic
resolution and LOD changes so short combat spikes do not cause constant pumping.
Count MSAA samples, resolves, depth, mipmaps, bloom buffers, and geometry in memory
accounting; `renderer.info.memory.textures` is a count, not a VRAM measurement.
Do not trade one obvious visual problem for temporal shimmer or ghosted attacks.

## 7. Acceptance before release

| Area | Required evidence |
| --- | --- |
| Faction coverage | Natural opening, movement, defense/ability, melee, and interaction for each faction; player plus friendly and hostile NPCs in the new screenshots. Full-campaign claims require actual campaign completion. |
| Camera | Revisit the exact forest obstruction and riverside collision; orbit, strafe, back against walls, cross slopes, fight near crowds, and exercise drag-to-look as well as native capture. Observe temporal transitions, not only resting images. |
| Character quality | Near/mid/far, front/back/side, bright/shadowed, grayscale, all faction/role combinations; moving and injured poses, prosthetics, shield, death, and every attachment. |
| World quality | All four biomes, settlements/forts, caravan/animals, road edges, steep slopes, a real river crossing, night, rain, snow, and streamed LOD boundaries. |
| Gameplay safety | Quality and effect toggles do not change collision, AI targets, actor counts, RNG state, paid cooldowns, damage windows, objective state, or save/continue results. |
| Accessibility and UI | Desktop and 390x844 touch layout; readable text, reachable 44 CSS-pixel controls where applicable, reduced motion, keyboard UI, overlay/focus cancellation, and independent effect toggles. |
| Lifecycle and performance | Sustained crowded combat and traversal on named devices, warm/cold runs, region load/unload loops, resize/DPR changes, repeated run/menu cycles, supported context recovery, and bounded resource ownership. |
| Delivery | Existing build and offline bundle; no new network or asset dependency. A raw capture, measured frame data, and a written visual decision accompany each tier's approval. |

Extend the existing Node tests for art, character geometry/poses, world art,
outlines, bloom, camera behavior, environment, streaming, and persistence.
Exercise the actual functions invoked by the engine. Pixel checks alone cannot
prove rig attachment, ownership, or gameplay invariants; source-string assertions
alone cannot prove a rendered improvement. No new testing framework is required.

Keep raw before/after screenshots and inspect short motion sequences for the same
scenes. Human visual approval is required before declaring the art direction or a
quality tier finished. This document is a plan for that work, not that approval.

## 8. Deliberate exclusions

No photorealistic asset pipeline, ray-traced GI, mandatory temporal reconstruction,
unbounded volumetrics, destructible navigation, increased enemy population, or
simulation rewrite belongs to this milestone. Photo mode and promotional concept
art are separate conveniences, not substitutes for improving the live camera.

WebGPU remains a later research option. The current look relies on WebGL GLSL
`onBeforeCompile` hooks over `MeshStandardMaterial`; swapping renderer constructors
would not port those materials. Any future backend proposal needs an explicit
material migration, browser coverage, performance evidence, and maintained
WebGL/offline fallback.
