import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUDIO_RECIPES,
  MAX_ACTIVE_SOURCES,
  MAX_ACTIVE_VOICES,
  PAN_MAX,
  SFX_VOLUME_DEFAULT,
  calculateSpatialMix,
  cueKeyShift,
  isKnownSample,
  normalizeSfxVolume,
  planVoiceAdmission,
  swingDelay,
  type AdmissionVoiceSnapshot,
  type SoundCue,
} from '../src/game/AudioDirector.ts'
import {
  ONE_SHOT_SAMPLES,
  PITCHED_SAMPLES,
  midiToFrequency,
  nearestSampleRoot,
  pitchedSampleRoots,
  renderPluck,
  runJob,
  type PitchedSampleName,
} from '../src/game/AudioSamples.ts'
import {
  MUSIC_BARS_PER_CYCLE,
  MUSIC_CYCLE_STEPS,
  MUSIC_DRUMS,
  MUSIC_INSTRUMENTS,
  MUSIC_INSTRUMENT_RANGES,
  MUSIC_OUTCOME_STEPS,
  MUSIC_STEPS_PER_BAR,
  MUSIC_VARIATION_STEPS,
  getMusicHarmony,
  getMusicKey,
  getMusicSwing,
  getMusicTempo,
  isMusicBarBoundary,
  musicEnsembleInstruments,
  normalizeMusicContext,
  planMusicStep,
  planMusicTransition,
  type MusicContext,
  type MusicInstrument,
  type MusicIntensity,
} from '../src/game/MusicScore.ts'
import { MUSIC_VOICES, SampleBank, formantSpectrum } from '../src/game/MusicSynth.ts'

const FACTIONS: MusicContext['faction'][] = ['elf', 'guard', 'villain']
const ZONES: MusicContext['zone'][] = ['neutral', 'palace', 'forest', 'fort']
const INTENSITIES: MusicIntensity[] = ['explore', 'alert', 'combat', 'boss']

test('all recipes stay within the three-layer budget', () => {
  for (const [cue, recipe] of Object.entries(AUDIO_RECIPES)) {
    assert.ok(recipe.layers.length > 0, `${cue} must have at least one layer`)
    assert.ok(recipe.layers.length <= 3, `${cue} exceeds the layer budget`)
    assert.ok(recipe.maxConcurrent > 0, `${cue} needs a concurrency cap`)
    for (const layer of recipe.layers) {
      if (layer.kind !== 'sample') continue
      assert.ok(isKnownSample(layer.sample), `${cue} plays an unknown recording "${layer.sample}"`)
      if (layer.midi !== undefined) {
        assert.ok(layer.sample in PITCHED_SAMPLES, `${cue} pitches a one-shot recording`)
      }
    }
  }
})

test('the revised cues keep the specified priorities and caps', () => {
  const expected: Partial<Record<SoundCue, readonly [priority: number, cap: number]>> = {
    hitLight: [55, 6],
    hitHeavy: [75, 3],
    gore: [40, 3],
    swing: [40, 2],
    block: [90, 2],
    hurt: [90, 2],
    down: [90, 3],
    attackTell: [55, 4],
    arrow: [40, 4],
    whiff: [20, 2],
    lootCollect: [75, 2],
    event: [75, 2],
    eventFail: [100, 2],
    victory: [100, 2],
  }
  for (const [cue, [priority, cap]] of Object.entries(expected)) {
    const recipe = AUDIO_RECIPES[cue as SoundCue]
    assert.equal(recipe.priority, priority, `${cue} priority`)
    assert.equal(recipe.maxConcurrent, cap, `${cue} cap`)
  }
  // Keyed cues carry their pitch from the score, so no random detune may pull them off it.
  for (const [cue, recipe] of Object.entries(AUDIO_RECIPES)) {
    if (!recipe.keyed) continue
    const [low, high] = recipe.pitchRange ?? [0.94, 1.06]
    assert.ok(high / low < 1.025, `${cue} is keyed but detunes by ${high / low}`)
  }
})

