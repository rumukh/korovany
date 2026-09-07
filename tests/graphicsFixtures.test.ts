import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import * as THREE from 'three'
import { validateGraphicsStage } from '../src/game/diagnostics/GraphicsDiagnostics.ts'
import { normalizeActiveRunSaveV3 } from '../src/game/run/storage.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const fixtureModule = new URL('../scripts/graphics/fixtures.mjs', import.meta.url)
const pngModule = new URL('../scripts/graphics/png.mjs', import.meta.url)
const { GRAPHICS_FIXTURES, fixtureStage, selectGraphicsFixtures } = await import(fixtureModule.href)
const { decodeGraphicsPng, compareGraphicsPng } = await import(pngModule.href)

test('the corpus names every required real scenario and rejects missing selections', () => {
  assert.deepEqual(GRAPHICS_FIXTURES.map((fixture: { id: string }) => fixture.id), [
    'elf-opening', 'guard-opening', 'villain-opening', 'elf-forest-obstruction',
    'guard-riverside-close', 'villain-slope', 'bridge-water-edge', 'crowded-25',
    'neutral-biome', 'night', 'rain', 'snow', 'streaming-boundary',
  ])
  assert.throws(() => selectGraphicsFixtures('not-a-fixture'))
  assert.throws(() => selectGraphicsFixtures('night,night'))
  for (const fixture of GRAPHICS_FIXTURES) validateGraphicsStage({ label: fixture.description })
})

test('real saved-world prerequisites resolve without inventing neutral sites or a northeast edge', () => {
  const blueprint = generateWorld(20260906)
  const runtime = new GeneratedWorldRuntime(new THREE.Scene(), blueprint, { terrainResolution: 6, decorationDensity: 0 })
  const world = {
    blueprint,
    regions: blueprint.regions.map((region) => ({
      ...region, center: runtime.getRegionCenter(region.id), bounds: runtime.getRegionBounds(region.id),
    })),
    sites: blueprint.sites.map((site) => ({ ...site, position: runtime.getSitePosition(site) })),
    bridges: blueprint.bridges.map((bridge) => ({ ...bridge, position: runtime.getBridgePosition(bridge) })),
  }
  const reference = JSON.parse(readFileSync(new URL('../docs/images/graphics-review/capture-manifest.json', import.meta.url), 'utf8'))
  const snapshot = {
    runtime: {
      region: 'region-4-0', camera: { yaw: 0 },
      actors: Array.from({ length: 3 }, (_, index) => ({ id: `squad:guard:starter:${index}`, squad: true })),
    },
  }
  for (const fixture of GRAPHICS_FIXTURES) {
    const stage = fixtureStage(fixture, world, reference, snapshot)
    validateGraphicsStage(stage)
    if (fixture.target === 'neutral') assert.equal(runtime.getBiomeAt(stage.player.x, stage.player.z), 'neutral')
    if (fixture.target === 'boundary') {
      assert.equal(stage.camera.yaw, -Math.PI / 2, 'The actual guard corner has a west edge, not a north/east edge')
      assert.equal(stage.player.x, 122)
    }
    if (fixture.reference) {
      const field = reference.captures.find((capture: { file: string }) => capture.file === fixture.reference)
      assert.deepEqual(stage.player, field.player.position)
      assert.equal(stage.camera.yaw, field.camera.yaw)
      const storage = JSON.parse(readFileSync(new URL(`../scripts/graphics/saves/${fixture.save}`, import.meta.url), 'utf8'))
      const raw = JSON.parse(storage['korovany-generated-run-v2'])
      const save = normalizeActiveRunSaveV3(raw)
      assert.ok(save, `The committed ${fixture.save} must load through the production normalizer`)
      assert.equal(save.blueprintFingerprint, blueprint.fingerprint)
      assert.equal(save.config.faction, fixture.faction)
    }
  }
  assert.throws(() => fixtureStage(GRAPHICS_FIXTURES[3], world, { captures: [] }, snapshot), /Missing original/)
  runtime.dispose()
})

function png(pixel: readonly number[], filter = 0): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    return Buffer.concat([length, Buffer.from(kind), data, Buffer.alloc(4)])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4)
  header[8] = 8; header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([filter, ...pixel]))), chunk('IEND', Buffer.alloc(0)),
  ])
}

test('lossless comparison detects a doped pixel instead of trusting compressed hashes', () => {
  const image = png([11, 29, 57, 255])
  assert.deepEqual([...decodeGraphicsPng(image).pixels], [11, 29, 57, 255])
  assert.equal(compareGraphicsPng(image, image).identicalPixels, true)
  const changed = compareGraphicsPng(image, png([12, 29, 57, 255]))
  assert.equal(changed.changedPixels, 1)
  assert.equal(changed.maxChannelDelta, 1)
  assert.deepEqual(changed.bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 })
  assert.throws(() => decodeGraphicsPng(Buffer.from('not PNG')), /signature/)
  assert.throws(() => decodeGraphicsPng(png([1, 2, 3, 255], 5)), /filter/)
  assert.throws(() => decodeGraphicsPng(image.subarray(0, 30)), /Truncated/)
  for (const filter of [1, 2, 3, 4]) {
    assert.deepEqual([...decodeGraphicsPng(png([11, 29, 57, 255], filter)).pixels], [11, 29, 57, 255])
  }
})
