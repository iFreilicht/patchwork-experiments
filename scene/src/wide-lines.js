// three.js's wide lines (examples/jsm/lines): WebGL draws its own lines one pixel wide whatever
// they ask for. The viewport draws with these, and plugins get them as `api.wideLines` beside
// `api.THREE` (STAGE.md), as an object drawn in the scene must be made with the scene's three.js.

import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

export { LineMaterial, LineSegments2, LineSegmentsGeometry };

/** What `api.wideLines` is. */
export const wideLines = Object.freeze({ LineSegmentsGeometry, LineMaterial, LineSegments2 });

// ─── a GLB's wide lines (README, "GLB conventions") ────────────────────────────
// A line primitive whose material's `extras.lineWidth` gives a width in CSS
// pixels is drawn that wide. Its own line object stays where it is and does all
// it did, for picking, snapping, layers, boxes and the depth range, but draws
// nothing; a wide copy outside the content draws it instead (the viewport's
// `wideGroup`), following its world matrix, visibility and look every frame.
// The copy is a mesh of a template quad, which nothing measuring the content
// may see. The GLB's surfaces are pushed back in depth a little, as a CAD
// viewer's are, so that its lines on them aren't half buried.

/** The widest a GLB's line may be drawn, in CSS pixels. */
export const MAX_LINE_WIDTH = 32;

/** A material's `extras.lineWidth` (GLTFLoader puts extras in userData), clamped; 0 if it has none. */
export function lineWidthOf(material) {
  const w = Number(material?.userData?.lineWidth);
  return Number.isFinite(w) && w > 0 ? Math.min(w, MAX_LINE_WIDTH) : 0;
}

/** A line object's segments as pairs of points: its vertices in order (a strip's or loop's joined up), through its index. */
function segmentsOf(line, attr) {
  const g = line.geometry;
  const a = g.getAttribute(attr);
  if (!a) return null;
  const order = g.index ? Array.from(g.index.array) : Array.from({ length: a.count }, (_, i) => i);
  const pairs = [];
  if (line.isLineSegments) for (let i = 0; i + 1 < order.length; i += 2) pairs.push(order[i], order[i + 1]);
  else {
    for (let i = 0; i + 1 < order.length; i++) pairs.push(order[i], order[i + 1]);
    if (line.isLineLoop && order.length > 2) pairs.push(order[order.length - 1], order[0]);
  }
  const out = new Float32Array(pairs.length * 3);
  pairs.forEach((k, i) => {
    out[i * 3] = a.getX(k);
    out[i * 3 + 1] = a.getY(k);
    out[i * 3 + 2] = a.getZ(k);
  });
  return out;
}

/**
 * The wide copies of root's lines whose material has a width, `[{ line, wide }]`;
 * each such line's material stops drawing, and if there are any, root's
 * surfaces are offset behind them.
 */
export function widenLines(root) {
  const out = [];
  const materials = new Map();
  root.traverse((o) => {
    if (!o.isLine || Array.isArray(o.material)) return;
    const width = lineWidthOf(o.material);
    const positions = width ? segmentsOf(o, "position") : null;
    if (!positions?.length) return;
    const geometry = new LineSegmentsGeometry().setPositions(positions);
    const colors = o.material.vertexColors ? segmentsOf(o, "color") : null;
    if (colors) geometry.setColors(colors);
    let material = materials.get(o.material);
    if (!material) materials.set(o.material, (material = new LineMaterial({ linewidth: width, vertexColors: !!colors })));
    const wide = new LineSegments2(geometry, material);
    wide.name = o.name;
    wide.renderOrder = o.renderOrder;
    // placed by its line as it's drawn (followLine), never measured or picked
    wide.matrixAutoUpdate = false;
    wide.matrixWorldAutoUpdate = false;
    wide.frustumCulled = false;
    wide.raycast = () => {};
    wide.userData.noPick = true;
    const resolve = wide.onBeforeRender;
    wide.onBeforeRender = function (...args) {
      this.matrixWorld.copy(o.matrixWorld);
      resolve.apply(this, args);
    };
    o.material.visible = false;
    out.push({ line: o, wide });
  });
  if (out.length)
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || m.polygonOffset) continue;
        m.polygonOffset = true;
        m.polygonOffsetFactor = 2;
        m.polygonOffsetUnits = 1;
      }
    });
  return out;
}

/** Shows a wide copy as its line is now: shown or not (its line and every node above it), in its line's colour and opacity. */
export function followLine({ line, wide }) {
  let shown = true;
  for (let o = line; o && shown; o = o.parent) shown = o.visible;
  wide.visible = shown;
  if (!shown) return;
  const from = line.material;
  const to = wide.material;
  to.color.copy(from.color);
  to.opacity = from.opacity;
  if (to.transparent !== from.transparent) {
    to.transparent = from.transparent;
    to.needsUpdate = true;
  }
  to.depthWrite = from.depthWrite;
  to.depthTest = from.depthTest;
}

/** Lets go of wide copies: out of the scene, their geometries and materials disposed. */
export function disposeWide(pairs) {
  const materials = new Set();
  for (const { wide } of pairs ?? []) {
    wide.removeFromParent();
    wide.geometry.dispose();
    materials.add(wide.material);
  }
  for (const m of materials) m.dispose();
}
