/**
 * Procedural recordings for everything in the score and the effects that is struck or
 * plucked: gusli, balalaika, pizzicato, bells, timpani, the drum kit, a shield, a coin and
 * thunder.
 *
 * An oscillator with an envelope cannot sound like a plucked string or a struck bell, so
 * these instruments are rendered once per audio context from physical models instead —
 * Karplus-Strong strings with a fractional-delay tuner and a resonant body, and banks of
 * decaying modes for membranes, bars, bells and metal. Every renderer is a pure function of
 * its parameters and the sample rate (noise uses fixed seeds), so the instruments sound the
 * same on every run and can be measured outside the browser.
 */

export type PitchedSampleName =
  | 'gusli'
  | 'balalaika'
  | 'pizzicato'
  | 'uprightBass'
  | 'celesta'
  | 'glockenspiel'
  | 'churchBell'
  | 'timpani'

export type OneShotSampleName =
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
  | 'shieldClang'
  | 'coin'
  | 'bowTwang'
  | 'thunder'

export interface PitchedSampleSpec {
  /** Lowest and highest MIDI notes the instrument is asked to play. */
  low: number
  high: number
  /** Semitones between rendered roots; playback rate covers the rest. */
  spacing: number
  sampleRate: number
  render: (midi: number, sampleRate: number) => RenderJob
}

export interface OneShotSampleSpec {
  sampleRate: number
  render: (sampleRate: number) => RenderJob
}

/**
 * A render that can pause. It yields every few thousand samples, so the bank can spread a
 * recording across frames instead of stalling one, and returns the finished PCM.
 */
export type RenderJob = Generator<void, Float32Array, void>
type Work = Generator<void, void, void>

/** Samples processed between pause points. */
const SLICE = 4096

/** Runs a render job to completion. */
export function runJob<T>(job: Generator<void, T, void>): T {
  for (;;) {
    const step = job.next()
    if (step.done) return step.value
  }
}

export interface BodyResonance {
  frequency: number
  q: number
  gain: number
}

export interface PluckOptions {
  frequency: number
  /** Rendered length in seconds. */
  duration: number
  /** Seconds for the fundamental to fall 60 dB. */
  decay: number
  /** 0 is a soft fingertip, 1 is a hard plectrum near the bridge. */
  brightness: number
  /** Pluck point as a fraction of the string; small values sound nasal. */
  pickPosition: number
  body?: readonly BodyResonance[]
  /** Adds a second string a few cents away, as on a doubled course. */
  courseDetuneCents?: number
  seed: number
}

export interface Mode {
  /** Frequency relative to the renderer's base frequency. */
  ratio: number
  gain: number
  /** Seconds to fall 60 dB. */
  decay: number
  /** Seconds to bloom in; gongs feed energy upward after the strike. */
  bloom?: number
  /** Splits the mode into a slowly beating pair, as real bells and plates do. */
  beat?: number
}

export interface NoiseBurst {
  filter: 'lowpass' | 'highpass' | 'bandpass'
  frequency: number
  /** Optional end frequency for a sweep across the burst. */
  frequencyEnd?: number
  q: number
  gain: number
  attack: number
  /** Seconds to fall 60 dB after the attack. */
  decay: number
  delay?: number
}

interface Glide {
  /** Extra frequency at the strike, as a fraction of the settled pitch. */
  amount: number
  /** Time constant of the settle, in seconds. */
  time: number
}

const TWO_PI = Math.PI * 2
const T60 = Math.log(1000)

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/** Deterministic white noise in [-1, 1). */
export function createNoise(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return (((value ^ (value >>> 14)) >>> 0) / 0x100000000) * 2 - 1
  }
}

interface Biquad {
  set(type: NoiseBurst['filter'], frequency: number, q: number): void
  process(input: number): number
}

/** RBJ cookbook biquad; the band-pass has 0 dB peak gain. */
export function createBiquad(sampleRate: number): Biquad {
  let b0 = 1
  let b1 = 0
  let b2 = 0
  let a1 = 0
  let a2 = 0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  return {
    set(type, frequency, q) {
      const clamped = Math.min(sampleRate * 0.45, Math.max(10, frequency))
      const w0 = (TWO_PI * clamped) / sampleRate
      const cos = Math.cos(w0)
      const alpha = Math.sin(w0) / (2 * Math.max(0.05, q))
      const a0 = 1 + alpha
      if (type === 'lowpass') {
        b0 = (1 - cos) / 2 / a0
        b1 = (1 - cos) / a0
        b2 = b0
      } else if (type === 'highpass') {
        b0 = (1 + cos) / 2 / a0
        b1 = -(1 + cos) / a0
        b2 = b0
      } else {
        b0 = alpha / a0
        b1 = 0
        b2 = -alpha / a0
      }
      a1 = (-2 * cos) / a0
      a2 = (1 - alpha) / a0
    },
    process(input) {
      const output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = input
      y2 = y1
      y1 = output
      return output
    },
  }
}

/**
 * Extended Karplus-Strong: a noise burst shaped by pluck position and hardness circulates
 * through a delay line whose loss is set from the requested T60, with an all-pass for the
 * fractional part of the period so high notes stay in tune.
 */
export function renderPluck(options: PluckOptions, sampleRate: number): Float32Array {
  return runJob(renderPluckJob(options, sampleRate))
}

