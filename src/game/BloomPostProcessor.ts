import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

const BLOOM_STRENGTH = 0.55
const BLOOM_RADIUS = 0.4
const BLOOM_THRESHOLD = 0.85

export class BloomPostProcessor {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.Camera
  private composer: EffectComposer | null = null
  private width = 1
  private height = 1

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    enabled: boolean,
  ) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.setEnabled(enabled)
  }

  setEnabled(enabled: boolean): void {
    if (enabled === Boolean(this.composer)) return
    if (!enabled) {
      this.disposeComposer()
      return
    }

    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD,
      ),
    )
    // OutputPass reads the renderer's ACES and exposure settings at render time.
    composer.addPass(new OutputPass())
    composer.setSize(this.width, this.height)
    this.composer = composer
  }

  render(): void {
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.composer?.setSize(this.width, this.height)
  }

  dispose(): void {
    this.disposeComposer()
  }

  private disposeComposer(): void {
    if (!this.composer) return
    this.composer.passes.forEach((pass) => pass.dispose())
    this.composer.dispose()
    this.composer = null
  }
}
