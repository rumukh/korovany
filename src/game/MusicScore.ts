import type { Faction, ZoneId } from './types'

export type MusicIntensity = 'explore' | 'alert' | 'combat' | 'boss'
export type MusicTonePart = 'lead' | 'bass' | 'pad' | 'pulse'
export type MusicDrum = 'kick' | 'snare' | 'hat' | 'tom' | 'crash'

export interface MusicContext {
  faction: Faction
  zone: ZoneId
  intensity: MusicIntensity
  threatTier: number
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

export const MUSIC_STEPS_PER_BAR = 16
export const MUSIC_BARS_PER_CYCLE = 32
export const MUSIC_CYCLE_STEPS = MUSIC_STEPS_PER_BAR * MUSIC_BARS_PER_CYCLE

export const DEFAULT_MUSIC_CONTEXT: MusicContext = {
  faction: 'elf',
  zone: 'forest',
  intensity: 'explore',
  threatTier: 1,
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

export function getMusicTempo(faction: Faction): number {
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
