import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";
import { client } from "../auth.js";
import { loadTree } from "../cache.js";
import { age } from "../time.js";
import { bool, parseFlags, str, requirePositional } from "../flags.js";
import {
  buildTree,
  duplicatePaths,
  listChildren,
  lookup,
  normalizePath,
  type Node,
} from "../paths.js";

function kind(node: Node): string {
  if (node.entry.type === "CollectionType") return "folder";
  if (node.entry.type === "TemplateType") return "template";
  return node.entry.fileType;
}

/** The short id to disambiguate a node, when its path collides with a sibling's. */
function duplicateMark(
  node: Node,
  dups: Map<string, Node[]>,
): { duplicate: string } | Record<string, never> {
  return dups.has(node.path) ? { duplicate: node.entry.id.slice(0, 8) } : {};
}

function row(node: Node, dups: Map<string, Node[]>) {
  return {
    type: kind(node),
    name: node.entry.visibleName,
    modified: age(node.entry.lastModified),
    ...duplicateMark(node, dups),
  };
}

export async function ls(args: string[]): Promise<Output> {
  const parsed = parseFlags("ls", args, { boolean: ["--all"] });
  const path = normalizePath(parsed.positional[0] ?? "/");
  const api = await client();
  const tree = buildTree((await loadTree(api)).entries);
  const dups = duplicatePaths(tree);

  if (bool(parsed, "--all")) {
    const all = [...tree.byId.values()]
      .filter((n) => n.entry.type === "DocumentType")
      .sort((a, b) => a.path.localeCompare(b.path));

    if (all.length === 0) {
      return {
        documents: "0 documents in this account",
        help: ['Run `remarkable-axi put <file> /Articles` to add one'],
      };
    }

    const dupCount = new Set(
      all.filter((n) => dups.has(n.path)).map((n) => n.path),
    ).size;

    return {
      count: `${all.length} documents${dupCount > 0 ? `, ${dupCount} duplicated paths` : ""}`,
      documents: all.map((n) => ({
        type: kind(n),
        path: n.path,
        modified: age(n.entry.lastModified),
        ...duplicateMark(n, dups),
      })),
    };
  }

  if (path !== "/" && !lookup(tree, path)) {
    throw new AxiError(`no such folder: ${path}`, "NOT_FOUND", [
      "Run `remarkable-axi ls /` to see what exists",
      `Run \`remarkable-axi mkdir ${path}\` to create it`,
    ]);
  }

  const children = listChildren(tree, path);

  if (children.length === 0) {
    return {
      path,
      items: `0 items in ${path}`,
      help: [
        `Run \`remarkable-axi put <file> ${path}\` to upload a document`,
      ],
    };
  }

  const folders = children.filter(
    (n) => n.entry.type === "CollectionType",
  ).length;
  const dupCount = new Set(
    children.filter((n) => dups.has(n.path)).map((n) => n.path),
  ).size;

  return {
    path,
    count:
      `${children.length} items (${folders} folders, ${children.length - folders} documents)` +
      (dupCount > 0 ? `, ${dupCount} duplicated names` : ""),
    items: children.map((n) => row(n, dups)),
    help: [
      children.some((n) => n.entry.type === "CollectionType")
        ? `Run \`remarkable-axi ls ${path === "/" ? "" : path}/<folder>\` to descend`
        : undefined,
      `Run \`remarkable-axi put <file> ${path}\` to upload a document`,
    ].filter(Boolean) as string[],
  };
}

export async function find(args: string[]): Promise<Output> {
  const parsed = parseFlags("find", args, {
    value: ["--type", "--limit"],
  });
  const pattern = requirePositional(
    parsed,
    0,
    "a search pattern",
    'Run `remarkable-axi find "<pattern>"`',
  );

  const typeFilter = str(parsed, "--type", "");
  if (typeFilter && typeFilter !== "doc" && typeFilter !== "folder") {
    throw new AxiError(`invalid --type: ${typeFilter}`, "USAGE", [
      "Valid values are `doc` and `folder`",
    ]);
  }

  const rawLimit = str(parsed, "--limit", "50");
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AxiError(`invalid --limit: ${rawLimit}`, "USAGE", [
      "Pass a positive integer, e.g. `--limit 100`",
    ]);
  }

  // Try the pattern as a regex; fall back to a literal substring match so a
  // plain search term containing regex metacharacters still behaves sensibly.
  let matches: (name: string) => boolean;
  try {
    const re = new RegExp(pattern, "i");
    matches = (name) => re.test(name);
  } catch {
    const needle = pattern.toLowerCase();
    matches = (name) => name.toLowerCase().includes(needle);
  }

  const api = await client();
  const tree = buildTree((await loadTree(api)).entries);
  const dups = duplicatePaths(tree);

  const hits = [...tree.byId.values()]
    .filter((n) => {
      if (typeFilter === "doc" && n.entry.type !== "DocumentType") return false;
      if (typeFilter === "folder" && n.entry.type !== "CollectionType") {
        return false;
      }
      return matches(n.entry.visibleName);
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  if (hits.length === 0) {
    return {
      results: `0 matches for "${pattern}"`,
      help: ["Run `remarkable-axi ls --all` to see every document"],
    };
  }

  const shown = hits.slice(0, limit);
  const dupCount = new Set(
    shown.filter((n) => dups.has(n.path)).map((n) => n.path),
  ).size;

  return {
    count:
      (hits.length > shown.length
        ? `${shown.length} of ${hits.length} matches`
        : `${hits.length} matches`) +
      (dupCount > 0 ? `, ${dupCount} duplicated names` : ""),
    results: shown.map((n) => ({
      type: kind(n),
      path: n.path,
      modified: age(n.entry.lastModified),
      ...duplicateMark(n, dups),
    })),
    // Spread rather than assigning undefined — an undefined value serializes
    // as an explicit `help: null`, which reads as "there is no help here"
    // instead of the key simply not applying.
    ...(hits.length > shown.length
      ? {
          help: [
            `Run \`remarkable-axi find "${pattern}" --limit ${hits.length}\` for all matches`,
          ],
        }
      : {}),
  };
}
