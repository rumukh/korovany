import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIRST_VISUAL_CASES, FIRST_VISUAL_ESTIMATED_MINUTES } from './graphics/portraits.mjs'

// Dry by default. Execution still needs the coordinator's separate, current GPU window.
const args = process.argv.slice(2)
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`)
  return args[i + 1]
}
const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = value('workspace', process.env.GRAPHICS_WORKSPACE ?? toolRoot)
const output = value('out', process.env.GRAPHICS_OUTPUT)
if (!isAbsolute(workspace) || !output || !isAbsolute(output)) throw new Error('Absolute --workspace and --out are required')
const parameters = [
  join(toolRoot, 'scripts', 'graphics-run.mjs'), '--workspace', workspace, '--out', output,
  '--portraits', '--cases', FIRST_VISUAL_CASES.join(','), '--visual-mode', 'enhanced',
  '--quality', 'balanced', '--repeat', '1', '--width', '1920', '--height', '1080', '--dpr', '1',
]
for (const name of ['chrome', 'portrait-reference', 'expected-commit']) {
  const option = value(name)
  if (option) parameters.push(`--${name}`, option)
}
const execute = args.includes('--execute')
const lease = value('lease')
if (execute && (!lease || lease.length > 160)) throw new Error('--execute requires the current coordinator-issued --lease identifier')
console.log(JSON.stringify({
  kind: 'GFX-03 finite first-visual job', execute, lease: lease ?? null, workspace, output,
  executable: process.execPath, parameters, expectedMinutes: FIRST_VISUAL_ESTIMATED_MINUTES,
  worlds: 3, heldPortraits: 33, openingFrames: 3,
  matrix: 'Per faction: player and companion-0 front/three-quarter/profile, normal gameplay, walk, windup, contact, plus guard or actual companion archer aim.',
  prerequisite: 'Build the authoritative integrated worktree with the approved affine-normal correction first. Obtain a fresh serialized browser/GPU window. A --lease string is provenance, not acquisition or proof of availability.',
  exclusions: 'No profiling, simulation steps, natural-play claim, baseline corpus rerun, image-generation service or visual approval.',
}, null, 2))
if (execute) {
  const child = spawn(process.execPath, parameters, { cwd: workspace, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, GRAPHICS_CAPTURE_LEASE: lease } })
  child.once('error', (error) => { console.error(error); process.exitCode = 1 })
  child.once('exit', (code, signal) => {
    if (signal) console.error(`First-visual runner terminated by ${signal}`)
    process.exitCode = code ?? 1
  })
}
