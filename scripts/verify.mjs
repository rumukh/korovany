#!/usr/bin/env node
/**
 * `npm run verify` — the gate-and-sweep instrument, as an artefact instead of a
 * shell invocation typed fresh each time.
 *
 * ## Why this file exists
 *
 * Every rule below was extracted from a defect this repository actually produced
 * during the head-rig work, and every one of them was learned in a hand-typed
 * PowerShell line that existed nowhere afterwards. A reviewer measured that:
 * `package.json` had no `verify`, there were no `.ps1`/`.sh` files outside
 * `node_modules`, and CI could not check the instrument because there was
 * nothing to check. The entry in `docs/09` that says *"move the rule into
 * something that runs"* had never been applied at its own site.
 *
 * The five properties, each with its originating failure:
 *
 * 1. **Individual exit codes, never the chain's.** Sweep and gates were combined
 *    into one invocation so a clean sweep could not be quoted from a different
 *    tip than the gates. Measured cost: a chained script reports only the last
 *    command's status. `npm test` set `LASTEXITCODE` to 1, a trailing
 *    `git status` reset it to 0, and the invocation reported success.
 *
 * 2. **Parse `pass`/`fail`, never `tests`.** `node:test` prints `tests N` — a
 *    census, identical whether every test passed or none did. A filter matching
 *    it reported `371` while the suite was 370 pass / 1 fail. A filter proving a
 *    command *ran* cannot also report what it *found*.
 *
 * 3. **Three bounds, each named.** Stripping inline spans by deletion joins the
 *    text either side and *manufactures* hits; stripping by placeholder
 *    *conceals* a real double space inside inline code. They are an upper and a
 *    lower bound, not two attempts at one number, so `0` alone is unreadable —
 *    it was published unqualified two hours after the rule against doing so was
 *    adopted verbatim.
 *
 * 4. **Doped controls that fail the run.** A detector that cannot fire looks
 *    exactly like a clean result. Every control here is asserted, and `--mutate`
 *    proves each one can fail.
 *
 * 5. **One invocation for tip, gates and sweep.** Adjacency in a verification
 *    block is read as coreference and nothing asserts it: a block once paired a
 *    local tip with a PR status two commits older, so `MERGEABLE CLEAN` was a
 *    checked status for an unchecked commit. Local tip, remote tip and PR head
 *    are resolved together and compared.
 *
 * Fenced-region detection reads the **file at HEAD** and maps added lines to
 * their new-file line numbers, rather than toggling a fence flag across added
 * lines alone. The latter is wrong for a line added inside a pre-existing fence,
 * which is a case this repository produces constantly.
 *
 * **The sweep reads the committed diff, not the working tree**, and that is only
 * sound because the clean-tree assertion above runs in the same invocation: if
 * the tree is clean the committed diff *is* the working tree. The two checks
 * compose, and the composition is load-bearing rather than incidental — doping a
 * file without committing it produces a clean sweep and a dirty-tree failure,
 * which is a red run for the wrong reason and would read as the right one. Stated
 * because it was found that way: the first attempt to prove this instrument could
 * go red doped the working tree and measured nothing.
 *
 * Usage:
 *   node scripts/verify.mjs              gates + sweep
 *   node scripts/verify.mjs --sweep-only skip the four gates
 *   node scripts/verify.mjs --mutate     prove every control can fail
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'origin/main'

/** Run a command and return its own exit code — never a chain's. */
function run(cmd, args, opts = {}) {
  // `shell: true` with an args array concatenates without escaping (DEP0190).
  // npm/npx are `.cmd` shims on Windows, so resolve the executable instead of
  // reaching for a shell.
  const exe = process.platform === 'win32' && /^(npm|npx|gh)$/.test(cmd) ? `${cmd}.cmd` : cmd
  const r = spawnSync(exe, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function git(...args) {
  return run('git', args).out.trim()
}

/**
 * Read a verdict, not a census.
 *
 * `tests N` is printed identically on a green and a red run, so it is refused
 * outright rather than used as a fallback — a fallback to the census is how the
 * original defect would return.
 */
export function parseTestVerdict(output) {
  const pass = /(?:^|\n)[^\n]*?\bpass (\d+)/.exec(output)
  const fail = /(?:^|\n)[^\n]*?\bfail (\d+)/.exec(output)
  const census = /(?:^|\n)[^\n]*?\btests (\d+)/.exec(output)
  if (!pass || !fail) return { ok: false, reason: 'no pass/fail lines in output', census: census ? Number(census[1]) : null }
  return {
    ok: true,
    pass: Number(pass[1]),
    fail: Number(fail[1]),
    census: census ? Number(census[1]) : null,
  }
}

/** Line numbers inside ``` fences, computed from whole-file content. */
export function fencedLines(source) {
  const fenced = new Set()
  let open = false
  source.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced.add(i + 1)
      open = !open
      return
    }
    if (open) fenced.add(i + 1)
  })
  return fenced
}

