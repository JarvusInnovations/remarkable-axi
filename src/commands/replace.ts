import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { Entry, ItemRef, RemarkableApi } from "rmapi-js";
import type { Output } from "../output.js";
import { client } from "../auth.js";
import { bool, parseFlags, requirePositional, str } from "../flags.js";
import { buildTree, normalizePath, type Node } from "../paths.js";
import { loadTree, recordMutation } from "../cache.js";
import { documentName } from "../article.js";

const UPLOADABLE = new Set([".pdf", ".epub"]);

/** Every entry resolving to exactly this path, not just the first. */
function nodesAt(
  tree: ReturnType<typeof buildTree>,
  path: string,
): Node[] {
  return [...tree.byId.values()].filter((n) => n.path === path);
}

function human(bytes: number): string {
  return bytes < 1024
    ? `${bytes}B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)}KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function upload(
  api: RemarkableApi,
  ext: string,
  name: string,
  parent: string,
  bytes: Uint8Array,
): Promise<ItemRef> {
  return ext === ".pdf"
    ? await api.putPdf(name, bytes, { parent })
    : await api.putEpub(name, bytes, { parent });
}

/**
 * Replace a document's content, leaving exactly one document at the path.
 *
 * The cloud has no in-place content update: `updateDocument` only patches
 * metadata, and `putDocumentArchive` — the one call that can keep a document's
 * id — takes a full archive and is experimental. So this is a composite, built
 * to be safe at each step rather than a convenience wrapper around two calls:
 *
 * - It uploads *before* removing anything. A failed upload leaves the original
 *   untouched, where deleting first would lose it.
 * - It removes the old entry by **id**, never by path. Paths are ambiguous when
 *   siblings share a name, and deleting by path is how you trash the wrong file.
 * - It refuses to guess when the path is already ambiguous, listing what it
 *   found instead of picking one.
 */
export async function replace(args: string[]): Promise<Output> {
  const parsed = parseFlags("replace", args, {
    value: ["--name"],
    boolean: ["--keep-old"],
  });

  const path = normalizePath(
    requirePositional(
      parsed,
      0,
      "the document path to replace",
      "Run `remarkable-axi replace <path> <file>`",
    ),
  );
  const file = requirePositional(
    parsed,
    1,
    "a local file",
    "Run `remarkable-axi replace <path> <file>`",
  );

  const ext = extname(file).toLowerCase();
  if (!UPLOADABLE.has(ext)) {
    throw new AxiError(
      `cannot upload ${ext || "a file with no extension"}`,
      "UNSUPPORTED_FORMAT",
      ["The reMarkable cloud accepts only .pdf and .epub"],
    );
  }

  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    throw new AxiError(`no such file: ${file}`, "NOT_FOUND", [
      "Check the path and try again",
    ]);
  }

  const api = await client();
  const before = buildTree((await loadTree(api)).entries);
  const existing = nodesAt(before, path);

  if (existing.length === 0) {
    throw new AxiError(`nothing to replace at ${path}`, "NOT_FOUND", [
      `Run \`remarkable-axi put ${file} ${path.split("/").slice(0, -1).join("/") || "/"}\` to upload it as new`,
    ]);
  }

  if (existing.length > 1) {
    // Replacing one of several identically-named siblings would be a coin
    // flip, and the loser would be silently destroyed.
    throw new AxiError(
      `${existing.length} documents share the path ${path}`,
      "AMBIGUOUS",
      [
        `Ids: ${existing.map((n) => n.entry.id.slice(0, 8)).join(", ")}`,
        "Rename or remove the duplicates first, then replace the survivor",
      ],
    );
  }

  const old = existing[0]!;
  if (old.entry.type !== "DocumentType") {
    throw new AxiError(`not a document: ${path}`, "USAGE", [
      "replace swaps a document's contents; it cannot replace a folder",
    ]);
  }

  const name = documentName(str(parsed, "--name", "") || old.entry.visibleName);
  const parent = old.entry.parent ?? "";
  const bytes = new Uint8Array(await readFile(file));

  // Upload first: if this throws, the original is still there.
  const newRef = await upload(api, ext, name, parent, bytes);
  const newEntry = {
    id: newRef.id,
    hash: newRef.hash,
    type: "DocumentType",
    fileType: ext.slice(1),
    visibleName: name,
    lastModified: new Date().toISOString(),
    lastOpened: "",
    pinned: false,
    parent,
  } as Entry;

  if (bool(parsed, "--keep-old")) {
    await recordMutation(api, { upsert: [newEntry] });
    return {
      uploaded: { name, path, size: human(size), format: ext.slice(1) },
      kept: `old entry retained (${old.entry.id.slice(0, 8)})`,
      note: "two documents now share this path",
      help: [
        `Run \`remarkable-axi find "${name}"\` to see both`,
      ],
    };
  }

  // Remove the superseded entry by id, so a duplicate name cannot misdirect it.
  let removed = true;
  try {
    await api.delete({ id: old.entry.id, hash: old.entry.hash });
  } catch {
    removed = false;
  }

  await recordMutation(api, {
    upsert: [newEntry],
    ...(removed ? { remove: [old.entry.id] } : {}),
  });

  // Verify the end state rather than assuming it: the whole point of this verb
  // is that the caller does not have to check. This also proves the cache
  // update above kept up: the reload below should be a single-request hit.
  const after = buildTree((await loadTree(api)).entries);
  const remaining = nodesAt(after, path);

  return {
    replaced: {
      path,
      name,
      size: human(size),
      format: ext.slice(1),
      newId: newRef.id.slice(0, 8),
      oldId: old.entry.id.slice(0, 8),
    },
    ...(removed ? {} : { warning: "the old entry could not be trashed" }),
    documentsAtPath: remaining.length,
    ...(remaining.length === 1
      ? {}
      : {
          warning:
            remaining.length === 0
              ? "nothing resolves at this path now — check the trash"
              : `${remaining.length} documents still share this path`,
        }),
    help: [
      remaining.length === 1
        ? `Run \`remarkable-axi ls ${path.split("/").slice(0, -1).join("/") || "/"}\` to confirm`
        : `Run \`remarkable-axi find "${name}"\` to inspect what remains`,
    ],
  };
}
