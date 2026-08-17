import { mkdtemp, readFile, rm as removeDir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AxiError } from "axi-sdk-js";
import type { SshConfig } from "../../src/config.js";
import { findGhostscript, resetGhostscriptCache } from "../../src/gs.js";
import { WITH_STROKE_HEX, ZERO_STROKE_HEX, fromHex } from "../fixtures/rm6.js";

// `setup ssh` and every `device` subcommand read/write config and open a
// connection through src/device.js — both replaced here with controllable
// stubs so these tests never touch the real config file or a real tablet,
// same convention as test/commands/devices.test.ts.

let sshConfig: SshConfig | undefined;
let targetDevice: string | undefined;
let writeConfigCalls: unknown[] = [];

vi.mock("../../src/config.js", () => ({
  readConfig: async () => ({ ssh: sshConfig, targetDevice }),
  writeConfig: async (changes: unknown) => {
    writeConfigCalls.push(changes);
    return "/fake/config/config.json";
  },
  configPath: "/fake/config/config.json",
}));

let execRemoteImpl: (...args: unknown[]) => Promise<string> = async () => "";
let execRemoteBinaryImpl: (target: unknown, command: string, opts?: unknown) => Promise<Buffer> =
  async () => Buffer.alloc(0);

/** Real ghostscript discovery, same convention as test/commands/check.test.ts
 * — the `--render` suite below is skipped entirely when it isn't installed. */
const gsForRenderTests = await findGhostscript();

vi.mock("../../src/device.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/device.js")>(
    "../../src/device.js",
  );
  return {
    ...actual,
    execRemote: (...args: unknown[]) => execRemoteImpl(...args),
    execRemoteBinary: (target: unknown, command: string, opts?: unknown) =>
      execRemoteBinaryImpl(target, command, opts),
  };
});

const { setupSsh, status, device, backup, orphans } = await import(
  "../../src/commands/device.js"
);

beforeEach(() => {
  sshConfig = undefined;
  targetDevice = undefined;
  writeConfigCalls = [];
  execRemoteImpl = async () => "";
  execRemoteBinaryImpl = async () => Buffer.alloc(0);
});

// --- shared fixture builders, matching test/device-fs.test.ts's shape for
// the same DEVICE_DUMP_COMMAND text format --------------------------------

function docBlock(opts: {
  uuid: string;
  meta: Record<string, unknown>;
  content?: Record<string, unknown>;
  rm?: { uuid: string; size?: number; mtime?: number }[];
  thumbs?: string[];
}): string {
  const lines = [`===DOC ${opts.uuid}===`, "--META--", JSON.stringify(opts.meta), ""];
  if (opts.content !== undefined) {
    lines.push("--CONTENT--", JSON.stringify(opts.content), "");
  }
  if (opts.rm) {
    lines.push("--RM--");
    for (const f of opts.rm) lines.push(`${f.uuid} ${f.size ?? 0} ${f.mtime ?? 0}`);
  }
  if (opts.thumbs) {
    lines.push("--THUMB--");
    for (const t of opts.thumbs) lines.push(t);
  }
  return lines.join("\n");
}

