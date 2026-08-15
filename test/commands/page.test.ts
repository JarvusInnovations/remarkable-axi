import { describe, expect, test } from "vitest";
import { AxiError } from "axi-sdk-js";
import { page } from "../../src/commands/page.js";
import { cssBlock } from "../../src/page.js";

// Every case here passes --device explicitly, so the command never reads
// (or writes) the config file — these tests are hermetic regardless of the
// developer's real `remarkable-axi setup device` state.

describe("page command", () => {
  test("reports device, screen, density, and page box for a calibrated target", async () => {
    const output = await page(["--device", "paper-pro"]);
    expect(output.device).toBe("RM02A (reMarkable Paper Pro)");
    expect(output.screen).toBe("1620x2160 @ 229dpi");
    expect(output.page).toBe("509x679pt");
    expect(output.css).toBeUndefined();
  });

  test("states the calibration caveat once for an unverified target", async () => {
    const output = await page(["--device", "rm2"]);
    expect(output.device).toBe(
      "RM110 (reMarkable 2) — page box unverified, derived from published specs",
    );
    // Stated exactly once — not folded into every field.
    expect(String(output.screen)).not.toContain("unverified");
    expect(String(output.page)).not.toContain("unverified");
  });

  test("--landscape transposes the box and nothing else", async () => {
    const portrait = await page(["--device", "rm2"]);
    const landscape = await page(["--device", "rm2", "--landscape"]);
    expect(landscape.page).toBe("596x447pt");
    expect(landscape.device).toBe(portrait.device);
    expect(landscape.screen).toBe(portrait.screen);
  });

  test("--css emits the block for the resolved (and possibly transposed) box", async () => {
    const output = await page(["--device", "rm2", "--css"]);
    expect(output.css).toBe(cssBlock({ width: 447, height: 596 }));

    const landscapeCss = await page(["--device", "rm2", "--landscape", "--css"]);
    expect(landscapeCss.css).toBe(cssBlock({ width: 596, height: 447 }));
  });

  test("--device overrides per invocation without requiring stored config", async () => {
    // No config is read or written anywhere in this command when --device is
    // supplied; if it were, an unrelated developer's stored target could
    // leak into this assertion.
    const output = await page(["--device", "RM100"]);
    expect(output.device).toContain("RM100");
  });

  test("an unknown --device fails USAGE, listing accepted names", async () => {
    try {
      await page(["--device", "not-a-real-device"]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("USAGE");
      expect(axi.suggestions.join(" ")).toContain("Accepted:");
    }
  });

  test("an unknown flag fails rather than being silently ignored", async () => {
    try {
      await page(["--bogus"]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("UNKNOWN_FLAG");
    }
  });
});