export function* renderPluckJob(options: PluckOptions, sampleRate: number): RenderJob {
  const length = Math.max(1, Math.round(options.duration * sampleRate))
  const output = new Float32Array(length)
  yield* addString(output, sampleRate, options.frequency, options, options.seed, 1)
  if (options.courseDetuneCents) {
    const detuned = options.frequency * 2 ** (options.courseDetuneCents / 1200)
    yield* addString(output, sampleRate, detuned, options, options.seed ^ 0x5bd1e995, 0.72)
  }
  const bodied = options.body?.length ? yield* applyBody(output, sampleRate, options.body) : output
  return yield* finishSample(bodied, sampleRate, { fadeIn: 0.0006, fadeOut: 0.03 })
}

function* addString(
  output: Float32Array,
  sampleRate: number,
  frequency: number,
  options: PluckOptions,
  seed: number,
  level: number,
): Work {
  const period = sampleRate / frequency
  const brightness = clamp(options.brightness, 0, 1)
  const omega = (TWO_PI * frequency) / sampleRate
  const perPeriod = 10 ** (-3 / (Math.max(0.05, options.decay) * frequency))
  // Two-point loop filter: 0.5 is the classic dark average, smaller keeps overtones alive.
  // High strings lose too much to the average alone, so it is opened just enough for the
  // fundamental to reach the requested T60.
  const bound = (1 - perPeriod * perPeriod) / (2 * Math.max(1e-9, 1 - Math.cos(omega)))
  const ceiling = bound >= 0.25 ? 0.5 : (1 - Math.sqrt(1 - 4 * bound)) / 2
  const smoothing = Math.max(0.005, Math.min(lerp(0.5, 0.14, brightness), ceiling))
  const filterMagnitude = Math.sqrt(
    (1 - smoothing) ** 2 + smoothing ** 2 + 2 * smoothing * (1 - smoothing) * Math.cos(omega),
  )
  const loss = Math.min(0.99995, perPeriod / filterMagnitude)
  let delay = Math.floor(period - smoothing - 0.1)
  if (delay < 2) delay = 2
  const fraction = period - smoothing - delay
  const allpass = (1 - fraction) / (1 + fraction)

  const excitation = createExcitation(delay, brightness, options.pickPosition, seed)
  const line = new Float32Array(delay)
  let cursor = 0
  let previous = 0
  let allpassInput = 0
  let allpassOutput = 0
  for (let index = 0; index < output.length; index += 1) {
    const delayed = line[cursor]
    const filtered = loss * ((1 - smoothing) * delayed + smoothing * previous)
    previous = delayed
    const tuned = allpass * filtered + allpassInput - allpass * allpassOutput
    allpassInput = filtered
    allpassOutput = tuned
    const value = tuned + (index < excitation.length ? excitation[index] : 0)
    line[cursor] = value
    cursor = cursor + 1 === delay ? 0 : cursor + 1
    output[index] += value * level
    if (index % SLICE === SLICE - 1) yield
  }
}

function createExcitation(
  length: number,
  brightness: number,
  pickPosition: number,
  seed: number,
): Float32Array {
  const random = createNoise(seed)
  const raw = new Float32Array(length)
  // A soft pluck is mostly the string's triangular displacement; a hard one is mostly noise.
  const pick = clamp(pickPosition, 0.04, 0.5)
  const apex = Math.max(1, Math.round(pick * length))
  const coefficient = lerp(0.18, 0.92, brightness)
  let smoothed = 0
  for (let index = 0; index < length; index += 1) {
    const triangle = index < apex ? index / apex : (length - index) / Math.max(1, length - apex)
    smoothed += coefficient * (random() - smoothed)
    raw[index] = lerp(triangle * 1.6, smoothed * 2.2, 0.35 + brightness * 0.55)
  }
  // Plucking at a fraction of the length cancels the harmonics with a node there.
  const comb = Math.max(1, Math.round(pick * length))
  const shaped = new Float32Array(length)
  let mean = 0
  for (let index = 0; index < length; index += 1) {
    shaped[index] = raw[index] - 0.7 * (index >= comb ? raw[index - comb] : 0)
    mean += shaped[index]
  }
  mean /= length
  let peak = 0
  for (let index = 0; index < length; index += 1) {
    shaped[index] -= mean
    peak = Math.max(peak, Math.abs(shaped[index]))
  }
  if (peak > 0) for (let index = 0; index < length; index += 1) shaped[index] /= peak
  return shaped
}

function* applyBody(
  input: Float32Array,
  sampleRate: number,
  body: readonly BodyResonance[],
): RenderJob {
  const output = Float32Array.from(input)
  for (const resonance of body) {
    const filter = createBiquad(sampleRate)
    filter.set('bandpass', resonance.frequency, resonance.q)
    for (let index = 0; index < input.length; index += 1) {
      output[index] += filter.process(input[index]) * resonance.gain
      if (index % SLICE === SLICE - 1) yield
    }
  }
  return output
}

/**
 * Adds a bank of exponentially decaying modes. Fixed-pitch modes run as two-multiply
 * recursive resonators; gliding ones (membranes settling after the strike) integrate phase.
 */
