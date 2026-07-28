/**
 * Wave 4 integration tests.
 *
 * These exist because of a class of defect that neither Wave 2 session could have
 * caught alone and that neither one's suite goes red on: two independently correct
 * changes whose *interaction* is wrong. The programme hit that twice before this
 * merge, so the three-way merge gets its own tests rather than a green run of the
 * three suites concatenated.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'

import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import {
  GeneratedWorldRuntime,
  OUTLINE_WORLD_DRAWS_MAX,
  OUTLINE_WORLD_VISIBLE_DRAWS_MAX,
} from '../src/game/world/GeneratedWorldRuntime.ts'
import { StylizedArtLibrary, ensureVertexColors, mergeAll } from '../src/game/art/index.ts'

const RUNTIME_OPTIONS = {
  terrainResolution: 6,
  decorationDensity: 1,
  outlineDressing: true,
} as const

function createRuntime(seed: string) {
  const scene = new THREE.Scene()
  const blueprint = generateWorld(seed)
  const runtime = new GeneratedWorldRuntime(scene, blueprint, RUNTIME_OPTIONS as never)
  return { scene, blueprint, runtime }
}

/**
 * Ink shells that can draw in the same frame. An LOD renders exactly one level, so a
 * building is billed for its worst level rather than the sum of all of them — the same
 * accounting `tests/worldArt.test.ts` uses for the per-region budget, so the two
 * numbers are directly comparable.
 */
function simultaneousInkDraws(object: THREE.Object3D): number {
  if (object instanceof THREE.LOD) {
    let worst = 0
    for (const level of object.levels) {
      worst = Math.max(worst, simultaneousInkDraws(level.object))
    }
    return worst
  }
  let total = StylizedArtLibrary.isOutlineShell(object) ? 1 : 0
  for (const child of object.children) total += simultaneousInkDraws(child)
  return total
}

/**
 * The ink budget is written per visible region and enforced per visible region, but a
 * frame pays the SUM. `visibleRadius` is 1 and `RegionManager` selects with Chebyshev
 * distance, so nine regions are visible at once and the structural worst case is
 * 9 x 8 = 72 simultaneous ink draws behind a spec whose only number is 8.
 *
 * Nothing was wrong with either half — the per-region counter does exactly what it
 * says. The gap is that no one number described what the frame actually submits.
 *
 * Mutation-verified: lowering `OUTLINE_WORLD_VISIBLE_DRAWS_MAX` to 20 turns this red
 * and reports `focus region-1-0 draws 24 ink shells across 6 visible regions`, so the
 * failure names the position, the sum and how many regions paid it.
 *
 * Wave 4 review: the budget was measured over ten seeds and enforced over one, and the
 * seed under test was not the worst. Re-measured over twelve seeds and 300 focus
 * positions:
 *
 * ```text
 * seed              visible-set peak    seed              visible-set peak
 * integration-ink         41            seed-d                  41
 * integration-white       41            seed-e                  43
 * коровaны                43            wave4-1                 40
 * seed-a                  39            wave4-2                 41
 * seed-b                  41            wave4-3                 42
 * seed-c                  40            wave4-4                 43
 * ```
 *
 * Overall peak 43, mean 27.42, per-region peak exactly 8 — so 48 is a real ceiling at
 * 1.116x the worst observed, well under the structural 9 x 8 = 72, and the per-region
 * counter is fully spent and never exceeded. `integration-ink` peaks at 41, seven short
 * of the budget, so it alone would not notice a world that got 5% inkier. `коровaны` is
 * added as a second seed because it is one of the three that reach the true peak; two
 * seeds cost about 1.6s and close the gap between what was measured and what is pinned.
 */
