import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import type { Output } from "../output.js";
import { collapseHome } from "../output.js";
import { register } from "rmapi-js";
import { client, readToken, tokenPath, writeToken } from "../auth.js";
import { bool, parseFlags, requirePositional } from "../flags.js";
import { buildTree, duplicatePaths } from "../paths.js";
import { discardCache, loadTree } from "../cache.js";
import { age } from "../time.js";
import { setupDevice } from "./devices.js";
import { findChrome } from "../chrome.js";


const CONNECT_URL = "https://my.remarkable.com/device/desktop/connect";

export async function login(args: string[]): Promise<Output> {
  const parsed = parseFlags("login", args, {});
  const code = requirePositional(
    parsed,
    0,
    "an 8-character pairing code",
    `Get a code from ${CONNECT_URL}, then run \`remarkable-axi login <code>\``,
  )
    .trim()
    .toLowerCase();

  if (!/^[a-z0-9]{8}$/.test(code)) {
    throw new AxiError(
      `\`${code}\` is not a valid pairing code`,
      "USAGE",
      [
        "Codes are exactly 8 letters and digits",
        `Get a fresh one from ${CONNECT_URL}`,
      ],
    );
  }

  let token: string;
  try {
    token = await register(code);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AxiError(`pairing failed: ${message}`, "AUTH_FAILED", [
      "Codes expire quickly and are single-use",
      `Get a fresh code from ${CONNECT_URL} and try again`,
    ]);
  }

  const path = await writeToken(token);

  return {
    paired: {
      account: "reMarkable cloud",
      token: collapseHome(path),
    },
    help: [
      "Run `remarkable-axi` to see your tablet contents",
      "Run `remarkable-axi setup hooks` so agents see tablet state automatically",
    ],
  };
}

export async function doctor(args: string[]): Promise<Output> {
  const parsed = parseFlags("doctor", args, { boolean: ["--rebuild"] });

  const token = await readToken();
  const fromEnv = Boolean(process.env.REMARKABLE_TOKEN?.trim());

  // `render` (and, later, `check`) is unusable without Chrome, and it is an
  // external install this tool cannot verify any other way — so `doctor`
  // reports it regardless of pairing state, the same as pairing is reported
  // regardless of whether Chrome is installed.
  const chromeInfo = await findChrome();
  const chrome = chromeInfo
    ? `found (${chromeInfo.version})`
    : "not found — required for `render`; install Chrome or Chromium";

  if (!token) {
    return {
      doctor: {
        paired: "no",
        token: `not found at ${collapseHome(tokenPath)}`,
        chrome,
      },
      help: [
        `Get an 8-character code from ${CONNECT_URL}`,
        "Run `remarkable-axi login <code>` to pair this machine",
      ],
    };
  }

  // Discarding and rebuilding is the only supported repair for a cache
  // suspected wrong — there is no partial-invalidation escape hatch.
  if (bool(parsed, "--rebuild")) await discardCache();

  const started = Date.now();
  try {
    const api = await client();
    const result = await loadTree(api);
    const tree = buildTree(result.entries);
    const documents = [...tree.byId.values()].filter(
      (n) => n.entry.type === "DocumentType",
    ).length;
    const folders = [...tree.byId.values()].filter(
      (n) => n.entry.type === "CollectionType",
    ).length;
    const reachable = result.source !== "stale";

    // Duplicated paths are detected here, standing apart from write-time
    // prevention, because they arrive from the device and other clients
    // regardless of what this tool does — see specs/behaviors/path-uniqueness.md.
    const dups = [...duplicatePaths(tree).entries()];

    return {
      doctor: {
        paired: "yes",
        token: fromEnv
          ? "REMARKABLE_TOKEN (environment)"
          : collapseHome(tokenPath),
        reachable: reachable ? "yes" : "no",
        latency: `${Date.now() - started}ms`,
        documents,
        folders,
        cache: {
          generation: result.generation,
          age: age(result.updatedAt),
        },
        // Surfaced rather than hidden: a listing that quietly drops items
        // reads as complete when it isn't.
        ...(result.unreadable > 0 ? { unreadable: result.unreadable } : {}),
        chrome,
        duplicates: dups.length,
        ...(dups.length > 0
          ? {
              duplicateExamples: dups
                .slice(0, 5)
                .map(
                  ([path, nodes]) =>
                    `${path} (${nodes.map((n) => n.entry.id.slice(0, 8)).join(", ")})`,
                ),
            }
          : {}),
        ...(reachable ? {} : { error: "cloud unreachable; serving cached tree" }),
      },
      ...(reachable
        ? {}
        : {
            help: [
              "Check network connectivity to the reMarkable cloud",
              `The tree above is cached and ${age(result.updatedAt)} old`,
            ],
          }),
    };
  } catch (error) {
    if (error instanceof AxiError && error.code !== "CLOUD_UNREACHABLE") throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      doctor: {
        paired: "yes",
        token: fromEnv
          ? "REMARKABLE_TOKEN (environment)"
          : collapseHome(tokenPath),
        reachable: "no",
        error: message,
        chrome,
      },
      help: [
        "Check network connectivity to the reMarkable cloud",
        "If the token was revoked, run `remarkable-axi login <code>` to re-pair",
      ],
    };
  }
}

export async function setup(args: string[]): Promise<Output> {
  const sub = args[0];

  if (sub === "device") return setupDevice(args.slice(1));

  if (sub !== "hooks") {
    throw new AxiError(
      sub ? `unknown setup command: ${sub}` : "setup needs a subcommand",
      "USAGE",
      [
        "Run `remarkable-axi setup hooks` to install SessionStart hooks",
        "Run `remarkable-axi setup device <model>` to set the device to design for",
      ],
    );
  }

  installSessionStartHooks({
    marker: "remarkable-axi",
    binaryNames: ["remarkable-axi"],
  });

  return {
    setup: "SessionStart hooks installed or already up to date",
    help: [
      "Claude Code and Codex get native hooks; OpenCode gets a managed plugin",
      "New agent sessions will now start with your tablet state in context",
    ],
  };
}
