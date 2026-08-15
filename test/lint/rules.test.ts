import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { findGhostscript } from "../../src/gs.js";
import { findChrome } from "../../src/chrome.js";
import { rasterizePage, type RasterPage } from "../../src/lint/rasterize.js";
import { checkContrast, checkHairlines, checkTypeSize } from "../../src/lint/rules.js";
import { render } from "../../src/commands/render.js";

const gs = await findGhostscript();
const chrome = await findChrome();

const RM110_DPI = 226;

describe.skipIf(gs === null)("raster lint rules", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-rules-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function rasterizeFirstPage(pdfPath: string): Promise<RasterPage> {
    return rasterizePage(gs!.path, pdfPath, 1, RM110_DPI);
  }

  // -------------------------------------------------------------------
  // Hairlines — built directly with pdf-lib rather than rendered HTML,
  // because headless Chrome's own print rasterizer floors any CSS
  // dimension under 1 CSS px (0.75pt) to a full CSS px before this tool
  // ever sees it (verified while calibrating: a declared 0.4pt CSS height
  // always rendered as a 0.75pt rectangle in the resulting PDF's own
  // geometry), so no HTML source can produce a true sub-pixel rule to
  // trip this rule against a real device dpi of ~0.32pt. A PDF authored
  // directly has no such floor, matching the realistic case this rule
  // exists for: a professionally produced PDF with finer geometry than
  // any browser print pipeline emits.
  // -------------------------------------------------------------------

  async function buildRulePdf(heightPt: number): Promise<string> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    page.drawRectangle({ x: 20, y: 100, width: 260, height: heightPt, color: rgb(0, 0, 0) });
    const path = join(dir, `rule-${heightPt}.pdf`);
    await writeFile(path, await doc.save());
    return path;
  }

  test("a rule well under one device pixel trips hairlines as error", async () => {
    const raster = await rasterizeFirstPage(await buildRulePdf(0.1));
    const finding = checkHairlines(raster, 1, RM110_DPI);
    expect(finding).toMatchObject({ page: 1, severity: "error", check: "hairlines" });
    expect(finding?.detail).toContain("resolvable at 226dpi");
  });

  test("a rule comfortably over one device pixel does not trip hairlines", async () => {
    const raster = await rasterizeFirstPage(await buildRulePdf(2));
    expect(checkHairlines(raster, 1, RM110_DPI)).toBeNull();
  });

  // -------------------------------------------------------------------
  // Contrast and type size — rendered from real HTML/CSS through the
  // exact `render` path, since both rules are about what actually reaches
  // the panel, and the only way to know that is to run the whole pipeline
  // (Chrome print -> Ghostscript raster) a caller would run.
  // -------------------------------------------------------------------

  describe.skipIf(chrome === null)("rendered-HTML fixtures", () => {
    async function renderFixture(name: string, body: string): Promise<string> {
      const html = join(dir, `${name}.html`);
      await writeFile(
        html,
        `<html><head><style>@page { size: 447pt 596pt; margin: 0; } html,body { width:447pt; height:596pt; margin:0; background:#fff; }</style></head><body>${body}</body></html>`,
      );
      const out = join(dir, `${name}.pdf`);
      await render([html, "--device", "rm2", "--out", out]);
      return out;
    }

    test("very light grey text on white trips contrast", async () => {
      const pdf = await renderFixture(
        "faint",
        '<p style="color:#eeeeee;font-size:14pt;margin:20pt;font-family:sans-serif;">faint text sample abcdefgh</p>',
      );
      const raster = await rasterizeFirstPage(pdf);
      const finding = checkContrast(raster, 1);
      expect(finding).toMatchObject({ page: 1, severity: "warn", check: "contrast" });
      expect(finding?.detail).toContain("level");
      expect(finding?.detail).toContain("16-level panel");
    });

    test("black text on white does not trip contrast", async () => {
      const pdf = await renderFixture(
        "clear",
        '<p style="color:#000;font-size:14pt;margin:20pt;font-family:sans-serif;">clearly readable text sample abcdefgh</p>',
      );
      const raster = await rasterizeFirstPage(pdf);
      expect(checkContrast(raster, 1)).toBeNull();
    });

    test("text far below the legible floor trips type size", async () => {
      const pdf = await renderFixture(
        "tiny",
        '<p style="font-size:2.5pt;margin:20pt;font-family:sans-serif;color:#000;">extremely tiny text sample abcdefgh</p>',
      );
      const raster = await rasterizeFirstPage(pdf);
      const finding = checkTypeSize(raster, 1, RM110_DPI);
      expect(finding).toMatchObject({ page: 1, severity: "warn", check: "type size" });
      expect(finding?.detail).toContain("legible floor");
    });

    test("normal body text does not trip type size", async () => {
      const pdf = await renderFixture(
        "normal",
        '<p style="font-size:12pt;margin:20pt;font-family:sans-serif;color:#000;">normal readable body text sample abcdefgh</p>',
      );
      const raster = await rasterizeFirstPage(pdf);
      expect(checkTypeSize(raster, 1, RM110_DPI)).toBeNull();
    });

    test("a heading with a lone descender does not fragment into a false type-size finding", async () => {
      // Regression: a low-transition gap between a line's x-height body and
      // an isolated descender ("y") used to read as its own tiny "line".
      const pdf = await renderFixture("heading", "<h1>flyer</h1>");
      const raster = await rasterizeFirstPage(pdf);
      expect(checkTypeSize(raster, 1, RM110_DPI)).toBeNull();
    });

    test("a 2pt CSS border — well above the CSS-px floor — does not trip hairlines", async () => {
      const pdf = await renderFixture(
        "border",
        '<hr style="border:none;height:2pt;background:#000;width:300pt;margin:40pt;">',
      );
      const raster = await rasterizeFirstPage(pdf);
      expect(checkHairlines(raster, 1, RM110_DPI)).toBeNull();
    });
  });
});
