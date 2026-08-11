import { decodeBrush, rmColors } from "rmapi-js";

/** A sampled point along a stroke. */
export interface Point {
  x: number;
  y: number;
  /** Rendered width at this point, already scaled. */
  width: number;
}

export interface Stroke {
  points: Point[];
  /** Representative width for the whole stroke. */
  width: number;
  /** CSS colour, e.g. `#1c1e21`. */
  color: string;
  /** Pen name where known, else `raw:<code>`. */
  brush: string;
  /** Highlighters are translucent so underlying ink stays readable. */
  opacity: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageGeometry {
  strokes: Stroke[];
  /** Typed text runs found on the page, in document order. */
  text: string[];
  /** Sheet size the device reports, if any. */
  paperSize: [number, number] | null;
  /** Tight bounds around all ink, or null when the page has none. */
  bounds: Bounds | null;
  /** Strokes skipped because they were deleted (tombstoned). */
  deleted: number;
  /** Palette indices encountered with no known colour mapping. */
  unmappedColors: number[];
}

/**
 * Decode a packed colour into CSS hex.
 *
 * rmapi-js documents this as a little-endian uint32 whose bytes are BGRA, so
 * the low byte is blue rather than red. Reading it the other way round yields
 * a plausible-looking but channel-swapped palette (cyan where yellow belongs),
 * which is easy to ship by accident.
 */
export function decodeRgba(packed: number): string {
  const n = packed >>> 0;
  const b = n & 0xff;
  const g = (n >>> 8) & 0xff;
  const r = (n >>> 16) & 0xff;
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Pen colours by raw palette index.
 *
 * 0-2 are the monochrome set the library documents. 6-13 are the Paper Pro's
 * colour pens, read off a calibration page written on the device: each index
 * was captured alongside its name in that pen's own colour. The hex values are
 * chosen to match those names on screen rather than sampled from the panel, so
 * they are faithful in hue but not colorimetrically exact.
 *
 * Indices are deliberately absent rather than guessed where no evidence
 * exists; an unknown index draws black and is reported.
 */
const PALETTE: Record<number, string> = {
  0: "#000000", // black
  1: "#808080", // grey
  2: "#ffffff", // white
  6: "#1a63d8", // blue
  7: "#d3312a", // red
  10: "#1f9e4a", // green
  11: "#00b3c4", // cyan
  12: "#c4319b", // magenta
  13: "#f2c010", // yellow
};

/**
 * Resolve a stroke's colour.
 *
 * Three tiers, most trustworthy first: an exact packed RGBA on the stroke
 * (highlighter and shader carry one); a palette index observed elsewhere in
 * the same document alongside an exact RGBA, which lets the document teach us
 * its own palette; then the monochrome table. Anything left is reported as
 * unmapped rather than guessed — a wrong colour is worse than a neutral one on
 * a colour-coded diagram.
 */
function resolveColor(
  rawColor: number,
  rgba: number | undefined,
  learned: Map<number, string>,
  unmapped: Set<number>,
): string {
  if (rgba !== undefined && rgba !== null) return decodeRgba(rgba);

  const fromDoc = learned.get(rawColor);
  if (fromDoc) return fromDoc;

  const known = PALETTE[rawColor];
  if (known) return known;

  unmapped.add(rawColor);
  return "#000000";
}

/** Highlighters must not paint over what they highlight. */
function opacityFor(brush: string): number {
  return brush === "highlighter" || brush === "shader" ? 0.35 : 1;
}

interface RawLine {
  points: { x: number; y: number; width?: number; pressure?: number }[];
  tool: number;
  color: number;
  colorRgba?: number;
  scale: number;
}

function toStroke(
  line: RawLine,
  learned: Map<number, string>,
  unmapped: Set<number>,
): Stroke | null {
  if (!line.points.length) return null;

  const brush = decodeBrush(line.tool) ?? `raw:${line.tool}`;
  const points: Point[] = line.points.map((p) => ({
    x: p.x,
    y: p.y,
    width: Math.max(p.width ?? 2, 0.2),
  }));
  const width =
    points.reduce((sum, p) => sum + p.width, 0) / points.length;

  return {
    points,
    width,
    color: resolveColor(line.color, line.colorRgba, learned, unmapped),
    brush,
    opacity: opacityFor(brush),
  };
}

/**
 * Collect palette index to exact colour pairs from strokes that carry both.
 *
 * Highlighter and shader strokes are the ones with an exact RGBA, so a
 * document that uses a colour for both a highlighter and a pen teaches us that
 * index for free.
 */
function learnPalette(blocks: unknown[]): Map<number, string> {
  const learned = new Map<number, string>();
  const conflicted = new Set<number>();
  for (const block of blocks as Record<string, any>[]) {
    if (block?.type !== "sceneLineItem") continue;
    const value = block.item?.value;
    if (!value) continue;
    if (value.colorRgba === undefined || value.colorRgba === null) continue;
    if (typeof value.color !== "number") continue;
    const hex = decodeRgba(value.colorRgba);
    const seen = learned.get(value.color);
    if (seen === undefined) {
      learned.set(value.color, hex);
    } else if (seen !== hex) {
      // The same index carrying two different colours means it is not a
      // palette entry at all but a "the colour is in colorRgba" marker -- the
      // highlighter's index 9 behaves exactly this way. Learning from it would
      // paint unrelated strokes the first colour that happened to appear.
      conflicted.add(value.color);
    }
  }
  for (const index of conflicted) learned.delete(index);
  return learned;
}

/** Pull typed text out of a v6 root text block, in document order. */
function extractText(blocks: unknown[]): string[] {
  const runs: string[] = [];
  for (const block of blocks as Record<string, any>[]) {
    if (block?.type !== "rootText") continue;
    const items = block.text?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      // A tombstoned item has no value; a number is an inline format code.
      if (typeof item?.value === "string" && item.value.length > 0) {
        runs.push(item.value);
      }
    }
  }
  // Runs are stored per character-range, so join then split on real breaks.
  const joined = runs.join("");
  return joined.length > 0
    ? joined
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];
}

