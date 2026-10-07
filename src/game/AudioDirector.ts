import type * as THREE from 'three'
import {
  ONE_SHOT_SAMPLES,
  PITCHED_SAMPLES,
  type OneShotSampleName,
  type PitchedSampleName,
} from './AudioSamples.ts'
import {
  DEFAULT_MUSIC_CONTEXT,
  MUSIC_DRUMS,
  MUSIC_VARIATION_STEPS,
  getMusicKey,
  getMusicSwing,
  getMusicTempo,
  isMusicBarBoundary,
  musicEnsembleInstruments,
  normalizeMusicContext,
  planMusicStep,
  planMusicTransition,
  type MusicContext,
  type MusicEvent,
  type MusicInstrument,
  type MusicIntensity,
  type MusicOutcome,
} from './MusicScore.ts'
import {
  SampleBank,
  WaveCache,
  createMusicBus,
  drumSampleKeys,
  instrumentSampleKeys,
  playMusicDrum,
  playMusicTone,
  type MusicBus,
  type MusicColour,
  type MusicSink,
} from './MusicSynth.ts'
import type { Faction, ZoneId } from './types'

export type { MusicContext, MusicIntensity, MusicOutcome } from './MusicScore.ts'

export type SoundCue =
  | 'swing'
  | 'hitLight'
  | 'hitHeavy'
  | 'hurt'
  | 'block'
  | 'gore'
  | 'down'
  | 'bow'
  | 'arrow'
  | 'cleave'
  | 'attackTell'
  | 'whiff'
  | 'coin'
  | 'lootReveal'
  | 'lootCollect'
  | 'command'
  | 'objective'
  | 'save'
  | 'jump'
  | 'land'
  | 'event'
  | 'eventWin'
  | 'eventFail'
  | 'victory'
  | 'defeat'
  | 'achievement'
  | 'thunder'

export interface SoundRequest {
  cue: SoundCue
  category?: 'gameplay' | 'ui'
  position?: THREE.Vector3
  intensity?: number
  variantSeed?: number
}

export interface AudioDirectorSettings {
  musicMuted: boolean
  sfxVolume: number
  musicSeed: number
}

type FrequencyRange = readonly [number, number]
type GainRange = readonly [number, number]

export interface ToneLayer {
  kind: 'tone'
  waveform: OscillatorType
  startFrequency: FrequencyRange
  endFrequency: FrequencyRange
  attack: number
  hold: number
  release: number
  gain: GainRange
  delay?: number
  body?: boolean
  minIntensity?: number
  /** Harmonic amplitudes for a custom timbre, such as a short brass call; overrides `waveform`. */
  harmonics?: readonly number[]
}

export interface NoiseLayer {
  kind: 'noise'
  filterType: BiquadFilterType
  filterFrequency: FrequencyRange
  filterEndFrequency?: FrequencyRange
  /** A whoosh: the filter climbs to this frequency through the attack, then falls to the end. */
  filterPeakFrequency?: FrequencyRange
  q: GainRange
  attack: number
  hold: number
  release: number
  gain: GainRange
  delay?: number
  minIntensity?: number
}

/** One of the procedural recordings from `AudioSamples.ts`: a clang, a coin, a bell note. */
export interface SampleLayer {
  kind: 'sample'
  sample: OneShotSampleName | PitchedSampleName
  /** Pitched instruments play this MIDI note (before key tuning). */
  midi?: number
  /** Playback-rate range on top of the cue's pitch variation. */
  rate: FrequencyRange
  gain: GainRange
  delay?: number
  /** Fades the recording out after this many seconds. */
  duration?: number
  minIntensity?: number
}

export type AudioLayer = ToneLayer | NoiseLayer | SampleLayer

export interface CueRecipe {
  priority: number
  cooldown: number
  maxConcurrent: number
  category: 'gameplay' | 'ui'
  pitchRange?: FrequencyRange
  /**
   * Written around A and transposed into the key the score is playing, so a chime lands
   * as root, fifth and octave of the music instead of against it.
   */
  keyed?: boolean
  layers: readonly AudioLayer[]
}

export const MAX_ACTIVE_VOICES = 24
export const MAX_ACTIVE_SOURCES = 48
export const SFX_DISTANCE_MAX = 42
export const PAN_MAX = 0.85
export const SFX_VOLUME_DEFAULT = 0.8

const MIN_GAIN = 0.0001
const MASTER_GAIN = 0.85
const MUSIC_ACTIVE_GAIN = 0.18
const MUSIC_PAUSED_GAIN = 0.08
const MUSIC_ENDED_GAIN = 0.035
const MUSIC_OUTCOME_GAIN = 0.21
/** Silent beat between the run's score and the outcome piece, in seconds. */
const MUSIC_OUTCOME_GAP = 0.32
const MUSIC_LOOKAHEAD = 0.18
const MUSIC_TICK_MS = 40
/**
 * Rendering a scheduler tick always does, so recordings arrive even on a page with no idle
 * time; the bulk is rendered in idle callbacks instead.
 */
const MUSIC_WARM_BUDGET_MS = 2
/** Longest the first downbeat waits for its instruments to finish rendering, in seconds. */
const MUSIC_START_GRACE = 1.5
/** Upper bound on one idle-time rendering slice. */
const PREWARM_SLICE_MS = 6
const GAMEPLAY_GAIN = 0.62
const UI_GAIN = 0.48
/** Pitch class keyed cues are written in. */
const CUE_REFERENCE_TONIC = 9

/**
 * A fight already sounds bigger through density, drums and brass; the fader comes down a
 * little as the arrangement fills so the score never drowns the blows it is scoring.
 */
const MUSIC_INTENSITY_TRIM: Readonly<Record<MusicIntensity, number>> = {
  explore: 1.08,
  alert: 0.92,
  combat: 0.74,
  boss: 0.58,
}

/** Halls shine and stone walls swallow the top end. */
const ZONE_BRIGHTNESS: Readonly<Record<ZoneId, number>> = {
  neutral: 1,
  palace: 1.1,
  forest: 0.95,
  fort: 0.86,
}

/** Reverb return per region: open road, palace hall, forest canopy, close fortress walls. */
const ZONE_REVERB: Readonly<Record<ZoneId, number>> = {
  neutral: 0.5,
  palace: 0.85,
  forest: 0.62,
  fort: 0.42,
}

const OUTCOME_REVERB: Readonly<Record<Exclude<MusicOutcome, 'none'>, number>> = {
  victory: 0.7,
  defeat: 0.88,
}

/** The villain's war drums are tuned down; the elves' frame drums sit a little higher. */
const FACTION_KIT_RATE: Readonly<Record<Faction, number>> = {
  elf: 1.05,
  guard: 1,
  villain: 0.86,
}

/** Every region's accompaniment, warmed last so a border crossing finds them ready. */
const ZONE_PLUCK_INSTRUMENTS: readonly MusicInstrument[] = ['gusli', 'balalaika', 'celesta', 'pizzicato']

/** Recordings the effects use, warmed after the music's own. */
function sfxSampleKeys(): string[] {
  return [
    'shieldClang',
    'coin',
    'bowTwang',
    'anvil',
    'crash',
    'thunder',
    'gong',
    ...instrumentSampleKeys('celesta'),
    ...instrumentSampleKeys('glockenspiel'),
    ...instrumentSampleKeys('gusli'),
    ...instrumentSampleKeys('churchBell'),
  ]
}

/** A short natural-horn timbre for calls and fanfares. */
const BRASS_CALL: readonly number[] = [0, 1, 0.62, 0.46, 0.32, 0.22, 0.14, 0.09, 0.05]

