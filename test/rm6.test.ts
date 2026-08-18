import { describe, expect, test } from "vitest";
import { parseDeviceRm } from "../src/rm6.js";
import { pageGeometry } from "../src/strokes.js";
import { WITH_STROKE_HEX, ZERO_STROKE_HEX, fromHex } from "./fixtures/rm6.js";

describe("parseDeviceRm", () => {
  test("decodes paperSize and a two-point stroke", () => {
    const page = parseDeviceRm(fromHex(WITH_STROKE_HEX));
    expect(page.paperSize).toEqual([1620, 2160]);
    expect(page.blocks.map((b) => b.type)).toEqual(["sceneInfo", "sceneLineItem"]);
  });

  test("a page with no stroke block decodes to zero strokes", () => {
    const page = parseDeviceRm(fromHex(ZERO_STROKE_HEX));
    expect(page.paperSize).toEqual([1620, 2160]);
    expect(page.blocks.map((b) => b.type)).toEqual(["sceneInfo"]);
  });

  test("feeds straight into pageGeometry — the same parser get --as svg uses", () => {
    const inked = pageGeometry(parseDeviceRm(fromHex(WITH_STROKE_HEX)));
    expect(inked.strokes).toHaveLength(1);
    expect(inked.strokes[0]!.points).toHaveLength(2);
    expect(inked.paperSize).toEqual([1620, 2160]);

    const blank = pageGeometry(parseDeviceRm(fromHex(ZERO_STROKE_HEX)));
    expect(blank.strokes).toHaveLength(0);
  });

  test("too short to hold a header fails clearly", () => {
    expect(() => parseDeviceRm(new Uint8Array(10))).toThrow(/too short/);
  });

  test("a non-v6 header fails clearly rather than misreading", () => {
    const header = new TextEncoder().encode(
      "reMarkable .lines file, version=3".padEnd(43, " "),
    );
    expect(() => parseDeviceRm(header)).toThrow(/version '3'|not decoded|unsupported/i);
  });

  test("garbage bytes fail clearly rather than throwing something opaque", () => {
    const garbage = new Uint8Array(64).fill(0x41);
    expect(() => parseDeviceRm(garbage)).toThrow();
  });
});
