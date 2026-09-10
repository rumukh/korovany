import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { cpus, platform, release, totalmem } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { GraphicsBrowser, delay } from './graphics/cdp.mjs'
import { GRAPHICS_SEED, fixtureStage, selectGraphicsFixtures } from './graphics/fixtures.mjs'
import { compareGraphicsPng } from './graphics/png.mjs'
import {
  FIRST_VISUAL_CASES, firstVisualPortraitStages, portraitSaveIdentity, portraitSimulationIdentity, portraitCameraReference,
} from './graphics/portraits.mjs'
import { assertCaptureDeadline, captureRuntimeControls, recordedRiverEndpoint } from './graphics/runtime-controls.mjs'

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const cpuBusyPercent = (before, after) => {
  let busy = 0
  let total = 0
  for (let index = 0; index < Math.min(before.length, after.length); index++) {
    for (const key of Object.keys(before[index].times)) {
      const delta = after[index].times[key] - before[index].times[key]
      total += delta
      if (key !== 'idle') busy += delta
    }
  }
  return total > 0 ? busy / total * 100 : null
}
const simulationIdentity = (snapshot) => JSON.stringify({
  elapsed: snapshot.runtime.elapsed, health: snapshot.runtime.health, npcCount: snapshot.runtime.npcCount,
  rng: snapshot.runtime.rngStates, weather: snapshot.runtime.simulationWeather,
})
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`)
  return value
}
const workspace = option('workspace', process.env.GRAPHICS_WORKSPACE ?? toolRoot)
if (!isAbsolute(workspace)) throw new Error('--workspace / GRAPHICS_WORKSPACE must be absolute')
const root = resolve(workspace)
const checkTime = () => assertCaptureDeadline(process.env.GFX_BROWSER_DEADLINE_UTC)
if (flag('help')) {
  console.log('node scripts\\graphics-run.mjs --out ABSOLUTE_DIRECTORY [--chrome PATH] [--cases all|id,id] [--profile] [--timing-only] [--warmup 120] [--frames 300] [--repeat 2] [--width 1920 --height 1080 --dpr 1] [--visual-mode legacy|enhanced] [--quality high|balanced|low] [--no-post] [--no-aa] [--no-ink] [--no-weather] [--reduced-motion] [--foundation] [--motion] [--native-route] [--lifecycle] [--headed]')
  console.log('Requires npm run build. A dedicated loopback server and disposable Chrome profile are owned and stopped by this command. Mobile dimensions are layout evidence, not a mobile-device benchmark.')
  console.log('First visual: --portraits [--workspace ABSOLUTE_WORKTREE] [--portrait-reference MANIFEST_JSON]. Three opening worlds, held production portrait presets and normal gameplay views; incompatible with --profile/--motion/--native-route/--foundation/--lifecycle. No GPU authorization is implied.')
  console.log('Joined preview: --portrait-smoke with --portraits captures only the fixed player/front/current stage. --runtime-controls checks held same-engine resize/DPR/bloom toggles. --hud-mode full|compact selects existing DOM preference. --recorded-river-endpoint stages the preserved river player/yaw/pitch, never a camera override.')
  process.exit(0)
}
const output = option('out')
if (!output || !isAbsolute(output)) throw new Error('--out must be an absolute artifact directory')
const out = resolve(output)
const chrome = option('chrome', process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
const width = Number(option('width', '1920'))
const height = Number(option('height', '1080'))
const dpr = Number(option('dpr', '1'))
const repeat = Number(option('repeat', flag('portraits') ? '1' : '2'))
const warmupFrames = Number(option('warmup', '120'))
const sampleFrames = Number(option('frames', '300'))
const visualMode = option('visual-mode', 'legacy')
const quality = option('quality', 'high')
const hudMode = option('hud-mode', 'full')
if (!['full', 'compact'].includes(hudMode)) throw new Error('Invalid HUD mode')
if (!['legacy', 'enhanced'].includes(visualMode) || !['high', 'balanced', 'low'].includes(quality)) throw new Error('Invalid visual policy selection')
if ((flag('no-aa') || flag('foundation')) && visualMode !== 'enhanced') throw new Error('Foundation/AA comparison requires explicit enhanced preview')
for (const [name, value, min, max] of [['width', width, 320, 7680], ['height', height, 320, 4320],
  ['repeat', repeat, 1, 5], ['warmup', warmupFrames, 1, 3600], ['frames', sampleFrames, 1, 7200]]) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid --${name}`)
}
if (!Number.isFinite(dpr) || dpr < 0.5 || dpr > 3) throw new Error('Invalid --dpr')
if (flag('native-route') && !flag('profile')) throw new Error('--native-route requires --profile')
if (flag('timing-only') && !flag('profile')) throw new Error('--timing-only requires --profile')
if (flag('portraits') && ['profile', 'motion', 'native-route', 'foundation', 'lifecycle', 'timing-only'].some(flag)) {
  throw new Error('Portrait suite is held presentation only; do not combine it with gameplay/profiling/foundation jobs')
}
if (flag('portraits') && repeat !== 1) throw new Error('First portrait suite uses one launch per faction; use a new output for a repeat')
if (flag('portrait-smoke') && !flag('portraits')) throw new Error('--portrait-smoke requires --portraits')
if (flag('runtime-controls') && (visualMode !== 'enhanced' ||
    ['portraits', 'profile', 'motion', 'native-route', 'foundation', 'lifecycle', 'no-aa'].some(flag))) {
  throw new Error('Runtime controls require ordinary enhanced held fixtures without other diagnostic stages')
}
const referencePath = option('portrait-reference')
if (referencePath && (!flag('portraits') || !isAbsolute(referencePath))) throw new Error('--portrait-reference needs --portraits and an absolute manifest path')
const referenceBytes = referencePath ? await readFile(referencePath) : null
const portraitReference = referenceBytes ? JSON.parse(referenceBytes.toString('utf8')) : null
const expectedCommit = option('expected-commit')
const runtimeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (expectedCommit && (!/^[a-f0-9]{40}$/.test(expectedCommit) || expectedCommit !== runtimeCommit)) {
  throw new Error('Target workspace does not match --expected-commit')
}
const fixtures = selectGraphicsFixtures(option('cases', flag('portraits') ? FIRST_VISUAL_CASES.join(',') : 'all'))
  .map((fixture) => flag('portraits') ? {
    ...fixture, time: 16.8, weather: 'clear',
    description: `STAGED ${fixture.faction} first-visual opening, shared clear presentation light at t=16.8; actual player and companions, no relocation.`,
  } : fixture)
