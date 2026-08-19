/**
 * Carrying ink forward across a `put --replace` — see
 * specs/behaviors/ink-preservation.md#carrying-ink-forward.
 *
 * Strokes live per page, addressed by the page ids in a document's `.content`
 * page list, and they are positioned in page-relative coordinates. So porting
 * ink onto a replacement is a matching problem, not a transformation one:
 * decide which new page each inked old page becomes, and the strokes transfer
 * verbatim.
 *
 * Pages are matched **by index**, which is what makes appending work with no
 * special handling — existing pages keep their ink and appended ones arrive
 * clean.
 *
 * The functions here are pure so the matching rules are testable without a
 * network or a device; `put` owns the API calls that feed them.
 */

import { mkdtemp, writeFile, rm as removeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { findGhostscript } from "./gs.js";
import { rasterizePage } from "./lint/rasterize.js";

/** A page's box in PDF points, rounded — the unit `check` already compares in. */
export interface PageBox {
  width: number;
  height: number;
}

/** What happened to one inked page's strokes. */
export type Disposition = "ported" | "orphaned" | "skipped";

export interface CarryOutcome {
  /** 0-based index of the page in the superseded document. */
  index: number;
  disposition: Disposition;
  /** Present when the strokes did not make it, saying why in one clause. */
  reason?: string;
  /**
   * How much of the page's rendered content survived the replacement, 0..1,
   * measured (never inferred) — see `measureSimilarity`. Absent when it could
   * not be measured; absence is reported, not treated as agreement.
   */
  similarity?: number;
}

export interface CarryPlan {
  outcomes: CarryOutcome[];
  /** Indexes whose strokes should be written onto the replacement. */
  ported: number[];
  /** True when every inked page ported — the only case where the superseded
   * copy is safe to trash. */
  complete: boolean;
}

/** Read each page's box straight from a PDF's own metadata, the same way
 * `check` reads it — no rendering, no external tool. */
export async function pageBoxes(bytes: Uint8Array): Promise<PageBox[] | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const out: PageBox[] = [];
    for (let i = 0; i < doc.getPageCount(); i++) {
      const mb = doc.getPage(i).getMediaBox();
      out.push({ width: Math.round(mb.width), height: Math.round(mb.height) });
    }
    return out;
  } catch {
    // Not a readable PDF (an EPUB replacement, a truncated file, bytes
    // pdf-lib parses far enough to accept and then chokes on). The caller
    // treats an unknown page count as "cannot carry safely" rather than
    // guessing an index mapping — a wrong guess misplaces handwriting.
    return null;
  }
}

function sameBox(a: PageBox | undefined, b: PageBox | undefined): boolean {
  if (!a || !b) return true; // unknown on either side is not evidence of a mismatch
  return a.width === b.width && a.height === b.height;
}

/**
 * Decide, per inked page, whether its strokes can ride onto the replacement.
 *
 * Three outcomes, per the spec's table:
 *   - the replacement has a page at that index, same box → **ported**
 *   - the replacement is shorter than that index → **orphaned**
 *   - the page exists but its box changed → **skipped**
 *
 * A box change is not a transformation we attempt: ink is positioned in
 * page-relative coordinates, so replaying it onto a differently-shaped page
 * silently misplaces someone's handwriting — the exact failure
 * specs/principles.md#measure-the-device-never-ship-a-guessed-constant warns
 * against. Reporting it and keeping the superseded copy is the honest answer.
 */
export function planCarry(
  inkedIndexes: readonly number[],
  newPageCount: number,
  oldBoxes: readonly PageBox[] = [],
  newBoxes: readonly PageBox[] = [],
): CarryPlan {
  const outcomes: CarryOutcome[] = [];
  const ported: number[] = [];

  for (const index of [...inkedIndexes].sort((a, b) => a - b)) {
    if (index >= newPageCount) {
      outcomes.push({
        index,
        disposition: "orphaned",
        reason: `the replacement has only ${newPageCount} page${newPageCount === 1 ? "" : "s"}`,
      });
      continue;
    }
    if (!sameBox(oldBoxes[index], newBoxes[index])) {
      const o = oldBoxes[index]!;
      const n = newBoxes[index]!;
      outcomes.push({
        index,
        disposition: "skipped",
        reason: `page box changed ${o.width}x${o.height} → ${n.width}x${n.height}`,
      });
      continue;
    }
    outcomes.push({ index, disposition: "ported" });
    ported.push(index);
  }

  return {
    outcomes,
    ported,
    complete: outcomes.length > 0 && outcomes.every((o) => o.disposition === "ported"),
  };
}


/**
 * Rasterize the same page from both documents and compare them, so the one
 * assurance page identity cannot give is **measured** rather than assumed —
 * specs/behaviors/ink-preservation.md#measuring-whether-the-content-moved,
 * and the principle it answers to,
 * specs/principles.md#measure-the-device-never-ship-a-guessed-constant.
 *
 * Why this exists at all: matching by index is structurally blind to a page
 * inserted mid-document. Every page after it shifts, every page count and
 * page box still checks out, and every stroke lands on the wrong page. A
 * count cannot see that; a picture can.
 *
 * The metric is a darkness-weighted agreement — summed absolute difference
 * over summed maximum darkness — rather than a plain per-pixel mean. On a
 * page that is mostly white (every page here), a mean would read ~0.97
 * whether the content matched or not, because the shared white background
 * dominates it. Weighting by ink makes a blank-vs-drawn comparison score 0
 * and an identical pair score 1.
 *
 * 36dpi is deliberately coarse: layout displacement is a gross-scale signal,
 * and one Ghostscript pass per ported page is a cost paid on every carry.
 */
