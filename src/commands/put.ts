import { extname, basename, join } from "node:path";
import { mkdtemp, readFile, rm as removeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { AxiError } from "axi-sdk-js";
import type { ItemRef, RemarkableApi } from "rmapi-js";
import type { Output } from "../output.js";
import { collapseHome, humanSize } from "../output.js";
import { client } from "../auth.js";
import { readConfig } from "../config.js";
import { panelWidth, widestPanelWidth } from "../devices.js";
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
import { pageGeometry } from "../strokes.js";
import { age } from "../time.js";
import { render } from "./render.js";
import { check } from "./check.js";

const UPLOADABLE = new Set([".pdf", ".epub"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

/** `check`'s own collapsed-finding shape, reused verbatim rather than re-declared. */
interface CheckFinding {
  pages: string;
  severity: "error" | "warn";
  check: string;
  detail: string;
}

interface Source {
  ext: ".pdf" | ".epub";
  buffer: Uint8Array;
  size: number;
  name: string;
  url?: string;
  /** Panel width image renditions were selected against, for URL sources. */
  imagesFor?: string;
  /** HTML sources only: render's page-box disposition (injected/matches/honored/overridden). */
  page?: string;
  /** HTML sources only: check's findings, in check's own shape — a collapsed array or "clean". */
  findings?: CheckFinding[] | string;
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
      "to save the annotated version first, use `remarkable-axi get <path> --overlay <file>.pdf`",
      "to keep the old version as a separate document, give it a distinct --name",
    ],
  );
}

/**
 * `--keep-ink` is designed (specs/behaviors/ink-preservation.md) but not
 * shipped: porting a superseded document's strokes onto a freshly uploaded
 * replacement needs a write path this tool could not verify as reliable
 * without live-device testing, which is out of scope here. See
 * https://github.com/JarvusInnovations/remarkable-axi/issues/21. Rejected up
 * front, before any network call, so an agent gets a targeted answer instead
 * of the generic UNKNOWN_FLAG list.
 */
function rejectKeepInk(args: string[]): void {
  if (!args.some((a) => a === "--keep-ink" || a.startsWith("--keep-ink="))) {
    return;
  }
  throw new AxiError(
    "--keep-ink is not implemented; the write path to port ink onto a replacement could not be verified as reliable",
    "UNKNOWN_FLAG",
    [
      "save the annotated version first — remarkable-axi get <path> --overlay <file>.pdf",
      "then replace and let the tablet copy's ink go — remarkable-axi put <src> <dest> --replace --discard-ink",
      "https://github.com/JarvusInnovations/remarkable-axi/issues/21",
    ],
  );
}

/**
 * Render an HTML source to a device-boxed PDF and lint it, sharing the exact
 * `render`/`check` implementations rather than re-deriving any of their
 * logic — see specs/commands/put.md#html-sources-and-page-geometry. That
 * reuse is what keeps page-box injection and the mismatch report
 * byte-identical to `render`'s, and findings in `check`'s own shape.
 *
 * `render` is called first, with `--device-page` forwarded when asked for,
 * and `check` then lints the PDF `render` actually produced — never the
 * original source, which `check` would re-render on its own and could in
 * principle disagree with about the page box. `render` and `check` also own
 * every failure this step can hit (`NOT_FOUND`, `NO_DEVICE`, `MISSING_TOOL`,
 * `RENDER_FAILED`) for free.
 *
 * `--strict` turns an error-severity finding fatal here, before anything is
 * uploaded; short of that, findings ride along in the upload output as a
 * warning — never blocking a document the user already decided to ship.
 */
async function loadHtml(
  file: string,
  ext: string,
  nameOverride: string,
  opts: { devicePage: boolean; strict: boolean },
): Promise<Source> {
  const dir = await mkdtemp(join(tmpdir(), "remarkable-axi-put-"));
  try {
    const tempPdf = join(dir, "rendered.pdf");
    const renderOutput = await render([
      file,
      "--out",
      tempPdf,
      ...(opts.devicePage ? ["--device-page"] : []),
    ]);
    const page = (renderOutput.rendered as { page: string }).page;

    const checkOutput = await check([tempPdf, "--no-images"]);
    const findings = checkOutput.findings as CheckFinding[] | string;

    if (opts.strict) {
      const errors = Array.isArray(findings)
        ? findings.filter((f) => f.severity === "error")
        : [];
      if (errors.length > 0) {
        throw new AxiError(
          `${errors.length} error-severity finding${errors.length === 1 ? "" : "s"} on ${collapseHome(file)}; --strict treats these as fatal`,
          "LINT_FAILED",
          [
            ...errors.map((f) => `pages ${f.pages}: ${f.check} — ${f.detail}`),
            `Run \`remarkable-axi check ${collapseHome(file)}\` for the full report`,
            "Drop --strict to upload anyway with the findings reported",
          ],
        );
      }
    }

    const buffer = new Uint8Array(await readFile(tempPdf));
    const name = documentName(nameOverride || basename(file, ext));

    return { ext: ".pdf", buffer, size: buffer.byteLength, name, page, findings };
  } finally {
    // The cloud copy is the deliverable; the rendered PDF's bytes are
    // already captured above, so nothing later in `put` reads this file
    // again — safe to clean up immediately rather than leaving it for an
    // upload that might not even happen (an occupied destination, say).
    await removeFile(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Load and validate a local file source. */
async function loadLocal(
  file: string,
  nameOverride: string,
  opts: { devicePage: boolean; strict: boolean },
): Promise<Source> {
  const ext = extname(file).toLowerCase();

  if (HTML_EXTENSIONS.has(ext)) {
    return loadHtml(file, ext, nameOverride, opts);
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

/**
 * Fetch and convert a URL source.
 *
 * Image renditions are chosen against the panel this document is headed for:
 * the configured device when there is one, otherwise the widest panel any
 * reMarkable has, so the result is never short of resolution for the hardware
 * the user actually owns. `imagesFor` is reported so the choice is visible
 * rather than implicit.
 */
async function loadUrl(url: string, nameOverride: string): Promise<Source> {
  const configured = (await readConfig()).targetDevice;
  const targetWidth = configured ? panelWidth(configured) : widestPanelWidth();

  const { name, buffer, article } = await articleToEpub(
    url,
    nameOverride || undefined,
    targetWidth,
  );
  return {
    ext: ".epub",
    buffer,
    size: buffer.byteLength,
    name,
    url: article.sourceUrl,
    imagesFor: configured
      ? `${targetWidth}px (${configured})`
      : `${targetWidth}px (widest panel — no device target set)`,
  };
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

/** How much ink a `--replace` target carries, when it carries any. */
interface InkSummary {
  inkedPages: number;
  totalPages: number;
}

/**
 * Whether a document carries ink, and on how many of its pages — see
 * specs/behaviors/ink-preservation.md#warning-before-replacing-inked-documents.
 *
 * A page's `.rm` entry existing is not proof of ink: the device creates one
 * the moment a page is merely opened (or pen-hovered), with zero strokes
 * inside, and counting those as ink fires the refusal on documents nobody
 * wrote on (https://github.com/JarvusInnovations/remarkable-axi/issues/28).
 * **A page counts as inked only when its stroke file holds at least one
 * stroke.**
 *
 * Whether entry *size* alone could tell the two cases apart without a fetch
 * was measured against the v6 `.rm` codec itself (`rmapi-js`'s writer, used
 * directly rather than guessed): a minimal opened-but-undrawn page's
 * scaffolding blocks (scene tree, layer, page-info, scene-info) serialize to
 * ~176 bytes, ~209 with an author-id table, and the smallest possible real
 * stroke — a single-point tap — adds only ~74 bytes on top of that. No real
 * zero-stroke sample was available to bound how large the device's own
 * scaffolding actually gets in practice (extra layers, undo/redo history, a
 * larger author table on a multi-device doc), so that ~74-byte margin cannot
 * be called safe. A wrong threshold would silently discard real ink — the
 * worst failure available here — so size is not used to decide. Every
 * candidate `.rm` entry is instead fetched and parsed, and `pageGeometry`
 * (the same function `get --overlay` already trusts to answer "is there ink
 * here", which is what #28 found disagreeing with this check) decides for
 * real: one request per page that was at least opened, never on the common
 * never-touched path, which still costs nothing.
 */
async function detectInk(
  api: RemarkableApi,
  ref: ItemRef,
): Promise<InkSummary | null> {
  const { entries } = await api.raw.getEntries(ref);
  const candidates = entries.filter((e) => e.id.endsWith(".rm"));
  if (candidates.length === 0) return null;

  const carriesInk = await Promise.all(
    candidates.map(async (entry) => {
      try {
        const page = await api.raw.getRm(entry);
        return pageGeometry(page).strokes.length > 0;
      } catch {
        // Unreadable, not absent: refuse rather than silently dropping a
        // page that might carry real ink from the count.
        return true;
      }
    }),
  );
  const inkedPages = carriesInk.filter(Boolean).length;
  if (inkedPages === 0) return null;

  const contentEntry = entries.find((e) => e.id.endsWith(".content"));
  let totalPages = inkedPages;
  if (contentEntry) {
    try {
      const content = (await api.raw.getContent(contentEntry)) as {
        pageCount?: number;
      };
      if (typeof content.pageCount === "number" && content.pageCount > 0) {
        totalPages = content.pageCount;
      }
    } catch {
      // Content unreadable: still refuse, just without the "of N" figure —
      // the inked count alone already answers the question that matters.
    }
  }
  return { inkedPages, totalPages };
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
  rejectKeepInk(args);

  const parsed = parseFlags("put", args, {
    value: ["--name"],
    boolean: ["--replace", "--discard-ink", "--device-page", "--strict"],
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
  // --device-page and --strict only mean anything for an HTML source;
  // loadLocal ignores them for a .pdf/.epub source, same as --discard-ink
  // is ignored without --replace — an inapplicable flag is a no-op here,
  // not a refusal.
  const source = isUrl
    ? await loadUrl(src, nameOverride)
    : await loadLocal(src, nameOverride, {
        devicePage: bool(parsed, "--device-page"),
        strict: bool(parsed, "--strict"),
      });

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

    // The ink check only ever sees the cloud's copy of the target — strokes
    // written on-device since its last sync are invisible to it. Disclosed
    // on every outcome rather than closed, since it cannot be closed from
    // the cloud — see
    // specs/behaviors/ink-preservation.md#cloud-checks-see-only-synced-ink.
    const lastSynced = age(old.entry.lastModified);

    if (!bool(parsed, "--discard-ink")) {
      const ink = await detectInk(api, {
        id: old.entry.id,
        hash: old.entry.hash,
      });
      if (ink) {
        throw new AxiError(
          `${destPath} has ink on ${ink.inkedPages} of ${ink.totalPages} pages; --replace would discard it\n` +
            `last synced ${lastSynced} — ink written on-device since then is invisible to this check`,
          "HAS_INK",
          [
            `save it separately first — remarkable-axi get ${destPath} --overlay <file>.pdf`,
            `or replace and let it go — remarkable-axi put ${src} ${destPath} --replace --discard-ink`,
          ],
        );
      }
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
      ...(source.page ? { page: source.page } : {}),
      ...(source.findings !== undefined ? { findings: source.findings } : {}),
      ...(source.url ? { source: source.url } : {}),
      ...(source.imagesFor ? { images_for: source.imagesFor } : {}),
      last_synced: lastSynced,
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
    ...(source.page ? { page: source.page } : {}),
    ...(source.findings !== undefined ? { findings: source.findings } : {}),
    ...(source.url ? { source: source.url } : {}),
    ...(source.imagesFor ? { images_for: source.imagesFor } : {}),
    ...(created.length > 0 ? { created: created.join(", ") } : {}),
    help: [
      `Run \`remarkable-axi ls ${resolution.parentPath}\` to confirm it landed`,
    ],
  };
}
