import { describe, expect, test } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  MODELS,
  acceptedNames,
  allSpecs,
  calibration,
  calibrationLabel,
  pageBox,
  pageBoxCaveat,
  resolveModel,
  resolveTarget,
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

describe("pageBox", () => {
  test("derives whole points from pixels at the model's density", () => {
    // 1404x1872 @ 226dpi -> 447.15...x596.07...pt, rounded because Chrome
    // rounds its print box to integer points.
    expect(pageBox("RM110")).toEqual({ width: 447, height: 596 });
  });

  test("landscape transposes the box and nothing else", () => {
    const portrait = pageBox("RM110");
    const landscape = pageBox("RM110", { landscape: true });
    expect(landscape).toEqual({ width: portrait.height, height: portrait.width });
  });

  test("agrees with the string form spec() reports", () => {
    for (const model of MODELS) {
      const box = pageBox(model);
      expect(spec(model).pagePt).toBe(`${box.width}x${box.height}pt`);
    }
  });
});

describe("resolveTarget", () => {
  test("an explicit --device wins over the configured target", () => {
    expect(resolveTarget("rm2", "RM02A")).toBe("RM110");
  });

  test("falls back to the configured target when nothing is explicit", () => {
    expect(resolveTarget(undefined, "RM02A")).toBe("RM02A");
  });

  test("fails NO_DEVICE, listing the models, when neither is set", () => {
    try {
      resolveTarget(undefined, undefined);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("NO_DEVICE");
      expect(axi.suggestions.join(" ")).toContain("setup device");
      for (const model of MODELS) {
        expect(axi.suggestions.join(" ")).toContain(model);
      }
    }
  });

  test("an unresolvable --device fails USAGE rather than falling back", () => {
    try {
      resolveTarget("not-a-real-device", "RM02A");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("USAGE");
    }
  });
});

describe("calibration", () => {
  test("only RM02A is calibrated on every axis", () => {
    expect(calibration("RM02A")).toEqual({
      pageBox: "calibrated",
      inkPlacement: "calibrated",
      palette: "calibrated",
    });
  });

  test("RM110 and RM100 are monochrome, so their palette is n/a not unverified", () => {
    expect(calibration("RM110").palette).toBe("n/a");
    expect(calibration("RM100").palette).toBe("n/a");
  });

  test("RM03A and RM102 carry colour pens with no mapping established yet", () => {
    expect(calibration("RM03A").palette).toBe("unverified");
    expect(calibration("RM102").palette).toBe("unverified");
  });

  test("RM110's page box is verified on hardware, its ink placement is not", () => {
    // Confirmed by the fit-to-width/fit-to-height toggle showing zero shift
    // (issue #10). Axes land independently, so this model is genuinely part
    // way through rather than either fully done or untouched.
    expect(calibration("RM110").pageBox).toBe("calibrated");
    expect(calibration("RM110").inkPlacement).toBe("unverified");
  });

  test("ink placement is only measured on the model it was measured on", () => {
    for (const model of MODELS) {
      if (model === "RM02A") continue;
      expect(calibration(model).inkPlacement, model).toBe("unverified");
    }
  });

  test("models nobody has measured are unverified on every axis they can have", () => {
    for (const model of ["RM100", "RM03A", "RM102"] as const) {
      expect(calibration(model).pageBox, model).toBe("unverified");
      expect(calibration(model).inkPlacement, model).toBe("unverified");
    }
  });
});

describe("calibrationLabel", () => {
  test("RM02A reads calibrated", () => {
    expect(calibrationLabel("RM02A")).toBe("calibrated");
  });

  test("a part-way model names the axis that is real, not just 'unverified'", () => {
    // Collapsing a partial result back to "unverified" would hide a
    // contributor's measurement and invite someone to take it twice.
    expect(calibrationLabel("RM110")).toBe("page box verified");
  });

  test("models nobody has measured read unverified (published specs)", () => {
    for (const model of ["RM100", "RM03A", "RM102"] as const) {
      expect(calibrationLabel(model), model).toBe(
        "unverified (published specs)",
      );
    }
  });
});

describe("pageBoxCaveat", () => {
  test("null for the calibrated model", () => {
    expect(pageBoxCaveat("RM02A")).toBeNull();
  });

  test("null for RM110 too, whose page box was verified on hardware", () => {
    expect(pageBoxCaveat("RM110")).toBeNull();
  });

  test("states the page box is unverified for the models nobody has measured", () => {
    for (const model of ["RM100", "RM03A", "RM102"] as const) {
      expect(pageBoxCaveat(model), model).toBe(
        "page box unverified, derived from published specs",
      );
    }
  });
});
