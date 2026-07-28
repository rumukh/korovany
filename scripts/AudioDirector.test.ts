import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUDIO_RECIPES,
  MAX_ACTIVE_SOURCES,
  MAX_ACTIVE_VOICES,
  PAN_MAX,
  SFX_VOLUME_DEFAULT,
  calculateSpatialMix,
  normalizeSfxVolume,
  planVoiceAdmission,
  type AdmissionVoiceSnapshot,
  type SoundCue,
} from '../src/game/AudioDirector.ts'
import {
  MUSIC_CYCLE_STEPS,
  MUSIC_OUTCOME_STEPS,
  MUSIC_STEPS_PER_BAR,
  getMusicTempo,
  isMusicBarBoundary,
  normalizeMusicContext,
  planMusicStep,
  type MusicContext,
  type MusicIntensity,
} from '../src/game/MusicScore.ts'

test('all recipes stay within the three-layer budget', () => {
  const required: SoundCue[] = [
    'swing',
    'hitLight',
    'hitHeavy',
    'block',
    'gore',
    'down',
    'bow',
    'arrow',
    'lootReveal',
    'lootCollect',
    'event',
    'eventWin',
    'eventFail',
    'victory',
    'defeat',
  ]

  for (const cue of required) {
    const recipe = AUDIO_RECIPES[cue]
    assert.ok(recipe.layers.length > 0, `${cue} must have at least one layer`)
    assert.ok(recipe.layers.length <= 3, `${cue} exceeds the layer budget`)
    assert.ok(recipe.maxConcurrent > 0, `${cue} needs a concurrency cap`)
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
  assert.equal(
    scoreSignature(context, 0x12345678, 0, MUSIC_CYCLE_STEPS),
    scoreSignature(context, 0x12345678, MUSIC_CYCLE_STEPS, MUSIC_CYCLE_STEPS * 2),
  )
  assert.ok((MUSIC_CYCLE_STEPS / 4 / getMusicTempo(context.faction)) * 60 > 55)
  for (let step = 0; step < MUSIC_CYCLE_STEPS; step += 1) {
    assert.equal(isMusicBarBoundary(step), step % MUSIC_STEPS_PER_BAR === 0)
  }
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
  const factions: MusicContext['faction'][] = ['elf', 'guard', 'villain']
  const zones: MusicContext['zone'][] = ['neutral', 'palace', 'forest', 'fort']
  const intensities: MusicIntensity[] = ['explore', 'alert', 'combat', 'boss']

  for (const faction of factions) {
    for (const zone of zones) {
      for (const intensity of intensities) {
        const context: MusicContext = {
          faction,
          zone,
          intensity,
          threatTier: 5,
          outcome: 'none',
        }
        for (let step = 0; step < MUSIC_CYCLE_STEPS; step += 1) {
          for (const event of planMusicStep(context, step, 77)) {
            assert.ok(event.velocity > 0 && event.velocity <= 1)
            assert.ok(event.pan >= -1 && event.pan <= 1)
            if (event.kind === 'tone') {
              assert.ok(Number.isFinite(event.midi) && event.midi >= 24 && event.midi <= 108)
              assert.ok(event.durationSteps > 0 && event.durationSteps <= MUSIC_STEPS_PER_BAR)
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
