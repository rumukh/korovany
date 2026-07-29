import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'

/**
 * `deploy-pages.yml` carried `cancel-in-progress: true` on a workflow-level
 * concurrency group covering both the build job and the deploy job. GitHub's own
 * Pages template sets it `false`, with a comment saying production deployments
 * should be allowed to complete.
 *
 * The evidence first offered for this was a cancelled run eight seconds before a
 * successful one. That is not what it looked like. The reading was then checked
 * against a much better population than the one it came from: all 82 recorded
 * Pages runs since the repository was created, run numbers 1-82 with no gaps,
 * 77 success / 4 cancelled / 1 failure. The 77 successful deploy jobs record
 * exactly three steps each, and the four cancelled SHAs have no artifacts and no
 * `github-pages` deployment records.
 *
 * It also refuted the inference actually being made. The one failed run's deploy
 * job was *skipped*, and it too reports `steps: []`. So empty steps is not a
 * synonym for "never executed"; it is also what a skipped dependant looks like.
 *
 * Stated no more strongly than it was measured: **across all 82 recorded Pages
 * runs, no deployment job is recorded as starting and then being cancelled.** Of
 * the four cancellations, three were runner-assigned builds and one was cancelled
 * before a runner was assigned. "Four builds did work and were abandoned" was not
 * measured. The defect is a window that is open, not a wound.
 *
 * Which is why this is a check rather than an incident report: the harm has no
 * artefact to point at, so nothing but a gate will keep the flag down.
 *
 * ## What changed in this round, and why the parser did
 *
 * Every earlier round of this file read YAML with a hand-written scanner, and
 * every round found another *form* the scanner could not see: a compact `- uses:`
 * step, a quoted action name, a quoted mapping key, an inline flow mapping, a bare
 * scalar group, a folded block scalar with an indentation indicator. Three
 * reviewers then independently produced structured encodings it still missed:
 *
 *   - a real deployment step written `"uses": actions/deploy-pages@v4`, with a
 *     decoy `uses:` line inside a `run: |` block scalar in another job, which
 *     moved the scanner's idea of "the deploying job" onto the wrong job;
 *   - a folded value, `uses: >-` with `actions/deploy-pages@v4` on the next line;
 *   - an escaped scalar, `uses: "actions/\u0064eploy-pages@v4"`, which decodes to
 *     the same action and contains none of the letters a text scan looks for.
 *
 * There is no argument that a list of forms patched one at a time is ever
 * complete, so this round stops patching and parses. The semantic checks below run
 * on a YAML document produced by the `yaml` package, declared as a devDependency
 * and pinned in the lockfile rather than borrowed from a transitive. Structure is
 * whatever the parser says it is: escapes are decoded, folded and literal scalars
 * are joined, flow and block mappings are the same mapping, quoted and plain keys
 * are the same key, and the contents of a `run: |` block are a *string* — so text
 * shaped like a step inside one attributes nothing, because it is not a step.
 *
 * ## What is still not claimed
 *
 * The parser removes the *encoding* blind spots. It does not remove indirection,
 * and that is said out loud instead of being papered over:
 *
 *   - a step may call a remote action (`owner/repo@ref`) whose own steps live in
 *     another repository, and nothing here can read those. Every workflow uses
 *     such actions, so this cannot be reported without reporting everything. It is
 *     the residual, and it is stated rather than measured away.
 *   - a step may call a *local* composite action (`./.github/actions/...`), and a
 *     job may call a reusable workflow with a job-level `uses:`. Those are
 *     readable in principle and unread here, so they are reported rather than
 *     ignored. The repository contains none, so the rule costs nothing today.
 *
 * The other honest limit is unchanged: this reads the *input* handed to GitHub's
 * scheduler and cannot observe the scheduler. Claims about queueing and
 * cancellation below are quoted from the documented semantics in the conditional,
 * never asserted as something this repository watched happen.
 */

/** A workflow file as it sits on disk, or as a doped variant of one. */
type WorkflowFile = { readonly name: string; readonly source: string }

/** Which declaration a concurrency block belongs to: the whole run, or one job. */
type Owner = { readonly kind: 'workflow' } | { readonly kind: 'job'; readonly job: string }

/**
 * A mapping value, with the YAML type kept alongside the text.
 *
 * The type is load-bearing rather than decorative. GitHub's workflow schema
 * declares `cancel-in-progress` as a boolean or an expression, so `false` and
 * `'false'` are not two spellings of one value — the second is a string and is not
 * a valid workflow at all. A check that folds them together certifies a file
 * GitHub would reject, which is the shape of a control that proves nothing.
 */
type Entry = { readonly text: string; readonly kind: 'boolean' | 'number' | 'string' | 'empty' }

type ConcurrencyBlock = {
  readonly owner: Owner
  readonly line: number
  readonly entries: ReadonlyMap<string, Entry>
}

/** A workflow reduced to the parts these checks reason about. */
type Workflow = {
  readonly name: string
  readonly blocks: readonly ConcurrencyBlock[]
  readonly jobs: readonly string[]
  readonly deployJobs: readonly string[]
  readonly uses: readonly string[]
  readonly triggers: readonly string[]
  readonly value: Record<string, unknown> | null
  /** Forms this check refuses to guess at. Non-empty means "a person has to look". */
  readonly unreadable: readonly string[]
}

/**
 * The deployment action, matched against the *decoded* value of a step's `uses`.
 * No quoting, folding or escaping survives to this point, so the pattern only has
 * to know the action's name and the two ways a reference can end.
 */
const DEPLOY_ACTION = /^actions\/deploy-pages(?:@.*)?$/

/**
 * The keys a concurrency mapping may carry. GitHub's published workflow schema
 * declares exactly `group` (required), `cancel-in-progress` and `queue`, so
 * anything else is either not a valid workflow or a key added after this check was
 * written. Both want a person, not a silence.
 */
const CONCURRENCY_KEYS = new Set(['group', 'cancel-in-progress', 'queue'])

/**
 * The documented values of `queue`: "`single` (default): At most one job or
 * workflow run can be `pending` in the concurrency group" and "`max`: Up to 100
 * jobs or workflow runs can be `pending`".
 */
const QUEUE_VALUES = new Set(['single', 'max'])

/**
 * The context a cancelling group must vary by so that a manual run cannot cancel
 * a push, and the contexts that distinguish one ref from another. `workflow_dispatch`
 * "only receives events when the workflow file is on the default branch", but the
 * run it starts names its own branch or tag, so a cancelling group that is constant
 * across refs is a group an arbitrary ref can join.
 */
const EVENT_CONTEXT = 'github.event_name'
const REF_CONTEXTS = ['github.ref', 'github.ref_name', 'github.head_ref', 'github.sha', 'github.run_id']

function lineOf(counter: LineCounter, node: unknown): number {
  const range = (node as { range?: readonly number[] } | null | undefined)?.range
  return range === undefined ? 0 : counter.linePos(range[0]).line
}

/**
 * A scalar node reduced to its decoded text and its YAML type, or `null` when the
 * node is not a scalar at all. `null` is the caller's cue to report rather than
 * guess: a mapping or a sequence where a scalar belongs is a form, not a value.
 */
function entryOf(node: unknown): Entry | null {
  if (!isScalar(node)) return null

  const value = node.value
  if (value === null || value === undefined) return { text: '', kind: 'empty' }
  if (typeof value === 'boolean') return { text: String(value), kind: 'boolean' }
  if (typeof value === 'number') return { text: String(value), kind: 'number' }
  if (typeof value === 'string') return { text: value, kind: 'string' }
  return null
}

function keyText(node: unknown): string | null {
  const entry = entryOf(node)
  return entry === null ? null : entry.text
}

/**
 * Parse one workflow into the model above.
 *
 * Every branch that cannot read something appends to `unreadable` rather than
 * returning a shorter list, because "no jobs" and "jobs I could not segment" are
 * the same value and opposite facts — the fail-open shape of every earlier round.
 */
