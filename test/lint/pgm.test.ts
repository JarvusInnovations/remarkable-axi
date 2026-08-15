import { describe, expect, test } from "vitest";
import { parsePgm } from "../../src/lint/pgm.js";

function buildPgm(width: number, height: number, pixels: number[]): Uint8Array {
  const header = `P5\n${width} ${height}\n255\n`;
  const headerBytes = Buffer.from(header, "ascii");
  return Buffer.concat([headerBytes, Buffer.from(pixels)]);
}

describe("parsePgm", () => {
  test("reads width, height, and raw samples", () => {
    const pixels = [0, 128, 255, 64];
    const buf = buildPgm(2, 2, pixels);
    const pgm = parsePgm(buf);
    expect(pgm.width).toBe(2);
    expect(pgm.height).toBe(2);
    expect([...pgm.pixels]).toEqual(pixels);
  });

  test("skips a comment line between header tokens", () => {
    const header = "P5\n# a comment\n3 1\n255\n";
    const buf = Buffer.concat([Buffer.from(header, "ascii"), Buffer.from([1, 2, 3])]);
    const pgm = parsePgm(buf);
    expect(pgm.width).toBe(3);
    expect(pgm.height).toBe(1);
    expect([...pgm.pixels]).toEqual([1, 2, 3]);
  });

  test("rejects a non-P5 magic", () => {
    const buf = Buffer.from("P2\n1 1\n255\n0", "ascii");
    expect(() => parsePgm(buf)).toThrow(/P5/);
  });

  test("rejects truncated pixel data", () => {
    const buf = Buffer.from("P5\n4 4\n255\n\x00\x00", "ascii");
    expect(() => parsePgm(buf)).toThrow(/truncated/);
  });
});
