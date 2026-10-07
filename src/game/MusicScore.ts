import type { Faction, ZoneId } from './types'

export type MusicIntensity = 'explore' | 'alert' | 'combat' | 'boss'
export type MusicOutcome = 'none' | 'victory' | 'defeat'
export type MusicTonePart = 'lead' | 'counter' | 'bass' | 'pad' | 'pluck' | 'chime'
export type MusicDrum =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'tom'
  | 'crash'
  | 'tambourine'
  | 'shaker'
  | 'spoons'
  | 'frameDrum'
  | 'sleighBells'
  | 'anvil'
  | 'gong'
  | 'timpani'
export type MusicInstrument =
  | 'flute'
  | 'reed'
  | 'horn'
  | 'trumpet'
  | 'lowBrass'
  | 'strings'
  | 'cello'
  | 'contrabass'
  | 'choir'
  | 'bayan'
  | 'organ'
  | 'gusli'
  | 'balalaika'
  | 'pizzicato'
  | 'uprightBass'
  | 'celesta'
  | 'glockenspiel'
  | 'churchBell'
/**
 * Folk decoration of a held note: a mordent or grace from the scale tone above, a scoop
 * from below, a trill, or a balalaika's rapid re-plucked tremolo.
 */
export type MusicOrnament = 'mordent' | 'grace' | 'lowerGrace' | 'trill' | 'tremolo'

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
  instrument: MusicInstrument
  midi: number
  durationSteps: number
  velocity: number
  pan: number
  /** Fraction of a step to delay the onset, so a chord can be strummed. */
  offsetSteps?: number
  ornament?: MusicOrnament
  /** The neighbour the ornament decorates the main note with. */
  ornamentMidi?: number
}

export interface MusicDrumEvent {
  kind: 'drum'
  drum: MusicDrum
  velocity: number
  pan: number
  /** Tuned drums (timpani, toms) sound this pitch. */
  midi?: number
}

export type MusicEvent = MusicToneEvent | MusicDrumEvent

export interface MusicKey {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number
  /** Semitones of the mode above the tonic. */
  scale: readonly number[]
}

export const MUSIC_STEPS_PER_BAR = 16
export const MUSIC_BARS_PER_CYCLE = 32
export const MUSIC_CYCLE_STEPS = MUSIC_STEPS_PER_BAR * MUSIC_BARS_PER_CYCLE
/** Passes through the 32-bar form before ornaments, thinning and fills repeat exactly. */
export const MUSIC_VARIATION_CYCLES = 8
export const MUSIC_VARIATION_STEPS = MUSIC_CYCLE_STEPS * MUSIC_VARIATION_CYCLES
export const MUSIC_OUTCOME_BARS = 16
export const MUSIC_OUTCOME_STEPS = MUSIC_STEPS_PER_BAR * MUSIC_OUTCOME_BARS

export const DEFAULT_MUSIC_CONTEXT: MusicContext = {
  faction: 'elf',
  zone: 'forest',
  intensity: 'explore',
  threatTier: 1,
  outcome: 'none',
}

export const MUSIC_INSTRUMENTS: readonly MusicInstrument[] = [
  'flute',
  'reed',
  'horn',
  'trumpet',
  'lowBrass',
  'strings',
  'cello',
  'contrabass',
  'choir',
  'bayan',
  'organ',
  'gusli',
  'balalaika',
  'pizzicato',
  'uprightBass',
  'celesta',
  'glockenspiel',
  'churchBell',
]

export const MUSIC_DRUMS: readonly MusicDrum[] = [
  'kick',
  'snare',
  'hat',
  'tom',
  'crash',
  'tambourine',
  'shaker',
  'spoons',
  'frameDrum',
  'sleighBells',
  'anvil',
  'gong',
  'timpani',
]

/** Where each instrument sounds natural; the planner folds octaves into these. */
export const MUSIC_INSTRUMENT_RANGES: Readonly<Record<MusicInstrument, readonly [number, number]>> = {
  flute: [60, 96],
  reed: [46, 84],
  horn: [41, 77],
  trumpet: [55, 86],
  lowBrass: [28, 70],
  strings: [36, 96],
  cello: [36, 76],
  contrabass: [24, 55],
  choir: [45, 81],
  bayan: [41, 89],
  organ: [36, 96],
  gusli: [45, 98],
  balalaika: [50, 96],
  pizzicato: [31, 86],
  uprightBass: [26, 62],
  celesta: [60, 102],
  glockenspiel: [70, 110],
  churchBell: [40, 80],
}

const MUSIC_INTENSITY_RANK: Readonly<Record<MusicIntensity, number>> = {
  explore: 0,
  alert: 1,
  combat: 2,
  boss: 3,
}

const DORIAN: readonly number[] = [0, 2, 3, 5, 7, 9, 10]
const MAJOR_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11]
const MIXOLYDIAN: readonly number[] = [0, 2, 4, 5, 7, 9, 10]
const HARMONIC_MINOR: readonly number[] = [0, 2, 3, 5, 7, 8, 11]
const NATURAL_MINOR_SCALE: readonly number[] = [0, 2, 3, 5, 7, 8, 10]

interface PhraseSpec {
  /** One chord symbol per bar. */
  chords: string
  /** Four bars of `Note:steps` tokens (`-` rests), bars separated by `|`. */
  melody: string
  /** Local mode when the phrase leaves the home key, in semitones above the tonic. */
  scale?: readonly number[]
}

interface ThemeSpec {
  tonic: number
  scale: readonly number[]
  tempo: number
  /** Where the off-beat eighth lands inside the beat: 0.5 straight, 0.667 triplet. */
  swing: number
  phrases: Readonly<Record<string, PhraseSpec>>
  /** Eight four-bar phrases: the 32-bar AABA form. */
  form: readonly string[]
}

/*
 * The three faction themes. Melodies are written at the pitch of the reference voice (flute
 * for the elves, trumpet for the guard, bassoon for the villain); each instrument that takes
 * the line over moves it by whole octaves.
 */
