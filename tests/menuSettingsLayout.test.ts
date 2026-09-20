import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
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

test('menu settings are opt-in and their expanded panel is bounded by the toolbar', () => {
  const settingsRule = extractRule(openingCss, '.opening-menu .menu-settings')
  const toolbarRule = extractRule(openingCss, '.opening-menu .menu-toolbar')
  const settingsIndex = appSource.indexOf('<details className="menu-preferences">')
  const heroIndex = appSource.indexOf('<header className="hero-header">')

  assert.match(settingsRule, /width:\s*min\(46rem,\s*100%\);/)
  assert.match(settingsRule, /position:\s*absolute;/)
  assert.match(settingsRule, /right:\s*0;/)
  assert.match(toolbarRule, /position:\s*relative;/)
  assert.notEqual(settingsIndex, -1)
  assert.notEqual(heroIndex, -1)
  assert.ok(settingsIndex < heroIndex)
})

test('doctrine choices span both columns of the run setup grid', () => {
  const doctrinePanelRule = extractRule(appCss, '.doctrine-panel')

  assert.match(doctrinePanelRule, /grid-column:\s*1\s*\/\s*-1;/)
  assert.match(appSource, /className="boon-panel doctrine-panel"/)
})

test('optional setup uses native keyboard-accessible disclosure with a visible focus ring', () => {
  assert.match(appSource, /<details className="run-options">\s*<summary>/)
  assert.match(openingCss, /\.run-options > summary:focus-visible\s*\{\s*outline:\s*2px solid var\(--cp-accent\);/)
  assert.match(openingCss, /\.run-options > summary[^}]*min-height:\s*44px;/)
})
