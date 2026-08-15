import { extname, basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";
import type { RemarkableApi } from "rmapi-js";
import type { Output } from "../output.js";
import { humanSize } from "../output.js";
import { client } from "../auth.js";
import { listEntries } from "../entries.js";
import { bool, parseFlags, requirePositional, str } from "../flags.js";
import {
  buildTree,
  mkdirp,
  nodesAt,
  normalizePath,
  parentPath as parentPathOf,
  resolvePutDestination,
  type Node,
} from "../paths.js";
import { articleToEpub, documentName } from "../article.js";

const UPLOADABLE = new Set([".pdf", ".epub"]);

interface Source {
  ext: ".pdf" | ".epub";
  buffer: Uint8Array;
  size: number;
  name: string;
  url?: string;
}

/** `--keep-old` is retired outright, not redirected — see specs/commands/README.md. */
function rejectKeepOld(args: string[]): void {
  if (!args.some((a) => a === "--keep-old" || a.startsWith("--keep-old="))) {
    return;
  }
  throw new AxiError(
    "--keep-old is retired; it left two documents at one path",
    "UNKNOWN_FLAG",
    [
      "to carry annotations onto the new version, use --keep-ink",
      "to keep the old version as a separate document, give it a distinct --name",
    ],
  );
}

/** Load and validate a local file source. */
async function loadLocal(file: string, nameOverride: string): Promise<Source> {
  const ext = extname(file).toLowerCase();

  if (ext === ".html") {
    throw new AxiError(
      `cannot upload ${file}: HTML sources are not supported yet`,
      "UNSUPPORTED_FORMAT",
      [
        "HTML upload needs `render`, which is not implemented yet",
        "The reMarkable cloud accepts .pdf and .epub directly; a URL source converts to EPUB automatically",
      ],
    );
  }

  if (!UPLOADABLE.has(ext)) {
    throw new AxiError(
      `cannot upload ${ext || "a file with no extension"}`,
      "UNSUPPORTED_FORMAT",
      [
        "The reMarkable cloud accepts .pdf and .epub directly",
        "Pass a URL instead to convert a web article to EPUB automatically",
      ],
    );
  }

  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      throw new AxiError(`not a file: ${file}`, "NOT_FOUND", [
        "Pass a path to a .pdf or .epub file",
      ]);
    }
    size = info.size;
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(`no such file: ${file}`, "NOT_FOUND", [
      "Check the path and try again",
    ]);
  }

  const buffer = new Uint8Array(await readFile(file));
  const name = documentName(nameOverride || basename(file, ext));

  return { ext: ext as ".pdf" | ".epub", buffer, size, name };
}

/** Fetch and convert a URL source. */
async function loadUrl(url: string, nameOverride: string): Promise<Source> {
  const { name, buffer, article } = await articleToEpub(
    url,
    nameOverride || undefined,
  );
  return { ext: ".epub", buffer, size: buffer.byteLength, name, url: article.sourceUrl };
}

async function upload(
  api: RemarkableApi,
  ext: ".pdf" | ".epub",
  name: string,
  parent: string,
  bytes: Uint8Array,
): Promise<string> {
  const ref =
    ext === ".pdf"
      ? await api.putPdf(name, bytes, { parent })
      : await api.putEpub(name, bytes, { parent });
  return ref.id;
}

