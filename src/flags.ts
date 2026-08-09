import { AxiError } from "axi-sdk-js";

export interface FlagSpec {
  /** Flags that take a value, e.g. `--dir /Books`. */
  value?: string[];
  /** Flags that are standalone switches, e.g. `--force`. */
  boolean?: string[];
  /** Renamed or removed flags mapped to a targeted hint. */
  deprecated?: Record<string, string>;
}

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
}

/** `--help` is universal and never reported as unknown (AXI §6). */
const ALWAYS_ALLOWED = new Set(["--help", "-h"]);

/**
 * Parse argv for one command, rejecting anything not declared.
 *
 * A silently-dropped flag is worse than an error: the agent gets output it
 * believes is filtered and proceeds on wrong data. So an unrecognized flag
 * fails with exit code 2 and lists the valid flags inline, which collapses
 * the agent's correction from two turns into one.
 */
export function parseFlags(
  command: string,
  argv: string[],
  spec: FlagSpec,
): Parsed {
  const valueFlags = new Set(spec.value ?? []);
  const boolFlags = new Set(spec.boolean ?? []);
  const deprecated = spec.deprecated ?? {};
  const known = [...valueFlags, ...boolFlags].sort();

  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  const unknown = (name: string): never => {
    const hint = deprecated[name];
    throw new AxiError(
      `unknown flag ${name} for \`${command}\``,
      "UNKNOWN_FLAG",
      hint
        ? [hint]
        : [
            known.length > 0
              ? `valid flags for \`${command}\`: ${known.join(", ")} (--help always allowed)`
              : `\`${command}\` takes no flags (--help always allowed)`,
          ],
    );
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }

    if (ALWAYS_ALLOWED.has(arg)) {
      flags["--help"] = true;
      continue;
    }

    // Support both `--dir=/Books` and `--dir /Books`.
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);

    if (boolFlags.has(name)) {
      if (inlineValue !== undefined) {
        throw new AxiError(
          `${name} is a switch and takes no value`,
          "USAGE",
          [`Run \`remarkable-axi ${command} ${name}\` without a value`],
        );
      }
      flags[name] = true;
      continue;
    }

    if (valueFlags.has(name)) {
      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new AxiError(`${name} requires a value`, "USAGE", [
          `Run \`remarkable-axi ${command} ${name} <value>\``,
        ]);
      }
      flags[name] = next;
      i++;
      continue;
    }

    unknown(name);
  }

  return { positional, flags };
}

/** Read a value flag as a string, or fall back to a default. */
export function str(
  parsed: Parsed,
  name: string,
  fallback: string,
): string {
  const raw = parsed.flags[name];
  return typeof raw === "string" ? raw : fallback;
}

/** True when a boolean flag was supplied. */
export function bool(parsed: Parsed, name: string): boolean {
  return parsed.flags[name] === true;
}

/** Require the Nth positional argument, or fail with usage. */
export function requirePositional(
  parsed: Parsed,
  index: number,
  label: string,
  usage: string,
): string {
  const value = parsed.positional[index];
  if (value === undefined || value.length === 0) {
    throw new AxiError(`${label} is required`, "USAGE", [usage]);
  }
  return value;
}
