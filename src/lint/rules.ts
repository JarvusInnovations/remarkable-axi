import type { RasterPage } from "./rasterize.js";

export type Severity = "error" | "warn";

export interface Finding {
  page: number;
  severity: Severity;
  check: "page box" | "hairlines" | "contrast" | "type size" | "bleed";
  detail: string;
}

/** Points per device pixel — the resolvable-width unit every raster rule measures against. */
function ptPerPixel(dpi: number): number {
  return 72 / dpi;
}

/** A pixel this dark or darker counts as "ink" for run/transition scanning. */
const INK_THRESHOLD = 200;

function toHex(gray: number): string {
  const v = Math.round(Math.max(0, Math.min(255, gray)));
  const h = v.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

/** Quantize an 8-bit grey sample to one of 16 panel levels — `0` black .. `15` white. */
function level16(gray: number): number {
  return Math.round((Math.max(0, Math.min(255, gray)) / 255) * 15);
}

function fmtPt(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
}

// ---------------------------------------------------------------------------
// Text-line bands
//
// A row of text has many short, high-frequency dark/light transitions (the
// strokes and counters of individual glyphs); a photo, a solid fill, or a
// gutter of whitespace does not. Counting transitions per row and grouping
// consecutive high-transition rows into bands recovers each text line's
// visible height directly from the raster — with no font, no glyph
// segmentation, and no assumption about how the page was produced, so it
// reads a scanned page exactly as it reads a rendered one.
//
// Calibrated against a rendered fixture with known CSS font-size (12pt and
// 4pt, at 226dpi): the detector produced bands of 10.5-10.8pt for the two
// 12pt paragraphs and 3.8pt for the 4pt paragraph — proportional to the
// declared size and consistent between the two 12pt instances. The absolute
// MIN_TRANSITIONS threshold (6) was picked by inspecting that same fixture:
// its text rows carried far more than 6 transitions per row, and its
// whitespace/background rows carried zero, so 6 already sat well inside the
// margin between the two rather than at a tuned edge.
//
// A transition is a local *change* (`EDGE_DELTA` or more between adjacent
// pixels), not a crossing of a fixed absolute brightness — deliberately, so
// very faint text (the exact case the `contrast` rule exists to catch)
// still gets picked up as a band. An absolute "ink" cutoff would have missed
// it: light-grey-on-white text whose darkest pixel never drops below that
// cutoff produces zero crossings and is invisible to a fixed-threshold
// detector, even though its edges are perfectly measurable local deltas.
// Verified against a rendered `#eeeeee`-on-white fixture — the low-contrast
// case a fixed threshold silently missed in testing before this fix.
//
// A single line of text is not internally uniform: a descender ("y", "g")
// or ascender dips or rises past the x-height body the rest of the line
// sits in, and the row *between* the two can briefly fall under
// MIN_TRANSITIONS — splitting one visual line into a normal-sized band plus
// a short, isolated fragment that reads as its own much-smaller "line" (a
// lone descender tail measured 1.9pt tall under a 17pt heading in testing,
// which would have misfired as a type-size finding for text that was
// nowhere near the floor). Two adjacent raw bands are merged when their gap
// is small relative to the taller one — under half its height — since a
// genuinely separate line or paragraph carries a gap comparable to or
// larger than a full line's own height (measured 64px between two actually
// separate paragraphs in testing, against a 6px gap for the split-heading
// case above: the two are not close enough for one cutoff to confuse them).
// ---------------------------------------------------------------------------

const MIN_TRANSITIONS = 6;
/**
 * Shortest band that can still be a line of text.
 *
 * Transitions are counted across the whole scanline, so unrelated marks on
 * one row sum together — and a few of them can clear MIN_TRANSITIONS without
 * any text being present. A real case: a 2px dash inside a bordered callout
 * shared its scanline with that box's two vertical borders; 2 transitions
 * from the dash plus 4 from the borders cleared the threshold, so the dash
 * became its own band and was reported as 0.64pt "text" while the actual
 * caption beneath it measured 3.8pt.
 *
 * Rather than tune the transition count, bound the band: this rule's own
 * legible floor is 12 device pixels, so a band of four pixels or fewer is
 * not small text — it is a rule, a dash, or a raster artifact. Anything tall
 * enough to be a letterform at all survives, including text well under the
 * floor, which is the case the rule exists to catch.
 */
const MIN_BAND_HEIGHT_PX = 5;
const EDGE_DELTA = 10;
const MERGE_GAP_RATIO = 0.5;

interface Band {
  startRow: number;
  endRow: number;
}

function transitionsInRow(pixels: Uint8Array, width: number, y: number): number {
  const base = y * width;
  let count = 0;
  for (let x = 1; x < width; x++) {
    if (Math.abs(pixels[base + x]! - pixels[base + x - 1]!) >= EDGE_DELTA) count++;
  }
  return count;
}

function mergeAdjacentBands(raw: Band[]): Band[] {
  const merged: Band[] = [];
  for (const band of raw) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gap = band.startRow - prev.endRow - 1;
      const prevHeight = prev.endRow - prev.startRow + 1;
      const height = band.endRow - band.startRow + 1;
      if (gap <= MERGE_GAP_RATIO * Math.max(prevHeight, height)) {
        prev.endRow = band.endRow;
        continue;
      }
    }
    merged.push({ ...band });
  }
  return merged;
}

