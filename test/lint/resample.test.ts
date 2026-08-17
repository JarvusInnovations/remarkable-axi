import { describe, expect, test } from "vitest";
import { downscaleGrayscale, fitDimensions, PREVIEW_MAX_DIMENSION } from "../../src/lint/resample.js";

describe("fitDimensions", () => {
  test("scales the long edge down to the ceiling, preserving aspect ratio", () => {
    // Paper Pro's native raster (1620x2160, per specs/commands/check.md's
    // validation criteria) scales to exactly 1176x1568.
    expect(fitDimensions(1620, 2160)).toEqual({ width: 1176, height: 1568 });
  });

  test("a landscape raster scales the same way, long edge on width", () => {
    expect(fitDimensions(2160, 1620)).toEqual({ width: 1568, height: 1176 });
  });

  test("never upscales — a raster already within the ceiling is unchanged", () => {
    expect(fitDimensions(800, 600, 1568)).toEqual({ width: 800, height: 600 });
  });

  test("a raster exactly at the ceiling is unchanged", () => {
    expect(fitDimensions(1568, 900, 1568)).toEqual({ width: 1568, height: 900 });
  });

  test("defaults to PREVIEW_MAX_DIMENSION when no max is given", () => {
    expect(fitDimensions(3136, 1000)).toEqual(fitDimensions(3136, 1000, PREVIEW_MAX_DIMENSION));
  });

  test("PREVIEW_MAX_DIMENSION is the documented 1568px ceiling", () => {
    expect(PREVIEW_MAX_DIMENSION).toBe(1568);
  });
});

describe("downscaleGrayscale", () => {
  test("returns the input unchanged when the target size matches the source", () => {
    const pixels = new Uint8Array([1, 2, 3, 4]);
    expect(downscaleGrayscale(pixels, 2, 2, 2, 2)).toBe(pixels);
  });

  test("rejects a pixel buffer that doesn't match width*height", () => {
    expect(() => downscaleGrayscale(new Uint8Array([1, 2, 3]), 2, 2, 1, 1)).toThrow(/does not match/);
  });

  test("rejects a non-positive target size", () => {
    expect(() => downscaleGrayscale(new Uint8Array(4), 2, 2, 0, 1)).toThrow(/invalid downscale target/);
  });

  test("a 4x4 -> 2x2 integer-ratio downscale is a plain box average of each 2x2 block", () => {
    // prettier-ignore
    const pixels = new Uint8Array([
       0, 10, 20, 30,
      10, 20, 30, 40,
      20, 30, 40, 50,
      30, 40, 50, 60,
    ]);
    const out = downscaleGrayscale(pixels, 4, 4, 2, 2);
    // Block (0,0): {0,10,10,20} -> 10; block (0,1): {20,30,30,40} -> 30
    // Block (1,0): {20,30,30,40} -> 30; block (1,1): {40,50,50,60} -> 50
    expect([...out]).toEqual([10, 30, 30, 50]);
  });

  test("a non-integer scale ratio weights partial source pixels by their coverage", () => {
    // Width 3 -> 2 is a 1.5x ratio: neither output pixel aligns to a whole
    // number of source pixels, so this only comes out right if partial
    // pixels are weighted by how much of the destination span they cover.
    //
    // dst[0] covers src[0] fully (weight 1) and half of src[1] (weight 0.5):
    // (0*1 + 90*0.5) / 1.5 = 30
    // dst[1] covers half of src[1] (weight 0.5) and src[2] fully (weight 1):
    // (90*0.5 + 30*1) / 1.5 = 50
    const pixels = new Uint8Array([0, 90, 30]);
    const out = downscaleGrayscale(pixels, 3, 1, 2, 1);
    expect([...out]).toEqual([30, 50]);
  });

  test("downscaling a uniform raster stays uniform (no ringing/edge artifacts introduced)", () => {
    const pixels = new Uint8Array(37 * 41).fill(128);
    const out = downscaleGrayscale(pixels, 37, 41, 13, 17);
    expect(out.length).toBe(13 * 17);
    expect([...new Set(out)]).toEqual([128]);
  });

  test("output values stay within the source's min/max range", () => {
    const width = 53;
    const height = 29;
    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 256;
    const out = downscaleGrayscale(pixels, width, height, 17, 11);

    const srcMin = Math.min(...pixels);
    const srcMax = Math.max(...pixels);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(srcMin);
      expect(v).toBeLessThanOrEqual(srcMax);
    }
  });
});
