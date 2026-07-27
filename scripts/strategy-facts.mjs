#!/usr/bin/env node
/**
 * strategy-facts — audits `docs/STRATEGY.md` against the fifteen design
 * specifications it replaced.
 *
 * Those specs were folded into the document and deleted in commit `bec0ced`.
 * This checker exists so that claim is verifiable by anyone, not just by
 * whoever wrote the document.
 *
 * Two properties make it a check rather than a metric:
 *
 *   1. **Section-scoped.** A fact counts as preserved only if it appears in the
 *      consolidated section that OWNS it. A number occurring somewhere else in
 *      a 3,000-line file proves nothing.
 *   2. **Per-class recall controls.** Before reporting, every fact class is
 *      exercised: a known fact of that class is removed from its section and
 *      the run aborts unless the checker notices. A control that only samples
 *      facts the extractor already found tests precision, not recall — so the
 *      storage-key class is additionally populated from `src/`, independently
 *      of what the specs happened to say.
 *
 * Usage:
 *   node scripts/strategy-facts.mjs              # audit; exits 1 on ANY missing fact
 *   node scripts/strategy-facts.mjs --generate   # rebuild fixtures from git
 *   node scripts/strategy-facts.mjs --verbose    # list every miss
 *   node scripts/strategy-facts.mjs --break=word # delete a word from the document
 *                                                # in memory and re-audit, to check
 *                                                # that the gate actually gates
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOC = join(ROOT, 'docs', 'STRATEGY.md')
const FIXTURES = join(ROOT, 'scripts', 'strategy-facts.fixtures.json')
const SPEC_COMMIT = 'd854a75'

/**
 * Storage keys are a closed, finite set. They are enumerated from `src/` rather
 * than from the specs — so this class's control cannot be satisfied by sampling
 * the extractor's own output. Each key names the consolidated section that owns
 * it; `null` means no folded spec owns it and it need only appear somewhere.
 */
export const KEY_OWNER = {
  'korovany-ink-outlines': '### 8. Toon shading and selective outlines',
  'korovany-bloom': '### 10. Bloom post-processing',
  'korovany-foliage': '### 11. Ground foliage and wind',
  'korovany-dynamic-day-night': '### 12. Day/night cycle',
  'korovany-weather': '### 13. Weather',
  'korovany-sfx-volume': '### 15. Layered procedural audio',
  'korovany-music-muted': '### 15. Layered procedural audio',
  // owned by no folded spec — listed in the storage-key inventory instead
  'korovany-theme': null,
  'korovany-screen-shake': null,
  'korovany-achievements-v1': null,
  'korovany-generated-run-v2': null,
  'korovany-profile-v1': null,
}

/** spec basename -> heading of the consolidated section that replaces it */
export const SECTION_MAP = {
  'living-world': '### 1. Living world',
  'combat-depth': '### 2. Combat depth',
  '04-enemy-reactions': '### 3. Enemy reactions',
  '02-comic-hit-language': '### 4. Comic hit language',
  'combat-juice': '### 5. Combat juice',
  '07-camera-accents': '### 6. Camera accents',
  '03-loot-spectacle': '### 7. Loot spectacle',
  '01-toon-shading-and-outlines': '### 8. Toon shading and selective outlines',
  '05-zone-art-direction': '### 9. Zone art direction',
  'bloom-post-processing': '### 10. Bloom post-processing',
  'ground-foliage-wind': '### 11. Ground foliage and wind',
  'day-night-cycle': '### 12. Day/night cycle',
  'weather-system': '### 13. Weather',
  'dynamic-world-events': '### 14. Dynamic world events',
  '06-layered-audio': '### 15. Layered procedural audio',
}

/**
 * Classes the document's preamble promises to preserve. Every one gets its own
 * extractor and its own recall control.
 */
export const CLASSES = [
  'constant',
  'storageKey',
  'numericValue',
  'formula',
  'designRule',
  'lifecycleRule',
  'budgetRule',
  'accessibilityRule',
  'edgeCaseRule',
]

