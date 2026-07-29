import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

/**
 * `deploy-pages.yml` carried `cancel-in-progress: true` on a workflow-level
 * concurrency group covering both the build job and the deploy job. GitHub's own
 * Pages template sets it `false`, with a comment saying production deployments
 * should be allowed to complete.
 *
 * The evidence first offered for this was a cancelled run eight seconds before a
 * successful one. That is not what it looked like. Every cancellation in the
 * repository's history — four of them, not one — killed the *build* job, and the
 * deploy job recorded zero steps in all four.
 *
 * That reading was then checked properly by a reviewer, against a much better
 * population than the one I used: all 82 recorded Pages runs since the repository
 * was created, run numbers 1–82 with no gaps, 77 success / 4 cancelled / 1 failure.
 * The 77 successful deploy jobs record exactly three steps each — a 77-instance
 * positive control rather than my single one — and the four cancelled SHAs have no
 * artifacts and no `github-pages` deployment records.
 *
 * It also refuted the inference I had actually been making. The one failed run's
 * deploy job was *skipped*, and it too reports `steps: []`. So empty steps is not
 * a synonym for "never executed"; it is also what a skipped dependant looks like.
 * The conclusion survives on the other evidence, but not on the reasoning I gave.
 *
 * So, stated no more strongly than it was measured: **across all 82 recorded Pages
 * runs, no deployment job is recorded as starting and then being cancelled.** Of the
 * four cancellations, three were runner-assigned builds and one was cancelled before
 * a runner was assigned — "four builds did work and were abandoned" was not measured.
 * The defect is a window that is open, not a wound.
 *
 * Which is exactly why this check exists rather than an incident report: the harm
 * has no artefact to point at, so nothing but a gate will keep the flag down.
 *
 * What this check can and cannot do, stated plainly:
 *
 *   - It reads the *input* we hand GitHub's scheduler. It cannot observe the
 *     scheduler. No test inside this repository can, and the pending-run
 *     behaviour in particular cannot even be observed from run history, because
 *     `cancel-in-progress: true` prevents the pending state from arising at all.
 *   - It therefore fails for exactly one realistic reason: somebody edits the
 *     flag back. That is the realistic failure, so it is the right target.
 *
 * It is deliberately not a grep for the string. A grep proves a spelling exists
 * on a line; it cannot see the key move under a different `concurrency:` block,
 * and it cannot see a second workflow added later with the flag the other way.
 * Both are covered below by doped inputs, and so is the parser's own blind spot:
 * the inline mapping form, which is now read rather than merely reported.
 *
 * That paragraph was wrong about its own coverage, and the miss was the whole
 * point of the check. "A second workflow added later with the flag the other way"
 * was covered only when that workflow deployed Pages itself, because the scan
 * opened a file only after `DEPLOYS_PAGES` matched it. A concurrency group is
 * repository-wide — the schema says a run waits when "another job or workflow
 * using the same concurrency group in the repository is in progress", and that
 * `cancel-in-progress: true` cancels "any currently running job or workflow in
 * the same concurrency group". So the workflow that does the cancelling need not
 * mention Pages at all, and a file that never mentions it was the one file this
 * check would never open. A probe of exactly that shape — `group: pages`,
 * `cancel-in-progress: true`, no Pages reference anywhere — passed 2/2.
 *
 * The hazard is membership of the group, not authorship of the deployment, so
 * the scan now reads every workflow and the group is what selects it.
 *
 * The workflow has since been split: `pages-build` cancels, `pages-deploy` does not,
 * and the workflow-level block is gone. That edit broke this check, in a way worth
 * recording because the check was hardened over ten rounds and the defect was in the
 * one place none of them looked.
 *
 * `cancellationRisks` computed `DEPLOYS_PAGES.test(file.source)` — a property of the
 * *file* — and then applied the strict "present and false" rule to *every*
 * concurrency block in it. That is correct while one block covers the file and
 * silently wrong the moment there are two: the build's legitimate `true` was
 * reported as a hazard. The sentence above is right that the hazard is membership
 * rather than authorship of the deployment; the code was still asking about
 * authorship of the *file*. So the paragraph that named the distinction was
 * committed while the function it describes was on the wrong side of it.
 *
 * Fixing that surfaced a second defect one layer down. `protectedGroups` collected
 * every group declared in a Pages workflow, so after the split it would have marked
 * `pages-build` protected — and the build's own `true` would then have been caught
 * by the *ordinary* rule instead. The same false positive, arriving through a
 * different door. Both are closed by `governsDeployment`: a block governs the
 * deployment when it is workflow-level in a Pages file, or job-level on a job that
 * itself deploys.
 *
 * The empty case moved with it. `blocks.length === 0` was a fail-open once blocks
 * could belong to different jobs, because a file where the build has a block and the
 * deployment has none is not a file with no blocks. It now asks whether any block
 * governs the deployment.
 *
 * And the probes below had the same disease as the code they test. Nine of them
 * spelled `group: pages` literally. After the split, the four *benign* ones went on
 * passing — not because their flag is false but because `pages` protects nothing.
 * A false-positive control that passes for the wrong reason certifies nothing, which
 * is the round-nine failure this file already documents, recurring in the controls
 * rather than the check. They now derive the group from the real file.
 *
 * The doped cases had a quieter version of it. Several reached the flag by replacing
 * the first `cancel-in-progress: false` in the file, or relied on the build's flag
 * still being `true`. Both were properties of the baseline that no probe stated.
 * Measured, by doping the build's flag false: a probe labelled "the build joins the
 * deployment group and cancels it" mutated a group that no longer cancelled, found
 * no hazard, and reported that this check had missed one. A probe resting on an
 * unstated precondition reports its own broken assumption as a failure of the thing
 * under test. `reflag` and `replaceBlockDeclaring` let them state it instead.
 *
 * That last one was only visible because the mutation harness was made to report
 * *which* test caught each case rather than whether the run went red. Two mutations
 * that are not hazards at all — the build ceasing to cancel, and both groups renamed
 * in lockstep — are caught by the value pins alone, correctly, and were showing
 * spurious semantic hits that were entirely probes breaking on their own literals.
 * At the exit-code level a check firing and a probe breaking are the same colour.
 */

type WorkflowFile = { readonly name: string; readonly source: string }

