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
 * The six properties, each with its originating failure:
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
 * 6. **The population is selected from authoritative git data, not from a
 *    convenient rendering of it.** Both halves of this were merged defects and
 *    both were silent in the same direction. `git diff --name-only` is a list of
 *    paths with the *reason* for each one stripped off, so a **deleted** `.md`
 *    was listed, had no head path to read, and failed the run on a legitimate
 *    change — and the same rendering C-quotes any non-ASCII path, so a unicode
 *    filename produced a name no filesystem has. Statuses are now read from
 *    `--name-status -z`, enumerated rather than inferred, with renames swept at
 *    their destination. The other half: `git diff -U0` of a **binary** `.md`
 *    prints `Binary files ... differ` and no `+` rows, so both buckets took zero
 *    and the partition equality below was satisfied as `0 = 0 + 0`. A partition
 *    asserts that the parts sum to the population; it cannot assert that the
 *    population is the truth. `--numstat -z` reports `-`/`-` where a unified
 *    diff reports nothing, and the counts it gives are reconciled against the
 *    parser's rows per file.
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
function runGit(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
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
  const r = runGit(args)
  return r.code === 0 ? r.out.trim() : null
}

/**
 * The same, without the trim.
 *
 * `git(...)` trims because every caller of it wants one short token — a SHA, a
 * branch name, a count. NUL-delimited output is not that: the fields are the
 * payload, a path may legitimately begin or end with a space, and trimming a
 * record set is a way to corrupt one path in a thousand and never hear about
 * it. Diff bodies get the same treatment for the same reason — a trailing
 * whitespace-only added line is content the over-long detector should see.
 */
function gitRaw(...args) {
  const r = runGit(args)
  return r.code === 0 ? r.out : null
}

/**
 * The empty tree's object id, asked of git rather than pasted in.
 *
 * `4b825dc...` is the SHA-1 answer and is wrong in a SHA-256 repository, so the
 * constant would be a control that silently stops running. Nothing is written:
 * `hash-object` without `-w` computes and prints.
 */
