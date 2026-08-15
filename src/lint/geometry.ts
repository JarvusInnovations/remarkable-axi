import type { PageBox } from "../devices.js";
import { describeDelta, detectPageBox } from "../page.js";
import type { Finding } from "./rules.js";

/**
 * A page's own size vs the device box, using the exact shared primitives
 * `render` uses (`detectPageBox`/`describeDelta` — `src/page.ts`) so `check`
 * and `render` can never disagree about what a declared size means against
 * the device box, per `specs/behaviors/page-geometry.md#shared-rule-two-dispositions`.
 *
 * Returns `null` when the page matches — a clean page contributes no
 * finding at all, not a "matches" row.
 */
export function pageBoxFinding(page: number, declared: PageBox, device: PageBox): Finding | null {
  const detection = detectPageBox(declared, device);
  if (detection.status !== "differs") return null;
  return {
    page,
    severity: "warn",
    check: "page box",
    detail: `${declared.width}x${declared.height}pt — ${describeDelta(detection.delta)} than the device box (${device.width}x${device.height}pt)`,
  };
}

/**
 * The one row of `specs/behaviors/page-geometry.md`'s detection table that
 * doesn't survive into the rendered PDF: an HTML source with no `@page` at
 * all renders fine (`render`/`check`'s own render step injects the device
 * box), but a reader of the *source* would get an undeclared, PDF-default
 * Letter page from any tool that isn't this one. Surfaced once, against the
 * original source, before rendering — not against the already-corrected
 * output.
 */
export function noPageDeclarationFinding(page: number): Finding {
  return {
    page,
    severity: "warn",
    check: "page box",
    detail: "no @page declared in the source — would default to US Letter without this tool's injection",
  };
}

/**
 * Content falling outside the page box: a page whose CropBox (the region a
 * viewer actually shows) is smaller than its MediaBox (the full canvas) has
 * content in the gap that some viewers clip and others don't — the panel,
 * which has no print trim step, shows the full MediaBox. Common in
 * professionally produced print PDFs that carry an explicit bleed margin;
 * absent on everything this tool itself renders, since `render` never sets
 * a CropBox.
 */
export function bleedFinding(
  page: number,
  mediaBox: { width: number; height: number },
  cropBox: { width: number; height: number },
): Finding | null {
  const dw = Math.abs(mediaBox.width - cropBox.width);
  const dh = Math.abs(mediaBox.height - cropBox.height);
  if (dw < 0.5 && dh < 0.5) return null;

  return {
    page,
    severity: "warn",
    check: "bleed",
    detail: `page canvas ${mediaBox.width}x${mediaBox.height}pt vs crop box ${cropBox.width}x${cropBox.height}pt — content in between may or may not show, depending on the viewer`,
  };
}
