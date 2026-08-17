import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { RemarkableApi } from "rmapi-js";
import { render } from "../../src/commands/render.js";
import { findChrome, resetChromeCache } from "../../src/chrome.js";
import { findGhostscript } from "../../src/gs.js";

// `client()` is the only cloud entry point `put` uses directly, same as
// test/commands/put.test.ts. `readConfig` is mocked too — put has no
// `--device` flag of its own for its HTML path, so the configured target is
// the only way to steer `render`/`check`'s device resolution from a test,
// and mocking it here sidesteps this machine's real paired config (and the
// pre-existing HOME-swap quirk render.test.ts/check.test.ts already hit).
const authMock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../../src/auth.js", () => authMock);

const configMock = vi.hoisted(() => ({
  readConfig: vi.fn(async (): Promise<{ targetDevice?: string }> => ({
    targetDevice: "RM02A",
  })),
  writeConfig: vi.fn(),
  configPath: "/dev/null/remarkable-axi-put-html-test-config.json",
}));
vi.mock("../../src/config.js", () => configMock);

// `check` is mocked with a pass-through to the real implementation by
// default, so every test below exercises the genuine render+lint pipeline;
// only the --strict/error-severity tests override it for one call, since a
// real error-severity finding needs a rasterizer-defeating rule width that
// Chrome's own print path won't produce (see src/lint/rules.ts's hairline
// comment on why pdf-lib-authored fixtures are used for that elsewhere).
const checkMock = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("../../src/commands/check.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/commands/check.js")>();
  checkMock.check.mockImplementation(actual.check);
  return { check: checkMock.check };
});

// Imported after the mocks are registered, and at module scope rather than
// inside a test body — see test/commands/put.test.ts for why.
const { put } = await import("../../src/commands/put.js");

const chrome = await findChrome();
const gs = await findGhostscript();

interface Finding {
  pages: string;
  severity: "error" | "warn";
  check: string;
  detail: string;
}

/** A minimal cloud fake: an empty account, so every test lands at `/`. */
function fakeApi() {
  const calls = { putPdf: 0 };
  const api = {
    listRefs: async () => [],
    raw: {
      getEntries: async () => ({ entries: [] }),
      getText: async () => "",
      getContent: async () => ({}),
    },
    putPdf: async (name: string) => {
      calls.putPdf++;
      const id = `new-${name}`;
      return { id, hash: `hash-${id}` };
    },
    putEpub: async (name: string) => {
      const id = `new-${name}`;
      return { id, hash: `hash-${id}` };
    },
  };
  return { api: api as unknown as RemarkableApi, calls };
}

