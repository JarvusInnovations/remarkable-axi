/**
 * Minimal PGM (portable graymap, binary/`P5`) reader.
 *
 * Ghostscript's `pgmraw` device is the analysis substrate for every raster
 * lint rule: it is an uncompressed format with a three-token text header
 * followed by raw samples, so it needs no decoder library — unlike PNG,
 * which would require pulling in an image-processing dependency just to
 * read pixels back (`plans/check-command.md` rules that out). The PNG this
 * tool hands back to the caller in `images[]` is written by Ghostscript
 * directly (`src/lint/png.ts`); this module never touches that path.
 */
export interface Pgm {
  width: number;
  height: number;
  /** Grayscale samples, row-major, `0` = black .. `255` = white. */
  pixels: Uint8Array;
}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * Parse a `P5` (binary grayscale) PGM buffer, per the netpbm format: a
 * `P5` magic, three whitespace-separated ASCII tokens (width, height,
 * maxval — `#` comments allowed between tokens), one whitespace byte, then
 * `width*height` raw samples.
 *
 * Only 8-bit maxval (`<=255`, one byte per sample) is supported — the only
 * form Ghostscript's `pgmraw` device emits.
 */
export function parsePgm(buffer: Uint8Array): Pgm {
  let i = 0;

  const skipWhitespaceAndComments = () => {
    for (;;) {
      while (i < buffer.length && WHITESPACE.has(buffer[i]!)) i++;
      if (buffer[i] === 0x23 /* '#' */) {
        while (i < buffer.length && buffer[i] !== 0x0a) i++;
      } else {
        break;
      }
    }
  };

  const readToken = (): string => {
    skipWhitespaceAndComments();
    const start = i;
    while (i < buffer.length && !WHITESPACE.has(buffer[i]!)) i++;
    return Buffer.from(buffer.subarray(start, i)).toString("ascii");
  };

  const magic = readToken();
  if (magic !== "P5") {
    throw new Error(`not a binary PGM (P5): got magic "${magic}"`);
  }

  const width = Number.parseInt(readToken(), 10);
  const height = Number.parseInt(readToken(), 10);
  const maxval = Number.parseInt(readToken(), 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("malformed PGM header");
  }
  if (maxval > 255) {
    throw new Error(`unsupported PGM maxval ${maxval} — only 8-bit samples are read`);
  }

  // Exactly one whitespace byte separates the header from the raster data.
  i++;

  const pixels = buffer.subarray(i, i + width * height);
  if (pixels.length < width * height) {
    throw new Error("truncated PGM data");
  }

  return { width, height, pixels: new Uint8Array(pixels) };
}
