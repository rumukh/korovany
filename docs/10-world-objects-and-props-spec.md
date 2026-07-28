# 10 - World Objects and Props

**Status:** implemented (Wave 2B)
**Depends on:** `docs/08-graphics-foundation-spec.md`
**Related:** `docs/05-zone-art-direction-spec.md` (visual grammar; its four-quadrant
structure predates the 5x5 generated world and is historical),
`docs/from-four-zones-to-a-seeded-campaign.md`

## 1. Goal

Make the world worth looking at.

The headline complaint about this game is that the NPCs and the world objects look
bad. The foundation (spec 08) gave the world one material family, a geometry kit and
an ink language, then stopped at the boundary of content: it replaced the tree and
the boulder and fixed a roof that was sunk into its own walls, and left everything
else as it found it. This pass is the content.

The north star is unchanged: **«Походный комикс, собранный кодом»** — a marching
comic assembled from code. Angular low-poly geometry, bold ink, and silhouette above
all. A player should be able to tell, from the shape alone at forty metres in fog,
that a thing is a village, that the village belongs to the guard rather than the
elves, and which side of it the road comes in on.

Specifically:

- A settlement is a **place** — several buildings, a well, a fence, a gate, a cart,
  a woodpile, washing on a line — not one box with a pyramid on top.
- A building is **openings**: a door you could walk through, windows with frames,
  sills and shutters, a chimney that says someone is inside, eaves that throw a
  shadow line down the wall.
- A biome has **more than one plant**. A forest is a mixed stand with undergrowth,
  deadfall and stumps, not the same silhouette repeated at three scales.
- A bridge is a crossing, not a box with two box rails.
- The eight ink draws a region is allowed get spent on the silhouettes that carry a
  frame, instead of one on the trees and seven on nothing.

## 2. Scope and non-goals

### In scope

- `src/game/art/PropKit.ts` — the world-object vocabulary. Modular building parts,
  settlement dressing, six tree species, undergrowth, layered rock, fortification,
  bridges, landmarks and ground cover.
- `src/game/world/SiteComposition.ts` — deterministic layouts: what a settlement,
  shop, camp, stronghold, shrine, event site, cache or landmark is actually made of.
- `src/game/world/WorldPropLibrary.ts` — the shared, reference-counted prop catalogue
  with a retention window, plus every biome and territory palette.
- `src/game/world/GeneratedWorldRuntime.ts` — placement, instancing, LOD, collision,
  ink budget and disposal.
- The `new GeneratedWorldRuntime(...)` construction block in `src/game/GameEngine.ts`.

### Out of scope

- Characters, creatures, caravans and fauna. Wave 2A owns those.
- The geometry kit, the material library, the shader injection, the lighting rig,
  the atmosphere and post-processing. Spec 08 owns those and this pass extends none
  of them — see §4 for the one place that hurt.
- Terrain generation, region streaming policy, navigation, AI, the chronicle.
- Any imported asset. The game contains no GLTF, no FBX, no image file and no asset
  pack, and this pass adds none. Everything below is generated in code.

## 3. Verified baseline

Measured on the parent branch before any change, at `terrainResolution: 16`:

```text
site prefab            1 tapered box + 1 hip roof, plus 0-2 prisms.  No door,
                       no window, no chimney, no fence, no gate, no sign.
settlement             identical to a shop, a camp and a keep except for size.
territory expression   none.  An elf village and a villain fort differ only in
                       the palette mixed into a shared texture.
vegetation             1 species per biome, 1 instanced mesh, scaled 0.72-1.42.
undergrowth            none.
rock                   1 displaced icosahedron in the fort biome.
bridge                 1 box deck + 2 box rails.
road dressing          none.  River dressing: none.
landmarks              1 prism with a cap.
LOD                    unused.  `createLod` had no caller.
ink                    1 draw per region of the 8 allowed.
```

A second, uglier fact turned up during visual verification and is recorded in §4.

## 4. Design corrections

**The geometry kit wound its triangles backwards.** `loftProfile` — and therefore
`taperedBox`, `stylizedCapsule`, every prism and every lofted tier in the game —
emitted triangles whose winding was the reverse of the shading normals it computed
for them. Measured at the time: `taperedBox` 0 triangles agreeing and 12 disagreeing,
`latheProfile` 6 agreeing and 9 disagreeing, against `THREE.BoxGeometry` at 12/0.

Two things follow, and the second one is why the world looked flat:

1. Front-face culling keeps the **far** surface of every lofted solid instead of the
   near one. Lighting still looks plausible, because the shading normals are correct;
   depth ordering does not.
2. A `BackSide` inverted-hull outline over reversed geometry renders the **near**
   faces, so an outlined prop is filled solid with its own ink colour. In fog this
   reads as a washed-out grey block, which is easy to mistake for "the art is flat"
   rather than "the outline is inside out".

The geometry kit belongs to the foundation pass and this pass does not edit it. The
correction therefore lived, temporarily, in `PropKit.conformWinding(geometry)`, which
flipped **only** the triangles that disagreed with their shading normal — idempotent
by design, and correct whether or not the kit was fixed at source. It bought this pass
a working ink language while the defect was routed to its owner.

**It has since been removed, and the removal is the interesting part.** The foundation
corrected `loftProfile`, `taperedBox` and `latheProfile` at source, at which point the
guard flipped nothing — measured, not assumed. Keeping it looked defensible: a cheap
idempotent backstop against a kit this pass does not own and that got it wrong once.

It was not defensible, for a reason that only shows up when you ask what the tests were
actually measuring. `conformWinding` ran **inside** the builders, including
`mergePropParts`, so it touched essentially every prop before any assertion saw it. The
family-wide orientation check in `tests/worldArt.test.ts` was therefore **tautological**:
it walked 560 geometries and could not have failed, because the guard had already
corrected anything it would have caught. A silent runtime fixup does not protect an
invariant — it hides the evidence that the invariant broke, and converts a loud test
failure into a permanent per-triangle tax on every prop the game builds.

So the guard is gone, and the test now measures the kit's real output. It still reports
**zero disagreements across all 560 geometries**, which is the first time that number
has meant anything. The check also got 45% cheaper, because it is no longer paying for
the pass that was making it lie.