test('cooldown and per-cue caps reject repeated voices', () => {
  const recipe = AUDIO_RECIPES.hitLight
  const active: AdmissionVoiceSnapshot[] = Array.from(
    { length: recipe.maxConcurrent },
    (_, index) => ({
      id: index,
      cue: 'hitLight',
      priority: recipe.priority,
      startedAt: index,
      sourceCount: recipe.layers.length,
    }),
  )

  assert.deepEqual(
    planVoiceAdmission(
      {
        cue: 'hitLight',
        priority: recipe.priority,
        cooldown: recipe.cooldown,
        maxConcurrent: recipe.maxConcurrent,
        sourceCount: recipe.layers.length,
        now: 1,
        lastPlayedAt: 0.99,
      },
      [],
    ),
    { admitted: false, reason: 'cooldown', victimIds: [] },
  )
  assert.equal(
    planVoiceAdmission(
      {
        cue: 'hitLight',
        priority: recipe.priority,
        cooldown: recipe.cooldown,
        maxConcurrent: recipe.maxConcurrent,
        sourceCount: recipe.layers.length,
        now: 2,
      },
      active,
    ).reason,
    'cue-cap',
  )
})

test('high-priority UI replaces the oldest low-priority voice at capacity', () => {
  const active: AdmissionVoiceSnapshot[] = Array.from(
    { length: MAX_ACTIVE_VOICES },
    (_, index) => ({
      id: index + 1,
      cue: 'whiff',
      priority: 20,
      startedAt: index,
      sourceCount: Math.floor(MAX_ACTIVE_SOURCES / MAX_ACTIVE_VOICES),
    }),
  )
  const recipe = AUDIO_RECIPES.victory
  const plan = planVoiceAdmission(
    {
      cue: 'victory',
      priority: recipe.priority,
      cooldown: recipe.cooldown,
      maxConcurrent: recipe.maxConcurrent,
      sourceCount: recipe.layers.length,
      now: 30,
    },
    active,
  )

  assert.equal(plan.admitted, true)
  assert.deepEqual(plan.victimIds, [1, 2])
})

test('equal-priority voices cannot evict at global capacity', () => {
  const active: AdmissionVoiceSnapshot[] = Array.from(
    { length: MAX_ACTIVE_VOICES },
    (_, index) => ({
      id: index + 1,
      cue: 'hitLight',
      priority: 55,
      startedAt: index,
      sourceCount: 2,
    }),
  )
  const plan = planVoiceAdmission(
    {
      cue: 'attackTell',
      priority: 55,
      cooldown: 0,
      maxConcurrent: 4,
      sourceCount: 1,
      now: 30,
    },
    active,
  )

  assert.deepEqual(plan, { admitted: false, reason: 'global-cap', victimIds: [] })
})

test('spatial placement attenuates and caps pan while near sounds stay centered', () => {
  const listener = { x: 0, y: 0, z: 0 }
  const right = { x: 1, y: 0, z: 0 }
  const near = calculateSpatialMix(listener, right, { x: 0.25, y: 0, z: 0 })
  const far = calculateSpatialMix(listener, right, { x: 84, y: 0, z: 0 })

  assert.ok(Math.abs(near.pan) < 0.05)
  assert.equal(far.pan, PAN_MAX)
  assert.equal(far.gain, 0.35)
})

test('SFX volume clamps finite values and rejects non-finite input', () => {
  assert.equal(normalizeSfxVolume(-1), 0)
  assert.equal(normalizeSfxVolume(2), 1)
  assert.equal(normalizeSfxVolume(0.45), 0.45)
  assert.equal(normalizeSfxVolume(Number.NaN), SFX_VOLUME_DEFAULT)
  assert.equal(normalizeSfxVolume(Number.POSITIVE_INFINITY), SFX_VOLUME_DEFAULT)
})

test('adaptive music cycle is deterministic, long-form, and bar aligned', () => {
  const context: MusicContext = {
    faction: 'elf',
    zone: 'forest',
    intensity: 'combat',
    threatTier: 3,
    outcome: 'none',
  }
  const firstPhrase = scoreSignature(context, 0x12345678, 0, 64)
  const secondPhrase = scoreSignature(context, 0x12345678, 64, 128)

  assert.notEqual(firstPhrase, secondPhrase)
  assert.equal(firstPhrase, scoreSignature(context, 0x12345678, 0, 64))
  // Each pass through the form is ornamented differently, and the whole variation
  // period repeats exactly.
  assert.notEqual(
    scoreSignature(context, 0x12345678, 0, MUSIC_CYCLE_STEPS),
    scoreSignature(context, 0x12345678, MUSIC_CYCLE_STEPS, MUSIC_CYCLE_STEPS * 2),
  )
  assert.equal(
    scoreSignature(context, 0x12345678, 0, MUSIC_CYCLE_STEPS),
    scoreSignature(context, 0x12345678, MUSIC_VARIATION_STEPS, MUSIC_VARIATION_STEPS + MUSIC_CYCLE_STEPS),
  )
  assert.equal(MUSIC_VARIATION_STEPS % MUSIC_CYCLE_STEPS, 0)
  for (const faction of FACTIONS) {
    assert.ok((MUSIC_CYCLE_STEPS / 4 / getMusicTempo(faction)) * 60 > 55)
  }
  for (let step = 0; step < MUSIC_CYCLE_STEPS; step += 1) {
    assert.equal(isMusicBarBoundary(step), step % MUSIC_STEPS_PER_BAR === 0)
  }
})

