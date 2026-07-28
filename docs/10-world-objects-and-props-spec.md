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

`GEOMETRY_CACHE_ENTRIES_MAX` in spec 08 is 64. **This pass requested it be raised to 176
and that request is withdrawn** — it was made against the wrong cache and nothing here
was ever gated on it.

The two constants govern *different caches*. `GEOMETRY_CACHE_ENTRIES_MAX` was written for
`GameEngine.artGeometry`, and the population it was sized for is enumerated directly
beneath it in `docs/08` — `CHARACTER_GEOMETRY_KEYS ≤ 11`, `BEAST_GEOMETRY_KEYS ≤ 26`,
`CARAVAN_GEOMETRY_KEYS = 6`, so 43 under a ceiling of 64. The 130 measured here is
`WorldPropLibrary`'s own cache, reached through `propCacheSize`. So the request used a
world-prop measurement to justify relaxing the **actor-geometry** budget by 2.75×, and
cited an assertion that measures the prop cache as well: justification and enforcement
both concerned a cache the constant does not govern.

Withdrawing it deletes a decision item rather than resolving one. `PROP_CACHE_ENTRIES_MAX`
above is this pass's own budget, is real, and is asserted — nothing needs spec 08 to move.

Two further facts, both found while unpicking this. `GEOMETRY_CACHE_ENTRIES_MAX` exists in
no code at all, only in the two specs. And the assertion enforcing 176 was a **bare
literal** citing a `PROP_CACHE_ENTRIES_MAX` that likewise existed nowhere, so nothing
connected the number to the thing that determines it.

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

Every defect in the table below is the same defect: **a check whose answer did not
depend on the thing it claimed to measure.** They are collected here because the pattern
cost more time than any bug in the geometry, and because every one of them read as
diligence right up until someone measured the instrument instead of the code.

The table kept growing *after* this section was written, which is the most useful thing
about it: knowing the pattern by name does not stop you shipping it — it only shortens the
time to the next one. Several entries are in this document's own advice rather than in any
test, and one is in this section's own prose. It opened by counting its entries in words;
the count said nine, then twelve, while the table said seventeen. **A census restated
beside the thing it counts is a second copy that nobody updates**, so the count is gone and
the table is the only authority. Same reasoning as citing symbols rather than line numbers,
one row further in.

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
| `git fetch` in the review checklist | the branch was local-only when written, so it reported "already up to date" whether you were current or six commits behind — and the advice then inverted when the branch was published, silently, because a method carries a status claim |
| a `retained.length <= retentionLimit` bound | the window evicts at its own limit, so this holds even when every slot pins the same key — the duplicate-pin fault it was written for. Written *while fixing* a finding about vacuous checks, and caught before it shipped only because the habit was fresh |
| the ink budget system test | every object this world outlines is a single mesh, so `inkDrawCost` is numerically identical to `return 1` and the assertion has **zero power** over the regression it documents. Found by mutation, not by reading |
| teardown's instanced-shell ordering | spec 08 invariant 4 was tested where `disposeShell` is *implemented* and nowhere it is *relied on*; skipping the release entirely left 13 shells freeing their sources' buffers, suite green |
| `referenceCount === 0` double-release detector | the dangerous case leaves the count at 1, so the release *succeeds* and steals another holder's reference |

The rules that fall out of them, in rough order of how much they would have saved:

1. **Disable the fix and confirm the test goes red.** This is first because it is the only
   rule here that requires no insight — every other one asks you to *notice* something, and
   the record shows noticing is exactly what fails. The spawn regression is the proof: its
   mechanism was diagnosed correctly and fixed, its ordering was then diagnosed correctly
   and fixed, and after both corrections the test was *still* green at 284 with the fix
   entirely disabled, because it ran one seed that never contained the fault. **The failure
   survived being correctly understood twice.** One line, applied at iteration one, would
   have caught all three layers; it also caught the vacuous ledger identity, the phantom-pin
   threshold, the ink-budget system test and this document's own corruption, at one run each.
   Ranked first by the programme lead, and the cost-to-benefit is not close.

   **It has one blind spot, and it is exactly the complement of its strength.** A reviewer
   supplied the qualification after watching it succeed four times: in every one of those
   cases the fix was already correct and only the *coverage* was missing. Disabling a fix
   cannot tell you the fix does not work, because the test is green in a world where it
   does. The faction-start bug was precisely that shape — `walkableNear` snapped correctly
   against a populated collision world, so the guard was real, and the test warmed the
   world before asking. Removing the fix would have reddened a test that was already
   measuring the wrong world.

   So the two belong paired rather than ranked, because they fail in opposite directions:

   - **disable the fix, confirm the test goes red** — catches a *test* with no power over
     a correct fix;
   - **run the probe in the order the product uses** — catches a *fix* with no power in
     the world the product actually runs in.

   The first would have passed for the entire life of the spawn bug while the game was
   broken. The second is what found it. Neither subsumes the other, and the cheap version
   of the second is to read the call order out of the product and copy it — here,
   `getStartPosition` at `GameEngine:2257` and the first `update` at `:2314`.

2. **A silent runtime fixup does not protect an invariant — it destroys the evidence
   that the invariant broke.** `conformWinding` was well-intentioned, idempotent and
   load-bearing-looking, and it made a 560-geometry assertion incapable of failing.
3. **Validate the instrument before trusting the reading.** Every orientation check here
   now proves it catches a deliberately corrupted control *before* it is believed about
   real geometry — and the control must be corrupted in the way that matters: a
   *correctly wound indexed* geometry is what exposes index-blindness, not a reversed one.
4. **State what a check cannot detect, next to what it asserts.** Sign and magnitude are
   different questions; relative and absolute orientation are different questions; a
   closed-solid invariant says nothing about an open sheet. Most of these checks were
   doing exactly what they said, where what they said was narrower than the reader assumed.
5. **When a test and the code disagree about how to count something, suspect the code
   too.** The ink budget looked like a test over-counting. The counter was wrong.

   A reviewer sharpened this into the more useful form: *the side that got the domain
   wrong is usually the side that never had to look at the domain.* The test counted
   scene objects because objects are what a graph traversal hands you; the production
   counter counted `applyOutline` calls because calls are what the budget code had in
   scope. **Neither was counting draws, which is the only thing the budget is about.**
   Both were wrong in the same direction for the same reason, and the mistake was
   assuming the production side had the better vantage point.
6. **A mutation proof only licenses an assertion if the mutation is drawn from the damage
   model the assertion actually faces.** Rule 2 says validate the instrument before
   trusting the reading, and that is not enough on its own: a control can be corrupted in
   a way that is *detectable but impossible*, which passes while proving nothing about the
   real input. Prefer mutating the real subject over a stand-in — a proof carried per
   geometry costs a clone and removes the entire question of whether the control resembles
   the thing it vouches for.
