export const DESCRIPTION =
  "Send articles and documents to a reMarkable tablet and manage its cloud files";

export interface CommandDoc {
  usage: string;
  summary: string;
  flags?: string[];
  examples?: string[];
}

export interface CommandGroup {
  group: string;
  commands: CommandDoc[];
}

/**
 * The one place command surface is described. The home view's help lines,
 * every `--help` block, and the generated SKILL.md region all derive from
 * this, so documentation cannot drift from the implementation.
 */
export const COMMAND_GROUPS: CommandGroup[] = [
  {
    group: "Design",
    commands: [
      {
        usage: "page [--device <model>] [--landscape] [--css]",
        summary:
          "Report the target device's page box, and the CSS to author against it",
        flags: [
          "--device <model>  report for a model other than the configured target",
          "--landscape       transpose the page box",
          "--css             emit a @page block to paste into the document",
        ],
        examples: [
          "remarkable-axi page",
          "remarkable-axi page --css",
          "remarkable-axi page --device paper-pro --landscape",
        ],
      },
    ],
  },
  {
    group: "Send",
    commands: [
      {
        usage: "send <url> [--dir <path>] [--title <title>]",
        summary:
          "Fetch a web article, convert it to EPUB, and upload it to the tablet",
        flags: [
          "--dir <path>    destination folder, created if missing (default: /)",
          "--title <title> override the extracted article title",
        ],
        examples: [
          'remarkable-axi send "https://example.com/post" --dir /Articles',
          'remarkable-axi send "https://example.com/post" --title "Weekend Reading"',
        ],
      },
      {
        usage: "replace <path> <file>",
        summary:
          "Swap a document's contents in one step, leaving exactly one at the path",
        flags: [
          "--name <name>  rename while replacing",
          "--keep-old     upload the new copy but leave the old entry in place",
        ],
        examples: [
          "remarkable-axi replace /Papers/Draft.pdf ./draft-v2.pdf",
          'remarkable-axi replace "/Calibration/Calibration rM2" ./cal.pdf',
        ],
      },
      {
        usage: "put <file> [<dir>]",
        summary: "Upload a local PDF or EPUB, creating the folder if missing",
        flags: ["--name <name>  document name shown on the device"],
        examples: [
          "remarkable-axi put ~/Downloads/paper.pdf /Papers",
          'remarkable-axi put book.epub /Books --name "Field Notes"',
        ],
      },
    ],
  },
  {
    group: "Browse",
    commands: [
      {
        usage: "ls [<path>]",
        summary: "List the contents of a folder (default: /)",
        flags: ["--all  list every document in the account, recursively"],
        examples: ["remarkable-axi ls", "remarkable-axi ls /Articles"],
      },
      {
        usage: "devices",
        summary:
          "Show known reMarkable models with screen specs and PDF page sizes",
        examples: ["remarkable-axi devices"],
      },
      {
        usage: "find <pattern>",
        summary: "Search every document and folder name by substring or regex",
        flags: [
          "--type <doc|folder>  restrict results to one entry type",
          "--limit <n>          maximum results to return (default: 50)",
        ],
        examples: [
          'remarkable-axi find "transit"',
          'remarkable-axi find "^Chapter" --type doc',
        ],
      },
    ],
  },
  {
    group: "Read",
    commands: [
      {
        usage: "fetch <path> [--as pdf|svg|text] [--pages 1-3,5] [--fit content|page]",
        summary:
          "Render a notebook's handwriting to PDF or SVG, or extract its typed text",
        flags: [
          "--as <fmt>      pdf (default, all pages), svg (one page), or text",
          "--pages <spec>  page numbers and ranges, e.g. 1,3,7-9 (default: all)",
          "--fit <mode>    page (default) keeps the sheet; content crops to the ink",
          "--out <path>    where to write (default: ./<name>.<ext>)",
          "--overlay       draw ink over the original document, on the correct pages",
          "--legible       rebalance stroke weight for reading/OCR (implies --fit content; not faithful)",
        ],
        examples: [
          'remarkable-axi fetch "/Quick sheets" --as pdf',
          'remarkable-axi fetch "/Meeting Notes/Weekly" --as svg --pages 2 --fit content',
          'remarkable-axi fetch "/Papers/Draft.pdf" --as pdf',
          'remarkable-axi fetch "/Quick sheets" --as text',
        ],
      },
    ],
  },
  {
    group: "Organize",
    commands: [
      {
        usage: "mkdir <path>",
        summary: "Create a folder and every missing parent (idempotent)",
        examples: ["remarkable-axi mkdir /Studies/Physics/Term1"],
      },
      {
        usage: "mv <path> <dest-dir>",
        summary: "Move a document or folder into another folder",
        examples: ["remarkable-axi mv /Inbox/paper.pdf /Papers"],
      },
      {
        usage: "rm <path>",
        summary: "Move a document or folder to the trash",
        flags: ["--force  required to remove a folder that still has children"],
        examples: ["remarkable-axi rm /Articles/Old Post"],
      },
    ],
  },
  {
    group: "Setup",
    commands: [
      {
        usage: "login <code>",
        summary:
          "Pair this machine using an 8-character code from my.remarkable.com",
        examples: ["remarkable-axi login abcdefgh"],
      },
      {
        usage: "doctor",
        summary: "Check pairing, connectivity, and account reachability",
        flags: [
          "--rebuild  discard the cached tree and rebuild it from scratch",
        ],
        examples: ["remarkable-axi doctor", "remarkable-axi doctor --rebuild"],
      },
      {
        usage: "setup device <model>",
        summary:
          "Set the device to design for; its specs then appear in every session",
        examples: [
          "remarkable-axi setup device paper-pro",
          "remarkable-axi setup device RM110",
        ],
      },
      {
        usage: "setup hooks",
        summary:
          "Install SessionStart hooks so agents see tablet state automatically",
        examples: ["remarkable-axi setup hooks"],
      },
    ],
  },
];

