// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { encodeGLB, parseGLB, computeNormals, computeBounds, hexToLinear, MODE } from "./glb.js";

function load(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, "", resolve, reject));
}

const tri = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
};

const quad = () => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  indices: [0, 1, 2, 0, 2, 3],
});

describe("encodeGLB structure", () => {
  it("writes a valid header, aligned chunks and POSITION min/max", () => {
    const bytes = encodeGLB({ meshes: [{ name: "tri", ...tri }] });
    expect(bytes.byteLength % 4).toBe(0);
    const { json, bin } = parseGLB(bytes);
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes[0].name).toBe("tri");
    const pos = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
    expect(pos.min).toEqual([0, 0, 0]);
    expect(pos.max).toEqual([1, 1, 0]);
    expect(pos.count).toBe(3);
    expect(bin.byteLength % 4).toBe(0);
    for (const v of json.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });

  it("uses u16 indices when they fit and u32 when they do not", () => {
    const small = parseGLB(encodeGLB({ meshes: [quad()] })).json;
    expect(small.accessors[small.meshes[0].primitives[0].indices].componentType).toBe(5123);

    const n = 70000;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) positions[i * 3] = i;
    const indices = new Uint32Array([0, 1, n - 1]);
    const big = parseGLB(encodeGLB({ meshes: [{ positions, indices }] })).json;
    expect(big.accessors[big.meshes[0].primitives[0].indices].componentType).toBe(5125);
  });

  it("keeps odd-length u16 index data aligned for the next view", () => {
    const bytes = encodeGLB({
      meshes: [
        { positions: tri.positions, indices: [0, 1, 2] }, // 6 bytes of indices
        { positions: tri.positions },
      ],
    });
    const { json } = parseGLB(bytes);
    for (const v of json.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });

  it("drops empty primitives and meshes but still encodes a valid scene", () => {
    const bytes = encodeGLB({ meshes: [{ name: "empty", positions: [] }] });
    const { json, bin } = parseGLB(bytes);
    expect(json.meshes).toBeUndefined();
    expect(json.nodes).toEqual([{ name: "empty" }]);
    expect(bin).toBeNull();
  });

  it("rejects malformed input with a useful message", () => {
    expect(() => encodeGLB({ meshes: [{ name: "bad", positions: [0, 0] }] })).toThrow(/bad.*multiple of 3/);
    expect(() => encodeGLB({ meshes: [{ positions: tri.positions, indices: [0, 1, 3] }] })).toThrow(/out of range/);
    expect(() => encodeGLB({ meshes: [{ positions: tri.positions, attributes: { ID: [1, 2, 3] } }] })).toThrow(/start with "_"/);
    expect(() => encodeGLB({ meshes: [{ positions: tri.positions, attributes: { _ID: [1, 2] } }] })).toThrow(/expected 3/);
    expect(() => encodeGLB({ meshes: [{ positions: [0, 0, NaN] }] })).toThrow(/non-finite/);
    expect(() => encodeGLB({ meshes: [{ positions: tri.positions }], nodes: [{ mesh: 4 }] })).toThrow(/does not exist/);
  });

  it("dedupes identical materials and linearises hex colours", () => {
    const { json } = parseGLB(
      encodeGLB({
        meshes: [
          { ...tri, color: "#ff0000" },
          { ...tri, color: "#ff0000" },
          { ...tri, color: [0, 0, 1, 0.5] },
        ],
      }),
    );
    expect(json.materials.length).toBe(2);
    expect(json.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1, 0, 0, 1]);
    expect(json.materials[1].alphaMode).toBe("BLEND");
    expect(hexToLinear("#808080")[0]).toBeCloseTo(0.2158, 3);
  });
});

