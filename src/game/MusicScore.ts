import type { Faction, ZoneId } from './types'

export type MusicIntensity = 'explore' | 'alert' | 'combat' | 'boss'
export type MusicOutcome = 'none' | 'victory' | 'defeat'
export type MusicTonePart = 'lead' | 'bass' | 'pad' | 'pulse'
export type MusicDrum = 'kick' | 'snare' | 'hat' | 'tom' | 'crash'

export interface MusicContext {
  faction: Faction
  zone: ZoneId
  intensity: MusicIntensity
  threatTier: number
  outcome: MusicOutcome
}

export interface MusicToneEvent {
  kind: 'tone'
  part: MusicTonePart
  midi: number
  durationSteps: number
  velocity: number
  pan: number
}

export interface MusicDrumEvent {
  kind: 'drum'
  drum: MusicDrum
  velocity: number
  pan: number
}

export type MusicEvent = MusicToneEvent | MusicDrumEvent

type MusicSection = 'intro' | 'verse' | 'lift' | 'breakdown' | 'finale'
type OutcomeSection = 'statement' | 'body' | 'cadence'
type MelodyStep = number | null

interface MusicTheme {
  root: number
  tempo: number
  progressions: Readonly<Record<MusicSection, readonly number[]>>
  melodyA: readonly MelodyStep[]
  melodyB: readonly MelodyStep[]
  bossMelody: readonly MelodyStep[]
  bassSteps: readonly number[]
  pulseSteps: readonly number[]
  kickSteps: readonly number[]
}

interface ZoneMusicProfile {
  rootShift: number
  chordRotation: number
  motifOffset: number
}

/**
 * A run ending gets its own through-composed piece instead of the adaptive loop:
 * one 16-bar arc that restarts from bar 1 the moment the outcome lands.
 */
interface OutcomeTheme {
  root: number
  tempo: number
  /** Semitones per scale degree, so chords stay diatonic in whichever mode the piece uses. */
  scale: readonly number[]
  /** Scale degrees, not semitones; negatives drop the chord an octave for a walking bass. */
  progressions: Readonly<Record<OutcomeSection, readonly number[]>>
  /** Four-bar melodies in semitones above the key root, indexed bar-major. */
  leadA: readonly MelodyStep[]
  leadB: readonly MelodyStep[]
  bassSteps: readonly number[]
  pulseSteps: readonly number[]
  /** Scale-degree offsets above the current chord for the bell voice. */
  pulseVoices: readonly number[]
  pulseOctave: number
}

export const MUSIC_STEPS_PER_BAR = 16
export const MUSIC_BARS_PER_CYCLE = 32
export const MUSIC_CYCLE_STEPS = MUSIC_STEPS_PER_BAR * MUSIC_BARS_PER_CYCLE
export const MUSIC_OUTCOME_BARS = 16
export const MUSIC_OUTCOME_STEPS = MUSIC_STEPS_PER_BAR * MUSIC_OUTCOME_BARS

export const DEFAULT_MUSIC_CONTEXT: MusicContext = {
  faction: 'elf',
  zone: 'forest',
  intensity: 'explore',
  threatTier: 1,
  outcome: 'none',
}

const MUSIC_INTENSITY_RANK: Readonly<Record<MusicIntensity, number>> = {
  explore: 0,
  alert: 1,
  combat: 2,
  boss: 3,
}

