import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  ART_WEATHER_ATTRIBUTE, StylizedArtLibrary, createAtmospherePresentation,
  sampleAtmosphereOpacity, weatheredRoughness, writeAtmospherePresentation, validateArtGeometry,
} from '../src/game/art/index.ts'
import { validateArtEnvironment, type StylizedPresentationEnvironment } from '../src/game/art/ArtPresentation.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { precipitationCount, updatePrecipitationBuffer } from '../src/game/PrecipitationPresentation.ts'

const ink = { player: 0x102030, enemy: 0x301020, interactable: 0x302010, landmark: 0x203010 }
const environment = (): StylizedPresentationEnvironment => ({
  timeSeconds: 10, windX: 1, windZ: 0, windStrength: 0.7, rain: 1, snow: 0, wetness: 1,
  skyColor: new THREE.Color(0.4, 0.5, 0.6), horizonColor: new THREE.Color(0.2, 0.3, 0.4),
  atmosphere: createAtmospherePresentation(),
})
function compile(material: THREE.Material, kind: 'standard' | 'basic' | 'depth' = 'standard') {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib[kind].vertexShader,
    fragmentShader: THREE.ShaderLib[kind].fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)
  return shader
}

test('atmosphere protects near combat and has monotone bounded depth/height response', () => {
  const profile = createAtmospherePresentation()
  const color = new THREE.Color(0.2, 0.3, 0.4)
  writeAtmospherePresentation(profile, color, 18, 72)
  assert.equal(profile.nearDepth, 22)
  assert.notEqual(profile.color, color)
  let previous = 0
  for (let depth = -10; depth <= 160; depth += 0.5) {
    const value = sampleAtmosphereOpacity(profile, depth, 0)
    assert.ok(value >= previous && value >= 0 && value <= 1)
    if (depth <= 22) assert.equal(value, 0)
    assert.ok(sampleAtmosphereOpacity(profile, depth, 30) <= value)
    previous = value
  }
  assert.equal(sampleAtmosphereOpacity(profile, profile.midDepth, 0), profile.midOpacity)
  assert.equal(sampleAtmosphereOpacity(profile, profile.farDepth, 0), 1)
  assert.equal(sampleAtmosphereOpacity(profile, 160, -1000), 1)
  assert.throws(() => writeAtmospherePresentation(profile, color, 30, 20), /ordered/)
})

test('invalid environment/profile inputs reject atomically without changing shared live uniforms', () => {
  const art = new StylizedArtLibrary({ ink, enhanced: true })
  const material = art.createMaterial({ surface: 'stone', color: 0x999999 })
  const shader = compile(material)
  const valid = environment()
  art.setLightingReference({ environment: valid })
  for (const [name, value] of [
    ['nearDepth', -1], ['midDepth', 1], ['farDepth', 1], ['midOpacity', 1.1],
    ['farOpacity', 0.1], ['heightFalloff', -1], ['heightInfluence', 2], ['baseHeight', NaN],
  ] as const) {
    assert.throws(() => art.setLightingReference({
      environment: { ...valid, timeSeconds: 20, atmosphere: { ...valid.atmosphere!, [name]: value } },
    }), /atmosphere/)
    assert.equal(shader.uniforms.uArtTime.value, 10)
    assert.equal(shader.uniforms.uArtAtmosphereEnabled.value, 1)
  }
  for (const invalid of [
    { ...valid, windStrength: 3 }, { ...valid, windX: 2 }, { ...valid, wetness: NaN },
    { ...valid, rain: -1 }, { ...valid, snow: 2 }, { ...valid, skyColor: new THREE.Color(-1, 0, 0) },
  ]) assert.throws(() => validateArtEnvironment(invalid), /environment/)
  material.dispose(); art.dispose()
})