function emptyTree() {
  const r = runGit(['hash-object', '-t', 'tree', '--stdin'], { input: '' })
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
 * Which diff statuses the sweep scans, which it deliberately skips, and — by
 * being in neither set — which it refuses.
 *
 * The sweep used to take `git diff --name-only`, which is a list of paths with
 * the reason for each one stripped off. A deletion is in that list, its head
 * path does not exist, and the file was therefore reported as *unreadable* —
 * a red run on a legitimate change, on the one status where "not on disk" is
 * the correct state rather than a fault. `--name-only` cannot distinguish the
 * two because it is not told to.
 *
 * So the statuses are enumerated instead of inferred:
 *
 *   scan  A M R C T   a head blob exists and its added lines are prose
 *   skip  D           the file is gone; there is nothing at HEAD to read
 *
 * Anything else — `U` (unmerged), `X` (git's own "should not happen"), `B` (a
 * broken pairing), or a letter git has not shipped yet — is neither scanned nor
 * skipped but **named and failed**. A default of "scan it" turns an unmerged
 * path into an unreadable-file failure; a default of "skip it" is the silent
 * drop this file exists to make impossible. Renames and copies are scanned at
 * their **destination**, because that is the path that exists at HEAD and the
 * path whose content the sweep is about to read.
 */
export const SWEEP_STATUSES = Object.freeze({
  scan: Object.freeze(['A', 'M', 'R', 'C', 'T']),
  skip: Object.freeze(['D']),
})

/**
 * Parse `git diff --name-status -z`.
 *
 * `-z` is not a formatting preference. Without it git C-quotes any path that is
 * not plain ASCII — `docs/re named ünïcode.md` comes back as
 * `"docs/re named \303\274n\303\257code.md"`, quotes and octal escapes included
 * — and every consumer downstream then looks for a file by a name no filesystem
 * has. Splitting on newlines is the same class of bug one layer up: a newline is
 * a legal character in a path.
 *
 * The record grammar, from `git-diff(1)`:
 *
 *   <status> NUL <path> NUL                       for A M D T U X B
 *   <status><score> NUL <src> NUL <dst> NUL       for R and C
 *
 * A record that does not start with a status letter, or that ends before its
 * paths, aborts the walk with an error rather than resynchronising — a
 * half-parsed file list is a population selector that silently narrowed.
 */
export function parseNameStatusZ(out) {
  const fields = out.split('\0')
  while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
  const entries = []
  const skipped = []
  const errors = []
  let i = 0
  while (i < fields.length) {
    const token = fields[i]
    const m = /^([A-Z])(\d*)$/.exec(token)
    if (m === null) {
      errors.push(`git --name-status -z produced "${token}" where a status was expected, so the changed-file list could not be read`)
      break
    }
    const status = m[1]
    const paired = status === 'R' || status === 'C'
    const need = paired ? 2 : 1
    if (fields.length - (i + 1) < need) {
      errors.push(`git --name-status -z ended after status "${token}" without its ${need === 2 ? 'source and destination paths' : 'path'}`)
      break
    }
    const from = paired ? fields[i + 1] : null
    const path = paired ? fields[i + 2] : fields[i + 1]
    i += 1 + need
    if (SWEEP_STATUSES.skip.includes(status)) {
      skipped.push({ status, path })
      continue
    }
    if (!SWEEP_STATUSES.scan.includes(status)) {
      errors.push(`${path} carries diff status "${token}", which the sweep neither scans nor skips`)
      continue
    }
    entries.push({ status, path, from })
  }
  return { entries, skipped, errors }
}

/**
 * Parse `git diff --numstat -z` — the authoritative added/deleted counts.
 *
 * This exists because of the second silent pass: a Markdown file whose content
 * is binary. `git diff -U0` prints `Binary files a/x.md and b/x.md differ` and
 * no `+` rows at all, so the diff parser found nothing, both buckets took
 * nothing, and the partition equality was satisfied as `0 = 0 + 0`. The
 * decomposition was sound and the population was empty — which is the failure
 * mode a partition cannot see, because it checks that the parts sum to the
 * total and not that the total is the truth.
 *
 * `--numstat` answers the question the unified diff cannot: it reports `-` and
 * `-` for a binary file instead of `0` and `0`, so "no added lines" and "no
 * readable lines" stop being the same observation.
 *
 * Record grammar, from `git-diff(1)`:
 *
 *   <added> TAB <deleted> TAB [ <src> NUL ] <dst> NUL
 *
 * A rename puts nothing between the second tab and the NUL, so an empty path in
 * the leading field *is* the rename marker — the two paths that follow are then
 * unambiguous, with no need to guess where one record ends and the next begins.
 */
export function parseNumstatZ(out) {
  const fields = out.split('\0')
  while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
  const rows = []
  const errors = []
  let i = 0
  while (i < fields.length) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[i])
    if (m === null) {
      errors.push(`git --numstat -z produced "${fields[i]}", which is not "<added> TAB <deleted> TAB <path>"`)
      break
    }
    const paired = m[3] === ''
    if (paired && fields.length - (i + 1) < 2) {
      errors.push('git --numstat -z announced a rename and then ended without both paths')
      break
    }
    const from = paired ? fields[i + 1] : null
    const path = paired ? fields[i + 2] : m[3]
    i += paired ? 3 : 1
    const binary = m[1] === '-' || m[2] === '-'
    rows.push({
      added: binary ? null : Number(m[1]),
      deleted: binary ? null : Number(m[2]),
      binary,
      path,
      from,
    })
  }
  return { rows, errors }
}

/** Strict UTF-8: throws rather than substituting U+FFFD for bytes it cannot read. */
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true })

/**
 * Is this byte string something the sweep can honestly call Markdown?
 *
 * The second, independent gate on the binary-Markdown defect, and independent on
 * purpose: `--numstat` reports what *git* decided, and git decides by looking
 * for a NUL in the first 8000 bytes — a `.gitattributes` line, a NUL past that
 * window, or a file that is merely mis-encoded all land outside it. This gate
 * reads the bytes at HEAD instead.
 *
 * `readFileSync(path, 'utf8')` is the reason the second half matters: it does
 * not fail on invalid UTF-8, it substitutes U+FFFD. The sweep would then run its
 * detectors over replacement characters and report a clean result for a file
 * whose committed bytes it never saw — the same shape as the binary case, one
 * layer down.
 */
export function classifyMarkdownBytes(bytes) {
  if (bytes.includes(0)) {
    return { ok: false, reason: 'contains a NUL byte, so it is binary content behind a Markdown extension' }
  }
  try {
    UTF8_STRICT.decode(bytes)
  } catch {
    return { ok: false, reason: 'is not valid UTF-8, so reading it as text substitutes replacement characters for the bytes actually committed' }
  }
  return { ok: true, reason: null }
}

