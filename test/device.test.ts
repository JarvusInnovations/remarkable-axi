import { describe, expect, test, afterEach } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  buildSshArgs,
  execRemote,
  execRemoteBinary,
  findSsh,
  formatDocuments,
  formatStorage,
  formatXochitl,
  parseStatusOutput,
  resetSshCache,
  resolveSshTarget,
  STATUS_COMMAND,
  type BinaryRunResult,
  type RunResult,
  type SshBinaryRunner,
  type SshRunner,
} from "../src/device.js";

// ssh is a near-universal system tool (unlike Chrome/Ghostscript), so this
// suite exercises real discovery — same convention as test/chrome.test.ts and
// test/gs.test.ts — but every test that would otherwise open a connection
// replaces `execRemote`'s runner with a fake one (see the module doc comment
// in src/device.ts: "no test ever opens a real connection to a real
// tablet"). No test in this file, or anywhere else in this suite, contacts a
// real reMarkable.

describe("findSsh", () => {
  test("resolves to a working binary or null, never throws", async () => {
    const ssh = await findSsh();
    if (ssh === null) {
      expect(ssh).toBeNull();
      return;
    }
    expect(ssh.path.length).toBeGreaterThan(0);
    expect(ssh.version.length).toBeGreaterThan(0);
  });

  test("memoizes across calls", async () => {
    const first = await findSsh();
    const second = await findSsh();
    expect(second).toEqual(first);
  });

  test("REMARKABLE_AXI_SSH pointing at a nonexistent binary finds nothing", async () => {
    resetSshCache();
    const prev = process.env.REMARKABLE_AXI_SSH;
    process.env.REMARKABLE_AXI_SSH = "/no/such/ssh-binary-here";
    try {
      expect(await findSsh()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.REMARKABLE_AXI_SSH;
      else process.env.REMARKABLE_AXI_SSH = prev;
      resetSshCache();
    }
  });
});

describe("resolveSshTarget", () => {
  test("--ssh and --via each override their own field independently", () => {
    const target = resolveSshTarget(
      { ssh: "root@10.0.0.5", via: "laptop" },
      { destination: "root@192.168.1.37", via: "old-jump" },
    );
    expect(target).toEqual({ destination: "root@10.0.0.5", via: "laptop" });
  });

  test("falls back to config for whichever flag is absent", () => {
    const target = resolveSshTarget(
      {},
      { destination: "root@192.168.1.37", via: "mbp-2024" },
    );
    expect(target).toEqual({
      destination: "root@192.168.1.37",
      via: "mbp-2024",
    });
  });

  test("--ssh alone, with a configured via, keeps the configured via", () => {
    const target = resolveSshTarget(
      { ssh: "root@10.0.0.5" },
      { destination: "root@192.168.1.37", via: "mbp-2024" },
    );
    expect(target).toEqual({ destination: "root@10.0.0.5", via: "mbp-2024" });
  });

  test("no via anywhere omits the field rather than setting it undefined", () => {
    const target = resolveSshTarget(
      {},
      { destination: "root@192.168.1.37" },
    );
    expect(target).toEqual({ destination: "root@192.168.1.37" });
    expect("via" in target).toBe(false);
  });

  test("no --ssh and no config fails NO_DEVICE_SSH, naming setup ssh", () => {
    try {
      resolveSshTarget({}, undefined);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("NO_DEVICE_SSH");
      expect(axi.suggestions.join(" ")).toContain("setup ssh");
    }
  });
});

describe("buildSshArgs", () => {
  test("a direct target has no -J and carries BatchMode + ConnectTimeout", () => {
    const args = buildSshArgs({ destination: "root@192.168.1.37" }, "echo hi");
    expect(args).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=8",
      "root@192.168.1.37",
      "echo hi",
    ]);
  });

  test("a via produces a -J ProxyJump hop ahead of the destination", () => {
    const args = buildSshArgs(
      { destination: "root@192.168.1.37", via: "mbp-2024" },
      "echo hi",
    );
    expect(args).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=8",
      "-J",
      "mbp-2024",
      "root@192.168.1.37",
      "echo hi",
    ]);
  });
});

