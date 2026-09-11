import assert from 'node:assert/strict'
import { describeHint } from '../../src/game/content/gameCopy.ts'
import { delay } from './cdp.mjs'

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
