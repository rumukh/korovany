import assert from 'node:assert/strict'
import { portraitSaveIdentity } from './portraits.mjs'
import { settleHeldViewport } from './runtime-controls.mjs'

export async function captureSettingsControls(browser, origin, originalViewport, record, checkTime) {
  const cases = [
    { id: 'fresh', faction: 'elf', saved: null, hudMode: 'full', bloom: true, width: 1440, height: 1000 },
    { id: 'legacy-low', saved: { version: 1, visualMode: 'legacy', visualQuality: 'low', hudMode: 'compact' },
      faction: 'guard', hudMode: 'compact', bloom: false, width: 390, height: 844 },
    { id: 'enhanced-balanced', saved: { version: 1, visualMode: 'enhanced', visualQuality: 'balanced', hudMode: 'full' },
      faction: 'villain', hudMode: 'full', bloom: true, width: 1440, height: 1000 },
  ]
  const results = []
  const measureMenu = async (firstScreen) => {
    const layout = await browser.evaluate(`(() => {
      scrollTo(0, 0);
      const rect = selector => {
        const node = document.querySelector(selector);
        if (!node) throw new Error('Missing menu element: ' + selector);
        const box = node.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      };
      const selectors = ['.hero-header', '.faction-grid', '.run-setup', '.menu-lower', '.menu-settings', '.menu-footer'];
      const sections = selectors.map(rect);
      const nodes = selectors.map(selector => document.querySelector(selector));
      return {
        width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth, sections,
        buttons: ['elf', 'guard', 'villain'].map(faction => rect('.faction-card.' + faction + ' button')),
        documentOrder: nodes.slice(1).every((node, index) => Boolean(
          nodes[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)),
        settingsOverflow: document.querySelector('.menu-settings').scrollWidth >
          document.querySelector('.menu-settings').clientWidth + 1,
      };
    })()`)
    assert.equal(layout.documentOrder, true)
    assert.ok(layout.scrollWidth <= layout.clientWidth, `Horizontal overflow at ${layout.width}`)
    assert.equal(layout.settingsOverflow, false)
    assert.ok(layout.sections.slice(0, -1).every(section => section.bottom > section.top),
      'Primary menu content must remain visible')
    for (let index = 1; index < layout.sections.length; index++) {
      if (index === layout.sections.length - 1 && layout.sections[index].bottom === 0) continue
      assert.ok(layout.sections[index].top >= layout.sections[index - 1].bottom,
        `Menu sections overlap at ${layout.width}: ${JSON.stringify(layout.sections)}`)
    }
    for (const button of layout.buttons) {
      assert.ok(button.left >= 0 && button.right <= layout.clientWidth)
      assert.ok(button.bottom - button.top >= 44)
      if (firstScreen) assert.ok(button.top >= 0 && button.bottom <= layout.height,
        `Launch button below the fold at ${layout.width}x${layout.height}: ${JSON.stringify(button)}`)
    }
    return layout
  }
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
    if (entry.id === 'fresh') {
      for (const [width, height, dpr] of [[2560, 1440, 1], [2048, 1152, 1.25], [1707, 960, 1.5], [1280, 800, 1]]) {
        checkTime()
        await browser.send('Emulation.setDeviceMetricsOverride', {
          width, height, deviceScaleFactor: dpr, mobile: false,
        })
        await browser.waitFor(`innerWidth === ${width} && innerHeight === ${height}`)
        await record(`launch-${width}`, await measureMenu(height >= 960))
      }
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: entry.width, height: entry.height, deviceScaleFactor: 1, mobile: false,
      })
    }
    await measureMenu(entry.width >= 1000)
    const theme = await browser.evaluate('document.documentElement.dataset.theme')
    await browser.clickSelector('.menu-settings .theme-toggle')
    await browser.waitFor(`document.documentElement.dataset.theme !== ${JSON.stringify(theme)}`)
    assert.equal(await browser.evaluate('localStorage.getItem("korovany-theme")'),
      theme === 'dark' ? 'light' : 'dark')
    await measureMenu(entry.width >= 1000)
    await browser.clickSelector('.menu-settings .theme-toggle')
    await browser.type('#world-seed', '20260906')
    await browser.waitFor('[...document.querySelectorAll(".faction-card button")].every(button => button.textContent.includes("20260906"))')
    const menu = await controls('.menu-settings .visual-settings', entry.hudMode)
    await browser.evaluate('document.querySelector(".menu-settings .visual-settings").scrollIntoView({block:"center"})')
    await record(`${entry.id}-menu`, menu)
    await browser.clickSelector(`.faction-card.${entry.faction} button`)
    await browser.waitFor('!!window.__korovanyGraphics', 60000)
    await settleHeldViewport(browser)
    const launch = await checkPolicy(entry.bloom)
    assert.equal(launch.runtime.faction, entry.faction)
    assert.equal((await browser.evaluate('window.__korovanyGraphics.save()')).config.seed, 20260906)
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