const THEMES: Readonly<Record<Faction, ThemeSpec>> = {
  // «Лесная тропа» — D Dorian. A lilting svirel tune over gusli; the raised sixth (B) and
  // the major IV chord give the bright, old folk colour, and the swung eighths walk.
  elf: {
    tonic: 2,
    scale: DORIAN,
    tempo: 100,
    swing: 0.6,
    phrases: {
      A1: {
        chords: 'Dm C G Dm',
        melody: `
          A4:4 D5:2 E5:2 F5:4 E5:2 D5:2 | E5:4 C5:2 D5:2 E5:2 G5:2 E5:4 |
          D5:6 C5:2 B4:2 A4:2 G4:2 B4:2 | A4:2 G4:2 F4:2 E4:2 F4:4 A4:4`,
      },
      A2: {
        chords: 'Dm C G Am',
        melody: `
          A4:4 D5:2 E5:2 F5:4 A5:4 | G5:4 E5:2 C5:2 E5:2 G5:2 C6:4 |
          B5:4 A5:2 G5:2 D5:4 B4:4 | C5:2 B4:2 A4:12`,
      },
      A3: {
        chords: 'F C G Dm',
        melody: `
          A4:4 C5:2 D5:2 F5:4 A5:4 | G5:4 E5:2 C5:2 E5:2 G5:2 E5:4 |
          D5:4 B4:2 C5:2 B4:2 A4:2 G4:4 | F4:2 E4:2 D4:12`,
      },
      B1: {
        chords: 'F G Em Am',
        melody: `
          A5:6 G5:2 F5:4 C5:4 | B5:6 A5:2 G5:4 D5:4 |
          G5:6 F5:2 E5:4 B4:4 | C5:4 E5:4 A5:8`,
      },
      B2: {
        chords: 'F G Am A',
        melody: `
          A5:6 G5:2 F5:4 A5:4 | B5:4 D6:4 B5:4 G5:4 |
          C6:6 B5:2 A5:4 E5:4 | E5:6 C#5:2 A4:4 E4:4`,
      },
    },
    form: ['A1', 'A2', 'A1', 'A3', 'B1', 'B2', 'A1', 'A3'],
  },
  // «Дворцовый караул» — B-flat major march. Dotted bugle figures, a secondary dominant
  // on the way to the half cadence, and a lyrical horn trio in the subdominant key.
  guard: {
    tonic: 10,
    scale: MAJOR_SCALE,
    tempo: 112,
    swing: 0.5,
    phrases: {
      A1: {
        chords: 'Bb Eb Bb F',
        melody: `
          F4:3 F4:1 Bb4:4 D5:3 C5:1 Bb4:4 | Eb5:4 G5:3 F5:1 Eb5:4 Bb4:4 |
          D5:3 C5:1 D5:4 F5:4 D5:4 | C5:8 -:4 F4:3 F4:1`,
      },
      A2: {
        chords: 'Gm Eb C7 F7',
        melody: `
          Bb4:4 D5:4 G5:3 F5:1 D5:4 | Eb5:3 D5:1 Eb5:4 G5:4 Bb5:4 |
          C6:4 Bb5:4 G5:4 E5:4 | F5:6 Eb5:2 C5:4 A4:4`,
      },
      A3: {
        chords: 'Gm Eb F Bb',
        melody: `
          Bb4:4 D5:4 G5:3 F5:1 D5:4 | Eb5:3 D5:1 Eb5:4 G5:4 Eb5:4 |
          F5:4 C5:3 D5:1 C5:4 A4:4 | Bb4:4 D5:2 C5:2 Bb4:8`,
      },
      B1: {
        chords: 'Eb Ab Eb Bb',
        melody: `
          G5:8 Bb5:4 G5:4 | Ab5:8 C6:4 Ab5:4 |
          G5:6 F5:2 Eb5:4 Bb4:4 | D5:8 F5:8`,
        scale: MIXOLYDIAN,
      },
      B2: {
        chords: 'Eb Ab F7 Bb7',
        melody: `
          G5:8 Bb5:6 Ab5:2 | C6:6 Bb5:2 Ab5:4 Eb5:4 |
          F5:4 Eb5:4 C5:4 A4:4 | F5:4 D5:4 Bb4:4 Ab4:4`,
        scale: MIXOLYDIAN,
      },
    },
    form: ['A1', 'A2', 'A1', 'A3', 'B1', 'B2', 'A1', 'A3'],
  },
  // «Злодейский марш» — E harmonic minor. A bassoon creeping up the scale in staccato
  // steps, answered on the leading tone; a lament bass descending by semitones in the
  // middle; and a Phrygian F-major turn that drops back onto E every time the form loops.
  villain: {
    tonic: 4,
    scale: HARMONIC_MINOR,
    tempo: 104,
    swing: 0.54,
    phrases: {
      A1: {
        chords: 'Em B7 Em C',
        melody: `
          E3:2 F#3:2 G3:2 A3:2 B3:2 G3:2 B3:4 | F#3:2 G3:2 A3:2 B3:2 D#4:2 B3:2 D#4:4 |
          E4:2 D#4:2 E4:2 G4:2 B4:4 G4:4 | E4:4 C4:4 G3:8`,
      },
      A2: {
        chords: 'Am B7 Em F',
        melody: `
          A3:2 B3:2 C4:2 B3:2 A3:2 C4:2 E4:4 | D#4:2 E4:2 F#4:2 A4:2 B4:4 A4:4 |
          G4:4 F#4:2 E4:2 B3:4 G3:4 | A3:4 C4:2 B3:2 A3:4 F3:4`,
      },
      A3: {
        chords: 'Am B7 Em Em',
        melody: `
          A3:2 B3:2 C4:2 B3:2 A3:2 C4:2 E4:4 | D#4:2 E4:2 F#4:2 A4:2 B4:4 A4:4 |
          G4:4 F#4:2 E4:2 B3:4 D#4:4 | E4:6 B3:2 E3:8`,
      },
      B1: {
        chords: 'Em B/D# Em/D A/C#',
        melody: `
          B4:8 G4:4 E4:4 | F#4:8 D#4:4 B3:4 |
          G4:8 D4:4 B3:4 | A4:8 E4:4 C#4:4`,
      },
      B2: {
        chords: 'C B7 Em B7',
        melody: `
          C5:8 G4:4 E4:4 | B4:8 A4:4 F#4:4 |
          G4:6 F#4:2 E4:8 | F#4:4 D#4:4 B3:4 A3:4`,
      },
    },
    form: ['A1', 'A2', 'A1', 'A3', 'B1', 'B2', 'A1', 'A2'],
  },
}

interface Chord {
  symbol: string
  /** Pitch classes, root first. */
  tones: readonly number[]
  root: number
  bass: number
  third: number
  fifth: number
  seventh?: number
}

interface ScoreNote {
  midi: number
  duration: number
  ornament?: MusicOrnament
}

interface CompiledBar {
  phrase: string
  /** Which of the eight four-bar phrases of the form this bar belongs to. */
  slot: number
  barInPhrase: number
  chord: Chord
  /** Absolute pitch classes of the local mode, for ornaments and approach notes. */
  scale: readonly number[]
  /** Melody onsets indexed by step. */
  melody: readonly (ScoreNote | null)[]
  /** Voice-led pad chord. */
  voicing: readonly number[]
  /** Counter-melody guide tones for beats one and three. */
  guide: readonly [number, number]
  /** Bass note in the low register, chosen for the smoothest line. */
  bass: number
}

interface CompiledTheme {
  spec: ThemeSpec
  key: MusicKey
  bars: readonly CompiledBar[]
}

const NOTE_LETTERS: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

const CHORD_QUALITIES: Readonly<Record<string, readonly number[]>> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
}

const ORNAMENT_MARKS: Readonly<Record<string, MusicOrnament>> = {
  '~': 'mordent',
  "'": 'grace',
  ',': 'lowerGrace',
  '*': 'trill',
}

const PAD_REGISTER: readonly [number, number] = [52, 76]
const GUIDE_REGISTER: readonly [number, number] = [50, 67]
const BASS_REGISTER: readonly [number, number] = [36, 52]

function parseNoteName(name: string): number {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name)
  if (!match) throw new Error(`Music score: unknown note "${name}".`)
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0
  return (Number(match[3]) + 1) * 12 + NOTE_LETTERS[match[1]] + accidental
}

function parsePitchClass(letter: string, accidental: string): number {
  return mod(NOTE_LETTERS[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0), 12)
}

