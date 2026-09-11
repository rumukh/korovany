import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const combatHudSource = readFileSync(new URL('../src/game/ui/CombatMasteryHud.tsx', import.meta.url), 'utf8')

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
const compactCss = readFileSync(new URL('../src/game/ui/compact-combat.css', import.meta.url), 'utf8')

test('compact mobile notices use the normal-flow right-hand safe region without covering vitals or duplicating live content', () => {
  const mobile = extractBlock(compactCss, '@media (max-width: 720px), (pointer: coarse) {')
  const notices = extractRule(mobile, '.game-screen[data-hud="compact"] .notice-stack')
  assert.match(notices, /position:\s*static;/)
  assert.match(notices, /transform:\s*none;/)
  assert.match(notices, /width:\s*100%;/)
  assert.match(extractRule(mobile, '.game-screen[data-hud="compact"] .notice'), /overflow-wrap:\s*anywhere;/)
  assert.match(extractRule(mobile, '.game-screen[data-hud="compact"] .notice-stack:empty'), /display:\s*none;/)
  assert.doesNotMatch(notices, /max-height|overflow:\s*hidden|display:\s*none/)
  const desktop = extractBlock(compactCss, '@media (min-width: 721px) and (pointer: fine) {')
  const desktopNotice = extractRule(desktop, '.game-screen[data-hud="compact"] .notice-stack')
  assert.match(desktopNotice, /top:\s*0;/)
  assert.match(desktopNotice, /width:\s*min\(28rem,\s*calc\(100% - 30rem\)\);/)
  const finaleNotice = extractRule(desktop, '.game-screen[data-hud="compact"]:has(.finale-hud) .notice-stack')
  assert.match(finaleNotice, /position:\s*fixed;/)
  assert.match(finaleNotice, /top:\s*auto;/)
  assert.match(finaleNotice, /bottom:\s*4\.5rem;/)
  assert.match(finaleNotice, /left:\s*1rem;/)
  assert.match(finaleNotice, /width:\s*19rem;/)
  assert.doesNotMatch(mobile, /position:\s*fixed;/)
})