export function* addModes(
  output: Float32Array,
  sampleRate: number,
  baseFrequency: number,
  modes: readonly Mode[],
  options: { start?: number; glide?: Glide; level?: number } = {},
): Work {
  const start = Math.max(0, Math.round((options.start ?? 0) * sampleRate))
  const level = options.level ?? 1
  for (const mode of modes) {
    const frequency = baseFrequency * mode.ratio
    if (frequency <= 0 || frequency >= sampleRate * 0.47) continue
    const gain = mode.gain * level
    yield* addMode(output, sampleRate, frequency, gain, mode.decay, mode.bloom, start, options.glide)
    if (mode.beat) {
      yield* addMode(
        output,
        sampleRate,
        frequency * (1 + mode.beat),
        gain * 0.45,
        mode.decay * 0.92,
        mode.bloom,
        start,
        options.glide,
      )
    }
  }
}

function* addMode(
  output: Float32Array,
  sampleRate: number,
  frequency: number,
  gain: number,
  decay: number,
  bloom: number | undefined,
  start: number,
  glide: Glide | undefined,
): Work {
  const perSample = Math.exp(-T60 / (Math.max(0.005, decay) * sampleRate))
  // Run until the mode is 100 dB down or the buffer ends.
  const audible = Math.ceil((Math.max(0.005, decay) * sampleRate * 5) / 3) + 1
  const end = Math.min(output.length, start + audible)
  const bloomFactor = bloom ? Math.exp(-1 / (bloom * sampleRate)) : 0
  let bloomState = 1

  if (glide && glide.amount !== 0) {
    const settle = Math.exp(-1 / (Math.max(0.001, glide.time) * sampleRate))
    let excess = glide.amount
    let phase = 0
    let amplitude = gain
    for (let index = start; index < end; index += 1) {
      const envelope = bloom ? 1 - bloomState : 1
      output[index] += Math.sin(phase) * amplitude * envelope
      phase += (TWO_PI * frequency * (1 + excess)) / sampleRate
      if (phase > TWO_PI) phase -= TWO_PI
      excess *= settle
      amplitude *= perSample
      bloomState *= bloomFactor
      if (index % SLICE === SLICE - 1) yield
    }
    return
  }

  const omega = (TWO_PI * frequency) / sampleRate
  const coefficient = 2 * perSample * Math.cos(omega)
  const squared = perSample * perSample
  // y[n] = gain * r^n * sin(n * omega): starts at zero, so the onset never clicks.
  let previous = (gain * Math.sin(-omega)) / perSample
  let current = 0
  for (let index = start; index < end; index += 1) {
    const envelope = bloom ? 1 - bloomState : 1
    output[index] += current * envelope
    const next = coefficient * current - squared * previous
    previous = current
    current = next
    bloomState *= bloomFactor
    if (index % SLICE === SLICE - 1) yield
  }
}

export function* addNoise(
  output: Float32Array,
  sampleRate: number,
  burst: NoiseBurst,
  seed: number,
): Work {
  const random = createNoise(seed)
  const filter = createBiquad(sampleRate)
  filter.set(burst.filter, burst.frequency, burst.q)
  const start = Math.max(0, Math.round((burst.delay ?? 0) * sampleRate))
  const attackSamples = Math.max(1, Math.round(burst.attack * sampleRate))
  const perSample = Math.exp(-T60 / (Math.max(0.002, burst.decay) * sampleRate))
  const audible = attackSamples + Math.ceil((Math.max(0.002, burst.decay) * sampleRate * 5) / 3)
  const end = Math.min(output.length, start + audible)
  const sweepRatio = burst.frequencyEnd ? burst.frequencyEnd / burst.frequency : 1
  let decayed = 1
  for (let index = start; index < end; index += 1) {
    const local = index - start
    if (sweepRatio !== 1 && local % 32 === 0) {
      const progress = local / Math.max(1, end - start)
      filter.set(burst.filter, burst.frequency * sweepRatio ** progress, burst.q)
    }
    let envelope: number
    if (local < attackSamples) {
      envelope = local / attackSamples
    } else {
      decayed *= perSample
      envelope = decayed
    }
    output[index] += filter.process(random()) * burst.gain * envelope
    if (local % SLICE === SLICE - 1) yield
  }
}

/** Removes DC, fades the ends so a truncated tail never clicks, and normalises the peak. */
export function* finishSample(
  input: Float32Array,
  sampleRate: number,
  options: { fadeIn?: number; fadeOut?: number; peak?: number } = {},
): RenderJob {
  const output = new Float32Array(input.length)
  const pole = 1 - (TWO_PI * 12) / sampleRate
  let previousInput = 0
  let previousOutput = 0
  let peak = 0
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index] - previousInput + pole * previousOutput
    previousInput = input[index]
    previousOutput = value
    output[index] = value
    if (index % SLICE === SLICE - 1) yield
  }
  const fadeIn = Math.min(output.length, Math.round((options.fadeIn ?? 0.0004) * sampleRate))
  for (let index = 0; index < fadeIn; index += 1) output[index] *= index / fadeIn
  const fadeOut = Math.min(output.length, Math.round((options.fadeOut ?? 0.02) * sampleRate))
  for (let index = 0; index < fadeOut; index += 1) {
    const position = output.length - 1 - index
    output[position] *= 0.5 - 0.5 * Math.cos((Math.PI * index) / fadeOut)
  }
  for (let index = 0; index < output.length; index += 1) {
    peak = Math.max(peak, Math.abs(output[index]))
    if (index % SLICE === SLICE - 1) yield
  }
  const target = options.peak ?? 0.9
  if (peak > 0) {
    const scale = target / peak
    for (let index = 0; index < output.length; index += 1) output[index] *= scale
  }
  return output
}