/** Added lines with their new-file line numbers, from a unified diff. */
export function parseAddedLines(diff) {
  const added = []
  let lineNo = 0
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      lineNo = Number(hunk[1])
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) {
      added.push({ lineNo, text: line.slice(1) })
      lineNo += 1
      continue
    }
    if (line.startsWith('-')) continue
    lineNo += 1
  }
  return added
}

const DOUBLE_SPACE = /\S {2}\S/

/**
 * Three bounds, because one number cannot carry which it is.
 *
 *   raw          what is literally in the prose, inline code included
 *   placeholder  spans substituted -> LOWER bound; conceals doubles inside code
 *   deletion     spans removed     -> UPPER bound; manufactures by joining
 */
export function sweepBounds(proseLines) {
  const raw = proseLines.filter((l) => DOUBLE_SPACE.test(l))
  const placeholder = proseLines.filter((l) => DOUBLE_SPACE.test(l.replace(/`[^`]*`/g, '@')))
  const deletion = proseLines.filter((l) => DOUBLE_SPACE.test(l.replace(/`[^`]*`/g, '')))
  return { raw: raw.length, placeholder: placeholder.length, deletion: deletion.length, rawHits: raw }
}

export function overLong(lines, limit = 120) {
  return lines.filter((l) => l.length > limit)
}

/**
 * Controls. Each asserts the instrument can produce a different answer; a
 * control that cannot fail is the failure it is meant to exclude.
 *
 * `mutate` corrupts the instrument the control exercises. `--mutate` asserts
 * every control goes red under its mutation, which is what makes the green run
 * evidence rather than decoration.
 */
