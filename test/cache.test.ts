import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Entry, ItemRef, RemarkableApi } from "rmapi-js";

// A fake, in-memory filesystem standing in for `~/.config/remarkable-axi/`, so
// these tests never touch a real machine's config directory. `vi.hoisted`
// ensures the store exists before the mock factory below runs, since
// `vi.mock` calls are hoisted above the rest of this module.
const store = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs/promises", () => ({
  mkdir: async () => undefined,
  readFile: async (path: string) => {
    const value = store.get(String(path));
    if (value === undefined) {
      const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return value;
  },
  writeFile: async (path: string, data: string) => {
    store.set(String(path), String(data));
  },
  rm: async (path: string) => {
    store.delete(String(path));
  },
}));

const { loadTree, recordMutation, discardCache } = await import("../src/cache.js");

interface Item {
  id: string;
  metadata?: string;
  content?: string;
}

/**
 * Stand-in for the cloud client, tracking how many calls each layer made so
 * tests can assert work stayed proportional to what changed rather than to
 * account size.
 */
function fakeApi(opts: {
  rootHash: string;
  generation: number;
  refs: ItemRef[];
  items: Item[];
  rootHashError?: Error;
}) {
  const calls = { getRootHash: 0, listRefs: 0, getEntries: 0 };
  const byId = new Map(opts.items.map((item) => [item.id, item]));
  const bare = (id: string) => id.split(".")[0]!;

  const raw = {
    getRootHash: async (): Promise<[string, number, 4]> => {
      calls.getRootHash++;
      if (opts.rootHashError) throw opts.rootHashError;
      return [opts.rootHash, opts.generation, 4];
    },
    getEntries: async ({ id }: { id: string }) => {
      calls.getEntries++;
      const item = byId.get(id);
      const entries: { id: string; hash: string }[] = [];
      if (item?.metadata !== undefined) entries.push({ id: `${id}.metadata`, hash: "m" });
      if (item?.content !== undefined) entries.push({ id: `${id}.content`, hash: "c" });
      return { entries };
    },
    getText: async ({ id }: { id: string }) => {
      const item = byId.get(bare(id));
      return (id.endsWith(".metadata") ? item?.metadata : item?.content) ?? "";
    },
    getContent: async ({ id }: { id: string }) =>
      JSON.parse(byId.get(bare(id))?.content ?? "{}") as unknown,
  };

  const api = {
    listRefs: async () => {
      calls.listRefs++;
      return opts.refs;
    },
    raw,
  };

  return { api: api as unknown as RemarkableApi, calls };
}

const document = (id: string, name: string, modified = "1700000000000"): Item => ({
  id,
  metadata: JSON.stringify({ visibleName: name, lastModified: modified }),
  content: JSON.stringify({ fileType: "pdf" }),
});

beforeEach(() => {
  store.clear();
  process.env.REMARKABLE_TOKEN = "test-token-one";
});

afterEach(() => {
  delete process.env.REMARKABLE_TOKEN;
});

