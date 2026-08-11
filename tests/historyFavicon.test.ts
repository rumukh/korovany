import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const historyHtml = readFileSync(
  new URL('../public/history/index.html', import.meta.url),
  'utf8',
)

function extractFaviconHref(source: string): string {
  const match = source.match(
    /<link\s+rel="icon"\s+href="([^"]+)"\s*\/>/,
  )

  assert.ok(match, 'missing favicon declaration')
  return match[1]
}

test('history reuses the root application favicon', () => {
  assert.equal(extractFaviconHref(historyHtml), extractFaviconHref(appHtml))
})

test('history favicon resolves as the embedded 64px SVG icon', () => {
  const href = extractFaviconHref(historyHtml)
  const [mediaType, payload] = href.split(',', 2)

  assert.equal(mediaType, 'data:image/svg+xml')
  assert.ok(payload, 'missing embedded favicon payload')
  assert.match(decodeURIComponent(payload), /viewBox='0 0 64 64'/)
})
