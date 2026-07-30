/**
 * Roadmap 1.6 — the run's ruleset fingerprint, which is deliberately *not* the world's.
 *
 * `computeWorldFingerprint` (`world/WorldValidator.ts`) hashes canonical generated-world data
 * only, and `blueprintFingerprint` is the world-identity check that rejects a save written
 * against a different world. Folding a ruleset into it would give two *identical* worlds two
 * different world fingerprints and blur what the validator asserts.
 *
 * So the ruleset gets its own value, and the two answer different questions:
 *
 * - `blueprintFingerprint` — «это тот же мир?»
 * - `rulesetFingerprint` — «это тот же забег?»
 *
 * That separation is what keeps 1.2's copyable seed-and-story block honest: a shared **seed**
 * still means one world, and a shared **seed + ruleset** means one run. Two players on the
 * same seed with different doctrines are comparing the same map and different runs, and the
 * postcard can now say which.
 *
 * Nothing in this file imports the world generator or the validator, and nothing in the world
 * generator or the validator imports this. The separation is structural, not a convention —
 * `tests/doctrines.test.ts` pins it by generating one world twice and asserting the world
 * fingerprints match while the ruleset fingerprints differ.
 */

import { hashString32 } from '../random/seed.ts'
import type { Faction } from '../types.ts'

export interface RunRulesetInput {
  seed: number
  generatorVersion: number
  faction: Faction
  selectedBoonId: string
  /** Equipped doctrine ids. Order does not matter; the fingerprint sorts them. */
  doctrines: readonly string[]
}

/**
 * The canonical string a run's ruleset hashes down to.
 *
 * Exported because a fingerprint nobody can inspect is a fingerprint nobody can debug, and
 * because the test that proves the doctrine set reaches this and not the world hash needs
 * something to point at. Doctrines are sorted and de-duplicated: drafting the same three
 * cards in a different order is the same ruleset.
 */
export function canonicalizeRunRuleset(input: RunRulesetInput): string {
  const doctrines = [...new Set(input.doctrines)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  return [
    `seed=${String(input.seed >>> 0)}`,
    `gen=${String(Math.trunc(input.generatorVersion))}`,
    `faction=${input.faction}`,
    `boon=${input.selectedBoonId}`,
    `doctrines=${doctrines.join('+')}`,
  ].join('|')
}

/** `rs1-…`, so a ruleset fingerprint can never be mistaken for a `wg1-…` world one. */
export function computeRunRulesetFingerprint(input: RunRulesetInput): string {
  const canonical = canonicalizeRunRuleset(input)
  const first = hashString32(canonical)
  const second = hashString32(`korovan-ruleset-v1:${canonical}`)
  return `rs1-${toHex32(first)}${toHex32(second)}`
}

function toHex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}
