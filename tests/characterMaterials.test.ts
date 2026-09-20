import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { resolveVisualPolicy } from '../src/game/visualPolicy.ts'
import {
  CHARACTER_FACTIONS,
  CHARACTER_VARIANTS,
  StylizedArtLibrary,
  resolveCharacterPlan,
  type CharacterFaction,
  type CharacterPlan,
} from '../src/game/art/index.ts'
import {
  CHARACTER_INK_COLORS,
  characterFactionInkColor,
  resolveCharacterMaterialPalette,
} from '../src/game/art/CharacterPalette.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context)
  },
})
const { GameEngine } = await import('../src/game/GameEngine.ts')
loader.deregister()

type CharacterMaterialKind =
  | 'characterBodyMaterial'
  | 'characterLimbMaterial'
  | 'characterShieldMaterial'
  | 'characterCloakMaterial'
  | 'characterSkinMaterial'
  | 'characterHairMaterial'
  | 'characterSharedMaterial'

const INK = {
  player: 0x18202b,
  enemy: CHARACTER_INK_COLORS.enemy,
  interactable: CHARACTER_INK_COLORS.interactable,
  landmark: CHARACTER_INK_COLORS.landmark,
} as const

function invokeMaterial(
  target: object,
  method: CharacterMaterialKind,
  value: CharacterPlan | number | 'leather' | 'dark' | 'steel' | 'bone',
): THREE.MeshStandardMaterial {
  return Reflect.apply(
    Reflect.get(target, method) as (argument: typeof value) => THREE.MeshStandardMaterial,
    target,
    [value],
  )
}

function uiPalette(theme: 'light' | 'dark'): Record<string, THREE.Color> {
  const values = theme === 'light'
    ? {
        bg: 0xf7f4ef,
        surface: 0xffffff,
        borderStrong: 0x919191,
        text: 0x242424,
        muted: 0x5c5c5c,
        accent: 0xb11f4b,
        success: 0x16a34a,
        danger: 0xdc2626,
        warning: 0xf59e0b,
        link: 0x0078d4,
      }
    : {
        bg: 0x3d3b3a,
        surface: 0x292929,
        borderStrong: 0x5f5f5f,
        text: 0xdedede,
        muted: 0x919191,
        accent: 0xfd8ea1,
        success: 0x4ade80,
        danger: 0xf87171,
        warning: 0xfbbf24,
        link: 0x4da6ff,
      }
  return Object.fromEntries(
    Object.entries(values).map(([name, color]) => [name, new THREE.Color(color)]),
  )
}

function fixture(theme: 'light' | 'dark' = 'dark'): {
  engine: object
  library: StylizedArtLibrary
} {
  const library = new StylizedArtLibrary({ ink: INK })
  return {
    engine: Object.assign(Object.create(GameEngine.prototype), {
      artLibrary: library,
      visualPolicy: resolveVisualPolicy({ visualMode: 'legacy' }),
      palette: uiPalette(theme),
    }),
    library,
  }
}

function plan(faction: CharacterFaction, tint = 0): CharacterPlan {
  return { ...resolveCharacterPlan(faction, 'soldier', tint % 3), tint }
}

function luminance(material: THREE.MeshStandardMaterial): number {
  return (
    material.color.r * 0.2126 +
    material.color.g * 0.7152 +
    material.color.b * 0.0722
  )
}

function assertFactionHue(
  material: THREE.MeshStandardMaterial,
  faction: CharacterFaction,
  label: string,
): void {
  const { r, g, b } = material.color
  if (faction === 'elf') assert.ok(g > r && g > b, `${label} lost the elf green`)
  else if (faction === 'guard') assert.ok(b > r && b > g, `${label} lost the guard blue`)
  else assert.ok(r > g && r > b, `${label} lost the villain rose`)
}