function readWorkflow(file: WorkflowFile): Workflow {
  const counter = new LineCounter()
  const doc = parseDocument(file.source, { lineCounter: counter, uniqueKeys: true, merge: false })

  const unreadable: string[] = []
  const blocks: ConcurrencyBlock[] = []
  const jobs: string[] = []
  const deployJobs: string[] = []
  const uses: string[] = []
  const triggers: string[] = []

  const say = (node: unknown, message: string): void => {
    unreadable.push(`${file.name}:${String(lineOf(counter, node))}: ${message}`)
  }

  for (const error of doc.errors) unreadable.push(`${file.name}: YAML does not parse: ${error.message}`)
  if (doc.errors.length > 0) {
    return { name: file.name, blocks, jobs, deployJobs, uses, triggers, value: null, unreadable }
  }

  const root = doc.contents
  if (!isMap(root)) {
    unreadable.push(`${file.name}: the document is not a mapping, so it is not a workflow this check can read`)
    return { name: file.name, blocks, jobs, deployJobs, uses, triggers, value: null, unreadable }
  }

  /** One `concurrency:` value, in any of the forms the schema allows. */
  const readConcurrency = (owner: Owner, pair: { key: unknown; value: unknown }): void => {
    const line = lineOf(counter, pair.key)
    const node = pair.value
    const entries = new Map<string, Entry>()

    if (isAlias(node)) {
      say(pair.key, 'concurrency is an alias, and this check will not follow one to another node')
      return
    }

    // `oneOf: [string, object]` — the bare scalar names a group and takes the
    // documented default for the flag, which is the form that used to read as
    // "no block at all" and therefore as silence.
    const scalar = entryOf(node)
    if (scalar !== null) {
      entries.set('group', scalar)
      blocks.push({ owner, line, entries })
      return
    }

    if (!isMap(node)) {
      say(pair.key, 'concurrency is neither a scalar nor a mapping, so this check cannot read it')
      return
    }

    for (const child of node.items) {
      const key = keyText(child.key)
      if (key === null) {
        say(child.key, 'a concurrency key is not a scalar, so this check cannot name it')
        continue
      }

      if (isAlias(child.value)) {
        say(child.key, `concurrency \`${key}\` is an alias, and this check will not follow one`)
        continue
      }

      const entry = entryOf(child.value)
      if (entry === null) {
        say(child.key, `concurrency \`${key}\` is not a scalar, so this check cannot read its value`)
        continue
      }

      entries.set(key, entry)
    }

    blocks.push({ owner, line, entries })
  }

  const topConcurrency = root.items.find((pair) => keyText(pair.key) === 'concurrency')
  if (topConcurrency !== undefined) readConcurrency({ kind: 'workflow' }, topConcurrency)

  const onPair = root.items.find((pair) => keyText(pair.key) === 'on')
  if (onPair !== undefined) {
    const node = onPair.value
    if (isMap(node)) {
      for (const child of node.items) {
        const key = keyText(child.key)
        if (key === null) say(child.key, 'a trigger name is not a scalar')
        else triggers.push(key)
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        const key = keyText(item)
        if (key === null) say(item, 'a trigger name is not a scalar')
        else triggers.push(key)
      }
    } else {
      const scalar = entryOf(node)
      if (scalar === null) say(onPair.key, 'on: is a form this check cannot read as a set of triggers')
      else triggers.push(scalar.text)
    }
  }

  const jobsPair = root.items.find((pair) => keyText(pair.key) === 'jobs')
  if (jobsPair !== undefined) {
    const jobsNode = jobsPair.value
    if (!isMap(jobsNode)) {
      say(jobsPair.key, 'jobs: is not a mapping, so this check cannot segment it into jobs')
    } else {
      for (const jobPair of jobsNode.items) {
        const job = keyText(jobPair.key)
        if (job === null) {
          say(jobPair.key, 'a job name is not a scalar, so this check cannot attribute its blocks')
          continue
        }

        jobs.push(job)

        const body = jobPair.value
        if (!isMap(body)) {
          say(jobPair.key, `job \`${job}\` is not a mapping, so this check cannot read its steps`)
          continue
        }

        const own = body.items.find((pair) => keyText(pair.key) === 'concurrency')
        if (own !== undefined) readConcurrency({ kind: 'job', job }, own)

        // A job-level `uses:` calls a reusable workflow, whose steps are in
        // another file. Readable in principle, unread here, so it is reported.
        const reusable = body.items.find((pair) => keyText(pair.key) === 'uses')
        if (reusable !== undefined) {
          const target = entryOf(reusable.value)
          say(
            reusable.key,
            `job \`${job}\` calls the reusable workflow \`${target?.text ?? '?'}\`, whose steps this check cannot read`,
          )
        }

        const stepsPair = body.items.find((pair) => keyText(pair.key) === 'steps')
        if (stepsPair === undefined) continue

        const steps = stepsPair.value
        if (!isSeq(steps)) {
          say(stepsPair.key, `the steps of job \`${job}\` are not a sequence, so this check cannot read them`)
          continue
        }

        steps.items.forEach((step, index) => {
          if (!isMap(step)) {
            say(step, `step ${String(index + 1)} of job \`${job}\` is not a mapping`)
            return
          }

          const usesPair = step.items.find((pair) => keyText(pair.key) === 'uses')
          if (usesPair === undefined) return

          const action = entryOf(usesPair.value)
          if (action === null) {
            say(usesPair.key, `step ${String(index + 1)} of job \`${job}\` has a \`uses\` this check cannot read`)
            return
          }

          uses.push(action.text)

          if (action.text.startsWith('./') || action.text.startsWith('.\\')) {
            say(
              usesPair.key,
              `step ${String(index + 1)} of job \`${job}\` uses the local action \`${action.text}\`, ` +
                'whose own steps this check cannot read',
            )
          }

          if (DEPLOY_ACTION.test(action.text) && !deployJobs.includes(job)) deployJobs.push(job)
        })
      }
    }
  }

  const value = doc.toJS() as Record<string, unknown> | null

  return { name: file.name, blocks, jobs, deployJobs, uses, triggers, value, unreadable }
}

function readModels(files: readonly WorkflowFile[]): Workflow[] {
  return files.map(readWorkflow)
}

/** A workflow-level block governs every job; a job-level block governs only its own. */
function governs(block: ConcurrencyBlock, job: string): boolean {
  return block.owner.kind === 'workflow' || block.owner.job === job
}

/** The literal segments of a group, with every `${{ … }}` removed as a hole. */
function segments(group: string): string[] {
  return group.split(/\$\{\{[\s\S]*?\}\}/)
}

/**
 * Whether a literal group name is one the pattern could produce. The holes stand
 * for expressions, which can evaluate to anything, so a hole matches any run of
 * characters: `pages-build-${{ … }}-${{ … }}` can produce
 * `pages-build-push-refs/heads/main` and cannot produce `pages-deploy`.
 */
function patternMatches(parts: readonly string[], text: string): boolean {
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''

  if (parts.length === 1) return first === text
  if (!text.startsWith(first) || !text.endsWith(last)) return false
  if (first.length + last.length > text.length) return false

  let at = first.length
  for (let i = 1; i < parts.length - 1; i += 1) {
    const found = text.indexOf(parts[i] ?? '', at)
    if (found < 0) return false
    at = found + (parts[i] ?? '').length
  }

  return at <= text.length - last.length
}

/**
 * Whether a declared group can be the same group GitHub schedules a guarded job
 * under. Four ways it can be, beyond spelling it identically:
 *
 * Case. "The concurrency group name is case insensitive. For example, `prod` and
 * `Prod` will be treated as the same concurrency group." A probe declaring
 * `group: PAGES` once passed the test named for this property.
 *
 * Naming. `group: ${{ 'pages-deploy' }}` cannot be evaluated here, so an
 * expression that mentions a guarded name is treated as able to produce it. The
 * rule is deliberately about the guarded group's *first literal segment*, which is
 * what discriminates: `ci.yml` builds its group from `github.workflow` and
 * `github.ref` and mentions neither `pages-deploy` nor `pages-build-`, so it stays
 * quiet, while an expression that names one does not.
 *
 * Assembly. The substring test is defeated by an expression that produces a name
 * without containing it — `${{ format('{0}{1}', 'pa', 'ges') }}` is a reviewer's,
 * and it passed. So an expression carrying a construct this check does not model
 * is treated as able to produce anything guarded, and a function call is the
 * detectable form of "not modelled". The whole repository was measured under this
 * rule before it shipped: no workflow here calls a function in a group.
 *
 * Production. A guarded group may itself be an expression — `pages-build` is now
 * `pages-build-${{ github.event_name }}-${{ github.ref }}` — so a foreign group
 * spelled as the *literal* that pattern produces on main joins it. Comparing the
 * two as strings would have missed exactly that, which is the collision the split
 * created and the reason the guarded side is a pattern rather than a name.
 *
 * It is fail-closed, and the price is stated rather than hidden: a legitimate
 * `format('ci-{0}', github.ref)` group is reported too. That is a loud failure on
 * a concurrency edit whose safety genuinely cannot be decided here.
 *
 * It closes bypasses, not the class. Measured, still fail-open here and caught
 * only by the pins: `${{ github.event.inputs.g }}` and `${{ env.GROUP }}`, which
 * name nothing and call nothing yet can resolve to anything.
 */
