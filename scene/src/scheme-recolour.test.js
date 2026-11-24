import { describe, it, expect } from "vitest";
import { MeshBasicMaterial, MeshStandardMaterial, Texture } from "three";
import { adaptToScheme, drawnFor, recolour } from "./scheme-recolour.js";

// sRGB hex ↔ linear, as a texture is sampled and the frame is written
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const fromHex = (h) => [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
const toHex = (rgb) => `#${rgb.map((c) => Math.round(gam(c) * 255).toString(16).padStart(2, "0")).join("")}`;
const dark = (h) => toHex(recolour(fromHex(h)));
const luma = (h) => fromHex(h).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);

describe("recolour: a light picture for a dark view", () => {
  it("turns dark ink light and light neutrals dark", () => {
    expect(dark("#1d1d1d")).toBe("#ffffff"); // tldraw's black ink; its own dark is #f2f2f2
    expect(dark("#000000")).toBe("#ffffff");
    expect(luma(dark("#e8e8e8"))).toBeLessThan(0.05); // a pale fill; tldraw's dark #2c3036
    expect(luma(dark("#ffffff"))).toBeLessThan(0.03);
  });

  it("keeps a saturated colour as it is", () => {
    expect(dark("#e03131")).toBe("#e03131"); // tldraw's red, the same in its dark
    expect(dark("#4465e9")).toBe("#4465e9");
  });

  it("keeps hue: a pale tint turns a dark tint of the same colour", () => {
    const [r, g, b] = fromHex(dark("#f4dadb")); // tldraw's pale red; its dark #382726
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(luma(dark("#f4dadb"))).toBeLessThan(0.06);
  });

  it("is continuous: a colour a little more saturated changes a little", () => {
    const a = recolour(fromHex("#808a94"));
    const b = recolour(fromHex("#808b96"));
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.05);
  });
});

describe("adaptToScheme", () => {
  const picture = (scheme = "light", M = MeshBasicMaterial) => {
    const m = new M({ map: new Texture() });
    m.userData.colorScheme = scheme;
    return m;
  };
  const compile = (m) => {
    const shader = { uniforms: {}, fragmentShader: "uniform vec3 diffuse;\nvoid main() {\n\tvec4 diffuseColor = vec4(diffuse, 1.0);\n\t#include <map_fragment>\n}" };
    m.onBeforeCompile(shader, null);
    return shader;
  };

  it("reads what a material's picture was drawn for from its extras (userData)", () => {
    expect(drawnFor(picture("light"))).toBe("light");
    expect(drawnFor(picture("dark"))).toBe("dark");
    expect(drawnFor(picture("sepia"))).toBeNull();
    expect(drawnFor(new MeshBasicMaterial())).toBeNull();
  });

  it("recolours after the map, while its uniform is on, in any material with a map", () => {
    for (const M of [MeshBasicMaterial, MeshStandardMaterial]) {
      const u = { value: 0 };
      const m = picture("light", M);
      expect(adaptToScheme(m, u)).toBe(true);
      const shader = compile(m);
      expect(shader.uniforms.sceneRecolourOn).toBe(u);
      expect(shader.fragmentShader).toMatch(/uniform float sceneRecolourOn;[\s\S]*vec3 sceneRecolour\(vec3 c\)[\s\S]*void main\(\) \{/);
      expect(shader.fragmentShader).toMatch(/#include <map_fragment>\n\tif \(sceneRecolourOn > 0\.5\) diffuseColor\.rgb = sceneRecolour\(diffuseColor\.rgb\);/);
      expect(m.customProgramCacheKey()).toMatch(/scene-recolour$/);
    }
  });

  it("leaves a material alone that has no map or doesn't say, and patches one only once", () => {
    const plain = new MeshBasicMaterial({ map: new Texture() });
    expect(adaptToScheme(plain, { value: 1 })).toBe(false);
    expect(plain.onBeforeCompile.toString()).not.toMatch(/sceneRecolour/);
    const noMap = new MeshBasicMaterial();
    noMap.userData.colorScheme = "light";
    expect(adaptToScheme(noMap, { value: 1 })).toBe(false);
    const m = picture();
    adaptToScheme(m, { value: 0 });
    const next = { value: 1 };
    adaptToScheme(m, next);
    const shader = compile(m);
    expect(shader.uniforms.sceneRecolourOn).toBe(next);
    expect(shader.fragmentShader.match(/uniform float sceneRecolourOn/g)).toHaveLength(1);
  });
});
