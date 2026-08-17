/**
 * Downscale the grayscale raster `check` already rasterized, so the page
 * image handed back is a preview rather than the full-density file.
 *
 * This operates on the exact buffer the lint rules measured — it runs
 * between `rasterizePage` and `encodeGrayscalePng`, never as a second
 * Ghostscript pass at a lower `-r`. A second render is not the same
 * operation: different antialiasing coverage and different pixel-grid
 * placement mean it could disagree with what the findings measured.
 * Resampling the measured pixels is arithmetic on a fixed input; findings
 * are already frozen before this runs.
 */

/**
 * Ceiling, in pixels, on the long edge of a written page image.
 *
 * This is not a measured device property — it is the ceiling of what agent
 * vision ingests. Larger images get downscaled by the model anyway, so a
 * preview at this scale is lossless to the agent by construction, while a
 * human in the review loop still gets a crisp enough image to judge layout
 * and read body text against. If review ever shows this too lossy in
 * practice, the constant moves — this doc comment carries the rationale,
 * not the number.
 */
export const PREVIEW_MAX_DIMENSION = 1568;

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Fit `width`x`height` within `max` on its long edge, preserving aspect
 * ratio, rounding to whole pixels. Never upscales — a raster already within
 * `max` is returned unchanged.
 */
export function fitDimensions(
  width: number,
  height: number,
  max: number = PREVIEW_MAX_DIMENSION,
): Dimensions {
  const longEdge = Math.max(width, height);
  if (longEdge <= max) return { width, height };

  const scale = max / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Weighted average of `values[offset + i * stride]` for `i` in `[0,count)`,
 * over the continuous span `[start,end)` — the box-filter weight for
 * downscaling: a source sample fully inside the span counts fully, one
 * straddling the span's edge counts by the fraction of itself inside it.
 *
 * This is the same coverage-integration idea as antialiasing (Ghostscript's
 * `AlphaBits`, per `rasterize.ts`) applied to resampling instead of
 * rendering — it is what makes the filter correct for non-integer scale
 * ratios (e.g. 1620 -> 1176 is a 0.7259... ratio, not a clean divisor),
 * rather than only for scales that divide evenly.
 */
function averageSpan(
  values: ArrayLike<number>,
  offset: number,
  stride: number,
  count: number,
  start: number,
  end: number,
): number {
  const lo = Math.max(0, start);
  const hi = Math.min(count, end);
  const first = Math.max(0, Math.min(count - 1, Math.floor(lo)));
  if (hi <= lo) return values[offset + first * stride]!;

  let sum = 0;
  let weight = 0;
  const last = Math.min(count - 1, Math.floor(hi - 1e-9));
  for (let i = first; i <= last; i++) {
    const overlap = Math.min(hi, i + 1) - Math.max(lo, i);
    if (overlap > 0) {
      sum += values[offset + i * stride]! * overlap;
      weight += overlap;
    }
  }
  return weight > 0 ? sum / weight : values[offset + first * stride]!;
}

/**
 * Downscale a row-major 8-bit grayscale raster with a separable box (area
 * average) filter: a horizontal pass (`srcWidth` -> `dstWidth`) followed by
 * a vertical pass (`srcHeight` -> `dstHeight`), each pixel of one axis
 * computed via `averageSpan` above. Separable is standard for a box filter
 * — resampling each axis independently gives the same result as a combined
 * 2D box integral, at a fraction of the arithmetic.
 *
 * Intermediate values are kept as floats and rounded to `Uint8` only once,
 * after both passes, to avoid compounding rounding error across the two
 * passes.
 *
 * Never called for an upscale or a no-op resize — callers check
 * `fitDimensions` first — but a same-size request is honored cheaply rather
 * than asserted against, so this function stays a pure, general resampler.
 */
export function downscaleGrayscale(
  pixels: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8Array {
  if (pixels.length !== srcWidth * srcHeight) {
    throw new Error(
      `pixel buffer length ${pixels.length} does not match ${srcWidth}x${srcHeight}`,
    );
  }
  if (dstWidth <= 0 || dstHeight <= 0) {
    throw new Error(`invalid downscale target ${dstWidth}x${dstHeight}`);
  }
  if (dstWidth === srcWidth && dstHeight === srcHeight) return pixels;

  // Horizontal pass: srcWidth -> dstWidth, one source row at a time.
  const xScale = srcWidth / dstWidth;
  const horizontal = new Float32Array(dstWidth * srcHeight);
  for (let y = 0; y < srcHeight; y++) {
    const rowOffset = y * srcWidth;
    const outOffset = y * dstWidth;
    for (let dx = 0; dx < dstWidth; dx++) {
      horizontal[outOffset + dx] = averageSpan(
        pixels,
        rowOffset,
        1,
        srcWidth,
        dx * xScale,
        (dx + 1) * xScale,
      );
    }
  }

  // Vertical pass: srcHeight -> dstHeight, one destination column at a time.
  const yScale = srcHeight / dstHeight;
  const out = new Uint8Array(dstWidth * dstHeight);
  for (let x = 0; x < dstWidth; x++) {
    for (let dy = 0; dy < dstHeight; dy++) {
      const value = averageSpan(
        horizontal,
        x,
        dstWidth,
        srcHeight,
        dy * yScale,
        (dy + 1) * yScale,
      );
      out[dy * dstWidth + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return out;
}