**Openings are applied geometry, not boolean cuts.** A recessed frame with a dark
panel behind it reads as a hole from every angle a third-person camera can reach,
costs a dozen triangles, and does not require a CSG library in a game that ships as a
single HTML file.

**Site collision moved from one box to one circle per structure.** The old prefab
registered a single box over the whole footprint. A composed village needs a walkable
square, so buildings and large props each register their own collider and the box is
gone. Fences and curtain walls are deliberately **not** solid: a fence that traps the
player or the pathfinder is a gameplay regression, and no silhouette is worth that.

**The world palette shrank.** Props bake their colour into their vertices, so the
per-biome `structure`, `roof`, `accent`, `secondary`, `bridge` and `trunk` materials
and their procedural textures are gone. Only terrain, road and water are still
textured. Runtime-owned materials went from 31 to 14.

## 5. Architecture

### 5.1 Module layout

```text
src/game/art/PropKit.ts             geometry vocabulary; depends on GeometryKit only
src/game/world/SiteComposition.ts   layouts; pure numbers, no three.js
src/game/world/WorldPropLibrary.ts  shared catalogue, palettes, cache lifetime
src/game/world/GeneratedWorldRuntime.ts  placement, instancing, LOD, ink, disposal
```

`PropKit` never imports from `world/`. `SiteComposition` imports nothing from
`three`. Both stay importable from a Node test with no DOM, which is what makes the
determinism and layout assertions cheap.

### 5.2 Surfaces, parts and merging

A composite prop returns `PropPart[]` — geometry tagged with the material family it
wants — rather than a single geometry:

```ts
type PropSurface = 'hard' | 'cloth' | 'foliage' | 'glow'
interface PropPart { geometry: THREE.BufferGeometry; surface: PropSurface }
```

Four surfaces, deliberately coarse. Timber, stone, thatch and iron all collapse into
`hard` because their stylized presets differ by a few hundredths of roughness while
their baked vertex colour differs by everything — and merging them halves the draw
calls for every settlement in the world. `mergePropParts` then produces at most one
geometry per surface, so a village is **four draw calls, not forty**.

`hard` is the only surface that gets welded outline normals, because it is the only
one that gets ink.

### 5.3 Buildings

`buildingParts(options)` assembles a building from parts:

```text
foundation   low battered plinth, wider than the walls
walls        one tapered box per storey; upper storeys jetty out over the one below
framing      timber-frame: corner posts, mid rail, diagonal braces
             log:          horizontal courses, proud edges only
             stone:        quoins and a string course
             plank:        vertical battens
door         two jambs, a lintel, a battened leaf, a threshold step, one crooked board
windows      per storey and per long face: frame, sill, head, two open shutters,
             and a pane that is near-black when unlit and on the glow surface when lit
roof         thatch  bulging profile, thick ragged eave, ridged noise
             shingle stepped sections, so the silhouette has course lines
             tile    crisp, with a capped ridge
             flat    slab with a cornice, or merlons when crenellated
             conical polygon loft with a finial
             plus eaves, a ridge beam, rafter tails and barge boards
chimney      battered stack, cap, pot
porch        two posts, two braces, a lean-to canopy
balcony      deck, balusters, rail
```

Only the section list changes between roof materials, so the whole material story
costs zero extra draw calls and zero extra geometry.

Cost: 750-1800 triangles for a near-level building, 120-260 for the far level.

### 5.4 Territory as architecture

The player should know whose ground they are on before they see a banner. The
cheapest way to say it is a different way of holding a wall up.

| Territory | Walls | Roof | Fence | Proportion |
| --- | --- | --- | --- | --- |
| `elf` | timber frame | thatch | picket | tall, 1.18x storey height |
| `guard` | dressed stone | tile | iron | square, crenellated |
| `villain` | horizontal log | shingle | sharpened palisade | low, 0.86x, crenellated |
| `neutral` | vertical plank | thatch | rail | rustic, irregular |

Colour comes from the **biome** (`BIOME_MATERIALS`) and the cloth, metal, accent and
glow from the **territory** (`TERRITORY_COLORS`), so a guard outpost in the forest is
recognisably both.

### 5.5 Site layouts

`composeSiteLayout` is deterministic in `(worldSeed, siteId)`. Site-local space has
**+Z pointing away from the region centre**, so the approach — and the front of
everything the player walks up to — is -Z.

```text
settlement        3-5 houses on a jittered ring facing a well, a cart, a woodpile,
                  washing on a line, a lantern, a banner, barrels and crates, and an
                  eight-sided fence with the approach side open and a gate in the gap
shop              a shop building with a porch, a market stall with a striped awning,
                  a hanging sign, barrels, crates and a lantern
faction-start     a hut, two ridge tents, a brazier, two banners, supply crates and a
                  palisade arc
final-stronghold  a crenellated keep inside a ring of towers joined by curtain wall,
                  a gate on the approach, banners and braziers
recovery          a shrine on carved posts with drapes and a votive flame, two lantern
                  posts, a cairn, a banner
event             a leaning obelisk with a lit rune band, three standing stones, a brazier
treasure          a banded chest on a rock plinth, a cairn, a crate, a lantern
landmark          a stepped plinth under a carved column, two tall banners, a waystone
                  and, on held ground, two pillars
```

Every layout also returns a `clearingRadius`. Dressing and ground cover both respect
it, so a village square stays a square instead of growing a forest through the well.

### 5.6 Vegetation, undergrowth and rock

Six species — `conifer`, `broadleaf`, `slender`, `dead`, `topiary`, `thorn` — each
with a different **shape grammar** rather than a different scale: a conifer is stacked
tiers, a broadleaf is a branched skeleton under clustered lobes, a birch is a bare
pale pole with a high crown and dark ticks in its vertex colour, a topiary is a
clipped cone on a bare stem, a thorn is a low tangle with sparse dark clumps.

Per biome:

```text
forest   conifer, broadleaf, slender   + bush, stump, deadfall   + bedded rock, scree
neutral  broadleaf, slender, conifer   + bush, haystack, stump   + bedded rock, scree
palace   topiary, slender, conifer     + bush, stump             + bedded rock, cairn
fort     dead, thorn                   + bush, deadfall          + bedded rock, outcrop, scree
```