describe("execRemote", () => {
  const target = { destination: "root@192.168.1.37" };

  afterEach(() => {
    resetSshCache();
    delete process.env.REMARKABLE_AXI_SSH;
  });

  function fakeRunner(result: RunResult): SshRunner {
    return async () => result;
  }

  test("returns stdout on a clean exit", async () => {
    const stdout = await execRemote(target, "echo hi", {
      runner: fakeRunner({ stdout: "hi\n", stderr: "", code: 0 }),
    });
    expect(stdout).toBe("hi\n");
  });

  test("a nonzero exit is DEVICE_UNREACHABLE naming the destination", async () => {
    await expect(
      execRemote(target, "echo hi", {
        runner: fakeRunner({
          stdout: "",
          stderr: "ssh: connect to host 192.168.1.37 port 22: Connection refused",
          code: 255,
        }),
      }),
    ).rejects.toMatchObject({ code: "DEVICE_UNREACHABLE" });
  });

  test("a Permission denied failure gets the key-install steps", async () => {
    try {
      await execRemote(target, "echo hi", {
        runner: fakeRunner({
          stdout: "",
          stderr: "root@192.168.1.37: Permission denied (publickey,password).",
          code: 255,
        }),
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axi = error as AxiError;
      expect(axi.code).toBe("DEVICE_UNREACHABLE");
      const help = axi.suggestions.join(" ");
      expect(help).toContain("About");
      expect(help).toContain("ssh-copy-id");
      expect(help).toContain("rotates");
    }
  });

  test("a non-255 exit is REMOTE_FAILED with the remote stderr, not unreachable", async () => {
    try {
      await execRemote(
        { destination: "root@192.168.1.37" },
        "false",
        { runner: fakeRunner({ stdout: "", stderr: "ash: something: not found", code: 1 }) },
      );
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("REMOTE_FAILED");
      expect(axi.message).toContain("exit 1");
      expect(axi.message).toContain("ash: something: not found");
    }
  });

  test("a changed host key names the changed key, not a generic unreachable", async () => {
    try {
      await execRemote(
        { destination: "root@192.168.1.37" },
        "echo hi",
        {
          runner: fakeRunner({
            stdout: "",
            stderr: "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@",
            code: 255,
          }),
        },
      );
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("DEVICE_UNREACHABLE");
      expect(axi.message).toContain("host key changed");
    }
  });

  test("a runner that throws (e.g. a timeout) is also DEVICE_UNREACHABLE", async () => {
    const runner: SshRunner = async () => {
      throw new Error("ssh did not finish within 8s");
    };
    await expect(
      execRemote(target, "echo hi", { runner }),
    ).rejects.toMatchObject({ code: "DEVICE_UNREACHABLE" });
  });

  test("a via'd target names both hops in the unreachable message", async () => {
    try {
      await execRemote(
        { destination: "root@192.168.1.37", via: "mbp-2024" },
        "echo hi",
        {
          runner: fakeRunner({ stdout: "", stderr: "timed out", code: 255 }),
        },
      );
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.message).toContain("root@192.168.1.37 via mbp-2024");
    }
  });

  test("ssh binary not found is MISSING_TOOL", async () => {
    process.env.REMARKABLE_AXI_SSH = "/no/such/ssh-binary-here";
    resetSshCache();
    await expect(
      execRemote(target, "echo hi", {
        runner: fakeRunner({ stdout: "hi", stderr: "", code: 0 }),
      }),
    ).rejects.toMatchObject({ code: "MISSING_TOOL" });
  });

  test("opts.timeoutMs overrides the default 15s ceiling", async () => {
    let seenTimeout: number | undefined;
    const runner: SshRunner = async (_bin, _args, opts) => {
      seenTimeout = opts.timeoutMs;
      return { stdout: "ok", stderr: "", code: 0 };
    };
    await execRemote(target, "echo hi", { runner, timeoutMs: 60_000 });
    expect(seenTimeout).toBe(60_000);
  });
});

describe("execRemoteBinary", () => {
  const target = { destination: "root@192.168.1.37" };

  afterEach(() => {
    resetSshCache();
    delete process.env.REMARKABLE_AXI_SSH;
  });

  function fakeBinaryRunner(result: BinaryRunResult): SshBinaryRunner {
    return async () => result;
  }

  test("returns stdout as a Buffer on a clean exit — binary-safe, not decoded as text", async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x1a, 0x2b, 0x50, 0x4b]);
    const stdout = await execRemoteBinary(target, "tar czf - x", {
      runner: fakeBinaryRunner({ stdout: bytes, stderr: "", code: 0 }),
    });
    expect(Buffer.isBuffer(stdout)).toBe(true);
    expect(stdout).toEqual(bytes);
  });

  test("a nonzero exit is DEVICE_UNREACHABLE — identical translation to execRemote", async () => {
    await expect(
      execRemoteBinary(target, "tar czf - x", {
        runner: fakeBinaryRunner({
          stdout: Buffer.alloc(0),
          stderr: "ssh: connect to host 192.168.1.37 port 22: Connection refused",
          code: 255,
        }),
      }),
    ).rejects.toMatchObject({ code: "DEVICE_UNREACHABLE" });
  });

  test("a Permission denied failure gets the same key-install steps as execRemote", async () => {
    try {
      await execRemoteBinary(target, "tar czf - x", {
        runner: fakeBinaryRunner({
          stdout: Buffer.alloc(0),
          stderr: "root@192.168.1.37: Permission denied (publickey,password).",
          code: 255,
        }),
      });
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("DEVICE_UNREACHABLE");
      expect(axi.suggestions.join(" ")).toContain("ssh-copy-id");
    }
  });

  test("ssh binary not found is MISSING_TOOL", async () => {
    process.env.REMARKABLE_AXI_SSH = "/no/such/ssh-binary-here";
    resetSshCache();
    await expect(
      execRemoteBinary(target, "tar czf - x", {
        runner: fakeBinaryRunner({ stdout: Buffer.alloc(0), stderr: "", code: 0 }),
      }),
    ).rejects.toMatchObject({ code: "MISSING_TOOL" });
  });

  test("a via'd target names both hops in the unreachable message", async () => {
    try {
      await execRemoteBinary(
        { destination: "root@192.168.1.37", via: "mbp-2024" },
        "tar czf - x",
        {
          runner: fakeBinaryRunner({ stdout: Buffer.alloc(0), stderr: "timed out", code: 255 }),
        },
      );
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.message).toContain("root@192.168.1.37 via mbp-2024");
    }
  });

  test("defaults to a generous timeout, sized for a tar stream rather than a status probe", async () => {
    let seenTimeout: number | undefined;
    const runner: SshBinaryRunner = async (_bin, _args, opts) => {
      seenTimeout = opts.timeoutMs;
      return { stdout: Buffer.alloc(0), stderr: "", code: 0 };
    };
    await execRemoteBinary(target, "tar czf - x", { runner });
    expect(seenTimeout).toBeGreaterThan(15_000);
  });

  test("opts.timeoutMs still overrides the default for one call", async () => {
    let seenTimeout: number | undefined;
    const runner: SshBinaryRunner = async (_bin, _args, opts) => {
      seenTimeout = opts.timeoutMs;
      return { stdout: Buffer.alloc(0), stderr: "", code: 0 };
    };
    await execRemoteBinary(target, "tar czf - x", { runner, timeoutMs: 5_000 });
    expect(seenTimeout).toBe(5_000);
  });
});