const MUSIC_THEMES: Readonly<Record<Faction, MusicTheme>> = {
  elf: {
    root: 57,
    tempo: 126,
    progressions: {
      intro: [0, 0, 5, 7],
      verse: [0, 5, -2, 7],
      lift: [5, 7, 0, -2],
      breakdown: [-2, 5, 0, 0],
      finale: [0, 5, 7, -2],
    },
    melodyA: [
      0, null, 4, 7, null, 9, 7, null,
      4, null, 2, 4, 7, null, 4, null,
      0, null, 4, 7, 12, null, 9, 7,
      4, null, 2, 0, 2, null, -1, null,
    ],
    melodyB: [
      7, null, 9, 12, 14, null, 12, 9,
      7, 4, 7, null, 9, null, 7, null,
      4, null, 7, 9, 12, 9, 7, 4,
      2, 4, 7, null, 4, 2, 0, null,
    ],
    bossMelody: [
      0, null, 3, 7, 10, null, 7, 3,
      -2, null, 3, 6, 10, 6, 3, null,
      0, 3, 7, 12, 10, 7, 3, null,
      5, 3, 0, -2, 0, 3, 6, null,
    ],
    bassSteps: [0, 4, 8, 12],
    pulseSteps: [2, 6, 10, 14],
    kickSteps: [0, 6, 8, 11],
  },
  guard: {
    root: 55,
    tempo: 120,
    progressions: {
      intro: [0, 0, 5, 7],
      verse: [0, -2, -5, 0],
      lift: [5, 3, 0, 7],
      breakdown: [-5, -2, 0, 0],
      finale: [0, 5, 3, 7],
    },
    melodyA: [
      0, null, 7, null, 12, 7, 5, null,
      3, null, 7, null, 10, 7, 5, null,
      0, null, 5, 7, 12, null, 10, 7,
      5, null, 3, 5, 7, null, 2, null,
    ],
    melodyB: [
      0, 5, 7, null, 10, 12, 14, null,
      12, 10, 7, 5, 7, null, 3, null,
      5, 7, 10, 12, 15, 12, 10, null,
      7, 5, 3, 5, 7, 10, 12, null,
    ],
    bossMelody: [
      0, null, 6, 7, 12, null, 10, 6,
      3, null, 7, 10, 15, 10, 7, null,
      0, 5, 6, 12, 10, 7, 5, null,
      3, 6, 10, 12, 10, 6, 3, null,
    ],
    bassSteps: [0, 4, 8, 10, 12],
    pulseSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    kickSteps: [0, 4, 8, 12],
  },
  villain: {
    root: 52,
    tempo: 124,
    progressions: {
      intro: [0, -1, -5, 0],
      verse: [0, -2, -5, -1],
      lift: [3, -2, 0, -5],
      breakdown: [-5, -1, 0, 0],
      finale: [0, -2, -1, -5],
    },
    melodyA: [
      0, null, 3, 7, null, 6, 3, null,
      -2, 3, null, 7, 10, null, 6, 3,
      0, null, 3, 7, 12, null, 7, 3,
      1, null, 5, 8, null, 5, 1, -2,
    ],
    melodyB: [
      7, null, 10, 12, null, 15, 12, 10,
      6, null, 10, 13, 10, null, 6, 3,
      0, 3, null, 8, 12, 8, 5, null,
      1, 5, 8, null, 6, 3, -2, null,
    ],
    bossMelody: [
      0, 1, 3, 7, 6, 3, -2, null,
      0, 3, 6, 10, 9, 6, 1, null,
      0, 1, 7, 12, 10, 7, 3, 1,
      -2, 1, 5, 8, 6, 3, -1, null,
    ],
    bassSteps: [0, 3, 6, 8, 11, 14],
    pulseSteps: [1, 4, 7, 9, 12, 15],
    kickSteps: [0, 3, 7, 8, 11, 14],
  },
}

const ZONE_MUSIC_PROFILES: Readonly<Record<ZoneId, ZoneMusicProfile>> = {
  neutral: { rootShift: 2, chordRotation: 1, motifOffset: 8 },
  palace: { rootShift: 5, chordRotation: 2, motifOffset: 0 },
  forest: { rootShift: 0, chordRotation: 0, motifOffset: 0 },
  fort: { rootShift: -2, chordRotation: 3, motifOffset: 4 },
}

const MAJOR_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11]
const NATURAL_MINOR_SCALE: readonly number[] = [0, 2, 3, 5, 7, 8, 10]

