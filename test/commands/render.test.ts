import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { AxiError } from "axi-sdk-js";
import { render } from "../../src/commands/render.js";
import { findChrome, resetChromeCache } from "../../src/chrome.js";

// Every case below passes --device explicitly, so the command never reads
// (or writes) a developer's real stored config target — same convention as
// test/commands/page.test.ts.

const chrome = await findChrome();

async function mediaBox(pdfPath: string): Promise<{ width: number; height: number }> {
  const doc = await PDFDocument.load(await readFile(pdfPath));
  const size = doc.getPage(0).getSize();
  return { width: Math.round(size.width), height: Math.round(size.height) };
}

describe.skipIf(chrome === null)("render command", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-render-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    delete process.env.REMARKABLE_AXI_CHROME;
    resetChromeCache();
  });

  async function writeHtml(name: string, body: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, body);
    return path;
  }

  test("no @page in source: injects the device box and reports (injected)", async () => {
    const html = await writeHtml(
      "no-page.html",
      "<html><head></head><body><h1>flyer</h1></body></html>",
    );

    const output = await render([html, "--device", "paper-pro"]);
    const rendered = output.rendered as Record<string, unknown>;

    expect(rendered.page).toBe("509x679pt (injected)");
    expect(rendered.device).toBe("RM02A");
    expect(rendered.pages).toBe(1);

    const out = join(dir, "no-page.pdf");
    expect(rendered.out).toBe(out);
    expect(await mediaBox(out)).toEqual({ width: 509, height: 679 });
  });

  test("@page { margin: 0 } with no size still counts as absent and composes an injected rule", async () => {
    // The documented wrinkle: a size-less @page rule parses as absent, so
    // the injected rule must compose with it rather than conflict.
    const html = await writeHtml(
      "wrinkle.html",
      "<html><head><style>@page { margin: 0; } body { background: #eee; }</style></head><body>x</body></html>",
    );

    const output = await render([html, "--device", "paper-pro"]);
    const rendered = output.rendered as Record<string, unknown>;

    expect(rendered.page).toBe("509x679pt (injected)");
    expect(await mediaBox(join(dir, "wrinkle.pdf"))).toEqual({
      width: 509,
      height: 679,
    });
  });

  test("a matching @page proceeds and reports (matches)", async () => {
    const html = await writeHtml(
      "matches.html",
      "<html><head><style>@page { size: 509pt 679pt; margin: 0; }</style></head><body>x</body></html>",
    );

    const output = await render([html, "--device", "paper-pro"]);
    const rendered = output.rendered as Record<string, unknown>;

    expect(rendered.page).toBe("509x679pt (matches)");
    expect(await mediaBox(join(dir, "matches.pdf"))).toEqual({
      width: 509,
      height: 679,
    });
  });

  test("a differing @page is honored, not overridden, with the signed delta reported", async () => {
    const html = await writeHtml(
      "differs.html",
      "<html><head><style>@page { size: 600pt 800pt; margin: 0; }</style></head><body>x</body></html>",
    );

    const output = await render([html, "--device", "paper-pro"]);
    const rendered = output.rendered as Record<string, unknown>;

    expect(rendered.page).toBe(
      "600x800pt (honored; 91pt wider, 121pt taller)",
    );
    // The declared box was honored — the produced PDF is at the author's
    // size, not silently substituted with the device box.
    expect(await mediaBox(join(dir, "differs.pdf"))).toEqual({
      width: 600,
      height: 800,
    });
  });

  test("--device-page overrides a differing declaration with the device box", async () => {
    const html = await writeHtml(
      "override.html",
      "<html><head><style>@page { size: 600pt 800pt; margin: 0; }</style></head><body>x</body></html>",
    );

    const output = await render([
      html,
      "--device",
      "paper-pro",
      "--device-page",
      "--out",
      join(dir, "overridden.pdf"),
    ]);
    const rendered = output.rendered as Record<string, unknown>;

    expect(rendered.page).toBe(
      "509x679pt (overridden; declared 600x800pt, 91pt wider, 121pt taller)",
    );
    expect(await mediaBox(join(dir, "overridden.pdf"))).toEqual({
      width: 509,
      height: 679,
    });
  });

  test("--device-page is a no-op when the declaration already matches", async () => {
    const html = await writeHtml(
      "matches2.html",
      "<html><head><style>@page { size: 509pt 679pt; margin: 0; }</style></head><body>x</body></html>",
    );

    const output = await render([html, "--device", "paper-pro", "--device-page"]);
    expect((output.rendered as Record<string, unknown>).page).toBe(
      "509x679pt (matches)",
    );
  });

  test("--out is a path, honored exactly, and never selects a format", async () => {
    const html = await writeHtml(
      "custom-out.html",
      "<html><body>x</body></html>",
    );
    const out = join(dir, "nested", "..", "custom.pdf");

    const output = await render([html, "--device", "paper-pro", "--out", out]);
    const rendered = output.rendered as Record<string, unknown>;

    expect(rendered.out).toBe(join(dir, "custom.pdf"));
    const info = await stat(join(dir, "custom.pdf"));
    expect(info.size).toBeGreaterThan(0);
  });

  test("--landscape transposes the injected box", async () => {
    const html = await writeHtml("landscape.html", "<html><body>x</body></html>");

    const output = await render([html, "--device", "paper-pro", "--landscape"]);
    expect((output.rendered as Record<string, unknown>).page).toBe(
      "679x509pt (injected)",
    );
    expect(await mediaBox(join(dir, "landscape.pdf"))).toEqual({
      width: 679,
      height: 509,
    });
  });

  test("the calibration caveat is stated once, in the device field", async () => {
    const html = await writeHtml("caveat.html", "<html><body>x</body></html>");

    // rm1: RM110's page box is verified on hardware and so carries no caveat.
    const output = await render([html, "--device", "rm1"]);
    const rendered = output.rendered as Record<string, unknown>;

    expect(rendered.device).toBe(
      "RM100 — page box unverified, derived from published specs",
    );
    expect(String(rendered.page)).not.toContain("unverified");
  });

  test("a missing source fails NOT_FOUND", async () => {
    await expect(
      render([join(dir, "does-not-exist.html"), "--device", "paper-pro"]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a non-HTML source fails USAGE", async () => {
    const notHtml = await writeHtml("data.txt", "not html");
    await expect(
      render([notHtml, "--device", "paper-pro"]),
    ).rejects.toMatchObject({ code: "USAGE" });
  });

  test("no source argument fails USAGE", async () => {
    await expect(render(["--device", "paper-pro"])).rejects.toMatchObject({
      code: "USAGE",
    });
  });

  test("an unknown flag fails rather than being silently ignored", async () => {
    const html = await writeHtml("bogus-flag.html", "<html><body>x</body></html>");
    await expect(
      render([html, "--device", "paper-pro", "--bogus"]),
    ).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
  });

  test("Chrome not found fails MISSING_TOOL naming the install and doctor", async () => {
    const html = await writeHtml("missing-chrome.html", "<html><body>x</body></html>");
    process.env.REMARKABLE_AXI_CHROME = "/no/such/chrome-binary-here";
    resetChromeCache();

    try {
      await render([html, "--device", "paper-pro"]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("MISSING_TOOL");
      expect(axi.suggestions.join(" ")).toContain("doctor");
    }
  });

  test("a render failure surfaces RENDER_FAILED with an extracted cause", async () => {
    const html = await writeHtml("write-fails.html", "<html><body>x</body></html>");
    const badOut = join(dir, "no-such-subdir", "out.pdf");

    try {
      await render([html, "--device", "paper-pro", "--out", badOut]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("RENDER_FAILED");
      // The cause is extracted, not the raw multi-line Chrome stream dumped
      // wholesale.
      expect(axi.message.split("\n").length).toBeLessThan(5);
    }
  });

  test("no device target and no --device fails NO_DEVICE", async () => {
    const html = await writeHtml("no-device.html", "<html><body>x</body></html>");
    const home = await mkdtemp(join(tmpdir(), "remarkable-axi-home-"));
    const prevHome = process.env.HOME;
    process.env.HOME = home;

    try {
      await expect(render([html])).rejects.toMatchObject({ code: "NO_DEVICE" });
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      await rm(home, { recursive: true, force: true });
    }
  });
});