The fort gets two species and no third on purpose: nothing much grows there, and the
gap is filled with rock, which is the point.

Rock is **bedded** — three or four offset slabs with their own colour value, so the
ink has a set of horizontal ledges to catch. Weathering is one dot product in the
vertex colour: moss in the forest, pale lichen at the palace, ash in the fort, dry
dust in the neutral lands.

A per-biome plan (`DRESSING_PLANS`) gives each kind a weight, a collision radius, a
vertical stretch and a base lift. Six kinds is the ceiling — each is an instanced draw
call and a region already spends four on ground cover.

### 5.7 Determinism and sharing

Two rules decide the whole caching design.

**Shared props are built from a constant seed.** A forest tree is visible in three
streamed regions at once and drawn a hundred times; it has to be *one* buffer.
Variation therefore lives in the cache **key**, not in the world seed:
`artVariation('korovany:props', key)`. The geometry for a given key is byte-identical
in every world. What the world seed varies is *layout* — which key goes where, at what
angle and scale — through `SiteComposition` and the per-region dressing stream.

**Per-instance jitter is a hash, not a draw.** Which dressing kind a placement gets
comes from `hashUnit(placementIndex, regionSeed)`, so the placement list is
byte-identical to what a single-species build would have produced and the decoration
density and collision assertions are unchanged.

No `Math.random()`, no clock, and no draw from a gameplay `RandomStream` anywhere in
this pass.

### 5.8 Lifetime

`WorldPropLibrary.acquire` hands out an asset holding one reference-counted cache key
per surface; `release` returns exactly those. `acquireComposite` does the same for a
one-off composition — a settlement's merged props, a region's road furniture — under a
caller-chosen key.

On top of the reference count sits a **retention window** of 128 keys. Region
streaming is a sliding window: walking one region east unloads three regions and
reloads them the moment the player turns around. Dropping the last reference the
instant a region unloads means rebuilding a settlement — lathes, seeded noise, welded
outline normals and all — every time the player crosses a boundary twice. Holding the
last 128 released keys turns that into a map lookup. `release` transfers the caller's
reference into the window rather than dropping it, and `acquire` takes the pin back
**after** bumping the count, never before: releasing first would take the count to
zero, dispose the geometry the window exists to preserve, and rebuild it on the very
next line.

A composite asset is also built at most once for the whole asset, not once per
surface: the first missing surface triggers the build, the rest are claimed from the
same result, and anything left over is disposed rather than leaked.

### 5.9 LOD

`createLod` is for **unique meshes only**. Instanced props draw the cheap level
directly, because swapping an instanced buffer per frame costs more than the triangles
it saves.

- **Buildings** get a real two-level LOD: the full building near, and at 46 units a
  version with no framing, no openings, no chimney, no porch and a two-section roof.
  Both levels are cached, so five houses of the same spec share two buffers.
- **Bridges** get the same treatment at 74 units: a five-plank deck with three rail
  posts replaces the full trestle.
- On teardown the level meshes are dropped with `clearLod`, which frees nothing
  shared — the cache release is what actually lets the geometry go.

### 5.10 Ink

`OUTLINE_WORLD_DRAWS_MAX = 8` per visible region, enforced by a counter rather than by
convention, because an inverted-hull outline is a whole extra draw of the source
geometry and a region with a stronghold, a bridge and a dense forest wants twenty.

The counter charges **draws, not calls**. `applyOutline` builds one shell per
qualifying mesh, so a building — an LOD whose near level is a group of surface meshes —
costs four and was billed as one until a review caught it. An LOD is charged its most
expensive level rather than the sum, since only one level ever renders; billing the sum
would price a building at double what it draws and push the vegetation out of the
budget for nothing. `tests/worldArt.test.ts` asserts the charge equals the shells
actually built, for every region of a full map.

Priority is build order, which is also value order:

```text
1-4  each site: the tallest roofline and the merged clutter around it
                (OUTLINE_SITE_DRAWS_MAX = 4 per site, so the trees are never starved)
5    the bridge deck, when the region has one
6-8  dressing, tallest species first
```

**Ink-worthiness is not collision.** Dressing buckets carry a separate `ink` flag,
defaulting to `structural`. Tying the two together was why seven of the eight draws sat
idle: only one bucket per biome collides, so only one was ever outlined, and the modal
region spent a single draw. Every full-size tree and boulder now earns a silhouette
whether or not it blocks movement; half-buried pebbles and undergrowth do not. Measured
across five seeds and 845 region loads, mean spend went 2.24 → 3.99 of 8, worst case
5 → 7, and no region spends fewer than 2.

Instanced shells share `instanceMatrix` with their source, so an outlined forest is
one extra draw call for the whole region — and they are released **before** the source
`InstancedMesh` is disposed, or one frees the other's buffer. A shell is parented to
its source and tracks its `count` per frame, so the decoration-quality slider thins the
ink along with the trees.

**The 8 is per region, and nine regions are visible.** `GeneratedWorldRuntime` sets
`visibleRadius: 1`, and `RegionManager` selects on Chebyshev distance
(`max(|dx|, |dz|) <= visibleRadius`), so **3x3 = 9** regions are resident and drawing at
once. The per-region cap therefore admits up to **72** simultaneous ink draws; the
measured mean of 3.99 puts the realistic figure near **36**, worst case near 63. Spec 08
states the 8 without the multiplier, which is a hole in the budget rather than in the
accounting — Wave 4 should either declare a global `OUTLINE_WORLD_DRAWS_TOTAL` or
restate the 8 as a per-region share of one.

**The unit also changed, and that matters more than the count.** Spec 08 sized the 8 for
*instanced* silhouettes, where one draw inks a whole forest. This pass spends most of it
on **unique** meshes — a building LOD, a bridge, a merged clutter mesh — where one draw
inks one object. Seven of eight spent on unique props leaves a single slot for the
instanced case the number was originally written for. That is a deliberate trade, not an
oversight: a settlement roofline is the silhouette a player navigates by. It is recorded
here so Wave 4 prices it knowingly.

## 6. Budgets