test('every pass keeps the same harmony under its variations', () => {
  const context: MusicContext = {
    faction: 'villain',
    zone: 'palace',
    intensity: 'alert',
    threatTier: 2,
    outcome: 'none',
  }
  const pads = (cycle: number) => {
    const notes: string[] = []
    for (let step = 0; step < MUSIC_CYCLE_STEPS; step += 1) {
      for (const event of planMusicStep(context, cycle * MUSIC_CYCLE_STEPS + step, 99)) {
        if (event.kind === 'tone' && event.part === 'pad') notes.push(`${step}:${event.midi}`)
      }
    }
    return notes.join(',')
  }
  assert.equal(pads(0), pads(1))
  assert.equal(pads(0), pads(5))
})

test('music intensity adds layers without replacing the underlying score', () => {
  const intensities: MusicIntensity[] = ['explore', 'alert', 'combat', 'boss']
  const eventCounts = intensities.map((intensity) => {
    const context: MusicContext = {
      faction: 'guard',
      zone: 'fort',
      intensity,
      threatTier: 4,
      outcome: 'none',
    }
    let count = 0
    for (let step = 0; step < MUSIC_CYCLE_STEPS; step += 1) {
      count += planMusicStep(context, step, 90210).length
    }
    return count
  })

  for (let index = 1; index < eventCounts.length; index += 1) {
    assert.ok(eventCounts[index] > eventCounts[index - 1])
  }
})

test('music plans remain valid across every faction, zone, and intensity', () => {
  const drums = new Set<string>(MUSIC_DRUMS)
  for (const faction of FACTIONS) {
    for (const zone of ZONES) {
      for (const intensity of INTENSITIES) {
        const context: MusicContext = {
          faction,
          zone,
          intensity,
          threatTier: 5,
          outcome: 'none',
        }
        for (let step = 0; step < MUSIC_VARIATION_STEPS; step += 1) {
          for (const event of planMusicStep(context, step, 77)) {
            assert.ok(event.velocity > 0 && event.velocity <= 1)
            assert.ok(event.pan >= -1 && event.pan <= 1)
            if (event.kind === 'tone') {
              assert.ok(Number.isFinite(event.midi) && event.midi >= 24 && event.midi <= 108)
              assert.ok(event.durationSteps > 0 && event.durationSteps <= MUSIC_STEPS_PER_BAR)
              const [low, high] = MUSIC_INSTRUMENT_RANGES[event.instrument]
              assert.ok(
                event.midi >= low && event.midi <= high,
                `${faction} ${zone} ${intensity}: ${event.instrument} out of range at ${event.midi}`,
              )
              assert.ok((event.offsetSteps ?? 0) >= 0 && (event.offsetSteps ?? 0) < 1)
              if (event.ornamentMidi !== undefined) {
                assert.ok(event.ornament && event.ornament !== 'tremolo')
                assert.ok(Math.abs(event.ornamentMidi - event.midi) <= 3)
                assert.ok(
                  event.ornamentMidi >= low && event.ornamentMidi <= high,
                  `${faction} ${zone} ${intensity} step ${step}: ${event.instrument} ornament at ${event.ornamentMidi}`,
                )
              }
            } else {
              assert.ok(drums.has(event.drum))
              if (event.drum === 'timpani') {
                assert.ok(event.midi !== undefined && event.midi >= 36 && event.midi <= 60)
              }
            }
          }
        }
      }
    }
  }
})

