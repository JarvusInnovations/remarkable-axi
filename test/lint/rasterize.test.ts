import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { findGhostscript } from "../../src/gs.js";
import { rasterizePage } from "../../src/lint/rasterize.js";

const gs = await findGhostscript();

describe.skipIf(gs === null)("rasterizePage", () => {
  let dir: string;
  let pdfPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-rasterize-test-"));
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: rgb(0, 0, 0) });
    doc.addPage([300, 400]);
    pdfPath = join(dir, "two-page.pdf");
    await writeFile(pdfPath, await doc.save());
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("rasterizes a page to the size implied by its point dimensions and dpi", async () => {
    const raster = await rasterizePage(gs!.path, pdfPath, 1, 226);
    // 300pt x 400pt at 226dpi: 300*226/72 ≈ 941, 400*226/72 ≈ 1256.
    expect(raster.width).toBeGreaterThanOrEqual(940);
    expect(raster.width).toBeLessThanOrEqual(942);
    expect(raster.height).toBeGreaterThanOrEqual(1255);
    expect(raster.height).toBeLessThanOrEqual(1257);
    expect(raster.pixels.length).toBe(raster.width * raster.height);
  });

  test("rasterizes at a different dpi produces proportionally different dimensions", async () => {
    const low = await rasterizePage(gs!.path, pdfPath, 1, 113);
    const high = await rasterizePage(gs!.path, pdfPath, 1, 226);
    expect(high.width).toBeGreaterThan(low.width * 1.8);
  });

  test("selects the requested page, not always the first", async () => {
    // Page 2 is left blank white; page 1 has a black square drawn on it.
    const page1 = await rasterizePage(gs!.path, pdfPath, 1, 100);
    const page2 = await rasterizePage(gs!.path, pdfPath, 2, 100);
    const hasDark = (r: { pixels: Uint8Array }) => [...r.pixels].some((v) => v < 50);
    expect(hasDark(page1)).toBe(true);
    expect(hasDark(page2)).toBe(false);
  });

  test("pixel values span the antialiased grey range, not just pure black/white", async () => {
    // A rectangle at pixel-aligned coordinates can rasterize with almost no
    // antialiasing at all (its edges fall exactly on sample boundaries) —
    // this needs geometry whose edges deliberately don't land on the pixel
    // grid, the same reason `rules.ts`'s hairline calibration used
    // fractional-point rule widths rather than round numbers.
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(1, 1, 1) });
    page.drawRectangle({
      x: 50.37,
      y: 50.62,
      width: 99.21,
      height: 100.53,
      color: rgb(0, 0, 0),
    });
    const path = join(dir, "fractional.pdf");
    await writeFile(path, await doc.save());

    const raster = await rasterizePage(gs!.path, path, 1, 226);
    const distinct = new Set(raster.pixels).size;
    // `-dGraphicsAlphaBits=4` quantizes coverage to 16 levels, and a plain
    // rectangle has only 4 straight edges — so this tops out at a handful
    // of intermediate values (measured: 7, including 0 and 255), not a
    // smooth ramp. More than the bare 2 (pure black/white) is enough to
    // confirm antialiasing is actually active rather than disabled.
    expect(distinct).toBeGreaterThan(4);
  });

  test("a missing PDF surfaces a thrown error rather than an empty buffer", async () => {
    await expect(
      rasterizePage(gs!.path, join(dir, "does-not-exist.pdf"), 1, 226),
    ).rejects.toThrow();
  });
});