function detectTextBands(raster: RasterPage): Band[] {
  const { pixels, width, height } = raster;
  const raw: Band[] = [];
  let inBand = false;
  let start = 0;

  for (let y = 0; y < height; y++) {
    const isTextRow = transitionsInRow(pixels, width, y) >= MIN_TRANSITIONS;
    if (isTextRow && !inBand) {
      inBand = true;
      start = y;
    } else if (!isTextRow && inBand) {
      inBand = false;
      raw.push({ startRow: start, endRow: y - 1 });
    }
  }
  if (inBand) raw.push({ startRow: start, endRow: height - 1 });

  return mergeAdjacentBands(raw).filter((b) => b.endRow - b.startRow + 1 >= MIN_BAND_HEIGHT_PX);
}

// ---------------------------------------------------------------------------
// Type size
//
// The measured band height is the visible height of a text line as it will
// actually appear on the panel — not a font's nominal em size, which is
// what the rule cares about ("text below the legible floor at the device's
// density"). The floor is derived the same way as `hairlines`: a glyph's
// individual strokes are roughly 1/12 of its visible height for a typical
// regular-weight font, so a band shorter than 12 device pixels implies
// stroke widths under one device pixel — the same sub-pixel-collapse
// argument as a hairline rule, just applied to the strokes that make up a
// letterform instead of a drawn line.
//
// The 1/12 stroke-to-height ratio is a typographic approximation (real
// fonts range roughly 1/10-1/16), not a device measurement, so — per the
// plan's instruction to ship what can't be justified as `warn` rather than
// `error` — this rule never raises `error`, unlike `hairlines`, whose
// floor rests on pixel-sampling arithmetic alone.
// ---------------------------------------------------------------------------

const TYPE_SIZE_STROKE_RATIO = 12;

function typeSizeFloorPt(dpi: number): number {
  return TYPE_SIZE_STROKE_RATIO * ptPerPixel(dpi);
}

// ---------------------------------------------------------------------------
// Hairlines
//
// A "rule" is a long, thin run of ink — a horizontal divider, a table
// border, an underline. Detected as the longest contiguous ink run in a row
// (or column, for verticals) that spans a meaningful fraction of the page;
// short thin runs are glyph strokes, not rules, and are out of scope here
// (`type size` covers those).
//
// True sub-pixel width is recovered by integrating antialiased coverage
// across the run's thickness (`rasterize.ts`'s doc comment has the
// calibration numbers): a rule under half a device pixel wide is `error`
// (well under one raster sample; most rasterizers will round that to
// nothing), one between a half and a full pixel is `warn` (partial
// coverage may render as a faint or inconsistent line rather than
// vanishing outright). Both floors are pure sampling arithmetic on the
// device's own published dpi — no additional assumption layered on top —
// which is why, unlike `type size`, this rule does reach `error`.
// ---------------------------------------------------------------------------

