import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import {
  ART_WEATHER_ATTRIBUTE, CHARACTER_FACTIONS, GeometryCache, SURFACE_WEATHER_RESPONSE,
  StylizedArtLibrary, bakeWeatherResponse, characterPresenter, creaturePresenter,
  createAtmospherePresentation, validateArtGeometry, wagonPresenter,
  type CharacterContact, type CharacterPresenter, type CreaturePresenter, type WagonPresenter,
} from '../src/game/art/index.ts'
import { getArtMaterialFeatures } from '../src/game/art/ArtPresentation.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { sumVisualAllocationReceipts } from '../src/game/diagnostics/VisualBudgetAccounting.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'
import { createWorldSurfaceSample } from '../src/game/world/WorldSurfaceField.ts'
import type { Faction } from '../src/game/types.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function artLibrary() {
  return new StylizedArtLibrary({ enhanced: true, ink: {
    player: 0x282828, enemy: 0x282828, interactable: 0x282828, landmark: 0x282828,
  } })
}

function compiled(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)
  return shader
}

function assertResponse(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)
}

test('pre-cache weather baking preserves authored channels and uses zero for excluded surfaces', () => {
  const geometry = new THREE.BoxGeometry()
  try {
    const position = geometry.getAttribute('position')
    const index = geometry.index
    bakeWeatherResponse(geometry, SURFACE_WEATHER_RESPONSE.skin)
    const weather = geometry.getAttribute(ART_WEATHER_ATTRIBUTE)
    assert.equal(weather.count, position.count)
    assert.equal(weather.itemSize, 2)
    assertResponse(weather.getX(0), SURFACE_WEATHER_RESPONSE.skin[0])
    bakeWeatherResponse(geometry, SURFACE_WEATHER_RESPONSE.stone)
    assert.equal(geometry.getAttribute(ART_WEATHER_ATTRIBUTE), weather)
    assertResponse(weather.getX(0), SURFACE_WEATHER_RESPONSE.skin[0])
    assert.equal(geometry.getAttribute('position'), position)
    assert.equal(geometry.index, index)
    assert.throws(() => bakeWeatherResponse(geometry, [NaN, 0]), RangeError)
    assert.throws(() => bakeWeatherResponse(geometry, [0.31, 0]), RangeError)
    assert.throws(() => bakeWeatherResponse(geometry, [0, 0.23]), RangeError)
    for (const excluded of ['water', 'glow'] as const) {
      const fresh = new THREE.BoxGeometry()
      bakeWeatherResponse(fresh, SURFACE_WEATHER_RESPONSE[excluded])
      assert.ok(fresh.getAttribute(ART_WEATHER_ATTRIBUTE).array.every((value) => value === 0))
      fresh.dispose()
    }
  } finally { geometry.dispose() }
})