function acquireEveryCharacterMaterial(engine: object): Map<string, THREE.MeshStandardMaterial> {
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const keep = (material: THREE.MeshStandardMaterial): void => {
    assert.equal(
      StylizedArtLibrary.isLibraryOwned(material),
      true,
      `${material.name} escaped shared-library ownership`,
    )
    const existing = materials.get(material.name)
    if (existing) assert.equal(existing, material, `${material.name} was cloned instead of shared`)
    materials.set(material.name, material)
  }

  for (const faction of CHARACTER_FACTIONS) {
    for (let tint = 0; tint < CHARACTER_VARIANTS; tint += 1) {
      keep(invokeMaterial(engine, 'characterBodyMaterial', plan(faction, tint)))
    }
    const value = plan(faction)
    keep(invokeMaterial(engine, 'characterLimbMaterial', value))
    keep(invokeMaterial(engine, 'characterShieldMaterial', value))
    keep(invokeMaterial(engine, 'characterCloakMaterial', value))
  }

  const civil = resolveCharacterPlan('elf', 'peasant', 0)
  for (let tint = 0; tint < CHARACTER_VARIANTS; tint += 1) {
    keep(invokeMaterial(engine, 'characterBodyMaterial', { ...civil, tint }))
  }
  for (let tone = 0; tone < 4; tone += 1) {
    keep(invokeMaterial(engine, 'characterSkinMaterial', tone))
    keep(invokeMaterial(engine, 'characterHairMaterial', tone))
  }
  for (const kind of ['leather', 'dark', 'steel', 'bone'] as const) {
    keep(invokeMaterial(engine, 'characterSharedMaterial', kind))
  }
  return materials
}

test('production character materials form a warm, neutral three-value silhouette', () => {
  const { engine, library } = fixture()
  try {
    const dark = invokeMaterial(engine, 'characterSharedMaterial', 'dark')
    const leather = invokeMaterial(engine, 'characterSharedMaterial', 'leather')
    const steel = invokeMaterial(engine, 'characterSharedMaterial', 'steel')
    assert.equal(dark.userData.stylizedSurfacePreset, 'dark')
    assert.equal(leather.userData.stylizedSurfacePreset, 'leather')
    assert.equal(steel.userData.stylizedSurfacePreset, 'metal')
    assert.ok(luminance(dark) < luminance(leather), 'boots must stay darker than leather')
    assert.ok(luminance(dark) < luminance(steel), 'dark gear must stay darker than steel')
    assert.ok(
      Math.max(steel.color.r, steel.color.g, steel.color.b) -
        Math.min(steel.color.r, steel.color.g, steel.color.b) < 0.1,
      'steel drifted into a faction or UI-theme hue',
    )

    const familyColors = new Set([dark.color.getHex(), leather.color.getHex(), steel.color.getHex()])
    for (let tone = 0; tone < 4; tone += 1) {
      const skin = invokeMaterial(engine, 'characterSkinMaterial', tone)
      const hair = invokeMaterial(engine, 'characterHairMaterial', tone)
      assert.equal(skin.userData.stylizedSurfacePreset, 'skin')
      assert.ok(luminance(dark) < luminance(skin), `skin ${String(tone)} fell into boot value`)
      assert.ok(
        skin.color.r > skin.color.g && skin.color.g > skin.color.b,
        `skin ${String(tone)} is not a warm natural tone`,
      )
      familyColors.add(skin.color.getHex())
      familyColors.add(hair.color.getHex())
    }
    assert.equal(familyColors.size, 11, 'skin, hair, leather, steel and dark collapsed together')

    const expectedSurfaces = {
      elf: { body: 'cloth', limb: 'leather', shield: 'bark' },
      guard: { body: 'metal', limb: 'metal', shield: 'metal' },
      villain: { body: 'leather', limb: 'metal', shield: 'metal' },
    } as const
    for (const faction of CHARACTER_FACTIONS) {
      for (let tint = 0; tint < 4; tint += 1) {
        const value = plan(faction, tint)
        const body = invokeMaterial(engine, 'characterBodyMaterial', value)
        const limb = invokeMaterial(engine, 'characterLimbMaterial', value)
        const shield = invokeMaterial(engine, 'characterShieldMaterial', value)
        const cloak = invokeMaterial(engine, 'characterCloakMaterial', value)
        assert.ok(luminance(limb) < luminance(body), `${faction}/${String(tint)} limbs are not the low value`)
        assert.ok(luminance(body) < luminance(shield), `${faction}/${String(tint)} shield is not the high value`)
        assert.equal(new Set([body.color.getHex(), limb.color.getHex(), shield.color.getHex(), cloak.color.getHex()]).size, 4)
        assert.equal(body.userData.stylizedSurfacePreset, expectedSurfaces[faction].body)
        assert.equal(limb.userData.stylizedSurfacePreset, expectedSurfaces[faction].limb)
        assert.equal(shield.userData.stylizedSurfacePreset, expectedSurfaces[faction].shield)
        assert.equal(cloak.userData.stylizedSurfacePreset, 'cloth')
        for (const [label, material] of [['body', body], ['shield', shield], ['cloak', cloak]] as const) {
          assertFactionHue(material, faction, `${faction} ${label}`)
        }
      }
    }
  } finally {
    library.dispose()
  }
})