test('the whole visible set has an ink budget, not just each region in it', () => {
  let samples = 0
  let fullVisibleSets = 0
  let visibleSetPeak = 0
  let perRegionPeak = 0
  let regionsClassified = 0
  let seedsSwept = 0

  // 'коровaны' is one of the three seeds that reach the measured peak of 43, so the
  // pair spans the range rather than sampling the middle of it twice.
  for (const seed of ['integration-ink', 'коровaны']) {
    const { scene, blueprint, runtime } = createRuntime(seed)
    seedsSwept += 1
    let seedSamples = 0

    for (const region of blueprint.regions) {
      const center = runtime.getRegionCenter(region.id)
      assert.ok(center, `no center for ${String(region.id)}`)
      runtime.update({ deltaSeconds: 0, focus: center })

      let visibleSet = 0
      let roots = 0
      for (const root of scene.children) {
        if (root.userData.generatedWorldRegionId === undefined) continue
        roots += 1
        regionsClassified += 1
        const ink = simultaneousInkDraws(root)
        perRegionPeak = Math.max(perRegionPeak, ink)
        visibleSet += ink
        assert.ok(
          ink <= OUTLINE_WORLD_DRAWS_MAX,
          `region ${String(root.userData.generatedWorldRegionId)} spent ${String(ink)} `
          + `ink draws, per-region budget is ${String(OUTLINE_WORLD_DRAWS_MAX)}`,
        )
      }
      if (roots === 9) fullVisibleSets += 1
      visibleSetPeak = Math.max(visibleSetPeak, visibleSet)
      samples += 1
      seedSamples += 1

      assert.ok(
        visibleSet <= OUTLINE_WORLD_VISIBLE_DRAWS_MAX,
        `seed ${seed}, focus ${String(region.id)} draws ${String(visibleSet)} ink shells `
        + `across ${String(roots)} visible regions; the visible-set budget is `
        + `${String(OUTLINE_WORLD_VISIBLE_DRAWS_MAX)}. Per-region spend is still inside `
        + `${String(OUTLINE_WORLD_DRAWS_MAX)}, so raising the per-region number is not `
        + 'the fix — the frame pays the sum.',
      )
    }
    assert.equal(
      seedSamples,
      blueprint.regions.length,
      `the sweep did not visit every region of ${seed}`,
    )
    runtime.dispose()
  }

  // Domain guards. Every quiet failure on this programme was an assertion measuring
  // nothing and reporting green, so pin what was actually classified.
  assert.equal(seedsSwept, 2, 'both seeds must be swept, or the range is one point wide')
  assert.ok(samples >= 50, `only ${String(samples)} focus positions were sampled`)
  assert.ok(
    regionsClassified >= 300,
    `classified only ${String(regionsClassified)} region roots across ${String(samples)} focuses`,
  )
  assert.ok(
    fullVisibleSets > 0,
    'no focus position ever had the full 3x3 visible set, so the multiplier this test '
    + 'exists to bound was never exercised',
  )
  // And the sum has to be genuinely bigger than the per-region figure, or this test
  // would keep passing on a tree that draws no world ink at all — which is exactly
  // what `main` is, and `main` must not be able to satisfy this.
  assert.ok(
    visibleSetPeak > OUTLINE_WORLD_DRAWS_MAX,
    `the visible-set peak was ${String(visibleSetPeak)}, no larger than one region's `
    + 'budget; either the world stopped drawing ink or the sum is not being summed',
  )
  assert.ok(
    perRegionPeak >= 5,
    `the busiest single region spent only ${String(perRegionPeak)} of `
    + `${String(OUTLINE_WORLD_DRAWS_MAX)} ink draws`,
  )
  // The pair has to actually reach the figure the budget was sized from, or widening
  // the seed domain bought coverage on paper and nothing in practice. Measured 43 over
  // twelve seeds, 43 over this pair; 40 leaves room for placement to drift a little
  // without pretending the peak is still being observed.
  assert.ok(
    visibleSetPeak >= 40,
    `the two seeds peaked at ${String(visibleSetPeak)}, short of the 43 the budget was `
    + 'sized from — they are no longer sampling the busy end of the range, so 48 is '
    + 'being checked against a case that never approaches it',
  )
})

