import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DeviceModel } from "../../src/devices.js";

// `devices()` reads the stored target through `readConfig()` — replaced here
// with a controllable stub so these tests never touch the real config file
// on disk (this sandbox has real pairing/config state — see the comment in
// setup.test.ts).
let target: DeviceModel | undefined;

vi.mock("../../src/config.js", () => ({
  readConfig: async () => ({ targetDevice: target }),
  writeConfig: async () => "/fake/config/config.json",
  configPath: "/fake/config/config.json",
}));

const { devices } = await import("../../src/commands/devices.js");

beforeEach(() => {
  target = undefined;
});

afterEach(() => {
  target = undefined;
});

describe("devices command", () => {
  test("the calibration hint is self-contained — no repo-internal path", async () => {
    const output = await devices([]);
    const help = (output.help as string[]).join("\n");
    expect(help).not.toContain("specs/");
    expect(help).toContain(
      "`calibration` is `calibrated` only where the numbers were measured on real hardware; other models carry declared specs",
    );
  });

  test("with no target set, the hint says the target isn't showing yet", async () => {
    const output = await devices([]);
    expect(output.target).toBe("not set");
    expect((output.help as string[])[0]).toBe(
      "Run `remarkable-axi setup device <model>` so the target shows in every session",
    );
  });

  test("with a target set, the hint offers to change it", async () => {
    target = "RM110";
    const output = await devices([]);
    expect(output.target).toBe("reMarkable 2");
    expect((output.help as string[])[0]).toBe(
      "Run `remarkable-axi setup device <model>` to change the target",
    );
  });
});
