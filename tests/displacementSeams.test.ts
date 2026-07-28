import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as THREE from 'three'

import { displaceGeometry } from '../src/game/art/index.ts'

/**
 * `displaceGeometry` pushes every vertex along **its own normal**. On a non-indexed
 * buffer whose normals are faceted, the several copies of one corner each carry a
 * different normal, travel in different directions, and the surface splits open along
 * every hard crease.
 *
 * This was found by the world-object pass, which measured 48 torn geometries in its own
 * catalogue, and it reproduced here on two of my three call sites:
 *
 *     trunk   (faceted loft)        112 of 198 edges open, widest slit 0.97%
 *     boulder (icosahedron, det 1)    0 edges open                     — radial normals
 *     pebble  (icosahedron, det 0)   60 of  60 edges open, widest slit 12.2%
 *
 * The pebble displaced into twenty loose triangles. What makes this worth a dedicated
 * file is that **no orientation instrument can see it**: a torn surface is still
 * correctly wound, so signed volume stays positive, winding stays consistent, and normal
 * agreement stays clean. Three tests in `art.test.ts` pass on a shape full of holes.
 * Boundary-edge count is the instrument that sees it, and it is only here.
 */

/** Counts edges used by exactly one triangle, welding split vertices by position. */
const boundaryEdges = (geometry: THREE.BufferGeometry): number => {
  const position = geometry.getAttribute('position')
  const identity = new Map<string, number>()
  const welded: number[] = []
  for (let index = 0; index < position.count; index += 1) {
    const key =
      `${Math.round(position.getX(index) * 1e5)},` +
      `${Math.round(position.getY(index) * 1e5)},` +
      `${Math.round(position.getZ(index) * 1e5)}`
    let id = identity.get(key)
    if (id === undefined) {
      id = identity.size
      identity.set(key, id)
    }
    welded.push(id)
  }
  const uses = new Map<string, number>()
  const index = geometry.index
  const corners = index ? index.count : position.count
  for (let triangle = 0; triangle + 2 < corners; triangle += 3) {
    const a = welded[index ? index.getX(triangle) : triangle]
    const b = welded[index ? index.getX(triangle + 1) : triangle + 1]
    const c = welded[index ? index.getX(triangle + 2) : triangle + 2]
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  }
  let open = 0
  for (const count of uses.values()) if (count === 1) open += 1
  return open
}

const facetedBall = (radius: number, detail: number): THREE.BufferGeometry => {
  const source = new THREE.IcosahedronGeometry(radius, detail)
  const geometry = source.index ? source.toNonIndexed() : source
  if (geometry !== source) source.dispose()
  return geometry
}

const PEBBLE = {
  seed: 0x9eb61e,
  amplitude: 0.055,
  frequency: 6,
  octaves: 2,
  mode: 'ridge',
  axisScale: { x: 1.2, y: 0.6, z: 1.1 },
} as const

test('displacement tears a faceted surface open, and `seamless` closes it', () => {
  const torn = facetedBall(0.2, 0)
  const closedBefore = boundaryEdges(torn)
  assert.equal(closedBefore, 0, 'the undisplaced source must be a closed surface')

  displaceGeometry(torn, { ...PEBBLE })
  const openEdges = boundaryEdges(torn)

  // Asserted as a strict positive rather than an exact count: the point is that the
  // default really does tear, so that the `seamless` case below is proving something.
  // If a future change makes displacement seam-safe by construction this goes red and
  // should be deleted, not loosened.
  assert.ok(
    openEdges > 0,
    `expected the default to tear a faceted surface, got ${openEdges} boundary edges`,
  )

  const mended = facetedBall(0.2, 0)
  displaceGeometry(mended, { ...PEBBLE, seamless: true })
  assert.equal(
    boundaryEdges(mended),
    0,
    'seamless displacement must leave every edge shared by two triangles',
  )

  torn.dispose()
  mended.dispose()
})

