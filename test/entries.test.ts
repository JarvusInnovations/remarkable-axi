import { describe, expect, test } from "vitest";
import type { RemarkableApi } from "rmapi-js";
import { listEntries, pdfPageIndexes } from "../src/entries.js";

interface Item {
  id: string;
  metadata?: string;
  content?: string;
}

/**
 * Stand-in for the cloud that records how many reads overlap.
 *
 * Every read yields to the event loop before resolving, so an unbounded map
 * would show a peak equal to the item count.
 */
function fakeApi(items: Item[]) {
  let inFlight = 0;
  let peak = 0;

  const settle = async <T>(value: T): Promise<T> => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight--;
    return value;
  };

  const byId = new Map(items.map((item) => [item.id, item]));
  const lookup = (blobId: string) => byId.get(blobId.split(".")[0]!);

  const api = {
    listRefs: async () => items.map(({ id }) => ({ id, hash: `hash-${id}` })),
    raw: {
      getEntries: async ({ id }: { id: string }) => {
        // The library appends `.docSchema` itself and reMarkable validates the
        // resulting name, so a suffixed id here is a real request failure.
        if (id.includes(".")) throw new Error(`getEntries wants a bare id: ${id}`);
        const item = lookup(id);
        const entries = [];
        if (item?.metadata !== undefined) {
          entries.push({ id: `${item.id}.metadata`, hash: "m" });
        }
        if (item?.content !== undefined) {
          entries.push({ id: `${item.id}.content`, hash: "c" });
        }
        return settle({ entries });
      },
      getText: async ({ id }: { id: string }) => {
        const item = lookup(id);
        const text = id.endsWith(".metadata") ? item?.metadata : item?.content;
        return settle(text ?? "");
      },
      getContent: async ({ id }: { id: string }) =>
        settle(JSON.parse(lookup(id)?.content ?? "{}") as unknown),
    },
  };

  return { api: api as unknown as RemarkableApi, peak: () => peak };
}

const document = (id: string, name: string): Item => ({
  id,
  metadata: JSON.stringify({ visibleName: name, lastModified: "1700000000000" }),
  content: JSON.stringify({ fileType: "pdf" }),
});

describe("listEntries", () => {
  test("returns every readable item", async () => {
    const { api } = fakeApi([document("a", "One"), document("b", "Two")]);
    const { entries, unreadable } = await listEntries(api);

    expect(entries.map((e) => e.visibleName)).toEqual(["One", "Two"]);
    expect(unreadable).toBe(0);
  });

  test("counts an item it cannot read instead of dropping it silently", async () => {
    // A caller that reports a list as complete when it isn't sends the agent
    // off on wrong data, so the shortfall has to be visible.
    const { api } = fakeApi([document("a", "One"), { id: "b" }]);
    const { entries, unreadable } = await listEntries(api);

    expect(entries).toHaveLength(1);
    expect(unreadable).toBe(1);
  });

  test("keeps an item whose metadata omits lastModified", async () => {
    // This is the failure that made `api.listItems()` unusable: its schema
    // requires the field, so one item written by another tool rejected the
    // whole account listing.
    const { api } = fakeApi([
      { id: "a", metadata: JSON.stringify({ visibleName: "Odd" }) },
    ]);
    const { entries, unreadable } = await listEntries(api);

    expect(unreadable).toBe(0);
    expect(entries[0]).toMatchObject({ visibleName: "Odd", lastModified: "" });
  });

  test("bounds how many reads are in flight at once", async () => {
    // An unbounded fan-out does not fail outright — the requests queue, and
    // individual calls then take long enough to trip the per-call deadline,
    // which reported 198 healthy items as unreadable on a real account.
    const items = Array.from({ length: 400 }, (_, i) =>
      document(`i${i}`, `Item ${i}`),
    );
    const { api, peak } = fakeApi(items);
    const { entries, unreadable } = await listEntries(api);

    expect(entries).toHaveLength(400);
    expect(unreadable).toBe(0);
    expect(peak()).toBeLessThan(items.length);
  });

  test("preserves input order despite completing out of order", async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      document(`i${i}`, `Item ${i}`),
    );
    const { api } = fakeApi(items);
    const { entries } = await listEntries(api);

    expect(entries.map((e) => e.visibleName)).toEqual(
      items.map((_, i) => `Item ${i}`),
    );
  });
});

describe("pdfPageIndexes", () => {
  test("maps ids through the newer cPages shape", () => {
    const content = { cPages: { pages: [{ id: "p0" }, { id: "p1" }] } };
    expect([...pdfPageIndexes(content, ["p1", "p0"])]).toEqual([
      ["p1", 1],
      ["p0", 0],
    ]);
  });

  test("maps ids through the legacy flat pages array", () => {
    // Documents in the wild use both shapes; reading only one silently placed
    // annotations on page 1 of every multi-page document.
    const content = { pages: ["p0", "p1", "p2"] };
    expect(pdfPageIndexes(content, ["p2"]).get("p2")).toBe(2);
  });

  test("follows redirectionPageMap when pages have been inserted", () => {
    const content = {
      pages: ["p0", "p1", "p2"],
      redirectionPageMap: [0, -1, 1],
    };
    const map = pdfPageIndexes(content, ["p0", "p1", "p2"]);

    expect(map.get("p0")).toBe(0);
    // A negative entry means the page has no counterpart in the original PDF.
    expect(map.has("p1")).toBe(false);
    expect(map.get("p2")).toBe(1);
  });

  test("yields nothing when the content carries no page order", () => {
    expect(pdfPageIndexes({}, ["p0"]).size).toBe(0);
    expect(pdfPageIndexes(null, ["p0"]).size).toBe(0);
  });

  test("ignores a page id the content does not list", () => {
    expect(pdfPageIndexes({ pages: ["p0"] }, ["ghost"]).size).toBe(0);
  });
});