7. **Reading a suite cannot find these; mutating the source can.** Every entry above was
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

   **A campaign needs two guards, not one, or it manufactures false findings as
   confidently as a vacuous assertion manufactures false confidence.** A survivor is only
   evidence when both hold:

   1. **The mutation changed the file.** Contributed by the reviewer after a CRLF/LF
      mismatch made one of its own mutations fail to match: the removal silently no-op'd,
      only the insertion applied, and the run reported SURVIVED with no harm — which reads
      exactly like a real gap. **A mutation that fails to apply is indistinguishable from
      one the suite ignored.** Verify the edit landed, and verify it against the *right*
      site: repeating that exercise here, the first gate matched the wrong `releaseOutline`
      of two and reported success on a file not mutated where it mattered.
   2. **The mutation causes harm.** The half this pass missed when it first recorded the
      rule. An *equivalent* mutation — one that changes the source but not the behaviour —
      also reports SURVIVED, and also reads like a gap. The reviewer produced one against
      a guard added here: forcing `canJudgeWalkability` true changed nothing, because
      `walkableNear`'s only caller already tests it, so the throw is unreachable in
      production. It reported that as its own miss rather than a finding.

      **And then it stopped being equivalent, which is the more useful half.** Pinning the
      guard with a test that casts past `private` made the same mutation fail — measured
      independently on both trees, `CAUGHT` at 292 pass / 1 fail. So **equivalence is a
      property of the tree, not of the mutation**: the identical edit is an equivalent
      mutation before the pin and a caught one after, and nothing about the edit changed.
      The durable statement is narrower than "equivalent mutation" and worth the precision:
      *the throw is unreachable in production; it is reachable, and asserted, from a test
      that reaches past `private`.* The two readings disagree about what happens when
      someone deletes that test — under the loose one it is harmless, and it is not.

   Between them the two guards cost one extra measurement each and they are what separates
   *"the suite did not notice"* from *"there was nothing to notice."* Two of this
   campaign's reported survivors turned out to be the second kind.

   **And a gate is an assertion, so it inherits every failure mode an assertion has.** The
   reviewer's gate broke on line endings and reported SURVIVED; this pass's broke on an
   ambiguous anchor — matching the first of two `releaseOutline` sites — and reported
   PASSED on a file not mutated where it mattered. Same defect at three levels in one
   night: the assertion, the mutation that tests it, and the gate that tests the mutation.

   **The recursion does not obviously terminate, which argues for the cheapest possible
   check at each level rather than a more elaborate one.** An elaborate gate is one more
   thing that can be quietly wrong. The version that worked was two lines — *did the file
   change, and did it change at the site I named* — and the site-specific half is the one
   that mattered, because "something in this file moved" is exactly the answer that fooled
   the ambiguous anchor.

   **A mutation campaign needs a positive control, run first.** The foundation session
   produced the sharpest instance: one of its mutations reported SURVIVED, and the harness
   had done everything right — the replace matched, the gate confirmed the file changed at
   the named site. The mutation had landed on a line that only executes when
   `parts.length !== 1`, inside a branch reached only when `parts.length === 1`. **Textually
   valid, semantically inert.** A gate can see a replace that matches nothing; it cannot see
   a replace that matches and then never runs.

   What caught it was structural rather than analytic: *a survivor sitting between three
   caught siblings that all test the same guard.* That asymmetry prompted a re-check of the
   injection site instead of the test — and re-injected where it runs, it was caught. The
   remedy generalises past that instance: **run one mutation you know must be caught before
   trusting any that survive**, which proves the harness reaches the code at all. Two of
   that session's campaigns produced confidently meaningless numbers, and in both the
   *campaign* was at fault rather than the suite.

   This is the same defect as the unreachable assertion one level out: a mutation in dead
   code is a check whose answer does not depend on the thing it claims to measure, and it
   fails in the reassuring direction.


   more than the other four combined because it corrupts results silently and in bulk:**
   `git checkout -- <file>` is a *mutation* revert only for committed work. On uncommitted
   work it is a **feature** revert — it removes the thing being tested along with the
   mutation — and `git status` reports clean either way, because the file genuinely does
   match `HEAD`. Every subsequent mutation then runs against a tree with the feature absent
   and returns plausible, entirely fictional counts. That session caught it only because a
   test failed that its mutation had no path to reach, and its honest re-run against a
   committed tree changed the result. **Commit first, then mutate.**

   This pass escaped it by accident rather than by design: its reverts restored from an
   in-memory copy of the file rather than from git, which is a true mutation revert
   regardless of commit state. The tell it did produce is worth recording — one restore
   check reported `blob == HEAD: False` on a correct restoration, because HEAD legitimately
   lacked uncommitted work. **`blob == HEAD` is the right check only when the baseline is
   HEAD**; when it is not, compare against the saved pre-mutation copy and say so, because
   the two failures look identical and mean opposite things.

   Worth stating plainly to anyone adopting the technique: **it produces false positives at
   roughly the rate it produces findings.** This campaign yielded three real survivors and
   three retractions — a grouping-precision artefact, a CRLF-broken mutation, and an
   equivalent mutation against a guard whose only caller already checks. That third one has
   since expired as a retraction: the guard was pinned and the same mutation now fails, so
   it was a correct verdict with a shelf life rather than a mistake. The gates are not
   optional overhead; they are what makes the results mean anything.

   **And a survivor asks a question rather than answering one.** The same session's
   remaining survivor was correct: deleting a bit-exactness guard left every test green
   because no input can distinguish the two versions — summing *n* identical Float32 values
   needs at most 24 + log₂(n) bits and is exact in double precision. The right response was
   to document the guard as defensive and annotate the test to say it does *not* pin it,
   rather than to invent an input or delete the guard. **A surviving mutation means "nothing
   here distinguishes these two programs", which is sometimes a gap and sometimes a proof.**

8. **A regression test needs a seed that reproduced the bug.** Ordering, mechanism and
   assertion can all be correct and the test still prove nothing if its input never
   carried the defect. The spawn regression is the case, and it survived *three* rounds
   of correct fixes: the mechanism moved from snap to keep-out, the test's call order
   moved from warm to cold, and the assertion had no power over the faction-start case at
   any point — because it ran on one seed, `'spawn-keepout'`, which has no blocked start
   in either state. Dropping faction starts from the anchor set left the suite green
   while the cold sweep went straight back to 1 of 180.

   This is rule 6's sub-point at its most expensive: a system test can only exercise the
   cases the system happens to contain, and a single seed is a very small system. The
   remedy is one line and should be reflexive: **disable the fix and confirm the test goes
   red.** It would have caught this iteration and the two before it. The test now runs six
   seeds including `gp-6`, whose `villain` start is the original fault, with a sample
   floor so a shrinking seed set fails loudly.

   Found by a reviewer who checked whether the *fix* was covered rather than whether it
   worked — the fix was real and order-independent, verified cold at 0 of 180, and the
   test guarding it was still empty.

   **Which fix, though, and the answer is not the obvious one.** Two mechanisms were added
   here and only one carries the cold path. `walkableNear` snaps a start to the nearest
   standable point, and it is *the belt, not the braces*: it can only see colliders that
   already exist, and `GameEngine` asks for the start position **before** it streams any
   region, so on the run that matters it queries an empty collision world and returns its
   input untouched. The **keep-out in `createDressing`** is what takes 1 of 180 to 0 of 180
   on a cold start; the snap covers every caller whose region is already resident, which is
   every caller except the one that hurts.

   The integrator caught this pass describing it the other way round in a status summary —
   *"`getStartPosition` now returns the nearest standable point, measured 0 of 180"* — which
   is true, and reads as though the snap is the fix. **A reader carrying that model would
   simplify by deleting the keep-out and keeping the snap**, and the suite would stay green
   because the tests above run cold. It is the section's own defect one level out: a claim
   true of one population, stated as though it covered another, and the docblock in
   `GeneratedWorldRuntime.ts` named the population correctly while the summary did not.
   **Prose that travels needs the population more than prose that stays next to the code.**

   That reviewer then sharpened the shape of the three rounds better than this pass had:
   **mechanism, then call order, then input.** Each correction was right, each was better
   argued than the last, and none of them gave the assertion any power — because in every
   round *the falsifying measurement was written in the world that made the claim true.*
   Which yields the most uncomfortable line in this section: **the escalating care was the
   symptom, not the progress.** Three rounds of increasing rigour are what a vacuous check
   looks like from the inside, and the thing that finally worked took one run and no
   insight at all.

   The seed set also turned out stronger than it was written to be. The reviewer mutated
   it three ways: dropping `startAnchors` from the keep-out, forcing `blocksSpawn` to
   return `false`, and — the useful one — reducing the clearance from `radius + 0.45 + 0.2`
   to a bare radius. All three caught. The third leaves the keep-out structurally intact
   and merely under-protects, so the seed set has power over a **quantitative weakening**
   and not only over removal. That is worth more than the assertion it was written for: it
   means the margin cannot be quietly tuned toward nothing later, which is how this kind of
   guard usually dies.

   The ordering variant is the sharpest of the mutation set. `releaseResources` promises
   in a comment to detach ink shells *before* the `InstancedMesh` sweep; moving the release
   loop below the sweep left every post-hoc assertion true — shells still ended detached
   with their own matrices — while firing `dispose` against the source's attribute 13
   times of 13. **Order is invisible to a state check made after the fact**, and closing
   it needs an observation taken *during* teardown: patch `InstancedMesh.prototype.dispose`
   for the duration, record the sequence, and assert each shell's index precedes its
   source's.