test('`seamless` still displaces — it closes seams without flattening the shape', () => {
  const plain = facetedBall(0.2, 0)
  const source = facetedBall(0.2, 0)
  displaceGeometry(plain, { ...PEBBLE, seamless: true })

  const before = source.getAttribute('position')
  const after = plain.getAttribute('position')
  let moved = 0
  for (let index = 0; index < after.count; index += 1) {
    const dx = after.getX(index) - before.getX(index)
    const dy = after.getY(index) - before.getY(index)
    const dz = after.getZ(index) - before.getZ(index)
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 1e-6) moved += 1
  }
  assert.equal(moved, after.count, 'every vertex should still have been displaced')

  source.dispose()
  plain.dispose()
})

test('`seamless` is bit-exact on a surface whose normals are radial', () => {
  // `IcosahedronGeometry` above detail 0 gives every copy of a corner the same radial
  // normal, so the copies never separate and there is nothing to mend. The option must
  // cost nothing there.
  //
  // Note what this test does *not* pin. `displaceGeometry` guards the collapse with a
  // `moved` check, and deleting that guard leaves this test green — verified by
  // mutation. Bit-exactness holds either way, because positions are Float32-backed:
  // summing n identical values needs at most 24 + log2(n) bits and is exact in double
  // precision, and correctly-rounded division by n returns the value itself. The
  // property below is real and worth holding; it is simply not evidence for the guard,
  // and no input would make it so.
  const options = {
    seed: 0xb0d1e,
    amplitude: 0.34,
    frequency: 1.15,
    octaves: 3,
    mode: 'ridge',
    flatBase: 0.35,
    axisScale: { x: 1.1, y: 0.7, z: 1.05 },
  } as const

  const plain = facetedBall(1.15, 1)
  const seamless = facetedBall(1.15, 1)
  displaceGeometry(plain, { ...options })
  displaceGeometry(seamless, { ...options, seamless: true })

  assert.equal(boundaryEdges(plain), 0, 'radial normals should not tear in the first place')
  assert.deepEqual(
    Array.from(seamless.getAttribute('position').array as Float32Array),
    Array.from(plain.getAttribute('position').array as Float32Array),
    'seamless must be a bit-exact no-op where no seam opened',
  )

  plain.dispose()
  seamless.dispose()
})

