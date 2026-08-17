import { describe, expect, test } from "vitest";
import {
  assertUuidLike,
  backupTarCommand,
  catRmCommand,
  catThumbnailCommand,
  DEVICE_DUMP_COMMAND,
  orphanCandidates,
  parseDeviceDump,
  requireOneDeviceMatch,
  resolveDevicePath,
  type DeviceDoc,
} from "../src/device-fs.js";

/** Build one `===DOC ...===` block the way `DEVICE_DUMP_COMMAND` emits it. */
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
    for (const f of opts.rm) {
      lines.push(`${f.uuid} ${f.size ?? 0} ${f.mtime ?? 0}`);
    }
  }
  if (opts.thumbs) {
    lines.push("--THUMB--");
    for (const t of opts.thumbs) lines.push(t);
  }
  return lines.join("\n");
}

describe("parseDeviceDump", () => {
  test("parses a folder and a document with content, rm files, and thumbnails", () => {
    const dump = [
      docBlock({
        uuid: "folder-1",
        meta: { visibleName: "Daily", parent: "", type: "CollectionType" },
      }),
      docBlock({
        uuid: "doc-1",
        meta: { visibleName: "Today", parent: "folder-1", type: "DocumentType" },
        content: { cPages: { pages: [{ id: "page-1" }, { id: "page-2" }] } },
        rm: [
          { uuid: "page-1", size: 1024, mtime: 1700000000 },
          { uuid: "page-2", size: 2048, mtime: 1700000100 },
          { uuid: "page-3", size: 512, mtime: 1700000200 },
        ],
        thumbs: ["page-1", "page-2"],
      }),
    ].join("\n");

    const docs = parseDeviceDump(dump);
    expect(docs.size).toBe(2);

    const folder = docs.get("folder-1")!;
    expect(folder.visibleName).toBe("Daily");
    expect(folder.type).toBe("CollectionType");
    expect(folder.content).toBeNull();

    const doc = docs.get("doc-1")!;
    expect(doc.visibleName).toBe("Today");
    expect(doc.parent).toBe("folder-1");
    expect(doc.rmFiles).toHaveLength(3);
    expect(doc.rmFiles[0]).toEqual({ uuid: "page-1", size: 1024, mtime: 1700000000 });
    expect(doc.thumbnails.has("page-1")).toBe(true);
    expect(doc.thumbnails.has("page-3")).toBe(false);
  });

  test("a rm line whose stat fields didn't parse degrades to unknown, not dropped", () => {
    const dump = [
      "===DOC doc-1===",
      "--META--",
      JSON.stringify({ visibleName: "X", parent: "" }),
      "",
      "--RM--",
      "page-1",
      "",
    ].join("\n");
    const docs = parseDeviceDump(dump);
    const doc = docs.get("doc-1")!;
    expect(doc.rmFiles).toEqual([{ uuid: "page-1", size: null, mtime: null }]);
  });

  test("unreadable metadata JSON doesn't crash the whole dump", () => {
    const dump = ["===DOC doc-1===", "--META--", "not json", ""].join("\n");
    const docs = parseDeviceDump(dump);
    expect(docs.get("doc-1")!.visibleName).toBe("");
  });

  test("empty output parses to an empty map", () => {
    expect(parseDeviceDump("").size).toBe(0);
  });
});

