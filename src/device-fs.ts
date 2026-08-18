import { AxiError } from "axi-sdk-js";
import { contentPageOrder } from "./entries.js";
import { normalizePath } from "./paths.js";
import { execRemote, type SshTarget } from "./device.js";

/**
 * The on-device storage layout (specs/behaviors/device-access.md#on-device-storage-layout)
 * and the path resolution `device backup`/`device orphans` share over it:
 * one remote command dumps every document's `.metadata`, `.content`, `.rm`
 * file listing, and thumbnail listing in a single connection, and everything
 * else — path reconstruction, ambiguity, the orphan diff — happens locally
 * against that dump. No remote command ever embeds a user-supplied `<path>`;
 * only uuids lifted back out of the dump (validated by `assertUuidLike`
 * below) are ever interpolated into a later command, so a path containing
 * shell metacharacters (`"/APTAtech 2026/Leads"`, spec's own example) is
 * never a remote-command-injection risk.
 */
export const XOCHITL_DIR = "/home/root/.local/share/remarkable/xochitl";

/** Generous: a full-account dump greps and `cat`s every document's metadata
 * and content in one connection — cheap per file, but the default 15s exec
 * ceiling is sized for a single status probe, not hundreds of them. */
// Measured live: a 910-document account over a relayed (-J) hop takes ~73s
// for the ~6MB dump, so the original 60s budget was just short of reality.
// Sized with the same headroom philosophy as the binary path's ceiling.
export const DEVICE_DUMP_TIMEOUT_MS = 300_000;

/**
 * One BusyBox ash-safe command dumping, for every document on the device:
 * its `.metadata` (visible name, parent, type), its `.content` (the page
 * index), every `.rm` file in its directory with size and mtime, and every
 * thumbnail's page uuid — everything `resolveDevicePath`, `backup`, and
 * `orphans` need, in one connection.
 *
 * `stat -c '%s %Y'` (size, mtime-epoch) is the one call here not already
 * proven by `device status`'s `STATUS_COMMAND` — unverified against real
 * hardware, like that command's own doc comment. A line that doesn't parse
 * degrades to "unknown" size/modified rather than dropping the file (see
 * `parseDeviceDump` below), so a BusyBox `stat` build without `-c` support
 * would lose two display fields, not the orphan itself.
 */
/** The per-document dump loop, parameterized by which `.metadata` files to
 * walk — `*.metadata` for the account sweep, one literal filename for the
 * scoped single-document fetch (see `scopedDumpCommand`). */
function dumpLoop(metadataGlob: string): string {
  return [
  `D=${XOCHITL_DIR}`,
  `cd "$D" || exit 1`,
  `for f in ${metadataGlob}; do`,
  `  [ -f "$f" ] || continue`,
  `  u=$(basename "$f" .metadata)`,
  `  echo "===DOC $u==="`,
  `  echo "--META--"`,
  `  cat "$f"`,
  `  echo`,
  `  if [ -f "$u.content" ]; then`,
  `    echo "--CONTENT--"`,
  `    cat "$u.content"`,
  `    echo`,
  `  fi`,
  `  if [ -d "$u" ]; then`,
  `    echo "--RM--"`,
  `    for r in "$u"/*.rm; do`,
  `      [ -f "$r" ] || continue`,
  `      rn=$(basename "$r" .rm)`,
  `      sz=$(stat -c '%s %Y' "$r" 2>/dev/null)`,
  `      echo "$rn $sz"`,
  `    done`,
  `  fi`,
  `  if [ -d "$u.thumbnails" ]; then`,
  `    echo "--THUMB--"`,
  `    for t in "$u.thumbnails"/*.png; do`,
  `      [ -f "$t" ] || continue`,
  `      basename "$t" .png`,
  `    done`,
  `  fi`,
  `done`,
  ].join("\n");
}

export const DEVICE_DUMP_COMMAND = dumpLoop("*.metadata");

/** Metadata-only dump — every document's name/parent/type and nothing else
 * (~300 bytes per document instead of the full listing), which is all path
 * resolution needs. Found live: the full dump is ~6MB on a 910-document
 * account and takes minutes over a slow relay, so single-document commands
 * resolve against this and then fetch one document with `scopedDumpCommand`
 * instead of paying for the whole account. */