/** Flat lookup of a command's documentation by its first word. */
export function commandDoc(name: string): CommandDoc | undefined {
  for (const group of COMMAND_GROUPS) {
    for (const doc of group.commands) {
      const first = doc.usage.split(" ")[0];
      if (first === name) return doc;
      // `setup hooks` is documented as a two-word usage.
      if (doc.usage.startsWith(`${name} `) && first === name) return doc;
    }
  }
  return undefined;
}

/** Render the `--help` block for a single command. */
export function renderCommandHelp(name: string): string | null {
  const doc = commandDoc(name);
  if (!doc) return null;

  const lines = [`usage: remarkable-axi ${doc.usage}`, "", doc.summary];

  if (doc.flags?.length) {
    lines.push("", "flags:");
    for (const flag of doc.flags) lines.push(`  ${flag}`);
  }

  if (doc.examples?.length) {
    lines.push("", "examples:");
    for (const example of doc.examples) lines.push(`  ${example}`);
  }

  // The SDK writes this string verbatim, so the trailing newline is ours.
  return `${lines.join("\n")}\n`;
}

/** Render the top-level help listing every command by group. */
export function renderTopLevelHelp(): string {
  const lines = [
    `remarkable-axi — ${DESCRIPTION}`,
    "",
    "usage: remarkable-axi <command> [args] [flags]",
  ];

  for (const group of COMMAND_GROUPS) {
    lines.push("", `${group.group}:`);
    const width = Math.max(
      ...group.commands.map((c) => c.usage.length),
    );
    for (const doc of group.commands) {
      lines.push(`  ${doc.usage.padEnd(width)}  ${doc.summary}`);
    }
  }

  lines.push(
    "",
    "Every cloud call times out after 120s; set REMARKABLE_TIMEOUT=<seconds> to change it (0 waits indefinitely).",
    "Run `remarkable-axi <command> --help` for usage on any command.",
    "Run `remarkable-axi` with no arguments to see current tablet state.",
  );

  return lines.join("\n");
}
