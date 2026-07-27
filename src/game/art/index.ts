/**
 * The shared procedural art foundation for КОРОВАНЫ.
 *
 * Import from here and nowhere deeper: this barrel is the stable surface the NPC
 * and world-object passes build on. See `docs/08-graphics-foundation-spec.md` for
 * the contract, the budgets and the lifecycle rules.
 *
 * The whole module depends on `three`, `three/addons` and `src/game/random/` only.
 * It never reaches back into `GameEngine` or `world/`, and it stays importable from
 * a Node test with no DOM.
 */

export {
  fbm3,
  hashInt3,
  hashUnit,
  hashUnit3,
  ridgeNoise3,
  valueNoise3,
} from './ArtNoise.ts'

export {
  artNoiseSeed,
  artVariation,
  createArtStream,
  wrapArtVariation,
  type ArtVariation,
} from './ArtRandom.ts'

export {
  OUTLINE_NORMAL_ATTRIBUTE,
  bakeOutlineNormals,
  bakeSkyOcclusion,
  bakeVerticalOcclusion,
  branchStructure,
  displaceGeometry,
  ensureVertexColors,
  extrudeProfile,
  facetGeometry,
  gradientVertexColors,
  hasOutlineNormals,
  latheProfile,
  loftProfile,
  mergeAll,
  paintVertexColors,
  polygonProfile,
  rectProfile,
  stylizedCapsule,
  taperedBox,
  transformed,
  tubeAlongPoints,
  type BranchStructureOptions,
  type DisplaceOptions,
  type ExtrudeProfileOptions,
  type GradientColorOptions,
  type LatheProfileOptions,
  type LoftOptions,
  type LoftSection,
  type MergeOptions,
  type OutlineNormalOptions,
  type SkyOcclusionOptions,
  type StylizedCapsuleOptions,
  type TaperedBoxOptions,
  type TransformOptions,
  type TubeOptions,
  type Vec2Like,
  type Vec3Like,
  type VertexPaint,
  type VertexPaintContext,
  type VerticalOcclusionOptions,
} from './GeometryKit.ts'

export {
  GeometryCache,
  clearLod,
  createLod,
  type CreateLodOptions,
  type LodLevel,
} from './GeometryCache.ts'

export {
  StylizedArtLibrary,
  type ContactShadowOptions,
  type OutlineBinding,
  type OutlineKind,
  type OutlineOptions,
  type StylizedArtLibraryOptions,
  type StylizedInkPalette,
  type StylizedMaterialOptions,
  type StylizedSurface,
} from './StylizedArtLibrary.ts'
