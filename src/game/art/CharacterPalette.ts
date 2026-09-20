import type { CharacterPlan } from './CharacterKit.ts'

export type CharacterPaletteInput = Pick<
  CharacterPlan,
  'faction' | 'tint' | 'skinTone' | 'hairTone' | 'armour'
>

export interface CharacterMaterialPalette {
  body: number
  limb: number
  shield: number
  cloak: number
  skin: number
  hair: number
  leather: number
  dark: number
  steel: number
  bone: number
  ink: number
}

type Swatches = readonly [number, number, number, number]

interface FactionSwatches {
  body: Swatches
  limb: number
  shield: number
  cloak: number
  ink: number
}

/**
 * World-space character colours, deliberately independent from UI theme tokens.
 *
 * The faction hues borrow the prop catalogue's green, blue and rose families, but
 * separate cloth, equipment and shield values so a figure does not collapse into
 * one saturated block under the forest's green ambient light.
 */
const FACTION_SWATCHES = {
  elf: {
    body: [0x3f9571, 0x358766, 0x4ba17d, 0x307c5d],
    limb: 0x49372a,
    shield: 0x87ad79,
    cloak: 0x28543b,
    ink: 0x17241d,
  },
  guard: {
    body: [0x4b79b5, 0x456fa8, 0x5483c1, 0x3c669f],
    limb: 0x464e57,
    shield: 0x7792c2,
    cloak: 0x283d67,
    ink: 0x18202b,
  },
  villain: {
    body: [0xc45b76, 0xb74e6a, 0xd36882, 0xaa455f],
    limb: 0x51484c,
    shield: 0xc27689,
    cloak: 0x67273b,
    ink: 0x25181e,
  },
} as const satisfies Record<CharacterPlan['faction'], FactionSwatches>

const CIVIL_CLOTH: Swatches = [0x8f765d, 0x75685a, 0x9b7e56, 0x695a50]
const SKIN_TONES: Swatches = [0xe8bc96, 0xcb8d68, 0xa86749, 0x784735]
const HAIR_TONES: Swatches = [0x6a3f28, 0xb78645, 0x332821, 0x1c1b1d]

export const CHARACTER_SHARED_COLORS = {
  leather: 0x493126,
  dark: 0x24282d,
  steel: 0x9ba4ad,
  bone: 0xd7c6a2,
} as const

export const CHARACTER_INK_COLORS = {
  enemy: 0x24181c,
  interactable: 0x272116,
  landmark: 0x172126,
} as const

function swatch(values: Swatches, index: number): number {
  const finite = Number.isFinite(index) ? Math.floor(index) : 0
  return values[((finite % values.length) + values.length) % values.length]
}

export function characterSkinColor(tone: number): number {
  return swatch(SKIN_TONES, tone)
}

export function characterHairColor(tone: number): number {
  return swatch(HAIR_TONES, tone)
}

export function characterFactionInkColor(faction: CharacterPlan['faction']): number {
  return FACTION_SWATCHES[faction].ink
}

export function resolveCharacterMaterialPalette(
  input: CharacterPaletteInput,
): CharacterMaterialPalette {
  const faction = FACTION_SWATCHES[input.faction]
  const body = input.armour === 'none'
    ? swatch(CIVIL_CLOTH, input.tint)
    : swatch(faction.body, input.tint)

  return {
    body,
    limb: input.armour === 'none' ? body : faction.limb,
    shield: input.armour === 'none' ? body : faction.shield,
    cloak: faction.cloak,
    skin: characterSkinColor(input.skinTone),
    hair: characterHairColor(input.hairTone),
    ...CHARACTER_SHARED_COLORS,
    ink: faction.ink,
  }
}
