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
 *   node scripts/verify.mjs                    gates + sweep
 *   node scripts/verify.mjs --sweep-only       skip the four gates
 *   node scripts/verify.mjs --mutate           prove every control can fail
 *   node scripts/verify.mjs --base=<sha|ref>   compare against something other
 *                                              than origin/main
 *
 * `--base` exists so the sweep can be gated. The identity block needs a remote
 * and `gh`; the **sweep does not** — it is a diff against a ref the runner
 * already has. A reviewer measured the consequence of not splitting them: the
 * controls got a CI trigger and the sweep did not, so the prose-defect class
 * that took four rounds to characterise was left guarded by a command nothing
 * runs. `--base=<pull_request.base.sha> --sweep-only` closes that with no
 * network and no remote resolution.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * What the sweep diffs against. `--base=<sha|ref>` overrides, so CI can pass a
 * SHA the runner already has instead of resolving a remote.
 *
 * Parsed rather than read straight from `argv` so a malformed flag fails loudly:
 * `--base=` with nothing after it silently became `''`, and `git diff ...HEAD`
 * against an empty ref is not an error — it is a diff against the empty tree,
 * which reports every line in the repository as added and would have passed a
 * clean sweep as a very large one.
 */
export function parseBase(argv, fallback = 'origin/main') {
  const flag = argv.find((a) => a.startsWith('--base='))
  if (flag === undefined) return { base: fallback, error: null }
  const value = flag.slice('--base='.length).trim()
  if (value === '') return { base: null, error: '--base= was given with no ref' }
  return { base: value, error: null }
}

const parsedBase = parseBase(process.argv)
const BASE = parsedBase.base ?? 'origin/main'


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

/**
 * Run `git` with an argument vector and **no shell**.
 *
 * `git` is a real executable on both platforms, so it never needed the shell
 * that the `.cmd` shims do — and routing it through one was a live defect for
 * the life of this file. The pathspec `-- *.md` is glob syntax to a POSIX
 * shell: bash expanded it against the working directory to the three
 * root-level markdown files, so `docs/**` was excluded and the sweep reported
 * **zero files changed** on every Linux run while working correctly on Windows,
 * where `cmd` does not glob.
 *
 * It therefore passed CI by measuring nothing, on the one platform CI uses,
 * in the step added to stop exactly that. Quoting would have fixed it in bash
 * and broken it in `cmd`; not invoking a shell fixes it in both.
 */
