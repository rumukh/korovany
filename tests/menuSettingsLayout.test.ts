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

test('menu settings follow launch, setup and profile content in natural document flow', () => {
  const settingsRule = extractRule(appCss, '.menu-settings')
  const mobileMenuCss = extractBlock(appCss, '@media (max-width: 720px), (pointer: coarse) {')
  const settingsIndex = appSource.indexOf('<section className="menu-settings" aria-labelledby="menu-settings-title">')
  const heroIndex = appSource.indexOf('<header className="hero-header">')
  const launchIndex = appSource.indexOf('<div className="faction-grid">')
  const setupIndex = appSource.indexOf('<div className="run-setup">')
  const lowerIndex = appSource.indexOf('<section className="menu-lower">')
  const footerIndex = appSource.indexOf('<footer className="menu-footer">')

  assert.match(settingsRule, /margin:\s*1rem auto 0;/)
  assert.match(settingsRule, /max-width:\s*76rem;/)
  assert.match(settingsRule, /position:\s*relative;/)
  assert.match(settingsRule, /border:\s*1px solid var\(--cp-border\);/)
  assert.doesNotMatch(settingsRule, /position:\s*(?:absolute|fixed)/)
  assert.doesNotMatch(mobileMenuCss, /\.menu-settings\s*\{/)
  const order = [heroIndex, launchIndex, setupIndex, lowerIndex, settingsIndex, footerIndex]
  assert.ok(order.every((index) => index >= 0), 'Every menu section is present')
  assert.deepEqual(order, order.toSorted((a, b) => a - b), 'DOM, keyboard and visual order agree')
  assert.equal((appSource.match(/<section className="menu-settings"/g) ?? []).length, 1)
  assert.doesNotMatch(appSource, /menu-preferences|run-options/)
  assert.match(appSource, /<h2 id="menu-settings-title">Настройки<\/h2>/)
})

test('faction launches precede seed and unlock grids while active-run continuation retains priority', () => {
  const activeIndex = appSource.indexOf('<section className="active-run-card"')
  const blockedIndex = appSource.indexOf('<p className="new-run-blocked-note">')
  const launchIndex = appSource.indexOf('<div className="faction-grid">')
  const seedIndex = appSource.indexOf('<div className="seed-panel">')
  const boonIndex = appSource.indexOf('<div className="boon-panel">')
  const doctrineIndex = appSource.indexOf('<div className="boon-panel doctrine-panel">')
  assert.ok(activeIndex >= 0 && activeIndex < blockedIndex && blockedIndex < launchIndex)
  assert.ok(launchIndex < seedIndex && seedIndex < boonIndex && boonIndex < doctrineIndex)
  const launch = appSource.slice(launchIndex, seedIndex)
  assert.match(launch, /disabled=\{Boolean\(activeRun\)\}/)
  assert.match(launch, /onClick=\{\(\) => onStart\(faction\)\}/)
  assert.match(launch, /Начать · seed \$\{canonicalSeed\}/)
  assert.match(extractRule(appCss, '.run-setup'), /margin-top:\s*1rem;/)
})

test('doctrine choices span both columns of the run setup grid', () => {
  const doctrinePanelRule = extractRule(appCss, '.doctrine-panel')

  assert.match(doctrinePanelRule, /grid-column:\s*1\s*\/\s*-1;/)
  assert.match(appSource, /className="boon-panel doctrine-panel"/)
})
