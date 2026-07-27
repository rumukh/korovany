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
 *   node scripts/strategy-facts.mjs --accept     # re-declare the residue (deliberate only)
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
const CONTROLS = join(ROOT, 'scripts', 'strategy-facts.controls.json')
const ACCEPTED = join(ROOT, 'scripts', 'strategy-facts.accepted.json')
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
  'relation',
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
    .map((l) => l.replace(/§\s?\d+[A-Z]?(\.\d+)*/g, ' '))
    // cross-references to sibling specs: strip the REFERENCE, keep the sentence.
    // Dropping the whole line also dropped the invariant the sentence carried.
    .map((l) => l.replace(/\bspecs?\s+\d{2}\b/gi, 'the sibling spec'))
    .map((l) => l.replace(/`?\d{2}-[a-z-]+-spec(\.md)?`?/gi, 'the sibling spec'))
    // line-number citations into files that no longer exist
    .map((l) => l.replace(/[\w./-]+\.(ts|tsx|css|md):\d+(\s*[-\u2013,]\s*\d+)*/g, ' '))
}

/**
 * Document frequency across all fifteen specs, used to pick signature words.
 *
 * The previous signature took the four LONGEST non-stop words, which is a proxy
 * for distinctiveness and a bad one: it selected `therefore`, `controls` and
 * `create` — connectives and generic verbs that a faithful distillation
 * legitimately rewords — as often as it selected `combatMotion`, `rain-to-snow`
 * or `faction-start`. Requiring all four then measured similarity of phrasing,
 * not preservation of fact.
 *
 * Rarity is the right proxy. A word occurring in one spec line out of six
 * thousand is what makes a rule identifiable; a word occurring in four hundred
 * is not. This makes the discriminating token MANDATORY, which is the property
 * the audit asked for, while dropping the connective noise.
 */
let DF = null
export function setDocumentFrequencies(df) { DF = df }
function rarity(w) { return DF ? (DF[w] ?? 0) : 0 }

/** Distinctive content words, used as the signature of a prose rule. */
function signature(sentence, count = 3) {
  const words = sentence
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  const seen = []
  for (const w of words) if (!seen.includes(w)) seen.push(w)
  // rarest first; length breaks ties only when frequencies are unavailable
  return seen
    .sort((a, b) => (rarity(a) - rarity(b)) || (b.length - a.length))
    .slice(0, count)
}

const RULE_PATTERNS = {
  designRule: /\b(do not|never|must not|deliberately|is load-bearing|by construction)\b/i,
  lifecycleRule: /\b(dispose|disposal|teardown|destroy\(\)|cleanup|lifecycle|pause|paused|unmount|leak|ownership|owns|owned|borrowed)\b/i,
  budgetRule: /\b(budget|cap\b|capped|pool|pooled|at most|no more than|maximum of|reserve|slots?)\b/i,
  accessibilityRule: /\b(reduced motion|prefers-reduced-motion|accessib|colour alone|color alone|contrast|aria|readable|legib)\b/i,
  edgeCaseRule: /\b(edge case|if the|when the|cannot|corner case|race|simultaneous|out of range|invalid)\b/i,
}

/**
 * Negation and ordering markers. These are deliberately NOT in `STOP_WORDS` for
 * relation facts: a signature that discards `not` cannot tell "do not make bloom
 * responsible for outlines" from "do make bloom responsible for outlines", which
 * is the same rule with the opposite meaning.
 */
const NEGATION = /\b(not|never|cannot|must not|no longer|neither|nor|without|none|prohibited)\b/i
const ORDERING = /\b(before|after|then|first|last|precede[sd]?|follow[sedt]*|prior to|once|above|below|shorter|longer|higher|lower|earlier|later|outlives?|outlast[sedt]*)\b/i

