import { describe, expect, it } from "vitest";
import { findGhostscript } from "../src/gs.js";
import {
  SIMILARITY_WARN,
  carryTable,
  measureSimilarity,
  planCarry,
  summarizeCarry,
  withSimilarity,
  compareDarkness,
  type PageBox,
} from "../src/ink-carry.js";

const box = (w: number, h: number): PageBox => ({ width: w, height: h });
const A4 = box(509, 679);

describe("planCarry", () => {
  it("ports every inked page when the replacement is the same length", () => {
    const plan = planCarry([0, 2], 3, [A4, A4, A4], [A4, A4, A4]);
    expect(plan.ported).toEqual([0, 2]);
    expect(plan.complete).toBe(true);
  });

  // The scroll case: yesterday's pages keep their ink, the appended page
  // arrives clean — no special handling, which is why matching is by index.
  it("ports existing pages when the replacement appends", () => {
    const plan = planCarry([0, 1], 4, [A4, A4], [A4, A4, A4, A4]);
    expect(plan.ported).toEqual([0, 1]);
    expect(plan.complete).toBe(true);
  });

  it("orphans ink past the end of a shorter replacement", () => {
    const plan = planCarry([0, 3], 2, [A4, A4, A4, A4], [A4, A4]);
    expect(plan.ported).toEqual([0]);
    expect(plan.complete).toBe(false);
    const orphan = plan.outcomes.find((o) => o.index === 3)!;
    expect(orphan.disposition).toBe("orphaned");
    expect(orphan.reason).toContain("only 2 pages");
  });

  // Ink is positioned in page-relative coordinates, so replaying it onto a
  // reshaped page would misplace it — refuse rather than guess.
  it("skips a page whose box changed", () => {
    const plan = planCarry([0], 1, [A4], [box(679, 509)]);
    expect(plan.ported).toEqual([]);
    expect(plan.complete).toBe(false);
    expect(plan.outcomes[0]!.disposition).toBe("skipped");
    expect(plan.outcomes[0]!.reason).toContain("509x679 → 679x509");
  });

  it("treats an unknown box as no evidence of a mismatch", () => {
    const plan = planCarry([0], 1, [], []);
    expect(plan.ported).toEqual([0]);
    expect(plan.complete).toBe(true);
  });

  it("is not complete when there was no ink to carry", () => {
    expect(planCarry([], 3).complete).toBe(false);
  });

  it("sorts outcomes by page order regardless of input order", () => {
    const plan = planCarry([2, 0, 1], 3);
    expect(plan.outcomes.map((o) => o.index)).toEqual([0, 1, 2]);
  });
});

describe("summarizeCarry", () => {
  it("reports 1-based page numbers", () => {
    const summary = summarizeCarry(planCarry([0, 1], 3, [A4, A4], [A4, A4, A4]));
    expect(summary).toEqual({ ported: 2, pages: "1,2" });
  });

  it("names what did not make it, and why", () => {
    const summary = summarizeCarry(planCarry([0, 2], 1, [A4, A4, A4], [A4]));
    expect(summary.ported).toBe(1);
    expect((summary.orphaned as string[])[0]).toContain("page 3");
  });
});

// Raster-dependent, so it skips where Ghostscript is absent — the same
// pattern test/lint/rules.test.ts uses for check's own raster rules.
const gs = await findGhostscript();

describe.skipIf(gs === null)("measureSimilarity", () => {
  // Real PDFs with real drawn content: the point of the measurement is that
  // it compares rendered pixels, so a synthetic stand-in would test nothing.
  async function pdf(pages: { text: string }[]): Promise<Uint8Array> {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const p of pages) {
      const page = doc.addPage([509, 679]);
      page.drawText(p.text, { x: 40, y: 400, size: 48, font });
    }
    return doc.save();
  }

  it("scores an unchanged page near 1", async () => {
    const a = await pdf([{ text: "ALPHA" }]);
    const sim = await measureSimilarity(a, a, [0]);
    expect(sim.get(0)!).toBeGreaterThan(0.99);
  });

  // The failure index matching is structurally blind to: insert a page at the
  // front and every later page still has a matching index and page box, while
  // all of its ink now sits on the wrong content.
  it("scores a page shifted by a mid-document insert well below the warn line", async () => {
    const before = await pdf([{ text: "ALPHA" }, { text: "BETA" }]);
    const after = await pdf([{ text: "ALPHA" }, { text: "INSERT" }, { text: "BETA" }]);
    const sim = await measureSimilarity(before, after, [1]);
    expect(sim.get(1)!).toBeLessThan(SIMILARITY_WARN);
  });

  it("reports nothing rather than guessing when a page cannot be rendered", async () => {
    const a = await pdf([{ text: "ALPHA" }]);
    const sim = await measureSimilarity(a, a, [7]); // page 8 of a 1-page doc
    expect(sim.has(7)).toBe(false);
  });
});

describe("carryTable", () => {
  it("gives every inked page a row, and distinguishes unmeasured from fine", () => {
    const plan = withSimilarity(planCarry([0, 1], 2), new Map([[0, 0.995]]));
    const rows = carryTable(plan);
    expect(rows[0]).toMatchObject({ page: 1, ported: "yes", similarity: "0.99", note: "layout unchanged" });
    // Page 2 ported but was never measured — that must not read as agreement.
    expect(rows[1]).toMatchObject({ page: 2, ported: "yes", similarity: "—", note: "layout not compared" });
  });

  it("flags a shifted page in words, not just a number", () => {
    const plan = withSimilarity(planCarry([0], 1), new Map([[0, 0.61]]));
    expect(carryTable(plan)[0]!.note).toContain("no longer sit on what it annotated");
  });
});

// The metric itself, exercised without Ghostscript so CI covers it wherever
// it runs — the raster plumbing above is what needs a real renderer.
describe("compareDarkness", () => {
  const page = (dark: number[]) => Uint8Array.from(dark.map((d) => 255 - d));

  it("scores identical rasters 1", () => {
    expect(compareDarkness(page([0, 200, 40]), page([0, 200, 40]))).toBe(1);
  });

  it("scores ink-vs-blank 0", () => {
    expect(compareDarkness(page([255, 255]), page([0, 0]))).toBe(0);
  });

  // The reason for the weighting: a mostly-white page pair with *different*
  // content would score ~0.97 on a plain per-pixel mean, which is
  // indistinguishable from a match. Ink-weighted, it collapses.
  it("is not fooled by a shared white background", () => {
    const mostlyWhite = (inkAt: number) =>
      page(Array.from({ length: 400 }, (_, i) => (i === inkAt ? 255 : 0)));
    expect(compareDarkness(mostlyWhite(5), mostlyWhite(300))).toBeLessThan(0.1);
  });

  it("treats two blank pages as agreeing — nothing to disagree about", () => {
    expect(compareDarkness(page([0, 0, 0]), page([0, 0, 0]))).toBe(1);
  });

  it("refuses to compare mismatched sizes", () => {
    expect(compareDarkness(page([0, 0]), page([0, 0, 0]))).toBe(0);
  });
});
