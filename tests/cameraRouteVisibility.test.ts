import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import * as THREE from 'three'
import { StylizedArtLibrary } from '../src/game/art/index.ts'
import { CameraVisibility, CAMERA_CANDIDATE_LIMIT, CAMERA_TRIANGLE_LIMIT, type CameraSweepResult } from '../src/game/cameraVisibility.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

interface RecordedPose {
  player: [number, number, number]
  camera: { position: [number, number, number]; yaw: number; pitch: number }
}
interface RouteRecord {
  id: string
  nativeInput: { before: RecordedPose; after: RecordedPose }
  motion: { frames: { snapshot: RecordedPose }[] }
}
const records: { cases: RouteRecord[] } = JSON.parse(gunzipSync(readFileSync(new URL(
  '../docs/images/gfx-02-evidence/records/02-camera-routes-manifest.json.gz', import.meta.url,
))).toString('utf8'))

function fixture(id: string, truePitch = false) {
  const record = records.cases.find((entry) => entry.id === id)!
  assert.ok(record)
  const art = new StylizedArtLibrary({
    enhanced: true, ink: { player: 0, enemy: 0, interactable: 0, landmark: 0 },
  })
  const scene = new THREE.Scene()
  const world = new GeneratedWorldRuntime(scene, generateWorld(20260906), {
    art, visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'high' }), outlineDressing: true,
  })
  const initial = record.nativeInput.before
  const endpoint = record.motion.frames[0].snapshot
  world.update({ focus: { x: initial.player[0], z: initial.player[2] }, deltaSeconds: 0 })
  scene.updateMatrixWorld(true)
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 240)
  const solver = new CameraVisibility()
  const target = new THREE.Vector3(), desired = new THREE.Vector3(), output = new THREE.Vector3()
  const terrain = (x: number, z: number) => world.sampleHeight(x, z)
  const step = (player: readonly number[], yaw: number, pitch: number, immediate = false) => {
    target.fromArray(player).y += 1.65
    if (truePitch) {
      const orbit = Math.max(0, pitch)
      desired.copy(target).add(new THREE.Vector3(-Math.sin(yaw) * 12 * Math.cos(orbit),
        12 * Math.sin(orbit), Math.cos(yaw) * 12 * Math.cos(orbit)))
    } else desired.copy(target).add(new THREE.Vector3(-Math.sin(yaw) * 10, 5.2 + pitch * 3.5, Math.cos(yaw) * 10))
    world.presentation!.prepare(camera)
    solver.resolve(target, desired, camera, immediate ? 0 : 1 / 60, immediate, world.presentation!, terrain, output,
      truePitch ? yaw : undefined, pitch)
    camera.position.copy(output)
    if (truePitch) camera.lookAt(output.clone().add(new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
    )))
    else camera.lookAt(target)
    camera.updateMatrixWorld()
  }
  // Independent exact-triangle rays, not the solver's own success counters.
  // CPU material clones make the probe two-sided without modifying render or
  // canonical sight materials, and exclude invisible LOD levels.
  const rayMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const blockers: THREE.Mesh[] = []
  scene.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh ||
        StylizedArtLibrary.isOutlineShell(object) || object.userData.cameraPassThrough ||
        object.userData.generatedTerrainRegionId || !StylizedArtLibrary.isOpaque(object.material)) return
    const proxy = new THREE.Mesh(object.geometry, rayMaterial)
    proxy.name = object.name
    proxy.matrixWorld.copy(object.matrixWorld)
    blockers.push(proxy)
  })

  const ray = new THREE.Raycaster()
  const body = new THREE.Vector3()
  const firstBodyHit = (eye: THREE.Vector3, center: THREE.Vector3, yOffset = 0) => {
    body.copy(center).y += yOffset
    ray.set(eye, body.clone().sub(eye).normalize())
    ray.near = 0
    ray.far = eye.distanceTo(body) - 0.001
    return ray.intersectObjects(blockers, false)[0]
  }
  const assertSight = (phase = '', requireAll = true) => {
    let probes = 0
    const occupancy = { distance: 0, blocked: false, overflow: false, triangleTests: 0, initialOverlap: false }
    for (const offset of [-0.45, 0, 0.35]) {
      const point = target.clone()
      point.y += offset
      world.presentation!.sweep(point, point, 0.02, occupancy)
      if (!requireAll && offset !== 0 && occupancy.initialOverlap) continue
      probes++
      const hit = firstBodyHit(output, target, offset)
      assert.ok(hit === undefined, `${phase}: torso sample ${offset} hidden by ${hit?.object.name} at ${hit?.distance}; debug ${JSON.stringify(solver.debug)}`)
    }
    assert.equal(solver.debug.targetProbes, probes)
    assert.equal(solver.debug.visibleTargetProbes, probes)
    assert.equal(solver.debug.overflows, 0)
    assert.ok(solver.debug.candidates <= CAMERA_CANDIDATE_LIMIT)
    assert.ok(solver.debug.sweeps <= 72, `Unexpected query count ${solver.debug.sweeps}`)
    assert.ok(solver.debug.triangleTests <= solver.debug.sweeps * CAMERA_TRIANGLE_LIMIT)
    world.presentation!.sweep(output, output, 0.32, occupancy)
    assert.equal(occupancy.blocked, false)
    assert.ok(output.y >= terrain(output.x, output.z) + 0.32)
  }
  const dispose = () => { world.dispose(); art.dispose(); rayMaterial.dispose() }
  return { record, initial, endpoint, camera, solver, world, target, desired, output, step, terrain, firstBodyHit, assertSight, dispose }
}

