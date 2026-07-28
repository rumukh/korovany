import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/**
 * `npm run docs:facts` used to print a summary that was byte-identical between a
 * passing run and a failing one. The class of failure it is most likely to catch
 * — a number in the document contradicting the tool's count — moves no count, so
 * `TOTAL 2313 facts` and `declared residue: 187 accepted, 0 NOT accepted` were
 * the same either way; the mismatch went to stderr, after the last line of
 * stdout, and the run exited 1 while the last thing on stdout read as success.
 *
 * That is the worst arrangement of the two available: a gate whose verdict lives
 * in the one stream people do not read, contradicted by the one they do. These
 * tests hold the verdict in stdout, last, and stated.
 *
 * `--break=<word>` removes a word from the document *in memory* before auditing,
 * so the failing path is exercised without writing to `docs/STRATEGY.md` — a test
 * that mutates a tracked file leaves the repository dirty when it fails, which is
 * exactly when nobody is in a position to notice.
 */

const SCRIPT = fileURLToPath(new URL('../scripts/strategy-facts.mjs', import.meta.url))

function run(...args: string[]): { status: number, stdout: string, lastLine: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  const lines = r.stdout.split('\n').map((l) => l.trimEnd()).filter((l) => l !== '')
  return { status: r.status ?? -1, stdout: r.stdout, lastLine: lines.at(-1) ?? '' }
}

test('the docs:facts summary states its own verdict', () => {
  // Control first. If `--break` stopped breaking anything — a renamed anchor, a
  // changed flag — every assertion below would compare a passing run with a
  // passing run and agree. The failing invocation must actually fail before its
  // wording means anything.
  const broken = run('--break=2,313')
  assert.equal(
    broken.status,
    1,
    'the failing invocation did not fail, so this test is comparing two passing runs '
    + 'and cannot distinguish a verdict from a decoration',
  )

  const clean = run()
  assert.equal(clean.status, 0, `a clean audit should exit 0; stdout was:\n${clean.stdout}`)

  assert.match(
    clean.lastLine,
    /^PASSED: /,
    'a passing audit must say so on its last line of stdout, not merely exit 0',
  )
  assert.match(
    broken.lastLine,
    /^FAILED: /,
    'a failing audit must say so on its last line of stdout. Exiting 1 while the last '
    + 'line read `0 NOT accepted` is the defect this test exists to hold shut',
  )

  assert.notEqual(
    clean.stdout,
    broken.stdout,
    'the passing and failing runs produced identical stdout, so no reader of the summary '
    + 'alone could tell them apart',
  )
})

test('the docs:facts verdict survives the early return that skips the summary', () => {
  // Recall-control failure returns before the summary is ever built, so the fix
  // above does not cover it and this is a second path, not a second assertion.
  const controls = run('--break=chronicle')

  assert.equal(
    controls.status,
    1,
    'removing a load-bearing term should fail the recall controls; if this passes, the '
    + 'path below is not being exercised',
  )
  assert.match(
    controls.lastLine,
    /^FAILED: /,
    'the recall-control path returns early, so without its own verdict line stdout simply '
    + 'stops and the run looks like one that ended with no complaint',
  )
})
