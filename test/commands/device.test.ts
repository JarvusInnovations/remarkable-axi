import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AxiError } from "axi-sdk-js";
import type { SshConfig } from "../../src/config.js";

// `setup ssh` and `device status` read/write config and open a connection
// through src/device.js — both replaced here with controllable stubs so
// these tests never touch the real config file or a real tablet, same
// convention as test/commands/devices.test.ts.

let sshConfig: SshConfig | undefined;
let writeConfigCalls: unknown[] = [];

vi.mock("../../src/config.js", () => ({
  readConfig: async () => ({ ssh: sshConfig }),
  writeConfig: async (changes: unknown) => {
    writeConfigCalls.push(changes);
    return "/fake/config/config.json";
  },
  configPath: "/fake/config/config.json",
}));

let execRemoteImpl: (...args: unknown[]) => Promise<string> = async () => "";

vi.mock("../../src/device.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/device.js")>(
    "../../src/device.js",
  );
  return {
    ...actual,
    execRemote: (...args: unknown[]) => execRemoteImpl(...args),
  };
});

const { setupSsh, status, device } = await import("../../src/commands/device.js");

beforeEach(() => {
  sshConfig = undefined;
  writeConfigCalls = [];
  execRemoteImpl = async () => "";
});

afterEach(() => {
  sshConfig = undefined;
  writeConfigCalls = [];
});

describe("setup ssh", () => {
  test("persists a direct destination with no via", async () => {
    const output = await setupSsh(["root@192.168.1.37"]);
    expect(output.ssh).toEqual({ destination: "root@192.168.1.37" });
    expect(writeConfigCalls).toEqual([
      { ssh: { destination: "root@192.168.1.37" } },
    ]);
  });

  test("--via persists a ProxyJump hop alongside the destination", async () => {
    const output = await setupSsh([
      "root@192.168.1.37",
      "--via",
      "mbp-2024",
    ]);
    expect(output.ssh).toEqual({
      destination: "root@192.168.1.37",
      via: "mbp-2024",
    });
    expect(writeConfigCalls).toEqual([
      { ssh: { destination: "root@192.168.1.37", via: "mbp-2024" } },
    ]);
  });

  test("re-running repoints — idempotent, not a refusal — and reports the previous value", async () => {
    sshConfig = { destination: "root@192.168.1.20" };
    const output = await setupSsh(["root@192.168.1.99"]);
    expect(output.ssh).toEqual({ destination: "root@192.168.1.99" });
    expect(output.previous).toBe("root@192.168.1.20");
  });

  test("re-running with the identical destination is a no-op, not a fake 'previous' change", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    const output = await setupSsh(["root@192.168.1.37"]);
    expect(output.previous).toBeUndefined();
  });

  test("missing destination fails USAGE with the usage line", async () => {
    await expect(setupSsh([])).rejects.toMatchObject({ code: "USAGE" });
  });
});

describe("device (dispatch)", () => {
  test("an unknown subcommand fails USAGE", async () => {
    await expect(device(["backup"])).rejects.toMatchObject({ code: "USAGE" });
  });

  test("no subcommand fails USAGE", async () => {
    await expect(device([])).rejects.toMatchObject({ code: "USAGE" });
  });

  test("routes `status` through to the status handler", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    execRemoteImpl = async () =>
      "XOCHITL=active\nVERSION=3.22.0.65\nSTORAGE=/dev/x 100 10 90 10% /home\nDOCS=5\n";
    const output = await device(["status"]);
    expect(output.destination).toBe("root@192.168.1.37");
  });
});

describe("device status", () => {
  test("no configured destination and no --ssh fails NO_DEVICE_SSH", async () => {
    await expect(status([])).rejects.toMatchObject({ code: "NO_DEVICE_SSH" });
  });

  test("reports the configured destination, xochitl, storage, and documents", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    execRemoteImpl = async () =>
      // total = 58 * 1024^2 KB (exactly 58GB); available = 4.1 * 1024^2 KB
      // (rounds to exactly 4.1GB) — see test/device.test.ts's formatStorage
      // test for the general shape.
      [
        "XOCHITL=active",
        "VERSION=3.22.0.65",
        "STORAGE=/dev/mmcblk2p8   60817408   56518246  4299162  93% /home",
        "DOCS=691",
      ].join("\n");

    const output = await status([]);
    expect(output.device).toBe("reachable");
    expect(output.destination).toBe("root@192.168.1.37");
    expect(output.xochitl).toBe("running, 3.22.0.65");
    expect(output.storage).toBe("4.1GB free of 58GB");
    expect(output.documents).toBe("691 local");
  });

  test("a configured via shows up in the `device` field, not `destination`", async () => {
    sshConfig = { destination: "root@192.168.1.37", via: "mbp-2024" };
    execRemoteImpl = async () => "XOCHITL=active\nDOCS=0\n";

    const output = await status([]);
    expect(output.device).toBe("reachable via mbp-2024");
    expect(output.destination).toBe("root@192.168.1.37");
  });

  test("--ssh and --via override the configured destination for one invocation", async () => {
    sshConfig = { destination: "root@192.168.1.37", via: "old-jump" };
    let seenTarget: unknown;
    execRemoteImpl = async (target: unknown) => {
      seenTarget = target;
      return "XOCHITL=active\nDOCS=0\n";
    };

    const output = await status(["--ssh", "root@10.0.0.5", "--via", "new-jump"]);
    expect(output.destination).toBe("root@10.0.0.5");
    expect(output.device).toBe("reachable via new-jump");
    expect(seenTarget).toEqual({
      destination: "root@10.0.0.5",
      via: "new-jump",
    });
  });

  test("takes no positional arguments", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    await expect(status(["/some/path"])).rejects.toMatchObject({
      code: "USAGE",
    });
  });

  test("a DEVICE_UNREACHABLE from the exec layer propagates unchanged", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    execRemoteImpl = async () => {
      throw new AxiError("could not reach root@192.168.1.37", "DEVICE_UNREACHABLE", [
        "Confirm the tablet is on",
      ]);
    };

    await expect(status([])).rejects.toMatchObject({
      code: "DEVICE_UNREACHABLE",
    });
  });
});