type ConcurrencyBlock = {
  readonly line: number
  readonly entries: Map<string, string>
  /** The job this block governs, or `null` for a workflow-level block. */
  readonly job: string | null
}

type JobSpan = { readonly name: string; readonly start: number; readonly end: number }

// The optional `- ` matters: a step written compactly as `- uses: actions/deploy-pages@v4`
// is the same deployment as one with a `name:` above it, and the first draft of this
// regex could not see it. The doped second-workflow case below found that, which is
// the whole argument for doping — the real file happens to use the other form, so
// every run against the repository would have passed.
//
// The optional quote matters for the same reason and was found the same way, by a
// reviewer rather than by me: `uses: "actions/deploy-pages@v4"` is valid YAML naming
// the identical action, and the unquoted-only regex did not see it.
const DEPLOYS_PAGES = /^\s*(?:-\s+)?uses:\s*["']?actions\/deploy-pages(?:@|["'\s]|$)/m

/**
 * A mapping key and its value. The key may be quoted: `"group": pages` is the same
 * property as `group: pages` to every YAML parser, and was a different one to this
 * check — a reviewer changed only the quoting in `ci.yml`, left its cancelling
 * expression intact, and all five tests passed while CI could cancel a deployment.
 * The sixth round, and the sixth defect that was a defect in a *form*.
 */
const KEY_VALUE = /^\s*["']?([A-Za-z][A-Za-z0-9-]*)["']?\s*:\s*([\s\S]*)$/

/**
 * A job header: a key opening a mapping, with no value on the line. Job ids admit
 * `_` where {@link KEY_VALUE} does not, so this is its own pattern rather than a
 * loosening of that one — widening the shared regex would also widen what counts
 * as a concurrency key, which is not the change being made.
 */
const JOB_HEADER = /^["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*:\s*$/

/**
 * Where each job starts and ends, by line index.
 *
 * This exists because the hazard is job-scoped and the check was file-scoped. The
 * deploying workflow was held to the rule "every concurrency block in this file
 * must decline to cancel", which is right only while the file has one block. Split
 * the groups per job — the build cancellable, the deployment not — and the same
 * rule reports the build, which is the behaviour the split exists to restore.
 *
 * Nesting is decided by indentation rather than by matching `jobs:` to a closing
 * token, because YAML has no closing token. The `jobs:` mapping ends at the first
 * non-empty line indented no deeper than it, and each job header sits at the first
 * indentation seen inside it — read from the file rather than assumed to be two
 * spaces, since four is equally valid and would otherwise silently yield no jobs.
 */
function jobSpans(source: string): JobSpan[] {
  const lines = source.split(/\r?\n/)
  const spans: JobSpan[] = []

  let jobsIndent = -1
  let headerIndent = -1
  let open: { name: string; start: number } | null = null

  const close = (end: number): void => {
    if (open) spans.push({ name: open.name, start: open.start, end })
    open = null
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\s*(#.*)?$/.test(line)) continue

    const indent = line.length - line.trimStart().length

    if (jobsIndent < 0) {
      if (/^["']?jobs["']?\s*:\s*$/.test(line.trim())) jobsIndent = indent
      continue
    }

    // Left the `jobs:` mapping entirely.
    if (indent <= jobsIndent) {
      close(i - 1)
      jobsIndent = -1
      headerIndent = -1
      continue
    }

    if (headerIndent < 0) headerIndent = indent
    if (indent !== headerIndent) continue

    const header = JOB_HEADER.exec(line.trim())
    if (!header) continue

    close(i - 1)
    open = { name: header[1] ?? '', start: i }
  }

  close(lines.length - 1)
  return spans
}

/**
 * A scalar as written in YAML, reduced to what it means: trailing comment removed,
 * surrounding quotes stripped. `'false'` and `"false"` and `false` are one value,
 * and a check that treats them as three flags a workflow for declining to cancel.
 */
function scalar(raw: string): string {
  return raw
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .trim()
}

/**
 * Every `concurrency:` mapping in a file, with its child scalars — both the block
 * form and the inline `{ ... }` form.
 *
 * Block form is indentation-scoped, so a key under a job-level block is not
 * confused with one under the workflow-level block.
 *
 * The inline form was originally left unparsed on the reasoning that it would be
 * reported as a failure rather than pass silently. That was true only of the
 * workflow that deploys Pages, where an unreadable block means no block and no
 * block is itself a risk. For every *other* workflow the same blind spot was
 * fail-open: a file joining `group: pages` with `cancel-in-progress: true` on one
 * inline line was invisible, and passed. Measured, exit 0, against the block form
 * of the identical values failing. So it is parsed.
 */
function concurrencyBlocks(source: string): ConcurrencyBlock[] {
  const lines = source.split(/\r?\n/)
  const blocks: ConcurrencyBlock[] = []
  const spans = jobSpans(source)
  const owner = (index: number): string | null =>
    spans.find((span) => index >= span.start && index <= span.end)?.name ?? null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    const inline = /^(\s*)["']?concurrency["']?\s*:\s*\{(.*)\}\s*$/.exec(line)
    if (inline) {
      const entries = new Map<string, string>()
      for (const part of (inline[2] ?? '').split(',')) {
        const pair = KEY_VALUE.exec(part)
        if (pair) entries.set(pair[1] ?? '', scalar(pair[2] ?? ''))
      }
      blocks.push({ line: i + 1, entries, job: owner(i) })
      continue
    }

    const opened = /^(\s*)["']?concurrency["']?\s*:\s*$/.exec(line)
    if (!opened) continue

    const indent = (opened[1] ?? '').length
    const entries = new Map<string, string>()

    for (let j = i + 1; j < lines.length; j += 1) {
      const child = lines[j] ?? ''
      if (/^\s*(#.*)?$/.test(child)) continue
      if (child.length - child.trimStart().length <= indent) break

      const pair = KEY_VALUE.exec(child)
      if (!pair) continue

      let value = scalar(pair[2] ?? '')

      // `group: >-` puts the value on the following lines. Read as a single line
      // the value is the indicator, which matches no group and reported nothing.
      // The header may also carry an indentation indicator digit, in either order
      // (`>2-`, `>-2`); a reviewer bypassed the guard with exactly that.
      if (/^[>|](?:[1-9][-+]?|[-+][1-9]?)?$/.test(value)) {
        const childIndent = child.length - child.trimStart().length
        const continuation: string[] = []

        for (let k = j + 1; k < lines.length; k += 1) {
          const cont = lines[k] ?? ''
          if (/^\s*$/.test(cont)) continue
          if (cont.length - cont.trimStart().length <= childIndent) break
          continuation.push(cont.trim())
        }

        value = continuation.join(' ').trim()
      }

      entries.set(pair[1] ?? '', value)
    }

    blocks.push({ line: i + 1, entries, job: owner(i) })
  }

  return blocks
}

/**
 * The jobs that run the deployment action.
 *
 * `DEPLOYS_PAGES` is applied to the job's own lines rather than the whole file, so
 * that "this file deploys Pages" and "this block governs the deployment" stop being
 * the same question. They were the same question while one block covered the file,
 * and the per-job split is exactly the edit that separates them.
 */
function deployingJobs(source: string): Set<string> {
  const lines = source.split(/\r?\n/)
  const names = new Set<string>()

  for (const span of jobSpans(source)) {
    if (DEPLOYS_PAGES.test(lines.slice(span.start, span.end + 1).join('\n'))) names.add(span.name)
  }

  return names
}

/**
 * Whether a block decides the concurrency the *deployment* runs under. A
 * workflow-level block in a deploying file does, because it covers every job in it;
 * a job-level block does when that job is the one deploying.
 *
 * A build job's block is deliberately not one of these. It is an ordinary block in
 * an ordinary workflow and is held to the ordinary rule below: cancel what you like,
 * unless the group you join is the deployment's.
 */
function governsDeployment(file: WorkflowFile, block: ConcurrencyBlock): boolean {
  if (!DEPLOYS_PAGES.test(file.source)) return false
  return block.job === null || deployingJobs(file.source).has(block.job)
}

/**
 * The concurrency groups a Pages deployment actually runs under. These are the
 * groups whose members can cancel it, wherever those members are declared.
 */
function protectedGroups(files: readonly WorkflowFile[]): Set<string> {
  const groups = new Set<string>()

  for (const file of pagesWorkflows(files)) {
    for (const block of concurrencyBlocks(file.source)) {
      if (!governsDeployment(file, block)) continue
      const group = block.entries.get('group')
      if (group !== undefined && group !== '') groups.add(group)
    }
  }

  return groups
}

/**
 * Whether a declared group can be the same group GitHub schedules the deployment
 * under. Two ways it can be, beyond spelling it identically:
 *
 * Case. GitHub matches concurrency groups case-insensitively, so `PAGES` and
 * `pages` are one group to the scheduler and were two to this check. A probe
 * declaring `group: PAGES` with `cancel-in-progress: true` passed the test named
 * for the property — measured, not argued.
 *
 * Expressions. `group: ${{ ... }}` cannot be evaluated here, so a group that
 * mentions the protected name inside an expression is treated as able to produce
 * it. That is a heuristic and wrong in the loud direction: `ci.yml` builds its
 * group from `github.workflow` and `github.ref` and never says `pages`, so it
 * stays quiet, while `${{ 'pages' }}` does not.
 *
 * Assembly. The substring test is defeated by an expression that produces the name
 * without containing it — `${{ format('{0}{1}', 'pa', 'ges') }}` is a reviewer's,
 * and it passed. The rule is therefore about *readability*, not danger: an
 * expression carrying a construct this check does not model is treated as able to
 * produce the protected group. A function call is the detectable form of "not
 * modelled". The whole repository was measured under this rule before it shipped —
 * no workflow here calls a function in a group, so it costs nothing today.
 *
 * It is fail-closed, and that has a price which is stated rather than hidden: a
 * legitimate `format('ci-{0}', github.ref)` group is reported too. That is a loud
 * failure on a concurrency edit whose safety genuinely cannot be decided here, not
 * a failure on an unrelated one — the distinction that decides whether a gate
 * survives contact with its maintainers.
 *
 * It closes one bypass, not the class. Measured, still fail-open here and caught
 * only by the text pin: `${{ github.event.inputs.g }}` and `${{ env.GROUP }}`,
 * which name nothing and call nothing yet can resolve to anything.
 */
function joinsGuardedGroup(group: string, guarded: ReadonlySet<string>): boolean {
  const declared = group.toLowerCase()
  const unreadable = declared.includes('${{') && /[a-z_]\w*\s*\(/.test(declared)

  for (const protectedGroup of guarded) {
    const target = protectedGroup.toLowerCase()
    if (declared === target) return true
    if (declared.includes('${{') && declared.includes(target)) return true
    if (unreadable) return true
  }

  return false
}

/**
 * Absent means false: that is the documented default, so a workflow that shares
 * the group without mentioning the flag is safe and must not be reported. Only a
 * present, non-`false` value cancels — including an expression, which can be true.
 */
function cancelsInProgress(value: string | undefined): boolean {
  return value !== undefined && value.toLowerCase() !== 'false'
}

/**
 * Reasons a set of workflow files could cancel a Pages deployment mid-flight.
 * Empty means no reason was found — which is only meaningful alongside the
 * population count below it, so both are asserted.
 */
function cancellationRisks(files: readonly WorkflowFile[]): string[] {
  const risks: string[] = []
  const guarded = protectedGroups(files)

  for (const file of files) {
    const deploysPages = DEPLOYS_PAGES.test(file.source)
    const blocks = concurrencyBlocks(file.source)

    // Not `blocks.length === 0`. Once the groups are split per job, a file can carry
    // a block for the build and none for the deployment, which is unguarded and was
    // indistinguishable here from a file that is fully covered.
    if (deploysPages && !blocks.some((block) => governsDeployment(file, block))) {
      risks.push(`${file.name}: deploys Pages but has no concurrency: block this check can read`)
      continue
    }

    for (const block of blocks) {
      const value = block.entries.get('cancel-in-progress')

      // The blocks governing the deployment are held to the stricter rule: the flag
      // must be present and false, so that deleting it is a failure rather than a
      // silent fallback to a default that happens to be correct today.
      if (governsDeployment(file, block)) {
        if (value === undefined) {
          risks.push(`${file.name}:${String(block.line)}: concurrency block does not set cancel-in-progress`)
        } else if (cancelsInProgress(value)) {
          risks.push(`${file.name}:${String(block.line)}: cancel-in-progress is \`${value}\`, not false`)
        }
        continue
      }

      const group = block.entries.get('group')
      if (group !== undefined && joinsGuardedGroup(group, guarded) && cancelsInProgress(value)) {
        risks.push(
          `${file.name}:${String(block.line)}: joins Pages group \`${group}\` with cancel-in-progress \`${String(value)}\``,
        )
      }
    }
  }

  return risks
}

function pagesWorkflows(files: readonly WorkflowFile[]): WorkflowFile[] {
  return files.filter((file) => DEPLOYS_PAGES.test(file.source))
}

function readWorkflows(): WorkflowFile[] {
  const dir = new URL('../.github/workflows/', import.meta.url)
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, source: readFileSync(new URL(name, dir), 'utf8') }))
}

/**
 * Rewrite the `cancel-in-progress` of the block declaring `group`, or remove it when
 * `value` is null.
 *
 * The doped cases below used to reach the flag by replacing the first
 * `cancel-in-progress: false` in the file. With one block that was the deployment's;
 * with two it is whichever comes first, and a probe that flips the build's flag while
 * claiming to flip the deployment's reports the wrong verdict under a label that
 * sounds right. Measured: with the build's flag already false, that probe mutated the
 * build, found no hazard, and failed saying the check had missed one.
 */
function reflag(source: string, group: string, value: string | null): string {
  const lines = source.split(/\r?\n/)
  const declares = new RegExp(`^\\s*["']?group["']?\\s*:\\s*${group}\\s*$`)
  const flag = /^\s*["']?cancel-in-progress["']?\s*:/

  const target = lines.findIndex((line) => declares.test(line))
  if (target < 0) return source

  const indent = (lines[target] ?? '').length - (lines[target] ?? '').trimStart().length

  for (let i = target + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\s*$/.test(line)) break
    if (line.length - line.trimStart().length < indent) break
    if (!flag.test(line)) continue

    const replacement = value === null ? [] : [`${' '.repeat(indent)}cancel-in-progress: ${value}`]
    return [...lines.slice(0, i), ...replacement, ...lines.slice(i + 1)].join('\n')
  }

  return source
}

/**
 * Replace the whole concurrency block that declares `group`, whatever comments and
 * indentation it carries, with a single line.
 *
 * The doped case for the inline form used to match `^concurrency:` at column zero.
 * Moving the block under a job left that regex matching nothing, and a mutation that
 * matches nothing produces a clean scan indistinguishable from a genuine pass. The
 * `notEqual` guard in the loop below caught it, which is the only reason this is a
 * rewritten helper rather than a silently dead case — the same failure it was
 * written to catch, arriving in the edit that moved the block it targeted.
 */
function replaceBlockDeclaring(source: string, group: string, replacement: string): string {
  const lines = source.split(/\r?\n/)
  const declares = new RegExp(`^\\s*["']?group["']?\\s*:\\s*${group}\\s*$`)
  const opens = /^\s*["']?concurrency["']?\s*:\s*$/

  const target = lines.findIndex((line) => declares.test(line))
  if (target < 0) return source

  let start = target
  while (start > 0 && !opens.test(lines[start] ?? '')) start -= 1
  if (!opens.test(lines[start] ?? '')) return source

  const indent = (lines[start] ?? '').length - (lines[start] ?? '').trimStart().length

  let end = start
  while (end + 1 < lines.length) {
    const next = lines[end + 1] ?? ''
    if (/^\s*$/.test(next)) break
    if (next.length - next.trimStart().length <= indent) break
    end += 1
  }

  return [...lines.slice(0, start), `${' '.repeat(indent)}${replacement}`, ...lines.slice(end + 1)].join('\n')
}

test('no workflow on disk can cancel a Pages deployment in a form this check can read', () => {
  const files = readWorkflows()

  // The population, before the verdict. A zero from a scan that examined nothing
  // is the failure this repository has caught more often than any other.
  assert.ok(files.length >= 2, `expected at least ci.yml and deploy-pages.yml, found ${String(files.length)}`)

  const deploying = pagesWorkflows(files)
  assert.equal(
    deploying.length,
    1,
    `expected exactly one Pages-deploying workflow, found ${String(deploying.length)}: ` +
      `${deploying.map((file) => file.name).join(', ') || 'none'}`,
  )

  // ci.yml sets `cancel-in-progress` to an expression and must not be caught by
  // this: it deploys nothing, and cancelling a superseded PR run is the point.
  assert.ok(
    files.some((file) => file.name === 'ci.yml' && !DEPLOYS_PAGES.test(file.source)),
    'ci.yml should be present and excluded — if it is being scanned, the filter is wrong',
  )

  assert.deepEqual(cancellationRisks(files), [])
})

test('the check fires on every way the flag can come back', () => {
  const [real] = pagesWorkflows(readWorkflows())
  assert.ok(real, 'no Pages-deploying workflow to dope')

  // Negative control first: a detector that always fires proves as little as one
  // that never does.
  assert.deepEqual(cancellationRisks([real]), [], 'the real file must be clean before doping it')

  // The group the unrelated-workflow probes below must join to be hazardous at all.
  // Derived for the reason given in the spelling test: written literally, they went
  // on passing against a group nothing protects the moment the deployment moved.
  const [guarded] = [...protectedGroups([real])]
  assert.ok(guarded, 'no protected group derived from the real file, so the probes below join nothing')

  // The build's group, derived the same way and for the same reason. Written
  // literally it survived the split silently: `group: pages-build` was still present,
  // so the probes that move it kept applying, and the ones that assumed it came second
  // in the file kept flipping whichever block happened to be first.
  const [building] = concurrencyBlocks(real.source)
    .filter((block) => !governsDeployment(real, block))
    .map((block) => block.entries.get('group'))
    .filter((group): group is string => Boolean(group))
  assert.ok(building, 'no non-governing group derived from the real file')
  assert.notEqual(building, guarded, 'the build and the deployment must not share a group')

  const doped: ReadonlyArray<readonly [string, WorkflowFile[]]> = [
    [
      'flag flipped back to true',
      [{ name: real.name, source: reflag(real.source, guarded, 'true') }],
    ],
    [
      'flag deleted entirely',
      [{ name: real.name, source: reflag(real.source, guarded, null) }],
    ],
    [
      'flag replaced by an expression',
      [
        {
          name: real.name,
          source: reflag(real.source, guarded, '${{ github.ref != \'refs/heads/main\' }}'),
        },
      ],
    ],
    [
      'concurrency rewritten in the inline mapping form',
      [
        {
          name: real.name,
          source: replaceBlockDeclaring(real.source, guarded, `concurrency: { group: ${guarded}, cancel-in-progress: true }`),
        },
      ],
    ],
    [
      'the deployment loses its block entirely while the build keeps one',
      [{ name: real.name, source: replaceBlockDeclaring(real.source, guarded, 'name: Deploy anyway') }],
    ],
    [
      'the build joins the deployment group and cancels it',
      [
        {
          name: real.name,
          // Stated, not inherited. Replacing only the group left the "and cancels it"
          // half resting on the build's flag still being true in the baseline.
          // Measured: with that flag doped false, this case found no hazard and
          // reported the check had missed one.
          source: replaceBlockDeclaring(real.source, building, `concurrency: { group: ${guarded}, cancel-in-progress: true }`),
        },
      ],
    ],
    [
      'the deployment adopts the build group, which cancels',
      [
        {
          name: real.name,
          source: replaceBlockDeclaring(
            reflag(real.source, building, 'true'),
            guarded,
            `concurrency: { group: ${building}, cancel-in-progress: false }`,
          ),
        },
      ],
    ],
    [
      'flag relocated under a job-level block, workflow level left correct',
      [
        {
          name: real.name,
          source: real.source.replace(
            /^(\s*)deploy:$/m,
            `$1deploy:\n$1  concurrency:\n$1    group: ${guarded}\n$1    cancel-in-progress: true`,
          ),
        },
      ],
    ],
    [
      'a second workflow added later that deploys Pages with the flag the other way',
      [
        real,
        {
          name: 'deploy-preview.yml',
          source: ['concurrency:', '  group: preview', '  cancel-in-progress: true', 'jobs:', '  deploy:', '    steps:', '      - uses: actions/deploy-pages@v4', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group and cancels — mentions Pages nowhere',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Totally Unrelated Housekeeping', 'concurrency:', `  group: ${guarded}`, '  cancel-in-progress: true', 'jobs:', '  tidy:', '    steps:', '      - run: echo nothing to do with Pages', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group at job level and cancels',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'jobs:', '  tidy:', '    concurrency:', `      group: ${guarded}`, '      cancel-in-progress: true', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group with an expression that can evaluate true',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency:', `  group: ${guarded}`, "  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group on one inline line — the form that was fail-open',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', `concurrency: { group: ${guarded}, cancel-in-progress: true }`, 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group with a quoted true',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency:', `  group: ${guarded}`, "  cancel-in-progress: 'true'", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
  ]

  for (const [label, files] of doped) {
    // Prove the mutation applied. An edit that silently matched nothing produces
    // a clean scan indistinguishable from a genuine pass — that exact failure
    // has already happened twice in this repository.
    assert.notEqual(
      files.map((file) => file.source).join('\n'),
      [real].map((file) => file.source).join('\n'),
      `${label}: mutation did not change the source, so its result means nothing`,
    )
    assert.ok(cancellationRisks(files).length > 0, `${label}: should have been caught and was not`)
  }
})

/**
 * The widened scan reads every workflow, so it now has room to be wrong in the
 * other direction. A check that flags everything passes the doped cases above
 * for the wrong reason, and would be turned off the first time it blocked a
 * legitimate workflow — which is the failure mode that gets a gate deleted
 * rather than fixed. These are the cases that must stay quiet.
 */
test('the widened scan stays quiet on workflows that cannot cancel a deployment', () => {
  const [real] = pagesWorkflows(readWorkflows())
  assert.ok(real, 'no Pages-deploying workflow to pair against')

  // These probes must join the group the deployment actually runs under. Written as
  // a literal they stayed quiet after the split for the wrong reason entirely - not
  // because their flag is false, but because the group they named protects nothing.
  // A false-positive control that passes for the wrong reason certifies nothing, and
  // this file already has a round recorded against exactly that.
  const [guarded] = [...protectedGroups([real])]
  assert.ok(guarded, 'no protected group derived from the real file, so these probes join nothing')

  const benign: ReadonlyArray<readonly [string, WorkflowFile]> = [
    [
      'shares the Pages group but never sets the flag — the default is false, so it is safe',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', `  group: ${guarded}`, 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'cancels aggressively but in a group of its own',
      {
        name: 'lint.yml',
        source: ['name: Lint', 'concurrency:', '  group: lint-${{ github.ref }}', '  cancel-in-progress: true', 'jobs:', '  lint:', '    steps:', '      - run: echo lint', ''].join('\n'),
      },
    ],
    [
      'shares the Pages group and explicitly declines to cancel',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', `  group: ${guarded}`, '  cancel-in-progress: false', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'declines to cancel in quotes — the same value, and flagging it would be a false alarm',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', `  group: ${guarded}`, "  cancel-in-progress: 'false'", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'declines to cancel inline',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', `concurrency: { group: ${guarded}, cancel-in-progress: false }`, 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'has no concurrency block at all and deploys nothing',
      {
        name: 'stale.yml',
        source: ['name: Stale', 'jobs:', '  stale:', '    steps:', '      - run: echo stale', ''].join('\n'),
      },
    ],
  ]

  for (const [label, file] of benign) {
    // Prove the pairing is the thing under test: the real file alone is clean,
    // so any risk reported here was contributed by the file being added.
    assert.deepEqual(cancellationRisks([real]), [], 'the real file must be clean before pairing anything with it')
    assert.deepEqual(cancellationRisks([real, file]), [], `${label}: flagged a workflow that cannot cancel a deployment`)
  }

  // And the ci.yml on disk is the live instance of the second case above: it
  // cancels superseded runs on purpose, which is correct and must stay unflagged.
  const files = readWorkflows()
  const ci = files.find((candidate) => candidate.name === 'ci.yml')
  assert.ok(ci, 'ci.yml should be present — if it is gone this assertion is measuring nothing')
  assert.ok(
    /cancel-in-progress:\s*\$\{\{/.test(ci.source),
    'ci.yml should still cancel via an expression — otherwise this case no longer exercises anything',
  )
  assert.deepEqual(cancellationRisks(files), [])
})


/**
 * The group is what selects a workflow as dangerous, so the ways one group name can
 * be written are exactly as load-bearing as the ways the flag can be. Two of these
 * were live on this branch until a reviewer of the pinned-population design went
 * looking for them, and both passed the test named for the property while the
 * population pin failed underneath — a gate failing for the wrong reason, which is
 * a maintainer one pin update away from a real hazard.
 *
 * `PAGES` is the important one: GitHub matches groups case-insensitively, so it is
 * the deployment's own group, spelled in a way this check compared as different.
 */
test('a group is the same group however GitHub would spell it', () => {
  const deploying = pagesWorkflows(readWorkflows())[0]
  assert.ok(deploying, 'no Pages-deploying workflow to protect')

  // Derived, not written down. These probes used to spell `pages` literally, and
  // when the deployment moved to its own group every one of them kept passing while
  // testing a group nothing protects. The name is pinned once, by value, in the test
  // above; duplicating it here bought nothing and could only ever go stale.
  const [guarded, ...also] = [...protectedGroups([deploying])]
  assert.ok(guarded, 'no protected group derived from the real file, so every probe below is vacuous')
  assert.deepEqual(also, [], 'more than one protected group — the spellings below exercise only the first')

  const cancelling = (group: string): WorkflowFile => ({
    name: 'probe.yml',
    source: `name: Probe\non:\n  workflow_dispatch:\nconcurrency:\n  group: ${group}\n  cancel-in-progress: true\njobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
  })

  const titled = guarded.replace(/(^|-)([a-z])/g, (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
  const split = Math.ceil(guarded.length / 2)

  const spellings: ReadonlyArray<readonly [string, string]> = [
    ['identical', guarded],
    ['upper case, which GitHub folds to the same group', guarded.toUpperCase()],
    ['mixed case', titled],
    ["double quoted, as GitHub's own starter template writes it", `"${guarded}"`],
    ['single quoted', `'${guarded}'`],
    ['an expression that evaluates to it', `\${{ '${guarded}' }}`],
    ['a folded scalar carrying the name on the next line', `>-\n    ${guarded}`],
    ['a folded scalar with an indentation indicator', `>2-\n    ${guarded}`],
    ['the same header with the indicators reversed', `>-2\n    ${guarded}`],
    [
      'an expression assembling the name it never spells',
      `\${{ format('{0}{1}', '${guarded.slice(0, split)}', '${guarded.slice(split)}') }}`,
    ],
  ]

  // The spellings must actually differ from each other, or a probe that silently
  // collapsed to the plain name would report the plain name's result under another
  // label. `titled` in particular is a transform, not a literal, and a group name
  // that was already capitalised would make it a duplicate of `identical`.
  assert.equal(
    new Set(spellings.map(([, group]) => group)).size,
    spellings.length,
    'two spellings are the same string, so one of them is not testing what it is named for',
  )

  for (const [label, group] of spellings) {
    assert.ok(
      cancellationRisks([deploying, cancelling(group)]).length > 0,
      `a workflow joining the deployment's group written as ${label} was not reported`,
    )
  }

  // The build's group is the control in the other direction, and it is the one this
  // split creates: it lives in the deploying file, it cancels deliberately, and it
  // must not be protected. If it ever is, the build stops being cancellable and the
  // split has quietly undone itself.
  assert.ok(!protectedGroups([deploying]).has('pages-build'), 'the build group must not be protected')
  assert.deepEqual(
    cancellationRisks([deploying, cancelling('pages-build')]),
    [],
    'a workflow joining the build group and cancelling is doing the intended thing',
  )

  // The other direction, and the reason the expression rule is a substring test
  // rather than a blanket "unreadable means dangerous": ci.yml cancels deliberately
  // under a group built from expressions, and must not be dragged in by it. The
  // blanket rule was implemented and measured, by two parties independently: three
  // tests red on the real file set. This control is what goes red.
  assert.deepEqual(
    cancellationRisks([deploying, cancelling('${{ github.workflow }}-${{ github.ref }}')]),
    [],
    'an expression group that never names the protected group must stay quiet',
  )
})


/**
 * The check above reads YAML with a hand parser, and a hand parser's blind spots are
 * unbounded: three rounds of defects have already been found in it, two of them by
 * doping it again after it had been declared sound, and one by a reviewer who wrote
 * `uses: "actions/deploy-pages@v4"` in quotes. Every fix so far has been a fix to a
 * *form*, and there is no argument that the list of forms is now complete.
 *
 * So the universal claim is not made. This pins the population instead. Any workflow
 * added, removed or renamed fails here, in whatever YAML dialect it is written, and a
 * person has to look at the concurrency groups and re-reason. That is a claim this
 * repository can actually support: not "no workflow can cancel a deployment", but
 * "the set of workflows has not changed since someone last checked".
 *
 * It is the weaker instrument and the honest one. A parser that must understand every
 * legal spelling of a mapping fails silently when it meets a new one; a file list
 * fails loudly and cannot be evaded by syntax.
 */
test('the set of workflows is pinned, because a new one can evade the parser in valid YAML', () => {
  const names = readWorkflows()
    .map((file) => file.name)
    .sort()

  assert.deepEqual(
    names,
    ['ci.yml', 'deploy-pages.yml'],
    'the set of workflow files changed. This test has no opinion about whether that is ' +
      'correct — it exists because the concurrency checks above read YAML with a hand ' +
      'parser that cannot be trusted to understand an unfamiliar file. Open the new or ' +
      'changed workflow, check whether any concurrency group it declares collides with ' +
      'the Pages group, and update this list once you have.',
  )
})

/**
 * The effective concurrency of the deployment, pinned by value rather than by parse.
 * If the group or the flag changes, this fails even if the surrounding structure moved
 * somewhere the block parser reads differently.
 *
 * Pinned per job since the split. The build's block is pinned too, and pinned as
 * *cancelling*: it is the behaviour the split exists to restore, so silently losing
 * it should fail here rather than merely stop saving runner minutes. Both blocks are
 * also pinned to the job they govern, because the whole hazard is a flag drifting
 * from the job it was written for.
 */
test('the Pages workflow still declares the group and the flag it is supposed to', () => {
  const [real] = pagesWorkflows(readWorkflows())
  assert.ok(real, 'no Pages-deploying workflow found — the regex or the file moved')

  const blocks = concurrencyBlocks(real.source)
  assert.equal(blocks.length, 2, `expected exactly two concurrency blocks, found ${String(blocks.length)}`)

  assert.deepEqual(
    blocks.map((block) => [block.job, block.entries.get('group'), block.entries.get('cancel-in-progress')]),
    [
      ['build', 'pages-build', 'true'],
      ['deploy', 'pages-deploy', 'false'],
    ],
  )

  // The split is only correct while the two groups are different. Written as its own
  // assertion because the pin above would still pass if both were edited to the same
  // value, and one group carrying both rules is the configuration this replaced.
  assert.notEqual(
    blocks[0]?.entries.get('group'),
    blocks[1]?.entries.get('group'),
    'the build and the deployment must not share a group — that is the state this split undid',
  )

  assert.deepEqual([...deployingJobs(real.source)], ['deploy'])
})


/**
 * The two pins above cover the *set* of workflows and the *deployment's* values. A
 * reviewer found the hole between them: an edit to an existing pinned file, leaving
 * the deployment untouched, fires neither. Changing only `ci.yml`'s `group:` to
 * `"group":` — valid YAML, the identical property — hid its group from the parser
 * while its cancelling expression stayed live, and all five tests passed.
 *
 * Every previous round was answered by teaching the parser one more spelling, and
 * every round after it found another. This pin does not parse. It collects the lines
 * that mention concurrency at all, in any dialect, quoted or not, nested anywhere,
 * and compares them as text. A spelling this file has never seen still changes the
 * text, so a new dialect is a failure rather than a silence.
 *
 * That claim was too strong and a reviewer falsified it: `"\u0063oncurrency"` is a
 * valid YAML key decoding to `concurrency`, and the filter below never sees the
 * word. **The keyword filter is a lexer, so this pin has exactly one structural
 * assumption — that the words appear literally in the source.** The test after this
 * one makes that assumption explicit and fails when a file leaves it, rather than
 * letting the pin go quiet.
 *
 * Comment-only lines are skipped and trailing comments stripped, so prose about the
 * rationale can be edited without failing a test about semantics.
 */
test('every line that mentions concurrency, in every workflow, is pinned as text', () => {
  const declarations = readWorkflows()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((file) =>
      file.source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => !line.startsWith('#'))
        .map((line) => line.replace(/\s+#.*$/, '').trim())
        .filter((line) => /concurrency|group|cancel-in-progress/i.test(line))
        .map((line) => `${file.name} :: ${line}`),
    )

  assert.deepEqual(declarations, [
    'ci.yml :: concurrency:',
    "ci.yml :: group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}",
    "ci.yml :: cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    'deploy-pages.yml :: concurrency:',
    'deploy-pages.yml :: group: pages-build',
    'deploy-pages.yml :: cancel-in-progress: true',
    'deploy-pages.yml :: concurrency:',
    'deploy-pages.yml :: group: pages-deploy',
    'deploy-pages.yml :: cancel-in-progress: false',
  ])
})


/**
 * The readability precondition of the pin above, made a test instead of an
 * assumption. A reviewer hid a whole cancelling block from it with
 * `"\u0063oncurrency"` — valid YAML, decodes to `concurrency`, contains none of the
 * words the filter looks for. Verified against the runner's own parser dependency,
 * not only the spec.
 *
 * Every previous round was answered by learning one more spelling and every one
 * after it found another, so this is not answered that way. YAML's double-quoted
 * escapes are a closed list, and of them **only the hex forms can produce an ASCII
 * letter** — the named escapes yield control characters, space, slash, backslash,
 * quote, NEL, NBSP, LS and PS, none of which can spell part of a keyword.
 *
 * The first version of this test applied that rule to every line of the file and was
 * rejected by the next round: `run: printf '\x1b[32m…'` is ordinary shell, YAML never
 * decodes it, and the gate fired on it. **The rule was right and the scope was the
 * file rather than the assumption.** Two things narrow it to exactly what the pin
 * needs, and both are closed rather than enumerated:
 *
 * 1. YAML decodes escapes **only inside double-quoted scalars**. Plain and
 *    single-quoted scalars carry backslashes through literally, so `'\u0063oncurrency'`
 *    is a key named `\u0063oncurrency` and cannot collide with anything.
 * 2. A keyword can only be hidden from the pin in a **key**. The pin holds an exact
 *    list of lines mentioning the three words; any line carrying one of them as a
 *    *value* still carries its own key literally and is pinned. Only escaping the key
 *    removes the line from the list.
 *
 * So the scan is double-quoted mapping keys, and YAML has exactly two key syntaxes —
 * implicit (`key: value`) and explicit (`? key` / `: value`) — which is a closed
 * enumeration rather than an open one. Values, block scalars and shell source are
 * left alone entirely.
 *
 * The round-nine lesson is about the controls, not the rule. Banning *all*
 * backslashes was measured and rejected against a shell continuation and a Windows
 * path — **the two forms already imagined by whoever wrote the rule.** Neither
 * contains a complete hex escape, so both stayed green under the shipped rule and
 * reported it as safe. A false-positive control set is a sample like any other, and
 * that one was aimed by the same imagination that chose what to guard. The controls
 * below are drawn from a population instead: ordinary workflow content that contains
 * backslashes.
 *
 * One member is examined and deliberately not closed. A double-quoted scalar may
 * carry a line continuation, so `"conc\` + newline + `urrency"` splits a keyword
 * across lines where no per-line scan can see it. As an implicit mapping key that is
 * not valid YAML — it would need explicit `? key` syntax — and a rule against
 * trailing backslashes would fire on every multi-line `run:` in the repository. It
 * is recorded here rather than guarded, on the same terms as the expression forms
 * the parser cannot evaluate.
 *
 * The tenth round is the same defect one level down: the narrowed scan read
 * *lines* when what matters is *position*. `run: printf '%s\n' '{"caf\u00e9":true}'`
 * is a plain scalar carrying a shell command carrying JSON, and a quoted token
 * followed by a colon inside it is a character sequence, not a mapping key. The gate
 * fired on it, and no concurrency-shaped payload was needed. The N6 control from the
 * ninth round covered an escape in a JSON *value* and so never exercised the
 * colon-after-quote heuristic at all — a control set aimed one field away from the
 * rule it was certifying, which is the ninth round's own lesson arriving again with
 * the correction that was supposed to have absorbed it.
 *
 * So the scan is positional, and the positions are enumerated rather than sampled.
 * YAML admits a double-quoted mapping key in exactly three places: as the first
 * token of a block-mapping entry, after an explicit `?`, and inside a flow
 * collection. Everything else on a line belongs to a value, and a value is text
 * unless it opens `{` or `[` — a plain scalar cannot begin with either, which is
 * what makes the test a decision rather than a guess. Block-scalar content is
 * skipped by indentation, flow collections are tracked across lines by depth, and
 * tags and anchors are stripped because they precede a node without being one.
 *
 * The sufficiency argument from the ninth round is unchanged and now rests on
 * position instead of spelling: a keyword can only be hidden in a key, every key
 * position is scanned, and nothing that is not a key position is.
 */
function quotedEnd(text: string, from: number): number {
  let i = from + 1
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
  return i < text.length ? i : -1
}

/**
 * The closing quote of the single-quoted scalar starting at `from`. YAML writes a
 * literal quote as `''`, which continues the scalar rather than ending it — and a
 * single-quoted scalar is the wrapper the tenth round's shell command used.
 */
function singleEnd(text: string, from: number): number {
  let i = from + 1
  while (i < text.length) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") {
        i += 2
        continue
      }
      return i
    }
    i += 1
  }
  return -1
}

/** Skips the scalar starting at `i`, returning the index of its last character. */
function skipText(text: string, i: number): number {
  if (text[i] === '"') {
    const end = quotedEnd(text, i)
    return end < 0 ? text.length : end
  }
  if (text[i] === "'") {
    const end = singleEnd(text, i)
    return end < 0 ? text.length : end
  }
  return i
}

/**
 * The `:` that separates an implicit key from its value: the first one followed by
 * whitespace or end of line that is not inside a scalar or a comment. Everything
 * after it is a value, and a value is text unless it opens a flow collection.
 */
function separatorIndex(content: string): number {
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i] ?? ''
    if (ch === '#' && (i === 0 || /\s/.test(content[i - 1] ?? ''))) return -1
    if (ch === '"' || ch === "'") {
      i = skipText(content, i)
      continue
    }
    if (ch === ':' && (i + 1 >= content.length || /\s/.test(content[i + 1] ?? ''))) return i
  }
  return -1
}

/**
 * Net change in flow-collection depth across a region, counting only brackets that
 * are structure. A `{` inside a quoted scalar is a character in a string, which is
 * the whole of the tenth round.
 */
function flowDelta(region: string): number {
  let depth = 0
  for (let i = 0; i < region.length; i += 1) {
    const ch = region[i] ?? ''
    if (ch === '#' && (i === 0 || /\s/.test(region[i - 1] ?? ''))) break
    if (ch === '"' || ch === "'") {
      i = skipText(region, i)
      continue
    }
    if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') depth -= 1
  }
  return depth
}

/** Every double-quoted mapping key in a file, and nothing that merely looks like one. */
function doubleQuotedKeys(source: string): { line: string; key: string; number: number }[] {
  const found: { line: string; key: string; number: number }[] = []
  const lines = source.split(/\r?\n/)

  let explicitPending = false
  let blockIndent: number | null = null
  let flowDepth = 0

  const collect = (region: string, line: string, number: number, all: boolean): void => {
    for (let i = 0; i < region.length; i += 1) {
      if (region[i] === "'") {
        i = skipText(region, i)
        continue
      }
      if (region[i] !== '"') continue

      const end = quotedEnd(region, i)
      if (end < 0) break
      if (all || /^\s*:/.test(region.slice(end + 1))) {
        found.push({ line, key: region.slice(i, end + 1), number })
      }
      i = end
    }
  }

  lines.forEach((raw, index) => {
    const number = index + 1
    const line = raw.trim()
    const indent = raw.length - raw.trimStart().length

    // Content of a block scalar is text to YAML, whatever it looks like.
    if (blockIndent !== null) {
      if (line === '' || indent > blockIndent) return
      blockIndent = null
    }
    if (line === '' || line.startsWith('#')) return

    // A flow collection may span lines; every key inside one is a key.
    if (flowDepth > 0) {
      collect(line, line, number, false)
      flowDepth += flowDelta(line)
      return
    }

    let content = line
    while (/^-(\s|$)/.test(content)) content = content.slice(1).trim()

    const explicitHere = /^\?(\s|$)/.test(content)
    if (explicitHere || explicitPending) {
      collect(explicitHere ? content.slice(1).trim() : content, line, number, true)
      explicitPending = explicitHere && content === '?'
      return
    }

    const sep = separatorIndex(content)
    if (sep < 0) return

    const key = content.slice(0, sep).trim()
    if (key.startsWith('"') && quotedEnd(key, 0) === key.length - 1) {
      found.push({ line, key, number })
    }

    // Tags and anchors precede the node without being it.
    const region = content
      .slice(sep + 1)
      .trim()
      .replace(/^(?:[!&]\S*\s+)+/, '')

    if (/^[>|](?:[1-9][-+]?|[-+][1-9]?)?(?:\s+#.*)?$/.test(region)) {
      blockIndent = indent
      return
    }
    if (region.startsWith('{') || region.startsWith('[')) {
      collect(region, line, number, false)
      flowDepth += flowDelta(region)
    }
  })

  return found
}

test('no workflow hides a keyword from the pin inside an encoded mapping key', () => {
  const HEX_ESCAPE = /\\(?:x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/

  const encoded = readWorkflows().flatMap((file) =>
    doubleQuotedKeys(file.source)
      .filter((entry) => HEX_ESCAPE.test(entry.key))
      .map((entry) => `${file.name}:${String(entry.number)}: ${entry.line}`),
  )

  assert.deepEqual(
    encoded,
    [],
    'a workflow spells a mapping key with character escapes, so the text pin can no longer be trusted to see the keys YAML sees',
  )
})