const tone = (
  waveform: OscillatorType,
  startFrequency: FrequencyRange,
  endFrequency: FrequencyRange,
  gain: GainRange,
  attack: number,
  hold: number,
  release: number,
  options: Pick<ToneLayer, 'delay' | 'body' | 'minIntensity' | 'harmonics'> = {},
): ToneLayer => ({
  kind: 'tone',
  waveform,
  startFrequency,
  endFrequency,
  gain,
  attack,
  hold,
  release,
  ...options,
})

/** A brass note held at one pitch. */
const call = (
  frequency: number,
  gain: GainRange,
  attack: number,
  hold: number,
  release: number,
  options: Pick<ToneLayer, 'delay' | 'minIntensity'> = {},
): ToneLayer =>
  tone('sine', [frequency, frequency], [frequency, frequency], gain, attack, hold, release, {
    ...options,
    harmonics: BRASS_CALL,
  })

const noise = (
  filterType: BiquadFilterType,
  filterFrequency: FrequencyRange,
  gain: GainRange,
  attack: number,
  hold: number,
  release: number,
  options: Partial<Pick<NoiseLayer, 'delay' | 'filterEndFrequency' | 'filterPeakFrequency' | 'minIntensity' | 'q'>> = {},
): NoiseLayer => ({
  kind: 'noise',
  filterType,
  filterFrequency,
  q: [0.55, 1.15],
  gain,
  attack,
  hold,
  release,
  ...options,
})

const sample = (
  name: SampleLayer['sample'],
  gain: GainRange,
  options: Partial<Pick<SampleLayer, 'midi' | 'rate' | 'delay' | 'duration' | 'minIntensity'>> = {},
): SampleLayer => ({ kind: 'sample', sample: name, rate: [1, 1], gain, ...options })

const recipe = (
  priority: number,
  cooldown: number,
  maxConcurrent: number,
  category: 'gameplay' | 'ui',
  layers: readonly AudioLayer[],
  pitchRange?: FrequencyRange,
  keyed?: boolean,
): CueRecipe => ({
  priority,
  cooldown,
  maxConcurrent,
  category,
  layers,
  pitchRange,
  ...(keyed ? { keyed } : {}),
})

/** Keyed cues keep their tuning; only their level varies. */
const IN_TUNE: FrequencyRange = [1, 1]

