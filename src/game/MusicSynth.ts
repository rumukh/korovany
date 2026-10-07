/**
 * The instruments of the score as Web Audio voices.
 *
 * Sustained instruments (svirel, reed, horn, trumpet, low brass, strings, cello, contrabass,
 * choir, bayan, organ) are built per note from oscillators whose spectra come from fixed
 * formant envelopes — so a bassoon stays a bassoon across its range — with bloom filters,
 * scoops, delayed vibrato and breath or bow noise. Plucked and struck instruments and the
 * drum kit play the physically modelled recordings from `AudioSamples.ts`.
 *
 * Nothing here owns a timer: the director drives scheduling and sample warming.
 */
import {
  ONE_SHOT_SAMPLES,
  PITCHED_SAMPLES,
  createNoise,
  midiToFrequency,
  nearestSampleRoot,
  pitchedSampleRoots,
  runJob,
  type OneShotSampleName,
  type PitchedSampleName,
  type RenderJob,
} from './AudioSamples.ts'
import type {
  MusicDrum,
  MusicDrumEvent,
  MusicInstrument,
  MusicToneEvent,
} from './MusicScore.ts'

interface FilterSpec {
  type: BiquadFilterType
  /** Cutoff in Hz at velocity 0, before key tracking. */
  base: number
  /** Extra cutoff in Hz at full velocity. */
  velocity: number
  /** Cutoff added per Hz of fundamental. */
  keyTrack: number
  q: number
  /** Brass bloom: the filter opens from `start` to full during the attack, then relaxes. */
  bloom?: { start: number; settle: number }
}

type WaveSpec =
  | { type: 'harmonics'; amplitudes: readonly number[] }
  | { type: 'formant'; slope: number; formants: readonly (readonly [number, number, number])[] }
  | { type: 'saw' }

interface OscillatorVoiceSpec {
  kind: 'oscillator'
  wave: WaveSpec
  /** Detune in cents of each oscillator stacked on the note. */
  unison: readonly number[]
  /** Organ stops sound an octave above the oscillator. */
  octaveShift?: number
  gain: number
  attack: number
  /** Time constant toward the sustain level after the attack. */
  decay: number
  sustain: number
  release: number
  filter: FilterSpec
  vibrato?: { rate: number; depth: number; delay: number; rise: number }
  /** Pitch starts this many cents flat and slides up, as lips settle on a brass note. */
  scoop?: { cents: number; time: number }
  /** Air or bow noise: band-pass around `ratio` × fundamental, or a fixed high-pass. */
  breath?: { gain: number; ratio?: number; highpass?: number; q: number; chiff: number }
  reverb: number
  echo: number
}

interface SampleVoiceSpec {
  kind: 'sample'
  sample: PitchedSampleName
  gain: number
  /** Damping time once the written note ends. */
  release: number
  /** Low-pass cutoff at velocity 0 and the extra at full velocity; harder plucks are brighter. */
  tone: readonly [number, number]
  reverb: number
  echo: number
}

type VoiceSpec = OscillatorVoiceSpec | SampleVoiceSpec

