export const DESCRIPTION =
  "Send documents to a reMarkable tablet, design pages for its panel, and pull handwriting back off it";

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
 *
 * Groups match specs/commands/README.md.
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
      {
        usage:
          "render <html> [--out <path>] [--device <model>] [--landscape] [--device-page]",
        summary:
          "Print an HTML document to a PDF sized for the target device's page box",
        flags: [
          "--out <path>      where to write (default: ./<name>.pdf)",
          "--device <model>  render for a model other than the configured target",
          "--landscape       transpose the page box",
          "--device-page     override the document's declared @page with the device page box",
        ],
        examples: [
          "remarkable-axi render flyer.html",
          "remarkable-axi render flyer.html --out ~/Desktop/flyer.pdf",
          "remarkable-axi render flyer.html --device paper-pro --landscape",
        ],
      },
      {
        usage: "check <file> [--pages <spec>] [--device <model>] [--out <dir>] [--no-images]",
        summary:
          "Rasterize a PDF or HTML document at the device's density and lint it against the panel",
        flags: [
          "--pages <spec>    pages to image, e.g. 1,3,7-9 (default: all); restricts images only, never findings",
          "--device <model>  check against a model other than the configured target",
          "--out <dir>       where page images are written (default: a temp directory, reported)",
          "--no-images       findings only",
        ],
        examples: [
          "remarkable-axi check flyer.pdf",
          "remarkable-axi check flyer.html --pages 1",
          "remarkable-axi check deck.pdf --no-images",
        ],
      },
    ],
  },
  {
    group: "Move",
    commands: [
      {
        usage: "put <src> <dest>",
        summary:
          "Send a local PDF/EPUB or a URL to the tablet — source first, destination last",
        flags: [
          "--name <name>    document name shown on the device (default: derived from source)",
          "--replace        swap the contents of the document already at <dest> (uploads first, then trashes the old copy under a dated name — the safe form of rm-then-put)",
          "--discard-ink    with --replace, proceed even though the target carries ink",
        ],
        examples: [
          "remarkable-axi put ~/Downloads/paper.pdf /Papers",
          'remarkable-axi put "https://example.com/post" /Articles',
          "remarkable-axi put draft-v2.pdf /Papers/Draft --replace",
          "remarkable-axi put draft-v2.pdf /Papers/Draft --replace --discard-ink",
        ],
      },
      {
        usage: "get <path> [<dest>]",
        summary:
          "Bring a document down off the tablet — rendered ink, typed text, or the original file",
        flags: [
          "--as <fmt>      original, pdf (default), svg, or text",
          "--pages <spec>  page numbers and ranges, e.g. 1,3,7-9 (default: all)",
          "--fit <mode>    page (default) keeps the sheet; content crops to the ink",
          "--overlay       draw ink over the original document, on the correct pages",
          "--legible       rebalance stroke weight for reading/OCR (implies --fit content; not faithful)",
          "--force         overwrite an existing file at <dest>",
        ],
        examples: [
          'remarkable-axi get "/Papers/Draft" --as original',
          'remarkable-axi get "/Quick sheets" --as pdf',
          'remarkable-axi get "/Meeting Notes/Weekly" --as svg --pages 2 --fit content',
          'remarkable-axi get "/Quick sheets" --as text',
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
      {
        usage: "devices",
        summary:
          "Show known reMarkable models with screen specs and PDF page sizes",
        examples: ["remarkable-axi devices"],
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
        summary:
          "Check pairing, connectivity, external tools, duplicate paths, and the cache",
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
    // A group can be declared with no commands yet — see the `Design` group
    // above — so it stays out of the printed listing until something lands
    // in it, rather than showing an empty header or crashing on Math.max().
    if (group.commands.length === 0) continue;

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