const OUTCOME_THEMES: Readonly<Record<Exclude<MusicOutcome, 'none'>, OutcomeTheme>> = {
  // Triumphal march in G major. The lead quotes the natural-harmonic bugle call
  // (do-mi-sol-do) every fanfare has used since valveless brass, over a plain I-IV-V-I.
  victory: {
    root: 55,
    tempo: 108,
    scale: MAJOR_SCALE,
    progressions: {
      statement: [0, 0, 4, 0],
      body: [0, 3, 4, 0],
      cadence: [5, 3, 4, 0],
    },
    leadA: [
      0, null, null, 0, 4, null, null, 4, 7, null, null, null, 7, null, 9, null,
      12, null, null, null, null, null, 9, null, 7, null, null, null, 4, null, null, null,
      7, null, 9, null, 12, null, null, null, 11, null, 9, null, 7, null, null, null,
      0, null, 4, null, 7, null, 12, null, 12, null, null, null, null, null, null, null,
    ],
    leadB: [
      7, null, null, null, 12, null, null, null, 11, null, 9, null, 7, null, null, null,
      9, null, null, null, 7, null, 5, null, 4, null, null, null, 2, null, null, null,
      0, null, 4, null, 7, null, 9, null, 12, null, null, null, 11, null, 9, null,
      7, null, 9, null, 11, null, 12, null, 16, null, null, null, null, null, null, null,
    ],
    bassSteps: [0, 4, 8, 12],
    pulseSteps: [2, 6, 10, 14],
    pulseVoices: [4, 2, 7, 2],
    pulseOctave: 12,
  },
  // Funeral lament in D minor. The bass walks the descending lamento tetrachord
  // (i-bVII-bVI-v) that Baroque laments are built on, under a sighing stepwise melody.
  defeat: {
    root: 50,
    tempo: 56,
    scale: NATURAL_MINOR_SCALE,
    progressions: {
      statement: [0, 0, -3, 0],
      body: [0, -1, -2, -3],
      cadence: [0, -2, 3, 0],
    },
    leadA: [
      12, null, null, null, null, null, 10, null, 10, null, null, null, 8, null, null, null,
      8, null, null, null, null, null, 7, null, 7, null, null, null, null, null, null, null,
      8, null, null, null, null, null, 7, null, 5, null, null, null, 3, null, null, null,
      2, null, null, null, null, null, 3, null, 2, null, null, null, 0, null, null, null,
    ],
    leadB: [
      0, null, null, null, null, null, 3, null, 5, null, null, null, 7, null, null, null,
      8, null, null, null, null, null, 7, null, 5, null, null, null, null, null, 3, null,
      2, null, null, null, null, null, 0, null, -2, null, null, null, 0, null, null, null,
      3, null, null, null, 2, null, null, null, 0, null, null, null, null, null, null, null,
    ],
    bassSteps: [0, 8],
    pulseSteps: [8],
    pulseVoices: [0, 4, 0, 2],
    pulseOctave: 24,
  },
}

export function getMusicTempo(faction: Faction, outcome: MusicOutcome = 'none'): number {
  if (outcome !== 'none') return OUTCOME_THEMES[outcome].tempo
  return MUSIC_THEMES[faction].tempo
}

export function musicIntensityRank(intensity: MusicIntensity): number {
  return MUSIC_INTENSITY_RANK[intensity]
}

export function isMusicBarBoundary(step: number): boolean {
  return normalizeStep(step) % MUSIC_STEPS_PER_BAR === 0
}

export function normalizeMusicContext(context: MusicContext): MusicContext {
  return {
    ...context,
    outcome: context.outcome ?? 'none',
    threatTier: Number.isFinite(context.threatTier)
      ? Math.max(1, Math.min(5, Math.trunc(context.threatTier)))
      : 1,
  }
}

export function planMusicStep(
  requestedContext: MusicContext,
  requestedStep: number,
  requestedSeed: number,
): readonly MusicEvent[] {
  const context = normalizeMusicContext(requestedContext)
  const step = normalizeStep(requestedStep)
  if (context.outcome !== 'none') return planOutcomeStep(context.outcome, step)
  const bar = Math.floor(step / MUSIC_STEPS_PER_BAR)
  const stepInBar = step % MUSIC_STEPS_PER_BAR
  const section = sectionForBar(bar)
  const theme = MUSIC_THEMES[context.faction]
  const zone = ZONE_MUSIC_PROFILES[context.zone]
  const progression = theme.progressions[section]
  const chordIndex = (bar + zone.chordRotation) % progression.length
  const root = theme.root + zone.rootShift + progression[chordIndex]
  const rank = musicIntensityRank(context.intensity)
  const seed = normalizeSeed(requestedSeed)
  const events: MusicEvent[] = []

  planPads(events, root, bar, stepInBar, rank)
  planBass(events, theme, root, bar, stepInBar, rank, seed)
  planLead(events, theme, zone, root, bar, stepInBar, section, rank, seed)
  planPulse(events, context, theme, root, bar, stepInBar, section, rank)
  planDrums(events, context, theme, bar, stepInBar, section, rank, seed)

  return events
}

