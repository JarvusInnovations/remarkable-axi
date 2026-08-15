import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";
import type { Entry, ItemRef, RemarkableApi } from "rmapi-js";
import { readToken } from "./auth.js";
import { resolveEntries } from "./entries.js";

const CONFIG_DIR = join(homedir(), ".config", "remarkable-axi");
const CACHE_FILE = join(CONFIG_DIR, "cache.json");

/** Absolute path of the cache file, for diagnostics. */
export const cachePath = CACHE_FILE;

/**
 * Root-hash sentinel meaning "these entries are useful but unvalidated".
 *
 * Root hashes are hex, so this can never collide with a real one, and any
 * comparison against the live root fails — which is the point. Written by
 * `recordMutation`; see the reasoning there.
 */
const UNVALIDATED = "unvalidated";

interface CacheFile {
  version: 1;
  /**
   * Fingerprint of the pairing token this cache was built under.
   *
   * The cache lives alongside the token but is not itself account-scoped by
   * the filesystem — a re-`login` to a different account must not serve the
   * previous account's tree, so the fingerprint is checked on every read.
   */
  account: string;
  rootHash: string;
  generation: number;
  /** When this file was last written — the age reported to the caller. */
  updatedAt: string;
  entries: Entry[];
}

/** How a `loadTree` answer was produced. */
export type TreeSource =
  /** Root hash unchanged: the cache was valid outright, one request. */
  | "cache"
  /** No cache, or the root hash moved: the delta was fetched and merged. */
  | "refreshed"
  /** The root call failed or timed out; degraded to the cache we have. */
  | "stale";

export interface LoadResult {
  entries: Entry[];
  /** Items in this call's own fetch that could not be read. Not a running total. */
  unreadable: number;
  generation: number;
  /**
   * Entries whose hash moved since the cache was last validated — empty on a
   * `"cache"` hit and on a `"stale"` degrade. This is the same set the home
   * view's recent section renders: fetching it to keep the cache current and
   * rendering it as "what's new" are the same work.
   */
  changed: Entry[];
  /** Cached entries dropped this round because they no longer appear in the root index. */
  removedCount: number;
  /** When the on-disk cache content was last written (not merely validated). */
  updatedAt: string;
  source: TreeSource;
}

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

async function currentAccount(): Promise<string> {
  const token = await readToken();
  return token ? fingerprint(token) : "";
}

/**
 * Read the cache, treating anything unreadable, malformed, or from a
 * different account as absent.
 *
 * Local cache state should never stop a command from running — worst case is
 * paying for a full rebuild, the same cost as before this cache existed.
 */
async function readCacheFile(account: string): Promise<CacheFile | null> {
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Partial<CacheFile>;
    if (
      parsed.version !== 1 ||
      typeof parsed.account !== "string" ||
      typeof parsed.rootHash !== "string" ||
      typeof parsed.generation !== "number" ||
      typeof parsed.updatedAt !== "string" ||
      !Array.isArray(parsed.entries)
    ) {
      return null;
    }
    if (parsed.account !== account) return null; // a different account was paired since
    return parsed as CacheFile;
  } catch {
    return null;
  }
}

/** Best-effort write: a failed persist just means the next call rebuilds. */
async function writeCacheFile(cache: CacheFile): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    await writeFile(CACHE_FILE, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  } catch {
    // Non-fatal: local state, not the source of truth.
  }
}

/** Discard the cache. The only supported repair when it is suspected wrong. */
export async function discardCache(): Promise<void> {
  try {
    await rm(CACHE_FILE, { force: true });
  } catch {
    // Already gone, or unwritable — either way there is nothing left to do.
  }
}

/**
 * Load the document tree, validated against the root generation.
 *
 * - Root hash unchanged → the cache is served outright. One request.
 * - Root hash changed (or no cache exists) → the root index gives every
 *   document's own hash, and metadata is refetched only for the ones whose
 *   hash moved.
 * - The root call itself fails or times out → the cache is served with its
 *   age, if one exists.
 *
 * @throws AxiError with code `CLOUD_UNREACHABLE` when the root call fails
 *   and there is no cache to fall back on — the one case with nothing useful
 *   to serve.
 */
