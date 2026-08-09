import { homedir } from "node:os";

/**
 * The shape a command handler returns.
 *
 * `axi-sdk-js` types this internally as `AxiStructuredOutput` but does not
 * re-export it from the package entry, and its export map blocks the deep
 * import — so it is restated here rather than reached for.
 */
export type Output = Record<string, unknown>;

/** Collapse the user's home directory to `~` for display. */
export function collapseHome(path: string): string {
  const home = homedir();
  if (home && path.startsWith(home)) {
    const rest = path.slice(home.length);
    if (rest === "" || rest.startsWith("/")) return `~${rest}`;
  }
  return path;
}
