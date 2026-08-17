import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { RemarkableApi } from "rmapi-js";
import { age } from "../../src/time.js";

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

// Every fixture document reports this as its cloud `lastModified`; computed
// through the real `age()` helper rather than hardcoded, so the expected
// `last_synced` text doesn't drift out of sync with the calendar.
const LAST_MODIFIED = "1700000000000";
const lastSyncedAge = age(LAST_MODIFIED);

interface Item {
  id: string;
  name: string;
  parent?: string;
  pageCount?: number;
  /** Synthesizes this many per-page `.rm` entries that genuinely carry a stroke. */
  inkedPages?: number;
  /**
   * Synthesizes this many per-page `.rm` entries with zero strokes — a page
   * the device created a stroke file for on open (or pen hover) but that was
   * never actually drawn on. See
   * https://github.com/JarvusInnovations/remarkable-axi/issues/28.
   */
  openedPages?: number;
  /** Makes `raw.getContent` throw for this item's `.content` file specifically. */
  contentUnreadable?: boolean;
  /** Makes `raw.getRm` throw for every one of this item's `.rm` entries. */
  rmUnreadable?: boolean;
}

/**
 * Stand-in for the cloud client. `listRefs` + `raw.getEntries/getText/getContent`
 * back the real `listEntries`/`buildTree` path exactly as the live API would;
 * the document-level API methods `put` calls directly are hand-rolled fakes
 * that record how many times each fired.
 */
function fakeApi(items: Item[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const calls = {
    getEntries: 0,
    getContent: 0,
    getRm: 0,
    putPdf: 0,
    rename: 0,
    delete: 0,
  };

  const docEntries = (item: Item): { id: string; hash: string }[] => {
    const entries = [
      { id: `${item.id}.metadata`, hash: "m" },
      { id: `${item.id}.content`, hash: "c" },
    ];
    for (let p = 0; p < (item.inkedPages ?? 0); p++) {
      entries.push({ id: `${item.id}/ink-${p}.rm`, hash: `rm-ink-${p}` });
    }
    for (let p = 0; p < (item.openedPages ?? 0); p++) {
      entries.push({ id: `${item.id}/opened-${p}.rm`, hash: `rm-opened-${p}` });
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
          lastModified: LAST_MODIFIED,
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
    // A minimal parsed `.rm` scene: `ink-*` entries carry one real,
    // single-point stroke; `opened-*` entries carry the same page
    // scaffolding with zero strokes — the case #28 was filed against, where
    // the device creates a stroke file for a page that was merely opened.
    getRm: async ({ id }: { id: string }) => {
      calls.getRm++;
      const bareDoc = id.split("/")[0]!;
      const item = byId.get(bareDoc);
      if (item?.rmUnreadable) throw new Error("boom");
      const inked = id.includes("/ink-");
      return {
        version: 6,
        paperSize: [1620, 2160],
        blocks: inked
          ? [
              {
                type: "sceneLineItem",
                item: {
                  value: {
                    tool: 17,
                    color: 0,
                    thicknessScale: 1,
                    points: [{ x: 0, y: 0, width: 2 }],
                  },
                },
              },
            ]
          : [],
      } as unknown;
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

  test("refuses onto an inked document, naming the inked page count and the blind-spot disclosure, before uploading anything", async () => {
    const { api, calls } = fakeApi([
      { id: "docA", name: "Flyer", parent: "", pageCount: 12, inkedPages: 3 },
    ]);
    authMock.client.mockResolvedValue(api);

    await expect(put([pdfPath, "/Flyer", "--replace"])).rejects.toMatchObject({
      code: "HAS_INK",
      message:
        "/Flyer has ink on 3 of 12 pages; --replace would discard it\n" +
        `last synced ${lastSyncedAge} — ink written on-device since then is invisible to this check`,
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

  test("is unaffected replacing a clean (uninked) document, and reports last_synced", async () => {
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
    // No `.rm` entries at all, so no per-page fetch was needed either.
    expect(calls.getRm).toBe(0);
    expect(output.uploaded).toMatchObject({ path: "/Flyer" });
    expect(output.last_synced).toBe(lastSyncedAge);
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
    // the one every document pays building the tree, not a second ink check,
    // and no page is ever fetched to check for strokes.
    expect(calls.getContent).toBe(1);
    expect(calls.getRm).toBe(0);
    expect(output.uploaded).toMatchObject({ path: "/Flyer" });
    expect(output.last_synced).toBe(lastSyncedAge);
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
      message:
        "/Flyer has ink on 2 of 2 pages; --replace would discard it\n" +
        `last synced ${lastSyncedAge} — ink written on-device since then is invisible to this check`,
    });
  });
});

describe("put --replace stroke-bearing HAS_INK (closes #28)", () => {
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

  test("does not refuse when every candidate page's stroke file holds zero strokes", async () => {
    // The device creates a `.rm` file the moment a page is opened, before
    // any pen touches it — this is exactly that document, never drawn on.
    const { api, calls } = fakeApi([
      { id: "docA", name: "Flyer", parent: "", pageCount: 2, openedPages: 2 },
    ]);
    authMock.client.mockResolvedValue(api);

    const output = await put([pdfPath, "/Flyer", "--replace"]);

    expect(calls.putPdf).toBe(1);
    // Both candidate `.rm` entries had to be fetched and parsed to know
    // neither carried a stroke — the cost the correctness-over-threshold
    // choice pays, on a replace only.
    expect(calls.getRm).toBe(2);
    expect(output.uploaded).toMatchObject({ path: "/Flyer" });
    expect(output.last_synced).toBe(lastSyncedAge);
  });

  test("refuses when only some candidate pages carry a real stroke, counting only those", async () => {
    const { api, calls } = fakeApi([
      {
        id: "docA",
        name: "Flyer",
        parent: "",
        pageCount: 5,
        inkedPages: 1,
        openedPages: 2,
      },
    ]);
    authMock.client.mockResolvedValue(api);

    await expect(put([pdfPath, "/Flyer", "--replace"])).rejects.toMatchObject({
      code: "HAS_INK",
      message:
        "/Flyer has ink on 1 of 5 pages; --replace would discard it\n" +
        `last synced ${lastSyncedAge} — ink written on-device since then is invisible to this check`,
    });
    // All 3 candidate `.rm` entries (1 inked + 2 opened-only) were checked.
    expect(calls.getRm).toBe(3);
  });

  test("treats an unreadable stroke file as inked rather than dropping it from the count", async () => {
    const { api } = fakeApi([
      {
        id: "docA",
        name: "Flyer",
        parent: "",
        pageCount: 5,
        openedPages: 1,
        rmUnreadable: true,
      },
    ]);
    authMock.client.mockResolvedValue(api);

    // A page whose stroke file could not be fetched or parsed is not proof
    // of no ink — refusing (rather than silently permitting the replace) is
    // the conservative side of the one failure mode this guard exists for.
    await expect(put([pdfPath, "/Flyer", "--replace"])).rejects.toMatchObject({
      code: "HAS_INK",
      message:
        "/Flyer has ink on 1 of 5 pages; --replace would discard it\n" +
        `last synced ${lastSyncedAge} — ink written on-device since then is invisible to this check`,
    });
  });
});