/**
 * `mergeAll` synthesises WHITE vertex colours for inputs that lack them, and only when
 * at least one input has them. Uniform presence is fine and uniform absence is fine;
 * a MIXED list is what renders as blown-out geometry in a game with no textures.
 *
 * Before this merge the two kits could not mix: `PropKit` geometry is vertex-coloured
 * and `CharacterKit` geometry is not, and they lived on branches that never saw each
 * other. They are now in one tree behind one barrel, so this is a live hazard rather
 * than a hypothetical one, and it is invisible to both Wave 2 suites — each is right
 * about its own kit.
 *
 * S3's pre-merge baseline was 476 merged surfaces, 0 missing a `color` attribute, 0
 * fully white. This re-runs the same question against the assembled world.
 *
 * ## It used to ask the wrong question, and the mutation record is why that survived
 *
 * The first version asked `isFullyWhite` — is EVERY vertex white? Wave 4 review
 * measured what a mixed list actually produces, and it is not that. `mergeAll` writes
 * white into **only the inputs that lack a colour**, so the merged buffer is white in
 * proportion to how much of the list was uncoloured:
 *
 * ```text
 * one CharacterKit part + one PropKit part      50.0% of vertices white
 * one CharacterKit part + three PropKit parts   25.0% of vertices white
 * ```
 *
 * `isFullyWhite` returns **false** for both. The assertion could not see the single
 * defect its own docblock named. It was mutation-verified — and the mutation that
 * verified it (whitening every geometry on the way out of `mergeAll`, which turned it
 * red at 62 of 126) is a *uniform* fault, so it exercised the one shape the check
 * could detect and said nothing about the shape it was written for. Proving a detector
 * can fail is not the same as proving it can fail on the defect you care about.
 *
 * It now counts white **vertices**, which is the quantity that varies with the fault.
 *
 * Re-verified head to head. With `mergeAll` mutated to whiten the first half of every
 * merged colour buffer — a partial fault of exactly the shape a mixed list produces —
 * over the same 126 judged geometries:
 *
 * ```text
 * old check (isFullyWhite)   0 offenders   PASSES GREEN
 * new check (any white)     92 offenders   red: 52,989 white vertices, worst 75.0%
 * ```
 *
 * ## Where the threshold comes from
 *
 * Measured on the assembled world across five seeds — `integration-white`, `коровaны`,
 * `seed-a`, `seed-c`, `wave4-4` — 616 distinct vertex-coloured geometries in total:
 * **not one white vertex anywhere**, worst share 0.0000%. There is no legitimate white
 * in this game's world art to accommodate, so the threshold is a true zero and the
 * separation from the smallest realistic accident is the full 25%.
 *
 * Both directions still matter, so both are still asserted: the scan has to judge a
 * real population (>= 100 geometries, measured 121-126 per seed), and it has to be
 * capable of reporting a non-zero (the planted mix below reads 50%).
 */
test('nothing in the assembled world renders as blown-out white', () => {
  const { scene, blueprint, runtime } = createRuntime('integration-white')

  const judged = new Set<THREE.BufferGeometry>()
  let vertexColoured = 0
  let missingColour = 0
  let anyWhite = 0
  let worstShare = 0
  let whiteVertices = 0
  let judgedVertices = 0
  const offenders: string[] = []

  /**
   * The share of a buffer's vertices that are white, which is what a mixed merge
   * produces. `mergeAll` whitens only the parts that arrived without a colour, so the
   * fault is a *fraction*, never the whole buffer — asking whether every vertex is
   * white is asking a question the defect never answers yes to.
   */
  const whiteShare = (
    attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  ): number => {
    let white = 0
    for (let index = 0; index < attribute.count; index += 1) {
      if (
        attribute.getX(index) >= 0.999
        && attribute.getY(index) >= 0.999
        && attribute.getZ(index) >= 0.999
      ) white += 1
    }
    return white / attribute.count
  }

  for (const region of blueprint.regions) {
    const center = runtime.getRegionCenter(region.id)
    assert.ok(center)
    runtime.update({ deltaSeconds: 0, focus: center })

    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      if (judged.has(object.geometry)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      const usesVertexColours = materials.some(
        (material) => (material as THREE.Material & { vertexColors?: boolean }).vertexColors === true,
      )
      if (!usesVertexColours) return
      judged.add(object.geometry)
      vertexColoured += 1
      const colour = object.geometry.getAttribute('color')
      if (!colour) {
        missingColour += 1
        offenders.push(`${object.name || object.type}: no color attribute`)
        return
      }
      judgedVertices += colour.count
      const share = whiteShare(colour)
      if (share > worstShare) worstShare = share
      if (share > 0) {
        anyWhite += 1
        whiteVertices += Math.round(share * colour.count)
        offenders.push(
          `${object.name || object.type}: ${(share * 100).toFixed(1)}% of `
          + `${String(colour.count)} vertices are white`,
        )
      }
    })
  }

  // Domain guard first: a clean bill over an empty population is the failure mode
  // this whole class of test keeps walking into. Geometries are deduplicated, because
  // the prop cache hands the same buffer to many meshes and counting instances would
  // inflate this into meaninglessness. Measured across five seeds: 121-126 geometries,
  // 'integration-white' being the 126.
  assert.ok(
    vertexColoured >= 100,
    `only ${String(vertexColoured)} distinct vertex-coloured geometries were judged; the `
    + 'scan found too little of the world to mean anything',
  )
  // Second domain guard, on the finer unit. The share above is per vertex, so a
  // population of 126 geometries that between them held almost no vertices would give
  // this test nothing to be right about. Measured: 129,024 on this seed.
  assert.ok(
    judgedVertices >= 20000,
    `the ${String(vertexColoured)} judged geometries hold only ${String(judgedVertices)} `
    + 'vertices between them, which is too few for a share to mean anything',
  )
  assert.deepEqual(
    offenders.slice(0, 10),
    [],
    `${String(missingColour)} vertex-coloured geometries have no color attribute, and `
    + `${String(anyWhite)} of ${String(vertexColoured)} judged carry white vertices `
    + `(${String(whiteVertices)} vertices, worst geometry ${(worstShare * 100).toFixed(1)}%). `
    + '`mergeAll` writes white for inputs that lack a color when any sibling input has '
    + 'one, so the usual cause is a list mixing a PropKit part with a CharacterKit part. '
    + 'That produces a PARTLY white buffer — 50% for a two-part list, 25% for one in '
    + 'four — never a fully white one, which is why this counts vertices.',
  )

  // The detector has to be able to report a non-zero, or "0 white vertices" is
  // indistinguishable from "this function always returns 0". Build the exact mixed
  // list the message above describes and require the measure to see it. This is the
  // half the original mutation record did not cover: it proved the check could fail
  // on a *uniform* whitening, which is not the fault the test exists for.
  const mixed = mergeAll(
    [
      ensureVertexColors(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), 0x2a5c3a),
      new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
    ],
    { name: 'planted-mix' },
  )
  const plantedShare = whiteShare(mixed.getAttribute('color'))
  assert.ok(
    Math.abs(plantedShare - 0.5) < 1e-9,
    `a one-coloured, one-uncoloured merge measured ${(plantedShare * 100).toFixed(1)}% `
    + 'white, not the 50% that is arithmetically certain — the measure is not reading '
    + 'what it claims to read',
  )
  mixed.dispose()

  runtime.dispose()
})

