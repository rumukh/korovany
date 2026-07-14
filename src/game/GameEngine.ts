import * as THREE from 'three'
import {
  FACTION_INFO,
  SAVE_KEY,
  type BodyPart,
  type BodyState,
  type Faction,
  type GameCallbacks,
  type GameView,
  type MapMarker,
  type Objective,
  type SavedGame,
  type ShopItem,
  type ZoneId,
  createHealthyBody,
  createObjectives,
} from './types'

type ActorRole = 'soldier' | 'scout' | 'commander' | 'minion'

interface Actor {
  id: string
  faction: Faction
  role: ActorRole
  mesh: THREE.Group
  hp: number
  maxHp: number
  speed: number
  alive: boolean
  attackCooldown: number
  home: THREE.Vector3
  wanderTarget: THREE.Vector3
  wanderTimer: number
  targetId: string | null
  stride: number
  phase: number
}

interface Palette {
  bg: THREE.Color
  elevated: THREE.Color
  surface: THREE.Color
  soft: THREE.Color
  border: THREE.Color
  borderStrong: THREE.Color
  text: THREE.Color
  muted: THREE.Color
  accent: THREE.Color
  success: THREE.Color
  danger: THREE.Color
  warning: THREE.Color
  link: THREE.Color
  accentFg: THREE.Color
}

interface Particle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
}

const WORLD_HALF = 78
const PLAYER_HEIGHT = 0

const MUSIC_PATTERNS: Record<Faction, readonly number[]> = {
  elf: [0, 4, 7, 12, 7, 4, 2, 4, 0, 4, 9, 12, 9, 4, 2, -1, 0, 4, 7, 11, 7, 4, 2, 4, 0, 5, 9, 12, 9, 5, 2, 4],
  guard: [0, 7, 12, 7, 5, 9, 12, 9, 3, 7, 10, 15, 10, 7, 5, 3, 0, 7, 12, 14, 12, 7, 5, 7, 3, 7, 10, 12, 10, 7, 5, 2],
  villain: [0, 3, 7, 10, 7, 3, -2, 3, 0, 3, 6, 10, 6, 3, -2, -5, 0, 3, 7, 12, 7, 3, 1, 3, 0, 5, 8, 12, 8, 5, 1, -2],
}

const MUSIC_ROOTS: Record<Faction, number> = {
  elf: 57,
  guard: 55,
  villain: 52,
}

const MUSIC_TEMPOS: Record<Faction, number> = {
  elf: 138,
  guard: 128,
  villain: 132,
}

const ZONE_MUSIC_SHIFTS: Record<ZoneId, number> = {
  neutral: 2,
  palace: 5,
  forest: 0,
  fort: -2,
}

function midiToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

function dampAngle(current: number, target: number, smoothing: number, delta: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + difference * (1 - Math.exp(-smoothing * delta))
}

type MusicWindow = Window & {
  __korovanyStopMusic?: () => void
}

function readCssColor(token: string): THREE.Color {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(token).trim())
}

function createPalette(): Palette {
  return {
    bg: readCssColor('--cp-bg'),
    elevated: readCssColor('--cp-bg-elevated'),
    surface: readCssColor('--cp-surface'),
    soft: readCssColor('--cp-surface-soft'),
    border: readCssColor('--cp-border'),
    borderStrong: readCssColor('--cp-border-strong'),
    text: readCssColor('--cp-text'),
    muted: readCssColor('--cp-text-muted'),
    accent: readCssColor('--cp-accent'),
    success: readCssColor('--cp-success'),
    danger: readCssColor('--cp-danger'),
    warning: readCssColor('--cp-warning'),
    link: readCssColor('--cp-link'),
    accentFg: readCssColor('--cp-accent-fg'),
  }
}

function mix(a: THREE.Color, b: THREE.Color, amount: number): THREE.Color {
  return a.clone().lerp(b, amount)
}