9. **One assertion over two populations passes on the strength of the easier one.** The
   fourth instance of this class, found in the test written to close the third — which is
   why it belongs immediately after it. Rule 8 fixed the seed coverage for the population
   that had bitten this pass, faction starts, and left the two *encounter* populations on
   the single runtime directly above it. A reviewer bypassed the `site-building` keep-out
   entirely and the suite stayed green.

   The measured asymmetry is the mechanism, and nothing in the code suggests it. Keep-out
   skips on `'spawn-keepout'`, the only seed the encounter sections saw:

   ```
   site-prop      12    towers ring the wall at wallRadius, so they cover spawns readily
   site-building   0    a keep sits at the site centre and almost never does
   ```

   Both halves were guarded by one assertion, which passed on the prop half while the
   building half was never exercised at all. **A combined counter reads 12 and looks
   thorough.** Split per population it reads zero and the hole is obvious, so the test now
   asserts `building`, `prop` and `decoration` separately and each must prove its own seed
   set carries its own fault.

   Two further faults surfaced while fixing it, both of which would have left the new
   assertion vacuous:

   - **The counter summed the wrong population.** It reduced over `regionRoots`, which are
     the *resident* regions, so streaming discarded each count as the world scrolled away
     and a 25-region sweep read near zero. It was caught only because it disagreed with
     the reviewer's independently measured 3 for `gp-11` — **two instruments disagreeing
     is worth more than either agreeing with itself.** Now accumulated on the runtime for
     its lifetime, where it reproduces their number exactly.
   - **The non-vacuity guard fired first and hid whether the real assertion worked.** With
     the keep-out bypassed, `keepOutActed.building > 0` fails before `blockedByStructure`
     is ever compared, so the suite goes red either way and the genuinely protective
     assertion is never exercised. Neutralising all three guards to `>= 0` and re-running
     proved the real assertion carries the mutation alone. **A test going red does not
     tell you which assertion has the power**, and the one that fires first is the one you
     learn nothing about.


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
looks, the less likely anyone is to question it.

**But that rule is too broad as first written, and the refinement is the usable part.**
Warming is *usually* correct — a probe that queries collision without streaming a region
passes on an empty world and proves nothing, so most setup is not merely allowed but
required. The distinction is **who owns the ordering**:

- Where residency, seeding or construction is *incidental* to what is under test, do it.
  The test needs a world to ask questions of.
- Where the ordering **is** the contract — "can the player move on the first click" is a
  question about a specific moment in `GameEngine`'s sequence — the test must reproduce
  production's ordering rather than a convenient one.

Contributed by the reviewer who had praised the offending warm-up by name as rigour, then
named its own error precisely: *"I validated it by reading it. I saw focus-then-measure,
recognised the shape of a good habit, and stopped — without asking what the test would do
if the code were broken."* Which is the same rule it had given this pass one message
earlier — measure the detection threshold, not the pass or fail — applied to an assertion
and not to a test, because the test looked careful and the assertion looked plain.

**Appearance of rigour is not evidence of rigour**, and it is a worse proxy than no proxy,
because it is anti-correlated with scrutiny. The question that would have caught it is one
`grep`: *what ordering does production use?*

The same reviewer later reduced the whole distinction to a single question, which is the
version to carry because it needs no judgement about what is "incidental":

> **If you deleted the setup, would the test be measuring something production never does,
> or nothing at all?**

*Nothing at all* — the setup is scaffolding. Warm freely; a collision probe against an
unstreamed region proves nothing and the setup is not part of the claim. *Something
production never does* — the setup **is** the claim, and running it is asserting a world
that does not occur. The faction-start test failed the second way: delete the warm-up and
it still measures something, just the cold answer instead of the snapped one, and the cold
answer is the only one `GameEngine` ever sees.

**A guard you can grep for is a guard you can keep; a guard made of ordering is one a
refactor is entitled to break.** Contributed by the foundation session after it tested a
generalisation of this pass's finding rather than agreeing with it — twelve traversals
classified, five flagged as unguarded, and **all five false positives**. Two guard
mechanisms, neither of them the token it searched for: one exemption spelled
`isLibraryOwned` instead of `isOutlineShell`, and four builders safe purely because they
run *before* anything outlines their output.

The second kind is the dangerous one. The exemption is written down and holds whenever it
runs. The ordering guard is written down **nowhere** — nothing in those builders says
"must run before outlining" — so co-locating outline application into the builder, a
reasonable refactor that puts the silhouette decision next to the geometry, would silently
start marking every inverted hull as shadow-casting. Four builders at once, no test
failing, and the diff that breaks it touches a different function from the one that
becomes unsafe.

This file has exactly one bulk traversal, the teardown dispose sweep, and it rests on
exactly this kind of guard: `releaseOutline` must run before it or shells are freed while
borrowing their source's `instanceMatrix`. That ordering was written only in a comment
until a reviewer's mutation moved the release below the sweep and 283 tests stayed green.
It is now greppable — the test records the dispose sequence and asserts each shell
precedes its source — which is the general remedy: **convert an ordering guard into an
asserted one, or accept that a refactor may take it.**

The scanner that produced the five false positives is its own entry: it tested for *the
presence of one guard token* rather than *"can this traversal see a shell?"*, so it was
blind to a guard spelled differently and blind to a guard that is an ordering fact with no
line of code at all. That is rule 3 firing on the first check written after the rule
landed, against its own author. **Landing a rule does not install it.**

**A check that fires on correct code is worse than no check.** The tempting fix for a
predicate that misses a case is to widen it — here, extending a `.material`-assignment
scanner to catch `castShadow` too. That would have failed the build immediately, because
the four builders it newly covers are *correctly* unguarded today: they run before
anything outlines their output. A red light that means "this was always like this" is
indistinguishable from one that means "you just broke it", and arriving mid-merge it
trains everyone reading it to ignore the next one.

The alternative is to assert the property that actually holds rather than a proxy for it.
The real invariant is *"these builders contain no outline calls"* — measured true at every
commit, so it never reddens a merge, and it fires exactly when someone co-locates
outlining into a builder, which is the change that makes them unsafe. Same coverage,
no false alarm, and it converts the ordering guard above into a greppable one without
inventing a defect to justify itself.

Contributed by the foundation session, about the widening of its own landed test — whose
predicate is blind to the same four builders its throwaway scanner scored 0 for 5 on. The
same blindness, one layer up: in the shipped artefact rather than the probe.

**Cite symbols, not line numbers, in anything meant to be lifted.** Small, and it is the
failure mode this section is most exposed to, since it exists to be copied into another
programme's docs. Line numbers rot silently — the file they point into stays valid, so
nothing errors, and the citation quietly starts describing a blank line. This spec cites
files and symbols throughout for that reason.

**The exact instrument arrived last: `git rev-parse <ref>:<path>`.** Nine hours were spent
approximating a question that has an exact answer. *"Is this tree's copy of this file the
same file?"* is settled by comparing the blob hash, which is immune to caching, to
rebasing, to cherry-picking, and to a token appearing in a comment:

```text
src/game/art/stylizedShader.ts
  origin/rumukh-s1-art-foundation       b2e50bd
  origin/rumukh-s3-world-objects        b2e50bd
  origin/rumukh-rumukh-s4-integration   b2e50bd     one object, three refs
```

Everything else tried on this programme fails in at least one direction.
`merge-base --is-ancestor` is invalid under rebase or cherry-pick — three sessions, three
different wrong answers. Test counts are a lossy hash that both collides and drifts.
Tree-diff line counts raised false alarms twice, both in the alarming direction. A content
grep proves a *token* is present, not that the file is right. The surviving set is three:
**`git branch --contains`** for tip-versus-orphan, a **content probe** for "does this tree
have the fix", and the **blob hash** for "is this file identical" — which is stronger than
the other two wherever the question is really about a file.

