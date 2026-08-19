import { describe, expect, it } from "vitest";
import { planCarry, summarizeCarry, type PageBox } from "../src/ink-carry.js";

const box = (w: number, h: number): PageBox => ({ width: w, height: h });
const A4 = box(509, 679);

describe("planCarry", () => {
  it("ports every inked page when the replacement is the same length", () => {
    const plan = planCarry([0, 2], 3, [A4, A4, A4], [A4, A4, A4]);
    expect(plan.ported).toEqual([0, 2]);
    expect(plan.complete).toBe(true);
  });

  // The scroll case: yesterday's pages keep their ink, the appended page
  // arrives clean — no special handling, which is why matching is by index.
  it("ports existing pages when the replacement appends", () => {
    const plan = planCarry([0, 1], 4, [A4, A4], [A4, A4, A4, A4]);
    expect(plan.ported).toEqual([0, 1]);
    expect(plan.complete).toBe(true);
  });

  it("orphans ink past the end of a shorter replacement", () => {
    const plan = planCarry([0, 3], 2, [A4, A4, A4, A4], [A4, A4]);
    expect(plan.ported).toEqual([0]);
    expect(plan.complete).toBe(false);
    const orphan = plan.outcomes.find((o) => o.index === 3)!;
    expect(orphan.disposition).toBe("orphaned");
    expect(orphan.reason).toContain("only 2 pages");
  });

  // Ink is positioned in page-relative coordinates, so replaying it onto a
  // reshaped page would misplace it — refuse rather than guess.
  it("skips a page whose box changed", () => {
    const plan = planCarry([0], 1, [A4], [box(679, 509)]);
    expect(plan.ported).toEqual([]);
    expect(plan.complete).toBe(false);
    expect(plan.outcomes[0]!.disposition).toBe("skipped");
    expect(plan.outcomes[0]!.reason).toContain("509x679 → 679x509");
  });

  it("treats an unknown box as no evidence of a mismatch", () => {
    const plan = planCarry([0], 1, [], []);
    expect(plan.ported).toEqual([0]);
    expect(plan.complete).toBe(true);
  });

  it("is not complete when there was no ink to carry", () => {
    expect(planCarry([], 3).complete).toBe(false);
  });

  it("sorts outcomes by page order regardless of input order", () => {
    const plan = planCarry([2, 0, 1], 3);
    expect(plan.outcomes.map((o) => o.index)).toEqual([0, 1, 2]);
  });
});

describe("summarizeCarry", () => {
  it("reports 1-based page numbers", () => {
    const summary = summarizeCarry(planCarry([0, 1], 3, [A4, A4], [A4, A4, A4]));
    expect(summary).toEqual({ ported: 2, pages: "1,2" });
  });

  it("names what did not make it, and why", () => {
    const summary = summarizeCarry(planCarry([0, 2], 1, [A4, A4, A4], [A4]));
    expect(summary.ported).toBe(1);
    expect((summary.orphaned as string[])[0]).toContain("page 3");
  });
});