/** Sum of square waves at inharmonic ratios: the classic metallic source for cymbals. */
function* addMetal(
  output: Float32Array,
  sampleRate: number,
  frequencies: readonly number[],
  gain: number,
  decay: number,
  bandCenter: number,
  highpass: number,
): Work {
  const band = createBiquad(sampleRate)
  band.set('bandpass', bandCenter, 0.9)
  const high = createBiquad(sampleRate)
  high.set('highpass', highpass, 0.7)
  const phases = frequencies.map(() => 0)
  const steps = frequencies.map((frequency) => (TWO_PI * frequency) / sampleRate)
  const perSample = Math.exp(-T60 / (decay * sampleRate))
  const audible = Math.min(output.length, Math.ceil((decay * sampleRate * 5) / 3))
  let envelope = gain
  for (let index = 0; index < audible; index += 1) {
    let sum = 0
    for (let voice = 0; voice < phases.length; voice += 1) {
      phases[voice] += steps[voice]
      if (phases[voice] > TWO_PI) phases[voice] -= TWO_PI
      sum += phases[voice] < Math.PI ? 1 : -1
    }
    output[index] += high.process(band.process(sum / phases.length)) * envelope
    envelope *= perSample
    if (index % SLICE === SLICE - 1) yield
  }
}

function randomModes(
  count: number,
  low: number,
  high: number,
  decay: readonly [number, number],
  seed: number,
  bloom?: readonly [number, number],
): Mode[] {
  const random = createNoise(seed)
  const unit = () => random() * 0.5 + 0.5
  const modes: Mode[] = []
  for (let index = 0; index < count; index += 1) {
    const position = unit()
    const ratio = low * (high / low) ** position
    modes.push({
      ratio,
      gain: (0.4 + unit() * 0.6) / Math.sqrt(ratio / low),
      decay: lerp(decay[0], decay[1], unit()),
      // Higher partials receive their energy later, which is what makes a gong swell.
      ...(bloom ? { bloom: lerp(bloom[0], bloom[1], position) } : {}),
    })
  }
  return modes
}

function buffer(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(seconds * sampleRate)))
}

/** 0 at `low`, 1 at `high`. */
function span(midi: number, low: number, high: number): number {
  return clamp((midi - low) / (high - low), 0, 1)
}