Existing budgets from spec 08 are unchanged. This pass declares three new numbers and
raises one:

```text
PROP_SURFACES=4                      hard, foliage, cloth, glow
PROP_RETENTION_KEYS=128              distinct recently released keys, one slot each
PROP_CACHE_ENTRIES_MAX=176           = PROP_RETENTION_DEFAULT + PROP_RESIDENT_HEADROOM
BUILDING_LOD_DISTANCE=46             camera units; bridges swap at 1.6x that
OUTLINE_SITE_DRAWS_MAX=4             of the 8 a region may spend
DRESSING_KINDS_MAX=6                 instanced dressing meshes per region
GROUND_COVER_KINDS=4                 unchanged
SITE_DRAWS_MAX=4                     hard, foliage, cloth, glow per site
REGION_DRAWS_PEAK=27                 measured, worst region of a 5x5 map
REGION_TRIANGLES_PEAK=63k            measured, worst region, decoration density 1.0
BUILDING_TRIANGLES=750-1800 near, 120-260 far
```

`GEOMETRY_CACHE_ENTRIES_MAX` in spec 08 is 64 and describes the whole game. This pass
needs more, because the catalogue is much larger and the retention window deliberately
holds geometry past its last reference. **Requested: 176**, justified by a measured
peak of **130** live entries and asserted in `tests/worldArt.test.ts`.

**Correction, and it invalidates the framing above more than the number.** The two
constants govern *different caches*. `GEOMETRY_CACHE_ENTRIES_MAX` was written for
`GameEngine.artGeometry`; the figure asserted here is `WorldPropLibrary`'s own cache. So
this was never a request to raise a shared ceiling — the two never shared one, and
`GEOMETRY_CACHE_ENTRIES_MAX` turns out to exist in no code at all, only in the two specs.
Worse, the assertion enforcing 176 was a **bare literal** citing a
`PROP_CACHE_ENTRIES_MAX` that likewise existed nowhere, so nothing connected the number
to the thing that determines it.

The budget is now derived from exported constants — `PROP_RETENTION_DEFAULT` (128) plus
`PROP_RESIDENT_HEADROOM` (48) — so changing the retention default moves the bound with
it. Found by the art-foundation session; the class is the same one §13 collects, one
level up: not a check that cannot fail, but a check whose **threshold** came from
somewhere unrelated to what it measures.

The peak depends on how the player moves, and the intuition here is backwards, so it is
worth recording. A 128-key window inside a 176 cap leaves 48 for the live set, which
only works because retained and live keys overlap — and one might expect a straight run
across the map to minimise that overlap and blow the cap. Measured over three seeds, two
warm laps each:

```text
full sweep    130      diagonal     101
zigzag        130      straight run  92     <- the caravan case, the cheapest
```

Straight-line travel is the **least** expensive, not the most. Overlap is not the
dominant term: how many *distinct* keys a route demands is. One row of the map asks for
a fraction of the catalogue, while a full sweep asks for all of it. The worst case is
therefore the exhaustive traversal a test performs, not the route a player takes — which
is the comfortable direction for a budget to be wrong in.

Memory cost is bounded by the window: most entries are small props, and the largest — a
merged settlement — is roughly 340 KB.

**What the window buys, measured rather than argued.** Independent review instrumented
`dispose` across three identical laps of a 5x5 map, before and after the fix that made
the window hold distinct keys instead of duplicate pins:

```text
geometry disposals     7668 -> 3102     -60%   the window now covers enough keys that a
                                               returning region stops rebuilding
InstancedMesh disposals 2184 -> 2861     +31%   the ink fix adding shells, consistent
                                               with mean draws 2.24 -> 3.99
```

The two changes are separable in the disposal counts, which is the clearest evidence
either of them worked. The same review verified the ledger invariant at all 225 region
loads rather than at lap boundaries, with `retained == distinct` every time, and added a
**phantom pin** check this pass had not thought of: a window entry whose key has no live
cache entry pins nothing and releases nothing when evicted, and is invisible to a
reference-count sum because `GeometryCache.release` is a silent no-op on a key it does
not hold. Zero observed; `tests/worldArt.test.ts` now asserts the cheap form of it —
the cache can never hold fewer entries than the window holds keys.

Targets:

- No per-frame allocation. Everything above is built at region load and mutated only
  by the decoration-density slider, which writes `InstancedMesh.count` and nothing else.
- Region streaming cost stays within ~20% of the foundation baseline. Measured on a
  noisy dev box over six laps of a 5x5 map: baseline median 47-128 ms per focus change,
  this pass 87-133 ms, overlapping bands. The retention window is what closes the gap;
  without it the same measurement was 2x the baseline.
- One material per surface, never one per mesh. Runtime-owned materials: 14.

## 7. Resource and lifecycle rules

- Geometry a region builds for itself goes in `this.geometries` and is disposed by it.
  Geometry it borrows goes in `this.propAssets` and is **released**, never disposed.
  A forest tree is very likely still being drawn by the two regions either side.
- Teardown order in `SceneRegionRuntime.releaseResources()` is load-bearing:
  1. detach from the scene,
  2. release every outline binding — instanced shells share `instanceMatrix` with
     their source and must be gone before it is disposed,
  3. `clearLod` every LOD, which frees nothing shared by design,
  4. remove the region's colliders,
  5. dispose instanced meshes, then region-owned geometry,
  6. release every borrowed prop asset.
- `GeneratedWorldRuntime.dispose()` disposes the prop cache **after** every region has
  released, so it only frees what a partially torn-down region would otherwise strand.
- The runtime still only disposes an art library it built itself. Handing it the
  engine's library must not free it, and that is what keeps the Node tests working
  without a renderer.
- Nothing here calls `StylizedArtLibrary.acquireMaterial`, so the library-owned
  material budget is untouched.

## 8. Gameplay safety

- Road and river ribbons are untouched. `createTerrainProjectedStripGeometry`, its
  clipping, its shared boundary vertices and its height offsets are exactly as they
  were, because `tests/generatedWorldRuntime.test.ts` asserts that two adjacent
  regions' ribbons meet vertex for vertex.
