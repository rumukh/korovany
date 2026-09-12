import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import * as THREE from 'three'
import {
  GraphicsCharacterPortrait, measurePortraitSubject, validateCharacterPortrait, PORTRAIT_VIEWS, PORTRAIT_POSES,
  type GraphicsCharacterPortraitRequest, type PortraitPose, type PortraitSubject,
} from '../src/game/diagnostics/GraphicsCharacterPortrait.ts'
import { GraphicsDiagnostics, assertPortraitCaptureOnly, validateGraphicsStage } from '../src/game/diagnostics/GraphicsDiagnostics.ts'
import {
  CHARACTER_FACTIONS, GeometryCache, StylizedArtLibrary,
  type CharacterPresenter, type CharacterContact,
} from '../src/game/art/index.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { createHealthyBody } from '../src/game/types.ts'
import { TransientEffectBudget } from '../src/game/TransientEffectBudget.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function request(pose: PortraitPose = 'current'): GraphicsCharacterPortraitRequest {
  return { version: 1, subject: 'player', view: 'front', pose }
}

function localTransforms(root: THREE.Group) {
  root.updateWorldMatrix(true, true)
  const records: unknown[] = []
  root.traverse((node) => {
    if (StylizedArtLibrary.isOutlineShell(node)) return
    records.push([node.uuid, node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(),
      node.matrix.toArray(), node.matrixAutoUpdate, node.visible])
  })
  return records
}

function fixture() {
  const art = new StylizedArtLibrary({ enhanced: true, ink: {
    player: 0x292929, enemy: 0x292929, interactable: 0x292929, landmark: 0x292929,
  } })
  const cache = new GeometryCache(), presenters = new Set<CharacterPresenter>()
  interface PortraitEngine {
    player: THREE.Group
    health: number
    body: ReturnType<typeof createHealthyBody>
    actors: object[]
    camera: THREE.PerspectiveCamera
    graphicsDiagnostics: { manual: boolean } | null
    graphicsCharacterPortrait: GraphicsCharacterPortrait | null
    createCharacter(faction: typeof CHARACTER_FACTIONS[number], player: boolean, role?: 'soldier' | 'archer'): THREE.Group
    poseGraphicsPortrait(subject: PortraitSubject, pose: PortraitPose): void
    stageGraphicsFixture(stage: { label: string; portrait: GraphicsCharacterPortraitRequest | null }): void
    renderLogicalFrame(delta: number, source: 'manual' | 'active'): void
  }
  const engine: PortraitEngine = Object.assign(Object.create(GameEngine.prototype), {
    faction: 'guard', health: 82, stamina: 64, body: createHealthyBody(), elapsed: 7.25, paused: true, ended: false,
    melee: { beat: 3, phase: 'windup', phaseRemaining: 0.11, bufferRemaining: 0, lockout: 0.18 },
    handOffset: new THREE.Vector3(), artLibrary: art, artGeometry: cache, characterPresenters: presenters,
    visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced' }), actors: [],
    palette: { success: new THREE.Color(0x4ade80), link: new THREE.Color(0x4da6ff), accent: new THREE.Color(0xfd8ea1) },
    camera: new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 250),
    graphicsDiagnostics: { manual: true }, graphicsCharacterPortrait: null,
  })
  engine.camera.position.set(0, 5, -10)
  engine.camera.lookAt(0, 1.65, 0)
  return { engine, art, cache, presenters, dispose() {
    engine.graphicsCharacterPortrait?.dispose()
    for (const p of presenters) p.dispose()
    art.dispose(); cache.dispose()
  } }
}

