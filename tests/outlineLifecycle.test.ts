import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

/**
 * Invariant 4 of `docs/08` §8 — an outline shell borrows its source's geometry, material
 * and instance matrix, so it must be returned through `releaseOutline` and never through
 * a `dispose()` sweep — is guarded thoroughly where it is *implemented* and, until this
 * file, nowhere it is *relied on*.
 *
 * Three tests in `art.test.ts` fire if `releaseOutline` stops doing its job. None fire if
 * a caller stops calling it. Deleting both release loops from `GameEngine.destroy()` and
 * running the whole suite gives **254 passed, 0 failed** — measured, not assumed. The
 * engine cannot be instantiated without a WebGL context, so the reliance side has no
 * runtime test to add the assertion to; a source scan is what is left, and it is enough,
 * because every failure this guards against is visible in the source.
 *
 * The second rule of §6 applies to this file itself: it asserts *that the calls exist and
 * are ordered*, and it cannot tell whether they run. A behavioural test would need WebGL.
 */

const ENGINE = readFileSync(new URL('../src/game/GameEngine.ts', import.meta.url), 'utf8')

/** The body of a method, by brace matching from its signature. */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `${signature} no longer exists in GameEngine.ts`)
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  assert.fail(`${signature} has unbalanced braces`)
}

test('destroy() releases every outline binding collection the engine declares', () => {
  // Derived from the field declarations rather than listed here, so a third collection
  // added later joins the requirement automatically instead of being silently exempt.
  const collections = [...ENGINE.matchAll(/private readonly (\w+): \w*OutlineBinding\[\]/g)]
    .map((match) => match[1])
    .sort()

  // Guard the derivation: if the pattern stopped matching, every assertion below would
  // hold vacuously against an empty list.
  assert.ok(
    collections.length > 0,
    'derived no outline binding collections at all — the field pattern has drifted',
  )
  assert.deepEqual(
    collections,
    ['interactableOutlineBindings', 'outlineBindings'],
    'the set of outline binding collections changed; add the new one to destroy() and to '
    + 'this pin, so that a collection which newly joins or leaves the set fails here',
  )

  const destroy = methodBody(ENGINE, 'destroy(): void {')
  for (const field of collections) {
    const releases = new RegExp(
      `this\\.${field}[\\s\\S]{0,200}?releaseOutline\\(`,
    ).test(destroy)
    assert.ok(
      releases,
      `destroy() never passes this.${field} to releaseOutline — its shells will reach the `
      + 'dispose sweep below and free buffers their sources still own',
    )
  }
})

test('the outline releases precede the dispose sweep they protect against', () => {
  const destroy = methodBody(ENGINE, 'destroy(): void {')
  const lastRelease = destroy.lastIndexOf('releaseOutline(')
  const sweep = destroy.indexOf('this.scene.traverse(')

  assert.notEqual(lastRelease, -1, 'destroy() no longer releases any outline binding')
  assert.notEqual(sweep, -1, 'destroy() no longer traverses the scene')
  assert.ok(
    lastRelease < sweep,
    'an outline release moved after the dispose sweep. The sweep would reach the shells '
    + 'first, and a shell disposed as a child of its source frees the source\'s buffers',
  )
})

test('every applyOutline call site is one whose binding is released', () => {
  // `applyOutline` is the only way to make a shell, so pinning its call sites pins the
  // set of things that can leak. A new site is not necessarily wrong — it just has to
  // prove it is released, and failing here is what forces that.
  const roots = ['../src/game']
  const sites: string[] = []
  const walk = (relative: string): void => {
    const directory = new URL(`${relative}/`, import.meta.url)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${relative}/${entry.name}`)
      else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(new URL(entry.name, directory), 'utf8')
        if (/\.applyOutline\(/.test(source)) sites.push(entry.name)
      }
    }
  }
  for (const root of roots) walk(root)

  assert.deepEqual(
    sites.sort(),
    ['GameEngine.ts', 'GeneratedWorldRuntime.ts'],
    'a new file calls applyOutline. Route the binding into a collection that destroy() '
    + 'releases, or release it in that file\'s own teardown, then add the file here',
  )
})

test('a single-binding field is released by the collection its registrar pushes to', () => {
  // `playerOutline` is a lone `OutlineBinding`, not a collection, so the test above says
  // nothing about it. It is released only because `registerOutline` happens to push into
  // `outlineBindings` — an indirection that is load-bearing and was untested. A field
  // assigned straight from `applyOutline` would look identical and leak.
  const singles = [...ENGINE.matchAll(/private readonly (\w+): OutlineBinding\b(?!\[)/g)]
    .map((match) => match[1])

  assert.ok(singles.length > 0, 'derived no single outline binding fields — pattern drifted')

  const registrar = methodBody(ENGINE, 'private registerOutline(')
  assert.match(
    registrar,
    /this\.outlineBindings\.push\(/,
    'registerOutline no longer pushes into outlineBindings, so every field it returns to '
    + 'is now unreleased — including ' + singles.join(', '),
  )

  for (const field of singles) {
    assert.match(
      ENGINE,
      new RegExp(`this\\.${field} = this\\.registerOutline\\(`),
      `this.${field} is not assigned from registerOutline, so nothing releases it`,
    )
  }
})
