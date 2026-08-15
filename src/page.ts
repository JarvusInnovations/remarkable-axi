import type { PageBox } from "./devices.js";

/**
 * Points a declared box may differ from the device box by and still count
 * as matching.
 *
 * Headless Chrome rounds its print box to integer points
 * (`specs/behaviors/page-geometry.md`), so a declared value a fraction of a
 * point off the device box renders identically to one that is exact. Half a
 * point is small enough that nothing a document would actually care about
 * falls inside it, and large enough to absorb the float error `mm`/`in`
 * conversions introduce.
 */
const MATCH_EPSILON = 0.5;

export type PageDetection =
  | { status: "absent" }
  | { status: "matches" }
  | {
      status: "differs";
      declared: PageBox;
      /** `declared - device`, in points. Positive means declared is larger. */
      delta: PageBox;
    };

/**
 * The shared `@page` detection: absent / matches / differs-with-signed-delta.
 *
 * This is the one place `render` and `check` agree on what a declared page
 * size means against the device box — see
 * `specs/behaviors/page-geometry.md#shared-rule-two-dispositions`. Neither
 * command may reimplement this comparison, or they could disagree.
 */
export function detectPageBox(
  declared: PageBox | null,
  device: PageBox,
): PageDetection {
  if (!declared) return { status: "absent" };

  const delta: PageBox = {
    width: declared.width - device.width,
    height: declared.height - device.height,
  };

  if (
    Math.abs(delta.width) < MATCH_EPSILON &&
    Math.abs(delta.height) < MATCH_EPSILON
  ) {
    return { status: "matches" };
  }

  return { status: "differs", declared, delta };
}

function formatPt(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

/**
 * Human-readable delta, stating which side of the box each differing axis
 * falls on — `specs/behaviors/page-geometry.md#why-a-mismatch-matters`
 * requires the side, not just that the sizes differ.
 */
export function describeDelta(delta: PageBox): string {
  const parts: string[] = [];
  if (Math.abs(delta.width) >= MATCH_EPSILON) {
    parts.push(
      `${formatPt(Math.abs(delta.width))}pt ${delta.width > 0 ? "wider" : "narrower"}`,
    );
  }
  if (Math.abs(delta.height) >= MATCH_EPSILON) {
    parts.push(
      `${formatPt(Math.abs(delta.height))}pt ${delta.height > 0 ? "taller" : "shorter"}`,
    );
  }
  return parts.length > 0 ? parts.join(", ") : "matches";
}

const UNIT_TO_PT: Record<string, number> = {
  pt: 1,
  in: 72,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  px: 72 / 96,
};

function parseLength(token: string): number | null {
  const m = token.trim().match(/^(-?[\d.]+)(pt|in|mm|cm|px)$/i);
  if (!m) return null;
  const value = Number.parseFloat(m[1]!);
  const unit = m[2]!.toLowerCase();
  const factor = UNIT_TO_PT[unit];
  return factor === undefined ? null : value * factor;
}

const PAGE_RULE = /@page\s*(?:[^{]*)\{([^}]*)\}/i;
const SIZE_PROP = /size\s*:\s*([^;]+);?/i;

/**
 * Extract a declared `@page { size: ... }` box from HTML/CSS text, in
 * points.
 *
 * Only numeric sizes are understood (`pt`, `in`, `mm`, `cm`, `px`) — named
 * page sizes (`A4`, `letter`) and orientation keywords are not resolved to a
 * box and read as no declaration, same as `@page` being absent entirely.
 * Every size this tool itself emits (`page --css`, and `render`'s injected
 * box) is numeric, so this covers every document the tool round-trips; a
 * keyword size only appears in HTML this tool did not author.
 */
export function parseDeclaredPageBox(html: string): PageBox | null {
  const pageMatch = PAGE_RULE.exec(html);
  if (!pageMatch) return null;

  const sizeMatch = SIZE_PROP.exec(pageMatch[1]!);
  if (!sizeMatch) return null;

  const tokens = sizeMatch[1]!.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    const side = parseLength(tokens[0]!);
    return side === null ? null : { width: side, height: side };
  }
  if (tokens.length >= 2) {
    const width = parseLength(tokens[0]!);
    const height = parseLength(tokens[1]!);
    return width === null || height === null ? null : { width, height };
  }
  return null;
}

/**
 * The CSS block `page --css` hands an author, and the same block `render`
 * injects when a source declares no `@page` size.
 *
 * Custom properties exist so layout math inside the document references the
 * page box by name rather than repeating the literal — see
 * `specs/commands/page.md`.
 */
export function cssBlock(box: PageBox): string {
  const w = `${box.width}pt`;
  const h = `${box.height}pt`;
  return [
    `@page { size: ${w} ${h}; margin: 0; }`,
    `:root { --page-w: ${w}; --page-h: ${h}; }`,
    `html, body { width: ${w}; height: ${h}; margin: 0; }`,
  ].join("\n");
}
