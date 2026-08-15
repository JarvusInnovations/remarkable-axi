import { mkdtemp, mkdir, readFile, rm as removeFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import { PDFDocument } from "pdf-lib";
import type { Output } from "../output.js";
import { collapseHome } from "../output.js";
import { bool, parseFlags, requirePositional, str } from "../flags.js";
import { readConfig } from "../config.js";
import {
  dpi as deviceDpi,
  pageBox,
  pageBoxCaveat,
  resolveTarget,
  screenSize,
  type PageBox,
} from "../devices.js";
import { describeDelta, detectPageBox, parseDeclaredPageBox } from "../page.js";
import { findGhostscript } from "../gs.js";
import { rasterizePage } from "../lint/rasterize.js";
import { encodeGrayscalePng } from "../lint/png.js";
import {
  checkContrast,
  checkHairlines,
  checkTypeSize,
  type Finding,
} from "../lint/rules.js";
import { bleedFinding, noPageDeclarationFinding, pageBoxFinding } from "../lint/geometry.js";
import { render } from "./render.js";
import { parsePageSelection } from "./get.js";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

function fmtBox(box: PageBox): string {
  return `${box.width}x${box.height}pt`;
}

const CHECK_NAME_ORDER: Record<Finding["check"], number> = {
  "page box": 0,
  bleed: 1,
  hairlines: 2,
  contrast: 3,
  "type size": 4,
};

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => a.page - b.page || CHECK_NAME_ORDER[a.check] - CHECK_NAME_ORDER[b.check]);
}

/** Compact page numbers into a readable list: [1,2,3,5,9,10] -> "1-3,5,9-10". */
function pageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (const page of sorted.slice(1)) {
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = page;
    prev = page;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(",");
}

interface CollapsedFinding {
  pages: string;
  severity: Finding["severity"];
  check: Finding["check"];
  detail: string;
}

/**
 * Collapse findings that say the same thing on more than one page.
 *
 * A page box belongs to the document and a template rule repeats on every
 * page that uses the template, so reporting each per page multiplies one
 * fact by the page count: a real ten-page deck produced twenty-one findings
 * describing three problems, the page-box mismatch ten times over. That is
 * the noise this linter's thresholds were tuned to avoid, arriving through
 * a different door — a finding an agent has already read nine times is one
 * it learns to skip.
 *
 * Identical (check, severity, detail) triples merge into one row carrying
 * the pages they were seen on, so the evidence is preserved and the count
 * reflects distinct problems rather than page count.
 */
