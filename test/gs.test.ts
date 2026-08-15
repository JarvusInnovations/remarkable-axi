import { describe, expect, test } from "vitest";
import { findGhostscript, resetGhostscriptCache } from "../src/gs.js";

// Ghostscript is an optional external dependency (specs/architecture.md), so
// this suite must be able to pass on a machine with none installed, just
// like the tool itself degrades to a structured MISSING_TOOL rather than
// failing to start — same convention as test/chrome.test.ts.
const gs = await findGhostscript();

describe("findGhostscript", () => {
  test("resolves to either a working binary or null, never throws", () => {
    if (gs === null) {
      expect(gs).toBeNull();
      return;
    }
    expect(gs.path.length).toBeGreaterThan(0);
    expect(gs.version.length).toBeGreaterThan(0);
  });

  test("memoizes across calls", async () => {
    const again = await findGhostscript();
    expect(again).toEqual(gs);
  });

  test("REMARKABLE_AXI_GS pointing at a nonexistent binary finds nothing", async () => {
    resetGhostscriptCache();
    const prev = process.env.REMARKABLE_AXI_GS;
    process.env.REMARKABLE_AXI_GS = "/no/such/gs-binary-here";
    try {
      expect(await findGhostscript()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.REMARKABLE_AXI_GS;
      else process.env.REMARKABLE_AXI_GS = prev;
      resetGhostscriptCache();
    }
  });
});