export const PITCHED_SAMPLES: Readonly<Record<PitchedSampleName, PitchedSampleSpec>> = {
  // Zither harp: soft fingertip pluck, long shimmering ring, a wooden box under it.
  gusli: {
    low: 45,
    high: 98,
    spacing: 6,
    sampleRate: 32000,
    render: (midi, sampleRate) => {
      const t = span(midi, 45, 98)
      return renderPluckJob(
        {
          frequency: midiToFrequency(midi),
          duration: lerp(2.8, 1.3, t),
          decay: lerp(4.8, 1.7, t),
          brightness: 0.62,
          pickPosition: 0.19,
          courseDetuneCents: 2.6,
          body: [
            { frequency: 230, q: 1.4, gain: 0.55 },
            { frequency: 520, q: 2.1, gain: 0.34 },
            { frequency: 1240, q: 2.6, gain: 0.18 },
          ],
          seed: 0x6a09e667 + midi,
        },
        sampleRate,
      )
    },
  },
  // Prima balalaika: plectrum near the bridge, two unison strings, a bright triangular body.
  balalaika: {
    low: 50,
    high: 96,
    spacing: 6,
    sampleRate: 44100,
    render: (midi, sampleRate) => {
      const t = span(midi, 50, 96)
      return renderPluckJob(
        {
          frequency: midiToFrequency(midi),
          duration: lerp(1.7, 0.85, t),
          decay: lerp(1.5, 0.65, t),
          brightness: 0.9,
          pickPosition: 0.1,
          courseDetuneCents: 4.5,
          body: [
            { frequency: 320, q: 2.4, gain: 0.42 },
            { frequency: 1180, q: 3, gain: 0.36 },
            { frequency: 2650, q: 3.4, gain: 0.22 },
          ],
          seed: 0xbb67ae85 + midi,
        },
        sampleRate,
      )
    },
  },
  // A section's pizzicato: dull finger, short ring, violin-family body formants.
  pizzicato: {
    low: 31,
    high: 86,
    spacing: 6,
    sampleRate: 32000,
    render: (midi, sampleRate) => {
      const t = span(midi, 31, 86)
      return renderPluckJob(
        {
          frequency: midiToFrequency(midi),
          duration: lerp(1.1, 0.45, t),
          decay: lerp(0.85, 0.28, t),
          brightness: 0.34,
          pickPosition: 0.27,
          courseDetuneCents: 6,
          body: [
            { frequency: 280, q: 2, gain: 0.6 },
            { frequency: 460, q: 2.4, gain: 0.42 },
            { frequency: 1020, q: 2.6, gain: 0.24 },
            { frequency: 2500, q: 3, gain: 0.12 },
          ],
          seed: 0x3c6ef372 + midi,
        },
        sampleRate,
      )
    },
  },
  uprightBass: {
    low: 26,
    high: 62,
    spacing: 6,
    sampleRate: 22050,
    render: (midi, sampleRate) => {
      const t = span(midi, 26, 62)
      return renderPluckJob(
        {
          frequency: midiToFrequency(midi),
          duration: lerp(2, 1.1, t),
          decay: lerp(2.3, 1.1, t),
          brightness: 0.3,
          pickPosition: 0.23,
          body: [
            { frequency: 95, q: 1.5, gain: 0.5 },
            { frequency: 210, q: 2, gain: 0.34 },
            { frequency: 540, q: 2.4, gain: 0.16 },
          ],
          seed: 0xa54ff53a + midi,
        },
        sampleRate,
      )
    },
  },
  // Felt hammer on tuned steel bars over wooden resonators.
  celesta: {
    low: 60,
    high: 102,
    spacing: 7,
    sampleRate: 44100,
    render: function* (midi, sampleRate) {
      const t = span(midi, 60, 102)
      const output = buffer(lerp(2.2, 1.1, t), sampleRate)
      const ring = lerp(2.4, 0.95, t)
      yield* addModes(output, sampleRate, midiToFrequency(midi), [
        { ratio: 1, gain: 1, decay: ring },
        { ratio: 2, gain: 0.07, decay: ring * 0.5 },
        { ratio: 3.93, gain: 0.2, decay: ring * 0.22 },
        { ratio: 9.4, gain: 0.035, decay: 0.07 },
      ])
      yield* addNoise(output, sampleRate, {
        filter: 'lowpass', frequency: 2600, q: 0.7, gain: 0.05, attack: 0.0008, decay: 0.012,
      }, 0x510e527f + midi)
      return yield* finishSample(output, sampleRate)
    },
  },
  // Free-free steel bar partials (1 : 2.76 : 5.40 : 8.93) under a hard mallet.
  glockenspiel: {
    low: 70,
    high: 110,
    spacing: 7,
    sampleRate: 44100,
    render: function* (midi, sampleRate) {
      const t = span(midi, 70, 110)
      const output = buffer(lerp(1.7, 0.9, t), sampleRate)
      const ring = lerp(1.7, 0.7, t)
      yield* addModes(output, sampleRate, midiToFrequency(midi), [
        { ratio: 1, gain: 1, decay: ring },
        { ratio: 2.76, gain: 0.34, decay: ring * 0.3 },
        { ratio: 5.4, gain: 0.14, decay: ring * 0.12 },
        { ratio: 8.93, gain: 0.06, decay: 0.05 },
      ])
      yield* addNoise(output, sampleRate, {
        filter: 'highpass', frequency: 4200, q: 0.7, gain: 0.07, attack: 0.0005, decay: 0.01,
      }, 0x9b05688c + midi)
      return yield* finishSample(output, sampleRate)
    },
  },
  // Minor-third church bell: hum, prime, tierce, quint, nominal and upper partials, with
  // split mode pairs for the slow warble of a real casting.
  churchBell: {
    low: 40,
    high: 80,
    spacing: 7,
    sampleRate: 24000,
    render: function* (midi, sampleRate) {
      const t = span(midi, 40, 80)
      const output = buffer(lerp(4.6, 2.5, t), sampleRate)
      const scale = 2 ** ((60 - midi) / 30)
      yield* addModes(output, sampleRate, midiToFrequency(midi), [
        { ratio: 0.5, gain: 0.5, decay: 8 * scale, beat: 0.0011 },
        { ratio: 1, gain: 0.72, decay: 5.5 * scale, beat: 0.0008 },
        { ratio: 1.183, gain: 0.55, decay: 4.2 * scale, beat: 0.0013 },
        { ratio: 1.506, gain: 0.3, decay: 2.8 * scale },
        { ratio: 2, gain: 0.85, decay: 3.4 * scale, beat: 0.0009 },
        { ratio: 2.514, gain: 0.24, decay: 2.1 * scale },
        { ratio: 2.662, gain: 0.18, decay: 1.8 * scale },
        { ratio: 3.011, gain: 0.26, decay: 1.5 * scale },
        { ratio: 4.166, gain: 0.13, decay: 1 * scale },
        { ratio: 5.433, gain: 0.08, decay: 0.7 * scale },
        { ratio: 6.8, gain: 0.05, decay: 0.45 * scale },
      ])
      yield* addNoise(output, sampleRate, {
        filter: 'bandpass', frequency: 2100, q: 0.8, gain: 0.12, attack: 0.0006, decay: 0.05,
      }, 0x1f83d9ab + midi)
      return yield* finishSample(output, sampleRate, { fadeOut: 0.08 })
    },
  },
  // Kettle drum: the (1,1) principal and its near-harmonic family, a fast (0,1) thump and a
  // felt mallet.
  timpani: {
    low: 36,
    high: 60,
    spacing: 6,
    sampleRate: 32000,
    render: function* (midi, sampleRate) {
      const output = buffer(2.8, sampleRate)
      const principal = midiToFrequency(midi)
      yield* addModes(output, sampleRate, principal, [
        { ratio: 1, gain: 1, decay: 2.6 },
        { ratio: 1.504, gain: 0.5, decay: 1.8 },
        { ratio: 1.742, gain: 0.22, decay: 1.1 },
        { ratio: 2, gain: 0.28, decay: 1.3 },
        { ratio: 2.245, gain: 0.14, decay: 0.85 },
        { ratio: 2.494, gain: 0.11, decay: 0.75 },
        { ratio: 2.8, gain: 0.07, decay: 0.55 },
      ])
      yield* addModes(output, sampleRate, principal, [{ ratio: 0.82, gain: 0.55, decay: 0.2 }])
      yield* addNoise(output, sampleRate, {
        filter: 'lowpass', frequency: 1100, q: 0.7, gain: 0.2, attack: 0.001, decay: 0.035,
      }, 0x5be0cd19 + midi)
      return yield* finishSample(output, sampleRate, { fadeOut: 0.06 })
    },
  },
}

