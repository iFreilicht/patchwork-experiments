import { describe, it, expect } from "vitest";
import { createParamForm } from "./param-form.js";

describe("createParamForm: an enum", () => {
  it("draws a run of options with the same group as one <optgroup>, the rest as plain options", () => {
    const box = document.createElement("div");
    const spec = {
      key: "show",
      kind: "enum",
      options: [
        { value: "page:1", label: "Page 1", group: "Page 1" },
        { value: "shape:a", label: "Frame A", group: "Page 1" },
        { value: "page:2", label: "Page 2", group: "Page 2" },
        { value: "all", label: "Everything" },
      ],
    };
    const picked = [];
    const form = createParamForm(box, [spec], (k, v) => picked.push([k, v]));
    const select = box.querySelector("select");
    expect([...select.children].map((c) => (c.localName === "optgroup" ? `${c.label}: ${[...c.children].map((o) => o.textContent).join(", ")}` : c.textContent))).toEqual([
      "Page 1: Page 1, Frame A",
      "Page 2: Page 2",
      "Everything",
    ]);
    form.update({ show: "shape:a" });
    expect(select.value).toBe("shape:a");
    select.value = "page:2";
    select.dispatchEvent(new Event("change"));
    expect(picked).toEqual([["show", "page:2"]]);
  });

  it("has no <optgroup> when no option names a group", () => {
    const box = document.createElement("div");
    createParamForm(box, [{ key: "style", kind: "enum", options: [{ value: "a" }, { value: "b" }] }], () => {});
    expect(box.querySelector("optgroup")).toBeNull();
    expect(box.querySelectorAll("option").length).toBe(2);
  });
});
