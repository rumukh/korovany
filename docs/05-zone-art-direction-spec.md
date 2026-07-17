# 05 - Distinct Comic Art Direction by Zone

> Implementation-ready environment-art spec for КОРОВАНЫ. It strengthens the four
> existing procedural zones through palette, hatch language, silhouettes, props, and UI
> accents without duplicating day/night, weather, or foliage-wind ownership.

## 1. Goal

Make a screenshot identifiable as neutral lands, palace, forest, or fort before the
player reads the zone title. Each zone receives a coherent visual grammar:

- two dominant hues plus one accent;
- a characteristic procedural ink/hatch pattern;
- a small vocabulary of silhouette props;
- a distinct landmark composition;
- restrained atmosphere and UI accenting.

The zones remain one connected world. Transitions should blend rather than look like four
unrelated levels pasted into quadrants.

## 2. Scope and non-goals

### In scope

- Central zone-art profiles.
- Extended procedural surface-texture options for hatch/ink marks.
- Zone-specific static silhouette props built from existing primitives.
- Instancing for repeated decorative props.
- Subtle player-position-based fog/horizon tint blending.
- Zone title-card and HUD accent variables.
- Landmark/readability audit of existing village, palace, forest, and fort.

### Out of scope

- Weather states, precipitation, wetness, lightning, or wind.
- Grass/flower placement, foliage bending, or camera foliage transparency.
- New terrain height fields, slopes, caves, interiors, or streaming.
- Replacing the day/night lighting timeline.
- Imported textures/models or reproducing another game's environment assets.
- Combat balance, spawn locations, road topology, or navigation redesign.

`weather-system-spec.md` owns climate and precipitation.
`ground-foliage-wind-spec.md` owns ground vegetation and wind motion. This spec may expose
zone profile values they can consume later, but does not implement their systems.

## 3. Verified baseline

| System | Current behavior |
| --- | --- |
| Layout | `zoneAt(x,z)` divides the flat world into four quadrants: neutral, palace, forest, and fort. |
| Ground | Four 80x80 ground planes already use zone colors and cached procedural grass/stone/scree textures. |
| Roads | One horizontal and one vertical dirt road visually connect all quadrants. |
| Neutral | Four houses, a shop, sign, well, and village props establish habitation. |
| Palace | Walled enclosure, four towers, roofs, banner, lit windows, torches, and beacon create the strongest current landmark. |
| Forest | 74 deterministic tree LODs, three huts, and a beacon identify the zone. |
| Fort | Deterministic rocks and a large fort create a dark, angular region. |
| Textures | `createSurfaceTexture()` produces 64x64 grass/dirt/stone/scree/wood/roof canvases with deterministic seeded marks. |
| Atmosphere | Scene background/fog, hemisphere/sun, windows, torches, sky, stars, and clouds are controlled by day/night and atmosphere updates. |
| UI | `GameView.zone` and `ZONE_INFO` already drive zone name/subtitle in the HUD. |

## 4. Design corrections

- **Do not solve zone identity by saturating ground colors.** Lighting, theme, and blood
  decals can overwhelm color. Silhouette, mark direction, prop rhythm, and landmark shape
  must also differ.
- **Do not add four independent fog systems.** The scene has one camera and one global
  fog. Blend a restrained tint from player position into the existing day/night result.
- **Do not add decorative collision accidentally.** Most new props are non-colliding.
  Large navigational silhouettes must register with existing obstacle helpers.
- **Do not add hundreds of individual meshes.** Repeated props use `InstancedMesh` grouped
  by geometry/material/profile.
- **Do not duplicate tree/grass work.** Forest identity additions are roots, arches,
  lantern pods, and composition; tree LOD count and future wind remain with foliage work.
- **Do not overwrite procedural material maps in the toon spec.** Zone hatching is folded
  into cached surface textures, while spec 01 owns character lighting and selective
  outlines.
- **Do not change gameplay `zoneAt()` to make visual transitions smooth.** Add a separate
  visual blend function; objectives/perks keep hard zone identity.

## 5. Zone art profiles

Create a profile factory in `GameEngine.ts` or `zoneArt.ts` after the runtime palette is
known:

```ts
type HatchMotif = 'scrape' | 'chevron' | 'organic' | 'slash'

interface ZoneArtProfile {
  id: ZoneId
  primary: THREE.Color
  secondary: THREE.Color
  accent: THREE.Color
  ink: THREE.Color
  hatch: {
    motif: HatchMotif
    density: number
    angle: number
    opacity: number
  }
  fogTint: THREE.Color
  fogWeight: number
  uiAccent: string
}
```

Build colors by mixing semantic palette colors so dark/light themes remain coherent.
`uiAccent` is a CSS-safe color string exported separately or mapped by zone in React; do
not pass `THREE.Color` through `GameView`.

### 5.1 Profile language