/**
 * The two kits must keep their vertex-colour conventions uniform *within* a kit, which
 * is what makes a mixed `mergeAll` list impossible rather than merely unobserved.
 *
 * This is the invariant the test above depends on. Asserting only the outcome would
 * leave it holding by luck: if `CharacterKit` started emitting colours on some parts
 * and not others, the world would still look right until the first list that mixed
 * them, and the previous test would still pass.
 *
 * Mutation-verified: adding `ensureVertexColors` to `CharacterKit`'s `finish()` — a
 * one-line change a future pass could plausibly make — turns this red immediately,
 * while both tests above stay green. That gap between them is the point.
 */
test('each art kit is uniform about vertex colours, so a merge can never mix them', async () => {
  const character = await import('../src/game/art/CharacterKit.ts')
  const { WorldPropLibrary } = await import('../src/game/world/WorldPropLibrary.ts')

  const plans: THREE.BufferGeometry[] = []
  for (const faction of ['elf', 'guard', 'villain'] as const) {
    for (const role of ['soldier', 'archer', 'captain', 'villager', 'captive'] as const) {
      for (let variant = 0; variant < 3; variant += 1) {
        const plan = character.resolveCharacterPlan(faction, role, variant)
        plans.push(character.buildTorso(plan))
        plans.push(character.buildHead(plan.faction))
        plans.push(character.buildThigh(plan.faction, plan.armour, plan.proportions.thigh))
      }
    }
  }
  for (const beast of ['wolf', 'boar', 'bear', 'troll'] as const) {
    plans.push(character.buildBeastBody(beast))
    plans.push(character.buildBeastHead(beast))
  }
  plans.push(character.buildOxBody(), character.buildWagonBed(), character.buildWagonTilt())

  assert.ok(plans.length >= 50, `only built ${String(plans.length)} character parts`)
  const colouredCharacterParts = plans.filter((geometry) => geometry.getAttribute('color'))
  assert.equal(
    colouredCharacterParts.length,
    0,
    `${String(colouredCharacterParts.length)} of ${String(plans.length)} CharacterKit parts `
    + 'carry vertex colours. CharacterKit is coloured by material, PropKit by vertex, and '
    + '`mergeAll` writes WHITE into whichever inputs lack colours when any input has them. '
    + 'A kit that is half-and-half turns every mixed merge into blown-out geometry.',
  )
  for (const geometry of plans) geometry.dispose()

  // Six requests was a sample, not a sweep. The full request space is checked by
  // `every prop the game can ask for comes back coloured, and none of it white` below.
  const library = new WorldPropLibrary({ retention: 0 })
  const asset = library.acquire({ kind: 'tree', biome: 'forest', slot: 0, detail: 'near' } as never)
  assert.ok(
    asset.surfaces.length > 0 && asset.surfaces.every((surface) => surface.geometry.getAttribute('color')),
    'a PropKit surface arrived without vertex colours, which is the other half of the hazard',
  )
  library.release(asset)
  library.dispose()
})