export const MUSIC_VOICES: Readonly<Record<MusicInstrument, VoiceSpec>> = {
  // Svirel: an almost pure tone, a breathy chiff, vibrato that arrives late.
  flute: {
    kind: 'oscillator',
    wave: { type: 'harmonics', amplitudes: [0, 1, 0.24, 0.1, 0.045, 0.02, 0.01] },
    unison: [0],
    gain: 0.1,
    attack: 0.06,
    decay: 0.18,
    sustain: 0.82,
    release: 0.12,
    filter: { type: 'lowpass', base: 2400, velocity: 2200, keyTrack: 1.2, q: 0.6 },
    vibrato: { rate: 5.1, depth: 14, delay: 0.22, rise: 0.3 },
    breath: { gain: 0.2, ratio: 2, q: 1.1, chiff: 3 },
    reverb: 0.42,
    echo: 0.16,
  },
  // Zhaleika and bassoon: one reed with fixed nasal formants across the range.
  reed: {
    kind: 'oscillator',
    wave: { type: 'formant', slope: 0.55, formants: [[520, 380, 1], [1250, 500, 0.7], [2900, 900, 0.35]] },
    unison: [0],
    gain: 0.14,
    attack: 0.035,
    decay: 0.12,
    sustain: 0.85,
    release: 0.08,
    filter: { type: 'lowpass', base: 1800, velocity: 2800, keyTrack: 2, q: 0.7 },
    vibrato: { rate: 5.4, depth: 9, delay: 0.25, rise: 0.25 },
    reverb: 0.3,
    echo: 0.12,
  },
  horn: {
    kind: 'oscillator',
    wave: { type: 'formant', slope: 1.05, formants: [[420, 300, 1], [950, 600, 0.5], [2300, 900, 0.12]] },
    unison: [-4, 4],
    gain: 0.085,
    attack: 0.07,
    decay: 0.2,
    sustain: 0.82,
    release: 0.16,
    filter: { type: 'lowpass', base: 700, velocity: 1900, keyTrack: 2.2, q: 0.8, bloom: { start: 0.55, settle: 0.85 } },
    scoop: { cents: -22, time: 0.06 },
    reverb: 0.45,
    echo: 0.08,
  },
  trumpet: {
    kind: 'oscillator',
    wave: { type: 'formant', slope: 0.72, formants: [[1250, 700, 1], [2600, 1100, 0.65], [4200, 1500, 0.2]] },
    unison: [-5, 5],
    gain: 0.075,
    attack: 0.03,
    decay: 0.14,
    sustain: 0.8,
    release: 0.1,
    filter: { type: 'lowpass', base: 1300, velocity: 4200, keyTrack: 2.5, q: 1, bloom: { start: 0.4, settle: 0.8 } },
    scoop: { cents: -15, time: 0.04 },
    vibrato: { rate: 5.6, depth: 9, delay: 0.3, rise: 0.25 },
    reverb: 0.36,
    echo: 0.1,
  },
  // Trombones and tuba.
  lowBrass: {
    kind: 'oscillator',
    wave: { type: 'formant', slope: 0.95, formants: [[320, 260, 1], [780, 500, 0.6], [1900, 800, 0.2]] },
    unison: [-3, 3],
    gain: 0.075,
    attack: 0.045,
    decay: 0.16,
    sustain: 0.82,
    release: 0.12,
    filter: { type: 'lowpass', base: 450, velocity: 1700, keyTrack: 2, q: 0.8, bloom: { start: 0.5, settle: 0.85 } },
    scoop: { cents: -18, time: 0.05 },
    reverb: 0.26,
    echo: 0.05,
  },
  strings: {
    kind: 'oscillator',
    wave: { type: 'saw' },
    unison: [-7, 6],
    gain: 0.042,
    attack: 0.38,
    decay: 0.6,
    sustain: 0.88,
    release: 0.5,
    filter: { type: 'lowpass', base: 1500, velocity: 2600, keyTrack: 0.8, q: 0.5 },
    reverb: 0.55,
    echo: 0.04,
  },
  cello: {
    kind: 'oscillator',
    wave: {
      type: 'formant',
      slope: 0.85,
      formants: [[300, 220, 1], [620, 380, 0.8], [1150, 500, 0.5], [2700, 1000, 0.25]],
    },
    unison: [0],
    gain: 0.1,
    attack: 0.09,
    decay: 0.25,
    sustain: 0.88,
    release: 0.22,
    filter: { type: 'lowpass', base: 1600, velocity: 2600, keyTrack: 1.5, q: 0.6 },
    vibrato: { rate: 5.3, depth: 18, delay: 0.18, rise: 0.35 },
    reverb: 0.48,
    echo: 0.08,
  },
  contrabass: {
    kind: 'oscillator',
    wave: { type: 'formant', slope: 0.9, formants: [[160, 140, 1], [420, 300, 0.7], [950, 500, 0.3]] },
    unison: [-3, 3],
    gain: 0.085,
    attack: 0.06,
    decay: 0.2,
    sustain: 0.85,
    release: 0.16,
    filter: { type: 'lowpass', base: 500, velocity: 1300, keyTrack: 2.5, q: 0.7 },
    vibrato: { rate: 4.8, depth: 8, delay: 0.3, rise: 0.3 },
    reverb: 0.22,
    echo: 0,
  },
  // An "ah" chorus: formants fixed in Hz, two detuned voices per note.
  choir: {
    kind: 'oscillator',
    wave: {
      type: 'formant',
      slope: 0.9,
      formants: [[700, 160, 1], [1150, 200, 0.6], [2600, 350, 0.25], [3300, 400, 0.12]],
    },
    unison: [-10, 9],
    gain: 0.055,
    attack: 0.32,
    decay: 0.5,
    sustain: 0.9,
    release: 0.45,
    filter: { type: 'lowpass', base: 1800, velocity: 2600, keyTrack: 1, q: 0.5 },
    vibrato: { rate: 5, depth: 13, delay: 0.15, rise: 0.4 },
    reverb: 0.6,
    echo: 0.05,
  },
  // Bayan: two reeds a few cents apart in a resonant box.
  bayan: {
    kind: 'oscillator',
    wave: { type: 'formant', slope: 0.42, formants: [[880, 500, 1], [2100, 800, 0.6], [3600, 1200, 0.25]] },
    unison: [-4, 5],
    gain: 0.05,
    attack: 0.025,
    decay: 0.1,
    sustain: 0.92,
    release: 0.06,
    filter: { type: 'lowpass', base: 2600, velocity: 3000, keyTrack: 0.5, q: 0.6 },
    reverb: 0.3,
    echo: 0.06,
  },
  // A small pipe organ: 16', 8', 5⅓', 4', 2⅔' and 2' stops with a celeste rank.
  organ: {
    kind: 'oscillator',
    wave: {
      type: 'harmonics',
      amplitudes: [0, 0.55, 1, 0.3, 0.55, 0, 0.25, 0, 0.3, 0, 0.08, 0, 0.06, 0, 0, 0, 0.05],
    },
    unison: [0, 3],
    octaveShift: -12,
    gain: 0.045,
    attack: 0.02,
    decay: 0.05,
    sustain: 1,
    release: 0.07,
    filter: { type: 'lowpass', base: 3500, velocity: 2500, keyTrack: 0, q: 0.5 },
    reverb: 0.6,
    echo: 0.05,
  },
  gusli: { kind: 'sample', sample: 'gusli', gain: 0.34, release: 0.35, tone: [2600, 9000], reverb: 0.4, echo: 0.14 },
  balalaika: {
    kind: 'sample', sample: 'balalaika', gain: 0.3, release: 0.12, tone: [3200, 9000], reverb: 0.3, echo: 0.08,
  },
  pizzicato: {
    kind: 'sample', sample: 'pizzicato', gain: 0.3, release: 0.08, tone: [1800, 5000], reverb: 0.32, echo: 0.04,
  },
  uprightBass: {
    kind: 'sample', sample: 'uprightBass', gain: 0.34, release: 0.12, tone: [550, 1500], reverb: 0.12, echo: 0,
  },
  celesta: { kind: 'sample', sample: 'celesta', gain: 0.26, release: 0.4, tone: [5000, 9000], reverb: 0.5, echo: 0.16 },
  glockenspiel: {
    kind: 'sample', sample: 'glockenspiel', gain: 0.1, release: 0.5, tone: [7000, 9000], reverb: 0.45, echo: 0.12,
  },
  churchBell: {
    kind: 'sample', sample: 'churchBell', gain: 0.17, release: 1.2, tone: [3500, 5000], reverb: 0.55, echo: 0.04,
  },
}

