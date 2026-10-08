import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { COLUMN_LANE_QUERY } from '../src/game/ui/noticeQueue.ts'

const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const combatHudSource = readFileSync(new URL('../src/game/ui/CombatMasteryHud.tsx', import.meta.url), 'utf8')
const openingCss = readFileSync(new URL('../src/game/ui/openingExperience.css', import.meta.url), 'utf8')

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
/** W3-6b — the notice lane's own block: phones, touch screens and windows up to 1000px. */
const columnLaneCss = extractBlock(appCss, '@media (max-width: 1000px), (pointer: coarse) {')
const compactCss = readFileSync(new URL('../src/game/ui/compact-combat.css', import.meta.url), 'utf8')
const finaleCss = readFileSync(new URL('../src/game/ui/FinaleHud.css', import.meta.url), 'utf8')

test('journal compatibility styles leave the upstream compact HUD geometry authoritative', () => {
  assert.doesNotMatch(openingCss, /\.focused-hud|\.opening-menu|\.run-options|\.menu-preferences/)
  assert.match(openingCss, /\.tactical-toolbar button,\s*\.field-alert\s*\{[^}]*min-height:\s*44px;/)
  assert.match(openingCss, /\.campaign-journal \.contract-pin,[^}]*min-width:\s*44px;/)
  const mobile = extractBlock(openingCss, '@media (max-width: 720px), (pointer: coarse) {')
  assert.match(mobile, /\.tactical-toolbar,[^}]*width:\s*100%;/)
  assert.doesNotMatch(mobile, /\.left-hud|\.top-hud(?:\s|,|\{)|\.vitals|\.ability-chip|\.melee-chip/)
})

