import { AxiError } from "axi-sdk-js";
import type { Output } from "../output.js";

/**
 * `fetch` was renamed to `get`, pairing with `put` and naming the direction.
 * Retained as a targeted redirect (not a generic unknown-command error) so an
 * agent self-corrects in one turn. See specs/commands/README.md#deprecations.
 */
export async function fetch(args: string[]): Promise<Output> {
  const path = args.find((a) => !a.startsWith("-")) ?? "<path>";
  const outIndex = args.indexOf("--out");
  const dest = outIndex !== -1 ? args[outIndex + 1] : undefined;

  const passthrough = args.filter((a, i) => {
    if (a === path && !a.startsWith("-")) return false;
    if (outIndex !== -1 && (i === outIndex || i === outIndex + 1)) {
      return false;
    }
    return true;
  });

  const invocation = [
    `remarkable-axi get "${path}"`,
    ...(dest ? [dest] : []),
    ...passthrough,
  ].join(" ");

  throw new AxiError(
    "`fetch` was renamed to `get`, pairing with `put`",
    "USAGE",
    [invocation],
  );
}
