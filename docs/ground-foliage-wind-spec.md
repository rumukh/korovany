# Wind-Blown Ground Foliage

> Design spec for КОРОВАНЫ. Fully client-side, with no backend or new art assets.
> Extends the existing ground scatter with procedural geometry, `InstancedMesh`,
> `seededRandom`, the zone model, `scene.fog`, and `updateAtmosphere`.

## 1. Goal

Turn the existing coarse ground scatter into a lush, deterministic ground layer:
grass, dry tufts, ferns, and flowers vary by zone and sway without per-instance CPU
animation. Distant detail must merge into the existing fog, avoid roads and structures,
and remain optional on weaker devices.

This feature is independently shippable. It always has a default breeze; coupling to
the proposed weather system is conditional on that system being implemented.

## 2. Verified baseline

| System | Current behavior |
| --- | --- |
| Ground scatter | `createGroundScatter()` creates four `InstancedMesh` draw calls: 420 grass blades, 64 flower stems, 64 flower buds, and 110 pebbles. Instance matrices are uploaded once and each mesh computes a bounding sphere. |
| Distribution | Grass occupies the neutral/forest half and avoids the two road strips; flowers are forest-only; pebbles are fort-only. There is already coarse zone specialization, but no palace detail and no structure avoidance. |
| Motion | All scatter is static. |
| Build order | `buildWorld()` creates scatter **before** village, palace, forest, and fort props. Consequently, `staticObstacles` is not yet populated and `cameraObstacles` is not collected until after `buildWorld()`. Neither list can be reused without changing the order. |
| Fog | `MeshStandardMaterial` participates in `THREE.Fog(worldFog, 48, 132)` by default. Frustum culling is mesh-level; it is not a distance fade. |
| Settings | `App.tsx` owns persisted visual settings, passes initial values into `GameEngine`, and calls engine setters for live changes. Foliage should follow this pattern rather than read `localStorage` inside the engine. |

## 3. Decisions and non-goals

1. Keep instancing, but group instances by **render bucket**, not by zone. Zone colors
   use `InstancedMesh.setColorAt()`, so four zones do not multiply draw calls.
2. Animate organic foliage only. Existing fort pebbles stay static and remain visible
   when foliage quality is `off`.
3. Use the existing linear fog for v1. Do not introduce transparent instance fading:
   unsorted transparent instances and disabled depth writes would create worse artifacts.
4. Do not cast foliage shadows and do not update instance matrices after construction.
5. Keep the feature cosmetic: no physics, collision, `GameView`, or `SavedGame` fields.

## 4. Render buckets and density

The replacement keeps the current four-draw-call ground-detail budget:

| Bucket | Geometry | Low counts by zone (N/F/Ft/P) | High counts by zone (N/F/Ft/P) | Wind |
| --- | --- | ---: | ---: | --- |
| grass/tufts | translated triangular `ConeGeometry`; per-zone color and scale | 230 / 370 / 150 / 60 | 700 / 1100 / 450 / 180 | yes |
| ferns | 3-4 narrow triangular fronds merged into one rooted geometry | 0 / 90 / 0 / 0 | 0 / 260 / 0 / 0 | yes |
| flowers | stem and bud merged into one rooted geometry with vertex colors | 55 / 45 / 0 / 0 | 160 / 140 / 0 / 0 | yes |
| pebbles | existing `DodecahedronGeometry` | 0 / 0 / 110 / 0 | 0 / 0 / 110 / 0 | no |

`N/F/Ft/P` means neutral, forest, fort, and palace. Organic totals are 1,000 at
`low` and 2,990 at `high`; `off` creates no organic buckets. Exact counts are tuning
targets, not a reason to split a bucket into per-zone meshes.

The flower geometry must contain both stem and bud in the same local coordinate system,
with its base at `y = 0`. Animating the current separately translated bud mesh by local
vertex height would make the bud detach from its stem. `BufferGeometryUtils.mergeGeometries`
from `three/addons` is sufficient and adds no dependency; assign stem/bud vertex colors
before merging so the result still renders in one draw call.

## 5. Deterministic placement and exclusions

Refactor `createGroundScatter()` into:

```ts
private createGroundDetails(): void {
  this.createPebbles()
  this.rebuildGroundFoliage()
}
```

Call it after all zone props have been created:

```text
atmosphere -> ground -> roads -> village -> palace -> forest -> fort
           -> boundary -> ground details
```

Placement rules:

