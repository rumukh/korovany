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
