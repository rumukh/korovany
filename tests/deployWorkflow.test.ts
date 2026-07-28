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
 */

type WorkflowFile = { readonly name: string; readonly source: string }

type ConcurrencyBlock = { readonly line: number; readonly entries: Map<string, string> }

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

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    const inline = /^(\s*)["']?concurrency["']?\s*:\s*\{(.*)\}\s*$/.exec(line)
    if (inline) {
      const entries = new Map<string, string>()
      for (const part of (inline[2] ?? '').split(',')) {
        const pair = KEY_VALUE.exec(part)
        if (pair) entries.set(pair[1] ?? '', scalar(pair[2] ?? ''))
      }
      blocks.push({ line: i + 1, entries })
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
      if (/^[>|][-+]?$/.test(value)) {
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

    blocks.push({ line: i + 1, entries })
  }

  return blocks
}

/**
 * The concurrency groups a Pages deployment actually runs under. These are the
 * groups whose members can cancel it, wherever those members are declared.
 */
function protectedGroups(files: readonly WorkflowFile[]): Set<string> {
  const groups = new Set<string>()

  for (const file of pagesWorkflows(files)) {
    for (const block of concurrencyBlocks(file.source)) {
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
 */
function joinsGuardedGroup(group: string, guarded: ReadonlySet<string>): boolean {
  const declared = group.toLowerCase()

  for (const protectedGroup of guarded) {
    const target = protectedGroup.toLowerCase()
    if (declared === target) return true
    if (declared.includes('${{') && declared.includes(target)) return true
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

    if (deploysPages && blocks.length === 0) {
      risks.push(`${file.name}: deploys Pages but has no concurrency: block this check can read`)
      continue
    }

    for (const block of blocks) {
      const value = block.entries.get('cancel-in-progress')

      // The deploying workflow is held to the stricter rule: the flag must be
      // present and false, so that deleting it is a failure rather than a
      // silent fallback to a default that happens to be correct today.
      if (deploysPages) {
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
      'concurrency rewritten in the inline mapping form',
      [
        {
          name: real.name,
          source: real.source.replace(/^concurrency:(\r?\n(?:[ \t]+.*)?)*$/m, 'concurrency: { group: pages, cancel-in-progress: true }'),
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
            '$1deploy:\n$1  concurrency:\n$1    group: pages-deploy\n$1    cancel-in-progress: true',
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
          source: ['name: Totally Unrelated Housekeeping', 'concurrency:', '  group: pages', '  cancel-in-progress: true', 'jobs:', '  tidy:', '    steps:', '      - run: echo nothing to do with Pages', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group at job level and cancels',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'jobs:', '  tidy:', '    concurrency:', '      group: pages', '      cancel-in-progress: true', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group with an expression that can evaluate true',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency:', '  group: pages', "  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group on one inline line — the form that was fail-open',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency: { group: pages, cancel-in-progress: true }', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
        },
      ],
    ],
    [
      'an unrelated workflow joins the Pages group with a quoted true',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: ['name: Housekeeping', 'concurrency:', '  group: pages', "  cancel-in-progress: 'true'", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
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

  const benign: ReadonlyArray<readonly [string, WorkflowFile]> = [
    [
      'shares the Pages group but never sets the flag — the default is false, so it is safe',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', '  group: pages', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
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
        source: ['name: Housekeeping', 'concurrency:', '  group: pages', '  cancel-in-progress: false', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'declines to cancel in quotes — the same value, and flagging it would be a false alarm',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency:', '  group: pages', "  cancel-in-progress: 'false'", 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
      },
    ],
    [
      'declines to cancel inline',
      {
        name: 'housekeeping.yml',
        source: ['name: Housekeeping', 'concurrency: { group: pages, cancel-in-progress: false }', 'jobs:', '  tidy:', '    steps:', '      - run: echo tidy', ''].join('\n'),
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

  const cancelling = (group: string): WorkflowFile => ({
    name: 'probe.yml',
    source: `name: Probe\non:\n  workflow_dispatch:\nconcurrency:\n  group: ${group}\n  cancel-in-progress: true\njobs:\n  noop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
  })

  const spellings: ReadonlyArray<readonly [string, string]> = [
    ['identical', 'pages'],
    ['upper case, which GitHub folds to the same group', 'PAGES'],
    ['mixed case', 'Pages'],
    ["double quoted, as GitHub's own starter template writes it", '"pages"'],
    ['single quoted', "'pages'"],
    ['an expression that evaluates to it', "${{ 'pages' }}"],
    ['a folded scalar carrying the name on the next line', '>-\n    pages'],
  ]

  for (const [label, group] of spellings) {
    assert.ok(
      cancellationRisks([deploying, cancelling(group)]).length > 0,
      `a workflow joining the deployment's group written as ${label} was not reported`,
    )
  }

  // The other direction, and the reason the expression rule is a substring test
  // rather than a blanket "unreadable means dangerous": ci.yml cancels deliberately
  // under a group built from expressions, and must not be dragged in by it.
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
 */
test('the Pages workflow still declares the group and the flag it is supposed to', () => {
  const [real] = pagesWorkflows(readWorkflows())
  assert.ok(real, 'no Pages-deploying workflow found — the regex or the file moved')

  const blocks = concurrencyBlocks(real.source)
  assert.equal(blocks.length, 1, `expected exactly one concurrency block, found ${String(blocks.length)}`)

  const only = blocks[0]
  assert.ok(only, 'concurrency block missing after a length check said it was there')
  assert.equal(only.entries.get('group'), 'pages')
  assert.equal(only.entries.get('cancel-in-progress'), 'false')
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
    'deploy-pages.yml :: group: pages',
    'deploy-pages.yml :: cancel-in-progress: false',
  ])
})