test('joined production characters and world use the same live atmosphere with distinct packed surface responses', () => {
  const art = artLibrary()
  const cache = new GeometryCache()
  const scene = new THREE.Scene()
  const blueprint = generateWorld(20260906)
  const fingerprint = blueprint.fingerprint
  const policy = resolveVisualPolicy({ visualMode: 'enhanced' })
  const world = new GeneratedWorldRuntime(scene, blueprint, {
    art, visualPolicy: policy, terrainResolution: 6, outlineDressing: true,
  })
  const characters = new Set<CharacterPresenter>()
  const engine: {
    createCharacter(faction: Faction, player: boolean, role?: 'soldier', variant?: number): THREE.Group
  } = Object.assign(Object.create(GameEngine.prototype), {
    visualPolicy: policy, artLibrary: art, artGeometry: cache, characterPresenters: characters,
    palette: { success: new THREE.Color(0x4ade80), link: new THREE.Color(0x4da6ff), accent: new THREE.Color(0xfd8ea1) },
  })
  const environment = {
    timeSeconds: 30, windX: 1, windZ: 0, windStrength: 0.2, rain: 0.8, snow: 0, wetness: 0.8,
    skyColor: new THREE.Color(0xbac8d1), horizonColor: new THREE.Color(0x78919c),
    atmosphere: createAtmospherePresentation(),
  }
  const contact: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' }
  const sample = createWorldSurfaceSample()
  const shaders: ReturnType<typeof compiled>[] = []
  try {
    const center = world.getRegionCenter(blueprint.regions[12].id)!
    world.update({ deltaSeconds: 0, focus: center })
    assert.ok(world.surfaces)
    for (const faction of CHARACTER_FACTIONS) {
      const root = engine.createCharacter(faction, true)
      root.position.set(center.x, center.y, center.z)
      const presenter = characterPresenter(root)!
      scene.add(root)
      presenter.syncAttachments()
      assert.ok(presenter.sampleContact('torso', contact))
      assert.ok(contact.normal.length() > 0.99)
      assert.equal(world.surfaces.sampleInto(contact.point.x, contact.point.z, sample), sample)
      assert.equal('height' in sample, false, 'Surface metadata does not become physical height authority')
      const preservedRoot = root.position.toArray()
      for (const source of presenter.sources) {
        validateArtGeometry(source)
        const material = source.material
        assert.ok(!Array.isArray(material), 'The compatible body/equipment source is a single material')
        assert.equal(getArtMaterialFeatures(material)?.attributes.weatherResponse, true)
        const weather = source.geometry.getAttribute(ART_WEATHER_ATTRIBUTE)
        assert.equal(weather.count, source.geometry.getAttribute('position').count)
        shaders.push(compiled(material))
      }
      const responses = presenter.body.geometry.getAttribute(ART_WEATHER_ATTRIBUTE)
      assert.ok(Array.from({ length: responses.count }, (_, i) => responses.getX(i))
        .some((value) => Math.abs(value - SURFACE_WEATHER_RESPONSE.skin[0]) < 1e-6))
      const neighbor = characterPresenter(engine.createCharacter(faction, false, 'soldier', 1))!
      const neighborWeather = neighbor.body.geometry.getAttribute(ART_WEATHER_ATTRIBUTE).array.slice()
      presenter.setAppearance({ leftArm: 'missing', rightArm: 'prosthetic' })
      assert.equal(presenter.sampleContact('leftArm', contact), false)
      assert.equal(presenter.sampleContact('rightArm', contact), true)
      assert.equal(contact.surface, 'metal')
      const skin = presenter.body.geometry.getAttribute('skinIndex')
      const prostheticWeather = presenter.body.geometry.getAttribute(ART_WEATHER_ATTRIBUTE)
      let checked = 0
      for (let i = 0; i < skin.count; i++) {
        if (!presenter.skeleton.bones[skin.getX(i)].name.startsWith('rightArm')) continue
        assertResponse(prostheticWeather.getX(i), SURFACE_WEATHER_RESPONSE.metal[0])
        assertResponse(prostheticWeather.getY(i), SURFACE_WEATHER_RESPONSE.metal[1])
        checked++
      }
      assert.ok(checked > 0)
      assert.deepEqual(neighbor.body.geometry.getAttribute(ART_WEATHER_ATTRIBUTE).array, neighborWeather)
      assert.deepEqual(root.position.toArray(), preservedRoot)
    }
    const inventory = world.getVisualInventory()
    let packedWorld = 0
    for (const source of inventory.sources) {
      for (const material of Array.isArray(source.material) ? source.material : [source.material]) {
        const features = getArtMaterialFeatures(material)
        if (!features?.enhanced) continue
        const shader = compiled(material)
        shaders.push(shader)
        if (features.attributes.surfaceResponse) {
          assert.equal(features.attributes.weatherResponse, true)
          validateArtGeometry(source)
          packedWorld++
        }
        if (material.userData.stylizedSurfacePreset === 'water' || material.userData.stylizedSurfacePreset === 'glow') {
          assert.equal(shader.uniforms.uArtWeatherEligible.value, 0)
        }
      }
    }
    assert.ok(packedWorld > 0)
    assert.ok(shaders.length > 3)
    art.setLightingReference({ environment })
    const sharedWeather = shaders[0].uniforms.uArtWeather
    for (const shader of shaders) {
      assert.equal(shader.uniforms.uArtWeather, sharedWeather)
      assert.equal((shader.uniforms.uArtWeather.value as THREE.Vector3).z, 0.8)
      assert.equal(shader.uniforms.uArtAtmosphereEnabled.value, 1)
    }
    environment.wetness = 0
    environment.rain = 0
    art.setLightingReference({ environment })
    assert.equal((sharedWeather.value as THREE.Vector3).z, 0)
    assert.equal(blueprint.fingerprint, fingerprint)
    assert.equal(inventory.complete, false)
    assert.equal(sumVisualAllocationReceipts(inventory.receipts).world.gpuAllocatedBytes, null)
  } finally {
    for (const presenter of characters) presenter.dispose()
    world.dispose()
    assert.equal(world.getVisualInventory().receipts.length, 0)
    cache.dispose()
    art.dispose()
  }
})