| Zone | Palette | Hatch motif | Silhouette vocabulary | Composition |
| --- | --- | --- | --- | --- |
| Neutral lands | Dusty ochre, muted teal, cream | Broad horizontal scrapes | leaning signs, carts, fences, cloth pennants, stacked crates | low, open, irregular village skyline |
| Palace | Ivory stone, navy, restrained gold | orderly chevrons/vertical ticks | standards, shield plaques, clipped pillars, braziers | tall, symmetric, axial view to gate |
| Forest | Deep teal, acid green, warm amber | curved organic strokes | root arches, hanging pods, carved stumps, crescent lanterns | layered, asymmetrical, framed paths |
| Fort | Charcoal, rust red, bruised magenta | sharp diagonal slashes | spikes, broken wheels, chains, skull-like rock notches | heavy, top-loaded, hostile diagonals |

These are original shape/palette rules. Do not reproduce proprietary iconography, fonts,
weapon designs, or exact environment layouts.

## 6. Procedural surface marks

Replace the positional tail of `createSurfaceTexture()` with an options object:

```ts
interface SurfaceTextureOptions {
  pattern: 'grass' | 'dirt' | 'stone' | 'scree' | 'wood' | 'roof'
  repeatX: number
  repeatY: number
  hatch?: {
    motif: HatchMotif
    density: number
    angle: number
    opacity: number
    color: THREE.Color
  }
}
```

Retain existing base pattern generation, then draw deterministic ink marks:

- `scrape`: broken near-horizontal strokes with variable gaps;
- `chevron`: sparse repeated V/vertical marks aligned to architecture;
- `organic`: short bezier-like arcs and paired curves;
- `slash`: clustered diagonal cuts with two lengths.

Rules:

- draw hatching into the same 64x64 canvas; no second material or draw call;
- keep alpha low enough that day/night lighting remains visible;
- derive seed from texture key exactly as current procedural details do;
- keep `CanvasTexture` repeat/wrap/filter ownership unchanged;
- use detail size large enough to survive ground texture repeat;
- never draw high-frequency one-pixel grids that shimmer at camera distance.

Ground, major walls/roofs, and signature props receive profile hatching. Skin, UI, gore,
waterless sky, particles, and transparent effects do not.

## 7. Zone silhouette props

### 7.1 Instanced decorative sets

Create one `InstancedMesh` per repeated geometry/material combination:

```ts
interface ZoneDecorationSet {
  mesh: THREE.InstancedMesh
  zone: ZoneId
  collidable: false
}
```

Recommended maximums:

| Zone | Decorative instances |
| --- | ---: |
| Neutral | 26 |
| Palace | 20 |
| Forest | 22 |
| Fort | 26 |

Examples:

- neutral: fence posts/rails around existing houses, road pennants, two cart silhouettes;
- palace: paired standards along gate approach, shield plaques, roof-line finials;
- forest: root arcs beside rather than across paths, lantern pods near huts, carved stump
  clusters;
- fort: outward spikes, chain-link approximations using sparse torus instances, broken
  wheel stakes.

Decorations must avoid roads, spawn circles, beacons, event markers, palace gate passage,
shop interaction radius, and common combat lanes. Use deterministic seeds and explicit
exclusion circles.

### 7.2 Landmark additions

Add at most one medium landmark per zone:

- neutral: crooked caravan crane/notice tower near the road junction;
- palace: tall split standard behind the gate, preserving tower dominance;
- forest: broad root arch framing the home beacon without blocking camera/navigation;
- fort: broken circular war-wheel behind the fort.

Landmarks are composed from a handful of primitive meshes, share profile materials, and
register collision only if their base is large enough to imply solidity.

## 8. Visual zone blending

Gameplay continues to use `zoneAt()`. Add:

```ts
interface ZoneVisualWeights {
  neutral: number
  palace: number
  forest: number
  fort: number
}

function writeZoneVisualWeights(
  x: number,
  z: number,
  out: ZoneVisualWeights,
  blendWidth = 8,
): void
```

`GameEngine` owns one reusable `ZoneVisualWeights` object. The function overwrites all
four fields and allocates nothing.

Inside a zone, its weight is 1. Within `blendWidth` of X/Z borders, smoothly blend
adjacent profile fog/horizon influence. At the central crossing, weights normalize across
all relevant quadrants.

In `updateAtmosphere()`:

1. compute the existing day/night background and fog colors;
2. mix in weighted zone `fogTint` by at most each profile's `fogWeight`;
3. damp the displayed result over `ZONE_TINT_DAMPING`;
4. never mutate the day/night keyframes themselves.

Recommended fog weights are `0.04..0.10`. Zone tint is supporting glue, not a full-screen
filter. Weather can later apply after day/night and before/with this restrained local
tint using an explicitly documented order.

## 9. UI zone identity

Expand `ZONE_INFO` with UI-safe motif metadata:

```ts
interface ZoneInfo {
  name: string
  subtitle: string
  accent: string
  motif: 'scrape' | 'chevron' | 'organic' | 'slash'
}
```

On `view.zone` change:

- key the existing zone-title panel by zone so its short entrance treatment restarts;
- set `--zone-accent` and `data-zone` on the game screen;
- render a small CSS motif rule beside name/subtitle;
- tint map/current-zone border and prompt accents only;
- do not recolor health, danger, success, rarity, or faction semantics.