function joinsGuardedGroup(group: string, guarded: ReadonlySet<string>): boolean {
  const declared = group.toLowerCase()
  const declaredParts = segments(declared)
  const opaque = declared.includes('${{') && /[a-z_]\w*\s*\(/.test(declared)

  for (const guardedGroup of guarded) {
    const target = guardedGroup.toLowerCase()
    if (declared === target) return true
    if (opaque) return true

    const targetParts = segments(target)
    const head = targetParts[0] ?? ''

    if (declaredParts.length === 1 && targetParts.length > 1 && patternMatches(targetParts, declared)) return true
    if (declaredParts.length > 1 && head !== '' && declared.includes(head)) return true
  }

  return false
}

/** Every group a workflow declares, wherever it declares it. */
function declaredGroups(workflow: Workflow): Set<string> {
  const groups = new Set<string>()

  for (const block of workflow.blocks) {
    const group = block.entries.get('group')
    if (group !== undefined && group.text !== '') groups.add(group.text)
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
function protectedGroups(models: readonly Workflow[]): Set<string> {
  const groups = new Set<string>()

  for (const workflow of models) {
    for (const block of workflow.blocks) {
      if (!workflow.deployJobs.some((job) => governs(block, job))) continue

      const group = block.entries.get('group')
      if (group !== undefined && group.text !== '') groups.add(group.text)
    }
  }

  return groups
}

/**
 * Absent means false: that is the documented default, so a workflow that shares
 * the group without mentioning the flag is safe and must not be reported. Only a
 * present, non-`false` value cancels — including an expression, which can be true.
 */
function cancelsInProgress(entry: Entry | undefined): boolean {
  if (entry === undefined) return false
  return !(entry.kind === 'boolean' && entry.text === 'false')
}

/**
 * A `cancel-in-progress` GitHub would accept. The schema gives it as a boolean or
 * an expression, so `'false'` in quotes is a *string* and not a valid workflow —
 * and a control written that way certifies a file that would never run, which is
 * how a green suite ends up meaning nothing.
 */
function schemaViolation(entry: Entry): string | null {
  if (entry.kind === 'boolean') return null
  if (entry.kind === 'string' && entry.text.includes('${{')) return null
  return `cancel-in-progress is \`${entry.text}\` as a ${entry.kind}, which is neither a boolean nor an expression`
}

/**
 * Reasons a set of workflows could cancel a Pages deployment mid-flight. Empty
 * means no reason was found — which is only meaningful alongside the population
 * count beside it, so both are asserted wherever this is used.
 */
function cancellationRisks(files: readonly WorkflowFile[]): string[] {
  const models = readModels(files)
  const risks: string[] = []
  const guarded = protectedGroups(models)

  for (const workflow of models) {
    risks.push(...workflow.unreadable)

    for (const job of workflow.deployJobs) {
      if (!workflow.blocks.some((block) => governs(block, job))) {
        risks.push(`${workflow.name}: job \`${job}\` deploys Pages under no concurrency block this check can read`)
      }
    }

    for (const block of workflow.blocks) {
      const where = `${workflow.name}:${String(block.line)}`

      for (const key of block.entries.keys()) {
        if (!CONCURRENCY_KEYS.has(key)) {
          risks.push(`${where}: concurrency sets \`${key}\`, which is not a key this check models`)
        }
      }

      const queue = block.entries.get('queue')
      const flag = block.entries.get('cancel-in-progress')

      if (queue !== undefined && !QUEUE_VALUES.has(queue.text)) {
        risks.push(`${where}: queue is \`${queue.text}\`, which is neither \`single\` nor \`max\``)
      }

      // "The combination of `queue: max` and `cancel-in-progress: true` is not
      // allowed and will result in a workflow validation error."
      if (queue?.text === 'max' && flag?.kind === 'boolean' && flag.text === 'true') {
        risks.push(`${where}: queue \`max\` is combined with cancel-in-progress \`true\`, which GitHub rejects`)
      }

      if (flag !== undefined) {
        const violation = schemaViolation(flag)
        if (violation !== null) risks.push(`${where}: ${violation}`)
      }

      const group = block.entries.get('group')
      if (group === undefined || group.text === '') {
        risks.push(`${where}: concurrency block declares no group`)
        continue
      }

      // A group the deployment itself runs under is held to the stricter rule: the
      // flag must be present and false, so that deleting it is a failure rather
      // than a silent fallback to a default that happens to be correct today.
      if (workflow.deployJobs.some((job) => governs(block, job))) {
        if (flag === undefined) {
          risks.push(`${where}: the group the deployment runs under does not set cancel-in-progress`)
        } else if (cancelsInProgress(flag)) {
          risks.push(`${where}: cancel-in-progress is \`${flag.text}\`, not false, on a group the deployment runs under`)
        }
        continue
      }

      if (joinsGuardedGroup(group.text, guarded) && cancelsInProgress(flag)) {
        risks.push(`${where}: joins Pages group \`${group.text}\` with cancel-in-progress \`${flag?.text ?? ''}\``)
      }
    }
  }

  return risks
}

/**
 * Reasons a cancelling group could be entered by a run that has no business
 * superseding what is already in it.
 *
 * This is the hazard `workflow_dispatch` creates and no cancellation check can
 * see, because the thing cancelled is a *build*. A manual run picks its own ref;
 * the workflow file has to be on the default branch for the trigger to exist, but
 * the run is started against a chosen branch or tag. So a constant cancelling
 * group is a group any ref can join, and a manual run of a months-old ref would
 * cancel the build of the newest commit on main — and a cancelled build leaves the
 * deployment skipped, which is a stale site with nothing pointing at it.
 *
 * The rule is therefore about the group *varying*: a cancelling group in a
 * workflow that can be dispatched must vary by event and by ref. Workflows without
 * `workflow_dispatch` are not held to it, because their refs are whatever their
 * triggers allow and that is a different argument.
 */
function supersessionRisks(files: readonly WorkflowFile[]): string[] {
  const risks: string[] = []

  for (const workflow of readModels(files)) {
    if (!workflow.triggers.includes('workflow_dispatch')) continue

    for (const block of workflow.blocks) {
      const group = block.entries.get('group')
      if (group === undefined || !cancelsInProgress(block.entries.get('cancel-in-progress'))) continue

      const missing: string[] = []
      if (!group.text.includes(EVENT_CONTEXT)) missing.push(EVENT_CONTEXT)
      if (!REF_CONTEXTS.some((context) => group.text.includes(context))) missing.push(REF_CONTEXTS.join(' or '))
      if (missing.length === 0) continue

      risks.push(
        `${workflow.name}:${String(block.line)}: the cancelling group \`${group.text}\` does not vary by ` +
          `${missing.join(' and ')}, so a workflow_dispatch run of any ref joins it`,
      )
    }
  }

  return risks
}

/**
 * Workflows other than the Pages workflow that declare one of its groups.
 *
 * This is a membership claim and not a cancellation one, deliberately. Splitting
 * the concurrency per job created a build group whose members cancel *builds*; a
 * cancelled build leaves `deploy` skipped, so the site silently stays on an older
 * commit and no deployment is ever recorded as interrupted. The check above would
 * see nothing, and modelling a second kind of harm would mean modelling `needs:`
 * chains.
 *
 * So the groups the Pages workflow declares are reserved to it, which is what the
 * documentation asks for: "concurrency group names must be unique across workflows
 * to avoid canceling in-progress jobs or runs from other workflows. Otherwise, any
 * previously in-progress or pending job will be canceled, regardless of the
 * workflow." It is stricter than the cancellation rule on purpose — sharing a
 * group without cancelling still serialises a foreign workflow against Pages.
 */
function groupIntruders(files: readonly WorkflowFile[]): string[] {
  const models = readModels(files)
  const intruders: string[] = []

  for (const pages of models.filter((workflow) => workflow.deployJobs.length > 0)) {
    const reserved = declaredGroups(pages)

    for (const workflow of models) {
      if (workflow.name === pages.name) continue

      for (const block of workflow.blocks) {
        const group = block.entries.get('group')
        if (group === undefined || !joinsGuardedGroup(group.text, reserved)) continue

        intruders.push(
          `${workflow.name}:${String(block.line)}: declares \`${group.text}\`, a group reserved to ${pages.name}`,
        )
      }
    }
  }

  return intruders
}

function pagesWorkflows(files: readonly WorkflowFile[]): WorkflowFile[] {
  return files.filter((file) => readWorkflow(file).deployJobs.length > 0)
}

/**
 * The risks a file contributes when paired with another, and only those.
 *
 * The controls that have to stay quiet were previously written as "the pair
 * reports nothing", which is a different claim and a contaminated one: it fails
 * whenever the *base* file is dirty, for reasons that have nothing to do with the
 * probe. Measured under a mutation harness, that turned every edit to the real
 * workflow into a red in the controls as well as in the pins, and a red in a
 * control reads as "the checker is over-firing" when it means "the base is
 * broken". The difference is what the probe is responsible for.
 *
 * Which claim is being measured is passed in rather than assumed, because the
 * claims are deliberately different: a workflow can join a reserved group without
 * being able to cancel a deployment, and a control for one must not be answered by
 * the other.
 */
function contributed(
  base: WorkflowFile,
  added: WorkflowFile,
  probe: (files: readonly WorkflowFile[]) => string[],
): string[] {
  const before = new Set(probe([base]))
  return probe([base, added]).filter((risk) => !before.has(risk))
}

/** Every claim this file makes, for the probes that do not care which one fires. */
function allRisks(files: readonly WorkflowFile[]): string[] {
  return [...cancellationRisks(files), ...groupIntruders(files), ...supersessionRisks(files)]
}

function readWorkflows(): WorkflowFile[] {
  const dir = new URL('../.github/workflows/', import.meta.url)
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, source: readFileSync(new URL(name, dir), 'utf8') }))
}

/**
 * The real Pages workflow, with the population assertion that makes finding it
 * mean something. Every doped case below starts here, so a change that makes this
 * return the wrong file would otherwise turn a whole test into a tautology.
 */
function realPagesWorkflow(): WorkflowFile {
  const deploying = pagesWorkflows(readWorkflows())
  assert.equal(
    deploying.length,
    1,
    `precondition: expected exactly one Pages-deploying workflow, found ${String(deploying.length)}`,
  )

  const real = deploying[0]
  assert.ok(real, 'precondition: no Pages-deploying workflow to work from')
  return real
}

/**
 * A doped edit that proves it is one.
 *
 * Two failures this repository has already had are impossible here by
 * construction: an edit whose target is not in the file (which produces a clean
 * scan indistinguishable from a genuine pass) and an edit whose target is in the
 * file more than once (which changes something other than what the label says).
 * A third is caught immediately after: an edit that produces YAML GitHub could not
 * run, which proves a bypass nobody can actually use.
 */
function dope(source: string, find: string | RegExp, replacement: string, label: string): string {
  const pattern = typeof find === 'string' ? find : find.source
  const flags = typeof find === 'string' ? 'g' : find.flags.includes('g') ? find.flags : `${find.flags}g`
  const escaped = typeof find === 'string' ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern
  const hits = source.match(new RegExp(escaped, flags))

  assert.equal(
    hits?.length ?? 0,
    1,
    `precondition: ${label}: the dope's target occurs ${String(hits?.length ?? 0)} times, so the edit is not the edit it claims`,
  )

  const doped = source.replace(find, replacement)
  assert.notEqual(doped, source, `precondition: ${label}: the dope changed nothing, so its result means nothing`)
  return doped
}

/** A doped file must still be YAML GitHub could parse, or it proves no bypass. */
function assertParses(file: WorkflowFile, label: string): void {
  const errors = parseDocument(file.source, { uniqueKeys: true, merge: false }).errors
  assert.deepEqual(
    errors.map((error) => error.message),
    [],
    `precondition: ${label}: ${file.name} is not valid YAML, so it is not a bypass anyone could commit`,
  )
}

/**
 * The three encodings that defeated the text scanner, kept as fixtures rather than
 * as prose. Each is valid YAML that GitHub would run.
 */
const QUOTED_KEY_BYPASS: WorkflowFile = {
  name: 'bypass.yml',
  source: [
    'name: Bypass',
    'on:',
    '  push:',
    '    branches:',
    '      - main',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    concurrency:',
    '      group: pages-build-${{ github.event_name }}-${{ github.ref }}',
    '      cancel-in-progress: true',
    '    steps:',
    '      - "uses": actions/deploy-pages@v4',
    '  deploy:',
    '    runs-on: ubuntu-latest',
    '    needs: build',
    '    concurrency:',
    '      group: pages-deploy',
    '      cancel-in-progress: false',
    '    steps:',
    '      - run: |',
    '          uses: actions/deploy-pages@v4',
    '',
  ].join('\n'),
}

const FOLDED_USES: WorkflowFile = {
  name: 'folded.yml',
  source: [
    'name: Folded',
    'jobs:',
    '  ship:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: >-',
    '          actions/deploy-pages@v4',
    '',
  ].join('\n'),
}

const ESCAPED_USES: WorkflowFile = {
  name: 'escaped.yml',
  source: [
    'name: Escaped',
    'jobs:',
    '  ship:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: "actions/\\u0064eploy-pages@v4"',
    '',
  ].join('\n'),
}

const BLOCK_SCALAR_DECOY: WorkflowFile = {
  name: 'decoy.yml',
  source: [
    'name: Decoy',
    'jobs:',
    '  tidy:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: |',
    '          uses: actions/deploy-pages@v4',
    '          echo "not a step, a shell script that mentions one"',
    '',
  ].join('\n'),
}

/**
 * A deployment reached through a job-level reusable-workflow call, sitting under a
 * group that cancels. This passed the earlier guard completely: there is no `uses:`
 * step to attribute, so the job was not a deploying job, so the strict rule never
 * applied to the block above it. It is not readable here either — the steps are in
 * another file — but "not readable" is reported rather than treated as "no
 * deployment", which is the difference between a gate and a silence.
 */
