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

const mobileHudCss = extractBlock(appCss, '@media (max-width: 720px), (pointer: coarse) {')

test('mobile gameplay header assigns identity and minimap to explicit non-overlapping columns', () => {
  const topHudRule = extractRule(mobileHudCss, '.top-hud')
  const identityRule = extractRule(mobileHudCss, '.identity-panel')
  const mapRule = extractRule(mobileHudCss, '.minimap-card.generated')

  assert.match(topHudRule, /display:\s*grid;/)
  assert.match(
    topHudRule,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+clamp\(6\.5rem,\s*34vw,\s*8\.4rem\);/,
  )
  assert.match(identityRule, /grid-template-areas:\s*"zone actions"\s*"threat actions";/)
  assert.match(identityRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/)
  assert.match(mapRule, /width:\s*100%;/)
})

test('mobile threat, music, pause, and minimap stay rendered with thumb-sized actions', () => {
  const actionRule = extractRule(mobileHudCss, '.hud-actions .icon-button')
  const threatRule = extractRule(mobileHudCss, '.threat-chip')

  assert.match(actionRule, /min-height:\s*2\.75rem;/)
  assert.match(actionRule, /width:\s*2\.75rem;/)
  assert.match(threatRule, /grid-area:\s*threat;/)
  assert.match(threatRule, /min-width:\s*4rem;/)
  assert.match(appSource, /className=\{`threat-chip tier-\$\{view\.threatTier\}`\}/)
  assert.match(appSource, /className=\{`icon-button hud-music/)
  assert.match(appSource, /className="icon-button hud-pause"/)
  assert.match(appSource, /<MiniMap view=\{view\} \/>/)
})

test('mobile header column budget fits the status and both 44px actions at target widths', () => {
  const rem = 16
  const fixedIdentityContent =
    4 * rem
    + 0.35 * rem
    + 2 * 2.75 * rem
    + 0.35 * rem
    + 2 * 0.5 * rem

  for (const viewportWidth of [320, 390]) {
    const minimapWidth = Math.min(8.4 * rem, Math.max(6.5 * rem, viewportWidth * 0.34))
    const identityWidth = viewportWidth - 2 * 0.55 * rem - 0.45 * rem - minimapWidth

    assert.ok(
      identityWidth >= fixedIdentityContent,
      `${viewportWidth}px leaves ${identityWidth}px for ${fixedIdentityContent}px of identity controls`,
    )
  }
})
