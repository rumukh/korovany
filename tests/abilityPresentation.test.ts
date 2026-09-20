import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { GeometryCache, StylizedArtLibrary, characterPresenter, type CharacterPresenter } from '../src/game/art/index.ts'
import { createMeleePresentation } from '../src/game/art/MeleePresentation.ts'
import { ABILITY_INFO, createHealthyBody } from '../src/game/types.ts'
import { createPlayerMeleeState } from '../src/game/world/CombatResolver.ts'
import { createCombatMasteryState } from '../src/game/world/CombatMastery.ts'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

function invoke<T>(target: object, method: string, ...args: unknown[]): T {
  return Reflect.apply(Reflect.get(target, method) as (...values: unknown[]) => T, target, args)
}

function fixture(mode: 'legacy' | 'enhanced') {
  const library = new StylizedArtLibrary({
    enhanced: mode === 'enhanced',
    ink: { player: 0x18202b, enemy: 0x24181c, interactable: 0x272116, landmark: 0x172126 },
  })
  const cache = new GeometryCache()
  const melee = createPlayerMeleeState()
  const pose = { ...createMeleePresentation(), stride: 0, flinch: 0, stagger: 0 }
  const presenters = new Set<CharacterPresenter>()
  const engine = Object.assign(Object.create(GameEngine.prototype), {
    faction: 'guard', artLibrary: library, artGeometry: cache, handOffset: new THREE.Vector3(),
    visualPolicy: resolveVisualPolicy({ visualMode: mode }), characterPresenters: presenters,
    elapsed: 0, playerPose: pose, melee, body: createHealthyBody(),
    combatMastery: createCombatMasteryState(), honestMelee: true,
    cameraPitch: 0, cameraYaw: 0, abilityCooldown: 0, shieldActive: false,
    isSprinting: false, reducedMotion: false, activePlayerAttackKind: 'melee', attackAnimation: 0,
  })
  const player = invoke<THREE.Group>(engine, 'createCharacter', 'guard', true)
  engine.player = player
  const joint = (name: string) => {
    const part = player.getObjectByName(name)
    assert.ok(part, `production rig must contain ${name}`)
    return part
  }
  const draw = (stride = 0) => {
    invoke(engine, 'samplePlayerPose', stride)
    invoke(engine, 'animateCharacter', player, pose)
    characterPresenter(player)?.poseSupport(Math.max(pose.anticipation, pose.attack * 0.8))
    player.updateMatrixWorld(true)
  }
  return { engine, player, joint, melee, pose, library, cache, draw,
    dispose: () => { for (const presenter of presenters) presenter.dispose(); cache.dispose(); library.dispose() } }
}

for (const mode of ['legacy', 'enhanced'] as const) {
  test(`${mode} guard keeps its shield braced through movement and melee`, () => {
    const value = fixture(mode)
    try {
      value.engine.shieldActive = true
      const shield = value.joint('shield')
      const arm = value.joint('leftArm')
      const keys = value.cache.size
      const materials = value.library.sharedMaterialCount
      for (const stride of [0, 0.62, -0.62]) {
        value.draw(stride)
        assert.ok(arm.rotation.x < -1)
        assert.ok(value.joint('leftElbow').rotation.x > 1)
        assert.ok(shield.position.z > 0.6)
      }
      Object.assign(value.melee, { phase: 'windup', beat: 1, phaseRemaining: 0.04 })
      value.draw()
      assert.ok(arm.rotation.x < -1, 'the sword arm must not steal the shield arm pose')
      assert.equal(value.cache.size, keys)
      assert.equal(value.library.sharedMaterialCount, materials)
      Object.assign(value.melee, createPlayerMeleeState())
      invoke(value.engine, 'dropShield')
      assert.equal(arm.rotation.x, 0, 'releasing guard settles the arm even while paused')
      assert.equal(shield.position.z, 0.08)
      assert.equal(value.engine.abilityCooldown, ABILITY_INFO.guard.cooldownMax)
    } finally {
      value.dispose()
    }
  })
}