test('portrait stage accepts only the finite versioned subject/view/pose contract', () => {
  for (const view of PORTRAIT_VIEWS) for (const pose of PORTRAIT_POSES) {
    const value = { ...request(pose), view }
    if (view === 'gameplay' && pose !== 'current') assert.throws(() => validateCharacterPortrait(value))
    else validateGraphicsStage({ label: 'STAGED CPU test', portrait: value })
  }
  const bad: unknown[] = [
    null, {}, { ...request(), version: 2 }, { ...request(), subject: 'actor-evil' },
    { ...request(), pose: 'custom' }, { ...request(), rotation: [0, 1, 2] },
    { ...request(), frame: { position: [NaN, 2, 3], target: [0, 0, 0], fov: 38, near: 0.1, far: 250 } },
    { ...request(), frame: { position: [1, 2, 3], target: [1, 2, 3], fov: 38, near: 0.1, far: 250 } },
    { ...request(), frame: { position: [1, 2, 3], target: [0, 0, 0], fov: 180, near: 0.1, far: 250 } },
  ]
  for (const value of bad) assert.throws(() => Reflect.apply(validateCharacterPortrait, null, [value]))
  assert.throws(() => validateGraphicsStage({ label: 'mixed', portrait: request(), crowd: true }), /combined/)
  assert.throws(() => validateGraphicsStage({ label: 'mixed', portrait: request(), player: { x: 1, y: 0, z: 1 } }), /combined/)
  validateGraphicsStage({ label: 'clear', portrait: null })
  assert.throws(() => assertPortraitCaptureOnly(true), /Clear/)
  assertPortraitCaptureOnly(false)
  const diagnostic: { profile(options: { warmupFrames: number; sampleFrames: number }): Promise<object> } =
    Object.assign(Object.create(GraphicsDiagnostics.prototype), {
      disposed: false, manualMode: true, record: null, portraitActive: true,
      host: { runtime: () => { throw new Error('active state must not be consulted after portrait rejection') } },
    })
  assert.throws(() => diagnostic.profile({ warmupFrames: 1, sampleFrames: 1 }), /Clear/)
})

test('production all-faction portrait poses retain injured geometry, roots, saved combat and exact local transforms', () => {
  const f = fixture()
  let states = 0
  for (const faction of CHARACTER_FACTIONS) for (const role of ['soldier', 'archer'] as const) {
    const root = f.engine.createCharacter(faction, true, role)
    // The player factory correctly chooses its hero kit; a separate production NPC carries the bow.
    const subjectRoot = role === 'archer' ? f.engine.createCharacter(faction, false, 'archer') : root
    const presenter = [...f.presenters].find((p) => p.root === subjectRoot)!
    presenter.setAppearance({ leftLeg: 'missing', rightArm: 'prosthetic', leftArm: 'wounded' })
    subjectRoot.position.set(6, 2, -3)
    subjectRoot.rotation.y = 0.7
    presenter.anatomy.bodyPivot.scale.set(1.05, 0.95, 0.97)
    presenter.anatomy.torsoPivot.rotation.set(0.2, 0.1, -0.1)
    subjectRoot.updateMatrixWorld(true)
    const before = localTransforms(subjectRoot)
    const geometry = presenter.body.geometry
    const indices = geometry.index!.array.slice()
    const color = geometry.getAttribute('color').array.slice()
    const identity = JSON.stringify({ health: f.engine.health, body: f.engine.body, root: subjectRoot.position.toArray(),
      game: Reflect.get(f.engine, 'melee'), elapsed: Reflect.get(f.engine, 'elapsed') })
    const subject: PortraitSubject = { root: subjectRoot, id: 'subject', role, faction, player: role !== 'archer',
      alive: true, weapon: presenter.weaponKind }
    const poses: PortraitPose[] = ['current', 'idle', 'walk', 'windup', 'contact',
      ...(role === 'archer' ? ['aim'] as const : ['guard'] as const)]
    for (const view of ['front', 'three-quarter', 'profile'] as const) for (const pose of poses) {
      const portrait = new GraphicsCharacterPortrait({ ...request(pose), view }, subject,
        (target, state) => f.engine.poseGraphicsPortrait(target, state))
      portrait.present(f.engine.camera)
      const first = portrait.snapshot()!
      assert.equal(first.focusInsideClip, true)
      assert.equal(first.cameraMode, 'diagnostic-portrait-override')
      assert.ok(first.bounds.measuredVertices > 0)
      assert.equal(subjectRoot.getObjectByName('leftLeg')!.visible, false)
      assert.equal(presenter.body.geometry, geometry)
      assert.deepEqual(geometry.index!.array, indices)
      assert.deepEqual(geometry.getAttribute('color').array, color)
      portrait.restoreCameraProjection()
      portrait.present(f.engine.camera)
      assert.deepEqual(portrait.snapshot(), first, 'repeated held poses do not accumulate')
      const frame = { position: first.camera.position, target: first.camera.target!, fov: first.camera.fov,
        near: first.camera.near, far: first.camera.far }
      portrait.dispose()
      assert.deepEqual(localTransforms(subjectRoot), before)
      const replay = new GraphicsCharacterPortrait({ ...request(pose), view, frame }, subject,
        (target, state) => f.engine.poseGraphicsPortrait(target, state))
      replay.present(f.engine.camera)
      assert.deepEqual(replay.snapshot()!.camera, first.camera, 'captured comparison frame replays exactly')
      replay.dispose()
      assert.equal(JSON.stringify({ health: f.engine.health, body: f.engine.body, root: subjectRoot.position.toArray(),
        game: Reflect.get(f.engine, 'melee'), elapsed: Reflect.get(f.engine, 'elapsed') }), identity)
      states++
    }
  }
  assert.equal(states, 108)
  f.dispose()
})

