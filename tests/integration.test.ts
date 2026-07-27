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
import { StylizedArtLibrary } from '../src/game/art/index.ts'

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
 */
test('the whole visible set has an ink budget, not just each region in it', () => {
  const { scene, blueprint, runtime } = createRuntime('integration-ink')

  let samples = 0
  let ninetyPercentSamples = 0
  let visibleSetPeak = 0
  let perRegionPeak = 0
  let regionsClassified = 0

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
    if (roots === 9) ninetyPercentSamples += 1
    visibleSetPeak = Math.max(visibleSetPeak, visibleSet)
    samples += 1

    assert.ok(
      visibleSet <= OUTLINE_WORLD_VISIBLE_DRAWS_MAX,
      `focus ${String(region.id)} draws ${String(visibleSet)} ink shells across `
      + `${String(roots)} visible regions; the visible-set budget is `
      + `${String(OUTLINE_WORLD_VISIBLE_DRAWS_MAX)}. Per-region spend is still inside `
      + `${String(OUTLINE_WORLD_DRAWS_MAX)}, so raising the per-region number is not `
      + 'the fix — the frame pays the sum.',
    )
  }

  // Domain guards. Every quiet failure on this programme was an assertion measuring
  // nothing and reporting green, so pin what was actually classified.
  assert.equal(samples, blueprint.regions.length, 'the sweep did not visit every region')
  assert.ok(
    regionsClassified >= 150,
    `classified only ${String(regionsClassified)} region roots across ${String(samples)} focuses`,
  )
  assert.ok(
    ninetyPercentSamples > 0,
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

  runtime.dispose()
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
 * Mutation-verified, because a "no offenders" assertion is the exact shape that passes
 * by looking at nothing. Whitening every geometry on its way out of `mergeAll` turns
 * this red at **62 of 126 judged**, and names them (`site-body:site-start-elf:hut:0`
 * and friends). It reads exactly 0 on the real tree. Both halves matter: a detector
 * that can fail is not enough, and neither is one that only ever reports zero.
 *
 * Two earlier mutations did NOT turn it red, and that is not a gap: painting `piece()`
 * white, and filling `ensureVertexColors`' default white, are both overwritten by
 * `shade()` and `mottle()` further down the same builder, so nothing white ever
 * reaches a frame. The 64 judged geometries the successful mutation did not reach take
 * `mergeAll`'s single-part early return and are coloured before it.
 */
test('nothing in the assembled world renders as blown-out white', () => {
  const { scene, blueprint, runtime } = createRuntime('integration-white')

  const judged = new Set<THREE.BufferGeometry>()
  let vertexColoured = 0
  let missingColour = 0
  let fullyWhite = 0
  const offenders: string[] = []

  const isFullyWhite = (
    attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  ): boolean => {
    for (let index = 0; index < attribute.count; index += 1) {
      if (
        attribute.getX(index) < 0.999
        || attribute.getY(index) < 0.999
        || attribute.getZ(index) < 0.999
      ) return false
    }
    return true
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
      if (isFullyWhite(colour)) {
        fullyWhite += 1
        offenders.push(`${object.name || object.type}: every vertex is white`)
      }
    })
  }

  // Domain guard first: a clean bill over an empty population is the failure mode
  // this whole class of test keeps walking into. Geometries are deduplicated, because
  // the prop cache hands the same buffer to many meshes and counting instances would
  // inflate this into meaninglessness. Measured on the merged tree: 126.
  assert.ok(
    vertexColoured >= 100,
    `only ${String(vertexColoured)} distinct vertex-coloured geometries were judged; the `
    + 'scan found too little of the world to mean anything',
  )
  assert.deepEqual(
    offenders.slice(0, 10),
    [],
    `${String(missingColour)} vertex-coloured geometries have no color attribute and `
    + `${String(fullyWhite)} are fully white out of ${String(vertexColoured)} judged. `
    + '`mergeAll` writes white for inputs that lack a color when any sibling input has '
    + 'one, so the usual cause is a list mixing a PropKit part with a CharacterKit part.',
  )

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

  // Acquired through the library rather than by calling builders directly, so this
  // sees the geometry the world actually gets, merged surfaces and all.
  const library = new WorldPropLibrary({ retention: 0 })
  const requests = [
    { kind: 'tree', biome: 'forest', slot: 0, detail: 'near' },
    { kind: 'tree', biome: 'fort', slot: 1, detail: 'far' },
    { kind: 'undergrowth', biome: 'forest', slot: 2 },
    { kind: 'rock', biome: 'fort', slot: 1, detail: 'near' },
    { kind: 'reeds', biome: 'neutral' },
    { kind: 'groundCover', biome: 'palace', cover: 'grass' },
  ]
  let propSurfaces = 0
  const uncoloured: string[] = []
  for (const request of requests) {
    const asset = library.acquire(request as never)
    for (const surface of asset.surfaces) {
      propSurfaces += 1
      if (!surface.geometry.getAttribute('color')) {
        uncoloured.push(`${asset.key}#${String(surface.surface)}`)
      }
    }
    library.release(asset)
  }
  assert.ok(propSurfaces >= 6, `only judged ${String(propSurfaces)} prop surfaces`)
  assert.deepEqual(
    uncoloured,
    [],
    `${String(uncoloured.length)} of ${String(propSurfaces)} PropKit surfaces have no vertex `
    + 'colours, which is the other half of the same hazard',
  )
  library.dispose()
})