test('W3-6: narrow notices use the foot of the left column in both modes, in flow, never lifted out of it', () => {
  const lane = extractRule(columnLaneCss, '.game-screen[data-hud] .left-hud > .notice-stack')
  assert.match(lane, /position:\s*static;/)
  assert.match(lane, /transform:\s*none;/)
  assert.match(lane, /width:\s*100%;/)
  assert.match(lane, /flex:\s*0\s+0\s+auto;/)
  assert.match(lane, /max-height:\s*max\(4\.5rem,\s*calc\(100% - var\(--notice-status-reserve\)\)\);/)
  assert.match(lane, /overflow-y:\s*auto;/)
  assert.match(lane, /pointer-events:\s*auto;/)
  assert.doesNotMatch(lane, /overflow:\s*hidden|display:\s*none|margin|(?:^|\s)(?:top|bottom|left|right):/)
  // Empty, the lane leaves the column's flow but stays a live region, never `display: none`:
  // a region that only enters the accessibility tree with its content is often not announced.
  const empty = extractRule(columnLaneCss, '.game-screen[data-hud] .left-hud > .notice-stack:empty')
  assert.match(empty, /position:\s*absolute;/)
  assert.match(empty, /clip-path:\s*inset\(50%\);/)
  assert.match(empty, /pointer-events:\s*none;/)
  assert.doesNotMatch(empty, /display:\s*none|visibility:\s*hidden/)
  assert.doesNotMatch(columnLaneCss, /notice-stack[^{}]*\{[^}]*display:\s*none/, 'a lane rule hides the live region')
  // W3-6b — the lane's rules live in its own block, not in the phone-only one.
  assert.doesNotMatch(mobileHudCss, /notice-stack/)
  assert.match(
    extractRule(columnLaneCss, '.game-screen[data-hud] .left-hud > .notice-stack .notice'),
    /overflow-wrap:\s*anywhere;/,
  )
  // The mission panel gives up its height while a notice shows; nothing above the lane moves.
  const yielding = extractRule(
    columnLaneCss, '.game-screen[data-zone] .left-hud:has(> .notice-stack > .notice) > .mission-hud',
  )
  assert.match(yielding, /flex-basis:\s*0;/)
  assert.match(yielding, /min-height:\s*0;/)
  // A phone or a column-lane window at least 780px tall keeps the whole status column; the lane scrolls instead.
  const tall = extractBlock(appCss, '@media (max-width: 1000px) and (min-height: 780px), (pointer: coarse) and (min-height: 780px) {')
  assert.match(extractRule(tall, '.game-screen[data-hud] .left-hud:has(> .notice-stack > .notice) > .status-hud'),
    /flex-shrink:\s*0;/)
  const tallLane = extractRule(tall, '.game-screen[data-hud] .left-hud > .notice-stack')
  assert.match(tallLane, /flex-shrink:\s*1;/)
  assert.match(tallLane, /min-height:\s*0;/)
  assert.ok(appCss.indexOf('(min-height: 780px)') > appCss.indexOf('.game-screen[data-hud] .left-hud > .notice-stack {'),
    'the tall rule must come after the lane rule it overrides')
  // GFX-05's right-hand placement is gone on narrow screens, from both files that held it,
  // and nothing narrow lifts the region out of flow again.
  const compactMobile = extractBlock(compactCss, '@media (max-width: 720px), (pointer: coarse) {')
  assert.doesNotMatch(compactMobile, /notice/)
  assert.doesNotMatch(compactMobile, /position:\s*fixed;/)
  assert.doesNotMatch(extractBlock(finaleCss, '@media (max-width: 720px), (pointer: coarse) {'), /notice/)
  // Wide Compact keeps the GFX-05 and W1-4 lanes, from 1001px now (W3-6b): below that the lane
  // is the column's foot, and no Compact rule at 721px and up may fight it there.
  const desktop = extractBlock(compactCss, '@media (min-width: 1001px) and (pointer: fine) {')
  const desktopNotice = extractRule(desktop, '.game-screen[data-hud="compact"] .notice-stack')
  assert.match(desktopNotice, /top:\s*0;/)
  assert.match(desktopNotice, /width:\s*min\(28rem,\s*calc\(100% - 50rem\)\);/)
  const finaleNotice = extractRule(desktop, '.game-screen[data-hud="compact"]:has(.finale-hud) .notice-stack')
  assert.match(finaleNotice, /position:\s*fixed;/)
  assert.match(finaleNotice, /top:\s*auto;/)
  assert.match(finaleNotice, /bottom:\s*4\.5rem;/)
  assert.match(finaleNotice, /left:\s*1rem;/)
  assert.match(finaleNotice, /width:\s*19rem;/)
  assert.doesNotMatch(extractBlock(compactCss, '@media (min-width: 721px) and (pointer: fine) {'), /notice-stack/)
  assert.doesNotMatch(compactCss, /max-width:\s*1000px[^{]*\{[^}]*notice-stack/)
  // W3-6b — the achievement banner and the loot toast no longer float over the HUD on their
  // own timers (measured on main: the banner over the vitals at 390x844 and over the first
  // notice at 1366x768, the toast over the vitals at 390x844). They are notices in the lane.
  assert.doesNotMatch(appCss, /\.achievement-banner|\.loot-toast/)
  assert.doesNotMatch(appSource, /achievement-banner|loot-toast|<AchievementBanner|<LootToast/)
})

/** The condition of the `@media` block that holds `selector`. */
function mediaConditionOf(source: string, selector: string): string {
  for (const match of source.matchAll(/@media ([^{]+) \{/g)) {
    if (extractBlock(source, match[0]).includes(selector)) return match[1].trim()
  }
  assert.fail(`No @media block holds ${selector}`)
}

test('W3-6: the App moves the lane with the same media query the CSS lays it out with', () => {
  assert.equal(mediaConditionOf(appCss, '.left-hud > .notice-stack'), COLUMN_LANE_QUERY)
  // The touch controls stay a phone and touch-screen matter; only the lane reaches 1000px.
  assert.equal(mediaConditionOf(appCss, '.touch-controls {'), '(max-width: 720px), (pointer: coarse)')
  // Control: no desktop block holds the lane, and the lookup does see a different query.
  assert.doesNotMatch(extractBlock(appCss, '@media (min-width: 721px) and (pointer: fine) {'), /notice-stack/)
  assert.notEqual(mediaConditionOf(appCss, '.left-hud {\n    top: 5.6rem;'), COLUMN_LANE_QUERY)
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

test('mobile threat, music, pause, and atlas access stay rendered with thumb-sized actions', () => {
  const actionRule = extractRule(mobileHudCss, '.hud-actions .icon-button')
  const threatRule = extractRule(mobileHudCss, '.threat-chip')

  assert.match(actionRule, /min-height:\s*2\.75rem;/)
  assert.match(actionRule, /width:\s*2\.75rem;/)
  assert.match(threatRule, /grid-area:\s*threat;/)
  assert.match(threatRule, /min-width:\s*4rem;/)
  assert.match(appSource, /className=\{`threat-chip tier-\$\{view\.threatTier\}`\}/)
  assert.match(appSource, /className=\{`icon-button hud-music/)
  assert.match(appSource, /className="icon-button hud-pause"/)
  assert.match(appSource, /className="tactical-toolbar"[\s\S]*onClick=\{onOpenAtlas\}/)
  assert.match(appSource, /<MiniMap view=\{view\} onOpenAtlas=/)
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
  assert.match(actions, /onPointerDown=[\s\S]*abilityDown\(\)/)
  assert.match(actions, /onPointerUp=[\s\S]*abilityUp\(\)/)
  assert.match(appSource, /const abilityDown = view\.ability\.id === 'bow' \? onBowAimDown : onAbilityDown/)
  assert.match(appSource, /const abilityUp = view\.ability\.id === 'bow' \? onBowAimUp : onAbilityUp/)
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

// ---------------------------------------------------------------------------
// W3-6 — the narrow notice lane. Measured on main in Chrome 153 at 390x844 (Full): the
// centred stack ran x16..374 from y77 over the vitals card (y83..265) and the squad strip
// (y191..257, order button y196..244), and in Compact the right-hand stack began at y563
// below W2-2's 413 px camp card, in a column that ends at y594. The lane is now the foot of
// the left column, which holds the vitals card at its top.
// ---------------------------------------------------------------------------

/** The vitals card and squad strip as measured at 390x844: the reserve must keep them. */
const MEASURED_VITALS_BOTTOM_390 = 265

function narrowRegions(width: number, height: number) {
  const rem = 16
  const screen = extractRule(mobileHudCss, '.game-screen')
  const lane = extractRule(columnLaneCss, '.game-screen[data-hud] .left-hud > .notice-stack')
  const floorMatch = lane.match(/max-height:\s*max\(([\d.]+)rem,/)
  assert.ok(floorMatch, 'Missing the lane floor')
  const controlsEdge = 0.8 * rem
  const controlsTop = height - controlsEdge - remValue(screen, '--mobile-touch-controls-height')
  const regionGap = remValue(screen, '--mobile-hud-region-gap')
  const halfGap = remValue(screen, '--mobile-hud-half-gap')
  const objectiveLeft = 0.55 * rem
  const columnTop = remValue(extractRule(mobileHudCss, '.left-hud'), 'top')
  const columnBottom = controlsTop - regionGap
  const columnHeight = columnBottom - columnTop
  // The tallest the lane may grow: `max(floor, 100% - reserve)` of the column.
  const laneHeight = Math.max(Number(floorMatch[1]) * rem, columnHeight - remValue(extractRule(columnLaneCss, '.game-screen'), '--notice-status-reserve'))
  const column = { left: objectiveLeft, right: width / 2 - halfGap }
  const sideWidth = Math.min(8.4 * rem, Math.max(6.5 * rem, width * 0.34))
  const promptTop = columnBottom - remValue(screen, '--mobile-prompt-height')
  return {
    columnHeight,
    lane: { ...column, top: columnBottom - laneHeight, bottom: columnBottom },
    status: { ...column, top: columnTop, bottom: columnBottom - laneHeight },
    controls: { left: controlsEdge, right: width - controlsEdge, top: controlsTop, bottom: height - controlsEdge },
    prompt: { left: width / 2 + halfGap, right: width - controlsEdge, top: promptTop, bottom: columnBottom },
    side: { left: width - objectiveLeft - sideWidth, right: width - objectiveLeft, top: objectiveLeft, bottom: promptTop - regionGap },
    sideWidth,
  }
}

test('W3-6: the narrow notice lane never meets the vitals, the squad strip, a touch control, the prompt or the right column', () => {
  const reserve = remValue(extractRule(columnLaneCss, '.game-screen'), '--notice-status-reserve')
  // Portrait phones, a coarse-pointer 1366x768 laptop, and a landscape phone where only the floor is left.
  for (const [width, height] of [[390, 844], [375, 667], [360, 640], [320, 568], [1366, 768], [844, 390]]) {
    const regions = narrowRegions(width, height)
    const label = `${String(width)}x${String(height)}`
    assert.equal(intersectionArea(regions.lane, regions.controls), 0, `${label}: lane over the touch controls`)
    assert.equal(intersectionArea(regions.lane, regions.prompt), 0, `${label}: lane over the prompt`)
    assert.equal(intersectionArea(regions.lane, regions.side), 0, `${label}: lane over the right column`)
    assert.equal(intersectionArea(regions.lane, regions.status), 0, `${label}: lane over the status column`)
    // The status column keeps the whole reserve unless the screen cannot hold it and the floor.
    assert.ok(regions.status.bottom - regions.status.top >= Math.min(reserve, regions.columnHeight - 4.5 * 16) - 0.001,
      `${label}: the lane can reach into the vitals`)
    assert.ok(regions.lane.right - regions.lane.left >= regions.sideWidth, `${label}: narrower than the lane it replaces`)
  }
  const phone = narrowRegions(390, 844)
  assert.ok(phone.status.bottom >= MEASURED_VITALS_BOTTOM_390, 'the reserve no longer covers the measured vitals card')
  assert.ok(phone.lane.bottom - phone.lane.top >= 20 * 16, 'a phone must hold the longest notice without its reserve binding')
  // At 390x844 the tall rule keeps the whole status column (measured 356 px; 408 with
  // «Отряду нужна помощь»). What is left beside the yielding mission panel still holds the
  // longest first-time line (measured 160 px in the lane) with a short notice (47 px) under it.
  const gaps = 2 * 0.4 * 16
  const besideStatus = phone.columnHeight - 356 - gaps
  assert.ok(besideStatus >= 160 + 0.45 * 16 + 47, `${String(besideStatus)} px beside the status column`)
  assert.ok(besideStatus - 52 >= 160, 'the squad alert leaves no room for the longest line')

  // Negative controls. The old Full stack (top 5.3rem, centred, one 70 px notice) lands on the
  // vitals and on the right column, and a lane without the reserve can reach the vitals card.
  const oldWidth = Math.min(26 * 16, 390 - 2 * 16)
  const oldStack = { left: (390 - oldWidth) / 2, right: (390 + oldWidth) / 2, top: 5.3 * 16, bottom: 5.3 * 16 + 70 }
  assert.ok(intersectionArea(oldStack, { ...phone.status, bottom: MEASURED_VITALS_BOTTOM_390 }) > 0)
  assert.ok(intersectionArea(oldStack, phone.side) > 0)
  const small = narrowRegions(320, 568)
  const unreserved = { ...small.lane, top: small.status.top }
  assert.ok(intersectionArea(unreserved, { ...small.status, bottom: small.status.top + 180 }) > 0)
})

// ---------------------------------------------------------------------------
// W1-4 — desktop lanes. With mouse capture off, the bottom-right «Захватить мышь» card is
// what a click lands on, and at 1366x768 it sat on the rumour board's «Взяться» (measured:
// card x1039..1350 y583..640 over the button x1113..1167 y611..637; the click reached the
// card). The notice lane, centred, began under the pause button whenever «Зона людей»
// widened the identity panel to x493 (lane from x459). Both are now lanes by construction.
// ---------------------------------------------------------------------------

const combatMasteryCss = readFileSync(new URL('../src/game/ui/combatMastery.css', import.meta.url), 'utf8')
const desktopLaneCss = extractBlock(appCss, '@media (min-width: 721px) and (pointer: fine) {')
const desktopNoticeCss = extractBlock(appCss, '@media (min-width: 1001px) and (pointer: fine) {')
const compactDesktopCss = extractBlock(compactCss, '@media (min-width: 721px) and (pointer: fine) {')
const compactWideCss = extractBlock(compactCss, '@media (min-width: 1001px) and (pointer: fine) {')
const REM = 16

interface DesktopLane {
  cameraBottom: number
  cameraHeight: number
  sideMaxHeight: (viewportHeight: number) => number
}

/** The lane the CSS declares, read back from the CSS rather than restated. */
function declaredCameraLane(): DesktopLane {
  const screen = extractRule(desktopLaneCss, '.game-screen')
  assert.match(screen, /--camera-card-bottom:\s*8rem;/)
  assert.match(screen, /--camera-card-top:\s*calc\(var\(--camera-card-bottom\)\s*\+\s*44px\s*\+\s*0\.7rem\s*\+\s*2px\);/)
  assert.match(screen, /--hud-side-max-height:\s*calc\(100dvh\s*-\s*1rem\s*-\s*var\(--camera-card-top\)\s*-\s*0\.65rem\);/)
  // The card really is that tall: one 44px control, 0.35rem padding and a 1px border each way.
  const card = extractRule(combatMasteryCss, '.combat-camera-controls')
  assert.match(card, /bottom:\s*var\(--camera-card-bottom,\s*8rem\);/)
  assert.match(card, /padding:\s*0\.35rem\s+0\.65rem;/)
  assert.match(card, /border:\s*1px solid/)
  assert.match(extractRule(combatMasteryCss, '.combat-camera-controls button'), /min-height:\s*44px;/)
  const cameraBottom = 8 * REM
  const cameraHeight = 44 + 0.7 * REM + 2
  return {
    cameraBottom,
    cameraHeight,
    sideMaxHeight: (height) => height - REM - (cameraBottom + cameraHeight) - 0.65 * REM,
  }
}

function sideColumnAndCard(
  lane: DesktopLane,
  width: number,
  height: number,
): { side: Rectangle; card: Rectangle } {
  // The full column widens by its thin scrollbar (measured 266px); allow a whole rem.
  const side = { left: width - REM - 17 * REM, right: width - REM, top: REM, bottom: REM + lane.sideMaxHeight(height) }
  // The widest the card may be: min(28rem, 100% - 2rem), anchored right.
  const cardWidth = Math.min(28 * REM, width - 2 * REM)
  const card = {
    left: width - REM - cardWidth,
    right: width - REM,
    top: height - lane.cameraBottom - lane.cameraHeight,
    bottom: height - lane.cameraBottom,
  }
  return { side, card }
}

test('desktop: the right column ends above the camera card in both HUD modes and scrolls instead', () => {
  const lane = declaredCameraLane()
  const full = extractRule(desktopLaneCss, '.top-hud-side')
  assert.match(full, /max-height:\s*var\(--hud-side-max-height\);/)
  assert.match(full, /overflow-y:\s*auto;/)
  // A bounded column that cannot be wheeled would hide its buttons instead of covering them.
  assert.match(full, /pointer-events:\s*auto;/)
  const compact = extractRule(compactDesktopCss, '.game-screen[data-hud="compact"] .top-hud-side')
  assert.match(compact, /max-height:\s*var\(--hud-side-max-height\);/)
  assert.match(compact, /overflow-y:\s*auto;/)

  for (const width of [721, 1000, 1366, 1920]) {
    for (const height of [600, 700, 768, 900, 1080]) {
      const { side, card } = sideColumnAndCard(lane, width, height)
      assert.ok(side.bottom - side.top >= 10 * REM, `${width}x${height}: the column collapsed`)
      assert.equal(intersectionArea(side, card), 0, `${width}x${height}: the column runs under the card`)
    }
  }

  // Negative controls: the measured pre-fix full column (y16..656) and the old compact bound
  // (100dvh - 7rem) both put the column under the card at 1366x768, so the arithmetic above
  // can see the defect it rules out.
  const { card } = sideColumnAndCard(lane, 1366, 768)
  const column = { left: 1094, right: 1350, top: 16 }
  assert.ok(intersectionArea({ ...column, bottom: 656 }, card) > 0)
  assert.ok(intersectionArea({ ...column, bottom: REM + 768 - 7 * REM }, card) > 0)
})

/** The full lane in screen space; its containing block is the game screen. */
function fullNoticeLane(width: number): { left: number; right: number } {
  const left = Math.max(33 * REM, width / 2 - 14 * REM)
  return { left, right: left + Math.min(28 * REM, width - 52 * REM) }
}

/** The compact lane in screen space; its containing block is the top HUD, 1rem in. */
function compactNoticeLane(width: number): { left: number; right: number } {
  const inner = width - 2 * REM
  const left = REM + Math.max(33 * REM, inner / 2 - 14 * REM)
  return { left, right: left + Math.min(28 * REM, inner - 50 * REM) }
}

test('desktop: the notice lane starts past the widest identity panel and stops short of the right column', () => {
  const notice = extractRule(desktopNoticeCss, '.notice-stack')
  assert.match(notice, /left:\s*max\(33rem,\s*calc\(50% - 14rem\)\);/)
  assert.match(notice, /transform:\s*none;/)
  assert.match(notice, /width:\s*min\(28rem,\s*calc\(100% - 52rem\)\);/)
  // The cap is what turns «past the widest panel» into a guarantee rather than a copy-length
  // coincidence. In Chrome «Зона людей» measured 477px, inside it.
  assert.match(extractRule(desktopNoticeCss, '.identity-panel'), /max-width:\s*31rem;/)
  assert.match(
    extractRule(compactWideCss, '.game-screen[data-hud="compact"] .notice-stack'),
    /width:\s*min\(28rem,\s*calc\(100% - 50rem\)\);/,
  )
  // Finale lanes keep their own, more specific placement (from 1001px since W3-6b).
  assert.match(
    extractRule(compactWideCss, '.game-screen[data-hud="compact"]:has(.finale-hud) .notice-stack'),
    /left:\s*1rem;/,
  )

  const identity = { left: REM, right: REM + 31 * REM, top: REM, bottom: 6 * REM }
  for (const width of [1001, 1100, 1280, 1366, 1440, 1600, 1920, 2560]) {
    for (const [mode, lane, columnWidth] of [
      ['full', fullNoticeLane(width), 17 * REM],
      ['compact', compactNoticeLane(width), 16 * REM],
    ] as const) {
      const rectangle = { ...lane, top: REM, bottom: 20 * REM }
      const column = { left: width - REM - columnWidth, right: width - REM, top: REM, bottom: 40 * REM }
      assert.equal(intersectionArea(rectangle, identity), 0, `${mode} ${width}px lane under the identity panel`)
      assert.equal(intersectionArea(rectangle, column), 0, `${mode} ${width}px lane over the right column`)
      assert.ok(lane.right - lane.left >= 10 * REM, `${mode} ${width}px lane too narrow to read`)
    }
  }
  // Wide screens keep the original centred lane, which the graphics work measured at 1920.
  assert.deepEqual(fullNoticeLane(1920), { left: 736, right: 1184 })
  assert.deepEqual(compactNoticeLane(1920), { left: 736, right: 1184 })

  // Negative control: the old centred lane at 1366 starts at x459, under the capped panel.
  const centred = { left: 683 - 14 * REM, right: 683 + 14 * REM, top: REM, bottom: 20 * REM }
  assert.ok(intersectionArea(centred, identity) > 0)
})

test('W3-6: at 1366x768 and wider, the notice lanes clear the vitals and squad strip in the left column', () => {
  // The left column holds the vitals card, its squad strip and the mission panel.
  const wideLeft = extractRule(appCss, '.left-hud')
  const column = {
    left: remValue(wideLeft, 'left'), right: remValue(wideLeft, 'left') + remValue(wideLeft, 'width'),
    top: remValue(wideLeft, 'top'), bottom: 768,
  }
  assert.deepEqual([column.left, column.right], [16, 320])
  // Three long notices (the wide limit) at the lane's 448 px end near y282; allow far more.
  for (const width of [1001, 1280, 1366, 1600, 1920]) {
    for (const [mode, lane] of [['full', fullNoticeLane(width)], ['compact', compactNoticeLane(width)]] as const) {
      const rectangle = { ...lane, top: 0, bottom: 768 }
      assert.equal(intersectionArea(rectangle, column), 0, `${mode} ${String(width)}px lane over the left column`)
    }
  }
  // Negative control: the centred lane the 721–1000 px windows had until W3-6b,
  // `min(26rem, 100% - 2rem)` from App.css's 1000 px block, reached over this column at 900 px.
  const mediumWidth = Math.min(26 * REM, 900 - 2 * REM)
  const mediumLane = { left: 450 - mediumWidth / 2, right: 450 + mediumWidth / 2, top: 0, bottom: 768 }
  assert.ok(intersectionArea(mediumLane, column) > 0)
})

// ---------------------------------------------------------------------------
// W3-6b — 721–1000 px with a fine pointer. Measured on main in Chrome 153: the centred lane
// (top 5.7rem, `min(26rem, 100% - 2rem)`) ran over the left column at every width, from
// 18036 px² of the vitals card at 721x768 to 3024 px² at 1000x768, in both HUD modes. There
// is no free lane between the columns below about 800 px, so these windows use the column
// lane the phones use: the foot of the left column, below the mission panel.
// ---------------------------------------------------------------------------

const mediumLaneCss = extractBlock(appCss, '@media (min-width: 721px) and (max-width: 1000px) and (pointer: fine) {')

/** The desktop vitals card with its squad strip, as measured at 721–1000 px: 246 px tall. */
const MEASURED_MEDIUM_VITALS_HEIGHT = 246

function mediumRegions(width: number, height: number) {
  const base = extractRule(appCss, '.left-hud')
  const shortTop = remValue(extractRule(extractBlock(appCss, '@media (max-height: 700px) and (min-width: 721px) {'),
    '.left-hud'), 'top')
  const top = height <= 700 ? shortTop : remValue(extractRule(extractBlock(appCss, '@media (max-width: 1000px) {'),
    '.left-hud'), 'top')
  const tall = extractRule(appCss, '.game-screen[data-zone] .left-hud:has(.mission-hud)')
  const heightMatch = tall.match(/height:\s*calc\(100dvh - ([\d.]+)rem\);/)
  assert.ok(heightMatch, 'Missing the column height')
  const columnHeight = height - Number(heightMatch[1]) * REM
  const lane = extractRule(columnLaneCss, '.game-screen[data-hud] .left-hud > .notice-stack')
  const floorMatch = lane.match(/max-height:\s*max\(([\d.]+)rem,/)
  assert.ok(floorMatch, 'Missing the lane floor')
  const reserve = remValue(extractRule(mediumLaneCss, '.game-screen'), '--notice-status-reserve')
  // The tallest the lane may grow: `max(floor, 100% - reserve)` of the column.
  const laneHeight = Math.max(Number(floorMatch[1]) * REM, columnHeight - reserve)
  const left = remValue(base, 'left')
  const right = left + remValue(base, 'width')
  const bottom = top + columnHeight
  return {
    column: { left, right, top, bottom },
    lane: { left, right, top: bottom - laneHeight, bottom },
    vitals: { left, right, top, bottom: top + MEASURED_MEDIUM_VITALS_HEIGHT },
    // The right column at its widest: 17rem anchored 1rem from the right edge.
    side: { left: width - REM - 17 * REM, right: width - REM, top: REM, bottom: height },
    reserve,
  }
}


test('W3-6b: between 721 and 1000 px the lane is the left column\'s foot and clears the vitals and the right column', () => {
  // The centred medium lane is gone from both files; the lane is the column lane's.
  assert.doesNotMatch(extractBlock(appCss, '@media (max-width: 1000px) {'), /notice-stack/)
  assert.doesNotMatch(compactCss, /max-width:\s*1000px[^{]*\{[^}]*notice-stack/)
  assert.equal(mediaConditionOf(appCss, '.left-hud > .notice-stack'), '(max-width: 1000px), (pointer: coarse)')
  // The desktop vitals card is taller than a phone's, so these windows reserve more for it.
  assert.ok(mediumRegions(900, 768).reserve >= MEASURED_MEDIUM_VITALS_HEIGHT)
  for (const width of [721, 800, 900, 1000]) {
    for (const height of [600, 700, 768, 900, 1080]) {
      const regions = mediumRegions(width, height)
      const label = `${String(width)}x${String(height)}`
      assert.equal(intersectionArea(regions.lane, regions.vitals), 0, `${label}: lane over the vitals card`)
      assert.equal(intersectionArea(regions.lane, regions.side), 0, `${label}: lane over the right column`)
      assert.ok(regions.lane.top >= regions.column.top && regions.lane.bottom <= regions.column.bottom,
        `${label}: lane outside the column`)
      assert.ok(regions.lane.bottom - regions.lane.top >= 4.5 * REM, `${label}: no room for a notice`)
    }
  }
  // Negative control: with the phones' 15rem reserve the lane could reach the vitals card's
  // squad strip at 721x768, which is why these windows reserve more.
  const phoneReserve = remValue(extractRule(columnLaneCss, '.game-screen'), '--notice-status-reserve')
  const regions = mediumRegions(721, 768)
  const unreserved = { ...regions.lane, top: regions.column.bottom - (regions.column.bottom - regions.column.top - phoneReserve) }
  assert.ok(intersectionArea(unreserved, regions.vitals) > 0)
})