test('music seed and world context create reproducible arrangement variation', () => {
  const context: MusicContext = {
    faction: 'villain',
    zone: 'palace',
    intensity: 'boss',
    threatTier: 4,
    outcome: 'none',
  }
  const signature = scoreSignature(context, 101, 0, MUSIC_CYCLE_STEPS)

  assert.equal(signature, scoreSignature(context, 101, 0, MUSIC_CYCLE_STEPS))
  assert.notEqual(signature, scoreSignature(context, 202, 0, MUSIC_CYCLE_STEPS))
  assert.notEqual(
    signature,
    scoreSignature({ ...context, zone: 'forest' }, 101, 0, MUSIC_CYCLE_STEPS),
  )
  assert.deepEqual(normalizeMusicContext({ ...context, threatTier: 99 }).threatTier, 5)
  assert.deepEqual(normalizeMusicContext({ ...context, threatTier: Number.NaN }).threatTier, 1)
})

test('run outcomes replace the adaptive loop with their own piece', () => {
  const running: MusicContext = {
    faction: 'guard',
    zone: 'fort',
    intensity: 'boss',
    threatTier: 5,
    outcome: 'none',
  }
  const victory: MusicContext = { ...running, outcome: 'victory' }
  const defeat: MusicContext = { ...running, outcome: 'defeat' }

  // The outcome piece ignores everything the run was doing, so it always sounds the same.
  for (const outcome of [victory, defeat]) {
    assert.equal(
      scoreSignature(outcome, 4242, 0, MUSIC_OUTCOME_STEPS),
      scoreSignature(
        { ...outcome, faction: 'elf', zone: 'palace', intensity: 'explore', threatTier: 1 },
        999,
        0,
        MUSIC_OUTCOME_STEPS,
      ),
    )
  }

  assert.notEqual(
    scoreSignature(victory, 7, 0, MUSIC_OUTCOME_STEPS),
    scoreSignature(defeat, 7, 0, MUSIC_OUTCOME_STEPS),
  )
  assert.notEqual(
    scoreSignature(running, 7, 0, MUSIC_OUTCOME_STEPS),
    scoreSignature(victory, 7, 0, MUSIC_OUTCOME_STEPS),
  )
  // The 16-bar arc tiles the scheduler cycle, so looping never lands mid-phrase.
  assert.equal(MUSIC_CYCLE_STEPS % MUSIC_OUTCOME_STEPS, 0)
  assert.equal(
    scoreSignature(victory, 7, 0, MUSIC_OUTCOME_STEPS),
    scoreSignature(victory, 7, MUSIC_OUTCOME_STEPS, MUSIC_OUTCOME_STEPS * 2),
  )
})

test('victory celebrates while defeat mourns', () => {
  const base: MusicContext = {
    faction: 'elf',
    zone: 'forest',
    intensity: 'explore',
    threatTier: 2,
    outcome: 'none',
  }
  const victory = collectOutcome({ ...base, outcome: 'victory' })
  const defeat = collectOutcome({ ...base, outcome: 'defeat' })

  // Major third over the tonic for the fanfare, minor third for the lament.
  assert.ok(victory.chordThirds.has(4) && !victory.chordThirds.has(3))
  assert.ok(defeat.chordThirds.has(3) && !defeat.chordThirds.has(4))

  assert.ok(getMusicTempo('elf', 'victory') > getMusicTempo('elf', 'defeat') * 1.5)
  assert.equal(getMusicTempo('elf', 'none'), getMusicTempo('elf'))
  // A celebration is loud and busy; a funeral is slow, sparse and low.
  assert.ok(victory.events > defeat.events * 1.8)
  assert.ok(victory.averageVelocity > defeat.averageVelocity)
  assert.ok(victory.averageMidi > defeat.averageMidi + 6)
  assert.ok(victory.drums.has('crash') && victory.drums.has('hat'))
  assert.ok(defeat.drums.has('kick') && !defeat.drums.has('hat'))
})