export const AUDIO_RECIPES: Readonly<Record<SoundCue, CueRecipe>> = {
  // A blade cutting air: band-passed noise that climbs through the swing and falls away.
  swing: recipe(40, 0.06, 2, 'gameplay', [
    noise('bandpass', [520, 700], [0.075, 0.095], 0.035, 0.03, 0.11, {
      filterPeakFrequency: [1500, 2100],
      filterEndFrequency: [380, 520],
      q: [1, 1.5],
    }),
    noise('highpass', [3200, 4200], [0.02, 0.03], 0.02, 0.02, 0.06, { delay: 0.02 }),
    tone('triangle', [190, 220], [80, 100], [0.018, 0.03], 0.004, 0.012, 0.08),
  ]),
  // Flesh and cloth: a low thud, a mid slap and a short crack on top.
  hitLight: recipe(55, 0.025, 6, 'gameplay', [
    tone('sine', [150, 175], [58, 72], [0.085, 0.11], 0.001, 0.016, 0.075, { body: true }),
    noise('bandpass', [1300, 1900], [0.06, 0.08], 0.001, 0.008, 0.045, {
      filterEndFrequency: [500, 700],
      q: [0.9, 1.3],
    }),
    noise('highpass', [3000, 4200], [0.05, 0.07], 0.0005, 0.004, 0.02),
  ]),
  // A deeper thump with a resonant crunch falling under it.
  hitHeavy: recipe(75, 0.045, 3, 'gameplay', [
    tone('sine', [118, 140], [40, 50], [0.13, 0.16], 0.001, 0.035, 0.13, { body: true }),
    noise('lowpass', [1400, 1900], [0.09, 0.12], 0.001, 0.02, 0.1, {
      filterEndFrequency: [260, 380],
      q: [2.5, 4],
    }),
    noise('highpass', [2600, 3600], [0.08, 0.11], 0.0005, 0.006, 0.03, { minIntensity: 0.35 }),
  ]),
  // A winded "oof": a falling body and a vowel-like band of breath.
  hurt: recipe(90, 0.08, 2, 'gameplay', [
    tone('triangle', [150, 180], [70, 85], [0.07, 0.095], 0.004, 0.03, 0.14, { body: true }),
    noise('bandpass', [700, 900], [0.05, 0.07], 0.006, 0.04, 0.12, {
      filterEndFrequency: [320, 420],
      q: [3, 4],
    }),
  ], [0.94, 1.06]),
  // Steel on a shield boss: the modelled plate rings over a low knock and a bright tick.
  block: recipe(90, 0.055, 2, 'gameplay', [
    sample('shieldClang', [0.11, 0.14], { rate: [0.94, 1.06] }),
    tone('sine', [120, 145], [50, 64], [0.09, 0.12], 0.001, 0.02, 0.09, { body: true }),
    noise('highpass', [3400, 4800], [0.04, 0.06], 0.0005, 0.004, 0.03),
  ]),
  // A wet squelch: a resonant low-pass sweeping down, a thump and a late spatter.
  gore: recipe(40, 0.075, 3, 'gameplay', [
    noise('lowpass', [900, 1200], [0.06, 0.085], 0.003, 0.03, 0.14, {
      filterEndFrequency: [140, 220],
      q: [4, 6],
    }),
    tone('sine', [95, 120], [42, 55], [0.04, 0.06], 0.002, 0.02, 0.1),
    noise('bandpass', [2200, 3000], [0.03, 0.04], 0.002, 0.012, 0.05, {
      delay: 0.03,
      q: [1, 1.4],
      minIntensity: 0.4,
    }),
  ], [0.9, 1.04]),
  // A body and its kit hitting the ground: heavy fall, dull cloth, a rattle of gear.
  down: recipe(90, 0.1, 3, 'gameplay', [
    tone('sine', [95, 115], [34, 42], [0.13, 0.17], 0.003, 0.05, 0.26, { body: true }),
    noise('lowpass', [650, 900], [0.08, 0.11], 0.003, 0.05, 0.22, {
      filterEndFrequency: [110, 180],
    }),
    noise('bandpass', [2600, 3400], [0.025, 0.035], 0.002, 0.03, 0.08, {
      delay: 0.035,
      q: [2, 3],
    }),
  ], [0.9, 1.04]),
  // The bowstring snapping forward, and the arrow leaving it.
  bow: recipe(40, 0.07, 2, 'gameplay', [
    sample('bowTwang', [0.11, 0.14], { rate: [0.95, 1.05] }),
    noise('highpass', [2600, 3600], [0.035, 0.05], 0.002, 0.012, 0.07, {
      filterEndFrequency: [1200, 1600],
    }),
  ]),
  // Fletching past the ear: a narrow band dropping in pitch, with a faint whistle.
  arrow: recipe(40, 0.035, 4, 'gameplay', [
    noise('bandpass', [2600, 3200], [0.063, 0.088], 0.004, 0.02, 0.1, {
      filterEndFrequency: [900, 1200],
      q: [3, 4.5],
    }),
    tone('sine', [1700, 1900], [1050, 1250], [0.006, 0.01], 0.01, 0.02, 0.08),
  ]),
  cleave: recipe(55, 0.09, 2, 'gameplay', [
    noise('bandpass', [300, 380], [0.1, 0.13], 0.05, 0.05, 0.16, {
      filterPeakFrequency: [1200, 1500],
      filterEndFrequency: [220, 300],
      q: [0.7, 1],
    }),
    tone('sine', [190, 230], [45, 60], [0.07, 0.1], 0.004, 0.03, 0.18, { body: true }),
    noise('highpass', [3000, 4000], [0.025, 0.035], 0.03, 0.03, 0.08),
  ]),
  // A glint of steel as the blow is drawn back; brutes and champions add a rising heave.
  attackTell: recipe(55, 0.1, 4, 'gameplay', [
    sample('anvil', [0.025, 0.036], { rate: [1.5, 1.7], duration: 0.22 }),
    tone('triangle', [150, 170], [230, 260], [0.04, 0.055], 0.02, 0.05, 0.08, { minIntensity: 0.8 }),
  ]),
  whiff: recipe(20, 0.055, 2, 'gameplay', [
    noise('bandpass', [900, 1200], [0.075, 0.11], 0.03, 0.015, 0.07, {
      filterPeakFrequency: [2400, 3000],
      filterEndFrequency: [700, 900],
      q: [1.3, 1.8],
    }),
  ]),
  // Two coins chiming against each other.
  coin: recipe(75, 0.045, 2, 'ui', [
    sample('coin', [0.07, 0.09], { rate: [0.96, 1.04] }),
    sample('coin', [0.05, 0.065], { rate: [1.12, 1.2], delay: 0.055 }),
  ]),
  // Celesta root, fifth and a glockenspiel octave: rarer finds climb further.
  lootReveal: recipe(75, 0.14, 2, 'ui', [
    sample('celesta', [0.064, 0.078], { midi: 69 }),
    sample('celesta', [0.057, 0.071], { midi: 76, delay: 0.085, minIntensity: 0.45 }),
    sample('glockenspiel', [0.042, 0.053], { midi: 81, delay: 0.17, minIntensity: 0.7 }),
  ], IN_TUNE, true),
  lootCollect: recipe(75, 0.065, 2, 'ui', [
    sample('gusli', [0.063, 0.076], { midi: 76 }),
    sample('glockenspiel', [0.025, 0.032], { midi: 88, delay: 0.05 }),
  ], IN_TUNE, true),
  // A two-note horn call, fifth to root.
  command: recipe(75, 0.09, 2, 'ui', [
    call(329.63, [0.045, 0.06], 0.012, 0.05, 0.07),
    call(440, [0.05, 0.065], 0.012, 0.07, 0.12, { delay: 0.11 }),
  ], IN_TUNE, true),
  // Root, fifth and octave: brass, brass, then a glockenspiel on top.
  objective: recipe(100, 0.16, 2, 'ui', [
    call(440, [0.036, 0.044], 0.01, 0.08, 0.16),
    call(659.26, [0.036, 0.044], 0.01, 0.12, 0.24, { delay: 0.09 }),
    sample('glockenspiel', [0.048, 0.06], { midi: 81, delay: 0.18 }),
  ], IN_TUNE, true),
  save: recipe(100, 0.12, 2, 'ui', [
    sample('celesta', [0.05, 0.063], { midi: 76 }),
    sample('celesta', [0.05, 0.063], { midi: 69, delay: 0.09 }),
  ], IN_TUNE, true),
  jump: recipe(40, 0.08, 2, 'gameplay', [
    noise('bandpass', [500, 700], [0.035, 0.05], 0.02, 0.015, 0.05, {
      filterPeakFrequency: [1100, 1400],
      filterEndFrequency: [600, 800],
      q: [1, 1.4],
    }),
    tone('triangle', [200, 220], [290, 320], [0.02, 0.035], 0.003, 0.015, 0.05),
  ]),
  land: recipe(40, 0.08, 2, 'gameplay', [
    noise('lowpass', [500, 700], [0.05, 0.07], 0.002, 0.015, 0.08, {
      filterEndFrequency: [180, 260],
    }),
    tone('sine', [100, 120], [50, 62], [0.045, 0.065], 0.002, 0.02, 0.08, { body: true }),
    noise('bandpass', [2400, 3200], [0.012, 0.018], 0.001, 0.01, 0.04, { q: [0.8, 1.2] }),
  ]),
  // A village alarm bell struck twice.
  event: recipe(75, 0.12, 2, 'ui', [
    sample('churchBell', [0.07, 0.085], { midi: 76, duration: 1.1 }),
    sample('churchBell', [0.05, 0.06], { midi: 76, delay: 0.18, duration: 0.9 }),
  ], IN_TUNE, true),
  eventWin: recipe(100, 0.18, 2, 'ui', [
    sample('celesta', [0.057, 0.07], { midi: 69 }),
    sample('celesta', [0.057, 0.07], { midi: 76, delay: 0.08 }),
    sample('glockenspiel', [0.044, 0.054], { midi: 81, delay: 0.16 }),
  ], IN_TUNE, true),
  // Two drooping brass notes a step apart over a dull thud.
  eventFail: recipe(100, 0.18, 2, 'ui', [
    tone('sine', [220, 220], [212, 212], [0.063, 0.082], 0.015, 0.12, 0.12, { harmonics: BRASS_CALL }),
    tone('sine', [196, 196], [180, 180], [0.063, 0.082], 0.015, 0.18, 0.25, {
      delay: 0.2,
      harmonics: BRASS_CALL,
    }),
    noise('lowpass', [420, 620], [0.03, 0.04], 0.003, 0.025, 0.18, {
      filterEndFrequency: [95, 145],
    }),
  ], [0.99, 1.01], true),
  // A brass pickup into G — the key of the fanfare that follows — over a cymbal.
  victory: recipe(100, 0.3, 2, 'ui', [
    call(293.66, [0.05, 0.065], 0.012, 0.08, 0.1),
    call(392, [0.06, 0.075], 0.012, 0.25, 0.35, { delay: 0.12 }),
    sample('crash', [0.05, 0.07], { delay: 0.12 }),
  ], IN_TUNE),
  defeat: recipe(100, 0.3, 2, 'ui', [
    sample('gong', [0.14, 0.17], { rate: [0.9, 1] }),
    tone('sine', [110, 125], [38, 46], [0.1, 0.13], 0.003, 0.06, 0.4, { body: true }),
    noise('lowpass', [500, 700], [0.06, 0.08], 0.004, 0.05, 0.3, {
      filterEndFrequency: [80, 120],
    }),
  ], [0.9, 1.03]),
  achievement: recipe(100, 0.12, 2, 'ui', [
    sample('glockenspiel', [0.063, 0.077], { midi: 81 }),
    sample('glockenspiel', [0.063, 0.077], { midi: 88, delay: 0.085 }),
    sample('glockenspiel', [0.068, 0.081], { midi: 93, delay: 0.17 }),
  ], IN_TUNE, true),
  // Modelled rolling thunder over a sub-bass swell.
  thunder: recipe(55, 0.9, 1, 'gameplay', [
    sample('thunder', [0.15, 0.19], { rate: [0.9, 1.06] }),
    tone('sine', [70, 85], [30, 38], [0.04, 0.06], 0.02, 0.15, 0.8, { body: true }),
  ], [0.92, 1.04]),
}

interface ActiveVoice {
  id: number
  cue: SoundCue
  priority: number
  startedAt: number
  endsAt: number
  sourceCount: number
  sources: Set<AudioScheduledSourceNode>
  nodes: Set<AudioNode>
  voiceGain: GainNode
}

export interface AdmissionVoiceSnapshot {
  id: number
  cue: SoundCue
  priority: number
  startedAt: number
  sourceCount: number
}

export interface AdmissionRequestSnapshot {
  cue: SoundCue
  priority: number
  cooldown: number
  maxConcurrent: number
  sourceCount: number
  now: number
  lastPlayedAt?: number
}

export interface AdmissionPlan {
  admitted: boolean
  reason?: 'cooldown' | 'cue-cap' | 'global-cap'
  victimIds: number[]
}

