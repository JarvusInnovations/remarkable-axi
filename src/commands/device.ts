import { mkdir, mkdtemp, rm as removeFile, writeFile } from "node:fs/promises";
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
  catRmCommand,
  catThumbnailCommand,
  devicePath,
  fetchDeviceDump,
  orphanCandidates,
  requireOneDeviceMatch,
  type DeviceDoc,
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

  throw new AxiError(
    sub ? `unknown device command: ${sub}` : "device needs a subcommand",
    "USAGE",
    [
      "Run `remarkable-axi device status` to check tablet connectivity",
      "Run `remarkable-axi device backup <path>` to archive a document's on-device file set",
      "Run `remarkable-axi device orphans [<path>]` to list stroke files no page index references",
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
  const docs = await fetchDeviceDump(target);
  const match = requireOneDeviceMatch(docs, pathArg);

  if (match.doc.type !== "DocumentType") {
    throw new AxiError(`not a document on the device: ${match.path}`, "USAGE", [
      "device backup archives one document; run `remarkable-axi device orphans` (with no path) to sweep everything",
    ]);
  }

  const indexed = contentPageOrder(match.doc.content).length;
  const strokeFiles = match.doc.rmFiles.length;
  const orphaned = orphanCandidates(match.doc).length;

  const name = documentName(match.doc.visibleName) || "document";
  const date = new Date().toISOString().slice(0, 10);
  const redirectHint = `remarkable-axi device backup "${pathArg}"`;
  const out = outFlag
    ? resolve(outFlag)
    : resolve(`./${name}-device-backup-${date}.tar.gz`);
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
  const docs = await fetchDeviceDump(target);

  let scope: { doc: DeviceDoc; path: string }[];
  let scopeLabel: string;

  if (pathArg) {
    const match = requireOneDeviceMatch(docs, pathArg);
    if (match.doc.type !== "DocumentType") {
      throw new AxiError(`not a document on the device: ${match.path}`, "USAGE", [
        "device orphans sweeps everything when <path> is omitted, or name one document",
      ]);
    }
    scope = [{ doc: match.doc, path: match.path }];
    scopeLabel = match.path;
  } else {
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
    const docs = await fetchDeviceDump(target);
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
