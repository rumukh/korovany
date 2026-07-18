import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CAMERA_ACCENT_MAX_ENTRIES,
  CAMERA_BASE_FOV,
  CAMERA_FOLLOW_DAMPING,
  CAMERA_FOV_DAMPING,
  CAMERA_FOV_MAX,
  CAMERA_FOV_MIN,
  LANDING_MIN_AIR_TIME,
  SPRINT_BLEND_DAMPING,
  advanceAirborneState,
  advanceCameraAccents,
  advanceJumpAccentLatch,
  composeCameraFov,
  dampValue,
  queueCameraAccent,
  sampleCameraAccent,
  type CameraAccent,
} from '../src/game/cameraAccents.ts'

test('camera accents use a signed sine envelope and expire deterministically', () => {
  const positive: CameraAccent = {
    kind: 'cleave',
    age: 0,
    duration: 0.24,
    magnitude: 5.5,
  }
  const negative: CameraAccent = {
    kind: 'kill',
    age: 0.1,
    duration: 0.2,
    magnitude: -2.4,
  }

  assert.equal(sampleCameraAccent(positive), 0)
  positive.age = positive.duration / 2
  assert.ok(Math.abs(sampleCameraAccent(positive) - 5.5) < 1e-12)
  assert.ok(Math.abs(sampleCameraAccent(negative) + 2.4) < 1e-12)

  const accents = [positive]
  assert.equal(advanceCameraAccents(accents, positive.duration / 2), 0)
  assert.equal(accents.length, 0)
})

test('same-kind replacement compares absolute strength', () => {
  const accents: CameraAccent[] = []
  assert.equal(queueCameraAccent(accents, 'kill', -1.2, 0.2), true)
  accents[0].age = 0.08
  assert.equal(queueCameraAccent(accents, 'kill', -0.8, 0.2), false)
  assert.equal(accents[0].age, 0.08)
  assert.equal(queueCameraAccent(accents, 'kill', -2.4, 0.2), true)
  assert.equal(accents[0].age, 0)
  assert.equal(accents[0].magnitude, -2.4)
})

test('queue capacity evicts only the weakest oldest entry for a stronger accent', () => {
  const accents: CameraAccent[] = [
    { kind: 'jump', age: 0.12, duration: 0.18, magnitude: 1 },
    { kind: 'land', age: 0.04, duration: 0.16, magnitude: -1.4 },
    { kind: 'block', age: 0.08, duration: 0.12, magnitude: -0.8 },
    { kind: 'kill', age: 0.03, duration: 0.2, magnitude: -2.4 },
  ]

  assert.equal(accents.length, CAMERA_ACCENT_MAX_ENTRIES)
  assert.equal(queueCameraAccent(accents, 'cleave', 0.7, 0.16), false)
  assert.equal(queueCameraAccent(accents, 'cleave', 2, 0.16), true)
  assert.equal(accents.length, CAMERA_ACCENT_MAX_ENTRIES)
  assert.equal(accents.some((accent) => accent.kind === 'block'), false)
})

test('accent and global FOV clamps remain bounded under stress', () => {
  const positive: CameraAccent[] = [
    { kind: 'cleave', age: 0.12, duration: 0.24, magnitude: 5.5 },
    { kind: 'jump', age: 0.09, duration: 0.18, magnitude: 4 },
  ]
  const negative: CameraAccent[] = [
    { kind: 'kill', age: 0.1, duration: 0.2, magnitude: -2.4 },
    { kind: 'land', age: 0.08, duration: 0.16, magnitude: -2 },
  ]

  assert.equal(advanceCameraAccents(positive, 0), 7)
  assert.equal(advanceCameraAccents(negative, 0), -3.5)
  assert.equal(composeCameraFov(1, 99), CAMERA_FOV_MAX)
  assert.equal(composeCameraFov(0, -99), CAMERA_BASE_FOV - 3.5)
  assert.ok(composeCameraFov(0, -99) >= CAMERA_FOV_MIN)
  assert.equal(composeCameraFov(0, 0), CAMERA_BASE_FOV)
})

test('exponential damping settles equivalently at 30, 60, and 120 fps', () => {
  const settle = (rate: number, fps: number): number => {
    let value = 0
    for (let frame = 0; frame < fps * 2; frame += 1) {
      value = dampValue(value, 1, rate, 1 / fps)
    }
    return value
  }

  for (const rate of [SPRINT_BLEND_DAMPING, CAMERA_FOV_DAMPING, CAMERA_FOLLOW_DAMPING]) {
    const at30 = settle(rate, 30)
    const at60 = settle(rate, 60)
    const at120 = settle(rate, 120)
    assert.ok(Math.abs(at30 - at60) < 1e-12)
    assert.ok(Math.abs(at60 - at120) < 1e-12)
  }
})

test('landing state ignores tiny contacts and recognizes qualifying airtime', () => {
  const tiny = advanceAirborneState(LANDING_MIN_AIR_TIME - 0.03, false, true, 0.01)
  assert.equal(tiny.landed, false)
  assert.equal(tiny.airborneTime, 0)

  const qualifying = advanceAirborneState(LANDING_MIN_AIR_TIME - 0.01, false, true, 0.02)
  assert.equal(qualifying.landed, true)
  assert.ok(qualifying.landingAirTime >= LANDING_MIN_AIR_TIME)

  const takeoffFrame = advanceAirborneState(0, true, false, 0.05)
  assert.equal(takeoffFrame.landed, false)
  assert.equal(takeoffFrame.airborneTime, 0.05)

  const sameFrameContact = advanceAirborneState(0, true, true, 0.05)
  assert.equal(sameFrameContact.landed, false)
})

test('held jump input cannot repeatedly trigger takeoff accents', () => {
  const first = advanceJumpAccentLatch(true, true, true)
  assert.deepEqual(first, { armed: false, triggered: true })
  const heldAcrossLanding = advanceJumpAccentLatch(first.armed, true, true)
  assert.deepEqual(heldAcrossLanding, { armed: false, triggered: false })
  const released = advanceJumpAccentLatch(heldAcrossLanding.armed, false, false)
  assert.deepEqual(released, { armed: true, triggered: false })
  const nextPress = advanceJumpAccentLatch(released.armed, true, true)
  assert.deepEqual(nextPress, { armed: false, triggered: true })
})
