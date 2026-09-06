import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { chooseGeneratedInteraction, type GeneratedInteractionInput } from '../src/game/world/GeneratedInteraction.ts'
import { GeneratedWorldRuntime } from '../src/game/world/GeneratedWorldRuntime.ts'
import { generateWorld } from '../src/game/world/WorldGenerator.ts'

const base: GeneratedInteractionInput = {
  site: null, objective: null, sabotage: false, razed: false, caravanDistance: 20,
  supplyCount: 2, health: 30, maxHealth: 100, rationOnBleed: false,
}

test('the engine-used priority permits a ration at a non-actionable landmark across its real six-unit boundary', () => {
  const runtime = new GeneratedWorldRuntime(new THREE.Scene(), generateWorld(20_260_905), { decorationDensity: 0 })
  try {
    const position = runtime.getSitePosition('site-landmark-old-road')
    assert.ok(position)
    for (const offset of [0, 5.99, 6, 6.01, 8]) {
      const site: GeneratedInteractionInput['site'] = runtime.findNearbySite({ x: position.x + offset, z: position.z }, 6) ?? null
      if (offset < 6) assert.equal(site?.id, 'site-landmark-old-road')
      if (offset > 6) assert.notEqual(site?.id, 'site-landmark-old-road')
      assert.equal(chooseGeneratedInteraction({ ...base, site: site ?? null }).kind, 'ration')
      assert.equal(chooseGeneratedInteraction({ ...base, site: site ?? null, rationOnBleed: true }).kind, 'none')
    }
  } finally {
    runtime.dispose()
  }
})

test('events remain the outer engine priority; site, objective, sabotage and caravan decisions do not become rations', () => {
  const shop = { id: 'shop', kind: 'shop' as const }
  assert.equal(chooseGeneratedInteraction({ ...base, site: shop }).kind, 'shop')
  assert.equal(chooseGeneratedInteraction({ ...base, site: shop, razed: true }).kind, 'ruin')
  assert.equal(chooseGeneratedInteraction({ ...base, site: shop, sabotage: true }).kind, 'sabotage')
  assert.equal(chooseGeneratedInteraction({ ...base, site: { id: 'heal', kind: 'recovery' } }).kind, 'recovery')
  assert.equal(chooseGeneratedInteraction({ ...base, site: { id: 'loot', kind: 'treasure' } }).kind, 'treasure')
  for (const site of [null, { id: 'landmark', kind: 'landmark' as const }]) {
    assert.equal(chooseGeneratedInteraction({ ...base, site, caravanDistance: 6.999 }).kind, 'caravan')
    assert.equal(chooseGeneratedInteraction({ ...base, site, caravanDistance: 7 }).kind, 'ration')
  }
  const site = { id: 'mission', kind: 'landmark' as const }
  const objective = { siteId: site.id, kind: 'claim' as const, liveContract: false }
  const action = chooseGeneratedInteraction({ ...base, site, objective })
  assert.equal(action.kind, 'claim')
  assert.equal(action.targetsObjective, true)
  const liveContract = chooseGeneratedInteraction({ ...base, site, objective: { ...objective, liveContract: true } })
  assert.equal(liveContract.kind, 'ration')
  assert.equal(liveContract.targetsObjective, false, 'navigation/E cannot auto-complete a live contract')
})

test('no supplies, full health and iron-ration doctrine all refuse manual consumption', () => {
  for (const change of [{ supplyCount: 0 }, { health: 100 }, { rationOnBleed: true }]) {
    assert.equal(chooseGeneratedInteraction({ ...base, ...change }).kind, 'none')
  }
})
