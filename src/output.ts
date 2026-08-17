import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { encode } from "@toon-format/toon";

/**
 * The shape a command handler returns.
 *
 * `axi-sdk-js` types this internally as `AxiStructuredOutput` but does not
 * re-export it from the package entry, and its export map blocks the deep
 * import — so it is restated here rather than reached for.
 */
export type Output = Record<string, unknown>;

/**
 * Encode a value as TOON, with every string-array field rendered in
 * **block form** — one line per entry — instead of the encoder's default
 * inline, comma-joined line.
 *
 * This is the one place block form gets applied (specs/architecture.md,
 * "Help output is itself output": *"String-list values such as `help[]`
 * arrays emit in block form... so entries never need comma-and-quote
 * escaping and stays readable at any length"*). Every command's output
 * routes through here via the `toonOutput` wrapper in `src/cli.ts`, and
 * every error path routes through `renderFailure` there — so no command
 * hand-assembles TOON itself.
 *
 * Block form here is deliberately not the strict TOON §9.4 list form (which
 * requires a `- ` prefix on every item): a hint or example line is prose,
 * not data that needs to round-trip through a decoder, so the prefix would
 * only add noise. This matches the shape already documented in this
 * project's README and produced by other AXI reference tools (e.g.
 * `gh-axi issue --help`'s `examples:` block).
 */
export function encodeToon(value: unknown): string {
  const { prepared, blocks } = extractBlockArrays(value);
  let text = encode(prepared);
  for (const [token, values] of blocks) {
    text = spliceBlockArray(text, token, values);
  }
  return text;
}

const DEFAULT_INDENT = "  ";

/**
 * Walk a chain of plain objects, replacing every non-empty string-array
 * field with a unique sentinel string so `encode()` treats it as an
 * ordinary scalar (and therefore leaves its line alone as `key: <sentinel>`
 * — a shape `spliceBlockArray` can find and rebuild afterward).
 *
 * Recursion stops at arrays deliberately: a string-array field is only
 * splice-able from a `key: <sentinel>` line, and an array element's own
 * fields render as comma-joined tabular cells or `- key: value` list
 * items instead — a plain-object field is the only position this rewrite
 * can safely target, and it is the only position any command output uses.
 */
function extractBlockArrays(value: unknown): {
  prepared: unknown;
  blocks: Map<string, string[]>;
} {
  const blocks = new Map<string, string[]>();
  let counter = 0;
  // Fresh per call and kept to safe unquoted characters (letters, digits,
  // underscore) so the encoder never quotes or escapes it — a quoted or
  // escaped token wouldn't match verbatim when we go looking for its line.
  const nonce = randomUUID().replaceAll("-", "");

  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);

  const walk = (input: unknown): unknown => {
    if (!isPlainObject(input)) return input;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input)) {
      if (
        Array.isArray(val) &&
        val.length > 0 &&
        val.every((el) => typeof el === "string")
      ) {
        const token = `TOON_BLOCK_${nonce}_${counter++}`;
        blocks.set(token, val as string[]);
        out[key] = token;
      } else {
        out[key] = walk(val);
      }
    }
    return out;
  };

  return { prepared: walk(value), blocks };
}

/** Replace the encoded `key: <sentinel>` line with a block-form array. */
function spliceBlockArray(
  text: string,
  token: string,
  values: string[],
): string {
  const lines = text.split("\n");
  const marker = `: ${token}`;
  const index = lines.findIndex((line) => line.includes(marker));
  if (index === -1) {
    // extractBlockArrays only ever places a sentinel as a `key: <sentinel>`
    // scalar field, so the encoder always emits it on its own line this way
    // — if it's missing, something upstream changed the encoder's output
    // shape, and silently leaving the raw token in agent-facing output
    // would be worse than failing loud here.
    throw new Error(`encodeToon: lost track of block array ${token}`);
  }

  const line = lines[index]!;
  const prefix = line.slice(0, line.indexOf(marker));
  const indent = /^\s*/.exec(prefix)?.[0] ?? "";
  const header = `${prefix}[${values.length}]:`;
  const body = values.map((v) => `${indent}${DEFAULT_INDENT}${v}`);
  lines.splice(index, 1, header, ...body);
  return lines.join("\n");
}

/** Collapse the user's home directory to `~` for display. */
export function collapseHome(path: string): string {
  const home = homedir();
  if (home && path.startsWith(home)) {
    const rest = path.slice(home.length);
    if (rest === "" || rest.startsWith("/")) return `~${rest}`;
  }
  return path;
}

/** Render a byte count the way a human reads it: `319KB`, `1.2MB`. */
export function humanSize(bytes: number): string {
  return bytes < 1024
    ? `${bytes}B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)}KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
