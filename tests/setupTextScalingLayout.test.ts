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

test('run setup breakpoints respond to 200% browser text scaling', () => {
  const setupReflowCss = extractBlock(appCss, '@media (max-width: 45em) {')
  const compactSetupCss = extractBlock(appCss, '@media (max-width: 30em) {')
  const fixedViewportCss = extractBlock(
    appCss,
    '@media (max-width: 720px), (pointer: coarse) {',
  )
  const doubledBrowserFontSize = 32
  const viewportWidth = 1280

  assert.ok(viewportWidth <= 45 * doubledBrowserFontSize)
  assert.ok(viewportWidth > 720, 'the fixed mobile breakpoint must remain inactive')
  assert.doesNotMatch(fixedViewportCss, /\.run-setup|\.seed-controls|\.boon-grid/)

  assert.match(extractRule(setupReflowCss, '.run-setup,\n  .seed-controls'), /1fr/)
  assert.match(
    extractRule(setupReflowCss, '.boon-grid'),
    /repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  )
  assert.match(extractRule(compactSetupCss, '.boon-grid'), /grid-template-columns:\s*1fr;/)
})

test('scaled setup cards and seed values fit the 1280px client geometry', () => {
  const rem = 32
  const viewportWidth = 1280
  const clientWidth = 1265
  const menuInlinePadding = Math.min(4 * rem, Math.max(rem, viewportWidth * 0.04))
  const factionPadding = Math.min(2 * rem, Math.max(1.1 * rem, viewportWidth * 0.025))
  const setupWidth = clientWidth - 2 * menuInlinePadding - 2 * factionPadding - 2
  const panelContentWidth = setupWidth - 2 * 0.9 * rem - 2
  const twoColumnCardClientWidth = (panelContentWidth - 0.45 * rem) / 2 - 2
  const seedInputContentWidth = panelContentWidth - 2 * 0.72 * rem - 2
  const widestReportedCardContent = 314
  const tenDigitSeedWidth = 10 * 0.7 * rem

  assert.ok(twoColumnCardClientWidth > widestReportedCardContent)
  assert.ok(seedInputContentWidth > tenDigitSeedWidth)
  assert.match(
    appSource,
    /<code aria-label=\{`Канонический seed \$\{canonicalSeed\}`\}>\{canonicalSeed\}<\/code>/,
  )
  assert.match(appSource, /value=\{seedInput\}/)
})

test('scaled canonical seed can wrap without being hidden or ellipsized', () => {
  const setupReflowCss = extractBlock(appCss, '@media (max-width: 45em) {')
  const seedRule = extractRule(setupReflowCss, '.run-setup-heading > code')

  assert.match(seedRule, /max-width:\s*100%;/)
  assert.match(seedRule, /overflow:\s*visible;/)
  assert.match(seedRule, /overflow-wrap:\s*anywhere;/)
  assert.match(seedRule, /text-overflow:\s*clip;/)
})