/** Deliberate exclusions, declared in the document's preamble. */
const EXCLUDED_NUMBERS = new Set(['0', '1', '2', '3', '4', '5', '2025', '2026'])
/** Zero-padded two-digit tokens only ever come from spec filenames (`04-enemy-reactions`). */
const SPEC_NUMBER = /^0\d$/
const STOP_WORDS = new Set([
  'the', 'and', 'not', 'for', 'that', 'this', 'with', 'from', 'its', 'are',
  'was', 'were', 'has', 'have', 'been', 'but', 'can', 'may', 'must', 'should',
  'will', 'would', 'when', 'then', 'than', 'into', 'over', 'each', 'also',
  'only', 'does', 'their', 'they', 'them', 'there', 'which', 'while', 'more',
  'less', 'same', 'both', 'because', 'rather', 'every', 'never', 'always',
  'without', 'through', 'after', 'before', 'still', 'even', 'once', 'one',
  'two', 'three', 'four', 'five', 'per', 'via', 'use', 'used', 'uses', 'new',
  'now', 'all', 'any', 'own', 'out', 'off', 'how', 'why', 'who', 'you', 'your',
  'spec', 'specs', 'section', 'current', 'existing', 'change', 'changes',
])

/**
 * Both sides are normalised for the Unicode minus and for British/American
 * spelling. The document is written in British English and the specs are mixed;
 * "behaviour" and "behavior" are the same fact, and a checker that says
 * otherwise is measuring orthography.
 */
const SPELLING = [
  [/behaviour/g, 'behavior'], [/colour/g, 'color'], [/normalis/g, 'normaliz'],
  [/materialis/g, 'materializ'], [/optimis/g, 'optimiz'], [/prioritis/g, 'prioritiz'],
  [/recognis/g, 'recogniz'], [/initialis/g, 'initializ'], [/visualis/g, 'visualiz'],
  [/analys/g, 'analyz'], [/centre/g, 'center'], [/defence/g, 'defense'],
  [/grey/g, 'gray'], [/catalogue/g, 'catalog'], [/summaris/g, 'summariz'],
]
const normalise = (s) => {
  let out = s.replace(/\u2212/g, '-')
  for (const [re, to] of SPELLING) out = out.replace(re, to)
  return out
}

