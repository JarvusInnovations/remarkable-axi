import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  rgb,
  stroke as strokeOp,
} from "pdf-lib";
import type { Bounds, PageGeometry, Stroke } from "./strokes.js";

/** How the output frame is chosen. */
export type Fit = "content" | "page";

/** Fallback sheet size when a page reports none (reMarkable 1/2 dimensions). */
const DEFAULT_PAPER: [number, number] = [1404, 1872];

/** Margin left around ink when fitting to content. */
const CONTENT_PAD = 40;

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Choose the output frame for a page.
 *
 * Sheet coordinates are centred on x=0 and y grows downward, and an extended
 * page can run several sheet-heights deep — so `page` fit means "at least the
 * sheet, plus whatever ink runs past it" rather than exactly the sheet. `content`
 * crops tight to the ink, which matters when the output is going to a vision
 * model: cropping spends the available pixels on the writing instead of margin.
 */
export function frameFor(geo: PageGeometry, fit: Fit): Frame {
  const [pw, ph] = geo.paperSize ?? DEFAULT_PAPER;
  const sheet: Bounds = { x0: -pw / 2, y0: 0, x1: pw / 2, y1: ph };
  const ink = geo.bounds;

  if (fit === "content" && ink) {
    return {
      x: ink.x0 - CONTENT_PAD,
      y: ink.y0 - CONTENT_PAD,
      width: Math.max(ink.x1 - ink.x0 + CONTENT_PAD * 2, 1),
      height: Math.max(ink.y1 - ink.y0 + CONTENT_PAD * 2, 1),
    };
  }

  const x0 = Math.min(sheet.x0, ink?.x0 ?? sheet.x0);
  const y0 = Math.min(sheet.y0, ink?.y0 ?? sheet.y0);
  const x1 = Math.max(sheet.x1, ink?.x1 ?? sheet.x1);
  const y1 = Math.max(sheet.y1, ink?.y1 ?? sheet.y1);
  return { x: x0, y: y0, width: Math.max(x1 - x0, 1), height: Math.max(y1 - y0, 1) };
}

function pathData(stroke: Stroke): string {
  return stroke.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)},${round(p.y)}`)
    .join(" ");
}

/** Two decimals is well under device precision and cuts file size sharply. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render one page to a standalone SVG document. */
export function pageToSvg(geo: PageGeometry, fit: Fit): string {
  const f = frameFor(geo, fit);
  const body = geo.strokes
    .map((s) => {
      const opacity = s.opacity < 1 ? ` stroke-opacity="${s.opacity}"` : "";
      return `<path d="${pathData(s)}" stroke="${s.color}" stroke-width="${round(s.width)}"${opacity}/>`;
    })
    .join("\n");

  // A title element keeps extracted text discoverable to anything reading the
  // SVG rather than looking at it.
  const title =
    geo.text.length > 0
      ? `\n<title>${escapeXml(geo.text.join(" ").slice(0, 400))}</title>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(f.x)} ${round(f.y)} ${round(f.width)} ${round(f.height)}" width="${round(f.width)}" height="${round(f.height)}">${title}