export const METADATA_DUMP_COMMAND = [
  `D=${XOCHITL_DIR}`,
  `cd "$D" || exit 1`,
  `for f in *.metadata; do`,
  `  [ -f "$f" ] || continue`,
  `  u=$(basename "$f" .metadata)`,
  `  echo "===DOC $u==="`,
  `  echo "--META--"`,
  `  cat "$f"`,
  `  echo`,
  `done`,
].join("\n");

/** Full dump of exactly one document, by uuid (guarded — the uuid comes from
 * the metadata dump, never from user input). */
export function scopedDumpCommand(uuid: string): string {
  assertUuidLike(uuid);
  return dumpLoop(`${uuid}.metadata`);
}

export interface DeviceRmFile {
  uuid: string;
  /** Bytes, or `null` when `stat` didn't parse. */
  size: number | null;
  /** Epoch seconds, or `null` when `stat` didn't parse. */
  mtime: number | null;
}

export interface DeviceDoc {
  uuid: string;
  visibleName: string;
  /** Parent folder uuid, `""` for the device root, `"trash"` for trash. */
  parent: string;
  type: "DocumentType" | "CollectionType" | string;
  /** Raw parsed `.content`, or `null` when absent/unreadable (folders have none). */
  content: unknown;
  rmFiles: DeviceRmFile[];
  thumbnails: Set<string>;
}

/** Parse `DEVICE_DUMP_COMMAND`'s output into one record per document. */
export function parseDeviceDump(stdout: string): Map<string, DeviceDoc> {
  const docs = new Map<string, DeviceDoc>();
  const lines = stdout.split("\n");

  let current: DeviceDoc | null = null;
  let section: "meta" | "content" | "rm" | "thumb" | null = null;
  let buffer: string[] = [];

  const flushSection = () => {
    if (!current || !section) {
      buffer = [];
      return;
    }
    if (section === "meta") {
      try {
        const meta = JSON.parse(buffer.join("\n")) as Record<string, unknown>;
        current.visibleName =
          typeof meta.visibleName === "string" ? meta.visibleName : "";
        current.parent = typeof meta.parent === "string" ? meta.parent : "";
        current.type =
          typeof meta.type === "string" ? meta.type : "DocumentType";
      } catch {
        // Unreadable metadata: the doc still exists (its .rm files might be
        // recoverable) but has no name/parent to resolve a path with.
      }
    } else if (section === "content") {
      try {
        current.content = JSON.parse(buffer.join("\n"));
      } catch {
        current.content = null;
      }
    } else if (section === "rm") {
      for (const line of buffer) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        const uuid = parts[0]!;
        const size = parts[1] !== undefined && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null;
        const mtime = parts[2] !== undefined && /^\d+$/.test(parts[2]) ? Number(parts[2]) : null;
        current.rmFiles.push({ uuid, size, mtime });
      }
    } else if (section === "thumb") {
      for (const line of buffer) {
        const trimmed = line.trim();
        if (trimmed) current.thumbnails.add(trimmed);
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const docMatch = /^===DOC (.+)===$/.exec(line);
    if (docMatch) {
      flushSection();
      section = null;
      const uuid = docMatch[1]!;
      current = {
        uuid,
        visibleName: "",
        parent: "",
        type: "DocumentType",
        content: null,
        rmFiles: [],
        thumbnails: new Set(),
      };
      docs.set(uuid, current);
      continue;
    }
    if (line === "--META--" || line === "--CONTENT--" || line === "--RM--" || line === "--THUMB--") {
      flushSection();
      section =
        line === "--META--" ? "meta" : line === "--CONTENT--" ? "content" : line === "--RM--" ? "rm" : "thumb";
      continue;
    }
    if (current && section) buffer.push(line);
  }
  flushSection();

  return docs;
}

/** `resolveDevicePath`'s match, carrying just enough of the doc to act on. */
export interface DevicePathMatch {
  uuid: string;
  path: string;
  doc: DeviceDoc;
}

const TRASH = "trash";
const ROOT = "";

/** Reconstruct one document's full path by walking its `parent` chain,
 * matching `specs/behaviors/device-access.md`: a trashed document's parent
 * is the literal `"trash"`, a place rather than a deletion, so it resolves
 * under a `/trash` pseudo-folder rather than failing to resolve at all —
 * the one respect in which this differs from the cloud's own `buildTree`
 * (`src/paths.ts`), which excludes trash entirely. */
export function devicePath(uuid: string, docs: Map<string, DeviceDoc>): string | null {
  const seen = new Set<string>();
  const segments: string[] = [];
  let cursor: string | undefined = uuid;

  while (cursor !== undefined && cursor !== ROOT) {
    if (seen.has(cursor)) return null; // cycle guard
    seen.add(cursor);

    if (cursor === TRASH) {
      segments.push("trash");
      break;
    }

    const doc = docs.get(cursor);
    if (!doc) return null; // orphaned under a missing parent
    segments.push(doc.visibleName);
    cursor = doc.parent;
  }

  return `/${segments.reverse().join("/")}`;
}

/**
 * Resolve a cloud-style path against the device's own storage, matching
 * `specs/commands/device.md`: search `.metadata` visible names, walk `parent`
 * uuids to reconstruct full paths, and work for trashed documents.
 */
export function resolveDevicePath(
  docs: Map<string, DeviceDoc>,
  path: string,
): DevicePathMatch[] {
  const normalized = normalizePath(path);
  const matches: DevicePathMatch[] = [];
  for (const doc of docs.values()) {
    const resolved = devicePath(doc.uuid, docs);
    if (resolved === normalized) matches.push({ uuid: doc.uuid, path: resolved, doc });
  }
  return matches;
}

/**
 * `resolveDevicePath`, but refusing exactly like every other path lookup in
 * this tool: nothing found is `NOT_FOUND`, more than one is `AMBIGUOUS`
 * listing the colliding uuids (specs/commands/device.md's Failure table).
 */
export function requireOneDeviceMatch(
  docs: Map<string, DeviceDoc>,
  path: string,
): DevicePathMatch {
  const normalized = normalizePath(path);
  const matches = resolveDevicePath(docs, path);

  if (matches.length === 0) {
    throw new AxiError(`no such document on the device: ${normalized}`, "NOT_FOUND", [
      "Confirm the path matches a document's visible name on the tablet, including trashed documents",
    ]);
  }
  if (matches.length > 1) {
    throw new AxiError(
      `${matches.length} documents share the path ${normalized} on the device`,
      "AMBIGUOUS",
      [`Ids: ${matches.map((m) => m.uuid.slice(0, 8)).join(", ")}`],
    );
  }
  return matches[0]!;
}

/** A uuid lifted from the device's own dump — filenames on that filesystem
 * are never adversarial, but this is the one place a uuid is interpolated
 * into a later remote command, so it is checked defensively regardless. */
export function assertUuidLike(uuid: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(uuid)) {
    throw new Error(`refusing to build a remote command around ${JSON.stringify(uuid)}`);
  }
}