/** Strip headings and declared exclusions so section numbers are not facts. */
function factLines(spec) {
  return normalise(spec)
    .split('\n')
    .filter((l) => !/^#{1,6}\s/.test(l))
    // declared exclusions, per the document's preamble
    .filter((l) => !/^\s*\|?\s*\**Effort\**/i.test(l))
    .filter((l) => !/^\s*\|\s*`?src\//.test(l))
    .filter((l) => !/^\s*\|\s*`[^`]*\.(ts|tsx|css|md)`/.test(l))
    // effort estimates: "~1.5-2 days", "half a day", "up to 2 days"
    .filter((l) => !/(~?\d+([.,]\d+)?\s*(?:[-\u2013]\s*\d+([.,]\d+)?\s*)?(days?|weeks?)\b|\bhalf a day\b)/i.test(l))
    // cross-references to sibling specs by number or filename
    .filter((l) => !/\bspecs?\s+\d{2}\b/i.test(l))
    .filter((l) => !/\d{2}-[a-z-]+-spec(\.md)?/i.test(l))
    .map((l) => l.replace(/§\s?\d+[A-Z]?(\.\d+)*/g, ' '))
    // line-number citations into files that no longer exist
    .map((l) => l.replace(/[\w./-]+\.(ts|tsx|css|md):\d+(\s*[-\u2013,]\s*\d+)*/g, ' '))
}

/** Distinctive content words, used as the signature of a prose rule. */
function signature(sentence, count = 4) {
  const words = sentence
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  const seen = []
  for (const w of words) if (!seen.includes(w)) seen.push(w)
  // rarest-looking first: longer words are more distinctive in this corpus
  return seen.sort((a, b) => b.length - a.length).slice(0, count)
}

const RULE_PATTERNS = {
  designRule: /\b(do not|never|must not|deliberately|is load-bearing|by construction)\b/i,
  lifecycleRule: /\b(dispose|disposal|teardown|destroy\(\)|cleanup|lifecycle|pause|paused|unmount|leak|ownership|owns|owned|borrowed)\b/i,
  budgetRule: /\b(budget|cap\b|capped|pool|pooled|at most|no more than|maximum of|reserve|slots?)\b/i,
  accessibilityRule: /\b(reduced motion|prefers-reduced-motion|accessib|colour alone|color alone|contrast|aria|readable|legib)\b/i,
  edgeCaseRule: /\b(edge case|if the|when the|cannot|corner case|race|simultaneous|out of range|invalid)\b/i,
}

export function extractFacts(spec) {
  const lines = factLines(spec)
  const text = lines.join('\n')
  const facts = []
  const push = (cls, id, probe) => {
    if (!facts.some((f) => f.cls === cls && f.id === id)) facts.push({ cls, id, probe })
  }

  for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{4,})\b/g)) {
    if (m[1] === 'THREE') continue
    push('constant', m[1], m[1])
  }
  for (const m of text.matchAll(/'(korovany-[a-z-]+)'/g)) push('storageKey', m[1], m[1])
  for (const m of text.matchAll(/-?\d+\.\d+|\b\d{2,}\b/g)) {
    if (EXCLUDED_NUMBERS.has(m[0]) || SPEC_NUMBER.test(m[0])) continue
    push('numericValue', m[0], m[0])
  }
  for (const m of text.matchAll(/^[^\n]*=[^\n=]*[+\-*/()][^\n]*$/gm)) {
    const line = m[0].trim()
    // TypeScript member declarations are code shape, not formulas; the values
    // they carry are already covered by the constant and numericValue classes.
    if (/^(private|public|protected|static|readonly)\b/.test(line)) continue
    if (line.length > 12 && line.length < 160) push('formula', line.slice(0, 60), signature(line, 3))
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length < 40 || trimmed.length > 400) continue
    for (const [cls, re] of Object.entries(RULE_PATTERNS)) {
      if (!re.test(trimmed)) continue
      const sig = signature(trimmed)
      if (sig.length < 3) continue
      push(cls, trimmed.slice(0, 70), sig)
    }
  }
  return facts
}

/**
 * Light suffix stripping so `reserve` and `reserved`, `flash` and `flashes` are
 * the same fact. This is the same justification as the spelling normalisation:
 * an inflection is not a different fact, and a checker that says otherwise is
 * measuring morphology. It is deliberately conservative — it does not conflate
 * distinct roots.
 */
const stem = (w) => w
  .replace(/(ies)$/, 'y')
  .replace(/(ations|ation)$/, 'at')
  .replace(/(ings|ing)$/, '')
  .replace(/(eds|ed)$/, '')
  .replace(/(es|s)$/, '')
  .replace(/(ly)$/, '')
  .replace(/(.)\1$/, '$1')

/**
 * Is this fact present in the section that owns it?
 *
 * Prose rules are matched as a bag of distinctive words, and **every** word must
 * be present. An earlier revision accepted three of four, which meant deleting a
 * rule's single most discriminating token still scored it preserved — a lenient
 * matcher on exactly the classes where every real loss was found. "Preserved"
 * here means: every probe word, or its stem, appears in the owning section.
 */
export function present(fact, section, stems) {
  if (Array.isArray(fact.probe)) {
    const hay = section.toLowerCase()
    const known = stems ?? sectionStems(section)
    return fact.probe.every((w) => hay.includes(w) || known.has(stem(w)))
  }
  if (fact.cls === 'numericValue') {
    const escaped = fact.probe.replace('.', '\\.')
    // `(?<!\w)` rather than `(?<![\w.])`: the specs write ranges as `0.12..0.35`,
    // so a preceding dot is part of the notation, not a longer number.
    return new RegExp(`(?<!\\w)${escaped}(?![\\d])`).test(section)
  }
  return section.includes(fact.probe)
}