export function planVoiceAdmission(
  request: AdmissionRequestSnapshot,
  activeVoices: readonly AdmissionVoiceSnapshot[],
): AdmissionPlan {
  if (
    request.lastPlayedAt !== undefined &&
    request.now - request.lastPlayedAt < request.cooldown
  ) {
    return { admitted: false, reason: 'cooldown', victimIds: [] }
  }

  const sameCue = activeVoices.filter((voice) => voice.cue === request.cue)
  const mandatoryVictims: AdmissionVoiceSnapshot[] = []
  if (sameCue.length >= request.maxConcurrent) {
    const replaceable = sameCue
      .filter((voice) => voice.priority < request.priority)
      .sort((left, right) => left.startedAt - right.startedAt)
    const required = sameCue.length - request.maxConcurrent + 1
    if (replaceable.length < required) {
      return { admitted: false, reason: 'cue-cap', victimIds: [] }
    }
    mandatoryVictims.push(...replaceable.slice(0, required))
  }

  const mandatoryIds = new Set(mandatoryVictims.map((voice) => voice.id))
  let voiceCount = activeVoices.length - mandatoryVictims.length + 1
  let sourceCount =
    activeVoices.reduce((total, voice) => total + voice.sourceCount, 0) -
    mandatoryVictims.reduce((total, voice) => total + voice.sourceCount, 0) +
    request.sourceCount
  if (voiceCount <= MAX_ACTIVE_VOICES && sourceCount <= MAX_ACTIVE_SOURCES) {
    return { admitted: true, victimIds: [...mandatoryIds] }
  }

  const candidates = activeVoices
    .filter((voice) => !mandatoryIds.has(voice.id) && voice.priority < request.priority)
    .sort((left, right) => left.priority - right.priority || left.startedAt - right.startedAt)
  const victimIds = [...mandatoryIds]
  for (const candidate of candidates) {
    victimIds.push(candidate.id)
    voiceCount -= 1
    sourceCount -= candidate.sourceCount
    if (voiceCount <= MAX_ACTIVE_VOICES && sourceCount <= MAX_ACTIVE_SOURCES) {
      return { admitted: true, victimIds }
    }
  }

  return { admitted: false, reason: 'global-cap', victimIds: [] }
}

export interface SpatialVector {
  x: number
  y: number
  z: number
}

export interface SpatialMix {
  pan: number
  gain: number
}

export function calculateSpatialMix(
  listener: SpatialVector,
  listenerRight: SpatialVector,
  source: SpatialVector,
): SpatialMix {
  const x = source.x - listener.x
  const y = source.y - listener.y
  const z = source.z - listener.z
  const distance = Math.hypot(x, y, z)
  const horizontalDistance = Math.hypot(x, z)
  const rightLength = Math.hypot(listenerRight.x, listenerRight.z)
  const distanceFactor = clamp(horizontalDistance / 8, 0, 1)
  const directionX = horizontalDistance > 0.0001 ? x / horizontalDistance : 0
  const directionZ = horizontalDistance > 0.0001 ? z / horizontalDistance : 0
  const rightX = rightLength > 0.0001 ? listenerRight.x / rightLength : 1
  const rightZ = rightLength > 0.0001 ? listenerRight.z / rightLength : 0
  const pan = clamp((directionX * rightX + directionZ * rightZ) * distanceFactor, -PAN_MAX, PAN_MAX)
  const gain = lerp(1, 0.35, clamp(distance / SFX_DISTANCE_MAX, 0, 1))
  return { pan, gain }
}

export function normalizeSfxVolume(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : SFX_VOLUME_DEFAULT
}

/** Semitones that move a keyed cue from its written A into the score's key. */
export function cueKeyShift(context: Pick<MusicContext, 'faction' | 'outcome'>): number {
  const tonic = getMusicKey(context).tonic
  return mod(tonic - CUE_REFERENCE_TONIC + 6, 12) - 6
}

export interface AudioDirectorDiagnostics {
  contextState: AudioContextState | 'none'
  activeVoices: number
  activeSources: number
  musicSources: number
  schedulerActive: boolean
  destroyed: boolean
}

type AudioWindow = Window & {
  __korovanyStopMusic?: () => void
}

type AudioContextFactory = () => AudioContext

interface MusicVoice {
  sources: Set<AudioScheduledSourceNode>
  nodes: Set<AudioNode>
}

const centeredWorldCues = new Set<SoundCue>(['swing', 'hurt', 'block', 'jump', 'land'])

export class AudioDirector {
  private context: AudioContext | null = null
  private musicBus: MusicBus | null = null
  /** Exists before the context so recordings can render in idle time ahead of the first gesture. */
  private readonly sampleBank = new SampleBank()
  private prewarm: { kind: 'idle' | 'timeout'; handle: number } | null = null
  private preparedFor = ''
  private musicWaves: WaveCache | null = null
  private musicSink: MusicSink | null = null
  private sfxGain: GainNode | null = null
  private uiGain: GainNode | null = null
  private masterCompressor: DynamicsCompressorNode | null = null
  private masterGain: GainNode | null = null
  private sharedNoiseBuffer: AudioBuffer | null = null
  private readonly sfxWaves = new Map<string, PeriodicWave>()
  private musicTimer: number | null = null
  /** The opening downbeat is held until its instruments have rendered, or the grace runs out. */
  private musicWaiting = true
  private musicStartDeadline = 0
  private musicNextNoteTime = 0
  private musicStep = 0
  private musicMuted: boolean
  private readonly musicSeed: number
  private activeMusicContext: MusicContext = DEFAULT_MUSIC_CONTEXT
  private pendingMusicContext: MusicContext = DEFAULT_MUSIC_CONTEXT
  private musicFaultReported = false
  private sfxVolume: number
  private paused = false
  private ended = false
  private hidden = document.hidden
  private destroyed = false
  private closeRequested = false
  private listener = { x: 0, y: 0, z: 0 }
  private listenerRight = { x: 1, y: 0, z: 0 }
  private nextVoiceId = 1
  private runtimeSeed = 0x9e3779b9
  private readonly activeVoices = new Map<number, ActiveVoice>()
  private readonly lastCueAt = new Map<SoundCue, number>()
  private readonly musicVoices = new Set<MusicVoice>()
  private readonly musicSourceOwners = new Map<AudioScheduledSourceNode, MusicVoice>()
  private readonly stopOwner = () => this.destroy()
  private readonly contextStateOwner = () => {
    if (this.context?.state === 'running' && !this.hidden) this.updateBusTargets()
  }
  private readonly contextFactory: AudioContextFactory

  constructor(
    settings: Partial<AudioDirectorSettings> = {},
    contextFactory: AudioContextFactory = () => new AudioContext(),
  ) {
    this.contextFactory = contextFactory
    this.musicMuted = settings.musicMuted ?? false
    this.musicSeed = normalizeSeed(settings.musicSeed)
    this.sfxVolume = normalizeSfxVolume(settings.sfxVolume ?? SFX_VOLUME_DEFAULT)
    this.prepareMusicSamples(this.pendingMusicContext, false)
    this.sampleBank.prepare(sfxSampleKeys())
    this.sampleBank.prepare(ZONE_PLUCK_INSTRUMENTS.flatMap(instrumentSampleKeys))
    this.schedulePrewarm()
  }

  resume(): void {
    if (this.destroyed) return
    if (!this.context) this.createContext()
    const context = this.context
    if (!context || context.state === 'running' || context.state === 'closed') return
    void context.resume().then(() => {
      if (!this.destroyed) this.updateBusTargets()
    }).catch((error: unknown) => {
      console.warn('Korovany: audio context could not be resumed.', error)
    })
  }

