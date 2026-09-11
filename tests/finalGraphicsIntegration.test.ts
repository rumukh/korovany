import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import {
  GeometryCache, StylizedArtLibrary, createCharacterPresenter, illustratedCharacterPlan, resolveCharacterPlan,
} from '../src/game/art/index.ts'
import { CameraVisibility } from '../src/game/cameraVisibility.ts'
import { WorldPresentationRegistry } from '../src/game/world/WorldPresentationRegistry.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import type { VisualMode } from '../src/game/visualSettings.ts'
import { createGeneratedRngStreams } from '../src/game/random/GeneratedRngStreams.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

test('the ec1d317 native riverside camera retains actual player framing, not only clear torso rays', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } })
  const art = new StylizedArtLibrary({ enhanced: true, ink: { player: 0, enemy: 0, interactable: 0, landmark: 0 } })
  const scene = new THREE.Scene()
  const policy = resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'balanced' })
  const world = new GeneratedWorldRuntime(scene, generateWorld(20260906), { art, visualPolicy: policy })
  const player = new THREE.Group()
  player.position.set(13.41004327541765, 11.88043831962156, -95.37079333601508)
  const root = player.position.clone()
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 240)
  const solver = new CameraVisibility()
  const engine: {
    trauma: number
    shakeClock: number
    updateCamera(delta: number, immediate: boolean): void
    getViewDirection(): THREE.Vector3
  } = Object.assign(Object.create(GameEngine.prototype), {
    visualPolicy: policy, player, camera, artLibrary: art,
    cameraPitch: 0.38, cameraYaw: -1.6869327348976162, cameraFollowPosition: new THREE.Vector3(),
    generatedWorld: world, cameraVisibility: solver, enhancedTarget: new THREE.Vector3(),
    enhancedDesired: new THREE.Vector3(), enhancedPosition: new THREE.Vector3(), enhancedShaken: new THREE.Vector3(),
    rendererDevicePixelRatio: 1, cameraTerrain: (x: number, z: number) => world.sampleHeight(x, z),
    playerRenderBindings: [], nearSubjects: [], nearSubjectPool: Array.from({ length: 5 }, () => new THREE.Vector3()),
    actors: [], trauma: 0, shakeClock: 0, paused: false, ended: false,
    updatePlayerOutlineVisibility() {}, updateCameraFov() {},
  })
  const projected = (height: number) => root.clone().add(new THREE.Vector3(0, height, 0)).project(camera)
  const assertFrame = (label: string) => {
    for (const height of [1.1, 1.65, 2.2]) {
      const ndc = projected(height)
      assert.ok(Math.abs(ndc.x) <= 0.6 && Math.abs(ndc.y) <= 0.82 && Math.abs(ndc.z) < 1,
        `${label}: actual player at ${height}m is outside usable frame: ${ndc.toArray()}`)
    }
    const direction = camera.getWorldDirection(new THREE.Vector3())
    assert.ok(direction.distanceTo(engine.getViewDirection()) < 1e-10, 'Framing must not replace requested view pitch/yaw')
    const result = { distance: 0, blocked: false, overflow: false, triangleTests: 0, initialOverlap: false }
    world.presentation!.sweep(camera.position, camera.position, 0.32, result)
    assert.equal(result.blocked, false, 'Framing must preserve actual production-geometry clearance')
    assert.ok(camera.position.y >= world.sampleHeight(camera.position.x, camera.position.z) + 0.32)
    assert.deepEqual(player.position, root)
    assert.equal(solver.debug.framedTargetProbes, 3)
    assert.equal(solver.debug.framingError, 0)
    assert.ok(Math.abs(solver.debug.torsoNdcX - projected(1.1).x) < 1e-10)
    assert.ok(Math.abs(solver.debug.headNdcY - projected(2.2).y) < 1e-10)
  }
  try {
    world.update({ focus: { x: root.x, z: root.z }, deltaSeconds: 0 })
    scene.updateMatrixWorld(true)
    engine.updateCamera(0, true)
    assertFrame('fresh restage')
    const badEye = new THREE.Vector3(14.630484891438654, 14.719999055090081, -97.56070546988218)
    camera.position.copy(badEye)
    camera.lookAt(badEye.clone().add(engine.getViewDirection()))
    camera.updateMatrixWorld()
    assert.ok(Math.abs(projected(1.1).x + 1.072196) < 0.00001)
    assert.ok(projected(2.2).x < -1.34, 'Preserve the exact off-left recorded player negative control')
    for (const name of ['lastSafe', 'follow']) {
      const vector: unknown = Reflect.get(solver, name)
      assert.ok(vector instanceof THREE.Vector3)
      vector.copy(badEye)
    }
    Reflect.set(solver, 'shoulder', 3)
    let maxSweeps = 0, maxTriangles = 0
    for (let frame = 0; frame < 12; frame++) {
      engine.updateCamera(1 / 60, false)
      assertFrame(`recorded follow ${frame}`)
      if (frame === 0) assert.equal(solver.debug.framingCut, true)
      assert.equal(solver.debug.visibleTargetProbes, 3)
      assert.ok(solver.debug.candidates <= 5)
      assert.ok(solver.debug.sweeps <= 72)
      maxSweeps = Math.max(maxSweeps, solver.debug.sweeps)
      maxTriangles = Math.max(maxTriangles, solver.debug.triangleTests)
    }
    engine.trauma = 0.7
    for (let frame = 0; frame < 12; frame++) {
      engine.shakeClock += 1 / 60
      engine.updateCamera(1 / 60, false)
      assertFrame(`scoped shake ${frame}`)
    }
    console.log(`ec1d317 recorded follow recovered: eye ${camera.position.toArray()}; max ${maxSweeps} sweeps/${maxTriangles} triangles; torso NDC ${solver.debug.torsoNdcX},${solver.debug.torsoNdcY}`)
  } finally {
    world.dispose()
    art.dispose()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('current-main view pitch survives both graphics policies and enhanced collision still guards the camera', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } })
  try {
    for (const visualMode of ['legacy', 'enhanced'] as const) {
      const art = new StylizedArtLibrary({
        enhanced: visualMode === 'enhanced', ink: { player: 0, enemy: 0, interactable: 0, landmark: 0 },
      })
      const scene = new THREE.Scene()
      const presentation = new WorldPresentationRegistry(art)
      const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 240)
      const player = new THREE.Group()
      player.position.y = 3
      const engine: {
        cameraPitch: number
        cameraYaw: number
        cameraObstacles: THREE.Object3D[]
        updateCamera(delta: number, immediate: boolean): void
        getAimDirection(): THREE.Vector3
      } = Object.assign(Object.create(GameEngine.prototype), {
        visualPolicy: resolveVisualPolicy({ visualMode }), player, camera, artLibrary: art,
        cameraPitch: 0, cameraYaw: 0.7, cameraFollowPosition: new THREE.Vector3(),
        cameraRaycaster: new THREE.Raycaster(), cameraObstacles: [], foliageOccluders: [],
        generatedWorld: { presentation }, cameraVisibility: new CameraVisibility(),
        enhancedTarget: new THREE.Vector3(), enhancedDesired: new THREE.Vector3(),
        enhancedPosition: new THREE.Vector3(), enhancedShaken: new THREE.Vector3(),
        rendererDevicePixelRatio: 1, cameraTerrain: () => 3, groundHeightAt: () => 3,
        playerRenderBindings: [], nearSubjects: [], nearSubjectPool: Array.from({ length: 5 }, () => new THREE.Vector3()),
        actors: [], trauma: 0, screenShakeEnabled: false, paused: false, ended: false,
        updatePlayerOutlineVisibility() {}, updateCameraFov() {},
      })
      let registration: { dispose(): void } | undefined
      let binding: ReturnType<StylizedArtLibrary['bindRenderSource']> | undefined
      const geometry = new THREE.BoxGeometry(30, 30, 0.2)
      const material = art.createMaterial({ color: 0x778899, surface: 'stone' })
      try {
        for (const pitch of [-1.2, 0, Math.atan2(6.53, 10), 1.2]) {
          engine.cameraPitch = pitch
          engine.updateCamera(0, true)
          for (let frame = 0; frame < 8; frame++) engine.updateCamera(1 / 60, false)
          const expected = new THREE.Vector3(
            Math.sin(engine.cameraYaw) * Math.cos(pitch), -Math.sin(pitch),
            -Math.cos(engine.cameraYaw) * Math.cos(pitch),
          )
          assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(expected) < 1e-10,
            `${visualMode}: look direction lost true pitch`)
          assert.ok(camera.position.y >= 3.3, `${visualMode}: upward aim moved the camera below terrain`)
          assert.equal(engine.getAimDirection().y, 0)
          assert.ok(Math.abs(engine.getAimDirection().length() - 1) < 1e-12)
        }
        const wall = new THREE.Mesh(geometry, material)
        wall.position.set(0, 4.65, 1)
        scene.add(wall)
        scene.updateMatrixWorld(true)
        if (visualMode === 'enhanced') {
          binding = art.bindRenderSource(wall, {})
          registration = presentation.registerOccluder({ id: 'wall', regionId: 'test', kind: 'solid', binding })
        } else engine.cameraObstacles.push(wall)
        engine.cameraYaw = 0
        engine.cameraPitch = 0
        engine.updateCamera(0, true)
        assert.ok(camera.position.z < 0.9, `${visualMode}: retained collision must not cross the near wall`)
      } finally {
        registration?.dispose()
        presentation.dispose()
        if (binding) art.releaseRenderSource(binding)
        geometry.dispose()
        material.dispose()
        art.dispose()
      }
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('actual enhanced elf bow follows elevated shots and torso reset without consuming persisted injury state', () => {
  const art = new StylizedArtLibrary({
    enhanced: true, ink: { player: 0, enemy: 0, interactable: 0, landmark: 0 },
  })
  const cache = new GeometryCache()
  const presenter = createCharacterPresenter(
    illustratedCharacterPlan(resolveCharacterPlan('elf', 'player', 0, true)), art, cache, true,
  )
  const streams = createGeneratedRngStreams(20260906)
  const before = Object.values(streams).map((stream) => stream.getState())
  const shots: THREE.Vector3[] = []
  const engine: {
    cameraPitch: number
    fireArrow(): void
    animateCharacter(root: THREE.Group, pose: object): void
  } = Object.assign(Object.create(GameEngine.prototype), {
    player: presenter.root, faction: 'elf', cameraYaw: 0.4, cameraPitch: 0,
    elapsed: 0, handOffset: new THREE.Vector3(), generatedRngStreams: streams,
    spawnProjectile: (_owner: unknown, _allegiance: unknown, _position: THREE.Vector3, velocity: THREE.Vector3) => shots.push(velocity.clone()),
    playSound() {},
  })
  try {
    for (const pitch of [-1.1, 0, 1.1]) {
      engine.cameraPitch = pitch
      presenter.rig.torsoPivot.rotation.x = 0.8
      engine.animateCharacter(presenter.root, { stride: 0, attack: 0, anticipation: 0, recovery: 0, flinch: 0, stagger: 0 })
      assert.equal(presenter.rig.torsoPivot, presenter.anatomy.torsoPivot)
      assert.equal(presenter.rig.torsoPivot.rotation.x, 0)
      engine.fireArrow()
      presenter.root.updateMatrixWorld(true)
      const forward = new THREE.Vector3(0, 0, 1).transformDirection(presenter.rig.weapon!.matrixWorld)
      assert.ok(forward.distanceTo(shots.at(-1)!.clone().normalize()) < 1e-9,
        'The visible bow must follow actual vertical velocity, not the old horizontal shot')
      presenter.advanceActionPresentation(1, false)
    }
    assert.equal(shots.length, 3)
    assert.deepEqual(Object.values(streams).map((stream) => stream.getState()), before)
  } finally {
    presenter.dispose()
    cache.dispose()
    art.dispose()
  }
})

test('visual mode changes cannot seed or consume a different NPC injury continuation', () => {
  const saved = { combat: 1, director: 2, event: 3, loot: 4, chronicle: 5, rumour: 6, injury: 0 }
  const states: number[][] = []
  for (const visualMode of ['legacy', 'enhanced'] satisfies VisualMode[]) {
    const streams = createGeneratedRngStreams(20260906, saved)
    const original = streams.injury.getState()
    for (const visualQuality of ['high', 'balanced', 'low'] as const) {
      resolveVisualPolicy({ visualMode, visualQuality, bloomEnabled: false })
      new THREE.Object3D()
    }
    assert.equal(streams.injury.getState(), original)
    states.push(Array.from({ length: 8 }, () => streams.injury.next()))
    assert.deepEqual(['combat', 'director', 'event', 'loot', 'chronicle', 'rumour'].map((key) =>
      streams[key as keyof typeof streams].getState()), [1, 2, 3, 4, 5, 6])
  }
  assert.deepEqual(states[0], states[1])
})