export function sectionStems(section) {
  return new Set(
    section.toLowerCase().split(/[^a-z-]+/).filter(Boolean).map(stem),
  )
}

function sectionText(docLines, heading) {  const start = docLines.findIndex((l) => l.startsWith(heading))
  if (start === -1) throw new Error(`section not found: ${heading}`)
  let end = docLines.length
  for (let i = start + 1; i < docLines.length; i += 1) {
    if (/^###? /.test(docLines[i])) {
      end = i
      break
    }
  }
  return docLines.slice(start, end).join('\n')
}

function readSpec(name) {
  return execFileSync('git', ['show', `${SPEC_COMMIT}:docs/${name}-spec.md`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}

/** The storage-key class is populated from src/, not from the specs. */
function storageKeysFromSource() {
  const out = execFileSync(
    'git',
    ['grep', '-hoE', "'korovany-[a-z0-9-]+'", '--', 'src'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return [...new Set(out.split('\n').map((l) => l.trim().replace(/'/g, '')).filter(Boolean))].sort()
}

function generate() {
  const fixtures = { specCommit: SPEC_COMMIT, generatedFrom: 'docs/*-spec.md', specs: {} }
  for (const name of Object.keys(SECTION_MAP)) {
    fixtures.specs[name] = extractFacts(readSpec(name))
  }
  fixtures.storageKeysInSource = storageKeysFromSource()
  writeFileSync(FIXTURES, `${JSON.stringify(fixtures, null, 2)}\n`)
  const n = Object.values(fixtures.specs).reduce((a, f) => a + f.length, 0)
  console.log(`wrote ${FIXTURES} — ${n} facts across ${Object.keys(fixtures.specs).length} specs`)
}

/**
 * Recall control. For each class, take a fact of that class that the document
 * currently satisfies, delete its evidence from the section, and require the
 * checker to notice. A class whose control cannot fire is reported as blind and
 * fails the run.
 */
function runControls(fixtures, docLines) {
  const failures = []
  for (const cls of CLASSES) {
    let fired = false
    let sampled = false
    // The storage-key control draws from the src-derived closed set rather than
    // from the extractor's own output, so it tests recall and not precision.
    if (cls === 'storageKey') {
      for (const k of fixtures.storageKeysInSource) {
        const owner = KEY_OWNER[k]
        const scope = owner ? sectionText(docLines, owner) : docLines.join('\n')
        if (!scope.includes(k)) continue
        sampled = true
        if (!scope.split(k).join('\u0000').includes(k)) fired = true
        if (fired) break
      }
      if (!sampled) failures.push('storageKey: BLIND — no key from src is present in its owning section')
      else if (!fired) failures.push('storageKey: CONTROL DID NOT FIRE — removing a key was not detected')
      continue
    }
    for (const [name, heading] of Object.entries(SECTION_MAP)) {
      const section = sectionText(docLines, heading)
      const candidates = (fixtures.specs[name] ?? []).filter(
        (f) => f.cls === cls && present(f, section),
      )
      if (candidates.length === 0) continue
      sampled = true
      const victim = candidates[0]
      const probes = Array.isArray(victim.probe) ? victim.probe : [victim.probe]
      let mutated = section
      for (const p of probes) {
        mutated = mutated.replace(
          new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          '\u0000',
        )
      }
      if (!present(victim, mutated)) fired = true
      if (fired) break
    }
    if (!sampled) failures.push(`${cls}: BLIND — no fact of this class is currently satisfied, so recall is untested`)
    else if (!fired) failures.push(`${cls}: CONTROL DID NOT FIRE — removing a known fact was not detected`)
  }
  return failures
}

function audit() {
  const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'))
  let raw = readFileSync(DOC, 'utf8')
  // `--break=word` removes a word from the document in memory before auditing.
  // It is how you check that a green run means something: if deleting a
  // load-bearing term does not turn the run red, the gate does not gate.
  const brk = process.argv.find((a) => a.startsWith('--break='))
  if (brk) {
    const word = brk.slice('--break='.length)
    const before = (raw.match(new RegExp(word, 'gi')) ?? []).length
    raw = raw.replace(new RegExp(word, 'gi'), '')
    console.log(`--break=${word}: removed ${before} occurrences before auditing\n`)
  }
  const docLines = normalise(raw).split('\n')

  const controlFailures = runControls(fixtures, docLines)
  if (controlFailures.length > 0) {
    console.error('RECALL CONTROLS FAILED — the checker cannot see these classes:')
    for (const f of controlFailures) console.error(`  ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`recall controls: all ${CLASSES.length} classes detected a removed fact\n`)

  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { total: 0, missing: 0 }]))
  const rows = []
  let missingDetail = []

  for (const [name, heading] of Object.entries(SECTION_MAP)) {
    const section = sectionText(docLines, heading)
    const facts = fixtures.specs[name] ?? []
    let missing = 0
    for (const fact of facts) {
      byClass[fact.cls].total += 1
      if (!present(fact, section)) {
        missing += 1
        byClass[fact.cls].missing += 1
        missingDetail.push({ name, cls: fact.cls, id: fact.id })
      }
    }
    rows.push({ name, total: facts.length, missing })
  }

  // storage keys are a closed set enumerated from src/, checked in the section
  // that owns them — not merely somewhere in a 3,000-line file.
  const whole = docLines.join('\n')
  const keyMisses = []
  for (const k of fixtures.storageKeysInSource) {
    const owner = Object.prototype.hasOwnProperty.call(KEY_OWNER, k) ? KEY_OWNER[k] : undefined
    if (owner === undefined) {
      keyMisses.push(`${k} (UNCLASSIFIED — add it to KEY_OWNER)`)
      continue
    }
    const scope = owner === null ? whole : sectionText(docLines, owner)
    if (!scope.includes(k)) keyMisses.push(owner === null ? k : `${k} (not in ${owner})`)
  }

  console.log('per spec:')
  for (const r of rows.sort((a, b) => a.total - b.total ? (b.missing / b.total) - (a.missing / a.total) : 0)) {
    const pct = r.total === 0 ? 100 : 100 * (1 - r.missing / r.total)
    console.log(`  ${r.name.padEnd(30)} ${String(r.total).padStart(4)} facts  ${String(r.missing).padStart(3)} missing  ${pct.toFixed(1)}%`)
  }

  console.log('\nper class:')
  for (const cls of CLASSES) {
    const { total, missing } = byClass[cls]
    const pct = total === 0 ? 100 : 100 * (1 - missing / total)
    console.log(`  ${cls.padEnd(20)} ${String(total).padStart(4)} facts  ${String(missing).padStart(3)} missing  ${pct.toFixed(1)}%`)
  }

  console.log(`\nstorage keys in src: ${fixtures.storageKeysInSource.length}, absent from the document: ${keyMisses.length}`)
  for (const k of keyMisses) console.log(`  MISSING KEY: ${k}`)

  const total = rows.reduce((a, r) => a + r.total, 0)
  const missing = rows.reduce((a, r) => a + r.missing, 0)
  console.log(`\nTOTAL ${total} facts, ${missing} missing in the owning section, ${(100 * (1 - missing / total)).toFixed(1)}%`)

  if (process.argv.includes('--verbose')) {
    console.log('\nmisses:')
    for (const m of missingDetail) console.log(`  ${m.name} [${m.cls}] ${m.id}`)
  }
  // The gate must gate. Any missing fact in any class fails the run, not just a
  // missing storage key — otherwise a green `npm run docs:facts` means only that
  // the twelve keys are present, which is not what anyone will read it as.
  if (keyMisses.length > 0 || missing > 0) process.exitCode = 1
}

if (process.argv.includes('--generate')) generate()
else audit()