interface DrumSpec {
  sample: OneShotSampleName | 'timpani'
  gain: number
  reverb: number
  /** MIDI pitch of the rendered sample, for tuned drums. */
  root?: number
}

const DRUMS: Readonly<Record<MusicDrum, DrumSpec>> = {
  kick: { sample: 'kick', gain: 0.36, reverb: 0.06 },
  snare: { sample: 'snare', gain: 0.2, reverb: 0.18 },
  hat: { sample: 'hat', gain: 0.1, reverb: 0.05 },
  tom: { sample: 'tom', gain: 0.24, reverb: 0.18, root: 45 },
  crash: { sample: 'crash', gain: 0.13, reverb: 0.3 },
  tambourine: { sample: 'tambourine', gain: 0.19, reverb: 0.12 },
  shaker: { sample: 'shaker', gain: 0.14, reverb: 0.08 },
  spoons: { sample: 'spoons', gain: 0.15, reverb: 0.1 },
  frameDrum: { sample: 'frameDrum', gain: 0.26, reverb: 0.15 },
  sleighBells: { sample: 'sleighBells', gain: 0.11, reverb: 0.2 },
  anvil: { sample: 'anvil', gain: 0.12, reverb: 0.3 },
  gong: { sample: 'gong', gain: 0.24, reverb: 0.4 },
  timpani: { sample: 'timpani', gain: 0.3, reverb: 0.3 },
}

export interface MusicBus {
  /** Dry sum of every voice. */
  input: GainNode
  reverbInput: GainNode
  echoInput: GainNode
  /** Wetness of the hall; the director moves it with the region. */
  reverbReturn: GainNode
  /** Tempo-synced echo. */
  delay: DelayNode
  /** The music fader. */
  output: GainNode
  /** One mix strip per instrument and drum, carrying its hall and echo sends. */
  submixes: Map<string, GainNode>
  nodes: AudioNode[]
}

/** How the current scene colours every voice. */
export interface MusicColour {
  /** Multiplies filter cutoffs: halls shine, fortresses are dark. */
  brightness: number
  /** Playback rate of the bass drum and toms; the villain's kit is tuned down. */
  kitRate: number
  /** The funeral drum is draped. */
  muffled: boolean
}

export interface MusicSink {
  context: BaseAudioContext
  bus: MusicBus
  bank: SampleBank
  waves: WaveCache
  noise: AudioBuffer
  /** Registers a note's sources; its nodes are released when every source has ended. */
  track(sources: readonly AudioScheduledSourceNode[], nodes: readonly AudioNode[]): void
}

/**
 * The plucked, struck and drum recordings. PCM is rendered cooperatively from a queue —
 * in idle time before the audio context exists, then between scheduler ticks — pausing
 * mid-recording when its time slice runs out, and becomes an AudioBuffer once a context
 * can own it. The score only plays recordings that are ready and queues the rest; effects
 * may force a render, because a silent confirmation would be worse than a short stall.
 */
export class SampleBank {
  private context: BaseAudioContext | null = null
  /** Rendered PCM waiting for a context; dropped once it has become a buffer. */
  private readonly recordings = new Map<string, { data: Float32Array; sampleRate: number }>()
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly pending: string[] = []
  private readonly queued = new Set<string>()
  private active: { key: string; sampleRate: number; job: RenderJob } | null = null

  constructor(context: BaseAudioContext | null = null) {
    this.context = context
  }

  /** Gives the bank the context its buffers will live in. */
  attach(context: BaseAudioContext): void {
    this.context = context
  }

