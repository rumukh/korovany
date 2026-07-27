import * as THREE from 'three'

/**
 * GLSL injected into `MeshStandardMaterial` to get the marching-comic look.
 *
 * Why injection rather than a bespoke `ShaderMaterial`: shadows, fog, instancing,
 * vertex colours, tone mapping, emissive maps and the day/night light rig are all
 * already load-bearing in this game. Re-implementing three's light loop would mean
 * re-implementing every one of them. So three keeps its loop, and we reshape the
 * result: band the direct diffuse term, tint the ambient by how lit the surface is,
 * add a Fresnel rim, and break up large flat plates with a slow world-space wobble.
 *
 * Deliberately *not* touched: specular, emissive, transparency, and the final
 * pixel. Posterizing `gl_FragColor` would eat emissive FX, particles and the sky.
 */

/** Marks a material as carrying the stylized injection. */
export const STYLIZED_PROGRAM_KEY = 'korovany-stylized-v1'
export const OUTLINE_PROGRAM_KEY = 'korovany-outline-v1'

export interface StylizedSharedUniforms {
  /** Four-band lighting ramp shared by the whole game. */
  uToonRamp: { value: THREE.DataTexture }
  /**
   * Direct-light luminance that maps to the top of the ramp. Tracks the key light
   * so bands stay in the same place at noon and at midnight.
   */
  uBandReference: { value: number }
  /** Rim colour, normally the sky colour of the current day/night keyframe. */
  uRimColor: { value: THREE.Color }
  /** Ambient tint applied where a surface is unlit. */
  uShadowTint: { value: THREE.Color }
  /** Strength of the world-space "paper tooth" luminance wobble. */
  uPaperStrength: { value: number }
}

export interface OutlineSharedUniforms {
  /** View-space extrusion per unit of depth. Keeps ink width constant on screen. */
  uOutlineThickness: { value: number }
  uOutlineMinDepth: { value: number }
  uOutlineMaxDepth: { value: number }
}

const STYLIZED_VERTEX_HEADER = /* glsl */ `
varying vec3 vStylizedWorld;
`

const STYLIZED_VERTEX_BODY = /* glsl */ `
#include <project_vertex>
{
  vec4 kStylizedLocal = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    kStylizedLocal = instanceMatrix * kStylizedLocal;
  #endif
  vStylizedWorld = ( modelMatrix * kStylizedLocal ).xyz;
}
`

const STYLIZED_FRAGMENT_HEADER = /* glsl */ `
uniform sampler2D uToonRamp;
uniform float uBandReference;
uniform vec3 uRimColor;
uniform vec3 uShadowTint;
uniform float uPaperStrength;
uniform float uBandStrength;
uniform float uRimStrength;
uniform float uRimPower;
varying vec3 vStylizedWorld;

float kStylizedLuminance( const in vec3 rgb ) {
  return dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
}
`

const STYLIZED_FRAGMENT_BODY = /* glsl */ `
#include <lights_fragment_end>
{
  // reflectedLight.directDiffuse == sum( N.L * lightColor ) * diffuseColor / PI,
  // so the aggregate lighting term only comes back by dividing the albedo out.
  // Doing that per channel makes the band depend on hue rather than on light: a
  // saturated red surface has no green or blue to divide back, so its luminance
  // collapses onto the 0.2126 red weight and it bands several stops darker than a
  // white surface under identical light. Faction colours would each sit in a
  // different band. One scalar ratio of luminances cancels the weights instead.
  vec3 kAlbedo = material.diffuseColor;
  float kAlbedoLuma = max( kStylizedLuminance( kAlbedo ), 1e-4 );
  float kLit = kStylizedLuminance( reflectedLight.directDiffuse ) * PI / kAlbedoLuma;
  float kNormalized = clamp( kLit / max( uBandReference, 1e-3 ), 0.0, 1.0 );
  float kBanded = texture2D( uToonRamp, vec2( kNormalized, 0.5 ) ).r;
  float kScale = kBanded / max( kNormalized, 1e-3 );
  reflectedLight.directDiffuse *= mix( 1.0, kScale, uBandStrength );

  // Unlit surfaces drift towards the sky tint instead of towards flat grey.
  reflectedLight.indirectDiffuse *= mix(
    uShadowTint,
    vec3( 1.0 ),
    clamp( kNormalized * 1.7, 0.0, 1.0 )
  );

  float kRim = pow( 1.0 - clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 ), uRimPower );
  kRim *= smoothstep( 0.02, 0.4, kNormalized ) * uRimStrength;
  reflectedLight.directDiffuse += uRimColor * kRim * kAlbedo;

  // Three cheap sines beat a noise texture: no sampler, no tiling, no memory, and
  // the wobble is anchored in world space so it never swims with the camera.
  float kTooth =
    sin( vStylizedWorld.x * 3.1 ) *
    sin( vStylizedWorld.y * 2.7 + 1.3 ) *
    sin( vStylizedWorld.z * 3.7 + 2.1 );
  float kToothScale = 1.0 + kTooth * uPaperStrength;
  reflectedLight.directDiffuse *= kToothScale;
  reflectedLight.indirectDiffuse *= kToothScale;
}
`