  play(request: SoundRequest): void {
    const context = this.context
    if (this.destroyed || !context || context.state !== 'running') return
    const recipeDefinition = AUDIO_RECIPES[request.cue]
    const category = request.category ?? recipeDefinition.category
    if (category === 'gameplay' && (this.paused || this.ended)) return

    const intensity = clamp(
      Number.isFinite(request.intensity) ? (request.intensity ?? 0.5) : 0.5,
      0,
      1,
    )
    const layers = recipeDefinition.layers.filter(
      (layer) => layer.minIntensity === undefined || intensity >= layer.minIntensity,
    )
    const now = context.currentTime
    const activeSnapshots = [...this.activeVoices.values()]
      .map<AdmissionVoiceSnapshot>((voice) => ({
        id: voice.id,
        cue: voice.cue,
        priority: voice.priority,
        startedAt: voice.startedAt,
        sourceCount: voice.sourceCount,
      }))
    const plan = planVoiceAdmission(
      {
        cue: request.cue,
        priority: recipeDefinition.priority,
        cooldown: recipeDefinition.cooldown,
        maxConcurrent: recipeDefinition.maxConcurrent,
        sourceCount: layers.length,
        now,
        lastPlayedAt: this.lastCueAt.get(request.cue),
      },
      activeSnapshots,
    )
    if (!plan.admitted) return
    for (const victimId of plan.victimIds) {
      const victim = this.activeVoices.get(victimId)
      if (victim) this.evictVoice(victim)
    }

    const variation = this.createVariation(
      request.variantSeed === undefined ? this.nextRuntimeSeed() : request.variantSeed,
      request.cue,
      recipeDefinition.pitchRange,
    )
    const keyShift = recipeDefinition.keyed ? cueKeyShift(this.activeMusicContext) : 0
    const spatial =
      request.position && category === 'gameplay' && !centeredWorldCues.has(request.cue)
        ? calculateSpatialMix(this.listener, this.listenerRight, request.position)
        : { pan: 0, gain: 1 }
    const voiceGain = context.createGain()
    voiceGain.gain.setValueAtTime(spatial.gain, now)
    const panner = context.createStereoPanner()
    panner.pan.setValueAtTime(spatial.pan, now)
    voiceGain.connect(panner)
    panner.connect(category === 'ui' ? this.uiGain! : this.sfxGain!)

    const voice: ActiveVoice = {
      id: this.nextVoiceId++,
      cue: request.cue,
      priority: recipeDefinition.priority,
      startedAt: now,
      endsAt: now,
      sourceCount: layers.length,
      sources: new Set(),
      nodes: new Set([voiceGain, panner]),
      voiceGain,
    }

    try {
      for (const [index, layer] of layers.entries()) {
        if (layer.kind === 'tone') {
          this.scheduleToneLayer(voice, layer, now, intensity, variation, index, keyShift)
        } else if (layer.kind === 'noise') {
          this.scheduleNoiseLayer(voice, layer, now, intensity, variation, index)
        } else {
          this.scheduleSampleLayer(voice, layer, now, variation, index, keyShift)
        }
      }
    } catch (error) {
      this.disposeUnstartedVoice(voice)
      console.warn(`Korovany: "${request.cue}" sound could not be scheduled.`, error)
      return
    }
    if (voice.sources.size === 0) {
      // Nothing started, so no `ended` event would ever release the voice.
      this.disconnectNodes(voice.nodes)
      return
    }
    voice.sourceCount = voice.sources.size

    this.activeVoices.set(voice.id, voice)
    this.lastCueAt.set(request.cue, now)
  }

  setMusicMuted(muted: boolean): void {
    this.musicMuted = muted
    this.updateMusicTarget()
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = normalizeSfxVolume(volume)
    this.updateEffectsTargets()
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.updateMusicTarget()
  }

  setEnded(ended: boolean): void {
    this.ended = ended
    this.updateMusicTarget()
    this.updateEffectsTargets(ended ? 0.1 : 0.045)
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden
    const context = this.context
    const masterGain = this.masterGain
    if (!context || !masterGain) return
    if (!hidden && context.state !== 'running') return
    rampParam(masterGain.gain, hidden ? 0 : MASTER_GAIN, context.currentTime, hidden ? 0.025 : 0.06)
    this.updateMusicTarget()
  }

  setListener(position: THREE.Vector3, right: THREE.Vector3): void {
    this.listener.x = position.x
    this.listener.y = position.y
    this.listener.z = position.z
    this.listenerRight.x = right.x
    this.listenerRight.y = right.y
    this.listenerRight.z = right.z
  }

  setMusicContext(context: MusicContext): void {
    this.pendingMusicContext = normalizeMusicContext(context)
    const ensemble = `${context.faction}:${context.zone}`
    if (ensemble !== this.preparedFor) {
      this.preparedFor = ensemble
      this.prepareMusicSamples(this.pendingMusicContext, true)
      this.schedulePrewarm()
    }
  }

  /** Hands the score over to the victory fanfare or the defeat lament. */
  setMusicOutcome(outcome: MusicOutcome): void {
    this.pendingMusicContext = { ...this.pendingMusicContext, outcome }
  }

  getDiagnostics(): AudioDirectorDiagnostics {
    const voices = [...this.activeVoices.values()]
    return {
      contextState: this.context?.state ?? 'none',
      activeVoices: voices.length,
      activeSources: voices.reduce((total, voice) => total + voice.sourceCount, 0),
      musicSources: this.musicSourceOwners.size,
      schedulerActive: this.musicTimer !== null,
      destroyed: this.destroyed,
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.cancelPrewarm()
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer)
      this.musicTimer = null
    }
    for (const voice of [...this.activeVoices.values()]) {
      this.stopSourceSet(voice.sources, `sound voice "${voice.cue}"`)
      this.disconnectNodes(voice.nodes)
    }
    this.activeVoices.clear()

    for (const voice of this.musicVoices) {
      this.stopSourceSet(voice.sources, 'scheduled music source')
      this.disconnectNodes(voice.nodes)
    }
    this.musicVoices.clear()
    this.musicSourceOwners.clear()

    const context = this.context
    for (const node of [
      ...(this.musicBus?.nodes ?? []),
      this.sfxGain,
      this.uiGain,
      this.masterCompressor,
      this.masterGain,
    ]) {
      node?.disconnect()
    }
    this.musicBus = null
    this.sampleBank.dispose()
    this.musicWaves?.clear()
    this.musicWaves = null
    this.musicSink = null
    this.sfxGain = null
    this.uiGain = null
    this.masterCompressor = null
    this.masterGain = null
    this.sharedNoiseBuffer = null
    this.sfxWaves.clear()
    this.context = null
    this.musicNextNoteTime = 0
    context?.removeEventListener('statechange', this.contextStateOwner)

