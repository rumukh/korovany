import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const historyHtml = readFileSync(
  new URL('../public/history/index.html', import.meta.url),
  'utf8',
)

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

test('history headline isolates the complete product name as one mobile line', () => {
  const productName = '\u00ab\u041a\u041e\u0420\u041e\u0412\u0410\u041d\u042b\u00bb'
  const productNameRule = extractRule(historyHtml, '.hero .product-name')

  assert.ok(
    historyHtml.includes(`<span class="product-name">${productName}</span>`),
    'history heading must keep the complete product name in its sizing hook',
  )
  assert.match(productNameRule, /display:\s*inline-block;/)
  assert.match(productNameRule, /white-space:\s*nowrap;/)
})

test('history product name fits the measured 320px and 390px headline widths', () => {
  const mobileCss = extractBlock(historyHtml, '@media (max-width: 640px) {')
  const productNameRule = extractRule(mobileCss, '.hero .product-name')
  const rem = 16

  assert.match(
    productNameRule,
    /font-size:\s*clamp\(2\.4rem,\s*11\.5vw,\s*4\.7rem\);/,
  )

  for (const target of [
    { clientWidth: 280, originalWidth: 365, viewportWidth: 320 },
    { clientWidth: 335, originalWidth: 444, viewportWidth: 390 },
  ]) {
    const originalFontSize = target.viewportWidth * 0.16
    const productFontSize = Math.min(
      4.7 * rem,
      Math.max(2.4 * rem, target.viewportWidth * 0.115),
    )
    const productWidth = target.originalWidth * productFontSize / originalFontSize

    assert.ok(
      productWidth <= target.clientWidth,
      `${target.viewportWidth}px product name needs ${productWidth}px inside ${target.clientWidth}px`,
    )
  }
})