test('portrait fitting reads actual posed vertices rather than stale bounds or empty anchors', () => {
  const f = fixture()
  const root = f.engine.createCharacter('elf', true)
  const p = [...f.presenters][0]
  const rest = measurePortraitSubject(root)
  p.anatomy.headPivot.rotation.set(-0.22, 0.43, 0.25)
  root.updateMatrixWorld(true)
  const changed = measurePortraitSubject(root)
  assert.notDeepEqual(changed.head, rest.head)
  p.body.boundingBox = new THREE.Box3(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100))
  assert.deepEqual(measurePortraitSubject(root).head, changed.head, 'cached rest-box corruption cannot change the measurement')
  const data = p.body.geometry.getAttribute('position')
  const skin = p.body.geometry.getAttribute('skinIndex')
  const headBone = p.skeleton.bones.findIndex((bone) => bone.name === 'head')
  let target = -1
  for (let i = 0; i < skin.count; i++) if (skin.getX(i) === headBone) { target = i; break }
  assert.ok(target >= 0)
  const old = data.getX(target)
  data.setX(target, old + 1)
  assert.notDeepEqual(measurePortraitSubject(root).head, changed.head, 'a changed rendered vertex must change the fit')
  data.setX(target, old)
  f.dispose()
})

test('actual production stage selects known companion and restores on clear without streaming or simulation', () => {
  const f = fixture()
  f.engine.player = f.engine.createCharacter('guard', true)
  const companion = f.engine.createCharacter('guard', false, 'archer')
  f.engine.actors = [{ id: 'squad:guard:starter:0', mesh: companion, role: 'archer', allegiance: 'guard',
    alive: true, aiMode: 'normal', eventOwnerId: null, squadEligible: true, hostileToPlayer: false, budgetCategory: 'squad',
    hp: 42, action: { phase: 'windup', elapsed: 0.2, duration: 0.5 } }]
  const before = localTransforms(companion)
  f.engine.stageGraphicsFixture({ label: 'STAGED companion', portrait: { ...request('aim'), subject: 'companion-0' } })
  const portrait = f.engine.graphicsCharacterPortrait
  assert.ok(portrait)
  portrait.present(f.engine.camera)
  assert.equal(portrait.snapshot()!.subject.id, 'squad:guard:starter:0')
  assert.throws(() => f.engine.renderLogicalFrame(1 / 60, 'manual'), /zero-simulation/)
  assert.throws(() => f.engine.renderLogicalFrame(0, 'active'), /zero-simulation/)
  let rendered = 0, simulated = 0
  const transientBudget = new TransientEffectBudget()
  const emptyEffect = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
  emptyEffect.visible = false
  Object.assign(f.engine, {
    graphicsDiagnostics: { manual: true, beginFrame() {}, meter: { endUpdate() {} }, endFrame() {} },
    update: () => { simulated++ }, updateCamera() {}, creaturePresenters: new Set(),
    audioListenerRight: new THREE.Vector3(), audio: { setListener() {} }, updateMusicContext() {},
    transientBudget, atmosphereRoot: new THREE.Group(), flames: [],
    telegraphPool: [], finaleTelegraphs: [], projectiles: [],
    lootPickups: [], lootCollectionBursts: [], particles: [], impactRayFx: [],
    damageNumberFx: [], comicCalloutFx: [], decals: [],
    weaponTrail: emptyEffect, rain: emptyEffect, snow: emptyEffect,
    postProcessor: { render: () => {
      rendered++
      assert.equal(f.engine.graphicsCharacterPortrait!.snapshot()!.bounds.measuredVertices,
        measurePortraitSubject(companion).vertices, 'metadata describes the actual geometry after LOD selection')
    } },
  })
  f.engine.renderLogicalFrame(0, 'manual')
  assert.equal(rendered, 1)
  assert.equal(simulated, 0)
  assert.equal(Reflect.get(f.engine, 'paused'), true)
  assert.equal(transientBudget.snapshot().complete, false)
  transientBudget.clear()
  emptyEffect.geometry.dispose()
  emptyEffect.material.dispose()
  f.engine.stageGraphicsFixture({ label: 'clear', portrait: null })
  assert.equal(f.engine.graphicsCharacterPortrait, null)
  assert.deepEqual(localTransforms(companion), before)
  assert.throws(() => f.engine.stageGraphicsFixture({ label: 'missing', portrait: { ...request(), subject: 'companion-2' } }), /absent/)
  assert.throws(() => f.engine.stageGraphicsFixture({ label: 'invalid', portrait: { ...request(), version: 2 as 1 } }), /version/)
  f.engine.graphicsDiagnostics = null
  assert.throws(() => f.engine.stageGraphicsFixture({ label: 'disabled', portrait: request() }), /manual/)
  f.dispose()
})

