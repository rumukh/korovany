import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'

import {
  bakeOutlineNormals,
  bakeSkyOcclusion,
  bakeVerticalOcclusion,
  gradientVertexColors,
  latheProfile,
  mergeAll,
} from '../src/game/art/GeometryKit.ts'

/**
 * Merging is a move, and a moved-from geometry is silent.
 *
 * `dispose()` frees the GPU buffer but leaves the JS object fully readable, so a
 * second merge succeeds, produces plausible vertex data, and the fault only appears
 * when a draw reads a buffer that was freed underneath it. Nothing else in this kit
 * fails that quietly, which is why the ownership guard is worth its `WeakSet`.
 */

function box(name: string): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.name = name
  return geometry
}

test('a disposed geometry stays readable and mergeable, which is why the guard exists', () => {
  const stale = box('stale')
  const before = stale.getAttribute('position').count
  stale.dispose()

  // Not an aspiration — a property of three.js that the guard compensates for. If a
  // future three.js starts throwing here, the guard stops being load-bearing and this
  // test is the place that says so.
  assert.equal(stale.getAttribute('position').count, before)
})

test('the same geometry twice in one merge throws instead of double-counting', () => {
  const twice = box('twice')
  assert.throws(
    () => mergeAll([twice, twice], { name: 'doubled' }),
    /appears twice in one merge/,
  )
})

test('merging a geometry that an earlier merge consumed throws', () => {
  const source = box('source')
  mergeAll([source, box('other')], { name: 'first' })

  assert.throws(
    () => mergeAll([source, box('third')], { name: 'second' }),
    /already consumed by an earlier merge/,
  )
})

test('composing merges stays legal, so the guard cannot be a blanket rejection', () => {
  // The single-part path returns its input, so `first` and `a` are one object. Recording
  // the passthrough would make this throw — and this is the shape every builder that
  // merges sub-assemblies uses.
  const a = box('a')
  const first = mergeAll([a], { name: 'first' })
  assert.equal(first, a, 'a single-part merge is expected to hand the input back')

  const composed = mergeAll([first, box('b')], { name: 'composed' })
  assert.ok(composed.getAttribute('position').count > 0)
})

test('dispose:false consumes nothing, so the source stays reusable', () => {
  const kept = box('kept')
  const copy = mergeAll([kept, box('other')], { name: 'copied', dispose: false })
  assert.notEqual(copy, kept)

  // Must not throw: nothing was moved.
  const again = mergeAll([kept, box('another')], { name: 'again', dispose: false })
  assert.ok(again.getAttribute('position').count > 0)
})

test('the guard does NOT catch two single-part merges of one geometry', () => {
  // Documented blind spot, asserted so it is not mistaken for coverage.
  //
  // Both calls return the input itself, so this produces two names for one buffer —
  // exactly the fault `mergePropParts` guards at the parts list. It is unreachable
  // from here because reusing the result and reusing the source are the same
  // operation on the same object. See the `mergedAway` docblock.
  const shared = box('shared')
  const hard = mergeAll([shared], { name: 'prop-hard' })
  const foliage = mergeAll([shared], { name: 'prop-foliage' })

  assert.equal(hard, foliage)
  assert.equal(hard, shared)
  assert.equal(
    hard.getAttribute('position').array,
    foliage.getAttribute('position').array,
    'one buffer under two names — the caller-side guard is the one that catches this',
  )
})

/**
 * Merging is also the place the output's *structure* changes shape.
 *
 * A real merge non-indexes every part first, because mixed indexing is one of the
 * disagreements `mergeGeometries` answers with `null`. The single-part path returns
 * its input, so an indexed part stays indexed — the output's indexing depends on how
 * many parts it was given, and lathe-built props are the common route in because they
 * are indexed by construction and are frequently a prop's only part.
 *
 * Pinned in both directions. A reader that only ever sees non-indexed input is covered
 * by accident, and would go on passing if the indexed route quietly disappeared.
 */

test('a single-part merge keeps indexing that a real merge would have destroyed', () => {
  const single = mergeAll([new THREE.CylinderGeometry(0.3, 0.3, 1, 8)], { name: 'one' })
  assert.ok(single.index, 'a single-part merge hands back its input, index and all')

  const many = mergeAll(
    [new THREE.CylinderGeometry(0.3, 0.3, 1, 8), new THREE.CylinderGeometry(0.2, 0.2, 1, 8)],
    { name: 'many' },
  )
  assert.equal(many.index, null, 'a real merge non-indexes first')
})