test('source and ink share one linear-space atmosphere and restore stock fog without touching skin/depth', () => {
  const art = new StylizedArtLibrary({ ink, enhanced: true })
  const geometry = new THREE.BoxGeometry(1, 2, 1)
  const material = art.createMaterial({ surface: 'stone', color: 0x999999 })
  const source = new THREE.InstancedMesh(geometry, material, 1)
  const binding = art.bindRenderSource(source, { visibility: true, shadowParticipation: true })
  const outline = art.applyOutline(source, 'structural', { instanced: true })
  const main = compile(material), shell = compile(outline.shells[0].material as THREE.Material, 'basic')
  const env = environment()
  art.setLightingReference({ environment: env })
  for (const shader of [main, shell]) {
    assert.equal(shader.uniforms.uArtAtmosphereDepth, main.uniforms.uArtAtmosphereDepth)
    assert.equal(shader.uniforms.uArtAtmosphereColor, main.uniforms.uArtAtmosphereColor)
    assert.equal((shader.fragmentShader.match(/gl_FragColor\.rgb = mix\( gl_FragColor\.rgb, uArtAtmosphereColor/g) ?? []).length, 1)
    assert.ok(shader.fragmentShader.indexOf('kFogOpacity *=') > shader.fragmentShader.indexOf('#include <tonemapping_fragment>'))
    assert.ok(shader.fragmentShader.indexOf('kFogOpacity *=') < shader.fragmentShader.indexOf('#include <colorspace_fragment>'))
    assert.match(shader.fragmentShader, /uArtAtmosphereEnabled < 0.5/)
    assert.match(shader.vertexShader, /modelMatrix \* kFogPosition/)
    assert.match(shader.vertexShader, /instanceMatrix \* kFogPosition/)
    assert.match(shader.fragmentShader, /kArtDither/)
  }
  assert.doesNotMatch(shell.fragmentShader, /kWetness|roughnessFactor/)
  assert.doesNotMatch(compile(source.customDepthMaterial!, 'depth').fragmentShader, /kFogOpacity|kWetness/)
  assert.notEqual(main.uniforms.uArtSky.value, env.skyColor)
  env.skyColor.setRGB(0, 0, 0)
  assert.equal((main.uniforms.uArtSky.value as THREE.Color).r, 0.4)
  art.setLightingReference({ keyIntensity: 0.5 })
  assert.equal(main.uniforms.uArtAtmosphereEnabled.value, 1)
  art.setLightingReference({ environment: { ...env, atmosphere: undefined, wetness: 0 } })
  assert.equal(main.uniforms.uArtAtmosphereEnabled.value, 0)
  assert.equal((main.uniforms.uArtWeather.value as THREE.Vector3).z, 0)
  assert.equal(material.roughness, 0.94, 'dry shared material properties are immutable')
  art.releaseOutline(outline); art.releaseRenderSource(binding); source.dispose(); geometry.dispose(); material.dispose(); art.dispose()
})

test('assembled source/ink fog stages converge within direct and composer paths at varied Neutral exposures', () => {
  // A CPU output-stage model, driven by the actual assembled shader ordering and
  // material flags. This is not a GLSL driver/pixel result; that still requires a lease.
  const chunks = THREE.ShaderChunk.tonemapping_pars_fragment
  assert.match(chunks, /StartCompression = 0.8 - 0.04/)
  assert.match(chunks, /Desaturation = 0.15/)
  assert.match(chunks, /x < 0.08 \? x - 6.25 \* x \* x : 0.04/)
  const neutral = (input: THREE.Color, exposure: number) => {
    const color = input.clone().multiplyScalar(exposure)
    const x = Math.min(color.r, color.g, color.b)
    const offset = x < 0.08 ? x - 6.25 * x * x : 0.04
    color.setRGB(color.r - offset, color.g - offset, color.b - offset)
    const peak = Math.max(color.r, color.g, color.b)
    if (peak < 0.76) return color
    const newPeak = 1 - 0.24 * 0.24 / (peak + 0.24 - 0.76)
    color.multiplyScalar(newPeak / peak)
    return color.lerp(new THREE.Color(newPeak, newPeak, newPeak), 1 - 1 / (0.15 * (peak - newPeak) + 1))
  }
  const art = new StylizedArtLibrary({ ink, enhanced: true })
  const source = art.createMaterial({ surface: 'stone', color: 0x999999 })
  const shell = art.getOutlineMaterial('structural', false)
  const fog = new THREE.Color(0.3, 0.45, 0.7)
  assert.equal(source.toneMapped, true)
  assert.equal(shell.toneMapped, false)
  function output(material: THREE.Material, kind: 'standard' | 'basic', input: THREE.Color,
    opacity: number, post: boolean, exposure: number, oldOrder = false) {
    const shader = compile(material, kind).fragmentShader
    const toneAt = shader.indexOf('#include <tonemapping_fragment>')
    const fogAt = oldOrder ? toneAt - 1 : shader.indexOf('gl_FragColor.rgb = mix( gl_FragColor.rgb, uArtAtmosphereColor')
    const colorAt = shader.indexOf('#include <colorspace_fragment>')
    let color = input.clone()
    const stages = [
      { at: fogAt, apply: () => { color.lerp(fog, opacity) } },
      { at: toneAt, apply: () => { if (!post && material.toneMapped) color = neutral(color, exposure) } },
      { at: colorAt, apply: () => { if (!post) color.convertLinearToSRGB() } },
    ].sort((left, right) => left.at - right.at)
    stages.forEach((stage) => stage.apply())
    if (post) color = neutral(color, exposure).convertLinearToSRGB()
    return color
  }
  const body = new THREE.Color(0.7, 0.25, 0.12), inkColor = new THREE.Color(0.01, 0.02, 0.03)
  for (const post of [false, true]) for (const exposure of [0.5, 1, 2]) {
    assert.deepEqual(output(source, 'standard', body, 1, post, exposure), output(shell, 'basic', inkColor, 1, post, exposure))
    for (const opacity of [0, 0.25, 0.65]) {
      for (const [material, kind, input] of [[source, 'standard', body], [shell, 'basic', inkColor]] as const) {
        const expected = post
          ? neutral(input.clone().lerp(fog, opacity), exposure).convertLinearToSRGB()
          : (material.toneMapped ? neutral(input, exposure) : input.clone()).lerp(fog, opacity).convertLinearToSRGB()
        assert.deepEqual(output(material, kind, input, opacity, post, exposure), expected)
      }
    }
    if (!post) assert.notDeepEqual(
      output(source, 'standard', body, 1, post, exposure, true),
      output(shell, 'basic', inkColor, 1, post, exposure, true),
      'the previous pre-tone-map insertion must fail the endpoint comparison',
    )
  }
  assert.notDeepEqual(output(source, 'standard', body, 1, true, 2), output(source, 'standard', body, 1, false, 2),
    'within-path convergence does not promise cross-path equivalence')
  source.dispose(); art.dispose()
})

test('wet response follows packed data after roughness maps, never metalness/emissive, with real opt-outs', () => {
  const art = new StylizedArtLibrary({ ink, enhanced: true })
  for (const surface of ['ground', 'cloth', 'metal', 'water', 'glow'] as const) {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const values = new Float32Array(geometry.getAttribute('position').count * 2)
    for (let index = 0; index < values.length; index += 2) values.set([0.3, 0.22], index)
    geometry.setAttribute(ART_WEATHER_ATTRIBUTE, new THREE.BufferAttribute(values, 2))
    const material = art.createMaterial({ surface, color: 0xffffff, attributes: { weatherResponse: true } })
    const source = new THREE.Mesh(geometry, material)
    validateArtGeometry(source)
    const shader = compile(material)
    assert.equal(shader.uniforms.uArtWeatherEligible.value, surface === 'water' || surface === 'glow' ? 0 : 1)
    assert.match(shader.vertexShader, /vArtWeatherResponse = artWeatherResponse/)
    assert.ok(shader.fragmentShader.indexOf('roughnessFactor - kWeatherResponse') > shader.fragmentShader.indexOf('#include <roughnessmap_fragment>'))
    const response = shader.fragmentShader.slice(shader.fragmentShader.indexOf('vec2 kWeatherResponse'), shader.fragmentShader.indexOf('#include <lights_physical_fragment>'))
    assert.doesNotMatch(response, /metalnessFactor\s*=|totalEmissiveRadiance/)
    values[0] = 0.301
    assert.throws(() => validateArtGeometry(source), /invalid data/)
    values[0] = 0.3; values[1] = 0.221
    assert.throws(() => validateArtGeometry(source), /value response/)
    geometry.dispose(); material.dispose()
  }
  for (const dry of [0, 0.2, 0.35, 0.5, 0.8, 1]) {
    for (const wetness of [0, 0.5, 1]) {
      const wet = weatheredRoughness(dry, 0.3, wetness)
      assert.ok(wet <= dry && wet >= Math.min(dry, 0.35))
      if (wetness === 0) assert.equal(wet, dry)
    }
  }
  art.dispose()
})

test('generated terrain and subsequently streamed materials receive positive wetness without groundSurfaces', () => {
  const art = new StylizedArtLibrary({ ink, enhanced: true })
  const scene = new THREE.Scene()
  const blueprint = generateWorld(20260906)
  const runtime = new GeneratedWorldRuntime(scene, blueprint, { art, decorationDensity: 0 })
  art.setLightingReference({ environment: environment() })
  try {
    for (const region of [blueprint.regions[0], blueprint.regions[12], blueprint.regions[24]]) {
      runtime.update({ focus: runtime.getRegionCenter(region.id)!, deltaSeconds: 0 })
      let terrainCount = 0
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !object.name.startsWith('terrain:')) return
        assert.ok(object.material instanceof THREE.MeshStandardMaterial)
        const shader = compile(object.material)
        assert.equal((shader.uniforms.uArtWeather.value as THREE.Vector3).z, 1)
        assert.equal(shader.uniforms.uArtWeatherEligible.value, 1)
        assert.ok((shader.uniforms.uArtWeatherResponse.value as THREE.Vector2).x > 0)
        terrainCount++
      })
      assert.ok(terrainCount > 0)
    }
  } finally { runtime.dispose(); art.dispose() }
})