function planOutcomeStep(
  outcome: Exclude<MusicOutcome, 'none'>,
  step: number,
): readonly MusicEvent[] {
  const theme = OUTCOME_THEMES[outcome]
  const phraseStep = step % MUSIC_OUTCOME_STEPS
  const bar = Math.floor(phraseStep / MUSIC_STEPS_PER_BAR)
  const stepInBar = phraseStep % MUSIC_STEPS_PER_BAR
  const section = outcomeSectionForBar(bar)
  const progression = theme.progressions[section]
  const degree = progression[bar % progression.length]
  const chordRoot = theme.root + scaleTone(theme.scale, degree)
  const third = scaleTone(theme.scale, degree + 2) - scaleTone(theme.scale, degree)
  const fifth = scaleTone(theme.scale, degree + 4) - scaleTone(theme.scale, degree)
  const events: MusicEvent[] = []

  planOutcomePads(events, outcome, chordRoot, third, fifth, bar, stepInBar, section)
  planOutcomeBass(events, theme, outcome, chordRoot, fifth, bar, stepInBar, section)
  planOutcomeLead(events, theme, outcome, bar, stepInBar)
  planOutcomePulse(events, theme, outcome, chordRoot, degree, bar, stepInBar, section)
  planOutcomeDrums(events, outcome, bar, stepInBar, section)

  return events
}

function planOutcomePads(
  events: MusicEvent[],
  outcome: Exclude<MusicOutcome, 'none'>,
  chordRoot: number,
  third: number,
  fifth: number,
  bar: number,
  stepInBar: number,
  section: OutcomeSection,
): void {
  if (stepInBar !== 0) return
  const swell = section === 'statement' && bar < 2 ? 0.8 : 1
  const velocity = (outcome === 'victory' ? 0.74 : 0.6) * swell
  addTone(events, 'pad', chordRoot + 12, 15.6, velocity, -0.3)
  addTone(events, 'pad', chordRoot + 12 + third, 15.6, velocity * 0.78, 0.3)
  addTone(events, 'pad', chordRoot + 12 + fifth, 15.6, velocity * 0.66, 0.12)
  if (outcome === 'victory' && section !== 'statement') {
    addTone(events, 'pad', chordRoot + 24, 15.6, velocity * 0.5, -0.12)
  }
  // The lament needs weight between the walking bass and the chord, not more brightness.
  if (outcome === 'defeat') addTone(events, 'pad', chordRoot, 15.6, velocity * 0.62, 0)
}

function planOutcomeBass(
  events: MusicEvent[],
  theme: OutcomeTheme,
  outcome: Exclude<MusicOutcome, 'none'>,
  chordRoot: number,
  fifth: number,
  bar: number,
  stepInBar: number,
  section: OutcomeSection,
): void {
  if (!theme.bassSteps.includes(stepInBar)) return
  if (outcome === 'defeat' && section === 'statement' && bar === 0 && stepInBar !== 0) return
  const onFifth = outcome === 'victory' && (stepInBar === 4 || stepInBar === 12)
  const duration = outcome === 'victory' ? 3.4 : 7.6
  const velocity = outcome === 'victory' ? (stepInBar % 8 === 0 ? 0.94 : 0.72) : 0.86
  addTone(events, 'bass', chordRoot - 12 + (onFifth ? fifth : 0), duration, velocity, 0)
}

function planOutcomeLead(
  events: MusicEvent[],
  theme: OutcomeTheme,
  outcome: Exclude<MusicOutcome, 'none'>,
  bar: number,
  stepInBar: number,
): void {
  const melody = Math.floor(bar / 4) % 2 === 1 ? theme.leadB : theme.leadA
  const index = (bar % 4) * MUSIC_STEPS_PER_BAR + stepInBar
  const interval = melody[index]
  if (interval === null) return

  const articulation = outcome === 'victory' ? 0.62 : 1
  const durationSteps = Math.max(
    0.5,
    Math.min(MUSIC_STEPS_PER_BAR, melodyGap(melody, index) * articulation),
  )
  const velocity = outcome === 'victory' ? (interval >= 12 ? 1 : 0.88) : 0.72
  const pan = ((bar + Math.floor(stepInBar / 4)) % 2 === 0 ? -1 : 1) * 0.12
  addTone(events, 'lead', theme.root + 12 + interval, durationSteps, velocity, pan)
}