function remValue(source: string, property: string): number {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*([\\d.]+)rem;`))
  assert.ok(match, `Missing rem value for ${property}`)
  return Number(match[1]) * 16
}

function touchGroupSource(group: string): string {
  const start = appSource.indexOf(`<div className="${group}">`)
  assert.notEqual(start, -1, `Missing ${group}`)
  const end = appSource.indexOf('\n        </div>', start)
  assert.notEqual(end, -1, `Missing end of ${group}`)
  return appSource.slice(start, end)
}

function touchActionCount(): number {
  const actions = touchGroupSource('touch-actions')
  const evadeButton = combatHudSource.slice(
    combatHudSource.indexOf('export function CombatEvadeButton'),
    combatHudSource.indexOf('export function CombatCameraControls'),
  )
  return (actions.match(/<button\b/g) ?? []).length +
    (actions.match(/<CombatEvadeButton\b/g) ?? []).length * (evadeButton.match(/<button\b/g) ?? []).length
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
  assert.match(appSource, /<MiniMap view=\{view\} onOpenAtlas=\{onOpenAtlas\} \/>/)
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
  const leftHudRule = extractRule(mobileHudCss, '.left-hud')
  const columnRule = extractRule(mobileHudCss, '.game-screen[data-zone] .left-hud:has(.mission-hud)')

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
  assert.match(columnRule, /height:\s*calc\(\s*100dvh\s*-\s*5\.2rem\s*-\s*var\(--mobile-touch-controls-height\)\s*-\s*var\(--mobile-controls-bottom\)\s*-\s*var\(--mobile-hud-region-gap\)/)
  assert.match(objectivesRule, /max-height:\s*100%;/)
  assert.match(objectivesRule, /order:\s*1;/)
  assert.match(leftHudRule, /width:\s*calc\(50vw\s*-\s*var\(--mobile-objectives-left\)\s*-\s*var\(--mobile-hud-half-gap\)\);/)
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
  assert.match(promptRule, /max-height:\s*var\(--mobile-prompt-height\);/)
  assert.match(promptRule, /overflow-y:\s*auto;/)
  assert.match(appCss, /\.mission-hud\s*\{\s*flex:\s*1\s+0\s+3\.6rem;\s*min-height:\s*3\.6rem;/)
  assert.match(appCss, /\.status-hud,\s*\.mission-hud\s*\{[^}]*overflow-y:\s*auto;/)
  assert.match(appCss, /\.game-screen\[data-zone\] \.left-hud \.status-hud\s*\{\s*flex:\s*0\s+1\s+auto;/)
  assert.match(controlsRule, /bottom:\s*var\(--mobile-controls-bottom\);/)
  assert.match(controlsRule, /left:\s*var\(--mobile-controls-left\);/)
  assert.match(controlsRule, /right:\s*var\(--mobile-controls-right\);/)
})

test('all eight actions and the sprint-enabled movement pad fit the original three-row allowance', () => {
  const actionsRule = extractRule(mobileHudCss, '.touch-actions')
  const moveRule = extractRule(mobileHudCss, '.touch-move')
  const buttonRule = extractRule(mobileHudCss, '.touch-controls button')
  const screenRule = extractRule(mobileHudCss, '.game-screen')
  const actions = touchGroupSource('touch-actions')
  const buttonSize = remValue(buttonRule, 'height')
  const actionGap = remValue(actionsRule, 'gap')
  const moveGap = remValue(moveRule, 'gap')
  const actionCount = touchActionCount()

  assert.equal(actionCount, 8)
  assert.match(actions, /instantGameplayAction\(onAttack\)/)
  assert.match(actions, /onPointerDown=[\s\S]*onAbilityDown\(\)/)
  assert.match(actions, /<CombatEvadeButton/)
  for (const callback of ['onInteract', 'onCommand', 'onOpenSquadCommand', 'onOpenAtlas']) {
    assert.ok(actions.includes(`instantGameplayAction(${callback})`), `Missing touch ${callback}`)
  }
  assert.match(actions, /onInput\('Space', true\)/)
  assert.match(actionsRule, /grid-template-columns:\s*repeat\(3,\s*2\.75rem\);/)
  assert.match(actionsRule, /grid-auto-rows:\s*2\.75rem;/)
  assert.match(moveRule, /grid-template-columns:\s*repeat\(3,\s*2\.75rem\);/)
  assert.equal((touchGroupSource('touch-move').match(/<button\b/g) ?? []).length, 5)
  assert.match(touchGroupSource('touch-move'), /touchHold\('ShiftLeft'\)/)
  assert.ok(buttonSize >= 44)
  assert.ok(remValue(buttonRule, 'width') >= 44)
  const rows = Math.ceil(actionCount / 3)
  const gridHeight = rows * buttonSize + (rows - 1) * actionGap
  assert.ok(gridHeight <= remValue(screenRule, '--mobile-touch-controls-height') + 0.001)

  for (const viewportWidth of [320, 390]) {
    const available = viewportWidth - 2 * 0.8 * 16
    const actionWidth = 3 * buttonSize + 2 * actionGap
    const moveWidth = 3 * buttonSize + 2 * moveGap
    assert.ok(moveWidth + actionWidth + 8 <= available, `${viewportWidth}px touch controls overflow`)
  }
})

test('combined status/mission column, atlas/finale column, prompts and controls never intersect', () => {
  const rem = 16
  const controlsEdge = 0.8 * rem
  const screenRule = extractRule(mobileHudCss, '.game-screen')
  const controlsHeight = remValue(screenRule, '--mobile-touch-controls-height')
  const halfGap = remValue(screenRule, '--mobile-hud-half-gap')
  const objectiveLeft = 0.55 * rem
  const columnTop = remValue(extractRule(mobileHudCss, '.left-hud'), 'top')
  const regionGap = remValue(screenRule, '--mobile-hud-region-gap')
  const promptHeight = remValue(screenRule, '--mobile-prompt-height')
  const sideRule = extractRule(mobileHudCss, '.top-hud-side')
  assert.match(sideRule, /max-height:\s*calc\(\s*100dvh\s*-\s*0\.55rem\s*-\s*var\(--mobile-touch-controls-height\)\s*-\s*var\(--mobile-controls-bottom\)\s*-\s*var\(--mobile-prompt-height\)\s*-\s*2\s*\*\s*var\(--mobile-hud-region-gap\)/)
  assert.match(sideRule, /overflow-y:\s*auto;/)
  assert.match(extractRule(mobileHudCss, '.game-screen .top-hud-side .finale-hud'), /position:\s*static;/)
  assert.ok(appSource.indexOf('<FinaleHud') > appSource.indexOf('<ExpeditionCompass'))

  for (const [viewportWidth, viewportHeight] of [
    [320, 568],
    [390, 844],
  ]) {
    const controlsTop = viewportHeight - controlsEdge - controlsHeight
    const reservedTop = controlsTop - regionGap
    const statusAndMissions: Rectangle = {
      bottom: reservedTop,
      left: objectiveLeft,
      right: viewportWidth / 2 - halfGap,
      top: columnTop,
    }
    const prompt: Rectangle = {
      bottom: reservedTop,
      left: viewportWidth / 2 + halfGap,
      right: viewportWidth - controlsEdge,
      top: reservedTop - promptHeight,
    }
    const controls: Rectangle = {
      bottom: viewportHeight - controlsEdge,
      left: controlsEdge,
      right: viewportWidth - controlsEdge,
      top: controlsTop,
    }
    const atlasAndFinale: Rectangle = {
      bottom: prompt.top - regionGap,
      left: viewportWidth - objectiveLeft - Math.min(8.4 * rem, Math.max(6.5 * rem, viewportWidth * 0.34)),
      right: viewportWidth - objectiveLeft,
      top: objectiveLeft,
    }

    assert.ok(statusAndMissions.bottom - statusAndMissions.top > 3.6 * rem, `${viewportWidth}px mission region collapsed`)
    assert.ok(prompt.right > prompt.left, `${viewportWidth}px prompt region collapsed`)
    assert.ok(atlasAndFinale.bottom > atlasAndFinale.top, `${viewportWidth}px atlas/finale column collapsed`)
    assert.equal(intersectionArea(statusAndMissions, prompt), 0)
    assert.equal(intersectionArea(statusAndMissions, controls), 0)
    assert.equal(intersectionArea(statusAndMissions, atlasAndFinale), 0)
    assert.equal(intersectionArea(atlasAndFinale, prompt), 0)
    assert.equal(intersectionArea(atlasAndFinale, controls), 0)
    assert.equal(intersectionArea(prompt, controls), 0)
  }
})