export const CONTROLS = [
  {
    name: 'verdict-parser-reads-pass-fail',
    check: () => {
      const v = parseTestVerdict('# tests 5\n# pass 3\n# fail 2\n')
      return v.ok && v.pass === 3 && v.fail === 2
    },
    mutate: () => {
      const v = parseTestVerdict('# tests 5\n# pass 3\n# fail 2\n')
      return v.ok && v.pass === 5 && v.fail === 2
    },
  },
  {
    name: 'verdict-parser-refuses-census-only',
    check: () => parseTestVerdict('# tests 371\n').ok === false,
    mutate: () => parseTestVerdict('# tests 371\n').ok === true,
  },
  {
    name: 'verdict-parser-sees-a-red-run',
    check: () => {
      const v = parseTestVerdict('# tests 371\n# pass 370\n# fail 1\n')
      return v.ok && v.fail === 1 && v.census === 371
    },
    mutate: () => {
      const v = parseTestVerdict('# tests 371\n# pass 370\n# fail 1\n')
      return v.ok && v.fail === 0
    },
  },
  {
    name: 'sweep-fires-on-a-doped-line',
    check: () => sweepBounds(['a  b']).raw === 1,
    mutate: () => sweepBounds(['a  b']).raw === 0,
  },
  {
    name: 'sweep-is-silent-on-clean-prose',
    check: () => sweepBounds(['a b c']).raw === 0,
    mutate: () => sweepBounds(['a b c']).raw === 1,
  },
  {
    name: 'placeholder-and-raw-actually-differ',
    // The property the label claims: a double space inside inline code is
    // invisible to the placeholder bound and visible to the raw one.
    check: () => {
      const b = sweepBounds(['see `a  b` here'])
      return b.raw === 1 && b.placeholder === 0
    },
    mutate: () => {
      const b = sweepBounds(['see `a  b` here'])
      return b.raw === b.placeholder
    },
  },
  {
    name: 'deletion-is-an-upper-bound-that-manufactures',
    // Removing the span joins "x" to "y" across two spaces that were never
    // adjacent in the file. Deletion must see it; raw must not.
    check: () => {
      const b = sweepBounds(['x `code` y'])
      return b.deletion === 1 && b.raw === 0
    },
    mutate: () => {
      const b = sweepBounds(['x `code` y'])
      return b.deletion === 0
    },
  },
  {
    name: 'fence-detection-covers-interior-lines',
    check: () => {
      const f = fencedLines('a\n```\nb\n```\nc')
      return f.has(2) && f.has(3) && f.has(4) && !f.has(1) && !f.has(5)
    },
    mutate: () => fencedLines('a\n```\nb\n```\nc').has(1),
  },
  {
    name: 'added-lines-carry-new-file-numbers',
    check: () => {
      const a = parseAddedLines('@@ -1,0 +7,2 @@\n+one\n+two\n')
      return a.length === 2 && a[0].lineNo === 7 && a[1].lineNo === 8
    },
    mutate: () => {
      const a = parseAddedLines('@@ -1,0 +7,2 @@\n+one\n+two\n')
      return a[1].lineNo === 7
    },
  },
  {
    name: 'over-long-detector-fires-at-121',
    check: () => overLong(['x'.repeat(121), 'x'.repeat(120)]).length === 1,
    mutate: () => overLong(['x'.repeat(121), 'x'.repeat(120)]).length === 0,
  },
]

function runControls() {
  const failed = CONTROLS.filter((c) => c.check() !== true)
  return { total: CONTROLS.length, failed: failed.map((c) => c.name) }
}

/** `--mutate`: every control must go red under its own mutation. */
function runMutation() {
  const survived = []
  for (const c of CONTROLS) {
    // The mutant stands in for a corrupted instrument. If the control still
    // reports healthy against it, the control proves nothing.
    let healthyUnderMutation = false
    try {
      healthyUnderMutation = c.mutate() === true
    } catch {
      healthyUnderMutation = false
    }
    if (healthyUnderMutation) survived.push(c.name)
  }
  console.log(`\n${CONTROLS.length} controls, ${survived.length} survived mutation`)
  for (const c of CONTROLS) {
    const dead = !survived.includes(c.name)
    console.log(`  ${dead ? 'CAUGHT  ' : 'SURVIVED'}  ${c.name}`)
  }
  if (survived.length > 0) {
    console.log('\nFAILED: a control that cannot fail is not a control')
    process.exitCode = 1
    return
  }
  console.log('\nPASSED: every control goes red under its mutation')
}

function collectProse() {
  const files = git('diff', '--name-only', `${BASE}...HEAD`, '--', '*.md')
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)

  const prose = []
  const allAdded = []
  for (const file of files) {
    const diff = git('diff', '-U0', `${BASE}...HEAD`, '--', file)
    const added = parseAddedLines(diff)
    allAdded.push(...added.map((a) => a.text))
    const path = join(ROOT, file)
    if (!existsSync(path)) continue
    const fenced = fencedLines(readFileSync(path, 'utf8'))
    for (const { lineNo, text } of added) {
      if (!fenced.has(lineNo)) prose.push(text)
    }
  }
  return { files, prose, allAdded }
}

