import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canOpenGameOverlay,
  closeTopGameOverlay,
  dismissGameOverlay,
  initialGameOverlayState,
  openGameOverlay,
  toggleGameOverlay,
  topGameOverlay,
  type GameOverlayState,
} from '../src/game/ui/gameOverlay.ts'

const empty = initialGameOverlayState()

test('Escape closes only the topmost owner and never toggles pause behind atlas/orders/shop', () => {
  for (const field of ['atlasOpen', 'squadCommandOpen', 'shopOpen', 'achievementsOpen'] as const) {
    const open = { ...empty, [field]: true }
    const closed = closeTopGameOverlay(open)
    assert.equal(topGameOverlay(closed), null)
    assert.equal(closed.paused, false)
    const overPause = closeTopGameOverlay({ ...open, paused: true })
    assert.equal(topGameOverlay(overPause), 'pause')
    assert.equal(overPause.paused, true)
  }
  assert.equal(topGameOverlay(closeTopGameOverlay(empty)), 'pause')
  assert.equal(topGameOverlay(closeTopGameOverlay({ ...empty, ended: true })), 'end')
})

test('opening another blocking overlay is rejected and only the agreed highest owner can render', () => {
  for (const requested of ['atlas', 'orders', 'shop'] as const) {
    assert.equal(canOpenGameOverlay(empty, requested), true)
    assert.equal(canOpenGameOverlay({ ...empty, ended: true }, requested), false)
    assert.equal(canOpenGameOverlay({ ...empty, achievementsOpen: true }, requested), false)
    assert.equal(canOpenGameOverlay({ ...empty, paused: true }, requested), false)
  }
  assert.equal(canOpenGameOverlay({ ...empty, shopOpen: true }, 'atlas'), false)
  assert.equal(canOpenGameOverlay({ ...empty, atlasOpen: true }, 'orders'), false)
  assert.equal(topGameOverlay({ ...empty, atlasOpen: true, squadCommandOpen: true, paused: true }), 'atlas')
  assert.equal(topGameOverlay({ ...empty, atlasOpen: true, shopOpen: true }), 'shop')
  assert.equal(topGameOverlay({ ...empty, atlasOpen: true, achievementsOpen: true }), 'achievements')
})

test('the full shared ordering dismisses exactly one owner, with terminal results undismissable', () => {
  let state: GameOverlayState = {
    ended: true, achievementsOpen: true, shopOpen: true, atlasOpen: true,
    squadCommandOpen: true, paused: true,
  }
  assert.equal(topGameOverlay(state), 'end')
  assert.equal(closeTopGameOverlay(state), state)
  assert.equal(dismissGameOverlay(state, 'end'), state)
  state = { ...state, ended: false }

  for (const owner of ['achievements', 'shop', 'atlas', 'orders', 'pause'] as const) {
    assert.equal(topGameOverlay(state), owner)
    const previous = state
    state = dismissGameOverlay(state, owner)
    const changed = (Object.keys(previous) as (keyof GameOverlayState)[])
      .filter((field) => previous[field] !== state[field])
    assert.equal(changed.length, 1, `${owner} changed a lower overlay`)
  }
  assert.deepEqual(state, empty)
})

test('atlas and orders toggle through the actual request policy without bypassing blockers', () => {
  for (const requested of ['atlas', 'orders', 'shop'] as const) {
    const opened = openGameOverlay(empty, requested)
    assert.equal(topGameOverlay(opened), requested)
    assert.equal(openGameOverlay(opened, requested), opened, 'repeated open must not close a dialog')
    assert.deepEqual(toggleGameOverlay(opened, requested), empty)
    assert.deepEqual(empty, initialGameOverlayState(), 'requests must not mutate their input')

    for (const blocker of ['end', 'achievements', 'pause', 'atlas', 'orders', 'shop'] as const) {
      if (blocker === requested) continue
      const blocked = blocker === 'end' ? { ...empty, ended: true }
        : blocker === 'achievements' ? { ...empty, achievementsOpen: true }
          : blocker === 'pause' ? { ...empty, paused: true }
            : openGameOverlay(empty, blocker)
      assert.equal(openGameOverlay(blocked, requested), blocked, `${requested} opened through ${blocker}`)
      assert.equal(toggleGameOverlay(blocked, requested), blocked, `${requested} toggled through ${blocker}`)
      assert.equal(dismissGameOverlay(blocked, requested), blocked, `${requested} closed ${blocker}`)
    }
  }
})

test('stale controls cannot clear an obscured atlas or order panel or resume an underlying dialog', () => {
  for (const requested of ['atlas', 'orders'] as const) {
    const opened = toggleGameOverlay(empty, requested)
    const underShop = { ...opened, shopOpen: true, paused: true }
    assert.equal(toggleGameOverlay(underShop, requested), underShop)
    assert.equal(dismissGameOverlay(underShop, requested), underShop)
    assert.equal(topGameOverlay(closeTopGameOverlay(underShop)), requested)
    assert.equal(topGameOverlay(dismissGameOverlay({ ...opened, paused: true }, requested)), 'pause')
    const underEnd = { ...opened, ended: true }
    assert.equal(dismissGameOverlay(underEnd, requested), underEnd)
  }
})
