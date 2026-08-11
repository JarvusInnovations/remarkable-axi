import { describe, expect, test } from "vitest";
import { decodeRgba, optimizeForReading, pageGeometry } from "../src/strokes.js";
import { frameFor } from "../src/render.js";
import { parsePageSelection } from "../src/commands/fetch.js";

/** Build a v6 stroke block the way the device stores one. */
function lineBlock(
  points: { x: number; y: number; width?: number }[],
  extra: Record<string, unknown> = {},
) {
  return {
    type: "sceneLineItem",
    item: {
      value: { tool: 21, color: 0, thicknessScale: 1, points, ...extra },
    },
  };
}

const v6 = (blocks: unknown[], paperSize: [number, number] = [1620, 2160]) => ({
  version: 6,
  paperSize,
  blocks,
});

describe("decodeRgba", () => {
  test("reads bytes as BGRA, not RGBA", () => {
    // Getting this backwards yields a plausible-looking but wrong palette,
    // e.g. cyan where the device drew yellow.
    expect(decodeRgba(0x0000ff)).toBe("#0000ff");
    expect(decodeRgba(0xff0000)).toBe("#ff0000");
    expect(decodeRgba(0x00b2fe)).toBe("#00b2fe");
  });

  test("tolerates the high alpha byte being set", () => {
    expect(decodeRgba(0xff00b2fe)).toBe("#00b2fe");
  });
});