**And the first of those three is sound in only one direction, which took until the last
hour to name.** The integrator applies work **by patch** rather than by merge, so
`--contains` and `--is-ancestor` report *False* for this branch against theirs **even on a
byte-identical tree**. Ancestry answers *"did this commit arrive"*; the question is almost
always *"did this content arrive"*. They coincide only when the receiver merges, and
diverge silently when the receiver rebases, cherry-picks or patches — which is what an
integrator does by definition.

So: **True proves containment; False proves nothing at all.** Every negative conclusion
drawn from ancestry on this programme should have come from a content diff over the owned
paths instead. That is also the empirical result — the one genuinely missing item found all
night was found by content diff, and it appeared on no list produced by SHA comparison,
while the SHA lists repeatedly reported present things as absent.

**An instruction that changes how findings are *treated* is more dangerous than one that
changes code.** The programme lead's closing contribution, and the sharpest of the
non-code entries. A bad code change leaves a diff; someone reviews it, and the error has a
surface. An instruction to *discount a category of finding* leaves nothing — and **silence
is indistinguishable from a clean review.**

The instance: a report circulated that this pass's tree predated a shader fix, with the
consequence that its reviewer's visual findings should be discounted as "shading nobody is
shipping." The premise was false — the blob hash above settles it — and had it been acted
on, a genuine visual defect would have been dropped with no artefact to find later. Every
other phantom instruction on this programme would have produced a visible wrong edit.

Which is the argument for the blob hash in one line: the claim that would have suppressed
findings was refutable in one command, and the command that refutes it exactly is the one
nobody reached for until the last hour.

**A one-directional set difference cannot distinguish "they lost work" from "they are
describing an old snapshot."** Both produce a large one-way gap, and the alarming reading
presents first — because the direction you naturally compute is *what is missing from
theirs*, which is also the direction that looks like data loss.

Contributed by the foundation session, which came within one message of reporting that
this pass had destroyed a spawn fix. Its method was sound and deliberately rebase-proof:
compare commit *subjects* rather than SHAs, so a rebase cannot fake a difference. That
defeats rebase. **It does not defeat staleness**, and it had been treated as though it
defeated both. The reverse direction settled it in one command — every subject on the
older tree was already present on the newer one, and the timestamps were three and a half
hours apart.

This was the third time in one night that the decisive check was **the other direction of
a comparison already run**. The first two were this pass's: reading a reflog position as
*"they read a stale ref"* when it read equally well as *"I have moved seventeen times
since,"* and reading `git branch --contains` as *"they reviewed a copy"* when it meant
*"I rebased past it."*

The general form is cheap and mechanical, which is why it belongs next to the mutation
rules rather than in the prose: **before reporting an asymmetry, compute it both ways.**
One extra command, and it is the difference between a colleague's error and your own
staleness — two readings that look identical from one side.

**The ambiguity resolved in my favour, silently — and that is a selection rule, not a
measurement error.** The only entry here that is not about code, and the programme lead
identified it as its own class after this pass reported it about itself.

Three times tonight this session diagnosed a colleague's tooling as broken — "cached ref
resolutions" from a reflog position, "reviewing an integration copy" from
`git branch --contains`, and a stale-tip claim inverted. Every diagnosis was withdrawn.
The evidence was correctly gathered every time: `40d6e7d` really did sit at reflog
position `@{17}`, and both readings — *"they read a stale ref"* and *"I made seventeen
moves since they measured"* — fit it exactly. **The tiebreak was not evidence.**

Everything else in this section is *"the check could not tell."* This is *"the check was
ambiguous and the ambiguity resolved in my favour."* No instrument catches it, because
nothing was measured wrongly. The only defence is the habit of asking **what else fits
this number** — and asking it hardest when the answer locates the fault somewhere other
than yourself, which is exactly when it feels least necessary.

The programme lead then produced the companion instance while checking one of these very
claims: it queried a session record with the wrong key, got `0 mentions`, and nearly
reported a confident negative. The table had **zero rows for that key at all**. **A
negative query is a claim about your query** — count the rows before reading the answer,
which is the negative-claim rule recursing onto the tool used to test it.

**A verification instrument has a shelf life, and its output ages at the speed of the
thing verified, not the speed of the instrument.** `git branch --contains` cannot go
stale the way a local ref read can — it answers correctly as of the moment it runs. It
goes stale by being **quoted later**. For a branch moving twice in twenty minutes, the fix
is not a better command; it is a shorter interval between running one and reporting it.

The concrete cost is small and worth naming because it is invisible: this pass reported a
full green gate run — tests, typecheck, lint, build — against a SHA that a subsequent
rebase orphaned. The content survived, every subject replayed. **The citation did not.**
Nobody can reproduce that run, which is precisely the audience publishing it was meant to
serve. A green result at an unreachable commit is not evidence anyone else can use.

**And the aphorism above covers one of two classes, not both.** *"The person best placed
to describe a tree is the worst placed to notice they've moved past their description"*
names the **velocity** case exactly — self-reports of one's own tip, where no instrument
helps and only a shorter interval does. It does not name the other: reports of *someone
else's* tip, which failed for a different reason — an instrument that cannot report being
stale, or a reading derived from the very thing it claims to confirm.

Different causes, different fixes, and the memorable version will absorb the second if
allowed to. Contributed by the foundation session, which separated them after tonight's
data split cleanly along that line — three self-reports past their own tip, and four
reports of another's tip taken from a local ref or an echo.

**Two readings from one act are not corroboration.** The habit this pass ran after every
single commit — push, then print `local` and `origin` side by side and call it verified —
carries no information, because the push *made* them agree. Agreement is guaranteed by
construction; the check can only fail if the push failed, which the push already reports.

The foundation session named it after watching it appear in the message announcing the fix
for exactly that class. It is the same defect as comparing `<branch>` with
`origin/<branch>` in a shared object store, one step further out: there the two refs share
a fetch, here the two readings share an action.

What actually discriminates is running `git ls-remote` **at the moment of writing the
claim**, and treating agreement as the *expected* case rather than as confirmation of
anything. Three sessions produced this shape tonight, including in messages about it.

**And a census is the most quotable and least re-checked thing anyone produces.** Three
counts were quoted from memory across one exchange — this pass's count of a colleague's
call sites, the colleague's count of this file's lathe sites, and a count of matching lines
in a spec — and all three were wrong. A number that took a command to produce gets repeated
without one, because it reads as a fact rather than as a measurement with a timestamp.

**A stale value in a coordinator's record is worse than one in a peer's message.** The
programme lead's own closing entry, about its own ledger. A peer's figure is a claim you
weigh; a coordinator's is quoted *at* you as the authoritative copy, and it arrives
attached to a decision. Six stale values were published in that ledger over one night, and
at least one — an orphaned SHA this pass had created by amending — came back as an
instruction to freeze there, from two directions.

It also explains the phantom quotations better than message drift did. Several figures
attributed to sessions that never sent them are traceable to a record rather than to a
message, which is the more dangerous origin precisely because nobody thinks to ask a
ledger for provenance.

The rule the lead derived is the one to keep, and it generalises past SHAs: **record where
a value came from, or do not record it.** The version that finally worked was leading with
the command rather than the figure — `git rev-parse <branch>` in the header instead of its
output, so the reader re-derives rather than inherits. That is the same move as citing
symbols rather than line numbers, and as stating the population a budget governs: **a
number without its provenance is a rumour that has been formatted.**

**A figure inside quotation marks reads as already verified — and so does a figure inside
an instruction.** The second half is the programme lead's, added after three separate
sessions spent measurements refuting quotations none of them had written: a docblock edit,
a `smooth: true` count, and a freeze target. Nobody misquoted anyone. The figures acquired
a specificity in transit that they did not have when sent, and each receiving session
reasonably treated a quoted SHA as something to *check against* rather than something to
first confirm existed.

