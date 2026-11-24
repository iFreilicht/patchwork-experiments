// A picture drawn for one colour scheme, shown to a viewer of the other: a
// texture whose material says it was drawn for a light (or dark) background
// (`extras.colorScheme`, README "GLB conventions") is recoloured in its shader
// when the viewer's scheme is the other one, so dark ink on a light page
// stays readable on a dark scene, from the one picture every viewer shares.
//
// The recolouring, in OKLab (a perceptual space): what has little colour (ink,
// greys, pale fills) has its lightness mirrored, L' = min(K - L, 1), as
// Chromium's auto dark mode does in Lab; what is saturated keeps its
// lightness, as drawing tools' dark palettes keep their strokes' colours;
// chroma between GATE_LOW and GATE_HIGH blends the two. Hue and chroma stay.
// Fitted against tldraw's light and dark palettes: black ink turns white, pale
// fills turn dark tints, red and blue strokes stay (median ΔE·100 4.9 over its
// 60 shape colours).

/** The mirror's offset: L' = min(K - L, 1). */
export const K = 1.25;
/** OKLab chroma at and below which a colour is mirrored wholly. */
export const GATE_LOW = 0.03;
/** OKLab chroma at and above which a colour keeps its lightness. */
export const GATE_HIGH = 0.16;

const cbrt = (x) => Math.sign(x) * Math.abs(x) ** (1 / 3);
const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The recolouring of one linear sRGB colour, as the shader does it (for tests
 * and for anything drawn outside a shader).
 * @param {[number, number, number]} rgb  linear, 0..1
 * @returns {[number, number, number]}
 */
export function recolour([r, g, b]) {
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const w = smoothstep(GATE_LOW, GATE_HIGH, Math.hypot(A, B));
  const L2 = Math.min(K - L, 1) * (1 - w) + L * w;
  const l2 = (L2 + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m2 = (L2 - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s2 = (L2 - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2),
    clamp(-1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2),
    clamp(-0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2),
  ];
}

/** The same in GLSL, on a linear colour (three's diffuseColor, after the map). */
const GLSL = /* glsl */ `
uniform float sceneRecolourOn;
vec3 sceneRecolour(vec3 c) {
  vec3 lms = vec3(
    dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
  float L = dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468));
  float A = dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099));
  float B = dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660));
  float w = smoothstep(${GATE_LOW.toFixed(4)}, ${GATE_HIGH.toFixed(4)}, length(vec2(A, B)));
  float L2 = mix(min(${K.toFixed(4)} - L, 1.0), L, w);
  vec3 lms2 = vec3(L2 + 0.3963377774 * A + 0.2158037573 * B, L2 - 0.1055613458 * A - 0.0638541728 * B, L2 - 0.0894841775 * A - 1.2914855480 * B);
  lms2 = lms2 * lms2 * lms2;
  return clamp(vec3(
    dot(lms2, vec3(4.0767416621, -3.3077115913, 0.2309699292)),
    dot(lms2, vec3(-1.2684380046, 2.6097574011, -0.3413193965)),
    dot(lms2, vec3(-0.0041960863, -0.7034186147, 1.7076147010))), 0.0, 1.0);
}
`;

/** The schemes a picture may say it was drawn for. */
export const SCHEMES = Object.freeze(["light", "dark"]);

/** The scheme a material's picture was drawn for (its GLB extras, in userData), or null. */
export const drawnFor = (material) => {
  const s = material?.userData?.colorScheme;
  return SCHEMES.includes(s) ? s : null;
};

/**
 * Teach a material to recolour its texture while `uniform.value` is 1. Only
 * a material with a map that says what it was drawn for; true when it was
 * patched (now or before). The uniform is shared: one per scheme per view,
 * set as the viewer's scheme changes, so switching needs no recompile.
 * @param {import("three").Material} material
 * @param {{ value: number }} uniform
 */
export function adaptToScheme(material, uniform) {
  if (!material?.map || !drawnFor(material)) return false;
  if (material.userData.sceneRecolour) {
    material.userData.sceneRecolour.uniform = uniform;
    return true;
  }
  const state = { uniform };
  material.userData.sceneRecolour = state;
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    shader.uniforms.sceneRecolourOn = state.uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${GLSL}\nvoid main() {`)
      .replace("#include <map_fragment>", "#include <map_fragment>\n\tif (sceneRecolourOn > 0.5) diffuseColor.rgb = sceneRecolour(diffuseColor.rgb);");
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ""}|scene-recolour`;
  material.needsUpdate = true;
  return true;
}
