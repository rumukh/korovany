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
 * The seventh round is not a defect but a shape. The workflow-level group is gone,
 * because it bought the deployment's safety with the build's: GitHub holds a queued
 * run in the same group `pending` before any job starts, so run N+1 could not
 * supersede run N's build no matter what the build asked for. The two jobs now carry
 * one group each — `pages-build`, which cancels, and `pages-deploy`, which does not.
 *
 * That breaks the old rule rather than bending it. This check held *every*
 * concurrency block in the deploying file to "the flag is present and false", which
 * the build job now violates on purpose. So blocks are attributed to their owner —
 * the run, or one named job — and only the groups that govern the *deploying job*
 * are protected. Which job deploys is read from where the `actions/deploy-pages`
 * step is, not assumed from a name.
 *
 * The split also creates a group that did not exist before, and a hazard with it: a
 * foreign member of `pages-build` cancels builds, and a cancelled build leaves the
 * deployment skipped. That harm never appears as an interrupted deployment, so the
 * cancellation check would never see it. It is answered by reserving the groups the
 * Pages workflow declares to the Pages workflow, which is a membership claim and is
 * kept as one, in its own check with its own message.
 */

type WorkflowFile = { readonly name: string; readonly source: string }

/** Which declaration a concurrency block belongs to: the whole run, or one job. */
type Owner = { readonly kind: 'workflow' } | { readonly kind: 'job'; readonly job: string }

type Declaration = {
  readonly line: number
  readonly entries: Map<string, string>
  readonly unreadable: string | null
}

type ConcurrencyBlock = Declaration & { readonly owner: Owner }

/** A job's header line and the last line of its body, both 1-based and inclusive. */
type JobRegion = { readonly name: string; readonly first: number; readonly last: number }

type JobLayout = { readonly regions: readonly JobRegion[]; readonly unreadable: string | null }

/**
 * The keys a concurrency mapping may carry. GitHub's published workflow schema
 * declares `additionalProperties: false` over exactly `group` (required),
 * `cancel-in-progress` and `queue`, so anything else is either not a valid workflow
 * or a key added after this check was written. Both want a person, not a silence.
 */
const CONCURRENCY_KEYS = new Set(['group', 'cancel-in-progress', 'queue'])

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
 * The value of a mapping entry, following a block scalar onto the lines that carry
 * it. `group: >-` puts the value on the following lines; read as a single line the
 * value is the indicator, which matches no group and reported nothing. The header
 * may also carry an indentation indicator digit, in either order (`>2-`, `>-2`); a
 * reviewer bypassed the guard with exactly that.
 */
function readValue(lines: readonly string[], index: number, raw: string): string {
  const value = scalar(raw)
  if (!/^[>|](?:[1-9][-+]?|[-+][1-9]?)?$/.test(value)) return value

  const own = lines[index] ?? ''
  const indent = own.length - own.trimStart().length
  const continuation: string[] = []

  for (let k = index + 1; k < lines.length; k += 1) {
    const cont = lines[k] ?? ''
    if (/^\s*$/.test(cont)) continue
    if (cont.length - cont.trimStart().length <= indent) break
    continuation.push(cont.trim())
  }

  return continuation.join(' ').trim()
}

/**
 * Every `concurrency:` mapping in a file, with its child scalars — the block form,
 * the inline `{ ... }` form, and the bare scalar form.
 *
 * Block form is indentation-scoped, so a key under a job-level block is not
 * confused with one under another job's.
 *
 * The inline form was originally left unparsed on the reasoning that it would be
 * reported as a failure rather than pass silently. That was true only of the
 * workflow that deploys Pages, where an unreadable block means no block and no
 * block is itself a risk. For every *other* workflow the same blind spot was
 * fail-open: a file joining the deployment's group with `cancel-in-progress: true`
 * on one inline line was invisible, and passed. Measured, exit 0, against the block
 * form of the identical values failing. So it is parsed.
 *
 * The bare scalar form — `concurrency: pages-deploy` — is the one the schema allows
 * beside the mapping (`oneOf: [string, object]`) and the one this reader never saw
 * at all. On the deploying workflow it names a group and takes the default flag, so
 * before this round it turned "the flag must be present" into silence.
 *
 * Forms that remain unread are said out loud rather than skipped: a flow collection
 * spanning lines, an alias, a tagged node. Every defect this file has recorded was a
 * form it could not see and did not mention.
 */
