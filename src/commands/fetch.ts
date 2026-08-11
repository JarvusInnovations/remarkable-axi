import { writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";
import { collapseHome } from "../output.js";
import { client } from "../auth.js";
import { bool, parseFlags, requirePositional, str } from "../flags.js";
import { buildTree, lookup, normalizePath } from "../paths.js";
import { listEntries } from "../entries.js";
import { optimizeForReading, pageGeometry, type PageGeometry } from "../strokes.js";
import { pagesToPdf, pageToSvg, overlayOnPdf, type Fit } from "../render.js";
import { readConfig } from "../config.js";
import { spec } from "../devices.js";
import { documentName } from "../article.js";

const FORMATS = new Set(["pdf", "svg", "text"]);

/**
 * Infer the sheet's DPI so PDF pages come out at physical size.
 *
 * The sheet's pixel dimensions identify the panel, which is more reliable than
 * a configured target device — the notes could have been written on a different
 * tablet than the one being designed for.
 */
function dpiFor(paperSize: [number, number] | null, fallback: number): number {
  if (!paperSize) return fallback;
  const [w, h] = paperSize;
  if (w === 1620 && h === 2160) return 229; // Paper Pro
  if (w === 954 && h === 1696) return 264; // Paper Pro Move
  if (w === 1404 && h === 1872) return 226; // rM1 / rM2 / Paper Pure
  return fallback;
}

/** Parse `1-3,5` into zero-based indices, preserving order and deduping. */
export function parsePageSelection(input: string, total: number): number[] {
  const wanted: number[] = [];
  const seen = new Set<number>();

  for (const part of input.split(",")) {
    const chunk = part.trim();
    if (chunk.length === 0) continue;

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(chunk);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to < from) {
        throw new AxiError(`invalid page range: ${chunk}`, "USAGE", [
          "Ranges count from 1 and must ascend, e.g. `--pages 2-5`",
        ]);
      }
      for (let n = from; n <= to; n++) {
        if (n <= total && !seen.has(n - 1)) {
          seen.add(n - 1);
          wanted.push(n - 1);
        }
      }
      continue;
    }

    const single = /^\d+$/.exec(chunk);
    if (!single) {
      throw new AxiError(`invalid page selection: ${chunk}`, "USAGE", [
        "Use page numbers and ranges, e.g. `--pages 1,3,7-9`",
      ]);
    }
    const n = Number(chunk);
    if (n >= 1 && n <= total && !seen.has(n - 1)) {
      seen.add(n - 1);
      wanted.push(n - 1);
    }
  }

  return wanted;
}

function summarize(pages: PageGeometry[]) {
  let strokes = 0;
  let deleted = 0;
  const unmapped = new Set<number>();
  const text: string[] = [];
  for (const p of pages) {
    strokes += p.strokes.length;
    deleted += p.deleted;
    for (const c of p.unmappedColors) unmapped.add(c);
    text.push(...p.text);
  }
  return { strokes, deleted, unmapped: [...unmapped].sort((a, b) => a - b), text };
}