describe("encodeGLB round-trips through three's GLTFLoader", () => {
  it("loads meshes, names, normals, indices and custom attributes", async () => {
    const q = quad();
    const bytes = encodeGLB({
      meshes: [
        {
          name: "hull",
          positions: q.positions,
          indices: q.indices,
          normals: computeNormals(q.positions, q.indices),
          attributes: { _ID: new Float32Array([0, 0, 1, 1]), _UV2: { array: new Float32Array(8), itemSize: 2 } },
          color: [0.2, 0.4, 0.6],
        },
        { name: "edges", positions: q.positions, indices: [0, 1, 1, 2, 2, 3, 3, 0], mode: MODE.LINES },
      ],
    });
    const gltf = await load(bytes);
    const hull = gltf.scene.getObjectByName("hull");
    expect(hull.isMesh).toBe(true);
    const g = hull.geometry;
    expect(g.getAttribute("position").count).toBe(4);
    expect(g.getAttribute("normal").getZ(0)).toBeCloseTo(1);
    expect(g.index.count).toBe(6);
    // three lower-cases custom attribute names
    expect([...g.getAttribute("_id").array]).toEqual([0, 0, 1, 1]);
    expect(g.getAttribute("_uv2").itemSize).toBe(2);
    expect(hull.material.color.r).toBeCloseTo(0.2);
    const edges = gltf.scene.getObjectByName("edges");
    expect(edges.isLineSegments).toBe(true);
  });

  it("honours explicit node hierarchies and transforms", async () => {
    const bytes = encodeGLB({
      meshes: [{ name: "part", ...tri }],
      nodes: [
        { name: "assembly", children: [1, 2], translation: [0, 2, 0] },
        { name: "left", mesh: 0, translation: [-1, 0, 0] },
        { name: "right", mesh: 0, translation: [1, 0, 0], scale: [2, 2, 2] },
      ],
    });
    const { json } = parseGLB(bytes);
    expect(json.scenes[0].nodes).toEqual([0]);
    const gltf = await load(bytes);
    gltf.scene.updateMatrixWorld(true);
    const right = gltf.scene.getObjectByName("right");
    const p = right.getWorldPosition(right.position.clone());
    expect([p.x, p.y, p.z]).toEqual([1, 2, 0]);
    expect(gltf.scene.getObjectByName("left")).toBeTruthy();
  });

  it("loads an empty scene", async () => {
    const gltf = await load(encodeGLB({ meshes: [] }));
    expect(gltf.scene.children.length).toBe(0);
  });
});

