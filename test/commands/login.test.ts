import { describe, expect, test, vi } from "vitest";
import { AxiError } from "axi-sdk-js";

// `login()` reaches the cloud through `register()` and persists the token
// through `writeToken()` — both replaced here so this test never touches the
// network or the real `~/.config/remarkable-axi/token` on disk (this sandbox
// has real pairing state — see the comment in setup.test.ts).
vi.mock("rmapi-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("rmapi-js")>()),
  register: async (code: string) => {
    if (code === "bad00bad") throw new Error("invalid code");
    return `token-for-${code}`;
  },
}));

vi.mock("../../src/auth.js", () => ({
  writeToken: async (_token: string) => "/fake/config/token",
}));

const { login } = await import("../../src/commands/setup.js");

describe("login", () => {
  test("success hints setup device, ahead of setup hooks", async () => {
    const output = await login(["abcd1234"]);
    expect(output.paired).toEqual({
      account: "reMarkable cloud",
      token: "/fake/config/token",
    });
    expect(output.help).toContain(
      "Run `remarkable-axi setup device <model>` to set the device to design for",
    );
    const help = output.help as string[];
    expect(help.indexOf("Run `remarkable-axi setup device <model>` to set the device to design for")).toBeLessThan(
      help.indexOf("Run `remarkable-axi setup hooks` so agents see tablet state automatically"),
    );
  });

  test("a malformed code still fails USAGE before ever reaching the network", async () => {
    try {
      await login(["nope"]);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("USAGE");
    }
  });
});