function runGit(args) {
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function git(...args) {
  // A failed git command must not become data. `run` concatenates stderr into
  // `out`, so returning it unconditionally puts `fatal: ...` into a field
  // labelled as a commit — and `|| '(none)'` never fires, because the error
  // text is truthy. Observed live in this instrument's own identity block.
  const r = runGit(args)
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

/**
 * Scan fences once, returning both the fenced line set and whether the file
 * ends with one open.
 *
 * Models CommonMark's fence rules rather than approximating them, because the
 * approximation's blind spots were shared by the guard built to cover it:
 *
 *  - a fence is **3+ backticks or 3+ tildes**, indented at most 3 spaces;
 *  - a closer must use the **same character**, be **at least as long**, and
 *    carry **no info string** — so ```` ``` ```` inside a ```` ```` ```` block is
 *    content, which is exactly how this document quotes fenced examples;
 *  - a backtick opener's info string **may not contain a backtick**.
 *
 * The previous version toggled on any `/^\s*```/`, so `~~~` was invisible, a
 * four-backtick wrapper reported unbalanced on a *valid* document and
 * misclassified in both directions, and the balance guard inherited every one
 * of those blind spots — because it was written from the same model as the
 * classifier it was guarding. **A guard is a control that runs in production**,
 * and deriving it from the model it protects makes it blind in precisely the
 * region that model is wrong in.
 */
function scanFences(source) {
  const fenced = new Set()
  let open = null
  source.split('\n').forEach((line, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!m) {
      if (open) fenced.add(i + 1)
      return
    }
    const char = m[1][0]
    const len = m[1].length
    const info = m[2]
    if (!open) {
      // An info string on a backtick fence may not contain a backtick; such a
      // line is ordinary text, not an opener.
      if (char === '`' && info.includes('`')) return
      fenced.add(i + 1)
      open = { char, len }
      return
    }
    fenced.add(i + 1)
    if (char === open.char && len >= open.len && info.trim() === '') open = null
  })
  return { fenced, balanced: open === null }
}

/** Line numbers inside ``` fences, computed from whole-file content. */
export function fencedLines(source) {
  return scanFences(source).fenced
}

/**
 * Does the file end with no fence open?
 *
 * An unterminated fence makes every line below it read as code, so the sweep
 * goes blind to the rest of the file and reports clean — the population
 * selector failing silently, which is the class this file catalogues
 * repeatedly. Asserted per file by the caller.
 */
export function fenceBalanced(source) {
  return scanFences(source).balanced
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
    // `\ No newline at end of file` is a diff annotation, not content. Under
    // -U0 every non-`+`/`-` line is spurious, and counting it as context shifts
    // every line number after it by one — which silently repositions the whole
    // population, because fence membership is keyed on those numbers.
    if (line.startsWith('\\')) continue
    // The file headers are `+++ b/path` and `--- a/path`, with a space. Testing
    // the bare prefix also swallowed an added line whose *content* began with
    // `++`, and did so without advancing the counter, misaligning the rest.
    if (/^\+\+\+ /.test(line) || /^--- /.test(line)) continue
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

/**
 * `{2,}`, not `{2}`. The original required **exactly** two spaces, so `a   b`
 * did not match — and three spaces is the *more likely* form of the defect this
 * detector exists for: a paragraph join where the first line ended in a trailing
 * space produces three, and trailing whitespace before a join is the common case.
 *
 * A reviewer found it; no control here could have. Every double-space control
 * was written with exactly two spaces, so the controls encoded the same model as
 * the detector and the mutation harness was a closed loop over that model —
 * proving the implementation matches the author's belief and structurally unable
 * to test whether the belief matches the world. Three spaces is not a cleverer
 * test than two; it is only a test the author had no reason to write.
 */
const DOUBLE_SPACE = /\S {2,}\S/


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
 * Classify a `gh pr view` result.
 *
 * Extracted so the error branch can be *driven* rather than reasoned about.
 * Five of the eight defects found in this file across two review rounds were
 * in paths that only run when something is already wrong — the `else` nobody
 * exercises and the `catch` that did not exist — because the happy path runs
 * every invocation and the failure path runs the first time it matters, which
 * is the first time anyone depends on it. An error branch reachable only by a
 * broken subprocess is an error branch nothing tests; a pure function taking
 * `{ code, out }` is one the controls below can hit directly.
 */
export function classifyPrResult({ code, out }) {
  if (code === 0) {
    try {
      const j = JSON.parse(out)
      // A merged or closed PR's head is frozen at what it landed as. Comparing
      // the working branch against it is not a currency check — the branch is
      // *supposed* to move past it — so the head is reported and excluded from
      // the comparison. Observed live: after a PR merged, this instrument
      // reported MISMATCH on a branch that was 0 behind main and entirely
      // clean, which is a red run for a reason that is not a defect.
      const state = String(j.state ?? '')
      const settled = state === 'MERGED' || state === 'CLOSED'
      return {
        head: settled ? `(${state.toLowerCase()} at ${String(j.headRefOid).slice(0, 7)})` : String(j.headRefOid).slice(0, 7),
        desc: `#${j.number} ${state} ${j.mergeStateStatus}`,
        failure: null,
      }
    } catch {
      return { head: '(unparsed)', desc: '', failure: 'gh returned output that could not be parsed as JSON' }
    }
  }
  if (/no pull requests? found/i.test(out)) {
    return { head: '(no pr)', desc: '', failure: null }
  }
  return {
    head: '(gh failed)',
    desc: '',
    failure: `gh failed, so the PR head could not be compared: ${out.trim().split('\n')[0] || `exit ${code}`}`,
  }
}

/** Which of local/remote/PR are comparable, and do they agree. */
export function headsAgree(sha, remote, prHead) {
  const comparable = [sha, remote, prHead].filter(
    (h) => h !== '(no remote)' && h !== '(no pr)' && !/^\((merged|closed) at /.test(h),
  )
  return comparable.every((h) => h === sha)
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
    name: 'sweep-catches-runs-longer-than-two',
    // The detector required exactly two spaces and missed three — which is the
    // *more likely* form of a paragraph join, because the first line usually
    // ends in a trailing space. Doped with a width the author's model did not
    // generate, which is why it took a second party.
    check: () => sweepBounds(['a   b']).raw === 1
      && sweepBounds(['a    b']).raw === 1
      && sweepBounds(['a     b']).raw === 1,
    mutate: () => sweepBounds(['a   b']).raw === 0,
  },
  {
    name: 'an-unterminated-fence-is-not-silently-code',
    check: () => fenceBalanced('a\n```\nb\n```\nc') === true
      && fenceBalanced('a\n```\nb\nc') === false,
    mutate: () => fenceBalanced('a\n```\nb\nc') === true,
  },
  {
    name: 'only-a-bare-fence-closes-a-block',
    // CommonMark: an opening fence may carry an info string, a closing fence
    // may not. A parity count over fence-shaped lines disagrees, silently.
    check: () => {
      // ```text opens, "``` more" is content, bare ``` closes -> balanced,
      // and the content line is inside the block.
      const src = 'a\n```text\n``` more\n```\nb'
      const { fenced, balanced } = { fenced: fencedLines(src), balanced: fenceBalanced(src) }
      return balanced === true && fenced.has(3) && !fenced.has(5)
    },
    mutate: () => fenceBalanced('a\n```text\n``` more\n```\nb') === false,
  },
  {
    name: 'tilde-fences-are-fences',
    check: () => fenceBalanced('a\n~~~\nb\nc') === false
      && fenceBalanced('a\n~~~\nb\n~~~\nc') === true
      && fencedLines('a\n~~~\nb\n~~~\nc').has(3),
    mutate: () => fenceBalanced('a\n~~~\nb\nc') === true,
  },
  {
    name: 'a-longer-fence-quotes-a-shorter-one',
    // Four backticks wrapping a three-backtick block — which is how this
    // document quotes fenced examples. The inner fences are content; only a
    // run at least as long as the opener closes it.
    check: () => {
      const src = 'a\n````\n```\ninner\n```\n````\nz'
      const f = fencedLines(src)
      return fenceBalanced(src) === true && f.has(4) && !f.has(7) && !f.has(1)
    },
    mutate: () => fencedLines('a\n````\n```\ninner\n```\n````\nz').has(7),
  },
  {
    name: 'a-mismatched-fence-char-does-not-close',
    check: () => fenceBalanced('a\n```\nb\n~~~\nc') === false,
    mutate: () => fenceBalanced('a\n```\nb\n~~~\nc') === true,
  },
  {
    name: 'the-no-newline-marker-does-not-shift-line-numbers',
    check: () => {
      const a = parseAddedLines('@@ -0,0 +1,2 @@\n+one\n\\ No newline at end of file\n+two\n')
      return a.length === 2 && a[0].lineNo === 1 && a[1].lineNo === 2
    },
    mutate: () => parseAddedLines('@@ -0,0 +1,2 @@\n+one\n\\ No newline at end of file\n+two\n')[1].lineNo === 3,
  },
  {
    name: 'an-added-line-starting-with-plus-plus-is-content',
    check: () => {
      const a = parseAddedLines('@@ -0,0 +1,3 @@\n+a\n+++x\n+c\n')
      return a.length === 3 && a[1].text === '++x' && a[2].lineNo === 3
    },
    mutate: () => parseAddedLines('@@ -0,0 +1,3 @@\n+a\n+++x\n+c\n').length === 2,
  },
  {
    name: 'the-file-header-is-still-skipped',
    check: () => {
      const a = parseAddedLines('--- a/f\n+++ b/f\n@@ -0,0 +1,1 @@\n+only\n')
      return a.length === 1 && a[0].text === 'only' && a[0].lineNo === 1
    },
    mutate: () => parseAddedLines('--- a/f\n+++ b/f\n@@ -0,0 +1,1 @@\n+only\n').length === 2,
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
  {
    name: 'no-pr-is-benign-and-a-broken-gh-is-not',
    // The defect this replaces: both cases exit non-zero with no JSON, both
    // left the head unset, the unset head was filtered out of the comparison,
    // and the run printed ALL AGREE with its PR arm switched off.
    check: () => {
      const absent = classifyPrResult({ code: 1, out: 'no pull requests found for branch "x"' })
      const broken = classifyPrResult({ code: 1, out: 'GraphQL: Could not resolve to a Repository' })
      return absent.failure === null && absent.head === '(no pr)'
        && broken.failure !== null && broken.head === '(gh failed)'
    },
    mutate: () => classifyPrResult({ code: 1, out: 'GraphQL: Could not resolve to a Repository' }).failure === null,
  },
  {
    name: 'unparseable-gh-output-is-a-failure',
    check: () => {
      const r = classifyPrResult({ code: 0, out: 'not json at all' })
      return r.failure !== null && r.head === '(unparsed)'
    },
    mutate: () => classifyPrResult({ code: 0, out: 'not json at all' }).failure === null,
  },
  {
    name: 'a-disabled-pr-arm-cannot-produce-agreement',
    // The whole point of the arm: `(gh failed)` must never compare equal.
    check: () => headsAgree('abc1234', 'abc1234', '(gh failed)') === false
      && headsAgree('abc1234', 'abc1234', 'abc1234') === true
      && headsAgree('abc1234', 'abc1234', '(no pr)') === true,
    mutate: () => headsAgree('abc1234', 'abc1234', '(gh failed)') === true,
  },
  {
    name: 'a-good-pr-result-parses-to-its-head',
    check: () => {
      const r = classifyPrResult({ code: 0, out: '{"headRefOid":"abc1234def","number":56,"state":"OPEN","mergeStateStatus":"CLEAN"}' })
      return r.head === 'abc1234' && r.failure === null && r.desc === '#56 OPEN CLEAN'
    },
    mutate: () => classifyPrResult({ code: 0, out: '{"headRefOid":"abc1234def","number":56,"state":"OPEN","mergeStateStatus":"CLEAN"}' }).head === 'abc1234def',
  },
  {
    name: 'a-merged-pr-head-is-not-a-currency-claim',
    // A merged PR's head is frozen at what it landed as, and the branch is
    // supposed to move past it. Comparing against it produced MISMATCH on a
    // branch that was clean and 0 behind main.
    check: () => {
      const merged = classifyPrResult({ code: 0, out: '{"headRefOid":"abc1234def","number":56,"state":"MERGED","mergeStateStatus":"UNKNOWN"}' })
      return merged.failure === null
        && /^\(merged at abc1234\)$/.test(merged.head)
        && headsAgree('9999999', '9999999', merged.head) === true
    },
    mutate: () => {
      const merged = classifyPrResult({ code: 0, out: '{"headRefOid":"abc1234def","number":56,"state":"MERGED","mergeStateStatus":"UNKNOWN"}' })
      return headsAgree('9999999', '9999999', merged.head) === false
    },
  },
  {
    name: 'an-open-pr-head-still-must-agree',
    // The exemption must not leak: an OPEN PR whose head differs is still a
    // failure, which is the whole reason the check exists.
    check: () => {
      const open = classifyPrResult({ code: 0, out: '{"headRefOid":"abc1234def","number":56,"state":"OPEN","mergeStateStatus":"CLEAN"}' })
      return headsAgree('9999999', '9999999', open.head) === false
        && headsAgree('abc1234', 'abc1234', open.head) === true
    },
    mutate: () => {
      const open = classifyPrResult({ code: 0, out: '{"headRefOid":"abc1234def","number":56,"state":"OPEN","mergeStateStatus":"CLEAN"}' })
      return headsAgree('9999999', '9999999', open.head) === true
    },
  },
  {
    name: 'a-partition-reports-its-own-residual',
    // The defect this closes: prose and fenced were reported against the total
    // with no arm for "neither", so a file skipped by a guard contributed to
    // the total and to neither bucket, silently. An equality, not a threshold.
    check: () => partitionResidual(29, [18, 9]) === 2
      && partitionResidual(27, [18, 9]) === 0
      && partitionResidual(10, [20]) === -10,
    mutate: () => partitionResidual(29, [18, 9]) === 0,
  },
  {
    name: 'a-skipped-file-shows-up-as-residual',
    check: () => partitionResidual(12, [5, 4]) === 3,
    mutate: () => partitionResidual(12, [5, 4]) === 0,
  },
  {
    name: 'an-empty-base-flag-is-an-error-not-a-default',
    // `--base=` with nothing after it became '', and `git diff ...HEAD` against
    // an empty ref is not an error — it diffs the empty tree and reports the
    // whole repository as added. A clean sweep would have passed as a very
    // large one.
    check: () => {
      const empty = parseBase(['node', 'verify.mjs', '--base='])
      const given = parseBase(['node', 'verify.mjs', '--base=abc123'])
      const absent = parseBase(['node', 'verify.mjs'])
      return empty.error !== null && empty.base === null
        && given.error === null && given.base === 'abc123'
        && absent.error === null && absent.base === 'origin/main'
    },
    mutate: () => parseBase(['node', 'verify.mjs', '--base=']).error === null,
  },
  {
    name: 'a-supplied-base-does-not-become-the-fallback',
    check: () => parseBase(['node', 'verify.mjs', '--base=deadbee'], 'origin/main').base === 'deadbee',
    mutate: () => parseBase(['node', 'verify.mjs', '--base=deadbee'], 'origin/main').base === 'origin/main',
  },
  {
    name: 'the-md-pathspec-reaches-git-unexpanded',
    // The defect: `-- *.md` inside a shell string is glob syntax. bash expanded
    // it to the root-level markdown files, excluding `docs/**`, so the sweep
    // reported zero files on Linux and worked on Windows. This drives real git
    // and asserts a nested path is reachable — which is false under expansion
    // and true without a shell, on either platform.
    check: () => {
      const listed = git('ls-files', '--', '*.md')
      if (listed === null) return false
      const paths = listed.split('\n').filter(Boolean)
      return paths.some((p) => p.includes('/')) && paths.some((p) => !p.includes('/'))
    },
    mutate: () => {
      // Stand in for the expanded pathspec: root-level names only.
      const rootOnly = (git('ls-files', '--', '*.md') ?? '').split('\n').filter((p) => p && !p.includes('/'))
      return rootOnly.some((p) => p.includes('/'))
    },
  },
]

function runControls() {
  // A throwing `check()` must be classified, not fatal. `runControls()` is the
  // first thing `main()` calls, so an exception here printed nothing at all —
  // not even the header — while the `--mutate` path had `UNTESTABLE` machinery
  // for exactly this, built in the same commit. Fail-closed either way; the
  // defect was the asymmetry and the absent verdict line.
  const failed = []
  const broken = []
  for (const c of CONTROLS) {
    let ok
    try {
      ok = c.check() === true
    } catch (err) {
      broken.push(`${c.name} (${err instanceof Error ? err.message : String(err)})`)
      continue
    }
    if (!ok) failed.push(c.name)
  }
  return { total: CONTROLS.length, failed, broken }
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
  console.log(`\n${CONTROLS.length} controls, ${controls.failed.length} failed live, ${controls.broken.length} broken, ${survived.length} survived mutation, ${untestable.length} untestable`)
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
  if (controls.broken.length > 0) problems.push(`${controls.broken.length} controls threw: ${controls.broken.join(', ')}`)
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
  const fencedOut = []
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
    if (!fenceBalanced(source)) {
      unreadable.push(`${file} (unterminated \`\`\` fence — every line below it would read as code)`)
      continue
    }
    const fenced = fencedLines(source)
    for (const { lineNo, text } of added) {
      if (fenced.has(lineNo)) fencedOut.push(text)
      else prose.push(text)
    }
  }
  return { files, prose, fencedOut, allAdded, unreadable }
}

/**
 * The parts must sum to the population.
 *
 * `prose` and `fencedOut` partition `allAdded` — except that a file skipped by
 * any guard above contributes to `allAdded` and to neither bucket, silently. A
 * partition with no residual bucket cannot report that it dropped anything, so
 * the residual is computed and asserted rather than assumed to be zero. This is
 * an **equality**, not a threshold: thresholds are what the rest of this file
 * uses, and an equality is what a decomposition needs.
 */
export function partitionResidual(total, parts) {
  return total - parts.reduce((a, b) => a + b, 0)
}

function main() {
  if (process.argv.includes('--mutate')) {
    runMutation()
    return
  }

  const stamp = new Date().toTimeString().slice(0, 8)
  const failures = []
  if (parsedBase.error !== null) failures.push(parsedBase.error)

  // An explicit `--base` means the caller is supplying a ref because remote
  // resolution is unavailable — a CI runner has the base SHA and has neither a
  // configured remote branch nor `gh`. Comparing local/remote/PR heads there
  // would fail for the environment rather than for the tree, which is a red run
  // for the wrong reason: the defect this file records twice.
  const suppliedBase = process.argv.some((a) => a.startsWith('--base='))

  const controls = runControls()
  if (controls.failed.length > 0) failures.push(`controls failed: ${controls.failed.join(', ')}`)
  if (controls.broken.length > 0) failures.push(`controls threw: ${controls.broken.join(', ')}`)

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
  const remoteRaw = suppliedBase ? null : git('rev-parse', '--short', `origin/${branch}`)
  const remote = suppliedBase ? '(not compared)' : (remoteRaw === null ? '(no remote)' : remoteRaw)
  const behind = git('rev-list', '--count', `HEAD..${BASE}`)
  const status = git('status', '--porcelain')
  if (behind === null) failures.push(`could not compare against ${BASE}`)
  if (status === null) failures.push('could not read working tree status')
  const dirty = status === null ? null : status.split('\n').filter(Boolean).length
  const pr = suppliedBase ? null : run('gh pr view --json headRefOid,number,state,mergeStateStatus')
  const prResult = pr === null
    ? { head: '(not compared)', desc: '', failure: null }
    : classifyPrResult(pr)
  const prHead = prResult.head
  const prDesc = prResult.desc
  if (prResult.failure !== null) failures.push(prResult.failure)
  const agree = suppliedBase ? true : headsAgree(sha, remote, prHead)

  console.log(`VERIFIED AT ${stamp}`)
  console.log(`  branch                 : ${branch}`)
  console.log(`  local / remote / pr    : ${sha} / ${remote} / ${prHead}${suppliedBase ? '   [--base supplied: identity not compared]' : `  -> ${agree ? 'ALL AGREE' : 'MISMATCH'}`}`)
  if (prDesc) console.log(`  pull request           : ${prDesc}`)
  console.log(`  behind ${BASE} / dirty : ${behind ?? '(git error)'} / ${dirty ?? '(git error)'}${suppliedBase ? '   [--base is a fixed point, not a currency referent]' : ''}`)
  if (!agree) failures.push('local, remote and PR head do not all agree')
  // `behind` asserts currency: the branch should not be missing commits the base
  // has. A supplied `--base` is a **fixed comparison point** — a PR's base SHA,
  // or a chosen earlier tip — not a moving referent, so asserting currency
  // against it is a category error and the two halves of this mode would
  // disagree about whether currency is being claimed at all. Reported, not
  // failed, when supplied.
  if (!suppliedBase && behind !== null && behind !== '0') failures.push(`branch is ${behind} behind ${BASE}`)
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
  const { files, prose, fencedOut, allAdded, unreadable } = collectProse()
  const bounds = sweepBounds(prose)
  const long = overLong(allAdded)
  const residual = partitionResidual(allAdded.length, [prose.length, fencedOut.length])
  console.log(`  markdown files changed : ${files.length}${files.length === 0 ? '  (sweep examined nothing and contributes nothing below)' : ''}`)
  console.log(`  added = prose + fenced : ${allAdded.length} = ${prose.length} + ${fencedOut.length}${residual === 0 ? '' : `  RESIDUAL ${residual}`}`)
  console.log(`  double space, 3 bounds : raw=${bounds.raw}  placeholder(outside inline code)=${bounds.placeholder}  deletion(upper bound)=${bounds.deletion}   [prose only]`)
  console.log(`  over-120               : ${long.length}   [all added lines, fenced included — long code lines break rendering too]`)
  console.log(`  controls               : ${controls.total} run, ${controls.failed.length} failed, ${controls.broken.length} broken`)
  if (residual !== 0) failures.push(`${residual} added lines fell into neither bucket — the partition does not sum to its population`)
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

// Only run when invoked as the entry point. The exports above exist to be
// imported, and importing them used to execute the whole verification —
// including `npm test`, so a test importing one of these functions would
// re-enter `npm test` from inside `npm test`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