const REUSABLE_UNDER_CANCEL: WorkflowFile = {
  name: 'reusable.yml',
  source: [
    'name: Reusable',
    'on:',
    '  push:',
    '    branches:',
    '      - main',
    'jobs:',
    '  build:',
    '    concurrency:',
    '      group: pages-build-${{ github.event_name }}-${{ github.ref }}',
    '      cancel-in-progress: true',
    '    uses: ./.github/workflows/publish.yml',
    '',
  ].join('\n'),
}

/**
 * Quoted job keys, and a quoted `jobs` key above them. The parser decodes both, so
 * this is the same workflow as the unquoted spelling and is read as one.
 *
 * It is kept as a fixture for a second reason, stated rather than discovered later:
 * the doped edits below find their targets by literal text, so quoting a job key
 * makes those edits match nothing. That is a `precondition:` failure by design —
 * loud, and about the harness rather than the workflow.
 */
const QUOTED_JOB_KEYS: WorkflowFile = {
  name: 'quoted-jobs.yml',
  source: [
    'name: Quoted',
    '"jobs":',
    '  "build":',
    '    "runs-on": ubuntu-latest',
    '    "concurrency":',
    '      "group": pages-deploy',
    '      "cancel-in-progress": true',
    '    "steps":',
    '      - "uses": actions/deploy-pages@v4',
    '',
  ].join('\n'),
}

/**
 * Two deployments that the earlier guard let through because they are not written
 * as a plain step in a plain job: one under a `strategy: matrix:`, one behind an
 * `if:`. Neither changes what the step *is*, and both are read here.
 *
 * Treating `if:` as irrelevant is deliberate and fail-closed: whether the condition
 * evaluates true is not decidable from the file, so a step that could deploy is
 * treated as one that does. The alternative is a guard that can be turned off with
 * an expression.
 */
const MATRIX_DEPLOY: WorkflowFile = {
  name: 'matrix.yml',
  source: [
    'name: Matrix',
    'jobs:',
    '  ship:',
    '    runs-on: ubuntu-latest',
    '    strategy:',
    '      matrix:',
    '        target: [alpha, beta]',
    '    concurrency:',
    '      group: pages-deploy-${{ matrix.target }}',
    '      cancel-in-progress: true',
    '    steps:',
    '      - uses: actions/deploy-pages@v4',
    '',
  ].join('\n'),
}

const CONDITIONAL_DEPLOY: WorkflowFile = {
  name: 'conditional.yml',
  source: [
    'name: Conditional',
    'jobs:',
    '  ship:',
    '    runs-on: ubuntu-latest',
    '    concurrency:',
    '      group: pages-ship',
    '      cancel-in-progress: true',
    '    steps:',
    "      - if: ${{ github.ref == 'refs/heads/never' }}",
    '        uses: actions/deploy-pages@v4',
    '',
  ].join('\n'),
}

test('no workflow on disk can cancel a Pages deployment', () => {
  const files = readWorkflows()

  // The population, before the verdict. A zero from a scan that examined nothing
  // is the failure this repository has caught more often than any other.
  assert.ok(files.length >= 2, `precondition: expected at least ci.yml and deploy-pages.yml, found ${String(files.length)}`)

  const deploying = pagesWorkflows(files)
  assert.deepEqual(
    deploying.map((file) => file.name),
    ['deploy-pages.yml'],
    'precondition: the Pages-deploying workflow is not the one these checks were written against',
  )

  // ci.yml sets `cancel-in-progress` to an expression and must not be caught by
  // this: it deploys nothing, and cancelling a superseded PR run is the point.
  assert.ok(
    files.some((file) => file.name === 'ci.yml' && readWorkflow(file).deployJobs.length === 0),
    'precondition: ci.yml should be present and deploy nothing — if it is being treated as a deployer, the model is wrong',
  )

  assert.deepEqual(cancellationRisks(files), [], 'live: a workflow on disk can cancel a Pages deployment')
  assert.deepEqual(supersessionRisks(files), [], 'live: a cancelling group on disk can be joined by a run of any ref')
  assert.deepEqual(groupIntruders(files), [], 'live: a workflow on disk declares a group reserved to the Pages workflow')
})

/**
 * The three structured encodings, as a test rather than a claim. Two of them must
 * be *seen* — a folded value and an escaped one name the deployment action however
 * they are written — and one must be *ignored*, because the contents of a block
 * scalar are a string and a string shaped like a step is not a step.
 *
 * The last is the one that mattered most: the text scanner attributed the
 * deployment to whichever job the marker appeared in, so a decoy inside `run: |`
 * moved "the deploying job" onto a job with no deployment in it, and the real
 * deployment step — written with a quoted key in a job that cancels — was left
 * governed by nothing the check would hold to the strict rule.
 */
test('the parser reads the structured forms a text scan could not, and ignores the text that only looks structured', () => {
  assertParses(FOLDED_USES, 'folded uses')
  assertParses(ESCAPED_USES, 'escaped uses')
  assertParses(BLOCK_SCALAR_DECOY, 'block scalar decoy')
  assertParses(QUOTED_KEY_BYPASS, 'quoted key bypass')

  assert.deepEqual(readWorkflow(FOLDED_USES).deployJobs, ['ship'], 'a folded `uses:` names the same action')
  assert.deepEqual(readWorkflow(ESCAPED_USES).deployJobs, ['ship'], 'an escaped `uses:` decodes to the same action')

  const decoy = readWorkflow(BLOCK_SCALAR_DECOY)
  assert.deepEqual(decoy.deployJobs, [], 'text inside a `run: |` block is a string, not a step')
  assert.deepEqual(decoy.uses, [], 'nothing inside a block scalar is a `uses`')
  assert.deepEqual(decoy.unreadable, [], 'and a workflow that merely mentions the action is not thereby unreadable')

  // The exact bypass, end to end: the real deployment is in `build`, which
  // cancels, and the decoy is in `deploy`, which does not. A check that believes
  // the decoy protects the wrong job and reports nothing.
  const bypass = readWorkflow(QUOTED_KEY_BYPASS)
  assert.deepEqual(bypass.deployJobs, ['build'], 'a quoted `"uses"` key is the same key, and the decoy is not one')

  const risks = cancellationRisks([QUOTED_KEY_BYPASS])
  assert.ok(
    risks.some((risk) => /cancel-in-progress is `true`, not false, on a group the deployment runs under/.test(risk)),
    `catch: the quoted-key bypass was not reported for its own reason — got ${JSON.stringify(risks)}`,
  )
})

/**
 * Every doped input, with the reason it was written for.
 *
 * A count of risks is not evidence that the right thing was noticed: a check that
 * reported one wrong reason for every doped input would satisfy `length > 0` on
 * all of them, and an earlier round of this file asserted exactly that. It matters
 * more under the per-job shape, which gives one file several ways to be wrong at
 * once and makes `protectedGroups` decide between them.
 *
 * So there is one table and every row carries a reason. There is also a discipline
 * about *failure messages*, because a red suite is a tally only if the reds mean
 * the same thing. Every assertion in this file is prefixed with its class:
 *
 *   - `live:` — the real repository violates the rule. This is the gate doing its
 *     job, and it is the only class that says anything about the workflow on disk.
 *   - `catch:` — a probe input was not handled as designed. This says something
 *     about the checker, not about the repository.
 *   - `precondition:` — the harness could not run its probe: the dope matched
 *     nothing, or matched more than one place, or produced YAML GitHub would
 *     reject. This says nothing about either.
 *
 * Removing the deployment's concurrency block from the real file once turned nine
 * of twelve assertions red and that was quoted as coverage. Re-run under the
 * taxonomy above, that same edit produces seven failing tests: six `live:` and one
 * `catch:`, with no preconditions. But three of those six are the *same* claim —
 * the deployment runs under no group that declines to cancel — restated as a
 * precondition inside three different tests. The independent count is four: the
 * cancellation claim, the block-count pin, the reserved-group pin and the value
 * pin. Four, not nine and not seven. The tally a suite prints is a count of test
 * functions, and a count of test functions is not a count of things noticed.
 *
 * The same harness records one more result worth stating rather than hiding:
 * rewriting the real `uses:` as `"uses":` produces a red suite with **no `live:`
 * and no `catch:` failure at all** — one precondition, because a dope's literal
 * target moved. That is the correct verdict. Quoting a key is a semantic no-op to
 * the parser, so there is nothing for the gate to report, and the red is the
 * harness saying its probe needs updating rather than the workflow being unsafe.
 * The bypass that form was part of is caught, but by the fixture above, on the
 * combination that actually changes meaning.
 */