    const audioWindow = window as AudioWindow
    if (audioWindow.__korovanyStopMusic === this.stopOwner) {
      delete audioWindow.__korovanyStopMusic
    }
    if (context && context.state !== 'closed' && !this.closeRequested) {
      this.closeRequested = true
      void context.close().catch((error: unknown) => {
        console.warn('Korovany: audio context could not be closed.', error)
      })
    }
  }

  private createContext(): void {
    let context: AudioContext
    try {
      context = this.contextFactory()
    } catch (error) {
      console.warn('Korovany: audio context could not be created.', error)
      return
    }
    if (this.destroyed) {
      void context.close()
      return
    }

    const audioWindow = window as AudioWindow
    if (audioWindow.__korovanyStopMusic && audioWindow.__korovanyStopMusic !== this.stopOwner) {
      audioWindow.__korovanyStopMusic()
    }
    audioWindow.__korovanyStopMusic = this.stopOwner

    this.context = context
    context.addEventListener('statechange', this.contextStateOwner)
    this.sfxGain = context.createGain()
    this.uiGain = context.createGain()
    this.masterCompressor = context.createDynamicsCompressor()
    this.masterGain = context.createGain()
    this.masterCompressor.threshold.value = -18
    this.masterCompressor.knee.value = 12
    this.masterCompressor.ratio.value = 5
    this.masterCompressor.attack.value = 0.003
    this.masterCompressor.release.value = 0.18
    this.sfxGain.connect(this.masterCompressor)
    this.uiGain.connect(this.masterCompressor)
    this.masterCompressor.connect(this.masterGain)
    this.masterGain.connect(context.destination)
    this.sharedNoiseBuffer = this.createNoiseBuffer(context)

    const bus = createMusicBus(context, this.musicSeed)
    bus.output.gain.value = 0
    bus.output.connect(this.masterCompressor)
    bus.delay.delayTime.value = this.musicEchoTime()
    this.musicBus = bus
    this.sampleBank.attach(context)
    this.musicWaves = new WaveCache(context)
    this.musicSink = {
      context,
      bus,
      bank: this.sampleBank,
      waves: this.musicWaves,
      noise: this.sharedNoiseBuffer,
      track: (sources, nodes) => this.trackMusicVoice(sources, nodes),
    }
    this.prepareMusicSamples(this.pendingMusicContext, true)
    this.applyRoomTone(context.currentTime, 0)
    this.musicWaiting = true
    this.musicStartDeadline = context.currentTime + MUSIC_START_GRACE
    this.updateBusTargets()
    this.scheduleMusic()
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), MUSIC_TICK_MS)
  }

  /**
   * Renders queued recordings in idle time: ahead of the first gesture, and afterwards
   * whenever a new region or a missed note queues more.
   */
  private schedulePrewarm(): void {
    if (this.destroyed || this.prewarm) return
    const run = (budget: number) => {
      this.prewarm = null
      if (this.destroyed) return
      if (this.sampleBank.warm(budget)) this.schedulePrewarm()
    }
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(
        (deadline) =>
          run(deadline.didTimeout ? 4 : Math.max(1, Math.min(PREWARM_SLICE_MS, deadline.timeRemaining()))),
        { timeout: 400 },
      )
      this.prewarm = { kind: 'idle', handle }
    } else {
      this.prewarm = { kind: 'timeout', handle: window.setTimeout(() => run(4), 50) }
    }
  }

  private cancelPrewarm(): void {
    const prewarm = this.prewarm
    if (!prewarm) return
    if (prewarm.kind === 'idle') window.cancelIdleCallback(prewarm.handle)
    else window.clearTimeout(prewarm.handle)
    this.prewarm = null
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 1.5), context.sampleRate)
    const data = buffer.getChannelData(0)
    const random = createRandom(8297)
    for (let index = 0; index < data.length; index += 1) data[index] = random() * 2 - 1
    return buffer
  }

  /** A dotted-eighth echo at the current tempo. */
  private musicEchoTime(): number {
    return (
      (60 / getMusicTempo(this.activeMusicContext.faction, this.activeMusicContext.outcome)) * 0.75
    )
  }

  private updateBusTargets(): void {
    const context = this.context
    if (!context) return
    if (this.masterGain) {
      rampParam(
        this.masterGain.gain,
        this.hidden ? 0 : MASTER_GAIN,
        context.currentTime,
        this.hidden ? 0.025 : 0.06,
      )
    }
    this.updateMusicTarget()
    this.updateEffectsTargets()
  }

  private updateMusicTarget(): void {
    const context = this.context
    const bus = this.musicBus
    if (!context || !bus) return
    rampParam(bus.output.gain, this.musicTargetGain(), context.currentTime, 0.045)
  }

  private musicTargetGain(): number {
    if (this.hidden || this.musicMuted) return 0
    // The outcome piece is the payoff of the run, so it never ducks to the ended level.
    if (this.pendingMusicContext.outcome !== 'none') return MUSIC_OUTCOME_GAIN
    if (this.ended) return MUSIC_ENDED_GAIN
    if (this.paused) return MUSIC_PAUSED_GAIN
    return MUSIC_ACTIVE_GAIN * MUSIC_INTENSITY_TRIM[this.activeMusicContext.intensity]
  }

  private updateEffectsTargets(duration = 0.045): void {
    const context = this.context
    if (!context) return
    if (this.sfxGain) {
      rampParam(
        this.sfxGain.gain,
        this.ended ? 0 : GAMEPLAY_GAIN * this.sfxVolume,
        context.currentTime,
        duration,
      )
    }
    if (this.uiGain) {
      rampParam(this.uiGain.gain, UI_GAIN * this.sfxVolume, context.currentTime, duration)
    }
  }

  private scheduleMusic(): void {
    const context = this.context
    if (!context || !this.musicBus || context.state === 'closed') return
    if (this.pendingMusicContext.outcome !== this.activeMusicContext.outcome) {
      this.startOutcomeMusic()
    }
    if (this.musicWaiting) {
      const opening = musicEnsembleInstruments(this.pendingMusicContext).flatMap(instrumentSampleKeys)
      if (!this.sampleBank.isReady(opening) && context.currentTime < this.musicStartDeadline) {
        this.sampleBank.warm(MUSIC_WARM_BUDGET_MS)
        this.schedulePrewarm()
        return
      }
      this.musicWaiting = false
      this.musicNextNoteTime = context.currentTime + 0.06
    }
    if (this.musicNextNoteTime < context.currentTime - 0.5) {
      this.musicNextNoteTime = context.currentTime + 0.04
    }
    while (this.musicNextNoteTime < context.currentTime + MUSIC_LOOKAHEAD) {
      if (isMusicBarBoundary(this.musicStep)) this.commitMusicContext(this.musicNextNoteTime)
      const stepDuration =
        60 /
        getMusicTempo(this.activeMusicContext.faction, this.activeMusicContext.outcome) /
        4
      if (!this.hidden && !this.musicMuted) {
        this.scheduleMusicStep(this.musicNextNoteTime, stepDuration)
      }
      this.musicStep = (this.musicStep + 1) % MUSIC_VARIATION_STEPS
      this.musicNextNoteTime += stepDuration
    }
    if (this.sampleBank.warm(MUSIC_WARM_BUDGET_MS)) this.schedulePrewarm()
  }

  /**
   * A run ending cuts in immediately instead of waiting for the next bar: the score is
   * hushed, lingering tails are stopped while silent, and the outcome piece restarts at bar one.
   */
  private startOutcomeMusic(): void {
    const context = this.context
    const bus = this.musicBus
    if (!context || !bus) return
    const now = context.currentTime
    this.activeMusicContext = this.pendingMusicContext
    this.musicWaiting = false
    this.musicStep = 0
    this.musicNextNoteTime = now + MUSIC_OUTCOME_GAP

    rampParam(bus.output.gain, 0, now, MUSIC_OUTCOME_GAP * 0.35)
    bus.output.gain.linearRampToValueAtTime(this.musicTargetGain(), now + MUSIC_OUTCOME_GAP + 0.05)
    for (const source of [...this.musicSourceOwners.keys()]) {
      this.stopSource(source, 'scheduled music source', now + MUSIC_OUTCOME_GAP * 0.9)
    }
    rampParam(bus.delay.delayTime, this.musicEchoTime(), now, 0.08)
    this.applyRoomTone(now, 0.3)
  }

  /**
   * Takes the pending context at a bar line. A rise in intensity is announced on the
   * downbeat; a new region or faction re-colours the hall and queues its instruments.
   */
  private commitMusicContext(time: number): void {
    if (sameMusicContext(this.activeMusicContext, this.pendingMusicContext)) return
    const previous = this.activeMusicContext
    this.activeMusicContext = this.pendingMusicContext
    const context = this.context
    const bus = this.musicBus
    if (context && bus) {
      rampParam(bus.delay.delayTime, this.musicEchoTime(), context.currentTime, 0.08)
      if (previous.intensity !== this.activeMusicContext.intensity) {
        rampParam(bus.output.gain, this.musicTargetGain(), context.currentTime, 0.8)
      }
    }
    if (
      previous.zone !== this.activeMusicContext.zone ||
      previous.faction !== this.activeMusicContext.faction
    ) {
      this.prepareMusicSamples(this.activeMusicContext, true)
      if (context) this.applyRoomTone(context.currentTime, 1.5)
    }
    if (this.hidden || this.musicMuted) return
    const colour = this.musicColour()
    for (const event of planMusicTransition(previous, this.activeMusicContext, this.musicStep)) {
      this.playMusicEvent(event, time, 0, colour)
    }
  }

  private prepareMusicSamples(context: MusicContext, urgent: boolean): void {
    this.sampleBank.prepare(musicEnsembleInstruments(context).flatMap(instrumentSampleKeys), urgent)
    this.sampleBank.prepare(MUSIC_DRUMS.flatMap(drumSampleKeys))
  }

  /** Moves the hall's wetness to suit the region or the ending. */
  private applyRoomTone(now: number, duration: number): void {
    const bus = this.musicBus
    if (!bus) return
    const { zone, outcome } = this.activeMusicContext
    const target = outcome === 'none' ? ZONE_REVERB[zone] : OUTCOME_REVERB[outcome]
    if (duration <= 0) {
      bus.reverbReturn.gain.cancelScheduledValues(now)
      bus.reverbReturn.gain.setValueAtTime(target, now)
      return
    }
    rampParam(bus.reverbReturn.gain, target, now, duration)
  }

  private musicColour(): MusicColour {
    const { faction, zone, outcome } = this.activeMusicContext
    if (outcome === 'victory') return { brightness: 1.12, kitRate: 1, muffled: false }
    if (outcome === 'defeat') return { brightness: 0.78, kitRate: 0.8, muffled: true }
    return { brightness: ZONE_BRIGHTNESS[zone], kitRate: FACTION_KIT_RATE[faction], muffled: false }
  }

  private scheduleMusicStep(time: number, stepDuration: number): void {
    const events = planMusicStep(this.activeMusicContext, this.musicStep, this.musicSeed)
    if (events.length === 0) return
    const { faction, outcome } = this.activeMusicContext
    const swing = swingDelay(this.musicStep % 4, getMusicSwing(faction, outcome)) * stepDuration * 4
    const colour = this.musicColour()
    for (const [index, event] of events.entries()) {
      const strum = event.kind === 'tone' ? (event.offsetSteps ?? 0) * stepDuration : 0
      const at = time + swing + strum + this.humanize(event, index)
      const duration = event.kind === 'tone' ? event.durationSteps * stepDuration : 0
      this.playMusicEvent(event, at, duration, colour)
    }
  }

  private playMusicEvent(event: MusicEvent, time: number, duration: number, colour: MusicColour): void {
    const sink = this.musicSink
    if (!sink) return
    try {
      if (event.kind === 'tone') playMusicTone(sink, event, time, duration, colour)
      else playMusicDrum(sink, event, time, colour)
    } catch (error) {
      if (!this.musicFaultReported) {
        this.musicFaultReported = true
        console.warn('Korovany: a music note could not be scheduled.', error)
      }
    }
  }

  /** A few milliseconds of deterministic looseness for melodic parts; the bass and pads stay locked. */
  private humanize(event: MusicEvent, index: number): number {
    if (event.kind === 'tone' && (event.part === 'pad' || event.part === 'bass')) return 0
    if (event.kind === 'drum' && event.drum === 'kick') return 0
    const spread = event.kind === 'tone' ? 0.004 : 0.002
    return (hashUnit(this.musicStep * 31 + index * 7 + this.musicSeed) - 0.5) * 2 * spread
  }

  private trackMusicVoice(
    sources: readonly AudioScheduledSourceNode[],
    nodes: readonly AudioNode[],
  ): void {
    const voice: MusicVoice = { sources: new Set(sources), nodes: new Set(nodes) }
    this.musicVoices.add(voice)
    for (const source of sources) {
      this.musicSourceOwners.set(source, voice)
      source.addEventListener(
        'ended',
        () => {
          source.disconnect()
          this.musicSourceOwners.delete(source)
          voice.sources.delete(source)
          if (voice.sources.size === 0) {
            this.disconnectNodes(voice.nodes)
            this.musicVoices.delete(voice)
          }
        },
        { once: true },
      )
    }
  }

  private scheduleToneLayer(
    voice: ActiveVoice,
    layer: ToneLayer,
    now: number,
    intensity: number,
    variation: Variation,
    index: number,
    keyShift: number,
  ): void {
    const context = this.context!
    const start = now + (layer.delay ?? 0)
    const duration = layer.attack + layer.hold + layer.release
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    envelope.gain.value = 0
    const layerRandom = createRandom(variation.seed + index * 0x85ebca6b)
    const bodyBoost = layer.body ? dbToGain(6 * intensity) : 1
    const gain = clamp(
      randomRange(layer.gain, layerRandom) * variation.gainRatio * bodyBoost,
      MIN_GAIN,
      0.22,
    )
    const keyRatio = 2 ** (keyShift / 12)
    const startFrequency =
      randomRange(layer.startFrequency, layerRandom) * variation.pitchRatio * keyRatio
    const lowEndShift = layer.body ? lerp(1, 0.82, intensity) : 1
    const endFrequency =
      randomRange(layer.endFrequency, layerRandom) * variation.pitchRatio * lowEndShift * keyRatio
    if (layer.harmonics) oscillator.setPeriodicWave(this.sfxWave(layer.harmonics))
    else oscillator.type = layer.waveform
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), start)
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      start + duration,
    )
    scheduleEnvelope(envelope.gain, start, layer.attack, layer.hold, layer.release, gain)
    oscillator.connect(envelope)
    envelope.connect(voice.voiceGain)
    voice.sources.add(oscillator)
    voice.nodes.add(envelope)
    voice.endsAt = Math.max(voice.endsAt, start + duration + 0.02)
    this.bindVoiceSource(voice, oscillator)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
  }

  private scheduleNoiseLayer(
    voice: ActiveVoice,
    layer: NoiseLayer,
    now: number,
    intensity: number,
    variation: Variation,
    index: number,
  ): void {
    const context = this.context!
    const buffer = this.sharedNoiseBuffer!
    const start = now + (layer.delay ?? 0)
    const durationScale = 1 + intensity * 0.35
    const duration = (layer.attack + layer.hold + layer.release) * durationScale
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const envelope = context.createGain()
    envelope.gain.value = 0
    const layerRandom = createRandom(variation.seed + index * 0xc2b2ae35)
    const gain = clamp(
      randomRange(layer.gain, layerRandom) * variation.gainRatio,
      MIN_GAIN,
      0.2,
    )
    const filterFrequency = randomRange(layer.filterFrequency, layerRandom)
    source.buffer = buffer
    filter.type = layer.filterType
    filter.frequency.setValueAtTime(filterFrequency, start)
    if (layer.filterPeakFrequency) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, randomRange(layer.filterPeakFrequency, layerRandom)),
        start + Math.max(0.004, (layer.attack + layer.hold * 0.5) * durationScale),
      )
    }
    if (layer.filterEndFrequency) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, randomRange(layer.filterEndFrequency, layerRandom)),
        start + duration,
      )
    }
    filter.Q.setValueAtTime(randomRange(layer.q, layerRandom), start)
    scheduleEnvelope(
      envelope.gain,
      start,
      layer.attack,
      layer.hold * durationScale,
      layer.release * durationScale,
      gain,
    )
    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(voice.voiceGain)
    voice.sources.add(source)
    voice.nodes.add(filter)
    voice.nodes.add(envelope)
    voice.endsAt = Math.max(voice.endsAt, start + duration + 0.01)
    this.bindVoiceSource(voice, source)
    const maxOffset = Math.max(0, buffer.duration - duration)
    const offset = layerRandom() * maxOffset
    source.start(start, offset, Math.min(duration, buffer.duration - offset))
    source.stop(start + duration + 0.01)
  }

  private scheduleSampleLayer(
    voice: ActiveVoice,
    layer: SampleLayer,
    now: number,
    variation: Variation,
    index: number,
    keyShift: number,
  ): void {
    const context = this.context!
    const bank = this.sampleBank
    const start = now + (layer.delay ?? 0)
    const layerRandom = createRandom(variation.seed + index * 0x27d4eb2f)
    let rate = randomRange(layer.rate, layerRandom) * variation.pitchRatio
    let buffer: AudioBuffer | null
    if (layer.midi !== undefined && isPitchedSample(layer.sample)) {
      const pitched = bank.pitchedNow(layer.sample, layer.midi + keyShift)
      buffer = pitched?.buffer ?? null
      rate *= pitched?.rate ?? 1
    } else {
      buffer = bank.oneShotNow(layer.sample as OneShotSampleName)
    }
    if (!buffer) return
    const gain = clamp(randomRange(layer.gain, layerRandom) * variation.gainRatio, MIN_GAIN, 0.25)
    const natural = buffer.duration / rate
    const length = layer.duration === undefined ? natural : Math.min(natural, layer.duration)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.setValueAtTime(rate, start)
    const envelope = context.createGain()
    envelope.gain.value = 0
    envelope.gain.setValueAtTime(gain, start)
    if (length < natural) envelope.gain.setTargetAtTime(MIN_GAIN, start + length * 0.6, length * 0.1)
    source.connect(envelope)
    envelope.connect(voice.voiceGain)
    voice.sources.add(source)
    voice.nodes.add(envelope)
    voice.endsAt = Math.max(voice.endsAt, start + length + 0.02)
    this.bindVoiceSource(voice, source)
    source.start(start)
    source.stop(start + length + 0.02)
  }

  private sfxWave(harmonics: readonly number[]): PeriodicWave {
    const key = harmonics.join(',')
    let wave = this.sfxWaves.get(key)
    if (!wave) {
      const imaginary = Float32Array.from(harmonics)
      wave = this.context!.createPeriodicWave(new Float32Array(imaginary.length), imaginary)
      this.sfxWaves.set(key, wave)
    }
    return wave
  }

  private bindVoiceSource(voice: ActiveVoice, source: AudioScheduledSourceNode): void {
    source.addEventListener(
      'ended',
      () => {
        source.disconnect()
        voice.sources.delete(source)
        if (voice.sources.size === 0) this.cleanupVoice(voice)
      },
      { once: true },
    )
  }

  private evictVoice(voice: ActiveVoice): void {
    const context = this.context
    if (!context) return
    voice.voiceGain.gain.cancelScheduledValues(context.currentTime)
    voice.voiceGain.gain.setValueAtTime(0, context.currentTime)
    for (const source of voice.sources) {
      try {
        source.stop(context.currentTime)
      } catch (error) {
        if (!isInvalidStateError(error)) {
          console.warn(`Korovany: evicted "${voice.cue}" source could not be stopped.`, error)
        }
      }
      source.disconnect()
    }
    this.disconnectNodes(voice.nodes)
    this.activeVoices.delete(voice.id)
  }

  private cleanupVoice(voice: ActiveVoice): void {
    if (!this.activeVoices.has(voice.id)) return
    this.disconnectNodes(voice.nodes)
    this.activeVoices.delete(voice.id)
  }

  private disposeUnstartedVoice(voice: ActiveVoice): void {
    this.stopSourceSet(voice.sources, `partially scheduled "${voice.cue}" voice`)
    this.disconnectNodes(voice.nodes)
  }

  private stopSourceSet(sources: ReadonlySet<AudioScheduledSourceNode>, label: string): void {
    for (const source of sources) {
      this.stopSource(source, label)
      source.disconnect()
    }
  }

  private stopSource(source: AudioScheduledSourceNode, label: string, when?: number): void {
    try {
      if (when === undefined) source.stop()
      else source.stop(when)
    } catch (error) {
      if (!isInvalidStateError(error)) {
        console.warn(`Korovany: ${label} could not be stopped.`, error)
      }
    }
  }

  private disconnectNodes(nodes: ReadonlySet<AudioNode>): void {
    for (const node of nodes) node.disconnect()
  }

  private nextRuntimeSeed(): number {
    this.runtimeSeed = xorshift(this.runtimeSeed)
    return this.runtimeSeed
  }

  private createVariation(seedValue: number, cue: SoundCue, pitchRange?: FrequencyRange): Variation {
    const seed = (Number.isFinite(seedValue) ? seedValue : this.nextRuntimeSeed()) >>> 0
    const random = createRandom(seed ^ hashString(cue))
    const range = pitchRange ?? (cue === 'gore' || cue === 'down' ? [0.9, 1.04] : [0.94, 1.06])
    return {
      seed,
      pitchRatio: randomRange(range, random),
      gainRatio: dbToGain(lerp(-1.5, 1.5, random())),
    }
  }
}

