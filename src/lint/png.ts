import { deflateSync } from "node:zlib";

/**
 * Minimal 8-bit grayscale PNG encoder, built on `node:zlib` (a runtime
 * builtin, not a new dependency).
 *
 * `check` rasterizes each page once, into the same grayscale sample buffer
 * both the lint rules measure and the delivered page image shows — writing
 * that buffer back out as PNG here avoids a second Ghostscript invocation
 * per page just to re-render a deliverable copy, and avoids pulling in an
 * image-processing library the way decoding an arbitrary PNG back into
 * pixels would have (`src/lint/pgm.ts`'s doc comment). Encoding a raster we
 * already fully control (one 8-bit grayscale channel, no interlacing, no
 * palette) is a small, bounded amount of code; decoding arbitrary PNGs is
 * not.
 */
export function encodeGrayscalePng(
  width: number,
  height: number,
  pixels: Uint8Array,
): Uint8Array {
  if (pixels.length !== width * height) {
    throw new Error(
      `pixel buffer length ${pixels.length} does not match ${width}x${height}`,
    );
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive (per-scanline filter byte below)
  ihdr[12] = 0; // interlace: none

  // One filter-type byte (0 = "none") prefixed to each scanline, per the
  // PNG spec — required even when every scanline is unfiltered.
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const idat = deflateSync(raw);

  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const body = concat([typeBytes, data]);
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

let crcTable: Uint32Array | null = null;

/** Standard PNG/zlib CRC-32 (polynomial `0xEDB88320`), table-built once. */
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