export async function measureSimilarity(
  oldPdf: Uint8Array,
  newPdf: Uint8Array,
  indexes: readonly number[],
  dpi = 36,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (indexes.length === 0) return out;

  const gs = await findGhostscript();
  if (!gs) return out; // absence is reported by the caller, not papered over

  const dir = await mkdtemp(join(tmpdir(), "remarkable-axi-carry-"));
  try {
    const oldPath = join(dir, "old.pdf");
    const newPath = join(dir, "new.pdf");
    await writeFile(oldPath, oldPdf);
    await writeFile(newPath, newPdf);

    for (const index of indexes) {
      try {
        const [a, b] = await Promise.all([
          rasterizePage(gs.path, oldPath, index + 1, dpi),
          rasterizePage(gs.path, newPath, index + 1, dpi),
        ]);
        if (a.width !== b.width || a.height !== b.height) continue;
        let diff = 0;
        let mass = 0;
        for (let i = 0; i < a.pixels.length; i++) {
          const da = 255 - a.pixels[i]!;
          const db = 255 - b.pixels[i]!;
          diff += Math.abs(da - db);
          mass += Math.max(da, db);
        }
        // Two blank pages agree completely; there is nothing to disagree about.
        out.set(index, mass === 0 ? 1 : Math.max(0, 1 - diff / mass));
      } catch {
        // One unmeasurable page must not sink the others, per
        // specs/principles.md#best-effort-operations-report-per-item-outcomes.
      }
    }
  } finally {
    await removeFile(dir, { recursive: true, force: true });
  }
  return out;
}

/** Attach measured similarities to a plan's ported outcomes. */
export function withSimilarity(plan: CarryPlan, measured: Map<number, number>): CarryPlan {
  return {
    ...plan,
    outcomes: plan.outcomes.map((o) =>
      measured.has(o.index) ? { ...o, similarity: measured.get(o.index) } : o,
    ),
  };
}

/** Below this, the page's content moved enough that the ink probably no longer
 * annotates what it was drawn on. A warning, never a refusal. */
export const SIMILARITY_WARN = 0.9;

/**
 * Render the per-page outcome table the spec specifies —
 * `ink[N]{page,ported,similarity,note}` — one row per inked page, page
 * numbers 1-based because that is how a human counts pages.
 *
 * Every inked page gets a row whatever happened to it: a carry is a
 * best-effort operation, and those report per-item outcomes rather than a
 * single verdict (specs/principles.md#best-effort-operations-report-per-item-outcomes).
 * An unmeasurable similarity prints `—` and says so in the note, because
 * "not measured" and "measured and fine" must never look alike.
 */
export function carryTable(plan: CarryPlan): Record<string, unknown>[] {
  return plan.outcomes.map((o) => {
    const note =
      o.disposition !== "ported"
        ? (o.reason ?? o.disposition)
        : o.similarity === undefined
          ? "layout not compared"
          : o.similarity < SIMILARITY_WARN
            ? "layout shifted — ink may no longer sit on what it annotated"
            : "layout unchanged";
    return {
      page: o.index + 1,
      ported: o.disposition === "ported" ? "yes" : "no",
      similarity: o.similarity === undefined ? "—" : o.similarity.toFixed(2),
      note,
    };
  });
}

/** Render the plan as the `kept_ink` block `put` reports, page numbers 1-based
 * because that is how a human counts pages. */
export function summarizeCarry(plan: CarryPlan): Record<string, unknown> {
  const by = (d: Disposition) =>
    plan.outcomes.filter((o) => o.disposition === d).map((o) => o.index + 1);
  const ported = by("ported");
  const orphaned = plan.outcomes.filter((o) => o.disposition === "orphaned");
  const skipped = plan.outcomes.filter((o) => o.disposition === "skipped");

  const shifted = plan.outcomes.filter(
    (o) => o.disposition === "ported" && o.similarity !== undefined && o.similarity < SIMILARITY_WARN,
  );

  return {
    ported: ported.length,
    ...(ported.length > 0 ? { pages: ported.join(",") } : {}),
    ...(shifted.length > 0
      ? {
          layout_shifted: shifted.map(
            (o) => `page ${o.index + 1} — similarity ${o.similarity!.toFixed(2)}; ink may no longer sit on what it annotated`,
          ),
        }
      : {}),
    ...(orphaned.length > 0
      ? { orphaned: orphaned.map((o) => `page ${o.index + 1} — ${o.reason}`) }
      : {}),
    ...(skipped.length > 0
      ? { skipped: skipped.map((o) => `page ${o.index + 1} — ${o.reason}`) }
      : {}),
  };
}