if (flag('portraits') && fixtures.some((fixture) => !FIRST_VISUAL_CASES.includes(fixture.id))) {
  throw new Error('Portrait suite accepts only the three production faction openings')
}
if (flag('recorded-river-endpoint') && (fixtures.length !== 1 || fixtures[0].id !== 'guard-riverside-close' ||
    ['portraits', 'foundation', 'native-route'].some(flag))) {
  throw new Error('Recorded endpoint requires only the riverside fixture, without portrait/foundation/native restaging')
}
const endpointFile = join(root, 'docs', 'images', 'gfx-02-evidence', 'records', '02-camera-routes-manifest.json.gz')
const endpointBytes = flag('recorded-river-endpoint') ? await readFile(endpointFile) : null
const endpointStage = endpointBytes ? recordedRiverEndpoint(JSON.parse(gunzipSync(endpointBytes).toString('utf8'))) : null
checkTime()
await access(join(root, 'dist', 'index.html'))
await access(chrome)
await mkdir(out, { recursive: true })
try {
  await access(join(out, 'manifest.json'))
  throw new Error('Refusing to overwrite an existing graphics run; use a fresh --out directory')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const reference = JSON.parse(await readFile(join(root, 'docs', 'images', 'graphics-review', 'capture-manifest.json'), 'utf8'))
const serverSocket = createServer()
await new Promise((resolvePort, reject) => {
  serverSocket.once('error', reject)
  serverSocket.listen(0, '127.0.0.1', resolvePort)
})
const address = serverSocket.address()
if (!address || typeof address === 'string') throw new Error('Could not reserve a loopback server port')
const port = address.port
await new Promise((resolvePort, reject) => serverSocket.close((error) => error ? reject(error) : resolvePort()))
const origin = `http://127.0.0.1:${port}`
const profile = await mkdtemp(join(out, 'chrome-profile-'))
const chromeFlags = [
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only',
  '--mute-audio', `--window-size=${width},${height}`,
  ...(flag('headed') ? [] : ['--headless=new']), 'about:blank',
]
const children = []
const processLogs = []
let browser
const runErrors = []
const manifest = {
  schemaVersion: 1, startedAt: new Date().toISOString(),
  runtimeCommit,
  dirtyTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  runtimeBaseline: reference.baselineCommit,
  workspace: root,
  tooling: { workspace: toolRoot, runnerSha256: sha256(await readFile(fileURLToPath(import.meta.url))) },
  buildSha256: sha256(await readFile(join(root, 'dist', 'index.html'))),
  host: { platform: platform(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalProcessors: cpus().length,
    memoryBytes: totalmem(), node: process.version },
  conditions: {
    viewport: { width, height, dpr, mobileEmulation: false }, chrome, chromeFlags, serverOrigin: origin,
    dedicatedBrowserProfile: true, exclusiveGraphicsWorkerLeaseRequired: true,
    declaredGraphicsLease: process.env.GRAPHICS_CAPTURE_LEASE ?? null,
    wholeComputerIsolated: false, cpuThrottling: false, gpuBackendForced: false,
    unsupportedHardware: ['No real mobile device benchmark', 'No integrated GPU device benchmark'],
    capture: 'Manual production rendering of real worlds/checkpoints with explicitly staged prerequisites. No full-game CPU claim from capture frames.',
    repeatTolerance: { maxChangedPixels: 16, maxChannelDelta: 2 },
    profile: 'Active production requestAnimationFrame updates; default 0.05 s simulation clamp and hit stop unchanged. Warm-up and samples separate; no per-frame screenshot/readback.',
    memory: 'Observed WebGL storage bytes, not measured resident VRAM. Default framebuffer, implicit extension MSAA and driver/swapchain exclusions separately reported.',
    requestedVisualMode: visualMode, requestedQuality: quality, diagnosticNoAA: flag('no-aa'),
    hudMode, portraitSmoke: flag('portrait-smoke'), runtimeControls: flag('runtime-controls'),
    recordedEndpoint: endpointBytes ? { file: endpointFile, sha256: sha256(endpointBytes), sourceCommit: 'bfae58b34a411ab434d387e6710fd97be6b2acb3' } : null,
    foundationFixture: flag('foundation'), reducedMotion: flag('reduced-motion'),
    portraitComparison: flag('portraits') ? {
      version: 1, width, height, dpr, visualMode, quality, time: 16.8, weather: 'clear', seed: GRAPHICS_SEED,
      bloom: !flag('no-post'), aa: !flag('no-aa'), ink: !flag('no-ink'), precipitation: !flag('no-weather'), hudMode,
      reducedMotion: flag('reduced-motion'),
    } : null,
    portraitReference: referencePath ?? null,
    portraitReferenceSha256: referenceBytes ? sha256(referenceBytes) : null,
  },
  cases: [], complete: false,
}

function startOwned(executable, parameters, name) {
  const child = spawn(executable, parameters, { cwd: root, windowsHide: !flag('headed'), stdio: ['ignore', 'pipe', 'pipe'] })
  const entry = { child, name, exited: false, error: null }
  child.once('error', (error) => { entry.error = error })
  child.once('exit', () => { entry.exited = true })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes) => {
    if (processLogs.length < 1000) processLogs.push({ process: name, text: bytes.toString().slice(0, 4000) })
  })
  children.push(entry)
  return entry
}

