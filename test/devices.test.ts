import { describe, expect, test } from "vitest";
import {
  MODELS,
  acceptedNames,
  allSpecs,
  resolveModel,
  spec,
} from "../src/devices.js";

describe("resolveModel", () => {
  test("accepts model codes case-insensitively", () => {
    expect(resolveModel("RM110")).toBe("RM110");
    expect(resolveModel("rm110")).toBe("RM110");
    expect(resolveModel("  Rm110 ")).toBe("RM110");
  });

  test("accepts friendly aliases", () => {
    // Nobody thinks in model codes; an agent told to target "the Paper Pro"
    // should not have to look up RM02A.
    expect(resolveModel("paper-pro")).toBe("RM02A");
    expect(resolveModel("Paper Pro")).toBe("RM02A");
    expect(resolveModel("rm2")).toBe("RM110");
    expect(resolveModel("move")).toBe("RM03A");
    expect(resolveModel("pure")).toBe("RM102");
  });

  test("rejects unknown names rather than guessing", () => {
    expect(resolveModel("rm9")).toBeNull();
    expect(resolveModel("")).toBeNull();
    expect(resolveModel("ipad")).toBeNull();
  });

  test("every accepted name resolves", () => {
    for (const name of acceptedNames()) {
      expect(resolveModel(name), name).not.toBeNull();
    }
  });
});

describe("spec", () => {
  test("derives page size in points, not pixels", () => {
    // The number that matters when generating a PDF: sizing a page to the
    // panel's pixels yields something several times too large, since points
    // are 1/72in against a 229dpi screen.
    const pro = spec("RM02A");
    expect(pro.screen).toBe("1620x2160");
    expect(pro.dpi).toBe(229);
    expect(pro.pagePt).toBe("509x679pt");
    expect(pro.physical).toBe("7.1x9.4in");
  });

  test("reports aspect ratio in lowest terms", () => {
    expect(spec("RM110").aspect).toBe("3:4");
    // The Paper Pro Move is the one model that is not 3:4.
    expect(spec("RM03A").aspect).toBe("9:16");
  });

  test("carries the marketing name, not just the code", () => {
    expect(spec("RM100").name).toBe("reMarkable 1");
    expect(spec("RM03A").name).toBe("reMarkable Paper Pro Move");
  });
});

describe("allSpecs", () => {
  test("covers every known model exactly once", () => {
    const specs = allSpecs();
    expect(specs).toHaveLength(MODELS.length);
    expect(specs.map((s) => s.model).sort()).toEqual([...MODELS].sort());
  });

  test("every model yields a usable page size", () => {
    for (const s of allSpecs()) {
      expect(s.pagePt, s.model).toMatch(/^\d+x\d+pt$/);
      expect(s.dpi, s.model).toBeGreaterThan(0);
    }
  });
});