function concurrencyDeclarations(source: string): Declaration[] {
  const lines = source.split(/\r?\n/)
  const found: Declaration[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    const inline = /^\s*["']?concurrency["']?\s*:\s*\{(.*)\}\s*$/.exec(line)
    if (inline) {
      const entries = new Map<string, string>()
      for (const part of (inline[1] ?? '').split(',')) {
        const pair = KEY_VALUE.exec(part)
        if (pair) entries.set(pair[1] ?? '', scalar(pair[2] ?? ''))
      }
      found.push({ line: i + 1, entries, unreadable: null })
      continue
    }

    const declared = /^(\s*)["']?concurrency["']?\s*:(.*)$/.exec(line)
    if (!declared) continue

    const value = readValue(lines, i, declared[2] ?? '')

    if (/^[{[*&!]/.test(value)) {
      found.push({
        line: i + 1,
        entries: new Map(),
        unreadable: `concurrency: opens with \`${value.slice(0, 1)}\`, a form this check cannot read`,
      })
      continue
    }

    if (value !== '') {
      found.push({ line: i + 1, entries: new Map([['group', value]]), unreadable: null })
      continue
    }

    const indent = (declared[1] ?? '').length
    const entries = new Map<string, string>()

    for (let j = i + 1; j < lines.length; j += 1) {
      const child = lines[j] ?? ''
      if (/^\s*(#.*)?$/.test(child)) continue
      if (child.length - child.trimStart().length <= indent) break

      const pair = KEY_VALUE.exec(child)
      if (!pair) continue

      entries.set(pair[1] ?? '', readValue(lines, j, pair[2] ?? ''))
    }

    found.push({ line: i + 1, entries, unreadable: null })
  }

  return found
}

/**
 * The jobs of a workflow and the lines each one owns.
 *
 * A job-level block governs its own job and nothing else, so telling the jobs apart
 * is what makes the split readable at all. A `jobs:` mapping this cannot segment is
 * reported rather than read as no jobs, because no jobs reads as nothing deploys —
 * the fail-open shape of every earlier round.
 */
function jobRegions(source: string): JobLayout {
  const lines = source.split(/\r?\n/)

  let jobsIndent: number | null = null
  let start = -1

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    if (/^\s*(#.*)?$/.test(raw)) continue

    const opened = /^(\s*)["']?jobs["']?\s*:(.*)$/.exec(raw)
    if (!opened) continue

    const rest = readValue(lines, i, opened[2] ?? '')
    if (rest !== '') {
      return {
        regions: [],
        unreadable: `${String(i + 1)}: jobs: is written as \`${rest}\`, which this check cannot segment into jobs`,
      }
    }

    jobsIndent = (opened[1] ?? '').length
    start = i
    break
  }

  if (jobsIndent === null) return { regions: [], unreadable: null }

  const regions: JobRegion[] = []
  let jobIndent: number | null = null
  let open: { name: string; first: number } | null = null
  let end = lines.length

  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    if (/^\s*(#.*)?$/.test(raw)) continue

    const indent = raw.length - raw.trimStart().length
    if (indent <= jobsIndent) {
      end = i
      break
    }

    jobIndent ??= indent
    if (indent !== jobIndent) continue

    const header = /^\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*:\s*(?:#.*)?$/.exec(raw)
    if (!header) {
      return { regions: [], unreadable: `${String(i + 1)}: \`${raw.trim()}\` is not a job header this check can read` }
    }

    if (open) regions.push({ name: open.name, first: open.first, last: i })
    open = { name: header[1] ?? '', first: i + 1 }
  }

  if (open) regions.push({ name: open.name, first: open.first, last: end })

  return { regions, unreadable: null }
}

/** Every concurrency block in a file, each attributed to the run or to one job. */
function concurrencyBlocks(file: WorkflowFile): ConcurrencyBlock[] {
  const layout = jobRegions(file.source)

  return concurrencyDeclarations(file.source).map((declaration) => {
    const region = layout.regions.find(
      (candidate) => declaration.line >= candidate.first && declaration.line <= candidate.last,
    )

    return { ...declaration, owner: region ? { kind: 'job', job: region.name } : { kind: 'workflow' } }
  })
}

/**
 * The jobs that deploy Pages, read from where the step is rather than from a name.
 * `deploy` is a convention, not a guarantee, and the check has already been wrong
 * once by trusting a shape instead of reading one.
 */
function deployJobs(file: WorkflowFile): string[] {
  const lines = file.source.split(/\r?\n/)

  return jobRegions(file.source)
    .regions.filter((region) => DEPLOYS_PAGES.test(lines.slice(region.first - 1, region.last).join('\n')))
    .map((region) => region.name)
}

/** A workflow-level block governs every job; a job-level block governs only its own. */
function governs(block: ConcurrencyBlock, job: string): boolean {
  return block.owner.kind === 'workflow' || block.owner.job === job
}

/** Every group a file declares, wherever it declares it. */
function declaredGroups(file: WorkflowFile): Set<string> {
  const groups = new Set<string>()

  for (const block of concurrencyBlocks(file)) {
    const group = block.entries.get('group')
    if (group !== undefined && group !== '') groups.add(group)
  }

  return groups
}

/**
 * The concurrency groups a Pages deployment actually runs under: the group its own
 * job declares, plus any workflow-level group above it, which governs every job in
 * the run. These are the groups whose members can cancel it mid-flight, wherever
 * those members are declared.
 *
 * The build job's group is deliberately not one of them. It is a different group to
 * GitHub, its members cancel builds rather than deployments, and counting it here
 * would report the build job's own `cancel-in-progress: true` — which is the point
 * of the split, not a defect in it. The build group is held by `groupIntruders`
 * instead, on the narrower claim that it belongs to this workflow alone.
 */
function protectedGroups(files: readonly WorkflowFile[]): Set<string> {
  const groups = new Set<string>()

  for (const file of files) {
    const deploying = deployJobs(file)

    for (const block of concurrencyBlocks(file)) {
      if (!deploying.some((job) => governs(block, job))) continue

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
    const layout = jobRegions(file.source)
    if (layout.unreadable !== null) risks.push(`${file.name}:${layout.unreadable}`)

    const deploying = deployJobs(file)
    const blocks = concurrencyBlocks(file)

    if (DEPLOYS_PAGES.test(file.source) && deploying.length === 0) {
      risks.push(`${file.name}: deploys Pages, but this check cannot tell which job does it`)
    }

    for (const job of deploying) {
      if (!blocks.some((block) => governs(block, job))) {
        risks.push(`${file.name}: job \`${job}\` deploys Pages under no concurrency block this check can read`)
      }
    }

    for (const block of blocks) {
      if (block.unreadable !== null) {
        risks.push(`${file.name}:${String(block.line)}: ${block.unreadable}`)
        continue
      }

      for (const key of block.entries.keys()) {
        if (!CONCURRENCY_KEYS.has(key)) {
          risks.push(`${file.name}:${String(block.line)}: concurrency sets \`${key}\`, which is not a key this check models`)
        }
      }

      const group = block.entries.get('group')
      if (group === undefined || group === '') {
        risks.push(`${file.name}:${String(block.line)}: concurrency block declares no group`)
        continue
      }

      const value = block.entries.get('cancel-in-progress')

      // A group the deployment itself runs under is held to the stricter rule: the
      // flag must be present and false, so that deleting it is a failure rather
      // than a silent fallback to a default that happens to be correct today.
      if (deploying.some((job) => governs(block, job))) {
        if (value === undefined) {
          risks.push(`${file.name}:${String(block.line)}: the group the deployment runs under does not set cancel-in-progress`)
        } else if (cancelsInProgress(value)) {
          risks.push(
            `${file.name}:${String(block.line)}: cancel-in-progress is \`${value}\`, not false, on a group the deployment runs under`,
          )
        }
        continue
      }

      if (joinsGuardedGroup(group, guarded) && cancelsInProgress(value)) {
        risks.push(
          `${file.name}:${String(block.line)}: joins Pages group \`${group}\` with cancel-in-progress \`${String(value)}\``,
        )
      }
    }
  }

  return risks
}

/**
 * Workflows other than the Pages workflow that declare one of its groups.
 *
 * This is a membership claim and not a cancellation one, deliberately. Splitting the
 * concurrency per job created `pages-build`, whose members cancel *builds*; a
 * cancelled build leaves `deploy` skipped, so the site silently stays on an older
 * commit and no deployment is ever recorded as interrupted. The check above would
 * see nothing, and modelling a second kind of harm would mean modelling `needs:`
 * chains — more parser, in a file whose parser has been wrong six times.
 *
 * So the groups the Pages workflow declares are simply reserved to it. That is a
 * claim about names, which is cheap to state and impossible to evade by syntax, and
 * it is stricter than the cancellation rule on purpose: sharing a group without
 * cancelling still serialises a foreign workflow against the deployment.
 */
function groupIntruders(files: readonly WorkflowFile[]): string[] {
  const intruders: string[] = []

  for (const pages of pagesWorkflows(files)) {
    const reserved = declaredGroups(pages)

    for (const file of files) {
      if (file.name === pages.name) continue

      for (const block of concurrencyBlocks(file)) {
        const group = block.entries.get('group')
        if (group === undefined || !joinsGuardedGroup(group, reserved)) continue

        intruders.push(`${file.name}:${String(block.line)}: declares \`${group}\`, a group reserved to ${pages.name}`)
      }
    }
  }

  return intruders
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

  // The deployment's own block, matched as a unit so that a dope which replaces it
  // wholesale replaces something rather than silently matching nothing.
  const DEPLOY_BLOCK = /^ *concurrency:\r?\n *group: pages-deploy\r?\n *cancel-in-progress: false$/m

  const doped: ReadonlyArray<readonly [string, WorkflowFile[]]> = [
    [
      'flag flipped back to true',
      [{ name: real.name, source: real.source.replace('cancel-in-progress: false', 'cancel-in-progress: true') }],
    ],
    [
      'flag deleted entirely',
      [{ name: real.name, source: real.source.replace(/^\s*cancel-in-progress: false\r?\n/m, '') }],
    ],
    [
      'flag replaced by an expression',
      [
        {
          name: real.name,
          source: real.source.replace('cancel-in-progress: false', 'cancel-in-progress: ${{ github.ref != \'refs/heads/main\' }}'),
        },
      ],
    ],
    [
      "the deployment's block rewritten in the inline mapping form",
      [
        {
          name: real.name,
          source: real.source.replace(DEPLOY_BLOCK, '    concurrency: { group: pages-deploy, cancel-in-progress: true }'),
        },
      ],
    ],
    [
      'the deployment given a bare scalar group, so the flag falls back to a default',
      [{ name: real.name, source: real.source.replace(DEPLOY_BLOCK, '    concurrency: pages-deploy') }],
    ],
    [
      'the deployment block reopened as a flow mapping spanning lines',
      [
        {
          name: real.name,
          source: real.source.replace(
            DEPLOY_BLOCK,
            '    concurrency: {\n      group: pages-deploy,\n      cancel-in-progress: true }',
          ),
        },
      ],
    ],
    [
      'a workflow-level group put back above both jobs, cancelling',
      [
        {
          name: real.name,
          source: real.source.replace(/^jobs:$/m, 'concurrency:\n  group: pages\n  cancel-in-progress: true\n\njobs:'),
        },
      ],
    ],
    [
      'a third job in the same file joining the deployment group and cancelling',
      [
        {
          name: real.name,
          source: real.source.replace(
            /^ {2}deploy:$/m,
            '  cleanup:\n    runs-on: ubuntu-latest\n    concurrency:\n      group: pages-deploy\n      cancel-in-progress: true\n    steps:\n      - run: echo tidy\n\n  deploy:',
          ),
        },
      ],
    ],
    [
      'the build job moved onto the deployment group while it still cancels',
      [{ name: real.name, source: real.source.replace('group: pages-build', 'group: pages-deploy') }],
    ],
    [
      'a concurrency key this check does not model',
      [
        {
          name: real.name,
          source: real.source.replace('group: pages-deploy', 'group: pages-deploy\n      cancel-on-supersede: true'),
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
          source: ['name: Totally Unrelated Housekeeping', 'concurrency:', '  group: pages-deploy', '  cancel-in-progress: true', 'jobs:', '  tidy:', '    steps:', '      - run: echo nothing to do with Pages', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group at job level and cancels',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'jobs:', '  tidy:', '    concurrency:', '      group: pages-deploy', '      cancel-in-progress: true', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group with an expression that can evaluate true',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency:', '  group: pages-deploy', "  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group on one inline line — the form that was fail-open',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency: { group: pages-deploy, cancel-in-progress: true }', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group with a quoted true',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency:', '  group: pages-deploy', "  cancel-in-progress: 'true'", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'a workflow whose jobs cannot be told apart at all',
      [real, { name: 'flow.yml', source: ['name: Flow', 'jobs: { tidy: { runs-on: ubuntu-latest } }', ''].join('\n') }],
    ],
    [
      'a concurrency block that declares no group, which no valid workflow does',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency:', '  cancel-in-progress: true', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
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
 * A count of risks is not evidence that the right thing was noticed. Every previous
 * round of this file asserted `length > 0`, and a check that reported one wrong
 * reason for every doped input would have satisfied all of them — which matters now
 * more than before, because the per-job shape gives the same file several ways to be
 * wrong at once and `protectedGroups` decides between them.
 *
 * So the three new judgements are asserted by what they say. The fail-loud ones are
 * here rather than in the list above because "it fired" is the least interesting
 * thing about them: they exist to name a form the parser could not read, and a
 * failure message that names the wrong form is a maintainer sent to the wrong file.
 */
test('the reason the check gives is the reason the dope was written for', () => {
  const [real] = pagesWorkflows(readWorkflows())
  assert.ok(real, 'no Pages-deploying workflow to dope')

  const reasoned: ReadonlyArray<readonly [string, WorkflowFile[], RegExp]> = [
    [
      'the deployment flag flipped',
      [{ name: real.name, source: real.source.replace('cancel-in-progress: false', 'cancel-in-progress: true') }],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
    [
      'the build job moved onto the deployment group',
      [{ name: real.name, source: real.source.replace('group: pages-build', 'group: pages-deploy') }],
      /joins Pages group `pages-deploy` with cancel-in-progress `true`/,
    ],
    [
      'the deployment given a bare scalar group, which names the group but not the flag',
      [
        {
          name: real.name,
          source: real.source.replace(
            /^ *concurrency:\r?\n *group: pages-deploy\r?\n *cancel-in-progress: false$/m,
            '    concurrency: pages-deploy',
          ),
        },
      ],
      /the group the deployment runs under does not set cancel-in-progress/,
    ],
    [
      'a key the schema does not allow',
      [
        {
          name: real.name,
          source: real.source.replace('group: pages-deploy', 'group: pages-deploy\n      cancel-on-supersede: true'),
        },
      ],
      /concurrency sets `cancel-on-supersede`, which is not a key this check models/,
    ],
    [
      'a concurrency value this reader cannot open',
      [
        {
          name: real.name,
          source: real.source.replace(
            /^ *concurrency:\r?\n *group: pages-deploy\r?\n *cancel-in-progress: false$/m,
            '    concurrency: {\n      group: pages-deploy,\n      cancel-in-progress: true }',
          ),
        },
      ],
      /concurrency: opens with `\{`, a form this check cannot read/,
    ],
    [
      'jobs that cannot be told apart',
      [real, { name: 'flow.yml', source: 'name: Flow\njobs: { tidy: { runs-on: ubuntu-latest } }\n' }],
      /jobs: is written as `\{ tidy: \{ runs-on: ubuntu-latest \} \}`, which this check cannot segment into jobs/,
    ],
    [
      'a block with no group',
      [real, { name: 'housekeeping.yml', source: 'name: Housekeeping\nconcurrency:\n  cancel-in-progress: true\n' }],
      /concurrency block declares no group/,
    ],
  ]

  for (const [label, files, reason] of reasoned) {
    assert.notEqual(
      files.map((file) => file.source).join('\n'),
      [real].map((file) => file.source).join('\n'),
      `${label}: mutation did not change the source, so its result means nothing`,
    )

    const risks = cancellationRisks(files)
    assert.ok(
      risks.some((risk) => reason.test(risk)),
      `${label}: fired, but for none of the expected reasons — got ${JSON.stringify(risks)}`,
    )
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

  const benign: ReadonlyArray<readonly [string, WorkflowFile]> = [
    [
      'shares the Pages group but never sets the flag — the default is false, so it is safe',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', '  group: pages-deploy', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
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
        source: ['name: Housekeeping', 'concurrency:', '  group: pages-deploy', '  cancel-in-progress: false', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'declines to cancel in quotes — the same value, and flagging it would be a false alarm',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', '  group: pages-deploy', "  cancel-in-progress: 'false'", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'declines to cancel inline',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency: { group: pages-deploy, cancel-in-progress: false }', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'queues behind the deployment instead of cancelling it, using a key the schema documents',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', '  group: pages-deploy', '  queue: max', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'joins the build group and cancels — which abandons builds, not deployments, and is a different claim entirely',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', '  group: pages-build', '  cancel-in-progress: true', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'names a group of its own that merely starts the same way',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', '  group: pages-deployment-notes', '  cancel-in-progress: true', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
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
 * `PAGES-DEPLOY` is the important one: GitHub matches groups case-insensitively, so
 * it is the deployment's own group, spelled in a way this check compared as different.
 */
test('a group is the same group however GitHub would spell it', () => {
  const deploying = pagesWorkflows(readWorkflows())[0]
  assert.ok(deploying, 'no Pages-deploying workflow to protect')

  const cancelling = (group: string): WorkflowFile => ({
    name: 'probe.yml',
    source: `name: Probe\non:\n  workflow_dispatch:\nconcurrency:\n  group: ${group}\n  cancel-in-progress: true\njobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
  })

  const spellings: ReadonlyArray<readonly [string, string]> = [
    ['identical', 'pages-deploy'],
    ['upper case, which GitHub folds to the same group', 'PAGES-DEPLOY'],
    ['mixed case', 'Pages-Deploy'],
    ["double quoted, as GitHub's own starter template writes it", '"pages-deploy"'],
    ['single quoted', "'pages-deploy'"],
    ['an expression that evaluates to it', "${{ 'pages-deploy' }}"],
    ['a folded scalar carrying the name on the next line', '>-\n    pages-deploy'],
    ['a folded scalar with an indentation indicator', '>2-\n    pages-deploy'],
    ['the same header with the indicators reversed', '>-2\n    pages-deploy'],
    ['an expression assembling the name it never spells', "${{ format('{0}{1}', 'pages-', 'deploy') }}"],
  ]

  for (const [label, group] of spellings) {
    assert.ok(
      cancellationRisks([deploying, cancelling(group)]).length > 0,
      `a workflow joining the deployment's group written as ${label} was not reported`,
    )
  }

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
      'either of the Pages groups, and update this list once you have.',
  )
})

/**
 * The effective concurrency of the workflow, pinned by value rather than by parse.
 * If a group or a flag changes, this fails even if the surrounding structure moved
 * somewhere the block parser reads differently.
 *
 * The two jobs carry opposite policies, and that opposition *is* the change: one
 * group that both jobs shared could only hold one of them. So both halves are
 * pinned, not just the deployment's — a `pages-build` that quietly stopped
 * cancelling would restore the defect this workflow was edited to remove, and no
 * cancellation check can see a cancellation that fails to happen.
 */
test('the Pages workflow splits the two policies across its two jobs', () => {
  const [real] = pagesWorkflows(readWorkflows())
  assert.ok(real, 'no Pages-deploying workflow found — the regex or the file moved')

  const blocks = concurrencyBlocks(real)
  assert.equal(blocks.length, 2, `expected exactly two concurrency blocks, found ${String(blocks.length)}`)

  const owned = new Map(blocks.map((block) => [block.owner.kind === 'job' ? block.owner.job : '<workflow>', block]))
  assert.deepEqual([...owned.keys()].sort(), ['build', 'deploy'])

  assert.equal(owned.get('build')?.entries.get('group'), 'pages-build')
  assert.equal(owned.get('build')?.entries.get('cancel-in-progress'), 'true')
  assert.equal(owned.get('deploy')?.entries.get('group'), 'pages-deploy')
  assert.equal(owned.get('deploy')?.entries.get('cancel-in-progress'), 'false')

  // And the job that deploys is read, not assumed: if the deployment step moves to
  // another job the pin above is pinning the wrong block.
  assert.deepEqual(deployJobs(real), ['deploy'])
})

/**
 * Why there is no workflow-level block, as a test rather than a comment.
 *
 * A workflow-level group governs every job in the run, and GitHub holds a queued
 * member of an occupied group `pending` — "if another job or workflow using the same
 * concurrency group in the repository is in progress, the queued job or workflow
 * will be `pending`". Under one shared group, run N+1 therefore waits for run N to
 * finish *before its build job starts*, so `pages-build` never has an in-progress
 * peer to cancel and the split does nothing. Reinstating a workflow-level group with
 * `cancel-in-progress: false` would pass every check above while silently undoing
 * the change, because everything above asks whether a deployment can be cancelled
 * and nothing above asks whether a build can be.
 *
 * This is a claim about GitHub's scheduler, which nothing in this repository can
 * observe. It is quoted from the documented semantics and pinned as configuration,
 * which is the only part of it that is ours to hold.
 */
test('the Pages workflow declares no workflow-level group, which would freeze the split', () => {
  const [real] = pagesWorkflows(readWorkflows())
  assert.ok(real, 'no Pages-deploying workflow found')

  assert.deepEqual(
    concurrencyBlocks(real)
      .filter((block) => block.owner.kind === 'workflow')
      .map((block) => `${real.name}:${String(block.line)}`),
    [],
    'a workflow-level concurrency group governs every job in the run, so a queued run waits ' +
      'pending before its build job starts and `pages-build` can never supersede anything. ' +
      'The split only works while the run itself is ungrouped.',
  )

  // The negative control for the filter: it reports workflow-level blocks when there
  // are any, and ci.yml has one. Without this the assertion above passes if `owner`
  // is ever computed as `job` unconditionally.
  const ci = readWorkflows().find((file) => file.name === 'ci.yml')
  assert.ok(ci, 'ci.yml should be present — otherwise the control below measures nothing')
  assert.equal(concurrencyBlocks(ci).filter((block) => block.owner.kind === 'workflow').length, 1)
})

/**
 * `deploy` deploys what `build` uploaded. Without the dependency the two jobs run at
 * once and `actions/deploy-pages` publishes whatever artifact happens to exist —
 * which, now that two runs can be in flight together, is a live possibility rather
 * than a theoretical one.
 */
test('the deployment still waits for the build whose artifact it publishes', () => {
  const [real] = pagesWorkflows(readWorkflows())
  assert.ok(real, 'no Pages-deploying workflow found')

  const lines = real.source.split(/\r?\n/)
  const region = jobRegions(real.source).regions.find((candidate) => candidate.name === 'deploy')
  assert.ok(region, 'no `deploy` job found to check the dependency of')

  assert.match(lines.slice(region.first - 1, region.last).join('\n'), /^\s*needs:\s*build\s*$/m)
})

/**
 * The membership claim, doped like the rest. The build group is new, and a foreign
 * member of it does a harm the cancellation check is not built to see, so the check
 * that covers it must be shown firing rather than assumed to.
 */
test('the groups the Pages workflow declares are reserved to it', () => {
  const files = readWorkflows()
  const [real] = pagesWorkflows(files)
  assert.ok(real, 'no Pages-deploying workflow found')

  assert.deepEqual([...declaredGroups(real)].sort(), ['pages-build', 'pages-deploy'])
  assert.deepEqual(groupIntruders(files), [])

  const joining = (group: string): WorkflowFile => ({
    name: 'housekeeping.yml',
    source: `name: Housekeeping\nconcurrency:\n  group: ${group}\njobs:\n  tidy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo tidy\n`,
  })

  const intruding: ReadonlyArray<readonly [string, string]> = [
    ['the build group, whose members starve deployments rather than interrupt them', 'pages-build'],
    ['the deployment group', 'pages-deploy'],
    ['the build group in another case, which GitHub folds to the same group', 'PAGES-BUILD'],
  ]

  for (const [label, group] of intruding) {
    assert.ok(groupIntruders([real, joining(group)]).length > 0, `${label}: was not reported`)

    // Not cancelling, so the check named for cancellation must stay quiet. The two
    // claims are separate on purpose and this is what keeps them separate.
    assert.deepEqual(
      cancellationRisks([real, joining(group)]),
      [],
      `${label}: reported as a cancellation risk, which it is not`,
    )
  }

  // Declared under a job rather than the run: the same membership, one level down.
  const jobLevel: WorkflowFile = {
    name: 'housekeeping.yml',
    source: 'name: Housekeeping\njobs:\n  tidy:\n    concurrency:\n      group: pages-build\n    steps:\n      - run: echo tidy\n',
  }
  assert.ok(groupIntruders([real, jobLevel]).length > 0, 'a job-level declaration of a reserved group was not reported')

  // The control: a group that is nobody else's business stays unreported, so the
  // reservation is about these names rather than about having a group at all.
  assert.deepEqual(groupIntruders([real, joining('lint-${{ github.ref }}')]), [])
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