/**
 * S3's white-vertex-colour sweep, re-run on the merged tree, through `acquire`.
 *
 * `mergeAll` synthesises WHITE vertex colours for inputs that lack them, and only when
 * some sibling input has them. In a zero-texture, vertex-coloured game that renders as
 * blown-out geometry. Nothing asserted against it before this: the existing prop-colour
 * test checks that a `color` attribute EXISTS, has the right count and is finite, all
 * of which a synthesised white attribute satisfies perfectly.
 *
 * Baseline on S3's branch before the merge: **476 merged surfaces, 0 missing a colour
 * attribute, 0 fully white**. This tree reproduces it exactly, at 352 requests, and
 * tightens it: **0 white vertices out of 351,636**.
 *
 * The tightening was forced by a mutation. Asking "is this surface entirely white"
 * missed a planted bare part completely, because `mergeAll` whitens only the inputs
 * that lacked colours — so a multi-part building comes back *partly* white, which is a
 * blown-out patch on an otherwise correct mesh and is exactly the shipping defect. The
 * surface-level question was an instrument answering something adjacent to what was
 * being asked. Counting vertices catches it, and needs no tolerance, because the art
 * emits no pure white of its own.
 *
 * The same mutation, before and after:
 *
 *     asking "is the whole surface white"   PASSED CLEAN      <- could not see it
 *     counting white vertices               155,904 white across 84 of 476 surfaces
 *
 * Detector proven before its zero is trusted, because absence of a pattern is not
 * absence of the behaviour — a working detector reporting zero is:
 *
 *     mixed merge (one coloured input, one bare)   36 of 72 vertices white  DETECTED
 *     planted all-white geometry                   fully white: true        DETECTED
 *     the coloured control                         fully white: false       correctly NOT
 *
 * The third line is the one that matters most. A checker that called everything white
 * would also report zero problems if the sense were inverted, so the discriminating
 * assertion is that a correct control reads exactly not-white.
 */