The instruction case is the more dangerous one, because a directive carries authority a
quotation does not. *"Freeze at X"* is acted on; *"I measured X"* is at least a claim
someone might test. Two of the three phantom quotations this pass received were
instructions, and refusing them required arguing against a premise rather than a number.

The practical form is the same one this section keeps arriving at from different
directions: **state the command beside the figure.** A SHA with `git rev-parse` next to it
can be re-run; a SHA inside an instruction cannot be distinguished from one inside a
measurement, and by the time it reaches a third party it has neither provenance nor a way
to acquire one.


Nothing else will contradict it. Reporting the state of an integration branch, this pass
ran five content probes for what it *had* — all five correct — and then listed what it
*lacked* from its own commit titles. Two of the three named as missing were already
merged, and the one genuinely missing was described as test-only when it carried source in
two files.

The asymmetry is the point: a positive claim invites the check that refutes it, because
the natural response to "it has X" is to look for X. A negative claim has no such
counterpart — *"it lacks X"* looks the same whether or not anyone measured, and being
wrong about it is invisible until someone else looks. It is the borrowed-check finding one
level up: the assertion arriving with confidence attached gets the least scrutiny.

The remedy is mechanical and costs the same as the positive probe: **grep for the thing
you claim is absent, and report the number.** An absence stated as `MISS <token>` next to
a command is checkable; an absence stated from memory is a rumour with a SHA attached.

**Measure adopted fixes at least as hard as original code, precisely because they feel
settled.**
Contributed by the programme lead, about this pass's own status report, in the same message
in which it retracted a probe of its own for the same class of defect — it had checked for
two symbols that existed both before and after the fix they were meant to confirm.

The last entry, and the one that explains why several of the others survived
so long. **A check inherited from review carries borrowed authority**: it arrives already
argued for, by someone who was right about something else, which is exactly the condition
under which nobody measures it again.

Two of the three worst vacuous checks in this file were adopted from reviews. The ledger
identity was derived here, praised by the programme lead, recorded as programme guidance
and propagated to the integrator before anyone asked what it forbade. The phantom-pin
guard had **a reviewer's name on the reasoning and this pass's name on the
implementation**, and neither party tested it — it was caught only because the reviewer
went back to check its own suggestion rather than admire it, and found the weakened form
blind until 29 simultaneous phantoms.

That division is the mechanism worth naming: when the proposer and the implementer are
different people, each can reasonably believe the other validated it. An original check
has one owner and one conscience; an adopted one has two owners and, absent care, none.

**Severity is a property of callers, not of code — and an unreachable measurement can
become another session's calibration constant.** Contributed by the foundation session,
about its own work, and it is the only entry here where the fault propagated *between*
trees. It characterised a shading defect by its worst reachable-in-principle magnitude —
104–125° — without asking who calls the builder. The answer was nobody: the only
production route into that path has zero call sites in any of the four trees.

Those synthetic figures then became the calibration for `worstNormalError`'s 90°
threshold in this file. Measured properly, the defect runs **0–9°** in production, the
anisotropy branch asymptotes at **80.08°** and so can never trigger at any parameter
value, and correct *faceted* geometry — the default — produces false positives from
**81.3°**, opening a lying band below the useful one.

Two things to take from it. **Reproducibility is not reachability**: a defect that
reproduces on demand feels verified, and the ninety minutes it takes to ask "who calls
this?" is the cheapest step in the whole exercise. And a number quoted as a reference
point in one session arrives in another as a *constant*, stripped of the conditions that
produced it — so state the parameters a measurement was taken at, or it will be reused
where they do not hold.

The check here is now moot rather than merely tolerable — `smooth: true` appears zero
times in `src/`, so every `loftProfile` call takes the faceted path — but the limit is
written at the assertion, because that is the only place it is recoverable from.

**A check can fire eventually and still be blind, and that is a different failure from
one that cannot fire at all.** The phantom-pin guard is the case. A phantom is a key in
the retention window with no cache entry behind it: it holds a slot, pins nothing,
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

- **`git fetch` was a no-op for this branch, and is not any more — which is the point.**
  For most of the programme these branches were local-only: they lived in the shared object
  store, reachable through worktrees, with no `refs/remotes/origin/...` counterpart, so a
  reviewer who fetched, saw "already up to date" and concluded they were current had learned
  nothing. **That is no longer true.** The branch is on origin, so `git fetch` followed by
  `git ls-remote origin refs/heads/<branch>` is now the *better* check, because it sees the
  branch as another machine sees it — and `git rev-parse <local-ref>` is the one that cannot
  report being stale.

  The instruction inverted, and it did so silently. Which is the entry worth keeping over
  either version of the advice, contributed by the integrator on finding this paragraph
  still telling readers the old thing:

  > **A "how to verify X" instruction is a status claim about the repository, and status
  > claims expire.**

  It is strictly worse than a stale sentence in a spec. A stale description reads oddly and
  invites checking; **a stale method produces confident wrong answers and invites nothing.**
  The remedy is not to keep this paragraph current — it will rot again — but to prefer
  instruments whose correctness does not depend on repository state: `git ls-remote` is
  right whether or not the branch is published, and the blob hash is right regardless of
  how anything was published.
- **`git reflog show <branch>` is what detects an amended-past SHA**, in seconds and
  without needing to know what changed. If you were handed a SHA, that is the check that
  tells you it has been superseded — nothing else will, because the orphaned commit
  still resolves and still looks healthy.

**And the one that removes the whole class: `git push -u` on the first day.** Every
mitigation above manages a problem that only exists while a branch is unpublished. This
one was unpushed for most of the programme, so nobody could resolve it by name at all —
which is why two reviewers spent passes reading the integration branch's copy of the work,
why three sessions gave wrong ancestry answers, and why the same four false mechanisms
kept being proposed to explain it. **One command per session, available from the first
hour, and none of the rest of this subsection would have been needed.**

The reason it was skipped is worth naming too: the shared object store makes an unpushed
branch *look* shareable. Colleagues could read it through worktrees, so the cost of not
pushing was invisible from the inside and paid entirely by everyone else.

**A test's name is vocabulary, not mechanism — so "is the test there?" answers yes on a
tree where it cannot catch the bug.** This pass claimed one of its fixes had reached the
integration branch and probed for it with `teardown`, `disposeShell` and `releaseOutline`.
Measured across three trees: `disposeShell` appears in **3 files in every one of them**,
including the tree that lacked the fix — zero discriminating power. The programme lead
caught it with the token this pass had recommended *to the programme lead* one message
earlier: pick the string that only exists after the fix. Here that was `patchedDispose`,
0 files before and 1 after.

The sharper half emerged on re-measuring. The test's **exact name** —
*"teardown detaches every instanced ink shell before its source is disposed"* — is present
in the tree without the fix, because the upgrade rewrote the body from 61 lines to 100 and
left the title alone. A grep for the test name, which is the most natural probe anyone
would reach for, reports **present** on a tree where the test asserts post-hoc state and
cannot see ordering at all.

So the general form is stronger than "avoid topic words": **the tokens nearest a fix are
the ones most likely to predate it, and a test's name is the nearest token of all.** A fix
adds a mechanism, rarely a vocabulary. Probe for the mechanism — `patchedDispose`,
`startAnchors`, `displaceSeamless` — never for what the thing is *about*.

**The second failure mode is not a blind instrument but no instrument at all, and it hides
behind a thoroughly tested implementation.** `GeneratedWorldRuntime.dispose()` is the most
heavily guarded method this pass wrote: a reviewer's mutations proved independent power
over dispose *order*, matrix restoration and shell detachment, three distinct faults, after
an earlier version let a reordering pass with 283 green. All of that asserts the method
where it is **implemented**. Nothing asserted it where it is **relied on** — deleting
`this.generatedWorld.dispose()` from `GameEngine.destroy()` left the suite at **293 of 293**
while every streamed region root, its geometry, its materials, its colliders and every ink
shell leaked on teardown.

No amount of sharpening the disposal tests reaches this, because the defect is not in
anything they measure. The sibling foundation session found the identical hole in its own
outline releases at the same hour, in the file that names the class, and supplied the
framing: a blind check can be improved, an absent one cannot be found by improving
anything. **Ask which callers depend on an invariant, not only whether the invariant holds
where it is written.**

