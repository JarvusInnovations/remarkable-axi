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
  /**
   * Why a ported page has no `similarity` — an absent renderer, an unfetchable
   * superseded PDF, a page that would not render. "Layout not compared" is not
   * actionable on its own, so the absence carries its cause.
   */
  unverifiedReason?: string;
}

export interface CarryPlan {
  outcomes: CarryOutcome[];
  /** Indexes whose strokes should be written onto the replacement. */
  ported: number[];
  /** True when every inked page ported. Necessary but not sufficient for
   * trashing the superseded copy — see `safeToTrash`. */
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
 * Four outcomes, per the spec's table, evaluated in this order:
 *   - the index is past the end of the **superseded** document → **skipped**
 *   - the replacement has a page at that index, same box → **ported**
 *   - the replacement is shorter than that index → **orphaned**
 *   - the page exists but its box changed → **skipped**
 *
 * The source bound comes first because no replacement can make an index the
 * superseded document never had into a meaningful mapping, and it is taken
 * from `oldBoxes` — page boxes parsed out of the superseded PDF, the document
 * itself — rather than from the `.content` page list an index is recovered
 * from. That list has been observed running longer than the document it
 * describes, putting ink on "page 3" of a two-page PDF
 * (https://github.com/JarvusInnovations/remarkable-axi/issues/55); a bound
 * derived from the suspect input could not have caught it.
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

  // Empty means "could not be read", not "zero pages" — the caller passes the
  // parsed boxes or nothing at all.
  const oldPageCount = oldBoxes.length > 0 ? oldBoxes.length : null;

  for (const index of [...inkedIndexes].sort((a, b) => a - b)) {
    if (oldPageCount !== null && index >= oldPageCount) {
      // Not "orphaned": the strokes are real and the superseded copy keeps
      // them. The likeliest benign cause is a page added on the device to a
      // PDF that never had one — genuine ink with no counterpart in the
      // source, and no page of the replacement it can be assumed to match.
      outcomes.push({
        index,
        disposition: "skipped",
        reason: `the superseded document has only ${oldPageCount} page${oldPageCount === 1 ? "" : "s"}, so page ${index + 1} has no source to match`,
      });
      continue;
    }
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
 * Darkness-weighted agreement between two equally-sized grayscale rasters,
 * 0 (nothing in common) .. 1 (identical).
 *
 * Weighting by ink rather than averaging per pixel is the whole point: these
 * are document pages, overwhelmingly white, and a plain per-pixel mean scores
 * ~0.97 whether the content matches or not because the shared background
 * dominates the average. Dividing the disagreement by the *combined darkness*
 * instead makes the score answer "how much of the ink on these two pages is
 * in the same place", which is the question being asked.
 *
 * Pure, so the metric is exercised everywhere — including where Ghostscript
 * is absent and `measureSimilarity` cannot run at all.
 */
export function compareDarkness(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let diff = 0;
  let mass = 0;
  for (let i = 0; i < a.length; i++) {
    const da = 255 - a[i]!;
    const db = 255 - b[i]!;
    diff += Math.abs(da - db);
    mass += Math.max(da, db);
  }
  // Two blank pages agree completely; there is nothing to disagree about.
  return mass === 0 ? 1 : Math.max(0, 1 - diff / mass);
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
        out.set(index, compareDarkness(a.pixels, b.pixels));
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

/**
 * Attach measured similarities to a plan's ported outcomes, and stamp the ones
 * that could not be measured with why.
 *
 * The reason is what makes an absent similarity actionable: "layout not
 * compared" leaves the reader guessing whether a renderer is missing, the
 * superseded PDF could not be fetched, or that one page would not render.
 */
export function withSimilarity(
  plan: CarryPlan,
  measured: Map<number, number>,
  unverifiedReason?: string,
): CarryPlan {
  return {
    ...plan,
    outcomes: plan.outcomes.map((o) => {
      if (measured.has(o.index)) return { ...o, similarity: measured.get(o.index) };
      if (unverifiedReason && o.disposition === "ported") {
        return { ...o, unverifiedReason };
      }
      return o;
    }),
  };
}

/**
 * Ported pages whose placement was never actually compared.
 *
 * These are ports the tool cannot corroborate: it wrote the strokes, and it
 * has no evidence they landed on what they were drawn on. Absence of a
 * measurement is not a passing measurement —
 * specs/behaviors/ink-preservation.md#not-measured-must-never-look-like-measured-and-fine.
 */
export function unverifiedPorts(plan: CarryPlan): CarryOutcome[] {
  return plan.outcomes.filter(
    (o) => o.disposition === "ported" && o.similarity === undefined,
  );
}

/**
 * The safety invariant: **the superseded copy is trashed only on a complete,
 * corroborated carry.**
 *
 * Two independent conditions, and both have to hold. Complete means every
 * inked page ported. Corroborated means every ported page's placement was
 * measured — a carry that skipped the measurement is exactly the case the
 * measurement was introduced to catch, so it does not get to authorize the
 * one destructive step in the operation.
 *
 * Note what this does *not* gate: writing the strokes. That half destroys
 * nothing, and withholding it would lose ink over a limitation of the tool
 * rather than a property of the document.
 */
export function safeToTrash(plan: CarryPlan): boolean {
  return plan.complete && unverifiedPorts(plan).length === 0;
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

/**
 * Render the plan as the `kept_ink` block `put` reports, page numbers 1-based
 * because that is how a human counts pages.
 *
 * `unverified` is the half of "not measured is not measured-and-fine" the
 * table alone could not carry: a cell reading `—` is easy to slide past, and
 * it has no room for *why* the comparison failed. Listing the page and its
 * cause next to `ported` puts it where the reader is already looking, beside
 * `orphaned` and `skipped`.
 */
export function summarizeCarry(plan: CarryPlan): Record<string, unknown> {
  const by = (d: Disposition) =>
    plan.outcomes.filter((o) => o.disposition === d).map((o) => o.index + 1);
  const ported = by("ported");
  const orphaned = plan.outcomes.filter((o) => o.disposition === "orphaned");
  const skipped = plan.outcomes.filter((o) => o.disposition === "skipped");

  const shifted = plan.outcomes.filter(
    (o) => o.disposition === "ported" && o.similarity !== undefined && o.similarity < SIMILARITY_WARN,
  );
  const unverified = unverifiedPorts(plan);

  return {
    ported: ported.length,
    ...(ported.length > 0 ? { pages: ported.join(",") } : {}),
    ...(unverified.length > 0
      ? {
          unverified: unverified.map(
            (o) =>
              `page ${o.index + 1} — layout not compared${o.unverifiedReason ? `: ${o.unverifiedReason}` : ""}; the superseded copy was kept so the placement can be checked`,
          ),
        }
      : {}),
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
