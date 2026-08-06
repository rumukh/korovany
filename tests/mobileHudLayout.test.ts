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

test('mobile objectives, prompts, and touch controls use coordinated safe-area regions', () => {
  const gameScreenRule = extractRule(mobileHudCss, '.game-screen')
  const objectivesRule = extractRule(mobileHudCss, '.objectives-card')
  const objectiveListRule = extractRule(mobileHudCss, '.objectives-card .objective-list')
  const objectiveItemRule = extractRule(mobileHudCss, '.objectives-card .objective-item')
  const promptRule = extractRule(mobileHudCss, '.action-prompt')
  const controlsRule = extractRule(mobileHudCss, '.touch-controls')

  assert.match(
    gameScreenRule,
    /--mobile-controls-bottom:\s*max\(0\.8rem,\s*env\(safe-area-inset-bottom,\s*0px\)\);/,
  )
  assert.match(
    gameScreenRule,
    /--mobile-controls-left:\s*max\(0\.8rem,\s*env\(safe-area-inset-left,\s*0px\)\);/,
  )
  assert.match(
    gameScreenRule,
    /--mobile-controls-right:\s*max\(0\.8rem,\s*env\(safe-area-inset-right,\s*0px\)\);/,
  )
  assert.match(objectivesRule, /max-height:\s*max\(/)
  assert.match(objectivesRule, /order:\s*1;/)
  assert.match(
    objectivesRule,
    /width:\s*calc\(50vw\s*-\s*var\(--mobile-objectives-left\)\s*-\s*var\(--mobile-hud-half-gap\)\);/,
  )
  assert.match(
    mobileHudCss,
    /\.contract-card,\s*\.doctrine-card\s*\{\s*order:\s*2;/,
  )
  assert.match(mobileHudCss, /\.event-banner\s*\{\s*order:\s*3;/)
  assert.match(objectiveListRule, /overflow-y:\s*auto;/)
  assert.match(objectiveListRule, /touch-action:\s*pan-y;/)
  assert.match(objectiveItemRule, /flex:\s*0\s+0\s+auto;/)
  assert.match(
    promptRule,
    /bottom:\s*calc\(\s*var\(--mobile-controls-bottom\)\s*\+\s*var\(--mobile-touch-controls-height\)\s*\+\s*var\(--mobile-hud-region-gap\)\s*\);/,
  )
  assert.match(promptRule, /left:\s*calc\(50%\s*\+\s*var\(--mobile-hud-half-gap\)\);/)
  assert.match(promptRule, /white-space:\s*normal;/)
  assert.match(controlsRule, /bottom:\s*var\(--mobile-controls-bottom\);/)
  assert.match(controlsRule, /left:\s*var\(--mobile-controls-left\);/)
  assert.match(controlsRule, /right:\s*var\(--mobile-controls-right\);/)
})

test('mobile HUD reserved regions have zero rectangle intersection at target sizes', () => {
  const rem = 16
  const controlsEdge = 0.8 * rem
  const controlsHeight = 8.85 * rem
  const halfGap = 0.25 * rem
  const objectiveLeft = 0.55 * rem
  const objectiveTop = 20.85 * rem
  const regionGap = 0.25 * rem

  for (const [viewportWidth, viewportHeight] of [
    [320, 568],
    [390, 844],
  ]) {
    const controlsTop = viewportHeight - controlsEdge - controlsHeight
    const reservedTop = controlsTop - regionGap
    const objectives: Rectangle = {
      bottom: reservedTop,
      left: objectiveLeft,
      right: viewportWidth / 2 - halfGap,
      top: objectiveTop,
    }
    const prompt: Rectangle = {
      bottom: reservedTop,
      left: viewportWidth / 2 + halfGap,
      right: viewportWidth - controlsEdge,
      top: 0,
    }
    const controls: Rectangle = {
      bottom: viewportHeight - controlsEdge,
      left: controlsEdge,
      right: viewportWidth - controlsEdge,
      top: controlsTop,
    }

    assert.ok(objectives.bottom > objectives.top, `${viewportWidth}px objective region collapsed`)
    assert.ok(prompt.right > prompt.left, `${viewportWidth}px prompt region collapsed`)
    assert.equal(intersectionArea(objectives, prompt), 0)
    assert.equal(intersectionArea(objectives, controls), 0)
    assert.equal(intersectionArea(prompt, controls), 0)
  }
})