/** A dated, distinguishable name for the superseded document on its way to trash. */
function backupName(name: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${name} (replaced ${stamp})`;
}

/**
 * Rename the superseded document on its way to trash so it is distinguishable
 * from the document that replaced it, then trash it. Best-effort: the new
 * document is already live by the time this runs, so a failure here is a
 * warning rather than a thrown error.
 */
async function trashSuperseded(
  api: RemarkableApi,
  old: Node,
): Promise<{ ok: true; name: string } | { ok: false }> {
  const renamed = backupName(old.entry.visibleName);
  try {
    const ref = await api.rename(
      { id: old.entry.id, hash: old.entry.hash },
      renamed,
    );
    await api.delete({ id: ref.id, hash: ref.hash });
    return { ok: true, name: renamed };
  } catch {
    return { ok: false };
  }
}

export async function put(args: string[]): Promise<Output> {
  rejectKeepOld(args);

  const parsed = parseFlags("put", args, {
    value: ["--name"],
    boolean: ["--replace"],
  });

  const src = requirePositional(
    parsed,
    0,
    "a source (a file path or URL)",
    "Run `remarkable-axi put <src> <dest>`",
  );
  const destRaw = requirePositional(
    parsed,
    1,
    "a destination path",
    "Run `remarkable-axi put <src> <dest>`",
  );

  const nameOverride = str(parsed, "--name", "");
  const isUrl = /^https?:\/\//i.test(src);
  const source = isUrl
    ? await loadUrl(src, nameOverride)
    : await loadLocal(src, nameOverride);

  const api = await client();
  const tree = buildTree((await listEntries(api)).entries);

  if (bool(parsed, "--replace")) {
    const destPath = normalizePath(destRaw);
    const target = nodesAt(tree, destPath);

    if (target.length === 0) {
      throw new AxiError(`nothing to replace at ${destPath}`, "NOT_FOUND", [
        `Run \`remarkable-axi put ${src} ${destPath}\` to upload it as new`,
      ]);
    }
    if (target.length > 1) {
      throw new AxiError(
        `${target.length} documents share the path ${destPath}`,
        "AMBIGUOUS",
        [
          `Ids: ${target.map((n) => n.entry.id.slice(0, 8)).join(", ")}`,
          "Rename or remove the duplicates first, then replace the survivor",
        ],
      );
    }

    const old = target[0]!;
    if (old.entry.type !== "DocumentType") {
      throw new AxiError(`not a document: ${destPath}`, "USAGE", [
        "put --replace swaps a document's contents; it cannot replace a folder",
      ]);
    }

    const name = documentName(nameOverride || old.entry.visibleName);
    const parent = old.entry.parent ?? "";

    // Upload first: if this throws, the original is still there.
    await upload(api, source.ext, name, parent, source.buffer);
    const trash = await trashSuperseded(api, old);

    return {
      uploaded: {
        name,
        path: destPath,
        size: humanSize(source.size),
        format: source.ext.slice(1),
      },
      ...(source.url ? { source: source.url } : {}),
      ...(trash.ok
        ? { backup: { trashed: trash.name, id: old.entry.id.slice(0, 8) } }
        : { warning: "the superseded document could not be moved to trash" }),
      help: [
        `Run \`remarkable-axi ls ${parentPathOf(destPath)}\` to confirm it landed`,
      ],
    };
  }

  const resolution = resolvePutDestination(tree, destRaw, source.name);

  if (resolution.existing.length === 1) {
    const doc = resolution.existing[0]!;
    throw new AxiError(
      `${resolution.finalPath} already exists (${doc.entry.id.slice(0, 8)})`,
      "EXISTS",
      [
        `replace it — remarkable-axi put ${src} ${resolution.finalPath} --replace`,
        `or land a distinct document — remarkable-axi put ${src} ${resolution.parentPath} --name "<distinct name>"`,
      ],
    );
  }
  if (resolution.existing.length > 1) {
    throw new AxiError(
      `${resolution.existing.length} documents already share ${resolution.finalPath}`,
      "AMBIGUOUS",
      [
        `Ids: ${resolution.existing.map((n) => n.entry.id.slice(0, 8)).join(", ")}`,
        "Rename or remove the duplicates first, then put again",
      ],
    );
  }

  let parentId = resolution.parentId;
  let created: string[] = [];
  if (resolution.needsMkdirp) {
    const made = await mkdirp(api, tree, resolution.parentPath);
    parentId = made.id;
    created = made.created;
  }

  await upload(api, source.ext, resolution.name, parentId, source.buffer);

  return {
    uploaded: {
      name: resolution.name,
      path: resolution.finalPath,
      size: humanSize(source.size),
      format: source.ext.slice(1),
    },
    ...(source.url ? { source: source.url } : {}),
    ...(created.length > 0 ? { created: created.join(", ") } : {}),
    help: [
      `Run \`remarkable-axi ls ${resolution.parentPath}\` to confirm it landed`,
    ],
  };
}
