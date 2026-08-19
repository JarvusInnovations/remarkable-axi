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

import { PDFDocument } from "pdf-lib";

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

/** Render the plan as the `kept_ink` block `put` reports, page numbers 1-based
 * because that is how a human counts pages. */
export function summarizeCarry(plan: CarryPlan): Record<string, unknown> {
  const by = (d: Disposition) =>
    plan.outcomes.filter((o) => o.disposition === d).map((o) => o.index + 1);
  const ported = by("ported");
  const orphaned = plan.outcomes.filter((o) => o.disposition === "orphaned");
  const skipped = plan.outcomes.filter((o) => o.disposition === "skipped");

  return {
    ported: ported.length,
    ...(ported.length > 0 ? { pages: ported.join(",") } : {}),
    ...(orphaned.length > 0
      ? { orphaned: orphaned.map((o) => `page ${o.index + 1} — ${o.reason}`) }
      : {}),
    ...(skipped.length > 0
      ? { skipped: skipped.map((o) => `page ${o.index + 1} — ${o.reason}`) }
      : {}),
  };
}
