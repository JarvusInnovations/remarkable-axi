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
    // Same visibleName as the root's "Draft", one folder down — the setup a
    // plain `mv /Draft /Papers` would collide with.
    id: "doc-3",
    hash: "hash-doc-3",
    type: "DocumentType" as const,
    fileType: "pdf" as const,
    visibleName: "Draft",
    pinned: false,
    parent: "folder-1",
    lastOpened: "0",
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

const { rm, mv } = await import("../../src/commands/organize.js");

const renamed: { id: string; name: string }[] = [];
const movedTo: { id: string; parent: string }[] = [];

function fakeApi() {
  return {
    delete: async (ref: { id: string; hash: string }) => {
      deleted.push(ref);
      return { hash: "new-root-hash" };
    },
    rename: async (ref: { id: string; hash: string }, name: string) => {
      renamed.push({ id: ref.id, name });
      return { id: ref.id, hash: `renamed-${ref.id}` };
    },
    move: async (ref: { id: string; hash: string }, parent: string) => {
      movedTo.push({ id: ref.id, parent });
      return { id: ref.id, hash: `moved-${ref.id}` };
    },
  } as unknown as RemarkableApi;
}

beforeEach(() => {
  fake = fakeApi();
  deleted.length = 0;
  renamed.length = 0;
  movedTo.length = 0;
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
      'Replacing it? Run `remarkable-axi put <src> "/Draft" --replace` to do this in one safe motion',
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

describe("mv --name", () => {
  test("moves and renames in one call", async () => {
    const output = await mv(["/Draft", "/Papers", "--name", "2026-W34"]);
    expect(output.moved).toEqual({
      name: "2026-W34",
      was: "Draft",
      from: "/Draft",
      to: "/Papers/2026-W34",
    });
    expect(renamed).toEqual([{ id: "doc-1", name: "2026-W34" }]);
    expect(movedTo).toEqual([{ id: "doc-1", parent: "folder-1" }]);
  });

  // The reason the flag exists rather than a positional target: renaming in
  // place is a real operation, and it must not be mistaken for a no-op.
  test("renames in place when the folder is unchanged", async () => {
    const output = await mv(["/Draft", "/", "--name", "Draft v2"]);
    expect(output.moved).toMatchObject({ name: "Draft v2", was: "Draft" });
    expect(renamed).toEqual([{ id: "doc-1", name: "Draft v2" }]);
    expect(movedTo).toEqual([]); // already there — no move issued
  });

  test("a same-folder move with no new name is still a no-op", async () => {
    const output = await mv(["/Draft", "/"]);
    expect(String(output.moved)).toContain("no-op");
    expect(renamed).toEqual([]);
    expect(movedTo).toEqual([]);
  });

  // A move carries a name the user may not have in mind into a folder they
  // cannot see — the easiest accidental duplicate there is.
  test("refuses an occupied landing path and moves nothing", async () => {
    await expect(mv(["/Draft", "/Papers", "--name", "Inside"])).rejects.toMatchObject({
      code: "EXISTS",
      message: "/Papers/Inside already exists (doc-2)",
    });
    expect(renamed).toEqual([]);
    expect(movedTo).toEqual([]);
  });

  // The guard mv never had: before this, the move succeeded and left two
  // documents at one path, a state every other command refuses to resolve.
  test("refuses a plain move whose own name is taken at the destination", async () => {
    await expect(mv(["/Draft", "/Papers"])).rejects.toMatchObject({
      code: "EXISTS",
      message: "/Papers/Draft already exists (doc-3)",
    });
    expect(movedTo).toEqual([]);
  });

  test("a free landing path still moves", async () => {
    await expect(mv(["/Draft", "/Empty"])).resolves.toMatchObject({
      moved: { name: "Draft", to: "/Empty/Draft" },
    });
    expect(movedTo).toEqual([{ id: "doc-1", parent: "empty-folder-1" }]);
  });
});