test('the captured frozen elf camera remains outside compound site geometry when its sweep direction changes', () => {
  const art = new StylizedArtLibrary({
    enhanced: true, ink: { player: 0, enemy: 0, interactable: 0, landmark: 0 },
  })
  const scene = new THREE.Scene()
  const world = new GeneratedWorldRuntime(scene, generateWorld(4189091098), {
    art, visualPolicy: resolveVisualPolicy({ visualMode: 'enhanced', visualQuality: 'high' }), outlineDressing: true,
  })
  const player = new THREE.Vector3(15.275452955456846, 3.015006832099368, -22.922785243645798)
  const previous = new THREE.Vector3(13.112283928509637, 5.9984239567836415, -23.799412492308186)
  const candidate = new THREE.Vector3(13.7855649102703, 5.765646892632725, -23.69257970593632)
  const camera = new THREE.PerspectiveCamera(56, 0.8477078477078477, 0.1, 240)
  camera.position.copy(previous)
  camera.quaternion.fromArray([-0.15890843893811826, -0.7961773414373347, -0.23715602515975517, 0.5334854906616054])
  camera.updateMatrixWorld()
  const result = (): CameraSweepResult => ({
    distance: 0, blocked: false, overflow: false, triangleTests: 0, initialOverlap: false,
  })
  try {
    world.update({ focus: { x: player.x, z: player.z }, deltaSeconds: 0 })
    scene.updateMatrixWorld(true)
    world.presentation!.prepare(camera)
    const stationary = result(), moving = result()
    world.presentation!.sweep(previous, previous, 0.32, stationary)
    world.presentation!.sweep(previous, candidate, 0.32, moving)
    assert.equal(stationary.initialOverlap, false)
    assert.equal(moving.initialOverlap, false, 'A validated center cannot become inside merely by changing ray direction')
    assert.equal(moving.overflow, false)

    const solver = new CameraVisibility()
    Reflect.set(solver, 'initialized', true)
    Reflect.set(solver, 'shoulderHold', 0.2765666667)
    Reflect.set(solver, 'releaseHold', 0.16)
    for (const key of ['lastSafe', 'follow']) {
      const vector: unknown = Reflect.get(solver, key)
      assert.ok(vector instanceof THREE.Vector3)
      vector.copy(previous)
    }
    const yaw = 2.0476982453848125, pitch = 0.5807999999999993
    const target = player.clone().add(new THREE.Vector3(0, 1.65, 0))
    const desired = target.clone().add(new THREE.Vector3(
      -Math.sin(yaw) * 12 * Math.cos(pitch), 12 * Math.sin(pitch), Math.cos(yaw) * 12 * Math.cos(pitch),
    ))
    const output = new THREE.Vector3()
    assert.doesNotThrow(() => solver.resolve(target, desired, camera, 1 / 60, false,
      world.presentation!, (x, z) => world.sampleHeight(x, z), output, yaw, pitch))
    const final = result()
    world.presentation!.sweep(output, output, 0.32, final)
    assert.equal(final.blocked, false)
    assert.equal(solver.debug.visibleTargetProbes, solver.debug.targetProbes)
  } finally { world.dispose(); art.dispose() }
})

