import { describe, expect, test } from "vitest";
import { age, parseTimestamp, recencyKey } from "../src/time.js";

// A fixed "now" so these never depend on when the suite runs.
const NOW = Date.parse("2026-08-09T12:00:00Z");
const hoursAgo = (h: number) => String(NOW - h * 3600_000);

describe("parseTimestamp", () => {
  test("parses epoch milliseconds in a string", () => {
    // This is the shape the cloud actually returns. `new Date("1738362000000")`
    // is an Invalid Date, which is what made every timestamp read "unknown".
    expect(parseTimestamp("1738362000000")).toBe(1738362000000);
  });

  test("parses an ISO timestamp", () => {
    expect(parseTimestamp("2026-01-01T00:00:00Z")).toBe(
      Date.parse("2026-01-01T00:00:00Z"),
    );
  });

  test("treats absent or blank values as unknown", () => {
    // Items written by third-party tools omit the field entirely.
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("   ")).toBeNull();
  });

  test("treats unparseable values as unknown rather than NaN", () => {
    expect(parseTimestamp("not a date")).toBeNull();
  });

  test("tolerates surrounding whitespace", () => {
    expect(parseTimestamp(" 1738362000000 ")).toBe(1738362000000);
  });
});

describe("age", () => {
  test("renders epoch-millisecond strings, not just ISO", () => {
    expect(age(hoursAgo(2), NOW)).toBe("2h ago");
    expect(age(String(NOW - 30 * 60_000), NOW)).toBe("30m ago");
    expect(age(String(NOW - 3 * 86_400_000), NOW)).toBe("3d ago");
  });

  test("renders ISO input equivalently", () => {
    expect(age("2026-08-09T10:00:00Z", NOW)).toBe("2h ago");
  });

  test("collapses sub-minute and future values to 'just now'", () => {
    expect(age(String(NOW - 5_000), NOW)).toBe("just now");
    // Clock skew between the device and this machine shouldn't render as a
    // negative age.
    expect(age(String(NOW + 60_000), NOW)).toBe("just now");
  });

  test("falls back to 'unknown' instead of 'NaN ago'", () => {
    expect(age(undefined, NOW)).toBe("unknown");
    expect(age("", NOW)).toBe("unknown");
    expect(age("garbage", NOW)).toBe("unknown");
  });

  test("switches to years past 365 days", () => {
    expect(age(String(NOW - 400 * 86_400_000), NOW)).toBe("1y ago");
  });
});

describe("recencyKey", () => {
  test("orders newer before older", () => {
    const newer = recencyKey(hoursAgo(1));
    const older = recencyKey(hoursAgo(5));
    expect(newer).toBeGreaterThan(older);
  });

  test("sorts undated items last rather than randomly", () => {
    // Sorting on `new Date(...)` produced NaN comparisons, which left the
    // home view's "recent" list in arbitrary order.
    const items = [undefined, hoursAgo(5), undefined, hoursAgo(1)];
    const sorted = [...items].sort((a, b) => recencyKey(b) - recencyKey(a));
    expect(sorted[0]).toBe(hoursAgo(1));
    expect(sorted[1]).toBe(hoursAgo(5));
    expect(sorted.slice(2)).toEqual([undefined, undefined]);
  });
});
