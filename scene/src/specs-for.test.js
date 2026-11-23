import { describe, it, expect, vi, afterEach } from "vitest";
import { sanitizeSpec, specsFor } from "./build.js";

// A provider's ParamSpecs for one source doc (build.js specsFor): its
// metadata's, merged by key with what its module's params(doc) says.

const size = { key: "size", label: "Size", kind: "number", default: 1, cost: "cheap" };
const style = { key: "style", kind: "enum", default: "a", options: [{ value: "a" }, { value: "b" }] };
const paged = (params) => ({ id: "paged", params: [size, style], module: { build: async () => null, params } });

describe("specsFor", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is the metadata's own when the module has no params(doc), or there is no module or doc", () => {
    expect(specsFor({ params: [size] }, { x: 1 })).toEqual([size]);
    expect(specsFor({ params: [size], module: { build() {} } }, { x: 1 })).toEqual([size]);
    expect(specsFor(paged(() => [{ key: "show", kind: "string" }]), null)).toEqual([size, style]);
    expect(specsFor(null, { x: 1 })).toEqual([]);
  });

  it("merges by key: a spec with the metadata's key takes its place, the others follow in the order given", () => {
    const doc = { pages: ["p1", "p2"] };
    const specs = specsFor(
      paged((d) => [
        { key: "show", kind: "enum", default: d.pages[0], options: d.pages.map((p) => ({ value: p, label: p.toUpperCase(), group: "Pages" })) },
        { key: "style", kind: "enum", default: "c", options: [{ value: "c" }] },
        { key: "zoom", kind: "number", default: 2 },
      ]),
      doc,
    );
    expect(specs.map((s) => s.key)).toEqual(["size", "style", "show", "zoom"]);
    expect(specs[0]).toBe(size);
    expect(specs[1]).toEqual({ key: "style", kind: "enum", default: "c", options: [{ value: "c" }] });
    expect(specs[2].options).toEqual([
      { value: "p1", label: "P1", group: "Pages" },
      { value: "p2", label: "P2", group: "Pages" },
    ]);
  });

  it("drops what isn't a spec, and a repeated key after its first", () => {
    const specs = specsFor(
      paged(() => [
        null,
        "show",
        { kind: "number" },
        { key: "", kind: "number" },
        { key: "a", kind: "vector" },
        { key: "b", kind: "enum", options: [] },
        { key: "c", kind: "number", default: 1 },
        { key: "c", kind: "string" },
      ]),
      {},
    );
    expect(specs.map((s) => [s.key, s.kind])).toEqual([
      ["size", "number"],
      ["style", "enum"],
      ["c", "number"],
    ]);
  });

  it("keeps the metadata's when params(doc) throws or gives no list", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      specsFor(
        paged(() => {
          throw new Error("boom");
        }),
        {},
      ),
    ).toEqual([size, style]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(specsFor(paged(() => ({ key: "show", kind: "string" })), {})).toEqual([size, style]);
    expect(specsFor(paged(() => []), {})).toEqual([size, style]);
  });

  it("reads the doc it is given: a fixed object's, at its heads", () => {
    const seen = [];
    specsFor(paged((d) => (seen.push(d), [])), { at: "h1" });
    expect(seen).toEqual([{ at: "h1" }]);
  });
});

describe("sanitizeSpec", () => {
  it("is plain data: functions and unknown option fields go, options keep value, label and group", () => {
    const spec = sanitizeSpec({
      key: "show",
      kind: "enum",
      label: "Show",
      default: "p",
      format: () => "x",
      options: [{ value: "p", label: "Page", group: "Pages", icon: "Frame" }, { value: 2 }, { value: true, group: "" }, { value: {} }, { label: "no value" }, null],
    });
    expect(spec).toEqual({ key: "show", kind: "enum", label: "Show", default: "p", options: [{ value: "p", label: "Page", group: "Pages" }, { value: 2 }, { value: true }] });
    expect(() => structuredClone(spec)).not.toThrow();
  });

  it("refuses what has no string key or no known kind, and an enum without options", () => {
    expect(sanitizeSpec({ key: 1, kind: "number" })).toBeNull();
    expect(sanitizeSpec({ key: "k", kind: "object" })).toBeNull();
    expect(sanitizeSpec({ key: "k", kind: "enum" })).toBeNull();
    expect(sanitizeSpec({ key: "k", kind: "color", default: "#ffffff" })).toEqual({ key: "k", kind: "color", default: "#ffffff" });
  });
});