export const ONE_SHOT_SAMPLES: Readonly<Record<OneShotSampleName, OneShotSampleSpec>> = {
  // Folk bass drum: a slack head whose pitch drops right after the beater lands.
  kick: {
    sampleRate: 32000,
    render: function* (sampleRate) {
      const output = buffer(0.9, sampleRate)
      yield* addModes(output, sampleRate, 56, [
        { ratio: 1, gain: 1, decay: 0.62 },
        { ratio: 1.58, gain: 0.32, decay: 0.32 },
        { ratio: 2.18, gain: 0.16, decay: 0.2 },
      ], { glide: { amount: 0.6, time: 0.032 } })
      yield* addNoise(output, sampleRate, {
        filter: 'lowpass', frequency: 900, q: 0.7, gain: 0.28, attack: 0.0008, decay: 0.04,
      }, 11)
      yield* addNoise(output, sampleRate, {
        filter: 'highpass', frequency: 2600, q: 0.7, gain: 0.05, attack: 0.0005, decay: 0.008,
      }, 12)
      return yield* finishSample(output, sampleRate, { fadeOut: 0.05 })
    },
  },
  // Field snare: membrane modes plus the wire rattle a few milliseconds behind them.
  snare: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(0.55, sampleRate)
      yield* addModes(output, sampleRate, 182, [
        { ratio: 1, gain: 1, decay: 0.17 },
        { ratio: 1.59, gain: 0.5, decay: 0.12 },
        { ratio: 2.14, gain: 0.32, decay: 0.09 },
        { ratio: 2.65, gain: 0.18, decay: 0.07 },
      ], { glide: { amount: 0.16, time: 0.018 } })
      yield* addNoise(output, sampleRate, {
        filter: 'bandpass', frequency: 4300, q: 0.55, gain: 1.4, attack: 0.0015, decay: 0.24,
        delay: 0.0015,
      }, 21)
      yield* addNoise(output, sampleRate, {
        filter: 'highpass', frequency: 1800, q: 0.7, gain: 0.5, attack: 0.001, decay: 0.14,
      }, 22)
      return yield* finishSample(output, sampleRate)
    },
  },
  hat: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(0.22, sampleRate)
      yield* addMetal(output, sampleRate, [349, 517, 628, 888, 918, 1360], 1, 0.075, 9800, 7200)
      yield* addNoise(output, sampleRate, {
        filter: 'highpass', frequency: 8200, q: 0.7, gain: 0.35, attack: 0.0004, decay: 0.05,
      }, 31)
      return yield* finishSample(output, sampleRate)
    },
  },
  tom: {
    sampleRate: 32000,
    render: function* (sampleRate) {
      const output = buffer(0.75, sampleRate)
      yield* addModes(output, sampleRate, 112, [
        { ratio: 1, gain: 1, decay: 0.48 },
        { ratio: 1.59, gain: 0.38, decay: 0.26 },
        { ratio: 2.14, gain: 0.2, decay: 0.16 },
      ], { glide: { amount: 0.24, time: 0.05 } })
      yield* addNoise(output, sampleRate, {
        filter: 'lowpass', frequency: 2400, q: 0.7, gain: 0.16, attack: 0.0008, decay: 0.03,
      }, 41)
      return yield* finishSample(output, sampleRate, { fadeOut: 0.05 })
    },
  },
  // Suspended cymbal: inharmonic square stack for the bite, a random high mode cloud for the
  // shimmer that outlasts it.
  crash: {
    sampleRate: 32000,
    render: function* (sampleRate) {
      const output = buffer(2.6, sampleRate)
      yield* addMetal(output, sampleRate, [263, 401, 523, 698, 845, 1172], 0.9, 1.4, 6200, 3600)
      yield* addModes(output, sampleRate, 1, randomModes(12, 3200, 12500, [0.9, 2.3], 51), {
        level: 0.085,
      })
      yield* addNoise(output, sampleRate, {
        filter: 'bandpass', frequency: 5200, frequencyEnd: 3600, q: 0.45, gain: 0.55,
        attack: 0.002, decay: 1.9,
      }, 52)
      return yield* finishSample(output, sampleRate, { fadeOut: 0.12 })
    },
  },
  // Бубен: three jingle collisions a few milliseconds apart over a light skin slap.
  tambourine: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(0.45, sampleRate)
      const jingles = randomModes(9, 4800, 11000, [0.08, 0.2], 61)
      for (const [start, level] of [[0, 1], [0.009, 0.6], [0.021, 0.35]] as const) {
        yield* addModes(output, sampleRate, 1, jingles, { start, level: level * 0.16 })
      }
      yield* addNoise(output, sampleRate, {
        filter: 'highpass', frequency: 6800, q: 0.7, gain: 0.4, attack: 0.001, decay: 0.12,
      }, 62)
      yield* addModes(output, sampleRate, 230, [{ ratio: 1, gain: 0.25, decay: 0.06 }])
      return yield* finishSample(output, sampleRate)
    },
  },
  shaker: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(0.2, sampleRate)
      yield* addNoise(output, sampleRate, {
        filter: 'bandpass', frequency: 6400, q: 0.9, gain: 1, attack: 0.014, decay: 0.09,
      }, 71)
      return yield* finishSample(output, sampleRate)
    },
  },
  // Ложки: two wooden spoon backs clacking a moment apart.
  spoons: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(0.14, sampleRate)
      const clack: Mode[] = [
        { ratio: 2050, gain: 1, decay: 0.04 },
        { ratio: 3260, gain: 0.6, decay: 0.03 },
        { ratio: 4720, gain: 0.35, decay: 0.02 },
      ]
      yield* addModes(output, sampleRate, 1, clack, { level: 0.5 })
      yield* addModes(output, sampleRate, 1.06, clack, { start: 0.014, level: 0.32 })
      yield* addNoise(output, sampleRate, {
        filter: 'bandpass', frequency: 3000, q: 0.9, gain: 0.5, attack: 0.0003, decay: 0.01,
      }, 81)
      return yield* finishSample(output, sampleRate)
    },
  },
  frameDrum: {
    sampleRate: 32000,
    render: function* (sampleRate) {
      const output = buffer(0.6, sampleRate)
      yield* addModes(output, sampleRate, 94, [
        { ratio: 1, gain: 1, decay: 0.34 },
        { ratio: 1.5, gain: 0.42, decay: 0.2 },
        { ratio: 2.2, gain: 0.2, decay: 0.12 },
      ], { glide: { amount: 0.12, time: 0.03 } })
      yield* addNoise(output, sampleRate, {
        filter: 'bandpass', frequency: 1200, q: 0.8, gain: 0.3, attack: 0.0008, decay: 0.03,
      }, 91)
      return yield* finishSample(output, sampleRate, { fadeOut: 0.04 })
    },
  },
  // Бубенцы: a cluster of tiny harness bells shaken together — the caravan's own sound.
  sleighBells: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(0.6, sampleRate)
      const random = createNoise(101)
      for (let bell = 0; bell < 14; bell += 1) {
        const frequency = 3200 + (random() * 0.5 + 0.5) * 3300
        const start = (random() * 0.5 + 0.5) * 0.055
        const level = 0.35 + (random() * 0.5 + 0.5) * 0.65
        const decay = 0.18 + (random() * 0.5 + 0.5) * 0.17
        yield* addModes(output, sampleRate, frequency, [
          { ratio: 1, gain: 1, decay },
          { ratio: 2.41, gain: 0.4, decay: decay * 0.5 },
        ], { start, level: level * 0.2 })
      }
      yield* addNoise(output, sampleRate, {
        filter: 'bandpass', frequency: 7000, q: 0.8, gain: 0.25, attack: 0.002, decay: 0.07,
      }, 102)
      return yield* finishSample(output, sampleRate)
    },
  },
  anvil: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(2.2, sampleRate)
      yield* addModes(output, sampleRate, 880, [
        { ratio: 1, gain: 1, decay: 1.9, beat: 0.002 },
        { ratio: 2.43, gain: 0.6, decay: 1.2, beat: 0.0016 },
        { ratio: 3.71, gain: 0.42, decay: 0.85 },
        { ratio: 5.18, gain: 0.28, decay: 0.55 },
        { ratio: 7.1, gain: 0.16, decay: 0.35 },
      ])
      yield* addNoise(output, sampleRate, {
        filter: 'highpass', frequency: 3000, q: 0.7, gain: 0.45, attack: 0.0004, decay: 0.02,
      }, 111)
      return yield* finishSample(output, sampleRate, { fadeOut: 0.06 })
    },
  },
  // Tam-tam: a low strike whose energy blooms upward into a long metallic wash.
  gong: {
    sampleRate: 24000,
    render: function* (sampleRate) {
      const output = buffer(4.8, sampleRate)
      yield* addModes(output, sampleRate, 64, [{ ratio: 1, gain: 0.7, decay: 1.4 }])
      yield* addModes(output, sampleRate, 1, randomModes(22, 110, 2600, [2.4, 5.2], 121, [0.02, 0.9]), {
        level: 0.26,
      })
      yield* addNoise(output, sampleRate, {
        filter: 'lowpass', frequency: 760, q: 0.7, gain: 0.22, attack: 0.002, decay: 0.12,
      }, 122)
      return yield* finishSample(output, sampleRate, { fadeOut: 0.3 })
    },
  },
  // A round shield's boss and rim ringing after a blade lands on it.
  shieldClang: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(1, sampleRate)
      yield* addModes(output, sampleRate, 560, [
        { ratio: 1, gain: 1, decay: 0.7, beat: 0.003 },
        { ratio: 1.47, gain: 0.7, decay: 0.55 },
        { ratio: 2.09, gain: 0.62, decay: 0.42, beat: 0.0025 },
        { ratio: 2.56, gain: 0.45, decay: 0.34 },
        { ratio: 3.24, gain: 0.34, decay: 0.27 },
        { ratio: 4.11, gain: 0.24, decay: 0.2 },
        { ratio: 5.4, gain: 0.14, decay: 0.12 },
      ])
      yield* addNoise(output, sampleRate, {
        filter: 'bandpass', frequency: 3100, q: 0.7, gain: 0.55, attack: 0.0004, decay: 0.03,
      }, 131)
      yield* addModes(output, sampleRate, 140, [{ ratio: 1, gain: 0.4, decay: 0.08 }])
      return yield* finishSample(output, sampleRate)
    },
  },
  coin: {
    sampleRate: 44100,
    render: function* (sampleRate) {
      const output = buffer(0.6, sampleRate)
      yield* addModes(output, sampleRate, 2350, [
        { ratio: 1, gain: 1, decay: 0.48, beat: 0.004 },
        { ratio: 1.58, gain: 0.58, decay: 0.32 },
        { ratio: 2.31, gain: 0.38, decay: 0.22 },
        { ratio: 3.05, gain: 0.22, decay: 0.15 },
      ])
      yield* addNoise(output, sampleRate, {
        filter: 'highpass', frequency: 5000, q: 0.7, gain: 0.3, attack: 0.0003, decay: 0.005,
      }, 141)
      return yield* finishSample(output, sampleRate)
    },
  },
  // A bowstring snapping forward: a heavily damped, twangy low pluck.
  bowTwang: {
    sampleRate: 32000,
    render: (sampleRate) => renderPluckJob(
      {
        frequency: 94,
        duration: 0.7,
        decay: 0.42,
        brightness: 0.82,
        pickPosition: 0.07,
        body: [{ frequency: 190, q: 1.2, gain: 0.6 }, { frequency: 820, q: 2, gain: 0.25 }],
        seed: 151,
      },
      sampleRate,
    ),
  },
  // Rolling thunder: a dry crack, then brown-noise rolls arriving from further away.
  thunder: {
    sampleRate: 22050,
    render: function* (sampleRate) {
      const output = buffer(4.6, sampleRate)
      yield* addNoise(output, sampleRate, {
        filter: 'highpass', frequency: 900, q: 0.6, gain: 0.5, attack: 0.003, decay: 0.16,
      }, 161)
      const random = createNoise(162)
      const unit = () => random() * 0.5 + 0.5
      const brown = new Float32Array(output.length)
      let level = 0
      for (let index = 0; index < brown.length; index += 1) {
        level = level * 0.985 + random() * 0.12
        brown[index] = level
        if (index % SLICE === SLICE - 1) yield
      }
      const lowpass = createBiquad(sampleRate)
      lowpass.set('lowpass', 380, 0.8)
      const rolls = Array.from({ length: 6 }, (_, index) => ({
        start: index === 0 ? 0.04 : 0.15 + unit() * 2.3,
        attack: 0.06 + unit() * 0.2,
        decay: 0.8 + unit() * 1.3,
        gain: index === 0 ? 1 : 0.35 + unit() * 0.55,
      }))
      const envelopeAt = (time: number) => {
        let envelope = 0
        for (const roll of rolls) {
          if (time < roll.start) continue
          const local = time - roll.start
          const rise = local < roll.attack ? local / roll.attack : 1
          envelope += roll.gain * rise * Math.exp((-T60 * Math.max(0, local - roll.attack)) / roll.decay)
        }
        return envelope
      }
      // The rolls change slowly, so the envelope is evaluated at control rate.
      const block = 32
      let from = envelopeAt(0)
      for (let blockStart = 0; blockStart < output.length; blockStart += block) {
        const to = envelopeAt((blockStart + block) / sampleRate)
        const blockEnd = Math.min(output.length, blockStart + block)
        for (let index = blockStart; index < blockEnd; index += 1) {
          const envelope = from + ((to - from) * (index - blockStart)) / block
          output[index] += lowpass.process(brown[index]) * envelope * 1.6
        }
        from = to
        if (blockStart % SLICE === 0) yield
      }
      return yield* finishSample(output, sampleRate, { fadeOut: 0.4 })
    },
  },
}

/** MIDI roots rendered for a pitched instrument; playback rate covers the gaps. */
export function pitchedSampleRoots(name: PitchedSampleName): number[] {
  const spec = PITCHED_SAMPLES[name]
  const half = Math.ceil(spec.spacing / 2)
  const roots: number[] = []
  for (let midi = spec.low + Math.floor(spec.spacing / 2); ; midi += spec.spacing) {
    roots.push(Math.min(midi, spec.high))
    if (midi + half >= spec.high) break
  }
  return roots
}

/** The rendered root nearest to `midi`, so playback-rate shifts stay within half a spacing. */
export function nearestSampleRoot(name: PitchedSampleName, midi: number): number {
  const roots = pitchedSampleRoots(name)
  let best = roots[0]
  for (const root of roots) {
    if (Math.abs(root - midi) < Math.abs(best - midi)) best = root
  }
  return best
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}
