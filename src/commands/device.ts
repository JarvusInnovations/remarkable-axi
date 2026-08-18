import { access, mkdir, mkdtemp, rm as removeFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";
import { collapseHome, humanSize } from "../output.js";
import { parseFlags, requirePositional, str, bool, type Parsed } from "../flags.js";
import { readConfig, writeConfig } from "../config.js";
import { documentName } from "../article.js";
import { contentPageOrder } from "../entries.js";
import { pageGeometry, type PageGeometry } from "../strokes.js";
import { pagesToPdf } from "../render.js";
import { findGhostscript } from "../gs.js";
import { rasterizePage } from "../lint/rasterize.js";
import { encodeGrayscalePng } from "../lint/png.js";
import { downscaleGrayscale, fitDimensions } from "../lint/resample.js";
import { dpiFor, ensureWritable } from "./get.js";
import { spec as deviceSpec } from "../devices.js";
import { parseDeviceRm } from "../rm6.js";
import {
  backupTarCommand,
  buildMapApplyCommand,
  buildRestoreIndexCommand,
  buildRestoredContent,
  catRmCommand,
  catThumbnailCommand,
  devicePath,
  fetchDeviceDump,
  fetchDocByPath,
  orphanCandidates,
  parseMapApplyOutput,
  requireOneDeviceMatch,
  restoreOrder,
  type DeviceDoc,
  type DevicePathMatch,
  type StrokeDisposition,
  type StrokeMapping,
} from "../device-fs.js";
import {
  execRemote,
  execRemoteBinary,
  formatDocuments,
  formatStorage,
  formatXochitl,
  parseStatusOutput,
  resolveSshTarget,
  STATUS_COMMAND,
  START_XOCHITL_COMMAND,
  STOP_XOCHITL_COMMAND,
  SYNC_COMMAND,
  XOCHITL_ACTIVE_COMMAND,
  type SshTarget,
} from "../device.js";

/**
 * `setup ssh <destination> [--via <jump>]` — persist the default SSH
 * destination (and optional ProxyJump hop) every `device` command falls back
 * to. Idempotent: re-running repoints a drifted DHCP address, it never
 * refuses because a value is already set.
 */
export async function setupSsh(args: string[]): Promise<Output> {
  const parsed = parseFlags("setup ssh", args, { value: ["--via"] });
  const destination = requirePositional(
    parsed,
    0,
    "an SSH destination",
    "Run `remarkable-axi setup ssh <destination> [--via <jump>]`",
  );
  const via = str(parsed, "--via", "") || undefined;

  const previous = (await readConfig()).ssh;
  const path = await writeConfig({ ssh: via ? { destination, via } : { destination } });

  const changed =
    !previous || previous.destination !== destination || previous.via !== via;

  return {
    ssh: via ? { destination, via } : { destination },
    saved: collapseHome(path),
    ...(previous && changed
      ? {
          previous: previous.via
            ? `${previous.destination} via ${previous.via}`
            : previous.destination,
        }
      : {}),
    help: [
      "Run `remarkable-axi device status` to confirm the tablet is reachable",
      "Pass `--ssh <destination>` (and `--via <jump>`) to any `device` command to override this for one invocation",
    ],
  };
}

/**
 * `device <subcommand>` — dispatch, mirroring `setup`'s in src/commands/setup.ts.
 */
export async function device(args: string[]): Promise<Output> {
  const sub = args[0];

  if (sub === "status") return status(args.slice(1));
  if (sub === "backup") return backup(args.slice(1));
  if (sub === "orphans") return orphans(args.slice(1));
  if (sub === "reattach") return reattach(args.slice(1));

  throw new AxiError(
    sub ? `unknown device command: ${sub}` : "device needs a subcommand",
    "USAGE",
    [
      "Run `remarkable-axi device status` to check tablet connectivity",
      "Run `remarkable-axi device backup <path>` to archive a document's on-device file set",
      "Run `remarkable-axi device orphans [<path>]` to list stroke files no page index references",
      "Run `remarkable-axi device reattach <path> --map <stroke-uuid>=<page-uuid> | --restore-index` to write recovered strokes back",
    ],
  );
}

/**
 * `device status` — one SSH connection reporting reachability, xochitl,
 * storage, and local document count. Per specs/commands/device.md, this is
 * the "can recovery tooling reach the tablet right now" instant answer, run
 * before an incident rather than during one.
 */
export async function status(args: string[]): Promise<Output> {
  const parsed = parseFlags("device status", args, {
    value: ["--ssh", "--via"],
  });
  if (parsed.positional.length > 0) {
    throw new AxiError(
      `device status takes no arguments (got \`${parsed.positional[0]}\`)`,
      "USAGE",
      ["Run `remarkable-axi device status`"],
    );
  }

  const sshFlag = str(parsed, "--ssh", "") || undefined;
  const viaFlag = str(parsed, "--via", "") || undefined;

  const config = (await readConfig()).ssh;
  const target = resolveSshTarget({ ssh: sshFlag, via: viaFlag }, config);

  const stdout = await execRemote(target, STATUS_COMMAND);
  const facts = parseStatusOutput(stdout);

  return {
    device: target.via ? `reachable via ${target.via}` : "reachable",
    destination: target.destination,
    xochitl: formatXochitl(facts),
    storage: formatStorage(facts),
    documents: formatDocuments(facts),
  };
}

/** Resolve `--ssh`/`--via` against the persisted config — the same three
 * lines every `device` subcommand opens with. */
async function resolveTargetFromFlags(parsed: Parsed): Promise<SshTarget> {
  const sshFlag = str(parsed, "--ssh", "") || undefined;
  const viaFlag = str(parsed, "--via", "") || undefined;
  const config = (await readConfig()).ssh;
  return resolveSshTarget({ ssh: sshFlag, via: viaFlag }, config);
}

/** `4 indexed, 5 stroke files (1 orphaned)` — `backup`'s summary line, per
 * specs/commands/device.md#device-backup. */
function pagesSummary(indexed: number, strokeFiles: number, orphaned: number): string {
  const files = `${strokeFiles} stroke file${strokeFiles === 1 ? "" : "s"}`;
  return orphaned > 0
    ? `${indexed} indexed, ${files} (${orphaned} orphaned)`
    : `${indexed} indexed, ${files}`;
}

/** `./<name>-device-backup-<date>.tar.gz` — the default archive path both
 * `backup --out`-less invocations and `reattach`'s embedded backup use, per
 * specs/commands/device.md#device-backup. */
function defaultBackupPath(match: DevicePathMatch): string {
  const name = documentName(match.doc.visibleName) || "document";
  const date = new Date().toISOString().slice(0, 10);
  return resolve(`./${name}-device-backup-${date}.tar.gz`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `defaultBackupPath`, but never colliding with a file already there:
 * `reattach` runs unattended as part of the write ritual and has no `--out`/
 * `--force` of its own (specs/commands/device.md's usage line), so rather
 * than either clobbering an earlier backup or refusing `EXISTS` mid-ritual —
 * both wrong for an automatic, safety-critical step — a second same-day
 * reattach gets a `-2`, `-3`, … suffix instead. A prior backup is never
 * destroyed, and the ritual is never blocked by its own history.
 */
async function uniqueBackupPath(base: string): Promise<string> {
  if (!(await pathExists(base))) return base;
  const suffixAt = base.endsWith(".tar.gz") ? base.length - ".tar.gz".length : base.length;
  const stem = base.slice(0, suffixAt);
  const ext = base.slice(suffixAt);
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!(await pathExists(candidate))) return candidate;
  }
}

/**
 * `reattach`'s embedded backup — the write ritual's first, non-optional
 * step (specs/behaviors/device-access.md#reads-are-free-writes-follow-the-ritual):
 * reuses the exact tar stream `device backup` builds, refuses `BACKUP_FAILED`
 * with nothing written on any failure (network drop mid-stream, a local
 * write error), and never leaves a partial archive behind to be mistaken
 * for a complete one.
 */
async function embeddedBackup(target: SshTarget, match: DevicePathMatch): Promise<string> {
  const out = await uniqueBackupPath(defaultBackupPath(match));
  try {
    const bytes = await execRemoteBinary(target, backupTarCommand(match.uuid));
    await writeFile(out, bytes);
    return out;
  } catch (error) {
    await removeFile(out, { force: true }).catch(() => {});
    const detail = error instanceof Error ? error.message : String(error);
    throw new AxiError(`reattach's embedded backup failed on ${match.path}: ${detail}`, "BACKUP_FAILED", [
      "Nothing was written to the device — the write ritual never begins without a successful backup",
      "Run `remarkable-axi device status` to confirm the tablet is reachable, then retry",
    ]);
  }
}

/**
 * `device backup <path> [--out <tar>] [--force]` — tar a document's complete
 * on-device file set to a local archive, read-only on the device. Per
 * specs/commands/device.md, the first step of every recovery.
 */
export async function backup(args: string[]): Promise<Output> {
  const parsed = parseFlags("device backup", args, {
    value: ["--out", "--ssh", "--via"],
    boolean: ["--force"],
  });

  const pathArg = requirePositional(
    parsed,
    0,
    "a document path",
    "Run `remarkable-axi device backup <path>`",
  );
  const outFlag = str(parsed, "--out", "");
  const force = bool(parsed, "--force");

  const target = await resolveTargetFromFlags(parsed);
  // Scoped resolution — two small connections, never the account-wide dump.
  const match = await fetchDocByPath(target, pathArg);

  if (match.doc.type !== "DocumentType") {
    throw new AxiError(`not a document on the device: ${match.path}`, "USAGE", [
      "device backup archives one document; run `remarkable-axi device orphans` (with no path) to sweep everything",
    ]);
  }

  const indexed = contentPageOrder(match.doc.content).length;
  const strokeFiles = match.doc.rmFiles.length;
  const orphaned = orphanCandidates(match.doc).length;

  const redirectHint = `remarkable-axi device backup "${pathArg}"`;
  const out = outFlag ? resolve(outFlag) : defaultBackupPath(match);
  await ensureWritable(out, force, redirectHint);

  console.error(`streaming ${match.path} off the tablet...`);
  const bytes = await execRemoteBinary(target, backupTarCommand(match.uuid));
  await writeFile(out, bytes);

  return {
    backup: {
      path: match.path,
      uuid: match.uuid,
      archive: collapseHome(out),
      size: humanSize(bytes.byteLength),
      pages: pagesSummary(indexed, strokeFiles, orphaned),
    },
    ...(orphaned > 0
      ? {
          help: [
            `Run \`remarkable-axi device orphans "${match.path}" --render\` to see what the ${orphaned} orphaned stroke file${orphaned === 1 ? "" : "s"} hold${orphaned === 1 ? "s" : ""}`,
          ],
        }
      : {}),
  };
}

/** `YYYY-MM-DD HH:MM`, UTC — deterministic across test machines and readable
 * without a timezone dependency; matches the shape in
 * specs/commands/device.md's `device orphans` example. */
function formatModified(mtimeSeconds: number | null): string {
  if (mtimeSeconds === null) return "unknown";
  return new Date(mtimeSeconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}

interface OrphanRow {
  doc: string;
  docUuid: string;
  stroke: string;
  size: number | null;
  mtime: number | null;
  thumbnail: boolean;
  geo: PageGeometry;
}

/**
 * Fetch and classify every orphan candidate across `targets`: a candidate
 * whose `.rm` file parses to zero strokes is a page merely opened, never
 * drawn on (specs/commands/device.md#device-orphans) — it is counted, not
 * reported as a row. Unreadable/unparseable candidates are kept as rows
 * rather than silently dropped, matching `put`'s `detectInk`
 * (src/commands/put.ts): unreadable is not the same as absent.
 */
async function classifyOrphans(
  target: SshTarget,
  docsWithPaths: { doc: DeviceDoc; path: string }[],
): Promise<{ rows: OrphanRow[]; zeroStroke: number }> {
  const rows: OrphanRow[] = [];
  let zeroStroke = 0;

  for (const { doc, path } of docsWithPaths) {
    const candidates = orphanCandidates(doc);
    for (const candidate of candidates) {
      let geo: PageGeometry | null = null;
      try {
        const bytes = await execRemoteBinary(target, catRmCommand(doc.uuid, candidate.uuid));
        geo = pageGeometry(parseDeviceRm(bytes));
      } catch {
        // Unreadable — kept as a row below rather than silently dropped.
      }

      if (geo && geo.strokes.length === 0) {
        zeroStroke++;
        continue;
      }

      rows.push({
        doc: path,
        docUuid: doc.uuid,
        stroke: candidate.uuid,
        size: candidate.size,
        mtime: candidate.mtime,
        thumbnail: doc.thumbnails.has(candidate.uuid),
        geo: geo ?? { strokes: [], text: [], paperSize: null, bounds: null, deleted: 0, unmappedColors: [] },
      });
    }
  }

  rows.sort((a, b) => a.doc.localeCompare(b.doc) || a.stroke.localeCompare(b.stroke));
  return { rows, zeroStroke };
}

/** Composite one orphan's strokes to a preview-scale PNG, reusing exactly
 * `check`'s own rasterize -> downscale -> encode pipeline
 * (src/commands/check.ts) over a single-page PDF built the same way `get`
 * builds one (`pagesToPdf`, src/render.ts) — one stroke parser and one
 * preview pipeline, both directions. */
async function renderOrphanPng(
  gsPath: string,
  geo: PageGeometry,
  fallbackDpi: number,
  outPath: string,
): Promise<void> {
  const dpi = dpiFor(geo.paperSize, fallbackDpi);
  const pdfBytes = await pagesToPdf([geo], { fit: "content", dpi });
  const dir = await mkdtemp(join(tmpdir(), "remarkable-axi-orphan-render-"));
  try {
    const pdfPath = join(dir, "page.pdf");
    await writeFile(pdfPath, pdfBytes);
    const raster = await rasterizePage(gsPath, pdfPath, 1, dpi);
    const target = fitDimensions(raster.width, raster.height);
    const downscaled = target.width !== raster.width || target.height !== raster.height;
    const pixels = downscaled
      ? downscaleGrayscale(raster.pixels, raster.width, raster.height, target.width, target.height)
      : raster.pixels;
    const png = encodeGrayscalePng(target.width, target.height, pixels);
    await writeFile(outPath, png);
  } finally {
    await removeFile(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * `device orphans [<path>] [--render] [--out <dir>]` — list `.rm` files no
 * page index references, per specs/commands/device.md. Read-only; `--render`
 * additionally pulls the orphaned files (and their surviving thumbnails) to
 * composite an eye-matchable preview.
 */
export async function orphans(args: string[]): Promise<Output> {
  const parsed = parseFlags("device orphans", args, {
    value: ["--out", "--ssh", "--via"],
    boolean: ["--render"],
  });

  const pathArg = parsed.positional[0];
  const render = bool(parsed, "--render");
  const outFlag = str(parsed, "--out", "");

  if (outFlag && !render) {
    throw new AxiError("--out only applies with --render", "USAGE", [
      "Run `remarkable-axi device orphans [<path>] --render --out <dir>`",
    ]);
  }

  const target = await resolveTargetFromFlags(parsed);

  let scope: { doc: DeviceDoc; path: string }[];
  let scopeLabel: string;

  if (pathArg) {
    // Scoped: two small connections instead of the account-wide dump —
    // see fetchDocByPath.
    const match = await fetchDocByPath(target, pathArg);
    if (match.doc.type !== "DocumentType") {
      throw new AxiError(`not a document on the device: ${match.path}`, "USAGE", [
        "device orphans sweeps everything when <path> is omitted, or name one document",
      ]);
    }
    scope = [{ doc: match.doc, path: match.path }];
    scopeLabel = match.path;
  } else {
    const docs = await fetchDeviceDump(target);
    scope = [...docs.values()]
      .filter((doc) => doc.type === "DocumentType")
      .map((doc) => ({ doc, path: devicePath(doc.uuid, docs) ?? `/${doc.visibleName}` }));
    scopeLabel = `${scope.length} document${scope.length === 1 ? "" : "s"}`;
  }

  const { rows, zeroStroke } = await classifyOrphans(target, scope);

  const output: Output = {};

  if (rows.length === 0) {
    output.orphans = `clean — ${scopeLabel} checked, no orphaned stroke files`;
  } else {
    output.orphans = rows.map((r) => ({
      doc: r.doc,
      stroke: r.stroke,
      size: r.size !== null ? humanSize(r.size) : "unknown",
      modified: formatModified(r.mtime),
      thumbnail: r.thumbnail ? "yes" : "no",
    }));
  }

  if (zeroStroke > 0) {
    output.zeroStroke = `${zeroStroke} zero-stroke file${zeroStroke === 1 ? "" : "s"} excluded (opened but never drawn on)`;
  }

  if (rows.length > 0) {
    const first = rows[0]!;
    const help: string[] = [];

    if (render) {
      const gs = await findGhostscript();
      if (!gs) {
        throw new AxiError("ghostscript not found", "MISSING_TOOL", [
          "Install Ghostscript — https://www.ghostscript.com/",
          "Run `remarkable-axi doctor` to confirm it is discovered",
        ]);
      }

      const configured = (await readConfig()).targetDevice;
      const fallbackDpi = configured ? deviceSpec(configured).dpi : 226;

      let outDir: string;
      if (outFlag) {
        outDir = resolve(outFlag);
        await mkdir(outDir, { recursive: true });
      } else {
        outDir = await mkdtemp(join(tmpdir(), "remarkable-axi-orphans-"));
      }

      for (const row of rows) {
        const base = `${documentName(row.doc.split("/").pop() || "document")}-${row.stroke.slice(0, 8)}`;
        const renderPath = join(outDir, `${base}-render.png`);
        await renderOrphanPng(gs.path, row.geo, fallbackDpi, renderPath);

        if (row.thumbnail) {
          try {
            const thumbBytes = await execRemoteBinary(
              target,
              catThumbnailCommand(row.docUuid, row.stroke),
            );
            await writeFile(join(outDir, `${base}-thumbnail.png`), thumbBytes);
          } catch {
            // Best-effort: the render itself is still useful without it.
          }
        }
      }

      output.rendered = collapseHome(outDir);
      help.push(
        `Read the renders and thumbnails in ${collapseHome(outDir)} to eye-match each orphan before any reattach`,
      );
    } else {
      help.push(
        `Run \`remarkable-axi device orphans "${first.doc}" --render\` to see what each orphan holds`,
      );
    }

    help.push(`Run \`remarkable-axi device backup "${first.doc}"\` before any reattach`);
    output.help = help;
  }

  return output;
}

/**
 * Account-wide orphan count, for `doctor`'s device block — cheap because it
 * reuses the same single-connection dump `backup`/`orphans` open, and never
 * fetches candidate bytes (no zero-stroke exclusion): `doctor` wants a fast
 * "is anything worth a closer look" signal, not the full `orphans` listing.
 * Never throws — an unreachable tablet or a parse hiccup is `doctor`'s to
 * report, not fail on, per specs/behaviors/device-access.md's "optional
 * means optional".
 */
export async function accountOrphanCount(target: SshTarget): Promise<number | null> {
  try {
    // Short budget, deliberately: the full dump measures minutes over a slow
    // relay, and a doctor that hangs for minutes is broken diagnostics. On a
    // link that slow this degrades to null ("unknown") — the honest answer —
    // and `device orphans` remains the real sweep with the real budget.
    const docs = await fetchDeviceDump(target, { timeoutMs: 15_000 });
    let total = 0;
    for (const doc of docs.values()) {
      if (doc.type !== "DocumentType") continue;
      total += orphanCandidates(doc).length;
    }
    return total;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// `device reattach` — the one writing command
// ---------------------------------------------------------------------------

/** Parse `--map <stroke-uuid>=<page-uuid>[,...]` into pairs, rejecting the
 * shape before any device dump is even fetched — a malformed flag is a
 * `USAGE` error, not a `NOT_FOUND` one. */
function parseMapFlag(raw: string): StrokeMapping[] {
  const usage = [
    "Run `remarkable-axi device reattach <path> --map <stroke-uuid>=<page-uuid>[,...]`",
  ];
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (entries.length === 0) {
    throw new AxiError("--map needs at least one <stroke-uuid>=<page-uuid> pair", "USAGE", usage);
  }

  const pairs: StrokeMapping[] = [];
  const seenTargets = new Set<string>();
  for (const entry of entries) {
    const eq = entry.indexOf("=");
    const stroke = eq === -1 ? "" : entry.slice(0, eq).trim();
    const page = eq === -1 ? "" : entry.slice(eq + 1).trim();
    if (!stroke || !page) {
      throw new AxiError(`invalid --map entry ${JSON.stringify(entry)} — expected <stroke-uuid>=<page-uuid>`, "USAGE", usage);
    }
    if (seenTargets.has(page)) {
      throw new AxiError(`--map names ${page} as a target page more than once`, "USAGE", [
        "Each target page uuid may appear once in --map — the second copy would silently overwrite the first",
      ]);
    }
    seenTargets.add(page);
    pairs.push({ stroke, page });
  }
  return pairs;
}

/**
 * The `--restore-index` refusal gate
 * (specs/commands/device.md#device-reattach's `HAS_INK`): fetch every
 * currently-indexed page's `.rm` and report which ones carry at least one
 * stroke — those are exactly the pages the restore would evict from the
 * index and orphan in turn. A page whose `.rm` cannot be read is counted as
 * inked rather than skipped: this gate exists to never trade new ink for
 * old (specs/principles.md#never-manufacture-a-state-the-tool-refuses-to-operate-on),
 * so an unreadable page is the conservative case, not the permissive one —
 * the mirror image of `classifyOrphans`' own unreadable-candidate handling
 * above, which keeps rather than drops for the same reason in the other
 * direction.
 */
async function findInkedPages(
  target: SshTarget,
  docUuid: string,
  pageUuids: string[],
): Promise<string[]> {
  const inked: string[] = [];
  for (const uuid of pageUuids) {
    try {
      const bytes = await execRemoteBinary(target, catRmCommand(docUuid, uuid));
      const geo = pageGeometry(parseDeviceRm(bytes));
      if (geo.strokes.length > 0) inked.push(uuid);
    } catch {
      inked.push(uuid);
    }
  }
  return inked;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `device reattach <path> --map <stroke-uuid>=<page-uuid>[,...] | --restore-index`
 * — the one writing command, running the full write ritual
 * (specs/behaviors/device-access.md#reads-are-free-writes-follow-the-ritual)
 * as a single guarded sequence:
 *
 * 1. Resolve the document and validate the requested mode against the
 *    *current* dump — cheap, local, before any remote write step.
 * 2. Embedded backup — refuses `BACKUP_FAILED` with nothing written.
 * 3. `--restore-index` only: the `HAS_INK` gate, still before any write.
 * 4. Stop xochitl, apply, `sync`, restart, verify — in that order, with
 *    restart always attempted even if apply or sync failed, so a mid-ritual
 *    failure never leaves the tablet's document app stopped.
 */
export async function reattach(args: string[]): Promise<Output> {
  const parsed = parseFlags("device reattach", args, {
    value: ["--map", "--ssh", "--via"],
    boolean: ["--restore-index"],
  });

  const pathArg = requirePositional(
    parsed,
    0,
    "a document path",
    "Run `remarkable-axi device reattach <path> --map <stroke-uuid>=<page-uuid>[,...]` or `--restore-index`",
  );

  const mapFlag = str(parsed, "--map", "");
  const restoreIndexFlag = bool(parsed, "--restore-index");

  if (mapFlag && restoreIndexFlag) {
    throw new AxiError("pass either --map or --restore-index, not both", "USAGE", [
      "Run `remarkable-axi device reattach <path> --map <stroke-uuid>=<page-uuid>[,...]` to attach named strokes",
      "Run `remarkable-axi device reattach <path> --restore-index` to restore the whole page index",
    ]);
  }
  if (!mapFlag && !restoreIndexFlag) {
    throw new AxiError("device reattach needs exactly one of --map or --restore-index", "USAGE", [
      "Run `remarkable-axi device reattach <path> --map <stroke-uuid>=<page-uuid>[,...]`",
      "Run `remarkable-axi device reattach <path> --restore-index`",
    ]);
  }

  const mode: "map" | "restore-index" = mapFlag ? "map" : "restore-index";

  const target = await resolveTargetFromFlags(parsed);
  // Scoped resolution — two small connections, never the account-wide dump.
  const match = await fetchDocByPath(target, pathArg);

  if (match.doc.type !== "DocumentType") {
    throw new AxiError(`not a document on the device: ${match.path}`, "USAGE", [
      "device reattach writes to one document; run `remarkable-axi device orphans` (with no path) to find one",
    ]);
  }

  // --- validate the requested mode against the current dump, before any
  // remote step at all -------------------------------------------------
  let mapPairs: StrokeMapping[] = [];
  let restoreOrderedUuids: string[] = [];

  if (mode === "map") {
    mapPairs = parseMapFlag(mapFlag);
    const orphanUuids = new Set(orphanCandidates(match.doc).map((o) => o.uuid));
    const pageUuids = new Set(contentPageOrder(match.doc.content));
    for (const { stroke, page } of mapPairs) {
      if (!orphanUuids.has(stroke)) {
        throw new AxiError(`${stroke} is not a current orphan on ${match.path}`, "NOT_FOUND", [
          `Run \`remarkable-axi device orphans "${match.path}"\` to see current orphans`,
        ]);
      }
      if (!pageUuids.has(page)) {
        throw new AxiError(`${page} is not in ${match.path}'s current page index`, "NOT_FOUND", [
          `Run \`remarkable-axi device orphans "${match.path}" --render\` to confirm the target page uuid`,
        ]);
      }
    }
  } else {
    const orphans = orphanCandidates(match.doc);
    if (orphans.length === 0) {
      throw new AxiError(`${match.path} has no orphaned pages to restore`, "NOT_FOUND", [
        `Run \`remarkable-axi device orphans "${match.path}"\` to confirm`,
      ]);
    }
    restoreOrderedUuids = restoreOrder(orphans);
  }

  // --- 2. embedded backup — refuses BACKUP_FAILED with nothing written ---
  const archive = await embeddedBackup(target, match);

  // --- 3. the HAS_INK gate — restore-index only, still before any write --
  if (mode === "restore-index") {
    const currentPages = contentPageOrder(match.doc.content);
    const inkedPages = await findInkedPages(target, match.uuid, currentPages);
    if (inkedPages.length > 0) {
      throw new AxiError(
        `restoring ${match.path}'s index would orphan ${inkedPages.length} currently-inked page${inkedPages.length === 1 ? "" : "s"}`,
        "HAS_INK",
        [
          `Inked pages: ${inkedPages.join(", ")}`,
          `A backup was already captured: ${collapseHome(archive)}`,
          "Use --map to attach specific orphaned strokes instead of replacing the whole index",
        ],
      );
    }
  }

  // --- 4. the ritual: stop, apply, sync, restart, verify ------------------
  await execRemote(target, STOP_XOCHITL_COMMAND);

  let dispositions: StrokeDisposition[];
  let applyFatal: unknown;
  try {
    if (mode === "map") {
      const stdout = await execRemote(target, buildMapApplyCommand(match.uuid, mapPairs));
      dispositions = parseMapApplyOutput(stdout, mapPairs);
    } else {
      const restored = buildRestoredContent(match.doc.content, restoreOrderedUuids);
      await execRemote(target, buildRestoreIndexCommand(match.uuid, JSON.stringify(restored)));
      dispositions = restoreOrderedUuids.map((uuid) => ({
        stroke: uuid,
        page: uuid,
        disposition: "restored",
      }));
    }
  } catch (error) {
    applyFatal = error;
    dispositions =
      mode === "map"
        ? mapPairs.map((p) => ({ stroke: p.stroke, page: p.page, disposition: "failed" }))
        : restoreOrderedUuids.map((uuid) => ({ stroke: uuid, page: uuid, disposition: "failed" }));
  }

  let syncFailed = false;
  try {
    await execRemote(target, SYNC_COMMAND);
  } catch {
    syncFailed = true;
  }

  let restarted = false;
  let restartError: unknown;
  try {
    await execRemote(target, START_XOCHITL_COMMAND);
    restarted = true;
  } catch (error) {
    restartError = error;
  }

  let xochitlActive = false;
  if (restarted) {
    try {
      const stdout = await execRemote(target, XOCHITL_ACTIVE_COMMAND);
      xochitlActive = stdout.trim() === "active";
    } catch {
      xochitlActive = false;
    }
  }

  if (applyFatal || !restarted) {
    const detail = applyFatal ? errorDetail(applyFatal) : errorDetail(restartError);
    throw new AxiError(`device reattach's write ritual failed on ${match.path}: ${detail}`, "REATTACH_FAILED", [
      `A backup was already captured before the write: ${collapseHome(archive)}`,
      restarted
        ? "xochitl was restarted successfully despite the failure above"
        : `xochitl did NOT restart — run \`ssh ${target.destination} 'systemctl start xochitl'\` manually now`,
    ]);
  }

  const xochitlField = xochitlActive ? "restarted" : "restart issued but not yet reporting active";

  return {
    reattached: {
      path: match.path,
      backup: collapseHome(archive),
      mode,
      strokes: dispositions,
      xochitl: xochitlField,
    },
    ...(syncFailed || !xochitlActive
      ? {
          help: [
            "Reopen the document on the tablet — the ink is live and will sync up on its own",
            ...(syncFailed
              ? ["`sync` failed after the write — the data was still written; the flush just wasn't confirmed"]
              : []),
            ...(!xochitlActive
              ? [`Run \`remarkable-axi device status\` in a few seconds to confirm xochitl is running`]
              : []),
          ],
        }
      : {
          help: ["Reopen the document on the tablet — the ink is live and will sync up on its own"],
        }),
  };
}