test('production character colours do not inherit the light or dark UI theme', () => {
  const light = fixture('light')
  const dark = fixture('dark')
  try {
    const signature = (materials: Map<string, THREE.MeshStandardMaterial>) =>
      [...materials].sort(([left], [right]) => left.localeCompare(right)).map(([key, material]) => ({
        key,
        color: material.color.getHex(),
        emissive: material.emissive.getHex(),
        surface: material.userData.stylizedSurfacePreset,
      }))
    assert.deepEqual(
      signature(acquireEveryCharacterMaterial(light.engine)),
      signature(acquireEveryCharacterMaterial(dark.engine)),
    )
  } finally {
    light.library.dispose()
    dark.library.dispose()
  }
})

test('character material keys retain shared identities and the existing count bound', () => {
  const { engine, library } = fixture()
  try {
    const first = acquireEveryCharacterMaterial(engine)
    const expected =
      (CHARACTER_FACTIONS.length + 1) * CHARACTER_VARIANTS +
      CHARACTER_FACTIONS.length * 3 +
      4 * 3
    assert.equal(first.size, expected)
    assert.equal(library.sharedMaterialCount, expected)

    const second = acquireEveryCharacterMaterial(engine)
    assert.equal(library.sharedMaterialCount, expected, 'a second actor sweep allocated materials')
    for (const [key, material] of first) assert.equal(second.get(key), material, key)

    const civilElf = { ...resolveCharacterPlan('elf', 'peasant', 0), tint: 2 }
    const civilGuard = { ...resolveCharacterPlan('guard', 'peasant', 0), tint: 2 }
    assert.equal(
      invokeMaterial(engine, 'characterBodyMaterial', civilElf),
      invokeMaterial(engine, 'characterBodyMaterial', civilGuard),
      'the faction-neutral civil cache key must remain honest',
    )
    assert.equal(
      invokeMaterial(engine, 'characterShieldMaterial', civilElf),
      invokeMaterial(engine, 'characterBodyMaterial', civilElf),
      'an unarmoured offhand must keep borrowing the civil body material',
    )
  } finally {
    library.dispose()
  }
})

test('the palette helper is deterministic and keeps ink dark with only a faction cast', () => {
  for (const faction of CHARACTER_FACTIONS) {
    const input = {
      ...plan(faction, 3),
      skinTone: 3,
      hairTone: 3,
    }
    assert.deepEqual(
      resolveCharacterMaterialPalette(input),
      resolveCharacterMaterialPalette(input),
    )
    const ink = new THREE.MeshStandardMaterial({ color: characterFactionInkColor(faction) })
    assert.ok(luminance(ink) < 0.025, `${faction} ink is a fill colour rather than an outline`)
    assertFactionHue(ink, faction, `${faction} ink`)
    ink.dispose()
  }
})