- **A site's canonical position stays walkable and reachable.** That position is the
  objective, the map marker and the pathfinding destination all at once, and the
  runtime places the site group `footprintDepth / 2 + 2.5` *past* it along the
  outward radial — so in layout space it sits that far back down -Z, right where the
  road arrives. Solid pieces are placed on the arc that avoids it,
  `keepApproachWalkable` demotes anything that still lands on it or on the corridor
  in from the road, and gates carry no collider at all because a gate is a hole you
  walk through. Measured over five seeds and all 60 sites:

  ```text
                    site positions blocked   region centre → site unreachable
  foundation                            3                                 12
  this pass                             0                                  8
  ```

  The remaining eight are pre-existing and unrelated — riverside and across-water
  sites whose region centre genuinely has no land route.
- Bridge camber is capped at 0.2 units. The player walks on terrain height across the
  gap in the water collider, not on the deck, so a picturesque arch would put their
  knees through the planks at mid-span.
- The water collider gap, the bridge crossing test and the spawn circles are unchanged.
- Buildings and large site props register circle colliders; fences, curtain walls,
  gates, banners, crates, barrels and lanterns do not.
- `findNearbySite`, shop interaction radii, markers and encounter plans read site
  positions, which are unchanged.

## 9. Accessibility and readability

- Territory is expressed at least three ways at once: wall construction, roof
  material, fence type, banner colour and proportion. Colour is never the only cue.
- Openings read as holes in full daylight because unlit glazing is near-black, not
  merely darker than the wall.
- Lit windows, lantern panes, brazier coals and rune bands are the only emissive
  surfaces this pass adds, and they are small; the vignette and bloom tuning from spec
  08 are unchanged.
- Nothing here animates, so `prefers-reduced-motion` is unaffected.
- The decoration-quality slider still only changes cosmetic instance counts and never
  touches collision, which the existing tests assert.

## 10. Edge cases

- A vertex-coloured material on geometry without a `color` attribute renders **black**.
  Every builder bakes one, and `tests/worldArt.test.ts` checks every species, every
  wall/roof combination and every composite surface.
- **Winding is asserted by volume, not by normals.** `displaceGeometry` recomputes
  normals *from* the winding, so once it has run a reversed prop has reversed normals
  to match and a normal-agreement check goes quiet exactly when it would matter most.
  The signed-volume assertion does not care what the normals claim.
- **Outline normals are always re-baked on the merged surface, never inherited.** A
  part that arrives already welded carries normals welded against its own corners,
  and `mergeAll` fills the gaps for parts that had none by copying their shading
  normals. Both are wrong for the merged whole, and the seams between parts are
  exactly where an unwelded hull cracks open.
- **A quantized cache key must build the geometry that key describes.** Keys round
  free dimensions to a half unit, so a fence 5.1 long and one 5.2 long share a key;
  `canonicalRequest` rounds the *builder's* inputs to the same grid, or the buffer
  behind that key would depend on which request happened to build it first.
- Glow windows are parented to the **near** LOD level, not to the building group. The
  far level has no openings, so a sibling glow mesh would leave lit windows hanging in
  the air once the LOD swapped.
- `mergeAll` disposes its inputs by default; `mergePropParts` relies on that, and any
  surface a caller did not ask for is disposed rather than leaked.
- A composite whose surface list is wrong throws — and releases every reference it had
  already taken first, because the half-built asset never reaches a caller and nothing
  else would ever return them.
- Two of the eight fence sides face the approach. Both are left open — a settlement the
  player has to walk around to enter is a navigation problem, not a place — and a single
  gate goes in the middle of the gap. Emitting a gate per skipped side produced
  duplicate placement ids, which the layout test now forbids.
- Building dimensions are quantized to a quarter unit so two similar houses collapse
  onto one cached buffer; fence and bridge spans quantize to a half unit.
- `hashUnit`-driven kind selection means a region with fewer placements than kinds
  simply leaves some kinds empty, and an empty bucket never creates a zero-instance mesh.

## 11. File-level changes

| File | Changes |
| --- | --- |
| `src/game/art/PropKit.ts` | New. Buildings, settlement dressing, six tree species, undergrowth, rock, fortification, bridges, landmarks, ground cover, part merging, winding correction. |
| `src/game/art/index.ts` | One `// --- PropKit ---` export block at the end. |
| `src/game/world/SiteComposition.ts` | New. Deterministic site layouts and territory styling. |
| `src/game/world/WorldPropLibrary.ts` | New. Reference-counted catalogue, retention window, biome and territory palettes. |
| `src/game/world/GeneratedWorldRuntime.ts` | Composed sites, species-varied dressing, river and road dressing, bridge LOD, prop material family, ink budget, per-structure collision, release ordering. Ground-cover geometry moved to `PropKit`. |
| `src/game/GameEngine.ts` | Only the `new GeneratedWorldRuntime(...)` block: the palette shrank to the surfaces that are still textured. |
| `tests/worldArt.test.ts` | New. Vertex colours, winding, outline normals, determinism, cache balance, retention, layouts, ink budget, collision, reload. |
| `tests/generatedWorldRuntime.test.ts` | Updated for vertex-coloured buildings, the LOD, and multi-species dressing. |
| `tests/art.test.ts` | The exact-barrel-surface assertion extended with this pass's export block, as its own failure message asks. Owned by the foundation pass; flagged to the PM. |

## 12. Acceptance criteria

- [x] A settlement reads as a place: several buildings, a well, a fence with a gate,
      and clutter that says someone lives there.
- [x] A building has a door, windows with frames and shutters, a chimney, eaves and a
      ridge, and its wall construction says which faction built it.
- [x] Every biome has at least two tree species plus undergrowth, and the fort has rock
      where the third species would be.
- [x] A bridge has abutments, trestles, a planked deck and a railing that follows it.
- [x] No prop geometry is missing a `color` attribute.
- [x] No prop geometry has a triangle wound against its shading normal, so ink outlines
      are lines rather than fills.
- [x] A visible region never spends more than 8 ink draws, counted as shells the frame
      actually draws, and the busiest region spends at least 5 of them.
- [x] Buildings use a two-level LOD; instanced props use none.
- [x] Streaming a whole 5x5 map twice leaves the prop cache at a steady size, and
      disposing the runtime empties it.