test('gameplay portrait view preserves the production camera and unsupported/dead poses fail explicitly', () => {
  const f = fixture()
  const root = f.engine.createCharacter('elf', true)
  f.engine.camera.updateMatrixWorld(true)
  const camera = { position: f.engine.camera.position.toArray(), projection: f.engine.camera.projectionMatrix.toArray() }
  const subject: PortraitSubject = { root, id: 'player', role: 'player', faction: 'elf', player: true, alive: true, weapon: 'sabre' }
  const current = new GraphicsCharacterPortrait({ ...request(), view: 'gameplay' }, subject, () => { throw new Error('must not pose current') })
  current.present(f.engine.camera)
  assert.equal(current.snapshot()!.cameraMode, 'production-gameplay')
  assert.deepEqual({ position: f.engine.camera.position.toArray(), projection: f.engine.camera.projectionMatrix.toArray() }, camera)
  current.dispose()
  assert.throws(() => new GraphicsCharacterPortrait(request('aim'), subject, () => {}), /bow/)
  assert.throws(() => new GraphicsCharacterPortrait(request('walk'), { ...subject, alive: false }, () => {}), /dead/)
  const contact: CharacterContact = { point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 'dark' }
  assert.ok([...f.presenters][0].sampleContact('head', contact))
  root.updateMatrixWorld(true)
  const transforms = localTransforms(root)
  const badFrame = new GraphicsCharacterPortrait({
    ...request('walk'), frame: { position: [500, 20, 500], target: [500, 19, 498], fov: 38, near: 0.05, far: 250 },
  }, subject, (target, pose) => f.engine.poseGraphicsPortrait(target, pose))
  assert.throws(() => badFrame.present(f.engine.camera), /not local/)
  assert.deepEqual(localTransforms(root), transforms, 'rejected frame must restore the production pose')
  assert.deepEqual({ position: f.engine.camera.position.toArray(), projection: f.engine.camera.projectionMatrix.toArray() }, camera)
  badFrame.dispose()
  f.dispose()
})