const RULE_MIN_FRACTION = 0.15;
const COVERAGE_SAMPLE_WINDOW = 5; // rows/cols scanned to either side of a candidate run

interface RuleCandidate {
  /** Row (horizontal rule) or column (vertical rule) index at the run's core. */
  at: number;
  from: number;
  to: number;
}

function longestInkRun(pixels: Uint8Array, get: (i: number) => number, length: number): { start: number; end: number } | null {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let i = 0; i < length; i++) {
    const ink = pixels[get(i)]! < INK_THRESHOLD;
    if (ink) {
      if (curStart === -1) curStart = i;
    } else if (curStart !== -1) {
      const len = i - curStart;
      if (len > bestLen) {
        bestLen = len;
        bestStart = curStart;
      }
      curStart = -1;
    }
  }
  if (curStart !== -1) {
    const len = length - curStart;
    if (len > bestLen) {
      bestLen = len;
      bestStart = curStart;
    }
  }
  return bestStart === -1 ? null : { start: bestStart, end: bestStart + bestLen - 1 };
}

/** Horizontal rule candidates: one per contiguous run of qualifying rows. */
function findHorizontalRuleRows(raster: RasterPage): RuleCandidate[] {
  const { pixels, width, height } = raster;
  const qualifies: boolean[] = new Array(height).fill(false);
  const runs: ({ start: number; end: number } | null)[] = new Array(height).fill(null);

  for (let y = 0; y < height; y++) {
    const run = longestInkRun(pixels, (x) => y * width + x, width);
    runs[y] = run;
    qualifies[y] = run !== null && run.end - run.start + 1 >= RULE_MIN_FRACTION * width;
  }

  const candidates: RuleCandidate[] = [];
  let y = 0;
  while (y < height) {
    if (!qualifies[y]) {
      y++;
      continue;
    }
    const groupStart = y;
    while (y < height && qualifies[y]) y++;
    const mid = Math.floor((groupStart + y - 1) / 2);
    const run = runs[mid]!;
    candidates.push({ at: mid, from: run.start, to: run.end });
  }
  return candidates;
}

function findVerticalRuleCols(raster: RasterPage): RuleCandidate[] {
  const { pixels, width, height } = raster;
  const qualifies: boolean[] = new Array(width).fill(false);
  const runs: ({ start: number; end: number } | null)[] = new Array(width).fill(null);

  for (let x = 0; x < width; x++) {
    const run = longestInkRun(pixels, (y) => y * width + x, height);
    runs[x] = run;
    qualifies[x] = run !== null && run.end - run.start + 1 >= RULE_MIN_FRACTION * height;
  }

  const candidates: RuleCandidate[] = [];
  let x = 0;
  while (x < width) {
    if (!qualifies[x]) {
      x++;
      continue;
    }
    const groupStart = x;
    while (x < width && qualifies[x]) x++;
    const mid = Math.floor((groupStart + x - 1) / 2);
    const run = runs[mid]!;
    candidates.push({ at: mid, from: run.start, to: run.end });
  }
  return candidates;
}

/**
 * Fixed over-estimate the antialiasing kernel itself contributes to every
 * integrated-coverage measurement, regardless of the true rule width.
 *
 * Measured against eleven synthetic rules of known width (0.1pt-2pt,
 * `pdf-lib`-authored so Chrome's own print rasterizer — which floors
 * anything under 1 CSS px to 1 CSS px — never enters the picture): the
 * integrated coverage consistently ran 0.11-0.43px over the true width,
 * centred around 0.28px, rather than tracking it exactly. Subtracting this
 * constant before thresholding turns "0.1pt measures as 0.54px (0.17pt)" —
 * which would misfile a genuinely sub-half-pixel rule as `warn` instead of
 * `error` — into "0.1pt measures as 0.26px (0.08pt)", back in the
 * neighbourhood of the true value.
 */