async function waitStartup(test, entry) {
  const deadline = performance.now() + 30000
  while (performance.now() < deadline) {
    if (entry.error) throw entry.error
    if (entry.exited) throw new Error(`${entry.name} exited before becoming responsive: ${JSON.stringify(processLogs.slice(-5))}`)
    if (await test()) return
    await delay(100)
  }
  throw new Error(`${entry.name} did not become responsive`)
}

async function launchFixture(fixture) {
  checkTime()
  browser.events.length = 0
  const storage = fixture.save
    ? JSON.parse(await readFile(join(root, 'scripts', 'graphics', 'saves', fixture.save), 'utf8')) : {}
  const preferences = {
    'korovany-theme': 'dark', 'korovany-music-muted': 'true', 'korovany-sfx-volume': '0',
    'korovany-bloom': String(!flag('no-post')), 'korovany-ink-outlines': String(!flag('no-ink')),
    'korovany-weather': String(!flag('no-weather')), 'korovany-foliage': 'high', 'korovany-dynamic-day-night': 'true',
    'korovany-screen-shake': 'true',
    'korovany-visual-preferences': JSON.stringify({ version: 1, visualMode, visualQuality: quality, hudMode }),
  }
  await browser.send('Page.navigate', { url: origin })
  await browser.waitFor(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`)
  await browser.evaluate(`(() => {
    localStorage.clear();
    for (const [key,value] of Object.entries(${JSON.stringify({ ...storage, ...preferences })})) localStorage.setItem(key,value);
  })()`)
  const query = new URLSearchParams({
    graphicsDiagnostics: '1', visualSeed: String(GRAPHICS_SEED), visualTime: String(fixture.time), visualWeather: fixture.weather,
  })
  await browser.send('Page.navigate', { url: `${origin}/?${query}` })
  await browser.waitFor(`!!document.querySelector(${JSON.stringify(fixture.save ? '.active-run-actions .primary-button' : '#world-seed')})`)
  if (fixture.save) await browser.clickSelector('.active-run-actions .primary-button')
  else {
    await browser.type('#world-seed', String(GRAPHICS_SEED))
    await browser.clickSelector(`.faction-card.${fixture.faction} button`)
  }
  await browser.waitFor('!!window.__korovanyGraphics', 60000)
  const before = await browser.evaluate('window.__korovanyGraphics.snapshot()')
  const world = await browser.evaluate('window.__korovanyGraphics.world()')
  const stage = fixtureStage(fixture, world, reference, before)
  if (endpointStage) Object.assign(stage, endpointStage)
  if (flag('foundation')) stage.foundation = true
  if (flag('no-aa')) stage.antialiasing = 'none'
  if (flag('foundation') || flag('no-aa')) stage.label =
    `${fixture.id}: explicit enhanced ${flag('foundation') ? 'procedural skin/wind/ink/depth fixture' : ''} ${flag('no-aa') ? 'post-AA disabled comparison' : ''}; original gameplay stats unchanged.`
  await browser.evaluate(`window.__korovanyGraphics.stage(${JSON.stringify(stage)})`)
  if (fixture.target) {
    const candidates = []
    for (let index = 0; index < 120; index++) {
      const radius = index === 0 ? 0 : 1.5 + Math.floor(index / 12) * 1.5
      const angle = index * 2.399963229728653
      candidates.push({
        x: stage.player.x + Math.cos(angle) * radius,
        z: stage.player.z + Math.sin(angle) * radius,
      })
    }
    const probes = await browser.evaluate(`window.__korovanyGraphics.probe(${JSON.stringify(candidates)})`)
    const selected = []
    for (const probe of probes) {
      if (!probe.walkable || selected.some((point) => Math.hypot(point.x - probe.x, point.z - probe.z) < 2.2)) continue
      selected.push({ x: probe.x, y: probe.y, z: probe.z })
      if (selected.length === 4) break
    }
    if (selected.length !== 4) throw new Error(`No terrain-valid subject layout for ${fixture.id}`)
    stage.player = selected[0]
    stage.companions.forEach((entry, index) => { entry.position = selected[index + 1] })
    stage.label = `${fixture.id}: staged subject heights and clearance resolved with production terrain/collision queries in the loaded target neighborhood.`
    await browser.evaluate(`window.__korovanyGraphics.stage(${JSON.stringify(stage)})`)
  }
  const staged = await browser.evaluate('window.__korovanyGraphics.snapshot()')
  const cold = await browser.evaluate('window.__korovanyGraphics.render(1)')
  await browser.evaluate('window.__korovanyGraphics.render(30)')
  const afterRenders = await browser.evaluate('window.__korovanyGraphics.snapshot()')
  if (simulationIdentity(staged) !== simulationIdentity(afterRenders)) {
    throw new Error(`Manual presentation mutated simulation identity in ${fixture.id}`)
  }
  await browser.waitFor('document.querySelectorAll(".notice-stack .notice").length === 0', 15000)
  await browser.evaluate(`(() => {
    window.__graphicsCaptureAnimations = document.getAnimations().filter(animation => animation.playState === 'running');
    for (const animation of window.__graphicsCaptureAnimations) { animation.pause(); animation.currentTime = 1000; }
    const label = document.createElement('div');
    label.id='graphics-fixture-label';
    label.textContent=${JSON.stringify(`STAGED FIXTURE: ${fixture.id} | world ${GRAPHICS_SEED} | visual t=${fixture.time}s ${fixture.weather}`)};
    label.style.cssText='position:fixed;left:12px;bottom:6px;z-index:10000;max-width:calc(100vw - 24px);padding:4px 8px;background:#111;color:#fff;font:12px monospace;pointer-events:none';
    document.body.append(label);
  })()`)
  return { before, stage, cold, manualRenderingPreservedSimulation: true }
}

async function capturePortraitSuite(fixture, result) {
  const capability = await browser.evaluate('window.__korovanyGraphics.capabilities?.characterPortrait')
  if (capability !== 1) throw new Error('Target build lacks the version-1 character portrait stage; rebuild the integrated source')
  const before = await browser.evaluate('window.__korovanyGraphics.snapshot()')
  const identity = portraitSimulationIdentity(before)
  const saveIdentity = portraitSaveIdentity(await browser.evaluate('window.__korovanyGraphics.save()'))
  const allStages = firstVisualPortraitStages(fixture.faction, before.runtime.actors)
  const stages = flag('portrait-smoke') ? allStages.slice(0, 1) : allStages
  const companions = before.runtime.actors.filter((actor) => actor.squad)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  result.portraits = []
  for (const stage of stages) {
    checkTime()
    const request = structuredClone(stage.request)
    const selector = request.portrait.subject
    const actor = selector === 'player' ? null : companions[Number(selector.slice(-1))]
    const subject = { id: actor?.id ?? 'player', role: actor?.role ?? 'player', faction: actor?.allegiance ?? fixture.faction }
    if (portraitReference) {
      const frame = portraitCameraReference(portraitReference, fixture.id, stage.id,
        manifest.conditions.portraitComparison, subject)
      if (frame) request.portrait.frame = frame
    }
    await browser.evaluate(`window.__korovanyGraphics.stage(${JSON.stringify(request)})`)
    await browser.evaluate('window.__korovanyGraphics.render(2)')
    const snapshot = await browser.evaluate('window.__korovanyGraphics.snapshot()')
    assertBrowserHealthy(stage.id)
    if (snapshot.runtime.rendering.post.composer !== snapshot.runtime.visualPolicy.post.enabled) {
      throw new Error('Portrait post pipeline fell back instead of applying the selected policy')
    }
    if (portraitSimulationIdentity(snapshot) !== identity) throw new Error(`Portrait ${stage.id} mutated real gameplay identity`)
    if (portraitSaveIdentity(await browser.evaluate('window.__korovanyGraphics.save()')) !== saveIdentity) {
      throw new Error(`Portrait ${stage.id} changed the campaign save beyond its export timestamp`)
    }
    const portrait = snapshot.runtime.rendering.characterPortrait
    if (!portrait || portrait.subject.id !== subject.id || portrait.subject.role !== subject.role) {
      throw new Error('Portrait stage did not resolve the expected actual production subject')
    }
    if (flag('portrait-smoke') && !portrait.focusInsideClip) throw new Error('Initial head smoke failed geometric portrait framing')
    if (request.portrait.view === 'gameplay' &&
        !snapshot.runtime.rendering.portraitContext?.some((entry) => !entry.player && entry.headInsideClip)) {
      throw new Error('Normal gameplay portrait contains no production companion head inside the camera frame')
    }
    if (!await browser.evaluate('!!document.querySelector("#graphics-character-portrait-label")')) {
      throw new Error('Portrait is missing its visible STAGED label')
    }
    const file = `${fixture.id}-${stage.id}.png`
    const bytes = await browser.screenshot(join(out, file))
    const dataFile = `${fixture.id}-${stage.id}.json`
    const record = {
      id: stage.id, file, metadata: dataFile, sha256: sha256(bytes), bytes: bytes.length,
      view: request.portrait.view, pose: request.portrait.pose,
      subject: portrait.subject, cameraMode: portrait.cameraMode,
      cameraFrame: portrait.camera.target ? {
        position: portrait.camera.position, target: portrait.camera.target, fov: portrait.camera.fov,
        near: portrait.camera.near, far: portrait.camera.far,
      } : null,
      gameplayCamera: portrait.cameraMode === 'production-gameplay' ? portrait.camera : null,
      focusInsideClip: portrait.focusInsideClip, simulationPreserved: true, savePreservedExceptExportTimestamp: true,
      effectivePolicy: snapshot.runtime.visualPolicy,
      framingContext: snapshot.runtime.rendering.portraitContext,
    }
    result.portraits.push(record)
    await writeFile(join(out, dataFile), JSON.stringify({
      ...record, runtimeCommit: manifest.runtimeCommit, buildSha256: manifest.buildSha256,
      request, portrait, snapshot,
      limitation: 'Held staged production presentation; not natural play, attack timing, camera collision, GPU attribution or art approval.',
    }, null, 2))
    await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  }
  await browser.evaluate('window.__korovanyGraphics.stage({label:"Restore production camera and original subject poses after portrait review",portrait:null})')
  await browser.evaluate('window.__korovanyGraphics.render(2)')
  const restored = await browser.evaluate('window.__korovanyGraphics.snapshot()')
  if (portraitSimulationIdentity(restored) !== identity ||
      portraitSaveIdentity(await browser.evaluate('window.__korovanyGraphics.save()')) !== saveIdentity) {
    throw new Error('Clearing portrait staging changed production gameplay/save identity')
  }
  result.portraitRestoration = { simulationPreserved: true, portraitCleared: restored.runtime.rendering.characterPortrait === null }
}

function assertBrowserHealthy(label) {
  const errors = browser.events.filter((event) => event.method === 'Runtime.exceptionThrown' ||
    event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
  if (errors.length) throw new Error(`Browser errors in ${label}: ${JSON.stringify(errors)}`)
}

async function nativeRoute() {
  const log = []
  const start = performance.now()
  const event = async (method, params) => {
    log.push({ atMs: performance.now() - start, method, params })
    await browser.send(method, params)
  }
  // A staged starting point followed by native input, not a re-creation of the
  // original review's timing. Drag-to-look is exercised when capture is refused.
  const x = Math.round(width * 0.52)
  const y = Math.round(height * 0.78)
  await event('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await event('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await event('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await browser.waitFor('(() => { const p=window.__korovanyGraphics.snapshot().runtime.pointerInput; return p.locked || p.fallback; })()', 5000)
  const before = await browser.evaluate('window.__korovanyGraphics.snapshot().runtime')
  await event('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 12; i++) {
    await event('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 10, y, button: 'left', buttons: 1 })
    await delay(30)
  }
  await event('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 120, y, button: 'left', clickCount: 1 })
  await browser.key('KeyA', true)
  log.push({ atMs: performance.now() - start, key: 'KeyA', down: true })
  await delay(700)
  await browser.key('KeyA', false)
  log.push({ atMs: performance.now() - start, key: 'KeyA', down: false })
  const after = await browser.evaluate('window.__korovanyGraphics.snapshot().runtime')
  if (Math.abs(after.camera.yaw - before.camera.yaw) < 0.01) throw new Error('Native camera route did not move the actual camera yaw')
  if (Math.hypot(...after.player.map((value, index) => value - before.player[index])) < 0.1) {
    throw new Error('Native strafe route did not move the actual player')
  }
  return { log, before, after }
}

async function lifecycleCycles() {
  const cycles = []
  for (let cycle = 0; cycle < 3; cycle++) {
    const before = await browser.evaluate('window.__korovanyGraphics.snapshot()')
    await browser.clickSelector('.hud-pause')
    await browser.waitFor('!!document.querySelector(".pause-modal .pause-actions .text-button")')
    await browser.clickSelector('.pause-modal .pause-actions .text-button')
    await browser.waitFor('window.__korovanyGraphics === undefined && !!document.querySelector(".active-run-card")')
    const after = await browser.evaluate('window.__korovanyGraphicsLastDisposal')
    if (!after) throw new Error('Production teardown did not dispose the diagnostic owner')
    cycles.push({ before: before.resources, after, npcCount: before.runtime.npcCount })
    if (cycle < 2) {
      await browser.clickSelector('.active-run-actions .primary-button')
      await browser.waitFor('!!window.__korovanyGraphics')
      await browser.evaluate('window.__korovanyGraphics.render(2)')
    }
  }
  return cycles
}

try {
  checkTime()
  const server = startOwned(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], 'vite-preview')
  await waitStartup(async () => {
    try { return (await fetch(origin)).ok } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNRESET') return false
      throw error
    }
  }, server)
  const chromeProcess = startOwned(chrome, chromeFlags, 'chrome')
  let debugPort
  await waitStartup(async () => {
    try {
      debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0])
      return Number.isInteger(debugPort) && debugPort > 0
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EBUSY') return false
      throw error
    }
  }, chromeProcess)
  browser = await GraphicsBrowser.connect(debugPort)
  manifest.browserVersion = await browser.send('Browser.getVersion')
  manifest.processes = { serverPid: server.child.pid, chromePid: chromeProcess.child.pid, debugPort }
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false })
  await browser.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: flag('reduced-motion') ? 'reduce' : 'no-preference' }],
  })
  for (const fixture of fixtures) {
    checkTime()
    const result = { id: fixture.id, definition: fixture, captures: [] }
    manifest.cases.push(result)
    for (let repetition = 1; repetition <= repeat; repetition++) {
      checkTime()
      const setup = await launchFixture(fixture)
      const path = join(out, `${fixture.id}-${repetition}.png`)
      const bytes = await browser.screenshot(path)
      const snapshot = await browser.evaluate('window.__korovanyGraphics.snapshot()')
      const capture = { repetition, path, sha256: sha256(bytes), bytes: bytes.length, ...setup, snapshot }
      result.captures.push({ repetition, file: `${fixture.id}-${repetition}.png`, sha256: capture.sha256 })
      if (repetition > 1) {
        result.captures[result.captures.length - 1].comparison =
          compareGraphicsPng(await readFile(join(out, `${fixture.id}-1.png`)), bytes)
      }
      await writeFile(join(out, `${fixture.id}-${repetition}.json`), JSON.stringify(capture, null, 2))
      assertBrowserHealthy(fixture.id)
      if (flag('portraits')) await capturePortraitSuite(fixture, result)
      if (flag('runtime-controls')) {
        result.runtimeControls = { captures: [] }
        result.runtimeControls.summary = await captureRuntimeControls(browser, { width, height, dpr },
          async (id, snapshot) => {
            checkTime()
            assertBrowserHealthy(`${fixture.id}:${id}`)
            const file = `${fixture.id}-controls-${id}.png`
            const bytes = await browser.screenshot(join(out, file))
            const record = { id, file, sha256: sha256(bytes), snapshot }
            result.runtimeControls.captures.push(record)
            await writeFile(join(out, `${fixture.id}-controls-${id}.json`), JSON.stringify(record, null, 2))
            await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
          }, checkTime)
      }
      if (repetition === repeat && flag('profile')) {
        checkTime()
        await browser.evaluate(`(() => {
          for (const animation of window.__graphicsCaptureAnimations ?? []) animation.play();
          delete window.__graphicsCaptureAnimations;
        })()`)
        const inputs = fixture.target === 'boundary' ? [
          { frame: warmupFrames, keys: ['KeyW'] },
          { frame: warmupFrames + Math.floor(sampleFrames / 2), keys: ['KeyS'] },
        ] : fixture.crowd ? [{ frame: 0, keys: ['KeyR'] }] : []
        const options = { warmupFrames, sampleFrames, inputs, counters: flag('timing-only') ? 'disabled' : 'full' }
        const cpuBefore = cpus()
        const activeProfile = browser.evaluate(`window.__korovanyGraphics.profile(${JSON.stringify(options)})`, 240000)
        const [report, nativeInput] = await Promise.all([
          activeProfile, flag('native-route') ? nativeRoute() : Promise.resolve(null),
        ])
        if (nativeInput) result.nativeInput = nativeInput
        report.systemCpuBusyPercent = cpuBusyPercent(cpuBefore, cpus())
        result.performance = { file: `${fixture.id}-profile.json`, samples: report.samples, warmup: report.warmup,
          counterMode: report.counterMode, systemCpuBusyPercent: report.systemCpuBusyPercent }
        await writeFile(join(out, `${fixture.id}-profile.json`), JSON.stringify(report))
        const after = await browser.screenshot(join(out, `${fixture.id}-active-end.png`))
        result.activeEnd = { file: `${fixture.id}-active-end.png`, sha256: sha256(after) }
      }
      if (repetition === repeat && flag('motion')) {
        result.motion = { mode: 'labelled manual production steps after capture/profile; not RAF timing', frames: [] }
        for (let frame = 0; frame < 12; frame++) {
          checkTime()
          await browser.evaluate('window.__korovanyGraphics.step(5, 1/60)')
          const file = `${fixture.id}-motion-${String(frame).padStart(2, '0')}.png`
          const bytes = await browser.screenshot(join(out, file))
          result.motion.frames.push({ file, sha256: sha256(bytes),
            snapshot: await browser.evaluate('window.__korovanyGraphics.snapshot().runtime') })
        }
      }
      const errors = browser.events.filter((event) => event.method === 'Runtime.exceptionThrown'
        || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'))
      const requests = browser.events.filter((event) => event.method === 'Network.requestWillBeSent')
        .map((event) => event.params.request.url)
      const external = requests.filter((url) => /^https?:/.test(url) && !url.startsWith(origin))
      result.externalRequests = external
      await writeFile(join(out, `${fixture.id}-${repetition}-browser.json`), JSON.stringify(browser.events, null, 2))
      if (errors.length) throw new Error(`Browser errors in ${fixture.id}: ${JSON.stringify(errors)}`)
      if (external.length) throw new Error(`Unexpected network dependency: ${external.join(', ')}`)
    }
    result.byteIdenticalCaptures = result.captures.length > 1
      ? new Set(result.captures.map((entry) => entry.sha256)).size === 1 : null
    result.repeatWithinTolerance = result.captures.length > 1
      ? result.captures.slice(1).every((entry) => entry.comparison.changedPixels <= 16
        && entry.comparison.maxChannelDelta <= 2) : null
    if (flag('lifecycle')) result.lifecycle = await lifecycleCycles()
    console.log(JSON.stringify({
      fixture: fixture.id, captures: result.captures.length, byteIdentical: result.byteIdenticalCaptures,
      p95Ms: result.performance?.samples.frameTimeMs?.p95 ?? null,
      callsMax: result.performance?.samples.calls?.max ?? null,
    }))
    await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
    if (result.repeatWithinTolerance === false) throw new Error(`Non-reproducible fixture capture: ${fixture.id}`)
  }
  // Launch the ordinary build without the opt-in query as a real default-off
  // control, not merely a check of an empty menu where no engine exists.
  checkTime()
  await browser.send('Page.navigate', { url: origin })
  await browser.waitFor('document.readyState === "complete" && !!document.querySelector("#world-seed, .active-run-card")')
  if (await browser.evaluate('!!document.querySelector(".active-run-card")')) {
    await browser.clickSelector('.active-run-actions .primary-button')
  } else await browser.clickSelector('.faction-card.guard button')
  await browser.waitFor('!!document.querySelector(".game-canvas")')
  manifest.defaultOffControl = await browser.evaluate('({canvasPresent:!!document.querySelector(".game-canvas"),diagnosticsAbsent:window.__korovanyGraphics === undefined})')
  if (!manifest.defaultOffControl.diagnosticsAbsent) throw new Error('Diagnostics activated without the explicit query')
  manifest.complete = true
} catch (error) {
  manifest.error = { message: error.message, stack: error.stack }
  runErrors.push(error)
} finally {
  const shutdownErrors = []
  if (browser) {
    try {
      await browser.send('Browser.close', {}, 5000)
    } catch (error) {
      if (!error.message.includes('CDP disconnected during Browser.close')) shutdownErrors.push(error.message)
    }
    browser.close()
  }
  for (const entry of children.toReversed()) {
    if (!entry.child.pid) continue
    if (!entry.exited) entry.child.kill()
    const deadline = performance.now() + 5000
    while (!entry.exited && performance.now() < deadline) await delay(50)
    if (!entry.exited) shutdownErrors.push(`${entry.name} PID ${entry.child.pid} did not exit`)
  }
  try { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
  catch (error) { shutdownErrors.push(`Owned browser profile cleanup: ${error.message}`) }
  manifest.finishedAt = new Date().toISOString()
  manifest.shutdown = { ownedProcessesStopped: shutdownErrors.length === 0, errors: shutdownErrors }
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(out, 'process-log.json'), JSON.stringify(processLogs, null, 2))
  if (shutdownErrors.length) runErrors.push(new Error(`Graphics process cleanup incomplete: ${shutdownErrors.join('; ')}`))
}
if (runErrors.length) throw new AggregateError(runErrors, 'Graphics baseline run failed; see manifest.json')
