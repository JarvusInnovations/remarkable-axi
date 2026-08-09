import { describe, expect, test } from "vitest";
import type { Entry } from "rmapi-js";
import {
  baseName,
  buildTree,
  listChildren,
  lookup,
  mkdirp,
  normalizePath,
  parentPath,
  resolveParentId,
  segments,
} from "../src/paths.js";

function folder(id: string, name: string, parent = ""): Entry {
  return {
    id,
    hash: `hash-${id}`,
    type: "CollectionType",
    visibleName: name,
    lastModified: "2026-01-01T00:00:00Z",
    pinned: false,
    parent,
  } as Entry;
}

function doc(id: string, name: string, parent = ""): Entry {
  return {
    id,
    hash: `hash-${id}`,
    type: "DocumentType",
    fileType: "pdf",
    visibleName: name,
    lastModified: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
    pinned: false,
    parent,
  } as Entry;
}

describe("normalizePath", () => {
  test("collapses empty and root forms", () => {
    for (const input of ["", "/", "//", "///"]) {
      expect(normalizePath(input)).toBe("/");
    }
  });

  test("adds a leading slash and strips a trailing one", () => {
    expect(normalizePath("Books")).toBe("/Books");
    expect(normalizePath("/Books/")).toBe("/Books");
    expect(normalizePath("Books/Papers/")).toBe("/Books/Papers");
  });

  test("collapses repeated separators", () => {
    expect(normalizePath("/Books//Papers")).toBe("/Books/Papers");
  });
});

describe("segments / parentPath / baseName", () => {
  test("root has no segments", () => {
    expect(segments("/")).toEqual([]);
    expect(baseName("/")).toBe("");
  });

  test("splits and walks up", () => {
    expect(segments("/a/b/c")).toEqual(["a", "b", "c"]);
    expect(parentPath("/a/b/c")).toBe("/a/b");
    expect(parentPath("/a")).toBe("/");
    expect(baseName("/a/b")).toBe("b");
  });
});

describe("buildTree", () => {
  test("resolves nested paths from flat parent pointers", () => {
    const tree = buildTree([
      folder("f1", "Books"),
      folder("f2", "Papers", "f1"),
      doc("d1", "Thesis", "f2"),
    ]);

    expect(lookup(tree, "/Books")?.entry.id).toBe("f1");
    expect(lookup(tree, "/Books/Papers")?.entry.id).toBe("f2");
    expect(lookup(tree, "/Books/Papers/Thesis")?.entry.id).toBe("d1");
  });

  test("resolves regardless of listing order", () => {
    // The API gives no ordering guarantee, so a child may precede its parent.
    const tree = buildTree([
      doc("d1", "Thesis", "f2"),
      folder("f2", "Papers", "f1"),
      folder("f1", "Books"),
    ]);
    expect(lookup(tree, "/Books/Papers/Thesis")?.entry.id).toBe("d1");
  });

  test("excludes trashed entries", () => {
    const tree = buildTree([doc("d1", "Deleted", "trash")]);
    expect(lookup(tree, "/Deleted")).toBeNull();
    expect(tree.byId.size).toBe(0);
  });

  test("excludes entries orphaned under a missing parent", () => {
    const tree = buildTree([doc("d1", "Lost", "nonexistent")]);
    expect(tree.byId.size).toBe(0);
  });

  test("survives a parent cycle without hanging", () => {
    const tree = buildTree([
      folder("a", "A", "b"),
      folder("b", "B", "a"),
      doc("d1", "Fine"),
    ]);
    expect(lookup(tree, "/Fine")?.entry.id).toBe("d1");
  });

  test("first entry wins when siblings share a name", () => {
    // The cloud permits duplicate sibling names; a later duplicate must not
    // shadow the entry an earlier lookup already resolved.
    const tree = buildTree([doc("d1", "Notes"), doc("d2", "Notes")]);
    expect(lookup(tree, "/Notes")?.entry.id).toBe("d1");
  });

  test("root lookup is always null", () => {
    const tree = buildTree([folder("f1", "Books")]);
    expect(lookup(tree, "/")).toBeNull();
  });
});

