import { describe, expect, test } from "vitest";
import { bleedFinding, noPageDeclarationFinding, pageBoxFinding } from "../../src/lint/geometry.js";

const DEVICE = { width: 447, height: 596 };

describe("pageBoxFinding", () => {
  test("a matching page produces no finding", () => {
    expect(pageBoxFinding(1, { width: 447, height: 596 }, DEVICE)).toBeNull();
  });

  test("a sub-epsilon difference still counts as matching — same epsilon detectPageBox uses", () => {
    expect(pageBoxFinding(1, { width: 447.2, height: 595.8 }, DEVICE)).toBeNull();
  });

  test("a differing page reports the signed delta and severity warn", () => {
    const finding = pageBoxFinding(3, { width: 612, height: 792 }, DEVICE);
    expect(finding).toMatchObject({ page: 3, severity: "warn", check: "page box" });
    expect(finding?.detail).toContain("612x792pt");
    expect(finding?.detail).toContain("165pt wider");
    expect(finding?.detail).toContain("196pt taller");
    expect(finding?.detail).toContain("447x596pt");
  });
});

describe("noPageDeclarationFinding", () => {
  test("names the page and warns about the US Letter default", () => {
    const finding = noPageDeclarationFinding(1);
    expect(finding).toMatchObject({ page: 1, severity: "warn", check: "page box" });
    expect(finding.detail).toContain("no @page declared");
    expect(finding.detail).toContain("US Letter");
  });
});

describe("bleedFinding", () => {
  test("a CropBox equal to the MediaBox produces no finding", () => {
    expect(
      bleedFinding(1, { width: 447, height: 596 }, { width: 447, height: 596 }),
    ).toBeNull();
  });

  test("a sub-epsilon difference still counts as equal", () => {
    expect(
      bleedFinding(1, { width: 447.3, height: 596 }, { width: 447, height: 596 }),
    ).toBeNull();
  });

  test("a CropBox smaller than the MediaBox reports both sizes", () => {
    const finding = bleedFinding(2, { width: 460, height: 610 }, { width: 447, height: 596 });
    expect(finding).toMatchObject({ page: 2, severity: "warn", check: "bleed" });
    expect(finding?.detail).toContain("460x610pt");
    expect(finding?.detail).toContain("447x596pt");
  });
});
