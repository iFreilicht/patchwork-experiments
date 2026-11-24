import { describe, expect, it } from "vitest";
import { Group, LineBasicMaterial, LineSegments, BufferGeometry, Float32BufferAttribute } from "three";
import { encodeGLB, MODE } from "./glb.js";
import { prepareGLB } from "./gltf-content.js";
import { disposeWide, followLine, lineWidthOf, MAX_LINE_WIDTH, widenLines } from "./wide-lines.js";

const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const square = [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0];

describe("a GLB's wide lines", () => {
  it("a line primitive whose material says extras.lineWidth gets a wide copy; the line keeps picking but draws nothing, and the surfaces go behind it", async () => {
    const glb = encodeGLB({
      meshes: [
        {
          name: "part",
          primitives: [
            { positions: tri, color: "#808080" },
            { positions: square, mode: MODE.LINES, color: "#202020", unlit: true, materialExtras: { lineWidth: 2.5 } },
            { positions: square, mode: MODE.LINES, color: "#ff0000", unlit: true },
          ],
        },
      ],
      nodes: [{ name: "part", mesh: 0 }],
    });
    const p = await prepareGLB(glb);
    expect(p.wide).toHaveLength(1);
    const [{ line, wide }] = p.wide;
    expect(line.isLineSegments).toBe(true);
    expect(line.material.visible).toBe(false);
    expect(wide.isLineSegments2).toBe(true);
    expect(wide.material.linewidth).toBe(2.5);
    // four segments, and never part of the content
    expect(wide.geometry.instanceCount).toBe(4);
    expect(wide.parent).toBeNull();
    const lines = [];
    const meshes = [];
    p.content.traverse((o) => (o.isLine ? lines.push(o) : o.isMesh && meshes.push(o)));
    // the plain line draws as it did
    expect(lines.filter((l) => l.material.visible)).toHaveLength(1);
    expect(meshes.map((m) => [m.material.polygonOffset, m.material.polygonOffsetFactor])).toEqual([[true, 2]]);
    disposeWide(p.wide);
  });

  it("follows its line: shown with it and every node above it, in its colour and opacity", () => {
    const geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(square, 3));
    const material = new LineBasicMaterial({ color: 0x00ff00 });
    material.userData.lineWidth = 3;
    const line = new LineSegments(geometry, material);
    const root = new Group().add(new Group().add(line));
    const [pair] = widenLines(root);
    material.color.setHex(0x0000ff);
    material.opacity = 0.5;
    material.transparent = true;
    followLine(pair);
    expect(pair.wide.visible).toBe(true);
    expect(pair.wide.material.color.getHex()).toBe(0x0000ff);
    expect([pair.wide.material.opacity, pair.wide.material.transparent]).toEqual([0.5, true]);
    line.parent.visible = false;
    followLine(pair);
    expect(pair.wide.visible).toBe(false);
  });

  it("widths: positive numbers, at most MAX_LINE_WIDTH", () => {
    const m = (lineWidth) => ({ userData: { lineWidth } });
    expect([m(2), m(0), m(-1), m("x"), m(1000), {}].map(lineWidthOf)).toEqual([2, 0, 0, 0, MAX_LINE_WIDTH, 0]);
  });
});
