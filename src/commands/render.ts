import { readFile, rm as removeFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";
import { collapseHome } from "../output.js";
import { bool, parseFlags, requirePositional, str } from "../flags.js";
import { readConfig } from "../config.js";
import { pageBox, pageBoxCaveat, resolveTarget, type PageBox } from "../devices.js";
import {
  describeDelta,
  detectPageBox,
  injectPageBox,
  parseDeclaredPageBox,
} from "../page.js";
import { findChrome, printToPdf } from "../chrome.js";
import { pdfPageCount } from "../render.js";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

function fmtBox(box: PageBox): string {
  return `${box.width}x${box.height}pt`;
}

/**
 * Headless Chrome print-to-PDF at the target device's page box.
 *
 * `@page` detection and injection is exactly `page-geometry`'s shared unit —
 * see `src/page.ts` — so this and `check` can never disagree about what a
 * declared page size means against the device box.
 */
export async function render(args: string[]): Promise<Output> {
  const parsed = parseFlags("render", args, {
    value: ["--out", "--device"],
    boolean: ["--landscape", "--device-page"],
  });

  const file = requirePositional(
    parsed,
    0,
    "an HTML file",
    "Run `remarkable-axi render <html> [--out <path>]`",
  );

  const ext = extname(file).toLowerCase();
  if (!HTML_EXTENSIONS.has(ext)) {
    throw new AxiError(`not an HTML file: ${file}`, "USAGE", [
      "render converts HTML to PDF; pass a .html or .htm source",
    ]);
  }

  let html: string;
  try {
    html = await readFile(file, "utf8");
  } catch {
    throw new AxiError(`no such file: ${file}`, "NOT_FOUND", [
      "Check the path and try again",
    ]);
  }

  const explicit = str(parsed, "--device", "") || undefined;
  // Only touch the config file when nothing was declared explicitly, so
  // `--device` genuinely never reads or writes stored config — same rule
  // `page` follows.
  const configured = explicit ? undefined : (await readConfig()).targetDevice;
  const model = resolveTarget(explicit, configured);

  const box = pageBox(model, { landscape: bool(parsed, "--landscape") });
  const caveat = pageBoxCaveat(model);
  const overrideFlag = bool(parsed, "--device-page");

  const declared = parseDeclaredPageBox(html);
  const detection = detectPageBox(declared, box);

  let effectiveHtml = html;
  let pageState: string;

  if (detection.status === "absent") {
    effectiveHtml = injectPageBox(html, box);
    pageState = `${fmtBox(box)} (injected)`;
  } else if (detection.status === "matches") {
    pageState = `${fmtBox(box)} (matches)`;
  } else if (overrideFlag) {
    // `--device-page` explicitly asks for the device box in place of a
    // differing declaration — the one case an explicit declaration is
    // overridden rather than honored.
    effectiveHtml = injectPageBox(html, box);
    pageState = `${fmtBox(box)} (overridden; declared ${fmtBox(detection.declared)}, ${describeDelta(detection.delta)})`;
  } else {
    // Honor the declaration: the surrounding layout was written against it,
    // so substituting the device box would invalidate every dimension built
    // on it. See specs/principles.md#report-the-mismatch-do-not-silently-correct-the-author.
    pageState = `${fmtBox(detection.declared)} (honored; ${describeDelta(detection.delta)})`;
  }

  const chrome = await findChrome();
  if (!chrome) {
    throw new AxiError("chrome not found", "MISSING_TOOL", [
      "Install Google Chrome or Chromium — https://www.google.com/chrome/",
      "Run `remarkable-axi doctor` to confirm it is discovered",
    ]);
  }

  const base = basename(file, extname(file)) || "document";
  const target = str(parsed, "--out", "");
  // The default lands beside the source rather than in the CWD (the spec's
  // "./<name>.pdf beside the source") — a source in a different directory
  // than the invocation must not scatter its output somewhere unrelated.
  // An explicit --out is a literal path, resolved the ordinary way.
  const out = target
    ? resolve(target)
    : join(dirname(resolve(file)), `${base}.pdf`);

  // A modified copy is only written when the document actually changed
  // (injected or overridden); the matched and honored paths print the
  // author's file exactly as it stands, with no intermediate copy. The copy
  // lands beside the source, not in a system temp dir, so the document's own
  // relative asset references (images, stylesheets) keep resolving.
  const needsCopy = effectiveHtml !== html;
  const tempPath = needsCopy
    ? join(dirname(resolve(file)), `.${base}.render-${randomUUID()}.html`)
    : null;

  try {
    if (tempPath) await writeFile(tempPath, effectiveHtml, "utf8");
    await printToPdf(chrome.path, tempPath ?? resolve(file), out);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AxiError(`render failed: ${message}`, "RENDER_FAILED", [
      "Run `remarkable-axi doctor` to confirm Chrome is discovered and working",
    ]);
  } finally {
    if (tempPath) await removeFile(tempPath, { force: true }).catch(() => {});
  }

  const bytes = await readFile(out);
  const pages = await pdfPageCount(new Uint8Array(bytes));

  return {
    rendered: {
      out: collapseHome(out),
      device: caveat ? `${model} — ${caveat}` : model,
      page: pageState,
      pages,
    },
    help: [
      `Run \`remarkable-axi check ${collapseHome(out)}\` to lint it for the panel`,
    ],
  };
}
