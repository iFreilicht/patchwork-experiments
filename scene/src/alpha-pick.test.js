import { describe, it, expect, vi } from "vitest";
import { DataTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Texture, Vector2 } from "three";
import { ALPHA_MIN, alphaMask, opaqueAt } from "./alpha-pick.js";

/** A texture one row high: its alpha per texel, as given. */
function strip(alphas) {
  const data = new Uint8Array(alphas.length * 4);
  alphas.forEach((a, i) => (data[i * 4 + 3] = a));
  return new DataTexture(data, alphas.length, 1);
}
const hitAt = (material, u) => ({ object: new Mesh(new PlaneGeometry(), material), uv: new Vector2(u, 0.5) });

describe("alphaMask", () => {
  it("reads a texture's alpha once per image, and again when the image changes", () => {
    const tex = strip([0, 255]);
    const read = vi.fn((image) => ({ width: image.width, height: image.height, data: new Uint8Array([0, 255]) }));
    expect(alphaMask(tex, read)).toEqual({ width: 2, height: 1, data: new Uint8Array([0, 255]) });
    alphaMask(tex, read);
    expect(read).toHaveBeenCalledTimes(1);
    tex.image = { ...tex.image };
    alphaMask(tex, read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads a DataTexture's texels as they are", () => {
    expect(alphaMask(strip([7, 0, 200]))).toEqual({ width: 3, height: 1, data: new Uint8Array([7, 0, 200]) });
  });

  it("has none for a texture without an image, and reads one that wasn't loaded once it is", () => {
    expect(alphaMask(new Texture())).toBeNull();
    const tex = new Texture({ complete: false, naturalWidth: 0, naturalHeight: 0 });
    expect(alphaMask(tex)).toBeNull();
    const read = vi.fn(() => ({ width: 1, height: 1, data: new Uint8Array([255]) }));
    expect(alphaMask(tex, read).data[0]).toBe(255);
  });

  it("keeps an image it can't read as unreadable", () => {
    const tex = new Texture({ width: 4, height: 4 });
    const read = vi.fn(() => {
      throw new Error("tainted");
    });
    expect(alphaMask(tex, read)).toBeNull();
    expect(alphaMask(tex, read)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("opaqueAt", () => {
  // 16 texels: the left half clear, the right half drawn
  const half = () => strip([...Array(8).fill(0), ...Array(8).fill(255)]);

  it("is false on a clear texel of a transparent material, true on a drawn one", () => {
    const m = new MeshBasicMaterial({ map: half(), transparent: true });
    expect(opaqueAt(hitAt(m, 0.1))).toBe(false);
    expect(opaqueAt(hitAt(m, 0.9))).toBe(true);
  });

  it("takes a texel beside a drawn one as drawn, so a thin stroke can be hit", () => {
    const m = new MeshBasicMaterial({ map: half(), transparent: true });
    // texel 7 is clear, texel 8 beside it drawn
    expect(opaqueAt(hitAt(m, 7.5 / 16))).toBe(true);
    expect(opaqueAt(hitAt(m, 6.5 / 16))).toBe(false);
  });

  it("counts a faint texel as clear, and an alphaTest raises the bar", () => {
    const faint = new MeshBasicMaterial({ map: strip([ALPHA_MIN, ALPHA_MIN, ALPHA_MIN]), transparent: true });
    expect(opaqueAt(hitAt(faint, 0.5))).toBe(false);
    const masked = new MeshBasicMaterial({ map: strip([100, 100, 100]), alphaTest: 0.5 });
    expect(opaqueAt(hitAt(masked, 0.5))).toBe(false);
    masked.alphaTest = 0.3;
    expect(opaqueAt(hitAt(masked, 0.5))).toBe(true);
  });

  it("is true where alpha doesn't show or can't be told: an opaque material, no map, no uv", () => {
    expect(opaqueAt(hitAt(new MeshBasicMaterial({ map: half() }), 0.1))).toBe(true);
    expect(opaqueAt(hitAt(new MeshBasicMaterial({ transparent: true }), 0.1))).toBe(true);
    expect(opaqueAt({ object: new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ map: half(), transparent: true })) })).toBe(true);
    expect(opaqueAt(hitAt(new MeshBasicMaterial({ map: new Texture(), transparent: true }), 0.1))).toBe(true);
  });

  it("follows the texture's own repeat and offset", () => {
    const map = half();
    map.offset.set(0.5, 0); // the quad's left edge shows the texture's middle
    map.updateMatrix();
    const m = new MeshBasicMaterial({ map, transparent: true });
    expect(opaqueAt(hitAt(m, 0.1))).toBe(true);
  });
});