/** The `.rm` files present in a document's directory that its own `.content`
 * page index does not reference — orphans, per
 * specs/commands/device.md#device-orphans. */
export function orphanCandidates(doc: DeviceDoc): DeviceRmFile[] {
  const indexed = new Set(contentPageOrder(doc.content));
  return doc.rmFiles.filter((f) => !indexed.has(f.uuid));
}

/** Build the tar command for `device backup`: the document's complete file
 * set — `.metadata`, `.content`, its strokes directory, and its
 * thumbnails — streamed as `tar czf -` over stdout. Every entry is checked
 * for existence first so a document with, say, no thumbnails yet doesn't
 * fail the whole archive over one missing path. */
export function backupTarCommand(uuid: string): string {
  assertUuidLike(uuid);
  return [
    `D=${XOCHITL_DIR}`,
    `cd "$D" || exit 1`,
    `FILES="${uuid}.metadata"`,
    `[ -f "${uuid}.content" ] && FILES="$FILES ${uuid}.content"`,
    `[ -d "${uuid}" ] && FILES="$FILES ${uuid}"`,
    `[ -d "${uuid}.thumbnails" ] && FILES="$FILES ${uuid}.thumbnails"`,
    `tar czf - $FILES`,
  ].join("\n");
}

/** `cat` one `.rm` file's raw bytes, for zero-stroke detection or
 * `--render`. */
export function catRmCommand(docUuid: string, pageUuid: string): string {
  assertUuidLike(docUuid);
  assertUuidLike(pageUuid);
  return `cat "${XOCHITL_DIR}/${docUuid}/${pageUuid}.rm"`;
}

/** `cat` one page's surviving thumbnail, for `--render`. */
export function catThumbnailCommand(docUuid: string, pageUuid: string): string {
  assertUuidLike(docUuid);
  assertUuidLike(pageUuid);
  return `cat "${XOCHITL_DIR}/${docUuid}.thumbnails/${pageUuid}.png"`;
}

