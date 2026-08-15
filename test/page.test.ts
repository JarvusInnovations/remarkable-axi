import { describe, expect, test } from "vitest";
import {
  cssBlock,
  describeDelta,
  detectPageBox,
  parseDeclaredPageBox,
} from "../src/page.js";
import { pageBox } from "../src/devices.js";

const RM110 = pageBox("RM110"); // { width: 447, height: 596 }

describe("detectPageBox", () => {
  test("no declared box is absent", () => {
    expect(detectPageBox(null, RM110)).toEqual({ status: "absent" });
  });

  test("an exact match reports matches", () => {
    expect(detectPageBox({ width: 447, height: 596 }, RM110)).toEqual({
      status: "matches",
    });
  });

  test("a sub-epsilon difference still reports matches", () => {
    // Chrome rounds its own print box to whole points, so a declared value a
    // fraction of a point off renders identically to the device box.
    expect(detectPageBox({ width: 447.2, height: 595.8 }, RM110)).toEqual({
      status: "matches",
    });
  });

  test("a real difference reports differs with the signed delta", () => {
    const result = detectPageBox({ width: 612, height: 792 }, RM110);
    expect(result.status).toBe("differs");
    if (result.status !== "differs") throw new Error("unreachable");
    expect(result.declared).toEqual({ width: 612, height: 792 });
    // Positive delta: the declared box is larger than the device box.
    expect(result.delta).toEqual({ width: 612 - 447, height: 792 - 596 });
  });

  test("a smaller declaration yields a negative delta", () => {
    const result = detectPageBox({ width: 400, height: 500 }, RM110);
    expect(result.status).toBe("differs");
    if (result.status !== "differs") throw new Error("unreachable");
    expect(result.delta.width).toBeLessThan(0);
    expect(result.delta.height).toBeLessThan(0);
  });

  test("a difference on only one axis leaves the other exact", () => {
    const result = detectPageBox({ width: 447, height: 700 }, RM110);
    expect(result.status).toBe("differs");
    if (result.status !== "differs") throw new Error("unreachable");
    expect(result.delta.width).toBe(0);
    expect(result.delta.height).toBe(104);
  });
});

describe("describeDelta", () => {
  test("states the side for a larger declaration", () => {
    expect(describeDelta({ width: 165, height: 196 })).toBe(
      "165pt wider, 196pt taller",
    );
  });

  test("states the side for a smaller declaration", () => {
    expect(describeDelta({ width: -47, height: -96 })).toBe(
      "47pt narrower, 96pt shorter",
    );
  });

  test("reports only the axis that actually differs", () => {
    expect(describeDelta({ width: 0, height: 104 })).toBe("104pt taller");
    expect(describeDelta({ width: -30, height: 0 })).toBe("30pt narrower");
  });

  test("fractional deltas keep one decimal place", () => {
    expect(describeDelta({ width: 4.25, height: 0 })).toBe("4.3pt wider");
  });
});

describe("parseDeclaredPageBox", () => {
  test("reads a two-value size in points", () => {
    const html = "<style>@page { size: 447pt 596pt; margin: 0; }</style>";
    expect(parseDeclaredPageBox(html)).toEqual({ width: 447, height: 596 });
  });

  test("reads a single-value (square) size", () => {
    const html = "@page { size: 400pt; }";
    expect(parseDeclaredPageBox(html)).toEqual({ width: 400, height: 400 });
  });

  test("converts inches, millimetres, centimetres, and pixels to points", () => {
    expect(parseDeclaredPageBox("@page { size: 8.5in 11in; }")).toEqual({
      width: 612,
      height: 792,
    });
    const mm = parseDeclaredPageBox("@page { size: 210mm 297mm; }")!;
    expect(mm.width).toBeCloseTo(595.28, 1);
    expect(mm.height).toBeCloseTo(841.89, 1);
    const cm = parseDeclaredPageBox("@page { size: 21cm 29.7cm; }")!;
    expect(cm.width).toBeCloseTo(595.28, 1);
    const px = parseDeclaredPageBox("@page { size: 96px 192px; }")!;
    expect(px.width).toBe(72);
    expect(px.height).toBe(144);
  });

  test("no @page rule is absent, not an error", () => {
    expect(parseDeclaredPageBox("<html><body>hi</body></html>")).toBeNull();
  });

  test("an @page rule with no size property is absent", () => {
    expect(parseDeclaredPageBox("@page { margin: 1in; }")).toBeNull();
  });

  test("a named page size (not numeric) is not resolved to a box", () => {
    expect(parseDeclaredPageBox("@page { size: A4; }")).toBeNull();
  });
});

describe("cssBlock", () => {
  test("emits the exact shape from specs/commands/page.md", () => {
    expect(cssBlock({ width: 447, height: 596 })).toBe(
      [
        "@page { size: 447pt 596pt; margin: 0; }",
        ":root { --page-w: 447pt; --page-h: 596pt; }",
        "html, body { width: 447pt; height: 596pt; margin: 0; }",
      ].join("\n"),
    );
  });

  test("round-trips through parseDeclaredPageBox and detects as matching", () => {
    // This is the "renders full-bleed with no letterboxing" property: the
    // block page --css hands out must be read back as exactly the device box
    // it was generated from, for every model.
    for (const model of ["RM100", "RM110", "RM02A", "RM03A", "RM102"] as const) {
      const box = pageBox(model);
      const block = cssBlock(box);
      const declared = parseDeclaredPageBox(block);
      expect(declared, model).toEqual(box);
      expect(detectPageBox(declared, box), model).toEqual({ status: "matches" });
    }
  });

  test("margin is zero on every rule, which is what full-bleed requires", () => {
    const block = cssBlock({ width: 447, height: 596 });
    expect(block).toContain("margin: 0");
    expect(block).not.toMatch(/margin:\s*[1-9]/);
  });
});
