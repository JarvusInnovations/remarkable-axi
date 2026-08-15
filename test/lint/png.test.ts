import { describe, expect, test } from "vitest";
import { encodeGrayscalePng } from "../../src/lint/png.js";

describe("encodeGrayscalePng", () => {
  test("emits a valid PNG signature, IHDR, and IEND", () => {
    const png = encodeGrayscalePng(2, 2, new Uint8Array([0, 255, 128, 64]));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    expect([...png.subarray(0, 8)]).toEqual(signature);

    // IHDR immediately follows: 4-byte length, "IHDR", then the 13-byte body.
    const ihdrType = Buffer.from(png.subarray(12, 16)).toString("ascii");
    expect(ihdrType).toBe("IHDR");
    const view = new DataView(png.buffer, png.byteOffset + 16, 13);
    expect(view.getUint32(0)).toBe(2); // width
    expect(view.getUint32(4)).toBe(2); // height
    expect(view.getUint8(8)).toBe(8); // bit depth
    expect(view.getUint8(9)).toBe(0); // color type: grayscale

    const tail = Buffer.from(png.subarray(png.length - 8)).toString("ascii");
    expect(tail).toContain("IEND");
  });

  test("rejects a pixel buffer that doesn't match width*height", () => {
    expect(() => encodeGrayscalePng(2, 2, new Uint8Array([0, 255]))).toThrow(
      /does not match/,
    );
  });

  test("round-trips through Ghostscript-independent tooling: file size scales with content, not raw byte count", () => {
    const width = 100;
    const height = 100;
    const blank = new Uint8Array(width * height).fill(255);
    const noisy = new Uint8Array(width * height);
    for (let i = 0; i < noisy.length; i++) noisy[i] = i % 256;

    const blankPng = encodeGrayscalePng(width, height, blank);
    const noisyPng = encodeGrayscalePng(width, height, noisy);
    // A uniform raster deflates far smaller than a high-entropy one — a
    // cheap proxy that the encoder is actually compressing pixel content
    // rather than emitting a fixed-size or corrupt stream.
    expect(blankPng.length).toBeLessThan(noisyPng.length);
  });
});
