import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import type { Output } from "../output.js";
import { collapseHome } from "../output.js";
import { register } from "rmapi-js";
import { client, readToken, tokenPath, writeToken } from "../auth.js";
import { parseFlags, requirePositional } from "../flags.js";
import { buildTree } from "../paths.js";
import { listEntries } from "../entries.js";
import { setupDevice } from "./devices.js";


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
  parseFlags("doctor", args, {});

  const token = await readToken();
  const fromEnv = Boolean(process.env.REMARKABLE_TOKEN?.trim());

  if (!token) {
    return {
      doctor: {
        paired: "no",
        token: `not found at ${collapseHome(tokenPath)}`,
      },
      help: [
        `Get an 8-character code from ${CONNECT_URL}`,
        "Run `remarkable-axi login <code>` to pair this machine",
      ],
    };
  }

  const started = Date.now();
  try {
    const api = await client();
    const { entries, unreadable } = await listEntries(api);
    const tree = buildTree(entries);
    const documents = [...tree.byId.values()].filter(
      (n) => n.entry.type === "DocumentType",
    ).length;
    const folders = [...tree.byId.values()].filter(
      (n) => n.entry.type === "CollectionType",
    ).length;

    return {
      doctor: {
        paired: "yes",
        token: fromEnv
          ? "REMARKABLE_TOKEN (environment)"
          : collapseHome(tokenPath),
        reachable: "yes",
        latency: `${Date.now() - started}ms`,
        documents,
        folders,
        // Surfaced rather than hidden: a listing that quietly drops items
        // reads as complete when it isn't.
        ...(unreadable > 0 ? { unreadable } : {}),
      },
    };
  } catch (error) {
    if (error instanceof AxiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      doctor: {
        paired: "yes",
        token: fromEnv
          ? "REMARKABLE_TOKEN (environment)"
          : collapseHome(tokenPath),
        reachable: "no",
        error: message,
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