describe("resolveParentId", () => {
  test("root resolves to the empty-string parent", () => {
    expect(resolveParentId(buildTree([]), "/")).toBe("");
  });

  test("rejects a path that is a document", () => {
    const tree = buildTree([doc("d1", "Thesis")]);
    expect(() => resolveParentId(tree, "/Thesis")).toThrow("not a folder");
  });

  test("rejects a missing path", () => {
    expect(() => resolveParentId(buildTree([]), "/Nope")).toThrow("no such folder");
  });
});

describe("listChildren", () => {
  test("sorts folders before documents, then by name", () => {
    const tree = buildTree([
      doc("d1", "zebra"),
      folder("f1", "beta"),
      doc("d2", "alpha"),
      folder("f2", "alpha"),
    ]);
    expect(listChildren(tree, "/").map((n) => n.entry.visibleName)).toEqual([
      "alpha",
      "beta",
      "alpha",
      "zebra",
    ]);
  });

  test("returns an empty list for an empty folder", () => {
    const tree = buildTree([folder("f1", "Empty")]);
    expect(listChildren(tree, "/Empty")).toEqual([]);
  });
});

describe("mkdirp", () => {
  /** Records putFolder calls and hands back deterministic ids. */
  function fakeApi() {
    const calls: { name: string; parent: string | undefined }[] = [];
    let n = 0;
    return {
      calls,
      api: {
        putFolder: async (
          visibleName: string,
          opts?: { parent?: string },
        ) => {
          calls.push({ name: visibleName, parent: opts?.parent });
          n += 1;
          return { id: `new-${n}`, hash: `hash-new-${n}` };
        },
      } as never,
    };
  }

  test("creates every missing segment in order", async () => {
    const { api, calls } = fakeApi();
    const tree = buildTree([]);
    const result = await mkdirp(api, tree, "/a/b/c");

    expect(calls).toEqual([
      { name: "a", parent: "" },
      { name: "b", parent: "new-1" },
      { name: "c", parent: "new-2" },
    ]);
    expect(result.created).toEqual(["/a", "/a/b", "/a/b/c"]);
    expect(result.id).toBe("new-3");
  });

  test("is a no-op when the folder already exists", async () => {
    const { api, calls } = fakeApi();
    const tree = buildTree([folder("f1", "a"), folder("f2", "b", "f1")]);
    const result = await mkdirp(api, tree, "/a/b");

    // putFolder is not idempotent, so an existing path must not be re-created.
    expect(calls).toEqual([]);
    expect(result.created).toEqual([]);
    expect(result.id).toBe("f2");
  });

  test("creates only the missing tail", async () => {
    const { api, calls } = fakeApi();
    const tree = buildTree([folder("f1", "a")]);
    const result = await mkdirp(api, tree, "/a/b");

    expect(calls).toEqual([{ name: "b", parent: "f1" }]);
    expect(result.created).toEqual(["/a/b"]);
  });

  test("grafts new folders into the tree for later lookups", async () => {
    const { api } = fakeApi();
    const tree = buildTree([]);
    await mkdirp(api, tree, "/a/b");

    expect(lookup(tree, "/a/b")?.entry.id).toBe("new-2");
    expect(listChildren(tree, "/a").map((n) => n.entry.visibleName)).toEqual(["b"]);
  });

  test("refuses to descend through a document", async () => {
    const { api } = fakeApi();
    const tree = buildTree([doc("d1", "a")]);
    await expect(mkdirp(api, tree, "/a/b")).rejects.toThrow("not a folder");
  });

  test("root is a no-op", async () => {
    const { api, calls } = fakeApi();
    const result = await mkdirp(api, buildTree([]), "/");
    expect(calls).toEqual([]);
    expect(result.id).toBe("");
  });
});