function seededRandom(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function zoneAt(x: number, z: number): ZoneId {
  if (x < 0 && z < 0) return 'neutral'
  if (x >= 0 && z < 0) return 'palace'
  if (x < 0 && z >= 0) return 'forest'
  return 'fort'
}

function hostile(a: Faction, b: Faction): boolean {
  return a !== b
}

function formatPart(part: BodyPart): string {
  const names: Record<BodyPart, string> = {
    leftArm: 'левая рука',
    rightArm: 'правая рука',
    leftLeg: 'левая нога',
    rightLeg: 'правая нога',
    leftEye: 'левый глаз',
    rightEye: 'правый глаз',
  }
  return names[part]
}

export class GameEngine {
  private readonly container: HTMLElement
  private readonly callbacks: GameCallbacks
  private readonly faction: Faction
  private readonly palette: Palette
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(56, 1, 0.1, 240)
  private readonly renderer: THREE.WebGLRenderer
  private readonly clock = new THREE.Clock()
  private readonly keys = new Set<string>()
  private readonly actors: Actor[] = []
  private readonly particles: Particle[] = []
  private readonly generatedTextures = new Map<string, THREE.CanvasTexture>()
  private readonly clouds: Array<{ group: THREE.Group; speed: number }> = []
  private readonly flames: THREE.Mesh[] = []
  private readonly player: THREE.Group
  private readonly caravan: THREE.Group
  private readonly vendorPosition = new THREE.Vector3(-46, 0, -39)
  private readonly commanderPosition = new THREE.Vector3(40, 0, -36)
  private objectives: Objective[]
  private body: BodyState
  private health = 100
  private stamina = 100
  private gold = 55
  private kills = 0
  private damage = 26
  private elapsed = 0
  private paused = false
  private ended = false
  private verticalVelocity = 0
  private onGround = true
  private cameraYaw = 0
  private cameraPitch = 0.38
  private attackCooldown = 0
  private attackAnimation = 0
  private lastViewAt = 0
  private lastZone: ZoneId
  private prompt = ''
  private squadFollowing = false
  private caravanDirection = 1
  private caravanCooldown = 0
  private caravanRobbedFlash = 0
  private audioContext: AudioContext | null = null
  private musicGain: GainNode | null = null
  private musicNoiseBuffer: AudioBuffer | null = null
  private musicTimer: number | null = null
  private musicNextNoteTime = 0
  private musicStep = 0
  private musicMuted: boolean
  private readonly musicSources = new Set<AudioScheduledSourceNode>()
  private readonly stopMusicOwner = () => this.stopMusic()
  private resizeObserver: ResizeObserver
  private boundKeyDown: (event: KeyboardEvent) => void
  private boundKeyUp: (event: KeyboardEvent) => void
  private boundMouseMove: (event: MouseEvent) => void
  private boundMouseDown: (event: MouseEvent) => void
  private boundPointerLock: () => void
  private boundVisibilityChange: () => void
  private frameHandle = 0

  constructor(
    container: HTMLElement,
    faction: Faction,
    callbacks: GameCallbacks,
    savedGame?: SavedGame,
    musicMuted = false,
  ) {
    this.container = container
    this.callbacks = callbacks
    this.faction = faction
    this.musicMuted = musicMuted
    this.palette = createPalette()
    this.objectives = savedGame?.objectives.map((objective) => ({ ...objective })) ?? createObjectives(faction)
    this.body = savedGame ? { ...savedGame.body } : createHealthyBody()
    this.health = savedGame?.health ?? 100
    this.stamina = savedGame?.stamina ?? 100
    this.gold = savedGame?.gold ?? 55
    this.kills = savedGame?.kills ?? 0
    this.damage = savedGame?.damage ?? (faction === 'villain' ? 31 : faction === 'guard' ? 28 : 26)
    this.elapsed = savedGame?.elapsed ?? 0

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.domElement.className = 'game-canvas'
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерный игровой мир')
    this.container.appendChild(this.renderer.domElement)

    this.scene.background = this.palette.bg
    this.scene.fog = new THREE.Fog(this.palette.bg, 52, 138)
    this.player = this.createCharacter(faction, true)
    const spawn = savedGame?.position ?? [FACTION_INFO[faction].spawn[0], PLAYER_HEIGHT, FACTION_INFO[faction].spawn[1]]
    this.player.position.set(spawn[0], spawn[1], spawn[2])
    this.scene.add(this.player)
    this.applySavedBodyAppearance()
    this.lastZone = zoneAt(this.player.position.x, this.player.position.z)

    this.setupLights()
    this.buildWorld()
    this.caravan = this.createCaravan()
    this.scene.add(this.caravan)
    this.spawnPopulation()
    this.cameraYaw = faction === 'elf' ? -0.8 : faction === 'guard' ? 2.4 : 0.8
    this.updateCamera(true)

    this.boundKeyDown = this.onKeyDown.bind(this)
    this.boundKeyUp = this.onKeyUp.bind(this)
    this.boundMouseMove = this.onMouseMove.bind(this)
    this.boundMouseDown = this.onMouseDown.bind(this)
    this.boundPointerLock = this.onPointerLockChange.bind(this)
    this.boundVisibilityChange = this.onVisibilityChange.bind(this)
    window.addEventListener('keydown', this.boundKeyDown)
    window.addEventListener('keyup', this.boundKeyUp)
    document.addEventListener('mousemove', this.boundMouseMove)
    document.addEventListener('mousedown', this.boundMouseDown)
    document.addEventListener('pointerlockchange', this.boundPointerLock)
    document.addEventListener('visibilitychange', this.boundVisibilityChange)
    window.addEventListener('pagehide', this.stopMusicOwner)
    window.addEventListener('beforeunload', this.stopMusicOwner)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
    this.emitView(true)
  }

  start(): void {
    this.clock.start()
    this.frameHandle = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    cancelAnimationFrame(this.frameHandle)
    this.resizeObserver.disconnect()
    window.removeEventListener('keydown', this.boundKeyDown)
    window.removeEventListener('keyup', this.boundKeyUp)
    document.removeEventListener('mousemove', this.boundMouseMove)
    document.removeEventListener('mousedown', this.boundMouseDown)
    document.removeEventListener('pointerlockchange', this.boundPointerLock)
    document.removeEventListener('visibilitychange', this.boundVisibilityChange)
    window.removeEventListener('pagehide', this.stopMusicOwner)
    window.removeEventListener('beforeunload', this.stopMusicOwner)
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) return
      if (object instanceof THREE.Mesh) object.geometry.dispose()
      const material = object.material
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
      else material.dispose()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.generatedTextures.forEach((texture) => texture.dispose())
    this.generatedTextures.clear()
    this.stopMusic()
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.keys.clear()
    if (paused && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    this.updateMusicVolume()
    this.emitView(true)
  }

  requestPointerLock(): void {
    if (!this.paused && !this.ended) {
      this.resumeAudio()
      this.renderer.domElement.requestPointerLock().catch(() => undefined)
    }
  }

  setInput(code: string, active: boolean): void {
    if (active) {
      this.resumeAudio()
      this.keys.add(code)
    } else {
      this.keys.delete(code)
    }
  }

  setMusicMuted(muted: boolean): void {
    this.musicMuted = muted
    if (!muted) this.resumeAudio()
    this.updateMusicVolume()
  }

  stopAudio(): void {
    this.stopMusic()
  }

  attack(): void {
    if (this.paused || this.ended || this.attackCooldown > 0) return
    this.resumeAudio()
    this.attackCooldown = 0.52
    this.attackAnimation = 1

    let target: Actor | null = null
    let bestDistance = 3.6
    for (const actor of this.actors) {
      if (!actor.alive || !hostile(this.faction, actor.faction)) continue
      const offset = actor.mesh.position.clone().sub(this.player.position)
      const distance = offset.length()
      if (distance >= bestDistance) continue
      target = actor
      bestDistance = distance
    }

    if (!target) {
      this.playSound('swing')
      return
    }

    const targetDirection = target.mesh.position.clone().sub(this.player.position)
    this.player.rotation.y = Math.atan2(targetDirection.x, targetDirection.z)
    const armPenalty =
      (this.body.leftArm === 'missing' ? 5 : 0) + (this.body.rightArm === 'missing' ? 9 : 0)
    const dealt = Math.max(8, this.damage - armPenalty + Math.floor(Math.random() * 7))
    target.hp -= dealt
    this.createHitParticles(target.mesh.position, target.faction)
    this.playSound('hit')
    if (Math.random() < 0.13) this.detachActorLimb(target)
    if (target.hp <= 0) this.killActor(target, true)
  }

  interact(): void {
    if (this.paused || this.ended) return
    this.resumeAudio()
    const playerPosition = this.player.position
    if (playerPosition.distanceTo(this.vendorPosition) < 6) {
      this.callbacks.onShop()
      return
    }

    if (
      this.faction === 'guard' &&
      playerPosition.distanceTo(this.commanderPosition) < 6 &&
      this.actors.some((actor) => actor.role === 'commander' && actor.alive)
    ) {
      if (this.completeObjective('orders')) {
        this.callbacks.onNotice(
          'Командир: «Налётчики уже близко. Защитить дворец, затем проверить старый форт!»',
          'success',
        )
        this.gold += 25
        this.playSound('coin')
      } else {
        this.callbacks.onNotice('Командир: «Приказ прежний. Не стой столбом!»', 'info')
      }
      this.emitView(true)
      return
    }

    if (playerPosition.distanceTo(this.caravan.position) < 7) {
      if (this.faction === 'guard') {
        this.callbacks.onNotice('Корован под охраной. Всё спокойно, гвардеец.', 'info')
        this.health = Math.min(100, this.health + 8)
        return
      }
      if (this.caravanCooldown > 0) {
        this.callbacks.onNotice('Этот корован уже пуст. Ждите следующий обоз.', 'warning')
        return
      }
      this.gold += 95
      this.caravanCooldown = 40
      this.caravanRobbedFlash = 1
      this.completeObjective('raid')
      this.callbacks.onNotice('Ключевой игровой процесс достигнут: корован ограблен! +95 золота', 'success')
      this.playSound('coin')
      this.spawnAmbush()
      this.emitView(true)
    }
  }

  commandSquad(): void {
    if (this.paused || this.ended) return
    this.resumeAudio()
    this.squadFollowing = !this.squadFollowing
    if (this.faction === 'villain') this.completeObjective('rally')
    const message = this.squadFollowing
      ? this.faction === 'guard'
        ? 'Ближайшие гвардейцы держат строй за вами.'
        : 'Отряд следует за вами и атакует ваших врагов.'
      : 'Отряд удерживает текущую позицию.'
    this.callbacks.onNotice(message, this.squadFollowing ? 'success' : 'info')
    this.playSound('command')
    this.emitView(true)
  }

  purchase(item: ShopItem): { ok: boolean; message: string } {
    if (this.gold < item.price) return { ok: false, message: 'Не хватает золота.' }

    if (item.id === 'arm') {
      const part = this.firstPartWithStatus(['leftArm', 'rightArm'], 'missing')
      if (!part) return { ok: false, message: 'Обе руки на месте. Протез пока не нужен.' }
      this.body[part] = 'prosthetic'
      this.restorePlayerLimb(part)
    } else if (item.id === 'leg') {
      const part = this.firstPartWithStatus(['leftLeg', 'rightLeg'], 'missing')
      if (!part) return { ok: false, message: 'Обе ноги на месте. Протез пока не нужен.' }
      this.body[part] = 'prosthetic'
      this.restorePlayerLimb(part)
    } else if (item.id === 'eye') {
      const part = this.firstPartWithStatus(['leftEye', 'rightEye'], 'missing')
      if (!part) return { ok: false, message: 'Зрение в порядке. Хрустальный глаз не нужен.' }
      this.body[part] = 'prosthetic'
    } else if (item.id === 'medicine') {
      if (this.health >= 100 && this.body.bleeding === 0 && !this.hasWounds()) {
        return { ok: false, message: 'Вы полностью здоровы.' }
      }
      this.health = Math.min(100, this.health + 55)
      this.body.bleeding = 0
      this.healWounds()
    } else {
      this.damage += 8
    }

    this.gold -= item.price
    this.playSound('coin')
    this.emitView(true)
    return { ok: true, message: `${item.name}: покупка совершена.` }
  }

  save(): SavedGame {
    const save: SavedGame = {
      version: 1,
      faction: this.faction,
      position: [this.player.position.x, this.player.position.y, this.player.position.z],
      health: this.health,
      stamina: this.stamina,
      gold: this.gold,
      kills: this.kills,
      damage: this.damage,
      body: { ...this.body },
      objectives: this.objectives.map((objective) => ({ ...objective })),
      elapsed: this.elapsed,
      savedAt: new Date().toISOString(),
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    this.callbacks.onNotice('Игра сохранена. Корованы никуда не денутся.', 'success')
    this.playSound('save')
    return save
  }

  private readonly loop = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.05)
    if (!this.paused && !this.ended) this.update(delta)
    this.updateCamera(false)
    this.renderer.render(this.scene, this.camera)
    this.frameHandle = requestAnimationFrame(this.loop)
  }

  private update(delta: number): void {
    this.elapsed += delta
    this.attackCooldown = Math.max(0, this.attackCooldown - delta)
    this.attackAnimation = Math.max(0, this.attackAnimation - delta * 4.2)
    this.caravanCooldown = Math.max(0, this.caravanCooldown - delta)
    this.caravanRobbedFlash = Math.max(0, this.caravanRobbedFlash - delta * 2)
    this.updatePlayer(delta)
    this.updateCaravan(delta)
    this.updateActors(delta)
    this.updateParticles(delta)
    this.updateAtmosphere(delta)
    this.updatePrompt()
    this.updateMission()

    if (this.body.bleeding > 0) {
      this.health -= this.body.bleeding * delta
      if (Math.floor(this.elapsed * 2) % 10 === 0) this.createBleedParticle()
    }
    if (this.health <= 0) this.endGame('defeat')
    this.emitView(false)
  }

  private updatePlayer(delta: number): void {
    const forward = new THREE.Vector3(Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw))
    const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, Math.sin(this.cameraYaw))
    const move = new THREE.Vector3()
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(forward)
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(forward)
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right)
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(right)

    const missingLegs =
      Number(this.body.leftLeg === 'missing') + Number(this.body.rightLeg === 'missing')
    const prostheticLegs =
      Number(this.body.leftLeg === 'prosthetic') + Number(this.body.rightLeg === 'prosthetic')
    let mobility = missingLegs === 2 ? 0.24 : missingLegs === 1 ? 0.53 : 1
    if (prostheticLegs > 0) mobility *= 0.9
    if (this.faction === 'elf' && zoneAt(this.player.position.x, this.player.position.z) === 'forest') {
      mobility *= 1.14
    }

    const sprinting =
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) &&
      this.stamina > 2 &&
      move.lengthSq() > 0 &&
      missingLegs === 0
    const speed = 8.2 * mobility * (sprinting ? 1.65 : 1)
    if (sprinting) this.stamina = Math.max(0, this.stamina - delta * 24)
    else this.stamina = Math.min(100, this.stamina + delta * 16)

    if (move.lengthSq() > 0) {
      move.normalize()
      this.player.position.addScaledVector(move, speed * delta)
      this.player.rotation.y = Math.atan2(move.x, move.z)
      const stride = Math.sin(this.elapsed * (sprinting ? 15 : 10)) * 0.62
      this.animateCharacter(this.player, stride, this.attackAnimation)
    } else {
      this.animateCharacter(this.player, 0, this.attackAnimation)
    }

    if (this.keys.has('Space') && this.onGround && missingLegs < 2) {
      this.verticalVelocity = missingLegs === 1 ? 6.2 : 8.5
      this.onGround = false
      this.playSound('jump')
    }
    this.verticalVelocity -= 23 * delta
    this.player.position.y += this.verticalVelocity * delta
    if (this.player.position.y <= PLAYER_HEIGHT) {
      this.player.position.y = PLAYER_HEIGHT
      this.verticalVelocity = 0
      this.onGround = true
    }

    this.player.position.x = THREE.MathUtils.clamp(this.player.position.x, -WORLD_HALF, WORLD_HALF)
    this.player.position.z = THREE.MathUtils.clamp(this.player.position.z, -WORLD_HALF, WORLD_HALF)
  }

  private updateActors(delta: number): void {
    for (const actor of this.actors) {
      if (!actor.alive) continue
      actor.attackCooldown = Math.max(0, actor.attackCooldown - delta)
      actor.wanderTimer = Math.max(0, actor.wanderTimer - delta)
      const toPlayer = this.player.position.clone().sub(actor.mesh.position)
      toPlayer.y = 0
      const playerDistance = toPlayer.length()
      const direction = new THREE.Vector3()
      let moving = false

      if (hostile(actor.faction, this.faction) && playerDistance < 15) {
        actor.targetId = null
        if (playerDistance > 2.55) {
          direction.copy(toPlayer).normalize()
          moving = true
        } else if (actor.attackCooldown <= 0) {
          this.actorAttackPlayer(actor)
        }
      } else if (actor.faction === this.faction && this.squadFollowing && actor.role !== 'commander') {
        const enemy = this.findNearestEnemy(actor, 9)
        if (enemy) {
          const offset = enemy.mesh.position.clone().sub(actor.mesh.position)
          offset.y = 0
          if (offset.length() > 2.45) {
            direction.copy(offset).normalize()
            moving = true
          } else if (actor.attackCooldown <= 0) {
            this.actorAttackActor(actor, enemy)
          }
        } else {
          const formationAngle = actor.phase * 3.7
          const formationTarget = this.player.position
            .clone()
            .add(new THREE.Vector3(Math.sin(formationAngle) * 3.2, 0, Math.cos(formationAngle) * 3.2))
          const toFormation = formationTarget.sub(actor.mesh.position)
          toFormation.y = 0
          if (toFormation.length() > 1.1) {
            direction.copy(toFormation).normalize()
            moving = true
          }
        }
      } else if (actor.role !== 'commander') {
        const enemy = playerDistance < 32 ? this.findNearestEnemy(actor, 6.5) : null
        if (enemy) {
          const offset = enemy.mesh.position.clone().sub(actor.mesh.position)
          offset.y = 0
          if (offset.length() > 2.45) {
            direction.copy(offset).normalize()
            moving = true
          } else if (actor.attackCooldown <= 0) {
            this.actorAttackActor(actor, enemy)
          }
        } else {
          const toWaypoint = actor.wanderTarget.clone().sub(actor.mesh.position)
          toWaypoint.y = 0
          if (
            actor.wanderTimer <= 0 ||
            toWaypoint.length() < 0.65 ||
            actor.mesh.position.distanceTo(actor.home) > 10
          ) {
            this.chooseWanderTarget(actor)
            toWaypoint.copy(actor.wanderTarget).sub(actor.mesh.position)
            toWaypoint.y = 0
          }
          if (toWaypoint.length() > 0.3) {
            direction.copy(toWaypoint).normalize()
            moving = true
          }
        }
      }

      if (actor.role !== 'commander') {
        const separation = this.getActorSeparation(actor)
        if (separation.lengthSq() > 0.0001) {
          direction.addScaledVector(separation, moving ? 0.72 : 1)
          moving = true
        }
      }

      let desiredStride = 0
      if (moving && direction.lengthSq() > 0) {
        const speed = actor.speed * (hostile(actor.faction, this.faction) && playerDistance < 15 ? 1.25 : 1)
        direction.normalize()
        actor.mesh.position.addScaledVector(direction, speed * delta)
        const targetYaw = Math.atan2(direction.x, direction.z)
        actor.mesh.rotation.y = dampAngle(actor.mesh.rotation.y, targetYaw, 10, delta)
        desiredStride = Math.sin(this.elapsed * 9 + actor.phase) * 0.55
      }
      actor.mesh.position.x = THREE.MathUtils.clamp(actor.mesh.position.x, -WORLD_HALF, WORLD_HALF)
      actor.mesh.position.z = THREE.MathUtils.clamp(actor.mesh.position.z, -WORLD_HALF, WORLD_HALF)
      actor.stride = THREE.MathUtils.damp(actor.stride, desiredStride, 13, delta)
      this.animateCharacter(actor.mesh, actor.stride, 0)
    }
  }

  private chooseWanderTarget(actor: Actor): void {
    actor.targetId = null
    const cycle = this.elapsed * 0.31 + actor.phase * 4.7
    const angle = cycle + Math.sin(cycle * 0.63) * 1.4
    const radius = 2.8 + (Math.sin(cycle * 1.17) + 1) * 2.6
    actor.wanderTarget.set(
      actor.home.x + Math.sin(angle) * radius,
      0,
      actor.home.z + Math.cos(angle) * radius,
    )
    actor.wanderTimer = 3.8 + (Math.sin(cycle * 0.81) + 1) * 2.2
  }

  private getActorSeparation(actor: Actor): THREE.Vector3 {
    const separation = new THREE.Vector3()
    for (const other of this.actors) {
      if (!other.alive || other === actor) continue
      const offset = actor.mesh.position.clone().sub(other.mesh.position)
      offset.y = 0
      const distanceSquared = offset.lengthSq()
      const minimumDistance = actor.faction === other.faction ? 1.45 : 1.15
      if (distanceSquared >= minimumDistance * minimumDistance) continue
      if (distanceSquared < 0.0001) {
        offset.set(Math.sin(actor.phase * 9.1), 0, Math.cos(actor.phase * 9.1))
      } else {
        offset.normalize()
      }
      const distance = Math.sqrt(Math.max(distanceSquared, 0.0001))
      separation.addScaledVector(offset, (minimumDistance - distance) / minimumDistance)
    }
    return separation
  }

  private updateCaravan(delta: number): void {
    this.caravan.position.x += this.caravanDirection * delta * 3.4
    if (this.caravan.position.x > 58) this.caravanDirection = -1
    if (this.caravan.position.x < -58) this.caravanDirection = 1
    this.caravan.rotation.y = this.caravanDirection > 0 ? 0 : Math.PI
    const wheels = this.caravan.getObjectsByProperty('name', 'wheel')
    for (const wheel of wheels) wheel.rotation.z -= delta * (3.4 / 0.9)
    const cargo = this.caravan.getObjectByName('cargo')
    if (cargo instanceof THREE.Mesh) {
      const scale = this.caravanCooldown > 0 ? 0.35 : 1
      cargo.scale.y = THREE.MathUtils.lerp(cargo.scale.y, scale, delta * 5)
      const material = cargo.material
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.copy(this.caravanRobbedFlash > 0 ? this.palette.warning : this.palette.bg)
        material.emissiveIntensity = this.caravanRobbedFlash
      }
    }
  }

  private updateParticles(delta: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]
      particle.life -= delta
      particle.velocity.y -= delta * 9
      particle.mesh.position.addScaledVector(particle.velocity, delta)
      particle.mesh.rotation.x += delta * 4
      particle.mesh.rotation.z += delta * 3
      particle.mesh.scale.setScalar(Math.max(0.01, particle.life))
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh)
        particle.mesh.geometry.dispose()
        const material = particle.mesh.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material.dispose()
        this.particles.splice(index, 1)
      }
    }
  }

  private updatePrompt(): void {
    const position = this.player.position
    if (position.distanceTo(this.vendorPosition) < 6) {
      this.prompt = '[E] Лавка лекаря и механика'
    } else if (
      this.faction === 'guard' &&
      position.distanceTo(this.commanderPosition) < 6 &&
      this.actors.some((actor) => actor.role === 'commander' && actor.alive)
    ) {
      this.prompt = '[E] Выслушать командира'
    } else if (position.distanceTo(this.caravan.position) < 7) {
      this.prompt =
        this.faction === 'guard'
          ? '[E] Проверить корован'
          : this.caravanCooldown > 0
            ? 'Корован уже разграблен'
            : '[E] ГРАБИТЬ КОРОВАН'
    } else {
      this.prompt = document.pointerLockElement === this.renderer.domElement ? '' : 'Нажмите на мир, чтобы управлять камерой'
    }
  }

  private updateMission(): void {
    const currentZone = zoneAt(this.player.position.x, this.player.position.z)
    if (currentZone !== this.lastZone) {
      this.lastZone = currentZone
      this.callbacks.onNotice(`Новая область: ${this.zoneName(currentZone)}`, 'info')
      if (this.faction === 'villain' && currentZone === 'palace') this.completeObjective('breach')
    }

    if (
      this.faction === 'elf' &&
      currentZone === 'forest' &&
      this.isObjectiveDone('raid') &&
      this.isObjectiveDone('guards')
    ) {
      this.completeObjective('home')
    }
    if (
      this.faction === 'guard' &&
      currentZone === 'fort' &&
      this.isObjectiveDone('orders') &&
      this.isObjectiveDone('defend')
    ) {
      this.completeObjective('patrol')
    }
    if (this.objectives.every((objective) => objective.done)) this.endGame('victory')
  }

  private actorAttackPlayer(actor: Actor): void {
    actor.attackCooldown = actor.role === 'commander' ? 0.8 : 1.15
    const armor = this.faction === 'guard' ? 0.72 : 1
    const dealt = (actor.role === 'commander' ? 10 : 6 + Math.random() * 3) * armor
    this.health -= dealt
    this.createHitParticles(this.player.position, this.faction)
    this.playSound('hurt')
    if (Math.random() < 0.11 && this.health < 82) this.injurePlayer()
  }

  private actorAttackActor(attacker: Actor, target: Actor): void {
    attacker.attackCooldown = 1.3
    target.hp -= attacker.role === 'commander' ? 18 : 13
    this.createHitParticles(target.mesh.position, target.faction)
    if (target.hp <= 0) this.killActor(target, false)
  }

  private killActor(actor: Actor, playerKill: boolean): void {
    if (!actor.alive) return
    actor.alive = false
    actor.mesh.rotation.z = actor.phase % 2 > 1 ? Math.PI / 2 : -Math.PI / 2
    actor.mesh.position.y = 0.62
    const weapon = actor.mesh.getObjectByName('weapon')
    if (weapon) weapon.rotation.x = 1.4
    this.playSound('down')
    if (!playerKill) return

    this.kills += 1
    const reward = actor.role === 'commander' ? 55 : 12
    this.gold += reward
    if (this.faction === 'elf' && actor.faction === 'guard') this.incrementObjective('guards')
    if (this.faction === 'guard' && actor.faction !== 'guard') this.incrementObjective('defend')
    if (this.faction === 'villain' && actor.role === 'commander') this.completeObjective('commander')
    this.callbacks.onNotice(
      actor.role === 'commander' ? 'Командир дворца повержен!' : `Враг повержен. +${reward} золота`,
      'success',
    )
    this.emitView(true)
  }

  private injurePlayer(): void {
    const candidates: BodyPart[] = [
      'leftArm',
      'rightArm',
      'leftLeg',
      'rightLeg',
      'leftEye',
      'rightEye',
    ]
    const available = candidates.filter((part) => this.body[part] === 'healthy' || this.body[part] === 'wounded')
    if (available.length === 0) return
    const part = available[Math.floor(Math.random() * available.length)]
    const wasWounded = this.body[part] === 'wounded'
    const severe = wasWounded || Math.random() < 0.4
    if (severe) {
      this.body[part] = 'missing'
      if (!part.includes('Eye')) {
        this.body.bleeding = Math.min(2.1, this.body.bleeding + (part.includes('Leg') ? 0.48 : 0.34))
        this.hidePlayerLimb(part)
      }
      this.callbacks.onNotice(
        part.includes('Eye')
          ? `Тяжёлая травма: потерян ${formatPart(part)}. Часть обзора закрыта.`
          : `Тяжёлая травма: потеряна ${formatPart(part)}! Найдите лекаря, иначе истечёте кровью.`,
        'danger',
      )
    } else {
      this.body[part] = 'wounded'
      this.body.bleeding = Math.min(1.2, this.body.bleeding + 0.12)
      this.callbacks.onNotice(`Ранение: ${formatPart(part)}.`, 'warning')
    }
    this.emitView(true)
  }

  private hidePlayerLimb(part: BodyPart): void {
    const limb = this.player.getObjectByName(part)
    if (!limb) return
    limb.visible = false
    const detached = new THREE.Mesh(
      new THREE.BoxGeometry(part.includes('Leg') ? 0.32 : 0.25, part.includes('Leg') ? 0.95 : 0.78, 0.3),
      new THREE.MeshStandardMaterial({
        color: this.factionColor(this.faction),
        roughness: 0.9,
      }),
    )
    detached.position.copy(this.player.position).add(new THREE.Vector3(part.startsWith('left') ? -0.6 : 0.6, 1.2, 0))
    detached.rotation.z = Math.PI / 2
    detached.castShadow = true
    this.scene.add(detached)
    this.particles.push({
      mesh: detached,
      velocity: new THREE.Vector3(part.startsWith('left') ? -2 : 2, 3.5, 0.8),
      life: 1.4,
    })
  }

  private restorePlayerLimb(part: BodyPart): void {
    const limb = this.player.getObjectByName(part)
    if (!limb) return
    limb.visible = true
    limb.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.material = new THREE.MeshStandardMaterial({
        color: this.palette.borderStrong,
        metalness: 0.72,
        roughness: 0.35,
      })
    })
  }

  private applySavedBodyAppearance(): void {
    const limbs: BodyPart[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']
    for (const part of limbs) {
      const limb = this.player.getObjectByName(part)
      if (!limb) continue
      if (this.body[part] === 'missing') limb.visible = false
      if (this.body[part] === 'prosthetic') this.restorePlayerLimb(part)
    }
  }

  private detachActorLimb(actor: Actor): void {
    const names: BodyPart[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']
    const visible = names
      .map((name) => actor.mesh.getObjectByName(name))
      .filter((part): part is THREE.Object3D => Boolean(part?.visible))
    if (visible.length === 0) return
    const limb = visible[Math.floor(Math.random() * visible.length)]
    limb.visible = false
    const detached = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, limb.name.includes('Leg') ? 0.92 : 0.72, 0.28),
      new THREE.MeshStandardMaterial({ color: this.factionColor(actor.faction), roughness: 0.9 }),
    )
    detached.position.copy(actor.mesh.position).add(new THREE.Vector3(0, 1.4, 0))
    detached.castShadow = true
    this.scene.add(detached)
    this.particles.push({
      mesh: detached,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 4.5, (Math.random() - 0.5) * 4),
      life: 1.3,
    })
  }

  private firstPartWithStatus<T extends BodyPart>(parts: T[], status: BodyState[T]): T | null {
    return parts.find((part) => this.body[part] === status) ?? null
  }

  private hasWounds(): boolean {
    const parts: BodyPart[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftEye', 'rightEye']
    return parts.some((part) => this.body[part] === 'wounded')
  }

  private healWounds(): void {
    const parts: BodyPart[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftEye', 'rightEye']
    for (const part of parts) {
      if (this.body[part] === 'wounded') this.body[part] = 'healthy'
    }
  }

  private completeObjective(id: string): boolean {
    const objective = this.objectives.find((entry) => entry.id === id)
    if (!objective || objective.done) return false
    objective.done = true
    if (objective.target) objective.progress = objective.target
    this.callbacks.onNotice(`Задача выполнена: ${objective.text}`, 'success')
    this.playSound('objective')
    this.emitView(true)
    return true
  }

  private incrementObjective(id: string): void {
    const objective = this.objectives.find((entry) => entry.id === id)
    if (!objective || objective.done) return
    objective.progress = Math.min(objective.target ?? 1, (objective.progress ?? 0) + 1)
    if (objective.progress >= (objective.target ?? 1)) this.completeObjective(id)
  }

  private isObjectiveDone(id: string): boolean {
    return this.objectives.some((objective) => objective.id === id && objective.done)
  }

  private endGame(result: 'victory' | 'defeat'): void {
    if (this.ended) return
    this.ended = true
    this.updateMusicVolume()
    this.keys.clear()
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    this.callbacks.onEnd(result)
    this.playSound(result === 'victory' ? 'victory' : 'down')
    this.emitView(true)
  }

  private emitView(force: boolean): void {
    const now = performance.now()
    if (!force && now - this.lastViewAt < 90) return
    this.lastViewAt = now
    const markers: MapMarker[] = [
      {
        id: 'player',
        x: this.player.position.x,
        z: this.player.position.z,
        kind: 'player',
      },
      {
        id: 'caravan',
        x: this.caravan.position.x,
        z: this.caravan.position.z,
        kind: 'caravan',
      },
      { id: 'village', x: -46, z: -39, kind: 'landmark' },
      { id: 'palace', x: 42, z: -42, kind: 'landmark' },
      { id: 'forest', x: -45, z: 42, kind: 'landmark' },
      { id: 'fort', x: 45, z: 44, kind: 'landmark' },
    ]
    for (const actor of this.actors) {
      if (!actor.alive) continue
      markers.push({
        id: actor.id,
        x: actor.mesh.position.x,
        z: actor.mesh.position.z,
        kind: actor.faction === this.faction ? 'ally' : 'enemy',
      })
    }
    const view: GameView = {
      faction: this.faction,
      health: Math.max(0, this.health),
      maxHealth: 100,
      stamina: this.stamina,
      gold: this.gold,
      kills: this.kills,
      damage: this.damage,
      zone: zoneAt(this.player.position.x, this.player.position.z),
      body: { ...this.body },
      objectives: this.objectives.map((objective) => ({ ...objective })),
      prompt: this.prompt,
      markers,
      squad: this.actors.filter((actor) => actor.alive && actor.faction === this.faction && actor.role !== 'commander')
        .length,
      elapsed: this.elapsed,
      pointerLocked: document.pointerLockElement === this.renderer.domElement,
      paused: this.paused,
      caravanCooldown: this.caravanCooldown,
    }
    this.callbacks.onView(view)
  }

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight(this.palette.surface, this.palette.borderStrong, 2.2)
    this.scene.add(hemisphere)
    const sun = new THREE.DirectionalLight(this.palette.surface, 3.5)
    sun.position.set(-35, 58, 24)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -85
    sun.shadow.camera.right = 85
    sun.shadow.camera.top = 85
    sun.shadow.camera.bottom = -85
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 150
    this.scene.add(sun)
  }

  private createSurfaceTexture(
    key: string,
    base: THREE.Color,
    detail: THREE.Color,
    pattern: 'grass' | 'dirt' | 'stone' | 'scree' | 'wood' | 'roof',
    repeatX: number,
    repeatY: number,
  ): THREE.CanvasTexture {
    const cached = this.generatedTextures.get(key)
    if (cached) return cached

    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) throw new Error(`Could not create procedural texture: ${key}`)
    context.imageSmoothingEnabled = false
    context.fillStyle = base.getStyle()
    context.fillRect(0, 0, canvas.width, canvas.height)

    let seed = 17
    for (const character of key) seed = (seed * 31 + character.charCodeAt(0)) % 2147483647
    const random = seededRandom(Math.max(1, seed))
    const light = mix(detail, this.palette.surface, 0.34)
    const dark = mix(detail, this.palette.text, 0.3)

    if (pattern === 'grass') {
      for (let index = 0; index < 210; index += 1) {
        context.fillStyle = (index % 5 === 0 ? light : index % 3 === 0 ? dark : detail).getStyle()
        const x = Math.floor(random() * 64)
        const y = Math.floor(random() * 64)
        context.fillRect(x, y, index % 7 === 0 ? 2 : 1, 1 + Math.floor(random() * 3))
      }
    } else if (pattern === 'dirt' || pattern === 'scree') {
      const count = pattern === 'scree' ? 175 : 130
      for (let index = 0; index < count; index += 1) {
        context.fillStyle = (index % 4 === 0 ? light : index % 2 === 0 ? dark : detail).getStyle()
        const size = pattern === 'scree' ? 1 + Math.floor(random() * 4) : 1 + Math.floor(random() * 2)
        context.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), size, size)
      }
    } else if (pattern === 'stone') {
      context.strokeStyle = detail.getStyle()
      context.lineWidth = 2
      for (let y = 0; y <= 64; y += 16) {
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(64, y)
        context.stroke()
        const offset = (y / 16) % 2 === 0 ? 0 : 12
        for (let x = offset; x <= 64; x += 24) {
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x, Math.min(64, y + 16))
          context.stroke()
        }
      }
      context.globalAlpha = 0.35
      for (let index = 0; index < 48; index += 1) {
        context.fillStyle = (index % 2 === 0 ? light : dark).getStyle()
        context.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), 2, 1)
      }
      context.globalAlpha = 1
    } else if (pattern === 'wood') {
      context.fillStyle = detail.getStyle()
      for (let y = 0; y < 64; y += 8) context.fillRect(0, y, 64, 1)
      context.globalAlpha = 0.6
      for (let index = 0; index < 36; index += 1) {
        context.fillStyle = (index % 3 === 0 ? light : dark).getStyle()
        const y = Math.floor(random() * 8) * 8 + 3
        context.fillRect(Math.floor(random() * 60), y, 2 + Math.floor(random() * 5), 1)
      }
      context.globalAlpha = 1
    } else {
      context.fillStyle = detail.getStyle()
      for (let y = 0; y < 64; y += 10) {
        context.fillRect(0, y, 64, 2)
        const offset = (y / 10) % 2 === 0 ? 0 : 8
        for (let x = offset; x < 64; x += 16) context.fillRect(x, y, 2, 10)
      }
      context.globalAlpha = 0.35
      context.fillStyle = light.getStyle()
      for (let index = 0; index < 42; index += 1) {
        context.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), 2, 1)
      }
      context.globalAlpha = 1
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeatX, repeatY)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestMipmapNearestFilter
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
    this.generatedTextures.set(key, texture)
    return texture
  }

  private createAtmosphere(): void {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create sky texture')
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, mix(this.palette.link, this.palette.bg, 0.7).getStyle())
    gradient.addColorStop(0.58, mix(this.palette.surface, this.palette.bg, 0.35).getStyle())
    gradient.addColorStop(1, mix(this.palette.warning, this.palette.bg, 0.86).getStyle())
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    const skyTexture = new THREE.CanvasTexture(canvas)
    skyTexture.colorSpace = THREE.SRGBColorSpace
    skyTexture.minFilter = THREE.LinearFilter
    skyTexture.magFilter = THREE.LinearFilter
    this.generatedTextures.set('sky-gradient', skyTexture)

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(178, 32, 18),
      new THREE.MeshBasicMaterial({
        map: skyTexture,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    )
    this.scene.add(sky)

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 12),
      new THREE.MeshBasicMaterial({ color: this.palette.warning, fog: false }),
    )
    sun.position.set(-88, 74, -112)
    this.scene.add(sun)

    const random = seededRandom(731)
    const cloudGeometry = new THREE.DodecahedronGeometry(3.4, 1)
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: this.palette.surface,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      fog: true,
    })
    for (let index = 0; index < 10; index += 1) {
      const group = new THREE.Group()
      for (let puff = 0; puff < 4; puff += 1) {
        const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial)
        cloud.position.set((puff - 1.5) * 3.6, Math.sin(puff) * 1.1, (random() - 0.5) * 2.4)
        cloud.scale.set(1 + random() * 0.8, 0.45 + random() * 0.35, 0.7 + random() * 0.5)
        group.add(cloud)
      }
      group.position.set(-105 + random() * 210, 30 + random() * 18, -90 + random() * 180)
      group.userData.baseY = group.position.y
      this.clouds.push({ group, speed: 0.7 + random() * 0.75 })
      this.scene.add(group)
    }
  }

  private createGroundScatter(): void {
    const dummy = new THREE.Object3D()
    const random = seededRandom(1249)

    const grass = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.1, 0.7, 3).translate(0, 0.35, 0),
      new THREE.MeshStandardMaterial({
        color: mix(this.palette.success, this.palette.bg, 0.18),
        roughness: 1,
      }),
      420,
    )
    for (let index = 0; index < 420; index += 1) {
      let x = -78 + random() * 76
      let z = random() > 0.38 ? 2 + random() * 76 : -78 + random() * 76
      while (Math.abs(x) < 4 || Math.abs(z + 23) < 4) {
        x = -78 + random() * 76
        z = random() > 0.38 ? 2 + random() * 76 : -78 + random() * 76
      }
      const scale = 0.6 + random() * 1.2
      dummy.position.set(x, 0.02, z)
      dummy.rotation.set(0, random() * Math.PI, (random() - 0.5) * 0.18)
      dummy.scale.set(scale, scale, scale)
      dummy.updateMatrix()
      grass.setMatrixAt(index, dummy.matrix)
    }
    grass.instanceMatrix.needsUpdate = true
    grass.computeBoundingSphere()
    this.scene.add(grass)

    const flowers = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({
        color: this.palette.warning,
        emissive: this.palette.warning,
        emissiveIntensity: 0.12,
        roughness: 0.8,
      }),
      64,
    )
    const flowerStems = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.022, 0.034, 0.52, 5),
      new THREE.MeshStandardMaterial({
        color: mix(this.palette.success, this.palette.text, 0.18),
        roughness: 1,
      }),
      64,
    )
    for (let index = 0; index < 64; index += 1) {
      const x = -76 + random() * 70
      const z = 5 + random() * 70
      const bloomHeight = 0.52 + random() * 0.18
      const scale = 0.65 + random() * 0.75
      dummy.position.set(x, bloomHeight, z)
      dummy.rotation.set(random(), random(), random())
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      flowers.setMatrixAt(index, dummy.matrix)
      dummy.position.set(x, bloomHeight * 0.5, z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(scale, bloomHeight / 0.52, scale)
      dummy.updateMatrix()
      flowerStems.setMatrixAt(index, dummy.matrix)
    }
    flowers.instanceMatrix.needsUpdate = true
    flowers.computeBoundingSphere()
    flowerStems.instanceMatrix.needsUpdate = true
    flowerStems.computeBoundingSphere()
    this.scene.add(flowerStems, flowers)

    const pebbles = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.26, 0),
      new THREE.MeshStandardMaterial({
        color: mix(this.palette.borderStrong, this.palette.accent, 0.22),
        roughness: 1,
      }),
      110,
    )
    for (let index = 0; index < 110; index += 1) {
      const x = 3 + random() * 74
      const z = 3 + random() * 74
      dummy.position.set(x, 0.14, z)
      dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)
      dummy.scale.set(0.45 + random() * 1.5, 0.4 + random() * 0.7, 0.45 + random() * 1.5)
      dummy.updateMatrix()
      pebbles.setMatrixAt(index, dummy.matrix)
    }
    pebbles.instanceMatrix.needsUpdate = true
    pebbles.computeBoundingSphere()
    this.scene.add(pebbles)
  }

  private updateAtmosphere(delta: number): void {
    this.clouds.forEach(({ group, speed }, index) => {
      group.position.x += speed * delta
      if (group.position.x > 112) group.position.x = -112
      group.position.y = Number(group.userData.baseY) + Math.sin(this.elapsed * 0.22 + index) * 0.65
    })
    this.flames.forEach((flame, index) => {
      const pulse = 1 + Math.sin(this.elapsed * 9 + index * 1.7) * 0.16
      const baseScale = Number(flame.userData.baseScale)
      flame.scale.setScalar(baseScale * pulse)
      const material = flame.material
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = 1.3 + Math.sin(this.elapsed * 11 + index) * 0.25
      }
    })
  }

  private buildWorld(): void {
    this.createAtmosphere()
    this.createGround()
    this.createRoads()
    this.createGroundScatter()
    this.createVillage()
    this.createPalace()
    this.createForest()
    this.createFort()
    this.createBoundary()
  }

  private createGround(): void {
    const zoneColors: Record<ZoneId, THREE.Color> = {
      neutral: mix(this.palette.warning, this.palette.soft, 0.8),
      palace: mix(this.palette.link, this.palette.soft, 0.86),
      forest: mix(this.palette.success, this.palette.soft, 0.76),
      fort: mix(this.palette.accent, this.palette.soft, 0.78),
    }
    const zones: Array<[ZoneId, number, number]> = [
      ['neutral', -40, -40],
      ['palace', 40, -40],
      ['forest', -40, 40],
      ['fort', 40, 40],
    ]
    for (const [zone, x, z] of zones) {
      const details: Record<ZoneId, THREE.Color> = {
        neutral: mix(this.palette.warning, this.palette.text, 0.36),
        palace: this.palette.borderStrong,
        forest: mix(this.palette.success, this.palette.text, 0.3),
        fort: mix(this.palette.accent, this.palette.borderStrong, 0.62),
      }
      const patterns: Record<ZoneId, 'grass' | 'stone' | 'scree'> = {
        neutral: 'grass',
        palace: 'stone',
        forest: 'grass',
        fort: 'scree',
      }
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 80),
        new THREE.MeshStandardMaterial({
          map: this.createSurfaceTexture(
            `ground-${zone}`,
            zoneColors[zone],
            details[zone],
            patterns[zone],
            zone === 'palace' ? 10 : 18,
            zone === 'palace' ? 10 : 18,
          ),
          roughness: 1,
        }),
      )
      ground.rotation.x = -Math.PI / 2
      ground.position.set(x, -0.04, z)
      ground.receiveShadow = true
      this.scene.add(ground)
    }
    const grid = new THREE.GridHelper(160, 32, this.palette.borderStrong, this.palette.border)
    grid.position.y = 0.015
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
    materials.forEach((material) => {
      material.transparent = true
      material.opacity = 0.09
    })
    this.scene.add(grid)
  }

  private createRoads(): void {
    const roadBase = mix(this.palette.borderStrong, this.palette.soft, 0.45)
    const roadDetail = mix(this.palette.warning, this.palette.text, 0.6)
    const horizontalRoadMaterial = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'road-dirt-horizontal',
        roadBase,
        roadDetail,
        'dirt',
        24,
        2,
      ),
      roughness: 1,
    })
    const verticalRoadMaterial = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'road-dirt-vertical',
        roadBase,
        roadDetail,
        'dirt',
        2,
        24,
      ),
      roughness: 1,
    })
    const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(150, 6), horizontalRoadMaterial)
    horizontal.rotation.x = -Math.PI / 2
    horizontal.position.set(0, 0.03, -23)
    horizontal.receiveShadow = true
    this.scene.add(horizontal)
    const vertical = new THREE.Mesh(new THREE.PlaneGeometry(6, 142), verticalRoadMaterial)
    vertical.rotation.x = -Math.PI / 2
    vertical.position.set(0, 0.035, 4)
    vertical.receiveShadow = true
    this.scene.add(vertical)

    const rutMaterial = new THREE.MeshStandardMaterial({
      color: mix(this.palette.borderStrong, this.palette.text, 0.45),
      roughness: 1,
      transparent: true,
      opacity: 0.34,
    })
    for (const offset of [-1.35, 1.35]) {
      const horizontalRut = new THREE.Mesh(new THREE.PlaneGeometry(150, 0.22), rutMaterial)
      horizontalRut.rotation.x = -Math.PI / 2
      horizontalRut.position.set(0, 0.045, -23 + offset)
      this.scene.add(horizontalRut)
      const verticalRut = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 142), rutMaterial)
      verticalRut.rotation.x = -Math.PI / 2
      verticalRut.position.set(offset, 0.05, 4)
      this.scene.add(verticalRut)
    }
  }

  private createVillage(): void {
    this.scene.add(this.createZoneLabel('ВОЛЬНЫЕ ЗЕМЛИ', -43, -52))
    const housePositions: Array<[number, number, number]> = [
      [-58, -50, 0.2],
      [-40, -55, -0.15],
      [-58, -34, -0.25],
      [-34, -37, 0.12],
    ]
    for (const [x, z, rotation] of housePositions) {
      this.scene.add(this.createHouse(x, z, rotation, false))
    }
    const shop = this.createHouse(this.vendorPosition.x, this.vendorPosition.z, 0.08, true)
    this.scene.add(shop)
    const sign = this.createSign('ЛЕКАРЬ • ПРОТЕЗЫ', this.vendorPosition.x, 4.5, this.vendorPosition.z + 2.8)
    this.scene.add(sign)
    const well = new THREE.Group()
    const stone = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'well-stone',
        this.palette.borderStrong,
        this.palette.border,
        'stone',
        4,
        2,
      ),
      roughness: 1,
    })
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1.2, 12, 1, true), stone)
    ring.position.y = 0.6
    ring.castShadow = true
    well.add(ring)
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 1.4, 8),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'village-roof',
          this.palette.accent,
          mix(this.palette.accent, this.palette.text, 0.45),
          'roof',
          5,
          3,
        ),
        roughness: 0.9,
      }),
    )
    roof.position.y = 3.4
    roof.castShadow = true
    well.add(roof)
    well.position.set(-48, 0, -47)
    this.scene.add(well)
  }

  private createPalace(): void {
    this.scene.add(this.createZoneLabel('ИМПЕРСКИЙ УДЕЛ', 43, -55))
    const palaceStone = mix(this.palette.link, this.palette.surface, 0.72)
    const stone = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'palace-stone',
        palaceStone,
        mix(this.palette.link, this.palette.borderStrong, 0.68),
        'stone',
        6,
        5,
      ),
      roughness: 0.78,
    })
    const trim = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'palace-roof',
        this.palette.warning,
        mix(this.palette.warning, this.palette.text, 0.4),
        'roof',
        5,
        4,
      ),
      metalness: 0.22,
      roughness: 0.55,
    })
    const palace = new THREE.Group()
    const keep = new THREE.Mesh(new THREE.BoxGeometry(18, 10, 14), stone)
    keep.position.y = 5
    keep.castShadow = true
    keep.receiveShadow = true
    palace.add(keep)
    const gate = new THREE.Mesh(new THREE.BoxGeometry(4.5, 6.2, 1), new THREE.MeshStandardMaterial({ color: this.palette.bg, roughness: 1 }))
    gate.position.set(0, 3.1, 7.1)
    palace.add(gate)
    for (const x of [-10, 10]) {
      for (const z of [-8, 8]) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 13, 10), stone)
        tower.position.set(x, 6.5, z)
        tower.castShadow = true
        palace.add(tower)
        const roof = new THREE.Mesh(new THREE.ConeGeometry(4.1, 4.5, 10), trim)
        roof.position.set(x, 15, z)
        roof.castShadow = true
        palace.add(roof)
      }
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(2.2, 4.2, 0.15), new THREE.MeshStandardMaterial({ color: this.palette.accent }))
    banner.position.set(0, 8.4, 7.62)
    palace.add(banner)
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.warning,
      emissive: this.palette.warning,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    })
    for (const x of [-5.5, 5.5]) {
      for (const y of [3.5, 6.5]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.18), windowMaterial)
        window.position.set(x, y, 7.16)
        palace.add(window)
      }
    }
    palace.add(this.createTorch(-2.8, 2.7, 7.7), this.createTorch(2.8, 2.7, 7.7))
    palace.position.set(44, 0, -47)
    this.scene.add(palace)
    this.scene.add(this.createBeacon(40, -36, this.palette.link))
  }

  private createForest(): void {
    this.scene.add(this.createZoneLabel('ЧАЩА ЭЛЕНВУДА', -44, 53))
    const random = seededRandom(217)
    for (let index = 0; index < 74; index += 1) {
      const x = -76 + random() * 70
      const z = 5 + random() * 70
      if (Math.hypot(x + 46, z - 43) < 12) continue
      const scale = 0.72 + random() * 0.9
      this.scene.add(this.createTreeLod(x, z, scale))
    }
    const huts: Array<[number, number]> = [
      [-51, 42],
      [-40, 49],
      [-39, 34],
    ]
    for (const [x, z] of huts) this.scene.add(this.createElfHut(x, z))
    this.scene.add(this.createBeacon(-48, 43, this.palette.success))
  }

  private createFort(): void {
    this.scene.add(this.createZoneLabel('ЧЁРНЫЙ КРЯЖ', 46, 54))
    const random = seededRandom(914)
    const rockMaterial = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'mountain-rock',
        mix(this.palette.accent, this.palette.borderStrong, 0.7),
        mix(this.palette.borderStrong, this.palette.text, 0.45),
        'scree',
        3,
        3,
      ),
      roughness: 1,
    })
    for (let index = 0; index < 35; index += 1) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.7 + random() * 3.2, 0),
        rockMaterial,
      )
      rock.position.set(7 + random() * 69, 0.7 + random() * 1.4, 5 + random() * 70)
      rock.scale.y = 0.7 + random() * 1.8
      rock.rotation.set(random(), random(), random())
      rock.castShadow = true
      rock.receiveShadow = true
      this.scene.add(rock)
    }

    const fort = new THREE.Group()
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'fort-stone',
        mix(this.palette.borderStrong, this.palette.bg, 0.32),
        mix(this.palette.accent, this.palette.border, 0.4),
        'stone',
        6,
        4,
      ),
      roughness: 1,
    })
    const wallA = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 2.5), wallMaterial)
    wallA.position.set(0, 3.5, -9)
    wallA.castShadow = true
    fort.add(wallA)
    const wallB = wallA.clone()
    wallB.position.z = 9
    fort.add(wallB)
    const sideA = new THREE.Mesh(new THREE.BoxGeometry(2.5, 7, 18), wallMaterial)
    sideA.position.set(-11, 3.5, 0)
    sideA.castShadow = true
    fort.add(sideA)
    const sideB = sideA.clone()
    sideB.position.x = 11
    fort.add(sideB)
    for (const x of [-11, 11]) {
      for (const z of [-9, 9]) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 10, 8), wallMaterial)
        tower.position.set(x, 5, z)
        tower.castShadow = true
        fort.add(tower)
      }
    }
    const gate = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 2.8), new THREE.MeshStandardMaterial({ color: this.palette.bg }))
    gate.position.set(0, 2.5, -9)
    fort.add(gate)
    const flag = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 0.15), new THREE.MeshStandardMaterial({ color: this.palette.accent }))
    flag.position.set(0, 12, 0)
    fort.add(flag)
    fort.add(this.createTorch(-3.4, 2.8, -10.1), this.createTorch(3.4, 2.8, -10.1))
    fort.position.set(47, 0, 45)
    this.scene.add(fort)
    this.scene.add(this.createBeacon(47, 45, this.palette.accent))
  }

  private createBoundary(): void {
    const material = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'boundary-stone',
        mix(this.palette.borderStrong, this.palette.bg, 0.4),
        this.palette.border,
        'scree',
        2,
        2,
      ),
      roughness: 1,
    })
    for (let index = -76; index <= 76; index += 8) {
      for (const [x, z] of [
        [index, -79],
        [index, 79],
        [-79, index],
        [79, index],
      ]) {
        const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), material)
        stone.position.set(x, 0.65, z)
        stone.scale.y = 1.6
        stone.rotation.y = index
        stone.castShadow = true
        this.scene.add(stone)
      }
    }
  }

  private createTorch(x: number, y: number, z: number): THREE.Group {
    const group = new THREE.Group()
    const bracket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 1.5, 6),
      new THREE.MeshStandardMaterial({
        color: this.palette.borderStrong,
        metalness: 0.6,
        roughness: 0.4,
      }),
    )
    bracket.position.y = -0.72
    bracket.castShadow = true
    group.add(bracket)
    const flameMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.warning,
      emissive: this.palette.warning,
      emissiveIntensity: 1.3,
      roughness: 0.3,
    })
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 7), flameMaterial)
    flame.position.y = 0.25
    flame.userData.baseScale = 1
    this.flames.push(flame)
    group.add(flame)
    const light = new THREE.PointLight(this.palette.warning, 1.4, 11, 2)
    light.position.y = 0.35
    group.add(light)
    group.position.set(x, y, z)
    return group
  }

  private createHouse(x: number, z: number, rotation: number, shop: boolean): THREE.Group {
    const group = new THREE.Group()
    const woodBase = shop
      ? mix(this.palette.warning, this.palette.soft, 0.55)
      : mix(this.palette.accent, this.palette.soft, 0.72)
    const wood = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        shop ? 'shop-timber' : 'village-timber',
        woodBase,
        mix(this.palette.warning, this.palette.text, 0.52),
        'wood',
        4,
        4,
      ),
      roughness: 0.95,
    })
    const body = new THREE.Mesh(new THREE.BoxGeometry(shop ? 9 : 7, 4.8, shop ? 7 : 6), wood)
    body.position.y = 2.4
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(shop ? 7 : 5.7, 3.5, 4),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'house-shingles',
          this.palette.accent,
          mix(this.palette.accent, this.palette.text, 0.4),
          'roof',
          5,
          4,
        ),
        roughness: 1,
      }),
    )
    roof.position.y = 6.5
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    group.add(roof)
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 2.8, 0.3),
      new THREE.MeshStandardMaterial({ color: this.palette.bg, roughness: 1 }),
    )
    door.position.set(0, 1.4, (shop ? 3.5 : 3) + 0.16)
    group.add(door)
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.warning,
      emissive: this.palette.warning,
      emissiveIntensity: shop ? 0.75 : 0.38,
      roughness: 0.4,
    })
    const windowOffset = shop ? 2.7 : 2.1
    for (const windowX of [-windowOffset, windowOffset]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 0.18), windowMaterial)
      window.position.set(windowX, 2.75, (shop ? 3.5 : 3) + 0.18)
      group.add(window)
    }
    group.position.set(x, 0, z)
    group.rotation.y = rotation
    return group
  }

  private createElfHut(x: number, z: number): THREE.Group {
    const group = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'elf-hut-bark',
        mix(this.palette.warning, this.palette.bg, 0.55),
        mix(this.palette.warning, this.palette.text, 0.55),
        'wood',
        5,
        4,
      ),
      roughness: 1,
    })
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.3, 5.5, 9), wood)
    trunk.position.y = 2.75
    trunk.castShadow = true
    group.add(trunk)
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(4.8, 4, 9),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'elf-leaf-roof',
          mix(this.palette.success, this.palette.bg, 0.25),
          mix(this.palette.success, this.palette.text, 0.36),
          'roof',
          6,
          4,
        ),
        roughness: 1,
      }),
    )
    roof.position.y = 7
    roof.castShadow = true
    group.add(roof)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.6, 0.25), new THREE.MeshStandardMaterial({ color: this.palette.bg }))
    door.position.set(0, 1.3, 3.05)
    group.add(door)
    group.position.set(x, 0, z)
    return group
  }

  private getTreeSpriteTexture(): THREE.CanvasTexture {
    const cached = this.generatedTextures.get('tree-sprite')
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 96
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create tree sprite texture')
    context.imageSmoothingEnabled = false
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--cp-warning').trim()
    context.fillRect(28, 45, 8, 45)
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--cp-success').trim()
    context.beginPath()
    context.moveTo(32, 2)
    context.lineTo(5, 66)
    context.lineTo(59, 66)
    context.closePath()
    context.fill()
    context.beginPath()
    context.moveTo(32, 20)
    context.lineTo(9, 82)
    context.lineTo(55, 82)
    context.closePath()
    context.fill()
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestMipmapNearestFilter
    this.generatedTextures.set('tree-sprite', texture)
    return texture
  }

  private createTreeLod(x: number, z: number, scale: number): THREE.LOD {
    const lod = new THREE.LOD()
    const near = new THREE.Group()
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.62, 4.5, 7),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'tree-bark',
          mix(this.palette.warning, this.palette.bg, 0.45),
          mix(this.palette.warning, this.palette.text, 0.58),
          'wood',
          2,
          5,
        ),
        roughness: 1,
      }),
    )
    trunk.position.y = 2.25
    trunk.castShadow = true
    near.add(trunk)
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: mix(this.palette.success, this.palette.bg, 0.12),
      roughness: 1,
    })
    for (const [height, radius] of [
      [4.4, 2.6],
      [6.1, 2.1],
      [7.6, 1.45],
    ]) {
      const foliage = new THREE.Mesh(new THREE.ConeGeometry(radius, 3.4, 8), foliageMaterial)
      foliage.position.y = height
      foliage.castShadow = true
      near.add(foliage)
    }
    near.scale.setScalar(scale)
    lod.addLevel(near, 0)

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.getTreeSpriteTexture(), transparent: true }),
    )
    sprite.scale.set(5.5 * scale, 8.2 * scale, 1)
    sprite.position.y = 4 * scale
    lod.addLevel(sprite, 25)
    lod.position.set(x, 0, z)
    return lod
  }

  private createCharacter(faction: Faction, player: boolean): THREE.Group {
    const group = new THREE.Group()
    const factionMaterial = new THREE.MeshStandardMaterial({
      color: this.factionColor(faction),
      roughness: 0.72,
      metalness: faction === 'guard' ? 0.35 : 0.08,
    })
    const skinMaterial = new THREE.MeshStandardMaterial({
      color: mix(this.palette.warning, this.palette.surface, 0.7),
      roughness: 0.86,
    })
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: mix(this.palette.text, this.palette.bg, 0.28),
      roughness: 0.8,
      metalness: 0.24,
    })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(player ? 1.05 : 0.9, 1.3, 0.58), factionMaterial)
    torso.position.y = 1.72
    torso.castShadow = true
    group.add(torso)

    const head = new THREE.Mesh(
      faction === 'elf' ? new THREE.ConeGeometry(0.44, 0.88, 8) : new THREE.SphereGeometry(0.43, 10, 8),
      skinMaterial,
    )
    head.position.y = 2.72
    if (faction === 'elf') head.rotation.z = Math.PI
    head.castShadow = true
    group.add(head)

    for (const [name, x] of [
      ['leftArm', -0.68],
      ['rightArm', 0.68],
    ] as const) {
      const pivot = new THREE.Group()
      pivot.name = name
      pivot.position.set(x, 2.2, 0)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.18, 0.3), factionMaterial)
      arm.position.y = -0.52
      arm.castShadow = true
      pivot.add(arm)
      group.add(pivot)
    }
    for (const [name, x] of [
      ['leftLeg', -0.28],
      ['rightLeg', 0.28],
    ] as const) {
      const pivot = new THREE.Group()
      pivot.name = name
      pivot.position.set(x, 1.08, 0)
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.12, 0.42), darkMaterial)
      leg.position.y = -0.5
      leg.castShadow = true
      pivot.add(leg)
      group.add(pivot)
    }

    const weaponPivot = new THREE.Group()
    weaponPivot.name = 'weapon'
    weaponPivot.position.set(0.88, 1.75, 0.1)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.65, 0.24), darkMaterial)
    blade.position.y = -0.15
    blade.rotation.z = -0.2
    blade.castShadow = true
    weaponPivot.add(blade)
    group.add(weaponPivot)

    if (faction === 'guard') {
      const helmet = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.53, 0.48, 8), darkMaterial)
      helmet.position.y = 3.02
      helmet.castShadow = true
      group.add(helmet)
    } else if (faction === 'villain') {
      const horns = [-0.28, 0.28].map((x) => {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.65, 7), darkMaterial)
        horn.position.set(x, 3.25, 0)
        horn.rotation.z = x > 0 ? -0.3 : 0.3
        horn.castShadow = true
        return horn
      })
      horns.forEach((horn) => group.add(horn))
    }

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    return group
  }

  private createCaravan(): THREE.Group {
    const group = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({
      map: this.createSurfaceTexture(
        'caravan-wood',
        mix(this.palette.warning, this.palette.bg, 0.48),
        mix(this.palette.warning, this.palette.text, 0.55),
        'wood',
        4,
        3,
      ),
      roughness: 0.92,
    })
    const metal = new THREE.MeshStandardMaterial({
      color: this.palette.borderStrong,
      roughness: 0.55,
      metalness: 0.45,
    })
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.65, 3.1), wood)
    base.position.y = 1.6
    base.castShadow = true
    group.add(base)
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 2.5, 2.5),
      new THREE.MeshStandardMaterial({
        map: this.createSurfaceTexture(
          'caravan-crate',
          this.palette.warning,
          mix(this.palette.warning, this.palette.text, 0.42),
          'wood',
          3,
          3,
        ),
        roughness: 0.8,
        emissive: this.palette.bg,
      }),
    )
    cargo.name = 'cargo'
    cargo.position.y = 3
    cargo.castShadow = true
    group.add(cargo)
    const wheelGeometry = new THREE.CylinderGeometry(0.9, 0.9, 0.32, 12)
    wheelGeometry.rotateX(Math.PI / 2)
    const spokeMaterial = new THREE.MeshStandardMaterial({
      color: mix(this.palette.warning, this.palette.borderStrong, 0.55),
      metalness: 0.22,
      roughness: 0.62,
    })
    for (const x of [-1.7, 1.7]) {
      for (const z of [-1.72, 1.72]) {
        const wheel = new THREE.Group()
        wheel.name = 'wheel'
        wheel.position.set(x, 1.05, z)
        const tire = new THREE.Mesh(wheelGeometry, metal)
        tire.castShadow = true
        wheel.add(tire)
        const horizontalSpoke = new THREE.Mesh(
          new THREE.BoxGeometry(1.45, 0.12, 0.38),
          spokeMaterial,
        )
        const verticalSpoke = horizontalSpoke.clone()
        verticalSpoke.rotation.z = Math.PI / 2
        wheel.add(horizontalSpoke, verticalSpoke)
        group.add(wheel)
      }
    }
    const horse = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1), wood)
    horse.position.set(4.2, 1.9, 0)
    horse.castShadow = true
    group.add(horse)
    const horseHead = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.8), wood)
    horseHead.position.set(5.15, 2.7, 0)
    horseHead.castShadow = true
    group.add(horseHead)
    group.position.set(-54, 0, -23)
    return group
  }

  private createZoneLabel(text: string, x: number, z: number): THREE.Sprite {
    return this.createSign(text, x, 9, z, 17, 3.2)
  }

  private createSign(
    text: string,
    x: number,
    y: number,
    z: number,
    width = 12,
    height = 2.5,
  ): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 96
    const context = canvas.getContext('2d')
    if (context) {
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--cp-panel-strong').trim()
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--cp-accent').trim()
      context.lineWidth = 7
      context.strokeRect(3.5, 3.5, canvas.width - 7, canvas.height - 7)
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--cp-text').trim()
      context.font = '700 31px "Segoe UI", Aptos, Calibri, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(text, canvas.width / 2, canvas.height / 2)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    this.generatedTextures.set(`sign-${text}`, texture)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
    sprite.position.set(x, y, z)
    sprite.scale.set(width, height, 1)
    sprite.renderOrder = 5
    return sprite
  }

  private createBeacon(x: number, z: number, color: THREE.Color): THREE.Group {
    const group = new THREE.Group()
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.16, 8, 24),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.22
    group.add(ring)
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.4, 5, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22 }),
    )
    column.position.y = 2.5
    group.add(column)
    group.position.set(x, 0, z)
    return group
  }

  private spawnPopulation(): void {
    const spawns: Array<[Faction, ActorRole, number, number]> = [
      ['guard', 'commander', 40, -36],
      ['guard', 'soldier', 32, -38],
      ['guard', 'soldier', 50, -33],
      ['guard', 'soldier', 56, -52],
      ['guard', 'soldier', 23, -24],
      ['guard', 'soldier', 8, -25],
      ['elf', 'scout', -48, 38],
      ['elf', 'scout', -38, 45],
      ['elf', 'scout', -56, 52],
      ['elf', 'scout', -27, 28],
      ['elf', 'scout', -12, 15],
      ['villain', 'minion', 43, 39],
      ['villain', 'minion', 53, 48],
      ['villain', 'minion', 37, 53],
      ['villain', 'minion', 27, 30],
      ['villain', 'minion', 12, 18],
    ]
    spawns.forEach(([faction, role, x, z], index) => this.spawnActor(faction, role, x, z, index))
  }

  private spawnActor(faction: Faction, role: ActorRole, x: number, z: number, index: number): Actor {
    const mesh = this.createCharacter(faction, false)
    mesh.position.set(x, 0, z)
    this.scene.add(mesh)
    const phase = index * 0.73
    const home = new THREE.Vector3(x, 0, z)
    const initialAngle = phase * 4.7
    const actor: Actor = {
      id: `${faction}-${role}-${index}-${Math.floor(this.elapsed * 10)}`,
      faction,
      role,
      mesh,
      hp: role === 'commander' ? 150 : 70,
      maxHp: role === 'commander' ? 150 : 70,
      speed: role === 'scout' ? 4.5 : role === 'commander' ? 0 : 3.7,
      alive: true,
      attackCooldown: 0,
      home,
      wanderTarget: home
        .clone()
        .add(new THREE.Vector3(Math.sin(initialAngle) * 4.5, 0, Math.cos(initialAngle) * 4.5)),
      wanderTimer: 3.5 + (index % 4),
      targetId: null,
      stride: 0,
      phase,
    }
    this.actors.push(actor)
    return actor
  }

  private spawnAmbush(): void {
    const x = this.caravan.position.x
    const z = this.caravan.position.z
    this.spawnActor('guard', 'soldier', x - 5, z - 4, this.actors.length + 1)
    this.spawnActor('guard', 'soldier', x + 5, z + 4, this.actors.length + 2)
    this.callbacks.onNotice('Засада! Охрана корована вступает в бой.', 'warning')
  }

  private findNearestEnemy(actor: Actor, range: number): Actor | null {
    const locked = actor.targetId
      ? this.actors.find((other) => other.id === actor.targetId)
      : undefined
    if (
      locked?.alive &&
      hostile(actor.faction, locked.faction) &&
      actor.mesh.position.distanceTo(locked.mesh.position) < range * 1.35
    ) {
      return locked
    }

    actor.targetId = null
    let nearest: Actor | null = null
    let bestDistance = range
    for (const other of this.actors) {
      if (!other.alive || other === actor || !hostile(actor.faction, other.faction)) continue
      const distance = actor.mesh.position.distanceTo(other.mesh.position)
      if (distance < bestDistance) {
        nearest = other
        bestDistance = distance
      }
    }
    actor.targetId = nearest?.id ?? null
    return nearest
  }

  private createHitParticles(position: THREE.Vector3, faction: Faction): void {
    for (let index = 0; index < 7; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12, 0),
        new THREE.MeshBasicMaterial({ color: this.factionColor(faction) }),
      )
      mesh.position.copy(position).add(new THREE.Vector3(0, 1.6, 0))
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4),
        life: 0.55 + Math.random() * 0.35,
      })
    }
  }

  private createBleedParticle(): void {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.08, 0),
      new THREE.MeshBasicMaterial({ color: this.palette.danger }),
    )
    mesh.position.copy(this.player.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 1, 0))
    this.scene.add(mesh)
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3(0, -0.2, 0),
      life: 0.7,
    })
  }

  private animateCharacter(group: THREE.Group, stride: number, attack: number): void {
    const leftArm = group.getObjectByName('leftArm')
    const rightArm = group.getObjectByName('rightArm')
    const leftLeg = group.getObjectByName('leftLeg')
    const rightLeg = group.getObjectByName('rightLeg')
    const weapon = group.getObjectByName('weapon')
    if (leftArm) leftArm.rotation.x = -stride * 0.7
    if (rightArm) rightArm.rotation.x = stride * 0.7 - attack * 1.15
    if (leftLeg) leftLeg.rotation.x = stride
    if (rightLeg) rightLeg.rotation.x = -stride
    if (weapon) weapon.rotation.x = -attack * 1.3
  }

  private updateCamera(immediate: boolean): void {
    const forward = new THREE.Vector3(Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw))
    const target = this.player.position.clone().add(new THREE.Vector3(0, 1.65, 0))
    const desired = target
      .clone()
      .addScaledVector(forward, -10)
      .add(new THREE.Vector3(0, 5.2 + this.cameraPitch * 3.5, 0))
    if (immediate) this.camera.position.copy(desired)
    else this.camera.position.lerp(desired, 0.12)
    this.camera.lookAt(target)
  }

  private factionColor(faction: Faction): THREE.Color {
    if (faction === 'elf') return this.palette.success
    if (faction === 'guard') return this.palette.link
    return this.palette.accent
  }

  private zoneName(zone: ZoneId): string {
    const names: Record<ZoneId, string> = {
      neutral: 'Вольные земли',
      palace: 'Имперский удел',
      forest: 'Чаща Эленвуда',
      fort: 'Чёрный кряж',
    }
    return names[zone]
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.paused && !this.ended) this.resumeAudio()
    if (
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
        event.code,
      )
    ) {
      event.preventDefault()
    }
    if (event.repeat && ['KeyE', 'KeyQ', 'KeyP', 'KeyF'].includes(event.code)) return
    this.keys.add(event.code)
    if (event.code === 'KeyE') this.interact()
    if (event.code === 'KeyQ') this.commandSquad()
    if (event.code === 'KeyP' || event.code === 'Escape') this.callbacks.onPauseRequest()
    if (event.code === 'KeyF') this.callbacks.onSaveRequest()
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keys.delete(event.code)
  }

  private onMouseMove(event: MouseEvent): void {
    if (document.pointerLockElement !== this.renderer.domElement || this.paused) return
    this.cameraYaw += event.movementX * 0.0028
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + event.movementY * 0.0018, -0.15, 0.72)
  }

  private onMouseDown(event: MouseEvent): void {
    if (!this.container.contains(event.target as Node) || this.paused || this.ended) return
    if (document.pointerLockElement !== this.renderer.domElement) {
      this.requestPointerLock()
      return
    }
    if (event.button === 0) this.attack()
  }

  private onPointerLockChange(): void {
    this.emitView(true)
  }

  private onVisibilityChange(): void {
    this.updateMusicVolume()
  }

  private resumeAudio(): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      this.startMusic()
    }
    if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => undefined)
  }

  private startMusic(): void {
    if (!this.audioContext || this.musicGain) return
    const musicWindow = window as MusicWindow
    if (
      musicWindow.__korovanyStopMusic &&
      musicWindow.__korovanyStopMusic !== this.stopMusicOwner
    ) {
      musicWindow.__korovanyStopMusic()
    }
    musicWindow.__korovanyStopMusic = this.stopMusicOwner

    const context = this.audioContext
    this.musicGain = context.createGain()
    this.musicGain.connect(context.destination)

    this.musicNoiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.12), context.sampleRate)
    const noise = this.musicNoiseBuffer.getChannelData(0)
    for (let index = 0; index < noise.length; index += 1) noise[index] = Math.random() * 2 - 1

    this.musicNextNoteTime = context.currentTime + 0.06
    this.updateMusicVolume()
    this.scheduleMusic()
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 40)
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer)
      this.musicTimer = null
    }

    const context = this.audioContext
    const gain = this.musicGain
    if (context && gain) {
      const now = context.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(0, now)
      gain.disconnect()
    }

    for (const source of this.musicSources) {
      try {
        source.stop()
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
          console.warn('Korovany: scheduled music source could not be stopped.', error)
        }
      }
      source.disconnect()
    }
    this.musicSources.clear()

    this.audioContext = null
    this.musicGain = null
    this.musicNoiseBuffer = null
    this.musicNextNoteTime = 0

    const musicWindow = window as MusicWindow
    if (musicWindow.__korovanyStopMusic === this.stopMusicOwner) {
      delete musicWindow.__korovanyStopMusic
    }
    if (context?.state !== 'closed') {
      context?.close().catch((error: unknown) => {
        console.warn('Korovany: audio context could not be closed.', error)
      })
    }
  }

  private updateMusicVolume(): void {
    if (!this.audioContext || !this.musicGain) return
    const target = document.hidden || this.musicMuted ? 0 : this.ended ? 0.035 : this.paused ? 0.08 : 0.18
    const now = this.audioContext.currentTime
    this.musicGain.gain.cancelScheduledValues(now)
    this.musicGain.gain.setTargetAtTime(target, now, 0.045)
  }

  private scheduleMusic(): void {
    if (!this.audioContext || !this.musicGain) return
    const context = this.audioContext
    const stepDuration = 60 / MUSIC_TEMPOS[this.faction] / 4
    if (this.musicNextNoteTime < context.currentTime - 0.5) {
      this.musicNextNoteTime = context.currentTime + 0.04
    }

    while (this.musicNextNoteTime < context.currentTime + 0.16) {
      if (!document.hidden && !this.musicMuted) this.scheduleMusicStep(this.musicNextNoteTime, stepDuration)
      this.musicStep = (this.musicStep + 1) % 128
      this.musicNextNoteTime += stepDuration
    }
  }

  private scheduleMusicStep(time: number, stepDuration: number): void {
    const zone = zoneAt(this.player.position.x, this.player.position.z)
    const chordOffsets = [0, -4, 3, -2]
    const chord = chordOffsets[Math.floor(this.musicStep / 16) % chordOffsets.length]
    const root = MUSIC_ROOTS[this.faction] + ZONE_MUSIC_SHIFTS[zone] + chord
    const pattern = MUSIC_PATTERNS[this.faction]
    const melody = root + pattern[this.musicStep % pattern.length]

    this.scheduleTone(melody, time, stepDuration * 0.82, 'square', 0.09)
    if (this.musicStep % 4 === 0) {
      this.scheduleTone(root - 12, time, stepDuration * 3.35, 'triangle', 0.12)
      this.scheduleTone(root + 7, time, stepDuration * 2.6, 'square', 0.025)
      this.scheduleKick(time)
    }
    if (this.musicStep % 8 === 4) this.scheduleNoise(time, 'snare')
    if (this.musicStep % 2 === 1) this.scheduleNoise(time, 'hat')
  }

  private scheduleTone(
    midi: number,
    time: number,
    duration: number,
    type: OscillatorType,
    volume: number,
  ): void {
    if (!this.audioContext || !this.musicGain) return
    const oscillator = this.trackMusicSource(this.audioContext.createOscillator())
    const envelope = this.audioContext.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(midiToFrequency(midi), time)
    envelope.gain.setValueAtTime(0.0001, time)
    envelope.gain.exponentialRampToValueAtTime(volume, time + 0.008)
    envelope.gain.setValueAtTime(volume * 0.72, time + duration * 0.55)
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration)
    oscillator.connect(envelope)
    envelope.connect(this.musicGain)
    oscillator.start(time)
    oscillator.stop(time + duration + 0.02)
  }

  private scheduleKick(time: number): void {
    if (!this.audioContext || !this.musicGain) return
    const oscillator = this.trackMusicSource(this.audioContext.createOscillator())
    const envelope = this.audioContext.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(125, time)
    oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.1)
    envelope.gain.setValueAtTime(0.16, time)
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.12)
    oscillator.connect(envelope)
    envelope.connect(this.musicGain)
    oscillator.start(time)
    oscillator.stop(time + 0.13)
  }

  private scheduleNoise(time: number, type: 'hat' | 'snare'): void {
    if (!this.audioContext || !this.musicGain || !this.musicNoiseBuffer) return
    const duration = type === 'hat' ? 0.035 : 0.1
    const source = this.trackMusicSource(this.audioContext.createBufferSource())
    const filter = this.audioContext.createBiquadFilter()
    const envelope = this.audioContext.createGain()
    source.buffer = this.musicNoiseBuffer
    filter.type = type === 'hat' ? 'highpass' : 'bandpass'
    filter.frequency.setValueAtTime(type === 'hat' ? 5200 : 1450, time)
    filter.Q.setValueAtTime(type === 'hat' ? 0.7 : 0.9, time)
    envelope.gain.setValueAtTime(type === 'hat' ? 0.035 : 0.08, time)
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration)
    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(this.musicGain)
    source.start(time, 0, duration)
    source.stop(time + duration)
  }

  private trackMusicSource<T extends AudioScheduledSourceNode>(source: T): T {
    this.musicSources.add(source)
    source.addEventListener('ended', () => this.musicSources.delete(source), { once: true })
    return source
  }

  private playSound(
    type: 'swing' | 'hit' | 'hurt' | 'coin' | 'command' | 'objective' | 'jump' | 'down' | 'save' | 'victory',
  ): void {
    if (!this.audioContext) return
    const frequencies: Record<typeof type, [number, number, number]> = {
      swing: [180, 90, 0.08],
      hit: [110, 55, 0.11],
      hurt: [150, 75, 0.16],
      coin: [660, 920, 0.14],
      command: [240, 360, 0.18],
      objective: [440, 880, 0.28],
      jump: [220, 310, 0.09],
      down: [120, 45, 0.32],
      save: [520, 680, 0.2],
      victory: [392, 784, 0.52],
    }
    const [start, end, duration] = frequencies[type]
    const oscillator = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()
    oscillator.type = type === 'hit' || type === 'hurt' ? 'sawtooth' : 'triangle'
    oscillator.frequency.setValueAtTime(start, this.audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), this.audioContext.currentTime + duration)
    gain.gain.setValueAtTime(0.0001, this.audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, this.audioContext.currentTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + duration)
    oscillator.connect(gain)
    gain.connect(this.audioContext.destination)
    oscillator.start()
    oscillator.stop(this.audioContext.currentTime + duration)
  }
}