test('batched production creatures and every wagon component retain their physical material weather presets', () => {
  const art = artLibrary(), cache = new GeometryCache()
  const creatures = new Set<CreaturePresenter>(), wagons = new Set<WagonPresenter>()
  const engine: {
    createBeast(role: 'wolf' | 'bear' | 'boar' | 'troll'): THREE.Group
    createDeer(): THREE.Group
    createBird(): THREE.Group
    createCaravan(gilded?: boolean): THREE.Group
  } = Object.assign(Object.create(GameEngine.prototype), {
    artLibrary: art, artGeometry: cache, creaturePresenters: creatures, wagonPresenters: wagons,
    visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced' }),
    palette: { warning: new THREE.Color(0xfbbf24), bg: new THREE.Color(0x302d29), text: new THREE.Color(0xdedede),
      surface: new THREE.Color(0x45413c), borderStrong: new THREE.Color(0x605e5a) },
  })
  try {
    const roots = [
      ...(['wolf', 'bear', 'boar', 'troll'] as const).map((role) => engine.createBeast(role)),
      engine.createDeer(), engine.createBird(), engine.createCaravan(false), engine.createCaravan(true),
    ]
    const contact: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'skin' }
    for (const root of roots) {
      const creature = creaturePresenter(root)
      if (creature) {
        const before = root.position.toArray()
        if (creature.sampleContact('torso', contact)) assert.ok(contact.normal.length() > 0.99)
        assert.deepEqual(root.position.toArray(), before)
      }
      const wagon = wagonPresenter(root)
      if (wagon) assert.ok(root.getObjectByName('cargo') instanceof THREE.Mesh)
    }
    assert.ok(creatures.size >= 12, 'All beasts/fauna, both wagons and their draft oxen must be covered')
    for (const presenter of creatures) {
      validateArtGeometry(presenter.source)
      const material = presenter.source.material
      assert.ok(!Array.isArray(material))
      assert.equal(getArtMaterialFeatures(material)?.attributes.weatherResponse, true)
      const weather = presenter.source.geometry.getAttribute(ART_WEATHER_ATTRIBUTE)
      assert.equal(weather.count, presenter.source.geometry.getAttribute('position').count)
      for (let i = 0; i < weather.count; i++) {
        assert.ok(weather.getX(i) <= 0.3 && weather.getY(i) <= 0.22)
      }
      assert.equal(sumVisualAllocationReceipts(presenter.allocationReceipts()).dynamicArt.gpuAllocatedBytes, null)
    }
  } finally {
    for (const wagon of wagons) wagon.dispose()
    for (const creature of creatures) creature.dispose()
    cache.dispose()
    art.dispose()
  }
})
