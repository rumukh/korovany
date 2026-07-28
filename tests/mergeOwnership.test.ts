import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'

import { mergeAll } from '../src/game/art/GeometryKit.ts'

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