- Generate independent seeded candidate streams per bucket and zone. Generate the
  `high` sequence and use its prefix for `low`, so quality changes never reshuffle the
  retained plants.
- Sample within `WORLD_HALF` and confirm the result with `zoneAt(x, z)`.
- Reject the vertical road corridor (`abs(x) <= 3 + clearance`) and horizontal road
  corridor (`abs(z + 23) <= 3 + clearance`), matching the actual 6-unit road geometry.
- After the build-order change, reject points where
  `isWalkablePosition(x, z, FOLIAGE_CLEARANCE)` is false. This reuses the existing
  rotated boxes/circles for houses, huts, walls, towers, and the well. Do **not** use
  `cameraObstacles`: it is collected later, contains render objects rather than 2D
  footprints, and intentionally excludes planes and instanced meshes.
- Keep explicit no-scatter circles/rectangles for faction spawns, quest beacons, and
  the palace/fort compound interiors. Walls alone do not exclude their courtyards.
- A bounded rejection loop must cap attempts (for example, `target * 40`) and log the
  bucket, zone, target, and actual count if a future world layout cannot fill a bucket.

Grass around tree trunks and fort rocks is acceptable and visually useful. Only roads,
walk-blocking structures, and authored clearings require guaranteed exclusion.

## 6. Wind shader

Use `MeshStandardMaterial.onBeforeCompile`, but retain uniform objects rather than
capturing compiled shader objects:

```ts
type GroundFoliageUniforms = {
  uTime: { value: number }
  uWindDirection: { value: THREE.Vector2 }
  uWindStrength: { value: number }
}

private readonly groundFoliageUniforms: GroundFoliageUniforms = {
  uTime: { value: 0 },
  uWindDirection: { value: new THREE.Vector2(1, 0.2).normalize() },
  uWindStrength: { value: 0.25 },
}
```

Each animated material's `onBeforeCompile` assigns those same uniform references plus
bucket-local `uSwayAmplitude` and `uFoliageHeight` uniforms. This survives lazy
compilation, material recompilation, and WebGL context restoration without a
`foliageShaders` registry. Give patched materials a stable
`customProgramCacheKey()` such as `ground-foliage-wind-v1`.

Inject declarations after `<common>` and displacement after `<begin_vertex>`. The
important shader-space correction is to convert the world wind direction into the
instance's local XZ basis before changing `transformed`:

```glsl
float h = smoothstep(0.0, uFoliageHeight, position.y);
vec2 root = (modelMatrix * instanceMatrix[3]).xz;
float phase = dot(root, vec2(0.31, 0.37)) + uTime * 1.6;
float wave = sin(phase) + 0.35 * sin(phase * 0.47 + 1.7);

vec2 axisX = (modelMatrix * vec4(instanceMatrix[0].xyz, 0.0)).xz;
vec2 axisZ = (modelMatrix * vec4(instanceMatrix[2].xyz, 0.0)).xz;
vec2 localWind = vec2(
  dot(uWindDirection, normalize(axisX)) / max(length(axisX), 0.0001),
  dot(uWindDirection, normalize(axisZ)) / max(length(axisZ), 0.0001)
);

transformed.xz += localWind
  * (uWindStrength * uSwayAmplitude * h * h * wave);
```

The original draft added a world-space wind vector directly to instance-local
coordinates. Random instance yaw would therefore rotate the wind differently for every
plant, and instance scale would also distort its magnitude.

Constraints and safeguards:

- All animated source geometries have their base at local `y = 0`.
- Animated instance matrices use translation, Y rotation, and scale only; no X/Z tilt.
- Validate that both shader chunk markers exist before replacement and throw a clear
  error if Three.js changes them. A silent no-op would ship static foliage.
- Low-poly, small-amplitude foliage may keep the original normals in v1. If lighting
  makes the bend obvious, patch normals in the same helper rather than increasing
  material complexity ad hoc.
- Pebbles do not use the wind material.

`updateAtmosphere()` performs O(1) uniform updates:

```ts
this.groundFoliageUniforms.uTime.value = this.elapsed
```

Direction and strength remain at the default breeze unless a weather implementation
writes the same canonical wind state before the atmosphere update. Do not probe for
optional fields at runtime. Weather gust coupling is not a blocker for this standalone
feature.

## 7. Fog, culling, and shadows

- Keep `MeshStandardMaterial` fog and depth settings at their opaque defaults. The
  existing linear fog smoothly converges foliage color to the fog color by `fog.far`.