/**
 * Put highlighter and shader strokes behind everything else.
 *
 * On the device a highlighter sits under the ink it marks, so drawing in raw
 * document order hides the very words being highlighted. A stable partition
 * preserves order within each group, so overlapping pens still stack the way
 * they were drawn.
 */
function washUnderInk(strokes: Stroke[]): Stroke[] {
  const wash: Stroke[] = [];
  const ink: Stroke[] = [];
  for (const s of strokes) {
    (s.opacity < 1 ? wash : ink).push(s);
  }
  return [...wash, ...ink];
}

function boundsOf(strokes: Stroke[]): Bounds | null {
  if (strokes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of strokes) {
    const pad = stroke.width / 2;
    for (const p of stroke.points) {
      x0 = Math.min(x0, p.x - pad);
      y0 = Math.min(y0, p.y - pad);
      x1 = Math.max(x1, p.x + pad);
      y1 = Math.max(y1, p.y + pad);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/**
 * Normalize one page of either stroke format into a common geometry model.
 *
 * v6 stores strokes as a flat CRDT block list; v5 nests them in layers. Both
 * reduce to the same thing for rendering, so callers never branch on version.
 */
export function pageGeometry(page: unknown): PageGeometry {
  const p = page as Record<string, any> | undefined | null;
  const unmapped = new Set<number>();
  const strokes: Stroke[] = [];
  let deleted = 0;

  if (!p) {
    return {
      strokes,
      text: [],
      paperSize: null,
      bounds: null,
      deleted,
      unmappedColors: [],
    };
  }

  const paperSize = Array.isArray(p.paperSize)
    ? ([p.paperSize[0], p.paperSize[1]] as [number, number])
    : null;

  if (Array.isArray(p.blocks)) {
    const learned = learnPalette(p.blocks);
    for (const block of p.blocks as Record<string, any>[]) {
      if (block?.type !== "sceneLineItem") continue;
      const value = block.item?.value;
      if (!value?.points?.length) {
        // Erased ink stays in the file as a tombstone with no value.
        deleted++;
        continue;
      }
      const stroke = toStroke(
        {
          points: value.points,
          tool: value.tool,
          color: value.color,
          colorRgba: value.colorRgba,
          scale: value.thicknessScale ?? 1,
        },
        learned,
        unmapped,
      );
      if (stroke) strokes.push(stroke);
    }
    const ordered = washUnderInk(strokes);
    return {
      strokes: ordered,
      text: extractText(p.blocks),
      paperSize,
      bounds: boundsOf(strokes),
      deleted,
      unmappedColors: [...unmapped].sort((a, b) => a - b),
    };
  }

  if (Array.isArray(p.layers)) {
    const learned = new Map<number, string>();
    for (const layer of p.layers as Record<string, any>[]) {
      for (const line of (layer?.lines ?? []) as Record<string, any>[]) {
        if (!line?.points?.length) {
          deleted++;
          continue;
        }
        const stroke = toStroke(
          {
            points: line.points,
            tool: line.brushType,
            color: line.color,
            scale: 1,
          },
          learned,
          unmapped,
        );
        if (stroke) strokes.push(stroke);
      }
    }
  }

  return {
    strokes: washUnderInk(strokes),
    text: [],
    paperSize,
    bounds: boundsOf(strokes),
    deleted,
    unmappedColors: [...unmapped].sort((a, b) => a - b),
  };
}

/** The colour names the monochrome palette knows, for diagnostics. */
export const monochromePalette = rmColors;

/** Stroke width as a fraction of typical stroke extent that reads cleanly. */
const TARGET_BOLDNESS = 0.1;

/** Below this, strokes risk vanishing when the page is rasterized. */
const MIN_INK_WIDTH = 0.8;

/** Relative luminance, for deciding whether ink is too pale to read. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = Number.parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
}

/** Darken a colour toward black until it has enough contrast on white. */
function darken(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = Number.parseInt(m[1]!, 16);
  const ch = (v: number) => Math.round(v * factor).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 0xff)}${ch((n >> 8) & 0xff)}${ch(n & 0xff)}`;
}

/**
 * Rebalance a page for machine reading rather than faithful reproduction.
 *
 * The dominant factor by far is stroke weight relative to letter size. A pen
 * set thick and used to write small produces strokes almost as wide as they
 * are long -- one real page measured 0.90, where legible handwriting sits near
 * 0.1 -- and the letterforms merge into solid blobs. Rescaling weight to that
 * target turned an unreadable page into a transcribable one, which is the
 * whole justification for this mode existing.
 *
 * Weight is only ever reduced, never increased: emboldening thin writing
 * merges it, and thinning past the target buys nothing at the resolutions a
 * vision model actually sees while risking strokes dropping out entirely.
 *
 * Pale ink is darkened rather than forced to black, so colour coding survives
 * while yellow on white stops being invisible. Highlighter wash is lightened
 * because it sits under the very words being read.
 *
 * The result is deliberately *not* what the device shows. It is a reading aid.
 */
export function optimizeForReading(geo: PageGeometry): PageGeometry {
  const extents = geo.strokes
    .map((s) => {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      return Math.hypot(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
    })
    .filter((v) => v > 1)
    .sort((a, b) => a - b);

  if (extents.length === 0) return geo;

  const medianExtent = extents[Math.floor(extents.length / 2)]!;
  const widths = geo.strokes.map((s) => s.width).sort((a, b) => a - b);
  const medianWidth = widths[Math.floor(widths.length / 2)]!;
  if (medianWidth <= 0) return geo;

  const boldness = medianWidth / medianExtent;
  const factor = boldness > TARGET_BOLDNESS ? TARGET_BOLDNESS / boldness : 1;

  const strokes = geo.strokes.map((s) => {
    const wash = s.opacity < 1;
    const width = Math.max(s.width * factor, MIN_INK_WIDTH);
    const pale = !wash && luminance(s.color) > 0.55;
    return {
      ...s,
      width,
      points: s.points.map((p) => ({
        ...p,
        width: Math.max(p.width * factor, MIN_INK_WIDTH),
      })),
      color: pale ? darken(s.color, 0.55) : s.color,
      opacity: wash ? Math.min(s.opacity, 0.15) : s.opacity,
    };
  });

  return { ...geo, strokes, bounds: boundsOf(strokes) };
}
