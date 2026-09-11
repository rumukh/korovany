import assert from 'node:assert/strict'
import { describeHint } from '../../src/game/content/gameCopy.ts'
import { delay } from './cdp.mjs'
import { settleHeldViewport } from './runtime-controls.mjs'

/** Reuses the runner's browser. A real guard key edge produces the notice, not injected DOM. */
export async function captureNoticeLayout(browser, originalViewport, record, checkTime) {
  const message = describeHint('perfectGuard').text
  await browser.evaluate('document.activeElement?.blur()')
  await browser.key('KeyR', true)
  const measurements = []
  try {
    const noticePresent = `Array.from(document.querySelectorAll('.notice')).some(node => node.textContent === ${JSON.stringify(message)})`
    // Hint pacing uses simulation time, while notice expiry uses wall time. Honor both clocks.
    for (let step = 0; step < 48 && !await browser.evaluate(noticePresent); step++) {
      checkTime()
      await browser.evaluate('window.__korovanyGraphics.step(30, 1/60)')
      await delay(500)
    }
    await browser.waitFor(noticePresent, 1000)
    await browser.key('KeyR', false)
    for (const viewport of [{ width: 390, height: 844, dpr: 1 }, { width: 1920, height: 1080, dpr: 1 }]) {
      checkTime()
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dpr, mobile: false,
      })
      await browser.waitFor(`innerWidth === ${viewport.width} && innerHeight === ${viewport.height}`)
      await settleHeldViewport(browser)
      await browser.evaluate('window.__korovanyGraphics.render(2)')
      const measurement = await browser.evaluate(`(() => {
        const message = ${JSON.stringify(message)};
        const notice = Array.from(document.querySelectorAll('.notice')).find(node => node.textContent === message);
        if (!notice) throw new Error('Actual guard teaching notice expired before layout capture');
        const rectangle = node => {
          const r = node.getBoundingClientRect();
          return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
        };
        const area = (a,b) => Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)) *
          Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
        const selectors = ['.vitals','.meter.health','.meter.stamina','.squad-command-strip',
          '.combat-mastery-hud','.minimap-card','.expedition-compass','.touch-controls'];
        const rect = rectangle(notice);
        const essentials = Object.fromEntries(selectors.map(selector => {
          const node = document.querySelector(selector);
          if (!node) throw new Error('Missing essential HUD source '+selector);
          return [selector,rectangle(node)];
        }));
        return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},message,notice:rect,essentials,
          intersections:Object.fromEntries(Object.entries(essentials).map(([key,value]) => [key,area(rect,value)])),
          noticeCount:document.querySelectorAll('.notice').length,live:notice.parentElement.getAttribute('aria-live'),
          parent:notice.parentElement.parentElement.className,
          hudMode:document.querySelector('.game-screen').dataset.hud,
          touchButtons:Array.from(document.querySelectorAll('.touch-controls button')).map(rectangle)};
      })()`)
      measurements.push(measurement)
      await record(`notice-${viewport.width}`, measurement)
    }
    for (const measurement of measurements) {
      assert.equal(measurement.hudMode, 'compact')
      assert.equal(measurement.live, 'polite')
      for (const [selector, area] of Object.entries(measurement.intersections)) {
        assert.equal(area, 0, `${measurement.viewport.width}px notice intersects ${selector}`)
      }
      if (measurement.viewport.width === 390) {
        assert.ok(measurement.notice.right <= 390 && measurement.notice.left >= 0)
        assert.ok(measurement.touchButtons.every(rect => rect.width >= 44 && rect.height >= 44))
      }
    }
    return { complete: true, actualGuardNotice: true, viewports: measurements.map(entry => entry.viewport) }
  } finally {
    await browser.key('KeyR', false)
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: originalViewport.width, height: originalViewport.height,
      deviceScaleFactor: originalViewport.dpr, mobile: false,
    })
  }
}