function collapseFindings(findings: Finding[]): CollapsedFinding[] {
  const groups = new Map<string, { finding: Finding; pages: number[] }>();
  for (const finding of sortFindings(findings)) {
    const key = `${finding.check}\u0000${finding.severity}\u0000${finding.detail}`;
    const group = groups.get(key);
    if (group) group.pages.push(finding.page);
    else groups.set(key, { finding, pages: [finding.page] });
  }
  return [...groups.values()].map(({ finding, pages }) => ({
    pages: pageRanges(pages),
    severity: finding.severity,
    check: finding.check,
    detail: finding.detail,
  }));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rasterize a document at the target device's native resolution and lint it
 * against the panel — see `specs/commands/check.md`.
 *
 * An HTML source is rendered first through the exact `render` path (device
 * page-box injection/honoring included), then linted exactly as a PDF
 * source would be — `render` produces, `check` inspects, and they can never
 * disagree about the page box because both call `detectPageBox`
 * (`src/page.ts`) on the same declared-vs-device comparison.
 */
export async function check(args: string[]): Promise<Output> {
  const parsed = parseFlags("check", args, {
    value: ["--pages", "--device", "--out"],
    boolean: ["--no-images"],
  });

  const file = requirePositional(
    parsed,
    0,
    "a PDF or HTML file",
    "Run `remarkable-axi check <file> [--pages <spec>]`",
  );

  const ext = extname(file).toLowerCase();
  const isHtml = HTML_EXTENSIONS.has(ext);
  const isPdf = ext === ".pdf";
  if (!isHtml && !isPdf) {
    throw new AxiError(`not a PDF or HTML file: ${file}`, "USAGE", [
      "check accepts a .pdf, or a .html/.htm source to render first",
    ]);
  }

  if (!(await exists(file))) {
    throw new AxiError(`no such file: ${file}`, "NOT_FOUND", [
      "Check the path and try again",
    ]);
  }

  const explicit = str(parsed, "--device", "") || undefined;
  // Only touch the config file when nothing was declared explicitly — same
  // rule `page` and `render` follow.
  const configured = explicit ? undefined : (await readConfig()).targetDevice;
  const model = resolveTarget(explicit, configured);

  const box = pageBox(model);
  const dpi = deviceDpi(model);
  const caveat = pageBoxCaveat(model);

  const gs = await findGhostscript();
  if (!gs) {
    throw new AxiError("ghostscript not found", "MISSING_TOOL", [
      "Install Ghostscript — https://www.ghostscript.com/",
      "Run `remarkable-axi doctor` to confirm it is discovered",
    ]);
  }

  const findings: Finding[] = [];
  let pdfPath: string;
  let cleanup: (() => Promise<void>) | null = null;

  if (isHtml) {
    // The pre-render declaration is checked against the *source*, before
    // `render` injects a device box for anything left undeclared — a source
    // with no `@page` at all would otherwise round-trip to "matches" and
    // the "no @page, would default to Letter" case in
    // specs/behaviors/page-geometry.md#detection-and-injection would never
    // surface at all.
    const html = await readFile(file, "utf8");
    const declaredDetection = detectPageBox(parseDeclaredPageBox(html), box);
    if (declaredDetection.status === "absent") {
      findings.push(noPageDeclarationFinding(1));
    }

    const dir = await mkdtemp(join(tmpdir(), "remarkable-axi-check-"));
    const tempPdf = join(dir, "rendered.pdf");
    await render([file, "--device", model, "--out", tempPdf]);
    pdfPath = tempPdf;
    cleanup = () => removeFile(dir, { recursive: true, force: true }).then(() => {});
  } else {
    pdfPath = resolve(file);
  }

  try {
    const bytes = await readFile(pdfPath);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const totalPages = doc.getPageCount();

    // Page box and bleed are read from the PDF's own metadata — cheap, and
    // exact regardless of source (a raw PDF's own MediaBox stands in for
    // the `@page` declaration a rendered HTML source would carry).
    for (let i = 0; i < totalPages; i++) {
      const p = doc.getPage(i);
      const mb = p.getMediaBox();
      const declared: PageBox = { width: Math.round(mb.width), height: Math.round(mb.height) };
      const pb = pageBoxFinding(i + 1, declared, box);
      if (pb) findings.push(pb);

      const cb = p.getCropBox();
      const bleed = bleedFinding(
        i + 1,
        { width: mb.width, height: mb.height },
        { width: cb.width, height: cb.height },
      );
      if (bleed) findings.push(bleed);
    }

    const pagesFlag = str(parsed, "--pages", "");
    const selected = pagesFlag ? parsePageSelection(pagesFlag, totalPages) : totalPages > 0 ? [...Array(totalPages).keys()] : [];
    if (pagesFlag && selected.length === 0) {
      throw new AxiError(`no pages selected from ${totalPages} available`, "USAGE", [
        `Pages are numbered 1-${totalPages}`,
      ]);
    }
    const selectedSet = new Set(selected);

    const noImages = bool(parsed, "--no-images");
    let outDir: string | null = null;
    if (!noImages) {
      const outFlag = str(parsed, "--out", "");
      if (outFlag) {
        outDir = resolve(outFlag);
        await mkdir(outDir, { recursive: true });
      } else {
        // Not cleaned up on the way out — these images are the deliverable
        // the caller is expected to go look at, same as `render`'s output
        // PDF is never a throwaway file.
        outDir = await mkdtemp(join(tmpdir(), "remarkable-axi-check-images-"));
      }
    }

    const base = basename(file, extname(file)) || "document";
    const images: { page: number; path: string }[] = [];

    // Every page is rasterized regardless of `--pages` — findings must
    // cover the whole document (specs/commands/check.md); `--pages` only
    // decides which of those rasters also get written out as an image.
    for (let i = 0; i < totalPages; i++) {
      const pageNum = i + 1;
      const raster = await rasterizePage(gs.path, pdfPath, pageNum, dpi);

      const hairline = checkHairlines(raster, pageNum, dpi, {
        gsVersion: gs.version,
      });
      if (hairline) findings.push(hairline);
      const contrast = checkContrast(raster, pageNum);
      if (contrast) findings.push(contrast);
      const typeSize = checkTypeSize(raster, pageNum, dpi);
      if (typeSize) findings.push(typeSize);

      if (outDir && selectedSet.has(i)) {
        const png = encodeGrayscalePng(raster.width, raster.height, raster.pixels);
        const path = join(outDir, `${base}-p${pageNum}.png`);
        await writeFile(path, png);
        images.push({ page: pageNum, path: collapseHome(path) });
      }
    }

    const screen = screenSize(model);
    const collapsed = collapseFindings(findings);
    const page1Box = totalPages > 0 ? doc.getPage(0).getMediaBox() : box;

    const output: Output = {
      check: `${collapseHome(file)}, ${totalPages} page${totalPages === 1 ? "" : "s"}, rasterized at ${dpi}dpi (${screen})`,
      page_box: pageBoxSummary(model, box, page1Box, caveat),
      findings:
        collapsed.length > 0
          ? collapsed
          : "clean — every page checked, nothing to report",
    };

    if (!noImages) {
      output.images = images.length > 0 ? images : "no pages selected for imaging";
    }

    const help: string[] = [];
    if (isHtml) {
      help.push(
        `Run \`remarkable-axi check ${collapseHome(file)}${pagesFlag ? ` --pages ${pagesFlag}` : ""}\` after editing to re-check`,
      );
    } else if (!noImages && images.length > 0) {
      help.push("Open the page images above to see exactly what each finding is pointing at");
    }
    if (help.length > 0) output.help = help;

    return output;
  } finally {
    if (cleanup) await cleanup();
  }
}

function pageBoxSummary(
  model: string,
  box: PageBox,
  mediaBox: { width: number; height: number },
  caveat: string | null,
): string {
  const declared: PageBox = { width: Math.round(mediaBox.width), height: Math.round(mediaBox.height) };
  const detection = detectPageBox(declared, box);
  const calLabel = caveat ?? "calibrated";

  if (detection.status !== "differs") {
    return `${fmtBox(declared)} — matches ${model} (${calLabel})`;
  }
  return `${fmtBox(declared)} — ${describeDelta(detection.delta)} than ${model}'s ${fmtBox(box)} box (${calLabel})`;
}