const AA_BIAS_PX = 0.28;

/**
 * Ghostscript release the antialiasing bias above was measured against.
 *
 * The correction is a property of that rasterizer's AA kernel, not of the
 * page — so on any other release it is an unverified constant applied to a
 * real measurement, which is exactly what this project refuses to ship
 * silently (`specs/principles.md#measure-the-device-never-ship-a-guessed-constant`).
 * `checkHairlines` therefore caps itself at `warn` off-calibration rather
 * than raising the one `error` severity in the linter on an assumption.
 */
export const CALIBRATED_GS = "10.02";

/** Whether a detected Ghostscript version is the one AA_BIAS_PX was measured on. */
export function gsIsCalibrated(version: string | undefined): boolean {
  return typeof version === "string" && version.startsWith(`${CALIBRATED_GS}.`);
}

function correctedThicknessPx(rawPx: number): number {
  return Math.max(0, rawPx - AA_BIAS_PX);
}

/** Integrate antialiased coverage across a horizontal rule's thickness, in device pixels. */
function measureHorizontalThicknessPx(raster: RasterPage, rule: RuleCandidate): number {
  const { pixels, width, height } = raster;
  const samples: number[] = [];
  const xs = sampleWithin(rule.from, rule.to, 5);
  for (const x of xs) {
    let mass = 0;
    for (let dy = -COVERAGE_SAMPLE_WINDOW; dy <= COVERAGE_SAMPLE_WINDOW; dy++) {
      const y = rule.at + dy;
      if (y < 0 || y >= height) continue;
      mass += (255 - pixels[y * width + x]!) / 255;
    }
    samples.push(mass);
  }
  return median(samples);
}

function measureVerticalThicknessPx(raster: RasterPage, rule: RuleCandidate): number {
  const { pixels, width, height } = raster;
  const samples: number[] = [];
  const ys = sampleWithin(rule.from, rule.to, 5);
  for (const y of ys) {
    let mass = 0;
    for (let dx = -COVERAGE_SAMPLE_WINDOW; dx <= COVERAGE_SAMPLE_WINDOW; dx++) {
      const x = rule.at + dx;
      if (x < 0 || x >= width) continue;
      mass += (255 - pixels[y * width + x]!) / 255;
    }
    samples.push(mass);
  }
  return median(samples);
}

