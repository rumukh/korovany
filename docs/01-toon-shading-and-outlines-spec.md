# 01 - Toon Shading and Selective Outlines

> Implementation-ready visual-direction spec for КОРОВАНЫ. The target is an original
> hand-inked comic-book treatment built from the game's existing low-poly geometry and
> procedural textures. It must not reproduce another game's characters, logos, UI, or
> authored assets.

## 1. Goal

Give characters and important interactables a bold, readable comic silhouette while
turning direct lighting into deliberate color bands. The treatment should:

1. make combatants readable against every zone and time of day;
2. reinforce the existing angular low-poly art instead of hiding it;
3. preserve bloom, emissive effects, transparent FX, shadows, and day/night lighting;
4. stay bounded at the existing maximum of 25 actors;
5. degrade cleanly when ink outlines are disabled.

The first milestone is intentionally selective. Characters, weapons, shields, important
event props, and future loot receive ink treatment. The entire world does not receive a
full-screen edge detector.

## 2. Scope and non-goals

### In scope

- Four-band toon lighting for opaque character surfaces.
- Black or palette-tinted silhouette shells on selected meshes.
- Distance culling and a persisted outline toggle.
- A reusable material/outline helper for future loot and landmark props.
- Compatibility with dynamic time, themes, bloom, gore, and procedural textures.

### Out of scope

- A frame-wide Sobel/depth/normal edge pass.
- Internal crease detection on every world mesh.
- Photorealistic PBR preservation for toon-converted character materials.
- Authored normal maps, baked light maps, or imported shader assets.
- Halftone and crosshatch world textures; those belong to
  `05-zone-art-direction-spec.md`.

## 3. Verified baseline

| System | Current behavior |
| --- | --- |
| Renderer | `WebGLRenderer` uses antialiasing, ACES filmic tone mapping, exposure `0.92`, sRGB output, PCF soft shadows, and a DPR cap of `1.75`. |
| Post-processing | `BloomPostProcessor` owns `RenderPass -> UnrealBloomPass -> OutputPass` and falls back to direct renderer output when bloom is disabled. |
| Characters | `createCharacter()` builds primitive meshes with three shared `MeshStandardMaterial`s per character and animates limb `Group` pivots procedurally. |
| World | Ground, roads, buildings, trees, rocks, caravans, and props predominantly use `MeshStandardMaterial`; many carry cached procedural `CanvasTexture`s. |
| Transparent FX | Faction rings, sprites, particles, decals, sky objects, and beacons use basic/sprite/points materials and depend on explicit transparency and render order. |
| Lighting | Hemisphere and directional light colors/intensities are updated by the day/night system. Emissive building windows and torches are adjusted separately. |
| Lifecycle | Scene traversal disposes mesh geometry/materials and `generatedTextures` disposes cached canvas textures. Several resources are already shared by multiple meshes. |

## 4. Design corrections

- **Do not replace every `MeshStandardMaterial` in the scene.** A global swap would flatten
  metal, emissive, transparent, and atmospheric surfaces and make the change difficult to
  tune. Convert character surfaces first and keep environment PBR until the zone-art pass.
- **Do not make bloom responsible for outlines.** Outlines are dark and should remain
  useful with bloom disabled. They must render in the ordinary scene path.
- **Do not add an `OutlinePass` only for this milestone.** It would force an
  `EffectComposer` even when bloom is off, add full-resolution depth work, and complicate
  pass ordering and resize/disposal. The current primitive, pivoted characters are a good
  fit for bounded inverted-hull shells.
- **Do not outline transparent or screen-facing objects.** Decals, particles, sprites,
  faction rings, sky objects, flames, and foliage transparency will halo or double-blend.
- **Do not assume a fixed black works in both themes and at night.** Ink is a semantic
  palette color, clamped dark enough to read but allowed a subtle zone tint.
- **Do not allocate outline geometry per frame.** Shells are created with their owning
  visual, share source geometry, and only toggle visibility.

## 5. Proposed architecture

### 5.1 Comic material library

Add `src/game/ComicMaterialLibrary.ts`:

```ts
export type ComicSurface = 'cloth' | 'skin' | 'metal' | 'dark'

export interface ComicMaterialOptions {
  color: THREE.ColorRepresentation
  surface: ComicSurface
  map?: THREE.Texture | null
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
}

export class ComicMaterialLibrary {
  createToonMaterial(options: ComicMaterialOptions): THREE.MeshToonMaterial
  getOutlineMaterial(kind: 'player' | 'enemy' | 'interactable'): THREE.MeshBasicMaterial
  applyOutline(root: THREE.Object3D, kind: OutlineKind): OutlineBinding
  dispose(): void
}
```

