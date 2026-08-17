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
export const DEVICE_DUMP_TIMEOUT_MS = 60_000;

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
export const DEVICE_DUMP_COMMAND = [
  `D=${XOCHITL_DIR}`,
  `cd "$D" || exit 1`,
  `for f in *.metadata; do`,
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

/** Run `DEVICE_DUMP_COMMAND` and parse it — the one connection every
 * `backup`/`orphans` invocation opens to plan its work. */
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