Reduced motion uses a static fade/no translation. Zone title remains informative without
the decorative motif.

## 10. Day/night, weather, foliage, and outline ownership

Composition order:

```text
base semantic palette
-> day/night lighting and sky
-> future weather modulation
-> restrained local zone tint
-> material tone mapping/post-processing
```

- This spec does not create rain, snow, ash, fog banks, wind, grass, or leaf animation.
- Zone profiles may later expose suggested weather/foliage densities, but those systems
  own actual spawning and budgets.
- Spec 01 may outline the four medium landmarks only if they become interactable; static
  decoration remains unoutlined.
- Bloom is optional. Zone identity must survive direct rendering.

## 11. Resource and lifecycle rules

- Profiles are constructed once per engine instance.
- Hatch textures live in the existing `generatedTextures` cache and dispose there.
- Instanced decoration geometry/materials are shared and scene-owned; teardown disposal
  must deduplicate shared resources as required by spec 01.
- No zone decoration is created or removed on zone entry; all four sets build with world
  generation.
- Zone tint updates colors in place and allocates no `Color` per frame.
- Theme changes currently recreate the engine, so profiles require no live rebuild path.

## 12. File-level changes

| File | Changes |
| --- | --- |
| `src/game/GameEngine.ts` | Profile factory, surface-texture options/hatching, visual weights, atmosphere tint blend, instanced decoration sets, landmark additions, and exclusion placement. |
| `src/game/types.ts` | Expand `ZONE_INFO` metadata type; no save change. |
| `src/App.tsx` | Zone `data-*`/CSS variable, keyed title treatment, and motif element. |
| `src/App.css` | Four zone accent/motif treatments and reduced-motion transition fallback. |

Extract `src/game/zoneArt.ts` only if pure profile/placement helpers can be tested without
capturing the whole engine. Three.js scene mutation may remain in `GameEngine`.

## 13. Budgets and tuning

```text
ZONE_BLEND_WIDTH=8
ZONE_TINT_DAMPING=3.5
ZONE_FOG_WEIGHT=0.04..0.10
ZONE_DECORATION_INSTANCES_MAX=94 total
ZONE_LANDMARK_MESHES_MAX=8 per landmark
HATCH_TEXTURE_SIZE=64
```

Targets:

- no more than eight new instanced draw calls for repeated zone decoration;
- no more than 32 total landmark mesh draws;
- no dynamic lights;
- no per-frame allocation in visual-weight/atmosphere update;
- no increase to existing tree count or future foliage/weather budgets.

## 14. Accessibility and readability

- Zone identity is redundant across text, motif, shape, arrangement, and color.
- Ground hatching remains below decal/combat readability and avoids tight flickering
  frequencies.
- UI accents cannot override health/danger/faction/rarity meanings.
- Light and dark themes preserve contrast for all zone titles.
- Reduced motion removes title translation and animated motif sweeps.
- Large landmark silhouettes must not hide actors or the player at ordinary camera
  angles; mark foliage-like pass-through objects where appropriate.

## 15. Edge cases

- At X=0/Z=0, normalized visual weights prevent a four-color overbright tint.
- `zoneAt()` remains the source for perks, music shift, objectives, and UI zone name.
  Visual weights never affect gameplay.
- Added props near palace/fort walls must not enter gate detour nodes or camera-obstacle
  lists unless intended.
- Procedural marks must not cover transparent canvas pixels on signs/decals.
- Shared texture keys include profile/motif parameters; two visually different surfaces
  cannot accidentally reuse one cache key.
- If instancing makes a prop impossible to hide for camera occlusion, use a non-occluding
  placement rather than converting dozens of instances to unique meshes.

## 16. Acceptance criteria

- [ ] Blind screenshots of each zone are distinguishable by palette, hatch motif,
      silhouettes, and composition without reading labels.
- [ ] Existing roads, spawn points, shop access, event markers, palace gate navigation,
      camera collision, and common combat lanes remain unobstructed.
- [ ] Hatching is deterministic, cached, stable at camera distance, and adds no draw pass.
- [ ] Repeated decorations stay within 94 instances and the agreed instanced draw-call
      budget.
- [ ] Global fog/horizon tint blends smoothly near quadrant borders with no per-frame
      allocation while gameplay zone logic remains hard and unchanged.
- [ ] Zone UI accents transition on zone change, preserve semantic colors, and provide
      reduced-motion/static behavior.
- [ ] Day/night, bloom on/off, both themes, existing foliage, and future
      weather/foliage ownership remain compatible.
- [ ] Version-1 saves load unchanged; engine restart disposes all new resources.
- [ ] Production build, oxlint, navigation smoke test, day/night captures for four zones,
      and draw-call/frame-time comparison pass.

## 17. Dependencies and effort

- Spec 01's material resource-deduplication should land before shared instanced material
  cleanup is expanded.
- This spec is otherwise independent of combat, loot, audio, and camera accents.

**3-4 days.** Most time is visual iteration and navigation/camera regression checking,
not the profile data itself.