describe("resolveDevicePath / requireOneDeviceMatch", () => {
  function buildDocs(): Map<string, DeviceDoc> {
    const dump = [
      docBlock({ uuid: "folder-1", meta: { visibleName: "Daily", parent: "" } }),
      docBlock({
        uuid: "doc-1",
        meta: { visibleName: "Today", parent: "folder-1" },
        content: { pages: ["page-1"] },
        rm: [{ uuid: "page-1" }],
      }),
      // A trashed document: parent is the literal "trash" per
      // specs/behaviors/device-access.md, not the folder it was trashed from.
      docBlock({
        uuid: "doc-2",
        meta: { visibleName: "Old Notes", parent: "trash" },
      }),
      // A second document colliding on the same visible name and parent.
      docBlock({
        uuid: "doc-3",
        meta: { visibleName: "Today", parent: "folder-1" },
      }),
    ].join("\n");
    return parseDeviceDump(dump);
  }

  test("resolves a normal nested path", () => {
    const docs = buildDocs();
    const matches = resolveDevicePath(docs, "/Daily/Today");
    expect(matches.map((m) => m.uuid).sort()).toEqual(["doc-1", "doc-3"]);
  });

  test("resolves a trashed document under /trash", () => {
    const docs = buildDocs();
    const matches = resolveDevicePath(docs, "/trash/Old Notes");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.uuid).toBe("doc-2");
  });

  test("requireOneDeviceMatch fails NOT_FOUND for nothing", () => {
    const docs = buildDocs();
    expect(() => requireOneDeviceMatch(docs, "/Nope")).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  test("requireOneDeviceMatch fails AMBIGUOUS listing both uuids", () => {
    const docs = buildDocs();
    try {
      requireOneDeviceMatch(docs, "/Daily/Today");
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as { code: string; suggestions: string[] };
      expect(axi.code).toBe("AMBIGUOUS");
      expect(axi.suggestions.join(" ")).toContain("doc-1".slice(0, 8));
      expect(axi.suggestions.join(" ")).toContain("doc-3".slice(0, 8));
    }
  });

  test("requireOneDeviceMatch resolves a single match", () => {
    const docs = buildDocs();
    const match = requireOneDeviceMatch(docs, "/trash/Old Notes");
    expect(match.uuid).toBe("doc-2");
  });

  test("a cycle in the parent chain resolves to no match rather than hanging", () => {
    const dump = [
      docBlock({ uuid: "a", meta: { visibleName: "A", parent: "b" } }),
      docBlock({ uuid: "b", meta: { visibleName: "B", parent: "a" } }),
    ].join("\n");
    const docs = parseDeviceDump(dump);
    expect(resolveDevicePath(docs, "/A/B")).toEqual([]);
  });
});

describe("orphanCandidates", () => {
  test("returns rm files absent from the content pages list", () => {
    const doc: DeviceDoc = {
      uuid: "doc-1",
      visibleName: "Today",
      parent: "",
      type: "DocumentType",
      content: { cPages: { pages: [{ id: "page-1" }] } },
      rmFiles: [
        { uuid: "page-1", size: 100, mtime: 1 },
        { uuid: "page-2", size: 200, mtime: 2 },
      ],
      thumbnails: new Set(),
    };
    expect(orphanCandidates(doc)).toEqual([{ uuid: "page-2", size: 200, mtime: 2 }]);
  });

  test("a document with no content page index treats every rm file as orphaned", () => {
    const doc: DeviceDoc = {
      uuid: "doc-1",
      visibleName: "Today",
      parent: "",
      type: "DocumentType",
      content: null,
      rmFiles: [{ uuid: "page-1", size: 1, mtime: 1 }],
      thumbnails: new Set(),
    };
    expect(orphanCandidates(doc)).toHaveLength(1);
  });

  test("no orphans when every rm file is indexed", () => {
    const doc: DeviceDoc = {
      uuid: "doc-1",
      visibleName: "Today",
      parent: "",
      type: "DocumentType",
      content: { pages: ["page-1"] },
      rmFiles: [{ uuid: "page-1", size: 1, mtime: 1 }],
      thumbnails: new Set(),
    };
    expect(orphanCandidates(doc)).toEqual([]);
  });
});

describe("remote command builders", () => {
  test("assertUuidLike accepts uuids and rejects shell metacharacters", () => {
    expect(() => assertUuidLike("3f9a2c-abc")).not.toThrow();
    expect(() => assertUuidLike("3f9a2c; rm -rf /")).toThrow();
    expect(() => assertUuidLike("$(whoami)")).toThrow();
  });

  test("backupTarCommand checks each entry's existence before tarring it", () => {
    const cmd = backupTarCommand("3f9a2c");
    expect(cmd).toContain("3f9a2c.metadata");
    expect(cmd).toContain('[ -d "3f9a2c" ]');
    expect(cmd).toContain('[ -d "3f9a2c.thumbnails" ]');
    expect(cmd).toContain("tar czf -");
  });

  test("backupTarCommand refuses a non-uuid-shaped id", () => {
    expect(() => backupTarCommand("3f9a2c; rm -rf /")).toThrow();
  });

  test("catRmCommand and catThumbnailCommand build the expected paths", () => {
    expect(catRmCommand("doc-1", "page-1")).toContain("doc-1/page-1.rm");
    expect(catThumbnailCommand("doc-1", "page-1")).toContain("doc-1.thumbnails/page-1.png");
  });

  test("DEVICE_DUMP_COMMAND stays inside BusyBox ash: no [[, no arrays, no here-strings", () => {
    expect(DEVICE_DUMP_COMMAND).not.toContain("[[");
    expect(DEVICE_DUMP_COMMAND).not.toContain("<<<");
  });
});