/**
 * Relations are bindings and mappings — the facts that a bag of independent
 * tokens cannot express. `BLOOM_LAYER` and `1` both occurring in a section says
 * nothing about `BLOOM_LAYER = 1`; a role table containing `30` and `7` says
 * nothing about which role has which. Every relation is matched by ADJACENCY:
 * the value must follow the name with no other number in between.
 *
 * Polarity and ordering are deliberately NOT modelled as separate relation
 * facts. They are properties of rules the other classes already extract, so a
 * parallel class would double-count roughly one fact per sentence and make the
 * denominator meaningless. They are applied instead as extra constraints on
 * those rules — which is strictly stronger, because a rule now fails when its
 * polarity is inverted rather than merely when its nouns disappear.
 */
function extractRelations(lines, push) {
  const VALUE = String.raw`-?\d+(?:\.\d+)?|'[^']+'|"[^"]+"|\btrue\b|\bfalse\b|\bnull\b`
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // NAME = value, including single digits and negative sentinels. This is also
    // where TypeScript member declarations land: `private thunderDelay = -1` is
    // a binding, and -1 is a fact no other class captures.
    for (const m of line.matchAll(
      new RegExp(String.raw`\b([A-Za-z_][A-Za-z0-9_]{2,})\s*[:=]\s*(${VALUE})`, 'g'),
    )) {
      const [, name, value] = m
      if (/^(https?|www)$/i.test(name)) continue
      push('relation', `${name}=${value}`, { kind: 'binding', name, values: [value] })
    }

    // Markdown role rows: `| \`archer\` | 30 hp | 7 damage |` — the row binds a
    // named role to every number in it.
    if (/^\|/.test(line)) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
      const name = (cells[0] ?? '').replace(/`/g, '').trim()
      if (name && name.length < 40 && /^[A-Za-z][\w' -]*$/.test(name)) {
        const values = [...line.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)]
          .map((v) => v[1])
          .filter((v) => v.length > 0)
          .slice(0, 4)
        if (values.length > 0) {
          push('relation', `row:${name}:${values.join(',')}`, { kind: 'row', name, values })
        }
      }
    }
  }
}

/**
 * Windows of the owning section. The document is hard-wrapped near 100 columns,
 * so a fact's parts routinely straddle a line break; three consecutive lines is
 * the smallest window that does not create false negatives from wrapping alone,
 * and is still far too small to let an unrelated `1` satisfy a binding or an
 * unrelated `never` satisfy a prohibition.
 *
 * Signatures were previously matched against the WHOLE section, which is how a
 * removed formula and a removed pool cap both scored as present: their words
 * survived somewhere else in a two-hundred-line section. Matching is now
 * window-scoped for every probe that has parts.
 */
export function sectionWindows(section) {
  const lines = section.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines.slice(i, i + 3).join(' ').toLowerCase()
    out.push({ text, stems: sectionStems(text) })
  }
  return out
}

/**
 * Sentences of the owning section. Polarity and ordering are matched here rather
 * than in a three-line window: a window wide enough to survive hard wrapping is
 * also wide enough to contain a *different* sentence's `not`, which would let an
 * inverted prohibition pass. A prohibition is only preserved if the negation is
 * in the same sentence as the rule.
 */
function sectionSentences(section) {
  return section
    .replace(/\n+/g, ' ')
    .split(/(?<=[.;:!?])\s+/)
    .map((s) => {
      const text = s.toLowerCase()
      return { text, stems: sectionStems(text) }
    })
}

function relationPresent(probe, windows, lines) {
  const { kind } = probe
  const esc = (s) => String(s).toLowerCase().replace(/['"]/g, '').replace(/[.\\+*?[^\]$(){}|/-]/g, '\\$&')
  if (kind === 'row') {
    // A table row binds one name to the set of values IN THAT ROW. The correct
    // scope is therefore a single line: a three-line window would let the
    // neighbouring row's numbers satisfy this row, which is exactly the swap
    // that must be caught.
    const name = probe.name.toLowerCase()
    return lines.some(
      (l) => l.includes(name)
        && probe.values.every((v) => new RegExp(`(?<!\\w)${esc(v)}(?![\\w.])`).test(l)),
    )
  }
  if (kind === 'binding') {
    const name = esc(probe.name)
    // Adjacency, not co-occurrence. A three-line window of a constants block
    // contains a dozen numbers; requiring only that the name and the value both
    // appear in it would let `BOW_DAMAGE=18` be satisfied by the `18` in a
    // neighbouring line. The value must follow the name with no other number in
    // between, which is what binds this value to this name.
    return probe.values.every((v) => {
      const re = new RegExp(`${name}[^0-9\\n]{0,24}${esc(v)}(?![\\w.])`)
      return windows.some(({ text }) => re.test(text))
    })
  }
  return false
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
    // TypeScript member declarations are code shape rather than formulas — but
    // they are NOT dropped: they are extracted as `relation` bindings, which is
    // the class that captures `private thunderDelay = -1`.
    if (/^(private|public|protected|static|readonly)\b/.test(line)) continue
    if (line.length > 12 && line.length < 160) push('formula', line.slice(0, 60), signature(line, 3))
  }

  extractRelations(lines, push)

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length < 40 || trimmed.length > 400) continue
    for (const [cls, re] of Object.entries(RULE_PATTERNS)) {
      if (!re.test(trimmed)) continue
      const sig = signature(trimmed)
      if (sig.length < 3) continue
      // Polarity and ordering ride along with the rule rather than forming a
      // parallel class. `STOP_WORDS` strips `not`, `never`, `before` and `after`
      // from the signature — necessary, because they are everywhere — so without
      // this an inverted prohibition would score identically to the original.
      const ord = trimmed.match(ORDERING)
      push(cls, trimmed.slice(0, 70), {
        sig,
        neg: NEGATION.test(trimmed) || undefined,
        order: ord ? ord[0].toLowerCase() : undefined,
      })
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
export function present(fact, section, ctx) {
  const c = ctx ?? buildContext(section)
  if (fact.cls === 'relation') {
    return relationPresent(fact.probe, c.windows, c.lines)
  }
  if (Array.isArray(fact.probe)) {
    // formula signatures: window-scoped co-occurrence
    return c.windows.some(
      ({ text, stems }) => fact.probe.every((w) => text.includes(w) || stems.has(stem(w))),
    )
  }
  if (fact.probe && typeof fact.probe === 'object') {
    const { sig, neg, order } = fact.probe
    // Window-scoped: the probe words must CO-OCCUR, not merely both exist
    // somewhere in a two-hundred-line section.
    const co = c.windows.some(
      ({ text, stems }) => sig.every((w) => text.includes(w) || stems.has(stem(w))),
    )
    if (!co) return false
    // Polarity and ordering are checked at SENTENCE scope. A window wide enough
    // to survive hard wrapping is also wide enough to contain a different
    // sentence's `not`, which would let an inverted prohibition pass. Stemming
    // applies here exactly as it does in the window check — `callout` and
    // `callouts` are the same rule.
    const has = (s) => sig.every((w) => s.text.includes(w) || s.stems.has(stem(w)))
    if (neg && !c.sentences.some((s) => has(s) && NEGATION.test(s.text))) return false
    if (order && !c.sentences.some((s) => has(s) && s.text.includes(order))) return false
    return true
  }
  if (fact.cls === 'numericValue') {
    const escaped = fact.probe.replace('.', '\\.')
    // `(?<!\w)` rather than `(?<![\w.])`: the specs write ranges as `0.12..0.35`,
    // so a preceding dot is part of the notation, not a longer number.
    return new RegExp(`(?<!\\w)${escaped}(?![\\d])`).test(section)
  }
  return section.includes(fact.probe)
}

export function buildContext(section) {
  return {
    windows: sectionWindows(section),
    sentences: sectionSentences(section),
    lines: section.split('\n').map((l) => l.toLowerCase()),
  }
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
  // Document frequencies come from the whole corpus, so signature selection is
  // a property of the fifteen specs rather than of any one sentence.
  const df = {}
  const sources = {}
  for (const name of Object.keys(SECTION_MAP)) {
    sources[name] = readSpec(name)
    for (const w of normalise(sources[name]).toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
      df[w] = (df[w] ?? 0) + 1
    }
  }
  setDocumentFrequencies(df)
  fixtures.documentFrequencies = df
  for (const name of Object.keys(SECTION_MAP)) {
    fixtures.specs[name] = extractFacts(sources[name])
  }
  fixtures.storageKeysInSource = storageKeysFromSource()
  writeFileSync(FIXTURES, `${JSON.stringify(fixtures, null, 2)}\n`)
  const n = Object.values(fixtures.specs).reduce((a, f) => a + f.length, 0)
  console.log(`wrote ${FIXTURES} — ${n} facts across ${Object.keys(fixtures.specs).length} specs`)
}

/** Total misses across all fifteen pairings, plus storage-key misses. */
function countKeyMisses(fixtures, docLines) {
  const whole = docLines.join('\n')
  const misses = []
  for (const k of fixtures.storageKeysInSource) {
    const owner = Object.prototype.hasOwnProperty.call(KEY_OWNER, k) ? KEY_OWNER[k] : undefined
    if (owner === undefined) {
      misses.push(`${k} (UNCLASSIFIED — add it to KEY_OWNER)`)
      continue
    }
    const scope = owner === null ? whole : sectionText(docLines, owner)
    if (!scope.includes(k)) misses.push(owner === null ? k : `${k} (not in ${owner})`)
  }
  return misses
}

function countMisses(fixtures, docLines) {
  let missing = 0
  for (const [name, heading] of Object.entries(SECTION_MAP)) {
    const section = sectionText(docLines, heading)
    const ctx = buildContext(section)
    for (const fact of fixtures.specs[name] ?? []) {
      if (!present(fact, section, ctx)) missing += 1
    }
  }
  return missing + countKeyMisses(fixtures, docLines).length
}

/**
 * Recall control, from an INDEPENDENT corpus.
 *
 * The previous version selected a victim from `fixtures.specs[...]` — output of
 * the same `extractFacts()` under test. That is the self-sampling precision
 * control this file claims to have replaced: if the extractor is blind to a
 * class or a sentence form, no fixture exists and no fixture-derived control can
 * expose it. Only the storage-key class was genuinely independent, because it is
 * enumerated from `src/`.
 *
 * Controls are now hand-authored in `strategy-facts.controls.json` against the
 * specs, not against the extractor. Each mutates the document and must raise the
 * miss count. A control that does not fire names the blind class and fails the
 * run.
 */
function runControls(fixtures, docLines) {
  const failures = []
  const baseline = countMisses(fixtures, docLines)
  const body = docLines.join('\n')
  const { controls } = JSON.parse(readFileSync(CONTROLS, 'utf8'))
  const seen = new Set()
  const report = process.argv.includes('--controls')
  if (report) console.log(`baseline misses: ${baseline}\n`)

  for (const c of controls) {
    seen.add(c.cls)
    const muts = c.mutations ?? [{ find: c.find, replace: c.replace }]
    const absent = muts.filter((m) => !body.includes(m.find))
    if (absent.length === muts.length) {
      failures.push(`${c.cls}/${c.kind}: ANCHOR MISSING — "${muts[0].find}" is not in the document, so "${c.name}" cannot be tested`)
      continue
    }
    let text = body
    for (const m of muts) text = text.split(m.find).join(m.replace)
    const after = countMisses(fixtures, text.split('\n'))
    if (report) {
      console.log(`  ${after > baseline ? 'CAUGHT ' : 'PASSED '} ${String(after - baseline).padStart(4)}  ${c.cls}/${c.kind} — ${c.name}`)
    }
    if (after <= baseline) {
      failures.push(`${c.cls}/${c.kind}: CONTROL DID NOT FIRE — "${c.name}" changed the document without changing the score`)
    }
  }
  for (const cls of CLASSES) {
    if (!seen.has(cls)) failures.push(`${cls}: NO INDEPENDENT CONTROL — add one to strategy-facts.controls.json`)
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

  const controlFailures = process.argv.includes('--no-controls')
    ? []
    : runControls(fixtures, docLines)
  if (controlFailures.length > 0) {
    console.error('RECALL CONTROLS FAILED — the checker cannot see these classes:')
    for (const f of controlFailures) console.error(`  ${f}`)
    console.error('\n(a control cannot fire if its target fact is ALREADY missing —')
    console.error(' run with --no-controls to see the miss list, fix the document, then re-run)')
    process.exitCode = 1
    return
  }
  if (!process.argv.includes('--no-controls')) {
    console.log(`recall controls: ${CLASSES.length} classes, all independent controls fired\n`)
  }

  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { total: 0, missing: 0 }]))
  const rows = []
  let missingDetail = []

  for (const [name, heading] of Object.entries(SECTION_MAP)) {
    const section = sectionText(docLines, heading)
    const ctx = buildContext(section)
    const facts = fixtures.specs[name] ?? []
    let missing = 0
    for (const fact of facts) {
      byClass[fact.cls].total += 1
      if (!present(fact, section, ctx)) {
        missing += 1
        byClass[fact.cls].missing += 1
        missingDetail.push({ name, cls: fact.cls, id: fact.id })
      }
    }
    rows.push({ name, total: facts.length, missing })
  }

  // storage keys are a closed set enumerated from src/, checked in the section
  // that owns them — not merely somewhere in a 3,000-line file.
  const keyMisses = countKeyMisses(fixtures, docLines)

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

  // The gate is a ratchet, not a threshold. Every current miss is enumerated in
  // `strategy-facts.accepted.json` with its spec, class and source sentence, so
  // the residue is declared entry by entry rather than rounded away. The run
  // fails if a miss appears that is NOT on that list — so preservation can only
  // improve, and a green `npm run docs:facts` means "nothing regressed", which
  // is a claim it can actually support.
  const accepted = new Set(
    (JSON.parse(readFileSync(ACCEPTED, 'utf8')).accepted ?? [])
      .map((a) => `${a.spec}\u0000${a.cls}\u0000${a.id}`),
  )
  const unaccepted = missingDetail.filter(
    (m) => !accepted.has(`${m.name}\u0000${m.cls}\u0000${m.id}`),
  )
  const fixed = accepted.size - (missingDetail.length - unaccepted.length)
  console.log(`\ndeclared residue: ${accepted.size} accepted, ${unaccepted.length} NOT accepted${fixed > 0 ? `, ${fixed} previously accepted now preserved` : ''}`)
  for (const m of unaccepted.slice(0, 40)) console.log(`  NEW MISS: ${m.name} [${m.cls}] ${m.id}`)

  if (keyMisses.length > 0 || unaccepted.length > 0) process.exitCode = 1
}

/** `--accept` rewrites the declared-residue list from the current run. */
function acceptResidue() {
  const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'))
  const docLines = normalise(readFileSync(DOC, 'utf8')).split('\n')
  const out = []
  for (const [name, heading] of Object.entries(SECTION_MAP)) {
    const section = sectionText(docLines, heading)
    const ctx = buildContext(section)
    for (const fact of fixtures.specs[name] ?? []) {
      if (!present(fact, section, ctx)) out.push({ spec: name, cls: fact.cls, id: fact.id })
    }
  }
  writeFileSync(ACCEPTED, `${JSON.stringify({
    _comment: [
      'Declared residue: facts the consolidated document does not preserve in the section that owns',
      'them. Each entry names the spec, the class and the source sentence, so the gap is auditable',
      'rather than rounded away. The checker fails if a miss appears that is NOT on this list, so',
      'this file can only shrink. Regenerate with `node scripts/strategy-facts.mjs --accept`, and do',
      'that deliberately: it is the one operation in this tool that can hide a regression.',
    ],
    accepted: out,
  }, null, 2)}\n`)
  console.log(`wrote ${ACCEPTED} — ${out.length} declared misses`)
}

if (process.argv.includes('--generate')) generate()
else if (process.argv.includes('--accept')) acceptResidue()
else audit()
