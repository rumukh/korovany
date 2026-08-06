import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

function extractBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `Missing ${marker}`)

  const openingBrace = source.indexOf('{', markerIndex)
  assert.notEqual(openingBrace, -1, `Missing opening brace for ${marker}`)

  let depth = 0
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] !== '}') continue
    depth -= 1
    if (depth === 0) return source.slice(openingBrace + 1, index)
  }

  assert.fail(`Missing closing brace for ${marker}`)
}

function extractRule(source: string, selector: string): string {
  return extractBlock(source, `${selector} {`)
}

interface Rectangle {
  bottom: number
  left: number
  right: number
  top: number
}

function intersectionArea(first: Rectangle, second: Rectangle): number {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  )
  return width * height
}

test('menu settings reserve their wrapped height before the hero branding', () => {
  const settingsRule = extractRule(appCss, '.menu-settings')
  const mobileMenuCss = extractBlock(appCss, '@media (max-width: 720px), (pointer: coarse) {')
  const settingsIndex = appSource.indexOf('<div className="menu-settings">')
  const heroIndex = appSource.indexOf('<header className="hero-header">')

  assert.match(settingsRule, /margin-left:\s*auto;/)
  assert.match(settingsRule, /max-width:\s*min\(52rem,\s*100%\);/)
  assert.match(settingsRule, /position:\s*relative;/)
  assert.doesNotMatch(settingsRule, /position:\s*absolute;/)
  assert.doesNotMatch(mobileMenuCss, /\.menu-settings\s*\{/)
  assert.notEqual(settingsIndex, -1)
  assert.notEqual(heroIndex, -1)
  assert.ok(settingsIndex < heroIndex)
})

test('flow-stacked settings have zero intersection with menu branding at target sizes', () => {
  const targets = [
    { height: 800, settingsHeight: 144, width: 1280 },
    { height: 844, settingsHeight: 96, width: 390 },
    { height: 568, settingsHeight: 144, width: 320 },
  ] as const

  for (const theme of ['dark', 'light'] as const) {
    for (const target of targets) {
      const mobile = target.width <= 720
      const menuPaddingTop = (mobile ? 1 : 1.5) * 16
      const heroPaddingTop = (mobile ? 2.8 : 3.6) * 16
      const titleMarginTop = 1.3 * 16
      const kickerMarginTop = 1.15 * 16
      const tagHeight = 30
      const titleHeight = mobile ? 58 : 86
      const kickerHeight = 20
      const settings: Rectangle = {
        bottom: menuPaddingTop + target.settingsHeight,
        left: 0,
        right: target.width,
        top: menuPaddingTop,
      }
      const tag: Rectangle = {
        bottom: settings.bottom + heroPaddingTop + tagHeight,
        left: 0,
        right: target.width,
        top: settings.bottom + heroPaddingTop,
      }
      const title: Rectangle = {
        bottom: tag.bottom + titleMarginTop + titleHeight,
        left: 0,
        right: target.width,
        top: tag.bottom + titleMarginTop,
      }
      const kicker: Rectangle = {
        bottom: title.bottom + kickerMarginTop + kickerHeight,
        left: 0,
        right: target.width,
        top: title.bottom + kickerMarginTop,
      }

      for (const [name, branding] of [
        ['tag', tag],
        ['title', title],
        ['kicker', kicker],
      ] as const) {
        assert.equal(
          intersectionArea(settings, branding),
          0,
          `${theme} ${target.width}x${target.height}: settings intersect ${name}`,
        )
      }
    }
  }
})