test('every prop the game can ask for comes back coloured, and none of it white', async () => {
  const { WorldPropLibrary } = await import('../src/game/world/WorldPropLibrary.ts')

  const isFullyWhite = (
    attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  ): boolean => countWhiteVertices(attribute) === attribute.count

  /**
   * Counts vertices at exactly white.
   *
   * Surface granularity is the wrong instrument, and a mutation proved it: planting one
   * uncoloured part into a multi-part merge makes `mergeAll` whiten **that part only**,
   * so the merged surface is partly white and "is the whole surface white" answers no.
   * The game renders that as a blown-out patch on an otherwise correct building. The
   * question has to be asked per vertex, which is where the defect actually lives.
   *
   * No tolerance is needed and none is used: measured across the whole request space,
   * this tree has **0 white vertices out of 351,636**. Not a threshold chosen to pass —
   * a floor the art never touches, because a stylized palette has no reason to emit
   * pure white and `mergeAll`'s synthesized fill is the only thing that does.
   */
  const countWhiteVertices = (
    attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  ): number => {
    let white = 0
    for (let index = 0; index < attribute.count; index += 1) {
      if (
        attribute.getX(index) >= 0.999
        && attribute.getY(index) >= 0.999
        && attribute.getZ(index) >= 0.999
      ) white += 1
    }
    return white
  }

  // --- controls, before the sweep ---
  const coloured = ensureVertexColors(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), 0x884422)
  const bare = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()
  const mixed = mergeAll([coloured.clone(), bare], { name: 'control-mixed' })
  const mixedColour = mixed.getAttribute('color')
  // Uses the same counter the sweep uses, so the control validates the instrument
  // rather than a second implementation of it that could drift from the real one.
  const controlWhite = countWhiteVertices(mixedColour)
  assert.equal(
    controlWhite,
    mixedColour.count / 2,
    `mergeAll should whiten exactly the uncoloured half of a mixed list; it whitened `
    + `${String(controlWhite)} of ${String(mixedColour.count)}. If this is 0 the hazard `
    + 'this test exists for has changed shape and the sweep below proves nothing.',
  )
  const planted = ensureVertexColors(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), 0xffffff)
  assert.equal(isFullyWhite(planted.getAttribute('color')), true, 'the detector cannot see white')
  assert.equal(
    isFullyWhite(coloured.getAttribute('color')),
    false,
    'the detector calls a correctly coloured control white, so its zeroes mean nothing',
  )
  mixed.dispose()
  planted.dispose()
  coloured.dispose()

  // --- the sweep ---
  const BIOMES = ['neutral', 'palace', 'forest', 'fort'] as const
  const DETAILS = ['near', 'far'] as const
  const COVERS = ['fern', 'flower', 'grass', 'pebble'] as const
  const TERRITORIES = ['elf', 'guard', 'villain', 'neutral'] as const
  const FENCE_STYLES = ['rail', 'palisade', 'picket', 'iron', 'curtain'] as const
  const SITE_PROPS = [
    'banner', 'barrel', 'brazier', 'cairn', 'cart', 'chest', 'crate', 'gate',
    'lantern', 'monument', 'obelisk', 'pillar', 'shrine', 'signboard', 'stall',
    'tent', 'tower', 'washing-line', 'waystone', 'well', 'woodpile',
  ] as const
  const ROOFS = ['thatch', 'shingle', 'tile', 'flat', 'conical'] as const
  const WALLS = ['timber-frame', 'log', 'stone', 'plank'] as const

  const requests: { label: string; request: unknown }[] = []
  for (const biome of BIOMES) {
    for (let slot = 0; slot < 3; slot += 1) {
      for (const detail of DETAILS) {
        requests.push({ label: `tree/${biome}/${String(slot)}/${detail}`, request: { kind: 'tree', biome, slot, detail } })
        requests.push({ label: `rock/${biome}/${String(slot)}/${detail}`, request: { kind: 'rock', biome, slot, detail } })
      }
      requests.push({ label: `undergrowth/${biome}/${String(slot)}`, request: { kind: 'undergrowth', biome, slot } })
    }
    requests.push({ label: `reeds/${biome}`, request: { kind: 'reeds', biome } })
    for (const cover of COVERS) {
      requests.push({ label: `ground/${biome}/${cover}`, request: { kind: 'groundCover', biome, cover } })
    }
    for (const detail of DETAILS) {
      requests.push({
        label: `bridge/${biome}/${detail}`,
        request: { kind: 'bridge', biome, owner: 'neutral', span: 9, width: 4, detail },
      })
    }
  }
  for (const owner of TERRITORIES) {
    for (const style of FENCE_STYLES) {
      requests.push({ label: `fence/${style}/${owner}`, request: { kind: 'fence', style, biome: 'forest', owner, length: 6 } })
    }
    for (const prop of SITE_PROPS) {
      requests.push({
        label: `siteProp/${prop}/${owner}`,
        request: { kind: 'siteProp', prop, biome: 'forest', owner, variant: 0, length: 4 },
      })
    }
    for (const roofStyle of ROOFS) {
      for (const wallStyle of WALLS) {
        for (const detail of DETAILS) {
          requests.push({
            label: `building/${roofStyle}/${wallStyle}/${owner}/${detail}`,
            request: {
              kind: 'building',
              biome: 'forest',
              owner,
              detail,
              spec: {
                width: 5, depth: 4, wallHeight: 3, storeys: 1,
                wallStyle, roofStyle, windows: 2, chimney: true,
                porch: true, balcony: false, crenellated: false,
              },
            },
          })
        }
      }
    }
  }

  const library = new WorldPropLibrary({ retention: 0 })
  let surfaces = 0
  let vertices = 0
  let whiteVertices = 0
  const offenders: string[] = []
  for (const { label, request } of requests) {
    const acquired = library.acquire(request as never)
    for (const surface of acquired.surfaces) {
      surfaces += 1
      const colour = surface.geometry.getAttribute('color')
      const position = surface.geometry.getAttribute('position')
      if (!colour) {
        offenders.push(`${label}#${String(surface.surface)}: no colour attribute`)
        continue
      }
      if (colour.count !== position.count) {
        offenders.push(`${label}#${String(surface.surface)}: colour count mismatch`)
      }
      vertices += colour.count
      const white = countWhiteVertices(colour)
      if (white > 0) {
        whiteVertices += white
        offenders.push(
          `${label}#${String(surface.surface)}: ${String(white)} of ${String(colour.count)} vertices are white`,
        )
      }
    }
    library.release(acquired)
  }

  // The population is pinned in every direction it can shrink in. A sweep that quietly
  // stopped enumerating, or one judging surfaces that had lost their vertices, would
  // report zero offenders and look identical to a clean run.
  assert.equal(
    requests.length,
    352,
    `the request space is ${String(requests.length)} requests, pinned at 352 — add the new `
    + 'kind here and to the count together',
  )
  assert.ok(
    surfaces >= 476,
    `only ${String(surfaces)} merged surfaces were judged; S3's pre-merge baseline was 476, `
    + 'so the enumeration has shrunk and this is measuring less than it did',
  )
  assert.ok(
    vertices >= 350_000,
    `only ${String(vertices)} vertices were examined, against 351,636 measured on this tree`,
  )
  assert.deepEqual(
    offenders.slice(0, 10),
    [],
    `${String(whiteVertices)} white vertices across ${String(offenders.length)} of `
    + `${String(surfaces)} merged surfaces. \`mergeAll\` writes WHITE into inputs that lack `
    + 'colours when any sibling input has them, so the usual cause is a parts list that '
    + 'mixes a coloured builder with a bare one — and it whitens only that part, which is '
    + 'why this counts vertices rather than asking whether a whole surface went white.',
  )
  library.dispose()
})