- [x] Settlement squares stay walkable and the road and river ribbons still meet vertex
      for vertex across region boundaries.
- [x] `npm run build`, `npm run lint` and `npm test` are green.

## 13. Tests that could not fail

Nine defects on this programme were the same defect: **a check whose answer did not
depend on the thing it claimed to measure.** They are collected here because the pattern
cost more time than any bug in the geometry, and because every one of them read as
diligence right up until someone measured the instrument instead of the code.

Twelve, by the end. The last three arrived *after* this section was written, which is the
most useful thing about them: knowing the pattern by name does not stop you shipping it.
Two were in this document's own advice rather than in any test.

| The check | What it could not see |
| --- | --- |
| `ART_LIBRARY_MATERIALS === 12` | never acquired a material, so the ceiling was never exercised |
| axis-radial winding invariant | cylinder caps face along the axis; the invariant does not apply to them |
| `conformWinding` inside the builders | corrected geometry before any assertion saw it — the family-wide check could not fail |
| index-blind winding checker | returned **6** for a correct sphere and **6** for a fully reversed one |
| tests reading `userData.comicOutline` | one rename from silently counting zero ink shells |
| ink budget charged per `applyOutline` call | the library builds one shell per *mesh*; test and code disagreed and the **code** was wrong |
| exact-set barrel assertion | the drifts it cites are type-only exports, erased before `Object.keys` runs |
| sign-only winding test | a normal can be 125° wrong and still be on the correct side |
| signed volume alone | it is a **sum**: reversed faces cancel against correct ones, so a *partial* inversion passes. Measured on this pass's own builders — 5% missed on every prop tried, 25% missed on a fort rock |
| normal agreement after displacement | `computeVertexNormals` derives normals **from** winding, so a reversed prop's normals reverse with it. Measured: misses at every fraction **including 100%** — blind, not weak |
| the family-wide winding assertion | every prop is merged, so the above applies to all of it: **560 of 560** reversals undetected |
| its stock-box mutation control | reversed *without* rebaking, proving detection of stale normals — a defect the pipeline cannot produce |
| `git fetch` in the review checklist | the branch is local-only, so it reports "already up to date" whether you are current or six commits behind |
| a `retained.length <= retentionLimit` bound | the window evicts at its own limit, so this holds even when every slot pins the same key — the duplicate-pin fault it was written for. Written *while fixing* a finding about vacuous checks, and caught before it shipped only because the habit was fresh |
| the ink budget system test | every object this world outlines is a single mesh, so `inkDrawCost` is numerically identical to `return 1` and the assertion has **zero power** over the regression it documents. Found by mutation, not by reading |
| teardown's instanced-shell ordering | spec 08 invariant 4 was tested where `disposeShell` is *implemented* and nowhere it is *relied on*; skipping the release entirely left 13 shells freeing their sources' buffers, suite green |
| `referenceCount === 0` double-release detector | the dangerous case leaves the count at 1, so the release *succeeds* and steals another holder's reference |

Four rules fall out of them, in rough order of how much they would have saved:

1. **A silent runtime fixup does not protect an invariant — it destroys the evidence
   that the invariant broke.** `conformWinding` was well-intentioned, idempotent and
   load-bearing-looking, and it made a 560-geometry assertion incapable of failing.
2. **Validate the instrument before trusting the reading.** Every orientation check here
   now proves it catches a deliberately corrupted control *before* it is believed about
   real geometry — and the control must be corrupted in the way that matters: a
   *correctly wound indexed* geometry is what exposes index-blindness, not a reversed one.
3. **State what a check cannot detect, next to what it asserts.** Sign and magnitude are
   different questions; relative and absolute orientation are different questions; a
   closed-solid invariant says nothing about an open sheet. Most of these checks were
   doing exactly what they said, where what they said was narrower than the reader assumed.
4. **When a test and the code disagree about how to count something, suspect the code
   too.** The ink budget looked like a test over-counting. The counter was wrong.

   A reviewer sharpened this into the more useful form: *the side that got the domain
   wrong is usually the side that never had to look at the domain.* The test counted
   scene objects because objects are what a graph traversal hands you; the production
   counter counted `applyOutline` calls because calls are what the budget code had in
   scope. **Neither was counting draws, which is the only thing the budget is about.**
   Both were wrong in the same direction for the same reason, and the mistake was
   assuming the production side had the better vantage point.
5. **A mutation proof only licenses an assertion if the mutation is drawn from the damage
   model the assertion actually faces.** Rule 2 says validate the instrument before
   trusting the reading, and that is not enough on its own: a control can be corrupted in
   a way that is *detectable but impossible*, which passes while proving nothing about the
   real input. Prefer mutating the real subject over a stand-in — a proof carried per
   geometry costs a clone and removes the entire question of whether the control resembles
   the thing it vouches for.
6. **Reading a suite cannot find these; mutating the source can.** Every entry above was
   found by argument, one at a time, over six review rounds — and a reviewer then found
   two more in an afternoon by injecting the defects the suite claims to guard and seeing
   which survived. **10 mutations, 8 caught, 2 survived**, and both survivors were
   assertions that read as thorough. A surviving mutation is a demonstration rather than
   an argument, and it is cheap: the campaign needed no knowledge the authors lacked, only
   the discipline to check instead of assume.

   The two it caught share a shape worth naming: **a system test can only exercise the
   cases the system happens to contain.** `inkDrawCost` recursion and its LOD-max rule are
   inert in this world because every outlined object is one mesh — 794 calls measured,
   every one costing 1 — so the budget assertion was comparing two numbers that agree for
   a reason unrelated to the logic. The remedy is a unit test on synthetic inputs, which
   is the one thing a world-level test cannot substitute for. Both fixes were verified by
   re-applying the mutation and watching the new test go red.

   **A campaign needs an applied-check gate, or it manufactures false findings as
   confidently as a vacuous assertion manufactures false confidence.** Contributed by the
   reviewer after a CRLF/LF mismatch made one of its own mutations fail to match: the
   removal silently no-op'd, only the insertion applied, and the run reported SURVIVED
   with no harm — which reads exactly like a real gap in the tests. **A mutation that
   fails to apply is indistinguishable from one the suite ignored.** Verify the edit
   landed before trusting the verdict, and verify it against the *right* site: repeating
   the exercise here, the first gate matched the wrong `releaseOutline` of two and
   reported success on a file that had not been mutated where it mattered.

   The ordering variant is the sharpest of the set. `releaseResources` promises in a
   comment to detach ink shells *before* the `InstancedMesh` sweep; moving the release
   loop below the sweep left every post-hoc assertion true — shells still ended detached
   with their own matrices — while firing `dispose` against the source's attribute 13
   times of 13. **Order is invisible to a state check made after the fact**, and closing
   it needs an observation taken *during* teardown: patch `InstancedMesh.prototype.dispose`
   for the duration, record the sequence, and assert each shell's index precedes its
   source's.

