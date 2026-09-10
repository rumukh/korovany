/** Enhanced normal-only revision; stock position/depth skinning is unchanged. */
export const AFFINE_SKIN_NORMAL_REVISION = 'affine-skin-normal-v1'

/**
 * Covectors use inverse-transpose of the complete weighted affine map, not a
 * weighted sum of inverse-transposes. The cofactor matrix has that direction
 * after correcting determinant sign; omitting division by its magnitude avoids
 * blow-ups at very small scales. Rank-two maps keep surviving tangent area;
 * collapsed area has no defined normal and uses a finite rest-direction fallback.
 *
 * Scalar arithmetic also lets CPU tests evaluate this exact emitted GLSL body,
 * independently of the triangle/tangent probes used as its geometric oracle.
 */
export const AFFINE_SKIN_NORMAL_GLSL = /* glsl */ `
vec3 kArtUnitNormal( vec3 n ) {
  float scale = max( max( abs( n.x ), abs( n.y ) ), abs( n.z ) );
  if ( !( scale > 0.0 ) ) return vec3( 0.0, 0.0, 1.0 );
  float x = n.x / scale;
  float y = n.y / scale;
  float z = n.z / scale;
  float unit = inversesqrt( x * x + y * y + z * z );
  return vec3( x * unit, y * unit, z * unit );
}

vec3 kArtAffineNormal( mat3 basis, vec3 n ) {
  float scale = max(
    max( max( abs( basis[ 0 ].x ), abs( basis[ 0 ].y ) ), abs( basis[ 0 ].z ) ),
    max( max( max( abs( basis[ 1 ].x ), abs( basis[ 1 ].y ) ), abs( basis[ 1 ].z ) ),
      max( max( abs( basis[ 2 ].x ), abs( basis[ 2 ].y ) ), abs( basis[ 2 ].z ) ) )
  );
  if ( !( scale > 0.0 ) ) return kArtUnitNormal( n );
  float a = basis[ 0 ].x / scale;
  float b = basis[ 0 ].y / scale;
  float c = basis[ 0 ].z / scale;
  float d = basis[ 1 ].x / scale;
  float e = basis[ 1 ].y / scale;
  float f = basis[ 1 ].z / scale;
  float g = basis[ 2 ].x / scale;
  float h = basis[ 2 ].y / scale;
  float i = basis[ 2 ].z / scale;
  float c00 = e * i - f * h;
  float c01 = f * g - d * i;
  float c02 = d * h - e * g;
  float c10 = h * c - i * b;
  float c11 = i * a - g * c;
  float c12 = g * b - h * a;
  float c20 = b * f - c * e;
  float c21 = c * d - a * f;
  float c22 = a * e - b * d;
  float determinant = a * c00 + b * c01 + c * c02;
  float orientation = determinant < 0.0 ? -1.0 : 1.0;
  float x = ( c00 * n.x + c10 * n.y + c20 * n.z ) * orientation;
  float y = ( c01 * n.x + c11 * n.y + c21 * n.z ) * orientation;
  float z = ( c02 * n.x + c12 * n.y + c22 * n.z ) * orientation;
  float area = max( max( abs( x ), abs( y ) ), abs( z ) );
  if ( !( area > 0.0 ) ) return kArtUnitNormal( n );
  return kArtUnitNormal( vec3( x, y, z ) );
}
`

/** Preserve three's weighted blend, bind matrices and forward tangent transform. */
export function affineSkinNormalChunk(stock: string): string {
  const original = 'objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;'
  if (!stock.includes(original)) throw new Error('Affine skin normal injection requires the current three skinnormal chunk')
  return stock.replace(original, 'objectNormal = kArtAffineNormal( mat3( skinMatrix ), objectNormal );')
}
