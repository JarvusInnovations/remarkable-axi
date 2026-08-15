import type { Entry, RemarkableApi, ItemRef } from "rmapi-js";

/**
 * Result of a listing, including anything that could not be read.
 *
 * Dropped entries are counted rather than swallowed: a caller that reports a
 * list as complete when it silently isn't sends the agent off on wrong data.
 */
export interface Listing {
  entries: Entry[];
  /** Items whose metadata could not be read at all. */
  unreadable: number;
}

interface LenientMetadata {
  visibleName?: unknown;
  lastModified?: unknown;
  lastOpened?: unknown;
  parent?: unknown;
  pinned?: unknown;
  createdTime?: unknown;
  source?: unknown;
  new?: unknown;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Read an item's metadata without the library's strict schema.
 *
 * `raw.getMetadata` validates against a schema that requires `lastModified`,
 * but real accounts contain items written by other tools that omit it — a
 * single such item rejects `listItems()` for the entire account, because it
 * fans out with `Promise.all`. Parsing the same JSON ourselves keeps one odd
 * folder from hiding everything else.
 */
async function readMetadata(
  api: RemarkableApi,
  metaEnt: ItemRef,
): Promise<LenientMetadata> {
  const text = await api.raw.getText(metaEnt);
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("metadata is not an object");
  }
  return parsed as LenientMetadata;
}

/** Read an item's content, tolerating a shape the schema rejects. */
async function readContent(
  api: RemarkableApi,
  contentEnt: ItemRef | undefined,
): Promise<{ fileType?: string; tags?: unknown; templateVersion?: unknown }> {
  // Collections often have no content file at all — content only carries tags.
  if (!contentEnt) return {};
  try {
    return (await api.raw.getContent(contentEnt)) as {
      fileType?: string;
      tags?: unknown;
    };
  } catch {
    try {
      const parsed: unknown = JSON.parse(await api.raw.getText(contentEnt));
      return typeof parsed === "object" && parsed !== null
        ? (parsed as { fileType?: string; tags?: unknown })
        : {};
    } catch {
      // Treat unreadable content as a collection rather than losing the item;
      // a folder that lists is far more useful than an entry that vanishes.
      return {};
    }
  }
}

/** Build one entry, mirroring the shape the library produces. */
async function convertEntry(
  api: RemarkableApi,
  { id, hash }: ItemRef,
): Promise<Entry | null> {
  // `getEntries` takes the bare document id and appends the `.docSchema`
  // suffix itself; passing the suffixed name doubles it and the server
  // rejects the request on the rm-filename header.
  const { entries } = await api.raw.getEntries({ id, hash });

  const metaEnt = entries.find((e) => e.id.endsWith(".metadata"));
  const contentEnt = entries.find((e) => e.id.endsWith(".content"));
  if (!metaEnt) return null;

  const [meta, content] = await Promise.all([
    readMetadata(api, metaEnt),
    readContent(api, contentEnt),
  ]);

  const common = {
    id,
    hash,
    visibleName: str(meta.visibleName, "(unnamed)"),
    // Absent on items written by some third-party tools. Callers render this
    // as an unknown age rather than failing.
    lastModified: str(meta.lastModified),
    pinned: meta.pinned === true,
    parent: str(meta.parent),
  };

  if (content.templateVersion !== undefined) {
    return {
      ...common,
      type: "TemplateType",
      new: meta.new === true,
      source: str(meta.source),
      createdTime: str(meta.createdTime),
    } as Entry;
  }

  if (content.fileType === undefined) {
    return { ...common, type: "CollectionType", tags: content.tags } as Entry;
  }

  return {
    ...common,
    type: "DocumentType",
    fileType: content.fileType,
    lastOpened: str(meta.lastOpened),
    tags: content.tags,
  } as Entry;
}

/**
 * Maximum reads in flight at once.
 *
 * Listing an account fans out over every item, and each item costs two or
 * three requests, so an unbounded map puts thousands of requests in flight on
 * a large account. They do not fail outright — they queue, and individual
 * calls then take long enough to trip the per-call deadline, which reports
 * healthy items as unreadable. Bounding the fan-out keeps each call fast
 * enough to finish well inside its budget.
 *
 * Measured on an 884-item account: unbounded took 14s and misreported 198
 * items; 12 took 33s, 32 took 15s, 64 took 8.4s, 128 took 5.6s, all correct.
 * 64 sits past the steep part of the curve while leaving headroom on slower
 * connections, where a larger fan-out would push per-call latency back toward
 * the deadline.
 */
const MAX_CONCURRENT_READS = 64;

/** Map over items with a bounded number in flight, preserving input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Read a specific set of items, dropping and counting anything unreadable.
 *
 * The bounded-fan-out, tolerant-parsing machinery `listEntries` needs for a
 * full account walk applies just as much to a short list of items whose hash
 * moved since the last cache validation — refetching only those is the whole
 * point of the generation-keyed cache (`src/cache.ts`), so the read path is
 * shared rather than duplicated.
 */
export async function resolveEntries(
  api: RemarkableApi,
  refs: ItemRef[],
): Promise<Listing> {
  const settled = await mapLimit(refs, MAX_CONCURRENT_READS, (ref) =>
    convertEntry(api, ref),
  );

  const entries: Entry[] = [];
  let unreadable = 0;

  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      entries.push(result.value);
    } else {
      unreadable++;
    }
  }

  return { entries, unreadable };
}

/**
 * List every item in the account.
 *
 * Stands in for `api.listItems()`, which is all-or-nothing: it validates each
 * item against a strict schema inside a `Promise.all`, so one malformed entry
 * throws away the whole listing. Here a bad item is dropped and counted.
 */
export async function listEntries(api: RemarkableApi): Promise<Listing> {
  const refs = await api.listRefs();
  return resolveEntries(api, refs);
}

/**
 * Resolve which page of the original PDF each annotated page belongs to.
 *
 * `getRmPages` returns only the pages carrying ink, keyed by page id and in no
 * meaningful order, so an index into the original has to come from the
 * document's content metadata. Two shapes exist: a legacy flat `pages` array of
 * ids, and the newer `cPages.pages` objects. Documents in the wild use both.
 *
 * `redirectionPageMap` then maps a notebook page position onto the source PDF's
 * page, which matters once pages have been inserted or removed — a negative
 * entry means the page has no counterpart in the original and is dropped.
 */
export function pdfPageIndexes(
  content: unknown,
  pageIds: Iterable<string>,
): Map<string, number> {
  const c = content as Record<string, any> | null | undefined;
  const order: string[] = Array.isArray(c?.pages)
    ? (c!.pages as unknown[]).map(String)
    : Array.isArray(c?.cPages?.pages)
      ? (c!.cPages.pages as Record<string, any>[]).map((p) => String(p?.id))
      : [];

  const redirect: number[] | undefined = Array.isArray(c?.redirectionPageMap)
    ? (c!.redirectionPageMap as number[])
    : undefined;

  const out = new Map<string, number>();
  if (order.length === 0) return out;

  for (const id of pageIds) {
    const position = order.indexOf(id);
    if (position < 0) continue;

    const target = redirect?.[position] ?? position;
    if (target >= 0) out.set(id, target);
  }
  return out;
}