describe.skipIf(chrome === null || gs === null)("put HTML source dispatch", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-put-html-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    authMock.client.mockReset();
    configMock.readConfig.mockResolvedValue({ targetDevice: "RM02A" });
    delete process.env.REMARKABLE_AXI_CHROME;
    resetChromeCache();
  });

  async function writeHtml(name: string, body: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, body);
    return path;
  }

  test("renders at the device box, uploads a PDF, and reports the page disposition and clean findings", async () => {
    const html = await writeHtml(
      "clean.html",
      "<html><head><style>@page { size: 509pt 679pt; margin: 0; }</style></head><body><h1>flyer</h1></body></html>",
    );
    const { api, calls } = fakeApi();
    authMock.client.mockResolvedValue(api);

    const output = await put([html, "/"]);

    expect(output.uploaded).toMatchObject({ path: "/clean", format: "pdf" });
    expect(output.page).toBe("509x679pt (matches)");
    expect(output.findings).toBe("clean — every page checked, nothing to report");
    expect(calls.putPdf).toBe(1);
  });

  test(".htm dispatches the same as .html", async () => {
    const html = await writeHtml("clean.htm", "<html><body>x</body></html>");
    const { api, calls } = fakeApi();
    authMock.client.mockResolvedValue(api);

    const output = await put([html, "/"]);

    expect(output.uploaded).toMatchObject({ format: "pdf" });
    expect(calls.putPdf).toBe(1);
  });

  test("an undeclared @page is injected to match the device box exactly", async () => {
    const html = await writeHtml(
      "no-page.html",
      "<html><body><h1>flyer</h1></body></html>",
    );
    const { api } = fakeApi();
    authMock.client.mockResolvedValue(api);

    const output = await put([html, "/"]);

    expect(output.page).toBe("509x679pt (injected)");
    expect(output.findings).toBe("clean — every page checked, nothing to report");
  });

  test("a differing @page declaration is honored, not overridden, and the mismatch rides along as a warn finding", async () => {
    const html = await writeHtml(
      "differs.html",
      "<html><head><style>@page { size: 600pt 800pt; margin: 0; }</style></head><body>x</body></html>",
    );
    const { api, calls } = fakeApi();
    authMock.client.mockResolvedValue(api);

    const output = await put([html, "/"]);

    // Same wording render's own honored disposition uses for this exact
    // source and device — see test/commands/render.test.ts.
    expect(output.page).toBe("600x800pt (honored; 91pt wider, 121pt taller)");
    const findings = output.findings as Finding[];
    expect(Array.isArray(findings)).toBe(true);
    const pageBox = findings.find((f) => f.check === "page box");
    expect(pageBox).toMatchObject({ severity: "warn" });
    expect(pageBox?.detail).toContain("600x800pt");
    // Honored, not blocked: page-box findings are warn, never error, so the
    // upload proceeds without --strict.
    expect(calls.putPdf).toBe(1);
  });

  test("--device-page overrides a differing declaration with the device box, and the override is never silent", async () => {
    const html = await writeHtml(
      "override.html",
      "<html><head><style>@page { size: 600pt 800pt; margin: 0; }</style></head><body><h1>flyer</h1></body></html>",
    );
    const { api, calls } = fakeApi();
    authMock.client.mockResolvedValue(api);

    const output = await put([html, "/", "--device-page"]);

    expect(output.page).toBe(
      "509x679pt (overridden; declared 600x800pt, 91pt wider, 121pt taller)",
    );
    // The rendered PDF is now sized to the device box exactly, so the
    // page-box mismatch that "honored" surfaced above no longer exists.
    expect(output.findings).toBe("clean — every page checked, nothing to report");
    expect(calls.putPdf).toBe(1);
  });

  test("put's page-box injection and delta wording are byte-identical to render's for the same source", async () => {
    const html = await writeHtml(
      "compare.html",
      "<html><head><style>@page { size: 600pt 800pt; margin: 0; }</style></head><body>x</body></html>",
    );
    const renderOut = join(dir, "compare-render-out.pdf");
    const renderOutput = await render([
      html,
      "--device",
      "paper-pro",
      "--device-page",
      "--out",
      renderOut,
    ]);

    const { api } = fakeApi();
    authMock.client.mockResolvedValue(api);
    const putOutput = await put([html, "/", "--device-page"]);

    expect(putOutput.page).toBe((renderOutput.rendered as { page: string }).page);
  });

  test("--strict does not fire on a warn-only finding", async () => {
    const html = await writeHtml(
      "strict-warn.html",
      "<html><head><style>@page { size: 600pt 800pt; margin: 0; }</style></head><body>x</body></html>",
    );
    const { api, calls } = fakeApi();
    authMock.client.mockResolvedValue(api);

    const output = await put([html, "/", "--strict"]);

    expect(output.uploaded).toMatchObject({ format: "pdf" });
    expect(calls.putPdf).toBe(1);
  });

  test("--strict is fatal on an error-severity finding, before anything is uploaded", async () => {
    const html = await writeHtml("strict-error.html", "<html><body>x</body></html>");
    const { api, calls } = fakeApi();
    authMock.client.mockResolvedValue(api);

    checkMock.check.mockResolvedValueOnce({
      check: "rendered.pdf, 1 page",
      page_box: "509x679pt — matches RM02A (calibrated)",
      findings: [
        {
          pages: "1",
          severity: "error",
          check: "hairlines",
          detail: "0.1pt rule — below 0.32pt resolvable at 226dpi",
        },
      ],
    });

    await expect(put([html, "/", "--strict"])).rejects.toMatchObject({
      code: "LINT_FAILED",
    });
    expect(calls.putPdf).toBe(0);
  });

  test("without --strict, an error-severity finding still rides along and the upload proceeds", async () => {
    const html = await writeHtml("warn-not-block.html", "<html><body>x</body></html>");
    const { api, calls } = fakeApi();
    authMock.client.mockResolvedValue(api);

    checkMock.check.mockResolvedValueOnce({
      check: "rendered.pdf, 1 page",
      page_box: "509x679pt — matches RM02A (calibrated)",
      findings: [
        {
          pages: "1",
          severity: "error",
          check: "hairlines",
          detail: "0.1pt rule — below 0.32pt resolvable at 226dpi",
        },
      ],
    });

    const output = await put([html, "/"]);
    const findings = output.findings as Finding[];
    expect(findings.some((f) => f.severity === "error")).toBe(true);
    expect(calls.putPdf).toBe(1);
  });

  test("HTML source, no device target set, fails NO_DEVICE naming setup device", async () => {
    configMock.readConfig.mockResolvedValueOnce({});
    const html = await writeHtml("no-device.html", "<html><body>x</body></html>");

    await expect(put([html, "/"])).rejects.toMatchObject({ code: "NO_DEVICE" });
  });

  test("HTML source, Chrome not found, fails MISSING_TOOL naming the install and doctor — the stale 'not implemented' refusal is gone", async () => {
    const html = await writeHtml("missing-chrome.html", "<html><body>x</body></html>");
    process.env.REMARKABLE_AXI_CHROME = "/no/such/chrome-binary-here";
    resetChromeCache();

    try {
      await put([html, "/"]);
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as { code: string; message: string; suggestions: string[] };
      expect(axi.code).toBe("MISSING_TOOL");
      expect(axi.suggestions.join(" ")).toContain("doctor");
      expect(axi.message).not.toContain("not implemented");
      expect(axi.message).not.toContain("UNSUPPORTED_FORMAT");
    }
  });
});
