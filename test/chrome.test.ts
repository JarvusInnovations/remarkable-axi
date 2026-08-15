import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { findChrome, printToPdf, resetChromeCache } from "../src/chrome.js";

// Chrome is an optional external dependency (specs/architecture.md), so
// every test that actually invokes it self-skips when none is discovered —
// this suite must be able to pass on a machine with no Chrome installed,
// just like the tool itself degrades to a structured MISSING_TOOL rather
// than failing to start.
const chrome = await findChrome();

describe("findChrome", () => {
  test("resolves to either a working binary or null, never throws", () => {
    if (chrome === null) {
      expect(chrome).toBeNull();
      return;
    }
    expect(chrome.path.length).toBeGreaterThan(0);
    expect(chrome.version.length).toBeGreaterThan(0);
  });

  test("memoizes across calls", async () => {
    const again = await findChrome();
    expect(again).toEqual(chrome);
  });

  test("REMARKABLE_AXI_CHROME pointing at a nonexistent binary finds nothing", async () => {
    resetChromeCache();
    const prev = process.env.REMARKABLE_AXI_CHROME;
    process.env.REMARKABLE_AXI_CHROME = "/no/such/chrome-binary-here";
    try {
      expect(await findChrome()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.REMARKABLE_AXI_CHROME;
      else process.env.REMARKABLE_AXI_CHROME = prev;
      resetChromeCache();
    }
  });
});

describe.skipIf(chrome === null)("printToPdf", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-chrome-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("prints a sized @page document to a PDF at that box", async () => {
    const html = join(dir, "doc.html");
    const out = join(dir, "doc.pdf");
    await writeFile(
      html,
      "<html><head><style>@page { size: 300pt 400pt; margin: 0; }</style></head><body>hi</body></html>",
    );

    const result = await printToPdf(chrome!.path, html, out);
    expect(result.bytes).toBeGreaterThan(0);

    const bytes = await readFile(out);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("suppresses the default header/footer", async () => {
    const html = join(dir, "plain.html");
    const out = join(dir, "plain.pdf");
    await writeFile(html, "<html><body>no chrome header or footer</body></html>");

    await printToPdf(chrome!.path, html, out);
    const text = (await readFile(out)).toString("latin1");
    // The default header/footer template Chrome would otherwise stamp in
    // includes the source file:// URL; its absence is the observable proxy
    // for --no-pdf-header-footer having taken effect.
    expect(text).not.toContain("file://");
  });

  test("a write failure surfaces the extracted cause, not a silent empty file", async () => {
    const html = join(dir, "doc.html");
    const badOut = join(dir, "no-such-directory", "out.pdf");

    await expect(printToPdf(chrome!.path, html, badOut)).rejects.toThrow();
  });

  test("times out with a clear message rather than hanging", async () => {
    const html = join(dir, "doc.html");
    const out = join(dir, "timeout.pdf");

    await expect(
      printToPdf(chrome!.path, html, out, { timeoutMs: 1 }),
    ).rejects.toThrow(/did not finish within/);
  });
});