test('outcome pieces stay in key and inside the playable register', () => {
  const outcomes: MusicContext['outcome'][] = ['victory', 'defeat']
  const scales: Readonly<Record<string, readonly number[]>> = {
    victory: [0, 2, 4, 5, 7, 9, 11],
    defeat: [0, 2, 3, 5, 7, 8, 10],
  }
  const roots: Readonly<Record<string, number>> = { victory: 55, defeat: 50 }

  for (const outcome of outcomes) {
    const context: MusicContext = {
      faction: 'villain',
      zone: 'palace',
      intensity: 'combat',
      threatTier: 3,
      outcome,
    }
    for (let step = 0; step < MUSIC_OUTCOME_STEPS; step += 1) {
      for (const event of planMusicStep(context, step, 5150)) {
        assert.ok(event.velocity > 0 && event.velocity <= 1)
        assert.ok(event.pan >= -1 && event.pan <= 1)
        if (event.kind !== 'tone') continue
        assert.ok(event.midi >= 24 && event.midi <= 108, `${outcome} ${event.part} ${event.midi}`)
        assert.ok(event.durationSteps > 0 && event.durationSteps <= MUSIC_STEPS_PER_BAR)
        const degree = (((event.midi - roots[outcome]) % 12) + 12) % 12
        assert.ok(
          scales[outcome].includes(degree),
          `${outcome} ${event.part} plays out of key: ${event.midi}`,
        )
      }
    }
  }
})

test('the themes stay in their modes and land on chord tones', () => {
  for (const faction of FACTIONS) {
    const harmony = getMusicHarmony(faction)
    assert.equal(harmony.length, MUSIC_BARS_PER_CYCLE)
    for (const zone of ZONES) {
      for (const intensity of INTENSITIES) {
        const context: MusicContext = { faction, zone, intensity, threatTier: 4, outcome: 'none' }
        for (let step = 0; step < MUSIC_CYCLE_STEPS * 2; step += 1) {
          const bar = harmony[Math.floor((step % MUSIC_CYCLE_STEPS) / MUSIC_STEPS_PER_BAR)]
          const stepInBar = step % MUSIC_STEPS_PER_BAR
          for (const event of planMusicStep(context, step, 314159)) {
            if (event.kind !== 'tone') continue
            const pitchClass = mod(event.midi, 12)
            const where = `${faction} ${zone} ${intensity} step ${step} ${event.part} ${event.midi} over ${bar.chord}`
            assert.ok(bar.scale.includes(pitchClass) || bar.chordTones.includes(pitchClass), `out of key: ${where}`)
            if (event.ornamentMidi !== undefined) {
              assert.ok(bar.scale.includes(mod(event.ornamentMidi, 12)), `ornament out of key: ${where}`)
            }
            const strong = stepInBar === 0 || (stepInBar === 8 && event.part !== 'bass')
            if (strong && ['lead', 'counter', 'pad', 'bass'].includes(event.part)) {
              assert.ok(bar.chordTones.includes(pitchClass), `strong beat off the chord: ${where}`)
            }
          }
        }
      }
    }
  }
})

test('each faction has its own key, tempo and lilt', () => {
  const keys = FACTIONS.map((faction) => getMusicKey({ faction, outcome: 'none' }).tonic)
  assert.equal(new Set(keys).size, FACTIONS.length)
  assert.equal(new Set(FACTIONS.map((faction) => getMusicTempo(faction))).size, FACTIONS.length)
  assert.ok(getMusicSwing('elf') > 0.55, 'the elves walk with a swing')
  assert.equal(getMusicSwing('guard'), 0.5, 'the guard marches straight')
  assert.equal(getMusicSwing('villain', 'victory'), 0.5)
  assert.equal(getMusicKey({ faction: 'villain', outcome: 'victory' }).tonic, 7)
  assert.equal(getMusicKey({ faction: 'guard', outcome: 'defeat' }).tonic, 2)
})

test('swing moves only the off-beats, and not at all when straight', () => {
  for (let step = 0; step < 4; step += 1) assert.equal(swingDelay(step, 0.5), 0)
  assert.equal(swingDelay(0, 0.6), 0)
  assert.ok(Math.abs(swingDelay(2, 0.6) - 0.1) < 1e-9)
  assert.ok(Math.abs(swingDelay(1, 0.6) - 0.05) < 1e-9)
  assert.ok(Math.abs(swingDelay(3, 0.6) - 0.05) < 1e-9)
})

