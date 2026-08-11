import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { lockDocumentScroll } from '../src/documentScrollLock.ts'

const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

function extractRule(source: string, selector: string): string {
  const marker = `${selector} {`
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `Missing ${selector}`)

  const openingBrace = source.indexOf('{', markerIndex)
  let depth = 0
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] !== '}') continue
    depth -= 1
    if (depth === 0) return source.slice(openingBrace + 1, index)
  }

  assert.fail(`Missing closing brace for ${selector}`)
}

function createScrollEnvironment() {
  const bodyStyle = {
    left: '3px',
    overflow: 'visible',
    position: 'relative',
    top: '5px',
    width: 'calc(100% - 1rem)',
  }
  const rootStyle = { overflow: 'auto' }
  const scrollCalls: Array<[number, number]> = []

  return {
    bodyStyle,
    documentTarget: {
      body: { style: bodyStyle },
      documentElement: { style: rootStyle },
    },
    rootStyle,
    scrollCalls,
    windowTarget: {
      scrollX: 12,
      scrollY: 640,
      scrollTo: (x: number, y: number) => scrollCalls.push([x, y]),
    },
  }
}

test('achievement gallery locks the document for its mounted lifetime', () => {
  assert.match(
    appSource,
    /function AchievementGallery[\s\S]*?useLayoutEffect\(\(\) => lockDocumentScroll\(\), \[\]\)/,
  )

  const environment = createScrollEnvironment()
  lockDocumentScroll(environment.documentTarget, environment.windowTarget)

  assert.equal(environment.rootStyle.overflow, 'hidden')
  assert.deepEqual(environment.bodyStyle, {
    left: '-12px',
    overflow: 'hidden',
    position: 'fixed',
    top: '-640px',
    width: '100%',
  })
  assert.deepEqual(environment.scrollCalls, [])
})

test('closing achievements restores the prior page styles and scroll position', () => {
  const environment = createScrollEnvironment()
  const release = lockDocumentScroll(environment.documentTarget, environment.windowTarget)

  release()

  assert.equal(environment.rootStyle.overflow, 'auto')
  assert.deepEqual(environment.bodyStyle, {
    left: '3px',
    overflow: 'visible',
    position: 'relative',
    top: '5px',
    width: 'calc(100% - 1rem)',
  })
  assert.deepEqual(environment.scrollCalls, [[12, 640]])
})

test('the achievements gallery remains the only vertical scroll container', () => {
  const backdropRule = extractRule(appCss, '.achievement-backdrop')
  const modalRule = extractRule(appCss, '.modal')

  assert.match(backdropRule, /position:\s*fixed;/)
  assert.match(modalRule, /overflow:\s*auto;/)
  assert.match(
    appSource,
    /className="modal-backdrop achievement-backdrop"[\s\S]*?className="modal achievement-gallery"/,
  )
})
