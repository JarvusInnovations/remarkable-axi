import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RemarkableApi } from "rmapi-js";

// `rm()` reaches the cloud through `client()` and persists cache updates
// through `recordMutation()` — both replaced here so this test never touches
// the network or the real `~/.config/remarkable-axi/` cache on disk (this
// sandbox has real pairing state — see the comment in setup.test.ts).
let fake: RemarkableApi | null = null;
const deleted: { id: string; hash: string }[] = [];

vi.mock("../../src/auth.js", () => ({
  client: async () => {
    if (!fake) throw new Error("test forgot to configure the fake api");
    return fake;
  },
}));

vi.mock("../../src/cache.js", () => ({
  loadTree: async () => ({ entries: TREE_ENTRIES }),
  recordMutation: async () => undefined,
}));

const TREE_ENTRIES = [
  {
    id: "doc-1",
    hash: "hash-doc-1",
    type: "DocumentType" as const,
    fileType: "pdf" as const,
    visibleName: "Draft",
    pinned: false,
    parent: "",
    lastOpened: "0",
  },
  {
    id: "folder-1",
    hash: "hash-folder-1",
    type: "CollectionType" as const,
    visibleName: "Papers",
    pinned: false,
    parent: "",
  },
  {
    id: "empty-folder-1",
    hash: "hash-empty-folder-1",
    type: "CollectionType" as const,
    visibleName: "Empty",
    pinned: false,
    parent: "",
  },
  {
    id: "doc-2",
    hash: "hash-doc-2",
    type: "DocumentType" as const,
    fileType: "pdf" as const,
    visibleName: "Inside",
    pinned: false,
    parent: "folder-1",
    lastOpened: "0",
  },
];

const { rm } = await import("../../src/commands/organize.js");

function fakeApi() {
  return {
    delete: async (ref: { id: string; hash: string }) => {
      deleted.push(ref);
      return { hash: "new-root-hash" };
    },
  } as unknown as RemarkableApi;
}

beforeEach(() => {
  fake = fakeApi();
  deleted.length = 0;
});

afterEach(() => {
  fake = null;
});

describe("rm", () => {
  test("removing a document offers the put --replace one-step hint", async () => {
    const output = await rm(["/Draft"]);
    expect(output.trashed).toEqual({ name: "Draft", path: "/Draft" });
    expect(output.help).toEqual([
      "Restore it from the trash on the device if this was a mistake",
      "Replacing it? Run `remarkable-axi put <src> /Draft --replace` to do this in one safe motion",
    ]);
    expect(deleted).toEqual([{ id: "doc-1", hash: "hash-doc-1" }]);
  });

  test("removing an empty folder does not offer the replace hint", async () => {
    const output = await rm(["/Empty"]);
    expect(output.trashed).toEqual({ name: "Empty", path: "/Empty" });
    expect(output.help).toEqual([
      "Restore it from the trash on the device if this was a mistake",
    ]);
  });

  test("removing a non-empty folder with --force does not offer the replace hint either", async () => {
    const output = await rm(["/Papers", "--force"]);
    expect(output.trashed).toEqual({ name: "Papers", path: "/Papers" });
    expect(
      (output.help as string[]).some((line) => line.includes("--replace")),
    ).toBe(false);
  });
});