The reason both instances existed is worth recording because it is not laziness: the
reliance side lives in `GameEngine`, which needs a WebGL context and so had no runtime test
to extend. The absence of a convenient place to put the check is what kept it unwritten for
the whole programme. Asserting it by reading the source is a compromise, and the compromise
is worth taking — but the scan must be **bounded to the method**, not to the file. Removing
the call from `destroy()` leaves an identical `this.generatedWorld.dispose()` in a
`catch` block two hundred lines above, so a file-wide grep passes on the mutation. That is
the same weakness as a release check satisfied by "some collection is released", one level
out, and it is why the assertion here brackets `destroy()` by its next top-level member.

**A gate proves the edit landed. It does not prove it landed where you said.** Verifying a
reviewer's claim that a mutation still survived on the *integration* branch, this pass
created a detached worktree at that branch's tip, applied the mutation, and reported
`GATE PASSED: M3 applied to S4 INTEGRATION tree 3d31a22`. The gate was true — a file had
changed, at the named site, and a re-read confirmed it. **The file was in this branch's own
working tree.** `Set-Location` moves PowerShell's location but not .NET's working directory,
so `[IO.File]::ReadAllText` with a relative path resolved against the original process
directory throughout. Every subsequent reading described the wrong repository, and the
source file here was left silently modified — caught only because one `Contains` check
disagreed with an earlier one on the same string.

The gate asked *did the file change at the site I named*, which was the right question one
round earlier and is the wrong one here. The missing clause is the subject: **name the
absolute path in the gate, and print the path you actually wrote.** A relative path is a
claim about a working directory, and a working directory is exactly the kind of ambient
state that differs between the thing you are testing and the thing you are standing in.

Two failures in one probe, and the second is the more dangerous. The first run against that
worktree reported `pass 0, fail 1` and was nearly recorded as the mutation being caught —
it was a module resolution error, because a fresh worktree has no `node_modules`. **A
missing baseline turns any failure into a confirmation.** The control that fixes it is one
line and was skipped because the answer was the one already expected: run the unmutated
tree first and require it green. With the baseline in place the real answer came back
inverted from the reviewer's — 37 pass clean, 36 pass and 1 fail mutated, so the fix *had*
propagated and their claim was measured against a tree twenty-two commits old.

A sibling session, writing up the third level of this recursion, added that it would not
assume the pattern stopped there. It did not. The levels now run: the assertion, the
mutation that tests it, the gate that tests the mutation, and **the subject the gate is
silently addressing.** The remedy does not scale by adding a fifth checker — it is that
every level state, in its own output, the thing it operated on rather than the thing it
intended to.

**Four green gates, and not one of them type-checks the tests.** The integrator asked
whether `tsc -b` covers `tests/`, and it does not: `tsconfig.app.json` is
`"include": ["src"]`, `tsconfig.node.json` is `"include": ["vite.config.ts"]`, and the
runner strips types without checking them. Planting
`const plantedTypeError: number = 'this is a string'` at the top of this pass's main test
file passes **`tsc -b`, the suite, and `npm run build`** — three thousand lines of test
code that no tool has ever read for types.

Type-checking them found six real errors in this pass's own two files, and they are not
cosmetic:

- `plan.slotId` does not exist on `GeneratedEncounterPlan`, so the failure message for a
  blocked encounter spawn printed `seed/undefined/faction`. The assertion still fires — the
  array is non-empty either way — but the diagnostic naming *which* encounter broke was
  never there, in the test whose whole purpose is to name it.
- Two `BuildingSpec` fixtures omit `archetype` and `variant`. `buildingSpecKey` interpolates
  `spec.archetype` directly, so those tests exercise cache keys reading
  `building:forest:elf:undefined:...` — **a spec the product cannot produce.** The same
  vacuity as the ordering trap and the one-seed trap, arriving through the type system
  rather than through setup.
- Three callers passed `1` or `0` where an `as const` default had narrowed the parameter to
  the literal `0.35`, so the decoration-density tests were type-lying about the range they
  claimed to sweep.

The shape is the one this section keeps finding, at the level of the toolchain: **a gate
that reports on a smaller population than the reader assumes.** `tsc -b` exits 0 and the
natural reading is *"the project type-checks"*; the true statement is *"`src` type-checks"*.
Nobody wrote that down, and the gap is invisible precisely because the command is green and
its name says nothing about scope.

Worth pairing with the Markdown entry below, because they are the same hole in two file
types: the artefacts a build does not parse are the ones with no tests, whatever the suite
count says. Here the suite count was 294.

**A merge can keep a fix and drop the test that guards it, and the commit still reads as
merged.** Checking a coordinator's "everything of yours is in", this pass diffed its test
names against the integration branch and found three missing. `git merge-base --is-ancestor`
said the commit that added them **was** an ancestor — so nothing was un-merged; conflict
resolution had dropped the content while the history stayed intact. Ancestry is a claim
about commits, not about lines, and the two come apart exactly where someone resolved a
conflict by hand.

The one that mattered: `retentionIsIntact` was **byte-identical** in both trees, and the
test injecting a single phantom was absent from one. Measured rather than argued —
mutating the predicate to `return true`:

```
integration tree   38 pass / 0 fail   green, entirely unguarded
this branch        39 pass / 1 fail   "one phantom pin must be detected"
```

A correct, shipped fix with no power over its own regression, which is the shape this whole
section is about, arriving through version control rather than through test design. **The
strongest form of "is it merged?" is not ancestry and not a content grep — it is running
the mutation on their tree.**

Two method notes, both of which changed the finding:

- **The name diff produced one false finding out of three.** A receipt test also looked
  lost; the integration tree had replaced it with a better guard — `PROP_RECEIPT`,
  provenance before identity — with its own test. Reported as loss it would have been
  wrong, and the check that caught it was reading what the *other* tree had instead of
  only what it lacked.
- **"No test covers it" is a negative claim** and got a probe before it got asserted: the
  integration tree's four `phantom` mentions were three comments and one assertion message,
  and its count of `retained.push` — the injection itself — was zero. Even then the absence
  of a test is not the absence of coverage, which is why the mutation still had to be run.

**A negative claim has a shelf life; a positive one does not.** The programme lead added
this after carrying a stale absence across several messages, and it is the sharper half of
the negative-claim rule. Content is *added* to a live integration branch and essentially
never removed, so **a "presence" claim only becomes truer with time and an "absence" claim
only becomes falser.** They decay in opposite directions, which means a negative is not
established by one probe — on a moving branch it needs re-probing at the moment it is
restated, every time.

This pass then had to apply it to its own open finding. Having measured two of its tests
missing from the integration branch at one tip, the honest form of restating it was to
re-run the probe against the tip at the moment of writing — three tips later, and the
absence still held. **The version that makes this cheap is blob identity**: where
`git rev-parse <tip>:<path>` matches the tree a mutation was measured on, the measurement
carries exactly and needs no re-run; where it differs, nothing carries. That is the same
instrument that survived every other staleness question on this programme, used to decide
whether a *result* is still current rather than whether a file is.

The pairing with the earlier entry is the useful shape: **a negative claim needs a probe
more than a positive one, and it needs that probe again every time it is repeated.**

**When a claim cannot be verified by the party receiving it, the cost of being wrong rises
by an order of magnitude.** The reviewer produced the cleanest measurement of this
programme's whole coordination failure, and it is a split rather than a count. Every claim
about *code* was settled in one message, because the command that produced it could be run
by the receiver. Every claim about *the other party's tooling* took four or more, because
neither side could execute the other's evidence: a reflog position, a `--contains` reading,
a local ref resolution. Four wrong explanations were produced on this programme and **all
four were of that second kind.**