function sampleWithin(from: number, to: number, count: number): number[] {
  const span = to - from;
  if (span <= 0) return [from];
  const out: number[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(from + Math.round((span * i) / (count + 1)));
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** The worst (thinnest) hairline finding on the page, if any rule falls under one device pixel. */
export function checkHairlines(
  raster: RasterPage,
  page: number,
  dpi: number,
  opts: { gsVersion?: string } = {},
): Finding | null {
  const onePx = ptPerPixel(dpi);
  const halfPx = onePx / 2;

  let worst: { thicknessPt: number } | null = null;

  for (const rule of findHorizontalRuleRows(raster)) {
    const px = correctedThicknessPx(measureHorizontalThicknessPx(raster, rule));
    const pt = px * ptPerPixel(dpi);
    if (pt < onePx && (worst === null || pt < worst.thicknessPt)) worst = { thicknessPt: pt };
  }
  for (const rule of findVerticalRuleCols(raster)) {
    const px = correctedThicknessPx(measureVerticalThicknessPx(raster, rule));
    const pt = px * ptPerPixel(dpi);
    if (pt < onePx && (worst === null || pt < worst.thicknessPt)) worst = { thicknessPt: pt };
  }

  if (!worst) return null;

  // The only `error` in the linter, and it depends on a correction measured
  // on one Ghostscript release. Off that release the measurement stands but
  // the correction does not, so the verdict is capped rather than asserted.
  const calibrated = gsIsCalibrated(opts.gsVersion);
  const severity: Severity =
    worst.thicknessPt < halfPx && calibrated ? "error" : "warn";
  const caveat = calibrated
    ? ""
    : ` (measured under Ghostscript ${opts.gsVersion ?? "unknown"}; the antialiasing correction was calibrated on ${CALIBRATED_GS}.x, so this is reported as a warning)`;
  return {
    page,
    severity,
    check: "hairlines",
    detail: `${fmtPt(worst.thicknessPt)}pt rule — below ${fmtPt(onePx)}pt resolvable at ${dpi}dpi${caveat}`,
  };
}

/**
 * The worst (smallest) type-size finding on the page, if any text band's
 * measured height falls under the legible floor.
 */
export function checkTypeSize(raster: RasterPage, page: number, dpi: number): Finding | null {
  const floorPt = typeSizeFloorPt(dpi);
  const scale = ptPerPixel(dpi);

  let worst: { heightPt: number } | null = null;
  for (const band of detectTextBands(raster)) {
    const heightPt = (band.endRow - band.startRow + 1) * scale;
    if (heightPt < floorPt && (worst === null || heightPt < worst.heightPt)) {
      worst = { heightPt };
    }
  }

  if (!worst) return null;
  return {
    page,
    severity: "warn",
    check: "type size",
    detail: `text ~${fmtPt(worst.heightPt)}pt tall — below the ~${fmtPt(floorPt)}pt legible floor at ${dpi}dpi`,
  };
}

// ---------------------------------------------------------------------------
// Contrast
//
// Within each text band, the 5th and 95th percentile of every pixel value
// stand in for the ink colour and the local background — a *relative*
// split against the band's own darkest and lightest content, not a fixed
// absolute cutoff. That distinction matters for the exact case this rule
// exists to catch: light-grey-on-white text never gets very dark, so a
// fixed "below 128 is ink" cutoff finds no ink pixels at all and misses it
// entirely (caught in testing against a rendered `#eeeeee`-on-white
// fixture, which an earlier absolute-threshold version reported as clean).
// The percentile split adapts to whatever contrast is actually present and
// still separates true ink from background on ordinary high-contrast text.
//
// Both values quantize to one of 16 panel levels and the separation is
// what a 16-level e-ink panel could actually resolve between them.
//
// Every finding here ships `warn`, never `error` — the entire premise (a
// 16-level panel) is a published-spec figure, not something measured on
// this project's own hardware (`specs/behaviors/device-calibration.md`), so
// no separation number this rule reports can be trusted enough to block on.
// ---------------------------------------------------------------------------

const CONTRAST_LEVEL_THRESHOLD = 2; // flag when 2 or fewer of 16 levels apart

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 255;
  const idx = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
  return sortedValues[idx]!;
}

export function checkContrast(raster: RasterPage, page: number): Finding | null {
  const { pixels, width } = raster;

  let worst: { ink: number; bg: number; levels: number } | null = null;

  for (const band of detectTextBands(raster)) {
    const values: number[] = [];
    for (let y = band.startRow; y <= band.endRow; y++) {
      const base = y * width;
      for (let x = 0; x < width; x++) values.push(pixels[base + x]!);
    }
    values.sort((a, b) => a - b);

    const inkSample = percentile(values, 0.05);
    const bgSample = percentile(values, 0.95);

    // A band with no real spread between its dark and light ends isn't
    // ink-on-background at all — skip rather than report a spurious
    // near-zero separation.
    if (bgSample - inkSample < EDGE_DELTA) continue;

    const inkLevel = level16(inkSample);
    const bgLevel = level16(bgSample);
    const levels = Math.abs(bgLevel - inkLevel);
    if (levels <= CONTRAST_LEVEL_THRESHOLD) {
      if (!worst || levels < worst.levels) {
        worst = { ink: inkSample, bg: bgSample, levels };
      }
    }
  }

  if (!worst) return null;
  return {
    page,
    severity: "warn",
    check: "contrast",
    detail: `${toHex(worst.ink)} text on ${toHex(worst.bg)} background — ${worst.levels} level${worst.levels === 1 ? "" : "s"} apart on a 16-level panel`,
  };
}