test('true-view routes report constrained framing and recover rather than retaining off-screen endpoints', () => {
  for (const id of ['elf-forest-obstruction', 'guard-riverside-close']) {
    const f = fixture(id, true)
    try {
      let maxSweeps = 0, maxTriangles = 0, constrainedFrames = 0
      // The native route rotates while stationary, then strafes at the final
      // yaw. Simultaneously interpolating yaw and position invents a different
      // camera approach to the roof. These endpoint roots are the ec1d317 run.
      const endpoint = id === 'guard-riverside-close'
        ? [13.41004327541765, 11.88043831962156, -95.37079333601508]
        : [-90.22464004576628, 5.668731126915277, -75.12576403106766]
      for (let frame = 0; frame <= 90; frame++) {
        const move = Math.max(0, Math.min(1, (frame - 22) / 42))
        const player = f.initial.player.map((v, index) => v + (endpoint[index] - v) * move)
        player[1] = f.world.sampleHeight(player[0], player[2])
        const yaw = f.initial.camera.yaw + 0.336 * Math.min(1, frame / 22)
        f.step(player, yaw, f.initial.camera.pitch, frame === 0)
        f.assertSight(`${id} true-view step ${frame}`, false)
        const occupancy = { distance: 0, blocked: false, overflow: false, triangleTests: 0, initialOverlap: false }
        f.world.presentation!.sweep(f.output, f.output, 0.32, occupancy)
        assert.equal(occupancy.blocked, false)
        assert.ok(f.output.y >= f.terrain(f.output.x, f.output.z) + 0.32)
        let outsideMargins = false
        for (const height of [1.1, 1.65, 2.2]) {
          const ndc = new THREE.Vector3().fromArray(player).add(new THREE.Vector3(0, height, 0)).project(f.camera)
          const framed = Math.abs(ndc.x) <= 0.6 && Math.abs(ndc.y) <= 0.82 && Math.abs(ndc.z) < 1
          outsideMargins ||= !framed
          if (id === 'elf-forest-obstruction' || frame === 0 || frame >= 64) assert.ok(framed,
            `${id} frame ${frame} height ${height}: projected body ${ndc.toArray()}; debug ${JSON.stringify(f.solver.debug)}`)
        }
        // A tight wall/roof approach cannot promise full-body third-person
        // framing at fixed aim. Keep independent physical sight assertions,
        // report clipping, and require recovery at every settled endpoint step.
        constrainedFrames += Number(outsideMargins)
        assert.equal(f.solver.debug.framingError > 0, outsideMargins)
        if (!outsideMargins) assert.equal(f.solver.debug.framedTargetProbes, 3)
        assert.equal(f.solver.debug.overflows, 0)
        assert.ok(f.solver.debug.sweeps <= 72)
        maxSweeps = Math.max(maxSweeps, f.solver.debug.sweeps)
        maxTriangles = Math.max(maxTriangles, f.solver.debug.triangleTests)
      }
      console.log(`${id} true-view CPU route: max ${maxSweeps} sweeps/${maxTriangles} triangles; ${constrainedFrames} explicitly reported constrained steps; initial and settled endpoint framed`)
    } finally { f.dispose() }
  }
})

test('the actual recorded riverside roof failure is a negative control, and the next resolved frame restores torso sight', () => {
  const f = fixture('guard-riverside-close')
  try {
    f.step(f.initial.player, f.initial.camera.yaw, f.initial.camera.pitch, true)
    f.assertSight('recorded initial')
    const target = new THREE.Vector3().fromArray(f.endpoint.player).add(new THREE.Vector3(0, 1.65, 0))
    const oldCamera = new THREE.Vector3().fromArray(f.endpoint.camera.position)
    const hit = f.firstBodyHit(oldCamera, target)
    assert.ok(hit?.object.name.startsWith('site-body:site-shop-riverside:shop:'))
    assert.ok(hit.distance > 0.59 && hit.distance < 0.62, 'Reproduce the exact captured roof intersection, not a generic obstacle')
    assert.ok(Math.abs(oldCamera.distanceTo(target) - 7.8098681558566945) < 1e-8)

    // Restore the recorded presentation state, not actor/world state. The solver
    // must reject this camera as a follow anchor even though its volume is clear.
    for (const key of ['lastSafe', 'follow']) {
      const vector: unknown = Reflect.get(f.solver, key)
      assert.ok(vector instanceof THREE.Vector3)
      vector.copy(oldCamera)
    }
    Reflect.set(f.solver, 'shoulder', 3)
    f.step(f.endpoint.player, f.endpoint.camera.yaw, f.endpoint.camera.pitch)
    f.assertSight('recovered recorded endpoint')
    assert.equal(f.solver.debug.visibilityCut, true)
    assert.ok(f.output.distanceTo(target) > 3.6, 'An unobstructed full framing is available at this endpoint')
    console.log(`Recorded riverside endpoint CPU recovery: camera ${f.output.toArray().join(',')}; all3 exact torso rays clear; boom ${f.output.distanceTo(target).toFixed(6)}m`)
    f.solver.constrain(f.target, oldCamera, f.world.presentation!, f.terrain, f.output)
    f.assertSight()
  } finally { f.dispose() }
})