Which reframes the single largest process error here. This branch was unpushed for most of
the programme, and the visible cost looked like inconvenience — colleagues could still read
it through the shared object store. The real cost is this: it forced every statement about
this tree into the unverifiable class. *"Trust my account of my tip"* is not a claim anyone
can check, and it is the exact shape that took four rounds each. `git push -u` on the first
day is one command, and it does not merely publish a branch — **it moves every subsequent
claim about that branch out of the expensive category.**

The rule generalises past git: if a finding cannot be re-derived by the person receiving
it, expect it to cost an order of magnitude more to settle, and spend the effort on making
it checkable rather than on making it more convincing.

**Three agreeing checks from one family are one check.** The foundation session put the
sharpest form on the displacement-tearing result. This pass had three orientation
instruments — winding consistency, signed volume, and centroid-outwardness — deliberately
chosen because each is blind where the others see, and treated their agreement as strong
evidence. On a fully shattered geometry, every triangle detached, all three pass:

```
                    TORN          MENDED
signed volume       0.01988036    0.01953316    both positive
winding conflicts   0             0             both consistent
centroid inward     0/20          0/20          both pass
centroid weakest    0.935645      0.965799      both pass comfortably
```

They are three instruments for **orientation**, and a hole is a defect of **connectivity**.
Diversity within a family is not diversity. The agreement was never evidence about
connectivity, and the confidence it produced was the reason nobody looked for eleven
sessions.

The measurement carries a second sting: **the torn version reads 1.8% *higher* volume than
the mended one.** Tearing makes a shape measure bigger, not broken, so there is no threshold
anywhere that catches it — the failure is not weak detection, it is detection of the wrong
quantity. The remedy was a boundary-edge count, which is a connectivity instrument and found
82 torn geometries immediately.

Generalised, this is the rule to carry into any instrument suite: **before adding a fourth
check, ask what family the first three belong to.** A suite that is broad within one family
and empty outside it will report unanimous confidence about the thing it cannot see.

**And the discriminator for which shapes tear is the source's normals, not the shape's
name.** The same session measured `PolyhedronGeometry` at detail 0 producing faceted
normals — each corner copy moves differently under displacement, so the shape comes apart —
while detail 1 or higher produces radial normals shared by every copy, and is immune. So
*"rocks tear"* is the wrong rule and *"faceted source normals tear"* is the right one, which
also explains this catalogue's result without inspecting it: nothing here uses a polyhedron
primitive, but `mergeAll` seams and hard-crease lofts produce exactly the same signature —
coincident positions carrying different normals. **The property is measurable on any
geometry; the family name is not.**

**The last thing to re-measure is whatever both parties already agreed on.** The reviewer
produced this while declining credit for auditing its own suggestions, and the deflation is
the finding: it wasn't discipline, it was that **its own suggestions were the highest-yield
place left to look.** Once the obvious surfaces were covered, the untested claims in the
review were the ones already accepted — a fix it had proposed, a test it had praised, a
mutation it had reported.

The mechanism is general and unflattering: **agreement removes the pressure that produces
measurement.** Every party to an agreed claim believes someone else's scrutiny is what
settled it, and the person best placed to check is the one who least wants to. This is the
adopted-check entry above generalised past adoption — it does not require a hand-off at
all, only a conclusion both sides stopped arguing about. The evidence on this programme is
that the three worst vacuous checks were all in that state: the ledger identity praised and
propagated before anyone asked what it forbade, the phantom-pin guard with a reviewer's
reasoning and this pass's implementation and nobody's measurement, and a warm-up call
praised **by name** as rigour while being the exact half that made the test vacuous.

**And the recursion converges even though it does not terminate.** Four levels appeared
here — the assertion, the mutation that tests it, the gate that tests the mutation, and the
subject the gate silently addresses — which reads as an infinite regress and is not one,
because *each level is cheaper to check than the one below it*. The assertion needed a
probe; the mutation needed a two-line gate; the gate needed a line-number comparison; the
subject needed one printed absolute path. So "do not assume it stops" is not a counsel of
despair but an argument for keeping every level cheap enough that adding one more costs
almost nothing. **Both of the gates that failed on this programme failed by trying to be
clever at level three.**

**Two instruments disagreeing is worth more than either agreeing with itself — and the
reconciliation is usually a population, not an error.** The integrator could reproduce this
pass's geometry-disposal figure and not its `InstancedMesh` figure, and recorded the gap as
*unreconciled* rather than inventing a cause. That was the right call and it is what made
the cause findable. One flag explains it entirely:

```
                          geometry   InstancedMesh
outlineDressing: true        3099         2223
outlineDressing: false       3099         1644
difference                      0          579
```

Ink shells **are** `InstancedMesh` instances and they **share** their source's geometry — so
each one adds an instanced disposal and no geometry disposal. That is precisely why the two
counters behaved differently: geometry agreed because it is blind to ink, `InstancedMesh`
disagreed because it is not. Neither measurement was wrong; they were of different
configurations, and the difference *is* the ink population.

Two lessons, and the second is the uncomfortable one. **Refusing to explain a gap is what
preserves it long enough to be explained** — a plausible reason invented at the time would
have closed the item and buried a fact worth having. And this pass's own figure in that
exchange, 2861, **failed to reproduce on its own tree** when re-measured under the same
protocol. It was quoted from memory across several messages while the reconciliation work
happened on the other side. The rule the programme kept re-deriving applies to one's own
numbers first: *a figure without the command that produced it is a rumour that has been
formatted*, and the author is the last person who will notice.

**If the strict-equality form passes, the inequality beside it was never a test.** The
foundation session supplied this while closing a fourth instance of the derived-identity
defect, and it is stronger than the rule it improves. This spec already said *build the
state the assertion forbids and watch it fail; if you cannot construct that state, you have
a definition rather than a test.* That is a failure to falsify, and it leaves the hard cases
open — sometimes the forbidden state is genuinely awkward to construct and the assertion
survives on the benefit of the doubt.

The replacement is a **positive** test for entailment. Where an assertion claims an
inequality, assert the exact identity instead and run it:

```
assert.equal(probe.spans[index], -baseline.spans[index])   ->  GREEN, bit-exact
```

Reversal moves no vertex, so the bounding box and centre are unchanged and every triangle
determinant negates exactly. Strict float equality passing proves the inequality beside it
could not have failed — no construction required, one line, and it answers rather than
merely failing to refute.

**With the caution that matters more than the technique.** That session rewrote the entailed
assertion and documented it in the commit as **a readability fix, not hardening**, because
measurement showed both forms catch the blinded instrument and the reordered-spans mutation
identically. Removing an entailment improves what a reader infers from an assertion count
and improves detection **not at all**. Saying so explicitly is the same move as naming a
guard's blind spot in a test title, pointed at a commit message instead — without it the
next reader banks a guarantee nobody added.

The tally for this defect is at least five across three sessions in a single night, and
none of them was noticed while being written. Every one felt like rigour at the moment of
writing, which is the only thing they reliably have in common.

**A test name discriminates only for a test that never existed before, and the grep cannot
tell you which case you are in.** This spec records that a test's name is the nearest token
to a fix and therefore the worst probe — the integrator then tested its own discriminator
table against two earlier states of its own tree and found the rule biting harder than
written. Two of its five survivors were test names, and they held *only* because those
tests were new: no earlier body had worn the title. It had also renamed one rewritten test,
so a grep for the old name would have reported **present on both stale trees**.

So the rule needs its second clause: a test name is a valid discriminator exactly when the
test is new, that is invisible from the grep result, and **a rename converts a valid
discriminator into an invalid one without changing the mechanism at all.**

The same exercise struck one of its own five outright. `OUTLINE_WORLD_VISIBLE_DRAWS_MAX`
read **3 in both stale trees** — it is the constant the ink work is *about*, present since
the cap landed, so grepping for it reports a tree current when it may be six rounds behind.
Advice given about how to avoid that failure, containing that failure.