function main() {
  if (process.argv.includes('--mutate')) {
    runMutation()
    return
  }

  const stamp = new Date().toTimeString().slice(0, 8)
  const failures = []

  const controls = runControls()
  if (controls.failed.length > 0) failures.push(`controls: ${controls.failed.join(', ')}`)

  // --- identity: every line below must describe the same object -------------
  const sha = git('rev-parse', '--short', 'HEAD')
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  const remote = git('rev-parse', '--short', `origin/${branch}`) || '(none)'
  const behind = git('rev-list', '--count', `HEAD..${BASE}`)
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length
  const pr = run('gh', ['pr', 'view', '--json', 'headRefOid,number,state,mergeStateStatus'])
  let prHead = '(no pr)'
  let prDesc = ''
  if (pr.code === 0) {
    try {
      const j = JSON.parse(pr.out)
      prHead = String(j.headRefOid).slice(0, 7)
      prDesc = `#${j.number} ${j.state} ${j.mergeStateStatus}`
    } catch {
      prHead = '(unparsed)'
    }
  }
  const heads = [sha, remote, prHead].filter((h) => h !== '(none)' && h !== '(no pr)')
  const agree = heads.every((h) => h === sha)

  console.log(`VERIFIED AT ${stamp}`)
  console.log(`  branch                 : ${branch}`)
  console.log(`  local / remote / pr    : ${sha} / ${remote} / ${prHead}  -> ${agree ? 'ALL AGREE' : 'MISMATCH'}`)
  if (prDesc) console.log(`  pull request           : ${prDesc}`)
  console.log(`  behind ${BASE} / dirty : ${behind} / ${dirty}`)
  if (!agree) failures.push('local, remote and PR head do not all agree')
  if (behind !== '0') failures.push(`branch is ${behind} behind ${BASE}`)
  if (dirty !== 0) failures.push(`working tree has ${dirty} modified paths`)

  // --- gates: each exit code captured on its own ----------------------------
  if (!process.argv.includes('--sweep-only')) {
    const gates = [
      ['build', 'npm', ['run', 'build']],
      ['lint', 'npx', ['oxlint', 'src', 'tests']],
      ['docsfacts', 'npm', ['run', 'docs:facts']],
    ]
    const codes = []
    for (const [name, cmd, args] of gates) {
      const { code } = run(cmd, args)
      codes.push(`${name}=${code}`)
      if (code !== 0) failures.push(`${name} exited ${code}`)
    }
    const t = run('npm', ['test'])
    codes.push(`test=${t.code}`)
    const verdict = parseTestVerdict(t.out)
    console.log(`  exit codes             : ${codes.join(' ')}`)
    if (!verdict.ok) {
      console.log('  tests                  : NO VERDICT — output carried no pass/fail line')
      failures.push('test output carried no verdict')
    } else {
      console.log(`  tests                  : census=${verdict.census} PASS=${verdict.pass} FAIL=${verdict.fail}`)
      if (verdict.fail !== 0 || verdict.pass === 0) failures.push(`tests: ${verdict.fail} failing`)
    }
    if (t.code !== 0) failures.push(`test exited ${t.code}`)
  }

  // --- sweep ----------------------------------------------------------------
  const { files, prose, allAdded } = collectProse()
  const bounds = sweepBounds(prose)
  const long = overLong(allAdded)
  console.log(`  markdown files changed : ${files.length}`)
  console.log(`  added / prose lines    : ${allAdded.length} / ${prose.length}`)
  console.log(`  double space, 3 bounds : raw=${bounds.raw}  placeholder(outside inline code)=${bounds.placeholder}  deletion(upper bound)=${bounds.deletion}`)
  console.log(`  over-120               : ${long.length}`)
  console.log(`  controls               : ${controls.total} run, ${controls.failed.length} failed`)
  if (bounds.placeholder > 0) failures.push(`${bounds.placeholder} double spaces outside inline code`)
  if (long.length > 0) failures.push(`${long.length} lines over 120 characters`)

  if (failures.length > 0) {
    console.log('\nFAILED:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
    return
  }
  console.log('\nPASSED: heads agree, gates clean, sweep clean, controls fire')
}

main()