test('rising danger is announced on the downbeat and falling danger is not', () => {
  const base: MusicContext = { faction: 'guard', zone: 'fort', intensity: 'explore', threatTier: 2, outcome: 'none' }
  const drums = (from: MusicContext, to: MusicContext, step = MUSIC_STEPS_PER_BAR) =>
    planMusicTransition(from, to, step).map((event) => (event.kind === 'drum' ? event.drum : event.instrument))

  assert.deepEqual(drums(base, { ...base, intensity: 'explore', zone: 'palace' }), [])
  assert.deepEqual(drums({ ...base, intensity: 'combat' }, base), [])
  assert.ok(drums(base, { ...base, intensity: 'alert' }).includes('tom'))
  const fight = drums(base, { ...base, intensity: 'combat' })
  assert.ok(fight.includes('crash') && fight.includes('timpani'))
  assert.ok(drums({ ...base, faction: 'villain' }, { ...base, faction: 'villain', intensity: 'boss' }).includes('gong'))
  assert.deepEqual(drums(base, { ...base, intensity: 'boss', outcome: 'victory' }), [])

  // An accent the new groove already plays on that bar line must not double it — for every
  // faction, region, rise in danger and bar of the form.
  for (const faction of FACTIONS) {
    for (const zone of ZONES) {
      for (let from = 0; from < INTENSITIES.length; from += 1) {
        for (let to = from + 1; to < INTENSITIES.length; to += 1) {
          const previous: MusicContext = { ...base, faction, zone, intensity: INTENSITIES[from] }
          const next: MusicContext = { ...base, faction, zone, intensity: INTENSITIES[to] }
          for (let step = 0; step < MUSIC_CYCLE_STEPS; step += MUSIC_STEPS_PER_BAR) {
            const groove = new Set(
              planMusicStep(next, step, 3).flatMap((event) => (event.kind === 'drum' ? [event.drum] : [])),
            )
            for (const event of planMusicTransition(previous, next, step)) {
              assert.ok(
                event.kind === 'drum' && !groove.has(event.drum),
                `${faction} ${zone} ${previous.intensity}→${next.intensity} bar ${step / 16} doubles ${event.kind === 'drum' ? event.drum : event.instrument}`,
              )
            }
          }
        }
      }
    }
  }
})

test('exploration breathes while alert and combat carry the tune throughout', () => {
  for (const faction of FACTIONS) {
    const leadPhrases = (intensity: MusicIntensity, cycle: number) => {
      const slots = new Set<number>()
      for (let step = 0; step < MUSIC_CYCLE_STEPS; step += 1) {
        const events = planMusicStep(
          { faction, zone: 'forest', intensity, threatTier: 1, outcome: 'none' },
          cycle * MUSIC_CYCLE_STEPS + step,
          5,
        )
        if (events.some((event) => event.kind === 'tone' && event.part === 'lead')) {
          slots.add(Math.floor(step / (MUSIC_STEPS_PER_BAR * 4)))
        }
      }
      return slots.size
    }
    assert.ok(leadPhrases('explore', 0) < 8 && leadPhrases('explore', 1) < 8, `${faction} never rests`)
    assert.equal(leadPhrases('alert', 0), 8)
    assert.equal(leadPhrases('combat', 1), 8)
  }
})

test('regions recolour the ensemble around the faction tune', () => {
  const instruments = (context: MusicContext) => {
    const found = new Set<MusicInstrument>()
    for (let step = 0; step < MUSIC_CYCLE_STEPS; step += 1) {
      for (const event of planMusicStep(context, step, 11)) {
        if (event.kind === 'tone') found.add(event.instrument)
      }
    }
    return found
  }
  const pluck: Record<MusicContext['zone'], MusicInstrument> = {
    forest: 'gusli',
    neutral: 'balalaika',
    palace: 'celesta',
    fort: 'pizzicato',
  }
  for (const faction of FACTIONS) {
    for (const zone of ZONES) {
      for (const intensity of INTENSITIES) {
        const context: MusicContext = { faction, zone, intensity, threatTier: 3, outcome: 'none' }
        const used = instruments(context)
        assert.ok(used.has(pluck[zone]), `${faction} ${zone} ${intensity} lacks ${pluck[zone]}`)
        if (zone === 'neutral') assert.ok(used.has('bayan'), `${faction} roads need the bayan`)
        // The director warms recordings from this list; anything missing would render mid-bar.
        const warmed = new Set(musicEnsembleInstruments(context))
        for (const instrument of used) {
          assert.ok(warmed.has(instrument), `${faction} ${zone} ${intensity} plays unwarmed ${instrument}`)
        }
      }
    }
  }
  const flute = instruments({ faction: 'elf', zone: 'forest', intensity: 'explore', threatTier: 1, outcome: 'none' })
  const horn = instruments({ faction: 'guard', zone: 'forest', intensity: 'explore', threatTier: 1, outcome: 'none' })
  const bassoon = instruments({ faction: 'villain', zone: 'forest', intensity: 'explore', threatTier: 1, outcome: 'none' })
  assert.ok(flute.has('flute') && horn.has('horn') && bassoon.has('reed'))
})