// ---------------------------------------------------------------------------
// `device reattach` — write commands
//
// Both `--map` and `--restore-index` share one discipline: every uuid that
// reaches a remote command was already validated as a member of the current
// dump (an orphan candidate, or a page in the current index) before it gets
// here, and every builder below re-checks with `assertUuidLike` anyway —
// defense in depth, matching `backupTarCommand`/`catRmCommand` above.
// ---------------------------------------------------------------------------

/** One `--map <stroke-uuid>=<page-uuid>` pair, already validated against the
 * current dump by the caller. */
export interface StrokeMapping {
  stroke: string;
  page: string;
}

/**
 * Build the `--map` apply command: `cp` each orphaned `.rm` file over its
 * target page's uuid, inside the document's own directory. Each `cp` is
 * wrapped to echo its own `OK`/`FAIL` line rather than chaining with `&&` —
 * one failed copy (a page vanishing mid-ritual, an unreadable source) must
 * not silently skip the rest, per
 * specs/principles.md#best-effort-operations-report-per-item-outcomes; the
 * caller (`parseMapApplyOutput` below) turns those lines back into a
 * per-stroke disposition.
 */
export function buildMapApplyCommand(docUuid: string, pairs: StrokeMapping[]): string {
  assertUuidLike(docUuid);
  const lines = [`D=${XOCHITL_DIR}/${docUuid}`];
  for (const { stroke, page } of pairs) {
    assertUuidLike(stroke);
    assertUuidLike(page);
    lines.push(
      `if cp "$D/${stroke}.rm" "$D/${page}.rm" 2>/dev/null; then echo "OK ${stroke} ${page}"; else echo "FAIL ${stroke} ${page}"; fi`,
    );
  }
  return lines.join("\n");
}

/** One row of `device reattach`'s disposition table
 * (specs/commands/device.md#device-reattach). */
export interface StrokeDisposition {
  stroke: string;
  page: string;
  disposition: string;
}

/**
 * Parse `buildMapApplyCommand`'s `OK`/`FAIL` lines back into a disposition
 * per pair, in the order `pairs` was given (the command runs its `cp`s
 * strictly in that order, so the Nth output line answers the Nth pair). A
 * missing line (the connection dropped mid-stream) reports `failed` rather
 * than silently omitting the row.
 */
export function parseMapApplyOutput(
  stdout: string,
  pairs: StrokeMapping[],
): StrokeDisposition[] {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return pairs.map((pair, i) => ({
    stroke: pair.stroke,
    page: pair.page,
    disposition: lines[i]?.startsWith("OK ") ? "attached" : "failed",
  }));
}

/**
 * Build the `--restore-index` apply command: write `contentJson` to the
 * document's `.content`, binary/quote-safe over `execRemote`'s single
 * command-string transport. `contentJson` is base64-encoded locally first —
 * the base64 alphabet (`A-Za-z0-9+/=`) contains no shell metacharacter, so
 * it is safe inside single quotes regardless of what the JSON itself
 * contains, and decoded back to bytes on-device with `base64 -d` before the
 * write. **Unverified against real hardware**: BusyBox has shipped a
 * `base64` applet since well before any current reMarkable firmware, but
 * this repo has not confirmed the on-device build enables it — see this
 * plan's Risks. Written to a `.new` sibling and `mv`'d into place rather
 * than redirected directly onto `.content`, so a decode failure never
 * leaves the live file half-written.
 */
export function buildRestoreIndexCommand(docUuid: string, contentJson: string): string {
  assertUuidLike(docUuid);
  const encoded = Buffer.from(contentJson, "utf8").toString("base64");
  return [
    `D=${XOCHITL_DIR}`,
    `printf '%s' '${encoded}' | base64 -d > "$D/${docUuid}.content.new"`,
    `mv "$D/${docUuid}.content.new" "$D/${docUuid}.content"`,
  ].join("\n");
}

/**
 * Deterministic restore order for `--restore-index`: ascending `.rm` mtime
 * (oldest first — the order pages were likely drawn in), files with an
 * unparsed mtime sorted last, uuid as a stable tiebreak. The document's own
 * *prior* `.content` (which recorded the real order) is exactly what the
 * clobber overwrote, so it is not available here; recovering it from an
 * earlier `device backup` archive, when one exists, is a documented
 * follow-up rather than built in this pass — see plans/device-reattach.md.
 */