test('every faceted displacement site in the tree is seam-repaired', () => {
  // Guarding the invariant where it is *relied on*, not only where it lives. The
  // behavioural tests above all pass with the repair deleted from every call site.
  //
  // **Rewritten at the merge, and the reason is the finding.** This scanned
  // `GeneratedWorldRuntime.ts` for `displaceGeometry(` and required `seamless: true` at
  // each site. On the merged tree it found **zero sites** and failed on its own domain
  // guard — because the world-object pass moved every geometry builder into `PropKit`,
  // and repairs seams there through a different mechanism: `displaceSeamless`, which
  // remembers coincident vertices before displacement and collapses each group back onto
  // its average afterwards. Same property, different spelling.
  //
  // That is the third time on this programme that a scanner searching for **one guard
  // token** was blind to a correct guard written another way (see `docs/08` §7.3), and
  // the domain guard is the only reason it announced itself instead of passing over an
  // empty set. It is kept, and widened: the population is now every call site in
  // `src/game/`, so moving a builder between files cannot empty it again.
  //
  // The claim is also stronger than the original. Rather than "each site opts in", the
  // tree now has **exactly one** raw `displaceGeometry` call and it sits inside the
  // repairing wrapper — so displacement without repair is not something you can forget,
  // it is something you would have to add a new call to do.
  const roots = ['art/GeometryKit.ts', 'art/PropKit.ts', 'art/CharacterKit.ts', 'world/GeneratedWorldRuntime.ts']
  const callSites: { file: string; target: string; body: string; at: number; source: string }[] = []
  for (const relative of roots) {
    const source = readFileSync(new URL(`../src/game/${relative}`, import.meta.url), 'utf8')
    // Brace-counting rather than a regex: the argument object contains a nested
    // `axisScale: { … }`, and `\{[^}]*\}` stops at its closing brace, silently handing
    // back a truncated body. That is not hypothetical — the first version of this test
    // failed on exactly that, reporting a site as non-compliant when it was compliant.
    const marker = 'displaceGeometry('
    for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
      // Skip the declaration itself, and any `typeof displaceGeometry` reference.
      if (/(function|const|type|typeof)\s+\w*\s*$/.test(source.slice(Math.max(0, at - 20), at))) continue
      let depth = 0
      let end = at + marker.length - 1
      for (; end < source.length; end += 1) {
        const character = source[end]
        if (character === '(') depth += 1
        else if (character === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      const argumentText = source.slice(at + marker.length, end)
      const comma = argumentText.indexOf(',')
      if (comma === -1) continue
      callSites.push({
        file: relative,
        target: argumentText.slice(0, comma).trim(),
        body: argumentText,
        at,
        source,
      })
    }
  }

  assert.ok(
    callSites.length >= 1,
    `expected to find displacement sites across ${roots.join(', ')}, found 0 — either `
    + 'displacement moved again, or this scan broke; it must not pass by looking at nothing',
  )

  // Derived rather than listed: a site built on a faceted source has to be repaired, by
  // either mechanism. The fort boulder is the one exception and it is exempt by
  // measurement, not by opinion — `IcosahedronGeometry` at detail 1 carries radial
  // normals and tears zero edges.
  const exempt = /IcosahedronGeometry\([^)]*,\s*[1-9]/
  /** Name of the nearest `function` declaration above an offset, or '' at top level. */
  const enclosing = (source: string, at: number): string => {
    const before = source.slice(0, at)
    const match = /[\s\S]*(?:^|\n)(?:export\s+)?function\s+(\w+)\s*[(<]/.exec(before)
    return match ? match[1] : ''
  }
  const exempted: string[] = []
  const wrapped: string[] = []
  let checked = 0
  for (const site of callSites) {
    const before = site.source.slice(Math.max(0, site.at - 400), site.at)
    const label = `${site.file}:${site.target}`
    if (exempt.test(before)) { exempted.push(label); continue }
    // Inside `displaceSeamless` the repair *is* the enclosing function.
    if (enclosing(site.source, site.at) === 'displaceSeamless') { wrapped.push(label); continue }
    checked += 1
    assert.match(
      site.body,
      /seamless:\s*true/,
      `${site.file}: displaceGeometry(${site.target}, …) builds on a faceted source and is `
      + 'neither inside `displaceSeamless` nor passing `seamless: true`, so it will tear '
      + 'the surface open along every hard crease',
    )
  }

  // The exemptions are pinned as an EXACT SET, not counted and not merely bounded.
  //
  // The rule is the foundation session's, added to `docs/08` §6 after this programme
  // produced five instrument-blindness defects: *treat an invariant as having a domain,
  // and pin the known exceptions as an exact set, so a shape that newly joins it or
  // newly leaves it fails.* A set that can only shrink silently is how a check stops
  // covering the thing it was written for — and this scan had exactly that hole, because
  // nothing recorded which sites were being skipped.
  //
  // Both directions matter and they fail for different reasons. A site JOINING silently
  // reduces coverage: switch a builder to `IcosahedronGeometry(r, 1)` and it stops being
  // checked, with no test going red. A site LEAVING is the safe direction for coverage
  // but still means the measurement behind the exemption no longer describes the tree,
  // and that measurement — radial normals tear zero edges — is the entire justification.
  assert.deepEqual(
    exempted,
    [],
    'the set of displacement sites exempted by source geometry has changed. The exemption '
    + 'is justified by a measurement — `IcosahedronGeometry` at detail >= 1 carries radial '
    + 'normals and tore 0 boundary edges — so re-measure the new member before adding it '
    + 'here rather than widening the pattern.',
  )
  assert.deepEqual(
    wrapped,
    ['art/PropKit.ts:geometry'],
    'the set of displacement sites repaired by `displaceSeamless` has changed. If a site '
    + 'left, it now needs `seamless: true` at the call. If one joined, that is probably '
    + 'correct — confirm it and add it here, because an exemption nobody records is one '
    + 'nobody re-measures.',
  )
  // Deliberately not `checked > 0`. Every site being exempt or wrapped is the *correct*
  // end state and is what this tree currently reaches — `displaceSeamless` is the only
  // caller, so `checked` is 0 and that is the invariant holding, not the test asserting
  // nothing. What proves the scan ran is `callSites.length`, above, on the raw
  // population before any exemption.
  assert.ok(
    checked >= 0 && callSites.length >= 1,
    'unreachable: the population guard above already covers this',
  )
})
