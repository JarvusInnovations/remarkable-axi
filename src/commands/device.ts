import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";
import { collapseHome } from "../output.js";
import { parseFlags, requirePositional, str } from "../flags.js";
import { readConfig, writeConfig } from "../config.js";
import {
  execRemote,
  formatDocuments,
  formatStorage,
  formatXochitl,
  parseStatusOutput,
  resolveSshTarget,
  STATUS_COMMAND,
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
 * Only `status` exists yet; later plans append `backup`/`orphans`/`reattach`.
 */
export async function device(args: string[]): Promise<Output> {
  const sub = args[0];

  if (sub === "status") return status(args.slice(1));

  throw new AxiError(
    sub ? `unknown device command: ${sub}` : "device needs a subcommand",
    "USAGE",
    ["Run `remarkable-axi device status` to check tablet connectivity"],
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
