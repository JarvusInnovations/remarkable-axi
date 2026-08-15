import { describe, expect, test } from "vitest";
import type { Entry } from "rmapi-js";
import {
  baseName,
  buildTree,
  duplicatePaths,
  listChildren,
  lookup,
  mkdirp,
  nodesAt,
  normalizePath,
  parentPath,
  resolveParentId,
  resolvePutDestination,
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

  test("keeps every duplicate reachable by id even though lookup picks one", () => {
    // `replace` depends on this: a path lookup can only return one entry, so
    // finding *all* entries at a path has to go through the id index. Without
    // it, replacing one of two same-named siblings is a coin flip.
    const tree = buildTree([doc("d1", "Notes"), doc("d2", "Notes")]);
    expect(lookup(tree, "/Notes")?.entry.id).toBe("d1");
    const atPath = [...tree.byId.values()].filter((n) => n.path === "/Notes");
    expect(atPath.map((n) => n.entry.id).sort()).toEqual(["d1", "d2"]);
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

describe("pdfPageIndexes", () => {
  test("reads the legacy flat pages array", async () => {
    const { pdfPageIndexes } = await import("../src/entries.js");
    const content = { pages: ["a", "b", "c"] };
    expect([...pdfPageIndexes(content, ["c", "a"])]).toEqual([
      ["c", 2],
      ["a", 0],
    ]);
  });

  test("reads the newer cPages shape", async () => {
    const { pdfPageIndexes } = await import("../src/entries.js");
    const content = { cPages: { pages: [{ id: "a" }, { id: "b" }] } };
    expect(pdfPageIndexes(content, ["b"]).get("b")).toBe(1);
  });

  test("follows redirectionPageMap onto the source document", async () => {
    const { pdfPageIndexes } = await import("../src/entries.js");
    // Notebook position 1 corresponds to source page 4 once pages moved.
    const content = { pages: ["a", "b", "c"], redirectionPageMap: [0, 4, 5] };
    expect(pdfPageIndexes(content, ["b"]).get("b")).toBe(4);
  });

  test("drops pages with no counterpart in the original", async () => {
    const { pdfPageIndexes } = await import("../src/entries.js");
    // A negative entry marks a page inserted on the device; drawing it onto
    // the source would put ink on an unrelated page.
    const content = { pages: ["a", "b"], redirectionPageMap: [0, -1] };
    const map = pdfPageIndexes(content, ["a", "b"]);
    expect(map.get("a")).toBe(0);
    expect(map.has("b")).toBe(false);
  });

  test("ignores ids the document does not list", async () => {
    const { pdfPageIndexes } = await import("../src/entries.js");
    expect(pdfPageIndexes({ pages: ["a"] }, ["zz"]).size).toBe(0);
  });

  test("returns nothing when no ordering is recorded", async () => {
    const { pdfPageIndexes } = await import("../src/entries.js");
    expect(pdfPageIndexes({}, ["a"]).size).toBe(0);
    expect(pdfPageIndexes(null, ["a"]).size).toBe(0);
  });
});

describe("nodesAt", () => {
  test("returns every entry at a path, not just the first", () => {
    const tree = buildTree([doc("d1", "Notes"), doc("d2", "Notes")]);
    expect(nodesAt(tree, "/Notes").map((n) => n.entry.id).sort()).toEqual([
      "d1",
      "d2",
    ]);
  });

  test("returns a single-element list for a unique path", () => {
    const tree = buildTree([doc("d1", "Draft")]);
    expect(nodesAt(tree, "/Draft").map((n) => n.entry.id)).toEqual(["d1"]);
  });

  test("returns nothing for a path with no entry", () => {
    expect(nodesAt(buildTree([]), "/Nope")).toEqual([]);
  });
});

describe("duplicatePaths", () => {
  test("groups siblings that share a path", () => {
    const tree = buildTree([
      folder("f1", "Papers"),
      doc("d1", "Draft", "f1"),
      doc("d2", "Draft", "f1"),
      doc("d3", "Unique", "f1"),
    ]);
    const dups = duplicatePaths(tree);
    expect(dups.size).toBe(1);
    expect(dups.get("/Papers/Draft")?.map((n) => n.entry.id).sort()).toEqual([
      "d1",
      "d2",
    ]);
    expect(dups.has("/Papers/Unique")).toBe(false);
  });

  test("is empty when every path is unique", () => {
    const tree = buildTree([doc("d1", "A"), doc("d2", "B")]);
    expect(duplicatePaths(tree).size).toBe(0);
  });

  test("does not confuse a folder and document that merely share a name", () => {
    // Different types can coincidentally share a visible name in different
    // parents without colliding — only an identical *path* is a duplicate.
    const tree = buildTree([folder("f1", "Notes"), doc("d1", "Notes", "f1")]);
    expect(duplicatePaths(tree).size).toBe(0);
  });
});

describe("resolvePutDestination", () => {
  test("lands inside an existing folder, named from the source", () => {
    const tree = buildTree([folder("f1", "Papers")]);
    const dest = resolvePutDestination(tree, "/Papers", "Draft");
    expect(dest.finalPath).toBe("/Papers/Draft");
    expect(dest.parentId).toBe("f1");
    expect(dest.parentPath).toBe("/Papers");
    expect(dest.needsMkdirp).toBe(false);
    expect(dest.existing).toEqual([]);
  });

  test("lands at the root when dest is /", () => {
    const tree = buildTree([]);
    const dest = resolvePutDestination(tree, "/", "Draft");
    expect(dest.finalPath).toBe("/Draft");
    expect(dest.parentPath).toBe("/");
    expect(dest.needsMkdirp).toBe(false);
  });

  test("treats a non-existent trailing segment as the document's own path", () => {
    const tree = buildTree([folder("f1", "Papers")]);
    const dest = resolvePutDestination(tree, "/Papers/Draft", "ignored");
    expect(dest.finalPath).toBe("/Papers/Draft");
    expect(dest.name).toBe("Draft");
    expect(dest.parentPath).toBe("/Papers");
    expect(dest.needsMkdirp).toBe(true);
  });

  test("--name is ignored once dest names an explicit path", () => {
    // The cloud has no separate path concept — the path *is* the name chain —
    // so honoring a conflicting --name here would upload a document that
    // isn't actually found at the path just reported.
    const tree = buildTree([]);
    const dest = resolvePutDestination(tree, "/Papers/Draft", "Something Else");
    expect(dest.name).toBe("Draft");
  });

  test("reports a single occupying document", () => {
    const tree = buildTree([doc("d1", "Draft")]);
    const dest = resolvePutDestination(tree, "/Draft", "ignored");
    expect(dest.existing.map((n) => n.entry.id)).toEqual(["d1"]);
  });

  test("reports every occupying document when the path is already ambiguous", () => {
    const tree = buildTree([doc("d1", "Draft"), doc("d2", "Draft")]);
    const dest = resolvePutDestination(tree, "/Draft", "ignored");
    expect(dest.existing.map((n) => n.entry.id).sort()).toEqual(["d1", "d2"]);
  });

  test("a folder-landing collision is also reported as existing", () => {
    const tree = buildTree([
      folder("f1", "Papers"),
      doc("d1", "Draft", "f1"),
    ]);
    const dest = resolvePutDestination(tree, "/Papers", "Draft");
    expect(dest.existing.map((n) => n.entry.id)).toEqual(["d1"]);
  });
});
