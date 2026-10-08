import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import type { SquadCommandView } from '../src/game/world/SquadCommand.ts'
import type { SquadResourceView } from '../src/game/world/SquadResource.ts'

const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL) {
      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(new URL(specifier + extension, context.parentURL))) {
          return nextResolve(specifier + extension, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return { format: 'module', shortCircuit: true, source: 'export {}' }
    }
    if (url.endsWith('.tsx')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            jsx: JsxEmit.ReactJSX,
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2022,
          },
        }).outputText,
      }
    }
    return nextLoad(url, context)
  },
})
const { SquadCommandPanel } = await import('../src/game/ui/SquadCommandPanel.tsx')
const { SquadResourceCard } = await import('../src/game/ui/SquadResourceCard.tsx')
loader.deregister()

const command: SquadCommandView = {
  mode: 'follow',
  baseStance: 'follow',
  anchor: null,
  focusTargetId: null,
  targets: [],
  focus: null,
  roster: [
    {
      id: 'near',
      role: 'scout',
      slot: 0,
      health: 20,
      maxHealth: 55,
      distance: 3,
      status: 'following',
    },
    {
      id: 'far',
      role: 'archer',
      slot: 1,
      health: 30,
      maxHealth: 45,
      distance: 15,
      status: 'distant',
    },
    {
      id: 'healthy',
      role: 'scout',
      slot: 2,
      health: 55,
      maxHealth: 55,
      distance: 4,
      status: 'following',
    },
  ],
}

const resource: SquadResourceView = {
  cap: 4,
  rations: 2,
  playerHealth: 75,
  playerMaxHealth: 100,
  treatmentRange: 14,
  casualties: 1,
  pending: 0,
  reinforcements: {
    elfRescue: 0,
    elfDefense: 0,
    guardOrder: 0,
    villainMuster: 0,
    villainPress: 0,
  },
  villainMuster: {
    siteId: 'old-fort',
    regionLabel: 'E5',
    remaining: 1,
    available: true,
  },
}

test('the orders panel names ration stock, chosen care and the distance refusal', () => {
  const html = renderToStaticMarkup(createElement(SquadCommandPanel, {
    view: command,
    resource,
    onClose() {},
    onConfirm: () => true,
    onTreat: () => true,
  }))
  assert.match(html, /Паёк: 2 · рядом до 14 м/)
  assert.match(html, /Паёк \+35 · останется 1/)
  assert.match(html, /Пользователь 75\/100/)
  assert.match(html, /Слишком далеко/)
  assert.match(html, /Здоров/)
  assert.match(html, /aria-label="Паёк \+35 · останется 1: #1 разведчик"/)

  const css = readFileSync(
    new URL('../src/game/ui/squad-command.css', import.meta.url),
    'utf8',
  )
  assert.match(css, /\.squad-command-panel button,[\s\S]*min-height:\s*44px/)
  assert.match(css, /\.squad-treat-button[\s\S]*white-space:\s*nowrap/)
})

test('the last ration warns beside player health, while two rations do not', () => {
  const last = renderToStaticMarkup(createElement(SquadCommandPanel, {
    view: command,
    resource: { ...resource, rations: 1, playerHealth: 42, playerMaxHealth: 100 },
    onClose() {},
    onConfirm: () => true,
    onTreat: () => true,
  }))
  assert.match(last, /Паёк \+35 · последний — себе не останется/)
  assert.match(last, /Пользователь 42\/100/)

  const two = renderToStaticMarkup(createElement(SquadCommandPanel, {
    view: command,
    resource,
    onClose() {},
    onConfirm: () => true,
    onTreat: () => true,
  }))
  assert.doesNotMatch(two, /последний — себе не останется/)
  assert.match(two, /Паёк \+35 · останется 1/)
})

test('the journal shows the old fort only while the villain muster is available', () => {
  const html = renderToStaticMarkup(createElement(SquadResourceCard, {
    faction: 'villain',
    squadSize: 2,
    resource,
    onOpen() {},
  }))
  assert.match(html, /Старый форт, квадрат E5: сбор 1\/1/)
  assert.match(html, /2\/4/)
  assert.match(html, /Приказы и лечение/)

  const spent = renderToStaticMarkup(createElement(SquadResourceCard, {
    faction: 'villain',
    squadSize: 3,
    resource: {
      ...resource,
      villainMuster: { ...resource.villainMuster!, remaining: 0, available: false },
    },
    onOpen() {},
  }))
  assert.doesNotMatch(spent, /Старый форт, квадрат/)
})