const OUTLINE_VERTEX_HEADER = /* glsl */ `
uniform float uOutlineThickness;
uniform float uOutlineMinDepth;
uniform float uOutlineMaxDepth;
`

const OUTLINE_SMOOTH_ATTRIBUTE = /* glsl */ `
attribute vec3 outlineNormal;
`

/**
 * Replaces `project_vertex` so the hull is extruded in **view space**.
 *
 * A uniform object-space scale — what the previous implementation used — makes ink
 * width depend on the shape: `1.045` on a 0.12 x 1.65 blade is a 0.005-unit line on
 * one axis and 0.07 on another. Offsetting along the view-space normal by a
 * depth-proportional amount instead gives a line of near-constant screen width on
 * any shape, and clamping the depth term makes distant props fade to a hairline
 * rather than staying boldly outlined at the horizon.
 */
function outlineProjection(smooth: boolean): string {
  const source = smooth ? 'outlineNormal' : 'normal'
  return /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
vec3 kOutlineNormal = ${source};
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  // Not mat3( instanceMatrix ) * normal: that is the vertex transform, not the
  // inverse transpose, so a non-uniformly scaled instance skews its own ink and the
  // hull creeps inside the source. Mirrors three.js defaultnormal_vertex, which
  // divides by the squared basis lengths first. Shear is not supported either way.
  mat3 kInstanceBasis = mat3( instanceMatrix );
  vec3 kInstanceScaleSq = vec3(
    dot( kInstanceBasis[ 0 ], kInstanceBasis[ 0 ] ),
    dot( kInstanceBasis[ 1 ], kInstanceBasis[ 1 ] ),
    dot( kInstanceBasis[ 2 ], kInstanceBasis[ 2 ] )
  );
  kOutlineNormal = kInstanceBasis * ( kOutlineNormal / max( kInstanceScaleSq, vec3( 1e-8 ) ) );
#endif
mvPosition = modelViewMatrix * mvPosition;
vec3 kOutlineViewNormal = normalMatrix * kOutlineNormal;
float kOutlineLength = length( kOutlineViewNormal );
kOutlineViewNormal = kOutlineLength > 1e-6
  ? kOutlineViewNormal / kOutlineLength
  : vec3( 0.0, 0.0, 1.0 );
float kOutlineDepth = clamp( -mvPosition.z, uOutlineMinDepth, uOutlineMaxDepth );
mvPosition.xyz += kOutlineViewNormal * ( uOutlineThickness * kOutlineDepth );
gl_Position = projectionMatrix * mvPosition;
`
}

function requireInjectionPoint(source: string, token: string, label: string): void {
  if (!source.includes(token)) {
    throw new Error(
      `Stylized ${label} injection failed: "${token}" is missing from the three.js shader`,
    )
  }
}

/**
 * Marks a material as carrying the injection.
 *
 * Deliberately a symbol on the material itself rather than a `userData` entry:
 * `Material.copy()` deep-clones `userData` through JSON but copies neither
 * symbols nor `onBeforeCompile`. A clone therefore correctly reports "not
 * stylized" and can be repaired, instead of claiming a shader it does not have.
 *
 * Left **enumerable**, unlike the library's ownership marker, and the difference
 * is load-bearing. This flag tracks `onBeforeCompile`, which is an own enumerable
 * property, so the two propagate under exactly the same rule: `Object.assign` and
 * spread copy both, `clone()` copies neither. The flag can therefore never
 * disagree with the material it describes. Hiding it would produce a material that
 * carries the injection but reports none, and `adoptMaterial` would inject a
 * second time on top of the first. Ownership is the opposite case — it must never
 * propagate to a resource the library did not create — which is why that marker is
 * non-enumerable and this one is not.
 */
const STYLIZED_APPLIED = Symbol('stylizedShaderApplied')

function markStylizedShader(material: THREE.Material): void {
  ;(material as unknown as Record<symbol, boolean>)[STYLIZED_APPLIED] = true
}

/** True when this exact material instance carries the stylized injection. */
export function hasStylizedShader(material: THREE.Material): boolean {
  return (
    (material as unknown as Record<symbol, boolean>)[STYLIZED_APPLIED] === true
  )
}

/** Installs the banded-toon injection on a standard material. */
export function applyStylizedShader(
  material: THREE.MeshStandardMaterial,
  shared: StylizedSharedUniforms,
  perMaterial: {
    bandStrength: number
    rimStrength: number
    rimPower: number
  },
): void {
  markStylizedShader(material)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uToonRamp = shared.uToonRamp
    shader.uniforms.uBandReference = shared.uBandReference
    shader.uniforms.uRimColor = shared.uRimColor
    shader.uniforms.uShadowTint = shared.uShadowTint
    shader.uniforms.uPaperStrength = shared.uPaperStrength
    shader.uniforms.uBandStrength = { value: perMaterial.bandStrength }
    shader.uniforms.uRimStrength = { value: perMaterial.rimStrength }
    shader.uniforms.uRimPower = { value: perMaterial.rimPower }

    requireInjectionPoint(shader.vertexShader, '#include <project_vertex>', 'vertex')
    requireInjectionPoint(
      shader.fragmentShader,
      '#include <lights_fragment_end>',
      'fragment',
    )

    shader.vertexShader = STYLIZED_VERTEX_HEADER + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      STYLIZED_VERTEX_BODY,
    )
    shader.fragmentShader = STYLIZED_FRAGMENT_HEADER + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      STYLIZED_FRAGMENT_BODY,
    )
  }
  // three's default cache key is `onBeforeCompile.toString()`, so it would in fact
  // already separate stylized materials from stock ones and collapse ours onto a
  // single program. The override earns its place for two other reasons: it avoids
  // stringifying a closure inside `getParameters` on every material, and — the
  // load-bearing one — the source text is not always enough to tell two variants
  // apart. See `applyOutlineShader`, where smooth and flat share identical closure
  // source and differ only by a captured boolean; keying on the text alone would
  // collide them onto one program and render one of the two with the wrong shader.
  // Do not delete this on the grounds that three already handles it.
  material.customProgramCacheKey = () => STYLIZED_PROGRAM_KEY
  material.needsUpdate = true
}

/** Installs the normal-extrusion injection on an outline shell material. */
export function applyOutlineShader(
  material: THREE.MeshBasicMaterial,
  shared: OutlineSharedUniforms,
  smooth: boolean,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineThickness = shared.uOutlineThickness
    shader.uniforms.uOutlineMinDepth = shared.uOutlineMinDepth
    shader.uniforms.uOutlineMaxDepth = shared.uOutlineMaxDepth

    requireInjectionPoint(shader.vertexShader, '#include <project_vertex>', 'outline')

    shader.vertexShader =
      OUTLINE_VERTEX_HEADER +
      (smooth ? OUTLINE_SMOOTH_ATTRIBUTE : '') +
      shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      outlineProjection(smooth),
    )
  }
  // Captured, not written out: `smooth` never appears in this closure's source
  // text, so three's default `onBeforeCompile.toString()` key cannot tell the two
  // variants apart and would hand both the same compiled program.
  material.customProgramCacheKey = () =>
    `${OUTLINE_PROGRAM_KEY}:${smooth ? 'smooth' : 'flat'}`
  material.needsUpdate = true
}