The library owns one four-texel `DataTexture` gradient ramp and shared outline materials.
The ramp uses `NearestFilter`, no mipmaps, and `NoColorSpace`; it represents lighting
intensity, not display color.

Recommended ramp:

```text
0.00 -> 0.28
0.33 -> 0.52
0.66 -> 0.78
1.00 -> 1.00
```

Use the same ramp for all character surfaces in milestone one. Surface identity comes
from base color, emissive, and rough visual shape, not a separate shader permutation.
Guard metal can use a slightly brighter base/emissive value, but should not attempt to
recreate `metalness`.

### 5.2 Selective outline shells

`applyOutline(root, kind)` traverses eligible opaque meshes and adds one shell beneath
each source mesh:

```ts
interface OutlineBinding {
  root: THREE.Object3D
  shells: THREE.Mesh[]
  kind: 'player' | 'enemy' | 'interactable'
}
```

Each shell:

- shares the source geometry;
- is parented to the source mesh so limb and weapon pivots require no synchronization;
- uses a shared `MeshBasicMaterial` with `BackSide`, `depthTest:true`,
  `depthWrite:false`, `toneMapped:false`;
- has local scale `1.045` for characters and `1.035` for interactables;
- casts and receives no shadows;
- has `frustumCulled` consistent with the source mesh;
- is marked `userData.comicOutline = true` so later traversal never outlines a shell.

Eligibility is explicit. Skip any mesh whose material is transparent, whose name is
`faction-ring`, or whose `userData.noComicOutline` is true. Skip sprites, points, lines,
LOD proxy foliage, particles, gore, decals, flames, sky, and health bars.

Back-side shells only provide external silhouettes. That is intentional: dense internal
edge lines on the current small character models would become noise.

### 5.3 Outline registry and culling

`GameEngine` owns:

```ts
private readonly outlineBindings: OutlineBinding[] = []
private inkOutlinesEnabled: boolean
```

Create bindings for:

- player: always visible when enabled;
- living and dead actor character groups: visible inside `OUTLINE_ACTOR_DISTANCE`;
- caravan cargo, event targets, vendor beacon, and future loot: visible inside
  `OUTLINE_INTERACTABLE_DISTANCE`.

Update visibility in the existing actor-indicator pass and a small interactable pass. Do
not traverse the scene every frame. A dead actor may remain outlined for
`OUTLINE_CORPSE_SECONDS`, then its shell hides while the corpse remains.

### 5.4 Character conversion

`createCharacter()` replaces its three opaque `MeshStandardMaterial`s with materials from
`ComicMaterialLibrary`:

| Current surface | Toon surface |
| --- | --- |
| Faction torso/arms | `cloth`, faction color |
| Skin/head | `skin`, current mixed warning/surface color |
| Legs/weapon/helmet/horns/shield | `dark` or `metal` |

Faction rings remain unchanged. Health bars remain sprites. Detached player limbs and
cosmetic actor limbs use the same material helper so they do not look disconnected from
their source, but gore droplets and chunks remain unoutlined.

### 5.5 Setting

Add `inkOutlinesEnabled` to `GameEngineSettings` and persist it as
`korovany-ink-outlines`.

- Default to `true`.
- On coarse-pointer devices, still default to `true`; distance culling is the primary
  performance protection.
- `setInkOutlinesEnabled(false)` hides all registered shells immediately.
- The toon ramp remains enabled when outlines are off. The setting is an ink/performance
  control, not a full material hot-swap.
- Expose the toggle in menu and pause settings with the label `Чернильные контуры`.

This setting is not part of `SavedGame`.

## 6. Day/night, bloom, and theme integration

- `MeshToonMaterial` continues to react to hemisphere and directional lights, so the
  existing day/night keyframes remain the single lighting authority.
- Night must retain at least two visible ramp bands on character faces. If testing shows
  crushed silhouettes, raise night hemisphere intensity or the character base colors;
  do not add per-character lights.
- Emissive windows, beacons, flames, sparks, blood, and UI sprites remain on their current
  materials and bloom behavior.
- Outline materials are `toneMapped:false` and use a dark palette-derived color below the
  bloom threshold.
- Changing the application theme reconstructs the engine today. The material library can
  read the resolved palette at construction; no live theme mutation path is required.

## 7. Resource and lifecycle rules

- The gradient `DataTexture` and shared outline materials have one owner:
  `ComicMaterialLibrary`. Mark shared outline materials as library-owned and exclude them
  from generic scene-material disposal; `ComicMaterialLibrary.dispose()` releases them
  and the gradient exactly once.