  /** The ready root nearest `midi` and the rate that reaches it, or null — queued first — if not rendered yet. */
  pitched(name: PitchedSampleName, midi: number): { buffer: AudioBuffer; rate: number } | null {
    const root = nearestSampleRoot(name, midi)
    const buffer = this.lookup(pitchedKey(name, root), false)
    return buffer ? { buffer, rate: 2 ** ((midi - root) / 12) } : null
  }

  oneShot(name: OneShotSampleName): AudioBuffer | null {
    return this.lookup(name, false)
  }

  /** Like `pitched`, but renders on the spot if it must. */
  pitchedNow(name: PitchedSampleName, midi: number): { buffer: AudioBuffer; rate: number } | null {
    const root = nearestSampleRoot(name, midi)
    const buffer = this.lookup(pitchedKey(name, root), true)
    return buffer ? { buffer, rate: 2 ** ((midi - root) / 12) } : null
  }

  oneShotNow(name: OneShotSampleName): AudioBuffer | null {
    return this.lookup(name, true)
  }

  /** Whether every recording has been rendered. */
  isReady(keys: readonly string[]): boolean {
    return keys.every((key) => this.buffers.has(key) || this.recordings.has(key))
  }

  /** Queues recordings to be rendered by `warm`; urgent ones jump the queue. */
  prepare(keys: readonly string[], urgent = false): void {
    const fresh: string[] = []
    for (const key of new Set(keys)) {
      if (this.buffers.has(key) || this.recordings.has(key) || this.active?.key === key) continue
      if (this.queued.has(key)) {
        if (!urgent) continue
        this.pending.splice(this.pending.indexOf(key), 1)
      }
      this.queued.add(key)
      fresh.push(key)
    }
    if (urgent) this.pending.unshift(...fresh)
    else this.pending.push(...fresh)
  }

  /**
   * Renders queued recordings for about `budgetMs` of main-thread time, pausing inside a
   * recording when the slice runs out. Returns whether work remains.
   */
  warm(budgetMs: number): boolean {
    const deadline = performance.now() + budgetMs
    do {
      if (!this.active) {
        const key = this.pending.shift()
        if (key === undefined) return false
        this.queued.delete(key)
        if (this.buffers.has(key) || this.recordings.has(key)) continue
        this.active = createRenderJob(key)
      }
      const active = this.active
      let step = active.job.next()
      while (!step.done && performance.now() < deadline) step = active.job.next()
      if (step.done) {
        this.recordings.set(active.key, { data: step.value, sampleRate: active.sampleRate })
        this.active = null
      }
    } while (performance.now() < deadline)
    return this.active !== null || this.pending.length > 0
  }

  dispose(): void {
    this.recordings.clear()
    this.buffers.clear()
    this.pending.length = 0
    this.queued.clear()
    this.active = null
    this.context = null
  }

  private lookup(key: string, force: boolean): AudioBuffer | null {
    const existing = this.buffers.get(key)
    if (existing) return existing
    let recording = this.recordings.get(key)
    if (!recording) {
      if (!force) {
        this.prepare([key], true)
        return null
      }
      if (this.active?.key === key) {
        recording = { data: runJob(this.active.job), sampleRate: this.active.sampleRate }
        this.active = null
      } else {
        const job = createRenderJob(key)
        recording = { data: runJob(job.job), sampleRate: job.sampleRate }
      }
      this.recordings.set(key, recording)
    }
    if (!this.context) return null
    const buffer = this.context.createBuffer(1, recording.data.length, recording.sampleRate)
    buffer.getChannelData(0).set(recording.data)
    this.buffers.set(key, buffer)
    this.recordings.delete(key)
    return buffer
  }
}

function createRenderJob(key: string): { key: string; sampleRate: number; job: RenderJob } {
  const [name, root] = key.split(':')
  if (root === undefined) {
    const spec = ONE_SHOT_SAMPLES[name as OneShotSampleName]
    return { key, sampleRate: spec.sampleRate, job: spec.render(spec.sampleRate) }
  }
  const spec = PITCHED_SAMPLES[name as PitchedSampleName]
  return { key, sampleRate: spec.sampleRate, job: spec.render(Number(root), spec.sampleRate) }
}

/** Oscillator spectra: one per fixed-spectrum instrument, one per pitch for formant voices. */
export class WaveCache {
  private readonly context: BaseAudioContext
  private readonly waves = new Map<string, PeriodicWave>()

  constructor(context: BaseAudioContext) {
    this.context = context
  }

  get(instrument: MusicInstrument, wave: WaveSpec, frequency: number): PeriodicWave | null {
    if (wave.type === 'saw') return null
    const key = wave.type === 'harmonics' ? instrument : `${instrument}:${Math.round(frequency * 4)}`
    let periodic = this.waves.get(key)
    if (!periodic) {
      const imaginary =
        wave.type === 'harmonics'
          ? Float32Array.from(wave.amplitudes)
          : formantSpectrum(frequency, wave.slope, wave.formants, this.context.sampleRate)
      periodic = this.context.createPeriodicWave(new Float32Array(imaginary.length), imaginary)
      this.waves.set(key, periodic)
    }
    return periodic
  }

  clear(): void {
    this.waves.clear()
  }
}