interface Variation {
  seed: number
  pitchRatio: number
  gainRatio: number
}

function sameMusicContext(left: MusicContext, right: MusicContext): boolean {
  return (
    left.faction === right.faction &&
    left.zone === right.zone &&
    left.intensity === right.intensity &&
    left.threatTier === right.threatTier &&
    left.outcome === right.outcome
  )
}

function isPitchedSample(name: SampleLayer['sample']): name is PitchedSampleName {
  return Object.hasOwn(PITCHED_SAMPLES, name)
}

/** Every recording an effect can name exists in one of the two banks. */
export function isKnownSample(name: string): boolean {
  return Object.hasOwn(PITCHED_SAMPLES, name) || Object.hasOwn(ONE_SHOT_SAMPLES, name)
}

/**
 * How far a sixteenth inside a beat moves under swing, in beats: the off-beat eighth lands at
 * `swing`, and the sixteenths either side of it are spread evenly around it.
 */
export function swingDelay(stepInBeat: number, swing: number): number {
  const position = stepInBeat / 4
  const warped =
    stepInBeat === 0 ? 0 : stepInBeat === 1 ? swing / 2 : stepInBeat === 2 ? swing : swing + (1 - swing) / 2
  return warped - position
}

function normalizeSeed(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0x6d2b79f5
  return Math.trunc(value) >>> 0
}

