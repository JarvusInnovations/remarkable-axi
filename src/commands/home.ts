import type { Output } from "../output.js";
import { collapseHome } from "../output.js";
import { readToken, tokenPath } from "../auth.js";
import { client } from "../auth.js";
import { loadTree } from "../cache.js";
import { age, recencyKey } from "../time.js";
import { readConfig } from "../config.js";
import { spec } from "../devices.js";
import { buildTree, type Node } from "../paths.js";
import { DESIGN_ENTRY_HINT } from "../hints.js";

const CONNECT_URL = "https://my.remarkable.com/device/desktop/connect";
const RECENT_LIMIT = 8;

/**
 * The target device block, when one is set.
 *
 * This rides in the every-session payload because it is what a caller needs
 * *before* generating anything for the tablet — chiefly `pagePt`, since sizing
 * a page to the panel's pixels produces something several times too large.
 * Absent a target it is omitted rather than guessed at.
 */
async function targetBlock(): Promise<Record<string, unknown>> {
  const { targetDevice } = await readConfig();
  if (!targetDevice) return {};

  const s = spec(targetDevice);
  return {
    target: {
      name: s.name,
      model: s.model,
      screen: s.screen,
      dpi: s.dpi,
      pagePt: s.pagePt,
    },
  };
}

/**
 * The no-argument view, which also serves as the SessionStart hook payload.
 *
 * This loads on every agent session, so it stays deliberately small: identity,
 * pairing state, and a short recency window. Anything deeper belongs in an
 * explicit command.
 *
 * Tree state comes from the generation-keyed cache (`src/cache.ts`): an
 * unchanged root costs one request, a changed root costs one plus metadata
 * for whatever moved, and an unreachable cloud degrades to the cached tree
 * with its age stated rather than producing no output at all — see
 * `specs/behaviors/cloud-cache.md`.
 */
export async function home(): Promise<Output> {
  const token = await readToken();

  if (!token) {
    return {
      status: "not paired",
      ...(await targetBlock()),
      token: `not found at ${collapseHome(tokenPath)}`,
      help: [
        `Get an 8-character code from ${CONNECT_URL}`,
        "Run `remarkable-axi login <code>` to pair this machine",
      ],
    };
  }

  let result;
  try {
    const api = await client();
    result = await loadTree(api);
  } catch (error) {
    // No cache to fall back on, so this is a genuine structured error rather
    // than a degrade — but the hook must never break a session start, so it
    // still exits 0 with a payload that plainly signals "no data" rather than
    // pretending to have healthy counts.
    return {
      status: "paired, cloud unreachable, no cached data",
      ...(await targetBlock()),
      error: error instanceof Error ? error.message : String(error),
      help: [
        "Run `remarkable-axi doctor` to diagnose",
        "Retry once the reMarkable cloud is reachable",
      ],
    };
  }

  const nodes = [...buildTree(result.entries).byId.values()];
  const documents = nodes.filter((n) => n.entry.type === "DocumentType");
  const folders = nodes.filter((n) => n.entry.type === "CollectionType");

  const cloudNote =
    result.source === "stale"
      ? ` (cached, ${age(result.updatedAt)} old — cloud unreachable)`
      : "";

  if (documents.length === 0) {
    return {
      status: `paired, 0 documents, ${folders.length} folders${cloudNote}`,
      ...(await targetBlock()),
      help: [
        'Run `remarkable-axi put "<url>" /Articles` to send a web article',
        "Run `remarkable-axi put <file> <dest>` to upload a PDF or EPUB",
        DESIGN_ENTRY_HINT,
      ],
    };
  }

  // The documents this call actually fetched — because their hash moved
  // since the cache was last validated — are exactly what the recent section
  // wants to show, so there is no separate pass to compute it. On a cache hit
  // or a stale degrade nothing moved, so fall back to the fully-known tree
  // rather than showing nothing: the whole point of the cache is that it's
  // already available for free.
  const changedIds = new Set(result.changed.map((e) => e.id));
  const changedDocuments = documents.filter((n) => changedIds.has(n.entry.id));
  // Fall back on an empty *pool*, not on an empty changed set. A delta can be
  // non-empty and still contain no document that survives into the tree —
  // deleting a document is a change whose entry is then excluded as trashed,
  // which left the section blank on an account holding hundreds of files.
  const pool = changedDocuments.length > 0 ? changedDocuments : documents;

  const recent = [...pool]
    .sort((a, b) => recencyKey(b.entry.lastModified) - recencyKey(a.entry.lastModified))
    .slice(0, RECENT_LIMIT);

  return {
    status: `paired, ${documents.length} documents, ${folders.length} folders${cloudNote}`,
    ...(await targetBlock()),
    recent: recent.map((n: Node) => ({
      type: n.entry.type === "DocumentType" ? n.entry.fileType : "folder",
      path: n.path,
      modified: age(n.entry.lastModified),
    })),
    help: [
      documents.length > RECENT_LIMIT
        ? `Run \`remarkable-axi ls --all\` for all ${documents.length} documents`
        : undefined,
      'Run `remarkable-axi put "<url>" /Articles` to send a web article',
      "Run `remarkable-axi ls <path>` to browse a folder",
      DESIGN_ENTRY_HINT,
    ].filter(Boolean) as string[],
  };
}