/**
 * `mergePropParts` must not change the orientation of anything it merges.
 *
 * This closes a gap the PM aimed Wave 4 at, and the gap is real: **a sub-part reversed
 * inside a larger merged prop is invisible to both instruments this suite already
 * carries.** Verified by planting exactly that defect — reversing one whole part's
 * winding inside `mergePropParts`, every attribute swapped in step the way the kit's own
 * `reverseWinding` does it — and running all 301 tests:
 *
 *     every prop the world can build is oriented outwards          PASSED
 *     every prop winds its triangles to agree with its normals     PASSED
 *
 * Signed volume is absolute but it is a **sum**: one reversed part cancels against the
 * correct ones and a building still reads +97. Normal agreement is **relative**: a
 * reversal that swaps normals in step with positions stays perfectly self-consistent, so
 * it goes quiet exactly when it matters. Only the sensitivity meta-test noticed, and its
 * message is about its own control rather than about the defect.
 *
 * This asks a different question, and one neither of those can be rephrased into:
 * **does the merge output still contain the same faces, pointing the same way, as the
 * parts that went into it?** Face normals come from winding alone, so this reads no
 * stored normals and does not care whether a prop is closed, convex, or a flat fern
 * frond. It needs no exception list for open shapes for the same reason.
 *
 * Mutation-verified: with the planted reversal this reports the offending prop and
 * surface by name, and how many faces changed direction.
 */