test('every doped input is caught, and for the reason it was doped', () => {
  const real = realPagesWorkflow()

  // Negative control first: a detector that always fires proves as little as one
  // that never does.
  assert.deepEqual(cancellationRisks([real]), [], 'live: the real file must be clean before doping it')

  const DEPLOY_BLOCK = /^ *concurrency:\r?\n *group: pages-deploy\r?\n *cancel-in-progress: false$/m
  const variant = (label: string, find: string | RegExp, replacement: string): WorkflowFile => ({
    name: real.name,
    source: dope(real.source, find, replacement, label),
  })

  const doped: ReadonlyArray<readonly [string, WorkflowFile[], RegExp]> = [
    [
      'flag flipped back to true',
      [variant('flag flipped back to true', 'cancel-in-progress: false', 'cancel-in-progress: true')],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
    [
      'flag deleted entirely',
      [variant('flag deleted entirely', /^ *cancel-in-progress: false\r?\n/m, '')],
      /the group the deployment runs under does not set cancel-in-progress/,
    ],
    [
      'flag replaced by an expression, which can evaluate true',
      [
        variant(
          'flag replaced by an expression, which can evaluate true',
          'cancel-in-progress: false',
          "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
        ),
      ],
      /cancel-in-progress is `\$\{\{ github\.ref != 'refs\/heads\/main' \}\}`, not false, on a group the deployment runs under/,
    ],
    [
      'flag written as a quoted string, which the workflow schema does not accept',
      [
        variant(
          'flag written as a quoted string, which the workflow schema does not accept',
          'cancel-in-progress: false',
          "cancel-in-progress: 'false'",
        ),
      ],
      /cancel-in-progress is `false` as a string, which is neither a boolean nor an expression/,
    ],
    [
      "the deployment's block rewritten in the inline mapping form",
      [
        variant(
          "the deployment's block rewritten in the inline mapping form",
          DEPLOY_BLOCK,
          '    concurrency: { group: pages-deploy, cancel-in-progress: true }',
        ),
      ],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
    [
      'the deployment block reopened as a flow mapping spanning lines — now read, not merely reported',
      [
        variant(
          'the deployment block reopened as a flow mapping spanning lines — now read, not merely reported',
          DEPLOY_BLOCK,
          '    concurrency: {\n      group: pages-deploy,\n      cancel-in-progress: true }',
        ),
      ],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
    [
      'the deployment given a bare scalar group, so the flag falls back to a default',
      [
        variant(
          'the deployment given a bare scalar group, so the flag falls back to a default',
          DEPLOY_BLOCK,
          '    concurrency: pages-deploy',
        ),
      ],
      /the group the deployment runs under does not set cancel-in-progress/,
    ],
    [
      'a workflow-level group put back above both jobs, cancelling',
      [
        variant(
          'a workflow-level group put back above both jobs, cancelling',
          /^jobs:$/m,
          'concurrency:\n  group: pages\n  cancel-in-progress: true\n\njobs:',
        ),
      ],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
    [
      'a third job in the same file joining the deployment group and cancelling',
      [
        variant(
          'a third job in the same file joining the deployment group and cancelling',
          /^ {2}deploy:$/m,
          '  cleanup:\n    runs-on: ubuntu-latest\n    concurrency:\n      group: pages-deploy\n' +
            '      cancel-in-progress: true\n    steps:\n      - run: echo tidy\n\n  deploy:',
        ),
      ],
      /joins Pages group `pages-deploy` with cancel-in-progress `true`/,
    ],
    [
      'the build job moved onto the deployment group while it still cancels',
      [
        variant(
          'the build job moved onto the deployment group while it still cancels',
          'group: pages-build-${{ github.event_name }}-${{ github.ref }}',
          'group: pages-deploy',
        ),
      ],
      /joins Pages group `pages-deploy` with cancel-in-progress `true`/,
    ],
    [
      'a concurrency key the schema does not allow',
      [
        variant(
          'a concurrency key the schema does not allow',
          'group: pages-deploy',
          'group: pages-deploy\n      cancel-on-supersede: true',
        ),
      ],
      /concurrency sets `cancel-on-supersede`, which is not a key this check models/,
    ],
    [
      'a queue value the schema does not define',
      [
        variant('a queue value the schema does not define', 'group: pages-deploy', 'group: pages-deploy\n      queue: none'),
      ],
      /queue is `none`, which is neither `single` nor `max`/,
    ],
    [
      'the deployment step moved into a reusable workflow this check cannot read',
      [
        variant(
          'the deployment step moved into a reusable workflow this check cannot read',
          /^ {4}steps:\r?\n {6}- name: Deploy\r?\n {8}id: deployment\r?\n {8}uses: actions\/deploy-pages@v4$/m,
          '    uses: ./.github/workflows/deploy.yml',
        ),
      ],
      /job `deploy` calls the reusable workflow `\.\/\.github\/workflows\/deploy\.yml`, whose steps this check cannot read/,
    ],
    [
      'the deployment step replaced by a local composite action',
      [
        variant(
          'the deployment step replaced by a local composite action',
          'uses: actions/deploy-pages@v4',
          'uses: ./.github/actions/ship',
        ),
      ],
      /uses the local action `\.\/\.github\/actions\/ship`, whose own steps this check cannot read/,
    ],
    [
      'a second workflow added later that deploys Pages with the flag the other way',
      [
        real,
        {
          name: 'deploy-preview.yml',
          source: [
            'concurrency:',
            '  group: preview',
            '  cancel-in-progress: true',
            'jobs:',
            '  deploy:',
            '    steps:',
            '      - uses: actions/deploy-pages@v4',
            '',
          ].join('\n'),
        },
      ],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
    [
      'an unrelated workflow joins the Pages group and cancels — mentions Pages nowhere',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: [
            'name: Totally Unrelated Housekeeping',
            'concurrency:',
            '  group: pages-deploy',
            '  cancel-in-progress: true',
            'jobs:',
            '  tidy:',
            '    steps:',
            '      - run: echo nothing to do with Pages',
            '',
          ].join('\n'),
        },
      ],
      /joins Pages group `pages-deploy` with cancel-in-progress `true`/,
    ],
    [
      'an unrelated workflow joins the Pages group at job level and cancels',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: [
            'name: Housekeeping',
            'jobs:',
            '  tidy:',
            '    concurrency:',
            '      group: pages-deploy',
            '      cancel-in-progress: true',
            '    steps:',
            '      - run: echo tidy',
            '',
          ].join('\n'),
        },
      ],
      /joins Pages group `pages-deploy` with cancel-in-progress `true`/,
    ],
    [
      'an unrelated workflow joins the Pages group with an expression that can evaluate true',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: [
            'name: Housekeeping',
            'concurrency:',
            '  group: pages-deploy',
            "  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
            'jobs:',
            '  tidy:',
            '    steps:',
            '      - run: echo tidy',
            '',
          ].join('\n'),
        },
      ],
      /joins Pages group `pages-deploy` with cancel-in-progress/,
    ],
    [
      'an unrelated workflow joins the Pages group on one inline line — the form that was fail-open',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: [
            'name: Housekeeping',
            'concurrency: { group: pages-deploy, cancel-in-progress: true }',
            'jobs:',
            '  tidy:',
            '    steps:',
            '      - run: echo tidy',
            '',
          ].join('\n'),
        },
      ],
      /joins Pages group `pages-deploy` with cancel-in-progress `true`/,
    ],
    [
      'an unrelated workflow joins the build group by naming what its expression produces on main',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: [
            'name: Housekeeping',
            'concurrency:',
            '  group: pages-build-push-refs/heads/main',
            '  cancel-in-progress: true',
            'jobs:',
            '  tidy:',
            '    steps:',
            '      - run: echo tidy',
            '',
          ].join('\n'),
        },
      ],
      /declares `pages-build-push-refs\/heads\/main`, a group reserved to deploy-pages\.yml/,
    ],
    [
      'a workflow whose jobs cannot be told apart at all',
      [real, { name: 'flow.yml', source: 'name: Flow\njobs: [tidy]\n' }],
      /jobs: is not a mapping, so this check cannot segment it into jobs/,
    ],
    [
      'a concurrency block that declares no group, which no valid workflow does',
      [real, { name: 'housekeeping.yml', source: 'name: Housekeeping\nconcurrency:\n  cancel-in-progress: true\n' }],
      /concurrency block declares no group/,
    ],
    [
      'a concurrency block hidden behind an alias',
      [
        real,
        {
          name: 'housekeeping.yml',
          source: 'name: Housekeeping\nanchors:\n  base: &base\n    group: pages-deploy\nconcurrency: *base\n',
        },
      ],
      /concurrency is an alias, and this check will not follow one to another node/,
    ],
    [
      'a second job in the deploying file that also deploys, under no concurrency block at all',
      [
        variant(
          'a second job in the deploying file that also deploys, under no concurrency block at all',
          /^ {2}deploy:$/m,
          '  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/deploy-pages@v4\n\n  deploy:',
        ),
      ],
      /job `publish` deploys Pages under no concurrency block this check can read/,
    ],
    [
      'the deployment reached through a job-level reusable workflow, under a group that cancels',
      [real, REUSABLE_UNDER_CANCEL],
      /job `build` calls the reusable workflow `\.\/\.github\/workflows\/publish\.yml`, whose steps this check cannot read/,
    ],
    [
      'a deployment under a matrix, in a job whose group cancels',
      [real, MATRIX_DEPLOY],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
    [
      'a deployment behind an `if:`, in a job whose group cancels',
      [real, CONDITIONAL_DEPLOY],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
    [
      'a deploying job written entirely with quoted keys, cancelling',
      [real, QUOTED_JOB_KEYS],
      /cancel-in-progress is `true`, not false, on a group the deployment runs under/,
    ],
  ]

  for (const [label, files, reason] of doped) {
    for (const file of files) assertParses(file, label)

    assert.notDeepEqual(
      files.map((file) => `${file.name}\u0000${file.source}`),
      [`${real.name}\u0000${real.source}`],
      `precondition: ${label}: the doped set is the real set, so its result means nothing`,
    )

    const risks = allRisks(files)
    assert.ok(
      risks.some((risk) => reason.test(risk)),
      `catch: ${label}: fired for none of the expected reasons — got ${JSON.stringify(risks)}`,
    )
  }
})

/**
 * The one input that cannot be held to the table's invariant, and so is held apart
 * from it.
 *
 * Every doped case above must be valid YAML, because a bypass GitHub would reject
 * is not a bypass. This one is the opposite claim: a workflow that does not parse
 * must be *reported*, not silently read as a workflow with no jobs and no groups.
 * That is the fail-open shape every earlier round of this file had, arriving in the
 * one place a parser can still produce it.
 */
test('a workflow that does not parse is reported rather than read as empty', () => {
  const broken: WorkflowFile = { name: 'broken.yml', source: 'name: Broken\nconcurrency:\n  group: a\n group: b\n' }

  assert.ok(
    parseDocument(broken.source, { uniqueKeys: true, merge: false }).errors.length > 0,
    'precondition: the fixture parses cleanly, so it is not the input this test needs',
  )

  const model = readWorkflow(broken)
  assert.deepEqual(model.blocks, [], 'precondition: a document with errors should yield no blocks to reason about')

  const risks = cancellationRisks([broken])
  assert.ok(
    risks.some((risk) => /^broken\.yml: YAML does not parse:/.test(risk)),
    `catch: an unparseable workflow was not reported — got ${JSON.stringify(risks)}`,
  )
})

/**
 * The missing-block rule as a rule, not as a side effect of a pin.
 *
 * A reviewer of the previous round found a second literal deploying job with no
 * concurrency block on it, and observed that the only thing that went red was the
 * exact `deployJobs === ['deploy']` pin. A pin fails on any change to the file,
 * including harmless ones, so a maintainer clears it by updating the list — and
 * the ungoverned deployment goes with it.
 *
 * So the claim is tested where it lives, on a synthetic file with no pin anywhere
 * near it: one deploying job under a block, one under nothing, and the second must
 * be reported by name.
 */