test('keyed cues are transposed into the key of the score', () => {
  assert.equal(cueKeyShift({ faction: 'elf', outcome: 'none' }), 5)
  assert.equal(cueKeyShift({ faction: 'guard', outcome: 'none' }), 1)
  assert.equal(cueKeyShift({ faction: 'villain', outcome: 'none' }), -5)
  assert.equal(cueKeyShift({ faction: 'elf', outcome: 'victory' }), -2)
  for (const faction of FACTIONS) {
    const shift = cueKeyShift({ faction, outcome: 'none' })
    assert.ok(shift >= -6 && shift <= 5)
    assert.equal(mod(9 + shift, 12), getMusicKey({ faction, outcome: 'none' }).tonic)
  }
})

test('every instrument and drum the score names has a voice and a recording', () => {
  assert.deepEqual(Object.keys(MUSIC_VOICES).sort(), [...MUSIC_INSTRUMENTS].sort())
  for (const voice of Object.values(MUSIC_VOICES)) {
    if (voice.kind === 'sample') assert.ok(voice.sample in PITCHED_SAMPLES)
  }
  for (const name of ['kick', 'snare', 'hat', 'tom', 'crash', 'tambourine', 'shaker', 'spoons', 'frameDrum', 'sleighBells', 'anvil', 'gong']) {
    assert.ok(name in ONE_SHOT_SAMPLES, `${name} has no recording`)
  }
})

test('procedural recordings are finite, normalised and end in silence', () => {
  const check = (label: string, data: Float32Array, sampleRate: number) => {
    let peak = 0
    for (const value of data) {
      assert.ok(Number.isFinite(value), `${label} has a non-finite sample`)
      peak = Math.max(peak, Math.abs(value))
    }
    assert.ok(peak > 0.85 && peak <= 0.9 + 1e-6, `${label} peak ${peak}`)
    assert.ok(Math.abs(data[0]) < 0.05, `${label} starts with a click`)
    const tail = data.subarray(data.length - Math.floor(sampleRate * 0.005))
    assert.ok(tail.every((value) => Math.abs(value) < 0.01), `${label} is cut off while sounding`)
  }
  for (const [name, spec] of Object.entries(ONE_SHOT_SAMPLES)) {
    check(name, runJob(spec.render(spec.sampleRate)), spec.sampleRate)
  }
  for (const [name, spec] of Object.entries(PITCHED_SAMPLES)) {
    const roots = pitchedSampleRoots(name as PitchedSampleName)
    for (const root of [roots[0], roots[roots.length - 1]]) {
      check(`${name}:${root}`, runJob(spec.render(root, spec.sampleRate)), spec.sampleRate)
    }
  }
})

test('recordings render in short resumable slices that match a one-shot render', () => {
  const spec = ONE_SHOT_SAMPLES.crash
  const whole = runJob(spec.render(spec.sampleRate))
  const job = spec.render(spec.sampleRate)
  let pauses = 0
  let step = job.next()
  while (!step.done) {
    pauses += 1
    step = job.next()
  }
  assert.ok(pauses > 10, 'a long recording must pause many times')
  assert.equal(step.value.length, whole.length)
  assert.ok(step.value.every((value, index) => value === whole[index]))
})

test('the bank warms in slices, queues urgent work first and never renders for the score', () => {
  const bank = new SampleBank()
  assert.equal(bank.pitched('gusli', 60), null, 'an unrendered recording is never rendered on lookup')
  bank.prepare(['gong', 'coin'])
  bank.prepare(['shieldClang'], true)
  let slices = 0
  while (bank.warm(0.5)) slices += 1
  assert.ok(slices > 3, 'warming spans many short slices')
  assert.ok(bank.isReady(['gong', 'coin', 'shieldClang']))
  // The lookup that missed queued the note's root urgently, so it rendered too.
  assert.ok(bank.isReady([`gusli:${nearestSampleRoot('gusli', 60)}`]))
  // Without a context there is nothing to play yet, even when the PCM is ready.
  assert.equal(bank.oneShot('coin'), null)
  bank.dispose()
  assert.equal(bank.isReady(['coin']), false)
})

