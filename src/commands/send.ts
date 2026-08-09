import { extname, basename } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";
import { client } from "../auth.js";
import { listEntries } from "../entries.js";
import { parseFlags, str, requirePositional } from "../flags.js";
import { buildTree, mkdirp, normalizePath } from "../paths.js";
import { articleToEpub, documentName } from "../article.js";

function kb(bytes: number): string {
  return bytes < 1024
    ? `${bytes}B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)}KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function send(args: string[]): Promise<Output> {
  const parsed = parseFlags("send", args, {
    value: ["--dir", "--title"],
    deprecated: {
      "--format":
        "--format was removed; articles are always sent as EPUB, which reflows on e-ink. Use `put` for a PDF you already have",
      "--url": "--url was removed; pass the URL positionally: `send <url>`",
    },
  });

  const url = requirePositional(
    parsed,
    0,
    "a URL",
    "Run `remarkable-axi send <url> --dir /Articles`",
  );
  const dir = normalizePath(str(parsed, "--dir", "/"));
  const titleOverride = str(parsed, "--title", "") || undefined;

  const { name, buffer, article } = await articleToEpub(url, titleOverride);

  const api = await client();
  const tree = buildTree((await listEntries(api)).entries);
  const { id: parent, created } = await mkdirp(api, tree, dir);

  await api.putEpub(name, buffer, {
    parent,
    title: article.title,
    ...(article.byline ? { authors: [article.byline] } : {}),
    publicationDate: new Date().toISOString(),
  });

  return {
    sent: {
      name,
      dir,
      size: kb(buffer.byteLength),
      images: article.images.length,
      words: Math.round(article.textLength / 5),
      source: article.sourceUrl,
    },
    ...(created.length > 0 ? { created: created.join(", ") } : {}),
    help: [
      `Run \`remarkable-axi ls ${dir}\` to confirm it landed`,
      "The tablet shows it after its next cloud sync",
    ],
  };
}

const UPLOADABLE = new Set([".pdf", ".epub"]);

export async function put(args: string[]): Promise<Output> {
  const parsed = parseFlags("put", args, { value: ["--name"] });

  const file = requirePositional(
    parsed,
    0,
    "a file path",
    "Run `remarkable-axi put <file> [<dir>]`",
  );
  const dir = normalizePath(parsed.positional[1] ?? "/");

  const ext = extname(file).toLowerCase();
  if (!UPLOADABLE.has(ext)) {
    throw new AxiError(
      `cannot upload ${ext || "a file with no extension"}`,
      "UNSUPPORTED_FORMAT",
      [
        "The reMarkable cloud accepts only .pdf and .epub",
        "Run `remarkable-axi send <url>` to convert a web article to EPUB",
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
  const name = documentName(
    str(parsed, "--name", "") || basename(file, extname(file)),
  );

  const api = await client();
  const tree = buildTree((await listEntries(api)).entries);
  const { id: parent, created } = await mkdirp(api, tree, dir);

  if (ext === ".pdf") {
    await api.putPdf(name, buffer, { parent });
  } else {
    await api.putEpub(name, buffer, { parent });
  }

  return {
    uploaded: { name, dir, size: kb(size), format: ext.slice(1) },
    ...(created.length > 0 ? { created: created.join(", ") } : {}),
    help: [`Run \`remarkable-axi ls ${dir}\` to confirm it landed`],
  };
}
