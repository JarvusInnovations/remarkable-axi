import { describe, expect, test } from "vitest";
import { doctor } from "../../src/commands/setup.js";
import { findGhostscript } from "../../src/gs.js";

// `doctor` reports Chrome and Ghostscript discovery in every branch it can
// return from — unpaired, paired-and-reachable, and paired-but-unreachable
// (see the comment above both discovery calls in src/commands/setup.ts) —
// so the field's presence doesn't depend on which branch this environment
// happens to be in. This sandbox has real reMarkable pairing state on disk
// (auth.ts resolves its token path at module load, so a per-test HOME
// override can't isolate it — a pre-existing constraint of that module, not
// something this test works around), so it exercises whichever branch that
// state naturally produces rather than forcing one.

describe("doctor", () => {
  test("reports ghostscript discovery alongside chrome, in whatever branch this environment reaches", async () => {
    const gs = await findGhostscript();
    const output = await doctor([]);
    const report = output.doctor as Record<string, unknown>;

    expect(report).toHaveProperty("chrome");
    expect(report).toHaveProperty("ghostscript");
    expect(typeof report.ghostscript).toBe("string");
    if (gs) expect(report.ghostscript).toContain(gs.version);
    else expect(report.ghostscript).toContain("not found");
  });
});
