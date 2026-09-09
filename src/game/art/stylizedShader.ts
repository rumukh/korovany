import * as THREE from 'three'
import {
  artShaderKey,
  setArtMaterialFeatures,
  type ArtEnvironmentUniforms,
  type ArtShaderFeatures,
} from './ArtPresentation.ts'

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
  environment?: ArtEnvironmentUniforms
}

export interface OutlineSharedUniforms {
  /** View-space extrusion per unit of depth. Keeps ink width constant on screen. */
  uOutlineThickness: { value: number }
  uOutlineMinDepth: { value: number }
  uOutlineMaxDepth: { value: number }
  uOutlineViewport?: { value: THREE.Vector2 }
  uOutlinePixels?: { value: THREE.Vector2 }
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
  // RE_Direct_Physical accumulates material.diffuseContribution, which
  // lights_physical_fragment sets to diffuseColor * ( 1.0 - metalness ) — not
  // diffuseColor. So the identity is
  //
  //   directDiffuse == sum( N.L * lightColor ) * diffuseColor * ( 1 - metalness ) / PI
  //
  // and BOTH factors have to come back out to recover the aggregate lighting term.
  // Dividing only the albedo out leaves the band driver scaled by 1 - metalness,
  // which is a qualitative failure rather than a dim one: at metalness 0.35 the
  // driver peaks at 0.65, so the surface can never reach the top band however bright
  // the key is, and every band boundary is crossed 53.8% late. It also feeds the
  // shadow-tint mix and the rim gate below, costing metal up to 82% extra rim
  // suppression at low light. Metalness 0 is unaffected, exactly.
  //
  // Dividing the albedo *per channel* would be exact only while every channel has
  // something to divide back. It is not hue that breaks that: a faction green
  // (0.15, 0.55, 0.25) recovers the light exactly, because all three channels are
  // lit. It breaks where a channel reaches zero and the guard clamp takes over — a
  // saturated red keeps only the 0.2126 weight and reads 21% of the light a white
  // surface sees under identical key, and a saturated blue keeps 0.0722 and reads
  // 7%. Those surfaces band several stops too dark. One scalar ratio of luminances
  // cancels the weights instead, and is exact for every albedo.
  vec3 kAlbedo = material.diffuseColor;
  float kAlbedoLuma = max( kStylizedLuminance( kAlbedo ), 1e-4 );
  // Metalness is a scalar, so it divides back out alongside the luminance. The
  // 1e-3 floor only engages at metalness 1, where the numerator vanishes too — a
  // pre-existing limit of driving bands from the diffuse term, not a new one.
  float kDiffuseScale = kAlbedoLuma * max( 1.0 - material.metalness, 1e-3 );
  float kLit = kStylizedLuminance( reflectedLight.directDiffuse ) * PI / kDiffuseScale;
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
function outlineProjection(smooth: boolean, enhanced = false, wind = false): string {
  const source = smooth ? 'outlineNormal' : 'normal'
  return /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
vec3 kOutlineNormal = ${source};
#ifdef USE_SKINNING
  kOutlineNormal = vec4( skinMatrix * vec4( kOutlineNormal, 0.0 ) ).xyz;
#endif
${wind ? 'kOutlineNormal = kArtDeformNormal( kOutlineNormal );' : ''}
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
${enhanced ? `
vec4 kClip = projectionMatrix * mvPosition;
vec2 kDirection = ( projectionMatrix * vec4( kOutlineViewNormal, 0.0 ) ).xy;
float kDirectionLength = length( kDirection );
float kProjectedSize = projectionMatrix[ 1 ][ 1 ] * length( transformed ) *
  length( modelViewMatrix[ 1 ].xyz ) * uOutlineViewport.y / max( -mvPosition.z, 0.1 );
float kPixels = mix( uOutlinePixels.x, uOutlinePixels.y, smoothstep( 10.0, 100.0, kProjectedSize ) );
kPixels *= min( 1.0, uOutlineMaxDepth / max( -mvPosition.z, 0.1 ) );
kClip.xy += ( kDirection / max( kDirectionLength, 1e-6 ) ) *
  ( 2.0 * kPixels / uOutlineViewport ) * kClip.w;
gl_Position = kClip;
` : `
mvPosition.xyz += kOutlineViewNormal * ( uOutlineThickness * kOutlineDepth );
gl_Position = projectionMatrix * mvPosition;
`}
`
}

const ART_WIND_VERTEX = /* glsl */ `
attribute vec2 artWind;
uniform float uArtTime;
uniform vec3 uArtWind;
vec3 kArtWindShear() {
  mat4 basis = modelMatrix;
  #ifdef USE_INSTANCING
    basis = basis * instanceMatrix;
  #endif
  float phase = artWind.y * 6.2831853 + basis[ 3 ].x * 0.17 + basis[ 3 ].z * 0.11;
  float bend = sin( uArtTime * 1.8 + phase ) * artWind.x * uArtWind.z * 0.035;
  vec3 worldBend = vec3( uArtWind.x, 0.0, uArtWind.y ) * bend;
  mat3 axes = mat3( basis );
  return vec3( dot( axes[ 0 ], worldBend ), dot( axes[ 1 ], worldBend ), dot( axes[ 2 ], worldBend ) )
    / max( vec3( dot( axes[ 0 ], axes[ 0 ] ), dot( axes[ 1 ], axes[ 1 ] ), dot( axes[ 2 ], axes[ 2 ] ) ), vec3( 1e-8 ) );
}
vec3 kArtDeformNormal( vec3 n ) {
  vec3 shear = kArtWindShear();
  return normalize( vec3( n.x, ( n.y - shear.x * n.x - shear.z * n.z ) / max( 1.0 + shear.y, 0.1 ), n.z ) );
}
`

const ART_DITHER_FRAGMENT = /* glsl */ `
varying float vArtVisibility;
float kArtDither( vec2 pixel ) {
  vec2 p = mod( floor( pixel ), 4.0 );
  vec2 low = mod( p, 2.0 );
  vec2 high = floor( p / 2.0 );
  float a = 2.0 * low.x + 3.0 * low.y - 4.0 * low.x * low.y;
  float b = 2.0 * high.x + 3.0 * high.y - 4.0 * high.x * high.y;
  return ( 4.0 * a + b + 0.5 ) / 16.0;
}
`

type CompileShader = Parameters<THREE.Material['onBeforeCompile']>[0]

function applyArtVertex(
  shader: CompileShader,
  features: ArtShaderFeatures,
  environment: ArtEnvironmentUniforms | undefined,
  depth: boolean,
): void {
  if (environment) Object.assign(shader.uniforms, environment)
  if (features.attributes.wind) {
    if (!environment) throw new Error('Wind shader requires the shared presentation environment')
    shader.vertexShader = ART_WIND_VERTEX + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>',
      '#include <skinning_vertex>\ntransformed += kArtWindShear() * transformed.y;')
    if (!depth) shader.vertexShader = shader.vertexShader.replace('#include <skinnormal_vertex>',
      '#include <skinnormal_vertex>\nobjectNormal = kArtDeformNormal( objectNormal );')
  }
  if (!depth && features.enhanced) {
    shader.vertexShader = 'attribute float artVisibility;\nvarying float vArtVisibility;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvArtVisibility = artVisibility;')
    shader.fragmentShader = ART_DITHER_FRAGMENT + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif ( vArtVisibility < kArtDither( gl_FragCoord.xy ) ) discard;')
  }
  if (depth && features.shadowParticipation) {
    shader.vertexShader = 'attribute float artShadowParticipation;\nvarying float vArtShadowParticipation;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvArtShadowParticipation = artShadowParticipation;')
    shader.fragmentShader = 'varying float vArtShadowParticipation;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif ( vArtShadowParticipation < 0.5 ) discard;')
  }
}

function applySurfaceFeatures(shader: CompileShader, features: ArtShaderFeatures): void {
  if (features.attributes.surfaceResponse) {
    shader.vertexShader = 'attribute vec4 artSurfaceResponse;\nvarying vec4 vArtSurface;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvArtSurface = artSurfaceResponse;')
    shader.fragmentShader = 'varying vec4 vArtSurface;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vArtSurface.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vArtSurface.y;')
      .replace('mix( 1.0, kScale, uBandStrength )', 'mix( 1.0, kScale, vArtSurface.z * 0.65 )')
      .replace('* uRimStrength;', '* vArtSurface.w * 0.45;')
  }
  if (features.mapping !== 'uv') {
    shader.uniforms.uArtMeters = { value: features.metersPerRepeat }
    shader.fragmentShader = 'uniform float uArtMeters;\n' + shader.fragmentShader
    const sample = features.mapping === 'world-xz'
      ? 'texture2D( map, vStylizedWorld.xz / uArtMeters )'
      : `( texture2D( map, vStylizedWorld.yz / uArtMeters ) * kWeights.x
        + texture2D( map, vStylizedWorld.xz / uArtMeters ) * kWeights.y
        + texture2D( map, vStylizedWorld.xy / uArtMeters ) * kWeights.z )`
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        ${features.mapping === 'world-triplanar' ? `
          vec3 kMappingNormal = normalize( cross( dFdx( vStylizedWorld ), dFdy( vStylizedWorld ) ) );
          vec3 kWeights = pow( abs( kMappingNormal ), vec3( 4.0 ) );
          kWeights /= max( dot( kWeights, vec3( 1.0 ) ), 1e-5 );` : ''}
        diffuseColor *= ${sample};
      #endif
    `)
  }
  if (features.attributes.water) {
    shader.vertexShader = 'attribute vec4 artWater;\nvarying vec4 vArtWater;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvArtWater = artWater;')
    shader.fragmentShader = `varying vec4 vArtWater;
      uniform float uArtTime;
      uniform vec3 uArtSky;
      uniform vec3 uArtHorizon;
      ` + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float kFlow = sin( dot( vStylizedWorld.xz, vArtWater.xy ) * 2.5 - uArtTime * 1.2 );
      float kReflect = pow( 1.0 - clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 ), 3.0 );
      vec3 kSky = mix( uArtHorizon, uArtSky, clamp( normal.y, 0.0, 1.0 ) );
      outgoingLight = mix( outgoingLight * ( 1.0 + kFlow * 0.025 ),
        kSky, kReflect * 0.16 );
      outgoingLight *= 1.0 - min( vArtWater.w, 6.0 ) * 0.018;
      outgoingLight += diffuseColor.rgb * vArtWater.z * 0.035;
      #include <opaque_fragment>
    `)
  }
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
 * is load-bearing. The general rule, which is what should stop anyone
 * symmetrising these two later: *ownership describes a relationship to the
 * library, so it must never travel; this flag describes an intrinsic property of
 * the material, so it must travel with the property it describes.* Enumerable and
 * non-enumerable fall straight out of that, and it generalises to any marker a
 * downstream session adds.
 *
 * Concretely, this flag tracks `onBeforeCompile`, which `applyStylizedShader`
 * makes an own enumerable property. The two therefore propagate under identical
 * rules — `Object.assign` and spread copy both, `clone()` copies neither — so the
 * flag can never disagree with the material it describes.
 *
 * Hiding it would produce a material that carries the injection but reports none.
 * The damage that follows is quieter than a doubled shader: `applyStylizedShader`
 * *assigns* `onBeforeCompile` rather than composing onto it, so a re-adopt swaps
 * the closure for an equivalent one and the GLSL is unchanged. What actually
 * breaks is that `adoptMaterial` re-derives band, rim and rim-power from
 * `options.surface ?? 'cloth'` and overwrites `userData.stylizedSurfacePreset` — so an
 * assign-derived `metal` would silently retune to `cloth` (rim 0.62 -> 0.34,
 * power 3.2 -> 2.6, and band identical at 1, so it is invisible on the banding
 * axis entirely). A silent retune is harder to spot than a crash, which makes
 * keeping this flag honest more valuable, not less.
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
  features?: ArtShaderFeatures,
): void {
  markStylizedShader(material)
  if (features) setArtMaterialFeatures(material, features)
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
    if (features) {
      applyArtVertex(shader, features, shared.environment, false)
      applySurfaceFeatures(shader, features)
    }
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
  material.customProgramCacheKey = () => features?.enhanced
    ? `${STYLIZED_PROGRAM_KEY}:${artShaderKey(features)}` : STYLIZED_PROGRAM_KEY
  material.needsUpdate = true
}

/** Installs the normal-extrusion injection on an outline shell material. */
export function applyOutlineShader(
  material: THREE.MeshBasicMaterial,
  shared: OutlineSharedUniforms,
  smooth: boolean,
  features?: ArtShaderFeatures,
  environment?: ArtEnvironmentUniforms,
): void {
  if (features) setArtMaterialFeatures(material, features)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineThickness = shared.uOutlineThickness
    shader.uniforms.uOutlineMinDepth = shared.uOutlineMinDepth
    shader.uniforms.uOutlineMaxDepth = shared.uOutlineMaxDepth
    if (features?.enhanced) {
      shader.uniforms.uOutlineViewport = shared.uOutlineViewport!
      shader.uniforms.uOutlinePixels = shared.uOutlinePixels!
    }

    requireInjectionPoint(shader.vertexShader, '#include <project_vertex>', 'outline')

    shader.vertexShader =
      OUTLINE_VERTEX_HEADER +
      (features?.enhanced ? 'uniform vec2 uOutlineViewport;\nuniform vec2 uOutlinePixels;\n' : '') +
      (smooth ? OUTLINE_SMOOTH_ATTRIBUTE : '') +
      shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      outlineProjection(smooth, features?.enhanced, features?.attributes.wind),
    )
    if (features) applyArtVertex(shader, features, environment, false)
  }
  // Captured, not written out: `smooth` never appears in this closure's source
  // text, so three's default `onBeforeCompile.toString()` key cannot tell the two
  // variants apart and would hand both the same compiled program.
  material.customProgramCacheKey = () =>
    `${OUTLINE_PROGRAM_KEY}:${smooth ? 'smooth' : 'flat'}${features?.enhanced ? `:${artShaderKey(features)}` : ''}`
  material.needsUpdate = true
}

export function applyArtDepthShader(
  material: THREE.MeshDepthMaterial,
  features: ArtShaderFeatures,
  environment: ArtEnvironmentUniforms,
): void {
  setArtMaterialFeatures(material, features)
  material.onBeforeCompile = (shader) => applyArtVertex(shader, features, environment, true)
  material.customProgramCacheKey = () => `korovany-depth:${artShaderKey(features)}`
}
