import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SshConfig } from "../../src/config.js";

// `doctor`'s ssh/device reporting reads config and opens a connection through
// src/device.js — both replaced here, same convention as
// test/commands/device.test.ts, so this suite never touches the real config
// file or a real tablet. `readToken` is also forced to "not paired" so
// `doctor` never reaches `client()` and its real network call — chrome,
// ghostscript, ssh, and the device block are all reported in that branch
// too (see the comment above their discovery calls in
// src/commands/setup.ts), so it's a safe, deterministic branch to assert
// them from; pairing state itself is out of scope for this suite.

let sshConfig: SshConfig | undefined;
let execRemoteImpl: (...args: unknown[]) => Promise<string> = async () => "";

vi.mock("../../src/auth.js", () => ({
  readToken: async () => null,
  tokenPath: "/fake/config/token",
  client: async () => {
    throw new Error("doctor-device.test.ts: client() must not be called");
  },
}));

vi.mock("../../src/config.js", () => ({
  readConfig: async () => ({ ssh: sshConfig }),
  writeConfig: async () => "/fake/config/config.json",
  configPath: "/fake/config/config.json",
}));

vi.mock("../../src/device.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/device.js")>(
    "../../src/device.js",
  );
  return {
    ...actual,
    execRemote: (...args: unknown[]) => execRemoteImpl(...args),
  };
});

const { doctor } = await import("../../src/commands/setup.js");

beforeEach(() => {
  sshConfig = undefined;
  execRemoteImpl = async () => "";
});

afterEach(() => {
  sshConfig = undefined;
});

describe("doctor — ssh and device", () => {
  test("reports ssh discovery even with no destination configured, and omits `device`", async () => {
    const output = await doctor([]);
    const report = output.doctor as Record<string, unknown>;
    expect(report).toHaveProperty("ssh");
    expect(typeof report.ssh).toBe("string");
    expect(report).not.toHaveProperty("device");
  });

  test("a configured, reachable destination reports the full device block", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    execRemoteImpl = async () =>
      "XOCHITL=active\nVERSION=3.22.0.65\nDOCS=691\n";

    const output = await doctor([]);
    const report = output.doctor as Record<string, unknown>;
    const device = report.device as Record<string, unknown>;
    expect(device.destination).toBe("root@192.168.1.37");
    expect(device.reachable).toBe("yes");
    expect(device.xochitl).toBe("running, 3.22.0.65");
  });

  test("an unreachable device is reported, and does not fail doctor", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    execRemoteImpl = async () => {
      throw new Error("could not reach root@192.168.1.37");
    };

    const output = await doctor([]);
    const report = output.doctor as Record<string, unknown>;
    const device = report.device as Record<string, unknown>;
    expect(device.reachable).toBe("no");
    expect(device.error).toContain("could not reach");
  });
});