**Orientation needs three instruments, because each is blind where the others see.**
This pass reached that conclusion twice, the second time after a sibling session measured
that the first two were insufficient — an entry above that was itself written into this
table by being wrong:

| Instrument | Sees | Blind to |
| --- | --- | --- |
| normal agreement | a builder that stored a normal against its winding | **everything the world builds.** Measured over the whole request space: a fully reversed prop produced zero disagreements in **560 of 560** cases |
| signed volume | a whole prop turned inside out | partial inversion, because it sums and the faces cancel; and open sheets, which enclose nothing |
| centroid winding | one bad face in ninety-two, and *where* it is | faces orthogonal to the centroid ray, and sparse structures — a *correct* fort tree already reads 47% inward, so reversal moves it only to 53% |

`tests/worldArt.test.ts` carries all three. The centroid check is used for **sensitivity**
rather than an absolute zero, because these props are not star-convex — a building's
porch recesses and window reveals give it a healthy 300 inward faces of 844 — and the
test asserts that reversing 2% of a prop's faces *raises* that count, which is a fault
neither of the other two instruments can see at all.

**Then a sibling session measured the first row again and it got worse.** The launderer is
not `displaceGeometry`, it is `computeVertexNormals` — so the blindness reaches any
geometry whose normals were re-derived after its winding was set, which includes
`mergeAll`, `facetGeometry`, `bakeOutlineNormals`, and, decisively, the *builder*
`extrudeProfile`. A builder that ends by deriving its own normals can never be caught by
normal agreement, with no downstream transform required. Since `mergePropParts` ends in
`mergeAll` and `bakeOutlineNormals`, **every** geometry `WorldPropLibrary` returns is
laundered, and the family-wide winding assertion could not have failed for any prop in
the game. It is now judged by centroid and volume together: centroid alone catches 550 of
560 reversals, volume closes the remaining 10 (the sparse fort trees), and the pair misses
nothing that has an orientation at all.

**The sharper half is the control, not the instrument.** The mutation proof that licensed
that loop reversed a `THREE.BoxGeometry` *without* recomputing its normals — leaving them
stale, which is a defect the shipped pipeline cannot produce. So the control demonstrated
detection of a damage class that does not exist, then vouched for an assertion facing a
damage class it had never been tested against. Both halves passed; together they proved
nothing. The fix is to draw the mutation from the pipeline's own damage model and apply it
to the real geometry: every prop is now reversed *and rebaked* and must read the other way
round, which makes the proof cover the 560 things the assertion covers instead of one box
that shares none of their properties.

Four ferns fail that proof and are named in the assertion rather than excused, because a
sheet has no inside to be on the wrong side of. That list is the `open` list arrived at
from the other direction: **orientation is undefined exactly where volume is.**

**Two assertions related by an exact arithmetic identity have the discriminating power
of one.** The identity is preserved by most mutations, so the second assertion is
confirming arithmetic rather than testing code. Contributed by the foundation session
after it probed its own `volume > 0` / `reversedVolume < 0` pair: swapping two vertices
of a triple negates the cross-product term by term *whether or not those vertices were
ever a triangle*, so a blind reader returns the exact negation of a blind measure and the
reversed half passes unconditionally. All the discriminating power sat in the stock half.

This programme produced the same shape twice more, which is why it is a rule and not an
anecdote. The `acquires − releases === Σ referenceCount` ledger identity was preserved by
construction — `acquire` adds one to both sides and an effective release subtracts one
from both — so it could only fail on the absent-key case its neighbour already covered.
And `retained.length <= retentionLimit` holds because `retain` evicts at the limit, so it
survives the duplicate-pin fault it was written for. **Derived identities feel like
rigour and are the easiest place to hide a check that cannot fail.** After deriving one,
build the state it forbids and watch it fail; if you cannot construct that state, it is a
definition rather than a test.

**Prefer a magnitude or an exact count over a sign.** Same session, same probe: an
index-blind volume reader on an indexed geometry returns a small artifact rather than
nothing — measured +0.0029 against a true +4.01 — and the artifact's *sign* is a coin
flip on topology, positive for a sphere and a box, negative for a cylinder, torus and
lathe. So a sign test passes on a blind reader for exactly the two controls anyone
reaches for first. The generalisation that covers both this and the index-blind checker
in the table above: **assert the value the blind reading cannot produce.** A magnitude
gap of three orders holds unconditionally; a sign does not. The volume check here now
holds indexed prop surfaces to a fraction of their bounding box for that reason, and is
mutation-proved by making the reader index-blind.

**The two halves of this are one class, and naming it that way is the most portable
thing in the section.** Contributed by a reviewer after both had been fixed separately:

> A test that establishes world state the product doesn't establish is a check that
> cannot fail, for the same reason a control that mutates impossible damage is — **both
> measure a world that never occurs.**

The mutation-proof rule (rule 5) says the damage must come from the model the assertion
faces. The ordering trap says the *state* must be the one the product is in. They read as
two different lessons and they are the same one: an assertion is only worth its result if
the world it runs in is reachable. This pass produced both independently — a control
reversing a box without rebaking normals, which the pipeline cannot do, and a test
warming a runtime before asking for a start position, which `GameEngine` never does — and
did not see they were the same until someone said so.

The practical form: **when a test does setup the product does not do, that setup is part
of the assertion.** Streaming a region, seeding a cache, constructing an input by hand —
each one moves the test into a world that may not exist, and the more careful the setup
looks, the less likely anyone is to question it. A phantom is a key in