test('plucked strings are in tune across the range', () => {
  const sampleRate = 32000
  for (const midi of [40, 52, 64, 76, 88]) {
    const data = renderPluck(
      { frequency: midiToFrequency(midi), duration: 0.8, decay: 1.5, brightness: 0.6, pickPosition: 0.2, seed: midi },
      sampleRate,
    )
    const cents = 1200 * Math.log2(estimatePitch(data, sampleRate, midiToFrequency(midi)) / midiToFrequency(midi))
    assert.ok(Math.abs(cents) < 6, `midi ${midi} is ${cents.toFixed(1)} cents off`)
  }
})

test('rendered roots cover every pitched instrument within half a spacing', () => {
  for (const [name, spec] of Object.entries(PITCHED_SAMPLES)) {
    for (let midi = spec.low; midi <= spec.high; midi += 1) {
      const root = nearestSampleRoot(name as PitchedSampleName, midi)
      assert.ok(Math.abs(root - midi) <= Math.ceil(spec.spacing / 2), `${name} ${midi} plays from ${root}`)
    }
  }
})

test('formant spectra are normalised and band-limited', () => {
  for (const frequency of [55, 110, 440, 1760]) {
    const amplitudes = formantSpectrum(frequency, 0.8, [[700, 160, 1], [1150, 200, 0.6]], 48000)
    assert.equal(amplitudes[0], 0)
    assert.ok(Math.abs(Math.max(...amplitudes) - 1) < 1e-6)
    assert.ok((amplitudes.length - 1) * frequency <= 12000 || amplitudes.length === 2)
  }
})

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

/** Autocorrelation pitch estimate near an expected frequency, after the attack. */
function estimatePitch(data: Float32Array, sampleRate: number, expected: number): number {
  const start = Math.floor(sampleRate * 0.05)
  const size = Math.min(4096, data.length - start - Math.ceil((sampleRate / expected) * 1.3) - 2)
  const correlation = (lag: number) => {
    let sum = 0
    for (let index = 0; index < size; index += 1) sum += data[start + index] * data[start + index + lag]
    return sum
  }
  const period = sampleRate / expected
  let bestLag = 0
  let best = Number.NEGATIVE_INFINITY
  for (let lag = Math.floor(period * 0.8); lag <= Math.ceil(period * 1.25); lag += 1) {
    const value = correlation(lag)
    if (value > best) {
      best = value
      bestLag = lag
    }
  }
  const before = correlation(bestLag - 1)
  const after = correlation(bestLag + 1)
  const shift = (before - after) / (2 * (before - 2 * best + after))
  return sampleRate / (bestLag + shift)
}

function collectOutcome(context: MusicContext): {
  events: number
  averageVelocity: number
  averageMidi: number
  drums: Set<string>
  chordThirds: Set<number>
} {
  const drums = new Set<string>()
  const chordThirds = new Set<number>()
  let events = 0
  let velocity = 0
  let midi = 0
  let tones = 0

  for (let step = 0; step < MUSIC_OUTCOME_STEPS; step += 1) {
    const bar = Math.floor(step / MUSIC_STEPS_PER_BAR)
    const pads: number[] = []
    for (const event of planMusicStep(context, step, 31337)) {
      events += 1
      velocity += event.velocity
      if (event.kind === 'drum') {
        drums.add(event.drum)
        continue
      }
      tones += 1
      midi += event.midi
      // Bars 0 and 3 sit on the tonic in both pieces, so the pad spells the mode.
      if (event.part === 'pad' && (bar === 0 || bar === 3)) pads.push(event.midi)
    }
    const lowest = Math.min(...pads)
    for (const pad of pads) chordThirds.add((((pad - lowest) % 12) + 12) % 12)
  }

  return {
    events,
    averageVelocity: velocity / events,
    averageMidi: midi / tones,
    drums,
    chordThirds,
  }
}

function scoreSignature(
  context: MusicContext,
  seed: number,
  start: number,
  end: number,
): string {
  const steps: string[] = []
  for (let step = start; step < end; step += 1) {
    const events = planMusicStep(context, step, seed)
    steps.push(
      events
        .map((event) =>
          event.kind === 'tone'
            ? `${event.part}:${event.midi}:${event.durationSteps}:${event.velocity}:${event.pan}`
            : `${event.drum}:${event.velocity}:${event.pan}`,
        )
        .join(','),
    )
  }
  return steps.join('|')
}
