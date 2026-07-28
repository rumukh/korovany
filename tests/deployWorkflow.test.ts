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
 * the inline mapping form is not understood, so it is reported as a failure
 * rather than passing silently.
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
 * Every block-form `concurrency:` mapping in a file, with its child scalars.
 * Indentation-scoped, so a key under a job-level block is not confused with one
 * under the workflow-level block — the relocation this is meant to catch.
 */
function concurrencyBlocks(source: string): ConcurrencyBlock[] {
  const lines = source.split(/\r?\n/)
  const blocks: ConcurrencyBlock[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const opened = /^(\s*)concurrency:\s*$/.exec(lines[i] ?? '')
    if (!opened) continue

    const indent = (opened[1] ?? '').length
    const entries = new Map<string, string>()

    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? ''
      if (/^\s*(#.*)?$/.test(line)) continue
      if (line.length - line.trimStart().length <= indent) break

      const pair = /^\s*([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line)
      if (pair) entries.set(pair[1] ?? '', (pair[2] ?? '').replace(/\s+#.*$/, '').trim())
    }

    blocks.push({ line: i + 1, entries })
  }

  return blocks
}

/**
 * Reasons a set of workflow files could cancel a Pages deployment mid-flight.
 * Empty means no reason was found — which is only meaningful alongside the
 * population count below it, so both are asserted.
 */
function cancellationRisks(files: readonly WorkflowFile[]): string[] {
  const risks: string[] = []

  for (const file of files) {
    if (!DEPLOYS_PAGES.test(file.source)) continue

    const blocks = concurrencyBlocks(file.source)
    if (blocks.length === 0) {
      risks.push(`${file.name}: deploys Pages but has no concurrency: block this check can read`)
      continue
    }

    for (const block of blocks) {
      const value = block.entries.get('cancel-in-progress')
      if (value === undefined) {
        risks.push(`${file.name}:${String(block.line)}: concurrency block does not set cancel-in-progress`)
      } else if (value !== 'false') {
        risks.push(`${file.name}:${String(block.line)}: cancel-in-progress is \`${value}\`, not false`)
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
      'concurrency rewritten in the inline mapping form this parser cannot read',
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
