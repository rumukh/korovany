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
- **Do not let a quadruped inherit a biped's spine.** The beasts share the rig names on
  purpose, but `createBeast` builds its own limb geometry per role and the shared
  stride is remapped, rather than a wolf borrowing a soldier's arm. The secondary
  pass is split the same way: `animateBeastPosture` replaces the biped shoulder
  bend, hip counter-rotation and head yaw, all of which pull an animal apart at the
  joints when applied to a body whose skull sits a metre forward of its own pivot.
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
│   │   └── **shield**  (mesh, absolute local coords owned by updateShieldPose)
│   ├── **head-pivot**
│   │   ├── **head**             merged: neck, skull, brow, nose, jaw, ears
│   │   ├── face                 eyes and mouth, dark material              [detail]
│   │   ├── hair                                                            [detail]
│   │   └── headgear
│   └── **pelvis-pivot**
│       ├── **leftLeg**  (pivot) → thigh mesh
│       │      └── leftKnee (pivot) → shin mesh (boot merged in)
│       └── **rightLeg** (pivot) → thigh mesh
│              └── rightKnee (pivot) → shin mesh
├── **faction-ring**
└── contact-shadow
```

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
- Sustained frame time at 25 actors within 1 ms of the pre-change build, measured the
  same way spec 08 measured it.
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

## 15. Effort

**2–3 days.** The geometry is the fun part and the fast part. The time goes into the
plan taxonomy staying small enough to cache, into every rig-name consumer being
re-verified by hand rather than by hope, into the animation staying allocation-free,
and into the visual pass that catches the things a unit test cannot.
