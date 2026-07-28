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
 * repository's history — four of them, not one — killed the *build* job; the
 * deploy job recorded zero steps in all four, and a successful run records three,
 * so the zeros are real. No deployment has ever been interrupted here. The defect
 * is a window that is open, not a wound.
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
const DEPLOYS_PAGES = /^\s*(?:-\s+)?uses:\s*actions\/deploy-pages(?:@|\s|$)/m

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

    const inline = /^(\s*)concurrency:\s*\{(.*)\}\s*$/.exec(line)
    if (inline) {
      const entries = new Map<string, string>()
      for (const part of (inline[2] ?? '').split(',')) {
        const pair = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*([\s\S]*)$/.exec(part)
        if (pair) entries.set(pair[1] ?? '', scalar(pair[2] ?? ''))
      }
      blocks.push({ line: i + 1, entries })
      continue
    }

    const opened = /^(\s*)concurrency:\s*$/.exec(line)
    if (!opened) continue

    const indent = (opened[1] ?? '').length
    const entries = new Map<string, string>()

    for (let j = i + 1; j < lines.length; j += 1) {
      const child = lines[j] ?? ''
      if (/^\s*(#.*)?$/.test(child)) continue
      if (child.length - child.trimStart().length <= indent) break

      const pair = /^\s*([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(child)
      if (pair) entries.set(pair[1] ?? '', scalar(pair[2] ?? ''))
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
      if (group !== undefined && guarded.has(group) && cancelsInProgress(value)) {
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

test('no workflow can cancel a Pages deployment in flight', () => {
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
