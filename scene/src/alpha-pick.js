// Picking through what a texture leaves clear: a drawing on a plane is mostly
// transparent, and a click there is meant for what lies behind it. A hit on a
// mesh whose material shows its texture's alpha (transparent, or alphaTest) is
// a hit only where the texel under it, or one beside it, is drawn. The alpha
// is read once per texture and kept, at most MAX_SIDE texels a side. Whatever
// can't be read (a texture not loaded yet, no canvas) counts as drawn, so a
// pick is never lost for lack of pixels.

/** Of 255: a texel this faint, or fainter, is clear. */
export const ALPHA_MIN = 13;
/** The longest side of a kept mask: a larger texture is read scaled down. */
export const MAX_SIDE = 2048;

/** texture → { image, mask }: the mask of the image it was read from */
const masks = new WeakMap();

/** The alpha of RGBA texels, one byte each. */
function alphaOf(rgba, width, height) {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
  return { width, height, data };
}

/**
 * An image's alpha, its first row first: a DataTexture's texels as they are,
 * anything drawable through a 2D canvas. undefined while it isn't loaded (try
 * again later), null when it can't be read.
 */
function readAlpha(image) {
  const { data, width, height } = image;
  if (data && width > 0 && height > 0) return data.length === width * height * 4 ? alphaOf(data, width, height) : null;
  if (image.complete === false) return undefined;
  const w0 = image.naturalWidth || width;
  const h0 = image.naturalHeight || height;
  if (!(w0 > 0 && h0 > 0)) return undefined;
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(globalThis.document?.createElement("canvas") ?? {}, { width: w, height: h });
  const ctx = canvas.getContext?.("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  return alphaOf(ctx.getImageData(0, 0, w, h).data, w, h);
}

/**
 * A texture's alpha mask ({ width, height, data }), read once per image, or
 * null when there is none to read.
 * @param {import("three").Texture} texture
 * @param {(image: any) => ({ width: number, height: number, data: Uint8Array } | null | undefined)} [read]
 */
export function alphaMask(texture, read = readAlpha) {
  const image = texture?.image;
  if (!image) return null;
  const kept = masks.get(texture);
  if (kept && kept.image === image) return kept.mask;
  let mask;
  try {
    mask = read(image);
  } catch {
    mask = null; // a tainted canvas, say: it stays unreadable
  }
  if (mask === undefined) return null; // not loaded yet: read it next time
  masks.set(texture, { image, mask });
  return mask;
}

/**
 * Is a raycast hit on something drawn? true unless its material shows its
 * map's alpha and the texel at the hit's uv, and every one beside it, is
 * clear.
 * @param {{ object: any, uv?: import("three").Vector2, face?: { materialIndex?: number } }} hit
 */
export function opaqueAt(hit, read) {
  let material = hit.object?.material;
  if (Array.isArray(material)) material = material[hit.face?.materialIndex ?? 0];
  const map = material?.map;
  if (!map || !hit.uv || !(material.transparent || material.alphaTest > 0)) return true;
  const mask = alphaMask(map, read);
  if (!mask) return true;
  // the texture's own offset, repeat, wrap and flip: (0, 0) is then its first row's first texel
  const uv = hit.uv.clone();
  map.transformUv(uv);
  const min = Math.max(ALPHA_MIN, Math.round((material.alphaTest || 0) * 255));
  const { width, height, data } = mask;
  const x = Math.min(width - 1, Math.max(0, Math.floor(uv.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(uv.y * height)));
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < width && ty < height && data[ty * width + tx] > min) return true;
    }
  }
  return false;
}