function parseChord(symbol: string): Chord {
  const match = /^([A-G])([#b]?)([a-z0-9]*)(?:\/([A-G])([#b]?))?$/.exec(symbol)
  const quality = match ? CHORD_QUALITIES[match[3]] : undefined
  if (!match || !quality) throw new Error(`Music score: unknown chord "${symbol}".`)
  const root = parsePitchClass(match[1], match[2])
  const bass = match[4] ? parsePitchClass(match[4], match[5]) : root
  const tones = quality.map((interval) => mod(root + interval, 12))
  // A slash bass outside the triad (Em/D) is part of the harmony: it sounds as a seventh.
  if (!tones.includes(bass)) tones.push(bass)
  return {
    symbol,
    tones,
    root,
    bass,
    third: tones[1],
    fifth: tones[2],
    ...(tones.length > 3 ? { seventh: tones[3] } : {}),
  }
}

/** Parses a phrase into onsets per step, checking that every bar line falls on a bar. */
function parseMelody(text: string, bars: number, label: string): (ScoreNote | null)[] {
  const steps: (ScoreNote | null)[] = Array.from({ length: bars * MUSIC_STEPS_PER_BAR }, () => null)
  let cursor = 0
  for (const token of text.trim().split(/\s+/)) {
    if (token === '|') {
      if (cursor % MUSIC_STEPS_PER_BAR !== 0) {
        throw new Error(`Music score: ${label} has a bar line at step ${cursor}.`)
      }
      continue
    }
    const match = /^(-|[A-G][#b]?-?\d)([~',*]?):(\d+)$/.exec(token)
    if (!match) throw new Error(`Music score: ${label} cannot read "${token}".`)
    const duration = Number(match[3])
    if (match[1] !== '-') {
      steps[cursor] = {
        midi: parseNoteName(match[1]),
        duration,
        ...(match[2] ? { ornament: ORNAMENT_MARKS[match[2]] } : {}),
      }
    }
    cursor += duration
  }
  if (cursor !== steps.length) {
    throw new Error(`Music score: ${label} lasts ${cursor} steps instead of ${steps.length}.`)
  }
  return steps
}

function compileTheme(spec: ThemeSpec, label: string): CompiledTheme {
  const bars: Omit<CompiledBar, 'voicing' | 'guide' | 'bass'>[] = []
  spec.form.forEach((name, slot) => {
    const phrase = spec.phrases[name]
    if (!phrase) throw new Error(`Music score: ${label} has no phrase "${name}".`)
    const chords = phrase.chords.trim().split(/\s+/).map(parseChord)
    if (chords.length !== 4) throw new Error(`Music score: ${label} ${name} needs four chords.`)
    const melody = parseMelody(phrase.melody, 4, `${label} ${name}`)
    const scale = (phrase.scale ?? spec.scale).map((interval) => mod(spec.tonic + interval, 12))
    for (let barInPhrase = 0; barInPhrase < 4; barInPhrase += 1) {
      const start = barInPhrase * MUSIC_STEPS_PER_BAR
      bars.push({
        phrase: name,
        slot,
        barInPhrase,
        chord: chords[barInPhrase],
        scale,
        melody: melody.slice(start, start + MUSIC_STEPS_PER_BAR),
      })
    }
  })
  if (bars.length !== MUSIC_BARS_PER_CYCLE) {
    throw new Error(`Music score: ${label} form lasts ${bars.length} bars.`)
  }
  const chords = bars.map((bar) => bar.chord)
  const voicings = voiceLead(chords)
  const guides = guideLine(chords)
  const basses = bassLine(chords)
  return {
    spec,
    key: { tonic: spec.tonic, scale: spec.scale },
    bars: bars.map((bar, index) => ({
      ...bar,
      voicing: voicings[index],
      guide: guides[index],
      bass: basses[index],
    })),
  }
}

/**
 * Four-voice pad chords that move as little as possible from bar to bar, with the root,
 * third and any seventh always present and a mild pull back toward the middle of the register.
 */
function voiceLead(chords: readonly Chord[]): number[][] {
  const [low, high] = PAD_REGISTER
  const centre = (low + high) / 2
  const result: number[][] = []
  let previous: number[] | null = null
  for (const chord of chords) {
    const candidates: number[] = []
    for (let midi = low; midi <= high; midi += 1) {
      if (chord.tones.includes(mod(midi, 12))) candidates.push(midi)
    }
    const search = { best: null as number[] | null, score: Number.POSITIVE_INFINITY }
    const required = [chord.root, chord.third, ...(chord.seventh === undefined ? [] : [chord.seventh])]
    const combination: number[] = []
    const visit = (start: number) => {
      if (combination.length === 4) {
        const pitchClasses = combination.map((midi) => mod(midi, 12))
        if (!required.every((tone) => pitchClasses.includes(tone))) return
        for (let index = 1; index < 4; index += 1) {
          if (combination[index] - combination[index - 1] < 2) return
        }
        if (combination[3] - combination[0] > 19) return
        const mean = combination.reduce((sum, midi) => sum + midi, 0) / 4
        let score = Math.abs(mean - centre) * (previous ? 0.35 : 2)
        if (previous) {
          for (let index = 0; index < 4; index += 1) score += Math.abs(combination[index] - previous[index])
        }
        // A doubled third thickens the chord; a doubled root or fifth does not.
        if (pitchClasses.filter((tone) => tone === chord.third).length > 1) score += 2
        if (score < search.score) {
          search.score = score
          search.best = [...combination]
        }
        return
      }
      for (let index = start; index < candidates.length; index += 1) {
        combination.push(candidates[index])
        visit(index + 1)
        combination.pop()
      }
    }
    visit(0)
    const best = search.best
    if (!best) throw new Error(`Music score: no pad voicing for ${chord.symbol}.`)
    result.push(best)
    previous = best
  }
  return result
}

/** A counter-line of thirds and sevenths that resolve by step, two notes per bar. */
function guideLine(chords: readonly Chord[]): [number, number][] {
  const [low, high] = GUIDE_REGISTER
  let previous = Math.round((low + high) / 2)
  return chords.map((chord) => {
    const targets = [chord.third, chord.seventh ?? chord.fifth]
    const first = nearestPitch(previous, targets, low, high)
    const others = chord.tones.filter((tone) => tone !== mod(first, 12))
    const second = nearestPitch(first + (first > (low + high) / 2 ? -1 : 1), others, low, high)
    previous = second
    return [first, second]
  })
}

function bassLine(chords: readonly Chord[]): number[] {
  const [low, high] = BASS_REGISTER
  let previous = low + 6
  return chords.map((chord) => {
    const note = nearestPitch(previous, [chord.bass], low, high)
    previous = note
    return note
  })
}

/** The pitch with one of `pitchClasses` nearest `reference` inside `[low, high]`. */
function nearestPitch(
  reference: number,
  pitchClasses: readonly number[],
  low: number,
  high: number,
): number {
  let best = low
  let bestDistance = Number.POSITIVE_INFINITY
  for (let midi = low; midi <= high; midi += 1) {
    if (!pitchClasses.includes(mod(midi, 12))) continue
    const distance = Math.abs(midi - reference)
    if (distance < bestDistance) {
      best = midi
      bestDistance = distance
    }
  }
  return best
}

const COMPILED_THEMES: Readonly<Record<Faction, CompiledTheme>> = {
  elf: compileTheme(THEMES.elf, 'elf'),
  guard: compileTheme(THEMES.guard, 'guard'),
  villain: compileTheme(THEMES.villain, 'villain'),
}

type PluckStyle = 'roll' | 'strum' | 'sparkle' | 'pizz'

interface Doubling {
  instrument: MusicInstrument
  octave: number
  level: number
}

interface Ensemble {
  lead: MusicInstrument
  leadOctave: number
  double?: Doubling
  counter: MusicInstrument
  /** Octave the counter voice uses when it takes the tune over in exploration. */
  echoOctave: number
  pad: MusicInstrument
  /** Bayan chords pulse on the off-beats instead of sustaining. */
  padPulse: boolean
  padTop?: MusicInstrument
  bass: MusicInstrument
  pluck: MusicInstrument
  pluckStyle: PluckStyle
  pluckRegister: readonly [number, number]
  chime: MusicInstrument
}

interface Plan {
  context: MusicContext
  theme: CompiledTheme
  bar: CompiledBar
  nextBar: CompiledBar
  barIndex: number
  stepInBar: number
  /** Pass through the form, so repeats can be ornamented and thinned differently. */
  cycle: number
  variation: number
  rank: number
  seed: number
  ensemble: Ensemble
}

/** Each region has its own folk colour: gusli woods, balalaika roads, celesta halls, pizzicato walls. */
const ZONE_PLUCKS: Readonly<
  Record<ZoneId, { instrument: MusicInstrument; style: PluckStyle; register: readonly [number, number] }>
> = {
  forest: { instrument: 'gusli', style: 'roll', register: [57, 84] },
  neutral: { instrument: 'balalaika', style: 'strum', register: [62, 86] },
  palace: { instrument: 'celesta', style: 'sparkle', register: [72, 96] },
  fort: { instrument: 'pizzicato', style: 'pizz', register: [45, 69] },
}

export function getMusicTempo(faction: Faction, outcome: MusicOutcome = 'none'): number {
  if (outcome !== 'none') return OUTCOME_THEMES[outcome].tempo
  return THEMES[faction].tempo
}

/** Off-beat placement of the faction's eighths; outcome pieces are played straight. */
export function getMusicSwing(faction: Faction, outcome: MusicOutcome = 'none'): number {
  if (outcome !== 'none') return 0.5
  return THEMES[faction].swing
}

/** The key the score is in, so musical cues can be tuned to it. */
export function getMusicKey(context: Pick<MusicContext, 'faction' | 'outcome'>): MusicKey {
  if (context.outcome === 'victory') return { tonic: 7, scale: MAJOR_SCALE }
  if (context.outcome === 'defeat') return { tonic: 2, scale: NATURAL_MINOR_SCALE }
  return COMPILED_THEMES[context.faction].key
}

/** Per bar of the adaptive form: the chord's pitch classes and the local mode. */
export function getMusicHarmony(
  faction: Faction,
): readonly { chord: string; chordTones: readonly number[]; scale: readonly number[] }[] {
  return COMPILED_THEMES[faction].bars.map((bar) => ({
    chord: bar.chord.symbol,
    chordTones: bar.chord.tones,
    scale: bar.scale,
  }))
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
  const cycle = Math.floor(step / MUSIC_CYCLE_STEPS)
  const stepInCycle = step % MUSIC_CYCLE_STEPS
  const barIndex = Math.floor(stepInCycle / MUSIC_STEPS_PER_BAR)
  const theme = COMPILED_THEMES[context.faction]
  const rank = musicIntensityRank(context.intensity)
  const plan: Plan = {
    context,
    theme,
    bar: theme.bars[barIndex],
    nextBar: theme.bars[(barIndex + 1) % MUSIC_BARS_PER_CYCLE],
    barIndex,
    stepInBar: stepInCycle % MUSIC_STEPS_PER_BAR,
    cycle,
    variation: cycle * MUSIC_BARS_PER_CYCLE + barIndex,
    rank,
    seed: normalizeSeed(requestedSeed),
    ensemble: ensembleFor(context, rank),
  }
  const events: MusicEvent[] = []
  planPad(events, plan)
  planBass(events, plan)
  planLead(events, plan)
  planCounter(events, plan)
  planPluck(events, plan)
  planChime(events, plan)
  planPercussion(events, plan)
  return events
}

/**
 * The downbeat that announces a rise in danger: a soft tom and timpani when the player is
 * spotted, a cymbal and timpani when the fight starts, a gong for the villain's boss.
 * Hits the new groove already plays on that downbeat are left to it, so nothing doubles.
 * Falling intensity needs no accent; the layers simply thin out.
 */
export function planMusicTransition(
  previousContext: MusicContext,
  nextContext: MusicContext,
  step: number,
): readonly MusicEvent[] {
  const previous = normalizeMusicContext(previousContext)
  const next = normalizeMusicContext(nextContext)
  if (previous.outcome !== 'none' || next.outcome !== 'none') return []
  const from = musicIntensityRank(previous.intensity)
  const to = musicIntensityRank(next.intensity)
  if (to <= from) return []
  const stepInCycle = normalizeStep(step) % MUSIC_CYCLE_STEPS
  const bar = COMPILED_THEMES[next.faction].bars[Math.floor(stepInCycle / MUSIC_STEPS_PER_BAR)]
  // Percussion does not depend on the seed, so this is exactly what the new groove plays here.
  const groove = new Set(
    planMusicStep(next, stepInCycle, 0).flatMap((event) => (event.kind === 'drum' ? [event.drum] : [])),
  )
  const events: MusicEvent[] = []
  const accent = (drum: MusicDrum, velocity: number, pan: number, midi?: number) => {
    if (!groove.has(drum)) addDrum(events, drum, velocity, pan, midi)
  }
  if (to === 1) {
    accent('tom', 0.42, -0.16, 41)
    accent('timpani', 0.32, 0, timpaniPitch(bar.chord.root))
    return events
  }
  accent('crash', to === 3 ? 0.86 : 0.7, 0.18)
  accent('timpani', to === 3 ? 0.8 : 0.62, 0, timpaniPitch(bar.chord.root))
  if (to === 3 && next.faction === 'villain') accent('gong', 0.72, -0.12)
  return events
}

/** Every instrument the score can ask for in a faction's region, across all intensities. */
export function musicEnsembleInstruments(
  context: Pick<MusicContext, 'faction' | 'zone'>,
): MusicInstrument[] {
  const instruments = new Set<MusicInstrument>()
  for (let rank = 0; rank <= 3; rank += 1) {
    const ensemble = ensembleFor({ ...DEFAULT_MUSIC_CONTEXT, faction: context.faction, zone: context.zone }, rank)
    for (const instrument of [
      ensemble.lead,
      ensemble.double?.instrument,
      ensemble.counter,
      ensemble.pad,
      ensemble.padTop,
      ensemble.bass,
      ensemble.pluck,
      ensemble.chime,
    ]) {
      if (instrument) instruments.add(instrument)
    }
  }
  return [...instruments]
}

function ensembleFor(context: MusicContext, rank: number): Ensemble {
  const { faction, zone } = context
  const pluck = ZONE_PLUCKS[zone]
  return {
    ...leadFor(faction, rank),
    counter: faction === 'guard' && rank >= 2 ? 'horn' : 'cello',
    echoOctave: faction === 'villain' ? 0 : -12,
    pad: zone === 'neutral' ? 'bayan' : faction === 'villain' && zone === 'palace' ? 'organ' : 'strings',
    padPulse: zone === 'neutral',
    padTop: rank >= 3 ? 'choir' : rank === 2 && zone === 'fort' ? 'horn' : undefined,
    bass:
      faction === 'elf'
        ? 'uprightBass'
        : faction === 'guard'
          ? rank === 0 ? 'contrabass' : 'lowBrass'
          : rank === 0 ? 'pizzicato' : 'contrabass',
    pluck: pluck.instrument,
    pluckStyle: pluck.style,
    pluckRegister: pluck.register,
    chime: faction === 'villain' ? 'churchBell' : 'glockenspiel',
  }
}

/** Who carries the tune: svirel, horn turning trumpet, bassoon turning trombone and choir. */
function leadFor(faction: Faction, rank: number): Pick<Ensemble, 'lead' | 'leadOctave' | 'double'> {
  if (faction === 'elf') {
    if (rank >= 3) {
      return { lead: 'flute', leadOctave: 0, double: { instrument: 'horn', octave: -12, level: 0.6 } }
    }
    if (rank === 2) {
      return { lead: 'flute', leadOctave: 0, double: { instrument: 'reed', octave: -12, level: 0.5 } }
    }
    return { lead: 'flute', leadOctave: 0 }
  }
  if (faction === 'guard') {
    if (rank >= 3) {
      return {
        lead: 'trumpet',
        leadOctave: 0,
        double: { instrument: 'lowBrass', octave: -12, level: 0.55 },
      }
    }
    if (rank === 2) {
      return { lead: 'trumpet', leadOctave: 0, double: { instrument: 'horn', octave: -12, level: 0.55 } }
    }
    return { lead: 'horn', leadOctave: -12 }
  }
  if (rank >= 3) {
    return { lead: 'lowBrass', leadOctave: 0, double: { instrument: 'choir', octave: 12, level: 0.6 } }
  }
  if (rank === 2) {
    return { lead: 'lowBrass', leadOctave: 0, double: { instrument: 'reed', octave: 12, level: 0.48 } }
  }
  return { lead: 'reed', leadOctave: 0 }
}

const PAD_PANS: readonly number[] = [-0.34, -0.12, 0.12, 0.34]

function planPad(events: MusicEvent[], plan: Plan): void {
  const { bar, stepInBar, rank, ensemble } = plan
  if (ensemble.padPulse && rank >= 1) {
    // Bayan chords on the off-beats against the bass: the "pah" of a village dance.
    const pulses = rank === 1 ? [4, 12] : [2, 6, 10, 14]
    if (!pulses.includes(stepInBar)) return
    const velocity = rank === 1 ? 0.5 : rank === 2 ? 0.56 : 0.62
    bar.voicing.slice(1).forEach((midi, index) => {
      addTone(events, 'pad', 'bayan', midi, 1.5, velocity * (index === 2 ? 0.92 : 1), PAD_PANS[index + 1])
    })
    return
  }
  if (stepInBar !== 0) return
  const velocity = [0.5, 0.52, 0.54, 0.58][rank]
  bar.voicing.forEach((midi, index) => {
    addTone(events, 'pad', ensemble.pad, midi, 16, velocity * (index === 0 ? 0.92 : 1), PAD_PANS[index])
  })
  if (ensemble.padTop === 'horn') {
    bar.voicing.slice(2).forEach((midi, index) => {
      addTone(events, 'pad', 'horn', fitRange(midi, 'horn'), 16, 0.46, index === 0 ? -0.22 : 0.22)
    })
  } else if (ensemble.padTop === 'choir') {
    bar.voicing.slice(1).forEach((midi, index) => {
      addTone(events, 'pad', 'choir', fitRange(midi + 12, 'choir'), 16, 0.5, PAD_PANS[index + 1] * 0.8)
    })
  }
}

type BassNote = 'root' | 'fifth' | 'low' | 'octave' | 'approach'
type BassHit = readonly [step: number, note: BassNote, duration: number, velocity: number]

const BASS_EXPLORE: readonly BassHit[] = [[0, 'root', 14, 0.6]]
const BASS_EXPLORE_TURN: readonly BassHit[] = [[0, 'root', 12, 0.6], [12, 'approach', 4, 0.5]]
const BASS_ALERT: Readonly<Record<Faction, readonly BassHit[]>> = {
  elf: [[0, 'root', 4, 0.66], [4, 'root', 3, 0.42], [8, 'fifth', 4, 0.58], [12, 'root', 3, 0.48]],
  guard: [[0, 'root', 6, 0.7], [8, 'low', 6, 0.6]],
  villain: [
    [0, 'root', 3, 0.68],
    [3, 'root', 1.5, 0.42],
    [8, 'fifth', 3, 0.6],
    [11, 'root', 1.5, 0.42],
    [14, 'approach', 2, 0.5],
  ],
}
const BASS_GROOVES: Readonly<Record<Faction, readonly BassHit[]>> = {
  // Folk bounce: root, swung fifth, octave and a step into the next chord.
  elf: [
    [0, 'root', 4, 0.86],
    [6, 'fifth', 2, 0.58],
    [8, 'octave', 2, 0.7],
    [10, 'fifth', 2, 0.55],
    [12, 'root', 2, 0.72],
    [14, 'approach', 2, 0.6],
  ],
  // Tuba oom-pah: root and the fifth below on every beat.
  guard: [
    [0, 'root', 3, 0.9],
    [4, 'low', 3, 0.7],
    [8, 'root', 3, 0.84],
    [12, 'low', 3, 0.7],
  ],
  // Driving eighths with octave kicks and a chromatic lean into the next bar.
  villain: [
    [0, 'root', 1.6, 0.8],
    [2, 'root', 1.6, 0.48],
    [4, 'octave', 1.6, 0.6],
    [6, 'root', 1.6, 0.48],
    [8, 'root', 1.6, 0.74],
    [10, 'root', 1.6, 0.48],
    [12, 'octave', 1.6, 0.6],
    [14, 'approach', 1.6, 0.56],
  ],
}
const BASS_BOSS_PUSH: readonly BassHit[] = [[7, 'root', 1, 0.52], [15, 'approach', 1, 0.56]]
const VILLAIN_EXPLORE_BASS: readonly BassHit[] = [[0, 'root', 2, 0.72], [8, 'fifth', 2, 0.6]]

function planBass(events: MusicEvent[], plan: Plan): void {
  const { bar, stepInBar, rank, context, ensemble } = plan
  let pattern: readonly BassHit[]
  if (rank === 0) {
    pattern =
      context.faction === 'villain'
        ? VILLAIN_EXPLORE_BASS
        : bar.barInPhrase === 3 ? BASS_EXPLORE_TURN : BASS_EXPLORE
  } else if (rank === 1) {
    pattern = BASS_ALERT[context.faction]
  } else {
    pattern = BASS_GROOVES[context.faction]
  }
  const boost = rank === 3 ? 0.06 : 0
  for (const [step, note, duration, velocity] of pattern) {
    if (step !== stepInBar) continue
    addTone(events, 'bass', ensemble.bass, fitRange(bassPitch(plan, note), ensemble.bass), duration, velocity + boost, 0)
  }
  if (rank === 3) {
    for (const [step, note, duration, velocity] of BASS_BOSS_PUSH) {
      if (step !== stepInBar) continue
      addTone(events, 'bass', ensemble.bass, fitRange(bassPitch(plan, note), ensemble.bass), duration, velocity, 0)
    }
  }
}

function bassPitch(plan: Plan, note: BassNote): number {
  const { bar, nextBar, context } = plan
  const root = bar.bass
  if (note === 'root') return root
  if (note === 'octave') return root + 12
  if (note === 'fifth') return pitchAbove(root, bar.chord.fifth)
  if (note === 'low') {
    const below = pitchBelow(root, bar.chord.fifth)
    return below >= 31 ? below : pitchAbove(root, bar.chord.fifth)
  }
  const target = nextBar.bass
  if (context.faction === 'villain') {
    // Lean into the next bass note from whichever neighbour in the mode is closest — in
    // harmonic minor that is often a semitone, which is where the menace comes from.
    const below = scaleNeighbor(target, -1, bar.scale)
    const above = scaleNeighbor(target, 1, bar.scale)
    return target - below <= above - target ? below : above
  }
  if (target === root) return scaleNeighbor(root, 1, bar.scale)
  return scaleNeighbor(target, target > root ? -1 : 1, bar.scale)
}

function planLead(events: MusicEvent[], plan: Plan): void {
  const { bar, stepInBar, ensemble } = plan
  const note = bar.melody[stepInBar]
  if (!note || leadRests(plan)) return
  const velocity = leadVelocity(plan)
  const duration = articulate(plan, note)
  const midi = fitRange(note.midi + ensemble.leadOctave, ensemble.lead)
  const ornament = fitOrnament(midi, chooseOrnament(plan, note), bar.scale, ensemble.lead)
  addTone(events, 'lead', ensemble.lead, midi, duration, velocity, -0.06, ornament)
  const double = ensemble.double
  if (double) {
    addTone(
      events,
      'lead',
      double.instrument,
      fitRange(note.midi + double.octave, double.instrument),
      duration,
      velocity * double.level,
      0.18,
    )
  }
}

/**
 * Exploration breathes: on even passes the tune rests through the B section, on odd passes
 * through the opening A phrases, where the counter voice takes it instead.
 */
function leadRests(plan: Plan): boolean {
  if (plan.rank > 0) return false
  const slot = plan.bar.slot
  return plan.cycle % 2 === 0 ? slot === 4 || slot === 5 : slot === 0 || slot === 1
}

function leadVelocity(plan: Plan): number {
  const { rank, stepInBar, bar } = plan
  // The bassoon's staccato carries less energy than a held line, so it is played out more.
  const base =
    [0.62, 0.7, 0.84, 0.94][rank] + (plan.context.faction === 'villain' ? (rank <= 1 ? 0.1 : -0.08) : 0)
  const accent =
    stepInBar === 0 ? 0.05 : stepInBar === 8 ? 0.025 : stepInBar % 4 === 0 ? 0 : -0.04
  const arc = bar.barInPhrase === 2 ? 0.03 : bar.barInPhrase === 3 ? -0.02 : 0
  const humanize = (seededUnit(plan.seed, plan.variation, 0x3f + stepInBar) - 0.5) * 0.06
  return base + accent + arc + humanize
}

function articulate(plan: Plan, note: ScoreNote): number {
  const { context, rank } = plan
  let duration = note.duration
  if (context.faction === 'villain' && rank <= 1) {
    // The bassoon tiptoes: short notes are detached, long ones barely.
    duration = note.duration <= 2 ? 0.9 : note.duration * 0.88
  } else if (context.faction === 'guard') {
    duration = note.duration <= 3 ? note.duration * 0.78 : note.duration * 0.92
  } else if (rank >= 2) {
    duration = note.duration * 0.92
  } else {
    duration = note.duration * 0.98
  }
  return Math.max(0.5, Math.min(MUSIC_STEPS_PER_BAR, duration))
}

/**
 * Pairs an ornament with its neighbour note. At the edge of an instrument's register the
 * decoration turns the other way, and is dropped if neither neighbour can be played.
 */
function fitOrnament(
  midi: number,
  ornament: MusicOrnament | undefined,
  scale: readonly number[],
  instrument: MusicInstrument,
): ToneExtras | undefined {
  if (!ornament) return undefined
  if (ornament === 'tremolo') return { ornament }
  const [low, high] = MUSIC_INSTRUMENT_RANGES[instrument]
  const directions: readonly (1 | -1)[] = ornament === 'lowerGrace' ? [-1, 1] : [1, -1]
  for (const direction of directions) {
    const neighbour = scaleNeighbor(midi, direction, scale)
    if (neighbour >= low && neighbour <= high) return { ornament, ornamentMidi: neighbour }
  }
  return undefined
}

function chooseOrnament(plan: Plan, note: ScoreNote): MusicOrnament | undefined {
  if (note.ornament) return note.ornament
  if (note.duration < 4) return undefined
  const roll = seededUnit(plan.seed, plan.variation, 0x51 + plan.stepInBar)
  if (plan.context.faction === 'elf') {
    if (roll < 0.18) return 'mordent'
    if (roll < 0.28) return 'grace'
    if (roll < 0.33 && note.duration >= 8) return 'trill'
    return undefined
  }
  if (plan.context.faction === 'guard') return roll < 0.12 ? 'lowerGrace' : undefined
  if (roll < 0.14) return 'lowerGrace'
  return roll < 0.22 ? 'mordent' : undefined
}

function planCounter(events: MusicEvent[], plan: Plan): void {
  const { bar, stepInBar, rank, ensemble, cycle } = plan
  if (rank === 0) {
    if (cycle % 2 === 1 && (bar.slot === 0 || bar.slot === 1)) {
      const note = bar.melody[stepInBar]
      if (note) {
        addTone(
          events,
          'counter',
          ensemble.counter,
          fitRange(note.midi + ensemble.echoOctave, ensemble.counter),
          Math.min(MUSIC_STEPS_PER_BAR, note.duration),
          0.5,
          0.16,
        )
      }
    }
    return
  }
  if (rank === 1) {
    if (stepInBar === 0) {
      addTone(events, 'counter', ensemble.counter, fitRange(bar.guide[0], ensemble.counter), 16, 0.4, 0.2)
    }
    return
  }
  if (stepInBar === 0 || stepInBar === 8) {
    const midi = bar.guide[stepInBar === 0 ? 0 : 1]
    addTone(events, 'counter', ensemble.counter, fitRange(midi, ensemble.counter), 8, rank === 2 ? 0.54 : 0.62, 0.2)
  }
}

function planPluck(events: MusicEvent[], plan: Plan): void {
  const { ensemble, stepInBar: step, rank, bar, cycle } = plan
  const [low, high] = ensemble.pluckRegister
  const pool: number[] = []
  for (let midi = low; midi <= high; midi += 1) {
    if (bar.chord.tones.includes(mod(midi, 12))) pool.push(midi)
  }
  const last = pool.length - 1
  const at = (index: number) => pool[Math.max(0, Math.min(last, index))]
  const reverse = cycle % 2 === 1
  const pan = (index: number) => -0.3 + (index / Math.max(1, last)) * 0.6
  const pluck = (index: number, duration: number, velocity: number, extras?: ToneExtras) =>
    addTone(events, 'pluck', ensemble.pluck, at(index), duration, velocity, pan(index), extras)

  if (ensemble.pluckStyle === 'roll') {
    if (rank === 0) {
      if (step <= 6 && step % 2 === 0) pluck(step / 2, 6, 0.4)
      if (bar.barInPhrase === 3 && step >= 8 && step % 2 === 0) pluck(4 - (step - 8) / 2, 6, 0.36)
    } else if (rank === 1) {
      if (step % 2 === 0) {
        const broken = [0, 2, 1, 3, 2, 4, 3, 5][step / 2]
        pluck(reverse ? last - broken : broken, 4, 0.42)
      }
    } else {
      const index = triangleIndex(step, last)
      pluck(reverse ? last - index : index, 2.5, (rank === 3 ? 0.48 : 0.42) + (step % 4 === 0 ? 0.08 : 0))
    }
    return
  }

  if (ensemble.pluckStyle === 'strum') {
    const strum = (indices: readonly number[], duration: number, velocity: number) => {
      indices.forEach((index, order) => pluck(index, duration, velocity, { offsetSteps: order * 0.07 }))
    }
    if (rank === 0) {
      if (step === 0 && plan.barIndex % 2 === 0) pluck(last - 1, 8, 0.36, { ornament: 'tremolo' })
      if (plan.barIndex % 2 === 1 && (step === 0 || step === 8)) pluck(step === 0 ? 2 : 1, 4, 0.38)
    } else if (rank === 1) {
      if (step % 4 === 2) strum([last - 1, last], 1.5, 0.42)
    } else {
      if (step % 4 === 0) pluck(0, 1.5, 0.5)
      if (step % 4 === 2) strum([1, 2, 3], 1.5, rank === 3 ? 0.48 : 0.44)
      if (rank === 3 && step === 8) pluck(last, 6, 0.4, { ornament: 'tremolo' })
    }
    return
  }

  if (ensemble.pluckStyle === 'sparkle') {
    if (rank === 0) {
      if (step === 0) pluck(last, 8, 0.34)
      if (step === 6) pluck(last - 2, 8, 0.3)
      if (step === 12) pluck(last - 1, 6, 0.3)
    } else if (rank === 1) {
      if (step % 2 === 0) pluck(reverse ? last - step / 2 : step / 2, 4, 0.34)
    } else if (rank === 2) {
      if (step % 2 === 0 || step >= 12) pluck(last - (step % 8), 3, step % 4 === 0 ? 0.42 : 0.36)
    } else {
      pluck(triangleIndex(step, last), 2.5, step % 4 === 0 ? 0.44 : 0.38)
    }
    return
  }

  // Pizzicato.
  const figure = [0, 2, 1, 2]
  if (rank === 0) {
    if (step === 0 || step === 8) pluck(step === 0 ? 0 : 2, 2, 0.44)
  } else if (rank === 1) {
    if (step % 2 === 0) pluck(figure[(step / 2) % 4] + (step >= 8 ? 1 : 0), 1.5, 0.44)
  } else if (rank === 2) {
    if (step % 2 === 0) pluck(figure[(step / 2) % 4] + (step >= 8 ? 1 : 0), 1.5, step % 4 === 0 ? 0.56 : 0.48)
    if (step === 7 || step === 15) pluck(step === 7 ? 1 : 2, 1, 0.42)
  } else {
    pluck(figure[step % 4] + (step >= 8 ? 1 : 0), 1, step % 4 === 0 ? 0.56 : 0.44)
  }
}

function planChime(events: MusicEvent[], plan: Plan): void {
  const { bar, stepInBar, rank, ensemble, context } = plan
  if (ensemble.chime === 'churchBell') {
    // The villain's bell tolls the chord root: at phrase starts in a fight, every bar for the boss.
    const toll = stepInBar === 0 && (rank === 3 || (rank === 2 && bar.barInPhrase === 0))
    if (toll) {
      addTone(events, 'chime', 'churchBell', nearestPitch(58, [bar.chord.root], 52, 64), 12, rank === 3 ? 0.5 : 0.42, 0.1)
    }
    return
  }
  if (rank < 1 || stepInBar !== 0) return
  const note = bar.melody[0]
  const accent =
    rank >= 2 ? bar.barInPhrase % 2 === 0 : bar.barInPhrase === 0 && context.zone === 'palace'
  if (accent && note) {
    addTone(events, 'chime', 'glockenspiel', fitRange(note.midi + 12, 'glockenspiel'), 8, rank === 3 ? 0.4 : 0.32, 0.3)
  }
}

type DrumHit = readonly [drum: MusicDrum, step: number, velocity: number, pan: number]

const FACTION_GROOVES: Readonly<Record<Faction, readonly DrumHit[]>> = {
  // Village dance: bass drum, бубен on the backbeat, a swung shaker and a frame-drum lift.
  elf: [
    ['kick', 0, 0.88, 0],
    ['kick', 8, 0.72, 0],
    ['kick', 11, 0.42, 0],
    ['tambourine', 4, 0.6, 0.22],
    ['tambourine', 12, 0.62, 0.22],
    ['shaker', 2, 0.3, -0.32],
    ['shaker', 6, 0.3, -0.32],
    ['shaker', 10, 0.3, -0.32],
    ['shaker', 14, 0.3, -0.32],
    ['frameDrum', 6, 0.36, -0.12],
    ['frameDrum', 14, 0.3, -0.12],
  ],
  // Parade ground: bass drum on one and three, a field snare's march rudiments, cymbal ticks.
  guard: [
    ['kick', 0, 0.92, 0],
    ['kick', 8, 0.84, 0],
    ['snare', 0, 0.62, 0.1],
    ['snare', 2, 0.28, 0.1],
    ['snare', 4, 0.72, 0.1],
    ['snare', 6, 0.32, 0.1],
    ['snare', 7, 0.26, 0.1],
    ['snare', 8, 0.6, 0.1],
    ['snare', 10, 0.28, 0.1],
    ['snare', 12, 0.72, 0.1],
    ['snare', 13, 0.3, 0.1],
    ['snare', 14, 0.46, 0.1],
    ['snare', 15, 0.36, 0.1],
    ['hat', 4, 0.32, -0.28],
    ['hat', 12, 0.32, -0.28],
  ],
  // Forge and war drum: a syncopated low pattern, a heavy backbeat and an anvil on the turn.
  villain: [
    ['kick', 0, 0.82, 0],
    ['kick', 3, 0.44, 0],
    ['kick', 6, 0.52, 0],
    ['kick', 8, 0.72, 0],
    ['kick', 11, 0.42, 0],
    ['kick', 14, 0.46, 0],
    ['snare', 4, 0.6, 0.08],
    ['snare', 12, 0.64, 0.08],
    ['hat', 2, 0.2, -0.3],
    ['hat', 6, 0.2, -0.3],
    ['hat', 10, 0.2, -0.3],
    ['hat', 14, 0.2, -0.3],
    ['anvil', 14, 0.3, 0.3],
  ],
}

function planPercussion(events: MusicEvent[], plan: Plan): void {
  if (plan.rank === 0) planExplorePercussion(events, plan)
  else if (plan.rank === 1) planAlertPercussion(events, plan)
  else planGroove(events, plan)
  if (plan.rank >= 1) planThreatPulse(events, plan)
}

function planExplorePercussion(events: MusicEvent[], plan: Plan): void {
  const { stepInBar: step, bar, barIndex, context } = plan
  if (context.zone === 'forest') {
    if (step === 6 || step === 14) addDrum(events, 'shaker', 0.2, step === 6 ? -0.3 : 0.3)
    if (step === 0 && barIndex % 2 === 0) addDrum(events, 'frameDrum', 0.3, -0.1)
  } else if (context.zone === 'neutral') {
    // The caravan's harness bells, somewhere down the road.
    if (step === 0 && barIndex % 2 === 0) addDrum(events, 'sleighBells', 0.24, 0.26)
    if (step === 8 && barIndex % 2 === 1) addDrum(events, 'sleighBells', 0.16, -0.26)
  } else if (context.zone === 'palace') {
    if (step === 0 && bar.barInPhrase === 0) {
      addDrum(events, 'timpani', 0.24, 0, timpaniPitch(bar.chord.root))
    }
  } else {
    if (step === 12 && barIndex % 2 === 1) addDrum(events, 'snare', 0.15, 0.12)
    if (step === 0 && bar.barInPhrase === 0) {
      addDrum(events, 'timpani', 0.3, 0, timpaniPitch(bar.chord.root))
    }
  }
}

function planAlertPercussion(events: MusicEvent[], plan: Plan): void {
  const { stepInBar: step, bar, context } = plan
  // A heartbeat under everything once someone has noticed the player.
  if (step === 0) addDrum(events, 'kick', 0.5, 0)
  if (step === 2) addDrum(events, 'kick', 0.32, 0)
  if (bar.barInPhrase === 3 && (step === 12 || step === 14)) {
    addDrum(events, 'tom', step === 12 ? 0.3 : 0.36, step === 12 ? -0.2 : 0.2, step === 12 ? 45 : 41)
  }
  if (context.zone === 'forest') {
    if (step % 4 === 2) addDrum(events, 'shaker', 0.22, step % 8 === 2 ? -0.3 : 0.3)
    if (step === 8) addDrum(events, 'frameDrum', 0.3, -0.1)
  } else if (context.zone === 'neutral') {
    if (step === 4 || step === 12) addDrum(events, 'tambourine', 0.26, 0.24)
    if (step === 0) addDrum(events, 'sleighBells', 0.2, -0.26)
  } else if (context.zone === 'palace') {
    if (step === 0 && bar.barInPhrase % 2 === 0) {
      addDrum(events, 'timpani', 0.34, 0, timpaniPitch(bar.chord.root))
    }
  } else {
    if (step === 4 || step === 12) addDrum(events, 'snare', step === 4 ? 0.18 : 0.22, 0.12)
    if (step === 14) addDrum(events, 'snare', 0.12, 0.12)
  }
}

function planGroove(events: MusicEvent[], plan: Plan): void {
  const { stepInBar: step, bar, rank, context, barIndex } = plan
  const boss = rank === 3
  const guardRoll = context.faction === 'guard' && bar.barInPhrase === 3
  for (const [drum, hitStep, velocity, pan] of FACTION_GROOVES[context.faction]) {
    if (hitStep !== step) continue
    if (drum === 'anvil' && bar.barInPhrase !== 1) continue
    if (drum === 'snare' && guardRoll && hitStep >= 8) continue
    addDrum(events, drum, velocity + (boss ? 0.05 : 0), pan)
  }
  planZoneColour(events, plan)
  if (bar.barInPhrase === 3) planFill(events, plan)
  if (step === 0 && bar.barInPhrase === 0 && (boss || bar.slot % 2 === 0)) {
    addDrum(events, 'crash', boss ? 0.74 : 0.56, 0.2)
  }
  if (!boss) return
  if (step === 0) addDrum(events, 'timpani', 0.72, 0, timpaniPitch(bar.chord.root))
  if (step === 8 && bar.barInPhrase % 2 === 1) {
    addDrum(events, 'timpani', 0.56, 0, timpaniPitch(bar.chord.fifth))
  }
  if (context.faction === 'villain' && step === 0 && (barIndex === 0 || barIndex === 16)) {
    addDrum(events, 'gong', 0.7, -0.12)
  }
}

function planZoneColour(events: MusicEvent[], plan: Plan): void {
  const { stepInBar: step, bar, context, rank } = plan
  if (context.zone === 'forest') {
    if (context.faction !== 'elf' && step % 4 === 2) {
      addDrum(events, 'shaker', 0.26, step % 8 === 2 ? -0.3 : 0.3)
    }
  } else if (context.zone === 'neutral') {
    if (context.faction !== 'elf' && (step === 4 || step === 12)) {
      addDrum(events, 'tambourine', 0.5, 0.24)
    }
    if (step === 0) addDrum(events, 'sleighBells', 0.3, -0.26)
    if (step === 7 || step === 15) addDrum(events, 'spoons', 0.34, 0.32)
  } else if (context.zone === 'palace') {
    if (rank === 2 && step === 0 && bar.barInPhrase % 2 === 0) {
      addDrum(events, 'timpani', 0.5, 0, timpaniPitch(bar.chord.root))
    }
  } else {
    if (step === 10) addDrum(events, 'tom', 0.42, -0.18, 43)
    if (context.faction !== 'guard' && step === 14) addDrum(events, 'snare', 0.2, 0.1)
  }
}

function planFill(events: MusicEvent[], plan: Plan): void {
  const { stepInBar: step, context, rank } = plan
  if (context.faction === 'guard') {
    if (step >= 8) addDrum(events, 'snare', 0.3 + (step - 8) * 0.07, 0.1)
    return
  }
  if (step < 12) return
  const toms = [50, 48, 45, 43]
  addDrum(events, 'tom', 0.46 + (step - 12) * 0.06, -0.3 + (step - 12) * 0.2, toms[step - 12])
  if (rank === 3) addDrum(events, 'kick', 0.55 + (step - 12) * 0.05, 0)
}

function planThreatPulse(events: MusicEvent[], plan: Plan): void {
  const { stepInBar: step, context, rank } = plan
  if (context.threatTier >= 3 && step % 2 === 1) {
    addDrum(events, 'hat', 0.06 + context.threatTier * 0.018, step % 4 === 1 ? -0.36 : 0.36)
  }
  if (rank >= 2 && context.threatTier >= 4 && (step === 6 || step === 14)) {
    addDrum(events, 'tom', 0.32, 0.26, 47)
  }
}

type OutcomeSection = 'statement' | 'body' | 'cadence'
type MelodyStep = number | null

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

const OUTCOME_THEMES: Readonly<Record<Exclude<MusicOutcome, 'none'>, OutcomeTheme>> = {
  // Triumphal march in G major for trumpets, horns, strings and glockenspiel. The lead
  // quotes the natural-harmonic bugle call (do-mi-sol-do) over a plain I-IV-V-I.
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
  // Funeral lament in D minor for a solo cello over a humming choir. The bass walks the
  // descending lamento tetrachord (i-bVII-bVI-v) under a sighing stepwise melody, and a
  // church bell tolls on the half bar.
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
    pulseOctave: 12,
  },
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
  planOutcomeDrums(events, outcome, chordRoot, bar, stepInBar, section)

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
  const velocity = (outcome === 'victory' ? 0.66 : 0.6) * swell
  const voice: MusicInstrument = outcome === 'victory' ? 'strings' : 'choir'
  addTone(events, 'pad', voice, chordRoot + 12, 15.6, velocity, -0.3)
  addTone(events, 'pad', voice, chordRoot + 12 + third, 15.6, velocity * 0.78, 0.3)
  addTone(events, 'pad', voice, chordRoot + 12 + fifth, 15.6, velocity * 0.66, 0.12)
  if (outcome === 'victory' && section !== 'statement') {
    addTone(events, 'pad', voice, chordRoot + 24, 15.6, velocity * 0.5, -0.12)
    // The horn section swells the chord an octave down under the strings.
    addTone(events, 'pad', 'horn', chordRoot, 15.6, velocity * 0.48, -0.18)
    addTone(events, 'pad', 'horn', chordRoot + third, 15.6, velocity * 0.42, 0.18)
    addTone(events, 'pad', 'horn', chordRoot + fifth, 15.6, velocity * 0.38, 0)
  }
  // The lament needs weight between the walking bass and the chord, not more brightness.
  if (outcome === 'defeat') addTone(events, 'pad', voice, chordRoot, 15.6, velocity * 0.62, 0)
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
  addTone(
    events,
    'bass',
    outcome === 'victory' ? 'lowBrass' : 'contrabass',
    chordRoot - 12 + (onFifth ? fifth : 0),
    duration,
    velocity,
    0,
  )
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
  const velocity = outcome === 'victory' ? (interval >= 12 ? 0.9 : 0.8) : 0.72
  const pan = ((bar + Math.floor(stepInBar / 4)) % 2 === 0 ? -1 : 1) * 0.12
  addTone(
    events,
    'lead',
    outcome === 'victory' ? 'trumpet' : 'cello',
    theme.root + 12 + interval,
    durationSteps,
    velocity,
    pan,
  )
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
  const instrument: MusicInstrument = outcome === 'victory' ? 'glockenspiel' : 'churchBell'
  const duration = outcome === 'victory' ? 1.7 : 11
  const velocity = outcome === 'victory' ? 0.52 : 0.46
  addTone(
    events,
    'chime',
    instrument,
    fitRange(midi, instrument),
    duration,
    velocity,
    stepInBar % 8 < 4 ? -0.34 : 0.34,
  )
}

function planOutcomeDrums(
  events: MusicEvent[],
  outcome: Exclude<MusicOutcome, 'none'>,
  chordRoot: number,
  bar: number,
  stepInBar: number,
  section: OutcomeSection,
): void {
  if (outcome === 'defeat') {
    // Muffled funeral drum: a heavy step on beats one and three, nothing else.
    if (stepInBar === 0) addDrum(events, 'kick', 0.72, 0)
    if (stepInBar === 8) addDrum(events, 'kick', 0.5, 0)
    if (section !== 'statement' && stepInBar === 8) addDrum(events, 'snare', 0.26, 0.06)
    if (stepInBar === 0 && bar % 8 === 0) addDrum(events, 'gong', 0.5, 0.1)
    if (bar % 4 === 3 && (stepInBar === 12 || stepInBar === 14)) {
      addDrum(events, 'tom', stepInBar === 12 ? 0.4 : 0.32, stepInBar === 12 ? -0.2 : 0.2, 41)
    }
    return
  }

  if (stepInBar === 0 || stepInBar === 8) addDrum(events, 'kick', stepInBar === 0 ? 0.86 : 0.7, 0)
  if (section !== 'statement' && stepInBar === 6) addDrum(events, 'kick', 0.52, 0)
  if (stepInBar === 4 || stepInBar === 12) addDrum(events, 'snare', 0.72, 0.08)
  if (section !== 'statement' && stepInBar % 4 === 2) {
    addDrum(events, 'hat', 0.42, stepInBar % 8 < 4 ? -0.3 : 0.3)
  }
  if (bar % 4 === 3 && stepInBar >= 12) {
    addDrum(events, 'snare', 0.4 + (stepInBar - 12) * 0.14, (stepInBar - 13.5) * 0.2)
  }
  if (stepInBar === 0 && bar % 4 === 0) addDrum(events, 'crash', bar === 0 ? 1 : 0.7, 0.14)
  if (stepInBar === 0 && (section !== 'statement' || bar === 0)) {
    addDrum(events, 'timpani', bar === 0 ? 0.8 : 0.5, 0, timpaniPitch(mod(chordRoot, 12)))
  }
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

interface ToneExtras {
  offsetSteps?: number
  ornament?: MusicOrnament
  ornamentMidi?: number
}

function addTone(
  events: MusicEvent[],
  part: MusicTonePart,
  instrument: MusicInstrument,
  midi: number,
  durationSteps: number,
  velocity: number,
  pan: number,
  extras?: ToneExtras,
): void {
  events.push({
    kind: 'tone',
    part,
    instrument,
    midi,
    durationSteps: Math.max(0.25, Math.min(MUSIC_STEPS_PER_BAR, durationSteps)),
    velocity: clampVelocity(velocity),
    pan: Math.max(-1, Math.min(1, pan)),
    ...(extras?.offsetSteps ? { offsetSteps: extras.offsetSteps } : {}),
    ...(extras?.ornament ? { ornament: extras.ornament } : {}),
    ...(extras?.ornamentMidi !== undefined ? { ornamentMidi: extras.ornamentMidi } : {}),
  })
}

function addDrum(
  events: MusicEvent[],
  drum: MusicDrum,
  velocity: number,
  pan: number,
  midi?: number,
): void {
  events.push({
    kind: 'drum',
    drum,
    velocity: clampVelocity(velocity),
    pan: Math.max(-1, Math.min(1, pan)),
    ...(midi === undefined ? {} : { midi }),
  })
}

/** Folds a pitch by octaves into the instrument's natural register. */
function fitRange(midi: number, instrument: MusicInstrument): number {
  const [low, high] = MUSIC_INSTRUMENT_RANGES[instrument]
  let value = midi
  while (value < low) value += 12
  while (value > high) value -= 12
  return value
}

function pitchAbove(reference: number, pitchClass: number): number {
  return reference + (mod(pitchClass - reference, 12) || 12)
}

function pitchBelow(reference: number, pitchClass: number): number {
  return reference - (mod(reference - pitchClass, 12) || 12)
}

/** The next note of the local mode above (1) or below (-1). */
function scaleNeighbor(midi: number, direction: 1 | -1, scale: readonly number[]): number {
  for (let distance = 1; distance <= 3; distance += 1) {
    const candidate = midi + distance * direction
    if (scale.includes(mod(candidate, 12))) return candidate
  }
  return midi + 2 * direction
}

function timpaniPitch(pitchClass: number): number {
  return nearestPitch(45, [pitchClass], 40, 52)
}

/** Index into a chord pool rising and falling once per `2 * last` steps. */
function triangleIndex(step: number, last: number): number {
  if (last <= 0) return 0
  const period = last * 2
  const position = step % period
  return position <= last ? position : period - position
}

function normalizeStep(step: number): number {
  const integer = Number.isFinite(step) ? Math.trunc(step) : 0
  return mod(integer, MUSIC_VARIATION_STEPS)
}

function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0x6d2b79f5
}

function seededUnit(seed: number, index: number, salt: number): number {
  let value = seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000
}

function clampVelocity(value: number): number {
  return Math.max(0.01, Math.min(1, value))
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