describe("pageGeometry", () => {
  test("reads v6 stroke blocks", () => {
    const geo = pageGeometry(
      v6([lineBlock([{ x: 0, y: 0, width: 4 }, { x: 10, y: 10, width: 4 }])]),
    );
    expect(geo.strokes).toHaveLength(1);
    expect(geo.strokes[0]!.points).toHaveLength(2);
    expect(geo.paperSize).toEqual([1620, 2160]);
  });

  test("skips erased strokes and counts them", () => {
    // Erased ink stays in the file as a tombstone with no value; treating it as
    // a stroke throws, and dropping it silently misreports the page.
    const geo = pageGeometry(
      v6([
        lineBlock([{ x: 0, y: 0 }, { x: 1, y: 1 }]),
        { type: "sceneLineItem", item: { value: undefined } },
        { type: "sceneLineItem", item: {} },
      ]),
    );
    expect(geo.strokes).toHaveLength(1);
    expect(geo.deleted).toBe(2);
  });

  test("uses an exact colour when the stroke carries one", () => {
    const geo = pageGeometry(
      v6([
        lineBlock([{ x: 0, y: 0 }, { x: 1, y: 1 }], {
          tool: 18,
          color: 9,
          colorRgba: 0x00b2fe,
        }),
      ]),
    );
    expect(geo.strokes[0]!.color).toBe("#00b2fe");
    expect(geo.unmappedColors).toEqual([]);
  });

  test("learns a palette index from another stroke in the same page", () => {
    // A highlighter carries both an index and an exact colour, which teaches
    // us that index for the pens that only carry the index.
    const geo = pageGeometry(
      v6([
        lineBlock([{ x: 0, y: 0 }, { x: 1, y: 1 }], {
          tool: 18,
          color: 7,
          colorRgba: 0xe04a30,
        }),
        lineBlock([{ x: 2, y: 2 }, { x: 3, y: 3 }], { tool: 17, color: 7 }),
      ]),
    );
    const pen = geo.strokes.find((s) => s.brush !== "highlighter");
    expect(pen!.color).toBe("#e04a30");
    expect(geo.unmappedColors).toEqual([]);
  });

  test("resolves the calibrated pen palette", () => {
    // Read off a calibration page: each index captured beside its name written
    // in that pen's own colour.
    const geo = pageGeometry(
      v6([
        lineBlock([{ x: 0, y: 0 }, { x: 1, y: 1 }], { tool: 17, color: 6 }),
        lineBlock([{ x: 2, y: 2 }, { x: 3, y: 3 }], { tool: 17, color: 13 }),
      ]),
    );
    expect(geo.strokes[0]!.color).toBe("#1a63d8"); // blue
    expect(geo.strokes[1]!.color).toBe("#f2c010"); // yellow
    expect(geo.unmappedColors).toEqual([]);
  });

  test("refuses to learn an index that carries two different colours", () => {
    // Highlighter index 9 is a "colour is in colorRgba" marker, not a palette
    // entry. Learning from it would paint later strokes the first colour seen.
    const geo = pageGeometry(
      v6([
        lineBlock([{ x: 0, y: 0 }, { x: 1, y: 1 }], { tool: 18, color: 9, colorRgba: 0xbeeafe }),
        lineBlock([{ x: 2, y: 2 }, { x: 3, y: 3 }], { tool: 18, color: 9, colorRgba: 0xffc38c }),
        lineBlock([{ x: 4, y: 4 }, { x: 5, y: 5 }], { tool: 17, color: 9 }),
      ]),
    );
    const withRgba = geo.strokes.filter((s) => s.brush === "highlighter");
    expect(withRgba.map((s) => s.color).sort()).toEqual(["#beeafe", "#ffc38c"]);
    const pen = geo.strokes.find((s) => s.brush === "fineliner")!;
    expect(pen.color).toBe("#000000");
    expect(geo.unmappedColors).toEqual([9]);
  });

  test("reports unknown palette indices instead of guessing", () => {
    const geo = pageGeometry(
      v6([lineBlock([{ x: 0, y: 0 }, { x: 1, y: 1 }], { color: 42 })]),
    );
    expect(geo.strokes[0]!.color).toBe("#000000");
    expect(geo.unmappedColors).toEqual([42]);
  });

  test("puts highlighter strokes behind the ink", () => {
    // Drawing in document order hides the words being highlighted.
    const geo = pageGeometry(
      v6([
        lineBlock([{ x: 0, y: 0 }, { x: 1, y: 1 }], { tool: 17 }),
        lineBlock([{ x: 2, y: 2 }, { x: 3, y: 3 }], {
          tool: 18,
          colorRgba: 0xffff00,
        }),
      ]),
    );
    expect(geo.strokes[0]!.opacity).toBeLessThan(1);
    expect(geo.strokes[1]!.opacity).toBe(1);
  });

  test("reads v5 layered pages too", () => {
    const geo = pageGeometry({
      version: 5,
      layers: [
        {
          lines: [
            { brushType: 12, color: 0, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
            { brushType: 12, color: 0, points: [] },
          ],
        },
      ],
    });
    expect(geo.strokes).toHaveLength(1);
    expect(geo.deleted).toBe(1);
  });

  test("extracts typed text and drops format codes", () => {
    const geo = pageGeometry(
      v6([
        {
          type: "rootText",
          text: {
            items: [
              { value: "Four score" },
              { value: 1 },
              { value: " and seven\nyears ago" },
              { value: undefined },
            ],
          },
        },
      ]),
    );
    expect(geo.text).toEqual(["Four score and seven", "years ago"]);
  });

  test("survives a missing page", () => {
    const geo = pageGeometry(undefined);
    expect(geo.strokes).toEqual([]);
    expect(geo.bounds).toBeNull();
  });
});

describe("frameFor", () => {
  const geo = pageGeometry(
    v6([lineBlock([{ x: 100, y: 3000, width: 0 }, { x: 200, y: 3100, width: 0 }])]),
  );

  test("page fit grows to include ink past the sheet", () => {
    // An extended page can run several sheet-heights deep; clipping to
    // paperSize would silently drop most of the writing.
    const f = frameFor(geo, "page");
    expect(f.y).toBeLessThanOrEqual(0);
    expect(f.y + f.height).toBeGreaterThanOrEqual(3100);
    expect(f.x).toBeLessThanOrEqual(-810);
  });

  test("content fit crops tight to the ink", () => {
    const f = frameFor(geo, "content");
    expect(f.x).toBeGreaterThan(-810);
    expect(f.height).toBeLessThan(2160);
    expect(f.y).toBeLessThan(3000);
  });

  test("content fit falls back to the sheet when there is no ink", () => {
    const blank = pageGeometry(v6([]));
    const f = frameFor(blank, "content");
    expect(f.width).toBe(1620);
    expect(f.height).toBe(2160);
  });
});

describe("parsePageSelection", () => {
  test("handles numbers, ranges and both together", () => {
    expect(parsePageSelection("1,3", 10)).toEqual([0, 2]);
    expect(parsePageSelection("2-4", 10)).toEqual([1, 2, 3]);
    expect(parsePageSelection("1,3-5", 10)).toEqual([0, 2, 3, 4]);
  });

  test("is one-based and clamps to the page count", () => {
    expect(parsePageSelection("1", 3)).toEqual([0]);
    expect(parsePageSelection("3-99", 4)).toEqual([2, 3]);
    expect(parsePageSelection("99", 4)).toEqual([]);
  });

  test("dedupes while preserving request order", () => {
    expect(parsePageSelection("3,1,3,2", 5)).toEqual([2, 0, 1]);
  });

  test("rejects malformed input rather than ignoring it", () => {
    expect(() => parsePageSelection("abc", 5)).toThrow();
    expect(() => parsePageSelection("5-2", 9)).toThrow();
    expect(() => parsePageSelection("0-2", 9)).toThrow();
  });

  test("tolerates whitespace and empty segments", () => {
    expect(parsePageSelection(" 1 , 2 ,", 5)).toEqual([0, 1]);
  });
});

describe("optimizeForReading", () => {
  /** A stroke of given extent and width, shaped like a letter segment. */
  const glyph = (extent: number, width: number, extra: Record<string, unknown> = {}) =>
    lineBlock(
      [
        { x: 0, y: 0, width },
        { x: extent, y: 0, width },
      ],
      extra,
    );

  test("thins ink that is too bold to read", () => {
    // A pen set thick and used to write small merges letterforms into blobs;
    // one real page measured 0.90 where legible writing sits near 0.1.
    const geo = pageGeometry(v6([glyph(21, 19), glyph(21, 19), glyph(21, 19)]));
    const before = geo.strokes[0]!.width;
    const after = optimizeForReading(geo).strokes[0]!.width;
    expect(before / 21).toBeGreaterThan(0.5);
    expect(after / 21).toBeLessThan(0.2);
  });

  test("leaves already-thin ink alone rather than emboldening it", () => {
    // Thickening thin writing merges it, so weight is only ever reduced.
    const geo = pageGeometry(v6([glyph(200, 4), glyph(200, 4), glyph(200, 4)]));
    const out = optimizeForReading(geo);
    expect(out.strokes[0]!.width).toBeCloseTo(geo.strokes[0]!.width, 5);
  });

  test("keeps strokes above the width that survives rasterizing", () => {
    const geo = pageGeometry(v6([glyph(4000, 300), glyph(4000, 300), glyph(4000, 300)]));
    for (const s of optimizeForReading(geo).strokes) {
      expect(s.width).toBeGreaterThanOrEqual(0.8);
    }
  });

  test("darkens pale ink but preserves colour coding", () => {
    const geo = pageGeometry(
      v6([
        glyph(21, 19, { tool: 17, color: 13 }), // yellow: unreadable on white
        glyph(21, 19, { tool: 17, color: 6 }), // blue: already legible
        glyph(21, 19, { tool: 17, color: 6 }),
      ]),
    );
    const out = optimizeForReading(geo);
    const yellow = out.strokes.find((s) => s.color !== "#1a63d8")!;
    expect(yellow.color).not.toBe("#f2c010");
    expect(yellow.color).not.toBe("#000000"); // still recognisably yellow-ish
    expect(out.strokes.filter((s) => s.color === "#1a63d8")).toHaveLength(2);
  });

  test("fades highlighter wash, which sits under the words being read", () => {
    const geo = pageGeometry(
      v6([
        glyph(21, 19, { tool: 18, colorRgba: 0xffff00 }),
        glyph(21, 19),
        glyph(21, 19),
      ]),
    );
    const wash = optimizeForReading(geo).strokes.find((s) => s.opacity < 1)!;
    expect(wash.opacity).toBeLessThanOrEqual(0.15);
  });

  test("returns a blank page unchanged", () => {
    const geo = pageGeometry(v6([]));
    expect(optimizeForReading(geo).strokes).toEqual([]);
  });
});