**A check can fire eventually and still be blind, and that is a different failure from
one that cannot fire at all.** The phantom-pin guard is the case. A phantom is a key inthe retention window with no cache entry behind it: it holds a slot, pins nothing,
releases nothing on eviction, and — worse than inert — retaining one at the limit evicts
a real key, so the fault destroys exactly what the window exists to preserve. The guard
adopted for it asserted `propCacheSize >= retainedPropCount`, on the sound premise that
every real pin has an entry.

The premise is true and the assertion still doesn't test it. `propCacheSize` also counts
entries held only by live borrowers, and those mask the deficit one for one: with `B`
borrower-only entries and `P` phantoms it reduces to **`B >= P`**. A reviewer measured
the threshold rather than the verdict, injecting phantoms one at a time into a real
streamed world:

```text
propCacheSize 131   retainedPropCount 103   borrower-only entries 28
 1..28 phantoms -> PASSES (blind)
    29 phantoms -> FAILS
```

Algebra and experiment agree on 29, and a real phantom bug produces a handful. Replaced
with `retentionIsIntact` — every retained key must have a live cache entry — which
detects at `P = 1` and is proved at `P = 1`.

Two things make this its own entry. First, **the check adopted to close a vacuous-check
hole was itself vacuous**, in a section written about that pattern, by someone hunting it
deliberately. Second, and more useful: everything else in the table could *never* fire.
This one fires — at a threshold that has nothing to do with the fault, drifts with seed
and lap, and is invisible unless you measure the **detection threshold** rather than the
pass or fail. A check that only catches gross corruption reads exactly like one that
catches the class.

the centroid ray while leaving `|alignment|` — and therefore which faces are decisive at
all — untouched. So reversal maps the inward fraction `f` to exactly `1 - f`; measured
across the request space the largest departure from that law is **0.0023**, all of it
faces jittering across the decisiveness cutoff. A half is therefore the *only* threshold
whose margin is symmetric for every geometry, and any other value trades false-pass
headroom against false-fail headroom with nothing to justify the rate.

This mattered concretely. The check first shipped at 0.4, chosen because it looked
comfortably clear of a compact solid's near-zero reading. A correct washing line sits at
**0.390** — 0.010 from being reported inside out. Nothing was failing, and nothing would
have failed until someone added a sag segment to a cloth prop, at which point the suite
would have called a perfectly good prop inverted. At a half the same prop has 0.110, and
the tightest margin in the family is the fort tree at 0.033.

The test now asserts that margin with a floor of 0.02, so a prop drifting toward the
undecidable half fails **while its verdict is still right**, rather than crossing later
and failing with a diagnosis that is actively wrong. A false failure costs more than a
false pass: it sends someone to look for a bug that is not there, in a file where the
real bugs have all been in the instruments.

The corollary for anything with a reference count: `release(key)` cannot detect a double
release because a key has no holder identity, so the fault is invisible at that boundary.
`WorldPropLibrary.release(asset)` takes a **receipt**, which does have identity, and
refuses one it has already accepted. Where an API can be receipt-shaped, the class closes
by construction and needs no test at all.

**The same failure has a collaboration form, and it cost this programme more than any
bug did.** Six of seven reviews analysed a tree that had already moved. A review of the
wrong commit is a measurement of the wrong thing, and it is indistinguishable from a
valid one — the findings are real, reproducible and about code that no longer exists.
Three mitigations, in increasing order of how well they work:

1. **Never pin a SHA in a review brief; resolve the branch by name.** Necessary, not
   sufficient — it fails the moment the author amends mid-review.
2. **Don't amend a branch others are reviewing.** An amended commit is not deleted; it is
   orphaned, and an orphaned SHA still resolves in a shared object store, so a pinned
   reference keeps returning a real, readable, permanently frozen tree. This pass caused
   the epidemic by amending roughly twenty times.

   **"I stopped amending" is not a guarantee of stability, and reads like one.** It does
   not cover the base moving underneath: a rebase rewrites every SHA on the branch
   exactly as an amend does. This pass committed additively for its last twenty commits
   and still handed reviewers four different SHAs for the same work, because the
   foundation tip moved four times. Both reviewers and the integrator hit it
   independently.

   The consequence for a downstream merger is the same as an amend, so the advice "commit
   additively" does not fix their problem either: a rebase re-parents the branch, and an
   integration branch that already merged the old shape gets add/add conflicts on files
   it has already reviewed. **Staying rebased on a moving foundation and being cheaply
   mergeable downstream are incompatible**, and someone has to choose. The integrator's
   workaround — applying `git diff <old>..<new>` as a patch instead of merging — resolves
   it as long as both SHAs are stated, which is what rule 3 is for.
3. **State the measured SHA in every message, not just the first.** Proposed by a
   reviewer after three crossed exchanges, and the only one that survives async
   messaging with no read receipt: a crossed message is then self-dating, and staleness
   is a one-line check rather than something inferred from the findings.

Open a brief with a HEAD verification that includes a **positive** discriminator — a
grep for something the stale tree contains and the current one does not. A negative check
("tests pass") cannot distinguish the two.

Two refinements from reviewers who had to use that checklist, both correcting guidance
this pass wrote:

- **`git fetch` is a no-op for a session branch.** These branches are local-only — they
  live in the shared object store and are reachable through worktrees, with no
  `refs/remotes/origin/...` counterpart. A reviewer who fetches, sees "already up to
  date", and concludes they are current has learned nothing. Use
  `git rev-parse <branch>` at the start of **every** pass instead.
- **`git reflog show <branch>` is what detects an amended-past SHA**, in seconds and
  without needing to know what changed. If you were handed a SHA, that is the check that
  tells you it has been superseded — nothing else will, because the orphaned commit
  still resolves and still looks healthy.

## 14. Effort

**2.5-3 days.** The vocabulary is mechanical. The time went into composition that
reads as places rather than as prop soup, into the cache lifetime being provably
balanced across streaming, into finding the winding defect — which took a headless
capture, a tinted ink hull and a triangle-by-triangle audit — and into getting the
streaming cost back down after the first honest measurement showed it had doubled.