/**
 * Harmonic amplitudes of a source with a `slope` roll-off passed through fixed resonances.
 * Because the resonances stay put in Hz while the pitch moves, each register gets its own
 * colour — the property that makes a real instrument recognisable across its range.
 */
export function formantSpectrum(
  frequency: number,
  slope: number,
  formants: readonly (readonly [number, number, number])[],
  sampleRate: number,
): Float32Array {
  const limit = Math.min(sampleRate * 0.45, 12000)
  const count = Math.max(1, Math.min(80, Math.floor(limit / frequency)))
  const amplitudes = new Float32Array(count + 1)
  let peak = 0
  for (let harmonic = 1; harmonic <= count; harmonic += 1) {
    const position = harmonic * frequency
    let resonance = 0.1
    for (const [centre, bandwidth, gain] of formants) {
      const offset = (position - centre) / (bandwidth / 2)
      resonance += gain / (1 + offset * offset)
    }
    amplitudes[harmonic] = resonance * harmonic ** -slope
    peak = Math.max(peak, amplitudes[harmonic])
  }
  if (peak > 0) for (let harmonic = 1; harmonic <= count; harmonic += 1) amplitudes[harmonic] /= peak
  return amplitudes
}

function pitchedKey(name: PitchedSampleName, root: number): string {
  return `${name}:${root}`
}

/** Recordings an instrument plays from; empty for oscillator voices. */
export function instrumentSampleKeys(instrument: MusicInstrument): string[] {
  const voice = MUSIC_VOICES[instrument]
  return voice.kind === 'sample' ? pitchedSampleRoots(voice.sample).map((root) => pitchedKey(voice.sample, root)) : []
}

export function drumSampleKeys(drum: MusicDrum): string[] {
  const sample = DRUMS[drum].sample
  return sample === 'timpani'
    ? pitchedSampleRoots('timpani').map((root) => pitchedKey('timpani', root))
    : [sample]
}

export function isSampledInstrument(instrument: MusicInstrument): boolean {
  return MUSIC_VOICES[instrument].kind === 'sample'
}

/**
 * The music bus: a dry sum, a procedural hall whose wetness follows the region, and a
 * tempo-synced echo whose repeats darken and spill into the hall.
 */
export function createMusicBus(context: BaseAudioContext, seed: number): MusicBus {
  const output = context.createGain()
  const input = context.createGain()
  const rumble = context.createBiquadFilter()
  rumble.type = 'highpass'
  rumble.frequency.value = 30
  rumble.Q.value = 0.5
  input.connect(rumble)
  rumble.connect(output)

  const reverbInput = context.createGain()
  const reverbLow = context.createBiquadFilter()
  reverbLow.type = 'highpass'
  reverbLow.frequency.value = 220
  reverbLow.Q.value = 0.6
  const convolver = context.createConvolver()
  convolver.buffer = createHallImpulse(context, seed)
  const reverbHigh = context.createBiquadFilter()
  reverbHigh.type = 'lowpass'
  reverbHigh.frequency.value = 7200
  reverbHigh.Q.value = 0.5
  const reverbReturn = context.createGain()
  reverbReturn.gain.value = 0.62
  reverbInput.connect(reverbLow)
  reverbLow.connect(convolver)
  convolver.connect(reverbHigh)
  reverbHigh.connect(reverbReturn)
  reverbReturn.connect(output)

  const echoInput = context.createGain()
  const echoLow = context.createBiquadFilter()
  echoLow.type = 'highpass'
  echoLow.frequency.value = 320
  const delay = context.createDelay(2)
  delay.delayTime.value = 0.45
  const echoTone = context.createBiquadFilter()
  echoTone.type = 'lowpass'
  echoTone.frequency.value = 2800
  const feedback = context.createGain()
  feedback.gain.value = 0.3
  const echoReturn = context.createGain()
  echoReturn.gain.value = 0.34
  const echoToHall = context.createGain()
  echoToHall.gain.value = 0.35
  echoInput.connect(echoLow)
  echoLow.connect(delay)
  delay.connect(echoTone)
  echoTone.connect(feedback)
  feedback.connect(delay)
  echoTone.connect(echoReturn)
  echoReturn.connect(output)
  echoReturn.connect(echoToHall)
  echoToHall.connect(reverbInput)

  return {
    input,
    reverbInput,
    echoInput,
    reverbReturn,
    delay,
    output,
    submixes: new Map(),
    nodes: [
      output, input, rumble, reverbInput, reverbLow, convolver, reverbHigh, reverbReturn,
      echoInput, echoLow, delay, echoTone, feedback, echoReturn, echoToHall,
    ],
  }
}

/**
 * Stereo hall impulse: a short pre-delay, sparse early reflections alternating between
 * the walls, then a diffuse tail that loses its highs as it decays (RT60 ≈ 1.7 s).
 */
