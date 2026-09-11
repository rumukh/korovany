import assert from 'node:assert/strict'
import { resolveVisualViewport } from '../../src/game/visualPolicy.ts'
import { portraitSaveIdentity, portraitSimulationIdentity } from './portraits.mjs'

export const RUNTIME_CONTROL_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1920, height: 1080, dpr: 1 }),
  Object.freeze({ width: 390, height: 844, dpr: 1 }),
  Object.freeze({ width: 390, height: 844, dpr: 2 }),
  Object.freeze({ width: 1920, height: 1080, dpr: 1.5 }),
])

/** ResizeObserver runs after animation callbacks; settle it before the next held render. */
export function settleHeldViewport(browser) {
  return browser.evaluate(`(() => {
    const owner = window.__korovanyGraphics;
    if (!owner?.snapshot().manual) throw new Error('Viewport settling requires held graphics diagnostics');
    return new Promise((resolve, reject) => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (window.__korovanyGraphics !== owner) {
        reject(new Error('Graphics owner changed while the viewport settled'));
        return;
      }
      resolve(true);
    })));
  })()`)
}

export function assertCaptureDeadline(deadline, now = Date.now()) {
  if (!deadline) return
  const limit = Date.parse(deadline)
  if (!Number.isFinite(limit) || !/(?:Z|[+]00:00)$/.test(deadline)) throw new Error('Capture deadline must be a finite UTC timestamp')
  if (now >= limit) throw new Error('Capture work deadline reached; no new phase may start')
}

export function recordedRiverEndpoint(records) {
  const route = records.cases?.find((entry) => entry.id === 'guard-riverside-close')
  const pose = route?.motion?.frames?.[0]?.snapshot
  if (!Array.isArray(pose?.player) || pose.player.length !== 3 || !pose.player.every(Number.isFinite) ||
      !Number.isFinite(pose.camera?.yaw) || !Number.isFinite(pose.camera?.pitch)) {
    throw new Error('Preserved river endpoint metadata is missing or invalid')
  }
  return {
    player: { x: pose.player[0], y: pose.player[1], z: pose.player[2] },
    camera: { yaw: pose.camera.yaw, pitch: pose.camera.pitch },
    label: 'STAGED recorded GFX-02 post-native river endpoint player/yaw/pitch; production camera solve, no forced camera position. Companions retain original field prerequisites.',
  }
}

export function validateRuntimeControlSnapshot(snapshot, viewport, bloomEnabled) {
  const policy = snapshot.runtime.visualPolicy
  assert.equal(policy.mode, 'enhanced')
  assert.equal(policy.preferences.bloomEnabled, bloomEnabled)
  const expected = resolveVisualViewport(policy.render, viewport.width, viewport.height, viewport.dpr)
  assert.equal(snapshot.viewport.width, viewport.width)
  assert.equal(snapshot.viewport.height, viewport.height)
  assert.equal(snapshot.viewport.devicePixelRatio, viewport.dpr)
  assert.equal(snapshot.viewport.bufferWidth, expected.drawingBufferWidth)
  assert.equal(snapshot.viewport.bufferHeight, expected.drawingBufferHeight)
  assert.ok(Math.abs(snapshot.viewport.rendererPixelRatio - expected.pixelRatio) < 1e-9)
  const post = snapshot.runtime.rendering.post
  assert.equal(post.width, expected.drawingBufferWidth)
  assert.equal(post.height, expected.drawingBufferHeight)
  assert.equal(post.composer, policy.post.enabled)
  assert.deepEqual(post.passes, policy.post.enabled ? ['scene', 'bloom', 'grade', 'output', 'fxaa'] : [])
  assert.equal(snapshot.lastFrame.source, 'manual')
  assert.equal(snapshot.lastFrame.counterAgreement, true)
  assert.ok(snapshot.lastFrame.total.calls > 0)
  assert.equal(snapshot.lastFrame.draws.post.calls > 0, policy.post.enabled)
}

/** Reuses the runner's browser and live engine; this function neither launches nor owns a process. */
export async function captureRuntimeControls(browser, originalViewport, record, checkTime) {
  await browser.evaluate('window.__graphicsRuntimeControlOwner = window.__korovanyGraphics')
  const before = await browser.evaluate('window.__korovanyGraphics.snapshot()')
  const originalBloom = before.runtime.visualPolicy.preferences.bloomEnabled
  await browser.clickSelector('.hud-pause')
  await browser.waitFor('!!document.querySelector(".pause-modal")')
  const paused = await browser.evaluate('window.__korovanyGraphics.snapshot()')
  const identity = portraitSimulationIdentity(paused)
  const save = portraitSaveIdentity(await browser.evaluate('window.__korovanyGraphics.save()'))
  const checkPreservation = async (snapshot) => {
    assert.equal(snapshot.runtime.paused, true)
    assert.equal(portraitSimulationIdentity(snapshot), identity)
    assert.equal(portraitSaveIdentity(await browser.evaluate('window.__korovanyGraphics.save()')), save)
    assert.equal(await browser.evaluate('window.__graphicsRuntimeControlOwner === window.__korovanyGraphics'), true)
  }
  try {
    for (const [index, viewport] of RUNTIME_CONTROL_VIEWPORTS.entries()) {
      checkTime()
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dpr, mobile: false,
      })
      await browser.waitFor(`innerWidth === ${viewport.width} && innerHeight === ${viewport.height} && devicePixelRatio === ${viewport.dpr}`)
      await settleHeldViewport(browser)
      const snapshot = await browser.evaluate('window.__korovanyGraphics.render(2)')
      validateRuntimeControlSnapshot(snapshot, viewport, originalBloom)
      await checkPreservation(snapshot)
      await record(`resize-${index}`, snapshot)
    }
    const viewport = RUNTIME_CONTROL_VIEWPORTS.at(-1)
    for (const enabled of [false, true]) {
      checkTime()
      const current = await browser.evaluate('window.__korovanyGraphics.snapshot().runtime.visualPolicy.preferences.bloomEnabled')
      if (current !== enabled) await browser.clickSelector('.pause-modal .bloom-setting')
      const snapshot = await browser.evaluate('window.__korovanyGraphics.render(2)')
      validateRuntimeControlSnapshot(snapshot, viewport, enabled)
      await checkPreservation(snapshot)
      await record(enabled ? 'post-on' : 'post-off', snapshot)
    }
    checkTime()
    if (!originalBloom) await browser.clickSelector('.pause-modal .bloom-setting')
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: originalViewport.width, height: originalViewport.height, deviceScaleFactor: originalViewport.dpr, mobile: false,
    })
    await browser.waitFor(`innerWidth === ${originalViewport.width} && innerHeight === ${originalViewport.height} && devicePixelRatio === ${originalViewport.dpr}`)
    await settleHeldViewport(browser)
    const restored = await browser.evaluate('window.__korovanyGraphics.render(2)')
    validateRuntimeControlSnapshot(restored, originalViewport, originalBloom)
    await checkPreservation(restored)
    await browser.clickSelector('.pause-modal .pause-actions .primary-button')
    await browser.waitFor('!document.querySelector(".pause-modal")')
    await record('restored-gameplay-layout', await browser.evaluate('window.__korovanyGraphics.render(2)'))
    return { complete: true, sameEngine: true, simulationAndSavePreserved: true, viewportRestored: true }
  } finally {
    await browser.evaluate('delete window.__graphicsRuntimeControlOwner')
  }
}
