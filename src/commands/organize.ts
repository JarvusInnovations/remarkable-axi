import { AxiError } from "axi-sdk-js";
import type { Entry } from "rmapi-js";
import type { Output } from "../output.js";
import { client } from "../auth.js";
import { loadTree, recordMutation } from "../cache.js";
import { bool, parseFlags, requirePositional } from "../flags.js";
import {
  buildTree,
  lookup,
  mkdirp,
  normalizePath,
  resolveParentId,
} from "../paths.js";

export async function mkdir(args: string[]): Promise<Output> {
  const parsed = parseFlags("mkdir", args, {});
  const path = normalizePath(
    requirePositional(
      parsed,
      0,
      "a folder path",
      "Run `remarkable-axi mkdir <path>`",
    ),
  );

  if (path === "/") {
    throw new AxiError("cannot create the root folder", "USAGE", [
      "Pass a path below the root, e.g. `remarkable-axi mkdir /Articles`",
    ]);
  }

  const api = await client();
  const tree = buildTree((await loadTree(api)).entries);
  const { created } = await mkdirp(api, tree, path);

  // Already existing is the desired state, not a failure (AXI §6).
  if (created.length === 0) {
    return {
      folder: `${path} already exists (no-op)`,
      help: [`Run \`remarkable-axi ls ${path}\` to see its contents`],
    };
  }

  await recordMutation(api, {
    upsert: created.map((p) => tree.byPath.get(p)!.entry),
  });

  return {
    folder: path,
    created: created.join(", "),
    help: [`Run \`remarkable-axi put <file> ${path}\` to add a document`],
  };
}

export async function mv(args: string[]): Promise<Output> {
  const parsed = parseFlags("mv", args, {});
  const from = normalizePath(
    requirePositional(
      parsed,
      0,
      "a source path",
      "Run `remarkable-axi mv <path> <dest-dir>`",
    ),
  );
  const to = normalizePath(
    requirePositional(
      parsed,
      1,
      "a destination folder",
      "Run `remarkable-axi mv <path> <dest-dir>`",
    ),
  );

  const api = await client();
  const tree = buildTree((await loadTree(api)).entries);

  const node = lookup(tree, from);
  if (!node) {
    throw new AxiError(`no such item: ${from}`, "NOT_FOUND", [
      `Run \`remarkable-axi find "${from.split("/").pop()}"\` to locate it`,
    ]);
  }

  // Moving a folder into its own subtree would orphan it from the root.
  if (node.entry.type === "CollectionType" && to.startsWith(`${from}/`)) {
    throw new AxiError(
      `cannot move ${from} into its own subtree`,
      "USAGE",
      ["Pick a destination outside the folder being moved"],
    );
  }

  let parent: string;
  try {
    parent = resolveParentId(tree, to);
  } catch {
    throw new AxiError(`no such folder: ${to}`, "NOT_FOUND", [
      `Run \`remarkable-axi mkdir ${to}\` to create it first`,
    ]);
  }

  if ((node.entry.parent ?? "") === parent) {
    return {
      moved: `${from} is already in ${to} (no-op)`,
      help: [`Run \`remarkable-axi ls ${to}\` to see its contents`],
    };
  }

  const moved = await api.move({ id: node.entry.id, hash: node.entry.hash }, parent);

  await recordMutation(api, {
    upsert: [{ ...node.entry, hash: moved.hash, parent } as Entry],
  });

  return {
    moved: { name: node.entry.visibleName, from, to },
    help: [`Run \`remarkable-axi ls ${to}\` to confirm`],
  };
}

export async function rm(args: string[]): Promise<Output> {
  const parsed = parseFlags("rm", args, { boolean: ["--force"] });
  const path = normalizePath(
    requirePositional(parsed, 0, "a path", "Run `remarkable-axi rm <path>`"),
  );

  const api = await client();
  const tree = buildTree((await loadTree(api)).entries);

  const node = lookup(tree, path);
  if (!node) {
    throw new AxiError(`no such item: ${path}`, "NOT_FOUND", [
      `Run \`remarkable-axi find "${path.split("/").pop()}"\` to locate it`,
    ]);
  }

  // A folder delete leaves children orphaned rather than removing them, so
  // require an explicit --force and report exactly what will be stranded.
  if (node.entry.type === "CollectionType") {
    const children = tree.children.get(node.entry.id) ?? [];
    if (children.length > 0 && !bool(parsed, "--force")) {
      throw new AxiError(
        `${path} still contains ${children.length} items`,
        "NOT_EMPTY",
        [
          "Deleting a folder does not delete what is inside it",
          `Run \`remarkable-axi ls ${path}\` to review the contents`,
          `Run \`remarkable-axi rm ${path} --force\` to trash the folder anyway`,
        ],
      );
    }
  }

  await api.delete({ id: node.entry.id, hash: node.entry.hash });

  await recordMutation(api, { remove: [node.entry.id] });

  return {
    trashed: { name: node.entry.visibleName, path },
    help: ["Restore it from the trash on the device if this was a mistake"],
  };
}
