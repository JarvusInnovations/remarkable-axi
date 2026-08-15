import { mkdtemp, readFile, rm as removeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parsePgm } from "./pgm.js";

const execFileAsync = promisify(execFile);

export interface RasterPage {
  page: number;
  width: number;
  height: number;
  /** Grayscale samples, row-major, `0` = black .. `255` = white. */
  pixels: Uint8Array;
}

/** Hard ceiling on one Ghostscript invocation. */
const RASTER_TIMEOUT_MS = 60_000;

/**
 * Rasterize one page of a PDF to a grayscale sample buffer at an exact dpi,
 * with antialiasing enabled.
 *
 * This is the shared primitive `check`'s lint rules measure against and
 * `ink-preservation` (not yet built) is expected to reuse for per-page
 * similarity between a superseded document and its replacement — see
 * `plans/check-command.md`. It returns raw samples rather than a file path
 * so both callers can do pixel arithmetic directly, with no image-decode
 * step in between.
 *
 * Antialiasing is not cosmetic here: Ghostscript's default (non-antialiased)
 * rasterization paints any pixel touched by a shape as fully opaque,
 * regardless of how little of that pixel the shape actually covers — a
 * 0.1pt rule and a 2pt rule both come out as solid black, indistinguishable
 * by intensity. With `-dGraphicsAlphaBits=4 -dTextAlphaBits=4`, a rule's
 * sub-pixel coverage is spread across the antialiased grey ramp, and
 * integrating that ramp recovers the true sub-pixel width (measured
 * against synthetic rules of known width: a nominal 1.00px-wide rule
 * integrates to ~1.27px, a 3.14px rule to ~3.47px — a small, consistent
 * over-estimate from the antialiasing kernel's own footprint, not enough
 * to change which side of a one-pixel threshold a rule falls on).
 */
export async function rasterizePage(
  gsPath: string,
  pdfPath: string,
  page: number,
  dpi: number,
): Promise<RasterPage> {
  const dir = await mkdtemp(join(tmpdir(), "remarkable-axi-raster-"));
  const out = join(dir, "page.pgm");
  try {
    await execFileAsync(
      gsPath,
      [
        "-q",
        "-dNOPAUSE",
        "-dBATCH",
        "-dSAFER",
        "-sDEVICE=pgmraw",
        `-r${dpi}x${dpi}`,
        "-dGraphicsAlphaBits=4",
        "-dTextAlphaBits=4",
        `-dFirstPage=${page}`,
        `-dLastPage=${page}`,
        `-sOutputFile=${out}`,
        pdfPath,
      ],
      { timeout: RASTER_TIMEOUT_MS },
    );
    const pgm = parsePgm(await readFile(out));
    return { page, width: pgm.width, height: pgm.height, pixels: pgm.pixels };
  } catch (error) {
    const err = error as { killed?: boolean; stderr?: string };
    if (err.killed) {
      throw new Error(`ghostscript did not finish within ${RASTER_TIMEOUT_MS / 1000}s`);
    }
    const stderr = (err.stderr ?? "").trim();
    throw new Error(
      stderr ? `ghostscript failed: ${stderr.split("\n").slice(-1)[0]}` : "ghostscript failed",
    );
  } finally {
    await removeFile(dir, { recursive: true, force: true }).catch(() => {});
  }
}
