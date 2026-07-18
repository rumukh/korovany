import type * as THREE from 'three'
import type { Faction, ZoneId } from './types'

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
}

export interface NoiseLayer {
  kind: 'noise'
  filterType: BiquadFilterType
  filterFrequency: FrequencyRange
  filterEndFrequency?: FrequencyRange
  q: GainRange
  attack: number
  hold: number
  release: number
  gain: GainRange
  delay?: number
  minIntensity?: number
}

export type AudioLayer = ToneLayer | NoiseLayer

export interface CueRecipe {
  priority: number
  cooldown: number
  maxConcurrent: number
  category: 'gameplay' | 'ui'
  pitchRange?: FrequencyRange
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
const GAMEPLAY_GAIN = 0.62
const UI_GAIN = 0.48

const MUSIC_PATTERNS: Record<Faction, readonly number[]> = {
  elf: [0, 4, 7, 12, 7, 4, 2, 4, 0, 4, 9, 12, 9, 4, 2, -1, 0, 4, 7, 11, 7, 4, 2, 4, 0, 5, 9, 12, 9, 5, 2, 4],
  guard: [0, 7, 12, 7, 5, 9, 12, 9, 3, 7, 10, 15, 10, 7, 5, 3, 0, 7, 12, 14, 12, 7, 5, 7, 3, 7, 10, 12, 10, 7, 5, 2],
  villain: [0, 3, 7, 10, 7, 3, -2, 3, 0, 3, 6, 10, 6, 3, -2, -5, 0, 3, 7, 12, 7, 3, 1, 3, 0, 5, 8, 12, 8, 5, 1, -2],
}

const MUSIC_ROOTS: Record<Faction, number> = {
  elf: 57,
  guard: 55,
  villain: 52,
}

const MUSIC_TEMPOS: Record<Faction, number> = {
  elf: 138,
  guard: 128,
  villain: 132,
}

const ZONE_MUSIC_SHIFTS: Record<ZoneId, number> = {
  neutral: 2,
  palace: 5,
  forest: 0,
  fort: -2,
}

const tone = (
  waveform: OscillatorType,
  startFrequency: FrequencyRange,
  endFrequency: FrequencyRange,
  gain: GainRange,
  attack: number,
  hold: number,
  release: number,
  options: Pick<ToneLayer, 'delay' | 'body' | 'minIntensity'> = {},
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

const noise = (
  filterType: BiquadFilterType,
  filterFrequency: FrequencyRange,
  gain: GainRange,
  attack: number,
  hold: number,
  release: number,
  options: Pick<NoiseLayer, 'delay' | 'filterEndFrequency' | 'minIntensity'> = {},
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

const recipe = (
  priority: number,
  cooldown: number,
  maxConcurrent: number,
  category: 'gameplay' | 'ui',
  layers: readonly AudioLayer[],
  pitchRange?: FrequencyRange,
): CueRecipe => ({ priority, cooldown, maxConcurrent, category, layers, pitchRange })

export const AUDIO_RECIPES: Readonly<Record<SoundCue, CueRecipe>> = {
  swing: recipe(40, 0.06, 2, 'gameplay', [
    noise('bandpass', [950, 1420], [0.07, 0.09], 0.004, 0.025, 0.09, {
      filterEndFrequency: [360, 620],
    }),
    tone('triangle', [205, 235], [82, 105], [0.025, 0.04], 0.004, 0.012, 0.08),
  ]),
  hitLight: recipe(55, 0.025, 6, 'gameplay', [
    noise('highpass', [2100, 3000], [0.08, 0.11], 0.001, 0.008, 0.035),
    tone('triangle', [125, 155], [62, 82], [0.075, 0.105], 0.002, 0.018, 0.07, {
      body: true,
    }),
  ]),
  hitHeavy: recipe(75, 0.045, 3, 'gameplay', [
    noise('highpass', [2300, 3500], [0.105, 0.14], 0.001, 0.01, 0.045),
    tone('sine', [105, 132], [38, 52], [0.12, 0.16], 0.002, 0.035, 0.11, {
      body: true,
    }),
    tone('sawtooth', [185, 235], [72, 98], [0.025, 0.045], 0.001, 0.018, 0.065, {
      minIntensity: 0.35,
    }),
  ]),
  hurt: recipe(90, 0.08, 2, 'gameplay', [
    tone('sawtooth', [165, 205], [64, 88], [0.085, 0.12], 0.005, 0.025, 0.14, {
      body: true,
    }),
    noise('bandpass', [580, 880], [0.045, 0.065], 0.008, 0.035, 0.13, {
      filterEndFrequency: [240, 420],
    }),
  ], [0.94, 1.06]),
  block: recipe(90, 0.055, 2, 'gameplay', [
    tone('square', [820, 1080], [540, 720], [0.045, 0.07], 0.001, 0.018, 0.14),
    tone('sine', [112, 142], [48, 66], [0.1, 0.13], 0.001, 0.02, 0.095, {
      body: true,
    }),
    noise('highpass', [3200, 4700], [0.035, 0.055], 0.001, 0.004, 0.035),
  ]),
  gore: recipe(40, 0.075, 3, 'gameplay', [
    noise('lowpass', [460, 720], [0.075, 0.105], 0.004, 0.035, 0.13, {
      filterEndFrequency: [105, 190],
    }),
    tone('triangle', [112, 148], [42, 62], [0.04, 0.065], 0.003, 0.022, 0.12),
  ], [0.9, 1.04]),
  down: recipe(90, 0.1, 3, 'gameplay', [
    tone('sine', [118, 145], [34, 46], [0.13, 0.17], 0.003, 0.045, 0.24, {
      body: true,
    }),
    noise('lowpass', [720, 980], [0.075, 0.11], 0.003, 0.05, 0.22, {
      filterEndFrequency: [120, 220],
    }),
    tone('triangle', [260, 330], [92, 125], [0.035, 0.055], 0.002, 0.012, 0.11),
  ], [0.9, 1.04]),
  bow: recipe(40, 0.07, 2, 'gameplay', [
    noise('highpass', [2400, 3600], [0.045, 0.065], 0.001, 0.01, 0.055),
    tone('triangle', [410, 520], [125, 175], [0.055, 0.075], 0.002, 0.018, 0.12),
  ]),
  arrow: recipe(40, 0.035, 4, 'gameplay', [
    noise('bandpass', [1250, 2100], [0.055, 0.08], 0.002, 0.015, 0.085, {
      filterEndFrequency: [520, 850],
    }),
  ]),
  cleave: recipe(55, 0.09, 2, 'gameplay', [
    noise('bandpass', [620, 1150], [0.09, 0.125], 0.004, 0.045, 0.14, {
      filterEndFrequency: [180, 330],
    }),
    tone('sine', [185, 230], [48, 68], [0.075, 0.11], 0.003, 0.025, 0.16, {
      body: true,
    }),
  ]),
  attackTell: recipe(55, 0.1, 4, 'gameplay', [
    tone('square', [320, 510], [280, 420], [0.025, 0.045], 0.003, 0.025, 0.08),
  ]),
  whiff: recipe(20, 0.055, 2, 'gameplay', [
    noise('highpass', [1800, 2800], [0.03, 0.045], 0.002, 0.012, 0.065),
  ]),
  coin: recipe(75, 0.045, 2, 'ui', [
    tone('triangle', [650, 690], [890, 950], [0.045, 0.065], 0.003, 0.025, 0.11),
    tone('sine', [980, 1040], [1180, 1260], [0.025, 0.04], 0.002, 0.018, 0.09, {
      delay: 0.055,
    }),
  ]),
  lootReveal: recipe(75, 0.14, 2, 'ui', [
    tone('triangle', [520, 550], [520, 550], [0.045, 0.065], 0.004, 0.045, 0.15),
    tone('triangle', [650, 690], [650, 690], [0.045, 0.065], 0.004, 0.045, 0.15, {
      delay: 0.085,
    }),
    tone('sine', [820, 880], [820, 880], [0.055, 0.075], 0.004, 0.055, 0.2, {
      delay: 0.17,
      minIntensity: 0.3,
    }),
  ]),
  lootCollect: recipe(75, 0.065, 2, 'ui', [
    tone('triangle', [420, 470], [720, 810], [0.045, 0.065], 0.003, 0.025, 0.105),
    noise('highpass', [4200, 6200], [0.02, 0.035], 0.001, 0.005, 0.04, {
      delay: 0.045,
    }),
  ]),
  command: recipe(75, 0.09, 2, 'ui', [
    tone('triangle', [235, 255], [350, 380], [0.055, 0.075], 0.004, 0.035, 0.14),
  ]),
  objective: recipe(100, 0.16, 2, 'ui', [
    tone('triangle', [435, 455], [435, 455], [0.05, 0.07], 0.004, 0.04, 0.16),
    tone('triangle', [650, 680], [650, 680], [0.05, 0.07], 0.004, 0.04, 0.18, {
      delay: 0.09,
    }),
    tone('sine', [870, 900], [870, 900], [0.055, 0.075], 0.004, 0.05, 0.22, {
      delay: 0.18,
    }),
  ]),
  save: recipe(100, 0.12, 2, 'ui', [
    tone('triangle', [510, 535], [660, 700], [0.05, 0.07], 0.004, 0.035, 0.15),
    tone('sine', [680, 710], [680, 710], [0.035, 0.055], 0.003, 0.035, 0.16, {
      delay: 0.08,
    }),
  ]),
  jump: recipe(40, 0.08, 2, 'gameplay', [
    tone('triangle', [215, 235], [300, 325], [0.035, 0.05], 0.002, 0.018, 0.07),
  ]),
  land: recipe(40, 0.08, 2, 'gameplay', [
    noise('lowpass', [520, 760], [0.045, 0.065], 0.002, 0.014, 0.075),
    tone('sine', [105, 125], [54, 70], [0.04, 0.06], 0.002, 0.018, 0.08, {
      body: true,
    }),
  ]),
  event: recipe(75, 0.12, 2, 'ui', [
    tone('triangle', [320, 345], [485, 510], [0.05, 0.07], 0.004, 0.04, 0.16),
  ]),
  eventWin: recipe(100, 0.18, 2, 'ui', [
    tone('triangle', [435, 460], [435, 460], [0.055, 0.075], 0.004, 0.045, 0.17),
    tone('triangle', [660, 690], [660, 690], [0.05, 0.07], 0.004, 0.045, 0.18, {
      delay: 0.09,
    }),
    tone('sine', [970, 1010], [970, 1010], [0.06, 0.08], 0.004, 0.06, 0.24, {
      delay: 0.18,
    }),
  ]),
  eventFail: recipe(100, 0.18, 2, 'ui', [
    tone('sawtooth', [185, 205], [76, 94], [0.075, 0.1], 0.004, 0.04, 0.23),
    noise('lowpass', [420, 620], [0.04, 0.06], 0.003, 0.025, 0.18, {
      filterEndFrequency: [95, 145],
    }),
  ], [0.94, 1.03]),
  victory: recipe(100, 0.3, 2, 'ui', [
    tone('triangle', [385, 405], [385, 405], [0.055, 0.075], 0.004, 0.06, 0.22),
    tone('triangle', [580, 610], [580, 610], [0.055, 0.075], 0.004, 0.06, 0.24, {
      delay: 0.12,
    }),
    tone('sine', [770, 800], [770, 800], [0.065, 0.085], 0.004, 0.08, 0.31, {
      delay: 0.24,
    }),
  ]),
  defeat: recipe(100, 0.3, 2, 'ui', [
    tone('sine', [118, 142], [32, 44], [0.13, 0.17], 0.003, 0.05, 0.27, {
      body: true,
    }),
    noise('lowpass', [620, 900], [0.075, 0.105], 0.004, 0.05, 0.24, {
      filterEndFrequency: [90, 145],
    }),
    tone('sawtooth', [190, 230], [58, 78], [0.035, 0.055], 0.002, 0.018, 0.15),
  ], [0.9, 1.03]),
  achievement: recipe(100, 0.12, 2, 'ui', [
    tone('triangle', [645, 675], [645, 675], [0.05, 0.07], 0.004, 0.04, 0.25),
    tone('triangle', [865, 895], [865, 895], [0.05, 0.07], 0.004, 0.04, 0.25, {
      delay: 0.085,
    }),
    tone('sine', [1150, 1200], [1150, 1200], [0.055, 0.075], 0.004, 0.05, 0.29, {
      delay: 0.17,
    }),
  ]),
  thunder: recipe(55, 0.9, 1, 'gameplay', [
    noise('lowpass', [460, 580], [0.12, 0.16], 0.02, 0.18, 0.98, {
      filterEndFrequency: [62, 82],
    }),
    tone('sine', [72, 88], [32, 42], [0.045, 0.07], 0.015, 0.12, 0.72, {
      body: true,
    }),
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

const centeredWorldCues = new Set<SoundCue>(['swing', 'hurt', 'block', 'jump', 'land'])

export class AudioDirector {
  private context: AudioContext | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private uiGain: GainNode | null = null
  private masterCompressor: DynamicsCompressorNode | null = null
  private masterGain: GainNode | null = null
  private sharedNoiseBuffer: AudioBuffer | null = null
  private musicTimer: number | null = null
  private musicNextNoteTime = 0
  private musicStep = 0
  private musicMuted: boolean
  private sfxVolume: number
  private paused = false
  private ended = false
  private hidden = document.hidden
  private destroyed = false
  private closeRequested = false
  private faction: Faction = 'elf'
  private zone: ZoneId = 'forest'
  private listener = { x: 0, y: 0, z: 0 }
  private listenerRight = { x: 1, y: 0, z: 0 }
  private nextVoiceId = 1
  private runtimeSeed = 0x9e3779b9
  private readonly activeVoices = new Map<number, ActiveVoice>()
  private readonly lastCueAt = new Map<SoundCue, number>()
  private readonly musicSources = new Map<AudioScheduledSourceNode, Set<AudioNode>>()
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
    this.sfxVolume = normalizeSfxVolume(settings.sfxVolume ?? SFX_VOLUME_DEFAULT)
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
          this.scheduleToneLayer(voice, layer, now, intensity, variation, index)
        } else {
          this.scheduleNoiseLayer(voice, layer, now, intensity, variation, index)
        }
      }
    } catch (error) {
      this.disposeUnstartedVoice(voice)
      console.warn(`Korovany: "${request.cue}" sound could not be scheduled.`, error)
      return
    }

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

  setMusicContext(faction: Faction, zone: ZoneId): void {
    this.faction = faction
    this.zone = zone
  }

  getDiagnostics(): AudioDirectorDiagnostics {
    const voices = [...this.activeVoices.values()]
    return {
      contextState: this.context?.state ?? 'none',
      activeVoices: voices.length,
      activeSources: voices.reduce((total, voice) => total + voice.sourceCount, 0),
      musicSources: this.musicSources.size,
      schedulerActive: this.musicTimer !== null,
      destroyed: this.destroyed,
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer)
      this.musicTimer = null
    }
    for (const voice of [...this.activeVoices.values()]) {
      this.stopSourceSet(voice.sources, `sound voice "${voice.cue}"`)
      this.disconnectNodes(voice.nodes)
    }
    this.activeVoices.clear()

    for (const [source, nodes] of this.musicSources) {
      this.stopSource(source, 'scheduled music source')
      source.disconnect()
      this.disconnectNodes(nodes)
    }
    this.musicSources.clear()

    const context = this.context
    for (const node of [
      this.musicGain,
      this.sfxGain,
      this.uiGain,
      this.masterCompressor,
      this.masterGain,
    ]) {
      node?.disconnect()
    }
    this.musicGain = null
    this.sfxGain = null
    this.uiGain = null
    this.masterCompressor = null
    this.masterGain = null
    this.sharedNoiseBuffer = null
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
    this.musicGain = context.createGain()
    this.sfxGain = context.createGain()
    this.uiGain = context.createGain()
    this.masterCompressor = context.createDynamicsCompressor()
    this.masterGain = context.createGain()
    this.masterCompressor.threshold.value = -18
    this.masterCompressor.knee.value = 12
    this.masterCompressor.ratio.value = 5
    this.masterCompressor.attack.value = 0.003
    this.masterCompressor.release.value = 0.18
    this.musicGain.connect(this.masterCompressor)
    this.sfxGain.connect(this.masterCompressor)
    this.uiGain.connect(this.masterCompressor)
    this.masterCompressor.connect(this.masterGain)
    this.masterGain.connect(context.destination)
    this.sharedNoiseBuffer = this.createNoiseBuffer(context)
    this.musicNextNoteTime = context.currentTime + 0.06
    this.updateBusTargets()
    this.scheduleMusic()
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 40)
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 1.5), context.sampleRate)
    const data = buffer.getChannelData(0)
    const random = createRandom(8297)
    for (let index = 0; index < data.length; index += 1) data[index] = random() * 2 - 1
    return buffer
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
    const musicGain = this.musicGain
    if (!context || !musicGain) return
    const target =
      this.hidden || this.musicMuted
        ? 0
        : this.ended
          ? MUSIC_ENDED_GAIN
          : this.paused
            ? MUSIC_PAUSED_GAIN
            : MUSIC_ACTIVE_GAIN
    rampParam(musicGain.gain, target, context.currentTime, 0.045)
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
    if (!context || !this.musicGain || context.state === 'closed') return
    const stepDuration = 60 / MUSIC_TEMPOS[this.faction] / 4
    if (this.musicNextNoteTime < context.currentTime - 0.5) {
      this.musicNextNoteTime = context.currentTime + 0.04
    }
    while (this.musicNextNoteTime < context.currentTime + 0.16) {
      if (!this.hidden && !this.musicMuted) {
        this.scheduleMusicStep(this.musicNextNoteTime, stepDuration)
      }
      this.musicStep = (this.musicStep + 1) % 128
      this.musicNextNoteTime += stepDuration
    }
  }

  private scheduleMusicStep(time: number, stepDuration: number): void {
    const chordOffsets = [0, -4, 3, -2]
    const chord = chordOffsets[Math.floor(this.musicStep / 16) % chordOffsets.length]
    const root = MUSIC_ROOTS[this.faction] + ZONE_MUSIC_SHIFTS[this.zone] + chord
    const pattern = MUSIC_PATTERNS[this.faction]
    const melody = root + pattern[this.musicStep % pattern.length]

    this.scheduleMusicTone(melody, time, stepDuration * 0.82, 'square', 0.09)
    if (this.musicStep % 4 === 0) {
      this.scheduleMusicTone(root - 12, time, stepDuration * 3.35, 'triangle', 0.12)
      this.scheduleMusicTone(root + 7, time, stepDuration * 2.6, 'square', 0.025)
      this.scheduleKick(time)
    }
    if (this.musicStep % 8 === 4) this.scheduleMusicNoise(time, 'snare')
    if (this.musicStep % 2 === 1) this.scheduleMusicNoise(time, 'hat')
  }

  private scheduleMusicTone(
    midi: number,
    time: number,
    duration: number,
    waveform: OscillatorType,
    volume: number,
  ): void {
    const context = this.context
    const musicGain = this.musicGain
    if (!context || !musicGain) return
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = waveform
    oscillator.frequency.setValueAtTime(midiToFrequency(midi), time)
    envelope.gain.setValueAtTime(MIN_GAIN, time)
    envelope.gain.exponentialRampToValueAtTime(volume, time + 0.008)
    envelope.gain.setValueAtTime(volume * 0.72, time + duration * 0.55)
    envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, time + duration)
    oscillator.connect(envelope)
    envelope.connect(musicGain)
    this.trackMusicSource(oscillator, [envelope])
    oscillator.start(time)
    oscillator.stop(time + duration + 0.02)
  }

  private scheduleKick(time: number): void {
    const context = this.context
    const musicGain = this.musicGain
    if (!context || !musicGain) return
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(125, time)
    oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.1)
    envelope.gain.setValueAtTime(0.16, time)
    envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, time + 0.12)
    oscillator.connect(envelope)
    envelope.connect(musicGain)
    this.trackMusicSource(oscillator, [envelope])
    oscillator.start(time)
    oscillator.stop(time + 0.13)
  }

  private scheduleMusicNoise(time: number, type: 'hat' | 'snare'): void {
    const context = this.context
    const musicGain = this.musicGain
    const buffer = this.sharedNoiseBuffer
    if (!context || !musicGain || !buffer) return
    const duration = type === 'hat' ? 0.035 : 0.1
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const envelope = context.createGain()
    source.buffer = buffer
    filter.type = type === 'hat' ? 'highpass' : 'bandpass'
    filter.frequency.setValueAtTime(type === 'hat' ? 5200 : 1450, time)
    filter.Q.setValueAtTime(type === 'hat' ? 0.7 : 0.9, time)
    envelope.gain.setValueAtTime(type === 'hat' ? 0.035 : 0.08, time)
    envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, time + duration)
    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(musicGain)
    this.trackMusicSource(source, [filter, envelope])
    source.start(time, 0, duration)
    source.stop(time + duration)
  }

  private trackMusicSource(source: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void {
    const trackedNodes = new Set(nodes)
    this.musicSources.set(source, trackedNodes)
    source.addEventListener(
      'ended',
      () => {
        source.disconnect()
        this.disconnectNodes(trackedNodes)
        this.musicSources.delete(source)
      },
      { once: true },
    )
  }

  private scheduleToneLayer(
    voice: ActiveVoice,
    layer: ToneLayer,
    now: number,
    intensity: number,
    variation: Variation,
    index: number,
  ): void {
    const context = this.context!
    const start = now + (layer.delay ?? 0)
    const duration = layer.attack + layer.hold + layer.release
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    const layerRandom = createRandom(variation.seed + index * 0x85ebca6b)
    const bodyBoost = layer.body ? dbToGain(6 * intensity) : 1
    const gain = clamp(
      randomRange(layer.gain, layerRandom) * variation.gainRatio * bodyBoost,
      MIN_GAIN,
      0.22,
    )
    const startFrequency = randomRange(layer.startFrequency, layerRandom) * variation.pitchRatio
    const lowEndShift = layer.body ? lerp(1, 0.82, intensity) : 1
    const endFrequency =
      randomRange(layer.endFrequency, layerRandom) * variation.pitchRatio * lowEndShift
    oscillator.type = layer.waveform
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

  private stopSource(source: AudioScheduledSourceNode, label: string): void {
    try {
      source.stop()
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

function midiToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

function scheduleEnvelope(
  gain: AudioParam,
  start: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
): void {
  gain.setValueAtTime(MIN_GAIN, start)
  gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN, peak), start + Math.max(0.001, attack))
  gain.setValueAtTime(Math.max(MIN_GAIN, peak * 0.76), start + attack + hold)
  gain.exponentialRampToValueAtTime(MIN_GAIN, start + attack + hold + release)
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
