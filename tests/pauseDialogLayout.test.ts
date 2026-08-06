import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

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

const narrowPauseCss = extractBlock(appCss, '@media (max-width: 360px) {')

test('pause dialog keeps vertical scrolling without a horizontal scroll track', () => {
  const pauseModalRule = extractRule(appCss, '.pause-modal')

  assert.match(pauseModalRule, /overflow-x:\s*hidden;/)
  assert.match(pauseModalRule, /overflow-y:\s*auto;/)
})

test('narrow pause settings can shrink and stack the SFX range', () => {
  const settingRule = extractRule(narrowPauseCss, '.pause-setting')
  const labelRule = extractRule(narrowPauseCss, '.pause-setting > span')
  const sfxRule = extractRule(narrowPauseCss, '.pause-setting.sfx-volume-control')
  const rangeRule = extractRule(
    narrowPauseCss,
    '.pause-setting.sfx-volume-control input[type="range"]',
  )
  const valueRule = extractRule(
    narrowPauseCss,
    '.pause-setting.sfx-volume-control strong',
  )

  assert.match(settingRule, /min-width:\s*0;/)
  assert.match(labelRule, /min-width:\s*0;/)
  assert.match(labelRule, /overflow-wrap:\s*anywhere;/)
  assert.match(sfxRule, /flex-shrink:\s*0;/)
  assert.match(sfxRule, /flex-wrap:\s*wrap;/)
  assert.match(rangeRule, /flex:\s*1\s+1\s+100%;/)
  assert.match(rangeRule, /margin-left:\s*0;/)
  assert.match(rangeRule, /min-width:\s*0;/)
  assert.match(rangeRule, /order:\s*1;/)
  assert.match(rangeRule, /width:\s*100%;/)
  assert.match(valueRule, /min-width:\s*0;/)
})

test('pause setting rows fit the 320px dialog client width', () => {
  const rem = 16
  const viewportWidth = 320
  const backdropPadding = rem
  const modalBorder = 1
  const modalPadding = 2 * rem
  const settingBorder = 1
  const settingPadding = 0.7 * rem
  const settingGap = 0.55 * rem
  const iconWidth = rem
  const percentageWidth = 2.25 * rem

  const dialogClientWidth = viewportWidth - 2 * backdropPadding - 2 * modalBorder
  const settingBorderBoxWidth = dialogClientWidth - 2 * modalPadding
  const settingClientWidth = settingBorderBoxWidth - 2 * settingBorder
  const settingContentWidth = settingClientWidth - 2 * settingPadding
  const sfxLabelWidth =
    settingContentWidth - iconWidth - percentageWidth - 2 * settingGap

  assert.ok(sfxLabelWidth > 0, `SFX label has ${sfxLabelWidth}px available`)

  const sfxTopRowWidth =
    iconWidth + settingGap + sfxLabelWidth + settingGap + percentageWidth
  const rangeRowWidth = settingContentWidth
  const modeledScrollWidth =
    2 * settingPadding + Math.max(sfxTopRowWidth, rangeRowWidth)

  assert.ok(Math.abs(modeledScrollWidth - settingClientWidth) < Number.EPSILON * 256)
  assert.ok(settingBorderBoxWidth <= dialogClientWidth)
})