test('a lathe part survives a single-part merge still indexed', () => {
  // The live route: a revolve-built prop whose only part goes through mergeAll.
  const lathe = latheProfile(
    [{ x: 0.1, y: 0 }, { x: 0.25, y: 0.4 }, { x: 0.18, y: 0.9 }],
    { segments: 8 },
  )
  assert.ok(lathe.index, 'latheProfile is indexed by construction')

  const merged = mergeAll([lathe], { name: 'pillar' })
  assert.ok(merged.index, 'and the passthrough preserves it')
})

test('bakeOutlineNormals matches whichever structure it is handed', () => {
  const indexed = new THREE.CylinderGeometry(0.3, 0.3, 1, 8)
  const flat = new THREE.CylinderGeometry(0.3, 0.3, 1, 8).toNonIndexed()

  // Non-vacuity: if these ever stop differing, the case this test exists for is gone.
  assert.ok(indexed.index, 'the indexed case must actually be indexed')
  assert.equal(flat.index, null)
  assert.notEqual(
    indexed.getAttribute('position').count,
    flat.getAttribute('position').count,
    'the two structures must have different vertex counts for this to test anything',
  )

  for (const geometry of [indexed, flat]) {
    const baked = bakeOutlineNormals(geometry)
    const outline = baked.getAttribute('outlineNormal')
    assert.ok(outline, 'every structure gets outline normals')
    assert.equal(
      outline.count,
      baked.getAttribute('position').count,
      'one outline normal per vertex, whichever vertex set that is',
    )
  }
})

test('every baker agrees on an indexed and a flat build of the same shape', () => {
  // palace-pillar and character-hood are lathes that never merge, so they reach the
  // renderer indexed. That path is exercised in production either way; this asserts it
  // is exercised in the suite, matched by position rather than by index.
  const profile = [
    { x: 0.001, y: 0 }, { x: 0.72, y: 0 }, { x: 0.66, y: 0.16 },
    { x: 0.48, y: 0.3 }, { x: 0.42, y: 1.9 }, { x: 0.56, y: 2.24 },
    { x: 0.66, y: 2.42 }, { x: 0.62, y: 2.62 }, { x: 0.001, y: 2.7 },
  ]
  const bake = (geometry: THREE.BufferGeometry) => {
    gradientVertexColors(geometry, { bottom: 0x6c6a63, top: 0xc9c4b4, bias: 0.75 })
    bakeVerticalOcclusion(geometry, { strength: 0.28, falloff: 0.7 })
    bakeSkyOcclusion(geometry, { strength: 0.2 })
    return bakeOutlineNormals(geometry)
  }

  const indexed = latheProfile(profile, { segments: 8, name: 'palace-pillar' })
  const flat = latheProfile(profile, { segments: 8, name: 'palace-pillar' }).toNonIndexed()
  assert.ok(indexed.index, 'the indexed build must really be indexed')
  assert.equal(flat.index, null)

  bake(indexed)
  bake(flat)

  const at = (geometry: THREE.BufferGeometry, name: string, i: number) => {
    const a = geometry.getAttribute(name)
    return [a.getX(i), a.getY(i), a.getZ(i)]
  }
  const key = (geometry: THREE.BufferGeometry, i: number) =>
    at(geometry, 'position', i).map((v) => Math.round(v * 1e5)).join(',')

  for (const attribute of ['color', 'outlineNormal']) {
    const reference = new Map<string, number[]>()
    for (let i = 0; i < indexed.getAttribute('position').count; i++) {
      reference.set(key(indexed, i), at(indexed, attribute, i))
    }

    let compared = 0
    for (let i = 0; i < flat.getAttribute('position').count; i++) {
      const expected = reference.get(key(flat, i))
      assert.ok(expected, `${attribute}: flat vertex ${String(i)} has no indexed twin`)
      const actual = at(flat, attribute, i)
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(
          Math.abs(expected[axis] - actual[axis]) < 1e-6,
          `${attribute} disagrees between structures at vertex ${String(i)}`,
        )
      }
      compared++
    }
    // A floor, so a broken key can't report success by matching nothing.
    assert.ok(compared > 300, `${attribute}: only ${String(compared)} vertices compared`)
  }
})