test('the production riverside start-to-end path and scoped shake keep actual torso samples visible', () => {
  const f = fixture('guard-riverside-close')
  try {
    const colliders = f.world.collision.queryBounds(f.world.bounds)
    const fingerprint = f.world.blueprint.fingerprint
    f.step(f.initial.player, f.initial.camera.yaw, f.initial.camera.pitch, true)
    f.assertSight()
    let nearOverlap = false
    let maxSweeps = 0, maxTriangles = 0, cuts = 0
    // Timing is explicitly an interpolated CPU path between recorded positions,
    // not a claim to reproduce every unrecorded original RAF/input timestamp.
    // An upper sample temporarily enters a solid prop along this interpolation;
    // only that embedded sample is excluded, never the actual torso target.
    for (let frame = 1; frame <= 120; frame++) {
      const t = Math.min(1, frame / 90)
      const player = f.initial.player.map((value, index) => value + (f.endpoint.player[index] - value) * t)
      const playerBefore = [...player]
      const yaw = f.initial.camera.yaw + (f.endpoint.camera.yaw - f.initial.camera.yaw) * t
      f.step(player, yaw, f.initial.camera.pitch)
      f.assertSight(`interpolated frame ${frame}`, false)
      nearOverlap ||= f.solver.debug.recovery === 'previous'
      cuts += Number(f.solver.debug.visibilityCut)
      maxSweeps = Math.max(maxSweeps, f.solver.debug.sweeps)
      maxTriangles = Math.max(maxTriangles, f.solver.debug.triangleTests)
      if (frame % 4 === 0) {
        const shaken = f.output.clone().add(new THREE.Vector3(Math.sin(frame) * 0.1, -0.08, Math.cos(frame) * 0.1))
        f.solver.constrain(f.target, shaken, f.world.presentation!, f.terrain, f.output)
        f.assertSight(`shake frame ${frame}`, false)
      }
      assert.deepEqual(player, playerBefore)
    }
    assert.equal(nearOverlap, true, 'Exercise near-wall target-volume overlap during the actual approach')
    assert.ok(cuts > 0, 'Exercise the sight-invalid previous-anchor recovery')
    assert.deepEqual(f.world.collision.queryBounds(f.world.bounds), colliders)
    assert.equal(f.world.blueprint.fingerprint, fingerprint)
    f.assertSight('settled endpoint')
    console.log(`Riverside CPU route: target and all non-embedded torso rays clear; max ${maxSweeps} sweeps/${maxTriangles} triangle tests; ${cuts} visibility cuts; endpoint boom ${f.output.distanceTo(f.target).toFixed(3)}m`)
  } finally { f.dispose() }
})

test('forest route remains visible and restores camera-only instance fades without changing canonical sight', () => {
  const f = fixture('elf-forest-obstruction')
  try {
    const canonical: THREE.Object3D[] = []
    f.world.collectLegacySightSources(canonical)
    const ids = canonical.map((object) => object.id)
    f.step(f.initial.player, f.initial.camera.yaw, f.initial.camera.pitch, true)
    f.assertSight()
    f.world.presentation!.prepare(f.camera)
    f.world.presentation!.updateForeground(f.output, [f.target], 0, true)
    assert.ok(f.world.presentation!.debug.fadedInstances > 0)
    for (let frame = 1; frame <= 90; frame++) {
      const t = frame / 90
      const player = f.initial.player.map((value, index) => value + (f.endpoint.player[index] - value) * t)
      const yaw = f.initial.camera.yaw + (f.endpoint.camera.yaw - f.initial.camera.yaw) * t
      f.step(player, yaw, f.initial.camera.pitch)
      f.assertSight()
      f.world.presentation!.prepare(f.camera)
      f.world.presentation!.updateForeground(f.output, [f.target], 1 / 60, false)
    }
    assert.deepEqual(canonical.map((object) => object.id), ids)
    assert.ok(f.world.presentation!.debug.fadedInstances <= 8)
  } finally { f.dispose() }
})