**And `--ours` / `--theirs` are file-scoped verbs answering a hunk-scoped question.** The
integrator hit a docs conflict displaying as one-sided — `<<<<<<< HEAD` immediately followed
by `=======` — which makes `--theirs` look obviously right. It is a whole-file operation:
it silently dropped a population column, a call-sites-versus-keys correction and a 102-key
measurement, producing 165 insertions against 83 deletions where the real change was 71
insertions and nothing removed. **The deletions it causes do not appear in the conflict you
are reading**, so the resolution looks correct at exactly the moment it is destroying work.
Caught only by grepping for its own markers *after* resolving, which is the general remedy:
after any whole-file resolution, probe for content you know should have survived.

This pass used `git checkout --ours` on the same file class during a merge experiment, in a
throwaway worktree where nothing could be lost. That it was harmless was luck of setting,
not judgement.

**A mutation that damages every element is the least discriminating one available.** The
foundation session drew this out of a sweep this pass ran across 248 merged hard surfaces,
and it retires a habit visible throughout this document. Reversing *all* faces maximises
exactly the signal an orientation instrument is built to detect, so surviving it certifies
only the case you already believed. **Every instrument survives its own best case.**

The informative mutations are partial, and *partial* has structure that must be chosen
rather than left to chance:

```
faces reversed   undetected
        10%       248 of 248   (100%)
        20%       244 of 248
        35%       222 of 248
        50%       118 of 248
```

Contiguous-block damage produced that curve. **Scattered damage at 10% would likely have
cancelled to nothing and reported the opposite** — so contiguous versus scattered, one part
of a merge versus one ring of a lathe, are not stylistic choices; they select which
blindness you are able to see. A single mutation shape is a single population, which is the
same defect as a single seed.

Which retires a second habit both sessions had: **reporting a mutation grade as RED or
GREEN.** The grade is a function of the damage model, and neither of us had been quoting the
damage model beside the grade — the same disease as quoting a number without its noun. A
survivor means *"this suite did not detect this damage shape at this magnitude"*, and every
clause is load-bearing.

**A stale number was correct once; a recalled number may never have been — and only the
first is fixed by re-measuring at send time.** The foundation session drew this after
correcting two of its own figures, both off by one, both from recall, and both inside the
paragraph where it was correcting this pass about stale numbers. Its tip and test count in
that same message were measured and right; the two *distances* were not, and a distance is
exactly the derived quantity that feels too small to check.

The programme-level result is stronger than any individual instance, and it holds across
all four sessions: **everyone who published a wrong number tonight measured correctly and
then re-used the result.** Not one was a bad measurement. This pass's withdrawn 2861 was
measured once and quoted from memory across several messages while the other party did the
reconciliation work; the same shape produced six stale SHAs, two wrong distances, a
`docs/08` census, a cache peak quoted under the wrong protocol, and a verification
instruction that inverted.

Which narrows the remedy considerably. The discipline is **not** "measure more carefully" —
the measuring was never the failure. It is **do not let a measured value survive into a
second sentence.** That is why citing the command rather than its output is the only form
that holds: a command re-derives, a number decays, and the decay is invisible because a
number carries no evidence of its own age.

It is also why every session on this programme kept failing at it *in the paragraph
recommending it*. The rule asks you to give up the one thing a measurement produces — an
answer you can now reuse — and reuse is what a measurement is for. Recording the failure
alongside the rule is the honest form, because the next reader will do it too.

**The artefact with no gate is the one you are proudest of.** This section spent the night
cataloguing checks that could not fail, and shipped for roughly three hours in a corrupted
state that no check could see. Ten lines were mangled — five entries whose opening sentence
had been duplicated as an orphan above the rule and simultaneously jammed into the body with
its newline deleted, producing text reading `survivedso long` and `the programme
leadidentified`. It was committed, pushed, reviewed by two sessions, merged by the
integrator, and quoted back approvingly, and nobody saw it. Including its author, who
described it in three separate messages as the programme's most durable output.

The mechanism is mundane: every edit that inserted a new rule *before* an existing one
anchored on that rule's bold header, and the replacement decapitated it. The identical
mistake was then made a sixth time, live, while writing the entry above this one — and was
caught only because a structural `grep` happened to run afterwards.

But the reason it survived is the point. Four gates ran on every one of those commits —
`tsc -b`, `oxlint`, 292 tests, `npm run build` — and **not one of them reads Markdown.**
The prose was the only shipped artefact with no automated reader at all, which is precisely
why it rotted, and precisely why the rot was invisible: the humans reading it were reading
for argument, and an argument survives a missing newline. **A file no tool parses has no
tests, whatever else you have.** The cheap remedy is structural, not stylistic, and would
have caught all ten: no line begins with a space, no `**Header` appears mid-sentence, every
rule has a blank line above it.

The corollary is worse than the instance. The confidence attached to this file was inverted
against its coverage — it was the least-verified artefact in the programme *and* the one
most often cited as authoritative, and those two facts were causally connected. Nothing here
had to survive a machine, so nothing here was measured, and the absence of red never once
read as absence of testing.

**Last, and it is why the rest of this section exists: the review worked better than the
accuracy of anyone in it.** The final tally across the two review sessions was roughly one
wrong call per three good ones, in both directions — this pass made two incorrect diagnoses
of a reviewer's tooling and propagated one of them upward; the reviewer produced three false
positives, including a mutation broken by line endings that reported SURVIVED. Neither side
was reliable on its own.

What made that workable was not care, and it was not expertise. **Every claim on both sides
arrived with the command that produced it**, so the wrong ones were cheap to overturn —
usually within one message, and usually by the person who had not made them. Nothing here
was caught by someone being right; it was caught by claims being *checkable* by someone
else, quickly, without asking permission or re-deriving the context.

The counterfactual is the point, and it is the reviewer's phrasing: **a review where both
sides had been merely confident would have gone differently on identical facts.** Every
defect in the table above was found by a measurement someone could re-run, and every wrong
diagnosis died the same way. A catalogue of checks that could not fail is only possible in a
process where checking is cheaper than arguing — so if one practice from this document
survives into another programme, it should be that one, and the rules are downstream of it.

### 13.1 Open at hand-off

One item, and it is coverage rather than a defect. It is recorded here because a session
ends and a measurement should not end with it.

**The integration branch carries `retentionIsIntact` byte-identical to this branch's copy,
and does not carry the test that proves it can return `false`.** Measured on the PR head
`d6cddc6` in a fresh worktree, with a baseline first:

```
BASELINE                            342 pass / 0 fail
retentionIsIntact -> return true    342 pass / 0 fail
same mutation on this branch         39 pass /  1 fail
```

The integration branch does assert `assert.ok(runtime.retentionIsIntact, …)` across 75
region loads, and that is real coverage — **of the system.** A phantom arising naturally
during those loads is caught. What it cannot cover is **the instrument**: it consumes the
predicate's output and never constructs a state where that output should be false, so
replacing the predicate with `return true` satisfies it 342 times.

The distinction is the whole of §13 in one line: *that assertion tests the world; the
missing one tests the thermometer.* The content probe is `retained.push` — the phantom
injection itself — which is **0** there and 1 here, and it is a content probe rather than a
SHA comparison for the reason given in §6: the integrator applies work by patch, so
ancestry proves containment when true and nothing when false.

It matters because this is the exact regression that already happened once. The predicate's
predecessor compared `propCacheSize >= retainedPropCount`, which reduces to `B >= P` and
stayed green until **29 simultaneous phantoms** — blind across the entire range a real bug
produces. Nothing on the integration branch would notice it being weakened back.

Two tests restore it, both in `tests/worldArt.test.ts` on this branch and both free of
dependencies beyond `WorldPropLibrary`: `the phantom-pin check detects a single phantom,
not thirty`, and `the world-objects spec has no mangled paragraph joins`. **After restoring
either, re-run the mutation rather than trusting the restore** — the entire finding is that
a present fix and a present-looking test are different things, which makes the author of
this note the worst available source for *"it is covered now."*


## 14. Effort

**2.5-3 days.** The vocabulary is mechanical. The time went into composition that
reads as places rather than as prop soup, into the cache lifetime being provably
balanced across streaming, into finding the winding defect — which took a headless
capture, a tinted ink hull and a triangle-by-triangle audit — and into getting the
streaming cost back down after the first honest measurement showed it had doubled.