/**
 * Do the rows the diff parser found agree with the count git reports?
 *
 * The partition equality below asserts that `prose + fenced` sums to `allAdded`.
 * It is a statement about the *decomposition* and says nothing about whether
 * `allAdded` is the right population — `0 = 0 + 0` is a valid partition of
 * nothing, and a binary file produces exactly that. This is the missing half:
 * an equality against a count that comes from git rather than from the parser
 * being checked, so the two can disagree.
 *
 * Returns the reason as text, because a boolean here would reproduce the defect
 * it closes — a run that fails without naming the file is a run whose author
 * goes looking, and the failures worth catching are the ones nobody looks for.
 */
export function reconcileAddedRows(file, parsedAdded, row) {
  if (row === undefined || row === null) {
    return `${file} (git reported no numstat row for it, so the ${parsedAdded} parsed added lines corroborate nothing)`
  }
  if (row.binary) {
    return `${file} (binary to git — numstat reported -/-, so the diff carries no added rows and the sweep would pass it clean)`
  }
  if (row.added !== parsedAdded) {
    return `${file} (git counted ${row.added} added lines, the diff parser found ${parsedAdded} — the sweep would scan a different population than the diff contains)`
  }
  return null
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
    name: 'a-closed-unmerged-pr-is-settled-too',
    // Live observation supplied by a reviewer, not an analogy to MERGED:
    // #63 closed unmerged at 10:15:55Z with head b968e5e while its branch later
    // stood at 21b8156; headRefOid and mergeStateStatus froze. Comparing either
    // as current is the same category error as comparing a merged PR's head.
    //
    // This control owns classifyPrResult's `state === 'CLOSED'` arm. Removing
    // that arm makes the check red and the mutation survive.
    check: () => {
      const closed = classifyPrResult({
        code: 0,
        out: '{"headRefOid":"b968e5e999","number":63,"state":"CLOSED","mergeStateStatus":"BEHIND"}',
      })
      return closed.failure === null
        && closed.head === '(closed at b968e5e)'
        && closed.desc === '#63 CLOSED BEHIND'
    },
    mutate: () => classifyPrResult({
      code: 0,
      out: '{"headRefOid":"b968e5e999","number":63,"state":"CLOSED","mergeStateStatus":"BEHIND"}',
    }).head === 'b968e5e',
  },
  {
    name: 'a-closed-pr-head-is-excluded-from-currency',
    // Separate from the classifier control because headsAgree has its own
    // settled-state model. A sibling session removed `|closed` from that regex
    // and every existing control stayed green.
    check: () =>
      headsAgree('21b8156', '21b8156', '(closed at b968e5e)') === true
      && headsAgree('21b8156', '21b8156', 'b968e5e') === false,
    mutate: () =>
      headsAgree('21b8156', '21b8156', '(closed at b968e5e)') === false,
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
  {
    name: 'the-success-verdict-names-only-checks-that-ran',
    // Four invocation modes, four conclusions. Exact strings make skipped
    // checks impossible to smuggle back into a fixed summary line.
    check: () =>
      successVerdict({ identityCompared: true, gatesRun: true })
        === 'PASSED: heads agree, gates clean, sweep clean, controls fire'
      && successVerdict({ identityCompared: false, gatesRun: true })
        === 'PASSED: gates clean, sweep clean, controls fire'
      && successVerdict({ identityCompared: true, gatesRun: false })
        === 'PASSED: heads agree, sweep clean, controls fire'
      && successVerdict({ identityCompared: false, gatesRun: false })
        === 'PASSED: sweep clean, controls fire',
    mutate: () =>
      successVerdict({ identityCompared: false, gatesRun: false })
        .includes('gates clean'),
  },

  // --- defect 1: a deleted markdown file failed the sweep --------------------
  {
    name: 'a-deleted-markdown-file-is-skipped-not-unreadable',
    // The merged defect. `--name-only` lists a deletion with no reason attached,
    // the head path does not exist, and the sweep reported it as unreadable —
    // a red run on a legitimate change, on the one status where "not on disk"
    // is the correct state rather than a fault.
    check: () => {
      const { entries, skipped, errors } = parseNameStatusZ('M\u0000docs/a.md\u0000D\u0000docs/gone.md\u0000')
      return errors.length === 0
        && entries.length === 1 && entries[0].path === 'docs/a.md'
        && skipped.length === 1 && skipped[0].path === 'docs/gone.md' && skipped[0].status === 'D'
    },
    mutate: () => parseNameStatusZ('M\u0000docs/a.md\u0000D\u0000docs/gone.md\u0000')
      .entries.some((e) => e.path === 'docs/gone.md'),
  },
  {
    name: 'a-rename-is-swept-at-its-destination',
    // Two paths in one record. The destination is the one that exists at HEAD
    // and the one whose content the sweep is about to read; taking the source
    // reproduces the deletion defect with a different spelling.
    check: () => {
      const { entries, errors } = parseNameStatusZ('R077\u0000docs/old.md\u0000docs/new.md\u0000M\u0000docs/a.md\u0000')
      return errors.length === 0 && entries.length === 2
        && entries[0].status === 'R' && entries[0].path === 'docs/new.md' && entries[0].from === 'docs/old.md'
        && entries[1].path === 'docs/a.md'
    },
    mutate: () => parseNameStatusZ('R077\u0000docs/old.md\u0000docs/new.md\u0000M\u0000docs/a.md\u0000')
      .entries[0].path === 'docs/old.md',
  },
  {
    name: 'a-path-with-spaces-and-unicode-survives-the-parser',
    // Trailing whitespace in a path is why the record is not trimmed, and the
    // mutation is the shape the old listing actually produced.
    check: () => {
      const uni = 'docs/re named \u00fcn\u00efcode.md'
      const spaced = 'docs/trailing space .md '
      const { entries, errors } = parseNameStatusZ(`M\u0000${uni}\u0000A\u0000${spaced}\u0000`)
      return errors.length === 0 && entries.length === 2
        && entries[0].path === uni && entries[1].path === spaced
        && !entries[0].path.includes('\\303')
    },
    mutate: () => {
      // What `--name-only` hands back for that path: C-quoted, newline
      // delimited, and a name no filesystem has.
      const quoted = '"docs/re named \\303\\274n\\303\\257code.md"'
      return quoted.split('\n').map((f) => f.trim()).filter(Boolean)[0] === 'docs/re named \u00fcn\u00efcode.md'
    },
  },
  {
    name: 'an-ordinary-modification-still-reaches-the-sweep',
    // The repair must not narrow the population it was repairing: a plain `M`
    // parses, its numstat row reconciles, and its added line reaches the
    // detectors. Every guard above is a way to stop looking at a file.
    check: () => {
      const { entries, skipped, errors } = parseNameStatusZ('M\u0000README.md\u0000')
      const row = parseNumstatZ('1\t0\tREADME.md\u0000').rows[0]
      const added = parseAddedLines('@@ -3,0 +4 @@\n+a  b\n')
      return errors.length === 0 && skipped.length === 0
        && entries.length === 1 && entries[0].status === 'M' && entries[0].path === 'README.md'
        && row.binary === false && row.added === 1
        && reconcileAddedRows('README.md', added.length, row) === null
        && sweepBounds(added.map((a) => a.text)).raw === 1
    },
    mutate: () => parseNameStatusZ('M\u0000README.md\u0000').entries.length === 0,
  },
  {
    name: 'an-unrecognised-status-is-named-rather-than-guessed-at',
    // Defaulting to "scan it" turns an unmerged path into an unreadable-file
    // failure; defaulting to "skip it" is the silent drop. Both are guesses,
    // and the third option is to say which status and which path.
    check: () => {
      const u = parseNameStatusZ('U\u0000docs/a.md\u0000')
      const junk = parseNameStatusZ('docs/a.md\u0000')
      return u.entries.length === 0 && u.skipped.length === 0
        && u.errors.length === 1 && u.errors[0].includes('docs/a.md') && u.errors[0].includes('"U"')
        && junk.errors.length === 1 && junk.errors[0].includes('where a status was expected')
    },
    mutate: () => parseNameStatusZ('U\u0000docs/a.md\u0000').errors.length === 0,
  },
  {
    name: 'a-truncated-name-status-record-does-not-half-parse',
    check: () => {
      const t = parseNameStatusZ('M\u0000docs/a.md\u0000R100\u0000docs/old.md\u0000')
      return t.entries.length === 1 && t.entries[0].path === 'docs/a.md'
        && t.errors.length === 1 && t.errors[0].includes('without its source and destination paths')
    },
    mutate: () => parseNameStatusZ('M\u0000docs/a.md\u0000R100\u0000docs/old.md\u0000').errors.length === 0,
  },
  {
    name: 'the-nul-status-parser-runs-against-real-git',
    // A positive control, because every case above is synthetic: a parser that
    // is never handed real bytes is a parser that agrees with its author. This
    // drives `git diff --name-status -z` against the empty tree, which reports
    // every tracked markdown file as added, and asserts the output is genuinely
    // NUL-delimited rather than newline-delimited with NULs nowhere in it.
    check: () => {
      const tree = emptyTree()
      if (tree === null) return false
      const out = gitRaw('diff', '--name-status', '-z', tree, 'HEAD', '--', '*.md')
      if (out === null || !out.includes('\u0000') || out.includes('\n')) return false
      const { entries, skipped, errors } = parseNameStatusZ(out)
      return errors.length === 0 && skipped.length === 0 && entries.length >= 2
        && entries.every((e) => e.status === 'A' && e.path.endsWith('.md') && e.from === null)
    },
    mutate: () => {
      // The listing this replaced: one record per line. Real `-z` output has no
      // newlines in it, so a line split cannot reproduce the count — and if it
      // can, the check above was not reading `-z` bytes.
      const tree = emptyTree()
      const out = tree === null ? null : gitRaw('diff', '--name-status', '-z', tree, 'HEAD', '--', '*.md')
      if (out === null) return false
      const naive = out.split('\n').map((f) => f.trim()).filter(Boolean)
      return naive.length === parseNameStatusZ(out).entries.length
    },
  },
  {
    name: 'a-literal-pathspec-is-not-a-glob',
    // Paths out of `--name-status` go back to git as pathspecs, where `?` and
    // `[` are wildcards: `docs/notes[draft].md` is an ordinary filename and a
    // character class. Drives real git, because the magic prefix is git's
    // behaviour and not this file's.
    check: () => git('ls-files', '--', ':(literal)READM?.md') === ''
      && git('ls-files', '--', 'READM?.md') === 'README.md',
    mutate: () => git('ls-files', '--', ':(literal)READM?.md') === 'README.md',
  },

  // --- defect 2: a binary markdown file swept clean --------------------------
  {
    name: 'the-partition-alone-cannot-see-a-binary-file',
    // Why the reconciliation exists. A binary Markdown file yields zero added
    // rows, so prose and fenced take zero each and `0 = 0 + 0` is a *valid*
    // partition — of a population the sweep never read. The equality is about
    // the decomposition; it cannot be about whether the total is the truth.
    check: () => partitionResidual(0, [0, 0]) === 0
      && reconcileAddedRows('x.md', 0, { binary: true, added: null }) !== null,
    mutate: () => reconcileAddedRows('x.md', 0, { binary: true, added: null }) === null,
  },
  {
    name: 'binary-markdown-is-caught-by-numstat',
    check: () => {
      const { rows, errors } = parseNumstatZ('-\t-\tdocs/bin.md\u0000')
      const reason = reconcileAddedRows('docs/bin.md', 0, rows[0])
      return errors.length === 0 && rows.length === 1
        && rows[0].binary === true && rows[0].added === null && rows[0].path === 'docs/bin.md'
        && reason !== null && reason.includes('docs/bin.md') && reason.includes('binary to git')
    },
    mutate: () => reconcileAddedRows('docs/bin.md', 0, parseNumstatZ('-\t-\tdocs/bin.md\u0000').rows[0]) === null,
  },
  {
    name: 'binary-markdown-is-caught-by-its-bytes',
    // The second gate, independent of the first: git decides "binary" from a
    // NUL in the first 8000 bytes, so `.gitattributes` or a NUL past that
    // window puts a file outside its answer and inside this one.
    check: () => {
      const nul = classifyMarkdownBytes(Uint8Array.from([0x41, 0x00, 0x42]))
      const text = classifyMarkdownBytes(Uint8Array.from([0x23, 0x20, 0x68, 0x69, 0x0a]))
      return nul.ok === false && nul.reason.includes('NUL byte') && text.ok === true && text.reason === null
    },
    mutate: () => classifyMarkdownBytes(Uint8Array.from([0x41, 0x00, 0x42])).ok === true,
  },
  {
    name: 'mis-encoded-markdown-is-not-read-as-text',
    // `0xE9` alone is Latin-1 'é' and an invalid UTF-8 sequence. `readFileSync`
    // with 'utf8' substitutes U+FFFD and reports nothing, so the detectors run
    // over replacement characters and call the file clean.
    check: () => {
      const bad = classifyMarkdownBytes(Uint8Array.from([0x61, 0xe9, 0x62]))
      const good = classifyMarkdownBytes(Uint8Array.from([0x61, 0xc3, 0xa9, 0x62]))
      return bad.ok === false && bad.reason.includes('not valid UTF-8') && good.ok === true
    },
    mutate: () => classifyMarkdownBytes(Uint8Array.from([0x61, 0xe9, 0x62])).ok === true,
  },
  {
    name: 'numstat-and-the-diff-parser-must-agree',
    check: () => {
      const row = parseNumstatZ('7\t0\tdocs/a.md\u0000').rows[0]
      const agree = reconcileAddedRows('docs/a.md', 7, row)
      const differ = reconcileAddedRows('docs/a.md', 5, row)
      return agree === null && differ !== null
        && differ.includes('git counted 7 added lines')
        && differ.includes('the diff parser found 5')
    },
    mutate: () => reconcileAddedRows('docs/a.md', 5, parseNumstatZ('7\t0\tdocs/a.md\u0000').rows[0]) === null,
  },
  {
    name: 'a-missing-numstat-row-is-not-an-agreement',
    check: () => {
      const r = reconcileAddedRows('docs/a.md', 3, undefined)
      return r !== null && r.includes('no numstat row') && r.includes('docs/a.md')
    },
    mutate: () => reconcileAddedRows('docs/a.md', 3, undefined) === null,
  },
  {
    name: 'a-numstat-rename-record-reports-its-destination',
    // A rename puts nothing between the second tab and the NUL, and the two
    // paths follow. A parser that treats every NUL field as a record reads one
    // rename as two files and mis-attributes both counts.
    check: () => {
      const { rows, errors } = parseNumstatZ('1\t0\tdocs/a.md\u00003\t2\t\u0000docs/old.md\u0000docs/new name.md\u0000')
      return errors.length === 0 && rows.length === 2
        && rows[0].path === 'docs/a.md' && rows[0].from === null && rows[0].added === 1
        && rows[1].path === 'docs/new name.md' && rows[1].from === 'docs/old.md'
        && rows[1].added === 3 && rows[1].deleted === 2
    },
    mutate: () => parseNumstatZ('1\t0\tdocs/a.md\u00003\t2\t\u0000docs/old.md\u0000docs/new name.md\u0000').rows.length === 3,
  },
  {
    name: 'a-crlf-added-line-still-reaches-the-detectors',
    // CRLF survives into the added text and must not disarm the double-space
    // detector — the sweep runs on a repository edited from Windows.
    check: () => {
      const a = parseAddedLines('@@ -2,0 +3 @@ b\n+c  d\r\n')
      return a.length === 1 && a[0].lineNo === 3 && a[0].text === 'c  d\r'
        && sweepBounds(a.map((x) => x.text)).raw === 1
    },
    mutate: () => sweepBounds(parseAddedLines('@@ -2,0 +3 @@ b\n+c  d\r\n').map((x) => x.text)).raw === 0,
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
  // `--name-status -z`, not `--name-only`. Two properties, both load-bearing:
  // the status says *why* each path is in the list, and `-z` hands the path over
  // verbatim instead of C-quoting anything outside ASCII.
  const listed = gitRaw('diff', '--name-status', '-z', `${BASE}...HEAD`, '--', '*.md')
  if (listed === null) {
    return { files: [], skipped: [], prose: [], fencedOut: [], allAdded: [], unreadable: ['(git diff --name-status failed)'] }
  }
  const { entries, skipped, errors } = parseNameStatusZ(listed)
  const files = entries.map((e) => e.path)

  // Domain guard, the shape `strategy-facts.mjs` has carried since before this
  // script: a scan that read nothing reports no offenders and looks identical to
  // a clean one. Zero markdown files in the diff is legitimate and is *stated*;
  // a file that is listed and then unreadable or empty is a failure, because
  // that is the case where the clean result is a lie.
  const unreadable = [...errors]
  const prose = []
  const fencedOut = []
  const allAdded = []
  for (const { path: file } of entries) {
    // `:(literal)` because these paths come from git, not from a human: a
    // markdown file named `docs/notes[draft].md` is a perfectly ordinary path
    // and a pathspec whose brackets are a character class. Without the magic
    // prefix it would match nothing and the file would go unswept, quietly.
    const spec = `:(literal)${file}`
    const diff = gitRaw('diff', '-U0', `${BASE}...HEAD`, '--', spec)
    if (diff === null) {
      unreadable.push(`${file} (diff failed)`)
      continue
    }
    const countsRaw = gitRaw('diff', '--numstat', '-z', `${BASE}...HEAD`, '--', spec)
    if (countsRaw === null) {
      unreadable.push(`${file} (numstat failed, so no added-line count could be corroborated)`)
      continue
    }
    const counts = parseNumstatZ(countsRaw)
    if (counts.errors.length > 0) {
      unreadable.push(`${file} (${counts.errors[0]})`)
      continue
    }
    const added = parseAddedLines(diff)
    // Pushed before the guards below, deliberately. A file that fails one of
    // them has contributed to the population and to neither bucket, so the
    // residual goes non-zero and the partition reports the drop on its own —
    // which is the property that made the partition worth having.
    allAdded.push(...added.map((a) => a.text))
    const mismatch = reconcileAddedRows(file, added.length, counts.rows.find((r) => r.path === file))
    if (mismatch !== null) {
      unreadable.push(mismatch)
      continue
    }
    const path = join(ROOT, file)
    if (!existsSync(path)) {
      unreadable.push(`${file} (not on disk)`)
      continue
    }
    // Read as bytes, classify, then decode — rather than decoding first and
    // asking the decoded string whether the bytes were readable, which it can
    // no longer say.
    const bytes = readFileSync(path)
    const encoding = classifyMarkdownBytes(bytes)
    if (!encoding.ok) {
      unreadable.push(`${file} (${encoding.reason})`)
      continue
    }
    const source = bytes.toString('utf8')
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
  return { files, skipped, prose, fencedOut, allAdded, unreadable }
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

/**
 * Build the success line from checks this invocation actually ran.
 *
 * The first version was a fixed string:
 *
 *   PASSED: heads agree, gates clean, sweep clean, controls fire
 *
 * In `--sweep-only --base=<sha>` mode, identity is deliberately not compared
 * and the gates are deliberately skipped. The exit code and failure list were
 * right, but the line a human reads claimed both — the census-as-verdict defect
 * in the verdict itself. In CI the statement happened to be true because
 * earlier job steps ran the gates, which made it worse: a correct conclusion
 * produced by a process that could not know it.
 */
export function successVerdict({ identityCompared, gatesRun }) {
  const claims = []
  if (identityCompared) claims.push('heads agree')
  if (gatesRun) claims.push('gates clean')
  claims.push('sweep clean', 'controls fire')
  return `PASSED: ${claims.join(', ')}`
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
  const sweepOnly = process.argv.includes('--sweep-only')
  const identityCompared = !suppliedBase
  const gatesRun = !sweepOnly

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
  if (gatesRun) {
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
  const { files, skipped, prose, fencedOut, allAdded, unreadable } = collectProse()
  const bounds = sweepBounds(prose)
  const long = overLong(allAdded)
  const residual = partitionResidual(allAdded.length, [prose.length, fencedOut.length])
  // Deletions are reported rather than merely skipped. A count that silently
  // omits them is a count that cannot be reconciled against `git diff --stat`
  // by anyone reading the log, and "skipped" that nobody can see is "dropped".
  const deleted = skipped.length === 0 ? '' : `  (+${skipped.length} deleted, not swept: nothing at HEAD to read)`
  console.log(`  markdown files changed : ${files.length}${deleted}${files.length === 0 ? '  (sweep examined nothing and contributes nothing below)' : ''}`)
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
  console.log(`\n${successVerdict({ identityCompared, gatesRun })}`)
}

// Only run when invoked as the entry point. The exports above exist to be
// imported, and importing them used to execute the whole verification —
// including `npm test`, so a test importing one of these functions would
// re-enter `npm test` from inside `npm test`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
