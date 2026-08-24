import { AxiError } from "axi-sdk-js";
import type { Entry } from "rmapi-js";
import type { Output } from "../output.js";
import { client } from "../auth.js";
import { loadTree, recordMutation } from "../cache.js";
import { bool, parseFlags, requirePositional, str } from "../flags.js";
import {
  buildTree,
  lookup,
  nodesAt,
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
      help: [`Run \`remarkable-axi ls "${path}"\` to see its contents`],
    };
  }

  await recordMutation(api, {
    upsert: created.map((p) => tree.byPath.get(p)!.entry),
  });

  return {
    folder: path,
    created: created.join(", "),
    help: [`Run \`remarkable-axi put <file> "${path}"\` to add a document`],
  };
}

export async function mv(args: string[]): Promise<Output> {
  const parsed = parseFlags("mv", args, { value: ["--name"] });
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

  const newName = str(parsed, "--name", "");

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
      `Run \`remarkable-axi mkdir "${to}"\` to create it first`,
    ]);
  }

  const landingName = newName || node.entry.visibleName;
  const samePlace = (node.entry.parent ?? "") === parent;

  // Nothing asked for and nothing to do — but a --name that differs is a
  // rename, and renames in place are real work.
  if (samePlace && landingName === node.entry.visibleName) {
    return {
      moved: `${from} is already in ${to} (no-op)`,
      help: [`Run \`remarkable-axi ls "${to}"\` to see its contents`],
    };
  }

  // A move is the easiest way to manufacture a duplicate by accident: it
  // carries a name the user may not have in mind into a folder they cannot
  // see. Refuse an occupied landing path rather than create a state every
  // other command refuses to operate on —
  // specs/behaviors/path-uniqueness.md#on-write.
  const landingPath = to === "/" ? `/${landingName}` : `${to}/${landingName}`;
  const occupants = nodesAt(tree, landingPath).filter((n) => n.entry.id !== node.entry.id);
  if (occupants.length > 0) {
    throw new AxiError(
      `${landingPath} already exists (${occupants[0]!.entry.id.slice(0, 8)})`,
      "EXISTS",
      [
        `land it under a distinct name — remarkable-axi mv "${from}" "${to}" --name "<name>"`,
        `or clear the occupant deliberately — remarkable-axi rm "${landingPath}"`,
      ],
    );
  }

  let ref = { id: node.entry.id, hash: node.entry.hash };
  if (landingName !== node.entry.visibleName) {
    ref = await api.rename(ref, landingName);
  }
  if (!samePlace) {
    ref = await api.move(ref, parent);
  }

  await recordMutation(api, {
    upsert: [
      { ...node.entry, hash: ref.hash, parent, visibleName: landingName } as Entry,
    ],
  });

  return {
    moved: {
      name: landingName,
      ...(landingName !== node.entry.visibleName ? { was: node.entry.visibleName } : {}),
      from,
      to: landingPath,
    },
    help: [`Run \`remarkable-axi ls "${to}"\` to confirm`],
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
          `Run \`remarkable-axi ls "${path}"\` to review the contents`,
          `Run \`remarkable-axi rm "${path}" --force\` to trash the folder anyway`,
        ],
      );
    }
  }

  await api.delete({ id: node.entry.id, hash: node.entry.hash });

  await recordMutation(api, { remove: [node.entry.id] });

  const help = ["Restore it from the trash on the device if this was a mistake"];
  // Only a document can be the target of `put --replace` — a folder removal
  // is never the rm-then-put pattern this hint teaches around, so it's
  // withheld there. See specs/commands/put.md, "rm then put is the same
  // intent in the unsafe order".
  if (node.entry.type !== "CollectionType") {
    help.push(
      `Replacing it? Run \`remarkable-axi put <src> "${path}" --replace\` to do this in one safe motion`,
    );
  }

  return {
    trashed: { name: node.entry.visibleName, path },
    help,
  };
}