export function restoreOrder(orphans: DeviceRmFile[]): string[] {
  return [...orphans]
    .sort((a, b) => {
      if (a.mtime !== null && b.mtime !== null && a.mtime !== b.mtime) {
        return a.mtime - b.mtime;
      }
      if ((a.mtime === null) !== (b.mtime === null)) {
        return a.mtime === null ? 1 : -1;
      }
      return a.uuid.localeCompare(b.uuid);
    })
    .map((o) => o.uuid);
}

/** The two-letter base-26 `idx` code (`"aa"`, `"ab"`, … `"az"`, `"ba"`, …)
 * `cPages.pages` entries carry, per `buildRestoredContent` below. */
function cPageIdx(index: number): string {
  const first = Math.floor(index / 26) % 26;
  const second = index % 26;
  return String.fromCharCode(97 + first) + String.fromCharCode(97 + second);
}

/**
 * Rewrite a document's `.content` pages list to `orderedPageUuids`, for
 * `--restore-index`. Both page-index shapes real documents use are handled
 * (see `contentPageOrder`, src/entries.ts): the legacy flat `pages` array is
 * replaced outright; the newer `cPages.pages` shape needs synthesized
 * entries (`id` + `idx`) since the orphaned pages have no current entry to
 * carry forward — `idx` is documented upstream (`rmapi-js`'s own
 * `CPagePage` type) as `[unknown]`/`[speculative]`, so this pass invents a
 * value in the same observed two-letter shape rather than leaving the field
 * absent (the type marks it non-optional). **Unverified against real
 * hardware.**
 *
 * `pageCount` is kept in sync when present. `redirectionPageMap` (a mapping
 * from page position to the source PDF, keyed to the *old*, now-discarded
 * page order) is dropped rather than carried stale.
 */
export function buildRestoredContent(
  content: unknown,
  orderedPageUuids: string[],
): Record<string, unknown> {
  const base: Record<string, unknown> =
    content && typeof content === "object" && !Array.isArray(content)
      ? { ...(content as Record<string, unknown>) }
      : {};

  delete base.redirectionPageMap;
  if (typeof base.pageCount === "number") base.pageCount = orderedPageUuids.length;

  const cPages = base.cPages;
  if (cPages && typeof cPages === "object" && !Array.isArray(cPages)) {
    base.cPages = {
      ...(cPages as Record<string, unknown>),
      pages: orderedPageUuids.map((id, i) => ({
        id,
        idx: { timestamp: "1:1", value: cPageIdx(i) },
      })),
    };
    return base;
  }

  base.pages = orderedPageUuids;
  return base;
}

/** Run `DEVICE_DUMP_COMMAND` and parse it — the account-wide sweep's one
 * connection. Single-document commands use `fetchDocByPath` instead. */
export async function fetchDeviceDump(
  target: SshTarget,
  opts: Parameters<typeof execRemote>[2] = {},
): Promise<Map<string, DeviceDoc>> {
  const stdout = await execRemote(target, DEVICE_DUMP_COMMAND, {
    timeoutMs: DEVICE_DUMP_TIMEOUT_MS,
    ...opts,
  });
  return parseDeviceDump(stdout);
}

/**
 * Resolve a `<path>` to one document and fetch that document's full listing
 * in two small connections — metadata-only dump to resolve (folders included,
 * so parent-chain reconstruction works), then a uuid-scoped full dump —
 * instead of the account-wide `DEVICE_DUMP_COMMAND`. On a large account over
 * a slow relay that is the difference between seconds and minutes (measured:
 * ~6MB / 5.5min full dump vs ~300KB of metadata on a 910-document account).
 * Resolution semantics are identical: same parser, same
 * `requireOneDeviceMatch`, same `NOT_FOUND`/`AMBIGUOUS`.
 */
export async function fetchDocByPath(
  target: SshTarget,
  path: string,
  opts: Parameters<typeof execRemote>[2] = {},
): Promise<DevicePathMatch> {
  const metaStdout = await execRemote(target, METADATA_DUMP_COMMAND, {
    timeoutMs: DEVICE_DUMP_TIMEOUT_MS,
    ...opts,
  });
  const match = requireOneDeviceMatch(parseDeviceDump(metaStdout), path);

  const scopedStdout = await execRemote(target, scopedDumpCommand(match.uuid), {
    timeoutMs: DEVICE_DUMP_TIMEOUT_MS,
    ...opts,
  });
  const full = parseDeviceDump(scopedStdout).get(match.uuid);
  return full ? { ...match, doc: full } : match;
}
