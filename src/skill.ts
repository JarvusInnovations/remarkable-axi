/**
 * Generators for the machine-maintained regions of the companion skill's
 * SKILL.md (specs/skill.md). The prose in SKILL.md is hand-authored and lives
 * outside the markers; this module produces only the generated regions, from
 * the same `COMMAND_GROUPS` every other surface (home view, `--help`) uses —
 * so the skill can never drift from the implementation
 * (specs/architecture.md#command-surface-has-one-source).
 *
 * remarkable-axi ships to npm, so — unlike a skill that bundles its own CLI —
 * every example in the skill invokes it via `npx -y remarkable-axi`, runnable
 * with nothing installed.
 */
import { COMMAND_GROUPS } from "./reference.js";

const SKILL_INVOCATION = "npx -y remarkable-axi";

export function commandReferenceMarkdown(): string {
  return COMMAND_GROUPS.filter((group) => group.commands.length > 0)
    .map((group) => {
      const items = group.commands
        .map((c) => `- \`${SKILL_INVOCATION} ${c.usage}\` — ${c.summary}`)
        .join("\n");
      return `### ${group.group}\n\n${items}`;
    })
    .join("\n\n");
}

/** Region id → generator. Keys match the `GENERATED: <id>` markers in SKILL.md. */
export const GENERATED_REGIONS: Record<string, () => string> = {
  "command-reference": commandReferenceMarkdown,
};

/**
 * Splice each generated region into a SKILL.md source between its markers:
 *   <!-- BEGIN GENERATED: <id> --> ... <!-- END GENERATED: <id> -->
 * Returns the updated document. Throws if a declared region's markers are
 * missing so drift can't pass silently.
 */
export function spliceGeneratedRegions(doc: string): string {
  let out = doc;
  for (const [id, generate] of Object.entries(GENERATED_REGIONS)) {
    const begin = `<!-- BEGIN GENERATED: ${id} -->`;
    const end = `<!-- END GENERATED: ${id} -->`;
    const pattern = new RegExp(
      `${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`,
    );
    if (!pattern.test(out)) {
      throw new Error(
        `SKILL.md is missing the generated region markers for "${id}"`,
      );
    }
    out = out.replace(pattern, `${begin}\n\n${generate().trim()}\n\n${end}`);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