test('a deploying job under no concurrency block is reported by the rule, not only by a pin', () => {
  const twoDeployers: WorkflowFile = {
    name: 'two-deployers.yml',
    source: [
      'name: Two deployers',
      'jobs:',
      '  governed:',
      '    runs-on: ubuntu-latest',
      '    concurrency:',
      '      group: pages-deploy',
      '      cancel-in-progress: false',
      '    steps:',
      '      - uses: actions/deploy-pages@v4',
      '  ungoverned:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/deploy-pages@v4',
      '',
    ].join('\n'),
  }

  assertParses(twoDeployers, 'two deploying jobs')

  const model = readWorkflow(twoDeployers)
  assert.deepEqual(model.deployJobs, ['governed', 'ungoverned'], 'precondition: both jobs must be read as deploying')

  const risks = cancellationRisks([twoDeployers])
  assert.deepEqual(
    risks,
    ['two-deployers.yml: job `ungoverned` deploys Pages under no concurrency block this check can read'],
    'catch: the ungoverned deployment was not reported, or was reported alongside something else',
  )
})

/**
 * Quoted keys, one level up from the step. `"jobs":` and `"build":` are the same
 * keys as the unquoted spellings, and a job written entirely that way is the same
 * job — which is what makes the earlier round's `"uses"` bypass a family rather
 * than a one-off.
 *
 * The second half is the harness's own postcondition, made explicit because it was
 * previously only implied: a doped edit whose literal target has moved must fail
 * loudly rather than silently produce the unmodified file. That is what quoting a
 * job key does to every edit below that names one.
 */
test('quoted keys are the same keys, and an edit whose target they move fails loudly', () => {
  assertParses(QUOTED_JOB_KEYS, 'quoted job keys')

  const model = readWorkflow(QUOTED_JOB_KEYS)
  assert.deepEqual(model.jobs, ['build'], 'catch: a quoted job key was not read as a job')
  assert.deepEqual(model.deployJobs, ['build'], 'catch: a quoted `"uses"` under a quoted job key was not read')
  assert.deepEqual(model.unreadable, [], 'catch: quoting keys made the workflow unreadable, which it is not')
  assert.equal(model.blocks[0]?.entries.get('group')?.text, 'pages-deploy')
  assert.deepEqual(model.blocks[0]?.entries.get('cancel-in-progress'), { text: 'true', kind: 'boolean' })

  // The postcondition. `dope` must throw rather than return the input unchanged,
  // and must throw rather than edit an ambiguous target.
  assert.throws(
    () => dope(QUOTED_JOB_KEYS.source, /^ {2}build:$/m, '  renamed:', 'target moved by quoting'),
    /the dope's target occurs 0 times/,
    'catch: an edit that matched nothing did not fail loudly',
  )
  assert.throws(
    () => dope('a: 1\nb: 1\n', ': 1', ': 2', 'ambiguous target'),
    /the dope's target occurs 2 times/,
    'catch: an edit with two candidate targets did not fail loudly',
  )

  // And the other two harness helpers, so that none of them can be the always-true
  // step in the chain.
  assert.throws(
    () => { assertParses({ name: 'bad.yml', source: 'a: 1\n b: 2\n' }, 'invalid') },
    /is not valid YAML/,
    'catch: assertParses accepted a document that does not parse',
  )
  assert.ok(
    contributed(realPagesWorkflow(), QUOTED_JOB_KEYS, cancellationRisks).length > 0,
    'catch: contributed() reported nothing for a file that plainly contributes a risk',
  )
})

/**
 * The other direction. A check that flags everything passes every doped case above
 * for the wrong reason and gets turned off the first time it blocks a legitimate
 * workflow, which is the failure mode that gets a gate deleted rather than fixed.
 *
 * Every control here is a workflow GitHub's schema would accept. The previous
 * round's control for "declines to cancel in quotes" was not: `'false'` is a
 * string where the schema wants a boolean or an expression, so it certified a file
 * that would never have run. It is now a doped case above instead of a benign one
 * here, which is the correct side of the line.
 */