function planOutcomePulse(
  events: MusicEvent[],
  theme: OutcomeTheme,
  outcome: Exclude<MusicOutcome, 'none'>,
  chordRoot: number,
  degree: number,
  bar: number,
  stepInBar: number,
  section: OutcomeSection,
): void {
  if (!theme.pulseSteps.includes(stepInBar)) return
  if (outcome === 'victory' && section === 'statement' && bar < 2) return
  if (outcome === 'defeat' && section === 'statement' && bar % 2 === 1) return

  const voice = theme.pulseVoices[(Math.floor(stepInBar / 4) + bar) % theme.pulseVoices.length]
  const midi = chordRoot + theme.pulseOctave + scaleTone(theme.scale, degree + voice) -
    scaleTone(theme.scale, degree)
  const duration = outcome === 'victory' ? 1.7 : 11
  const velocity = outcome === 'victory' ? 0.52 : 0.46
  addTone(events, 'pulse', midi, duration, velocity, stepInBar % 8 < 4 ? -0.34 : 0.34)
}

function planOutcomeDrums(
  events: MusicEvent[],
  outcome: Exclude<MusicOutcome, 'none'>,
  bar: number,
  stepInBar: number,
  section: OutcomeSection,
): void {
  if (outcome === 'defeat') {
    // Muffled funeral drum: a heavy step on beats one and three, nothing else.
    if (stepInBar === 0) addDrum(events, 'kick', 0.72, 0)
    if (stepInBar === 8) addDrum(events, 'kick', 0.5, 0)
    if (section !== 'statement' && stepInBar === 8) addDrum(events, 'snare', 0.26, 0.06)
    if (stepInBar === 0 && bar % 8 === 0) addDrum(events, 'crash', 0.5, 0.1)
    if (bar % 4 === 3 && (stepInBar === 12 || stepInBar === 14)) {
      addDrum(events, 'tom', stepInBar === 12 ? 0.4 : 0.32, stepInBar === 12 ? -0.2 : 0.2)
    }
    return
  }

  if (stepInBar === 0 || stepInBar === 8) addDrum(events, 'kick', stepInBar === 0 ? 1 : 0.82, 0)
  if (section !== 'statement' && stepInBar === 6) addDrum(events, 'kick', 0.6, 0)
  if (stepInBar === 4 || stepInBar === 12) addDrum(events, 'snare', 0.86, 0.08)
  if (section !== 'statement' && stepInBar % 4 === 2) {
    addDrum(events, 'hat', 0.42, stepInBar % 8 < 4 ? -0.3 : 0.3)
  }
  if (bar % 4 === 3 && stepInBar >= 12) {
    addDrum(events, 'snare', 0.4 + (stepInBar - 12) * 0.14, (stepInBar - 13.5) * 0.2)
  }
  if (stepInBar === 0 && bar % 4 === 0) addDrum(events, 'crash', bar === 0 ? 1 : 0.7, 0.14)
}

/** Steps until the melody sounds again, so held notes can breathe into the next attack. */
function melodyGap(melody: readonly MelodyStep[], index: number): number {
  for (let offset = 1; offset <= melody.length; offset += 1) {
    if (melody[(index + offset) % melody.length] !== null) return offset
  }
  return melody.length
}

/** Diatonic lookup that keeps negative degrees in key an octave down. */
function scaleTone(scale: readonly number[], degree: number): number {
  const size = scale.length
  const octave = Math.floor(degree / size)
  return scale[degree - octave * size] + octave * 12
}

function outcomeSectionForBar(bar: number): OutcomeSection {
  if (bar < 4) return 'statement'
  if (bar < 12) return 'body'
  return 'cadence'
}