function scheduleEnvelope(
  gain: AudioParam,
  start: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
): void {
  const top = Math.max(MIN_GAIN, peak)
  const attackEnd = start + Math.max(0.001, attack)
  gain.setValueAtTime(MIN_GAIN, start)
  gain.exponentialRampToValueAtTime(top, attackEnd)
  // The hold sags to three quarters as a ramp, not a step: a step is a click on a held tone.
  gain.exponentialRampToValueAtTime(
    Math.max(MIN_GAIN, peak * 0.76),
    Math.max(attackEnd + 0.001, start + attack + hold),
  )
  gain.exponentialRampToValueAtTime(
    MIN_GAIN,
    Math.max(attackEnd + 0.002, start + attack + hold + release),
  )
}

function rampParam(param: AudioParam, target: number, now: number, duration: number): void {
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(target, now + duration)
}

function randomRange(range: FrequencyRange, random: () => number): number {
  return lerp(range[0], range[1], random())
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5
  return () => {
    state = xorshift(state)
    return state / 0x100000000
  }
}

function xorshift(value: number): number {
  let state = value >>> 0
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return state >>> 0
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function hashUnit(value: number): number {
  let hash = Math.imul((value | 0) ^ 0x5bd1e995, 0x9e3779b1)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x85ebca6b)
  return ((hash ^ (hash >>> 13)) >>> 0) / 0x100000000
}

function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

function isInvalidStateError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'InvalidStateError'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