function dumpFor(blocks: string[]): string {
  return blocks.join("\n");
}

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
    await expect(device(["bogus"])).rejects.toMatchObject({ code: "USAGE" });
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

  test("routes `backup` through to the backup handler", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    execRemoteImpl = async () =>
      dumpFor([
        docBlock({
          uuid: "doc-1",
          meta: { visibleName: "Today", parent: "" },
          content: { pages: ["page-1"] },
          rm: [{ uuid: "page-1", size: 10, mtime: 1 }],
        }),
      ]);
    execRemoteBinaryImpl = async () => Buffer.from("tar-bytes");
    const dir = await mkdtemp(join(tmpdir(), "remarkable-axi-device-test-"));
    try {
      const out = join(dir, "out.tar.gz");
      const output = await device(["backup", "/Today", "--out", out]);
      expect((output.backup as Record<string, unknown>).uuid).toBe("doc-1");
    } finally {
      await removeDir(dir, { recursive: true, force: true });
    }
  });

  test("routes `orphans` through to the orphans handler", async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    execRemoteImpl = async () =>
      dumpFor([
        docBlock({
          uuid: "doc-1",
          meta: { visibleName: "Today", parent: "" },
          content: { pages: [] },
          rm: [],
        }),
      ]);
    const output = await device(["orphans"]);
    expect(output.orphans).toContain("clean");
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

describe("device backup", () => {
  let dir: string;

  beforeEach(async () => {
    sshConfig = { destination: "root@192.168.1.37" };
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-backup-test-"));
  });

  afterEach(async () => {
    await removeDir(dir, { recursive: true, force: true });
  });

  function oneDoc() {
    return dumpFor([
      docBlock({
        uuid: "3f9a2c",
        meta: { visibleName: "Today", parent: "folder-1" },
        content: { pages: ["page-1", "page-2", "page-3", "page-4"] },
        rm: [
          { uuid: "page-1", size: 100, mtime: 1 },
          { uuid: "page-2", size: 100, mtime: 1 },
          { uuid: "page-3", size: 100, mtime: 1 },
          { uuid: "page-4", size: 100, mtime: 1 },
          { uuid: "page-5", size: 100, mtime: 1 },
        ],
      }),
      docBlock({ uuid: "folder-1", meta: { visibleName: "Daily", parent: "", type: "CollectionType" } }),
    ]);
  }

  test("archives a document's file set and reports the orphan excess", async () => {
    execRemoteImpl = async () => oneDoc();
    let seenCommand = "";
    execRemoteBinaryImpl = async (_target: unknown, command: string) => {
      seenCommand = command;
      return Buffer.from("fake-tar-bytes");
    };

    const out = join(dir, "backup.tar.gz");
    const output = await backup(["/Daily/Today", "--out", out]);

    expect(seenCommand).toContain("tar czf -");
    expect(seenCommand).toContain("3f9a2c.metadata");
    expect(output.backup).toEqual({
      path: "/Daily/Today",
      uuid: "3f9a2c",
      archive: out,
      size: "14B",
      pages: "4 indexed, 5 stroke files (1 orphaned)",
    });
    expect((output.help as string[])[0]).toContain("--render");
    expect(await readFile(out, "utf8")).toBe("fake-tar-bytes");
  });

  test("no orphan excess omits the parenthetical and the render hint", async () => {
    execRemoteImpl = async () =>
      dumpFor([
        docBlock({
          uuid: "3f9a2c",
          meta: { visibleName: "Today", parent: "" },
          content: { pages: ["page-1"] },
          rm: [{ uuid: "page-1", size: 1, mtime: 1 }],
        }),
      ]);
    execRemoteBinaryImpl = async () => Buffer.from("x");

    const output = await backup(["/Today", "--out", join(dir, "b.tar.gz")]);
    expect((output.backup as Record<string, unknown>).pages).toBe("1 indexed, 1 stroke file");
    expect(output.help).toBeUndefined();
  });

  test("defaults the archive name to ./<name>-device-backup-<date>.tar.gz", async () => {
    execRemoteImpl = async () => oneDoc();
    execRemoteBinaryImpl = async () => Buffer.from("x");

    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const output = await backup(["/Daily/Today"]);
      const archive = (output.backup as Record<string, unknown>).archive as string;
      const today = new Date().toISOString().slice(0, 10);
      expect(archive).toBe(join(dir, `Today-device-backup-${today}.tar.gz`));
    } finally {
      process.chdir(cwd);
    }
  });

  test("refuses EXISTS when the archive is already there, honors --force", async () => {
    execRemoteImpl = async () => oneDoc();
    execRemoteBinaryImpl = async () => Buffer.from("new-bytes");

    const out = join(dir, "backup.tar.gz");
    await writeFile(out, "already here");

    await expect(backup(["/Daily/Today", "--out", out])).rejects.toMatchObject({
      code: "EXISTS",
    });

    const output = await backup(["/Daily/Today", "--out", out, "--force"]);
    expect((output.backup as Record<string, unknown>).archive).toBe(out);
    expect(await readFile(out, "utf8")).toBe("new-bytes");
  });

  test("NOT_FOUND when nothing on the device matches", async () => {
    execRemoteImpl = async () => oneDoc();
    await expect(backup(["/Nope", "--out", join(dir, "x.tar.gz")])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("AMBIGUOUS lists the colliding uuids", async () => {
    execRemoteImpl = async () =>
      dumpFor([
        docBlock({ uuid: "doc-a", meta: { visibleName: "Today", parent: "" } }),
        docBlock({ uuid: "doc-b", meta: { visibleName: "Today", parent: "" } }),
      ]);
    try {
      await backup(["/Today", "--out", join(dir, "x.tar.gz")]);
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("AMBIGUOUS");
      expect(axi.suggestions.join(" ")).toContain("doc-a");
      expect(axi.suggestions.join(" ")).toContain("doc-b");
    }
  });

  test("refuses a folder path with USAGE", async () => {
    execRemoteImpl = async () =>
      dumpFor([docBlock({ uuid: "folder-1", meta: { visibleName: "Daily", parent: "", type: "CollectionType" } })]);
    await expect(backup(["/Daily", "--out", join(dir, "x.tar.gz")])).rejects.toMatchObject({
      code: "USAGE",
    });
  });
});

describe("device orphans", () => {
  afterEach(() => {
    delete process.env.REMARKABLE_AXI_GS;
    resetGhostscriptCache();
  });

  beforeEach(() => {
    sshConfig = { destination: "root@192.168.1.37" };
  });

  function docWithOrphans() {
    return dumpFor([
      docBlock({
        uuid: "doc-1",
        meta: { visibleName: "Today", parent: "folder-1" },
        content: { pages: ["page-indexed"] },
        rm: [
          { uuid: "page-indexed", size: 1, mtime: 1 },
          { uuid: "page-inked", size: 26 * 1024, mtime: 1755426000 },
          { uuid: "page-blank", size: 200, mtime: 1755426100 },
        ],
        thumbs: ["page-inked"],
      }),
      docBlock({ uuid: "folder-1", meta: { visibleName: "Daily", parent: "", type: "CollectionType" } }),
    ]);
  }

  function rmBinaryRouter(): (target: unknown, command: string) => Promise<Buffer> {
    return async (_target, command) => {
      if (command.includes("page-inked.rm")) return Buffer.from(fromHex(WITH_STROKE_HEX));
      if (command.includes("page-blank.rm")) return Buffer.from(fromHex(ZERO_STROKE_HEX));
      if (command.includes(".thumbnails/")) return Buffer.from("fake-png-bytes");
      throw new Error(`unexpected binary command: ${command}`);
    };
  }

  test("reports a real orphan as a row and a zero-stroke file as a count only", async () => {
    execRemoteImpl = async () => docWithOrphans();
    execRemoteBinaryImpl = rmBinaryRouter();

    const output = await orphans(["/Daily/Today"]);
    expect(output.orphans).toEqual([
      {
        doc: "/Daily/Today",
        stroke: "page-inked",
        size: "26KB",
        modified: "2025-08-17 10:20",
        thumbnail: "yes",
      },
    ]);
    expect(output.zeroStroke).toBe("1 zero-stroke file excluded (opened but never drawn on)");
    expect(output.help).toEqual([
      'Run `remarkable-axi device orphans "/Daily/Today" --render` to see what each orphan holds',
      'Run `remarkable-axi device backup "/Daily/Today"` before any reattach',
    ]);
  });

  test("a document with no orphans says so explicitly", async () => {
    execRemoteImpl = async () =>
      dumpFor([
        docBlock({
          uuid: "doc-1",
          meta: { visibleName: "Today", parent: "" },
          content: { pages: ["page-1"] },
          rm: [{ uuid: "page-1", size: 1, mtime: 1 }],
        }),
      ]);
    const output = await orphans(["/Today"]);
    expect(output.orphans).toBe("clean — /Today checked, no orphaned stroke files");
    expect(output.help).toBeUndefined();
    expect(output.zeroStroke).toBeUndefined();
  });

  test("no <path> sweeps every document", async () => {
    execRemoteImpl = async () => docWithOrphans();
    execRemoteBinaryImpl = rmBinaryRouter();

    const output = await orphans([]);
    expect(output.orphans).toEqual([
      expect.objectContaining({ doc: "/Daily/Today", stroke: "page-inked" }),
    ]);
  });

  test("NOT_FOUND / AMBIGUOUS / folder-path USAGE match backup's path resolution", async () => {
    execRemoteImpl = async () => docWithOrphans();
    await expect(orphans(["/Nope"])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(orphans(["/Daily"])).rejects.toMatchObject({ code: "USAGE" });
  });

  test("--out without --render is USAGE — nothing would ever use it", async () => {
    await expect(orphans(["--out", "/tmp/somewhere"])).rejects.toMatchObject({
      code: "USAGE",
    });
  });

  test("an unreadable .rm candidate is kept as a row rather than dropped", async () => {
    execRemoteImpl = async () => docWithOrphans();
    execRemoteBinaryImpl = async (_target: unknown, command: string) => {
      if (command.includes(".thumbnails/")) return Buffer.from("png");
      throw new Error("simulated fetch failure");
    };
    const output = await orphans(["/Daily/Today"]);
    const rows = output.orphans as Record<string, unknown>[];
    expect(rows).toHaveLength(2); // both candidates kept — neither could be classified as zero-stroke
  });

  describe.skipIf(gsForRenderTests === null)("--render", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "remarkable-axi-orphans-render-test-"));
    });

    afterEach(async () => {
      await removeDir(dir, { recursive: true, force: true });
    });

    test("composites orphans to preview PNGs alongside their thumbnails, in --out", async () => {
      execRemoteImpl = async () => docWithOrphans();
      execRemoteBinaryImpl = rmBinaryRouter();

      const output = await orphans(["/Daily/Today", "--render", "--out", dir]);
      expect(output.rendered).toBe(dir);
      expect(output.help).toEqual([
        `Read the renders and thumbnails in ${dir} to eye-match each orphan before any reattach`,
        'Run `remarkable-axi device backup "/Daily/Today"` before any reattach',
      ]);

      const { readdir } = await import("node:fs/promises");
      const files = await readdir(dir);
      expect(files.some((f) => f.endsWith("-render.png"))).toBe(true);
      expect(files.some((f) => f.endsWith("-thumbnail.png"))).toBe(true);
    });

    test("ghostscript not found fails MISSING_TOOL", async () => {
      process.env.REMARKABLE_AXI_GS = "/no/such/gs-binary-here";
      resetGhostscriptCache();
      execRemoteImpl = async () => docWithOrphans();
      execRemoteBinaryImpl = rmBinaryRouter();

      await expect(
        orphans(["/Daily/Today", "--render", "--out", dir]),
      ).rejects.toMatchObject({ code: "MISSING_TOOL" });
    });
  });
});