test('the check stays quiet on workflows that cannot cancel a deployment', () => {
  const real = realPagesWorkflow()

  const benign: ReadonlyArray<readonly [string, WorkflowFile]> = [
    [
      'shares the Pages group but never sets the flag — the default is false, so it is safe',
      {
        name: 'housekeeping.yml',
        source: [
          'name: Housekeeping',
          'concurrency:',
          '  group: pages-deploy',
          'jobs:',
          '  tidy:',
          '    steps:',
          '      - run: echo tidy',
          '',
        ].join('\n'),
      },
    ],
    [
      'cancels aggressively but in a group of its own',
      {
        name: 'lint.yml',
        source: [
          'name: Lint',
          'concurrency:',
          '  group: lint-${{ github.ref }}',
          '  cancel-in-progress: true',
          'jobs:',
          '  lint:',
          '    steps:',
          '      - run: echo lint',
          '',
        ].join('\n'),
      },
    ],
    [
      'shares the Pages group and explicitly declines to cancel',
      {
        name: 'housekeeping.yml',
        source: [
          'name: Housekeeping',
          'concurrency:',
          '  group: pages-deploy',
          '  cancel-in-progress: false',
          'jobs:',
          '  tidy:',
          '    steps:',
          '      - run: echo tidy',
          '',
        ].join('\n'),
      },
    ],
    [
      'declines to cancel inline',
      {
        name: 'housekeeping.yml',
        source: [
          'name: Housekeeping',
          'concurrency: { group: pages-deploy, cancel-in-progress: false }',
          'jobs:',
          '  tidy:',
          '    steps:',
          '      - run: echo tidy',
          '',
        ].join('\n'),
      },
    ],
    [
      'queues behind the deployment instead of cancelling it, using a key the schema documents',
      {
        name: 'housekeeping.yml',
        source: [
          'name: Housekeeping',
          'concurrency:',
          '  group: pages-deploy',
          '  queue: max',
          'jobs:',
          '  tidy:',
          '    steps:',
          '      - run: echo tidy',
          '',
        ].join('\n'),
      },
    ],
    [
      'names a group of its own that merely starts the same way',
      {
        name: 'housekeeping.yml',
        source: [
          'name: Housekeeping',
          'concurrency:',
          '  group: pages-deployment-notes',
          '  cancel-in-progress: true',
          'jobs:',
          '  tidy:',
          '    steps:',
          '      - run: echo tidy',
          '',
        ].join('\n'),
      },
    ],
    [
      'mentions the deployment action only inside a shell script, which is a string',
      BLOCK_SCALAR_DECOY,
    ],
    [
      'deploys under a matrix but declines to cancel — the matrix is not what decides',
      {
        name: 'matrix-safe.yml',
        source: [
          'name: Matrix safe',
          'jobs:',
          '  ship:',
          '    runs-on: ubuntu-latest',
          '    strategy:',
          '      matrix:',
          '        target: [alpha, beta]',
          '    concurrency:',
          '      group: preview-${{ matrix.target }}',
          '      cancel-in-progress: false',
          '    steps:',
          '      - uses: actions/deploy-pages@v4',
          '',
        ].join('\n'),
      },
    ],
    [
      'deploys behind an `if:` but declines to cancel — the condition is not what decides either',
      {
        name: 'conditional-safe.yml',
        source: [
          'name: Conditional safe',
          'jobs:',
          '  ship:',
          '    runs-on: ubuntu-latest',
          '    concurrency:',
          '      group: preview-ship',
          '      cancel-in-progress: false',
          '    steps:',
          "      - if: ${{ github.ref == 'refs/heads/main' }}",
          '        uses: actions/deploy-pages@v4',
          '',
        ].join('\n'),
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
    assertParses(file, label)

    // Prove the pairing is the thing under test: only the risks the added file
    // contributes are counted, so a dirty base fails as `live:` above rather than
    // as a false alarm here.
    assert.deepEqual(cancellationRisks([real]), [], 'live: the real file must be clean before pairing anything with it')
    assert.deepEqual(
      contributed(real, file, cancellationRisks),
      [],
      `catch: ${label}: flagged a workflow that cannot cancel a deployment`,
    )
  }

  // And the ci.yml on disk is the live instance of the second case above: it
  // cancels superseded runs on purpose, which is correct and must stay unflagged.
  const files = readWorkflows()
  const ci = files.find((candidate) => candidate.name === 'ci.yml')
  assert.ok(ci, 'precondition: ci.yml should be present — if it is gone this assertion is measuring nothing')
  assert.ok(
    /cancel-in-progress:\s*\$\{\{/.test(ci.source),
    'precondition: ci.yml should still cancel via an expression — otherwise this case no longer exercises anything',
  )
  assert.deepEqual(cancellationRisks(files), [], 'live: the real workflow set is not clean')
})

/**
 * The group is what selects a workflow as dangerous, so the ways one group name can
 * be written are exactly as load-bearing as the ways the flag can be.
 *
 * `PAGES-DEPLOY` is the important one: "the concurrency group name is case
 * insensitive", so it is the deployment's own group spelled in a way an earlier
 * round compared as different.
 */
test('a group is the same group however GitHub would spell it', () => {
  const real = realPagesWorkflow()

  const cancelling = (group: string): WorkflowFile => ({
    name: 'probe.yml',
    source:
      'name: Probe\non:\n  push:\n    branches:\n      - main\nconcurrency:\n' +
      `  group: ${group}\n  cancel-in-progress: true\njobs:\n  noop:\n    runs-on: ubuntu-latest\n` +
      '    steps:\n      - run: echo hi\n',
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
    ['a literal block scalar, which keeps the newline the parser then trims', '|-\n    pages-deploy'],
    ['a double-quoted scalar with the action name escaped', '"pages-\\u0064eploy"'],
    ['an expression assembling the name it never spells', "${{ format('{0}{1}', 'pages-', 'deploy') }}"],
    ['the literal the build group produces on a main push', 'pages-build-push-refs/heads/main'],
  ]

  for (const [label, group] of spellings) {
    const probe = cancelling(group)
    assertParses(probe, label)

    assert.ok(
      contributed(real, probe, allRisks).length > 0,
      `catch: a workflow joining a Pages group written as ${label} was not reported`,
    )
  }

  // The other direction, and the reason the expression rule is a naming test
  // rather than a blanket "unreadable means dangerous": ci.yml cancels
  // deliberately under a group built from expressions and must not be dragged in.
  // The blanket rule was implemented and measured by two parties independently:
  // three tests red on the real file set. This control is what goes red.
  assert.deepEqual(
    contributed(real, cancelling('${{ github.workflow }}-${{ github.ref }}'), allRisks),
    [],
    'catch: an expression group that never names a protected group must stay quiet',
  )
})

/**
 * The `workflow_dispatch` hazard, which no cancellation check can see because the
 * thing it cancels is a build.
 *
 * The trigger set is pinned here rather than assumed, because the rule below is
 * conditional on it: a workflow that cannot be dispatched is not held to it, so a
 * silent removal of `workflow_dispatch` would turn the rule off rather than fail.
 * And a silent *addition* of it elsewhere turns the rule on, which is the point.
 */
test('a cancelling group in a dispatchable workflow varies by event and by ref', () => {
  const real = realPagesWorkflow()
  const model = readWorkflow(real)

  assert.deepEqual(
    model.triggers,
    ['push', 'workflow_dispatch'],
    'live: the triggers of the Pages workflow changed, and the ref rule below is conditional on them',
  )
  assert.deepEqual(
    (model.value?.on as { push?: { branches?: unknown } } | undefined)?.push?.branches,
    ['main'],
    'live: the push trigger no longer names exactly main, so "all push runs share one group" no longer holds',
  )

  assert.deepEqual(supersessionRisks([real]), [], 'live: the build group can be joined by a run of any ref')

  const constant = dope(
    real.source,
    'group: pages-build-${{ github.event_name }}-${{ github.ref }}',
    'group: pages-build',
    'build group made constant',
  )
  const risks = supersessionRisks([{ name: real.name, source: constant }])
  assert.ok(
    risks.some((risk) => /the cancelling group `pages-build` does not vary by github\.event_name and github\.ref/.test(risk)),
    `catch: a constant cancelling group in a dispatchable workflow was not reported — got ${JSON.stringify(risks)}`,
  )

  // Each half of the key on its own is still a hazard, and each is named.
  const refOnly = dope(
    real.source,
    'group: pages-build-${{ github.event_name }}-${{ github.ref }}',
    'group: pages-build-${{ github.ref }}',
    'build group keyed by ref only',
  )
  assert.ok(
    supersessionRisks([{ name: real.name, source: refOnly }]).some((risk) =>
      /does not vary by github\.event_name,/.test(risk),
    ),
    'catch: a group keyed by ref but not by event lets a manual run of main cancel a push build',
  )

  const eventOnly = dope(
    real.source,
    'group: pages-build-${{ github.event_name }}-${{ github.ref }}',
    'group: pages-build-${{ github.event_name }}',
    'build group keyed by event only',
  )
  assert.ok(
    supersessionRisks([{ name: real.name, source: eventOnly }]).some((risk) =>
      /does not vary by github\.ref or/.test(risk),
    ),
    'catch: a group keyed by event but not by ref lets a manual run of one ref cancel a manual run of another',
  )

  // The control for the condition: the same constant group in a workflow that
  // cannot be dispatched is not this defect, and must stay quiet.
  const notDispatchable: WorkflowFile = {
    name: 'push-only.yml',
    source: [
      'name: Push only',
      'on:',
      '  push:',
      '    branches:',
      '      - main',
      'jobs:',
      '  work:',
      '    runs-on: ubuntu-latest',
      '    concurrency:',
      '      group: work',
      '      cancel-in-progress: true',
      '    steps:',
      '      - run: echo work',
      '',
    ].join('\n'),
  }
  assertParses(notDispatchable, 'push-only control')
  assert.deepEqual(supersessionRisks([notDispatchable]), [], 'catch: a workflow with no dispatch trigger is not this defect')
})

/**
 * The effective concurrency of the workflow, pinned by value rather than by parse.
 *
 * The two jobs carry opposite policies, and that opposition *is* the change: one
 * group that both jobs shared could only hold one of them. So both halves are
 * pinned — a build group that quietly stopped cancelling would restore the defect
 * this workflow was edited to remove, and no cancellation check can see a
 * cancellation that fails to happen.
 */
test('the Pages workflow splits the two policies across its two jobs', () => {
  const model = readWorkflow(realPagesWorkflow())

  assert.deepEqual(model.unreadable, [], 'live: the Pages workflow contains a form this check cannot read')
  assert.equal(model.blocks.length, 2, `live: expected exactly two concurrency blocks, found ${String(model.blocks.length)}`)

  const owned = new Map(model.blocks.map((block) => [block.owner.kind === 'job' ? block.owner.job : '<workflow>', block]))
  assert.deepEqual([...owned.keys()].sort(), ['build', 'deploy'], 'live: the two concurrency blocks are not the two jobs')

  assert.equal(
    owned.get('build')?.entries.get('group')?.text,
    'pages-build-${{ github.event_name }}-${{ github.ref }}',
    'live: the build group changed',
  )
  assert.deepEqual(
    owned.get('build')?.entries.get('cancel-in-progress'),
    { text: 'true', kind: 'boolean' },
    'live: the build job stopped cancelling, which restores the defect this workflow was edited to remove',
  )
  assert.equal(owned.get('deploy')?.entries.get('group')?.text, 'pages-deploy', 'live: the deployment group changed')
  assert.deepEqual(
    owned.get('deploy')?.entries.get('cancel-in-progress'),
    { text: 'false', kind: 'boolean' },
    'live: the deployment stopped declining to cancel',
  )

  // And the job that deploys is read, not assumed: if the deployment step moves to
  // another job the pin above is pinning the wrong block.
  assert.deepEqual(model.deployJobs, ['deploy'], 'live: the deploying job is no longer `deploy`')
})

/**
 * Why there is no workflow-level block, as a test rather than a comment.
 *
 * A workflow-level group governs every job in the run, and GitHub documents that
 * "when a concurrent job or workflow is queued, if another job or workflow using
 * the same concurrency group in the repository is in progress, the queued job or
 * workflow will be `pending`". Under one shared group, run N+1 would therefore
 * wait for run N to finish *before its build job started*, so the build group
 * would never have an in-progress peer to cancel and the split would do nothing.
 *
 * That is the documented behaviour in the conditional, not something observed
 * here; nothing in this repository can watch GitHub's scheduler. What is ours to
 * hold is the configuration, so the configuration is what is pinned — including
 * against a reinstated workflow-level group that declines to cancel, which would
 * pass every cancellation check above while silently undoing the change.
 */
test('the Pages workflow declares no workflow-level group, which would freeze the split', () => {
  const real = realPagesWorkflow()
  const model = readWorkflow(real)

  assert.deepEqual(
    model.blocks.filter((block) => block.owner.kind === 'workflow').map((block) => `${real.name}:${String(block.line)}`),
    [],
    'live: a workflow-level concurrency group governs every job in the run, so a queued run would wait pending before ' +
      'its build job started and the build group could never supersede anything. The split only works while the run ' +
      'itself is ungrouped.',
  )

  // Both directions of the reinstatement are doped, because only one of them is
  // caught by anything else. `cancel-in-progress: true` is a cancellation risk;
  // `false` is not, and would restore the original defect in silence.
  for (const [label, flag] of [
    ['cancelling', 'true'],
    ['declining to cancel, which no cancellation check can see', 'false'],
  ] as ReadonlyArray<readonly [string, string]>) {
    const source = dope(real.source, /^jobs:$/m, `concurrency:\n  group: pages\n  cancel-in-progress: ${flag}\n\njobs:`, label)
    assertParses({ name: real.name, source }, label)

    assert.ok(
      readWorkflow({ name: real.name, source }).blocks.some((block) => block.owner.kind === 'workflow'),
      `catch: a workflow-level group ${label} was not attributed to the run`,
    )
  }

  // The negative control for the filter: it reports workflow-level blocks when
  // there are any, and ci.yml has one. Without this the assertion above passes if
  // `owner` is ever computed as `job` unconditionally.
  const ci = readWorkflows().find((file) => file.name === 'ci.yml')
  assert.ok(ci, 'precondition: ci.yml should be present — otherwise the control below measures nothing')
  assert.equal(readWorkflow(ci).blocks.filter((block) => block.owner.kind === 'workflow').length, 1)
})

/**
 * The parts of the deploy job that are not concurrency and are just as load-bearing.
 *
 * `deploy` publishes what `build` uploaded, so without `needs:` the two jobs run at
 * once and `actions/deploy-pages` publishes whatever artifact happens to exist —
 * a live possibility now that two runs can be in flight together. The environment,
 * the token permissions and the actions themselves are pinned in the same test,
 * because this round edited the file and "nothing else moved" is a claim.
 */
test('the deployment keeps the dependency, environment, permissions and actions it needs', () => {
  const model = readWorkflow(realPagesWorkflow())
  const value = model.value
  assert.ok(value, 'precondition: the Pages workflow did not parse into a value')

  const jobs = value.jobs as Record<string, Record<string, unknown>>
  assert.equal(jobs.deploy?.needs, 'build', 'live: the deployment no longer waits for the build whose artifact it publishes')
  assert.deepEqual(
    jobs.deploy?.environment,
    { name: 'github-pages', url: '${{ steps.deployment.outputs.page_url }}' },
    'live: the deployment environment changed',
  )
  assert.equal(jobs.build?.['runs-on'], 'ubuntu-latest', 'live: the build runner changed')
  assert.equal(jobs.deploy?.['runs-on'], 'ubuntu-latest', 'live: the deploy runner changed')

  assert.deepEqual(
    value.permissions,
    { contents: 'read', pages: 'write', 'id-token': 'write' },
    'live: the token permissions changed',
  )

  assert.deepEqual(
    model.uses,
    [
      'actions/checkout@v4',
      'actions/setup-node@v4',
      'actions/configure-pages@v5',
      'actions/upload-pages-artifact@v3',
      'actions/deploy-pages@v4',
    ],
    'live: the actions the workflow calls, or their order, changed',
  )
})

/**
 * The membership claim, doped like the rest. The build group is new, and a foreign
 * member of it does a harm the cancellation check is not built to see, so the check
 * that covers it must be shown firing rather than assumed to.
 */
test('the groups the Pages workflow declares are reserved to it', () => {
  const files = readWorkflows()
  const real = realPagesWorkflow()

  assert.deepEqual(
    [...declaredGroups(readWorkflow(real))].sort(),
    ['pages-build-${{ github.event_name }}-${{ github.ref }}', 'pages-deploy'],
    'live: the set of groups the Pages workflow declares changed, so the reservation below covers different names',
  )
  assert.deepEqual(groupIntruders(files), [], 'live: a workflow on disk declares a reserved group')

  const joining = (group: string): WorkflowFile => ({
    name: 'housekeeping.yml',
    source:
      `name: Housekeeping\nconcurrency:\n  group: ${group}\njobs:\n  tidy:\n    runs-on: ubuntu-latest\n` +
      '    steps:\n      - run: echo tidy\n',
  })

  const intruding: ReadonlyArray<readonly [string, string]> = [
    ['the deployment group', 'pages-deploy'],
    ['the deployment group in another case, which GitHub folds to the same group', 'PAGES-DEPLOY'],
    ['a literal the build group produces on a main push', 'pages-build-push-refs/heads/main'],
    ['a literal the build group produces on a manual run', 'pages-build-workflow_dispatch-refs/heads/topic'],
    ['the same literal in another case', 'PAGES-BUILD-PUSH-REFS/HEADS/MAIN'],
  ]

  for (const [label, group] of intruding) {
    const probe = joining(group)
    assertParses(probe, label)

    assert.ok(groupIntruders([real, probe]).length > 0, `catch: ${label}: was not reported`)

    // Not cancelling, so the check named for cancellation must stay quiet. The two
    // claims are separate on purpose and this is what keeps them separate.
    assert.deepEqual(
      contributed(real, probe, cancellationRisks),
      [],
      `catch: ${label}: reported as a cancellation risk, which it is not`,
    )
  }

  // Declared under a job rather than the run: the same membership, one level down.
  const jobLevel: WorkflowFile = {
    name: 'housekeeping.yml',
    source:
      'name: Housekeeping\njobs:\n  tidy:\n    concurrency:\n      group: pages-build-push-refs/heads/main\n' +
      '    steps:\n      - run: echo tidy\n',
  }
  assertParses(jobLevel, 'job-level reserved group')
  assert.ok(groupIntruders([real, jobLevel]).length > 0, 'catch: a job-level declaration of a reserved group was not reported')

  // The control: a group that is nobody else's business stays unreported, so the
  // reservation is about these names rather than about having a group at all.
  assert.deepEqual(groupIntruders([real, joining('lint-${{ github.ref }}')]), [])
  assert.deepEqual(groupIntruders([real, joining('pages-buildings')]), [])
})

/**
 * The set of workflows, pinned.
 *
 * The parser removes the encoding blind spots but not the indirection ones, and a
 * new workflow is a new set of groups nobody has reasoned about. Any workflow
 * added, removed or renamed fails here and a person has to look.
 */
test('the set of workflows is pinned, because a new one is a set of groups nobody has read', () => {
  const names = readWorkflows()
    .map((file) => file.name)
    .sort()

  assert.deepEqual(
    names,
    ['ci.yml', 'deploy-pages.yml'],
    'live: the set of workflow files changed. This test has no opinion about whether that is correct — it exists ' +
      'because a new workflow may join a concurrency group nobody has reasoned about, and because a step may ' +
      'call a remote action whose own steps are unreadable from here. Open the new or changed workflow, check ' +
      'whether any concurrency group it declares collides with either of the Pages groups, and update this list.',
  )
})

/**
 * The concurrency of every workflow, pinned as the parser resolves it.
 *
 * This is the pin that used to be a list of source lines, and it is stronger in
 * exactly the way that mattered: a reviewer once changed only `ci.yml`'s `group:`
 * to `"group":` — valid YAML, the identical property — and hid its group from a
 * scanner while its cancelling expression stayed live. Another hid a whole block
 * behind `"\u0063oncurrency"`. Neither survives here, because the parser decodes
 * the key before this ever sees it, so a new spelling of an old value is not a new
 * value and does not need a new round.
 *
 * The values are compared, so a *value* change still fails. That is the thing worth
 * failing on.
 */
test('the concurrency of every workflow is pinned as the parser resolves it', () => {
  const pinned = readWorkflows()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((file) => {
      const model = readWorkflow(file)
      assert.deepEqual(model.unreadable, [], `live: ${file.name} did not parse cleanly`)

      return model.blocks.map((block) => {
        const owner = block.owner.kind === 'workflow' ? '<workflow>' : block.owner.job
        const entries = [...block.entries]
          .map(([key, entry]) => `${key}=${entry.text} (${entry.kind})`)
          .join(', ')
        return `${model.name} :: ${owner} :: ${entries}`
      })
    })

  assert.deepEqual(
    pinned,
    [
      "ci.yml :: <workflow> :: group=${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }} (string), " +
        "cancel-in-progress=${{ github.event_name == 'pull_request' }} (string)",
      'deploy-pages.yml :: build :: group=pages-build-${{ github.event_name }}-${{ github.ref }} (string), cancel-in-progress=true (boolean)',
      'deploy-pages.yml :: deploy :: group=pages-deploy (string), cancel-in-progress=false (boolean)',
    ],
    'live: the concurrency of a workflow changed in value, not merely in spelling',
  )
})

/**
 * A hygiene rule, and the reason it is now only that.
 *
 * A previous round pinned concurrency as *source lines*, and a reviewer hid a
 * cancelling block from that pin with `"\u0063oncurrency"` — valid YAML, decoding
 * to `concurrency`, containing none of the words the filter looked for. The pin
 * above no longer works that way, so this no longer protects it. What it protects
 * is the reader: a workflow key spelled with character escapes decodes to
 * something a person reviewing the diff does not see, and this repository does not
 * want one. The claim is small and is stated at its real size.
 *
 * The scan is positional, and the positions are enumerated rather than sampled.
 * YAML admits a double-quoted mapping key in exactly three places: as the first
 * token of a block-mapping entry, after an explicit `?`, and inside a flow
 * collection. Everything else on a line belongs to a value, and a value is text
 * unless it opens `{` or `[`. Block-scalar content is skipped by indentation, flow
 * collections are tracked across lines by depth, and tags and anchors are stripped
 * because they precede a node without being one.
 *
 * That positional rule is the answer to two earlier misses, both recorded because
 * both were controls aimed one field away from the rule they were certifying:
 * `run: printf '\x1b[32m…'` is ordinary shell that YAML never decodes, and
 * `run: printf '%s\n' '{"caf\u00e9":true}'` is a plain scalar carrying JSON in
 * which a quoted token followed by a colon is a character sequence, not a key.
 *
 * One form is examined and deliberately not closed: a double-quoted scalar may
 * carry a line continuation, so `"conc\` + newline + `urrency"` splits a keyword
 * across lines where no per-line scan can see it. As an implicit mapping key that
 * is not valid YAML, and a rule against trailing backslashes would fire on every
 * multi-line `run:` in the repository.
 */
function quotedEnd(text: string, from: number): number {
  let i = from + 1
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
  return i < text.length ? i : -1
}

/**
 * The closing quote of the single-quoted scalar starting at `from`. YAML writes a
 * literal quote as `''`, which continues the scalar rather than ending it.
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
 * whitespace or end of line that is not inside a scalar or a comment.
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
 * are structure. A `{` inside a quoted scalar is a character in a string.
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

const HEX_ESCAPE = /\\(?:x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/

function encodedKeys(file: WorkflowFile): string[] {
  return doubleQuotedKeys(file.source)
    .filter((entry) => HEX_ESCAPE.test(entry.key))
    .map((entry) => `${file.name}:${String(entry.number)}: ${entry.line}`)
}

test('no workflow spells a mapping key with character escapes', () => {
  // The positive control, first and deliberately. The assertion below is an
  // emptiness assertion, and an emptiness assertion is passed by a function that
  // returns nothing at all — which is what the previous round of this test
  // actually certified. These fixtures fail an always-empty `doubleQuotedKeys`.
  const planted: ReadonlyArray<readonly [string, WorkflowFile, number]> = [
    [
      'an escaped key in a block mapping',
      { name: 'planted.yml', source: 'name: Planted\n"\\u0063oncurrency":\n  group: pages-deploy\n' },
      2,
    ],
    [
      'an escaped key inside a flow mapping',
      { name: 'planted.yml', source: 'name: Planted\nconcurrency: { "\\u0067roup": pages-deploy }\n' },
      2,
    ],
    [
      'an escaped key after an explicit question mark',
      { name: 'planted.yml', source: 'name: Planted\n? "\\u0063oncurrency"\n: pages-deploy\n' },
      2,
    ],
    [
      'an escaped key on a compact sequence entry',
      { name: 'planted.yml', source: 'steps:\n  - "\\u0075ses": actions/deploy-pages@v4\n' },
      2,
    ],
  ]

  for (const [label, file, line] of planted) {
    assertParses(file, label)
    assert.deepEqual(encodedKeys(file), [`planted.yml:${String(line)}: ${file.source.split('\n')[line - 1]?.trim() ?? ''}`],
      `catch: ${label}: the scan did not find a key it was shown`)
  }

  // And the false-positive controls, drawn from ordinary workflow content that
  // contains backslashes rather than from the two forms whoever wrote the rule
  // happened to imagine.
  const innocent: ReadonlyArray<readonly [string, WorkflowFile]> = [
    [
      'an escape inside a shell script, which YAML never decodes',
      { name: 'innocent.yml', source: 'jobs:\n  x:\n    steps:\n      - run: printf \'\\x1b[32mok\\n\'\n' },
    ],
    [
      'an escape inside JSON inside a plain scalar, where a quoted token before a colon is not a key',
      { name: 'innocent.yml', source: 'jobs:\n  x:\n    steps:\n      - run: printf \'%s\' \'{"caf\\u00e9":true}\'\n' },
    ],
    [
      'an escape in a value rather than a key',
      { name: 'innocent.yml', source: 'jobs:\n  x:\n    steps:\n      - run: "echo \\u0063oncurrency"\n' },
    ],
    [
      'a multi-line block scalar full of backslashes',
      { name: 'innocent.yml', source: 'jobs:\n  x:\n    steps:\n      - run: |\n          echo "a\\u0063b"\n          "d\\u0065f": g\n' },
    ],
  ]

  for (const [label, file] of innocent) {
    assertParses(file, label)
    assert.deepEqual(encodedKeys(file), [], `catch: ${label}: reported a key that is not one`)
  }

  assert.deepEqual(
    readWorkflows().flatMap(encodedKeys),
    [],
    'live: a workflow spells a mapping key with character escapes, which decodes to something a reviewer reading the diff does not see',
  )
})
