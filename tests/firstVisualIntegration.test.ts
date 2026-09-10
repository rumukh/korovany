import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as THREE from 'three'
import {
  GeometryCache, StylizedArtLibrary, createCharacterPresenter, illustratedCharacterPlan, resolveCharacterPlan,
} from '../src/game/art/index.ts'
import { AFFINE_SKIN_NORMAL_REVISION } from '../src/game/art/skinNormalShader.ts'
import { resolveVisualPolicy, resolveVisualViewport } from '../src/game/visualPolicy.ts'

const moduleUrl = new URL('../scripts/graphics/runtime-controls.mjs', import.meta.url)
const { assertCaptureDeadline, recordedRiverEndpoint, validateRuntimeControlSnapshot, RUNTIME_CONTROL_VIEWPORTS } =
  await import(moduleUrl.href)

function compile(material: THREE.Material, kind: 'standard' | 'basic') {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib[kind].vertexShader,
    fragmentShader: THREE.ShaderLib[kind].fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)
  return shader
}

test('joined actual character main and ink hooks retain affine normals, packed weather and post-tone atmosphere ordering', () => {
  const art = new StylizedArtLibrary({ enhanced: true, ink: {
    player: 0, enemy: 0, interactable: 0, landmark: 0,
  } })
  const cache = new GeometryCache()
  const presenter = createCharacterPresenter(illustratedCharacterPlan(resolveCharacterPlan('guard', 'player', 0, true)),
    art, cache, true)
  const outline = art.applyOutline(presenter.root, 'structural')
  try {
    const material = presenter.body.material
    assert.ok(!Array.isArray(material))
    const shellMaterial = outline.shells[0].material
    assert.ok(!Array.isArray(shellMaterial))
    const main = compile(material, 'standard')
    const ink = compile(shellMaterial, 'basic')
    for (const shader of [main, ink]) {
      assert.match(shader.vertexShader, /objectNormal = kArtAffineNormal/)
      assert.match(shader.vertexShader, /vec3 kArtAffineNormal/)
      const tone = shader.fragmentShader.indexOf('#include <tonemapping_fragment>')
      const fog = shader.fragmentShader.indexOf('float kNearFog')
      const transfer = shader.fragmentShader.indexOf('#include <colorspace_fragment>')
      assert.ok(tone >= 0 && fog > tone && transfer > fog, 'Fog must follow path tone mapping but precede color transfer')
    }
    assert.match(main.vertexShader, /attribute vec2 artWeatherResponse/)
    assert.match(ink.vertexShader, /kOutlineNormal = kArtAffineNormal/)
    for (const candidate of [material, shellMaterial]) {
      assert.ok(candidate.customProgramCacheKey().includes('atmosphere-1'))
      assert.ok(candidate.customProgramCacheKey().includes(AFFINE_SKIN_NORMAL_REVISION))
    }
    assert.equal(main.uniforms.uArtWeather, ink.uniforms.uArtWeather)
    assert.equal(main.uniforms.uArtAtmosphereEnabled, ink.uniforms.uArtAtmosphereEnabled)
  } finally {
    art.releaseOutline(outline)
    presenter.dispose()
    cache.dispose()
    art.dispose()
  }
})

test('first-preview deadline checks are UTC, finite and fail before a new phase at the cutoff', () => {
  assert.doesNotThrow(() => assertCaptureDeadline(undefined, 100))
  const deadline = '2026-09-10T08:00:00.000Z'
  const instant = Date.parse(deadline)
  assert.doesNotThrow(() => assertCaptureDeadline(deadline, instant - 1))
  assert.throws(() => assertCaptureDeadline(deadline, instant), /deadline/)
  assert.throws(() => assertCaptureDeadline('not-a-date', instant), /UTC/)
  assert.throws(() => assertCaptureDeadline('2026-09-10T08:00:00', instant - 1), /UTC/)
})

test('recorded riverside prerequisite uses the actual preserved endpoint, not the old camera position', () => {
  const records = JSON.parse(gunzipSync(readFileSync(new URL(
    '../docs/images/gfx-02-evidence/records/02-camera-routes-manifest.json.gz', import.meta.url,
  ))).toString('utf8'))
  const expected = records.cases.find((entry: { id: string }) => entry.id === 'guard-riverside-close').motion.frames[0].snapshot
  const stage = recordedRiverEndpoint(records)
  assert.deepEqual(stage.player, { x: expected.player[0], y: expected.player[1], z: expected.player[2] })
  assert.deepEqual(stage.camera, { yaw: expected.camera.yaw, pitch: expected.camera.pitch })
  assert.equal('position' in stage.camera, false)
  assert.match(stage.label, /STAGED recorded/)
  assert.match(stage.label, /no forced camera position/)
  assert.throws(() => recordedRiverEndpoint({ cases: [] }), /missing/)
})

test('live-control validator requires actual buffer/post dimensions and true composer-free output', () => {
  for (const viewport of RUNTIME_CONTROL_VIEWPORTS) for (const bloomEnabled of [false, true]) {
    const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'balanced', bloomEnabled })
    const expected = resolveVisualViewport(policy.render, viewport.width, viewport.height, viewport.dpr)
    const snapshot = {
      viewport: {
        width: viewport.width, height: viewport.height, devicePixelRatio: viewport.dpr,
        bufferWidth: expected.drawingBufferWidth, bufferHeight: expected.drawingBufferHeight,
        rendererPixelRatio: expected.pixelRatio,
      },
      runtime: {
        visualPolicy: policy,
        rendering: { post: {
          width: expected.drawingBufferWidth, height: expected.drawingBufferHeight,
          composer: policy.post.enabled, passes: policy.post.enabled ? ['scene', 'bloom', 'grade', 'output', 'fxaa'] : [],
        } },
      },
      lastFrame: {
        source: 'manual', counterAgreement: true, total: { calls: 100 }, draws: { post: { calls: bloomEnabled ? 16 : 0 } },
      },
    }
    assert.doesNotThrow(() => validateRuntimeControlSnapshot(snapshot, viewport, bloomEnabled))
    const wrong = structuredClone(snapshot)
    wrong.runtime.rendering.post.width++
    assert.throws(() => validateRuntimeControlSnapshot(wrong, viewport, bloomEnabled))
    wrong.runtime.rendering.post.width--
    wrong.lastFrame.counterAgreement = false
    assert.throws(() => validateRuntimeControlSnapshot(wrong, viewport, bloomEnabled))
    if (!bloomEnabled) {
      wrong.lastFrame.counterAgreement = true
      wrong.runtime.rendering.post.composer = true
      assert.throws(() => validateRuntimeControlSnapshot(wrong, viewport, false))
    }
  }
})

test('incompatible joined runner options fail without creating artifacts or launching a browser', () => {
  const output = resolve('unused-first-visual-negative-control')
  const runner = fileURLToPath(new URL('../scripts/graphics-run.mjs', import.meta.url))
  for (const [args, message] of [
    [['--portrait-smoke'], /portrait-smoke requires/],
    [['--runtime-controls', '--portraits', '--visual-mode', 'enhanced'], /Runtime controls require/],
    [['--recorded-river-endpoint', '--cases', 'elf-opening'], /Recorded endpoint requires/],
    [['--hud-mode', 'unrecognized'], /Invalid HUD mode/],
  ] as const) {
    assert.throws(() => execFileSync(process.execPath, [runner, '--out', output, ...args], {
      stdio: 'pipe', encoding: 'utf8',
    }), message)
    assert.equal(existsSync(output), false)
  }
})