export function createHallImpulse(context: BaseAudioContext, seed: number): AudioBuffer {
  const sampleRate = context.sampleRate
  const reverberation = 1.7
  const length = Math.floor(sampleRate * 2)
  const buffer = context.createBuffer(2, length, sampleRate)
  const preDelay = Math.round(sampleRate * 0.016)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    const random = createNoise((seed ^ (channel === 0 ? 0x2c1b3c6d : 0x297a2d39)) >>> 0)
    let tapTime = 0.004
    for (let tap = 0; tap < 12; tap += 1) {
      tapTime += 0.004 + (random() * 0.5 + 0.5) * 0.007
      const index = preDelay + Math.round(tapTime * sampleRate)
      if (index < length) data[index] += (random() < 0 ? -1 : 1) * 0.5 * 0.86 ** tap
    }
    const tailStart = preDelay + Math.round(0.02 * sampleRate)
    let smoothed = 0
    for (let index = tailStart; index < length; index += 1) {
      const time = (index - tailStart) / sampleRate
      const progress = time / reverberation
      smoothed += (0.9 - 0.62 * Math.min(1, progress)) * (random() - smoothed)
      data[index] += smoothed * Math.exp(-6.91 * progress) * Math.min(1, time / 0.06) * 0.32
    }
    const fade = Math.round(sampleRate * 0.1)
    for (let index = 0; index < fade; index += 1) data[length - 1 - index] *= index / fade
  }
  return buffer
}

export function playMusicTone(
  sink: MusicSink,
  event: MusicToneEvent,
  time: number,
  duration: number,
  colour: MusicColour,
): void {
  const voice = MUSIC_VOICES[event.instrument]
  if (voice.kind === 'sample') playSampleVoice(sink, voice, event, time, duration, colour)
  else playOscillatorVoice(sink, voice, event, time, duration, colour)
}

function playOscillatorVoice(
  sink: MusicSink,
  spec: OscillatorVoiceSpec,
  event: MusicToneEvent,
  time: number,
  duration: number,
  colour: MusicColour,
): void {
  const { context } = sink
  const shift = spec.octaveShift ?? 0
  const frequency = midiToFrequency(event.midi + shift)
  const velocity = event.velocity
  const length = Math.max(0.05, duration)
  const attack = Math.min(spec.attack, length * 0.5)
  const end = time + length
  const stopAt = end + spec.release * 1.25 + 0.02
  const nodes: AudioNode[] = []
  const sources: AudioScheduledSourceNode[] = []

  const filter = context.createBiquadFilter()
  filter.type = spec.filter.type
  filter.Q.setValueAtTime(spec.filter.q, time)
  const cutoff = clamp(
    (spec.filter.base + spec.filter.velocity * velocity + spec.filter.keyTrack * frequency) *
      colour.brightness,
    160,
    16000,
  )
  if (spec.filter.bloom) {
    filter.frequency.setValueAtTime(cutoff * spec.filter.bloom.start, time)
    filter.frequency.linearRampToValueAtTime(cutoff, time + attack + 0.015)
    // A bounded ramp rather than an open-ended target, so the filter stops recomputing its
    // coefficients every sample once the note has bloomed.
    filter.frequency.linearRampToValueAtTime(
      cutoff * spec.filter.bloom.settle,
      Math.max(time + attack + 0.03, Math.min(end, time + attack + 0.35)),
    )
  } else {
    filter.frequency.setValueAtTime(cutoff, time)
  }
  const envelope = context.createGain()
  const peak = spec.gain * velocityCurve(velocity)
  // Every gain starts closed: a param left at its default of 1 until its first event lets the
  // first frame of a source that starts a sample early through at full level, as a click.
  envelope.gain.value = 0
  envelope.gain.setValueAtTime(0, time)
  envelope.gain.linearRampToValueAtTime(peak, time + attack)
  envelope.gain.setTargetAtTime(peak * spec.sustain, time + attack, spec.decay / 3)
  envelope.gain.setTargetAtTime(0, end, spec.release / 5)
  filter.connect(envelope)
  nodes.push(filter, envelope)

  const wave = sink.waves.get(event.instrument, spec.wave, frequency)
  const oscillators: OscillatorNode[] = []
  for (const cents of spec.unison) {
    const oscillator = context.createOscillator()
    if (wave) oscillator.setPeriodicWave(wave)
    else oscillator.type = 'sawtooth'
    oscillator.frequency.setValueAtTime(frequency, time)
    if (spec.scoop) {
      oscillator.detune.setValueAtTime(cents + spec.scoop.cents, time)
      oscillator.detune.linearRampToValueAtTime(cents, time + spec.scoop.time)
    } else {
      oscillator.detune.setValueAtTime(cents, time)
    }
    oscillator.connect(filter)
    oscillators.push(oscillator)
  }
  applyOrnament(oscillators.map((oscillator) => oscillator.frequency), event, time, length, shift)

  const vibrato = spec.vibrato
  if (vibrato && length > vibrato.delay + 0.08) {
    const lfo = context.createOscillator()
    lfo.frequency.setValueAtTime(vibrato.rate * (0.95 + 0.1 * hashUnit(event.midi)), time)
    const depth = context.createGain()
    depth.gain.value = 0
    depth.gain.setValueAtTime(0, time)
    depth.gain.setValueAtTime(0, time + vibrato.delay)
    depth.gain.linearRampToValueAtTime(vibrato.depth, time + vibrato.delay + vibrato.rise)
    lfo.connect(depth)
    for (const oscillator of oscillators) depth.connect(oscillator.detune)
    lfo.start(time)
    lfo.stop(stopAt)
    sources.push(lfo)
    nodes.push(depth)
  }

  const breath = spec.breath
  if (breath) {
    const noise = context.createBufferSource()
    noise.buffer = sink.noise
    noise.loop = true
    const band = context.createBiquadFilter()
    if (breath.highpass) {
      band.type = 'highpass'
      band.frequency.setValueAtTime(breath.highpass, time)
    } else {
      band.type = 'bandpass'
      band.frequency.setValueAtTime(Math.min(12000, frequency * (breath.ratio ?? 2)), time)
    }
    band.Q.setValueAtTime(breath.q, time)
    const level = context.createGain()
    level.gain.value = 0
    level.gain.setValueAtTime(breath.gain * breath.chiff, time)
    level.gain.setTargetAtTime(breath.gain, time + attack * 0.5, 0.04)
    noise.connect(band)
    band.connect(level)
    level.connect(envelope)
    noise.start(time, hashUnit(event.midi * 7 + 3) * Math.max(0, sink.noise.duration - 0.05))
    noise.stop(stopAt)
    sources.push(noise)
    nodes.push(band, level)
  }

  connectOutput(sink, envelope, event.pan, time, event.instrument, spec.reverb, spec.echo, nodes)
  for (const oscillator of oscillators) {
    oscillator.start(time)
    oscillator.stop(stopAt)
    sources.push(oscillator)
  }
  sink.track(sources, nodes)
}