- Toon materials returned by `createToonMaterial()` are scene-owned. The library does not
  retain or dispose them; scene traversal releases those unique materials.
- Outline shells share geometry with source meshes. Update `destroy()` to collect unique
  geometries and materials in `Set`s before disposal so shared resources are disposed
  exactly once.
- Do not add outline shells to `generatedTextures`; that map remains for canvas textures.
- `setPaused()` does not hide outlines.
- Engine teardown clears the outline registry after scene/resource disposal.
- Adding or removing runtime event props must register/unregister their binding. Hidden
  bindings must not retain detached scene roots indefinitely.

## 8. File-level changes

| File | Changes |
| --- | --- |
| `src/game/ComicMaterialLibrary.ts` | Gradient texture, toon-material construction, shared outline materials, shell creation, and disposal. |
| `src/game/GameEngine.ts` | Instantiate the library, convert character materials, register/cull shells, add setting/setter, tag excluded objects, and deduplicate teardown disposal. |
| `src/App.tsx` | Persisted outline preference, state/ref, menu and pause toggle, and constructor setting. |
| `src/game/types.ts` | No gameplay/save change. Add shared view types only if the settings UI is later centralized. |
| `src/App.css` | Only setting-row styling if existing controls cannot be reused. |

`BloomPostProcessor.ts` requires no change for the recommended shell design.

## 9. Tuning constants and budgets

```text
TOON_RAMP_LEVELS=4
OUTLINE_CHARACTER_SCALE=1.045
OUTLINE_INTERACTABLE_SCALE=1.035
OUTLINE_ACTOR_DISTANCE=38
OUTLINE_INTERACTABLE_DISTANCE=46
OUTLINE_CORPSE_SECONDS=8
MAX_OUTLINED_ACTORS=25
```

Budget against the current maximum population:

- no more than one outline draw per eligible opaque source mesh;
- no new full-screen pass;
- one shared gradient texture;
- at most three shared outline materials;
- zero per-frame allocations from outline visibility updates.

If the actor stress scene regresses sustained frame time by more than 2 ms on the target
device, first lower outline distance. Do not silently remove the player outline or reduce
gameplay actor count.

## 10. Accessibility and readability

- Outlines improve shape recognition and remain enabled by default.
- Faction recognition must not rely on outline color; torso color, rings, silhouettes,
  and health-bar color remain.
- The toggle has visible text and `aria-pressed`.
- No animation is introduced by the toon ramp itself.
- Reduced-motion preference does not disable outlines or toon shading.
- At minimum, test dark theme/day, dark theme/night, and light theme/day for player,
  guard metal, forest actors, and fort actors.

## 11. Edge cases

- A missing limb hides its parent pivot; the nested shell hides with it.
- Detached cosmetic limbs must not inherit a second shell from cloned `userData`.
- Transparent materials in material arrays are excluded mesh-wide in milestone one;
  splitting mixed-material meshes is out of scope.
- Non-uniformly scaled meshes may show uneven shell width. Restrict interactable outlines
  to approximately uniform primitives or use a smaller scale.
- Camera-near shells can intersect the camera. The player shell should hide if the
  collision-resolved camera is closer than `2.4` units.
- Shells do not enter raycast/collision lists and must be ignored by camera-obstacle
  collection.

## 12. Acceptance criteria

- [ ] Character lighting resolves into four stable bands without breaking shadows,
      faction colors, day/night changes, or guard readability.
- [ ] Player, nearby actors, and selected interactables receive external ink silhouettes;
      particles, gore, decals, foliage, sky, sprites, and transparent FX do not.
- [ ] Limb animation, limb hiding, corpse poses, and weapon animation automatically move
      their outlines without a per-frame transform-copy pass.
- [ ] Disabling ink outlines hides every shell live and persists across reloads while toon
      shading remains active.
- [ ] Bloom enabled and disabled produce the same outline placement and no dark bloom halo.
- [ ] Outline distance/corpse culling works at 25 actors without scene traversal or object
      allocation each frame.
- [ ] Scene-owned toon materials, shared geometry, and library-owned gradient/outline
      resources are each disposed once; repeated game start/return-to-menu cycles do not
      grow WebGL resources.
- [ ] Existing version-1 saves load unchanged.
- [ ] Production build, oxlint, day/night visual checks, and a 25-actor stress capture pass.

## 13. Effort

**1.5-2 days.** Character conversion is small; robust shell eligibility, resource
ownership, distance culling, settings plumbing, and day/night/theme tuning make this more
than a material search-and-replace.
