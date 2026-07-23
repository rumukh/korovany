import { SITE_PRESENTATIONS } from './registry.ts'
import type { ObjectiveKind, SiteKind } from '../world/worldTypes.ts'

export type RussianCountForms = readonly [one: string, few: string, many: string]

export function formatRussianCount(value: number, forms: RussianCountForms): string {
  const count = Math.max(0, Math.trunc(value))
  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  const form =
    lastTwoDigits >= 11 && lastTwoDigits <= 14
      ? forms[2]
      : lastDigit === 1
        ? forms[0]
        : lastDigit >= 2 && lastDigit <= 4
          ? forms[1]
          : forms[2]
  return `${count} ${form}`
}

export function generatedSiteLabel(kind: SiteKind): string {
  return SITE_PRESENTATIONS[kind].label
}

export function createGeneratedObjectiveText(
  kind: ObjectiveKind,
  siteKind?: SiteKind,
): string {
  if (!siteKind) {
    switch (kind) {
      case 'arrive':
        return 'Добраться до цели'
      case 'interact':
        return 'Осмотреть цель'
      case 'claim':
        return 'Забрать награду'
      case 'defeat':
        return 'Победить врагов у цели'
    }
  }

  const label = generatedSiteLabel(siteKind)
  switch (kind) {
    case 'arrive':
      return `Добраться до точки «${label}»`
    case 'interact':
      return `Осмотреть точку «${label}»`
    case 'claim':
      return `Забрать награду в точке «${label}»`
    case 'defeat':
      return `Победить врагов у точки «${label}»`
  }
}