test('first-visual matrix uses finite production presets and rejects mismatched comparison identity', async () => {
  const module = await import(new URL('../scripts/graphics/portraits.mjs', import.meta.url).href)
  let count = 0
  for (const faction of CHARACTER_FACTIONS) {
    const actors = [0, 1, 2].map((i) => ({ id: `squad:${i}`, role: i === 1 ? 'archer' : 'soldier', squad: true }))
    const stages = module.firstVisualPortraitStages(faction, actors)
    assert.equal(stages.length, 11)
    for (const stage of stages) validateGraphicsStage(stage.request)
    count += stages.length
  }
  assert.equal(count, 33)
  assert.throws(() => module.firstVisualPortraitStages('elf', []), /three actual/)
  assert.throws(() => module.firstVisualPortraitStages('elf', [0, 1, 2].map((i) => ({ id: `${i}`, role: 'soldier', squad: true }))), /archer/)
  const save = { updatedAt: 'before', body: { leftArm: 'missing' }, melee: { phaseRemaining: 0.11 } }
  assert.equal(module.portraitSaveIdentity(save), module.portraitSaveIdentity({ ...save, updatedAt: 'after' }))
  assert.notEqual(module.portraitSaveIdentity(save), module.portraitSaveIdentity({ ...save, melee: { phaseRemaining: 0 } }))
  assert.throws(() => module.portraitCameraReference({ complete: false }, 'elf-opening', 'player-front-current', {}, {}), /incomplete/)
  const subject = { id: 'player', role: 'player', faction: 'elf' }
  const conditions = { quality: 'balanced', time: 16.8, weather: 'clear' }
  const cameraFrame = { position: [0, 3, 4], target: [0, 3, 0], fov: 38, near: 0.05, far: 250 }
  const reference = { complete: true, conditions: { portraitComparison: conditions },
    cases: [{ id: 'elf-opening', portraits: [{ id: 'player-front-current', subject,
      cameraMode: 'diagnostic-portrait-override', cameraFrame }] }] }
  assert.deepEqual(module.portraitCameraReference(reference, 'elf-opening', 'player-front-current', conditions, subject), cameraFrame)
  assert.throws(() => module.portraitCameraReference(reference, 'elf-opening', 'player-front-current', { ...conditions, time: 140 }, subject), /different/)
  assert.throws(() => module.portraitCameraReference(reference, 'elf-opening', 'player-front-current', conditions, { ...subject, id: 'npc' }), /mismatched/)
  assert.throws(() => module.portraitCameraReference(reference, 'elf-opening', 'absent', conditions, subject), /absent/)
})

test('first-visual job stays inert by default and executes without a lease while enforcing candidate identity', () => {
  const root = process.cwd()
  const script = new URL('../scripts/graphics-first-visual.mjs', import.meta.url)
  const text = execFileSync(process.execPath, [fileURLToPath(script),
    '--workspace', root, '--out', join(root, 'unused-portrait-test-output')], { encoding: 'utf8' })
  const job = JSON.parse(text)
  assert.equal(job.execute, false)
  assert.equal(job.lease, null)
  assert.equal(job.exclusiveGraphicsWorkerLeaseRequired, false)
  assert.equal(job.worlds, 3)
  assert.equal(job.heldPortraits, 33)
  assert.equal(job.openingFrames, 3)
  assert.ok(job.parameters.includes('--portraits'))
  assert.ok(!job.parameters.includes('--profile'))
  assert.deepEqual(job.expectedMinutes, { minimum: 10, maximum: 15 })
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(script),
    '--workspace', root, '--out', join(root, 'unused-portrait-test-output'), '--execute'],
  { encoding: 'utf8', stdio: 'pipe' }), /--execute requires an exact --expected-commit/)
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(script),
    '--workspace', root, '--out', join(root, 'unused-portrait-test-output'),
    '--execute', '--expected-commit', '0'.repeat(40)],
  { encoding: 'utf8', stdio: 'pipe' }), /Target workspace does not match --expected-commit/,
  'Without a lease, execution reaches the existing runner and still rejects a mismatched immutable candidate before launch')
  assert.equal(existsSync(join(root, 'unused-portrait-test-output')), false)
  const historical = JSON.parse(execFileSync(process.execPath, [fileURLToPath(script),
    '--workspace', root, '--out', join(root, 'unused-portrait-test-output'), '--lease', 'historical-run-label'],
  { encoding: 'utf8' }))
  assert.equal(historical.execute, false)
  assert.equal(historical.lease, 'historical-run-label')
  assert.equal(historical.exclusiveGraphicsWorkerLeaseRequired, false)
  const runner = new URL('../scripts/graphics-run.mjs', import.meta.url)
  const runnerSource = readFileSync(runner, 'utf8')
  assert.match(runnerSource, /No browser lease, GO, HOLD or resource permission is required/)
  assert.match(runnerSource, /exclusiveGraphicsWorkerLeaseRequired: false/)
})