- Do not add `uFade` alpha in v1. If fog is ever removed, prefer a dithered opaque
  discard after visual testing rather than transparent instancing.
- Call `computeBoundingSphere()` after setting matrices, then expand its radius by the
  bucket's maximum world-space sway. Shader displacement is invisible to Three.js
  bounds and can otherwise clip at a frustum edge.
- Set `castShadow = false`; leave `receiveShadow` off. Enabling either later requires
  matching wind deformation in depth/distance materials.
- World-wide buckets trade per-zone culling for fewer draw calls. At roughly 3,000
  tiny organic instances this is intentional; split by zone only if profiling shows a
  measurable regression.

## 8. Engine lifecycle and quality changes

```ts
export type FoliageQuality = 'off' | 'low' | 'high'

private groundFoliageQuality: FoliageQuality
private readonly groundFoliageMeshes: THREE.InstancedMesh[] = []
```

- Accept the initial quality in the `GameEngine` constructor, alongside
  `dynamicDayNight` and `bloomEnabled`.
- `setFoliageQuality(quality)` is a no-op for the current value; otherwise it removes
  and disposes only the organic foliage meshes (including `InstancedMesh.dispose()` for
  per-instance GPU buffers), clears the array, and rebuilds them. Static pebbles are not
  rebuilt.
- Mark `instanceMatrix` and `instanceColor` dirty once after population. They remain
  static afterward.
- During `destroy()`, call `InstancedMesh.dispose()` from the existing scene traversal
  before disposing geometry/materials. Do not also call the rebuild cleanup path and
  dispose the same resources twice.
- Dispose temporary source geometries after merged fern/flower geometries are created.

## 9. UI and persistence

`App.tsx` owns `readFoliageQuality()`, state, and a ref, following the bloom setting:

- Storage key: `korovany-foliage`.
- Validate stored values strictly as `off | low | high`.
- Default to `high` for fine-pointer devices and `low` for coarse-pointer devices.
- Add a three-state cycling button to both the menu settings and pause settings:
  `Растительность: выкл. / низк. / высок.`. The pause control calls
  `engine.setFoliageQuality()` immediately; the menu value is passed to the next engine.
- Catch and report storage access failures using the existing warning pattern.
- No `GameView` or `SavedGame` change.

## 10. Initial tuning

```text
WIND_SPEED=1.6
DEFAULT_WIND_DIRECTION=normalize(1.0, 0.2)
DEFAULT_WIND_STRENGTH=0.25
GRASS_SWAY=0.12       FERN_SWAY=0.09       FLOWER_SWAY=0.10
GRASS_HEIGHT=0.70     FERN_HEIGHT=0.60     FLOWER_HEIGHT=0.75
FOLIAGE_CLEARANCE=0.35
ROAD_CLEARANCE=0.60
MAX_PLACEMENT_ATTEMPTS=target*40
castShadow=false      receiveShadow=false
```

Keep wind direction normalized and strength separate. This avoids the draft's
ambiguous `dir * strength` vector and gives weather gusts one scalar to change.

## 11. Acceptance criteria

- [ ] Grass, ferns, and complete flowers sway with planted bases; random yaw does not
      rotate the apparent world wind direction.
- [ ] No instance matrix/color buffer is uploaded per frame; atmosphere updates only
      shared uniform values.
- [ ] Neutral, forest, fort, and palace have visibly distinct density, scale, and tint.
- [ ] Layout is deterministic; `low` is an exact subset of `high`.
- [ ] Organic foliage avoids both roads, registered structures, authored compounds,
      spawns, and quest clearings.
- [ ] Foliage disappears into current fog without transparency sorting artifacts.
- [ ] Wind-displaced vertices do not clip at frustum edges.
- [ ] Ground detail stays within four draw calls (three organic buckets plus pebbles).
- [ ] `off / low / high` persists and rebuilds cleanly from both menu and pause UI.
- [ ] Default breeze works without weather; weather coupling is verified only when the
      weather system exists.
- [ ] TypeScript build and oxlint pass; runtime shader compilation has no WebGL errors.
- [ ] `high` maintains the current 60 fps target on the reference desktop scene; `low`
      is measured on a representative coarse-pointer device.

## 12. Effort

**1.5-2 days.** Budget roughly one day for geometry, deterministic placement, shader
injection, and lifecycle work; half a day for settings wiring; and up to half a day for
visual tuning and device/runtime shader validation. The original one-day estimate did
not include the build-order correction, merged flower geometry, or both settings
surfaces.