function planPads(
  events: MusicEvent[],
  root: number,
  bar: number,
  stepInBar: number,
  rank: number,
): void {
  if (stepInBar !== 0) return
  const velocity = [0.68, 0.55, 0.42, 0.48][rank]
  addTone(events, 'pad', root + 12, 15.5, velocity, -0.28)
  if (rank > 0 || bar % 2 === 0) {
    addTone(events, 'pad', root + 19, 15.5, velocity * 0.72, 0.28)
  }
}

function planBass(
  events: MusicEvent[],
  theme: MusicTheme,
  root: number,
  bar: number,
  stepInBar: number,
  rank: number,
  seed: number,
): void {
  const activeSteps =
    rank === 0
      ? stepInBar === 0 || stepInBar === 8
      : rank === 1
        ? stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12
        : theme.bassSteps.includes(stepInBar)
  if (!activeSteps) return

  const variation = seededUnit(seed, bar, 0x41)
  const fifth =
    stepInBar >= 8 &&
    (rank >= 2 || variation > 0.64) &&
    (stepInBar + bar) % 3 === 0
  const duration = rank === 0 ? 7.3 : rank === 1 ? 3.35 : rank === 2 ? 1.75 : 1.5
  const velocity = rank === 0 ? 0.62 : rank === 1 ? 0.76 : rank === 2 ? 0.9 : 1
  addTone(events, 'bass', root - 12 + (fifth ? 7 : 0), duration, velocity, 0)
}

function planLead(
  events: MusicEvent[],
  theme: MusicTheme,
  zone: ZoneMusicProfile,
  root: number,
  bar: number,
  stepInBar: number,
  section: MusicSection,
  rank: number,
  seed: number,
): void {
  const phraseStep = (bar * MUSIC_STEPS_PER_BAR + stepInBar + zone.motifOffset) % 32
  const variation = seededUnit(seed, bar, 0x8d)
  const melody =
    rank === 3
      ? theme.bossMelody
      : section === 'lift' || section === 'finale' || variation > 0.82
        ? theme.melodyB
        : theme.melodyA
  let interval = melody[phraseStep]
  if (interval === null) return
  if (rank === 0 && stepInBar % 2 !== 0) return
  if (section === 'intro' && bar < 2 && stepInBar % 4 !== 0) return
  if (section === 'breakdown' && rank < 2 && stepInBar % 4 !== 0) return

  const cadence = stepInBar >= 12 && (bar + 1) % 4 === 0
  if (cadence && variation > 0.58) interval += variation > 0.84 ? 12 : 2
  const duration = rank === 0 ? 2.6 : rank === 1 ? 1.55 : rank === 2 ? 0.86 : 0.72
  const velocity = rank === 0 ? 0.64 : rank === 1 ? 0.78 : rank === 2 ? 0.9 : 1
  const pan = ((bar + phraseStep) % 2 === 0 ? -1 : 1) * (rank >= 2 ? 0.16 : 0.1)
  addTone(events, 'lead', root + 12 + interval, duration, velocity, pan)
}

function planPulse(
  events: MusicEvent[],
  context: MusicContext,
  theme: MusicTheme,
  root: number,
  bar: number,
  stepInBar: number,
  section: MusicSection,
  rank: number,
): void {
  const palaceExplore =
    rank === 0 &&
    context.zone === 'palace' &&
    (stepInBar === 6 || stepInBar === 14) &&
    bar % 2 === 1
  if (!palaceExplore) {
    if (rank === 0 || !theme.pulseSteps.includes(stepInBar)) return
    if (rank === 1 && theme.pulseSteps.indexOf(stepInBar) % 2 !== 0) return
    if (section === 'breakdown' && rank < 3 && stepInBar % 4 !== 2) return
  }

  const chordTones = context.faction === 'villain' ? [12, 18, 19, 15] : [12, 19, 16, 19]
  const interval = chordTones[(Math.floor(stepInBar / 2) + bar) % chordTones.length]
  const duration = rank >= 2 ? 0.65 : 0.9
  const velocity = palaceExplore ? 0.34 : rank === 1 ? 0.46 : rank === 2 ? 0.68 : 0.82
  addTone(events, 'pulse', root + interval, duration, velocity, stepInBar % 4 < 2 ? -0.34 : 0.34)
}

