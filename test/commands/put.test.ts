import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { RemarkableApi } from "rmapi-js";

// `client()` is the only cloud entry point `put` uses directly — everything
// else (`listEntries`, `buildTree`, ...) runs for real against the fake API
// below, same as `test/cache.test.ts` and `test/entries.test.ts`. Hoisted so
// the mock factory can see it before `vi.mock` is evaluated.
const authMock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("../../src/auth.js", () => authMock);

// Imported after the mock is registered, and at module scope rather than
// inside a test body — awaiting a dynamic import inside a test races the
// per-test timeout on a loaded machine (see test/deprecated.test.ts).
const { put } = await import("../../src/commands/put.js");

interface Item {
  id: string;
  name: string;
  parent?: string;
  pageCount?: number;
  /** Synthesizes this many per-page `.rm` entries in the document's own entry list. */
  inkedPages?: number;
  /** Makes `raw.getContent` throw for this item's `.content` file specifically. */
  contentUnreadable?: boolean;
}

/**
 * Stand-in for the cloud client. `listRefs` + `raw.getEntries/getText/getContent`
 * back the real `listEntries`/`buildTree` path exactly as the live API would;
 * the document-level API methods `put` calls directly are hand-rolled fakes
 * that record how many times each fired.
 */
function fakeApi(items: Item[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const calls = { getEntries: 0, getContent: 0, putPdf: 0, rename: 0, delete: 0 };

  const docEntries = (item: Item): { id: string; hash: string }[] => {
    const entries = [
      { id: `${item.id}.metadata`, hash: "m" },
      { id: `${item.id}.content`, hash: "c" },
    ];
    for (let p = 0; p < (item.inkedPages ?? 0); p++) {
      entries.push({ id: `${item.id}/page-${p}.rm`, hash: `rm-${p}` });
    }
    return entries;
  };

  const raw = {
    getEntries: async ({ id }: { id: string }) => {
      calls.getEntries++;
      const item = byId.get(id);
      return { entries: item ? docEntries(item) : [] };
    },
    getText: async ({ id }: { id: string }) => {
      const bare = id.split(".")[0]!;
      const item = byId.get(bare);
      if (!item) return "";
      if (id.endsWith(".metadata")) {
        return JSON.stringify({
          visibleName: item.name,
          lastModified: "1700000000000",
          parent: item.parent ?? "",
        });
      }
      if (id.endsWith(".content")) {
        return JSON.stringify({ fileType: "pdf", pageCount: item.pageCount ?? 1 });
      }
      return "";
    },
    getContent: async ({ id }: { id: string }) => {
      calls.getContent++;
      const bare = id.split(".")[0]!;
      const item = byId.get(bare);
      if (!item) throw new Error(`no content for ${id}`);
      if (id.endsWith(".content") && item.contentUnreadable) {
        throw new Error("boom");
      }
      return { fileType: "pdf", pageCount: item.pageCount ?? 1 } as unknown;
    },
  };

  const api = {
    listRefs: async () => items.map((i) => ({ id: i.id, hash: `hash-${i.id}` })),
    raw,
    putPdf: async (name: string) => {
      calls.putPdf++;
      const id = `new-${name}`;
      return { id, hash: `hash-${id}` };
    },
    putEpub: async (name: string) => {
      const id = `new-${name}`;
      return { id, hash: `hash-${id}` };
    },
    rename: async (ref: { id: string; hash: string }) => {
      calls.rename++;
      return { id: ref.id, hash: `renamed-${ref.id}` };
    },
    delete: async (ref: { id: string; hash: string }) => {
      calls.delete++;
      return { id: ref.id, hash: `deleted-${ref.id}` };
    },
  };

  return { api: api as unknown as RemarkableApi, calls };
}

describe("put --replace ink guard", () => {
  let dir: string;
  let pdfPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "remarkable-axi-put-test-"));
    pdfPath = join(dir, "draft-v2.pdf");
    await writeFile(pdfPath, "%PDF-1.4 fake\n");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    authMock.client.mockReset();
  });

  test("refuses onto an inked document, naming the inked page count, before uploading anything", async () => {
    const { api, calls } = fakeApi([
      { id: "docA", name: "Flyer", parent: "", pageCount: 12, inkedPages: 3 },
    ]);
    authMock.client.mockResolvedValue(api);

    await expect(put([pdfPath, "/Flyer", "--replace"])).rejects.toMatchObject({
      code: "HAS_INK",
      message: "/Flyer has ink on 3 of 12 pages; --replace would discard it",
      suggestions: [
        `save it separately first — remarkable-axi get /Flyer --overlay <file>.pdf`,
        `or replace and let it go — remarkable-axi put ${pdfPath} /Flyer --replace --discard-ink`,
      ],
    });

    // Refused before the upload-then-trash composite ever started.
    expect(calls.putPdf).toBe(0);
    expect(calls.rename).toBe(0);
    expect(calls.delete).toBe(0);
  });

  test("the refusal never mentions --keep-ink — it is not a shipped flag", async () => {
    const { api } = fakeApi([
      { id: "docA", name: "Flyer", parent: "", pageCount: 12, inkedPages: 3 },
    ]);
    authMock.client.mockResolvedValue(api);

    try {
      await put([pdfPath, "/Flyer", "--replace"]);
      throw new Error("should have thrown");
    } catch (error) {
      const axi = error as { message: string; suggestions: string[] };
      expect(axi.message).not.toContain("--keep-ink");
      expect(axi.suggestions.join(" ")).not.toContain("--keep-ink");
    }
  });

  test("is unaffected replacing a clean (uninked) document", async () => {
    const { api, calls } = fakeApi([
      { id: "docA", name: "Flyer", parent: "", pageCount: 12, inkedPages: 0 },
    ]);
    authMock.client.mockResolvedValue(api);

    const output = await put([pdfPath, "/Flyer", "--replace"]);

    expect(calls.putPdf).toBe(1);
    expect(calls.rename).toBe(1);
    expect(calls.delete).toBe(1);
    // One `getContent` from building the tree (every document's fileType is
    // read); the ink check adds no second one, since there was nothing to size.
    expect(calls.getContent).toBe(1);
    expect(output.uploaded).toMatchObject({ path: "/Flyer" });
  });

  test("--discard-ink proceeds onto an inked document and reports the renamed backup", async () => {
    const { api, calls } = fakeApi([
      { id: "docA", name: "Flyer", parent: "", pageCount: 12, inkedPages: 3 },
    ]);
    authMock.client.mockResolvedValue(api);

    const output = await put([pdfPath, "/Flyer", "--replace", "--discard-ink"]);

    expect(calls.putPdf).toBe(1);
    expect(calls.rename).toBe(1);
    expect(calls.delete).toBe(1);
    // --discard-ink skips the guard outright — the only `getContent` call is
    // the one every document pays building the tree, not a second ink check.
    expect(calls.getContent).toBe(1);
    expect(output.uploaded).toMatchObject({ path: "/Flyer" });
    expect((output.backup as { trashed: string }).trashed).toMatch(
      /^Flyer \(replaced \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/,
    );
  });

  test("falls back to the inked count alone when the content read fails", async () => {
    const { api } = fakeApi([
      { id: "docA", name: "Flyer", parent: "", inkedPages: 2, contentUnreadable: true },
    ]);
    authMock.client.mockResolvedValue(api);

    // Tree-building still succeeds (entries.ts falls back to a raw-text
    // read for the same failure), so this is a clean test of detectInk's
    // own fallback rather than an incidental NOT_FOUND from a broken tree.
    await expect(put([pdfPath, "/Flyer", "--replace"])).rejects.toMatchObject({
      code: "HAS_INK",
      message: "/Flyer has ink on 2 of 2 pages; --replace would discard it",
    });
  });
});
