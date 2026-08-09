import type { Output } from "../output.js";
import { collapseHome } from "../output.js";
import { readToken, tokenPath } from "../auth.js";
import { client } from "../auth.js";
import { listEntries } from "../entries.js";
import { age, recencyKey } from "../time.js";
import { buildTree, type Node } from "../paths.js";

const CONNECT_URL = "https://my.remarkable.com/device/desktop/connect";
const RECENT_LIMIT = 8;

/**
 * The no-argument view, which also serves as the SessionStart hook payload.
 *
 * This loads on every agent session, so it stays deliberately small: identity,
 * pairing state, and a short recency window. Anything deeper belongs in an
 * explicit command.
 */
export async function home(): Promise<Output> {
  const token = await readToken();

  if (!token) {
    return {
      status: "not paired",
      token: `not found at ${collapseHome(tokenPath)}`,
      help: [
        `Get an 8-character code from ${CONNECT_URL}`,
        "Run `remarkable-axi login <code>` to pair this machine",
      ],
    };
  }

  let nodes: Node[];
  try {
    const api = await client();
    nodes = [...buildTree((await listEntries(api)).entries).byId.values()];
  } catch (error) {
    // The hook must never break a session start, so an unreachable cloud
    // degrades to a status line rather than an error.
    return {
      status: "paired, cloud unreachable",
      error: error instanceof Error ? error.message : String(error),
      help: ["Run `remarkable-axi doctor` to diagnose"],
    };
  }

  const documents = nodes.filter((n) => n.entry.type === "DocumentType");
  const folders = nodes.filter((n) => n.entry.type === "CollectionType");

  if (documents.length === 0) {
    return {
      status: `paired, 0 documents, ${folders.length} folders`,
      help: [
        "Run `remarkable-axi send <url> --dir /Articles` to send a web article",
        "Run `remarkable-axi put <file> <dir>` to upload a PDF or EPUB",
      ],
    };
  }

  const recent = [...documents]
    .sort((a, b) => recencyKey(b.entry.lastModified) - recencyKey(a.entry.lastModified))
    .slice(0, RECENT_LIMIT);

  return {
    status: `paired, ${documents.length} documents, ${folders.length} folders`,
    recent: recent.map((n) => ({
      type: n.entry.type === "DocumentType" ? n.entry.fileType : "folder",
      path: n.path,
      modified: age(n.entry.lastModified),
    })),
    help: [
      documents.length > RECENT_LIMIT
        ? `Run \`remarkable-axi ls --all\` for all ${documents.length} documents`
        : undefined,
      "Run `remarkable-axi send <url> --dir /Articles` to send a web article",
      "Run `remarkable-axi ls <path>` to browse a folder",
    ].filter(Boolean) as string[],
  };
}