<rect x="${round(f.x)}" y="${round(f.y)}" width="${round(f.width)}" height="${round(f.height)}" fill="#ffffff"/>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
${body}
</g>
</svg>
`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(m[1]!, 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

/**
 * Draw a page's strokes onto a pdf-lib page using raw path operators.
 *
 * `drawSvgPath` is the obvious tool and the wrong one here: it fills the path
 * as well as stroking it, which turns open handwriting into solid blobs, and
 * it applies its own coordinate transform on top of any you compute.
 *
 * The mapping is therefore explicit. Sheet space is centred on x=0 with y
 * growing downward; PDF space has its origin bottom-left with y growing up, so
 * y is flipped exactly once and x is never mirrored.
 */
function drawStrokes(
  page: ReturnType<PDFDocument["addPage"]>,
  strokes: Stroke[],
  frame: Frame,
  scale: number,
  offsetX = 0,
  offsetY = 0,
): void {
  const pageHeight = page.getHeight();
  const px = (x: number) => offsetX + (x - frame.x) * scale;
  const py = (y: number) => pageHeight - offsetY - (y - frame.y) * scale;

  for (const s of strokes) {
    if (s.points.length === 0) continue;

    // Real alpha needs an ExtGState resource; compositing the colour against
    // white gives the same result for a highlighter laid over a blank sheet and
    // keeps the page a plain content stream.
    const { r, g, b } = blendOnWhite(hexToRgb(s.color), s.opacity);

    const ops: unknown[] = [
      pushGraphicsState(),
      setStrokingColor(rgb(r, g, b)),
      setLineWidth(Math.max(s.width * scale, 0.1)),
      setLineCap(LineCapStyle.Round),
      // Round joins matter far more than caps here: a highlighter is a
      // constant 120 sheet-units wide, and the default miter join throws long
      // spikes off every sharp direction change in a scrubbed highlight.
      setLineJoin(LineJoinStyle.Round),
      moveTo(px(s.points[0]!.x), py(s.points[0]!.y)),
    ];
    for (let i = 1; i < s.points.length; i++) {
      ops.push(lineTo(px(s.points[i]!.x), py(s.points[i]!.y)));
    }
    ops.push(strokeOp(), popGraphicsState());
    page.pushOperators(...(ops as Parameters<typeof page.pushOperators>));
  }
}

function blendOnWhite(
  c: { r: number; g: number; b: number },
  alpha: number,
): { r: number; g: number; b: number } {
  if (alpha >= 1) return c;
  const mix = (v: number) => v * alpha + (1 - alpha);
  return { r: mix(c.r), g: mix(c.g), b: mix(c.b) };
}

/** Points per inch in PDF user space. */
const PT_PER_IN = 72;

export interface PdfOptions {
  fit: Fit;
  /** Device DPI, used to size pages so 1in of ink is 1in on paper. */
  dpi?: number;
}

/**
 * Render pages to a standalone vector PDF.
 *
 * Pages are sized in points from the sheet's physical size rather than its
 * pixels: a 1620px-wide Paper Pro sheet at 229dpi is ~509pt, where using pixels
 * directly would produce a page several times too large.
 */
export async function pagesToPdf(
  pages: PageGeometry[],
  options: PdfOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const dpi = options.dpi ?? 226;

  for (const geo of pages) {
    const frame = frameFor(geo, options.fit);
    const scale = PT_PER_IN / dpi;
    const page = doc.addPage([frame.width * scale, frame.height * scale]);
    drawStrokes(page, geo.strokes, frame, scale);
  }

  if (doc.getPageCount() === 0) doc.addPage([PT_PER_IN * 6, PT_PER_IN * 8]);
  return doc.save();
}

/**
 * Overlay a document's ink onto its own base PDF.
 *
 * Annotated PDFs keep the original document and the ink separately, so this
 * loads the base and draws each page's strokes on top. Ink is positioned by
 * fitting the sheet box to the page box: the device shows the PDF page scaled
 * into the sheet, so reversing that mapping is what puts a mark back where it
 * was drawn. Pages with no ink pass through untouched.
 */
export async function overlayOnPdf(
  basePdf: Uint8Array,
  inkByPageIndex: Map<number, PageGeometry>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(basePdf, { ignoreEncryption: true });
  const pages = doc.getPages();

  for (const [index, geo] of inkByPageIndex) {
    const page = pages[index];
    if (!page || geo.strokes.length === 0) continue;

    const [sheetW, sheetH] = geo.paperSize ?? DEFAULT_PAPER;
    const pw = page.getWidth();
    const ph = page.getHeight();

    // The device fits the page into the sheet preserving aspect, so the same
    // uniform scale applies to both axes, with the shorter axis centred.
    const scale = Math.min(pw / sheetW, ph / sheetH);
    const offsetX = (pw - sheetW * scale) / 2;
    const offsetY = (ph - sheetH * scale) / 2;

    drawStrokes(
      page,
      geo.strokes,
      { x: -sheetW / 2, y: 0, width: sheetW, height: sheetH },
      scale,
      offsetX,
      offsetY,
    );
  }

  return doc.save();
}
