import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ItemRef, RemarkableApi } from "rmapi-js";

// Same in-memory stand-in for `~/.config/remarkable-axi/` as cache.test.ts,
// duplicated here rather than shared so this file stays independently
// readable — see that file for the rationale on `vi.hoisted`.
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

// `home()` reaches the cloud through `client()`, which builds a real
// `rmapi-js` session over the network — replaced here with a direct handle to
// the fake api so these tests never touch the network or a real token.
let fake: RemarkableApi | null = null;

vi.mock("../src/auth.js", () => ({
  readToken: async () => "test-token",
  tokenPath: "/fake/config/token",
  client: async () => {
    if (!fake) throw new Error("test forgot to configure the fake api");
    return fake;
  },
}));

const { home } = await import("../src/commands/home.js");

interface Item {
  id: string;
  metadata?: string;
  content?: string;
}

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

  return { api: { listRefs: async () => { calls.listRefs++; return opts.refs; }, raw } as unknown as RemarkableApi, calls };
}

const document = (id: string, name: string, modified: string): Item => ({
  id,
  metadata: JSON.stringify({ visibleName: name, lastModified: modified }),
  content: JSON.stringify({ fileType: "pdf" }),
});

beforeEach(() => {
  store.clear();
  fake = null;
});

afterEach(() => {
  fake = null;
});

describe("home", () => {
  test("a second consecutive call issues exactly one cloud request", async () => {
    const items = [document("a", "One", "1700000000000"), document("b", "Two", "1700000001000")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));

    const first = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    fake = first.api;
    const firstOut = await home();
    expect(firstOut.status).toContain("paired, 2 documents");

    const second = fakeApi({ rootHash: "root-1", generation: 1, refs, items });
    fake = second.api;
    const secondOut = await home();

    expect(secondOut.status).toContain("paired, 2 documents");
    expect(secondOut.status).not.toContain("cloud unreachable");
    expect(second.calls).toEqual({ getRootHash: 1, listRefs: 0, getEntries: 0 });
  });

  test("a changed tree is reflected on the very next call", async () => {
    const items = [document("a", "One", "1700000000000")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    fake = fakeApi({ rootHash: "root-1", generation: 1, refs, items }).api;
    await home();

    const grown = [...items, document("b", "Two", "1700000005000")];
    fake = fakeApi({
      rootHash: "root-2",
      generation: 2,
      refs: grown.map(({ id }) => ({ id, hash: `hash-${id}` })),
      items: grown,
    }).api;
    const out = await home();

    expect(out.status).toContain("paired, 2 documents");
    expect((out.recent as unknown[])?.length).toBeGreaterThan(0);
  });

  test("cloud unreachable with a cache degrades to it, exit-safe, with age stated", async () => {
    const items = [document("a", "One", "1700000000000")];
    const refs = items.map(({ id }) => ({ id, hash: `hash-${id}` }));
    fake = fakeApi({ rootHash: "root-1", generation: 1, refs, items }).api;
    await home();

    fake = fakeApi({
      rootHash: "unused",
      generation: 1,
      refs: [],
      items: [],
      rootHashError: new Error("network unreachable"),
    }).api;
    const out = await home();

    // Never throws — a session-start hook must always produce output.
    expect(out.status).toContain("cached");
    expect(out.status).toContain("cloud unreachable");
    expect(out.status).toContain("paired, 1 documents");
  });

  test("cloud unreachable with no cache reports a structured error, not empty output", async () => {
    fake = fakeApi({
      rootHash: "unused",
      generation: 1,
      refs: [],
      items: [],
      rootHashError: new Error("network unreachable"),
    }).api;

    const out = await home();

    expect(out.status).toBe("paired, cloud unreachable, no cached data");
    expect(typeof out.error).toBe("string");
    expect(Array.isArray(out.help)).toBe(true);
  });
});