export async function loadTree(api: RemarkableApi): Promise<LoadResult> {
  const account = await currentAccount();
  const cached = await readCacheFile(account);

  let rootHash: string;
  let generation: number;
  try {
    [rootHash, generation] = await api.raw.getRootHash();
  } catch (error) {
    if (cached) {
      return {
        entries: cached.entries,
        unreadable: 0,
        generation: cached.generation,
        changed: [],
        removedCount: 0,
        updatedAt: cached.updatedAt,
        source: "stale",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AxiError(
      `reMarkable cloud unreachable and no cached tree exists: ${message}`,
      "CLOUD_UNREACHABLE",
      [
        "Check network connectivity to the reMarkable cloud",
        "Retry — this has been observed to clear on a second attempt",
      ],
    );
  }

  if (cached && cached.rootHash === rootHash && cached.generation === generation) {
    return {
      entries: cached.entries,
      unreadable: 0,
      generation,
      changed: [],
      removedCount: 0,
      updatedAt: cached.updatedAt,
      source: "cache",
    };
  }

  // Root changed (or there is no cache): the root index carries every
  // document's own hash, so only the ones that moved need a metadata fetch.
  const refs = await api.listRefs();
  const cachedById = new Map((cached?.entries ?? []).map((e) => [e.id, e]));
  const freshIds = new Set(refs.map((r) => r.id));

  const toFetch: ItemRef[] = refs.filter((ref) => {
    const prior = cachedById.get(ref.id);
    return !prior || prior.hash !== ref.hash;
  });
  const toFetchIds = new Set(toFetch.map((r) => r.id));

  const { entries: changed, unreadable } = await resolveEntries(api, toFetch);

  const unchanged = (cached?.entries ?? []).filter(
    (e) => freshIds.has(e.id) && !toFetchIds.has(e.id),
  );
  const removedCount = (cached?.entries ?? []).filter(
    (e) => !freshIds.has(e.id),
  ).length;
  const entries = [...unchanged, ...changed];
  const updatedAt = new Date().toISOString();

  await writeCacheFile({
    version: 1,
    account,
    rootHash,
    generation,
    updatedAt,
    entries,
  });

  return {
    entries,
    unreadable,
    generation,
    changed,
    removedCount,
    updatedAt,
    source: "refreshed",
  };
}

export interface Mutation {
  /** Entries created or changed by a mutation this tool just performed. */
  upsert?: Entry[];
  /** Ids of entries this tool just moved to the trash or superseded. */
  remove?: string[];
}

/**
 * Fold a mutation this tool just performed into the cached entries, and mark
 * the cache as needing reconciliation.
 *
 * A `put`, `mv`, or `rm` already knows exactly what it changed, so keeping
 * those entries saves the next read from refetching their metadata.
 *
 * What it deliberately does *not* do is claim the cache is current. Writing
 * the post-mutation root hash here would be unsound: mutations are
 * root-rewrites guarded by a generation counter, so a concurrent write from
 * the device or another client causes ours to rebase onto theirs. The root
 * hash we would read back therefore covers their change too — which is not
 * in our entries. The next read would see a matching hash, call it a cache
 * hit, and serve a tree silently missing their document.
 *
 * So the cache is left deliberately unvalidated. The next `loadTree` takes
 * the delta path and reconciles, which costs one `listRefs` — flat, not
 * proportional to account size — and refetches metadata only for what
 * genuinely moved, which after our own bookkeeping is usually nothing. The
 * expensive part was always the per-document fetches, and those are still
 * avoided.
 *
 * Best-effort throughout: this is a local optimization, not the source of
 * truth, so any failure here is silent and simply gives up the speedup for
 * the next call rather than the mutation that already succeeded.
 */
export async function recordMutation(
  _api: RemarkableApi,
  mutation: Mutation,
): Promise<void> {
  try {
    const account = await currentAccount();
    const cached = await readCacheFile(account);
    if (!cached) return; // nothing to keep current; the next read builds fresh

    const removeIds = new Set(mutation.remove ?? []);
    const upsertById = new Map((mutation.upsert ?? []).map((e) => [e.id, e]));

    const entries = cached.entries
      .filter((e) => !removeIds.has(e.id) && !upsertById.has(e.id))
      .concat([...upsertById.values()]);

    await writeCacheFile({
      version: 1,
      account,
      // Never matches a real root hash, so the next read reconciles rather
      // than trusting entries we assembled locally. See above.
      rootHash: UNVALIDATED,
      generation: cached.generation,
      updatedAt: new Date().toISOString(),
      entries,
    });
  } catch {
    // The mutation itself already succeeded; losing the cache update just
    // means the next command pays for a rebuild instead of a fast path.
  }
}
