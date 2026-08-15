import type { Entry, RemarkableApi } from "rmapi-js";

/** The special parent id for the cloud root. */
export const ROOT = "";
/** The special parent id for the trash. */
export const TRASH = "trash";

export interface Node {
  entry: Entry;
  /** Absolute path, e.g. `/Books/Papers`. */
  path: string;
}

export interface Tree {
  /** Every non-trashed entry, keyed by absolute path. */
  byPath: Map<string, Node>;
  /** Every non-trashed entry, keyed by uuid. */
  byId: Map<string, Node>;
  /** Direct children of a parent id, in listing order. */
  children: Map<string, Node[]>;
}

/**
 * Normalize a user-supplied path to a leading-slash, no-trailing-slash form.
 * `/`, ``, and `//` all collapse to `/`.
 */
export function normalizePath(input: string): string {
  const parts = input.split("/").filter((p) => p.length > 0);
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

/** Split a normalized path into its segments. `/` yields `[]`. */
export function segments(path: string): string[] {
  return normalizePath(path)
    .split("/")
    .filter((p) => p.length > 0);
}

/** The parent path of a normalized path. `/a/b` -> `/a`; `/a` -> `/`. */
export function parentPath(path: string): string {
  const segs = segments(path);
  segs.pop();
  return segs.length === 0 ? "/" : `/${segs.join("/")}`;
}

/** The final segment of a normalized path. `/a/b` -> `b`; `/` -> `""`. */
export function baseName(path: string): string {
  return segments(path).pop() ?? "";
}

/**
 * Build an absolute-path index over the whole cloud.
 *
 * The API only exposes a flat entry list where each entry points at its parent
 * uuid, so paths have to be reconstructed here. Trashed entries and anything
 * orphaned under a missing parent are excluded — they aren't addressable by
 * path and surfacing them would produce ambiguous duplicates.
 */
export function buildTree(entries: Entry[]): Tree {
  const byId = new Map<string, Node>();
  const byPath = new Map<string, Node>();
  const children = new Map<string, Node[]>();

  const entryById = new Map<string, Entry>();
  for (const entry of entries) entryById.set(entry.id, entry);

  const resolve = (entry: Entry, seen: Set<string>): string | null => {
    const cached = byId.get(entry.id);
    if (cached) return cached.path;

    const parent = entry.parent ?? ROOT;
    if (parent === TRASH) return null;
    if (seen.has(entry.id)) return null; // cycle guard
    seen.add(entry.id);

    let prefix: string;
    if (parent === ROOT) {
      prefix = "";
    } else {
      const parentEntry = entryById.get(parent);
      if (!parentEntry) return null; // orphan
      const parentResolved = resolve(parentEntry, seen);
      if (parentResolved === null) return null;
      parentResolved === "/" ? (prefix = "") : (prefix = parentResolved);
    }

    const path = `${prefix}/${entry.visibleName}`;
    const node: Node = { entry, path };
    byId.set(entry.id, node);
    // First writer wins: the cloud permits duplicate sibling names, and a later
    // duplicate must not silently shadow the entry an earlier lookup resolved.
    if (!byPath.has(path)) byPath.set(path, node);
    return path;
  };

  for (const entry of entries) resolve(entry, new Set());

  for (const node of byId.values()) {
    const parent = node.entry.parent ?? ROOT;
    const bucket = children.get(parent);
    bucket ? bucket.push(node) : children.set(parent, [node]);
  }

  return { byPath, byId, children };
}

/** Look up a node by absolute path. `/` has no entry and always yields null. */
export function lookup(tree: Tree, path: string): Node | null {
  const normalized = normalizePath(path);
  if (normalized === "/") return null;
  return tree.byPath.get(normalized) ?? null;
}

/**
 * Every entry resolving to exactly this path, not just the first.
 *
 * `lookup` (and `tree.byPath`) is first-writer-wins, because a path can only
 * ever name one thing for a normal read. Anything that writes or replaces at
 * a path has to see every colliding entry instead, so it can refuse rather
 * than silently picking one — see
 * [path-uniqueness](../specs/behaviors/path-uniqueness.md).
 */
export function nodesAt(tree: Tree, path: string): Node[] {
  const normalized = normalizePath(path);
  return [...tree.byId.values()].filter((n) => n.path === normalized);
}

/**
 * Every path held by more than one entry, with all of its colliding nodes.
 *
 * The cloud permits duplicate sibling names, so this is a standing detection
 * pass rather than a one-time check — `ls`, `find`, and `doctor` all surface
 * it. See
 * [Never manufacture a state the tool refuses to operate on](../specs/principles.md#never-manufacture-a-state-the-tool-refuses-to-operate-on).
 */
export function duplicatePaths(tree: Tree): Map<string, Node[]> {
  const groups = new Map<string, Node[]>();
  for (const node of tree.byId.values()) {
    const bucket = groups.get(node.path);
    bucket ? bucket.push(node) : groups.set(node.path, [node]);
  }
  for (const [path, nodes] of groups) {
    if (nodes.length < 2) groups.delete(path);
  }
  return groups;
}

/**
 * Resolve `put`'s destination shape: a trailing segment that names an
 * existing folder is a place to land inside; anything else is the document's
 * own full path. See [put](../specs/commands/put.md#destination).
 *
 * `name` is only used in the land-inside-folder case. When `dest` names an
 * explicit path, that path's own trailing segment *is* the name — the cloud
 * has no separate path concept, so honoring a conflicting `--name` there
 * would upload a document whose visible name doesn't match the path this
 * tool just told the caller it landed at.
 */
export interface PutDestination {
  /** Folder id to upload into (empty when the parent still needs creating). */
  parentId: string;
  /** Folder path to upload into. */
  parentPath: string;
  /** The document name this upload will use. */
  name: string;
  /** The document's resulting full path. */
  finalPath: string;
  /** Document(s) already occupying `finalPath` — 0, 1, or several. */
  existing: Node[];
  /** Whether missing parent folders must be created before uploading. */
  needsMkdirp: boolean;
}

export function resolvePutDestination(
  tree: Tree,
  dest: string,
  name: string,
): PutDestination {
  const normalized = normalizePath(dest);

  // The root has no Entry of its own — `lookup` always returns null for it —
  // so it needs its own branch to still count as "land inside an existing
  // folder" rather than falling through to the explicit-path branch below.
  if (normalized === "/") {
    const finalPath = `/${name}`;
    return {
      parentId: ROOT,
      parentPath: "/",
      name,
      finalPath,
      existing: nodesAt(tree, finalPath),
      needsMkdirp: false,
    };
  }

  const node = lookup(tree, normalized);

  if (node && node.entry.type === "CollectionType") {
    // `normalized` is never "/" here — that case returned above — so the
    // join always needs the separator.
    const finalPath = `${normalized}/${name}`;
    return {
      parentId: node.entry.id,
      parentPath: normalized,
      name,
      finalPath,
      existing: nodesAt(tree, finalPath),
      needsMkdirp: false,
    };
  }

  return {
    parentId: "",
    parentPath: parentPath(normalized),
    name: baseName(normalized),
    finalPath: normalized,
    existing: nodesAt(tree, normalized),
    needsMkdirp: true,
  };
}

/**
 * Resolve a path to the parent id that new items under it should use.
 * Returns `""` for the root. Throws if the path is missing or is a document.
 */
export function resolveParentId(tree: Tree, path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return ROOT;
  const node = lookup(tree, normalized);
  if (!node) throw new Error(`no such folder: ${normalized}`);
  if (node.entry.type !== "CollectionType") {
    throw new Error(`not a folder: ${normalized}`);
  }
  return node.entry.id;
}

/** List the direct children of a folder path, folders first then by name. */
export function listChildren(tree: Tree, path: string): Node[] {
  const parentId = resolveParentId(tree, path);
  const kids = tree.children.get(parentId) ?? [];
  return [...kids].sort((a, b) => {
    const aFolder = a.entry.type === "CollectionType";
    const bFolder = b.entry.type === "CollectionType";
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.entry.visibleName.localeCompare(b.entry.visibleName);
  });
}

/**
 * Create every missing folder along `path`, returning the deepest folder's id.
 *
 * `putFolder` is *not* idempotent — calling it twice with the same name creates
 * two folders with the same name — so each segment is checked against the tree
 * before it is created. Newly created folders are grafted into the in-memory
 * tree so a subsequent lookup in the same run sees them.
 */
export async function mkdirp(
  api: RemarkableApi,
  tree: Tree,
  path: string,
): Promise<{ id: string; created: string[] }> {
  const segs = segments(path);
  const created: string[] = [];
  let parentId = ROOT;
  let currentPath = "";

  for (const seg of segs) {
    currentPath = `${currentPath}/${seg}`;
    const existing = tree.byPath.get(currentPath);
    if (existing) {
      if (existing.entry.type !== "CollectionType") {
        throw new Error(`not a folder: ${currentPath}`);
      }
      parentId = existing.entry.id;
      continue;
    }

    const ref = await api.putFolder(seg, { parent: parentId });
    created.push(currentPath);

    const entry = {
      id: ref.id,
      hash: ref.hash,
      type: "CollectionType",
      visibleName: seg,
      lastModified: new Date().toISOString(),
      pinned: false,
      parent: parentId,
    } as Entry;
    const node: Node = { entry, path: currentPath };
    tree.byId.set(entry.id, node);
    tree.byPath.set(currentPath, node);
    const bucket = tree.children.get(parentId);
    bucket ? bucket.push(node) : tree.children.set(parentId, [node]);

    parentId = ref.id;
  }

  return { id: parentId, created };
}