describe("loadTree", () => {
  test("cold start fetches and caches every document", async () => {
    const items = [document("a", "One"), document("b", "Two")];
    const { api, calls } = fakeApi({
      rootHash: "root-1",
      generation: 1,
      refs: items.map(({ id }) => ({ id, hash: `hash-${id}` })),
      items,
    });

    const result = await loadTree(api);

    expect(result.source).toBe("refreshed");
    expect(result.entries.map((e) => e.visibleName).sort()).toEqual(["One", "Two"]);
    expect(result.changed).toHaveLength(2);
    expect(calls).toEqual({ getRootHash: 1, listRefs: 1, getEntries: 2 });
  });

  test("an unchanged root serves the cache with exactly one request", async () => {
    const items = [document("a", "One"), document("b", "Two")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    const second = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    const result = await loadTree(second.api);

    expect(result.source).toBe("cache");
    expect(result.changed).toHaveLength(0);
    expect(result.entries.map((e) => e.visibleName).sort()).toEqual(["One", "Two"]);
    // The validation call only — no root index, no metadata refetch.
    expect(second.calls).toEqual({ getRootHash: 1, listRefs: 0, getEntries: 0 });
  });

  test("a changed root refetches only the documents whose hash moved", async () => {
    const items = [document("a", "One"), document("b", "Two"), document("c", "Three")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    // "b" is renamed (its hash moves); "a" and "c" are untouched.
    const renamed = document("b", "Two renamed");
    const nextItems = [items[0]!, renamed, items[2]!];
    const nextRefs = [
      { id: "a", hash: "hash-a" },
      { id: "b", hash: "hash-b-v2" },
      { id: "c", hash: "hash-c" },
    ];
    const second = fakeApi({
      rootHash: "root-2",
      generation: 2,
      refs: nextRefs,
      items: nextItems,
    });

    const result = await loadTree(second.api);

    expect(result.source).toBe("refreshed");
    expect(result.changed.map((e) => e.visibleName)).toEqual(["Two renamed"]);
    expect(result.entries.map((e) => e.visibleName).sort()).toEqual([
      "One",
      "Three",
      "Two renamed",
    ]);
    // Only the one moved hash costs a metadata fetch, not the whole account.
    expect(second.calls).toEqual({ getRootHash: 1, listRefs: 1, getEntries: 1 });
  });

  test("a changed root drops documents no longer in the index", async () => {
    const items = [document("a", "One"), document("b", "Two")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    // "b" is gone from the root index (trashed).
    const second = fakeApi({
      rootHash: "root-2",
      generation: 2,
      refs: [{ id: "a", hash: "hash-a" }],
      items: [items[0]!],
    });

    const result = await loadTree(second.api);

    expect(result.entries.map((e) => e.visibleName)).toEqual(["One"]);
    expect(result.removedCount).toBe(1);
    expect(second.calls.getEntries).toBe(0); // "a" is unchanged, no refetch needed
  });

  test("an unreachable root with a cache degrades to it, stating its age", async () => {
    const items = [document("a", "One")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    const second = fakeApi({
      rootHash: "unused",
      generation: 1,
      refs: [],
      items: [],
      rootHashError: new Error("network unreachable"),
    });

    const result = await loadTree(second.api);

    expect(result.source).toBe("stale");
    expect(result.entries.map((e) => e.visibleName)).toEqual(["One"]);
    expect(typeof result.updatedAt).toBe("string");
    expect(second.calls).toEqual({ getRootHash: 1, listRefs: 0, getEntries: 0 });
  });

  test("an unreachable root with no cache fails with a structured error", async () => {
    const { api } = fakeApi({
      rootHash: "unused",
      generation: 1,
      refs: [],
      items: [],
      rootHashError: new Error("network unreachable"),
    });

    await expect(loadTree(api)).rejects.toMatchObject({
      code: "CLOUD_UNREACHABLE",
    });
  });

  test("a cache built under one account is not served to another", async () => {
    const items = [document("a", "One")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    process.env.REMARKABLE_TOKEN = "a-different-token";
    const second = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    const result = await loadTree(second.api);

    // Same root hash/generation as before, but under a different account the
    // cache must not be trusted — this is a full (re)fetch, not a hit.
    expect(result.source).toBe("refreshed");
    expect(second.calls.listRefs).toBe(1);
  });
});

describe("recordMutation", () => {
  test("a mutation's own result is folded in, sparing its metadata refetch", async () => {
    const items = [document("a", "One")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    const putEntry = {
      id: "b",
      hash: "hash-b",
      type: "DocumentType",
      fileType: "pdf",
      visibleName: "Two",
      lastModified: "1700000001000",
      lastOpened: "",
      pinned: false,
      parent: "",
    } as Entry;

    const mutated = fakeApi({ rootHash: "root-2", generation: 2, refs: [], items: [] });
    await recordMutation(mutated.api, { upsert: [putEntry] });
    // Folds the entry in without asking the cloud anything at all.
    expect(mutated.calls).toEqual({ getRootHash: 0, listRefs: 0, getEntries: 0 });

    // The next load reconciles rather than trusting locally-assembled
    // entries. What it saves is the per-document metadata fetch for the
    // entry we just wrote — which is where the real cost always was.
    const third = fakeApi({
      rootHash: "root-2",
      generation: 2,
      refs: [...refs, { id: "b", hash: "hash-b" }],
      items: [...items, { id: "b" }],
    });
    const result = await loadTree(third.api);

    expect(result.source).toBe("refreshed");
    expect(result.entries.map((e) => e.visibleName).sort()).toEqual(["One", "Two"]);
    expect(third.calls).toEqual({ getRootHash: 1, listRefs: 1, getEntries: 0 });
  });

  test("reconciling after a mutation picks up a concurrent write", async () => {
    const items = [document("a", "One")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    const ours = {
      id: "b",
      hash: "hash-b",
      type: "DocumentType",
      fileType: "pdf",
      visibleName: "Ours",
      lastModified: "1700000001000",
      lastOpened: "",
      pinned: false,
      parent: "",
    } as Entry;

    const mutated = fakeApi({ rootHash: "root-2", generation: 2, refs: [], items: [] });
    await recordMutation(mutated.api, { upsert: [ours] });

    // Another client wrote "Theirs" concurrently, so our mutation rebased
    // onto it and the live root covers a document we never saw. Recording
    // the post-mutation root hash here would have made the next read a
    // cache hit serving a tree silently missing it.
    const third = fakeApi({
      rootHash: "root-3",
      generation: 3,
      refs: [...refs, { id: "b", hash: "hash-b" }, { id: "c", hash: "hash-c" }],
      items: [...items, { id: "b" }, document("c", "Theirs")],
    });
    const result = await loadTree(third.api);

    expect(result.entries.map((e) => e.visibleName).sort()).toEqual([
      "One",
      "Ours",
      "Theirs",
    ]);
  });

  test("a removal drops the entry from the cache", async () => {
    const items = [document("a", "One"), document("b", "Two")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    const mutated = fakeApi({ rootHash: "root-2", generation: 2, refs: [], items: [] });
    await recordMutation(mutated.api, { remove: ["b"] });

    const third = fakeApi({
      rootHash: "root-2",
      generation: 2,
      refs: [{ id: "a", hash: "hash-a" }],
      items: [items[0]!],
    });
    const result = await loadTree(third.api);

    expect(result.source).toBe("refreshed");
    expect(result.entries.map((e) => e.visibleName)).toEqual(["One"]);
    expect(third.calls.getEntries).toBe(0); // nothing moved; the fold-in held
  });

  test("does nothing when there is no cache to update yet", async () => {
    const mutated = fakeApi({ rootHash: "root-1", generation: 1, refs: [], items: [] });
    await expect(
      recordMutation(mutated.api, { upsert: [document("a", "One") as unknown as Entry] }),
    ).resolves.toBeUndefined();
    expect(mutated.calls.getRootHash).toBe(0); // never even asked
  });
});

describe("discardCache", () => {
  test("forces the next load to rebuild from scratch", async () => {
    const items = [document("a", "One")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    await loadTree(first.api);

    await discardCache();

    const second = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    const result = await loadTree(second.api);

    expect(result.source).toBe("refreshed");
    expect(second.calls.listRefs).toBe(1);
  });
});
