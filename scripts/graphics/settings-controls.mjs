import assert from 'node:assert/strict'
import { portraitSaveIdentity } from './portraits.mjs'
import { settleHeldViewport } from './runtime-controls.mjs'

export async function captureSettingsControls(browser, origin, originalViewport, record, checkTime) {
  const cases = [
    { id: 'fresh', saved: null, hudMode: 'full', bloom: true, width: 1440, height: 1000 },
    { id: 'legacy-low', saved: { version: 1, visualMode: 'legacy', visualQuality: 'low', hudMode: 'compact' },
      hudMode: 'compact', bloom: false, width: 390, height: 844 },
    { id: 'enhanced-balanced', saved: { version: 1, visualMode: 'enhanced', visualQuality: 'balanced', hudMode: 'full' },
      hudMode: 'full', bloom: true, width: 1440, height: 1000 },
  ]
  const results = []
  const controls = async (scope, hudMode) => {
    const state = await browser.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(scope)});
      if (!root) throw new Error('Settings container is missing');
      const selects = [...root.querySelectorAll('select')];
      const select = selects[0];
      return { text: root.textContent, count: selects.length, value: select?.value,
        options: select ? [...select.options].map(option => option.value) : [],
        overflow: root.scrollWidth > root.clientWidth + 1,
        height: select?.getBoundingClientRect().height,
        label: select?.labels[0]?.firstChild?.textContent };
    })()`)
    assert.equal(state.count, 1)
    assert.equal(state.value, hudMode)
    assert.deepEqual(state.options, ['full', 'compact'])
    assert.equal(state.overflow, false)
    assert.ok(state.height >= 44)
    assert.equal(state.label, 'Боевой интерфейс')
    assert.doesNotMatch(state.text, /предпросмотр|Режим графики|Качество|повторного входа/i)
    return state
  }
  const checkPolicy = async (bloom) => {
    const snapshot = await browser.evaluate('window.__korovanyGraphics.render(2)')
    const policy = snapshot.runtime.visualPolicy
    assert.equal(policy.mode, 'enhanced')
    assert.equal(policy.quality, 'high')
    assert.equal(policy.shadows.mapSize, 2048)
    assert.equal(policy.render.maxPixels, 2_100_000)
    assert.equal(policy.preferences.bloomEnabled, bloom)
    assert.equal(snapshot.runtime.rendering.post.composer, bloom)
    assert.ok(snapshot.lastFrame.total.calls > 0)
    return snapshot
  }
  for (const entry of cases) {
    checkTime()
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: entry.width, height: entry.height, deviceScaleFactor: 1, mobile: false,
    })
    await browser.send('Page.navigate', { url: origin })
    await browser.waitFor('document.readyState === "complete" && !!document.querySelector(".menu-settings")')
    await browser.evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem('korovany-music-muted', 'true');
      localStorage.setItem('korovany-sfx-volume', '0');
      localStorage.setItem('korovany-bloom', ${JSON.stringify(String(entry.bloom))});
      const saved = ${JSON.stringify(entry.saved)};
      if (saved) localStorage.setItem('korovany-visual-preferences', JSON.stringify(saved));
    })()`)
    // Instrument the real launch without supplying any mode or quality override.
    await browser.send('Page.navigate', { url: `${origin}/?graphicsDiagnostics=1` })
    await browser.waitFor('!!document.querySelector("#world-seed")')
    const menu = await controls('.menu-settings .visual-settings', entry.hudMode)
    await browser.evaluate('document.querySelector(".menu-settings .visual-settings").scrollIntoView({block:"center"})')
    await record(`${entry.id}-menu`, menu)
    await browser.clickSelector('.faction-card.guard button')
    await browser.waitFor('!!window.__korovanyGraphics', 60000)
    await settleHeldViewport(browser)
    const launch = await checkPolicy(entry.bloom)
    await browser.clickSelector('.hud-pause')
    await browser.waitFor('!!document.querySelector(".pause-modal")')
    await controls('.pause-modal .visual-settings', entry.hudMode)
    const savedBefore = portraitSaveIdentity(await browser.evaluate('window.__korovanyGraphics.save()'))
    await browser.evaluate('window.__settingsTestOwner = window.__korovanyGraphics')
    const nextHud = entry.hudMode === 'full' ? 'compact' : 'full'
    await browser.evaluate(`(() => {
      const select = document.querySelector('.pause-modal .visual-settings select');
      select.value = ${JSON.stringify(nextHud)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await browser.waitFor(`document.querySelector(".game-screen").dataset.hud === ${JSON.stringify(nextHud)}`)
    assert.equal(await browser.evaluate('window.__settingsTestOwner === window.__korovanyGraphics'), true)
    assert.equal((await checkPolicy(entry.bloom)).runtime.paused, true)
    assert.equal(portraitSaveIdentity(await browser.evaluate('window.__korovanyGraphics.save()')), savedBefore)
    assert.deepEqual(await browser.evaluate('JSON.parse(localStorage.getItem("korovany-visual-preferences"))'),
      { version: 2, hudMode: nextHud })
    await browser.evaluate('document.querySelector(".pause-modal .visual-settings").scrollIntoView({block:"center"})')
    await record(`${entry.id}-pause`, await controls('.pause-modal .visual-settings', nextHud))
    await browser.clickSelector('.pause-modal .pause-actions .text-button')
    await browser.waitFor('!window.__korovanyGraphics && !!document.querySelector(".active-run-card")')
    await controls('.menu-settings .visual-settings', nextHud)
    // Simulate a saved campaign whose player still has the old lower graphics preference.
    if (entry.saved) await browser.evaluate(`localStorage.setItem('korovany-visual-preferences', ${JSON.stringify(JSON.stringify(entry.saved))})`)
    await browser.send('Page.reload')
    await browser.waitFor('!!document.querySelector(".active-run-actions .primary-button")')
    await browser.clickSelector('.active-run-actions .primary-button')
    await browser.waitFor('!!window.__korovanyGraphics', 60000)
    await settleHeldViewport(browser)
    const resumed = await checkPolicy(entry.bloom)
    assert.equal(portraitSaveIdentity(await browser.evaluate('window.__korovanyGraphics.save()')), savedBefore)
    assert.equal(await browser.evaluate('localStorage.getItem("korovany-bloom")'), String(entry.bloom))
    await record(`${entry.id}-continued`, resumed)
    results.push({ id: entry.id, launchPolicy: launch.runtime.visualPolicy, resumedPolicy: resumed.runtime.visualPolicy,
      hudLiveWithoutRestart: true, savePreserved: true })
  }
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: originalViewport.width, height: originalViewport.height,
    deviceScaleFactor: originalViewport.dpr, mobile: false,
  })
  await browser.send('Page.navigate', { url: origin })
  await browser.waitFor('document.readyState === "complete" && !!document.querySelector(".menu-settings")')
  return { complete: true, cases: results }
}
