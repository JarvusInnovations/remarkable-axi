import { AxiError, exitCodeForError, runAxiCli } from "axi-sdk-js";
import { encodeToon, type Output } from "./output.js";
import {
  DESCRIPTION,
  renderCommandHelp,
  renderTopLevelHelp,
} from "./reference.js";
import { home } from "./commands/home.js";
import { ls, find } from "./commands/browse.js";
import { devices } from "./commands/devices.js";
import { page } from "./commands/page.js";
import { put } from "./commands/put.js";
import { get } from "./commands/get.js";
import { render } from "./commands/render.js";
import { check } from "./commands/check.js";
import { mkdir, mv, rm } from "./commands/organize.js";
import { login, doctor, setup } from "./commands/setup.js";
import { version } from "./version.js";
// Retired verbs, kept only as targeted redirects — see
// specs/commands/README.md#deprecations.
import { send } from "./commands/send.js";
import { replace } from "./commands/replace.js";
import { fetch as fetchCmd } from "./commands/fetch.js";

/**
 * Error codes that represent a malformed invocation rather than a failed
 * operation. AXI §6 requires these to exit 2, but the SDK only maps its own
 * `VALIDATION_ERROR` that way — so they are re-mapped here rather than
 * flattening every usage error into one undifferentiated code.
 */
const USAGE_CODES = new Set(["USAGE", "UNKNOWN_FLAG", "VALIDATION_ERROR"]);

function renderFailure(
  message: string,
  code: string,
  suggestions: string[],
): string {
  const output: Record<string, unknown> = { error: message, code };
  if (suggestions.length > 0) output.help = suggestions;
  // Written verbatim by the SDK, so the trailing newline is ours.
  return `${encodeToon(output)}\n`;
}

/**
 * Wrap a command handler so its output reaches the SDK as an already-
 * rendered TOON string rather than a plain object. This is the output
 * boundary: the one place `encodeToon` gets called for command output, so
 * every command's `help[]` (and any other string-array field) gets block
 * form without any command hand-assembling TOON itself.
 */
function toonOutput(
  handler: (args: string[]) => Promise<Output>,
): (args: string[]) => Promise<string> {
  return async (args) => encodeToon(await handler(args));
}

export async function main(argv: string[] = process.argv.slice(2)) {
  await runAxiCli({
    description: DESCRIPTION,
    version,
    argv,
    topLevelHelp: renderTopLevelHelp(),
    getCommandHelp: renderCommandHelp,
    home: toonOutput(home),
    commands: {
      put: toonOutput(put),
      get: toonOutput(get),
      ls: toonOutput(ls),
      find: toonOutput(find),
      devices: toonOutput(devices),
      page: toonOutput(page),
      render: toonOutput(render),
      check: toonOutput(check),
      mkdir: toonOutput(mkdir),
      mv: toonOutput(mv),
      rm: toonOutput(rm),
      login: toonOutput(login),
      doctor: toonOutput(doctor),
      setup: toonOutput(setup),
      // Retired verbs — registered so invoking them by name still produces a
      // targeted redirect instead of a generic unknown-command error.
      send: toonOutput(send),
      replace: toonOutput(replace),
      fetch: toonOutput(fetchCmd),
    },
    formatError: (error) => {
      if (error instanceof AxiError) {
        return {
          output: renderFailure(error.message, error.code, error.suggestions),
          exitCode: USAGE_CODES.has(error.code) ? 2 : exitCodeForError(error),
        };
      }

      // Never let a raw dependency error or stack trace reach stdout — an
      // agent would try to read it as data.
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: renderFailure(
          `unexpected failure: ${message}`,
          "INTERNAL_ERROR",
          ["Run `remarkable-axi doctor` to check pairing and connectivity"],
        ),
        exitCode: 1,
      };
    },
  });
}