describe("helpers", () => {
  it("computes flat normals for triangle soup", () => {
    const n = computeNormals(tri.positions);
    expect([...n]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });
  it("computes bounds", () => {
    expect(computeBounds([1, 2, 3, -1, 5, 0])).toEqual({ min: [-1, 2, 0], max: [1, 5, 3] });
    expect(computeBounds([])).toBeNull();
  });
});

describe("v2 additions", () => {
  it("writes asset.copyright only when given", () => {
    for (const none of [undefined, null, ""]) expect("copyright" in parseGLB(encodeGLB({ meshes: [tri], copyright: none })).json.asset).toBe(false);
    expect(parseGLB(encodeGLB({ meshes: [tri] })).json.asset).toEqual({ version: "2.0", generator: "patchwork glb.js", extras: { units: "m" } });
    expect(parseGLB(encodeGLB({ meshes: [tri], copyright: "© OpenStreetMap contributors" })).json.asset.copyright).toBe("© OpenStreetMap contributors");
  });

  it("records the units in asset.extras (metres unless told otherwise)", () => {
    expect(parseGLB(encodeGLB({ meshes: [tri] })).json.asset.extras).toEqual({ units: "m" });
    expect(parseGLB(encodeGLB({ meshes: [tri], units: "mm" })).json.asset.extras).toEqual({ units: "mm" });
  });

  it("writes per-vertex colours as COLOR_0, rgb or rgba", async () => {
    const rgb = parseGLB(encodeGLB({ meshes: [{ ...tri, colors: [1, 0, 0, 0, 1, 0, 0, 0, 1] }] })).json;
    expect(rgb.accessors[rgb.meshes[0].primitives[0].attributes.COLOR_0].type).toBe("VEC3");
    const rgba = { array: new Float32Array(12).fill(0.5), itemSize: 4 };
    const json = parseGLB(encodeGLB({ meshes: [{ ...tri, colors: rgba }] })).json;
    expect(json.accessors[json.meshes[0].primitives[0].attributes.COLOR_0].type).toBe("VEC4");
    expect(() => encodeGLB({ meshes: [{ ...tri, colors: [1, 0, 0] }] })).toThrow(/colors/);
    const gltf = await load(encodeGLB({ meshes: [{ ...tri, colors: [1, 0, 0, 0, 1, 0, 0, 0, 1] }] }));
    let mesh;
    gltf.scene.traverse((o) => { if (o.isMesh) mesh = o; });
    expect(mesh.geometry.getAttribute("color").count).toBe(3);
  });

  it("makes a material for unlit or blend even with no colour", () => {
    const unlit = parseGLB(encodeGLB({ meshes: [{ ...tri, unlit: true }] })).json;
    expect(unlit.materials[0].extensions).toEqual({ KHR_materials_unlit: {} });
    expect(unlit.extensionsUsed).toEqual(["KHR_materials_unlit"]);
    const blend = parseGLB(encodeGLB({ meshes: [{ ...tri, blend: true }] })).json;
    expect(blend.materials[0].alphaMode).toBe("BLEND");
    expect(blend.extensionsUsed).toBeUndefined();
  });
});

describe("v4 additions: uvs and textures", () => {
  // a 1×1 PNG (one transparent pixel): what the bytes are doesn't matter to the encoder
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const uvs = [0, 1, 1, 1, 1, 0, 0, 0];

  it("writes TEXCOORD_0, and the image, sampler and texture a material's baseColorTexture names", () => {
    const { json, bin } = parseGLB(encodeGLB({ meshes: [{ name: "sheet", ...quad(), uvs, texture: { image: png, mimeType: "image/png" }, blend: true }] }));
    const prim = json.meshes[0].primitives[0];
    const uv = json.accessors[prim.attributes.TEXCOORD_0];
    expect([uv.type, uv.count, uv.componentType]).toEqual(["VEC2", 4, 5126]);
    const mat = json.materials[prim.material];
    expect(mat.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
    expect(mat.pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 1]);
    expect(mat.alphaMode).toBe("BLEND");
    expect(json.textures).toEqual([{ source: 0, sampler: 0 }]);
    expect(json.samplers).toEqual([{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }]);
    expect(json.images).toHaveLength(1);
    const img = json.images[0];
    expect(img.mimeType).toBe("image/png");
    const view = json.bufferViews[img.bufferView];
    expect(view.target).toBeUndefined(); // an image's view is no vertex or index buffer
    expect(view.byteOffset % 4).toBe(0);
    expect([...bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)]).toEqual([...png]);
  });

  it("stores an image given to several primitives once, and a sampler per filter and wrap", () => {
    const { json } = parseGLB(
      encodeGLB({
        meshes: [
          { ...quad(), uvs, texture: { image: png, mimeType: "image/png" } },
          { ...quad(), uvs, texture: { image: png, mimeType: "image/png" } },
          { ...quad(), uvs, texture: { image: png, mimeType: "image/png", smooth: false, repeat: true } },
        ],
      }),
    );
    expect(json.images).toHaveLength(1);
    expect(json.samplers).toEqual([
      { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 },
      { magFilter: 9728, minFilter: 9984, wrapS: 10497, wrapT: 10497 },
    ]);
    expect(json.textures).toEqual([
      { source: 0, sampler: 0 },
      { source: 0, sampler: 1 },
    ]);
    expect(json.materials).toHaveLength(2);
  });

  it("refuses a texture without uvs, uvs of the wrong length, and an image type glTF's core hasn't", () => {
    expect(() => encodeGLB({ meshes: [{ ...quad(), texture: { image: png, mimeType: "image/png" } }] })).toThrow(/texture but no uvs/);
    expect(() => encodeGLB({ meshes: [{ ...quad(), uvs: [0, 0, 1, 1] }] })).toThrow(/uvs has 4 values, expected 8/);
    expect(() => encodeGLB({ meshes: [{ ...quad(), uvs, texture: { image: png, mimeType: "image/svg+xml" } }] })).toThrow(/image\/png or image\/jpeg/);
    expect(() => encodeGLB({ meshes: [{ ...quad(), uvs, texture: { image: new Uint8Array(), mimeType: "image/png" } }] })).toThrow(/non-empty/);
  });

  it("writes no textures, images or samplers when nothing has a texture", () => {
    const { json } = parseGLB(encodeGLB({ meshes: [{ ...quad(), uvs }] }));
    expect([json.textures, json.images, json.samplers]).toEqual([undefined, undefined, undefined]);
    expect(json.meshes[0].primitives[0].material).toBeUndefined();
  });
});