/** Grace notes, mordents and trills as pitch automation on the sounding oscillators. */
function applyOrnament(
  params: readonly AudioParam[],
  event: MusicToneEvent,
  time: number,
  length: number,
  shift: number,
): void {
  if (!event.ornament || event.ornament === 'tremolo' || event.ornamentMidi === undefined) return
  const main = midiToFrequency(event.midi + shift)
  const neighbour = midiToFrequency(event.ornamentMidi + shift)
  for (const param of params) {
    if (event.ornament === 'grace') {
      param.setValueAtTime(neighbour, time)
      param.setValueAtTime(main, time + 0.055)
    } else if (event.ornament === 'lowerGrace') {
      param.setValueAtTime(neighbour, time)
      param.exponentialRampToValueAtTime(main, time + 0.07)
    } else if (event.ornament === 'mordent') {
      param.setValueAtTime(main, time)
      param.setValueAtTime(neighbour, time + 0.05)
      param.setValueAtTime(main, time + 0.1)
    } else {
      const span = Math.min(0.9, length * 0.65)
      let at = time
      let upper = false
      while (at < time + span) {
        param.setValueAtTime(upper ? neighbour : main, at)
        upper = !upper
        at += 0.062
      }
      param.setValueAtTime(main, at)
    }
  }
}

interface Pluck {
  time: number
  midi: number
  level: number
  /** When the string is damped (by the written end or by the next stroke). */
  until: number
}

/** Ornaments on plucked strings are extra strokes; tremolo re-plucks about 11 times a second. */
function plucksFor(event: MusicToneEvent, time: number, length: number): Pluck[] {
  const end = time + length
  const neighbour = event.ornamentMidi
  if (event.ornament === 'tremolo') {
    const interval = 1 / 11.5
    const plucks: Pluck[] = []
    for (let at = time, index = 0; at < end - 0.02 && index < 28; at += interval, index += 1) {
      plucks.push({ time: at, midi: event.midi, level: index % 2 === 0 ? 1 : 0.8, until: at + interval * 1.6 })
    }
    if (plucks.length > 0) plucks[plucks.length - 1].until = end
    return plucks
  }
  if (neighbour !== undefined && (event.ornament === 'grace' || event.ornament === 'lowerGrace')) {
    return [
      { time, midi: neighbour, level: 0.7, until: time + 0.07 },
      { time: time + 0.06, midi: event.midi, level: 1, until: end },
    ]
  }
  if (neighbour !== undefined && event.ornament === 'mordent') {
    return [
      { time, midi: event.midi, level: 1, until: time + 0.07 },
      { time: time + 0.06, midi: neighbour, level: 0.7, until: time + 0.13 },
      { time: time + 0.12, midi: event.midi, level: 0.85, until: end },
    ]
  }
  if (neighbour !== undefined && event.ornament === 'trill') {
    const plucks: Pluck[] = []
    const span = Math.min(0.6, length * 0.6)
    for (let at = time, index = 0; at < time + span; at += 0.08, index += 1) {
      plucks.push({ time: at, midi: index % 2 === 0 ? event.midi : neighbour, level: 0.85, until: at + 0.09 })
    }
    plucks.push({ time: time + span, midi: event.midi, level: 0.9, until: end })
    return plucks
  }
  return [{ time, midi: event.midi, level: 1, until: end }]
}