describe("parseStatusOutput", () => {
  test("parses a clean BusyBox status block", () => {
    const stdout = [
      "XOCHITL=active",
      "VERSION=3.22.0.65",
      "STORAGE=/dev/mmcblk2p8   60828536   4348404  56480132  8% /home",
      "DOCS=691",
      "",
    ].join("\n");

    const facts = parseStatusOutput(stdout);
    expect(facts.xochitlRunning).toBe(true);
    expect(facts.xochitlState).toBe("active");
    expect(facts.version).toBe("3.22.0.65");
    expect(facts.storage).toEqual({
      totalBytes: 60828536 * 1024,
      freeBytes: 56480132 * 1024,
    });
    expect(facts.documents).toBe(691);
  });

  test("a stopped xochitl and an unknown version both degrade honestly", () => {
    const stdout = ["XOCHITL=inactive", "VERSION=unknown", "DOCS=0"].join(
      "\n",
    );

    const facts = parseStatusOutput(stdout);
    expect(facts.xochitlRunning).toBe(false);
    expect(facts.xochitlState).toBe("inactive");
    expect(facts.version).toBeNull();
    expect(facts.storage).toBeNull();
    expect(facts.documents).toBe(0);
  });

  test("garbage or missing lines parse to unknown rather than throwing", () => {
    const facts = parseStatusOutput("not the expected shape at all\n\n");
    expect(facts.xochitlState).toBe("unknown");
    expect(facts.xochitlRunning).toBe(false);
    expect(facts.version).toBeNull();
    expect(facts.storage).toBeNull();
    expect(facts.documents).toBeNull();
  });
});

describe("format helpers", () => {
  test("formatXochitl reports running with version, running alone, or the raw state", () => {
    expect(
      formatXochitl({
        xochitlState: "active",
        xochitlRunning: true,
        version: "3.22.0.65",
        storage: null,
        documents: null,
      }),
    ).toBe("running, 3.22.0.65");

    expect(
      formatXochitl({
        xochitlState: "active",
        xochitlRunning: true,
        version: null,
        storage: null,
        documents: null,
      }),
    ).toBe("running");

    expect(
      formatXochitl({
        xochitlState: "inactive",
        xochitlRunning: false,
        version: null,
        storage: null,
        documents: null,
      }),
    ).toBe("inactive");
  });

  test("formatStorage matches the spec's 4.1GB free of 58GB shape", () => {
    const gb = 1024 ** 3;
    expect(
      formatStorage({
        xochitlState: "active",
        xochitlRunning: true,
        version: null,
        storage: { totalBytes: 58 * gb, freeBytes: 4.1 * gb },
        documents: null,
      }),
    ).toBe("4.1GB free of 58GB");

    expect(
      formatStorage({
        xochitlState: "active",
        xochitlRunning: true,
        version: null,
        storage: null,
        documents: null,
      }),
    ).toBe("unknown");
  });

  test("formatDocuments matches the spec's 691 local shape", () => {
    expect(
      formatDocuments({
        xochitlState: "active",
        xochitlRunning: true,
        version: null,
        storage: null,
        documents: 691,
      }),
    ).toBe("691 local");

    expect(
      formatDocuments({
        xochitlState: "active",
        xochitlRunning: true,
        version: null,
        storage: null,
        documents: null,
      }),
    ).toBe("unknown");
  });
});

describe("STATUS_COMMAND", () => {
  test("stays inside BusyBox ash: no [[, no arrays, no bash-only constructs", () => {
    expect(STATUS_COMMAND).not.toContain("[[");
    expect(STATUS_COMMAND).not.toContain("<<<");
  });
});