export async function fetch(args: string[]): Promise<Output> {
  const parsed = parseFlags("fetch", args, {
    value: ["--as", "--pages", "--fit", "--out"],
    boolean: ["--overlay", "--legible"],
  });

  const path = normalizePath(
    requirePositional(
      parsed,
      0,
      "a document path",
      "Run `remarkable-axi fetch <path> [--as pdf|svg|text]`",
    ),
  );

  const format = str(parsed, "--as", "pdf").toLowerCase();
  if (!FORMATS.has(format)) {
    throw new AxiError(`unsupported format: ${format}`, "USAGE", [
      "Valid formats are `pdf`, `svg`, and `text`",
    ]);
  }

  // Cropping to the ink spends the available pixels on the writing rather than
  // on margin, which matters as much as stroke weight when a model reads it.
  const legible = bool(parsed, "--legible");
  const fitRaw = str(parsed, "--fit", legible ? "content" : "page").toLowerCase();
  if (fitRaw !== "content" && fitRaw !== "page") {
    throw new AxiError(`invalid --fit: ${fitRaw}`, "USAGE", [
      "Use `--fit page` for the whole sheet or `--fit content` to crop to the ink",
    ]);
  }
  const fit = fitRaw as Fit;

  const api = await client();
  const tree = buildTree((await listEntries(api)).entries);
  const node = lookup(tree, path);
  if (!node) {
    throw new AxiError(`no such document: ${path}`, "NOT_FOUND", [
      `Run \`remarkable-axi find "${path.split("/").pop()}"\` to locate it`,
    ]);
  }
  if (node.entry.type !== "DocumentType") {
    throw new AxiError(`not a document: ${path}`, "USAGE", [
      "fetch reads documents; run `remarkable-axi ls <path>` to list a folder",
    ]);
  }

  const ref = { id: node.entry.id, hash: node.entry.hash };
  const fileType = node.entry.fileType;

  let rmPages;
  try {
    rmPages = await api.getRmPages(ref);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AxiError(
      `could not read pages for ${path}: ${message}`,
      "FETCH_FAILED",
      ["Confirm the tablet has synced this document to the cloud"],
    );
  }

  const ordered = [...rmPages.values()];
  const allGeo = ordered.map((page) => pageGeometry(page));
  const selection = str(parsed, "--pages", "");
  const indices = selection
    ? parsePageSelection(selection, allGeo.length)
    : allGeo.map((_, i) => i);

  if (indices.length === 0) {
    throw new AxiError(
      `no pages selected from ${allGeo.length} available`,
      "USAGE",
      [`Pages are numbered 1-${allGeo.length}`],
    );
  }

  const chosen = indices
    .map((i) => allGeo[i]!)
    .map((g) => (legible ? optimizeForReading(g) : g));
  const stats = summarize(chosen);
  const base = documentName(node.entry.visibleName) || "document";
  const target = str(parsed, "--out", "");

  // Text needs no ink, so handle it before the empty-ink guard below.
  if (format === "text") {
    if (stats.text.length === 0) {
      return {
        text: `no typed text on ${indices.length} of ${allGeo.length} pages`,
        note: "handwriting is ink, not text — render with `--as pdf` and read the image",
        help: [
          `Run \`remarkable-axi fetch "${path}" --as pdf\` to render the handwriting`,
        ],
      };
    }
    const out = resolve(target || `./${base}.txt`);
    await writeFile(out, `${stats.text.join("\n")}\n`);
    return {
      wrote: collapseHome(out),
      source: path,
      pages: `${indices.length} of ${allGeo.length}`,
      lines: stats.text.length,
      preview: stats.text.slice(0, 5).join(" / ").slice(0, 300),
    };
  }

  if (stats.strokes === 0) {
    return {
      ink: `no ink on ${indices.length} of ${allGeo.length} pages`,
      ...(stats.text.length > 0
        ? { text: `${stats.text.length} lines of typed text present` }
        : {}),
      help: [
        stats.text.length > 0
          ? `Run \`remarkable-axi fetch "${path}" --as text\` to extract the typed text`
          : "Nothing to render on the selected pages",
      ],
    };
  }

  const configured = (await readConfig()).targetDevice;
  const fallbackDpi = configured ? spec(configured).dpi : 226;

  let bytes: Uint8Array;
  let ext: string;
  let overlaid = false;
  let outsidePages = 0;

  if (format === "svg") {
    if (chosen.length > 1 && !target) {
      // One SVG holds one page; writing several would silently keep only the last.
      throw new AxiError(
        `svg renders one page at a time (${chosen.length} selected)`,
        "USAGE",
        [
          `Run \`remarkable-axi fetch "${path}" --as svg --pages 1\``,
          `Run \`remarkable-axi fetch "${path}" --as pdf\` for all pages in one file`,
        ],
      );
    }
    bytes = new TextEncoder().encode(pageToSvg(chosen[0]!, fit));
    ext = "svg";
  } else if (fileType === "pdf" && bool(parsed, "--overlay")) {
    // Opt-in only. Drawing ink back onto the original document needs the
    // device's PDF layout transform, and that is not in the synced data: the
    // scene blocks carry only paperSize, and ink coordinates run past the sheet
    // box, so placement is approximate and can land off-page. Ink-only output
    // is exact, so that stays the default.
    let basePdf: Uint8Array | null = null;
    try {
      basePdf = new Uint8Array(await api.getPdf(ref));
    } catch {
      basePdf = null;
    }

    if (basePdf) {
      const inkByIndex = new Map<number, PageGeometry>();
      indices.forEach((pageIndex) => {
        const geo = allGeo[pageIndex];
        if (geo && geo.strokes.length > 0) inkByIndex.set(pageIndex, geo);
      });
      const result = await overlayOnPdf(basePdf, inkByIndex);
      bytes = result.bytes;
      outsidePages = result.outside;
      overlaid = true;
    } else {
      bytes = await pagesToPdf(chosen, {
        fit,
        dpi: dpiFor(chosen[0]?.paperSize ?? null, fallbackDpi),
      });
    }
    ext = "pdf";
  } else {
    bytes = await pagesToPdf(chosen, {
      fit,
      dpi: dpiFor(chosen[0]?.paperSize ?? null, fallbackDpi),
    });
    ext = "pdf";
  }

  const out = resolve(
    target || `./${base}.${ext}`,
  );
  await writeFile(out, bytes);

  const size =
    bytes.byteLength < 1024
      ? `${bytes.byteLength}B`
      : bytes.byteLength < 1024 * 1024
        ? `${Math.round(bytes.byteLength / 1024)}KB`
        : `${(bytes.byteLength / (1024 * 1024)).toFixed(1)}MB`;

  return {
    wrote: collapseHome(out),
    source: path,
    format: overlaid ? "pdf (ink over original)" : ext,
    pages: `${indices.length} of ${allGeo.length}`,
    strokes: stats.strokes,
    size,
    ...(ext === "svg" || overlaid ? {} : { fit }),
    ...(legible ? { rendering: "legible (stroke weight rebalanced, not faithful)" } : {}),
    ...(stats.deleted > 0 ? { erasedSkipped: stats.deleted } : {}),
    ...(stats.text.length > 0 ? { typedTextLines: stats.text.length } : {}),
    // Reported rather than silently rendered black: a wrong colour on a
    // colour-coded diagram is worse than an obviously neutral one.
    ...(stats.unmapped.length > 0
      ? { unmappedColorIndices: stats.unmapped.join(",") }
      : {}),
    help: [
      `Read ${collapseHome(out)} to see the handwriting`,
      ...(overlaid
        ? outsidePages > 0
          ? [
              `${outsidePages} page(s) have ink drawn outside the page box; it is kept, not clipped`,
            ]
          : []
        : fileType === "pdf"
          ? [
              "Ink only, positioned exactly; pass --overlay to draw it over the original document",
            ]
          : []),
      ...(stats.unmapped.length > 0
        ? [
            `Palette indices ${stats.unmapped.join(",")} have no known colour and drew black`,
          ]
        : []),
      ...(stats.text.length > 0
        ? [`Run \`remarkable-axi fetch "${path}" --as text\` for the typed text`]
        : []),
    ],
  };
}