function playSampleVoice(
  sink: MusicSink,
  spec: SampleVoiceSpec,
  event: MusicToneEvent,
  time: number,
  duration: number,
  colour: MusicColour,
): void {
  const { context } = sink
  const length = Math.max(0.05, duration)
  // A recording still being rendered is queued and the stroke skipped, never rendered here.
  const strokes = plucksFor(event, time, length)
    .map((pluck) => ({ pluck, recording: sink.bank.pitched(spec.sample, pluck.midi) }))
    .filter((stroke): stroke is { pluck: Pluck; recording: { buffer: AudioBuffer; rate: number } } =>
      stroke.recording !== null,
    )
  if (strokes.length === 0) return
  const nodes: AudioNode[] = []
  const sources: AudioScheduledSourceNode[] = []
  const tone = context.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.setValueAtTime(
    clamp((spec.tone[0] + spec.tone[1] * event.velocity) * colour.brightness, 300, 16000),
    time,
  )
  tone.Q.setValueAtTime(0.5, time)
  nodes.push(tone)
  connectOutput(sink, tone, event.pan, time, event.instrument, spec.reverb, spec.echo, nodes)
  const level = spec.gain * velocityCurve(event.velocity)
  for (const { pluck, recording } of strokes) {
    const { buffer, rate } = recording
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.setValueAtTime(rate, pluck.time)
    const envelope = context.createGain()
    envelope.gain.value = 0
    envelope.gain.setValueAtTime(level * pluck.level, pluck.time)
    envelope.gain.setTargetAtTime(0, Math.max(pluck.time + 0.01, pluck.until), spec.release / 5)
    source.connect(envelope)
    envelope.connect(tone)
    const natural = pluck.time + buffer.duration / rate
    source.start(pluck.time)
    source.stop(Math.min(natural, pluck.until + spec.release * 1.25) + 0.01)
    sources.push(source)
    nodes.push(envelope)
  }
  sink.track(sources, nodes)
}

export function playMusicDrum(
  sink: MusicSink,
  event: MusicDrumEvent,
  time: number,
  colour: MusicColour,
): void {
  const { context } = sink
  const spec = DRUMS[event.drum]
  let buffer: AudioBuffer
  let rate = 1
  if (spec.sample === 'timpani') {
    const pitched = sink.bank.pitched('timpani', event.midi ?? 45)
    if (!pitched) return
    buffer = pitched.buffer
    rate = pitched.rate
  } else {
    const recording = sink.bank.oneShot(spec.sample)
    if (!recording) return
    buffer = recording
    if (spec.root !== undefined && event.midi !== undefined) rate = 2 ** ((event.midi - spec.root) / 12)
    if (event.drum === 'kick' || event.drum === 'tom' || event.drum === 'frameDrum') rate *= colour.kitRate
  }
  const source = context.createBufferSource()
  source.buffer = buffer
  source.playbackRate.setValueAtTime(rate, time)
  const gain = context.createGain()
  gain.gain.value = 0
  gain.gain.setValueAtTime(spec.gain * velocityCurve(event.velocity, 1.4), time)
  source.connect(gain)
  const nodes: AudioNode[] = [gain]
  let head: AudioNode = gain
  if (colour.muffled && (event.drum === 'kick' || event.drum === 'snare' || event.drum === 'tom')) {
    const muffle = context.createBiquadFilter()
    muffle.type = 'lowpass'
    muffle.frequency.setValueAtTime(720, time)
    gain.connect(muffle)
    head = muffle
    nodes.push(muffle)
  }
  connectOutput(sink, head, event.pan, time, `drum:${event.drum}`, spec.reverb, 0, nodes)
  source.start(time)
  source.stop(time + buffer.duration / rate + 0.01)
  sink.track([source], nodes)
}

/** Pans a note onto its instrument's mix strip. */
function connectOutput(
  sink: MusicSink,
  node: AudioNode,
  pan: number,
  time: number,
  strip: string,
  reverb: number,
  echo: number,
  nodes: AudioNode[],
): void {
  const panner = sink.context.createStereoPanner()
  panner.pan.value = pan
  panner.pan.setValueAtTime(pan, time)
  node.connect(panner)
  panner.connect(mixStrip(sink, strip, reverb, echo))
  nodes.push(panner)
}

/**
 * Sends are taken once per instrument rather than once per note, so a dense bar does not
 * build hundreds of short-lived send gains.
 */
function mixStrip(sink: MusicSink, strip: string, reverb: number, echo: number): GainNode {
  const { context, bus } = sink
  const existing = bus.submixes.get(strip)
  if (existing) return existing
  const gain = context.createGain()
  gain.connect(bus.input)
  bus.nodes.push(gain)
  for (const [amount, target] of [[reverb, bus.reverbInput], [echo, bus.echoInput]] as const) {
    if (amount <= 0) continue
    const send = context.createGain()
    send.gain.value = amount
    gain.connect(send)
    send.connect(target)
    bus.nodes.push(send)
  }
  bus.submixes.set(strip, gain)
  return gain
}

/** Perceptual loudness for a 0..1 velocity. */
function velocityCurve(velocity: number, exponent = 1.5): number {
  return Math.max(0, Math.min(1, velocity)) ** exponent
}

function hashUnit(value: number): number {
  return (Math.imul(Math.round(value * 1000) | 0, 0x9e3779b1) >>> 0) / 0x100000000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
