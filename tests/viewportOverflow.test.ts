import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
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

test('scrolling document roots do not impose a fixed viewport minimum', () => {
  const appRootRule = extractRule(appCss, 'html,\nbody,\n#root')
  const historyBodyRule = extractRule(historyHtml, 'body')

  for (const [surface, rule] of [
    ['main app', appRootRule],
    ['history', historyBodyRule],
  ] as const) {
    assert.match(rule, /width:\s*100%;/, `${surface} root must fill its client width`)
    assert.doesNotMatch(
      rule,
      /min-width:/,
      `${surface} root must not outgrow a scrollbar-reduced client width`,
    )
  }
})

test('320px viewport roots fit the 305px client width left by a vertical scrollbar', () => {
  const viewportWidth = 320
  const verticalScrollbarWidth = 15
  const clientWidth = viewportWidth - verticalScrollbarWidth

  for (const [surface, rule] of [
    ['main app', extractRule(appCss, 'html,\nbody,\n#root')],
    ['history', extractRule(historyHtml, 'body')],
  ] as const) {
    const widthMatch = /width:\s*(\d+)%/.exec(rule)
    assert.ok(widthMatch, `${surface} root needs a percentage width`)

    const renderedWidth = clientWidth * Number(widthMatch[1]) / 100
    assert.equal(renderedWidth, clientWidth)
    assert.ok(
      renderedWidth < viewportWidth,
      `${surface} root must shrink below the nominal viewport around its scrollbar`,
    )
  }
})
