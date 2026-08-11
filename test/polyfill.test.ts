import { describe, expect, test } from "vitest";
import "../src/polyfill.js";

// The shim only installs when the runtime lacks these, so on a modern runtime
// this suite exercises the native implementation and on an older one the shim.
// Either way the asserted contract is the one rmapi-js relies on.
interface HexArray extends Uint8Array {
  toHex(): string;
}
const hex = (bytes: number[]) => (new Uint8Array(bytes) as HexArray).toHex();
const fromHex = (s: string) =>
  (Uint8Array as unknown as { fromHex(input: string): Uint8Array }).fromHex(s);

describe("toHex", () => {
  test("produces lowercase, zero-padded output", () => {
    expect(hex([0x00, 0x0f, 0xff, 0xa5])).toBe("000fffa5");
  });

  test("handles an empty array", () => {
    expect(hex([])).toBe("");
  });

  test("covers every byte value", () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    const out = hex(all);
    expect(out).toHaveLength(512);
    expect(out.slice(0, 6)).toBe("000102");
    expect(out.slice(-6)).toBe("fdfeff");
  });

  test("matches a SHA-256 digest rendered by node's crypto", async () => {
    // This is the exact shape rmapi-js computes when uploading.
    const data = new TextEncoder().encode("remarkable-axi");
    const digest = await crypto.subtle.digest("SHA-256", data);
    const viaHex = (new Uint8Array(digest) as HexArray).toHex();
    const { createHash } = await import("node:crypto");
    expect(viaHex).toBe(createHash("sha256").update(data).digest("hex"));
  });
});

describe("fromHex", () => {
  test("round-trips with toHex", () => {
    const original = "000fffa5deadbeef";
    expect((fromHex(original) as HexArray).toHex()).toBe(original);
  });

  test("accepts uppercase input", () => {
    expect([...fromHex("ABCDEF")]).toEqual([0xab, 0xcd, 0xef]);
  });

  test("handles an empty string", () => {
    expect([...fromHex("")]).toEqual([]);
  });

  test("rejects an odd number of characters", () => {
    expect(() => fromHex("abc")).toThrow();
  });

  test("rejects non-hex characters rather than coercing them", () => {
    // parseInt would happily read "zz" as NaN and produce a zero byte, which
    // would corrupt a hash silently.
    expect(() => fromHex("zz")).toThrow();
    expect(() => fromHex("00gg")).toThrow();
  });
});
