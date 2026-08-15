import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { AxiError } from "axi-sdk-js";
import { check } from "../../src/commands/check.js";
import { findGhostscript, resetGhostscriptCache } from "../../src/gs.js";
import { findChrome } from "../../src/chrome.js";

// Every case below passes --device explicitly — same convention as
// test/commands/render.test.ts — so this suite never reads a developer's
// real stored config target.

const gs = await findGhostscript();
const chrome = await findChrome();

interface Finding {
  page: number;
  severity: string;
  check: string;
  detail: string;
}

describe.skipIf(gs === null)("check command", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-check-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    delete process.env.REMARKABLE_AXI_GS;
    resetGhostscriptCache();
  });

  async function writePdf(name: string, opts: { size?: [number, number]; rule?: number } = {}): Promise<string> {
    const doc = await PDFDocument.create();
    // Matches the `paper-pro` device box every test below targets, so a
    // fixture with no explicit `size` is a "clean" page-box case by
    // default rather than an incidental page-box finding every other
    // assertion has to see past.
    const size = opts.size ?? [509, 679];
    const page = doc.addPage(size);
    if (opts.rule !== undefined) {
      page.drawRectangle({ x: 20, y: size[1] - 40, width: size[0] - 40, height: opts.rule, color: rgb(0, 0, 0) });
    }
    const path = join(dir, name);
    await writeFile(path, await doc.save());
    return path;
  }

  test("check <pdf> rasterizes at the device density and reports page box status", async () => {
    const pdf = await writePdf("clean.pdf");
    const output = await check([pdf, "--device", "paper-pro", "--no-images"]);

    expect(String(output.check)).toContain("1 page");
    expect(String(output.check)).toContain("229dpi");
    expect(String(output.page_box)).toContain("509x679pt");
    expect(String(output.page_box)).toContain("matches");
  });

  test("a clean document says so explicitly rather than an empty findings table", async () => {
    const pdf = await writePdf("clean2.pdf");
    const output = await check([pdf, "--device", "paper-pro", "--no-images"]);
    expect(typeof output.findings).toBe("string");
    expect(String(output.findings)).toContain("clean");
  });

  test("a mismatched page size is flagged as a page-box finding, warn severity, exit still succeeds", async () => {
    const pdf = await writePdf("mismatch.pdf", { size: [300, 400] });
    const output = await check([pdf, "--device", "paper-pro", "--no-images"]);
    const findings = output.findings as Finding[];
    expect(Array.isArray(findings)).toBe(true);
    const pageBox = findings.find((f) => f.check === "page box");
    expect(pageBox).toMatchObject({ severity: "warn" });
    expect(pageBox?.detail).toContain("300x400pt");
  });

  test("a sub-pixel rule is flagged error; a rule at a safely resolvable width is not", async () => {
    const thin = await writePdf("thin.pdf", { rule: 0.05 });
    const thinOutput = await check([thin, "--device", "paper-pro", "--no-images"]);
    const thinFindings = thinOutput.findings as Finding[];
    const hairline = thinFindings.find((f) => f.check === "hairlines");
    expect(hairline).toMatchObject({ severity: "error" });

    const thick = await writePdf("thick.pdf", { rule: 2 });
    const thickOutput = await check([thick, "--device", "paper-pro", "--no-images"]);
    expect(typeof thickOutput.findings === "string" ? [] : (thickOutput.findings as Finding[]).filter((f) => f.check === "hairlines")).toHaveLength(0);
  });

  test("--no-images emits findings only, no images key", async () => {
    const pdf = await writePdf("no-images.pdf");
    const output = await check([pdf, "--device", "paper-pro", "--no-images"]);
    expect(output.images).toBeUndefined();
  });

  test("images are written by default, one PNG per page", async () => {
    const pdf = await writePdf("with-images.pdf");
    const output = await check([pdf, "--device", "paper-pro"]);
    const images = output.images as { page: number; path: string }[];
    expect(images).toHaveLength(1);
    const info = await stat(images[0]!.path.replace(/^~/, process.env.HOME ?? ""));
    expect(info.size).toBeGreaterThan(0);
  });

  test("--pages restricts images but findings still cover every page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([509, 679]); // matches paper-pro's box — clean
    doc.addPage([300, 400]); // mismatched size -> page-box finding on page 2
    const path = join(dir, "two-page.pdf");
    await writeFile(path, await doc.save());

    const output = await check([path, "--device", "paper-pro", "--pages", "1"]);
    const images = output.images as { page: number; path: string }[];
    expect(images.map((i) => i.page)).toEqual([1]);

    // The invariant: restricting images must never narrow the findings.
    // Page 2 was not imaged, but its page-box mismatch is still reported.
    const findings = output.findings as { pages: string; check: string }[];
    expect(findings.some((f) => f.pages.includes("2") && f.check === "page box")).toBe(true);
  });

  test("a finding repeated across pages collapses into one row listing them", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 4; i++) doc.addPage([300, 400]); // all mismatched alike
    const path = join(dir, "repeating.pdf");
    await writeFile(path, await doc.save());

    const output = await check([path, "--device", "paper-pro", "--no-images"]);
    const findings = output.findings as { pages: string; check: string }[];
    const pageBox = findings.filter((f) => f.check === "page box");

    // One document-level fact, reported once — not once per page.
    expect(pageBox).toHaveLength(1);
    expect(pageBox[0]!.pages).toBe("1-4");
  });

  test("--out writes images to the given directory", async () => {
    const pdf = await writePdf("custom-out.pdf");
    const outDir = join(dir, "custom-images");
    const output = await check([pdf, "--device", "paper-pro", "--out", outDir]);
    const images = output.images as { page: number; path: string }[];
    expect(images[0]!.path).toContain("custom-images");
  });

  test("bleed is flagged when the CropBox is smaller than the MediaBox", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([460, 610]);
    page.setCropBox(0, 0, 447, 596);
    const path = join(dir, "bleed.pdf");
    await writeFile(path, await doc.save());

    const output = await check([path, "--device", "paper-pro", "--no-images"]);
    const findings = output.findings as Finding[];
    const bleed = findings.find((f) => f.check === "bleed");
    expect(bleed).toMatchObject({ severity: "warn" });
  });

  test("an uncalibrated device target is caveated once, in page_box, not per finding", async () => {
    const pdf = await writePdf("uncalibrated.pdf", { size: [300, 400] });
    // rm1: RM110's page box is verified on hardware and so carries no caveat.
    const output = await check([pdf, "--device", "rm1", "--no-images"]);
    expect(String(output.page_box)).toContain("unverified");
    const findings = output.findings as { detail: string }[];
    for (const f of findings) {
      expect(f.detail).not.toContain("unverified");
    }
  });

  test("a missing source fails NOT_FOUND", async () => {
    await expect(
      check([join(dir, "does-not-exist.pdf"), "--device", "paper-pro"]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a non-PDF, non-HTML source fails USAGE", async () => {
    const bogus = join(dir, "data.txt");
    await writeFile(bogus, "not a document");
    await expect(check([bogus, "--device", "paper-pro"])).rejects.toMatchObject({
      code: "USAGE",
    });
  });

  test("no device target and no --device fails NO_DEVICE", async () => {
    const pdf = await writePdf("no-device.pdf");
    const home = await mkdtemp(join(tmpdir(), "remarkable-axi-check-home-"));
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      await expect(check([pdf])).rejects.toMatchObject({ code: "NO_DEVICE" });
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("an unknown flag fails rather than being silently ignored", async () => {
    const pdf = await writePdf("bogus-flag.pdf");
    await expect(
      check([pdf, "--device", "paper-pro", "--bogus"]),
    ).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
  });

  test("ghostscript not found fails MISSING_TOOL naming the install and doctor", async () => {
    const pdf = await writePdf("missing-gs.pdf");
    process.env.REMARKABLE_AXI_GS = "/no/such/gs-binary-here";
    resetGhostscriptCache();

    try {
      await check([pdf, "--device", "paper-pro"]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("MISSING_TOOL");
      expect(axi.suggestions.join(" ")).toContain("doctor");
    }
  });

  describe.skipIf(chrome === null)("html sources", () => {
    async function writeHtml(name: string, body: string): Promise<string> {
      const path = join(dir, name);
      await writeFile(path, body);
      return path;
    }

    test("check <html> renders first, then lints, in one call", async () => {
      const html = await writeHtml(
        "flyer.html",
        "<html><head><style>@page { size: 447pt 596pt; margin: 0; }</style></head><body><h1>flyer</h1></body></html>",
      );
      const output = await check([html, "--device", "rm2", "--no-images"]);
      expect(String(output.check)).toContain("flyer.html");
      expect(String(output.page_box)).toContain("matches");
    });

    test("a source with no @page reports the same absent status render's own detection uses", async () => {
      const html = await writeHtml("no-page.html", "<html><body>x</body></html>");
      const output = await check([html, "--device", "rm2", "--no-images"]);
      const findings = output.findings as Finding[];
      const pageBox = findings.find((f) => f.check === "page box");
      expect(pageBox?.detail).toContain("no @page declared");
      expect(pageBox?.detail).toContain("US Letter");
      // The rendered PDF itself is still correctly sized (render injects
      // the device box), so the top-level summary shows "matches", not the
      // "no @page" note — that note is specifically about the source.
      expect(String(output.page_box)).toContain("matches");
    });

    test("a differing @page declaration is honored and reported with the signed delta — same numbers render would show", async () => {
      const html = await writeHtml(
        "differs.html",
        "<html><head><style>@page { size: 600pt 800pt; margin: 0; }</style></head><body>x</body></html>",
      );
      const output = await check([html, "--device", "rm2", "--no-images"]);
      expect(String(output.page_box)).toContain("600x800pt");
      expect(String(output.page_box)).toContain("153pt wider");
      expect(String(output.page_box)).toContain("204pt taller");
    });

    test("help suggests re-checking specific pages after editing", async () => {
      const html = await writeHtml("edit-loop.html", "<html><body>x</body></html>");
      const output = await check([html, "--device", "rm2", "--pages", "1"]);
      expect((output.help as string[]).join(" ")).toContain("--pages 1");
      expect((output.help as string[]).join(" ")).toContain("after editing");
    });
  });
});