test('merging parts into a prop never turns any of them around', async () => {
  const prop = await import('../src/game/art/PropKit.ts')
  const { artVariation } = await import('../src/game/art/index.ts')

  /** Quantized geometric face normals, from winding alone. Reads no stored normals. */
  const faceDirections = (geometries: readonly THREE.BufferGeometry[]): string[] => {
    const out: string[] = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const normal = new THREE.Vector3()
    for (const geometry of geometries) {
      const position = geometry.getAttribute('position')
      const index = geometry.getIndex()
      const count = index ? index.count : position.count
      for (let triangle = 0; triangle + 2 < count; triangle += 3) {
        const i0 = index ? index.getX(triangle) : triangle
        const i1 = index ? index.getX(triangle + 1) : triangle + 1
        const i2 = index ? index.getX(triangle + 2) : triangle + 2
        a.fromBufferAttribute(position, i0)
        b.fromBufferAttribute(position, i1)
        c.fromBufferAttribute(position, i2)
        normal.crossVectors(b.sub(a), c.sub(a))
        if (normal.lengthSq() < 1e-16) continue
        normal.normalize()
        out.push(
          `${Math.round(normal.x * 512)},${Math.round(normal.y * 512)},${Math.round(normal.z * 512)}`,
        )
      }
    }
    return out.sort()
  }

  const BUILDING_PALETTE = {
    foundation: 0x6c6f74, wall: 0xd6c7a4, wallShade: 0x8d8262, timber: 0x6a4a2f,
    roof: 0x8a5a3a, roofShade: 0x4a2f1e, roofRidge: 0x5a4030, trim: 0xa08560,
    door: 0x5e3d26, glass: 0x18202a, glow: 0xffc46a,
  }
  const PROP_PALETTE = {
    timber: 0x8a6a44, timberShade: 0x4a3524, stone: 0x9aa0a8, stoneShade: 0x4b5158,
    metal: 0x7d8590, cloth: 0xb4462f, clothAccent: 0xe0c78a, glow: 0xffc46a,
    accent: 0xc48742,
  }

  const cases: { label: string; parts: readonly { surface: string; geometry: THREE.BufferGeometry }[] }[] = []
  for (const wallStyle of ['timber-frame', 'log', 'stone', 'plank'] as const) {
    for (const roofStyle of ['thatch', 'shingle', 'tile', 'flat', 'conical'] as const) {
      cases.push({
        label: `building:${wallStyle}:${roofStyle}`,
        parts: prop.buildingParts({
          variation: artVariation('props', `merge-orientation:${wallStyle}:${roofStyle}`),
          noiseSeed: 0xb0115,
          palette: BUILDING_PALETTE as never,
          width: 5, depth: 4, wallHeight: 3, storeys: 2,
          wallStyle, roofStyle, windows: 2, chimney: true,
          porch: true, balcony: true, crenellated: roofStyle === 'flat', lit: true,
        } as never) as never,
      })
    }
  }
  for (const [label, build] of [
    ['well', prop.wellParts], ['monument', prop.monumentParts], ['brazier', prop.brazierParts],
    ['cart', prop.cartParts], ['tent', prop.tentParts], ['tower', prop.towerParts],
  ] as const) {
    cases.push({
      label,
      parts: (build as (options: unknown) => never)({
        variation: artVariation('props', `merge-orientation:${label}`),
        noiseSeed: 0x51ee7,
        palette: PROP_PALETTE,
      }) as never,
    })
  }

  let multiPartSurfaces = 0
  let facesCompared = 0
  const offenders: string[] = []

  for (const { label, parts } of cases) {
    const bySurface = new Map<string, THREE.BufferGeometry[]>()
    for (const part of parts) {
      const bucket = bySurface.get(part.surface) ?? []
      bucket.push(part.geometry)
      bySurface.set(part.surface, bucket)
    }
    // Snapshot before merging: `mergePropParts` consumes its inputs.
    const before = new Map<string, string[]>()
    for (const [surface, geometries] of bySurface) {
      if (geometries.length > 1) multiPartSurfaces += 1
      before.set(surface, faceDirections(geometries))
    }

    const merged = prop.mergePropParts(parts as never, { name: `merge-orientation:${label}` })
    for (const surface of merged) {
      const expected = before.get(surface.surface)
      assert.ok(expected, `${label}: merge produced a surface '${String(surface.surface)}' nothing built`)
      const after = faceDirections([surface.geometry])
      facesCompared += after.length
      if (after.length !== expected.length) {
        offenders.push(
          `${label}#${String(surface.surface)}: ${String(expected.length)} faces went in, `
          + `${String(after.length)} came out`,
        )
        continue
      }
      let moved = 0
      for (let index = 0; index < after.length; index += 1) {
        if (after[index] !== expected[index]) moved += 1
      }
      if (moved > 0) {
        offenders.push(
          `${label}#${String(surface.surface)}: ${String(moved)} of ${String(after.length)} `
          + 'faces point somewhere else after merging',
        )
      }
      surface.geometry.dispose()
    }
  }

  // Domain guards. The whole point is the multi-part case, so a run that happened to
  // build only single-part surfaces would compare nothing and report clean.
  assert.ok(
    multiPartSurfaces >= 20,
    `only ${String(multiPartSurfaces)} surfaces had more than one part, so the merge this `
    + 'test exists to police barely happened',
  )
  assert.ok(
    facesCompared >= 20_000,
    `only ${String(facesCompared)} faces were compared`,
  )
  assert.deepEqual(
    offenders.slice(0, 8),
    [],
    `merging changed the orientation of geometry it was only supposed to concatenate. `
    + 'Signed volume cannot see this (one reversed part cancels against the rest) and '
    + 'normal agreement cannot either (a reversal that swaps normals in step stays '
    + 'self-consistent), which is why this compares the merge against its own inputs.',
  )
})