function planDrums(
  events: MusicEvent[],
  context: MusicContext,
  theme: MusicTheme,
  bar: number,
  stepInBar: number,
  section: MusicSection,
  rank: number,
  seed: number,
): void {
  if (rank === 0) {
    const sparseHat =
      (context.zone === 'forest' && (stepInBar === 6 || stepInBar === 14)) ||
      (context.zone === 'neutral' && stepInBar === 14 && bar % 2 === 1)
    if (sparseHat) addDrum(events, 'hat', 0.25, stepInBar === 6 ? -0.28 : 0.28)
    if (context.zone === 'fort' && stepInBar === 0 && bar % 4 === 0) {
      addDrum(events, 'tom', 0.32, -0.12)
    }
    return
  }

  const breakdown = section === 'breakdown' && rank < 3
  if (!breakdown && (stepInBar === 0 || stepInBar === 8)) {
    addDrum(events, 'kick', rank === 1 ? 0.58 : rank === 2 ? 0.82 : 1, 0)
  }
  if (rank >= 2 && !breakdown && theme.kickSteps.includes(stepInBar) && stepInBar !== 0 && stepInBar !== 8) {
    addDrum(events, 'kick', rank === 3 ? 0.78 : 0.62, 0)
  }
  if (stepInBar === 4 || stepInBar === 12) {
    addDrum(events, 'snare', rank === 1 ? 0.48 : rank === 2 ? 0.72 : 0.88, 0.08)
  }

  const hatStride = context.zone === 'forest' ? 4 : rank >= 2 ? 2 : 4
  if (stepInBar % hatStride === hatStride - 2) {
    addDrum(events, 'hat', rank === 1 ? 0.3 : 0.44, stepInBar % 4 === 0 ? -0.32 : 0.32)
  }
  if (rank >= 2 && context.threatTier >= 3 && stepInBar % 4 === 3) {
    addDrum(events, 'hat', 0.25 + context.threatTier * 0.035, stepInBar % 8 < 4 ? -0.38 : 0.38)
  }

  const sectionOpening = stepInBar === 0 && (bar === 4 || bar === 12 || bar === 24)
  if (rank >= 2 && sectionOpening) addDrum(events, 'crash', rank === 3 ? 0.82 : 0.62, 0.16)
  else if (rank === 3 && stepInBar === 0 && bar % 4 === 0) {
    addDrum(events, 'crash', 0.72, -0.18)
  }

  const fillVariation = seededUnit(seed, bar, 0xd3)
  const fillBar = rank >= 2 && (bar + 1) % 4 === 0 && fillVariation > 0.28
  if (fillBar && stepInBar >= 13) {
    addDrum(events, 'tom', 0.48 + (stepInBar - 13) * 0.12, (stepInBar - 14) * 0.22)
  }
  if (context.zone === 'fort' && rank >= 2 && stepInBar === 10) {
    addDrum(events, 'tom', 0.46, -0.18)
  }
}

function addTone(
  events: MusicEvent[],
  part: MusicTonePart,
  midi: number,
  durationSteps: number,
  velocity: number,
  pan: number,
): void {
  events.push({
    kind: 'tone',
    part,
    midi,
    durationSteps,
    velocity: clamp01(velocity),
    pan: Math.max(-1, Math.min(1, pan)),
  })
}

function addDrum(
  events: MusicEvent[],
  drum: MusicDrum,
  velocity: number,
  pan: number,
): void {
  events.push({
    kind: 'drum',
    drum,
    velocity: clamp01(velocity),
    pan: Math.max(-1, Math.min(1, pan)),
  })
}

function sectionForBar(bar: number): MusicSection {
  if (bar < 4) return 'intro'
  if (bar < 12) return 'verse'
  if (bar < 20) return 'lift'
  if (bar < 24) return 'breakdown'
  return 'finale'
}

function normalizeStep(step: number): number {
  const integer = Number.isFinite(step) ? Math.trunc(step) : 0
  return ((integer % MUSIC_CYCLE_STEPS) + MUSIC_CYCLE_STEPS) % MUSIC_CYCLE_STEPS
}

function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0x6d2b79f5
}

function seededUnit(seed: number, bar: number, salt: number): number {
  let value = seed ^ Math.imul(bar + 1, 0x9e3779b1) ^ salt
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