test('legacy remains the unmodified shader and refuses enhanced-only requests', () => {
  const art = new StylizedArtLibrary({ ink })
  const material = art.createMaterial({ surface: 'cloth', color: 0xffffff })
  assert.doesNotMatch(compile(material).fragmentShader, /kWetness|kFogOpacity/)
  assert.throws(() => art.setLightingReference({ environment: environment() }), /explicit enhanced/)
  assert.throws(() => art.createMaterial({ surface: 'cloth', color: 0xffffff, attributes: { weatherResponse: true } }), /explicit enhanced/)
  material.dispose(); art.dispose()
})

test('precipitation uses bounded density and real terrain above and below the old fixed plane', () => {
  assert.equal(precipitationCount(420, 1, 1, false), 420)
  assert.equal(precipitationCount(300, 0.4, 1, true), 60)
  assert.equal(precipitationCount(300, 1, 0.01, false), 0)
  assert.equal(precipitationCount(420, 0, 1, false), 0)
  assert.throws(() => precipitationCount(420, 2, 1, false), /Invalid/)
  for (const kind of ['rain', 'snow'] as const) {
    const stride = kind === 'rain' ? 6 : 3
    const positions = new Float32Array(10 * stride).fill(0.5)
    const unchanged = positions.slice(5 * stride)
    const phases = new Float32Array(10)
    const frame = { delta: 0.05, time: 10, cameraX: 100, cameraY: 75, cameraZ: 100,
      windX: 1, windZ: 0, windStrength: 1, reducedMotion: true }
    for (const elevation of [65, -30]) {
      frame.cameraY = elevation + 8
      updatePrecipitationBuffer(kind, positions, phases, 5, frame, (x) => elevation + (x - 100) * 0.1)
      for (let index = 0; index < 5; index++) {
        const offset = index * stride
        assert.ok(positions[offset + 1] >= elevation + (positions[offset] - 100) * 0.1 + 0.079)
        assert.ok(Math.hypot(positions[offset] - 100, positions[offset + 2] - 100) >= 1.5)
        if (kind === 'rain') {
          assert.equal(positions[offset], positions[offset + 3], 'reduced motion removes lateral wind')
          assert.ok(Math.abs(positions[offset + 4] - positions[offset + 1] - 0.65) < 1e-5)
        }
      }
    }
    assert.deepEqual(positions.slice(5 * stride), unchanged, 'inactive slots are not updated')
    assert.throws(() => updatePrecipitationBuffer(kind, positions, phases, 11, frame, () => 0), /Invalid/)
    assert.throws(() => updatePrecipitationBuffer(kind, positions, phases, 1, frame, () => NaN), /finite/)
  }
})