/** Uses actual server-rendered components and production CSS, without creating an engine. */
export async function captureNoticeComponentLayout(browser, packet, buildHtml, record, checkTime) {
  assert.equal(packet.kind, 'production-hud-component-layout-v1')
  assert.deepEqual(packet.cases.map(entry => entry.id),
    ['compact-finale', 'compact-ordinary', 'full-finale', 'full-ordinary'])
  const styles = [...buildHtml.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]).join('\n')
  assert.ok(styles.includes('notice-stack') && styles.includes('finale-hud'), 'Use built production CSS in its actual cascade order')
  const measurements = []
  const { frameTree } = await browser.send('Page.getFrameTree')
  for (const entry of packet.cases) {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      checkTime()
      await browser.send('Emulation.setDeviceMetricsOverride', {
        ...viewport, deviceScaleFactor: 1, mobile: false,
      })
      await browser.send('Page.setDocumentContent', {
        frameId: frameTree.frame.id,
        html: `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="UTF-8">${styles}</head>
          <body><div id="root">${entry.markup}</div>
          <div style="position:fixed;left:40%;bottom:0;z-index:10000;background:#111;color:#fff;font:12px monospace;pointer-events:none">
          STAGED COMPONENT LAYOUT: ${entry.id}; no engine/boss gameplay</div></body></html>`,
      })
      await browser.evaluate(`(() => {
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 1000; }
      })()`)
      const measurement = await browser.evaluate(`(() => {
        const rectangle = node => {
          const r = node.getBoundingClientRect();
          return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
        };
        const notice = document.querySelector('.notice'), stack = document.querySelector('.notice-stack');
        if (!notice || !stack) throw new Error('Missing actual notice component');
        const style = getComputedStyle(stack), rect = rectangle(notice);
        const essentials = Object.fromEntries(['.identity-panel','.hud-pause','.vitals','.meter.health','.meter.stamina','.combat-mastery-hud',
          '.finale-hud','.touch-controls','.bottom-hud','.action-prompt','.expedition-compass'].map(selector => {
          const node = document.querySelector(selector);
          return [selector,node ? rectangle(node) : null];
        }));
        const area = (a,b) => b ? Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)) *
          Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)) : 0;
        return {viewport:{width:innerWidth,height:innerHeight},notice:rect,stack:rectangle(stack),essentials,
          intersections:Object.fromEntries(Object.entries(essentials).map(([selector,value]) => [selector,area(rect,value)])),
          style:{position:style.position,top:style.top,bottom:style.bottom,left:style.left,width:style.width,transform:style.transform},
          offsetParent:stack.offsetParent?.className ?? null,parent:stack.parentElement.className,
          message:notice.textContent,noticeCount:document.querySelectorAll('.notice').length,
          liveRegions:document.querySelectorAll('.notice-stack[aria-live="polite"]').length,
          engineAbsent:window.__korovanyGraphics === undefined && !document.querySelector('.game-canvas')};
      })()`)
      const result = { ...entry, markup: undefined, ...measurement, limitation: packet.limitation }
      measurements.push(result)
      await record(`${entry.id}-${viewport.width}`, result)
    }
  }
  for (const measurement of measurements) {
    assert.equal(measurement.engineAbsent, true)
    assert.equal(measurement.noticeCount, 1)
    assert.equal(measurement.liveRegions, 1)
    assert.equal(measurement.message, describeHint('perfectGuard').text)
    if (measurement.mode !== 'compact') continue
    for (const [selector, area] of Object.entries(measurement.intersections)) {
      assert.equal(area, 0, `${measurement.id} ${measurement.viewport.width}px notice intersects ${selector}`)
    }
    if (measurement.finale && measurement.viewport.width === 1920) {
      const originalLane = measurements.find(entry => entry.id === 'full-finale' && entry.viewport.width === 1920)
      for (const edge of ['left', 'right', 'bottom']) {
        assert.equal(measurement.stack[edge], originalLane.stack[edge], `Compact finale retains original lane ${edge}`)
      }
    }
    if (measurement.viewport.width === 390) {
      assert.equal(measurement.style.position, 'static')
      assert.equal(measurement.parent, 'top-hud-side')
      assert.ok(measurement.notice.right <= 390 && measurement.notice.left >= 0)
    }
  }
  return { complete: true, cases: measurements.length, componentLayoutOnly: true, engineOrBossGameplay: false }
}
