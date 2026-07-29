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
function run(command, opts = {}) {
  // Windows ships npm/npx/gh as `.cmd` shims, which `spawnSync` refuses to
  // execute without a shell. DEP0190 is about passing an *args array* alongside
  // `shell: true` — arguments are concatenated unescaped — so the command is
  // built here as one string instead. Every command in this file is a fixed
  // literal with no interpolated input, which is what makes that safe; do not
  // pass caller-supplied text through this function.
  const r = spawnSync(command, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function git(...args) {
  // A failed git command must not become data. `run` concatenates stderr into
  // `out`, so returning it unconditionally puts `fatal: ...` into a field
  // labelled as a commit — and `|| '(none)'` never fires, because the error
  // text is truthy. Observed live in this instrument's own identity block.
  const r = run(['git', ...args].join(' '))
  return r.code === 0 ? r.out.trim() : null
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

/**
 * `--mutate`: every control must go red under its own mutation.
 *
 * It also runs the real `check()`s, because CI runs *only* this path. Without
 * that, a corruption where both `check()` and `mutate()` are false is invisible
 * to the gate: a reviewer stubbed `sweepBounds` to a constant and got
 * `0 survived / PASSED / exit 0` here while four controls were failing their
 * real assertions.
 *
 * A `mutate()` that throws is `UNTESTABLE`, not `CAUGHT`. A mutation that never
 * ran is not evidence that the control can fire, and scoring it as a catch errs
 * toward green — the direction this whole file names as the dangerous one.
 * `strategy-facts.mjs` has carried an `untestable` category since before this
 * script existed; the guard did not come across.
 */
function runMutation() {
  const controls = runControls()
  const survived = []
  const untestable = []
  for (const c of CONTROLS) {
    let healthy
    try {
      healthy = c.mutate() === true
    } catch (err) {
      untestable.push(`${c.name} (${err instanceof Error ? err.message : String(err)})`)
      continue
    }
    if (healthy) survived.push(c.name)
  }
  console.log(`\n${CONTROLS.length} controls, ${controls.failed.length} failed live, ${survived.length} survived mutation, ${untestable.length} untestable`)
  for (const c of CONTROLS) {
    const bad = survived.includes(c.name) || untestable.some((u) => u.startsWith(`${c.name} `))
    const red = controls.failed.includes(c.name)
    let verdict = 'CAUGHT  '
    if (untestable.some((u) => u.startsWith(`${c.name} `))) verdict = 'UNTESTABLE'
    else if (survived.includes(c.name)) verdict = 'SURVIVED'
    console.log(`  ${verdict}${bad || red ? '' : '  '}${red ? '  CHECK-RED' : ''}  ${c.name}`)
  }
  const problems = []
  if (controls.failed.length > 0) problems.push(`${controls.failed.length} controls fail their live assertion: ${controls.failed.join(', ')}`)
  if (survived.length > 0) problems.push(`${survived.length} survived mutation: ${survived.join(', ')}`)
  if (untestable.length > 0) problems.push(`${untestable.length} untestable: ${untestable.join(', ')}`)
  if (problems.length > 0) {
    console.log('\nFAILED:')
    for (const p of problems) console.log(`  - ${p}`)
    process.exitCode = 1
    return
  }
  console.log('\nPASSED: every control holds live and goes red under its mutation')
}

function collectProse() {
  const listed = git('diff', '--name-only', `${BASE}...HEAD`, '--', '*.md')
  if (listed === null) return { files: [], prose: [], allAdded: [], unreadable: ['(git diff failed)'] }
  const files = listed.split('\n').map((f) => f.trim()).filter(Boolean)

  // Domain guard, the shape `strategy-facts.mjs` has carried since before this
  // script: a scan that read nothing reports no offenders and looks identical to
  // a clean one. Zero markdown files in the diff is legitimate and is *stated*;
  // a file that is listed and then unreadable or empty is a failure, because
  // that is the case where the clean result is a lie.
  const unreadable = []
  const prose = []
  const allAdded = []
  for (const file of files) {
    const diff = git('diff', '-U0', `${BASE}...HEAD`, '--', file)
    if (diff === null) {
      unreadable.push(`${file} (diff failed)`)
      continue
    }
    const added = parseAddedLines(diff)
    allAdded.push(...added.map((a) => a.text))
    const path = join(ROOT, file)
    if (!existsSync(path)) {
      unreadable.push(`${file} (not on disk)`)
      continue
    }
    const source = readFileSync(path, 'utf8')
    if (source.length === 0) {
      unreadable.push(`${file} (empty)`)
      continue
    }
    const fenced = fencedLines(source)
    for (const { lineNo, text } of added) {
      if (!fenced.has(lineNo)) prose.push(text)
    }
  }
  return { files, prose, allAdded, unreadable }
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
  // A null here is a failed git command, not an answer. Distinguishing "no
  // remote" from "git errored" matters: the second must fail the run, and both
  // used to render as a truthy string in a field labelled as a commit.
  const sha = git('rev-parse', '--short', 'HEAD')
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (sha === null || branch === null) {
    console.log('FAILED: could not resolve HEAD — git errored, so nothing below would describe a known object')
    process.exitCode = 1
    return
  }
  const remoteRaw = git('rev-parse', '--short', `origin/${branch}`)
  const remote = remoteRaw === null ? '(no remote)' : remoteRaw
  const behind = git('rev-list', '--count', `HEAD..${BASE}`)
  const status = git('status', '--porcelain')
  if (behind === null) failures.push(`could not compare against ${BASE}`)
  if (status === null) failures.push('could not read working tree status')
  const dirty = status === null ? null : status.split('\n').filter(Boolean).length
  const pr = run('gh pr view --json headRefOid,number,state,mergeStateStatus')
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
  const heads = [sha, remote, prHead].filter((h) => h !== '(no remote)' && h !== '(no pr)')
  const agree = heads.every((h) => h === sha)

  console.log(`VERIFIED AT ${stamp}`)
  console.log(`  branch                 : ${branch}`)
  console.log(`  local / remote / pr    : ${sha} / ${remote} / ${prHead}  -> ${agree ? 'ALL AGREE' : 'MISMATCH'}`)
  if (prDesc) console.log(`  pull request           : ${prDesc}`)
  console.log(`  behind ${BASE} / dirty : ${behind ?? '(git error)'} / ${dirty ?? '(git error)'}`)
  if (!agree) failures.push('local, remote and PR head do not all agree')
  if (behind !== null && behind !== '0') failures.push(`branch is ${behind} behind ${BASE}`)
  if (dirty !== null && dirty !== 0) failures.push(`working tree has ${dirty} modified paths`)

  // --- gates: each exit code captured on its own ----------------------------
  if (!process.argv.includes('--sweep-only')) {
    // Every gate delegates to package.json rather than restating the command.
    // `npx oxlint src tests` sat here and is narrower than the project's own
    // `oxlint`, which lints the whole repository — so this instrument reported
    // "gates clean" over a lint state the project's gate reports, and the
    // directory it excluded was `scripts/`, where it lives. Carry the
    // derivation, not the value.
    const gates = [
      ['build', 'npm run build'],
      ['lint', 'npm run lint'],
      ['docsfacts', 'npm run docs:facts'],
    ]
    const codes = []
    let lintFindings = null
    for (const [name, command] of gates) {
      const { code, out } = run(command)
      codes.push(`${name}=${code}`)
      if (code !== 0) failures.push(`${name} exited ${code}`)
      if (name === 'lint') {
        // oxlint exits 0 on warnings, so `lint=0` is a verdict about *errors*
        // and says nothing about findings — the census-versus-verdict shape in
        // a second gate. Report the count beside the code so it cannot be read
        // as "no findings"; do not fail on warnings, because that would make
        // this instrument silently stricter than the project's own gate.
        const lines = out.split('\n').filter((l) => /:\d+:\d+: (warning|error)\b/.test(l))
        lintFindings = lines.length
      }
    }
    const t = run('npm test')
    codes.push(`test=${t.code}`)
    const verdict = parseTestVerdict(t.out)
    console.log(`  exit codes             : ${codes.join(' ')}`)
    if (lintFindings !== null) {
      console.log(`  lint findings          : ${lintFindings}   [oxlint exits 0 on warnings — the code is a verdict on errors only]`)
    }
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
  const { files, prose, allAdded, unreadable } = collectProse()
  const bounds = sweepBounds(prose)
  const long = overLong(allAdded)
  console.log(`  markdown files changed : ${files.length}${files.length === 0 ? '  (sweep examined nothing and contributes nothing below)' : ''}`)
  console.log(`  added / prose lines    : ${allAdded.length} / ${prose.length}`)
  console.log(`  double space, 3 bounds : raw=${bounds.raw}  placeholder(outside inline code)=${bounds.placeholder}  deletion(upper bound)=${bounds.deletion}   [prose only]`)
  console.log(`  over-120               : ${long.length}   [all added lines, fenced included — long code lines break rendering too]`)
  console.log(`  controls               : ${controls.total} run, ${controls.failed.length} failed`)
  if (unreadable.length > 0) failures.push(`sweep could not read: ${unreadable.join(', ')}`)
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
